// RH0 P0-B5 — endpoint-level direct test for POST /sessions/{uuid}/permission/decision.
// charter §7.1 hard gate: ≥5 cases, naming `permission-decision-route.test.ts`.
//
// 当前 ZX5 阶段 permission 决策路径在 façade 层是 4-segment compound 路由,
// 转发到 User-DO 的 emitPermissionRequestAndAwait runtime(zero callsite,
// 等 RH1 wiring 真正接通)。本层测试只关心 routing + auth + body validation.
// RH1 完成后,本文件应扩 case 验证 round-trip frame emit。

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function makeUserDoMock(stubFetch: any) {
  const idFromName = vi.fn().mockReturnValue({ __kind: "user-do-id" });
  const get = vi.fn().mockReturnValue({ fetch: stubFetch });
  return { idFromName, get } as unknown as DurableObjectNamespace;
}

describe("POST /sessions/{uuid}/permission/decision route", () => {
  it("200 allow — forwards permission allow decision", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, action: "permission/decision" }),
          { status: 200 },
        ),
      );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/permission/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ request_uuid: "req-1", decision: "allow" }),
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
      `/sessions/${SESSION_UUID}/permission/decision`,
    );
  });

  it("200 deny — forwards permission deny decision", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, action: "permission/decision" }),
          { status: 200 },
        ),
      );
    await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/permission/decision`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ request_uuid: "req-2", decision: "deny" }),
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
    expect(forwardedBody.decision).toBe("deny");
  });

  it("401 missing bearer", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/permission/decision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request_uuid: "req-3", decision: "allow" }),
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

  it("400 invalid body — empty body fails parseBody on needsBody route", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi.fn();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/permission/decision`,
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
    expect((await response.json()).error.code).toBe("invalid-input");
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("404 — unknown sub-action under /permission/", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/permission/grant`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ request_uuid: "req-x" }),
        },
      ),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not-found");
  });
});
