// RH2 P2-05/06/07 — endpoint-level direct test for /sessions/{uuid}/context*.
// 5 case per endpoint × 3 endpoints = 15 case (we batch in this file for compactness).

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333360";
const JWT_SECRET = "x".repeat(32);

function makeContextCoreMock(overrides?: {
  getContextSnapshot?: any;
  triggerContextSnapshot?: any;
  triggerCompact?: any;
  shouldThrow?: boolean;
}) {
  const stub = (name: string, defaultValue: unknown) =>
    overrides?.shouldThrow
      ? vi.fn().mockRejectedValue(new Error(`context-core ${name} simulated failure`))
      : overrides?.[name as keyof typeof overrides] ??
        vi.fn().mockResolvedValue(defaultValue);
  return {
    getContextSnapshot: stub("getContextSnapshot", {
      session_uuid: SESSION_UUID,
      team_uuid: TEAM_UUID,
      status: "ready",
      summary: "stub",
      artifacts_count: 0,
      need_compact: false,
      phase: "stub",
    }),
    triggerContextSnapshot: stub("triggerContextSnapshot", {
      snapshot_id: "snap-1",
      created_at: "2026-04-29T00:00:00Z",
    }),
    triggerCompact: stub("triggerCompact", {
      compacted: true,
      before_size: 0,
      after_size: 0,
    }),
  };
}

describe("RH2 P2-05: GET /sessions/{uuid}/context", () => {
  it("200 happy — returns snapshot from context-core RPC", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const ctx = makeContextCoreMock();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/context`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: ctx,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("ready");
    expect(ctx.getContextSnapshot).toHaveBeenCalledWith(
      SESSION_UUID,
      TEAM_UUID,
      expect.objectContaining({ trace_uuid: expect.any(String), team_uuid: TEAM_UUID }),
    );
  });

  it("401 missing bearer", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/context`),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
  });

  it("400 invalid session uuid", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/sessions/not-a-uuid/context", {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    // Note: Non-UUID won't match the route regex, so it'll fall through to
    // parseSessionRoute which also rejects non-UUID and returns 404 not-found.
    expect([400, 404]).toContain(response.status);
  });

  it("503 CONTEXT_CORE binding missing", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/context`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        // CONTEXT_CORE intentionally omitted
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("worker-misconfigured");
  });

  it("503 RPC throw — facade returns context-rpc-unavailable", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/context`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock({ shouldThrow: true }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("context-rpc-unavailable");
  });
});

describe("RH2 P2-06: POST /sessions/{uuid}/context/snapshot", () => {
  it("200 — context-core triggerContextSnapshot called", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const ctx = makeContextCoreMock();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/snapshot`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: ctx,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.data.snapshot_id).toBe("snap-1");
    expect(ctx.triggerContextSnapshot).toHaveBeenCalled();
  });

  it("401 missing bearer", async () => {
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/snapshot`,
        { method: "POST" },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
  });

  // Response to kimi R4 / GLM R10: bring snapshot endpoint to ≥5 case per
  // charter §9.2 ("each new public endpoint ≥5 endpoint-level cases").
  it("400/404 invalid session uuid", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/sessions/not-a-uuid/context/snapshot", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect([400, 404]).toContain(response.status);
  });

  it("503 CONTEXT_CORE binding missing", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/snapshot`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        // CONTEXT_CORE intentionally omitted
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("worker-misconfigured");
  });

  it("503 RPC throw — facade returns context-rpc-unavailable", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/snapshot`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock({ shouldThrow: true }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("context-rpc-unavailable");
  });
});

describe("RH2 P2-07: POST /sessions/{uuid}/context/compact", () => {
  it("200 — context-core triggerCompact called", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const ctx = makeContextCoreMock();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/compact`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: ctx,
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.data.compacted).toBe(true);
    expect(ctx.triggerCompact).toHaveBeenCalled();
  });

  it("503 — RPC throws", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/compact`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock({ shouldThrow: true }),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
  });

  // Response to kimi R4 / GLM R10: bring compact endpoint to ≥5 case per
  // charter §9.2.
  it("401 missing bearer", async () => {
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/compact`,
        { method: "POST" },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
  });

  it("400/404 invalid session uuid", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/sessions/not-a-uuid/context/compact", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        CONTEXT_CORE: makeContextCoreMock(),
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect([400, 404]).toContain(response.status);
  });

  it("503 CONTEXT_CORE binding missing", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/context/compact`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-trace-uuid": TRACE_UUID,
            "content-type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        // CONTEXT_CORE intentionally omitted
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("worker-misconfigured");
  });
});
