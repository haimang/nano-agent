# Error Index and Client Classification — RHX2 Phase 6 Snapshot

> Source of truth:
> - public facade codes: `packages/orchestrator-auth-contract/src/facade-http.ts`
> - unified meta lookup: `packages/nacp-core/src/error-registry.ts`
> - WS structured error frame: `packages/nacp-session/src/stream-event.ts`

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

The following are emitted by current routes but are not all part of `FacadeErrorCodeSchema`. Clients should still handle them because they are real wire facts.

| code | HTTP | Seen in | Client handling |
|------|------|---------|-----------------|
| `missing-team-claim` | 403 | auth/session/debug | clear bad token or force relogin |
| `invalid-auth-body` | 400 | auth proxy | client bug / bad JSON |
| `invalid-start-body` | 400 | `/sessions/{id}/start` | require `text` or `initial_input` |
| `invalid-input-body` | 400 | `/sessions/{id}/input` | require non-empty text |
| `invalid-auth-snapshot` | 400 | `/start` internal auth snapshot | report trace |
| `session_missing` | 404 | session DO routes | session not found |
| `session-pending-only-start-allowed` | 409 | session DO routes | call `/start` or refresh list |
| `session-expired` | 409 | pending start | mint a new session |
| `session-already-started` | 409 | `/start` | reuse existing session/status |
| `session_terminal` | 409 | follow-up/WS | session closed |
| `agent-start-failed` | 502 | `/start` | retry or report |
| `agent-rpc-unavailable` | 503 | agent-backed routes | retry/backoff |
| `agent-rpc-throw` | 502 | status/timeline/verify | retry/backoff |
| `models-d1-unavailable` | 503 | `/models` | retry/backoff |
| `context-rpc-unavailable` | 503 | context routes | retry/backoff |
| `filesystem-rpc-unavailable` | 503 | files routes | retry/backoff |
| `payload-too-large` | 413 | file upload | reduce file size; max 25 MiB |

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
