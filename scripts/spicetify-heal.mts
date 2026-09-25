#!/usr/bin/env node
// Keep Spicetify applied across Spotify auto-updates.
//
// Usage: spicetify-heal.mts [check|heal|install|uninstall]
// `check` (default) reports and exits non-zero when Spotify is unpatched.
// `heal` repairs it; `install` registers a LaunchAgent that runs `heal` whenever
// Spotify.app changes and every few minutes as a fallback.
//
// A Spotify update replaces Apps/xpui.spa with a stock copy, so the patch and
// every extension vanish until `spicetify backup apply` runs again. Updates to
// Spotify also tend to outrun the installed Spicetify, so healing upgrades the
// CLI first. Everything `apply` injects (theme, extensions, custom apps) must
// live on disk under ~/.config/spicetify: Marketplace's install ledger sits in
// ~/Library/Caches and is wiped by updates, so it cannot be restored.

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SPOTIFY_APP = "/Applications/Spotify.app";
const INFO_PLIST = join(SPOTIFY_APP, "Contents", "Info.plist");
const APPS_DIR = join(SPOTIFY_APP, "Contents", "Resources", "Apps");
const SPICETIFY = join(homedir(), ".spicetify", "spicetify");
const SPICETIFY_CONFIG = join(homedir(), ".config", "spicetify", "config-xpui.ini");
const SPICETIFY_THEMES = join(homedir(), ".config", "spicetify", "Themes");

const AGENT_LABEL = "com.mhaslinsky.spicetify-heal";
const AGENT_PLIST = join(homedir(), "Library", "LaunchAgents", `${AGENT_LABEL}.plist`);
const LOG_PATH = join(homedir(), "Library", "Logs", "spicetify-heal.log");
const STATE_DIR = join(homedir(), ".local", "state", "spicetify-heal");
// Homebrew's node, not the nvm one running `npm`: nvm paths change on every upgrade.
const AGENT_NODE = "/opt/homebrew/bin/node";

const FALLBACK_INTERVAL_SECONDS = 300;
// The updater rewrites the bundle in stages; patching mid-write backs up a torn copy.
const SETTLE_SECONDS = 90;
const FAILURE_BACKOFF_SECONDS = 6 * 60 * 60;

export type AppsState = "stock" | "mixed" | "applied" | "invalid";

export interface Snapshot {
  appsState: AppsState;
  spotifyVersion: string;
  backupVersion: string;
  backupCliVersion: string;
  cliVersion: string;
}

export type Action =
  | { kind: "healthy" }
  | { kind: "backup-apply"; reason: string }
  | { kind: "restore-backup-apply"; reason: string }
  | { kind: "broken"; reason: string };

// Mirrors spicetify's own status/spotify package: loose .spa archives mean stock
// files, extracted directories mean patched ones.
export function classifyApps(entries: { name: string; isDirectory: boolean }[]): AppsState {
  const archiveCount = entries.filter((entry) => !entry.isDirectory && entry.name.endsWith(".spa")).length;
  const directoryCount = entries.filter((entry) => entry.isDirectory).length;
  if (archiveCount > 0 && directoryCount > 0) return "mixed";
  if (archiveCount > 0) return "stock";
  if (directoryCount > 0) return "applied";
  return "invalid";
}

// The branches follow spicetify's CheckStates and Apply guards (src/cmd/apply.go,
// v2.45.1), so each action is the command spicetify itself would ask for.
export function decide(snapshot: Snapshot): Action {
  if (snapshot.appsState === "invalid") {
    return { kind: "broken", reason: "Spotify's Apps folder is empty; reinstall Spotify" };
  }
  if (snapshot.appsState === "stock" || snapshot.appsState === "mixed") {
    return {
      kind: "backup-apply",
      reason: `Spotify ${snapshot.spotifyVersion} is unpatched (backup is from ${snapshot.backupVersion || "nothing"})`,
    };
  }
  if (!snapshot.backupVersion) {
    return { kind: "broken", reason: "Spotify is patched but no backup is recorded; reinstall Spotify" };
  }
  // The backup records the full build ("1.3.0.277.g1a2b3c"); Info.plist has no hash suffix.
  if (!snapshot.backupVersion.startsWith(snapshot.spotifyVersion)) {
    return {
      kind: "broken",
      reason: `patched files come from Spotify ${snapshot.backupVersion}, installed is ${snapshot.spotifyVersion}; reinstall Spotify`,
    };
  }
  if (snapshot.backupCliVersion !== snapshot.cliVersion) {
    return {
      kind: "restore-backup-apply",
      reason: `patch was made by spicetify ${snapshot.backupCliVersion}, installed is ${snapshot.cliVersion}`,
    };
  }
  return { kind: "healthy" };
}

export function parseIni(text: string): Map<string, string> {
  const values = new Map<string, string>();
  let section = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    values.set(`${section}.${line.slice(0, separator).trim()}`, line.slice(separator + 1).trim());
  }
  return values;
}

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

function notify(message: string): void {
  const script = `display notification ${JSON.stringify(message)} with title "Spicetify"`;
  spawnSync("/usr/bin/osascript", ["-e", script], { stdio: "ignore" });
}

function readSnapshot(): Snapshot {
  const entries = readdirSync(APPS_DIR, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));
  const config = parseIni(readFileSync(SPICETIFY_CONFIG, "utf8"));
  return {
    appsState: classifyApps(entries),
    spotifyVersion: execFileSync("/usr/bin/plutil", ["-extract", "CFBundleShortVersionString", "raw", INFO_PLIST], {
      encoding: "utf8",
    }).trim(),
    backupVersion: config.get("Backup.version") ?? "",
    backupCliVersion: config.get("Backup.with") ?? "",
    cliVersion: execFileSync(SPICETIFY, ["-v"], { encoding: "utf8" }).trim(),
  };
}

function spotifyPid(): number | null {
  const result = spawnSync("/usr/bin/pgrep", ["-x", "Spotify"], { encoding: "utf8" });
  const firstPid = Number.parseInt(result.stdout.trim().split("\n")[0] ?? "", 10);
  return Number.isNaN(firstPid) ? null : firstPid;
}

// coreaudiod holds an audio-out sleep assertion "Created for PID" of whichever
// app is playing, which answers "is Spotify playing" without an Automation prompt.
function isPlaying(pid: number): boolean {
  const assertions = execFileSync("/usr/bin/pmset", ["-g", "assertions"], { encoding: "utf8" });
  return assertions.includes(`Created for PID: ${pid}.`);
}

function secondsSinceBundleChange(): number {
  const newest = Math.max(statSync(INFO_PLIST).mtimeMs, statSync(APPS_DIR).mtimeMs);
  return (Date.now() - newest) / 1000;
}

function runSpicetify(args: string[]): void {
  log(`running: spicetify ${args.join(" ")}`);
  const result = spawnSync(SPICETIFY, args, { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (output) console.log(output);
  if (result.status !== 0) {
    throw new Error(`spicetify ${args.join(" ")} exited ${result.status}`);
  }
}

// A theme folder missing at apply time makes spicetify skip the theme without
// failing, so the result looks like a healed Spotify with no theme.
function configProblems(): string[] {
  const config = parseIni(readFileSync(SPICETIFY_CONFIG, "utf8"));
  const problems: string[] = [];
  const theme = config.get("Setting.current_theme") ?? "";
  if (theme === "marketplace") {
    problems.push("current_theme is 'marketplace', whose install ledger does not survive Spotify updates");
  } else if (theme && !existsSync(join(SPICETIFY_THEMES, theme))) {
    problems.push(`current_theme '${theme}' has no folder under ${SPICETIFY_THEMES}`);
  }
  return problems;
}

function injectedExtensionsMissing(): string[] {
  const config = parseIni(readFileSync(SPICETIFY_CONFIG, "utf8"));
  const extensions = (config.get("AdditionalOptions.extensions") ?? "").split("|").filter(Boolean);
  const indexPath = join(APPS_DIR, "xpui", "index.html");
  const indexHtml = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
  return extensions.filter((extension) => !indexHtml.includes(`src='extensions/${extension}'`));
}

function check(): number {
  const snapshot = readSnapshot();
  const action = decide(snapshot);
  console.log(`Spotify ${snapshot.spotifyVersion}, apps ${snapshot.appsState}`);
  console.log(`backup ${snapshot.backupVersion || "(none)"} made with spicetify ${snapshot.backupCliVersion || "(none)"}`);
  console.log(`spicetify ${snapshot.cliVersion}`);
  const missing = action.kind === "healthy" ? injectedExtensionsMissing() : [];
  const problems = [...configProblems(), ...missing.map((extension) => `extension ${extension} is not injected`)];
  for (const problem of problems) console.log(`warning: ${problem}`);
  console.log(action.kind === "healthy" ? "healthy" : `${action.kind}: ${action.reason}`);
  console.log(`agent ${existsSync(AGENT_PLIST) ? "installed" : "NOT installed"} (${AGENT_PLIST})`);
  return action.kind === "healthy" && missing.length === 0 ? 0 : 1;
}

// Remembers which Spotify version a deferral was announced for, so a long
// listening session produces one notification rather than one per interval.
function notifyOncePerVersion(spotifyVersion: string, message: string): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const markerPath = join(STATE_DIR, "deferral-notified");
  const previous = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : "";
  if (previous === spotifyVersion) return;
  writeFileSync(markerPath, spotifyVersion);
  notify(message);
}

const FAILURE_MARKER = join(STATE_DIR, "last-failure");

// A failed heal restarts Spotify, so the scheduled agent must not retry it every
// interval. Backoff is per Spotify version: an update gets a fresh attempt.
function inFailureBackoff(spotifyVersion: string): boolean {
  if (!existsSync(FAILURE_MARKER)) return false;
  const failedVersion = readFileSync(FAILURE_MARKER, "utf8").trim();
  const ageSeconds = (Date.now() - statSync(FAILURE_MARKER).mtimeMs) / 1000;
  return failedVersion === spotifyVersion && ageSeconds < FAILURE_BACKOFF_SECONDS;
}

function recordFailure(spotifyVersion: string, message: string): number {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(FAILURE_MARKER, spotifyVersion);
  log(message);
  notify(`${message}. See ${LOG_PATH}`);
  return 1;
}

function heal(scheduled: boolean): number {
  let snapshot = readSnapshot();
  let action = decide(snapshot);
  if (action.kind === "healthy") {
    if (existsSync(FAILURE_MARKER)) unlinkSync(FAILURE_MARKER);
    return 0;
  }

  if (scheduled && inFailureBackoff(snapshot.spotifyVersion)) {
    log(`skipped: the last heal for Spotify ${snapshot.spotifyVersion} failed; retrying after the backoff or on the next update`);
    return 1;
  }

  if (action.kind === "broken") {
    return recordFailure(snapshot.spotifyVersion, `Cannot re-apply: ${action.reason}`);
  }

  const settledFor = secondsSinceBundleChange();
  if (settledFor < SETTLE_SECONDS) {
    log(`deferred: Spotify.app changed ${Math.round(settledFor)}s ago, waiting for the update to settle`);
    return 0;
  }

  const pid = spotifyPid();
  if (pid !== null && isPlaying(pid)) {
    log(`deferred: ${action.reason}, but Spotify is playing`);
    notifyOncePerVersion(snapshot.spotifyVersion, "Spotify updated. Theme and extensions come back when playback stops.");
    return 0;
  }

  log(`healing: ${action.reason}`);
  try {
    // A Spotify update usually needs a newer Spicetify. Upgrade failure is not
    // fatal: the installed version may still support this build.
    try {
      runSpicetify(["-q", "upgrade"]);
    } catch (error) {
      log(`upgrade failed, continuing with the installed version: ${(error as Error).message}`);
    }

    snapshot = readSnapshot();
    action = decide(snapshot);
    const restartFlag = pid === null ? ["-n"] : [];
    if (action.kind === "backup-apply") {
      runSpicetify(["-q", ...restartFlag, "backup", "apply"]);
    } else if (action.kind === "restore-backup-apply") {
      runSpicetify(["-q", ...restartFlag, "restore", "backup", "apply"]);
    }

    const after = decide(readSnapshot());
    const missing = injectedExtensionsMissing();
    if (after.kind !== "healthy" || missing.length > 0) {
      const detail = after.kind === "healthy" ? `extensions not injected: ${missing.join(", ")}` : after.reason;
      throw new Error(`still unhealthy after apply: ${detail}`);
    }
  } catch (error) {
    return recordFailure(snapshot.spotifyVersion, `Re-apply failed: ${(error as Error).message}`);
  }

  log(`healed: Spotify ${snapshot.spotifyVersion} patched with spicetify ${snapshot.cliVersion}`);
  notify(`Re-applied to Spotify ${snapshot.spotifyVersion}.`);
  return 0;
}

function agentPlist(scriptPath: string): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(AGENT_NODE)}</string>
    <string>${escape(scriptPath)}</string>
    <string>heal</string>
    <string>--scheduled</string>
  </array>
  <key>WatchPaths</key>
  <array>
    <string>${escape(INFO_PLIST)}</string>
    <string>${escape(APPS_DIR)}</string>
  </array>
  <key>StartInterval</key><integer>${FALLBACK_INTERVAL_SECONDS}</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${escape(LOG_PATH)}</string>
  <key>StandardErrorPath</key><string>${escape(LOG_PATH)}</string>
</dict>
</plist>
`;
}

function launchctl(args: string[]): number {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
  return result.status ?? 1;
}

function install(): number {
  if (!existsSync(AGENT_NODE)) {
    console.error(`${AGENT_NODE} is missing; the agent would fail on every run. brew install node first.`);
    return 1;
  }
  const scriptPath = fileURLToPath(import.meta.url);
  if (scriptPath.includes("/.claude/worktrees/")) {
    console.error(`refusing to install from a worktree (${scriptPath}); run from the primary checkout`);
    return 1;
  }
  const domain = `gui/${process.getuid?.()}`;
  launchctl(["bootout", `${domain}/${AGENT_LABEL}`]);
  writeFileSync(AGENT_PLIST, agentPlist(scriptPath));
  if (launchctl(["bootstrap", domain, AGENT_PLIST]) !== 0) {
    console.error(`launchctl bootstrap failed for ${AGENT_PLIST}`);
    return 1;
  }
  console.log(`installed ${AGENT_PLIST} -> ${scriptPath}; log at ${LOG_PATH}`);
  return 0;
}

function uninstall(): number {
  launchctl(["bootout", `gui/${process.getuid?.()}/${AGENT_LABEL}`]);
  if (existsSync(AGENT_PLIST)) unlinkSync(AGENT_PLIST);
  console.log(`removed ${AGENT_LABEL}`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const commands: Record<string, () => number> = {
    check,
    heal: () => heal(process.argv.includes("--scheduled")),
    install,
    uninstall,
  };
  const commandName = process.argv[2] ?? "check";
  const command = commands[commandName];
  if (!command) {
    console.error(`usage: spicetify-heal.mts [${Object.keys(commands).join("|")}]`);
    process.exit(2);
  }
  process.exit(command());
}
