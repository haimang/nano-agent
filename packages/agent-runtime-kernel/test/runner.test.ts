import { describe, it, expect } from "vitest";
import { KernelRunner } from "../src/runner.js";
import type { KernelDelegates } from "../src/delegates.js";
import type { SchedulerSignals } from "../src/scheduler.js";
import type { CapabilityChunk, LlmChunk } from "../src/types.js";
import { applyAction } from "../src/reducer.js";
import { createInitialSessionState, createKernelSnapshot } from "../src/state.js";
import type { KernelSnapshot } from "../src/state.js";
import { KernelError } from "../src/errors.js";

// ═══════════════════════════════════════════════════════════════════
// Fake delegate helpers
// ═══════════════════════════════════════════════════════════════════

function fakeDelegates(overrides: Partial<{
  llmChunks: LlmChunk[];
  toolChunks: CapabilityChunk[];
  compactResult: unknown;
  hookResult: unknown;
}> = {}): KernelDelegates {
  const llmChunks: LlmChunk[] = overrides.llmChunks ?? [
    { type: "content", content: "Hello from LLM" },
    { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
  ];
  const toolChunks: CapabilityChunk[] = overrides.toolChunks ?? [
    { type: "result", result: "tool output" },
  ];
  const compactResult = overrides.compactResult ?? { tokensFreed: 100 };
  const hookResult = overrides.hookResult ?? { ok: true };

  return {
    llm: {
      async *call(_req: unknown): AsyncIterable<LlmChunk> {
        for (const c of llmChunks) yield c;
      },
      abort() {},
    },
    capability: {
      async *execute(_plan: unknown): AsyncIterable<CapabilityChunk> {
        for (const c of toolChunks) yield c;
      },
      cancel() {},
    },
    compact: {
      async requestCompact(_budget: unknown) { return compactResult; },
    },
    hook: {
      async emit(_event: string, _payload: unknown) { return hookResult; },
    },
  };
}

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

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("KernelRunner", () => {
  describe("advanceStep — llm_call", () => {
    it("calls LLM delegate, records response, and emits llm.delta event", async () => {
      const runner = new KernelRunner(fakeDelegates());
      const snap = runningSnapshot();
      const result = await runner.advanceStep(snap, baseSignals({ llmFinished: false }));

      expect(result.done).toBe(false);
      expect(result.snapshot.session.totalTokens).toBe(15);
      const delta = result.events.find((e) => e.type === "llm.delta");
      expect(delta).toBeDefined();
      if (delta && delta.type === "llm.delta") {
        expect(delta.contentType).toBe("text");
        expect(delta.content).toBe("Hello from LLM");
        expect(delta.isFinal).toBe(false);
      }
      // stepIndex should have advanced
      expect(result.snapshot.activeTurn!.stepIndex).toBeGreaterThan(0);
    });
  });

  describe("advanceStep — tool_exec", () => {
    it("executes tool delegate using requestId + toolName separately", async () => {
      const runner = new KernelRunner(fakeDelegates());
      let snap = runningSnapshot();
      snap = applyAction(snap, {
        type: "tool_calls_requested",
        calls: [{ id: "tc-1", name: "bash", input: { cmd: "ls" } }],
      });

      const result = await runner.advanceStep(snap, baseSignals({ hasMoreToolCalls: true }));

      expect(result.done).toBe(false);
      const resultEvent = result.events.find((e) => e.type === "tool.call.result");
      expect(resultEvent).toBeDefined();
      if (resultEvent && resultEvent.type === "tool.call.result") {
        // toolName must be the actual tool name, not the request id
        expect(resultEvent.toolName).toBe("bash");
        expect(resultEvent.requestId).toBe("tc-1");
        expect(resultEvent.status).toBe("ok");
      }
      // pending descriptor should be removed
      expect(
        result.snapshot.activeTurn!.pendingToolCalls.map((d) => d.callId),
      ).not.toContain("tc-1");
    });
  });

  describe("advanceStep — compact", () => {
    it("calls compact delegate and emits compact.notify", async () => {
      const runner = new KernelRunner(fakeDelegates({ compactResult: { tokensFreed: 200 } }));
      let snap = runningSnapshot();
      snap = applyAction(snap, {
        type: "llm_response",
        content: "x",
        usage: { inputTokens: 300, outputTokens: 200 },
      });

      const result = await runner.advanceStep(snap, baseSignals({ compactRequired: true }));

      expect(result.done).toBe(false);
      expect(result.snapshot.session.compactCount).toBe(1);
      expect(result.snapshot.session.totalTokens).toBe(300); // 500 - 200
      const notify = result.events.find((e) => e.type === "compact.notify");
      expect(notify).toBeDefined();
      if (notify && notify.type === "compact.notify") {
        expect(notify.status).toBe("completed");
        expect(notify.tokensBefore).toBe(500);
        expect(notify.tokensAfter).toBe(300);
      }
    });
  });

  describe("advanceStep — wait (cancel)", () => {
    it("interrupts and returns done=true", async () => {
      const runner = new KernelRunner(fakeDelegates());
      const snap = runningSnapshot();
      const result = await runner.advanceStep(snap, baseSignals({ cancelRequested: true }));

      expect(result.done).toBe(true);
      expect(result.snapshot.session.phase).toBe("waiting");
      expect(result.events.some((e) => e.type === "session.update")).toBe(true);
    });
  });

  describe("advanceStep — finish", () => {
    it("completes turn and returns done=true", async () => {
      const runner = new KernelRunner(fakeDelegates());
      const snap = runningSnapshot();
      const result = await runner.advanceStep(snap, baseSignals({ llmFinished: true }));

      expect(result.done).toBe(true);
      expect(result.snapshot.session.phase).toBe("idle");
      expect(result.snapshot.session.turnCount).toBe(1);
      expect(result.snapshot.activeTurn).toBeNull();
      expect(result.events.some((e) => e.type === "turn.completed")).toBe(true);
    });
  });

  describe("advanceStep — active-turn guard", () => {
    it("throws TURN_NOT_FOUND when called in turn_running phase without active turn", async () => {
      const runner = new KernelRunner(fakeDelegates());
      // Synthesise a broken snapshot: phase=turn_running but activeTurn=null.
      const snap: KernelSnapshot = {
        ...createKernelSnapshot(createInitialSessionState()),
        session: { ...createInitialSessionState(), phase: "turn_running" },
        activeTurn: null,
      };
      await expect(
        runner.advanceStep(snap, baseSignals({ llmFinished: false })),
      ).rejects.toBeInstanceOf(KernelError);
    });
  });

  describe("basic turn lifecycle: start → llm → tool → finish", () => {
    it("runs a full turn step-by-step", async () => {
      const delegates = fakeDelegates({
        llmChunks: [
          { type: "content", content: "I will call a tool" },
          { type: "usage", usage: { inputTokens: 20, outputTokens: 10 } },
          { type: "tool_calls", calls: [{ id: "tc-1", name: "bash" }] },
        ],
        toolChunks: [
          { type: "result", result: "command output" },
        ],
      });

      const runner = new KernelRunner(delegates);
      let snap = runningSnapshot();

      // Step 1: LLM call (which also requests tool calls)
      const r1 = await runner.advanceStep(snap, baseSignals({ llmFinished: false }));
      expect(r1.done).toBe(false);
      expect(
        r1.snapshot.activeTurn!.pendingToolCalls.map((d) => d.callId),
      ).toContain("tc-1");
      snap = r1.snapshot;

      // Step 2: tool execution
      const r2 = await runner.advanceStep(snap, baseSignals({ hasMoreToolCalls: true, llmFinished: true }));
      expect(r2.done).toBe(false);
      expect(
        r2.snapshot.activeTurn!.pendingToolCalls.map((d) => d.callId),
      ).not.toContain("tc-1");
      snap = r2.snapshot;

      // Step 3: finish
      const r3 = await runner.advanceStep(snap, baseSignals({ llmFinished: true }));
      expect(r3.done).toBe(true);
      expect(r3.snapshot.session.phase).toBe("idle");
      expect(r3.snapshot.session.turnCount).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2nd-round R4: turn lifecycle emission + system.notify seam
  // ═══════════════════════════════════════════════════════════════

  describe("turn lifecycle + system.notify (2nd-round R4 regression guard)", () => {
    it("emits turn.started on the first step of a new turn", async () => {
      const runner = new KernelRunner(fakeDelegates());
      const snap = runningSnapshot("turn-new"); // stepIndex === 0
      const result = await runner.advanceStep(snap, baseSignals({ llmFinished: false }));

      const turnStarted = result.events.find((e) => e.type === "turn.started");
      expect(turnStarted).toBeDefined();
      if (turnStarted && turnStarted.type === "turn.started") {
        expect(turnStarted.turnId).toBe("turn-new");
        expect(() => new Date(turnStarted.timestamp)).not.toThrow();
      }
    });

    it("does NOT emit turn.started on subsequent steps of the same turn", async () => {
      const runner = new KernelRunner(fakeDelegates());
      let snap = runningSnapshot("turn-cont");
      const first = await runner.advanceStep(snap, baseSignals({ llmFinished: false }));
      snap = first.snapshot;
      // second step
      const second = await runner.advanceStep(snap, baseSignals({ llmFinished: true }));
      const started = second.events.find((e) => e.type === "turn.started");
      expect(started).toBeUndefined();
    });

    it("buildSystemNotify produces a schema-compatible system.notify RuntimeEvent", () => {
      const runner = new KernelRunner(fakeDelegates());
      const ev = runner.buildSystemNotify("warning", "budget close to limit");
      expect(ev.type).toBe("system.notify");
      if (ev.type === "system.notify") {
        expect(ev.severity).toBe("warning");
        expect(ev.message).toBe("budget close to limit");
        expect(() => new Date(ev.timestamp)).not.toThrow();
      }
    });
  });
});
