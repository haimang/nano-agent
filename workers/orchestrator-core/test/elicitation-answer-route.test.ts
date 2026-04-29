// RH0 P0-B6 — endpoint-level direct test for POST /sessions/{uuid}/elicitation/answer.
// charter §7.1 hard gate: ≥5 cases, naming `elicitation-answer-route.test.ts`.
//
// 当前 ZX5 阶段 elicitation answer 路径在 façade 层是 4-segment compound,
// 转发到 User-DO 的 emitElicitationRequestAndAwait runtime(zero callsite,
// RH1 wiring 真正接通)。本层测试只关心 routing + auth + body validation +
// 重复答复的 idempotency 透传(RH1 实装后再补真 idempotency assertion)。

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

describe("POST /sessions/{uuid}/elicitation/answer route", () => {
  it("200 happy — forwards elicitation answer", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, action: "elicitation/answer" }),
          { status: 200 },
        ),
      );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/elicitation/answer`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({
            request_uuid: "elc-1",
            answer: { value: "yes" },
          }),
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
      `/sessions/${SESSION_UUID}/elicitation/answer`,
    );
  });

  it("401 missing bearer", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/elicitation/answer`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request_uuid: "elc-2", answer: {} }),
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
        `https://example.com/sessions/${SESSION_UUID}/elicitation/answer`,
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
      "invalid-elicitation/answer-body",
    );
    expect(stubFetch).not.toHaveBeenCalled();
  });

  it("404 — request to unknown elicitation/* sub-action", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/elicitation/cancel`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ request_uuid: "elc-x" }),
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

  it("idempotent forwarding — repeated answer reaches User-DO twice (idempotency enforced downstream)", async () => {
    // RH0 façade-level test: 重复答复在 façade 层不被去重(去重是 User-DO
    // 内部责任)。本 case 锁定:façade 不丢弃、不合并、每次都转发,让
    // 下游 idempotency 决定 200 / 409 / replay。RH1 wiring 完成后,本
    // case 应升级为对 User-DO 返回的 status 做 assertion。
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, action: "elicitation/answer" }),
          { status: 200 },
        ),
      );
    const userDo = makeUserDoMock(stubFetch);
    for (let i = 0; i < 2; i++) {
      await worker.fetch(
        new Request(
          `https://example.com/sessions/${SESSION_UUID}/elicitation/answer`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "x-trace-uuid": TRACE_UUID,
            },
            body: JSON.stringify({
              request_uuid: "elc-dup",
              answer: { v: 1 },
            }),
          },
        ),
        {
          JWT_SECRET,
          TEAM_UUID: "nano-agent",
          ORCHESTRATOR_USER_DO: userDo,
        } as any,
      );
    }
    expect(stubFetch).toHaveBeenCalledTimes(2);
  });
});
