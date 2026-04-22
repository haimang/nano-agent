/**
 * Workspace Context Artifacts — A7 Phase 3 evidence emitters.
 *
 * Lightweight helpers that map the natural result objects of
 * `ContextAssembler.assemble()`, `CompactBoundaryManager`,
 * artifact promotion, and `WorkspaceSnapshotBuilder` into typed P6
 * evidence records.
 *
 * The package keeps zero runtime dependency on `eval-observability` —
 * the helpers accept a duck-typed `EvidenceSink` (`{ emit(record) }`)
 * and a typed-but-structural `EvidenceAnchor`. This keeps the
 * workspace-context-artifacts package buildable without `eval-observability`
 * in its dependency graph.
 */

import type {
  ArtifactEvidenceRecord,
  ArtifactLifecycleStage,
  AssemblyEvidenceRecord,
  CompactEvidencePhase,
  CompactEvidenceRecord,
  EvidenceAnchor,
  SnapshotEvidenceRecord,
} from "@nano-agent/nacp-core";
export type {
  ArtifactLifecycleStage,
  CompactEvidencePhase,
} from "@nano-agent/nacp-core";
import type { AssemblyResult } from "./context-assembler.js";
import type { ContextCompactRequestBody, ContextCompactResponseBody } from "./compact-boundary.js";
import type { CompactBoundaryRecord, WorkspaceSnapshotFragment } from "./snapshot.js";

// ─────────────────────────────────────────────────────────────────────
// Structural aliases
// ─────────────────────────────────────────────────────────────────────

/** @deprecated Import `EvidenceAnchor` from `@nano-agent/nacp-core`. */
export type EvidenceAnchorLike = EvidenceAnchor;

export interface EvidenceSinkLike {
  emit(record: unknown): void | Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Assembly evidence
// ─────────────────────────────────────────────────────────────────────

export interface AssemblyEvidenceInput {
  readonly result: AssemblyResult;
  /**
   * The kinds the caller asked the assembler to consider before any
   * truncation. The helper computes `dropped = considered − assembled`.
   */
  readonly consideredKinds?: readonly string[];
  /** True when a `required` layer had to be evicted (budget violation). */
  readonly requiredLayerBudgetViolation?: boolean;
  readonly preparedArtifactsUsed?: number;
  readonly dropReason?: string;
}

export function buildAssemblyEvidence(
  anchor: EvidenceAnchorLike,
  input: AssemblyEvidenceInput,
): AssemblyEvidenceRecord {
  const assembledKinds = input.result.assembled.map((l) => l.kind);
  const consideredKinds = input.consideredKinds ?? assembledKinds;
  const droppedSet = new Set(consideredKinds);
  for (const k of assembledKinds) droppedSet.delete(k);
  return {
    stream: "assembly" as const,
    anchor,
    assembledKinds,
    droppedOptionalKinds: [...droppedSet],
    orderApplied: [...input.result.orderApplied],
    totalTokens: input.result.totalTokens,
    truncated: input.result.truncated,
    requiredLayerBudgetViolation: input.requiredLayerBudgetViolation,
    preparedArtifactsUsed: input.preparedArtifactsUsed,
    dropReason: input.dropReason,
  };
}

export function emitAssemblyEvidence(
  sink: EvidenceSinkLike,
  anchor: EvidenceAnchorLike,
  input: AssemblyEvidenceInput,
): void {
  void sink.emit(buildAssemblyEvidence(anchor, input));
}

// ─────────────────────────────────────────────────────────────────────
// Compact evidence
// ─────────────────────────────────────────────────────────────────────

export interface CompactRequestEvidenceInput {
  readonly phase: "request";
  readonly request: ContextCompactRequestBody;
}

export interface CompactResponseEvidenceInput {
  readonly phase: "response";
  readonly response: ContextCompactResponseBody;
}

export interface CompactBoundaryEvidenceInput {
  readonly phase: "boundary";
  readonly boundary: CompactBoundaryRecord;
}

export interface CompactErrorEvidenceInput {
  readonly phase: "error";
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly targetTokenBudget?: number;
}

export type CompactEvidenceInput =
  | CompactRequestEvidenceInput
  | CompactResponseEvidenceInput
  | CompactBoundaryEvidenceInput
  | CompactErrorEvidenceInput;

export function buildCompactEvidence(
  anchor: EvidenceAnchorLike,
  input: CompactEvidenceInput,
): CompactEvidenceRecord {
  switch (input.phase) {
    case "request":
      return {
        stream: "compact" as const,
        anchor,
        phase: "request",
        targetTokenBudget: input.request.target_token_budget,
        historyRefKey: input.request.history_ref?.key as string | undefined,
      };
    case "response":
      return {
        stream: "compact" as const,
        anchor,
        phase: "response",
        tokensBefore: input.response.tokens_before,
        tokensAfter: input.response.tokens_after,
        summaryRefKey: input.response.summary_ref?.key as string | undefined,
        errorCode: input.response.error?.code,
        errorMessage: input.response.error?.message,
      };
    case "boundary":
      return {
        stream: "compact" as const,
        anchor,
        phase: "boundary",
        // CompactBoundaryRecord is `{ turnRange, summaryRef, archivedAt }`.
        // The verdict pipeline only needs the summary ref + a textual
        // turnRange marker — both go into the structured evidence so
        // reviewers can correlate the boundary with its archived chunk.
        summaryRefKey: input.boundary.summaryRef?.key as string | undefined,
        turnRange: input.boundary.turnRange,
        archivedAt: input.boundary.archivedAt,
      };
    case "error":
      return {
        stream: "compact" as const,
        anchor,
        phase: "error",
        targetTokenBudget: input.targetTokenBudget,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
      };
  }
}

export function emitCompactEvidence(
  sink: EvidenceSinkLike,
  anchor: EvidenceAnchorLike,
  input: CompactEvidenceInput,
): void {
  void sink.emit(buildCompactEvidence(anchor, input));
}

// ─────────────────────────────────────────────────────────────────────
// Artifact lifecycle evidence
// ─────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────
// Snapshot / restore evidence
// ─────────────────────────────────────────────────────────────────────

export interface SnapshotCaptureEvidenceInput {
  readonly phase: "capture";
  readonly fragment: WorkspaceSnapshotFragment;
}

export interface SnapshotRestoreEvidenceInput {
  readonly phase: "restore";
  readonly fragment: WorkspaceSnapshotFragment;
  /** 0..1 portion of fragment that was successfully re-applied. */
  readonly restoreCoverage: number;
  readonly missingFragments?: readonly string[];
}

export type SnapshotEvidenceInput =
  | SnapshotCaptureEvidenceInput
  | SnapshotRestoreEvidenceInput;

function fragmentSummary(fragment: WorkspaceSnapshotFragment): {
  mountCount: number;
  fileIndexCount: number;
  artifactRefCount: number;
  contextLayerCount: number;
} {
  return {
    mountCount: (fragment.mountConfigs ?? []).length,
    fileIndexCount: (fragment.fileIndex ?? []).length,
    artifactRefCount: (fragment.artifactRefs ?? []).length,
    contextLayerCount: (fragment.contextLayers ?? []).length,
  };
}

export function buildSnapshotEvidence(
  anchor: EvidenceAnchorLike,
  input: SnapshotEvidenceInput,
): SnapshotEvidenceRecord {
  const summary = fragmentSummary(input.fragment);
  if (input.phase === "capture") {
    return {
      stream: "snapshot" as const,
      anchor,
      phase: "capture",
      ...summary,
    };
  }
  return {
    stream: "snapshot" as const,
    anchor,
    phase: "restore",
    ...summary,
    restoreCoverage: input.restoreCoverage,
    missingFragments: input.missingFragments
      ? [...input.missingFragments]
      : undefined,
  };
}

export function emitSnapshotEvidence(
  sink: EvidenceSinkLike,
  anchor: EvidenceAnchorLike,
  input: SnapshotEvidenceInput,
): void {
  void sink.emit(buildSnapshotEvidence(anchor, input));
}
