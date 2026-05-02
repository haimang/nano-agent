import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    };
  }
  return { prepare } as unknown as D1Database;
}

function createInMemoryDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE nano_teams (team_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_user_devices (
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
     INSERT INTO nano_teams VALUES ('${TEAM_UUID}');
     INSERT INTO nano_user_devices VALUES ('${DEVICE_UUID}', '${USER_UUID}', '${TEAM_UUID}', 'active');
     INSERT INTO nano_conversations VALUES ('${CONVERSATION_UUID}', '${TEAM_UUID}', '${USER_UUID}', 'runtime session', NULL);
     INSERT INTO nano_conversation_sessions VALUES (
       '${SESSION_UUID}',
       '${CONVERSATION_UUID}',
       '${TEAM_UUID}',
       '${USER_UUID}',
       'running',
       '2026-05-02T00:00:00Z',
       NULL,
       NULL,
       NULL,
       NULL,
       NULL
     );`,
  );
  db.exec(
    readFileSync(
      resolve(__dirname, "..", "migrations", "016-session-runtime-config.sql"),
      "utf8",
    ),
  );
  db.exec(
    readFileSync(
      resolve(__dirname, "..", "migrations", "017-team-permission-rules.sql"),
      "utf8",
    ),
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

function buildEnv(db: SqliteDatabase, forwardedFrames: Array<Record<string, unknown>> = []) {
  return {
    JWT_SECRET,
    TEAM_UUID: "nano-agent",
    NANO_AGENT_DB: adaptD1(db),
    ORCHESTRATOR_USER_DO: {
      idFromName: (_name: string) => "stub-id",
      get: (_id: string) => ({
        fetch: async (request: Request) => {
          const body = await request.clone().json() as { frame?: Record<string, unknown> };
          if (body.frame) forwardedFrames.push(body.frame);
          return new Response(null, { status: 204 });
        },
      }),
    } as any,
  } as any;
}

describe("GET/PATCH /sessions/{id}/runtime", () => {
  it("GET returns an ETag for the merged runtime document", async () => {
    const db = createInMemoryDb();
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      buildEnv(db),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeTruthy();
    const body = await response.json() as { data: { version: number } };
    expect(body.data.version).toBe(1);
    db.close();
  });

  it("GET honors If-None-Match with 304", async () => {
    const db = createInMemoryDb();
    const token = await buildToken();
    const env = buildEnv(db);
    const first = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      env,
    );
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "if-none-match": etag!,
        },
      }),
      env,
    );

    expect(second.status).toBe(304);
    db.close();
  });

  it("PATCH accepts matching If-Match and emits session.runtime.update", async () => {
    const db = createInMemoryDb();
    const token = await buildToken();
    const forwardedFrames: Array<Record<string, unknown>> = [];
    const env = buildEnv(db, forwardedFrames);
    const first = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      env,
    );
    const etag = first.headers.get("etag");

    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "if-match": etag!,
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({
          version: 1,
          approval_policy: "always_allow",
        }),
      }),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("etag")).not.toBe(etag);
    const body = await response.json() as { data: { version: number; approval_policy: string } };
    expect(body.data.version).toBe(2);
    expect(body.data.approval_policy).toBe("always_allow");
    expect(forwardedFrames).toContainEqual(
      expect.objectContaining({
        kind: "session.runtime.update",
        session_uuid: SESSION_UUID,
        version: 2,
        approval_policy: "always_allow",
      }),
    );
    db.close();
  });

  it("PATCH rejects stale If-Match before applying the body version patch", async () => {
    const db = createInMemoryDb();
    const token = await buildToken();
    const env = buildEnv(db);
    const first = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      env,
    );
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "if-match": etag!,
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({
          version: 1,
          approval_policy: "deny",
        }),
      }),
      env,
    );

    const stale = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/runtime`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "if-match": etag!,
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({
          version: 2,
          approval_policy: "ask",
        }),
      }),
      env,
    );

    expect(stale.status).toBe(409);
    const body = await stale.json() as { error: { code: string } };
    expect(body.error.code).toBe("conflict");
    db.close();
  });
});
