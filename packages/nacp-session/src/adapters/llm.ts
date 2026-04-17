/**
 * LLM Adapter Seam — interface-only, no provider binding.
 *
 * The LLM wrapper (not yet built) will implement this to push
 * normalized deltas into session.stream.event.
 */
import type { SessionStreamEventBody } from "../stream-event.js";

export function llmDeltaToStreamEvent(
  contentType: "text" | "thinking" | "tool_use_start" | "tool_use_delta",
  content: string,
  isFinal = false,
): SessionStreamEventBody {
  return { kind: "llm.delta", content_type: contentType, content, is_final: isFinal };
}
