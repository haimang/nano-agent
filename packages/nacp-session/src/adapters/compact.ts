import type { SessionStreamEventBody } from "../stream-event.js";

export function compactNotifyToStreamEvent(
  status: "started" | "completed" | "failed",
  tokensBefore?: number,
  tokensAfter?: number,
): SessionStreamEventBody {
  return { kind: "compact.notify", status, tokens_before: tokensBefore, tokens_after: tokensAfter };
}
