/**
 * @nano-agent/storage-topology — Storage Semantics Layer
 *
 * Hot / warm / cold data tiers, data item catalog, and evidence vocabulary
 * for nano-agent's storage topology. All placements are provisional until
 * confirmed by eval-observability evidence.
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { STORAGE_TOPOLOGY_VERSION } from "./version.js";

// ── Taxonomy ──
export { storageClassToBackend } from "./taxonomy.js";
export type {
  StorageClass,
  StorageBackend,
  ProvisionalMarker,
  ResponsibleRuntime,
} from "./taxonomy.js";

// ── Data Items ──
export { DATA_ITEM_CATALOG } from "./data-items.js";
export type { DataItemClass, DataItemDescriptor } from "./data-items.js";

// ── Evidence ──
export type {
  EvidenceSignalKind,
  EvidenceSignal,
  CalibrationHint,
  AccessPatternValue,
  SizeEvidenceSignal,
  ReadFrequencyEvidenceSignal,
  WriteFrequencyEvidenceSignal,
  AccessPatternEvidenceSignal,
  ResumeHitEvidenceSignal,
  PlacementObservationSignal,
} from "./evidence.js";

// ── Keys ──
export { DO_KEYS, KV_KEYS, R2_KEYS } from "./keys.js";

// ── Refs ──
export {
  buildR2Ref,
  buildKvRef,
  buildDoStorageRef,
  validateRefKey,
} from "./refs.js";
export type { StorageRef, BuildRefOptions } from "./refs.js";

// ── MIME-type gate ──
export {
  applyMimePolicy,
  DEFAULT_INLINE_TEXT_BYTES,
  PREPARED_TEXT_MIME_TYPES,
} from "./mime-gate.js";
export type {
  MimePolicyDecision,
  MimePolicyInput,
  MimePolicyOptions,
  MimePolicyResult,
} from "./mime-gate.js";

// ── Adapters ──
export { NullStorageAdapter } from "./adapters/scoped-io.js";
export type { ScopedStorageAdapter, R2ObjectLike } from "./adapters/scoped-io.js";
export { R2Adapter } from "./adapters/r2-adapter.js";
export type { R2BucketBinding, R2ListResult, R2ObjectBodyLike } from "./adapters/r2-adapter.js";
export { KvAdapter } from "./adapters/kv-adapter.js";
export type { KVNamespaceBinding, KvPutAsyncContext } from "./adapters/kv-adapter.js";
export { D1Adapter } from "./adapters/d1-adapter.js";
export type {
  D1DatabaseBinding,
  D1PreparedStatementLike,
  D1ResultLike,
} from "./adapters/d1-adapter.js";
export { DOStorageAdapter } from "./adapters/do-storage-adapter.js";
export type {
  DurableObjectStorageBinding,
  DurableObjectTransactionLike,
  DOListOptions,
} from "./adapters/do-storage-adapter.js";

// ── Errors ──
export {
  StorageError,
  ValueTooLargeError,
  CursorRequiredError,
  StorageNotConnectedError,
} from "./errors.js";
export type { SizeCappedAdapterKind } from "./errors.js";

// ── Placement hypotheses ──
export {
  PLACEMENT_HYPOTHESES,
  getPlacement,
  defaultMimeGate,
  enforceMimeGate,
} from "./placement.js";
export type {
  PlacementHypothesis,
  PlacementMimeGate,
  EnforceMimeGateResult,
} from "./placement.js";

// ── Checkpoint candidates ──
export { CHECKPOINT_CANDIDATE_FIELDS, summarizeFragments } from "./checkpoint-candidate.js";
export type {
  CheckpointCandidateField,
  CheckpointFragment,
} from "./checkpoint-candidate.js";

// ── Archive plan ──
export { ARCHIVE_PLANS } from "./archive-plan.js";
export type { ArchivePlan } from "./archive-plan.js";

// ── Promotion plan ──
export { PROMOTION_PLANS } from "./promotion-plan.js";
export type { PromotionPlan } from "./promotion-plan.js";

// ── Demotion plan ──
export { DEMOTION_PLANS } from "./demotion-plan.js";
export type { DemotionPlan } from "./demotion-plan.js";

// ── Calibration ──
export {
  evaluateEvidence,
  placementLogToEvidence,
  DEFAULT_DO_SIZE_THRESHOLD_BYTES,
  DEFAULT_HIGH_CONFIDENCE_MIN_SIGNALS,
  DEFAULT_MEDIUM_CONFIDENCE_MIN_SIGNALS,
  DEFAULT_HIGH_WRITE_FREQUENCY,
} from "./calibration.js";
export type {
  CalibrationRecommendation,
  CalibrationOptions,
  PlacementLogEntryLike,
} from "./calibration.js";
