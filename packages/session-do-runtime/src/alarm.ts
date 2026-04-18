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
  /**
   * A2-A3 review R6: explicit failure observer for the trace-flush
   * path. When `flushTraces()` throws, the AlarmHandler surfaces the
   * error through this hook instead of silently swallowing it. The DO
   * wires this to `emitAlarmTrace("trace.recovery", { ... })` so every
   * flush failure is itself audit-visible — the opposite of the
   * previous behaviour where the alarm could drop traces without a
   * single observable signal.
   *
   * If `onFlushFailure` is omitted the AlarmHandler still does NOT
   * swallow silently — it rethrows the original error so the caller's
   * top-level alarm() sees a stack frame instead of a dropped signal.
   */
  readonly onFlushFailure?: (err: unknown) => Promise<void> | void;
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

    // Step 3 — flush traces. A2-A3 review R6: the previous
    // silent-swallow contradicted A3 "no silent trace loss". When the
    // flush fails we either hand the error to the injected
    // `onFlushFailure` hook (the DO wires that to a
    // `trace.recovery` emission), or rethrow so the alarm() caller
    // sees a stack frame instead of dropping the signal entirely.
    try {
      await deps.flushTraces();
    } catch (err) {
      if (deps.onFlushFailure) {
        await deps.onFlushFailure(err);
      } else {
        throw err;
      }
    }

    // Step 4 — schedule next alarm
    deps.setNextAlarm(this.config.heartbeatIntervalMs);
  }
}
