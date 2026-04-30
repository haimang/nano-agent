/**
 * Storage Topology — KvAdapter
 *
 * Per-binding wrapper around a Workers KV namespace.
 *
 * Source findings (B1 Round 1 real Cloudflare probe):
 *   - F03 (`docs/spikes/spike-do-storage/03-…`): same-colo read-after-
 *     write was strong in the Round 1 reconnaissance probe (40/40 fresh).
 *     **Caveat C3 (B1-final-closure §Caveats)**: weak evidence — only
 *     same-colo, default `cacheTtl`, 40-sample baseline. Cross-colo
 *     freshness has NOT been validated. Cloudflare publicly documents a
 *     ~60 s eventual consistency window. Consumers MUST treat KV reads
 *     as "possibly stale" until B7 Round 2 confirms or refutes.
 *   - unexpected-F02 (`docs/spikes/unexpected/F02-…`): KV write latency
 *     ~520 ms ≈ 170× KV read. Hot-path call sites should prefer
 *     `putAsync` (fire-and-forget with `ctx.waitUntil`).
 *
 * Tenant prefixing is orthogonal — see `nacp-core` `tenantKv*` helpers.
 */

import { createLogger } from "@haimang/nacp-core/logger";
import { ValueTooLargeError } from "../errors.js";

const logger = createLogger("filesystem-core");

// ═══════════════════════════════════════════════════════════════════
// §1 — Decoupled KV binding type
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal Workers KV namespace binding — structurally compatible with
 * Cloudflare's `KVNamespace`. Same decoupling pattern as
 * `@haimang/nacp-core`'s `KVNamespaceLike`.
 */
export interface KVNamespaceBinding {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Subset of a Workers `ExecutionContext` used by `putAsync` to register
 * the fire-and-forget write so the worker stays alive until KV commits.
 */
export interface KvPutAsyncContext {
  waitUntil(promise: Promise<unknown>): void;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — KvAdapter
// ═══════════════════════════════════════════════════════════════════

/**
 * Production-shaped wrapper around a KV namespace binding.
 *
 * - `put` is the safe sync write (~520 ms latency); throws
 *   `ValueTooLargeError` when the encoded byte length exceeds
 *   `maxValueBytes`.
 * - `putAsync` is the hot-path fire-and-forget path; size check and
 *   retry happen up-front, then the actual write is registered with
 *   `ctx.waitUntil` (when an `ExecutionContext` is supplied).
 */
export class KvAdapter {
  /**
   * Cloudflare KV per-value cap is 25 MiB (per public docs). Adapter
   * mirrors that. Override via constructor for testing.
   */
  readonly maxValueBytes: number;

  private readonly kv: KVNamespaceBinding;

  constructor(kv: KVNamespaceBinding, opts?: { maxValueBytes?: number }) {
    this.kv = kv;
    this.maxValueBytes = opts?.maxValueBytes ?? 25 * 1024 * 1024;
  }

  /**
   * Read a value. Returns `null` if the key does not exist.
   *
   * Per F03 caveat C3: same-colo strong; cross-colo NOT yet validated.
   */
  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  /**
   * Synchronous put. Awaits KV commit (~520 ms; see unexpected-F02).
   * Throws `ValueTooLargeError` when the value exceeds `maxValueBytes`.
   */
  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): Promise<void> {
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "kv");
    }
    await this.kv.put(key, value, options);
  }

  /** Delete a key. */
  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  /**
   * Fire-and-forget write. Use for hot-path writes where the request
   * cannot tolerate the ~520 ms KV write latency and dropping the write
   * on isolated worker failure is acceptable.
   *
   * Behavior:
   *   - Size check is synchronous (throws `ValueTooLargeError` before
   *     dispatch — matches `put` failure mode).
   *   - The actual write is dispatched immediately; failures are logged
   *     to `logger.warn` but NOT thrown to the caller.
   *   - When `ctx.waitUntil` is provided, the write is registered so
   *     the worker stays alive until KV commits. Without `ctx`, the
   *     write may be cancelled when the request completes — caller
   *     accepts that risk.
   */
  putAsync(
    key: string,
    value: string,
    ctx?: KvPutAsyncContext,
    options?: { expirationTtl?: number; metadata?: unknown },
  ): void {
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "kv");
    }
    const writePromise = this.kv.put(key, value, options).catch((err) => {
      logger.warn("kv-put-async-failed", {
        code: "internal-error",
        ctx: {
          key,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    });
    ctx?.waitUntil(writePromise);
  }
}
