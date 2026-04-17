/**
 * Session DO Runtime — Caller-managed health gates.
 *
 * Checks heartbeat and ack health for a session connection.
 * The health gate does not own the heartbeat tracker or ack window —
 * it receives them as parameters and applies the thresholds from
 * RuntimeConfig to produce a HealthStatus verdict.
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 3
 * Reference code: packages/nacp-session/src/websocket.ts (HeartbeatTracker)
 */

import type { RuntimeConfig } from "./env.js";

/** Health status snapshot for a session connection. */
export interface HealthStatus {
  readonly heartbeatHealthy: boolean;
  readonly ackHealthy: boolean;
  readonly lastHeartbeat: string | null;
  readonly pendingAcks: number;
}

/**
 * Minimal interface expected from a heartbeat tracker.
 * The caller provides the concrete implementation.
 */
export interface HeartbeatTracker {
  readonly lastHeartbeatAt: string | null;
}

/**
 * Minimal interface expected from an ack window.
 * The caller provides the concrete implementation.
 */
export interface AckWindow {
  readonly pendingCount: number;
}

/**
 * Health gate that evaluates connection health against configured thresholds.
 *
 * Does not own any timers or state — it is a pure evaluator that the
 * session actor calls on demand.
 */
export class HealthGate {
  constructor(private readonly config: RuntimeConfig) {}

  /**
   * Evaluate the health of a session connection.
   *
   * Heartbeat is healthy if the last heartbeat was received within
   * `2 * heartbeatIntervalMs` of now (allowing one missed beat).
   *
   * Ack is healthy if the number of pending acks is <= 3 (a reasonable
   * pipeline depth before the connection is considered stalled).
   */
  checkHealth(
    heartbeatTracker: HeartbeatTracker,
    ackWindow: AckWindow,
  ): HealthStatus {
    const now = Date.now();
    const maxPendingAcks = 3;

    let heartbeatHealthy = true;
    if (heartbeatTracker.lastHeartbeatAt !== null) {
      const lastBeat = new Date(heartbeatTracker.lastHeartbeatAt).getTime();
      const elapsed = now - lastBeat;
      heartbeatHealthy = elapsed <= this.config.heartbeatIntervalMs * 2;
    }

    const ackHealthy = ackWindow.pendingCount <= maxPendingAcks;

    return {
      heartbeatHealthy,
      ackHealthy,
      lastHeartbeat: heartbeatTracker.lastHeartbeatAt,
      pendingAcks: ackWindow.pendingCount,
    };
  }

  /**
   * Determine whether the connection should be closed based on health status.
   *
   * The connection should be closed if either the heartbeat or ack
   * health check fails.
   */
  shouldClose(status: HealthStatus): boolean {
    return !status.heartbeatHealthy || !status.ackHealthy;
  }
}
