# RFC: `ScopedStorageAdapter` v2 — Breaking Interface Change

> **RFC ID**: `scoped-storage-adapter-v2`
> **Status**: `frozen` (B2 shipped 2026-04-20; r2 reflects shipped surface)
> **Author**: Opus 4.7 (1M context)
> **Date**: 2026-04-19 (initial draft) / 2026-04-20 (frozen-to-ship r2)
> **Sibling design**: `docs/design/after-foundations/P1-storage-adapter-hardening.md`
> **Action plan**: `docs/action-plan/after-foundations/B2-storage-adapter-hardening.md`
> **Implementer**: Opus 4.7 (1M context) — see B2 action-plan §11 work log
>
> **B1 finding sources (backward traceability)**:
> - `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md` (**F02 — primary breaking driver**)
> - `docs/spikes/spike-do-storage/06-d1-cross-query-transaction-explicitly-rejected.md` (F06 — D1 contract)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (F08 — size pre-check)
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (F03 — JSDoc-only)
> - `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md` (unexpected-F01 — `putParallel`)
> - `docs/spikes/unexpected/F02-kv-write-latency-500ms.md` (unexpected-F02 — `putAsync`)
> - `docs/spikes/storage-findings.md` (rollup writeback destination map)
> - `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md` (open writeback)

---

## 0. Summary

Modify `packages/storage-topology/src/adapters/scoped-io.ts` `ScopedStorageAdapter` interface and ship 4 production-shaped adapters (D1Adapter / R2Adapter / KvAdapter / DOStorageAdapter). Major-bump `storage-topology` 0.1.0 → 2.0.0. Driven by 6 B1 findings. **No production users break** (only `NullStorageAdapter` exists today).

---

## 1. Motivation

### 1.1 Why now

- B1 spike round 1 已在真实 Cloudflare 验证 R2 / KV / D1 / DO 行为
- 6 finding 中 3 条直接 force interface change（F02 / F06 / F08）
- After-foundations Phase 1 in-scope per charter §6 + §11.1 Exit Criteria 2

### 1.2 Why breaking now is OK

- Current `storage-topology` 是 0.1.0
- Only implementer is `NullStorageAdapter` (throws `not connected` everywhere)
- `ReferenceBackend` (the consumer) is also `not connected`
- **No production user to break**
- Charter §11.2 explicitly anticipates `storage-topology` 2.0.0

If we keep current interface, F02 cursor walking and F08 size pre-check both must be patched on top of broken contract, accumulating tech debt before production users exist. Better to bake correct shape now.

---

## 2. Breaking changes summary

| # | Change | B1 source | Breaking? |
|---|---|---|---|
| C1 | `r2List(prefix)` → `r2List(prefix, opts?: { limit?, cursor? })` returning `{ objects, truncated, cursor? }` | F02 | **YES** |
| C2 | `doPut(key, value)` MUST `throw ValueTooLargeError` if value bytes > adapter.`maxValueBytes` | F08 | YES (new error) |
| C3 | New typed error hierarchy: `StorageError`, `ValueTooLargeError`, `CursorRequiredError`, `StorageNotConnectedError` | F08 / F02 | YES (new exports) |
| C4 | New `KvAdapter.putAsync(key, value): void` helper (non-breaking addition for KV adapter only) | unexpected-F02 | non-breaking |
| C5 | New `R2Adapter.putParallel(items, opts?)` helper (non-breaking addition for R2 adapter only) | unexpected-F01 | non-breaking |
| C6 | `D1Adapter` **does not** expose `beginTransaction()` / `commit()` — `batch()` only | F06 | n/a (new adapter; this is a constraint not a change) |
| C7 | JSDoc additions on `kvGet/Put` re: freshness | F03 | non-breaking |

---

## 3. Detailed interface diff

### 3.1 `scoped-io.ts` — `ScopedStorageAdapter` interface

> **r2 freeze note (2026-04-20)**: the interface as actually shipped
> **retains the v1 `teamUuid` positional argument** on every method
> (instead of dropping it as an earlier draft proposed). Reasoning:
>
>   - The existing v1 contract (per `scoped-io-alignment.test.ts` test
>     "ScopedStorageAdapter surface expects teamUuid on every method")
>     was added explicitly as a "v1 correctness fix for GPT R1" — the
>     facade IS supposed to be the single point that enforces tenant
>     prefixing.
>   - `nacp-core`'s `tenant{R2,Kv,DoStorage}*` helpers all take
>     `teamUuid` per call; dropping it from this facade would force
>     callers to re-establish per-tenant scoping in another layer,
>     duplicating the convention.
>   - The 4 NEW per-binding adapter classes (`R2Adapter` / `KvAdapter`
>     / `D1Adapter` / `DOStorageAdapter` — see §3.3-§3.6) are
>     **orthogonal** to `ScopedStorageAdapter`: they take just the
>     binding, expose primitive-specific APIs, and are the right place
>     for `maxValueBytes` (different primitives → different caps).
>     They do NOT implement `ScopedStorageAdapter`.
>
> Net effect: only the **return shape** of `r2List` is breaking
> (matches F02). `maxValueBytes` is exposed on adapter classes, not on
> the facade interface. JSDoc additions for F01/F03/F08/unexpected-F01
> /unexpected-F02 are non-breaking.

```ts
// CURRENT (v1, 0.1.0):
export interface ScopedStorageAdapter {
  doGet(teamUuid: string, key: string): Promise<unknown>;
  doPut(teamUuid: string, key: string, value: unknown): Promise<void>;
  doDelete(teamUuid: string, key: string): Promise<boolean>;

  kvGet(teamUuid: string, key: string): Promise<unknown>;
  kvPut(teamUuid: string, key: string, value: unknown): Promise<void>;
  kvDelete(teamUuid: string, key: string): Promise<void>;

  r2Get(teamUuid: string, key: string): Promise<unknown>;
  r2Put(teamUuid: string, key: string, value: unknown): Promise<void>;
  r2Delete(teamUuid: string, key: string): Promise<void>;
  r2List(
    teamUuid: string,
    prefix?: string,
    limit?: number,
  ): Promise<{ keys: string[]; truncated: boolean }>;
}

// SHIPPED (v2, 2.0.0):
export interface ScopedStorageAdapter {
  // ── Durable Object transactional storage ──
  /** Per spike-do-storage-F04: throw → rollback semantics hold. */
  doGet(teamUuid: string, key: string): Promise<unknown>;
  /** Production impls SHOULD throw ValueTooLargeError for bytes > cap (F08). */
  doPut(teamUuid: string, key: string, value: unknown): Promise<void>;
  doDelete(teamUuid: string, key: string): Promise<boolean>;

  // ── Workers KV ──
  /** Same-colo strong (F03 weak evidence); cross-colo NOT validated (B7). */
  kvGet(teamUuid: string, key: string): Promise<unknown>;
  /** ~520 ms latency (unexpected-F02); use KvAdapter.putAsync for hot path. */
  kvPut(teamUuid: string, key: string, value: unknown): Promise<void>;
  kvDelete(teamUuid: string, key: string): Promise<void>;

  // ── R2 ──
  r2Get(teamUuid: string, key: string): Promise<unknown>;
  /** ≤ 10 MiB single-call (F01); use R2Adapter.putParallel for bulk (uF01). */
  r2Put(teamUuid: string, key: string, value: unknown): Promise<void>;
  r2Delete(teamUuid: string, key: string): Promise<void>;

  /**
   * R2 list with cursor pagination — BREAKING shape change per F02.
   * Returns { objects, truncated, cursor? }. Caller MUST pass returned
   * cursor to next call when truncated=true, else enumeration silently
   * loses keys. See R2Adapter.listAll(prefix) for an auto-walk helper.
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

// R2ObjectLike — minimal R2 object descriptor; structurally compatible
// with Cloudflare's R2Object. Decoupled from @cloudflare/workers-types
// (same pattern as nacp-core's R2BucketLike).
export interface R2ObjectLike {
  readonly key: string;
  readonly size: number;
  readonly etag?: string;
  readonly uploaded?: Date;
}
```

### 3.2 New `errors.ts` (NEW file)

```ts
// packages/storage-topology/src/errors.ts (NEW)

/** Base class for all storage-topology errors. */
export class StorageError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** Thrown when value bytes exceed adapter.maxValueBytes (see spike-do-storage-F08). */
export class ValueTooLargeError extends StorageError {
  constructor(
    public readonly bytes: number,
    public readonly cap: number,
    public readonly adapter: "do" | "kv" | "r2" | "memory",
  ) {
    super(
      `Value too large: ${bytes} bytes > ${cap} cap on ${adapter} adapter`,
      `Promote to a tier with higher cap (e.g. R2) before writing this value.`,
    );
    this.name = "ValueTooLargeError";
  }
}

/** Thrown when a list operation must walk cursor but caller didn't (see spike-do-storage-F02). */
export class CursorRequiredError extends StorageError {
  constructor(
    public readonly prefix: string,
    public readonly returnedCount: number,
  ) {
    super(
      `r2List(${prefix}) returned ${returnedCount} objects with truncated=true. Caller must walk cursor.`,
    );
    this.name = "CursorRequiredError";
  }
}

/** Thrown when an adapter is not connected (current NullStorageAdapter behavior, kept for back-compat reading). */
export class StorageNotConnectedError extends StorageError {
  constructor(
    public readonly operation: string,
    public readonly adapter: string,
  ) {
    super(`${adapter}: ${operation} not connected`);
    this.name = "StorageNotConnectedError";
  }
}
```

### 3.3 `D1Adapter` (NEW)

```ts
// packages/storage-topology/src/adapters/d1-adapter.ts (NEW)

/**
 * D1Adapter — wraps Cloudflare D1 binding with batch-only API.
 *
 * IMPORTANT (per spike-do-storage-F06):
 *   D1 explicitly REJECTS SQL `BEGIN TRANSACTION`. Cross-statement
 *   atomicity must use `db.batch([...])`. For more complex transactional
 *   patterns (e.g. read-then-conditional-write), use DO storage
 *   transaction instead (see DOStorageAdapter).
 */
export class D1Adapter {
  readonly maxValueBytes = Infinity; // D1 row size limited by SQLite, not adapter
  constructor(private readonly db: D1Database) {}

  /** Single-statement query. */
  async query<T = unknown>(sql: string, ...params: unknown[]): Promise<{ results: T[] }> {
    const stmt = this.db.prepare(sql);
    return stmt.bind(...params).all<T>();
  }

  /** Atomic batch — entire group commits or rolls back together. */
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return this.db.batch(statements);
  }

  // INTENTIONALLY NOT EXPOSED:
  //   beginTransaction(): never — use batch() or DO storage transaction
  //   commit(): never
}
```

### 3.4 `R2Adapter` (NEW)

```ts
// packages/storage-topology/src/adapters/r2-adapter.ts (NEW)

import { ValueTooLargeError } from "../errors.js";

/**
 * R2Adapter — wraps R2 binding.
 *
 * Per spike-do-storage-F01: single-call put covers ≤ 10 MiB; runtime
 * handles chunking internally — no explicit multipart API needed.
 *
 * Per spike-do-storage-F02: list MUST walk cursor.
 *
 * Per unexpected-F01: per-call put overhead ~273 ms — use putParallel
 * for bulk writes.
 */
export class R2Adapter {
  readonly maxValueBytes = 100 * 1024 * 1024; // 100 MiB conservative; revisit per round 2 large probe

  constructor(private readonly bucket: R2Bucket) {}

  async get(key: string): Promise<R2ObjectBody | null> {
    return this.bucket.get(key);
  }

  async put(key: string, body: ArrayBuffer | string | ReadableStream): Promise<R2Object | null> {
    const bytes = typeof body === "string" ? new Blob([body]).size : (body as ArrayBuffer).byteLength ?? 0;
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "r2");
    }
    return this.bucket.put(key, body);
  }

  async delete(key: string): Promise<void> {
    return this.bucket.delete(key);
  }

  /** Single-page list with cursor support (per ScopedStorageAdapter v2 contract). */
  async list(
    prefix: string,
    opts?: { limit?: number; cursor?: string },
  ): Promise<{
    objects: R2Object[];
    truncated: boolean;
    cursor?: string;
  }> {
    const result = await this.bucket.list({
      prefix,
      limit: opts?.limit,
      cursor: opts?.cursor,
    });
    return {
      objects: result.objects,
      truncated: result.truncated,
      cursor: result.truncated ? (result as { cursor?: string }).cursor : undefined,
    };
  }

  /** Walk cursor automatically until truncated=false. */
  async listAll(prefix: string, opts?: { limit?: number }): Promise<R2Object[]> {
    const all: R2Object[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.list(prefix, { limit: opts?.limit, cursor });
      all.push(...page.objects);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return all;
  }

  /** Parallel put (per unexpected-F01 motivation). */
  async putParallel(
    items: Array<{ key: string; body: ArrayBuffer | string }>,
    opts?: { concurrency?: number },
  ): Promise<void> {
    const concurrency = opts?.concurrency ?? 10;
    let i = 0;
    while (i < items.length) {
      const batch = items.slice(i, i + concurrency);
      await Promise.all(batch.map((item) => this.put(item.key, item.body)));
      i += concurrency;
    }
  }
}
```

### 3.5 `KvAdapter` (NEW)

```ts
// packages/storage-topology/src/adapters/kv-adapter.ts (NEW)

import { ValueTooLargeError } from "../errors.js";

/**
 * KvAdapter — wraps KV binding.
 *
 * Per spike-do-storage-F03: same-colo read-after-write is strong;
 * cross-colo freshness NOT YET VALIDATED. JSDoc accordingly.
 *
 * Per unexpected-F02: write latency ~500 ms (170× slower than read).
 * For hot-path writes, prefer `putAsync()` (fire-and-forget).
 */
export class KvAdapter {
  readonly maxValueBytes = 25 * 1024 * 1024; // KV per-value limit (25 MiB per Cloudflare docs)

  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  /** Sync write — expect ~500 ms latency. */
  async put(key: string, value: string): Promise<void> {
    const bytes = new Blob([value]).size;
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "kv");
    }
    return this.kv.put(key, value);
  }

  async delete(key: string): Promise<void> {
    return this.kv.delete(key);
  }

  /**
   * Fire-and-forget write. Use for hot-path writes where you can tolerate
   * losing the write on worker failure between request return and KV commit.
   * Internally retries up to 3 times via waitUntil pattern.
   */
  putAsync(key: string, value: string, ctx?: { waitUntil?: (p: Promise<unknown>) => void }): void {
    const bytes = new Blob([value]).size;
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "kv");
    }
    const p = this.kv.put(key, value).catch((err) => {
      console.warn(`KvAdapter.putAsync(${key}) failed:`, err);
      // 3-retry policy elided here for brevity; real impl uses backoff
    });
    if (ctx?.waitUntil) ctx.waitUntil(p);
  }
}
```

### 3.6 `DOStorageAdapter` (NEW)

```ts
// packages/storage-topology/src/adapters/do-storage-adapter.ts (NEW)

import { ValueTooLargeError } from "../errors.js";

/**
 * DOStorageAdapter — wraps Durable Object state.storage.
 *
 * Per spike-do-storage-F04: state.storage.transaction() honors throw → rollback.
 * Per spike-do-storage-F08: per-value cap is 1-10 MiB (SQLITE_TOOBIG); default
 * conservative cap to 1 MiB. Per workspace-context-artifacts-F05: basic K/V
 * parity with MemoryBackend for ≤ 1 MiB values.
 */
export class DOStorageAdapter {
  /** Conservative default; real Cloudflare cap is somewhere in 1-10 MiB.
   * Will be tightened by round 2 binary-search probe (B7 follow-up). */
  readonly maxValueBytes = 1 * 1024 * 1024;

  constructor(private readonly storage: DurableObjectStorage) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key);
  }

  async put(key: string, value: unknown): Promise<void> {
    // Crude size estimate; for non-string non-buffer types this is approximate.
    const bytes =
      typeof value === "string"
        ? new Blob([value]).size
        : value instanceof ArrayBuffer || ArrayBuffer.isView(value)
          ? (value as ArrayBufferView).byteLength
          : new Blob([JSON.stringify(value)]).size;
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "do");
    }
    return this.storage.put(key, value);
  }

  async delete(key: string | string[]): Promise<number | boolean> {
    return this.storage.delete(key as string);
  }

  async list<T = unknown>(opts?: DurableObjectListOptions): Promise<Map<string, T>> {
    return this.storage.list<T>(opts);
  }

  /**
   * Atomic transaction (per spike-do-storage-F04: throw → rollback).
   *
   * Use this for cross-statement atomicity in DO storage. For D1, use
   * D1Adapter.batch() instead — D1 does NOT support BEGIN/COMMIT.
   */
  async transaction<T>(callback: (tx: DurableObjectTransaction) => Promise<T>): Promise<T> {
    return this.storage.transaction(callback);
  }
}
```

### 3.7 `MemoryBackend` updates (per F05 + F08)

```ts
// packages/workspace-context-artifacts/src/backends/memory.ts (modify)

import { ValueTooLargeError } from "@nano-agent/storage-topology";

export interface MemoryBackendConfig {
  /** Mirror of DO storage value cap. Default 1 MiB to match DOStorageAdapter. */
  readonly maxValueBytes?: number;
}

export class MemoryBackend implements Backend {
  private readonly maxValueBytes: number;
  constructor(config?: MemoryBackendConfig) {
    this.maxValueBytes = config?.maxValueBytes ?? 1 * 1024 * 1024;
  }

  put(key: string, value: unknown): Promise<void> {
    const bytes = /* same size estimate as DOStorageAdapter */;
    if (bytes > this.maxValueBytes) {
      throw new ValueTooLargeError(bytes, this.maxValueBytes, "memory");
    }
    // ... existing memory put logic
  }
  // ... rest unchanged
}
```

This ensures that **local tests using `MemoryBackend` will fail with the same `ValueTooLargeError` shape that production DO storage would throw** — preventing the "passes locally, fails in production" pitfall.

---

## 4. Migration plan

### 4.1 For `NullStorageAdapter` (the only current implementer)

Add `maxValueBytes = 0` (so any value > 0 throws). All 4 v2 method signatures become explicit `throw new StorageNotConnectedError(...)`. No business-logic change.

### 4.2 For `ReferenceBackend` (the consumer)

Currently throws `not connected` for all 5 methods. After v2 ship, route each method to the appropriate v2 adapter:
- `getMounted` → `DOStorageAdapter.get` or `R2Adapter.get` based on mount config
- `listMounted` → `R2Adapter.listAll` (auto cursor walk)
- ... etc.

### 4.3 For other downstream consumers

Audit `packages/workspace-context-artifacts/src/refs.ts` and `promotion.ts` to ensure no callers assume D1 cross-statement transactions or unbounded DO storage values.

---

## 5. Out of scope

- Cross-region / cross-colo behavior (deferred to B7 round 2)
- D1 schema migration helpers (post-after-foundations)
- KV cache TTL tuning (deferred)
- R2 explicit multipart API (only if follow-up probe demands)

---

## 6. Acceptance criteria

- [x] `scoped-io.ts` v2 interface shipped (BREAKING — `r2List` return shape)
- [x] `errors.ts` typed error hierarchy shipped (`StorageError`, `ValueTooLargeError`, `CursorRequiredError`, `StorageNotConnectedError`)
- [x] 4 adapter files shipped under `adapters/{r2,kv,d1,do-storage}-adapter.ts`
- [x] `NullStorageAdapter` updated for v2 contract (throws typed `StorageNotConnectedError`; v2 `r2List` return shape)
- [x] `ReferenceBackend` no longer throws `not connected` when supplied with adapters; placeholder mode preserved when constructed with no config
- [x] `MemoryBackend` adds `maxValueBytes` config (default 1 MiB)
- [x] `storage-topology` major bump 0.1.0 → 2.0.0
- [x] CHANGELOG entry written (see `packages/storage-topology/CHANGELOG.md`)
- [x] Contract tests added:
  - `r2List` cursor walking + `listAll` auto-walk (F02) → `test/adapters/r2-adapter.test.ts`
  - `D1Adapter.batch` atomicity + negative-API surface (F06) → `test/adapters/d1-adapter.test.ts`
  - `DOStorageAdapter.put` ValueTooLargeError (F08) → `test/adapters/do-storage-adapter.test.ts`
  - `KvAdapter.putAsync` fire-and-forget (uF02) → `test/adapters/kv-adapter.test.ts`
  - `R2Adapter.putParallel` (uF01) → `test/adapters/r2-adapter.test.ts`
  - `MemoryBackend.write` mirrors DO size cap with `adapter='memory'` (F05 + F08) → `test/backends/memory.test.ts`
  - `ReferenceBackend` connected/promotion/placeholder modes → `test/backends/reference.test.ts`
  - `DEFAULT_PROMOTION_POLICY.coldTierSizeBytes` aligned with DO cap (F08) → `test/promotion.test.ts`
- [ ] Round 2 integrated spike re-runs V1-storage-* with new adapters (deferred to B7 per P6 §4.4b)

---

## 7. References

- Sibling design: `docs/design/after-foundations/P1-storage-adapter-hardening.md`
- Charter §6 Phase 1 + §11.2: `docs/plan-after-foundations.md`
- Storage rollup: `docs/spikes/storage-findings.md`
- Open writeback issue: `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md`
- Discipline check: `docs/spikes/_DISCIPLINE-CHECK.md`
- Tracking policy: `docs/issue/README.md`

---

## 8. Revision history

| Date | Author | Change |
|---|---|---|
| 2026-04-19 | Opus 4.7 | Initial draft; 6 changes (3 breaking + 2 helpers + 1 jsdoc); migration path for NullStorageAdapter / ReferenceBackend / MemoryBackend |
| 2026-04-20 | Opus 4.7 | r2 — frozen to shipped surface. §3.1 retains `teamUuid` on `ScopedStorageAdapter` (only `r2List` return shape is breaking). 4 adapter classes are orthogonal per-binding wrappers; `maxValueBytes` lives on adapter classes, not the facade. `ReferenceBackend` connected mode supports DO-only and DO+R2-promotion topologies. All §6 acceptance criteria except B7 round-2 re-run are now `[x]`. |
