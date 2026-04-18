/**
 * @nano-agent/eval-observability — TraceEvent schema.
 *
 * Defines the base trace-event shape and extension slots for LLM evidence,
 * tool evidence, and storage evidence. The full TraceEvent is the intersection
 * of the base with partial extensions, allowing a single event to carry
 * evidence from multiple subsystems.
 *
 * Phase 2 trace law (A3 / AX-QNA Q6): every event produced by accepted
 * internal work MUST carry a canonical `traceUuid`. Source identity
 * (`sourceRole` + optional `sourceKey` / `messageUuid`) lets downstream
 * consumers reason about who produced the event without guessing from
 * `sessionUuid` / `turnUuid` alone. These are first-class fields — not
 * evidence extensions — because recovery and replay depend on them.
 */

import type { EventAudience, TraceLayer, TraceSourceRole } from "./types.js";

/**
 * Base fields present on every trace event.
 *
 * Invariants (A3 Phase 1 trace law):
 *  - `traceUuid` is required. An event without a trace id is not an event
 *    produced by accepted internal work; the only exception is a
 *    platform-level alert (see `packages/nacp-core/src/observability/envelope.ts`).
 *  - `sourceRole` is required so recovery / attribution can answer
 *    "who produced this?" without scanning the kernel history.
 *  - `sourceKey` mirrors `NacpHeader.producer_key`; when present it MUST
 *    follow the `namespace.sub@vN` convention.
 *  - `messageUuid` captures the originating NACP envelope when the trace
 *    event is produced in response to a concrete message.
 */
export interface TraceEventBase {
  readonly eventKind: string;
  readonly timestamp: string;
  readonly traceUuid: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly sourceRole: TraceSourceRole;
  readonly sourceKey?: string;
  readonly messageUuid?: string;
  readonly turnUuid?: string;
  readonly stepIndex?: number;
  readonly durationMs?: number;
  readonly audience: EventAudience;
  readonly layer: TraceLayer;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

/** Extension slot for LLM / API call evidence. */
export interface LlmEvidenceExtension {
  readonly usageTokens?: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
  };
  readonly ttftMs?: number;
  readonly attempt?: number;
  readonly provider?: string;
  readonly gateway?: string;
  readonly cacheState?: string;
  readonly cacheBreakReason?: string;
  readonly model?: string;
}

/** Extension slot for tool-call evidence. */
export interface ToolEvidenceExtension {
  readonly toolName?: string;
  readonly resultSizeBytes?: number;
  readonly durationMs?: number;
}

/** Extension slot for storage-operation evidence. */
export interface StorageEvidenceExtension {
  readonly storageLayer?: string;
  readonly key?: string;
  readonly op?: string;
  readonly sizeBytes?: number;
}

/**
 * A fully-resolved trace event.
 *
 * Combines the base with partial evidence extensions so that a single event
 * can carry data from the LLM subsystem, a tool call, and/or a storage op.
 */
export type TraceEvent =
  & TraceEventBase
  & Partial<LlmEvidenceExtension>
  & Partial<ToolEvidenceExtension>
  & Partial<StorageEvidenceExtension>;

// ─────────────────────────────────────────────────────────────────────
// Trace law validator
// ─────────────────────────────────────────────────────────────────────

/**
 * Reason codes returned by {@link validateTraceEvent}. Each maps 1:1 to a
 * row in the A3 Phase 1 trace-law matrix and is the same taxonomy surfaced
 * by the anchor / recovery helper in Phase 3.
 */
export type TraceLawReason =
  | "missing-trace-uuid"
  | "invalid-trace-uuid"
  | "missing-session-uuid"
  | "missing-team-uuid"
  | "missing-source-role"
  | "missing-event-kind"
  | "missing-timestamp";

export interface TraceLawViolation {
  readonly reason: TraceLawReason;
  readonly message: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Return every trace-law violation for an event. An empty array means the
 * event is admissible under A3 Phase 1 trace law.
 */
export function validateTraceEvent(event: TraceEvent): TraceLawViolation[] {
  const out: TraceLawViolation[] = [];
  if (!event.traceUuid) {
    out.push({
      reason: "missing-trace-uuid",
      message: "trace law: accepted internal work must carry traceUuid",
    });
  } else if (!UUID_RE.test(event.traceUuid)) {
    out.push({
      reason: "invalid-trace-uuid",
      message: `trace law: traceUuid '${event.traceUuid}' is not a valid UUID`,
    });
  }
  if (!event.sessionUuid) {
    out.push({
      reason: "missing-session-uuid",
      message: "trace law: every event must carry sessionUuid",
    });
  }
  if (!event.teamUuid) {
    out.push({
      reason: "missing-team-uuid",
      message: "trace law: every event must carry teamUuid",
    });
  }
  if (!event.sourceRole) {
    out.push({
      reason: "missing-source-role",
      message: "trace law: every event must declare a sourceRole",
    });
  }
  if (!event.eventKind) {
    out.push({
      reason: "missing-event-kind",
      message: "trace law: eventKind is required",
    });
  }
  if (!event.timestamp) {
    out.push({
      reason: "missing-timestamp",
      message: "trace law: timestamp is required",
    });
  }
  return out;
}

/** Convenience predicate for `validateTraceEvent(...).length === 0`. */
export function isTraceLawCompliant(event: TraceEvent): boolean {
  return validateTraceEvent(event).length === 0;
}

/**
 * Assert trace-law compliance or throw with the concatenated violation
 * messages. Intended for "accepted internal work" boundaries where silent
 * continuation is not allowed (A3 §7.2).
 */
export function assertTraceLaw(event: TraceEvent): void {
  const violations = validateTraceEvent(event);
  if (violations.length > 0) {
    throw new Error(
      `trace-law violation: ${violations.map((v) => v.message).join("; ")}`,
    );
  }
}
