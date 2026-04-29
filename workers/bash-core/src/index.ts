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

import { NACP_VERSION, errorEnvelope, okEnvelope, type Envelope, type RpcMeta, RpcMetaSchema } from "@haimang/nacp-core";
import { NACP_SESSION_VERSION } from "@haimang/nacp-session";
import { WorkerEntrypoint } from "cloudflare:workers";
import {
  cancelCapabilityCall,
  executeCapabilityCall,
  parseCapabilityCallRequest,
  parseCapabilityCancelRequest,
} from "./worker-runtime.js";

export interface BashCoreEnv {
  readonly ENVIRONMENT?: string;
  readonly OWNER_TAG?: string;
  readonly WORKER_VERSION?: string;
  readonly CAPABILITY_CALL_DO?: DurableObjectNamespace;
  // ZX2 Phase 1 P1-03 — binding-scope guard. ZX2 Phase 3 P3-03 turns this
  // into a hard requirement together with NACP authority validation.
  readonly NANO_INTERNAL_BINDING_SECRET?: string;
}

export interface BashCoreProbeResponse {
  readonly worker: "bash-core";
  readonly nacp_core_version: string;
  readonly nacp_session_version: string;
  readonly status: "ok";
  readonly worker_version: string;
  readonly phase: "worker-matrix-P1.B-absorbed";
  readonly absorbed_runtime: true;
}

function createProbeResponse(env: BashCoreEnv): BashCoreProbeResponse {
  return {
    worker: "bash-core",
    nacp_core_version: NACP_VERSION,
    nacp_session_version: NACP_SESSION_VERSION,
    status: "ok",
    worker_version: env.WORKER_VERSION ?? `bash-core@${env.ENVIRONMENT ?? "dev"}`,
    phase: "worker-matrix-P1.B-absorbed",
    absorbed_runtime: true,
  };
}

function invalidJsonResponse(pathname: string): Response {
  return Response.json(
    {
      error: "invalid-json",
      message: `bash-core ${pathname} expects a JSON request body`,
      worker: "bash-core",
      phase: "worker-matrix-P1.B-absorbed",
    },
    { status: 400 },
  );
}

function invalidShapeResponse(pathname: string, message: string): Response {
  return Response.json(
    {
      error: "invalid-request-shape",
      message,
      worker: "bash-core",
      phase: "worker-matrix-P1.B-absorbed",
    },
    { status: 400 },
  );
}

async function handleCapabilityCall(raw: unknown, env: BashCoreEnv): Promise<Response> {
  const parsed = parseCapabilityCallRequest(raw);
  if (!parsed) {
    return invalidShapeResponse(
      "/capability/call",
      "bash-core /capability/call expects { requestId, capabilityName?, body: { tool_name, tool_input } }",
    );
  }

  const body = await executeCapabilityCall(parsed, {
    previewMode: env.ENVIRONMENT === "preview",
  });
  return Response.json(body);
}

function handleCapabilityCancel(raw: unknown): Response {
  const parsed = parseCapabilityCancelRequest(raw);
  if (!parsed) {
    return invalidShapeResponse(
      "/capability/cancel",
      "bash-core /capability/cancel expects { requestId, body?: { reason } }",
    );
  }

  return Response.json(cancelCapabilityCall(parsed.requestId));
}

async function parseJsonBody(request: Request, pathname: string): Promise<
  { ok: true; body: unknown } | { ok: false; response: Response }
> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false, response: invalidJsonResponse(pathname) };
  }
}

async function maybeForwardToCapabilityDo(
  request: Request,
  env: BashCoreEnv,
  pathname: "/capability/call" | "/capability/cancel",
  body: unknown,
): Promise<Response | null> {
  const namespace = env.CAPABILITY_CALL_DO;
  if (!namespace) return null;

  const parsed =
    pathname === "/capability/call"
      ? parseCapabilityCallRequest(body)
      : parseCapabilityCancelRequest(body);
  if (!parsed) {
    return pathname === "/capability/call"
      ? invalidShapeResponse(
          pathname,
          "bash-core /capability/call expects { requestId, capabilityName?, body: { tool_name, tool_input } }",
        )
      : invalidShapeResponse(
          pathname,
          "bash-core /capability/cancel expects { requestId, body?: { reason } }",
        );
  }

  const id = namespace.idFromName(parsed.requestId);
  const stub = namespace.get(id);
  return stub.fetch(`https://bash-core-internal${pathname}`, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type") ?? "application/json",
      "x-bash-environment": env.ENVIRONMENT ?? "",
    },
    body: JSON.stringify(body),
  });
}

export class CapabilityCallDO {
  constructor(
    readonly state: DurableObjectState,
    readonly env: BashCoreEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method.toUpperCase() !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const parsed = await parseJsonBody(request, pathname);
    if (!parsed.ok) return parsed.response;

    if (pathname === "/capability/call") {
      return handleCapabilityCall(parsed.body, {
        ENVIRONMENT: request.headers.get("x-bash-environment") ?? this.env.ENVIRONMENT,
      });
    }

    if (pathname === "/capability/cancel") {
      return handleCapabilityCancel(parsed.body);
    }

    return new Response("Not Found", { status: 404 });
  }
}

// ZX2 Phase 1 P1-03 (transport-profiles.md / binding-scope guard):
// bash-core 不是 public facade（profile = nacp-internal + health-probe）。
// 仅 /health 公开；其余 /capability/* 调用必须经 service-binding 由 agent-core
// 触达，并满足 ZX2 Phase 3 P3-03 引入的 NACP authority + binding-secret。
// 此守卫为兜底防御层：即便 wrangler workers_dev 未关，公网 fetch 仍 401。
function isInternalBindingCall(request: Request, env: BashCoreEnv): boolean {
  const expected = (env as { NANO_INTERNAL_BINDING_SECRET?: string })
    .NANO_INTERNAL_BINDING_SECRET;
  const provided = request.headers.get("x-nano-internal-binding-secret");
  return Boolean(expected && provided && provided === expected);
}

function bindingScopeForbidden(): Response {
  return Response.json(
    {
      error: "binding-scope-forbidden",
      message:
        "bash-core does not expose public business routes; reach via agent-core service-binding",
      worker: "bash-core",
    },
    { status: 401 },
  );
}

async function bashCoreFetch(request: Request, env: BashCoreEnv): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  // health-probe profile: always public.
  if (method === "GET" && (pathname === "/" || pathname === "/health")) {
    return Response.json(createProbeResponse(env));
  }

  // Everything else demands a valid internal binding-secret. This catches
  // public hits even before NACP authority validation (ZX2 Phase 3 P3-03).
  if (!isInternalBindingCall(request, env)) {
    return bindingScopeForbidden();
  }

  if (method === "POST" && pathname === "/capability/call") {
    const parsed = await parseJsonBody(request, pathname);
    if (!parsed.ok) return parsed.response;

    const forwarded = await maybeForwardToCapabilityDo(request, env, "/capability/call", parsed.body);
    return forwarded ?? handleCapabilityCall(parsed.body, env);
  }

  if (method === "POST" && pathname === "/capability/cancel") {
    const parsed = await parseJsonBody(request, pathname);
    if (!parsed.ok) return parsed.response;

    const forwarded = await maybeForwardToCapabilityDo(request, env, "/capability/cancel", parsed.body);
    return forwarded ?? handleCapabilityCancel(parsed.body);
  }

  return new Response("Not Found", { status: 404 });
}

// ZX2 Phase 3 P3-03 — bash-core promoted to a `WorkerEntrypoint`. fetch
// stays as the legacy compat path (HTTP relay over service-binding); the
// new RPC methods carry NACP authority via the second meta argument.
//
// Authority requirement (mirrors orchestrator-core ↔ agent-core):
//   - meta.trace_uuid (UUID) required
//   - meta.caller    enum required
//   - meta.authority required, with team_uuid + plan_level + stamped_by_key + stamped_at
//   - meta.request_uuid required for /capability/call (idempotency / audit)
export interface BashCoreToolCallResult {
  readonly status: "ok" | "error";
  readonly output?: string;
  readonly error?: { readonly code: string; readonly message: string };
}

export interface BashCoreCancelResult {
  readonly ok: boolean;
  readonly cancelled: boolean;
}

// ZX2 ZX1-ZX2 review (Kimi R5 / GLM): bash-core rpc only admits the
// internal callers that legitimately reach the capability runtime over
// service-binding. Free strings are rejected even when the schema-level
// RpcCallerSchema would accept them (e.g. `web`, `cli`).
const BASH_CORE_ALLOWED_CALLERS = new Set([
  "orchestrator-core",
  "agent-core",
  // "runtime" removed: no worker named "runtime" exists; was a ghost value
  // from an early design that pre-dated the final 6-worker topology.
] as const);

function validateBashRpcMeta(rawMeta: unknown, requireRequestUuid: boolean): { ok: true; meta: RpcMeta } | { ok: false; envelope: Envelope<never> } {
  const parsed = RpcMetaSchema.safeParse(rawMeta);
  if (!parsed.success) {
    return {
      ok: false,
      envelope: errorEnvelope(
        "invalid-meta",
        400,
        "rpc meta failed validation",
        { issues: parsed.error.issues.map((i) => i.message) },
      ),
    };
  }
  if (!parsed.data.authority) {
    return {
      ok: false,
      envelope: errorEnvelope("invalid-authority", 400, "bash-core rpc requires meta.authority"),
    };
  }
  if (!BASH_CORE_ALLOWED_CALLERS.has(parsed.data.caller as typeof BASH_CORE_ALLOWED_CALLERS extends Set<infer U> ? U : never)) {
    return {
      ok: false,
      envelope: errorEnvelope(
        "invalid-caller",
        403,
        `bash-core rpc rejects caller='${parsed.data.caller}'; allowed: orchestrator-core | agent-core | runtime`,
      ),
    };
  }
  if (requireRequestUuid && !parsed.data.request_uuid) {
    return {
      ok: false,
      envelope: errorEnvelope(
        "invalid-meta",
        400,
        "bash-core /capability/call rpc requires meta.request_uuid for idempotency",
      ),
    };
  }
  return { ok: true, meta: parsed.data };
}

export default class BashCoreEntrypoint extends WorkerEntrypoint<BashCoreEnv> {
  async fetch(request: Request): Promise<Response> {
    return bashCoreFetch(request, this.env);
  }

  async call(rawInput: unknown, rawMeta: unknown): Promise<Envelope<BashCoreToolCallResult>> {
    const validated = validateBashRpcMeta(rawMeta, true);
    if (!validated.ok) return validated.envelope;
    const parsedRequest = parseCapabilityCallRequest(rawInput);
    if (!parsedRequest) {
      return errorEnvelope(
        "invalid-input",
        400,
        "bash-core /capability/call rpc expects { requestId, capabilityName?, body: { tool_name, tool_input } }",
      );
    }
    const result = await executeCapabilityCall(parsedRequest, {
      previewMode: this.env.ENVIRONMENT === "preview",
    });
    return okEnvelope(result as BashCoreToolCallResult);
  }

  async cancel(rawInput: unknown, rawMeta: unknown): Promise<Envelope<BashCoreCancelResult>> {
    const validated = validateBashRpcMeta(rawMeta, false);
    if (!validated.ok) return validated.envelope;
    const parsedRequest = parseCapabilityCancelRequest(rawInput);
    if (!parsedRequest) {
      return errorEnvelope(
        "invalid-input",
        400,
        "bash-core /capability/cancel rpc expects { requestId, body?: { reason } }",
      );
    }
    const result = cancelCapabilityCall(parsedRequest.requestId);
    return okEnvelope(result as BashCoreCancelResult);
  }
}

// Backward-compat fetch-shaped worker — kept as a named export so existing
// tests and tooling can still import the legacy fetch-only object. The
// worker module's actual default export is `BashCoreEntrypoint` (above).
export const worker = {
  fetch: bashCoreFetch,
};
