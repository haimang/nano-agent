/**
 * @nano-agent/hooks — audit record building.
 *
 * Produces `audit.record` bodies that conform to `@nano-agent/nacp-core`'s
 * `AuditRecordBodySchema`:
 *
 *   { event_kind: string, ref?: NacpRef, detail?: Record<string, unknown> }
 *
 * The detail surfaces the minimum evidence needed to reconstruct the hook
 * dispatch for replay / eval-observability, without leaking sensitive
 * payload fields (which the session mapper has already redacted).
 */

import type { HookEventName } from "./catalog.js";
import type { AggregatedHookOutcome } from "./outcome.js";

/** Shape of a `NacpRef` (mirrored from nacp-core). */
export interface NacpRefLike {
  readonly kind: string;
  readonly [key: string]: unknown;
}

/** The `audit.record` body shape (mirrors nacp-core). */
export interface AuditRecordBody {
  readonly event_kind: string;
  readonly ref?: NacpRefLike;
  readonly detail?: Record<string, unknown>;
}

/**
 * Internal intermediate shape used by callers that want the per-dispatch
 * lifecycle fields (event name, handler count, duration) in one record.
 */
export interface HookAuditEntry {
  readonly eventName: string;
  readonly handlerCount: number;
  readonly blockedBy?: string;
  readonly totalDurationMs: number;
  readonly timestamp: string;
}

/**
 * Build an `audit.record`-compatible body from a hook dispatch lifecycle.
 *
 * `event_kind` is always `"hook.outcome"` (the canonical kind used by
 * eval-observability's durable-audit set). The per-hook event name goes
 * into `detail.hookEvent` so a single trace stream can carry all 8 hook
 * events without inventing 8 audit kinds.
 */
export function buildHookAuditRecord(
  eventName: HookEventName,
  outcome: AggregatedHookOutcome,
  durationMs: number,
  options?: { ref?: NacpRefLike; timestamp?: string },
): AuditRecordBody {
  const blockedBy = outcome.blocked
    ? outcome.outcomes.find((o) => o.action === "block" || o.action === "stop")?.handlerId
    : undefined;

  const detail: Record<string, unknown> = {
    hookEvent: eventName,
    handlerCount: outcome.outcomes.length,
    totalDurationMs: durationMs,
    timestamp: options?.timestamp ?? new Date().toISOString(),
    finalAction: outcome.finalAction,
    blocked: outcome.blocked,
  };

  if (blockedBy !== undefined) {
    detail.blockedBy = blockedBy;
  }
  if (outcome.blockReason !== undefined) {
    detail.blockReason = outcome.blockReason;
  }
  if (outcome.mergedDiagnostics !== undefined) {
    detail.diagnostics = outcome.mergedDiagnostics;
  }

  const body: AuditRecordBody = options?.ref
    ? { event_kind: "hook.outcome", ref: options.ref, detail }
    : { event_kind: "hook.outcome", detail };

  return body;
}

/**
 * Convenience wrapper: derive a lifecycle-friendly `HookAuditEntry` from
 * the same inputs, for callers that want the old flat shape.
 */
export function buildHookAuditEntry(
  eventName: HookEventName,
  outcome: AggregatedHookOutcome,
  durationMs: number,
): HookAuditEntry {
  const blockedBy = outcome.blocked
    ? outcome.outcomes.find((o) => o.action === "block" || o.action === "stop")?.handlerId
    : undefined;

  return {
    eventName,
    handlerCount: outcome.outcomes.length,
    blockedBy,
    totalDurationMs: durationMs,
    timestamp: new Date().toISOString(),
  };
}
