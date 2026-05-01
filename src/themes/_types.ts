// Shared theme contract. Every theme in this directory must export an
// object matching `Theme` (via its `accents`, `layout`, `status`, `primary`
// named exports). Type-check is the only thing stopping a new theme from
// silently dropping a field — so keep these types tight.

export type WidgetAccent = "status" | "weather" | "calendar" | "nowplaying";

export type AccentSpec = {
  border: string;
  text: string;
  h1: string;
  h2Muted: string;
  smallMuted: string;
  h2Margin: string;
  showWarn: boolean;
  smallExtra: string;
};

export type Layout = {
  left: string;
  width: string;
  padding: string;
  cardBg: string;
  borderWidth: string;
  radius: string;
  shadow: string;
  fontStack: string;
  lineHeight: string;
  blur: string;
  // Optional `saturate()` factor appended to backdrop-filter alongside
  // `blur(...)`. Boosts wallpaper saturation through the glass — the Aero
  // "deepened color through frost" look. 1.0 (or unset) = no change; values
  // >1 deepen colors; the design mock landed on 1.45 for frutiger-aero.
  backdropSaturate?: number;
  h1Size: string;
  h1LineHeight: string;
  h1MarginBottom: string;
  h2Size: string;
  h2LetterSpacing: string;
  bodySize: string;
  bodyMargin: string;
  smallSize: string;
  smallLineHeight: string;
  footerMarginTop: string;
  textShadow: string;
};

export type Status = {
  good: string;
  warn: string;
  bad: string;
};

// The canonical "brand" accent consumed by cross-program customization tools
// (currently JankyBorders). `width` is in pixels and is intentionally
// independent of `layout.borderWidth` (widget card borders vs window borders).
export type Primary = {
  active: string;
  inactive: string;
  width: number;
};

// Dedicated menu bar tint color consumed by the Thaw codegen. Separate from
// `primary.active` because Ice (Thaw's upstream) hardcodes the main menu bar
// tint to 20% alpha in `drawTint()`, so whatever color lands here needs to
// be a saturated / bright value that stays visible at 0.2 alpha on arbitrary
// wallpapers. Translucent primary accents (e.g. the white `rgba(255,255,255,
// 0.72)` used by the liquid-glass themes) disappear into the wallpaper at
// 20% alpha, so themes need to pick a distinct color here if they want the
// main menu bar to actually reflect the theme. The alpha channel in this
// value is effectively ignored by Ice's main-bar renderer (it replaces
// alpha with 0.2), so callers should just set alpha to 1 — the RGB is
// what matters.
export type MenuBarTint = string;

// Per-widget glyphs prepended to each widget's h1 title. Intended for Nerd
// Font private-use-area codepoints (U+E000..U+F8FF and the adjacent
// supplementary ranges). Themes that want icons should populate this map
// AND append an icon-providing font to `layout.fontStack` as a tail
// fallback (e.g. "Symbols Nerd Font"). Unset / empty map = no icons
// rendered — each widget's h1 shows just the text, which is the behavior
// for every theme that predates the icons token.
export type Icons = Partial<Record<WidgetAccent, string>>;

export type Theme = {
  accents: Record<WidgetAccent, AccentSpec>;
  layout: Layout;
  status: Status;
  primary: Primary;
  menuBarTint: MenuBarTint;
  icons: Icons;
};
