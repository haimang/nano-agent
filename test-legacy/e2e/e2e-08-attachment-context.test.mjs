import test from "node:test";
import assert from "node:assert/strict";

import {
  StubArtifactPreparer,
  ContextAssembler,
  promoteToArtifactRef,
  toNacpRef,
} from "../../packages/workspace-context-artifacts/dist/index.js";
import {
  planAttachment,
  toWorkspacePreparedArtifactRef,
} from "../../packages/llm-wrapper/dist/index.js";
import { ArtifactRefSchema, PreparedArtifactRefSchema } from "../../packages/workspace-context-artifacts/dist/index.js";
import { NacpRefSchema } from "../../packages/nacp-core/dist/index.js";
import { TEAM_UUID } from "./fixtures/seed-data.mjs";

test("E2E-08: Attachment/Prepared Artifact → LLM Context Assembly", async () => {
  // 1. Upload PDF → ArtifactRef
  const pdfRef = promoteToArtifactRef(TEAM_UUID, "pdf-bytes", "application/pdf", "document", {
    idFactory: () => "pdf-001",
  });
  assert.equal(ArtifactRefSchema.safeParse(pdfRef).success, true);

  // 2. Prepare artifact (extracted-text)
  const preparer = new StubArtifactPreparer();
  const prepareResult = await preparer.prepare({ sourceRef: pdfRef, targetKind: "extracted-text" });
  assert.equal(prepareResult.success, true);

  const preparedWorkspaceRef = toWorkspacePreparedArtifactRef({
    ...prepareResult.preparedRef,
    textContent: "Extracted PDF text content here",
  });
  assert.equal(PreparedArtifactRefSchema.safeParse(preparedWorkspaceRef).success, true);

  // sourceRef chain
  assert.equal(preparedWorkspaceRef.sourceRef.key, pdfRef.key);
  assert.equal(NacpRefSchema.safeParse(toNacpRef(preparedWorkspaceRef.sourceRef)).success, true);

  // 3. Context assembly
  const assembler = new ContextAssembler({
    maxTokens: 2000,
    layers: ["system", "session", "workspace_summary", "artifact_summary", "recent_transcript", "injected"],
    reserveForResponse: 500,
  });

  const layers = [
    { kind: "system", priority: 10, content: "You are helpful", tokenEstimate: 50, required: true },
    { kind: "artifact_summary", priority: 30, content: preparedWorkspaceRef.sourceRef.key, tokenEstimate: 200, required: false },
    { kind: "recent_transcript", priority: 40, content: "User asked about PDF", tokenEstimate: 100, required: false },
  ];
  const assembled = assembler.assemble(layers);

  const artifactLayer = assembled.assembled.find((l) => l.kind === "artifact_summary");
  assert.ok(artifactLayer, "artifact_summary layer should be present");

  // 4. LLM attachment planning
  // planAttachment(mimeType, sizeBytes, modelCaps)
  const plan = planAttachment(
    preparedWorkspaceRef.content_type || "text/plain",
    preparedWorkspaceRef.size_bytes || 100,
    { modelId: "gpt-4o", supportsVision: true, supportsJsonSchema: false },
  );
  assert.ok(["inline", "signed-url", "prepared-text", "reject"].includes(plan.route));

  // Attachment content would be added to canonical messages via plan.route
  assert.ok(preparedWorkspaceRef.key);
});
