/**
 * @nano-agent/eval-observability — audit record codec.
 *
 * Converts between TraceEvent and the body shape expected by nacp-core's
 * `audit.record` message type: `{ event_kind: string; detail?: Record<string, unknown> }`.
 *
 * A3 Phase 2 (P2-01) trace-first invariants:
 *   - On encode, `traceUuid` / `sourceRole` / `sourceKey` / `messageUuid`
 *     are preserved in `detail` alongside every other base + evidence
 *     field. The codec never strips them.
 *   - On decode, the recovered TraceEvent re-acquires those fields from
 *     either the audit body's `detail` (preferred) or the caller-supplied
 *     `AuditRecordMeta` (fallback). This guarantees that downstream code
 *     which reads traces back out of audit storage will always see a
 *     trace-law-compliant event.
 *
 * The codec:
 *   - Flattens TraceEvent base fields + evidence extensions into a
 *     `detail` object.
 *   - Applies truncation to large string fields via `truncateOutput`.
 *   - Only encodes events that should be persisted (durable-audit or
 *     durable-transcript).
 */

import type { TraceEvent } from "./trace-event.js";
import type { EventAudience, TraceLayer, TraceSourceRole } from "./types.js";
import { truncateOutput } from "./truncation.js";
import { shouldPersist } from "./classification.js";

/** The shape of an `audit.record` message body. */
export interface AuditRecordBody {
  readonly event_kind: string;
  readonly detail: Record<string, unknown>;
}

/**
 * Metadata required to reconstruct a TraceEvent from an audit body.
 *
 * `traceUuid` and `sourceRole` live on the meta as well as (historically)
 * inside `detail`; when both are present, the codec prefers `detail` so
 * that round-tripping an encoded event reproduces the original exactly.
 * The meta acts as a fallback only — typically filled from the envelope
 * that delivered the audit record.
 */
export interface AuditRecordMeta {
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly timestamp: string;
  readonly traceUuid?: string;
  readonly sourceRole?: TraceSourceRole;
  readonly sourceKey?: string;
  readonly messageUuid?: string;
}

/** Maximum byte length for string values inside the detail object. */
const DETAIL_STRING_MAX_BYTES = 10_000;

/**
 * Envelope-level fields that are carried outside `detail`. Everything else
 * (including the trace-first carriers) goes into `detail`.
 */
const ENVELOPE_KEYS = new Set([
  "eventKind",
  "timestamp",
  "sessionUuid",
  "teamUuid",
]);

/**
 * Convert a TraceEvent into an `audit.record` body.
 *
 * Returns `null` if the event is live-only and should not be encoded.
 */
export function traceEventToAuditBody(
  event: TraceEvent,
): AuditRecordBody | null {
  if (!shouldPersist(event.eventKind)) {
    return null;
  }

  const detail: Record<string, unknown> = {};

  // Iterate all keys on the event, skipping those handled at envelope level.
  for (const [key, value] of Object.entries(event)) {
    if (ENVELOPE_KEYS.has(key)) continue;
    if (value === undefined) continue;
    detail[key] =
      typeof value === "string"
        ? truncateOutput(value, DETAIL_STRING_MAX_BYTES)
        : value;
  }

  return {
    event_kind: event.eventKind,
    detail,
  };
}

/**
 * Reconstruct a TraceEvent from an `audit.record` body and envelope metadata.
 *
 * Prefers trace-first carriers from `detail`; falls back to the envelope
 * `meta` for `traceUuid` / `sourceRole` / `sourceKey` / `messageUuid` so
 * callers that strip them from `detail` for privacy can still recover a
 * trace-law-compliant event. Throws if neither detail nor meta contains
 * a `traceUuid` — trace law does not permit anchorless audit events.
 */
export function auditBodyToTraceEvent(
  body: { event_kind: string; detail?: Record<string, unknown> },
  meta: AuditRecordMeta,
): TraceEvent {
  const detail = body.detail ?? {};

  const traceUuid =
    typeof detail.traceUuid === "string" ? detail.traceUuid : meta.traceUuid;
  const sourceRole =
    typeof detail.sourceRole === "string"
      ? (detail.sourceRole as TraceSourceRole)
      : meta.sourceRole;
  const sourceKey =
    typeof detail.sourceKey === "string"
      ? detail.sourceKey
      : meta.sourceKey;
  const messageUuid =
    typeof detail.messageUuid === "string"
      ? detail.messageUuid
      : meta.messageUuid;

  if (!traceUuid) {
    throw new Error(
      `auditBodyToTraceEvent: trace law violation — audit body for '${body.event_kind}' has no traceUuid in detail or meta`,
    );
  }
  if (!sourceRole) {
    throw new Error(
      `auditBodyToTraceEvent: trace law violation — audit body for '${body.event_kind}' has no sourceRole in detail or meta`,
    );
  }

  const rest = omitKeys(detail, [
    "audience",
    "layer",
    "traceUuid",
    "sourceRole",
    "sourceKey",
    "messageUuid",
  ]);

  const event: Record<string, unknown> = {
    eventKind: body.event_kind,
    timestamp: meta.timestamp,
    traceUuid,
    sessionUuid: meta.sessionUuid,
    teamUuid: meta.teamUuid,
    sourceRole,
    audience: (detail.audience as EventAudience) ?? "internal",
    layer: (detail.layer as TraceLayer) ?? "durable-audit",
    ...rest,
  };
  if (sourceKey !== undefined) event.sourceKey = sourceKey;
  if (messageUuid !== undefined) event.messageUuid = messageUuid;

  return event as unknown as TraceEvent;
}

/** Return a shallow copy of `obj` without the specified keys. */
function omitKeys(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const omit = new Set(keys);
  for (const [k, v] of Object.entries(obj)) {
    if (!omit.has(k)) {
      result[k] = v;
    }
  }
  return result;
}
