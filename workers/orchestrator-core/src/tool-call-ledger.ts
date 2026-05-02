export type ToolCallStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ToolCallCancelInitiator = "user" | "system" | "tool";

export interface ToolCallLedgerRow {
  readonly request_uuid: string;
  readonly session_uuid: string;
  readonly conversation_uuid: string | null;
  readonly turn_uuid: string | null;
  readonly team_uuid: string;
  readonly tool_name: string;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown> | null;
  readonly status: ToolCallStatus;
  readonly cancel_initiator: ToolCallCancelInitiator | null;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly updated_at: string;
}

function parseRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rowToToolCall(row: Record<string, unknown>): ToolCallLedgerRow {
  return {
    request_uuid: String(row.request_uuid),
    session_uuid: String(row.session_uuid),
    conversation_uuid: toNullableString(row.conversation_uuid),
    turn_uuid: toNullableString(row.turn_uuid),
    team_uuid: String(row.team_uuid),
    tool_name: String(row.tool_name),
    input: parseRecord(row.input_json),
    output: row.output_json === null || row.output_json === undefined
      ? null
      : parseRecord(row.output_json),
    status: String(row.status) as ToolCallStatus,
    cancel_initiator: toNullableString(row.cancel_initiator) as ToolCallCancelInitiator | null,
    started_at: String(row.started_at),
    ended_at: toNullableString(row.ended_at),
    updated_at: String(row.updated_at),
  };
}

export class D1ToolCallLedger {
  constructor(private readonly db: D1Database) {}

  async upsert(input: {
    readonly request_uuid: string;
    readonly session_uuid: string;
    readonly conversation_uuid?: string | null;
    readonly turn_uuid?: string | null;
    readonly team_uuid: string;
    readonly tool_name: string;
    readonly input?: Record<string, unknown>;
    readonly output?: Record<string, unknown> | null;
    readonly status: ToolCallStatus;
    readonly cancel_initiator?: ToolCallCancelInitiator | null;
    readonly started_at?: string;
    readonly ended_at?: string | null;
    readonly updated_at?: string;
  }): Promise<ToolCallLedgerRow> {
    const now = new Date().toISOString();
    const updatedAt = input.updated_at ?? now;
    await this.db.prepare(
      `INSERT INTO nano_tool_call_ledger (
         request_uuid, session_uuid, conversation_uuid, turn_uuid, team_uuid,
         tool_name, input_json, output_json, status, cancel_initiator,
         started_at, ended_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(request_uuid) DO UPDATE SET
         output_json = COALESCE(excluded.output_json, nano_tool_call_ledger.output_json),
         status = excluded.status,
         cancel_initiator = excluded.cancel_initiator,
         ended_at = excluded.ended_at,
         updated_at = excluded.updated_at`
    ).bind(
      input.request_uuid,
      input.session_uuid,
      input.conversation_uuid ?? null,
      input.turn_uuid ?? null,
      input.team_uuid,
      input.tool_name,
      JSON.stringify(input.input ?? {}),
      input.output === undefined || input.output === null ? null : JSON.stringify(input.output),
      input.status,
      input.cancel_initiator ?? null,
      input.started_at ?? now,
      input.ended_at ?? null,
      updatedAt,
    ).run();
    const row = await this.read(input.request_uuid);
    if (!row) throw new Error("tool call ledger row lost after upsert");
    return row;
  }

  async read(requestUuid: string): Promise<ToolCallLedgerRow | null> {
    const row = await this.db.prepare(
      `SELECT request_uuid, session_uuid, conversation_uuid, turn_uuid, team_uuid,
              tool_name, input_json, output_json, status, cancel_initiator,
              started_at, ended_at, updated_at
         FROM nano_tool_call_ledger
        WHERE request_uuid = ?1
        LIMIT 1`,
    ).bind(requestUuid).first<Record<string, unknown>>();
    return row ? rowToToolCall(row) : null;
  }

  async listForSession(input: {
    readonly session_uuid: string;
    readonly limit?: number;
    readonly cursor?: string | null;
  }): Promise<{ rows: ToolCallLedgerRow[]; next_cursor: string | null }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const rows = await this.db.prepare(
      `SELECT request_uuid, session_uuid, conversation_uuid, turn_uuid, team_uuid,
              tool_name, input_json, output_json, status, cancel_initiator,
              started_at, ended_at, updated_at
         FROM nano_tool_call_ledger
        WHERE session_uuid = ?1
          AND (?2 IS NULL OR updated_at < ?2)
        ORDER BY updated_at DESC, request_uuid DESC
        LIMIT ?3`,
    ).bind(input.session_uuid, input.cursor ?? null, limit + 1).all<Record<string, unknown>>();
    const mapped = (rows.results ?? []).map(rowToToolCall);
    const page = mapped.slice(0, limit);
    return {
      rows: page,
      next_cursor: mapped.length > limit ? page.at(-1)?.updated_at ?? null : null,
    };
  }

  async markCancelled(input: {
    readonly request_uuid: string;
    readonly cancel_initiator: ToolCallCancelInitiator;
    readonly ended_at: string;
  }): Promise<ToolCallLedgerRow | null> {
    await this.db.prepare(
      `UPDATE nano_tool_call_ledger
          SET status = 'cancelled',
              cancel_initiator = ?2,
              ended_at = ?3,
              updated_at = ?3
        WHERE request_uuid = ?1`,
    ).bind(input.request_uuid, input.cancel_initiator, input.ended_at).run();
    return this.read(input.request_uuid);
  }
}
