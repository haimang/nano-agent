/**
 * @nano-agent/eval-observability — Trace taxonomy, classification, metrics, truncation.
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { EVAL_VERSION } from "./version.js";

// ── Base types ──
export type { TraceLayer, EventAudience } from "./types.js";

// ── Trace events ──
export type {
  TraceEventBase,
  LlmEvidenceExtension,
  ToolEvidenceExtension,
  StorageEvidenceExtension,
  TraceEvent,
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

// ── Attribution ──
export { buildLlmAttribution, buildToolAttribution } from "./attribution.js";
export type { AttributionRecord } from "./attribution.js";

// ── Storage placement log ──
export { StoragePlacementLog } from "./placement-log.js";
export type { PlacementEntry, PlacementSummaryEntry } from "./placement-log.js";
