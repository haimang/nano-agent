import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function createSessionDb() {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM nano_user_devices")) {
            return { status: "active" };
          }
          if (
            sql.includes("FROM nano_conversation_sessions s") &&
            sql.includes("JOIN nano_conversations c")
          ) {
            return {
              conversation_uuid: CONVERSATION_UUID,
              session_uuid: SESSION_UUID,
              team_uuid: TEAM_UUID,
              actor_user_uuid: USER_UUID,
              session_status: "detached",
              started_at: "2026-04-29T01:00:00Z",
              ended_at: null,
              ended_reason: null,
              last_phase: "attached",
              title: "Alpha",
              deleted_at: null,
            };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
    }),
  } as any;
}

async function authHeaders(): Promise<HeadersInit> {
  const token = await signTestJwt(
    { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
    JWT_SECRET,
  );
  return {
    authorization: `Bearer ${token}`,
    "x-trace-uuid": TRACE_UUID,
  };
}

describe("PP4 /sessions/{id}/hooks public routes", () => {
  it("POST /sessions/{id}/hooks forwards a session-scoped PreToolUse registration", async () => {
    const hookRegister = vi.fn(async (input: Record<string, unknown>, meta: unknown) => ({
      status: 200,
      body: { ok: true, data: { input, meta } },
    }));

    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/hooks`, {
        method: "POST",
        headers: {
          ...(await authHeaders()),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          id: "block-bash",
          event: "PreToolUse",
          runtime: "local-ts",
          matcher: { type: "toolName", value: "bash" },
          outcome: { action: "block", reason: "no bash" },
        }),
      }),
      {
        JWT_SECRET,
        NANO_AGENT_DB: createSessionDb(),
        TEAM_UUID,
        AGENT_CORE: { hookRegister } as any,
      },
    );

    expect(response.status).toBe(200);
    expect(hookRegister).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: SESSION_UUID,
        id: "block-bash",
        event: "PreToolUse",
      }),
      expect.objectContaining({
        trace_uuid: TRACE_UUID,
        authority: expect.objectContaining({
          sub: USER_UUID,
          tenant_uuid: TEAM_UUID,
          source_name: "orchestrator-core.session-hooks",
        }),
      }),
    );
  });

  it("DELETE /sessions/{id}/hooks/{handlerId} forwards unregister", async () => {
    const hookUnregister = vi.fn(async (input: Record<string, unknown>) => ({
      status: 200,
      body: { ok: true, data: input },
    }));

    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/hooks/block-bash`, {
        method: "DELETE",
        headers: await authHeaders(),
      }),
      {
        JWT_SECRET,
        NANO_AGENT_DB: createSessionDb(),
        TEAM_UUID,
        AGENT_CORE: { hookUnregister } as any,
      },
    );

    expect(response.status).toBe(200);
    expect(hookUnregister).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: SESSION_UUID,
        handler_id: "block-bash",
      }),
      expect.any(Object),
    );
  });
});
