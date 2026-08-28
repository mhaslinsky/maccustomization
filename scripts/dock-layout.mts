#!/usr/bin/env node
// Sweep every open window into the workspace layout that matches the current
// dock state, and keep every window floating. Bound to alt-shift-d.
//
// Usage: dock-layout.mts [docked|undocked|auto] [--dry-run]   (default: auto)

import { execFileSync } from "node:child_process";

const AEROSPACE = "/opt/homebrew/bin/aerospace";

const FALLBACK_WORKSPACE = "1";

// Bundle id -> workspace, per dock state. Use a Map instead of a plain object
// because bundle ids are external keys and "__proto__" would silently vanish
// from an object literal.
const UNDOCKED_LAYOUT = new Map<string, string>([
  ["app.zen-browser.zen", "3"],
  ["com.mitchellh.ghostty", "2"],
]);

// The workspaces the undocked layout moves apps to. Docked, those moves are
// undone and the window returns to FALLBACK_WORKSPACE, while a window on any
// other workspace belongs to a second monitor and is left alone.
const UNDOCKED_PARK_WORKSPACES = new Set(UNDOCKED_LAYOUT.values());

// AeroSpace reports a hidden app's window with this layout. It cannot be floated
// or moved until the app is unhidden, so the sweep leaves it alone.
const HIDDEN_APP_LAYOUT = "macos_native_window_of_hidden_app";

type DockState = "docked" | "undocked";

function aerospace(args: string[]): string {
  return execFileSync(AEROSPACE, args, { encoding: "utf8" });
}

// The hotkey path runs this through exec-and-forget, where stdout and stderr go
// nowhere, so a failure has to reach the user some other way.
function notifyFailure(message: string): void {
  try {
    execFileSync("/usr/bin/osascript", [
      "-e",
      `display notification ${JSON.stringify(message)} with title "dock-layout failed"`,
    ]);
  } catch {
    // A failed notification must not mask the failure it was reporting.
  }
}

function readMonitorCount(): number {
  const count = Number(aerospace(["list-monitors", "--count"]).trim());
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`aerospace reported an unusable monitor count: ${count}`);
  }
  return count;
}

function resolveDockState(requested: string): DockState {
  if (requested === "docked" || requested === "undocked") return requested;
  if (requested !== "auto") {
    throw new Error(`unknown mode "${requested}"; expected docked, undocked or auto`);
  }
  return readMonitorCount() > 1 ? "docked" : "undocked";
}

interface OpenWindow {
  windowId: string;
  layout: string;
  workspace: string;
  bundleId: string;
  appName: string;
}

function readOpenWindows(): OpenWindow[] {
  const raw = aerospace([
    "list-windows",
    "--all",
    "--format",
    "%{window-id}\t%{window-layout}\t%{workspace}\t%{app-bundle-id}\t%{app-name}",
  ]);
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [windowId, layout, workspace, bundleId, appName] = line.split("\t");
      return { windowId, layout, workspace, bundleId, appName };
    });
}

// null means "leave this window's workspace alone", which is distinct from
// "send it to the fallback workspace".
// Redocking reverses the undocked split. Left in place, Ghostty and Zen stay on
// separate workspaces pinned to the same monitor, where only one of the two can
// be visible at a time.
function targetWorkspaceFor(
  bundleId: string,
  currentWorkspace: string,
  dockState: DockState,
): string | null {
  if (dockState === "undocked") {
    return UNDOCKED_LAYOUT.get(bundleId) ?? FALLBACK_WORKSPACE;
  }
  return UNDOCKED_PARK_WORKSPACES.has(currentWorkspace) ? FALLBACK_WORKSPACE : null;
}

// Re-read placement from AeroSpace instead of trusting move command exit codes,
// catching moves that falsely report success.
function findMisplaced(expected: Map<string, string | null>): string[] {
  const raw = aerospace([
    "list-windows",
    "--all",
    "--format",
    "%{window-id}\t%{workspace}\t%{window-layout}",
  ]);
  const actual = new Map<string, { workspace: string; layout: string }>();
  for (const line of raw.split("\n")) {
    const [windowId, workspace, layout] = line.trim().split("\t");
    if (windowId) actual.set(windowId, { workspace, layout });
  }

  const problems: string[] = [];
  for (const [windowId, wantedWorkspace] of expected) {
    const landed = actual.get(windowId);
    if (!landed) {
      problems.push(`window ${windowId}: vanished from AeroSpace's window list`);
      continue;
    }
    if (wantedWorkspace !== null && landed.workspace !== wantedWorkspace) {
      problems.push(`window ${windowId}: wanted workspace ${wantedWorkspace}, found ${landed.workspace}`);
    }
    if (landed.layout !== "floating") {
      problems.push(`window ${windowId}: still ${landed.layout}, expected floating`);
    }
  }
  return problems;
}

function main(): void {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const mode = args.find((arg) => !arg.startsWith("--")) ?? "auto";
  const dockState = resolveDockState(mode);

  const openWindows = readOpenWindows();
  const sweepable = openWindows.filter((window) => window.layout !== HIDDEN_APP_LAYOUT);
  const skipped = openWindows.length - sweepable.length;

  // Finding zero windows means the sweep did nothing, which must be reported as
  // an error rather than a clean exit.
  if (sweepable.length === 0) {
    console.error("dock-layout: AeroSpace reported no sweepable windows; nothing was swept.");
    process.exit(1);
  }

  if (isDryRun) {
    console.log(`dock-layout: ${dockState} (dry run), ${sweepable.length} window(s), ${skipped} skipped.`);
    for (const window of sweepable) {
      const workspace = targetWorkspaceFor(window.bundleId, window.workspace, dockState);
      const floatNote = window.layout === "floating" ? "" : ` [${window.layout} -> floating]`;
      const placement = workspace === null ? `stays on workspace ${window.workspace}` : `-> workspace ${workspace}`;
      console.log(`  ${window.appName} ${placement}${floatNote}`);
    }
    return;
  }

  const expected = new Map<string, string | null>();
  const failures: string[] = [];

  for (const window of sweepable) {
    const workspace = targetWorkspaceFor(window.bundleId, window.workspace, dockState);
    expected.set(window.windowId, workspace);
    try {
      // Skipping the no-op keeps aerospace's "Already in the requested floating
      // mode" chatter off stderr, so real errors stay visible.
      if (window.layout !== "floating") {
        aerospace(["layout", "floating", "--window-id", window.windowId]);
      }
      if (workspace !== null && workspace !== window.workspace) {
        aerospace(["move-node-to-workspace", "--window-id", window.windowId, workspace]);
      }
    } catch (error) {
      failures.push(`${window.appName} (${window.windowId}): ${String(error).split("\n")[0]}`);
    }
  }

  const misplaced = findMisplaced(expected);

  console.log(`dock-layout: ${dockState}, ${sweepable.length} window(s) swept, ${skipped} skipped.`);
  for (const failure of failures) console.error(`  command failed: ${failure}`);
  for (const problem of misplaced) console.error(`  ${problem}`);

  if (failures.length > 0 || misplaced.length > 0) {
    const summary = `${failures.length} command error(s), ${misplaced.length} window(s) misplaced.`;
    console.error(`dock-layout: ${summary}`);
    notifyFailure(summary);
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  const reason = error instanceof Error ? error.message.split("\n")[0] : String(error);
  console.error(`dock-layout: ${reason}`);
  notifyFailure(reason);
  process.exit(1);
}
