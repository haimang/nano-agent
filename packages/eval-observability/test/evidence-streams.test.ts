/**
 * A7 Phase 1 — evidence stream taxonomy + verdict tests.
 *
 * Covers:
 *  - five-stream discriminated union narrows correctly
 *  - EvidenceRecorder emits + filters per stream
 *  - computeCalibrationVerdict honours the three thresholds
 *  - CALIBRATION_VERDICTS exposes exactly the four AX-QNA Q13 names
 */

import { describe, it, expect } from "vitest";
import {
  EvidenceRecorder,
  CALIBRATION_VERDICTS,
  DEFAULT_EVIDENCE_BACKED_MIN_SIGNALS,
  DEFAULT_NEEDS_REVISIT_MIN_CONTRADICTORY,
  DEFAULT_CONTRADICTED_MIN_CONTRADICTORY,
  computeCalibrationVerdict,
  type EvidenceAnchor,
  type EvidenceRecord,
} from "../src/evidence-streams.js";

const ANCHOR: EvidenceAnchor = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-evidence",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  timestamp: "2026-04-18T10:00:00.000Z",
};

describe("EvidenceRecorder", () => {
  it("captures all five evidence streams + filters per kind", () => {
    const rec = new EvidenceRecorder();
    const records: EvidenceRecord[] = [
      {
        stream: "placement",
        anchor: ANCHOR,
        dataItem: "trace.timeline",
        backend: "do-storage",
        op: "write",
        sizeBytes: 256,
        outcome: "ok",
      },
      {
        stream: "assembly",
        anchor: ANCHOR,
        assembledKinds: ["system", "session", "workspace_summary"],
        droppedOptionalKinds: [],
        orderApplied: ["system", "session", "workspace_summary"],
        totalTokens: 1234,
        truncated: false,
      },
      {
        stream: "compact",
        anchor: ANCHOR,
        phase: "request",
        targetTokenBudget: 4000,
      },
      {
        stream: "artifact",
        anchor: ANCHOR,
        artifactName: "out.json",
        stage: "promoted",
        sizeBytes: 8192,
      },
      {
        stream: "snapshot",
        anchor: ANCHOR,
        phase: "capture",
        mountCount: 3,
        fileIndexCount: 14,
        artifactRefCount: 2,
        contextLayerCount: 5,
      },
    ];
    for (const r of records) rec.emit(r);

    expect(rec.count()).toBe(5);
    expect(rec.ofStream("placement")).toHaveLength(1);
    expect(rec.ofStream("assembly")).toHaveLength(1);
    expect(rec.ofStream("compact")).toHaveLength(1);
    expect(rec.ofStream("artifact")).toHaveLength(1);
    expect(rec.ofStream("snapshot")).toHaveLength(1);

    // Compile-time discrimination works at runtime too.
    const placement = rec.ofStream("placement")[0]!;
    expect(placement.stream).toBe("placement");
    expect(placement.backend).toBe("do-storage");
  });

  it("reset() clears the buffer", () => {
    const rec = new EvidenceRecorder();
    rec.emit({
      stream: "placement",
      anchor: ANCHOR,
      dataItem: "x",
      backend: "r2",
      op: "write",
      outcome: "ok",
    });
    expect(rec.count()).toBe(1);
    rec.reset();
    expect(rec.count()).toBe(0);
  });
});

describe("CALIBRATION_VERDICTS", () => {
  it("exposes exactly the four AX-QNA Q13 verdicts in order", () => {
    expect([...CALIBRATION_VERDICTS]).toEqual([
      "provisional",
      "evidence-backed",
      "needs-revisit",
      "contradicted-by-evidence",
    ]);
  });

  it("exports the documented default thresholds", () => {
    expect(DEFAULT_EVIDENCE_BACKED_MIN_SIGNALS).toBe(3);
    expect(DEFAULT_NEEDS_REVISIT_MIN_CONTRADICTORY).toBe(1);
    expect(DEFAULT_CONTRADICTED_MIN_CONTRADICTORY).toBe(5);
  });
});

describe("computeCalibrationVerdict", () => {
  it("returns provisional when no signals have accumulated", () => {
    expect(
      computeCalibrationVerdict({ supporting: 0, contradictory: 0 }),
    ).toBe("provisional");
  });

  it("returns evidence-backed at the default threshold of 3 supporting", () => {
    expect(
      computeCalibrationVerdict({ supporting: 3, contradictory: 0 }),
    ).toBe("evidence-backed");
  });

  it("returns needs-revisit when one contradiction appears regardless of support", () => {
    expect(
      computeCalibrationVerdict({ supporting: 5, contradictory: 1 }),
    ).toBe("needs-revisit");
  });

  it("escalates to contradicted-by-evidence at the default 5 contradictions", () => {
    expect(
      computeCalibrationVerdict({ supporting: 10, contradictory: 5 }),
    ).toBe("contradicted-by-evidence");
  });

  it("respects per-hypothesis threshold overrides", () => {
    const v = computeCalibrationVerdict(
      { supporting: 2, contradictory: 0 },
      { evidenceBackedMinSignals: 2 },
    );
    expect(v).toBe("evidence-backed");
  });
});
