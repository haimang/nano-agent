/**
 * spike-binding-pair worker-b (callee) — Phase 3 build.
 *
 * Routes:
 *   GET  /healthz                          — liveness
 *   POST /handle/echo                      — minimal latency target
 *   POST /handle/slow/:ms                  — controllable-latency for cancellation probe
 *   POST /handle/header-dump               — header propagation probe target
 *   POST /handle/hook-dispatch             — emulates remote hook callback
 *   POST /handle/eval-emit                 — emulates downstream evidence emit
 *
 * Transport scope (per design §0):
 *   This worker only validates the FETCH-BASED service binding seam.
 *   Does NOT implement nacp-core's `handleNacp` RPC transport.
 *
 * 7 disciplines: see ../../../README.md
 */

import { handleEcho } from "./handlers/echo.js";
import { handleSlow } from "./handlers/slow.js";
import { handleHeaderDump } from "./handlers/header-dump.js";
import { handleHookDispatch } from "./handlers/hook-dispatch.js";
import { handleEvalEmit } from "./handlers/eval-emit.js";

interface SpikeEnv {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly ROLE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
}

const SPIKE_VERSION = "0.0.0-spike-p3-2026-04-19";

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
        handlersImplemented: 5,
        handlersPlanned: 5,
      });
    }

    try {
      if (path === "/handle/echo" && request.method === "POST") {
        return await handleEcho(request);
      }
      if (path.startsWith("/handle/slow/") && request.method === "POST") {
        const ms = parseInt(path.slice("/handle/slow/".length), 10);
        if (!Number.isFinite(ms) || ms < 0 || ms > 20_000) {
          return new Response("delayMs must be 0-20000", { status: 400 });
        }
        return await handleSlow(request, ms);
      }
      if (path === "/handle/header-dump" && request.method === "POST") {
        return await handleHeaderDump(request);
      }
      if (path === "/handle/hook-dispatch" && request.method === "POST") {
        return await handleHookDispatch(request);
      }
      if (path === "/handle/eval-emit" && request.method === "POST") {
        return await handleEvalEmit(request);
      }
    } catch (err) {
      return Response.json(
        {
          ok: false,
          handler: "?",
          error: String((err as Error)?.message ?? err),
          path,
        },
        { status: 500 },
      );
    }

    return new Response(
      `spike-binding-pair worker-b (Phase 3). 5 handlers ready.\n` +
        `Try GET /healthz, POST /handle/echo, /handle/slow/{ms}, /handle/header-dump, /handle/hook-dispatch, /handle/eval-emit.\n`,
      { status: 404, headers: { "content-type": "text/plain" } },
    );
  },
} satisfies ExportedHandler<SpikeEnv>;
