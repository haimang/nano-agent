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
import type {
  CapabilityPermissionAuthorizer,
  PermissionDecision,
} from "./permission.js";

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
  beforeCapabilityExecute?: (ctx: {
    readonly plan: CapabilityPlan;
    readonly requestId: string;
  }) => Promise<void> | void;
  /**
   * Optional B5 hook producer seam. When supplied, ask-gated policy
   * decisions are routed to the authorizer (which in turn dispatches
   * the `PermissionRequest` / `PermissionDenied` hook events). When
   * absent, the executor falls back to the legacy behaviour of
   * returning a `policy-ask` error so hosts that don't wire hooks
   * still behave deterministically.
   */
  permissionAuthorizer?: CapabilityPermissionAuthorizer;
  /**
   * B5-B6 review R2 — cross-seam observability carriers. When the host
   * (typically `NanoSessionDO`) supplies this provider, the executor
   * snapshots the live `{ sessionUuid, turnUuid, traceUuid }` at the
   * moment of each ask-gated policy decision and threads them into
   * `PermissionRequestContext`. That closes the gap between the
   * interface's carrier fields and what the authorizer actually
   * receives — without it, remote permission workers cannot stitch
   * `PermissionRequest` / `PermissionDenied` events onto the right
   * session trace.
   *
   * Returns `undefined` for any carrier the host has not yet latched
   * (e.g. before the first client frame); the executor only threads
   * the fields the provider actually populates.
   */
  permissionContextProvider?: () => {
    readonly sessionUuid?: string;
    readonly turnUuid?: string;
    readonly traceUuid?: string;
  };
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
    return this.executeWithRequestId(plan, generateRequestId());
  }

  async executeWithRequestId(
    plan: CapabilityPlan,
    requestId: string,
  ): Promise<CapabilityResult> {
    const start = Date.now();

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
      // B5 — delegate to the optional PermissionAuthorizer seam, which
      // fronts the `PermissionRequest` / `PermissionDenied` hook events.
      // Without an authorizer, fall back to the legacy `policy-ask`
      // error so existing hosts stay deterministic.
      const authorizer = this.options?.permissionAuthorizer;
      if (!authorizer) {
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
      let verdict: PermissionDecision;
      try {
        verdict = await authorizer.authorize({
          plan,
          requestId,
          ...this.snapshotPermissionCarriers(),
        });
      } catch (err) {
        return {
          kind: "error",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "policy-denied",
            message: err instanceof Error ? err.message : String(err),
          },
          durationMs: Date.now() - start,
        };
      }
      if (verdict.verdict === "deny") {
        return {
          kind: "error",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "policy-denied",
            message:
              verdict.reason ?? `Capability "${plan.capabilityName}" was denied by permission handlers`,
          },
          durationMs: Date.now() - start,
        };
      }
      // fall-through: verdict === "allow" → continue executing
    }

    const beforeCapabilityExecute = this.options?.beforeCapabilityExecute;
    if (beforeCapabilityExecute) {
      try {
        await beforeCapabilityExecute({ plan, requestId });
      } catch (err) {
        return {
          kind: "error",
          capabilityName: plan.capabilityName,
          requestId,
          error: {
            code: "policy-denied",
            message: err instanceof Error ? err.message : String(err),
          },
          durationMs: Date.now() - start,
        };
      }
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
        if (decision === "deny") {
          yield {
            kind: "error",
            capabilityName: plan.capabilityName,
            requestId,
            timestamp: new Date().toISOString(),
            detail: {
              code: "policy-denied",
              durationMs: Date.now() - start,
            },
          };
          return;
        }
        if (decision === "ask") {
          const authorizer = self.options?.permissionAuthorizer;
          if (!authorizer) {
            yield {
              kind: "error",
              capabilityName: plan.capabilityName,
              requestId,
              timestamp: new Date().toISOString(),
              detail: {
                code: "policy-ask",
                durationMs: Date.now() - start,
              },
            };
            return;
          }
          let verdict: PermissionDecision;
          try {
            verdict = await authorizer.authorize({
              plan,
              requestId,
              ...self.snapshotPermissionCarriers(),
            });
          } catch (err) {
            // Fail-closed on authorizer errors.
            yield {
              kind: "error",
              capabilityName: plan.capabilityName,
              requestId,
              timestamp: new Date().toISOString(),
              detail: {
                code: "policy-denied",
                message: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
              },
            };
            return;
          }
          if (verdict.verdict === "deny") {
            yield {
              kind: "error",
              capabilityName: plan.capabilityName,
              requestId,
              timestamp: new Date().toISOString(),
              detail: {
                code: "policy-denied",
                message: verdict.reason,
                durationMs: Date.now() - start,
              },
            };
            return;
          }
          // verdict === "allow" → continue
        }

        const beforeCapabilityExecute = self.options?.beforeCapabilityExecute;
        if (beforeCapabilityExecute) {
          try {
            await beforeCapabilityExecute({ plan, requestId });
          } catch (err) {
            yield {
              kind: "error",
              capabilityName: plan.capabilityName,
              requestId,
              timestamp: new Date().toISOString(),
              detail: {
                code: "policy-denied",
                message: err instanceof Error ? err.message : String(err),
                durationMs: Date.now() - start,
              },
            };
            return;
          }
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
   * B5-B6 review R2 — resolve the permission-request carriers from the
   * host-supplied provider, filtering out undefined fields so the
   * object spread into `authorize()` only contains keys the host
   * actually knows about. Kept private so the executor stays the
   * single caller site.
   */
  private snapshotPermissionCarriers(): {
    sessionUuid?: string;
    turnUuid?: string;
    traceUuid?: string;
  } {
    const provider = this.options?.permissionContextProvider;
    if (!provider) return {};
    let carriers: {
      sessionUuid?: string;
      turnUuid?: string;
      traceUuid?: string;
    };
    try {
      carriers = provider() ?? {};
    } catch {
      // Carrier threading must never break the permission path.
      return {};
    }
    const out: { sessionUuid?: string; turnUuid?: string; traceUuid?: string } = {};
    if (typeof carriers.sessionUuid === "string" && carriers.sessionUuid.length > 0) {
      out.sessionUuid = carriers.sessionUuid;
    }
    if (typeof carriers.turnUuid === "string" && carriers.turnUuid.length > 0) {
      out.turnUuid = carriers.turnUuid;
    }
    if (typeof carriers.traceUuid === "string" && carriers.traceUuid.length > 0) {
      out.traceUuid = carriers.traceUuid;
    }
    return out;
  }

  /**
   * Cancel an in-flight execution by requestId.
   *
   * No-op if the requestId is unknown or already completed.
   */
  cancel(requestId: string): boolean {
    const controller = this.activeExecutions.get(requestId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
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
