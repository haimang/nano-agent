/**
 * spike-binding-pair-r2 worker-b (callee) — Round 2 integrated build.
 *
 * Owns a `BoundedEvalSink` from `@nano-agent/session-do-runtime` and
 * exposes its ingestion + stats + disclosure as HTTP routes so
 * worker-a can drive the true callback push path and then inspect
 * dedup / overflow outcomes on the wire.
 *
 * This is the route pattern the action-plan mandates (B7 §2.4 /
 * §6.2 #5): worker-a push → worker-b sink → stats reflect push
 * reality. NOT response-body simulation.
 *
 * The slow / echo / header / hook handlers remain for binding-F01
 * (callee abort observability), binding-F02 (lowercase header law
 * re-validation), and binding-F03 (hook dispatch re-validation).
 */

import {
  BoundedEvalSink,
  extractMessageUuid,
  type EvalSinkOverflowDisclosure,
  type EvalSinkStats,
} from "@nano-agent/session-do-runtime";

import { handleEcho } from "./handlers/echo.js";
import { handleSlow } from "./handlers/slow-abort-observer.js";
import { handleHeaderDump } from "./handlers/header-dump.js";
import { handleHookDispatch } from "./handlers/hook-dispatch.js";
import {
  handleSinkIngest,
  handleSinkStats,
  handleSinkDisclosure,
  handleSinkReset,
} from "./handlers/eval-sink-ingest.js";

interface WorkerBEnv {
  readonly ENVIRONMENT: string;
  readonly SPIKE_NAMESPACE: string;
  readonly ROLE: string;
  readonly EXPIRATION_DATE: string;
  readonly OWNER_TAG: string;
  readonly STAGE_TAG: string;
}

const SPIKE_VERSION = "0.0.0-spike-r2-b-2026-04-20";

// Single `BoundedEvalSink` instance for the Worker lifetime. When
// Cloudflare recycles the isolate, the sink is reset — that is
// consistent with its documented "in-memory bounded FIFO" semantics
// (see `packages/session-do-runtime/src/eval-sink.ts`). B7 does not
// cover durability of the default sink; that's a B8 worker-matrix
// concern if/when the sink becomes a production path.
//
// We intentionally use the default capacity (1024) to exercise the
// Round 1 observed steady-state traffic profile. Callers that want a
// different capacity can hit `/sink/reset?capacity=N`.
let sink = new BoundedEvalSink({ capacity: 1024 });
const disclosureBuffer: EvalSinkOverflowDisclosure[] = [];
const onOverflow = (d: EvalSinkOverflowDisclosure): void => {
  disclosureBuffer.push(d);
  if (disclosureBuffer.length > 128) disclosureBuffer.splice(0, 1);
};

function resetSink(capacity: number): void {
  sink = new BoundedEvalSink({ capacity, onOverflow });
  disclosureBuffer.length = 0;
}

// Re-create with callback so every disclosure is observable via
// both `/sink/disclosure` (sink internal ring) and the worker's own
// overflow log (for cross-check).
resetSink(1024);

export default {
  async fetch(request: Request, env: WorkerBEnv): Promise<Response> {
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

    try {
      switch (path) {
        case "/echo":
          return handleEcho(request);
        case "/slow":
          return handleSlow(request);
        case "/headers/dump":
          return handleHeaderDump(request);
        case "/hooks/dispatch":
          return handleHookDispatch(request);

        // ── BoundedEvalSink endpoints (binding-F04 true push path) ──
        case "/sink/ingest":
          return handleSinkIngest(request, (args) => sink.emit(args), extractMessageUuid);
        case "/sink/stats":
          return handleSinkStats(
            (): EvalSinkStats => sink.getStats(),
            () => sink.getRecords(),
          );
        case "/sink/disclosure":
          return handleSinkDisclosure(() => sink.getDisclosure());
        case "/sink/reset": {
          const url = new URL(request.url);
          const cap = Number(url.searchParams.get("capacity") ?? "1024");
          resetSink(Number.isFinite(cap) && cap > 0 ? cap : 1024);
          return Response.json({ ok: true, capacity: cap });
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
