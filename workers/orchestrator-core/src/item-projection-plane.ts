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
      const role = String(row.message_role ?? "");
      items.push({
        item_uuid: stableItemUuid("msg", String(row.message_uuid)),
        session_uuid: String(row.session_uuid),
        kind: role === "assistant" ? "agent_message" : "reasoning",
        created_at: String(row.created_at),
        updated_at: String(row.created_at),
        payload: {
          message_uuid: String(row.message_uuid),
          role,
          message_kind: String(row.message_kind),
          body: parseRecord(row.body_json),
          event_seq: row.event_seq ?? null,
        },
      });
    }

    const toolCalls = await new D1ToolCallLedger(this.db).listForSession({
      session_uuid: input.session_uuid,
      limit,
      cursor: input.cursor,
    });
    items.push(...toolCalls.rows.map(toolCallToItem));

    const todos = await this.db.prepare(
      `SELECT session_uuid, COUNT(*) AS todo_count, MAX(updated_at) AS updated_at
         FROM nano_session_todos
        WHERE session_uuid = ?1
        GROUP BY session_uuid`,
    ).bind(input.session_uuid).first<Record<string, unknown>>();
    if (todos?.updated_at) {
      items.push({
        item_uuid: stableItemUuid("todos", input.session_uuid),
        session_uuid: input.session_uuid,
        kind: "todo_list",
        created_at: String(todos.updated_at),
        updated_at: String(todos.updated_at),
        payload: { todo_count: Number(todos.todo_count ?? 0) },
      });
    }

    const confirmations = await this.db.prepare(
      `SELECT confirmation_uuid, session_uuid, kind, status, payload_json, created_at
         FROM nano_session_confirmations
        WHERE session_uuid = ?1
        ORDER BY created_at DESC
        LIMIT ?2`,
    ).bind(input.session_uuid, limit).all<Record<string, unknown>>();
    for (const row of confirmations.results ?? []) {
      items.push({
        item_uuid: stableItemUuid("confirmation", String(row.confirmation_uuid)),
        session_uuid: String(row.session_uuid),
        kind: "confirmation",
        created_at: String(row.created_at),
        updated_at: String(row.created_at),
        payload: {
          confirmation_uuid: String(row.confirmation_uuid),
          kind: String(row.kind),
          status: String(row.status),
          body: parseRecord(row.payload_json),
        },
      });
    }

    items.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    const page = items.slice(0, limit);
    return {
      items: page,
      next_cursor: items.length > limit ? page.at(-1)?.updated_at ?? null : null,
    };
  }

  async read(itemUuid: string): Promise<WorkbenchItem | null> {
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
    return null;
  }
}
