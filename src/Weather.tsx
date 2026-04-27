import { run } from "uebersicht";
import { buildWidgetClassName, icons, layoutWidgets, STACK } from "./widget_theme.js";
import { parseOutput, renderError, renderLoading, renderParseError, fmtLocalTime, trackWidget, RenderProps } from "./widget_helpers.js";

const PY = 'python3 "$HOME/Library/Application Support/Übersicht/widgets/weather_fetch.py"';

type Dispatch = (update: { output?: string; error?: string }) => void;

export const command = (dispatch: Dispatch) => {
  run(PY)
    .then((out) => dispatch({ output: out }))
    .catch((e: unknown) => dispatch({ error: String(e) }));

  run(`${PY} --source`)
    .then((src) => {
      const trimmed = (src || "").trim();
      if (trimmed !== "geo") {
        console.log("Weather: source is", JSON.stringify(trimmed), "— skipping geolocation");
        return;
      }

      const geoApi =
        typeof geolocation !== "undefined"
          ? geolocation
          : typeof window !== "undefined"
            ? window.geolocation
            : undefined;
      if (!geoApi || typeof geoApi.getCurrentPosition !== "function") {
        console.error("Weather: geolocation API not available");
        return;
      }

      console.log("Weather: requesting geolocation…");
      geoApi.getCurrentPosition((...args: unknown[]) => {
        // Übersicht wraps: {position: {timestamp, coords: {latitude, longitude}, address}}
        const raw = args[0] as Record<string, unknown> | undefined;
        const pos = ((raw?.position ?? raw) ?? {}) as Record<string, unknown>;
        const coords = ((pos.coords ?? pos) ?? {}) as Record<string, unknown>;
        const lat = Number(coords.latitude);
        const lon = Number(coords.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lon)) {
          console.error("Weather: no coords in geolocation result:", JSON.stringify(raw));
          return;
        }

        const addr = (pos.address ?? raw?.address ?? {}) as Record<string, string>;
        const parts = [addr.City, addr.State, addr.Country].filter(Boolean);
        const label = parts.length ? parts.join(", ") : "";
        const labelArg = label ? ` '${label.replace(/'/g, "'\\''")}'` : "";
        const cmd = `${PY} --geo ${lat} ${lon}${labelArg}`;

        console.log("Weather: running", cmd);
        run(cmd)
          .then((out) => dispatch({ output: out }))
          .catch((e: unknown) => console.error("Weather: geo fetch failed:", String(e)));
      });
    })
    .catch((e: unknown) => {
      console.error("Weather: --source failed:", String(e));
    });
};

export const refreshFrequency = 600000;

export const className = buildWidgetClassName({
  ...STACK.weather,
  accent: "weather",
  append: `
  .tempLine {
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.02em;
    color: #fef3c7;
    margin: 4px 0 8px 0;
    line-height: 1.12;
  }

  code {
    font-family: Menlo, Monaco, monospace;
    font-size: 9px;
    color: rgba(255, 247, 237, 0.88);
    background: rgba(0, 0, 0, 0.28);
    padding: 1px 4px;
    border-radius: 3px;
  }
`,
});

interface WeatherPayload {
  parseError?: string;
  raw?: string;
  error?: string;
  weatherError?: string;
  updatedAt?: string;
  location?: {
    error?: string;
    source?: string;
    label?: string;
  };
  current?: {
    temperatureF?: number;
    apparentTemperatureF?: number;
    relativeHumidity?: number;
    weatherCode?: number;
    condition?: string;
    windSpeedMph?: number;
    isDay?: number;
    time?: string;
  };
}

function fmtTemp(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  return `${n.toFixed(1)}°F`;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `${Math.round(Number(v))}%`;
}

function fmtWind(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return `${Number(v).toFixed(1)} mph`;
}

export const render = ({ output, error }: RenderProps) => {
  const inner = (() => {
    if (error) return renderError("Weather", error);
    if (!output) return renderLoading("Weather");

    const data = parseOutput<WeatherPayload>(output);
    if (data.parseError) return renderParseError("Weather", data.parseError);

    const loc = data.location ?? {};
    const cur = data.current ?? {};

    if (loc.error || loc.source === "none") {
      return (
        <div>
          <h1>{icons.weather ? <span className="icon">{icons.weather}</span> : null}Weather</h1>
          <p className="bad">{loc.error || data.error || "Location unavailable."}</p>
          <p className="small">
            Location lookup failed. Add <code className="small">LOCATION_QUERY=City, ST</code> or{" "}
            <code className="small">LAT</code>/<code className="small">LON</code> in{" "}
            <code className="small">~/.config/weather-widget.env</code>.
          </p>
        </div>
      );
    }

    if (data.weatherError || !cur.condition) {
      return (
        <div>
          <h1>{icons.weather ? <span className="icon">{icons.weather}</span> : null}Weather</h1>
          <p className="small">{loc.label}</p>
          <p className="bad">{data.weatherError || data.error || "Weather unavailable."}</p>
        </div>
      );
    }

    const dayPart = cur.isDay === 0 ? "Night" : cur.isDay === 1 ? "Day" : "";

    return (
      <div>
        <h1>{icons.weather ? <span className="icon">{icons.weather}</span> : null}Weather</h1>
        <p className="small">{loc.label}</p>
        {loc.source === "ip" ? (
          <p className="small">
            Approximate location (IP). Set <code className="small">LOCATION_QUERY=City, ST</code> in{" "}
            <code className="small">~/.config/weather-widget.env</code>.
          </p>
        ) : null}
        <p className="tempLine">{fmtTemp(cur.temperatureF)}</p>
        <p>
          <span className="good">{cur.condition}</span>
          {dayPart ? <span className="small"> · {dayPart}</span> : null}
        </p>
        <h2>Details</h2>
        <p>Feels like {fmtTemp(cur.apparentTemperatureF)}</p>
        <p>Humidity {fmtPct(cur.relativeHumidity)}</p>
        <p>Wind {fmtWind(cur.windSpeedMph)}</p>
        <p className="small footer">Updated {fmtLocalTime(data.updatedAt)}</p>
      </div>
    );
  })();

  return <div ref={trackWidget("weather", layoutWidgets)}>{inner}</div>;
};
