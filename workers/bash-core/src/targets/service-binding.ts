/**
 * Service Binding Execution Target
 *
 * Target handler that routes execution through an injectable
 * `ServiceBindingTransport`. The transport is the seam where a real
 * Cloudflare service-binding RPC lives in production; in tests we
 * inject a fake transport that simulates the
 * request → progress* → response → cancel roundtrip.
 *
 * This target satisfies both the `TargetHandler.execute()` and
 * `StreamingTargetHandler.executeStreaming()` contracts so the
 * executor can weave progress events through when the transport
 * supplies them.
 *
 * When no transport is supplied the target returns `not-connected`
 * (the original stub behaviour) and continues to respect
 * `AbortSignal` for pre-aborted calls.
 */

import {
  buildToolCallCancelBody,
  buildToolCallRequest,
  parseToolCallResponse,
} from "../tool-call.js";
import type {
  ToolCallRequestBody,
  ToolCallResponseBody,
} from "../tool-call.js";
import type { CapabilityPlan } from "../types.js";
import type { CapabilityResult } from "../result.js";
import type {
  ProgressEmit,
  StreamingTargetHandler,
} from "../executor.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Transport seam
// ═══════════════════════════════════════════════════════════════════

/**
 * A single progress frame delivered by the transport during a
 * request → response roundtrip. Matches the `tool.call.progress`
 * NACP message shape without taking a hard dependency on `nacp-core`.
 */
export interface ServiceBindingProgressFrame {
  readonly toolName: string;
  readonly chunk: string;
  readonly isFinal: boolean;
}

/**
 * Input handed to a `ServiceBindingTransport.call()`. Carries the
 * `tool.call.request` body, the plan's capability name, a
 * `requestId` (for cancel correlation), the caller's `AbortSignal`
 * (for server-side cancel observation), and an optional progress
 * emitter the transport can use to push `tool.call.progress` frames.
 */
export interface ServiceBindingCallInput {
  readonly requestId: string;
  readonly capabilityName: string;
  readonly body: ToolCallRequestBody;
  readonly signal?: AbortSignal;
  readonly onProgress?: (frame: ServiceBindingProgressFrame) => void;
}

/**
 * Input handed to a `ServiceBindingTransport.cancel()` — always a
 * `tool.call.cancel` body plus the `requestId` being cancelled.
 */
export interface ServiceBindingCancelInput {
  readonly requestId: string;
  readonly body: { readonly reason?: string };
}

/**
 * Transport seam for service-binding execution. Production wiring
 * wraps a Cloudflare service-binding RPC (`env.TOOLRUNNER.fetch(...)`
 * or similar); tests substitute a fake transport that records and/or
 * simulates roundtrips.
 */
export interface ServiceBindingTransport {
  call(input: ServiceBindingCallInput): Promise<ToolCallResponseBody>;
  cancel?(input: ServiceBindingCancelInput): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — ServiceBindingTarget
// ═══════════════════════════════════════════════════════════════════

export class ServiceBindingTarget implements StreamingTargetHandler {
  constructor(private readonly transport?: ServiceBindingTransport) {}

  /**
   * Non-streaming entry. Delegates to `executeStreaming()` with a
   * no-op progress sink.
   */
  async execute(
    plan: CapabilityPlan,
    signal?: AbortSignal,
  ): Promise<CapabilityResult> {
    return this.executeStreaming(plan, () => undefined, signal);
  }

  async executeStreaming(
    plan: CapabilityPlan,
    emit: ProgressEmit,
    signal?: AbortSignal,
  ): Promise<CapabilityResult> {
    if (signal?.aborted) {
      return this.cancelledResult(plan);
    }

    if (!this.transport) {
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId: this.makeRequestId(),
        error: {
          code: "not-connected",
          message:
            "service-binding target not connected — remote execution is not yet available",
        },
        durationMs: 0,
      };
    }

    const requestId = this.makeRequestId();
    const request = buildToolCallRequest(plan);

    // Forward cancel to the transport so the remote side can stop
    // producing progress / response frames.
    const onAbort = async (): Promise<void> => {
      if (this.transport?.cancel) {
        try {
          await this.transport.cancel({
            requestId,
            body: buildToolCallCancelBody("cancelled by caller"),
          });
        } catch {
          // A transport cancel failure must not convert a successful
          // abort into an execution-error — the AbortSignal path is
          // authoritative.
        }
      }
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      const response = await this.transport.call({
        requestId,
        capabilityName: plan.capabilityName,
        body: request,
        signal,
        onProgress: (frame) => {
          emit({
            chunk: frame.chunk,
            note: frame.isFinal ? "final" : undefined,
          });
        },
      });

      if (signal?.aborted) {
        return this.cancelledResult(plan, requestId);
      }

      // parseToolCallResponse() synthesises "unknown" / random ids on
      // the parsed result; patch them with the real plan + requestId
      // before handing the result back to the executor.
      const parsed = parseToolCallResponse(response);
      return {
        ...parsed,
        capabilityName: plan.capabilityName,
        requestId,
      };
    } catch (err) {
      if (signal?.aborted) {
        return this.cancelledResult(plan, requestId);
      }
      return {
        kind: "error",
        capabilityName: plan.capabilityName,
        requestId,
        error: {
          code: "transport-error",
          message: err instanceof Error ? err.message : String(err),
        },
        durationMs: 0,
      };
    }
  }

  // ── Internal helpers ──

  private makeRequestId(): string {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-sb`;
  }

  private cancelledResult(
    plan: CapabilityPlan,
    requestId?: string,
  ): CapabilityResult {
    return {
      kind: "cancelled",
      capabilityName: plan.capabilityName,
      requestId: requestId ?? this.makeRequestId(),
      error: {
        code: "cancelled",
        message: `Capability "${plan.capabilityName}" was cancelled`,
      },
      durationMs: 0,
    };
  }
}
