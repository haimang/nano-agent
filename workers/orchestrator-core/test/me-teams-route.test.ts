import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function createDb(rows: Record<string, unknown>[]) {
  return {
    prepare: (sql: string) => ({
      bind: (userUuid: string) => ({
        all: async () => ({
          results: sql.includes("FROM nano_team_memberships")
            ? rows.filter((row) => row.user_uuid === userUuid)
            : [],
        }),
        first: async () => ({ status: "active" }),
      }),
    }),
  } as any;
}

describe("GET /me/teams route", () => {
  it("200 — lists one team", async () => {
    const token = await signTestJwt({ sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request("https://example.com/me/teams", {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createDb([{
          user_uuid: USER_UUID,
          team_uuid: TEAM_UUID,
          team_name: "Alpha",
          team_slug: "alpha-ab12cd",
          membership_level: 100,
          plan_level: 0,
        }]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.teams).toHaveLength(1);
  });

  it("200 — lists multiple teams", async () => {
    const token = await signTestJwt({ sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request("https://example.com/me/teams", {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createDb([
          {
            user_uuid: USER_UUID,
            team_uuid: TEAM_UUID,
            team_name: "Alpha",
            team_slug: "alpha-ab12cd",
            membership_level: 100,
            plan_level: 0,
          },
          {
            user_uuid: USER_UUID,
            team_uuid: "66666666-6666-4666-8666-666666666666",
            team_name: "Beta",
            team_slug: "beta-ef34gh",
            membership_level: 50,
            plan_level: 1,
          },
        ]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect((await response.json()).data.teams).toHaveLength(2);
  });

  it("401 — missing bearer", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/me/teams", { method: "GET" }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createDb([]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
  });

  it("cross-user — only caller teams are returned", async () => {
    const token = await signTestJwt({ sub: OTHER_USER_UUID, user_uuid: OTHER_USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request("https://example.com/me/teams", {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createDb([
          {
            user_uuid: USER_UUID,
            team_uuid: TEAM_UUID,
            team_name: "Alpha",
            team_slug: "alpha-ab12cd",
            membership_level: 100,
            plan_level: 0,
          },
          {
            user_uuid: OTHER_USER_UUID,
            team_uuid: "66666666-6666-4666-8666-666666666666",
            team_name: "Beta",
            team_slug: "beta-ef34gh",
            membership_level: 50,
            plan_level: 1,
          },
        ]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    const body = await response.json();
    expect(body.data.teams).toHaveLength(1);
    expect(body.data.teams[0].team_uuid).toBe("66666666-6666-4666-8666-666666666666");
  });

  it("200 — empty list when user has no memberships", async () => {
    const token = await signTestJwt({ sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request("https://example.com/me/teams", {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createDb([]),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect((await response.json()).data.teams).toEqual([]);
  });
});
