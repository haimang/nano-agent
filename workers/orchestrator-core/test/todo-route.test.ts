// HP6 P1-02 — `/sessions/{id}/todos` public route tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F1
//   * workers/orchestrator-core/migrations/010-agentic-loop-todos.sql

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
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

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function createDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE nano_user_devices (
       device_uuid TEXT PRIMARY KEY,
       status TEXT
     );
     CREATE TABLE nano_teams (team_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversations (conversation_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_sessions (session_uuid TEXT PRIMARY KEY);`,
  );
  db.exec(
    `INSERT INTO nano_teams VALUES ('${TEAM_UUID}');
     INSERT INTO nano_conversations VALUES ('${CONVERSATION_UUID}');
     INSERT INTO nano_conversation_sessions VALUES ('${SESSION_UUID}');`,
  );
  const todosMigration = resolve(
    __dirname,
    "..",
    "migrations",
    "010-agentic-loop-todos.sql",
  );
  db.exec(readFileSync(todosMigration, "utf8"));
  return db;
}

// Adapter that proxies the route's `readSessionLifecycle` SELECT against
// our minimal in-memory schema. The full SessionTruthRepository SQL is
// complex; for HP6 first-wave tests we shim the lifecycle query with a
// hand-rolled mock D1 layered on top of node:sqlite for the todo
// queries.
function adaptD1(db: SqliteDatabase): D1Database {
  function prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        // Lifecycle gate: SessionTruthRepository.readSessionLifecycle uses
        // a JOIN that's not present in our minimal schema; intercept it.
        if (
          sql.includes("FROM nano_conversation_sessions s") &&
          sql.includes("JOIN nano_conversations c")
        ) {
          return {
            async first<T>() {
              return {
                conversation_uuid: CONVERSATION_UUID,
                session_uuid: SESSION_UUID,
                team_uuid: TEAM_UUID,
                actor_user_uuid: USER_UUID,
                session_status: "detached",
                started_at: "2026-04-29T00:00:00Z",
                ended_at: null,
                ended_reason: null,
                last_phase: "attached",
                title: null,
                deleted_at: null,
              } as unknown as T;
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async run() {
              return { success: true };
            },
          };
        }
        // Device gate: pretend device row exists & active.
        if (sql.includes("FROM nano_user_devices")) {
          return {
            async first<T>() {
              return { status: "active" } as unknown as T;
            },
            async all<T>() {
              return { results: [] as T[] };
            },
            async run() {
              return { success: true };
            },
          };
        }
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
    };
  }
  return { prepare } as unknown as D1Database;
}

describe("HP6 /sessions/{id}/todos public routes", () => {
  let sqlite: SqliteDatabase;
  let env: Record<string, unknown>;

  beforeEach(() => {
    sqlite = createDb();
    env = {
      JWT_SECRET,
      TEAM_UUID: "nano-agent",
      NANO_AGENT_DB: adaptD1(sqlite),
      ORCHESTRATOR_USER_DO: {} as unknown,
    };
  });

  async function authedRequest(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    return worker.fetch(
      new Request(`https://example.com${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          ...((init.headers as Record<string, string>) ?? {}),
        },
      }),
      env as never,
    );
  }

  it("POST /todos creates a pending todo (default status)", async () => {
    const response = await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "review pr" }),
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).todo).toMatchObject({
      content: "review pr",
      status: "pending",
    });
  });

  it("POST /todos rejects status=deferred (invalid)", async () => {
    const response = await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x", status: "deferred" }),
    });
    expect(response.status).toBe(400);
  });

  it("POST /todos returns 409 when at-most-1 in_progress invariant is violated", async () => {
    await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first", status: "in_progress" }),
    });
    const second = await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "second", status: "in_progress" }),
    });
    expect(second.status).toBe(409);
  });

  it("GET /todos lists todos in created_at order", async () => {
    await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "first" }),
    });
    await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "second", status: "in_progress" }),
    });
    const list = await authedRequest(`/sessions/${SESSION_UUID}/todos`);
    expect(list.status).toBe(200);
    const data = ((await list.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const todos = data.todos as Array<Record<string, unknown>>;
    expect(todos).toHaveLength(2);
    expect(todos[0]?.content).toBe("first");
    expect(todos[1]?.content).toBe("second");
  });

  it("GET /todos?status=in_progress filters by status", async () => {
    await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "a" }),
    });
    await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "b", status: "in_progress" }),
    });
    const list = await authedRequest(
      `/sessions/${SESSION_UUID}/todos?status=in_progress`,
    );
    const data = ((await list.json()) as Record<string, unknown>).data as Record<string, unknown>;
    const todos = data.todos as Array<Record<string, unknown>>;
    expect(todos).toHaveLength(1);
    expect(todos[0]?.content).toBe("b");
  });

  it("PATCH /todos/{id} updates status and bumps completed_at", async () => {
    const created = await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "task" }),
    });
    const todoUuid = ((await created.json()) as { data: { todo: { todo_uuid: string } } }).data.todo.todo_uuid;
    const patched = await authedRequest(
      `/sessions/${SESSION_UUID}/todos/${todoUuid}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      },
    );
    expect(patched.status).toBe(200);
    const todo = ((await patched.json()) as { data: { todo: Record<string, unknown> } }).data.todo;
    expect(todo.status).toBe("completed");
    expect(todo.completed_at).not.toBeNull();
  });

  it("DELETE /todos/{id} removes the row and returns 404 on second delete", async () => {
    const created = await authedRequest(`/sessions/${SESSION_UUID}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "task" }),
    });
    const todoUuid = ((await created.json()) as { data: { todo: { todo_uuid: string } } }).data.todo.todo_uuid;
    const first = await authedRequest(
      `/sessions/${SESSION_UUID}/todos/${todoUuid}`,
      { method: "DELETE" },
    );
    expect(first.status).toBe(200);
    const second = await authedRequest(
      `/sessions/${SESSION_UUID}/todos/${todoUuid}`,
      { method: "DELETE" },
    );
    expect(second.status).toBe(404);
  });
});
