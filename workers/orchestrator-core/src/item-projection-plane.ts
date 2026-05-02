import type { ToolCallLedgerRow } from "./tool-call-ledger.js";
import { D1ToolCallLedger } from "./tool-call-ledger.js";

export type WorkbenchItemKind =
  | "agent_message"
  | "reasoning"
  | "tool_call"
  | "file_change"
  | "todo_list"
  | "confirmation"
  | "error";

export interface WorkbenchItem {
  readonly item_uuid: string;
  readonly session_uuid: string;
  readonly kind: WorkbenchItemKind;
  readonly created_at: string;
  readonly updated_at: string;
  readonly payload: Record<string, unknown>;
}

function stableItemUuid(prefix: string, id: string): string {
  const bytes = new TextEncoder().encode(`${prefix}:${id}`);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${hex}-0000-4000-8000-000000000000`;
}

function parseRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toolCallToItem(row: ToolCallLedgerRow): WorkbenchItem {
  return {
    item_uuid: stableItemUuid("tool", row.request_uuid),
    session_uuid: row.session_uuid,
    kind: "tool_call",
    created_at: row.started_at,
    updated_at: row.updated_at,
    payload: {
      request_uuid: row.request_uuid,
      tool_name: row.tool_name,
      input: row.input,
      output: row.output,
      status: row.status,
      cancel_initiator: row.cancel_initiator,
    },
  };
}

function messageToItem(row: Record<string, unknown>): WorkbenchItem | null {
  const role = String(row.message_role ?? "");
  const messageKind = String(row.message_kind ?? "");
  const body = parseRecord(row.body_json);
  const streamKind = typeof body.kind === "string" ? body.kind : null;
  let kind: WorkbenchItemKind | null = null;
  if (
    messageKind === "stream-event" &&
    streamKind === "llm.delta" &&
    (body.content_type === "reasoning" || body.content_type === "reasoning_summary")
  ) {
    kind = "reasoning";
  } else if (role === "assistant") {
    kind = "agent_message";
  }
  if (!kind) return null;
  return {
    item_uuid: stableItemUuid("msg", String(row.message_uuid)),
    session_uuid: String(row.session_uuid),
    kind,
    created_at: String(row.created_at),
    updated_at: String(row.created_at),
    payload: {
      message_uuid: String(row.message_uuid),
      role,
      message_kind: messageKind,
      body,
      event_seq: row.event_seq ?? null,
    },
  };
}

function fileChangeToItem(row: Record<string, unknown>): WorkbenchItem {
  const createdAt = String(row.created_at);
  const updatedAt = String(row.last_modified_at ?? row.created_at);
  return {
    item_uuid: stableItemUuid("file", String(row.temp_file_uuid)),
    session_uuid: String(row.session_uuid),
    kind: "file_change",
    created_at: createdAt,
    updated_at: updatedAt,
    payload: {
      temp_file_uuid: String(row.temp_file_uuid),
      virtual_path: String(row.virtual_path),
      r2_object_key: String(row.r2_object_key),
      mime: typeof row.mime === "string" ? row.mime : null,
      size_bytes: Number(row.size_bytes ?? 0),
      content_hash: typeof row.content_hash === "string" ? row.content_hash : null,
      written_by: String(row.written_by ?? "agent"),
      cleanup_status: String(row.cleanup_status ?? "pending"),
      expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
      change_kind: createdAt === updatedAt ? "created" : "modified",
    },
  };
}

function confirmationToItem(row: Record<string, unknown>): WorkbenchItem {
  const updatedAt =
    typeof row.decided_at === "string" && row.decided_at.length > 0
      ? row.decided_at
      : String(row.created_at);
  return {
    item_uuid: stableItemUuid("confirmation", String(row.confirmation_uuid)),
    session_uuid: String(row.session_uuid),
    kind: "confirmation",
    created_at: String(row.created_at),
    updated_at: updatedAt,
    payload: {
      confirmation_uuid: String(row.confirmation_uuid),
      kind: String(row.kind),
      status: String(row.status),
      body: parseRecord(row.payload_json),
      decision_payload: row.decision_payload_json ? parseRecord(row.decision_payload_json) : null,
    },
  };
}

function errorToItem(row: Record<string, unknown>): WorkbenchItem | null {
  if (typeof row.session_uuid !== "string" || row.session_uuid.length === 0) return null;
  return {
    item_uuid: stableItemUuid("error", String(row.log_uuid)),
    session_uuid: row.session_uuid,
    kind: "error",
    created_at: String(row.created_at),
    updated_at: String(row.created_at),
    payload: {
      log_uuid: String(row.log_uuid),
      trace_uuid: String(row.trace_uuid),
      worker: String(row.worker),
      source_role: typeof row.source_role === "string" ? row.source_role : null,
      code: String(row.code),
      category: String(row.category),
      severity: String(row.severity),
      http_status: row.http_status == null ? null : Number(row.http_status),
      message: String(row.message),
      context: parseRecord(row.context_json),
    },
  };
}

export class D1ItemProjectionPlane {
  constructor(private readonly db: D1Database) {}

  async list(input: {
    readonly session_uuid: string;
    readonly cursor?: string | null;
    readonly limit?: number;
  }): Promise<{ items: WorkbenchItem[]; next_cursor: string | null }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const items: WorkbenchItem[] = [];

    const messages = await this.db.prepare(
      `SELECT message_uuid, session_uuid, message_role, message_kind, body_json, created_at, event_seq
         FROM nano_conversation_messages
        WHERE session_uuid = ?1
          AND (?2 IS NULL OR created_at < ?2)
         ORDER BY created_at DESC
         LIMIT ?3`,
    ).bind(input.session_uuid, input.cursor ?? null, limit).all<Record<string, unknown>>();
    for (const row of messages.results ?? []) {
      const item = messageToItem(row);
      if (item) items.push(item);
    }

    const toolCalls = await new D1ToolCallLedger(this.db).listForSession({
      session_uuid: input.session_uuid,
      limit,
      cursor: input.cursor,
    });
    items.push(...toolCalls.rows.map(toolCallToItem));

    const fileChanges = await this.db.prepare(
      `SELECT temp_file_uuid, session_uuid, virtual_path, r2_object_key, mime,
              size_bytes, content_hash, last_modified_at, written_by, created_at,
              expires_at, cleanup_status
         FROM nano_session_temp_files
        WHERE session_uuid = ?1
          AND (?2 IS NULL OR last_modified_at < ?2)
        ORDER BY last_modified_at DESC
        LIMIT ?3`,
    ).bind(input.session_uuid, input.cursor ?? null, limit).all<Record<string, unknown>>();
    items.push(...(fileChanges.results ?? []).map(fileChangeToItem));

    const todos = await this.db.prepare(
      `SELECT session_uuid,
              COUNT(*) AS todo_count,
              MIN(created_at) AS created_at,
              MAX(updated_at) AS updated_at,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
              SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
              SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count
         FROM nano_session_todos
         WHERE session_uuid = ?1
           AND (?2 IS NULL OR updated_at < ?2)
         GROUP BY session_uuid`,
    ).bind(input.session_uuid, input.cursor ?? null).first<Record<string, unknown>>();
    if (todos?.updated_at) {
      items.push({
        item_uuid: stableItemUuid("todos", input.session_uuid),
        session_uuid: input.session_uuid,
        kind: "todo_list",
        created_at: String(todos.created_at ?? todos.updated_at),
        updated_at: String(todos.updated_at),
        payload: {
          todo_count: Number(todos.todo_count ?? 0),
          statuses: {
            pending: Number(todos.pending_count ?? 0),
            in_progress: Number(todos.in_progress_count ?? 0),
            completed: Number(todos.completed_count ?? 0),
            cancelled: Number(todos.cancelled_count ?? 0),
            blocked: Number(todos.blocked_count ?? 0),
          },
        },
      });
    }

    const confirmations = await this.db.prepare(
      `SELECT confirmation_uuid, session_uuid, kind, status, payload_json,
              decision_payload_json, created_at, decided_at
         FROM nano_session_confirmations
         WHERE session_uuid = ?1
           AND (?2 IS NULL OR COALESCE(decided_at, created_at) < ?2)
         ORDER BY COALESCE(decided_at, created_at) DESC
         LIMIT ?3`,
    ).bind(input.session_uuid, input.cursor ?? null, limit).all<Record<string, unknown>>();
    items.push(...(confirmations.results ?? []).map(confirmationToItem));

    const errors = await this.db.prepare(
      `SELECT log_uuid, trace_uuid, session_uuid, worker, source_role, code,
              category, severity, http_status, message, context_json, created_at
         FROM nano_error_log
        WHERE session_uuid = ?1
          AND (?2 IS NULL OR created_at < ?2)
        ORDER BY created_at DESC
        LIMIT ?3`,
    ).bind(input.session_uuid, input.cursor ?? null, limit).all<Record<string, unknown>>();
    for (const row of errors.results ?? []) {
      const item = errorToItem(row);
      if (item) items.push(item);
    }

    items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const page = items.slice(0, limit);
    return {
      items: page,
      next_cursor: items.length > limit ? page.at(-1)?.updated_at ?? null : null,
    };
  }

  async read(itemUuid: string): Promise<WorkbenchItem | null> {
    const messages = await this.db.prepare(
      `SELECT message_uuid, session_uuid, message_role, message_kind, body_json, created_at, event_seq
         FROM nano_conversation_messages`,
    ).all<Record<string, unknown>>();
    for (const row of messages.results ?? []) {
      const item = messageToItem(row);
      if (item?.item_uuid === itemUuid) return item;
    }

    const tool = await this.db.prepare(
      `SELECT request_uuid, session_uuid, conversation_uuid, turn_uuid, team_uuid,
              tool_name, input_json, output_json, status, cancel_initiator,
              started_at, ended_at, updated_at
         FROM nano_tool_call_ledger`,
    ).all<Record<string, unknown>>();
    for (const row of tool.results ?? []) {
      const item = toolCallToItem({
        request_uuid: String(row.request_uuid),
        session_uuid: String(row.session_uuid),
        conversation_uuid: typeof row.conversation_uuid === "string" ? row.conversation_uuid : null,
        turn_uuid: typeof row.turn_uuid === "string" ? row.turn_uuid : null,
        team_uuid: String(row.team_uuid),
        tool_name: String(row.tool_name),
        input: parseRecord(row.input_json),
        output: row.output_json ? parseRecord(row.output_json) : null,
        status: String(row.status) as ToolCallLedgerRow["status"],
        cancel_initiator: typeof row.cancel_initiator === "string"
          ? row.cancel_initiator as ToolCallLedgerRow["cancel_initiator"]
          : null,
        started_at: String(row.started_at),
        ended_at: typeof row.ended_at === "string" ? row.ended_at : null,
        updated_at: String(row.updated_at),
      });
      if (item.item_uuid === itemUuid) return item;
    }

    const files = await this.db.prepare(
      `SELECT temp_file_uuid, session_uuid, virtual_path, r2_object_key, mime,
              size_bytes, content_hash, last_modified_at, written_by, created_at,
              expires_at, cleanup_status
         FROM nano_session_temp_files`,
    ).all<Record<string, unknown>>();
    for (const row of files.results ?? []) {
      const item = fileChangeToItem(row);
      if (item.item_uuid === itemUuid) return item;
    }

    const todoSessions = await this.db.prepare(
      `SELECT DISTINCT session_uuid
         FROM nano_session_todos`,
    ).all<Record<string, unknown>>();
    for (const row of todoSessions.results ?? []) {
      const sessionUuid = String(row.session_uuid ?? "");
      if (stableItemUuid("todos", sessionUuid) !== itemUuid) continue;
      const todos = await this.db.prepare(
        `SELECT todo_uuid, parent_todo_uuid, content, status, created_at, updated_at, completed_at
           FROM nano_session_todos
          WHERE session_uuid = ?1
          ORDER BY created_at ASC, todo_uuid ASC`,
      ).bind(sessionUuid).all<Record<string, unknown>>();
      if ((todos.results ?? []).length === 0) return null;
      const createdAt = String(todos.results?.[0]?.created_at ?? new Date(0).toISOString());
      const updatedAt = String(
        [...(todos.results ?? [])]
          .sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")))[0]
          ?.updated_at ?? createdAt,
      );
      return {
        item_uuid: itemUuid,
        session_uuid: sessionUuid,
        kind: "todo_list",
        created_at: createdAt,
        updated_at: updatedAt,
        payload: {
          todo_count: (todos.results ?? []).length,
          todos: (todos.results ?? []).map((todo) => ({
            todo_uuid: String(todo.todo_uuid),
            parent_todo_uuid: typeof todo.parent_todo_uuid === "string" ? todo.parent_todo_uuid : null,
            content: String(todo.content),
            status: String(todo.status),
            created_at: String(todo.created_at),
            updated_at: String(todo.updated_at),
            completed_at: typeof todo.completed_at === "string" ? todo.completed_at : null,
          })),
        },
      };
    }

    const confirmations = await this.db.prepare(
      `SELECT confirmation_uuid, session_uuid, kind, status, payload_json,
              decision_payload_json, created_at, decided_at
         FROM nano_session_confirmations`,
    ).all<Record<string, unknown>>();
    for (const row of confirmations.results ?? []) {
      const item = confirmationToItem(row);
      if (item.item_uuid === itemUuid) return item;
    }

    const errors = await this.db.prepare(
      `SELECT log_uuid, trace_uuid, session_uuid, worker, source_role, code,
              category, severity, http_status, message, context_json, created_at
         FROM nano_error_log`,
    ).all<Record<string, unknown>>();
    for (const row of errors.results ?? []) {
      const item = errorToItem(row);
      if (item?.item_uuid === itemUuid) return item;
    }
    return null;
  }
}
