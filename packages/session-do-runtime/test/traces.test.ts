/**
 * Tests for trace building functions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTurnStartTrace,
  buildTurnEndTrace,
  buildStepTrace,
} from "../src/traces.js";

describe("buildTurnStartTrace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces a trace with eventKind turn.started", () => {
    const trace = buildTurnStartTrace("turn-001", "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.eventKind).toBe("turn.started");
  });

  it("includes sessionUuid and teamUuid", () => {
    const trace = buildTurnStartTrace("turn-001", "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.sessionUuid).toBe("session-abc");
    expect(trace.teamUuid).toBe("team-xyz");
  });

  it("includes turnUuid", () => {
    const trace = buildTurnStartTrace("turn-001", "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.turnUuid).toBe("turn-001");
  });

  it("includes a timestamp", () => {
    const trace = buildTurnStartTrace("turn-001", "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.timestamp).toBe("2026-04-16T12:00:00.000Z");
  });

  it("sets audience to internal", () => {
    const trace = buildTurnStartTrace("turn-001", "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.audience).toBe("internal");
  });

  it("sets layer to durable-audit", () => {
    const trace = buildTurnStartTrace("turn-001", "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.layer).toBe("durable-audit");
  });
});

describe("buildTurnEndTrace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:05:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces a trace with eventKind turn.completed", () => {
    const trace = buildTurnEndTrace("turn-001", "session-abc", "team-xyz", 5000) as Record<string, unknown>;

    expect(trace.eventKind).toBe("turn.completed");
  });

  it("includes durationMs", () => {
    const trace = buildTurnEndTrace("turn-001", "session-abc", "team-xyz", 5000) as Record<string, unknown>;

    expect(trace.durationMs).toBe(5000);
  });

  it("includes sessionUuid and teamUuid", () => {
    const trace = buildTurnEndTrace("turn-001", "session-abc", "team-xyz", 1234) as Record<string, unknown>;

    expect(trace.sessionUuid).toBe("session-abc");
    expect(trace.teamUuid).toBe("team-xyz");
  });

  it("includes turnUuid", () => {
    const trace = buildTurnEndTrace("turn-001", "session-abc", "team-xyz", 500) as Record<string, unknown>;

    expect(trace.turnUuid).toBe("turn-001");
  });

  it("sets audience to internal", () => {
    const trace = buildTurnEndTrace("turn-001", "session-abc", "team-xyz", 100) as Record<string, unknown>;

    expect(trace.audience).toBe("internal");
  });

  it("sets layer to durable-audit", () => {
    const trace = buildTurnEndTrace("turn-001", "session-abc", "team-xyz", 100) as Record<string, unknown>;

    expect(trace.layer).toBe("durable-audit");
  });
});

describe("buildStepTrace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:30.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("extracts eventKind from event type field", () => {
    const event = { type: "llm.delta", turnId: "t1", delta: "hello", timestamp: "2026-04-16T12:00:00.000Z" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.eventKind).toBe("llm.delta");
  });

  it("falls back to 'step' if event has no type", () => {
    const event = { data: "something" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.eventKind).toBe("step");
  });

  it("uses event timestamp when available", () => {
    const event = { type: "tool.call.result", timestamp: "2026-04-16T12:00:15.000Z" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.timestamp).toBe("2026-04-16T12:00:15.000Z");
  });

  it("falls back to current time when event has no timestamp", () => {
    const event = { type: "compact.notify" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.timestamp).toBe("2026-04-16T12:00:30.000Z");
  });

  it("includes sessionUuid and teamUuid", () => {
    const event = { type: "hook.broadcast" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.sessionUuid).toBe("session-abc");
    expect(trace.teamUuid).toBe("team-xyz");
  });

  it("extracts turnUuid from event if present", () => {
    const event = { type: "llm.delta", turnId: "turn-99" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.turnUuid).toBe("turn-99");
  });

  it("leaves turnUuid undefined when event has no turnId", () => {
    const event = { type: "system.notify" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.turnUuid).toBeUndefined();
  });

  it("extracts stepIndex from event if present", () => {
    const event = { type: "tool.call.result", stepIndex: 7 };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.stepIndex).toBe(7);
  });

  it("sets audience to internal", () => {
    const event = { type: "llm.delta" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.audience).toBe("internal");
  });

  it("sets layer to live", () => {
    const event = { type: "llm.delta" };
    const trace = buildStepTrace(event, "session-abc", "team-xyz") as Record<string, unknown>;

    expect(trace.layer).toBe("live");
  });
});
