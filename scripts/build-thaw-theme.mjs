/**
 * DEPRECATED (2026-04-24): Thaw is no longer in the main `npm run build`
 * chain — migrated to Bartender for menu bar icon management, which doesn't
 * theme the bar background. Kept intact (script + package.json entry +
 * menuBarTint theme field) so we can fall back if Bartender doesn't work
 * out. To re-enable: add `&& npm run build:thaw` back into the `build`
 * script in package.json. To run manually: `npm run build:thaw`.
 *
 * Codegen: src/themes/_active.ts  →  Thaw menu bar appearance preferences
 *
 * Thaw is a fork of Ice (jordanbaird/Ice) — a menu bar manager that also
 * customizes the bar's tint, border, gradient, and shape. Its appearance
 * config is packed into a single `MenuBarAppearanceConfigurationV2` key in
 * ~/Library/Preferences/com.stonerl.Thaw.plist. The value is a raw NSData
 * blob containing UTF-8 JSON with `lightModeConfiguration`,
 * `darkModeConfiguration`, and `staticConfiguration` — each with a
 * `tintColor`, `borderColor`, and `tintGradient.stops[]` where colors are
 * `{components: [r, g, b, a], colorSpace: <archived NSColor>}`.
 *
 * This codegen mirrors the Hammerspoon and JankyBorders codegens: bundle
 * the active theme, convert two CSS colors (primary.active, layout.cardBg)
 * into Thaw's 0..1 component arrays, and write ONLY those components back —
 * every other field (borderWidth, hasBorder, hasShadow, tintKind, the
 * colorSpace blobs, shape/margin/inset metadata) is preserved verbatim.
 *
 * Theme → Thaw mapping (applied to light, dark, AND static configurations):
 *   tintColor              ← menuBarTint          (dedicated, see below)
 *   borderColor            ← primary.active       (drawn at full alpha — stroked)
 *   borderWidth            ← layout.borderWidth   (mirrors widget card borders in px)
 *   tintGradient.stops[0]  ← layout.cardBg        (dark/frost "base")
 *   tintGradient.stops[1]  ← menuBarTint          ("edge" of the gradient)
 *
 * Why a dedicated `menuBarTint` field instead of reusing `primary.active`:
 * Ice hardcodes the main menu bar tint to 20% alpha in `drawTint()`:
 *
 *   case .solid:
 *       if let tintColor = NSColor(cgColor: configuration.tintColor)?
 *           .withAlphaComponent(0.2) { … }
 *
 * Translucent primary accents (like liquid-glass's white rgba(255,255,255,
 * 0.72)) become invisible at 0.2 alpha. `menuBarTint` is a saturated,
 * full-alpha color chosen per theme that actually reads as the theme on
 * the main bar. The border (drawn at the configured alpha, not 0.2) still
 * tracks `primary.active` so window borders and menu bar border match.
 *
 * Runtime concerns:
 * - Thaw is a Swift app that likely uses @AppStorage / Combine for its
 *   preferences. It SHOULD pick up CFPreferences notifications live, but
 *   we haven't confirmed — so we kill it first, write the plist, and
 *   relaunch. This is brief (~1s flash) but reliable. If Thaw turns out to
 *   live-reload, the restart can be dropped.
 * - The kill/write/relaunch order matters: kill first so Thaw flushes its
 *   in-memory preferences to disk, THEN we read + mutate + write. Writing
 *   while Thaw is running would race with Thaw's own flush on quit.
 * - On first run we back up the original config to .thaw-config-backup.json
 *   at the repo root so the user can restore their manually-tuned values
 *   if they don't like the theme-derived ones.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFile, access, readFile } from "node:fs/promises";
import { execSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const activeSrc = join(root, "src", "themes", "_active.ts");
const plistPath = join(
  homedir(),
  "Library",
  "Preferences",
  "com.stonerl.Thaw.plist"
);
const backupPath = join(root, ".thaw-config-backup.json");
const thawBundleId = "com.stonerl.Thaw";
const configKey = "MenuBarAppearanceConfigurationV2";

// Short-circuit if Thaw isn't installed. This codegen is opt-in by presence —
// users without Thaw get a noop.
try {
  await access(plistPath);
} catch {
  console.log(`(Thaw plist not found at ${plistPath} — skipping.)`);
  process.exit(0);
}

// 1. Bundle the active theme module graph. Same in-memory bundle → data URL
//    pattern as build-hammerspoon-theme.mjs and build-borders-config.mjs.
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

// 2. CSS color string → [r, g, b, a] components in 0..1. Mirrors the
//    converters in the hammerspoon/borders codegens but outputs the array
//    shape Thaw expects.
function cssColorToComponents(color) {
  if (typeof color !== "string") {
    throw new Error(`Expected color string, got ${typeof color}: ${color}`);
  }

  const hex = color.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [
      ((n >> 16) & 0xff) / 255,
      ((n >> 8) & 0xff) / 255,
      (n & 0xff) / 255,
      1,
    ];
  }

  const rgba = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/
  );
  if (rgba) {
    return [
      parseInt(rgba[1], 10) / 255,
      parseInt(rgba[2], 10) / 255,
      parseInt(rgba[3], 10) / 255,
      rgba[4] != null ? parseFloat(rgba[4]) : 1,
    ];
  }

  throw new Error(`Cannot parse CSS color: ${color}`);
}

// Round to 4 decimal places to match Thaw's existing plist precision and
// keep the serialized JSON diffs clean.
function round(comps) {
  return comps.map((c) => Math.round(c * 10000) / 10000);
}

// Parse "Npx" → N for Thaw's numeric borderWidth field. The theme stores
// layout.borderWidth as a CSS string ("1px", "2px") because widgets need
// the literal CSS value; Thaw wants a Double.
function pxToNumber(value) {
  const m = String(value).match(/^(-?\d+(?:\.\d+)?)px$/);
  if (!m) {
    throw new Error(`Expected pixel value (e.g. "2px"), got: ${value}`);
  }
  return parseFloat(m[1]);
}

// Schema sanity check: menuBarTint is required. Themes predating this
// field will fail here — the fix is to add a menuBarTint export to the
// theme file.
if (typeof theme.menuBarTint !== "string") {
  console.error(
    `Error: active theme missing required 'menuBarTint' export (got ${typeof theme.menuBarTint}). Add a menuBarTint field to the theme file.`
  );
  process.exit(1);
}

const tintComponents = round(cssColorToComponents(theme.menuBarTint));
const borderComponents = round(cssColorToComponents(theme.primary.active));
const cardComponents = round(cssColorToComponents(theme.layout.cardBg));
const derivedBorderWidth = pxToNumber(theme.layout.borderWidth);

// Mutate color components in-place. Every other field (colorSpace, tintKind,
// hasBorder, hasShadow, gradient locations) is preserved verbatim — we only
// overwrite the numeric component arrays + borderWidth. Pulled up here so it
// can be reused by both the skip-if-unchanged preflight and the main write
// path below.
function applyTheme(c) {
  if (c.tintColor?.components) {
    c.tintColor.components = tintComponents;
  }
  if (c.borderColor?.components) {
    c.borderColor.components = borderComponents;
  }
  if (typeof c.borderWidth === "number") {
    c.borderWidth = derivedBorderWidth;
  }
  const stops = c.tintGradient?.stops;
  if (Array.isArray(stops) && stops.length >= 2) {
    if (stops[0]?.color?.components) {
      stops[0].color.components = cardComponents;
    }
    if (stops[stops.length - 1]?.color?.components) {
      stops[stops.length - 1].color.components = tintComponents;
    }
  }
}

const requiredConfigs = [
  "lightModeConfiguration",
  "darkModeConfiguration",
  "staticConfiguration",
];

// 3a. Skip-if-unchanged preflight. Read the on-disk config WITHOUT killing
//     Thaw, apply our mutations to a clone, and compare. If identical, we
//     have nothing to write — exit early and skip the kill/restart flash
//     entirely. This is the hot path for repeat `npm run build` cycles
//     where nothing in the active theme changed.
//
//     Risk of stale read: between builds, Thaw could have flushed a
//     different in-memory state to disk. But Thaw only writes when the user
//     changes settings in its UI, which is rare; and if the preflight
//     reads something we wouldn't mutate anyway, the comparison correctly
//     says "unchanged" and skipping is safe. If Thaw has pending writes
//     that would affect the target fields, the *next* build (after those
//     pending writes flush) will still pick them up.
try {
  const preflightRaw = execSync(
    `plutil -extract ${configKey} raw -o - "${plistPath}"`,
    { encoding: "utf8" },
  ).trim();
  const preflightBytes = Buffer.from(preflightRaw, "base64");
  const currentConfig = JSON.parse(preflightBytes.toString("utf8"));

  const allSectionsPresent = requiredConfigs.every(
    (k) => currentConfig[k] && typeof currentConfig[k] === "object",
  );
  if (allSectionsPresent) {
    const candidate = JSON.parse(JSON.stringify(currentConfig));
    for (const key of requiredConfigs) applyTheme(candidate[key]);
    if (JSON.stringify(currentConfig) === JSON.stringify(candidate)) {
      console.log("(Thaw menu bar theme unchanged — skipping.)");
      process.exit(0);
    }
  }
} catch {
  // Preflight read failed — fall through to the full read/write/restart
  // flow, which has its own error handling for missing keys and schemas.
}

// 3b. Detect whether Thaw is running. If so, kill it gracefully so it flushes
//     its current preferences to disk before we read + mutate. We'll relaunch
//     at the end.
let thawWasRunning = false;
try {
  execSync("pgrep -x Thaw", { stdio: "ignore" });
  thawWasRunning = true;
} catch {
  // Not running.
}

if (thawWasRunning) {
  execSync("killall Thaw", { stdio: "ignore" });
  // Empirically 0.4-0.6s is enough for Thaw to quit and flush its
  // preferences via CFPreferencesAppSynchronize. 0.6s gives headroom.
  await new Promise((resolve) => setTimeout(resolve, 600));
}

// 4. Read the current config blob. Thaw has just flushed (or was never
//    running), so the on-disk state is authoritative.
let rawBase64;
try {
  rawBase64 = execSync(`plutil -extract ${configKey} raw -o - "${plistPath}"`, {
    encoding: "utf8",
  }).trim();
} catch {
  console.warn(
    `(Thaw plist exists but has no ${configKey} key — skipping. Configure menu bar appearance in Thaw first.)`
  );
  if (thawWasRunning) execSync("open -a Thaw", { stdio: "ignore" });
  process.exit(0);
}

const jsonBytes = Buffer.from(rawBase64, "base64");
const config = JSON.parse(jsonBytes.toString("utf8"));

// 5. First-run backup. Written once to the repo root so the user can roll
//    back to their pre-codegen Thaw state if they don't like the theme-
//    derived values.
try {
  await access(backupPath);
} catch {
  await writeFile(backupPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(
    `(Backed up pre-codegen Thaw config to ${backupPath.replace(root + "/", "")}.)`
  );
}

// 6. Schema sanity check. If Thaw ships a V3 schema the JSON shape may
//    differ — bail loudly rather than silently corrupting the config.
//    `requiredConfigs` and `applyTheme` are defined above the preflight.
for (const key of requiredConfigs) {
  if (!config[key] || typeof config[key] !== "object") {
    console.error(
      `Error: Thaw config schema mismatch — missing ${key}. Not writing.`
    );
    if (thawWasRunning) execSync("open -a Thaw", { stdio: "ignore" });
    process.exit(1);
  }
}

// 7. Mutate color components in-place and serialize.
for (const key of requiredConfigs) applyTheme(config[key]);

// 8. Serialize the modified JSON back to UTF-8 bytes, convert to hex, and
//    write via `defaults write -data`. The hex string will be ~85KB for
//    Thaw's current config; well within macOS ARG_MAX (~1MB).
const newJsonBytes = Buffer.from(JSON.stringify(config), "utf8");
const newHex = newJsonBytes.toString("hex");

// Use spawnSync with an arg array to avoid shell interpolation of the hex.
const writeResult = spawnSync(
  "defaults",
  ["write", thawBundleId, configKey, "-data", newHex],
  { stdio: ["ignore", "pipe", "inherit"] }
);
if (writeResult.status !== 0) {
  console.error("Error: `defaults write` failed.");
  if (thawWasRunning) execSync("open -a Thaw", { stdio: "ignore" });
  process.exit(writeResult.status ?? 1);
}

// 9. Relaunch Thaw if it was running before. A detached `open -a` so
//    build chain doesn't wait on Thaw's launch.
if (thawWasRunning) {
  execSync("open -a Thaw", { stdio: "ignore" });
}

const fmtRgba = (c) =>
  `rgba(${(c[0] * 255).toFixed(0)}, ${(c[1] * 255).toFixed(0)}, ${(c[2] * 255).toFixed(0)}, ${c[3]})`;
const tintFmt = fmtRgba(tintComponents);
const borderFmt = fmtRgba(borderComponents);
const cardFmt = fmtRgba(cardComponents);

console.log(
  `Updated Thaw menu bar theme  (tint: ${tintFmt}, border: ${borderFmt} @ ${derivedBorderWidth}px, gradient base: ${cardFmt})`
);
if (thawWasRunning) {
  console.log("Restarted Thaw to pick up new config.");
} else {
  console.log("(Thaw not running — will pick up new theme on next launch.)");
}
