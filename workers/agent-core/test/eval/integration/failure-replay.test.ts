/**
 * Integration test — durable sink → timeline → FailureReplayHelper.
 *
 * Writes a realistic session containing a tool failure, then:
 *  - builds a SessionTimeline from the sink
 *  - builds a FailureReplayHelper from the timeline
 *  - verifies the error is extracted, summarised, and the pre-failure
 *    context events are recoverable.
 */

import { describe, it, expect } from "vitest";
import { DoStorageTraceSink } from "../../../src/eval/sinks/do-storage.js";
import type { DoStorageLike } from "../../../src/eval/sinks/do-storage.js";
import { SessionTimeline } from "../../../src/eval/timeline.js";
import { FailureReplayHelper } from "../../../src/eval/replay.js";
import type { TraceEvent } from "../../../src/eval/trace-event.js";

class FakeDoStorage implements DoStorageLike {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

const TRACE_REP = "11111111-1111-4111-8111-111111111111";
function ev(
  overrides: Partial<TraceEvent> & { eventKind: string; timestamp: string },
): TraceEvent {
  return {
    traceUuid: TRACE_REP,
    sessionUuid: "sess-rep",
    teamUuid: "team-rep",
    sourceRole: "session",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("integration: FailureReplayHelper over a DoStorageTraceSink", () => {
  it("extracts error events and summarises them from a realistic session", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-rep", "sess-rep", { maxBufferSize: 1 });

    await sink.emit(ev({ eventKind: "session.start", timestamp: "2026-04-16T10:00:00.000Z" }));
    await sink.emit(ev({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:01.000Z", turnUuid: "t1" }));
    await sink.emit(ev({ eventKind: "api.request", timestamp: "2026-04-16T10:00:02.000Z", turnUuid: "t1" }));
    await sink.emit(
      ev({
        eventKind: "tool.call.result",
        timestamp: "2026-04-16T10:00:03.000Z",
        turnUuid: "t1",
        toolName: "read_file",
        error: { code: "ENOENT", message: "file not found: /tmp/missing" },
      }),
    );
    await sink.emit(
      ev({
        eventKind: "api.error",
        timestamp: "2026-04-16T10:00:04.000Z",
        turnUuid: "t1",
        provider: "anthropic",
        error: { code: "E_PROVIDER", message: "gateway returned 502" },
      }),
    );
    await sink.emit(ev({ eventKind: "turn.end", timestamp: "2026-04-16T10:00:05.000Z", turnUuid: "t1" }));

    const timeline = await SessionTimeline.fromSink(sink);
    const replay = FailureReplayHelper.fromTimeline(timeline);

    const failures = replay.getFailureEvents();
    expect(failures).toHaveLength(2);
    expect(failures[0].error?.code).toBe("ENOENT");
    expect(failures[1].error?.code).toBe("E_PROVIDER");

    const summary = replay.buildFailureSummary();
    expect(summary.errorCount).toBe(2);
    expect(summary.firstError?.eventKind).toBe("tool.call.result");
    expect(summary.lastError?.eventKind).toBe("api.error");
    expect(summary.errorKinds.sort()).toEqual(["api.error", "tool.call.result"]);
  });

  it("getEventsBefore returns the lead-up context to a failure", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-rep", "sess-rep2", { maxBufferSize: 1 });

    await sink.emit(ev({ eventKind: "session.start", timestamp: "2026-04-16T10:00:00.000Z" }));
    await sink.emit(ev({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:01.000Z" }));
    await sink.emit(ev({ eventKind: "api.request", timestamp: "2026-04-16T10:00:02.000Z" }));
    await sink.emit(
      ev({
        eventKind: "tool.call.result",
        timestamp: "2026-04-16T10:00:03.000Z",
        error: { code: "E", message: "boom" },
      }),
    );
    await sink.emit(ev({ eventKind: "turn.end", timestamp: "2026-04-16T10:00:04.000Z" }));

    const timeline = await SessionTimeline.fromSink(sink);
    const replay = FailureReplayHelper.fromTimeline(timeline);

    const context = replay.getEventsBefore("2026-04-16T10:00:03.000Z", 2);
    expect(context).toHaveLength(2);
    expect(context[0].eventKind).toBe("turn.begin");
    expect(context[1].eventKind).toBe("api.request");
  });

  it("produces an empty summary for an error-free session", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-rep", "sess-ok", { maxBufferSize: 1 });

    await sink.emit(ev({ eventKind: "session.start", timestamp: "2026-04-16T10:00:00.000Z" }));
    await sink.emit(ev({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:01.000Z" }));
    await sink.emit(ev({ eventKind: "turn.end", timestamp: "2026-04-16T10:00:02.000Z" }));
    await sink.emit(ev({ eventKind: "session.end", timestamp: "2026-04-16T10:00:03.000Z" }));

    const timeline = await SessionTimeline.fromSink(sink);
    const summary = FailureReplayHelper.fromTimeline(timeline).buildFailureSummary();

    expect(summary.errorCount).toBe(0);
    expect(summary.firstError).toBeNull();
    expect(summary.lastError).toBeNull();
    expect(summary.errorKinds).toEqual([]);
  });
});
