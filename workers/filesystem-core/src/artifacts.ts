/**
 * Workspace Context Artifacts — Artifact Registry & Store
 *
 * Provides an in-memory artifact store that tracks metadata
 * for all registered artifacts, supporting lookup by key and
 * filtering by artifact kind.
 */

import type { ArtifactRef, ArtifactKind } from "./refs.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Artifact Metadata
// ═══════════════════════════════════════════════════════════════════

export interface ArtifactMetadata {
  readonly ref: ArtifactRef;
  readonly audience: "internal" | "client-visible";
  readonly previewText?: string;
  readonly preparedState?: "pending" | "ready" | "failed";
  readonly createdAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Artifact Store Interface
// ═══════════════════════════════════════════════════════════════════

export interface ArtifactStore {
  register(meta: ArtifactMetadata): void;
  get(key: string): ArtifactMetadata | undefined;
  list(): ArtifactMetadata[];
  listByKind(kind: ArtifactKind): ArtifactMetadata[];
}

// ═══════════════════════════════════════════════════════════════════
// §3 — InMemoryArtifactStore
// ═══════════════════════════════════════════════════════════════════

export class InMemoryArtifactStore implements ArtifactStore {
  private artifacts: Map<string, ArtifactMetadata> = new Map();

  register(meta: ArtifactMetadata): void {
    this.artifacts.set(meta.ref.key, meta);
  }

  get(key: string): ArtifactMetadata | undefined {
    return this.artifacts.get(key);
  }

  list(): ArtifactMetadata[] {
    return Array.from(this.artifacts.values());
  }

  listByKind(kind: ArtifactKind): ArtifactMetadata[] {
    // `ref.kind` is now the NacpRef backend (`r2`/`kv`/`do-storage`/…);
    // artifact-level classification lives on `ref.artifactKind`.
    return Array.from(this.artifacts.values()).filter(
      (meta) => meta.ref.artifactKind === kind,
    );
  }
}
