/**
 * Integration — attachment planning → PreparedArtifactRef → workspace schema.
 *
 * Verifies that:
 *   - `planAttachment()` emits the worker-native route names
 *     (`inline` / `signed-url` / `prepared-text` / `reject`).
 *   - The wrapper's local `PreparedArtifactRef` shape (NacpRef-aligned)
 *     parses under the real workspace
 *     `PreparedArtifactRefSchema`.
 */

import { describe, it, expect } from "vitest";
import { PreparedArtifactRefSchema } from "@nano-agent/workspace-context-artifacts";
import { planAttachment } from "../../../src/llm/attachment-planner.js";
import type { ModelCapabilities } from "../../../src/llm/registry/models.js";
import type { PreparedArtifactRef } from "../../../src/llm/prepared-artifact.js";
import { toWorkspacePreparedArtifactRef } from "../../../src/llm/prepared-artifact.js";

const visionModel: ModelCapabilities = {
  modelId: "gpt-4o",
  provider: "openai",
  supportsStream: true,
  supportsTools: true,
  supportsVision: true,
  supportsJsonSchema: true,
  contextWindow: 128_000,
  maxOutputTokens: 16_384,
};

const textOnlyModel: ModelCapabilities = {
  modelId: "text-only",
  provider: "openai",
  supportsStream: false,
  supportsTools: false,
  supportsVision: false,
  supportsJsonSchema: false,
  contextWindow: 4096,
  maxOutputTokens: 1024,
};

describe("integration: attachment planning + prepared artifact contract", () => {
  it("uses worker-native route names", () => {
    expect(planAttachment("image/png", 1024, visionModel).route).toBe("signed-url");
    expect(planAttachment("image/png", 1024, textOnlyModel).route).toBe("reject");
    expect(planAttachment("application/pdf", 10 * 1024 * 1024, textOnlyModel).route).toBe(
      "prepared-text",
    );
    expect(planAttachment("text/plain", 1024, textOnlyModel).route).toBe("inline");
    expect(planAttachment("text/plain", 1024 * 1024, textOnlyModel).route).toBe("prepared-text");
    expect(planAttachment("audio/mp3", 1024, textOnlyModel).route).toBe("reject");
  });

  it("PreparedArtifactRef (without textContent) parses under workspace PreparedArtifactRefSchema", () => {
    const ref: PreparedArtifactRef = {
      kind: "r2",
      binding: "WORKSPACE_R2",
      team_uuid: "team-1",
      key: "tenants/team-1/artifacts/document/prepared-1",
      role: "attachment",
      content_type: "text/plain",
      size_bytes: 128,
      artifactKind: "document",
      createdAt: "2026-04-17T00:00:00.000Z",
      preparedKind: "extracted-text",
      sourceRef: {
        kind: "r2",
        binding: "WORKSPACE_R2",
        team_uuid: "team-1",
        key: "tenants/team-1/uploads/doc.pdf",
        role: "input",
        content_type: "application/pdf",
        size_bytes: 16_384,
        artifactKind: "document",
        createdAt: "2026-04-17T00:00:00.000Z",
      },
      textContent: "the extracted body",
    };

    const workspaceShape = toWorkspacePreparedArtifactRef(ref);
    expect(workspaceShape).not.toHaveProperty("textContent");

    const parsed = PreparedArtifactRefSchema.safeParse(workspaceShape);
    expect(parsed.success).toBe(true);
  });

  it("the workspace schema rejects malformed refs (wrong preparedKind)", () => {
    const invalid = {
      kind: "r2",
      binding: "WORKSPACE_R2",
      team_uuid: "team-1",
      key: "tenants/team-1/artifacts/document/abc",
      role: "attachment",
      artifactKind: "document",
      createdAt: "2026-04-17T00:00:00.000Z",
      preparedKind: "not-a-valid-kind",
      sourceRef: {
        kind: "r2",
        binding: "WORKSPACE_R2",
        team_uuid: "team-1",
        key: "tenants/team-1/uploads/doc.pdf",
        role: "input",
        artifactKind: "document",
        createdAt: "2026-04-17T00:00:00.000Z",
      },
    };
    const parsed = PreparedArtifactRefSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
});
