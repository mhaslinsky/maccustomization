// Catppuccin Macchiato — soft pastel accents on a muted dark card. Same
// layout geometry as the default theme; only the palette differs. Mauve is
// the brand accent (window borders + menu bar tint) to match Catppuccin's
// canonical identity color. Per-widget accents map to Sky / Peach / Green /
// Mauve so each widget keeps a distinct hue without neon saturation.
//
// Palette reference: https://catppuccin.com/palette (Macchiato flavor).

import type { AccentSpec, Controls, Icons, Layout, Primary, Status, WidgetAccent } from "./_types.js";

// Codegen-side perceptual knobs. Empty here because catppuccin-macchiato is
// opaque — Warp's image-background path is gated on `isGlassTheme`.
export const controls: Controls = {};

export const layout: Layout = {
  left: "24px",
  width: "220px",
  padding: "11px 13px 13px 13px",
  // Macchiato Base (#24273a) at 0.92 alpha — same translucency register as
  // the default theme's near-black card, just warmed toward the blue-violet
  // Catppuccin base.
  cardBg: "rgba(36, 39, 58, 0.92)",
  borderWidth: "2px",
  radius: "14px",
  shadow: "0 12px 28px rgba(0,0,0,0.38)",
  // Inter is the de-facto Catppuccin UI font. Falls back to SF Pro on macOS
  // if Inter isn't installed, then Helvetica Neue. All three render the
  // geometry similarly at widget sizes, so no layout shift on fallback.
  //
  // Nerd Fonts are listed as *tail* fallbacks — the browser does per-character
  // font fallback, so Latin text stays in Inter and only Private Use Area
  // codepoints (the icon glyphs in `icons` below) pull from a Nerd Font.
  // "Hack Nerd Font" is listed first because the current machine already has
  // it installed; "Symbols Nerd Font" is the canonical icons-only option
  // (brew install --cask font-symbols-only-nerd-font) for anyone who doesn't
  // want a full patched font. If none are installed, glyphs render as
  // .notdef boxes and the rest of the widget still works.
  fontStack:
    "Inter, -apple-system, SF Pro Display, Helvetica Neue, \"Hack Nerd Font\", \"Hack Nerd Font Propo\", \"Symbols Nerd Font\", \"SymbolsNerdFont\", sans-serif",
  lineHeight: "1.42",
  blur: "12px",
  h1Size: "19px",
  h1LineHeight: "1.2",
  h1MarginBottom: "6px",
  h2Size: "10px",
  h2LetterSpacing: "0.11em",
  bodySize: "12px",
  bodyMargin: "4px 0",
  smallSize: "10px",
  smallLineHeight: "1.4",
  footerMarginTop: "10px",
  textShadow: "",
};

export const status: Status = {
  good: "#a6da95", // Macchiato Green
  warn: "#eed49f", // Macchiato Yellow
  bad: "#ed8796",  // Macchiato Red
};

export const primary: Primary = {
  // Macchiato Mauve — Catppuccin's canonical "brand" hue.
  active: "rgba(198, 160, 246, 0.85)",
  // Macchiato Overlay0 — desaturated gray-blue for unfocused windows.
  inactive: "rgba(110, 115, 141, 0.55)",
  width: 5,
};

// Mauve at full alpha for the menu bar tint (Ice forces 0.2 alpha on the
// main bar, so this must be saturated to stay visible).
export const menuBarTint: string = "rgba(198, 160, 246, 1)";

// Nerd Font glyphs prepended to each widget's h1 title. Uses FontAwesome v4
// Private Use Area codepoints that ship in every Nerd Font patched build:
//   \uf21e heartbeat  — Status
//   \uf185 sun        — Weather
//   \uf073 calendar   — Calendar
//   \uf001 music note — Now Playing
// Requires Symbols Nerd Font (or any Nerd-patched font) installed; see the
// fontStack comment above.
export const icons: Icons = {
  status: "\uf21e",
  weather: "\uf185",
  calendar: "\uf073",
  nowplaying: "\uf001",
  keepawake: "\uf06e",
};

// Body/muted text colors are unified across all four widgets to Catppuccin's
// canonical semantic hierarchy — Text (#cad3f5) / Subtext1 (#b8c0e0) /
// Subtext0 (#a5adcb). This gives the whole stack Catppuccin's signature
// slightly-blue-lavender cast instead of the near-white tints. The
// per-widget distinction lives entirely on the accent color (border + h1),
// where Sky / Peach / Green / Mauve keep each widget readable at a glance.
const TEXT = "#cad3f5";
const SUBTEXT1 = "rgba(184, 192, 224, 0.82)"; // Subtext1 for h2 labels
const SUBTEXT0 = "rgba(165, 173, 203, 0.78)"; // Subtext0 for small meta

export const accents: Record<WidgetAccent, AccentSpec> = {
  status: {
    border: "rgba(145, 215, 227, 0.7)", // Sky
    text: TEXT,
    h1: "#91d7e3", // Sky
    h2Muted: SUBTEXT1,
    smallMuted: SUBTEXT0,
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  weather: {
    border: "rgba(245, 169, 127, 0.6)", // Peach
    text: TEXT,
    h1: "#f5a97f", // Peach
    h2Muted: SUBTEXT1,
    smallMuted: SUBTEXT0,
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  calendar: {
    border: "rgba(166, 218, 149, 0.6)", // Green
    text: TEXT,
    h1: "#a6da95", // Green
    h2Muted: SUBTEXT1,
    smallMuted: SUBTEXT0,
    h2Margin: "0 0 5px 0",
    showWarn: false,
    smallExtra: "margin: 4px 0;",
  },
  nowplaying: {
    border: "rgba(198, 160, 246, 0.6)", // Mauve
    text: TEXT,
    h1: "#c6a0f6", // Mauve
    h2Muted: SUBTEXT1,
    smallMuted: SUBTEXT0,
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
  keepawake: {
    border: "rgba(166, 218, 149, 0.6)", // Green
    text: TEXT,
    h1: "#a6da95", // Green
    h2Muted: SUBTEXT1,
    smallMuted: SUBTEXT0,
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
};
