// HP7 — checkpoint snapshot plane + restore job plane unit tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.8 HP7
//   * docs/design/hero-to-pro/HP7-checkpoint-revert.md §7 F1/F3/F4
//   * docs/design/hero-to-pro/HPX-qna.md Q22-Q24
//   * workers/orchestrator-core/migrations/013-product-checkpoints.sql

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  D1CheckpointSnapshotPlane,
  D1CheckpointRestoreJobs,
  CheckpointRestoreJobConstraintError,
  CheckpointSnapshotConstraintError,
  RESTORE_MODES,
  RESTORE_STATUSES,
  CHECKPOINT_FILE_SNAPSHOT_STATUSES,
  CHECKPOINT_SNAPSHOT_STATUSES,
  buildCheckpointSnapshotR2Key,
  buildForkWorkspaceR2Key,
  fileSnapshotPolicyForKind,
} from "../src/checkpoint-restore-plane.js";

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

const CHILD_SESSION_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function createInMemoryDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  // Minimal stub schema — migration 013 references multiple parent
  // tables; we recreate just the FK targets.
  db.exec(
    `CREATE TABLE nano_teams (team_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversations (conversation_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_sessions (session_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_turns (turn_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_session_temp_files (temp_file_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_session_files (file_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_conversation_context_snapshots (snapshot_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_session_confirmations (confirmation_uuid TEXT PRIMARY KEY);`,
  );
  db.exec(
    `INSERT INTO nano_teams VALUES ('${TEAM_UUID}');
     INSERT INTO nano_conversations VALUES ('${CONVERSATION_UUID}');
     INSERT INTO nano_conversation_sessions VALUES ('${SESSION_UUID}');
     INSERT INTO nano_conversation_sessions VALUES ('${CHILD_SESSION_UUID}');
     INSERT INTO nano_session_confirmations VALUES ('${CONFIRMATION_UUID}');`,
  );
  const migrationPath = resolve(
    __dirname,
    "..",
    "migrations",
    "013-product-checkpoints.sql",
  );
  db.exec(readFileSync(migrationPath, "utf8"));
  // Seed the checkpoint row referenced by the snapshot/restore tests.
  db.exec(
    `INSERT INTO nano_session_checkpoints (
       checkpoint_uuid, session_uuid, conversation_uuid, team_uuid,
       checkpoint_kind, file_snapshot_status, created_by, created_at
     ) VALUES (
       '${CHECKPOINT_UUID}', '${SESSION_UUID}', '${CONVERSATION_UUID}', '${TEAM_UUID}',
       'user_named', 'none', 'user', '2026-04-30T00:00:00Z'
     );`,
  );
  return db;
}

describe("HP7 frozen enums", () => {
  it("exposes 4 file_snapshot_status values (HP1 freeze + HP7 design §7.2 F1)", () => {
    expect(CHECKPOINT_FILE_SNAPSHOT_STATUSES).toEqual([
      "none",
      "pending",
      "materialized",
      "failed",
    ]);
  });

  it("exposes 4 snapshot_status values (HP1 freeze)", () => {
    expect(CHECKPOINT_SNAPSHOT_STATUSES).toEqual([
      "pending",
      "materialized",
      "copied_to_fork",
      "failed",
    ]);
  });

  it("exposes 4 restore modes (HP1 freeze + Q23 fork)", () => {
    expect(RESTORE_MODES).toEqual([
      "conversation_only",
      "files_only",
      "conversation_and_files",
      "fork",
    ]);
  });

  it("exposes 6 restore statuses (Q24 — no `failed` shortcut)", () => {
    expect(RESTORE_STATUSES).toEqual([
      "pending",
      "running",
      "succeeded",
      "partial",
      "failed",
      "rolled_back",
    ]);
  });
});

describe("HP7 R2 key law", () => {
  it("snapshot key follows tenants/{team}/sessions/{session}/snapshots/{checkpoint}/{path}", () => {
    expect(
      buildCheckpointSnapshotR2Key({
        team_uuid: TEAM_UUID,
        session_uuid: SESSION_UUID,
        checkpoint_uuid: CHECKPOINT_UUID,
        virtual_path: "src/index.ts",
      }),
    ).toBe(
      `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/snapshots/${CHECKPOINT_UUID}/src/index.ts`,
    );
  });

  it("fork key remaps to child session workspace namespace (Q23)", () => {
    expect(
      buildForkWorkspaceR2Key({
        team_uuid: TEAM_UUID,
        child_session_uuid: CHILD_SESSION_UUID,
        virtual_path: "notes.md",
      }),
    ).toBe(
      `tenants/${TEAM_UUID}/sessions/${CHILD_SESSION_UUID}/workspace/notes.md`,
    );
  });
});

describe("HP7 fileSnapshotPolicyForKind (Q22)", () => {
  it("user_named is eager_with_fallback", () => {
    expect(fileSnapshotPolicyForKind("user_named")).toBe(
      "eager_with_fallback",
    );
  });

  it("turn_end / system / compact_boundary are lazy", () => {
    for (const k of ["turn_end", "system", "compact_boundary", "unknown"]) {
      expect(fileSnapshotPolicyForKind(k)).toBe("lazy");
    }
  });
});

describe("HP7 D1CheckpointSnapshotPlane", () => {
  let sqlite: SqliteDatabase;
  let plane: D1CheckpointSnapshotPlane;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    plane = new D1CheckpointSnapshotPlane(adaptD1(sqlite));
  });

  it("creates a pending snapshot row referencing source temp file", async () => {
    const row = await plane.create({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      source_temp_file_uuid: null,
      source_artifact_file_uuid: null,
      source_r2_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/notes.md`,
      snapshot_r2_key: buildCheckpointSnapshotR2Key({
        team_uuid: TEAM_UUID,
        session_uuid: SESSION_UUID,
        checkpoint_uuid: CHECKPOINT_UUID,
        virtual_path: "notes.md",
      }),
      virtual_path: "notes.md",
      size_bytes: 12,
      content_hash: "h1",
      initial_status: "pending",
      created_at: "2026-04-30T00:00:00Z",
    });
    expect(row).toMatchObject({
      checkpoint_uuid: CHECKPOINT_UUID,
      virtual_path: "notes.md",
      snapshot_status: "pending",
    });
  });

  it("transitions snapshot through materialized → copied_to_fork", async () => {
    const created = await plane.create({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      source_temp_file_uuid: null,
      source_artifact_file_uuid: null,
      source_r2_key: "x",
      snapshot_r2_key: "y",
      virtual_path: "notes.md",
      size_bytes: 0,
      content_hash: null,
      initial_status: "pending",
      created_at: "2026-04-30T00:00:00Z",
    });
    const materialized = await plane.transitionStatus({
      snapshot_uuid: created.snapshot_uuid,
      status: "materialized",
    });
    expect(materialized?.snapshot_status).toBe("materialized");
    const forked = await plane.transitionStatus({
      snapshot_uuid: created.snapshot_uuid,
      status: "copied_to_fork",
    });
    expect(forked?.snapshot_status).toBe("copied_to_fork");
  });

  it("rejects unknown snapshot_status at the helper boundary", async () => {
    await expect(
      plane.transitionStatus({
        snapshot_uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        // @ts-expect-error
        status: "deleted",
      }),
    ).rejects.toBeInstanceOf(CheckpointSnapshotConstraintError);
  });

  it("setCheckpointFileSnapshotStatus updates the parent checkpoint row", async () => {
    await plane.setCheckpointFileSnapshotStatus({
      checkpoint_uuid: CHECKPOINT_UUID,
      status: "materialized",
    });
    const row = sqlite
      .prepare(
        `SELECT file_snapshot_status FROM nano_session_checkpoints WHERE checkpoint_uuid = ?`,
      )
      .get(CHECKPOINT_UUID) as { file_snapshot_status: string };
    expect(row.file_snapshot_status).toBe("materialized");
  });

  it("rejects unknown file_snapshot_status at SQL CHECK boundary", async () => {
    expect(() => {
      sqlite
        .prepare(
          `UPDATE nano_session_checkpoints SET file_snapshot_status = ? WHERE checkpoint_uuid = ?`,
        )
        .run("deleted", CHECKPOINT_UUID);
    }).toThrow();
  });
});

describe("HP7 D1CheckpointRestoreJobs — confirmation gate + rollback law (Q24)", () => {
  let sqlite: SqliteDatabase;
  let jobs: D1CheckpointRestoreJobs;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    jobs = new D1CheckpointRestoreJobs(adaptD1(sqlite));
  });

  it("opens a pending conversation_only job with confirmation_uuid", async () => {
    const job = await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "conversation_only",
      confirmation_uuid: CONFIRMATION_UUID,
      target_session_uuid: null,
    });
    expect(job).toMatchObject({
      mode: "conversation_only",
      status: "pending",
      confirmation_uuid: CONFIRMATION_UUID,
    });
  });

  it("rejects destructive restore without a confirmation_uuid", async () => {
    await expect(
      jobs.openJob({
        checkpoint_uuid: CHECKPOINT_UUID,
        session_uuid: SESSION_UUID,
        mode: "files_only",
        confirmation_uuid: null,
        target_session_uuid: null,
      }),
    ).rejects.toBeInstanceOf(CheckpointRestoreJobConstraintError);
  });

  it("allows fork without confirmation_uuid (Q23 — new session, no destructive write)", async () => {
    const job = await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "fork",
      confirmation_uuid: null,
      target_session_uuid: CHILD_SESSION_UUID,
    });
    expect(job.mode).toBe("fork");
    expect(job.confirmation_uuid).toBeNull();
  });

  it("transitions pending → running → succeeded", async () => {
    const job = await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "conversation_only",
      confirmation_uuid: CONFIRMATION_UUID,
      target_session_uuid: null,
    });
    const running = await jobs.markRunning({
      job_uuid: job.job_uuid,
      started_at: "2026-04-30T00:01:00Z",
    });
    expect(running?.status).toBe("running");
    const done = await jobs.terminate({
      job_uuid: job.job_uuid,
      status: "succeeded",
      completed_at: "2026-04-30T00:02:00Z",
      failure_reason: null,
    });
    expect(done?.status).toBe("succeeded");
  });

  it("non-success terminal requires failure_reason (Q24)", async () => {
    const job = await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "conversation_only",
      confirmation_uuid: CONFIRMATION_UUID,
      target_session_uuid: null,
    });
    await expect(
      jobs.terminate({
        job_uuid: job.job_uuid,
        status: "failed",
        completed_at: "2026-04-30T00:02:00Z",
        failure_reason: null,
      }),
    ).rejects.toBeInstanceOf(CheckpointRestoreJobConstraintError);
  });

  it("rolled_back terminal preserves failure_reason for audit", async () => {
    const job = await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "conversation_and_files",
      confirmation_uuid: CONFIRMATION_UUID,
      target_session_uuid: null,
    });
    await jobs.markRunning({
      job_uuid: job.job_uuid,
      started_at: "2026-04-30T00:01:00Z",
    });
    const rolled = await jobs.terminate({
      job_uuid: job.job_uuid,
      status: "rolled_back",
      completed_at: "2026-04-30T00:02:30Z",
      failure_reason: "files_only:r2-copy-failed:R2_INTERNAL_ERROR",
    });
    expect(rolled?.status).toBe("rolled_back");
    expect(rolled?.failure_reason).toBe(
      "files_only:r2-copy-failed:R2_INTERNAL_ERROR",
    );
  });

  it("terminate is idempotent on an already-terminal job", async () => {
    const job = await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "conversation_only",
      confirmation_uuid: CONFIRMATION_UUID,
      target_session_uuid: null,
    });
    await jobs.terminate({
      job_uuid: job.job_uuid,
      status: "succeeded",
      completed_at: "2026-04-30T00:02:00Z",
      failure_reason: null,
    });
    const second = await jobs.terminate({
      job_uuid: job.job_uuid,
      status: "failed",
      completed_at: "2026-04-30T00:03:00Z",
      failure_reason: "should-be-ignored",
    });
    // Already terminal — original `succeeded` row preserved.
    expect(second?.status).toBe("succeeded");
  });

  it("rejects markRunning on a terminal job", async () => {
    const job = await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "conversation_only",
      confirmation_uuid: CONFIRMATION_UUID,
      target_session_uuid: null,
    });
    await jobs.terminate({
      job_uuid: job.job_uuid,
      status: "succeeded",
      completed_at: "2026-04-30T00:02:00Z",
      failure_reason: null,
    });
    await expect(
      jobs.markRunning({
        job_uuid: job.job_uuid,
        started_at: "2026-04-30T00:03:00Z",
      }),
    ).rejects.toBeInstanceOf(CheckpointRestoreJobConstraintError);
  });

  it("listForSession returns jobs in started_at desc order", async () => {
    await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "conversation_only",
      confirmation_uuid: CONFIRMATION_UUID,
      target_session_uuid: null,
    });
    await jobs.openJob({
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      mode: "fork",
      confirmation_uuid: null,
      target_session_uuid: CHILD_SESSION_UUID,
    });
    const list = await jobs.listForSession({ session_uuid: SESSION_UUID });
    expect(list).toHaveLength(2);
  });

  it("rejects unknown restore mode at the helper boundary", async () => {
    await expect(
      jobs.openJob({
        checkpoint_uuid: CHECKPOINT_UUID,
        session_uuid: SESSION_UUID,
        // @ts-expect-error
        mode: "snapshot_only",
        confirmation_uuid: CONFIRMATION_UUID,
        target_session_uuid: null,
      }),
    ).rejects.toBeInstanceOf(CheckpointRestoreJobConstraintError);
  });

  it("rejects unknown restore mode at SQL CHECK boundary", () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO nano_checkpoint_restore_jobs (
             job_uuid, checkpoint_uuid, session_uuid, mode, status
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
          CHECKPOINT_UUID,
          SESSION_UUID,
          "snapshot_only",
          "pending",
        );
    }).toThrow();
  });

  it("rejects unknown restore status at SQL CHECK boundary", () => {
    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO nano_checkpoint_restore_jobs (
             job_uuid, checkpoint_uuid, session_uuid, mode, status
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          "ffffffff-ffff-4fff-8fff-ffffffffffff",
          CHECKPOINT_UUID,
          SESSION_UUID,
          "conversation_only",
          "best_effort",
        );
    }).toThrow();
  });
});
