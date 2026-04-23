import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldPromoteResult,
  promoteToArtifactRef,
  toNacpRef,
  InMemoryArtifactStore,
  WorkspaceSnapshotBuilder,
  WorkspaceNamespace,
  MountRouter,
  MemoryBackend,
} from "../../packages/workspace-context-artifacts/dist/index.js";
import { validateRefKey } from "../../packages/storage-topology/dist/index.js";
import { buildToolAttribution } from "../../packages/eval-observability/dist/index.js";
import { NacpRefSchema } from "../../packages/nacp-core/dist/index.js";
import { TEAM_UUID } from "./fixtures/seed-data.mjs";

test("E2E-04: Large Tool Result Promotion → Artifact Ref → Workspace Snapshot", async () => {
  // 1. Simulate large tool result (100KB text)
  const largeResult = "x".repeat(100_000);

  const promotionDecision = shouldPromoteResult(largeResult, "text/plain");
  assert.equal(promotionDecision.promote, true);
  assert.ok(promotionDecision.reason.includes("exceeds inline limit"));

  // 2. Promote to artifact ref
  const artifactRef = promoteToArtifactRef(
    TEAM_UUID,
    largeResult,
    "text/plain",
    "document",
    { idFactory: () => "rg-result-001" },
  );

  assert.equal(artifactRef.size_bytes, new TextEncoder().encode(largeResult).length);
  assert.equal(artifactRef.size_bytes > 64_000, true);
  // 100KB < 1MB default cold tier => do-storage
  assert.equal(artifactRef.kind, "do-storage");
  assert.equal(artifactRef.binding, "SESSION_DO");
  assert.ok(artifactRef.key.startsWith(`tenants/${TEAM_UUID}/`));

  // 3. storage-topology validation
  const refKey = { kind: artifactRef.kind, team_uuid: artifactRef.team_uuid, key: artifactRef.key };
  assert.equal(validateRefKey(refKey), true);

  // NacpRef schema validation
  assert.equal(NacpRefSchema.safeParse(toNacpRef(artifactRef)).success, true);

  // 4. Artifact store + snapshot
  const store = new InMemoryArtifactStore();
  store.register({
    ref: artifactRef,
    audience: "internal",
    createdAt: new Date().toISOString(),
  });

  const router = new MountRouter();
  router.addMount({ mountPoint: "/workspace", backend: "memory", access: "writable" }, new MemoryBackend());
  const namespace = new WorkspaceNamespace(router);

  const builder = new WorkspaceSnapshotBuilder(namespace, store);
  const fragment = await builder.buildFragment();

  assert.ok(fragment.artifactRefs.some((r) => r.key === artifactRef.key));

  // 5. Trace evidence
  const traceEvent = buildToolAttribution({
    toolName: "rg",
    resultSizeBytes: artifactRef.size_bytes,
    durationMs: 45,
  });
  assert.equal(traceEvent.resultSizeBytes, artifactRef.size_bytes);
});
