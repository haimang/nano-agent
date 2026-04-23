import test from "node:test";
import assert from "node:assert/strict";

import { NacpRefSchema } from "../packages/nacp-core/dist/index.js";
import { StoragePlacementLog } from "../packages/eval-observability/dist/index.js";
import {
  DEFAULT_DO_SIZE_THRESHOLD_BYTES,
  applyMimePolicy,
  buildDoStorageRef,
  buildKvRef,
  buildR2Ref,
  evaluateEvidence,
  getPlacement,
  placementLogToEvidence,
  validateRefKey,
} from "../packages/storage-topology/dist/index.js";

test("storage-topology refs stay nacp-core-compatible across r2/kv/do-storage", () => {
  const refs = [
    buildR2Ref("team-1", "artifacts/output.json", { content_type: "application/json" }),
    buildKvRef("team-1", "config/runtime", { role: "input" }),
    buildDoStorageRef("team-1", "sessions/s1/state"),
  ];

  for (const ref of refs) {
    assert.equal(validateRefKey(ref), true);
    assert.equal(NacpRefSchema.safeParse(ref).success, true);
  }
});

test("storage-topology calibration consumes eval-observability placement logs", () => {
  const log = new StoragePlacementLog();
  log.record({
    dataItem: "session-messages",
    storageLayer: "do-storage",
    key: "tenants/team-1/sessions/s1/messages",
    op: "write",
    sizeBytes: DEFAULT_DO_SIZE_THRESHOLD_BYTES + 64,
    timestamp: "2026-04-17T00:00:00.000Z",
  });
  log.record({
    dataItem: "session-messages",
    storageLayer: "do-storage",
    key: "tenants/team-1/sessions/s1/messages",
    op: "read",
    timestamp: "2026-04-17T00:00:01.000Z",
  });

  const signals = placementLogToEvidence(log.getEntries());
  const placement = getPlacement("session-messages");
  assert.ok(placement);
  const recommendation = evaluateEvidence(signals, placement);

  assert.equal(recommendation.action, "change-placement");
  assert.equal(recommendation.suggestedBackend, "r2");
  assert.equal(recommendation.revisitContext.thresholdBytes, DEFAULT_DO_SIZE_THRESHOLD_BYTES);
});

test("storage-topology MIME policy surfaces worker-native attachment routing decisions", () => {
  assert.equal(
    applyMimePolicy({ mimeType: "image/png", sizeBytes: 1024, supportsVision: true }).decision,
    "signed-url",
  );
  assert.equal(
    applyMimePolicy({ mimeType: "application/pdf", sizeBytes: 2048 }).decision,
    "prepared-text",
  );
});
