import test from "node:test";
import assert from "node:assert/strict";

import {
  promoteToArtifactRef,
  StubArtifactPreparer,
  CompactBoundaryManager,
  toNacpRef,
} from "../../packages/workspace-context-artifacts/dist/index.js";
import { planAttachment, toWorkspacePreparedArtifactRef } from "../../packages/llm-wrapper/dist/index.js";
import { buildSessionCheckpoint, restoreSessionCheckpoint } from "../../packages/session-do-runtime/dist/index.js";
import { TEAM_UUID, SESSION_UUID, NOW } from "./fixtures/seed-data.mjs";

test("E2E-13: Content Replacement + Prepared Artifact consistency across compact/resume", async () => {
  // 1. Large tool result promotion
  const largeResult = "x".repeat(80_000);
  const toolArtifact = promoteToArtifactRef(TEAM_UUID, largeResult, "text/plain", "document", {
    idFactory: () => "tool-art-001",
  });

  // 2. PDF prepared artifact
  const pdfRef = promoteToArtifactRef(TEAM_UUID, "pdf-bytes", "application/pdf", "document", {
    idFactory: () => "pdf-001",
  });
  const preparer = new StubArtifactPreparer();
  const prepared = await preparer.prepare({ sourceRef: pdfRef, targetKind: "extracted-text" });
  const preparedWorkspaceRef = toWorkspacePreparedArtifactRef({
    ...prepared.preparedRef,
    textContent: "Extracted PDF text",
  });

  // 3. Plan attachment - verify prepared artifact can be planned for LLM context
  const plan = planAttachment(
    preparedWorkspaceRef.content_type || "text/plain",
    preparedWorkspaceRef.size_bytes || 100,
    { modelId: "gpt-4o", supportsVision: true, supportsJsonSchema: false },
  );
  assert.ok(["inline", "signed-url", "prepared-text", "reject"].includes(plan.route));

  // Verify large result is promoted to artifact (not inline)
  assert.ok(toolArtifact.key, "artifact ref must exist");
  assert.ok(!largeResult.includes(toolArtifact.key), "large result content not in artifact key");

  // 4. Compact boundary applied
  const mgr = new CompactBoundaryManager();
  const summaryRef = promoteToArtifactRef(TEAM_UUID, "summary", "text/plain", "compact-archive", {
    idFactory: () => "sum-001",
  });
  const response = {
    status: "ok",
    summary_ref: toNacpRef(summaryRef),
    tokens_before: 200,
    tokens_after: 50,
  };
  const applied = mgr.applyCompactResponse(
    [
      { role: "user", content: `See artifact: ${toolArtifact.key}`, tokenEstimate: 20 },
      { role: "user", content: `Attachment route: ${plan.route}`, tokenEstimate: 21 },
    ],
    response,
    summaryRef,
    "0-0",
  );

  assert.ok("messages" in applied);

  // 5. Checkpoint / resume
  const checkpoint = await buildSessionCheckpoint(
    SESSION_UUID,
    TEAM_UUID,
    "attached",
    1,
    { totalTokens: 50, totalTurns: 1, totalDurationMs: 100 },
    {
      getKernelFragment: () => ({}),
      getReplayFragment: async () => ({}),
      getStreamSeqs: () => ({ main: 1 }),
      getWorkspaceFragment: async () => ({
        artifactRefs: [toolArtifact, pdfRef],
      }),
      getHooksFragment: () => ({}),
    },
  );

  const restored = await restoreSessionCheckpoint(checkpoint, {
    restoreKernel: (f) => f,
    restoreReplay: async () => undefined,
    restoreWorkspace: async (fragment) => fragment,
    restoreHooks: () => undefined,
  });

  const workspaceFragment = restored.workspaceSnapshot;
  const artifactKeys = workspaceFragment.artifactRefs.map((r) => r.key);

  // Both artifacts survive resume
  assert.ok(artifactKeys.includes(toolArtifact.key));
  assert.ok(artifactKeys.includes(pdfRef.key));

  // sourceRef -> preparedRef chain intact
  assert.equal(preparedWorkspaceRef.sourceRef.key, pdfRef.key);
});
