/**
 * End-to-end round-trip check: deployed Warp YAML for the active theme
 * matches the theme source's controls values (with codegen defaults filled
 * in for unset fields). Catches codegen regressions where YAML emission
 * silently changes meaning — the kind of bug a value-only validator can't
 * see.
 *
 * Manual invocation: `npm run verify`. Not in the build chain (no point
 * verifying what was just written).
 *
 * Defaults are duplicated here from build-warp-theme.mjs and
 * generate-warp-bg.mjs. If those drift, this verify fails loudly — that's
 * the point.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, access } from "node:fs/promises";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const themesDir = join(root, "src", "themes");
const activeSrc = join(themesDir, "_active.ts");
const warpThemesDir = join(homedir(), ".warp", "themes");

// Defaults — keep in sync with scripts/build-warp-theme.mjs and
// scripts/generate-warp-bg.mjs.
const DEFAULTS = {
  bgImageOpacity: 20,
  noiseAlphaMax: 140,
  noiseDarkProb: 0.5,
};

// ---------------------------------------------------------------------------
// Resolve active theme
// ---------------------------------------------------------------------------
const activeText = await readFile(activeSrc, "utf8");
const nameMatch = activeText.match(/from\s+["'].\/([^"']+?)(?:\.js)?["']/);
if (!nameMatch) {
  console.error("verify: could not parse active theme name from src/themes/_active.ts");
  process.exit(1);
}
const themeName = nameMatch[1];

// ---------------------------------------------------------------------------
// Bundle + import the active theme
// ---------------------------------------------------------------------------
const result = await esbuild.build({
  entryPoints: [join(themesDir, `${themeName}.ts`)],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2022",
  logLevel: "silent",
});
const dataUrl =
  "data:text/javascript;base64," +
  Buffer.from(result.outputFiles[0].text).toString("base64");
const theme = await import(dataUrl);

// ---------------------------------------------------------------------------
// Glass-theme gate (mirrors build-warp-theme.mjs:141)
// ---------------------------------------------------------------------------
const cardBgAlpha = parseAlpha(theme.layout?.cardBg);
if (!(cardBgAlpha < 1)) {
  console.log(
    `verify: '${themeName}' is opaque (cardBg alpha=${cardBgAlpha}), no background_image to check. OK.`
  );
  process.exit(0);
}

function parseAlpha(color) {
  if (!color) return 1;
  const rgba = color.match(/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgba && rgba[1] != null) return parseFloat(rgba[1]);
  return 1; // hex / no alpha = opaque
}

// ---------------------------------------------------------------------------
// Read deployed YAML + JPEG, compare against theme.controls.warp
// ---------------------------------------------------------------------------
const yamlPath = join(warpThemesDir, `uber-${themeName}.yaml`);
const jpgPath = join(warpThemesDir, `uber-${themeName}.jpg`);

let yamlText;
try {
  yamlText = await readFile(yamlPath, "utf8");
} catch (e) {
  console.error(`verify: cannot read ${yamlPath} — run 'npm run build:warp' first.`);
  process.exit(1);
}

try {
  await access(jpgPath);
} catch {
  console.error(`verify: JPEG missing at ${jpgPath} — glass theme requires it.`);
  process.exit(1);
}

const wc = theme.controls?.warp ?? {};
const expected = {
  bgImageOpacity: wc.bgImageOpacity ?? DEFAULTS.bgImageOpacity,
  noiseAlphaMax: wc.noiseAlphaMax ?? DEFAULTS.noiseAlphaMax,
  noiseDarkProb: wc.noiseDarkProb ?? DEFAULTS.noiseDarkProb,
};

const failures = [];

// background_image.opacity line
const opacityMatch = yamlText.match(/background_image:\s*\n\s*path:[^\n]+\n\s*opacity:\s*(\S+)/);
if (!opacityMatch) {
  failures.push("background_image.opacity not found in YAML");
} else {
  const got = parseFloat(opacityMatch[1]);
  if (got !== expected.bgImageOpacity) {
    failures.push(`bgImageOpacity mismatch: yaml=${got} expected=${expected.bgImageOpacity}`);
  }
}

// fingerprint comment
const fpMatch = yamlText.match(/^# bg-image:.*$/m);
if (!fpMatch) {
  failures.push("bg-image fingerprint comment not found in YAML");
} else {
  const fp = fpMatch[0];
  const aMatch = fp.match(/noiseAlphaMax=(\S+)/);
  const dMatch = fp.match(/noiseDarkProb=(\S+)/);
  if (!aMatch || parseFloat(aMatch[1]) !== expected.noiseAlphaMax) {
    failures.push(
      `noiseAlphaMax mismatch: fingerprint=${aMatch?.[1] ?? "<missing>"} expected=${expected.noiseAlphaMax}`
    );
  }
  if (!dMatch || parseFloat(dMatch[1]) !== expected.noiseDarkProb) {
    failures.push(
      `noiseDarkProb mismatch: fingerprint=${dMatch?.[1] ?? "<missing>"} expected=${expected.noiseDarkProb}`
    );
  }
}

if (failures.length === 0) {
  console.log(
    `verify: OK — '${themeName}' YAML matches theme controls (opacity=${expected.bgImageOpacity}, noiseAlphaMax=${expected.noiseAlphaMax}, noiseDarkProb=${expected.noiseDarkProb}).`
  );
  process.exit(0);
}

console.error(`\nverify: ${failures.length} mismatch(es) for '${themeName}'\n`);
for (const f of failures) console.error(`  ${f}`);
console.error(`\n  YAML: ${yamlPath}`);
console.error(`  Re-run 'npm run build:warp' to regenerate.\n`);
process.exit(1);
