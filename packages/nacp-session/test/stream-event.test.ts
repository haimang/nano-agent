import { describe, it, expect } from "vitest";
import { SessionStreamEventBodySchema, STREAM_EVENT_KINDS } from "../src/stream-event.js";

describe("SessionStreamEventBody", () => {
  it("parses tool.call.progress", () => {
    const r = SessionStreamEventBodySchema.parse({ kind: "tool.call.progress", tool_name: "bash", chunk: "data", is_final: false });
    expect(r.kind).toBe("tool.call.progress");
  });
  it("parses hook.broadcast", () => {
    const r = SessionStreamEventBodySchema.parse({ kind: "hook.broadcast", event_name: "PreToolUse", payload_redacted: {} });
    expect(r.kind).toBe("hook.broadcast");
  });
  it("parses llm.delta", () => {
    const r = SessionStreamEventBodySchema.parse({ kind: "llm.delta", content_type: "text", content: "hello" });
    expect(r.kind).toBe("llm.delta");
  });
  it("parses turn.begin", () => {
    const r = SessionStreamEventBodySchema.parse({ kind: "turn.begin", turn_uuid: "11111111-1111-1111-1111-111111111111" });
    expect(r.kind).toBe("turn.begin");
  });
  it("parses compact.notify", () => {
    const r = SessionStreamEventBodySchema.parse({ kind: "compact.notify", status: "completed", tokens_before: 80000, tokens_after: 35000 });
    expect(r.kind).toBe("compact.notify");
  });
  it("parses system.notify", () => {
    const r = SessionStreamEventBodySchema.parse({ kind: "system.notify", severity: "error", message: "something broke" });
    expect(r.kind).toBe("system.notify");
  });
  it("rejects unknown kind", () => {
    expect(() => SessionStreamEventBodySchema.parse({ kind: "unknown.thing" })).toThrow();
  });
  it("has 9 registered kinds", () => {
    expect(STREAM_EVENT_KINDS).toHaveLength(9);
  });
});
