import type { IngressAuthSnapshot } from "../auth.js";
import { readJson, type StreamFrame } from "../parity-bridge.js";
import {
  extractPhase,
  isAuthSnapshot,
  jsonResponse,
  sessionKey,
  sessionTerminalResponse,
  terminalKey,
  type CancelBody,
  type FollowupBody,
  type SessionEntry,
  type SessionTerminalRecord,
  type StartSessionBody,
  type VerifyBody,
} from "../session-lifecycle.js";
import {
  MAX_RECENT_FRAMES,
  recentFramesKey,
  type RecentFramesState,
} from "../session-read-model.js";
import type {
  D1SessionTruthRepository,
  DurableSessionPointer,
  DurableTurnPointer,
} from "../session-truth.js";

type RpcAck = { response: Response; body: Record<string, unknown> | null };

export interface UserDoSessionFlowContext {
  sessionTruth(): D1SessionTruthRepository | null;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  userAuthSnapshotKey: string;
  readDurableSnapshot(sessionUuid: string): Promise<{
    conversation_uuid: string;
    session_status: SessionEntry["status"];
    last_phase: string | null;
    last_event_seq: number;
    ended_at: string | null;
    started_at: string;
  } | null>;
  readDurableTimeline(sessionUuid: string): Promise<Record<string, unknown>[]>;
  readDurableHistory(
    sessionUuid: string,
  ): Promise<
    Array<{
      message_uuid: string;
      turn_uuid: string | null;
      kind: string;
      body: unknown;
      created_at: string;
    }>
  >;
  rememberCache(name: string, value: Record<string, unknown> | null): Promise<void>;
  updateConversationIndex(
    pointer: DurableSessionPointer | null,
    entry: SessionEntry,
  ): Promise<void>;
  updateActivePointers(
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
  ): Promise<void>;
  refreshUserState(
    authSnapshot?: IngressAuthSnapshot,
    seed?: unknown,
  ): Promise<void>;
  ensureDurableSession(
    sessionUuid: string,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    timestamp: string,
  ): Promise<DurableSessionPointer | null>;
  createDurableTurn(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    kind: "start" | "followup" | "cancel",
    inputText: string | null,
    timestamp: string,
  ): Promise<DurableTurnPointer | null>;
  recordUserMessage(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    kind: "user.input" | "user.cancel" | "user.input.text" | "user.input.multipart",
    payload: Record<string, unknown>,
    timestamp: string,
  ): Promise<void>;
  recordContextSnapshot(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    payload: unknown,
    timestamp: string,
  ): Promise<void>;
  appendDurableActivity(input: {
    readonly pointer: DurableSessionPointer | null;
    readonly authSnapshot: IngressAuthSnapshot;
    readonly traceUuid: string;
    readonly turnUuid?: string | null;
    readonly eventKind: string;
    readonly severity: "info" | "warn" | "error";
    readonly payload: Record<string, unknown>;
    readonly timestamp: string;
  }): Promise<void>;
  recordStreamFrames(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    frames: readonly StreamFrame[],
    timestamp: string,
  ): Promise<void>;
  forwardStart(sessionUuid: string, body: Record<string, unknown>): Promise<RpcAck>;
  forwardStatus(sessionUuid: string): Promise<Response>;
  forwardInternalJsonShadow(
    sessionUuid: string,
    action: "input" | "cancel" | "verify" | "timeline",
    body: Record<string, unknown> | undefined,
    rpcMethod: "input" | "cancel" | "verify" | "timeline",
  ): Promise<RpcAck>;
  readInternalStream(
    sessionUuid: string,
  ): Promise<{ ok: true; frames: StreamFrame[] } | { ok: false; response: Response }>;
  requireSession(sessionUuid: string): Promise<SessionEntry | null>;
  requireReadableSession(sessionUuid: string): Promise<SessionEntry | null>;
  sessionGateMiss(sessionUuid: string): Promise<Response>;
  getTerminal(sessionUuid: string): Promise<SessionTerminalRecord | null>;
  enforceSessionDevice(
    sessionUuid: string,
    entry: SessionEntry,
    authSnapshot: IngressAuthSnapshot | null | undefined,
  ): Promise<SessionEntry | Response>;
  notifyTerminal(sessionUuid: string, terminal: SessionTerminalRecord): Promise<void>;
  rememberEndedSession(sessionUuid: string, endedAt: string): Promise<void>;
  cleanupEndedSessions(now?: number): Promise<void>;
  proxyReadResponse(
    sessionUuid: string,
    entry: SessionEntry,
    response: Response,
  ): Promise<Response>;
  cloneJsonResponse(
    status: number,
    body: Record<string, unknown> | null,
    contentType?: string,
  ): Response;
  touchSession(sessionUuid: string, status: SessionEntry["status"]): Promise<void>;
  forwardFramesToAttachment(
    sessionUuid: string,
    entry: SessionEntry,
    frames: readonly StreamFrame[],
  ): Promise<SessionEntry>;
  handleMessages(sessionUuid: string, body: Record<string, unknown>): Promise<Response>;
  attachments: Map<string, unknown>;
}

export function createUserDoSessionFlow(ctx: UserDoSessionFlowContext) {
  return {
    async hydrateSessionFromDurableTruth(sessionUuid: string): Promise<SessionEntry | null> {
      const durable = await ctx.readDurableSnapshot(sessionUuid);
      if (!durable) return null;
      if (durable.session_status === "pending" || durable.session_status === "expired") {
        return null;
      }
      const now = new Date().toISOString();
      const entry: SessionEntry = {
        created_at: durable.started_at,
        last_seen_at: now,
        status: durable.session_status,
        last_phase: durable.last_phase,
        relay_cursor: durable.last_event_seq,
        ended_at: durable.ended_at,
      };
      await ctx.put(sessionKey(sessionUuid), entry);
      await ctx.updateConversationIndex(
        {
          conversation_uuid: durable.conversation_uuid,
          session_uuid: sessionUuid,
          conversation_created: false,
        },
        entry,
      );
      const timeline = await ctx.readDurableTimeline(sessionUuid);
      if (timeline.length > 0) {
        const recentEvents = timeline.slice(-MAX_RECENT_FRAMES);
        const startSeq = Math.max(1, durable.last_event_seq - recentEvents.length + 1);
        await ctx.put(recentFramesKey(sessionUuid), {
          updated_at: now,
          frames: recentEvents.map((payload, index) => ({
            kind: "event",
            seq: startSeq + index,
            name: "session.stream.event",
            payload,
          })),
        } satisfies RecentFramesState);
      }
      return entry;
    },

    async requireReadableSession(sessionUuid: string): Promise<SessionEntry | null> {
      return (await ctx.requireSession(sessionUuid)) ?? this.hydrateSessionFromDurableTruth(sessionUuid);
    },

    async handleStart(sessionUuid: string, body: StartSessionBody): Promise<Response> {
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
        frames.find((frame): frame is Extract<StreamFrame, { kind: "event" }> => frame.kind === "event") ??
        null;
      const terminal =
        frames.find(
          (frame): frame is Extract<StreamFrame, { kind: "terminal" }> =>
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
        });
      }

      return jsonResponse(200, {
        ok: true,
        action: "start",
        session_uuid: sessionUuid,
        user_uuid: body.auth_snapshot.sub,
        last_phase: entry.last_phase,
        status: entry.status,
        relay_cursor: entry.relay_cursor,
        first_event: firstEvent?.payload ?? null,
        terminal: null,
        start_ack: startAck.body,
      });
    },

    async handleInput(sessionUuid: string, body: FollowupBody): Promise<Response> {
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
        _origin: "input",
      };
      return ctx.handleMessages(sessionUuid, messagesBody);
    },

    async handleCancel(sessionUuid: string, body: CancelBody): Promise<Response> {
      const entry = await ctx.requireSession(sessionUuid);
      if (!entry) return ctx.sessionGateMiss(sessionUuid);
      if (entry.status === "ended") {
        return sessionTerminalResponse(sessionUuid, await ctx.getTerminal(sessionUuid));
      }
      if (body.auth_snapshot) await ctx.refreshUserState(body.auth_snapshot, body.initial_context_seed);
      const authSnapshot =
        body.auth_snapshot ??
        (await ctx.get<IngressAuthSnapshot>(ctx.userAuthSnapshotKey));
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
    },

    async handleVerify(sessionUuid: string, body: VerifyBody): Promise<Response> {
      const entry = await ctx.requireSession(sessionUuid);
      if (!entry) return ctx.sessionGateMiss(sessionUuid);
      if (body.auth_snapshot) await ctx.refreshUserState(body.auth_snapshot, body.initial_context_seed);
      const authSnapshot = isAuthSnapshot(body.auth_snapshot)
        ? body.auth_snapshot
        : await ctx.get<IngressAuthSnapshot>(ctx.userAuthSnapshotKey);
      const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
      if (gatedEntry instanceof Response) return gatedEntry;
      const verifyAck = await ctx.forwardInternalJsonShadow(
        sessionUuid,
        "verify",
        body as unknown as Record<string, unknown>,
        "verify",
      );
      const response = verifyAck.response;
      const proxied = await ctx.proxyReadResponse(sessionUuid, gatedEntry, response);
      const durableTruth = await ctx.readDurableSnapshot(sessionUuid);
      const bodyJson = await readJson(proxied.clone());
      const nextBody = !durableTruth
        ? bodyJson
        : {
            ...(bodyJson ?? {}),
            durable_truth: durableTruth,
          };
      await ctx.rememberCache(`verify:${sessionUuid}`, nextBody ?? null);
      return ctx.cloneJsonResponse(proxied.status, nextBody ?? null);
    },

    async handleRead(
      sessionUuid: string,
      action: "status" | "timeline" | "history",
    ): Promise<Response> {
      const entry = await this.requireReadableSession(sessionUuid);
      if (!entry) return ctx.sessionGateMiss(sessionUuid);
      if (action === "history") {
        await ctx.touchSession(sessionUuid, entry.status);
        const messages = await ctx.readDurableHistory(sessionUuid);
        return jsonResponse(200, {
          ok: true,
          action: "history",
          session_uuid: sessionUuid,
          messages,
        });
      }
      if (action === "timeline") {
        const events = await ctx.readDurableTimeline(sessionUuid);
        if (events.length > 0) {
          await ctx.touchSession(sessionUuid, entry.status);
          return jsonResponse(200, {
            ok: true,
            action: "timeline",
            session_uuid: sessionUuid,
            events,
          });
        }
      }
      if (action === "status") {
        const durableTruth = await ctx.readDurableSnapshot(sessionUuid);
        const response = await ctx.forwardStatus(sessionUuid);
        const proxied = await ctx.proxyReadResponse(sessionUuid, entry, response);
        const bodyJson = await readJson(proxied.clone());
        const nextBody = !durableTruth
          ? bodyJson
          : {
              ...(bodyJson ?? {}),
              durable_truth: durableTruth,
            };
        await ctx.rememberCache(`status:${sessionUuid}`, nextBody ?? null);
        return ctx.cloneJsonResponse(proxied.status, nextBody ?? null);
      }
      const timelineAck = await ctx.forwardInternalJsonShadow(
        sessionUuid,
        "timeline",
        undefined,
        "timeline",
      );
      return ctx.proxyReadResponse(sessionUuid, entry, timelineAck.response);
    },
  };
}
