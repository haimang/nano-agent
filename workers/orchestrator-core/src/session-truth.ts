import { redactPayload } from "@haimang/nacp-session";
import type { ReasoningEffort } from "./session-lifecycle.js";

// ZX4 P3-02 — extended per R1 status enum 冻结表; mirrors migration 006
// CHECK + session-lifecycle SessionStatus + read-model 5-state view.
export type DurableSessionStatus =
  | "pending"
  | "starting"
  | "active"
  | "detached"
  | "ended"
  | "expired";
export type DurableTurnKind = "start" | "followup" | "cancel";
export type DurableTurnStatus = "accepted" | "completed" | "cancelled" | "failed";
export type DurableMessageRole = "user" | "assistant" | "system";

export interface DurableSessionPointer {
  readonly conversation_uuid: string;
  readonly session_uuid: string;
  readonly conversation_created: boolean;
}

export interface DurableTurnPointer {
  readonly turn_uuid: string;
  readonly turn_index: number;
}

export interface DurableHistoryMessage {
  readonly message_uuid: string;
  readonly turn_uuid: string | null;
  readonly trace_uuid: string;
  readonly role: DurableMessageRole;
  readonly kind: string;
  readonly body: Record<string, unknown>;
  readonly created_at: string;
}

export interface DurableSessionSnapshot {
  readonly conversation_uuid: string;
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly actor_user_uuid: string;
  readonly trace_uuid: string;
  readonly session_status: DurableSessionStatus;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly last_phase: string | null;
  readonly last_event_seq: number;
  readonly message_count: number;
  readonly activity_count: number;
  readonly latest_turn_uuid: string | null;
}

export interface DurableSessionLifecycleRecord {
  readonly conversation_uuid: string;
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly actor_user_uuid: string;
  readonly session_status: DurableSessionStatus;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly ended_reason: string | null;
  readonly last_phase: string | null;
  readonly default_model_id: string | null;
  readonly default_reasoning_effort: ReasoningEffort | null;
  readonly title: string | null;
  readonly deleted_at: string | null;
}

export interface DurableModelCatalogItem {
  readonly model_id: string;
  readonly family: string;
  readonly display_name: string;
  readonly context_window: number;
  readonly capabilities: {
    readonly reasoning: boolean;
    readonly vision: boolean;
    readonly function_calling: boolean;
  };
  readonly status: string;
  readonly aliases: ReadonlyArray<string>;
}

export interface DurableModelDetail extends DurableModelCatalogItem {
  readonly max_output_tokens: number | null;
  readonly effective_context_pct: number | null;
  readonly auto_compact_token_limit: number | null;
  readonly supported_reasoning_levels: ReadonlyArray<ReasoningEffort>;
  readonly input_modalities: ReadonlyArray<string>;
  readonly provider_key: string | null;
  readonly fallback_model_id: string | null;
  readonly base_instructions_suffix: string | null;
  readonly description: string | null;
  readonly sort_priority: number;
}

export interface DurableResolvedModel {
  readonly requested_model_id: string;
  readonly resolved_from_alias: boolean;
  readonly model: DurableModelDetail;
}

export interface DurableLatestTurnModelAudit {
  readonly turn_uuid: string;
  readonly created_at: string;
  readonly requested_model_id: string | null;
  readonly requested_reasoning_effort: ReasoningEffort | null;
  readonly effective_model_id: string | null;
  readonly effective_reasoning_effort: ReasoningEffort | null;
  readonly fallback_used: boolean;
  readonly fallback_reason: string | null;
}

export interface DurableSessionModelState {
  readonly conversation_uuid: string;
  readonly session_uuid: string;
  readonly session_status: DurableSessionStatus;
  readonly deleted_at: string | null;
  readonly default_model_id: string | null;
  readonly default_reasoning_effort: ReasoningEffort | null;
  readonly effective_default_model_id: string | null;
  readonly effective_default_reasoning_effort: ReasoningEffort | null;
  readonly source: "session" | "global";
  readonly last_turn: DurableLatestTurnModelAudit | null;
}

export interface DurableConversationListItem {
  readonly conversation_uuid: string;
  readonly title: string | null;
  readonly started_at: string;
  readonly latest_session_uuid: string;
  readonly latest_status: DurableSessionStatus;
  readonly latest_session_started_at: string;
  readonly last_seen_at: string;
  readonly last_phase: string | null;
  readonly latest_ended_reason: string | null;
  readonly session_count: number;
}

export interface DurableConversationDetail {
  readonly conversation_uuid: string;
  readonly team_uuid: string;
  readonly owner_user_uuid: string;
  readonly title: string | null;
  readonly conversation_status: string;
  readonly deleted_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly latest_session_uuid: string | null;
  readonly latest_turn_uuid: string | null;
  readonly session_count: number;
  readonly latest_session: {
    readonly session_uuid: string;
    readonly session_status: DurableSessionStatus;
    readonly started_at: string;
    readonly ended_at: string | null;
    readonly ended_reason: string | null;
    readonly last_phase: string | null;
  } | null;
  readonly sessions: ReadonlyArray<{
    readonly session_uuid: string;
    readonly session_status: DurableSessionStatus;
    readonly started_at: string;
    readonly ended_at: string | null;
    readonly ended_reason: string | null;
    readonly last_phase: string | null;
  }>;
}

export interface DurableCheckpointListItem {
  readonly checkpoint_uuid: string;
  readonly session_uuid: string;
  readonly conversation_uuid: string;
  readonly team_uuid: string;
  readonly turn_uuid: string | null;
  readonly turn_attempt: number | null;
  readonly checkpoint_kind: string;
  readonly label: string | null;
  readonly message_high_watermark: string | null;
  readonly latest_event_seq: number | null;
  readonly context_snapshot_uuid: string | null;
  readonly file_snapshot_status: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly expires_at: string | null;
}

export interface DurableCheckpointDiff {
  readonly checkpoint: DurableCheckpointListItem;
  readonly watermark_created_at: string | null;
  readonly messages_since_checkpoint: ReadonlyArray<{
    readonly message_uuid: string;
    readonly turn_uuid: string | null;
    readonly message_kind: string;
    readonly created_at: string;
    readonly superseded_at: string | null;
  }>;
  readonly superseded_messages: ReadonlyArray<{
    readonly message_uuid: string;
    readonly turn_uuid: string | null;
    readonly message_kind: string;
    readonly created_at: string;
    readonly superseded_at: string;
    readonly superseded_by_turn_attempt: number | null;
  }>;
}

const MESSAGE_REDACTION_FIELDS = [
  "access_token",
  "refresh_token",
  "authority",
  "auth_snapshot",
  "password",
  "secret",
  "openid",
  "unionid",
] as const;

const MAX_ACTIVITY_PAYLOAD_BYTES = 8 * 1024;
const UNIQUE_RETRY_LIMIT = 3;

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && Number.isFinite(Number(value))
      ? Number(value)
      : 0;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toNullableInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function parseReasoningLevels(value: unknown): ReasoningEffort[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (level): level is ReasoningEffort => level === "low" || level === "medium" || level === "high",
    );
  } catch {
    return [];
  }
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toNullableReasoningEffort(value: unknown): ReasoningEffort | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function toBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function inferMessageRole(kind: string): DurableMessageRole {
  if (
    kind.startsWith("llm.") ||
    kind === "assistant.message" ||
    kind === "tool.call.result"
  ) {
    return "assistant";
  }
  return kind.startsWith("user.input") ? "user" : "system";
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /unique/i.test(error.message) &&
    /constraint/i.test(error.message)
  );
}

function sanitizeMessagePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return redactPayload(payload, [...MESSAGE_REDACTION_FIELDS]);
}

function serializeActivityPayload(payload: Record<string, unknown>): string {
  const serialized = JSON.stringify(payload);
  const size = new TextEncoder().encode(serialized).byteLength;
  if (size <= MAX_ACTIVITY_PAYLOAD_BYTES) return serialized;
  return JSON.stringify({
    truncated: true,
    original_bytes: size,
    preserved_keys: Object.keys(payload).slice(0, 32),
  });
}

export class D1SessionTruthRepository {
  constructor(private readonly db: D1Database) {}

  private async readAliasesByTarget(
    targetModelIds: readonly string[],
  ): Promise<Map<string, string[]>> {
    const aliasRows = await this.db.prepare(
      `SELECT alias_id, target_model_id
         FROM nano_model_aliases`,
    ).all<Record<string, unknown>>();
    const targetSet = new Set(targetModelIds);
    const aliases = new Map<string, string[]>();
    for (const row of aliasRows.results ?? []) {
      const targetModelId = toNullableString(row.target_model_id);
      const aliasId = toNullableString(row.alias_id);
      if (!targetModelId || !aliasId || !targetSet.has(targetModelId)) continue;
      const next = aliases.get(targetModelId) ?? [];
      next.push(aliasId);
      aliases.set(targetModelId, next);
    }
    for (const value of aliases.values()) value.sort((a, b) => a.localeCompare(b));
    return aliases;
  }

  private toModelCatalogItem(
    row: Record<string, unknown>,
    aliases: readonly string[],
  ): DurableModelCatalogItem {
    return {
      model_id: String(row.model_id),
      family: String(row.family),
      display_name: String(row.display_name),
      context_window: toCount(row.context_window),
      capabilities: {
        reasoning: toBooleanFlag(row.is_reasoning),
        vision: toBooleanFlag(row.is_vision),
        function_calling: toBooleanFlag(row.is_function_calling),
      },
      status: String(row.status),
      aliases,
    };
  }

  private toModelDetail(
    row: Record<string, unknown>,
    aliases: readonly string[],
  ): DurableModelDetail {
    return {
      ...this.toModelCatalogItem(row, aliases),
      max_output_tokens: toNullableInt(row.max_output_tokens),
      effective_context_pct:
        typeof row.effective_context_pct === "number" && Number.isFinite(row.effective_context_pct)
          ? row.effective_context_pct
          : typeof row.effective_context_pct === "string" &&
              row.effective_context_pct.length > 0 &&
              Number.isFinite(Number(row.effective_context_pct))
            ? Number(row.effective_context_pct)
            : null,
      auto_compact_token_limit: toNullableInt(row.auto_compact_token_limit),
      supported_reasoning_levels: parseReasoningLevels(row.supported_reasoning_levels),
      input_modalities: parseStringArray(row.input_modalities),
      provider_key: toNullableString(row.provider_key),
      fallback_model_id: toNullableString(row.fallback_model_id),
      base_instructions_suffix: toNullableString(row.base_instructions_suffix),
      description: toNullableString(row.description),
      sort_priority: toCount(row.sort_priority),
    };
  }

  async listActiveModelsForTeam(team_uuid: string): Promise<ReadonlyArray<DurableModelCatalogItem>> {
    const [modelsRes, policyRes] = await Promise.all([
      this.db.prepare(
        `SELECT
           model_id,
           family,
           display_name,
           context_window,
           is_reasoning,
           is_vision,
           is_function_calling,
           status,
           sort_priority
          FROM nano_models
         WHERE status = 'active'
         ORDER BY COALESCE(sort_priority, 0) DESC, model_id ASC`,
      ).all<Record<string, unknown>>(),
      this.db.prepare(
        `SELECT model_id, allowed
           FROM nano_team_model_policy
          WHERE team_uuid = ?1`,
      ).bind(team_uuid).all<Record<string, unknown>>(),
    ]);
    const denied = new Set(
      (policyRes.results ?? [])
        .filter((row) => Number(row.allowed) === 0)
        .map((row) => String(row.model_id)),
    );
    const rows = (modelsRes.results ?? []).filter((row) => !denied.has(String(row.model_id)));
    const aliases = await this.readAliasesByTarget(rows.map((row) => String(row.model_id)));
    return rows.map((row) => this.toModelCatalogItem(row, aliases.get(String(row.model_id)) ?? []));
  }

  async resolveModelForTeam(input: {
    readonly team_uuid: string;
    readonly model_ref: string;
  }): Promise<DurableResolvedModel | null> {
    const aliasRow = await this.db.prepare(
      `SELECT target_model_id
         FROM nano_model_aliases
        WHERE alias_id = ?1
        LIMIT 1`,
    ).bind(input.model_ref).first<Record<string, unknown>>();
    const resolvedModelId = toNullableString(aliasRow?.target_model_id) ?? input.model_ref;
    const row = await this.db.prepare(
      `SELECT
         model_id,
         family,
         display_name,
         context_window,
         is_reasoning,
         is_vision,
         is_function_calling,
         status,
         max_output_tokens,
         effective_context_pct,
         auto_compact_token_limit,
         supported_reasoning_levels,
         input_modalities,
         provider_key,
         fallback_model_id,
         base_instructions_suffix,
         description,
         sort_priority
        FROM nano_models
       WHERE model_id = ?1
       LIMIT 1`,
    ).bind(resolvedModelId).first<Record<string, unknown>>();
    if (!row || row.status !== "active") return null;
    const policy = await this.db.prepare(
      `SELECT allowed
         FROM nano_team_model_policy
        WHERE team_uuid = ?1
          AND model_id = ?2
        LIMIT 1`,
    ).bind(input.team_uuid, resolvedModelId).first<Record<string, unknown>>();
    if (policy && Number(policy.allowed) === 0) return null;
    const aliases = await this.readAliasesByTarget([resolvedModelId]);
    return {
      requested_model_id: input.model_ref,
      resolved_from_alias: resolvedModelId !== input.model_ref,
      model: this.toModelDetail(row, aliases.get(resolvedModelId) ?? []),
    };
  }

  async readGlobalDefaultModelForTeam(team_uuid: string): Promise<DurableModelDetail | null> {
    const models = await this.listActiveModelsForTeam(team_uuid);
    const first = models[0];
    if (!first) return null;
    const resolved = await this.resolveModelForTeam({
      team_uuid,
      model_ref: first.model_id,
    });
    return resolved?.model ?? null;
  }

  async updateSessionModelDefaults(input: {
    readonly session_uuid: string;
    readonly default_model_id: string | null;
    readonly default_reasoning_effort: ReasoningEffort | null;
  }): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_conversation_sessions
          SET default_model_id = ?2,
              default_reasoning_effort = ?3
        WHERE session_uuid = ?1`,
    ).bind(
      input.session_uuid,
      input.default_model_id,
      input.default_reasoning_effort,
    ).run();
  }

  async readLatestTurnModelAudit(session_uuid: string): Promise<DurableLatestTurnModelAudit | null> {
    const row = await this.db.prepare(
      `SELECT
         turn_uuid,
         created_at,
         requested_model_id,
         requested_reasoning_effort,
         effective_model_id,
         effective_reasoning_effort,
         fallback_used,
         fallback_reason
        FROM nano_conversation_turns
       WHERE session_uuid = ?1
         AND (
           requested_model_id IS NOT NULL
           OR effective_model_id IS NOT NULL
           OR fallback_used = 1
           OR fallback_reason IS NOT NULL
         )
       ORDER BY created_at DESC, turn_index DESC, turn_attempt DESC
       LIMIT 1`,
    ).bind(session_uuid).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      turn_uuid: String(row.turn_uuid),
      created_at: String(row.created_at),
      requested_model_id: toNullableString(row.requested_model_id),
      requested_reasoning_effort: toNullableReasoningEffort(row.requested_reasoning_effort),
      effective_model_id: toNullableString(row.effective_model_id),
      effective_reasoning_effort: toNullableReasoningEffort(row.effective_reasoning_effort),
      fallback_used: toBooleanFlag(row.fallback_used),
      fallback_reason: toNullableString(row.fallback_reason),
    };
  }

  async readSessionModelState(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
  }): Promise<DurableSessionModelState | null> {
    const session = await this.readSessionLifecycle(input.session_uuid);
    if (
      !session ||
      session.team_uuid !== input.team_uuid ||
      session.actor_user_uuid !== input.actor_user_uuid
    ) {
      return null;
    }
    const [lastTurn, globalDefault] = await Promise.all([
      this.readLatestTurnModelAudit(input.session_uuid),
      this.readGlobalDefaultModelForTeam(input.team_uuid),
    ]);
    return {
      conversation_uuid: session.conversation_uuid,
      session_uuid: session.session_uuid,
      session_status: session.session_status,
      deleted_at: session.deleted_at,
      default_model_id: session.default_model_id,
      default_reasoning_effort: session.default_reasoning_effort,
      effective_default_model_id: session.default_model_id ?? globalDefault?.model_id ?? null,
      effective_default_reasoning_effort:
        session.default_model_id ? session.default_reasoning_effort : null,
      source: session.default_model_id ? "session" : "global",
      last_turn: lastTurn,
    };
  }

  private buildAppendMessageStatement(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly trace_uuid: string;
    readonly turn_uuid: string | null;
    readonly role: DurableMessageRole;
    readonly kind: string;
    readonly event_seq: number | null;
    readonly body: Record<string, unknown>;
    readonly created_at: string;
  }): D1PreparedStatement {
    return this.db.prepare(
      `INSERT INTO nano_conversation_messages (
         message_uuid,
         conversation_uuid,
         session_uuid,
         turn_uuid,
         team_uuid,
         trace_uuid,
         message_role,
         message_kind,
         body_json,
         created_at,
         event_seq
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).bind(
      crypto.randomUUID(),
      input.conversation_uuid,
      input.session_uuid,
      input.turn_uuid,
      input.team_uuid,
      input.trace_uuid,
      input.role,
      input.kind,
      JSON.stringify(sanitizeMessagePayload(input.body)),
      input.created_at,
      input.event_seq,
    );
  }

  // ZX4 P3-03 — POST /me/sessions mint path. Atomically writes a fresh
  // `nano_conversations` row + a pending `nano_conversation_sessions` row
  // so the schema NOT NULL FK is satisfied (per ZX4 plan §1.3 R10).
  // The pair becomes the single source of truth for "this UUID was minted
  // but not yet started"; alarm GC picks them up after 24h via P3-04.
  async mintPendingSession(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
    readonly trace_uuid: string;
    readonly minted_at: string;
  }): Promise<DurableSessionPointer> {
    const conversation_uuid = crypto.randomUUID();
    await this.db.batch([
      this.db.prepare(
        `INSERT INTO nano_conversations (
           conversation_uuid,
           team_uuid,
           owner_user_uuid,
           conversation_status,
           created_at,
           updated_at,
           latest_session_uuid,
           latest_turn_uuid,
           title
         ) VALUES (?1, ?2, ?3, 'active', ?4, ?4, ?5, NULL, NULL)`,
      ).bind(
        conversation_uuid,
        input.team_uuid,
        input.actor_user_uuid,
        input.minted_at,
        input.session_uuid,
      ),
      this.db.prepare(
        `INSERT INTO nano_conversation_sessions (
           session_uuid,
           conversation_uuid,
           team_uuid,
           actor_user_uuid,
           trace_uuid,
           session_status,
           started_at,
           ended_at,
           last_phase,
           last_event_seq
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, NULL, NULL, 0)`,
      ).bind(
        input.session_uuid,
        conversation_uuid,
        input.team_uuid,
        input.actor_user_uuid,
        input.trace_uuid,
        input.minted_at,
      ),
    ]);
    return {
      conversation_uuid,
      session_uuid: input.session_uuid,
      conversation_created: true,
    };
  }

  // ZX4 P3-04 — alarm GC: mark pending rows older than ttlMs as 'expired'
  // and delete their orphan conversation rows in one batch. Returns the
  // number of session rows that flipped to 'expired' for telemetry.
  async expireStalePending(input: {
    readonly now: string;
    readonly cutoff: string; // ISO timestamp; sessions with started_at < cutoff get expired
  }): Promise<number> {
    const stale = await this.db.prepare(
      `SELECT session_uuid, conversation_uuid
         FROM nano_conversation_sessions
        WHERE session_status = 'pending'
          AND started_at < ?1
        LIMIT 200`,
    ).bind(input.cutoff).all<Record<string, unknown>>();
    const rows = stale.results ?? [];
    if (rows.length === 0) return 0;
    const stmts: D1PreparedStatement[] = [];
    for (const row of rows) {
      const sessionUuid = String(row.session_uuid);
      const conversationUuid = String(row.conversation_uuid);
      stmts.push(
        this.db.prepare(
          `UPDATE nano_conversation_sessions
              SET session_status = 'expired',
                  ended_at = ?2
            WHERE session_uuid = ?1
              AND session_status = 'pending'`,
        ).bind(sessionUuid, input.now),
      );
      // Conversation orphan cleanup: only delete if no non-expired session
      // ever attached. Using NOT EXISTS on the post-update state keeps the
      // batch idempotent.
      stmts.push(
        this.db.prepare(
          `DELETE FROM nano_conversations
            WHERE conversation_uuid = ?1
              AND NOT EXISTS (
                SELECT 1 FROM nano_conversation_sessions
                 WHERE conversation_uuid = ?1
                   AND session_status NOT IN ('pending', 'expired')
                 LIMIT 1
              )`,
        ).bind(conversationUuid),
      );
    }
    await this.db.batch(stmts);
    return rows.length;
  }

  // ZX5 F4 — handleStart idempotency: atomic D1 UPDATE that claims a
  // pending row only if it's still pending. Returns true exactly once
  // even under concurrent retries (per Q11 owner-frozen修法 b: D1
  // conditional UPDATE,no client-side cache). Caller treats false as
  // "another request already claimed,respond 409".
  //
  // ZX5 review (deepseek R8 low-priority deferred): Q11(b) literal原文 also
  // includes `AND started_at = :minted_at`. In the current scenario this is
  // functionally equivalent (started_at is stamped at mint and immutable for
  // pending rows; only one row exists per session_uuid because session_uuid
  // is a UUIDv4 minted by /me/sessions). The extra guard would protect against
  // a future hypothetical "expire+remint same UUID" path which is not on the
  // current product roadmap. Tracked as residual; not enforced here to avoid
  // an unnecessary extra D1 read trip per /start.
  async claimPendingForStart(session_uuid: string): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE nano_conversation_sessions
          SET session_status = 'starting'
        WHERE session_uuid = ?1
          AND session_status = 'pending'`,
    ).bind(session_uuid).run();
    return (result.meta?.changes ?? 0) > 0;
  }

  // ZX4 P3-07 — ingress guard support: cheap point lookup of session_status
  // when the KV entry is missing, so handlers can distinguish pending /
  // expired / ended / not-found without hydrating the full snapshot.
  async readSessionStatus(session_uuid: string): Promise<DurableSessionStatus | null> {
    const row = await this.db.prepare(
      `SELECT session_status
         FROM nano_conversation_sessions
        WHERE session_uuid = ?1
        LIMIT 1`,
    ).bind(session_uuid).first<Record<string, unknown>>();
    if (!row) return null;
    return String(row.session_status) as DurableSessionStatus;
  }

  async readSessionLifecycle(session_uuid: string): Promise<DurableSessionLifecycleRecord | null> {
    const row = await this.db.prepare(
      `SELECT
         s.conversation_uuid,
         s.session_uuid,
         s.team_uuid,
         s.actor_user_uuid,
         s.session_status,
         s.started_at,
         s.ended_at,
         s.ended_reason,
         s.last_phase,
         s.default_model_id,
         s.default_reasoning_effort,
         c.title,
         c.deleted_at
        FROM nano_conversation_sessions s
       JOIN nano_conversations c
         ON c.conversation_uuid = s.conversation_uuid
      WHERE s.session_uuid = ?1
      LIMIT 1`,
    ).bind(session_uuid).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      conversation_uuid: String(row.conversation_uuid),
      session_uuid: String(row.session_uuid),
      team_uuid: String(row.team_uuid),
      actor_user_uuid: String(row.actor_user_uuid),
      session_status: String(row.session_status) as DurableSessionStatus,
      started_at: String(row.started_at),
      ended_at: toNullableString(row.ended_at),
      ended_reason: toNullableString(row.ended_reason),
      last_phase: toNullableString(row.last_phase),
      default_model_id: toNullableString(row.default_model_id),
      default_reasoning_effort: toNullableReasoningEffort(row.default_reasoning_effort),
      title: toNullableString(row.title),
      deleted_at: toNullableString(row.deleted_at),
    };
  }

  // ZX4 P3-05 — read-model 5-state view: list this user's recent sessions
  // (across pending/active/detached/ended/expired) joined with conversation
  // metadata. Pending sessions don't have a hot-index entry, so this read
  // path is the only way GET /me/sessions can surface them.
  async listSessionsForUser(input: {
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
    readonly limit?: number;
    readonly cursor?: {
      readonly started_at: string;
      readonly session_uuid: string;
    } | null;
    readonly include_deleted?: boolean;
  }): Promise<Array<{
    readonly conversation_uuid: string;
    readonly session_uuid: string;
    readonly session_status: DurableSessionStatus;
    readonly started_at: string;
    readonly ended_at: string | null;
    readonly last_phase: string | null;
    readonly ended_reason: string | null;
    readonly title: string | null;
    readonly deleted_at: string | null;
  }>> {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const cursor = input.cursor ?? null;
    const rows = await this.db.prepare(
      `SELECT
         s.session_uuid,
         s.conversation_uuid,
         s.session_status,
         s.started_at,
         s.ended_at,
         s.ended_reason,
         s.last_phase,
         c.title,
         c.deleted_at
       FROM nano_conversation_sessions s
       JOIN nano_conversations c
         ON c.conversation_uuid = s.conversation_uuid
      WHERE s.team_uuid = ?1
        AND s.actor_user_uuid = ?2
        AND (?3 = 1 OR c.deleted_at IS NULL)
        AND (
          ?4 IS NULL
          OR s.started_at < ?4
          OR (s.started_at = ?4 AND s.session_uuid < ?5)
        )
      ORDER BY s.started_at DESC, s.session_uuid DESC
      LIMIT ?6`,
    ).bind(
      input.team_uuid,
      input.actor_user_uuid,
      input.include_deleted ? 1 : 0,
      cursor?.started_at ?? null,
      cursor?.session_uuid ?? null,
      limit,
    ).all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({
      conversation_uuid: String(row.conversation_uuid),
      session_uuid: String(row.session_uuid),
      session_status: String(row.session_status) as DurableSessionStatus,
      started_at: String(row.started_at),
      ended_at: toNullableString(row.ended_at),
      last_phase: toNullableString(row.last_phase),
      ended_reason: toNullableString(row.ended_reason),
      title: toNullableString(row.title),
      deleted_at: toNullableString(row.deleted_at),
    }));
  }

  async listConversationsForUser(input: {
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
    readonly limit?: number;
    readonly cursor?: {
      readonly latest_session_started_at: string;
      readonly conversation_uuid: string;
    } | null;
    readonly include_deleted?: boolean;
  }): Promise<DurableConversationListItem[]> {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const cursor = input.cursor ?? null;
    const rows = await this.db.prepare(
      `SELECT
         c.conversation_uuid,
         c.title,
         (
           SELECT MIN(s3.started_at)
             FROM nano_conversation_sessions s3
            WHERE s3.conversation_uuid = c.conversation_uuid
         ) AS started_at,
         (
           SELECT s2.session_uuid
             FROM nano_conversation_sessions s2
            WHERE s2.conversation_uuid = c.conversation_uuid
            ORDER BY s2.started_at DESC, s2.session_uuid DESC
            LIMIT 1
         ) AS latest_session_uuid,
         (
           SELECT s2.session_status
             FROM nano_conversation_sessions s2
            WHERE s2.conversation_uuid = c.conversation_uuid
            ORDER BY s2.started_at DESC, s2.session_uuid DESC
            LIMIT 1
         ) AS latest_status,
         (
           SELECT s2.started_at
             FROM nano_conversation_sessions s2
            WHERE s2.conversation_uuid = c.conversation_uuid
            ORDER BY s2.started_at DESC, s2.session_uuid DESC
            LIMIT 1
         ) AS latest_session_started_at,
         (
           SELECT s2.last_phase
             FROM nano_conversation_sessions s2
            WHERE s2.conversation_uuid = c.conversation_uuid
            ORDER BY s2.started_at DESC, s2.session_uuid DESC
            LIMIT 1
         ) AS last_phase,
         (
           SELECT s2.ended_reason
             FROM nano_conversation_sessions s2
            WHERE s2.conversation_uuid = c.conversation_uuid
            ORDER BY s2.started_at DESC, s2.session_uuid DESC
            LIMIT 1
         ) AS latest_ended_reason,
         (
           SELECT COUNT(*)
             FROM nano_conversation_sessions s4
            WHERE s4.conversation_uuid = c.conversation_uuid
         ) AS session_count
       FROM nano_conversations c
      WHERE c.team_uuid = ?1
        AND c.owner_user_uuid = ?2
        AND EXISTS (
          SELECT 1
            FROM nano_conversation_sessions s
           WHERE s.conversation_uuid = c.conversation_uuid
             AND s.actor_user_uuid = ?2
           LIMIT 1
        )
        AND (?3 = 1 OR c.deleted_at IS NULL)
        AND (
          ?4 IS NULL
          OR (
            (
              SELECT s2.started_at
                FROM nano_conversation_sessions s2
               WHERE s2.conversation_uuid = c.conversation_uuid
               ORDER BY s2.started_at DESC, s2.session_uuid DESC
               LIMIT 1
            ) < ?4
          )
          OR (
            (
              SELECT s2.started_at
                FROM nano_conversation_sessions s2
               WHERE s2.conversation_uuid = c.conversation_uuid
               ORDER BY s2.started_at DESC, s2.session_uuid DESC
               LIMIT 1
            ) = ?4
            AND c.conversation_uuid < ?5
          )
        )
      ORDER BY latest_session_started_at DESC, c.conversation_uuid DESC
      LIMIT ?6`,
    ).bind(
      input.team_uuid,
      input.actor_user_uuid,
      input.include_deleted ? 1 : 0,
      cursor?.latest_session_started_at ?? null,
      cursor?.conversation_uuid ?? null,
      limit,
    ).all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({
      conversation_uuid: String(row.conversation_uuid),
      title: toNullableString(row.title),
      started_at: String(row.started_at),
      latest_session_uuid: String(row.latest_session_uuid),
      latest_status: String(row.latest_status) as DurableSessionStatus,
      latest_session_started_at: String(row.latest_session_started_at),
      last_seen_at: String(row.latest_session_started_at),
      last_phase: toNullableString(row.last_phase),
      latest_ended_reason: toNullableString(row.latest_ended_reason),
      session_count: toCount(row.session_count),
    }));
  }

  async readConversationDetail(input: {
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
    readonly include_deleted?: boolean;
  }): Promise<DurableConversationDetail | null> {
    const row = await this.db.prepare(
      `SELECT
         c.conversation_uuid,
         c.team_uuid,
         c.owner_user_uuid,
         c.conversation_status,
         c.title,
         c.deleted_at,
         c.created_at,
         c.updated_at,
         c.latest_session_uuid,
         c.latest_turn_uuid,
         (
           SELECT COUNT(*)
             FROM nano_conversation_sessions s
            WHERE s.conversation_uuid = c.conversation_uuid
         ) AS session_count
       FROM nano_conversations c
      WHERE c.conversation_uuid = ?1
        AND c.team_uuid = ?2
        AND EXISTS (
          SELECT 1
            FROM nano_conversation_sessions s
           WHERE s.conversation_uuid = c.conversation_uuid
             AND s.actor_user_uuid = ?3
           LIMIT 1
        )
        AND (?4 = 1 OR c.deleted_at IS NULL)
      LIMIT 1`,
    ).bind(
      input.conversation_uuid,
      input.team_uuid,
      input.actor_user_uuid,
      input.include_deleted ? 1 : 0,
    ).first<Record<string, unknown>>();
    if (!row) return null;
    const sessionRows = await this.db.prepare(
      `SELECT
         session_uuid,
         session_status,
         started_at,
         ended_at,
         ended_reason,
         last_phase
       FROM nano_conversation_sessions
      WHERE conversation_uuid = ?1
      ORDER BY started_at DESC, session_uuid DESC
      LIMIT 20`,
    ).bind(input.conversation_uuid).all<Record<string, unknown>>();
    const sessions = (sessionRows.results ?? []).map((session) => ({
      session_uuid: String(session.session_uuid),
      session_status: String(session.session_status) as DurableSessionStatus,
      started_at: String(session.started_at),
      ended_at: toNullableString(session.ended_at),
      ended_reason: toNullableString(session.ended_reason),
      last_phase: toNullableString(session.last_phase),
    }));
    const latestSession = sessions[0] ?? null;
    return {
      conversation_uuid: String(row.conversation_uuid),
      team_uuid: String(row.team_uuid),
      owner_user_uuid: String(row.owner_user_uuid),
      title: toNullableString(row.title),
      conversation_status: String(row.conversation_status),
      deleted_at: toNullableString(row.deleted_at),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
      latest_session_uuid: toNullableString(row.latest_session_uuid),
      latest_turn_uuid: toNullableString(row.latest_turn_uuid),
      session_count: toCount(row.session_count),
      latest_session: latestSession,
      sessions,
    };
  }

  async beginSession(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
    readonly trace_uuid: string;
    readonly started_at: string;
  }): Promise<DurableSessionPointer> {
    const existing = await this.db.prepare(
      `SELECT conversation_uuid
         FROM nano_conversation_sessions
        WHERE session_uuid = ?1
        LIMIT 1`,
    ).bind(input.session_uuid).first<Record<string, unknown>>();
    if (existing?.conversation_uuid) {
      return {
        conversation_uuid: String(existing.conversation_uuid),
        session_uuid: input.session_uuid,
        conversation_created: false,
      };
    }

    const activeConversation = await this.db.prepare(
      `SELECT conversation_uuid
         FROM nano_conversations
        WHERE team_uuid = ?1
          AND owner_user_uuid = ?2
          AND conversation_status = 'active'
        ORDER BY updated_at DESC
        LIMIT 1`,
    ).bind(input.team_uuid, input.actor_user_uuid).first<Record<string, unknown>>();

    const conversation_uuid = activeConversation?.conversation_uuid
      ? String(activeConversation.conversation_uuid)
      : crypto.randomUUID();
    await this.db.batch([
      ...(!activeConversation?.conversation_uuid
        ? [
            this.db.prepare(
              `INSERT INTO nano_conversations (
                 conversation_uuid,
                 team_uuid,
                 owner_user_uuid,
                 conversation_status,
                 created_at,
                 updated_at,
                 latest_session_uuid,
                 latest_turn_uuid,
                 title
               ) VALUES (?1, ?2, ?3, 'active', ?4, ?4, ?5, NULL, NULL)`,
            ).bind(
              conversation_uuid,
              input.team_uuid,
              input.actor_user_uuid,
              input.started_at,
              input.session_uuid,
            ),
          ]
        : []),
      this.db.prepare(
        `INSERT OR IGNORE INTO nano_conversation_sessions (
           session_uuid,
           conversation_uuid,
           team_uuid,
           actor_user_uuid,
           trace_uuid,
           session_status,
           started_at,
           ended_at,
           last_phase,
           last_event_seq
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'starting', ?6, NULL, NULL, 0)`,
      ).bind(
        input.session_uuid,
        conversation_uuid,
        input.team_uuid,
        input.actor_user_uuid,
        input.trace_uuid,
        input.started_at,
      ),
      this.db.prepare(
        `UPDATE nano_conversations
            SET updated_at = ?2,
                latest_session_uuid = ?3,
                conversation_status = 'active'
          WHERE conversation_uuid = ?1`,
      ).bind(conversation_uuid, input.started_at, input.session_uuid),
    ]);

    return {
      conversation_uuid,
      session_uuid: input.session_uuid,
      conversation_created: !activeConversation?.conversation_uuid,
    };
  }

  async updateSessionState(input: {
    readonly session_uuid: string;
    readonly status: DurableSessionStatus;
    readonly last_phase: string | null;
    readonly touched_at: string;
    readonly ended_at?: string | null;
    readonly ended_reason?: string | null;
  }): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_conversation_sessions
           SET session_status = ?2,
               last_phase = ?3,
               ended_at = ?4,
               ended_reason = ?5
         WHERE session_uuid = ?1`,
    ).bind(
      input.session_uuid,
      input.status,
      input.last_phase,
      input.ended_at ?? null,
      input.ended_reason ?? null,
    ).run();

    await this.db.prepare(
      `UPDATE nano_conversations
          SET updated_at = ?2,
              conversation_status = CASE WHEN ?3 = 'ended' THEN conversation_status ELSE 'active' END
        WHERE conversation_uuid = (
          SELECT conversation_uuid
            FROM nano_conversation_sessions
           WHERE session_uuid = ?1
           LIMIT 1
        )`,
    ).bind(input.session_uuid, input.touched_at, input.status).run();
  }

  async updateConversationTitle(input: {
    readonly session_uuid: string;
    readonly title: string;
    readonly touched_at: string;
  }): Promise<DurableSessionLifecycleRecord | null> {
    await this.db.prepare(
      `UPDATE nano_conversations
          SET title = ?2,
              updated_at = ?3
        WHERE conversation_uuid = (
          SELECT conversation_uuid
            FROM nano_conversation_sessions
           WHERE session_uuid = ?1
           LIMIT 1
        )`,
    ).bind(input.session_uuid, input.title, input.touched_at).run();
    return this.readSessionLifecycle(input.session_uuid);
  }

  async tombstoneConversation(input: {
    readonly session_uuid: string;
    readonly deleted_at: string;
    readonly touched_at: string;
  }): Promise<DurableSessionLifecycleRecord | null> {
    await this.db.prepare(
      `UPDATE nano_conversations
          SET deleted_at = ?2,
              updated_at = ?3
        WHERE conversation_uuid = (
          SELECT conversation_uuid
            FROM nano_conversation_sessions
           WHERE session_uuid = ?1
           LIMIT 1
        )`,
    ).bind(input.session_uuid, input.deleted_at, input.touched_at).run();
    return this.readSessionLifecycle(input.session_uuid);
  }

  async listCheckpoints(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
  }): Promise<DurableCheckpointListItem[]> {
    const rows = await this.db.prepare(
      `SELECT
         checkpoint_uuid,
         session_uuid,
         conversation_uuid,
         team_uuid,
         turn_uuid,
         turn_attempt,
         checkpoint_kind,
         label,
         message_high_watermark,
         latest_event_seq,
         context_snapshot_uuid,
         file_snapshot_status,
         created_by,
         created_at,
         expires_at
       FROM nano_session_checkpoints
      WHERE session_uuid = ?1
        AND team_uuid = ?2
      ORDER BY created_at DESC, checkpoint_uuid DESC`,
    ).bind(input.session_uuid, input.team_uuid).all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({
      checkpoint_uuid: String(row.checkpoint_uuid),
      session_uuid: String(row.session_uuid),
      conversation_uuid: String(row.conversation_uuid),
      team_uuid: String(row.team_uuid),
      turn_uuid: toNullableString(row.turn_uuid),
      turn_attempt:
        row.turn_attempt === null || row.turn_attempt === undefined ? null : toCount(row.turn_attempt),
      checkpoint_kind: String(row.checkpoint_kind),
      label: toNullableString(row.label),
      message_high_watermark: toNullableString(row.message_high_watermark),
      latest_event_seq:
        row.latest_event_seq === null || row.latest_event_seq === undefined
          ? null
          : toCount(row.latest_event_seq),
      context_snapshot_uuid: toNullableString(row.context_snapshot_uuid),
      file_snapshot_status: String(row.file_snapshot_status),
      created_by: String(row.created_by),
      created_at: String(row.created_at),
      expires_at: toNullableString(row.expires_at),
    }));
  }

  async createUserCheckpoint(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
    readonly label: string | null;
    readonly created_at: string;
  }): Promise<DurableCheckpointListItem | null> {
    const session = await this.readSessionLifecycle(input.session_uuid);
    if (!session || session.team_uuid !== input.team_uuid) return null;
    const latest = await this.db.prepare(
      `SELECT
         (
           SELECT turn_uuid
             FROM nano_conversation_turns
            WHERE session_uuid = ?1
            ORDER BY turn_index DESC, turn_attempt DESC
            LIMIT 1
         ) AS turn_uuid,
         (
           SELECT turn_attempt
             FROM nano_conversation_turns
            WHERE session_uuid = ?1
            ORDER BY turn_index DESC, turn_attempt DESC
            LIMIT 1
         ) AS turn_attempt,
         (
           SELECT message_uuid
             FROM nano_conversation_messages
            WHERE session_uuid = ?1
            ORDER BY created_at DESC, message_uuid DESC
            LIMIT 1
         ) AS message_high_watermark,
         (
           SELECT MAX(event_seq)
             FROM nano_conversation_messages
            WHERE session_uuid = ?1
         ) AS latest_event_seq,
         (
           SELECT snapshot_uuid
             FROM nano_conversation_context_snapshots
            WHERE session_uuid = ?1
            ORDER BY created_at DESC, snapshot_uuid DESC
            LIMIT 1
         ) AS context_snapshot_uuid`,
    ).bind(input.session_uuid).first<Record<string, unknown>>();
    const checkpointUuid = crypto.randomUUID();
    await this.db.prepare(
      `INSERT INTO nano_session_checkpoints (
         checkpoint_uuid,
         session_uuid,
         conversation_uuid,
         team_uuid,
         turn_uuid,
         turn_attempt,
         checkpoint_kind,
         label,
         message_high_watermark,
         latest_event_seq,
         context_snapshot_uuid,
         file_snapshot_status,
         created_by,
         created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'user_named', ?7, ?8, ?9, ?10, 'none', 'user', ?11)`,
    ).bind(
      checkpointUuid,
      input.session_uuid,
      session.conversation_uuid,
      input.team_uuid,
      toNullableString(latest?.turn_uuid),
      latest?.turn_attempt === null || latest?.turn_attempt === undefined
        ? null
        : toCount(latest.turn_attempt),
      input.label,
      toNullableString(latest?.message_high_watermark),
      latest?.latest_event_seq === null || latest?.latest_event_seq === undefined
        ? null
        : toCount(latest.latest_event_seq),
      toNullableString(latest?.context_snapshot_uuid),
      input.created_at,
    ).run();
    return (await this.listCheckpoints({
      session_uuid: input.session_uuid,
      team_uuid: input.team_uuid,
    })).find((row) => row.checkpoint_uuid === checkpointUuid) ?? null;
  }

  async readCheckpointDiff(input: {
    readonly session_uuid: string;
    readonly checkpoint_uuid: string;
    readonly team_uuid: string;
  }): Promise<DurableCheckpointDiff | null> {
    const checkpoint = (await this.listCheckpoints({
      session_uuid: input.session_uuid,
      team_uuid: input.team_uuid,
    })).find((row) => row.checkpoint_uuid === input.checkpoint_uuid);
    if (!checkpoint) return null;
    const watermarkCreatedAt =
      checkpoint.message_high_watermark === null
        ? null
        : toNullableString(
            (
              await this.db.prepare(
                `SELECT created_at
                   FROM nano_conversation_messages
                  WHERE message_uuid = ?1
                  LIMIT 1`,
              ).bind(checkpoint.message_high_watermark).first<Record<string, unknown>>()
            )?.created_at,
          );
    const afterRows = await this.db.prepare(
      `SELECT
         message_uuid,
         turn_uuid,
         message_kind,
         created_at,
         superseded_at
       FROM nano_conversation_messages
      WHERE session_uuid = ?1
        AND (?2 IS NULL OR created_at > ?2)
      ORDER BY created_at ASC, message_uuid ASC`,
    ).bind(input.session_uuid, watermarkCreatedAt).all<Record<string, unknown>>();
    const supersededRows = await this.db.prepare(
      `SELECT
         message_uuid,
         turn_uuid,
         message_kind,
         created_at,
         superseded_at,
         superseded_by_turn_attempt
       FROM nano_conversation_messages
      WHERE session_uuid = ?1
        AND superseded_at IS NOT NULL
      ORDER BY superseded_at DESC, message_uuid DESC`,
    ).bind(input.session_uuid).all<Record<string, unknown>>();
    return {
      checkpoint,
      watermark_created_at: watermarkCreatedAt,
      messages_since_checkpoint: (afterRows.results ?? []).map((row) => ({
        message_uuid: String(row.message_uuid),
        turn_uuid: toNullableString(row.turn_uuid),
        message_kind: String(row.message_kind),
        created_at: String(row.created_at),
        superseded_at: toNullableString(row.superseded_at),
      })),
      superseded_messages: (supersededRows.results ?? []).map((row) => ({
        message_uuid: String(row.message_uuid),
        turn_uuid: toNullableString(row.turn_uuid),
        message_kind: String(row.message_kind),
        created_at: String(row.created_at),
        superseded_at: String(row.superseded_at),
        superseded_by_turn_attempt:
          row.superseded_by_turn_attempt === null || row.superseded_by_turn_attempt === undefined
            ? null
            : toCount(row.superseded_by_turn_attempt),
      })),
    };
  }

  async createTurn(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
    readonly trace_uuid: string;
    readonly kind: DurableTurnKind;
    readonly input_text: string | null;
    readonly created_at: string;
    readonly requested_model_id?: string | null;
    readonly requested_reasoning_effort?: ReasoningEffort | null;
  }): Promise<DurableTurnPointer> {
    for (let attempt = 0; attempt < UNIQUE_RETRY_LIMIT; attempt += 1) {
      const turn_uuid = crypto.randomUUID();
      try {
        await this.db.batch([
          this.db.prepare(
            `INSERT INTO nano_conversation_turns (
               turn_uuid,
               conversation_uuid,
               session_uuid,
               team_uuid,
               actor_user_uuid,
               trace_uuid,
               turn_index,
               turn_kind,
               turn_status,
               input_text,
               requested_model_id,
               requested_reasoning_effort,
               created_at,
               ended_at
             )
             SELECT
               ?1,
               ?2,
               ?3,
               ?4,
               ?5,
               ?6,
               COALESCE(MAX(turn_index), 0) + 1,
                ?7,
                'accepted',
                ?8,
                ?9,
                ?10,
                ?11,
                NULL
              FROM nano_conversation_turns
              WHERE session_uuid = ?3`,
           ).bind(
            turn_uuid,
            input.conversation_uuid,
            input.session_uuid,
            input.team_uuid,
            input.actor_user_uuid,
             input.trace_uuid,
             input.kind,
             input.input_text,
              input.requested_model_id ?? null,
              input.requested_reasoning_effort ?? null,
              input.created_at,
            ),
          this.db.prepare(
            `UPDATE nano_conversations
                SET latest_turn_uuid = ?2,
                    updated_at = ?3
              WHERE conversation_uuid = ?1`,
          ).bind(input.conversation_uuid, turn_uuid, input.created_at),
        ]);
        const row = await this.db.prepare(
          `SELECT turn_index
             FROM nano_conversation_turns
            WHERE turn_uuid = ?1
            LIMIT 1`,
        ).bind(turn_uuid).first<Record<string, unknown>>();
        return {
          turn_uuid,
          turn_index: toCount(row?.turn_index) || 1,
        };
      } catch (error) {
        if (attempt + 1 < UNIQUE_RETRY_LIMIT && isUniqueConstraintError(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("failed to create durable turn after unique retries");
  }

  async closeTurn(input: {
    readonly turn_uuid: string;
    readonly status: DurableTurnStatus;
    readonly ended_at: string;
    readonly effective_model_id?: string | null;
    readonly effective_reasoning_effort?: ReasoningEffort | null;
    readonly fallback_used?: boolean;
    readonly fallback_reason?: string | null;
  }): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_conversation_turns
          SET turn_status = ?2,
              ended_at = ?3,
              effective_model_id = ?4,
              effective_reasoning_effort = ?5,
              fallback_used = ?6,
              fallback_reason = ?7
        WHERE turn_uuid = ?1`,
    ).bind(
      input.turn_uuid,
      input.status,
      input.ended_at,
      input.effective_model_id ?? null,
      input.effective_reasoning_effort ?? null,
      input.fallback_used === true ? 1 : 0,
      input.fallback_reason ?? null,
    ).run();
  }

  async appendMessage(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly trace_uuid: string;
    readonly turn_uuid: string | null;
    readonly role: DurableMessageRole;
    readonly kind: string;
    readonly event_seq: number | null;
    readonly body: Record<string, unknown>;
    readonly created_at: string;
  }): Promise<void> {
    await this.buildAppendMessageStatement(input).run();
  }

  async appendStreamEvent(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly trace_uuid: string;
    readonly turn_uuid: string | null;
    readonly event_seq: number;
    readonly payload: Record<string, unknown>;
    readonly created_at: string;
  }): Promise<void> {
    const kind =
      typeof input.payload.kind === "string" && input.payload.kind.length > 0
        ? input.payload.kind
        : "session.stream.event";
    await this.db.batch([
      this.buildAppendMessageStatement({
        session_uuid: input.session_uuid,
        conversation_uuid: input.conversation_uuid,
        team_uuid: input.team_uuid,
        trace_uuid: input.trace_uuid,
        turn_uuid: input.turn_uuid,
        role: inferMessageRole(kind),
        kind: "stream-event",
        event_seq: input.event_seq,
        body: input.payload,
        created_at: input.created_at,
      }),
      this.db.prepare(
        `UPDATE nano_conversation_sessions
            SET last_event_seq = CASE
              WHEN last_event_seq < ?2 THEN ?2
              ELSE last_event_seq
            END
          WHERE session_uuid = ?1`,
      ).bind(input.session_uuid, input.event_seq),
    ]);
  }

  async captureContextSnapshot(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly trace_uuid: string;
    readonly turn_uuid: string | null;
    readonly snapshot_kind: string;
    readonly summary_ref: string | null;
    readonly prompt_token_estimate: number | null;
    readonly payload: Record<string, unknown>;
    readonly created_at: string;
  }): Promise<void> {
    await this.db.prepare(
      `INSERT INTO nano_conversation_context_snapshots (
         snapshot_uuid,
         conversation_uuid,
         session_uuid,
         turn_uuid,
         team_uuid,
         trace_uuid,
         snapshot_kind,
         summary_ref,
         prompt_token_estimate,
         payload_json,
         created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    ).bind(
      crypto.randomUUID(),
      input.conversation_uuid,
      input.session_uuid,
      input.turn_uuid,
      input.team_uuid,
      input.trace_uuid,
      input.snapshot_kind,
      input.summary_ref,
      input.prompt_token_estimate,
      JSON.stringify(input.payload),
      input.created_at,
    ).run();
  }

  async appendActivity(input: {
    readonly team_uuid: string;
    readonly actor_user_uuid: string | null;
    readonly conversation_uuid: string | null;
    readonly session_uuid: string | null;
    readonly turn_uuid: string | null;
    readonly trace_uuid: string;
    readonly event_kind: string;
    readonly severity: "info" | "warn" | "error";
    readonly payload: Record<string, unknown>;
    readonly created_at: string;
  }): Promise<number> {
    const payloadText = serializeActivityPayload(input.payload);
    for (let attempt = 0; attempt < UNIQUE_RETRY_LIMIT; attempt += 1) {
      const activity_uuid = crypto.randomUUID();
      try {
        await this.db.prepare(
          `INSERT INTO nano_session_activity_logs (
             activity_uuid,
             team_uuid,
             actor_user_uuid,
             conversation_uuid,
             session_uuid,
             turn_uuid,
             trace_uuid,
             event_seq,
             event_kind,
             severity,
             payload,
             created_at
           )
           SELECT
             ?1,
             ?2,
             ?3,
             ?4,
             ?5,
             ?6,
             ?7,
             COALESCE(MAX(event_seq), 0) + 1,
             ?8,
             ?9,
             ?10,
             ?11
           FROM nano_session_activity_logs
           WHERE trace_uuid = ?7`,
        ).bind(
          activity_uuid,
          input.team_uuid,
          input.actor_user_uuid,
          input.conversation_uuid,
          input.session_uuid,
          input.turn_uuid,
          input.trace_uuid,
          input.event_kind,
          input.severity,
          payloadText,
          input.created_at,
        ).run();
        const inserted = await this.db.prepare(
          `SELECT event_seq
             FROM nano_session_activity_logs
            WHERE activity_uuid = ?1
            LIMIT 1`,
        ).bind(activity_uuid).first<Record<string, unknown>>();
        return toCount(inserted?.event_seq) || 1;
      } catch (error) {
        if (attempt + 1 < UNIQUE_RETRY_LIMIT && isUniqueConstraintError(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error("failed to append durable activity after unique retries");
  }

  async rollbackSessionStart(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly delete_conversation: boolean;
  }): Promise<void> {
    await this.db.batch([
      this.db.prepare(
        `DELETE FROM nano_conversation_context_snapshots
          WHERE session_uuid = ?1`,
      ).bind(input.session_uuid),
      this.db.prepare(
        `DELETE FROM nano_conversation_messages
          WHERE session_uuid = ?1`,
      ).bind(input.session_uuid),
      this.db.prepare(
        `DELETE FROM nano_session_activity_logs
          WHERE session_uuid = ?1`,
      ).bind(input.session_uuid),
      this.db.prepare(
        `DELETE FROM nano_conversation_turns
          WHERE session_uuid = ?1`,
      ).bind(input.session_uuid),
      this.db.prepare(
        `DELETE FROM nano_conversation_sessions
          WHERE session_uuid = ?1`,
      ).bind(input.session_uuid),
      ...(input.delete_conversation
        ? [
            this.db.prepare(
              `DELETE FROM nano_conversations
                WHERE conversation_uuid = ?1
                  AND NOT EXISTS (
                    SELECT 1
                      FROM nano_conversation_sessions
                     WHERE conversation_uuid = ?1
                     LIMIT 1
                  )`,
            ).bind(input.conversation_uuid),
          ]
        : []),
    ]);
  }

  async readTimeline(session_uuid: string): Promise<Record<string, unknown>[]> {
    const rows = await this.db.prepare(
      `SELECT body_json
         FROM nano_conversation_messages
        WHERE session_uuid = ?1
          AND message_kind = 'stream-event'
        ORDER BY COALESCE(event_seq, 0) ASC, created_at ASC`,
    ).bind(session_uuid).all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => parseJsonRecord(row.body_json));
  }

  async readHistory(session_uuid: string): Promise<DurableHistoryMessage[]> {
    const rows = await this.db.prepare(
      `SELECT
         message_uuid,
         turn_uuid,
         trace_uuid,
         message_role,
         message_kind,
         body_json,
         created_at
       FROM nano_conversation_messages
      WHERE session_uuid = ?1
       ORDER BY created_at ASC, COALESCE(event_seq, 0) ASC, message_uuid ASC`,
    ).bind(session_uuid).all<Record<string, unknown>>();
    return (rows.results ?? []).map((row) => ({
      message_uuid: String(row.message_uuid),
      turn_uuid: typeof row.turn_uuid === "string" ? row.turn_uuid : null,
      trace_uuid: String(row.trace_uuid),
      role: String(row.message_role) as DurableMessageRole,
      kind: String(row.message_kind),
      body: parseJsonRecord(row.body_json),
      created_at: String(row.created_at),
    }));
  }

  // ZX4 P5-01 — usage live read for GET /sessions/{id}/usage. Aggregates
  // session-scoped llm + tool usage rows (allow verdicts only — denies
  // didn't actually consume) and joins team-level remaining balance for
  // budget headline numbers. Returns null when no rows exist for the
  // session yet (caller falls back to placeholder shape).
  async readUsageSnapshot(input: {
    readonly session_uuid: string;
    readonly team_uuid: string;
  }): Promise<{
    readonly llm_input_tokens: number;
    readonly llm_output_tokens: number;
    readonly tool_calls: number;
    readonly subrequest_used: number;
    readonly subrequest_budget: number | null;
    readonly estimated_cost_usd: number | null;
  } | null> {
    const sessionAggregate = await this.db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN resource_kind='llm' AND unit='input_token' THEN quantity ELSE 0 END), 0) AS llm_input,
         COALESCE(SUM(CASE WHEN resource_kind='llm' AND unit='output_token' THEN quantity ELSE 0 END), 0) AS llm_output,
         COALESCE(SUM(CASE WHEN resource_kind='tool' THEN 1 ELSE 0 END), 0) AS tool_calls,
         COALESCE(SUM(quantity), 0) AS subrequest_used,
         COUNT(*) AS row_count
         FROM nano_usage_events
        WHERE session_uuid = ?1
          AND verdict = 'allow'`,
    ).bind(input.session_uuid).first<Record<string, unknown>>();
    if (!sessionAggregate || toCount(sessionAggregate.row_count) === 0) {
      return null;
    }
    const balanceRow = await this.db.prepare(
      `SELECT remaining
         FROM nano_quota_balances
        WHERE team_uuid = ?1
          AND quota_kind = 'llm'
        LIMIT 1`,
    ).bind(input.team_uuid).first<Record<string, unknown>>();
    return {
      llm_input_tokens: toCount(sessionAggregate.llm_input),
      llm_output_tokens: toCount(sessionAggregate.llm_output),
      tool_calls: toCount(sessionAggregate.tool_calls),
      subrequest_used: toCount(sessionAggregate.subrequest_used),
      subrequest_budget: balanceRow ? toCount(balanceRow.remaining) : null,
      estimated_cost_usd: null,
    };
  }

  async readSnapshot(session_uuid: string): Promise<DurableSessionSnapshot | null> {
    const row = await this.db.prepare(
      `SELECT
         s.conversation_uuid,
         s.session_uuid,
         s.team_uuid,
         s.actor_user_uuid,
         s.trace_uuid,
         s.session_status,
         s.started_at,
         s.ended_at,
         s.last_phase,
         s.last_event_seq,
         c.latest_turn_uuid,
         (SELECT COUNT(*) FROM nano_conversation_messages m WHERE m.session_uuid = s.session_uuid) AS message_count,
         (SELECT COUNT(*) FROM nano_session_activity_logs a WHERE a.session_uuid = s.session_uuid) AS activity_count
       FROM nano_conversation_sessions s
       JOIN nano_conversations c
         ON c.conversation_uuid = s.conversation_uuid
      WHERE s.session_uuid = ?1
      LIMIT 1`,
    ).bind(session_uuid).first<Record<string, unknown>>();
    if (!row) return null;
    return {
      conversation_uuid: String(row.conversation_uuid),
      session_uuid: String(row.session_uuid),
      team_uuid: String(row.team_uuid),
      actor_user_uuid: String(row.actor_user_uuid),
      trace_uuid: String(row.trace_uuid),
      session_status: String(row.session_status) as DurableSessionStatus,
      started_at: String(row.started_at),
      ended_at: typeof row.ended_at === "string" ? row.ended_at : null,
      last_phase: typeof row.last_phase === "string" ? row.last_phase : null,
      last_event_seq: toCount(row.last_event_seq),
      message_count: toCount(row.message_count),
      activity_count: toCount(row.activity_count),
      latest_turn_uuid: typeof row.latest_turn_uuid === "string" ? row.latest_turn_uuid : null,
    };
  }
}
