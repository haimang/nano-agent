/**
 * spike-do-storage — Round 1 bare-metal storage + bash platform probe.
 *
 * P1-03 (B1 Phase 1) skeleton: only /healthz route is implemented.
 * The 9 probe routes (V1×6 + V2A + V2B + V2-curl) are added in Phase 2.
 *
 * 7 disciplines (see ../README.md). Most relevantly:
 *   - 纪律 4: any platform truth discovered here MUST be written into
 *     docs/spikes/spike-do-storage/{NN}-{slug}.md using the
 *     docs/templates/_TEMPLATE-spike-finding.md template.
 *   - 纪律 7: this file does NOT import any packages/ runtime; the
 *     worker validates Cloudflare platform reality, not packages/ seam
 *     implementations.
 */

export { ProbeDO } from "./do/ProbeDO.js";

interface SpikeEnv {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
  readonly DO_PROBE: DurableObjectNamespace;
  readonly KV_PROBE: KVNamespace;
  readonly R2_PROBE: R2Bucket;
  readonly D1_PROBE: D1Database;
}

const SPIKE_VERSION = "0.0.0-spike-p1-03";

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" && request.method === "GET") {
      return Response.json({
        ok: true,
        spike: env.SPIKE_NAMESPACE,
        env: env.ENVIRONMENT,
        version: SPIKE_VERSION,
        expirationDate: env.EXPIRATION_DATE,
        tags: { owner: env.OWNER_TAG, stage: env.STAGE_TAG },
        bindings: {
          DO_PROBE: typeof env.DO_PROBE,
          KV_PROBE: typeof env.KV_PROBE,
          R2_PROBE: typeof env.R2_PROBE,
          D1_PROBE: typeof env.D1_PROBE,
        },
        // P1-03 skeleton: probe routes not yet implemented (see Phase 2).
        probesImplemented: 0,
        probesPlanned: 9,
      });
    }

    return new Response(
      `spike-do-storage skeleton (P1-03). 9 probe routes are added in Phase 2.\n` +
        `Try GET /healthz.\n`,
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
} satisfies ExportedHandler<SpikeEnv>;
