/**
 * Codegen: src/themes/_active.ts  ->  ~/.config/spicetify/Themes/uber-theme/
 *
 * Spicetify (Spotify customization) integration -- flat, color-only.
 *
 * Strategy:
 *   - Emit color.ini ONLY (no glass user.css). The 2026-05-01 attempt at
 *     glass-style Spicetify is documented in skill spicetify-flat-theme
 *     (formerly spotify-spicetify-not-viable) as a dead end -- Spotify's
 *     NSWindow is opaque on macOS, so backdrop-filter samples Spotify's
 *     own content, not the desktop wallpaper. We commit to flat colors.
 *   - user.css is a single-line ASCII placeholder so Spicetify's theme-dir
 *     validation passes; we do not inject custom selectors.
 *   - Patch ~/.config/spicetify/config-xpui.ini in place: set
 *     current_theme = uber-theme and color_scheme = base. Other keys
 *     preserved.
 *   - ASCII-only header in color.ini (prior attempt's em-dashes triggered
 *     "No section found" errors from Spicetify's INI parser; see skill).
 *
 * Application:
 *   - This codegen writes files; it does NOT run `spicetify apply`.
 *     `spicetify apply` rewrites Spotify's xpui.js with the new color
 *     scheme baked in, requires Spotify closed, and restarts it. Per
 *     project convention (memory: feedback_app_restarts.md) we ask the
 *     user to close apps before triggering restarts; we don't trust pgrep
 *     and we don't surprise-restart Spotify.
 *   - After this codegen runs, the user must: close Spotify, then run
 *     `spicetify apply`. (Subsequent runs only require `spicetify apply`
 *     after color.ini changes; `spicetify watch -s` would auto-reload
 *     if running, but we don't manage that.)
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const activeSrc = join(root, "src", "themes", "_active.ts");

// ---------------------------------------------------------------------------
// Load active theme (same esbuild -> data-URL -> dynamic-import pattern as
// the other codegens).
// ---------------------------------------------------------------------------

const result = await esbuild.build({
  entryPoints: [activeSrc],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  logLevel: "silent",
});
const dataUrl = "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64");
const theme = await import(dataUrl);

const activeSrcText = await readFile(activeSrc, "utf8");
const nameMatch = activeSrcText.match(/from\s+["']\.\/([^"']+?)(?:\.js)?["']/);
const themeName = nameMatch ? nameMatch[1] : "custom";

// ---------------------------------------------------------------------------
// Color helpers (duplicated from build-obsidian-theme.mjs per
// codegen-self-contained convention).
// ---------------------------------------------------------------------------

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
  const hh = (n) => Math.min(255, Math.max(0, n)).toString(16).padStart(2, "0").toUpperCase();
  return `${hh(c.r)}${hh(c.g)}${hh(c.b)}`;
}

function flatten(color, bgColor) {
  const fg = parseColor(color);
  if (fg.a >= 1) return toHex(fg);
  const bg = bgColor ? parseColor(bgColor) : { r: 0, g: 0, b: 0, a: 1 };
  return toHex(composite(fg, bg));
}

function lighten(color, amount) {
  const c = parseColor(typeof color === "string" ? `#${color}` : color);
  return toHex({
    r: Math.round(c.r + (255 - c.r) * amount),
    g: Math.round(c.g + (255 - c.g) * amount),
    b: Math.round(c.b + (255 - c.b) * amount),
    a: 1,
  });
}

function darken(color, amount) {
  const c = parseColor(typeof color === "string" ? `#${color}` : color);
  return toHex({
    r: Math.round(c.r * (1 - amount)),
    g: Math.round(c.g * (1 - amount)),
    b: Math.round(c.b * (1 - amount)),
    a: 1,
  });
}

function alphaOver(color, alpha, bgColor) {
  const c = parseColor(typeof color === "string" && color.startsWith("#") ? color : `#${color}`);
  const bg = parseColor(typeof bgColor === "string" && bgColor.startsWith("#") ? bgColor : `#${bgColor}`);
  return toHex(composite({ ...c, a: alpha }, bg));
}

// ---------------------------------------------------------------------------
// Palette
//
// Spicetify color.ini expects: opaque 6-digit hex, no leading '#', no alpha.
// All values here are computed by compositing the theme's alpha-bearing
// tokens onto a derived dark base (so glass themes get a sensible flat
// background) and emitting uppercase hex.
// ---------------------------------------------------------------------------

const bgParsed = parseColor(theme.layout.cardBg);
const isGlass = bgParsed.a < 1;

// Hue-preserving dark base for glass themes (matches Warp + Obsidian
// codegens). For opaque themes, the theme's own cardBg IS the bg.
const bgBase = isGlass
  ? {
      r: Math.round(bgParsed.r * 0.4),
      g: Math.round(bgParsed.g * 0.4),
      b: Math.round(bgParsed.b * 0.4),
      a: 1,
    }
  : { r: 6, g: 8, b: 28, a: 1 };

const bg = isGlass ? toHex(composite(bgParsed, bgBase)) : toHex(bgParsed);
const bgElevated = lighten(bg, 0.06);
const bgHigh = lighten(bg, 0.12);
const bgDeep = darken(bg, 0.2);
const shadowHex = darken(bg, 0.45);

const fg = flatten(theme.accents.status.text, `#${bg}`);
const fgMuted = flatten(theme.accents.status.smallMuted, `#${bg}`);

const accent = flatten(theme.menuBarTint, `#${bg}`);
const accentBright = lighten(accent, 0.15);

const danger = flatten(theme.status.bad, `#${bg}`);

// 18-slot color.ini map. Comments describe the surface; keep ASCII only.
const colors = {
  text: fg,
  subtext: fgMuted,
  main: bg,
  "main-elevated": bgElevated,
  highlight: alphaOver(fg, 0.08, `#${bg}`),
  "highlight-elevated": alphaOver(fg, 0.12, `#${bg}`),
  sidebar: bgDeep,
  player: bg,
  card: bgElevated,
  shadow: shadowHex,
  "selected-row": fgMuted,
  button: accent,
  "button-active": accentBright,
  "button-disabled": alphaOver(fg, 0.3, `#${bg}`),
  "tab-active": bgHigh,
  notification: accent,
  "notification-error": danger,
  misc: fgMuted,
};

// ---------------------------------------------------------------------------
// color.ini body (ASCII-only header per the spicetify-flat-theme skill --
// prior attempt's em-dashes triggered "No section found" errors from
// Spicetify's INI parser).
// ---------------------------------------------------------------------------

const ini =
  `; AUTO-GENERATED by scripts/build-spicetify-theme.mjs\n` +
  `; Source of truth: src/themes/_active.ts -> src/themes/${themeName}.ts\n` +
  `; DO NOT EDIT -- regenerated on every \`npm run build\`.\n` +
  `; Flat color-only theme; no user.css glass treatment. See skill\n` +
  `; spicetify-flat-theme for the rationale (glass not viable on macOS\n` +
  `; without asar-patching Spotify, which we have declined to do).\n` +
  `\n` +
  `[base]\n` +
  Object.entries(colors)
    .map(([k, v]) => `${k.padEnd(20)} = ${v}`)
    .join("\n") +
  `\n`;

// Minimal user.css. Spicetify expects the file to exist alongside color.ini.
// We deliberately do NOT inject custom selectors -- the flat-only contract is
// that we own colors, Spotify owns layout.
const userCss =
  `/* AUTO-GENERATED by scripts/build-spicetify-theme.mjs */\n` +
  `/* Flat color-only theme: this file is intentionally empty.        */\n` +
  `/* All theming happens via color.ini. See skill spicetify-flat-theme. */\n`;

// ---------------------------------------------------------------------------
// Spicetify install detection
// ---------------------------------------------------------------------------

const spicetifyConfigDir = join(homedir(), ".config", "spicetify");
const configIniPath = join(spicetifyConfigDir, "config-xpui.ini");

if (!existsSync(spicetifyConfigDir) || !existsSync(configIniPath)) {
  console.log(`(No Spicetify config at ${spicetifyConfigDir} -- Spicetify probably isn't installed. Skipping.)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Write theme dir
// ---------------------------------------------------------------------------

const THEME_NAME = "uber-theme";
const themeDir = join(spicetifyConfigDir, "Themes", THEME_NAME);
await mkdir(themeDir, { recursive: true });

const iniPath = join(themeDir, "color.ini");
const userCssPath = join(themeDir, "user.css");

let iniChanged = false;
let cssChanged = false;

try {
  const existing = await readFile(iniPath, "utf8");
  if (existing !== ini) iniChanged = true;
} catch {
  iniChanged = true;
}
if (iniChanged) await writeFile(iniPath, ini, "utf8");

try {
  const existing = await readFile(userCssPath, "utf8");
  if (existing !== userCss) cssChanged = true;
} catch {
  cssChanged = true;
}
if (cssChanged) await writeFile(userCssPath, userCss, "utf8");

// ---------------------------------------------------------------------------
// Patch config-xpui.ini in place. Preserve every other field; only flip
// current_theme + color_scheme. Leaves [Backup] alone (Spicetify owns it).
// ---------------------------------------------------------------------------

const configText = await readFile(configIniPath, "utf8");

let newConfigText = configText;
let configChanged = false;

function patchKey(text, key, desiredValue) {
  // Match: `<key><h-spaces>=<h-spaces><oldValue>` on its own line. Two
  // pitfalls in this seemingly-simple regex:
  //   1. [ \t]* not \s* after `=`. \s includes \n, so an empty value
  //      (`key = \n`) would eat the trailing newline and [^\n]* would
  //      then capture the NEXT line as the value, mangling the file.
  //   2. Capture stops AT `=`, not after trailing horizontal whitespace.
  //      We then explicitly emit ` ` before the new value, so the result
  //      always has exactly one space between `=` and value regardless of
  //      the original spacing (Spicetify accepts both `=val` and `= val`
  //      but the canonical form is `= val`).
  const re = new RegExp(`(^|\\n)(${key}[ \\t]*=)[ \\t]*([^\\n]*)`);
  const m = text.match(re);
  if (!m) {
    // Key absent: nothing safe to do here -- Spicetify always seeds these
    // two keys on init, so absence implies a malformed config. Bail loudly.
    throw new Error(`config-xpui.ini missing expected key '${key}'. Refusing to patch.`);
  }
  const current = m[3].trim();
  if (current === desiredValue) return { text, changed: false };
  const replaced = text.replace(re, (_full, lead, prefix) => `${lead}${prefix} ${desiredValue}`);
  return { text: replaced, changed: true };
}

let r = patchKey(newConfigText, "current_theme", THEME_NAME);
newConfigText = r.text;
configChanged = configChanged || r.changed;

r = patchKey(newConfigText, "color_scheme", "base");
newConfigText = r.text;
configChanged = configChanged || r.changed;

if (configChanged) {
  await writeFile(configIniPath, newConfigText, "utf8");
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const touched = [
  iniChanged && "color.ini",
  cssChanged && "user.css",
  configChanged && "config-xpui.ini",
]
  .filter(Boolean)
  .join(" + ");

if (!touched) {
  console.log(`(Spicetify theme up-to-date -- skipping write. Theme: ${themeName}.)`);
} else {
  console.log(
    `Generated Spicetify uber-theme (${touched})  theme: ${themeName}, bg: #${bg}, accent: #${accent}\n` +
      `  -> ${themeDir}\n` +
      `  Apply with: close Spotify, then \`spicetify apply\` (we do not auto-apply).`,
  );
}
