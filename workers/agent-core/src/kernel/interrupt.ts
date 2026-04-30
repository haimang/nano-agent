/**
 * Agent Runtime Kernel — Interrupt Classification
 *
 * Classifies interrupt reasons and determines whether the kernel
 * can resume from a given snapshot.
 */

import type { InterruptReason } from "./types.js";
import type { KernelSnapshot } from "./state.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Interrupt Classification
// ═══════════════════════════════════════════════════════════════════

export interface InterruptClassification {
  recoverable: boolean;
  requiresCheckpoint: boolean;
}

export function classifyInterrupt(
  reason: InterruptReason,
): InterruptClassification {
  switch (reason) {
    case "cancel":
      return { recoverable: false, requiresCheckpoint: false };
    case "timeout":
      return { recoverable: true, requiresCheckpoint: true };
    case "compact_required":
      return { recoverable: true, requiresCheckpoint: false };
    case "confirmation_pending":
      return { recoverable: true, requiresCheckpoint: true };
    case "fatal_error":
      return { recoverable: false, requiresCheckpoint: true };
    default: {
      const _exhaustive: never = reason;
      throw new Error(`Unknown interrupt reason: ${_exhaustive}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Resume Check
// ═══════════════════════════════════════════════════════════════════

export function canResumeFrom(snapshot: KernelSnapshot): boolean {
  // Must be in the "waiting" phase to resume
  if (snapshot.session.phase !== "waiting") {
    return false;
  }
  // Must have an active turn
  if (!snapshot.activeTurn) {
    return false;
  }
  // The interrupt reason must be recoverable
  if (!snapshot.activeTurn.interruptReason) {
    return false;
  }
  const classification = classifyInterrupt(
    snapshot.activeTurn.interruptReason,
  );
  return classification.recoverable;
}
