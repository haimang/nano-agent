import type { SessionStreamEventBody } from "../stream-event.js";
import { redactPayload } from "../redaction.js";

export type HookBroadcastCaller = "pre-tool-use" | "step-emit";

export function hookBroadcastToStreamEvent(
  eventName: string,
  payload: Record<string, unknown>,
  aggregatedOutcome?: unknown,
  redactionHints?: string[],
  options?: { readonly caller?: HookBroadcastCaller },
): SessionStreamEventBody {
  const redacted = redactionHints ? redactPayload(payload, redactionHints) : payload;
  return {
    kind: "hook.broadcast",
    event_name: eventName,
    ...(options?.caller ? { caller: options.caller } : {}),
    payload_redacted: redacted,
    aggregated_outcome: aggregatedOutcome,
  };
}
