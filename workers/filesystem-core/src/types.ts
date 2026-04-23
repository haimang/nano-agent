/**
 * Workspace Context Artifacts — Core Types
 *
 * Defines mount configuration, backend kinds, and file entry types
 * for the workspace namespace layer.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════
// §1 — Mount Access
// ═══════════════════════════════════════════════════════════════════

export const MountAccessSchema = z.enum(["readonly", "writable"]);
export type MountAccess = z.infer<typeof MountAccessSchema>;

// ═══════════════════════════════════════════════════════════════════
// §2 — Mount Config
// ═══════════════════════════════════════════════════════════════════

export const MountConfigSchema = z.object({
  mountPoint: z.string(),
  backend: z.string(),
  access: MountAccessSchema,
  description: z.string().optional(),
});
export type MountConfig = z.infer<typeof MountConfigSchema>;

// ═══════════════════════════════════════════════════════════════════
// §3 — Backend Kind
// ═══════════════════════════════════════════════════════════════════

export const BackendKindSchema = z.enum([
  "memory",
  "do-storage",
  "kv",
  "r2",
  "reference",
]);
export type BackendKind = z.infer<typeof BackendKindSchema>;

// ═══════════════════════════════════════════════════════════════════
// §4 — Workspace File Entry
// ═══════════════════════════════════════════════════════════════════

export const WorkspaceFileEntrySchema = z.object({
  path: z.string(),
  size: z.number().int().min(0),
  mimeType: z.string().optional(),
  modifiedAt: z.string(),
});
export type WorkspaceFileEntry = z.infer<typeof WorkspaceFileEntrySchema>;

export interface FilesystemCoreEnv {
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface FilesystemCoreShellResponse {
  readonly worker: "filesystem-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "worker-matrix-P4-absorbed";
  readonly absorbed_runtime: true;
  readonly library_worker: true;
}
