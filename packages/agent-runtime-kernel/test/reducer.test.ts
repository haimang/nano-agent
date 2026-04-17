import { describe, it, expect } from "vitest";
import { applyAction } from "../src/reducer.js";
import { createInitialSessionState, createKernelSnapshot } from "../src/state.js";
import type { KernelSnapshot } from "../src/state.js";
import { KernelError } from "../src/errors.js";

function idleSnapshot(): KernelSnapshot {
  return createKernelSnapshot(createInitialSessionState());
}

function runningSnapshot(turnId = "t-1"): KernelSnapshot {
  const s = idleSnapshot();
  return applyAction(s, { type: "start_turn", turnId });
}

describe("applyAction", () => {
  // ── start_turn ──────────────────────────────────────────────────
  describe("start_turn", () => {
    it("transitions idle → turn_running and creates TurnState", () => {
      const snap = idleSnapshot();
      const next = applyAction(snap, { type: "start_turn", turnId: "t-1" });
      expect(next.session.phase).toBe("turn_running");
      expect(next.activeTurn).not.toBeNull();
      expect(next.activeTurn!.turnId).toBe("t-1");
      expect(next.activeTurn!.phase).toBe("running");
      expect(next.activeTurn!.pendingInput).toBeNull();
    });

    it("throws when phase is not idle", () => {
      const snap = runningSnapshot();
      expect(() => applyAction(snap, { type: "start_turn", turnId: "t-2" })).toThrow(KernelError);
    });
  });

  // ── complete_step ───────────────────────────────────────────────
  describe("complete_step", () => {
    it("increments stepIndex WITHOUT appending to messages", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, { type: "complete_step", stepIndex: 0, result: "step-0-done" });
      expect(next.activeTurn!.stepIndex).toBe(1);
      // complete_step MUST NOT duplicate message content; llm_response /
      // tool_result own the message log.
      expect(next.activeTurn!.messages).toEqual([]);
    });

    it("throws when no active turn", () => {
      const snap = idleSnapshot();
      expect(() => applyAction(snap, { type: "complete_step", stepIndex: 0, result: null })).toThrow(KernelError);
    });
  });

  // ── llm_response ──────────────────────────────────────────────
  describe("llm_response", () => {
    it("records content and updates token count", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, {
        type: "llm_response",
        content: { text: "hello" },
        usage: { inputTokens: 100, outputTokens: 50 },
      });
      expect(next.session.totalTokens).toBe(150);
      expect(next.activeTurn!.messages).toHaveLength(1);
    });

    it("works without usage field", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, { type: "llm_response", content: "text" });
      expect(next.session.totalTokens).toBe(0);
      expect(next.activeTurn!.messages).toContain("text");
    });

    it("llm_response + complete_step appends message exactly once", () => {
      let snap = runningSnapshot();
      snap = applyAction(snap, {
        type: "llm_response",
        content: "hello",
      });
      snap = applyAction(snap, {
        type: "complete_step",
        stepIndex: 0,
        result: "hello",
      });
      expect(snap.activeTurn!.messages).toEqual(["hello"]);
    });
  });

  // ── tool_calls_requested ──────────────────────────────────────
  describe("tool_calls_requested", () => {
    it("stores full call descriptors in pendingToolCalls", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, {
        type: "tool_calls_requested",
        calls: [
          { id: "tc-1", name: "read_file", input: { path: "a" } },
          { id: "tc-2", name: "write_file", input: { path: "b" } },
        ],
      });
      expect(next.activeTurn!.pendingToolCalls).toEqual([
        { callId: "tc-1", toolName: "read_file", toolInput: { path: "a" } },
        { callId: "tc-2", toolName: "write_file", toolInput: { path: "b" } },
      ]);
    });

    it("defaults toolInput to null when missing", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, {
        type: "tool_calls_requested",
        calls: [{ id: "tc-1", name: "bash" }],
      });
      expect(next.activeTurn!.pendingToolCalls[0]).toEqual({
        callId: "tc-1",
        toolName: "bash",
        toolInput: null,
      });
    });
  });

  // ── tool_result ───────────────────────────────────────────────
  describe("tool_result", () => {
    it("removes descriptor matching callId and records result", () => {
      let snap = runningSnapshot();
      snap = applyAction(snap, {
        type: "tool_calls_requested",
        calls: [
          { id: "tc-1", name: "read_file" },
          { id: "tc-2", name: "write_file" },
        ],
      });
      const next = applyAction(snap, {
        type: "tool_result",
        callId: "tc-1",
        result: "file content",
      });
      expect(next.activeTurn!.pendingToolCalls.map((d) => d.callId)).toEqual([
        "tc-2",
      ]);
      expect(next.activeTurn!.messages).toContain("file content");
    });
  });

  // ── interrupt ─────────────────────────────────────────────────
  describe("interrupt", () => {
    it("transitions turn_running → waiting for recoverable reasons", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, { type: "interrupt", reason: "timeout" });
      expect(next.session.phase).toBe("waiting");
      expect(next.activeTurn!.interruptReason).toBe("timeout");
    });

    it("transitions turn_running → interrupted for fatal_error", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, { type: "interrupt", reason: "fatal_error" });
      expect(next.session.phase).toBe("interrupted");
      expect(next.activeTurn!.interruptReason).toBe("fatal_error");
    });

    it("throws when not in turn_running phase", () => {
      const snap = idleSnapshot();
      expect(() => applyAction(snap, { type: "interrupt", reason: "cancel" })).toThrow(KernelError);
    });
  });

  // ── input_arrived ─────────────────────────────────────────────
  describe("input_arrived", () => {
    it("buffers input on the active turn's pendingInput", () => {
      let snap = runningSnapshot();
      snap = applyAction(snap, { type: "interrupt", reason: "approval_pending" });
      const next = applyAction(snap, {
        type: "input_arrived",
        input: { userMessage: "approved" },
      });
      expect(next.activeTurn!.pendingInput).toEqual({
        userMessage: "approved",
      });
    });

    it("throws when no active turn", () => {
      const snap = idleSnapshot();
      expect(() =>
        applyAction(snap, { type: "input_arrived", input: "x" }),
      ).toThrow(KernelError);
    });
  });

  // ── resume ────────────────────────────────────────────────────
  describe("resume", () => {
    it("transitions waiting → turn_running", () => {
      let snap = runningSnapshot();
      snap = applyAction(snap, { type: "interrupt", reason: "timeout" });
      expect(snap.session.phase).toBe("waiting");
      const next = applyAction(snap, { type: "resume" });
      expect(next.session.phase).toBe("turn_running");
      expect(next.activeTurn!.interruptReason).toBeNull();
    });

    it("consumes pendingInput into messages and clears the buffer", () => {
      let snap = runningSnapshot();
      snap = applyAction(snap, { type: "interrupt", reason: "approval_pending" });
      snap = applyAction(snap, {
        type: "input_arrived",
        input: { userMessage: "go ahead" },
      });
      const next = applyAction(snap, { type: "resume" });
      expect(next.activeTurn!.pendingInput).toBeNull();
      expect(next.activeTurn!.messages).toContainEqual({
        userMessage: "go ahead",
      });
    });

    it("does not modify messages when pendingInput is null", () => {
      let snap = runningSnapshot();
      snap = applyAction(snap, { type: "interrupt", reason: "timeout" });
      const next = applyAction(snap, { type: "resume" });
      expect(next.activeTurn!.messages).toEqual([]);
    });

    it("throws when not in waiting phase", () => {
      const snap = runningSnapshot();
      expect(() => applyAction(snap, { type: "resume" })).toThrow(KernelError);
    });
  });

  // ── complete_turn ─────────────────────────────────────────────
  describe("complete_turn", () => {
    it("transitions turn_running → idle and increments turnCount", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, { type: "complete_turn", reason: "done" });
      expect(next.session.phase).toBe("idle");
      expect(next.session.turnCount).toBe(1);
      expect(next.activeTurn).toBeNull();
    });

    it("throws when not in turn_running phase", () => {
      const snap = idleSnapshot();
      expect(() => applyAction(snap, { type: "complete_turn", reason: "done" })).toThrow(KernelError);
    });
  });

  // ── end_session ───────────────────────────────────────────────
  describe("end_session", () => {
    it("transitions to ended and clears activeTurn", () => {
      const snap = idleSnapshot();
      const next = applyAction(snap, { type: "end_session" });
      expect(next.session.phase).toBe("ended");
      expect(next.activeTurn).toBeNull();
    });

    it("can end from turn_running", () => {
      const snap = runningSnapshot();
      const next = applyAction(snap, { type: "end_session" });
      expect(next.session.phase).toBe("ended");
    });
  });

  // ── compact_done ──────────────────────────────────────────────
  describe("compact_done", () => {
    it("increments compactCount and subtracts tokensFreed", () => {
      let snap = runningSnapshot();
      snap = applyAction(snap, {
        type: "llm_response",
        content: "x",
        usage: { inputTokens: 500, outputTokens: 500 },
      });
      expect(snap.session.totalTokens).toBe(1000);
      const next = applyAction(snap, { type: "compact_done", tokensFreed: 400 });
      expect(next.session.totalTokens).toBe(600);
      expect(next.session.compactCount).toBe(1);
    });

    it("does not go below zero tokens", () => {
      const snap = idleSnapshot();
      const next = applyAction(snap, { type: "compact_done", tokensFreed: 9999 });
      expect(next.session.totalTokens).toBe(0);
      expect(next.session.compactCount).toBe(1);
    });
  });

  // ── illegal transitions ───────────────────────────────────────
  describe("illegal transitions", () => {
    it("cannot start_turn when already running", () => {
      const snap = runningSnapshot();
      expect(() => applyAction(snap, { type: "start_turn", turnId: "t-2" })).toThrow(KernelError);
    });

    it("cannot start_turn from ended phase", () => {
      const snap = applyAction(idleSnapshot(), { type: "end_session" });
      expect(() => applyAction(snap, { type: "start_turn", turnId: "t-1" })).toThrow(KernelError);
    });

    it("cannot resume from idle", () => {
      expect(() => applyAction(idleSnapshot(), { type: "resume" })).toThrow(KernelError);
    });

    it("cannot complete_turn from idle", () => {
      expect(() => applyAction(idleSnapshot(), { type: "complete_turn", reason: "x" })).toThrow(KernelError);
    });
  });
});
