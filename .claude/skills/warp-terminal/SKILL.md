---
name: warp-terminal
description: Edit the Warp terminal theme codegen or tune Warp's runtime settings. Use when touching scripts/build-warp-theme.mjs, debugging why ~/.warp/themes/uber-<theme>.yaml doesn't match the active theme, why Warp's selection is out of sync after a switch, adjusting the ANSI palette mapping, updating Warp's transparency / blur defaults, or switching which theme Warp picks up. SKIP for widgets, window borders, menu bar, or Hammerspoon work.
---

# Warp terminal integration

The [Warp](https://www.warp.dev/) terminal theme is generated from the active widget theme, keeping the terminal palette in sync with the rest of the desktop.

**Source available:** Warp open-sourced its client in 2026-04 ([github.com/warpdotdev/warp](https://github.com/warpdotdev/warp), AGPL v3; UI crates `warpui` / `warpui_core` are MIT). When schema/setting questions come up, prefer the source over docs — see "Verified schema" below for the canonical paths. We're config consumers (YAML + plist), so AGPL doesn't bind us; only forking/redistributing the binary would.

## Files

- **`scripts/build-warp-theme.mjs`** — codegen. Same esbuild-bundle → data-URL → dynamic-import pattern as the others. Converts CSS `rgba()` tokens to flat `#RRGGBB` hex by compositing against the background color (Warp's ANSI palette has no alpha support).
- **`scripts/generate-warp-bg.mjs`** — image helper. Renders the grainy gradient JPEG that glass themes reference via `background_image:`. Pure sharp (SVG → raster + raw-buffer noise composite). Called from `build-warp-theme.mjs`.
- **`~/.warp/themes/uber-<theme>.yaml`** — external state. One file per theme name, regenerated on every `npm run build`.
- **`~/.warp/themes/uber-<theme>.jpg`** — generated background image (glass themes only). On opaque-theme builds the script deletes only its own matching `uber-<themeName>.jpg`; JPEGs from prior glass-theme builds (other theme names) are left in place. Switching back to that theme will reuse the stale file unless you also delete it manually.

## Theme → Warp mapping

| Warp field | Source |
|---|---|
| `background` | `layout.cardBg` composited onto a dark base — flat hex for opaque themes; vertical gradient for translucent (glass) themes (see "Glass-theme codegen behavior") |
| `foreground` | `accents.status.text` for opaque themes; pure `#ffffff` for glass themes |
| `accent` / `cursor` | Opaque themes: `menuBarTint` (always saturated — avoids the gray-out `primary.active` causes in glass themes where the border is white). Glass themes: `accents.status.h1` — `menuBarTint` is tuned for the menu bar (Ice 0.2-alpha cap forces a saturated hex), but at Warp's 25% window opacity that saturated tone reads dirty next to the pale-glass bg; `status.h1` is the pastel aqua already used for widget headers and matches the design intent. |
| ANSI red | `status.bad` |
| ANSI green | `status.good` |
| ANSI yellow | `accents.weather.h1` |
| ANSI blue | `accents.status.border` (composited) |
| ANSI magenta | `accents.nowplaying.h1` |
| ANSI cyan | `accents.status.h1` |
| ANSI black | background color (gradient midpoint for glass themes) |
| ANSI white | foreground color |

Bright variants are each normal color pushed ~20% toward white. `details` is auto-detected as `"darker"` or `"lighter"` based on background luminance.

The codegen also emits a `selection:` line (computed as the same `accentSource` it uses for `accent` — `menuBarTint` for opaque themes, `accents.status.h1` for glass themes — composited at 25% alpha over bg), but **Warp ignores it** — `selection` is not a field on `WarpTheme` in current source. It's harmless legacy output kept because removing it requires no behavior change either way; do not rely on it.

## Activation

The codegen writes one YAML per theme (`uber-<theme>.yaml`) AND updates Warp's active selection by writing the `Theme` key in `dev.warp.Warp-Stable.plist`. The stored value is JSON: `{"Custom":{"name":"Uber <Theme>","path":"<absolute path>"}}`. After updating, Warp is killed and relaunched so the new selection takes effect. No manual theme picking required.

**Why per-theme files instead of one stable filename:** earlier the script wrote a single `uber-theme.yaml` and only updated the `name:` field inside. Warp's stored selection caches the theme name, so the file path stayed valid but the cached name went stale and Warp would either keep showing the previous theme or silently fall back. One file per theme + an explicit `defaults write` keeps name/path coherent.

## Skip-if-unchanged

Compares the new YAML to the existing file AND compares the desired `Theme` plist value to the current one. Restart only happens when at least one of them changed; otherwise the script exits silently. The legacy `uber-theme.yaml` (single-file output from earlier versions) is auto-deleted on first run after the rename.

## Warp runtime settings (not code)

Applied via `defaults write dev.warp.Warp-Stable` + restart:

- `OverrideOpacity = 25` — very translucent window, matching the widgets' 26%-alpha cardBgs. Lower values = more see-through; this is tuned to feel like the same material as the widget cards. Valid range: 1–100 (`app/src/window_settings.rs`).
- `OverrideBlur = 64` — backdrop blur strength. Valid range: 1–64 (we're at the max; `BackgroundBlurRadius::MAX` in `app/src/window_settings.rs`). Mac-only.
- `OverrideBlurTexture` exists in source but is **Windows-only** — irrelevant on Mac, do not set.

```sh
defaults write dev.warp.Warp-Stable OverrideOpacity -integer 25
defaults write dev.warp.Warp-Stable OverrideBlur -integer 64
```

This was previously 78 (less transparent). The drop to 25 is what made Warp visually merge with the widget aesthetic; it does require the codegen to do extra work for readability — see "Glass-theme codegen behavior" below.

Each setting also has a `toml_path` (e.g. `appearance.window.override_opacity`) — Warp now supports a TOML config alternative to NSUserDefaults. We stay on `defaults write` because it's already wired into the codegen and avoids deciding where the TOML file lives across versions, but the path is documented if we ever want to move.

## Font settings — gotchas

Three relevant NSUserDefaults keys (`app/src/settings/font.rs`):

- `FontName` (string) — terminal monospace font family. Default `"Hack"`.
- `FontWeight` — Weight enum, JSON-quoted in plist (e.g. `'"Medium"'`). Variants: `Thin / ExtraLight / Light / Normal / Medium / Semibold / Bold / ExtraBold / Black`.
- `AIFontName` (string) — separate font for agent / AI-generated content. Independent picker in Settings → Appearance → Text.

The picker UI is split: **"Terminal font"** drives `FontName`, **"Agent font"** drives `AIFontName`. They look the same in the settings panel but feed different sets of glyphs at runtime. Setting only one of them and seeing your terminal output unchanged means you set the other.

### Custom monospace fonts not appearing in the Terminal font picker

The Terminal font picker is filtered to monospace by default (`view_font_type: FontType` defaults to `Monospace` in `app/src/settings_view/appearance_page.rs`). Warp's filter calls CoreText `descriptor.traits().symbolic_traits().is_monospace()`, which is set from the font's `post.isFixedPitch` table field. **Many Iosevka-derived Nerd Font builds ship with `post.isFixedPitch = 0` even when they're monospaced** — Warp will hide them from the Terminal picker, while the Agent picker (less strict) shows them fine.

Two ways out, in order of preference:

1. **Toggle "Show all available fonts"** in Settings → Appearance → Text. Bypasses the filter — your custom font will appear, you can pick it and it'll persist via `FontName`. Easiest, no font modification.
2. **Patch the font** to set `post.isFixedPitch = 1`:
   ```sh
   /tmp/fonttools-venv/bin/python -c "
   import glob
   from fontTools.ttLib import TTFont
   for path in glob.glob('/Users/.../Library/Fonts/<Pattern>*.ttf'):
       f = TTFont(path)
       if f['post'].isFixedPitch == 0:
           f['post'].isFixedPitch = 1
           f.save(path)
   "
   ```
   Then bust the macOS font cache by moving the .ttf files out and back into `~/Library/Fonts/` (mtime-based re-registration) and full Cmd+Q + relaunch Warp. Verify CoreText sees the change with a one-liner Swift script reading `CTFontGetSymbolicTraits` and the `traitMonoSpace` bit (0x400).

### Settings only take effect after a true quit

NSUserDefaults changes won't reach a running Warp via window-close — Warp keeps a `terminal-server` background process that re-attaches windows. **Cmd+Q the app** (or `killall stable && killall stable_app`) before expecting plist edits to land.

## Glass-theme codegen behavior

For themes with translucent `cardBg` (alpha < 1 — currently `liquid-glass`, `liquid-glass-dark`, `frutiger-aero`), `build-warp-theme.mjs` switches into a "glass mode" with several differences from the default flat-hex output:

1. **Hue-preserving compositing base.** Instead of compositing onto a fixed near-black `rgb(6,8,28)` (which drains hue out of tinted cardBgs at Warp's higher opacity), we derive the base from `cardBg.rgb * 0.4` — a darker version of the same hue. Lets sky-blue stay sky-blue through Warp's compositing.
2. **Vertical gradient background** — `top: brighten(bgFlat, 0.18)`, `bottom: darken(bgFlat, 0.35)`. Top brightened to read as the lit edge of glass; bottom darkened more aggressively for a critical reason — see the readability gotcha below.
3. **Pure white foreground** — `#ffffff` instead of the theme's accent text color (`accents.status.text`). At 25% window opacity the wallpaper bleeds through enough that off-white tints (e.g. frutiger-aero's `#f0faff`) get crushed.

### Background image (Frutiger-Aero / Zen-style grainy gradient)

For glass themes, the YAML now emits BOTH a flat `background:` solid AND a `background_image: { path, opacity }` pointing at a generated JPEG (`uber-<theme>.jpg`). The opacity value is the `bgImageOpacity` constant in `scripts/build-warp-theme.mjs` (currently 100; check the source for the live value before quoting). The JPEG bakes:

1. Vertical linear gradient using `bgGradient.top → bgGradient.bottom` (the same values the bare-gradient path used to put in YAML — they now go into the image instead).
2. Soft radial hot-spot at 55% × 68%, color `accents.status.h1`, peaking at 35% opacity.
3. **Salt-and-pepper film grain** — raw RGBA noise buffer composited via sharp's `over` blend. Each pixel is either fully bright (`255,255,255`) or fully dark (`0,0,0`) with random alpha 0..`NOISE_ALPHA_MAX`. See "Salt-and-pepper noise vs. window opacity" below for why this is bidirectional rather than just bright.

**Why a generated JPEG and not just a YAML gradient:** Warp accepts only `background:` gradient OR `background_image:`, not both as visual layers. The image lets us add the hot-spot and film grain that no built-in field can do, while the solid `background:` color stays in YAML so Warp's `pick_best_foreground_color` has a stable surface for contrast calculations even before the image loads.

**JPEG-only constraint:** Warp's docs and source both restrict `background_image.path` to `.jpg`/`.jpeg`. PNG/WebP are silently ignored.

**Why raw-buffer noise instead of SVG `feTurbulence`:** sharp uses librsvg, whose feTurbulence support is unreliable across versions (an early implementation rendered as a uniform alpha wash with no visible noise). Generating noise as raw RGBA bytes and compositing with sharp is bulletproof.

**Tuning knobs** (in `scripts/generate-warp-bg.mjs`):
- `NOISE_ALPHA_MAX` (default 140) — peak grain opacity 0–255. Calibrated so the grain is still legible after Warp's window-opacity multiplier; lower values disappear at low `OverrideOpacity` (see "Salt-and-pepper noise vs. window opacity" below). Above ~200 reads as static noise rather than frosted-glass.
- `NOISE_DARK_PROBABILITY` (default 0.5) — fraction of grain pixels that darken vs. brighten. Push toward 0.6–0.7 for darker overall surface (helps text legibility against bright wallpapers); push toward 0.3–0.4 for a brighter, "dustier" look.
- Hot-spot position — `cx="55%" cy="68%"` in the SVG. Lower-center matches the Zen reference.
- `WIDTH × HEIGHT` (default 2400 × 1500) — kept larger than typical terminal panes so noise survives downscale + JPEG DCT compression.

### Salt-and-pepper noise vs. window opacity (the load-bearing trick)

**Constraint:** Warp applies `OverrideOpacity` uniformly to the entire surface — there's no way to make the image opaque while the rest of the window is transparent. So when `OverrideOpacity` drops (more wallpaper bleed-through), the grain fades by the *same* multiplier as everything else. They're coupled. ([Open issue requesting per-element opacity](https://github.com/warpdotdev/Warp/issues/5335) is unresolved as of 2026-05.)

**The trick:** Instead of just bright (white-only) noise — which can only *brighten* the wallpaper and disappears against pale backgrounds — use **salt-and-pepper**: each grain pixel is either fully bright or fully dark with random alpha. The dark-pepper grains darken whatever they composite over, the bright-salt grains brighten it. This produces *bidirectional local contrast* that survives any window opacity setting because both halves still modulate the wallpaper, just at the same reduced magnitude.

**Why it matters for text legibility:** at `OverrideOpacity: 15`, the surface is 15% of pure-white-noise variance + 85% wallpaper. White-only noise washes out against a bright wallpaper because there's no contrast direction available. Salt-and-pepper provides 15% of *bidirectional* variance — the dark grains keep darkening the wallpaper enough to anchor text where they land. It's a perceptual trick (the eye reads grain as "covered" surface), not a uniform contrast guarantee — but it's the closest you can get to "transparent window with stable text backing" on Warp's compositing model.

**Compensation rule of thumb:** In-image grain alpha needs to be roughly `target_visible / OverrideOpacity_fraction`. For OverrideOpacity 15 (0.15), a target of ~20% visible variance ⇒ in-image alpha ~135/255. The default 140 lands here. If you bump `OverrideOpacity` back up (e.g. 30), you can drop `NOISE_ALPHA_MAX` proportionally (~70).

**Cache invalidation:** The image's content depends on `bgGradient.top/bottom` and `hotspotColor`, but those don't appear in the YAML's payload (only `background:` and `background_image: { path, opacity }`). So `build-warp-theme.mjs` embeds a fingerprint comment (`# bg-image: top=... bottom=... hotspot=...`) in the YAML, which forces the YAML diff to fire whenever any image-determining input changes. Without this fingerprint, tweaking the desaturation factor or the noise alpha would never trigger a regen.

**Desaturation factor relaxed for image path.** The bare-gradient path used `desaturate(bgFlat, 0.7)` to fight wallpaper bleed-through at 25% window opacity. With the image at 60% over the saturated `bgFlat` solid, the solid base mixes color back in, so the gradient itself can carry more chroma — current factor is `0.4`. If the gradient ever reads too gray, lower this further; if it reads too saturated and fights the wallpaper, raise it.

### Readability gotcha — the gradient midpoint matters

Warp's UI text color is computed by `font_color()` (`crates/warp_core/src/ui/theme/color.rs`):

```rust
pub fn font_color(&self, background: impl Into<ColorU>) -> Fill {
    Fill::Solid(pick_best_foreground_color(
        background.into(),       // local surface being painted
        self.background().into(), // theme bg → midpoint for gradients
        self.foreground().into(), // theme fg
        MinimumAllowedContrast::Text,
    ))
}
```

`pick_best_foreground_color` picks whichever of `theme.background` (gradient midpoint) or `theme.foreground` has more contrast against the *local surface*. At 25% window opacity over a bright wallpaper, the local surface reads bright. If our gradient midpoint is also bright-ish, the picker chooses the midpoint — which renders as **near-black text** on the wallpaper.

**Therefore:** the gradient endpoints must be set so the midpoint stays clearly dark (luminance ≲ 100/255). The current `0.18 / 0.35` brighten/darken split lands the frutiger-aero midpoint at ~`#4d6b78` (luminance ~100), which keeps white winning the contrast pick across most wallpapers. If the gradient ever needs to be made brighter (e.g. for a lighter glass theme), the midpoint constraint has to be honored — push the asymmetry harder (smaller `brighten`, larger `darken`) rather than centering both around the cardBg.

### `details: custom` is mostly dead code

Despite the `CustomDetails` struct having ten opacity fields, only `hint_text_opacity` is actually read by current Warp. `text_main`, `text_sub`, and `text_disabled` use **hardcoded** 90/60/40 opacities (`crates/warp_core/src/ui/theme/color.rs`, `internal_colors` module). Setting `details: custom` therefore buys almost nothing while introducing a deserialization surface that can fail silently. Stay on the bare `details: "darker"` / `"lighter"` strings.

## Verified schema (from source, 2026-04-29)

YAML fields the deserializer actually reads (`crates/warp_core/src/ui/theme/mod.rs`, `WarpTheme` struct):

| YAML key | Type | Notes |
|---|---|---|
| `background` | `Fill` | hex string OR `{top, bottom}` (vertical gradient) OR `{left, right}` (horizontal gradient) |
| `accent` | `Fill` | same |
| `cursor` | `Fill?` | optional; same shape as accent |
| `foreground` | hex string | required |
| `background_image` | `{path, opacity}?` | optional; `path` accepts `~` and is resolved relative to `~/.warp/themes/` if relative; `opacity` 1–100, default 100 |
| `details` | `"darker"` / `"lighter"` / `{custom: {...}}` | controls UI text/button opacities |
| `terminal_colors.normal` / `.bright` | `{black, red, green, yellow, blue, magenta, cyan, white}` | hex per slot |
| `name` | string? | optional override |

**`selection` is NOT a field on `WarpTheme`.** Our codegen emits a `selection:` line in the YAML body anyway, and Warp silently ignores it — selection color is derived from accent internally. Harmless legacy.

**`details: custom`** accepts a `CustomDetails` block (`crates/warp_core/src/ui/theme/color.rs`) with per-element opacities: `main_text_opacity`, `sub_text_opacity`, `hint_text_opacity`, `disabled_text_opacity`, `foreground_button_opacity`, `accent_button_opacity`, `button_hover_opacity`, `button_click_opacity`, `keybinding_row_overlay_opacity`, `welcome_tips_completion_overlay_opacity` (each 0–100). Built-in `darker` and `lighter` are identical except for the contrast pivot — see `DARKER_DETAILS` / `LIGHTER_DETAILS` constants. Note: only `hint_text_opacity` is actually consumed by current Warp — see the "dead code" note above before reaching for this.
