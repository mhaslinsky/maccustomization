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
  llm: { top: 20, zIndex: 99999 },
  weather: { top: 260, zIndex: 99998 },
  calendar: { top: 540, zIndex: 99997 },
  nowplaying: { top: 940, zIndex: 99996 },
} as const;

// Vertical flow configuration — order, gap between widgets, and the absolute
// top of the first (anchor) widget. Change these in one place and every
// widget re-layouts on the next resize tick.
const FLOW_ORDER = ["llm", "weather", "calendar", "nowplaying"] as const;
const FLOW_GAP = 16;
const FLOW_TOP = STACK.llm.top;

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
  const a: AccentSpec = accents[accent];
  const topVal = typeof top === "number" ? `${top}px` : top;
  const warnRule = a.showWarn ? `  .warn { color: ${status.warn}; }\n` : "";
  const L = layout;

  // Stabilize the backdrop-filter compositing layer with an infinite,
  // visually-imperceptible opacity animation. WebKit's compositor caches
  // the paint layer for elements that appear "static" after first paint,
  // which causes backdrop-filter to render once and then freeze — the
  // user sees the blur briefly when text selection or hover forces a
  // repaint, then it "disappears" when the stale cached layer is restored.
  // An ever-running animation keeps the layer invalidated every frame, so
  // WebKit continuously re-samples the backdrop through the filter. The
  // 0.9999 opacity step is imperceptible to the eye but enough to force
  // the layer to be treated as non-static. `.widget` in Übersicht's global
  // stylesheet already applies `position: absolute`, so we don't override
  // positioning here.
  return `
  top: ${topVal};
  left: ${L.left};
  width: ${L.width};
  padding: ${L.padding};
  box-sizing: border-box;
  background: ${L.cardBg};
  border: ${L.borderWidth} solid ${a.border};
  border-radius: ${L.radius};
  box-shadow: ${L.shadow};
  color: ${a.text};
  font-family: ${L.fontStack};
  line-height: ${L.lineHeight};
  -webkit-backdrop-filter: blur(${L.blur});
  backdrop-filter: blur(${L.blur});
  z-index: ${zIndex};${L.textShadow ? `\n  text-shadow: ${L.textShadow};` : ""}
  animation: widget-backdrop-keepalive 2s linear infinite;

  @keyframes widget-backdrop-keepalive {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.9999; }
  }
${rootExtras}
  h1 {
    margin: 0 0 ${L.h1MarginBottom} 0;
    font-size: ${L.h1Size};
    line-height: ${L.h1LineHeight};
    color: ${a.h1};
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
    margin: ${a.h2Margin};
    font-size: ${L.h2Size};
    text-transform: uppercase;
    letter-spacing: ${L.h2LetterSpacing};
    color: ${a.h2Muted};
  }

  p {
    margin: ${L.bodyMargin};
    font-size: ${L.bodySize};
  }

  .good { color: ${status.good}; }
${warnRule}  .bad { color: ${status.bad}; }
  .small {
    font-size: ${L.smallSize};
    line-height: ${L.smallLineHeight};
    color: ${a.smallMuted};
    ${a.smallExtra}
  }

  .footer {
    margin-top: ${L.footerMarginTop};
    margin-bottom: 0;
  }
${append}
`;
}
