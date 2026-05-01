/**
 * One-shot patcher: injects a CSS-loader stub into Slack's renderer preload.
 *
 *   sudo -E node scripts/patch-slack-app.mjs            — apply the patch
 *   sudo -E node scripts/patch-slack-app.mjs --restore  — restore from backup
 *   node scripts/patch-slack-app.mjs --status           — report current patch state (no root needed)
 *
 * (No `npm run patch:*` wrappers — `npm run` strips the TTY so sudo can't
 *  prompt for your password. The patcher's `requireRoot()` guard prints the
 *  correct invocation if you forget the `sudo`.)
 *
 * What it does:
 *   1. Regenerates ~/.config/slack-uber-theme/theme.css from the active theme
 *      via `npm run build:slack-css`, run as the invoking user (so the file
 *      is owned by you, not root). One-command theme-change cycle: edit
 *      theme tokens → sudo -E node scripts/patch-slack-app.mjs.
 *   2. Locates the arch-specific app asar (app-arm64.asar on Apple Silicon).
 *   3. Extracts to a temp dir. Reads ~/.config/slack-uber-theme/theme.css and
 *      prepends a loader to dist/preload.bundle.js that injects the CSS as a
 *      <style> tag on DOMContentLoaded. The CSS is inlined into the loader at
 *      patch time, NOT read at runtime — Slack runs the renderer sandboxed
 *      (sandbox:true + contextIsolation:true) so the preload has no fs access.
 *   3. Repacks the asar to a temp file.
 *   4. Backs up the current asar AND Info.plist to <asar>.uber-backup and
 *      Info.plist.uber-backup. Both go in the bundle so --restore is symmetric.
 *   5. Replaces the asar with the repacked copy.
 *   6. Updates Info.plist's `ElectronAsarIntegrity` hash via PlistBuddy. Slack
 *      runs Electron's asar integrity check — Info.plist holds a SHA256 of the
 *      asar's JSON header, and Electron crashes the renderer on a mismatch.
 *      Skipping this step is what crashed Slack on the first patch attempt.
 *   7. Re-signs Slack.app with an ad-hoc signature so the codesign seal covers
 *      the modified Info.plist + asar. Helpers under Frameworks/ are reached
 *      via --deep; entitlements are dropped (ad-hoc has no entitlements at
 *      all) but Slack still launches without them in this configuration.
 *
 * Caveats — read README.md or .claude/skills/slack-theme/SKILL.md before
 * running:
 *   - Slack auto-updates ship a fresh signed asar, blowing away the patch.
 *     Re-run after every Slack update. There's no auto-detection — you find
 *     out when Slack relaunches looking unthemed.
 *   - Admin privileges required. Invoke as:
 *
 *       sudo -E node scripts/patch-slack-app.mjs
 *
 *     The whole script runs as root so writes to Slack.app and the codesign
 *     re-sign work without nested sudo. -E preserves your environment so
 *     `npx @electron/asar` finds your node_modules cache.
 *
 *     We tried `osascript do shell script ... with administrator privileges`
 *     first — it elevates to root but TCC attributes the action to osascript
 *     (which doesn't have App Management permission) and macOS blocks the
 *     write with "Operation not permitted" even with valid backups in place.
 *     Direct sudo from a terminal does have App Management implicitly because
 *     the calling process (your shell) is the responsible one TCC checks.
 *   - This is unsupported by Slack. Risk of breakage is on you. The
 *     --restore command undoes everything cleanly.
 */

import { execSync } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir, homedir } from "node:os";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const args = process.argv.slice(2);
const RESTORE = args.includes("--restore");
const STATUS = args.includes("--status");

const ARCH = process.arch === "arm64" ? "arm64" : "x64";
const PRELOAD_REL = "dist/preload.bundle.js";
const MARKER = "/* slack-uber-theme:v2 */";
// v1 loader read CSS via require('fs') at runtime — broken under Slack's
// sandboxed renderer. v2 inlines the CSS at patch time. If we see a v1
// marker on the asar, the patch path auto-restores from backup before
// re-patching with the v2 loader.
const MARKER_V1 = "/* slack-uber-theme:v1 */";
const CSS_PATH_REL = ".config/slack-uber-theme/theme.css";
const INTEGRITY_KEY = `:ElectronAsarIntegrity:Resources/app-${ARCH}.asar:hash`;

// Locate Slack.app. ~/Applications/ is preferred — macOS's App Management
// protection (Sonoma+) only guards /Applications/*.app, so bundles installed
// to the user's Applications folder can be patched without TCC permission
// dances. Fall back to /Applications/Slack.app and warn if found there.
const USER_SLACK = `${homedir()}/Applications/Slack.app`;
const SYSTEM_SLACK = "/Applications/Slack.app";
const SLACK_APP = existsSync(USER_SLACK) ? USER_SLACK : SYSTEM_SLACK;
const SLACK_IN_PROTECTED_DIR = SLACK_APP === SYSTEM_SLACK;
const RESOURCES = `${SLACK_APP}/Contents/Resources`;
const INFO_PLIST = `${SLACK_APP}/Contents/Info.plist`;
const INFO_PLIST_BACKUP = `${INFO_PLIST}.uber-backup`;
const ASAR = `${RESOURCES}/app-${ARCH}.asar`;
const BACKUP = `${ASAR}.uber-backup`;

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

if (!existsSync(SLACK_APP)) {
  console.error(`Slack.app not found at ${USER_SLACK} or ${SYSTEM_SLACK}. Aborting.`);
  process.exit(1);
}
if (!existsSync(ASAR)) {
  console.error(`Expected asar not found: ${ASAR}. Slack layout may have changed.`);
  process.exit(1);
}

console.log(`Slack.app: ${SLACK_APP}${SLACK_IN_PROTECTED_DIR ? " (in /Applications — App Management protected)" : ""}`);

// ---------------------------------------------------------------------------
// Root-required guard. The whole script must run as root so writes to
// Slack.app and the codesign step go through directly — nested sudo (or
// osascript-to-root) hits TCC App Management restrictions because the
// "responsible process" the kernel checks isn't the user's shell.
// ---------------------------------------------------------------------------

const isRoot = process.getuid && process.getuid() === 0;

function requireRoot(operation) {
  if (isRoot) return;
  console.error("");
  console.error(`✗ "${operation}" requires root.`);
  console.error("");
  console.error("  Re-run as:");
  console.error("");
  console.error("    sudo -E node scripts/patch-slack-app.mjs" +
    process.argv.slice(2).map((a) => ` ${a}`).join(""));
  console.error("");
  console.error(
    "  -E preserves your environment so `npx @electron/asar` finds your"
  );
  console.error(
    "  node_modules cache. macOS will prompt for your password once."
  );
  console.error("");
  process.exit(1);
}

function runPrivileged(shellCmd, label) {
  if (label) console.log(`(${label})`);
  execSync(shellCmd, { stdio: "inherit" });
}

// Electron's asar-integrity hash (Info.plist `ElectronAsarIntegrity`) is
// SHA256 of the asar's JSON header string, NOT of the whole asar file.
// Asar layout: 8 bytes pickle wrapper + 4 bytes pickle-2 size + 4 bytes
// JSON length + JSON bytes (then padded + file payloads). The JSON length
// lives at offset 12 LE, JSON itself starts at offset 16.
function computeAsarHeaderHash(asarPath) {
  const buf = readFileSync(asarPath);
  const headerSize = buf.readUInt32LE(12);
  const json = buf.slice(16, 16 + headerSize);
  return createHash("sha256").update(json).digest("hex");
}

// Regenerate ~/.config/slack-uber-theme/theme.css from the active theme.
// We run this as part of the patch flow so a single command covers the
// full theme-change cycle (edit theme → re-patch). Important: the build
// must run as the *invoking* user, not root — running `npm run build:
// slack-css` as root would create the CSS file owned by root:wheel and
// break the user's normal `npm run build:slack-css` invocation later.
function regenerateThemeCSS() {
  const sudoUser = process.env.SUDO_USER;
  // If invoked directly as root (no SUDO_USER), skip — we don't know who
  // to drop to. Patch will fail later with "CSS not found" if the file
  // genuinely doesn't exist; if it does exist, we proceed with the stale
  // copy.
  if (!sudoUser) {
    console.log(
      "(skipping CSS regen — no SUDO_USER set; using existing theme.css)"
    );
    return;
  }
  console.log(`Regenerating theme CSS (as ${sudoUser})...`);
  execSync(`sudo -u "${sudoUser}" -E npm run --silent build:slack-css`, {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}

function readInfoPlistHash() {
  try {
    return execSync(
      `/usr/libexec/PlistBuddy -c "Print ${INTEGRITY_KEY}" "${INFO_PLIST}"`,
      { stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Status: report whether currently patched
// ---------------------------------------------------------------------------

async function readPreloadFromAsar() {
  const work = await mkdtemp(join(tmpdir(), "slack-patch-read-"));
  try {
    execSync(`npx --yes @electron/asar extract "${ASAR}" "${work}"`, {
      stdio: "pipe",
    });
    return await readFile(join(work, PRELOAD_REL), "utf8");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function detectPatchVersion() {
  const preload = await readPreloadFromAsar();
  if (preload.includes(MARKER)) return "current";
  if (preload.includes(MARKER_V1)) return "v1";
  return null;
}

async function isPatched() {
  return (await detectPatchVersion()) === "current";
}

if (STATUS) {
  const patched = await isPatched();
  const backupExists = existsSync(BACKUP);
  const plistBackupExists = existsSync(INFO_PLIST_BACKUP);
  const asarHeaderHash = computeAsarHeaderHash(ASAR);
  const plistHash = readInfoPlistHash();
  const integrityOk = plistHash && plistHash === asarHeaderHash;
  console.log(`Slack.app    : ${SLACK_APP}`);
  console.log(`Asar         : ${ASAR}`);
  console.log(`Asar backup  : ${backupExists ? BACKUP : "(none)"}`);
  console.log(`Plist backup : ${plistBackupExists ? INFO_PLIST_BACKUP : "(none)"}`);
  console.log(`Patched      : ${patched ? "yes" : "no"}`);
  console.log(`Header hash  : ${asarHeaderHash}`);
  console.log(`Plist hash   : ${plistHash ?? "(missing)"}`);
  console.log(`Integrity    : ${integrityOk ? "ok" : "MISMATCH (renderer will crash on launch)"}`);
  console.log(`CSS file     : ~/${CSS_PATH_REL}`);
  console.log(
    `CSS exists   : ${existsSync(join(homedir(), CSS_PATH_REL)) ? "yes" : "no — run `npm run build:slack-css`"}`
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Restore: copy backup over current asar, re-sign, exit
// ---------------------------------------------------------------------------

if (RESTORE) {
  if (!existsSync(BACKUP)) {
    console.error(`No backup found at ${BACKUP}. Nothing to restore.`);
    process.exit(1);
  }
  requireRoot("restore");
  // Restore Info.plist too if we have a backup of it — patch updates the
  // ElectronAsarIntegrity hash to match the new asar, so a partial restore
  // (asar only) leaves Info.plist pointing at a hash that no longer matches
  // and crashes the renderer on next launch.
  const plistPart = existsSync(INFO_PLIST_BACKUP)
    ? ` && cp "${INFO_PLIST_BACKUP}" "${INFO_PLIST}"`
    : "";
  console.log(
    `Restoring ${ASAR} from ${BACKUP}${plistPart ? " (and Info.plist)" : ""} and re-signing ${SLACK_APP}...`
  );
  runPrivileged(
    `cp "${BACKUP}" "${ASAR}"${plistPart} && codesign --force --deep --sign - "${SLACK_APP}"`,
    "restore + re-sign"
  );
  console.log("Done. Reopen Slack to confirm.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Patch: extract, prepend loader to preload, repack, replace, re-sign
// ---------------------------------------------------------------------------

const existingPatch = await detectPatchVersion();
if (existingPatch === "current") {
  console.log("Slack is already patched (current version). Nothing to do.");
  console.log("(If theme tweaks didn't apply, regenerate CSS + re-patch:");
  console.log("   npm run build:slack-css && sudo -E node scripts/patch-slack-app.mjs --restore && sudo -E node scripts/patch-slack-app.mjs)");
  process.exit(0);
}

requireRoot("patch");

// Regenerate theme.css from the active theme before reading it. This is
// what makes `sudo -E node scripts/patch-slack-app.mjs` a one-command
// re-theme cycle — without this, theme tweaks need a separate
// `npm run build:slack-css` step.
regenerateThemeCSS();

// Auto-restore from backup if we detect a stale v1 patch. v1 had a
// runtime fs.readFile that fails silently under Slack's sandboxed
// renderer; baking the v2 loader on top of v1 would leave dead code in
// the asar. Restore puts pristine bytes back so we patch from a clean
// baseline.
if (existingPatch === "v1") {
  if (!existsSync(BACKUP)) {
    console.error(
      `Stale v1 patch detected but no backup at ${BACKUP}. ` +
      `Reinstall Slack from https://slack.com/downloads/mac and re-run.`
    );
    process.exit(1);
  }
  console.log("Stale v1 patch detected — restoring from backup before re-patching.");
  const v1PlistPart = existsSync(INFO_PLIST_BACKUP)
    ? ` && cp "${INFO_PLIST_BACKUP}" "${INFO_PLIST}"`
    : "";
  runPrivileged(
    `cp "${BACKUP}" "${ASAR}"${v1PlistPart}`,
    "auto-restore (no re-sign yet — patch path will re-sign at the end)"
  );
}

// All non-privileged work first (extract, patch, repack to a temp file).
// Final cp/mv/codesign run as root since we're already in a root process.

const work = await mkdtemp(join(tmpdir(), "slack-patch-"));
console.log(`Extracting asar to ${work}...`);
execSync(`npx --yes @electron/asar extract "${ASAR}" "${work}"`, {
  stdio: "inherit",
});

const preloadPath = join(work, PRELOAD_REL);
if (!existsSync(preloadPath)) {
  console.error(
    `Expected preload not found: ${preloadPath}. Slack layout may have changed; aborting before any privileged writes.`
  );
  await rm(work, { recursive: true, force: true });
  process.exit(1);
}

const original = await readFile(preloadPath, "utf8");

// Read the themed CSS at patch time and inline it into the loader as a
// string literal. We can't read it at runtime: Slack's renderer runs with
// sandbox:true + contextIsolation:true, and sandboxed preload scripts have
// no `require('fs')`. DOM access still works (sandbox doesn't restrict the
// document), so injecting a <style> from a baked-in CSS string is fine.
//
// Cost: theme changes require re-running this patcher to re-inline the CSS.
// We already need a re-patch after every Slack auto-update, so the workflow
// is the same.
const cssAbsPath = join(homedir(), CSS_PATH_REL);
if (!existsSync(cssAbsPath)) {
  console.error(
    `Themed CSS not found at ${cssAbsPath}. Run \`npm run build:slack-css\` first.`
  );
  await rm(work, { recursive: true, force: true });
  process.exit(1);
}
const cssContents = await readFile(cssAbsPath, "utf8");
console.log(`Inlining ${cssContents.length}b of CSS from ${cssAbsPath}...`);

// JSON.stringify gives us a JS string literal with all required escapes
// (backslashes, quotes, control chars, line terminators).
const loader = `${MARKER}
(function () {
  try {
    var css = ${JSON.stringify(cssContents)};
    var inject = function () {
      try {
        if (typeof document === 'undefined') return;
        if (document.getElementById('slack-uber-theme')) return;
        var style = document.createElement('style');
        style.id = 'slack-uber-theme';
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      } catch (_) {}
    };
    if (typeof document !== 'undefined' && document.readyState !== 'loading') {
      inject();
    } else if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', inject);
    }
  } catch (_) {}
})();
`;

console.log(`Patching ${PRELOAD_REL} (prepending ${loader.length}b loader)...`);
await writeFile(preloadPath, loader + original, "utf8");

const newAsar = join(tmpdir(), `app-${ARCH}.asar.new`);
console.log(`Repacking → ${newAsar}...`);
execSync(`npx --yes @electron/asar pack "${work}" "${newAsar}"`, {
  stdio: "inherit",
});

// Compute the new asar's header hash. Slack ships with Electron's asar
// integrity check enabled — Info.plist has a SHA256 of the asar's JSON
// header under ElectronAsarIntegrity, and Electron crashes the renderer
// on a mismatch. We must update that hash to match the repacked asar
// before the bundle re-signs.
const newHash = computeAsarHeaderHash(newAsar);
const oldPlistHash = readInfoPlistHash();
console.log(`Old header hash : ${oldPlistHash ?? "(missing)"}`);
console.log(`New header hash : ${newHash}`);

// Already root — do the privileged work directly. Order:
//   1. Back up the current asar AND Info.plist (so --restore is symmetric).
//   2. Move new asar in place.
//   3. Update Info.plist's integrity hash via PlistBuddy.
//   4. Re-sign Slack.app — Info.plist is part of the codesign seal, so
//      this MUST run after the plist edit.
runPrivileged(
  [
    `cp "${ASAR}" "${BACKUP}"`,
    `cp "${INFO_PLIST}" "${INFO_PLIST_BACKUP}"`,
    `mv "${newAsar}" "${ASAR}"`,
    `/usr/libexec/PlistBuddy -c 'Set ${INTEGRITY_KEY} ${newHash}' "${INFO_PLIST}"`,
    `codesign --force --deep --sign - "${SLACK_APP}"`,
  ].join(" && "),
  "backup asar+plist, swap asar, update integrity hash, re-sign"
);

await rm(work, { recursive: true, force: true });

console.log("");
console.log("Done. Next steps:");
console.log("  1. Fully quit Slack (Cmd-Q), then reopen.");
console.log("  2. To revert at any time: sudo -E node scripts/patch-slack-app.mjs --restore");
console.log("");
console.log("After every Slack auto-update you'll need to re-run this command —");
console.log("auto-updates ship a fresh signed asar that wipes the patch.");
