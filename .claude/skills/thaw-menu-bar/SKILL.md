---
name: thaw-menu-bar
description: Reference for the deprecated Thaw (Ice fork) menu bar codegen. Use when re-enabling Thaw (appending build:thaw back to the build chain), editing scripts/build-thaw-theme.mjs, debugging the MenuBarAppearanceConfigurationV2 plist, explaining why menuBarTint exists as its own theme field (Ice's 0.2 alpha cap), tuning Thaw's ShowOnHover / ShowOnScroll / IconRefreshInterval runtime settings, or deciding whether to roll back from Bartender. SKIP for widget, theme, or Bartender work.
---

# Thaw (menu bar) integration — DEPRECATED (2026-04-24)

**Status:** No longer chained into `npm run build`. Migrated to **Bartender** for menu bar icon management. Bartender doesn't theme the menu bar background, so the menu bar now renders stock macOS appearance.

The Thaw codegen, `menuBarTint` theme field, and `.thaw-config-backup.json` are kept in place so we can roll back if Bartender doesn't work out.

## Re-enabling

Append `&& npm run build:thaw` back to the `build` script in `package.json`. Everything else (codegen, theme field, backup) is untouched.

## Why deprecated

Thaw was unstable in practice (crashes / restarts). Bartender is the mature, stable option for icon management; tradeoff is losing the themed menu bar background.

## `menuBarTint` is still a required theme field

Because Warp also consumes it for the terminal accent color, AND Bartender's gradient edge uses it. Don't remove it from `_types.ts` or individual theme files even though Thaw isn't running.

---

# Thaw codegen reference (still-functional, manually invokable)

[Thaw](https://github.com/stonerl/Thaw) is a fork of [Ice](https://github.com/jordanbaird/Ice) — a menu bar manager that also themes the macOS menu bar itself (tint, border, gradient, shape, inset).

## Files

- **`scripts/build-thaw-theme.mjs`** — codegen. Bundles the active theme (same esbuild pattern as the other codegens), pulls three colors (`menuBarTint`, `primary.active`, `layout.cardBg`) and a width (`layout.borderWidth`, parsed from `"Npx"`), and surgically rewrites just those fields inside Thaw's `MenuBarAppearanceConfigurationV2` blob. Structural bits (shape, inset, archived colorSpace NSColor blobs) are preserved verbatim.
- **`~/Library/Preferences/com.stonerl.Thaw.plist`** — external state.
- **`.thaw-config-backup.json`** — gitignored; pre-codegen snapshot for rollback.

## Theme → Thaw mapping

Applied uniformly across `lightModeConfiguration`, `darkModeConfiguration`, and `staticConfiguration`:

| Thaw field | Source |
|---|---|
| `tintColor.components` | `menuBarTint` |
| `borderColor.components` | `primary.active` |
| `borderWidth` | `layout.borderWidth` (px number) |
| `tintGradient.stops[0].color.components` | `layout.cardBg` (gradient base) |
| `tintGradient.stops[-1].color.components` | `menuBarTint` (gradient edge) |

Preserved verbatim: `hasBorder`, `hasShadow`, `tintKind`, archived `colorSpace` NSColor blobs (~2–4KB each per color), `shapeKind`, `leftMargin` / `rightMargin`, `isInset`, `splitShapeInfo`, `fullShapeInfo`.

## Why `menuBarTint` is a dedicated theme field

Ice hardcodes the main menu bar tint to **20% alpha** in `MenuBarOverlayPanel.drawTint()`:

```swift
case .solid:
    if let tintColor = NSColor(cgColor: configuration.tintColor)?
         .withAlphaComponent(0.2) { … }
```

`.withAlphaComponent(0.2)` *replaces* the alpha channel; whatever alpha we write is ignored. For themes with a translucent primary accent (liquid-glass's white `rgba(255, 255, 255, 0.72)`), 20% alpha white is essentially invisible on non-dark wallpapers — the main bar looked untinted while the IceBar popup (different code path: averaged screen colors + full-alpha border) showed the theme fine. `menuBarTint` is a per-theme escape hatch specifying a saturated full-alpha color that stays visible at 0.2 alpha. Alpha channel is effectively ignored; RGB is what matters. `primary.active` continues to drive `borderColor` (no 0.2 cap) so the border matches JankyBorders window borders.

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
