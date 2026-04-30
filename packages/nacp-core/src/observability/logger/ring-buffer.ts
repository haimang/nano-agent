/**
 * Bounded ring buffer for the most recent LogRecords (per worker
 * instance). Read by `Logger.recentErrors()` and surfaced to operators
 * via `GET /debug/recent-errors` (added in Phase 6 / P6-01).
 *
 * The buffer is in-memory: it survives within a single Worker instance
 * but is cleared whenever Cloudflare cycles the instance. That is the
 * intended trade-off — durable persistence goes through D1
 * (`nano_error_log`, P1-03 / P5).
 */

export class RingBuffer<T> {
  private readonly storage: T[];
  private nextWriteIndex = 0;
  private filled = 0;

  constructor(public readonly capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
    this.storage = new Array<T>(capacity);
  }

  push(item: T): void {
    this.storage[this.nextWriteIndex] = item;
    this.nextWriteIndex = (this.nextWriteIndex + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
  }

  /** Return the most recent `limit` items, newest-first. */
  takeRecent(limit?: number): T[] {
    const want = Math.min(limit ?? this.filled, this.filled);
    if (want <= 0) return [];
    const result: T[] = new Array<T>(want);
    // Walk backwards from the most recently written slot.
    let idx = (this.nextWriteIndex - 1 + this.capacity) % this.capacity;
    for (let i = 0; i < want; i += 1) {
      result[i] = this.storage[idx]!;
      idx = (idx - 1 + this.capacity) % this.capacity;
    }
    return result;
  }

  size(): number {
    return this.filled;
  }
}
