// HP6 P2 — workspace temp file durable truth + path normalization tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.7 HP6
//   * docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md §7 F2/F5
//   * docs/design/hero-to-pro/HPX-qna.md Q19
//   * workers/orchestrator-core/migrations/011-session-temp-files-and-provenance.sql

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  D1WorkspaceControlPlane,
  VirtualPathError,
  buildWorkspaceR2Key,
  normalizeVirtualPath,
} from "../src/workspace-control-plane.js";

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
     CREATE TABLE nano_conversation_sessions (session_uuid TEXT PRIMARY KEY);
     CREATE TABLE nano_session_files (
       file_uuid TEXT PRIMARY KEY
     );`,
  );
  db.exec(
    `INSERT INTO nano_teams VALUES ('${TEAM_UUID}');
     INSERT INTO nano_conversation_sessions VALUES ('${SESSION_UUID}');`,
  );
  // Migration 011 includes ALTER TABLE on nano_session_files; the
  // helper here only writes to nano_session_temp_files so we apply
  // the table-creation portion only.
  const migration = readFileSync(
    resolve(
      __dirname,
      "..",
      "migrations",
      "011-session-temp-files-and-provenance.sql",
    ),
    "utf8",
  );
  // Apply temp_files table + indexes (everything before the ALTER block).
  const cutAt = migration.indexOf("-- ── 2. nano_session_files");
  db.exec(migration.slice(0, cutAt));
  return db;
}

describe("HP6 normalizeVirtualPath — frozen rule set", () => {
  it("accepts a simple relative path", () => {
    expect(normalizeVirtualPath("a/b/c.txt")).toBe("a/b/c.txt");
  });

  it("rejects empty string", () => {
    expect(() => normalizeVirtualPath("")).toThrow(VirtualPathError);
  });

  it("rejects leading slash", () => {
    expect(() => normalizeVirtualPath("/a/b")).toThrow(VirtualPathError);
  });

  it("rejects backslash separator", () => {
    expect(() => normalizeVirtualPath("a\\b")).toThrow(VirtualPathError);
  });

  it("rejects `..` traversal segment", () => {
    expect(() => normalizeVirtualPath("a/../b")).toThrow(VirtualPathError);
  });

  it("rejects standalone `.` segment", () => {
    expect(() => normalizeVirtualPath("a/./b")).toThrow(VirtualPathError);
  });

  it("rejects empty segments (a//b)", () => {
    expect(() => normalizeVirtualPath("a//b")).toThrow(VirtualPathError);
  });

  it("rejects non-string input", () => {
    expect(() => normalizeVirtualPath(undefined as unknown)).toThrow(
      VirtualPathError,
    );
  });

  it("rejects control characters", () => {
    expect(() => normalizeVirtualPath("ab")).toThrow(VirtualPathError);
    expect(() => normalizeVirtualPath("ab")).toThrow(VirtualPathError);
  });

  it("rejects overly long paths (> 1024 bytes)", () => {
    const long = "a".repeat(1025);
    expect(() => normalizeVirtualPath(long)).toThrow(VirtualPathError);
  });
});

describe("HP6 buildWorkspaceR2Key — tenant prefix law", () => {
  it("produces tenants/{team}/sessions/{session}/workspace/{path}", () => {
    expect(
      buildWorkspaceR2Key({
        team_uuid: TEAM_UUID,
        session_uuid: SESSION_UUID,
        virtual_path: "src/index.ts",
      }),
    ).toBe(
      `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/src/index.ts`,
    );
  });

  it("rejects traversal-y paths via normalize gate", () => {
    expect(() =>
      buildWorkspaceR2Key({
        team_uuid: TEAM_UUID,
        session_uuid: SESSION_UUID,
        virtual_path: "../escape",
      }),
    ).toThrow(VirtualPathError);
  });
});

describe("HP6 D1WorkspaceControlPlane — temp file CRUD", () => {
  let sqlite: SqliteDatabase;
  let plane: D1WorkspaceControlPlane;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    plane = new D1WorkspaceControlPlane(adaptD1(sqlite));
  });

  it("inserts a new row on first upsert", async () => {
    const row = await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "notes.md",
      mime: "text/markdown",
      size_bytes: 42,
      content_hash: "h1",
      written_by: "agent",
      created_at: "2026-04-30T00:00:00Z",
      expires_at: "2026-05-01T00:00:00Z",
    });
    expect(row).toMatchObject({
      virtual_path: "notes.md",
      r2_object_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/notes.md`,
      cleanup_status: "pending",
      written_by: "agent",
    });
  });

  it("only bumps last_modified_at when content_hash unchanged", async () => {
    const first = await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "notes.md",
      mime: "text/markdown",
      size_bytes: 42,
      content_hash: "h1",
      written_by: "agent",
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    const second = await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "notes.md",
      mime: "text/markdown",
      size_bytes: 42,
      content_hash: "h1",
      written_by: "agent",
      created_at: "2026-04-30T01:00:00Z",
      expires_at: null,
    });
    expect(second.temp_file_uuid).toBe(first.temp_file_uuid);
    expect(second.last_modified_at).toBe("2026-04-30T01:00:00Z");
  });

  it("UNIQUE(session, virtual_path) means a different hash overwrites the row in place", async () => {
    const first = await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "notes.md",
      mime: "text/markdown",
      size_bytes: 42,
      content_hash: "h1",
      written_by: "agent",
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    const second = await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "notes.md",
      mime: "text/markdown",
      size_bytes: 60,
      content_hash: "h2",
      written_by: "user",
      created_at: "2026-04-30T01:00:00Z",
      expires_at: null,
    });
    expect(second.temp_file_uuid).toBe(first.temp_file_uuid);
    expect(second.size_bytes).toBe(60);
    expect(second.content_hash).toBe("h2");
    expect(second.written_by).toBe("user");
  });

  it("list filters by prefix and rejects traversal-y prefix", async () => {
    await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "src/a.ts",
      mime: null,
      size_bytes: 1,
      content_hash: null,
      written_by: "agent",
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "docs/b.md",
      mime: null,
      size_bytes: 1,
      content_hash: null,
      written_by: "agent",
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    const list = await plane.list({
      session_uuid: SESSION_UUID,
      prefix: "src/",
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.virtual_path).toBe("src/a.ts");

    await expect(
      plane.list({ session_uuid: SESSION_UUID, prefix: "../escape" }),
    ).rejects.toBeInstanceOf(VirtualPathError);
  });

  it("delete by virtual_path removes the row idempotently", async () => {
    await plane.upsert({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      virtual_path: "x.txt",
      mime: null,
      size_bytes: 0,
      content_hash: null,
      written_by: "agent",
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    });
    expect(
      await plane.deleteByPath({
        session_uuid: SESSION_UUID,
        virtual_path: "x.txt",
      }),
    ).toBe(true);
    expect(
      await plane.deleteByPath({
        session_uuid: SESSION_UUID,
        virtual_path: "x.txt",
      }),
    ).toBe(false);
  });

  it("readByPath rejects traversal-y inputs at boundary (defense in depth)", async () => {
    await expect(
      plane.readByPath({
        session_uuid: SESSION_UUID,
        virtual_path: "../escape",
      }),
    ).rejects.toBeInstanceOf(VirtualPathError);
  });
});
