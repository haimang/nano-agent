/**
 * Time-windowed LRU dedupe for log records.
 *
 * Used to suppress error storms (RHX2 design §6.2 risk #1): the same
 * `(level, code, trace_uuid)` triple emitted within `windowMs` is not
 * re-persisted. `critical` records are exempt — see `shouldEmit`.
 *
 * Capacity-bounded so the dedupe map cannot grow unboundedly; oldest
 * entries are evicted when the cap is hit.
 */

export interface DedupeOptions {
  /** Default 5_000 ms. */
  windowMs?: number;
  /** Default 256 entries. */
  capacity?: number;
  /** Test seam. Defaults to `() => Date.now()`. */
  now?: () => number;
}

export class DedupeCache {
  private readonly windowMs: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly seenAt = new Map<string, number>();

  constructor(opts: DedupeOptions = {}) {
    this.windowMs = opts.windowMs ?? 5_000;
    this.capacity = opts.capacity ?? 256;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Returns `true` if the given key has not been seen within the dedupe
   * window (so caller should emit). When `true` is returned, the cache
   * records the timestamp atomically. `critical` records bypass dedupe
   * by passing `force=true`.
   */
  shouldEmit(key: string, force = false): boolean {
    if (force) return true;
    const t = this.now();
    const last = this.seenAt.get(key);
    if (last !== undefined && t - last < this.windowMs) {
      return false;
    }
    // LRU touch: re-insert at the end so eviction targets the oldest.
    this.seenAt.delete(key);
    this.seenAt.set(key, t);
    if (this.seenAt.size > this.capacity) {
      const oldest = this.seenAt.keys().next().value;
      if (oldest !== undefined) this.seenAt.delete(oldest);
    }
    return true;
  }

  size(): number {
    return this.seenAt.size;
  }
}

export function buildDedupeKey(
  level: string,
  code: string | undefined,
  traceUuid: string | undefined,
): string {
  return `${level}|${code ?? "_"}|${traceUuid ?? "_"}`;
}
