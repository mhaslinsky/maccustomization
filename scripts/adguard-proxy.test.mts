import assert from "node:assert/strict";
import { test } from "node:test";

import { buildManagedBlock, EXCLUSION_GROUPS } from "./adguard-proxy.mts";

test("Apple MobileAsset exclusions include the catalog and metadata hosts", () => {
  const expectedAppleAssetDomains = ["gdmf.apple.com", "gdmf-ados.apple.com", "mesu.apple.com"];
  const appleAssetGroup = EXCLUSION_GROUPS.find((group) =>
    group.rationale.startsWith("Apple MobileAsset catalog and metadata"),
  );

  assert.ok(appleAssetGroup);
  assert.deepEqual(appleAssetGroup.domains, expectedAppleAssetDomains);
});

test("every exclusion group domain appears in the rendered managed block", () => {
  const renderedLines = new Set(buildManagedBlock());

  for (const group of EXCLUSION_GROUPS) {
    for (const domain of group.domains) {
      assert.ok(renderedLines.has(domain), `${domain} is missing from the managed block`);
    }
  }
});
