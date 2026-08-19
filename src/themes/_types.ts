// Shared theme contract. Every theme in this directory must export an
// object matching `Theme` (via its `accents`, `layout`, `status`, `primary`
// named exports). Type-check is the only thing stopping a new theme from
// silently dropping a field — so keep these types tight.

export type WidgetAccent = "status" | "weather" | "calendar" | "nowplaying" | "keepawake";

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
  // Defaults to true. False omits both backdrop filters and their keepalive.
  backdropFilterEnabled?: boolean;
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

// Per-consumer perceptual tuning knobs. Every field is optional and the
// associated codegen falls back to its built-in default when a value is
// omitted. Themes that don't need to tune anything export `controls = {}`.
//
// JSDoc `@min / @max / @step / @description` tags on the field types are
// free metadata for a future "human-manipulable" UI to introspect ranges
// and labels without a parallel schema object.
export type Controls = {
  warp?: WarpControls;
  thaw?: ThawControls;
};

// Per-theme knobs for the Thaw menu bar codegen (scripts/build-thaw-theme.mjs).
// All optional; the codegen preserves Thaw's existing values for any field a
// theme doesn't set. A theme that omits `thaw` entirely keeps the pre-2.0
// tint-only behavior (tint + border + gradient driven, background untouched).
export type ThawControls = {
  /**
   * Menu bar background material kind, mapped to Thaw's `MenuBarBackgroundKind`
   * (none / solid / gradient / glass / adaptive). Omit to leave Thaw's
   * background kind untouched — only tint/border/gradient are driven, which is
   * the behavior that predates Thaw 2.0's configurable background. Set to
   * `"glass"` to make the menu bar a glass material matching the widget cards.
   * @description "Menu bar background"
   */
  background?: "none" | "solid" | "gradient" | "glass" | "adaptive";
  /**
   * Glass material style (`MenuBarGlassStyle`) applied to both the tint and
   * background glass surfaces when their kind is `glass`. `regular` = standard
   * frosted glass; `clear` = lighter/clearer. No effect unless a glass kind is
   * in play.
   * @description "Glass style"
   */
  glassStyle?: "regular" | "clear";
  /**
   * Tint overlay opacity, 0..1. Thaw 2.0 exposes this as a real `tintOpacity`
   * field — Ice's old hardcoded 0.2 alpha cap in `drawTint()` is gone, so
   * values above 0.2 now actually take effect. Omit to keep Thaw's current
   * tint opacity.
   * @min 0 @max 1 @step 0.05
   * @description "Menu bar tint opacity"
   */
  tintOpacity?: number;
  /**
   * Background material opacity, 0..1. Only applied when `background` is set.
   * Omit to default to the alpha channel of `layout.cardBg`.
   * @min 0 @max 1 @step 0.05
   * @description "Menu bar background opacity"
   */
  backgroundOpacity?: number;
};

export type WarpControls = {
  /**
   * Opacity of the generated background JPEG that glass themes reference
   * from `~/.warp/themes/uber-<theme>.yaml` via `background_image.opacity`.
   * Higher = grainy gradient image dominates; lower = wallpaper bleeds
   * through more. Codegen default lives in `scripts/build-warp-theme.mjs`.
   * No effect on non-glass themes — Warp's image-background path is gated
   * on `isGlassTheme`.
   * @min 0 @max 100 @step 1
   * @description "Warp BG image opacity"
   */
  bgImageOpacity?: number;
  /**
   * Peak alpha (0–255) of the salt-and-pepper film grain composited into
   * the background JPEG. Higher = grainier surface. Codegen default lives
   * in `scripts/generate-warp-bg.mjs`. Has to survive Warp's `OverrideOpacity`
   * multiplier — see the warp-terminal SKILL.md "Salt-and-pepper noise vs.
   * window opacity" section before pushing it below ~70 at low OverrideOpacity.
   * @min 0 @max 255 @step 1
   * @description "Film grain intensity"
   */
  noiseAlphaMax?: number;
  /**
   * Fraction of grain pixels that darken vs. brighten the surface (0–1).
   * 0.5 = balanced salt-and-pepper. >0.5 = darker grain (helps text against
   * bright wallpapers). <0.5 = brighter / "dustier" grain.
   * @min 0 @max 1 @step 0.05
   * @description "Grain darkness bias"
   */
  noiseDarkProb?: number;
};

export type Theme = {
  accents: Record<WidgetAccent, AccentSpec>;
  layout: Layout;
  status: Status;
  primary: Primary;
  menuBarTint: MenuBarTint;
  icons: Icons;
  controls: Controls;
};
