// HPX3 F7 — endpoint-level direct tests for the workspace temp-file
// CRUD routes. Closes the test gap flagged by part5 reviewers
// (deepseek W-WORK-01 + kimi W-WSK-01): before this file the only
// coverage was `workspace-control-plane.test.ts` exercising the D1
// plane. The facade-layer auth gate / session ownership / virtual_path
// normalization / response envelope had no regression protection.
//
// Source under test: handleSessionWorkspace in
// `workers/orchestrator-core/src/hp-absorbed-routes.ts:187-317`.

import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const DEVICE_UUID = "88888888-8888-4888-8888-888888888888";
const JWT_SECRET = "x".repeat(32);

interface SessionRow {
  team_uuid: string;
  actor_user_uuid: string;
  deleted_at: string | null;
}

const OWNED_SESSION: SessionRow = {
  team_uuid: TEAM_UUID,
  actor_user_uuid: USER_UUID,
  deleted_at: null,
};

interface TempFileRow {
  virtual_path: string;
  size_bytes: number;
  mime: string | null;
}

// Mock D1 with three SQL families:
//  (a) device gate (`AND user_uuid = ?2`)
//  (b) session lifecycle (`FROM nano_conversation_sessions`)
//  (c) workspace plane (`FROM nano_session_temp_files`)
function createDb(opts: {
  session: SessionRow | null;
  files?: TempFileRow[];
  fileByPath?: TempFileRow | null;
}) {
  const files = opts.files ?? [];
  const fileByPath = opts.fileByPath ?? null;
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes("AND user_uuid = ?2")) {
            return { status: "active" };
          }
          if (sql.includes("FROM nano_conversation_sessions")) {
            if (!opts.session) return null;
            return {
              conversation_uuid: "99999999-9999-4999-8999-999999999999",
              session_uuid: SESSION_UUID,
              team_uuid: opts.session.team_uuid,
              actor_user_uuid: opts.session.actor_user_uuid,
              session_status: "running",
              started_at: "2026-04-30T00:00:00Z",
              ended_at: null,
              ended_reason: null,
              last_phase: null,
              default_model_id: null,
              default_reasoning_effort: null,
              title: null,
              deleted_at: opts.session.deleted_at,
            };
          }
          if (sql.includes("FROM nano_session_temp_files")) {
            if (!fileByPath) return null;
            return {
              temp_file_uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
              session_uuid: SESSION_UUID,
              team_uuid: TEAM_UUID,
              virtual_path: fileByPath.virtual_path,
              r2_object_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/${fileByPath.virtual_path}`,
              mime: fileByPath.mime,
              size_bytes: fileByPath.size_bytes,
              content_hash: null,
              last_modified_at: "2026-04-30T00:00:00Z",
              written_by: "user",
              created_at: "2026-04-30T00:00:00Z",
              expires_at: null,
              cleanup_status: "pending",
            };
          }
          return null;
        },
        all: async () => {
          if (sql.includes("FROM nano_session_temp_files")) {
            return {
              results: files.map((f) => ({
                temp_file_uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                session_uuid: SESSION_UUID,
                team_uuid: TEAM_UUID,
                virtual_path: f.virtual_path,
                r2_object_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/${f.virtual_path}`,
                mime: f.mime,
                size_bytes: f.size_bytes,
                content_hash: null,
                last_modified_at: "2026-04-30T00:00:00Z",
                written_by: "user",
                created_at: "2026-04-30T00:00:00Z",
                expires_at: null,
                cleanup_status: "pending",
              })),
            };
          }
          return { results: [] };
        },
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  } as any;
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

function buildEnv(db: any) {
  return {
    JWT_SECRET,
    TEAM_UUID: "nano-agent",
    NANO_AGENT_DB: db,
    ORCHESTRATOR_USER_DO: {
      idFromName: (_name: string) => "stub-id",
      get: () => ({ fetch: async () => new Response(null, { status: 204 }) }),
    } as any,
  } as any;
}

describe("GET /sessions/{id}/workspace/files — list", () => {
  it("200 happy — returns tenant_prefix + file metadata", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/workspace/files`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(
        createDb({
          session: OWNED_SESSION,
          files: [{ virtual_path: "notes.md", size_bytes: 64, mime: "text/markdown" }],
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.ok).toBe(true);
    expect(body.data.tenant_prefix).toBe(
      `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/`,
    );
    expect(body.data.files).toHaveLength(1);
    expect(body.data.files[0].virtual_path).toBe("notes.md");
  });

  it("401 — missing bearer token", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/workspace/files`, {
        method: "GET",
        headers: { "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(createDb({ session: OWNED_SESSION })),
    );
    expect(response.status).toBe(401);
  });

  it("404 — cross-user session rejected", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/workspace/files`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(
        createDb({
          session: { ...OWNED_SESSION, actor_user_uuid: OTHER_USER_UUID },
        }),
      ),
    );
    expect(response.status).toBe(404);
  });

  it("409 — conversation deleted", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/workspace/files`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(
        createDb({ session: { ...OWNED_SESSION, deleted_at: "2026-04-30T01:00:00Z" } }),
      ),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("conversation-deleted");
  });
});

describe("GET /sessions/{id}/workspace/files/{*path} — read", () => {
  it("200 happy — returns metadata + r2_key + content_source flag", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/workspace/files/notes.md`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
        },
      ),
      buildEnv(
        createDb({
          session: OWNED_SESSION,
          fileByPath: { virtual_path: "notes.md", size_bytes: 64, mime: "text/markdown" },
        }),
      ),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.ok).toBe(true);
    expect(body.data.virtual_path).toBe("notes.md");
    expect(body.data.r2_key).toBe(
      `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/notes.md`,
    );
    expect(body.data.content_source).toBe("filesystem-core-leaf-rpc-pending");
  });

  // Note on path-traversal coverage: URL canonicalization collapses
  // `..` during URL parse, and `%5C` (`\`) is preserved as-is in
  // pathname rather than decoded to a literal backslash. The unit
  // tests in `workspace-control-plane.test.ts` cover all 7 rules of
  // `normalizeVirtualPath` directly; replicating them here via fetch()
  // is structurally infeasible without re-implementing URL parsing.

  it("404 — workspace file not found", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/workspace/files/missing.md`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
        },
      ),
      buildEnv(createDb({ session: OWNED_SESSION, fileByPath: null })),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not-found");
  });
});

describe("PUT /sessions/{id}/workspace/files/{*path} — write upsert", () => {
  it("200 happy — stored:true with canonical r2_key", async () => {
    const token = await buildToken();
    // Stateful mock — pretend the row materializes after the INSERT
    // statement runs, mimicking the D1 upsert read-back path.
    let storedRow: TempFileRow | null = null;
    const db = {
      prepare: (sql: string) => ({
        bind: (..._args: unknown[]) => ({
          first: async () => {
            if (sql.includes("AND user_uuid = ?2")) return { status: "active" };
            if (sql.includes("FROM nano_conversation_sessions")) {
              return {
                conversation_uuid: "99999999-9999-4999-8999-999999999999",
                session_uuid: SESSION_UUID,
                team_uuid: TEAM_UUID,
                actor_user_uuid: USER_UUID,
                session_status: "running",
                started_at: "2026-04-30T00:00:00Z",
                ended_at: null,
                ended_reason: null,
                last_phase: null,
                default_model_id: null,
                default_reasoning_effort: null,
                title: null,
                deleted_at: null,
              };
            }
            if (sql.includes("FROM nano_session_temp_files")) {
              if (!storedRow) return null;
              return {
                temp_file_uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                session_uuid: SESSION_UUID,
                team_uuid: TEAM_UUID,
                virtual_path: storedRow.virtual_path,
                r2_object_key: `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/${storedRow.virtual_path}`,
                mime: storedRow.mime,
                size_bytes: storedRow.size_bytes,
                content_hash: "deadbeef",
                last_modified_at: "2026-04-30T00:00:00Z",
                written_by: "user",
                created_at: "2026-04-30T00:00:00Z",
                expires_at: null,
                cleanup_status: "pending",
              };
            }
            return null;
          },
          all: async () => ({ results: [] }),
          run: async () => {
            if (sql.includes("INSERT INTO nano_session_temp_files")) {
              storedRow = { virtual_path: "notes.md", size_bytes: 64, mime: "text/markdown" };
            }
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
    } as any;
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/workspace/files/notes.md`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({ content_hash: "deadbeef", size_bytes: 64, mime: "text/markdown" }),
        },
      ),
      buildEnv(db),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.data.stored).toBe(true);
    expect(body.data.r2_key).toBe(
      `tenants/${TEAM_UUID}/sessions/${SESSION_UUID}/workspace/notes.md`,
    );
  });

  it("400 — write requires JSON body", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/workspace/files/notes.md`,
        {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          // no body
        },
      ),
      buildEnv(createDb({ session: OWNED_SESSION, fileByPath: null })),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid-input");
  });
});

describe("DELETE /sessions/{id}/workspace/files/{*path}", () => {
  it("200 happy — deleted:true", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/workspace/files/notes.md`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
        },
      ),
      buildEnv(createDb({ session: OWNED_SESSION })),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.data.deleted).toBe(true);
    expect(body.data.virtual_path).toBe("notes.md");
  });
});
