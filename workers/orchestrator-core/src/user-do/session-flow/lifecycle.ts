import {
  extractPhase,
  jsonResponse,
  sessionKey,
  sessionTerminalResponse,
  terminalKey,
  type CancelBody,
  type CloseBody,
  type DeleteSessionBody,
  type SessionEntry,
  type SessionTerminalRecord,
  type TitlePatchBody,
} from "../../session-lifecycle.js";
import type { UserDoSessionFlowContext } from "./types.js";
import {
  buildConversationPointer,
  maybeRefreshUserState,
  readPersistedAuthSnapshot,
} from "./shared.js";
import { requireReadableSession } from "./hydrate.js";

export async function handleCancel(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  body: CancelBody,
): Promise<Response> {
  const entry = await ctx.requireSession(sessionUuid);
  if (!entry) return ctx.sessionGateMiss(sessionUuid);
  if (entry.status === "ended") {
    return sessionTerminalResponse(sessionUuid, await ctx.getTerminal(sessionUuid));
  }
  await maybeRefreshUserState(ctx, body);
  const authSnapshot =
    body.auth_snapshot ??
    (await ctx.get(ctx.userAuthSnapshotKey));
  if (!authSnapshot) {
    return jsonResponse(400, {
      error: "missing-authority",
      message: "cancel requires persisted auth snapshot",
    });
  }
  const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
  if (gatedEntry instanceof Response) return gatedEntry;
  const traceUuid = typeof body.trace_uuid === "string" ? body.trace_uuid : crypto.randomUUID();
  const now = new Date().toISOString();
  const durablePointer = await ctx.ensureDurableSession(sessionUuid, authSnapshot, traceUuid, now);
  const durableTurn = await ctx.createDurableTurn(
    sessionUuid,
    durablePointer,
    authSnapshot,
    traceUuid,
    "cancel",
    typeof body.reason === "string" ? body.reason : null,
    now,
  );
  await ctx.recordUserMessage(
    sessionUuid,
    durablePointer,
    authSnapshot,
    traceUuid,
    durableTurn,
    "user.cancel",
    typeof body.reason === "string" ? { reason: body.reason } : { reason: "cancel" },
    now,
  );
  const cancelAck = await ctx.forwardInternalJsonShadow(
    sessionUuid,
    "cancel",
    {
      ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
      ...(typeof body.trace_uuid === "string" ? { trace_uuid: body.trace_uuid } : {}),
      ...(body.auth_snapshot ? { authority: body.auth_snapshot } : {}),
    },
    "cancel",
  );
  if (!cancelAck.response.ok) {
    return ctx.cloneJsonResponse(cancelAck.response.status, cancelAck.body);
  }

  const terminal: SessionTerminalRecord = {
    terminal: "cancelled",
    last_phase: extractPhase(cancelAck.body) ?? gatedEntry.last_phase,
    ended_at: now,
  };
  const nextEntry: SessionEntry = {
    ...gatedEntry,
    last_seen_at: now,
    status: "ended",
    last_phase: terminal.last_phase,
    ended_at: now,
  };

  await ctx.put(sessionKey(sessionUuid), nextEntry);
  await ctx.put(terminalKey(sessionUuid), terminal);
  await ctx.sessionTruth()?.updateSessionState({
    session_uuid: sessionUuid,
    status: "ended",
    last_phase: terminal.last_phase,
    touched_at: now,
    ended_at: now,
  });
  if (durableTurn) {
    await ctx.sessionTruth()?.closeTurn({
      turn_uuid: durableTurn.turn_uuid,
      status: "cancelled",
      ended_at: now,
    });
  }
  await ctx.appendDurableActivity({
    pointer: durablePointer,
    authSnapshot,
    traceUuid,
    turnUuid: durableTurn?.turn_uuid,
    eventKind: "session.cancelled",
    severity: "info",
    payload: cancelAck.body ?? { reason: body.reason ?? "cancel" },
    timestamp: now,
  });
  await ctx.rememberEndedSession(sessionUuid, now);
  await ctx.cleanupEndedSessions();
  await ctx.notifyTerminal(sessionUuid, terminal);
  await ctx.updateConversationIndex(durablePointer, nextEntry);
  await ctx.updateActivePointers(durablePointer, null);

  return jsonResponse(cancelAck.response.status, {
    ...(cancelAck.body ?? { ok: true, action: "cancel" }),
    session_uuid: sessionUuid,
    session_status: nextEntry.status,
    terminal: terminal.terminal,
  });
}

export async function handleClose(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  body: CloseBody,
): Promise<Response> {
  const entry = await requireReadableSession(ctx, sessionUuid);
  if (!entry) return ctx.sessionGateMiss(sessionUuid);
  await maybeRefreshUserState(ctx, body);
  const authSnapshot = await readPersistedAuthSnapshot(ctx, body);
  if (!authSnapshot) {
    return jsonResponse(400, {
      error: "missing-authority",
      message: "close requires persisted auth snapshot",
    });
  }
  const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
  if (gatedEntry instanceof Response) return gatedEntry;
  const durable = await ctx.sessionTruth()?.readSessionLifecycle(sessionUuid);
  if (!durable) return ctx.sessionGateMiss(sessionUuid);
  if (durable.deleted_at) {
    return jsonResponse(409, {
      error: "conversation_deleted",
      message: "cannot close a deleted conversation",
      session_uuid: sessionUuid,
      conversation_uuid: durable.conversation_uuid,
    });
  }
  if (gatedEntry.status === "ended") {
    return jsonResponse(200, {
      ok: true,
      action: "close",
      session_uuid: sessionUuid,
      conversation_uuid: durable.conversation_uuid,
      session_status: "ended",
      terminal: "completed",
      ended_reason: durable.ended_reason ?? "closed_by_user",
      already_closed: true,
    });
  }
  const now = new Date().toISOString();
  const traceUuid = typeof body.trace_uuid === "string" ? body.trace_uuid : crypto.randomUUID();
  const pointer = buildConversationPointer(durable.conversation_uuid, sessionUuid);
  const terminal: SessionTerminalRecord = {
    terminal: "completed",
    last_phase: gatedEntry.last_phase,
    ended_at: now,
  };
  const nextEntry: SessionEntry = {
    ...gatedEntry,
    last_seen_at: now,
    status: "ended",
    ended_at: now,
  };
  await ctx.put(sessionKey(sessionUuid), nextEntry);
  await ctx.put(terminalKey(sessionUuid), terminal);
  await ctx.sessionTruth()?.updateSessionState({
    session_uuid: sessionUuid,
    status: "ended",
    last_phase: terminal.last_phase,
    touched_at: now,
    ended_at: now,
    ended_reason: "closed_by_user",
  });
  await ctx.appendDurableActivity({
    pointer,
    authSnapshot,
    traceUuid,
    eventKind: "session.closed",
    severity: "info",
    payload: {
      reason: typeof body.reason === "string" && body.reason.length > 0
        ? body.reason
        : "closed_by_user",
    },
    timestamp: now,
  });
  await ctx.rememberEndedSession(sessionUuid, now);
  await ctx.cleanupEndedSessions();
  await ctx.notifyTerminal(sessionUuid, terminal);
  await ctx.updateConversationIndex(pointer, nextEntry);
  await ctx.updateActivePointers(pointer, null);
  return jsonResponse(200, {
    ok: true,
    action: "close",
    session_uuid: sessionUuid,
    conversation_uuid: durable.conversation_uuid,
    session_status: "ended",
    terminal: terminal.terminal,
    ended_reason: "closed_by_user",
    ended_at: now,
  });
}

export async function handleDelete(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  body: DeleteSessionBody,
): Promise<Response> {
  const entry = await requireReadableSession(ctx, sessionUuid);
  if (!entry) return ctx.sessionGateMiss(sessionUuid);
  await maybeRefreshUserState(ctx, body);
  const authSnapshot = await readPersistedAuthSnapshot(ctx, body);
  if (!authSnapshot) {
    return jsonResponse(400, {
      error: "missing-authority",
      message: "delete requires persisted auth snapshot",
    });
  }
  const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
  if (gatedEntry instanceof Response) return gatedEntry;
  const durable = await ctx.sessionTruth()?.readSessionLifecycle(sessionUuid);
  if (!durable) return ctx.sessionGateMiss(sessionUuid);
  if (durable.deleted_at) {
    return jsonResponse(200, {
      ok: true,
      action: "delete",
      session_uuid: sessionUuid,
      conversation_uuid: durable.conversation_uuid,
      deleted_at: durable.deleted_at,
      already_deleted: true,
    });
  }
  const now = new Date().toISOString();
  const traceUuid = typeof body.trace_uuid === "string" ? body.trace_uuid : crypto.randomUUID();
  const pointer = buildConversationPointer(durable.conversation_uuid, sessionUuid);
  let nextEntry = gatedEntry;
  if (gatedEntry.status !== "ended") {
    const terminal: SessionTerminalRecord = {
      terminal: "completed",
      last_phase: gatedEntry.last_phase,
      ended_at: now,
    };
    nextEntry = {
      ...gatedEntry,
      last_seen_at: now,
      status: "ended",
      ended_at: now,
    };
    await ctx.put(sessionKey(sessionUuid), nextEntry);
    await ctx.put(terminalKey(sessionUuid), terminal);
    await ctx.sessionTruth()?.updateSessionState({
      session_uuid: sessionUuid,
      status: "ended",
      last_phase: terminal.last_phase,
      touched_at: now,
      ended_at: now,
      ended_reason: "closed_by_user",
    });
    await ctx.rememberEndedSession(sessionUuid, now);
    await ctx.cleanupEndedSessions();
    await ctx.notifyTerminal(sessionUuid, terminal);
    await ctx.updateConversationIndex(pointer, nextEntry);
    await ctx.updateActivePointers(pointer, null);
  }
  await ctx.sessionTruth()?.tombstoneConversation({
    session_uuid: sessionUuid,
    deleted_at: now,
    touched_at: now,
  });
  await ctx.appendDurableActivity({
    pointer,
    authSnapshot,
    traceUuid,
    eventKind: "conversation.deleted",
    severity: "info",
    payload: {
      deleted_at: now,
      session_status: nextEntry.status,
    },
    timestamp: now,
  });
  return jsonResponse(200, {
    ok: true,
    action: "delete",
    session_uuid: sessionUuid,
    conversation_uuid: durable.conversation_uuid,
    session_status: nextEntry.status,
    deleted_at: now,
  });
}

export async function handleTitle(
  ctx: UserDoSessionFlowContext,
  sessionUuid: string,
  body: TitlePatchBody,
): Promise<Response> {
  const title =
    typeof body.title === "string"
      ? body.title.trim()
      : "";
  if (title.length === 0 || title.length > 200) {
    return jsonResponse(400, {
      error: "invalid-input",
      message: "title must be a non-empty string up to 200 characters",
    });
  }
  const entry = await requireReadableSession(ctx, sessionUuid);
  if (!entry) return ctx.sessionGateMiss(sessionUuid);
  await maybeRefreshUserState(ctx, body);
  const authSnapshot = await readPersistedAuthSnapshot(ctx, body);
  if (!authSnapshot) {
    return jsonResponse(400, {
      error: "missing-authority",
      message: "title requires persisted auth snapshot",
    });
  }
  const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
  if (gatedEntry instanceof Response) return gatedEntry;
  const durable = await ctx.sessionTruth()?.readSessionLifecycle(sessionUuid);
  if (!durable) return ctx.sessionGateMiss(sessionUuid);
  if (durable.deleted_at) {
    return jsonResponse(409, {
      error: "conversation_deleted",
      message: "cannot retitle a deleted conversation",
      session_uuid: sessionUuid,
      conversation_uuid: durable.conversation_uuid,
    });
  }
  const now = new Date().toISOString();
  const traceUuid = typeof body.trace_uuid === "string" ? body.trace_uuid : crypto.randomUUID();
  const updated = await ctx.sessionTruth()?.updateConversationTitle({
    session_uuid: sessionUuid,
    title,
    touched_at: now,
  });
  if (!updated) return ctx.sessionGateMiss(sessionUuid);
  await ctx.appendDurableActivity({
    pointer: buildConversationPointer(updated.conversation_uuid, sessionUuid),
    authSnapshot,
    traceUuid,
    eventKind: "conversation.title.updated",
    severity: "info",
    payload: { title },
    timestamp: now,
  });
  return jsonResponse(200, {
    ok: true,
    action: "title",
    session_uuid: sessionUuid,
    conversation_uuid: updated.conversation_uuid,
    title,
  });
}
