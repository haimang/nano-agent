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

// ═══════════════════════════════════════════════════════════════════
// Worker entry — binding-first (D02 v0.2 / R3)
// ═══════════════════════════════════════════════════════════════════
//
// This worker is consumed by agent-core via the `CAPABILITY_WORKER`
// service binding. Only two internal paths are reachable:
//   POST /capability/call    → routed to CapabilityRunner.execute (body
//                              shape `{requestId, capabilityName, body}`;
//                              `body` carries the `tool.call.request` NACP
//                              body schema). Wired in D07 / P2; returns 501
//                              until then.
//   POST /capability/cancel  → cancel path (body `{requestId, body}`;
//                              `body` carries `tool.call.cancel`). Wired
//                              in D07 / P2; returns 501 until then.
// GET / and GET /health return the standard probe shape preserving the
// W4 field set plus `absorbed_runtime: true`.
// No public `/tool.call.request` HTTP ingress is exposed.

import { NACP_VERSION } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";

export interface BashCoreEnv {
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
}

export interface BashCoreProbeResponse {
  readonly worker: "bash-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly phase: "worker-matrix-P1.B-absorbed";
  readonly absorbed_runtime: true;
}

function createProbeResponse(): BashCoreProbeResponse {
  return {
    worker: "bash-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    phase: "worker-matrix-P1.B-absorbed",
    absorbed_runtime: true,
  };
}

const worker = {
  async fetch(request: Request, _env: BashCoreEnv): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (method === "GET" && (pathname === "/" || pathname === "/health")) {
      return Response.json(createProbeResponse());
    }

    if (method === "POST" && pathname === "/capability/call") {
      return Response.json(
        {
          error: "capability-call-not-wired",
          message:
            "bash-core /capability/call reached but runtime dispatch is not wired; D07/P2 activation pending.",
          worker: "bash-core",
          phase: "worker-matrix-P1.B-absorbed",
        },
        { status: 501 },
      );
    }

    if (method === "POST" && pathname === "/capability/cancel") {
      return Response.json(
        {
          error: "capability-cancel-not-wired",
          message:
            "bash-core /capability/cancel reached but runtime dispatch is not wired; D07/P2 activation pending.",
          worker: "bash-core",
          phase: "worker-matrix-P1.B-absorbed",
        },
        { status: 501 },
      );
    }

    return new Response("Not Found", { status: 404 });
  },
};

export default worker;
