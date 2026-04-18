/**
 * Session DO Runtime — Trace Integration.
 *
 * Bridges eval-observability with Session DO lifecycle events.
 * Builds properly-shaped trace event objects that conform to
 * `TraceEventBase` from `@nano-agent/eval-observability` (A3 Phase 1).
 *
 * These are pure factory functions — they produce trace event objects
 * but do not emit them. The caller (SessionOrchestrator) is responsible
 * for passing them to `TraceSink.emit()`.
 *
 * Phase 2 (P2-03) alignment:
 *   - EventKind names follow the current session event reality:
 *     `turn.begin` / `turn.end`, not the legacy `turn.started / completed`.
 *   - Every builder requires a `TraceContext` that carries `traceUuid`
 *     and `sourceRole` so produced events are trace-law compliant.
 *   - `buildStepTrace` now maps kernel runtime `type` onto canonical
 *     event kinds (e.g. `turn.started -> turn.begin`, `turn.completed
 *     -> turn.end`) for the steps it observes.
 *
 * Reference: `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md`
 */

/**
 * Local mirror of the eval-observability shape. Kept structurally identical
 * to `@nano-agent/eval-observability`'s `TraceEvent` / `TraceSourceRole` so
 * session-do-runtime stays runtime-independent from the eval package. Tests
 * (devDep) may import the eval compliance helper to cross-check.
 */
export type TraceSourceRole =
  | "session"
  | "hook"
  | "skill"
  | "capability"
  | "ingress"
  | "client"
  | "platform";

export interface TraceEvent {
  readonly eventKind: string;
  readonly timestamp: string;
  readonly traceUuid: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly sourceRole: TraceSourceRole;
  readonly sourceKey?: string;
  readonly messageUuid?: string;
  readonly turnUuid?: string;
  readonly stepIndex?: number;
  readonly durationMs?: number;
  readonly audience: "internal" | "audit-only" | "client-visible";
  readonly layer: "live" | "durable-audit" | "durable-transcript";
  readonly error?: { readonly code: string; readonly message: string };
}

/**
 * Runtime-safe mirror of `@nano-agent/eval-observability::assertTraceLaw`.
 *
 * session-do-runtime stays dep-free from eval-observability at runtime
 * (A2-A3 review R1 + Kimi R2 discussion): the sink boundary enforcement
 * should work even when the package is built without the eval devDep.
 * A cross-check test (`test/traces.test.ts`) imports the eval helper
 * as a dev dependency to verify the mirror does not drift.
 */
export function assertTraceLaw(event: TraceEvent): void {
  if (!event || typeof event !== "object") {
    throw new Error("trace-law: event must be an object");
  }
  if (typeof event.traceUuid !== "string" || event.traceUuid.length === 0) {
    throw new Error("trace-law: traceUuid is required");
  }
  if (typeof event.sourceRole !== "string" || event.sourceRole.length === 0) {
    throw new Error("trace-law: sourceRole is required");
  }
  if (typeof event.sessionUuid !== "string" || event.sessionUuid.length === 0) {
    throw new Error("trace-law: sessionUuid is required");
  }
  if (typeof event.teamUuid !== "string" || event.teamUuid.length === 0) {
    throw new Error("trace-law: teamUuid is required");
  }
  if (typeof event.eventKind !== "string" || event.eventKind.length === 0) {
    throw new Error("trace-law: eventKind is required");
  }
  if (typeof event.timestamp !== "string" || event.timestamp.length === 0) {
    throw new Error("trace-law: timestamp is required");
  }
}

// ═══════════════════════════════════════════════════════════════════
// §1 — TraceDeps + TraceContext
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal dependency for trace emission.
 * The Session DO injects this from the eval subsystem handle.
 */
export interface TraceDeps {
  readonly emitTrace: (event: TraceEvent) => Promise<void>;
}

/**
 * Context every session-produced trace event needs. `sourceRole` is
 * required so the produced event is immediately trace-law compliant.
 * `sourceKey` is the matching NACP `producer_key`, when known.
 */
export interface TraceContext {
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly traceUuid: string;
  readonly sourceRole: TraceSourceRole;
  readonly sourceKey?: string;
  readonly messageUuid?: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Runtime step → canonical event kind map
// ═══════════════════════════════════════════════════════════════════

/**
 * Mapping from agent-runtime-kernel step types to canonical
 * eval-observability event kinds. Mirrors the session-stream-event
 * mapping in `packages/agent-runtime-kernel/src/events.ts` (P2-03).
 */
const STEP_KIND_MAP: Record<string, string> = {
  "turn.started": "turn.begin",
  "turn.completed": "turn.end",
  "llm.delta": "llm.delta",
  "tool.call.request": "tool.call.request",
  "tool.call.progress": "tool.call.progress",
  "tool.call.result": "tool.call.result",
  "hook.outcome": "hook.outcome",
  "hook.broadcast": "hook.broadcast",
  "compact.start": "compact.start",
  "compact.end": "compact.end",
  "compact.notify": "compact.notify",
  "session.start": "session.start",
  "session.end": "session.end",
  "api.request": "api.request",
  "api.response": "api.response",
  "api.error": "api.error",
};

export function mapRuntimeStepKindToTraceKind(rawKind: string): string {
  return STEP_KIND_MAP[rawKind] ?? rawKind;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Turn Begin Trace (was: buildTurnStartTrace)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a trace event for when a turn begins.
 *
 * Layer: `durable-audit` (implementation) / `anchor` (conceptual).
 * Audience: `internal`.
 *
 * Naming note: previously emitted `turn.started` to match the kernel
 * step type; A3 renames to the canonical `turn.begin` so session
 * trace events line up with both the registry and the session stream
 * event family.
 */
export function buildTurnBeginTrace(
  turnUuid: string,
  ctx: TraceContext,
): TraceEvent {
  return {
    eventKind: "turn.begin",
    timestamp: new Date().toISOString(),
    traceUuid: ctx.traceUuid,
    sessionUuid: ctx.sessionUuid,
    teamUuid: ctx.teamUuid,
    sourceRole: ctx.sourceRole,
    sourceKey: ctx.sourceKey,
    messageUuid: ctx.messageUuid,
    turnUuid,
    audience: "internal",
    layer: "durable-audit",
  };
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Turn End Trace (was: buildTurnEndTrace)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a trace event for when a turn ends.
 *
 * Includes `durationMs` so downstream analysis can measure turn latency.
 */
export function buildTurnEndTrace(
  turnUuid: string,
  durationMs: number,
  ctx: TraceContext,
): TraceEvent {
  return {
    eventKind: "turn.end",
    timestamp: new Date().toISOString(),
    traceUuid: ctx.traceUuid,
    sessionUuid: ctx.sessionUuid,
    teamUuid: ctx.teamUuid,
    sourceRole: ctx.sourceRole,
    sourceKey: ctx.sourceKey,
    messageUuid: ctx.messageUuid,
    turnUuid,
    durationMs,
    audience: "internal",
    layer: "durable-audit",
  };
}

// ═══════════════════════════════════════════════════════════════════
// §4b — Session End Trace (A2/A3 review R1)
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a trace event for session termination.
 *
 * Emits the canonical `session.end` kind (not `session.ended`) so the
 * downstream classification / durable-promotion registry accepts it as
 * an anchor event. `turnCount` is optional context: it lets audit
 * consumers correlate the session's lifecycle length without replaying
 * the full timeline.
 */
export function buildSessionEndTrace(
  ctx: TraceContext,
  turnCount?: number,
): TraceEvent {
  return {
    eventKind: "session.end",
    timestamp: new Date().toISOString(),
    traceUuid: ctx.traceUuid,
    sessionUuid: ctx.sessionUuid,
    teamUuid: ctx.teamUuid,
    sourceRole: ctx.sourceRole,
    sourceKey: ctx.sourceKey,
    messageUuid: ctx.messageUuid,
    stepIndex: typeof turnCount === "number" ? turnCount : undefined,
    audience: "internal",
    layer: "durable-audit",
  };
}

// ═══════════════════════════════════════════════════════════════════
// §5 — Step Trace
// ═══════════════════════════════════════════════════════════════════

/**
 * Build a trace event for a single kernel step.
 *
 * Wraps an arbitrary runtime event with session/team/trace context so
 * traces can be correlated across the observability pipeline. Runtime
 * kinds are mapped through {@link STEP_KIND_MAP} onto canonical trace
 * event kinds; unknown kinds fall through untouched so new kernel
 * events are never silently swallowed.
 */
export function buildStepTrace(
  event: unknown,
  ctx: TraceContext,
): TraceEvent {
  const evt = (event ?? {}) as Record<string, unknown>;
  const rawKind = typeof evt.type === "string" ? evt.type : "step";
  const eventKind = mapRuntimeStepKindToTraceKind(rawKind);
  return {
    eventKind,
    timestamp:
      typeof evt.timestamp === "string"
        ? evt.timestamp
        : new Date().toISOString(),
    traceUuid: ctx.traceUuid,
    sessionUuid: ctx.sessionUuid,
    teamUuid: ctx.teamUuid,
    sourceRole: ctx.sourceRole,
    sourceKey: ctx.sourceKey,
    messageUuid: ctx.messageUuid,
    turnUuid:
      typeof evt.turnId === "string"
        ? evt.turnId
        : typeof evt.turnUuid === "string"
          ? (evt.turnUuid as string)
          : undefined,
    stepIndex:
      typeof evt.stepIndex === "number" ? (evt.stepIndex as number) : undefined,
    audience: "internal",
    // Diagnostic by default; turn.begin / turn.end upgrade to durable-audit
    // when the caller uses the dedicated builders above.
    layer: "live",
  };
}
