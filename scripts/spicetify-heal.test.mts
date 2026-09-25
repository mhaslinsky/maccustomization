import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyApps, decide, parseIni, type Snapshot } from "./spicetify-heal.mts";

const healthy: Snapshot = {
  appsState: "applied",
  spotifyVersion: "1.3.0.277",
  backupVersion: "1.3.0.277.g1a2b3c4d",
  backupCliVersion: "2.45.1",
  cliVersion: "2.45.1",
};

test("classifyApps matches spicetify's stock, mixed, applied and invalid states", () => {
  const archive = { name: "xpui.spa", isDirectory: false };
  const extracted = { name: "xpui", isDirectory: true };
  const license = { name: "native-licenses.html", isDirectory: false };
  assert.equal(classifyApps([archive, license]), "stock");
  assert.equal(classifyApps([archive, extracted]), "mixed");
  assert.equal(classifyApps([extracted, license]), "applied");
  assert.equal(classifyApps([license]), "invalid");
});

test("a Spotify update (stock apps) heals with backup apply", () => {
  const action = decide({ ...healthy, appsState: "stock", spotifyVersion: "1.3.1.10" });
  assert.equal(action.kind, "backup-apply");
});

test("a spicetify upgrade over a patched Spotify heals with restore backup apply", () => {
  assert.equal(decide({ ...healthy, backupCliVersion: "2.44.0" }).kind, "restore-backup-apply");
});

test("patched files from another Spotify build are reported broken, not re-applied", () => {
  assert.equal(decide({ ...healthy, backupVersion: "1.2.98.301.gfcaeba72" }).kind, "broken");
});

test("a patched Spotify with a matching backup and CLI is healthy", () => {
  assert.equal(decide(healthy).kind, "healthy");
});

test("parseIni keeps empty values without swallowing the next line", () => {
  const values = parseIni("[Setting]\ncolor_scheme           = \ncurrent_theme = catppuccin\n; DO NOT CHANGE!\n[Backup]\nwith = 2.45.1\n");
  assert.equal(values.get("Setting.color_scheme"), "");
  assert.equal(values.get("Setting.current_theme"), "catppuccin");
  assert.equal(values.get("Backup.with"), "2.45.1");
});
