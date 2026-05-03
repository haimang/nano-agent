// HP5 P1-01 — D1ConfirmationControlPlane unit tests against in-memory
// `node:sqlite`. Same pattern as test/migrations-schema-freeze.test.ts:
// `createRequire` is used so Vite / Vitest's resolver does not try to
// resolve Node 22's experimental `node:sqlite` builtin through the Vite
// module graph (which fails because it is not in Vite's known builtin
// list).
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F1/F3
//   * docs/design/hero-to-pro/HPX-qna.md Q16 / Q18
//   * workers/orchestrator-core/migrations/012-session-confirmations.sql

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  D1ConfirmationControlPlane,
  CONFIRMATION_KINDS,
  CONFIRMATION_STATUSES,
} from "../src/confirmation-control-plane.js";

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
const CONFIRMATION_UUID = "22222222-2222-4222-8222-222222222222";

function createInMemoryDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  // We only need the bare minimum to satisfy the FK from
  // nano_session_confirmations.session_uuid → nano_conversation_sessions.
  db.exec(
    `CREATE TABLE nano_conversation_sessions (
       session_uuid TEXT PRIMARY KEY
     );`,
  );
  db.exec(
    `INSERT INTO nano_conversation_sessions (session_uuid)
       VALUES ('${SESSION_UUID}');`,
  );
  // Apply migration 012 verbatim.
  const migrationPath = resolve(
    __dirname,
    "..",
    "migrations",
    "012-session-confirmations.sql",
  );
  db.exec(readFileSync(migrationPath, "utf8"));
  return db;
}

// Adapt `node:sqlite` to D1Database surface that the helper exercises.
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

describe("HP5 confirmation registry — frozen enums", () => {
  it("has 7 kinds (Q18) and exactly those", () => {
    expect(CONFIRMATION_KINDS).toEqual([
      "tool_permission",
      "elicitation",
      "model_switch",
      "context_compact",
      "fallback_model",
      "checkpoint_restore",
      "context_loss",
    ]);
    expect(CONFIRMATION_KINDS.length).toBe(7);
    expect(CONFIRMATION_KINDS).not.toContain("tool_cancel");
    expect(CONFIRMATION_KINDS).not.toContain("custom");
  });

  it("has 6 statuses (Q16) and excludes failed", () => {
    expect(CONFIRMATION_STATUSES).toEqual([
      "pending",
      "allowed",
      "denied",
      "modified",
      "timeout",
      "superseded",
    ]);
    expect(CONFIRMATION_STATUSES).not.toContain("failed");
  });
});

describe("HP5 confirmation registry — D1ConfirmationControlPlane", () => {
  let sqlite: SqliteDatabase;
  let plane: D1ConfirmationControlPlane;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    plane = new D1ConfirmationControlPlane(adaptD1(sqlite));
  });

  it("creates a pending confirmation row", async () => {
    const row = await plane.create({
      confirmation_uuid: CONFIRMATION_UUID,
      session_uuid: SESSION_UUID,
      kind: "tool_permission",
      payload: { tool_name: "bash", tool_input: { command: "ls" } },
      created_at: "2026-04-30T00:00:00Z",
      expires_at: "2026-04-30T00:00:30Z",
    });
    expect(row).toMatchObject({
      confirmation_uuid: CONFIRMATION_UUID,
      session_uuid: SESSION_UUID,
      kind: "tool_permission",
      status: "pending",
      decision_payload: null,
      payload: { tool_name: "bash", tool_input: { command: "ls" } },
      expires_at: "2026-04-30T00:00:30Z",
    });
  });

  it("lists confirmations filtered by status", async () => {
    await plane.create({
      confirmation_uuid: CONFIRMATION_UUID,
      session_uuid: SESSION_UUID,
      kind: "tool_permission",
      payload: { tool_name: "bash" },
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    const all = await plane.list({ session_uuid: SESSION_UUID });
    expect(all).toHaveLength(1);
    const pending = await plane.list({
      session_uuid: SESSION_UUID,
      status: "pending",
    });
    expect(pending).toHaveLength(1);
    const allowed = await plane.list({
      session_uuid: SESSION_UUID,
      status: "allowed",
    });
    expect(allowed).toHaveLength(0);
  });

  it("applies an allow decision and records decision_payload", async () => {
    await plane.create({
      confirmation_uuid: CONFIRMATION_UUID,
      session_uuid: SESSION_UUID,
      kind: "tool_permission",
      payload: { tool_name: "bash" },
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    const result = await plane.applyDecision({
      session_uuid: SESSION_UUID,
      confirmation_uuid: CONFIRMATION_UUID,
      status: "allowed",
      decision_payload: { decision: "allow", scope: "once" },
      decided_at: "2026-04-30T00:01:00Z",
    });
    expect(result.conflict).toBe(false);
    expect(result.row).toMatchObject({
      status: "allowed",
      decision_payload: { decision: "allow", scope: "once" },
      decided_at: "2026-04-30T00:01:00Z",
    });
  });

  it("returns conflict when re-deciding an already terminal row with a different status", async () => {
    await plane.create({
      confirmation_uuid: CONFIRMATION_UUID,
      session_uuid: SESSION_UUID,
      kind: "tool_permission",
      payload: { tool_name: "bash" },
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    await plane.applyDecision({
      session_uuid: SESSION_UUID,
      confirmation_uuid: CONFIRMATION_UUID,
      status: "allowed",
      decision_payload: null,
      decided_at: "2026-04-30T00:01:00Z",
    });
    const second = await plane.applyDecision({
      session_uuid: SESSION_UUID,
      confirmation_uuid: CONFIRMATION_UUID,
      status: "denied",
      decision_payload: null,
      decided_at: "2026-04-30T00:02:00Z",
    });
    expect(second.conflict).toBe(true);
    expect(second.row?.status).toBe("allowed");
  });

  it("applyDecision rejects pending status", async () => {
    await expect(
      plane.applyDecision({
        session_uuid: SESSION_UUID,
        confirmation_uuid: CONFIRMATION_UUID,
        // @ts-expect-error — pending is not a valid terminal
        status: "pending",
        decision_payload: null,
        decided_at: "2026-04-30T00:01:00Z",
      }),
    ).rejects.toThrow(/terminal status/);
  });

  it("dual-write failure escalates the row to superseded with audit details (Q16: never `failed`)", async () => {
    await plane.create({
      confirmation_uuid: CONFIRMATION_UUID,
      session_uuid: SESSION_UUID,
      kind: "elicitation",
      payload: { prompt: "Pick one" },
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    await plane.applyDecision({
      session_uuid: SESSION_UUID,
      confirmation_uuid: CONFIRMATION_UUID,
      status: "modified",
      decision_payload: { answer: { choice: "A" } },
      decided_at: "2026-04-30T00:00:30Z",
    });
    const row = await plane.markSupersededOnDualWriteFailure({
      session_uuid: SESSION_UUID,
      confirmation_uuid: CONFIRMATION_UUID,
      attempted_status: "modified",
      attempted_decision: { answer: { choice: "A" } },
      failure_reason: "session-do-recordAsyncAnswer-timeout",
      decided_at: "2026-04-30T00:01:00Z",
    });
    expect(row?.status).toBe("superseded");
    expect(row?.decision_payload).toMatchObject({
      attempted_status: "modified",
      failure_reason: "session-do-recordAsyncAnswer-timeout",
    });
  });

  it("rejects unknown kinds at the SQL CHECK boundary", async () => {
    // Direct SQL bypass — should be rejected by the migration's CHECK
    // (not by the helper, but the contract is the same).
    expect(() => {
      sqlite.prepare(
        `INSERT INTO nano_session_confirmations (
           confirmation_uuid, session_uuid, kind, payload_json,
           status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "33333333-3333-4333-8333-333333333333",
        SESSION_UUID,
        "tool_cancel",
        "{}",
        "pending",
        "2026-04-30T00:00:00Z",
      );
    }).toThrow();
  });

  it("rejects unknown statuses at the SQL CHECK boundary", async () => {
    expect(() => {
      sqlite.prepare(
        `INSERT INTO nano_session_confirmations (
           confirmation_uuid, session_uuid, kind, payload_json,
           status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        "44444444-4444-4444-8444-444444444444",
        SESSION_UUID,
        "tool_permission",
        "{}",
        "failed",
        "2026-04-30T00:00:00Z",
      );
    }).toThrow();
  });
});
