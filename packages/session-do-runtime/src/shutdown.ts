/**
 * Session DO Runtime — Graceful shutdown logic.
 *
 * Orchestrates the shutdown sequence for a session actor:
 *   1. Emit SessionEnd hook
 *   2. Build checkpoint
 *   3. Save checkpoint to storage
 *   4. Flush traces
 *   5. Close WebSocket with an appropriate code
 *
 * The shutdown function is reason-aware: normal session ends use
 * code 1000 (normal closure), while errors and timeouts use 1011
 * (internal error) or 1001 (going away).
 *
 * Reference: docs/action-plan/session-do-runtime.md Phase 5
 */

import type { SessionCheckpoint } from "./checkpoint.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Shutdown Reason
// ═══════════════════════════════════════════════════════════════════

/** Discriminant for why a session is shutting down. */
export type ShutdownReason =
  | "session_end"
  | "timeout"
  | "fatal_error"
  | "health_failure";

// ═══════════════════════════════════════════════════════════════════
// §2 — Shutdown Dependencies
// ═══════════════════════════════════════════════════════════════════

/**
 * Dependency injection interface for graceful shutdown.
 *
 * All side-effects are performed through these callbacks so
 * the shutdown orchestrator remains testable.
 */
export interface ShutdownDeps {
  readonly buildCheckpoint: () => Promise<SessionCheckpoint>;
  readonly saveCheckpoint: (checkpoint: SessionCheckpoint) => Promise<void>;
  readonly closeWebSocket: (code: number, reason: string) => void;
  readonly flushTraces: () => Promise<void>;
  readonly emitHook: (event: string, payload: unknown) => Promise<unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — WebSocket close code mapping
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a shutdown reason to the appropriate WebSocket close code.
 *
 *   session_end    → 1000 (Normal Closure)
 *   timeout        → 1001 (Going Away)
 *   fatal_error    → 1011 (Internal Error)
 *   health_failure → 1001 (Going Away)
 */
export function closeCodeForReason(reason: ShutdownReason): number {
  switch (reason) {
    case "session_end":
      return 1000;
    case "timeout":
    case "health_failure":
      return 1001;
    case "fatal_error":
      return 1011;
  }
}

// ═══════════════════════════════════════════════════════════════════
// §4 — gracefulShutdown
// ═══════════════════════════════════════════════════════════════════

/**
 * Execute a graceful shutdown sequence.
 *
 * Steps are executed in strict order so that the checkpoint is
 * always built and saved before the WebSocket is closed.
 *
 * Errors during hook emission or trace flushing are caught and
 * logged but do not prevent the checkpoint from being saved or
 * the WebSocket from being closed.
 */
export async function gracefulShutdown(
  reason: ShutdownReason,
  deps: ShutdownDeps,
): Promise<void> {
  // Step 1 — Emit SessionEnd hook (best-effort)
  try {
    await deps.emitHook("SessionEnd", { reason });
  } catch {
    // Hook failure is non-fatal during shutdown.
  }

  // Step 2 — Build checkpoint
  const checkpoint = await deps.buildCheckpoint();

  // Step 3 — Save checkpoint
  await deps.saveCheckpoint(checkpoint);

  // Step 4 — Flush traces (best-effort)
  try {
    await deps.flushTraces();
  } catch {
    // Trace flush failure is non-fatal during shutdown.
  }

  // Step 5 — Close WebSocket
  const code = closeCodeForReason(reason);
  deps.closeWebSocket(code, reason);
}
