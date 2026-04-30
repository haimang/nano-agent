import { D1SessionTruthRepository, type DurableHistoryMessage, type DurableSessionSnapshot } from "./session-truth.js";

const DEFAULT_CONTEXT_WINDOW = 131_072;
const DEFAULT_EFFECTIVE_CONTEXT_PCT = 0.75;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;

export interface ContextUsageSnapshot {
  readonly llm_input_tokens: number;
  readonly llm_output_tokens: number;
  readonly tool_calls: number;
  readonly subrequest_used: number;
  readonly subrequest_budget: number | null;
  readonly estimated_cost_usd: number | null;
}

export interface DurableContextSnapshotRecord {
  readonly snapshot_uuid: string;
  readonly turn_uuid: string | null;
  readonly snapshot_kind: string;
  readonly summary_ref: string | null;
  readonly prompt_token_estimate: number | null;
  readonly payload: Record<string, unknown>;
  readonly created_at: string;
}

export interface DurableCompactCheckpointRecord {
  readonly checkpoint_uuid: string;
  readonly turn_uuid: string | null;
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

export interface ContextCompactNotifyProjection {
  readonly status: "started" | "completed" | "failed";
  readonly tokens_before: number | null;
  readonly tokens_after: number | null;
}

export interface ContextModelProfile {
  readonly model_id: string;
  readonly context_window: number;
  readonly effective_context_pct: number;
  readonly auto_compact_token_limit: number | null;
  readonly base_instructions_suffix: string | null;
  readonly max_output_tokens: number;
}

export interface ContextDurableState {
  readonly snapshot: DurableSessionSnapshot;
  readonly history: ReadonlyArray<DurableHistoryMessage>;
  readonly usage: ContextUsageSnapshot | null;
  readonly context_snapshots: ReadonlyArray<DurableContextSnapshotRecord>;
  readonly latest_compact_boundary: DurableCompactCheckpointRecord | null;
  readonly latest_compact_notify: ContextCompactNotifyProjection | null;
  readonly model: ContextModelProfile | null;
}

export interface ContextSnapshotWriteInput {
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly trace_uuid: string;
  readonly snapshot_kind: string;
  readonly prompt_token_estimate?: number | null;
  readonly payload: Record<string, unknown>;
  readonly created_at?: string;
}

export interface ContextSnapshotWriteResult {
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly snapshot_id: string;
  readonly created_at: string;
  readonly snapshot_kind: string;
}

export interface ContextCompactCommitInput {
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly trace_uuid: string;
  readonly created_at?: string;
  readonly tokens_before: number;
  readonly tokens_after: number;
  readonly prompt_token_estimate?: number | null;
  readonly summary_text: string;
  readonly message_high_watermark?: string | null;
  readonly protected_fragment_kinds?: ReadonlyArray<string>;
  readonly compacted_message_count?: number;
  readonly kept_message_count?: number;
}

export interface ContextCompactJobRecord {
  readonly session_uuid: string;
  readonly team_uuid: string;
  readonly job_id: string;
  readonly checkpoint_uuid: string;
  readonly context_snapshot_uuid: string | null;
  readonly status: "started" | "completed" | "failed";
  readonly tokens_before: number | null;
  readonly tokens_after: number | null;
  readonly created_at: string;
  readonly message_high_watermark: string | null;
  readonly latest_event_seq: number | null;
  readonly summary_text: string | null;
  readonly protected_fragment_kinds: ReadonlyArray<string>;
  readonly compacted_message_count: number | null;
  readonly kept_message_count: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toNullableInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.length > 0 && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.length > 0
        ? Number(value)
        : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readContextSnapshots(
  db: D1Database,
  sessionUuid: string,
): Promise<ReadonlyArray<DurableContextSnapshotRecord>> {
  const rows = await db.prepare(
    `SELECT
       snapshot_uuid,
       turn_uuid,
       snapshot_kind,
       summary_ref,
       prompt_token_estimate,
       payload_json,
       created_at
      FROM nano_conversation_context_snapshots
     WHERE session_uuid = ?1
     ORDER BY created_at DESC, snapshot_uuid DESC
     LIMIT 10`,
  ).bind(sessionUuid).all<Record<string, unknown>>();
  return (rows.results ?? []).map((row) => ({
    snapshot_uuid: String(row.snapshot_uuid),
    turn_uuid: toNullableString(row.turn_uuid),
    snapshot_kind: String(row.snapshot_kind),
    summary_ref: toNullableString(row.summary_ref),
    prompt_token_estimate: toNullableInt(row.prompt_token_estimate),
    payload: parseJsonRecord(row.payload_json),
    created_at: String(row.created_at),
  }));
}

async function readLatestCompactBoundary(
  db: D1Database,
  sessionUuid: string,
): Promise<DurableCompactCheckpointRecord | null> {
  const row = await db.prepare(
    `SELECT
       checkpoint_uuid,
       turn_uuid,
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
       AND checkpoint_kind = 'compact_boundary'
     ORDER BY created_at DESC, checkpoint_uuid DESC
     LIMIT 1`,
  ).bind(sessionUuid).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    checkpoint_uuid: String(row.checkpoint_uuid),
    turn_uuid: toNullableString(row.turn_uuid),
    checkpoint_kind: String(row.checkpoint_kind),
    label: toNullableString(row.label),
    message_high_watermark: toNullableString(row.message_high_watermark),
    latest_event_seq: toNullableInt(row.latest_event_seq),
    context_snapshot_uuid: toNullableString(row.context_snapshot_uuid),
    file_snapshot_status: String(row.file_snapshot_status ?? "none"),
    created_by: String(row.created_by ?? "compact"),
    created_at: String(row.created_at),
    expires_at: toNullableString(row.expires_at),
  };
}

async function readLatestCompactNotify(
  repo: D1SessionTruthRepository,
  sessionUuid: string,
): Promise<ContextCompactNotifyProjection | null> {
  const timeline = await repo.readTimeline(sessionUuid);
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const event = timeline[index];
    if (!event || event.kind !== "compact.notify") continue;
    const status = event.status;
    if (status !== "started" && status !== "completed" && status !== "failed") continue;
    return {
      status,
      tokens_before: toNullableInt(event.tokens_before),
      tokens_after: toNullableInt(event.tokens_after),
    };
  }
  return null;
}

async function readModelProfile(
  db: D1Database,
  sessionUuid: string,
): Promise<ContextModelProfile | null> {
  const picked = await db.prepare(
    `SELECT COALESCE(
       (SELECT effective_model_id
          FROM nano_conversation_turns
         WHERE session_uuid = ?1
           AND effective_model_id IS NOT NULL
         ORDER BY created_at DESC, turn_index DESC, turn_attempt DESC
         LIMIT 1),
       (SELECT requested_model_id
          FROM nano_conversation_turns
         WHERE session_uuid = ?1
           AND requested_model_id IS NOT NULL
         ORDER BY created_at DESC, turn_index DESC, turn_attempt DESC
         LIMIT 1),
       (SELECT default_model_id
          FROM nano_conversation_sessions
         WHERE session_uuid = ?1
         LIMIT 1),
       (SELECT model_id
          FROM nano_usage_events
         WHERE session_uuid = ?1
           AND model_id IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1),
       (SELECT model_id
          FROM nano_models
         WHERE status = 'active'
         ORDER BY COALESCE(sort_priority, 0) DESC, model_id ASC
         LIMIT 1)
     ) AS model_id`,
  ).bind(sessionUuid).first<Record<string, unknown>>();
  const modelId = toNullableString(picked?.model_id);
  if (!modelId) return null;
  const row = await db.prepare(
    `SELECT
       model_id,
       context_window,
       effective_context_pct,
       auto_compact_token_limit,
       base_instructions_suffix,
       max_output_tokens
      FROM nano_models
     WHERE model_id = ?1
     LIMIT 1`,
  ).bind(modelId).first<Record<string, unknown>>();
  if (!row) {
    return {
      model_id: modelId,
      context_window: DEFAULT_CONTEXT_WINDOW,
      effective_context_pct: DEFAULT_EFFECTIVE_CONTEXT_PCT,
      auto_compact_token_limit: null,
      base_instructions_suffix: null,
      max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
    };
  }
  return {
    model_id: String(row.model_id),
    context_window: toPositiveInt(row.context_window, DEFAULT_CONTEXT_WINDOW),
    effective_context_pct:
      typeof row.effective_context_pct === "number" && Number.isFinite(row.effective_context_pct)
        ? row.effective_context_pct
        : typeof row.effective_context_pct === "string" &&
            row.effective_context_pct.length > 0 &&
            Number.isFinite(Number(row.effective_context_pct))
          ? Number(row.effective_context_pct)
          : DEFAULT_EFFECTIVE_CONTEXT_PCT,
    auto_compact_token_limit: toNullableInt(row.auto_compact_token_limit),
    base_instructions_suffix: toNullableString(row.base_instructions_suffix),
    max_output_tokens: toPositiveInt(row.max_output_tokens, DEFAULT_MAX_OUTPUT_TOKENS),
  };
}

export async function readContextDurableState(
  db: D1Database | undefined,
  sessionUuid: string,
  teamUuid: string,
): Promise<ContextDurableState | null> {
  if (!db) return null;
  const repo = new D1SessionTruthRepository(db);
  const snapshot = await repo.readSnapshot(sessionUuid);
  if (!snapshot || snapshot.team_uuid !== teamUuid) return null;
  const [history, usage, contextSnapshots, latestCompactBoundary, latestCompactNotify, model] =
    await Promise.all([
      repo.readHistory(sessionUuid),
      repo.readUsageSnapshot({ session_uuid: sessionUuid, team_uuid: teamUuid }),
      readContextSnapshots(db, sessionUuid),
      readLatestCompactBoundary(db, sessionUuid),
      readLatestCompactNotify(repo, sessionUuid),
      readModelProfile(db, sessionUuid),
    ]);
  return {
    snapshot,
    history,
    usage,
    context_snapshots: contextSnapshots,
    latest_compact_boundary: latestCompactBoundary,
    latest_compact_notify: latestCompactNotify,
    model,
  };
}

export async function createContextSnapshotRecord(
  db: D1Database | undefined,
  input: ContextSnapshotWriteInput,
): Promise<ContextSnapshotWriteResult | null> {
  if (!db) return null;
  const repo = new D1SessionTruthRepository(db);
  const snapshot = await repo.readSnapshot(input.session_uuid);
  if (!snapshot || snapshot.team_uuid !== input.team_uuid) return null;
  const createdAt = input.created_at ?? new Date().toISOString();
  const snapshotId = crypto.randomUUID();
  await db.prepare(
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
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10)`,
  ).bind(
    snapshotId,
    snapshot.conversation_uuid,
    input.session_uuid,
    snapshot.latest_turn_uuid,
    input.team_uuid,
    input.trace_uuid,
    input.snapshot_kind,
    input.prompt_token_estimate ?? null,
    JSON.stringify(input.payload),
    createdAt,
  ).run();
  return {
    session_uuid: input.session_uuid,
    team_uuid: input.team_uuid,
    snapshot_id: snapshotId,
    created_at: createdAt,
    snapshot_kind: input.snapshot_kind,
  };
}

function parseProtectedKinds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export async function createCompactBoundaryJob(
  db: D1Database | undefined,
  input: ContextCompactCommitInput,
): Promise<ContextCompactJobRecord | { status: "blocked"; reason: string } | null> {
  if (!db) return null;
  const repo = new D1SessionTruthRepository(db);
  const snapshot = await repo.readSnapshot(input.session_uuid);
  if (!snapshot || snapshot.team_uuid !== input.team_uuid) return null;
  if (snapshot.session_status !== "active" && snapshot.session_status !== "detached") {
    return { status: "blocked", reason: "session-not-active" };
  }
  const createdAt = input.created_at ?? new Date().toISOString();
  const checkpointUuid = crypto.randomUUID();
  const contextSnapshotUuid = crypto.randomUUID();
  const nextEventSeq = Math.max(1, snapshot.last_event_seq + 1);
  const payload = {
    summary_text: input.summary_text,
    protected_fragment_kinds: [...(input.protected_fragment_kinds ?? [])],
    compacted_message_count: input.compacted_message_count ?? null,
    kept_message_count: input.kept_message_count ?? null,
    tokens_before: input.tokens_before,
    tokens_after: input.tokens_after,
  } satisfies Record<string, unknown>;
  await db.batch([
    db.prepare(
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
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'compact-boundary', NULL, ?7, ?8, ?9)`,
    ).bind(
      contextSnapshotUuid,
      snapshot.conversation_uuid,
      input.session_uuid,
      snapshot.latest_turn_uuid,
      input.team_uuid,
      input.trace_uuid,
      input.prompt_token_estimate ?? input.tokens_after,
      JSON.stringify(payload),
      createdAt,
    ),
    db.prepare(
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
         created_at,
         expires_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, 'compact_boundary', NULL, ?6, ?7, ?8, 'none', 'compact', ?9, NULL)`,
    ).bind(
      checkpointUuid,
      input.session_uuid,
      snapshot.conversation_uuid,
      input.team_uuid,
      snapshot.latest_turn_uuid,
      input.message_high_watermark ?? null,
      nextEventSeq,
      contextSnapshotUuid,
      createdAt,
    ),
    db.prepare(
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
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'system', 'stream-event', ?7, ?8, ?9)`,
    ).bind(
      crypto.randomUUID(),
      snapshot.conversation_uuid,
      input.session_uuid,
      snapshot.latest_turn_uuid,
      input.team_uuid,
      input.trace_uuid,
      JSON.stringify({
        kind: "compact.notify",
        status: "completed",
        tokens_before: input.tokens_before,
        tokens_after: input.tokens_after,
      }),
      createdAt,
      nextEventSeq,
    ),
    db.prepare(
      `UPDATE nano_conversation_sessions
          SET last_event_seq = CASE
            WHEN last_event_seq < ?2 THEN ?2
            ELSE last_event_seq
          END
        WHERE session_uuid = ?1`,
    ).bind(input.session_uuid, nextEventSeq),
  ]);
  return readContextCompactJob(db, input.session_uuid, input.team_uuid, checkpointUuid);
}

export async function readContextCompactJob(
  db: D1Database | undefined,
  sessionUuid: string,
  teamUuid: string,
  jobId: string,
): Promise<ContextCompactJobRecord | null> {
  if (!db) return null;
  const row = await db.prepare(
    `SELECT
       cp.checkpoint_uuid,
       cp.session_uuid,
       cp.team_uuid,
       cp.context_snapshot_uuid,
       cp.created_at,
       cp.message_high_watermark,
       cp.latest_event_seq,
       cs.payload_json,
       cs.prompt_token_estimate
      FROM nano_session_checkpoints cp
      LEFT JOIN nano_conversation_context_snapshots cs
        ON cs.snapshot_uuid = cp.context_snapshot_uuid
     WHERE cp.checkpoint_uuid = ?1
       AND cp.session_uuid = ?2
       AND cp.team_uuid = ?3
       AND cp.checkpoint_kind = 'compact_boundary'
     LIMIT 1`,
  ).bind(jobId, sessionUuid, teamUuid).first<Record<string, unknown>>();
  if (!row) return null;
  const payload = parseJsonRecord(row.payload_json);
  const protectedKinds = parseProtectedKinds(payload.protected_fragment_kinds);
  return {
    session_uuid: String(row.session_uuid),
    team_uuid: String(row.team_uuid),
    job_id: String(row.checkpoint_uuid),
    checkpoint_uuid: String(row.checkpoint_uuid),
    context_snapshot_uuid: toNullableString(row.context_snapshot_uuid),
    status: "completed",
    tokens_before: toNullableInt(payload.tokens_before),
    tokens_after: toNullableInt(payload.tokens_after),
    created_at: String(row.created_at),
    message_high_watermark: toNullableString(row.message_high_watermark),
    latest_event_seq: toNullableInt(row.latest_event_seq),
    summary_text: toNullableString(payload.summary_text),
    protected_fragment_kinds: protectedKinds,
    compacted_message_count: toNullableInt(payload.compacted_message_count),
    kept_message_count: toNullableInt(payload.kept_message_count),
  };
}
