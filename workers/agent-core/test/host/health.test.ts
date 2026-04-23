/**
 * Tests for HealthGate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HealthGate } from "../../src/host/health.js";
import type { HeartbeatTracker, AckWindow } from "../../src/host/health.js";
import { DEFAULT_RUNTIME_CONFIG } from "../../src/host/env.js";

describe("HealthGate", () => {
  const gate = new HealthGate(DEFAULT_RUNTIME_CONFIG);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("checkHealth", () => {
    it("reports healthy when heartbeat is recent and acks are low", () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:50.000Z",
      };
      const acks: AckWindow = { pendingCount: 0 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.heartbeatHealthy).toBe(true);
      expect(status.ackHealthy).toBe(true);
      expect(status.lastHeartbeat).toBe("2026-04-16T11:59:50.000Z");
      expect(status.pendingAcks).toBe(0);
    });

    it("reports heartbeat unhealthy when too old", () => {
      // Default heartbeatIntervalMs = 30_000, threshold = 2 * 30_000 = 60_000
      // Set last heartbeat to 2 minutes ago (120_000ms)
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:58:00.000Z",
      };
      const acks: AckWindow = { pendingCount: 0 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.heartbeatHealthy).toBe(false);
      expect(status.ackHealthy).toBe(true);
    });

    it("reports ack unhealthy when too many pending", () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const acks: AckWindow = { pendingCount: 5 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.heartbeatHealthy).toBe(true);
      expect(status.ackHealthy).toBe(false);
      expect(status.pendingAcks).toBe(5);
    });

    it("reports both unhealthy when both thresholds exceeded", () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:50:00.000Z",
      };
      const acks: AckWindow = { pendingCount: 10 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.heartbeatHealthy).toBe(false);
      expect(status.ackHealthy).toBe(false);
    });

    it("treats null lastHeartbeatAt as healthy (no heartbeat received yet)", () => {
      const tracker: HeartbeatTracker = { lastHeartbeatAt: null };
      const acks: AckWindow = { pendingCount: 0 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.heartbeatHealthy).toBe(true);
      expect(status.lastHeartbeat).toBeNull();
    });

    it("considers exactly 3 pending acks as healthy", () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const acks: AckWindow = { pendingCount: 3 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.ackHealthy).toBe(true);
    });

    it("considers 4 pending acks as unhealthy", () => {
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:55.000Z",
      };
      const acks: AckWindow = { pendingCount: 4 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.ackHealthy).toBe(false);
    });

    it("heartbeat at exactly 2x interval is still healthy", () => {
      // 2 * 30_000 = 60_000ms = 60s ago
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:00.000Z",
      };
      const acks: AckWindow = { pendingCount: 0 };

      const status = gate.checkHealth(tracker, acks);

      expect(status.heartbeatHealthy).toBe(true);
    });
  });

  describe("shouldClose", () => {
    it("returns false when everything is healthy", () => {
      const status = {
        heartbeatHealthy: true,
        ackHealthy: true,
        lastHeartbeat: "2026-04-16T11:59:55.000Z",
        pendingAcks: 0,
      };

      expect(gate.shouldClose(status)).toBe(false);
    });

    it("returns true when heartbeat is unhealthy", () => {
      const status = {
        heartbeatHealthy: false,
        ackHealthy: true,
        lastHeartbeat: "2026-04-16T11:50:00.000Z",
        pendingAcks: 0,
      };

      expect(gate.shouldClose(status)).toBe(true);
    });

    it("returns true when ack is unhealthy", () => {
      const status = {
        heartbeatHealthy: true,
        ackHealthy: false,
        lastHeartbeat: "2026-04-16T11:59:55.000Z",
        pendingAcks: 10,
      };

      expect(gate.shouldClose(status)).toBe(true);
    });

    it("returns true when both are unhealthy", () => {
      const status = {
        heartbeatHealthy: false,
        ackHealthy: false,
        lastHeartbeat: null,
        pendingAcks: 10,
      };

      expect(gate.shouldClose(status)).toBe(true);
    });
  });

  describe("custom config", () => {
    it("uses custom heartbeat interval for health check", () => {
      const customGate = new HealthGate({
        ...DEFAULT_RUNTIME_CONFIG,
        heartbeatIntervalMs: 5_000, // 5s, threshold = 10s
      });

      // 15 seconds ago — should be unhealthy with 5s interval
      const tracker: HeartbeatTracker = {
        lastHeartbeatAt: "2026-04-16T11:59:45.000Z",
      };
      const acks: AckWindow = { pendingCount: 0 };

      const status = customGate.checkHealth(tracker, acks);

      expect(status.heartbeatHealthy).toBe(false);
    });
  });
});
