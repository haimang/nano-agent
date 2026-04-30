// HP7 P2-01 — CheckpointDiffProjector unit tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.8 HP7
//   * docs/design/hero-to-pro/HP7-checkpoint-revert.md §7 F2

import { createRequire } from "node:module";
import { describe, expect, it, beforeEach } from "vitest";
import { CheckpointDiffProjector } from "../src/checkpoint-diff-projector.js";

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    all: (...args: unknown[]) => unknown[];
    get: (...args: unknown[]) => unknown;
    run: (...args: unknown[]) => { changes: number };
  };
  close(): void;
}

const requireFromHere = createRequire(import.meta.url);
const { DatabaseSync } = requireFromHere("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CHECKPOINT_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WATERMARK_MSG = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
            return { success: true };
          },
        };
      },
    };
  }
  return { prepare } as unknown as D1Database;
}

function createDb(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE nano_session_checkpoints (
       checkpoint_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       file_snapshot_status TEXT,
       message_high_watermark TEXT
     );
     CREATE TABLE nano_checkpoint_file_snapshots (
       snapshot_uuid TEXT PRIMARY KEY,
       checkpoint_uuid TEXT NOT NULL,
       virtual_path TEXT NOT NULL,
       content_hash TEXT,
       size_bytes INTEGER NOT NULL,
       source_temp_file_uuid TEXT,
       source_artifact_file_uuid TEXT,
       snapshot_status TEXT NOT NULL
     );
     CREATE TABLE nano_session_temp_files (
       temp_file_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       virtual_path TEXT NOT NULL,
       content_hash TEXT,
       size_bytes INTEGER NOT NULL
     );
     CREATE TABLE nano_session_files (
       file_uuid TEXT PRIMARY KEY,
       session_uuid TEXT NOT NULL,
       mime TEXT,
       source_workspace_path TEXT,
       provenance_kind TEXT,
       created_at TEXT NOT NULL
     );
     CREATE TABLE nano_conversation_messages (
       message_uuid TEXT PRIMARY KEY,
       created_at TEXT NOT NULL
     );`,
  );
  return db;
}

describe("HP7 CheckpointDiffProjector", () => {
  let sqlite: SqliteDatabase;
  let projector: CheckpointDiffProjector;

  beforeEach(() => {
    sqlite = createDb();
    projector = new CheckpointDiffProjector(adaptD1(sqlite));
  });

  function seedCheckpoint(args: { watermark: boolean }) {
    sqlite
      .prepare(
        `INSERT INTO nano_session_checkpoints (
           checkpoint_uuid, session_uuid, file_snapshot_status, message_high_watermark
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(
        CHECKPOINT_UUID,
        SESSION_UUID,
        "materialized",
        args.watermark ? WATERMARK_MSG : null,
      );
    if (args.watermark) {
      sqlite
        .prepare(
          `INSERT INTO nano_conversation_messages (message_uuid, created_at) VALUES (?, ?)`,
        )
        .run(WATERMARK_MSG, "2026-04-30T01:00:00Z");
    }
  }

  function seedSnapshot(virtualPath: string, hash: string) {
    sqlite
      .prepare(
        `INSERT INTO nano_checkpoint_file_snapshots (
           snapshot_uuid, checkpoint_uuid, virtual_path,
           content_hash, size_bytes, snapshot_status
         ) VALUES (?, ?, ?, ?, ?, 'materialized')`,
      )
      .run(crypto.randomUUID(), CHECKPOINT_UUID, virtualPath, hash, 10);
  }

  function seedCurrent(virtualPath: string, hash: string) {
    sqlite
      .prepare(
        `INSERT INTO nano_session_temp_files (
           temp_file_uuid, session_uuid, virtual_path, content_hash, size_bytes
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), SESSION_UUID, virtualPath, hash, 10);
  }

  function seedArtifact(args: { createdAt: string; sourcePath: string | null }) {
    sqlite
      .prepare(
        `INSERT INTO nano_session_files (
           file_uuid, session_uuid, mime, source_workspace_path, provenance_kind, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        SESSION_UUID,
        "text/markdown",
        args.sourcePath,
        "workspace_promoted",
        args.createdAt,
      );
  }

  it("returns null when checkpoint does not exist", async () => {
    const diff = await projector.project({
      session_uuid: SESSION_UUID,
      checkpoint_uuid: CHECKPOINT_UUID,
    });
    expect(diff).toBeNull();
  });

  it("reports added/removed/changed workspace deltas", async () => {
    seedCheckpoint({ watermark: false });
    seedSnapshot("a.md", "h-a-old");
    seedSnapshot("b.md", "h-b");
    seedCurrent("a.md", "h-a-new");
    seedCurrent("c.md", "h-c");
    const diff = await projector.project({
      session_uuid: SESSION_UUID,
      checkpoint_uuid: CHECKPOINT_UUID,
    });
    expect(diff).toBeDefined();
    expect(diff!.workspace_files.sort((a, b) => a.virtual_path.localeCompare(b.virtual_path)))
      .toMatchObject([
        { virtual_path: "a.md", change: "changed" },
        { virtual_path: "b.md", change: "removed" },
        { virtual_path: "c.md", change: "added" },
      ]);
    expect(diff!.snapshot_workspace_count).toBe(2);
    expect(diff!.current_workspace_count).toBe(2);
  });

  it("ignores snapshot rows that are not yet materialized", async () => {
    seedCheckpoint({ watermark: false });
    sqlite
      .prepare(
        `INSERT INTO nano_checkpoint_file_snapshots (
           snapshot_uuid, checkpoint_uuid, virtual_path,
           content_hash, size_bytes, snapshot_status
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(crypto.randomUUID(), CHECKPOINT_UUID, "a.md", "h", 1, "pending");
    seedCurrent("a.md", "h");
    const diff = await projector.project({
      session_uuid: SESSION_UUID,
      checkpoint_uuid: CHECKPOINT_UUID,
    });
    expect(diff!.snapshot_workspace_count).toBe(0);
    expect(diff!.workspace_files).toHaveLength(1);
    expect(diff!.workspace_files[0]?.change).toBe("added");
  });

  it("reports artifacts created after the checkpoint watermark as added", async () => {
    seedCheckpoint({ watermark: true });
    seedArtifact({
      createdAt: "2026-04-30T00:30:00Z",
      sourcePath: "a.md",
    }); // before watermark
    seedArtifact({
      createdAt: "2026-04-30T02:00:00Z",
      sourcePath: "b.md",
    }); // after watermark
    const diff = await projector.project({
      session_uuid: SESSION_UUID,
      checkpoint_uuid: CHECKPOINT_UUID,
    });
    expect(diff!.artifacts).toHaveLength(1);
    expect(diff!.artifacts[0]).toMatchObject({
      change: "added",
      provenance_kind: "workspace_promoted",
      source_workspace_path: "b.md",
    });
  });

  it("returns empty artifact delta when watermark message has been pruned", async () => {
    sqlite
      .prepare(
        `INSERT INTO nano_session_checkpoints (
           checkpoint_uuid, session_uuid, file_snapshot_status, message_high_watermark
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(CHECKPOINT_UUID, SESSION_UUID, "materialized", "missing-msg");
    seedArtifact({ createdAt: "2026-04-30T02:00:00Z", sourcePath: "x.md" });
    const diff = await projector.project({
      session_uuid: SESSION_UUID,
      checkpoint_uuid: CHECKPOINT_UUID,
    });
    expect(diff!.artifacts).toEqual([]);
  });
});
