/**
 * @nano-agent/session-do-runtime — Session DO Runtime Assembly Layer
 *
 * Worker / DO composition contract, runtime environment types, and turn
 * ingress contract for the nano-agent Session Durable Object.
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { SESSION_DO_VERSION } from "./version.js";

// ── Environment ──
export {
  DEFAULT_RUNTIME_CONFIG,
  DEFAULT_COMPOSITION_PROFILE,
  V1_BINDING_CATALOG,
  RESERVED_BINDINGS,
  readCompositionProfile,
} from "./env.js";
export type {
  SessionRuntimeEnv,
  RuntimeConfig,
  CompositionMode,
  CompositionProfile,
  ServiceBindingLike,
} from "./env.js";

// ── Composition ──
export {
  createDefaultCompositionFactory,
  resolveCompositionProfile,
} from "./composition.js";

// ── Remote binding adapters (A5 Phase 2-3) ──
export {
  callBindingJson,
  makeHookTransport,
  makeCapabilityTransport,
  makeProviderFetcher,
  makeRemoteBindingsFactory,
} from "./remote-bindings.js";

// ── Cross-seam propagation + failure law (A5 Phase 4) ──
export {
  CROSS_SEAM_HEADERS,
  CROSS_SEAM_FAILURE_REASONS,
  CrossSeamError,
  StartupQueue,
  buildCrossSeamHeaders,
  readCrossSeamHeaders,
  validateCrossSeamAnchor,
  classifySeamError,
} from "./cross-seam.js";
export type {
  CrossSeamAnchor,
  CrossSeamFailureReason,
} from "./cross-seam.js";
export type {
  SubsystemHandles,
  CompositionFactory,
} from "./composition.js";

// ── Turn Ingress ──
export { extractTurnInput, TURN_INGRESS_NOTE } from "./turn-ingress.js";
export type { TurnIngressKind, TurnInput } from "./turn-ingress.js";

// ── Routing ──
export { routeRequest } from "./routes.js";
export type { RouteResult } from "./routes.js";

// ── WebSocket controller ──
export { WsController } from "./ws-controller.js";

// ── HTTP controller ──
export { HttpController } from "./http-controller.js";

// ── Actor state ──
export { createInitialActorState, transitionPhase } from "./actor-state.js";
export type { ActorState, ActorPhase } from "./actor-state.js";

// ── Health ──
export { HealthGate } from "./health.js";
export type { HealthStatus, HeartbeatTracker, AckWindow } from "./health.js";

// ── Checkpoint ──
export {
  buildSessionCheckpoint,
  validateSessionCheckpoint,
  restoreSessionCheckpoint,
  CheckpointInvalidError,
} from "./checkpoint.js";
export type {
  SessionCheckpoint,
  UsageSnapshot,
  CheckpointDeps,
  RestoreDeps,
  RestoredCheckpoint,
} from "./checkpoint.js";

// ── Alarm ──
export { AlarmHandler } from "./alarm.js";
export type { AlarmDeps } from "./alarm.js";

// ── Shutdown ──
export { gracefulShutdown, closeCodeForReason } from "./shutdown.js";
export type { ShutdownReason, ShutdownDeps } from "./shutdown.js";

// ── Orchestration ──
export { SessionOrchestrator } from "./orchestration.js";
export type { OrchestrationDeps, OrchestrationState } from "./orchestration.js";

// ── Traces ──
export {
  buildTurnBeginTrace,
  buildTurnEndTrace,
  buildSessionEndTrace,
  buildStepTrace,
  mapRuntimeStepKindToTraceKind,
  assertTraceLaw,
} from "./traces.js";
export type { TraceContext, TraceDeps, TraceEvent, TraceSourceRole } from "./traces.js";

// ── NanoSessionDO ──
export { NanoSessionDO } from "./do/nano-session-do.js";
export type { DurableObjectStateLike } from "./do/nano-session-do.js";

// ── B6 bounded eval sink (dedup + overflow disclosure) ──
export { BoundedEvalSink, extractMessageUuid } from "./eval-sink.js";
export type {
  EvalSinkEmitArgs,
  EvalSinkOverflowDisclosure,
  EvalSinkStats,
  BoundedEvalSinkOptions,
} from "./eval-sink.js";

// ── Worker entry ──
export { default as workerEntry } from "./worker.js";
export type { WorkerEnv, DurableObjectNamespaceLike } from "./worker.js";
