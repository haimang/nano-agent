import { jsonResponse, type FollowupBody } from "../../session-lifecycle.js";
import type { UserDoSessionFlowContext } from "./types.js";

export async function handleInput(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  body: FollowupBody,
): Promise<Response> {
  if (typeof body.text !== "string" || body.text.length === 0) {
    return jsonResponse(400, {
      error: "invalid-input-body",
      message: "input requires non-empty text",
    });
  }
  const messagesBody: Record<string, unknown> = {
    parts: [{ kind: "text", text: body.text }],
    ...(body.auth_snapshot ? { auth_snapshot: body.auth_snapshot } : {}),
    ...(body.initial_context_seed ? { initial_context_seed: body.initial_context_seed } : {}),
    ...(typeof body.trace_uuid === "string" ? { trace_uuid: body.trace_uuid } : {}),
    ...(body.context_ref !== undefined ? { context_ref: body.context_ref } : {}),
    ...(body.stream_seq !== undefined ? { stream_seq: body.stream_seq } : {}),
    ...(typeof body.model_id === "string" ? { model_id: body.model_id } : {}),
    ...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
    _origin: "input",
  };
  return ctx.handleMessages(sessionUuid, messagesBody);
}
