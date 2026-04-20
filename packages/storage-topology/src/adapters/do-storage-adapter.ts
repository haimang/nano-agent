/**
 * Storage Topology — DOStorageAdapter
 *
 * Per-binding wrapper around a Durable Object's `state.storage`.
 *
 * Source findings (B1 Round 1 real Cloudflare probe):
 *   - F04 (`docs/spikes/spike-do-storage/04-…`): three transactional
 *     scenarios confirmed — single-key write, multi-key write, throw →
 *     rollback. Visibility holds.
 *   - F05 (`docs/spikes/spike-do-storage/05-…`): basic K/V parity with
 *     MemoryBackend confirmed; size is the first real divergence.
 *   - F08 (`docs/spikes/spike-do-storage/08-…`): per-value cap is
 *     somewhere in the 1 MiB – 10 MiB range (`SQLITE_TOOBIG` at 10 MiB,
 *     1 MiB succeeded in 45 ms). Round 2 binary-search probe will
 *     tighten this. Default cap is conservative 1 MiB.
 *
 * Tenant prefixing is orthogonal — see `nacp-core` `tenantDoStorage*`
 * helpers.
 */

import { ValueTooLargeError } from "../errors.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Decoupled DO storage binding types
// ═══════════════════════════════════════════════════════════════════

/** Subset of `DurableObjectListOptions` exposed by this adapter. */
export interface DOListOptions {
  start?: string;
  end?: string;
  prefix?: string;
  reverse?: boolean;
  limit?: number;
}

/**
 * Subset of Cloudflare's `DurableObjectTransaction`. Same shape as the
 * outer storage object minus `transaction()` itself.
 */
export interface DurableObjectTransactionLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  list<T = unknown>(options?: DOListOptions): Promise<Map<string, T>>;
  rollback?(): void;
}

/**
 * Minimal Durable Object storage binding — structurally compatible
 * with Cloudflare's `DurableObjectStorage`. Same decoupling pattern as
 * `@nano-agent/nacp-core`'s `DoStorageLike`.
 */
export interface DurableObjectStorageBinding {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(key: string): Promise<boolean>;
  delete(keys: string[]): Promise<number>;
  list<T = unknown>(options?: DOListOptions): Promise<Map<string, T>>;
  transaction<T>(
    callback: (tx: DurableObjectTransactionLike) => Promise<T>,
  ): Promise<T>;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — DOStorageAdapter
// ═══════════════════════════════════════════════════════════════════

/** Default conservative cap for DO storage put — 1 MiB. */
const DEFAULT_DO_MAX_VALUE_BYTES = 1 * 1024 * 1024;

/**
 * Production-shaped wrapper around a Durable Object's
 * `state.storage`.
 *
 * - `put` enforces `maxValueBytes` (default 1 MiB conservative per
 *   F08). Throws `ValueTooLargeError` BEFORE the call reaches DO so
 *   callers can route oversized blobs to R2 instead.
 * - `transaction` exposes the F04-confirmed transactional semantics
 *   directly — throw inside the callback rolls back.
 *
 * The 1 MiB default is deliberately conservative; B7 Round 2 will run a
 * binary-search probe to find the real cap (likely 2-4 MiB based on
 * F08 observation). Workspace owners may bump the cap via the
 * `maxValueBytes` constructor option if their workload tolerates the
 * SQLITE_TOOBIG risk.
 */
export class DOStorageAdapter {
  readonly maxValueBytes: number;

  private readonly storage: DurableObjectStorageBinding;

  constructor(
    storage: DurableObjectStorageBinding,
    opts?: { maxValueBytes?: number },
  ) {
    this.storage = storage;
    this.maxValueBytes = opts?.maxValueBytes ?? DEFAULT_DO_MAX_VALUE_BYTES;
  }

  /** Read a single value. Returns `undefined` if the key is missing. */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key);
  }

  /** Read many values at once. Returns a Map of key → value. */
  async getMany<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    return this.storage.get<T>(keys);
  }

  /**
   * Write a single value. Throws `ValueTooLargeError` BEFORE the
   * underlying put when the encoded byte length exceeds
   * `maxValueBytes` — this is the F08 size pre-check that prevents
   * `SQLITE_TOOBIG` reaching production.
   */
  async put(key: string, value: unknown): Promise<void> {
    const bytes = estimateBytes(value);
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "do");
    }
    await this.storage.put(key, value);
  }

  /**
   * Write many entries at once. Each entry is size-checked
   * individually so a single oversized value rejects the whole batch
   * with `ValueTooLargeError`.
   */
  async putMany(entries: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(entries)) {
      const bytes = estimateBytes(value);
      if (bytes > this.maxValueBytes) {
        throw new ValueTooLargeError(bytes, this.maxValueBytes, "do");
      }
      void key;
    }
    await this.storage.put(entries);
  }

  /** Delete a key. Returns `true` if the key existed and was deleted. */
  async delete(key: string): Promise<boolean> {
    return this.storage.delete(key);
  }

  /** Delete many keys at once. Returns the number of keys deleted. */
  async deleteMany(keys: string[]): Promise<number> {
    return this.storage.delete(keys);
  }

  /** List keys (and values) under a prefix or range. */
  async list<T = unknown>(options?: DOListOptions): Promise<Map<string, T>> {
    return this.storage.list<T>(options);
  }

  /**
   * Atomic transaction — per F04, throw inside the callback rolls
   * back; return value resolves the outer promise.
   *
   * Use this for cross-key atomicity in DO storage. For D1, use
   * `D1Adapter.batch()` instead — D1 does NOT support `BEGIN/COMMIT`
   * (per F06).
   *
   * Size pre-check is NOT applied to writes inside the transaction
   * callback because the callback receives a raw transaction object;
   * callers wanting size checks within a transaction should branch on
   * `bytes > adapter.maxValueBytes` themselves before calling
   * `tx.put`.
   */
  async transaction<T>(
    callback: (tx: DurableObjectTransactionLike) => Promise<T>,
  ): Promise<T> {
    return this.storage.transaction(callback);
  }
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Best-effort byte-length estimate for an arbitrary DO storage value.
 *
 * The DO runtime uses structured-clone serialization, so the wire size
 * of a JS object differs from `JSON.stringify(...).length`. This
 * estimate is a conservative upper bound for the F08 pre-check —
 * strings and binary buffers are exact, structured objects fall back
 * to `JSON.stringify` byte length (which over-counts compared to
 * structured-clone but never under-counts for typical JSON-shaped
 * values). Cyclic / non-serializable values return `Infinity` so the
 * cap rejects them rather than crashing.
 */
function estimateBytes(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") {
    return new TextEncoder().encode(value).byteLength;
  }
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === "number" || typeof value === "boolean") return 8;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
