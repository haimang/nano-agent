/**
 * Agent Runtime Kernel — Error Types
 *
 * All kernel-level failures throw a KernelError so callers can
 * pattern-match on .code for structured error handling.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — Error Codes
// ═══════════════════════════════════════════════════════════════════

export const KERNEL_ERROR_CODES = {
  ILLEGAL_PHASE_TRANSITION: "ILLEGAL_PHASE_TRANSITION",
  TURN_ALREADY_ACTIVE: "TURN_ALREADY_ACTIVE",
  TURN_NOT_FOUND: "TURN_NOT_FOUND",
  STEP_TIMEOUT: "STEP_TIMEOUT",
  KERNEL_INTERRUPTED: "KERNEL_INTERRUPTED",
  CHECKPOINT_VERSION_MISMATCH: "CHECKPOINT_VERSION_MISMATCH",
} as const;

export type KernelErrorCode =
  (typeof KERNEL_ERROR_CODES)[keyof typeof KERNEL_ERROR_CODES];

// ═══════════════════════════════════════════════════════════════════
// §2 — KernelError
// ═══════════════════════════════════════════════════════════════════

export class KernelError extends Error {
  public readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message?: string) {
    super(message ?? `Kernel error: ${code}`);
    this.name = "KernelError";
    this.code = code;
  }
}
