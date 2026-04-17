import test from "node:test";
import assert from "node:assert/strict";

import { evaluateEvidence, PLACEMENT_HYPOTHESES, DATA_ITEM_CATALOG } from "../../packages/storage-topology/dist/index.js";
import { shouldPromoteResult, promoteToArtifactRef } from "../../packages/workspace-context-artifacts/dist/index.js";
import { TEAM_UUID } from "./fixtures/seed-data.mjs";

test("E2E-10: Storage Topology Evidence → Calibration → Placement Recommendation", async () => {
  // The package now exports populated placement hypotheses; this test still
  // constructs a focused hypothesis from the catalog to exercise a specific
  // DO -> R2 demotion path.
  const largeDataItem = DATA_ITEM_CATALOG["workspace-file-large"];
  assert.ok(largeDataItem, "workspace-file-large should exist in catalog");

  // 1. Accumulate evidence signals for large file
  const largeSignals = [];
  for (let i = 0; i < 12; i++) {
    largeSignals.push({
      kind: "size",
      dataItem: "workspace-file-large",
      value: 2_000_000,
      observedAt: "2026-04-17T10:00:00.000Z",
    });
  }

  // Construct a PlacementHypothesis to test DO->R2 demotion logic
  const largeHypothesis = {
    dataItem: largeDataItem.itemClass,
    storageBackend: "do-storage",
    thresholdBytes: 1_000_000,
    notes: "Test hypothesis for large file demotion",
  };

  const largeResult = evaluateEvidence(largeSignals, largeHypothesis);
  assert.equal(largeResult.action, "change-placement");
  assert.equal(largeResult.confidence, "high"); // >= 10 signals = high
  assert.ok(largeResult.reason.includes("2000000"));

  // 2. Accumulate evidence for small file (within threshold)
  const smallDataItem = DATA_ITEM_CATALOG["workspace-file-small"];
  assert.ok(smallDataItem);

  const smallSignals = [
    { kind: "size", dataItem: "workspace-file-small", value: 500_000, observedAt: "2026-04-17T10:00:00.000Z" },
  ];

  const smallHypothesis = {
    dataItem: smallDataItem.itemClass,
    storageBackend: "do-storage",
    thresholdBytes: 1_000_000,
    notes: "Test hypothesis for small file maintenance",
  };

  const smallResult = evaluateEvidence(smallSignals, smallHypothesis);
  assert.equal(smallResult.action, "maintain");
  assert.equal(smallResult.confidence, "low"); // 1-2 signals = low

  // 3. Apply recommendation to promotion policy
  const customPolicy = {
    maxInlineBytes: 4096,
    promotableMimeTypes: new Set(["text/plain"]),
    coldTierSizeBytes: 1_500_000, // lowered based on recommendation
  };

  const smallContent = "x".repeat(500_000);
  const mediumContent = "x".repeat(1_600_000);

  const smallPromote = shouldPromoteResult(smallContent, "text/plain", customPolicy);
  assert.equal(smallPromote.promote, true);

  const smallRef = promoteToArtifactRef(TEAM_UUID, smallContent, "text/plain", "file", {
    idFactory: () => "small-001",
    policy: customPolicy,
  });
  // 500KB < 1.5MB => do-storage
  assert.equal(smallRef.kind, "do-storage");

  const mediumRef = promoteToArtifactRef(TEAM_UUID, mediumContent, "text/plain", "file", {
    idFactory: () => "medium-001",
    policy: customPolicy,
  });
  // 1.6MB > 1.5MB => r2
  assert.equal(mediumRef.kind, "r2");

  // 4. Provisional marker should indicate provisional status
  assert.equal(largeDataItem.provisionalMarker, "provisional");
  assert.equal(smallDataItem.provisionalMarker, "provisional");
});
