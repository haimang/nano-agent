/**
 * Capability Result Types
 *
 * Normalised result shapes returned after capability execution completes.
 * Large outputs can be "promoted" to an artifact store instead of being
 * inlined in the conversation context.
 */

/** Outcome classification for a capability execution. */
export type CapabilityResultKind =
  | "inline"
  | "promoted"
  | "error"
  | "cancelled"
  | "timeout";

/** Normalised result of a capability execution. */
export interface CapabilityResult {
  readonly kind: CapabilityResultKind;
  readonly capabilityName: string;
  readonly requestId: string;
  readonly output?: string;
  readonly outputSizeBytes?: number;
  readonly promotionSuggested?: boolean;
  readonly artifactRef?: unknown;
  readonly error?: { code: string; message: string };
  readonly durationMs: number;
}

/**
 * Default threshold (in bytes) below which capability output is inlined
 * directly in the conversation context. Outputs exceeding this are
 * candidates for promotion to an artifact store.
 *
 * Provisional — will be tunable via configuration in later phases.
 */
export const INLINE_RESULT_MAX_BYTES: number = 64 * 1024;
