/**
 * Session DO Runtime — Alarm handler.
 *
 * Handles periodic DO alarms for health checks and maintenance.
 * The alarm fires on a configurable interval and:
 *   1. Evaluates connection health (heartbeat + ack)
 *   2. Closes the connection if unhealthy
 *   3. Flushes pending traces
 *   4. Schedules the next alarm
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 5
 */

import type { RuntimeConfig } from "./env.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Alarm Dependencies
// ═══════════════════════════════════════════════════════════════════

/**
 * Dependency injection interface for the alarm handler.
 *
 * The alarm handler does not own any of these subsystems — it
 * receives them as callbacks so the handler remains testable
 * without real WebSocket connections or trace backends.
 */
export interface AlarmDeps {
  readonly checkHealth: () => { heartbeatHealthy: boolean; ackHealthy: boolean };
  readonly closeConnection: (reason: string) => Promise<void>;
  readonly setNextAlarm: (delayMs: number) => void;
  readonly flushTraces: () => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — AlarmHandler
// ═══════════════════════════════════════════════════════════════════

/**
 * Alarm handler for periodic session health checks and maintenance.
 *
 * Designed to be called from the Durable Object's `alarm()` method.
 * All side-effects are performed through the injected AlarmDeps,
 * keeping the handler itself pure and testable.
 */
export class AlarmHandler {
  constructor(private readonly config: RuntimeConfig) {}

  /**
   * Handle a DO alarm tick.
   *
   * Steps:
   *   1. Check connection health via the injected gate.
   *   2. If unhealthy, close the connection with a descriptive reason.
   *   3. Flush any pending traces.
   *   4. Schedule the next alarm at heartbeatIntervalMs.
   */
  async handleAlarm(deps: AlarmDeps): Promise<void> {
    // Step 1 — evaluate health
    const health = deps.checkHealth();

    // Step 2 — close if unhealthy
    if (!health.heartbeatHealthy) {
      await deps.closeConnection("heartbeat_timeout");
    } else if (!health.ackHealthy) {
      await deps.closeConnection("ack_backpressure");
    }

    // Step 3 — flush traces (best-effort)
    try {
      await deps.flushTraces();
    } catch {
      // Trace flush failure is non-fatal — swallow and continue.
    }

    // Step 4 — schedule next alarm
    deps.setNextAlarm(this.config.heartbeatIntervalMs);
  }
}
