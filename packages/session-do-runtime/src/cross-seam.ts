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

/**
 * @deprecated Import propagation truth from `@nano-agent/nacp-core`.
 */
export {
  CROSS_SEAM_HEADERS,
  buildCrossSeamHeaders,
  readCrossSeamHeaders,
  validateCrossSeamAnchor,
} from "@nano-agent/nacp-core";
/**
 * @deprecated Import propagation truth from `@nano-agent/nacp-core`.
 */
export type { CrossSeamAnchor } from "@nano-agent/nacp-core";

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
