import { createLogger } from "@haimang/nacp-core/logger";
import type { AuditRecord } from "@haimang/nacp-core/logger";
import type { IngressAuthSnapshot } from "../auth.js";
import { jsonResponse } from "../session-lifecycle.js";
import {
  sessionTerminalResponse,
  sessionKey,
  type SessionEntry,
  type SessionStatus,
  type SessionTerminalRecord,
} from "../session-lifecycle.js";
import type { StreamFrame } from "../parity-bridge.js";
import {
  CLIENT_WS_HEARTBEAT_INTERVAL_MS,
  createWebSocketPair,
  isWebSocketUpgrade,
  parseLastSeenSeq,
  type AttachmentState,
  type WorkerSocketLike,
} from "../ws-bridge.js";
import type { StreamReadResult } from "./agent-rpc.js";

const logger = createLogger("orchestrator-core");

export interface UserDoWsRuntimeContext {
  attachments: Map<string, AttachmentState>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  readInternalAuthority(request: Request): IngressAuthSnapshot | null;
  requireReadableSession(sessionUuid: string): Promise<SessionEntry | null>;
  sessionGateMiss(sessionUuid: string): Promise<Response>;
  getTerminal(sessionUuid: string): Promise<SessionTerminalRecord | null>;
  readInternalStream(sessionUuid: string): Promise<StreamReadResult>;
  emitServerFrame(
    sessionUuid: string,
    frame: { kind: string; [k: string]: unknown },
  ): void;
  enforceSessionDevice(
    sessionUuid: string,
    entry: SessionEntry,
    authSnapshot: IngressAuthSnapshot | null | undefined,
  ): Promise<SessionEntry | Response>;
  readAuditAuthSnapshot(): Promise<IngressAuthSnapshot | null>;
  persistAudit(record: AuditRecord): Promise<void>;
}

export function createUserDoWsRuntime(ctx: UserDoWsRuntimeContext) {
  return {
    async handleWsAttach(sessionUuid: string, request: Request): Promise<Response> {
      const entry = await ctx.requireReadableSession(sessionUuid);
      if (!entry) return ctx.sessionGateMiss(sessionUuid);
      if (entry.status === "ended") {
        return sessionTerminalResponse(sessionUuid, await ctx.getTerminal(sessionUuid));
      }
      const parsedAuthority = ctx.readInternalAuthority(request);
      const gatedEntry = await ctx.enforceSessionDevice(sessionUuid, entry, parsedAuthority);
      if (gatedEntry instanceof Response) return gatedEntry;
      if (!isWebSocketUpgrade(request)) {
        return jsonResponse(400, {
          error: "invalid-upgrade",
          message: "ws route requires websocket upgrade",
        });
      }
      const clientLastSeenSeq = parseLastSeenSeq(request);

      const pair = createWebSocketPair();
      if (!pair) {
        return jsonResponse(501, {
          error: "websocket-unavailable",
          message: "WebSocketPair unavailable",
        });
      }
      pair.server.accept?.();

      const stream = await ctx.readInternalStream(sessionUuid);
      if (!stream.ok) return stream.response;

      const current = ctx.attachments.get(sessionUuid);
      if (current) {
        const auditAuth = parsedAuthority ?? await ctx.readAuditAuthSnapshot();
        await ctx.persistAudit({
          ts: new Date().toISOString(),
          worker: "orchestrator-core",
          event_kind: "session.attachment.superseded",
          outcome: "ok",
          session_uuid: sessionUuid,
          trace_uuid: request.headers.get("x-trace-uuid") ?? undefined,
          team_uuid: auditAuth?.team_uuid ?? auditAuth?.tenant_uuid,
          user_uuid: auditAuth?.user_uuid ?? auditAuth?.sub,
          device_uuid: auditAuth?.device_uuid ?? gatedEntry.device_uuid ?? undefined,
          detail: { reason: "reattach" },
        });
        ctx.emitServerFrame(sessionUuid, {
          kind: "session.attachment.superseded",
          session_uuid: sessionUuid,
          superseded_at: new Date().toISOString(),
          reason: "reattach",
        });
        ctx.attachments.delete(sessionUuid);
        if (current.heartbeat_timer) clearInterval(current.heartbeat_timer);
        current.socket.close(4001, "attachment_superseded");
      }

      const heartbeatTimer = setInterval(() => {
        const currentAttachment = ctx.attachments.get(sessionUuid);
        if (!currentAttachment || currentAttachment.socket !== pair.server) {
          clearInterval(heartbeatTimer);
          return;
        }
        ctx.emitServerFrame(sessionUuid, {
          kind: "session.heartbeat",
          ts: Date.now(),
        });
      }, CLIENT_WS_HEARTBEAT_INTERVAL_MS);
      (heartbeatTimer as unknown as { unref?: () => void }).unref?.();

      ctx.attachments.set(sessionUuid, {
        socket: pair.server,
        attached_at: new Date().toISOString(),
        device_uuid: parsedAuthority?.device_uuid ?? gatedEntry.device_uuid ?? null,
        heartbeat_timer: heartbeatTimer,
      });
      this.bindSocketLifecycle(sessionUuid, pair.server);

      const replayCursor =
        clientLastSeenSeq === null
          ? entry.relay_cursor
          : Math.min(entry.relay_cursor, clientLastSeenSeq);
      const nextEntry: SessionEntry = {
        ...gatedEntry,
        last_seen_at: new Date().toISOString(),
        status: "active",
        relay_cursor: replayCursor,
        ended_at: null,
      };
      await ctx.put(sessionKey(sessionUuid), nextEntry);
      await this.forwardFramesToAttachment(sessionUuid, nextEntry, stream.frames);

      try {
        return new Response(null, {
          status: 101,
          statusText: "Switching Protocols",
          // @ts-expect-error Cloudflare-only webSocket init field
          webSocket: pair.client,
        });
      } catch {
        return new Response(null, { status: 200, statusText: "Switching Protocols" });
      }
    },

    bindSocketLifecycle(sessionUuid: string, socket: WorkerSocketLike): void {
      socket.addEventListener?.("close", () => {
        const current = ctx.attachments.get(sessionUuid);
        if (!current || current.socket !== socket) return;
        ctx.attachments.delete(sessionUuid);
        if (current.heartbeat_timer) clearInterval(current.heartbeat_timer);
        this.markDetached(sessionUuid).catch((err) =>
          logger.warn("mark-detached-failed", {
            code: "internal-error",
            ctx: { tag: "mark-detached-failed", error: String(err) },
          }),
        );
      });

      socket.addEventListener?.("message", () => {
        this.touchSession(
          sessionUuid,
          ctx.attachments.has(sessionUuid) ? "active" : "detached",
        ).catch((err) =>
          logger.warn("touch-session-failed", {
            code: "internal-error",
            ctx: { tag: "touch-session-failed", error: String(err) },
          }),
        );
      });
    },

    async markDetached(sessionUuid: string): Promise<void> {
      const entry = await ctx.get<SessionEntry>(sessionKey(sessionUuid));
      if (!entry || entry.status === "ended") return;
      await ctx.put(sessionKey(sessionUuid), {
        ...entry,
        status: "detached",
        last_seen_at: new Date().toISOString(),
      } satisfies SessionEntry);
    },

    async touchSession(sessionUuid: string, status: SessionStatus): Promise<void> {
      const entry = await ctx.get<SessionEntry>(sessionKey(sessionUuid));
      if (!entry || entry.status === "ended") return;
      await ctx.put(sessionKey(sessionUuid), {
        ...entry,
        status,
        last_seen_at: new Date().toISOString(),
      } satisfies SessionEntry);
    },

    async forwardFramesToAttachment(
      sessionUuid: string,
      entry: SessionEntry,
      frames: readonly StreamFrame[],
    ): Promise<SessionEntry> {
      const attachment = ctx.attachments.get(sessionUuid);
      if (!attachment) return entry;

      let cursor = entry.relay_cursor;
      for (const frame of frames) {
        if (frame.kind !== "event") continue;
        if (frame.seq <= cursor) continue;
        attachment.socket.send(JSON.stringify(frame));
        cursor = frame.seq;
      }

      if (cursor === entry.relay_cursor) return entry;

      const nextEntry: SessionEntry = {
        ...entry,
        relay_cursor: cursor,
        last_seen_at: new Date().toISOString(),
      };
      await ctx.put(sessionKey(sessionUuid), nextEntry);
      return nextEntry;
    },

    async notifyTerminal(
      sessionUuid: string,
      terminal: SessionTerminalRecord,
    ): Promise<void> {
      const attachment = ctx.attachments.get(sessionUuid);
      if (!attachment) return;

      const reasonMap = { completed: "completed", cancelled: "user", error: "error" } as const;
      ctx.emitServerFrame(sessionUuid, {
        kind: "session.end",
        reason: reasonMap[terminal.terminal] ?? "error",
        ...(terminal.last_phase ? { last_phase: terminal.last_phase } : {}),
        session_uuid: sessionUuid,
      });
      attachment.socket.close(1000, `session_${terminal.terminal}`);
      ctx.attachments.delete(sessionUuid);
    },

    async handleDeviceRevoke(deviceUuid: string, reason: string | null): Promise<Response> {
      const now = new Date().toISOString();
      const affected: string[] = [];
      for (const [sessionUuid, attachment] of ctx.attachments.entries()) {
        const entry = await ctx.get<SessionEntry>(sessionKey(sessionUuid));
        if (!entry || entry.device_uuid !== deviceUuid) continue;
        const auditAuth = await ctx.readAuditAuthSnapshot();
        await ctx.persistAudit({
          ts: new Date().toISOString(),
          worker: "orchestrator-core",
          event_kind: "session.attachment.superseded",
          outcome: "ok",
          session_uuid: sessionUuid,
          team_uuid: auditAuth?.team_uuid ?? auditAuth?.tenant_uuid,
          user_uuid: auditAuth?.user_uuid ?? auditAuth?.sub,
          device_uuid: deviceUuid,
          detail: { reason: "revoked" },
        });
        affected.push(sessionUuid);
        ctx.emitServerFrame(sessionUuid, {
          kind: "session.attachment.superseded",
          session_uuid: sessionUuid,
          superseded_at: now,
          reason: "revoked",
        });
        try {
          attachment.socket.close(4001, reason ?? "device_revoked");
        } catch {
          // ignore close errors on best-effort revoke disconnect
        }
      }
      return jsonResponse(200, {
        ok: true,
        data: {
          device_uuid: deviceUuid,
          disconnected_sessions: affected,
        },
      });
    },
  };
}
