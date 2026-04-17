/**
 * @nano-agent/eval-observability — audit record codec.
 *
 * Converts between TraceEvent and the body shape expected by nacp-core's
 * `audit.record` message type: `{ event_kind: string; detail?: Record<string, unknown> }`.
 *
 * The codec:
 *  - Flattens TraceEvent base fields + evidence extensions into a `detail` object.
 *  - Applies truncation to large string fields via `truncateOutput`.
 *  - Only encodes events that should be persisted (durable-audit or durable-transcript).
 */

import type { TraceEvent } from "./trace-event.js";
import type { EventAudience, TraceLayer } from "./types.js";
import { truncateOutput } from "./truncation.js";
import { shouldPersist } from "./classification.js";

/** The shape of an `audit.record` message body. */
export interface AuditRecordBody {
  readonly event_kind: string;
  readonly detail: Record<string, unknown>;
}

/** Metadata required to reconstruct a TraceEvent from an audit body. */
export interface AuditRecordMeta {
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly timestamp: string;
}

/** Maximum byte length for string values inside the detail object. */
const DETAIL_STRING_MAX_BYTES = 10_000;

/**
 * Convert a TraceEvent into an `audit.record` body.
 *
 * Returns `null` if the event is live-only and should not be encoded.
 */
export function traceEventToAuditBody(event: TraceEvent): AuditRecordBody | null {
  if (!shouldPersist(event.eventKind)) {
    return null;
  }

  const detail: Record<string, unknown> = {};

  // Iterate all keys on the event, skipping those handled at envelope level.
  for (const [key, value] of Object.entries(event)) {
    if (key === "eventKind" || key === "timestamp" || key === "sessionUuid" || key === "teamUuid") {
      continue;
    }
    if (value === undefined) {
      continue;
    }
    detail[key] = typeof value === "string" ? truncateOutput(value, DETAIL_STRING_MAX_BYTES) : value;
  }

  return {
    event_kind: event.eventKind,
    detail,
  };
}

/**
 * Reconstruct a TraceEvent from an `audit.record` body and envelope metadata.
 *
 * Fields that are not present in the detail object receive their type-appropriate
 * defaults. This is the inverse of `traceEventToAuditBody`.
 */
export function auditBodyToTraceEvent(
  body: { event_kind: string; detail?: Record<string, unknown> },
  meta: AuditRecordMeta,
): TraceEvent {
  const detail = body.detail ?? {};

  return {
    eventKind: body.event_kind,
    timestamp: meta.timestamp,
    sessionUuid: meta.sessionUuid,
    teamUuid: meta.teamUuid,
    audience: (detail.audience as EventAudience) ?? "internal",
    layer: (detail.layer as TraceLayer) ?? "durable-audit",
    // Spread remaining detail fields (turnUuid, stepIndex, evidence extensions, etc.)
    ...omitKeys(detail, ["audience", "layer"]),
  } as TraceEvent;
}

/** Return a shallow copy of `obj` without the specified keys. */
function omitKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const omit = new Set(keys);
  for (const [k, v] of Object.entries(obj)) {
    if (!omit.has(k)) {
      result[k] = v;
    }
  }
  return result;
}
