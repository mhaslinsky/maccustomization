---
name: theme-authoring
description: Author, modify, or switch design-token themes in src/themes/. Use when adding a new theme file, editing an existing theme (default, liquid-glass, liquid-glass-dark, catppuccin-macchiato, frutiger-aero), changing theme field shapes in _types.ts, adding / tweaking widget icons, updating the active theme pointer (_active.ts), or running npm run theme. SKIP for widget code (widget-authoring), codegen scripts (hammerspoon-config / janky-borders / bartender-menu-bar / warp-terminal), or backend Python.
---

# Theme authoring

Every "look" is one file in `src/themes/`. The currently-selected theme is whatever `src/themes/_active.ts` re-exports — that's the single pointer every downstream consumer reads. Flipping it and rebuilding updates widgets, Hammerspoon, JankyBorders, Bartender's menu bar, and Warp in one pass. (Thaw is deprecated and no longer in the default build chain — see `thaw-menu-bar` skill.)

## Files

- `src/themes/_types.ts` — shared `Theme`, `AccentSpec`, `Layout`, `Status`, `Primary`, `MenuBarTint`, `Icons`, `WidgetAccent` types. Every theme file must satisfy these.
- `src/themes/_active.ts` — **checked in**, but rewritten by `npm run theme <name>`. Just `export * from "./<name>.js";`. Think of it as a version-controlled symlink.
- `src/themes/<name>.ts` — one per theme. Current: `default`, `liquid-glass`, `liquid-glass-dark`, `catppuccin-macchiato`, `frutiger-aero`.
- `src/themes/*.js` — transpile outputs (gitignored). Emitted by `build:widgets` so Übersicht's Browserify can walk the import chain at runtime.
- `scripts/switch-theme.mjs` — the CLI behind `npm run theme`.

## Theme field cheat sheet

Every theme exports `layout`, `status`, `primary`, `menuBarTint`, `icons`, and `accents` (keyed by `WidgetAccent` — currently `status` / `weather` / `calendar` / `nowplaying`).

- **`primary`** — canonical "brand" accent consumed by cross-program tools. Fields: `active`, `inactive`, `width` (px — window-border thickness, separate from `layout.borderWidth` which is widget-card thickness). JankyBorders is the active consumer; Bartender reads `primary.active` for the menu bar border color.
- **`layout.backdropFilterEnabled`:** optional, defaults to `true`. Set it to `false` only for a near-opaque theme that should omit both backdrop filters and the 60fps keepalive animation. Translucent glass themes require the paired filter and animation.
- **`menuBarTint`** — dedicated saturated-full-alpha color. Thaw (when active) forces 0.2 alpha on the main bar tint; translucent primaries vanish there, so `menuBarTint` is the per-theme escape hatch. Still required even though Thaw is deprecated because Warp and Bartender also consume it.
- **`icons`** — optional `Partial<Record<WidgetAccent, string>>` of glyphs prepended to each widget's happy-path `h1`. Leave `{}` for plain text h1s (preserves pre-icons behavior). Icons only show on the main render path; `renderError` / `renderLoading` / `renderParseError` ignore them.

## Adding a new theme

1. Copy `src/themes/default.ts` to `src/themes/<name>.ts` and tweak values. Keep the same exports with the same shapes — type annotations enforce parity.
2. `menuBarTint` must be saturated full-alpha (alpha effectively ignored by Ice; RGB is what matters).
3. `npm run theme <name>` switches + rebuilds. Widgets, Hammerspoon, JankyBorders, Bartender, Warp all flip. Thaw stays on the old theme unless you manually run `npm run build:thaw`.
4. `npm run theme default` to revert.

## Adding a new theme field

Update `src/themes/_types.ts` first, then every existing theme file. `npm run typecheck` lists misses. Codegens that should consume the new field need a line added to their field whitelists (see `accentColorFields` / `emitLayout` in `scripts/build-hammerspoon-theme.mjs` and similar in other codegens — fields are whitelisted, not reflected).

## Widget h1 icons pattern

Wired as an optional theme token, not a widget-level hardcoded feature — every theme opts in or stays text-only. Widgets render `<span className="icon">{icons.<key>}</span>` inside their `h1`, and `buildWidgetClassName` emits a generic `h1 .icon` rule (size / margin / optical-centering transform) so any new widget gets consistent styling for free.

## Nerd Font font-stack pattern

Icon glyphs typically live in the Unicode Private Use Area (U+E000..U+F8FF). Browser does per-character font fallback, so wire icons by putting the UI font (e.g. Inter, SF Pro) at the **head** of `layout.fontStack` and appending a Nerd Font as a **tail** fallback *before* the generic `sans-serif` (a generic family name terminates fallback — anything listed after it is never reached). Latin text stays in the UI font; only PUA codepoints pull from Nerd Font.

`catppuccin-macchiato.ts` is the example: `Hack Nerd Font` (already installed on this machine) as tail fallback, with `Symbols Nerd Font` (`brew install --cask font-symbols-only-nerd-font`) listed after as a portable alternative. Without a Nerd Font installed, the glyph renders as a `.notdef` tofu box — treat Nerd Font as a soft dependency and document it in the theme file's comments.

## Why `_active.ts` instead of a JSON config

Widgets' build pipeline is pure ESM transpile → Übersicht Browserify. Runtime JSON would need extra wire-up. A checked-in TS re-export file is resolved by the same import graph that ships the theme values. Codegens bundle `_active.ts` in-memory via esbuild so they follow the re-export chain automatically.
