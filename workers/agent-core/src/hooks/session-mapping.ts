/**
 * @nano-agent/hooks — session broadcast mapping.
 *
 * Maps hook events to `@haimang/nacp-session`'s `hook.broadcast` stream
 * event kind. The emitted body strictly conforms to
 * `SessionStreamEventBodySchema`:
 *
 *   { kind: "hook.broadcast",
 *     event_name: string,
 *     payload_redacted: unknown,
 *     aggregated_outcome?: unknown }
 *
 * Redaction is applied to the payload using the catalog's `redactionHints`
 * before it leaves this process.
 */

import type { HookEventName } from "./catalog.js";
import { HOOK_EVENT_CATALOG } from "./catalog.js";
import type { AggregatedHookOutcome } from "./outcome.js";

/** The `hook.broadcast` body shape (mirrors nacp-session). */
export interface HookBroadcastBody {
  readonly kind: "hook.broadcast";
  readonly event_name: string;
  readonly caller?: "pre-tool-use" | "step-emit";
  readonly payload_redacted: unknown;
  readonly aggregated_outcome?: unknown;
}

/**
 * Map a hook event emission to a `hook.broadcast` session stream event
 * body. Returns a body ready to be parsed by
 * `SessionStreamEventBodySchema`.
 *
 * Applies redaction from catalog `redactionHints` by replacing hinted
 * fields in the payload with `"[REDACTED]"`.
 */
export function hookEventToSessionBroadcast(
  eventName: HookEventName,
  payload: unknown,
  outcome: AggregatedHookOutcome,
  options?: { readonly caller?: "pre-tool-use" | "step-emit" },
): HookBroadcastBody {
  const meta = HOOK_EVENT_CATALOG[eventName];
  const redactedPayload = redactPayload(payload, meta.redactionHints);

  // Surface only the reducer outputs, not the per-handler HookOutcome[].
  const aggregated = {
    finalAction: outcome.finalAction,
    blocked: outcome.blocked,
    blockReason: outcome.blockReason,
    handlerCount: outcome.outcomes.length,
    mergedContext: outcome.mergedContext,
  };

  return {
    kind: "hook.broadcast",
    event_name: eventName,
    ...(options?.caller ? { caller: options.caller } : {}),
    payload_redacted: redactedPayload,
    aggregated_outcome: aggregated,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────

function redactPayload(
  payload: unknown,
  hints: readonly string[],
): unknown {
  if (hints.length === 0 || payload === null || payload === undefined || typeof payload !== "object") {
    return payload;
  }

  const obj = { ...(payload as Record<string, unknown>) };
  for (const hint of hints) {
    if (hint in obj) {
      obj[hint] = "[REDACTED]";
    }
  }
  return obj;
}
