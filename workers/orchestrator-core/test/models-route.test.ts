// RH2 P2-04 — endpoint-level direct test for GET /models.
// charter §7.1 ≥5 case: 401 / 200-with-rows / 304 ETag match / team filter / 503 D1-fail

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TEAM_UUID_RESTRICTED = "55555555-5555-4555-8555-555555555555";
const TRACE_UUID = "33333333-3333-4333-8333-333333333350";
const JWT_SECRET = "x".repeat(32);

type Row = Record<string, unknown>;

function createD1Mock(opts: {
  modelsRows: Row[];
  policyRows?: Row[];
  shouldThrow?: boolean;
}) {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        all: async () => {
          if (opts.shouldThrow) throw new Error("D1_ERROR: simulated");
          if (sql.includes("FROM nano_models")) {
            return { results: opts.modelsRows };
          }
          if (sql.includes("FROM nano_team_model_policy")) {
            return { results: opts.policyRows ?? [] };
          }
          return { results: [] };
        },
        first: async () => (
          sql.includes("FROM nano_user_devices")
            ? { status: "active" }
            : null
        ),
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
      all: async () => {
        if (opts.shouldThrow) throw new Error("D1_ERROR: simulated");
        if (sql.includes("FROM nano_models")) {
          return { results: opts.modelsRows };
        }
        return { results: [] };
      },
    }),
  } as any;
}

describe("RH2 P2-04: GET /models", () => {
  const baseModels: Row[] = [
    {
      model_id: "@cf/meta/llama-3.1-8b-instruct",
      family: "workers-ai/llama",
      display_name: "Llama 3.1 8B",
      context_window: 8192,
      is_reasoning: 0,
      is_vision: 0,
      is_function_calling: 1,
      status: "active",
    },
    {
      model_id: "@cf/meta/llama-3.2-11b-vision-instruct",
      family: "workers-ai/llama",
      display_name: "Llama 3.2 11B Vision",
      context_window: 8192,
      is_reasoning: 0,
      is_vision: 1,
      is_function_calling: 1,
      status: "active",
    },
  ];

  it("401 missing bearer", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/models"),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createD1Mock({ modelsRows: baseModels }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
  });

  it("200 happy — returns active models with capabilities + ETag", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/models", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createD1Mock({ modelsRows: baseModels }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBeTruthy();
    const body = (await response.json()) as { ok: boolean; data: { models: any[] } };
    expect(body.data.models).toHaveLength(2);
    expect(body.data.models[0].capabilities).toEqual({
      reasoning: false,
      vision: false,
      function_calling: true,
    });
    expect(body.data.models[1].capabilities.vision).toBe(true);
  });

  it("304 ETag match — If-None-Match returns 304 with no body", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const env: any = {
      JWT_SECRET,
      TEAM_UUID: "nano-agent",
      NANO_AGENT_DB: createD1Mock({ modelsRows: baseModels }),
      ORCHESTRATOR_USER_DO: {} as any,
    };
    // First call to capture etag
    const first = await worker.fetch(
      new Request("https://example.com/models", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      env,
    );
    const etag = first.headers.get("etag")!;
    expect(etag).toBeTruthy();
    // Second call with If-None-Match
    const second = await worker.fetch(
      new Request("https://example.com/models", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "if-none-match": etag,
        },
      }),
      env,
    );
    expect(second.status).toBe(304);
  });

  it("team policy filter — disabled model is excluded", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID_RESTRICTED },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/models", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createD1Mock({
          modelsRows: baseModels,
          policyRows: [
            { model_id: "@cf/meta/llama-3.2-11b-vision-instruct", allowed: 0 },
          ],
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { models: any[] } };
    expect(body.data.models).toHaveLength(1);
    expect(body.data.models[0].model_id).toBe(
      "@cf/meta/llama-3.1-8b-instruct",
    );
  });

  it("503 D1 fail — graceful facade error (NOT 500)", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/models", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createD1Mock({ modelsRows: [], shouldThrow: true }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("models-d1-unavailable");
  });
});
