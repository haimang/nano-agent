import type { SessionStreamEventBody } from "../stream-event.js";

export function systemNotifyToStreamEvent(
  severity: "info" | "warning" | "error",
  message: string,
): SessionStreamEventBody {
  return { kind: "system.notify", severity, message };
}
