/**
 * Evidence Signal Types — the unified input vocabulary for storage calibration.
 *
 * Evidence signals are collected by `eval-observability` (or by any
 * runtime helper emitting placement evidence) and consumed by the
 * calibration seam in `calibration.ts`.
 *
 * v1 uses a discriminated union keyed on `kind` so callers and the
 * calibrator can narrow `value` precisely instead of passing
 * `number | string` everywhere:
 *
 *   - `size`                : bytes observed                       → number
 *   - `read-frequency`      : reads per session / per day           → number
 *   - `write-frequency`     : writes per session / per day          → number
 *   - `access-pattern`      : qualitative bucket (`hot-read` …)     → string union
 *   - `resume-hit`          : whether a resume consumed this item   → boolean
 *   - `placement-observation`: the backend actually used at emit    → StorageBackend
 *
 * Reference: `docs/action-plan/storage-topology.md` P1-03 + P4-02.
 */

import type { DataItemClass } from "./data-items.js";
import type { StorageBackend } from "./taxonomy.js";

// ── Evidence Signal Kind ──

export type EvidenceSignalKind =
  | "size"
  | "read-frequency"
  | "write-frequency"
  | "access-pattern"
  | "resume-hit"
  | "placement-observation";

export type AccessPatternValue =
  | "hot-read"
  | "hot-write"
  | "cold-scan"
  | "mixed";

// ── Evidence Signal (discriminated union) ──

interface EvidenceSignalBase {
  readonly dataItem: DataItemClass;
  readonly observedAt: string;
  readonly sessionUuid?: string;
}

export interface SizeEvidenceSignal extends EvidenceSignalBase {
  readonly kind: "size";
  /** Size observed in bytes. */
  readonly value: number;
}

export interface ReadFrequencyEvidenceSignal extends EvidenceSignalBase {
  readonly kind: "read-frequency";
  /** Reads per window (session / day). */
  readonly value: number;
}

export interface WriteFrequencyEvidenceSignal extends EvidenceSignalBase {
  readonly kind: "write-frequency";
  /** Writes per window (session / day). */
  readonly value: number;
}

export interface AccessPatternEvidenceSignal extends EvidenceSignalBase {
  readonly kind: "access-pattern";
  readonly value: AccessPatternValue;
}

export interface ResumeHitEvidenceSignal extends EvidenceSignalBase {
  readonly kind: "resume-hit";
  readonly value: boolean;
}

export interface PlacementObservationSignal extends EvidenceSignalBase {
  readonly kind: "placement-observation";
  /** The storage backend actually used when this evidence was emitted. */
  readonly value: StorageBackend;
}

/**
 * A single observation about a data item's runtime behaviour. Consumers
 * can narrow on `kind` to get a precisely-typed `value`.
 */
export type EvidenceSignal =
  | SizeEvidenceSignal
  | ReadFrequencyEvidenceSignal
  | WriteFrequencyEvidenceSignal
  | AccessPatternEvidenceSignal
  | ResumeHitEvidenceSignal
  | PlacementObservationSignal;

// ── Calibration Hint ──

/**
 * A recommendation produced by the calibration seam after analyzing
 * accumulated evidence signals for a given data item.
 *
 * `suggestedPlacement` is omitted when the recommendation is to maintain
 * the current placement.
 */
export interface CalibrationHint {
  readonly dataItem: DataItemClass;
  readonly currentPlacement: StorageBackend;
  readonly suggestedPlacement?: StorageBackend;
  readonly reason: string;
  readonly confidence: "low" | "medium" | "high";
}
