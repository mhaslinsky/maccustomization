---
name: hammerspoon-config
description: Edit Hammerspoon config or the theme-to-Lua codegen. Use when touching hammerspoon/init.lua, regenerating hammerspoon/uber_theme.lua, modifying scripts/build-hammerspoon-theme.mjs, exposing a new theme token to Lua, or adding a brand-new Mac customization tool (SketchyBar / AeroSpace / skhd / etc.) that needs to consume the active theme via a codegen. SKIP for window borders (janky-borders), menu bar (bartender-menu-bar / thaw-menu-bar), or terminal (warp-terminal).
---

# Hammerspoon integration

Hammerspoon config is version-controlled in `hammerspoon/` inside this repo. `~/.hammerspoon/init.lua` is a one-line `dofile` stub pointing at the repo — the only thing that lives outside.

## Files

- **`hammerspoon/init.lua`** — hand-written scaffolding (hotkeys, automations, focus dim, workspace indicators). Currently just bootstrap: loads `uber_theme` as a codegen health check and wires up an auto-reload pathwatcher on `.lua` changes. Window borders used to live here but were moved to JankyBorders — see `janky-borders` skill.
- **`hammerspoon/uber_theme.lua`** — **generated, do not edit by hand.** Regenerated on every `npm run build`. Contains portable tokens from the active theme (accent colors, status palette, `width`/`radius`/`borderWidth`/`cardBg`/`fontFamily`). CSS-only fields (`padding`, `h2Margin`, `shadow`, `blur`, `buildWidgetClassName`) are intentionally dropped — `hs.canvas` has no equivalent.
- **`scripts/build-hammerspoon-theme.mjs`** — the codegen.

## Bundling trick (used by every codegen)

The codegen uses `esbuild.build` with `bundle: true, write: false` so the re-export chain `_active → <theme>` collapses into one self-contained ESM module. A base64 `data:` URL dynamic import then yields `{ accents, layout, status, primary }` directly — no codegen hook, no patched source, no temp files.

## Color conversion

CSS hex and `rgba(...)` strings are converted to Hammerspoon canvas format (`{ red=0..1, green=0..1, blue=0..1, alpha=0..1 }`) at codegen time. The generated Lua is plain native tables — zero parsing at HS load.

## Exposing a new token

Fields are **explicitly whitelisted, not reflected**, so new theme fields are inert until opted in. Add a line to the appropriate `emit*` function in `scripts/build-hammerspoon-theme.mjs` (e.g. `emitAccents` uses `accentColorFields = ["border", "text", "h1", "h2Muted", "smallMuted"]`; `emitLayout` hand-picks layout fields).

## Adding a brand-new Mac customization tool

When wiring another tool (SketchyBar, AeroSpace, skhd, etc.) to consume the active theme, add a sister `scripts/build-<tool>-theme.mjs` following the same pattern: in-memory esbuild bundle → base64 `data:` URL → dynamic import → read `accents` / `layout` / `status` / `primary` / `menuBarTint` → emit the tool's native format. Chain it into the `build` script in `package.json`. Don't hand-maintain per-tool theme files; don't introduce intermediate JSON.

Good references:
- `scripts/build-bartender-theme.mjs` — active NSData-blob-in-plist surgery (skip-if-unchanged, pre-codegen backup, graceful quit via AppleScript bundle ID).
- `scripts/build-borders-config.mjs` — emits a config file + hot-reloads a running daemon.
- `scripts/build-thaw-theme.mjs` — deprecated but intact; more complex archived-NSColor-preserving variant.
