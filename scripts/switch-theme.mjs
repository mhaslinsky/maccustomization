/**
 * Theme switcher CLI.
 *
 *   node scripts/switch-theme.mjs              # list themes + show current
 *   node scripts/switch-theme.mjs <name>       # switch to <name> and rebuild
 *
 * Also wired up as `npm run theme` in package.json.
 *
 * Mechanism: rewrites src/themes/_active.ts to re-export from the chosen
 * theme module, then shells out to `npm run build` so every consumer
 * (widgets, Hammerspoon, JankyBorders) picks up the change in one pass.
 *
 * Theme discovery: every .ts file in src/themes/ whose name doesn't start
 * with `_` is a theme. `_types.ts` and `_active.ts` are ignored.
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const themeDir = join(root, "src", "themes");
const activeFile = join(themeDir, "_active.ts");

async function listThemes() {
  const entries = await readdir(themeDir);
  return entries
    .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
    .map((f) => f.replace(/\.ts$/, ""))
    .sort();
}

async function readActive() {
  const src = await readFile(activeFile, "utf8");
  const m = src.match(/export \* from "\.\/(\w[\w-]*)\.js";/);
  return m ? m[1] : null;
}

function writeActive(name) {
  const contents = `// Active theme pointer. Rewritten by \`npm run theme <name>\`.
// Every other consumer (widget_theme.ts, the hammerspoon codegen, and the
// borders codegen) reads the look through this file, so flipping one line
// here changes the look everywhere on the next \`npm run build\`.
export * from "./${name}.js";
`;
  return writeFile(activeFile, contents, "utf8");
}

const [, , requested] = process.argv;
const available = await listThemes();
const current = await readActive();

if (!requested) {
  console.log(`Current theme: ${current ?? "(unknown)"}`);
  console.log("");
  console.log("Available themes:");
  for (const name of available) {
    const marker = name === current ? "  *" : "   ";
    console.log(`${marker} ${name}`);
  }
  console.log("");
  console.log("Switch with:  npm run theme <name>");
  process.exit(0);
}

if (!available.includes(requested)) {
  console.error(`Error: theme "${requested}" not found in src/themes/.`);
  console.error(`Available: ${available.join(", ")}`);
  process.exit(1);
}

if (requested === current) {
  console.log(`Already on "${requested}" — rebuilding anyway.`);
} else {
  await writeActive(requested);
  console.log(`Switched active theme: ${current} → ${requested}`);
}

// Chain into the full build so widgets + Hammerspoon + borders refresh
// in one go. Inherit stdio so build output is visible.
const result = spawnSync("npm", ["run", "build"], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 0);
