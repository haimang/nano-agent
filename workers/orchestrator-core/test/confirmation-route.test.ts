// HP5 P1-02 — public façade `/sessions/{id}/confirmations` route tests.
//
// Frozen contract:
//   * docs/charter/plan-hero-to-pro.md §7.6 HP5
//   * docs/design/hero-to-pro/HP5-confirmation-control-plane.md §7 F3
//   * docs/design/hero-to-pro/HPX-qna.md Q16-Q18

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONFIRMATION_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

interface ConfirmationRow {
  confirmation_uuid: string;
  session_uuid: string;
  kind: string;
  payload_json: string;
  status: string;
  decision_payload_json: string | null;
  created_at: string;
  decided_at: string | null;
  expires_at: string | null;
}

function createConfirmationDb(initial?: ConfirmationRow[]) {
  const rows: ConfirmationRow[] = initial
    ? initial.map((r) => ({ ...r }))
    : [
        {
          confirmation_uuid: CONFIRMATION_UUID,
          session_uuid: SESSION_UUID,
          kind: "tool_permission",
          payload_json: JSON.stringify({
            tool_name: "bash",
            tool_input: { command: "ls" },
          }),
          status: "pending",
          decision_payload_json: null,
          created_at: "2026-04-30T00:00:00Z",
          decided_at: null,
          expires_at: "2026-04-30T00:00:30Z",
        },
      ];

  function selectFirst(sql: string, args: unknown[]): unknown {
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
    if (sql.includes("FROM nano_session_confirmations") && sql.includes("LIMIT 1")) {
      const confirmationUuid = String(args[0]);
      const sessionUuid = String(args[1]);
      return (
        rows.find(
          (r) =>
            r.confirmation_uuid === confirmationUuid &&
            r.session_uuid === sessionUuid,
        ) ?? null
      );
    }
    return null;
  }

  function selectAll(sql: string, args: unknown[]): unknown[] {
    if (sql.includes("FROM nano_session_confirmations")) {
      const sessionUuid = String(args[0]);
      let filtered = rows.filter((r) => r.session_uuid === sessionUuid);
      if (sql.includes("AND status = ?2")) {
        const status = String(args[1]);
        filtered = filtered.filter((r) => r.status === status);
      }
      return filtered.slice().sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
    }
    return [];
  }

  function exec(sql: string, args: unknown[]) {
    if (
      sql.includes("UPDATE nano_session_confirmations") &&
      sql.includes("SET status = ?3")
    ) {
      const confirmationUuid = String(args[0]);
      const sessionUuid = String(args[1]);
      const status = String(args[2]);
      const decisionPayload = args[3] as string | null;
      const decidedAt = String(args[4]);
      const target = rows.find(
        (r) =>
          r.confirmation_uuid === confirmationUuid &&
          r.session_uuid === sessionUuid &&
          r.status === "pending",
      );
      if (target) {
        target.status = status;
        target.decision_payload_json = decisionPayload;
        target.decided_at = decidedAt;
      }
    }
  }

  return {
    rows,
    db: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => selectFirst(sql, args),
          all: async () => ({ results: selectAll(sql, args) }),
          run: async () => {
            exec(sql, args);
            return { success: true };
          },
        }),
      }),
    } as any,
  };
}

describe("HP5 /sessions/{id}/confirmations public routes", () => {
  it("GET /sessions/{id}/confirmations lists registry rows", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db } = createConfirmationDb();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/confirmations`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    expect(data.session_uuid).toBe(SESSION_UUID);
    expect(data.conversation_uuid).toBe(CONVERSATION_UUID);
    expect(Array.isArray(data.confirmations)).toBe(true);
    expect((data.confirmations as unknown[]).length).toBe(1);
    expect((data.confirmations as Array<Record<string, unknown>>)[0]).toMatchObject({
      confirmation_uuid: CONFIRMATION_UUID,
      kind: "tool_permission",
      status: "pending",
    });
    expect(data.known_kinds).toEqual([
      "tool_permission",
      "elicitation",
      "model_switch",
      "context_compact",
      "fallback_model",
      "checkpoint_restore",
      "context_loss",
    ]);
  });

  it("GET /sessions/{id}/confirmations?status=pending filters by status", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db } = createConfirmationDb();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/confirmations?status=allowed`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
          },
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const data = body.data as Record<string, unknown>;
    expect(data.confirmations).toEqual([]);
  });

  it("GET /sessions/{id}/confirmations rejects unknown status", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db } = createConfirmationDb();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/confirmations?status=failed`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
          },
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(400);
  });

  it("GET /sessions/{id}/confirmations/{uuid} returns row detail", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db } = createConfirmationDb();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/confirmations/${CONFIRMATION_UUID}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
          },
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect((body.data as Record<string, unknown>).confirmation).toMatchObject({
      confirmation_uuid: CONFIRMATION_UUID,
      kind: "tool_permission",
      status: "pending",
    });
  });

  it("POST /sessions/{id}/confirmations/{uuid}/decision applies a decision", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db, rows } = createConfirmationDb();
    const permissionDecision = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/confirmations/${CONFIRMATION_UUID}/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({
            status: "allowed",
            decision_payload: { decision: "allow", scope: "once" },
          }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
        AGENT_CORE: { permissionDecision },
      } as any,
    );
    expect(response.status).toBe(200);
    expect(rows[0]!.status).toBe("allowed");
    expect(rows[0]!.decision_payload_json).toBe(
      JSON.stringify({ decision: "allow", scope: "once" }),
    );
    expect(permissionDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        session_uuid: SESSION_UUID,
        request_uuid: CONFIRMATION_UUID,
        decision: "allow",
        status: "allowed",
      }),
      expect.objectContaining({
        trace_uuid: TRACE_UUID,
        authority: expect.objectContaining({
          sub: USER_UUID,
          tenant_uuid: TEAM_UUID,
        }),
      }),
    );
  });

  it("POST /sessions/{id}/confirmations/{uuid}/decision returns 503 when runtime wakeup is unavailable", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db, rows } = createConfirmationDb();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/confirmations/${CONFIRMATION_UUID}/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({
            status: "allowed",
            decision_payload: { decision: "allow", scope: "once" },
          }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    expect(rows[0]!.status).toBe("allowed");
  });

  it("POST /sessions/{id}/confirmations/{uuid}/decision rejects status=failed (Q16)", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db } = createConfirmationDb();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/confirmations/${CONFIRMATION_UUID}/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ status: "failed" }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(400);
  });

  it("POST /confirmations/{uuid}/decision returns 409 when re-deciding with a different status", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const { db } = createConfirmationDb([
      {
        confirmation_uuid: CONFIRMATION_UUID,
        session_uuid: SESSION_UUID,
        kind: "tool_permission",
        payload_json: JSON.stringify({}),
        status: "allowed",
        decision_payload_json: JSON.stringify({ decision: "allow" }),
        created_at: "2026-04-30T00:00:00Z",
        decided_at: "2026-04-30T00:01:00Z",
        expires_at: null,
      },
    ]);
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/confirmations/${CONFIRMATION_UUID}/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ status: "denied" }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(409);
  });
});
