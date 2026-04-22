import type { NacpRef } from "../types.js";

export type StorageBackend = "do-storage" | "kv" | "r2";

export interface StorageRef extends NacpRef {
  readonly kind: StorageBackend;
}

export interface BuildRefOptions {
  readonly role?: "input" | "output" | "attachment";
  readonly content_type?: string;
  readonly size_bytes?: number;
  readonly etag?: string;
  readonly bucket?: string;
  readonly binding?: string;
}

const DEFAULT_R2_BINDING = "WORKSPACE_R2";
const DEFAULT_KV_BINDING = "TENANT_KV";
const DEFAULT_DO_BINDING = "SESSION_DO";

function ensureTenantPrefix(teamUuid: string, key: string): string {
  const expected = `tenants/${teamUuid}/`;
  if (key.startsWith(expected)) return key;
  const clean = key.startsWith("/") ? key.slice(1) : key;
  return `${expected}${clean}`;
}

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

export function validateRefKey(ref: Pick<StorageRef, "team_uuid" | "key">): boolean {
  if (!ref.key || ref.key.length === 0) return false;
  return ref.key.startsWith(`tenants/${ref.team_uuid}/`);
}
