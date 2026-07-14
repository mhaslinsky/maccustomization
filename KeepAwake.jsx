// active-theme: obsidian-glass (d76f8508)
import { run, React } from "uebersicht";
import { buildWidgetClassName, layoutWidgets, status, STACK } from "./src/widget_theme.js";
import { trackWidget } from "./src/widget_helpers.js";
const { useState, useEffect } = React;
export const command = "/usr/bin/pmset -g | grep -qE 'SleepDisabled[[:space:]]+1' && echo on || echo off";
export const refreshFrequency = 1e4;
export const className = buildWidgetClassName({
  ...STACK.keepawake,
  accent: "keepawake",
  append: `
  .ka-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    cursor: pointer;
    user-select: none;
    margin-top: 2px;
  }

  .ka-label {
    font-size: 12px;
    font-weight: 600;
  }

  .ka-switch {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 42px;
    height: 24px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.18);
    position: relative;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .ka-switch.on {
    background: ${status.good};
    border-color: ${status.good};
  }

  .ka-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.15s ease;
  }

  .ka-switch.on .ka-knob {
    transform: translateX(18px);
  }
`
});
function setDisableSleep(on) {
  return run(`/usr/bin/sudo /usr/bin/pmset -a disablesleep ${on ? "1" : "0"}`);
}
const KeepAwakeToggle = ({ output, error }) => {
  const serverOn = (output || "").trim() === "on";
  const [pending, setPending] = useState(null);
  useEffect(() => {
    setPending(null);
  }, [output]);
  const on = pending != null ? pending : serverOn;
  const toggle = () => {
    const next = !on;
    setPending(next);
    setDisableSleep(next).catch((toggleError) => {
      console.error("KeepAwake toggle failed:", String(toggleError));
      setPending(null);
    });
  };
  return <div>
      {error ? <p className="small">Error reading state.</p> : <div className="ka-row" onClick={toggle}>
          <span className="ka-label">Lid-close {on ? "awake" : "sleep"}</span>
          <span className={on ? "ka-switch on" : "ka-switch"}>
            <span className="ka-knob" />
          </span>
        </div>}
    </div>;
};
export const render = ({ output, error }) => <div ref={trackWidget("keepawake", layoutWidgets)}>
    <KeepAwakeToggle output={output} error={error} />
  </div>;
