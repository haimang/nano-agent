// HPX6 Q-bridging-7 — legacy POST /sessions/{uuid}/policy/permission_mode
// is hard-deleted. Runtime control now lives at PATCH /sessions/{id}/runtime.

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION_UUID = "77777777-7777-4777-8777-777777777777";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function makeUserDoMock(stubFetch: any) {
  const idFromName = vi.fn().mockReturnValue({ __kind: "user-do-id" });
  const get = vi.fn().mockReturnValue({ fetch: stubFetch });
  return { idFromName, get } as unknown as DurableObjectNamespace;
}

describe("POST /sessions/{uuid}/policy/permission_mode route", () => {
  it("404 — legacy permission_mode route is hard-deleted", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi.fn();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/policy/permission_mode`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ mode: "default" }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: makeUserDoMock(stubFetch),
      } as any,
    );
    expect(response.status).toBe(404);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("404 — mode value is not parsed or forwarded", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi.fn();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/policy/permission_mode`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ mode: "acceptEdits" }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: makeUserDoMock(stubFetch),
      } as any,
    );
    expect(response.status).toBe(404);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("404 missing bearer — route is removed before auth forwarding", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/policy/permission_mode`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "default" }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: { idFromName, get } as any,
      } as any,
    );
    expect(response.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("404 invalid body — route is removed before body parsing", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi.fn();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/policy/permission_mode`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: "",
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: makeUserDoMock(stubFetch),
      } as any,
    );
    expect(response.status).toBe(404);
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("cross-session — no session path forwards to User-DO", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi.fn();
    const userDo = makeUserDoMock(stubFetch);
    for (const sid of [SESSION_UUID, OTHER_SESSION_UUID]) {
      await worker.fetch(
        new Request(
          `https://example.com/sessions/${sid}/policy/permission_mode`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "x-trace-uuid": TRACE_UUID,
            },
            body: JSON.stringify({ mode: "default" }),
          },
        ),
        {
          JWT_SECRET,
          TEAM_UUID: "nano-agent",
          ORCHESTRATOR_USER_DO: userDo,
        } as any,
      );
    }
    expect(stubFetch).not.toHaveBeenCalled();
  });
});
