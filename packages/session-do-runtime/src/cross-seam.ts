/**
 * Cross-seam propagation + failure law (A5 Phase 4).
 *
 * Three concerns shared by every v1 external seam (hook / capability /
 * fake-provider):
 *
 *  1. **Propagation** — every cross-worker call must carry the same
 *     trace + tenant + request anchor so trace-first observability
 *     stays continuous across the boundary. `buildCrossSeamHeaders`
 *     produces the headers + body envelope all transports stamp on.
 *
 *  2. **Failure taxonomy** — every seam reports failures using the
 *     same five reasons so consumers (and dashboards) can reason
 *     about external boundaries with one vocabulary instead of three
 *     bespoke enums. The taxonomy mirrors the
 *     `TraceRecoveryReason`/`HookRuntimeFailureReason` style already
 *     in use elsewhere.
 *
 *  3. **Startup queue** — early events that arrive before the binding
 *     finishes wiring are buffered, replayed on `markReady()`, and
 *     surfaced on `drop()` so they never silently vanish.
 */

// ─────────────────────────────────────────────────────────────────────
// Propagation
// ─────────────────────────────────────────────────────────────────────

/**
 * The minimum set of identity carriers every cross-seam call must
 * thread. Header names mirror NACP wire-level snake_case so a Worker
 * receiving the call can read them with no translation.
 */
export interface CrossSeamAnchor {
  readonly traceUuid: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly requestUuid: string;
  readonly sourceRole?: string;
  readonly sourceKey?: string;
  /** Optional client-supplied deadline in ms-since-epoch. */
  readonly deadlineMs?: number;
}

/** Standard HTTP headers stamped on every cross-seam request. */
export const CROSS_SEAM_HEADERS = {
  trace: "x-nacp-trace-uuid",
  session: "x-nacp-session-uuid",
  team: "x-nacp-team-uuid",
  request: "x-nacp-request-uuid",
  sourceRole: "x-nacp-source-role",
  sourceKey: "x-nacp-source-key",
  deadline: "x-nacp-deadline-ms",
} as const;

/**
 * Build a `Headers`-shaped record from a `CrossSeamAnchor`. The
 * record is intentionally a plain object (not a `Headers`) so it can
 * be merged into existing `RequestInit.headers` without losing fields.
 */
export function buildCrossSeamHeaders(
  anchor: CrossSeamAnchor,
): Record<string, string> {
  const out: Record<string, string> = {
    [CROSS_SEAM_HEADERS.trace]: anchor.traceUuid,
    [CROSS_SEAM_HEADERS.session]: anchor.sessionUuid,
    [CROSS_SEAM_HEADERS.team]: anchor.teamUuid,
    [CROSS_SEAM_HEADERS.request]: anchor.requestUuid,
  };
  if (anchor.sourceRole) out[CROSS_SEAM_HEADERS.sourceRole] = anchor.sourceRole;
  if (anchor.sourceKey) out[CROSS_SEAM_HEADERS.sourceKey] = anchor.sourceKey;
  if (anchor.deadlineMs !== undefined) {
    out[CROSS_SEAM_HEADERS.deadline] = String(anchor.deadlineMs);
  }
  return out;
}

/** Read a `CrossSeamAnchor` back out of an HTTP `Headers`-like object. */
export function readCrossSeamHeaders(
  headers: { get(name: string): string | null },
): Partial<CrossSeamAnchor> {
  const get = (k: string) => headers.get(k) ?? undefined;
  const deadlineRaw = get(CROSS_SEAM_HEADERS.deadline);
  const draft: {
    -readonly [K in keyof CrossSeamAnchor]?: CrossSeamAnchor[K];
  } = {};
  const traceUuid = get(CROSS_SEAM_HEADERS.trace);
  if (traceUuid) draft.traceUuid = traceUuid;
  const sessionUuid = get(CROSS_SEAM_HEADERS.session);
  if (sessionUuid) draft.sessionUuid = sessionUuid;
  const teamUuid = get(CROSS_SEAM_HEADERS.team);
  if (teamUuid) draft.teamUuid = teamUuid;
  const requestUuid = get(CROSS_SEAM_HEADERS.request);
  if (requestUuid) draft.requestUuid = requestUuid;
  const sourceRole = get(CROSS_SEAM_HEADERS.sourceRole);
  if (sourceRole) draft.sourceRole = sourceRole;
  const sourceKey = get(CROSS_SEAM_HEADERS.sourceKey);
  if (sourceKey) draft.sourceKey = sourceKey;
  if (deadlineRaw) {
    const v = Number(deadlineRaw);
    if (Number.isFinite(v)) draft.deadlineMs = v;
  }
  return draft;
}

/**
 * Validate that an anchor carries the load-bearing fields. Returns the
 * list of missing fields so callers can either reject the call or
 * surface a typed `not-ready` failure rather than passing a broken
 * anchor downstream.
 */
export function validateCrossSeamAnchor(
  anchor: Partial<CrossSeamAnchor>,
): readonly (keyof CrossSeamAnchor)[] {
  const missing: (keyof CrossSeamAnchor)[] = [];
  if (!anchor.traceUuid) missing.push("traceUuid");
  if (!anchor.sessionUuid) missing.push("sessionUuid");
  if (!anchor.teamUuid) missing.push("teamUuid");
  if (!anchor.requestUuid) missing.push("requestUuid");
  return missing;
}

// ─────────────────────────────────────────────────────────────────────
// Failure taxonomy
// ─────────────────────────────────────────────────────────────────────

/**
 * Five-way taxonomy used by every v1 external seam. Mirrors the
 * `TraceRecoveryReason` style: closed set, no `unknown` bucket.
 */
export type CrossSeamFailureReason =
  | "not-connected"
  | "transport-error"
  | "timeout"
  | "cancelled"
  | "not-ready";

export const CROSS_SEAM_FAILURE_REASONS: readonly CrossSeamFailureReason[] = [
  "not-connected",
  "transport-error",
  "timeout",
  "cancelled",
  "not-ready",
];

export class CrossSeamError extends Error {
  readonly reason: CrossSeamFailureReason;
  readonly seam: "hook" | "capability" | "provider";
  readonly detail?: Record<string, unknown>;
  constructor(
    seam: "hook" | "capability" | "provider",
    reason: CrossSeamFailureReason,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CrossSeamError";
    this.reason = reason;
    this.seam = seam;
    this.detail = detail;
  }
}

/**
 * Translate seam-specific runtime errors back to the unified taxonomy.
 *
 * Recognises these shapes:
 *   - `HookRuntimeError` from `@nano-agent/hooks`
 *   - capability `not-connected` / `transport-error` `CapabilityResult`
 *     errors (passed in as a plain object with `code` + `message`)
 *   - generic `Error` instances (default → `transport-error`)
 *   - already-`CrossSeamError` (rethrown unchanged)
 */
export function classifySeamError(
  seam: "hook" | "capability" | "provider",
  err: unknown,
): CrossSeamError {
  if (err instanceof CrossSeamError) return err;
  if (err && typeof err === "object") {
    const reason = (err as { reason?: unknown }).reason;
    if (
      typeof reason === "string" &&
      (CROSS_SEAM_FAILURE_REASONS as readonly string[]).includes(reason)
    ) {
      return new CrossSeamError(
        seam,
        reason as CrossSeamFailureReason,
        err instanceof Error ? err.message : String((err as { message?: string }).message ?? reason),
      );
    }
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code === "not-connected") {
      return new CrossSeamError(seam, "not-connected", code);
    }
    if (typeof code === "string" && code === "cancelled") {
      return new CrossSeamError(seam, "cancelled", code);
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new CrossSeamError(seam, "transport-error", msg);
}

// ─────────────────────────────────────────────────────────────────────
// Startup queue
// ─────────────────────────────────────────────────────────────────────

/**
 * Buffers events until the underlying seam signals `markReady()`. Once
 * ready, queued events are flushed in FIFO order through `flush()`.
 *
 * Use case: edge / trace events that fire before the eval sink has
 * finished wiring. Without this queue the events would silently vanish;
 * with it they either replay cleanly or — if `drop()` is called instead
 * — reach the caller as a typed `not-ready` failure.
 */
export class StartupQueue<T> {
  private buffer: T[] = [];
  private ready = false;
  private dropped = false;
  /** Capacity guard so a stuck binding cannot grow the queue forever. */
  private readonly maxSize: number;

  constructor(maxSize = 256) {
    this.maxSize = Math.max(1, maxSize);
  }

  /** Enqueue an event. Throws `not-ready` if the queue was already drained as dropped. */
  enqueue(event: T): void {
    if (this.dropped) {
      throw new CrossSeamError(
        "provider",
        "not-ready",
        "startup queue dropped — binding was never marked ready",
      );
    }
    if (this.ready) {
      throw new Error(
        "StartupQueue.enqueue() called after markReady — call the destination directly",
      );
    }
    if (this.buffer.length >= this.maxSize) {
      throw new CrossSeamError(
        "provider",
        "not-ready",
        `startup queue full at ${this.maxSize} events`,
      );
    }
    this.buffer.push(event);
  }

  /** True when the queue has not yet been marked ready or dropped. */
  get isBuffering(): boolean {
    return !this.ready && !this.dropped;
  }

  /** Number of events currently buffered. */
  get size(): number {
    return this.buffer.length;
  }

  /** Mark ready and synchronously flush all buffered events through `consumer`. */
  markReady(consumer: (event: T) => void | Promise<void>): Promise<void> {
    this.ready = true;
    return this.replay(consumer);
  }

  /**
   * Replay queued events through `consumer`. Returns once every event
   * has been awaited so callers can fail-fast on a downstream throw.
   */
  private async replay(
    consumer: (event: T) => void | Promise<void>,
  ): Promise<void> {
    const drained = this.buffer.splice(0, this.buffer.length);
    for (const event of drained) {
      await consumer(event);
    }
  }

  /** Drop all buffered events and refuse future enqueues. Returns the dropped events for logging. */
  drop(): T[] {
    this.dropped = true;
    const drained = this.buffer.splice(0, this.buffer.length);
    return drained;
  }
}
