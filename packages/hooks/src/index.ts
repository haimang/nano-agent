/**
 * @nano-agent/hooks — Lifecycle governance, event catalog, outcome reduction.
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { HOOKS_VERSION } from "./version.js";

// ── Base types ──
export type {
  HookSource,
  HookRuntimeKind,
  HookMatcherConfig,
  HookHandlerConfig,
} from "./types.js";

// ── Event catalog ──
export { HOOK_EVENT_CATALOG, isBlockingEvent } from "./catalog.js";
export type { HookEventName, HookEventMeta } from "./catalog.js";

// ── Outcomes ──
export { aggregateOutcomes } from "./outcome.js";
export type {
  HookOutcomeAction,
  HookOutcome,
  AggregatedHookOutcome,
} from "./outcome.js";

// ── Registry ──
export { HookRegistry } from "./registry.js";

// ── Matcher ──
export { matchEvent } from "./matcher.js";
export type { MatcherKind } from "./matcher.js";

// ── Guards ──
export { withTimeout, checkDepth, DEFAULT_GUARD_OPTIONS } from "./guards.js";
export type { GuardOptions } from "./guards.js";

// ── Dispatcher ──
export { HookDispatcher } from "./dispatcher.js";
export type { HookEmitContext } from "./dispatcher.js";

// ── Runtimes ──
export { LocalTsRuntime } from "./runtimes/local-ts.js";
export type { LocalHookHandler, HookRuntime } from "./runtimes/local-ts.js";
export {
  ServiceBindingRuntime,
  HookRuntimeError,
} from "./runtimes/service-binding.js";
export type {
  HookTransport,
  HookTransportCall,
  HookTransportResult,
  HookRuntimeFailureReason,
  ServiceBindingRuntimeOptions,
} from "./runtimes/service-binding.js";

// ── Core mapping ──
export {
  buildHookEmitBody,
  parseHookOutcomeBody,
  buildHookOutcomeBody,
} from "./core-mapping.js";
export type { HookEmitBody, HookOutcomeBody } from "./core-mapping.js";

// ── Session mapping ──
export { hookEventToSessionBroadcast } from "./session-mapping.js";
export type { HookBroadcastBody } from "./session-mapping.js";

// ── Audit ──
export { buildHookAuditRecord, buildHookAuditEntry } from "./audit.js";
export type {
  AuditRecordBody,
  HookAuditEntry,
  HookTraceContext,
  NacpRefLike,
} from "./audit.js";

// ── Snapshot ──
export { snapshotRegistry, restoreRegistry } from "./snapshot.js";
export type { HookRegistrySnapshot } from "./snapshot.js";
