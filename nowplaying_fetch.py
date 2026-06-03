#!/usr/bin/env python3
"""
Now Playing info for Übersicht widget.

Checks Spotify (native app) and Kaset (YouTube Music wrapper) via AppleScript.
Spotify takes priority when both are active.

Supports playback control actions via --action flag:
  nowplaying_fetch.py --action playpause|next|previous [--source spotify|youtube_music]
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import urllib.parse
from typing import Any

from widget_helpers import load_local_env, get_env, fetch_json, utc_timestamp, safe_main

CONFIG_PATHS = [
    pathlib.Path.home() / '.config' / 'nowplaying-widget.env',
    pathlib.Path.home() / 'Library' / 'Application Support' / 'Übersicht' / 'widgets' / '.nowplaying-widget.env',
]

# Last.fm genre lookup. Tags are a crowd folksonomy — the top tag for a track
# is effectively its genre. We cache by artist+title on disk because genre is
# immutable per track and the widget polls every 10s; without the cache we'd
# re-hit Last.fm on every poll for the same song.
GENRE_CACHE_PATH = pathlib.Path.home() / '.cache' / 'nowplaying-widget' / 'genre-cache.json'
GENRE_CACHE_MAX = 300
GENRE_MAX_TAGS = 5
LASTFM_API = 'https://ws.audioscrobbler.com/2.0/'
# Non-genre tags Last.fm users spam; drop so they never surface as "genre".
GENRE_TAG_BLOCKLIST = {
    'seen live', 'favorites', 'favourites', 'favorite', 'favourite',
    'spotify', 'love', 'beautiful', 'awesome', 'good', 'sexy', 'albums i own',
}

# Player-state queries. Callers MUST pre-check `is_running(app_name)` before
# executing these — `tell application "X"` will *launch* the app if it isn't
# already running, which defeats the whole point of a "now playing" check
# and would also be rude on machine startup. The pgrep pre-check is the gate.
SPOTIFY_SCRIPT = '''
tell application "Spotify"
    if player state is stopped then return "STOPPED"
    return (name of current track) & "|||" & (artist of current track) & "|||" & (album of current track) & "|||" & (duration of current track) & "|||" & (player position) & "|||" & (player state as string)
end tell
'''

KASET_SCRIPT = '''
tell application "Kaset" to get player info
'''

# Playback control actions per source. Values are AppleScript snippets.
ACTIONS = {
    'spotify': {
        'playpause': 'tell application "Spotify" to playpause',
        'next': 'tell application "Spotify" to next track',
        'previous': 'tell application "Spotify" to previous track',
    },
    'youtube_music': {
        'playpause': 'tell application "Kaset" to playpause',
        'next': 'tell application "Kaset" to next track',
        'previous': 'tell application "Kaset" to previous track',
    },
}


def run_osascript(script: str) -> str | None:
    try:
        proc = subprocess.run(
            ['osascript', '-e', script],
            capture_output=True, text=True, timeout=3,
        )
        if proc.returncode == 0:
            return proc.stdout.strip()
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None


def is_running(app_name: str) -> bool:
    """Fast process-existence check via `pgrep -x`.

    Replaces the prior `tell application "System Events" to (name of
    processes) contains "X"` AppleScript pre-check, which was measured at
    1–3 seconds per invocation (sometimes 20+ seconds cold) on macOS due
    to Apple Events / sandbox overhead. `pgrep -x` returns in roughly 1ms
    and is authoritative for "is this process running right now". Must
    be called BEFORE any `tell application "X"` block, since AppleScript
    will otherwise *launch* the target app.
    """
    try:
        result = subprocess.run(
            ['pgrep', '-x', app_name],
            capture_output=True, timeout=1,
        )
        return result.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def _load_genre_cache() -> dict[str, list[str]]:
    try:
        data = json.loads(GENRE_CACHE_PATH.read_text())
        # Guard against valid-but-wrong-type JSON (null/[]/42); a non-dict
        # would make `key in cache` / `cache[key] = ...` raise TypeError.
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _save_genre_cache(cache: dict[str, list[str]]) -> None:
    # Trim oldest entries (dict preserves insertion order) if over cap.
    if len(cache) > GENRE_CACHE_MAX:
        cache = dict(list(cache.items())[-GENRE_CACHE_MAX:])
    try:
        GENRE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        GENRE_CACHE_PATH.write_text(json.dumps(cache))
    except OSError:
        pass


def _top_tags(tags: Any, limit: int) -> list[str]:
    """Highest-count non-blocklisted tags from a Last.fm toptags list, in order."""
    if not isinstance(tags, list):
        return []
    out: list[str] = []
    for tag in tags:
        name = (tag.get('name') or '').strip()
        if name and name.lower() not in GENRE_TAG_BLOCKLIST:
            out.append(name)
            if len(out) >= limit:
                break
    return out


def _lastfm_tags(method: str, params: dict[str, str], api_key: str) -> Any:
    query = urllib.parse.urlencode({
        'method': method, 'api_key': api_key, 'format': 'json',
        'autocorrect': '1', **params,
    })
    try:
        data = fetch_json(f'{LASTFM_API}?{query}', timeout=3)
    except Exception:
        return None
    return (data.get('toptags') or {}).get('tag') if isinstance(data, dict) else None


def fetch_genres(artist: str, title: str, api_key: str | None) -> list[str]:
    """Genre + subgenre tags for a track via Last.fm, cached by artist+title.

    Returns up to GENRE_MAX_TAGS tags (broadest first, e.g. trance →
    progressive trance). Empty list silently on missing key, network
    failure, or no usable tag — genres must never break the payload.
    """
    if not api_key or not artist or not title:
        return []
    key = f'{artist.lower()}|||{title.lower()}'
    cache = _load_genre_cache()
    if key in cache:
        return cache[key]  # [] = known-missing, don't re-fetch

    genres = _top_tags(_lastfm_tags('track.gettoptags', {'artist': artist, 'track': title}, api_key), GENRE_MAX_TAGS)
    if not genres:
        genres = _top_tags(_lastfm_tags('artist.gettoptags', {'artist': artist}, api_key), GENRE_MAX_TAGS)

    cache[key] = genres
    _save_genre_cache(cache)
    return genres


def get_spotify() -> dict[str, Any] | None:
    if not is_running('Spotify'):
        return None
    raw = run_osascript(SPOTIFY_SCRIPT)
    if not raw or raw == 'STOPPED':
        return None
    parts = raw.split('|||')
    if len(parts) < 6:
        return None
    title, artist, album, duration_ms, position_s, state = parts[:6]
    try:
        dur = int(duration_ms)
        pos = int(float(position_s) * 1000)
    except (ValueError, TypeError):
        dur = None
        pos = None
    return {
        'source': 'spotify',
        'track': {
            'title': title,
            'artist': artist,
            'album': album or None,
            'state': state.strip().lower(),
            'durationMs': dur,
            'positionMs': pos,
        },
    }


def get_kaset() -> dict[str, Any] | None:
    if not is_running('Kaset'):
        return None
    raw = run_osascript(KASET_SCRIPT)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    track_info = data.get('currentTrack') or {}
    title = (track_info.get('name') or '').strip()
    if not title:
        return None
    is_playing = bool(data.get('isPlaying'))
    duration_s = data.get('duration')
    position_s = data.get('position')
    return {
        'source': 'youtube_music',
        'track': {
            'title': title,
            'artist': (track_info.get('artist') or '').strip(),
            'album': (track_info.get('album') or '').strip() or None,
            'state': 'playing' if is_playing else 'paused',
            'durationMs': int(duration_s * 1000) if isinstance(duration_s, (int, float)) else None,
            'positionMs': int(position_s * 1000) if isinstance(position_s, (int, float)) else None,
        },
    }


def handle_action(action: str, source: str | None) -> None:
    """Dispatch a playback control action and print JSON result.

    If source is None, infer from currently active player (Spotify first, then Kaset).
    """
    if source is None:
        spotify = get_spotify()
        if spotify:
            source = 'spotify'
        elif get_kaset():
            source = 'youtube_music'
        else:
            print(json.dumps({'ok': False, 'error': 'no active player'}))
            return

    source_actions = ACTIONS.get(source)
    if source_actions is None:
        print(json.dumps({'ok': False, 'error': f'unknown source: {source}'}))
        return
    script = source_actions.get(action)
    if script is None:
        print(json.dumps({'ok': False, 'error': f'unknown action: {action}'}))
        return
    raw = run_osascript(script)
    print(json.dumps({'ok': raw is not None, 'action': action, 'source': source}))


def main() -> None:
    if len(sys.argv) >= 3 and sys.argv[1] == '--action':
        action = sys.argv[2]
        source = None
        if len(sys.argv) >= 5 and sys.argv[3] == '--source':
            source = sys.argv[4]
        handle_action(action, source)
        return

    local_env = load_local_env(CONFIG_PATHS)
    api_key = get_env('LASTFM_API_KEY', local_env)

    result: dict[str, Any] = {
        'updatedAt': utc_timestamp(),
        'playing': False,
        'source': None,
        'track': None,
    }

    spotify = get_spotify()
    kaset = get_kaset()

    # Priority: actively-playing Spotify → actively-playing Kaset →
    # whichever has a track (paused Spotify preferred, then paused Kaset).
    if spotify and spotify['track']['state'] == 'playing':
        chosen = spotify
    elif kaset and kaset['track']['state'] == 'playing':
        chosen = kaset
    elif spotify:
        chosen = spotify
    elif kaset:
        chosen = kaset
    else:
        chosen = None

    if chosen:
        track = chosen['track']
        # Enforce the fetch_genres "never break the payload" contract at the
        # call site: any unexpected error degrades to no genres, never an
        # error payload that hides the now-playing track.
        try:
            track['genres'] = fetch_genres(track.get('artist') or '', track.get('title') or '', api_key)
        except Exception:
            track['genres'] = []
        result.update(playing=True, **chosen)

    print(json.dumps(result))


if __name__ == '__main__':
    safe_main(main)
