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
import { buildCrossSeamHeaders, type CrossSeamAnchor } from "./cross-seam.js";

// ─────────────────────────────────────────────────────────────────────
// Shared fetch wrapper
// ─────────────────────────────────────────────────────────────────────

/**
 * Call a service-binding `fetch()` with a JSON body and parse the
 * response as JSON. Throws on non-2xx so callers can map to their
 * taxonomy.
 *
 * A4-A5 review R2 (Kimi): the Request URL uses a synthetic
 * `https://binding.local` host as a placeholder. Cloudflare Workers'
 * service-binding `fetch()` routes on the Worker's binding table, not
 * DNS — the host portion is ignored by the platform. We keep a stable
 * host string so request logging / debugging has a predictable origin.
 *
 * A4-A5 review R4 (GPT): when a `CrossSeamAnchor` is supplied,
 * `buildCrossSeamHeaders()` stamps the trace / session / team /
 * request identity on every outbound request, keeping
 * trace-first observability continuous across the boundary.
 */
export async function callBindingJson(
  binding: ServiceBindingLike,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  anchor?: CrossSeamAnchor,
): Promise<unknown> {
  if (!binding.fetch) {
    throw new Error(
      "service-binding has no fetch() surface — wire a fetch-capable worker",
    );
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (anchor) Object.assign(headers, buildCrossSeamHeaders(anchor));
  const req = new Request(`https://binding.local${path}`, {
    method: "POST",
    headers,
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

/**
 * Best-effort structural narrow: pull a `CrossSeamAnchor` out of an
 * `unknown` context if every required field is a string. Returns
 * `undefined` when any required field is missing so the caller falls
 * back to a header-less request (which still succeeds, but will fail
 * the server-side `validateCrossSeamAnchor` check). This lets callers
 * pass the DO's trace context through `emit(event, payload, context)`
 * without us adding a typed argument.
 */
function pickAnchor(context: unknown): CrossSeamAnchor | undefined {
  if (!context || typeof context !== "object") return undefined;
  const c = context as Record<string, unknown>;
  const trace = c.traceUuid;
  const session = c.sessionUuid;
  const team = c.teamUuid;
  const request = c.requestUuid;
  if (
    typeof trace !== "string" ||
    typeof session !== "string" ||
    typeof team !== "string" ||
    typeof request !== "string"
  ) {
    return undefined;
  }
  const anchor: CrossSeamAnchor = {
    traceUuid: trace,
    sessionUuid: session,
    teamUuid: team,
    requestUuid: request,
    ...(typeof c.sourceRole === "string" ? { sourceRole: c.sourceRole } : {}),
    ...(typeof c.sourceKey === "string" ? { sourceKey: c.sourceKey } : {}),
    ...(typeof c.deadlineMs === "number" ? { deadlineMs: c.deadlineMs } : {}),
  };
  return anchor;
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
        anchor?: CrossSeamAnchor;
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
        payload.anchor,
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
        anchor?: CrossSeamAnchor;
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
        payload.anchor,
      );
    },
    async cancel(input: unknown): Promise<void> {
      const payload = input as {
        requestId: string;
        body: unknown;
        anchor?: CrossSeamAnchor;
      };
      await callBindingJson(
        binding,
        "/capability/cancel",
        { requestId: payload.requestId, body: payload.body },
        undefined,
        payload.anchor,
      );
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
/**
 * A4-A5 review R2 (Kimi): the Request URL uses a synthetic
 * `https://fake-provider.local` host. Cloudflare service-binding
 * `fetch()` routes by binding table (not DNS); the host is a
 * placeholder for request logging.
 *
 * A4-A5 review R4 (GPT): when `anchorProvider` is supplied, every
 * outbound request is stamped with the current `CrossSeamAnchor` via
 * `buildCrossSeamHeaders()`. Deployed builds wire this to a
 * per-request anchor derived from the DO state so trace / session /
 * team / request identity stay continuous across the provider edge.
 */
export function makeProviderFetcher(
  binding: ServiceBindingLike | undefined,
  anchorProvider?: () => CrossSeamAnchor | undefined,
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
    const headers = new Headers(init?.headers);
    const anchor = anchorProvider?.();
    if (anchor) {
      for (const [k, v] of Object.entries(buildCrossSeamHeaders(anchor))) {
        headers.set(k, v);
      }
    }
    const request = new Request(`https://fake-provider.local${path}`, {
      ...init,
      headers,
    });
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

      // A4-A5 review R3: bridge `HookTransport` into a minimal
      // `.emit(event, payload, context)` surface so the DO's
      // `emitHook` wrapper actually uses the remote transport
      // instead of dropping the event. We keep the raw
      // `serviceBindingTransport` alongside so a future full
      // dispatcher (driven by handler registry) can still pick the
      // underlying transport.
      const hooksHandle = hookTransport
        ? {
            serviceBindingTransport: hookTransport,
            emit: async (event: string, payload: unknown, context: unknown) => {
              try {
                // A4-A5 review R4: if the caller's `context` carries a
                // CrossSeamAnchor (shape-matched on the required
                // fields) thread it into the transport so the outbound
                // request is stamped. Context is `unknown` at this
                // boundary, so we narrow by structural check rather
                // than importing a type.
                const anchor = pickAnchor(context);
                const result = await hookTransport.call({
                  handler: { id: `session.${event}`, event },
                  emitBody: payload,
                  context,
                  anchor,
                });
                return (result as { body?: unknown }).body;
              } catch {
                // Remote hook failure must not kill a session turn; the
                // session layer's error path converts to a continue
                // outcome. Swallow here so the orchestrator keeps
                // progressing (A5 §2.2 "local reference path stays
                // authoritative").
                return undefined;
              }
            },
          }
        : undefined;

      return {
        kernel: undefined,
        llm: providerFetcher ? { fetcher: providerFetcher } : undefined,
        capability: capabilityTransport
          ? { serviceBindingTransport: capabilityTransport }
          : undefined,
        workspace: undefined,
        hooks: hooksHandle,
        eval: undefined,
        storage: undefined,
        profile,
      };
    },
  };
}

/** Re-export the resolved profile helper for tests. */
export type { CompositionProfile } from "./env.js";
