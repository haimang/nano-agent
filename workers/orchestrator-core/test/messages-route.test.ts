// RH0 P0-B1 — endpoint-level direct test for POST /sessions/{uuid}/messages.
// charter §7.1 hard gate: ≥5 cases, naming `messages-route.test.ts`.
//
// 这层测试是 façade-level routing + auth gate 的回归基线,不验证 User-DO
// 内部行为(那由 user-do.test.ts 覆盖)。后续 RH2/RH5 修改 messages ingress
// 时,本文件提供 happy + 401 + 403 + 400 + 404 五条最小护栏。

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

describe("POST /sessions/{uuid}/messages route", () => {
  it("200 happy — forwards authenticated message to User-DO", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, action: "messages", message_uuid: "abc" }),
          { status: 200 },
        ),
      );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ kind: "text", text: "hi" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: makeUserDoMock(stubFetch),
      } as any,
    );
    expect(response.status).toBe(200);
    const forwarded = stubFetch.mock.calls[0]![0]!;
    expect(new URL(forwarded.url).pathname).toBe(
      `/sessions/${SESSION_UUID}/messages`,
    );
  });

  it("401 missing JWT — returns invalid-auth without touching User-DO", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "text", text: "hi" }),
      }),
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

  it("403 missing team claim — JWT without team_uuid is rejected", async () => {
    const token = await signTestJwt({ sub: USER_UUID }, JWT_SECRET);
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ kind: "text", text: "hi" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("missing-team-claim");
  });

  it("400 invalid body — empty body on needsBody route", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi.fn();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: "",
      }),
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

  it("404 unknown 4-segment route under /sessions returns not-found", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/messages/unknown-sub`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "x-trace-uuid": TRACE_UUID,
          },
          body: JSON.stringify({ kind: "text", text: "hi" }),
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
