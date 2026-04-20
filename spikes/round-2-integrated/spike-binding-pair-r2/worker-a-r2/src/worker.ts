/**
 * spike-binding-pair-r2 worker-a (caller) — Round 2 integrated build.
 *
 * Routes:
 *   GET  /healthz                                           liveness
 *   GET  /healthz/binding                                   service binding sanity check
 *   POST /probe/follow-ups/binding-f01-callee-abort         binding-F01 follow-up
 *   POST /probe/follow-ups/binding-f04-true-callback        binding-F04 follow-up
 *   POST /probe/re-validation/binding                       binding-F02 / binding-F03 via shipped seam
 *   GET  /inspect/last-run                                  debug echo
 */

import { probeBindingF01CalleeAbort } from "./follow-ups/binding-f01-callee-abort.js";
import { probeBindingF04TrueCallback } from "./follow-ups/binding-f04-true-callback.js";
import { probeBindingReValidation } from "./re-validation/binding.js";
import type { BindingProbeResult } from "./result-shape.js";

interface WorkerAEnv {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly ROLE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
  readonly WORKER_B: Fetcher;
}

const SPIKE_VERSION = "0.0.0-spike-r2-a-2026-04-20";

let lastRun:
  | { route: string; capturedAt: string; result: BindingProbeResult }
  | null = null;

function record(route: string, result: BindingProbeResult): void {
  lastRun = { route, capturedAt: new Date().toISOString(), result };
}

export default {
  async fetch(request: Request, env: WorkerAEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/healthz" && request.method === "GET") {
      return Response.json({
        ok: true,
        spike: env.SPIKE_NAMESPACE,
        role: env.ROLE,
        version: SPIKE_VERSION,
        expirationDate: env.EXPIRATION_DATE,
      });
    }

    if (path === "/healthz/binding" && request.method === "GET") {
      const resp = await env.WORKER_B.fetch(
        new Request("https://worker-b/healthz", { method: "GET" }),
      );
      const body = await resp.json().catch(() => ({}));
      return Response.json({ ok: resp.ok, downstream: body });
    }

    if (path === "/inspect/last-run" && request.method === "GET") {
      return Response.json(lastRun ?? { empty: true });
    }

    if (request.method !== "POST") {
      return new Response("Only POST supported for probe routes", { status: 405 });
    }

    try {
      switch (path) {
        case "/probe/follow-ups/binding-f01-callee-abort": {
          const result = await probeBindingF01CalleeAbort(env.WORKER_B);
          record(path, result);
          return Response.json(result);
        }
        case "/probe/follow-ups/binding-f04-true-callback": {
          const result = await probeBindingF04TrueCallback(env.WORKER_B);
          record(path, result);
          return Response.json(result);
        }
        case "/probe/re-validation/binding": {
          const result = await probeBindingReValidation(env.WORKER_B);
          record(path, result);
          return Response.json(result);
        }
        default:
          return new Response(`Unknown route: ${path}`, { status: 404 });
      }
    } catch (err) {
      return Response.json(
        { ok: false, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  },
};
