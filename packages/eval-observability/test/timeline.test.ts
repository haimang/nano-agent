/**
 * Tests for SessionTimeline.
 */

import { describe, it, expect } from "vitest";
import { SessionTimeline } from "../src/timeline.js";
import type { TraceEvent } from "../src/trace-event.js";

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-16T10:00:00.000Z",
    // A2-A3 review R3: carriers required by trace-law since A3
    traceUuid: "00000000-0000-4000-8000-000000000001",
    sourceRole: "session",
    sourceKey: "test-fixture@v1",
    sessionUuid: "sess-001",
    teamUuid: "team-001",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("SessionTimeline", () => {
  describe("addEvent and getEvents", () => {
    it("returns events sorted by timestamp", () => {
      const timeline = new SessionTimeline();

      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:03:00.000Z", eventKind: "turn.end" }));
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:01:00.000Z", eventKind: "turn.begin" }));
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:02:00.000Z", eventKind: "tool.call.result" }));

      const events = timeline.getEvents();
      expect(events).toHaveLength(3);
      expect(events[0].timestamp).toBe("2026-04-16T10:01:00.000Z");
      expect(events[1].timestamp).toBe("2026-04-16T10:02:00.000Z");
      expect(events[2].timestamp).toBe("2026-04-16T10:03:00.000Z");
    });

    it("returns an empty array for an empty timeline", () => {
      const timeline = new SessionTimeline();
      expect(timeline.getEvents()).toEqual([]);
    });

    it("returns a copy of events (not a reference)", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent());

      const events = timeline.getEvents();
      events.push(makeEvent({ eventKind: "session.end" }));
      expect(timeline.getEvents()).toHaveLength(1);
    });
  });

  describe("filterByKind", () => {
    it("returns only events with the specified kind", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ eventKind: "turn.begin", timestamp: "2026-04-16T10:00:00.000Z" }));
      timeline.addEvent(makeEvent({ eventKind: "tool.call.result", timestamp: "2026-04-16T10:01:00.000Z" }));
      timeline.addEvent(makeEvent({ eventKind: "turn.end", timestamp: "2026-04-16T10:02:00.000Z" }));
      timeline.addEvent(makeEvent({ eventKind: "turn.begin", timestamp: "2026-04-16T10:03:00.000Z" }));

      const turns = timeline.filterByKind("turn.begin");
      expect(turns).toHaveLength(2);
      expect(turns.every((e) => e.eventKind === "turn.begin")).toBe(true);
    });

    it("returns an empty array when no events match", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ eventKind: "turn.begin" }));

      expect(timeline.filterByKind("session.start")).toEqual([]);
    });
  });

  describe("filterByTurn", () => {
    it("returns only events belonging to the specified turn", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ turnUuid: "turn-A", eventKind: "turn.begin", timestamp: "2026-04-16T10:00:00.000Z" }));
      timeline.addEvent(makeEvent({ turnUuid: "turn-A", eventKind: "tool.call.result", timestamp: "2026-04-16T10:01:00.000Z" }));
      timeline.addEvent(makeEvent({ turnUuid: "turn-B", eventKind: "turn.begin", timestamp: "2026-04-16T10:02:00.000Z" }));
      timeline.addEvent(makeEvent({ turnUuid: "turn-A", eventKind: "turn.end", timestamp: "2026-04-16T10:03:00.000Z" }));

      const turnA = timeline.filterByTurn("turn-A");
      expect(turnA).toHaveLength(3);
      expect(turnA.every((e) => e.turnUuid === "turn-A")).toBe(true);
    });

    it("returns an empty array when no events match the turn", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ turnUuid: "turn-A" }));

      expect(timeline.filterByTurn("turn-nonexistent")).toEqual([]);
    });

    it("handles events with multiple different turns", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ turnUuid: "turn-A", timestamp: "2026-04-16T10:00:00.000Z" }));
      timeline.addEvent(makeEvent({ turnUuid: "turn-B", timestamp: "2026-04-16T10:01:00.000Z" }));
      timeline.addEvent(makeEvent({ turnUuid: "turn-C", timestamp: "2026-04-16T10:02:00.000Z" }));

      expect(timeline.filterByTurn("turn-B")).toHaveLength(1);
      expect(timeline.filterByTurn("turn-B")[0].turnUuid).toBe("turn-B");
    });
  });

  describe("getTimeRange", () => {
    it("returns the first and last timestamps", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:05:00.000Z" }));
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:01:00.000Z" }));
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:10:00.000Z" }));

      const range = timeline.getTimeRange();
      expect(range).not.toBeNull();
      expect(range!.first).toBe("2026-04-16T10:01:00.000Z");
      expect(range!.last).toBe("2026-04-16T10:10:00.000Z");
    });

    it("returns null for an empty timeline", () => {
      const timeline = new SessionTimeline();
      expect(timeline.getTimeRange()).toBeNull();
    });

    it("returns same first and last for a single-event timeline", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:00:00.000Z" }));

      const range = timeline.getTimeRange();
      expect(range).not.toBeNull();
      expect(range!.first).toBe("2026-04-16T10:00:00.000Z");
      expect(range!.last).toBe("2026-04-16T10:00:00.000Z");
    });
  });

  describe("size", () => {
    it("returns 0 for an empty timeline", () => {
      expect(new SessionTimeline().size()).toBe(0);
    });

    it("returns the correct count", () => {
      const timeline = new SessionTimeline();
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:00:00.000Z" }));
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:01:00.000Z" }));
      timeline.addEvent(makeEvent({ timestamp: "2026-04-16T10:02:00.000Z" }));

      expect(timeline.size()).toBe(3);
    });
  });
});
