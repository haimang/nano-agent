/**
 * Eval sink contract truth for pre-worker-matrix W0.
 *
 * This file intentionally freezes only the sink-facing shapes and helper
 * used by higher-level runtimes. The bounded in-memory sink class stays
 * in `session-do-runtime`.
 */

/** Arguments accepted by an eval sink `emit()` call. */
export interface EvalSinkEmitArgs {
  readonly record: unknown;
  readonly messageUuid?: string;
}

/** A single overflow-disclosure entry surfaced by a bounded eval sink. */
export interface EvalSinkOverflowDisclosure {
  readonly at: string;
  readonly reason: "capacity-exceeded" | "duplicate-message";
  readonly droppedCount: number;
  readonly capacity: number;
  readonly messageUuid?: string;
}

/** Counters exposed by eval sinks for inspector / observability surfaces. */
export interface EvalSinkStats {
  readonly recordCount: number;
  readonly capacity: number;
  readonly capacityOverflowCount: number;
  readonly duplicateDropCount: number;
  readonly totalOverflowCount: number;
  readonly dedupEligible: number;
  readonly missingMessageUuid: number;
}

/**
 * Best-effort message UUID extraction across the shapes currently emitted
 * by trace / session runtime call sites.
 */
export function extractMessageUuid(record: unknown): string | undefined {
  if (record === null || typeof record !== "object") return undefined;
  const obj = record as Record<string, unknown>;

  if (typeof obj.messageUuid === "string" && obj.messageUuid.length > 0) {
    return obj.messageUuid;
  }
  if (typeof obj.message_uuid === "string" && obj.message_uuid.length > 0) {
    return obj.message_uuid;
  }

  const envelope =
    obj.envelope !== null && typeof obj.envelope === "object"
      ? (obj.envelope as Record<string, unknown>)
      : undefined;
  const envelopeHeader =
    envelope &&
    envelope.header !== null &&
    typeof envelope.header === "object"
      ? (envelope.header as Record<string, unknown>)
      : undefined;
  if (
    envelopeHeader &&
    typeof envelopeHeader.message_uuid === "string" &&
    envelopeHeader.message_uuid.length > 0
  ) {
    return envelopeHeader.message_uuid;
  }

  const header =
    obj.header !== null && typeof obj.header === "object"
      ? (obj.header as Record<string, unknown>)
      : undefined;
  if (
    header &&
    typeof header.message_uuid === "string" &&
    header.message_uuid.length > 0
  ) {
    return header.message_uuid;
  }

  return undefined;
}
