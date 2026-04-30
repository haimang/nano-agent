import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { cleanupObservabilityLogs } from "../src/cron/cleanup.js";
import { createOrchestratorLogger } from "../src/observability.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const OTHER_TEAM_UUID = "55555555-5555-4555-8555-555555555555";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function createDb() {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const rows = {
    error: [
      {
        log_uuid: "log-1",
        trace_uuid: TRACE_UUID,
        team_uuid: TEAM_UUID,
        worker: "orchestrator-core",
        code: "internal-error",
        severity: "warn",
        message: "boom",
        created_at: "2026-04-30T00:00:00.000Z",
      },
    ],
    audit: [
      {
        audit_uuid: "audit-1",
        trace_uuid: TRACE_UUID,
        team_uuid: TEAM_UUID,
        event_kind: "auth.login.success",
        outcome: "ok",
        created_at: "2026-04-30T00:00:00.000Z",
      },
    ],
  };
  return {
    queries,
    db: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => {
            queries.push({ sql, args });
            if (sql.includes("FROM nano_user_devices")) return { status: "active" };
            return null;
          },
          all: async () => {
            queries.push({ sql, args });
            if (sql.includes("FROM nano_error_log")) return { results: rows.error };
            if (sql.includes("FROM nano_audit_log")) return { results: rows.audit };
            return { results: [] };
          },
          run: async () => {
            queries.push({ sql, args });
            return { success: true, meta: { changes: 1 } };
          },
        }),
      }),
      batch: async (statements: Array<{ run: () => Promise<unknown> }>) => {
        for (const statement of statements) await statement.run();
        return statements.map(() => ({ success: true }));
      },
    },
  };
}

async function authHeaders(membership_level = 100) {
  const token = await signTestJwt(
    {
      sub: USER_UUID,
      user_uuid: USER_UUID,
      team_uuid: TEAM_UUID,
      membership_level,
      device_uuid: `11111111-1111-4111-8111-${String(membership_level).padStart(12, "0")}`,
    },
    JWT_SECRET,
  );
  return {
    authorization: `Bearer ${token}`,
    "x-trace-uuid": TRACE_UUID,
  };
}

describe("orchestrator-core debug routes", () => {
  it("GET /debug/logs returns team-scoped D1 error rows", async () => {
    const { db, queries } = createDb();
    const response = await worker.fetch(
      new Request(`https://example.com/debug/logs?trace_uuid=${TRACE_UUID}&limit=10`, {
        headers: await authHeaders(),
      }),
      { JWT_SECRET, NANO_AGENT_DB: db, ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace } as any,
    );
    const body = await response.json() as { data: { logs: Array<Record<string, unknown>> } };
    expect(response.status).toBe(200);
    expect(body.data.logs[0]?.code).toBe("internal-error");
    const logQuery = queries.find((q) => q.sql.includes("FROM nano_error_log"));
    expect(logQuery?.args[0]).toBe(TEAM_UUID);
    expect(logQuery?.args).toContain(TRACE_UUID);
  });

  it("GET /debug/logs rejects cross-team filters", async () => {
    const { db } = createDb();
    const response = await worker.fetch(
      new Request(`https://example.com/debug/logs?team_uuid=${OTHER_TEAM_UUID}`, {
        headers: await authHeaders(),
      }),
      { JWT_SECRET, NANO_AGENT_DB: db, ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace } as any,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("permission-denied");
  });

  it("GET /debug/recent-errors returns in-memory logger records", async () => {
    const { db } = createDb();
    const env = { JWT_SECRET, NANO_AGENT_DB: db, ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace } as any;
    createOrchestratorLogger(env).error("debug-route-test-error", {
      code: "internal-error",
      ctx: { reason: "unit-test" },
    });

    const response = await worker.fetch(
      new Request("https://example.com/debug/recent-errors?limit=5", {
        headers: await authHeaders(),
      }),
      env,
    );
    const body = await response.json() as { data: { recent_errors: Array<Record<string, unknown>> } };
    expect(response.status).toBe(200);
    expect(body.data.recent_errors.some((entry) => entry.msg === "debug-route-test-error")).toBe(true);
  });

  it("GET /debug/audit requires a team owner", async () => {
    const { db } = createDb();
    const response = await worker.fetch(
      new Request("https://example.com/debug/audit", {
        headers: await authHeaders(50),
      }),
      { JWT_SECRET, NANO_AGENT_DB: db, ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace } as any,
    );
    const body = await response.json() as { error: { code: string } };
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("permission-denied");
  });

  it("GET /debug/audit returns owner-visible audit rows", async () => {
    const { db, queries } = createDb();
    const response = await worker.fetch(
      new Request("https://example.com/debug/audit?event_kind=auth.login.success", {
        headers: await authHeaders(),
      }),
      { JWT_SECRET, NANO_AGENT_DB: db, ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace } as any,
    );
    const body = await response.json() as { data: { audit: Array<Record<string, unknown>> } };
    expect(response.status).toBe(200);
    expect(body.data.audit[0]?.event_kind).toBe("auth.login.success");
    const auditQuery = queries.find((q) => q.sql.includes("FROM nano_audit_log"));
    expect(auditQuery?.args[0]).toBe(TEAM_UUID);
    expect(auditQuery?.args).toContain("auth.login.success");
  });

  it("GET /debug/packages exposes deployed manifest and degrades registry without token", async () => {
    const { db } = createDb();
    const response = await worker.fetch(
      new Request("https://example.com/debug/packages", {
        headers: await authHeaders(),
      }),
      { JWT_SECRET, NANO_AGENT_DB: db, ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace } as any,
    );
    const body = await response.json() as {
      data: { deployed: { worker: string }; registry: Array<{ status: string }> };
    };
    expect(response.status).toBe(200);
    expect(body.data.deployed.worker).toBe("orchestrator-core");
    expect(body.data.registry.every((pkg) => pkg.status === "auth-not-available-in-runtime")).toBe(true);
  });
});

describe("orchestrator-core observability cleanup cron", () => {
  it("deletes error and audit rows past their retention windows", async () => {
    const { db, queries } = createDb();
    const result = await cleanupObservabilityLogs(
      { NANO_AGENT_DB: db as unknown as D1Database },
      new Date("2026-04-30T03:00:00.000Z"),
    );

    expect(result.ok).toBe(true);
    expect(queries.some((q) => q.sql.includes("DELETE FROM nano_error_log"))).toBe(true);
    expect(queries.some((q) => q.sql.includes("DELETE FROM nano_audit_log"))).toBe(true);
    expect(queries.find((q) => q.sql.includes("DELETE FROM nano_error_log"))?.args[0]).toBe(
      "2026-04-16T03:00:00.000Z",
    );
    expect(queries.find((q) => q.sql.includes("DELETE FROM nano_audit_log"))?.args[0]).toBe(
      "2026-01-30T03:00:00.000Z",
    );
  });
});
