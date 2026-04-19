/**
 * spike-do-storage worker — Phase 2 build.
 *
 * Routes:
 *   GET  /healthz                          — liveness
 *   POST /probe/storage-r2/multipart       — V1-storage-R2-multipart
 *   POST /probe/storage-r2/list-cursor     — V1-storage-R2-list-cursor
 *   POST /probe/storage-kv/stale-read      — V1-storage-KV-stale-read
 *   POST /probe/storage-do/transactional   — V1-storage-DO-transactional
 *   POST /probe/storage-mem-vs-do/diff     — V1-storage-Memory-vs-DO
 *   POST /probe/storage-d1/transaction     — V1-storage-D1-transaction
 *   POST /probe/bash/capability-parity     — V2A-bash-capability-parity
 *   POST /probe/bash/platform-stress       — V2B-bash-platform-stress
 *   POST /probe/bash/curl-quota            — V2-bash-curl-quota
 *   GET  /inspect/last-run                 — debug echo of last-recorded result
 *
 * 7 disciplines (see ../README.md):
 *   - 纪律 4: this worker writes structured ProbeResult JSON; turning it
 *     into a finding doc is a separate (manual) step using
 *     docs/templates/_TEMPLATE-spike-finding.md.
 *   - 纪律 7: no `import "@nano-agent/*"` — all probe code lives under
 *     ./probes/.
 */

export { ProbeDO } from "./do/ProbeDO.js";

import { probeR2Multipart } from "./probes/r2-multipart.js";
import { probeR2ListCursor } from "./probes/r2-list-cursor.js";
import { probeKvStaleRead } from "./probes/kv-stale-read.js";
import { probeDoTransactional } from "./probes/do-transactional.js";
import { probeMemVsDo } from "./probes/mem-vs-do.js";
import { probeD1Transaction } from "./probes/d1-transaction.js";
import { probeBashCapabilityParity } from "./probes/bash-capability-parity.js";
import { probeBashPlatformStress } from "./probes/bash-platform-stress.js";
import { probeBashCurlQuota } from "./probes/bash-curl-quota.js";
import type { ProbeResult } from "./result-shape.js";

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

const SPIKE_VERSION = "0.0.0-spike-p2-2026-04-19";

let lastRun: { route: string; capturedAt: string; result: ProbeResult } | null = null;

function record(route: string, result: ProbeResult): void {
  lastRun = { route, capturedAt: new Date().toISOString(), result };
}

async function readParams(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== "POST") return {};
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: SpikeEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Liveness.
    if (path === "/healthz" && request.method === "GET") {
      return Response.json({
        ok: true,
        spike: env.SPIKE_NAMESPACE,
        env: env.ENVIRONMENT,
        version: SPIKE_VERSION,
        expirationDate: env.EXPIRATION_DATE,
        tags: { owner: env.OWNER_TAG, stage: env.STAGE_TAG },
        probesImplemented: 9,
        probesPlanned: 9,
      });
    }

    // Inspect last run (debug only — does NOT count as a probe).
    if (path === "/inspect/last-run" && request.method === "GET") {
      return Response.json(lastRun ?? { ok: false, message: "no probe yet" });
    }

    if (path.startsWith("/probe/")) {
      const params = await readParams(request);
      let result: ProbeResult;

      try {
        switch (path) {
          case "/probe/storage-r2/multipart":
            result = await probeR2Multipart(env.R2_PROBE, params);
            break;
          case "/probe/storage-r2/list-cursor":
            result = await probeR2ListCursor(env.R2_PROBE, params);
            break;
          case "/probe/storage-kv/stale-read":
            result = await probeKvStaleRead(env.KV_PROBE, params);
            break;
          case "/probe/storage-do/transactional":
            result = await probeDoTransactional(env.DO_PROBE, params);
            break;
          case "/probe/storage-mem-vs-do/diff":
            result = await probeMemVsDo(env.DO_PROBE, params);
            break;
          case "/probe/storage-d1/transaction":
            result = await probeD1Transaction(env.D1_PROBE, params);
            break;
          case "/probe/bash/capability-parity":
            result = await probeBashCapabilityParity(env.DO_PROBE, params);
            break;
          case "/probe/bash/platform-stress":
            result = await probeBashPlatformStress(env.DO_PROBE, params);
            break;
          case "/probe/bash/curl-quota":
            result = await probeBashCurlQuota(params);
            break;
          default:
            return new Response(`Unknown probe route: ${path}`, { status: 404 });
        }

        record(path, result);
        return Response.json(result);
      } catch (err) {
        return Response.json(
          {
            ok: false,
            route: path,
            error: String((err as Error)?.message ?? err),
          },
          { status: 500 },
        );
      }
    }

    return new Response(
      `spike-do-storage worker (Phase 2). Try GET /healthz or POST /probe/{...}.\n` +
        `Routes:\n` +
        `  POST /probe/storage-r2/multipart\n` +
        `  POST /probe/storage-r2/list-cursor\n` +
        `  POST /probe/storage-kv/stale-read\n` +
        `  POST /probe/storage-do/transactional\n` +
        `  POST /probe/storage-mem-vs-do/diff\n` +
        `  POST /probe/storage-d1/transaction\n` +
        `  POST /probe/bash/capability-parity\n` +
        `  POST /probe/bash/platform-stress\n` +
        `  POST /probe/bash/curl-quota\n` +
        `  GET  /inspect/last-run\n`,
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
} satisfies ExportedHandler<SpikeEnv>;
