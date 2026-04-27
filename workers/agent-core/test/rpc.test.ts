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
    const forwarded = stubFetch.mock.calls[0]![0]!;
    expect(new URL(forwarded.url).pathname).toBe(`/sessions/${SESSION_UUID}/status`);
    expect(forwarded.headers.get("x-trace-uuid")).toBe(TRACE_UUID);
    expect(forwarded.headers.get("x-nano-internal-binding-secret")).toBe("secret");
    expect(JSON.parse(forwarded.headers.get("x-nano-internal-authority") ?? "{}")).toEqual(AUTHORITY);
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
    const forwarded = stubFetch.mock.calls[0]![0]!;
    expect(new URL(forwarded.url).pathname).toBe(`/sessions/${SESSION_UUID}/start`);
    expect(forwarded.headers.get("x-trace-uuid")).toBe(TRACE_UUID);
    expect(forwarded.headers.get("x-nano-internal-binding-secret")).toBe("secret");
    expect(JSON.parse(forwarded.headers.get("x-nano-internal-authority") ?? "{}")).toEqual(AUTHORITY);
  });

  // ZX2 Phase 3 P3-01 — extended RPC surface
  it.each([
    ["input", "POST"],
    ["cancel", "POST"],
    ["verify", "POST"],
    ["timeline", "GET"],
  ] as const)("routes %s through the guarded internal surface", async (action, method) => {
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, action }), { status: 200 }),
    );
    const entrypoint = new AgentCoreEntrypoint({
      NANO_INTERNAL_BINDING_SECRET: "secret",
      SESSION_DO: {
        idFromName: vi.fn().mockReturnValue({ __kind: "mock-id" }),
        get: vi.fn().mockReturnValue({ fetch: stubFetch }),
      } as unknown as DurableObjectNamespace,
    } as any);

    const fn = (entrypoint as unknown as Record<string, (i: unknown, m: unknown) => Promise<{ status: number; body: unknown }>>)[action];
    const result = await fn.call(
      entrypoint,
      { session_uuid: SESSION_UUID, ...(method === "POST" ? { text: "x" } : {}) },
      { trace_uuid: TRACE_UUID, authority: AUTHORITY },
    );

    expect(result.status).toBe(200);
    const forwarded = stubFetch.mock.calls[0]![0]!;
    expect(forwarded.method).toBe(method);
    expect(new URL(forwarded.url).pathname).toBe(`/sessions/${SESSION_UUID}/${action}`);
    expect(forwarded.headers.get("x-trace-uuid")).toBe(TRACE_UUID);
    expect(forwarded.headers.get("x-nano-internal-authority")).toBeTruthy();
  });

  // ZX2 Phase 3 P3-02 — cursor-paginated stream snapshot
  it("streamSnapshot forwards cursor + limit as querystring", async () => {
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { events: [], next_cursor: null } }), {
        status: 200,
      }),
    );
    const entrypoint = new AgentCoreEntrypoint({
      NANO_INTERNAL_BINDING_SECRET: "secret",
      SESSION_DO: {
        idFromName: vi.fn().mockReturnValue({ __kind: "mock-id" }),
        get: vi.fn().mockReturnValue({ fetch: stubFetch }),
      } as unknown as DurableObjectNamespace,
    } as any);

    const result = await entrypoint.streamSnapshot(
      { session_uuid: SESSION_UUID, cursor: "5", limit: 50 },
      { trace_uuid: TRACE_UUID, authority: AUTHORITY },
    );
    expect(result.status).toBe(200);
    const forwarded = stubFetch.mock.calls[0]![0]!;
    const forwardedUrl = new URL(forwarded.url);
    expect(forwardedUrl.pathname).toBe(`/sessions/${SESSION_UUID}/stream_snapshot`);
    expect(forwardedUrl.searchParams.get("cursor")).toBe("5");
    expect(forwardedUrl.searchParams.get("limit")).toBe("50");
    expect(forwarded.method).toBe("GET");
  });
});
