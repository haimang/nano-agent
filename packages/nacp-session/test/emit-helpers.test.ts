// HPX5 P1-01 — emit-helpers test.
//
// Covers:
//   * happy path top-level frame (confirmation/todos)
//   * unknown messageType → fallback system.error
//   * body shape invalid → fallback system.error
//   * sink throws → fallback system.error (NACP_BINDING_UNAVAILABLE)
//   * stream-event happy + invalid + nested system.error drop
//   * observer onEmit fires for ok/fallback/drop

import { describe, it, expect, vi } from "vitest";
import {
  emitTopLevelFrame,
  emitStreamEvent,
  type EmitSink,
  type EmitObserver,
} from "../src/index.js";

interface SinkBundle {
  sink: EmitSink;
  topLevel: Array<[string, Record<string, unknown>]>;
  streamEvents: Array<Record<string, unknown>>;
  throwTopLevel: boolean;
  throwStream: boolean;
}

function makeSink(): SinkBundle {
  const bundle: SinkBundle = {
    sink: undefined as unknown as EmitSink,
    topLevel: [],
    streamEvents: [],
    throwTopLevel: false,
    throwStream: false,
  };
  bundle.sink = {
    emitTopLevelFrame(messageType, body) {
      if (bundle.throwTopLevel) throw new Error("sink top-level throws");
      bundle.topLevel.push([messageType, body]);
    },
    emitStreamEvent(body) {
      if (bundle.throwStream) throw new Error("sink stream-event throws");
      bundle.streamEvents.push(body);
    },
  };
  return bundle;
}

const ctx = { sessionUuid: "11111111-1111-4111-8111-111111111111", traceUuid: "22222222-2222-4222-8222-222222222222" };

describe("emitTopLevelFrame", () => {
  it("happy path emits confirmation.request", () => {
    const s = makeSink();
    const onEmit = vi.fn();
    const r = emitTopLevelFrame(s.sink, "session.confirmation.request", {
      confirmation_uuid: "33333333-3333-4333-8333-333333333333",
      kind: "tool_permission",
      payload: { tool_name: "bash", tool_input: { command: "ls" } },
    }, ctx, { onEmit });
    expect(r.status).toBe("ok");
    expect(s.topLevel.length).toBe(1);
    expect(s.topLevel[0]![0]).toBe("session.confirmation.request");
    expect(s.streamEvents.length).toBe(0);
    expect(onEmit).toHaveBeenCalledWith("latency", expect.objectContaining({ messageType: "session.confirmation.request" }));
  });

  it("accepts lightweight confirmation_kind alias for confirmation.request", () => {
    const s = makeSink();
    const r = emitTopLevelFrame(s.sink, "session.confirmation.request", {
      confirmation_uuid: "33333333-3333-4333-8333-333333333333",
      confirmation_kind: "tool_permission",
      payload: { tool_name: "bash", tool_input: { command: "ls" } },
    }, ctx);
    expect(r.status).toBe("ok");
    expect(s.topLevel[0]).toEqual([
      "session.confirmation.request",
      {
        confirmation_uuid: "33333333-3333-4333-8333-333333333333",
        confirmation_kind: "tool_permission",
        payload: { tool_name: "bash", tool_input: { command: "ls" } },
      },
    ]);
  });

  it("happy path emits todos.write", () => {
    const s = makeSink();
    const r = emitTopLevelFrame(s.sink, "session.todos.write", {
      todos: [{ content: "step 1", status: "pending" }],
    }, ctx);
    expect(r.status).toBe("ok");
    expect(s.topLevel[0]![0]).toBe("session.todos.write");
  });

  it("unknown messageType falls back to system.error", () => {
    const s = makeSink();
    const onEmit = vi.fn();
    const r = emitTopLevelFrame(s.sink, "session.does.not.exist" as "session.heartbeat", {}, ctx, { onEmit });
    expect(r.status).toBe("fallback");
    expect(r.error?.code).toBe("NACP_UNKNOWN_MESSAGE_TYPE");
    expect(s.topLevel.length).toBe(0);
    expect(s.streamEvents.length).toBe(1);
    const body = s.streamEvents[0]!;
    expect(body.kind).toBe("system.error");
    expect((body.error as { code: string }).code).toBe("NACP_UNKNOWN_MESSAGE_TYPE");
    expect(onEmit).toHaveBeenCalledWith("fallback", expect.objectContaining({ code: "NACP_UNKNOWN_MESSAGE_TYPE" }));
  });

  it("invalid body shape falls back to system.error", () => {
    const s = makeSink();
    const r = emitTopLevelFrame(s.sink, "session.confirmation.request", { not: "valid" }, ctx);
    expect(r.status).toBe("fallback");
    expect(r.error?.code).toBe("NACP_VALIDATION_FAILED");
    expect(s.streamEvents[0]!.kind).toBe("system.error");
  });

  it("sink throws → fallback NACP_BINDING_UNAVAILABLE (stream-event still works)", () => {
    const s = makeSink();
    s.throwTopLevel = true;
    const r = emitTopLevelFrame(s.sink, "session.todos.write", {
      todos: [{ content: "x", status: "pending" }],
    }, ctx);
    expect(r.status).toBe("fallback");
    expect(r.error?.code).toBe("NACP_BINDING_UNAVAILABLE");
    expect(s.streamEvents.length).toBe(1);
    expect(s.streamEvents[0]!.kind).toBe("system.error");
  });

  it("top-level + stream both throw → drop", () => {
    const s = makeSink();
    s.throwTopLevel = true;
    s.throwStream = true;
    const r = emitTopLevelFrame(s.sink, "session.todos.write", {
      todos: [{ content: "x", status: "pending" }],
    }, ctx);
    expect(r.status).toBe("drop");
    expect(r.error?.code).toBe("NACP_BINDING_UNAVAILABLE");
  });
});

describe("emitStreamEvent", () => {
  it("happy path emits model.fallback", () => {
    const s = makeSink();
    const r = emitStreamEvent(s.sink, {
      kind: "model.fallback",
      turn_uuid: "44444444-4444-4444-8444-444444444444",
      requested_model_id: "@alias/reasoning",
      fallback_model_id: "@cf/ibm-granite/granite-4.0-h-micro",
      fallback_reason: "quota-exhausted",
    }, ctx);
    expect(r.status).toBe("ok");
    expect(s.streamEvents.length).toBe(1);
  });

  it("invalid stream-event body → fallback to system.error", () => {
    const s = makeSink();
    const r = emitStreamEvent(s.sink, { kind: "model.fallback", missing: "fields" }, ctx);
    expect(r.status).toBe("fallback");
    expect(r.error?.code).toBe("NACP_VALIDATION_FAILED");
    // first emit was the original (failed parse skipped sink), then system.error
    expect(s.streamEvents.length).toBe(1);
    expect(s.streamEvents[0]!.kind).toBe("system.error");
  });

  it("invalid system.error body → drop (no infinite recursion)", () => {
    const s = makeSink();
    const r = emitStreamEvent(s.sink, { kind: "system.error", missing: "everything" }, ctx);
    expect(r.status).toBe("drop");
    expect(r.error?.code).toBe("NACP_VALIDATION_FAILED");
    expect(s.streamEvents.length).toBe(0);
  });

  it("sink throws on system.notify → drop (cannot fall back)", () => {
    const s = makeSink();
    s.throwStream = true;
    const r = emitStreamEvent(s.sink, {
      kind: "system.notify",
      severity: "info",
      message: "hello",
    }, ctx);
    // First sink call (the legitimate one) throws → fallback to system.error
    // → second sink call also throws → final status is drop.
    expect(r.status).toBe("drop");
    expect(r.error?.code).toBe("NACP_BINDING_UNAVAILABLE");
  });
});

describe("observer telemetry", () => {
  it("emits drop metric when even fallback fails", () => {
    const s = makeSink();
    s.throwStream = true;
    const onEmit = vi.fn() as EmitObserver["onEmit"];
    // Validation fails → tries system.error fallback via stream → stream
    // sink throws → drop with original code preserved.
    const r = emitTopLevelFrame(s.sink, "session.confirmation.request", { invalid: true }, ctx, { onEmit });
    expect(r.status).toBe("drop");
    expect(r.error?.code).toBe("NACP_VALIDATION_FAILED");
    expect(onEmit).toHaveBeenCalledWith("drop", expect.objectContaining({ code: "NACP_VALIDATION_FAILED" }));
  });
});
