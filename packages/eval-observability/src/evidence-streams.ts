/**
 * @nano-agent/eval-observability — Phase 6 evidence streams (A7 Phase 1).
 *
 * Freezes the **five** evidence streams P6 governance expects:
 *
 *   1. `placement`  — which storage tier a data item actually landed in
 *   2. `assembly`   — how the context assembler produced its result
 *   3. `compact`    — request / response / boundary for compaction
 *   4. `artifact`   — inline → promoted → prepared → archived transitions
 *   5. `snapshot`   — what a checkpoint captured and what a restore recovered
 *
 * Every stream carries the trace-first carriers already frozen by A3
 * (`traceUuid`, `sessionUuid`, `teamUuid`, `sourceRole`) so P6 evidence
 * is automatically connectable to the A2 storage substrate, A4 session
 * edge, and A6 verdict bundle.
 *
 * Ownership contract (A7 P1-02):
 *   - `eval-observability` owns the **vocabulary** (the shapes below) and
 *     the **sink** (`EvidenceEmitter`).
 *   - The owner of each live emitter is the package where the business
 *     action happens: storage-topology + session-do-runtime for
 *     `placement`, workspace-context-artifacts for `assembly` /
 *     `compact` / `artifact` / `snapshot`, and session-do-runtime for
 *     snapshot / restore lifecycle evidence.
 *
 * Verdict contract (A7 P1-03):
 *   - Every P6 judgement uses the four-way verdict language
 *     `provisional / evidence-backed / needs-revisit /
 *     contradicted-by-evidence` (AX-QNA Q13). This language is
 *     permanently separate from PX capability maturity grades
 *     (AX-QNA Q14).
 */

import type { TraceSourceRole } from "./types.js";

// ─────────────────────────────────────────────────────────────────────
// Evidence anchor shared by every stream
// ─────────────────────────────────────────────────────────────────────

/**
 * Trace + tenant carrier that every evidence record threads. Without
 * this anchor the event is not P6-eligible — it belongs to diagnostic
 * logs instead.
 */
export interface EvidenceAnchor {
  readonly traceUuid: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly sourceRole: TraceSourceRole;
  readonly sourceKey?: string;
  readonly turnUuid?: string;
  readonly timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────
// Stream 1 — placement
// ─────────────────────────────────────────────────────────────────────

export type EvidenceStorageBackend =
  | "do-storage"
  | "r2"
  | "kv"
  | "d1"
  | "queue-dlq"
  | "isolate-memory";

export type EvidenceStorageOp =
  | "read"
  | "write"
  | "delete"
  | "list"
  | "promote"
  | "demote";

export interface PlacementEvidence {
  readonly stream: "placement";
  readonly anchor: EvidenceAnchor;
  readonly dataItem: string;
  readonly backend: EvidenceStorageBackend;
  readonly op: EvidenceStorageOp;
  readonly key?: string;
  readonly sizeBytes?: number;
  readonly durationMs?: number;
  readonly outcome: "ok" | "failed";
  readonly note?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Stream 2 — assembly
// ─────────────────────────────────────────────────────────────────────

export interface AssemblyEvidence {
  readonly stream: "assembly";
  readonly anchor: EvidenceAnchor;
  /** Layer kinds that ended up in the assembled bundle, in order. */
  readonly assembledKinds: readonly string[];
  /** Layer kinds that were dropped to fit the budget. */
  readonly droppedOptionalKinds: readonly string[];
  /** Order the assembler actually applied (config or canonical). */
  readonly orderApplied: readonly string[];
  readonly totalTokens: number;
  readonly truncated: boolean;
  readonly requiredLayerBudgetViolation?: boolean;
  readonly preparedArtifactsUsed?: number;
  readonly dropReason?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Stream 3 — compact
// ─────────────────────────────────────────────────────────────────────

export type CompactPhase = "request" | "response" | "boundary" | "error";

export interface CompactEvidence {
  readonly stream: "compact";
  readonly anchor: EvidenceAnchor;
  readonly phase: CompactPhase;
  readonly targetTokenBudget?: number;
  readonly tokensBefore?: number;
  readonly tokensAfter?: number;
  readonly boundaryIndex?: number;
  readonly historyRefKey?: string;
  readonly summaryRefKey?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly reinjectedTokens?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Stream 4 — artifact lifecycle
// ─────────────────────────────────────────────────────────────────────

export type ArtifactLifecycleStage =
  | "inline"
  | "promoted"
  | "prepared"
  | "archived"
  | "replaced";

export interface ArtifactEvidence {
  readonly stream: "artifact";
  readonly anchor: EvidenceAnchor;
  readonly artifactName: string;
  readonly stage: ArtifactLifecycleStage;
  readonly sizeBytes?: number;
  readonly contentType?: string;
  readonly sourceRefKey?: string;
  readonly preparedRefKey?: string;
  readonly archivedRefKey?: string;
  readonly reason?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Stream 5 — snapshot / restore
// ─────────────────────────────────────────────────────────────────────

export type SnapshotPhase = "capture" | "restore";

export interface SnapshotEvidence {
  readonly stream: "snapshot";
  readonly anchor: EvidenceAnchor;
  readonly phase: SnapshotPhase;
  readonly mountCount?: number;
  readonly fileIndexCount?: number;
  readonly artifactRefCount?: number;
  readonly contextLayerCount?: number;
  readonly restoreCoverage?: number;
  readonly missingFragments?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────
// Discriminated union + typed emitter
// ─────────────────────────────────────────────────────────────────────

export type EvidenceRecord =
  | PlacementEvidence
  | AssemblyEvidence
  | CompactEvidence
  | ArtifactEvidence
  | SnapshotEvidence;

export type EvidenceStream = EvidenceRecord["stream"];

/**
 * Minimal sink interface every emitter speaks. Deployed builds may
 * attach richer sinks (DO storage, R2 mirror, bundle writer); tests
 * attach an in-memory recorder.
 */
export interface EvidenceSink {
  emit(record: EvidenceRecord): void | Promise<void>;
}

/** In-memory recorder useful for tests and the A6 verdict bundle. */
export class EvidenceRecorder implements EvidenceSink {
  private readonly records: EvidenceRecord[] = [];

  emit(record: EvidenceRecord): void {
    this.records.push(record);
  }

  all(): readonly EvidenceRecord[] {
    return this.records.slice();
  }

  ofStream<S extends EvidenceStream>(
    stream: S,
  ): readonly Extract<EvidenceRecord, { stream: S }>[] {
    return this.records.filter(
      (r): r is Extract<EvidenceRecord, { stream: S }> => r.stream === stream,
    );
  }

  count(): number {
    return this.records.length;
  }

  /** Clear the recorder so a single test can chain multiple scenarios. */
  reset(): void {
    this.records.length = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Verdict contract (AX-QNA Q13 + Q14)
// ─────────────────────────────────────────────────────────────────────

/**
 * Four-way calibration verdict. `evidence-backed` requires at least
 * three independent supporting signals (see AX-QNA Q13). The verdict
 * language is permanently separate from PX capability maturity grades
 * (Q14) — consumers SHOULD label the first occurrence of either name in
 * any prose they render.
 */
export type CalibrationVerdict =
  | "provisional"
  | "evidence-backed"
  | "needs-revisit"
  | "contradicted-by-evidence";

export const CALIBRATION_VERDICTS: readonly CalibrationVerdict[] = [
  "provisional",
  "evidence-backed",
  "needs-revisit",
  "contradicted-by-evidence",
];

/**
 * Minimum evidence count required to leave the `provisional` state.
 * Callers can override to tighten the rule per hypothesis.
 */
export const DEFAULT_EVIDENCE_BACKED_MIN_SIGNALS = 3;
/** How many contradictory signals push a hypothesis to `needs-revisit`. */
export const DEFAULT_NEEDS_REVISIT_MIN_CONTRADICTORY = 1;
/** How many contradictory signals finalise `contradicted-by-evidence`. */
export const DEFAULT_CONTRADICTED_MIN_CONTRADICTORY = 5;

export interface VerdictSignalSummary {
  readonly supporting: number;
  readonly contradictory: number;
}

export interface CalibrationVerdictOptions {
  readonly evidenceBackedMinSignals?: number;
  readonly needsRevisitMinContradictory?: number;
  readonly contradictedMinContradictory?: number;
}

/**
 * Compute a calibration verdict from supporting vs contradictory
 * signal counts. The rules (Q13):
 *
 *   - contradictory ≥ `contradictedMin`              → contradicted-by-evidence
 *   - supporting     ≥ `evidenceBackedMin`
 *     AND contradictory ≤ `needsRevisitMin - 1`     → evidence-backed
 *   - contradictory ≥ `needsRevisitMin`              → needs-revisit
 *   - otherwise                                      → provisional
 */
export function computeCalibrationVerdict(
  summary: VerdictSignalSummary,
  options: CalibrationVerdictOptions = {},
): CalibrationVerdict {
  const evidenceBackedMin =
    options.evidenceBackedMinSignals ?? DEFAULT_EVIDENCE_BACKED_MIN_SIGNALS;
  const needsRevisitMin =
    options.needsRevisitMinContradictory ??
    DEFAULT_NEEDS_REVISIT_MIN_CONTRADICTORY;
  const contradictedMin =
    options.contradictedMinContradictory ??
    DEFAULT_CONTRADICTED_MIN_CONTRADICTORY;

  if (summary.contradictory >= contradictedMin) {
    return "contradicted-by-evidence";
  }
  if (summary.contradictory >= needsRevisitMin) {
    // A6-A7 review Kimi R2: AX-QNA Q13 treats any `contradictory >=
    // needsRevisitMin` as a reason to revisit, regardless of how many
    // supporting records exist — mixed evidence is still ambiguous
    // evidence. The previous ternary branched on `supporting` but
    // produced the same literal on both sides, which reviewers read as
    // hidden logic. Collapsed to a single return.
    return "needs-revisit";
  }
  if (summary.supporting >= evidenceBackedMin) {
    return "evidence-backed";
  }
  return "provisional";
}
