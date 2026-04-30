/**
 * Integration test — WebSocket-first live inspection + HTTP fallback durable read.
 *
 * Models the two eyes of the observer:
 *  - The WebSocket side feeds a live `SessionInspector` with
 *    `session.stream.event` kinds as they arrive from the session.
 *  - The HTTP fallback side (e.g. a re-connecting client that missed
 *    the live stream) reads durable events through
 *    `SessionTimeline.fromSink(fallbackReader)`.
 *
 * These tests verify that:
 *  - The inspector accepts only the 10 canonical kinds and rejects
 *    unknown kinds (without crashing).
 *  - Inspector `filterByKind` / `getLatest` preserve `seq` and
 *    `timestamp` so ordering and duplicate-delivery bugs can be
 *    diagnosed off the live stream.
 *  - An HTTP-fallback reader that implements `TraceTimelineReader`
 *    produces the same timeline shape as a live `DoStorageTraceSink`.
 *  - When both views are joined, live-only kinds are visible only in
 *    the inspector and durable kinds are visible in both streams
 *    (transcript + audit parts of the durable timeline), which is
 *    exactly the two-surface split the action-plan promises.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionInspector } from "../../../src/eval/inspector.js";
import { DoStorageTraceSink } from "../../../src/eval/sinks/do-storage.js";
import type { DoStorageLike } from "../../../src/eval/sinks/do-storage.js";
import { SessionTimeline } from "../../../src/eval/timeline.js";
import type { TraceTimelineReader } from "../../../src/eval/timeline.js";
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

function durableEv(overrides: Partial<TraceEvent> & { eventKind: string; timestamp: string }): TraceEvent {
  return {
    sessionUuid: "sess-ws",
    teamUuid: "team-ws",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("integration: WS-first inspector + HTTP-fallback durable read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("inspector accepts the 10 canonical kinds and rejects unknown kinds without crashing", () => {
    const inspector = new SessionInspector();

    inspector.onStreamEvent("turn.begin", 1, { turn_uuid: "11111111-1111-4111-8111-111111111111" });
    vi.setSystemTime(new Date("2026-04-16T12:00:01.000Z"));
    inspector.onStreamEvent("llm.delta", 2, { content_type: "text", content: "hi", is_final: false });
    vi.setSystemTime(new Date("2026-04-16T12:00:02.000Z"));
    inspector.onStreamEvent("unknown.kind", 3, {}); // rejected
    vi.setSystemTime(new Date("2026-04-16T12:00:03.000Z"));
    inspector.onStreamEvent("tool.call.progress", 4, {
      tool_name: "read_file",
      chunk: "...",
      is_final: false,
    });

    const accepted = inspector.getEvents();
    expect(accepted).toHaveLength(3);
    expect(accepted.map((e) => e.kind)).toEqual(["turn.begin", "llm.delta", "tool.call.progress"]);

    // filterByKind / getLatest retain seq + timestamp for live-debug usage.
    const deltas = inspector.filterByKind("llm.delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0].seq).toBe(2);
    expect(deltas[0].timestamp).toBe("2026-04-16T12:00:01.000Z");

    const latest = inspector.getLatest(2);
    expect(latest).toHaveLength(2);
    expect(latest[latest.length - 1].kind).toBe("tool.call.progress");

    const rejections = inspector.getRejections();
    expect(rejections).toHaveLength(1);
    expect(rejections[0].reason).toBe("unknown-kind");
  });

  it("HTTP fallback reader behaves the same as DoStorageTraceSink when plugged into SessionTimeline", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-ws", "sess-ws", { maxBufferSize: 1 });

    await sink.emit(durableEv({ eventKind: "session.start", timestamp: "2026-04-16T10:00:00.000Z" }));
    await sink.emit(durableEv({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:01.000Z", turnUuid: "t1" }));
    await sink.emit(durableEv({ eventKind: "api.response", timestamp: "2026-04-16T10:00:02.000Z", turnUuid: "t1" }));
    await sink.emit(durableEv({ eventKind: "turn.end", timestamp: "2026-04-16T10:00:03.000Z", turnUuid: "t1" }));
    await sink.emit(durableEv({ eventKind: "session.end", timestamp: "2026-04-16T10:00:04.000Z" }));

    // Build the timeline once via the live sink.
    const liveTimeline = await SessionTimeline.fromSink(sink);

    // Build the timeline again via an "HTTP-fallback" reader that simulates
    // a reconnecting client fetching the same durable events from an API.
    // The fallback reader just re-uses the persisted storage but models the
    // seam as a standalone `TraceTimelineReader`, not the sink itself.
    const httpFallbackReader: TraceTimelineReader = {
      async readTimeline() {
        const readOnlySink = new DoStorageTraceSink(storage, "team-ws", "sess-ws");
        return readOnlySink.readTimeline();
      },
    };

    const fallbackTimeline = await SessionTimeline.fromSink(httpFallbackReader);

    const liveKinds = liveTimeline.getEvents().map((e) => e.eventKind);
    const fallbackKinds = fallbackTimeline.getEvents().map((e) => e.eventKind);

    expect(liveKinds).toEqual(["session.start", "turn.begin", "api.response", "turn.end", "session.end"]);
    expect(fallbackKinds).toEqual(liveKinds);
  });

  it("WS inspector sees live-only kinds that never appear in the durable HTTP-fallback timeline", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-ws", "sess-split", { maxBufferSize: 1 });
    const inspector = new SessionInspector();

    // Simulate a live stream where the session emits both durable and
    // live-only kinds. The durable kinds ALSO go to the sink; the
    // live-only ones never do.
    const liveOnly = [
      ["llm.delta", { content_type: "text" as const, content: "hi", is_final: false }],
      ["tool.call.progress", { tool_name: "read_file", chunk: "...", is_final: false }],
      ["session.update", { phase: "streaming" }],
      ["system.notify", { severity: "info" as const, message: "ok" }],
    ] as const;

    let seq = 1;
    for (const [kind, body] of liveOnly) {
      inspector.onStreamEvent(kind, seq++, body);
    }

    // Durable kinds: visible on both sides.
    inspector.onStreamEvent("turn.begin", seq, { turn_uuid: "11111111-1111-4111-8111-111111111111" });
    await sink.emit(
      durableEv({ eventKind: "turn.begin", timestamp: "2026-04-16T12:00:00.000Z", turnUuid: "t1" }),
    );
    seq += 1;

    inspector.onStreamEvent("turn.end", seq, {
      turn_uuid: "11111111-1111-4111-8111-111111111111",
    });
    await sink.emit(
      durableEv({ eventKind: "turn.end", timestamp: "2026-04-16T12:00:05.000Z", turnUuid: "t1" }),
    );

    // HTTP fallback view (durable only)
    const durableTimeline = await SessionTimeline.fromSink(sink);

    // Live-only kinds exist only on the WS side.
    expect(inspector.filterByKind("llm.delta")).toHaveLength(1);
    expect(inspector.filterByKind("tool.call.progress")).toHaveLength(1);
    expect(durableTimeline.filterByKind("llm.delta")).toHaveLength(0);
    expect(durableTimeline.filterByKind("tool.call.progress")).toHaveLength(0);

    // Durable kinds exist on both sides.
    expect(inspector.filterByKind("turn.begin")).toHaveLength(1);
    expect(durableTimeline.filterByKind("turn.begin")).toHaveLength(1);
    expect(durableTimeline.filterByKind("turn.end")).toHaveLength(1);
  });
});
