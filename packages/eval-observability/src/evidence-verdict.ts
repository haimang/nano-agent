/**
 * @nano-agent/eval-observability — Phase 6 evidence-driven verdicts (A7 Phase 4).
 *
 * Aggregates the five evidence streams (`placement / assembly / compact /
 * artifact / snapshot`) into the four-way calibration verdict
 * vocabulary frozen by AX-QNA Q13.
 *
 * Each P6 hypothesis is encoded as a small `VerdictRule` that:
 *   - filters records relevant to the hypothesis,
 *   - splits each record into `supporting` / `contradictory` / `neutral`,
 *   - feeds the counts into `computeCalibrationVerdict()`.
 *
 * Default rules cover the five "load-bearing" hypotheses we expect P6
 * to track for the first owner-reviewed run:
 *
 *   - `placement.do.hot-anchor`            — DO storage handles hot writes
 *   - `placement.do.write-amp`             — write amplification stays bounded
 *   - `assembly.required-layer-respected`  — required layers are never dropped
 *   - `compact.success-rate`               — compact responses are mostly `ok`
 *   - `snapshot.restore-coverage`          — restores cover ≥ 80% of fragment
 *
 * Reviewers can extend the catalog by passing additional rules to
 * `aggregateEvidenceVerdict()`.
 */

import {
  computeCalibrationVerdict,
  type CalibrationVerdict,
  type CalibrationVerdictOptions,
  type EvidenceRecord,
} from "./evidence-streams.js";

export interface VerdictRule {
  readonly id: string;
  readonly hypothesis: string;
  readonly options?: CalibrationVerdictOptions;
  /**
   * Classify a single record against this rule. Return `null` when the
   * record does not bear on the hypothesis at all (it is neither
   * supporting nor contradictory).
   */
  classify(record: EvidenceRecord): "supporting" | "contradictory" | null;
  /** Optional human note used when verdict ≠ green to guide reviewers. */
  readonly revisitHint?: string;
}

export interface VerdictReport {
  readonly id: string;
  readonly hypothesis: string;
  readonly supporting: number;
  readonly contradictory: number;
  readonly verdict: CalibrationVerdict;
  readonly evidenceCount: number;
  readonly revisitHint?: string;
}

/**
 * Compute one verdict per rule against the supplied records.
 *
 * Records that no rule matches are reported as `unmatchedCount` so the
 * caller can detect new evidence shapes that lack a hypothesis owner.
 */
export interface VerdictAggregateResult {
  readonly verdicts: readonly VerdictReport[];
  readonly unmatchedCount: number;
  readonly recordsConsidered: number;
}

export function aggregateEvidenceVerdict(
  records: readonly EvidenceRecord[],
  rules: readonly VerdictRule[] = DEFAULT_VERDICT_RULES,
): VerdictAggregateResult {
  const reports: VerdictReport[] = [];
  let matchedAtLeastOnce = 0;
  let totalSeen = 0;

  for (const rule of rules) {
    let supporting = 0;
    let contradictory = 0;
    let evidenceCount = 0;
    for (const record of records) {
      const c = rule.classify(record);
      if (c === null) continue;
      evidenceCount += 1;
      if (c === "supporting") supporting += 1;
      else contradictory += 1;
    }
    reports.push({
      id: rule.id,
      hypothesis: rule.hypothesis,
      supporting,
      contradictory,
      evidenceCount,
      verdict: computeCalibrationVerdict(
        { supporting, contradictory },
        rule.options,
      ),
      revisitHint: rule.revisitHint,
    });
  }

  for (const record of records) {
    totalSeen += 1;
    if (rules.some((rule) => rule.classify(record) !== null)) {
      matchedAtLeastOnce += 1;
    }
  }

  return {
    verdicts: reports,
    unmatchedCount: Math.max(0, totalSeen - matchedAtLeastOnce),
    recordsConsidered: totalSeen,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Default rule catalog
// ─────────────────────────────────────────────────────────────────────

/** Bytes above which a single placement write is treated as contradictory for write-amp. */
const PLACEMENT_WRITE_AMP_BYTES = 1_000_000;
/** Threshold below which a restore is treated as inadequate. */
const RESTORE_COVERAGE_THRESHOLD = 0.8;

export const DEFAULT_VERDICT_RULES: readonly VerdictRule[] = [
  {
    id: "placement.do.hot-anchor",
    hypothesis:
      "DO storage is the correct hot anchor for trace timeline writes",
    revisitHint:
      "Reconsider only after a contradicting placement reaches DO failure or sustained latency.",
    classify(record) {
      if (record.stream !== "placement") return null;
      if (record.dataItem !== "trace.timeline") return null;
      if (record.backend !== "do-storage") return "contradictory";
      return record.outcome === "ok" ? "supporting" : "contradictory";
    },
  },
  {
    id: "placement.do.write-amp",
    hypothesis: "DO storage write amplification stays bounded per flush",
    revisitHint: `Investigate if any write exceeds ${PLACEMENT_WRITE_AMP_BYTES} bytes — that is the A2 substrate watch threshold.`,
    classify(record) {
      if (record.stream !== "placement") return null;
      if (record.op !== "write") return null;
      if (record.sizeBytes === undefined) return null;
      return record.sizeBytes <= PLACEMENT_WRITE_AMP_BYTES
        ? "supporting"
        : "contradictory";
    },
  },
  {
    id: "assembly.required-layer-respected",
    hypothesis:
      "Required context layers are never dropped by the assembler's budget pass",
    classify(record) {
      if (record.stream !== "assembly") return null;
      return record.requiredLayerBudgetViolation === true
        ? "contradictory"
        : "supporting";
    },
  },
  {
    id: "compact.success-rate",
    hypothesis:
      "Compact responses succeed for the configured token budget without falling back to error",
    classify(record) {
      if (record.stream !== "compact") return null;
      if (record.phase === "error") return "contradictory";
      if (record.phase === "response") {
        return record.errorCode ? "contradictory" : "supporting";
      }
      return null;
    },
  },
  {
    id: "snapshot.restore-coverage",
    hypothesis:
      "Restore covers at least 80% of the captured workspace fragment",
    revisitHint: `If coverage drops below ${RESTORE_COVERAGE_THRESHOLD * 100}% the snapshot model needs revisiting.`,
    classify(record) {
      if (record.stream !== "snapshot") return null;
      if (record.phase !== "restore") return null;
      const coverage = record.restoreCoverage;
      if (coverage === undefined) return null;
      return coverage >= RESTORE_COVERAGE_THRESHOLD
        ? "supporting"
        : "contradictory";
    },
  },
] as const;
