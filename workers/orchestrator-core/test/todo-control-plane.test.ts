// HP6 P1-01 — D1TodoControlPlane unit tests against in-memory `node:sqlite`.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F1
//   * workers/orchestrator-core/migrations/010-agentic-loop-todos.sql

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  D1TodoControlPlane,
  TODO_STATUSES,
  TodoConstraintError,
} from "../src/todo-control-plane.js";

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
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";

function createInMemoryDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE nano_teams (team_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversations (conversation_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_sessions (session_uuid TEXT PRIMARY KEY);`,
  );
  db.exec(
    `INSERT INTO nano_teams VALUES ('${TEAM_UUID}');
     INSERT INTO nano_conversations VALUES ('${CONVERSATION_UUID}');
     INSERT INTO nano_conversation_sessions VALUES ('${SESSION_UUID}');`,
  );
  const migrationPath = resolve(
    __dirname,
    "..",
    "migrations",
    "010-agentic-loop-todos.sql",
  );
  db.exec(readFileSync(migrationPath, "utf8"));
  return db;
}

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
    };
  }
  return { prepare } as unknown as D1Database;
}

describe("HP6 todo registry — frozen enums", () => {
  it("has 5 statuses (charter §436) and only those", () => {
    expect(TODO_STATUSES).toEqual([
      "pending",
      "in_progress",
      "completed",
      "cancelled",
      "blocked",
    ]);
  });
});

describe("HP6 todo registry — D1TodoControlPlane", () => {
  let sqlite: SqliteDatabase;
  let plane: D1TodoControlPlane;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    plane = new D1TodoControlPlane(adaptD1(sqlite));
  });

  function makeTodo(overrides: Partial<{ status: import("../src/todo-control-plane.js").TodoStatus; content: string }> = {}) {
    return plane.create({
      session_uuid: SESSION_UUID,
      conversation_uuid: CONVERSATION_UUID,
      team_uuid: TEAM_UUID,
      content: overrides.content ?? "review pr",
      status: overrides.status,
      created_at: "2026-04-30T00:00:00Z",
    });
  }

  it("creates a pending todo by default", async () => {
    const todo = await makeTodo();
    expect(todo).toMatchObject({
      session_uuid: SESSION_UUID,
      content: "review pr",
      status: "pending",
      completed_at: null,
    });
  });

  it("creates a completed todo with completed_at set", async () => {
    const todo = await makeTodo({ status: "completed" });
    expect(todo.status).toBe("completed");
    expect(todo.completed_at).toBe("2026-04-30T00:00:00Z");
  });

  it("rejects creating a second in_progress todo (at-most-1 invariant)", async () => {
    await makeTodo({ status: "in_progress", content: "first" });
    await expect(makeTodo({ status: "in_progress", content: "second" }))
      .rejects.toBeInstanceOf(TodoConstraintError);
  });

  it("lists todos filtered by status", async () => {
    await makeTodo({ content: "a" });
    await makeTodo({ status: "in_progress", content: "b" });
    const all = await plane.list({ session_uuid: SESSION_UUID });
    expect(all).toHaveLength(2);
    const inProgress = await plane.list({
      session_uuid: SESSION_UUID,
      status: "in_progress",
    });
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]!.content).toBe("b");
  });

  it("patches status and bumps updated_at + completed_at on terminal", async () => {
    const todo = await makeTodo();
    const next = await plane.patch({
      session_uuid: SESSION_UUID,
      todo_uuid: todo.todo_uuid,
      status: "completed",
      updated_at: "2026-04-30T01:00:00Z",
    });
    expect(next).toMatchObject({
      status: "completed",
      updated_at: "2026-04-30T01:00:00Z",
      completed_at: "2026-04-30T01:00:00Z",
    });
  });

  it("patch rejects setting in_progress when another todo holds it", async () => {
    await makeTodo({ status: "in_progress", content: "first" });
    const second = await makeTodo({ content: "second" });
    await expect(
      plane.patch({
        session_uuid: SESSION_UUID,
        todo_uuid: second.todo_uuid,
        status: "in_progress",
        updated_at: "2026-04-30T01:00:00Z",
      }),
    ).rejects.toBeInstanceOf(TodoConstraintError);
  });

  it("patch allows the in_progress holder to keep its status without conflict", async () => {
    const todo = await makeTodo({ status: "in_progress" });
    const next = await plane.patch({
      session_uuid: SESSION_UUID,
      todo_uuid: todo.todo_uuid,
      content: "renamed",
      updated_at: "2026-04-30T01:00:00Z",
    });
    expect(next).toMatchObject({
      content: "renamed",
      status: "in_progress",
    });
  });

  it("delete removes a todo and is idempotent", async () => {
    const todo = await makeTodo();
    expect(
      await plane.delete({
        session_uuid: SESSION_UUID,
        todo_uuid: todo.todo_uuid,
      }),
    ).toBe(true);
    expect(
      await plane.delete({
        session_uuid: SESSION_UUID,
        todo_uuid: todo.todo_uuid,
      }),
    ).toBe(false);
  });

  it("rejects unknown status at the SQL CHECK boundary (helper trusts handler pre-validate)", async () => {
    // HPX3 F1 — domain layer no longer throws `invalid-status`; the
    // facade handler pre-validates the enum (`session-control.ts`
    // `isTodoStatus` guard). If a bad status somehow reached the plane
    // it bubbles up as a D1 CHECK constraint error rather than a
    // typed `TodoConstraintError`. The integrity invariant is still
    // enforced — see the explicit SQL CHECK test below for proof.
    await expect(
      plane.create({
        session_uuid: SESSION_UUID,
        conversation_uuid: CONVERSATION_UUID,
        team_uuid: TEAM_UUID,
        content: "x",
        // @ts-expect-error
        status: "deferred",
        created_at: "2026-04-30T00:00:00Z",
      }),
    ).rejects.toThrow(/CHECK constraint failed: status/);
  });

  it("rejects unknown status at the SQL CHECK boundary", async () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO nano_session_todos (
           todo_uuid, session_uuid, conversation_uuid, team_uuid,
           content, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "44444444-4444-4444-8444-444444444444",
        SESSION_UUID,
        CONVERSATION_UUID,
        TEAM_UUID,
        "x",
        "deferred",
        "2026-04-30T00:00:00Z",
        "2026-04-30T00:00:00Z",
      );
    }).toThrow();
  });
});
