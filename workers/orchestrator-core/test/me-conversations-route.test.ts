// RH0 P0-B3 — endpoint-level direct test for GET /me/conversations.
// charter §7.1 hard gate: ≥5 cases, naming `me-conversations-route.test.ts`.
//
// 当前 ZX5 阶段 /me/conversations 是基于 5 状态 D1 view + User-DO 聚合,
// 走 service binding 到 User-DO `/me/conversations`。本层测试只关心
// façade routing + auth + cursor / limit 解析。

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function makeUserDoMock(stubFetch: any) {
  const idFromName = vi.fn().mockImplementation((sub: string) => ({
    __kind: "user-do-id",
    sub,
  }));
  const get = vi.fn().mockReturnValue({ fetch: stubFetch });
  return { idFromName, get } as unknown as DurableObjectNamespace;
}

describe("GET /me/conversations route", () => {
  it("200 happy — returns first page with default limit=50", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: { conversations: [], next_cursor: null },
          }),
          { status: 200 },
        ),
      );
    const response = await worker.fetch(
      new Request("https://example.com/me/conversations", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: makeUserDoMock(stubFetch),
      } as any,
    );
    expect(response.status).toBe(200);
    const url = new URL(stubFetch.mock.calls[0]![0]!.url);
    expect(url.pathname).toBe("/me/conversations");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("200 — custom limit honored", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: { conversations: [], next_cursor: null },
          }),
          { status: 200 },
        ),
      );
    await worker.fetch(
      new Request("https://example.com/me/conversations?limit=25", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: makeUserDoMock(stubFetch),
      } as any,
    );
    const url = new URL(stubFetch.mock.calls[0]![0]!.url);
    expect(url.searchParams.get("limit")).toBe("25");
  });

  it("200 — invalid limit (non-numeric) falls back to default 50", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: { conversations: [], next_cursor: null },
          }),
          { status: 200 },
        ),
      );
    await worker.fetch(
      new Request("https://example.com/me/conversations?limit=foo", {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: makeUserDoMock(stubFetch),
      } as any,
    );
    const url = new URL(stubFetch.mock.calls[0]![0]!.url);
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("401 missing bearer — invalid-auth", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/me/conversations", {
        method: "GET",
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("invalid-auth");
  });

  it("cross-user — different sub keys to different User-DO id", async () => {
    const tokenA = await signTestJwt(
      { sub: USER_UUID, user_uuid: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const tokenB = await signTestJwt(
      {
        sub: OTHER_USER_UUID,
        user_uuid: OTHER_USER_UUID,
        team_uuid: TEAM_UUID,
      },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            data: { conversations: [], next_cursor: null },
          }),
          { status: 200 },
        ),
      );
    const userDo = makeUserDoMock(stubFetch);
    await worker.fetch(
      new Request("https://example.com/me/conversations", {
        method: "GET",
        headers: {
          authorization: `Bearer ${tokenA}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: userDo,
      } as any,
    );
    await worker.fetch(
      new Request("https://example.com/me/conversations", {
        method: "GET",
        headers: {
          authorization: `Bearer ${tokenB}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: userDo,
      } as any,
    );
    expect((userDo as any).idFromName).toHaveBeenCalledWith(USER_UUID);
    expect((userDo as any).idFromName).toHaveBeenCalledWith(OTHER_USER_UUID);
  });
});
