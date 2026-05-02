import {
  extractPhase,
  jsonResponse,
  normalizeReasoningOptions,
  parseModelOptions,
  sessionKey,
  type SessionEntry,
  type StartSessionBody,
} from "../../session-lifecycle.js";
import type { UserDoSessionFlowContext } from "./types.js";

export async function handleStart(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  body: StartSessionBody,
): Promise<Response> {
  const initialInput =
    typeof body.initial_input === "string" && body.initial_input.length > 0
      ? body.initial_input
      : typeof body.text === "string" && body.text.length > 0
        ? body.text
        : null;
  if (!initialInput) {
    return jsonResponse(400, {
      error: "invalid-start-body",
      message: "start requires initial_input / text",
    });
  }
  if (!body.auth_snapshot || typeof body.auth_snapshot.sub !== "string" || body.auth_snapshot.sub.length === 0) {
    return jsonResponse(400, {
      error: "invalid-auth-snapshot",
      message: "auth_snapshot.sub is required",
    });
  }
  const teamUuid = body.auth_snapshot.team_uuid ?? body.auth_snapshot.tenant_uuid;
  const repo = ctx.sessionTruth();
  const modelOptions = parseModelOptions(
    body as unknown as Record<string, unknown>,
  );
  if (!modelOptions.ok) return modelOptions.response;
  const requestedModel =
    modelOptions.model_id
      ? await ctx.resolveAllowedModel(body.auth_snapshot, modelOptions.model_id)
      : null;
  if (requestedModel instanceof Response) return requestedModel;
  const globalDefaultModel =
    !requestedModel &&
    repo &&
    typeof repo.readGlobalDefaultModelForTeam === "function" &&
    typeof teamUuid === "string" &&
    teamUuid.length > 0
      ? await repo.readGlobalDefaultModelForTeam(teamUuid)
      : null;
  const selectedModelId = requestedModel?.model.model_id ?? globalDefaultModel?.model_id ?? null;
  const selectedReasoning = normalizeReasoningOptions(
    modelOptions.reasoning ?? null,
    requestedModel?.model.supported_reasoning_levels ?? globalDefaultModel?.supported_reasoning_levels ?? [],
  );

  const existingEntry = await ctx.get<SessionEntry>(sessionKey(sessionUuid));
  if (existingEntry) {
    return jsonResponse(409, {
      error: "session-already-started",
      message: `session ${sessionUuid} already exists in state '${existingEntry.status}'; mint a new UUID via POST /me/sessions to run again`,
      session_uuid: sessionUuid,
      current_status: existingEntry.status,
      ...(existingEntry.last_phase ? { last_phase: existingEntry.last_phase } : {}),
    });
  }

  const durableStatus = await ctx.sessionTruth()?.readSessionStatus(sessionUuid);
  if (durableStatus === "expired") {
    return jsonResponse(409, {
      error: "session-expired",
      message: `session ${sessionUuid} expired (24h pending TTL); mint a new UUID via POST /me/sessions`,
      session_uuid: sessionUuid,
      current_status: "expired",
    });
  }
  if (durableStatus === "ended") {
    return jsonResponse(409, {
      error: "session-already-started",
      message: `session ${sessionUuid} already ended; mint a new UUID via POST /me/sessions`,
      session_uuid: sessionUuid,
      current_status: "ended",
    });
  }

  const traceUuid = typeof body.trace_uuid === "string" ? body.trace_uuid : crypto.randomUUID();
  const now = new Date().toISOString();
  const startingEntry: SessionEntry = {
    created_at: now,
    last_seen_at: now,
    status: "starting",
    last_phase: null,
    relay_cursor: -1,
    ended_at: null,
    device_uuid: body.auth_snapshot.device_uuid ?? null,
  };

  if (durableStatus === "pending") {
    const claimed = (await ctx.sessionTruth()?.claimPendingForStart(sessionUuid)) ?? true;
    if (!claimed) {
      return jsonResponse(409, {
        error: "session-already-started",
        message: `session ${sessionUuid} already claimed by a concurrent /start; mint a new UUID via POST /me/sessions`,
        session_uuid: sessionUuid,
        current_status: "starting",
      });
    }
  }

  await ctx.refreshUserState(body.auth_snapshot, body.initial_context_seed);
  await ctx.put(sessionKey(sessionUuid), startingEntry);
  const durablePointer = await ctx.ensureDurableSession(
    sessionUuid,
    body.auth_snapshot,
    traceUuid,
    now,
  );
  if (repo && typeof repo.updateSessionModelDefaults === "function" && requestedModel) {
    await repo.updateSessionModelDefaults({
      session_uuid: sessionUuid,
      default_model_id: requestedModel.model.model_id,
      default_reasoning_effort: selectedReasoning?.effort ?? null,
    });
  }
  if (durableStatus === "pending") {
    await ctx.sessionTruth()?.updateSessionState({
      session_uuid: sessionUuid,
      status: "starting",
      last_phase: null,
      touched_at: now,
    });
  }
  const durableTurn = await ctx.createDurableTurn(
    sessionUuid,
    durablePointer,
    body.auth_snapshot,
    traceUuid,
    "start",
    initialInput,
    now,
    selectedModelId
      ? {
          model_id: selectedModelId,
          reasoning_effort: selectedReasoning?.effort ?? null,
        }
      : null,
  );
  await ctx.recordUserMessage(
    sessionUuid,
    durablePointer,
    body.auth_snapshot,
    traceUuid,
    durableTurn,
    "user.input",
    { text: initialInput },
    now,
  );
  if (body.initial_context !== undefined) {
    await ctx.recordContextSnapshot(
      sessionUuid,
      durablePointer,
      durableTurn,
      body.auth_snapshot,
      traceUuid,
      body.initial_context,
      now,
    );
  }
  await ctx.appendDurableActivity({
    pointer: durablePointer,
    authSnapshot: body.auth_snapshot,
    traceUuid,
    turnUuid: durableTurn?.turn_uuid,
    eventKind: "session.start.request",
    severity: "info",
    payload: { initial_input: initialInput },
    timestamp: now,
  });

  const startAck = await ctx.forwardStart(sessionUuid, {
    initial_input: initialInput,
    ...(body.initial_context !== undefined ? { initial_context: body.initial_context } : {}),
    ...(typeof body.trace_uuid === "string" ? { trace_uuid: body.trace_uuid } : {}),
    ...(selectedModelId ? { model_id: selectedModelId } : {}),
    ...(selectedReasoning ? { reasoning: selectedReasoning } : {}),
    authority: body.auth_snapshot,
  });
  if (!startAck.response.ok) {
    await ctx.delete(sessionKey(sessionUuid));
    if (durablePointer) {
      await ctx.sessionTruth()?.rollbackSessionStart({
        session_uuid: sessionUuid,
        conversation_uuid: durablePointer.conversation_uuid,
        delete_conversation: durablePointer.conversation_created,
      });
    }
    await ctx.appendDurableActivity({
      pointer: durablePointer?.conversation_created ? null : durablePointer,
      authSnapshot: body.auth_snapshot,
      traceUuid,
      turnUuid: null,
      eventKind: "session.start.failed",
      severity: "error",
      payload: startAck.body ?? { error: "agent-start-failed" },
      timestamp: new Date().toISOString(),
    });
    return jsonResponse(startAck.response.status, {
      error: "agent-start-failed",
      message: "agent-core internal start failed",
      start_ack: startAck.body,
    });
  }

  const stream = await ctx.readInternalStream(sessionUuid);
  if (!stream.ok) return stream.response;
  const frames = stream.frames;
  let entry: SessionEntry = {
    ...startingEntry,
    last_seen_at: new Date().toISOString(),
    last_phase: extractPhase(startAck.body),
    status: ctx.attachments.has(sessionUuid) ? "active" : "detached",
  };
  await ctx.put(sessionKey(sessionUuid), entry);
  await ctx.sessionTruth()?.updateSessionState({
    session_uuid: sessionUuid,
    status: entry.status,
    last_phase: entry.last_phase,
    touched_at: entry.last_seen_at,
  });
  entry = await ctx.forwardFramesToAttachment(sessionUuid, entry, frames);
  await ctx.recordStreamFrames(
    sessionUuid,
    durablePointer,
    body.auth_snapshot,
    traceUuid,
    durableTurn,
    frames,
    entry.last_seen_at,
  );
  await ctx.updateConversationIndex(durablePointer, entry);
  await ctx.updateActivePointers(durablePointer, durableTurn);

  const firstEvent =
    frames.find((frame): frame is Extract<typeof frame, { kind: "event" }> => frame.kind === "event") ?? null;
  const terminal =
    frames.find(
      (frame): frame is Extract<typeof frame, { kind: "terminal" }> =>
        frame.kind === "terminal",
    ) ?? null;
  if (durableTurn) {
    await ctx.sessionTruth()?.closeTurn({
      turn_uuid: durableTurn.turn_uuid,
      status:
        terminal?.terminal === "cancelled"
          ? "cancelled"
          : terminal?.terminal === "error"
            ? "failed"
            : "completed",
      ended_at: new Date().toISOString(),
      effective_model_id: selectedModelId,
      effective_reasoning_effort: selectedReasoning?.effort ?? null,
      fallback_used: false,
      fallback_reason: null,
    });
  }

  // HPX5 F7 P5-03 — return `first_event_seq` so clients can use it as
  // `last_seen_seq` when attaching WS, eliminating the start→ws-attach
  // race window. `firstEvent.seq` is the first stream-event seq this
  // start cycle produced; if no event was produced yet, fall back to 0
  // so the client receives the very first frame on attach.
  const firstEventSeq =
    firstEvent && typeof (firstEvent as { seq?: unknown }).seq === "number"
      ? ((firstEvent as { seq: number }).seq)
      : 0;

  return jsonResponse(200, {
    ok: true,
    action: "start",
    session_uuid: sessionUuid,
    user_uuid: body.auth_snapshot.sub,
    last_phase: entry.last_phase,
    status: entry.status,
    relay_cursor: entry.relay_cursor,
    first_event: firstEvent?.payload ?? null,
    first_event_seq: firstEventSeq,
    terminal: null,
    start_ack: startAck.body,
  });
}
