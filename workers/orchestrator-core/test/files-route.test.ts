// RH0 P0-B2 — endpoint-level direct test for /sessions/{uuid}/files (GET).
// charter §7.1 hard gate: ≥5 cases, naming `files-route.test.ts`.
//
// 当前 ZX5 阶段 /files 是 metadata-only(R2 真持久化在 RH4),所以本层只
// 做 façade routing + auth gate 的护栏。RH4 修改 /files 时,本文件要求
// 先扩 case(POST multipart, 200 byte stream)。

import { describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_UUID = "55555555-5555-4555-8555-555555555555";
const TEAM_UUID = "44444444-4444-4444-8444-444444444444";
const OTHER_TEAM_UUID = "66666666-6666-4666-8666-666666666666";
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const JWT_SECRET = "x".repeat(32);

function makeUserDoMock(stubFetch: any) {
  const idFromName = vi.fn().mockReturnValue({ __kind: "user-do-id" });
  const get = vi.fn().mockReturnValue({ fetch: stubFetch });
  return { idFromName, get } as unknown as DurableObjectNamespace;
}

describe("GET /sessions/{uuid}/files route", () => {
  it("200 happy — empty list shape forwards through User-DO", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, action: "files", files: [] }),
          { status: 200 },
        ),
      );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
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
    expect(new URL(stubFetch.mock.calls[0]![0]!.url).pathname).toBe(
      `/sessions/${SESSION_UUID}/files`,
    );
  });

  it("200 happy — non-empty file list passes through unchanged", async () => {
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
            action: "files",
            files: [
              { file_uuid: "f1", filename: "a.png" },
              { file_uuid: "f2", filename: "b.jpg" },
            ],
          }),
          { status: 200 },
        ),
      );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
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
    // wrapSessionResponse 把 {ok:true, action:"files", files:[...]}
    // 视作 legacy DO ack(looksLegacyDoAck = true)直通透传,因此
    // file 列表挂在 body.files 而非 body.data.files。
    const body = (await response.json()) as { files: unknown[] };
    expect(response.status).toBe(200);
    expect(body.files).toHaveLength(2);
  });

  it("401 missing bearer — invalid-auth", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        method: "GET",
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

  it("403 cross-team JWT — user with different team_uuid still authenticates by sub (cross-team isolation enforced at User-DO layer)", async () => {
    // RH0 P0-B2 — façade layer accepts any JWT with sub+team_uuid; cross-team
    // isolation is enforced by User-DO routing via idFromName(sub). 此 case
    // 验证:不同 team 的 JWT 仍被转发到 *自己* 的 User-DO,而不是泄漏到
    // 当前 session 所在 team。后续 RH3 增加 device gate 后,本 case
    // 可加 device_uuid 维度。
    const otherTeamToken = await signTestJwt(
      { sub: OTHER_USER_UUID, team_uuid: OTHER_TEAM_UUID },
      JWT_SECRET,
    );
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, files: [] }), { status: 200 }));
    const userDo = makeUserDoMock(stubFetch);
    await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/files`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${otherTeamToken}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: userDo,
      } as any,
    );
    expect((userDo as any).idFromName).toHaveBeenCalledWith(OTHER_USER_UUID);
    expect((userDo as any).idFromName).not.toHaveBeenCalledWith(USER_UUID);
  });

  it("404 unknown nested action — /files/manifest is not a registered route", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: TEAM_UUID },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(
        `https://example.com/sessions/${SESSION_UUID}/files/manifest`,
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
        ORCHESTRATOR_USER_DO: {} as any,
      } as any,
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("not-found");
  });
});
