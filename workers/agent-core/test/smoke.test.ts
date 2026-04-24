import { describe, expect, it, vi } from "vitest";
import worker, { NanoSessionDO } from "../src/index.js";
import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";

describe("agent-core shell smoke", () => {
  it("exports a fetch handler", () => {
    expect(typeof worker.fetch).toBe("function");
  });

  it("exports the NanoSessionDO stub", () => {
    expect(typeof NanoSessionDO).toBe("function");
  });

  it("returns NACP versions + absorbed-runtime flag from the worker shell", async () => {
    const response = await worker.fetch(new Request("https://example.com"), {
      SESSION_DO: {} as DurableObjectNamespace,
    });
    const body = await response.json();

    expect(body.worker).toBe("agent-core");
    expect(body.nacp_core_version).toBe(NACP_VERSION);
    expect(body.nacp_session_version).toBe(NACP_SESSION_VERSION);
    expect(body.status).toBe("ok");
    expect(body.absorbed_runtime).toBe(true);
    expect(body.phase).toBe("worker-matrix-P2-live-loop");
    expect(body.live_loop).toBe(true);
    expect(body.capability_binding).toBe(false); // no BASH_CORE in test env
  });

  it("GET /health returns the same probe shape with live_loop flag", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/health"),
      { SESSION_DO: {} as DurableObjectNamespace },
    );
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.absorbed_runtime).toBe(true);
    expect(body.live_loop).toBe(true);
  });

  it("forwards /sessions/:sessionId/:action to SESSION_DO via idFromName → get → fetch", async () => {
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response(JSON.stringify({ forwarded: true }), { status: 200 }),
      );
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });
    const idFromName = vi.fn().mockReturnValue({ __kind: "mock-id" });
    const env = {
      SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace,
    };

    const request = new Request(
      "https://example.com/sessions/abc/status",
      { method: "GET" },
    );
    const response = await worker.fetch(request, env);

    expect(idFromName).toHaveBeenCalledWith("abc");
    expect(get).toHaveBeenCalledTimes(1);
    expect(stubFetch).toHaveBeenCalledTimes(1);
    const forwarded = stubFetch.mock.calls[0]![0]!;
    expect(new URL(forwarded.url).pathname).toBe("/sessions/abc/status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { forwarded: boolean };
    expect(body.forwarded).toBe(true);
  });

  it("forwards /sessions/:sessionId/ws (websocket intent) to SESSION_DO with the sessionId", async () => {
    const stubFetch = vi
      .fn<(req: Request) => Promise<Response>>()
      .mockResolvedValue(
        new Response("ws-ack", {
          status: 200,
          headers: { "x-upgraded": "websocket" },
        }),
      );
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });
    const idFromName = vi.fn().mockReturnValue({ __kind: "mock-id" });
    const env = {
      SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace,
    };

    const request = new Request("https://example.com/sessions/xyz/ws", {
      headers: { upgrade: "websocket" },
    });
    const response = await worker.fetch(request, env);

    expect(idFromName).toHaveBeenCalledWith("xyz");
    expect(stubFetch).toHaveBeenCalledTimes(1);
    expect(response.headers.get("x-upgraded")).toBe("websocket");
  });

  it("returns 404 JSON for off-spec routes without burning a DO roundtrip", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const env = {
      SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace,
    };

    const response = await worker.fetch(
      new Request("https://example.com/unknown/route"),
      env,
    );

    expect(response.status).toBe(404);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Not found");
  });
  it("forwards authenticated /internal/sessions/:sessionId/start without touching legacy routing", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ forwarded: true }), { status: 200 }),
    );
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });
    const idFromName = vi.fn().mockReturnValue({ __kind: "mock-id" });
    const env = {
      NANO_INTERNAL_BINDING_SECRET: "secret",
      SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace,
    };

    const response = await worker.fetch(
      new Request(`https://example.com/internal/sessions/${sessionId}/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-nano-internal-binding-secret": "secret",
        },
        body: JSON.stringify({ initial_input: "hello" }),
      }),
      env as any,
    );

    expect(response.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith(sessionId);
    const forwarded = stubFetch.mock.calls[0]![0]!;
    expect(new URL(forwarded.url).pathname).toBe(`/sessions/${sessionId}/start`);
  });

  it("rejects /internal/* when the shared secret is missing or invalid", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const response = await worker.fetch(
      new Request("https://example.com/internal/sessions/11111111-1111-4111-8111-111111111111/start", { method: "POST" }),
      {
        NANO_INTERNAL_BINDING_SECRET: "secret",
        SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(401);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });



  it("synthesizes a minimal session.update event when timeline replay is empty", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const stubFetch = vi.fn(async (req: Request) => {
      const pathname = new URL(req.url).pathname;
      if (pathname.endsWith("/timeline")) {
        return new Response(JSON.stringify({ ok: true, action: "timeline", events: [] }), { status: 200 });
      }
      if (pathname.endsWith("/status")) {
        return new Response(JSON.stringify({ ok: true, action: "status", phase: "attached" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });
    const idFromName = vi.fn().mockReturnValue({ __kind: "mock-id" });

    const response = await worker.fetch(
      new Request(`https://example.com/internal/sessions/${sessionId}/stream`, {
        method: "GET",
        headers: { "x-nano-internal-binding-secret": "secret" },
      }),
      {
        NANO_INTERNAL_BINDING_SECRET: "secret",
        SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace,
      } as any,
    );

    const body = await response.text();
    const lines = body.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[1]).toMatchObject({ kind: "event", payload: { kind: "session.update", phase: "attached" } });
    expect(lines[2]).toMatchObject({ kind: "terminal", terminal: "completed" });
  });


  it("forwards /internal/sessions/:sessionId/status and verify through the guarded internal surface", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });
    const idFromName = vi.fn().mockReturnValue({ __kind: "mock-id" });
    const env = { NANO_INTERNAL_BINDING_SECRET: "secret", SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace };

    await worker.fetch(new Request(`https://example.com/internal/sessions/${sessionId}/status`, { headers: { "x-nano-internal-binding-secret": "secret" } }), env as any);
    await worker.fetch(new Request(`https://example.com/internal/sessions/${sessionId}/verify`, { method: "POST", headers: { "x-nano-internal-binding-secret": "secret", "content-type": "application/json" }, body: JSON.stringify({ check: "bogus" }) }), env as any);

    expect(new URL(stubFetch.mock.calls[0]![0]!.url).pathname).toBe(`/sessions/${sessionId}/status`);
    expect(new URL(stubFetch.mock.calls[1]![0]!.url).pathname).toBe(`/sessions/${sessionId}/verify`);
  });

  it("serializes internal stream replay as NDJSON meta/event/terminal frames", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const stubFetch = vi.fn(async (req: Request) => {
      const pathname = new URL(req.url).pathname;
      if (pathname.endsWith("/timeline")) {
        return new Response(JSON.stringify({
          ok: true,
          action: "timeline",
          events: [{ kind: "turn.begin", turn_uuid: sessionId }],
        }), { status: 200 });
      }
      if (pathname.endsWith("/status")) {
        return new Response(JSON.stringify({ ok: true, action: "status", phase: "attached" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });
    const idFromName = vi.fn().mockReturnValue({ __kind: "mock-id" });

    const response = await worker.fetch(
      new Request(`https://example.com/internal/sessions/${sessionId}/stream`, {
        method: "GET",
        headers: { "x-nano-internal-binding-secret": "secret" },
      }),
      {
        NANO_INTERNAL_BINDING_SECRET: "secret",
        SESSION_DO: { idFromName, get } as unknown as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/x-ndjson");
    const body = await response.text();
    const lines = body.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines[0]).toEqual({ kind: "meta", seq: 0, event: "opened", session_uuid: sessionId });
    expect(lines[1]).toMatchObject({ kind: "event", seq: 1, name: "session.stream.event", payload: { kind: "turn.begin" } });
    expect(lines[2]).toMatchObject({ kind: "terminal", seq: 2, terminal: "completed" });
  });


});
