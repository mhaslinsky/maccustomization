// Obsidian glass — the heavier, matte-black-hardware cousin of
// liquid-glass-dark. Same structural idiom (translucent card, backdrop
// blur, specular highlight, inset hairline) but tuned away from frosty
// translucent and toward dense, smoked obsidian. The card is ~2.5×
// more opaque (0.62 vs 0.26 alpha), the blur is heavier (26px vs 18px),
// the white inset highlight is pulled way back so it doesn't pop as a
// bright line on a near-solid card, and the accents are a near-
// monochrome grayscale ramp — per-widget temperature variation
// (cool/warm/neutral/violet) instead of a pastel rainbow.

import type { AccentSpec, Icons, Layout, Primary, Status, WidgetAccent } from "./_types.js";

export const layout: Layout = {
  left: "10px",
  // Wider than the other glass themes' 190px — SF Mono's fixed-width
  // glyphs need the extra room so widget lines don't wrap.
  width: "210px",
  padding: "12px 14px 14px 14px",
  // Near-black, warmer-neutral (10,12,16 — barely off pure black, no
  // blue tint) at 0.62 alpha. Reads as a solid object on the wallpaper
  // with the blur doing the "glass" work, not the transparency.
  cardBg: "rgba(10, 12, 16, 0.62)",
  borderWidth: "1px",
  // Tighter than the other glass themes' 20px — a smaller radius reads as
  // machined / hardware rather than soft iOS-bubble, which suits the
  // denser dark card and the monospace type.
  radius: "8px",
  // Same four-layer stack as the other glass variants, but with the
  // white inset highlight pulled WAY back (0.16 vs 0.45). At 0.45 the
  // highlight reads as a bright line across the top of a near-opaque
  // dark card; 0.16 keeps just enough lift to suggest a beveled edge.
  // Drop shadows are deepened slightly to compensate for the heavier
  // card sitting more like a physical object on the wallpaper.
  shadow:
    "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 0 0 1px rgba(255,255,255,0.05), 0 18px 52px rgba(0,0,0,0.5), 0 3px 10px rgba(0,0,0,0.3)",
  // Monospace, not the system humanist sans the other themes use — the
  // fixed-width "terminal / instrument panel" read is the point of this
  // theme. SF Mono ships on every Mac; the rest are fallbacks.
  fontStack: '"SF Mono", ui-monospace, Menlo, monospace',
  lineHeight: "1.44",
  // 26px vs liquid-glass-dark's 18px. Heavier blur is what keeps the
  // higher card opacity from reading as opaque — the wallpaper bleeds
  // through as a soft, smoked haze rather than crisp shapes.
  blur: "26px",
  // Type scale runs ~1-2px smaller than the other glass themes — SF Mono
  // is wider than the system humanist sans, so the same point sizes would
  // crowd the 190px card.
  h1Size: "17px",
  h1LineHeight: "1.2",
  h1MarginBottom: "6px",
  h2Size: "9px",
  h2LetterSpacing: "0.08em",
  bodySize: "11px",
  bodyMargin: "4px 0",
  smallSize: "9px",
  smallLineHeight: "1.4",
  footerMarginTop: "10px",
  textShadow: "0 1px 3px rgba(0, 0, 0, 0.55)",
};

// Semantic, not decorative — kept legible. Same pastels as
// liquid-glass-dark so good/warn/bad read the same across themes.
export const status: Status = {
  good: "#a7f3d0",
  warn: "#fde68a",
  bad: "#fecaca",
};

export const primary: Primary = {
  // White-ish window borders work equally well framing a denser glass
  // card. Kept identical to liquid-glass-dark.
  active: "rgba(255, 255, 255, 0.72)",
  inactive: "rgba(255, 255, 255, 0.18)",
  width: 3,
};

// Cool steel-gray. Ice forces the main bar tint to 0.2 alpha in
// drawTint(), so the value must be saturated enough to survive — a
// neutral mid-gray would wash out. Steel-blue keeps a cool reading
// without introducing color the rest of the theme doesn't have.
export const menuBarTint: string = "rgba(176, 196, 222, 1)";

export const icons: Icons = {};

// Near-monochrome accents. Body text (`text`) is uniform across all
// four widgets — only the title color and border pick up a per-widget
// temperature (cool slate / warm beige / pure neutral / cool violet)
// so widgets stay distinguishable at a glance without the pastel
// rainbow.
export const accents: Record<WidgetAccent, AccentSpec> = {
  status: {
    // Cool slate — leans blue-gray for the "system status" widget.
    border: "rgba(176, 190, 197, 0.45)",
    text: "#f1f1f3",
    h1: "#cfd8dc",
    h2Muted: "rgba(241, 241, 243, 0.78)",
    smallMuted: "rgba(241, 241, 243, 0.82)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  weather: {
    // Warm beige — the only widget with any warmth, to nudge "sun /
    // sky" without being a literal orange.
    border: "rgba(200, 184, 164, 0.45)",
    text: "#f1f1f3",
    h1: "#e8e0d4",
    h2Muted: "rgba(241, 241, 243, 0.78)",
    smallMuted: "rgba(241, 241, 243, 0.82)",
    h2Margin: "10px 0 5px 0",
    showWarn: true,
    smallExtra: "",
  },
  calendar: {
    // Pure neutral — the most "graphite" of the four.
    border: "rgba(200, 200, 200, 0.45)",
    text: "#f1f1f3",
    h1: "#dddddd",
    h2Muted: "rgba(241, 241, 243, 0.76)",
    smallMuted: "rgba(241, 241, 243, 0.82)",
    h2Margin: "0 0 5px 0",
    showWarn: false,
    smallExtra: "margin: 4px 0;",
  },
  nowplaying: {
    // Cool violet-gray — the faintest hue lift, kept because
    // "nowplaying" wants a tiny bit of personality even in monochrome.
    border: "rgba(180, 170, 190, 0.45)",
    text: "#f1f1f3",
    h1: "#d8d4dc",
    h2Muted: "rgba(241, 241, 243, 0.76)",
    smallMuted: "rgba(241, 241, 243, 0.82)",
    h2Margin: "8px 0 4px 0",
    showWarn: false,
    smallExtra: "",
  },
};
