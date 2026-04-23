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
});
