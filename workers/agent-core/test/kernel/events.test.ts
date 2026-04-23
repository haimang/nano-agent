import { describe, it, expect } from "vitest";
import {
  mapRuntimeEventToStreamKind,
  buildStreamEventBody,
} from "../../src/kernel/events.js";
import type { RuntimeEvent } from "../../src/kernel/types.js";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

const NOW = "2026-01-01T00:00:00.000Z";
// Arbitrary stable UUID (not validated by events.ts itself — caller's
// responsibility — but we use a real UUID so example bodies match the
// NACP schema expectations).
const TURN_UUID = "11111111-1111-4111-8111-111111111111";
const REQ_UUID = "22222222-2222-4222-8222-222222222222";

// ═══════════════════════════════════════════════════════════════════
// mapRuntimeEventToStreamKind
// ═══════════════════════════════════════════════════════════════════

describe("mapRuntimeEventToStreamKind", () => {
  it("maps turn.started → turn.begin", () => {
    const event: RuntimeEvent = {
      type: "turn.started",
      turnId: TURN_UUID,
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("turn.begin");
  });

  it("maps turn.completed → turn.end", () => {
    const event: RuntimeEvent = {
      type: "turn.completed",
      turnId: TURN_UUID,
      reason: "done",
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("turn.end");
  });

  it("maps llm.delta → llm.delta", () => {
    const event: RuntimeEvent = {
      type: "llm.delta",
      turnId: TURN_UUID,
      contentType: "text",
      content: "hello",
      isFinal: false,
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("llm.delta");
  });

  it("maps tool.call.progress → tool.call.progress", () => {
    const event: RuntimeEvent = {
      type: "tool.call.progress",
      turnId: TURN_UUID,
      toolName: "bash",
      requestId: REQ_UUID,
      chunk: "partial",
      isFinal: false,
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("tool.call.progress");
  });

  it("maps tool.call.result → tool.call.result", () => {
    const event: RuntimeEvent = {
      type: "tool.call.result",
      turnId: TURN_UUID,
      toolName: "bash",
      requestId: REQ_UUID,
      status: "ok",
      output: "output",
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("tool.call.result");
  });

  it("maps hook.broadcast → hook.broadcast", () => {
    const event: RuntimeEvent = {
      type: "hook.broadcast",
      event: "test",
      payloadRedacted: {},
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("hook.broadcast");
  });

  it("maps compact.notify → compact.notify", () => {
    const event: RuntimeEvent = {
      type: "compact.notify",
      status: "completed",
      tokensBefore: 1000,
      tokensAfter: 800,
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("compact.notify");
  });

  it("maps system.notify → system.notify", () => {
    const event: RuntimeEvent = {
      type: "system.notify",
      severity: "info",
      message: "test",
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("system.notify");
  });

  it("maps session.update → session.update", () => {
    const event: RuntimeEvent = {
      type: "session.update",
      phase: "idle",
      turnCount: 0,
      timestamp: NOW,
    };
    expect(mapRuntimeEventToStreamKind(event)).toBe("session.update");
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildStreamEventBody
// ═══════════════════════════════════════════════════════════════════

describe("buildStreamEventBody", () => {
  it("builds turn.begin body with turn_uuid", () => {
    const event: RuntimeEvent = {
      type: "turn.started",
      turnId: TURN_UUID,
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "turn.begin",
      turn_uuid: TURN_UUID,
    });
  });

  it("builds turn.end body with turn_uuid and optional usage", () => {
    const event: RuntimeEvent = {
      type: "turn.completed",
      turnId: TURN_UUID,
      reason: "done",
      usage: { total: 100 },
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "turn.end",
      turn_uuid: TURN_UUID,
      usage: { total: 100 },
    });
  });

  it("omits usage when not present on turn.completed", () => {
    const event: RuntimeEvent = {
      type: "turn.completed",
      turnId: TURN_UUID,
      reason: "done",
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "turn.end",
      turn_uuid: TURN_UUID,
    });
  });

  it("builds llm.delta body with content_type / content / is_final", () => {
    const event: RuntimeEvent = {
      type: "llm.delta",
      turnId: TURN_UUID,
      contentType: "text",
      content: "hello",
      isFinal: false,
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "llm.delta",
      content_type: "text",
      content: "hello",
      is_final: false,
    });
  });

  it("builds tool.call.progress body with tool_name / request_uuid / chunk / is_final", () => {
    const event: RuntimeEvent = {
      type: "tool.call.progress",
      turnId: TURN_UUID,
      toolName: "bash",
      requestId: REQ_UUID,
      chunk: "partial output",
      isFinal: false,
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "tool.call.progress",
      tool_name: "bash",
      request_uuid: REQ_UUID,
      chunk: "partial output",
      is_final: false,
    });
  });

  it("builds tool.call.result body with tool_name / status / output", () => {
    const event: RuntimeEvent = {
      type: "tool.call.result",
      turnId: TURN_UUID,
      toolName: "bash",
      requestId: REQ_UUID,
      status: "ok",
      output: "success",
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "tool.call.result",
      tool_name: "bash",
      request_uuid: REQ_UUID,
      status: "ok",
      output: "success",
    });
  });

  it("builds tool.call.result error body with error_message", () => {
    const event: RuntimeEvent = {
      type: "tool.call.result",
      turnId: TURN_UUID,
      toolName: "bash",
      requestId: REQ_UUID,
      status: "error",
      errorMessage: "command failed",
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "tool.call.result",
      tool_name: "bash",
      request_uuid: REQ_UUID,
      status: "error",
      error_message: "command failed",
    });
  });

  it("builds hook.broadcast body with event_name / payload_redacted", () => {
    const event: RuntimeEvent = {
      type: "hook.broadcast",
      event: "on_save",
      payloadRedacted: { file: "test.ts" },
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "hook.broadcast",
      event_name: "on_save",
      payload_redacted: { file: "test.ts" },
    });
  });

  it("builds hook.broadcast body with optional aggregated_outcome", () => {
    const event: RuntimeEvent = {
      type: "hook.broadcast",
      event: "on_save",
      payloadRedacted: {},
      aggregatedOutcome: { ok: true },
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body.aggregated_outcome).toEqual({ ok: true });
  });

  it("builds compact.notify body with status and optional token fields", () => {
    const event: RuntimeEvent = {
      type: "compact.notify",
      status: "completed",
      tokensBefore: 1000,
      tokensAfter: 700,
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "compact.notify",
      status: "completed",
      tokens_before: 1000,
      tokens_after: 700,
    });
  });

  it("omits optional token fields on compact.notify when not set", () => {
    const event: RuntimeEvent = {
      type: "compact.notify",
      status: "started",
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "compact.notify",
      status: "started",
    });
  });

  it("builds system.notify body with severity / message", () => {
    const event: RuntimeEvent = {
      type: "system.notify",
      severity: "warning",
      message: "something happened",
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "system.notify",
      severity: "warning",
      message: "something happened",
    });
  });

  it("builds session.update body with phase", () => {
    const event: RuntimeEvent = {
      type: "session.update",
      phase: "turn_running",
      turnCount: 3,
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body).toEqual({
      kind: "session.update",
      phase: "turn_running",
    });
  });

  it("includes partial_output on session.update when provided", () => {
    const event: RuntimeEvent = {
      type: "session.update",
      phase: "turn_running",
      turnCount: 1,
      partialOutput: "in progress...",
      timestamp: NOW,
    };
    const body = buildStreamEventBody(event) as Record<string, unknown>;
    expect(body.partial_output).toBe("in progress...");
  });
});
