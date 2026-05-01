import { describe, expect, it, vi } from "vitest";
import worker, { NanoOrchestratorUserDO } from "../src/index.js";
import { NANO_PACKAGE_MANIFEST } from "../src/generated/package-manifest.js";
import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { signTestJwt } from "./jwt-helper.js";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "22222222-2222-4222-8222-222222222222";
const JWT_SECRET = "x".repeat(32);
const TRACE_UUID = "33333333-3333-4333-8333-333333333333";

function createProbeFetcher(workerName: string, workerVersion: string) {
  return {
    fetch: vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          worker: workerName,
          status: "ok",
          worker_version: workerVersion,
        }),
        { status: 200 },
      ),
    ),
  };
}

describe("orchestrator-core shell smoke", () => {
  it("exports a fetch handler and DO class", () => {
    expect(typeof worker.fetch).toBe("function");
    expect(typeof NanoOrchestratorUserDO).toBe("function");
  });

  it("returns the F3 probe shape", async () => {
    const response = await worker.fetch(new Request("https://example.com"), {
      ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
      TEAM_UUID: "nano-agent",
      WORKER_VERSION: "orchestrator-core@test",
    } as any);
    const body = await response.json();

    expect(body.worker).toBe("orchestrator-core");
    expect(body.nacp_core_version).toBe(NACP_VERSION);
    expect(body.nacp_session_version).toBe(NACP_SESSION_VERSION);
    expect(body.status).toBe("ok");
    expect(body.worker_version).toBe("orchestrator-core@test");
    expect(body.phase).toBe("orchestration-facade-closed");
    expect(body.public_facade).toBe(true);
    expect(body.agent_binding).toBe(false);
    expect(response.headers.get("server-timing")).toContain("total;dur=");
  });

  it("embeds the built package manifest for orchestrator-core", () => {
    expect(NANO_PACKAGE_MANIFEST.worker).toBe("orchestrator-core");
    expect(NANO_PACKAGE_MANIFEST.packages).toHaveLength(3);
  });

  it("aggregates worker health for all bound workers", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/debug/workers/health"),
      {
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
        ENVIRONMENT: "test",
        WORKER_VERSION: "orchestrator-core@test",
        ORCHESTRATOR_AUTH: createProbeFetcher("orchestrator-auth", "orchestrator-auth@test"),
        AGENT_CORE: createProbeFetcher("agent-core", "agent-core@test"),
        BASH_CORE: createProbeFetcher("bash-core", "bash-core@test"),
        CONTEXT_CORE: createProbeFetcher("context-core", "context-core@test"),
        FILESYSTEM_CORE: createProbeFetcher("filesystem-core", "filesystem-core@test"),
      } as any,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary).toEqual({ live: 6, total: 6 });
    expect(body.workers.map((entry: { worker: string }) => entry.worker)).toEqual([
      "orchestrator-core",
      "orchestrator-auth",
      "agent-core",
      "bash-core",
      "context-core",
      "filesystem-core",
    ]);
    expect(body.workers[1].worker_version).toBe("orchestrator-auth@test");
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
    expect(response.headers.get("server-timing")).toContain("total;dur=");
    expect(idFromName).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects authenticated start without trace uuid", async () => {
    const token = await signTestJwt({ sub: USER_UUID, realm: "default", team_uuid: "44444444-4444-4444-8444-444444444444" }, JWT_SECRET);
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
    expect((await response.json()).error.code).toBe("invalid-trace");
  });

  it("rejects authenticated session routes when JWT omits tenant claims", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, realm: "default" },
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
    expect((await response.json()).error.code).toBe("missing-team-claim");
  });

  it("rejects non-probe routes when TEAM_UUID is missing outside test env", async () => {
    const token = await signTestJwt({ sub: USER_UUID, realm: "default", team_uuid: "44444444-4444-4444-8444-444444444444" }, JWT_SECRET);
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
    expect((await response.json()).error.code).toBe("worker-misconfigured");
  });

  it("routes authenticated start requests to the user DO keyed by JWT sub", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, realm: "default", team_uuid: "44444444-4444-4444-8444-444444444444" },
      JWT_SECRET,
    );
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
    const token = await signTestJwt({ sub: USER_UUID, team_uuid: "44444444-4444-4444-8444-444444444444" }, JWT_SECRET);
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 200 }));
    const idFromName = vi.fn().mockReturnValue({ __kind: "user-do-id" });
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });

    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/ws?access_token=${token}&trace_uuid=${TRACE_UUID}`, {
        method: "GET",
        headers: {
          upgrade: "websocket",
          "sec-websocket-key": "key",
        },
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
    expect(new URL(forwarded.url).pathname).toBe(`/sessions/${SESSION_UUID}/ws`);
    expect(new URL(forwarded.url).searchParams.get("access_token")).toBe(token);
    expect(new URL(forwarded.url).searchParams.get("trace_uuid")).toBe(TRACE_UUID);
    expect(forwarded.headers.get("upgrade")).toBe("websocket");
    expect(forwarded.headers.get("sec-websocket-key")).toBe("key");
  });

  it("routes authenticated history reads to the user DO", async () => {
    const token = await signTestJwt({ sub: USER_UUID, user_uuid: USER_UUID, team_uuid: "44444444-4444-4444-8444-444444444444" }, JWT_SECRET);
    const stubFetch = vi.fn<(req: Request) => Promise<Response>>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, action: "history", messages: [] }), { status: 200 }),
    );
    const idFromName = vi.fn().mockReturnValue({ __kind: "user-do-id" });
    const get = vi.fn().mockReturnValue({ fetch: stubFetch });

    const response = await worker.fetch(
      new Request(`https://example.com/sessions/${SESSION_UUID}/history`, {
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
        },
      }),
      {
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
        ORCHESTRATOR_USER_DO: { idFromName, get } as unknown as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(200);
    expect(new URL(stubFetch.mock.calls[0]![0]!.url).pathname).toBe(`/sessions/${SESSION_UUID}/history`);
  });

  it("proxies auth register requests to orchestrator-auth rpc", async () => {
    const register = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        tokens: {
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
          refresh_expires_in: 2_592_000,
          kid: "v1",
        },
        user: {
          user_uuid: USER_UUID,
          display_name: "User",
          identity_provider: "email_password",
          login_identifier: "user@example.com",
        },
        team: {
          team_uuid: "44444444-4444-4444-8444-444444444444",
          membership_level: 100,
          plan_level: 0,
        },
        snapshot: {
          sub: USER_UUID,
          user_uuid: USER_UUID,
          team_uuid: "44444444-4444-4444-8444-444444444444",
          tenant_uuid: "44444444-4444-4444-8444-444444444444",
          tenant_source: "claim",
          membership_level: 100,
        },
      },
    });
    const response = await worker.fetch(
      new Request("https://example.com/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "password-123",
        }),
      }),
      {
        ORCHESTRATOR_AUTH: {
          register,
        } as any,
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(200);
    expect(register).toHaveBeenCalledWith(
      {
        email: "user@example.com",
        password: "password-123",
      },
      expect.objectContaining({
        caller: "orchestrator-core",
      }),
    );
  });

  // ZX2 Phase 5 P5-01 → ZX5 Lane D D2 — catalog content registry filled
  // (per ZX5 Q5 owner direction). 每个 entry 含 name/description/version/status。
  it("GET /catalog/skills returns facade-http-v1 envelope with non-empty registry", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/catalog/skills", {
        headers: { "x-trace-uuid": TRACE_UUID },
      }),
      {
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
        TEAM_UUID: "nano-agent",
      } as any,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.trace_uuid).toBe(TRACE_UUID);
    expect(Array.isArray(body.data.skills)).toBe(true);
    expect(body.data.skills.length).toBeGreaterThan(0);
    expect(body.data.skills[0]).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
      version: expect.any(String),
      status: expect.stringMatching(/^(stable|preview|experimental)$/),
    });
  });

  it("GET /catalog/commands returns commands registry", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/catalog/commands", {
        headers: { "x-trace-uuid": TRACE_UUID },
      }),
      {
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
        TEAM_UUID: "nano-agent",
      } as any,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.commands)).toBe(true);
    expect(body.data.commands.length).toBeGreaterThan(0);
    expect(body.data.commands.map((c: { name: string }) => c.name)).toContain("/start");
  });

  it("GET /catalog/agents returns agents registry", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/catalog/agents", {
        headers: { "x-trace-uuid": TRACE_UUID },
      }),
      {
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
        TEAM_UUID: "nano-agent",
      } as any,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.agents)).toBe(true);
    expect(body.data.agents.length).toBeGreaterThan(0);
    expect(body.data.agents.map((a: { name: string }) => a.name)).toContain("nano-default");
  });

  // ZX2 Phase 5 P5-02 — POST /me/sessions mints UUID
  it("POST /me/sessions mints a server-side UUID", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: USER_UUID, exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/me/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      {
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
      } as any,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.trace_uuid).toBe(TRACE_UUID);
    expect(typeof body.data.session_uuid).toBe("string");
    expect(body.data.status).toBe("pending");
    expect(body.data.start_url).toBe(`/sessions/${body.data.session_uuid}/start`);
  });

  it("POST /me/sessions rejects client-supplied session_uuid", async () => {
    const token = await signTestJwt(
      { sub: USER_UUID, team_uuid: USER_UUID, exp: Math.floor(Date.now() / 1000) + 3600 },
      JWT_SECRET,
    );
    const response = await worker.fetch(
      new Request("https://example.com/me/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-trace-uuid": TRACE_UUID,
          "content-type": "application/json",
        },
        body: JSON.stringify({ session_uuid: SESSION_UUID }),
      }),
      {
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
        JWT_SECRET,
        TEAM_UUID: "nano-agent",
      } as any,
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("invalid-input");
  });

  it("returns 503 when auth proxy binding is missing", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "password-123",
        }),
      }),
      {
        ORCHESTRATOR_USER_DO: {} as DurableObjectNamespace,
      } as any,
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("worker-misconfigured");
  });
});
