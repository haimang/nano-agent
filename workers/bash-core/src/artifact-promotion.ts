/**
 * Artifact Promotion
 *
 * Decides when a capability result should be promoted from inline
 * output to an artifact reference. Large outputs waste context window
 * budget, so they should be stored externally and referenced by ID.
 */

import type { CapabilityResult } from "./result.js";
import { INLINE_RESULT_MAX_BYTES } from "./result.js";

/** The outcome of a promotion decision. */
export interface PromotionDecision {
  readonly promote: boolean;
  readonly reason: string;
}

/**
 * Determine whether a result should be promoted to an artifact reference.
 *
 * A result is promoted if its output exceeds the threshold (default:
 * INLINE_RESULT_MAX_BYTES = 64KB). Error and non-inline results are
 * never promoted.
 *
 * @param result The capability result to evaluate.
 * @param thresholdBytes Optional override for the size threshold.
 */
export function shouldPromote(
  result: CapabilityResult,
  thresholdBytes?: number,
): PromotionDecision {
  const threshold = thresholdBytes ?? INLINE_RESULT_MAX_BYTES;

  // Only inline results with output can be promoted
  if (result.kind !== "inline") {
    return {
      promote: false,
      reason: `Result kind "${result.kind}" is not eligible for promotion`,
    };
  }

  if (!result.output) {
    return {
      promote: false,
      reason: "No output to promote",
    };
  }

  const sizeBytes =
    result.outputSizeBytes ??
    new TextEncoder().encode(result.output).byteLength;

  if (sizeBytes > threshold) {
    return {
      promote: true,
      reason: `Output size ${sizeBytes} bytes exceeds threshold of ${threshold} bytes`,
    };
  }

  return {
    promote: false,
    reason: `Output size ${sizeBytes} bytes is within threshold of ${threshold} bytes`,
  };
}
