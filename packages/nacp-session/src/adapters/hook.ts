import type { SessionStreamEventBody } from "../stream-event.js";
import { redactPayload } from "../redaction.js";

export function hookBroadcastToStreamEvent(
  eventName: string,
  payload: Record<string, unknown>,
  aggregatedOutcome?: unknown,
  redactionHints?: string[],
): SessionStreamEventBody {
  const redacted = redactionHints ? redactPayload(payload, redactionHints) : payload;
  return { kind: "hook.broadcast", event_name: eventName, payload_redacted: redacted, aggregated_outcome: aggregatedOutcome };
}
