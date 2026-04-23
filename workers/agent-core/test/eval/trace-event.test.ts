/**
 * Tests for TraceEvent shape + A3 Phase 1 trace law.
 *
 * Verifies that the base fields and evidence extension slots compose
 * correctly at the type and runtime level, and that the trace-law
 * validator surfaces every violation in the A3 taxonomy.
 */

import { describe, it, expect } from "vitest";
import type {
  TraceEvent,
  TraceEventBase,
  LlmEvidenceExtension,
  ToolEvidenceExtension,
  StorageEvidenceExtension,
} from "../../src/eval/trace-event.js";
import {
  validateTraceEvent,
  isTraceLawCompliant,
  assertTraceLaw,
} from "../../src/eval/trace-event.js";
import { CONCEPTUAL_LAYER_OF_TRACE_LAYER } from "../../src/eval/types.js";

const TRACE = "11111111-1111-4111-8111-111111111111";
const SESS = "22222222-2222-4222-8222-222222222222";
const TEAM = "team-1";

function makeBase(
  overrides: Partial<TraceEventBase> = {},
): TraceEventBase {
  return {
    eventKind: "turn.begin",
    timestamp: "2026-04-16T10:00:00.000Z",
    traceUuid: TRACE,
    sessionUuid: SESS,
    teamUuid: TEAM,
    sourceRole: "session",
    audience: "internal",
    layer: "durable-audit",
    ...overrides,
  };
}

describe("TraceEvent schema", () => {
  it("accepts a minimal trace-law compliant event", () => {
    const event: TraceEvent = makeBase();
    expect(event.eventKind).toBe("turn.begin");
    expect(event.audience).toBe("internal");
    expect(event.traceUuid).toBe(TRACE);
    expect(event.sourceRole).toBe("session");
  });

  it("accepts an event with LLM evidence fields", () => {
    const event: TraceEvent = {
      ...makeBase({
        eventKind: "api.response",
        timestamp: "2026-04-16T10:00:01.000Z",
      }),
      provider: "anthropic",
      gateway: "cf-ai-gateway",
      attempt: 1,
      cacheState: "hit",
      ttftMs: 123,
      model: "claude-opus-4-7",
      usageTokens: { input: 100, output: 50, cacheRead: 20 },
    };
    expect(event.provider).toBe("anthropic");
    expect(event.usageTokens?.cacheRead).toBe(20);
  });

  it("accepts an event with tool evidence fields", () => {
    const event: TraceEvent = {
      ...makeBase({
        eventKind: "tool.call.result",
        timestamp: "2026-04-16T10:00:02.000Z",
        layer: "durable-transcript",
      }),
      toolName: "read_file",
      resultSizeBytes: 4096,
      durationMs: 42,
    };
    expect(event.toolName).toBe("read_file");
    expect(event.resultSizeBytes).toBe(4096);
  });

  it("accepts an event with storage evidence fields", () => {
    const event: TraceEvent = {
      ...makeBase({
        eventKind: "api.request",
        timestamp: "2026-04-16T10:00:03.000Z",
      }),
      storageLayer: "do",
      key: "tenants/team-1/trace/sess-1/2026-04-16.jsonl",
      op: "put",
      sizeBytes: 512,
    };
    expect(event.storageLayer).toBe("do");
    expect(event.op).toBe("put");
  });

  it("allows combining LLM + tool + storage evidence on the same event", () => {
    const event: TraceEvent = {
      ...makeBase({
        eventKind: "api.response",
        timestamp: "2026-04-16T10:00:04.000Z",
      }),
      provider: "anthropic",
      toolName: "read_file",
      resultSizeBytes: 2048,
      storageLayer: "do",
      op: "get",
    };
    expect(event.provider).toBe("anthropic");
    expect(event.toolName).toBe("read_file");
    expect(event.storageLayer).toBe("do");
  });

  it("extension types are structurally independent of the base", () => {
    const llm: LlmEvidenceExtension = { provider: "openai", attempt: 2 };
    const tool: ToolEvidenceExtension = {
      toolName: "write_file",
      resultSizeBytes: 1,
    };
    const storage: StorageEvidenceExtension = {
      op: "put",
      key: "k",
      sizeBytes: 1,
    };
    expect(llm.provider).toBe("openai");
    expect(tool.toolName).toBe("write_file");
    expect(storage.op).toBe("put");
  });

  it("serializes cleanly as JSON (round-trip preserves all fields)", () => {
    const original: TraceEvent = {
      ...makeBase({
        eventKind: "turn.end",
        timestamp: "2026-04-16T10:00:10.000Z",
        turnUuid: "turn-A",
        stepIndex: 3,
        durationMs: 1200,
        audience: "client-visible",
        layer: "durable-transcript",
        sourceKey: "nano-agent.session.do@v1",
        messageUuid: "33333333-3333-4333-8333-333333333333",
        error: { code: "E1", message: "boom" },
      }),
      provider: "anthropic",
      toolName: "bash",
    };
    const recovered: TraceEvent = JSON.parse(JSON.stringify(original));
    expect(recovered).toEqual(original);
  });
});

describe("validateTraceEvent — A3 Phase 1 trace law", () => {
  it("returns no violations for a well-formed event", () => {
    expect(validateTraceEvent(makeBase())).toEqual([]);
    expect(isTraceLawCompliant(makeBase())).toBe(true);
  });

  it("flags missing traceUuid", () => {
    const violations = validateTraceEvent(
      makeBase({ traceUuid: "" as unknown as string }),
    );
    expect(violations.some((v) => v.reason === "missing-trace-uuid")).toBe(
      true,
    );
  });

  it("flags invalid traceUuid", () => {
    const violations = validateTraceEvent(
      makeBase({ traceUuid: "not-a-uuid" }),
    );
    expect(violations.some((v) => v.reason === "invalid-trace-uuid")).toBe(
      true,
    );
  });

  it("flags missing sourceRole", () => {
    const violations = validateTraceEvent(
      makeBase({ sourceRole: undefined as unknown as any }),
    );
    expect(violations.some((v) => v.reason === "missing-source-role")).toBe(
      true,
    );
  });

  it("flags missing sessionUuid / teamUuid / eventKind / timestamp together", () => {
    const violations = validateTraceEvent({
      traceUuid: TRACE,
      sourceRole: "session",
      audience: "internal",
      layer: "live",
    } as unknown as TraceEvent);
    const reasons = violations.map((v) => v.reason);
    expect(reasons).toContain("missing-session-uuid");
    expect(reasons).toContain("missing-team-uuid");
    expect(reasons).toContain("missing-event-kind");
    expect(reasons).toContain("missing-timestamp");
  });

  it("assertTraceLaw throws with concatenated violation messages", () => {
    expect(() =>
      assertTraceLaw(
        makeBase({ traceUuid: "bad" }),
      ),
    ).toThrow(/trace-law violation/);
  });
});

describe("CONCEPTUAL_LAYER_OF_TRACE_LAYER — A3 / P2 conceptual layering", () => {
  it("maps each implementation TraceLayer to a conceptual layer", () => {
    expect(CONCEPTUAL_LAYER_OF_TRACE_LAYER["live"]).toBe("diagnostic");
    expect(CONCEPTUAL_LAYER_OF_TRACE_LAYER["durable-audit"]).toBe("durable");
    expect(CONCEPTUAL_LAYER_OF_TRACE_LAYER["durable-transcript"]).toBe(
      "durable",
    );
  });
});
