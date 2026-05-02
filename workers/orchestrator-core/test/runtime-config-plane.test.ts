import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  D1RuntimeConfigPlane,
  RuntimeConfigVersionConflictError,
} from "../src/runtime-config-plane.js";
import { D1PermissionRulesPlane } from "../src/permission-rules-plane.js";

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
     INSERT INTO nano_teams VALUES ('${TEAM_UUID}');
     INSERT INTO nano_conversation_sessions VALUES ('${SESSION_UUID}');`,
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

describe("HPX6 runtime config version law", () => {
  let sqlite: SqliteDatabase;
  let plane: D1RuntimeConfigPlane;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    plane = new D1RuntimeConfigPlane(adaptD1(sqlite));
  });

  it("bumps version when expected_version matches", async () => {
    const initial = await plane.readOrCreate({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
    });
    expect(initial.version).toBe(1);
    const updated = await plane.patch({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      expected_version: 1,
      approval_policy: "always_allow",
    });
    expect(updated.version).toBe(2);
    expect(updated.approval_policy).toBe("always_allow");
  });

  it("rejects stale expected_version with a conflict error", async () => {
    await plane.readOrCreate({ session_uuid: SESSION_UUID, team_uuid: TEAM_UUID });
    await plane.patch({
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      expected_version: 1,
      approval_policy: "deny",
    });
    await expect(
      plane.patch({
        session_uuid: SESSION_UUID,
        team_uuid: TEAM_UUID,
        expected_version: 1,
        approval_policy: "ask",
      }),
    ).rejects.toBeInstanceOf(RuntimeConfigVersionConflictError);
    const current = await plane.read(SESSION_UUID);
    expect(current?.version).toBe(2);
    expect(current?.approval_policy).toBe("deny");
  });
});

describe("HPX6 tenant permission rules replacement", () => {
  let sqlite: SqliteDatabase;
  let plane: D1PermissionRulesPlane;

  beforeEach(() => {
    sqlite = createInMemoryDb();
    plane = new D1PermissionRulesPlane(adaptD1(sqlite));
  });

  it("replaces the team-scoped rule set instead of append-only drift", async () => {
    await plane.replaceTeamRules({
      team_uuid: TEAM_UUID,
      rules: [
        { tool_name: "bash", behavior: "allow", scope: "tenant" },
        { tool_name: "write_file", behavior: "deny", scope: "tenant" },
      ],
    });
    const afterFirstWrite = await plane.listTeamRules(TEAM_UUID);
    expect(afterFirstWrite).toHaveLength(2);

    await plane.replaceTeamRules({
      team_uuid: TEAM_UUID,
      rules: [{ tool_name: "bash", behavior: "ask", scope: "tenant" }],
    });
    const afterReplace = await plane.listTeamRules(TEAM_UUID);
    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0]).toMatchObject({
      tool_name: "bash",
      behavior: "ask",
      scope: "tenant",
    });
  });
});
