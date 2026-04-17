/**
 * Integration test: graceful shutdown flow.
 *
 * Tests the full shutdown sequence with checkpoint, hooks, and WebSocket:
 *   1. session_end → hook emitted, checkpoint saved, WS closed (1000)
 *   2. fatal_error → checkpoint saved, WS closed with error code (1011)
 *   3. Verify all deps called in correct order
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  gracefulShutdown,
  closeCodeForReason,
} from "../../src/shutdown.js";
import type { ShutdownDeps, ShutdownReason } from "../../src/shutdown.js";
import {
  buildSessionCheckpoint,
  validateSessionCheckpoint,
} from "../../src/checkpoint.js";
import type { CheckpointDeps, UsageSnapshot, SessionCheckpoint } from "../../src/checkpoint.js";
import {
  createInitialActorState,
  transitionPhase,
} from "../../src/actor-state.js";

// ── Helpers ──

function makeCheckpointDeps(): CheckpointDeps {
  return {
    getKernelFragment: () => ({
      version: "0.1.0",
      session: { sessionId: "22222222-2222-4222-8222-222222222222", turnCount: 2, startedAt: "2026-04-16T12:00:00.000Z" },
      activeTurn: null,
      lastAction: "step:done",
      checkpointedAt: "2026-04-16T12:05:00.000Z",
    }),
    getReplayFragment: async () => ({ lastSeqNo: 10, frames: [] }),
    getStreamSeqs: () => ({ main: 10, tool: 3 }),
    getWorkspaceFragment: async () => ({
      version: "0.1.0",
      mountConfigs: [],
      fileIndex: [],
      artifactRefs: [],
      contextLayers: [],
      createdAt: "2026-04-16T12:05:00.000Z",
    }),
    getHooksFragment: () => ({
      version: "0.1.0",
      handlers: [],
      snapshotAt: "2026-04-16T12:05:00.000Z",
    }),
  };
}

function makeUsage(): UsageSnapshot {
  return {
    totalTokens: 500,
    totalTurns: 2,
    totalDurationMs: 3000,
  };
}

// ── Tests ──

describe("graceful shutdown integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:05:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("session_end shutdown", () => {
    it("runs full shutdown sequence: hook → checkpoint → save → flush → close", async () => {
      const callOrder: string[] = [];
      let savedCheckpoint: SessionCheckpoint | null = null;

      // Build a real checkpoint using buildSessionCheckpoint
      const checkpointDeps = makeCheckpointDeps();
      const usage = makeUsage();

      // Drive actor state to "ended"
      let actorState = createInitialActorState();
      actorState = transitionPhase(actorState, "attached");
      actorState = transitionPhase(actorState, "turn_running");
      actorState = transitionPhase(actorState, "attached");
      actorState = transitionPhase(actorState, "ended");

      const shutdownDeps: ShutdownDeps = {
        emitHook: vi.fn(async (event, payload) => {
          callOrder.push("emitHook");
          return undefined;
        }),
        buildCheckpoint: vi.fn(async () => {
          callOrder.push("buildCheckpoint");
          return buildSessionCheckpoint(
            "22222222-2222-4222-8222-222222222222",
            "team-shutdown-abc",
            actorState.phase,
            2,
            usage,
            checkpointDeps,
          );
        }),
        saveCheckpoint: vi.fn(async (cp: SessionCheckpoint) => {
          callOrder.push("saveCheckpoint");
          savedCheckpoint = cp;
        }),
        flushTraces: vi.fn(async () => {
          callOrder.push("flushTraces");
        }),
        closeWebSocket: vi.fn((code: number, reason: string) => {
          callOrder.push("closeWebSocket");
        }),
      };

      await gracefulShutdown("session_end", shutdownDeps);

      // Verify call order
      expect(callOrder).toEqual([
        "emitHook",
        "buildCheckpoint",
        "saveCheckpoint",
        "flushTraces",
        "closeWebSocket",
      ]);

      // Verify hook was called correctly
      expect(shutdownDeps.emitHook).toHaveBeenCalledWith("SessionEnd", {
        reason: "session_end",
      });

      // Verify checkpoint was saved
      expect(savedCheckpoint).not.toBeNull();
      expect(validateSessionCheckpoint(savedCheckpoint)).toBe(true);
      expect(savedCheckpoint!.sessionUuid).toBe("22222222-2222-4222-8222-222222222222");
      expect(savedCheckpoint!.actorPhase).toBe("ended");
      expect(savedCheckpoint!.turnCount).toBe(2);

      // Verify WebSocket was closed with normal code
      expect(shutdownDeps.closeWebSocket).toHaveBeenCalledWith(
        1000,
        "session_end",
      );
    });
  });

  describe("fatal_error shutdown", () => {
    it("saves checkpoint and closes WS with error code 1011", async () => {
      let savedCheckpoint: SessionCheckpoint | null = null;
      const checkpointDeps = makeCheckpointDeps();

      const shutdownDeps: ShutdownDeps = {
        emitHook: vi.fn(async () => undefined),
        buildCheckpoint: vi.fn(async () =>
          buildSessionCheckpoint(
            "66666666-6666-4666-8666-666666666666",
            "team-shutdown-abc",
            "turn_running",
            1,
            makeUsage(),
            checkpointDeps,
          ),
        ),
        saveCheckpoint: vi.fn(async (cp: SessionCheckpoint) => {
          savedCheckpoint = cp;
        }),
        flushTraces: vi.fn(async () => {}),
        closeWebSocket: vi.fn(),
      };

      await gracefulShutdown("fatal_error", shutdownDeps);

      // Checkpoint was saved even during fatal error
      expect(savedCheckpoint).not.toBeNull();
      expect(validateSessionCheckpoint(savedCheckpoint)).toBe(true);

      // WebSocket closed with error code
      expect(shutdownDeps.closeWebSocket).toHaveBeenCalledWith(
        1011,
        "fatal_error",
      );
    });
  });

  describe("timeout shutdown", () => {
    it("closes WS with going-away code 1001", async () => {
      const checkpointDeps = makeCheckpointDeps();

      const shutdownDeps: ShutdownDeps = {
        emitHook: vi.fn(async () => undefined),
        buildCheckpoint: vi.fn(async () =>
          buildSessionCheckpoint(
            "sess-shutdown-003",
            "team-shutdown-abc",
            "attached",
            0,
            makeUsage(),
            checkpointDeps,
          ),
        ),
        saveCheckpoint: vi.fn(async () => {}),
        flushTraces: vi.fn(async () => {}),
        closeWebSocket: vi.fn(),
      };

      await gracefulShutdown("timeout", shutdownDeps);

      expect(shutdownDeps.closeWebSocket).toHaveBeenCalledWith(1001, "timeout");
    });
  });

  describe("health_failure shutdown", () => {
    it("closes WS with going-away code 1001", async () => {
      const checkpointDeps = makeCheckpointDeps();

      const shutdownDeps: ShutdownDeps = {
        emitHook: vi.fn(async () => undefined),
        buildCheckpoint: vi.fn(async () =>
          buildSessionCheckpoint(
            "sess-shutdown-004",
            "team-shutdown-abc",
            "attached",
            1,
            makeUsage(),
            checkpointDeps,
          ),
        ),
        saveCheckpoint: vi.fn(async () => {}),
        flushTraces: vi.fn(async () => {}),
        closeWebSocket: vi.fn(),
      };

      await gracefulShutdown("health_failure", shutdownDeps);

      expect(shutdownDeps.closeWebSocket).toHaveBeenCalledWith(
        1001,
        "health_failure",
      );
    });
  });

  describe("error resilience during shutdown", () => {
    it("hook failure does not prevent checkpoint save", async () => {
      let checkpointSaved = false;
      const checkpointDeps = makeCheckpointDeps();

      const shutdownDeps: ShutdownDeps = {
        emitHook: vi.fn(async () => {
          throw new Error("Hook service unavailable");
        }),
        buildCheckpoint: vi.fn(async () =>
          buildSessionCheckpoint(
            "sess-shutdown-005",
            "team-shutdown-abc",
            "ended",
            1,
            makeUsage(),
            checkpointDeps,
          ),
        ),
        saveCheckpoint: vi.fn(async () => {
          checkpointSaved = true;
        }),
        flushTraces: vi.fn(async () => {}),
        closeWebSocket: vi.fn(),
      };

      await gracefulShutdown("session_end", shutdownDeps);

      expect(checkpointSaved).toBe(true);
      expect(shutdownDeps.closeWebSocket).toHaveBeenCalledOnce();
    });

    it("trace flush failure does not prevent WS close", async () => {
      const checkpointDeps = makeCheckpointDeps();

      const shutdownDeps: ShutdownDeps = {
        emitHook: vi.fn(async () => undefined),
        buildCheckpoint: vi.fn(async () =>
          buildSessionCheckpoint(
            "sess-shutdown-006",
            "team-shutdown-abc",
            "ended",
            0,
            makeUsage(),
            checkpointDeps,
          ),
        ),
        saveCheckpoint: vi.fn(async () => {}),
        flushTraces: vi.fn(async () => {
          throw new Error("Trace backend down");
        }),
        closeWebSocket: vi.fn(),
      };

      await gracefulShutdown("session_end", shutdownDeps);

      expect(shutdownDeps.closeWebSocket).toHaveBeenCalledWith(
        1000,
        "session_end",
      );
    });
  });

  describe("close codes for all reasons", () => {
    const reasonCodes: [ShutdownReason, number][] = [
      ["session_end", 1000],
      ["timeout", 1001],
      ["fatal_error", 1011],
      ["health_failure", 1001],
    ];

    for (const [reason, expectedCode] of reasonCodes) {
      it(`${reason} → close code ${expectedCode}`, () => {
        expect(closeCodeForReason(reason)).toBe(expectedCode);
      });
    }
  });
});
