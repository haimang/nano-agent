/**
 * @nano-agent/capability-runtime — Capability Runtime, Typed Execution Layer
 *
 * This is the public API surface. All consumers should import from here.
 */

// ── Version ──
export { CAPABILITY_VERSION } from "./version.js";

// ── Core Types ──
export type {
  CapabilityKind,
  ExecutionTarget,
  PolicyDecision,
  CapabilityDeclaration,
  CapabilityPlan,
  CapabilityMetadata,
} from "./types.js";

// ── Events ──
export type {
  CapabilityEventKind,
  CapabilityEvent,
} from "./events.js";

// ── Results ──
export { INLINE_RESULT_MAX_BYTES } from "./result.js";
export type {
  CapabilityResultKind,
  CapabilityResult,
} from "./result.js";

// ── Registry ──
export type { CapabilityRegistry } from "./registry.js";
export { InMemoryCapabilityRegistry } from "./registry.js";

// ── Planner ──
export {
  planFromBashCommand,
  planFromToolCall,
  parseSimpleCommand,
} from "./planner.js";

// ── Policy ──
export { CapabilityPolicyGate } from "./policy.js";
export type { PolicyContext } from "./policy.js";

// ── Executor ──
export { CapabilityExecutor } from "./executor.js";
export type { TargetHandler, ExecutorOptions } from "./executor.js";

// ── Targets ──
export { LocalTsTarget } from "./targets/local-ts.js";
export type { LocalCapabilityHandler } from "./targets/local-ts.js";
export { ServiceBindingTarget } from "./targets/service-binding.js";
export { BrowserRenderingTarget } from "./targets/browser-rendering.js";

// ── Fake Bash ──
export { FakeBashBridge } from "./fake-bash/bridge.js";
export { registerMinimalCommands } from "./fake-bash/commands.js";
export type { RegisterMinimalCommandsOptions } from "./fake-bash/commands.js";
export {
  UNSUPPORTED_COMMANDS,
  OOM_RISK_COMMANDS,
  isUnsupported,
  isOomRisk,
  getUnsupportedMessage,
  getOomRiskMessage,
} from "./fake-bash/unsupported.js";

// ── Tool Call Bridge ──
export {
  buildToolCallRequest,
  buildToolCallCancelBody,
  parseToolCallResponse,
} from "./tool-call.js";
export type {
  ToolCallRequestBody,
  ToolCallResponseBody,
  ToolCallCancelBody,
} from "./tool-call.js";

// ── Artifact Promotion ──
export { shouldPromote } from "./artifact-promotion.js";
export type { PromotionDecision } from "./artifact-promotion.js";

// ── Capabilities ──
export { createFilesystemHandlers } from "./capabilities/filesystem.js";
export { createSearchHandlers } from "./capabilities/search.js";
export { createNetworkHandlers } from "./capabilities/network.js";
export { createExecHandlers } from "./capabilities/exec.js";
export { createVcsHandlers } from "./capabilities/vcs.js";

// ── A8 Phase 1 — workspace truth + path law ──
export {
  DEFAULT_WORKSPACE_ROOT,
  RESERVED_NAMESPACE_PREFIX,
  isReservedNamespacePath,
  resolveWorkspacePath,
  resolveWorkspacePathOrThrow,
} from "./capabilities/workspace-truth.js";
export type {
  WorkspacePathError,
  WorkspacePathResult,
  WorkspaceFsLike,
} from "./capabilities/workspace-truth.js";
