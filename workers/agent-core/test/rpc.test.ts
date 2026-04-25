import { describe, expect, it, vi } from "vitest";
import AgentCoreEntrypoint from "../src/index.js";

const TRACE_UUID = "33333333-3333-4333-8333-333333333333";
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const AUTHORITY = {
  sub: "22222222-2222-4222-8222-222222222222",
  tenant_uuid: "44444444-4444-4444-8444-444444444444",
  tenant_source: "claim",
};

describe("agent-core rpc entrypoint", () => {
  it("routes status through the guarded internal surface", async () => {
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, action: "status", phase: "attached" }), { status: 200 }),
    );
    const entrypoint = new AgentCoreEntrypoint({
      NANO_INTERNAL_BINDING_SECRET: "secret",
      SESSION_DO: {
        idFromName: vi.fn().mockReturnValue({ __kind: "mock-id" }),
        get: vi.fn().mockReturnValue({ fetch: stubFetch }),
      } as unknown as DurableObjectNamespace,
    } as any);

    const result = await entrypoint.status(
      { session_uuid: SESSION_UUID },
      { trace_uuid: TRACE_UUID, authority: AUTHORITY },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, action: "status" });
    expect(new URL(stubFetch.mock.calls[0]![0]!.url).pathname).toBe(`/sessions/${SESSION_UUID}/status`);
  });

  it("routes start through the guarded internal surface", async () => {
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, action: "start", phase: "attached" }), { status: 200 }),
    );
    const entrypoint = new AgentCoreEntrypoint({
      NANO_INTERNAL_BINDING_SECRET: "secret",
      SESSION_DO: {
        idFromName: vi.fn().mockReturnValue({ __kind: "mock-id" }),
        get: vi.fn().mockReturnValue({ fetch: stubFetch }),
      } as unknown as DurableObjectNamespace,
    } as any);

    const result = await entrypoint.start(
      { session_uuid: SESSION_UUID, initial_input: "hello" },
      { trace_uuid: TRACE_UUID, authority: AUTHORITY },
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, action: "start" });
    expect(new URL(stubFetch.mock.calls[0]![0]!.url).pathname).toBe(`/sessions/${SESSION_UUID}/start`);
  });
});
