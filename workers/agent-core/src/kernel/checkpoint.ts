/**
 * Agent Runtime Kernel — Checkpoint / Restore
 *
 * Kernel checkpoint fragment — only the kernel's portion,
 * NOT the full session checkpoint. This is designed to be composed
 * with other subsystem fragments into a full session checkpoint.
 */

import { z } from "zod";
import type { KernelSnapshot } from "./state.js";
import type { SessionState, TurnState } from "./state.js";
import {
  SessionStateSchema,
  TurnStateSchema,
  createKernelSnapshot,
} from "./state.js";
import { KERNEL_VERSION } from "./version.js";
import { KernelError, KERNEL_ERROR_CODES } from "./errors.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — KernelCheckpointFragment
// ═══════════════════════════════════════════════════════════════════

export interface KernelCheckpointFragment {
  version: string;
  session: SessionState;
  activeTurn: TurnState | null;
  lastAction: string | null;
  checkpointedAt: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Schema for validation
// ═══════════════════════════════════════════════════════════════════

const KernelCheckpointFragmentSchema = z.object({
  version: z.string(),
  session: SessionStateSchema,
  activeTurn: TurnStateSchema.nullable(),
  lastAction: z.string().nullable(),
  checkpointedAt: z.string(),
});

// ═══════════════════════════════════════════════════════════════════
// §3 — buildCheckpointFragment
// ═══════════════════════════════════════════════════════════════════

/**
 * Builds a checkpoint fragment from a kernel snapshot.
 * Captures the current session state, active turn, and timestamp.
 */
export function buildCheckpointFragment(
  snapshot: KernelSnapshot,
): KernelCheckpointFragment {
  return {
    version: snapshot.version,
    session: { ...snapshot.session },
    activeTurn: snapshot.activeTurn ? { ...snapshot.activeTurn } : null,
    lastAction: snapshot.activeTurn
      ? `step:${snapshot.activeTurn.stepIndex}`
      : null,
    checkpointedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// §4 — restoreFromFragment
// ═══════════════════════════════════════════════════════════════════

/**
 * Restores a KernelSnapshot from a checkpoint fragment.
 * The fragment's version is used as the snapshot version.
 *
 * @throws {KernelError} with code CHECKPOINT_VERSION_MISMATCH when
 *   the fragment's version does not match the current KERNEL_VERSION.
 */
export function restoreFromFragment(
  fragment: KernelCheckpointFragment,
): KernelSnapshot {
  if (fragment.version !== KERNEL_VERSION) {
    throw new KernelError(
      KERNEL_ERROR_CODES.CHECKPOINT_VERSION_MISMATCH,
      `Checkpoint version "${fragment.version}" does not match kernel version "${KERNEL_VERSION}"`,
    );
  }
  return createKernelSnapshot(
    { ...fragment.session },
    fragment.activeTurn ? { ...fragment.activeTurn } : null,
  );
}

// ═══════════════════════════════════════════════════════════════════
// §5 — validateFragment
// ═══════════════════════════════════════════════════════════════════

/**
 * Type guard that validates whether an unknown value is a valid
 * KernelCheckpointFragment. Uses Zod schema for structural validation.
 */
export function validateFragment(
  fragment: unknown,
): fragment is KernelCheckpointFragment {
  const result = KernelCheckpointFragmentSchema.safeParse(fragment);
  return result.success;
}
