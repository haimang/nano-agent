// HPX3 B6 — endpoint-level direct tests for the tool-calls absorbed routes.
// Closes the test gap flagged by part5 reviewers (deepseek F-TOOL-01 升级
// FINDING + kimi W-WSK-02): before this file, GET/POST tool-calls had
// zero coverage so auth gate / session ownership / response shape were
// regression-blind. HPX6 upgrades the handler to read the durable D1 ledger.
//
// Source under test: handleSessionToolCalls in
// `workers/orchestrator-core/src/hp-absorbed-routes.ts:132-185`.

import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const OTHER_TEAM_UUID = "66666666-6666-4666-8666-666666666666";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const REQUEST_UUID = "77777777-7777-4777-8777-777777777777";
const DEVICE_UUID = "88888888-8888-4888-8888-888888888888";
const JWT_SECRET = "x".repeat(32);

interface SessionRow {
  team_uuid: string;
  actor_user_uuid: string;
  session_status: string;
  started_at: string;
  conversation_uuid: string;
  deleted_at: string | null;
}

const OWNED_SESSION: SessionRow = {
  team_uuid: TEAM_UUID,
  actor_user_uuid: USER_UUID,
  session_status: "running",
  started_at: "2026-04-30T00:00:00Z",
  conversation_uuid: "99999999-9999-4999-8999-999999999999",
  deleted_at: null,
};

// Mock D1 distinguishing device-gate vs session-lifecycle reads by SQL
// substring, returning rows shaped like the real `readSessionLifecycle`
// JOIN result.
function createDb(sessionRow: SessionRow | null) {
  const toolRow = {
    request_uuid: REQUEST_UUID,
    session_uuid: SESSION_UUID,
    conversation_uuid: OWNED_SESSION.conversation_uuid,
    turn_uuid: null,
    team_uuid: TEAM_UUID,
    tool_name: "bash",
    input_json: "{}",
    output_json: null,
    status: "cancelled",
    cancel_initiator: "user",
    started_at: "2026-04-30T00:00:00Z",
    ended_at: "2026-04-30T00:00:01Z",
    updated_at: "2026-04-30T00:00:01Z",
  };
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes("AND user_uuid = ?2")) {
            // device gate query
            return { status: "active" };
          }
          if (sql.includes("FROM nano_conversation_sessions")) {
            if (!sessionRow) return null;
            return {
              conversation_uuid: sessionRow.conversation_uuid,
              session_uuid: SESSION_UUID,
              team_uuid: sessionRow.team_uuid,
              actor_user_uuid: sessionRow.actor_user_uuid,
              session_status: sessionRow.session_status,
              started_at: sessionRow.started_at,
              ended_at: null,
              ended_reason: null,
              last_phase: null,
              default_model_id: null,
              default_reasoning_effort: null,
              title: null,
              deleted_at: sessionRow.deleted_at,
            };
          }
          if (sql.includes("FROM nano_tool_call_ledger") && sql.includes("WHERE request_uuid")) {
            return toolRow;
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  } as any;
}

async function buildToken(opts?: { team?: string; user?: string }): Promise<string> {
  return signTestJwt(
    {
      sub: opts?.user ?? USER_UUID,
      user_uuid: opts?.user ?? USER_UUID,
      team_uuid: opts?.team ?? TEAM_UUID,
      device_uuid: DEVICE_UUID,
    },
    JWT_SECRET,
  );
}

function buildEnv(db: any, forwardedFrames: Array<Record<string, unknown>> = []) {
  return {
    JWT_SECRET,
    TEAM_UUID: "nano-agent",
    NANO_AGENT_DB: db,
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

describe("GET /sessions/{id}/tool-calls — D1 ledger list", () => {
  it("200 happy — returns empty list with D1 ledger source marker", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/tool-calls`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(createDb(OWNED_SESSION)),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any; trace_uuid: string };
    expect(body.ok).toBe(true);
    expect(body.data.session_uuid).toBe(SESSION_UUID);
    expect(body.data.tool_calls).toEqual([]);
    expect(body.data.source).toBe("d1-tool-call-ledger");
    expect(body.trace_uuid).toBe(TRACE_UUID);
    expect(response.headers.get("x-trace-uuid")).toBe(TRACE_UUID);
  });

  it("401 — missing bearer token", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/tool-calls`, {
        method: "GET",
        headers: { "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(createDb(OWNED_SESSION)),
    );
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid-auth");
  });

  it("404 — session belongs to another user", async () => {
    const token = await buildToken();
    const otherSession: SessionRow = {
      ...OWNED_SESSION,
      actor_user_uuid: OTHER_USER_UUID,
    };
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/tool-calls`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(createDb(otherSession)),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("not-found");
  });

  it("404 — session belongs to another team", async () => {
    const token = await buildToken({ team: OTHER_TEAM_UUID });
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/tool-calls`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      // device gate keyed by user+team — return active for the requester team
      buildEnv(createDb(OWNED_SESSION)),
    );
    expect(response.status).toBe(404);
  });

  it("404 — session not found", async () => {
    const token = await buildToken();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/tool-calls`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(createDb(null)),
    );
    expect(response.status).toBe(404);
  });

  it("409 — conversation already deleted", async () => {
    const token = await buildToken();
    const tombstoned: SessionRow = { ...OWNED_SESSION, deleted_at: "2026-04-30T01:00:00Z" };
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/tool-calls`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      buildEnv(createDb(tombstoned)),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("conversation-deleted");
  });
});

describe("POST /sessions/{id}/tool-calls/{request_uuid}/cancel — D1 ledger cancel", () => {
  it("202 happy — returns user-initiated cancel ack", async () => {
    const token = await buildToken();
    const forwardedFrames: Array<Record<string, unknown>> = [];
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/tool-calls/${REQUEST_UUID}/cancel`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      buildEnv(createDb(OWNED_SESSION), forwardedFrames),
    );
    expect(response.status).toBe(202);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.ok).toBe(true);
    expect(body.data.session_uuid).toBe(SESSION_UUID);
    expect(body.data.request_uuid).toBe(REQUEST_UUID);
    expect(body.data.cancel_initiator).toBe("user");
    expect(body.data.status).toBe("cancelled");
    expect(forwardedFrames).toContainEqual(
      expect.objectContaining({
        kind: "tool.call.cancelled",
        tool_name: "bash",
        request_uuid: REQUEST_UUID,
        cancel_initiator: "user",
      }),
    );
  });

  it("401 — missing bearer token", async () => {
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/tool-calls/${REQUEST_UUID}/cancel`,
        {
          method: "POST",
          headers: { "x-trace-uuid": TRACE_UUID },
          body: "{}",
        },
      ),
      buildEnv(createDb(OWNED_SESSION)),
    );
    expect(response.status).toBe(401);
  });

  it("404 — cross-user session ownership rejected", async () => {
    const token = await buildToken();
    const otherSession: SessionRow = {
      ...OWNED_SESSION,
      actor_user_uuid: OTHER_USER_UUID,
    };
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/tool-calls/${REQUEST_UUID}/cancel`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: "{}",
        },
      ),
      buildEnv(createDb(otherSession)),
    );
    expect(response.status).toBe(404);
  });
});
