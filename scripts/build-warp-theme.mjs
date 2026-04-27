/**
 * Codegen: src/themes/_active.ts  →  ~/.warp/themes/uber-<theme>.yaml
 *
 * Generates a Warp terminal theme from the shared design tokens. Same
 * single-source-of-truth pattern as the other codegens (esbuild in-memory
 * bundle → data URL → dynamic import).
 *
 * Warp themes are YAML files in ~/.warp/themes/. The format is documented
 * at https://docs.warp.dev/appearance/custom-themes — all colors are plain
 * #RRGGBB hex (no alpha channel support in the terminal_colors palette).
 *
 * For rgba() tokens with alpha < 1, we composite against the background
 * color to produce a flat hex value — what you'd actually see on screen.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const activeSrc = join(root, "src", "themes", "_active.ts");
const warpThemesDir = join(homedir(), ".warp", "themes");

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

// ---------------------------------------------------------------------------
// Detect active theme name (read the re-export line in _active.ts)
// ---------------------------------------------------------------------------
const activeSrcText = await readFile(activeSrc, "utf8");
const nameMatch = activeSrcText.match(/from\s+["'].\/([^"']+?)(?:\.js)?["']/);
const themeName = nameMatch ? nameMatch[1] : "custom";

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/** Parse a CSS color string into { r, g, b, a } (0-255 for rgb, 0-1 for a). */
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

/** Composite a foreground color (with alpha) over a background (opaque). */
function composite(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

/** Convert { r, g, b } to "#RRGGBB". */
function toHex(c) {
  const hh = (n) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0");
  return `#${hh(c.r)}${hh(c.g)}${hh(c.b)}`;
}

/**
 * Convert a CSS color to a flat #RRGGBB hex, compositing against `bgColor`
 * if the source has alpha < 1.
 */
function cssToHex(color, bgColor) {
  const fg = parseColor(color);
  if (fg.a >= 1) return toHex(fg);
  const bg = bgColor ? parseColor(bgColor) : { r: 0, g: 0, b: 0, a: 1 };
  return toHex(composite(fg, bg));
}

// ---------------------------------------------------------------------------
// Map theme tokens → Warp YAML fields
// ---------------------------------------------------------------------------

// Background: Warp's OverrideOpacity makes the window translucent, so
// the theme background is composited by Warp over whatever's behind it.
// We want the terminal to feel like the same material as the widgets.
// Composite cardBg onto a near-black base (not pure black — that reads
// too flat) to get the "tinted dark glass" look the widgets have.
const bgParsed = parseColor(theme.layout.cardBg);
const bgBase = { r: 6, g: 8, b: 28, a: 1 }; // near-black with a strong cool-blue bias
const bgFlat =
  bgParsed.a >= 1
    ? toHex(bgParsed)
    : toHex(composite(bgParsed, bgBase));

// Determine if this is a "darker" or "lighter" theme based on bg luminance.
const bgRgb = parseColor(bgFlat);
const luminance = 0.299 * bgRgb.r + 0.587 * bgRgb.g + 0.114 * bgRgb.b;
const details = luminance < 128 ? "darker" : "lighter";

const fg = cssToHex(theme.accents.llm.text, bgFlat);
// Accent: prefer menuBarTint (always saturated/full-alpha) over primary.active
// which can be white or translucent in glass themes — those composite to gray
// and look washed out as a terminal accent.
const accent = cssToHex(theme.menuBarTint, bgFlat);
const cursor = accent;
// Selection: use the accent at reduced opacity over bg.
const accentParsed = parseColor(theme.menuBarTint);
accentParsed.a = 0.25;
const selection = toHex(composite(accentParsed, parseColor(bgFlat)));

// ANSI palette — map semantic theme colors to terminal color slots.
// Each accent maps to the ANSI slot closest to its hue family:
//   llm     (cyan/blue family) → cyan
//   weather (amber/warm family) → yellow
//   calendar (green/mint family) → green
//   nowplaying (purple/lavender) → magenta
// status.bad → red, status.good → green (doubled with calendar is fine —
// green is semantically correct for both), weather.h1 → yellow for warmth.
// Blue gets the primary border accent (the "brand" color).
const normal = {
  black: bgFlat,
  red: cssToHex(theme.status.bad, bgFlat),
  green: cssToHex(theme.status.good, bgFlat),
  yellow: cssToHex(theme.accents.weather.h1, bgFlat),
  blue: cssToHex(theme.accents.llm.border, bgFlat),
  magenta: cssToHex(theme.accents.nowplaying.h1, bgFlat),
  cyan: cssToHex(theme.accents.llm.h1, bgFlat),
  white: fg,
};

// Bright variants: bump each normal color toward white by ~20%.
function brighten(hex, amount = 0.2) {
  const c = parseColor(hex);
  return toHex({
    r: Math.round(c.r + (255 - c.r) * amount),
    g: Math.round(c.g + (255 - c.g) * amount),
    b: Math.round(c.b + (255 - c.b) * amount),
    a: 1,
  });
}

const bright = {
  black: brighten(normal.black, 0.15),
  red: brighten(normal.red),
  green: brighten(normal.green),
  yellow: brighten(normal.yellow),
  blue: brighten(normal.blue),
  magenta: brighten(normal.magenta),
  cyan: brighten(normal.cyan),
  white: "#ffffff",
};

// ---------------------------------------------------------------------------
// Emit YAML
// ---------------------------------------------------------------------------

// Stable filename so Warp stays on this theme across theme switches.
// The display name updates to show which theme is active, but the file
// Warp points at never changes.
const displayName = `Uber ${themeName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
const outFile = join(warpThemesDir, `uber-theme.yaml`);

const yaml = `# AUTO-GENERATED by scripts/build-warp-theme.mjs
# Source of truth: src/themes/_active.ts  →  src/themes/${themeName}.ts
# DO NOT EDIT — your changes will be overwritten on the next \`npm run build\`.

name: ${displayName}
details: "${details}"
accent: "${accent}"
background: "${bgFlat}"
cursor: "${cursor}"
foreground: "${fg}"
selection: "${selection}"

terminal_colors:
  normal:
    black:   "${normal.black}"
    red:     "${normal.red}"
    green:   "${normal.green}"
    yellow:  "${normal.yellow}"
    blue:    "${normal.blue}"
    magenta: "${normal.magenta}"
    cyan:    "${normal.cyan}"
    white:   "${normal.white}"
  bright:
    black:   "${bright.black}"
    red:     "${bright.red}"
    green:   "${bright.green}"
    yellow:  "${bright.yellow}"
    blue:    "${bright.blue}"
    magenta: "${bright.magenta}"
    cyan:    "${bright.cyan}"
    white:   "${bright.white}"
`;

// ---------------------------------------------------------------------------
// Write (skip-if-unchanged)
// ---------------------------------------------------------------------------
await mkdir(warpThemesDir, { recursive: true });

let existing = null;
try {
  existing = await readFile(outFile, "utf8");
} catch {
  // File doesn't exist yet.
}

if (existing === yaml) {
  console.log(
    `(~/.warp/themes/uber-theme.yaml unchanged — skipping write.)`
  );
  process.exit(0);
}

await writeFile(outFile, yaml, "utf8");

console.log(
  `Generated ~/.warp/themes/uber-theme.yaml  (bg: ${bgFlat}, fg: ${fg}, accent: ${accent})`
);

// Restart Warp so it picks up the new theme colors. Warp doesn't watch
// its theme files for changes, so a restart is the only way to apply
// updates. Same kill/relaunch pattern as the Thaw codegen.
try {
  execSync("pgrep -x Warp", { stdio: "ignore" });
  execSync('osascript -e \'tell application "Warp" to quit\'', {
    stdio: "ignore",
  });
  // Give Warp a moment to fully quit before relaunching.
  execSync("sleep 0.5", { stdio: "ignore" });
  execSync("open -a Warp", { stdio: "ignore" });
  console.log("Restarted Warp to pick up new theme.");
} catch {
  console.log("(Warp not running — skipping restart.)");
}
