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
import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { generateWarpBackground } from "./generate-warp-bg.mjs";

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
const dataUrl = "data:text/javascript;base64," + Buffer.from(code).toString("base64");
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
  const rgba = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
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
//
// We composite the translucent cardBg onto an opaque "base" to flatten
// alpha. The base color matters a lot: a fixed near-black base (what
// this used to be) drains hue out of tinted cardBgs (frutiger-aero's
// sky-blue ends up reading as neutral dark gray once Warp paints it
// at 78% opacity). Instead, derive the base from cardBg's own RGB —
// a darker tinted version of the same hue — so the color cast carries
// through. For neutral dark cardBgs (liquid-glass-dark) this still
// produces a dark result; for hue-rich cardBgs (frutiger-aero) the
// gradient stays on-brand instead of going gray.
const bgParsed = parseColor(theme.layout.cardBg);
const bgBase =
  bgParsed.a >= 1
    ? { r: 6, g: 8, b: 28, a: 1 } // unused for opaque themes, kept for safety
    : {
        r: Math.round(bgParsed.r * 0.4),
        g: Math.round(bgParsed.g * 0.4),
        b: Math.round(bgParsed.b * 0.4),
        a: 1,
      };
const bgFlat = bgParsed.a >= 1 ? toHex(bgParsed) : toHex(composite(bgParsed, bgBase));

// Glass themes (translucent cardBg) get a vertical gradient background to
// echo the widget look — widgets carry an inset top-edge white highlight
// (shadow: "inset 0 1px 0 rgba(255,255,255,0.45)") and a soft drop shadow
// at the bottom, so the eye reads them as top-lit. Mirroring that as a
// subtle top-bright / bottom-dim gradient on the terminal pane locks
// Warp visually into the same material as the widgets.
//
// Warp's YAML supports Fill::VerticalGradient as { top, bottom } hex pair
// (crates/warp_core/src/ui/theme/mod.rs). Solid hex still works for opaque
// themes — we keep that path so non-glass themes (catppuccin, default)
// don't pick up a gradient they weren't designed for.
const isGlassTheme = bgParsed.a < 1;
// Desaturate the bg before deriving the gradient. Tinted cardBgs
// (frutiger-aero's sky-blue) carry through as a strongly cyan terminal
// background, which fights with the wallpaper at 25% opacity. Pulling the
// bg toward its luminance-equivalent gray drops the chroma without
// touching brightness — the gradient stays just as crisp, just less blue.
// Applied only to the gradient; cssToHex composites still use the original
// bgFlat so ANSI normalization is unaffected.
//
// Lighter desaturation (0.4 vs 0.7) than the bare-gradient path used to
// run, because the gradient now bakes into a JPEG composited at 60% opacity
// over the saturated `bgFlat` solid — the solid base mixes color back in,
// so the gradient itself can carry more chroma without overpowering.
const bgForGradient = isGlassTheme ? desaturate(bgFlat, 0.4) : bgFlat;
// IMPORTANT readability constraint: Warp's `font_color` calls
// `pick_best_foreground_color(local_surface, theme.background_midpoint,
// theme.foreground)` and picks whichever extreme has more contrast
// against the surface. With Warp at 25% opacity over arbitrary
// wallpapers, the local surface can be bright — and if our gradient
// midpoint is also brightish, the picker chooses it (a medium gray-blue)
// over white, which renders as near-black text on the wallpaper. Keep
// the midpoint genuinely dark so white always wins.
const bgGradient = isGlassTheme
  ? {
      // Top is brightened from the cardBg-tinted base, but capped so the
      // top edge doesn't drift above midtone — at 25% opacity, anything
      // brighter starts losing contrast against pale wallpaper sections.
      top: brighten(bgForGradient, 0.18),
      // Bottom darkened more aggressively. This is what anchors the
      // gradient midpoint dark enough that `pick_best_foreground_color`
      // reliably picks white.
      bottom: darken(bgForGradient, 0.35),
    }
  : null;

// Determine if this is a "darker" or "lighter" theme based on bg luminance.
const bgRgb = parseColor(bgFlat);
const luminance = 0.299 * bgRgb.r + 0.587 * bgRgb.g + 0.114 * bgRgb.b;
const detailsKind = luminance < 128 ? "darker" : "lighter";

// Note on `details: custom`: the source (warp_core/src/ui/theme/color.rs)
// only honors `hint_text_opacity` from CustomDetails — `main_text_color`,
// `sub_text_color`, and `disabled_text_color` use HARDCODED 90/60/40
// opacities and ignore the custom values. So overriding with a custom
// block buys us almost nothing while risking deserialization mismatches.
// Stay on the bare "darker"/"lighter" string and address readability
// through the bg color and gradient (above) instead.

// For glass themes we run Warp at very low opacity (~25) so the wallpaper
// shows through. Tinted off-whites like frutiger-aero's #f0faff get
// crushed against busy/bright wallpapers — pure white is the only fg
// that stays readable across arbitrary backdrops. Opaque themes keep
// using the accent text color (no transparency, no readability concern).
const fg = isGlassTheme ? "#ffffff" : cssToHex(theme.accents.status.text, bgFlat);
// Accent: opaque themes use menuBarTint (always saturated/full-alpha; avoids
// the gray-out that primary.active causes in glass themes where the border is
// white). Glass themes route through accents.status.h1 instead — menuBarTint
// is tuned for the menu bar (Bartender/Ice's 0.2-alpha cap forces a saturated
// hex), but at Warp's 25% window opacity that same saturated tone reads
// dirty next to the pale-aqua glass; status.h1 is the pastel aqua we already
// use for widget headers and is the design's recommended terminal accent.
const accentSource = isGlassTheme ? theme.accents.status.h1 : theme.menuBarTint;
const accent = cssToHex(accentSource, bgFlat);
const cursor = accent;
// Selection: use the accent at reduced opacity over bg.
const accentParsed = parseColor(accentSource);
accentParsed.a = 0.25;
const selection = toHex(composite(accentParsed, parseColor(bgFlat)));

// ANSI palette — map semantic theme colors to terminal color slots.
// Each accent maps to the ANSI slot closest to its hue family:
//   status  (cyan/blue family) → cyan
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
  blue: cssToHex(theme.accents.status.border, bgFlat),
  magenta: cssToHex(theme.accents.nowplaying.h1, bgFlat),
  cyan: cssToHex(theme.accents.status.h1, bgFlat),
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

// Pull each channel toward its luminance-equivalent gray. Drops chroma
// without changing perceived brightness — useful when a tinted cardBg
// reads too saturated at Warp's low window opacity.
function desaturate(hex, amount = 0.5) {
  const c = parseColor(hex);
  const gray = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  return toHex({
    r: Math.round(c.r + (gray - c.r) * amount),
    g: Math.round(c.g + (gray - c.g) * amount),
    b: Math.round(c.b + (gray - c.b) * amount),
    a: 1,
  });
}

// Mirror image of brighten — pull each channel toward black.
function darken(hex, amount = 0.1) {
  const c = parseColor(hex);
  return toHex({
    r: Math.round(c.r * (1 - amount)),
    g: Math.round(c.g * (1 - amount)),
    b: Math.round(c.b * (1 - amount)),
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

// Per-theme filename. Warp's user prefs store the active custom theme as
// {name, path} — keeping a stable filename and only changing the `name:`
// inside the YAML left Warp's stored selection out of sync with the file
// contents (Warp would keep showing the previous theme, or fall back).
// One file per theme + a `defaults write` to update the active selection
// keeps name and path coherent.
const displayName = `Uber ${themeName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`;
const outFile = join(warpThemesDir, `uber-${themeName}.yaml`);

// Background composition:
// - Opaque themes (catppuccin, default): flat hex `background: "#..."`.
// - Glass themes: render a Frutiger-Aero/Zen-style grainy JPEG (vertical
//   gradient + soft accent hot-spot + film grain) and reference it via
//   `background_image: { path, opacity }`. Warp's schema only accepts
//   JPEG and only one of `background:` (gradient) OR `background_image:` —
//   the image fully replaces the gradient when present.
//
// `background:` still emits a *solid* anchor color so Warp's
// `pick_best_foreground_color` has a stable surface for contrast picking
// even when the image hasn't loaded yet.
const bgImageFile = `uber-${themeName}.jpg`;
const bgImagePath = join(warpThemesDir, bgImageFile);
// Tunable knobs come from the theme's optional `controls.warp` block
// (see src/themes/_types.ts → WarpControls). Each falls back to a built-in
// default if the theme doesn't override.
const warpControls = theme.controls?.warp ?? {};
const bgImageOpacity = warpControls.bgImageOpacity ?? 20;
const noiseAlphaMax = warpControls.noiseAlphaMax ?? 140;
const noiseDarkProb = warpControls.noiseDarkProb ?? 0.5;

// We compose the YAML first; the JPEG is rendered later, only if the YAML
// actually changed or the image is missing on disk. Sharp + raw-buffer
// noise is ~250ms which adds up across rebuilds.
//
// The YAML diff is our regen trigger, so we embed a fingerprint comment
// containing every input that affects the JPEG (gradient stops + hot-spot
// color + noise knobs). Without it, tweaking the noise alpha in a theme's
// `controls.warp` block would keep producing the same `background:` hex +
// `background_image:` stanza, fileChanged would stay false, and the stale
// image would never regenerate.
const hotspotColor = bgGradient ? cssToHex(theme.accents.status.h1, bgFlat) : null;
const bgImageFingerprint = bgGradient
  ? `# bg-image: top=${bgGradient.top} bottom=${bgGradient.bottom} hotspot=${hotspotColor} noiseAlphaMax=${noiseAlphaMax} noiseDarkProb=${noiseDarkProb}`
  : "";
const backgroundYaml = bgGradient
  ? `background: "${bgFlat}"\nbackground_image:\n  path: ${bgImageFile}\n  opacity: ${bgImageOpacity}\n${bgImageFingerprint}`
  : `background: "${bgFlat}"`;

const yaml = `# AUTO-GENERATED by scripts/build-warp-theme.mjs
# Source of truth: src/themes/_active.ts  →  src/themes/${themeName}.ts
# DO NOT EDIT — your changes will be overwritten on the next \`npm run build\`.

name: ${displayName}
details: "${detailsKind}"
accent: "${accent}"
${backgroundYaml}
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

const fileChanged = existing !== yaml;
if (fileChanged) {
  await writeFile(outFile, yaml, "utf8");
  const bgDesc = bgGradient
    ? `bg: ${bgGradient.top}→${bgGradient.bottom} + grain image @${bgImageOpacity}%`
    : `bg: ${bgFlat}`;
  console.log(`Generated ~/.warp/themes/uber-${themeName}.yaml  (${bgDesc}, fg: ${fg}, accent: ${accent})`);
} else {
  console.log(`(~/.warp/themes/uber-${themeName}.yaml unchanged.)`);
}

let bgImageRegenerated = false;
if (bgGradient) {
  let imageMissing = false;
  try {
    await stat(bgImagePath);
  } catch {
    imageMissing = true;
  }
  if (fileChanged || imageMissing) {
    await generateWarpBackground({
      gradient: bgGradient,
      hotspotColor,
      outPath: bgImagePath,
      noiseAlphaMax,
      noiseDarkProb,
    });
    bgImageRegenerated = true;
    const s = await stat(bgImagePath);
    console.log(`Generated ~/.warp/themes/${bgImageFile}  (${(s.size / 1024).toFixed(0)} KB)`);
  }
} else {
  // Opaque theme — drop any stale glass-theme JPEG from a prior switch.
  try {
    await unlink(bgImagePath);
    console.log(`Removed stale ~/.warp/themes/${bgImageFile}.`);
  } catch {
    // Doesn't exist — nothing to do.
  }
}

// ---------------------------------------------------------------------------
// Point Warp at this theme (update active selection if it doesn't already match)
// ---------------------------------------------------------------------------
// Warp's active theme lives in dev.warp.Warp-Stable's `Theme` key as a JSON
// string: {"Custom":{"name":"<displayName>","path":"<absolute path>"}}.
// We only rewrite if the current selection differs — avoids needlessly
// restarting Warp on every build.
const wantedTheme = JSON.stringify({
  Custom: { name: displayName, path: outFile },
});

let currentTheme = "";
try {
  currentTheme = execSync("defaults read dev.warp.Warp-Stable Theme", {
    encoding: "utf8",
  }).trim();
} catch {
  // Key doesn't exist yet — first run.
}

const selectionChanged = currentTheme !== wantedTheme;
if (selectionChanged) {
  execSync(`defaults write dev.warp.Warp-Stable Theme -string ${JSON.stringify(wantedTheme)}`, {
    stdio: "ignore",
  });
  console.log(`Set Warp active theme → "${displayName}".`);
}

// ---------------------------------------------------------------------------
// Clean up the legacy single-file output if it exists from older builds.
// ---------------------------------------------------------------------------
const legacyFile = join(warpThemesDir, "uber-theme.yaml");
if (legacyFile !== outFile) {
  try {
    await readFile(legacyFile, "utf8");
    await unlink(legacyFile);
    console.log("Removed legacy ~/.warp/themes/uber-theme.yaml.");
  } catch {
    // Doesn't exist — nothing to do.
  }
}

// ---------------------------------------------------------------------------
// Restart Warp if anything changed (file contents or active selection).
// Warp doesn't watch its theme files OR its prefs file, so a relaunch is
// the only way to apply updates.
// ---------------------------------------------------------------------------
if (!fileChanged && !selectionChanged && !bgImageRegenerated) {
  process.exit(0);
}

// Detect Warp via AppleScript, NOT pgrep. macOS's pgrep matches against
// the kernel-level p_comm — for the Warp binary at /Applications/Warp.app/
// Contents/MacOS/stable that value isn't reliably "Warp" OR "stable" (the
// `ps -o ucomm` display value can differ from what pgrep actually sees).
// Both `pgrep -x Warp` and `pgrep -x stable` silently miss while Warp is
// running, so the restart branch never fires and YAML/JPEG edits look
// like no-ops. AppleScript's `application "X" is running` queries the
// Process Manager directly and is the canonical macOS way to check.
// `stable_app` is the persistent background server that re-attaches
// windows with cached theme state; killing it forces a fresh parse.
try {
  execSync("osascript -e 'application \"Warp\" is running' | grep -q '^true$'", {
    stdio: "ignore",
    shell: "/bin/sh",
  });
  execSync("osascript -e 'tell application \"Warp\" to quit'", {
    stdio: "ignore",
  });
  execSync("sleep 0.5", { stdio: "ignore" });
  execSync("killall stable_app 2>/dev/null; true", { stdio: "ignore" });
  execSync("open -a Warp", { stdio: "ignore" });
  console.log("Restarted Warp to pick up new theme.");
} catch {
  console.log("(Warp not running — skipping restart.)");
}
