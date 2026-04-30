import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

type Row = Record<string, unknown>;

function createConversationDb(
  rowsFor: (teamUuid: string, userUuid: string, limit: number) => Row[],
) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          if (sql.includes("FROM nano_conversations c")) {
            const [teamUuid, userUuid, , , , limit] = args;
            return {
              results: rowsFor(String(teamUuid), String(userUuid), Number(limit)),
            };
          }
          return { results: [] };
        },
        first: async () => ({ status: "active" }),
      }),
    }),
  } as any;
}

describe("GET /me/conversations route", () => {
  it("200 happy — returns grouped conversations with default limit", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/me/conversations", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createConversationDb(() => [
          {
            conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            title: "Alpha",
            started_at: "2026-04-29T01:00:00Z",
            latest_session_uuid: "11111111-1111-4111-8111-111111111111",
            latest_status: "active",
            latest_session_started_at: "2026-04-29T02:00:00Z",
            last_phase: "running",
            latest_ended_reason: null,
            session_count: 2,
          },
        ]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { conversations: any[]; next_cursor: string | null } };
    expect(body.data.conversations).toHaveLength(1);
    expect(body.data.conversations[0].session_count).toBe(2);
    expect(body.data.conversations[0].title).toBe("Alpha");
    expect(body.data.next_cursor).toBeNull();
  });

  it("200 — custom limit produces next_cursor", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/me/conversations?limit=1", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createConversationDb(() => [
          {
            conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            title: "Alpha",
            started_at: "2026-04-29T02:00:00Z",
            latest_session_uuid: "11111111-1111-4111-8111-111111111111",
            latest_status: "active",
            latest_session_started_at: "2026-04-29T02:00:00Z",
            last_phase: "running",
            latest_ended_reason: null,
            session_count: 1,
          },
          {
            conversation_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            title: "Beta",
            started_at: "2026-04-29T01:00:00Z",
            latest_session_uuid: "22222222-2222-4222-8222-222222222222",
            latest_status: "active",
            latest_session_started_at: "2026-04-29T01:00:00Z",
            last_phase: "running",
            latest_ended_reason: null,
            session_count: 1,
          },
        ]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    const body = await response.json() as { data: { conversations: any[]; next_cursor: string | null } };
    expect(body.data.conversations).toHaveLength(1);
    expect(body.data.next_cursor).toBe("2026-04-29T01:00:00Z|bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("200 — cursor skips newer rows", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/me/conversations?limit=1&cursor=2026-04-29T02:00:00Z|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createConversationDb((team, user, limit) => {
          void team;
          void user;
          void limit;
          return [
            {
              conversation_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              title: "Beta",
              started_at: "2026-04-29T01:00:00Z",
              latest_session_uuid: "22222222-2222-4222-8222-222222222222",
              latest_status: "active",
              latest_session_started_at: "2026-04-29T01:00:00Z",
              last_phase: "running",
              latest_ended_reason: null,
              session_count: 1,
            },
          ];
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    const body = await response.json() as { data: { conversations: any[] } };
    expect(body.data.conversations).toHaveLength(1);
    expect(body.data.conversations[0].conversation_uuid).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("401 missing bearer — invalid-auth", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/me/conversations", { method: "GET" }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid-auth");
  });

  it("cross-user — D1 query receives current user_uuid", async () => {
    const seen: Array<{ team: string; user: string; limit: number }> = [];
    const token = await signTestJwt(
      { sub: OTHER_USER_UUID, user_uuid: OTHER_USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    await worker.fetch(
      new Request("https://example.com/me/conversations?limit=25", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createConversationDb((team, user, limit) => {
          seen.push({ team, user, limit });
          return [];
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(seen).toEqual([{ team: TEAM_UUID, user: OTHER_USER_UUID, limit: 26 }]);
  });
});
