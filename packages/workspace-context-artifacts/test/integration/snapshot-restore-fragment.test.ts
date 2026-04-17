/**
 * Integration — build a workspace snapshot fragment with live mount
 * configs, file index and artifact refs, then restore it back and
 * confirm the restored view matches what was persisted.
 *
 * This is the regression guard for the review finding that
 * `WorkspaceSnapshotBuilder.buildFragment()` used to return empty
 * `mountConfigs`/`fileIndex`/`contextLayers` arrays.
 */

import { describe, it, expect } from "vitest";
import { MountRouter } from "../../src/mounts.js";
import { WorkspaceNamespace } from "../../src/namespace.js";
import { MemoryBackend } from "../../src/backends/memory.js";
import { InMemoryArtifactStore } from "../../src/artifacts.js";
import { WorkspaceSnapshotBuilder } from "../../src/snapshot.js";
import type { ArtifactMetadata } from "../../src/artifacts.js";
import type { ArtifactRef } from "../../src/refs.js";
import type { ContextLayer } from "../../src/context-layers.js";

function ref(suffix: string): ArtifactRef {
  return {
    kind: "r2",
    binding: "WORKSPACE_R2",
    team_uuid: "team-1",
    key: `tenants/team-1/artifacts/file/${suffix}`,
    role: "attachment",
    content_type: "text/plain",
    size_bytes: 32,
    artifactKind: "file",
    createdAt: "2026-04-17T00:00:00.000Z",
  };
}

function meta(r: ArtifactRef): ArtifactMetadata {
  return {
    ref: r,
    audience: "internal",
    createdAt: "2026-04-17T00:00:00.000Z",
  };
}

describe("integration: snapshot build + restore round-trip", () => {
  it("captures live mounts, files, artifacts, and context layers into the fragment", async () => {
    const backend = new MemoryBackend();
    await backend.write("readme.md", "hi");
    await backend.write("src/index.ts", "// hello");

    const router = new MountRouter();
    router.addMount(
      { mountPoint: "/", backend: "memory", access: "writable" },
      backend,
    );
    router.addMount(
      { mountPoint: "/shared", backend: "memory", access: "readonly" },
      new MemoryBackend(),
    );

    const ns = new WorkspaceNamespace(router);
    const store = new InMemoryArtifactStore();
    store.register(meta(ref("a")));
    store.register(meta(ref("b")));

    const contextLayers: ContextLayer[] = [
      { kind: "system", priority: 0, content: "sys", tokenEstimate: 10, required: true },
      { kind: "workspace_summary", priority: 20, content: "ws", tokenEstimate: 50, required: false },
    ];

    const builder = new WorkspaceSnapshotBuilder(ns, store);
    const fragment = await builder.buildFragment({ contextLayers });

    // Mount configs
    const mountPoints = fragment.mountConfigs.map((m) => m.mountPoint).sort();
    expect(mountPoints).toEqual(["/", "/shared"]);

    // File index
    const fileIndexPaths = fragment.fileIndex.map((f) => f.path);
    expect(fileIndexPaths.some((p) => p.endsWith("readme.md"))).toBe(true);

    // Artifact refs
    expect(fragment.artifactRefs).toHaveLength(2);
    expect(fragment.artifactRefs.every((r) => r.key.startsWith("tenants/team-1/"))).toBe(true);

    // Context layers
    expect(fragment.contextLayers).toHaveLength(2);

    // Restore view mirrors the fragment
    const restored = WorkspaceSnapshotBuilder.restoreFragment(fragment);
    expect(restored.mountConfigs.map((m) => m.mountPoint).sort()).toEqual(["/", "/shared"]);
    expect(restored.artifactRefs).toHaveLength(2);
    expect(restored.contextLayers).toHaveLength(2);
    expect(restored.fileIndex).toEqual(fragment.fileIndex);
  });

  it("truncates the file index at maxFileIndexSize and keeps the fragment valid", async () => {
    const backend = new MemoryBackend();
    for (let i = 0; i < 20; i++) await backend.write(`f${i}.txt`, `c${i}`);

    const router = new MountRouter();
    router.addMount(
      { mountPoint: "/", backend: "memory", access: "writable" },
      backend,
    );
    const ns = new WorkspaceNamespace(router);
    const store = new InMemoryArtifactStore();

    const fragment = await new WorkspaceSnapshotBuilder(ns, store).buildFragment({
      maxFileIndexSize: 5,
    });

    expect(fragment.fileIndex.length).toBeLessThanOrEqual(5);
  });
});
