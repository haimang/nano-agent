import { describe, it, expect } from "vitest";
import { intentForStep } from "../../src/kernel/message-intents.js";
import type { StepDecision } from "../../src/kernel/types.js";

describe("intentForStep", () => {
  it("maps tool_exec → tool.call.request", () => {
    const decision: StepDecision = {
      kind: "tool_exec",
      requestId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    };
    expect(intentForStep(decision)).toBe("tool.call.request");
  });

  it("maps hook_emit → hook.emit", () => {
    const decision: StepDecision = {
      kind: "hook_emit",
      event: "on_save",
    };
    expect(intentForStep(decision)).toBe("hook.emit");
  });

  it("maps compact → context.compact.request", () => {
    const decision: StepDecision = { kind: "compact" };
    expect(intentForStep(decision)).toBe("context.compact.request");
  });

  it("returns null for llm_call", () => {
    const decision: StepDecision = { kind: "llm_call" };
    expect(intentForStep(decision)).toBeNull();
  });

  it("returns null for wait", () => {
    const decision: StepDecision = { kind: "wait", reason: "cancel" };
    expect(intentForStep(decision)).toBeNull();
  });

  it("returns null for finish", () => {
    const decision: StepDecision = { kind: "finish", reason: "turn_complete" };
    expect(intentForStep(decision)).toBeNull();
  });
});
