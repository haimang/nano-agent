/**
 * spike-binding-pair worker-a (caller) — Round 1 skeleton.
 *
 * P1-04 (B1 Phase 1): only /healthz route + a /healthz/binding sanity
 * route that probes the service-binding to worker-b by calling its
 * /healthz. This proves the binding is wired correctly without yet
 * implementing the 4 V3 probes.
 *
 * Phase 3 will add 4 V3 probes:
 *   - V3-binding-latency-cancellation
 *   - V3-binding-cross-seam-anchor
 *   - V3-binding-hooks-callback
 *   - V3-binding-eval-fanin
 *
 * 7 disciplines: see ../../../README.md
 *
 * IMPORTANT (transport scope):
 *   Only validates the fetch-based service binding seam.
 *   Does NOT exercise nacp-core's `handleNacp` RPC transport.
 */

interface SpikeEnv {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly ROLE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
  readonly WORKER_B: Fetcher;
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
        bindings: { WORKER_B: typeof env.WORKER_B },
        // P1-04 skeleton: probe routes not yet implemented (see Phase 3).
        probesImplemented: 0,
        probesPlanned: 4,
      });
    }

    if (url.pathname === "/healthz/binding" && request.method === "GET") {
      // Sanity check: prove worker-b is reachable via service binding.
      // This is NOT a probe (no metrics), just a wiring check.
      try {
        const bRes = await env.WORKER_B.fetch(
          new Request("https://worker-b.spike/healthz", { method: "GET" }),
        );
        const bBody = await bRes.json();
        return Response.json({
          ok: bRes.ok,
          status: bRes.status,
          workerB: bBody,
        });
      } catch (err) {
        return Response.json(
          { ok: false, error: String(err) },
          { status: 502 },
        );
      }
    }

    return new Response(
      `spike-binding-pair worker-a skeleton (P1-04). Phase 3 will add 4 V3 probes.\nTry GET /healthz or GET /healthz/binding.\n`,
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
} satisfies ExportedHandler<SpikeEnv>;
