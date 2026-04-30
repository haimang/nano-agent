/**
 * NACP Error Registry — centralized definitions for all known error codes.
 *
 * Every NACP error has a code, category, retryable flag, and human-readable message.
 * Categories map directly to retry decisions and HTTP status codes.
 *
 * Inspired by SMCP's error_registry.ts (context/smcp/src/runtime/error_registry.ts).
 */

import { z } from "zod";

export const NacpErrorCategorySchema = z.enum([
  "validation",
  "transient",
  "dependency",
  "permanent",
  "security",
  "quota",
  "conflict",
]);
export type NacpErrorCategory = z.infer<typeof NacpErrorCategorySchema>;

export const NacpErrorSchema = z.object({
  code: z.string().min(1).max(64),
  category: NacpErrorCategorySchema,
  message: z.string().min(1).max(512),
  detail: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
});
export type NacpError = z.infer<typeof NacpErrorSchema>;

export interface NacpErrorDefinition {
  code: string;
  category: NacpErrorCategory;
  retryable: boolean;
  message: string;
}

const RETRYABLE_CATEGORIES: ReadonlySet<NacpErrorCategory> = new Set([
  "transient",
  "dependency",
  "quota",
]);

export function isRetryableCategory(category: NacpErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

const _registry = new Map<string, NacpErrorDefinition>();

function def(
  code: string,
  category: NacpErrorCategory,
  retryable: boolean,
  message: string,
): void {
  _registry.set(code, { code, category, retryable, message });
}

// ── Core validation ──
def("NACP_VALIDATION_FAILED", "validation", false, "envelope schema validation failed");
def("NACP_UNKNOWN_MESSAGE_TYPE", "validation", false, "message_type not in registry");
def("NACP_SIZE_EXCEEDED", "validation", false, "envelope exceeds 96KB, use refs");
def("NACP_VERSION_INCOMPATIBLE", "validation", false, "schema_version below compat floor");
def("NACP_TYPE_DIRECTION_MISMATCH", "validation", false, "delivery_kind not legal for message_type (see NACP 1.3 matrix)");

// ── Runtime delivery ──
def("NACP_DEADLINE_EXCEEDED", "transient", false, "message past deadline_ms");
def("NACP_IDEMPOTENCY_CONFLICT", "conflict", false, "idempotency_key already observed");
def("NACP_CAPABILITY_DENIED", "security", false, "capability_scope not granted");
def("NACP_RATE_LIMITED", "quota", true, "quota or rate limit reached");
def("NACP_BINDING_UNAVAILABLE", "transient", true, "target service binding unavailable");

// ── HTTP callback ──
def("NACP_HMAC_INVALID", "security", false, "HMAC signature invalid");
def("NACP_TIMESTAMP_SKEW", "security", false, "timestamp skew exceeds 5 minutes");

// ── Multi-tenant ──
def("NACP_TENANT_MISMATCH", "security", false, "authority.team_uuid does not match consumer serving team");
def("NACP_TENANT_BOUNDARY_VIOLATION", "security", false, "refs team_uuid or key does not match authority.team_uuid");
def("NACP_TENANT_QUOTA_EXCEEDED", "quota", true, "tenant quota budget exhausted");
def("NACP_DELEGATION_INVALID", "security", false, "tenant_delegation signature/expiry invalid");

// ── State machine ──
def("NACP_STATE_MACHINE_VIOLATION", "permanent", false, "message not allowed in current session phase");
def("NACP_REPLY_TO_CLOSED", "permanent", false, "reply_to_message_uuid points to closed request");
def("NACP_PRODUCER_ROLE_MISMATCH", "security", false, "producer_role not allowed for this message_type");
def("NACP_REPLAY_OUT_OF_RANGE", "permanent", false, "replay_from seq out of buffer range");

export function resolveErrorDefinition(code: string): NacpErrorDefinition | null {
  return _registry.get(code) ?? null;
}

export function listErrorDefinitions(): NacpErrorDefinition[] {
  return [..._registry.values()];
}

export function registerErrorDefinition(definition: NacpErrorDefinition): void {
  NacpErrorCategorySchema.parse(definition.category);
  _registry.set(definition.code, definition);
}

export function mapErrorCategoryToStatus(category: NacpErrorCategory): number {
  switch (category) {
    case "validation":
      return 400;
    case "security":
      return 403;
    case "quota":
      return 429;
    case "conflict":
      return 409;
    case "dependency":
    case "transient":
      return 503;
    case "permanent":
      return 500;
  }
}

// ─────────────────────────────────────────────────────────────────
// RHX2 P2-01 — unified error meta across all 7 enum sources.
//
// Owner立场 (RHX2 design v0.5 §6.1 取舍 2): nano-agent uses 7 distinct
// error code enums (Rpc / Facade / Auth / NACP / Kernel / Session / LLM)
// because each owns a clean responsibility boundary. We do NOT collapse
// them into a single mega-enum (that would erase the boundary and force
// every package to depend on the union).
//
// What we DO need is a unified "what does this code mean to a downstream
// consumer" lookup — ergonomically `resolveErrorMeta(code)`. This is
// what the registry below provides. The data is hand-mirrored from the
// authoritative source files; CI tests in
// `test/error-codes-coverage.test.ts` parse those source files and
// fail if any code drifts.
// ─────────────────────────────────────────────────────────────────

export type ErrorMetaSource =
  | "rpc"
  | "facade"
  | "auth"
  | "nacp"
  | "kernel"
  | "session"
  | "llm"
  | "ad-hoc";

export interface ErrorMeta {
  code: string;
  source: ErrorMetaSource;
  category: NacpErrorCategory;
  http_status: number;
  retryable: boolean;
  message: string;
}

const m = (
  code: string,
  source: ErrorMetaSource,
  category: NacpErrorCategory,
  http_status: number,
  retryable: boolean,
  message: string,
): ErrorMeta => ({ code, source, category, http_status, retryable, message });

// 30 codes — `RpcErrorCode` enum (`packages/nacp-core/src/rpc.ts`).
const RPC_ERROR_METAS: readonly ErrorMeta[] = [
  m("invalid-request", "rpc", "validation", 400, false, "RPC request shape rejected by zod"),
  m("invalid-input", "rpc", "validation", 400, false, "RPC input parameters failed schema validation"),
  m("invalid-meta", "rpc", "validation", 400, false, "RPC meta parameters failed schema validation"),
  m("invalid-trace", "rpc", "validation", 400, false, "trace_uuid not a valid UUID"),
  m("invalid-authority", "rpc", "security", 401, false, "authority credential invalid"),
  m("invalid-caller", "rpc", "security", 403, false, "caller identity not allowed"),
  m("invalid-session", "rpc", "validation", 404, false, "session_uuid invalid or unknown"),
  m("invalid-auth", "rpc", "security", 401, false, "authentication failed"),
  m("identity-already-exists", "rpc", "conflict", 409, false, "identity already registered"),
  m("identity-not-found", "rpc", "validation", 404, false, "identity not found"),
  m("password-mismatch", "rpc", "security", 401, false, "password did not match"),
  m("refresh-invalid", "rpc", "security", 401, false, "refresh token invalid"),
  m("refresh-expired", "rpc", "security", 401, false, "refresh token expired"),
  m("refresh-revoked", "rpc", "security", 401, false, "refresh token revoked"),
  m("invalid-wechat-code", "rpc", "validation", 400, false, "WeChat js_code invalid"),
  m("invalid-wechat-payload", "rpc", "dependency", 502, true, "WeChat upstream payload malformed"),
  m("permission-denied", "rpc", "security", 403, false, "permission insufficient"),
  m("binding-scope-forbidden", "rpc", "security", 403, false, "service binding outside its declared scope"),
  m("tenant-mismatch", "rpc", "security", 403, false, "team_uuid mismatch"),
  m("authority-escalation", "rpc", "security", 403, false, "attempt to escalate authority"),
  m("not-found", "rpc", "validation", 404, false, "resource not found"),
  m("conflict", "rpc", "conflict", 409, false, "resource conflict"),
  m("session-not-running", "rpc", "conflict", 409, false, "session not in running phase"),
  m("session-already-ended", "rpc", "conflict", 410, false, "session already ended"),
  m("worker-misconfigured", "rpc", "permanent", 500, false, "worker missing required binding/secret"),
  m("rpc-parity-failed", "rpc", "transient", 500, true, "RPC parity bridge detected divergence"),
  m("upstream-timeout", "rpc", "dependency", 504, true, "upstream call timed out"),
  m("rate-limited", "rpc", "quota", 429, true, "rate limit reached"),
  m("not-supported", "rpc", "validation", 501, false, "feature not supported"),
  m("internal-error", "rpc", "transient", 500, true, "internal worker error"),
];

// 30 codes — `FacadeErrorCode` enum
// (`packages/orchestrator-auth-contract/src/facade-http.ts:48`). It is a
// SUPERSET of AuthErrorCode and shares string identifiers with RpcErrorCode
// (intentional: facade re-uses the same canonical names). To keep the
// registry's lookup-by-code well-defined, the same string is registered
// under `source: "facade"` only when the facade's HTTP status / category
// differ from the rpc entry; otherwise we let the rpc entry stand.
//
// In practice every Facade code currently aligns 1:1 with the rpc entry,
// so we do not duplicate them here — `resolveErrorMeta()` returns the
// rpc-source meta and consumers may treat it as facade-equivalent. The
// CI parity test asserts the alignment.
const FACADE_ERROR_METAS: readonly ErrorMeta[] = [];

// 13 codes — `AuthErrorCode` enum
// (`packages/orchestrator-auth-contract/src/auth-error-codes.ts`). These
// are a STRICT SUBSET of RpcErrorCode (compile-time enforced in
// orchestrator-auth-contract). We do not duplicate the entries here.
const AUTH_ERROR_METAS: readonly ErrorMeta[] = [];

// 19 codes — NACP_* (already registered above via `def(...)` calls
// targeting the legacy `NacpErrorDefinition` registry). We mirror them
// into the unified `ErrorMeta` form here so `resolveErrorMeta()` is
// homogeneous over all 80+ codes. Phase 2 keeps both registries; future
// RHX may merge them.
const NACP_ERROR_METAS: readonly ErrorMeta[] = listErrorDefinitions().map((d) =>
  m(d.code, "nacp", d.category, mapErrorCategoryToStatus(d.category), d.retryable, d.message),
);

// 6 codes — `KernelErrorCode` enum (`workers/agent-core/src/kernel/errors.ts`).
const KERNEL_ERROR_METAS: readonly ErrorMeta[] = [
  m("ILLEGAL_PHASE_TRANSITION", "kernel", "permanent", 500, false, "kernel phase transition not allowed"),
  m("TURN_ALREADY_ACTIVE", "kernel", "conflict", 409, false, "another turn is already active"),
  m("TURN_NOT_FOUND", "kernel", "validation", 404, false, "turn_uuid not found in kernel state"),
  m("STEP_TIMEOUT", "kernel", "transient", 504, true, "step exceeded deadline"),
  m("KERNEL_INTERRUPTED", "kernel", "transient", 503, true, "kernel run was interrupted"),
  m("CHECKPOINT_VERSION_MISMATCH", "kernel", "permanent", 500, false, "checkpoint protocol version mismatch"),
];

// 8 codes — `SESSION_ERROR_CODES` (`packages/nacp-session/src/errors.ts`).
const SESSION_ERROR_METAS: readonly ErrorMeta[] = [
  m("NACP_SESSION_INVALID_PHASE", "session", "permanent", 500, false, "session phase invalid for operation"),
  m("NACP_SESSION_AUTHORITY_REQUIRED", "session", "security", 401, false, "authority required for session message"),
  m("NACP_SESSION_FORGED_AUTHORITY", "session", "security", 403, false, "session authority forged"),
  m("NACP_REPLAY_OUT_OF_RANGE", "session", "permanent", 410, false, "replay seq outside buffer"),
  m("NACP_SESSION_ACK_MISMATCH", "session", "permanent", 500, false, "session ACK does not match expected seq"),
  m("NACP_SESSION_HEARTBEAT_TIMEOUT", "session", "transient", 503, true, "session heartbeat timed out"),
  m("NACP_SESSION_ALREADY_ATTACHED", "session", "conflict", 409, false, "session already has an active attachment"),
  m("NACP_SESSION_TYPE_DIRECTION_MISMATCH", "session", "permanent", 500, false, "session message kind/direction violation"),
];

// 8 codes — `LLMErrorCategory` enum (`workers/agent-core/src/llm/errors.ts`).
const LLM_ERROR_METAS: readonly ErrorMeta[] = [
  m("llm-auth", "llm", "security", 401, false, "LLM provider rejected credentials"),
  m("llm-rate-limit", "llm", "quota", 429, true, "LLM provider rate-limited the request"),
  m("llm-context-window", "llm", "validation", 400, false, "request exceeded model context window"),
  m("llm-content-policy", "llm", "validation", 400, false, "LLM provider blocked content"),
  m("llm-bad-request", "llm", "validation", 400, false, "LLM provider rejected the request"),
  m("llm-service-unavailable", "llm", "dependency", 503, true, "LLM provider temporarily unavailable"),
  m("llm-timeout", "llm", "dependency", 504, true, "LLM provider request timed out"),
  m("llm-other", "llm", "transient", 500, true, "LLM provider error"),
];

// ad-hoc string codes — bash-core + facade (Q-Obs9 owner-answered: not
// promoted to zod enum in first-wave, but MUST be registered in the
// registry/docs so clients can look them up).
//
// RHX2 review-of-reviews fix (DeepSeek R2 / GLM R3): the 10 facade-level
// ad-hoc codes that orchestrator-core actually emits at runtime are
// registered here so `resolveErrorMeta()` no longer returns undefined for
// them. They are documented in `clients/api-docs/error-index.md`
// "Current Ad-hoc Public Codes".
const AD_HOC_ERROR_METAS: readonly ErrorMeta[] = [
  // bash-core 7 (RHX2 P2-01 first-wave).
  m("empty-command", "ad-hoc", "validation", 400, false, "bash-core received an empty command"),
  m("policy-denied", "ad-hoc", "security", 403, false, "bash-core policy denied execution"),
  m("session-not-found", "ad-hoc", "validation", 404, false, "bash-core session_uuid unknown"),
  m("execution-timeout", "ad-hoc", "transient", 504, true, "bash-core execution timed out"),
  m("execution-failed", "ad-hoc", "transient", 500, true, "bash-core execution failed"),
  m("bridge-not-found", "ad-hoc", "validation", 404, false, "bash-core bridge target missing"),
  m("handler-error", "ad-hoc", "transient", 500, true, "bash-core handler threw an unhandled error"),
  // orchestrator-core facade 10 (RHX2 review-of-reviews fix).
  m("missing-team-claim", "ad-hoc", "security", 403, false, "JWT must include team_uuid or tenant_uuid"),
  m("invalid-auth-body", "ad-hoc", "validation", 400, false, "auth route requires a JSON body"),
  m("invalid-start-body", "ad-hoc", "validation", 400, false, "/sessions/{id}/start requires a JSON body"),
  m("invalid-input-body", "ad-hoc", "validation", 400, false, "/sessions/{id}/input requires non-empty text"),
  m("invalid-auth-snapshot", "ad-hoc", "validation", 400, false, "/start internal auth snapshot invalid"),
  m("session_missing", "ad-hoc", "validation", 404, false, "session not found"),
  m("session-pending-only-start-allowed", "ad-hoc", "conflict", 409, false, "pending session only accepts /start"),
  m("session-expired", "ad-hoc", "conflict", 409, false, "pending session expired"),
  m("session-already-started", "ad-hoc", "conflict", 409, false, "session already started"),
  m("session_terminal", "ad-hoc", "conflict", 409, false, "session is in a terminal state"),
  m("agent-start-failed", "ad-hoc", "dependency", 502, true, "agent-core /start failed"),
  m("agent-rpc-unavailable", "ad-hoc", "dependency", 503, true, "agent-core RPC binding unavailable"),
  m("agent-rpc-throw", "ad-hoc", "dependency", 502, true, "agent-core RPC throw"),
  m("models-d1-unavailable", "ad-hoc", "dependency", 503, true, "models D1 lookup failed"),
  m("context-rpc-unavailable", "ad-hoc", "dependency", 503, true, "context-core RPC failed"),
  m("filesystem-rpc-unavailable", "ad-hoc", "dependency", 503, true, "filesystem-core RPC failed"),
  m("payload-too-large", "ad-hoc", "validation", 413, false, "file exceeds 25 MiB upload limit"),
];

// Sources are concatenated in increasing specificity order. When the
// same code appears in multiple sources (e.g. `NACP_REPLAY_OUT_OF_RANGE`
// is registered both at the NACP envelope layer and at the session
// layer), the **later, more specific** entry wins — that's the one
// callers will actually emit at runtime.
const _RAW_ERROR_METAS: readonly ErrorMeta[] = [
  ...RPC_ERROR_METAS,
  ...FACADE_ERROR_METAS,
  ...AUTH_ERROR_METAS,
  ...NACP_ERROR_METAS,
  ...KERNEL_ERROR_METAS,
  ...SESSION_ERROR_METAS,
  ...LLM_ERROR_METAS,
  ...AD_HOC_ERROR_METAS,
];

// RHX2 review-of-reviews fix (DeepSeek R5): track cross-source duplicate
// codes so callers/tests can assert that the only intentional duplicate
// is `NACP_REPLAY_OUT_OF_RANGE`. Any unintentional collision shows up
// here and is caught by `test/error-codes-coverage.test.ts`.
const _crossSourceDuplicates = new Map<string, ErrorMetaSource[]>();

const _byCode: Map<string, ErrorMeta> = (() => {
  const map = new Map<string, ErrorMeta>();
  const seen = new Map<string, ErrorMetaSource>();
  for (const meta of _RAW_ERROR_METAS) {
    const prev = seen.get(meta.code);
    if (prev !== undefined && prev !== meta.source) {
      const list = _crossSourceDuplicates.get(meta.code) ?? [prev];
      if (!list.includes(meta.source)) list.push(meta.source);
      _crossSourceDuplicates.set(meta.code, list);
    }
    seen.set(meta.code, meta.source);
    map.set(meta.code, meta); // last-write-wins
  }
  return map;
})();

/**
 * Codes that appear under more than one ErrorMetaSource. The CI test
 * `error-codes-coverage.test.ts` asserts the expected allow-list (the
 * only intentional collision today is `NACP_REPLAY_OUT_OF_RANGE`).
 */
export function listCrossSourceDuplicateCodes(): ReadonlyMap<string, readonly ErrorMetaSource[]> {
  return _crossSourceDuplicates;
}

// Public list is the deduped view (one entry per code). Insertion order
// follows _RAW_ERROR_METAS, but later duplicates carry forward into the
// canonical entry's source slot via Map's last-write-wins behaviour.
const ALL_ERROR_METAS_LIST: readonly ErrorMeta[] = [..._byCode.values()];

/**
 * Look up unified error meta by code. Returns `undefined` for unknown
 * codes; callers should treat that as "client error catalog out-of-date,
 * fall back to HTTP-status classification" (mirrors
 * `error-registry-client/getErrorMeta`).
 */
export function resolveErrorMeta(code: string): ErrorMeta | undefined {
  return _byCode.get(code);
}

/** Read-only view of the full registry. Used by docs + CI parity. */
export function listErrorMetas(): readonly ErrorMeta[] {
  return ALL_ERROR_METAS_LIST;
}

/** Distinct sources currently represented in the registry. */
export function listErrorMetaSources(): readonly ErrorMetaSource[] {
  return ["rpc", "nacp", "kernel", "session", "llm", "ad-hoc"] as const;
}
