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
} from "../src/remote-bindings.js";
import { DEFAULT_RUNTIME_CONFIG, type SessionRuntimeEnv } from "../src/env.js";

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
