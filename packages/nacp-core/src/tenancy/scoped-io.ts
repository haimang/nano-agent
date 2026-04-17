/**
 * Tenant-Scoped I/O — wrapper functions that enforce tenant namespace in all storage keys.
 *
 * Every R2/KV/DO-storage access MUST go through these helpers.
 * Direct env.R2.put/get is forbidden by project convention.
 *
 * NOTE: Biome cannot lint property-access patterns (env.R2.put).
 * Enforcement relies on:
 *   1. This docstring convention (code review)
 *   2. grep-based CI check: `grep -rn 'env\.R2_\|env\.KV_\|\.storage\.' src/ --include='*.ts' | grep -v scoped-io`
 *   3. Future eslint `no-restricted-properties` rule if eslint is added
 */

function tenantKey(teamUuid: string, relativePath: string): string {
  const clean = relativePath.startsWith("/")
    ? relativePath.slice(1)
    : relativePath;
  return `tenants/${teamUuid}/${clean}`;
}

// ── R2 ──

export interface R2BucketLike {
  put(key: string, value: ReadableStream | ArrayBuffer | string | null): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  head(key: string): Promise<{ size: number; uploaded: Date } | null>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    objects: Array<{ key: string; size: number }>;
    truncated: boolean;
    cursor?: string;
  }>;
  delete(key: string | string[]): Promise<void>;
}

export async function tenantR2Put(
  bucket: R2BucketLike,
  teamUuid: string,
  relativePath: string,
  body: ReadableStream | ArrayBuffer | string | null,
): Promise<void> {
  await bucket.put(tenantKey(teamUuid, relativePath), body);
}

export async function tenantR2Get(
  bucket: R2BucketLike,
  teamUuid: string,
  relativePath: string,
): Promise<{ text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> } | null> {
  return bucket.get(tenantKey(teamUuid, relativePath));
}

export async function tenantR2Head(
  bucket: R2BucketLike,
  teamUuid: string,
  relativePath: string,
): Promise<{ size: number; uploaded: Date } | null> {
  return bucket.head(tenantKey(teamUuid, relativePath));
}

export async function tenantR2List(
  bucket: R2BucketLike,
  teamUuid: string,
  prefix = "",
  limit = 100,
): Promise<{ keys: string[]; truncated: boolean }> {
  const fullPrefix = tenantKey(teamUuid, prefix);
  const result = await bucket.list({ prefix: fullPrefix, limit });
  return {
    keys: result.objects.map((o) => o.key),
    truncated: result.truncated,
  };
}

export async function tenantR2Delete(
  bucket: R2BucketLike,
  teamUuid: string,
  relativePath: string,
): Promise<void> {
  await bucket.delete(tenantKey(teamUuid, relativePath));
}

// ── KV ──

export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export async function tenantKvGet(
  kv: KVNamespaceLike,
  teamUuid: string,
  key: string,
): Promise<string | null> {
  return kv.get(tenantKey(teamUuid, key));
}

export async function tenantKvPut(
  kv: KVNamespaceLike,
  teamUuid: string,
  key: string,
  value: string,
): Promise<void> {
  await kv.put(tenantKey(teamUuid, key), value);
}

export async function tenantKvDelete(
  kv: KVNamespaceLike,
  teamUuid: string,
  key: string,
): Promise<void> {
  await kv.delete(tenantKey(teamUuid, key));
}

// ── DO Storage ──

export interface DoStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string | string[]): Promise<boolean>;
}

export async function tenantDoStorageGet<T = unknown>(
  storage: DoStorageLike,
  teamUuid: string,
  key: string,
): Promise<T | undefined> {
  return storage.get<T>(tenantKey(teamUuid, key));
}

export async function tenantDoStoragePut<T>(
  storage: DoStorageLike,
  teamUuid: string,
  key: string,
  value: T,
): Promise<void> {
  await storage.put(tenantKey(teamUuid, key), value);
}

export async function tenantDoStorageDelete(
  storage: DoStorageLike,
  teamUuid: string,
  key: string,
): Promise<boolean> {
  return storage.delete(tenantKey(teamUuid, key));
}
