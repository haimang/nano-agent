import {
  NacpErrorSchema,
  resolveErrorMeta,
  type NacpError,
} from "../../error-registry.js";
import { getTraceContext } from "./als.js";
import { DedupeCache } from "./dedupe.js";

export interface SystemErrorEvent {
  readonly kind: "system.error";
  readonly error: NacpError;
  readonly source_worker?: string;
  readonly trace_uuid?: string;
}

export interface SystemErrorFallbackNotify {
  readonly kind: "system.notify";
  readonly severity: "error";
  readonly message: string;
  readonly code?: string;
  readonly trace_uuid?: string;
}

export const DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true;

export interface TryEmitSystemErrorInput {
  readonly code: string;
  readonly source_worker: string;
  readonly message?: string;
  readonly detail?: Record<string, unknown>;
  readonly trace_uuid?: string;
  readonly dedupe?: DedupeCache;
  readonly critical?: boolean;
  readonly emit: (
    frame: SystemErrorEvent,
  ) => Promise<{ delivered?: boolean; reason?: string } | void> | { delivered?: boolean; reason?: string } | void;
  readonly fallbackNotify?: (payload: SystemErrorFallbackNotify) => Promise<void> | void;
  readonly dualEmitSystemNotifyError?: boolean;
}

export function buildSystemErrorEvent(input: Omit<TryEmitSystemErrorInput, "dedupe" | "emit" | "fallbackNotify">): SystemErrorEvent {
  const trace = getTraceContext();
  const meta = resolveErrorMeta(input.code);
  const error: NacpError = {
    code: input.code,
    category: meta?.category ?? "transient",
    message: input.message ?? meta?.message ?? input.code,
    ...(input.detail ? { detail: input.detail } : {}),
    retryable: meta?.retryable ?? true,
  };
  const parsed = NacpErrorSchema.parse(error);
  return {
    kind: "system.error",
    error: parsed,
    source_worker: input.source_worker,
    trace_uuid: input.trace_uuid ?? trace?.trace_uuid,
  };
}

export async function tryEmitSystemError(input: TryEmitSystemErrorInput): Promise<{
  readonly emitted: boolean;
  readonly deduped?: boolean;
  readonly delivered?: boolean;
  readonly reason?: string;
}> {
  const frame = buildSystemErrorEvent(input);
  const key = `${frame.trace_uuid ?? "_"}|${frame.error.code}|${frame.source_worker ?? "_"}`;
  if (input.dedupe && !input.critical && !input.dedupe.shouldEmit(key, false)) {
    return { emitted: false, deduped: true };
  }
  const fallbackPayload: SystemErrorFallbackNotify = {
    kind: "system.notify",
    severity: "error",
    message: frame.error.message,
    code: frame.error.code,
    trace_uuid: frame.trace_uuid,
  };
  let result: { delivered?: boolean; reason?: string } | void;
  try {
    result = await input.emit(frame);
  } catch (error) {
    if (input.fallbackNotify) {
      // RHX2 review-of-reviews fix (GPT R5): isolate fallback notify
      // exception so a fallback failure does not surface as the primary
      // emit error.
      try {
        await input.fallbackNotify(fallbackPayload);
        return { emitted: true, delivered: false, reason: "fallback-notify" };
      } catch (fallbackError) {
        const primary = error instanceof Error ? error.message : String(error);
        const secondary =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        return {
          emitted: false,
          delivered: false,
          reason: `emit-and-fallback-failed: ${primary}; ${secondary}`,
        };
      }
    }
    return {
      emitted: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  // RHX2 review-of-reviews fix (GPT R5): primary emit already succeeded;
  // dual-notify is best-effort, never allowed to pollute the success
  // result with a thrown exception.
  if (input.fallbackNotify && (input.dualEmitSystemNotifyError ?? DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR)) {
    try {
      await input.fallbackNotify(fallbackPayload);
    } catch (fallbackError) {
      const reason =
        fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return {
        emitted: true,
        delivered: result?.delivered,
        reason: `dual-notify-failed: ${reason}`,
      };
    }
  }
  return {
    emitted: true,
    delivered: result?.delivered,
    reason: result?.reason,
  };
}
