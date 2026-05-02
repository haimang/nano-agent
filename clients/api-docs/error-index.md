# Error Index and Client Classification — hero-to-pro Frozen Pack

> Source of truth:
> - public facade codes: `packages/orchestrator-auth-contract/src/facade-http.ts`
> - unified meta lookup: `packages/nacp-core/src/error-registry.ts`
> - WS structured error frame: `packages/nacp-session/src/stream-event.ts`
> - **long-form catalog**: `docs/api/error-codes.md`
>
> 文档基线: HP8 code freeze + HP9 docs freeze。HP5-HP7 新增的 ad-hoc public codes 已统一登记。

## HTTP Error Envelope

All `facade-http-v1` errors use:

```json
{
  "ok": false,
  "error": {
    "code": "invalid-auth",
    "status": 401,
    "message": "token missing, invalid, or expired",
    "details": { "optional": true }
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

Client rules:

1. Use `error.code` as the primary key.
2. Use `error.status` only as fallback; a few current ad-hoc codes are not yet in the facade enum.
3. Always log/report `trace_uuid` with user-visible failures.
4. Treat `401 invalid-auth` as "refresh/login required" only after refresh path fails; device revoke also maps to `invalid-auth`.
5. Treat retryable 5xx/dependency categories with backoff; do not auto-retry validation/security errors.

## Public Facade/RPC Codes

These strings are the stable public code family shared by facade and RPC contracts.

| code | HTTP | Category | Retry | Client handling |
|------|------|----------|-------|-----------------|
| `invalid-request` | 400 | validation | no | developer/schema bug; show generic invalid request |
| `invalid-input` | 400 | validation | no | mark form/input field invalid |
| `invalid-meta` | 400 | validation | no | client integration bug |
| `invalid-trace` | 400 | validation | no | regenerate trace UUID and retry once only if missing/invalid client-generated trace |
| `invalid-authority` | 401 | security | no | login/refresh required |
| `invalid-caller` | 403 | security | no | forbidden |
| `invalid-session` | 404 | validation | no | session not found/invalid |
| `invalid-auth` | 401 | security | no | refresh token or redirect to login |
| `identity-already-exists` | 409 | conflict | no | register email already used |
| `identity-not-found` | 404 | validation | no | account not found |
| `password-mismatch` | 401 | security | no | wrong password |
| `refresh-invalid` | 401 | security | no | clear login state |
| `refresh-expired` | 401 | security | no | clear login state |
| `refresh-revoked` | 401 | security | no | clear login state |
| `invalid-wechat-code` | 400 | validation | no | call `wx.login()` again |
| `invalid-wechat-payload` | 502 | dependency | yes | retry login after obtaining a fresh code |
| `permission-denied` | 403 | security | no | forbidden / cross-team / non-owner |
| `binding-scope-forbidden` | 403 | security | no | forbidden |
| `tenant-mismatch` | 403 | security | no | wrong tenant/team context |
| `authority-escalation` | 403 | security | no | forbidden; report |
| `not-found` | 404 | validation | no | resource missing |
| `conflict` | 409 | conflict | no | optimistic/concurrent conflict |
| `session-not-running` | 409 | conflict | no | wait/reload session |
| `session-already-ended` | 410 | conflict | no | session closed |
| `worker-misconfigured` | 500/503 | permanent | no | service incident; report |
| `rpc-parity-failed` | 500 | transient | yes | retry/backoff and report trace |
| `upstream-timeout` | 504 | dependency | yes | retry/backoff |
| `rate-limited` | 429 | quota | yes | backoff using server guidance when present |
| `not-supported` | 501 | validation | no | hide/disable feature |
| `internal-error` | 500 | transient | yes | retry/backoff, report trace |

## Current Ad-hoc Public Codes

The following are emitted by current routes. They are not part of `FacadeErrorCodeSchema`, but as of the RHX2 review-of-reviews fix they ARE registered in `resolveErrorMeta()` / `getErrorMeta()` so clients can resolve a `category` / `http_status` / `retryable` triple by code.

| code | HTTP | Seen in | Client handling |
|------|------|---------|-----------------|
| `missing-team-claim` | 403 | auth/session/debug | clear bad token or force relogin |
| `invalid-auth-body` | 400 | auth proxy | client bug / bad JSON |
| `invalid-start-body` | 400 | `/sessions/{id}/start` | require `text` or `initial_input` |
| `invalid-input-body` | 400 | `/sessions/{id}/input` | require non-empty text |
| `invalid-auth-snapshot` | 400 | `/start` internal auth snapshot | report trace |
| `session_missing` | 404 | session DO routes | session not found |
| `session-pending-only-start-allowed` | 409 | session DO routes | call `/start` or refresh list |
| `session-expired` | 409 | pending start, `PATCH /sessions/{id}/model` | mint a new session |
| `session-already-started` | 409 | `/start` | reuse existing session/status |
| `session_terminal` | 409 | follow-up/WS, `PATCH /sessions/{id}/model` on ended session | session closed |
| `agent-start-failed` | 502 | `/start` | retry or report |
| `agent-rpc-unavailable` | 503 | agent-backed routes | retry/backoff |
| `agent-rpc-throw` | 502 | status/timeline/verify | retry/backoff |
| `models-d1-unavailable` | 503 | `/models`, `/models/{id}` | retry/backoff |
| `usage-d1-unavailable` | 503 | `/sessions/{id}/usage` | retry/backoff |
| `model-unavailable` | 400 | `/models/{id}`, `/sessions/{id}/model`, `/sessions/{id}/start`, `/sessions/{id}/input`, `/sessions/{id}/messages` | model inactive/unavailable; prompt user to choose another model |
| `model-disabled` | 403 | `/models/{id}`, `/sessions/{id}/model`, `/sessions/{id}/start`, `/sessions/{id}/input`, `/sessions/{id}/messages` | team policy forbids this model |
| `wrong-device` | 403 | follow-up session routes | session is bound to another device; refresh session list or switch device |
| `context-rpc-unavailable` | 503 | context routes | retry/backoff |
| `filesystem-rpc-unavailable` | 503 | files routes | retry/backoff |
| `payload-too-large` | 413 | file upload | reduce file size; max 25 MiB |
| `spike-disabled` | 403 | preview-only `/sessions/{id}/verify` spike check | verify spike disabled in this environment |
| `no-attached-client` | 409 | preview-only `/sessions/{id}/verify` spike check | attach a websocket client before retrying |
| `conversation-deleted` | 409 | checkpoint routes, `/sessions/{id}/model` | parent conversation already soft-deleted; refresh conversation list |
| `confirmation-already-resolved` | 409 | `/sessions/{id}/confirmations/{uuid}/decision`，legacy `/permission/decision`，legacy `/elicitation/answer` | confirmation row 已终结；视为最终态成功，不要重试（HP5） |
| `not-found` | 404 | confirmation/checkpoint/model/session detail routes | 指定 UUID / id / alias 不存在 |
| `todo-not-found` | 404 | `/sessions/{id}/todos/{uuid}` PATCH/DELETE | todo row 不存在 |
| `invalid-status` | 400 | `/sessions/{id}/todos/{uuid}` PATCH | todo status 不在 5-status enum |
| `in-progress-conflict` | 409 | `/sessions/{id}/todos/{uuid}` PATCH | session 已有 in_progress todo（at-most-1 invariant） |

Legacy note:

1. `POST /sessions/{id}/close` / `DELETE /sessions/{id}` / `PATCH /sessions/{id}/title` 仍沿用 legacy action payload；删除态冲突当前会返回 body-level `error: "conversation_deleted"`，客户端应把它映射到与 facade code `conversation-deleted` 相同的 UX。
2. `PATCH /sessions/{id}/runtime` 在 body 非法或缺少 `version` 时返回 `400 invalid-input`；当 `version` 落后于服务器当前值时返回 `409 conflict`。

## WS `system.error`

`session-ws-v1` structured runtime error frame:

```json
{
  "kind": "event",
  "seq": 12,
  "name": "session.stream.event",
  "payload": {
    "kind": "system.error",
    "error": {
      "code": "NACP_VALIDATION_FAILED",
      "category": "validation",
      "message": "server frame rejected by schema",
      "detail": { "kind": "session.heartbeat" },
      "retryable": false
    },
    "source_worker": "orchestrator-core",
    "trace_uuid": "11111111-1111-4111-8111-111111111111"
  }
}
```

`system.error.error.category` values:

| category | HTTP-ish meaning | Retry |
|----------|------------------|-------|
| `validation` | bad shape/input | no |
| `security` | auth/authority denied | no |
| `quota` | rate/quota exhausted | yes with backoff |
| `conflict` | lifecycle/idempotency conflict | no by default |
| `dependency` | upstream dependency failed | yes |
| `transient` | temporary runtime failure | yes |
| `permanent` | server invariant/config issue | no; report |

## NACP Internal Codes That May Surface via `system.error`

| code | category | retryable | 说明 |
|------|----------|-----------|------|
| `NACP_VALIDATION_FAILED` | validation | false | envelope/schema validation failed |
| `NACP_UNKNOWN_MESSAGE_TYPE` | validation | false | unknown message type |
| `NACP_SIZE_EXCEEDED` | validation | false | payload exceeds 96KB |
| `NACP_VERSION_INCOMPATIBLE` | validation | false | schema version too old |
| `NACP_TYPE_DIRECTION_MISMATCH` | validation | false | illegal delivery direction |
| `NACP_DEADLINE_EXCEEDED` | transient | false | message deadline exceeded |
| `NACP_IDEMPOTENCY_CONFLICT` | conflict | false | idempotency key conflict |
| `NACP_CAPABILITY_DENIED` | security | false | capability denied |
| `NACP_RATE_LIMITED` | quota | true | quota/rate limit |
| `NACP_BINDING_UNAVAILABLE` | transient | true | service binding unavailable |
| `NACP_HMAC_INVALID` | security | false | invalid HMAC |
| `NACP_TIMESTAMP_SKEW` | security | false | timestamp skew |
| `NACP_TENANT_MISMATCH` | security | false | team mismatch |
| `NACP_TENANT_BOUNDARY_VIOLATION` | security | false | ref crosses tenant boundary |
| `NACP_TENANT_QUOTA_EXCEEDED` | quota | true | tenant quota exhausted |
| `NACP_DELEGATION_INVALID` | security | false | invalid delegation |
| `NACP_STATE_MACHINE_VIOLATION` | permanent | false | illegal session phase |
| `NACP_REPLY_TO_CLOSED` | permanent | false | reply to closed request |
| `NACP_PRODUCER_ROLE_MISMATCH` | security | false | producer role illegal |
| `NACP_REPLAY_OUT_OF_RANGE` | permanent | false | replay seq out of range |

## KernelErrorCode (6 codes — agent-core kernel)

| code | category | retryable |
|------|----------|-----------|
| `ILLEGAL_PHASE_TRANSITION` | permanent | no |
| `TURN_ALREADY_ACTIVE` | conflict | no |
| `TURN_NOT_FOUND` | validation | no |
| `STEP_TIMEOUT` | transient | yes |
| `KERNEL_INTERRUPTED` | transient | yes |
| `CHECKPOINT_VERSION_MISMATCH` | permanent | no |

## SessionErrorCode (8 codes — `packages/nacp-session/src/errors.ts`)

| code | category | retryable |
|------|----------|-----------|
| `NACP_SESSION_INVALID_PHASE` | permanent | no |
| `NACP_SESSION_AUTHORITY_REQUIRED` | security | no |
| `NACP_SESSION_FORGED_AUTHORITY` | security | no |
| `NACP_REPLAY_OUT_OF_RANGE` | permanent | no |
| `NACP_SESSION_ACK_MISMATCH` | permanent | no |
| `NACP_SESSION_HEARTBEAT_TIMEOUT` | transient | yes |
| `NACP_SESSION_ALREADY_ATTACHED` | conflict | no |
| `NACP_SESSION_TYPE_DIRECTION_MISMATCH` | permanent | no |

## LLMErrorCategory (8 codes — `workers/agent-core/src/llm/errors.ts`)

| code | category | retryable |
|------|----------|-----------|
| `llm-auth` | security | no |
| `llm-rate-limit` | quota | yes |
| `llm-context-window` | validation | no |
| `llm-content-policy` | validation | no |
| `llm-bad-request` | validation | no |
| `llm-service-unavailable` | dependency | yes |
| `llm-timeout` | dependency | yes |
| `llm-other` | transient | yes |

## hero-to-pro Phase Wire Facts

1. `system.notify` frames may carry `code` and `trace_uuid` since RHX2 Phase 7. Clients SHOULD use `(trace_uuid, code)` as the dedupe key when a `system.notify(severity="error")` follows a `system.error` frame within ~1s.
2. `POST /sessions/{id}/verify` accepts `{ "check": "emit-system-error", "code": "spike-system-error" }` in preview-only environments; the route returns `403 spike-disabled` when `NANO_ENABLE_RHX2_SPIKE !== "true"` and `409 no-attached-client` when the WebSocket is detached. Production deploys keep the flag `false`.
3. `/debug/packages` returns a `drift_direction` field per published package (`aligned` / `workspace_ahead` / `workspace_behind` / `workspace_not_published` / `registry_unreachable`).
4. **HP5 row-first dual-write law (Q16)**: confirmation rows never enter `failed` state from dual-write failures—they escalate to `superseded`. Clients receiving `409 confirmation-already-resolved` should treat it as a terminal success and stop retrying.
5. **HP6 todo at-most-1 invariant (Q19)**: `/sessions/{id}/todos/{uuid}` PATCH returning `409 in-progress-conflict` means another todo is already `in_progress`; client should refresh todo list before retrying.
6. **HPX6 executor**: `POST /sessions/{id}/checkpoints/{uuid}/restore`、`/retry`、`/fork` 会进入 executor dispatch path；preview 配置 Queue binding 时返回 `dispatch_path=queue` / `executor_status=enqueued`，本地无 Queue binding 时可走 inline fallback 并返回 completed。

## Recommended Client Classifier

```ts
function classifyNanoError(error: { code?: string; status?: number; retryable?: boolean }) {
  if (error.retryable === true) return "retryable";
  if (error.status === 401) return "auth";
  if (error.status === 403) return "forbidden";
  if (error.status === 409 || error.code?.startsWith("session_")) return "session-state";
  if (error.status === 429) return "retryable";
  if (error.status && error.status >= 500) return "retryable";
  return "fatal-input";
}
```

Frontend UX mapping:

| Class | UX |
|-------|----|
| `auth` | try refresh once; if refresh fails, redirect login |
| `forbidden` | show permission/team error; do not retry |
| `session-state` | refresh session status/list; do not blindly resend user input |
| `retryable` | exponential backoff; expose retry button and trace UUID |
| `fatal-input` | show validation error or bug-report prompt |
