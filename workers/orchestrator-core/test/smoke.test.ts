import { describe, expect, it, vi } from "vitest";
import worker, { NanoOrchestratorUserDO } from "../src/index.js";
import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const JWT_SECRET = "x".repeat(32);
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";

describe("orchestrator-core shell smoke", () => {
  it("exports a fetch handler and DO class", () => {
    expect(typeof worker.fetch).toBe("function");
    expect(typeof NanoOrchestratorUserDO).toBe("function");
  });

  it("returns the F3 probe shape", async () => {
    const response = await worker.fetch(new Request("https://example.com"), {
      ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
      TEAM_UUID: "nano-agent",
    } as any);
    const body = await response.json();

    expect(body.worker).toBe("orchestrator-core");
    expect(body.nacp_core_version).toBe(NACP_VERSION);
    expect(body.nacp_session_version).toBe(NACP_SESSION_VERSION);
    expect(body.status).toBe("ok");
    expect(body.phase).toBe("orchestration-facade-closed");
    expect(body.public_facade).toBe(true);
    expect(body.agent_binding).toBe(false);
  });

  it("rejects start without bearer token", async () => {
    const idFromName = vi.fn();
    const get = vi.fn();
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ initial_input: "hello" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: { idFromName, get } as unknown as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(401);
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects authenticated start without trace uuid", async () => {
    const token = await signTestJwt({ sub: USER_UUID, realm: "default" }, JWT_SECRET);
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/start`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ initial_input: "hello" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("invalid-trace");
  });

  it("rejects tenant mismatch claim", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, realm: "default", tenant_uuid: "foreign-tenant" },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/start`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ initial_input: "hello" }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("tenant-mismatch");
  });

  it("rejects non-probe routes when TEAM_UUID is missing outside test env", async () => {
    const token = await signTestJwt({ sub: USER_UUID, realm: "default" }, JWT_SECRET);
    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/status`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("worker-misconfigured");
  });

  it("routes authenticated start requests to the user DO keyed by JWT sub", async () => {
    const token = await signTestJwt({ sub: USER_UUID, realm: "default" }, JWT_SECRET);
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(new Response(JSON.stringify({ ok: true, action: "start" }), { status: 200 }));
    const idFromName = vi.fn().mockReturnValue({ __kind: "user-do-id" });
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });

    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/start`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-trace-uuid": TRACE_UUID,
        },
        body: JSON.stringify({ initial_input: "hello", initial_context: { source: "test" } }),
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: { idFromName, get } as unknown as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith(USER_UUID);
    const forwarded = stubFetch.mock.calls[0]![0]!;
    const forwardedBody = await forwarded.json() as Record<string, unknown>;
    expect(new URL(forwarded.url).pathname).toBe(`/sessions/${SESSION_UUID}/start`);
    expect((forwardedBody.auth_snapshot as Record<string, unknown>).sub).toBe(USER_UUID);
    expect((forwardedBody.initial_context_seed as Record<string, unknown>).realm_hints).toEqual(["default"]);
    expect((forwardedBody.initial_context_seed as Record<string, unknown>).default_layers).toEqual([]);
  });

  it("routes authenticated ws upgrades to the user DO", async () => {
    const token = await signTestJwt({ sub: USER_UUID }, JWT_SECRET);
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 200 }));
    const idFromName = vi.fn().mockReturnValue({ __kind: "user-do-id" });
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });

    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/ws?access_token=${token}&trace_uuid=${TRACE_UUID}`, { method: "GET", headers: { upgrade: "websocket" } }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: { idFromName, get } as unknown as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(200);
    expect(idFromName).toHaveBeenCalledWith(USER_UUID);
    expect(new URL(stubFetch.mock.calls[0]![0]!.url).pathname).toBe(`/sessions/${SESSION_UUID}/ws`);
  });
});
