/**
 * spike-binding-pair worker-b (callee) — Round 1 skeleton.
 *
 * P1-04 (B1 Phase 1): only /healthz route.
 * Phase 3 will add 5 handlers: echo / slow / header-dump / hook-dispatch / eval-emit.
 *
 * 7 disciplines: see ../../../README.md
 *
 * IMPORTANT (transport scope):
 *   This worker only validates the FETCH-BASED service binding seam.
 *   It does NOT implement nacp-core's `handleNacp` RPC transport — that
 *   is explicitly out of scope per
 *   docs/design/after-foundations/P0-spike-binding-pair-design.md §0.
 */

interface SpikeEnv {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly ROLE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
}

const SPIKE_VERSION = "0.0.0-spike-p1-04";

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return Response.json({
        ok: true,
        spike: env.SPIKE_NAMESPACE,
        role: env.ROLE,
        env: env.ENVIRONMENT,
        version: SPIKE_VERSION,
        expirationDate: env.EXPIRATION_DATE,
        tags: { owner: env.OWNER_TAG, stage: env.STAGE_TAG },
        // P1-04 skeleton: handlers not yet implemented (see Phase 3).
        handlersImplemented: 0,
        handlersPlanned: 5,
      });
    }

    return new Response(
      `spike-binding-pair worker-b skeleton (P1-04). Phase 3 will add 5 handlers (echo/slow/header-dump/hook-dispatch/eval-emit).\nTry GET /healthz.\n`,
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
} satisfies ExportedHandler<SpikeEnv>;
