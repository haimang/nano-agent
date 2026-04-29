import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function createDb(options?: { membership_level?: number; user_uuid?: string }) {
  const membershipLevel = options?.membership_level ?? 100;
  const userUuid = options?.user_uuid ?? USER_UUID;
  const rows = {
    team_uuid: TEAM_UUID,
    team_name: "Alpha Team",
    team_slug: "alpha-team-ab12cd",
    plan_level: 0,
    membership_level: membershipLevel,
  };
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM nano_user_devices")) return { status: "active" };
          if (sql.includes("FROM nano_teams t")) {
            return args[1] === userUuid ? rows : null;
          }
          return null;
        },
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
  } as any;
}

describe("/me/team route", () => {
  it("GET 200 — returns current team", async () => {
    const token = await signTestJwt({ sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request("https://example.com/me/team", {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, "x-trace-uuid": TRACE_UUID },
      }),
      { JWT_SECRET, TEAM_UUID: "nano-agent", NANO_AGENT_DB: createDb(), ORCHESTRATOR_USER_DO: {} as any } as any,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.team_slug).toBe("alpha-team-ab12cd");
  });

  it("PATCH 200 — owner can update team_name", async () => {
    const token = await signTestJwt({ sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request("https://example.com/me/team", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ team_name: "Renamed Team" }),
      }),
      { JWT_SECRET, TEAM_UUID: "nano-agent", NANO_AGENT_DB: createDb(), ORCHESTRATOR_USER_DO: {} as any } as any,
    );
    expect(response.status).toBe(200);
  });

  it("PATCH 403 — non-owner cannot update team_name", async () => {
    const token = await signTestJwt({ sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request("https://example.com/me/team", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ team_name: "Renamed Team" }),
      }),
      { JWT_SECRET, TEAM_UUID: "nano-agent", NANO_AGENT_DB: createDb({ membership_level: 50 }), ORCHESTRATOR_USER_DO: {} as any } as any,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("permission-denied");
  });

  it("GET 401 — missing bearer", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/me/team", { method: "GET" }),
      { JWT_SECRET, TEAM_UUID: "nano-agent", NANO_AGENT_DB: createDb(), ORCHESTRATOR_USER_DO: {} as any } as any,
    );
    expect(response.status).toBe(401);
  });

  it("GET 200 — accepts nak_ bearer via verifyApiKey", async () => {
    const verifyApiKey = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        supported: true,
        key_id: "nak_team_key",
        team_uuid: TEAM_UUID,
        user_uuid: USER_UUID,
        membership_level: 100,
        source_name: "orchestrator.auth.api-key",
      },
    });
    const response = await worker.fetch(
      new Request("https://example.com/me/team", {
        method: "GET",
        headers: { authorization: "Bearer nak_team_key", "x-trace-uuid": TRACE_UUID },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_AUTH: { verifyApiKey } as any,
        NANO_AGENT_DB: createDb(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    expect(verifyApiKey).toHaveBeenCalledOnce();
  });
});
