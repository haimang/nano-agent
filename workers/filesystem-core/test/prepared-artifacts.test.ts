import { describe, it, expect } from "vitest";
import { StubArtifactPreparer } from "../src/prepared-artifacts.js";
import type { ArtifactKind, ArtifactRef, NacpRefKind } from "../src/refs.js";

function makeRef(
  overrides: Partial<ArtifactRef> & {
    artifactKind?: ArtifactKind;
    team?: string;
    backend?: NacpRefKind;
    keySuffix?: string;
  } = {},
): ArtifactRef {
  const team = overrides.team ?? overrides.team_uuid ?? "team-1";
  const artifactKind = overrides.artifactKind ?? "file";
  const backend = overrides.backend ?? overrides.kind ?? "do-storage";
  const suffix = overrides.keySuffix ?? "source-artifact";
  const rest: Partial<ArtifactRef> = { ...overrides };
  delete (rest as { team?: string }).team;
  delete (rest as { artifactKind?: ArtifactKind }).artifactKind;
  delete (rest as { backend?: NacpRefKind }).backend;
  delete (rest as { keySuffix?: string }).keySuffix;
  return {
    kind: backend,
    binding: backend === "r2" ? "WORKSPACE_R2" : "SESSION_DO",
    team_uuid: team,
    key: `tenants/${team}/artifacts/${artifactKind}/${suffix}`,
    role: "attachment",
    content_type: "text/plain",
    size_bytes: 256,
    artifactKind,
    createdAt: "2026-04-17T00:00:00.000Z",
    ...rest,
  };
}

describe("StubArtifactPreparer", () => {
  it("returns a successful result with a prepared ref", async () => {
    const preparer = new StubArtifactPreparer();
    const sourceRef = makeRef();

    const result = await preparer.prepare({
      sourceRef,
      targetKind: "extracted-text",
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.preparedRef).toBeDefined();
  });

  it("prepared ref inherits NacpRef fields + artifact metadata from source", async () => {
    const preparer = new StubArtifactPreparer();
    const sourceRef = makeRef({
      team: "team-42",
      backend: "r2",
      artifactKind: "document",
      keySuffix: "source",
    });

    const result = await preparer.prepare({
      sourceRef,
      targetKind: "summary",
    });

    const prepared = result.preparedRef!;
    expect(prepared.artifactKind).toBe("document");
    expect(prepared.team_uuid).toBe("team-42");
    expect(prepared.kind).toBe("r2"); // NacpRef backend
  });

  it("prepared ref has correct preparedKind", async () => {
    const preparer = new StubArtifactPreparer();
    const sourceRef = makeRef();

    const result = await preparer.prepare({
      sourceRef,
      targetKind: "preview",
    });

    expect(result.preparedRef!.preparedKind).toBe("preview");
  });

  it("prepared ref key includes target kind and stays tenant-prefixed", async () => {
    const preparer = new StubArtifactPreparer();
    const sourceRef = makeRef({ keySuffix: "original-key" });

    const result = await preparer.prepare({
      sourceRef,
      targetKind: "extracted-text",
    });

    expect(result.preparedRef!.key).toBe(
      "tenants/team-1/artifacts/file/original-key__extracted-text",
    );
    expect(result.preparedRef!.key.startsWith("tenants/team-1/")).toBe(true);
  });

  it("prepared ref includes source ref back-reference", async () => {
    const preparer = new StubArtifactPreparer();
    const sourceRef = makeRef({ keySuffix: "my-source" });

    const result = await preparer.prepare({
      sourceRef,
      targetKind: "summary",
    });

    expect(result.preparedRef!.sourceRef).toEqual(sourceRef);
  });

  it("handles all three prepared artifact kinds", async () => {
    const preparer = new StubArtifactPreparer();
    const sourceRef = makeRef();

    for (const kind of ["extracted-text", "summary", "preview"] as const) {
      const result = await preparer.prepare({
        sourceRef,
        targetKind: kind,
      });
      expect(result.success).toBe(true);
      expect(result.preparedRef!.preparedKind).toBe(kind);
    }
  });
});
