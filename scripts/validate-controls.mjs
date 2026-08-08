/**
 * Build-time validator: walks JSDoc `@min @max @step` tags in
 * src/themes/_types.ts via the TypeScript Compiler API, builds a schema map
 * keyed by property path, then loads every theme under src/themes/ and
 * range-checks each value at every tagged path.
 *
 * Runs between build:widgets and downstream codegens. Untagged numeric
 * fields are silently skipped — tagging a field is opt-in.
 *
 * Collects all violations and reports at end. Exit 1 on any violation.
 */

import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { readFile, readdir } from "node:fs/promises";
import ts from "typescript";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const themesDir = join(root, "src", "themes");
const typesPath = join(themesDir, "_types.ts");

// ---------------------------------------------------------------------------
// Parse _types.ts → schema map: "path.to.field" → { min, max, step }
// ---------------------------------------------------------------------------
const typesText = await readFile(typesPath, "utf8");
const sf = ts.createSourceFile(typesPath, typesText, ts.ScriptTarget.Latest, true);

// Map: type-alias name → array of { fieldName, typeRef, tags }
const typeMembers = new Map();
sf.forEachChild((node) => {
  if (!ts.isTypeAliasDeclaration(node)) return;
  if (!ts.isTypeLiteralNode(node.type)) return;
  const members = [];
  for (const member of node.type.members) {
    if (!ts.isPropertySignature(member) || !member.name) continue;
    members.push({
      fieldName: member.name.getText(sf),
      typeRef: extractTypeRef(member.type),
      tags: ts.getJSDocTags(member),
    });
  }
  typeMembers.set(node.name.text, members);
});

function extractTypeRef(typeNode) {
  if (!typeNode) return null;
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    return typeNode.typeName.text;
  }
  return null;
}

function readTagText(tag) {
  if (typeof tag.comment === "string") return tag.comment.trim();
  if (Array.isArray(tag.comment)) {
    return tag.comment.map((c) => c.text || "").join("").trim();
  }
  return "";
}

const schema = new Map();
const visited = new Set();
function walk(typeName, pathPrefix) {
  if (visited.has(typeName)) return;
  visited.add(typeName);
  const members = typeMembers.get(typeName);
  if (!members) return;
  for (const { fieldName, typeRef, tags } of members) {
    const path = pathPrefix ? `${pathPrefix}.${fieldName}` : fieldName;
    let min, max, step;
    for (const tag of tags) {
      const tn = tag.tagName?.text;
      const v = readTagText(tag);
      if (tn === "min") min = parseFloat(v);
      else if (tn === "max") max = parseFloat(v);
      else if (tn === "step") step = parseFloat(v);
    }
    if (min !== undefined && max !== undefined) {
      schema.set(path, { min, max, step: Number.isFinite(step) ? step : null });
    }
    if (typeRef && typeMembers.has(typeRef)) walk(typeRef, path);
  }
  visited.delete(typeName);
}
walk("Theme", "");

if (schema.size === 0) {
  console.log("validate-controls: no tagged fields in _types.ts. Nothing to validate.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Bundle + import each theme, walk schema paths, collect violations
// ---------------------------------------------------------------------------
const themeFiles = (await readdir(themesDir))
  .filter((f) => f.endsWith(".ts") && !f.startsWith("_"))
  .sort();

const violations = [];
const warnings = [];

for (const file of themeFiles) {
  const themeName = basename(file, ".ts");
  const result = await esbuild.build({
    entryPoints: [join(themesDir, file)],
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

  for (const [path, spec] of schema) {
    const value = walkPath(theme, path);
    if (value === undefined) continue;
    const problem = check(value, spec);
    if (!problem) continue;
    const bucket = problem.fatal ? violations : warnings;
    bucket.push({ theme: themeName, path, value, ...spec, reason: problem.reason });
  }
}

function walkPath(obj, path) {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

// Returns null when the value is fine, else { reason, fatal }.
//
// Range and integrality are real constraints: a value outside min/max, or a
// fraction where the consumer needs a whole number, produces a broken config.
// A fractional `@step` is not — _types.ts documents these tags as metadata for
// a future slider UI, so 0.05 means "the slider moves in twentieths", not "no
// other value is legal". Gating the build on it made a deliberate value
// (obsidian-glass tracking its card's 0.62 alpha) fail the whole chain, so
// off-step fractions warn instead.
function check(value, { min, max, step }) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return { reason: `not a number (got ${typeof value})`, fatal: true };
  }
  if (value < min || value > max) return { reason: "out of range", fatal: true };
  if (step === 1 && !Number.isInteger(value)) {
    return { reason: "not an integer", fatal: true };
  }
  if (step != null && step !== 1) {
    const ratio = value / step;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
      return { reason: `not aligned to slider step ${step}`, fatal: false };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function describe(entry) {
  const stepStr = entry.step != null ? `, step ${entry.step}` : "";
  return `  ${entry.theme}: ${entry.path} = ${entry.value}: ${entry.reason} (expected ${entry.min}-${entry.max}${stepStr})`;
}

for (const warning of warnings) {
  console.warn(`validate-controls warning:\n${describe(warning)}`);
}

if (violations.length === 0) {
  console.log(
    `validate-controls: OK, ${schema.size} tagged path(s) checked across ${themeFiles.length} theme(s), ${warnings.length} warning(s).`
  );
  process.exit(0);
}

console.error(`\nvalidate-controls: ${violations.length} violation(s)\n`);
for (const violation of violations) {
  console.error(describe(violation));
}
console.error("");
process.exit(1);
