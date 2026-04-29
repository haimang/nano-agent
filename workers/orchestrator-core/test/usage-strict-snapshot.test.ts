// RH1 P1-09 — `/sessions/{uuid}/usage` strict snapshot policy.
// Three invariants:
//   (a) has-rows → live snapshot returned 200
//   (b) no-rows → zero-shape returned 200 (NOT null placeholders)
//   (c) D1 read failed → 503 facade error (NOT 200 + zero — strict charter §9.5)

import { describe, expect, it, vi } from "vitest";
import { NanoOrchestratorUserDO } from "../src/user-do.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const USER_AUTH_SNAPSHOT_KEY = "user/auth-snapshot";

function createState() {
  const store = new Map<string, unknown>();
  const state = {
    storage: {
      async get<T>(key: string): Promise<T | undefined> {
        return store.get(key) as T | undefined;
      },
      async put<T>(key: string, value: T): Promise<void> {
        store.set(key, value);
      },
      async delete(key: string): Promise<void> {
        store.delete(key);
      },
    },
  } as any;
  return { state, store };
}

function makeUserDo(opts: {
  readSnapshot: () => Promise<{ status: string; team_uuid: string; relay_cursor?: number; last_phase?: string; last_seen_at?: string } | null>;
  readUsageSnapshot: () => Promise<unknown> | unknown;
}) {
  const { state, store } = createState();
  store.set(USER_AUTH_SNAPSHOT_KEY, {
    sub: USER_UUID,
    user_uuid: USER_UUID,
    team_uuid: TEAM_UUID,
  });
  const userDo = new NanoOrchestratorUserDO(state, {
    NANO_AGENT_DB: undefined,
    AGENT_CORE: undefined,
    NANO_INTERNAL_BINDING_SECRET: undefined,
  });
  const readSessionStatus = vi.fn().mockResolvedValue({
    session_uuid: SESSION_UUID,
    status: "active",
    relay_cursor: 0,
    last_phase: "attached",
    last_seen_at: "2026-04-29T00:00:00Z",
  });
  (userDo as any).sessionTruth = () => ({
    readSessionStatus,
    readSnapshot: opts.readSnapshot,
    readUsageSnapshot: opts.readUsageSnapshot,
    readTimeline: async () => [],
  });
  return { userDo };
}

describe("RH1 P1-09: GET /sessions/{uuid}/usage strict snapshot", () => {
  it("(a) has-rows: returns live snapshot 200", async () => {
    const { userDo } = makeUserDo({
      readSnapshot: async () => ({
        team_uuid: TEAM_UUID,
        status: "active",
        last_phase: "attached",
        last_seen_at: "2026-04-29T00:00:00Z",
      }),
      readUsageSnapshot: async () => ({
        llm_input_tokens: 100,
        llm_output_tokens: 200,
        tool_calls: 3,
        subrequest_used: 50,
        subrequest_budget: 1000,
        estimated_cost_usd: 0.0042,
      }),
    });
    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/usage`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: { usage: any } };
    expect(body.ok).toBe(true);
    expect(body.data.usage.llm_input_tokens).toBe(100);
    expect(body.data.usage.tool_calls).toBe(3);
  });

  it("(b) no-rows: returns zero-shape (NOT null) 200", async () => {
    const { userDo } = makeUserDo({
      readSnapshot: async () => ({
        team_uuid: TEAM_UUID,
        status: "active",
        last_phase: "attached",
        last_seen_at: "2026-04-29T00:00:00Z",
      }),
      readUsageSnapshot: async () => null,
    });
    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/usage`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: { usage: Record<string, number> } };
    expect(body.ok).toBe(true);
    // RH1 P1-09 (a) — zero shape, NOT null/undefined.
    expect(body.data.usage.llm_input_tokens).toBe(0);
    expect(body.data.usage.llm_output_tokens).toBe(0);
    expect(body.data.usage.tool_calls).toBe(0);
    expect(body.data.usage.subrequest_used).toBe(0);
    expect(body.data.usage.subrequest_budget).toBe(0);
    expect(body.data.usage.estimated_cost_usd).toBe(0);
  });

  it("(c) D1 read failed: returns 503 facade error (NOT 200 + zero)", async () => {
    const { userDo } = makeUserDo({
      readSnapshot: async () => ({
        team_uuid: TEAM_UUID,
        status: "active",
        last_phase: "attached",
        last_seen_at: "2026-04-29T00:00:00Z",
      }),
      readUsageSnapshot: async () => {
        throw new Error("D1_ERROR: simulated downtime");
      },
    });
    const response = await userDo.fetch(
      new Request(`https://orchestrator.internal/sessions/${SESSION_UUID}/usage`),
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string; status: number } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("usage-d1-unavailable");
    expect(body.error.status).toBe(503);
  });
});
