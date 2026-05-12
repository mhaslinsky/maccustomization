// Classic centered clock. No backend — the render function reads `new Date()`
// directly. `date` is used as the command so Übersicht re-renders on each tick.

import { layout } from "./widget_theme.js";

export const command = "date";

export const refreshFrequency = 30000;

// font-weight 200 is honored by themes whose fontStack has an ultralight cut
// (SF Pro Display, Helvetica Neue); mono stacks (e.g. obsidian-glass's SF Mono)
// have no hairline weight, so the browser falls back to their lightest available
// face — a deliberately blockier hero clock for those themes.
export const className = `
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: rgba(255, 255, 255, 0.92);
  font-family: ${layout.fontStack};
  font-weight: 200;
  -webkit-font-smoothing: antialiased;
  text-shadow: 0 4px 24px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  z-index: 1;

  .clock-time {
    font-size: 140px;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }

  .clock-date {
    font-size: 20px;
    font-weight: 300;
    letter-spacing: 0.22em;
    margin-top: 18px;
    opacity: 0.75;
    text-transform: uppercase;
  }
`;

function formatTime(d: Date): string {
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  hours = hours % 12 || 12;
  return `${hours}:${minutes}`;
}

function formatDate(d: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

export const render = () => {
  const now = new Date();
  return (
    <div>
      <div className="clock-time">{formatTime(now)}</div>
      <div className="clock-date">{formatDate(now)}</div>
    </div>
  );
};
