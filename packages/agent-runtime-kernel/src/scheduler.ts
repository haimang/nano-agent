/**
 * Agent Runtime Kernel — Scheduler
 *
 * Determines what to do next based on the current snapshot and external
 * signals. Pure function — no side effects.
 */

import type { KernelSnapshot } from "./state.js";
import type { StepDecision } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Scheduler Signals
// ═══════════════════════════════════════════════════════════════════

export interface SchedulerSignals {
  hasMoreToolCalls: boolean;
  compactRequired: boolean;
  cancelRequested: boolean;
  timeoutReached: boolean;
  llmFinished: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — scheduleNextStep
// ═══════════════════════════════════════════════════════════════════

export function scheduleNextStep(
  snapshot: KernelSnapshot,
  signals: SchedulerSignals,
): StepDecision {
  // Priority 1: cancel takes precedence
  if (signals.cancelRequested) {
    return { kind: "wait", reason: "cancel" };
  }

  // Priority 2: timeout
  if (signals.timeoutReached) {
    return { kind: "wait", reason: "timeout" };
  }

  // Priority 3: compaction needed
  if (signals.compactRequired) {
    return { kind: "compact" };
  }

  // Priority 4: pending tool calls to execute
  if (
    signals.hasMoreToolCalls &&
    snapshot.activeTurn &&
    snapshot.activeTurn.pendingToolCalls.length > 0
  ) {
    const desc = snapshot.activeTurn.pendingToolCalls[0];
    return {
      kind: "tool_exec",
      requestId: desc.callId,
      toolName: desc.toolName,
      args: desc.toolInput,
    };
  }

  // Priority 5: LLM not finished and no pending tools → call LLM
  if (!signals.llmFinished) {
    return { kind: "llm_call" };
  }

  // Default: turn is done
  return { kind: "finish", reason: "turn_complete" };
}
