import type { IngressAuthSnapshot } from "../auth.js";
import {
  InvalidStreamFrameError,
  type StreamFrame,
  readJson,
  readNdjsonFrames,
} from "../parity-bridge.js";
import { jsonResponse } from "../session-lifecycle.js";
import type { SessionEntry } from "../session-lifecycle.js";
import type { D1SessionTruthRepository } from "../session-truth.js";

export type StreamReadResult =
  | { ok: true; frames: StreamFrame[] }
  | { ok: false; response: Response };

export interface UserDoAgentRpcContext {
  env: {
    AGENT_CORE?: Fetcher;
    NANO_INTERNAL_BINDING_SECRET?: string;
  };
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  cloneJsonResponse(
    status: number,
    body: Record<string, unknown> | null,
    contentType?: string,
  ): Response;
  sessionTruth(): D1SessionTruthRepository | null;
  userAuthSnapshotKey: string;
  sessionKey(sessionUuid: string): string;
}

function isAuthSnapshot(value: unknown): value is IngressAuthSnapshot {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { sub?: unknown }).sub === "string"
  );
}

export function createUserDoAgentRpc(ctx: UserDoAgentRpcContext) {
  return {
    async forwardInternalRaw(
      sessionUuid: string,
      action: string,
      body?: Record<string, unknown>,
    ): Promise<Response> {
      if (!ctx.env.AGENT_CORE) {
        return jsonResponse(503, {
          error: "agent-core-unavailable",
          message: "AGENT_CORE binding missing",
        });
      }
      if (!ctx.env.NANO_INTERNAL_BINDING_SECRET) {
        return jsonResponse(503, {
          error: "internal-auth-unconfigured",
          message: "internal binding secret missing",
        });
      }

      const traceUuid =
        typeof body?.trace_uuid === "string" && body.trace_uuid.length > 0
          ? body.trace_uuid
          : crypto.randomUUID();
      const authority = isAuthSnapshot(body?.authority)
        ? body.authority
        : await ctx.get<IngressAuthSnapshot>(ctx.userAuthSnapshotKey);
      if (!authority || typeof authority.sub !== "string" || authority.sub.length === 0) {
        return jsonResponse(400, {
          error: "missing-authority",
          message: "internal requests require a persisted auth snapshot",
          session_uuid: sessionUuid,
        });
      }

      const headers = new Headers({
        "x-nano-internal-binding-secret": ctx.env.NANO_INTERNAL_BINDING_SECRET,
        "x-trace-uuid": traceUuid,
        "x-nano-internal-authority": JSON.stringify(authority),
      });
      if (body) headers.set("content-type", "application/json");

      return ctx.env.AGENT_CORE.fetch(
        new Request(`https://agent.internal/internal/sessions/${sessionUuid}/${action}`, {
          method: body ? "POST" : "GET",
          headers,
          body: body ? JSON.stringify(body) : undefined,
        }),
      );
    },

    async readInternalStream(sessionUuid: string): Promise<StreamReadResult> {
      const response = await this.forwardInternalRaw(sessionUuid, "stream");
      if (!response.ok) return { ok: false, response };
      try {
        return { ok: true, frames: await readNdjsonFrames(response) };
      } catch (error) {
        if (error instanceof InvalidStreamFrameError) {
          return {
            ok: false,
            response: jsonResponse(502, {
              error: "invalid-stream-frame",
              message: error.message,
              session_uuid: sessionUuid,
            }),
          };
        }
        throw error;
      }
    },

    async proxyReadResponse(
      sessionUuid: string,
      entry: SessionEntry,
      response: Response,
    ): Promise<Response> {
      const body = await readJson(response);
      const nextEntry = {
        ...entry,
        last_seen_at: new Date().toISOString(),
        last_phase:
          body && typeof body.phase === "string"
            ? body.phase
            : body &&
                typeof body.state === "object" &&
                body.state !== null &&
                typeof (body.state as { phase?: unknown }).phase === "string"
              ? ((body.state as { phase: string }).phase)
              : entry.last_phase,
      } satisfies SessionEntry;
      await ctx.put(ctx.sessionKey(sessionUuid), nextEntry);
      await ctx.sessionTruth()?.updateSessionState({
        session_uuid: sessionUuid,
        status: nextEntry.status,
        last_phase: nextEntry.last_phase,
        touched_at: nextEntry.last_seen_at,
        ended_at: nextEntry.ended_at,
      });
      return ctx.cloneJsonResponse(
        response.status,
        body,
        response.headers.get("Content-Type") ?? "application/json",
      );
    },
  };
}
