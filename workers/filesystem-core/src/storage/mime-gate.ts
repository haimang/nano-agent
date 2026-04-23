/**
 * Storage Topology — MIME-type gate.
 *
 * Formalises the workspace / artifact decision "inline vs ref" as an
 * executable contract that any caller can run. The gate is deliberately
 * coarse — it returns one of four decisions and a reason string, and
 * makes no claim about the "right" byte threshold (which belongs in the
 * calibration layer and is evidence-driven).
 */

/** Decisions the gate can produce for a given (mime_type, size) pair. */
export type MimePolicyDecision =
  | "inline"
  | "signed-url"
  | "prepared-text"
  | "reject";

export interface MimePolicyInput {
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** Whether the consuming model supports vision-style inputs. */
  readonly supportsVision?: boolean;
}

export interface MimePolicyResult {
  readonly decision: MimePolicyDecision;
  readonly reason: string;
  /**
   * The byte cut-off consulted by this decision. Surfaced so callers
   * can log / revisit the threshold alongside the decision itself.
   */
  readonly thresholdBytes: number;
}

/** Default — PROVISIONAL — inline size recommendation for small text blobs. */
export const DEFAULT_INLINE_TEXT_BYTES = 100 * 1024;

/** MIME types that require upstream extraction before they can be inlined. */
export const PREPARED_TEXT_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/rtf",
]);

export interface MimePolicyOptions {
  readonly inlineTextBytes?: number;
}

/**
 * Gate a (`mimeType`, `sizeBytes`) pair into an attachment decision.
 *
 * Rules (v1):
 *   1. `image/*` + `supportsVision` → `signed-url`.
 *   2. `image/*` without vision     → `reject`.
 *   3. PDF / Office documents       → `prepared-text`.
 *   4. `text/*` / `application/json` / `application/xml`
 *        under provisional inline threshold → `inline`
 *        over provisional inline threshold → `prepared-text`.
 *   5. Anything else → `reject`.
 *
 * The `thresholdBytes` field in the result reports which byte cut-off
 * the gate consulted, making it easy to log the provisional nature
 * alongside the final decision.
 */
export function applyMimePolicy(
  input: MimePolicyInput,
  options: MimePolicyOptions = {},
): MimePolicyResult {
  const threshold = options.inlineTextBytes ?? DEFAULT_INLINE_TEXT_BYTES;

  if (input.mimeType.startsWith("image/")) {
    if (input.supportsVision) {
      return {
        decision: "signed-url",
        reason: "image/* + vision-capable model → deliver as signed URL",
        thresholdBytes: threshold,
      };
    }
    return {
      decision: "reject",
      reason: "image/* but the target model does not advertise vision support",
      thresholdBytes: threshold,
    };
  }

  if (PREPARED_TEXT_MIME_TYPES.has(input.mimeType)) {
    return {
      decision: "prepared-text",
      reason: `Document MIME type "${input.mimeType}" requires upstream text extraction`,
      thresholdBytes: threshold,
    };
  }

  if (
    input.mimeType.startsWith("text/") ||
    input.mimeType === "application/json" ||
    input.mimeType === "application/xml"
  ) {
    if (input.sizeBytes <= threshold) {
      return {
        decision: "inline",
        reason: `Text attachment within provisional inline threshold (${threshold} bytes)`,
        thresholdBytes: threshold,
      };
    }
    return {
      decision: "prepared-text",
      reason:
        `Text attachment size ${input.sizeBytes} bytes exceeds provisional inline ` +
        `threshold of ${threshold} bytes — requires extraction / summarisation`,
      thresholdBytes: threshold,
    };
  }

  return {
    decision: "reject",
    reason: `MIME type "${input.mimeType}" is not supported for LLM attachment`,
    thresholdBytes: threshold,
  };
}
