/**
 * Session DO Runtime — Trace Integration.
 *
 * Bridges eval-observability with Session DO lifecycle events.
 * Builds properly-shaped trace event objects that conform to the
 * TraceEvent schema from @nano-agent/eval-observability.
 *
 * These are pure factory functions — they produce trace event objects
 * but do not emit them. The caller (SessionOrchestrator) is responsible
 * for passing them to TraceSink.emit().
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 4
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — TraceDeps
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal dependency for trace emission.
 * The Session DO injects this from the eval subsystem handle.
 */
export interface TraceDeps {
  readonly emitTrace: (event: unknown) => Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Turn Start Trace
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a trace event for when a turn starts.
 *
 * Layer: durable-audit (persisted for compliance/replay).
 * Audience: internal (not streamed to client).
 */
export function buildTurnStartTrace(
  turnId: string,
  sessionUuid: string,
  teamUuid: string,
): unknown {
  return {
    eventKind: "turn.started",
    timestamp: new Date().toISOString(),
    sessionUuid,
    teamUuid,
    turnUuid: turnId,
    audience: "internal",
    layer: "durable-audit",
  };
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Turn End Trace
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a trace event for when a turn ends.
 *
 * Includes durationMs so downstream analysis can measure turn latency.
 */
export function buildTurnEndTrace(
  turnId: string,
  sessionUuid: string,
  teamUuid: string,
  durationMs: number,
): unknown {
  return {
    eventKind: "turn.completed",
    timestamp: new Date().toISOString(),
    sessionUuid,
    teamUuid,
    turnUuid: turnId,
    durationMs,
    audience: "internal",
    layer: "durable-audit",
  };
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Step Trace
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a trace event for a single kernel step.
 *
 * Wraps an arbitrary runtime event with session/team context
 * so traces can be correlated across the observability pipeline.
 */
export function buildStepTrace(
  event: unknown,
  sessionUuid: string,
  teamUuid: string,
): unknown {
  const evt = event as Record<string, unknown>;
  return {
    eventKind: (evt.type as string) ?? "step",
    timestamp: (evt.timestamp as string) ?? new Date().toISOString(),
    sessionUuid,
    teamUuid,
    turnUuid: evt.turnId ?? undefined,
    stepIndex: evt.stepIndex ?? undefined,
    audience: "internal",
    layer: "live",
  };
}
