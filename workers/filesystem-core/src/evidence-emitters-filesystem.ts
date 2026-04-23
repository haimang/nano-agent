import type {
  ArtifactEvidenceRecord,
  ArtifactLifecycleStage,
  EvidenceAnchor,
} from "@haimang/nacp-core";

/** @deprecated Import `EvidenceAnchor` from `@haimang/nacp-core`. */
export type EvidenceAnchorLike = EvidenceAnchor;

export interface EvidenceSinkLike {
  emit(record: unknown): void | Promise<void>;
}

export type { ArtifactLifecycleStage } from "@haimang/nacp-core";

export interface ArtifactEvidenceInput {
  readonly artifactName: string;
  readonly stage: ArtifactLifecycleStage;
  readonly sizeBytes?: number;
  readonly contentType?: string;
  readonly sourceRefKey?: string;
  readonly preparedRefKey?: string;
  readonly archivedRefKey?: string;
  readonly reason?: string;
}

export function buildArtifactEvidence(
  anchor: EvidenceAnchorLike,
  input: ArtifactEvidenceInput,
): ArtifactEvidenceRecord {
  return {
    stream: "artifact" as const,
    anchor,
    ...input,
  };
}

export function emitArtifactEvidence(
  sink: EvidenceSinkLike,
  anchor: EvidenceAnchorLike,
  input: ArtifactEvidenceInput,
): void {
  void sink.emit(buildArtifactEvidence(anchor, input));
}
