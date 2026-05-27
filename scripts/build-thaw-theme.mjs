/**
 * MANUAL-ONLY (reactivated 2026-05-27): not in the `npm run build` chain.
 * Thaw was deprecated 2026-04-24 in favor of Bartender; Bartender 6 proved
 * unstable on macOS 26 Tahoe, and Thaw shipped an actively-maintained 2.0
 * beta line that fixes the Tahoe stability issues AND adds a configurable
 * menu bar background (solid/gradient/glass). So Thaw is back — but kept
 * manual-only while the 2.0 beta channel stabilizes. Run: `npm run
 * build:thaw`. To re-chain: add `&& npm run build:thaw` to the `build`
 * script in package.json.
 *
 * Codegen: src/themes/_active.ts  →  Thaw menu bar appearance preferences
 *
 * Thaw (stonerl/Thaw, a fork of jordanbaird/Ice) is a menu bar manager that
 * also themes the bar's tint, border, gradient, glass material, and shape.
 * Its appearance config is packed into a single
 * `MenuBarAppearanceConfigurationV2` key in
 * ~/Library/Preferences/com.stonerl.Thaw.plist (the bundle id is
 * `com.stonerl.Thaw` — the fork renamed it; only the JSON sub-keys still
 * carry the "Ice" lineage). The value is a raw NSData blob of UTF-8 JSON
 * with `lightModeConfiguration`, `darkModeConfiguration`, and
 * `staticConfiguration` — each a MenuBarAppearancePartialConfiguration.
 *
 * Color encoding (Thaw/UI/Utilities/IceColor.swift): each color is
 * `{components: [...], colorSpace: <base64 ICC profile>}`, decoded via
 * `CGColor(colorSpace:components:)`. That call requires
 * `components.count == colorSpace.numberOfComponents + 1`. Thaw stores
 * tintColor/borderColor as 4-component sRGB but backgroundColor /
 * backgroundBorderColor as 2-component GRAYSCALE. So writing a 4-component
 * rgba array into a grayscale field while leaving its colorSpace intact
 * makes `CGColor(...)` return nil and Thaw rejects (resets) the whole
 * config. `writeColor()` therefore stamps the sRGB ICC blob (lifted from
 * the config's own tintColor) onto any field it converts to rgba.
 *
 * Theme → Thaw mapping (applied to light, dark, AND static configurations).
 * Tint/border/gradient are always driven (parity with the pre-2.0 codegen).
 * The background material is driven ONLY when the active theme opts in via
 * `controls.thaw.background` — otherwise background fields are preserved:
 *   tintColor                    ← menuBarTint
 *   tintOpacity                  ← controls.thaw.tintOpacity   (if set; uncapped, see below)
 *   borderColor                  ← primary.active
 *   borderWidth                  ← layout.borderWidth
 *   tintGradient.stops[0 / -1]   ← layout.cardBg / menuBarTint
 *   backgroundKind               ← controls.thaw.background    (enum; gates the rest)
 *   backgroundColor              ← layout.cardBg               (+ sRGB colorSpace swap)
 *   backgroundOpacity            ← controls.thaw.backgroundOpacity ?? cardBg alpha
 *   backgroundGradient.stops     ← layout.cardBg / menuBarTint
 *   backgroundBorderColor/Width  ← primary.active / layout.borderWidth
 *   background/tintGlassStyle    ← controls.thaw.glassStyle    (if set)
 *
 * On the `menuBarTint` field and Ice's old 0.2 cap: Ice hardcoded the main
 * bar tint to 20% alpha in `drawTint()` (`.withAlphaComponent(0.2)`), so a
 * dedicated saturated full-alpha `menuBarTint` was needed to stay visible.
 * Thaw 2.0 exposes `tintOpacity` as a real field — the cap is gone — but
 * `menuBarTint` is retained: Warp also consumes it for the terminal accent,
 * and it remains a sensible "bar accent" distinct from translucent
 * `primary.active`. Opacity is now controlled separately via
 * `controls.thaw.tintOpacity`.
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

// Thaw enum mappings (mirror the Swift source: MenuBarBackgroundKind,
// MenuBarGlassStyle). tintKind shares MenuBarBackgroundKind's layout.
const BG_KIND = { none: 0, solid: 1, gradient: 2, glass: 3, adaptive: 4 };
const GLASS_STYLE = { regular: 0, clear: 1 };

// Read the optional per-theme Thaw knobs. A theme with no `controls.thaw`
// keeps the pre-2.0 behavior: tint/border/gradient driven, background left
// alone.
const thawControls = theme.controls?.thaw ?? {};

let bgKind = null;
if (thawControls.background != null) {
  bgKind = BG_KIND[thawControls.background];
  if (bgKind == null) {
    console.error(
      `Error: controls.thaw.background = ${JSON.stringify(thawControls.background)} is not a valid MenuBarBackgroundKind (${Object.keys(BG_KIND).join(", ")}).`
    );
    process.exit(1);
  }
}

let glassStyle = null;
if (thawControls.glassStyle != null) {
  glassStyle = GLASS_STYLE[thawControls.glassStyle];
  if (glassStyle == null) {
    console.error(
      `Error: controls.thaw.glassStyle = ${JSON.stringify(thawControls.glassStyle)} is not a valid MenuBarGlassStyle (${Object.keys(GLASS_STYLE).join(", ")}).`
    );
    process.exit(1);
  }
}

const tintOpacity =
  typeof thawControls.tintOpacity === "number" ? thawControls.tintOpacity : null;
// Background opacity defaults to the cardBg alpha so the bar matches the
// widget card density. Only used when a background kind is set.
const bgOpacity =
  typeof thawControls.backgroundOpacity === "number"
    ? thawControls.backgroundOpacity
    : (cardComponents[3] ?? null);

// Write [r,g,b,a] into a color object AND stamp the sRGB ICC profile onto it.
// Critical: Thaw's grayscale-default fields (backgroundColor,
// backgroundBorderColor) carry a 1-component colorSpace; writing 4 components
// without swapping the profile makes Thaw's CGColor decode return nil and
// reject the entire config. `srgb` is lifted from the config's own tintColor
// (always 4-component sRGB), so the count matches.
function writeColor(colorObj, components, srgb) {
  if (!colorObj?.components) return;
  colorObj.components = components;
  if (srgb && components.length === 4) colorObj.colorSpace = srgb;
}

// Mutate the partial configuration in-place. Tint/border/gradient are always
// driven; the background material block only runs when the theme opted into a
// background kind. Structural fields (shape, margins, inset) are untouched.
// Shared by the skip-if-unchanged preflight and the main write path.
function applyTheme(c) {
  const srgb = c.tintColor?.colorSpace; // 4-component sRGB ICC blob

  // --- Tint overlay ---
  writeColor(c.tintColor, tintComponents, srgb);
  if (tintOpacity != null) c.tintOpacity = tintOpacity;

  // --- Border (stroked at the configured alpha, not the tint cap) ---
  writeColor(c.borderColor, borderComponents, srgb);
  if (typeof c.borderWidth === "number") c.borderWidth = derivedBorderWidth;

  // --- Tint gradient: cardBg base → menuBarTint edge ---
  const tg = c.tintGradient?.stops;
  if (Array.isArray(tg) && tg.length >= 2) {
    writeColor(tg[0]?.color, cardComponents, srgb);
    writeColor(tg[tg.length - 1]?.color, tintComponents, srgb);
  }

  // --- Background material (Thaw 2.0; opt-in via controls.thaw.background) ---
  if (bgKind != null) {
    c.backgroundKind = bgKind;
    writeColor(c.backgroundColor, cardComponents, srgb);
    if (bgOpacity != null) c.backgroundOpacity = bgOpacity;
    writeColor(c.backgroundBorderColor, borderComponents, srgb);
    if (typeof c.backgroundBorderWidth === "number") {
      c.backgroundBorderWidth = derivedBorderWidth;
    }
    const bg = c.backgroundGradient?.stops;
    if (Array.isArray(bg) && bg.length >= 2) {
      writeColor(bg[0]?.color, cardComponents, srgb);
      writeColor(bg[bg.length - 1]?.color, tintComponents, srgb);
    }
  }

  // --- Glass style (applies to both glass surfaces; harmless if not glass) ---
  if (glassStyle != null) {
    c.backgroundGlassStyle = glassStyle;
    c.tintGlassStyle = glassStyle;
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

const bgKindName =
  Object.keys(BG_KIND).find((k) => BG_KIND[k] === bgKind) ?? null;
const bgFmt =
  bgKind != null
    ? `, background: ${bgKindName}${glassStyle != null ? ` (${Object.keys(GLASS_STYLE).find((k) => GLASS_STYLE[k] === glassStyle)})` : ""} ${cardFmt} @ ${bgOpacity}`
    : "";
console.log(
  `Updated Thaw menu bar theme  (tint: ${tintFmt}${tintOpacity != null ? ` @ ${tintOpacity}` : ""}, border: ${borderFmt} @ ${derivedBorderWidth}px, gradient base: ${cardFmt}${bgFmt})`
);
if (thawWasRunning) {
  console.log("Restarted Thaw to pick up new config.");
} else {
  console.log("(Thaw not running — will pick up new theme on next launch.)");
}
