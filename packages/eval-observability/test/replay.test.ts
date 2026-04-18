/**
 * Tests for FailureReplayHelper.
 */

import { describe, it, expect } from "vitest";
import { FailureReplayHelper } from "../src/replay.js";
import { SessionTimeline } from "../src/timeline.js";
import type { TraceEvent } from "../src/trace-event.js";

function makeEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-16T10:00:00.000Z",
    // A2-A3 review R3: trace-law carriers
    traceUuid: "00000000-0000-4000-8000-000000000003",
    sourceRole: "session",
    sourceKey: "test-fixture@v1",
    sessionUuid: "sess-001",
    teamUuid: "team-001",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

function buildTimeline(events: Partial<TraceEvent>[]): SessionTimeline {
  const timeline = new SessionTimeline();
  for (const e of events) {
    timeline.addEvent(makeEvent(e));
  }
  return timeline;
}

describe("FailureReplayHelper", () => {
  describe("fromTimeline", () => {
    it("constructs from a SessionTimeline", () => {
      const timeline = buildTimeline([{ eventKind: "turn.begin" }]);
      const helper = FailureReplayHelper.fromTimeline(timeline);
      expect(helper).toBeInstanceOf(FailureReplayHelper);
    });
  });

  describe("getFailureEvents", () => {
    it("returns events with error fields", () => {
      const timeline = buildTimeline([
        { eventKind: "turn.begin", timestamp: "2026-04-16T10:00:00.000Z" },
        {
          eventKind: "api.error",
          timestamp: "2026-04-16T10:01:00.000Z",
          error: { code: "TIMEOUT", message: "Request timed out" },
        },
        { eventKind: "turn.end", timestamp: "2026-04-16T10:02:00.000Z" },
        {
          eventKind: "api.error",
          timestamp: "2026-04-16T10:03:00.000Z",
          error: { code: "RATE_LIMIT", message: "Too many requests" },
        },
      ]);

      const helper = FailureReplayHelper.fromTimeline(timeline);
      const failures = helper.getFailureEvents();

      expect(failures).toHaveLength(2);
      expect(failures[0].eventKind).toBe("api.error");
      expect(failures[0].error?.code).toBe("TIMEOUT");
      expect(failures[1].error?.code).toBe("RATE_LIMIT");
    });

    it("returns empty array when no errors", () => {
      const timeline = buildTimeline([
        { eventKind: "turn.begin" },
        { eventKind: "turn.end" },
      ]);

      const helper = FailureReplayHelper.fromTimeline(timeline);
      expect(helper.getFailureEvents()).toEqual([]);
    });
  });

  describe("buildFailureSummary", () => {
    it("returns summary with error count and kinds", () => {
      const timeline = buildTimeline([
        {
          eventKind: "api.error",
          timestamp: "2026-04-16T10:01:00.000Z",
          error: { code: "TIMEOUT", message: "timeout" },
        },
        {
          eventKind: "hook.outcome",
          timestamp: "2026-04-16T10:02:00.000Z",
          error: { code: "HOOK_FAIL", message: "hook failed" },
        },
        {
          eventKind: "api.error",
          timestamp: "2026-04-16T10:03:00.000Z",
          error: { code: "RATE_LIMIT", message: "rate limited" },
        },
      ]);

      const helper = FailureReplayHelper.fromTimeline(timeline);
      const summary = helper.buildFailureSummary();

      expect(summary.errorCount).toBe(3);
      expect(summary.firstError?.eventKind).toBe("api.error");
      expect(summary.firstError?.error?.code).toBe("TIMEOUT");
      expect(summary.lastError?.eventKind).toBe("api.error");
      expect(summary.lastError?.error?.code).toBe("RATE_LIMIT");
      expect(summary.errorKinds).toContain("api.error");
      expect(summary.errorKinds).toContain("hook.outcome");
      expect(summary.errorKinds).toHaveLength(2);
    });

    it("returns zeroed summary when no errors", () => {
      const timeline = buildTimeline([
        { eventKind: "turn.begin" },
      ]);

      const helper = FailureReplayHelper.fromTimeline(timeline);
      const summary = helper.buildFailureSummary();

      expect(summary.errorCount).toBe(0);
      expect(summary.firstError).toBeNull();
      expect(summary.lastError).toBeNull();
      expect(summary.errorKinds).toEqual([]);
    });
  });

  describe("getEventsBefore", () => {
    it("returns events before the given timestamp", () => {
      const timeline = buildTimeline([
        { eventKind: "a", timestamp: "2026-04-16T10:00:00.000Z" },
        { eventKind: "b", timestamp: "2026-04-16T10:01:00.000Z" },
        { eventKind: "c", timestamp: "2026-04-16T10:02:00.000Z" },
        { eventKind: "d", timestamp: "2026-04-16T10:03:00.000Z" },
        { eventKind: "e", timestamp: "2026-04-16T10:04:00.000Z" },
      ]);

      const helper = FailureReplayHelper.fromTimeline(timeline);
      const before = helper.getEventsBefore("2026-04-16T10:03:00.000Z", 2);

      expect(before).toHaveLength(2);
      expect(before[0].eventKind).toBe("b");
      expect(before[1].eventKind).toBe("c");
    });

    it("returns all matching events when fewer than count", () => {
      const timeline = buildTimeline([
        { eventKind: "a", timestamp: "2026-04-16T10:00:00.000Z" },
        { eventKind: "b", timestamp: "2026-04-16T10:01:00.000Z" },
      ]);

      const helper = FailureReplayHelper.fromTimeline(timeline);
      const before = helper.getEventsBefore("2026-04-16T10:05:00.000Z", 10);

      expect(before).toHaveLength(2);
    });

    it("returns empty array when no events before timestamp", () => {
      const timeline = buildTimeline([
        { eventKind: "a", timestamp: "2026-04-16T10:05:00.000Z" },
      ]);

      const helper = FailureReplayHelper.fromTimeline(timeline);
      const before = helper.getEventsBefore("2026-04-16T10:00:00.000Z");

      expect(before).toEqual([]);
    });

    it("defaults to 10 events", () => {
      const events: Partial<TraceEvent>[] = [];
      for (let i = 0; i < 20; i++) {
        const minute = String(i).padStart(2, "0");
        events.push({
          eventKind: `event-${i}`,
          timestamp: `2026-04-16T10:${minute}:00.000Z`,
        });
      }

      const timeline = buildTimeline(events);
      const helper = FailureReplayHelper.fromTimeline(timeline);
      const before = helper.getEventsBefore("2026-04-16T10:30:00.000Z");

      expect(before).toHaveLength(10);
    });
  });
});
