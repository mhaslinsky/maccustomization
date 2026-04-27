---
name: backend-fetchers
description: Author or debug Python backend fetchers for widgets. Use when editing llm_status_fetch.py / weather_fetch.py / calendar_fetch.py / nowplaying_fetch.py, adding a new *_fetch.py script, touching widget_helpers.py, adding env-var configuration, dealing with the nowplaying AppleScript / pgrep gotcha, or compiling / modifying calendar_eventkit.swift. SKIP for the TSX widget layer, theme tokens, or the JS/TS codegens under scripts/.
---

# Backend fetchers

Python scripts at repo root produce JSON on stdout that Übersicht pipes to the widget's `render` function.

## Existing scripts

- **`llm_status_fetch.py`** — aggregated LLM provider status. Claude and OpenAI via statuspage.io `/api/v2/summary.json`; Gemini via filtered Google Cloud `incidents.json` (ongoing incidents whose `affected_products` include "Gemini", severity mapped from `status_impact`). Each provider wrapped in `safe_provider` so a single upstream failure can't take out the other two. No config required.
- **`weather_fetch.py`** — Open-Meteo weather. Supports `--source` (env|geo detection) and `--geo LAT LON [LABEL]` (called by widget with device coords; reverse-geocodes via Nominatim if no label given). Location priority: env `LAT`/`LON` → `LOCATION_QUERY` → fallback default. Fetch is server-side to avoid browser CORS 429s.
- **`calendar_fetch.py`** — macOS calendar events; prefers compiled Swift binary `calendar_eventkit` over slow AppleScript fallback.
- **`calendar_eventkit.swift`** → compiled to `calendar_eventkit` binary for fast EventKit reads.
- **`nowplaying_fetch.py`** — current track from Spotify (AppleScript) and Kaset (YouTube Music wrapper, also AppleScript). Spotify takes priority when both are playing. Supports `--action playpause|next|previous --source spotify|youtube_music` for playback controls.

## Shared helpers (`widget_helpers.py`)

Use these in any new `*_fetch.py` script:

- `load_local_env(config_paths)`, `get_env(name, local_env)` — dotenv loading.
- `fetch_text(url, headers=None, timeout=20)`, `fetch_json(url, headers=None, timeout=20)` — HTTP with timeout.
- `utc_timestamp()` — ISO 8601 string with `Z` suffix.
- `safe_main(func)` — top-level wrapper that guarantees JSON output even on uncaught crashes. Always end `*_fetch.py` scripts with `if __name__ == '__main__': safe_main(main)`.

## Env-file config paths

Each Python fetcher that accepts config reads process env first, then merges from any matching dotenv file. Pattern: check `~/.config/<widget>-widget.env` and `<repo>/.<widget>-widget.env`.

## The NowPlaying `pgrep` gotcha (critical performance)

Process-running checks MUST use `pgrep -x <name>` (~1ms), NOT `tell application "System Events" to (name of processes) contains "X"` — the AppleScript form was measured at 1–3s per call (up to 20s cold) due to Apple Events / sandbox overhead. With the widget refreshing every 3s, Python processes stacked until the system crawled.

The pre-check also prevents `tell application "Spotify"` / `tell application "Kaset"` from silently *launching* those apps when they aren't running. Never run those `tell application` blocks without a pgrep gate.

Use `is_running(name)` from `nowplaying_fetch.py` rather than reimplementing.

## Symlink awareness

Widget commands reference `$HOME/Library/Application Support/Übersicht/widgets/...` as absolute paths. That directory is a symlink to `~/Developer/mac-customization` (the real repo). New `command` strings should follow the same convention so the Übersicht widgets-folder contract stays stable.
