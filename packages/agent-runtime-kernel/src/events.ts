/**
 * Agent Runtime Kernel — Runtime Event & NACP Alignment
 *
 * Maps internal kernel RuntimeEvent types to the 9 nacp-session
 * stream event kinds used by pushEvent(). The produced body shape
 * MUST match `SessionStreamEventBodySchema` from
 * `@haimang/nacp-session/stream-event`:
 * fields are snake_case and use the NACP field names.
 *
 * Note on UUIDs: NACP requires `turn_uuid` and `request_uuid` to be
 * valid UUIDs. Callers are responsible for providing UUID-formatted
 * `turnId` / `requestId` values upstream — this module is a shape
 * transformer only and does not mint or validate UUIDs.
 */

import type { RuntimeEvent } from "./types.js";
import { RUNTIME_TO_STREAM_MAP } from "./session-stream-mapping.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Session Stream Kind
// ═══════════════════════════════════════════════════════════════════

export type SessionStreamKind =
  | "turn.begin"
  | "turn.end"
  | "llm.delta"
  | "tool.call.progress"
  | "tool.call.result"
  | "hook.broadcast"
  | "compact.notify"
  | "system.notify"
  | "session.update";

// ═══════════════════════════════════════════════════════════════════
// §2 — mapRuntimeEventToStreamKind
// ═══════════════════════════════════════════════════════════════════

/**
 * Maps a RuntimeEvent to the corresponding SessionStreamKind.
 * Returns null for events that have no client-visible stream kind.
 */
export function mapRuntimeEventToStreamKind(
  event: RuntimeEvent,
): SessionStreamKind | null {
  const mapped = RUNTIME_TO_STREAM_MAP[event.type];
  return mapped ?? null;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — buildStreamEventBody
// ═══════════════════════════════════════════════════════════════════

/**
 * Returns the body shape for `session.stream.event` consumption.
 * The shape conforms to `SessionStreamEventBodySchema` in
 * `@haimang/nacp-session` — snake_case field names and the exact
 * fields required by each variant.
 */
export function buildStreamEventBody(event: RuntimeEvent): unknown {
  switch (event.type) {
    case "turn.started":
      return {
        kind: "turn.begin",
        turn_uuid: event.turnId,
      };

    case "turn.completed": {
      const body: Record<string, unknown> = {
        kind: "turn.end",
        turn_uuid: event.turnId,
      };
      if (event.usage !== undefined) {
        body.usage = event.usage;
      }
      return body;
    }

    case "llm.delta":
      return {
        kind: "llm.delta",
        content_type: event.contentType,
        content: event.content,
        is_final: event.isFinal,
      };

    case "tool.call.progress": {
      const body: Record<string, unknown> = {
        kind: "tool.call.progress",
        tool_name: event.toolName,
        chunk: event.chunk,
        is_final: event.isFinal,
      };
      if (event.requestId) {
        body.request_uuid = event.requestId;
      }
      return body;
    }

    case "tool.call.result": {
      const body: Record<string, unknown> = {
        kind: "tool.call.result",
        tool_name: event.toolName,
        status: event.status,
      };
      if (event.requestId) {
        body.request_uuid = event.requestId;
      }
      if (event.output !== undefined) {
        body.output = event.output;
      }
      if (event.errorMessage !== undefined) {
        body.error_message = event.errorMessage;
      }
      return body;
    }

    case "hook.broadcast": {
      const body: Record<string, unknown> = {
        kind: "hook.broadcast",
        event_name: event.event,
        payload_redacted: event.payloadRedacted,
      };
      if (event.aggregatedOutcome !== undefined) {
        body.aggregated_outcome = event.aggregatedOutcome;
      }
      return body;
    }

    case "compact.notify": {
      const body: Record<string, unknown> = {
        kind: "compact.notify",
        status: event.status,
      };
      if (event.tokensBefore !== undefined) {
        body.tokens_before = event.tokensBefore;
      }
      if (event.tokensAfter !== undefined) {
        body.tokens_after = event.tokensAfter;
      }
      return body;
    }

    case "system.notify":
      return {
        kind: "system.notify",
        severity: event.severity,
        message: event.message,
      };

    case "session.update": {
      const body: Record<string, unknown> = {
        kind: "session.update",
        phase: event.phase,
      };
      if (event.partialOutput !== undefined) {
        body.partial_output = event.partialOutput;
      }
      return body;
    }

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}
