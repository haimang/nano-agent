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
  COMMAND_ALIASES,
  CURL_BASH_NARROW_NOTE,
  TS_EXEC_BASH_NARROW_NOTE,
  TEXT_PROCESSING_BASH_NARROW_NOTE,
} from "./planner.js";

// ── Policy ──
export { CapabilityPolicyGate } from "./policy.js";
export type { PolicyContext } from "./policy.js";

// ── Permission authorizer seam (B5) ──
export type {
  CapabilityPermissionAuthorizer,
  PermissionDecision,
  PermissionRequestContext,
  PermissionVerdict,
} from "./permission.js";

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
export {
  registerMinimalCommands,
  getMinimalCommandDeclarations,
  getAskGatedCommands,
  getAllowGatedCommands,
} from "./fake-bash/commands.js";
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
export {
  createFilesystemHandlers,
  MKDIR_PARTIAL_NOTE,
  WRITE_OVERSIZE_REJECTED_NOTE,
} from "./capabilities/filesystem.js";
export { createSearchHandlers } from "./capabilities/search.js";
export {
  createTextProcessingHandlers,
  TEXT_OUTPUT_MAX_BYTES,
  TEXT_OUTPUT_TRUNCATED_NOTE,
  SED_UNSUPPORTED_NOTE,
  AWK_UNSUPPORTED_NOTE,
  JQ_UNSUPPORTED_NOTE,
} from "./capabilities/text-processing.js";
export {
  createNetworkHandlers,
  CURL_NOT_CONNECTED_NOTE,
  CURL_SCHEME_BLOCKED_NOTE,
  CURL_PRIVATE_ADDRESS_BLOCKED_NOTE,
  CURL_TIMEOUT_NOTE,
  CURL_OUTPUT_TRUNCATED_NOTE,
  CURL_BUDGET_EXHAUSTED_NOTE,
  DEFAULT_CURL_TIMEOUT_MS,
  DEFAULT_CURL_MAX_BYTES,
  createSubrequestBudget,
} from "./capabilities/network.js";
export type {
  CurlStructuredInput,
  CreateNetworkHandlersOptions,
  SubrequestBudget,
} from "./capabilities/network.js";
export {
  createExecHandlers,
  TS_EXEC_PARTIAL_NOTE,
  TS_EXEC_SYNTAX_ERROR_NOTE,
  TS_EXEC_MAX_CODE_BYTES,
} from "./capabilities/exec.js";
export {
  createVcsHandlers,
  GIT_SUPPORTED_SUBCOMMANDS,
  GIT_SUBCOMMAND_BLOCKED_NOTE,
  GIT_PARTIAL_NO_HISTORY_NOTE,
  GIT_PARTIAL_NO_BASELINE_NOTE,
  isSupportedGitSubcommand,
} from "./capabilities/vcs.js";
export type { CreateVcsHandlersOptions } from "./capabilities/vcs.js";

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
