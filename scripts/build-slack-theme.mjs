/**
 * Codegen: src/themes/_active.ts  →  Slack sidebar theme string (10 hex colors)
 *
 * Slack's only built-in theming knob is the sidebar accent strip, set via
 * Preferences → Themes → Custom Theme → "Paste your legacy theme colors".
 * The legacy format is 10 comma-separated UPPERCASE #RRGGBB hex values,
 * in this fixed order (Slack rejects 8-color strings silently — the older
 * pre-2018 docs say 8, but modern Slack requires all 10):
 *
 *   1. column_bg       — sidebar background
 *   2. menu_bg_hover   — workspace switcher / menu hover bg
 *   3. active_item     — selected channel/DM background
 *   4. active_item_text — text color of the selected channel
 *   5. hover_item      — channel hover background
 *   6. text_color      — primary sidebar text color
 *   7. active_presence — online/active dot
 *   8. mention_badge   — unread mention pill background
 *   9. top_nav_bg      — top navigation bar background
 *  10. top_nav_text    — top navigation bar text
 *
 * The string can't be applied programmatically — it's synced server-side
 * per-user-per-workspace, so the user has to paste it into Slack's
 * preferences manually. We copy it to the clipboard via `pbcopy` and print
 * a clear "now go paste this" message.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const activeSrc = join(root, "src", "themes", "_active.ts");

// ---------------------------------------------------------------------------
// Bundle + import active theme
// ---------------------------------------------------------------------------
const result = await esbuild.build({
  entryPoints: [activeSrc],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  logLevel: "silent",
});
const code = result.outputFiles[0].text;
const dataUrl =
  "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const theme = await import(dataUrl);

const activeSrcText = await readFile(activeSrc, "utf8");
const nameMatch = activeSrcText.match(/from\s+["'].\/([^"']+?)(?:\.js)?["']/);
const themeName = nameMatch ? nameMatch[1] : "custom";

// ---------------------------------------------------------------------------
// Color helpers (Slack's theme string is plain #RRGGBB — no alpha)
// ---------------------------------------------------------------------------

function parseColor(color) {
  const hex6 = color.match(/^#([0-9a-f]{6})$/i);
  if (hex6) {
    const n = parseInt(hex6[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff, a: 1 };
  }
  const rgba = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/
  );
  if (rgba) {
    return {
      r: parseInt(rgba[1], 10),
      g: parseInt(rgba[2], 10),
      b: parseInt(rgba[3], 10),
      a: rgba[4] != null ? parseFloat(rgba[4]) : 1,
    };
  }
  throw new Error(`Cannot parse CSS color: ${color}`);
}

function composite(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function toHex(c) {
  // Uppercase — Slack's legacy theme parser appears to be case-sensitive
  // (Slack's own defaults are uppercase, e.g. #19171D). Lowercase hex was
  // observed to cause the import to silently reset to defaults.
  const hh = (n) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0").toUpperCase();
  return `#${hh(c.r)}${hh(c.g)}${hh(c.b)}`;
}

function cssToHex(color, bgColor) {
  const fg = parseColor(color);
  if (fg.a >= 1) return toHex(fg);
  const bg = bgColor ? parseColor(bgColor) : { r: 0, g: 0, b: 0, a: 1 };
  return toHex(composite(fg, bg));
}

/** Lighten a color by mixing with white. */
function lighten(hex, amount) {
  const c = parseColor(hex);
  return toHex({
    r: Math.round(c.r + (255 - c.r) * amount),
    g: Math.round(c.g + (255 - c.g) * amount),
    b: Math.round(c.b + (255 - c.b) * amount),
    a: 1,
  });
}

// ---------------------------------------------------------------------------
// Map theme tokens → Slack sidebar slots
// ---------------------------------------------------------------------------

// Slack's sidebar is opaque (no transparency support), so flatten cardBg
// onto a near-black base — same approach as the Warp codegen, since the
// terminal and Slack sidebar should feel like the same material.
const bgParsed = parseColor(theme.layout.cardBg);
const bgBase = { r: 6, g: 8, b: 28, a: 1 };
const columnBg =
  bgParsed.a >= 1 ? toHex(bgParsed) : toHex(composite(bgParsed, bgBase));

// menu_bg_hover — slightly lighter than column_bg (workspace switcher hover).
const menuBgHover = lighten(columnBg, 0.08);

// active_item — the menuBarTint accent (always saturated, full alpha).
// Same rationale as Warp: primary.active can be white in glass themes,
// which composites to gray and looks washed out.
const activeItem = cssToHex(theme.menuBarTint, columnBg);

// active_item_text — high contrast against active_item. Use status.text
// (the bright foreground color) which is designed to read on the card bg.
const activeItemText = cssToHex(theme.accents.status.text, columnBg);

// hover_item — between column_bg and active_item. Slightly lighter than
// menu_bg_hover so resting/hover/active are visually distinct.
const hoverItem = lighten(columnBg, 0.14);

// text_color — primary text, same source as the widgets' body copy.
const textColor = cssToHex(theme.accents.status.text, columnBg);

// active_presence — online dot. status.good is green/mint and reads as
// "available" universally.
const activePresence = cssToHex(theme.status.good, columnBg);

// mention_badge — unread mention pill. status.bad is the urgent/error red.
const mentionBadge = cssToHex(theme.status.bad, columnBg);

// top_nav_bg — top navigation bar bg. Match the sidebar so the header
// reads as one piece of material with the workspace column.
const topNavBg = columnBg;

// top_nav_text — top navigation bar text. Same primary text color so
// channel names / search read consistently.
const topNavText = textColor;

const slackString = [
  columnBg,
  menuBgHover,
  activeItem,
  activeItemText,
  hoverItem,
  textColor,
  activePresence,
  mentionBadge,
  topNavBg,
  topNavText,
].join(",");

// ---------------------------------------------------------------------------
// Output: copy to clipboard + tell the user exactly what to do next
// ---------------------------------------------------------------------------

let clipboardOk = false;
try {
  execSync(`printf %s ${JSON.stringify(slackString)} | pbcopy`, {
    stdio: "ignore",
  });
  clipboardOk = true;
} catch {
  // pbcopy missing or failed — fall through to stdout-only.
}

const displayName = `Uber ${themeName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
console.log(`Slack theme — "${displayName}"`);
console.log("");
console.log(`  ${slackString}`);
console.log("");
console.log("  column_bg       " + columnBg);
console.log("  menu_bg_hover   " + menuBgHover);
console.log("  active_item     " + activeItem);
console.log("  active_item_txt " + activeItemText);
console.log("  hover_item      " + hoverItem);
console.log("  text_color      " + textColor);
console.log("  active_presence " + activePresence);
console.log("  mention_badge   " + mentionBadge);
console.log("  top_nav_bg      " + topNavBg);
console.log("  top_nav_text    " + topNavText);
console.log("");
if (clipboardOk) {
  console.log("✓ Copied to clipboard.");
} else {
  console.log("(clipboard copy failed — copy the string above manually)");
}
console.log("→ Open Slack → Preferences → Themes → scroll to bottom →");
console.log('  click "Create a custom theme" / "Import theme".');
console.log("");
console.log('  IMPORTANT: in the Import dialog, click the small');
console.log('  "Paste your legacy theme colors" link in the bottom-left.');
console.log("  Do NOT paste into the top \"theme string\" field — that's");
console.log("  the new encoded format (only 4 anchor colors, comma+space),");
console.log("  and Slack will silently reject our 10-color legacy string and");
console.log("  snap back to defaults.");
console.log("");
console.log("  Repeat once per workspace (Slack stores it per-workspace");
console.log("  server-side).");
