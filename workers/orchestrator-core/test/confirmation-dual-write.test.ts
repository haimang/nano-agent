// HP5 P3-03 — row-first dual-write law on legacy permission/decision
// and elicitation/answer compat aliases.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F1/F3
//   * docs/design/hero-to-pro/HPX-qna.md Q16
//   * workers/orchestrator-core/migrations/012-session-confirmations.sql

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import { createUserDoSurfaceRuntime } from "../src/user-do/surface-runtime.js";

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
const REQUEST_UUID = "22222222-2222-4222-8222-222222222222";

function createInMemoryDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE nano_conversation_sessions (
       session_uuid TEXT PRIMARY KEY
     );`,
  );
  db.exec(
    `INSERT INTO nano_conversation_sessions (session_uuid)
       VALUES ('${SESSION_UUID}');`,
  );
  const migrationPath = resolve(
    __dirname,
    "..",
    "migrations",
    "012-session-confirmations.sql",
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

function readConfirmationRow(db: SqliteDatabase, confirmationUuid: string) {
  const row = db
    .prepare(
      `SELECT confirmation_uuid, kind, status, decision_payload_json
         FROM nano_session_confirmations
        WHERE confirmation_uuid = ?
        LIMIT 1`,
    )
    .get(confirmationUuid) as Record<string, unknown> | null;
  return row;
}

function makeCtx(d1: D1Database) {
  const store = new Map<string, unknown>();
  return {
    store,
    ctx: {
      env: { NANO_AGENT_DB: d1 },
      get: async <T>(key: string) =>
        store.has(key) ? (store.get(key) as T) : undefined,
      put: async <T>(key: string, value: T) => {
        store.set(key, value);
      },
      sessionTruth: () => null,
      readDurableSnapshot: async () => null,
      readDurableHistory: async () => [],
      requireReadableSession: async () => null,
      readAuditAuthSnapshot: async () => null,
      persistAudit: async () => undefined,
    },
  };
}

describe("HP5 row-first dual-write — legacy permission/decision", () => {
  let sqlite: SqliteDatabase;
  let d1: D1Database;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    d1 = adaptD1(sqlite);
  });

  it("writes a confirmation row before the legacy KV decision write", async () => {
    const { ctx, store } = makeCtx(d1);
    const surface = createUserDoSurfaceRuntime(ctx as never);
    const response = await surface.handlePermissionDecision(SESSION_UUID, {
      request_uuid: REQUEST_UUID,
      decision: "allow",
      scope: "once",
    });
    expect(response.status).toBe(200);
    const row = readConfirmationRow(sqlite, REQUEST_UUID);
    expect(row).toMatchObject({
      confirmation_uuid: REQUEST_UUID,
      kind: "tool_permission",
      status: "allowed",
    });
    const decisionPayload = JSON.parse(
      String(row?.decision_payload_json ?? "{}"),
    );
    expect(decisionPayload).toMatchObject({ decision: "allow", scope: "once" });
    // KV row exists
    expect(store.has(`permission_decision/${REQUEST_UUID}`)).toBe(true);
  });

  it("maps deny → denied (Q16: never `failed`)", async () => {
    const { ctx } = makeCtx(d1);
    const surface = createUserDoSurfaceRuntime(ctx as never);
    await surface.handlePermissionDecision(SESSION_UUID, {
      request_uuid: REQUEST_UUID,
      decision: "deny",
      scope: "once",
    });
    const row = readConfirmationRow(sqlite, REQUEST_UUID);
    expect(row?.status).toBe("denied");
  });

  it("returns 409 on conflicting re-decision (terminal row already exists)", async () => {
    const { ctx } = makeCtx(d1);
    const surface = createUserDoSurfaceRuntime(ctx as never);
    await surface.handlePermissionDecision(SESSION_UUID, {
      request_uuid: REQUEST_UUID,
      decision: "allow",
      scope: "once",
    });
    const second = await surface.handlePermissionDecision(SESSION_UUID, {
      request_uuid: REQUEST_UUID,
      decision: "deny",
      scope: "once",
    });
    expect(second.status).toBe(409);
  });
});

describe("HP5 row-first dual-write — legacy elicitation/answer", () => {
  let sqlite: SqliteDatabase;
  let d1: D1Database;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    d1 = adaptD1(sqlite);
  });

  it("writes an elicitation confirmation row with status=modified", async () => {
    const { ctx } = makeCtx(d1);
    const surface = createUserDoSurfaceRuntime(ctx as never);
    const response = await surface.handleElicitationAnswer(SESSION_UUID, {
      request_uuid: REQUEST_UUID,
      answer: { choice: "A" },
    });
    expect(response.status).toBe(200);
    const row = readConfirmationRow(sqlite, REQUEST_UUID);
    expect(row).toMatchObject({
      kind: "elicitation",
      status: "modified",
    });
  });

  it("cancelled answer maps to status=superseded (Q16)", async () => {
    const { ctx } = makeCtx(d1);
    const surface = createUserDoSurfaceRuntime(ctx as never);
    await surface.handleElicitationAnswer(SESSION_UUID, {
      request_uuid: REQUEST_UUID,
      answer: null,
      cancelled: true,
    });
    const row = readConfirmationRow(sqlite, REQUEST_UUID);
    expect(row?.status).toBe("superseded");
  });
});
