# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Desktop widgets for [Übersicht](https://github.com/felixhageloh/uebersicht) — five widgets (Status, Weather, Calendar, Now Playing, Clock) rendered as React JSX inside Übersicht's WebView. Status aggregates Claude / OpenAI / Gemini / GitHub / Jira status feeds into a single pill list. Most data comes from Python backend scripts; the frontend is TypeScript/TSX transpiled to JSX.

The repo also hosts other Mac customization code driven by the same design tokens: **Hammerspoon** config under `hammerspoon/`, **JankyBorders** config under `borders/`, a **Bartender** menu bar style codegen, a **Thaw** (Ice fork) menu bar codegen — reactivated 2026-05-27 on Thaw 2.0 beta (after Bartender 6 proved unstable on Tahoe), manual-only, drives full bar appearance incl. glass background — a **Warp** terminal theme codegen, a deprecated **Slack** CSS-injection codegen (deprecated 2026-05-12 — the asar-patch path was never reliable; the legacy `build:slack` sidebar string remains as a standalone manual option), an **Obsidian** CSS snippet codegen, and a flat-color-only **Spicetify** (Spotify) theme codegen.

Design tokens live in `src/themes/`. The currently-active theme is re-exported through `src/themes/_active.ts`; every consumer (widgets, Hammerspoon, JankyBorders, Bartender, Warp, Obsidian, Spicetify) reads through that single pointer, so switching themes changes the look everywhere on the next `npm run build`.

## Commands

- **`npm run build`** — runs `build:widgets` → `validate:controls` → `build:hammerspoon` → `build:borders` → `build:bartender` → `build:warp` → `build:obsidian` → `build:spicetify` in sequence. (`build:thaw` is manual-only — not chained while the Thaw 2.0 beta stabilizes; run `npm run build:widgets && npm run build:thaw` so it reads fresh compiled themes. `build:slack-css` is deprecated; `build:slack` was always standalone.)
- **`npm run build:<target>`** — `widgets`, `hammerspoon`, `borders`, `bartender`, `warp`, `obsidian`, `spicetify`, `slack`, `slack-css`, or `thaw`. Use when iterating on one codegen.
- **`npm run theme`** — list themes + show current.
- **`npm run theme <name>`** — switch active theme + rebuild everything.
- **`npm run typecheck`** — `tsc --noEmit`. No test suite; `npm test` is a placeholder.

## Working in this repo

Detailed guidance lives in `.claude/rules/` (always-on constraints) and `.claude/skills/` (intent-triggered playbooks). When a skill matches, its body loads automatically — don't duplicate what's already in those files here. The table below is a pointer, not a summary:

| Touching… | Look at |
|---|---|
| Widget TSX (`src/*.tsx`), flow layout, shared TSX helpers | skill: `widget-authoring` |
| `src/themes/*`, theme tokens, icons, `_active.ts`, Nerd Font setup | skill: `theme-authoring` |
| `*_fetch.py` backends, `widget_helpers.py`, `calendar_eventkit.swift` | skill: `backend-fetchers` |
| `hammerspoon/`, `scripts/build-hammerspoon-theme.mjs`, adding a new codegen consumer | skill: `hammerspoon-config` |
| `borders/`, `scripts/build-borders-config.mjs`, window-border colors/width | skill: `janky-borders` |
| Bartender menu bar style, `scripts/build-bartender-theme.mjs`, `stored_style` plist | skill: `bartender-menu-bar` |
| Thaw codegen (reactivated, manual-only), `controls.thaw` glass/tint knobs, V2 colorSpace swap | skill: `thaw-menu-bar` |
| Warp YAML codegen, ANSI palette mapping, Warp opacity/blur | skill: `warp-terminal` |
| Slack codegens (deprecated CSS injection + asar patch; legacy sidebar string) | skill: `slack-theme` |
| Obsidian CSS snippet codegen, vault auto-discovery, glass surface treatment | skill: `obsidian-theme` |
| Spicetify (Spotify) flat color-only codegen, `color.ini` mapping, `config-xpui.ini` patch, why no glass | skill: `spicetify-flat-theme` |
| Refresh frequencies, layout cadence, perf rationale | skill: `performance-tuning` |
| Widget build pipeline constraints (root `.jsx` small, ESM imports, backdrop-filter keepalive, cross-bundle state) | rule: `widget-build-invariants` (always loaded) |

## Configuration

Python fetchers read env vars from the process environment or dotenv files (`~/.config/<widget>-widget.env` or `<repo>/.<widget>-widget.env`). See README.md for the per-variable reference.
