---
name: widget-authoring
description: Author or modify Übersicht widgets in this repo. Use when adding a new widget TSX file, editing an existing widget under src/*.tsx (Status, Weather, Calendar, NowPlaying, Clock), changing the widget flow stack order, wiring up the auto-layout (trackWidget / layoutWidgets / runFlowLayout), adding shared widget helpers, or touching src/widget_theme.ts / src/widget_helpers.tsx. SKIP for Python backends (see backend-fetchers), theme design tokens (see theme-authoring), or the codegens under scripts/.
---

# Widget authoring

## Widget contract

Each widget in `src/*.tsx` (not `widget_` prefixed) exports:

- `command` — shell string or dispatch function. Ran by Übersicht on each tick; stdout is passed to `render` as `output`.
- `refreshFrequency` — ms. See the `performance-tuning` skill before tweaking.
- `className` — full CSS string. Build with `buildWidgetClassName({ ...STACK.<key>, accent: "<key>" })`.
- `render({ output, error })` — React component. Wrap the returned tree in `<div ref={trackWidget("<key>", layoutWidgets)}>` so the wrapper gets registered in the flow-layout registry.

The build script `scripts/build-widgets.mjs` validates these four exports and fails the build if any are missing.

## Shared TSX helpers (`src/widget_helpers.tsx`)

Use these instead of recreating per-widget logic:

- `parseOutput<T>(output)` — JSON parse with `{parseError, raw}` fallback.
- `renderError(title, error)`, `renderLoading(title)`, `renderParseError(title, parseError)` — transient states; render plain `<h1>{title}</h1>` (icons intentionally skipped so error output is theme-agnostic).
- `fmtLocalTime(iso)` — format UTC ISO timestamp to device-local time.
- `RenderProps` interface.
- `trackWidget(key, onChange)` — ref callback that registers the Übersicht widget wrapper (via `el.parentElement`) in `window.__ubWidgetWrappers` and fires `onChange` on mount + on every size change via `ResizeObserver`. Deduped per-wrapper.
- `runFlowLayout(order, gap, topAnchor)` — top-down layout pass that walks an ordered key list and sets inline `top` on each non-anchor wrapper from a running `y` cursor. Inline styles win over the class-generated `top`.
- `debounceRaf(fn)` — coalesces rapid repeated calls into one per animation frame.

## Shared theme façade (`src/widget_theme.ts`)

A thin re-export layer: owns `STACK` (per-widget initial fallback `top`/`zIndex`), `FLOW_ORDER` / `FLOW_GAP` / `FLOW_TOP` for the auto-flow stack, `buildWidgetClassName()` (full CSS string), and `layoutWidgets()` (synchronous flow trigger). Re-exports the swappable look tokens (`accents`, `icons`, `layout`, `status`, `primary`) from `src/themes/_active.ts`.

## Auto-flow layout mechanics

Status, Weather, Calendar, and Now Playing render as a vertical stack on the left side of the screen. `STACK.*.top` values are **initial fallbacks** used before JS measures heights. The authoritative positions come from `runFlowLayout`, which walks `FLOW_ORDER = ["status", "weather", "calendar", "nowplaying"]` top-down, reads each wrapper's actual `getBoundingClientRect().height`, and sets an inline `top` on each subsequent widget using a running `y` cursor + `FLOW_GAP` (16px).

**Why JS-based layout over CSS custom properties + `calc()`:** CSS vars only observe *size* changes via ResizeObserver — *position* changes (when an upstream widget's `calc()` re-resolves) don't fire any observer, and downstream widgets go stale. The JS approach re-measures everything on every trigger, so load-order and resize-order don't matter.

## The Clock exception

Clock bypasses `buildWidgetClassName` entirely and writes its `className` as raw CSS for centered absolute positioning. It is NOT part of `FLOW_ORDER`, has no `trackWidget` wrapper, and its `command` is just `date` (to drive re-renders — `render` calls `new Date()` directly, no Python backend).

## Data flow patterns

Übersicht calls `command` on the refresh interval → stdout → parsed in `render`. Two variations:

- **Weather** uses Übersicht's `run()` from `"uebersicht"` with a dispatch pattern. Calls `weather_fetch.py --source` to detect env-vs-geolocation source; if `geo`, calls `geolocation.getCurrentPosition()` then `weather_fetch.py --geo LAT LON` so the Open-Meteo fetch happens server-side (browser-side fetches hit CORS 429).
- **Now Playing** has playback buttons whose `onClick` handlers call `run('nowplaying_fetch.py --action playpause|next|previous --source spotify|youtube_music')`.

Übersicht wraps geolocation results as `{position: {coords: {latitude, longitude}}}` (one level deeper than W3C Geolocation API — see `globals.d.ts`).

## Per-widget style overrides

`buildWidgetClassName` accepts `append` (raw CSS appended after the standard rules). Use it for widget-specific overrides — Status uses it to drop body `font-size` to 11px (5-row provider list at 220px width wraps long descriptions like "Partially Degraded Service" at the default 12px) and to style `<a>` so links inherit the `.good`/`.warn`/`.bad` pill color with underline-on-hover. Source order beats specificity: anything in `append` overrides the equivalent rule from the shared template. Reach for `append` before forking `buildWidgetClassName` itself.

## Outbound links

Widget render output supports plain `<a href>` — Übersicht's WebView opens links in the user's default browser. Status uses this on its provider rows: when an indicator is non-operational, the description is wrapped in `<a href={p.url}>` (URL emitted by `status_fetch.py`) so the user can click through to the upstream dashboard. Style links with `color: inherit` to preserve pill colors and `text-decoration: none` (with `:hover` underline) so the row reads as text until hovered.

## Adding a new widget

1. Drop `src/<Name>.tsx` — the build auto-discovers it.
2. Add an entry to `STACK` in `src/widget_theme.ts` and, if it should be in the stack, append its key to `FLOW_ORDER`.
3. Add a new `WidgetAccent` key in `src/themes/_types.ts` — see the `theme-authoring` skill for the full theme-field checklist.
4. Add a backend script under repo root if needed — see the `backend-fetchers` skill.
5. Run `npm run build` and `npm run typecheck`. Reload widgets in Übersicht.
