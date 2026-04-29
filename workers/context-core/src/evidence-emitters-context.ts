import type {
  AssemblyEvidenceRecord,
  CompactEvidenceRecord,
  EvidenceAnchor,
  SnapshotEvidenceRecord,
} from "@haimang/nacp-core";

interface AssemblyResultEvidenceLike {
  readonly assembled: readonly { readonly kind: string }[];
  readonly orderApplied: readonly string[];
  readonly totalTokens: number;
  readonly truncated: boolean;
}

interface RefEvidenceLike {
  readonly key?: string;
}

interface ContextCompactRequestEvidenceLike {
  readonly history_ref?: RefEvidenceLike;
  readonly target_token_budget: number;
}

interface ContextCompactResponseEvidenceLike {
  readonly tokens_before?: number;
  readonly tokens_after?: number;
  readonly summary_ref?: RefEvidenceLike;
  readonly error?: { readonly code: string; readonly message: string };
}

interface CompactBoundaryRecordEvidenceLike {
  readonly summaryRef?: RefEvidenceLike;
  readonly turnRange: string;
  readonly archivedAt: string;
}

interface WorkspaceSnapshotFragmentEvidenceLike {
  readonly mountConfigs?: readonly unknown[];
  readonly fileIndex?: readonly unknown[];
  readonly artifactRefs?: readonly unknown[];
  readonly contextLayers?: readonly unknown[];
}

/** @deprecated Import `EvidenceAnchor` from `@haimang/nacp-core`. */
export type EvidenceAnchorLike = EvidenceAnchor;

export interface EvidenceSinkLike {
  emit(record: unknown): void | Promise<void>;
}

export interface AssemblyEvidenceInput {
  readonly result: AssemblyResultEvidenceLike;
  readonly consideredKinds?: readonly string[];
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
  for (const kind of assembledKinds) droppedSet.delete(kind);
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

export interface CompactRequestEvidenceInput {
  readonly phase: "request";
  readonly request: ContextCompactRequestEvidenceLike;
}

export interface CompactResponseEvidenceInput {
  readonly phase: "response";
  readonly response: ContextCompactResponseEvidenceLike;
}

export interface CompactBoundaryEvidenceInput {
  readonly phase: "boundary";
  readonly boundary: CompactBoundaryRecordEvidenceLike;
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

export interface SnapshotCaptureEvidenceInput {
  readonly phase: "capture";
  readonly fragment: WorkspaceSnapshotFragmentEvidenceLike;
}

export interface SnapshotRestoreEvidenceInput {
  readonly phase: "restore";
  readonly fragment: WorkspaceSnapshotFragmentEvidenceLike;
  readonly restoreCoverage: number;
  readonly missingFragments?: readonly string[];
}

export type SnapshotEvidenceInput =
  | SnapshotCaptureEvidenceInput
  | SnapshotRestoreEvidenceInput;

function fragmentSummary(fragment: WorkspaceSnapshotFragmentEvidenceLike): {
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
