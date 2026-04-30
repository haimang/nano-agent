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
  readonly fallbackNotify?: (payload: {
    readonly kind: "system.notify";
    readonly severity: "error";
    readonly message: string;
  }) => Promise<void> | void;
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
  try {
    const result = await input.emit(frame);
    return {
      emitted: true,
      delivered: result?.delivered,
      reason: result?.reason,
    };
  } catch (error) {
    if (input.fallbackNotify) {
      await input.fallbackNotify({
        kind: "system.notify",
        severity: "error",
        message: frame.error.message,
      });
      return { emitted: true, delivered: false, reason: "fallback-notify" };
    }
    return {
      emitted: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
