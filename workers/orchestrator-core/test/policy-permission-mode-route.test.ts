// RH0 P0-B7 — endpoint-level direct test for POST /sessions/{uuid}/policy/permission_mode.
// charter §7.1 hard gate: ≥5 cases, naming `policy-permission-mode-route.test.ts`.
//
// 当前 ZX5 阶段 policy/permission_mode 路径在 façade 层是 4-segment compound,
// 转发到 User-DO 内部维护 sessionState.permissionMode。本层测试只关心
// routing + auth + body validation + 跨 session 隔离基线。

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
  it("200 set — forwards mode change", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            action: "policy/permission_mode",
            mode: "default",
          }),
          { status: 200 },
        ),
      );
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
    expect(response.status).toBe(200);
    expect(new URL(stubFetch.mock.calls[0]![0]!.url).pathname).toBe(
      `/sessions/${SESSION_UUID}/policy/permission_mode`,
    );
  });

  it("200 — different mode value passed through (façade does not validate mode list)", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            action: "policy/permission_mode",
            mode: "acceptEdits",
          }),
          { status: 200 },
        ),
      );
    await worker.fetch(
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
    const forwardedBody = (await stubFetch.mock.calls[0]![0]!.json()) as Record<
      string,
      unknown
    >;
    expect(forwardedBody.mode).toBe("acceptEdits");
  });

  it("401 missing bearer", async () => {
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
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid-auth");
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("400 invalid — empty body fails parseBody", async () => {
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
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(
      "invalid-policy/permission_mode-body",
    );
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("cross-session — different SESSION_UUID forwards to different path on the same User-DO", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            action: "policy/permission_mode",
          }),
          { status: 200 },
        ),
      );
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
    const paths = stubFetch.mock.calls.map(
      (c) => new URL(c[0]!.url).pathname,
    );
    expect(paths).toContain(
      `/sessions/${SESSION_UUID}/policy/permission_mode`,
    );
    expect(paths).toContain(
      `/sessions/${OTHER_SESSION_UUID}/policy/permission_mode`,
    );
  });
});
