/**
 * Tests for the evidence calibration seam.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_DO_SIZE_THRESHOLD_BYTES,
  evaluateEvidence,
  placementLogToEvidence,
} from "../src/calibration.js";
import type { PlacementLogEntryLike } from "../src/calibration.js";
import type { PlacementHypothesis } from "../src/placement.js";
import type {
  EvidenceSignal,
  ReadFrequencyEvidenceSignal,
  SizeEvidenceSignal,
  WriteFrequencyEvidenceSignal,
  AccessPatternEvidenceSignal,
} from "../src/evidence.js";

function makeHypothesis(overrides: Partial<PlacementHypothesis> = {}): PlacementHypothesis {
  return {
    dataItem: "session-messages",
    storageBackend: "do-storage",
    provisional: true,
    revisitCondition: "test condition",
    revisitRationale: "test rationale",
    ...overrides,
  };
}

function sizeSignal(bytes: number, overrides: Partial<SizeEvidenceSignal> = {}): SizeEvidenceSignal {
  return {
    kind: "size",
    dataItem: "session-messages",
    value: bytes,
    observedAt: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

function readFreqSignal(
  value: number,
  overrides: Partial<ReadFrequencyEvidenceSignal> = {},
): ReadFrequencyEvidenceSignal {
  return {
    kind: "read-frequency",
    dataItem: "session-messages",
    value,
    observedAt: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

function writeFreqSignal(
  value: number,
  overrides: Partial<WriteFrequencyEvidenceSignal> = {},
): WriteFrequencyEvidenceSignal {
  return {
    kind: "write-frequency",
    dataItem: "session-messages",
    value,
    observedAt: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

function accessPatternSignal(
  value: AccessPatternEvidenceSignal["value"],
  overrides: Partial<AccessPatternEvidenceSignal> = {},
): AccessPatternEvidenceSignal {
  return {
    kind: "access-pattern",
    dataItem: "compact-archive",
    value,
    observedAt: "2026-04-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("evaluateEvidence", () => {
  it("recommends maintain with low confidence when no signals", () => {
    const result = evaluateEvidence([], makeHypothesis());
    expect(result.action).toBe("maintain");
    expect(result.confidence).toBe("low");
    expect(result.dataItem).toBe("session-messages");
    expect(result.revisitContext.signalCount).toBe(0);
    expect(result.revisitContext.thresholdBytes).toBe(DEFAULT_DO_SIZE_THRESHOLD_BYTES);
  });

  it("recommends change-placement to R2 when size exceeds the default DO threshold", () => {
    const signals = [
      sizeSignal(2_000_000),
      sizeSignal(1_500_000),
      sizeSignal(500_000),
    ];
    const result = evaluateEvidence(signals, makeHypothesis({ storageBackend: "do-storage" }));

    expect(result.action).toBe("change-placement");
    expect(result.suggestedBackend).toBe("r2");
    expect(result.reason).toContain("2000000");
    expect(result.revisitContext.maxSize).toBe(2_000_000);
  });

  it("respects a caller-supplied inline threshold (R5: no more hardcoded 1MB)", () => {
    const signals = [sizeSignal(200_000)];
    const result = evaluateEvidence(signals, makeHypothesis({ storageBackend: "do-storage" }), {
      doSizeThresholdBytes: 100_000,
    });

    expect(result.action).toBe("change-placement");
    expect(result.revisitContext.thresholdBytes).toBe(100_000);
  });

  it("maintains placement when size stays under the default threshold", () => {
    const result = evaluateEvidence(
      [sizeSignal(500_000)],
      makeHypothesis({ storageBackend: "do-storage" }),
    );
    expect(result.action).toBe("maintain");
  });

  it("recommends change-placement to do-storage on hot-read against R2", () => {
    const signals = [
      accessPatternSignal("hot-read"),
      accessPatternSignal("hot-read"),
      accessPatternSignal("hot-read"),
    ];
    const result = evaluateEvidence(
      signals,
      makeHypothesis({ dataItem: "compact-archive", storageBackend: "r2" }),
    );
    expect(result.action).toBe("change-placement");
    expect(result.suggestedBackend).toBe("do-storage");
    expect(result.revisitContext.accessPattern).toBe("hot-read");
  });

  it("maintains on mixed / cold-scan patterns", () => {
    const result = evaluateEvidence(
      [accessPatternSignal("cold-scan")],
      makeHypothesis({ dataItem: "compact-archive", storageBackend: "r2" }),
    );
    expect(result.action).toBe("maintain");
  });

  it("recommends adjust-threshold for high write frequency on DO", () => {
    const signals: EvidenceSignal[] = [];
    for (let i = 0; i < 10; i++) signals.push(writeFreqSignal(1500));

    const result = evaluateEvidence(signals, makeHypothesis({ storageBackend: "do-storage" }));
    expect(result.action).toBe("adjust-threshold");
    expect(result.reason).toContain("write frequency");
    expect(result.confidence).toBe("high");
    expect(result.revisitContext.maxWriteFrequency).toBe(1500);
  });

  it("returns high confidence with ≥10 signals", () => {
    const signals: EvidenceSignal[] = [];
    for (let i = 0; i < 10; i++) signals.push(readFreqSignal(5));
    const result = evaluateEvidence(signals, makeHypothesis());
    expect(result.confidence).toBe("high");
  });

  it("returns medium confidence with 3-9 signals", () => {
    const signals: EvidenceSignal[] = [];
    for (let i = 0; i < 5; i++) signals.push(readFreqSignal(5));
    const result = evaluateEvidence(signals, makeHypothesis());
    expect(result.confidence).toBe("medium");
  });

  it("returns low confidence with 1-2 signals", () => {
    const result = evaluateEvidence([readFreqSignal(5)], makeHypothesis());
    expect(result.confidence).toBe("low");
  });

  it("ignores size signals for non-DO backends", () => {
    const result = evaluateEvidence(
      [sizeSignal(2_000_000)],
      makeHypothesis({ storageBackend: "r2" }),
    );
    expect(result.action).toBe("maintain");
  });
});

describe("placementLogToEvidence", () => {
  const now = "2026-04-17T00:00:00.000Z";

  it("emits placement-observation + size signals for each entry with a known backend", () => {
    const entries: PlacementLogEntryLike[] = [
      { dataItem: "session-messages", storageLayer: "do-storage", key: "k1", op: "write", sizeBytes: 1024, timestamp: now },
      { dataItem: "session-messages", storageLayer: "do-storage", key: "k2", op: "read", timestamp: now },
    ];
    const signals = placementLogToEvidence(entries);
    const kinds = signals.map((s) => s.kind).sort();
    expect(kinds).toContain("placement-observation");
    expect(kinds).toContain("size");
  });

  it("aggregates repeated reads into a single read-frequency signal", () => {
    const entries: PlacementLogEntryLike[] = [
      { dataItem: "session-messages", storageLayer: "do-storage", key: "k", op: "read", timestamp: now },
      { dataItem: "session-messages", storageLayer: "do-storage", key: "k", op: "read", timestamp: now },
      { dataItem: "session-messages", storageLayer: "do-storage", key: "k", op: "read", timestamp: now },
    ];
    const signals = placementLogToEvidence(entries);
    const reads = signals.filter((s) => s.kind === "read-frequency");
    expect(reads).toHaveLength(1);
    expect((reads[0] as ReadFrequencyEvidenceSignal).value).toBe(3);
  });

  it("aggregates repeated writes into a single write-frequency signal", () => {
    const entries: PlacementLogEntryLike[] = Array.from({ length: 4 }, () => ({
      dataItem: "session-messages",
      storageLayer: "do-storage",
      key: "k",
      op: "write" as const,
      timestamp: now,
    }));
    const signals = placementLogToEvidence(entries);
    const writes = signals.filter((s) => s.kind === "write-frequency");
    expect(writes).toHaveLength(1);
    expect((writes[0] as WriteFrequencyEvidenceSignal).value).toBe(4);
  });

  it("silently skips entries whose storageLayer is not a known backend", () => {
    const entries: PlacementLogEntryLike[] = [
      { dataItem: "session-messages", storageLayer: "some-future-tier", key: "k", op: "write", timestamp: now },
    ];
    expect(placementLogToEvidence(entries)).toEqual([]);
  });

  it("end-to-end: placementLog → evaluateEvidence feeds the calibrator naturally", () => {
    const entries: PlacementLogEntryLike[] = [
      { dataItem: "session-messages", storageLayer: "do-storage", key: "k", op: "write", sizeBytes: 2_000_000, timestamp: now },
      { dataItem: "session-messages", storageLayer: "do-storage", key: "k", op: "write", sizeBytes: 1_500_000, timestamp: now },
    ];
    const result = evaluateEvidence(
      placementLogToEvidence(entries),
      makeHypothesis({ storageBackend: "do-storage" }),
    );
    expect(result.action).toBe("change-placement");
    expect(result.suggestedBackend).toBe("r2");
  });
});
