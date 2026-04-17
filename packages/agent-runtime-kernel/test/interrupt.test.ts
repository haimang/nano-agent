import { describe, it, expect } from "vitest";
import { classifyInterrupt, canResumeFrom } from "../src/interrupt.js";
import { applyAction } from "../src/reducer.js";
import { createInitialSessionState, createKernelSnapshot } from "../src/state.js";
import type { KernelSnapshot } from "../src/state.js";
import type { InterruptReason } from "../src/types.js";

function idleSnapshot(): KernelSnapshot {
  return createKernelSnapshot(createInitialSessionState());
}

function runningSnapshot(turnId = "t-1"): KernelSnapshot {
  return applyAction(idleSnapshot(), { type: "start_turn", turnId });
}

describe("classifyInterrupt", () => {
  it("cancel → not recoverable, no checkpoint", () => {
    const r = classifyInterrupt("cancel");
    expect(r.recoverable).toBe(false);
    expect(r.requiresCheckpoint).toBe(false);
  });

  it("timeout → recoverable, requires checkpoint", () => {
    const r = classifyInterrupt("timeout");
    expect(r.recoverable).toBe(true);
    expect(r.requiresCheckpoint).toBe(true);
  });

  it("compact_required → recoverable, no checkpoint", () => {
    const r = classifyInterrupt("compact_required");
    expect(r.recoverable).toBe(true);
    expect(r.requiresCheckpoint).toBe(false);
  });

  it("approval_pending → recoverable, requires checkpoint", () => {
    const r = classifyInterrupt("approval_pending");
    expect(r.recoverable).toBe(true);
    expect(r.requiresCheckpoint).toBe(true);
  });

  it("fatal_error → not recoverable, requires checkpoint", () => {
    const r = classifyInterrupt("fatal_error");
    expect(r.recoverable).toBe(false);
    expect(r.requiresCheckpoint).toBe(true);
  });
});

describe("canResumeFrom", () => {
  it("returns false for idle snapshot", () => {
    expect(canResumeFrom(idleSnapshot())).toBe(false);
  });

  it("returns false for running snapshot (no interrupt)", () => {
    expect(canResumeFrom(runningSnapshot())).toBe(false);
  });

  it("returns true for waiting snapshot with recoverable reason (timeout)", () => {
    let snap = runningSnapshot();
    snap = applyAction(snap, { type: "interrupt", reason: "timeout" });
    expect(snap.session.phase).toBe("waiting");
    expect(canResumeFrom(snap)).toBe(true);
  });

  it("returns true for waiting snapshot with approval_pending", () => {
    let snap = runningSnapshot();
    snap = applyAction(snap, { type: "interrupt", reason: "approval_pending" });
    expect(canResumeFrom(snap)).toBe(true);
  });

  it("returns false for interrupted snapshot with fatal_error", () => {
    let snap = runningSnapshot();
    snap = applyAction(snap, { type: "interrupt", reason: "fatal_error" });
    // fatal_error transitions to "interrupted" not "waiting"
    expect(snap.session.phase).toBe("interrupted");
    expect(canResumeFrom(snap)).toBe(false);
  });

  it("returns false for ended snapshot", () => {
    const snap = applyAction(idleSnapshot(), { type: "end_session" });
    expect(canResumeFrom(snap)).toBe(false);
  });
});
