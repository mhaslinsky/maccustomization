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
from typing import Any

from widget_helpers import load_local_env, utc_timestamp, safe_main

CONFIG_PATHS = [
    pathlib.Path.home() / '.config' / 'nowplaying-widget.env',
    pathlib.Path.home() / 'Library' / 'Application Support' / 'Übersicht' / 'widgets' / '.nowplaying-widget.env',
]

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

    # Touch config paths so env files are still discoverable in future.
    load_local_env(CONFIG_PATHS)

    result: dict[str, Any] = {
        'updatedAt': utc_timestamp(),
        'playing': False,
        'source': None,
        'track': None,
    }

    # Spotify first (if actively playing)
    spotify = get_spotify()
    if spotify and spotify['track']['state'] == 'playing':
        result.update(playing=True, **spotify)
        print(json.dumps(result))
        return

    # Kaset (YouTube Music) — prefer over paused Spotify
    kaset = get_kaset()
    if kaset and kaset['track']['state'] == 'playing':
        result.update(playing=True, **kaset)
        print(json.dumps(result))
        return

    # Neither is actively playing — show whichever has a track (Spotify paused or Kaset paused)
    if spotify:
        result.update(playing=True, **spotify)
    elif kaset:
        result.update(playing=True, **kaset)

    print(json.dumps(result))


if __name__ == '__main__':
    safe_main(main)
