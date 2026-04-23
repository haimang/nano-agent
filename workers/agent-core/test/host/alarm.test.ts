/**
 * Tests for AlarmHandler.
 */

import { describe, it, expect, vi } from "vitest";
import { AlarmHandler } from "../../src/host/alarm.js";
import type { AlarmDeps } from "../../src/host/alarm.js";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/host/env.js";

// ── Helpers ──

function makeDeps(overrides: Partial<AlarmDeps> = {}): AlarmDeps {
  return {
    checkHealth: () => ({ heartbeatHealthy: true, ackHealthy: true }),
    closeConnection: vi.fn(async () => {}),
    setNextAlarm: vi.fn(() => {}),
    flushTraces: vi.fn(async () => {}),
    ...overrides,
  };
}

// ── Tests ──

describe("AlarmHandler", () => {
  const handler = new AlarmHandler(DEFAULT_RUNTIME_CONFIG);

  describe("handleAlarm with healthy connection", () => {
    it("does not close the connection", async () => {
      const deps = makeDeps();
      await handler.handleAlarm(deps);

      expect(deps.closeConnection).not.toHaveBeenCalled();
    });

    it("flushes traces", async () => {
      const deps = makeDeps();
      await handler.handleAlarm(deps);

      expect(deps.flushTraces).toHaveBeenCalledOnce();
    });

    it("sets the next alarm with heartbeat interval", async () => {
      const deps = makeDeps();
      await handler.handleAlarm(deps);

      expect(deps.setNextAlarm).toHaveBeenCalledWith(
        DEFAULT_RUNTIME_CONFIG.heartbeatIntervalMs,
      );
    });

    it("sets next alarm exactly once", async () => {
      const deps = makeDeps();
      await handler.handleAlarm(deps);

      expect(deps.setNextAlarm).toHaveBeenCalledOnce();
    });
  });

  describe("handleAlarm with heartbeat timeout", () => {
    it("closes connection with heartbeat_timeout reason", async () => {
      const deps = makeDeps({
        checkHealth: () => ({ heartbeatHealthy: false, ackHealthy: true }),
      });

      await handler.handleAlarm(deps);

      expect(deps.closeConnection).toHaveBeenCalledWith("heartbeat_timeout");
    });

    it("still sets the next alarm", async () => {
      const deps = makeDeps({
        checkHealth: () => ({ heartbeatHealthy: false, ackHealthy: true }),
      });

      await handler.handleAlarm(deps);

      expect(deps.setNextAlarm).toHaveBeenCalledWith(
        DEFAULT_RUNTIME_CONFIG.heartbeatIntervalMs,
      );
    });

    it("still flushes traces", async () => {
      const deps = makeDeps({
        checkHealth: () => ({ heartbeatHealthy: false, ackHealthy: true }),
      });

      await handler.handleAlarm(deps);

      expect(deps.flushTraces).toHaveBeenCalledOnce();
    });
  });

  describe("handleAlarm with ack backpressure", () => {
    it("closes connection with ack_backpressure reason", async () => {
      const deps = makeDeps({
        checkHealth: () => ({ heartbeatHealthy: true, ackHealthy: false }),
      });

      await handler.handleAlarm(deps);

      expect(deps.closeConnection).toHaveBeenCalledWith("ack_backpressure");
    });

    it("still sets the next alarm", async () => {
      const deps = makeDeps({
        checkHealth: () => ({ heartbeatHealthy: true, ackHealthy: false }),
      });

      await handler.handleAlarm(deps);

      expect(deps.setNextAlarm).toHaveBeenCalledWith(
        DEFAULT_RUNTIME_CONFIG.heartbeatIntervalMs,
      );
    });
  });

  describe("handleAlarm with both unhealthy", () => {
    it("closes with heartbeat_timeout (checked first)", async () => {
      const deps = makeDeps({
        checkHealth: () => ({ heartbeatHealthy: false, ackHealthy: false }),
      });

      await handler.handleAlarm(deps);

      expect(deps.closeConnection).toHaveBeenCalledWith("heartbeat_timeout");
      // Should only be called once (heartbeat check short-circuits)
      expect(deps.closeConnection).toHaveBeenCalledOnce();
    });
  });

  describe("trace flush failure (A2-A3 review R6)", () => {
    it("rethrows flushTraces() error when no onFlushFailure hook is supplied (no silent swallow)", async () => {
      const deps = makeDeps({
        flushTraces: vi.fn(async () => {
          throw new Error("Trace backend unavailable");
        }),
      });

      await expect(handler.handleAlarm(deps)).rejects.toThrow(
        "Trace backend unavailable",
      );
    });

    it("delegates to onFlushFailure when supplied, suppressing the throw", async () => {
      const seen: unknown[] = [];
      const deps = makeDeps({
        flushTraces: vi.fn(async () => {
          throw new Error("Trace backend unavailable");
        }),
        onFlushFailure: vi.fn(async (err) => {
          seen.push(err);
        }),
      });

      await expect(handler.handleAlarm(deps)).resolves.toBeUndefined();
      expect(deps.onFlushFailure).toHaveBeenCalledOnce();
      expect((seen[0] as Error).message).toBe("Trace backend unavailable");
    });

    it("still sets the next alarm even when onFlushFailure absorbs the error", async () => {
      const deps = makeDeps({
        flushTraces: vi.fn(async () => {
          throw new Error("Trace backend unavailable");
        }),
        onFlushFailure: vi.fn(async () => undefined),
      });

      await handler.handleAlarm(deps);

      expect(deps.setNextAlarm).toHaveBeenCalledWith(
        DEFAULT_RUNTIME_CONFIG.heartbeatIntervalMs,
      );
    });
  });

  describe("custom config", () => {
    it("uses custom heartbeat interval for next alarm", async () => {
      const customHandler = new AlarmHandler({
        ...DEFAULT_RUNTIME_CONFIG,
        heartbeatIntervalMs: 5_000,
      });

      const deps = makeDeps();
      await customHandler.handleAlarm(deps);

      expect(deps.setNextAlarm).toHaveBeenCalledWith(5_000);
    });
  });
});
