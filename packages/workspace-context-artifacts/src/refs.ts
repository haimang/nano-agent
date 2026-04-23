/**
 * Workspace Context Artifacts — Artifact Reference Types
 *
 * `ArtifactRef` is a semantic wrapper around `@haimang/nacp-core`'s
 * `NacpRef`. The underlying wire shape IS a NacpRef (same field names,
 * same tenant-prefix rule, same `kind` enum: `r2 | kv | do-storage |
 * d1 | queue-dlq`). Artifact-specific metadata is carried in a small
 * set of additional fields:
 *
 *   artifactKind  : file | image | document | export | compact-archive | transcript
 *   createdAt     : ISO timestamp
 *
 * Size + content-type are carried in the canonical NacpRef fields
 * `size_bytes` / `content_type` rather than reinventing `sizeBytes` /
 * `mimeType`.
 *
 * The schema is intentionally declared as a zod object (not imported
 * from nacp-core) so the package has no hard dep on nacp-core at
 * install time. The field list, ref-key refinement and `kind` enum
 * are kept in lock-step with `NacpRefSchema` by a cross-package test
 * (`test/integration/fake-workspace-flow.test.ts`).
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════
// §1 — Artifact Kind (semantic, NOT a NacpRef `kind`)
// ═══════════════════════════════════════════════════════════════════

export const ArtifactKindSchema = z.enum([
  "file",
  "image",
  "document",
  "export",
  "compact-archive",
  "transcript",
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

// ═══════════════════════════════════════════════════════════════════
// §2 — NacpRef kind enum (mirrors nacp-core)
// ═══════════════════════════════════════════════════════════════════

/** The storage-backend kinds supported by `NacpRef`. */
export const NacpRefKindSchema = z.enum([
  "r2",
  "kv",
  "do-storage",
  "d1",
  "queue-dlq",
]);
export type NacpRefKind = z.infer<typeof NacpRefKindSchema>;

// Legacy alias — previously this was exported as `StorageClass`. Kept
// so downstream packages that still import the name can migrate at
// their own pace.
export const StorageClassSchema = NacpRefKindSchema;
export type StorageClass = NacpRefKind;

/** `NacpRef.role` enum (mirrors nacp-core). */
export const NacpRefRoleSchema = z.enum(["input", "output", "attachment"]);
export type NacpRefRole = z.infer<typeof NacpRefRoleSchema>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Artifact Ref (NacpRef-shaped)
// ═══════════════════════════════════════════════════════════════════

const ArtifactRefObjectSchema = z.object({
  // NacpRef core fields
  kind: NacpRefKindSchema,
  binding: z.string().min(1).max(64),
  team_uuid: z.string().min(1).max(64),
  key: z.string().min(1).max(512),
  role: NacpRefRoleSchema.default("attachment"),
  bucket: z.string().optional(),
  size_bytes: z.number().int().min(0).optional(),
  content_type: z.string().max(128).optional(),
  etag: z.string().max(64).optional(),
  // Artifact-specific metadata
  artifactKind: ArtifactKindSchema,
  createdAt: z.string(),
});

/**
 * `ArtifactRefSchema` is a `NacpRef`-shaped ref plus a small set of
 * artifact-level metadata fields. `key` MUST start with
 * `tenants/{team_uuid}/` — the refinement below enforces that.
 */
export const ArtifactRefSchema = ArtifactRefObjectSchema.refine(
  (r) => r.key.startsWith(`tenants/${r.team_uuid}/`),
  {
    message: "ArtifactRef.key must start with tenants/{team_uuid}/",
    path: ["key"],
  },
);
export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;

// ═══════════════════════════════════════════════════════════════════
// §4 — Prepared Artifact Kind
// ═══════════════════════════════════════════════════════════════════

export const PreparedArtifactKindSchema = z.enum([
  "extracted-text",
  "summary",
  "preview",
]);
export type PreparedArtifactKind = z.infer<typeof PreparedArtifactKindSchema>;

// ═══════════════════════════════════════════════════════════════════
// §5 — Prepared Artifact Ref
// ═══════════════════════════════════════════════════════════════════

export const PreparedArtifactRefSchema = ArtifactRefObjectSchema.extend({
  preparedKind: PreparedArtifactKindSchema,
  sourceRef: ArtifactRefObjectSchema,
}).refine(
  (r) =>
    r.key.startsWith(`tenants/${r.team_uuid}/`) &&
    r.sourceRef.key.startsWith(`tenants/${r.sourceRef.team_uuid}/`),
  {
    message:
      "PreparedArtifactRef.key and sourceRef.key must start with tenants/{team_uuid}/",
    path: ["key"],
  },
);
export type PreparedArtifactRef = z.infer<typeof PreparedArtifactRefSchema>;

// ═══════════════════════════════════════════════════════════════════
// §6 — Convenience: toNacpRef
// ═══════════════════════════════════════════════════════════════════

/**
 * Subset of `ArtifactRef` that matches the exact `NacpRef` wire shape
 * (no artifact-specific metadata). Useful when publishing a ref to a
 * Core message body that strictly requires a `NacpRef`.
 */
export interface NacpRefLike {
  readonly kind: NacpRefKind;
  readonly binding: string;
  readonly team_uuid: string;
  readonly key: string;
  readonly role: NacpRefRole;
  readonly bucket?: string;
  readonly size_bytes?: number;
  readonly content_type?: string;
  readonly etag?: string;
}

/**
 * Drop artifact-level metadata and return the pure-NacpRef fields of
 * an `ArtifactRef` so it can be passed anywhere a `NacpRef` is
 * expected.
 */
export function toNacpRef(ref: ArtifactRef): NacpRefLike {
  return {
    kind: ref.kind,
    binding: ref.binding,
    team_uuid: ref.team_uuid,
    key: ref.key,
    role: ref.role,
    ...(ref.bucket !== undefined ? { bucket: ref.bucket } : {}),
    ...(ref.size_bytes !== undefined ? { size_bytes: ref.size_bytes } : {}),
    ...(ref.content_type !== undefined ? { content_type: ref.content_type } : {}),
    ...(ref.etag !== undefined ? { etag: ref.etag } : {}),
  };
}
