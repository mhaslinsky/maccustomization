// Liquid Glass (light frosted) — iOS 26 / macOS Tahoe inspired. Aggressive
// backdrop blur, low-alpha white translucent card, a specular inset highlight
// layered over a soft outer drop shadow, and pale near-white text that stays
// legible over arbitrary wallpapers. Per-widget tints are retained but
// lifted to soft pastels so the glass reads as the primary material.
//
// Paired with liquid-glass-dark.ts — same aesthetic, just a dark card base.

import type { AccentSpec, Icons, Layout, Primary, Status, WidgetAccent } from "./_types.js";

export const layout: Layout = {
  left: "24px",
  width: "220px",
  // Slightly bumped interior padding because a 20px radius visually eats
  // more space than the default's 14px.
  padding: "12px 14px 14px 14px",
  // Low-alpha neutral white. Alpha 0.18 lets the blur and wallpaper
  // color carry the look; higher starts feeling like a milky card.
  cardBg: "rgba(255, 255, 255, 0.18)",
  borderWidth: "1px",
  radius: "20px",
  // Four-layer shadow stack:
  //   1. inset top-edge highlight — the specular "glass material" tell
  //   2. inset full-perimeter inner glow (very subtle)
  //   3. large soft outer drop shadow for lift
  //   4. short contact shadow so cards feel anchored
  shadow:
    "inset 0 1px 0 rgba(255,255,255,0.45), inset 0 0 0 1px rgba(255,255,255,0.06), 0 14px 44px rgba(0,0,0,0.38), 0 2px 8px rgba(0,0,0,0.22)",
  fontStack: "-apple-system, SF Pro Display, Helvetica Neue, sans-serif",
  lineHeight: "1.44",
  // 1.5× the default's 12px. Enough to read as "frosted" while still
  // letting wallpaper shapes and color come through. Bump up to 22-26px
  // if the wallpaper reads too clearly; drop to 12-14px for a thinner
  // frost. Previously 30px, which dissolved detail too aggressively.
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
  // Pastel statuses — same semantic as default, pushed toward the pale register
  // so they don't look neon against the frost.
  good: "#a7f3d0",
  warn: "#fde68a",
  bad: "#fecaca",
};

export const primary: Primary = {
  // Luminous white-ish active border reads as "edge-lit glass" against any
  // wallpaper. Faint inactive is "unlit glass".
  active: "rgba(255, 255, 255, 0.72)",
  inactive: "rgba(255, 255, 255, 0.18)",
  // Thinner than default's 5px — glass edges look better hairline. Also
  // lets you tell the active theme at a glance by the window-border width.
  width: 3,
};

// Menu bar tint for Thaw. The primary.active is white (to match the
// window borders) but white at Ice's hardcoded 0.2 alpha is essentially
// invisible. Pick a saturated cool cyan (Tailwind sky-300) that reads as
// "frosty glass" and stays visible at 0.2 alpha on arbitrary wallpapers.
export const menuBarTint: string = "rgba(125, 211, 252, 1)";

export const icons: Icons = {};

export const accents: Record<WidgetAccent, AccentSpec> = {
  llm: {
    // Soft frost cyan — desaturated vs the default's neon cyan.
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
    // Warm pale peach — sun without sodium-lamp saturation.
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
    // Mint — cooler and paler than default's spring green.
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
    // Lavender — same hue family as default but lifted in value, lower chroma.
    border: "rgba(221, 214, 254, 0.55)",
    text: "#faf9ff",
    h1: "#ddd6fe",
    h2Muted: "rgba(250, 249, 255, 0.76)",
    smallMuted: "rgba(250, 249, 255, 0.82)",
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
};
