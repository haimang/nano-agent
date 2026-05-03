import type { DoStorageLike } from "@haimang/nacp-core";
import {
  parsePersistedSessionHooks,
  SESSION_HOOKS_STORAGE_KEY,
  type SessionHookRuntime,
} from "../../hooks/session-registration.js";

export interface SessionDoHookControlContext {
  readonly hookRuntime: SessionHookRuntime;
  attachSessionUuid(candidate: string): void;
  getTenantScopedStorage(): DoStorageLike | null;
}

export function createSessionDoHookControl(ctx: SessionDoHookControlContext) {
  async function persistSessionHooks(): Promise<void> {
    const storage = ctx.getTenantScopedStorage();
    if (!storage) return;
    await storage.put(SESSION_HOOKS_STORAGE_KEY, ctx.hookRuntime.list());
  }

  return {
    async restoreSessionHooks(): Promise<void> {
      const storage = ctx.getTenantScopedStorage();
      if (!storage) return;
      const raw = await storage.get<unknown>(SESSION_HOOKS_STORAGE_KEY);
      ctx.hookRuntime.restore(parsePersistedSessionHooks(raw));
    },

    async handleSessionHookRegister(sessionId: string, body: unknown): Promise<Response> {
      ctx.attachSessionUuid(sessionId);
      try {
        const registration = ctx.hookRuntime.register(body);
        await persistSessionHooks();
        return Response.json({
          ok: true,
          data: {
            session_uuid: sessionId,
            handler: registration,
          },
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: "invalid-input",
            message: error instanceof Error ? error.message : String(error),
          },
          { status: 400 },
        );
      }
    },

    async handleSessionHookList(sessionId: string): Promise<Response> {
      ctx.attachSessionUuid(sessionId);
      return Response.json({
        ok: true,
        data: {
          session_uuid: sessionId,
          handlers: ctx.hookRuntime.list(),
        },
      });
    },

    async handleSessionHookUnregister(sessionId: string, body: unknown): Promise<Response> {
      ctx.attachSessionUuid(sessionId);
      const record = body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : {};
      const handlerId = typeof record.handler_id === "string"
        ? record.handler_id
        : typeof record.id === "string"
          ? record.id
          : null;
      if (!handlerId) {
        return Response.json(
          { ok: false, error: "invalid-input", message: "handler_id is required" },
          { status: 400 },
        );
      }
      const removed = ctx.hookRuntime.unregister(handlerId);
      await persistSessionHooks();
      return Response.json({
        ok: true,
        data: {
          session_uuid: sessionId,
          handler_id: handlerId,
          removed,
        },
      });
    },
  };
}
