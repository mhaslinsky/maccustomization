/**
 * Codegen: src/themes/_active.ts  →  Bartender 6 menu bar style preferences
 *
 * Bartender 6 is a menu bar icon manager that (in v5+) also themes the bar
 * background itself — tint/gradient, border, shape, rounding, shadow. Its
 * appearance config is packed into a single `stored_style` key in
 * ~/Library/Preferences/com.surteesstudios.Bartender.plist. The value is an
 * NSData blob containing base64-encoded UTF-8 JSON.
 *
 * Schema (as observed from a configured Bartender 6 install):
 *   {
 *     "shape": "capsule" | "bar" | ...,
 *     "baseStyle": { "standard" | "glass" | "gradient" | "custom": {...} },
 *     "shadow": bool,
 *     "roundBottomofBar": bool,      // sic — typo preserved by Bartender
 *     "roundBottomOfScreen": bool,
 *     "seperatePills": bool,         // sic — typo preserved by Bartender
 *     "colors": [
 *       { "color": {red, green, blue, alpha},  // 0..1 floats
 *         "location": 0..1 }
 *     ],
 *     "border": {
 *       "color": {red, green, blue, alpha},
 *       "position": "complete" | ...,
 *       "thickness": <number in px>
 *     }
 *   }
 *
 * This codegen mirrors the Thaw codegen: bundle the active theme, convert CSS
 * colors into Bartender's 0..1 {red,green,blue,alpha} objects, and write ONLY
 * the color/thickness fields back. Everything structural (shape, baseStyle
 * mode, shadow, roundBottom* flags, seperatePills, number of color stops,
 * stop `location` values, border `position`) is preserved verbatim — the user
 * owns those through Bartender's Style UI.
 *
 * Theme → Bartender mapping:
 *   colors[0].color          ← layout.cardBg       (gradient "base" / first stop)
 *   colors[last].color       ← menuBarTint         (gradient "edge" / last stop)
 *   border.color             ← primary.active      (matches window borders)
 *   border.thickness         ← layout.borderWidth  (parsed from "Npx")
 *
 * If `colors` has only one stop, both assignments apply to the same entry;
 * menuBarTint wins (it's the dedicated bar-color token). If `colors` is
 * empty, nothing is written to the array — user hasn't configured color
 * stops, so there's nothing theme-derivable.
 *
 * Runtime concerns:
 * - Bartender 6 caches preferences in memory. Writes to the plist while
 *   Bartender is running race against its own flush-on-quit. Same solution
 *   as the Thaw codegen: kill first, write, relaunch.
 * - App binary name is `Bartender 6` (with space + version), which changes
 *   per major release. We use bundle ID `com.surteesstudios.Bartender` for
 *   quit (via osascript) and relaunch (via `open -b`) so this codegen keeps
 *   working across Bartender 7+. The only version-coupled thing is the
 *   pgrep match pattern, which uses a regex that matches "Bartender <N>".
 * - On first run we back up the original config to
 *   .bartender-config-backup.json at the repo root so the user can restore
 *   their manually-tuned values if they don't like the theme-derived ones.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, access } from "node:fs/promises";
import { execSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const activeSrc = join(root, "src", "themes", "_active.ts");
const plistPath = join(
  homedir(),
  "Library",
  "Preferences",
  "com.surteesstudios.Bartender.plist"
);
const backupPath = join(root, ".bartender-config-backup.json");
const bartenderBundleId = "com.surteesstudios.Bartender";
const configKey = "stored_style";
// Matches `Bartender 6`, `Bartender 7`, ... but not the `Bartender Service`
// XPC helper. The `[0-9]` anchors to the version digit.
const bartenderPgrepPattern = "Contents/MacOS/Bartender [0-9]";

try {
  await access(plistPath);
} catch {
  console.log(`(Bartender plist not found at ${plistPath} — skipping.)`);
  process.exit(0);
}

// 1. Bundle the active theme module graph.
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

// 2. CSS color → {red, green, blue, alpha} (0..1 floats) — Bartender's shape.
function cssColorToObj(color) {
  if (typeof color !== "string") {
    throw new Error(`Expected color string, got ${typeof color}: ${color}`);
  }

  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return {
      red: ((n >> 16) & 0xff) / 255,
      green: ((n >> 8) & 0xff) / 255,
      blue: (n & 0xff) / 255,
      alpha: 1,
    };
  }

  const rgba = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/
  );
  if (rgba) {
    return {
      red: parseInt(rgba[1], 10) / 255,
      green: parseInt(rgba[2], 10) / 255,
      blue: parseInt(rgba[3], 10) / 255,
      alpha: rgba[4] != null ? parseFloat(rgba[4]) : 1,
    };
  }

  throw new Error(`Cannot parse CSS color: ${color}`);
}

// Round to 4 decimal places to match the precision Bartender writes and keep
// serialized JSON diffs stable across builds.
function roundObj(c) {
  return {
    red: Math.round(c.red * 10000) / 10000,
    green: Math.round(c.green * 10000) / 10000,
    blue: Math.round(c.blue * 10000) / 10000,
    alpha: Math.round(c.alpha * 10000) / 10000,
  };
}

function pxToNumber(value) {
  const m = String(value).match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!m) {
    throw new Error(`Expected pixel value (e.g. "2px"), got: ${value}`);
  }
  return parseFloat(m[1]);
}

if (typeof theme.menuBarTint !== "string") {
  console.error(
    `Error: active theme missing required 'menuBarTint' export (got ${typeof theme.menuBarTint}). Add a menuBarTint field to the theme file.`
  );
  process.exit(1);
}

const tintObj = roundObj(cssColorToObj(theme.menuBarTint));
const borderObj = roundObj(cssColorToObj(theme.primary.active));
const cardObj = roundObj(cssColorToObj(theme.layout.cardBg));
const derivedBorderWidth = pxToNumber(theme.layout.borderWidth);

function applyTheme(style) {
  if (Array.isArray(style.colors) && style.colors.length > 0) {
    // First stop = "base" (card bg). Last stop = "edge" (menuBarTint). If
    // there's only one stop, tint wins — it's the dedicated bar-color token.
    if (style.colors[0]?.color) {
      style.colors[0].color = { ...cardObj };
    }
    const last = style.colors.length - 1;
    if (style.colors[last]?.color) {
      style.colors[last].color = { ...tintObj };
    }
  }
  if (style.border?.color) {
    style.border.color = { ...borderObj };
  }
  if (style.border && typeof style.border.thickness === "number") {
    style.border.thickness = derivedBorderWidth;
  }
}

// 3a. Skip-if-unchanged preflight.
try {
  const preflightRaw = execSync(
    `plutil -extract ${configKey} raw -o - "${plistPath}"`,
    { encoding: "utf8" }
  ).trim();
  const preflightBytes = Buffer.from(preflightRaw, "base64");
  const currentStyle = JSON.parse(preflightBytes.toString("utf8"));

  const candidate = JSON.parse(JSON.stringify(currentStyle));
  applyTheme(candidate);
  if (JSON.stringify(currentStyle) === JSON.stringify(candidate)) {
    console.log("(Bartender menu bar style unchanged — skipping.)");
    process.exit(0);
  }
} catch {
  // Fall through to full read/write/restart.
}

// 3b. Detect whether Bartender is running, quit gracefully via AppleScript
//     (sends the bundle ID a `quit` event — lets Bartender flush preferences
//     cleanly before we read the plist).
let bartenderWasRunning = false;
try {
  execSync(`pgrep -f "${bartenderPgrepPattern}"`, { stdio: "ignore" });
  bartenderWasRunning = true;
} catch {
  // Not running.
}

if (bartenderWasRunning) {
  // AppleScript quit is gentler than killall — Bartender gets to run its
  // -applicationWillTerminate: and flush preferences via
  // CFPreferencesAppSynchronize. Fall back to killall if the AppleScript
  // hangs (Bartender prompts on quit in some configs).
  const quitResult = spawnSync(
    "osascript",
    ["-e", `tell application id "${bartenderBundleId}" to quit`],
    { stdio: "ignore", timeout: 3000 }
  );
  if (quitResult.status !== 0) {
    // Fallback: hard kill by pattern match on the versioned executable name.
    try {
      execSync(`pkill -f "${bartenderPgrepPattern}"`, { stdio: "ignore" });
    } catch {}
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
}

// 4. Read the current style blob.
let rawBase64;
try {
  rawBase64 = execSync(`plutil -extract ${configKey} raw -o - "${plistPath}"`, {
    encoding: "utf8",
  }).trim();
} catch {
  console.warn(
    `(Bartender plist exists but has no ${configKey} key — skipping. Configure menu bar Style in Bartender first.)`
  );
  if (bartenderWasRunning) {
    execSync(`open -b ${bartenderBundleId}`, { stdio: "ignore" });
  }
  process.exit(0);
}

const jsonBytes = Buffer.from(rawBase64, "base64");
const style = JSON.parse(jsonBytes.toString("utf8"));

// 5. First-run backup.
try {
  await access(backupPath);
} catch {
  await writeFile(backupPath, JSON.stringify(style, null, 2) + "\n", "utf8");
  console.log(
    `(Backed up pre-codegen Bartender style to ${backupPath.replace(root + "/", "")}.)`
  );
}

// 6. Schema sanity check — bail loudly if the basic shape has changed.
if (typeof style !== "object" || style === null) {
  console.error("Error: Bartender stored_style is not an object. Not writing.");
  if (bartenderWasRunning) {
    execSync(`open -b ${bartenderBundleId}`, { stdio: "ignore" });
  }
  process.exit(1);
}

// 7. Mutate and serialize.
applyTheme(style);
const newJsonBytes = Buffer.from(JSON.stringify(style), "utf8");
const newHex = newJsonBytes.toString("hex");

const writeResult = spawnSync(
  "defaults",
  ["write", bartenderBundleId, configKey, "-data", newHex],
  { stdio: ["ignore", "pipe", "inherit"] }
);
if (writeResult.status !== 0) {
  console.error("Error: `defaults write` failed.");
  if (bartenderWasRunning) {
    execSync(`open -b ${bartenderBundleId}`, { stdio: "ignore" });
  }
  process.exit(writeResult.status ?? 1);
}

// 8. Relaunch Bartender if it was running.
if (bartenderWasRunning) {
  execSync(`open -b ${bartenderBundleId}`, { stdio: "ignore" });
}

const fmtRgba = (c) =>
  `rgba(${(c.red * 255).toFixed(0)}, ${(c.green * 255).toFixed(0)}, ${(c.blue * 255).toFixed(0)}, ${c.alpha})`;
const tintFmt = fmtRgba(tintObj);
const borderFmt = fmtRgba(borderObj);
const cardFmt = fmtRgba(cardObj);
const stopCount = Array.isArray(style.colors) ? style.colors.length : 0;

console.log(
  `Updated Bartender menu bar style  (tint: ${tintFmt}, border: ${borderFmt} @ ${derivedBorderWidth}px, gradient base: ${cardFmt}, ${stopCount} color stop${stopCount === 1 ? "" : "s"})`
);
if (bartenderWasRunning) {
  console.log("Restarted Bartender to pick up new style.");
} else {
  console.log("(Bartender not running — will pick up new style on next launch.)");
}
