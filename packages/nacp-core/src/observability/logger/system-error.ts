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
  let result: { delivered?: boolean; reason?: string } | void;
  try {
    result = await input.emit(frame);
  } catch (error) {
    if (input.fallbackNotify) {
      await input.fallbackNotify({
        kind: "system.notify",
        severity: "error",
        message: frame.error.message,
        code: frame.error.code,
        trace_uuid: frame.trace_uuid,
      });
      return { emitted: true, delivered: false, reason: "fallback-notify" };
    }
    return {
      emitted: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (input.fallbackNotify && (input.dualEmitSystemNotifyError ?? DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR)) {
    await input.fallbackNotify({
      kind: "system.notify",
      severity: "error",
      message: frame.error.message,
      code: frame.error.code,
      trace_uuid: frame.trace_uuid,
    });
  }
  return {
    emitted: true,
    delivered: result?.delivered,
    reason: result?.reason,
  };
}
