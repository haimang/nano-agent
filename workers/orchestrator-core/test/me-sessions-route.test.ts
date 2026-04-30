import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

type Row = Record<string, unknown>;

function createSessionDb(rowsFor: (teamUuid: string, userUuid: string, limit: number) => Row[]) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: async () => {
          if (sql.includes("FROM nano_conversation_sessions s")) {
            const [teamUuid, userUuid, , startedAt, sessionUuid, limit] = args;
            void startedAt;
            void sessionUuid;
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

describe("GET /me/sessions route", () => {
  it("200 happy — returns session page from durable cursor model", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/me/sessions", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createSessionDb(() => [
          {
            conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            session_uuid: "11111111-1111-4111-8111-111111111111",
            session_status: "detached",
            started_at: "2026-04-29T02:00:00Z",
            ended_at: null,
            ended_reason: null,
            last_phase: "attached",
            title: "Alpha",
            deleted_at: null,
          },
        ]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { sessions: any[]; next_cursor: string | null } };
    expect(body.data.sessions).toHaveLength(1);
    expect(body.data.sessions[0]).toMatchObject({
      session_uuid: "11111111-1111-4111-8111-111111111111",
      status: "detached",
      title: "Alpha",
    });
    expect(body.data.next_cursor).toBeNull();
  });

  it("200 — custom limit produces next_cursor", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/me/sessions?limit=1", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createSessionDb(() => [
          {
            conversation_uuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            session_uuid: "11111111-1111-4111-8111-111111111111",
            session_status: "active",
            started_at: "2026-04-29T02:00:00Z",
            ended_at: null,
            ended_reason: null,
            last_phase: "running",
            title: "Alpha",
            deleted_at: null,
          },
          {
            conversation_uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            session_uuid: "22222222-2222-4222-8222-222222222222",
            session_status: "ended",
            started_at: "2026-04-29T01:00:00Z",
            ended_at: "2026-04-29T01:10:00Z",
            ended_reason: "closed_by_user",
            last_phase: "ended",
            title: "Beta",
            deleted_at: null,
          },
        ]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    const body = await response.json() as { data: { sessions: any[]; next_cursor: string | null } };
    expect(body.data.sessions).toHaveLength(1);
    expect(body.data.next_cursor).toBe("2026-04-29T01:00:00Z|22222222-2222-4222-8222-222222222222");
  });

  it("cross-user — D1 query receives current user_uuid", async () => {
    const seen: Array<{ team: string; user: string; limit: number }> = [];
    const token = await signTestJwt(
      { sub: OTHER_USER_UUID, user_uuid: OTHER_USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    await worker.fetch(
      new Request("https://example.com/me/sessions?limit=10", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createSessionDb((team, user, limit) => {
          seen.push({ team, user, limit });
          return [];
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(seen).toEqual([{ team: TEAM_UUID, user: OTHER_USER_UUID, limit: 11 }]);
  });
});
