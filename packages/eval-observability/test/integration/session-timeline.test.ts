/**
 * Integration test — durable write → SessionTimeline read.
 *
 * Writes a mix of durable and live events through DoStorageTraceSink,
 * then constructs a SessionTimeline from the sink and verifies:
 *  - live events are dropped,
 *  - durable events come back sorted,
 *  - `filterByKind` / `filterByTurn` / `getTimeRange` all work over the
 *    stored data,
 *  - a new sink instance over the same storage sees the same timeline
 *    (hibernation round-trip).
 */

import { describe, it, expect } from "vitest";
import { DoStorageTraceSink } from "../../src/sinks/do-storage.js";
import type { DoStorageLike } from "../../src/sinks/do-storage.js";
import { SessionTimeline } from "../../src/timeline.js";
import type { TraceEvent } from "../../src/trace-event.js";

class FakeDoStorage implements DoStorageLike {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async list(prefix: string): Promise<string[]> {
    return [...this.store.keys()].filter((k) => k.startsWith(prefix));
  }
}

function ev(overrides: Partial<TraceEvent> & { eventKind: string; timestamp: string }): TraceEvent {
  return {
    sessionUuid: "sess-int",
    teamUuid: "team-int",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("integration: durable write → SessionTimeline read", () => {
  it("builds a sorted timeline from a freshly written sink", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-int", "sess-int", { maxBufferSize: 1 });

    await sink.emit(ev({ eventKind: "turn.end", timestamp: "2026-04-16T10:00:05.000Z", turnUuid: "turn-A" }));
    await sink.emit(ev({ eventKind: "llm.delta", timestamp: "2026-04-16T10:00:01.000Z", layer: "live" })); // dropped
    await sink.emit(ev({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:00.000Z", turnUuid: "turn-A" }));
    await sink.emit(ev({ eventKind: "api.request", timestamp: "2026-04-16T10:00:02.000Z", turnUuid: "turn-A" }));

    const timeline = await SessionTimeline.fromSink(sink);
    const events = timeline.getEvents();

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.eventKind)).toEqual(["turn.begin", "api.request", "turn.end"]);
  });

  it("supports filterByKind / filterByTurn / getTimeRange on the timeline", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, "team-int", "sess-int", { maxBufferSize: 1 });

    await sink.emit(ev({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:00.000Z", turnUuid: "turn-A" }));
    await sink.emit(ev({ eventKind: "api.request", timestamp: "2026-04-16T10:00:01.000Z", turnUuid: "turn-A" }));
    await sink.emit(ev({ eventKind: "api.response", timestamp: "2026-04-16T10:00:02.000Z", turnUuid: "turn-A" }));
    await sink.emit(ev({ eventKind: "turn.end", timestamp: "2026-04-16T10:00:03.000Z", turnUuid: "turn-A" }));
    await sink.emit(ev({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:04.000Z", turnUuid: "turn-B" }));

    const timeline = await SessionTimeline.fromSink(sink);

    expect(timeline.size()).toBe(5);
    expect(timeline.filterByKind("api.request")).toHaveLength(1);
    expect(timeline.filterByTurn("turn-A")).toHaveLength(4);
    expect(timeline.filterByTurn("turn-B")).toHaveLength(1);

    const range = timeline.getTimeRange();
    expect(range).not.toBeNull();
    expect(range!.first).toBe("2026-04-16T10:00:00.000Z");
    expect(range!.last).toBe("2026-04-16T10:00:04.000Z");
  });

  it("hibernation round-trip: a fresh sink instance reads the same events", async () => {
    const storage = new FakeDoStorage();
    const sink1 = new DoStorageTraceSink(storage, "team-int", "sess-hib", { maxBufferSize: 1 });
    await sink1.emit(ev({ eventKind: "session.start", timestamp: "2026-04-16T09:00:00.000Z" }));
    await sink1.emit(ev({ eventKind: "turn.begin", timestamp: "2026-04-16T09:00:01.000Z", turnUuid: "t1" }));
    await sink1.flush();

    // Simulate DO hibernation: brand-new sink instance, same storage.
    const sink2 = new DoStorageTraceSink(storage, "team-int", "sess-hib");
    const timeline = await SessionTimeline.fromSink(sink2);

    expect(timeline.size()).toBe(2);
    expect(timeline.getEvents().map((e) => e.eventKind)).toEqual(["session.start", "turn.begin"]);
  });
});
