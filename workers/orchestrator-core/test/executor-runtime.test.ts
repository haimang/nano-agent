import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  D1CheckpointRestoreJobs,
} from "../src/checkpoint-restore-plane.js";
import { runExecutorJob } from "../src/executor-runtime.js";

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
const CHECKPOINT_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONFIRMATION_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
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
     CREATE TABLE nano_conversations (conversation_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_sessions (session_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_turns (turn_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_session_temp_files (temp_file_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_session_files (file_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_context_snapshots (snapshot_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_session_confirmations (confirmation_uuid TEXT PRIMARY KEY);
     INSERT INTO nano_teams VALUES ('${TEAM_UUID}');
     INSERT INTO nano_conversations VALUES ('${CONVERSATION_UUID}');
     INSERT INTO nano_conversation_sessions VALUES ('${SESSION_UUID}');
     INSERT INTO nano_session_confirmations VALUES ('${CONFIRMATION_UUID}');`,
  );
  db.exec(
    readFileSync(
      resolve(__dirname, "..", "migrations", "013-product-checkpoints.sql"),
      "utf8",
    ),
  );
  db.exec(
    `INSERT INTO nano_session_checkpoints (
       checkpoint_uuid, session_uuid, conversation_uuid, team_uuid,
       checkpoint_kind, file_snapshot_status, created_by, created_at
     ) VALUES (
       '${CHECKPOINT_UUID}', '${SESSION_UUID}', '${CONVERSATION_UUID}', '${TEAM_UUID}',
       'user_named', 'none', 'user', '2026-05-02T00:00:00Z'
     );`,
  );
  return db;
}

describe("HPX6 restore executor safety", () => {
  let sqlite: SqliteDatabase;
  let jobs: D1CheckpointRestoreJobs;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    jobs = new D1CheckpointRestoreJobs(adaptD1(sqlite));
  });

  it("terminates restore jobs as partial until deep semantics are implemented", async () => {
    const opened = await jobs.openJob({
      session_uuid: SESSION_UUID,
      checkpoint_uuid: CHECKPOINT_UUID,
      confirmation_uuid: CONFIRMATION_UUID,
      mode: "conversation_and_files",
      target_session_uuid: null,
    });

    await runExecutorJob(
      { NANO_AGENT_DB: adaptD1(sqlite) },
      {
        kind: "restore",
        job_uuid: opened.job_uuid,
        session_uuid: SESSION_UUID,
        checkpoint_uuid: CHECKPOINT_UUID,
        mode: "conversation_and_files",
        target_session_uuid: null,
      },
    );

    const row = await jobs.read({ job_uuid: opened.job_uuid });
    expect(row).toMatchObject({
      status: "partial",
      failure_reason: "restore-executor-pending-deep-semantics",
    });
  });
});
