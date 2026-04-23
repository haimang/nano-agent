/**
 * Session DO Runtime — Worker entry.
 *
 * Minimal Worker fetch handler that:
 *   1. Parses the incoming request URL for the session identifier.
 *   2. Constructs a Durable Object stub via the `SESSION_DO` binding.
 *   3. Forwards the request to the DO's `fetch()` method.
 *
 * The DO class (`NanoSessionDO`) is responsible for the full WebSocket
 * upgrade + HTTP fallback + orchestration + checkpoint lifecycle. The
 * Worker entry is intentionally tiny: it is the Wrangler entrypoint
 * referenced by `wrangler.jsonc:main`.
 */

import { routeRequest } from "./routes.js";

export { NanoSessionDO } from "./do/nano-session-do.js";

/**
 * Minimal `DurableObjectNamespace`-like shape used at the Worker layer.
 * Keeping it local lets the package compile without `@cloudflare/workers-types`
 * as a hard dep; production deployments still get the full type from
 * the runtime-provided `Env` at call time.
 */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

/**
 * Minimum env shape — bindings declared in `wrangler.jsonc`.
 *
 * The optional `R2_ARTIFACTS / KV_CONFIG / HOOK_WORKER /
 * CAPABILITY_WORKER / FAKE_PROVIDER_WORKER` slots mirror the v1 binding
 * catalog defined in `env.ts`. Keeping them on the Worker entrypoint
 * means the same TypeScript shape covers both `wrangler dev --remote`
 * and `wrangler deploy --env deploy_smoke` profiles without per-env
 * type drift. They stay `unknown` at this layer because the Worker
 * entry only forwards into `NanoSessionDO.fetch()`.
 */
export interface WorkerEnv {
  readonly SESSION_DO: DurableObjectNamespaceLike;
  readonly R2_ARTIFACTS?: unknown;
  readonly KV_CONFIG?: unknown;
  readonly HOOK_WORKER?: unknown;
  readonly CAPABILITY_WORKER?: unknown;
  readonly FAKE_PROVIDER_WORKER?: unknown;
  readonly LLM_API_KEY?: string;
  readonly OPENAI_API_KEY?: string;
  readonly ENVIRONMENT?: string;
}

const DEFAULT_SESSION_ID = "default";

function extractSessionId(request: Request): string {
  try {
    const pathname = new URL(request.url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    // Expect /sessions/:sessionId/... — fall back to a stable default
    // so the DO namespace can still produce a valid id even when the
    // client hits an off-spec route. `routeRequest` inside the DO will
    // return 404 for the off-spec shape.
    if (segments[0] === "sessions" && segments[1]) {
      return segments[1];
    }
  } catch {
    // Fall through to default below.
  }
  return DEFAULT_SESSION_ID;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    // Quick sanity check: only forward requests that reach a known route
    // shape. Non-matching shapes short-circuit to 404 without burning a
    // DO round-trip.
    const route = routeRequest(request);
    if (route.type === "not-found") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const sessionId = extractSessionId(request);
    const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
    return stub.fetch(request);
  },
};
