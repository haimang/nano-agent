import { describe, it, expect } from "vitest";
import { scheduleNextStep } from "../src/scheduler.js";
import type { SchedulerSignals } from "../src/scheduler.js";
import { applyAction } from "../src/reducer.js";
import { createInitialSessionState, createKernelSnapshot } from "../src/state.js";
import type { KernelSnapshot } from "../src/state.js";

function baseSignals(overrides: Partial<SchedulerSignals> = {}): SchedulerSignals {
  return {
    hasMoreToolCalls: false,
    compactRequired: false,
    cancelRequested: false,
    timeoutReached: false,
    llmFinished: false,
    ...overrides,
  };
}

function runningSnapshot(turnId = "t-1"): KernelSnapshot {
  const idle = createKernelSnapshot(createInitialSessionState());
  return applyAction(idle, { type: "start_turn", turnId });
}

describe("scheduleNextStep", () => {
  it("returns wait(cancel) when cancelRequested", () => {
    const snap = runningSnapshot();
    const decision = scheduleNextStep(snap, baseSignals({ cancelRequested: true }));
    expect(decision).toEqual({ kind: "wait", reason: "cancel" });
  });

  it("returns wait(timeout) when timeoutReached", () => {
    const snap = runningSnapshot();
    const decision = scheduleNextStep(snap, baseSignals({ timeoutReached: true }));
    expect(decision).toEqual({ kind: "wait", reason: "timeout" });
  });

  it("cancel takes priority over timeout", () => {
    const snap = runningSnapshot();
    const decision = scheduleNextStep(snap, baseSignals({ cancelRequested: true, timeoutReached: true }));
    expect(decision.kind).toBe("wait");
    expect((decision as { reason: string }).reason).toBe("cancel");
  });

  it("returns compact when compactRequired", () => {
    const snap = runningSnapshot();
    const decision = scheduleNextStep(snap, baseSignals({ compactRequired: true }));
    expect(decision).toEqual({ kind: "compact" });
  });

  it("returns tool_exec with the pending call descriptor's fields", () => {
    let snap = runningSnapshot();
    snap = applyAction(snap, {
      type: "tool_calls_requested",
      calls: [{ id: "tc-1", name: "read_file", input: { path: "/tmp/a" } }],
    });
    const decision = scheduleNextStep(snap, baseSignals({ hasMoreToolCalls: true }));
    expect(decision.kind).toBe("tool_exec");
    if (decision.kind === "tool_exec") {
      expect(decision.requestId).toBe("tc-1");
      expect(decision.toolName).toBe("read_file");
      expect(decision.args).toEqual({ path: "/tmp/a" });
    }
  });

  it("returns llm_call when LLM not finished and no pending tools", () => {
    const snap = runningSnapshot();
    const decision = scheduleNextStep(snap, baseSignals({ llmFinished: false }));
    expect(decision).toEqual({ kind: "llm_call" });
  });

  it("returns finish when llmFinished and no other signals", () => {
    const snap = runningSnapshot();
    const decision = scheduleNextStep(snap, baseSignals({ llmFinished: true }));
    expect(decision).toEqual({ kind: "finish", reason: "turn_complete" });
  });

  it("compact takes priority over tool_exec", () => {
    let snap = runningSnapshot();
    snap = applyAction(snap, {
      type: "tool_calls_requested",
      calls: [{ id: "tc-1", name: "read_file" }],
    });
    const decision = scheduleNextStep(snap, baseSignals({ compactRequired: true, hasMoreToolCalls: true }));
    expect(decision.kind).toBe("compact");
  });

  it("tool_exec takes priority over llm_call", () => {
    let snap = runningSnapshot();
    snap = applyAction(snap, {
      type: "tool_calls_requested",
      calls: [{ id: "tc-1", name: "bash" }],
    });
    const decision = scheduleNextStep(snap, baseSignals({ hasMoreToolCalls: true, llmFinished: false }));
    expect(decision.kind).toBe("tool_exec");
    if (decision.kind === "tool_exec") {
      expect(decision.toolName).toBe("bash");
      expect(decision.requestId).toBe("tc-1");
    }
  });
});
