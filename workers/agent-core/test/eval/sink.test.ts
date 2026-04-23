/**
 * Tests for the TraceSink interface compliance.
 *
 * Since TraceSink is an interface, we verify that concrete implementations
 * satisfy the contract by creating a minimal test double.
 */

import { describe, it, expect } from "vitest";
import type { TraceSink } from "../../src/eval/sink.js";
import type { TraceEvent } from "../../src/eval/trace-event.js";

/** A minimal in-memory TraceSink for interface compliance testing. */
class InMemoryTraceSink implements TraceSink {
  readonly events: TraceEvent[] = [];
  flushed = false;

  async emit(event: TraceEvent): Promise<void> {
    this.events.push(event);
  }

  async flush(): Promise<void> {
    this.flushed = true;
  }
}

function makeDurableEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-16T10:00:00.000Z",
    // A2-A3 review R3: trace-law carriers
    traceUuid: "00000000-0000-4000-8000-000000000004",
    sourceRole: "session",
    sourceKey: "test-fixture@v1",
    sessionUuid: "sess-001",
    teamUuid: "team-001",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("TraceSink interface", () => {
  it("emit() accepts a TraceEvent and returns a Promise", async () => {
    const sink: TraceSink = new InMemoryTraceSink();
    const event = makeDurableEvent();

    const result = sink.emit(event);
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("flush() returns a Promise", async () => {
    const sink: TraceSink = new InMemoryTraceSink();

    const result = sink.flush();
    expect(result).toBeInstanceOf(Promise);
    await result;
  });

  it("emitted events are retrievable from the concrete implementation", async () => {
    const sink = new InMemoryTraceSink();
    const event = makeDurableEvent();

    await sink.emit(event);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toBe(event);
  });

  it("flush marks the sink as flushed", async () => {
    const sink = new InMemoryTraceSink();
    expect(sink.flushed).toBe(false);

    await sink.flush();
    expect(sink.flushed).toBe(true);
  });

  it("emit can be called multiple times", async () => {
    const sink = new InMemoryTraceSink();

    await sink.emit(makeDurableEvent({ eventKind: "turn.begin" }));
    await sink.emit(makeDurableEvent({ eventKind: "turn.end" }));
    await sink.emit(makeDurableEvent({ eventKind: "session.start" }));

    expect(sink.events).toHaveLength(3);
  });
});
