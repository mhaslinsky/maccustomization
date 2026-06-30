// Default theme — the baseline look. Cyan/amber/green/purple per-widget
// accents on a near-black translucent card, with a cyan primary for window
// borders. Preserved verbatim so we can always switch back to it when
// experimenting with other themes.

import type { AccentSpec, Controls, Icons, Layout, Primary, Status, WidgetAccent } from "./_types.js";

// Codegen-side perceptual knobs that don't fit the semantic-token model
// below. Empty here because the default theme is opaque — Warp's
// image-background path is gated on `isGlassTheme` and the knobs are moot.
export const controls: Controls = {};

export const layout: Layout = {
  left: "24px",
  width: "220px",
  padding: "11px 13px 13px 13px",
  cardBg: "rgba(7, 10, 18, 0.92)",
  borderWidth: "2px",
  radius: "14px",
  shadow: "0 12px 28px rgba(0,0,0,0.38)",
  fontStack: "Helvetica Neue, Arial, sans-serif",
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
  good: "#86efac",
  warn: "#fde68a",
  bad: "#fca5a5",
};

export const primary: Primary = {
  active: "rgba(34, 211, 238, 0.85)",
  // Matches the nowplaying (Spotify) widget accent — rgba(167, 139, 250, 0.55).
  inactive: "rgba(167, 139, 250, 0.55)",
  width: 5,
};

// Menu bar tint consumed by the Thaw codegen. Ice forces 0.2 alpha on the
// main bar tint, so this should be a saturated full-alpha color — the RGB
// is what shows through. Bright cyan matches the status widget accent and
// reads clearly as "the default theme's color" on the menu bar.
export const menuBarTint: string = "rgba(34, 211, 238, 1)";

// No icons in the default theme — keeps the h1 titles as plain text.
export const icons: Icons = {};

export const accents: Record<WidgetAccent, AccentSpec> = {
  status: {
    border: "rgba(34, 211, 238, 0.7)",
    text: "#e6f7ff",
    h1: "#67e8f9",
    h2Muted: "rgba(214, 240, 255, 0.68)",
    smallMuted: "rgba(214, 240, 255, 0.72)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  weather: {
    border: "rgba(251, 191, 36, 0.55)",
    text: "#fff7ed",
    h1: "#fcd34d",
    h2Muted: "rgba(255, 247, 237, 0.68)",
    smallMuted: "rgba(255, 247, 237, 0.72)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  calendar: {
    border: "rgba(52, 211, 153, 0.55)",
    text: "#ecfdf5",
    h1: "#6ee7b7",
    h2Muted: "rgba(236, 253, 245, 0.65)",
    smallMuted: "rgba(236, 253, 245, 0.72)",
    h2Margin: "0 0 5px 0",
    showWarn: false,
    smallExtra: "margin: 4px 0;",
  },
  nowplaying: {
    border: "rgba(167, 139, 250, 0.55)",
    text: "#f5f3ff",
    h1: "#c4b5fd",
    h2Muted: "rgba(245, 243, 255, 0.65)",
    smallMuted: "rgba(245, 243, 255, 0.72)",
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
  keepawake: {
    // Emerald — "stay awake / active" reads green, and stays distinct from
    // the violet nowplaying card directly above it in the stack.
    border: "rgba(110, 231, 183, 0.55)",
    text: "#f5f3ff",
    h1: "#6ee7b7",
    h2Muted: "rgba(245, 243, 255, 0.65)",
    smallMuted: "rgba(245, 243, 255, 0.72)",
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
};

