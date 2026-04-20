/**
 * Storage Topology — R2Adapter
 *
 * Per-binding wrapper around an R2 bucket.
 *
 * Source findings (B1 Round 1 real Cloudflare probe):
 *   - F01 (`docs/spikes/spike-do-storage/01-…`): single-call `put` covers
 *     ≤ 10 MiB in wrangler 4.83.0 runtime — no explicit multipart API.
 *   - F02 (`docs/spikes/spike-do-storage/02-…`): list MUST walk cursor;
 *     50 keys + limit=20 returned 20 + `truncated=true` + cursor on page 1.
 *   - unexpected-F01 (`docs/spikes/unexpected/F01-…`): per-call put
 *     overhead ≈ 273 ms — use `putParallel` for bulk writes.
 *
 * Tenant prefixing (`tenants/{teamUuid}/…`) is orthogonal: this adapter
 * treats `key` as already-final; callers that need tenant scoping should
 * compose this adapter with `nacp-core`'s `tenant*` helpers.
 */

import type { R2ObjectLike } from "./scoped-io.js";
import { ValueTooLargeError } from "../errors.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Decoupled R2 types
// ═══════════════════════════════════════════════════════════════════

/** R2 body shape returned by `get()`. Structurally a subset of `R2ObjectBody`. */
export interface R2ObjectBodyLike extends R2ObjectLike {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Single-page list result as returned by Cloudflare R2's `bucket.list()`. */
export interface R2ListResult {
  readonly objects: readonly R2ObjectLike[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

/**
 * Minimal R2 bucket binding — structurally compatible with
 * Cloudflare's `R2Bucket`. Same decoupling pattern as
 * `@nano-agent/nacp-core`'s `R2BucketLike`.
 */
export interface R2BucketBinding {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream | null,
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<R2ListResult>;
  delete(key: string | string[]): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — R2Adapter
// ═══════════════════════════════════════════════════════════════════

/**
 * Production-shaped wrapper around an R2 bucket binding.
 *
 * - `put` enforces `maxValueBytes` (default 100 MiB, conservative until
 *   B7 round-2 large-blob probe confirms or adjusts).
 * - `list` exposes the native cursor shape (v2 per F02).
 * - `listAll` walks the cursor automatically.
 * - `putParallel` amortizes the ~273 ms per-call overhead
 *   (unexpected-F01).
 */
export class R2Adapter {
  /**
   * Conservative default 100 MiB per object. Single-call put confirmed
   * ≤ 10 MiB (F01); the higher cap here is a soft guard against runaway
   * writes rather than a tested limit. Revisit after B7 round-2 large
   * probe.
   */
  readonly maxValueBytes: number;

  private readonly bucket: R2BucketBinding;

  constructor(bucket: R2BucketBinding, opts?: { maxValueBytes?: number }) {
    this.bucket = bucket;
    this.maxValueBytes = opts?.maxValueBytes ?? 100 * 1024 * 1024;
  }

  /** Read an object; returns `null` if the key does not exist. */
  async get(key: string): Promise<R2ObjectBodyLike | null> {
    return this.bucket.get(key);
  }

  /** Head an object; returns `null` if the key does not exist. */
  async head(key: string): Promise<R2ObjectLike | null> {
    return this.bucket.head(key);
  }

  /**
   * Write an object. Throws `ValueTooLargeError` when the encoded byte
   * length exceeds `maxValueBytes`. `null` and `ReadableStream` bodies
   * skip size estimation (streams have unknown length up-front).
   */
  async put(
    key: string,
    body: ArrayBuffer | ArrayBufferView | string | ReadableStream | null,
  ): Promise<void> {
    const bytes = estimateBytes(body);
    if (bytes !== undefined && bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "r2");
    }
    await this.bucket.put(key, body);
  }

  /** Delete one or many keys. */
  async delete(key: string | string[]): Promise<void> {
    await this.bucket.delete(key);
  }

  /**
   * Single-page list. Per `ScopedStorageAdapter` v2 shape: returns
   * `{ objects, truncated, cursor? }`. Caller MUST pass the returned
   * `cursor` back via `opts.cursor` to walk subsequent pages, or the
   * enumeration silently loses keys beyond the first page (F02).
   */
  async list(
    prefix: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{
    objects: R2ObjectLike[];
    truncated: boolean;
    cursor?: string;
  }> {
    const result = await this.bucket.list({
      prefix,
      limit: opts?.limit,
      cursor: opts?.cursor,
    });
    const objects = [...result.objects];
    if (result.truncated && result.cursor) {
      return { objects, truncated: true, cursor: result.cursor };
    }
    return { objects, truncated: result.truncated };
  }

  /**
   * Walk the cursor automatically until `truncated === false`. Returns
   * the aggregated objects from all pages. Guards against infinite
   * cursor loops with a hard cap on page count.
   */
  async listAll(
    prefix: string,
    opts?: { limit?: number; maxPages?: number },
  ): Promise<R2ObjectLike[]> {
    const maxPages = opts?.maxPages ?? 1000;
    const all: R2ObjectLike[] = [];
    let cursor: string | undefined;
    let page = 0;
    do {
      const result = await this.list(prefix, { limit: opts?.limit, cursor });
      all.push(...result.objects);
      cursor = result.truncated ? result.cursor : undefined;
      page += 1;
    } while (cursor && page < maxPages);
    return all;
  }

  /**
   * Parallel put (per unexpected-F01 motivation: 50 sequential puts
   * took 13.67 s ≈ 273 ms/call; the bottleneck is per-call overhead).
   * Writes are dispatched in batches of `concurrency` (default 10) with
   * `Promise.all` within each batch, ensuring each underlying `put` still
   * enforces `maxValueBytes`.
   */
  async putParallel(
    items: Array<{
      key: string;
      body: ArrayBuffer | ArrayBufferView | string | ReadableStream | null;
    }>,
    opts?: { concurrency?: number },
  ): Promise<void> {
    const concurrency = Math.max(1, opts?.concurrency ?? 10);
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      await Promise.all(batch.map((item) => this.put(item.key, item.body)));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Estimate the byte length of an R2-writeable body. Returns `undefined`
 * for bodies whose size cannot be cheaply computed up-front
 * (`ReadableStream`, `null`) — the caller then skips size pre-check and
 * relies on the underlying R2 error if the actual body is too large.
 */
function estimateBytes(
  body: ArrayBuffer | ArrayBufferView | string | ReadableStream | null,
): number | undefined {
  if (body === null) return 0;
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  return undefined;
}
