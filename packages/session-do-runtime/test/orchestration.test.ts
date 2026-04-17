/**
 * Tests for SessionOrchestrator — kernel orchestration, delegate wiring,
 * and event dispatch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionOrchestrator } from "../src/orchestration.js";
import type { OrchestrationDeps, OrchestrationState } from "../src/orchestration.js";
import { DEFAULT_RUNTIME_CONFIG } from "../src/env.js";
import type { RuntimeConfig } from "../src/env.js";
import type { TurnInput } from "../src/turn-ingress.js";

// ═══════════════════════════════════════════════════════════════════
// Helper: build mock deps
// ═══════════════════════════════════════════════════════════════════

function createMockDeps(overrides?: Partial<OrchestrationDeps>): OrchestrationDeps {
  return {
    advanceStep: vi.fn(async (snapshot, _signals) => ({
      snapshot,
      events: [],
      done: true,
    })),
    buildCheckpoint: vi.fn((snapshot) => snapshot),
    restoreCheckpoint: vi.fn((fragment) => fragment),
    createSessionState: vi.fn(() => ({
      phase: "idle",
      turnCount: 0,
      totalTokens: 0,
      compactCount: 0,
      lastCheckpointAt: null,
      createdAt: "2026-04-16T12:00:00.000Z",
    })),
    createTurnState: vi.fn((turnId: string) => ({
      turnId,
      stepIndex: 0,
      phase: "pending",
      pendingToolCalls: [],
      messages: [],
      startedAt: "2026-04-16T12:00:00.000Z",
      interruptReason: null,
    })),
    emitHook: vi.fn(async () => undefined),
    emitTrace: vi.fn(async () => undefined),
    pushStreamEvent: vi.fn(),
    ...overrides,
  };
}

function createTurnInput(content = "Hello"): TurnInput {
  return {
    kind: "session-start-initial-input",
    content,
    turnId: "turn-001",
    receivedAt: "2026-04-16T12:00:00.000Z",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════

describe("SessionOrchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── createInitialState ──────────────────────────────────────

  describe("createInitialState", () => {
    it("produces an initial state with unattached actor phase", () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const state = orchestrator.createInitialState();

      expect(state.actorState.phase).toBe("unattached");
    });

    it("initializes turnCount to 0", () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const state = orchestrator.createInitialState();

      expect(state.turnCount).toBe(0);
    });

    it("calls createSessionState to build the kernel snapshot", () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      orchestrator.createInitialState();

      expect(deps.createSessionState).toHaveBeenCalledOnce();
    });

    it("has a kernel snapshot with no active turn", () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const state = orchestrator.createInitialState();

      const snapshot = state.kernelSnapshot as Record<string, unknown>;
      expect(snapshot.activeTurn).toBeNull();
    });
  });

  // ── startTurn ──────────────────────────────────────────────

  describe("startTurn", () => {
    it("transitions actor to turn_running then back to attached after step loop", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();
      const input = createTurnInput();

      const result = await orchestrator.startTurn(initial, input);

      // After step loop completes (done=true), actor should be back in attached
      expect(result.actorState.phase).toBe("attached");
    });

    it("emits SessionStart hook on first turn", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();
      const input = createTurnInput();

      await orchestrator.startTurn(initial, input);

      expect(deps.emitHook).toHaveBeenCalledWith(
        "SessionStart",
        expect.objectContaining({ content: "Hello" }),
      );
    });

    it("emits UserPromptSubmit hook", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();
      const input = createTurnInput("What is 2+2?");

      await orchestrator.startTurn(initial, input);

      expect(deps.emitHook).toHaveBeenCalledWith(
        "UserPromptSubmit",
        expect.objectContaining({
          turnId: "turn-001",
          content: "What is 2+2?",
        }),
      );
    });

    it("does not emit SessionStart on subsequent turns", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      // Simulate state where turnCount > 0
      const afterFirstTurn: OrchestrationState = {
        ...initial,
        actorState: { ...initial.actorState, phase: "attached", attachedAt: "2026-04-16T12:00:00.000Z" },
        turnCount: 1,
      };

      const input = createTurnInput();
      await orchestrator.startTurn(afterFirstTurn, input);

      const hookCalls = (deps.emitHook as ReturnType<typeof vi.fn>).mock.calls;
      const sessionStartCalls = hookCalls.filter(
        (call: unknown[]) => call[0] === "SessionStart",
      );
      expect(sessionStartCalls).toHaveLength(0);
    });

    it("pushes a canonical turn.begin stream event with the turn UUID", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();
      const input = createTurnInput();

      await orchestrator.startTurn(initial, input);

      expect(deps.pushStreamEvent).toHaveBeenCalledWith(
        "turn.begin",
        expect.objectContaining({ kind: "turn.begin", turn_uuid: "turn-001" }),
      );
    });

    it("emits a trace for turn begin (internal observability channel)", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();
      const input = createTurnInput();

      await orchestrator.startTurn(initial, input);

      expect(deps.emitTrace).toHaveBeenCalledWith(
        expect.objectContaining({ eventKind: "turn.begin" }),
      );
    });

    it("increments turnCount", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();
      const input = createTurnInput();

      // turnCount is set during startTurn and preserved in the returned state
      const result = await orchestrator.startTurn(initial, input);
      // The turnCount is incremented before runStepLoop, but runStepLoop preserves it
      expect(result.turnCount).toBe(1);
    });
  });

  // ── runStepLoop ────────────────────────────────────────────

  describe("runStepLoop", () => {
    it("advances through steps until done", async () => {
      let callCount = 0;
      const deps = createMockDeps({
        advanceStep: vi.fn(async (snapshot, _signals) => {
          callCount += 1;
          return {
            snapshot,
            events: [{ type: "llm.delta", turnId: "t1", delta: "chunk", timestamp: "now" }],
            done: callCount >= 3,
          };
        }),
      });
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      // Put actor into turn_running so the loop can transition back
      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      const result = await orchestrator.runStepLoop(turnRunning);

      expect(deps.advanceStep).toHaveBeenCalledTimes(3);
      expect(result.actorState.phase).toBe("attached");
    });

    it("forwards kernel-emitted schema-valid events via pushStreamEvent (kind taken from body.kind)", async () => {
      let callCount = 0;
      const deps = createMockDeps({
        advanceStep: vi.fn(async (snapshot, _signals) => {
          callCount += 1;
          return {
            snapshot,
            events: [
              {
                kind: "llm.delta",
                content_type: "text",
                content: `chunk-${callCount}`,
                is_final: false,
              },
            ],
            done: callCount >= 2,
          };
        }),
      });
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
          activeTurnId: "11111111-1111-4111-8111-111111111111",
        },
      };

      await orchestrator.runStepLoop(turnRunning);

      expect(deps.pushStreamEvent).toHaveBeenCalledWith(
        "llm.delta",
        expect.objectContaining({ kind: "llm.delta", content: "chunk-1" }),
      );
      expect(deps.pushStreamEvent).toHaveBeenCalledWith(
        "llm.delta",
        expect.objectContaining({ kind: "llm.delta", content: "chunk-2" }),
      );
      // turn.end fires on done=true
      expect(deps.pushStreamEvent).toHaveBeenCalledWith(
        "turn.end",
        expect.objectContaining({
          kind: "turn.end",
          turn_uuid: "11111111-1111-4111-8111-111111111111",
        }),
      );
    });

    it("respects maxTurnSteps safety cap", async () => {
      const config: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, maxTurnSteps: 3 };
      const deps = createMockDeps({
        advanceStep: vi.fn(async (snapshot, _signals) => ({
          snapshot,
          events: [],
          done: false, // Never finishes
        })),
      });
      const orchestrator = new SessionOrchestrator(deps, config);
      const initial = orchestrator.createInitialState();

      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      const result = await orchestrator.runStepLoop(turnRunning);

      expect(deps.advanceStep).toHaveBeenCalledTimes(3);
      // Should have pushed a schema-valid system.notify (severity=warning)
      expect(deps.pushStreamEvent).toHaveBeenCalledWith(
        "system.notify",
        expect.objectContaining({
          kind: "system.notify",
          severity: "warning",
          message: expect.stringContaining("Step budget exhausted"),
        }),
      );
      expect(result.actorState.phase).toBe("attached");
    });

    it("calls buildCheckpoint when checkpointOnTurnEnd is true and done", async () => {
      const deps = createMockDeps();
      const config: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, checkpointOnTurnEnd: true };
      const orchestrator = new SessionOrchestrator(deps, config);
      const initial = orchestrator.createInitialState();

      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      await orchestrator.runStepLoop(turnRunning);

      expect(deps.buildCheckpoint).toHaveBeenCalled();
    });
  });

  // ── cancelTurn ─────────────────────────────────────────────

  describe("cancelTurn", () => {
    it("sends cancel signal to advanceStep", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      await orchestrator.cancelTurn(turnRunning);

      expect(deps.advanceStep).toHaveBeenCalledWith(
        turnRunning.kernelSnapshot,
        expect.objectContaining({ cancelRequested: true }),
      );
    });

    it("transitions actor back to attached", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      const result = await orchestrator.cancelTurn(turnRunning);

      expect(result.actorState.phase).toBe("attached");
    });

    it("surfaces cancellation as a schema-valid system.notify (severity=warning)", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      await orchestrator.cancelTurn(turnRunning);

      expect(deps.pushStreamEvent).toHaveBeenCalledWith(
        "system.notify",
        expect.objectContaining({
          kind: "system.notify",
          severity: "warning",
          message: expect.stringMatching(/cancelled/i),
        }),
      );
    });
  });

  // ── endSession ─────────────────────────────────────────────

  describe("endSession", () => {
    it("transitions actor to ended", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      // Attach first so we can end from a valid state
      const attached: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "attached" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      const result = await orchestrator.endSession(attached);

      expect(result.actorState.phase).toBe("ended");
    });

    it("emits SessionEnd hook", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const attached: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "attached" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      await orchestrator.endSession(attached);

      expect(deps.emitHook).toHaveBeenCalledWith(
        "SessionEnd",
        expect.objectContaining({ turnCount: 0 }),
      );
    });

    it("emits session.ended trace", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const attached: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "attached" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      await orchestrator.endSession(attached);

      expect(deps.emitTrace).toHaveBeenCalledWith(
        expect.objectContaining({ eventKind: "session.ended" }),
      );
    });

    it("surfaces session end as a schema-valid system.notify (severity=info)", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const attached: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "attached" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      await orchestrator.endSession(attached);

      expect(deps.pushStreamEvent).toHaveBeenCalledWith(
        "system.notify",
        expect.objectContaining({
          kind: "system.notify",
          severity: "info",
          message: expect.stringMatching(/Session ended/i),
        }),
      );
    });

    it("calls buildCheckpoint for final state", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const attached: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "attached" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      await orchestrator.endSession(attached);

      expect(deps.buildCheckpoint).toHaveBeenCalled();
    });

    it("handles endSession from turn_running phase", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const turnRunning: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "turn_running" as const,
          attachedAt: "2026-04-16T12:00:00.000Z",
        },
      };

      const result = await orchestrator.endSession(turnRunning);

      expect(result.actorState.phase).toBe("ended");
    });

    it("handles endSession from unattached phase", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      // unattached -> ended is a valid transition
      const result = await orchestrator.endSession(initial);

      expect(result.actorState.phase).toBe("ended");
    });

    it("no-ops if already ended", async () => {
      const deps = createMockDeps();
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();

      const ended: OrchestrationState = {
        ...initial,
        actorState: {
          ...initial.actorState,
          phase: "ended" as const,
        },
      };

      const result = await orchestrator.endSession(ended);

      expect(result.actorState.phase).toBe("ended");
    });
  });

  // ── Hook emission at lifecycle points ──────────────────────

  describe("hook emission", () => {
    it("emits hooks in correct order during startTurn (first turn)", async () => {
      const hookCalls: string[] = [];
      const deps = createMockDeps({
        emitHook: vi.fn(async (event: string) => {
          hookCalls.push(event);
          return undefined;
        }),
      });
      const orchestrator = new SessionOrchestrator(deps, DEFAULT_RUNTIME_CONFIG);
      const initial = orchestrator.createInitialState();
      const input = createTurnInput();

      await orchestrator.startTurn(initial, input);

      expect(hookCalls[0]).toBe("SessionStart");
      expect(hookCalls[1]).toBe("UserPromptSubmit");
    });
  });
});
