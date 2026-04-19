/**
 * spike-binding-pair worker-a (caller) — Phase 3 build.
 *
 * Routes:
 *   GET  /healthz                                — liveness
 *   GET  /healthz/binding                        — service binding sanity check
 *   POST /probe/binding-latency-cancellation     — V3-binding-latency-cancellation
 *   POST /probe/binding-cross-seam-anchor        — V3-binding-cross-seam-anchor
 *   POST /probe/binding-hooks-callback           — V3-binding-hooks-callback
 *   POST /probe/binding-eval-fanin               — V3-binding-eval-fanin
 *   GET  /inspect/last-run                       — debug echo
 *
 * Transport scope (per design §0):
 *   Only validates fetch-based service binding seam.
 *   Does NOT exercise nacp-core's `handleNacp` RPC transport.
 *
 * 7 disciplines: see ../../../README.md
 */

import { probeLatencyCancellation } from "./probes/latency-cancellation.js";
import { probeCrossSeamAnchor } from "./probes/cross-seam-anchor.js";
import { probeHooksCallback } from "./probes/hooks-callback.js";
import { probeEvalFanin } from "./probes/eval-fanin.js";
import type { BindingProbeResult } from "./result-shape.js";

interface SpikeEnv {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly ROLE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
  readonly WORKER_B: Fetcher;
}

const SPIKE_VERSION = "0.0.0-spike-p3-2026-04-19";

let lastRun: { route: string; capturedAt: string; result: BindingProbeResult } | null = null;

function record(route: string, result: BindingProbeResult): void {
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

    if (path === "/healthz" && request.method === "GET") {
      return Response.json({
        ok: true,
        spike: env.SPIKE_NAMESPACE,
        role: env.ROLE,
        env: env.ENVIRONMENT,
        version: SPIKE_VERSION,
        expirationDate: env.EXPIRATION_DATE,
        tags: { owner: env.OWNER_TAG, stage: env.STAGE_TAG },
        bindings: { WORKER_B: typeof env.WORKER_B },
        probesImplemented: 4,
        probesPlanned: 4,
        transportScope: "fetch-based-seam-only",
      });
    }

    if (path === "/healthz/binding" && request.method === "GET") {
      try {
        const bRes = await env.WORKER_B.fetch(
          new Request("https://worker-b.spike/healthz", { method: "GET" }),
        );
        const bBody = await bRes.json();
        return Response.json({ ok: bRes.ok, status: bRes.status, workerB: bBody });
      } catch (err) {
        return Response.json(
          { ok: false, error: String((err as Error)?.message ?? err) },
          { status: 502 },
        );
      }
    }

    if (path === "/inspect/last-run" && request.method === "GET") {
      return Response.json(lastRun ?? { ok: false, message: "no probe yet" });
    }

    if (path.startsWith("/probe/")) {
      const params = await readParams(request);
      let result: BindingProbeResult;

      try {
        switch (path) {
          case "/probe/binding-latency-cancellation":
            result = await probeLatencyCancellation(env.WORKER_B, params);
            break;
          case "/probe/binding-cross-seam-anchor":
            result = await probeCrossSeamAnchor(env.WORKER_B, params);
            break;
          case "/probe/binding-hooks-callback":
            result = await probeHooksCallback(env.WORKER_B, params);
            break;
          case "/probe/binding-eval-fanin":
            result = await probeEvalFanin(env.WORKER_B, params);
            break;
          default:
            return new Response(`Unknown probe route: ${path}`, { status: 404 });
        }

        record(path, result);
        return Response.json(result);
      } catch (err) {
        return Response.json(
          { ok: false, route: path, error: String((err as Error)?.message ?? err) },
          { status: 500 },
        );
      }
    }

    return new Response(
      `spike-binding-pair worker-a (Phase 3). 4 V3 probes ready.\n` +
        `Try GET /healthz, GET /healthz/binding, POST /probe/binding-{...}.\n` +
        `Transport scope: fetch-based seam only (handleNacp RPC NOT covered).\n`,
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
} satisfies ExportedHandler<SpikeEnv>;
