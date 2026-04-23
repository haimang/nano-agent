import test from "node:test";
import assert from "node:assert/strict";

import {
  ContextCompactRequestBodySchema,
  ContextCompactResponseBodySchema,
  NacpRefSchema,
} from "../packages/nacp-core/dist/index.js";
import { redactPayload as sessionRedactPayload } from "../packages/nacp-session/dist/index.js";
import { toWorkspacePreparedArtifactRef } from "../packages/llm-wrapper/dist/index.js";
import {
  ArtifactRefSchema,
  CompactBoundaryManager,
  PreparedArtifactRefSchema,
  promoteToArtifactRef,
  redactPayload as workspaceRedactPayload,
  toNacpRef,
} from "../packages/workspace-context-artifacts/dist/index.js";

test("workspace artifact refs and llm-wrapper prepared refs stay cross-package compatible", () => {
  const artifactRef = promoteToArtifactRef(
    "team-1",
    "x".repeat(5000),
    "text/plain",
    "document",
    { idFactory: () => "artifact-1" },
  );

  assert.equal(ArtifactRefSchema.safeParse(artifactRef).success, true);
  assert.equal(NacpRefSchema.safeParse(toNacpRef(artifactRef)).success, true);

  const preparedRef = toWorkspacePreparedArtifactRef({
    ...artifactRef,
    preparedKind: "summary",
    sourceRef: artifactRef,
    textContent: "prepared text",
  });

  assert.equal(PreparedArtifactRefSchema.safeParse(preparedRef).success, true);
});

test("workspace compact boundary bodies align with nacp-core and redaction mirrors nacp-session", () => {
  const artifactRef = promoteToArtifactRef(
    "team-1",
    "summary body",
    "text/plain",
    "compact-archive",
    { idFactory: () => "summary-1" },
  );
  const manager = new CompactBoundaryManager();

  const requestBody = manager.buildCompactRequest({
    historyRef: toNacpRef(artifactRef),
    messages: [
      { content: "older context", tokenEstimate: 80 },
      { content: "recent context", tokenEstimate: 40 },
    ],
    targetTokenBudget: 64,
  });
  assert.equal(ContextCompactRequestBodySchema.safeParse(requestBody).success, true);

  const responseBody = {
    status: "ok",
    summary_ref: toNacpRef(artifactRef),
    tokens_before: 120,
    tokens_after: 32,
  };
  assert.equal(ContextCompactResponseBodySchema.safeParse(responseBody).success, true);

  const applied = manager.applyCompactResponse(
    [{ role: "user", content: "recent context", tokenEstimate: 40 }],
    responseBody,
    artifactRef,
    "1-4",
  );
  assert.ok("messages" in applied);
  assert.equal(applied.boundary.summaryRef.key, artifactRef.key);

  const payload = { tool: { input: { secret: "value", keep: "ok" } } };
  const hints = ["tool.input.secret"];
  assert.deepEqual(workspaceRedactPayload(payload, hints), sessionRedactPayload(payload, hints));
});
