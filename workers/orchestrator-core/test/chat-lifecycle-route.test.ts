import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHECKPOINT_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONFIRMATION_UUID = "12121212-1212-4121-8121-121212121212";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function createLifecycleDb() {
  const checkpoints: Array<Record<string, unknown>> = [
    {
      checkpoint_uuid: CHECKPOINT_UUID,
      session_uuid: SESSION_UUID,
      conversation_uuid: CONVERSATION_UUID,
      team_uuid: TEAM_UUID,
      turn_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      turn_attempt: 1,
      checkpoint_kind: "user_named",
      label: "Before retry",
      message_high_watermark: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      latest_event_seq: 9,
      context_snapshot_uuid: null,
      file_snapshot_status: "none",
      created_by: "user",
      created_at: "2026-04-30T00:00:00Z",
      expires_at: null,
    },
  ];
  const confirmations: Array<Record<string, unknown>> = [
    {
      confirmation_uuid: CONFIRMATION_UUID,
      session_uuid: SESSION_UUID,
      kind: "checkpoint_restore",
      payload_json: JSON.stringify({ checkpoint_uuid: CHECKPOINT_UUID }),
      status: "pending",
      decision_payload_json: null,
      created_at: "2026-04-30T00:05:00Z",
      decided_at: null,
      expires_at: null,
    },
  ];
  const restoreJobs: Array<Record<string, unknown>> = [];
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes("nano_user_devices")) {
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
          if (sql.includes("FROM nano_conversations c")) {
            return {
              conversation_uuid: CONVERSATION_UUID,
              team_uuid: TEAM_UUID,
              owner_user_uuid: USER_UUID,
              conversation_status: "active",
              title: "Alpha",
              deleted_at: null,
              created_at: "2026-04-29T00:00:00Z",
              updated_at: "2026-04-30T00:00:00Z",
              latest_session_uuid: SESSION_UUID,
              latest_turn_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              session_count: 1,
            };
          }
          if (sql.includes("SELECT created_at") && sql.includes("FROM nano_conversation_messages")) {
            return { created_at: "2026-04-30T00:00:00Z" };
          }
          if (sql.includes("SELECT") && sql.includes("AS turn_uuid") && sql.includes("AS message_high_watermark")) {
            return {
              turn_uuid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
              turn_attempt: 1,
              message_high_watermark: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
              latest_event_seq: 11,
              context_snapshot_uuid: null,
            };
          }
          if (sql.includes("FROM nano_session_confirmations")) {
            return (
              confirmations.find(
                (row) =>
                  row.confirmation_uuid === args[0] &&
                  row.session_uuid === args[1],
              ) ?? null
            );
          }
          if (sql.includes("FROM nano_checkpoint_restore_jobs")) {
            return restoreJobs.find((row) => row.job_uuid === args[0]) ?? null;
          }
          return { status: "active" };
        },
        all: async () => {
          if (
            sql.includes("FROM nano_conversation_sessions") &&
            sql.includes("WHERE conversation_uuid = ?1")
          ) {
            return {
              results: [
                {
                  session_uuid: SESSION_UUID,
                  session_status: "detached",
                  started_at: "2026-04-29T01:00:00Z",
                  ended_at: null,
                  ended_reason: null,
                  last_phase: "attached",
                },
              ],
            };
          }
          if (sql.includes("FROM nano_session_checkpoints")) {
            return { results: checkpoints };
          }
          if (sql.includes("AND (?2 IS NULL OR created_at > ?2)")) {
            return {
              results: [
                {
                  message_uuid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
                  turn_uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                  message_kind: "assistant.message",
                  created_at: "2026-04-30T01:00:00Z",
                  superseded_at: null,
                },
              ],
            };
          }
          if (sql.includes("AND superseded_at IS NOT NULL")) {
            return {
              results: [
                {
                  message_uuid: "99999999-9999-4999-8999-999999999999",
                  turn_uuid: "ffffffff-ffff-4fff-8fff-ffffffffffff",
                  message_kind: "assistant.message",
                  created_at: "2026-04-30T00:30:00Z",
                  superseded_at: "2026-04-30T02:00:00Z",
                  superseded_by_turn_attempt: 2,
                },
              ],
            };
          }
          return { results: [] };
        },
        run: async () => {
          if (sql.includes("INSERT INTO nano_session_checkpoints")) {
            checkpoints.unshift({
              checkpoint_uuid: String(args[0]),
              session_uuid: String(args[1]),
              conversation_uuid: String(args[2]),
              team_uuid: String(args[3]),
              turn_uuid: args[4] as string | null,
              turn_attempt: args[5] as number | null,
              checkpoint_kind: "user_named",
              label: args[6] as string | null,
              message_high_watermark: args[7] as string | null,
              latest_event_seq: args[8] as number | null,
              context_snapshot_uuid: args[9] as string | null,
              file_snapshot_status: "none",
              created_by: "user",
              created_at: String(args[10]),
              expires_at: null,
            });
          }
          if (sql.includes("INSERT INTO nano_checkpoint_restore_jobs")) {
            restoreJobs.unshift({
              job_uuid: String(args[0]),
              checkpoint_uuid: String(args[1]),
              session_uuid: String(args[2]),
              mode: String(args[3]),
              target_session_uuid: args[4] as string | null,
              status: "pending",
              confirmation_uuid: args[5] as string | null,
              started_at: null,
              completed_at: null,
              failure_reason: null,
            });
          }
          return { success: true };
        },
      }),
    }),
  } as any;
}

describe("HP4 chat lifecycle public routes", () => {
  it("POST /sessions/{id}/close proxies to user DO", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const seen: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/close`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ reason: "done" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {
          idFromName: (value: string) => value,
          get: () => ({
            fetch: async (request: Request) => {
              seen.push({
                url: request.url,
                method: request.method,
                body: await request.json(),
              });
              return Response.json({
                ok: true,
                data: { action: "close", session_uuid: SESSION_UUID },
                trace_uuid: TRACE_UUID,
              });
            },
          }),
        },
      } as any,
    );
    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      url: `https://orchestrator.internal/sessions/${SESSION_UUID}/close`,
      method: "POST",
      body: expect.objectContaining({
        reason: "done",
        trace_uuid: TRACE_UUID,
      }),
    });
  });

  it("DELETE /sessions/{id} maps to internal delete action", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const seen: Array<{ url: string; method: string }> = [];
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {
          idFromName: (value: string) => value,
          get: () => ({
            fetch: async (request: Request) => {
              seen.push({ url: request.url, method: request.method });
              return Response.json({
                ok: true,
                data: { action: "delete", session_uuid: SESSION_UUID },
                trace_uuid: TRACE_UUID,
              });
            },
          }),
        },
      } as any,
    );
    expect(response.status).toBe(200);
    expect(seen).toEqual([
      {
        url: `https://orchestrator.internal/sessions/${SESSION_UUID}/delete`,
        method: "DELETE",
      },
    ]);
  });

  it("PATCH /sessions/{id}/title proxies title payload", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    let captured: Record<string, unknown> | null = null;
    await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/title`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ title: "Renamed" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {
          idFromName: (value: string) => value,
          get: () => ({
            fetch: async (request: Request) => {
              captured = await request.json();
              return Response.json({
                ok: true,
                data: { action: "title", title: "Renamed" },
                trace_uuid: TRACE_UUID,
              });
            },
          }),
        },
      } as any,
    );
    expect(captured).toMatchObject({
      title: "Renamed",
      trace_uuid: TRACE_UUID,
    });
  });

  it("GET /conversations/{id} returns conversation detail from D1", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(`https://example.com/conversations/${CONVERSATION_UUID}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createLifecycleDb(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      conversation_uuid: CONVERSATION_UUID,
      title: "Alpha",
      latest_session_uuid: SESSION_UUID,
      sessions: [expect.objectContaining({ session_uuid: SESSION_UUID })],
    });
  });

  it("GET/POST checkpoint routes read and create checkpoint registry rows", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const env = {
      JWT_SECRET,
      TEAM_UUID: "nano-agent",
      NANO_AGENT_DB: createLifecycleDb(),
      ORCHESTRATOR_USER_DO: {} as any,
    } as any;
    const listResponse = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/checkpoints`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      env,
    );
    expect(listResponse.status).toBe(200);
    expect((await listResponse.json()).data.checkpoints).toHaveLength(1);

    const createResponse = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/checkpoints`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ label: "Manual save" }),
      }),
      env,
    );
    expect(createResponse.status).toBe(201);
    expect((await createResponse.json()).data.checkpoint).toMatchObject({
      session_uuid: SESSION_UUID,
      label: "Manual save",
    });
  });

  it("GET checkpoint diff returns message and supersede projection", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/checkpoints/${CHECKPOINT_UUID}/diff`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createLifecycleDb(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.diff).toMatchObject({
      checkpoint: expect.objectContaining({ checkpoint_uuid: CHECKPOINT_UUID }),
      messages_since_checkpoint: [
        expect.objectContaining({ message_kind: "assistant.message" }),
      ],
      superseded_messages: [
        expect.objectContaining({ superseded_by_turn_attempt: 2 }),
      ],
    });
  });

  it("POST checkpoint restore opens a pending restore job", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/checkpoints/${CHECKPOINT_UUID}/restore`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({
          mode: "conversation_only",
          confirmation_uuid: CONFIRMATION_UUID,
        }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: createLifecycleDb(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(202);
    expect((await response.json()).data).toMatchObject({
      checkpoint: expect.objectContaining({ checkpoint_uuid: CHECKPOINT_UUID }),
      restore_job: expect.objectContaining({
        checkpoint_uuid: CHECKPOINT_UUID,
        session_uuid: SESSION_UUID,
        mode: "conversation_only",
        status: "pending",
        confirmation_uuid: CONFIRMATION_UUID,
      }),
    });
  });
});
