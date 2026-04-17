/**
 * Scenario: Interrupt Turn
 *
 * cancel mid-turn → interrupt → checkpoint → verify resumable
 * Tests the full interrupt lifecycle including checkpoint/restore.
 */

import { describe, it, expect } from "vitest";
import { KernelRunner } from "../../src/runner.js";
import type { KernelDelegates } from "../../src/delegates.js";
import type { SchedulerSignals } from "../../src/scheduler.js";
import type { CapabilityChunk, LlmChunk } from "../../src/types.js";
import { applyAction } from "../../src/reducer.js";
import {
  createInitialSessionState,
  createKernelSnapshot,
} from "../../src/state.js";
import type { KernelSnapshot } from "../../src/state.js";
import { canResumeFrom } from "../../src/interrupt.js";
import {
  buildCheckpointFragment,
  restoreFromFragment,
  validateFragment,
} from "../../src/checkpoint.js";

// ═══════════════════════════════════════════════════════════════════
// Fake delegates
// ═══════════════════════════════════════════════════════════════════

function fakeDelegates(): KernelDelegates {
  return {
    llm: {
      async *call(_req: unknown): AsyncIterable<LlmChunk> {
        yield { type: "content", content: "response" };
        yield {
          type: "usage",
          usage: { inputTokens: 30, outputTokens: 10 },
        };
      },
      abort() {},
    },
    capability: {
      async *execute(_plan: unknown): AsyncIterable<CapabilityChunk> {
        yield { type: "result", result: "tool output" };
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

function startTurn(turnId = "t-int"): KernelSnapshot {
  const idle = createKernelSnapshot(createInitialSessionState());
  return applyAction(idle, { type: "start_turn", turnId });
}

// ═══════════════════════════════════════════════════════════════════
// Scenario
// ═══════════════════════════════════════════════════════════════════

describe("Scenario: interrupt turn", () => {
  it("cancel mid-turn → interrupt → checkpoint → verify state", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn("t-int-1");

    // Step 1: LLM call succeeds
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r1.done).toBe(false);
    snap = r1.snapshot;

    // Step 2: Cancel arrives mid-turn
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ cancelRequested: true }),
    );
    expect(r2.done).toBe(true);
    expect(r2.snapshot.session.phase).toBe("waiting");
    expect(r2.snapshot.activeTurn!.interruptReason).toBe("cancel");
    snap = r2.snapshot;

    // Step 3: Build checkpoint from interrupted state
    const fragment = buildCheckpointFragment(snap);
    expect(validateFragment(fragment)).toBe(true);
    expect(fragment.session.phase).toBe("waiting");
    expect(fragment.activeTurn!.interruptReason).toBe("cancel");
    expect(fragment.lastAction).not.toBeNull();

    // Step 4: canResumeFrom is false for cancel (non-recoverable)
    expect(canResumeFrom(snap)).toBe(false);
  });

  it("timeout mid-turn → interrupt → checkpoint → resumable", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn("t-timeout-1");

    // Step 1: LLM call
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    snap = r1.snapshot;

    // Step 2: Timeout arrives
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ timeoutReached: true }),
    );
    expect(r2.done).toBe(true);
    expect(r2.snapshot.session.phase).toBe("waiting");
    expect(r2.snapshot.activeTurn!.interruptReason).toBe("timeout");
    snap = r2.snapshot;

    // Step 3: This IS resumable (timeout is recoverable)
    expect(canResumeFrom(snap)).toBe(true);

    // Step 4: Checkpoint and restore
    const fragment = buildCheckpointFragment(snap);
    expect(validateFragment(fragment)).toBe(true);
    const restored = restoreFromFragment(fragment);

    expect(restored.session.phase).toBe("waiting");
    expect(restored.activeTurn!.interruptReason).toBe("timeout");
    expect(canResumeFrom(restored)).toBe(true);

    // Step 5: Resume from restored snapshot
    const resumed = applyAction(restored, { type: "resume" });
    expect(resumed.session.phase).toBe("turn_running");
    expect(resumed.activeTurn!.interruptReason).toBeNull();
  });

  it("checkpoint preserves turn progress through interrupt", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn("t-preserve");

    // LLM call — accumulate some state
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    snap = r1.snapshot;
    const tokensBeforeInterrupt = snap.session.totalTokens;
    const stepIndexBeforeInterrupt = snap.activeTurn!.stepIndex;
    const messagesBeforeInterrupt = snap.activeTurn!.messages.length;

    // Timeout interrupt
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ timeoutReached: true }),
    );
    snap = r2.snapshot;

    // Checkpoint
    const fragment = buildCheckpointFragment(snap);
    const restored = restoreFromFragment(fragment);

    // Verify all turn progress is preserved
    expect(restored.session.totalTokens).toBe(tokensBeforeInterrupt);
    expect(restored.activeTurn!.stepIndex).toBe(stepIndexBeforeInterrupt);
    expect(restored.activeTurn!.messages.length).toBe(
      messagesBeforeInterrupt,
    );
    expect(restored.activeTurn!.turnId).toBe("t-preserve");
  });

  it("interrupt emits session.update event", async () => {
    const runner = new KernelRunner(fakeDelegates());
    const snap = startTurn("t-evt-int");

    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ cancelRequested: true }),
    );

    expect(r1.events.some((e) => e.type === "session.update")).toBe(true);
    const updateEvent = r1.events.find((e) => e.type === "session.update");
    if (updateEvent && updateEvent.type === "session.update") {
      expect(updateEvent.phase).toBe("waiting");
    }
  });

  it("resume after timeout → continue turn → finish", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn("t-resume");

    // LLM call
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    snap = r1.snapshot;

    // Timeout
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ timeoutReached: true }),
    );
    snap = r2.snapshot;
    expect(snap.session.phase).toBe("waiting");

    // Checkpoint + restore
    const fragment = buildCheckpointFragment(snap);
    snap = restoreFromFragment(fragment);

    // Resume
    snap = applyAction(snap, { type: "resume" });
    expect(snap.session.phase).toBe("turn_running");

    // Finish the turn
    const r3 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: true }),
    );
    expect(r3.done).toBe(true);
    expect(r3.snapshot.session.phase).toBe("idle");
    expect(r3.snapshot.session.turnCount).toBe(1);
  });
});
