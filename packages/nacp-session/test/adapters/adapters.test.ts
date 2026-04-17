import { describe, it, expect } from "vitest";
import { toolProgressToStreamEvent, toolResultToStreamEvent } from "../../src/adapters/tool.js";
import { hookBroadcastToStreamEvent } from "../../src/adapters/hook.js";
import { compactNotifyToStreamEvent } from "../../src/adapters/compact.js";
import { systemNotifyToStreamEvent } from "../../src/adapters/system.js";
import { llmDeltaToStreamEvent } from "../../src/adapters/llm.js";
import { SessionStreamEventBodySchema } from "../../src/stream-event.js";

describe("tool adapter", () => {
  it("toolProgressToStreamEvent creates valid event", () => {
    const e = toolProgressToStreamEvent("bash", "data chunk", false);
    expect(SessionStreamEventBodySchema.parse(e).kind).toBe("tool.call.progress");
  });
  it("toolResultToStreamEvent creates valid event", () => {
    const e = toolResultToStreamEvent("bash", "ok", "output text");
    expect(SessionStreamEventBodySchema.parse(e).kind).toBe("tool.call.result");
  });
});

describe("hook adapter", () => {
  it("creates valid hook.broadcast event", () => {
    const e = hookBroadcastToStreamEvent("PreToolUse", { tool_name: "bash" });
    expect(SessionStreamEventBodySchema.parse(e).kind).toBe("hook.broadcast");
  });
  it("applies redaction hints", () => {
    const e = hookBroadcastToStreamEvent("PostToolUse", { secret: "key123" }, undefined, ["secret"]);
    const parsed = SessionStreamEventBodySchema.parse(e);
    expect((parsed as any).payload_redacted.secret).toBe("[redacted]");
  });
});

describe("compact adapter", () => {
  it("creates valid compact.notify event", () => {
    const e = compactNotifyToStreamEvent("completed", 80000, 35000);
    expect(SessionStreamEventBodySchema.parse(e).kind).toBe("compact.notify");
  });
});

describe("system adapter", () => {
  it("creates valid system.notify event", () => {
    const e = systemNotifyToStreamEvent("error", "something broke");
    expect(SessionStreamEventBodySchema.parse(e).kind).toBe("system.notify");
  });
});

describe("llm adapter seam", () => {
  it("creates valid llm.delta event", () => {
    const e = llmDeltaToStreamEvent("text", "Hello world");
    expect(SessionStreamEventBodySchema.parse(e).kind).toBe("llm.delta");
  });
  it("supports thinking content type", () => {
    const e = llmDeltaToStreamEvent("thinking", "Let me think...", false);
    const parsed = SessionStreamEventBodySchema.parse(e);
    expect(parsed.kind).toBe("llm.delta");
    expect((parsed as any).content_type).toBe("thinking");
  });
});
