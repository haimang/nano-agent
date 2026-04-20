/**
 * spike-do-storage-r2 worker — Round 2 integrated build.
 *
 * Routes:
 *   GET  /healthz                                         liveness
 *
 *   Follow-ups (4):
 *   POST /probe/follow-ups/do-size-cap-binary-search      F08
 *   POST /probe/follow-ups/r2-concurrent-put              unexpected-F01
 *   POST /probe/follow-ups/kv-cross-colo-stale            F03 (gated)
 *   POST /probe/follow-ups/curl-high-volume               F09 (gated)
 *
 *   Re-validation (3):
 *   POST /probe/re-validation/storage                     F01/F02/F04/F05/F06
 *   POST /probe/re-validation/bash                        F07/F09 conservative
 *   POST /probe/re-validation/context                     B4 seam integration
 *
 *   Debug:
 *   GET  /inspect/last-run                                echo of most recent result
 *
 * Disciplines (Round 2 exception §7):
 *   This worker IS allowed to `import "@nano-agent/*"` — that is the
 *   whole point of Round 2. Pure follow-up probes that need raw
 *   platform truth do NOT import shipped packages; re-validation
 *   probes do.
 */

export { IntegratedProbeDO } from "./do/IntegratedProbeDO.js";

import { probeDoSizeCapBinarySearch } from "./follow-ups/do-size-cap-binary-search.js";
import { probeR2ConcurrentPut } from "./follow-ups/r2-concurrent-put.js";
import { probeKvCrossColoStale } from "./follow-ups/kv-cross-colo-stale.js";
import { probeCurlHighVolume } from "./follow-ups/curl-high-volume.js";
import { probeStorageReValidation } from "./re-validation/storage.js";
import { probeBashReValidation } from "./re-validation/bash.js";
import { probeContextReValidation } from "./re-validation/context.js";
import type { IntegratedProbeResult } from "./result-shape.js";

interface SpikeR2Env {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
  readonly F09_OWNER_URL: string;
  readonly F03_CROSS_COLO_ENABLED: string;
  readonly DO_PROBE: DurableObjectNamespace;
  readonly KV_PROBE: KVNamespace;
  readonly R2_PROBE: R2Bucket;
  readonly D1_PROBE: D1Database;
}

const SPIKE_VERSION = "0.0.0-spike-r2-2026-04-20";
const DO_SINGLETON_NAME = "integrated-probe-singleton";

let lastRun:
  | { route: string; capturedAt: string; result: IntegratedProbeResult }
  | null = null;

function record(route: string, result: IntegratedProbeResult): void {
  lastRun = { route, capturedAt: new Date().toISOString(), result };
}

function json(result: IntegratedProbeResult): Response {
  return Response.json(result);
}

export default {
  async fetch(request: Request, env: SpikeR2Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/healthz" && request.method === "GET") {
      return Response.json({
        ok: true,
        spike: env.SPIKE_NAMESPACE,
        env: env.ENVIRONMENT,
        version: SPIKE_VERSION,
        expirationDate: env.EXPIRATION_DATE,
        gates: {
          f09OwnerUrl: env.F09_OWNER_URL ? "set" : "unset",
          f03CrossColoEnabled: env.F03_CROSS_COLO_ENABLED === "true",
        },
        tags: { owner: env.OWNER_TAG, stage: env.STAGE_TAG },
      });
    }

    if (path === "/inspect/last-run" && request.method === "GET") {
      return Response.json(lastRun ?? { empty: true });
    }

    if (request.method !== "POST") {
      return new Response("Only POST supported for probe routes", { status: 405 });
    }

    try {
      switch (path) {
        // ── Follow-ups ──
        case "/probe/follow-ups/do-size-cap-binary-search": {
          const stub = env.DO_PROBE.get(env.DO_PROBE.idFromName(DO_SINGLETON_NAME));
          const result = await probeDoSizeCapBinarySearch(stub);
          record(path, result);
          return json(result);
        }
        case "/probe/follow-ups/r2-concurrent-put": {
          const result = await probeR2ConcurrentPut(env.R2_PROBE);
          record(path, result);
          return json(result);
        }
        case "/probe/follow-ups/kv-cross-colo-stale": {
          // B7-R4 fix: pass the observed colo/ray from the inbound
          // request so the probe can honestly annotate "single-colo-
          // observed" when only one colo is visible.
          const cf = (request as unknown as { cf?: { colo?: string } }).cf;
          const result = await probeKvCrossColoStale(env.KV_PROBE, {
            crossColoEnabled: env.F03_CROSS_COLO_ENABLED === "true",
            observedColo: cf?.colo,
            observedRay: request.headers.get("cf-ray") ?? undefined,
          });
          record(path, result);
          return json(result);
        }
        case "/probe/follow-ups/curl-high-volume": {
          const result = await probeCurlHighVolume({
            ownerUrl: env.F09_OWNER_URL,
          });
          record(path, result);
          return json(result);
        }

        // ── Re-validation ──
        case "/probe/re-validation/storage": {
          const stub = env.DO_PROBE.get(env.DO_PROBE.idFromName(DO_SINGLETON_NAME));
          const result = await probeStorageReValidation({
            mode: "live",
            r2: env.R2_PROBE,
            kv: env.KV_PROBE,
            d1: env.D1_PROBE,
            doStub: stub,
            teamUuid: env.OWNER_TAG,
            sessionUuid: "spike-r2-session",
          });
          record(path, result);
          return json(result);
        }
        case "/probe/re-validation/bash": {
          const result = await probeBashReValidation({ mode: "live" });
          record(path, result);
          return json(result);
        }
        case "/probe/re-validation/context": {
          const result = await probeContextReValidation({ mode: "live" });
          record(path, result);
          return json(result);
        }

        default:
          return new Response(`Unknown route: ${path}`, { status: 404 });
      }
    } catch (err) {
      return Response.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          route: path,
        },
        { status: 500 },
      );
    }
  },
};
