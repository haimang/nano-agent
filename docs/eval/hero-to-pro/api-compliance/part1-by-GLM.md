# API Compliance Audit — Part 1: Auth / Catalog / Checkpoints

> Auditor: GLM
> Date: 2026-05-01
> Scope: `clients/api-docs/auth.md`, `clients/api-docs/catalog.md`, `clients/api-docs/checkpoints.md`
> SSOT baseline: documents as frozen in `clients/api-docs/`

---

## Methodology

Each endpoint is evaluated against four compliance dimensions:

| Dimension | Question |
|-----------|----------|
| **F1 — Functionality** | Route → implementation: does the code exist, is it wired, does it do what the doc says? |
| **F2 — Test Coverage** | Does any test exercise the logic behind this endpoint? |
| **F3 — Shape Compliance** | Auth gate, request schema, response envelope — do they match the doc and the `facade-http-v1` contract? |
| **F4 — NACP Compliance** | Does the endpoint uphold NACP authority-stamping, tenant-boundary, trace-propagation, and error-code alignment in both directions (client→facade, facade→internal)? |

Severity levels: **PASS** (fully compliant) / **WARN** (minor deviation, functionally safe) / **FINDING** (behavioral gap that could cause client breakage or security drift) / **CRITICAL** (must fix before production freeze).

---

## 0. Cross-Cutting Observations

### 0.1 Architecture

All three clusters route through `workers/orchestrator-core/src/index.ts` `dispatchFetch()`. Auth endpoints proxy via `ORCHESTRATOR_AUTH` service-binding RPC to `workers/orchestrator-auth/src/service.ts`. Catalog endpoints serve static data from `catalog-content.ts`. Checkpoint endpoints hit D1 directly from orchestrator-core.

### 0.2 Facade-http-v1 Envelope

All endpoints use the `{ ok, data?, error?, trace_uuid }` envelope defined in `packages/orchestrator-auth-contract/src/facade-http.ts`. Success paths return `{ ok: true, data, trace_uuid }`; error paths return `{ ok: false, error: { code, status, message }, trace_uuid }`. This matches the doc spec.

### 0.3 Auth Middleware Pattern

Two patterns exist:

| Pattern | Used by | Mechanism |
|---------|---------|-----------|
| **No facade-level auth; token in RPC body** | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/verify`, `/auth/me`, `/me`, `/auth/password/reset`, `/auth/wechat/login` | `proxyAuthRoute()` extracts `Authorization: Bearer` and passes `access_token` as a field in the RPC input. Verification happens inside `orchestrator-auth`. |
| **Facade-level `authenticateRequest()`** | `/auth/api-keys/revoke`, all `/sessions/{id}/checkpoints/*` | JWT/API-key verification + device gate + team-claim extraction happens in the facade before dispatching. |

### 0.4 NACP Authority Translation

The facade-http-v1 endpoints are **external-facing HTTP** and do NOT speak NACP envelopes on the wire. Instead:

- **Client → Facade**: Standard HTTP with `Authorization: Bearer` + `x-trace-uuid`.
- **Facade → Internal (auth RPC)**: Service-binding RPC with `meta: { trace_uuid, caller }`, which is a NACP-compatible transport profile (service-binding).
- **Facade → Internal (checkpoints D1)**: Direct D1 access; no NACP envelope is generated for these calls.

**Key NACP concern**: The facade must translate the client's HTTP auth into NACP-style authority when proxying to internal workers. For auth RPC, the `meta` object carries `trace_uuid` and `caller`, but does **not** carry `team_uuid`/`user_uuid` as NACP authority — those are resolved inside the auth worker from the `access_token`. This is a **valid authority-translation pattern** (JWT claim → resolved authority) per the NACP principle that "authority is server-stamped."

---

## 1. Auth Cluster (`clients/api-docs/auth.md`)

---

### 1.1 `POST /auth/register`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:525` → `proxyAuthRoute` → `ORCHESTRATOR_AUTH.register()`. Handler: `service.ts:440-464`. Creates identity + bootstrap team, issues tokens, returns `AuthFlowResult`. |
| **F2 Test Coverage** | **PASS** | `orchestrator-auth/test/service.test.ts` covers register success + duplicate `identity-already-exists` (409). `orchestrator-core/test/smoke.test.ts` covers facade-level proxy success + 503 binding-missing. `bootstrap-hardening.test.ts` covers cold-start stress (100 concurrent). |
| **F3 Shape Compliance** | **PASS** | Request: `{ email, password, display_name? }` validated by `RegisterInputSchema` (Zod, `orchestrator-auth-contract/src/index.ts:122-127`). Response: `AuthFlowResult` envelope wrapped into `facade-http-v1`. Status 200 on success. No auth required — matches doc. |
| **F4 NACP Compliance** | **PASS** | No auth needed (public bootstrap). `meta: { trace_uuid, caller }` stamped on the RPC call. Authority is resolved by the auth worker from the newly minted JWT. Trace UUID propagated. |

**Issues**: None.

---

### 1.2 `POST /auth/login`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:526` → `proxyAuthRoute` → `ORCHESTRATOR_AUTH.login()`. Handler: `service.ts:467-497`. Normalizes email, verifies hash, emits audit, issues tokens. |
| **F2 Test Coverage** | **PASS** | `service.test.ts`: login with correct/incorrect password, `password-mismatch` (401), `identity-not-found` (404). `smoke.test.ts`: 503 binding-missing. `bootstrap-hardening.test.ts`: concurrent login storm. |
| **F3 Shape Compliance** | **PASS** | Request: `{ email, password }` (Zod `LoginInputSchema`). Response: `AuthFlowResult`. No auth required. |
| **F4 NACP Compliance** | **PASS** | Same pattern as register — public route, authority resolved after authentication. Device metadata (`x-device-uuid`, etc.) merged into input at `index.ts:583`. |

**Issues**: None.

---

### 1.3 `POST /auth/refresh`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:527` → `proxyAuthRoute` → `ORCHESTRATOR_AUTH.refresh()`. Handler: `service.ts:500-572`. Validates refresh token, checks device binding, rotates session, mints new access token. |
| **F2 Test Coverage** | **PASS** | `service.test.ts`: refresh success, replay detection (`refresh-revoked`), device mismatch (`invalid-auth`). `bootstrap-hardening.test.ts`: 50-concurrent refresh storm. |
| **F3 Shape Compliance** | **PASS** | Request: `{ refresh_token }` (Zod). Response: `AuthFlowResult`. No Bearer auth required — the refresh token IS the credential. |
| **F4 NACP Compliance** | **PASS** | Device binding enforced on the auth worker side (`requireBoundDeviceUuid()`). Token rotation invalidates old refresh token (replay protection). |

**Issues**: None.

---

### 1.4 `POST /auth/verify`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:528` → `proxyAuthRoute` → `ORCHESTRATOR_AUTH.verifyToken()`. Handler: `service.ts:585-597`. Accepts access token, verifies JWT or API key (`nak_` prefix), returns `VerifyTokenResult = AuthView & { valid: true }`. |
| **F2 Test Coverage** | **WARN** | `service.test.ts` covers `verifyApiKey()` (API key path). No dedicated test for the JWT `verifyToken()` success path in `service.test.ts`. The JWT verification is covered indirectly by `auth.test.ts` (orchestrator-core) and `jwt-shared.test.ts`, but there is no direct test for the `POST /auth/verify` endpoint that verifies a JWT access token and returns the `AuthView + { valid: true }` shape. |
| **F3 Shape Compliance** | **PASS** | The doc says `POST /auth/verify` body can be empty and Bearer token is read from `Authorization` header. Implementation: `proxyAuthRoute` constructs `input = { access_token: accessToken }` from the Bearer header (line 579). The auth doc says "body 可为空；facade 不从 body 读取 `access_token`" — this matches the implementation. Response: `{ ok: true, data: { valid: true, user, team, snapshot }, trace_uuid }`. |
| **F4 NACP Compliance** | **PASS** | Token is resolved inside the auth worker. No authority-translation violation. |

**Issues**:

- **F2 WARN**: Missing a dedicated service-level test for `verifyToken()` with a JWT access token that asserts the `VerifyTokenResult` shape including `{ valid: true, user, team, snapshot }`.

---

### 1.5 `GET /auth/me` & `GET /me`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:532-534` → `proxyAuthRoute` → `ORCHESTRATOR_AUTH.me()`. Handler: `service.ts:574-583`. Verifies token, returns `AuthView`. Both `/auth/me` and `/me` resolve to the same `"me"` action. POST variants also supported (body ignored). |
| **F2 Test Coverage** | **WARN** | `service.test.ts` covers `me()` with JWT and API key, plus forged/cross-team token rejection. However, the `/me` alias route (without `/auth/` prefix) is not explicitly tested at the facade level — only `/auth/me` is tested via smoke tests. The alias should work because `parseAuthRoute` maps both to `"me"`, but no E2E test hits `GET /me` explicitly. |
| **F3 Shape Compliance** | **FINDING** | The doc says `GET /auth/me` / `GET /me` requires `bearer` auth. The implementation reads `access_token` from the Bearer header and passes it to `ORCHESTRATOR_AUTH.me()`. However, the facade does **not** call `authenticateRequest()` — it relies on the auth worker to verify the token. This means: (a) if the Bearer token is missing, the facade still sends `{ access_token: undefined }` to the auth worker, which will return `invalid-auth`; (b) the facade does not enforce `x-trace-uuid` for this route (unlike `authenticateRequest()` which requires it). The `x-trace-uuid` is still generated by `readTraceUuid(request) ?? crypto.randomUUID()` in `proxyAuthRoute`, so it's populated, but there's no strict enforcement. |
| **F4 NACP Compliance** | **PASS** | Authority is server-resolved via the auth worker. |

**Issues**:

- **F3 FINDING**: Facade does **not** enforce Bearer token presence before proxying to auth worker for `/auth/me`, `/me`, `/auth/verify`, and `/auth/password/reset`. If `Authorization` header is absent, `readAccessToken()` returns `undefined`, which is passed as `access_token: undefined` to the auth worker. The auth worker correctly returns an error, so functionally this is safe. However, the facade skips the device gate (`authenticateRequest()`) for these routes, meaning revocation of a device won't be checked at the facade level — only at the auth worker level. This is a **design choice** (auth self-validates), but differs from session-bound endpoints which go through the full `authenticateRequest()` gate.

- **F2 WARN**: No explicit test for the `/me` alias (without `/auth/` prefix).

---

### 1.6 `POST /auth/password/reset`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:529` → `proxyAuthRoute` → `ORCHESTRATOR_AUTH.resetPassword()`. Handler: `service.ts:599-639`. Verifies access token, looks up identity, checks old password, updates hash. |
| **F2 Test Coverage** | **PASS** | `service.test.ts`: requires old password, rejects wrong old password, allows login with new password after reset. |
| **F3 Shape Compliance** | **PASS** | Request: `{ old_password, new_password }` merged with `access_token` from Bearer header. Response: `AuthView + { password_reset: true }`. |
| **F4 NACP Compliance** | **PASS** | Auth worker verifies token and identity ownership. |

**Issues**: None.

---

### 1.7 `POST /auth/wechat/login`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:530` → `proxyAuthRoute` → `ORCHESTRATOR_AUTH.wechatLogin()`. Handler: `service.ts:642-719`. Exchanges WeChat code, optionally decrypts profile, bootstraps or logs in. Device metadata spread applied at `index.ts:614`. |
| **F2 Test Coverage** | **PASS** | `service.test.ts`: first call bootstraps identity; second call with same code reuses identity; WeChat display name used; mismatched decrypted openid rejected. E2E: `wechat-miniprogram/test/e2e/api/auth.test.js`. |
| **F3 Shape Compliance** | **FINDING** | The doc says `POST /auth/wechat/login` takes `{ code, encrypted_data?, iv?, display_name? }`. The implementation at `index.ts:583` uses `input = { ...(body ?? {}), ...deviceMetadata }` for the default path, but the wechat action at line 614 does `{ ...input, ...deviceMetadata }` — effectively spreading device metadata twice (once from initial `input` construction, once explicitly). This is **harmless** (later spreads override earlier ones), but it means the WeChat-specific fields and device metadata are mixed in the same input object before Zod validation in the auth worker. The Zod schema (`WeChatLoginInputSchema`) correctly validates only the expected fields and strips extras. |
| **F4 NACP Compliance** | **PASS** | Public route, no auth required. |

**Issues**:

- **F3 FINDING**: Double-spread of `deviceMetadata` in wechat login input construction (`index.ts:614`). Harmless due to Zod stripping, but indicates a minor code smell. No functional impact.

---

### 1.8 `POST /auth/api-keys/revoke`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:531` → `proxyAuthRoute` → **facade-level `authenticateRequest()`** → `ORCHESTRATOR_AUTH.revokeApiKey()`. Handler: `service.ts:769-808`. Looks up API key, verifies team ownership, revokes, emits audit. |
| **F2 Test Coverage** | **PASS** | `service.test.ts`: revokes key, emits `auth.api_key.revoked` audit. `service.test.ts` also covers `createApiKey()` + `verifyApiKey()` lifecycle. |
| **F3 Shape Compliance** | **PASS** | Request: `{ key_id }` + Bearer auth (facade-level enforcement). Facade injects `team_uuid` and `user_uuid` from auth snapshot (`index.ts:588-596`). Response: `{ key_id, team_uuid, revoked_at }`. Auth is **required** at facade level (`authenticateRequest()` at line 586). |
| **F4 NACP Compliance** | **PASS** | This is the only auth route that enforces facade-level auth. `authenticateRequest()` validates JWT/API-key, checks device status, and extracts `team_uuid`/`user_uuid` from the snapshot — standard NACP authority translation. |

**Issues**: None.

---

### 1.9 Auth Cluster Summary

| Endpoint | F1 | F2 | F3 | F4 | Key Issue |
|----------|----|----|----|----|-----------|
| `POST /auth/register` | PASS | PASS | PASS | PASS | — |
| `POST /auth/login` | PASS | PASS | PASS | PASS | — |
| `POST /auth/refresh` | PASS | PASS | PASS | PASS | — |
| `POST /auth/verify` | PASS | WARN | PASS | PASS | Missing JWT verifyToken service-level test |
| `GET /auth/me` & `GET /me` | PASS | WARN | FINDING | PASS | No facade-level auth enforcement; `/me` alias untested |
| `POST /auth/password/reset` | PASS | PASS | PASS | PASS | — |
| `POST /auth/wechat/login` | PASS | PASS | FINDING | PASS | Double-spread of deviceMetadata (harmless) |
| `POST /auth/api-keys/revoke` | PASS | PASS | PASS | PASS | — |

**Cluster-level findings**:

1. **FINDING (F3)**: Routes `/auth/verify`, `/auth/me`, `/me`, `/auth/password/reset` go through `proxyAuthRoute()` which does NOT call `authenticateRequest()` at the facade level. Instead, the Bearer token is passed as `access_token` to the auth worker, which verifies it internally. This means these routes bypass the facade device gate. While the auth worker itself validates the token, this pattern is inconsistent with `/auth/api-keys/revoke` and all session-bound endpoints, which enforce auth at the facade. **Impact**: A revoked device could still reach the auth worker before being rejected — the device revocation check in `authenticateRequest()` (which queries D1 for device status) is bypassed. Whether this is a security issue depends on whether the auth worker also checks device revocation for these endpoints (it does not appear to).

2. **WARN (F2)**: `/auth/me` and `/auth/verify` lack dedicated facade-level smoke tests that hit the actual HTTP endpoint through the proxy path.

3. **WARN (F2)**: The `/me` alias (without `/auth/` prefix) has no explicit E2E test.

---

## 2. Catalog Cluster (`clients/api-docs/catalog.md`)

---

### 2.1 `GET /catalog/skills`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:516` → `dispatchFetch:664-666` → `handleCatalog(kind="skills")`. Handler: `index.ts:851-875`. Returns `CATALOG_SKILLS` from `catalog-content.ts` wrapped in `facade-http-v1` envelope. |
| **F2 Test Coverage** | **PASS** | `orchestrator-core/test/smoke.test.ts:332-354`: GET /catalog/skills returns 200, `ok: true`, non-empty `skills` array, each entry has `name/description/version/status`. |
| **F3 Shape Compliance** | **PASS** | No auth required (doc says "optional bearer"; implementation ignores Bearer). Response: `{ ok: true, data: { skills: [...] }, trace_uuid }`. Matches doc. `x-trace-uuid` header returned. |
| **F4 NACP Compliance** | **WARN** | Catalog routes are truly public (no auth, no authority). The response contains no NACP authority stamp. This is acceptable for a read-only catalog that returns static per-deploy data. However, the doc says "optional bearer" while the implementation ignores the Bearer token entirely. If a client passes a Bearer token, it is silently discarded — no authority enrichment occurs. This could be misleading for clients that expect personalized catalogs based on their plan level. |

**Issues**:

- **F4 WARN**: Doc says "optional bearer" but implementation discards Bearer entirely. "Optional" implies the token would be used if present, but it is not. The doc should either say "none" or the implementation should respect the token for authority-aware catalog filtering (e.g., preview features gated by plan level).

---

### 2.2 `GET /catalog/commands`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:517`. Handler returns `CATALOG_COMMANDS` (5 entries). |
| **F2 Test Coverage** | **PASS** | `smoke.test.ts:356-372`: verifies non-empty `commands`, asserts `/start` is present. |
| **F3 Shape Compliance** | **PASS** | Same as `/catalog/skills`. |
| **F4 NACP Compliance** | **WARN** | Same as `/catalog/skills` — "optional bearer" claimed but token discarded. |

**Issues**: Same F4 WARN as 2.1.

---

### 2.3 `GET /catalog/agents`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `index.ts:518`. Handler returns `CATALOG_AGENTS` (2 entries). |
| **F2 Test Coverage** | **PASS** | `smoke.test.ts:374-390`: verifies non-empty `agents`, asserts `nano-default` is present. |
| **F3 Shape Compliance** | **PASS** | Same as `/catalog/skills`. |
| **F4 NACP Compliance** | **WARN** | Same as `/catalog/skills`. |

**Issues**: Same F4 WARN as 2.1.

---

### 2.4 Catalog Cluster Summary

| Endpoint | F1 | F2 | F3 | F4 | Key Issue |
|----------|----|----|----|----|-----------|
| `GET /catalog/skills` | PASS | PASS | PASS | WARN | "Optional bearer" in doc but discarded in impl |
| `GET /catalog/commands` | PASS | PASS | PASS | WARN | Same |
| `GET /catalog/agents` | PASS | PASS | PASS | WARN | Same |

**Cluster-level findings**:

1. **WARN (F4)**: All three catalog endpoints claim "optional bearer" auth in the doc, but the implementation in `handleCatalog()` (line 853: `_env` prefix) explicitly ignores auth. If bearer is truly optional, the doc should state "none" since the token is never consumed. If future intent is to support authority-aware catalog filtering, this should be documented as a TODO, not as a current capability.

2. **OBSERVATION**: Catalog data is static per-deploy (loaded from `catalog-content.ts`). There are no tests that validate the schema of each catalog entry against the `CatalogEntry` TypeScript interface. If fields are added/removed from `catalog-content.ts`, there is no automated check that the shape still matches the documented structure.

---

## 3. Checkpoints Cluster (`clients/api-docs/checkpoints.md`)

---

### 3.1 `GET /sessions/{id}/checkpoints`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `parseSessionCheckpointRoute` → `kind: "list"`. Handler: `handleSessionCheckpoint`, lines 1308-1325. Calls `repo.listCheckpoints({ session_uuid, team_uuid })`, returns 200 with `{ session_uuid, conversation_uuid, checkpoints }`. |
| **F2 Test Coverage** | **PASS** | `chat-lifecycle-route.test.ts`: `GET /sessions/{uuid}/checkpoints` returns 200 with checkpoint list. `checkpoint-restore-plane.test.ts`: D1-backed checkpoint CRUD tests. |
| **F3 Shape Compliance** | **PASS** | Requires Bearer auth (`authenticateRequest()`). Response matches doc shape: `{ ok: true, data: { session_uuid, conversation_uuid, checkpoints: [...] }, trace_uuid }`. Each checkpoint entry includes all fields documented. |
| **F4 NACP Compliance** | **PASS** | Facade-level auth enforces NACP authority translation: JWT → `IngressAuthSnapshot` with `team_uuid`/`user_uuid`. Session ownership verified: `session.team_uuid === auth.snapshot.team_uuid` AND `session.actor_user_uuid === auth.user_uuid`. Tenant boundary enforced. Trace UUID from auth result. |

**Issues**: None.

---

### 3.2 `POST /sessions/{id}/checkpoints`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `parseSessionCheckpointRoute` → `kind: "create"`. Handler: lines 1327-1359. Parses optional `label` (1-200 chars), creates `user_named` checkpoint via `repo.createUserCheckpoint()`. Returns 201. |
| **F2 Test Coverage** | **PASS** | `chat-lifecycle-route.test.ts`: creates a checkpoint, asserts 201 and `checkpoint_kind: "user_named"`. |
| **F3 Shape Compliance** | **PASS** | Request: `{ label? }` — matches doc. Label validation: null/empty-string accepted (becomes `null`), 1-200 chars enforced, 200+ rejected with `invalid-input` (400). Response: 201 with checkpoint object. |
| **F4 NACP Compliance** | **PASS** | Same auth + ownership gate as list. |

**Issues**: None.

---

### 3.3 `GET /sessions/{id}/checkpoints/{checkpoint_uuid}/diff`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `parseSessionCheckpointRoute` → `kind: "diff"`. Handler: lines 1454-1473. Calls `repo.readCheckpointDiff()`, returns diff with `checkpoint`, `messages_since_checkpoint`, `superseded_messages`. |
| **F2 Test Coverage** | **PASS** | `chat-lifecycle-route.test.ts`: returns diff with expected fields. `checkpoint-diff-projector.test.ts`: unit-level diff computation tests with D1 fixtures. |
| **F3 Shape Compliance** | **FINDING** | The doc specifies the diff response as `{ session_uuid, conversation_uuid, diff: { checkpoint, watermark_created_at, messages_since_checkpoint, superseded_messages } }`. The implementation returns the raw `D1CheckpointDiff` from `repo.readCheckpointDiff()`. Let me verify the shape alignment... The `D1CheckpointDiff` type (`session-truth.ts:188-206`) includes: `checkpoint_uuid, checkpoint_kind, watermark_created_at, messages_since_checkpoint, superseded_messages`. The handler wraps this as `data.diff = diff`, which matches. |
| **F4 NACP Compliance** | **PASS** | Same auth + ownership gate. |

**Issues**:

- **OBSERVATION**: The doc mentions "workspace / artifact delta projector" (line 124) as a future enhancement that is NOT yet wired into the route handler. The `CheckpointDiffProjector` class exists in `checkpoint-diff-projector.ts` but is only used in tests. The current response only contains message-level diff. This is documented behavior (doc says "当前 public facade 仍是 message-only projection"), so it's not a compliance violation — just a noted incompleteness.

---

### 3.4 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore`

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F1 Functionality** | **PASS** | Route: `parseSessionCheckpointRoute` → `kind: "restore"`. Handler: lines 1369-1452. Validates `mode` (must be `conversation_only | files_only | conversation_and_files`), validates `confirmation_uuid`, reads confirmation from D1, verifies `kind === "checkpoint_restore"` and `status === "pending"`, opens restore job via `D1CheckpointRestoreJobs.openJob()`. Returns 202. |
| **F2 Test Coverage** | **PASS** | `chat-lifecycle-route.test.ts`: creates a pending confirmation, then posts restore with `{ mode: "conversation_only", confirmation_uuid }`, asserts 202 and restore job shape. `checkpoint-restore-plane.test.ts`: unit tests for `openJob()`, `RESTORE_REQUEST_MODES`, constraint handling. |
| **F3 Shape Compliance** | **PASS** | Request: `{ mode, confirmation_uuid }` — matches doc. Response: 202 with `{ session_uuid, conversation_uuid, checkpoint, restore_job }`. `restore_job` includes all fields documented: `job_uuid, checkpoint_uuid, session_uuid, mode, target_session_uuid, status, confirmation_uuid, started_at, completed_at, failure_reason`. |
| **F4 NACP Compliance** | **PASS** | Same auth + ownership gate. Confirmation gate enforces that only `pending` confirmations can trigger a restore — this is a NACP-aligned pattern where state-machine transitions are validated before proceeding. |

**Issues**:

- **OBSERVATION**: The doc states `fork` mode is not accepted for public restore (`RESTORE_REQUEST_MODES` only includes `conversation_only | files_only | conversation_and_files`). This aligns with the code at `index.ts:49-50`. If `fork` mode is submitted, the endpoint returns 400 `invalid-input`. This matches the doc's "public restore 现阶段不接受 `fork`" statement.

---

### 3.5 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore` — Error in Confirmation-Already-Resolved

| Dimension | Verdict | Detail |
|-----------|---------|--------|
| **F3 Shape Compliance** | **FINDING** | When a confirmation is already resolved (not `pending`), the handler returns status 409 with a body shape that includes an extra `data: { confirmation }` field alongside `error`. This deviates from the standard `facade-http-v1` error envelope which should only have `{ ok: false, error: {...}, trace_uuid }`. The current response at lines 1410-1422 is: `{ ok: false, error: { code, status, message }, data: { confirmation }, trace_uuid }`. The `data` field on an error response is not part of the facade-http-v1 spec. |

**Issues**:

- **FINDING (F3)**: The `confirmation-already-resolved` error response (lines 1410-1422) includes a `data` field alongside `error`, producing `{ ok: false, error: {...}, data: { confirmation }, trace_uuid }`. This violates the facade-http-v1 contract which dictates that error responses should only contain `{ ok: false, error, trace_uuid }`. The `data` field should either be moved into `error.details` or removed.

---

### 3.6 Checkpoints Cluster Summary

| Endpoint | F1 | F2 | F3 | F4 | Key Issue |
|----------|----|----|----|----|-----------|
| `GET /sessions/{id}/checkpoints` | PASS | PASS | PASS | PASS | — |
| `POST /sessions/{id}/checkpoints` | PASS | PASS | PASS | PASS | — |
| `GET /sessions/{id}/checkpoints/{id}/diff` | PASS | PASS | PASS | PASS | Diff is message-only (documented) |
| `POST /sessions/{id}/checkpoints/{id}/restore` | PASS | PASS | FINDING | PASS | Error response includes non-standard `data` field |

---

## 4. Cross-Cutting NACP Compliance Analysis

### 4.1 NACP Authority Translation (Client → Facade → Internal)

| Route Type | Authority Source | Translation Mechanism | NACP Compliance |
|------------|------------------|----------------------|-----------------|
| Auth public routes (`register`, `login`, `refresh`, `wechatLogin`) | None (no auth) | Auth worker resolves identity from credentials | **PASS** — No authority to translate; first-party credentials create identity |
| Auth token-verification routes (`verify`, `me`, `/me`, `password/reset`) | Bearer token (facade extracts) | Token passed as `access_token` field in RPC body | **FINDING** — Authority is resolved inside the auth worker, not at the facade. Device gate is bypassed. |
| Auth facade-authenticated routes (`api-keys/revoke`) | Bearer token (facade verifies) | `authenticateRequest()` at facade → `team_uuid`/`user_uuid` injected into RPC | **PASS** — Standard NACP authority translation |
| Catalog routes | None | No auth, no authority | **PASS** — Truly public, no authority needed |
| Checkpoint routes | Bearer token (facade verifies) | `authenticateRequest()` at facade → `IngressAuthSnapshot` | **PASS** — Full authority translation with tenant boundary enforcement |

### 4.2 Trace UUID Propagation

| Route Type | Trace UUID Source | Propagation |
|------------|-------------------|-------------|
| Auth routes (proxy) | `readTraceUuid(request) ?? crypto.randomUUID()` | Passed as `meta.trace_uuid` in RPC → auth worker uses it → facade wraps response with `x-trace-uuid` header | **PASS** |
| Catalog routes | `readTraceUuid(request) ?? crypto.randomUUID()` | Directly in response body + header | **PASS** |
| Checkpoint routes | `authenticateRequest()` returns `trace_uuid` which is `readTraceUuid(request)` (required) | Used in all response bodies and headers | **PASS** — But note: checkpoint routes **require** `x-trace-uuid` header (via `authenticateRequest()`), while auth proxy routes only **recommend** it (fallback to `crypto.randomUUID()`) |

### 4.3 Error Code Alignment (facade-http-v1 vs NACP)

The `FacadeErrorCodeSchema` in `facade-http.ts` is a superset of `AuthErrorCodeSchema` and `RpcErrorCodeSchema` (from `@haimang/nacp-core`). Compile-time guarantees enforce this:

- `_authErrorCodesAreFacadeCodes` (line 92-93): ensures every auth error code has a facade equivalent.
- `_rpcErrorCodesAreFacadeCodes` (line 111-112): ensures every RPC error code has a facade equivalent.

**PASS** — Error code alignment is mechanically enforced at the type level. The `facadeFromAuthEnvelope()` function re-validates error codes and maps unknown codes to `internal-error`.

### 4.4 Tenant Boundary Enforcement

| Route | Tenant Check |
|-------|-------------|
| Auth routes | Auth worker resolves `team_uuid` from JWT claims; no explicit tenant-boundary check at facade |
| `/auth/api-keys/revoke` | Facade injects `team_uuid` from auth snapshot; auth worker verifies key belongs to `team_uuid` |
| Catalog | No tenant check (public data) |
| Checkpoints | `session.team_uuid === auth.snapshot.team_uuid` AND `session.actor_user_uuid === auth.user_uuid` |
| NACP internal seams | `verifyTenantBoundary()` (5 rules) enforced by `ServiceBindingTransport` |

**PASS** for session-bound endpoints. **OBSERVATION**: Auth routes don't enforce tenant boundary at the facade because the auth worker IS the source of tenant identity — it creates and resolves team_uuid. This is architecturally correct.

### 4.5 Facade-http-v1 Envelope Compliance

All endpoints return responses in the standard `{ ok, data?, error?, trace_uuid }` envelope. The `x-trace-uuid` response header is always set.

**One exception**: The `confirmation-already-resolved` error response includes a `data` field, which is not part of the standard error envelope. See finding 3.5.

---

## 5. Summary of Findings

### CRITICAL (0)

None.

### FINDINGS (2)

| ID | Cluster | Dimension | Description |
|----|---------|-----------|-------------|
| **F-AUTH-01** | Auth | F3 | Auth routes `/auth/verify`, `/auth/me`, `/me`, `/auth/password/reset` bypass the facade-level `authenticateRequest()` device gate. The device revocation check in `authenticateRequest()` is skipped for these routes. While the auth worker verifies the token, device revocation is not checked on the auth worker side for these endpoints. |
| **F-CHK-01** | Checkpoints | F3 | The `confirmation-already-resolved` (409) error response in the restore endpoint includes a `data: { confirmation }` field alongside `error`, which is not part of the `facade-http-v1` error envelope spec. |

### WARNINGS (4)

| ID | Cluster | Dimension | Description |
|----|---------|-----------|-------------|
| **W-AUTH-01** | Auth | F2 | `POST /auth/verify` lacks a dedicated service-level test for JWT `verifyToken()` that asserts the `VerifyTokenResult` shape. |
| **W-AUTH-02** | Auth | F2 | The `/me` alias route (without `/auth/` prefix) has no explicit E2E test. |
| **W-AUTH-03** | Auth | F3 | Double-spread of `deviceMetadata` in `POST /auth/wechat/login` at `index.ts:614`. Harmless but indicates a code smell. |
| **W-CAT-01** | Catalog | F4 | All three catalog endpoints claim "optional bearer" auth in docs but the implementation silently discards the Bearer token. Should either update docs to "none" or implement authority-aware filtering. |

### OBSERVATIONS (2)

| ID | Cluster | Description |
|----|---------|-------------|
| **O-CHK-01** | Checkpoints | Checkpoint diff is message-only projection; workspace/artifact projector exists but is not wired. Documented as future work. |
| **O-CHK-02** | Checkpoints | Fork mode is intentionally excluded from public restore (`RESTORE_REQUEST_MODES` only includes 3 modes). |

---

## 6. Recommendations

1. **F-AUTH-01**: Consider adding device revocation check to the auth worker for token-verification endpoints, or make `authenticateRequest()` the standard gate for all authenticated routes (including auth self-verification routes). The current pattern where `/auth/api-keys/revoke` uses facade-level auth but `/auth/verify` and `/auth/me` don't is inconsistent.

2. **F-CHK-01**: Remove the `data` field from the `confirmation-already-resolved` error response, or fold the confirmation detail into `error.details` to comply with the `facade-http-v1` envelope spec.

3. **W-AUTH-01**: Add a service-level test for `verifyToken()` with a JWT access token asserting the full `VerifyTokenResult` shape including `{ valid: true, user, team, snapshot }`.

4. **W-AUTH-02**: Add an E2E test for `GET /me` (the alias route).

5. **W-CAT-01**: Update `catalog.md` to change "optional bearer" to "none" since the implementation discards the token, or add a comment that authority-aware catalog filtering is a future capability.

6. **W-AUTH-03**: Clean up the double-spread of `deviceMetadata` in the wechat login path.

---

## 7. Test Coverage Matrix

| Endpoint | Unit Tests | Integration/Facade Tests | E2E Tests |
|----------|-----------|--------------------------|-----------|
| `POST /auth/register` | `service.test.ts` | `smoke.test.ts` | `bootstrap-hardening.test.ts` |
| `POST /auth/login` | `service.test.ts` | `smoke.test.ts` | `bootstrap-hardening.test.ts`, `auth.test.js` (wechat) |
| `POST /auth/refresh` | `service.test.ts` | — | `bootstrap-hardening.test.ts` |
| `POST /auth/verify` | `service.test.ts` (API key path only) | — | — |
| `GET /auth/me` & `GET /me` | `service.test.ts` | — | `auth.test.js` (wechat) |
| `POST /auth/password/reset` | `service.test.ts` | — | — |
| `POST /auth/wechat/login` | `service.test.ts` | — | `auth.test.js` (wechat) |
| `POST /auth/api-keys/revoke` | `service.test.ts` | — | — |
| `GET /catalog/skills` | — | `smoke.test.ts` | — |
| `GET /catalog/commands` | — | `smoke.test.ts` | — |
| `GET /catalog/agents` | — | `smoke.test.ts` | — |
| `GET /sessions/{id}/checkpoints` | `checkpoint-restore-plane.test.ts` | `chat-lifecycle-route.test.ts` | — |
| `POST /sessions/{id}/checkpoints` | — | `chat-lifecycle-route.test.ts` | — |
| `GET /sessions/{id}/checkpoints/{id}/diff` | `checkpoint-diff-projector.test.ts` | `chat-lifecycle-route.test.ts` | — |
| `POST /sessions/{id}/checkpoints/{id}/restore` | `checkpoint-restore-plane.test.ts` | `chat-lifecycle-route.test.ts` | — |

---

## 8. File Reference Index

| File | Lines | Role |
|------|-------|------|
| `workers/orchestrator-core/src/index.ts` | 510-534, 558-667, 838-875, 1273-1474 | Route parsing, auth proxy, catalog handler, checkpoint handler |
| `workers/orchestrator-core/src/auth.ts` | 221-327 | `authenticateRequest()` — JWT/API-key auth + device gate |
| `workers/orchestrator-auth/src/service.ts` | 440-808 | All auth business logic |
| `workers/orchestrator-auth/src/index.ts` | 152-191 | RPC entrypoint delegating to `AuthService` |
| `packages/orchestrator-auth-contract/src/index.ts` | 122-186 | Zod input schemas for all auth operations |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | 1-213 | `facade-http-v1` envelope contract |
| `workers/orchestrator-core/src/catalog-content.ts` | 15-99 | Static catalog data |
| `workers/orchestrator-core/src/checkpoint-restore-plane.ts` | 218-543 | Snapshot + restore job state machine |
| `workers/orchestrator-core/src/checkpoint-diff-projector.ts` | 39-195 | Diff projector (not yet wired to route) |
| `workers/orchestrator-core/src/session-truth.ts` | 1260-1464 | D1 checkpoint CRUD operations |
| `packages/nacp-core/src/envelope.ts` | — | NACP envelope definition (6-layer validation) |
| `packages/nacp-core/src/tenancy/boundary.ts` | — | 5-rule tenant boundary verification |
| `packages/nacp-core/src/admissibility.ts` | — | Runtime delivery policy checks |