/**
 * Codegen: src/themes/_active.ts  →  <vault>/.obsidian/snippets/uber-theme.css
 *
 * Obsidian theming integration via CSS snippets — same idea as build-slack-css.mjs
 * but cleaner because Obsidian has a documented public CSS-variable surface
 * (https://docs.obsidian.md/Reference/CSS+variables/CSS+variables) instead of
 * the moving target Slack ships.
 *
 * Strategy:
 *   - Snippet, not a full theme. A snippet is a single CSS file that overrides
 *     the active theme's variables. It composes with whatever theme the user
 *     already has selected (default, AnuPpuccin, Catppuccin, etc.) so we don't
 *     stomp on layout/typography choices — we just retint colors + glass.
 *   - Vaults auto-discovered from ~/Library/Application Support/obsidian/obsidian.json.
 *     Every registered vault gets the snippet written + enabled.
 *   - Glass themes (alpha < 1 cardBg) emit a translucent surface treatment that
 *     pairs with Obsidian's "Translucent window" appearance setting (which the
 *     user has to flip themselves under Settings → Appearance — we can't
 *     write that key reliably across Obsidian versions).
 *
 * Hot-reload: Obsidian watches the snippets dir and reapplies CSS on change
 * for already-enabled snippets — no Obsidian restart needed for re-runs after
 * the first time the snippet gets enabled.
 *
 * First-time enable: this codegen patches appearance.json to add "uber-theme"
 * to enabledCssSnippets. If Obsidian is already running and the snippet wasn't
 * enabled before, you may need to toggle Settings → Appearance → CSS snippets
 * once to pick it up — subsequent rewrites then hot-reload cleanly.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const activeSrc = join(root, "src", "themes", "_active.ts");

// ---------------------------------------------------------------------------
// Load active theme via the same esbuild-bundle → data-URL → dynamic-import
// pattern shared with the other codegens.
// ---------------------------------------------------------------------------

const result = await esbuild.build({
  entryPoints: [activeSrc],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  logLevel: "silent",
});
const dataUrl = "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64");
const theme = await import(dataUrl);

const activeSrcText = await readFile(activeSrc, "utf8");
const nameMatch = activeSrcText.match(/from\s+["']\.\/([^"']+?)(?:\.js)?["']/);
const themeName = nameMatch ? nameMatch[1] : "custom";

// ---------------------------------------------------------------------------
// Color helpers (same shape as build-slack-css.mjs — duplicated rather than
// factored to keep each codegen self-contained per repo convention).
// ---------------------------------------------------------------------------

function parseColor(color) {
  const hex6 = color.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  const rgba = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgba) {
    return {
      r: parseInt(rgba[1], 10),
      g: parseInt(rgba[2], 10),
      b: parseInt(rgba[3], 10),
      a: rgba[4] != null ? parseFloat(rgba[4]) : 1,
    };
  }
  throw new Error(`Cannot parse CSS color: ${color}`);
}

function composite(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function toHex(c) {
  const hh = (n) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0").toUpperCase();
  return `#${hh(c.r)}${hh(c.g)}${hh(c.b)}`;
}

function toRgba(c) {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}

function cssToHex(color, bgColor) {
  const fg = parseColor(color);
  if (fg.a >= 1) return toHex(fg);
  const bg = bgColor ? parseColor(bgColor) : { r: 0, g: 0, b: 0, a: 1 };
  return toHex(composite(fg, bg));
}

function lighten(hex, amount) {
  const c = parseColor(hex);
  return toHex({
    r: Math.round(c.r + (255 - c.r) * amount),
    g: Math.round(c.g + (255 - c.g) * amount),
    b: Math.round(c.b + (255 - c.b) * amount),
    a: 1,
  });
}

function darken(hex, amount) {
  const c = parseColor(hex);
  return toHex({
    r: Math.round(c.r * (1 - amount)),
    g: Math.round(c.g * (1 - amount)),
    b: Math.round(c.b * (1 - amount)),
    a: 1,
  });
}

function withAlpha(color, alpha) {
  const c = parseColor(color);
  return toRgba({ ...c, a: alpha });
}

// ---------------------------------------------------------------------------
// Compute the palette
// ---------------------------------------------------------------------------

const bgParsed = parseColor(theme.layout.cardBg);
const isGlass = bgParsed.a < 1;

// Hue-preserving base for glass themes (same trick as the Warp codegen).
// For opaque themes, composite onto a neutral dark base.
const bgBase = isGlass
  ? {
      r: Math.round(bgParsed.r * 0.4),
      g: Math.round(bgParsed.g * 0.4),
      b: Math.round(bgParsed.b * 0.4),
      a: 1,
    }
  : { r: 6, g: 8, b: 28, a: 1 };

const bg = isGlass ? toHex(composite(bgParsed, bgBase)) : toHex(bgParsed);
const bgElevated = lighten(bg, 0.06);
const bgHigh = lighten(bg, 0.12);
const bgDeep = darken(bg, 0.2);
const bgBorder = lighten(bg, 0.2);

const fg = isGlass ? "#FFFFFF" : cssToHex(theme.accents.status.text, bg);
const fgMuted = cssToHex(theme.accents.status.smallMuted, bg);
const fgFaint = withAlpha(fg, 0.5);

const accent = cssToHex(theme.menuBarTint, bg);
const accentBright = lighten(accent, 0.15);

const success = cssToHex(theme.status.good, bg);
const danger = cssToHex(theme.status.bad, bg);
const warn = cssToHex(theme.status.warn, bg);

// Per-accent-family mappings to drive heading colors.
const h1Color = cssToHex(theme.accents.status.h1, bg);
const h2Color = cssToHex(theme.accents.weather.h1, bg);
const h3Color = cssToHex(theme.accents.calendar.h1, bg);
const h4Color = cssToHex(theme.accents.nowplaying.h1, bg);

// Glass-mode translucent surfaces — let the wallpaper bleed through any
// chrome that sits above Obsidian's "Translucent window" toggle. We emit
// the original alpha-bearing color so Obsidian + macOS vibrancy do the rest.
const glassSurface = isGlass ? toRgba(bgParsed) : null;
const glassBlur = theme.layout.blur || "16px";
const glassSaturate = theme.layout.backdropSaturate || 1.0;

// ---------------------------------------------------------------------------
// CSS snippet
// ---------------------------------------------------------------------------

const css = `/*
 * AUTO-GENERATED by scripts/build-obsidian-theme.mjs
 * Source of truth: src/themes/_active.ts → src/themes/${themeName}.ts
 * DO NOT EDIT — regenerated on every \`npm run build\`.
 *
 * This is a CSS *snippet* (not a full theme) — it overrides Obsidian's CSS
 * variables and composes with whatever theme is currently selected under
 * Settings → Appearance. To toggle: Settings → Appearance → CSS snippets.
 */

.theme-dark,
.theme-light,
body {
  /* ---- Background surfaces ---- */
  --background-primary: ${bg};
  --background-primary-alt: ${bgElevated};
  --background-secondary: ${bgDeep};
  --background-secondary-alt: ${darken(bg, 0.3)};
  --background-modifier-border: ${bgBorder};
  --background-modifier-border-hover: ${lighten(bgBorder, 0.15)};
  --background-modifier-border-focus: ${accent};
  --background-modifier-hover: ${withAlpha(fg, 0.08)};
  --background-modifier-active-hover: ${withAlpha(accent, 0.2)};
  --background-modifier-error: ${withAlpha(danger, 0.18)};
  --background-modifier-error-hover: ${withAlpha(danger, 0.3)};
  --background-modifier-success: ${withAlpha(success, 0.18)};
  --background-modifier-cover: ${withAlpha("#000000", 0.6)};

  /* ---- Text ---- */
  --text-normal: ${fg};
  --text-muted: ${fgMuted};
  --text-faint: ${fgFaint};
  --text-on-accent: #FFFFFF;
  --text-error: ${danger};
  --text-warning: ${warn};
  --text-success: ${success};
  --text-accent: ${h1Color};
  --text-accent-hover: ${lighten(h1Color, 0.15)};
  --text-selection: ${withAlpha(accent, 0.3)};

  /* ---- Interactive (buttons, links, cursor) ---- */
  --interactive-normal: ${bgElevated};
  --interactive-hover: ${bgHigh};
  --interactive-accent: ${accent};
  --interactive-accent-hover: ${accentBright};

  /* ---- Headings — mapped to our four widget accent families ---- */
  --h1-color: ${h1Color};
  --h2-color: ${h2Color};
  --h3-color: ${h3Color};
  --h4-color: ${h4Color};
  --h5-color: ${fg};
  --h6-color: ${fgMuted};

  /* ---- Code ---- */
  --code-background: ${withAlpha(fg, 0.08)};
  --code-normal: ${h1Color};
  --code-comment: ${fgMuted};
  --code-keyword: ${h4Color};
  --code-string: ${success};
  --code-value: ${h2Color};
  --code-function: ${h3Color};

  /* ---- Misc ---- */
  --blockquote-border-color: ${accent};
  --hr-color: ${bgBorder};
  --tag-color: ${h1Color};
  --tag-background: ${withAlpha(h1Color, 0.15)};
  --checkbox-color: ${accent};
  --checkbox-color-hover: ${accentBright};
  --link-color: ${h1Color};
  --link-color-hover: ${lighten(h1Color, 0.15)};

  /* ---- Cross-program tokens (parity with the Slack snippet) ---- */
  --uber-card-bg: ${bg};
  --uber-card-bg-elevated: ${bgElevated};
  --uber-card-bg-high: ${bgHigh};
  --uber-card-bg-deep: ${bgDeep};
  --uber-text: ${fg};
  --uber-text-muted: ${fgMuted};
  --uber-accent: ${accent};
  --uber-success: ${success};
  --uber-danger: ${danger};
  --uber-warn: ${warn};
}
${
  isGlass
    ? `
/* ---- Glass-theme surfaces ---- */
/* Pair with Settings → Appearance → "Translucent window" = ON for the
   wallpaper to bleed through. Without that toggle, these alpha values
   composite onto Obsidian's opaque app background and read as the flat
   composited bg above. */
.theme-dark,
.theme-light,
body {
  /* Lower alpha than the widget cardBg — Obsidian fills full-screen, so
     the same 0.26 reads heavy/dark. Halving keeps the tint without going
     opaque-looking. */
  --background-primary: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.5)};
  --background-primary-alt: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.7)};
  --background-secondary: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.4)};
}

/* Force the root chain transparent — main themes (AnuPpuccin, Catppuccin,
   etc.) paint body / .theme-dark with an opaque bg that blocks macOS
   vibrancy from reaching our alpha-tinted surfaces below. */
html,
body,
.app-container,
.horizontal-main-container,
.theme-dark,
.theme-light {
  background-color: transparent !important;
}

/* All inner surfaces fully transparent — these nest inside .workspace, and
   any backdrop-filter here would create a new stacking context that blocks
   vibrancy from reaching them. Empty bg means the .workspace blur below
   shows through every layer. */
.workspace-ribbon,
.workspace-split,
.workspace-tabs,
.workspace-tab-container,
.workspace-leaf,
.workspace-leaf-content,
.markdown-source-view,
.markdown-preview-view,
.markdown-reading-view,
.markdown-preview-sizer,
.markdown-preview-section,
.markdown-rendered,
.cm-editor,
.cm-scroller,
.cm-content,
.cm-line,
.view-content,
.view-header,
.status-bar,
.aidb-hub-view,
.aidb-hub-promote-banner {
  background-color: transparent !important;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* Glass layer on .workspace: alpha tint ONLY, no backdrop-filter.
   Empirical finding: backdrop-filter on .workspace in Obsidian's
   Electron+vibrancy stack does NOT reliably blur the macOS vibrancy
   backdrop. Symptom: editor renders solid opaque cyan; resizing the
   window shows correct frosted-glass for one frame then freezes again.
   Tried (none worked):
     - Übersicht-style opacity keepalive animation (works for our widgets;
       widgets run in WebKit, this is Chromium — different bug)
     - will-change: backdrop-filter
     - ::before pseudo-element trick
     - !important on backdrop-filter
   Root cause is that Chromium composites the WebContents framebuffer
   separately from the AppKit NSVisualEffectView vibrancy layer; backdrop-
   filter samples the framebuffer (which is empty/transparent here), not
   the vibrancy layer underneath. Resize briefly invalidates the compositor
   cache and reveals the vibrancy layer for one frame.
   Pragmatic fix: skip backdrop-filter, lean on the alpha-tinted bg.
   The macOS vibrancy + wallpaper show through the alpha layer directly
   (unblurred, but visible). For the frost-blur look we'd need to either
   fork Obsidian's Electron flags or accept this limitation. */
.workspace {
  /* No editor tint — "transparent paper" position. The AppKit
     NSVisualEffectMaterial wash (dark in macOS dark mode, light in
     macOS light mode) sits between the wallpaper and the WebContents
     and absorbs any cyan tint below ~0.30 final alpha into perceptual
     noise. Past 0.30 the editor reads as a heavy tinted pane rather
     than vibrancy + accent. We commit to neither half: the editor is
     wallpaper + vibrancy as the reading substrate, and the theme's
     identity lives in heading colors, code chrome, modals, and the
     inner-edge highlight below — not in the editor body wash. To
     re-introduce a tint, raise the multiplier from 0; anchors:
        0.5 (final 0.13) modest glaze, 1.0 (final 0.26) modal-density,
        1.2 (final 0.31) "too heavy" per user. */
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0)} !important;
}

/* Modals / menus / popovers are SEPARATE stacking contexts (rendered
   above .workspace as siblings, not children) and small enough that
   Chromium's backdrop-filter handles them more consistently. Keep the
   blur here for the frosted-popover look. */
.modal,
.suggestion-container,
.menu,
.popover {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.9)} !important;
  backdrop-filter: blur(${glassBlur}) !important;
  -webkit-backdrop-filter: blur(${glassBlur}) !important;
}

/* Soft inner-edge highlight on the workspace, mirroring the widget cards. */
.workspace-leaf-content {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

/* ---------------------------------------------------------------------
 * Glass component treatments — adapted from the Glass Theme design
 * (~/Desktop/AIDB/_global/personal/mac-customization/glass-theme-design/
 * Glass Theme.html). The design's structural moves applied with THIS
 * theme's accent palette: h1 cyan and cardBg sky-blue replace the
 * design's deep-navy literals, so the look stays on-brand for whatever
 * theme is active. Every surface here is alpha-tinted (not opaque) so
 * vibrancy + wallpaper still bleed through every chrome layer — the
 * "transparent paper" position from the asar-patch plan is preserved.
 * --------------------------------------------------------------------- */

/* Inline code — translucent accent chip with thin border. Reading mode
   uses .markdown-rendered code:not(pre code); live preview wraps inline
   code in .cm-inline-code. */
.markdown-rendered code:not(pre code),
.cm-inline-code {
  background-color: ${withAlpha(h1Color, 0.14)} !important;
  color: ${h1Color} !important;
  border: 1px solid ${withAlpha(h1Color, 0.22)} !important;
  border-radius: 3px !important;
  padding: 1px 5px !important;
  font-size: 0.92em !important;
}

/* Code blocks — translucent card framed by the same accent border, with
   a soft inner top-edge highlight (matches widget cards). Inline-style
   chip is suppressed for children so the contents read as plain mono. */
.markdown-rendered pre {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.7)} !important;
  border: 1px solid ${withAlpha(h1Color, 0.18)} !important;
  border-radius: 8px !important;
  padding: 12px 14px !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
}
.markdown-rendered pre code {
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
  color: ${fg} !important;
  font-size: 12px;
}

/* Tables — wrap with rounded glass border, a heavier header row tint,
   an alternating-row tint, hover state. The first column gets monospace
   + accent color (the design's "ticket-id" treatment). border-collapse:
   separate is required for the rounded outer corners to actually clip. */
.markdown-rendered table {
  border-collapse: separate !important;
  border-spacing: 0 !important;
  border-radius: 10px !important;
  overflow: hidden !important;
  border: 1px solid ${withAlpha(h1Color, 0.18)} !important;
  width: 100%;
  margin: 16px 0 !important;
}
.markdown-rendered table thead tr {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 1.0)} !important;
}
.markdown-rendered table thead th {
  text-transform: uppercase;
  letter-spacing: 0.07em;
  font-size: 11px !important;
  font-weight: 600 !important;
  color: ${withAlpha(fg, 0.55)} !important;
  text-align: left !important;
  border-bottom: 1px solid ${withAlpha(h1Color, 0.20)} !important;
  padding: 9px 14px !important;
}
.markdown-rendered table tbody tr {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.5)} !important;
  transition: background 0.15s;
}
.markdown-rendered table tbody tr:hover {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.85)} !important;
}
.markdown-rendered table tbody tr + tr td {
  border-top: 1px solid ${withAlpha(h1Color, 0.08)} !important;
}
.markdown-rendered table td {
  padding: 9px 14px !important;
  font-size: 12px;
  color: ${withAlpha(fg, 0.78)} !important;
  vertical-align: top;
  border: none !important;
}
.markdown-rendered table td:first-child {
  font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", "SF Mono", Menlo, monospace;
  font-size: 11px;
  color: ${h1Color} !important;
}

/* Callouts (Obsidian's > [!note] / [!info] / [!warning] / etc.) —
   translucent card with thin border and a thicker accent-colored left
   edge. backdrop-filter works here because callouts are smaller stacking
   contexts (similar to modals — the same Chromium scope where
   backdrop-filter doesn't fight vibrancy). */
.markdown-rendered .callout {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 1.2)} !important;
  border: 1px solid ${withAlpha(h1Color, 0.16)} !important;
  border-left: 3px solid ${h1Color} !important;
  border-radius: 8px !important;
  backdrop-filter: blur(${glassBlur}) saturate(${glassSaturate}) !important;
  -webkit-backdrop-filter: blur(${glassBlur}) saturate(${glassSaturate}) !important;
}

/* Links — accent color + low-alpha underline. Tags excluded so they keep
   their pill / interactive styling. Targets reading-mode anchors and the
   live-preview link spans (cm-link for [text](url), cm-hmd-internal-link
   for [[wiki-style]]). */
.markdown-rendered a:not(.tag),
.markdown-rendered .internal-link,
.markdown-rendered .external-link,
.cm-link,
.cm-hmd-internal-link {
  color: ${h1Color} !important;
  text-decoration: none !important;
  border-bottom: 1px solid ${withAlpha(h1Color, 0.30)} !important;
  transition: color 0.1s, border-bottom-color 0.1s;
}
.markdown-rendered a:not(.tag):hover,
.markdown-rendered .internal-link:hover,
.markdown-rendered .external-link:hover {
  color: ${lighten(h1Color, 0.12)} !important;
  border-bottom-color: ${withAlpha(h1Color, 0.55)} !important;
}

/* Strong text — soften from full-white-bold to weight 600 at slightly
   translucent white, matching the design's understated emphasis. */
.markdown-rendered strong,
.cm-strong {
  color: ${withAlpha(fg, 0.92)} !important;
  font-weight: 600 !important;
}

/* ---------------------------------------------------------------------
 * AIDB hub right-sidebar treatment — same glass-card aesthetic as the
 * markdown tables above, applied to the plugin's bucket / ticket / PR /
 * doc list containers. Buckets become "tables", their titles become
 * "thead", ticket/PR/doc rows become "tbody tr", and the first-column
 * mono-cyan treatment lands on Jira keys / PR numbers. Outer
 * .aidb-hub-view stays transparent (forced by the inner-surfaces block
 * above) so the panel chrome shows vibrancy; cards float on top.
 * --------------------------------------------------------------------- */

.aidb-hub-bucket,
.aidb-hub-doc-list-container {
  border-radius: 10px !important;
  overflow: hidden !important;
  border: 1px solid ${withAlpha(h1Color, 0.18)} !important;
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.5)} !important;
  margin: 4px 2px 8px 2px !important;
}
.aidb-hub-doc-list {
  margin: 0 !important;
  padding: 0 !important;
  list-style: none !important;
}

/* Filter box at the top of AIDB Docs — its own translucent card framing
   the search input + chip row + secondary filters. */
.aidb-hub-filter-box {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.5)} !important;
  border: 1px solid ${withAlpha(h1Color, 0.18)} !important;
  border-radius: 10px !important;
  padding: 6px 8px !important;
  margin: 4px 2px 8px 2px !important;
}

.aidb-hub-bucket-title {
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-size: 11px !important;
  font-weight: 600 !important;
  color: ${withAlpha(fg, 0.55)} !important;
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 1.0)} !important;
  border-bottom: 1px solid ${withAlpha(h1Color, 0.20)} !important;
  padding: 7px 8px !important;
  margin: 0 !important;
}

.aidb-hub-pre-group-label {
  text-transform: uppercase;
  letter-spacing: 0.09em;
  font-size: 9.5px !important;
  font-weight: 600 !important;
  color: ${withAlpha(fg, 0.32)} !important;
  padding: 6px 8px 3px !important;
  background: transparent !important;
}

.aidb-hub-ticket-row,
.aidb-hub-pre-row,
.aidb-hub-doc-row {
  background-color: transparent !important;
  border-top: 1px solid ${withAlpha(h1Color, 0.07)} !important;
  padding: 6px 8px !important;
  transition: background 0.15s !important;
}
.aidb-hub-ticket-row:hover,
.aidb-hub-pre-row:hover,
.aidb-hub-doc-row:hover {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.7)} !important;
}

/* First-column mono-cyan — Jira keys, PR numbers, doc folder prefixes */
.aidb-hub-ticket-key {
  font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", "SF Mono", Menlo, monospace !important;
  color: ${h1Color} !important;
  font-size: 10.5px !important;
}

.aidb-hub-ticket-summary,
.aidb-hub-pre-title,
.aidb-hub-doc-title {
  color: ${withAlpha(fg, 0.78)} !important;
  font-size: 11.5px !important;
}

.aidb-hub-ticket-updated {
  font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", "SF Mono", Menlo, monospace !important;
  color: ${withAlpha(fg, 0.30)} !important;
  font-size: 9.5px !important;
}

.aidb-hub-doc-meta,
.aidb-hub-doc-folder {
  color: ${withAlpha(fg, 0.42)} !important;
  font-size: 10px !important;
}

/* Status pills — uppercase chips tinted by semantic color */
.aidb-hub-ticket-status {
  font-size: 9.5px !important;
  font-weight: 600 !important;
  padding: 2px 6px !important;
  border-radius: 4px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.05em !important;
  border: 1px solid transparent !important;
}
.aidb-hub-ticket-status.aidb-hub-status-new {
  background-color: ${withAlpha(h1Color, 0.18)} !important;
  color: ${h1Color} !important;
  border-color: ${withAlpha(h1Color, 0.25)} !important;
}
.aidb-hub-ticket-status.aidb-hub-status-indeterminate {
  background-color: ${withAlpha(warn, 0.18)} !important;
  color: ${warn} !important;
  border-color: ${withAlpha(warn, 0.25)} !important;
}
.aidb-hub-ticket-status.aidb-hub-status-done {
  background-color: ${withAlpha(success, 0.18)} !important;
  color: ${success} !important;
  border-color: ${withAlpha(success, 0.25)} !important;
}

/* Launch buttons — small accent button matching the design's launch-btn */
.aidb-hub-ticket-launch,
.aidb-hub-doc-launch {
  font-size: 9.5px !important;
  padding: 2px 7px !important;
  border-radius: 4px !important;
  background-color: ${withAlpha(h1Color, 0.15)} !important;
  color: ${h1Color} !important;
  border: 1px solid ${withAlpha(h1Color, 0.25)} !important;
  cursor: pointer !important;
  transition: background 0.12s, color 0.12s !important;
}
.aidb-hub-ticket-launch:hover,
.aidb-hub-doc-launch:hover {
  background-color: ${withAlpha(h1Color, 0.28)} !important;
  color: ${lighten(h1Color, 0.12)} !important;
}

/* Top header / timestamp — uppercase tracking, low contrast */
.aidb-hub-header {
  text-transform: uppercase !important;
  letter-spacing: 0.1em !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  color: ${withAlpha(fg, 0.45)} !important;
  padding: 10px 8px 8px !important;
  border-bottom: 1px solid ${withAlpha(h1Color, 0.10)} !important;
  background: transparent !important;
}
.aidb-hub-timestamp {
  color: ${withAlpha(fg, 0.30)} !important;
  font-size: 10px !important;
  font-family: ui-monospace, SFMono-Regular, "JetBrains Mono", "SF Mono", Menlo, monospace !important;
  text-transform: none !important;
  letter-spacing: 0 !important;
}

/* Inputs and selects — the plugin maps these to var(--background-secondary)
   which we set to a near-zero alpha tint; with most user themes installed
   that var gets overridden to white. Force translucent navy + cyan border
   directly so they read as theme-consistent glass chips, not pure-white
   blocks. Covers: top filter search + tag inputs, the top status select,
   and the per-row epic input + status select. */
.aidb-hub-search-input,
.aidb-hub-tag-filter,
.aidb-hub-row-epic-input,
.aidb-hub-status-select,
.aidb-hub-row-status-select {
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 0.7)} !important;
  color: ${fg} !important;
  border: 1px solid ${withAlpha(h1Color, 0.22)} !important;
  border-radius: 4px !important;
  font-size: 11px !important;
  padding: 4px 8px !important;
  outline: none !important;
}
.aidb-hub-search-input::placeholder,
.aidb-hub-tag-filter::placeholder,
.aidb-hub-row-epic-input::placeholder {
  color: ${withAlpha(fg, 0.35)} !important;
}
.aidb-hub-search-input:focus,
.aidb-hub-tag-filter:focus,
.aidb-hub-row-epic-input:focus,
.aidb-hub-status-select:focus,
.aidb-hub-row-status-select:focus {
  border-color: ${withAlpha(h1Color, 0.55)} !important;
  background-color: ${withAlpha(toHex(bgParsed), bgParsed.a * 1.0)} !important;
}
/* Selects need explicit appearance reset so the OS native control fades
   into the glass background. The native dropdown still opens normally. */
.aidb-hub-status-select,
.aidb-hub-row-status-select {
  appearance: none !important;
  -webkit-appearance: none !important;
  cursor: pointer !important;
  /* Tiny inline chevron via background-image so the menu indicator stays
     visible after appearance: none clears it. */
  background-image: linear-gradient(45deg, transparent 50%, ${withAlpha(h1Color, 0.55)} 50%),
                    linear-gradient(135deg, ${withAlpha(h1Color, 0.55)} 50%, transparent 50%) !important;
  background-position: calc(100% - 11px) 50%, calc(100% - 7px) 50% !important;
  background-size: 4px 4px, 4px 4px !important;
  background-repeat: no-repeat !important;
  padding-right: 20px !important;
}
.aidb-hub-status-select option,
.aidb-hub-row-status-select option {
  background-color: ${bgDeep} !important;
  color: ${fg} !important;
}

/* Chip filters (All / Plans / Notes / etc. row at top of AIDB Docs).
   Default: thin outline with low-alpha accent bg. Active: filled accent. */
.aidb-hub-chip {
  background-color: ${withAlpha(h1Color, 0.10)} !important;
  border: 1px solid ${withAlpha(h1Color, 0.22)} !important;
  color: ${withAlpha(fg, 0.75)} !important;
  border-radius: 12px !important;
  padding: 2px 10px !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  cursor: pointer !important;
  transition: background 0.12s, color 0.12s !important;
}
.aidb-hub-chip:hover {
  background-color: ${withAlpha(h1Color, 0.22)} !important;
  color: ${fg} !important;
}
.aidb-hub-chip.is-active {
  background-color: ${withAlpha(h1Color, 0.32)} !important;
  border-color: ${withAlpha(h1Color, 0.55)} !important;
  color: ${lighten(h1Color, 0.10)} !important;
}

/* Doc title link — accent-colored, weight 500, no underline by default
   (the doc rows already have their own row treatment, no need for
   underline-on-link to disambiguate). */
.aidb-hub-doc-title {
  color: ${h1Color} !important;
  font-weight: 500 !important;
  text-decoration: none !important;
  cursor: pointer !important;
}
.aidb-hub-doc-title:hover {
  color: ${lighten(h1Color, 0.12)} !important;
  text-decoration: underline !important;
}

/* Doc tag pill — small accent chip inline next to the meta row. */
.aidb-hub-doc-tag {
  font-size: 9.5px !important;
  padding: 1px 6px !important;
  border-radius: 10px !important;
  background-color: ${withAlpha(h1Color, 0.15)} !important;
  color: ${h1Color} !important;
  border: 1px solid ${withAlpha(h1Color, 0.25)} !important;
  margin-left: 4px !important;
}

/* Doc suffix badges — keep the plugin's per-type color hue but force
   translucent backgrounds so they read as glass chips, not opaque tiles.
   The plugin maps each suffix to var(--color-X) / var(--color-X-rgb);
   our snippet leaves those Obsidian defaults intact, so the colors stay
   per-type-distinct while picking up theme transparency. */
.aidb-hub-doc-suffix {
  border-radius: 3px !important;
  font-size: 10px !important;
  padding: 1px 6px !important;
  border: 1px solid currentColor !important;
  border-color: transparent !important;
}
`
    : ""
}`;

// ---------------------------------------------------------------------------
// Discover Obsidian vaults
// ---------------------------------------------------------------------------

const obsidianRegistryPath = join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");

let registry;
try {
  registry = JSON.parse(await readFile(obsidianRegistryPath, "utf8"));
} catch (e) {
  console.log(`(No Obsidian registry at ${obsidianRegistryPath} — Obsidian probably isn't installed. Skipping.)`);
  process.exit(0);
}

const vaults = Object.values(registry.vaults || {})
  .map((v) => v.path)
  .filter((p) => existsSync(p));

if (vaults.length === 0) {
  console.log("(No Obsidian vaults registered. Skipping.)");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write snippet + enable in appearance.json for each vault
// ---------------------------------------------------------------------------

const SNIPPET_NAME = "uber-theme";
let touched = 0;

for (const vaultPath of vaults) {
  const snippetsDir = join(vaultPath, ".obsidian", "snippets");
  const snippetFile = join(snippetsDir, `${SNIPPET_NAME}.css`);
  const appearanceFile = join(vaultPath, ".obsidian", "appearance.json");

  await mkdir(snippetsDir, { recursive: true });

  // Skip-if-unchanged for the CSS body
  let cssChanged = false;
  let existingCss = null;
  try {
    existingCss = await readFile(snippetFile, "utf8");
  } catch {
    // First write
  }
  if (existingCss !== css) {
    await writeFile(snippetFile, css, "utf8");
    cssChanged = true;
  }

  // Patch appearance.json to enable our snippet (preserves other fields).
  // Obsidian's enabledCssSnippets is an array of snippet names without the
  // .css extension. Missing field = no snippets enabled.
  let appearance = {};
  try {
    appearance = JSON.parse(await readFile(appearanceFile, "utf8"));
  } catch {
    // No appearance.json yet — Obsidian will create one, but we can seed it.
  }
  const enabled = Array.isArray(appearance.enabledCssSnippets) ? appearance.enabledCssSnippets : [];
  let appearanceChanged = false;
  if (!enabled.includes(SNIPPET_NAME)) {
    appearance.enabledCssSnippets = [...enabled, SNIPPET_NAME];
    await writeFile(appearanceFile, JSON.stringify(appearance, null, 2), "utf8");
    appearanceChanged = true;
  }

  if (cssChanged || appearanceChanged) {
    touched++;
    const reasons = [cssChanged ? "snippet" : null, appearanceChanged ? "enabled" : null]
      .filter(Boolean)
      .join(" + ");
    console.log(`Updated ${vaultPath} (${reasons})`);
  }
}

if (touched === 0) {
  console.log(`(${vaults.length} Obsidian vault(s) up-to-date — skipping write.)`);
} else {
  console.log(
    `Generated Obsidian uber-theme snippet for ${touched}/${vaults.length} vault(s)  (theme: ${themeName}, bg: ${bg}, accent: ${accent})`,
  );
}
