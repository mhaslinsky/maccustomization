import { buildWidgetClassName, icons, layoutWidgets, STACK } from "./widget_theme.js";
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
}

interface StatusPayload {
  updatedAt?: string;
  providers?: ProviderBlock[];
}

function pillClass(indicator: string | undefined): "good" | "warn" | "bad" {
  if (indicator === "none" || indicator === "operational" || indicator === "up") return "good";
  if (indicator === "minor" || indicator === "degraded" || indicator === "warning") return "warn";
  return "bad";
}

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
        {providers.map((p) => {
          // Operational feeds report a verbose "All Systems Operational" from
          // statuspage.io — collapse that to a single word so "Provider: …"
          // stays on one line at narrow card widths. Non-operational states
          // keep the upstream description, where the detail actually matters.
          const text = isOperational(p.indicator) ? "Operational" : p.description || "Unavailable";
          const pill = (
            <span className={pillClass(p.indicator)}>
              {!isOperational(p.indicator) && p.url ? (
                <a href={p.url}>{text}</a>
              ) : (
                text
              )}
            </span>
          );
          return (
            <p key={p.key}>
              {p.label}: {pill}
            </p>
          );
        })}
        <p className="small footer">Updated {fmtLocalTime(data.updatedAt)}</p>
      </div>
    );
  })();

  return <div ref={trackWidget("status", layoutWidgets)}>{inner}</div>;
};
