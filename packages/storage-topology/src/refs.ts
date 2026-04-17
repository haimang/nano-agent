/**
 * Storage Topology — NacpRef-Compatible Reference Builders
 *
 * `StorageRef` is structurally compatible with
 * `@nano-agent/nacp-core`'s `NacpRefSchema`:
 *
 *   { kind: "r2" | "kv" | "do-storage" | ...,
 *     binding, team_uuid, key, role, … }
 *
 * All refs — including `do-storage` — MUST use a tenant-prefixed key
 * (`tenants/{team_uuid}/...`) so the value passes `NacpRefSchema.parse()`
 * without further transformation. The DO-local relative key (e.g.
 * `session:phase`) lives in `keys.ts` as `DO_KEYS.*`; `buildDoStorageRef`
 * is responsible for wrapping it with the tenant prefix so cross-package
 * consumers see a single, uniform ref shape.
 *
 * Alignment with `tenantDoStoragePut/Get/Delete` (see
 * `packages/nacp-core/src/tenancy/scoped-io.ts`): those helpers compute
 * the same `tenants/{team_uuid}/{relativeKey}` full key when called
 * with the same inputs, so a consumer building a ref here and a
 * consumer calling `tenantDoStoragePut` elsewhere will see byte-for-byte
 * identical stored keys.
 */

import type { StorageBackend } from "./taxonomy.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — StorageRef
// ═══════════════════════════════════════════════════════════════════

/**
 * A typed pointer to a specific storage location, structurally aligned
 * with `@nano-agent/nacp-core`'s `NacpRefSchema`.
 *
 * - `kind`       : which Cloudflare primitive backs this ref.
 * - `binding`    : the Workers binding name (e.g. `WORKSPACE_R2`).
 * - `team_uuid`  : tenant isolation scope (snake-case to match Core).
 * - `key`        : the full storage key, MUST start with `tenants/{team_uuid}/`.
 * - `role`       : semantic role of the referenced data.
 * - `content_type` / `size_bytes` / `etag` / `bucket` are optional and
 *   mirror the Core schema.
 */
export interface StorageRef {
  readonly kind: StorageBackend;
  readonly binding: string;
  readonly team_uuid: string;
  readonly key: string;
  readonly role: "input" | "output" | "attachment";
  readonly content_type?: string;
  readonly size_bytes?: number;
  readonly etag?: string;
  readonly bucket?: string;
}

// ═══════════════════════════════════════════════════════════════════
// §2 — Default Binding Names
// ═══════════════════════════════════════════════════════════════════

const DEFAULT_R2_BINDING = "WORKSPACE_R2";
const DEFAULT_KV_BINDING = "TENANT_KV";
const DEFAULT_DO_BINDING = "SESSION_DO";

// ═══════════════════════════════════════════════════════════════════
// §3 — Ref Builders
// ═══════════════════════════════════════════════════════════════════

/**
 * Wrap a relative key with the tenant prefix used by every ref kind.
 * Accepts keys that are already tenant-prefixed and returns them
 * unchanged so call sites can mix raw and pre-prefixed inputs.
 */
function ensureTenantPrefix(teamUuid: string, key: string): string {
  const expected = `tenants/${teamUuid}/`;
  if (key.startsWith(expected)) return key;
  // Strip a leading slash so callers can pass "/foo" or "foo" interchangeably.
  const clean = key.startsWith("/") ? key.slice(1) : key;
  return `${expected}${clean}`;
}

/** Options accepted by every `build*Ref` helper. */
export interface BuildRefOptions {
  readonly role?: "input" | "output" | "attachment";
  readonly content_type?: string;
  readonly size_bytes?: number;
  readonly etag?: string;
  readonly bucket?: string;
  /** Overrides the default Workers binding name for this kind. */
  readonly binding?: string;
}

/** Build a `StorageRef` pointing to an R2 object. */
export function buildR2Ref(
  teamUuid: string,
  key: string,
  options: BuildRefOptions = {},
): StorageRef {
  return {
    kind: "r2",
    binding: options.binding ?? DEFAULT_R2_BINDING,
    team_uuid: teamUuid,
    key: ensureTenantPrefix(teamUuid, key),
    role: options.role ?? "output",
    ...(options.content_type !== undefined ? { content_type: options.content_type } : {}),
    ...(options.size_bytes !== undefined ? { size_bytes: options.size_bytes } : {}),
    ...(options.etag !== undefined ? { etag: options.etag } : {}),
    ...(options.bucket !== undefined ? { bucket: options.bucket } : {}),
  };
}

/** Build a `StorageRef` pointing to a KV entry. */
export function buildKvRef(
  teamUuid: string,
  key: string,
  options: BuildRefOptions = {},
): StorageRef {
  return {
    kind: "kv",
    binding: options.binding ?? DEFAULT_KV_BINDING,
    team_uuid: teamUuid,
    key: ensureTenantPrefix(teamUuid, key),
    role: options.role ?? "input",
    ...(options.content_type !== undefined ? { content_type: options.content_type } : {}),
    ...(options.size_bytes !== undefined ? { size_bytes: options.size_bytes } : {}),
    ...(options.etag !== undefined ? { etag: options.etag } : {}),
  };
}

/**
 * Build a `StorageRef` pointing to a Durable Object storage entry.
 *
 * The final key is `tenants/{teamUuid}/{relativeKey}` to match the
 * shape that `tenantDoStoragePut` / `tenantDoStorageGet` produce in
 * `@nano-agent/nacp-core`'s scoped-io helpers, and to satisfy
 * `NacpRefSchema`'s tenant-prefix refinement for every ref kind.
 */
export function buildDoStorageRef(
  teamUuid: string,
  key: string,
  options: BuildRefOptions = {},
): StorageRef {
  return {
    kind: "do-storage",
    binding: options.binding ?? DEFAULT_DO_BINDING,
    team_uuid: teamUuid,
    key: ensureTenantPrefix(teamUuid, key),
    role: options.role ?? "output",
    ...(options.content_type !== undefined ? { content_type: options.content_type } : {}),
    ...(options.size_bytes !== undefined ? { size_bytes: options.size_bytes } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════
// §4 — Ref Validation
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate that a `StorageRef`'s key follows the tenant-prefix
 * convention required by `NacpRefSchema` for EVERY ref kind.
 *
 * Returns `true` iff `ref.key` starts with `tenants/{team_uuid}/`.
 */
export function validateRefKey(ref: StorageRef): boolean {
  if (!ref.key || ref.key.length === 0) return false;
  const expectedPrefix = `tenants/${ref.team_uuid}/`;
  return ref.key.startsWith(expectedPrefix);
}
