/**
 * Session Stream Adapter
 *
 * Maps `NormalizedLLMEvent`s to `@haimang/nacp-session`
 * `session.stream.event` bodies. The output shape strictly conforms to
 * `SessionStreamEventBodySchema` — the 9-kind discriminated union is the
 * single source of truth for client-visible live stream events.
 *
 * Notes on kind selection:
 *   - `delta` → `llm.delta` with `content_type: "text"` and `is_final: false`.
 *   - `tool_call` (a full id+name+arguments frame from the adapter) is
 *     expressed as an `llm.delta` with `content_type: "tool_use_start"`
 *     and the arguments go back through subsequent `tool_use_delta`
 *     chunks. The old invented `llm.tool_call` kind is removed because
 *     it was not in the `SessionStreamEventBodySchema` catalog.
 *   - `finish` returns `null` — the kernel owns the `turn.end` event.
 *   - `error` → `system.notify` with `severity: "error"` (the schema
 *     uses `severity`, not `level`).
 */

import type { NormalizedLLMEvent } from "./canonical.js";

/**
 * Minimal body shape exposed by the adapter. The `kind` field matches
 * one of the 9 canonical `session.stream.event` kinds; the `body` field
 * is the full discriminated-union body (including `kind`) so consumers
 * can pass it straight to `SessionStreamEventBodySchema.parse()`.
 */
export interface SessionEventBody {
  readonly kind: SessionEventKind;
  readonly body: Record<string, unknown>;
}

/** The 9 canonical `session.stream.event` kinds, mirrored locally. */
export type SessionEventKind =
  | "tool.call.progress"
  | "tool.call.result"
  | "hook.broadcast"
  | "session.update"
  | "turn.begin"
  | "turn.end"
  | "compact.notify"
  | "system.notify"
  | "llm.delta";

/**
 * Map a `NormalizedLLMEvent` to a nacp-session stream event body.
 *
 * Returns `null` for events that the kernel handles (e.g. `finish →
 * turn.end`). `body` always contains a `kind` field so callers can
 * forward it directly to `SessionStreamEventBodySchema.parse()`.
 */
export function mapLlmEventToSessionBody(event: NormalizedLLMEvent): SessionEventBody | null {
  switch (event.type) {
    case "llm.request.started":
      // Lifecycle anchor for observability — the kernel decides whether
      // to surface it client-side via `session.update`, so the adapter
      // itself returns null and leaves that choice to the caller.
      return null;

    case "delta": {
      const body = {
        kind: "llm.delta" as const,
        content_type: "text" as const,
        content: event.content,
        is_final: false,
      };
      return { kind: "llm.delta", body };
    }

    case "tool_call": {
      // Express a tool-use kick-off as an `llm.delta` with the
      // `tool_use_start` content_type. The tool call name goes on
      // `content` (`SessionStreamEventBodySchema` requires `content`
      // to be a string), so we encode the minimum identification
      // the client needs without inventing a new kind.
      const body = {
        kind: "llm.delta" as const,
        content_type: "tool_use_start" as const,
        content: JSON.stringify({ id: event.id, name: event.name, arguments: event.arguments }),
        is_final: false,
      };
      return { kind: "llm.delta", body };
    }

    case "finish":
      // Turn lifecycle is the kernel's responsibility.
      return null;

    case "error": {
      const body = {
        kind: "system.notify" as const,
        severity: "error" as const,
        message: `[${event.error.category}] ${event.error.message}${
          event.error.retryable ? " (retryable)" : ""
        }`,
      };
      return { kind: "system.notify", body };
    }
  }
}
