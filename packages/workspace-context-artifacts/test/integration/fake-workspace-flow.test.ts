/**
 * Integration — fake end-to-end workspace flow.
 *
 * Verifies that the full loop works with NacpRef-aligned refs:
 *   1. Mount a writable `/` mount backed by the memory backend.
 *   2. Promote a tool-output string into an artifact, register it in
 *      the store, and confirm the produced ref parses under the real
 *      `NacpRefSchema` from `@nano-agent/nacp-core`.
 *   3. Read/write files through the namespace; list mounts.
 *   4. Build a snapshot fragment — mount configs, file index and
 *      artifact refs are all populated (no more empty arrays).
 */

import { describe, it, expect } from "vitest";
import { NacpRefSchema } from "../../../nacp-core/src/envelope.js";
import { MountRouter } from "../../src/mounts.js";
import { WorkspaceNamespace } from "../../src/namespace.js";
import { MemoryBackend } from "../../src/backends/memory.js";
import { InMemoryArtifactStore } from "../../src/artifacts.js";
import {
  ArtifactRefSchema,
  toNacpRef,
} from "../../src/refs.js";
import {
  DEFAULT_PROMOTION_POLICY,
  promoteToArtifactRef,
  shouldPromoteResult,
} from "../../src/promotion.js";
import { WorkspaceSnapshotBuilder } from "../../src/snapshot.js";
import type { ArtifactMetadata } from "../../src/artifacts.js";

function wp(path: string) {
  return path as import("../../src/paths.js").WorkspacePath;
}

describe("integration: fake workspace flow", () => {
  it("promotes tool output → NacpRef-valid artifact → registered → visible in snapshot", async () => {
    // 1. Workspace wiring
    const router = new MountRouter();
    router.addMount(
      { mountPoint: "/", backend: "memory", access: "writable" },
      new MemoryBackend(),
    );
    const ns = new WorkspaceNamespace(router);
    const store = new InMemoryArtifactStore();

    // 2. Promote a tool result that triggers the size threshold.
    const largeContent = "x".repeat(DEFAULT_PROMOTION_POLICY.maxInlineBytes + 100);
    const decision = shouldPromoteResult(largeContent, "text/plain");
    expect(decision.promote).toBe(true);

    const ref = promoteToArtifactRef("team-1", largeContent, "text/plain", "file");
    expect(ArtifactRefSchema.safeParse(ref).success).toBe(true);
    expect(NacpRefSchema.safeParse(toNacpRef(ref)).success).toBe(true);
    expect(ref.key.startsWith("tenants/team-1/")).toBe(true);

    const meta: ArtifactMetadata = {
      ref,
      audience: "client-visible",
      previewText: "hello",
      createdAt: "2026-04-17T00:00:00.000Z",
    };
    store.register(meta);

    // 3. Write + read a real file through the namespace.
    await ns.writeFile(wp("/notes.md"), "hello world");
    const read = await ns.readFile(wp("/notes.md"));
    expect(read).toBe("hello world");

    // 4. Snapshot should include mounts + files + artifact refs.
    const builder = new WorkspaceSnapshotBuilder(ns, store);
    const fragment = await builder.buildFragment();

    expect(fragment.mountConfigs.map((m) => m.mountPoint)).toEqual(["/"]);
    expect(fragment.fileIndex.some((e) => e.path.endsWith("notes.md"))).toBe(true);
    expect(fragment.artifactRefs).toHaveLength(1);
    expect(fragment.artifactRefs[0].key).toBe(ref.key);
  });
});
