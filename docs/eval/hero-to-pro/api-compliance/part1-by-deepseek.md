# API Compliance Report — Part 1 (Auth / Catalog / Checkpoints)

> **Scope**: `clients/api-docs/auth.md`, `clients/api-docs/catalog.md`, `clients/api-docs/checkpoints.md`
> **Evaluator**: deepseek (auto)
> **Profile**: `facade-http-v1`
> **Date**: 2026-05-01

---

## Summary

| Cluster | Endpoints | Trace OK | Tests OK | Shape/Auth OK | NACP OK | Verdict |
|---------|-----------|----------|----------|---------------|---------|---------|
| Auth | 9 | ✅ | ✅ | ✅ | ✅ | **PASS** |
| Catalog | 3 | ✅ | ✅ | ⚠️ minor | ✅ | **PASS** |
| Checkpoints | 4 | ✅ | ✅ | ✅ | ✅ | **PASS** |

Total: **16 endpoints reviewed**, all pass. One documentation nit (catalog auth) noted below.

---

## 1. Auth API — 9 Endpoints

### 1.1 Route Trace

All auth routes follow the same execution path:

```
Client → orchestrator-core facade
  → dispatchFetch()                         index.ts:634
  → parseAuthRoute()                        index.ts:522-536
  → proxyAuthRoute()                        index.ts:558-632
  → env.ORCHESTRATOR_AUTH.<action>(...)     RPC service binding
  → OrchestratorAuthEntrypoint             orchestrator-auth/src/index.ts:144
  → AuthService.<action>()                  orchestrator-auth/src/service.ts
  → facadeFromAuthEnvelope()               facde-http.ts:186-213
```

No route resolution collision — `parseAuthRoute` runs before all session routes (priority position in waterfall at line 658-661).

---

### 1.2 Per-Endpoint Analysis

#### 1.2.1 `POST /auth/register`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute → "register"` → `env.ORCHESTRATOR_AUTH.register(input, meta)` |
| **Auth required** | ✅ none | No bearer token parsing in this codepath (line 576-578: `input = { ...body, ...deviceMetadata }`) |
| **Request shape** | ✅ | Email (`string`), password (`string`), display_name (optional) — validated by AuthService zod schema |
| **Response shape** | ✅ | Wrapped via `facadeFromAuthEnvelope` → `{ok, data: AuthFlowResult, trace_uuid}` |
| **Error codes** | ✅ matched | `identity-already-exists`(409), `worker-misconfigured`(503), `invalid-auth-body`(400) — all defined in `FacadeErrorCodeSchema` |
| **Device metadata** | ✅ | `x-device-uuid`, `x-device-label`, `x-device-kind` headers read and forwarded (line 547-555, 577) |
| **Test coverage** | ✅ | `service.test.ts:227` — register success + duplicate rejection |
| **NACP** | ✅ | Wrapped in facade-http-v1 envelope; auth contract lives in `orchestrator-auth-contract` |

#### 1.2.2 `POST /auth/login`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute → "login"` → `env.ORCHESTRATOR_AUTH.login(input, meta)` |
| **Auth required** | ✅ none | Same codepath as register |
| **Request shape** | ✅ | `{email, password}`, device metadata headers optional |
| **Response shape** | ✅ | `AuthFlowResult` wrapped in facade envelope |
| **Error codes** | ✅ matched | `password-mismatch`(401), `identity-not-found`(404), `worker-misconfigured`(503), `invalid-auth-body`(400) |
| **Test coverage** | ✅ | `service.test.ts:256` — login success flow; `service.test.ts:527` — audit record emission; `service.test.ts:394` — invalid caller rejection |
| **NACP** | ✅ | Same envelope wrapping |

#### 1.2.3 `POST /auth/refresh`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute → "refresh"` → `env.ORCHESTRATOR_AUTH.refresh(input, meta)` |
| **Auth required** | ✅ none | Uses opaque refresh token, not bearer JWT |
| **Request shape** | ✅ | `{refresh_token: string}`, plus device metadata headers |
| **Response shape** | ✅ | `AuthFlowResult` with new token pair |
| **Error codes** | ✅ matched | `refresh-invalid`(401), `refresh-revoked`(401), `refresh-expired`(401), `identity-not-found`(404), `worker-misconfigured`(503) |
| **Test coverage** | ✅ | `service.test.ts:270` — refresh success + replay rejection; `service.test.ts:462` — device binding enforcement |
| **NACP** | ✅ | Envelope consistent |

#### 1.2.4 `POST /auth/verify`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute → "verify"` → `env.ORCHESTRATOR_AUTH.verifyToken(input, meta)` |
| **Auth required** | ✅ bearer | Token read from `Authorization: Bearer` header (line 538-545, 578); body not used for token |
| **Request shape** | ✅ | Body can be empty (`{}`); docs say "facade 不从 body 读取 access_token" — confirmed at line 579: `{ access_token: accessToken }` |
| **Response shape** | ✅ | `AuthView + {valid:true}` |
| **Error codes** | ✅ matched | `invalid-auth`(401), `identity-not-found`(404), `worker-misconfigured`(503) |
| **Test coverage** | ✅ | `service.test.ts:263` — implicit via me test (uses same verifyToken path) |
| **NACP** | ✅ | Envelope consistent |

#### 1.2.5 `GET /auth/me` & `GET /me`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute` line 532-534: both `/auth/me` and `/me` match `action: "me"` |
| **Auth required** | ✅ bearer | Token via header → sent as `access_token` (line 579) |
| **Request shape** | ✅ | No body needed; `GET` preferred (docs say POST is tolerated, body ignored) |
| **Response shape** | ✅ | `AuthView` — `{user, team, snapshot}` |
| **Test coverage** | ✅ | `service.test.ts:263` — me returns correct membership_level, team_name, team_slug, device_uuid |
| **NACP** | ✅ | Envelope consistent |

**Note**: `body === null && action !== "me"` check at line 572-573 correctly exempts `/me` from body requirement. POST to `/me` with body is silently ignored (`action === "me" ? {} : await parseBody(...)`).

#### 1.2.6 `POST /auth/password/reset`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute → "resetPassword"` → `env.ORCHESTRATOR_AUTH.resetPassword(input, meta)` |
| **Auth required** | ✅ bearer | Both access_token (from header) and body fields required (line 582) |
| **Request shape** | ✅ | `{old_password, new_password}` + bearer token injected as `access_token` |
| **Response shape** | ✅ | `AuthView + {password_reset:true}` |
| **Error codes** | ✅ matched | `invalid-auth`(401), `password-mismatch`(401), `identity-not-found`(404), `worker-misconfigured`(503) |
| **Test coverage** | ✅ | `service.test.ts:292` — old password required, successful reset, re-login with new password |
| **NACP** | ✅ | Envelope consistent |

#### 1.2.7 `POST /auth/wechat/login`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute → "wechatLogin"` → `env.ORCHESTRATOR_AUTH.wechatLogin(input, meta)` |
| **Auth required** | ✅ none | Body + device metadata forwarded |
| **Request shape** | ✅ | WeChat `code`, optional `encrypted_data`/`iv`; device headers forwarded |
| **Response shape** | ✅ | `AuthFlowResult` |
| **Test coverage** | ✅ | `service.test.ts:331` — wechat identity bootstrap + reuse; `service.test.ts:344` — display name from decrypted profile; `service.test.ts:369` — mismatched openid rejection |
| **NACP** | ✅ | Envelope consistent |

#### 1.2.8 `POST /auth/api-keys/revoke`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseAuthRoute → "revokeApiKey"` → special auth path at lines 585-596 |
| **Auth required** | ✅ bearer | `authenticateRequest()` called explicitly at line 586; `team_uuid` and `user_uuid` injected from snapshot |
| **Request shape** | ✅ | Client sends `{key_id: "nak_..."}` only; `team_uuid`/`user_uuid` injected server-side (line 592-596) |
| **Response shape** | ✅ | `{key_id, team_uuid, revoked_at}` |
| **Error codes** | ✅ matched | `invalid-auth`(401), `missing-team-claim`(403), `not-found`(404), `permission-denied`(403), `worker-misconfigured`(503) |
| **Test coverage** | ✅ | `service.test.ts:490` — API key create and verify lifecycle; `service.test.ts:567` — revoke + audit record; `service.test.ts:609` — legacy single-segment API key compatibility |
| **NACP** | ✅ | Envelope consistent |

---

### 1.3 Auth Mechanism Verification

| Claim | Verified |
|-------|----------|
| Access token = HMAC HS256 JWT, 1h default expiry | ✅ `mintAccessToken()` in `orchestrator-auth/src/jwt.ts` |
| Refresh token = opaque string, 30d default expiry, D1 `nano_auth_sessions` | ✅ `D1AuthRepository.createAuthSession()` |
| `snapshot.team_uuid` === `snapshot.tenant_uuid` | ✅ Line 194-195 in auth.ts: both set to same value |
| `kid` keyring support | ✅ `sharedCollectVerificationKeys()` + `JWT_SIGNING_KEY_v1` env var, test at `auth.test.ts:6` |
| Device gate | ✅ `readDeviceStatus()` checks `nano_user_devices` D1 table with 30s TTL cache |

**JWT Payload Requirements**: The `authenticateRequest()` function (auth.ts:221-327) enforces:
- `team_uuid` or `tenant_uuid` must be present (line 263) → 403 `missing-team-claim`
- `device_uuid` must be present (line 271) → 401 `invalid-auth`
- Token must not be expired (handled by `verifyJwtAgainstKeyring`)
- `nak_` API keys get special path through `authenticateApiKey()`

---

## 2. Catalog API — 3 Endpoints

### 2.1 Route Trace

```
Client → orchestrator-core facade
  → dispatchFetch()                    index.ts:634
  → parseCatalogRoute()                index.ts:512-520
  → handleCatalog()                    index.ts:851-875
  → catalog-content.ts static arrays   catalog-content.ts
```

### 2.2 Per-Endpoint Analysis

#### 2.2.1 `GET /catalog/skills`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseCatalogRoute → "skills"` → `handleCatalog(request, env, "skills")` |
| **Auth required** | ✅ optional (de facto none) | Handler does NOT read `Authorization` header at all — line 856 only reads `x-trace-uuid` |
| **Request shape** | ✅ | `GET` with no body or query params |
| **Response shape** | ✅ | `{ok: true, data: {skills: CatalogEntry[]}, trace_uuid}` |
| **Content** | ✅ 4 entries | `context-assembly`, `filesystem-host-local`, `bash-tool-call`, `permission-gate` |
| **Test coverage** | ✅ | `smoke.test.ts:332` — verifies envelope, skills array non-empty, entries have required fields |
| **NACP** | ✅ | facade-http-v1 envelope (line 871-874) |

#### 2.2.2 `GET /catalog/commands`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseCatalogRoute → "commands"` |
| **Content** | ✅ 5 entries | `/start`, `/input`, `/messages`, `/cancel`, `/files` |
| **Test coverage** | ✅ | `smoke.test.ts:356` — verifies commands registry includes `/start` |

#### 2.2.3 `GET /catalog/agents`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseCatalogRoute → "agents"` |
| **Content** | ✅ 2 entries | `nano-default`, `nano-preview-verify` |
| **Test coverage** | ✅ | `smoke.test.ts:374` — verifies agents registry includes `nano-default` |

### 2.3 ⚠️ Documentation Nit: Auth vs Reality

**Documentation says**: `Auth: optional bearer; 当前 route 不读取 bearer，未传也会成功`

**Code reality**: The `handleCatalog()` function (line 851-875) never calls `authenticateRequest()` and never reads the `Authorization` header. The "optional bearer" phrasing in docs could mislead clients into thinking bearer tokens are validated when present — they are silently ignored.

**Recommendation**: Document as `none` rather than `optional bearer` to reflect code truth, or implement token validation when a bearer token IS provided.

---

## 3. Checkpoints API — 4 Endpoints

### 3.1 Route Trace

```
Client → orchestrator-core facade
  → dispatchFetch()                        index.ts:634
  → ensureTenantConfigured()               index.ts:735
  → parseSessionCheckpointRoute()          index.ts:1173-1197
  → handleSessionCheckpoint()              index.ts:1273-1474
  → authenticateRequest()                  auth.ts:221
  → D1SessionTruthRepository              session-truth.ts
```

All checkpoint routes share the same auth/authorization pattern:
1. Bearer token validated via `authenticateRequest()` (line 1278)
2. Session ownership verified: `session.team_uuid === auth team_uuid` AND `session.actor_user_uuid === auth user_uuid` (line 1292-1296)
3. Deleted conversation guard (line 1299-1306)

### 3.2 Per-Endpoint Analysis

#### 3.2.1 `GET /sessions/{id}/checkpoints`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseSessionCheckpointRoute → {kind:"list"}` → `repo.listCheckpoints()` |
| **Auth required** | ✅ bearer + ownership | Team + user match enforced (line 1294-1295) |
| **Request shape** | ✅ | `GET` with session UUID in path, no query params |
| **Response shape** | ✅ | `{ok, data: {session_uuid, conversation_uuid, checkpoints: [...]}, trace_uuid}` |
| **Error codes** | ✅ matched | `not-found`(404) for missing session, `conversation-deleted`(409) for tombstone |
| **Test coverage** | ✅ | `chat-lifecycle-route.test.ts:366` — lists 1 pre-existing checkpoint row |
| **NACP** | ✅ | Wrapped in facade-http-v1 via `wrapSessionResponse` (the D1 call returns plain JSON, wrapper at lines 2982-2989 injects `trace_uuid`) |

#### 3.2.2 `POST /sessions/{id}/checkpoints`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseSessionCheckpointRoute → {kind:"create"}` → `repo.createUserCheckpoint()` |
| **Auth required** | ✅ bearer + ownership | Same as list |
| **Request shape** | ✅ | `{label?: string}` — optional, max 200 chars; validation at line 1329-1337 |
| **Response shape** | ✅ | `{ok, data: {session_uuid, conversation_uuid, checkpoint}, trace_uuid}` — status 201 |
| **Test coverage** | ✅ | `chat-lifecycle-route.test.ts:366` — creates checkpoint with label "Manual save", verifies 201 status and checkpoint shape |
| **NACP** | ✅ | facade-http-v1 envelope |

**Label validation note**: The code trims the label (line 1329) and rejects values > 200 chars. The docs say `label: string ≤ 200; 省略时写 null`. The implementation writes `null` when label is empty after trim (line 1341: `rawLabel.length > 0 ? rawLabel : null`). Match confirmed. ✅

#### 3.2.3 `GET /sessions/{id}/checkpoints/{checkpoint_uuid}/diff`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseSessionCheckpointRoute → {kind:"diff"}` → `repo.readCheckpointDiff()` |
| **Auth required** | ✅ bearer + ownership | Checkpoint resolved from session-scoped list (line 1361-1364) |
| **Request shape** | ✅ | `GET` with both UUIDs in path |
| **Response shape** | ✅ | `{ok, data: {session_uuid, conversation_uuid, diff: {checkpoint, messages_since_checkpoint, superseded_messages}}, trace_uuid}` |
| **Test coverage** | ✅ | `chat-lifecycle-route.test.ts:409` — verifies diff projection includes `messages_since_checkpoint` and `superseded_messages` |
| **NACP** | ✅ | facade-http-v1 envelope |

**Unit tests for diff projector**: `checkpoint-diff-projector.test.ts` covers:
- Non-existent checkpoint → null
- Workspace deltas (added/removed/changed files)
- Non-materialized snapshot rows ignored
- Artifacts created after watermark as `added`
- Pruned watermark message → empty artifact delta

#### 3.2.4 `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore`

| Dimension | Status | Detail |
|-----------|--------|--------|
| **Route trace** | ✅ | `parseSessionCheckpointRoute → {kind:"restore"}` → checkpoint lookup → confirmation gate → `restoreJobs.openJob()` |
| **Auth required** | ✅ bearer + ownership | Same ownership check as all checkpoint routes |
| **Request shape** | ✅ | `{mode: "conversation_only"|"files_only"|"conversation_and_files", confirmation_uuid: UUID}` |
| **Response shape** | ✅ | `{ok, data: {session_uuid, conversation_uuid, checkpoint, restore_job}, trace_uuid}` — status 202 |
| **Error codes** | ✅ matched | `invalid-input`(400), `not-found`(404), `confirmation-already-resolved`(409), `conversation-deleted`(409), `internal-error`(503) |
| **Test coverage** | ✅ | `chat-lifecycle-route.test.ts:441` — verifies restore job open with 202 status, `status: "pending"` |
| **NACP** | ✅ | facade-http-v1 envelope |

**Key validation details**:
- Mode validation at line 1374-1382: must be one of `RESTORE_REQUEST_MODES` (no `fork` yet)
- Confirmation UUID validation at line 1384-1392
- Confirmation kind must be `checkpoint_restore` (line 1401-1407)
- Confirmation must be `pending` status (line 1409-1422)
- `CheckpointRestoreJobConstraintError` caught at line 1447-1450

**Unit tests for restore plane**: `checkpoint-restore-plane.test.ts` covers snapshot plane, restore jobs, constraint errors, R2 key builders, file snapshot policy.

**Known limitation**: Restore executor (`pending → running → terminal`) is not yet live. The API creates a `pending` restore job that requires a later executor cron.

---

## 4. NACP Protocol Compliance

### 4.1 Version Alignment

| Package | Version | SHA-256 (from manifest) |
|---------|---------|------------------------|
| `@haimang/nacp-core` | 1.6.0 | `5061ccd1...` |
| `@haimang/nacp-session` | 1.4.0 | `4ee38ff6...` |
| `@haimang/jwt-shared` | 0.1.0 | `0cbb6f04...` |

All versions match between `.nano-agent/package-manifest.json` and imported constants.

### 4.2 Envelope Conformance

**facade-http-v1 contract** (from `packages/orchestrator-auth-contract/src/facade-http.ts`):

| Rule | Auth API | Catalog API | Checkpoints API |
|------|----------|-------------|-----------------|
| Success: `{ok:true, data, trace_uuid}` | ✅ via `facadeFromAuthEnvelope` | ✅ manual construction (line 871-873) | ✅ via `wrapSessionResponse` |
| Error: `{ok:false, error:{code,status,message}, trace_uuid}` | ✅ via `facadeFromAuthEnvelope` | N/A (static data always succeeds) | ✅ via `jsonPolicyError` + `wrapSessionResponse` |
| `x-trace-uuid` response header | ✅ line 630 | ✅ line 873 | ✅ line 1323/1357/1472 |
| Trace generation when missing | ✅ line 566: `?? crypto.randomUUID()` | ✅ line 856: `?? crypto.randomUUID()` | ❌ `authenticateRequest` rejects missing trace (400) |

**Note on trace requirement**: The auth proxy and catalog handler both auto-generate a trace when `x-trace-uuid` is missing. But authenticated routes (checkpoints, me, etc.) reject requests without trace via `authenticateRequest` at auth.ts:234-238. This is consistent with the docs: "建议所有 auth 请求都传" vs checkpoint routes being protected behind auth gate.

### 4.3 FacadeErrorCode Superset Contract

**Compile-time guard** at `facade-http.ts:92-94`:
```typescript
const _authErrorCodesAreFacadeCodes: AuthErrorCode extends FacadeErrorCode ? true : never = true;
```

**Compile-time guard** at `facade-http.ts:111-114`:
```typescript
const _rpcErrorCodesAreFacadeCodes: RpcErrorCode extends FacadeErrorCode ? true : never = true;
```

Both guards confirm that `FacadeErrorCode` is a superset of both `AuthErrorCode` and `RpcErrorCode`. ✅

### 4.4 Shell Response

`GET /` and `GET /health` return the NACP shell response (index.ts:638-639):

```json
{
  "worker": "orchestrator-core",
  "nacp_core_version": "1.6.0",
  "nacp_session_version": "1.4.0",
  "status": "ok",
  "worker_version": "orchestrator-core@dev",
  "phase": "orchestration-facade-closed",
  "public_facade": true,
  "agent_binding": false
}
```

The `facade-http-v1` profile is correctly advertised. ✅

### 4.5 Binding-Scope Guard

The `orchestrator-auth` worker correctly rejects public HTTP access to business routes (public-surface.ts:29-46). Direct HTTP fetch returns `binding-scope-forbidden`(401), enforcing RPC-only access via `WorkerEntrypoint`. Verified by `public-surface.test.ts:19-31`. ✅

### 4.6 Server-Timing Header

All facade responses inject `Server-Timing: total;dur=N` header via the outer worker.fetch wrapper (index.ts:838-844). Note: `auth` and `agent` timing segments are not yet implemented (documented as future work at line 837).

---

## 5. Issues Found

### 5.1 Catalog Auth Documentation (Low Severity)

**File**: `clients/api-docs/catalog.md`, line 6
**Issue**: `Auth: optional bearer; 当前 route 不读取 bearer，未传也会成功`
**Reality**: The handler never reads auth. Token is silently ignored even when present.
**Recommendation**: Change to `Auth: none` or implement actual token validation to make "optional bearer" truthful.

### 5.2 Restore Executor Not Live (Known — No Action)

**File**: `clients/api-docs/checkpoints.md`, line 221-225
**Issue**: `POST /sessions/{id}/checkpoints/{uuid}/restore` only creates a `pending` job. The executor that transitions `pending → running → terminal` is not yet deployed.
**Status**: Documented as known limitation. No action required.

### 5.3 Workspace/Artifact Delta Projector Not Wired to Diff Route (Known — No Action)

**File**: `clients/api-docs/checkpoints.md`, line 124
**Issue**: `GET /sessions/{id}/checkpoints/{uuid}/diff` only does message-level projection. Workspace/artifact delta from `CheckpointDiffProjector` is tested but not yet connected to the public route.
**Status**: Documented: "workspace / artifact delta projector 还没有接到这个 route". No action required.

---

## 6. Test Coverage Index

| Test File | What It Covers |
|-----------|---------------|
| `workers/orchestrator-core/test/auth.test.ts` | JWT verification: kid-scoped, legacy, expired, malformed, missing team claim, query token rejection |
| `workers/orchestrator-auth/test/service.test.ts` | AuthService: register, login, refresh, me, verify, resetPassword, wechatLogin, API key CRUD, audit, caller validation, forged token rejection, cross-team rejection, device binding |
| `workers/orchestrator-auth/test/public-surface.test.ts` | Public surface: probe health only, binding-scope-forbidden for business routes |
| `workers/orchestrator-core/test/smoke.test.ts` | Integration: auth register proxy, catalog/skills, catalog/commands, catalog/agents, authenticated session route tracing |
| `workers/orchestrator-core/test/chat-lifecycle-route.test.ts` | Integration: checkpoint list, create, diff, restore routes |
| `workers/orchestrator-core/test/checkpoint-diff-projector.test.ts` | Unit: diff projector workspace deltas, artifacts, pruned watermark |
| `workers/orchestrator-core/test/checkpoint-restore-plane.test.ts` | Unit: snapshot plane, restore jobs, constraint errors, R2 key builders |

---

## 7. Final Verdict

| Criterion | Auth | Catalog | Checkpoints |
|-----------|------|---------|-------------|
| 1. Route → code trace | ✅ clear | ✅ clear | ✅ clear |
| 2. Test coverage | ✅ comprehensive | ✅ adequate | ✅ good |
| 3. Shape / Auth correctness | ✅ | ⚠️ doc nit | ✅ |
| 4. NACP compliance | ✅ | ✅ | ✅ |

**Overall**: All 16 documented endpoints are real, functional, and traceable to concrete implementation. Test coverage exists for all critical paths. Input/output shapes match documentation. The facade-http-v1 envelope is consistently applied. NACP version alignment is verified. One minor documentation inaccuracy in catalog auth (Section 5.1).
