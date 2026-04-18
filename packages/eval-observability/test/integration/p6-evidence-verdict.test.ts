/**
 * A7 Phase 4 — end-to-end calibration verdict integration.
 *
 * Drives the full P6 evidence loop:
 *   1. real `DoStorageTraceSink` flush → emits `placement` evidence
 *   2. workspace assembly + compact + snapshot helpers feed the same
 *      `EvidenceRecorder`
 *   3. `aggregateEvidenceVerdict()` runs the default rule catalog and
 *      every hypothesis returns a typed verdict
 *   4. the produced verdict matrix is the artifact A7 hands to A8/A9/A10
 *
 * Failure modes are also covered: an oversize placement write should
 * push `placement.do.write-amp` into `needs-revisit`, and a 0%
 * restore-coverage record should push `snapshot.restore-coverage` into
 * `needs-revisit` even when capture evidence keeps accumulating.
 */

import { describe, it, expect } from "vitest";
import {
  DoStorageTraceSink,
  EvidenceRecorder,
  aggregateEvidenceVerdict,
  DEFAULT_VERDICT_RULES,
  type DoStorageLike,
  type EvidenceAnchor,
  type EvidenceRecord,
  type TraceEvent,
} from "../../src/index.js";

class FakeStorage implements DoStorageLike {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

const TRACE = "11111111-1111-4111-8111-111111111111";
const SESS = "22222222-2222-4222-8222-222222222222";
const TEAM = "team-p6-verdict";

const ANCHOR: EvidenceAnchor = {
  traceUuid: TRACE,
  sessionUuid: SESS,
  teamUuid: TEAM,
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
  timestamp: "2026-04-18T10:00:00.000Z",
};

function durable(t: string): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: t,
    traceUuid: TRACE,
    sessionUuid: SESS,
    teamUuid: TEAM,
    sourceRole: "session",
    sourceKey: "nano-agent.session.do@v1",
    audience: "internal",
    layer: "durable-audit",
  };
}

describe("A7 Phase 4 — evidence verdict integration", () => {
  it("produces evidence-backed verdicts for the five default hypotheses on a healthy run", async () => {
    const storage = new FakeStorage();
    const recorder = new EvidenceRecorder();
    const sink = new DoStorageTraceSink(storage, TEAM, SESS, {
      maxBufferSize: 256,
      evidenceSink: recorder,
    });

    // Three real placement writes (one per day) — feeds
    // `placement.do.hot-anchor` and `placement.do.write-amp`.
    await sink.emit(durable("2026-04-18T10:00:00.000Z"));
    await sink.flush();
    await sink.emit(durable("2026-04-19T10:00:00.000Z"));
    await sink.flush();
    await sink.emit(durable("2026-04-20T10:00:00.000Z"));
    await sink.flush();

    // Three healthy assembly records.
    for (let i = 0; i < 3; i++) {
      recorder.emit({
        stream: "assembly",
        anchor: ANCHOR,
        assembledKinds: ["system", "session"],
        droppedOptionalKinds: [],
        orderApplied: ["system", "session"],
        totalTokens: 50,
        truncated: false,
      });
    }

    // Three compact responses with no error.
    for (let i = 0; i < 3; i++) {
      recorder.emit({
        stream: "compact",
        anchor: ANCHOR,
        phase: "response",
        tokensBefore: 1000,
        tokensAfter: 600,
      });
    }

    // Three healthy restores at 90% coverage.
    for (let i = 0; i < 3; i++) {
      recorder.emit({
        stream: "snapshot",
        anchor: ANCHOR,
        phase: "restore",
        restoreCoverage: 0.9,
        mountCount: 2,
        fileIndexCount: 5,
        artifactRefCount: 1,
        contextLayerCount: 3,
      });
    }

    const result = aggregateEvidenceVerdict(recorder.all());
    expect(result.recordsConsidered).toBeGreaterThanOrEqual(12);
    expect(result.unmatchedCount).toBe(0);
    const byId = new Map(result.verdicts.map((v) => [v.id, v]));
    for (const id of [
      "placement.do.hot-anchor",
      "placement.do.write-amp",
      "assembly.required-layer-respected",
      "compact.success-rate",
      "snapshot.restore-coverage",
    ]) {
      const v = byId.get(id)!;
      expect(v).toBeDefined();
      expect(v.verdict).toBe("evidence-backed");
    }
  });

  it("flags needs-revisit when an oversize placement write contradicts write-amp", () => {
    const recorder = new EvidenceRecorder();
    // 5 supporting writes — small payloads
    for (let i = 0; i < 5; i++) {
      recorder.emit({
        stream: "placement",
        anchor: ANCHOR,
        dataItem: "trace.timeline",
        backend: "do-storage",
        op: "write",
        sizeBytes: 4096,
        outcome: "ok",
      });
    }
    // 1 oversize write
    recorder.emit({
      stream: "placement",
      anchor: ANCHOR,
      dataItem: "trace.timeline",
      backend: "do-storage",
      op: "write",
      sizeBytes: 5_000_000,
      outcome: "ok",
    });
    const v = aggregateEvidenceVerdict(recorder.all()).verdicts.find(
      (r) => r.id === "placement.do.write-amp",
    )!;
    expect(v.contradictory).toBe(1);
    expect(v.verdict).toBe("needs-revisit");
  });

  it("flags contradicted-by-evidence when restores keep failing past the threshold", () => {
    const recorder = new EvidenceRecorder();
    // 5 failed restores
    for (let i = 0; i < 5; i++) {
      recorder.emit({
        stream: "snapshot",
        anchor: ANCHOR,
        phase: "restore",
        restoreCoverage: 0.1,
      });
    }
    const v = aggregateEvidenceVerdict(recorder.all()).verdicts.find(
      (r) => r.id === "snapshot.restore-coverage",
    )!;
    expect(v.verdict).toBe("contradicted-by-evidence");
  });

  it("DEFAULT_VERDICT_RULES exposes the five expected hypothesis ids", () => {
    expect(DEFAULT_VERDICT_RULES.map((r) => r.id)).toEqual([
      "placement.do.hot-anchor",
      "placement.do.write-amp",
      "assembly.required-layer-respected",
      "compact.success-rate",
      "snapshot.restore-coverage",
    ]);
  });

  it("rules can be supplied externally to extend the catalog", () => {
    const customRule = {
      id: "compact.custom",
      hypothesis: "Compact requests rarely overshoot the budget",
      classify(record: EvidenceRecord) {
        if (record.stream !== "compact") return null;
        if (record.phase !== "request") return null;
        return record.targetTokenBudget && record.targetTokenBudget < 1024
          ? "contradictory"
          : ("supporting" as const);
      },
    };
    const recorder = new EvidenceRecorder();
    for (let i = 0; i < 4; i++) {
      recorder.emit({
        stream: "compact",
        anchor: ANCHOR,
        phase: "request",
        targetTokenBudget: 4000,
      });
    }
    const result = aggregateEvidenceVerdict(recorder.all(), [customRule]);
    expect(result.verdicts).toHaveLength(1);
    expect(result.verdicts[0]?.verdict).toBe("evidence-backed");
  });
});
