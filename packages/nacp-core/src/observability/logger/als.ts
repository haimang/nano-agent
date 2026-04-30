/**
 * AsyncLocalStorage trace context propagation for the worker logger.
 *
 * Both Cloudflare Workers (under the `nodejs_compat` flag) and Node
 * natively expose `node:async_hooks`; nacp-core itself stays dependency-
 * free of `@types/node`, so the type shape is declared locally below.
 *
 * RHX2 design §7.2 F1 (DO + Worker-Shell dual mode):
 *   - Worker-Shell fetch handler should `withTraceContext({trace_uuid,...},
 *     () => doWork())` once at the top.
 *   - DO `fetch` should do the same.
 */

import { AsyncLocalStorage } from "./async-hooks-shim.js";

import type { TraceContext } from "./types.js";

/**
 * Module-singleton ALS instance. Exported only for tests; production
 * callers should always go through `withTraceContext` / `getTraceContext`.
 */
export const traceContextStorage = new AsyncLocalStorage<TraceContext>();

/**
 * Run `fn` with `context` available to all logger calls underneath.
 * If a context is already active, the new context **replaces** it for
 * the inner scope (consistent with ALS `run` semantics).
 */
export function withTraceContext<T>(context: TraceContext, fn: () => T): T {
  return traceContextStorage.run(context, fn);
}

/**
 * Read the current trace context, if any. Returns `undefined` outside a
 * `withTraceContext` boundary — callers (the logger) handle that case
 * by simply omitting the trace fields, never throwing.
 */
export function getTraceContext(): TraceContext | undefined {
  return traceContextStorage.getStore();
}
