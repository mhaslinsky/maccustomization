import { run, React } from "uebersicht";
import { buildWidgetClassName, layoutWidgets, status, STACK } from "./widget_theme.js";
import { trackWidget, RenderProps } from "./widget_helpers.js";

const { useState, useEffect } = React;

// State probe. `pmset -g` prints `SleepDisabled  1` when lid-close (clamshell)
// sleep is suppressed. Reading the setting needs no privileges — only the
// write does. Full paths because Übersicht runs commands with a minimal PATH.
export const command =
  "/usr/bin/pmset -g | grep -qE 'SleepDisabled[[:space:]]+1' && echo on || echo off";

export const refreshFrequency = 10000;

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
`,
});

interface ToggleProps {
  output?: string;
  error?: unknown;
}

// caffeinate's power assertions can't defeat clamshell sleep — the lid sensor
// fires a sleep event the instant the lid shuts, bypassing those assertions.
// `pmset disablesleep` is the only switch that suppresses that path. It needs
// root, granted via a scoped passwordless sudoers rule (see README). `-a` sets
// both battery and charger so the mode holds regardless of power source.
function setDisableSleep(on: boolean): Promise<string> {
  return run(`/usr/bin/sudo /usr/bin/pmset -a disablesleep ${on ? "1" : "0"}`);
}

const KeepAwakeToggle = ({ output, error }: ToggleProps) => {
  const serverOn = (output || "").trim() === "on";

  // Optimistic state so the switch animates instantly on click. Cleared on
  // every fresh command tick so the server reading wins — which also snaps the
  // switch back if the sudo write silently failed (e.g. sudoers rule missing).
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    setPending(null);
  }, [output]);

  const on = pending ?? serverOn;

  const toggle = () => {
    const next = !on;
    setPending(next);
    setDisableSleep(next).catch((toggleError: unknown) => {
      console.error("KeepAwake toggle failed:", String(toggleError));
      setPending(null);
    });
  };

  return (
    <div>
      {error ? (
        <p className="small">Error reading state.</p>
      ) : (
        <div className="ka-row" onClick={toggle}>
          <span className="ka-label">Lid-close {on ? "awake" : "sleep"}</span>
          <span className={on ? "ka-switch on" : "ka-switch"}>
            <span className="ka-knob" />
          </span>
        </div>
      )}
    </div>
  );
};

export const render = ({ output, error }: RenderProps) => (
  <div ref={trackWidget("keepawake", layoutWidgets)}>
    <KeepAwakeToggle output={output} error={error} />
  </div>
);
