/**
 * Scenario: Tool Turn
 *
 * user input → LLM requests tool → tool executes → LLM finishes → turn complete
 * Uses fake delegates to simulate a multi-step tool-use turn.
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

let llmCallCount = 0;

function fakeDelegates(): KernelDelegates {
  llmCallCount = 0;

  return {
    llm: {
      async *call(_req: unknown): AsyncIterable<LlmChunk> {
        llmCallCount++;
        if (llmCallCount === 1) {
          // First call: LLM decides to call a tool
          yield { type: "content", content: "I need to run a command" };
          yield {
            type: "tool_calls",
            calls: [{ id: "tc-1", name: "bash", input: { cmd: "ls" } }],
          };
          yield {
            type: "usage",
            usage: { inputTokens: 30, outputTokens: 15 },
          };
        } else {
          // Second call: LLM provides final response after tool result
          yield { type: "content", content: "The command output was helpful" };
          yield {
            type: "usage",
            usage: { inputTokens: 50, outputTokens: 20 },
          };
        }
      },
      abort() {},
    },
    capability: {
      async *execute(_plan: unknown): AsyncIterable<CapabilityChunk> {
        yield {
          type: "progress",
          progress: "running",
          chunk: "half done",
        };
        yield { type: "result", result: "command output: success" };
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

function startTurn(turnId = "t-tool"): KernelSnapshot {
  const idle = createKernelSnapshot(createInitialSessionState());
  return applyAction(idle, { type: "start_turn", turnId });
}

// ═══════════════════════════════════════════════════════════════════
// Scenario
// ═══════════════════════════════════════════════════════════════════

describe("Scenario: tool turn", () => {
  it("user input → LLM requests tool → tool executes → LLM finishes → turn complete", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn("t-tool-1");

    // Step 1: LLM call — LLM decides to call a tool
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r1.done).toBe(false);
    expect(
      r1.snapshot.activeTurn!.pendingToolCalls.map((d) => d.callId),
    ).toContain("tc-1");
    expect(r1.events.some((e) => e.type === "llm.delta")).toBe(true);
    snap = r1.snapshot;

    // Step 2: Tool execution — scheduler picks up pending tool call
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ hasMoreToolCalls: true, llmFinished: false }),
    );
    expect(r2.done).toBe(false);
    expect(
      r2.snapshot.activeTurn!.pendingToolCalls.map((d) => d.callId),
    ).not.toContain("tc-1");
    expect(r2.events.some((e) => e.type === "tool.call.progress")).toBe(true);
    expect(r2.events.some((e) => e.type === "tool.call.result")).toBe(true);
    snap = r2.snapshot;

    // Step 3: Second LLM call — LLM generates final response
    const r3 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r3.done).toBe(false);
    expect(r3.events.some((e) => e.type === "llm.delta")).toBe(true);
    snap = r3.snapshot;

    // Step 4: Finish — turn is complete
    const r4 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: true }),
    );
    expect(r4.done).toBe(true);
    expect(r4.snapshot.session.phase).toBe("idle");
    expect(r4.snapshot.session.turnCount).toBe(1);
    expect(r4.snapshot.activeTurn).toBeNull();
    expect(r4.events.some((e) => e.type === "turn.completed")).toBe(true);
  });

  it("accumulates token usage across multiple LLM calls", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn();

    // LLM call 1: 30+15 = 45
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r1.snapshot.session.totalTokens).toBe(45);
    snap = r1.snapshot;

    // Tool exec: no token change
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ hasMoreToolCalls: true }),
    );
    expect(r2.snapshot.session.totalTokens).toBe(45);
    snap = r2.snapshot;

    // LLM call 2: +50+20 = +70 → 115
    const r3 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    expect(r3.snapshot.session.totalTokens).toBe(115);
  });

  it("emits progress events whose toolName is the actual tool, not the requestId", async () => {
    const runner = new KernelRunner(fakeDelegates());
    let snap = startTurn();

    // First get the LLM to request a tool
    const r1 = await runner.advanceStep(
      snap,
      baseSignals({ llmFinished: false }),
    );
    snap = r1.snapshot;

    // Execute the tool — should have progress event
    const r2 = await runner.advanceStep(
      snap,
      baseSignals({ hasMoreToolCalls: true }),
    );
    const progressEvents = r2.events.filter(
      (e) => e.type === "tool.call.progress",
    );
    expect(progressEvents.length).toBe(1);
    const pe = progressEvents[0];
    if (pe.type === "tool.call.progress") {
      expect(pe.toolName).toBe("bash");
      expect(pe.requestId).toBe("tc-1");
      expect(pe.chunk).toBe("half done");
      expect(pe.isFinal).toBe(false);
    }
  });
});
