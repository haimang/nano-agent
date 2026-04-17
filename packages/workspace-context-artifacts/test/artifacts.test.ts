import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryArtifactStore } from "../src/artifacts.js";
import type { ArtifactMetadata } from "../src/artifacts.js";
import type { ArtifactKind, ArtifactRef } from "../src/refs.js";

function makeRef(
  overrides: Partial<ArtifactRef> & { artifactKind?: ArtifactKind } = {},
): ArtifactRef {
  const kind = overrides.artifactKind ?? "file";
  const team = overrides.team_uuid ?? "team-1";
  const rest = { ...overrides };
  delete (rest as { artifactKind?: ArtifactKind }).artifactKind;
  return {
    kind: "do-storage",
    binding: "SESSION_DO",
    team_uuid: team,
    key: `tenants/${team}/artifacts/${kind}/${Math.random().toString(36).slice(2, 8)}`,
    role: "attachment",
    content_type: "text/plain",
    size_bytes: 100,
    artifactKind: kind,
    createdAt: new Date().toISOString(),
    ...rest,
  };
}

function makeMeta(
  overrides: Partial<ArtifactMetadata> & { ref?: ArtifactRef } = {},
): ArtifactMetadata {
  return {
    ref: overrides.ref ?? makeRef(),
    audience: "internal",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("InMemoryArtifactStore", () => {
  let store: InMemoryArtifactStore;

  beforeEach(() => {
    store = new InMemoryArtifactStore();
  });

  // ── register / get ──

  it("registers and retrieves an artifact by key", () => {
    const ref = makeRef({ key: "tenants/team-1/artifacts/file/my-artifact" });
    const meta = makeMeta({ ref });
    store.register(meta);

    const retrieved = store.get(ref.key);
    expect(retrieved).toBeDefined();
    expect(retrieved!.ref.key).toBe(ref.key);
    expect(retrieved!.audience).toBe("internal");
  });

  it("returns undefined for unregistered key", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("overwrites an existing artifact with the same key", () => {
    const ref = makeRef({ key: "tenants/team-1/artifacts/file/dup" });
    store.register(makeMeta({ ref, audience: "internal" }));
    store.register(makeMeta({ ref, audience: "client-visible" }));

    const retrieved = store.get(ref.key);
    expect(retrieved!.audience).toBe("client-visible");
  });

  // ── list ──

  it("lists all registered artifacts", () => {
    store.register(makeMeta({ ref: makeRef() }));
    store.register(makeMeta({ ref: makeRef() }));
    store.register(makeMeta({ ref: makeRef() }));
    expect(store.list()).toHaveLength(3);
  });

  it("returns empty list when store is empty", () => {
    expect(store.list()).toHaveLength(0);
  });

  // ── listByKind (filters by artifactKind, not the NacpRef backend kind) ──

  it("filters artifacts by artifactKind", () => {
    store.register(makeMeta({ ref: makeRef({ artifactKind: "file" }) }));
    store.register(makeMeta({ ref: makeRef({ artifactKind: "image" }) }));
    store.register(makeMeta({ ref: makeRef({ artifactKind: "file" }) }));
    store.register(makeMeta({ ref: makeRef({ artifactKind: "document" }) }));

    const files = store.listByKind("file");
    expect(files).toHaveLength(2);
    expect(files.every((m) => m.ref.artifactKind === "file")).toBe(true);

    const images = store.listByKind("image");
    expect(images).toHaveLength(1);
  });

  it("returns empty list for kind with no matches", () => {
    store.register(makeMeta({ ref: makeRef({ artifactKind: "file" }) }));
    expect(store.listByKind("transcript")).toHaveLength(0);
  });

  // ── metadata fields ──

  it("preserves all metadata fields", () => {
    const ref = makeRef({ key: "tenants/team-1/artifacts/file/full-meta" });
    const meta: ArtifactMetadata = {
      ref,
      audience: "client-visible",
      previewText: "A short preview",
      preparedState: "ready",
      createdAt: "2026-01-01T00:00:00.000Z",
    };

    store.register(meta);
    const retrieved = store.get(ref.key);
    expect(retrieved).toEqual(meta);
  });

  it("handles optional fields being absent", () => {
    const ref = makeRef({ key: "tenants/team-1/artifacts/file/minimal" });
    const meta: ArtifactMetadata = {
      ref,
      audience: "internal",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    store.register(meta);
    const retrieved = store.get(ref.key);
    expect(retrieved!.previewText).toBeUndefined();
    expect(retrieved!.preparedState).toBeUndefined();
  });
});
