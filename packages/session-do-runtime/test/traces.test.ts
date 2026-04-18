/**
 * Tests for session DO trace builders.
 *
 * After A3 P2-03 the builders emit canonical trace-law-compliant events
 * (`turn.begin` / `turn.end`), carry `traceUuid` + `sourceRole`, and map
 * kernel runtime step kinds to canonical trace event kinds.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTurnBeginTrace,
  buildTurnEndTrace,
  buildStepTrace,
  mapRuntimeStepKindToTraceKind,
  type TraceContext,
} from "../src/traces.js";
import { isTraceLawCompliant } from "@nano-agent/eval-observability";

const CTX: TraceContext = {
  sessionUuid: "11111111-1111-4111-8111-111111111111",
  teamUuid: "team-xyz",
  traceUuid: "22222222-2222-4222-8222-222222222222",
  sourceRole: "session",
  sourceKey: "nano-agent.session.do@v1",
};

describe("buildTurnBeginTrace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits eventKind turn.begin (renamed from turn.started)", () => {
    const trace = buildTurnBeginTrace("turn-001", CTX);
    expect(trace.eventKind).toBe("turn.begin");
  });

  it("carries traceUuid and sourceRole (trace-law compliant)", () => {
    const trace = buildTurnBeginTrace("turn-001", CTX);
    expect(trace.traceUuid).toBe(CTX.traceUuid);
    expect(trace.sourceRole).toBe("session");
    expect(isTraceLawCompliant(trace)).toBe(true);
  });

  it("carries sessionUuid, teamUuid, turnUuid, sourceKey", () => {
    const trace = buildTurnBeginTrace("turn-001", CTX);
    expect(trace.sessionUuid).toBe(CTX.sessionUuid);
    expect(trace.teamUuid).toBe(CTX.teamUuid);
    expect(trace.turnUuid).toBe("turn-001");
    expect(trace.sourceKey).toBe("nano-agent.session.do@v1");
  });

  it("includes the current timestamp", () => {
    const trace = buildTurnBeginTrace("turn-001", CTX);
    expect(trace.timestamp).toBe("2026-04-16T12:00:00.000Z");
  });

  it("sets audience=internal, layer=durable-audit", () => {
    const trace = buildTurnBeginTrace("turn-001", CTX);
    expect(trace.audience).toBe("internal");
    expect(trace.layer).toBe("durable-audit");
  });
});

describe("buildTurnEndTrace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits eventKind turn.end (renamed from turn.completed)", () => {
    const trace = buildTurnEndTrace("turn-001", 5000, CTX);
    expect(trace.eventKind).toBe("turn.end");
  });

  it("includes durationMs", () => {
    const trace = buildTurnEndTrace("turn-001", 1234, CTX);
    expect(trace.durationMs).toBe(1234);
  });

  it("is trace-law compliant", () => {
    const trace = buildTurnEndTrace("turn-001", 100, CTX);
    expect(isTraceLawCompliant(trace)).toBe(true);
  });

  it("sets audience=internal, layer=durable-audit", () => {
    const trace = buildTurnEndTrace("turn-001", 100, CTX);
    expect(trace.audience).toBe("internal");
    expect(trace.layer).toBe("durable-audit");
  });
});

describe("buildStepTrace", () => {
  it("maps runtime turn.started -> canonical turn.begin", () => {
    const trace = buildStepTrace(
      { type: "turn.started", turnId: "turn-001" },
      CTX,
    );
    expect(trace.eventKind).toBe("turn.begin");
  });

  it("maps runtime turn.completed -> canonical turn.end", () => {
    const trace = buildStepTrace(
      { type: "turn.completed", turnId: "turn-001" },
      CTX,
    );
    expect(trace.eventKind).toBe("turn.end");
  });

  it("passes llm.delta through unchanged", () => {
    const trace = buildStepTrace({ type: "llm.delta" }, CTX);
    expect(trace.eventKind).toBe("llm.delta");
  });

  it("falls through for unknown kinds", () => {
    const trace = buildStepTrace({ type: "custom.probe" }, CTX);
    expect(trace.eventKind).toBe("custom.probe");
  });

  it("defaults to step when no type is provided", () => {
    const trace = buildStepTrace({}, CTX);
    expect(trace.eventKind).toBe("step");
  });

  it("carries traceUuid / sourceRole on every step event", () => {
    const trace = buildStepTrace(
      { type: "tool.call.result", turnId: "turn-7" },
      CTX,
    );
    expect(trace.traceUuid).toBe(CTX.traceUuid);
    expect(trace.sourceRole).toBe("session");
    expect(trace.turnUuid).toBe("turn-7");
  });

  it("preserves kernel timestamp when present", () => {
    const trace = buildStepTrace(
      { type: "llm.delta", timestamp: "2026-04-17T00:00:03.000Z" },
      CTX,
    );
    expect(trace.timestamp).toBe("2026-04-17T00:00:03.000Z");
  });

  it("is trace-law compliant for steps emitted with context", () => {
    const trace = buildStepTrace(
      { type: "llm.delta", turnId: "turn-1" },
      CTX,
    );
    expect(isTraceLawCompliant(trace)).toBe(true);
  });

  it("sets layer=live for step events (diagnostic)", () => {
    const trace = buildStepTrace({ type: "llm.delta" }, CTX);
    expect(trace.layer).toBe("live");
  });
});

describe("mapRuntimeStepKindToTraceKind", () => {
  it("maps known legacy kinds to canonical kinds", () => {
    expect(mapRuntimeStepKindToTraceKind("turn.started")).toBe("turn.begin");
    expect(mapRuntimeStepKindToTraceKind("turn.completed")).toBe("turn.end");
  });

  it("passes canonical kinds through unchanged", () => {
    expect(mapRuntimeStepKindToTraceKind("tool.call.result")).toBe(
      "tool.call.result",
    );
    expect(mapRuntimeStepKindToTraceKind("llm.delta")).toBe("llm.delta");
  });

  it("returns the input unchanged for unknown kinds", () => {
    expect(mapRuntimeStepKindToTraceKind("future.custom")).toBe(
      "future.custom",
    );
  });
});
