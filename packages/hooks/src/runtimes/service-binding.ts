/**
 * @nano-agent/hooks — service-binding runtime (A5 Phase 2).
 *
 * Production-wired remote-hook runtime. The runtime owns no transport
 * details itself; it delegates to an injectable `HookTransport` so the
 * session-do-runtime assembler can plug in either:
 *
 *   1. a real Cloudflare service-binding RPC in deployed builds, or
 *   2. a fake worker fixture in tests / `wrangler dev` loops.
 *
 * The runtime mirrors the path the dispatcher uses locally:
 *   - it builds the same `hook.emit` body through `buildHookEmitBody`,
 *   - it expects a `hook.outcome` body back (parsed via
 *     `parseHookOutcomeBody`), and
 *   - it honours `AbortSignal` so the dispatcher's timeout guard can
 *     cancel a hung remote worker.
 *
 * Absence of a transport yields the pre-A5 behaviour (a clear
 * `not-connected` error), which the dispatcher maps into a `continue`
 * outcome with diagnostics rather than crashing the session.
 */

import type { HookHandlerConfig } from "../types.js";
import type { HookOutcome } from "../outcome.js";
import type { HookRuntime } from "./local-ts.js";
import { buildHookEmitBody, parseHookOutcomeBody } from "../core-mapping.js";

/**
 * Transport seam for delivering a hook `hook.emit` body to a remote
 * worker and returning the matching `hook.outcome` body. Kept minimal
 * so both real service-binding RPC and fake fixtures implement the
 * same shape.
 */
export interface HookTransport {
  /**
   * Send a `hook.emit` body and receive a `hook.outcome` body.
   *
   * @param input.handler   - config of the hook being dispatched
   * @param input.emitBody  - nacp-core `hook.emit` body for the handler
   * @param input.context   - optional invocation context
   * @param input.signal    - AbortSignal from the dispatcher timeout
   * @returns the `hook.outcome` body produced by the remote worker
   */
  call(input: HookTransportCall): Promise<HookTransportResult>;
}

export interface HookTransportCall {
  readonly handler: HookHandlerConfig;
  readonly emitBody: ReturnType<typeof buildHookEmitBody>;
  readonly context: unknown;
  readonly signal?: AbortSignal;
}

/** Shape returned by the transport — the `hook.outcome` body. */
export interface HookTransportResult {
  readonly body: unknown;
  readonly durationMs?: number;
}

/**
 * Failure reasons the runtime exposes when the transport is absent or
 * fails. Mirrors the taxonomy used by the capability seam so both
 * remote paths reject with the same vocabulary.
 */
export type HookRuntimeFailureReason =
  | "not-connected"
  | "transport-error"
  | "cancelled";

export class HookRuntimeError extends Error {
  readonly reason: HookRuntimeFailureReason;
  constructor(reason: HookRuntimeFailureReason, message: string) {
    super(message);
    this.name = "HookRuntimeError";
    this.reason = reason;
  }
}

export interface ServiceBindingRuntimeOptions {
  readonly transport?: HookTransport;
  /** Optional AbortSignal the dispatcher threads in via `context`. */
  readonly signalFromContext?: (context: unknown) => AbortSignal | undefined;
}

/**
 * Service-binding runtime for remote hook workers.
 *
 * When no transport is wired, `execute()` throws
 * `HookRuntimeError("not-connected", ...)`. The dispatcher's error
 * path then converts the throw into a `continue + diagnostics`
 * outcome, so a missing binding does not take down the session.
 */
export class ServiceBindingRuntime implements HookRuntime {
  private readonly transport?: HookTransport;
  private readonly signalFromContext?: (
    context: unknown,
  ) => AbortSignal | undefined;

  constructor(options: ServiceBindingRuntimeOptions = {}) {
    this.transport = options.transport;
    this.signalFromContext = options.signalFromContext;
  }

  async execute(
    handler: HookHandlerConfig,
    payload: unknown,
    context: unknown,
  ): Promise<HookOutcome> {
    if (!this.transport) {
      throw new HookRuntimeError(
        "not-connected",
        `service-binding runtime has no transport wired for handler '${handler.id}'`,
      );
    }

    const emitBody = buildHookEmitBody(handler.event, payload);
    const signal = this.signalFromContext?.(context);

    if (signal?.aborted) {
      throw new HookRuntimeError(
        "cancelled",
        `hook '${handler.id}' cancelled before transport call`,
      );
    }

    const startedAt = Date.now();
    try {
      const result = await this.transport.call({
        handler,
        emitBody,
        context,
        signal,
      });
      const durationMs = result.durationMs ?? Date.now() - startedAt;
      return parseHookOutcomeBody(result.body, {
        handlerId: handler.id,
        durationMs,
      });
    } catch (err) {
      if (signal?.aborted) {
        throw new HookRuntimeError(
          "cancelled",
          `hook '${handler.id}' cancelled during transport call`,
        );
      }
      if (err instanceof HookRuntimeError) throw err;
      throw new HookRuntimeError(
        "transport-error",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
