// Widget theme façade. Owns the cross-widget structural bits — `STACK`
// positioning, `buildWidgetClassName` CSS builder, and the widget-contract
// types — and re-exports the swappable "look" tokens from whichever theme
// `./themes/_active.ts` currently points at.
//
// To switch themes, use `npm run theme <name>` — that rewrites _active.ts.
// See `src/themes/` for available themes and CLAUDE.md for the full flow.

import { runFlowLayout } from "./widget_helpers.js";
import { accents, icons, layout, primary, status } from "./themes/_active.js";
import type { AccentSpec, Icons, WidgetAccent } from "./themes/_types.js";

// Re-export so existing consumers can keep importing from widget_theme.
export { accents, icons, layout, primary, status };
export type { AccentSpec, Icons, WidgetAccent };

// STACK.*.top values are *initial fallbacks* — the top the widget renders at
// before the JS auto-layout runs, or if auto-layout is bypassed. Once a
// widget's ref callback fires and `layoutWidgets()` runs, the non-anchor
// widgets get inline `top` values computed from the measured height of the
// widget above them (see runFlowLayout in widget_helpers.tsx). This keeps the
// static className self-contained for loading frames, then flows the stack
// dynamically once heights are known.
export const STACK = {
  status: { top: 20, zIndex: 99999 },
  weather: { top: 260, zIndex: 99998 },
  calendar: { top: 540, zIndex: 99997 },
  nowplaying: { top: 940, zIndex: 99996 },
  keepawake: { top: 1180, zIndex: 99995 },
} as const;

// Vertical flow configuration — order, gap between widgets, and the absolute
// top of the first (anchor) widget. Change these in one place and every
// widget re-layouts on the next resize tick.
const FLOW_ORDER = ["status", "weather", "calendar", "nowplaying", "keepawake"] as const;
const FLOW_GAP = 16;
const FLOW_TOP = STACK.status.top;

/**
 * Re-compute positions for every registered widget. Call from each widget's
 * trackWidget ref callback — runs one top-down pass, measuring each wrapper's
 * actual rendered height to place the next. Called synchronously (no rAF
 * debounce) because Übersicht's desktop-layer WebView can deprioritize or
 * skip requestAnimationFrame entirely, which would block layout from ever
 * running.
 */
export function layoutWidgets(): void {
  runFlowLayout(FLOW_ORDER, FLOW_GAP, FLOW_TOP);
}

export interface BuildWidgetClassNameOptions {
  top: number | string;
  zIndex: number;
  accent: WidgetAccent;
  rootExtras?: string;
  append?: string;
}

export function buildWidgetClassName({
  top,
  zIndex,
  accent,
  rootExtras = "",
  append = "",
}: BuildWidgetClassNameOptions): string {
  const accentSpec: AccentSpec = accents[accent];
  const topValue = typeof top === "number" ? `${top}px` : top;
  const warnRule = accentSpec.showWarn ? `  .warn { color: ${status.warn}; }\n` : "";
  const layoutSpec = layout;

  // WebKit freezes static backdrop filters, so glass themes keep their paint
  // layers alive. Near-opaque themes can opt out of both the filter and its
  // continuous compositor cost.
  const backdropStyles = layoutSpec.backdropFilterEnabled === false
    ? ""
    : `
  -webkit-backdrop-filter: blur(${layoutSpec.blur})${layoutSpec.backdropSaturate ? ` saturate(${layoutSpec.backdropSaturate})` : ""};
  backdrop-filter: blur(${layoutSpec.blur})${layoutSpec.backdropSaturate ? ` saturate(${layoutSpec.backdropSaturate})` : ""};
  animation: widget-backdrop-keepalive 2s linear infinite;

  @keyframes widget-backdrop-keepalive {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.9999; }
  }
`;

  // `.widget` in Übersicht's global stylesheet already applies absolute
  // positioning, so this builder does not override it.
  return `
  top: ${topValue};
  left: ${layoutSpec.left};
  width: ${layoutSpec.width};
  padding: ${layoutSpec.padding};
  box-sizing: border-box;
  background: ${layoutSpec.cardBg};
  border: ${layoutSpec.borderWidth} solid ${accentSpec.border};
  border-radius: ${layoutSpec.radius};
  box-shadow: ${layoutSpec.shadow};
  color: ${accentSpec.text};
  font-family: ${layoutSpec.fontStack};
  line-height: ${layoutSpec.lineHeight};
  z-index: ${zIndex};${layoutSpec.textShadow ? `\n  text-shadow: ${layoutSpec.textShadow};` : ""}${backdropStyles}
${rootExtras}
  h1 {
    margin: 0 0 ${layoutSpec.h1MarginBottom} 0;
    font-size: ${layoutSpec.h1Size};
    line-height: ${layoutSpec.h1LineHeight};
    color: ${accentSpec.h1};
  }

  h1 .icon {
    display: inline-block;
    margin-right: 7px;
    font-weight: normal;
    /* Nerd Font glyphs render slightly large against Latin text at the
       same font-size; nudge down for visual balance. */
    font-size: 0.92em;
    /* Glyph metrics differ from Latin; this keeps the icon optically
       centered with the h1 baseline. */
    transform: translateY(-0.04em);
    opacity: 0.95;
  }

  h2 {
    margin: ${accentSpec.h2Margin};
    font-size: ${layoutSpec.h2Size};
    text-transform: uppercase;
    letter-spacing: ${layoutSpec.h2LetterSpacing};
    color: ${accentSpec.h2Muted};
  }

  p {
    margin: ${layoutSpec.bodyMargin};
    font-size: ${layoutSpec.bodySize};
  }

  .good { color: ${status.good}; }
${warnRule}  .bad { color: ${status.bad}; }
  .small {
    font-size: ${layoutSpec.smallSize};
    line-height: ${layoutSpec.smallLineHeight};
    color: ${accentSpec.smallMuted};
    ${accentSpec.smallExtra}
  }

  .footer {
    margin-top: ${layoutSpec.footerMarginTop};
    margin-bottom: 0;
  }
${append}
`;
}
