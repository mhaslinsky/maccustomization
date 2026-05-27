---
name: thaw-menu-bar
description: Reference for the Thaw (Ice fork) menu bar codegen — reactivated 2026-05-27 on Thaw 2.0 beta, manual-only (not in build chain). Use when editing scripts/build-thaw-theme.mjs, tuning controls.thaw (background kind / glassStyle / tintOpacity / backgroundOpacity), debugging the MenuBarAppearanceConfigurationV2 plist, the colorSpace-swap requirement for grayscale-default color fields, the stale-compiled-.js gotcha (run build:widgets before standalone build:thaw), the Thaw 2.0 full-appearance schema (tintKind/backgroundKind/glassStyle enums), explaining menuBarTint's role now that Ice's 0.2 tint cap is gone, tuning ShowOnHover / ShowOnScroll / IconRefreshInterval, or deciding whether to re-chain build:thaw. SKIP for widget, theme, or Bartender work that does NOT touch Thaw / menu-bar fields (note: editing controls.thaw in a theme file IS Thaw work — use this skill).
---

# Thaw (menu bar) integration — REACTIVATED (2026-05-27), manual-only

**Status:** Manually invokable (`npm run build:thaw`), NOT in the `npm run build` chain. History: deprecated 2026-04-24 for Bartender → Bartender 6 proved unstable on macOS 26 Tahoe (system lag, cursor hijacking, ghost clicks; Heise Feb 2026) → Thaw shipped an active 2.0 beta line (beta.12, May 2026) that fixes the Tahoe stability issues AND adds a configurable menu bar background (solid/gradient/glass) → Thaw is back. Kept manual-only while the beta channel stabilizes.

## Re-chaining (optional)

Append `&& npm run build:thaw` to the `build` script in `package.json`. Left off deliberately — the 2.0 schema is on a fast-moving beta channel; running it on demand limits blast radius.

## Running it (IMPORTANT: build:widgets first)

`_active.ts` imports `./obsidian-glass.js` (literal `.js`), so esbuild resolves to the **compiled** `src/themes/*.js`, not the `.ts`. The full `npm run build` regenerates those `.js` via `build:widgets` first; standalone `npm run build:thaw` does NOT, so it reads a STALE theme and silently misses recent token/`controls.thaw` edits. Always:

```sh
npm run build:widgets && npm run build:thaw
```

This bit during the 2.0 rewrite: `controls.thaw` was absent from the bundle until widgets were rebuilt. Applies to every standalone codegen, but Thaw is the one you'll run by hand.

## `menuBarTint` is still a required theme field

Warp consumes it for the terminal accent, and it drives Thaw's tint/gradient edge. Don't remove it from `_types.ts` or theme files.

---

# Thaw codegen reference

[Thaw](https://github.com/stonerl/Thaw) is a fork of [Ice](https://github.com/jordanbaird/Ice) — a menu bar manager that themes the macOS menu bar (tint, border, gradient, glass material, shape, inset). Bundle id / defaults domain is **`com.stonerl.Thaw`** (the fork renamed it; only the JSON sub-keys retain the "Ice" lineage — the codegen was always on the Thaw domain, never `com.stonerl.Ice`).

## Files

- **`scripts/build-thaw-theme.mjs`** — codegen. Bundles the active theme, reads `menuBarTint` / `primary.active` / `layout.cardBg` / `layout.borderWidth` + optional `controls.thaw` knobs, and rewrites the color/opacity/kind fields inside Thaw's `MenuBarAppearanceConfigurationV2` blob. Structural bits (shape, margins, inset) preserved verbatim.
- **`~/Library/Preferences/com.stonerl.Thaw.plist`** — external state.
- **`.thaw-config-backup.json`** — gitignored; pre-codegen snapshot for rollback.

## Theme → Thaw mapping (Thaw 2.0)

Each config is a `MenuBarAppearancePartialConfiguration`; applied uniformly across `lightModeConfiguration`, `darkModeConfiguration`, `staticConfiguration`. Tint/border/gradient always driven (pre-2.0 parity). Background material driven **only when `controls.thaw.background` is set** — otherwise background fields preserved.

| Thaw field | Source |
|---|---|
| `tintColor` | `menuBarTint` |
| `tintOpacity` | `controls.thaw.tintOpacity` (if set) |
| `borderColor` / `borderWidth` | `primary.active` / `layout.borderWidth` |
| `tintGradient.stops[0 / -1]` | `layout.cardBg` / `menuBarTint` |
| `backgroundKind` | `controls.thaw.background` enum (gates the block) |
| `backgroundColor` | `layout.cardBg` (+ sRGB colorSpace swap) |
| `backgroundOpacity` | `controls.thaw.backgroundOpacity` ?? cardBg alpha |
| `backgroundGradient.stops` | `layout.cardBg` / `menuBarTint` |
| `backgroundBorderColor` / `Width` | `primary.active` / `layout.borderWidth` |
| `backgroundGlassStyle` / `tintGlassStyle` | `controls.thaw.glassStyle` (if set) |

Enums (from Swift source): `MenuBarTintKind` / `MenuBarBackgroundKind` = {0 none, 1 solid, 2 gradient, 3 glass, 4 adaptive}; `MenuBarGlassStyle` = {0 regular, 1 clear}.

Preserved verbatim: `shapeKind`, `fullShapeInfo` / `splitShapeInfo` / `notchShapeInfo`, `leftMargin` / `rightMargin` / `notchMargin`, `isInset`, `isDynamic`.

## colorSpace swap — the load-bearing gotcha

`IceColor`'s decoder (`Thaw/UI/Utilities/IceColor.swift`) does `CGColor(colorSpace:components:)`, which requires `components.count == colorSpace.numberOfComponents + 1`. Thaw stores `tintColor` / `borderColor` as **4-component sRGB** but `backgroundColor` / `backgroundBorderColor` as **2-component grayscale** (`[white, alpha]`, e.g. `[0, 1]`, with a ~6KB grayscale ICC blob). Writing a 4-component rgba array into a grayscale field while leaving its colorSpace makes `CGColor(...)` return nil → Thaw **rejects the entire blob and resets to defaults** (symptom: `backgroundKind` back to 0, opacities back to 0.2, despite a successful `defaults write`). `writeColor()` therefore stamps the sRGB ICC blob — lifted from the config's own `tintColor.colorSpace` (~2656 chars) — onto any field it converts to 4-component rgba. Verify a write took by reading back: `backgroundColor.colorSpace` length should flip 6012 → 2656.

## `menuBarTint` and Ice's dead 0.2 cap

Ice hardcoded the main bar tint to 20% alpha in `drawTint()` (`.withAlphaComponent(0.2)`), so a saturated full-alpha `menuBarTint` was needed to stay visible. **Thaw 2.0 exposes `tintOpacity` as a real field — the cap is gone**, set opacity via `controls.thaw.tintOpacity` (values >0.2 now take effect). `menuBarTint` is retained as the bar accent color (Warp shares it; it's distinct from translucent `primary.active`).

## Config blob mechanics

`MenuBarAppearanceConfigurationV2` is an NSData blob containing UTF-8 JSON. `plutil -extract <key> raw -o -` spits it as base64. Pattern: decode → `JSON.parse` → mutate → `JSON.stringify` → Buffer → hex → `defaults write <bundle-id> <key> -data <hex>` via `spawnSync` (arg array; hex is ~85KB but well within `ARG_MAX`).

## Skip-if-unchanged preflight

Reads blob without killing Thaw, deep-clones, applies theme to clone, compares `JSON.stringify(current)` vs `JSON.stringify(candidate)`. Identical → prints `(Thaw menu bar theme unchanged — skipping.)` and exits 0 — no kill, no restart, no flash. `applyTheme` and `requiredConfigs` are defined above the preflight so they're shared with the main write path.

## Kill / write / relaunch order (on real change)

1. `pgrep -x Thaw` → detect if running.
2. `killall Thaw` + `sleep 0.6` — let Thaw flush in-memory preferences to disk.
3. Read + mutate + write the new blob.
4. `open -a Thaw` to relaunch.

Order matters. Writing while Thaw is running risks Thaw's graceful-quit flush overwriting our changes. Killing first makes on-disk state authoritative when we read it. Brief ~1s menu bar flash on actual changes — acceptable tradeoff. Future optimization: if Thaw honors live `CFPreferences` notifications for this key, drop the kill/relaunch.

## Opt-in by presence

If `~/Library/Preferences/com.stonerl.Thaw.plist` doesn't exist, codegen logs a skip and exits 0.

## Schema fragility

The `V2` suggests Ice/Thaw has migrated its schema before. Codegen does a minimal shape check (`lightModeConfiguration`, `darkModeConfiguration`, `staticConfiguration` must exist as objects) and bails loudly if the schema shifts. A `V3` future would need a remap pass — we only touch `.components` arrays and preserve everything else, so blast radius stays small.

## Thaw runtime settings (performance)

Configure via `defaults write` + kill/relaunch. External state, not in repo:

- `ShowOnHover = false` — otherwise Thaw installs a system-wide mouse-move event tap (`Thaw/Events/HIDEventManager.swift`, `mouseMovedTap`). Every mouse movement runs through it — throttled to every 5th event but still ~24 callbacks/sec on modern trackpads.
- `ShowOnScroll = false` — same class of issue; global scroll wheel monitor.
- `IconRefreshInterval = 2.0` — only ticks when the IceBar popup is visible, but the default `0.5` polls menu bar icon images 4× more than needed. 2.0 is plenty responsive.

Apply:

```sh
killall Thaw
defaults write com.stonerl.Thaw ShowOnHover -bool false
defaults write com.stonerl.Thaw ShowOnScroll -bool false
defaults write com.stonerl.Thaw IconRefreshInterval -float 2.0
open -a Thaw
```

Click-to-reveal (`ShowOnClick = true`) still works after these changes.
