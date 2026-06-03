import { run } from "uebersicht";
import { buildWidgetClassName, icons, layoutWidgets, STACK } from "./widget_theme.js";
import { parseOutput, renderError, renderLoading, renderParseError, fmtLocalTime, trackWidget, RenderProps } from "./widget_helpers.js";

const PY = 'python3 "$HOME/Library/Application Support/Übersicht/widgets/nowplaying_fetch.py"';

export const command = PY;

function sendAction(action: "playpause" | "next" | "previous", source: string | null | undefined): void {
  const sourceArg = source ? ` --source ${source}` : "";
  run(`${PY} --action ${action}${sourceArg}`).catch((e: unknown) => {
    console.error("NowPlaying action failed:", action, String(e));
  });
}

export const refreshFrequency = 10000;

export const className = buildWidgetClassName({
  ...STACK.nowplaying,
  accent: "nowplaying",
  append: `
  .source {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(196, 181, 253, 0.7);
    margin-bottom: 2px;
  }

  .track-title {
    font-size: 13px;
    font-weight: 600;
    color: #f5f3ff;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .artist {
    font-size: 11px;
    color: rgba(245, 243, 255, 0.85);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .album {
    font-size: 10px;
    color: rgba(245, 243, 255, 0.55);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .genres {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  .genre {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: rgba(196, 181, 253, 0.85);
    background: rgba(167, 139, 250, 0.12);
    border: 1px solid rgba(167, 139, 250, 0.25);
    border-radius: 4px;
    padding: 1px 6px;
  }

  .state-badge {
    font-size: 10px;
    font-weight: 400;
    color: rgba(196, 181, 253, 0.7);
    margin-left: 6px;
  }

  .controls {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 10px;
  }

  .controls button {
    background: rgba(167, 139, 250, 0.12);
    border: 1px solid rgba(167, 139, 250, 0.3);
    border-radius: 6px;
    color: #f5f3ff;
    font-size: 13px;
    line-height: 1;
    padding: 5px 10px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.1s;
  }

  .controls button:hover {
    background: rgba(167, 139, 250, 0.25);
  }

  .controls button:active {
    background: rgba(167, 139, 250, 0.4);
  }
`,
});

interface NowPlayingTrack {
  title?: string;
  artist?: string;
  album?: string | null;
  state?: string;
  genres?: string[] | null;
  durationMs?: number | null;
  positionMs?: number | null;
}

interface NowPlayingPayload {
  updatedAt?: string;
  playing?: boolean;
  source?: string | null;
  track?: NowPlayingTrack | null;
}

function sourceLabel(source: string | null | undefined): string {
  if (source === "spotify") return "Spotify";
  if (source === "youtube_music") return "YouTube Music";
  return "";
}

export const render = ({ output, error }: RenderProps) => {
  const inner = (() => {
    if (error) return renderError("Now Playing", error);
    if (!output) return renderLoading("Now Playing");

    const data = parseOutput<NowPlayingPayload>(output);
    if (data.parseError) return renderParseError("Now Playing", data.parseError);

    if (!data.playing || !data.track) {
      return (
        <div>
          <h1>{icons.nowplaying ? <span className="icon">{icons.nowplaying}</span> : null}Now Playing</h1>
          <p className="small">Nothing playing.</p>
          <p className="small footer">Updated {fmtLocalTime(data.updatedAt)}</p>
        </div>
      );
    }

    const track = data.track;
    const paused = track.state === "paused";
    const source = data.source;
    const controllable = source === "spotify" || source === "youtube_music";

    return (
      <div>
        <h1>
          {icons.nowplaying ? <span className="icon">{icons.nowplaying}</span> : null}
          Now Playing
          {paused ? <span className="state-badge">Paused</span> : null}
        </h1>
        <div className="source">{sourceLabel(source)}</div>
        <div className="track-title">{track.title || "Unknown"}</div>
        <div className="artist">{track.artist || "Unknown artist"}</div>
        {track.album ? <div className="album">{track.album}</div> : null}
        {track.genres && track.genres.length ? (
          <div className="genres">
            {track.genres.map((g) => (
              <span className="genre" key={g}>{g}</span>
            ))}
          </div>
        ) : null}
        {controllable ? (
          <div className="controls">
            <button onClick={() => sendAction("previous", source)} title="Previous">⏮</button>
            <button onClick={() => sendAction("playpause", source)} title="Play/Pause">
              {paused ? "▶" : "⏸"}
            </button>
            <button onClick={() => sendAction("next", source)} title="Next">⏭</button>
          </div>
        ) : null}
        <p className="small footer">Updated {fmtLocalTime(data.updatedAt)}</p>
      </div>
    );
  })();

  return <div ref={trackWidget("nowplaying", layoutWidgets)}>{inner}</div>;
};
