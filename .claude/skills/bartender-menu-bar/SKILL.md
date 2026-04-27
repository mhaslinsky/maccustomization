---
name: bartender-menu-bar
description: Edit the Bartender menu bar style codegen or debug Bartender's themed bar background. Use when touching scripts/build-bartender-theme.mjs, changing how stored_style fields map to theme tokens, Bartender's menu bar isn't picking up theme colors, asking what the Bartender codegen does and doesn't manage (layout vs style), diagnosing the plist, or figuring out why Bartender won't restart after a theme switch. SKIP for window borders (janky-borders), Ice/Thaw (thaw-menu-bar), or widgets.
---

# Bartender (menu bar) integration

[Bartender 6](https://www.macbartender.com/) is the current menu bar icon manager. In v5+ it also themes the bar background (tint / gradient / border / shape / shadow / rounded corners / separate pills), which replaced Thaw's role. The codegen makes Bartender's Style follow the active widget theme automatically.

## Files

- **`scripts/build-bartender-theme.mjs`** — the codegen. Same esbuild-bundle → data-URL → dynamic-import pattern as the other codegens. Surgically rewrites only the color + border-thickness fields inside `stored_style`; preserves everything structural (shape, baseStyle mode, shadow, rounded-bottom flags, separate-pills, color-stop count, stop `location` values, border `position`).
- **`~/Library/Preferences/com.surteesstudios.Bartender.plist`** — **external state**, not tracked in the repo.
- **`.bartender-config-backup.json`** at repo root — **gitignored**, written exactly once on first run. Captures the user's pre-codegen Bartender style for rollback. Delete + re-run `build:bartender` to re-snapshot.

## Theme → Bartender mapping

| Bartender field | Source |
|---|---|
| `colors[0].color` | `layout.cardBg` (gradient base / first stop) |
| `colors[last].color` | `menuBarTint` (gradient edge / last stop) |
| `border.color` | `primary.active` |
| `border.thickness` | `layout.borderWidth` (parsed from `"Npx"`) |

If `colors` has only one stop, `menuBarTint` wins. If `colors` is empty, the array is left alone. Everything else is preserved (user's Style UI choices): `shape`, `baseStyle` (`standard` / `glass` / `gradient` / `custom`), `shadow`, `roundBottomofBar` (sic), `roundBottomOfScreen`, `seperatePills` (sic), stop `location` values, `border.position`.

## Schema (current, Bartender 6)

```json
{
  "shape": "capsule" | "bar" | ...,
  "baseStyle": { "standard" | "glass" | "gradient" | "custom": {} },
  "shadow": bool,
  "roundBottomofBar": bool,      // typo preserved as-is
  "roundBottomOfScreen": bool,
  "seperatePills": bool,         // typo preserved as-is
  "colors": [ { "color": {red, green, blue, alpha}, "location": 0..1 } ],
  "border": { "color": {...}, "position": "complete" | ..., "thickness": N }
}
```

Color objects use 0..1 floats (not component arrays like Thaw / Ice). Don't "fix" the typos (`roundBottomofBar`, `seperatePills`) — those are Bartender's spellings; renaming breaks reads.

## Config blob mechanics

`stored_style` is an NSData blob containing base64-encoded UTF-8 JSON. Pattern: `plutil -extract ... raw` → base64 decode → `JSON.parse` → mutate → `JSON.stringify` → Buffer → hex → `defaults write <bundle-id> stored_style -data <hex>` via `spawnSync` (arg array, no shell). Simpler than Thaw — plain JSON, no NSKeyedArchiver colorSpace blobs, single config (not split into light/dark/static modes).

## Skip-if-unchanged preflight

Reads `stored_style` without quitting Bartender, deep-clones, applies theme to clone, compares `JSON.stringify(current)` vs `JSON.stringify(candidate)`. If identical: prints `(Bartender menu bar style unchanged — skipping.)` and exits 0 — no quit, no restart, no menu bar flash. Hot path for repeat `npm run build` cycles during widget iteration.

## Quit / write / relaunch order (only on real change)

1. `pgrep -f "Contents/MacOS/Bartender [0-9]"` → detect if running. The `[0-9]` anchors to the versioned executable (`Bartender 6`, `Bartender 7`, …) and excludes the `Bartender Service` XPC helper.
2. `osascript -e 'tell application id "com.surteesstudios.Bartender" to quit'` — graceful quit, lets Bartender flush in-memory preferences via `CFPreferencesAppSynchronize`. Falls back to `pkill -f` on the same pattern if that hangs.
3. `sleep 600ms` for the flush.
4. Read + mutate + write the new blob.
5. `open -b com.surteesstudios.Bartender` to relaunch.

Using the bundle ID (not the versioned app name) means this keeps working across Bartender 7, 8, …

## Opt-in by presence

If the plist doesn't exist, the codegen logs a skip and exits 0. No error on machines without Bartender.

## What the codegen does NOT touch

Scoped strictly to the `stored_style` key. External state owned by the user through Bartender's UI:

- **Menu bar layout** — `ProfileSettings.activeProfile.Show` / `.Hide` / `.AlwaysHide` arrays. Drag-arranged Shown / Hidden / Always Hidden lists. `defaults write stored_style` is key-level and can't touch them.
- **Layout Mode** (General → Layout Mode: **On-Demand** vs **Live**). Recommend On-Demand — Live installs a global mouse-move event tap and can cause brief cursor interruptions. On-Demand means drags save to preferences but only re-apply to the visible menu bar when you click **Sort My Bar** (or fire the Sort My Bar hotkey). If a user reports "layout changes aren't saving", first check the plist (usually persisted) — they just need to hit Sort My Bar.
- **Hot keys, Triggers, Presets, Sort My Bar behavior, icon-specific visibility rules.**

## Diagnostics

```sh
# Current style (what the codegen manages)
plutil -extract stored_style raw -o - ~/Library/Preferences/com.surteesstudios.Bartender.plist | base64 -d | python3 -m json.tool

# Current layout (what the codegen does NOT manage)
plutil -extract ProfileSettings.activeProfile.Show xml1 -o - ~/Library/Preferences/com.surteesstudios.Bartender.plist
plutil -extract ProfileSettings.activeProfile.Hide xml1 -o - ~/Library/Preferences/com.surteesstudios.Bartender.plist
plutil -extract ProfileSettings.activeProfile.AlwaysHide xml1 -o - ~/Library/Preferences/com.surteesstudios.Bartender.plist
```
