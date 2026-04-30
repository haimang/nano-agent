import type { InitialContextSeed, IngressAuthSnapshot } from "../auth.js";
import type { StreamFrame } from "../parity-bridge.js";
import {
  extractPhase,
  isAuthSnapshot,
  jsonResponse,
  parseModelOptions,
  sessionKey,
  sessionTerminalResponse,
  type SessionEntry,
} from "../session-lifecycle.js";
import type { DurableSessionPointer, DurableTurnPointer } from "../session-truth.js";

type RpcAck = { response: Response; body: Record<string, unknown> | null };

export interface UserDoMessageRuntimeContext {
  attachments: Map<string, unknown>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  userAuthSnapshotKey: string;
  requireSession(sessionUuid: string): Promise<SessionEntry | null>;
  sessionGateMiss(sessionUuid: string): Promise<Response>;
  getTerminal(sessionUuid: string): Promise<unknown>;
  isAllowedSessionImageUrl(sessionUuid: string, rawUrl: string): boolean;
  refreshUserState(
    authSnapshot?: IngressAuthSnapshot,
    seed?: InitialContextSeed,
  ): Promise<void>;
  requireAllowedModel(
    authSnapshot: IngressAuthSnapshot,
    modelId: string,
  ): Promise<Response | null>;
  enforceSessionDevice(
    sessionUuid: string,
    entry: SessionEntry,
    authSnapshot: IngressAuthSnapshot | null | undefined,
  ): Promise<SessionEntry | Response>;
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
    kind: "followup",
    inputText: string | null,
    timestamp: string,
  ): Promise<DurableTurnPointer | null>;
  recordUserMessage(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    kind: "user.input.text" | "user.input.multipart",
    payload: Record<string, unknown>,
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
  forwardInternalJsonShadow(
    sessionUuid: string,
    action: "input",
    body: Record<string, unknown> | undefined,
    rpcMethod: "input",
  ): Promise<RpcAck>;
  readInternalStream(
    sessionUuid: string,
  ): Promise<{ ok: true; frames: StreamFrame[] } | { ok: false; response: Response }>;
  sessionTruth(): {
    updateSessionState(input: {
      session_uuid: string;
      status: SessionEntry["status"];
      last_phase: string | null;
      touched_at: string;
      ended_at?: string | null;
    }): Promise<void>;
    closeTurn(input: {
      turn_uuid: string;
      status: "cancelled" | "failed" | "completed";
      ended_at: string;
    }): Promise<void>;
  } | null;
  forwardFramesToAttachment(
    sessionUuid: string,
    entry: SessionEntry,
    frames: readonly StreamFrame[],
  ): Promise<SessionEntry>;
  recordStreamFrames(
    sessionUuid: string,
    pointer: DurableSessionPointer | null,
    authSnapshot: IngressAuthSnapshot,
    traceUuid: string,
    turn: DurableTurnPointer | null,
    frames: readonly StreamFrame[],
    timestamp: string,
  ): Promise<void>;
  updateConversationIndex(
    pointer: DurableSessionPointer | null,
    entry: SessionEntry,
  ): Promise<void>;
  updateActivePointers(
    pointer: DurableSessionPointer | null,
    turn: DurableTurnPointer | null,
  ): Promise<void>;
}

export function createUserDoMessageRuntime(ctx: UserDoMessageRuntimeContext) {
  return {
    async handleMessages(
      sessionUuid: string,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const entry = await ctx.requireSession(sessionUuid);
      if (!entry) return ctx.sessionGateMiss(sessionUuid);
      if (entry.status === "ended") {
        return sessionTerminalResponse(
          sessionUuid,
          (await ctx.getTerminal(sessionUuid)) as never,
        );
      }

      // HP0 P2-02 — 三入口共享 parseModelOptions(),不再在此内联第二套 validator。
      const modelOptions = parseModelOptions(body);
      if (!modelOptions.ok) return modelOptions.response;
      const modelId = modelOptions.model_id;
      const reasoning = modelOptions.reasoning;
      const partsRaw = body.parts;
      if (!Array.isArray(partsRaw) || partsRaw.length === 0) {
        return jsonResponse(400, {
          error: "invalid-input",
          message: "messages requires non-empty parts[] array",
        });
      }
      const parts: Array<{
        kind: "text" | "artifact_ref" | "image_url";
        text?: string;
        artifact_uuid?: string;
        url?: string;
        mime?: string;
        mimeType?: string;
        summary?: string;
      }> = [];
      for (const raw of partsRaw) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          return jsonResponse(400, { error: "invalid-input", message: "each part must be an object" });
        }
        const part = raw as Record<string, unknown>;
        if (part.kind === "text") {
          if (typeof part.text !== "string" || part.text.length === 0 || part.text.length > 32768) {
            return jsonResponse(400, { error: "invalid-input", message: "text part requires non-empty text" });
          }
          parts.push({ kind: "text", text: part.text as string });
          continue;
        }
        if (part.kind === "artifact_ref") {
          if (typeof part.artifact_uuid !== "string" || part.artifact_uuid.length === 0) {
            return jsonResponse(400, { error: "invalid-input", message: "artifact_ref part requires artifact_uuid" });
          }
          parts.push({
            kind: "artifact_ref",
            artifact_uuid: part.artifact_uuid as string,
            ...(typeof part.mime === "string" ? { mime: part.mime } : {}),
            ...(typeof part.summary === "string" ? { summary: part.summary } : {}),
          });
          continue;
        }
        if (
          part.kind !== "image_url" ||
          typeof part.url !== "string" ||
          part.url.length === 0 ||
          part.url.length > 2048
        ) {
          return jsonResponse(400, {
            error: "invalid-input",
            message: `unsupported part kind '${String(part.kind)}'; expected 'text' | 'artifact_ref' | 'image_url'`,
          });
        }
        const url = part.url as string;
        if (!ctx.isAllowedSessionImageUrl(sessionUuid, url)) {
          return jsonResponse(400, {
            error: "invalid-input",
            message: "image_url must reference this session file content endpoint",
          });
        }
        parts.push({
          kind: "image_url",
          url,
          ...(typeof part.mime === "string" ? { mime: part.mime } : {}),
          ...(typeof part.mimeType === "string" ? { mimeType: part.mimeType } : {}),
        });
      }

      const authSnapshot = isAuthSnapshot(body.auth_snapshot)
        ? body.auth_snapshot
        : await ctx.get<IngressAuthSnapshot>(ctx.userAuthSnapshotKey);
      if (body.auth_snapshot) {
        await ctx.refreshUserState(
          body.auth_snapshot as IngressAuthSnapshot,
          body.initial_context_seed as InitialContextSeed | undefined,
        );
      }
      if (!authSnapshot) {
        return jsonResponse(400, {
          error: "missing-authority",
          message: "messages requires persisted auth snapshot",
        });
      }
      if (modelId) {
        const modelGate = await ctx.requireAllowedModel(authSnapshot, modelId);
        if (modelGate) return modelGate;
      }
      const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, authSnapshot);
      if (gatedEntry instanceof Response) return gatedEntry;
      const traceUuid = typeof body.trace_uuid === "string" ? body.trace_uuid : crypto.randomUUID();
      const now = new Date().toISOString();

      const isMultipart = parts.length > 1 || parts.some((p) => p.kind !== "text");
      const messageKind = isMultipart ? "user.input.multipart" : "user.input.text";

      const durablePointer = await ctx.ensureDurableSession(sessionUuid, authSnapshot, traceUuid, now);
      const durableTurn = await ctx.createDurableTurn(
        sessionUuid,
        durablePointer,
        authSnapshot,
        traceUuid,
        "followup",
        isMultipart ? null : (parts[0] as { text: string }).text,
        now,
      );
      await ctx.recordUserMessage(
        sessionUuid,
        durablePointer,
        authSnapshot,
        traceUuid,
        durableTurn,
        messageKind,
        { parts },
        now,
      );
      await ctx.appendDurableActivity({
        pointer: durablePointer,
        authSnapshot,
        traceUuid,
        turnUuid: durableTurn?.turn_uuid,
        eventKind: "session.message.append",
        severity: "info",
        payload: { message_kind: messageKind, part_count: parts.length },
        timestamp: now,
      });

      const combinedText = parts
        .map((p) =>
          p.kind === "text"
            ? (p.text ?? "")
            : p.kind === "artifact_ref"
              ? `[artifact:${p.artifact_uuid}${p.summary ? `|${p.summary}` : ""}]`
              : `[image:${p.url}]`,
        )
        .filter((s) => s.length > 0)
        .join("\n");
      const inputAck = await ctx.forwardInternalJsonShadow(
        sessionUuid,
        "input",
        {
          text: combinedText,
          parts,
          message_kind: messageKind,
          ...(modelId ? { model_id: modelId } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(body.context_ref !== undefined ? { context_ref: body.context_ref } : {}),
          ...(typeof body.stream_seq === "number" ? { stream_seq: body.stream_seq } : {}),
          ...(typeof body.trace_uuid === "string" ? { trace_uuid: body.trace_uuid } : {}),
          authority: authSnapshot,
        },
        "input",
      );
      if (!inputAck.response.ok) {
        if (durableTurn) {
          await ctx.sessionTruth()?.closeTurn({
            turn_uuid: durableTurn.turn_uuid,
            status: "failed",
            ended_at: new Date().toISOString(),
          });
        }
        return new Response(inputAck.body ? JSON.stringify(inputAck.body) : null, {
          status: inputAck.response.status,
          headers: { "Content-Type": "application/json" },
        });
      }

      const stream = await ctx.readInternalStream(sessionUuid);
      if (!stream.ok) return stream.response;
      const frames = stream.frames;
      let nextEntry: SessionEntry = {
        ...gatedEntry,
        last_seen_at: new Date().toISOString(),
        last_phase: extractPhase(inputAck.body) ?? gatedEntry.last_phase,
        status: ctx.attachments.has(sessionUuid) ? "active" : "detached",
        ended_at: null,
      };
      await ctx.put(sessionKey(sessionUuid), nextEntry);
      await ctx.sessionTruth()?.updateSessionState({
        session_uuid: sessionUuid,
        status: nextEntry.status,
        last_phase: nextEntry.last_phase,
        touched_at: nextEntry.last_seen_at,
      });
      nextEntry = await ctx.forwardFramesToAttachment(sessionUuid, nextEntry, frames);
      await ctx.recordStreamFrames(
        sessionUuid,
        durablePointer,
        authSnapshot,
        traceUuid,
        durableTurn,
        frames,
        nextEntry.last_seen_at,
      );
      await ctx.updateConversationIndex(durablePointer, nextEntry);
      await ctx.updateActivePointers(durablePointer, durableTurn);
      if (durableTurn) {
        const terminal =
          frames.find((frame): frame is Extract<StreamFrame, { kind: "terminal" }> => frame.kind === "terminal") ??
          null;
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

      const action = body._origin === "input" ? "input" : "messages";
      return jsonResponse(inputAck.response.status, {
        ...(inputAck.body ?? { ok: true, action }),
        action,
        session_uuid: sessionUuid,
        session_status: nextEntry.status,
        relay_cursor: nextEntry.relay_cursor,
        message_kind: messageKind,
        part_count: parts.length,
        turn_uuid: durableTurn?.turn_uuid ?? null,
      });
    },
  };
}
