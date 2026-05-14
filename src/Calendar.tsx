import { buildWidgetClassName, icons, layoutWidgets, STACK } from "./widget_theme.js";
import { parseOutput, renderError, renderLoading, renderParseError, fmtLocalTime, trackWidget, RenderProps } from "./widget_helpers.js";

export const command = 'python3 "$HOME/Library/Application Support/Übersicht/widgets/calendar_fetch.py"';

export const refreshFrequency = 300000;

export const className = buildWidgetClassName({
  ...STACK.calendar,
  accent: "calendar",
  rootExtras: `  max-height: 360px;
  overflow: hidden;
`,
  append: `
  ul {
    margin: 6px 0 0 0;
    padding: 0;
    list-style: none;
    max-height: 232px;
    overflow-y: auto;
  }

  li {
    margin: 0 0 8px 0;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(52, 211, 153, 0.15);
    font-size: 12px;
  }

  li:last-child {
    border-bottom: none;
    margin-bottom: 0;
    padding-bottom: 0;
  }

  .time {
    font-size: 10px;
    color: rgba(167, 243, 208, 0.95);
    margin-bottom: 2px;
    letter-spacing: 0.02em;
    line-height: 1.35;
  }

  .title {
    color: #f0fdf4;
    font-weight: 500;
    line-height: 1.38;
  }

  .cal {
    font-size: 8px;
    color: rgba(236, 253, 245, 0.55);
    margin-top: 2px;
    line-height: 1.35;
  }
`,
});

interface CalendarEvent {
  start?: string;
  time?: string;
  title?: string;
  calendar?: string;
}

interface CalendarPayload {
  parseError?: string;
  raw?: string;
  error?: string;
  hint?: string;
  updatedAt?: string;
  focus?: string;
  focusLabel?: string;
  eveningHour?: number;
  events?: CalendarEvent[];
}

export const render = ({ output, error }: RenderProps) => {
  const inner = (() => {
    if (error) return renderError("Calendar", error);
    if (!output) return renderLoading("Calendar");

    const data = parseOutput<CalendarPayload>(output);
    if (data.parseError) return renderParseError("Calendar", data.parseError);

    if (data.error) {
      return (
        <div>
          <h1>{icons.calendar ? <span className="icon">{icons.calendar}</span> : null}Calendar</h1>
          <p className="bad">{data.error}</p>
          {data.hint ? <p className="small">{data.hint}</p> : null}
          <p className="small">
            Also check System Settings → Privacy & Security → Calendars (enable Übersicht). Timeouts are usually
            AppleScript on a large calendar library, not missing Automation.
          </p>
        </div>
      );
    }

    const events = data.events ?? [];
    const focusWord = data.focus === "tomorrow" ? "Tomorrow" : "Today";

    return (
      <div>
        <h1>{icons.calendar ? <span className="icon">{icons.calendar}</span> : null}Calendar</h1>
        <h2>
          {focusWord} · {data.focusLabel || ""}
        </h2>
        {events.length === 0 ? (
          <p className="small">No upcoming events.</p>
        ) : (
          <ul>
            {events.map((ev, i) => (
              <li key={`${ev.start}-${i}`}>
                <div className="time">{ev.time}</div>
                <div className="title">{ev.title}</div>
                <div className="cal">{ev.calendar}</div>
              </li>
            ))}
          </ul>
        )}
        <p className="small footer">Updated {fmtLocalTime(data.updatedAt)}</p>
      </div>
    );
  })();

  return <div ref={trackWidget("calendar", layoutWidgets)}>{inner}</div>;
};
