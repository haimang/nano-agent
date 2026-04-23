/**
 * Storage Topology — Evidence Calibration Seam.
 *
 * Evaluates accumulated evidence signals against a placement hypothesis
 * and produces a calibration recommendation. This is the decision point
 * where provisional placements are either confirmed, flagged for
 * threshold adjustment, or recommended for full placement change.
 *
 * Thresholds (e.g. the 1MB DO-storage demote floor) are PROVISIONAL
 * hypotheses — not frozen truth. `evaluateEvidence(..., options)` lets
 * callers override the current recommendation input; the default
 * preserves backward compatibility with existing consumers.
 *
 * v1 also adapts `@nano-agent/eval-observability`'s `StoragePlacementLog`
 * entries into `EvidenceSignal[]` via `placementLogToEvidence()`, so
 * the runtime evidence flow closes without the calibrator having to
 * import `eval-observability` directly.
 */

import type { DataItemClass } from "./data-items.js";
import type { AccessPatternValue, EvidenceSignal } from "./evidence.js";
import type { PlacementHypothesis } from "./placement.js";
import type { StorageBackend } from "./taxonomy.js";

/** Default — PROVISIONAL — size threshold (bytes) to consider demotion from DO. */
export const DEFAULT_DO_SIZE_THRESHOLD_BYTES = 1_000_000;

/** Default high-confidence minimum signal count. */
export const DEFAULT_HIGH_CONFIDENCE_MIN_SIGNALS = 10;

/** Default medium-confidence minimum signal count. */
export const DEFAULT_MEDIUM_CONFIDENCE_MIN_SIGNALS = 3;

/** Default write-frequency cut-off for "adjust-threshold" recommendations. */
export const DEFAULT_HIGH_WRITE_FREQUENCY = 1000;

/** Tunable knobs for a calibration pass. All fields optional. */
export interface CalibrationOptions {
  /** Bytes above which a DO-storage item becomes a demotion candidate. */
  readonly doSizeThresholdBytes?: number;
  /** Minimum signals to reach high-confidence recommendations. */
  readonly highConfidenceMinSignals?: number;
  /** Minimum signals to reach medium-confidence recommendations. */
  readonly mediumConfidenceMinSignals?: number;
  /** Write-frequency cut-off that suggests tuning compaction / archive. */
  readonly highWriteFrequency?: number;
}

/**
 * A calibration recommendation for a single data item.
 *
 * `suggestedBackend` is set whenever `action === "change-placement"`.
 * `revisitContext` surfaces the triggering evidence summary so the
 * caller can attach it to audit logs / dashboards.
 */
export interface CalibrationRecommendation {
  readonly dataItem: DataItemClass;
  readonly currentBackend: StorageBackend;
  readonly action: "maintain" | "adjust-threshold" | "change-placement";
  readonly reason: string;
  readonly confidence: "low" | "medium" | "high";
  readonly suggestedBackend?: StorageBackend;
  readonly revisitContext: {
    readonly signalCount: number;
    readonly maxSize?: number;
    readonly maxWriteFrequency?: number;
    readonly accessPattern?: AccessPatternValue;
    readonly thresholdBytes: number;
  };
}

/**
 * Evaluate accumulated evidence signals against a placement hypothesis.
 */
export function evaluateEvidence(
  signals: readonly EvidenceSignal[],
  currentPlacement: PlacementHypothesis,
  options: CalibrationOptions = {},
): CalibrationRecommendation {
  const dataItem = currentPlacement.dataItem;
  const currentBackend = currentPlacement.storageBackend;
  const doSizeThreshold = options.doSizeThresholdBytes ?? DEFAULT_DO_SIZE_THRESHOLD_BYTES;

  if (signals.length === 0) {
    return {
      dataItem,
      currentBackend,
      action: "maintain",
      reason: "No evidence signals collected — maintaining provisional placement.",
      confidence: "low",
      revisitContext: { signalCount: 0, thresholdBytes: doSizeThreshold },
    };
  }

  const confidence = determineConfidence(signals.length, options);

  // ── Size → possible demotion ──
  const sizeSignals = signals.filter(isSize);
  const maxSize = sizeSignals.length > 0 ? Math.max(...sizeSignals.map((s) => s.value)) : undefined;
  if (currentBackend === "do-storage" && maxSize !== undefined && maxSize > doSizeThreshold) {
    return {
      dataItem,
      currentBackend,
      action: "change-placement",
      suggestedBackend: "r2",
      reason:
        `Observed size ${maxSize} bytes exceeds DO-storage threshold of ` +
        `${doSizeThreshold} bytes. Consider demotion to R2.`,
      confidence,
      revisitContext: { signalCount: signals.length, maxSize, thresholdBytes: doSizeThreshold },
    };
  }

  // ── Access pattern → possible promotion ──
  const accessPatternSignals = signals.filter(isAccessPattern);
  const hotReadSeen = accessPatternSignals.some((s) => s.value === "hot-read");
  if (hotReadSeen && currentBackend === "r2") {
    return {
      dataItem,
      currentBackend,
      action: "change-placement",
      suggestedBackend: "do-storage",
      reason:
        "Hot-read access pattern detected on cold-tier item. Consider promotion to DO storage.",
      confidence,
      revisitContext: {
        signalCount: signals.length,
        accessPattern: "hot-read",
        thresholdBytes: doSizeThreshold,
      },
    };
  }

  // ── Write frequency → possible threshold adjustment ──
  const writeFrequencySignals = signals.filter(isWriteFrequency);
  const maxWrites =
    writeFrequencySignals.length > 0
      ? Math.max(...writeFrequencySignals.map((s) => s.value))
      : undefined;
  const highWriteCutoff = options.highWriteFrequency ?? DEFAULT_HIGH_WRITE_FREQUENCY;
  if (currentBackend === "do-storage" && maxWrites !== undefined && maxWrites > highWriteCutoff) {
    return {
      dataItem,
      currentBackend,
      action: "adjust-threshold",
      reason:
        `High write frequency (${maxWrites} writes observed, cut-off ${highWriteCutoff}). ` +
        `Consider adjusting compaction or archive thresholds.`,
      confidence,
      revisitContext: {
        signalCount: signals.length,
        maxWriteFrequency: maxWrites,
        thresholdBytes: doSizeThreshold,
      },
    };
  }

  return {
    dataItem,
    currentBackend,
    action: "maintain",
    reason: "Evidence signals consistent with current placement.",
    confidence,
    revisitContext: {
      signalCount: signals.length,
      ...(maxSize !== undefined ? { maxSize } : {}),
      ...(maxWrites !== undefined ? { maxWriteFrequency: maxWrites } : {}),
      thresholdBytes: doSizeThreshold,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// §2 — StoragePlacementLog adapter
// ═══════════════════════════════════════════════════════════════════

/**
 * A single placement-evidence entry as produced by
 * `@nano-agent/eval-observability`'s `StoragePlacementLog`.
 *
 * We mirror the shape locally (kept in lock-step by the
 * `placement-evidence-revisit` integration test) rather than taking a
 * hard dependency on the observability package.
 */
export interface PlacementLogEntryLike {
  readonly dataItem: string;
  readonly storageLayer: string;
  readonly key: string;
  /**
   * Matches the real `PlacementEntry.op` union exported by
   * `@nano-agent/eval-observability`.
   */
  readonly op: "read" | "write" | "delete";
  readonly sizeBytes?: number;
  readonly timestamp: string;
  readonly sessionUuid?: string;
}

/**
 * Convert `StoragePlacementLog` entries into `EvidenceSignal[]`.
 *
 *  - Every entry contributes a `placement-observation` signal.
 *  - Entries carrying `sizeBytes` also contribute a `size` signal.
 *  - Repeated reads emit a single aggregated `read-frequency` signal.
 *  - Repeated writes emit a single aggregated `write-frequency` signal.
 *
 * Only entries whose `storageLayer` is a known `StorageBackend` are
 * kept; unknown layers are silently dropped so the calibration seam
 * stays robust to future catalog growth.
 */
export function placementLogToEvidence(
  entries: readonly PlacementLogEntryLike[],
): EvidenceSignal[] {
  const signals: EvidenceSignal[] = [];
  const readCounts = new Map<string, number>();
  const writeCounts = new Map<string, number>();

  for (const entry of entries) {
    if (!isKnownBackend(entry.storageLayer)) continue;
    const dataItem = entry.dataItem as DataItemClass;
    const base = {
      dataItem,
      observedAt: entry.timestamp,
      sessionUuid: entry.sessionUuid,
    };

    signals.push({
      ...base,
      kind: "placement-observation",
      value: entry.storageLayer,
    });

    if (typeof entry.sizeBytes === "number" && entry.sizeBytes >= 0) {
      signals.push({ ...base, kind: "size", value: entry.sizeBytes });
    }

    if (entry.op === "read") {
      readCounts.set(entry.dataItem, (readCounts.get(entry.dataItem) ?? 0) + 1);
    } else if (entry.op === "write" || entry.op === "delete") {
      writeCounts.set(entry.dataItem, (writeCounts.get(entry.dataItem) ?? 0) + 1);
    }
  }

  const lastTimestamp = entries[entries.length - 1]?.timestamp ?? new Date(0).toISOString();
  for (const [raw, count] of readCounts) {
    signals.push({
      kind: "read-frequency",
      dataItem: raw as DataItemClass,
      observedAt: lastTimestamp,
      value: count,
    });
  }
  for (const [raw, count] of writeCounts) {
    signals.push({
      kind: "write-frequency",
      dataItem: raw as DataItemClass,
      observedAt: lastTimestamp,
      value: count,
    });
  }

  return signals;
}

// ── Internal helpers ──

function determineConfidence(
  signalCount: number,
  options: CalibrationOptions,
): "low" | "medium" | "high" {
  const high = options.highConfidenceMinSignals ?? DEFAULT_HIGH_CONFIDENCE_MIN_SIGNALS;
  const medium = options.mediumConfidenceMinSignals ?? DEFAULT_MEDIUM_CONFIDENCE_MIN_SIGNALS;
  if (signalCount >= high) return "high";
  if (signalCount >= medium) return "medium";
  return "low";
}

function isSize(
  s: EvidenceSignal,
): s is Extract<EvidenceSignal, { kind: "size" }> {
  return s.kind === "size";
}

function isAccessPattern(
  s: EvidenceSignal,
): s is Extract<EvidenceSignal, { kind: "access-pattern" }> {
  return s.kind === "access-pattern";
}

function isWriteFrequency(
  s: EvidenceSignal,
): s is Extract<EvidenceSignal, { kind: "write-frequency" }> {
  return s.kind === "write-frequency";
}

function isKnownBackend(s: string): s is StorageBackend {
  return s === "do-storage" || s === "kv" || s === "r2";
}
