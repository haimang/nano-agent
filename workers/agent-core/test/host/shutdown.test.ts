/**
 * Tests for graceful shutdown.
 */

import { describe, it, expect, vi } from "vitest";
import {
  gracefulShutdown,
  closeCodeForReason,
} from "../../src/host/shutdown.js";
import type { ShutdownReason, ShutdownDeps } from "../../src/host/shutdown.js";
import type { SessionCheckpoint } from "../../src/host/checkpoint.js";

// ── Helpers ──

function makeCheckpoint(): SessionCheckpoint {
  return {
    version: "0.1.0",
    sessionUuid: "sess-001",
    teamUuid: "team-abc",
    actorPhase: "ended",
    turnCount: 5,
    kernelFragment: null,
    replayFragment: null,
    streamSeqs: {},
    workspaceFragment: null,
    hooksFragment: null,
    usageSnapshot: { totalTokens: 500, totalTurns: 5, totalDurationMs: 3000 },
    checkpointedAt: "2026-04-16T12:00:00.000Z",
  };
}

function makeDeps(overrides: Partial<ShutdownDeps> = {}): ShutdownDeps {
  return {
    buildCheckpoint: vi.fn(async () => makeCheckpoint()),
    saveCheckpoint: vi.fn(async () => {}),
    closeWebSocket: vi.fn(() => {}),
    flushTraces: vi.fn(async () => {}),
    emitHook: vi.fn(async () => undefined),
    ...overrides,
  };
}

// ── Tests ──

describe("closeCodeForReason", () => {
  it("returns 1000 for session_end", () => {
    expect(closeCodeForReason("session_end")).toBe(1000);
  });

  it("returns 1001 for timeout", () => {
    expect(closeCodeForReason("timeout")).toBe(1001);
  });

  it("returns 1011 for fatal_error", () => {
    expect(closeCodeForReason("fatal_error")).toBe(1011);
  });

  it("returns 1001 for health_failure", () => {
    expect(closeCodeForReason("health_failure")).toBe(1001);
  });
});

describe("gracefulShutdown", () => {
  describe("session_end reason", () => {
    it("emits Stop hook BEFORE SessionEnd (B5)", async () => {
      const deps = makeDeps();
      await gracefulShutdown("session_end", deps);

      const calls = (deps.emitHook as ReturnType<typeof vi.fn>).mock.calls;
      const names = calls.map((c: unknown[]) => c[0]);
      expect(names).toContain("Stop");
      expect(names).toContain("SessionEnd");
      expect(names.indexOf("Stop")).toBeLessThan(names.indexOf("SessionEnd"));
    });

    it("emits Stop hook with the shutdown reason (B5)", async () => {
      const deps = makeDeps();
      await gracefulShutdown("session_end", deps);

      expect(deps.emitHook).toHaveBeenCalledWith("Stop", {
        reason: "session_end",
      });
    });

    it("emits SessionEnd hook", async () => {
      const deps = makeDeps();
      await gracefulShutdown("session_end", deps);

      expect(deps.emitHook).toHaveBeenCalledWith("SessionEnd", {
        reason: "session_end",
      });
    });

    it("builds and saves checkpoint", async () => {
      const deps = makeDeps();
      await gracefulShutdown("session_end", deps);

      expect(deps.buildCheckpoint).toHaveBeenCalledOnce();
      expect(deps.saveCheckpoint).toHaveBeenCalledWith(makeCheckpoint());
    });

    it("flushes traces", async () => {
      const deps = makeDeps();
      await gracefulShutdown("session_end", deps);

      expect(deps.flushTraces).toHaveBeenCalledOnce();
    });

    it("closes WebSocket with code 1000", async () => {
      const deps = makeDeps();
      await gracefulShutdown("session_end", deps);

      expect(deps.closeWebSocket).toHaveBeenCalledWith(1000, "session_end");
    });
  });

  describe("fatal_error reason", () => {
    it("closes WebSocket with code 1011", async () => {
      const deps = makeDeps();
      await gracefulShutdown("fatal_error", deps);

      expect(deps.closeWebSocket).toHaveBeenCalledWith(1011, "fatal_error");
    });

    it("still saves checkpoint", async () => {
      const deps = makeDeps();
      await gracefulShutdown("fatal_error", deps);

      expect(deps.saveCheckpoint).toHaveBeenCalledOnce();
    });
  });

  describe("timeout reason", () => {
    it("closes WebSocket with code 1001", async () => {
      const deps = makeDeps();
      await gracefulShutdown("timeout", deps);

      expect(deps.closeWebSocket).toHaveBeenCalledWith(1001, "timeout");
    });
  });

  describe("health_failure reason", () => {
    it("closes WebSocket with code 1001", async () => {
      const deps = makeDeps();
      await gracefulShutdown("health_failure", deps);

      expect(deps.closeWebSocket).toHaveBeenCalledWith(1001, "health_failure");
    });
  });

  describe("calls deps in correct order", () => {
    it("emitHook → buildCheckpoint → saveCheckpoint → flushTraces → closeWebSocket", async () => {
      const callOrder: string[] = [];

      const deps: ShutdownDeps = {
        emitHook: vi.fn(async () => {
          callOrder.push("emitHook");
          return undefined;
        }),
        buildCheckpoint: vi.fn(async () => {
          callOrder.push("buildCheckpoint");
          return makeCheckpoint();
        }),
        saveCheckpoint: vi.fn(async () => {
          callOrder.push("saveCheckpoint");
        }),
        flushTraces: vi.fn(async () => {
          callOrder.push("flushTraces");
        }),
        closeWebSocket: vi.fn(() => {
          callOrder.push("closeWebSocket");
        }),
      };

      await gracefulShutdown("session_end", deps);

      // B5 — two emitHook calls (Stop then SessionEnd) before
      // checkpoint work begins.
      expect(callOrder).toEqual([
        "emitHook",
        "emitHook",
        "buildCheckpoint",
        "saveCheckpoint",
        "flushTraces",
        "closeWebSocket",
      ]);
    });
  });

  describe("error resilience", () => {
    it("continues when emitHook throws", async () => {
      const deps = makeDeps({
        emitHook: vi.fn(async () => {
          throw new Error("Hook service down");
        }),
      });

      // Should not throw
      await expect(gracefulShutdown("session_end", deps)).resolves.toBeUndefined();

      // Checkpoint should still be saved
      expect(deps.buildCheckpoint).toHaveBeenCalledOnce();
      expect(deps.saveCheckpoint).toHaveBeenCalledOnce();
      expect(deps.closeWebSocket).toHaveBeenCalledOnce();
    });

    it("continues when flushTraces throws", async () => {
      const deps = makeDeps({
        flushTraces: vi.fn(async () => {
          throw new Error("Trace backend unavailable");
        }),
      });

      await expect(gracefulShutdown("session_end", deps)).resolves.toBeUndefined();

      // WebSocket should still be closed
      expect(deps.closeWebSocket).toHaveBeenCalledOnce();
    });

    it("propagates buildCheckpoint errors", async () => {
      const deps = makeDeps({
        buildCheckpoint: vi.fn(async () => {
          throw new Error("Checkpoint build failed");
        }),
      });

      await expect(gracefulShutdown("session_end", deps)).rejects.toThrow(
        "Checkpoint build failed",
      );
    });

    it("propagates saveCheckpoint errors", async () => {
      const deps = makeDeps({
        saveCheckpoint: vi.fn(async () => {
          throw new Error("Storage write failed");
        }),
      });

      await expect(gracefulShutdown("session_end", deps)).rejects.toThrow(
        "Storage write failed",
      );
    });
  });

  describe("all shutdown reasons emit correct hook payload", () => {
    const reasons: ShutdownReason[] = [
      "session_end",
      "timeout",
      "fatal_error",
      "health_failure",
    ];

    for (const reason of reasons) {
      it(`emits SessionEnd with reason "${reason}"`, async () => {
        const deps = makeDeps();
        await gracefulShutdown(reason, deps);

        expect(deps.emitHook).toHaveBeenCalledWith("SessionEnd", { reason });
      });
    }
  });
});
