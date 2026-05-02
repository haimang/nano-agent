import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

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

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_UUID = "88888888-8888-4888-8888-888888888888";
const JWT_SECRET = "x".repeat(32);

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

function createInMemoryDb(ownerUserUuid = USER_UUID): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE nano_user_devices (
       device_uuid TEXT PRIMARY KEY,
       user_uuid TEXT NOT NULL,
       team_uuid TEXT NOT NULL,
       status TEXT NOT NULL
     );
     CREATE TABLE nano_conversations (
       conversation_uuid TEXT PRIMARY KEY,
       team_uuid TEXT NOT NULL,
       owner_user_uuid TEXT NOT NULL,
       title TEXT,
       deleted_at TEXT
     );
     CREATE TABLE nano_conversation_sessions (
       session_uuid TEXT PRIMARY KEY,
       conversation_uuid TEXT NOT NULL,
       team_uuid TEXT NOT NULL,
       actor_user_uuid TEXT NOT NULL,
       session_status TEXT NOT NULL,
       started_at TEXT NOT NULL,
       ended_at TEXT,
       ended_reason TEXT,
       last_phase TEXT,
       default_model_id TEXT,
       default_reasoning_effort TEXT
     );
     CREATE TABLE nano_conversation_messages (
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
     );
     INSERT INTO nano_user_devices VALUES ('${DEVICE_UUID}', '${USER_UUID}', '${TEAM_UUID}', 'active');
     INSERT INTO nano_conversations VALUES ('${CONVERSATION_UUID}', '${TEAM_UUID}', '${ownerUserUuid}', 'workbench', NULL);
     INSERT INTO nano_conversation_sessions VALUES (
       '${SESSION_UUID}',
       '${CONVERSATION_UUID}',
       '${TEAM_UUID}',
       '${ownerUserUuid}',
       'running',
       '2026-05-02T00:00:00Z',
       NULL,
       NULL,
       NULL,
       NULL,
       NULL
     );
     INSERT INTO nano_conversation_messages VALUES
       ('11111111-aaaa-4111-8111-111111111111', '${SESSION_UUID}', 'assistant', 'assistant.message', '{"text":"done"}', '2026-05-02T00:00:01Z', NULL),
       ('22222222-aaaa-4222-8222-222222222222', '${SESSION_UUID}', 'assistant', 'stream-event', '{"kind":"llm.delta","content_type":"reasoning","text":"thinking"}', '2026-05-02T00:00:02Z', 2);
     INSERT INTO nano_tool_call_ledger VALUES
       ('33333333-aaaa-4333-8333-333333333333', '${SESSION_UUID}', '${CONVERSATION_UUID}', NULL, '${TEAM_UUID}', 'bash', '{"command":"pwd"}', '{"ok":true}', 'succeeded', NULL, '2026-05-02T00:00:03Z', '2026-05-02T00:00:04Z', '2026-05-02T00:00:04Z');
     INSERT INTO nano_session_temp_files VALUES
       ('44444444-aaaa-4444-8444-444444444444', '${SESSION_UUID}', '${TEAM_UUID}', 'notes.md', 'tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/notes.md', 'text/markdown', 12, 'hash-1', '2026-05-02T00:00:05Z', 'agent', '2026-05-02T00:00:05Z', NULL, 'pending');
     INSERT INTO nano_session_todos VALUES
       ('55555555-aaaa-4555-8555-555555555555', '${SESSION_UUID}', '${CONVERSATION_UUID}', '${TEAM_UUID}', NULL, 'ship it', 'pending', '2026-05-02T00:00:06Z', '2026-05-02T00:00:06Z', NULL);
     INSERT INTO nano_session_confirmations VALUES
       ('66666666-aaaa-4666-8666-666666666666', '${SESSION_UUID}', 'tool_permission', '{"tool_name":"bash"}', 'allowed', '{"decision":"allow"}', '2026-05-02T00:00:07Z', '2026-05-02T00:00:08Z', NULL);
     INSERT INTO nano_error_log VALUES
       ('77777777-aaaa-4777-8777-777777777777', 'trace-1', '${SESSION_UUID}', '${TEAM_UUID}', 'agent-core', 'host', 'internal-error', 'transient', 'error', 500, 'boom', '{"phase":"tool"}', 0, '2026-05-02T00:00:09Z');`,
  );
  return db;
}

async function buildToken(): Promise<string> {
  return signTestJwt(
    {
      sub: USER_UUID,
      user_uuid: USER_UUID,
      team_uuid: TEAM_UUID,
      device_uuid: DEVICE_UUID,
    },
    JWT_SECRET,
  );
}

function buildEnv(db: SqliteDatabase) {
  return {
    JWT_SECRET,
    TEAM_UUID: "nano-agent",
    NANO_AGENT_DB: adaptD1(db),
    ORCHESTRATOR_USER_DO: {} as any,
  } as any;
}

describe("GET /sessions/{id}/items and /items/{item_uuid}", () => {
  it("lists all 7 workbench item kinds through the public route", async () => {
    const db = createInMemoryDb();
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/items`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      buildEnv(db),
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { items: Array<{ kind: string }> } };
    expect(new Set(body.data.items.map((item) => item.kind))).toEqual(
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
    db.close();
  });

  it("reads error item detail through the public route", async () => {
    const db = createInMemoryDb();
    const token = await buildToken();
    const listResponse = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/items`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      buildEnv(db),
    );
    const listBody = await listResponse.json() as { data: { items: Array<{ item_uuid: string; kind: string }> } };
    const errorItem = listBody.data.items.find((item) => item.kind === "error");
    expect(errorItem).toBeDefined();

    const detailResponse = await worker.fetch(
      new Request(`https://example.com/items/${errorItem!.item_uuid}`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      buildEnv(db),
    );

    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json() as { data: { item: { kind: string; payload: Record<string, unknown> } } };
    expect(detailBody.data.item.kind).toBe("error");
    expect(detailBody.data.item.payload).toMatchObject({
      code: "internal-error",
      worker: "agent-core",
    });
    db.close();
  });

  it("returns 404 when the session belongs to another user", async () => {
    const db = createInMemoryDb(OTHER_USER_UUID);
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/items`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      buildEnv(db),
    );

    expect(response.status).toBe(404);
    db.close();
  });
});
