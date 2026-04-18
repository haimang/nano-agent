/**
 * Tests for audit-record codec: traceEventToAuditBody / auditBodyToTraceEvent.
 */

import { describe, it, expect } from "vitest";
import { traceEventToAuditBody, auditBodyToTraceEvent } from "../src/audit-record.js";
import type { TraceEvent } from "../src/trace-event.js";

const TRACE_UUID = "11111111-1111-4111-8111-111111111111";

function makeDurableEvent(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-16T10:00:00.000Z",
    traceUuid: TRACE_UUID,
    sessionUuid: "sess-001",
    teamUuid: "team-001",
    sourceRole: "session",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("traceEventToAuditBody", () => {
  it("converts a durable event into an audit body", () => {
    const event = makeDurableEvent({
      turnUuid: "turn-001",
      stepIndex: 3,
    });

    const body = traceEventToAuditBody(event);
    expect(body).not.toBeNull();
    expect(body!.event_kind).toBe("turn.begin");
    expect(body!.detail.turnUuid).toBe("turn-001");
    expect(body!.detail.stepIndex).toBe(3);
    expect(body!.detail.audience).toBe("internal");
    expect(body!.detail.layer).toBe("durable-audit");
  });

  it("excludes envelope fields (timestamp, sessionUuid, teamUuid) from detail", () => {
    const event = makeDurableEvent();
    const body = traceEventToAuditBody(event);

    expect(body).not.toBeNull();
    expect(body!.detail).not.toHaveProperty("timestamp");
    expect(body!.detail).not.toHaveProperty("sessionUuid");
    expect(body!.detail).not.toHaveProperty("teamUuid");
    expect(body!.detail).not.toHaveProperty("eventKind");
  });

  it("returns null for live-only events", () => {
    const liveEvent = makeDurableEvent({ eventKind: "llm.delta" });
    expect(traceEventToAuditBody(liveEvent)).toBeNull();
  });

  it("returns null for unknown event kinds (default to live)", () => {
    const unknownEvent = makeDurableEvent({ eventKind: "custom.unknown.thing" });
    expect(traceEventToAuditBody(unknownEvent)).toBeNull();
  });

  it("truncates large string fields in the detail object", () => {
    const largeString = "x".repeat(50_000);
    const event = makeDurableEvent({
      eventKind: "tool.call.result",
      toolName: largeString,
    });

    const body = traceEventToAuditBody(event);
    expect(body).not.toBeNull();

    const toolName = body!.detail.toolName as string;
    expect(toolName.length).toBeLessThan(largeString.length);
    expect(toolName).toContain("[truncated:");
  });

  it("preserves non-string fields without truncation", () => {
    const event = makeDurableEvent({
      eventKind: "api.response",
      usageTokens: { input: 1000, output: 500 },
      durationMs: 1234,
    });

    const body = traceEventToAuditBody(event);
    expect(body).not.toBeNull();
    expect(body!.detail.usageTokens).toEqual({ input: 1000, output: 500 });
    expect(body!.detail.durationMs).toBe(1234);
  });

  it("includes LLM evidence extension fields", () => {
    const event = makeDurableEvent({
      eventKind: "api.request",
      provider: "anthropic",
      model: "claude-3",
      ttftMs: 42,
    });

    const body = traceEventToAuditBody(event);
    expect(body).not.toBeNull();
    expect(body!.detail.provider).toBe("anthropic");
    expect(body!.detail.model).toBe("claude-3");
    expect(body!.detail.ttftMs).toBe(42);
  });

  it("omits undefined fields from detail", () => {
    const event = makeDurableEvent({
      eventKind: "session.start",
      turnUuid: undefined,
      durationMs: undefined,
    });

    const body = traceEventToAuditBody(event);
    expect(body).not.toBeNull();
    expect(body!.detail).not.toHaveProperty("turnUuid");
    expect(body!.detail).not.toHaveProperty("durationMs");
  });
});

describe("auditBodyToTraceEvent", () => {
  const meta = {
    sessionUuid: "sess-001",
    teamUuid: "team-001",
    timestamp: "2026-04-16T10:00:00.000Z",
    traceUuid: TRACE_UUID,
    sourceRole: "session" as const,
  };

  it("reconstructs a TraceEvent from body and meta", () => {
    const body = {
      event_kind: "turn.begin",
      detail: {
        turnUuid: "turn-001",
        audience: "internal",
        layer: "durable-audit",
        stepIndex: 3,
      },
    };

    const event = auditBodyToTraceEvent(body, meta);
    expect(event.eventKind).toBe("turn.begin");
    expect(event.timestamp).toBe("2026-04-16T10:00:00.000Z");
    expect(event.sessionUuid).toBe("sess-001");
    expect(event.teamUuid).toBe("team-001");
    expect(event.traceUuid).toBe(TRACE_UUID);
    expect(event.sourceRole).toBe("session");
    expect(event.turnUuid).toBe("turn-001");
    expect(event.stepIndex).toBe(3);
    expect(event.audience).toBe("internal");
    expect(event.layer).toBe("durable-audit");
  });

  it("prefers traceUuid / sourceRole in detail over meta", () => {
    const body = {
      event_kind: "turn.begin",
      detail: {
        traceUuid: "22222222-2222-4222-8222-222222222222",
        sourceRole: "capability",
      },
    };
    const event = auditBodyToTraceEvent(body, meta);
    expect(event.traceUuid).toBe("22222222-2222-4222-8222-222222222222");
    expect(event.sourceRole).toBe("capability");
  });

  it("defaults audience and layer when missing from detail", () => {
    const body = { event_kind: "session.start" };
    const event = auditBodyToTraceEvent(body, meta);

    expect(event.audience).toBe("internal");
    expect(event.layer).toBe("durable-audit");
  });

  it("handles empty detail (trace carriers come from meta)", () => {
    const body = { event_kind: "session.end", detail: {} };
    const event = auditBodyToTraceEvent(body, meta);

    expect(event.eventKind).toBe("session.end");
    expect(event.traceUuid).toBe(TRACE_UUID);
    expect(event.sourceRole).toBe("session");
    expect(event.audience).toBe("internal");
  });

  it("throws when trace law cannot be satisfied (no traceUuid anywhere)", () => {
    const body = { event_kind: "turn.begin", detail: {} };
    const partialMeta = {
      sessionUuid: "sess-001",
      teamUuid: "team-001",
      timestamp: "2026-04-16T10:00:00.000Z",
      sourceRole: "session" as const,
    };
    expect(() => auditBodyToTraceEvent(body, partialMeta)).toThrow(
      /trace law violation/,
    );
  });

  it("throws when sourceRole cannot be satisfied", () => {
    const body = { event_kind: "turn.begin", detail: {} };
    const partialMeta = {
      sessionUuid: "sess-001",
      teamUuid: "team-001",
      timestamp: "2026-04-16T10:00:00.000Z",
      traceUuid: TRACE_UUID,
    };
    expect(() => auditBodyToTraceEvent(body, partialMeta)).toThrow(
      /trace law violation/,
    );
  });
});

describe("roundtrip: encode then decode", () => {
  it("round-trips a durable event through encode/decode", () => {
    const original = makeDurableEvent({
      eventKind: "turn.begin",
      turnUuid: "turn-roundtrip",
      stepIndex: 7,
      durationMs: 150,
    });

    const body = traceEventToAuditBody(original);
    expect(body).not.toBeNull();

    const meta = {
      sessionUuid: original.sessionUuid,
      teamUuid: original.teamUuid,
      timestamp: original.timestamp,
    };

    const decoded = auditBodyToTraceEvent(body!, meta);
    expect(decoded.eventKind).toBe(original.eventKind);
    expect(decoded.timestamp).toBe(original.timestamp);
    expect(decoded.sessionUuid).toBe(original.sessionUuid);
    expect(decoded.teamUuid).toBe(original.teamUuid);
    expect(decoded.traceUuid).toBe(original.traceUuid);
    expect(decoded.sourceRole).toBe(original.sourceRole);
    expect(decoded.turnUuid).toBe(original.turnUuid);
    expect(decoded.stepIndex).toBe(original.stepIndex);
    expect(decoded.durationMs).toBe(original.durationMs);
    expect(decoded.audience).toBe(original.audience);
    expect(decoded.layer).toBe(original.layer);
  });

  it("round-trips an event with LLM evidence extensions", () => {
    const original = makeDurableEvent({
      eventKind: "api.response",
      usageTokens: { input: 200, output: 100 },
      provider: "anthropic",
      model: "claude-opus",
      ttftMs: 55,
    });

    const body = traceEventToAuditBody(original);
    expect(body).not.toBeNull();

    const meta = {
      sessionUuid: original.sessionUuid,
      teamUuid: original.teamUuid,
      timestamp: original.timestamp,
    };

    const decoded = auditBodyToTraceEvent(body!, meta);
    expect(decoded.usageTokens).toEqual({ input: 200, output: 100 });
    expect(decoded.provider).toBe("anthropic");
    expect(decoded.model).toBe("claude-opus");
    expect(decoded.ttftMs).toBe(55);
  });
});
