# nano-agent error codes

> **Single source of truth**: `packages/nacp-core/src/error-registry.ts::listErrorMetas()`.
> This document is the **human-readable mirror** of that runtime registry.
> CI test `packages/nacp-core/test/error-codes-coverage.test.ts` verifies
> that every row in this document matches `listErrorMetas()` output, and
> vice versa. Do not edit by hand without updating the registry; do not
> edit the registry without updating this document.
>
> **101 unique codes** (102 raw registrations across 8 sources, 1 deduped:
> `NACP_REPLAY_OUT_OF_RANGE` registered both at the NACP envelope layer
> and at the session layer; the session-layer entry wins because it is
> more specific). See §0 below for source breakdown.
> Three published packages export this catalog:
> `@haimang/nacp-core` (server, full registry),
> `@haimang/nacp-core/error-codes-client` (client-safe subset, runtime-free),
> `@haimang/nacp-session` (session sub-codes).

---

## 0. Reading this document

- **`code`**: the stable string identifier emitted in `error.code` of any
  `FacadeErrorEnvelope` HTTP response, NACP envelope `error.code` field,
  or WS `system.error` frame body.
- **`category`** (NacpErrorCategory): one of 7 — `validation` /
  `transient` / `dependency` / `permanent` / `security` / `quota` /
  `conflict`. Drives default HTTP status + retry policy.
- **`http_status`**: the HTTP status code the orchestrator-core facade
  uses when this `code` surfaces over HTTP. (NACP-internal codes still
  carry an HTTP status because they may be wrapped into a facade response.)
- **`retryable`**: whether the same input has any chance of succeeding
  on retry. `yes` → client may auto-retry with backoff.
- **`message`**: short human-readable description; not for end-user UI.

**Retention** (RHX2 design v0.5 §7.2 F4): persisted error logs in
`nano_error_log` are kept **14 days**; audit events in `nano_audit_log`
are kept **90 days**. Codes in this catalog do not have their own
retention — only the rows in those two D1 tables do.

---

## 1. RpcErrorCode (30 codes — `packages/nacp-core/src/rpc.ts`)

| code | category | http_status | retryable | message |
|---|---|---|---|---|
| `invalid-request` | validation | 400 | no | RPC request shape rejected by zod |
| `invalid-input` | validation | 400 | no | RPC input parameters failed schema validation |
| `invalid-meta` | validation | 400 | no | RPC meta parameters failed schema validation |
| `invalid-trace` | validation | 400 | no | trace_uuid not a valid UUID |
| `invalid-authority` | security | 401 | no | authority credential invalid |
| `invalid-caller` | security | 403 | no | caller identity not allowed |
| `invalid-session` | validation | 404 | no | session_uuid invalid or unknown |
| `invalid-auth` | security | 401 | no | authentication failed |
| `identity-already-exists` | conflict | 409 | no | identity already registered |
| `identity-not-found` | validation | 404 | no | identity not found |
| `password-mismatch` | security | 401 | no | password did not match |
| `refresh-invalid` | security | 401 | no | refresh token invalid |
| `refresh-expired` | security | 401 | no | refresh token expired |
| `refresh-revoked` | security | 401 | no | refresh token revoked |
| `invalid-wechat-code` | validation | 400 | no | WeChat js_code invalid |
| `invalid-wechat-payload` | dependency | 502 | yes | WeChat upstream payload malformed |
| `permission-denied` | security | 403 | no | permission insufficient |
| `binding-scope-forbidden` | security | 403 | no | service binding outside its declared scope |
| `tenant-mismatch` | security | 403 | no | team_uuid mismatch |
| `authority-escalation` | security | 403 | no | attempt to escalate authority |
| `not-found` | validation | 404 | no | resource not found |
| `conflict` | conflict | 409 | no | resource conflict |
| `session-not-running` | conflict | 409 | no | session not in running phase |
| `session-already-ended` | conflict | 410 | no | session already ended |
| `worker-misconfigured` | permanent | 500 | no | worker missing required binding/secret |
| `rpc-parity-failed` | transient | 500 | yes | RPC parity bridge detected divergence |
| `upstream-timeout` | dependency | 504 | yes | upstream call timed out |
| `rate-limited` | quota | 429 | yes | rate limit reached |
| `not-supported` | validation | 501 | no | feature not supported |
| `internal-error` | transient | 500 | yes | internal worker error |

## 2. FacadeErrorCode (32 codes — `packages/orchestrator-auth-contract/src/facade-http.ts:48`)

`FacadeErrorCode` is a **superset of `AuthErrorCode`** and shares string
identifiers with `RpcErrorCode`. To avoid duplicating data, every
FacadeErrorCode that aligns 1:1 with a RpcErrorCode lives under §1; the
two sources are equivalent at the wire level. The registry's
`resolveErrorMeta()` returns `source: "rpc"` for these.

> **Frontend tip**: read every code in §1 as also valid for facade HTTP
> responses.

## 3. AuthErrorCode (13 codes — `packages/orchestrator-auth-contract/src/auth-error-codes.ts`)

A strict subset of FacadeErrorCode (compile-time enforced). All 13 codes
are listed in §1.

## 4. NACP_* codes (19 codes — `packages/nacp-core/src/error-registry.ts`)

| code | category | http_status | retryable | message |
|---|---|---|---|---|
| `NACP_VALIDATION_FAILED` | validation | 400 | no | envelope schema validation failed |
| `NACP_UNKNOWN_MESSAGE_TYPE` | validation | 400 | no | message_type not in registry |
| `NACP_SIZE_EXCEEDED` | validation | 400 | no | envelope exceeds 96KB, use refs |
| `NACP_VERSION_INCOMPATIBLE` | validation | 400 | no | schema_version below compat floor |
| `NACP_TYPE_DIRECTION_MISMATCH` | validation | 400 | no | delivery_kind not legal for message_type (see NACP 1.3 matrix) |
| `NACP_DEADLINE_EXCEEDED` | transient | 503 | no | message past deadline_ms |
| `NACP_IDEMPOTENCY_CONFLICT` | conflict | 409 | no | idempotency_key already observed |
| `NACP_CAPABILITY_DENIED` | security | 403 | no | capability_scope not granted |
| `NACP_RATE_LIMITED` | quota | 429 | yes | quota or rate limit reached |
| `NACP_BINDING_UNAVAILABLE` | transient | 503 | yes | target service binding unavailable |
| `NACP_HMAC_INVALID` | security | 403 | no | HMAC signature invalid |
| `NACP_TIMESTAMP_SKEW` | security | 403 | no | timestamp skew exceeds 5 minutes |
| `NACP_TENANT_MISMATCH` | security | 403 | no | authority.team_uuid does not match consumer serving team |
| `NACP_TENANT_BOUNDARY_VIOLATION` | security | 403 | no | refs team_uuid or key does not match authority.team_uuid |
| `NACP_TENANT_QUOTA_EXCEEDED` | quota | 429 | yes | tenant quota budget exhausted |
| `NACP_DELEGATION_INVALID` | security | 403 | no | tenant_delegation signature/expiry invalid |
| `NACP_STATE_MACHINE_VIOLATION` | permanent | 500 | no | message not allowed in current session phase |
| `NACP_REPLY_TO_CLOSED` | permanent | 500 | no | reply_to_message_uuid points to closed request |
| `NACP_PRODUCER_ROLE_MISMATCH` | security | 403 | no | producer_role not allowed for this message_type |

## 5. KernelErrorCode (6 codes — `workers/agent-core/src/kernel/errors.ts`)

| code | category | http_status | retryable | message |
|---|---|---|---|---|
| `ILLEGAL_PHASE_TRANSITION` | permanent | 500 | no | kernel phase transition not allowed |
| `TURN_ALREADY_ACTIVE` | conflict | 409 | no | another turn is already active |
| `TURN_NOT_FOUND` | validation | 404 | no | turn_uuid not found in kernel state |
| `STEP_TIMEOUT` | transient | 504 | yes | step exceeded deadline |
| `KERNEL_INTERRUPTED` | transient | 503 | yes | kernel run was interrupted |
| `CHECKPOINT_VERSION_MISMATCH` | permanent | 500 | no | checkpoint protocol version mismatch |

## 6. SessionErrorCode (8 codes — `packages/nacp-session/src/errors.ts`)

| code | category | http_status | retryable | message |
|---|---|---|---|---|
| `NACP_REPLAY_OUT_OF_RANGE` | permanent | 410 | no | replay seq outside buffer |
| `NACP_SESSION_INVALID_PHASE` | permanent | 500 | no | session phase invalid for operation |
| `NACP_SESSION_AUTHORITY_REQUIRED` | security | 401 | no | authority required for session message |
| `NACP_SESSION_FORGED_AUTHORITY` | security | 403 | no | session authority forged |
| `NACP_SESSION_ACK_MISMATCH` | permanent | 500 | no | session ACK does not match expected seq |
| `NACP_SESSION_HEARTBEAT_TIMEOUT` | transient | 503 | yes | session heartbeat timed out |
| `NACP_SESSION_ALREADY_ATTACHED` | conflict | 409 | no | session already has an active attachment |
| `NACP_SESSION_TYPE_DIRECTION_MISMATCH` | permanent | 500 | no | session message kind/direction violation |

> **Note**: `NACP_REPLAY_OUT_OF_RANGE` is registered in BOTH the NACP
> base layer (status 500) and the session layer (status 410). The
> registry's last-write-wins dedupe picks the **session entry (410)** as
> canonical, since that's the one runtime code paths actually emit.

## 7. LLMErrorCategory (8 codes — `workers/agent-core/src/llm/errors.ts`)

| code | category | http_status | retryable | message |
|---|---|---|---|---|
| `llm-auth` | security | 401 | no | LLM provider rejected credentials |
| `llm-rate-limit` | quota | 429 | yes | LLM provider rate-limited the request |
| `llm-context-window` | validation | 400 | no | request exceeded model context window |
| `llm-content-policy` | validation | 400 | no | LLM provider blocked content |
| `llm-bad-request` | validation | 400 | no | LLM provider rejected the request |
| `llm-service-unavailable` | dependency | 503 | yes | LLM provider temporarily unavailable |
| `llm-timeout` | dependency | 504 | yes | LLM provider request timed out |
| `llm-other` | transient | 500 | yes | LLM provider error |

## 8. ad-hoc string codes (31 codes — 7 bash-core + 24 facade/session surface)

> Q-Obs9 owner-answered: ad-hoc string codes are NOT promoted to a zod
> enum in first-wave (preserves the relevant worker contract stability).
> They MUST appear in this catalog so clients can look them up.
>
> RHX2 review-of-reviews fix (DeepSeek R2 / GLM R3): the 24 facade/session-surface
> ad-hoc codes that orchestrator-core actually emits at runtime are now
> registered here so `resolveErrorMeta()` no longer returns undefined.

### 8.1 bash-core ad-hoc (7 codes)

| code | category | http_status | retryable | message |
|---|---|---|---|---|
| `empty-command` | validation | 400 | no | bash-core received an empty command |
| `policy-denied` | security | 403 | no | bash-core policy denied execution |
| `session-not-found` | validation | 404 | no | bash-core session_uuid unknown |
| `execution-timeout` | transient | 504 | yes | bash-core execution timed out |
| `execution-failed` | transient | 500 | yes | bash-core execution failed |
| `bridge-not-found` | validation | 404 | no | bash-core bridge target missing |
| `handler-error` | transient | 500 | yes | bash-core handler threw an unhandled error |

### 8.2 orchestrator-core facade/session-surface ad-hoc (24 codes)

| code | category | http_status | retryable | message |
|---|---|---|---|---|
| `missing-team-claim` | security | 403 | no | JWT must include team_uuid or tenant_uuid |
| `invalid-auth-body` | validation | 400 | no | auth route requires a JSON body |
| `invalid-start-body` | validation | 400 | no | /sessions/{id}/start requires a JSON body |
| `invalid-input-body` | validation | 400 | no | /sessions/{id}/input requires non-empty text |
| `invalid-auth-snapshot` | validation | 400 | no | /start internal auth snapshot invalid |
| `session_missing` | validation | 404 | no | session not found |
| `session-pending-only-start-allowed` | conflict | 409 | no | pending session only accepts /start |
| `session-expired` | conflict | 409 | no | pending session expired |
| `session-already-started` | conflict | 409 | no | session already started |
| `session_terminal` | conflict | 409 | no | session is in a terminal state |
| `conversation-deleted` | conflict | 409 | no | parent conversation has been soft-deleted |
| `agent-start-failed` | dependency | 502 | yes | agent-core /start failed |
| `agent-rpc-unavailable` | dependency | 503 | yes | agent-core RPC binding unavailable |
| `agent-rpc-throw` | dependency | 502 | yes | agent-core RPC throw |
| `models-d1-unavailable` | dependency | 503 | yes | models D1 lookup failed |
| `wrong-device` | security | 403 | no | session is bound to another device |
| `usage-d1-unavailable` | dependency | 503 | yes | usage ledger temporarily unavailable |
| `model-unavailable` | validation | 400 | no | requested model is not active |
| `model-disabled` | security | 403 | no | requested model is disabled for this team |
| `context-rpc-unavailable` | dependency | 503 | yes | context-core RPC failed |
| `filesystem-rpc-unavailable` | dependency | 503 | yes | filesystem-core RPC failed |
| `payload-too-large` | validation | 413 | no | file exceeds 25 MiB upload limit |
| `spike-disabled` | security | 403 | no | preview-only verify spike trigger disabled |
| `no-attached-client` | conflict | 409 | no | operation requires an attached websocket client |

---

## Appendix A. smind-admin response-shape divergence (DeepSeek S1)

`smind-admin` and `nano-agent` both return `{ ok: false, error: {...},
trace_*: ... }` envelopes, but the inner `error` field shape diverges:

| field | smind-admin | nano-agent |
|---|---|---|
| `error.code` | identical | identical |
| `error.category` | present (7-class string) | absent at HTTP wire (sourced via `resolveErrorMeta`) |
| `error.status` | absent | present (HTTP status) |
| `error.message` | identical | identical |
| `error.detail` | optional, schema-loose | renamed to `error.details`, same semantics |
| top-level | `trace_id` | `trace_uuid` |

**First-wave decision** (Q-Obs10 / S1): no convergence; the two systems
operate against different consumer bases. If/when smind-admin starts
calling nano-agent's facade through `ORCHESTRATOR_CORE` RPC, owner will
re-evaluate.

## Appendix B. Client-side category mapping (F12)

`@haimang/nacp-core/error-codes-client` exposes an 8-class
`ClientErrorCategory` enum (legacy `clients/web/src/apis/transport.ts`
4-class output extended with 4 more):

| client class | maps from server category | example codes |
|---|---|---|
| `auth.expired` | security (auth-flavoured) | `invalid-auth`, `refresh-expired`, `password-mismatch`, `NACP_HMAC_INVALID` |
| `quota.exceeded` | quota | `rate-limited`, `NACP_RATE_LIMITED`, `NACP_TENANT_QUOTA_EXCEEDED` |
| `runtime.error` | permanent | `worker-misconfigured`, `NACP_STATE_MACHINE_VIOLATION` |
| `request.error` | validation (most 4xx) | `invalid-session`, `not-found` |
| `validation.failed` | validation (input-shape) | `invalid-request`, `invalid-input`, `invalid-meta` |
| `security.denied` | security (non-auth) | `permission-denied`, `tenant-mismatch`, `binding-scope-forbidden` |
| `dependency.unavailable` | transient + dependency | `upstream-timeout`, `NACP_BINDING_UNAVAILABLE`, `llm-service-unavailable` |
| `conflict.state` | conflict | `conflict`, `session-not-running`, `NACP_SESSION_ALREADY_ATTACHED` |

The mapping is implemented in
`packages/nacp-core/src/error-registry-client/data.ts::mapCategory()`.
