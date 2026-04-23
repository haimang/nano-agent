/**
 * @nano-agent/eval-observability — three-way event classification.
 *
 * Determines which TraceLayer an event belongs to, and whether it should be
 * persisted to durable storage. The classification sets are the canonical
 * source of truth for the v1 event taxonomy.
 */

import type { TraceLayer } from "./types.js";

// ── Classification sets ─────────────────────────────────────────────

/** Events that are live-only (ephemeral, never persisted). */
export const LIVE_ONLY_EVENTS: ReadonlySet<string> = new Set([
  "llm.delta",
  "tool.call.progress",
  "session.update",
  "system.notify",
]);

/**
 * Events that are persisted to the durable audit trail.
 *
 * Audit and transcript sets must remain disjoint. When an event needs a more
 * nuanced durable policy (for example replay visibility or summary-vs-full
 * fidelity), that detail belongs in `DurablePromotionRegistry`, not as a
 * second membership here.
 */
export const DURABLE_AUDIT_EVENTS: ReadonlySet<string> = new Set([
  "turn.begin",
  "turn.end",
  "hook.outcome",
  "hook.broadcast",
  "compact.start",
  "compact.end",
  "compact.notify",
  "session.start",
  "session.end",
  "api.request",
  "api.response",
  "api.error",
]);

/** Events that form the user-facing durable transcript. */
export const DURABLE_TRANSCRIPT_EVENTS: ReadonlySet<string> = new Set([
  "assistant.message",
  "user.message",
  "tool.call.request",
  "tool.call.result",
]);

// ── Classification helpers ──────────────────────────────────────────

/**
 * Classify an event kind into its canonical TraceLayer.
 *
 * Priority: durable-transcript > durable-audit > live.
 * Unknown event kinds default to "live" (safe fallback — no persistence).
 */
export function classifyEvent(eventKind: string): TraceLayer {
  if (DURABLE_TRANSCRIPT_EVENTS.has(eventKind)) return "durable-transcript";
  if (DURABLE_AUDIT_EVENTS.has(eventKind)) return "durable-audit";
  return "live";
}

/**
 * Returns true only for event kinds that should be written to durable storage
 * (either audit or transcript layer).
 */
export function shouldPersist(eventKind: string): boolean {
  return DURABLE_AUDIT_EVENTS.has(eventKind) || DURABLE_TRANSCRIPT_EVENTS.has(eventKind);
}
