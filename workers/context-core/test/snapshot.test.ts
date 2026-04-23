import { describe, it, expect } from "vitest";
import { WorkspaceSnapshotBuilder } from "../src/snapshot.js";
import type { WorkspaceSnapshotFragment } from "../src/snapshot.js";
import {
  InMemoryArtifactStore,
  WorkspaceNamespace,
  MountRouter,
  MemoryBackend,
  WORKSPACE_VERSION,
} from "@nano-agent/workspace-context-artifacts";
import type {
  ArtifactMetadata,
  ArtifactKind,
  ArtifactRef,
} from "@nano-agent/workspace-context-artifacts";

function makeRef(
  overrides: Partial<ArtifactRef> & { artifactKind?: ArtifactKind; keySuffix?: string } = {},
): ArtifactRef {
  const team = overrides.team_uuid ?? "team-1";
  const artifactKind = overrides.artifactKind ?? "file";
  const suffix = overrides.keySuffix ?? Math.random().toString(36).slice(2, 8);
  const rest: Partial<ArtifactRef> = { ...overrides };
  delete (rest as { artifactKind?: ArtifactKind }).artifactKind;
  delete (rest as { keySuffix?: string }).keySuffix;
  return {
    kind: "do-storage",
    binding: "SESSION_DO",
    team_uuid: team,
    key: `tenants/${team}/artifacts/${artifactKind}/${suffix}`,
    role: "attachment",
    content_type: "text/plain",
    size_bytes: 100,
    artifactKind,
    createdAt: "2026-04-17T00:00:00.000Z",
    ...rest,
  };
}

function makeMeta(ref: ArtifactRef): ArtifactMetadata {
  return {
    ref,
    audience: "internal",
    createdAt: "2026-04-17T00:00:00.000Z",
  };
}

function createNamespace(): WorkspaceNamespace {
  const router = new MountRouter();
  router.addMount(
    { mountPoint: "/", backend: "memory", access: "writable" },
    new MemoryBackend(),
  );
  return new WorkspaceNamespace(router);
}

describe("WorkspaceSnapshotBuilder", () => {
  describe("buildFragment", () => {
    it("builds a snapshot with version and timestamp", async () => {
      const ns = createNamespace();
      const store = new InMemoryArtifactStore();
      const builder = new WorkspaceSnapshotBuilder(ns, store);

      const fragment = await builder.buildFragment();

      expect(fragment.version).toBe(WORKSPACE_VERSION);
      expect(fragment.createdAt).toBeTruthy();
      expect(Number.isNaN(Date.parse(fragment.createdAt))).toBe(false);
    });

    it("ACTUALLY captures mount configs from the namespace (R1 regression guard)", async () => {
      const router = new MountRouter();
      router.addMount(
        { mountPoint: "/", backend: "memory", access: "writable" },
        new MemoryBackend(),
      );
      router.addMount(
        { mountPoint: "/docs", backend: "memory", access: "readonly" },
        new MemoryBackend(),
      );
      const ns = new WorkspaceNamespace(router);
      const store = new InMemoryArtifactStore();
      const builder = new WorkspaceSnapshotBuilder(ns, store);

      const fragment = await builder.buildFragment();

      const mountPoints = fragment.mountConfigs.map((m) => m.mountPoint).sort();
      expect(mountPoints).toEqual(["/", "/docs"]);
    });

    it("ACTUALLY captures a file index from live backends (R1 regression guard)", async () => {
      const backend = new MemoryBackend();
      await backend.write("a.txt", "hello");
      await backend.write("b.txt", "world");
      const router = new MountRouter();
      router.addMount(
        { mountPoint: "/", backend: "memory", access: "writable" },
        backend,
      );
      const ns = new WorkspaceNamespace(router);
      const store = new InMemoryArtifactStore();
      const builder = new WorkspaceSnapshotBuilder(ns, store);

      const fragment = await builder.buildFragment();

      expect(fragment.fileIndex.length).toBeGreaterThanOrEqual(2);
      const paths = fragment.fileIndex.map((f) => f.path);
      expect(paths.some((p) => p.endsWith("a.txt"))).toBe(true);
      expect(paths.some((p) => p.endsWith("b.txt"))).toBe(true);
    });

    it("includes artifact refs from the store", async () => {
      const ns = createNamespace();
      const store = new InMemoryArtifactStore();

      const ref1 = makeRef({ keySuffix: "art-1" });
      const ref2 = makeRef({ keySuffix: "art-2" });
      store.register(makeMeta(ref1));
      store.register(makeMeta(ref2));

      const builder = new WorkspaceSnapshotBuilder(ns, store);
      const fragment = await builder.buildFragment();

      expect(fragment.artifactRefs).toHaveLength(2);
      const keys = fragment.artifactRefs.map((r) => r.key).sort();
      expect(keys).toEqual([ref1.key, ref2.key].sort());
    });

    it("returns empty artifactRefs / contextLayers when the store has nothing and the caller supplies no layers", async () => {
      const ns = createNamespace();
      const store = new InMemoryArtifactStore();
      const builder = new WorkspaceSnapshotBuilder(ns, store);
      const fragment = await builder.buildFragment();
      expect(fragment.artifactRefs).toHaveLength(0);
      expect(fragment.contextLayers).toHaveLength(0);
    });

    it("embeds caller-supplied context layers verbatim", async () => {
      const ns = createNamespace();
      const store = new InMemoryArtifactStore();
      const builder = new WorkspaceSnapshotBuilder(ns, store);
      const fragment = await builder.buildFragment({
        contextLayers: [
          {
            kind: "system",
            priority: 0,
            content: "system prompt",
            tokenEstimate: 10,
            required: true,
          },
        ],
      });
      expect(fragment.contextLayers).toHaveLength(1);
      expect(fragment.contextLayers[0]!.kind).toBe("system");
    });
  });

  describe("restoreFragment", () => {
    it("extracts mount configs, artifact refs, file index and context layers", () => {
      const fragment: WorkspaceSnapshotFragment = {
        version: WORKSPACE_VERSION,
        mountConfigs: [
          { mountPoint: "/", backend: "memory", access: "writable" },
          { mountPoint: "/docs", backend: "kv", access: "readonly" },
        ],
        fileIndex: [
          { path: "/a.txt", size: 10, modifiedAt: "2026-04-17T00:00:00.000Z" },
        ],
        artifactRefs: [makeRef({ keySuffix: "restored-1" })],
        contextLayers: [],
        createdAt: "2026-04-17T00:00:00.000Z",
      };

      const restored = WorkspaceSnapshotBuilder.restoreFragment(fragment);
      expect(restored.mountConfigs).toHaveLength(2);
      expect(restored.artifactRefs).toHaveLength(1);
      expect(restored.fileIndex).toHaveLength(1);
      expect(restored.contextLayers).toHaveLength(0);
    });
  });

  describe("build / restore roundtrip", () => {
    it("artifact refs and mount configs survive a build-restore cycle", async () => {
      const ns = createNamespace();
      const store = new InMemoryArtifactStore();

      const ref1 = makeRef({ keySuffix: "round-1", artifactKind: "file" });
      const ref2 = makeRef({ keySuffix: "round-2", artifactKind: "image" });
      store.register(makeMeta(ref1));
      store.register(makeMeta(ref2));

      const builder = new WorkspaceSnapshotBuilder(ns, store);
      const fragment = await builder.buildFragment();
      const restored = WorkspaceSnapshotBuilder.restoreFragment(fragment);

      expect(restored.artifactRefs.length).toBe(2);
      expect(restored.mountConfigs.length).toBeGreaterThan(0);
    });
  });
});
