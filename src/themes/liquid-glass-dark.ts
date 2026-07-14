// Liquid Glass (smoked dark) — the macOS Control Center / Notification Center
// idiom. Same aesthetic as liquid-glass.ts (aggressive blur, specular highlight,
// pastel accents) but built on a near-black translucent card instead of white.
// Better text legibility over bright / busy wallpapers; less literally
// "iOS 26 Liquid Glass" but closer to what Apple ships for dark-mode surfaces.

import type { AccentSpec, Controls, Icons, Layout, Primary, Status, WidgetAccent } from "./_types.js";

// Codegen-side perceptual knobs. Glass themes pin all three Warp values
// explicitly (even at codegen defaults) so a future UI sees a uniform
// surface across all glass themes — every slider is always populated.
export const controls: Controls = {
  warp: {
    bgImageOpacity: 20,
    noiseAlphaMax: 140,
    noiseDarkProb: 0.5,
  },
};

export const layout: Layout = {
  left: "10px",
  width: "190px",
  padding: "12px 14px 14px 14px",
  // The only substantive delta from liquid-glass.ts. Near-black at 0.26
  // alpha — more see-through than the prior 0.42 while still keeping
  // text legible over bright wallpapers.
  cardBg: "rgba(18, 22, 30, 0.26)",
  borderWidth: "1px",
  radius: "20px",
  // Same four-layer stack as the light variant. The white inset highlight
  // pops even more against a dark base.
  shadow:
    "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 0 0 1px rgba(255,255,255,0.06), 0 14px 44px rgba(0,0,0,0.38), 0 2px 8px rgba(0,0,0,0.22)",
  fontStack: "-apple-system, SF Pro Display, Helvetica Neue, sans-serif",
  lineHeight: "1.44",
  // Kept in sync with liquid-glass.ts — see that file for the tuning notes.
  blur: "18px",
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
  textShadow: "0 1px 3px rgba(0, 0, 0, 0.4)",
};

export const status: Status = {
  good: "#a7f3d0",
  warn: "#fde68a",
  bad: "#fecaca",
};

export const primary: Primary = {
  // Same white-ish window borders as the light variant — luminous glass
  // edges work equally well framing dark-glass widgets.
  active: "rgba(255, 255, 255, 0.72)",
  inactive: "rgba(255, 255, 255, 0.18)",
  width: 3,
};

// Menu bar tint for Thaw. Same frost cyan as the light glass variant —
// Ice's main bar tint gets forced to 0.2 alpha so a saturated cyan reads
// clearly while still matching the cool palette of the glass aesthetic.
export const menuBarTint: string = "rgba(125, 211, 252, 1)";

export const icons: Icons = {};

export const accents: Record<WidgetAccent, AccentSpec> = {
  status: {
    border: "rgba(186, 230, 253, 0.55)",
    text: "#f5fbff",
    h1: "#bae6fd",
    h2Muted: "rgba(245, 251, 255, 0.78)",
    smallMuted: "rgba(245, 251, 255, 0.82)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  weather: {
    border: "rgba(254, 215, 170, 0.55)",
    text: "#fff8f1",
    h1: "#fed7aa",
    h2Muted: "rgba(255, 248, 241, 0.78)",
    smallMuted: "rgba(255, 248, 241, 0.82)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  calendar: {
    border: "rgba(167, 243, 208, 0.55)",
    text: "#f3fdf8",
    h1: "#a7f3d0",
    h2Muted: "rgba(243, 253, 248, 0.76)",
    smallMuted: "rgba(243, 253, 248, 0.82)",
    h2Margin: "0 0 5px 0",
    showWarn: false,
    smallExtra: "margin: 4px 0;",
  },
  nowplaying: {
    border: "rgba(221, 214, 254, 0.55)",
    text: "#faf9ff",
    h1: "#ddd6fe",
    h2Muted: "rgba(250, 249, 255, 0.76)",
    smallMuted: "rgba(250, 249, 255, 0.82)",
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
  keepawake: {
    // Mint — the green "awake" accent, value-lifted to match the glass set.
    border: "rgba(167, 243, 208, 0.55)",
    text: "#faf9ff",
    h1: "#a7f3d0",
    h2Muted: "rgba(250, 249, 255, 0.76)",
    smallMuted: "rgba(250, 249, 255, 0.82)",
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
};
