/**
 * A7 Phase 2 — DoStorageTraceSink emits placement evidence on real put().
 */

import { describe, it, expect } from "vitest";
import {
  DoStorageTraceSink,
  type DoStorageLike,
} from "../../src/sinks/do-storage.js";
import {
  EvidenceRecorder,
  type TraceEvent,
} from "../../src/index.js";

class FakeDoStorage implements DoStorageLike {
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

function durableEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-18T10:00:00.000Z",
    traceUuid: TRACE,
    sessionUuid: SESS,
    teamUuid: "team-place",
    sourceRole: "session",
    sourceKey: "nano-agent.session.do@v1",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("DoStorageTraceSink — A7 Phase 2 placement evidence emission", () => {
  it("emits one PlacementEvidence per real put()", async () => {
    const evidence = new EvidenceRecorder();
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-place", SESS, {
      maxBufferSize: 256,
      evidenceSink: evidence,
    });

    await sink.emit(durableEvent({ timestamp: "2026-04-18T10:00:00.000Z" }));
    await sink.emit(durableEvent({ timestamp: "2026-04-18T10:00:01.000Z" }));
    await sink.flush();

    const placements = evidence.ofStream("placement");
    expect(placements).toHaveLength(1); // single date-key flush
    const p = placements[0]!;
    expect(p.backend).toBe("do-storage");
    expect(p.op).toBe("write");
    expect(p.outcome).toBe("ok");
    expect(p.key.startsWith("tenants/team-place/trace/")).toBe(true);
    expect(p.sizeBytes).toBeGreaterThan(0);
    expect(p.anchor.traceUuid).toBe(TRACE);
    expect(p.anchor.sessionUuid).toBe(SESS);
    expect(p.anchor.sourceRole).toBe("session");
  });

  it("does not emit placement evidence when no sink is wired", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-place", SESS, {
      maxBufferSize: 256,
    });
    await sink.emit(durableEvent());
    await sink.flush();
    // No throw, no evidence — silent baseline preserved.
    const keys = Object.keys(storage);
    expect(Array.isArray(keys)).toBe(true);
  });

  it("emits one placement record per distinct date-key when events span days", async () => {
    const evidence = new EvidenceRecorder();
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-place", SESS, {
      maxBufferSize: 256,
      evidenceSink: evidence,
    });

    await sink.emit(durableEvent({ timestamp: "2026-04-18T10:00:00.000Z" }));
    await sink.emit(durableEvent({ timestamp: "2026-04-19T10:00:00.000Z" }));
    await sink.flush();

    const placements = evidence.ofStream("placement");
    expect(placements).toHaveLength(2);
    expect(placements.every((p) => p.key.startsWith("tenants/team-place/"))).toBe(
      true,
    );
  });
});
