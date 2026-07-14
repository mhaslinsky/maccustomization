import { accents, buildWidgetClassName, icons, layoutWidgets, STACK } from "./widget_theme.js";
import { parseOutput, renderError, renderLoading, renderParseError, fmtLocalTime, trackWidget, RenderProps } from "./widget_helpers.js";

export const command = 'python3 "$HOME/Library/Application Support/Übersicht/widgets/status_fetch.py"';

export const refreshFrequency = 120000;

// Tighter body type than the default 12px — the Status widget shows a
// 5-row provider list whose descriptions can be long ("Partially Degraded
// Service" etc.), and the 220px card width wraps them at 12px. 11px keeps
// every row on a single line for the common statuspage.io vocabulary
// without going so small that the muted operational rows become hard to
// scan. `a` inherits color so .good/.warn/.bad pill classes still drive
// the link color; underline appears only on hover.
const STATUS_APPEND = `
  p { font-size: 11px; }
  a { color: inherit; text-decoration: none; cursor: pointer; }
  a:hover { text-decoration: underline; }

  /* Provider rows: label pinned left, value flushed right, so the values form
     a single column instead of a ragged edge that follows label length. */
  p.row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }

  /* The label must never break. Flex will happily hyphenate "Meta AI" into
     "Meta / AI" to make room for a long value; a provider name splitting
     across lines reads as corruption. Pin it and let the value wrap instead. */
  p.row .label { flex: 0 0 auto; white-space: nowrap; }

  /* min-width: 0 lets the value actually shrink inside the flex row rather
     than forcing the label to give way. */
  p.row .value { text-align: right; min-width: 0; }

  /* Category divider — the AI providers and the dev tools are different
     things, so separate them with the same faint edge the card itself uses. */
  p.row.group-start {
    border-top: 1px solid ${accents.status.border};
    padding-top: 5px;
    margin-top: 5px;
  }
`;

export const className = buildWidgetClassName({
  ...STACK.status,
  accent: "status",
  append: STATUS_APPEND,
});

interface ProviderBlock {
  key: string;
  label: string;
  indicator?: string;
  description?: string;
  url?: string;
  group?: string;
}

// Upstream descriptions are written for a full-width status page, not a 220px
// card: "Unavailable: HTTP Error 503: Service Unavailable" says the same word
// three times and eats three lines. Shorten for display only — the payload
// keeps the full string, which stays reachable via the row's hover title and
// the click-through to the provider's own dashboard.
const SHORT_STATUS: [RegExp, string][] = [
  [/^Unavailable:/i, "Unavailable"],
  [/^Unreachable:/i, "Unreachable"],
  [/^Partially Degraded/i, "Degraded"],
  [/^Partial (System )?Outage/i, "Partial Outage"],
  [/^Minor Service Outage/i, "Minor Outage"],
  [/^Major Service Outage/i, "Major Outage"],
  [/Under Maintenance/i, "Maintenance"],
];

function shortStatus(text: string): string {
  for (const [pattern, short] of SHORT_STATUS) {
    if (pattern.test(text)) return short;
  }
  return text;
}

interface StatusPayload {
  updatedAt?: string;
  providers?: ProviderBlock[];
}

function pillClass(indicator: string | undefined): "good" | "warn" | "bad" {
  if (indicator === "none" || indicator === "operational" || indicator === "up") return "good";
  if (indicator === "reachable") return "good";
  if (indicator === "minor" || indicator === "degraded" || indicator === "warning") return "warn";
  return "bad";
}

// "reachable" is green but deliberately NOT operational: it means the provider
// has no status feed and all we did was confirm its API host answered (Grok,
// Meta AI — see status_fetch.py). Excluding it here is what keeps its honest
// "API reachable" wording instead of collapsing it to "Operational", which
// would claim a health check we never performed.
function isOperational(indicator: string | undefined): boolean {
  return indicator === "none" || indicator === "operational" || indicator === "up";
}

export const render = ({ output, error }: RenderProps) => {
  const inner = (() => {
    if (error) return renderError("Status", error);
    if (!output) return renderLoading("Status");

    const data = parseOutput<StatusPayload>(output);
    if (data.parseError) return renderParseError("Status", data.parseError);
    const providers = data.providers ?? [];

    return (
      <div>
        <h1>{icons.status ? <span className="icon">{icons.status}</span> : null}Status</h1>
        {providers.map((p, index) => {
          // Operational feeds report a verbose "All Systems Operational" from
          // statuspage.io — collapse that to a single word so the row stays on
          // one line at narrow card widths.
          const full = isOperational(p.indicator) ? "Operational" : p.description || "Unavailable";
          const text = shortStatus(full);
          const pill = (
            <span className={`${pillClass(p.indicator)} value`}>
              {!isOperational(p.indicator) && p.url ? (
                <a href={p.url}>{text}</a>
              ) : (
                text
              )}
            </span>
          );
          // Rule the boundary wherever the category changes (AI providers →
          // dev tools) rather than after a fixed row number, so the divider
          // follows the data if a provider is added or reordered.
          const previous = providers[index - 1];
          const startsGroup = index > 0 && previous.group !== p.group;
          // No colon after the label: in a two-column row it would dangle in
          // the gap rather than reading as punctuation.
          return (
            <p className={startsGroup ? "row group-start" : "row"} key={p.key} title={full}>
              <span className="label">{p.label}</span>
              {pill}
            </p>
          );
        })}
        <p className="small footer">Updated {fmtLocalTime(data.updatedAt)}</p>
      </div>
    );
  })();

  return <div ref={trackWidget("status", layoutWidgets)}>{inner}</div>;
};
