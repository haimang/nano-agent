import { createLogger } from "@haimang/nacp-core/logger";
import type { AuditRecord } from "@haimang/nacp-core/logger";
import type { InitialContextSeed, IngressAuthSnapshot } from "../auth.js";
import { isAuthSnapshot } from "../session-lifecycle.js";
import {
  jsonResponse,
  sessionKey,
  sessionMissingResponse,
  sessionTerminalResponse,
  terminalKey,
  type SessionEntry,
  type SessionTerminalRecord,
} from "../session-lifecycle.js";
import {
  CONVERSATION_INDEX_KEY,
  USER_AUTH_SNAPSHOT_KEY,
  USER_META_KEY,
  USER_SEED_KEY,
  type ConversationIndexItem,
} from "../session-read-model.js";
import type { D1SessionTruthRepository } from "../session-truth.js";
import type { DurableResolvedModel } from "../session-truth.js";
import {
  D1ConfirmationControlPlane,
  type ConfirmationKind,
  type ConfirmationStatus,
} from "../confirmation-control-plane.js";

type RpcMethod = (
  input: Record<string, unknown>,
  meta: { trace_uuid: string; authority: unknown },
) => Promise<{ status: number; body: Record<string, unknown> | null }>;

const logger = createLogger("orchestrator-core");

export interface UserDoSurfaceRuntimeContext {
  env: {
    AGENT_CORE?: Partial<Record<"permissionDecision" | "elicitationAnswer", RpcMethod>>;
    NANO_AGENT_DB?: D1Database;
  };
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  sessionTruth(): D1SessionTruthRepository | null;
  readDurableSnapshot(sessionUuid: string): Promise<unknown>;
  readDurableHistory(sessionUuid: string): Promise<
    Array<{
      message_uuid: string;
      turn_uuid: string | null;
      kind: string;
      body: unknown;
      created_at: string;
    }>
  >;
  requireReadableSession(sessionUuid: string): Promise<SessionEntry | null>;
  readAuditAuthSnapshot(): Promise<IngressAuthSnapshot | null>;
  persistAudit(record: AuditRecord): Promise<void>;
}

// HP5 P3-03 — row-first dual-write law (legacy compat alias).
//
// Legacy `permission/decision` and `elicitation/answer` historically
// only wrote a KV row + forwarded over RPC; HP5's confirmation
// registry needs a durable D1 row so `/sessions/{id}/confirmations`
// can list the same decision under the unified plane. Charter +
// HPX-qna Q16 fix the order as **row first**: the confirmation row
// is the source of truth, and the KV / DO storage primitive write
// is the second leg.
//
// HP5 first-wave compat lazily upserts the row on decision arrival
// (rather than on request emission, which is HP3 P3-01's full-live
// territory). When the row insertion fails, we surface the failure
// to the caller and DO NOT fall through to the legacy KV write —
// otherwise pending-list and runtime resume diverge.
//
// On second-leg (KV / RPC) failure, the row is escalated to
// `superseded` per Q16 (no `failed` status).
async function ensureConfirmationDecision(
  db: D1Database | undefined,
  args: {
    readonly session_uuid: string;
    readonly confirmation_uuid: string;
    readonly kind: ConfirmationKind;
    readonly request_payload: Record<string, unknown>;
    readonly status: ConfirmationStatus;
    readonly decision_payload: Record<string, unknown>;
    readonly created_at: string;
    readonly decided_at: string;
  },
): Promise<{ ok: true } | { ok: false; conflict: boolean }> {
  if (!db) return { ok: true };
  const plane = new D1ConfirmationControlPlane(db);
  const existing = await plane.read({
    session_uuid: args.session_uuid,
    confirmation_uuid: args.confirmation_uuid,
  });
  if (!existing) {
    await plane.create({
      confirmation_uuid: args.confirmation_uuid,
      session_uuid: args.session_uuid,
      kind: args.kind,
      payload: args.request_payload,
      created_at: args.created_at,
      expires_at: null,
    });
  }
  const result = await plane.applyDecision({
    session_uuid: args.session_uuid,
    confirmation_uuid: args.confirmation_uuid,
    status: args.status,
    decision_payload: args.decision_payload,
    decided_at: args.decided_at,
  });
  if (result.conflict) return { ok: false, conflict: true };
  return { ok: true };
}

export function createUserDoSurfaceRuntime(ctx: UserDoSurfaceRuntimeContext) {
  return {
    async refreshUserState(
      authSnapshot?: IngressAuthSnapshot,
      seed?: InitialContextSeed,
    ): Promise<void> {
      if (authSnapshot) {
        await ctx.put(USER_META_KEY, { user_uuid: authSnapshot.sub });
        await ctx.put(USER_AUTH_SNAPSHOT_KEY, authSnapshot);
      }
      if (seed) await ctx.put(USER_SEED_KEY, seed);
    },

    async requireSession(sessionUuid: string): Promise<SessionEntry | null> {
      return (await ctx.get<SessionEntry>(sessionKey(sessionUuid))) ?? null;
    },

    async enforceSessionDevice(
      sessionUuid: string,
      entry: SessionEntry,
      authSnapshot: IngressAuthSnapshot | null | undefined,
    ): Promise<SessionEntry | Response> {
      const deviceUuid =
        authSnapshot &&
        typeof authSnapshot.device_uuid === "string" &&
        authSnapshot.device_uuid.length > 0
          ? authSnapshot.device_uuid
          : null;
      if (!deviceUuid) return entry;
      if (entry.device_uuid && entry.device_uuid !== deviceUuid) {
        return jsonResponse(403, {
          error: "wrong-device",
          message: "session is bound to another device",
          session_uuid: sessionUuid,
        });
      }
      if (!entry.device_uuid) {
        const nextEntry: SessionEntry = {
          ...entry,
          device_uuid: deviceUuid,
        };
        await ctx.put(sessionKey(sessionUuid), nextEntry);
        return nextEntry;
      }
      return entry;
    },

    async sessionGateMiss(sessionUuid: string): Promise<Response> {
      const status = await ctx.sessionTruth()?.readSessionStatus(sessionUuid);
      if (status === "pending") {
        return jsonResponse(409, {
          error: "session-pending-only-start-allowed",
          message: `session ${sessionUuid} is pending; only POST /sessions/{id}/start is allowed before it transitions to active`,
          session_uuid: sessionUuid,
          current_status: "pending",
        });
      }
      if (status === "expired") {
        return jsonResponse(409, {
          error: "session-expired",
          message: `session ${sessionUuid} expired (24h pending TTL); mint a new UUID via POST /me/sessions`,
          session_uuid: sessionUuid,
          current_status: "expired",
        });
      }
      return sessionMissingResponse(sessionUuid);
    },

    async getTerminal(sessionUuid: string): Promise<SessionTerminalRecord | null> {
      return (await ctx.get<SessionTerminalRecord>(terminalKey(sessionUuid))) ?? null;
    },

    async handleUsage(sessionUuid: string): Promise<Response> {
      const entry = await ctx.requireReadableSession(sessionUuid);
      if (!entry) return this.sessionGateMiss(sessionUuid);
      const durable = await ctx.readDurableSnapshot(sessionUuid);
      const repo = ctx.sessionTruth();
      let usage: Record<string, unknown> = {
        llm_input_tokens: 0,
        llm_output_tokens: 0,
        tool_calls: 0,
        subrequest_used: 0,
        subrequest_budget: 0,
        estimated_cost_usd: 0,
      };
      const durableRecord =
        durable && typeof durable === "object" ? (durable as Record<string, unknown>) : null;
      if (repo && typeof durableRecord?.team_uuid === "string") {
        try {
          const live = await repo.readUsageSnapshot({
            session_uuid: sessionUuid,
            team_uuid: durableRecord.team_uuid,
          });
          if (live) usage = live as unknown as Record<string, unknown>;
        } catch (error) {
          logger.warn("usage-d1-read-failed", {
            code: "internal-error",
            ctx: {
              tag: "usage-d1-read-failed",
              session_uuid: sessionUuid,
              error: String(error),
            },
          });
          return jsonResponse(503, {
            ok: false,
            error: {
              code: "usage-d1-unavailable",
              status: 503,
              message: "usage ledger temporarily unavailable",
            },
          });
        }
      }
      return jsonResponse(200, {
        ok: true,
        data: {
          session_uuid: sessionUuid,
          status: entry.status,
          usage,
          last_seen_at: entry.last_seen_at,
          durable_truth: durable ?? null,
        },
      });
    },

    async handleResume(sessionUuid: string, request: Request): Promise<Response> {
      const entry = await ctx.requireReadableSession(sessionUuid);
      if (!entry) return this.sessionGateMiss(sessionUuid);
      const body = (await request.json().catch(() => ({}))) as {
        last_seen_seq?: number;
        auth_snapshot?: IngressAuthSnapshot;
      };
      const authSnapshot = isAuthSnapshot(body.auth_snapshot) ? body.auth_snapshot : null;
      const gatedEntry = await this.enforceSessionDevice(sessionUuid, entry, authSnapshot);
      if (gatedEntry instanceof Response) return gatedEntry;
      const acknowledged = gatedEntry.relay_cursor;
      const replayLost =
        typeof body.last_seen_seq === "number" && body.last_seen_seq > acknowledged;
      if (replayLost) {
        const auditAuth = authSnapshot ?? await ctx.readAuditAuthSnapshot();
        await ctx.persistAudit({
          ts: new Date().toISOString(),
          worker: "orchestrator-core",
          event_kind: "session.replay_lost",
          outcome: "failed",
          session_uuid: sessionUuid,
          trace_uuid: request.headers.get("x-trace-uuid") ?? undefined,
          team_uuid: auditAuth?.team_uuid ?? auditAuth?.tenant_uuid,
          user_uuid: auditAuth?.user_uuid ?? auditAuth?.sub,
          device_uuid: auditAuth?.device_uuid ?? gatedEntry.device_uuid ?? undefined,
          detail: {
            client_last_seen_seq: body.last_seen_seq,
            relay_cursor: acknowledged,
          },
        });
      }
      return jsonResponse(200, {
        ok: true,
        data: {
          session_uuid: sessionUuid,
          status: gatedEntry.status,
          last_phase: gatedEntry.last_phase,
          relay_cursor: acknowledged,
          replay_lost: replayLost,
        },
      });
    },

    async handlePermissionDecision(
      sessionUuid: string,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const requestUuid = body.request_uuid;
      const decision = body.decision;
      const scope = typeof body.scope === "string" ? body.scope : "once";
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (typeof requestUuid !== "string" || !uuidRe.test(requestUuid)) {
        return jsonResponse(400, {
          error: "invalid-input",
          message: "permission/decision requires a UUID request_uuid",
        });
      }
      if (
        decision !== "allow" &&
        decision !== "deny" &&
        decision !== "always_allow" &&
        decision !== "always_deny"
      ) {
        return jsonResponse(400, {
          error: "invalid-input",
          message: "decision must be allow|deny|always_allow|always_deny",
        });
      }
      const decidedAt = new Date().toISOString();

      // HP5 P3-03 — write confirmation row FIRST. `request_uuid`
      // doubles as the confirmation_uuid for legacy compat aliasing,
      // so /confirmations and /permission/decision converge on the
      // same durable truth.
      const confirmationStatus: ConfirmationStatus =
        decision === "allow" || decision === "always_allow"
          ? "allowed"
          : "denied";
      const rowResult = await ensureConfirmationDecision(ctx.env.NANO_AGENT_DB, {
        session_uuid: sessionUuid,
        confirmation_uuid: requestUuid,
        kind: "tool_permission",
        request_payload: {
          legacy_alias: "permission/decision",
          request_uuid: requestUuid,
        },
        status: confirmationStatus,
        decision_payload: { decision, scope },
        created_at: decidedAt,
        decided_at: decidedAt,
      });
      if (!rowResult.ok && rowResult.conflict) {
        return jsonResponse(409, {
          ok: false,
          error: {
            code: "confirmation-already-resolved",
            status: 409,
            message:
              "permission decision already recorded with a different terminal status",
          },
        });
      }

      await ctx.put(`permission_decision/${requestUuid}`, {
        session_uuid: sessionUuid,
        request_uuid: requestUuid,
        decision,
        scope,
        decided_at: decidedAt,
      });

      const rpcDecision = ctx.env.AGENT_CORE?.permissionDecision;
      const authority = await ctx.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
      if (typeof rpcDecision === "function" && authority) {
        try {
          await rpcDecision(
            {
              session_uuid: sessionUuid,
              request_uuid: requestUuid,
              decision,
              scope,
            },
            {
              trace_uuid: crypto.randomUUID(),
              authority,
            },
          );
        } catch (error) {
          logger.warn("permission-decision-forward-failed", {
            code: "internal-error",
            ctx: {
              tag: "permission-decision-forward-failed",
              session_uuid: sessionUuid,
              request_uuid: requestUuid,
              error: String(error),
            },
          });
        }
      }

      return jsonResponse(200, {
        ok: true,
        data: {
          request_uuid: requestUuid,
          decision,
          scope,
          confirmation_uuid: requestUuid,
          confirmation_status: confirmationStatus,
        },
      });
    },

    async handleElicitationAnswer(
      sessionUuid: string,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const requestUuid = body.request_uuid;
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (typeof requestUuid !== "string" || !uuidRe.test(requestUuid)) {
        return jsonResponse(400, {
          error: "invalid-input",
          message: "elicitation/answer requires a UUID request_uuid",
        });
      }
      const answer = body.answer;
      if (answer === undefined) {
        return jsonResponse(400, {
          error: "invalid-input",
          message: "elicitation/answer requires an answer field",
        });
      }
      const decidedAt = new Date().toISOString();
      const cancelled = body.cancelled === true;

      // HP5 P3-03 — same row-first dual-write law as permission/decision.
      // `modified` covers structured answer write-backs (Q16 frozen);
      // cancellation maps to `superseded` (Q16 forbids `failed`).
      const elicitationStatus: ConfirmationStatus = cancelled
        ? "superseded"
        : "modified";
      const rowResult = await ensureConfirmationDecision(ctx.env.NANO_AGENT_DB, {
        session_uuid: sessionUuid,
        confirmation_uuid: requestUuid,
        kind: "elicitation",
        request_payload: {
          legacy_alias: "elicitation/answer",
          request_uuid: requestUuid,
        },
        status: elicitationStatus,
        decision_payload: { answer, cancelled },
        created_at: decidedAt,
        decided_at: decidedAt,
      });
      if (!rowResult.ok && rowResult.conflict) {
        return jsonResponse(409, {
          ok: false,
          error: {
            code: "confirmation-already-resolved",
            status: 409,
            message:
              "elicitation answer already recorded with a different terminal status",
          },
        });
      }

      await ctx.put(`elicitation_answer/${requestUuid}`, {
        session_uuid: sessionUuid,
        request_uuid: requestUuid,
        answer,
        decided_at: new Date().toISOString(),
      });

      const rpc = ctx.env.AGENT_CORE?.elicitationAnswer;
      const authority = await ctx.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
      if (typeof rpc === "function" && authority) {
        try {
          await rpc(
            {
              session_uuid: sessionUuid,
              request_uuid: requestUuid,
              answer,
            },
            {
              trace_uuid: crypto.randomUUID(),
              authority,
            },
          );
        } catch (error) {
          logger.warn("elicitation-answer-forward-failed", {
            code: "internal-error",
            ctx: {
              tag: "elicitation-answer-forward-failed",
              session_uuid: sessionUuid,
              request_uuid: requestUuid,
              error: String(error),
            },
          });
        }
      }

      return jsonResponse(200, {
        ok: true,
        data: {
          request_uuid: requestUuid,
          answer,
          confirmation_uuid: requestUuid,
          confirmation_status: elicitationStatus,
        },
      });
    },

    isAllowedSessionImageUrl(sessionUuid: string, rawUrl: string): boolean {
      if (rawUrl.startsWith(`/sessions/${sessionUuid}/files/`) && rawUrl.endsWith("/content")) {
        return true;
      }
      if (rawUrl.startsWith(`nano-file://${sessionUuid}/`)) {
        return true;
      }
      try {
        const url = new URL(rawUrl);
        return (
          url.pathname.startsWith(`/sessions/${sessionUuid}/files/`) &&
          url.pathname.endsWith("/content")
        );
      } catch {
        return false;
      }
    },

    async requireAllowedModel(
      authSnapshot: IngressAuthSnapshot,
      modelId: string,
    ): Promise<Response | null> {
      const resolved = await this.resolveAllowedModel(authSnapshot, modelId);
      return resolved instanceof Response ? resolved : null;
    },

    async resolveAllowedModel(
      authSnapshot: IngressAuthSnapshot,
      modelId: string,
    ): Promise<DurableResolvedModel | Response> {
      const teamUuid = authSnapshot.team_uuid ?? authSnapshot.tenant_uuid;
      if (typeof teamUuid !== "string" || teamUuid.length === 0) {
        return jsonResponse(403, {
          error: "missing-team-claim",
          message: "team_uuid missing from auth snapshot",
        });
      }
      const db = ctx.env.NANO_AGENT_DB;
      if (!db) {
        return {
          requested_model_id: modelId,
          resolved_from_alias: false,
          model: {
            model_id: modelId,
            family: "workers-ai/unknown",
            display_name: modelId,
            context_window: 0,
            capabilities: {
              reasoning: true,
              vision: false,
              function_calling: false,
            },
            status: "active",
            aliases: [],
            max_output_tokens: null,
            effective_context_pct: null,
            auto_compact_token_limit: null,
            supported_reasoning_levels: ["low", "medium", "high"],
            input_modalities: [],
            provider_key: null,
            fallback_model_id: null,
            base_instructions_suffix: null,
            description: null,
            sort_priority: 0,
          },
        };
      }
      const repo = ctx.sessionTruth();
      const resolved = await repo?.resolveModelForTeam({
        team_uuid: teamUuid,
        model_ref: modelId,
      });
      if (!resolved) {
        const aliasRow = await db
          .prepare(
            `SELECT target_model_id
               FROM nano_model_aliases
              WHERE alias_id = ?1
              LIMIT 1`,
          )
          .bind(modelId)
          .first<{ target_model_id: string }>();
        const canonicalModelId = aliasRow?.target_model_id ?? modelId;
        const policy = await db
          .prepare(
            `SELECT allowed
               FROM nano_team_model_policy
              WHERE team_uuid = ?1
                AND model_id = ?2
              LIMIT 1`,
          )
          .bind(teamUuid, canonicalModelId)
          .first<{ allowed: number }>();
        if (policy && Number(policy.allowed) === 0) {
          return jsonResponse(403, {
            error: "model-disabled",
            message: "requested model is disabled for this team",
          });
        }
        return jsonResponse(400, {
          error: "model-unavailable",
          message: "requested model is not active",
        });
      }
      return resolved;
    },

    async handleFiles(sessionUuid: string): Promise<Response> {
      const entry = await ctx.requireReadableSession(sessionUuid);
      if (!entry) return this.sessionGateMiss(sessionUuid);

      const repo = ctx.sessionTruth();
      if (!repo) {
        return jsonResponse(200, {
          ok: true,
          action: "files",
          session_uuid: sessionUuid,
          files: [],
        });
      }
      const messages = await repo.readHistory(sessionUuid);
      const files: Array<{
        message_uuid: string;
        turn_uuid: string | null;
        message_kind: string;
        artifact_uuid: string;
        mime: string | null;
        summary: string | null;
        created_at: string;
      }> = [];
      for (const msg of messages) {
        const body = msg.body as {
          parts?: Array<{
            kind?: string;
            artifact_uuid?: string;
            mime?: string;
            summary?: string;
          }>;
        };
        if (!Array.isArray(body?.parts)) continue;
        for (const part of body.parts) {
          if (part.kind === "artifact_ref" && typeof part.artifact_uuid === "string") {
            files.push({
              message_uuid: msg.message_uuid,
              turn_uuid: msg.turn_uuid,
              message_kind: msg.kind,
              artifact_uuid: part.artifact_uuid,
              mime: typeof part.mime === "string" ? part.mime : null,
              summary: typeof part.summary === "string" ? part.summary : null,
              created_at: msg.created_at,
            });
          }
        }
      }
      return jsonResponse(200, {
        ok: true,
        action: "files",
        session_uuid: sessionUuid,
        files,
      });
    },

    async handlePolicyPermissionMode(
      sessionUuid: string,
      body: Record<string, unknown>,
    ): Promise<Response> {
      const mode = body.mode;
      if (
        mode !== "auto-allow" &&
        mode !== "ask" &&
        mode !== "deny" &&
        mode !== "always_allow"
      ) {
        return jsonResponse(400, {
          error: "invalid-input",
          message: "mode must be auto-allow|ask|deny|always_allow",
        });
      }
      await ctx.put(`permission_mode/${sessionUuid}`, {
        session_uuid: sessionUuid,
        mode,
        set_at: new Date().toISOString(),
      });
      return jsonResponse(200, {
        ok: true,
        data: { session_uuid: sessionUuid, mode },
      });
    },

    async handleMeSessions(): Promise<Response> {
      const conversations =
        (await ctx.get<ConversationIndexItem[]>(CONVERSATION_INDEX_KEY)) ?? [];
      type Item = {
        conversation_uuid: string;
        session_uuid: string;
        status: string;
        last_phase: string | null;
        last_seen_at: string;
        created_at: string | null;
        ended_at: string | null;
      };
      const bySessionUuid = new Map<string, Item>();
      for (const conv of conversations) {
        const entry = await ctx.get<SessionEntry>(sessionKey(conv.latest_session_uuid));
        bySessionUuid.set(conv.latest_session_uuid, {
          conversation_uuid: conv.conversation_uuid,
          session_uuid: conv.latest_session_uuid,
          status: entry?.status ?? conv.status,
          last_phase: entry?.last_phase ?? null,
          last_seen_at: entry?.last_seen_at ?? conv.updated_at,
          created_at: entry?.created_at ?? null,
          ended_at: entry?.ended_at ?? null,
        });
      }

      const repo = ctx.sessionTruth();
      const authority = await ctx.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY);
      if (repo && authority) {
        const teamUuid = authority.team_uuid ?? authority.tenant_uuid;
        const actorUserUuid = authority.user_uuid ?? authority.sub;
        if (typeof teamUuid === "string" && teamUuid.length > 0) {
          try {
            const rows = await repo.listSessionsForUser({
              team_uuid: teamUuid,
              actor_user_uuid: actorUserUuid,
              limit: 50,
            });
            for (const row of rows) {
              const existing = bySessionUuid.get(row.session_uuid);
              bySessionUuid.set(row.session_uuid, {
                conversation_uuid: row.conversation_uuid,
                session_uuid: row.session_uuid,
                status: row.session_status,
                last_phase: row.last_phase ?? existing?.last_phase ?? null,
                last_seen_at: existing?.last_seen_at ?? row.started_at,
                created_at: row.started_at,
                ended_at: row.ended_at ?? existing?.ended_at ?? null,
              });
            }
          } catch (error) {
            logger.warn("me-sessions-d1-merge-failed", {
              code: "internal-error",
              ctx: { tag: "me-sessions-d1-merge-failed", error: String(error) },
            });
          }
        }
      }

      const items = Array.from(bySessionUuid.values()).sort((a, b) =>
        (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? ""),
      );
      return jsonResponse(200, {
        ok: true,
        data: { sessions: items, next_cursor: null },
      });
    },

    async handleMeConversations(
      limit: number,
      headerAuthority?: IngressAuthSnapshot | null,
    ): Promise<Response> {
      const repo = ctx.sessionTruth();
      const authority =
        headerAuthority ?? (await ctx.get<IngressAuthSnapshot>(USER_AUTH_SNAPSHOT_KEY));
      if (!repo || !authority) {
        return jsonResponse(200, {
          ok: true,
          data: { conversations: [], next_cursor: null },
        });
      }
      const teamUuid = authority.team_uuid ?? authority.tenant_uuid;
      const actorUserUuid = authority.user_uuid ?? authority.sub;
      if (typeof teamUuid !== "string" || teamUuid.length === 0) {
        return jsonResponse(200, {
          ok: true,
          data: { conversations: [], next_cursor: null },
        });
      }

      type Conversation = {
        conversation_uuid: string;
        latest_session_uuid: string;
        latest_status: string;
        started_at: string;
        latest_session_started_at: string;
        last_seen_at: string;
        last_phase: string | null;
        session_count: number;
      };

      let rows: Awaited<ReturnType<typeof repo.listSessionsForUser>> = [];
      try {
        rows = await repo.listSessionsForUser({
          team_uuid: teamUuid,
          actor_user_uuid: actorUserUuid,
          limit: 200,
        });
      } catch (error) {
        logger.warn("me-conversations-d1-read-failed", {
          code: "internal-error",
          ctx: { tag: "me-conversations-d1-read-failed", error: String(error) },
        });
        return jsonResponse(200, {
          ok: true,
          data: { conversations: [], next_cursor: null },
        });
      }

      const byConv = new Map<string, Conversation>();
      for (const row of rows) {
        const existing = byConv.get(row.conversation_uuid);
        if (!existing) {
          byConv.set(row.conversation_uuid, {
            conversation_uuid: row.conversation_uuid,
            latest_session_uuid: row.session_uuid,
            latest_status: row.session_status,
            started_at: row.started_at,
            latest_session_started_at: row.started_at,
            last_seen_at: row.started_at,
            last_phase: row.last_phase ?? null,
            session_count: 1,
          });
          continue;
        }
        existing.session_count += 1;
        if (row.started_at < existing.started_at) {
          existing.started_at = row.started_at;
        }
      }

      const conversations = Array.from(byConv.values())
        .sort((a, b) =>
          b.latest_session_started_at.localeCompare(a.latest_session_started_at),
        )
        .slice(0, limit);

      return jsonResponse(200, {
        ok: true,
        data: { conversations, next_cursor: null },
      });
    },
  };
}
