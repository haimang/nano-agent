/**
 * RH0 P0-D2 — persistence helpers extracted from `nano-session-do.ts`.
 *
 * 这层只搬"DO storage put/get/sweep"相关 helper:
 *   - getTenantScopedStorage(): 把 raw doState.storage 包成 tenant-prefixed proxy
 *   - wsHelperStorage(): 给 nacp-session helper 提供 storage 视图
 *   - persistCheckpoint() / restoreFromStorage(): 主 checkpoint 持久化路径
 *   - sweepDeferredAnswers(): alarm 周期清扫 deferred answer
 *
 * 不引入新行为,仅按 charter §7.1 把 storage I/O 实现从 megafile 迁出。
 * NanoSessionDO 通过 narrow `PersistenceContext` 接口拿到所需的状态访问点。
 */

import type { CrossSeamAnchor } from "../cross-seam.js";
import type { OrchestrationState } from "../orchestration.js";
import type { SubsystemHandles } from "../composition.js";
import type { WorkspaceCompositionHandle } from "../workspace-runtime.js";
import {
  type DoStorageLike,
  tenantDoStorageGet,
  tenantDoStoragePut,
  tenantDoStorageDelete,
} from "@haimang/nacp-core";
import {
  SessionWebSocketHelper,
  type SessionStorageLike,
} from "@haimang/nacp-session";
import { validateSessionCheckpoint } from "../checkpoint.js";

export const CHECKPOINT_STORAGE_KEY = "session:checkpoint";
export const SESSION_TEAM_STORAGE_KEY = "session:teamUuid";
export const SESSION_USER_STORAGE_KEY = "session:userUuid";

/**
 * Map entry for the deferred-answer waiter (sweepDeferredAnswers consumer).
 */
export interface DeferredAnswerEntry {
  readonly kind: "permission" | "elicitation";
  readonly requestUuid: string;
  readonly expiresAt: number;
  resolve(value: Record<string, unknown>): void;
  reject(reason: unknown): void;
}

/**
 * Minimum surface persistence needs from NanoSessionDO. Mirrors
 * `VerifyContext` design — narrow accessor pattern,主类的 private 字段
 * 不在本文件暴露。
 */
export interface PersistenceContext {
  readonly doState: {
    readonly storage?: {
      get<T = unknown>(key: string): Promise<T | undefined>;
      put<T = unknown>(key: string, value: T): Promise<void>;
      setAlarm?(scheduledTime: number | Date): Promise<void>;
    };
  };
  readonly workspaceComposition: WorkspaceCompositionHandle;
  readonly subsystems: SubsystemHandles;
  readonly deferredAnswers: Map<string, DeferredAnswerEntry>;
  getSessionUuid(): string | null;
  getCurrentTeamUuid(): string | null;
  setSessionTeamUuid(value: string): void;
  getCurrentUserUuid(): string | null;
  setSessionUserUuid(value: string): void;
  getSessionState(): OrchestrationState;
  setRestoredState(next: OrchestrationState): void;
  getWsHelper(): SessionWebSocketHelper | null;
}

/**
 * B9: returns a `DoStorageLike`-shaped proxy whose every put/get/delete is
 * prefixed with `tenants/<team_uuid>/` via the shipped `tenantDoStorage*`
 * helpers. All non-wrapper call sites inside `NanoSessionDO` go through
 * this proxy so tenant-scoped keys are the only shape that appears on disk.
 */
export function getTenantScopedStorage(
  ctx: PersistenceContext,
): DoStorageLike | null {
  const raw = ctx.doState.storage;
  if (!raw) return null;
  const teamUuid = ctx.getCurrentTeamUuid();
  const team =
    typeof teamUuid === "string" && teamUuid.length > 0 ? teamUuid : "_unknown";
  const base: DoStorageLike = {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return raw.get<T>(key);
    },
    async put<T>(key: string, value: T): Promise<void> {
      await raw.put(key, value);
    },
    async delete(key: string | string[]): Promise<boolean> {
      const anyStorage = raw as unknown as {
        delete?: (k: string | string[]) => Promise<boolean>;
      };
      if (typeof anyStorage.delete === "function") {
        return anyStorage.delete(key);
      }
      return false;
    },
  };
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return tenantDoStorageGet<T>(base, team, key);
    },
    async put<T>(key: string, value: T): Promise<void> {
      await tenantDoStoragePut<T>(base, team, key, value);
    },
    async delete(key: string | string[]): Promise<boolean> {
      if (Array.isArray(key)) {
        let all = true;
        for (const k of key) {
          const r = await tenantDoStorageDelete(base, team, k);
          all = all && r;
        }
        return all;
      }
      return tenantDoStorageDelete(base, team, key);
    },
  };
}

/**
 * Helper-storage adapter: nacp-session helper expects a smaller `get/put`-only
 * interface,我们包一下。
 */
export function buildWsHelperStorage(ctx: PersistenceContext): SessionStorageLike | null {
  const scoped = getTenantScopedStorage(ctx);
  if (!scoped) return null;
  return {
    get: async <T,>(k: string) => scoped.get<T>(k),
    put: async <T,>(k: string, v: T) => {
      await scoped.put(k, v);
    },
  };
}

/**
 * Persist the active checkpoint(B9 tenant-scoped + R2 evidence emission +
 * A4 P2-03 helper checkpoint + symmetry guard with `validateSessionCheckpoint`).
 */
export async function persistCheckpoint(ctx: PersistenceContext): Promise<void> {
  const storage = getTenantScopedStorage(ctx);
  if (!storage) return;

  // 2nd-round R2: capture a workspace snapshot fragment via the live
  // composition handle.失败容忍 — evidence 是 best-effort。
  try {
    await ctx.workspaceComposition.captureSnapshot();
  } catch {
    // Evidence emission is best-effort by design.
  }

  // A4 P2-03: persist the WS helper's replay + stream seq state so a fresh
  // DO instance can reconstruct the buffer after hibernation.
  const helperStorage = buildWsHelperStorage(ctx);
  const helper = ctx.getWsHelper();
  if (helper && helperStorage) {
    await helper.checkpoint(helperStorage);
  }

  // Refuse to persist an invalid checkpoint(symmetry with validator).
  const sessionUuid = ctx.getSessionUuid();
  if (sessionUuid === null) return;
  const teamUuid = ctx.getCurrentTeamUuid();
  if (teamUuid === null) return;

  const state = ctx.getSessionState();
  const checkpoint = {
    version: "0.1.0",
    sessionUuid,
    teamUuid,
    actorPhase: state.actorState.phase,
    turnCount: state.turnCount,
    kernelFragment: state.kernelSnapshot,
    replayFragment: null,
    streamSeqs: {},
    workspaceFragment: null,
    hooksFragment: null,
    usageSnapshot: { totalTokens: 0, totalTurns: state.turnCount, totalDurationMs: 0 },
    checkpointedAt: new Date().toISOString(),
  };

  if (!validateSessionCheckpoint(checkpoint)) return;

  await storage.put(CHECKPOINT_STORAGE_KEY, checkpoint);
}

/**
 * Hydrate state from DO storage(team uuid + checkpoint).
 * Mirrors the original method's behavior 1:1.
 */
export async function restoreFromStorage(ctx: PersistenceContext): Promise<void> {
  const rawStorage = ctx.doState.storage;
  if (rawStorage) {
    const rawTeamUuid = await rawStorage.get<string>(SESSION_TEAM_STORAGE_KEY);
    if (typeof rawTeamUuid === "string" && rawTeamUuid.length > 0) {
      ctx.setSessionTeamUuid(rawTeamUuid);
    }
    const rawUserUuid = await rawStorage.get<string>(SESSION_USER_STORAGE_KEY);
    if (typeof rawUserUuid === "string" && rawUserUuid.length > 0) {
      ctx.setSessionUserUuid(rawUserUuid);
    }
  }
  const storage = getTenantScopedStorage(ctx);
  if (!storage) return;

  const raw = await storage.get(CHECKPOINT_STORAGE_KEY);
  if (!raw) return;
  if (!validateSessionCheckpoint(raw)) return;

  ctx.setSessionTeamUuid(raw.teamUuid);
  const prev = ctx.getSessionState();
  ctx.setRestoredState({
    actorState: {
      ...prev.actorState,
      phase: raw.actorPhase as typeof prev.actorState.phase,
    },
    kernelSnapshot: raw.kernelFragment,
    turnCount: raw.turnCount,
  });
}

/**
 * ZX5 Lane F1/F2 — alarm sweep:检查内存 deferred map 中是否有 expired entry,
 * 以及是否有 storage 中已有 decision 但 deferred 仍在等待(DO restart 后
 * deferred 内存丢失但被新 await 重建的场景)。本方法由 alarm() 周期性调用。
 */
export async function sweepDeferredAnswers(ctx: PersistenceContext): Promise<void> {
  if (ctx.deferredAnswers.size === 0) return;
  const now = Date.now();
  for (const [mapKey, deferred] of ctx.deferredAnswers.entries()) {
    if (deferred.expiresAt <= now) {
      ctx.deferredAnswers.delete(mapKey);
      deferred.reject(
        new Error(`${deferred.kind} decision swept (expiresAt passed)`),
      );
      continue;
    }
    const storageKey = `${deferred.kind}/decisions/${deferred.requestUuid}`;
    const existing = await ctx.doState.storage?.get?.(storageKey);
    if (existing && typeof existing === "object") {
      ctx.deferredAnswers.delete(mapKey);
      deferred.resolve(existing as Record<string, unknown>);
    }
  }
}

/**
 * Side-effect-only attach helper retained for symmetry with the previous
 * `attachTeamUuid` method:
 *   - sets in-memory cache via setSessionTeamUuid
 *   - best-effort persists raw team_uuid to unscoped storage key.
 *
 * Note: caller must check candidate for non-empty string before calling.
 */
export async function persistTeamUuid(
  ctx: PersistenceContext,
  candidate: string,
): Promise<void> {
  ctx.setSessionTeamUuid(candidate);
  const storage = ctx.doState.storage;
  if (storage) {
    void storage.put(SESSION_TEAM_STORAGE_KEY, candidate);
  }
}

export async function persistUserUuid(
  ctx: PersistenceContext,
  candidate: string,
): Promise<void> {
  ctx.setSessionUserUuid(candidate);
  const storage = ctx.doState.storage;
  if (storage) {
    void storage.put(SESSION_USER_STORAGE_KEY, candidate);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * ZX4 Phase 4 P4-01 / Phase 6 P6-01 — record an inbound permission /
 * elicitation decision against a request_uuid. Stores under
 * `${kind}/decisions/${requestUuid}` so a future kernel waiter can poll/resolve;
 * also resolves the in-memory deferred entry immediately to avoid relying on
 * alarm-sweep to wake a current awaiter.
 */
export async function recordAsyncAnswer(
  ctx: PersistenceContext,
  sessionId: string,
  body: unknown,
  kind: "permission" | "elicitation",
): Promise<Response> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(
      JSON.stringify({ error: "invalid-input", message: `${kind} answer requires a JSON body` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const record = body as Record<string, unknown>;
  const requestUuid = record.request_uuid;
  if (typeof requestUuid !== "string" || !UUID_RE.test(requestUuid)) {
    return new Response(
      JSON.stringify({
        error: "invalid-input",
        message: `${kind} answer requires a UUID request_uuid`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const storageKey = `${kind}/decisions/${requestUuid}`;
  const stored = {
    session_uuid: sessionId,
    request_uuid: requestUuid,
    ...record,
    received_at: new Date().toISOString(),
  };
  await ctx.doState.storage?.put(storageKey, stored);
  resolveDeferredAnswer(ctx, kind, requestUuid, stored);
  return new Response(
    JSON.stringify({ ok: true, data: { request_uuid: requestUuid, kind, stored: true } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * ZX5 Lane F1/F2 — kernel-side primitive to await a deferred answer.
 *
 * - Pre-existing storage probe (recover-on-restart safety)
 * - Otherwise register deferred entry + setTimeout fail-closed timeout
 * - Caller must clamp timeoutMs to ≤ 5 min (we enforce here)
 */
export async function awaitAsyncAnswer(
  ctx: PersistenceContext,
  input: {
    kind: "permission" | "elicitation";
    requestUuid: string;
    timeoutMs?: number;
  },
): Promise<Record<string, unknown>> {
  const timeoutMs = Math.max(1000, Math.min(input.timeoutMs ?? 60_000, 5 * 60_000));
  const storageKey = `${input.kind}/decisions/${input.requestUuid}`;
  const existing = await ctx.doState.storage?.get?.(storageKey);
  if (existing && typeof existing === "object") {
    return existing as Record<string, unknown>;
  }
  const mapKey = `${input.kind}:${input.requestUuid}`;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const expiresAt = Date.now() + timeoutMs;
    const timer = setTimeout(() => {
      ctx.deferredAnswers.delete(mapKey);
      reject(new Error(`${input.kind} decision timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    ctx.deferredAnswers.set(mapKey, {
      resolve: (decision) => {
        clearTimeout(timer);
        resolve(decision);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      expiresAt,
      kind: input.kind,
      requestUuid: input.requestUuid,
    });
  });
}

/**
 * Resolve a pending deferred entry (called by recordAsyncAnswer after storage
 * write so the awaiter wakes up immediately rather than waiting for alarm sweep).
 */
export function resolveDeferredAnswer(
  ctx: PersistenceContext,
  kind: "permission" | "elicitation",
  requestUuid: string,
  decision: Record<string, unknown>,
): void {
  const mapKey = `${kind}:${requestUuid}`;
  const deferred = ctx.deferredAnswers.get(mapKey);
  if (!deferred) return;
  ctx.deferredAnswers.delete(mapKey);
  deferred.resolve(decision);
}

// Re-export for symmetry with the original module.
export type { CrossSeamAnchor };
