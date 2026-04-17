/**
 * Capability Executor
 *
 * Central execution facade. Takes a CapabilityPlan, checks policy,
 * dispatches to the appropriate target handler, and returns results.
 *
 * Supports:
 *   - AbortSignal-based cancellation (per requestId)
 *   - Event streaming via executeStream() returning AsyncIterable<CapabilityEvent>
 *   - Timeout enforcement that actually aborts the underlying execution
 */

import type { CapabilityPlan, ExecutionTarget } from "./types.js";
import type { CapabilityResult } from "./result.js";
import type { CapabilityPolicyGate } from "./policy.js";
import type { CapabilityEvent } from "./events.js";

/** Handler interface for a specific execution target. */
export interface TargetHandler {
  execute(plan: CapabilityPlan, signal?: AbortSignal): Promise<CapabilityResult>;
}

/**
 * Progress callback the executor hands to handlers that implement
 * `StreamingTargetHandler`. Each call surfaces a single `progress`
 * event on `executeStream()`.
 *
 * Handlers MUST NOT call `emit` after resolving — the executor
 * guarantees that any such calls are ignored so progress cannot arrive
 * after the terminal event.
 */
export type ProgressEmit = (progress: {
  readonly chunk?: string;
  readonly fraction?: number;
  readonly note?: string;
}) => void;

/**
 * Extended handler that can push progress events back up to the
 * executor. Implementations keep the `execute()` contract for the
 * single-call API and ALSO implement `executeStreaming()`, which is
 * preferred by `executeStream()` when available.
 *
 * Concrete implementations include the in-process `LocalTsTarget`
 * (which can stream long-running command output) and the
 * `ServiceBindingTarget` transport test doubles.
 */
export interface StreamingTargetHandler extends TargetHandler {
  executeStreaming(
    plan: CapabilityPlan,
    emit: ProgressEmit,
    signal?: AbortSignal,
  ): Promise<CapabilityResult>;
}

/** Type guard: does this handler implement the streaming API? */
export function isStreamingHandler(
  handler: TargetHandler,
): handler is StreamingTargetHandler {
  return (
    typeof (handler as Partial<StreamingTargetHandler>).executeStreaming ===
    "function"
  );
}

/** Options for the executor. */
export interface ExecutorOptions {
  timeoutMs?: number;
}

/**
 * CapabilityExecutor orchestrates plan execution:
 * 1. Policy check
 * 2. Target dispatch (with AbortSignal)
 * 3. Timeout enforcement (which aborts on expiry)
 * 4. Result normalisation
 * 5. Event streaming (started -> completed/error/cancelled/timeout)
 */
export class CapabilityExecutor {
  private activeExecutions = new Map<string, AbortController>();

  constructor(
    private targets: Map<ExecutionTarget, TargetHandler>,
    private policy: CapabilityPolicyGate,
    private options?: ExecutorOptions,
  ) {}

  async execute(plan: CapabilityPlan): Promise<CapabilityResult> {
    const start = Date.now();
    const requestId = generateRequestId();

    // 1. Policy check
    const decision = await this.policy.check(plan);
    if (decision === "deny") {
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId,
        error: {
          code: "policy-denied",
          message: `Capability "${plan.capabilityName}" was denied by policy`,
        },
        durationMs: Date.now() - start,
      };
    }

    if (decision === "ask") {
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId,
        error: {
          code: "policy-ask",
          message: `Capability "${plan.capabilityName}" requires user approval`,
        },
        durationMs: Date.now() - start,
      };
    }

    // 2. Find target handler
    const handler = this.targets.get(plan.executionTarget);
    if (!handler) {
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId,
        error: {
          code: "no-target",
          message: `No handler registered for target "${plan.executionTarget}"`,
        },
        durationMs: Date.now() - start,
      };
    }

    // 3. Register an AbortController keyed by requestId for external cancel()
    const controller = new AbortController();
    this.activeExecutions.set(requestId, controller);

    try {
      const timeoutMs = this.options?.timeoutMs;
      const result = await this.runHandler(
        handler,
        plan,
        requestId,
        controller,
        timeoutMs,
      );
      return {
        ...result,
        requestId: result.requestId ?? requestId,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId,
        error: {
          code: "execution-error",
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: Date.now() - start,
      };
    } finally {
      this.activeExecutions.delete(requestId);
    }
  }

  /**
   * Execute a plan as an AsyncIterable of lifecycle events.
   *
   * Yields `started` first, then zero or more `progress` events
   * (only when the target implements `StreamingTargetHandler`),
   * followed by exactly one terminal event — `completed`, `error`,
   * `cancelled`, or `timeout`.
   *
   * Progress events are produced by the target itself via a
   * `ProgressEmit` callback that the executor funnels into the async
   * iterator. Targets that do not implement the streaming API emit a
   * pure `started → terminal` sequence, which preserves backwards
   * compatibility.
   */
  executeStream(plan: CapabilityPlan): AsyncIterable<CapabilityEvent> {
    const self = this;
    return {
      async *[Symbol.asyncIterator](): AsyncIterator<CapabilityEvent> {
        const requestId = generateRequestId();
        const startedAt = new Date().toISOString();

        yield {
          kind: "started",
          capabilityName: plan.capabilityName,
          requestId,
          timestamp: startedAt,
        };

        // We deliberately re-implement the dispatch here (rather than
        // calling execute()) so we can thread the requestId through and
        // surface cancel/timeout events distinctly.
        const start = Date.now();

        // 1. Policy
        const decision = await self.policy.check(plan);
        if (decision === "deny" || decision === "ask") {
          yield {
            kind: "error",
            capabilityName: plan.capabilityName,
            requestId,
            timestamp: new Date().toISOString(),
            detail: {
              code: decision === "deny" ? "policy-denied" : "policy-ask",
              durationMs: Date.now() - start,
            },
          };
          return;
        }

        const handler = self.targets.get(plan.executionTarget);
        if (!handler) {
          yield {
            kind: "error",
            capabilityName: plan.capabilityName,
            requestId,
            timestamp: new Date().toISOString(),
            detail: {
              code: "no-target",
              durationMs: Date.now() - start,
            },
          };
          return;
        }

        const controller = new AbortController();
        self.activeExecutions.set(requestId, controller);

        // Progress plumbing: handlers push via emit(); we queue the
        // events and drain them before yielding the terminal event.
        const progressQueue: CapabilityEvent[] = [];
        let resolveProgress: (() => void) | null = null;
        let settled = false;
        const emit: ProgressEmit = (p) => {
          if (settled) return;
          progressQueue.push({
            kind: "progress",
            capabilityName: plan.capabilityName,
            requestId,
            timestamp: new Date().toISOString(),
            detail: p,
          });
          if (resolveProgress) {
            const r = resolveProgress;
            resolveProgress = null;
            r();
          }
        };

        try {
          const timeoutMs = self.options?.timeoutMs;
          const runPromise = self.runHandlerStreaming(
            handler,
            plan,
            requestId,
            controller,
            timeoutMs,
            emit,
          );
          let runSettled = false;
          const runWrapped = runPromise.finally(() => {
            runSettled = true;
            if (resolveProgress) {
              const r = resolveProgress;
              resolveProgress = null;
              r();
            }
          });

          // Yield any queued progress events while the handler runs.
          while (!runSettled || progressQueue.length > 0) {
            if (progressQueue.length === 0 && !runSettled) {
              await new Promise<void>((res) => {
                resolveProgress = res;
              });
              continue;
            }
            const next = progressQueue.shift();
            if (next) yield next;
          }

          const result = await runWrapped;
          settled = true;
          const terminalKind: CapabilityEvent["kind"] =
            result.kind === "inline" || result.kind === "promoted"
              ? "completed"
              : result.kind === "cancelled"
                ? "cancelled"
                : result.kind === "timeout"
                  ? "timeout"
                  : "error";

          yield {
            kind: terminalKind,
            capabilityName: plan.capabilityName,
            requestId,
            timestamp: new Date().toISOString(),
            detail: {
              result: {
                ...result,
                requestId,
                durationMs: Date.now() - start,
              },
            },
          };
        } catch (err) {
          yield {
            kind: "error",
            capabilityName: plan.capabilityName,
            requestId,
            timestamp: new Date().toISOString(),
            detail: {
              code: "execution-error",
              message: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - start,
            },
          };
        } finally {
          self.activeExecutions.delete(requestId);
        }
      },
    };
  }

  /**
   * Cancel an in-flight execution by requestId.
   *
   * No-op if the requestId is unknown or already completed.
   */
  cancel(requestId: string): void {
    const controller = this.activeExecutions.get(requestId);
    if (controller) {
      controller.abort();
    }
  }

  /**
   * Core dispatch for `executeStream()`. Prefers `executeStreaming()`
   * when the handler implements it so progress can flow through; falls
   * back to plain `execute()` otherwise.
   */
  private async runHandlerStreaming(
    handler: TargetHandler,
    plan: CapabilityPlan,
    requestId: string,
    controller: AbortController,
    timeoutMs: number | undefined,
    emit: ProgressEmit,
  ): Promise<CapabilityResult> {
    if (isStreamingHandler(handler)) {
      return this.runWithTimeout(
        (signal) => handler.executeStreaming(plan, emit, signal),
        plan,
        requestId,
        controller,
        timeoutMs,
      );
    }
    return this.runWithTimeout(
      (signal) => handler.execute(plan, signal),
      plan,
      requestId,
      controller,
      timeoutMs,
    );
  }

  /** Shared timeout/abort wrapper used by both dispatch paths. */
  private async runWithTimeout(
    run: (signal: AbortSignal) => Promise<CapabilityResult>,
    plan: CapabilityPlan,
    requestId: string,
    controller: AbortController,
    timeoutMs: number | undefined,
  ): Promise<CapabilityResult> {
    if (timeoutMs && timeoutMs > 0) {
      return await withTimeout(run, timeoutMs, plan, requestId, controller);
    }
    try {
      const result = await run(controller.signal);
      if (controller.signal.aborted && result.kind !== "cancelled") {
        return {
          kind: "cancelled",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "cancelled",
            message: `Capability "${plan.capabilityName}" was cancelled`,
          },
          durationMs: 0,
        };
      }
      return result;
    } catch (err) {
      if (controller.signal.aborted) {
        return {
          kind: "cancelled",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "cancelled",
            message: `Capability "${plan.capabilityName}" was cancelled`,
          },
          durationMs: 0,
        };
      }
      throw err;
    }
  }

  /** Core dispatch: runs the handler with timeout + abort semantics. */
  private async runHandler(
    handler: TargetHandler,
    plan: CapabilityPlan,
    requestId: string,
    controller: AbortController,
    timeoutMs: number | undefined,
  ): Promise<CapabilityResult> {
    if (timeoutMs && timeoutMs > 0) {
      return await withTimeout(
        (signal) => handler.execute(plan, signal),
        timeoutMs,
        plan,
        requestId,
        controller,
      );
    }

    try {
      const result = await handler.execute(plan, controller.signal);
      if (controller.signal.aborted && result.kind !== "cancelled") {
        return {
          kind: "cancelled",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "cancelled",
            message: `Capability "${plan.capabilityName}" was cancelled`,
          },
          durationMs: 0,
        };
      }
      return result;
    } catch (err) {
      if (controller.signal.aborted) {
        return {
          kind: "cancelled",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "cancelled",
            message: `Capability "${plan.capabilityName}" was cancelled`,
          },
          durationMs: 0,
        };
      }
      throw err;
    }
  }
}

/**
 * Run `run(signal)` with a timeout. On expiry, aborts the controller
 * (so the underlying handler gets a chance to stop) and resolves with
 * a `timeout` CapabilityResult.
 */
function withTimeout(
  run: (signal: AbortSignal) => Promise<CapabilityResult>,
  ms: number,
  plan: CapabilityPlan,
  requestId: string,
  controller: AbortController,
): Promise<CapabilityResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Abort the underlying handler. It MAY still resolve asynchronously;
      // we discard its eventual value because we've already committed to
      // the timeout outcome.
      controller.abort();
      resolve({
        kind: "timeout",
        capabilityName: plan.capabilityName,
        requestId,
        error: {
          code: "timeout",
          message: `Capability "${plan.capabilityName}" timed out after ${ms}ms`,
        },
        durationMs: ms,
      });
    }, ms);

    run(controller.signal)
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          kind: "error",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "execution-error",
            message: err instanceof Error ? err.message : String(err),
          },
          durationMs: 0,
        });
      });
  });
}

let _reqCounter = 0;
function generateRequestId(): string {
  return `req-${Date.now()}-${++_reqCounter}`;
}
