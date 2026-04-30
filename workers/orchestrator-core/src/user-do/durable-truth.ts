import { createLogger } from "@haimang/nacp-core/logger";
import type { IngressAuthSnapshot } from "../auth.js";
import type {
  D1SessionTruthRepository,
  DurableSessionPointer,
  DurableTurnPointer,
} from "../session-truth.js";
import {
  redactActivityPayload,
  sessionKey,
  terminalKey,
  type SessionEntry,
} from "../session-lifecycle.js";
import {
  ACTIVE_POINTERS_KEY,
  CACHE_TTL_MS,
  CONVERSATION_INDEX_KEY,
  ENDED_INDEX_KEY,
  ENDED_TTL_MS,
  HOT_STATE_ALARM_MS,
  MAX_CONVERSATIONS,
  MAX_ENDED_SESSIONS,
  MAX_RECENT_FRAMES,
  PENDING_TTL_MS,
  cacheKey,
  recentFramesKey,
  type ActivePointers,
  type ConversationIndexItem,
  type EndedIndexItem,
  type EphemeralCacheEntry,
  type RecentFramesState,
} from "../session-read-model.js";
import type { StreamFrame } from "../parity-bridge.js";

const logger = createLogger("orchestrator-core");

export interface UserDoDurableTruthContext {
  sessionTruth(): D1SessionTruthRepository | null;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  setHotStateAlarm(at: number): Promise<void>;
}

export function createUserDoDurableTruth(ctx: UserDoDurableTruthContext) {
  return {
    async ensureDurableSession(
      sessionUuid: string,
      authSnapshot: IngressAuthSnapshot,
      traceUuid: string,
      timestamp: string,
    ): Promise<DurableSessionPointer | null> {
      const repo = ctx.sessionTruth();
      const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
      const actorUserUuid = authSnapshot.user_uuid ?? authSnapshot.sub;
      if (!repo || typeof teamUuid !== "string" || teamUuid.length === 0) return null;
      return repo.beginSession({
        session_uuid: sessionUuid,
        team_uuid: teamUuid,
        actor_user_uuid: actorUserUuid,
        trace_uuid: traceUuid,
        started_at: timestamp,
      });
    },

    async createDurableTurn(
      sessionUuid: string,
      pointer: DurableSessionPointer | null,
      authSnapshot: IngressAuthSnapshot,
      traceUuid: string,
      kind: "start" | "followup" | "cancel",
      inputText: string | null,
      timestamp: string,
      requestedModel?: {
        readonly model_id: string;
        readonly reasoning_effort: "low" | "medium" | "high" | null;
      } | null,
    ): Promise<DurableTurnPointer | null> {
      const repo = ctx.sessionTruth();
      const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
      const actorUserUuid = authSnapshot.user_uuid ?? authSnapshot.sub;
      if (!repo || !pointer || typeof teamUuid !== "string" || teamUuid.length === 0) return null;
      return repo.createTurn({
        session_uuid: sessionUuid,
        conversation_uuid: pointer.conversation_uuid,
        team_uuid: teamUuid,
        actor_user_uuid: actorUserUuid,
        trace_uuid: traceUuid,
        kind,
        input_text: inputText,
        created_at: timestamp,
        requested_model_id: requestedModel?.model_id ?? null,
        requested_reasoning_effort: requestedModel?.reasoning_effort ?? null,
      });
    },

    async appendDurableActivity(input: {
      readonly pointer: DurableSessionPointer | null;
      readonly authSnapshot: IngressAuthSnapshot;
      readonly traceUuid: string;
      readonly turnUuid?: string | null;
      readonly eventKind: string;
      readonly severity: "info" | "warn" | "error";
      readonly payload: Record<string, unknown>;
      readonly timestamp: string;
    }): Promise<void> {
      const repo = ctx.sessionTruth();
      const teamUuid = input.authSnapshot.team_uuid ?? input.authSnapshot.tenant_uuid;
      const actorUserUuid = input.authSnapshot.user_uuid ?? input.authSnapshot.sub;
      if (!repo || typeof teamUuid !== "string" || teamUuid.length === 0) return;
      await repo.appendActivity({
        team_uuid: teamUuid,
        actor_user_uuid: actorUserUuid,
        conversation_uuid: input.pointer?.conversation_uuid ?? null,
        session_uuid: input.pointer?.session_uuid ?? null,
        turn_uuid: input.turnUuid ?? null,
        trace_uuid: input.traceUuid,
        event_kind: input.eventKind,
        severity: input.severity,
        payload: redactActivityPayload(input.payload),
        created_at: input.timestamp,
      });
    },

    async recordContextSnapshot(
      sessionUuid: string,
      pointer: DurableSessionPointer | null,
      turn: DurableTurnPointer | null,
      authSnapshot: IngressAuthSnapshot,
      traceUuid: string,
      payload: unknown,
      timestamp: string,
    ): Promise<void> {
      const repo = ctx.sessionTruth();
      const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
      if (!repo || !pointer || typeof teamUuid !== "string" || teamUuid.length === 0) return;
      const recordPayload =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? (payload as Record<string, unknown>)
          : {};
      await repo.captureContextSnapshot({
        session_uuid: sessionUuid,
        conversation_uuid: pointer.conversation_uuid,
        team_uuid: teamUuid,
        trace_uuid: traceUuid,
        turn_uuid: turn?.turn_uuid ?? null,
        snapshot_kind: "initial-context",
        summary_ref: null,
        prompt_token_estimate: null,
        payload: recordPayload,
        created_at: timestamp,
      });
    },

    async recordUserMessage(
      sessionUuid: string,
      pointer: DurableSessionPointer | null,
      authSnapshot: IngressAuthSnapshot,
      traceUuid: string,
      turn: DurableTurnPointer | null,
      kind: "user.input" | "user.cancel" | "user.input.text" | "user.input.multipart",
      payload: Record<string, unknown>,
      timestamp: string,
    ): Promise<void> {
      const repo = ctx.sessionTruth();
      const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
      if (!repo || !pointer || typeof teamUuid !== "string" || teamUuid.length === 0) return;
      await repo.appendMessage({
        session_uuid: sessionUuid,
        conversation_uuid: pointer.conversation_uuid,
        team_uuid: teamUuid,
        trace_uuid: traceUuid,
        turn_uuid: turn?.turn_uuid ?? null,
        role: kind.startsWith("user.input") ? "user" : "system",
        kind,
        event_seq: null,
        body: payload,
        created_at: timestamp,
      });
    },

    async recordStreamFrames(
      sessionUuid: string,
      pointer: DurableSessionPointer | null,
      authSnapshot: IngressAuthSnapshot,
      traceUuid: string,
      turn: DurableTurnPointer | null,
      frames: readonly StreamFrame[],
      timestamp: string,
    ): Promise<void> {
      await ctx.put(recentFramesKey(sessionUuid), {
        updated_at: timestamp,
        frames: frames.slice(-MAX_RECENT_FRAMES),
      } satisfies RecentFramesState);
      const repo = ctx.sessionTruth();
      const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
      const actorUserUuid = authSnapshot.user_uuid ?? authSnapshot.sub;
      if (!repo || !pointer || typeof teamUuid !== "string" || teamUuid.length === 0) return;

      for (const frame of frames) {
        if (frame.kind === "event") {
          await repo.appendStreamEvent({
            session_uuid: sessionUuid,
            conversation_uuid: pointer.conversation_uuid,
            team_uuid: teamUuid,
            trace_uuid: traceUuid,
            turn_uuid: turn?.turn_uuid ?? null,
            event_seq: frame.seq,
            payload: frame.payload,
            created_at: timestamp,
          });
          await repo.appendActivity({
            team_uuid: teamUuid,
            actor_user_uuid: actorUserUuid,
            conversation_uuid: pointer.conversation_uuid,
            session_uuid: sessionUuid,
            turn_uuid: turn?.turn_uuid ?? null,
            trace_uuid: traceUuid,
            event_kind: `stream.${typeof frame.payload.kind === "string" ? frame.payload.kind : "event"}`,
            severity:
              frame.payload.kind === "system.notify" &&
              typeof frame.payload.severity === "string" &&
              frame.payload.severity === "error"
                ? "error"
                : "info",
            payload: redactActivityPayload(frame.payload),
            created_at: timestamp,
          });
        } else if (frame.kind === "terminal") {
          await repo.appendActivity({
            team_uuid: teamUuid,
            actor_user_uuid: actorUserUuid,
            conversation_uuid: pointer.conversation_uuid,
            session_uuid: sessionUuid,
            turn_uuid: turn?.turn_uuid ?? null,
            trace_uuid: traceUuid,
            event_kind: `stream.terminal.${frame.terminal}`,
            severity: frame.terminal === "error" ? "error" : "info",
            payload: redactActivityPayload(frame.payload ?? { terminal: frame.terminal }),
            created_at: timestamp,
          });
        }
      }
    },

    async readDurableSnapshot(sessionUuid: string) {
      return ctx.sessionTruth()?.readSnapshot(sessionUuid) ?? null;
    },

    async readDurableTimeline(sessionUuid: string) {
      return ctx.sessionTruth()?.readTimeline(sessionUuid) ?? [];
    },

    async readDurableHistory(sessionUuid: string) {
      return ctx.sessionTruth()?.readHistory(sessionUuid) ?? [];
    },

    async updateConversationIndex(
      pointer: DurableSessionPointer | null,
      entry: SessionEntry,
    ): Promise<void> {
      if (!pointer) return;
      const current = (await ctx.get<ConversationIndexItem[]>(CONVERSATION_INDEX_KEY)) ?? [];
      const next = [
        {
          conversation_uuid: pointer.conversation_uuid,
          latest_session_uuid: pointer.session_uuid,
          status: entry.status,
          updated_at: entry.last_seen_at,
        },
        ...current.filter((item) => item.conversation_uuid !== pointer.conversation_uuid),
      ].slice(0, MAX_CONVERSATIONS);
      await ctx.put(CONVERSATION_INDEX_KEY, next);
    },

    async updateActivePointers(
      pointer: DurableSessionPointer | null,
      turn: DurableTurnPointer | null,
    ): Promise<void> {
      await ctx.put(ACTIVE_POINTERS_KEY, {
        conversation_uuid: pointer?.conversation_uuid ?? null,
        session_uuid: pointer?.session_uuid ?? null,
        turn_uuid: turn?.turn_uuid ?? null,
      } satisfies ActivePointers);
    },

    async rememberCache(name: string, value: Record<string, unknown> | null): Promise<void> {
      await ctx.put(cacheKey(name), {
        key: name,
        value,
        expires_at: new Date(Date.now() + CACHE_TTL_MS).toISOString(),
      } satisfies EphemeralCacheEntry);
    },

    async trimHotState(now = Date.now()): Promise<void> {
      const index = (await ctx.get<ConversationIndexItem[]>(CONVERSATION_INDEX_KEY)) ?? [];
      if (index.length > MAX_CONVERSATIONS) {
        await ctx.put(CONVERSATION_INDEX_KEY, index.slice(0, MAX_CONVERSATIONS));
      }
      const activePointers = await ctx.get<ActivePointers>(ACTIVE_POINTERS_KEY);
      const sessionUuids = new Set<string>();
      for (const item of index) sessionUuids.add(item.latest_session_uuid);
      if (typeof activePointers?.session_uuid === "string" && activePointers.session_uuid.length > 0) {
        sessionUuids.add(activePointers.session_uuid);
      }
      for (const sessionUuid of sessionUuids) {
        const recent = await ctx.get<RecentFramesState>(recentFramesKey(sessionUuid));
        if (recent?.frames && recent.frames.length > MAX_RECENT_FRAMES) {
          await ctx.put(recentFramesKey(sessionUuid), {
            ...recent,
            frames: recent.frames.slice(-MAX_RECENT_FRAMES),
          } satisfies RecentFramesState);
        }
        for (const cacheName of [`status:${sessionUuid}`, `verify:${sessionUuid}`]) {
          const cache = await ctx.get<EphemeralCacheEntry>(cacheKey(cacheName));
          const expiresAt = cache?.expires_at ? Date.parse(cache.expires_at) : Number.NaN;
          if (cache && Number.isFinite(expiresAt) && expiresAt <= now) {
            await ctx.delete(cacheKey(cacheName));
          }
        }
      }
      const ended = (await ctx.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
      for (const item of ended) {
        const endedAt = Date.parse(item.ended_at);
        if (Number.isFinite(endedAt) && endedAt < now - ENDED_TTL_MS) {
          await ctx.delete(recentFramesKey(item.session_uuid));
          await ctx.delete(cacheKey(`status:${item.session_uuid}`));
          await ctx.delete(cacheKey(`verify:${item.session_uuid}`));
        }
      }
    },

    async ensureHotStateAlarm(): Promise<void> {
      await ctx.setHotStateAlarm(Date.now() + HOT_STATE_ALARM_MS);
    },

    async rememberEndedSession(sessionUuid: string, endedAt: string): Promise<void> {
      const current = (await ctx.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
      const next = [
        ...current.filter((item) => item.session_uuid !== sessionUuid),
        { session_uuid: sessionUuid, ended_at: endedAt },
      ].sort((a, b) => a.ended_at.localeCompare(b.ended_at));
      await ctx.put(ENDED_INDEX_KEY, next);
    },

    async expireStalePendingSessions(now = Date.now()): Promise<void> {
      const repo = ctx.sessionTruth();
      if (!repo) return;
      const cutoff = new Date(now - PENDING_TTL_MS).toISOString();
      const nowIso = new Date(now).toISOString();
      try {
        const expired = await repo.expireStalePending({ now: nowIso, cutoff });
        if (expired > 0) {
          logger.warn("pending-session-expired-gc", {
            code: "internal-error",
            ctx: { tag: "pending-session-expired-gc", expired_count: expired, cutoff },
          });
        }
      } catch (error) {
        logger.warn("pending-session-expired-gc-failed", {
          code: "internal-error",
          ctx: { tag: "pending-session-expired-gc-failed", error: String(error) },
        });
      }
    },

    async cleanupEndedSessions(now = Date.now()): Promise<void> {
      const index = (await ctx.get<EndedIndexItem[]>(ENDED_INDEX_KEY)) ?? [];
      const keptByTime = index.filter((item) => {
        const endedAt = Date.parse(item.ended_at);
        return Number.isFinite(endedAt) && endedAt >= now - ENDED_TTL_MS;
      });
      const kept = keptByTime.slice(-MAX_ENDED_SESSIONS);
      const keepSet = new Set(kept.map((item) => item.session_uuid));

      for (const item of index) {
        if (keepSet.has(item.session_uuid)) continue;
        await ctx.delete(sessionKey(item.session_uuid));
        await ctx.delete(terminalKey(item.session_uuid));
      }

      await ctx.put(ENDED_INDEX_KEY, kept);
    },
  };
}
