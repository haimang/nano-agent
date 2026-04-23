/**
 * Workspace Context Artifacts — Result Promotion
 *
 * Decides when tool output should be promoted from inline text to a
 * stored artifact, based on size thresholds and MIME type, and emits
 * a `NacpRef`-compatible `ArtifactRef` pointing at a
 * `tenants/{teamUuid}/artifacts/...` key.
 */

import type {
  ArtifactKind,
  ArtifactRef,
  NacpRefKind,
  NacpRefRole,
} from "./refs.js";

// ═══════════════════════════════════════════════════════════════════
// §1 — Promotion Policy
// ═══════════════════════════════════════════════════════════════════

export interface PromotionPolicy {
  readonly maxInlineBytes: number;
  readonly promotableMimeTypes: ReadonlySet<string>;
  /**
   * Size above which the promotion target moves from DO-storage
   * (hot tier) to R2 (cold tier). Default **1 MiB** aligns with
   * `DOStorageAdapter.maxValueBytes` (`@nano-agent/storage-topology`
   * B2, per spike-do-storage-F08): any blob beyond the DO cap MUST
   * promote to R2, otherwise the write fails with
   * `ValueTooLargeError`. B7 Round 2 may tighten/loosen this once the
   * binary-search probe pins the real SQLITE_TOOBIG boundary.
   */
  readonly coldTierSizeBytes: number;
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  maxInlineBytes: 4096,
  promotableMimeTypes: new Set([
    "application/json",
    "text/plain",
    "text/html",
    "text/csv",
    "text/markdown",
    "image/png",
    "image/jpeg",
    "image/svg+xml",
    "application/pdf",
  ]),
  coldTierSizeBytes: 1024 * 1024,
};

// ═══════════════════════════════════════════════════════════════════
// §2 — shouldPromoteResult
// ═══════════════════════════════════════════════════════════════════

/**
 * Determine whether a tool output should be promoted to an artifact.
 */
export function shouldPromoteResult(
  output: string,
  mimeType?: string,
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY,
): { promote: boolean; reason: string } {
  const byteLength = new TextEncoder().encode(output).length;

  if (byteLength > policy.maxInlineBytes) {
    return {
      promote: true,
      reason: `Content size ${byteLength} bytes exceeds inline limit of ${policy.maxInlineBytes} bytes`,
    };
  }

  if (mimeType && policy.promotableMimeTypes.has(mimeType)) {
    return {
      promote: true,
      reason: `MIME type "${mimeType}" is promotable`,
    };
  }

  return {
    promote: false,
    reason: "Content is within inline limits and MIME type is not promotable",
  };
}

// ═══════════════════════════════════════════════════════════════════
// §3 — promoteToArtifactRef
// ═══════════════════════════════════════════════════════════════════

/** Default Workers bindings per NacpRef `kind`. */
const DEFAULT_BINDINGS: Record<NacpRefKind, string> = {
  r2: "WORKSPACE_R2",
  kv: "TENANT_KV",
  "do-storage": "SESSION_DO",
  d1: "PRIMARY_D1",
  "queue-dlq": "DLQ_QUEUE",
};

export interface PromotionOptions {
  readonly policy?: PromotionPolicy;
  readonly role?: NacpRefRole;
  readonly bindingOverride?: Partial<Record<NacpRefKind, string>>;
  /** Override the `Date.now()` + random ID. Useful in tests. */
  readonly idFactory?: () => string;
}

/**
 * Build a `NacpRef`-shaped `ArtifactRef` for promoted content.
 *
 * The storage backend (`kind`) is chosen by size:
 *   - bytes > `policy.coldTierSizeBytes` → `r2`   (cold, tenant-scoped)
 *   - otherwise                          → `do-storage` (hot, tenant-scoped)
 *
 * The key ALWAYS begins with `tenants/{teamUuid}/artifacts/...` so it
 * passes `NacpRefSchema` validation everywhere it is consumed.
 */
export function promoteToArtifactRef(
  teamUuid: string,
  content: string,
  mimeType: string,
  artifactKind: ArtifactKind,
  options: PromotionOptions = {},
): ArtifactRef {
  const policy = options.policy ?? DEFAULT_PROMOTION_POLICY;
  const sizeBytes = new TextEncoder().encode(content).length;
  const backend: NacpRefKind = sizeBytes > policy.coldTierSizeBytes ? "r2" : "do-storage";
  const bindings = { ...DEFAULT_BINDINGS, ...(options.bindingOverride ?? {}) };
  const id = options.idFactory
    ? options.idFactory()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    kind: backend,
    binding: bindings[backend],
    team_uuid: teamUuid,
    key: `tenants/${teamUuid}/artifacts/${artifactKind}/${id}`,
    role: options.role ?? "attachment",
    content_type: mimeType,
    size_bytes: sizeBytes,
    artifactKind,
    createdAt: new Date().toISOString(),
  };
}
