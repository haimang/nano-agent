/**
 * Scenario: Basic Turn
 *
 * user input → LLM response → turn complete
 * Uses fake delegates to simulate a single-step LLM turn.
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

// ═══════════════════════════════════════════════════════════════════
// Fake delegates
// ═══════════════════════════════════════════════════════════════════

function fakeDelegates(
  llmChunks: LlmChunk[] = [
    { type: "content", content: "Hello, world!" },
    { type: "usage", usage: { inputTokens: 20, outputTokens: 10 } },
  ],
): KernelDelegates {
  return {
    llm: {
      async *call(_req: unknown): AsyncIterable<LlmChunk> {
        for (const c of llmChunks) yield c;
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

function startTurn(turnId = "t-basic"): KernelSnapshot {
  const idle = createKernelSnapshot(createInitialSessionState());
  return applyAction(idle, { type: "start_turn", turnId });
}

// ═══════════════════════════════════════════════════════════════════
// Scenario
// ═══════════════════════════════════════════════════════════════════

describe("Scenario: basic turn", () => {
  it("user input → LLM response → turn complete", async () => {
    const runner = new KernelRunner(fakeDelegates());

    // Step 1: Start turn (already applied via startTurn helper)
    let snap = startTurn("t-basic-1");
    expect(snap.session.phase).toBe("turn_running");
    expect(snap.activeTurn).not.toBeNull();
    expect(snap.activeTurn!.turnId).toBe("t-basic-1");

    // Step 2: LLM call — scheduler should decide llm_call
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r1.done).toBe(false);
    expect(r1.snapshot.session.totalTokens).toBe(30); // 20 + 10
    expect(r1.events.some((e) => e.type === "llm.delta")).toBe(true);
    snap = r1.snapshot;

    // Step 3: finish — LLM is now done, no tool calls pending
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: true }),
    );
    expect(r2.done).toBe(true);
    expect(r2.snapshot.session.phase).toBe("idle");
    expect(r2.snapshot.session.turnCount).toBe(1);
    expect(r2.snapshot.activeTurn).toBeNull();
    expect(r2.events.some((e) => e.type === "turn.completed")).toBe(true);
  });

  it("emits correct event sequence", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn("t-evt");

    const allEvents: string[] = [];

    // LLM step
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    allEvents.push(...r1.events.map((e) => e.type));
    snap = r1.snapshot;

    // Finish step
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: true }),
    );
    allEvents.push(...r2.events.map((e) => e.type));

    expect(allEvents).toContain("llm.delta");
    expect(allEvents).toContain("turn.completed");
  });

  it("tracks token usage correctly", async () => {
    const runner = new KernelRunner(
      fakeDelegates([
        { type: "content", content: "response" },
        { type: "usage", usage: { inputTokens: 100, outputTokens: 50 } },
      ]),
    );

    let snap = startTurn();
    expect(snap.session.totalTokens).toBe(0);

    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r1.snapshot.session.totalTokens).toBe(150);
  });
});
