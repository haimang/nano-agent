/**
 * Integration test: alarm handler with HealthGate for heartbeat/ack timeout.
 *
 * Tests the alarm handler in combination with the health gate:
 *   1. Healthy state → no close, next alarm set
 *   2. Heartbeat timeout → connection closed
 *   3. Ack backpressure → connection closed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlarmHandler } from "../../src/alarm.js";
import type { AlarmDeps } from "../../src/alarm.js";
import { HealthGate } from "../../src/health.js";
import type { HeartbeatTracker, AckWindow } from "../../src/health.js";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/env.js";
import type { RuntimeConfig } from "../../src/env.js";

// ── Helpers ──

function createIntegrationDeps(
  config: RuntimeConfig,
  tracker: HeartbeatTracker,
  ackWindow: AckWindow,
): AlarmDeps & { closeCalls: string[]; alarmDelays: number[] } {
  const gate = new HealthGate(config);
  const closeCalls: string[] = [];
  const alarmDelays: number[] = [];

  return {
    closeCalls,
    alarmDelays,
    checkHealth: () => {
      const status = gate.checkHealth(tracker, ackWindow);
      return {
        heartbeatHealthy: status.heartbeatHealthy,
        ackHealthy: status.ackHealthy,
      };
    },
    closeConnection: vi.fn(async (reason: string) => {
      closeCalls.push(reason);
    }),
    setNextAlarm: vi.fn((delayMs: number) => {
      alarmDelays.push(delayMs);
    }),
    flushTraces: vi.fn(async () => {}),
  };
}

// ── Tests ──

describe("heartbeat-ack-timeout integration", () => {
  const config = DEFAULT_RUNTIME_CONFIG;
  const alarmHandler = new AlarmHandler(config);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("healthy state", () => {
    it("does not close connection when heartbeat is recent and acks are low", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:50.000Z", // 10s ago, within 60s threshold
      };
      const ackWindow: AckWindow = { pendingCount: 1 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.closeCalls).toEqual([]);
      expect(deps.alarmDelays).toEqual([config.heartbeatIntervalMs]);
    });

    it("does not close when no heartbeat has been received yet", async () => {
      const tracker: HeartbeatTracker = { lastHeartbeatAt: null };
      const ackWindow: AckWindow = { pendingCount: 0 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.closeCalls).toEqual([]);
    });

    it("sets next alarm at the configured heartbeat interval", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 0 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.alarmDelays).toEqual([30_000]);
    });
  });

  describe("heartbeat timeout", () => {
    it("closes connection when last heartbeat exceeds 2x interval", async () => {
      // 2 * 30_000 = 60_000ms threshold. Last beat was 90s ago.
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:58:30.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 0 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.closeCalls).toEqual(["heartbeat_timeout"]);
    });

    it("still schedules next alarm after closing", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:58:00.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 0 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.alarmDelays).toEqual([config.heartbeatIntervalMs]);
    });
  });

  describe("ack backpressure", () => {
    it("closes connection when pending acks exceed threshold", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 5 }; // > 3 threshold

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.closeCalls).toEqual(["ack_backpressure"]);
    });

    it("does not close at exactly 3 pending acks (boundary)", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 3 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.closeCalls).toEqual([]);
    });

    it("closes at 4 pending acks", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 4 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      expect(deps.closeCalls).toEqual(["ack_backpressure"]);
    });
  });

  describe("both unhealthy", () => {
    it("heartbeat check takes priority over ack check", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:58:00.000Z", // timed out
      };
      const ackWindow: AckWindow = { pendingCount: 10 }; // also over threshold

      const deps = createIntegrationDeps(config, tracker, ackWindow);
      await alarmHandler.handleAlarm(deps);

      // Should close with heartbeat reason (checked first)
      expect(deps.closeCalls).toEqual(["heartbeat_timeout"]);
    });
  });

  describe("custom config", () => {
    it("uses shorter heartbeat interval for faster detection", async () => {
      const fastConfig: RuntimeConfig = {
        ...DEFAULT_RUNTIME_CONFIG,
        heartbeatIntervalMs: 5_000, // 5s, threshold = 10s
      };
      const fastAlarm = new AlarmHandler(fastConfig);

      // 15 seconds ago — exceeds 10s threshold
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:45.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 0 };

      const deps = createIntegrationDeps(fastConfig, tracker, ackWindow);
      await fastAlarm.handleAlarm(deps);

      expect(deps.closeCalls).toEqual(["heartbeat_timeout"]);
      expect(deps.alarmDelays).toEqual([5_000]);
    });
  });

  describe("multiple alarm ticks", () => {
    it("remains healthy across multiple ticks with fresh heartbeats", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 0 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);

      // Tick 1
      await alarmHandler.handleAlarm(deps);
      expect(deps.closeCalls).toEqual([]);

      // Simulate time advancing and a fresh heartbeat
      vi.setSystemTime(new Date("2026-04-16T12:00:30.000Z"));
      (tracker as { lastHeartbeatAt: string | null }).lastHeartbeatAt =
        "2026-04-16T12:00:25.000Z";

      // Tick 2
      await alarmHandler.handleAlarm(deps);
      expect(deps.closeCalls).toEqual([]);
      expect(deps.alarmDelays).toEqual([
        config.heartbeatIntervalMs,
        config.heartbeatIntervalMs,
      ]);
    });

    it("detects timeout on second tick when heartbeat goes stale", async () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const ackWindow: AckWindow = { pendingCount: 0 };

      const deps = createIntegrationDeps(config, tracker, ackWindow);

      // Tick 1 — healthy
      await alarmHandler.handleAlarm(deps);
      expect(deps.closeCalls).toEqual([]);

      // Time advances 90s, no fresh heartbeat
      vi.setSystemTime(new Date("2026-04-16T12:01:30.000Z"));

      // Tick 2 — now stale
      await alarmHandler.handleAlarm(deps);
      expect(deps.closeCalls).toEqual(["heartbeat_timeout"]);
    });
  });
});
