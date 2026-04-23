/**
 * @nano-agent/hooks — the single entry point for all hook emissions.
 *
 * The dispatcher looks up matching handlers, filters by matcher,
 * executes each through the appropriate runtime (with guards),
 * and aggregates outcomes.
 *
 * Safety contract on every `emit()` call:
 *   1. `checkDepth()` runs before any handler is dispatched, so a handler
 *      that recursively emits another event cannot blow the stack.
 *      Callers propagate recursion depth through `context.depth` (the
 *      dispatcher increments it for re-entrant lookups performed by
 *      downstream runtimes).
 *   2. `withTimeout()` wraps every handler execution with the configured
 *      timeout and the caller's `AbortSignal`.
 *   3. Any exception from a handler is captured and turned into a
 *      `continue` outcome with `diagnostics`, so one bad handler cannot
 *      abort the whole emit().
 */

import type { HookEventName } from "./catalog.js";
import { isBlockingEvent } from "./catalog.js";
import type { HookRuntimeKind } from "./types.js";
import type { AggregatedHookOutcome, HookOutcome } from "./outcome.js";
import { aggregateOutcomes } from "./outcome.js";
import { HookRegistry } from "./registry.js";
import { matchEvent } from "./matcher.js";
import { withTimeout, checkDepth, DEFAULT_GUARD_OPTIONS } from "./guards.js";
import type { HookRuntime } from "./runtimes/local-ts.js";

/**
 * Per-emit context. The caller owns all the fields here — the dispatcher
 * does not fabricate session / turn identity.
 */
export interface HookEmitContext {
  readonly toolName?: string;
  readonly sessionUuid?: string;
  readonly turnId?: string;
  /** Current recursion depth. Defaults to 0 at the top of the call chain. */
  readonly depth?: number;
  /** Abort signal propagated to every handler. */
  readonly abortSignal?: AbortSignal;
}

export class HookDispatcher {
  constructor(
    private registry: HookRegistry,
    private runtimes: Map<HookRuntimeKind, HookRuntime>,
    private options?: { defaultTimeoutMs?: number; maxDepth?: number },
  ) {}

  /**
   * Emit a hook event. Looks up matching handlers, executes them through
   * the appropriate runtime, and returns the aggregated outcome.
   *
   * Throws synchronously via the returned rejection if the recursion
   * depth is already above the guard's ceiling — handlers that emit
   * further events will see this as a diagnostics-bearing `continue`
   * outcome rather than an uncontrolled stack overflow.
   */
  async emit(
    eventName: HookEventName,
    payload: unknown,
    context?: HookEmitContext,
  ): Promise<AggregatedHookOutcome> {
    const maxDepth = this.options?.maxDepth ?? DEFAULT_GUARD_OPTIONS.maxDepth;
    const depth = context?.depth ?? 0;
    // Recursion guard — fires before any handler runs.
    checkDepth(depth, maxDepth);

    const handlers = this.registry.lookup(eventName);

    // Filter by matcher
    const matched = handlers.filter((h) =>
      matchEvent(h.matcher, eventName, context),
    );

    if (matched.length === 0) {
      return aggregateOutcomes([], eventName);
    }

    const defaultTimeout =
      this.options?.defaultTimeoutMs ?? DEFAULT_GUARD_OPTIONS.timeoutMs;
    const blocking = isBlockingEvent(eventName);
    const abortSignal = context?.abortSignal;

    // Each nested emit inside a handler should see `depth + 1` — expose
    // that as part of the runtime's per-call context so local-ts handlers
    // can route re-entrant emit() calls through the dispatcher.
    const runtimeContext = {
      ...(context ?? {}),
      depth: depth + 1,
    };

    const executeOne = async (
      handler: (typeof matched)[number],
    ): Promise<HookOutcome> => {
      const runtime = this.runtimes.get(handler.runtime);
      if (!runtime) {
        throw new Error(
          `No runtime registered for kind "${handler.runtime}"`,
        );
      }

      const timeoutMs = handler.timeoutMs ?? defaultTimeout;
      const start = Date.now();

      try {
        const outcome = await withTimeout(
          () => runtime.execute(handler, payload, runtimeContext),
          timeoutMs,
          abortSignal,
        );
        return outcome;
      } catch (err) {
        // On error, return a continue outcome with diagnostics
        return {
          action: "continue",
          handlerId: handler.id,
          durationMs: Date.now() - start,
          diagnostics: {
            error: err instanceof Error ? err.message : String(err),
          },
        };
      }
    };

    let outcomes: HookOutcome[];

    if (blocking) {
      // For blocking events, execute sequentially so earlier handlers
      // (higher priority) can block before later ones run.
      outcomes = [];
      for (const handler of matched) {
        const outcome = await executeOne(handler);
        outcomes.push(outcome);
        // If a handler blocks or stops, short-circuit
        if (outcome.action === "block" || outcome.action === "stop") {
          break;
        }
      }
    } else {
      // For non-blocking events, execute all handlers in parallel.
      outcomes = await Promise.all(matched.map(executeOne));
    }

    return aggregateOutcomes(outcomes, eventName);
  }
}
