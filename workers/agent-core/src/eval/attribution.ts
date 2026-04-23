/**
 * @nano-agent/eval-observability — evidence attribution helpers.
 *
 * Extracts structured attribution records from trace events for LLM
 * calls and tool calls. These records make it easy for eval pipelines
 * to correlate costs, latencies, cache behavior and output size with
 * specific events.
 *
 * The record intentionally keeps LLM and tool evidence on a single
 * shape: a downstream attribution consumer only has to understand
 * one record per event, while absent fields stay `undefined`.
 */

import type { TraceEvent } from "./trace-event.js";

/**
 * Structured attribution record for an LLM or tool trace event.
 *
 * Evidence fields are optional because a single record may originate
 * from either an LLM event (provider/gateway/attempt/cacheState/ttftMs)
 * or a tool event (toolName/resultSizeBytes). `eventKind` +
 * `totalDurationMs` are common.
 */
export interface AttributionRecord {
  readonly eventKind: string;
  readonly totalDurationMs?: number;

  // ── LLM evidence ────────────────────────────────────────────────
  readonly provider?: string;
  readonly gateway?: string;
  readonly attempt?: number;
  readonly cacheState?: string;
  readonly ttftMs?: number;

  // ── Tool evidence ───────────────────────────────────────────────
  readonly toolName?: string;
  readonly resultSizeBytes?: number;
}

/**
 * Build an attribution record from an LLM-related trace event.
 *
 * Returns null if the event does not carry any LLM evidence fields
 * (provider, gateway, attempt, cacheState, ttftMs).
 */
export function buildLlmAttribution(event: TraceEvent): AttributionRecord | null {
  if (
    event.provider === undefined &&
    event.gateway === undefined &&
    event.attempt === undefined &&
    event.cacheState === undefined &&
    event.ttftMs === undefined
  ) {
    return null;
  }

  return {
    eventKind: event.eventKind,
    provider: event.provider,
    gateway: event.gateway,
    attempt: event.attempt,
    cacheState: event.cacheState,
    ttftMs: event.ttftMs,
    totalDurationMs: event.durationMs,
  };
}

/**
 * Build an attribution record from a tool-call trace event.
 *
 * Returns null if the event does not carry a `toolName` field.
 * The resulting record surfaces both `toolName` and `resultSizeBytes`
 * so replay/cost/output-size analyses can work off a single evidence
 * shape without reaching back into the raw TraceEvent.
 */
export function buildToolAttribution(event: TraceEvent): AttributionRecord | null {
  if (event.toolName === undefined) {
    return null;
  }

  return {
    eventKind: event.eventKind,
    toolName: event.toolName,
    resultSizeBytes: event.resultSizeBytes,
    totalDurationMs: event.durationMs,
  };
}
