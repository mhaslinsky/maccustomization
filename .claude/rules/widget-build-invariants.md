# Widget build invariants (always-on)

These constraints are load-bearing for the Übersicht widget pipeline. Violating any of them produces a silent failure — widgets render blank, backdrops freeze, or the stack overlaps. Keep in mind when touching `src/`, `scripts/build-widgets.mjs`, or `src/widget_theme.ts`.

## File layout conventions

- **`widget_` prefix = shared module.** Files in `src/` starting with `widget_` (e.g. `widget_theme.tsx`, `widget_helpers.tsx`) are transpiled to `src/*.js` and imported by widgets. Files in `src/` without the prefix are widgets — transpiled to root `*.jsx`.
- **Root `.jsx` files must stay small.** Übersicht's embedded Babel silently fails on large files. Never bundle shared code into a widget — always import it.
- **Shared modules must live in `src/`**, not root. The build script deletes stray `widget_*.jsx` / `widget_*.js` at root on every build.
- **Imports are ESM, not bundled.** `esbuild` is used for transpile-only. Import statements must remain intact for Übersicht's Browserify to resolve at runtime.

## Runtime gotchas

- **Backdrop-filter keepalive animation (`buildWidgetClassName`):** the `widget-backdrop-keepalive` infinite opacity animation (`50% { opacity: 0.9999; }`) is required. WebKit caches the `backdrop-filter` paint layer for "static" elements and the blur freezes after first paint. `will-change: backdrop-filter` and `::before` pseudo-elements did NOT fix this. Do not remove the animation.
- **Cross-bundle shared state must use `window` globals.** Übersicht bundles each `.jsx` widget independently via Browserify, so module-scoped `const`/`let` in shared modules is duplicated per bundle. The widget wrapper registry lives on `window.__ubWidgetWrappers` for this reason. Any new cross-widget state MUST use the same `window.__*` pattern — module-level state silently creates per-bundle islands.
- **`layoutWidgets` is called synchronously, not via `requestAnimationFrame`.** Übersicht's desktop-layer WebView can deprioritize / skip rAF entirely as a background window, so an rAF-gated layout silently never fires. Keep layout triggers synchronous.

## Required widget exports

Every `.tsx` in `src/` (not `widget_` prefixed) must export: `command`, `refreshFrequency`, `className`, `render`. `scripts/build-widgets.mjs` validates this and fails the build if any are missing.
