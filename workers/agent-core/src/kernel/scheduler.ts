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
  /**
   * RH1 P1-01 — pending hook events queued by the host (e.g. tool-execution
   * pre/post hooks waiting for dispatch). When non-empty and no higher-priority
   * signal fires, scheduler drains one event per call by emitting a
   * `hook_emit` decision. Caller is expected to remove the event from its own
   * queue once the runner consumes the decision.
   */
  pendingHookEvents?: readonly string[];
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

  // Priority 3.5 (RH1 P1-01): pending hook events drain before tool/llm.
  // Hooks are emitted before the next tool execution / llm call so
  // pre-* hooks (PreToolUse / PreCompact / SessionStart) can short-circuit.
  if (signals.pendingHookEvents && signals.pendingHookEvents.length > 0) {
    return { kind: "hook_emit", event: signals.pendingHookEvents[0]! };
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
