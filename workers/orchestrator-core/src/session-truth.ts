import { redactPayload } from "@haimang/nacp-session";

export type DurableSessionStatus = "starting" | "active" | "detached" | "ended";
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

function inferMessageRole(kind: string): DurableMessageRole {
  if (
    kind.startsWith("llm.") ||
    kind === "assistant.message" ||
    kind === "tool.call.result"
  ) {
    return "assistant";
  }
  return kind === "user.input" ? "user" : "system";
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
  }): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_conversation_sessions
          SET session_status = ?2,
              last_phase = ?3,
              ended_at = ?4
        WHERE session_uuid = ?1`,
    ).bind(
      input.session_uuid,
      input.status,
      input.last_phase,
      input.ended_at ?? null,
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

  async createTurn(input: {
    readonly session_uuid: string;
    readonly conversation_uuid: string;
    readonly team_uuid: string;
    readonly actor_user_uuid: string;
    readonly trace_uuid: string;
    readonly kind: DurableTurnKind;
    readonly input_text: string | null;
    readonly created_at: string;
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
  }): Promise<void> {
    await this.db.prepare(
      `UPDATE nano_conversation_turns
          SET turn_status = ?2,
              ended_at = ?3
        WHERE turn_uuid = ?1`,
    ).bind(input.turn_uuid, input.status, input.ended_at).run();
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
