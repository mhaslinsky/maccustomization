---
name: warp-terminal
description: Edit the Warp terminal theme codegen or tune Warp's runtime settings. Use when touching scripts/build-warp-theme.mjs, debugging why ~/.warp/themes/uber-*.yaml doesn't match the theme, adjusting the ANSI palette mapping, updating Warp's transparency / blur defaults, or switching which theme Warp picks up. SKIP for widgets, window borders, menu bar, or Hammerspoon work.
---

# Warp terminal integration

The [Warp](https://www.warp.dev/) terminal theme is generated from the active widget theme, keeping the terminal palette in sync with the rest of the desktop.

## Files

- **`scripts/build-warp-theme.mjs`** — codegen. Same esbuild-bundle → data-URL → dynamic-import pattern as the others. Converts CSS `rgba()` tokens to flat `#RRGGBB` hex by compositing against the background color (Warp's ANSI palette has no alpha support).
- **`~/.warp/themes/uber-<theme>.yaml`** — external state. One file per theme name, regenerated on every `npm run build`.

## Theme → Warp mapping

| Warp field | Source |
|---|---|
| `background` | `layout.cardBg` composited onto black |
| `foreground` | `accents.llm.text` |
| `accent` / `cursor` | `menuBarTint` (always saturated — avoids the gray-out that `primary.active` causes in glass themes where the border is white) |
| `selection` | `menuBarTint` at 25% alpha over bg |
| ANSI red | `status.bad` |
| ANSI green | `status.good` |
| ANSI yellow | `accents.weather.h1` |
| ANSI blue | `accents.llm.border` (composited) |
| ANSI magenta | `accents.nowplaying.h1` |
| ANSI cyan | `accents.llm.h1` |
| ANSI black | background color |
| ANSI white | foreground color |

Bright variants are each normal color pushed ~20% toward white. `details` is auto-detected as `"darker"` or `"lighter"` based on background luminance.

## Activation

The codegen writes the YAML but can't programmatically switch Warp's active theme. After the first `npm run build`, open Warp → Settings → Appearance → Themes and select the `Uber <Theme>` entry. Subsequent builds update YAML in place and Warp picks up color changes on its next render cycle (no restart needed for existing themes; a new theme name requires reopening the theme picker).

## Skip-if-unchanged

Reads the existing YAML before writing and skips if byte-identical, so repeat builds are silent.

## Warp runtime settings (not code)

Applied via `defaults write dev.warp.Warp-Stable` + restart:

- `OverrideOpacity = 78` — translucent window so the wallpaper shows through, matching the frosted-glass widgets. Lower values = more see-through.
- `OverrideBlur = 64` — backdrop blur strength.

```sh
defaults write dev.warp.Warp-Stable OverrideOpacity -integer 78
defaults write dev.warp.Warp-Stable OverrideBlur -integer 64
```
