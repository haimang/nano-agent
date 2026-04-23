/**
 * A5 Phase 2-3 — remote-bindings composition adapter tests.
 *
 * Exercises the three v1 seam adapters against recording fake bindings
 * so session-do-runtime can pick up deploy-shaped bindings without
 * hand-writing transport plumbing at every site.
 */

import { describe, it, expect, vi } from "vitest";
import {
  callBindingJson,
  makeCapabilityTransport,
  makeHookTransport,
  makeProviderFetcher,
  makeRemoteBindingsFactory,
} from "../../src/host/remote-bindings.js";
import { DEFAULT_RUNTIME_CONFIG, type SessionRuntimeEnv } from "../../src/host/env.js";

function makeFakeBinding(
  impl: (request: Request) => Promise<Response>,
): { fetch: (r: Request) => Promise<Response>; log: Request[] } {
  const log: Request[] = [];
  return {
    async fetch(request: Request): Promise<Response> {
      log.push(request);
      return impl(request);
    },
    log,
  };
}

describe("callBindingJson", () => {
  it("POSTs JSON to a binding and parses the JSON response", async () => {
    const binding = makeFakeBinding(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const result = await callBindingJson(binding, "/echo", { hello: "world" });
    expect(result).toEqual({ ok: true });
    expect(binding.log).toHaveLength(1);
    expect(binding.log[0].method).toBe("POST");
  });

  it("throws on non-2xx status", async () => {
    const binding = makeFakeBinding(async () =>
      new Response("oops", { status: 500 }),
    );
    await expect(callBindingJson(binding, "/bad", {})).rejects.toThrow(/500/);
  });

  it("throws on invalid JSON response", async () => {
    const binding = makeFakeBinding(async () =>
      new Response("not-json{{{", { status: 200 }),
    );
    await expect(
      callBindingJson(binding, "/badjson", {}),
    ).rejects.toThrow(/invalid JSON/);
  });
});

describe("makeHookTransport", () => {
  it("returns undefined when no binding is provided", () => {
    expect(makeHookTransport(undefined)).toBeUndefined();
  });

  it("POSTs a hook.emit envelope and wraps the response as { body }", async () => {
    const binding = makeFakeBinding(async (req) => {
      const text = await req.text();
      expect(text).toContain("hook.emit-handler-id");
      return new Response(
        JSON.stringify({ ok: true, additional_context: "allowed" }),
        { status: 200 },
      );
    });
    const transport = makeHookTransport(binding)!;
    const result = (await transport.call({
      handler: { id: "hook.emit-handler-id", event: "PreToolUse" },
      emitBody: { event_name: "PreToolUse", event_payload: {} },
      context: {},
    })) as { body: { ok: boolean } };
    expect(result.body.ok).toBe(true);
  });
});

describe("makeCapabilityTransport", () => {
  it("routes call+cancel paths to the binding", async () => {
    const binding = makeFakeBinding(async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/capability/call") {
        return new Response(
          JSON.stringify({ status: "ok", output: "hello" }),
          { status: 200 },
        );
      }
      if (url.pathname === "/capability/cancel") {
        return new Response("", { status: 200 });
      }
      return new Response("", { status: 404 });
    });
    const transport = makeCapabilityTransport(binding)!;
    const response = (await transport.call({
      requestId: "req-1",
      capabilityName: "grep",
      body: { tool_name: "grep", tool_input: {} },
    })) as { status: string; output: string };
    expect(response.status).toBe("ok");
    await transport.cancel!({ requestId: "req-1", body: { reason: "user" } });
    expect(binding.log.map((r) => new URL(r.url).pathname)).toEqual([
      "/capability/call",
      "/capability/cancel",
    ]);
  });
});

describe("makeProviderFetcher", () => {
  it("forwards calls to the binding's fetch", async () => {
    const binding = makeFakeBinding(async (req) => {
      expect(new URL(req.url).pathname).toBe("/chat/completions");
      return new Response(JSON.stringify({ id: "fake" }), { status: 200 });
    });
    const fetcher = makeProviderFetcher(binding)!;
    const res = await fetcher("https://any-base.internal/chat/completions", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });

  it("returns undefined when the binding has no fetch", () => {
    expect(makeProviderFetcher({} as never)).toBeUndefined();
  });
});

describe("makeRemoteBindingsFactory", () => {
  const baseEnv: SessionRuntimeEnv = {
    SESSION_DO: {},
    R2_ARTIFACTS: {},
    KV_CONFIG: {},
  };

  it("returns all-local handles when no bindings are wired", () => {
    const factory = makeRemoteBindingsFactory();
    const handles = factory.create(baseEnv, DEFAULT_RUNTIME_CONFIG);
    expect(handles.profile).toEqual({
      capability: "local",
      hooks: "local",
      provider: "local",
    });
    expect(handles.hooks).toBeUndefined();
    expect(handles.capability).toBeUndefined();
    expect(handles.llm).toBeUndefined();
  });

  it("wires hook + capability transports when those bindings are present", () => {
    const fake = { fetch: vi.fn(async () => new Response("{}")) };
    const factory = makeRemoteBindingsFactory();
    const handles = factory.create(
      { ...baseEnv, HOOK_WORKER: fake, CAPABILITY_WORKER: fake },
      DEFAULT_RUNTIME_CONFIG,
    );
    expect(handles.profile).toEqual({
      capability: "remote",
      hooks: "remote",
      provider: "local",
    });
    expect(handles.hooks).toBeDefined();
    expect(handles.capability).toBeDefined();
    expect(handles.llm).toBeUndefined();
  });

  it("wires a provider fetcher when FAKE_PROVIDER_WORKER is present", () => {
    const fake = { fetch: vi.fn(async () => new Response("{}")) };
    const factory = makeRemoteBindingsFactory();
    const handles = factory.create(
      { ...baseEnv, FAKE_PROVIDER_WORKER: fake },
      DEFAULT_RUNTIME_CONFIG,
    );
    expect(handles.profile.provider).toBe("remote");
    expect(handles.llm).toBeDefined();
  });

  it("respects config.compositionProfile override", () => {
    const fake = { fetch: vi.fn(async () => new Response("{}")) };
    const factory = makeRemoteBindingsFactory();
    const handles = factory.create(
      { ...baseEnv, HOOK_WORKER: fake },
      {
        ...DEFAULT_RUNTIME_CONFIG,
        compositionProfile: {
          capability: "local",
          hooks: "local",
          provider: "local",
        },
      },
    );
    expect(handles.profile.hooks).toBe("local");
    expect(handles.hooks).toBeUndefined();
  });
});

describe("callBindingJson + cross-seam anchor propagation (A4-A5 review R4)", () => {
  const baseEnv: SessionRuntimeEnv = {
    SESSION_DO: {},
    R2_ARTIFACTS: {},
    KV_CONFIG: {},
  };

  it("stamps x-nacp-* headers on every outbound request when anchor is supplied", async () => {
    const captured: Request[] = [];
    const binding = {
      fetch: async (req: Request) => {
        captured.push(req);
        return new Response("{}", { status: 200 });
      },
    };
    await callBindingJson(
      binding,
      "/any",
      { hello: "world" },
      undefined,
      {
        traceUuid: "trace-1",
        sessionUuid: "sess-1",
        teamUuid: "team-1",
        requestUuid: "req-1",
        sourceRole: "session",
        sourceKey: "nano-agent.session.do@v1",
      },
    );
    expect(captured).toHaveLength(1);
    const h = captured[0]!.headers;
    expect(h.get("x-nacp-trace-uuid")).toBe("trace-1");
    expect(h.get("x-nacp-session-uuid")).toBe("sess-1");
    expect(h.get("x-nacp-team-uuid")).toBe("team-1");
    expect(h.get("x-nacp-request-uuid")).toBe("req-1");
    expect(h.get("x-nacp-source-role")).toBe("session");
    expect(h.get("x-nacp-source-key")).toBe("nano-agent.session.do@v1");
  });

  it("omits x-nacp-* headers when no anchor is supplied (backwards-compatible)", async () => {
    const captured: Request[] = [];
    const binding = {
      fetch: async (req: Request) => {
        captured.push(req);
        return new Response("{}", { status: 200 });
      },
    };
    await callBindingJson(binding, "/any", {});
    expect(captured[0]!.headers.get("x-nacp-trace-uuid")).toBeNull();
  });

  it("threads anchor through the hooks handle .emit() wrapper", async () => {
    const captured: Request[] = [];
    const binding = {
      fetch: async (req: Request) => {
        captured.push(req);
        return new Response(
          JSON.stringify({ kind: "continue", reason: "ok" }),
          { status: 200 },
        );
      },
    };
    const factory = makeRemoteBindingsFactory();
    const handles = factory.create(
      { ...baseEnv, HOOK_WORKER: binding },
      DEFAULT_RUNTIME_CONFIG,
    );
    const hooks = handles.hooks as {
      emit: (e: string, p: unknown, c: unknown) => Promise<unknown>;
    };
    await hooks.emit(
      "UserPromptSubmit",
      { text: "hi" },
      {
        traceUuid: "trace-2",
        sessionUuid: "sess-2",
        teamUuid: "team-2",
        requestUuid: "req-2",
      },
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]!.headers.get("x-nacp-trace-uuid")).toBe("trace-2");
  });

  it("provider fetcher stamps anchor from the provider-supplied getter", async () => {
    const captured: Request[] = [];
    const binding = {
      fetch: async (req: Request) => {
        captured.push(req);
        return new Response("{}", { status: 200 });
      },
    };
    const fetcher = makeProviderFetcher(binding, () => ({
      traceUuid: "trace-3",
      sessionUuid: "sess-3",
      teamUuid: "team-3",
      requestUuid: "req-3",
    }));
    expect(fetcher).toBeDefined();
    await fetcher!(new Request("https://api.example.com/chat/completions"));
    expect(captured[0]!.headers.get("x-nacp-trace-uuid")).toBe("trace-3");
  });
});
