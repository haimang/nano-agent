import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const SESSION_UUID = "77777777-7777-4777-8777-777777777777";
const CONVERSATION_UUID = "88888888-8888-4888-8888-888888888888";
const TURN_UUID = "99999999-9999-4999-8999-999999999999";
const TRACE_UUID = "33333333-3333-4333-8333-333333333350";
const JWT_SECRET = "x".repeat(32);

type Row = Record<string, unknown>;

function createSessionModelDb(state: {
  sessions: Row[];
  conversations: Row[];
  turns?: Row[];
  models: Row[];
  policies?: Row[];
  aliases?: Row[];
}) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes("FROM nano_user_devices")) {
            return { status: "active" };
          }
          if (sql.includes("JOIN nano_conversations c")) {
            const sessionUuid = String(args[0] ?? "");
            const session = state.sessions.find((row) => row.session_uuid === sessionUuid);
            if (!session) return null;
            const conversation = state.conversations.find(
              (row) => row.conversation_uuid === session.conversation_uuid,
            );
            return conversation ? { ...session, ...conversation } : null;
          }
          if (sql.includes("FROM nano_conversation_turns")) {
            const sessionUuid = String(args[0] ?? "");
            const rows = (state.turns ?? []).filter((row) => row.session_uuid === sessionUuid);
            return rows[0] ?? null;
          }
          if (sql.includes("FROM nano_model_aliases")) {
            const aliasId = String(args[0] ?? "");
            return (state.aliases ?? []).find((row) => row.alias_id === aliasId) ?? null;
          }
          if (sql.includes("FROM nano_team_model_policy")) {
            const teamUuid = String(args[0] ?? "");
            const modelId = String(args[1] ?? "");
            return (
              (state.policies ?? []).find(
                (row) => row.team_uuid === teamUuid && row.model_id === modelId,
              ) ?? null
            );
          }
          if (sql.includes("FROM nano_models")) {
            const modelId = String(args[0] ?? "");
            return state.models.find((row) => row.model_id === modelId) ?? null;
          }
          return null;
        },
        all: async () => {
          if (sql.includes("FROM nano_models")) {
            return {
              results: [...state.models].sort(
                (a, b) => Number(b.sort_priority ?? 0) - Number(a.sort_priority ?? 0),
              ),
            };
          }
          if (sql.includes("FROM nano_team_model_policy")) {
            const teamUuid = String(args[0] ?? "");
            return {
              results: (state.policies ?? []).filter((row) => row.team_uuid === teamUuid),
            };
          }
          if (sql.includes("FROM nano_model_aliases")) {
            return { results: state.aliases ?? [] };
          }
          return { results: [] };
        },
        run: async () => {
          if (sql.includes("UPDATE nano_conversation_sessions")) {
            const sessionUuid = String(args[0] ?? "");
            const session = state.sessions.find((row) => row.session_uuid === sessionUuid);
            if (session) {
              session.default_model_id = args[1] ?? null;
              session.default_reasoning_effort = args[2] ?? null;
            }
          }
          return { success: true, meta: { changes: 1 } };
        },
      }),
      all: async () => {
        if (sql.includes("FROM nano_models")) {
          return {
            results: [...state.models].sort(
              (a, b) => Number(b.sort_priority ?? 0) - Number(a.sort_priority ?? 0),
            ),
          };
        }
        if (sql.includes("FROM nano_model_aliases")) {
          return { results: state.aliases ?? [] };
        }
        return { results: [] };
      },
    }),
  } as any;
}

describe("HP2 session model routes", () => {
  const baseSessions = (): Row[] => [
    {
      conversation_uuid: CONVERSATION_UUID,
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      actor_user_uuid: USER_UUID,
      session_status: "active",
      started_at: "2026-04-30T00:00:00.000Z",
      ended_at: null,
      ended_reason: null,
      last_phase: "assistant.reply",
      default_model_id: null,
      default_reasoning_effort: null,
    },
  ];
  const baseConversations: Row[] = [
    {
      conversation_uuid: CONVERSATION_UUID,
      title: "test",
      deleted_at: null,
    },
  ];
  const baseModels: Row[] = [
    {
      model_id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      family: "workers-ai/llama",
      display_name: "Balanced",
      context_window: 131072,
      is_reasoning: 0,
      is_vision: 0,
      is_function_calling: 1,
      status: "active",
      sort_priority: 90,
      max_output_tokens: 4096,
      effective_context_pct: 0.75,
      auto_compact_token_limit: 64000,
      supported_reasoning_levels: "[]",
      input_modalities: '["text"]',
      provider_key: "workers-ai",
      fallback_model_id: null,
      base_instructions_suffix: null,
      description: "Balanced",
    },
    {
      model_id: "@cf/meta/llama-4-scout-17b-16e-instruct",
      family: "workers-ai/llama",
      display_name: "Reasoning",
      context_window: 131072,
      is_reasoning: 1,
      is_vision: 0,
      is_function_calling: 1,
      status: "active",
      sort_priority: 80,
      max_output_tokens: 4096,
      effective_context_pct: 0.75,
      auto_compact_token_limit: 64000,
      supported_reasoning_levels: '["medium","low"]',
      input_modalities: '["text"]',
      provider_key: "workers-ai",
      fallback_model_id: null,
      base_instructions_suffix: null,
      description: "Reasoning",
    },
  ];

  it("GET /sessions/{id}/model returns session state + latest turn audit", async () => {
    const token = await signTestJwt({ sub: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/model`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createSessionModelDb({
          sessions: baseSessions(),
          conversations: baseConversations,
          turns: [
            {
              turn_uuid: TURN_UUID,
              session_uuid: SESSION_UUID,
              created_at: "2026-04-30T00:01:00.000Z",
              requested_model_id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
              requested_reasoning_effort: null,
              effective_model_id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
              effective_reasoning_effort: null,
              fallback_used: 0,
              fallback_reason: null,
            },
          ],
          models: baseModels,
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        source: string;
        effective_default_model_id: string;
        last_turn: { effective_model_id: string };
      };
    };
    expect(body.data.source).toBe("global");
    expect(body.data.effective_default_model_id).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(body.data.last_turn.effective_model_id).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("PATCH /sessions/{id}/model resolves alias and normalizes reasoning", async () => {
    const token = await signTestJwt({ sub: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const sessions = baseSessions();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/model`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model_id: "@alias/reasoning",
          reasoning: { effort: "high" },
        }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createSessionModelDb({
          sessions,
          conversations: baseConversations,
          models: baseModels,
          aliases: [
            {
              alias_id: "@alias/reasoning",
              target_model_id: "@cf/meta/llama-4-scout-17b-16e-instruct",
            },
          ],
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { default_model_id: string; default_reasoning_effort: string };
    };
    expect(body.data.default_model_id).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(body.data.default_reasoning_effort).toBe("medium");
    expect(sessions[0]!.default_model_id).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
  });

  it("PATCH /sessions/{id}/model clears session default with model_id null", async () => {
    const token = await signTestJwt({ sub: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const sessions = baseSessions();
    sessions[0]!.default_model_id = "@cf/meta/llama-4-scout-17b-16e-instruct";
    sessions[0]!.default_reasoning_effort = "medium";
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/model`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model_id: null }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createSessionModelDb({
          sessions,
          conversations: baseConversations,
          models: baseModels,
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { default_model_id: string | null; source: string };
    };
    expect(body.data.default_model_id).toBeNull();
    expect(body.data.source).toBe("global");
  });

  it("PATCH /sessions/{id}/model rejects ended session", async () => {
    const token = await signTestJwt({ sub: USER_UUID, team_uuid: TEAM_UUID }, JWT_SECRET);
    const sessions = baseSessions();
    sessions[0]!.session_status = "ended";
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/model`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model_id: "@cf/meta/llama-4-scout-17b-16e-instruct" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createSessionModelDb({
          sessions,
          conversations: baseConversations,
          models: baseModels,
        }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(409);
  });
});
