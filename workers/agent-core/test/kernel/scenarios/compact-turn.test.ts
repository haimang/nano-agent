/**
 * Scenario: Compact Turn
 *
 * compact signal arrives → compact delegate called → state updated
 * Uses fake delegates to simulate context compaction during a turn.
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

function fakeDelegates(tokensFreed = 500): KernelDelegates {
  return {
    llm: {
      async *call(_req: unknown): AsyncIterable<LlmChunk> {
        yield { type: "content", content: "response" };
        yield {
          type: "usage",
          usage: { inputTokens: 10, outputTokens: 5 },
        };
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
        return { tokensFreed };
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

function startTurnWithTokens(
  tokens: number,
  turnId = "t-compact",
): KernelSnapshot {
  const idle = createKernelSnapshot(createInitialSessionState());
  let snap = applyAction(idle, { type: "start_turn", turnId });
  // Simulate accumulated tokens
  snap = applyAction(snap, {
    type: "llm_response",
    content: "previous context",
    usage: { inputTokens: tokens, outputTokens: 0 },
  });
  return snap;
}

// ═══════════════════════════════════════════════════════════════════
// Scenario
// ═══════════════════════════════════════════════════════════════════

describe("Scenario: compact turn", () => {
  it("compact signal → compact delegate called → state updated", async () => {
    const runner = new KernelRunner(fakeDelegates(300));
    let snap = startTurnWithTokens(1000);

    expect(snap.session.totalTokens).toBe(1000);
    expect(snap.session.compactCount).toBe(0);

    // Step 1: compact signal — scheduler should decide compact
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ compactRequired: true }),
    );

    expect(r1.done).toBe(false);
    expect(r1.snapshot.session.totalTokens).toBe(700); // 1000 - 300
    expect(r1.snapshot.session.compactCount).toBe(1);
    expect(r1.events.some((e) => e.type === "compact.notify")).toBe(true);
    snap = r1.snapshot;

    // Step 2: turn continues normally with LLM call
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r2.done).toBe(false);
    expect(r2.snapshot.session.totalTokens).toBe(715); // 700 + 10 + 5
    snap = r2.snapshot;

    // Step 3: finish
    const r3 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: true }),
    );
    expect(r3.done).toBe(true);
    expect(r3.snapshot.session.phase).toBe("idle");
    expect(r3.snapshot.session.compactCount).toBe(1);
  });

  it("compact emits compact.notify event with freed token info", async () => {
    const runner = new KernelRunner(fakeDelegates(200));
    const snap = startTurnWithTokens(500);

    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ compactRequired: true }),
    );

    const compactEvents = r1.events.filter(
      (e) => e.type === "compact.notify",
    );
    expect(compactEvents.length).toBe(1);
    if (compactEvents[0].type === "compact.notify") {
      expect(compactEvents[0].status).toBe("completed");
      expect(compactEvents[0].tokensBefore).toBe(500);
      expect(compactEvents[0].tokensAfter).toBe(300);
    }
  });

  it("compact takes priority over tool execution", async () => {
    const runner = new KernelRunner(fakeDelegates(100));
    let snap = startTurnWithTokens(800);
    snap = applyAction(snap, {
      type: "tool_calls_requested",
      calls: [{ id: "tc-1", name: "read_file" }],
    });

    // Both compact and tool calls pending — compact should win
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ compactRequired: true, hasMoreToolCalls: true }),
    );

    expect(r1.snapshot.session.compactCount).toBe(1);
    // Tool should still be pending
    expect(
      r1.snapshot.activeTurn!.pendingToolCalls.map((d) => d.callId),
    ).toContain("tc-1");
  });

  it("multiple compactions in a single turn", async () => {
    const runner = new KernelRunner(fakeDelegates(200));
    let snap = startTurnWithTokens(1000);

    // First compact
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ compactRequired: true }),
    );
    expect(r1.snapshot.session.totalTokens).toBe(800);
    expect(r1.snapshot.session.compactCount).toBe(1);
    snap = r1.snapshot;

    // Second compact
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ compactRequired: true }),
    );
    expect(r2.snapshot.session.totalTokens).toBe(600);
    expect(r2.snapshot.session.compactCount).toBe(2);
  });
});
