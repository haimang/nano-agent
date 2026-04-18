/**
 * @nano-agent/eval-observability — Trace taxonomy, classification, metrics, truncation.
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { EVAL_VERSION } from "./version.js";

// ── Base types ──
export type {
  TraceLayer,
  EventAudience,
  ConceptualTraceLayer,
  TraceSourceRole,
} from "./types.js";
export { CONCEPTUAL_LAYER_OF_TRACE_LAYER } from "./types.js";

// ── Trace events ──
export type {
  TraceEventBase,
  LlmEvidenceExtension,
  ToolEvidenceExtension,
  StorageEvidenceExtension,
  TraceEvent,
  TraceLawReason,
  TraceLawViolation,
} from "./trace-event.js";
export {
  validateTraceEvent,
  isTraceLawCompliant,
  assertTraceLaw,
} from "./trace-event.js";

// ── Classification ──
export {
  LIVE_ONLY_EVENTS,
  DURABLE_AUDIT_EVENTS,
  DURABLE_TRANSCRIPT_EVENTS,
  classifyEvent,
  shouldPersist,
} from "./classification.js";

// ── Durable promotion registry ──
export { DurablePromotionRegistry, createDefaultRegistry } from "./durable-promotion-registry.js";
export type { DurablePromotionEntry } from "./durable-promotion-registry.js";

// ── Truncation ──
export { TRACE_OUTPUT_MAX_BYTES, truncateOutput } from "./truncation.js";

// ── Metric names ──
export { METRIC_NAMES } from "./metric-names.js";
export type { MetricName } from "./metric-names.js";

// ── Sink ──
export type { TraceSink } from "./sink.js";

// ── Audit record codec ──
export {
  traceEventToAuditBody,
  auditBodyToTraceEvent,
} from "./audit-record.js";
export type { AuditRecordBody, AuditRecordMeta } from "./audit-record.js";

// ── DO storage sink ──
export { DoStorageTraceSink } from "./sinks/do-storage.js";
export type { DoStorageLike } from "./sinks/do-storage.js";

// ── Timeline ──
export { SessionTimeline } from "./timeline.js";
export type { TraceTimelineReader } from "./timeline.js";

// ── Inspector ──
export {
  SessionInspector,
  SESSION_STREAM_EVENT_KINDS,
  isSessionStreamEventKind,
} from "./inspector.js";
export type {
  InspectorEvent,
  InspectorRejection,
  SessionStreamEventKind,
} from "./inspector.js";

// ── Scenario DSL ──
export type {
  ScenarioStep,
  ScenarioSpec,
  ScenarioResult,
  StepFailure,
} from "./scenario.js";

// ── Scenario runner ──
export { ScenarioRunner } from "./runner.js";
export type { ScenarioSession } from "./runner.js";

// ── Failure replay ──
export { FailureReplayHelper } from "./replay.js";

// ── Anchor + recovery (A3 Phase 3) ──
export {
  TraceRecoveryError,
  TRACE_RECOVERY_REASONS,
  attemptTraceRecovery,
  traceRecoveryError,
} from "./anchor-recovery.js";
export type {
  TraceAnchor,
  TraceCandidate,
  TraceRecoveryOptions,
  TraceRecoveryReason,
} from "./anchor-recovery.js";

// ── Attribution ──
export { buildLlmAttribution, buildToolAttribution } from "./attribution.js";
export type { AttributionRecord } from "./attribution.js";

// ── Storage placement log ──
export { StoragePlacementLog } from "./placement-log.js";
export type { PlacementEntry, PlacementSummaryEntry } from "./placement-log.js";

// ── A7 Phase 6 evidence streams ──
export {
  EvidenceRecorder,
  CALIBRATION_VERDICTS,
  DEFAULT_EVIDENCE_BACKED_MIN_SIGNALS,
  DEFAULT_NEEDS_REVISIT_MIN_CONTRADICTORY,
  DEFAULT_CONTRADICTED_MIN_CONTRADICTORY,
  computeCalibrationVerdict,
} from "./evidence-streams.js";
export type {
  EvidenceAnchor,
  EvidenceRecord,
  EvidenceStream,
  EvidenceSink,
  EvidenceStorageBackend,
  EvidenceStorageOp,
  PlacementEvidence,
  AssemblyEvidence,
  CompactPhase,
  CompactEvidence,
  ArtifactLifecycleStage,
  ArtifactEvidence,
  SnapshotPhase,
  SnapshotEvidence,
  CalibrationVerdict,
  VerdictSignalSummary,
  CalibrationVerdictOptions,
} from "./evidence-streams.js";
export {
  bridgeEvidenceToPlacementLog,
  placementEvidenceFromRecord,
  recordPlacementEvidence,
} from "./evidence-bridge.js";
export {
  aggregateEvidenceVerdict,
  DEFAULT_VERDICT_RULES,
} from "./evidence-verdict.js";
export type {
  VerdictRule,
  VerdictReport,
  VerdictAggregateResult,
} from "./evidence-verdict.js";
