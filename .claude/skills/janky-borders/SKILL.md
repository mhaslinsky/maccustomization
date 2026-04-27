---
name: janky-borders
description: Edit JankyBorders config or the borders codegen. Use when touching borders/bordersrc, modifying scripts/build-borders-config.mjs, adjusting window focus border color / width (primary.active, primary.inactive, primary.width), debugging the borders daemon hot-reload, setting up borders on a new machine (brew install + symlink), or deciding between primary.width vs layout.borderWidth. SKIP for widget-card borders (they use layout.borderWidth — see theme-authoring), menu bar (bartender-menu-bar), or Hammerspoon.
---

# JankyBorders integration

Window focus borders are rendered by [JankyBorders](https://github.com/FelixKratz/JankyBorders), a native Objective-C daemon that draws live borders around the focused window. It replaced an earlier Lua/Hammerspoon implementation that was perf-bound by the AX API + timer polling + NSWindow IPC pipeline. JankyBorders uses Core Graphics directly and is qualitatively faster.

## Files

- **`borders/bordersrc`** — **generated, do not edit by hand.** Regenerated on every `npm run build`. Bash script sourced by the `borders` daemon on startup and on reload. Exports an `options` array and calls `borders`.
- **`scripts/build-borders-config.mjs`** — the codegen. Same in-memory esbuild-bundle → data-URL → dynamic-import pattern as the other codegens. Converts theme `primary` CSS colors into JankyBorders' `0xAARRGGBB` hex format, then writes bash. If a `borders` daemon is running (detected via `pgrep -x borders`), hot-reloads it by re-sourcing `bordersrc` in a detached child process.
- **Skip-if-unchanged:** codegen byte-compares new vs existing `bordersrc` and skips both the write and daemon reload if identical.

## Theme mapping

`bordersrc` consumes three fields from `primary`:

- `primary.active` → `active_color` (window with focus)
- `primary.inactive` → `inactive_color` (unfocused windows)
- `primary.width` → `width` (stroke thickness in px)

`primary.width` is intentionally separate from `layout.borderWidth`:

- `primary.width` (px) — window-border thickness (5px default, 3px glass themes).
- `layout.borderWidth` (`"Npx"`) — widget card borders (+ Thaw's menu bar border) (2px default, 1px glass).

Window borders read differently at distance and look thin at 2px, so they get their own knob. `style=round` and `hidpi=on` are hard-coded in the codegen template since they're not design tokens.

## Install and daemon lifecycle

```sh
brew tap FelixKratz/formulae && brew install borders
brew services start felixkratz/formulae/borders   # restarts at login
```

The daemon reads config from `~/.config/borders/bordersrc`. To keep the repo as single source of truth, that path is a symlink to `<repo>/borders/bordersrc`. Set up once per machine:

```sh
mkdir -p ~/.config/borders
ln -sf "/Users/mhaslinsky/Developer/mac-customization/borders/bordersrc" ~/.config/borders/bordersrc
```

After that, every `npm run build` regenerates `bordersrc` in place and the codegen auto-reloads the running daemon. No manual steps.

## Why JankyBorders over a Hammerspoon implementation

The Lua approach polled `hs.window:frame()` on a timer, updated an `hs.canvas` position each tick, gated `hs.eventtap` for live drags, and fought macOS's WindowServer/CoreAnimation commit pipeline for 1-frame latency wins. JankyBorders sidesteps all of that by running as a native daemon hooked into the same private APIs macOS uses for its own window chrome.
