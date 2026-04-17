/**
 * @nano-agent/workspace-context-artifacts — Workspace / Context / Artifacts
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { WORKSPACE_VERSION } from "./version.js";

// ── Core types & schemas ──
export {
  MountAccessSchema,
  MountConfigSchema,
  BackendKindSchema,
  WorkspaceFileEntrySchema,
} from "./types.js";
export type {
  MountAccess,
  MountConfig,
  BackendKind,
  WorkspaceFileEntry,
} from "./types.js";

// ── Paths ──
export {
  WORKSPACE_ROOT,
  normalizePath,
  isChildOf,
} from "./paths.js";
export type { WorkspacePath } from "./paths.js";

// ── Refs (NacpRef-shaped) ──
export {
  ArtifactKindSchema,
  StorageClassSchema,
  NacpRefKindSchema,
  NacpRefRoleSchema,
  ArtifactRefSchema,
  PreparedArtifactKindSchema,
  PreparedArtifactRefSchema,
  toNacpRef,
} from "./refs.js";
export type {
  ArtifactKind,
  StorageClass,
  NacpRefKind,
  NacpRefRole,
  NacpRefLike,
  ArtifactRef,
  PreparedArtifactKind,
  PreparedArtifactRef,
} from "./refs.js";

// ── Context layers ──
export {
  ContextLayerKindSchema,
  ContextLayerSchema,
  ContextAssemblyConfigSchema,
  CANONICAL_LAYER_ORDER,
  CANONICAL_LAYER_RANK,
} from "./context-layers.js";
export type {
  ContextLayerKind,
  ContextLayer,
  ContextAssemblyConfig,
} from "./context-layers.js";

// ── Artifacts ──
export { InMemoryArtifactStore } from "./artifacts.js";
export type { ArtifactMetadata, ArtifactStore } from "./artifacts.js";

// ── Prepared Artifacts ──
export { StubArtifactPreparer } from "./prepared-artifacts.js";
export type {
  PrepareRequest,
  PrepareResult,
  ArtifactPreparer,
} from "./prepared-artifacts.js";

// ── Promotion ──
export {
  DEFAULT_PROMOTION_POLICY,
  shouldPromoteResult,
  promoteToArtifactRef,
} from "./promotion.js";
export type { PromotionPolicy, PromotionOptions } from "./promotion.js";

// ── Context Assembler ──
export { ContextAssembler } from "./context-assembler.js";
export type { AssemblyResult } from "./context-assembler.js";

// ── Compact Boundary (aligned with context.compact.request/response) ──
export { CompactBoundaryManager } from "./compact-boundary.js";
export type {
  ContextCompactRequestBody,
  ContextCompactResponseBody,
  BuildCompactInputArgs,
  CompactMessage,
  ApplyCompactResult,
} from "./compact-boundary.js";

// ── Redaction ──
export {
  redactForClient,
  buildPreview,
  redactPayload,
  redactArtifactPayload,
} from "./redaction.js";
export type { PayloadRedactor } from "./redaction.js";

// ── Snapshot ──
export {
  WorkspaceSnapshotFragmentSchema,
  CompactBoundaryRecordSchema,
  WorkspaceSnapshotBuilder,
} from "./snapshot.js";
export type {
  WorkspaceSnapshotFragment,
  CompactBoundaryRecord,
  BuildFragmentOptions,
} from "./snapshot.js";

// ── Backends ──
export type { WorkspaceBackend } from "./backends/types.js";
export { MemoryBackend } from "./backends/memory.js";
export { ReferenceBackend } from "./backends/reference.js";

// ── Mounts ──
export { MountRouter } from "./mounts.js";
export type { Mount, RouteResult } from "./mounts.js";

// ── Namespace ──
export { WorkspaceNamespace } from "./namespace.js";
