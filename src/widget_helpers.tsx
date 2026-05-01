/**
 * Shared helpers for Übersicht widget render functions.
 * Transpiled to src/widget_helpers.js by the build script.
 */

export function parseOutput<T>(output: string): T & { parseError?: string; raw?: string } {
  try {
    return JSON.parse(output) as T & { parseError?: string; raw?: string };
  } catch (e) {
    return { parseError: String(e), raw: output } as T & { parseError: string; raw: string };
  }
}

export interface RenderProps {
  output?: string;
  error?: unknown;
}

export function renderError(title: string, error: unknown) {
  return (
    <div>
      <h1>{title}</h1>
      <p className="bad">{String(error)}</p>
    </div>
  );
}

export function renderLoading(title: string) {
  return (
    <div>
      <h1>{title}</h1>
      <p>Loading…</p>
    </div>
  );
}

export function fmtLocalTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function renderParseError(title: string, parseError: string) {
  return (
    <div>
      <h1>{title}</h1>
      <p className="bad">{parseError}</p>
    </div>
  );
}

/**
 * Coalesce rapid repeated calls into a single invocation per animation
 * frame. Multiple callers within the same frame collapse to one; the next
 * frame runs the wrapped function once with fresh arguments of its own.
 * Used to prevent layout thrashing when several ResizeObservers fire on
 * the same tick.
 */
export function debounceRaf(fn: () => void): () => void {
  let pending = 0;
  return () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      fn();
    });
  };
}

/**
 * Vertical auto-flow layout for Übersicht widgets. Widgets are independent
 * absolutely-positioned siblings in the same WebView document, so CSS alone
 * can't express "below status" (no sibling combinator for positioning).
 * Prior approach used CSS custom properties + `calc()` + ResizeObserver
 * cascades, but ResizeObserver only fires on SIZE changes, not position,
 * so downstream widgets' published bottoms went stale the moment an
 * upstream widget was still loading. This approach skips CSS vars entirely:
 *
 *   1. Every widget registers its Übersicht wrapper (via ref callback) in
 *      a shared `wrapperRegistry` keyed by a stable widget name.
 *   2. `runFlowLayout(order, gap, topAnchor)` walks the order top-down,
 *      measures each wrapper's actual rendered height, and sets an inline
 *      `top` on each subsequent wrapper. Inline style > class style, so
 *      this cleanly overrides whatever `top` `buildWidgetClassName` baked
 *      into the generated class.
 *   3. Every widget's own ResizeObserver triggers `runFlowLayout` again,
 *      so when any widget's content changes height, the whole stack
 *      re-flows in a single deterministic top-down pass.
 *
 * Order lives in the call site (usually widget_theme.ts) so there's one
 * source of truth for the stacking sequence.
 */

// The registry MUST be shared across all widget bundles. Übersicht's
// Browserify pipeline bundles each widget independently, so each gets its
// own module-scoped variables. A module-level Map would mean each widget
// can only see its own wrapper — runFlowLayout would find one entry and
// position that widget as if it were alone. Stashing the Map on `window`
// makes it a true cross-bundle singleton in the shared WebView document.
const wrapperRegistry: Map<string, HTMLElement> =
  ((window as unknown as Record<string, unknown>).__ubWidgetWrappers ??=
    new Map<string, HTMLElement>()) as Map<string, HTMLElement>;

export function runFlowLayout(
  order: readonly string[],
  gap: number,
  topAnchor: number,
): void {
  let y = topAnchor;
  for (let i = 0; i < order.length; i++) {
    const key = order[i];
    const wrapper = wrapperRegistry.get(key);
    if (!wrapper) continue;
    // First widget keeps whatever top came from buildWidgetClassName
    // (the anchor); subsequent widgets get an inline top computed from
    // the running y cursor.
    if (i > 0) {
      wrapper.style.top = `${y}px`;
    }
    const height = wrapper.getBoundingClientRect().height;
    y += height + gap;
  }
}

/**
 * Ref callback factory. Attach via `<div ref={trackWidget("weather",
 * layoutAll)}>…</div>` at the top of each widget's render output. On mount:
 *
 *   - Walks up to the Übersicht widget wrapper (`el.parentElement`).
 *   - Registers the wrapper in the shared registry under `key`.
 *   - Calls `onChange` once to lay out.
 *   - Attaches a ResizeObserver to trigger `onChange` on any size change.
 *
 * Deduped per-wrapper via a marker property so React re-renders don't
 * stack observers.
 */
export function trackWidget(key: string, onChange: () => void) {
  return (el: HTMLDivElement | null) => {
    if (!el) return;
    const wrapper = el.parentElement;
    if (!wrapper) return;

    const marker = `__ubTrackWidget_${key}`;
    if ((wrapper as unknown as Record<string, unknown>)[marker]) return;
    (wrapper as unknown as Record<string, unknown>)[marker] = true;

    wrapperRegistry.set(key, wrapper as HTMLElement);

    // Initial layout + observer for subsequent size changes.
    onChange();
    const ro = new ResizeObserver(onChange);
    ro.observe(wrapper);
  };
}
