# AGENTS.md

Guidance for Claude Code working in this repository.

## Project overview, commands, and configuration

See `README.md` for the project overview, build commands, and configuration reference.

The active theme is re-exported from `src/themes/_active.ts`; theme consumers read that pointer when they build.

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
| `aerospace/`, `scripts/dock-layout.mts`, workspace and dock-state layouts | README section "Window management" |
| `scripts/adguard-proxy.mts`, HTTPS exclusions, system proxy wiring, AdGuard filter lists | README section "Network filtering" |
| Widget build pipeline constraints (root `.jsx` small, ESM imports, backdrop-filter keepalive, cross-bundle state) | rule: `widget-build-invariants` (always loaded) |
