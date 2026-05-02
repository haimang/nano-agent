import { createRequire } from "node:module";
import { beforeEach, describe, expect, it } from "vitest";
import { D1ItemProjectionPlane } from "../src/item-projection-plane.js";

interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

interface SqliteStatementApi {
  all: (...args: unknown[]) => unknown[];
  get: (...args: unknown[]) => unknown;
  run: (...args: unknown[]) => SqliteRunResult;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementApi;
  close(): void;
}

const requireFromHere = createRequire(import.meta.url);
const { DatabaseSync } = requireFromHere("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function adaptD1(db: SqliteDatabase): D1Database {
  function prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        const stmt = db.prepare(sql);
        return {
          async first<T>() {
            return (stmt.get(...(args as never[])) ?? null) as T | null;
          },
          async all<T>() {
            return { results: stmt.all(...(args as never[])) as T[] };
          },
          async run() {
            stmt.run(...(args as never[]));
            return { success: true } as { success: boolean };
          },
        };
      },
      async all<T>() {
        return { results: db.prepare(sql).all() as T[] };
      },
    };
  }
  return { prepare } as unknown as D1Database;
}

function createInMemoryDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE nano_conversation_messages (
       message_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       message_role TEXT NOT NULL,
       message_kind TEXT NOT NULL,
       body_json TEXT NOT NULL,
       created_at TEXT NOT NULL,
       event_seq INTEGER
     );
     CREATE TABLE nano_tool_call_ledger (
       request_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       conversation_uuid TEXT,
       turn_uuid TEXT,
       team_uuid TEXT NOT NULL,
       tool_name TEXT NOT NULL,
       input_json TEXT NOT NULL,
       output_json TEXT,
       status TEXT NOT NULL,
       cancel_initiator TEXT,
       started_at TEXT NOT NULL,
       ended_at TEXT,
       updated_at TEXT NOT NULL
     );
     CREATE TABLE nano_session_temp_files (
       temp_file_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       team_uuid TEXT NOT NULL,
       virtual_path TEXT NOT NULL,
       r2_object_key TEXT NOT NULL,
       mime TEXT,
       size_bytes INTEGER NOT NULL,
       content_hash TEXT,
       last_modified_at TEXT NOT NULL,
       written_by TEXT NOT NULL,
       created_at TEXT NOT NULL,
       expires_at TEXT,
       cleanup_status TEXT NOT NULL
     );
     CREATE TABLE nano_session_todos (
       todo_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       conversation_uuid TEXT NOT NULL,
       team_uuid TEXT NOT NULL,
       parent_todo_uuid TEXT,
       content TEXT NOT NULL,
       status TEXT NOT NULL,
       created_at TEXT NOT NULL,
       updated_at TEXT NOT NULL,
       completed_at TEXT
     );
     CREATE TABLE nano_session_confirmations (
       confirmation_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       kind TEXT NOT NULL,
       payload_json TEXT NOT NULL,
       status TEXT NOT NULL,
       decision_payload_json TEXT,
       created_at TEXT NOT NULL,
       decided_at TEXT,
       expires_at TEXT
     );
     CREATE TABLE nano_error_log (
       log_uuid TEXT PRIMARY KEY,
       trace_uuid TEXT NOT NULL,
       session_uuid TEXT,
       team_uuid TEXT,
       worker TEXT NOT NULL,
       source_role TEXT,
       code TEXT NOT NULL,
       category TEXT NOT NULL,
       severity TEXT NOT NULL,
       http_status INTEGER,
       message TEXT NOT NULL,
       context_json TEXT,
       rpc_log_failed INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL
     );`,
  );
  db.exec(
    `INSERT INTO nano_conversation_messages VALUES
       ('m1', '${SESSION_UUID}', 'assistant', 'assistant.message', '{"text":"done"}', '2026-05-02T00:00:01Z', NULL),
       ('m2', '${SESSION_UUID}', 'assistant', 'stream-event', '{"kind":"llm.delta","content_type":"reasoning","text":"thinking"}', '2026-05-02T00:00:02Z', 2);
     INSERT INTO nano_tool_call_ledger VALUES
       ('tool-1', '${SESSION_UUID}', '${CONVERSATION_UUID}', NULL, '${TEAM_UUID}', 'bash', '{"command":"pwd"}', '{"ok":true}', 'succeeded', NULL, '2026-05-02T00:00:03Z', '2026-05-02T00:00:04Z', '2026-05-02T00:00:04Z');
     INSERT INTO nano_session_temp_files VALUES
       ('f1', '${SESSION_UUID}', '${TEAM_UUID}', 'notes.md', 'tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/notes.md', 'text/markdown', 12, 'hash-1', '2026-05-02T00:00:05Z', 'agent', '2026-05-02T00:00:05Z', NULL, 'pending');
     INSERT INTO nano_session_todos VALUES
       ('t1', '${SESSION_UUID}', '${CONVERSATION_UUID}', '${TEAM_UUID}', NULL, 'ship it', 'pending', '2026-05-02T00:00:06Z', '2026-05-02T00:00:06Z', NULL);
     INSERT INTO nano_session_confirmations VALUES
       ('c1', '${SESSION_UUID}', 'tool_permission', '{"tool_name":"bash"}', 'allowed', '{"decision":"allow"}', '2026-05-02T00:00:07Z', '2026-05-02T00:00:08Z', NULL);
     INSERT INTO nano_error_log VALUES
       ('e1', 'trace-1', '${SESSION_UUID}', '${TEAM_UUID}', 'agent-core', 'host', 'internal-error', 'transient', 'error', 500, 'boom', '{"phase":"tool"}', 0, '2026-05-02T00:00:09Z');`,
  );
  return db;
}

describe("HPX6 item projection plane", () => {
  let sqlite: SqliteDatabase;
  let plane: D1ItemProjectionPlane;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    plane = new D1ItemProjectionPlane(adaptD1(sqlite));
  });

  it("lists all 7 workbench item kinds from durable sources", async () => {
    const result = await plane.list({ session_uuid: SESSION_UUID, limit: 20 });
    expect(new Set(result.items.map((item) => item.kind))).toEqual(
      new Set([
        "agent_message",
        "reasoning",
        "tool_call",
        "file_change",
        "todo_list",
        "confirmation",
        "error",
      ]),
    );
  });

  it("reads file_change, todo_list, and error details by item_uuid", async () => {
    const list = await plane.list({ session_uuid: SESSION_UUID, limit: 20 });
    const fileItem = list.items.find((item) => item.kind === "file_change");
    const todoItem = list.items.find((item) => item.kind === "todo_list");
    const errorItem = list.items.find((item) => item.kind === "error");
    expect(fileItem).toBeDefined();
    expect(todoItem).toBeDefined();
    expect(errorItem).toBeDefined();

    await expect(plane.read(fileItem!.item_uuid)).resolves.toMatchObject({
      kind: "file_change",
      payload: { virtual_path: "notes.md", change_kind: "created" },
    });
    await expect(plane.read(todoItem!.item_uuid)).resolves.toMatchObject({
      kind: "todo_list",
      payload: {
        todo_count: 1,
        todos: [{ content: "ship it", status: "pending" }],
      },
    });
    await expect(plane.read(errorItem!.item_uuid)).resolves.toMatchObject({
      kind: "error",
      payload: { code: "internal-error", worker: "agent-core" },
    });
  });
});
