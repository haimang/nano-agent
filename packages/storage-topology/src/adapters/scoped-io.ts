/**
 * Storage Topology — Scoped Storage Adapter Interface
 *
 * Thin adapter types that align with `@nano-agent/nacp-core`'s
 * tenant-scoped I/O helpers (`tenantR2Put/Get/Head/List/Delete`,
 * `tenantKvGet/Put/Delete`, `tenantDoStorageGet/Put/Delete`). This
 * module does not re-implement storage operations — it provides typed
 * wrappers that topology consumers can program against while the
 * platform layer injects the real implementation at runtime.
 *
 * Every operation takes a `teamUuid`: the adapter is the single point
 * where tenant prefixing is enforced, so higher layers never need to
 * remember the `tenants/{team_uuid}/…` convention themselves.
 */

// ═══════════════════════════════════════════════════════════════════
// §1 — ScopedStorageAdapter
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
 */
export interface ScopedStorageAdapter {
  // ── Durable Object transactional storage ──

  /** Read a value from DO transactional storage (tenant-scoped). */
  doGet(teamUuid: string, key: string): Promise<unknown>;

  /** Write a value to DO transactional storage (tenant-scoped). */
  doPut(teamUuid: string, key: string, value: unknown): Promise<void>;

  /** Delete a value from DO transactional storage (tenant-scoped). */
  doDelete(teamUuid: string, key: string): Promise<boolean>;

  // ── Workers KV (warm tier) ──

  /** Read a value from Workers KV (tenant-scoped). */
  kvGet(teamUuid: string, key: string): Promise<unknown>;

  /** Write a value to Workers KV (tenant-scoped). */
  kvPut(teamUuid: string, key: string, value: unknown): Promise<void>;

  /** Delete a value from Workers KV (tenant-scoped). */
  kvDelete(teamUuid: string, key: string): Promise<void>;

  // ── R2 (cold tier) ──

  /** Read an object from R2 (tenant-scoped). */
  r2Get(teamUuid: string, key: string): Promise<unknown>;

  /** Write an object to R2 (tenant-scoped). */
  r2Put(teamUuid: string, key: string, value: unknown): Promise<void>;

  /** Delete an object from R2 (tenant-scoped). */
  r2Delete(teamUuid: string, key: string): Promise<void>;

  /**
   * List R2 objects under a tenant-scoped prefix. Returned keys include
   * the `tenants/{teamUuid}/` prefix so callers see the same shape that
   * `tenantR2List` produces.
   */
  r2List(
    teamUuid: string,
    prefix?: string,
    limit?: number,
  ): Promise<{ keys: string[]; truncated: boolean }>;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Null Adapter (testing / placeholder)
// ═══════════════════════════════════════════════════════════════════

/**
 * A no-op adapter that throws on every operation. Useful as a default
 * before the real platform adapter is injected.
 */
export class NullStorageAdapter implements ScopedStorageAdapter {
  async doGet(_teamUuid: string, _key: string): Promise<unknown> {
    throw new Error("NullStorageAdapter: doGet not connected");
  }

  async doPut(_teamUuid: string, _key: string, _value: unknown): Promise<void> {
    throw new Error("NullStorageAdapter: doPut not connected");
  }

  async doDelete(_teamUuid: string, _key: string): Promise<boolean> {
    throw new Error("NullStorageAdapter: doDelete not connected");
  }

  async kvGet(_teamUuid: string, _key: string): Promise<unknown> {
    throw new Error("NullStorageAdapter: kvGet not connected");
  }

  async kvPut(_teamUuid: string, _key: string, _value: unknown): Promise<void> {
    throw new Error("NullStorageAdapter: kvPut not connected");
  }

  async kvDelete(_teamUuid: string, _key: string): Promise<void> {
    throw new Error("NullStorageAdapter: kvDelete not connected");
  }

  async r2Get(_teamUuid: string, _key: string): Promise<unknown> {
    throw new Error("NullStorageAdapter: r2Get not connected");
  }

  async r2Put(_teamUuid: string, _key: string, _value: unknown): Promise<void> {
    throw new Error("NullStorageAdapter: r2Put not connected");
  }

  async r2Delete(_teamUuid: string, _key: string): Promise<void> {
    throw new Error("NullStorageAdapter: r2Delete not connected");
  }

  async r2List(
    _teamUuid: string,
    _prefix?: string,
    _limit?: number,
  ): Promise<{ keys: string[]; truncated: boolean }> {
    throw new Error("NullStorageAdapter: r2List not connected");
  }
}
