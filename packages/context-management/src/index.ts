/**
 * @nano-agent/context-management
 *
 * Public API surface for the context-management package. Three
 * submodules:
 *   - `budget/`            — token / compact policy contract
 *   - `async-compact/`     — PX canonical lifecycle implementation
 *   - `inspector-facade/`  — context-specific HTTP/WS inspection
 *
 * All consumers should import from the package root or a submodule
 * subpath (e.g. `@nano-agent/context-management/budget`).
 */

// ── Version ──
export { CONTEXT_MANAGEMENT_VERSION } from "./version.js";

// ── Budget submodule (re-export at root for convenience) ──
export {
  DEFAULT_COMPACT_POLICY,
  mergeCompactPolicy,
  effectivePromptBudget,
  usagePct,
  headroomTokens,
  shouldArm,
  shouldHardFallback,
  applyEnvOverride,
} from "./budget/index.js";
export type {
  BufferPolicy,
  CompactPolicy,
  CompactPolicyOverride,
  CategoryUsage,
  UsageSnapshot,
  EnvLike,
  ApplyEnvOverrideOptions,
} from "./budget/index.js";

// ── Async-compact submodule ──
export {
  AsyncCompactOrchestrator,
  type AsyncCompactOrchestratorConfig,
  type CommitOutcome,
  type CompactState,
  type CompactStateSnapshot,
  type ContextCandidate,
  type PreparedSummary,
  type LifecycleEvent,
  type LifecycleEventEmitter,
  type LlmSummarizeProvider,
  type SnapshotMetadata,
  noopLifecycleEmitter,
  bridgeToHookDispatcher,
  COMPACT_LIFECYCLE_EVENT_NAMES,
  createKernelCompactDelegate,
  type CreateKernelAdapterConfig,
  type KernelCompactDelegate,
} from "./async-compact/index.js";

// ── Inspector facade submodule ──
export {
  InspectorFacade,
  mountInspectorFacade,
  buildUsageReport,
  redactSecrets,
  parseBearer,
  isIpAllowed,
  INSPECTOR_HEADER_BEARER,
  INSPECTOR_HEADER_IP_BYPASS,
  INSPECTOR_HEADER_TRACE_UUID,
  INSPECTOR_DEDUP_CAVEAT,
  type InspectorFacadeConfig,
  type InspectorAuthConfig,
  type UsageReport,
  type LayerView,
  type PolicyView,
  type CompactStateInspectorView,
  type SubscribeFilter,
  type StreamSubscription,
  type MountInspectorOptions,
} from "./inspector-facade/index.js";
