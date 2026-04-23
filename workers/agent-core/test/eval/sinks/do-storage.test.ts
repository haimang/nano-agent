/**
 * Tests for DoStorageTraceSink with a fake in-memory DoStorageLike.
 *
 * Covers:
 *  - append-only JSONL persistence by tenant + session + date
 *  - live events never reach storage
 *  - readTimeline() preserves JSON shape and returns sorted events
 *  - hibernation safety: a brand-new sink instance over the same storage
 *    can read back the full timeline via the durable date index
 *  - optional `list(prefix)` is used when available
 */

import { describe, it, expect } from "vitest";
import { DoStorageTraceSink } from "../../../src/eval/sinks/do-storage.js";
import type { DoStorageLike } from "../../../src/eval/sinks/do-storage.js";
import type { TraceEvent } from "../../../src/eval/trace-event.js";

/** In-memory fake of DoStorageLike for testing. */
class FakeDoStorage implements DoStorageLike {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  /** Test helper: return all stored keys. */
  keys(): string[] {
    return [...this.store.keys()];
  }
}

/** Fake with optional `list(prefix)` capability. */
class FakeDoStorageWithList extends FakeDoStorage implements DoStorageLike {
  async list(prefix: string): Promise<string[]> {
    return this.keys().filter((k) => k.startsWith(prefix));
  }
}

const TEAM = "team-001";

// A2-A3 review R3: trace-law carriers are now required on every fixture
const TRACE_CARRIERS = {
  traceUuid: "00000000-0000-4000-8000-000000000005",
  sourceRole: "session" as const,
  sourceKey: "test-fixture@v1",
};

function makeDurableEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-16T10:00:00.000Z",
    ...TRACE_CARRIERS,
    sessionUuid: "sess-001",
    teamUuid: TEAM,
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

function makeLiveEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "llm.delta",
    timestamp: "2026-04-16T10:00:00.000Z",
    ...TRACE_CARRIERS,
    sessionUuid: "sess-001",
    teamUuid: TEAM,
    audience: "internal",
    layer: "live",
    ...overrides,
  };
}

describe("DoStorageTraceSink", () => {
  it("emit a durable event, readTimeline returns it", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-001", { maxBufferSize: 1 });

    await sink.emit(makeDurableEvent());
    const timeline = await sink.readTimeline();

    expect(timeline).toHaveLength(1);
    expect(timeline[0].eventKind).toBe("turn.begin");
    expect(timeline[0].sessionUuid).toBe("sess-001");
  });

  it("emit a live-only event, readTimeline does NOT return it", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-001", { maxBufferSize: 1 });

    await sink.emit(makeLiveEvent());
    const timeline = await sink.readTimeline();

    expect(timeline).toHaveLength(0);
  });

  it("emitting multiple live-only event kinds all get dropped", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-001", { maxBufferSize: 1 });

    await sink.emit(makeLiveEvent({ eventKind: "llm.delta" }));
    await sink.emit(makeLiveEvent({ eventKind: "tool.call.progress" }));
    await sink.emit(makeLiveEvent({ eventKind: "session.update" }));
    await sink.emit(makeLiveEvent({ eventKind: "system.notify" }));

    const timeline = await sink.readTimeline();
    expect(timeline).toHaveLength(0);
  });

  it("emit multiple durable events, readTimeline returns them sorted", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-001", { maxBufferSize: 1 });

    await sink.emit(makeDurableEvent({
      eventKind: "turn.end",
      timestamp: "2026-04-16T10:05:00.000Z",
    }));
    await sink.emit(makeDurableEvent({
      eventKind: "turn.begin",
      timestamp: "2026-04-16T10:01:00.000Z",
    }));
    await sink.emit(makeDurableEvent({
      eventKind: "session.start",
      timestamp: "2026-04-16T10:00:00.000Z",
    }));

    const timeline = await sink.readTimeline();
    expect(timeline).toHaveLength(3);
    expect(timeline[0].timestamp).toBe("2026-04-16T10:00:00.000Z");
    expect(timeline[1].timestamp).toBe("2026-04-16T10:01:00.000Z");
    expect(timeline[2].timestamp).toBe("2026-04-16T10:05:00.000Z");
  });

  it("flush writes buffered events to storage", async () => {
    const storage = new FakeDoStorage();
    // Use a large buffer so emit doesn't auto-flush.
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-002", { maxBufferSize: 100 });

    await sink.emit(makeDurableEvent({ timestamp: "2026-04-16T11:00:00.000Z" }));
    await sink.emit(makeDurableEvent({ timestamp: "2026-04-16T11:01:00.000Z" }));

    // Before flush, storage should be empty (events are buffered).
    expect(storage.keys()).toHaveLength(0);

    await sink.flush();

    // After flush, storage should have entries.
    expect(storage.keys().length).toBeGreaterThan(0);

    const timeline = await sink.readTimeline();
    expect(timeline).toHaveLength(2);
  });

  it("auto-flushes when buffer exceeds maxBufferSize", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-003", { maxBufferSize: 2 });

    // First emit - still buffered.
    await sink.emit(makeDurableEvent({ timestamp: "2026-04-16T12:00:00.000Z" }));
    expect(storage.keys()).toHaveLength(0);

    // Second emit triggers auto-flush (buffer reaches maxBufferSize of 2).
    await sink.emit(makeDurableEvent({ timestamp: "2026-04-16T12:01:00.000Z" }));
    expect(storage.keys().length).toBeGreaterThan(0);
  });

  it("flush is a no-op when buffer is empty", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-004");

    // Should not throw.
    await sink.flush();
    expect(storage.keys()).toHaveLength(0);
  });

  it("stores events under the tenant-scoped key pattern", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-005", { maxBufferSize: 1 });

    await sink.emit(makeDurableEvent({ timestamp: "2026-04-16T10:00:00.000Z" }));

    const keys = storage.keys();
    // One data key + one index key
    expect(keys).toHaveLength(2);
    expect(keys).toContain(`tenants/${TEAM}/trace/sess-005/2026-04-16.jsonl`);
    expect(keys).toContain(`tenants/${TEAM}/trace/sess-005/_index`);
  });

  it("groups events from different dates under different keys", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-006", { maxBufferSize: 100 });

    await sink.emit(makeDurableEvent({ timestamp: "2026-04-16T10:00:00.000Z", eventKind: "session.start" }));
    await sink.emit(makeDurableEvent({ timestamp: "2026-04-17T10:00:00.000Z", eventKind: "session.end" }));
    await sink.flush();

    const keys = storage.keys();
    expect(keys).toContain(`tenants/${TEAM}/trace/sess-006/2026-04-16.jsonl`);
    expect(keys).toContain(`tenants/${TEAM}/trace/sess-006/2026-04-17.jsonl`);
  });

  it("mixes durable and live events — only durable events are persisted", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-007", { maxBufferSize: 1 });

    await sink.emit(makeDurableEvent({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:00.000Z" }));
    await sink.emit(makeLiveEvent({ eventKind: "llm.delta", timestamp: "2026-04-16T10:00:01.000Z" }));
    await sink.emit(makeDurableEvent({ eventKind: "turn.end", timestamp: "2026-04-16T10:00:02.000Z" }));

    const timeline = await sink.readTimeline();
    expect(timeline).toHaveLength(2);
    expect(timeline[0].eventKind).toBe("turn.begin");
    expect(timeline[1].eventKind).toBe("turn.end");
  });

  it("readTimeline returns events with correct structure after JSON round-trip", async () => {
    const storage = new FakeDoStorage();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-008", { maxBufferSize: 1 });

    const event = makeDurableEvent({
      eventKind: "api.response",
      turnUuid: "turn-X",
      usageTokens: { input: 100, output: 50 },
      provider: "anthropic",
    });

    await sink.emit(event);
    const timeline = await sink.readTimeline();

    expect(timeline).toHaveLength(1);
    const recovered = timeline[0];
    expect(recovered.eventKind).toBe("api.response");
    expect(recovered.turnUuid).toBe("turn-X");
    expect(recovered.usageTokens).toEqual({ input: 100, output: 50 });
    expect(recovered.provider).toBe("anthropic");
  });

  it("is hibernation-safe: a fresh sink instance on the same storage reads back the full timeline", async () => {
    const storage = new FakeDoStorage();

    const sink1 = new DoStorageTraceSink(storage, TEAM, "sess-hib", { maxBufferSize: 1 });
    await sink1.emit(makeDurableEvent({ timestamp: "2026-04-16T10:00:00.000Z", eventKind: "session.start" }));
    await sink1.emit(makeDurableEvent({ timestamp: "2026-04-16T10:01:00.000Z", eventKind: "turn.begin" }));
    await sink1.flush();

    // Simulate DO hibernation: new sink instance, same underlying storage.
    const sink2 = new DoStorageTraceSink(storage, TEAM, "sess-hib", { maxBufferSize: 1 });
    const timeline = await sink2.readTimeline();

    expect(timeline).toHaveLength(2);
    expect(timeline[0].eventKind).toBe("session.start");
    expect(timeline[1].eventKind).toBe("turn.begin");
  });

  it("prefers storage.list(prefix) when provided", async () => {
    const storage = new FakeDoStorageWithList();
    const sink = new DoStorageTraceSink(storage, TEAM, "sess-list", { maxBufferSize: 1 });

    await sink.emit(makeDurableEvent({ timestamp: "2026-04-16T10:00:00.000Z" }));
    await sink.emit(makeDurableEvent({ timestamp: "2026-04-17T10:00:00.000Z", eventKind: "session.end" }));

    const sink2 = new DoStorageTraceSink(storage, TEAM, "sess-list", { maxBufferSize: 1 });
    const timeline = await sink2.readTimeline();

    expect(timeline).toHaveLength(2);
  });

  it("tenant scoping separates two sessions with the same session uuid under different teams", async () => {
    const storage = new FakeDoStorage();

    const a = new DoStorageTraceSink(storage, "team-A", "sess-shared", { maxBufferSize: 1 });
    const b = new DoStorageTraceSink(storage, "team-B", "sess-shared", { maxBufferSize: 1 });

    await a.emit(makeDurableEvent({ eventKind: "turn.begin", teamUuid: "team-A", timestamp: "2026-04-16T10:00:00.000Z" }));
    await b.emit(makeDurableEvent({ eventKind: "session.start", teamUuid: "team-B", timestamp: "2026-04-16T10:00:00.000Z" }));

    const [aTimeline, bTimeline] = await Promise.all([a.readTimeline(), b.readTimeline()]);
    expect(aTimeline).toHaveLength(1);
    expect(aTimeline[0].eventKind).toBe("turn.begin");
    expect(bTimeline).toHaveLength(1);
    expect(bTimeline[0].eventKind).toBe("session.start");
  });
});
