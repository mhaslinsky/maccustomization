---
name: performance-tuning
description: Audit or change refresh frequencies, layout cadence, or other perf-sensitive settings in this stack. Use when tweaking any widget's refreshFrequency, benchmarking the Python backends, considering whether to rAF-debounce runFlowLayout, deciding on Thaw runtime intervals (ShowOnHover / IconRefreshInterval), or asking why the backdrop-filter animation runs 60fps. SKIP for pure feature work — these are preservation / rationale notes for tuned values.
---

# Performance tuning notes

The widgets + Mac customization stack runs continuously, so small per-tick wastes add up. These values are tuned — don't casually revert.

## Widget refresh frequencies

Defined in `src/<Widget>.tsx` as `refreshFrequency` (ms).

| Widget | Value | Rationale |
|---|---|---|
| Status | `120000` (2 min) | **Stays at 2 min** — user wants early warning on Claude / OpenAI / Gemini / GitHub / Jira outages. Do not bump during perf sweeps. If CPU from the 5 sequential HTTP calls in `status_fetch.py` becomes a problem, parallelize them with `concurrent.futures.ThreadPoolExecutor` instead. |
| Calendar | `300000` (5 min) | Events rarely change within 5 min; `calendar_eventkit` is already fast (~9ms native). |
| Weather | `600000` (10 min) | Weather data lags weather; 10 min is fine. |
| NowPlaying | `10000` (10 s) | Was 3000ms, which stacked Python processes when combined with the slow `tell "System Events"` check (since replaced with `pgrep`). 10s is responsive enough for passive display; play/pause buttons dispatch directly and don't wait for the tick. |
| Clock | `30000` (30 s) | Clock only renders HH:MM (no seconds); 30s keeps display accurate to within half a minute. |

## Thaw runtime settings (deprecated but documented)

External state in `~/Library/Preferences/com.stonerl.Thaw.plist`, applied via `defaults write`. See the `thaw-menu-bar` skill for full context and the apply command.

- `ShowOnHover = false` — otherwise installs a system-wide mouse-move event tap (~24 callbacks/sec on modern trackpads).
- `ShowOnScroll = false` — installs a global scroll wheel monitor.
- `IconRefreshInterval = 2.0` — only ticks when the IceBar popup is visible; default `0.5` polls 4× more than needed.

`ShowOnClick = true` (click-to-reveal) still works with all three disabled.

## Synchronous layout calls (not rAF-debounced)

`layoutWidgets` runs synchronously, NOT via `requestAnimationFrame`. Übersicht's desktop-layer WebView can deprioritize or skip rAF entirely as a background window, so an rAF-gated layout silently never fires. Each ResizeObserver callback triggers a full top-down `runFlowLayout` pass (up to 4 `getBoundingClientRect` calls). Acceptable because widgets refresh on the order of seconds to minutes, not 60fps — callback density is low.

## Backdrop-filter keepalive animation (60fps, filtered widgets only)

Runs at 60fps on widgets whose active theme enables backdrop filtering, defeating WebKit's compositor caching of static backdrop-filter paint layers. Removing only the animation causes the blur to freeze after first paint; `will-change: backdrop-filter` and a `::before` pseudo-element did not fix that behavior. Near-opaque themes can set `layout.backdropFilterEnabled` to `false`, which removes both the filters and their keepalive. Preserve the paired filter-plus-animation behavior for translucent glass themes.
