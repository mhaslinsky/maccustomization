// Frutiger Aero — the 2004–2013 Web 2.0 Gloss aesthetic that defined
// Windows Vista/7 Aero, Wii, PS3 XMB, and iOS 1–6. Bright sky blues,
// glossy greens, warm sunlight yellows, translucent aqua glass, and
// bubble/bokeh optimism. Colors sourced from the documented Frutiger
// Aero palettes on color-hex (sky/aqua blue #0689E4, glossy green
// #71AB23, warm yellow #FBB905, orange #D55E0F) plus the Aero Blues
// set (#38ABE4, #69CFFF, #85CFEE, #7F9DDA).
//
// Card material is a cool sky-tinted frost — leans on the Aero Glass
// tradition (translucent panes over nature/sky imagery). Pairs well
// with a bright wallpaper (clouds, water, green fields); can read a
// little cool over dark wallpapers, which is on-brand.

import type { AccentSpec, Icons, Layout, Primary, Status, WidgetAccent } from "./_types.js";

export const layout: Layout = {
  left: "24px",
  width: "220px",
  padding: "12px 14px 14px 14px",
  // Sky-blue tinted glass. Same alpha discipline as liquid-glass so
  // the wallpaper carries through, but with a cool cyan cast that
  // reads as "Aero Glass" instead of neutral frost.
  cardBg: "rgba(133, 207, 238, 0.26)",
  borderWidth: "1px",
  radius: "16px",
  // Classic Aero shine: strong specular top-edge highlight + soft
  // perimeter inner glow + large lift shadow + contact shadow.
  shadow:
    "inset 0 1px 0 rgba(255,255,255,0.65), inset 0 0 0 1px rgba(255,255,255,0.10), 0 14px 36px rgba(6, 137, 228, 0.28), 0 2px 8px rgba(0,0,0,0.22)",
  fontStack: "-apple-system, SF Pro Display, Helvetica Neue, Arial, sans-serif",
  lineHeight: "1.44",
  blur: "16px",
  // Aero "deepened color through frost" — pulls wallpaper saturation up
  // through the glass so the cool sky tint reads as glossy rather than
  // washed out. Lifted from a Claude Design Frutiger Aero terminal mock
  // that paired blur with saturate(1.45) for the canonical glass look.
  backdropSaturate: 1.45,
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
  // Three-layer halo behind glyphs — thin outline + drop shadow + diffuse
  // glow. Single-layer drop shadows wash out on Bliss-style busy wallpapers
  // (bright clouds/grass directly behind text); the outline + glow do the
  // reading work while the glass stays at 26% so the wallpaper still bleeds
  // through. Tuned in a Claude Design mock against three wallpapers.
  textShadow:
    "0 0 1px rgba(0,0,0,0.55), 0 1px 2px rgba(0,15,40,0.6), 0 0 8px rgba(0,15,40,0.35)",
};

export const status: Status = {
  // Glossy green / warm yellow / coral — nature-palette variants of
  // the semantic trio. Mint and amber both lifted from the canonical
  // documented values (#a8e4a0 / #fbb905) toward higher-luminance
  // siblings (Tailwind green-300 / amber-300) — the originals read as
  // "pastel mint that blends into blue-gray" and "muddy school-bus
  // amber" against Obsidian's dark vibrancy material wash. Hue family
  // is preserved; saturation and luminance are pushed past the wash.
  // Coral kept as-is — it already pops on dark.
  good: "#86efac",
  warn: "#fcd34d",
  bad: "#f87171",
};

export const primary: Primary = {
  // Sky/aqua blue — the canonical Frutiger Aero hero color.
  active: "rgba(6, 137, 228, 0.85)",
  // Glossy green companion — keeps unfocused windows on-theme without
  // dropping to neutral gray.
  inactive: "rgba(113, 171, 35, 0.55)",
  width: 4,
};

// Saturated sky-blue for the menu bar. Ice forces 0.2 alpha on the
// main bar tint, so this needs to be bright enough to read through
// that cap — #0689E4 is the core palette color and stays legible at
// 20% alpha on most wallpapers.
export const menuBarTint: string = "rgba(6, 137, 228, 1)";

export const icons: Icons = {};

export const accents: Record<WidgetAccent, AccentSpec> = {
  status: {
    // Sky blue — the signature Aero hue. Pulled to the saturated end of
    // the documented Aero Blues (#69CFFF) instead of pastel #a8e6ff. The
    // pastel reads as "another shade of blue-gray" on a dark vibrancy
    // wash (Obsidian dark mode); #69CFFF is bright enough to stay legible
    // on the sky-tinted glass card AND to register as cyan-not-gray when
    // the same accent flows into Obsidian over the AppKit material wash.
    // See .claude/skills/obsidian-theme/SKILL.md "Vibrancy material" notes.
    border: "rgba(56, 171, 228, 0.70)",
    text: "#ffffff",
    h1: "#69cfff",
    h2Muted: "rgba(240, 250, 255, 0.88)",
    smallMuted: "rgba(240, 250, 255, 0.92)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  weather: {
    // Warm sunlight yellow — h1 lifted from amber #fbb905 to brighter
    // #fcd34d (Tailwind amber-300) so the heading reads as "sunshine
    // pop" rather than "muddy school-bus gold" against the dark
    // vibrancy wash. Border kept at the canonical documented #fbb905
    // (saturated palette anchor) so widget cards retain the layered
    // "saturated source / luminous heading" feel of the other accents.
    border: "rgba(251, 185, 5, 0.60)",
    text: "#fffaf0",
    h1: "#fcd34d",
    h2Muted: "rgba(255, 250, 240, 0.88)",
    smallMuted: "rgba(255, 250, 240, 0.92)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  calendar: {
    // Glossy grass green — h1 lifted from pastel #a8e4a0 to more
    // saturated #86efac (Tailwind green-300) so it registers as "vivid
    // mint" rather than "blue-gray-with-a-tint" on Obsidian's dark
    // vibrancy wash. Border kept at the canonical documented #71AB23
    // ("glossy green") so widget cards retain the saturated source /
    // luminous heading layering.
    border: "rgba(113, 171, 35, 0.60)",
    text: "#f2fbe8",
    h1: "#86efac",
    h2Muted: "rgba(242, 251, 232, 0.88)",
    smallMuted: "rgba(242, 251, 232, 0.92)",
    h2Margin: "0 0 5px 0",
    showWarn: false,
    smallExtra: "margin: 4px 0;",
  },
  nowplaying: {
    // Periwinkle/cornflower — the cool-violet edge of the Aero Blues
    // palette. Bumped saturation (#a8bdf0 → #b8c5f5) so it stays distinct
    // from the dark vibrancy wash without abandoning the periwinkle family.
    // Pure periwinkle gets eaten by the AppKit material's bluish-gray cast
    // in dark mode; a slightly more chromatic shade survives that absorb.
    border: "rgba(127, 157, 218, 0.60)",
    text: "#f4f6ff",
    h1: "#b8c5f5",
    h2Muted: "rgba(244, 246, 255, 0.88)",
    smallMuted: "rgba(244, 246, 255, 0.92)",
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
};
