// HPX3 F5 — endpoint-level direct test for POST /me/devices/revoke.
// Closes the test gap flagged by part2 reviewers (W-ME-01 / W-DEV-01):
// before this file, only cross-e2e covered the revoke path, leaving local
// regression unprotected. Pairs with `me-devices-route.test.ts` (GET).
//
// Source under test: handleMeDevicesRevoke in
// `workers/orchestrator-core/src/index.ts:2106-2213`.
import { describe, expect, it } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const DEVICE_UUID = "11111111-1111-4111-8111-111111111111";
const JWT_SECRET = "x".repeat(32);

interface DeviceRow {
  user_uuid: string;
  status: "active" | "revoked";
}

// The handler runs two queries against `nano_user_devices`:
//   1. device gate (auth.ts:readDeviceStatus)
//        SQL selects `status` with binds (?1=device, ?2=user, ?3=team)
//   2. ownership check (handleMeDevicesRevoke)
//        SQL selects `user_uuid, status` with bind (?1=device)
// Distinguishing by SQL keeps gate=active while ownership=ownerRow.
function createDb(ownerRow: DeviceRow | null) {
  return {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () =>
          sql.includes("AND user_uuid = ?2") ? { status: "active" } : ownerRow,
        run: async () => ({ success: true, meta: { changes: 1 } }),
      }),
    }),
    batch: async (_stmts: unknown[]) => [
      { success: true, meta: { changes: 1 } },
      { success: true, meta: { changes: 1 } },
    ],
  } as any;
}

function createUserDoStub() {
  return {
    idFromName: (_name: string) => "stub-id",
    get: (_id: string) => ({
      fetch: async (_req: Request) => new Response(null, { status: 204 }),
    }),
  } as any;
}

async function buildRequest(body: unknown, opts?: { token?: string; trace?: string | null }): Promise<Request> {
  const token =
    opts?.token ??
    (await signTestJwt(
      {
        sub: USER_UUID,
        user_uuid: USER_UUID,
        team_uuid: TEAM_UUID,
        device_uuid: DEVICE_UUID,
      },
      JWT_SECRET,
    ));
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  if (opts?.trace !== null) {
    headers["x-trace-uuid"] = opts?.trace ?? TRACE_UUID;
  }
  return new Request("https://example.com/me/devices/revoke", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /me/devices/revoke route", () => {
  it("200 happy — revokes own active device", async () => {
    const db = createDb({ user_uuid: USER_UUID, status: "active" });
    const response = await worker.fetch(
      await buildRequest({ device_uuid: DEVICE_UUID, reason: "lost phone" }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: createUserDoStub(),
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.ok).toBe(true);
    expect(body.data.device_uuid).toBe(DEVICE_UUID);
    expect(body.data.status).toBe("revoked");
    expect(typeof body.data.revoked_at).toBe("string");
    expect(typeof body.data.revocation_uuid).toBe("string");
    expect(body.data.already_revoked).toBeUndefined();
  });

  it("200 idempotent — already revoked returns already_revoked:true", async () => {
    const db = createDb({ user_uuid: USER_UUID, status: "revoked" });
    const response = await worker.fetch(
      await buildRequest({ device_uuid: DEVICE_UUID }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: createUserDoStub(),
      } as any,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; data: any };
    expect(body.ok).toBe(true);
    expect(body.data.already_revoked).toBe(true);
    expect(body.data.status).toBe("revoked");
  });

  it("400 invalid — device_uuid not a UUID", async () => {
    const db = createDb(null);
    const response = await worker.fetch(
      await buildRequest({ device_uuid: "not-a-uuid" }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: createUserDoStub(),
      } as any,
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: false; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("invalid-input");
  });

  it("403 — device belongs to another user", async () => {
    const db = createDb({ user_uuid: OTHER_USER_UUID, status: "active" });
    const response = await worker.fetch(
      await buildRequest({ device_uuid: DEVICE_UUID }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: createUserDoStub(),
      } as any,
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe("permission-denied");
  });

  it("404 — device not found", async () => {
    const db = createDb(null);
    const response = await worker.fetch(
      await buildRequest({ device_uuid: DEVICE_UUID }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        NANO_AGENT_DB: db,
        ORCHESTRATOR_USER_DO: createUserDoStub(),
      } as any,
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe("not-found");
  });

  it("401 — missing bearer token", async () => {
    const db = createDb(null);
    const request = new Request("https://example.com/me/devices/revoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-trace-uuid": TRACE_UUID,
      },
      body: JSON.stringify({ device_uuid: DEVICE_UUID }),
    });
    const response = await worker.fetch(request, {
      JWT_SECRET,
      TEAM_UUID: "nano-agent",
      NANO_AGENT_DB: db,
      ORCHESTRATOR_USER_DO: createUserDoStub(),
    } as any);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { ok: false; error: { code: string } };
    expect(body.error.code).toBe("invalid-auth");
  });
});
