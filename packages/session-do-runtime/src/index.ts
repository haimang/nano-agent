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
export { DEFAULT_RUNTIME_CONFIG } from "./env.js";
export type { SessionRuntimeEnv, RuntimeConfig } from "./env.js";

// ── Composition ──
export { createDefaultCompositionFactory } from "./composition.js";
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
  buildStepTrace,
  mapRuntimeStepKindToTraceKind,
} from "./traces.js";
export type { TraceContext, TraceDeps } from "./traces.js";

// ── NanoSessionDO ──
export { NanoSessionDO } from "./do/nano-session-do.js";
export type { DurableObjectStateLike } from "./do/nano-session-do.js";

// ── Worker entry ──
export { default as workerEntry } from "./worker.js";
export type { WorkerEnv, DurableObjectNamespaceLike } from "./worker.js";
