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
  type TraceEvent as SessionDoTraceEvent,
} from "../src/traces.js";
import {
  isTraceLawCompliant,
  type TraceEvent as EvalTraceEvent,
} from "@nano-agent/eval-observability";

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

// ═══════════════════════════════════════════════════════════════════
// Compile-time mirror drift guard (Kimi A2-A3 review R2)
// ═══════════════════════════════════════════════════════════════════
//
// `session-do-runtime` keeps a LOCAL `TraceEvent` interface so the
// runtime package can be built without depending on
// `@nano-agent/eval-observability` at compile time (eval is a devDep,
// not a prod dep). The following two assignments are the structural
// compatibility check: if the eval-observability `TraceEvent` gains a
// required field, the first assignment fails at `tsc`; if the local
// mirror gains a required field the second assignment fails. Either
// failure is a hard signal to update both sides in lockstep.
//
// The `satisfies` is intentional — we want the whole object literal to
// be checked against the target type without narrowing the inferred
// type. Any property mismatch fires at compile time.

describe("TraceEvent local-mirror ↔ eval-observability structural parity (Kimi R2)", () => {
  it("structurally matches @nano-agent/eval-observability::TraceEvent at compile time", () => {
    const traceCarriers = {
      traceUuid: "00000000-0000-4000-8000-000000000000",
      sourceRole: "session" as const,
      sourceKey: "mirror-drift-guard@v1",
    };
    const local: SessionDoTraceEvent = {
      eventKind: "turn.begin",
      timestamp: "2026-04-18T10:00:00.000Z",
      sessionUuid: "sess-mirror",
      teamUuid: "team-mirror",
      audience: "internal",
      layer: "durable-audit",
      ...traceCarriers,
    };
    // A SessionDoTraceEvent MUST be assignable into the eval TraceEvent.
    const asEval: EvalTraceEvent = local;
    // And back — compile-time check that extending the eval type with
    // a new required field would force a session-do-runtime update.
    const asLocal: SessionDoTraceEvent = asEval;
    expect(asLocal.eventKind).toBe("turn.begin");
    expect(isTraceLawCompliant(asLocal)).toBe(true);
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
