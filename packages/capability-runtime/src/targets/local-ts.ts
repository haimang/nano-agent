/**
 * Local TypeScript Execution Target
 *
 * Runs capability handlers in-process as plain TypeScript functions.
 * This is the primary target for the minimal command pack.
 *
 * Handlers receive an optional `AbortSignal` and are expected to respect
 * cancellation. The target itself checks `signal.aborted` both before
 * and after invoking the handler and returns a `cancelled` result in
 * that case.
 */

import type { CapabilityPlan } from "../types.js";
import type { CapabilityResult } from "../result.js";
import type { TargetHandler } from "../executor.js";

/** Signature for a local capability handler function. */
export type LocalCapabilityHandler = (
  input: unknown,
  signal?: AbortSignal,
) => Promise<{ output: string; sizeBytes?: number }>;

/**
 * LocalTsTarget dispatches capability plans to registered in-process
 * TypeScript handler functions.
 */
export class LocalTsTarget implements TargetHandler {
  private handlers = new Map<string, LocalCapabilityHandler>();

  /** Register a handler for a named capability. */
  registerHandler(name: string, handler: LocalCapabilityHandler): void {
    this.handlers.set(name, handler);
  }

  /** Check if a handler is registered for the given capability name. */
  hasHandler(name: string): boolean {
    return this.handlers.has(name);
  }

  async execute(
    plan: CapabilityPlan,
    signal?: AbortSignal,
  ): Promise<CapabilityResult> {
    const handler = this.handlers.get(plan.capabilityName);
    if (!handler) {
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId: generateRequestId(),
        error: {
          code: "no-handler",
          message: `No local handler registered for "${plan.capabilityName}"`,
        },
        durationMs: 0,
      };
    }

    // Check for already-aborted signal before any work.
    if (signal?.aborted) {
      return cancelledResult(plan.capabilityName);
    }

    try {
      const result = await handler(plan.input, signal);

      // If the handler completed but the signal was aborted mid-flight,
      // treat the outcome as cancelled — we cannot trust partial output.
      if (signal?.aborted) {
        return cancelledResult(plan.capabilityName);
      }

      const sizeBytes =
        result.sizeBytes ?? new TextEncoder().encode(result.output).byteLength;

      return {
        kind: "inline",
        capabilityName: plan.capabilityName,
        requestId: generateRequestId(),
        output: result.output,
        outputSizeBytes: sizeBytes,
        durationMs: 0,
      };
    } catch (err) {
      if (signal?.aborted) {
        return cancelledResult(plan.capabilityName);
      }
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId: generateRequestId(),
        error: {
          code: "handler-error",
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: 0,
      };
    }
  }
}

function cancelledResult(capabilityName: string): CapabilityResult {
  return {
    kind: "cancelled",
    capabilityName,
    requestId: generateRequestId(),
    error: {
      code: "cancelled",
      message: `Capability "${capabilityName}" was cancelled`,
    },
    durationMs: 0,
  };
}

let _reqCounter = 0;
function generateRequestId(): string {
  return `req-${Date.now()}-${++_reqCounter}`;
}
