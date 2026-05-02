// HPX5 P1-01 — emit seam helpers.
//
// Single emit出口 for HPX5/HPX6 new emitters (F1 confirmation, F2c todos,
// F4 model.fallback, future F9 runtime.update / F12 restore.completed /
// F14 item.*). Wraps zod validate + system.error fallback.
//
// Frozen contract:
//   * docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md §3.4
//   * docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md Q-bridging-6
//
// Two flavours:
//   * emitTopLevelFrame — for independent top-level frames whose
//     message_type is registered in SESSION_BODY_SCHEMAS but **not** in
//     SessionStreamEventBodySchema (confirmation/todos/runtime/restore/item).
//   * emitStreamEvent — for stream-event sub-kinds already in the
//     13-kind discriminated union (model.fallback, compact.notify, etc.).
//
// Existing emitters via OrchestrationDeps.pushStreamEvent are NOT
// migrated (HPX5 §6.1 取舍 6); the helpers here are the strict出口
// for new emitters only.

import { SESSION_BODY_SCHEMAS, type SessionMessageType } from "./messages.js";
import { SessionStreamEventBodySchema } from "./stream-event.js";

/**
 * Sink hook injected from session DO runtime-assembly.
 * Implementation lives in `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`.
 */
export interface EmitSink {
  /**
   * Emit a top-level WS frame (e.g. session.confirmation.request,
   * session.todos.write). The frame envelope/seq stamping is handled
   * by SessionWebSocketHelper; this sink only carries (message_type, body).
   */
  emitTopLevelFrame(messageType: string, body: Record<string, unknown>): void;

  /**
   * Emit a body that is a stream-event kind (e.g. model.fallback,
   * system.error). The sink wraps it as `session.stream.event` per
   * existing pushStreamEvent pathway.
   */
  emitStreamEvent(body: Record<string, unknown>): void;
}

export interface EmitContext {
  /** session_uuid for telemetry / log correlation. */
  sessionUuid: string;
  /** trace_uuid for cross-worker correlation (optional). */
  traceUuid?: string;
  /** source worker name for telemetry (default "orchestrator-core"). */
  sourceWorker?: string;
}

export type EmitResultStatus = "ok" | "fallback" | "drop";

export interface EmitResult {
  readonly status: EmitResultStatus;
  readonly latency_ms: number;
  readonly error?: { code: string; message: string };
}

export interface EmitObserver {
  /**
   * Optional latency / outcome telemetry hook. Wired to
   * `nano_emit_latency_ms` / `nano_emit_drop_total` metrics in production.
   */
  onEmit?: (
    metric: "latency" | "drop" | "fallback",
    fields: { messageType: string; latency_ms: number; sessionUuid: string; code?: string },
  ) => void;
}

function normalizeTopLevelBodyForValidation(
  messageType: string,
  body: unknown,
): unknown {
  if (
    messageType === "session.confirmation.request" &&
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { confirmation_kind?: unknown }).confirmation_kind === "string"
  ) {
    const { confirmation_kind, ...rest } = body as Record<string, unknown>;
    return { ...rest, kind: confirmation_kind };
  }
  return body;
}

/**
 * Emit a top-level frame. Validates body against
 * SESSION_BODY_SCHEMAS[messageType]; on validation failure emits a
 * SystemErrorKind via emitStreamEvent and returns status=fallback.
 *
 * NEVER throws — emit failures must surface as system.error so the
 * client can react. Drop is reserved for the unrecoverable case where
 * even system.error fallback fails.
 */
export function emitTopLevelFrame(
  sink: EmitSink,
  messageType: SessionMessageType | string,
  body: unknown,
  ctx: EmitContext,
  observer?: EmitObserver,
): EmitResult {
  const start = nowMs();
  const schema = (SESSION_BODY_SCHEMAS as Record<string, { safeParse(b: unknown): { success: boolean; error?: { message: string } } }>)[messageType];
  if (!schema) {
    return fallback(
      sink,
      ctx,
      observer,
      messageType,
      "NACP_UNKNOWN_MESSAGE_TYPE",
      "validation",
      `unknown message_type ${messageType}`,
      start,
    );
  }
  const parsed = schema.safeParse(normalizeTopLevelBodyForValidation(messageType, body));
  if (!parsed.success) {
    return fallback(
      sink,
      ctx,
      observer,
      messageType,
      "NACP_VALIDATION_FAILED",
      "validation",
      parsed.error?.message ?? "body schema validation failed",
      start,
    );
  }
  try {
    sink.emitTopLevelFrame(messageType, body as Record<string, unknown>);
  } catch (err) {
    return fallback(
      sink,
      ctx,
      observer,
      messageType,
      "NACP_BINDING_UNAVAILABLE",
      "transient",
      err instanceof Error ? err.message : "emit sink threw",
      start,
    );
  }
  const latency = nowMs() - start;
  observer?.onEmit?.("latency", { messageType, latency_ms: latency, sessionUuid: ctx.sessionUuid });
  return { status: "ok", latency_ms: latency };
}

/**
 * Emit a stream-event sub-kind body. Validates against
 * SessionStreamEventBodySchema. Use this for model.fallback /
 * compact.notify / etc. that already live in the 13-kind union.
 */
export function emitStreamEvent(
  sink: EmitSink,
  body: unknown,
  ctx: EmitContext,
  observer?: EmitObserver,
): EmitResult {
  const start = nowMs();
  const parsed = SessionStreamEventBodySchema.safeParse(body);
  if (!parsed.success) {
    // Stream-event body invalid — try to surface as system.error too,
    // but mark drop if the body itself is the system.error frame (avoid
    // infinite recursion).
    const kind = (body as { kind?: string } | undefined)?.kind;
    if (kind === "system.error") {
      const latency = nowMs() - start;
      observer?.onEmit?.("drop", {
        messageType: "session.stream.event",
        latency_ms: latency,
        sessionUuid: ctx.sessionUuid,
        code: "NACP_VALIDATION_FAILED",
      });
      return {
        status: "drop",
        latency_ms: latency,
        error: { code: "NACP_VALIDATION_FAILED", message: "system.error body invalid; cannot fall back" },
      };
    }
    return fallbackStreamEvent(
      sink,
      ctx,
      observer,
      "NACP_VALIDATION_FAILED",
      "validation",
      parsed.error?.message ?? "stream-event body schema validation failed",
      start,
      kind ?? "unknown",
    );
  }
  try {
    sink.emitStreamEvent(body as Record<string, unknown>);
  } catch (err) {
    return fallbackStreamEvent(
      sink,
      ctx,
      observer,
      "NACP_BINDING_UNAVAILABLE",
      "transient",
      err instanceof Error ? err.message : "emit sink threw",
      start,
      (body as { kind?: string } | undefined)?.kind ?? "unknown",
    );
  }
  const latency = nowMs() - start;
  observer?.onEmit?.("latency", {
    messageType: "session.stream.event",
    latency_ms: latency,
    sessionUuid: ctx.sessionUuid,
  });
  return { status: "ok", latency_ms: latency };
}

// ── internal helpers ──

function fallback(
  sink: EmitSink,
  ctx: EmitContext,
  observer: EmitObserver | undefined,
  messageType: string,
  code: string,
  category: "validation" | "transient" | "dependency" | "permanent" | "security" | "quota" | "conflict",
  message: string,
  start: number,
): EmitResult {
  const sysError: Record<string, unknown> = {
    kind: "system.error",
    error: {
      code,
      category,
      message,
      retryable: category === "transient" || category === "dependency" || category === "quota",
      detail: { failed_message_type: messageType },
    },
    source_worker: ctx.sourceWorker ?? "orchestrator-core",
    ...(ctx.traceUuid !== undefined ? { trace_uuid: ctx.traceUuid } : {}),
  };
  try {
    sink.emitStreamEvent(sysError);
  } catch {
    const latency = nowMs() - start;
    observer?.onEmit?.("drop", { messageType, latency_ms: latency, sessionUuid: ctx.sessionUuid, code });
    return { status: "drop", latency_ms: latency, error: { code, message } };
  }
  const latency = nowMs() - start;
  observer?.onEmit?.("fallback", { messageType, latency_ms: latency, sessionUuid: ctx.sessionUuid, code });
  return { status: "fallback", latency_ms: latency, error: { code, message } };
}

function fallbackStreamEvent(
  sink: EmitSink,
  ctx: EmitContext,
  observer: EmitObserver | undefined,
  code: string,
  category: "validation" | "transient" | "dependency" | "permanent" | "security" | "quota" | "conflict",
  message: string,
  start: number,
  origKind: string,
): EmitResult {
  return fallback(sink, ctx, observer, `session.stream.event/${origKind}`, code, category, message, start);
}

function nowMs(): number {
  // performance.now is available in Workers/V8 isolates; fall back to Date.
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf?.now ? perf.now() : Date.now();
}
