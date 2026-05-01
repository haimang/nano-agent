# API Compliance Report — Part 1 (Auth + Catalog + Checkpoints)

> Evaluator: kimi (k2p6)  
> Scope: `clients/api-docs/auth.md`, `catalog.md`, `checkpoints.md`  
> Date: 2026-05-01  
> Method: route-to-code trace, test-coverage audit, shape validation, nacp-protocol conformance

---

## Executive Summary

| Cluster | Routes | Functional | Test Coverage | Shape OK | NACP OK | Issues |
|---------|--------|------------|---------------|----------|---------|--------|
| Auth | 9 | ✅ Real | ⚠️ Partial | ⚠️ Minor | ⚠️ Minor | 3 findings |
| Catalog | 3 | ✅ Real | ✅ Full | ✅ Yes | ✅ Yes | None |
| Checkpoints | 4 | ✅ Real | ✅ Full | ⚠️ Minor | ❌ **No** | 2 findings |

**Critical finding:** Two routes (`POST .../checkpoints/{uuid}/restore` and `POST .../confirmations/{uuid}/decision`) return an **illegal `data` field inside error envelopes**, violating the frozen `facade-http-v1` contract. This breaks downstream client parsers that rely on the documented `{ok:false, error, trace_uuid}` shape.

---

## 1. Auth API (`clients/api-docs/auth.md`)

### 1.1 Route-to-Code Trace

All auth routes are parsed by `parseAuthRoute` (`workers/orchestrator-core/src/index.ts:522-536`) and dispatched through `proxyAuthRoute` (`index.ts:558-632`).

| Route | Code Location | Backend RPC | Real? |
|-------|---------------|-------------|-------|
| `POST /auth/register` | `index.ts:525` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.register` | orchestrator-auth worker | ✅ Yes |
| `POST /auth/login` | `index.ts:526` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.login` | orchestrator-auth worker | ✅ Yes |
| `POST /auth/refresh` | `index.ts:527` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.refresh` | orchestrator-auth worker | ✅ Yes |
| `POST /auth/verify` | `index.ts:528` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.verifyToken` | orchestrator-auth worker | ✅ Yes |
| `GET/POST /auth/me` | `index.ts:532` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.me` | orchestrator-auth worker | ✅ Yes |
| `GET/POST /me` | `index.ts:532` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.me` | orchestrator-auth worker | ✅ Yes (alias) |
| `POST /auth/password/reset` | `index.ts:529` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.resetPassword` | orchestrator-auth worker | ✅ Yes |
| `POST /auth/wechat/login` | `index.ts:530` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.wechatLogin` | orchestrator-auth worker | ✅ Yes |
| `POST /auth/api-keys/revoke` | `index.ts:531` → `proxyAuthRoute` → `env.ORCHESTRATOR_AUTH.revokeApiKey` | orchestrator-auth worker | ✅ Yes |

**Functional assessment:** All routes are real. The facade does not implement auth logic itself; it proxies to `orchestrator-auth` via service binding and wraps the RPC response with `facadeFromAuthEnvelope` (`index.ts:619-631`). The `facadeFromAuthEnvelope` helper lives in `@haimang/orchestrator-auth-contract` and is the canonical bridge from internal `AuthEnvelope<T>` to public `FacadeEnvelope<T>`.

### 1.2 Test Coverage Audit

| Route | Unit Test | Integration / Route Test | Notes |
|-------|-----------|--------------------------|-------|
| `POST /auth/register` | — | `smoke.test.ts:269-328` | ✅ Covered (happy path + missing binding) |
| `POST /auth/login` | — | **None** | ❌ No route-level test |
| `POST /auth/refresh` | — | **None** | ❌ No route-level test |
| `POST /auth/verify` | — | **None** | ❌ No route-level test |
| `GET/POST /auth/me` | — | **None** | ❌ No route-level test |
| `GET/POST /me` | — | **None** | ❌ No route-level test (alias) |
| `POST /auth/password/reset` | — | **None** | ❌ No route-level test |
| `POST /auth/wechat/login` | — | **None** | ❌ No route-level test |
| `POST /auth/api-keys/revoke` | — | **None** | ❌ No route-level test |

**Auth-layer tests exist** (`auth.test.ts`), but they test the `authenticateRequest` function in isolation (JWT verification, keyring, device gate, API-key path). They **do not** exercise `proxyAuthRoute` or the RPC forwarding logic.

**Gap:** 8 of 9 auth routes have zero end-to-end route tests in `orchestrator-core`. The only tested route is `/auth/register` (happy path + 503 missing-binding). Error paths such as `invalid-auth-body`, `worker-misconfigured`, and `missing-team-claim` for `revokeApiKey` are not exercised at the HTTP boundary.

### 1.3 Shape & Auth Compliance

| Route | Auth (Doc) | Auth (Code) | Request Shape | Response Shape | Issue |
|-------|------------|-------------|---------------|----------------|-------|
| `POST /auth/register` | none | none | `{email, password, display_name?}` | `AuthFlowResult` | ✅ OK |
| `POST /auth/login` | none | none | `{email, password}` | `AuthFlowResult` | ✅ OK |
| `POST /auth/refresh` | none | none | `{refresh_token}` | `AuthFlowResult` | ✅ OK |
| `POST /auth/verify` | bearer | `readAccessToken` (header only) | `{}` (optional) | `VerifyTokenResult` | ✅ OK |
| `GET/POST /auth/me` | bearer | `readAccessToken` | body ignored | `AuthView` | ✅ OK |
| `GET/POST /me` | bearer | `readAccessToken` | body ignored | `AuthView` | ✅ OK |
| `POST /auth/password/reset` | bearer | `readAccessToken` | `{old_password, new_password}` | `ResetPasswordResult` | ✅ OK |
| `POST /auth/wechat/login` | none | none | wechat payload | `AuthFlowResult` | ✅ OK |
| `POST /auth/api-keys/revoke` | bearer | `authenticateRequest` + team gate | `{key_id}` | `{key_id, team_uuid, revoked_at}` | ⚠️ **Input validation gap** |

**Finding A1 — Missing input validation on `revokeApiKey`:**
`proxyAuthRoute` forwards `body.key_id` to the auth worker without checking presence or format (`index.ts:592-596`). If the client omits `key_id`, the auth worker will receive an incomplete payload and return its own error, but the facade could have caught this earlier with a 400 `invalid-input`.

**Finding A2 — `me` alias divergence:**
`/me` is listed as `GET/POST` in the doc. `parseAuthRoute` correctly maps both methods and both paths (`/auth/me` and `/me`) to the same action (`"me"`). No divergence.

### 1.4 NACP Protocol Conformance

**Profile:** `facade-http-v1`  
**Reference:** `packages/orchestrator-auth-contract/src/facade-http.ts`

- **Envelope shape:** All auth routes pass through `facadeFromAuthEnvelope`, which produces exactly `{ok:true, data, trace_uuid}` or `{ok:false, error:{code,status,message}, trace_uuid}`. ✅
- **Trace UUID:** `readTraceUuid(request) ?? crypto.randomUUID()` is used. `x-trace-uuid` header is therefore optional at the edge (the facade mints one if absent). This is consistent with the doc note: "未传时 auth proxy 会生成一个 trace". ✅
- **Error code taxonomy:** `facadeFromAuthEnvelope` re-validates the auth error code against `FacadeErrorCodeSchema`; unknown codes fall back to `internal-error`. This guarantees that every error code returned on the public surface is a legal `FacadeErrorCode`. ✅
- **Bearer extraction:** `readAccessToken` only reads the `Authorization` header (no query-string fallback for auth routes). This is correct per the doc. ✅

**NACP verdict:** ✅ Compliant, with the minor reservation that `revokeApiKey` body validation could be tightened locally.

---

## 2. Catalog API (`clients/api-docs/catalog.md`)

### 2.1 Route-to-Code Trace

| Route | Code Location | Handler | Real? |
|-------|---------------|---------|-------|
| `GET /catalog/skills` | `index.ts:516` → `handleCatalog` | Static import from `catalog-content.ts` | ✅ Yes |
| `GET /catalog/commands` | `index.ts:517` → `handleCatalog` | Static import from `catalog-content.ts` | ✅ Yes |
| `GET /catalog/agents` | `index.ts:518` → `handleCatalog` | Static import from `catalog-content.ts` | ✅ Yes |

`parseCatalogRoute` (`index.ts:511-520`) restricts method to `GET` and returns one of three `CatalogKind` literals. `handleCatalog` (`index.ts:851-875`) dynamically imports `catalog-content.js` and returns the matching array wrapped in a `FacadeEnvelope`.

**Functional assessment:** The registry is real, static, and per-deploy. The doc correctly states "Per-deploy 配置，不依赖数据库".

### 2.2 Test Coverage Audit

| Route | Test File | Assertion |
|-------|-----------|-----------|
| `GET /catalog/skills` | `smoke.test.ts:332-354` | Status 200, `ok:true`, non-empty `skills` array, shape check (`name`, `description`, `version`, `status`) |
| `GET /catalog/commands` | `smoke.test.ts:356-372` | Status 200, `ok:true`, non-empty `commands`, contains `/start` |
| `GET /catalog/agents` | `smoke.test.ts:374-390` | Status 200, `ok:true`, non-empty `agents`, contains `nano-default` |

**Coverage verdict:** ✅ Full. All three routes have dedicated happy-path assertions that verify both envelope shape and entry schema.

### 2.3 Shape & Auth Compliance

| Route | Auth (Doc) | Auth (Code) | Request | Response | Issue |
|-------|------------|-------------|---------|----------|-------|
| `GET /catalog/skills` | optional bearer | **Not read at all** | None | `{skills: CatalogEntry[]}` | ⚠️ Divergence |
| `GET /catalog/commands` | optional bearer | **Not read at all** | None | `{commands: CatalogEntry[]}` | ⚠️ Divergence |
| `GET /catalog/agents` | optional bearer | **Not read at all** | None | `{agents: CatalogEntry[]}` | ⚠️ Divergence |

**Finding C1 — Auth documented as "optional bearer" but code ignores bearer entirely:**
`handleCatalog` does not call `authenticateRequest`. A request with an invalid bearer token will succeed. While this is functionally harmless (the route is public), the doc and code are out of sync. Either the doc should say "none" or the code should parse and ignore the bearer (to reserve the right to make it required later without breaking clients).

**Request / response shapes:** Match the doc exactly. `CatalogEntry` is `{name, description, version, status}` where `status ∈ {stable, preview, experimental}`. The code (`catalog-content.ts:15-20`) exports the same TypeScript interface. ✅

### 2.4 NACP Protocol Conformance

- **Envelope shape:** `Response.json({ok:true, data, trace_uuid})` — pure `facade-http-v1`. ✅
- **Trace UUID:** `readTraceUuid(request) ?? crypto.randomUUID()`. Same as auth. ✅
- **Method gate:** `parseCatalogRoute` returns `null` for non-GET, so a `POST /catalog/skills` falls through to the 404 catch-all. This is correct (idempotent read-only surface). ✅
- **No error-body anomalies:** No custom error paths in `handleCatalog`. ✅

**NACP verdict:** ✅ Compliant.

---

## 3. Checkpoints API (`clients/api-docs/checkpoints.md`)

### 3.1 Route-to-Code Trace

All checkpoint routes are parsed by `parseSessionCheckpointRoute` (`index.ts:1173-1197`) and handled by `handleSessionCheckpoint` (`index.ts:1273-1474`).

| Route | Code Location | Underlying Plane / Repo | Real? |
|-------|---------------|------------------------|-------|
| `GET /sessions/{id}/checkpoints` | `index.ts:1176-1180` → `handleSessionCheckpoint` (list branch) | `D1SessionTruthRepository.listCheckpoints` | ✅ Yes |
| `POST /sessions/{id}/checkpoints` | `index.ts:1176-1181` → `handleSessionCheckpoint` (create branch) | `D1SessionTruthRepository.createUserCheckpoint` | ✅ Yes |
| `GET /sessions/{id}/checkpoints/{uuid}/diff` | `index.ts:1184-1189` → `handleSessionCheckpoint` (diff branch) | `D1SessionTruthRepository.readCheckpointDiff` | ✅ Yes |
| `POST /sessions/{id}/checkpoints/{uuid}/restore` | `index.ts:1191-1196` → `handleSessionCheckpoint` (restore branch) | `D1CheckpointRestoreJobs.openJob` | ✅ Yes |

**Functional assessment:** All four routes are live. `list` and `create` touch `nano_session_checkpoints`. `diff` touches `nano_session_checkpoints` + `nano_conversation_messages`. `restore` validates a `checkpoint_restore` confirmation row via `D1ConfirmationControlPlane`, then opens a `pending` restore job via `D1CheckpointRestoreJobs`.

The doc accurately notes that the restore endpoint only does **job open + confirmation gate**; the actual executor is not yet live.

### 3.2 Test Coverage Audit

| Route | Test File | Assertion |
|-------|-----------|-----------|
| `GET /sessions/{id}/checkpoints` | `chat-lifecycle-route.test.ts:366-407` | Status 200, 1 checkpoint returned |
| `POST /sessions/{id}/checkpoints` | `chat-lifecycle-route.test.ts:366-407` | Status 201, created checkpoint shape |
| `GET /sessions/{id}/checkpoints/{uuid}/diff` | `chat-lifecycle-route.test.ts:409-439` | Status 200, diff contains `messages_since_checkpoint` + `superseded_messages` |
| `POST /sessions/{id}/checkpoints/{uuid}/restore` | `chat-lifecycle-route.test.ts:441-477` | Status 202, restore job `pending`, mode `conversation_only` |

Additional unit tests exist for the underlying substrate:
- `checkpoint-restore-plane.test.ts` — 522 lines, covers `D1CheckpointSnapshotPlane`, `D1CheckpointRestoreJobs`, enum invariants, R2 key law, Q22/Q24 constraints.
- `checkpoint-diff-projector.test.ts` — 250 lines, covers `CheckpointDiffProjector` workspace delta + artifact delta.
- `migrations-schema-freeze.test.ts` — validates migration `013-product-checkpoints.sql` enum constraints.

**Coverage verdict:** ✅ Full at the route level. All four public routes have end-to-end assertions in `chat-lifecycle-route.test.ts`. The underlying planes have dedicated unit tests.

### 3.3 Shape & Auth Compliance

| Route | Auth (Doc) | Auth (Code) | Request | Response | Issue |
|-------|------------|-------------|---------|----------|-------|
| `GET .../checkpoints` | bearer | `authenticateRequest` + session ownership | None | `{session_uuid, conversation_uuid, checkpoints: [...]}` | ✅ OK |
| `POST .../checkpoints` | bearer | `authenticateRequest` + session ownership | `{label?}` | `{session_uuid, conversation_uuid, checkpoint: {...}}` | ✅ OK |
| `GET .../checkpoints/{uuid}/diff` | bearer | `authenticateRequest` + session ownership | None | `{session_uuid, conversation_uuid, diff: {...}}` | ⚠️ Code structure |
| `POST .../checkpoints/{uuid}/restore` | bearer | `authenticateRequest` + session ownership | `{mode, confirmation_uuid}` | `{session_uuid, conversation_uuid, checkpoint, restore_job}` | ⚠️ Error shape |

**Finding CP1 — `diff` route lacks explicit branch:**
In `handleSessionCheckpoint`, the code handles `list`, `create`, and `restore` with explicit `if` blocks. The `diff` kind falls through to a block after the `restore` branch (`index.ts:1454-1473`). Functionally this works because the preceding code already validates the checkpoint exists, but the control flow is brittle: adding a new `kind` in the future could accidentally shadow `diff`. Refactoring recommendation: add an explicit `if (route.kind === "diff")` guard.

**Finding CP2 — Input validation on `restore` mode is strict but not fully tested at the route level:**
`handleSessionCheckpoint` validates that `mode` is one of `conversation_only | files_only | conversation_and_files` (`RESTORE_REQUEST_MODES` constant, `index.ts:49`). It also validates that `confirmation_uuid` is a valid UUID and that the confirmation row exists with `kind=checkpoint_restore` and `status=pending`. These validations are exercised in the unit test (`checkpoint-restore-plane.test.ts`) but the **route test** (`chat-lifecycle-route.test.ts`) only covers the happy path (`conversation_only`). Missing route-level tests for:
- Invalid mode → 400
- Missing/invalid confirmation_uuid → 400/404
- Confirmation already resolved → 409
- Confirmation kind mismatch → 409

### 3.4 NACP Protocol Conformance

**Profile:** `facade-http-v1`

#### 3.4.1 Normal Paths

All four routes return:
- Success: `{ok:true, data:{...}, trace_uuid}` ✅
- 404 not-found: `{ok:false, error:{code:"not-found",status:404,message}, trace_uuid}` ✅
- 409 conversation-deleted: `{ok:false, error:{code:"conversation-deleted",status:409,message}, trace_uuid}` ✅
- 400 invalid-input: `{ok:false, error:{code:"invalid-input",status:400,message}, trace_uuid}` ✅
- 503 worker-misconfigured: `{ok:false, error:{code:"worker-misconfigured",status:503,message}, trace_uuid}` ✅

#### 3.4.2 Error-Path Anomaly (CRITICAL)

**Finding CP3 — Illegal `data` field in error envelope:**

When a restore request references a confirmation that is **not** `pending`, `handleSessionCheckpoint` returns:

```typescript
// workers/orchestrator-core/src/index.ts:1410-1422
return Response.json(
  {
    ok: false,
    error: {
      code: "confirmation-already-resolved",
      status: 409,
      message: "confirmation has already been resolved with a different status",
    },
    data: { confirmation },   // ← ILLEGAL under facade-http-v1
    trace_uuid: traceUuid,
  },
  { status: 409, headers: { "x-trace-uuid": traceUuid } }
);
```

The frozen `FacadeErrorEnvelopeSchema` (`packages/orchestrator-auth-contract/src/facade-http.ts:137-141`) defines the error envelope as:

```typescript
{
  ok: false,
  error: { code, status, message, details? },
  trace_uuid: string,
}
```

There is **no `data` key** in the error variant. The same anomaly exists in `handleSessionConfirmation` (`index.ts:1643-1655`) for the decision conflict path. This violates the NACP `facade-http-v1` contract and will break strictly-typed client parsers.

**Impact:** Medium-High. Any client that deserializes the error envelope into `FacadeErrorEnvelope` (e.g., generated SDKs or strict TypeScript consumers) will encounter an unexpected field and may reject the payload or fail type-checking.

**Remediation:** Move the confirmation snapshot into `error.details` (which is legal) or omit it from the error response entirely.

#### 3.4.3 Trace & Headers

- **Trace UUID:** Derived from `authenticateRequest`, which requires `x-trace-uuid` header. The checkpoint routes therefore enforce the header (unlike auth/catalog where it is optional). This is correct per the doc. ✅
- **Auth snapshot injection:** The facade reads the bearer, validates it, and injects `team_uuid` / `user_uuid` into the downstream RPC or SQL query. No raw token leaks into the response. ✅
- **Tenant boundary:** Every checkpoint query includes `team_uuid` in the WHERE clause (session-truth.ts:1282-1284). Multi-tenant isolation is preserved. ✅

**NACP verdict:** ❌ **Non-compliant** due to CP3 (illegal `data` field in error envelope). All other aspects are compliant.

---

## 4. Cross-Cluster Observations

### 4.1 Auth Model Consistency

- `catalog` treats auth as public (no bearer check).
- `auth` bootstrap routes (`register`, `login`, `refresh`, `wechatLogin`) correctly require no auth.
- `auth` protected routes (`verify`, `me`, `resetPassword`, `revokeApiKey`) correctly require bearer.
- `checkpoints` correctly requires bearer and enforces session ownership (user + team match).

No auth escalation or bypass was found.

### 4.2 Error Code Registry Alignment

All error codes returned by the three clusters are members of `FacadeErrorCodeSchema` (32 codes) or fall back to `internal-error`. The compile-time guards (`_authErrorCodesAreFacadeCodes`, `_rpcErrorCodesAreFacadeCodes`) in `facade-http.ts` prevent drift between internal and public taxonomies. ✅

### 4.3 Envelope Drift Guard

The repo runs `scripts/check-envelope-drift.mjs` (referenced in `package.json` and transport docs). This script compares public route outputs against the canonical `FacadeEnvelopeSchema`. Because CP3 introduces a literal field not in the schema, the drift guard **should** flag it if the checkpoint restore 409 path is exercised in the script's test corpus. At the time of writing, the drift guard appears to focus on success envelopes; error-path drift detection may need strengthening.

---

## 5. Recommendations (Priority Order)

| # | Finding | Severity | Action |
|---|---------|----------|--------|
| 1 | **CP3** — Error envelope contains illegal `data` field (`restore` + `confirmation/decision`) | 🔴 High | Remove `data` from error envelope; move confirmation snapshot to `error.details` if needed. |
| 2 | **A1** — `revokeApiKey` body lacks local validation | 🟡 Medium | Add `key_id` presence/format check in `proxyAuthRoute` before RPC. |
| 3 | **Auth route tests** — 8 of 9 auth routes untested at HTTP boundary | 🟡 Medium | Add minimal smoke tests for `login`, `refresh`, `verify`, `me`, `resetPassword`, `wechatLogin`, `revokeApiKey`. |
| 4 | **CP1** — `diff` route has no explicit branch | 🟢 Low | Refactor `handleSessionCheckpoint` to use `else if (route.kind === "diff")`. |
| 5 | **C1** — Catalog auth documented as "optional bearer" but code ignores it | 🟢 Low | Align doc to "none" or add bearer parsing (no-op) in `handleCatalog`. |
| 6 | **CP2** — Restore route error paths not tested at HTTP boundary | 🟢 Low | Add 400/404/409 route tests for restore confirmation validation. |

---

## Appendix: File Index

| File | Role |
|------|------|
| `workers/orchestrator-core/src/index.ts` | Route parser + dispatcher (`parseAuthRoute`, `parseCatalogRoute`, `parseSessionCheckpointRoute`, `proxyAuthRoute`, `handleCatalog`, `handleSessionCheckpoint`) |
| `workers/orchestrator-core/src/auth.ts` | Bearer parsing, JWT verification, device gate, API-key authentication |
| `workers/orchestrator-core/src/session-truth.ts` | D1 repository for checkpoints, diff projection, session lifecycle |
| `workers/orchestrator-core/src/checkpoint-restore-plane.ts` | `D1CheckpointRestoreJobs`, `D1CheckpointSnapshotPlane`, enum invariants |
| `workers/orchestrator-core/src/checkpoint-diff-projector.ts` | `CheckpointDiffProjector` (workspace + artifact delta) |
| `workers/orchestrator-core/src/catalog-content.ts` | Static registry for skills / commands / agents |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | Canonical `FacadeEnvelopeSchema`, `facadeFromAuthEnvelope` |
| `workers/orchestrator-core/test/smoke.test.ts` | Smoke tests for catalog + auth register + shell probe |
| `workers/orchestrator-core/test/auth.test.ts` | Unit tests for `authenticateRequest` (JWT, keyring, device gate) |
| `workers/orchestrator-core/test/chat-lifecycle-route.test.ts` | End-to-end tests for checkpoint routes |
| `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts` | Unit tests for restore job state machine |
| `workers/orchestrator-core/test/checkpoint-diff-projector.test.ts` | Unit tests for diff projection |

---

*Report generated by kimi (k2p6) on 2026-05-01.*
