/**
 * Build script for Übersicht widgets.
 *
 * Strategy: transpile only (no bundling).
 *   - src/widget_*.ts(x)   → src/widget_*.js          (stays in src/, invisible to Übersicht as a widget)
 *   - src/themes/*.ts      → src/themes/*.js          (imported transitively by widget_theme)
 *   - src/Widget.tsx       → Widget.jsx               (root level, visible to Übersicht)
 *
 * Convention: files in src/ prefixed with "widget_" are shared modules (transpiled
 * to src/). All other .tsx files are widgets (transpiled to root as .jsx).
 * `src/themes/` is a sibling module graph — each theme file is a standalone
 * set of look tokens, wired up through `src/themes/_active.ts`.
 *
 * Übersicht's own Browserify + Babelify pipeline then resolves the import of
 * ./src/widget_* and bundles everything for the WebView. This keeps the
 * root .jsx files small and Babel-friendly.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// Discover files in src/ (flat — themes/ is handled separately below).
const srcFiles = await readdir(join(root, "src"));
const sharedModules = srcFiles.filter(
  (f) => f.startsWith("widget_") && (f.endsWith(".ts") || f.endsWith(".tsx"))
);
const widgetSources = srcFiles.filter(
  (f) => f.endsWith(".tsx") && !f.startsWith("widget_")
);

// Discover theme files in src/themes/. Every .ts file (including _active.ts
// and _types.ts) is transpiled so Übersicht's Browserify can resolve the
// full import chain at runtime.
const themeDir = join(root, "src", "themes");
const themeFiles = (await readdir(themeDir)).filter((f) => f.endsWith(".ts"));

// Remove any leftover standalone shared module files at repo root
// (Übersicht would load them as widgets).
for (const mod of sharedModules) {
  const base = mod.replace(/\.tsx?$/, "");
  await rm(join(root, `${base}.jsx`), { force: true });
  await rm(join(root, `${base}.js`), { force: true });
}

const sharedOpts = {
  format: "esm",
  platform: "browser",
  jsx: "preserve",
  target: ["es2018"],
  legalComments: "none",
};

// 1. Transpile shared modules into src/ so Übersicht's Browserify can resolve them.
await esbuild.build({
  ...sharedOpts,
  entryPoints: sharedModules.map((f) => join(root, "src", f)),
  bundle: false,
  outdir: join(root, "src"),
});

// 1b. Transpile theme files into src/themes/. Type-only files (_types.ts) emit
// near-empty .js modules and that's fine — they just never get imported at
// runtime. _active.ts is the only one that has a runtime re-export.
await esbuild.build({
  ...sharedOpts,
  entryPoints: themeFiles.map((f) => join(themeDir, f)),
  bundle: false,
  outdir: themeDir,
});

// 2. Transpile each widget file to the repo root (no bundling — imports stay intact).
await esbuild.build({
  ...sharedOpts,
  entryPoints: widgetSources.map((f) => join(root, "src", f)),
  bundle: false,
  outdir: root,
  outExtension: { ".js": ".jsx" },
});

// 3. Fix import paths and export style for root .jsx files.
//    Source files use "./widget_*" (relative to src/). The transpiled files now
//    live at the repo root, so paths must become "./src/widget_*.js".
//    Also rewrite the trailing `export { … }` block to `export const` declarations
//    so Übersicht's Browserify / Babelify picks up widget exports correctly.
function patchWidget(code) {
  let out = code.replace(
    /from "\.\/(widget_\w+)(?:\.js)?"/g,
    'from "./src/$1.js"'
  );

  // Collect names inside `export { a, b, c };` and remove the block.
  const exportNames = new Set();
  out = out.replace(/\nexport \{([^}]+)\};?\s*$/m, (_, inner) => {
    for (const n of inner.split(",")) exportNames.add(n.trim());
    return "\n";
  });

  // Promote matching `const` / `var` / `function` / arrow declarations to `export const`.
  for (const name of exportNames) {
    if (!name) continue;
    out = out.replace(
      new RegExp(`^(var|const) (${name}\\b)`, "m"),
      "export const $2"
    );
  }

  return out;
}

// Validate that patched widgets contain the required Übersicht exports.
const requiredExports = [
  "export const command",
  "export const refreshFrequency",
  "export const className",
  "export const render",
];

function validateWidget(code, name) {
  const missing = requiredExports.filter((exp) => !code.includes(exp));
  if (missing.length > 0) {
    throw new Error(`${name}: missing required exports: ${missing.join(", ")}`);
  }
}

// Resolve the active theme name and compute a content digest of every
// shared module the widgets transitively depend on (src/widget_*.js plus
// every transpiled theme file). The active theme + digest gets stamped
// into each root .jsx file as a leading comment.
//
// Übersicht's Browserify pipeline caches widget bundles per root .jsx
// file and only invalidates when that file's content changes. The root
// files are otherwise byte-identical across theme switches (theme data
// flows in transitively via widget_theme.js → themes/_active.js →
// <theme>.js, never inlined) AND across source-only edits to widget_theme
// or shared helpers. Without this marker Übersicht keeps serving the stale
// bundle until something physically changes the root .jsx content.
//
// Stamping both the active theme name (for readability / git diffs when
// switching) and a hash of the imported module graph (so code changes to
// the shared modules also bust the cache) gives us a stable, content-based
// invalidation key with zero per-build noise when nothing changed.
let activeTheme = "unknown";
try {
  const activeSrc = await readFile(
    join(root, "src", "themes", "_active.ts"),
    "utf8"
  );
  const m = activeSrc.match(/export \* from "\.\/(\w[\w-]*)\.js";/);
  if (m) activeTheme = m[1];
} catch {
  // _active.ts missing — fall through with "unknown" (first build edge case).
}

// Hash every transpiled shared module and theme file. Node ships crypto
// so no dep. Short 8-char digest keeps the marker compact.
const { createHash } = await import("node:crypto");
const digestInputs = [
  ...sharedModules.map((f) => join(root, "src", f.replace(/\.tsx?$/, ".js"))),
  ...themeFiles.map((f) => join(themeDir, f.replace(/\.ts$/, ".js"))),
];
const hash = createHash("sha256");
for (const p of digestInputs) {
  try {
    hash.update(await readFile(p));
  } catch {
    // File may not exist on a fresh build that hasn't transpiled yet;
    // skip. The next pass will catch it.
  }
}
const moduleDigest = hash.digest("hex").slice(0, 8);

const widgetOutputs = widgetSources.map((f) => f.replace(/\.tsx$/, ".jsx"));
for (const name of widgetOutputs) {
  const p = join(root, name);
  const raw = await readFile(p, "utf8");
  const patched = patchWidget(raw);
  validateWidget(patched, name);
  const stamped = `// active-theme: ${activeTheme} (${moduleDigest})\n${patched}`;
  await writeFile(p, stamped, "utf8");
}

// Build summary
const sharedNames = sharedModules.map((f) => f.replace(/\.tsx?$/, ".js"));
const themeNames = themeFiles.map((f) => f.replace(/\.ts$/, ".js"));
console.log(
  `Built ${widgetOutputs.length} widget(s): ${widgetOutputs.join(", ")}`
);
console.log(`Shared modules: ${sharedNames.join(", ")}`);
console.log(`Themes: ${themeNames.join(", ")}`);
