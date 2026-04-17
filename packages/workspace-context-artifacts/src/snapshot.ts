/**
 * Workspace Context Artifacts — Snapshot Types & Builder
 *
 * `WorkspaceSnapshotFragment` captures the workspace/context fragment
 * owned by this package at a point in time. `WorkspaceSnapshotBuilder`
 * extracts the fragment by actually reading the namespace + artifact
 * store, rather than returning empty arrays.
 */

import { z } from "zod";
import { MountConfigSchema, WorkspaceFileEntrySchema } from "./types.js";
import type { MountConfig, WorkspaceFileEntry } from "./types.js";
import { ArtifactRefSchema } from "./refs.js";
import type { ArtifactRef } from "./refs.js";
import { ContextLayerSchema } from "./context-layers.js";
import type { ContextLayer } from "./context-layers.js";
import type { WorkspaceNamespace } from "./namespace.js";
import type { ArtifactStore } from "./artifacts.js";
import { WORKSPACE_VERSION } from "./version.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Workspace Snapshot Fragment
// ═══════════════════════════════════════════════════════════════════

export const WorkspaceSnapshotFragmentSchema = z.object({
  version: z.string(),
  mountConfigs: z.array(MountConfigSchema),
  fileIndex: z.array(WorkspaceFileEntrySchema),
  artifactRefs: z.array(ArtifactRefSchema),
  contextLayers: z.array(ContextLayerSchema),
  createdAt: z.string(),
});
export type WorkspaceSnapshotFragment = z.infer<typeof WorkspaceSnapshotFragmentSchema>;

// ═══════════════════════════════════════════════════════════════════
// §2 — Compact Boundary Record
// ═══════════════════════════════════════════════════════════════════

export const CompactBoundaryRecordSchema = z.object({
  turnRange: z.string(),
  summaryRef: ArtifactRefSchema,
  archivedAt: z.string(),
});
export type CompactBoundaryRecord = z.infer<typeof CompactBoundaryRecordSchema>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Workspace Snapshot Builder
// ═══════════════════════════════════════════════════════════════════

/** Options accepted by `buildFragment()`. */
export interface BuildFragmentOptions {
  /**
   * Optional context layers to embed in the fragment. Context layers
   * are assembled by the caller (e.g. `ContextAssembler`) — the
   * snapshot builder never synthesises them on its own.
   */
  readonly contextLayers?: readonly ContextLayer[];
  /**
   * Maximum file-index size (number of entries). When the namespace
   * contains more files, the builder still returns a valid fragment
   * but truncates the index at this limit to avoid pathological
   * snapshots. Defaults to 10_000.
   */
  readonly maxFileIndexSize?: number;
}

export class WorkspaceSnapshotBuilder {
  constructor(
    private namespace: WorkspaceNamespace,
    private artifactStore: ArtifactStore,
  ) {}

  /**
   * Build a snapshot fragment from the current workspace state.
   *
   * The builder now ACTUALLY consumes the namespace:
   *   - `namespace.listMounts()` → `mountConfigs`
   *   - `namespace.listDir("/")` on each mount → `fileIndex`
   *   - `artifactStore.list()` → `artifactRefs`
   *   - caller-supplied `options.contextLayers` → `contextLayers`
   *
   * Only `ArtifactRef` values that parse under `ArtifactRefSchema` are
   * included, so a malformed store entry cannot poison the snapshot.
   */
  async buildFragment(options: BuildFragmentOptions = {}): Promise<WorkspaceSnapshotFragment> {
    const mountConfigs = this.collectMountConfigs();
    const fileIndex = await this.collectFileIndex(options.maxFileIndexSize ?? 10_000);

    const artifactRefs: ArtifactRef[] = [];
    for (const meta of this.artifactStore.list()) {
      const parsed = ArtifactRefSchema.safeParse(meta.ref);
      if (parsed.success) artifactRefs.push(parsed.data);
    }

    return {
      version: WORKSPACE_VERSION,
      mountConfigs,
      fileIndex,
      artifactRefs,
      contextLayers: [...(options.contextLayers ?? [])],
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Restore what the builder actually owns: mount configs, artifact
   * refs, context layers and the file index. The caller wires mount
   * configs back into its namespace builder and re-registers artifacts
   * in its store.
   */
  static restoreFragment(fragment: WorkspaceSnapshotFragment): {
    mountConfigs: MountConfig[];
    artifactRefs: ArtifactRef[];
    fileIndex: WorkspaceFileEntry[];
    contextLayers: ContextLayer[];
  } {
    return {
      mountConfigs: fragment.mountConfigs,
      artifactRefs: fragment.artifactRefs,
      fileIndex: fragment.fileIndex,
      contextLayers: fragment.contextLayers,
    };
  }

  // ── Internal helpers ──

  private collectMountConfigs(): MountConfig[] {
    const namespaceAny = this.namespace as unknown as {
      listMounts?: () => MountConfig[];
    };
    if (typeof namespaceAny.listMounts === "function") {
      return [...namespaceAny.listMounts()];
    }
    return [];
  }

  /**
   * Walk each mount's root and emit a `WorkspaceFileEntry` per file.
   * Respects `maxEntries` so the snapshot stays bounded; if the limit
   * is hit, no error is thrown — the index is simply truncated.
   */
  private async collectFileIndex(maxEntries: number): Promise<WorkspaceFileEntry[]> {
    const namespaceAny = this.namespace as unknown as {
      listMounts?: () => MountConfig[];
      listDir?: (path: string) => Promise<WorkspaceFileEntry[]>;
    };
    if (
      typeof namespaceAny.listMounts !== "function" ||
      typeof namespaceAny.listDir !== "function"
    ) {
      return [];
    }

    const mounts = namespaceAny.listMounts();
    const out: WorkspaceFileEntry[] = [];

    for (const mount of mounts) {
      try {
        const entries = await namespaceAny.listDir(mount.mountPoint);
        for (const entry of entries) {
          if (out.length >= maxEntries) return out;
          out.push(entry);
        }
      } catch {
        // A mount that refuses listDir should not poison the whole
        // snapshot — we skip it silently and continue with others.
      }
    }

    return out;
  }
}
