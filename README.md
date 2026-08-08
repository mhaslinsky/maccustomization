# Mac desktop customization

A single-source-of-truth theming stack for a Mac desktop. One TypeScript theme file drives the look of every layer at once — desktop widgets, window focus borders, menu bar, terminal, Slack, Obsidian, and the Hammerspoon scripting runtime — so `npm run theme <name>` re-skins the whole desktop in one pass.

## What's in here

**Übersicht widgets** (`src/*.tsx` → root `*.jsx`) — Five widgets for [Übersicht](https://github.com/felixhageloh/uebersicht), rendered as React-style JSX inside its WebView:

- **Status** — Claude / OpenAI / Gemini / GitHub / Jira public status feeds, aggregated into one pill list
- **Weather** — Open-Meteo, fixed coords or Mac geolocation
- **Calendar** — macOS Calendar via a Swift EventKit helper
- **Now Playing** — Spotify + [Kaset](https://kaset.app/) via AppleScript, with playback controls
- **Clock** — centered on screen

The first four auto-flow as a vertical column on the left — heights are measured at runtime, so adding/removing lines in one widget reflows the whole stack without hand-tuning `top` values.

**System codegens** (`scripts/build-*.mjs`) — small Node scripts that read the active theme and emit native config for other Mac tools, so they share the widgets' colors and accents:

- **[Hammerspoon](https://www.hammerspoon.org/)** (`hammerspoon/`) — emits `uber_theme.lua` consumed by `init.lua`
- **[JankyBorders](https://github.com/FelixKratz/JankyBorders)** (`borders/bordersrc`) — focused/unfocused window border colors and width
- **[Bartender 6](https://www.macbartender.com/)** — overrides Bartender's `stored_style` plist to brand the menu bar background and border
- **[Warp](https://www.warp.dev/) terminal** — writes `~/.warp/themes/uber-<theme>.yaml` (one file per theme; ANSI palette, accent, selection, cursor) and updates Warp's `defaults` so its active selection points at the new file
- **[Slack](https://slack.com/)** — two paths, layered:
  - **Sidebar legacy theme string** (`build:slack`, standalone) — copies the 10-color theme string to your clipboard for paste into Preferences → Themes → "Paste your legacy theme colors". Quick, official, but only paints the workspace switcher rail + active highlight; nothing else.
  - **Full CSS injection** via app.asar patch (`sudo -E node scripts/patch-slack-app.mjs` + `npm run build:slack-css`) — patches Slack.app's renderer preload to load `~/.config/slack-uber-theme/theme.css` at startup. Theme switches just regenerate the CSS file (chained into `npm run build`); a fresh patch run is only needed once after each Slack auto-update. Unsupported by Slack, requires App Management for the terminal + Slack moved to `~/Applications/`, and breaks every Slack auto-update — see `.claude/skills/slack-theme/SKILL.md` for the full caveats and recovery via the `--restore` flag
- **[Obsidian](https://obsidian.md/)** — emits a per-vault CSS snippet at `<vault>/.obsidian/snippets/uber-theme.css` and enables it in `appearance.json`. Auto-discovers vaults from Obsidian's registry (`~/Library/Application Support/obsidian/obsidian.json`) so opening a new vault picks it up on the next build; no per-vault config. Composes with whatever main theme the user has selected (Default / AnuPpuccin / Catppuccin / etc.) by overriding Obsidian's CSS variables and applying glass-surface treatment for translucent themes. Requires Settings → Appearance → "Translucent window" toggled on for the wallpaper-bleed-through to work
- **[Thaw](https://github.com/stonerl/Thaw)** (Ice fork) — deprecated 2026-04-24 in favor of Bartender; codegen kept as a manual-invoke fallback

**Python backends** (`*_fetch.py`) — invoked by widgets on their own refresh cadence and write JSON to stdout. A small compiled Swift helper (`calendar_eventkit`, built from `calendar_eventkit.swift`) speeds up calendar reads.

## How the pieces connect

```
src/themes/<name>.ts                  one file per theme
        │
        └─ src/themes/_active.ts      single re-export pointer
                  │
                  ├─ build:widgets     → root *.jsx (Übersicht widgets)
                  ├─ build:hammerspoon → hammerspoon/uber_theme.lua
                  ├─ build:borders     → borders/bordersrc
                  ├─ build:bartender   → Bartender stored_style plist
                  ├─ build:warp        → ~/.warp/themes/uber-<theme>.yaml + Warp prefs
                  ├─ build:slack       → 10-color legacy string → clipboard (manual paste)
                  ├─ build:slack-css   → ~/.config/slack-uber-theme/theme.css
                  │                       (consumed by the patched Slack preload;
                  │                       run `sudo -E node scripts/patch-slack-app.mjs`
                  │                       once to install the patch)
                  ├─ build:obsidian    → <vault>/.obsidian/snippets/uber-theme.css
                  │                       (one snippet per registered vault;
                  │                       auto-enabled in appearance.json)
                  └─ build:thaw        → (deprecated) Ice menu bar plist
```

Every consumer reads through `src/themes/_active.ts`. `npm run theme <name>` rewrites that one re-export and reruns every codegen, so widgets, window borders, menu bar, terminal, Hammerspoon, Slack, and Obsidian all change in the same build.

See `AGENTS.md` for architecture invariants (root `.jsx` size limits, ESM-not-bundled imports, the backdrop-filter keepalive animation, cross-bundle `window`-global state).

## Edit and build

Widget **source** lives in TypeScript under `src/`. Übersicht loads the compiled **`*.jsx` files in this folder** (same directory as this README).

1. Install dev tooling once: `npm install`
2. After changing anything under `src/` (widgets, theme files, shared helpers), run **`npm run build`**
3. Reload widgets in Übersicht (menubar → Refresh All Widgets, or restart the app)

Optional: **`npm run typecheck`** runs `tsc --noEmit` only.

`npm run build` runs seven sister scripts in order: `build:widgets` → `build:hammerspoon` → `build:borders` → `build:bartender` → `build:warp` → `build:slack-css` → `build:obsidian`. They're also available individually if you only need one target (handy when tuning colors; e.g., theme tweaks that only affect widgets can just run `build:widgets`). `build:slack` (the legacy 10-color sidebar string codegen, clipboard-only, manual paste) and `build:thaw` are not part of the default chain; both still exist as manual-invoke targets. See `AGENTS.md` and the `slack-theme` / `thaw-menu-bar` skill docs for context.

The widget build (`scripts/build-widgets.mjs`) uses esbuild to **transpile** (not bundle) each source file — TypeScript and JSX are converted but imports are left intact. It produces:

- `src/widget_theme.js`, `src/widget_helpers.js` — compiled shared modules.
- `src/themes/*.js` — compiled theme files (one per theme) plus the `_active.js` pointer that widgets resolve through at runtime.
- `Status.jsx`, `Weather.jsx`, `Calendar.jsx`, `NowPlaying.jsx`, `Clock.jsx` at the repo root — small files that import from `./src/widget_theme.js`.

Übersicht’s own Browserify + Babelify pipeline resolves the imports at runtime and bundles everything for its WebView. Keeping the root files small is important: Übersicht’s embedded Babel can silently fail on large pre-bundled files. Every root file also gets a leading `// active-theme: <name> (<digest>)` comment that changes whenever the theme or the shared module graph changes, which busts Übersicht's bundle cache on code edits.

## Themes

Design tokens live as one TypeScript file per theme in `src/themes/`. The currently-active theme is whatever `src/themes/_active.ts` re-exports; every consumer (widgets, Hammerspoon, JankyBorders, Bartender, Warp, Slack, Obsidian) reads through that pointer.

- **`npm run theme`** — lists all themes, marks the current one with `*`.
- **`npm run theme <name>`** — switches the active theme and rebuilds everything. Widgets re-render, JankyBorders hot-reloads, Bartender quits and relaunches to pick up the new style, the Warp YAML is refreshed, the Slack CSS injection file is regenerated (live in any open Slack window if the asar patch is installed), and each registered Obsidian vault's snippet is rewritten + hot-reloaded.
- **Add a new theme**: copy `src/themes/default.ts` to `src/themes/<name>.ts`, tweak the values (the type checker enforces shape parity), then `npm run theme <name>`. See `AGENTS.md` for the full field reference.

Themes currently in the repo: **default** (cyan/amber/green/purple accents on a dark translucent card, baseline), **liquid-glass** (iOS Tahoe light frosted), **liquid-glass-dark** (Control Center smoked variant), **catppuccin-macchiato** (Catppuccin Macchiato palette with pastel Sky/Peach/Green/Mauve accents, Inter UI font, and Nerd Font glyphs in widget titles), **frutiger-aero** (2004-era Web 2.0 Gloss — sky-blue Aero glass card, glossy greens, warm sun yellows, bright and optimistic).

### Icons (optional per-theme)

The `Theme` contract includes an optional `icons` map — a per-widget string of glyphs prepended to each widget's `h1` title. Themes that provide icons should also append a Nerd Font family to the end of their `layout.fontStack` (as a tail fallback below the primary UI font); the browser's per-character font fallback keeps Latin text in the UI font and pulls only Private Use Area codepoints from the Nerd Font. Themes that ship an empty `icons: {}` render their h1s as plain text — the pre-existing behavior. `catppuccin-macchiato.ts` is the current example and assumes a Nerd Font is already installed (on the authoring machine, `Hack Nerd Font`; `brew install --cask font-symbols-only-nerd-font` is the canonical icons-only alternative).

## Troubleshooting (widgets missing or errors)

1. **Run the build** from this directory: `npm run build`. Übersicht only reads the root `*.jsx` files; if you edit `src/*.tsx` and skip the build, widgets can be stale or broken.
2. **Remove stray theme files at the repo root** if you still have them: `widget_theme.jsx` or `widget_theme.js`. The build script deletes them on purpose. If they exist, Übersicht may list them as separate widgets and show parse errors that look like “nothing works.”
3. **Widget folder in Übersicht** must be `~/Library/Application Support/Übersicht/widgets` (or your equivalent — check **Übersicht → Preferences / Settings**). In this setup that path is a symlink to the real repo location at `~/Developer/mac-customization`, so both paths refer to the same files.
4. **Refresh**: **Übersicht → Refresh All Widgets** (or restart the app).
5. **Hidden widgets**: from Script Editor or shortcuts, a widget’s `hidden` flag can be true — see [Übersicht README — Scripting](https://github.com/felixhageloh/uebersicht/blob/master/README.md#scripting-support).
6. **Debug**: use Übersicht’s widget/debug or console (varies by version) if a widget shows a red error line; fix the reported file/line, then rebuild.
7. **Large file / Babel error** — if the whole screen fills with a dark block of tiny text, Übersicht's Babel has choked on the widget file. Run `npm run build` to regenerate clean transpile-only output, then refresh.

## Layout and design

- **`src/themes/<theme>.ts`** — per-theme design tokens: `accents` (per-widget colors), `layout` (typography/spacing/blur/shadow), `status` (good/warn/bad palette), `primary` (cross-program brand accent — drives JankyBorders' active/inactive window border colors and width, plus Bartender's menu bar border stroke), `menuBarTint` (dedicated accent for Bartender's menu bar gradient edge and Warp's terminal accent; retained in the theme contract because Ice caps main-bar tint at 20% alpha in the deprecated Thaw codegen, and translucent accents like liquid-glass's white vanish there — it also happens to be the right saturated color to hand Bartender for its gradient edge and Warp for its cursor), and `icons` (optional per-widget glyphs rendered in each widget's h1 title — typically Nerd Font codepoints paired with a Nerd Font tail fallback in `layout.fontStack`).
- **`src/themes/_types.ts`** — shared `Theme` type contract every theme file must satisfy.
- **`src/widget_theme.ts`** — thin façade that owns widget-structural bits (`STACK` fallback positions, `FLOW_ORDER` stack order, the `buildWidgetClassName()` CSS builder, and the `layoutWidgets()` auto-flow trigger) and re-exports the swappable tokens from the active theme.
- **`globals.d.ts`** / **`uebersicht.d.ts`** — ambient types for the widget runtime (`geolocation`, `import { run } from "uebersicht"`, etc.).

**Auto-flow stack:** Status, Weather, Calendar, and Now Playing are rendered as a vertical auto-flowing column on the left. Each widget's render output is wrapped in a `trackWidget` ref that registers the widget's Übersicht wrapper in a **shared `window`-global registry** (necessary because Übersicht bundles each widget independently via Browserify — module-scoped state is per-bundle, not shared); a single `runFlowLayout` function then measures each wrapper top-down and sets the next widget's inline `top`. This means you never hand-tune `top` values — adding a line of status text to Claude automatically pushes Weather down, which pushes Calendar, etc. The ordered sequence, the gap between widgets, and the anchor top live in `FLOW_ORDER` / `FLOW_GAP` / `FLOW_TOP` in `src/widget_theme.ts`. The Clock widget is centered on screen and not part of the stack.

## Backend scripts

| Script | Used by | Refresh |
|--------|---------|---------|
| `status_fetch.py` | Status (Claude / OpenAI / Gemini / GitHub / Jira) | 2 min — kept deliberately responsive for outage warning |
| `weather_fetch.py` | Weather (Open-Meteo, env / geo) | 10 min |
| `calendar_fetch.py` | Calendar (prefers EventKit helper when present) | 5 min |
| `calendar_eventkit` (built from `calendar_eventkit.swift`) | Fast calendar reads for `calendar_fetch.py` | (N/A — invoked per calendar fetch) |
| `nowplaying_fetch.py` | Now Playing (Spotify + Kaset via AppleScript; supports playback controls) | 10 s |
| *(built-in)* Clock widget | Clock | 30 s |

**NowPlaying pre-check:** `nowplaying_fetch.py` uses a `pgrep -x` process-existence check before running any `tell application "Spotify"` / `tell application "Kaset"` AppleScript. Don't replace this with `tell "System Events" to (name of processes) contains "X"` — that call was measured at 1–3s per invocation on macOS (up to 20s cold) and caused Python processes to stack when NowPlaying refreshed every 3s. `pgrep` is ~1ms and also prevents AppleScript from silently launching the target app if it isn't running.

Commands in the widgets reference `"$HOME/Library/Application Support/Übersicht/widgets/..."`. That's Übersicht's widgets folder — here it's a symlink to this repo's actual location (`~/Developer/mac-customization`). Adjust paths if your widgets directory differs.

## Configuration (environment)

Each Python fetcher reads variables from **the process environment first**, then from an optional **env file** (same `KEY=value` lines, `#` comments allowed). Use either mechanism.

| Widget | Env file paths (first match wins) |
|--------|-----------------------------------|
| Weather | `~/.config/weather-widget.env`, `widgets/.weather-widget.env` |
| Calendar | `~/.config/calendar-widget.env`, `widgets/.calendar-widget.env` |

(`widgets/` here means the Übersicht widgets directory — `~/Library/Application Support/Übersicht/widgets/`, which is a symlink to `~/Developer/mac-customization/`.)

### Hammerspoon Discord mute (`hammerspoon/discord_ptt.lua`)

Exposes `http://<mac>:8722/dm/<token>` so a phone shortcut or Home Assistant button can toggle the Discord mic. The token is a per-machine shared secret and this repo is public, so it lives in a gitignored file rather than in the source:

```lua
-- hammerspoon/discord_ptt_secret.lua
return "some-long-random-string"
```

Without that file the HTTP endpoint does not start and Hammerspoon says so on load. The ⌃⌥⌘D hotkey and the ⌃⌥⌘P thumb-button toggle work either way.

### Weather (`weather_fetch.py`)

| Variable | Purpose |
|----------|---------|
| `LAT` / `LON` | Fixed coordinates (decimal degrees). Highest priority when both are set. |
| `LOCATION_LABEL` | Optional display name when using fixed `LAT`/`LON`. |
| `LOCATION_QUERY` | Place search (e.g. `Buffalo, NY`) via Open-Meteo geocoding. Used when lat/lon are not set. |

**Priority:** `LAT`+`LON` → `LOCATION_QUERY` → Übersicht **geolocation** (Mac Location Services) when the widget requests it → built-in default coordinates for US `19444` if nothing else applies.

Run `python3 weather_fetch.py --source` to print whether the current run used `env` vs `geo`.

### Calendar (`calendar_fetch.py`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CALENDAR_EVENING_HOUR` | `20` | Before this hour (0–23), the widget focuses **today**; from this hour on, it focuses **tomorrow**. |
| `CALENDAR_FILTER` | *(empty)* | If set, only events whose **calendar name** contains this substring (case-insensitive) are shown. Empty = all calendars. |
| `CALENDAR_MAX_EVENTS` | `20` | Max events after filtering and deduplication (clamped 1–50). |

### Status (`status_fetch.py`)

No configuration needed. Fetches five public status feeds in parallel:

- [Claude](https://status.claude.com) — statuspage.io `summary.json`
- [OpenAI](https://status.openai.com) — statuspage.io `summary.json`
- [Gemini](https://status.cloud.google.com) — Google Cloud `incidents.json`, filtered to ongoing incidents whose `affected_products` include "Gemini". Operational otherwise.
- [GitHub](https://www.githubstatus.com) — statuspage.io `summary.json`
- [Jira](https://jira-software.status.atlassian.com) — statuspage.io `summary.json`

When a provider reports a non-operational indicator, the description renders as a click-through link to that provider's public dashboard. Operational rows stay plain text.

## Requirements

- Übersicht
- Node.js (for `npm run build` / `typecheck`)
- Python 3 for the `*_fetch.py` scripts
- Calendar: macOS Calendar access for Übersicht when using EventKit; build `calendar_eventkit` with Swift if you use that path
