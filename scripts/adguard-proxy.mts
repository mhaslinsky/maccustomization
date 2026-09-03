#!/usr/bin/env node
// Reprovision the AdGuard CLI HTTPS-filtering proxy: the MITM bypass list, the
// macOS network proxy wiring, and a check that the expected filter lists are on.
//
// Usage: adguard-proxy.mts [check|apply] [--dry-run] [--service <name>]
// `check` is the default and only reads; `apply` is the one that writes.
//
// Scope: this script owns the ~20 lines of the AdGuard setup that encode a
// decision. It never reads or writes the CA store under SSL/, the license, or
// the filter databases. Key material, a credential, and 83 MB of regenerable
// vendor data have no place in a repo or in a provisioning run.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ADGUARD_CLI = "/opt/homebrew/bin/adguard-cli";
const NETWORKSETUP = "/usr/sbin/networksetup";

const CONFIG_DIR = join(homedir(), "Library", "Application Support", "adguard-cli");
const EXCLUSIONS_PATH = join(CONFIG_DIR, "https_exclusions.txt");

const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = "3129";
const DEFAULT_NETWORK_SERVICE = "Wi-Fi";

// Domains AdGuard must tunnel rather than re-sign. Every one of these is
// reached by a client that pins certificates or ships its own CA bundle, so
// interception breaks the connection outright instead of degrading it.
interface ExclusionGroup {
  rationale: string;
  domains: string[];
}

const EXCLUSION_GROUPS: ExclusionGroup[] = [
  {
    rationale:
      "codex-lb upstream; Docker forwards the system proxy and the container does not trust the AdGuard CA",
    domains: ["chatgpt.com", "api.openai.com"],
  },
  {
    rationale:
      "AI provider APIs called from tooling whose CA bundles do not trust AdGuard interception",
    domains: [
      "api.anthropic.com",
      "generativelanguage.googleapis.com",
      "openrouter.ai",
      "api.parallel.ai",
      "api.neuralwatt.com",
      "bedrock-runtime.us-east-1.amazonaws.com",
      "aws-mcp.us-east-1.api.aws",
    ],
  },
  {
    rationale: "developer infrastructure APIs and artifact hosts used by local tooling",
    domains: [
      "api.cloudflare.com",
      "github.com",
      "api.github.com",
      "raw.githubusercontent.com",
      "pypi.org",
      "api.wisprflow.ai",
    ],
  },
];

const BLOCK_START = "# >>> mac-customization managed exclusions >>>";
const BLOCK_END = "# <<< mac-customization managed exclusions <<<";

// One-time migration. These three headers were hand-written into the file on
// 2026-09-02, before this script existed, alongside loose copies of the domains
// above. `apply` folds that state into the managed block, which means dropping
// the orphaned headers by exact text. AdGuard's own shipped list contains no
// comment or blank lines at all, so there is nothing else here to preserve.
const LEGACY_HEADER_COMMENTS = new Set([
  "# codex-lb upstream (Docker forwards the system proxy; the container does not trust the AdGuard CA)",
  "# Developer AI APIs used from containers whose CA bundles do not trust AdGuard HTTPS interception",
  "# Developer infrastructure APIs and artifact hosts used by local tooling",
]);

// Hosts and ranges that must never go through the proxy. Loopback and the
// RFC1918 ranges cover local dev servers and the LAN; the proxy itself listens
// on loopback, so routing loopback through it would be a cycle.
const BYPASS_ENTRIES = [
  "*.local",
  "169.254/16",
  "localhost",
  "127.0.0.1",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
];

// Filter lists expected to be enabled, by AdGuard's own numeric id.
const EXPECTED_FILTER_IDS = new Map<number, string>([
  [2, "AdGuard Base filter"],
  [11, "AdGuard Mobile Ads filter"],
  [3, "AdGuard Tracking Protection filter"],
  [208, "Online Malicious URL Blocklist"],
]);

type Mode = "check" | "apply";

interface Options {
  mode: Mode;
  dryRun: boolean;
  networkService: string;
}

function managedDomains(): string[] {
  return EXCLUSION_GROUPS.flatMap((group) => group.domains);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    mode: "check",
    dryRun: false,
    networkService: DEFAULT_NETWORK_SERVICE,
  };
  for (let position = 0; position < argv.length; position += 1) {
    const argument = argv[position];
    if (argument === "check" || argument === "apply") {
      options.mode = argument;
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--service") {
      const value = argv[position + 1];
      if (!value) throw new Error("--service needs a network service name");
      options.networkService = value;
      position += 1;
    } else {
      throw new Error(`unknown argument "${argument}"`);
    }
  }
  return options;
}

function run(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: "utf8" });
}

// AdGuard renders its tables with ANSI bold, which would otherwise end up
// inside the parsed field values.
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function buildManagedBlock(): string[] {
  const lines = [BLOCK_START];
  for (const group of EXCLUSION_GROUPS) {
    lines.push(`# ${group.rationale}`);
    lines.push(...group.domains);
  }
  lines.push(BLOCK_END);
  return lines;
}

// Rebuild the file as "everything AdGuard shipped, then our block", dropping
// existing copies of a managed domain wherever they sit. That folds in the
// hand-edited state without duplicating entries.
function composeExclusions(currentText: string): string[] {
  const managed = new Set(managedDomains());
  const kept: string[] = [];
  let insideManagedBlock = false;

  for (const rawLine of currentText.split("\n")) {
    const line = rawLine.trim();
    if (line === BLOCK_START) {
      insideManagedBlock = true;
      continue;
    }
    if (line === BLOCK_END) {
      insideManagedBlock = false;
      continue;
    }
    if (insideManagedBlock) continue;
    if (line === "") continue;
    if (LEGACY_HEADER_COMMENTS.has(line)) continue;
    if (managed.has(line)) continue;
    kept.push(line);
  }

  return [...kept, ...buildManagedBlock()];
}

// A managed domain sitting outside the block is either the pre-script hand-edit
// (expected once, before a block exists) or a line AdGuard has started shipping
// itself (never seen, and not ours to delete).
function findUnmanagedCopies(currentText: string): string[] {
  const managed = new Set(managedDomains());
  const found: string[] = [];
  let insideManagedBlock = false;

  for (const rawLine of currentText.split("\n")) {
    const line = rawLine.trim();
    if (line === BLOCK_START) insideManagedBlock = true;
    else if (line === BLOCK_END) insideManagedBlock = false;
    else if (!insideManagedBlock && managed.has(line)) found.push(line);
  }
  return found;
}

function readProxySetting(networkService: string, flag: string): Map<string, string> {
  const output = run(NETWORKSETUP, [flag, networkService]);
  const settings = new Map<string, string>();
  for (const line of output.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    settings.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  return settings;
}

function proxyDrift(networkService: string): string[] {
  const drift: string[] = [];

  const secure = readProxySetting(networkService, "-getsecurewebproxy");
  if (secure.get("Enabled") !== "Yes") drift.push("HTTPS proxy is disabled");
  if (secure.get("Server") !== PROXY_HOST) {
    drift.push(`HTTPS proxy server is ${secure.get("Server")}, expected ${PROXY_HOST}`);
  }
  if (secure.get("Port") !== PROXY_PORT) {
    drift.push(`HTTPS proxy port is ${secure.get("Port")}, expected ${PROXY_PORT}`);
  }

  // Must stay off; applyProxy carries the reason.
  const plain = readProxySetting(networkService, "-getwebproxy");
  if (plain.get("Enabled") !== "No") drift.push("HTTP proxy is enabled, expected disabled");

  const currentBypass = run(NETWORKSETUP, ["-getproxybypassdomains", networkService])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const entry of BYPASS_ENTRIES) {
    if (!currentBypass.includes(entry)) drift.push(`bypass list is missing ${entry}`);
  }
  return drift;
}

function filterDrift(): string[] {
  const output = stripAnsi(run(ADGUARD_CLI, ["filters", "list"]));
  const enabled = new Set<number>();
  for (const line of output.split("\n")) {
    // Rows look like: "[x] |    2 | AdGuard Base filter    2026-09-02 16:14:22"
    const match = line.match(/^\[(.)\]\s*\|\s*(\d+)\s*\|/);
    if (match && match[1] === "x") enabled.add(Number(match[2]));
  }
  const drift: string[] = [];
  for (const [filterId, title] of EXPECTED_FILTER_IDS) {
    if (!enabled.has(filterId)) drift.push(`filter ${filterId} (${title}) is not enabled`);
  }
  return drift;
}

function exclusionDrift(currentText: string): string[] {
  const desired = composeExclusions(currentText).join("\n") + "\n";
  if (desired === currentText) return [];

  const currentLines = new Set(currentText.split("\n").map((line) => line.trim()));
  const missing = managedDomains().filter((domain) => !currentLines.has(domain));
  if (missing.length > 0) {
    return [`exclusions missing ${missing.length} managed domain(s): ${missing.join(", ")}`];
  }
  return [
    "exclusions hold every managed domain but not in the managed block; apply will fold them in",
  ];
}

function applyExclusions(currentText: string, dryRun: boolean): boolean {
  const desired = composeExclusions(currentText).join("\n") + "\n";
  if (desired === currentText) {
    console.log("exclusions: already in sync");
    return false;
  }
  if (dryRun) {
    console.log("exclusions: would rewrite (dry run)");
    return true;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "").replace("T", "-").slice(0, 15);
  const backup = `${EXCLUSIONS_PATH}.bak-${stamp}`;
  copyFileSync(EXCLUSIONS_PATH, backup);
  writeFileSync(EXCLUSIONS_PATH, desired, "utf8");
  console.log(`exclusions: rewritten (backup at ${backup})`);
  return true;
}

// Only the HTTPS proxy is wired. A client reading the system proxy straight
// from SCDynamicStore ignores the bypass list below, so enabling the plain-HTTP
// proxy routes the codex-lb loopback bridge through AdGuard, hitting its 502 page.
function applyProxy(networkService: string, dryRun: boolean): void {
  const commands: string[][] = [
    ["-setwebproxystate", networkService, "off"],
    ["-setsecurewebproxy", networkService, PROXY_HOST, PROXY_PORT],
    ["-setproxybypassdomains", networkService, ...BYPASS_ENTRIES],
  ];
  for (const args of commands) {
    if (dryRun) {
      console.log(`proxy: would run networksetup ${args[0]} ${networkService} ...`);
      continue;
    }
    run(NETWORKSETUP, args);
  }
  if (!dryRun) {
    console.log(`proxy: ${networkService} HTTPS pointed at ${PROXY_HOST}:${PROXY_PORT}, HTTP off`);
  }
}

function main(): number {
  const options = parseArgs(process.argv.slice(2));

  // A missing install must not read as a clean check.
  if (!existsSync(ADGUARD_CLI)) {
    console.error(`cannot check: adguard-cli not found at ${ADGUARD_CLI}`);
    return 2;
  }
  if (!existsSync(EXCLUSIONS_PATH)) {
    console.error(`cannot check: exclusions file not found at ${EXCLUSIONS_PATH}`);
    return 2;
  }

  const currentText = readFileSync(EXCLUSIONS_PATH, "utf8");

  const unmanagedCopies = findUnmanagedCopies(currentText);
  const awaitingFirstMigration = !currentText.includes(BLOCK_START);
  if (unmanagedCopies.length > 0 && !awaitingFirstMigration) {
    console.error(
      `refusing to touch exclusions: ${unmanagedCopies.length} managed domain(s) also sit outside the ` +
        `managed block (${unmanagedCopies.join(", ")}). AdGuard may now ship them by default, and folding ` +
        `them in would delete a vendor line.`,
    );
    return 2;
  }

  if (options.mode === "check") {
    const drift = [
      ...exclusionDrift(currentText),
      ...proxyDrift(options.networkService),
      ...filterDrift(),
    ];
    if (drift.length === 0) {
      console.log("in sync: exclusions, proxy wiring and filter lists all match");
      return 0;
    }
    for (const item of drift) console.log(`DRIFT: ${item}`);
    console.log(`\n${drift.length} difference(s). Run \`npm run adguard:apply\` to reconcile.`);
    return 1;
  }

  const exclusionsChanged = applyExclusions(currentText, options.dryRun);
  applyProxy(options.networkService, options.dryRun);

  for (const item of filterDrift()) {
    console.log(`NOTE: ${item} (enable with \`adguard-cli filters enable <id>\`)`);
  }

  if (exclusionsChanged && !options.dryRun) {
    // Deliberately not restarting. AdGuard reloads exclusions on restart, but a
    // restart drops the proxy path out from under anything already using it,
    // and has twice knocked the codex-lb container offline mid-session.
    console.log("\nExclusion changes need `adguard-cli restart` to take effect.");
    console.log("Restart deliberately, when no long-running client is mid-request.");
  }
  return 0;
}

try {
  process.exit(main());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
