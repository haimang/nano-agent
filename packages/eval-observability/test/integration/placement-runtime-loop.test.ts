/**
 * A7 Phase 2 — placement runtime loop integration test.
 *
 * Closes the loop:
 *   PlacementEvidence → EvidenceRecorder
 *   → bridgeEvidenceToPlacementLog → StoragePlacementLog
 *   (legacy log shape)
 *
 * The downstream calibration shape (`StorageCalibrator.evaluateEvidence`)
 * is exercised by `packages/storage-topology` integration tests; this
 * test is responsible for proving the eval-observability side of the
 * bridge is faithful.
 */

import { describe, it, expect } from "vitest";
import {
  EvidenceRecorder,
  StoragePlacementLog,
  bridgeEvidenceToPlacementLog,
  placementEvidenceFromRecord,
  recordPlacementEvidence,
  type EvidenceAnchor,
  type PlacementEvidence,
} from "../../src/index.js";

const ANCHOR: EvidenceAnchor = {
  traceUuid: "11111111-1111-4111-8111-111111111111",
  sessionUuid: "22222222-2222-4222-8222-222222222222",
  teamUuid: "team-runtime-loop",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  timestamp: "2026-04-18T10:00:00.000Z",
};

function placement(
  overrides: Partial<PlacementEvidence> = {},
): PlacementEvidence {
  return {
    stream: "placement",
    anchor: ANCHOR,
    dataItem: "trace.timeline",
    backend: "do-storage",
    op: "write",
    sizeBytes: 256,
    outcome: "ok",
    key: `tenants/${ANCHOR.teamUuid}/trace/${ANCHOR.sessionUuid}/2026-04-18.jsonl`,
    ...overrides,
  };
}

describe("placement runtime loop (A7 Phase 2)", () => {
  it("placementEvidenceFromRecord preserves item / backend / op / key / size / sessionUuid", () => {
    const entry = placementEvidenceFromRecord(placement({ sizeBytes: 1024 }));
    expect(entry.dataItem).toBe("trace.timeline");
    expect(entry.storageLayer).toBe("do-storage");
    expect(entry.op).toBe("write");
    expect(entry.sizeBytes).toBe(1024);
    expect(entry.sessionUuid).toBe(ANCHOR.sessionUuid);
    expect(entry.key.startsWith("tenants/")).toBe(true);
  });

  it("collapses promote→write / demote→delete / list→read for legacy log shape", () => {
    expect(
      placementEvidenceFromRecord(placement({ op: "promote" })).op,
    ).toBe("write");
    expect(
      placementEvidenceFromRecord(placement({ op: "demote" })).op,
    ).toBe("delete");
    expect(
      placementEvidenceFromRecord(placement({ op: "list" })).op,
    ).toBe("read");
  });

  it("bridgeEvidenceToPlacementLog mirrors every placement record into the log", () => {
    const recorder = new EvidenceRecorder();
    const log = new StoragePlacementLog();
    recorder.emit(placement({ op: "write", sizeBytes: 100 }));
    recorder.emit(placement({ op: "read" }));
    recorder.emit({
      stream: "assembly",
      anchor: ANCHOR,
      assembledKinds: ["system"],
      droppedOptionalKinds: [],
      orderApplied: ["system"],
      totalTokens: 10,
      truncated: false,
    });

    const forwarded = bridgeEvidenceToPlacementLog(recorder, log);
    expect(forwarded).toBe(2);
    expect(log.getEntries()).toHaveLength(2);
    const summary = log.getSummary();
    expect(summary["do-storage"].writes).toBe(1);
    expect(summary["do-storage"].reads).toBe(1);
    // totalBytes sums every entry that supplies sizeBytes, regardless of op.
    expect(summary["do-storage"].totalBytes).toBeGreaterThanOrEqual(100);
  });

  it("recordPlacementEvidence one-shot pushes to recorder + log atomically", () => {
    const recorder = new EvidenceRecorder();
    const log = new StoragePlacementLog();
    recordPlacementEvidence(placement({ sizeBytes: 64 }), recorder, log);
    recordPlacementEvidence(placement({ op: "read" }), recorder, log);
    expect(recorder.count()).toBe(2);
    expect(log.getEntries()).toHaveLength(2);
  });

  it("recordPlacementEvidence works without a legacy log (recorder only)", () => {
    const recorder = new EvidenceRecorder();
    recordPlacementEvidence(placement({ op: "delete" }), recorder);
    expect(recorder.count()).toBe(1);
    const placements = recorder.ofStream("placement");
    expect(placements[0]?.op).toBe("delete");
  });
});
