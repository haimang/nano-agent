/**
 * Agent Runtime Kernel — Message Intents
 *
 * Maps kernel StepDecision kinds to existing nacp-core message families
 * (tool.call.*, hook.*, context.compact.*, system.*, audit.record).
 */

import type { StepDecision } from "./types.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Message Intent
// ═══════════════════════════════════════════════════════════════════

export type MessageIntent =
  | "tool.call.request"
  | "tool.call.response"
  | "tool.call.cancel"
  | "hook.emit"
  | "hook.outcome"
  | "context.compact.request"
  | "context.compact.response"
  | "system.error"
  | "audit.record";

// ═══════════════════════════════════════════════════════════════════
// §2 — intentForStep
// ═══════════════════════════════════════════════════════════════════

/**
 * Maps a scheduler StepDecision to the corresponding nacp-core
 * MessageIntent. Returns null for decisions that do not map to
 * a message family (e.g., llm_call, wait, finish).
 */
export function intentForStep(decision: StepDecision): MessageIntent | null {
  switch (decision.kind) {
    case "tool_exec":
      return "tool.call.request";
    case "hook_emit":
      return "hook.emit";
    case "compact":
      return "context.compact.request";
    case "llm_call":
      return null;
    case "wait":
      return null;
    case "finish":
      return null;
    default: {
      const _exhaustive: never = decision;
      throw new Error(
        `Unknown decision kind: ${(_exhaustive as StepDecision).kind}`,
      );
    }
  }
}
