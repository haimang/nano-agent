import type { SessionStreamEventBody } from "../stream-event.js";

export function toolProgressToStreamEvent(
  toolName: string,
  chunk: string,
  isFinal: boolean,
  requestUuid?: string,
): SessionStreamEventBody {
  return { kind: "tool.call.progress", tool_name: toolName, chunk, is_final: isFinal, request_uuid: requestUuid };
}

export function toolResultToStreamEvent(
  toolName: string,
  status: "ok" | "error",
  output?: string,
  errorMessage?: string,
  requestUuid?: string,
): SessionStreamEventBody {
  return { kind: "tool.call.result", tool_name: toolName, status, output, error_message: errorMessage, request_uuid: requestUuid };
}
