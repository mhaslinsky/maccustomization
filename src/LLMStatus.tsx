import { buildWidgetClassName, icons, layoutWidgets, STACK } from "./widget_theme.js";
import { parseOutput, renderError, renderLoading, renderParseError, fmtLocalTime, trackWidget, RenderProps } from "./widget_helpers.js";

export const command = 'python3 "$HOME/Library/Application Support/Übersicht/widgets/llm_status_fetch.py"';

export const refreshFrequency = 120000;

export const className = buildWidgetClassName({
  ...STACK.llm,
  accent: "llm",
});

interface ProviderBlock {
  key: string;
  label: string;
  indicator?: string;
  description?: string;
}

interface LLMPayload {
  updatedAt?: string;
  providers?: ProviderBlock[];
}

function pillClass(indicator: string | undefined): "good" | "warn" | "bad" {
  if (indicator === "none" || indicator === "operational" || indicator === "up") return "good";
  if (indicator === "minor" || indicator === "degraded" || indicator === "warning") return "warn";
  return "bad";
}

export const render = ({ output, error }: RenderProps) => {
  const inner = (() => {
    if (error) return renderError("LLM Status", error);
    if (!output) return renderLoading("LLM Status");

    const data = parseOutput<LLMPayload>(output);
    if (data.parseError) return renderParseError("LLM Status", data.parseError);
    const providers = data.providers ?? [];

    return (
      <div>
        <h1>{icons.llm ? <span className="icon">{icons.llm}</span> : null}LLM Status</h1>
        {providers.map((p) => (
          <p key={p.key}>
            {p.label}:{" "}
            <span className={pillClass(p.indicator)}>
              {p.description || "Unavailable"}
            </span>
          </p>
        ))}
        <p className="small footer">Updated {fmtLocalTime(data.updatedAt)}</p>
      </div>
    );
  })();

  return <div ref={trackWidget("llm", layoutWidgets)}>{inner}</div>;
};
