/**
 * Scenario: Idle / Input Arrival
 *
 * Two cases:
 *   1. A fresh session moves idle → start_turn → llm_call → complete_turn.
 *   2. A turn suspended on approval_pending buffers an incoming input via
 *      `input_arrived`, then consumes it on `resume` before running the
 *      remainder of the turn to completion.
 */

import { describe, it, expect } from "vitest";
import { KernelRunner } from "../../../src/kernel/runner.js";
import type { KernelDelegates } from "../../../src/kernel/delegates.js";
import type { SchedulerSignals } from "../../../src/kernel/scheduler.js";
import type { CapabilityChunk, LlmChunk } from "../../../src/kernel/types.js";
import { applyAction } from "../../../src/kernel/reducer.js";
import {
  createInitialSessionState,
  createKernelSnapshot,
} from "../../../src/kernel/state.js";
import type { KernelSnapshot } from "../../../src/kernel/state.js";

// ═══════════════════════════════════════════════════════════════════
// Fake delegates
// ═══════════════════════════════════════════════════════════════════

function fakeDelegates(): KernelDelegates {
  return {
    llm: {
      async *call(_req: unknown): AsyncIterable<LlmChunk> {
        yield { type: "content", content: "ok" };
        yield { type: "usage", usage: { inputTokens: 5, outputTokens: 3 } };
      },
      abort() {},
    },
    capability: {
      async *execute(_plan: unknown): AsyncIterable<CapabilityChunk> {
        yield { type: "result", result: null };
      },
      cancel() {},
    },
    compact: {
      async requestCompact(_budget: unknown) {
        return { tokensFreed: 0 };
      },
    },
    hook: {
      async emit(_event: string, _payload: unknown) {
        return { ok: true };
      },
    },
  };
}

function baseSignals(
  overrides: Partial<SchedulerSignals> = {},
): SchedulerSignals {
  return {
    hasMoreToolCalls: false,
    compactRequired: false,
    cancelRequested: false,
    timeoutReached: false,
    llmFinished: false,
    ...overrides,
  };
}

function idleSnapshot(): KernelSnapshot {
  return createKernelSnapshot(createInitialSessionState());
}

// ═══════════════════════════════════════════════════════════════════
// Scenario 1: idle → start_turn → llm_call → complete_turn
// ═══════════════════════════════════════════════════════════════════

describe("Scenario: idle → start_turn → llm_call → complete_turn", () => {
  it("runs a fresh turn end-to-end", async () => {
    const runner = new KernelRunner(fakeDelegates());

    // Start from the freshly created idle snapshot.
    let snap = idleSnapshot();
    expect(snap.session.phase).toBe("idle");
    expect(snap.activeTurn).toBeNull();

    // start_turn is applied directly via the reducer (it is not a
    // scheduler decision) — this mirrors how the Session DO drives
    // the kernel in response to external input.
    snap = applyAction(snap, { type: "start_turn", turnId: "t-fresh" });
    expect(snap.session.phase).toBe("turn_running");
    expect(snap.activeTurn!.pendingInput).toBeNull();

    // llm_call step
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r1.done).toBe(false);
    expect(r1.snapshot.session.totalTokens).toBe(8);
    snap = r1.snapshot;

    // finish step
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: true }),
    );
    expect(r2.done).toBe(true);
    expect(r2.snapshot.session.phase).toBe("idle");
    expect(r2.snapshot.session.turnCount).toBe(1);
    expect(r2.snapshot.activeTurn).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Scenario 2: approval_pending → input_arrived → resume → finish
// ═══════════════════════════════════════════════════════════════════

describe("Scenario: turn_running → approval_pending → input_arrived → resume → finish", () => {
  it("buffers incoming input while waiting and consumes it on resume", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = idleSnapshot();
    snap = applyAction(snap, { type: "start_turn", turnId: "t-approval" });

    // Simulate that an approval-pending interrupt was triggered.
    snap = applyAction(snap, {
      type: "interrupt",
      reason: "approval_pending",
    });
    expect(snap.session.phase).toBe("waiting");
    expect(snap.activeTurn!.interruptReason).toBe("approval_pending");

    // External input arrives while we're suspended. The reducer
    // buffers it on pendingInput without touching phase / messages.
    snap = applyAction(snap, {
      type: "input_arrived",
      input: { userMessage: "approved" },
    });
    expect(snap.session.phase).toBe("waiting");
    expect(snap.activeTurn!.pendingInput).toEqual({
      userMessage: "approved",
    });
    expect(snap.activeTurn!.messages).toEqual([]);

    // Resume flushes pendingInput into the message log and clears it.
    snap = applyAction(snap, { type: "resume" });
    expect(snap.session.phase).toBe("turn_running");
    expect(snap.activeTurn!.pendingInput).toBeNull();
    expect(snap.activeTurn!.messages).toEqual([
      { userMessage: "approved" },
    ]);

    // llm_call step (post-resume)
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r1.done).toBe(false);
    snap = r1.snapshot;

    // finish step
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: true }),
    );
    expect(r2.done).toBe(true);
    expect(r2.snapshot.session.phase).toBe("idle");
    expect(r2.snapshot.session.turnCount).toBe(1);
  });
});
