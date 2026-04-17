/**
 * Tests for `ArtifactRef` / `PreparedArtifactRef`.
 *
 * Verifies the schemas are `NacpRef`-shaped and reject malformed
 * inputs (wrong `kind`, non-tenant-prefixed `key`, invalid `preparedKind`).
 */

import { describe, it, expect } from "vitest";
// Relative import to the sibling nacp-core package so the schema is
// validated against the real NacpRef definition.
import { NacpRefSchema } from "../../nacp-core/src/envelope.js";
import {
  ArtifactRefSchema,
  PreparedArtifactRefSchema,
  toNacpRef,
} from "../src/refs.js";
import type { ArtifactRef, PreparedArtifactRef } from "../src/refs.js";

function baseRef(overrides: Partial<ArtifactRef> = {}): ArtifactRef {
  return {
    kind: "r2",
    binding: "WORKSPACE_R2",
    team_uuid: "team-1",
    key: "tenants/team-1/artifacts/file/abc",
    role: "attachment",
    content_type: "text/plain",
    size_bytes: 42,
    artifactKind: "file",
    createdAt: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("ArtifactRefSchema", () => {
  it("accepts a valid ref", () => {
    expect(ArtifactRefSchema.safeParse(baseRef()).success).toBe(true);
  });

  it("rejects a ref whose key is not tenant-prefixed (R2/R7 regression guard)", () => {
    expect(
      ArtifactRefSchema.safeParse(baseRef({ key: "no-prefix/file/abc" })).success,
    ).toBe(false);
  });

  it("rejects a ref with a wrong-tenant prefix", () => {
    expect(
      ArtifactRefSchema.safeParse(baseRef({ key: "tenants/other-team/artifacts/file/abc" })).success,
    ).toBe(false);
  });

  it("rejects an unknown NacpRef kind", () => {
    // Forcefully cast so we can feed an illegal value through the zod
    // schema — the runtime guard must still reject it.
    const bad = { ...baseRef(), kind: "file" } as unknown as ArtifactRef;
    expect(ArtifactRefSchema.safeParse(bad).success).toBe(false);
  });

  it("accepts all v1 artifact kinds", () => {
    for (const k of ["file", "image", "document", "export", "compact-archive", "transcript"] as const) {
      expect(ArtifactRefSchema.safeParse(baseRef({ artifactKind: k })).success).toBe(true);
    }
  });

  it("output also parses under the real NacpRefSchema from @nano-agent/nacp-core", () => {
    const ref = baseRef();
    const nacpShape = toNacpRef(ref);
    expect(NacpRefSchema.safeParse(nacpShape).success).toBe(true);
  });
});

describe("PreparedArtifactRefSchema", () => {
  const prepared: PreparedArtifactRef = {
    ...baseRef({ key: "tenants/team-1/artifacts/file/prepared-1" }),
    preparedKind: "extracted-text",
    sourceRef: baseRef({ key: "tenants/team-1/artifacts/file/source" }),
  };

  it("accepts a valid prepared ref", () => {
    expect(PreparedArtifactRefSchema.safeParse(prepared).success).toBe(true);
  });

  it("rejects a prepared ref with an invalid preparedKind", () => {
    const bad = { ...prepared, preparedKind: "not-a-kind" } as unknown;
    expect(PreparedArtifactRefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a prepared ref whose source key is not tenant-prefixed", () => {
    const bad = {
      ...prepared,
      sourceRef: { ...prepared.sourceRef, key: "no-prefix/source" },
    };
    expect(PreparedArtifactRefSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a prepared ref whose top-level key is not tenant-prefixed", () => {
    const bad = { ...prepared, key: "no-prefix/prepared" };
    expect(PreparedArtifactRefSchema.safeParse(bad).success).toBe(false);
  });
});

describe("toNacpRef", () => {
  it("strips artifact-specific metadata", () => {
    const nacpShape = toNacpRef(baseRef());
    expect(nacpShape).not.toHaveProperty("artifactKind");
    expect(nacpShape).not.toHaveProperty("createdAt");
  });

  it("omits undefined optional fields", () => {
    const ref = baseRef({ size_bytes: undefined, content_type: undefined });
    const nacpShape = toNacpRef(ref);
    expect(nacpShape).not.toHaveProperty("size_bytes");
    expect(nacpShape).not.toHaveProperty("content_type");
  });
});
