/**
 * Storage Topology — Scoped Storage Adapter Interface (v2)
 *
 * Thin adapter types that align with `@haimang/nacp-core`'s
 * tenant-scoped I/O helpers (`tenantR2Put/Get/Head/List/Delete`,
 * `tenantKvGet/Put/Delete`, `tenantDoStorageGet/Put/Delete`). This
 * module does not re-implement storage operations — it provides typed
 * wrappers that topology consumers can program against while the
 * platform layer injects the real implementation at runtime.
 *
 * Every operation takes a `teamUuid`: the adapter is the single point
 * where tenant prefixing is enforced, so higher layers never need to
 * remember the `tenants/{team_uuid}/…` convention themselves.
 *
 * ── v2.0.0 changes (after-foundations B2 writeback; see
 * `docs/rfc/scoped-storage-adapter-v2.md`) ──
 *
 *   - **BREAKING** `r2List(teamUuid, prefix, opts?)` now returns
 *     `{ objects, truncated, cursor? }` instead of `{ keys, truncated }`.
 *     Driven by `docs/spikes/spike-do-storage/02-…` (F02 — 50 keys
 *     + limit=20 requires 3 cursor pages).
 *   - JSDoc annotations added per F01 (R2 ≤ 10 MiB single-call),
 *     F03 (KV freshness locality caveat), F08 (DO storage 1-10 MiB
 *     SQLITE_TOOBIG; per-adapter `maxValueBytes` enforced on
 *     `DOStorageAdapter` class, NOT on this interface — different
 *     primitives have different caps).
 *   - The per-binding adapter classes (`R2Adapter`, `KvAdapter`,
 *     `D1Adapter`, `DOStorageAdapter`, all in sibling files) are
 *     orthogonal to this facade — they take a single binding in their
 *     constructor and expose primitive-specific methods. Tenant
 *     prefixing is not their concern; consumers should compose them
 *     with `nacp-core`'s `tenant*` helpers or with a thin
 *     ScopedStorageAdapter shim.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — R2ObjectLike (decoupled CF type)
// ═══════════════════════════════════════════════════════════════════

/**
 * Minimal R2 object descriptor — structurally compatible with
 * Cloudflare's `R2Object`. We avoid depending on `@cloudflare/workers-types`
 * here so the package stays transport-agnostic (same pattern as
 * `nacp-core`'s `R2BucketLike`).
 */
export interface R2ObjectLike {
  readonly key: string;
  readonly size: number;
  readonly etag?: string;
  readonly uploaded?: Date;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — ScopedStorageAdapter
// ═══════════════════════════════════════════════════════════════════

/**
 * A storage adapter scoped to a specific execution context.
 *
 * - `do*` operations target the current Durable Object instance but
 *   require an explicit `teamUuid` so the adapter can key the value
 *   under the same `tenants/{teamUuid}/{relativeKey}` path used by
 *   `tenantDoStoragePut/Get/Delete`.
 * - `kv*` / `r2*` operations require an explicit `teamUuid` for tenant
 *   isolation, matching the corresponding `tenantKv*` / `tenantR2*`
 *   helper signatures.
 *
 * Implementations enforcing a size cap (e.g. the production DO adapter)
 * throw `ValueTooLargeError` on `doPut` / `kvPut` / `r2Put` when the
 * encoded byte length exceeds the adapter's internal `maxValueBytes`.
 * This interface intentionally does NOT expose `maxValueBytes` because
 * different underlying primitives have different caps (DO ≈ 1 MiB,
 * KV ≈ 25 MiB, R2 ≈ 100 MiB configured); consumers who need the cap
 * should read it off the concrete per-binding adapter class instead.
 */
export interface ScopedStorageAdapter {
  // ── Durable Object transactional storage ──

  /**
   * Read a value from DO transactional storage (tenant-scoped).
   *
   * Per spike-do-storage-F04: DO transactional semantics hold — a
   * value written inside a rolled-back `transaction()` is not visible
   * to subsequent `doGet`.
   */
  doGet(teamUuid: string, key: string): Promise<unknown>;

  /**
   * Write a value to DO transactional storage (tenant-scoped).
   *
   * Per spike-do-storage-F08: the production DO storage enforces a
   * per-value cap somewhere in the 1 MiB – 10 MiB range
   * (`SQLITE_TOOBIG`). Production implementations SHOULD throw
   * `ValueTooLargeError` before the call reaches DO so callers can
   * route oversized blobs to R2 instead.
   */
  doPut(teamUuid: string, key: string, value: unknown): Promise<void>;

  /** Delete a value from DO transactional storage (tenant-scoped). */
  doDelete(teamUuid: string, key: string): Promise<boolean>;

  // ── Workers KV (warm tier) ──

  /**
   * Read a value from Workers KV (tenant-scoped).
   *
   * Per spike-do-storage-F03: same-colo read-after-write was strong in
   * Round 1 (40/40 fresh), **but cross-colo freshness has NOT been
   * validated** and Cloudflare publicly documents a 60 s eventual
   * consistency window. Consumers that need strong freshness across
   * regions MUST treat `kvGet` as "possibly stale" until B7 Round 2
   * confirms or refutes cross-colo behavior.
   */
  kvGet(teamUuid: string, key: string): Promise<unknown>;

  /**
   * Write a value to Workers KV (tenant-scoped).
   *
   * Per spike-do-storage unexpected-F02: KV write latency ~520 ms
   * (≈170× KV read). Hot-path call sites should use `KvAdapter.putAsync`
   * (fire-and-forget with `ctx.waitUntil`) instead of blocking on the
   * sync write here.
   */
  kvPut(teamUuid: string, key: string, value: unknown): Promise<void>;

  /** Delete a value from Workers KV (tenant-scoped). */
  kvDelete(teamUuid: string, key: string): Promise<void>;

  // ── R2 (cold tier) ──

  /** Read an object from R2 (tenant-scoped). */
  r2Get(teamUuid: string, key: string): Promise<unknown>;

  /**
   * Write an object to R2 (tenant-scoped).
   *
   * Per spike-do-storage-F01: single-call put covers ≤ 10 MiB in the
   * wrangler 4.83.0 runtime — the binding chunks internally, no
   * explicit multipart API needed. >10 MiB is a B7 follow-up (see
   * `docs/spikes/spike-do-storage/01-…`).
   *
   * Per unexpected-F01: per-call put overhead is ~273 ms; use
   * `R2Adapter.putParallel` for bulk writes to amortize overhead.
   */
  r2Put(teamUuid: string, key: string, value: unknown): Promise<void>;

  /** Delete an object from R2 (tenant-scoped). */
  r2Delete(teamUuid: string, key: string): Promise<void>;

  /**
   * List R2 objects under a tenant-scoped prefix. Returned keys include
   * the `tenants/{teamUuid}/` prefix so callers see the same shape that
   * `tenantR2List` produces.
   *
   * **BREAKING v2 shape** (per spike-do-storage-F02): returns
   * `{ objects, truncated, cursor? }`. If `truncated === true` the
   * caller MUST pass the returned `cursor` back via `opts.cursor` on
   * the next call, or the enumeration silently loses keys beyond the
   * first page. See `R2Adapter.listAll(prefix)` for an auto-walk helper.
   */
  r2List(
    teamUuid: string,
    prefix?: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{
    objects: R2ObjectLike[];
    truncated: boolean;
    cursor?: string;
  }>;
}

// ═══════════════════════════════════════════════════════════════════
// §3 — Null Adapter (testing / placeholder)
// ═══════════════════════════════════════════════════════════════════

import { StorageNotConnectedError } from "../errors.js";

/**
 * A no-op adapter that throws on every operation. Useful as a default
 * before the real platform adapter is injected.
 *
 * Upgraded in v2.0.0 to:
 *   - throw typed `StorageNotConnectedError` (was plain `Error`);
 *   - expose the v2 `r2List` return shape (`objects` / `truncated` /
 *     `cursor?`) so downstream type checks match the production shape.
 */
export class NullStorageAdapter implements ScopedStorageAdapter {
  async doGet(_teamUuid: string, _key: string): Promise<unknown> {
    throw new StorageNotConnectedError("doGet", "NullStorageAdapter");
  }

  async doPut(_teamUuid: string, _key: string, _value: unknown): Promise<void> {
    throw new StorageNotConnectedError("doPut", "NullStorageAdapter");
  }

  async doDelete(_teamUuid: string, _key: string): Promise<boolean> {
    throw new StorageNotConnectedError("doDelete", "NullStorageAdapter");
  }

  async kvGet(_teamUuid: string, _key: string): Promise<unknown> {
    throw new StorageNotConnectedError("kvGet", "NullStorageAdapter");
  }

  async kvPut(_teamUuid: string, _key: string, _value: unknown): Promise<void> {
    throw new StorageNotConnectedError("kvPut", "NullStorageAdapter");
  }

  async kvDelete(_teamUuid: string, _key: string): Promise<void> {
    throw new StorageNotConnectedError("kvDelete", "NullStorageAdapter");
  }

  async r2Get(_teamUuid: string, _key: string): Promise<unknown> {
    throw new StorageNotConnectedError("r2Get", "NullStorageAdapter");
  }

  async r2Put(_teamUuid: string, _key: string, _value: unknown): Promise<void> {
    throw new StorageNotConnectedError("r2Put", "NullStorageAdapter");
  }

  async r2Delete(_teamUuid: string, _key: string): Promise<void> {
    throw new StorageNotConnectedError("r2Delete", "NullStorageAdapter");
  }

  async r2List(
    _teamUuid: string,
    _prefix?: string,
    _opts?: { limit?: number; cursor?: string },
  ): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }> {
    throw new StorageNotConnectedError("r2List", "NullStorageAdapter");
  }
}
