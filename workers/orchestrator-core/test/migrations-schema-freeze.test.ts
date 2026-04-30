// HP1 P5-01 — DDL Freeze Gate schema-assertion regression.
//
// 在 :memory: SQLite 上顺序 apply 001 → 013,然后 introspect 关键字段 / 索引 /
// 唯一约束 / enum / seed 是否与 HP1 closure §1 R1-R7 完全一致。
// 任何后续 phase 若试图悄悄改 007-013 的 DDL,本测试就会红。
//
// 验收来源:
//   * docs/charter/plan-hero-to-pro.md §7.2 In-Scope §1-§6 + §466-474
//   * docs/design/hero-to-pro/HP1-schema-extension.md §7
//   * docs/design/hero-to-pro/HPX-qna.md Q4 / Q5 / Q6 / Q13 / Q16 / Q18
//   * docs/issue/hero-to-pro/HP1-closure.md §1 R1-R9, §3 (correction registry)

import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Vite/Vitest 不能解析 `node:sqlite` 这个 Node 22 内置(它不在 Vite 的 known
// builtins 列表中),用 createRequire 直接走 Node CJS 解析绕过模块图。
const requireFromHere = createRequire(import.meta.url);
const { DatabaseSync } = requireFromHere("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

type DatabaseSync = SqliteDatabase;

const REPO_ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(REPO_ROOT, "migrations");

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{3}-.*\.sql$/.test(name))
    .sort();
}

function loadMigration(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

function applyMigrationsOnFreshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  // FKs are declared but the test focuses on column/index/enum presence; we
  // intentionally leave foreign_keys OFF so partial seed inserts don't reject
  // for missing nano_teams rows. Schema-shape introspection ignores PRAGMA.
  for (const name of listMigrationFiles()) {
    const sql = loadMigration(name);
    db.exec(sql);
  }
  return db;
}

interface PragmaColumn {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
}

interface PragmaIndexInfoRow {
  readonly seqno: number;
  readonly cid: number;
  readonly name: string;
}

interface PragmaIndexListRow {
  readonly seq: number;
  readonly name: string;
  readonly unique: number;
  readonly origin: string;
  readonly partial: number;
}

function tableColumns(db: DatabaseSync, table: string): PragmaColumn[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as unknown as PragmaColumn[];
}

function tableIndexes(db: DatabaseSync, table: string): PragmaIndexListRow[] {
  return db.prepare(`PRAGMA index_list(${table})`).all() as unknown as PragmaIndexListRow[];
}

function indexColumns(db: DatabaseSync, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info(${indexName})`).all() as unknown as PragmaIndexInfoRow[])
    .sort((a, b) => a.seqno - b.seqno)
    .map((row) => row.name);
}

function tableSql(db: DatabaseSync, table: string): string {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?1`)
    .get(table) as { sql?: string } | undefined;
  return row?.sql ?? "";
}

function expectCheckEnum(sql: string, column: string, allowed: readonly string[]) {
  const re = new RegExp(`${column}\\s+IN\\s*\\(([^)]+)\\)`, "i");
  const match = re.exec(sql);
  expect(match, `column ${column} CHECK constraint missing in:\n${sql}`).not.toBeNull();
  const tokens = match![1]
    .split(",")
    .map((t) => t.trim().replace(/^'(.*)'$/, "$1"))
    .filter((t) => t.length > 0);
  expect(new Set(tokens)).toEqual(new Set(allowed));
}

describe("HP1 P5-01 — migrations 007-013 schema freeze (DDL Freeze Gate)", () => {
  let db: DatabaseSync;

  beforeAll(() => {
    db = applyMigrationsOnFreshDb();
  });

  afterAll(() => {
    db?.close();
  });

  it("Q4 — migration ledger contains exactly 007-013 (no 014+ corrections in HP1)", () => {
    const files = listMigrationFiles();
    expect(files).toContain("007-model-metadata-and-aliases.sql");
    expect(files).toContain("008-session-model-audit.sql");
    expect(files).toContain("009-turn-attempt-and-message-supersede.sql");
    expect(files).toContain("010-agentic-loop-todos.sql");
    expect(files).toContain("011-session-temp-files-and-provenance.sql");
    expect(files).toContain("012-session-confirmations.sql");
    expect(files).toContain("013-product-checkpoints.sql");
    const corrections = files.filter((f) => /^01[4-9]-/.test(f));
    expect(corrections, `unexpected 014+ migrations: ${corrections.join(", ")}`).toEqual([]);
  });

  // ── 007 ── model metadata + alias

  it("007 — nano_models has the 10 hero-to-pro metadata columns", () => {
    const cols = new Set(tableColumns(db, "nano_models").map((c) => c.name));
    for (const col of [
      "max_output_tokens",
      "effective_context_pct",
      "auto_compact_token_limit",
      "supported_reasoning_levels",
      "input_modalities",
      "provider_key",
      "fallback_model_id",
      "base_instructions_suffix",
      "description",
      "sort_priority",
    ]) {
      expect(cols, `missing nano_models.${col}`).toContain(col);
    }
  });

  it("007 — nano_model_aliases table + 4 alias seed rows exist", () => {
    const cols = tableColumns(db, "nano_model_aliases").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["alias_id", "target_model_id", "created_at"]));
    const seed = db
      .prepare("SELECT alias_id FROM nano_model_aliases ORDER BY alias_id")
      .all() as Array<{ alias_id: string }>;
    expect(seed.map((r) => r.alias_id)).toEqual([
      "@alias/balanced",
      "@alias/fast",
      "@alias/reasoning",
      "@alias/vision",
    ]);
  });

  // ── 008 ── session/turn audit + ended_reason

  it("008 — nano_conversation_sessions has default_model + ended_reason", () => {
    const cols = new Set(tableColumns(db, "nano_conversation_sessions").map((c) => c.name));
    expect(cols).toContain("default_model_id");
    expect(cols).toContain("default_reasoning_effort");
    expect(cols).toContain("ended_reason"); // Q13
  });

  it("008 — nano_conversation_turns audit columns present (after 009 rebuild)", () => {
    const cols = new Set(tableColumns(db, "nano_conversation_turns").map((c) => c.name));
    for (const col of [
      "requested_model_id",
      "requested_reasoning_effort",
      "effective_model_id",
      "effective_reasoning_effort",
      "fallback_used",
    ]) {
      expect(cols, `missing turn audit column: ${col}`).toContain(col);
    }
  });

  // ── 009 ── turn_attempt + message supersede + conversation tombstone

  it("009 — turn_attempt rebuilt UNIQUE(session_uuid, turn_index, turn_attempt) is in effect", () => {
    const cols = new Set(tableColumns(db, "nano_conversation_turns").map((c) => c.name));
    expect(cols).toContain("turn_attempt");

    const indexes = tableIndexes(db, "nano_conversation_turns");
    const uniqueIndexes = indexes.filter((i) => i.unique === 1 && i.origin !== "pk");
    let foundFreezeUnique = false;
    for (const idx of uniqueIndexes) {
      const idxCols = indexColumns(db, idx.name);
      if (
        idxCols.length === 3 &&
        idxCols[0] === "session_uuid" &&
        idxCols[1] === "turn_index" &&
        idxCols[2] === "turn_attempt"
      ) {
        foundFreezeUnique = true;
        break;
      }
    }
    expect(foundFreezeUnique, "expected UNIQUE(session_uuid, turn_index, turn_attempt)").toBe(true);

    // Old UNIQUE(session_uuid, turn_index) must NOT survive.
    for (const idx of uniqueIndexes) {
      const idxCols = indexColumns(db, idx.name);
      const isOldUnique =
        idxCols.length === 2 && idxCols[0] === "session_uuid" && idxCols[1] === "turn_index";
      expect(isOldUnique, `stale UNIQUE survives: ${idx.name}`).toBe(false);
    }
  });

  it("009 — nano_conversation_messages supersede markers + conversations tombstone", () => {
    const messageCols = new Set(
      tableColumns(db, "nano_conversation_messages").map((c) => c.name),
    );
    expect(messageCols).toContain("superseded_at");
    expect(messageCols).toContain("superseded_by_turn_attempt");

    const convCols = new Set(tableColumns(db, "nano_conversations").map((c) => c.name));
    expect(convCols).toContain("deleted_at");
  });

  // ── 010 ── todos

  it("010 — nano_session_todos schema + status enum", () => {
    const cols = tableColumns(db, "nano_session_todos");
    const colNames = new Set(cols.map((c) => c.name));
    for (const col of [
      "todo_uuid",
      "session_uuid",
      "conversation_uuid",
      "team_uuid",
      "parent_todo_uuid",
      "content",
      "status",
      "created_at",
      "updated_at",
      "completed_at",
    ]) {
      expect(colNames, `missing nano_session_todos.${col}`).toContain(col);
    }
    expectCheckEnum(tableSql(db, "nano_session_todos"), "status", [
      "pending",
      "in_progress",
      "completed",
      "cancelled",
      "blocked",
    ]);
  });

  // ── 011 ── temp files + provenance

  it("011 — nano_session_temp_files schema (incl. expires_at + cleanup_status)", () => {
    const cols = tableColumns(db, "nano_session_temp_files");
    const colNames = new Set(cols.map((c) => c.name));
    for (const col of [
      "temp_file_uuid",
      "session_uuid",
      "team_uuid",
      "virtual_path",
      "r2_object_key",
      "expires_at",
      "cleanup_status",
      "written_by",
    ]) {
      expect(colNames, `missing nano_session_temp_files.${col}`).toContain(col);
    }
    const sql = tableSql(db, "nano_session_temp_files");
    expectCheckEnum(sql, "cleanup_status", ["pending", "scheduled", "done"]);
    expectCheckEnum(sql, "written_by", ["user", "agent", "tool"]);

    // UNIQUE(session_uuid, virtual_path) must exist.
    const uniques = tableIndexes(db, "nano_session_temp_files").filter((i) => i.unique === 1);
    let foundComposite = false;
    for (const u of uniques) {
      const cols = indexColumns(db, u.name);
      if (cols.length === 2 && cols[0] === "session_uuid" && cols[1] === "virtual_path") {
        foundComposite = true;
        break;
      }
    }
    expect(foundComposite, "UNIQUE(session_uuid, virtual_path) missing on temp files").toBe(true);
  });

  it("011 — nano_session_files provenance columns", () => {
    const cols = new Set(tableColumns(db, "nano_session_files").map((c) => c.name));
    expect(cols).toContain("provenance_kind");
    expect(cols).toContain("source_workspace_path");
    expect(cols).toContain("source_session_uuid");
    expectCheckEnum(tableSql(db, "nano_session_files"), "provenance_kind", [
      "user_upload",
      "agent_generated",
      "workspace_promoted",
      "compact_summary",
      "checkpoint_restored",
    ]);
  });

  // ── 012 ── confirmations

  it("012 — nano_session_confirmations 7 kinds + 6 statuses (Q16/Q18)", () => {
    const sql = tableSql(db, "nano_session_confirmations");
    expectCheckEnum(sql, "kind", [
      "tool_permission",
      "elicitation",
      "model_switch",
      "context_compact",
      "fallback_model",
      "checkpoint_restore",
      "context_loss",
    ]);
    expectCheckEnum(sql, "status", [
      "pending",
      "allowed",
      "denied",
      "modified",
      "timeout",
      "superseded",
    ]);
    expect(sql, "Q16: confirmation status MUST NOT contain 'failed'").not.toMatch(/'failed'/);
    expect(sql, "Q18: confirmation kind MUST NOT contain 'tool_cancel'").not.toMatch(
      /'tool_cancel'/,
    );
  });

  // ── 013 ── checkpoint lineage

  it("013 — nano_session_checkpoints 4-kind enum + lazy file_snapshot_status", () => {
    const sql = tableSql(db, "nano_session_checkpoints");
    expectCheckEnum(sql, "checkpoint_kind", [
      "turn_end",
      "user_named",
      "compact_boundary",
      "system",
    ]);
    expectCheckEnum(sql, "file_snapshot_status", [
      "none",
      "pending",
      "materialized",
      "failed",
    ]);
    expectCheckEnum(sql, "created_by", ["user", "system", "compact", "turn_end"]);
  });

  it("013 — nano_checkpoint_file_snapshots status enum (4 values incl. copied_to_fork)", () => {
    expectCheckEnum(tableSql(db, "nano_checkpoint_file_snapshots"), "snapshot_status", [
      "pending",
      "materialized",
      "copied_to_fork",
      "failed",
    ]);
  });

  it("013 — nano_checkpoint_restore_jobs mode/status enums + confirmation FK", () => {
    const sql = tableSql(db, "nano_checkpoint_restore_jobs");
    expectCheckEnum(sql, "mode", [
      "conversation_only",
      "files_only",
      "conversation_and_files",
      "fork",
    ]);
    expectCheckEnum(sql, "status", [
      "pending",
      "running",
      "succeeded",
      "partial",
      "failed",
      "rolled_back",
    ]);
    const cols = new Set(tableColumns(db, "nano_checkpoint_restore_jobs").map((c) => c.name));
    expect(cols).toContain("confirmation_uuid");
    expect(cols).toContain("target_session_uuid");
    expect(cols).toContain("failure_reason");
  });

  it("013 — nano_workspace_cleanup_jobs scope enum frozen to 3 values", () => {
    expectCheckEnum(tableSql(db, "nano_workspace_cleanup_jobs"), "scope", [
      "session_end",
      "explicit",
      "checkpoint_ttl",
    ]);
    expectCheckEnum(tableSql(db, "nano_workspace_cleanup_jobs"), "status", [
      "pending",
      "running",
      "done",
      "failed",
    ]);
  });

  it("013 — does NOT introduce nano_compact_jobs (Q5: reuse compact_boundary checkpoint handle)", () => {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='nano_compact_jobs'`)
      .get();
    expect(row, "nano_compact_jobs must not exist in HP1").toBeUndefined();
  });

  // ── HP1 ledger sanity ──

  it("freeze sanity — every required hero-to-pro table is present", () => {
    const required = [
      "nano_model_aliases",
      "nano_session_todos",
      "nano_session_temp_files",
      "nano_session_confirmations",
      "nano_session_checkpoints",
      "nano_checkpoint_file_snapshots",
      "nano_checkpoint_restore_jobs",
      "nano_workspace_cleanup_jobs",
    ];
    for (const t of required) {
      const row = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?1`)
        .get(t);
      expect(row, `missing required HP1 table: ${t}`).not.toBeUndefined();
    }
  });
});
