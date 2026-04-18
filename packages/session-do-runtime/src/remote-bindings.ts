/**
 * Remote-binding composition adapters (A5 Phase 2 / Phase 3).
 *
 * This module provides the small glue code that turns a v1 env binding
 * (`HOOK_WORKER` / `CAPABILITY_WORKER` / `FAKE_PROVIDER_WORKER`) into
 * the transport shape each subsystem expects. It stays OUT of
 * `composition.ts` so the default factory stays zero-dep; deployed
 * builds opt in to this wiring via `makeRemoteBindingsFactory()`.
 *
 * Wiring pattern (shared by all three seams):
 *   - Send a JSON-encoded envelope ({ kind, body, trace, ... }) via
 *     `binding.fetch(new Request(…))` — a Cloudflare-style
 *     service-binding `fetch()` is the lowest-common-denominator
 *     transport.
 *   - Parse the JSON response body and hand the subsystem-shaped body
 *     back to the caller.
 *   - Honour `AbortSignal` by forwarding it into the outbound request.
 *   - Translate transport errors into the subsystem-specific failure
 *     taxonomy (`HookRuntimeError`, capability `not-connected`, etc.).
 */

import type {
  CompositionFactory,
  SubsystemHandles,
} from "./composition.js";
import {
  resolveCompositionProfile,
} from "./composition.js";
import type {
  CompositionProfile,
  RuntimeConfig,
  ServiceBindingLike,
  SessionRuntimeEnv,
} from "./env.js";

// ─────────────────────────────────────────────────────────────────────
// Shared fetch wrapper
// ─────────────────────────────────────────────────────────────────────

/**
 * Call a service-binding `fetch()` with a JSON body and parse the
 * response as JSON. Throws on non-2xx so callers can map to their
 * taxonomy.
 */
export async function callBindingJson(
  binding: ServiceBindingLike,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!binding.fetch) {
    throw new Error(
      "service-binding has no fetch() surface — wire a fetch-capable worker",
    );
  }
  const req = new Request(`https://binding.local${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const res = await binding.fetch(req);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `service-binding ${path} returned ${res.status}: ${await safeText(res)}`,
    );
  }
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(
      `service-binding ${path} returned invalid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}

// ─────────────────────────────────────────────────────────────────────
// Hook transport adapter
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a HookTransport-shaped object for a hook `ServiceBindingLike`.
 * Returns `undefined` when the binding is missing so the factory can
 * keep the seam as `local`.
 */
export function makeHookTransport(
  binding: ServiceBindingLike | undefined,
): { call: (input: unknown) => Promise<unknown> } | undefined {
  if (!binding) return undefined;
  return {
    async call(input: unknown): Promise<unknown> {
      const payload = input as {
        handler: { id: string; event: string };
        emitBody: unknown;
        context: unknown;
        signal?: AbortSignal;
      };
      const body = await callBindingJson(
        binding,
        "/hooks/emit",
        {
          handlerId: payload.handler.id,
          event: payload.handler.event,
          emitBody: payload.emitBody,
          context: payload.context,
        },
        payload.signal,
      );
      return { body };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Capability transport adapter
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a minimal ServiceBindingTransport-like object for the
 * capability seam. The capability runtime expects `call()` to return
 * the `tool.call.response` body directly.
 */
export function makeCapabilityTransport(
  binding: ServiceBindingLike | undefined,
): {
  call: (input: unknown) => Promise<unknown>;
  cancel?: (input: unknown) => Promise<void>;
} | undefined {
  if (!binding) return undefined;
  return {
    async call(input: unknown): Promise<unknown> {
      const payload = input as {
        requestId: string;
        capabilityName: string;
        body: unknown;
        signal?: AbortSignal;
        onProgress?: (frame: unknown) => void;
      };
      return callBindingJson(
        binding,
        "/capability/call",
        {
          requestId: payload.requestId,
          capabilityName: payload.capabilityName,
          body: payload.body,
        },
        payload.signal,
      );
    },
    async cancel(input: unknown): Promise<void> {
      const payload = input as { requestId: string; body: unknown };
      await callBindingJson(binding, "/capability/cancel", payload);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Fake provider fetcher adapter
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a `fetch`-compatible function that LLMExecutor can consume.
 * When wired against a `FAKE_PROVIDER_WORKER` binding, the normal
 * `POST /chat/completions` path is routed to the bound worker's
 * `fetch()` without the executor knowing it is running against a
 * fake. The binding is expected to mirror OpenAI-compatible Chat
 * Completions output.
 */
export function makeProviderFetcher(
  binding: ServiceBindingLike | undefined,
): typeof fetch | undefined {
  if (!binding?.fetch) return undefined;
  return (async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const path = extractPath(url) ?? "/chat/completions";
    const request = new Request(`https://fake-provider.local${path}`, init);
    return binding.fetch!(request);
  }) as typeof fetch;
}

function extractPath(urlLike: string): string | undefined {
  try {
    return new URL(urlLike).pathname;
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Opinionated factory
// ─────────────────────────────────────────────────────────────────────

/**
 * A CompositionFactory that reads the A5 Phase 4 binding catalog and
 * produces `SubsystemHandles` carrying:
 *   - a `hooks` handle shaped `{ serviceBindingTransport }` that the
 *     session runtime can feed into `ServiceBindingRuntime`,
 *   - a `capability` handle shaped `{ serviceBindingTransport }` ready
 *     for `ServiceBindingTarget`,
 *   - a `llm` handle shaped `{ fetcher }` ready for `LLMExecutor`.
 *
 * Seams with no binding or local profile return `undefined` in the
 * corresponding slot so downstream wiring keeps using the local
 * reference path. Consumers must NOT infer the profile from handle
 * presence — they should always read `handles.profile` instead.
 */
export function makeRemoteBindingsFactory(): CompositionFactory {
  return {
    create(env: SessionRuntimeEnv, config: RuntimeConfig): SubsystemHandles {
      const profile = resolveCompositionProfile(env, config);
      const hookTransport =
        profile.hooks === "remote"
          ? makeHookTransport(env.HOOK_WORKER)
          : undefined;
      const capabilityTransport =
        profile.capability === "remote"
          ? makeCapabilityTransport(env.CAPABILITY_WORKER)
          : undefined;
      const providerFetcher =
        profile.provider === "remote"
          ? makeProviderFetcher(env.FAKE_PROVIDER_WORKER)
          : undefined;

      return {
        kernel: undefined,
        llm: providerFetcher ? { fetcher: providerFetcher } : undefined,
        capability: capabilityTransport
          ? { serviceBindingTransport: capabilityTransport }
          : undefined,
        workspace: undefined,
        hooks: hookTransport
          ? { serviceBindingTransport: hookTransport }
          : undefined,
        eval: undefined,
        storage: undefined,
        profile,
      };
    },
  };
}

/** Re-export the resolved profile helper for tests. */
export type { CompositionProfile } from "./env.js";
