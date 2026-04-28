# API Gap Study: Zero-to-Real Readiness Assessment

**Author**: GLM (independent analysis, no reference to GPT, DeepSeek, or other model outputs)  
**Date**: 2026-04-28  
**Context**: 6-worker architecture vs. 3 production CLIs (claude-code, gemini-cli, codex)  
**Scope**: What interfaces, data flows, and internal wiring must exist for a real client to function end-to-end — and what is currently missing

---

## Executive Summary

Our orchestrator-core public facade exposes 22 stable HTTP/WS endpoints and 3 catalog stubs. Three production CLIs — claude-code, gemini-cli, codex — collectively require approximately 50+ distinct API surface points to operate. The gap between what we have and what a real client needs is not a matter of "a few endpoints here and there." It is a structural deficit across seven domains: DDL truth, context lifecycle, filesystem surface, auth & multi-tenancy, bash execution, LLM configuration, and client-facing model control.

**Key finding**: Our architecture has built the skeleton — auth flows, session lifecycle, DO-based hot state, durable truth in D1 — but almost every subsystem has a hard stop before the last mile where a real client would actually consume it. The skeleton holds; the muscles are missing.

---

## 1. DDL Completeness Assessment

### 1.1 What We Have

Our 5 migrations define 11 tables:

| Table | Purpose | Write Path Status |
|-------|---------|-------------------|
| `nano_users` | User identity | Active |
| `nano_user_profiles` | Display name, avatar | Active |
| `nano_user_identities` | Email+password, WeChat | Active |
| `nano_teams` | Team/tenant container | Active |
| `nano_team_memberships` | User↔team binding | Active |
| `nano_auth_sessions` | Refresh token rotation | Active |
| `nano_team_api_keys` | API key management | **DDL only, zero read/write paths** |
| `nano_conversations` | Conversation container | Active |
| `nano_conversation_sessions` | Session per conversation | Active |
| `nano_conversation_turns` | User/assistant turns | Active |
| `nano_conversation_messages` | Durable message history | Active |
| `nano_conversation_context_snapshots` | Context state at turn boundary | Active |
| `nano_session_activity_logs` | Audit trail | Active |
| `nano_quota_balances` | Team quota remaining | **DDL only, zero read/write paths** |
| `nano_usage_events` | Usage metering | **DDL only, zero write paths** |

### 1.2 Critical DDL Gaps

#### Gap 1.2a: `session_status` CHECK Constraint Missing `pending` and `expired`

**Evidence**: DDL migration 002 defines:

```sql
session_status TEXT NOT NULL CHECK(session_status IN ('starting','active','detached','ended'))
```

But TypeScript `SessionStatus` (`workers/orchestrator-core/src/host/session-lifecycle.ts`) includes `'pending'` and `'expired'`:

```typescript
type SessionStatus = "pending" | "starting" | "active" | "detached" | "ended" | "expired";
```

This means a `POST /me/sessions` minted UUID (status `pending`) cannot be durably persisted to the `nano_conversation_sessions` table — the CHECK would reject it. Our own code works around this by simply not writing pending sessions to D1 at all, which means `GET /me/sessions` cannot list freshly minted sessions.

**Verdict**: Hard blocker for session creation → start lifecycle.

#### Gap 1.2b: `nano_quota_balances` and `nano_usage_events` Have Zero Write Paths

**Evidence**: The `QuotaAuthorizer` in `workers/agent-core/src/host/quota/` exists and has a full repository implementation (`QuotaRepository`) with `authorize()`, `commit()`, `ensureBalance()` methods. However, the runtime-mainline.ts integration calls `quotaAuthorizer.authorize("llm", ...)` and `quotaAuthorizer.commit("llm", ...)` around LLM invocations, but the D1 write paths are **never actually invoked in the deployed worker**. The quota authorizer exists as an architectural seam but is not yet wired into the session DO's actual request lifecycle.

**Evidence from code**: `runtime-mainline.ts:291-296` shows the `beforeLlmInvoke` hook calling `authorize`, and `runtime-mainline.ts:298-309` shows the `afterLlmInvoke` hook calling `commit`, but these hooks are only called when `QuotaAuthorizer` is instantiated and passed to `createMainlineKernelRunner()`. The session DO instantiates runtime environment conditionally — `nano-session-do.ts:483` shows `if (!runtimeEnv?.AI) return null`, and the quota path depends on the full mainline being active.

**Verdict**: The usage endpoint `/sessions/{uuid}/usage` returns all-null placeholder values. Real billing/quota is impossible until this pipe is hot.

#### Gap 1.2c: `nano_team_api_keys` Is a Ghost Table

**Evidence**: The DDL defines `nano_team_api_keys` with `api_key_uuid`, `key_hash`, `label`, `key_status`, `scopes_json`, timestamps — but a comprehensive search of the entire codebase shows zero SELECT, INSERT, or UPDATE statements targeting this table. The `verifyApiKey` RPC method on orchestrator-auth returns `{supported: false, reason: "reserved-for-future-phase"}`.

**Verdict**: API key auth is fully absent. A real CLI like claude-code or codex uses API key auth as the primary auth method. We cannot serve any third-party client without this.

#### Gap 1.2d: Missing Tables for Real Client Operation

Reference CLIs persist and query data that has no DDL home:

| Required by | Table Needed | Status |
|---|---|---|
| All 3 CLIs | `nano_user_preferences` / `nano_user_settings` | No DDL |
| All 3 CLIs | `nano_skill_registry` / `nano_command_registry` / `nano_agent_registry` | No DDL |
| claude-code | `nano_conversation_files` (file attachment to session) | No DDL |
| gemini-cli | `nano_conversation_memories` (cross-session memory) | No DDL |
| codex | `nano_file_uploads` (upload metadata + status) | No DDL |
| All 3 CLIs | `nano_permission_decisions` (durable, not just DO hot state) | No DDL |
| All 3 CLIs | `nano_models` / `nano_model_configs` (per-team model preferences) | No DDL |
| All 3 CLIs | `nano_provider_configs` (per-team LLM provider configs) | No DDL |
| All 3 CLIs | `nano_oauth_sessions` (third-party OAuth state) | No DDL |

**Verdict**: Our truth layer is 60% complete for auth and session lifecycle, but 0% complete for the surfaces that make a real client useful — files, preferences, model choice, permissions, and memories.

---

## 2. Context Management & Agent Loop Completeness

### 2.1 What We Have

- **ContextAssembler** (`context-core/src/assembler.ts`): Assembles layered context with budget-aware truncation. Supports 6 layer kinds: `system | session | workspace_summary | artifact_summary | recent_transcript | injected`.
- **CompactBoundaryManager** (`context-core/src/compact.ts`): State machine `idle → armed → preparing → committing → committed → failed` for context compaction.
- **InspectorFacade** (`context-core/src/inspector.ts`): HTTP endpoints at `/inspect/sessions/{id}/context/{usage|layers|policy|snapshots|compact-state}`.
- **KernelRunner** (`agent-core/src/kernel/runner.ts`): Step-based agent loop with `llm_call`, `tool_call`, `compact`, `end_turn` decisions.

### 2.2 Critical Gaps

#### Gap 2.2a: Context Window Inspection Not Exposed to Clients

All 3 reference CLIs expose token usage information to the client:

- **claude-code**: `Usage` includes `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` per response. The client can see context utilization at every turn.
- **gemini-cli**: `TokensSummary` is tracked per-message with `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`. The `ChatCompressionService` triggers compression at 50% of model limit.
- **codex**: `ModelInfo.context_window` and `auto_compact_token_limit` are client-visible. `usage` is included in every SSE `response.completed` event.

**We expose nothing equivalent.** Our `/sessions/{uuid}/usage` returns all-null. Our InspectorFacade is gated behind `INSPECTOR_FACADE_ENABLED` env var (not on by default), and it is an internal debugging seam, not a public client API. No client can inspect the context window of an active session.

**Verdict**: A client cannot make intelligent decisions about context management without context utilization data. This is a hard requirement for any real client.

#### Gap 2.2b: Compaction Not Wired into Live Loop

The `KernelRunner` recognizes `StepDecision = "compact"` (runner.ts:106) and has a `requestCompact()` call path. But the `CompactBoundaryManager`'s state machine (`idle → armed → preparing → ...`) is part of context-core which is a library-only package, not a running service. The composition handle for context-core in agent-core is marked `{phase: "P2-stub"}`:

```typescript
// agent-core/src/composition.ts — subsystem handle
context: { phase: "P2-stub", reason: "context-core is consumed in-process via workspace-context-artifacts" }
```

This means compaction triggers are architecturally defined but not actually running in any session loop. If context fills up, we have no mechanism to compact it.

**Verdict**: Sessions will hit context window limits and crash or truncate without intelligent compaction. The `compactBoundaryManager` state machine is 100% dead code in production.

#### Gap 2.2c: `appendInitialContextLayer` Is a P2 Stub

```typescript
// context-core (from exploration)
export function appendInitialContextLayer(...) {
  // "P2 Phase 1 stub" — defaults kind to "session" conservatively
}
```

The initial context seeding that should inject system prompt, workspace summary, and artifact references into a new session is a stub. This means sessions start with a bare system prompt (the hardcoded nano-agent prompt from `runtime-mainline.ts:104-107`), not the rich layered context the ContextAssembler was designed to produce.

#### Gap 2.2d: No Client-Accessible Message API

**The single most critical missing endpoint is `POST /sessions/{id}/messages`.**

All 3 reference CLIs depend on a real-time message protocol:

- **claude-code**: `Anthropic.messages.create({ messages, system, tools, stream: true })` — the entire CLI is a loop around this streaming response.
- **gemini-cli**: `generateContentStream({ contents, systemInstruction, tools })` — same pattern.
- **codex**: `POST /responses` with SSE — same pattern, plus `POST /responses/compact` for context compaction requests.

Our architecture absorbs the entire agent loop server-side (inside the `NanoSessionDO`). The client connects via WebSocket and receives streamed events. This is architecturally valid, but it means:

1. The client cannot send structured message objects (tool results, permission decisions, elicitation answers) — it can only send `text` via `POST /sessions/{uuid}/input`.
2. The client cannot request compaction or context management — this is internal to the agent loop.
3. The client cannot see intermediate reasoning tokens, thinking deltas, or tool-call arguments as they stream — it only sees `llm.delta` content and `tool_use_start` with full argument JSON.

**Verdict**: Our streaming protocol is a thin relay (`{kind: "event", seq, name, payload}`) that sends lightweight frames. The reference CLIs use rich streaming protocols with distinct event types for message start, content block delta, tool use start, tool result, thinking delta, etc. Our `llm.delta` collapses all of these into a single frame kind. This is the biggest gap for a real client experience.

---

## 3. Filesystem & Multi-Modality

### 3.1 What We Have

- **filesystem-core**: `MountRouter`, `WorkspaceNamespace`, `ArtifactStore`, with backends (`memory`, `do-storage`, `kv`, `r2`, `reference`). What appears to be a complete file abstraction.
- **bash-core**: Filesystem handlers (`createFilesystemHandlers`) for `mkdir`, `write`, `read`, `rm`, `stat`, `ls` + search handlers (`rg`, `find`, `grep`).
- **Context layers**: `WorkspaceSnapshotBuilder`, `WorkspaceSnapshotFragment`.

### 3.2 Critical Gaps

#### Gap 3.2a: No Client-Facing File API

`GET /sessions/{id}/files` is listed in our README as "尚未实现" (not yet implemented) and does not exist in the codebase.

A real client needs:
- List files in a workspace/session
- Read file content (possibly binary/multi-modal)
- Upload files (images, PDFs, documents)
- Stream file changes for IDE integration

**Reference evidence**:
- **codex**: `POST /files` (create) → `PUT {upload_url}` (upload) → `POST /files/{id}/uploaded` (finalize) — a 3-step upload pipeline. Plus `fs/readFile`, `fs/writeFile`, `fs/watch` via JSON-RPC.
- **claude-code**: `FileReadTool`, `FileWriteTool`, `FileEditTool` with base64 image support (`BetaImageBlockParam`). The session ingress endpoint `PUT /v1/session_ingress/session/{id}` accepts `Last-Uuid` for optimistic concurrency.
- **gemini-cli**: `read_file`, `read_many_files`, `write_file`, `edit_file`, `glob` as first-class tools, plus `inlineData` (base64 files) in conversation content.

**We have none of these.** A client cannot:
- Upload an image to be analyzed
- Read/write files through a REST API
- Watch for file changes
- List workspace artifacts

#### Gap 3.2b: Multi-Modality Zero Path

All 3 reference CLIs support image/document input:

| CLI | Multi-modality mechanic |
|-----|------------------------|
| claude-code | `BetaImageBlockParam` (base64 or URL) + `BetaRequestDocumentBlockParam` (PDFs) in messages |
| gemini-cli | `inlineData` (base64) + `fileData` (URI) in `Part` type, plus `image_url` in tools |
| codex | `InputImage { image_url }` + three-step file upload, max 512MB, `sediment://{file_id}` URI scheme |

Our `CanonicalContentPart` type supports `'image_url'` kind, and `request-builder.ts` (line 82-92) validates against `supportsVision`. But Workers AI models (`granite-4.0-h-micro`, `llama-4-scout`) both have `supportsVision: false`. Even if a client sent an image_url content part, the `buildExecutionRequest()` validation would reject it with a capability error.

**Verdict**: Multi-modality is partially blocked — the platform offers 4 vision-capable Workers AI models (including `@cf/meta/llama-4-scout-17b-16e-instruct` which is already our fallback and is natively multimodal), but our `ModelRegistry` marks both registered models as `supportsVision: false`, which is incorrect for llama-4-scout. The remaining blockers are: (1) no REST API to upload files, (2) no client-facing model selection to choose a vision model, (3) the `image_url` content part validation in `buildExecutionRequest()` would reject images due to the `supportsVision: false` flag. These are configuration gaps, not platform limitations.

#### Gap 3.2c: filesystem-core and context-core Are Library-Only, Not Service-Bound

The agent-core `wrangler.jsonc` has `CONTEXT_CORE` and `FILESYSTEM_CORE` service bindings **commented out**:

```jsonc
// { binding: "CONTEXT_CORE", service: "nano-agent-context-core" },  // commented out
// { binding: "FILESYSTEM_CORE", service: "nano-agent-filesystem-core" },  // commented out
```

These workers expose HTTP endpoints but all non-probe routes return `401 binding-scope-forbidden`. They are designed to be consumed **in-process** via package imports, not via service bindings. The orchestrator-core health probe list includes them, but no business route forwards to them.

The `listDir` function in filesystem-core uses `new Date().toISOString()` for `modifiedAt` on every entry — no real mtime from any backend. This means file timestamps in listings are always "now."

**Verdict**: The filesystem and context workers exist as code but not as functional service endpoints. They are consumed at the library level by agent-core's composition handles, which are themselves P2-stubs.

---

## 4. Auth & Multi-Tenancy

### 4.1 What We Have

- **Registration**: `POST /auth/register` — email + password, auto-creates user + team + identity.
- **Login**: `POST /auth/login` — email + password.
- **Token flow**: Access token (JWT, 1hr) + refresh token (opaque, 30d, single-use rotation).
- **WeChat**: `POST /auth/wechat/login` — mini-program code exchange.
- **JWT claims**: `sub`, `user_uuid`, `team_uuid`, `tenant_uuid`, `tenant_source`, `membership_level`.
- **DDL**: `nano_teams` with `plan_level`, `nano_team_memberships` with `membership_level`.

### 4.2 Critical Gaps

#### Gap 4.2a: API Key Auth Is Fully Absent

**Evidence**: `orchestrator-auth/src/` — the `verifyApiKey` method:

```typescript
async verifyApiKey(_rawInput: unknown, _rawMeta: unknown): Promise<VerifyApiKeyResult> {
  return { supported: false, reason: "reserved-for-future-phase" };
}
```

The `nano_team_api_keys` DDL table exists but has zero code referencing it. No code creates, reads, or validates API keys.

**Why this matters**: All 3 reference CLIs use API key auth as a primary auth mode:
- **claude-code**: `ANTHROPIC_API_KEY` env var, `create_api_key` endpoint, bearer token in headers
- **gemini-cli**: `GEMINI_API_KEY` env var for direct API access
- **codex**: `CODEX_API_KEY` / `OPENAI_API_KEY` env var, plus device code OAuth flow

A production client cannot authenticate purely through username+password JWT flow — it needs API key auth for CLI-style interactive use, CI/CD use, and programmatic access.

#### Gap 4.2b: No Logout or Token Revocation

There is no `POST /auth/logout` endpoint. Refresh tokens are rotated (single-use) but there is no way to actively revoke an access token. If a token is compromised, the only recourse is to wait for it to expire (1 hour), or rotate the refresh token by performing a refresh (which invalidates the old one only if the attacker hasn't already used it).

**Reference evidence**:  
- **claude-code**: Revoke tokens via device revocation (`POST /api/oauth/claude_cli/revoke`)
- **codex**: `DELETE /v1/environments/bridge/{id}` for bridge session cleanup

#### Gap 4.2c: No User Profile CRUD

Our `POST /auth/register` accepts `display_name` but there is no endpoint to update it afterwards. `nano_user_profiles` has `display_name` and `avatar_url` columns, but no public API writes to them after registration.

**Verdict**: A real client needs profile update endpoints (`PATCH /me/profile`, avatar upload) and user preference endpoints (`GET/PATCH /me/preferences`).

#### Gap 4.2d: Tenant Auto-Naming and Plan Assignment

Registration creates a team with `plan_level: 0` and auto-generates a `team_uuid`. But:
- There is no tenant display name (the `nano_teams` table has no `name` column)
- There is no onboarding flow that sets initial plan level based on subscription
- There is no admin interface to manage teams or memberships

**Reference evidence**:
- **gemini-cli**: `:loadCodeAssist` → user tier determination → `:onboardUser` → long-running operation → plan (`free-tier`, `standard-tier`, `legacy-tier`)
- **codex**: Plan types: `Free`, `Go`, `Plus`, `Pro`, `ProLite`, `Team`, `SelfServeBusinessUsageBased`, `Business`, `EnterpriseCbpUsageBased`, `Enterprise`, `Edu`

#### Gap 4.2e: No Third-Party OAuth

WeChat mini-program login is implemented, but there are no OAuth flows for:
- Google (used by gemini-cli)
- GitHub (common for developer tools)
- Apple, Microsoft, etc.

The `identity_provider` CHECK in DDL is `IN ('email_password', 'wechat')`. Adding a new provider requires both a DDL migration and new auth logic.

#### Gap 4.2f: Multi-tenancy Is Structurally Present but Functionally Dormant

The JWT contains `team_uuid`, `tenant_uuid`, `membership_level`, `plan_level`. The `QuotaAuthorizer` is designed to check team-level quotas. But:
- `plan_level` is hardcoded to `0` on registration
- No code reads `plan_level` to differentiate behavior
- No code reads `membership_level` for access control
- `nano_quota_balances` has zero write paths

**Verdict**: Multi-tenancy exists as labels but not as enforcement. Any user can do anything regardless of their plan or team.

---

## 5. Bash Execution & Internal RPC

### 5.1 What We Have

- **BashCoreEntrypoint**: `call()` and `cancel()` RPC methods with validation.
- **CapabilityCallDO**: Durable Object for capability execution lifecycle.
- **21 tools**: `pwd`, `ls`, `cat`, `write`, `mkdir`, `rm`, `mv`, `cp`, `rg`, `curl`, `ts-exec`, `git` (5 commands), `wc`, `head`, `tail`, `jq`, `sed`, `awk`, `sort`, `uniq`, `diff`.
- **Policy decisions**: `allow | ask | deny | hook-gated`.
- **Execution targets**: `local-ts | service-binding | browser-rendering`.

### 5.2 Critical Gaps

#### Gap 5.2a: No Real Probe Mounting on KV or R2

The bash-core has `FakeBashBridge` for simulated command execution and real handlers for filesystem, search, text processing, network, exec, and VCS. However:

- There is no test harness that verifies actual KV read/write paths through bash-core
- There is no test that verifies R2 file upload/download paths
- The `ExecutionTarget = "service-binding"` path exists but `BASH_CORE` service binding in agent-core is the only example; `CONTEXT_CORE` and `FILESYSTEM_CORE` are commented out

The `CapabilityKind` includes `"network"` (for `curl` handler), but the `curl` handler has a hardcoded allow-list of schemes and budget/timeout restrictions. No real integration test validates that `curl` against a live Workers KV endpoint works.

#### Gap 5.2b: No Streaming Progress for Long-Running Commands

The reference CLIs all support streaming command output:

- **claude-code**: `BashTool` streams stdout/stderr in real-time via the session stream
- **gemini-cli**: `ShellToolInvocation` with background execution, tracked via `pgrep -g 0`
- **codex**: `LocalShellCall` with `status: "in_progress"` and incremental output via SSE

Our capability execution returns a single `CapabilityResult` (success | error | cancelled | not-connected). There is no incremental progress reporting during a long-running command. If `ts-exec` takes 30 seconds, the client sees nothing until it completes.

#### Gap 5.2c: Permission Gate Not Wired to Runtime

The bash-core `PolicyDecision` type includes `'ask'` and `'hook-gated'`, but these are not connected to the WS permission flow. The `POST /sessions/{uuid}/permission/decision` endpoint writes to User DO hot state, but the capability execution path in agent-core does not check this state before executing.

**Evidence**: The `KernelRunner.advanceStep()` has no check for pending permission decisions between tool-call decision and tool execution. The `CompositionHandle.capability` path calls `commandRegistry.execute()` directly without any permission gate.

#### Gap 5.2d: Sandbox Isolation Not Enforced

The reference CLIs implement real sandboxing:
- **claude-code**: Seatbelt sandbox on macOS, `shouldUseSandbox()` check, destructive command detection
- **gemini-cli**: `SandboxManager` with macOS seatbelt profiles
- **codex**: Four-level `SandboxPolicy`: `DangerFullAccess`, `ReadOnly`, `ExternalSandbox`, `WorkspaceWrite` with configurable writable roots

Our `PolicyDecision` supports `'ask'` and `'deny'`, but there is no code that enforces any sandbox policy. The `ts-exec` handler runs TypeScript in the Workers runtime without filesystem or network isolation.

---

## 6. LLM Wrapper & Workers AI Integration

### 6.1 What We Have

- **WorkersAiGateway**: Calls `ai.run(model, payload)` with streaming.
- **Primary model**: `@cf/ibm-granite/granite-4.0-h-micro` (131K context, 8K output).
- **Fallback model**: `@cf/meta/llama-4-scout-17b-16e-instruct` (131K context, 8K output, natively multimodal).
- **Workers AI catalog**: 13 function-calling models available, 4 with vision, including reasoning-capable models (gpt-oss-120b, kimi-k2.5/k2.6, glm-4.7-flash, gemma-4-26b). Only 2 are registered.
- **LLMExecutor**: OpenAI-compatible HTTP adapter with retry, backoff, 429 key rotation.
- **ProviderRegistry**: Round-robin/on-429 API key rotation.
- **ModelRegistry**: Capability checking (stream, tools, vision, json-schema, context window).
- **QuotaAuthorizer**: Pre/post hooks around LLM calls (not yet fully wired to D1).

### 6.2 Critical Gaps

#### Gap 6.2a: Workers AI Binding Is Authenticated but Under-Utilized

After re-authentication, `npx wrangler whoami` confirms the account (`sean.z@haimangtech.cn`, account ID `8b611460403095bdb99b6e3448d1f363`) has full permissions including `ai (write)`. The Workers AI binding is functional — the authentication issue was transient.

**Available Workers AI models with function_calling=True (13 total):**

| Model | Context Window | Reasoning | Price (input/output per M tokens) |
|---|---|---|---|
| `@cf/ibm-granite/granite-4.0-h-micro` | 131,000 | — | $0.017 / $0.11 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 131,000 | — | $0.27 / $0.85 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 24,000 | — | — |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 128,000 | — | — |
| `@cf/google/gemma-4-26b-a4b-it` | 256,000 | **Yes** | — |
| `@cf/openai/gpt-oss-120b` | 128,000 | **Yes** | — |
| `@cf/openai/gpt-oss-20b` | 128,000 | **Yes** | — |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 32,768 | **Yes** | — |
| `@cf/moonshotai/kimi-k2.5` | 256,000 | **Yes** | — |
| `@cf/moonshotai/kimi-k2.6` | 262,144 | **Yes** | — |
| `@cf/nvidia/nemotron-3-120b-a12b` | 256,000 | **Yes** | — |
| `@cf/zai-org/glm-4.7-flash` | 131,072 | **Yes** | — |
| `@hf/nousresearch/hermes-2-pro-mistral-7b` | 24,000 | — | — |

**Additionally, 4 models support image/vision input:**

| Model | Vision Capability |
|---|---|
| `@cf/meta/llama-3.2-11b-vision-instruct` | Vision + function_calling |
| `@cf/llava-hf/llava-1.5-7b-hf` | Vision (no function_calling) |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Natively multimodal |
| `@cf/google/gemma-3-12b-it` | Image understanding |

**Verdict**: The Workers AI integration is authenticated and functional. However, our code registers only **2 of 13 available function-calling models** and **0 of 4 vision-capable models**. The context window values in our code (`128_000`) are also inaccurate — `granite-4.0-h-micro` and `llama-4-scout-17b` both have 131,000-token context windows. The real gap is not authentication but model catalog breadth and client-facing model selection.

#### Gap 6.2b: No Per-Team/Per-User Model Configuration

**Current state**: The model is determined by hardcoded constants:

```typescript
// workers/agent-core/src/llm/adapters/workers-ai.ts
const WORKERS_AI_PRIMARY_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
const WORKERS_AI_FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
```

There is no API for clients to:
- List available models (`GET /models`)
- Select a model for a session (`model: "claude-3.5-sonnet"` in request body)
- View model capabilities (context window, supported features)
- Configure per-team model preferences

**Reference evidence**:
- **claude-code**: Supports 6+ models with per-request model selection, thinking configuration, and extended output tokens.
- **gemini-cli**: `ModelConfigService` resolves aliases (`auto`, `pro`, `flash`, `flash-lite`) to model IDs with feature flags. `ListModel` endpoint available.
- **codex**: `GET /models?client_version=X` returns `ModelInfo[]` with ETag caching, including `slug`, `context_window`, `supported_reasoning_levels`, `shell_type`, visibility, etc.

#### Gap 6.2c: No Client-Facing LLM Configuration API

Our architecture has no equivalent of any of these reference CLI endpoints:

| Reference CLI | Endpoint | Our Equivalent |
|---|---|---|
| codex | `GET /models` | None |
| gemini-cli | `:listExperiments` | None |
| gemini-cli | `:fetchAdminControls` | None |
| claude-code | Model list in client config | None |
| All 3 | Per-request model selection | None |

A real client needs to know what models it can use and pick one per session or per turn. We don't even have a `GET /models` endpoint. While Workers AI makes 13 function-calling models available to us (including high-quality reasoning models like `@cf/moonshotai/kimi-k2.6` with 262K context and `@cf/openai/gpt-oss-120b` with 128K context), our code exposes none of this to the client.

#### Gap 6.2d: DeepSeek Adapter Is a Throwing Stub

```typescript
// agent-core/src/llm/adapters/deepseek/index.ts
export async function executeDeepSeekSkeleton(_exec: ExecutionRequest): Promise<never> {
  throw new Error("DeepSeek adapter not implemented in zero-to-real first wave...");
}
```

The `ProviderRegistry` is designed for multiple providers, but only one (`workers-ai`) is registered at deploy time. The `LLMExecutor` supports OpenAI-compatible HTTP adapters, but the `CompositionFactory` only creates a provider fetcher when `profile.provider === "remote"`, which requires `FAKE_PROVIDER_WORKER` to be bound and the composition profile to explicitly set `provider: "remote"`.

#### Gap 6.2e: No Prompt Caching, Thinking, or Structured Output

All 3 reference CLIs leverage provider-specific features:

| Feature | claude-code | gemini-cli | codex |
|---|---|---|---|
| Prompt caching | `cache_control: {type: "ephemeral"}` with TTL | `cachedContent` parameter | `prompt_cache_key` |
| Thinking/reasoning | `thinking: {type: "enabled", budget_tokens}` | `thinkingConfig: {thinkingBudget}` | `reasoning: {effort: "medium", summary: "auto"}` |
| Structured output | `output_config.format` | `responseMimeType: "application/json"` | `text.format: {type: "json_schema"}` |

Our `CanonicalLLMRequest` does not support any of these. The Workers AI adapter sends `{messages, stream: true, temperature, tools}` — no caching, thinking, or structured output parameters. The `ModelCapabilities` type does have `supportsJsonSchema` (set to `false` for both models), but there is no code path that uses it to configure structured output.

**However**: Workers AI now offers multiple reasoning-capable models (`@cf/moonshotai/kimi-k2.5`, `@cf/moonshotai/kimi-k2.6`, `@cf/openai/gpt-oss-120b`, `@cf/openai/gpt-oss-20b`, `@cf/qwen/qwen3-30b-a3b-fp8`, `@cf/google/gemma-4-26b-a4b-it`, `@cf/nvidia/nemotron-3-120b-a12b`, `@cf/zai-org/glm-4.7-flash`) with `reasoning: true`. Our codebase does not expose these reasoning models, nor does it implement the `thinking/reasoning` configuration parameters needed to use them. This is a significant missed opportunity — our own platform offers reasoning models that our client cannot access.

#### Gap 6.2f: Hardcoded System Prompt

```typescript
// agent-core/src/host/runtime-mainline.ts:104-107
const NANO_AGENT_SYSTEM_PROMPT = 
  "You are nano-agent running inside Cloudflare Workers, not a Linux VM. Use the provided tools as a governed fake-bash capability layer; do not assume POSIX shell, local OS access, or unsupported commands. Prefer structured tool calls for filesystem, search, network, TypeScript execution, and git tasks, and surface unsupported capability needs explicitly.";
```

All 3 reference CLIs compose system prompts dynamically from multiple sources:
- **claude-code**: Attribution header + CLI prefix + custom instructions + memory + append
- **gemini-cli**: Core mandates + sub-agents + skills + operational guidelines + sandbox info + git context
- **codex**: Base instructions + permissions + sandbox mode + approval policy + writable roots

Our system prompt is a static string injected before the first turn, with no user customization, no skill injection, no workspace context, no memory.

---

## 7. Other Blind Spots, Fractures, and Logical Errors

### 7.1 WebSocket Protocol Deficits

#### Gap 7.1a: No `meta(opened)` Frame on Connection

All 3 reference CLIs have connection establishment acknowledgments:
- **claude-code**: `connectResponseSchema: {session_id, ws_url, work_dir?}`
- **gemini-cli**: Chat compression handshake with preserved history
- **codex**: `thread/started` + `account/updated` notifications

Our WS connection does not send any opening frame. The client connects and receives nothing until a `session.heartbeat` (15 seconds later) or a `session.stream.event`.

#### Gap 7.1b: No Bidirectional Communication

Our WS protocol is effectively half-duplex. Client-to-server messages (`session.resume`, `session.heartbeat`, `session.stream.ack`) are received but **not processed** — they only "touch session liveness." The server does not:
- Parse `session.stream.ack` to update relay cursor
- Parse `session.resume` body to trigger replay
- Parse `session.permission.decision` to unblock a waiting turn (there is no waiting turn mechanism)
- Send `session.permission.request` to ask client for approval
- Send `session.usage.update` to push usage information
- Send `session.elicitation.request` to ask client for input

The function `emitServerFrame()` on `NanoOrchestratorUserDO` is **defined but never called** from any runtime code path.

**Evidence**: `user-do.ts` — the `emitServerFrame()` method exists but is never invoked. All WS frames are relayed from agent-core via the `handleStreamRelay` path, which only handles `(kind: "event")`. The permission, usage, and elicitation frame types defined in `@haimang/nacp-session` have no producer.

#### Gap 7.1c: No Conversation Listing for Clients

`GET /me/conversations` is listed as "尚未实现" in our README. The `GET /me/sessions` endpoint returns session-level items from the User DO hot index (max 200, no pagination), but:

- There is no conversation-level grouping API
- There is no `title` field on sessions (only `nano_conversations` has a `title` column in DDL, but it's never populated)
- There is no archive/delete/mark-read functionality
- `next_cursor` is always `null`

**Reference evidence**:
- **claude-code**: Session persistence in `~/.claude/projects/.../sessions/` with full transcript history
- **gemini-cli**: JSONL session files with `ConversationRecord` including `summary`, `memoryScratchpad`
- **codex**: `thread/list`, `thread/read`, `thread/archive/unarchive/unsubscribe`

#### Gap 7.1d: Response Envelope Inconsistency

Our session HTTP routes return two different success shapes:
- Auth/catalog/usage routes: `{ok: true, data: {...}, trace_uuid}`
- Session action routes: `{ok: true, action: "...", ..., trace_uuid}` (flattened, no `data` wrapper)

This was explicitly documented as a "historical inconsistency." A real client must track which routes return which shape and parse accordingly. This increases client complexity and is a bug magnet.

### 7.2 Agent Loop Structural Gaps

#### Gap 7.2a: Four P2-Stub Subsystem Handles

The `SubsystemHandles` in agent-core composition.ts:

```typescript
kernel: { phase: "P2-stub", reason: "kernel runner replaced by inline turn logic" }
llm: { phase: "P2-stub", reason: "llm executor not yet wired as composition handle" }
hooks: { phase: "P2-stub", reason: "hook dispatcher not yet implemented" }
storage: { phase: "P2-stub", reason: "storage handle uses host-local D1 directly" }
```

Only `capability` (bash-core), `workspace` (filesystem-core), and `eval` (context-core) are "live." The kernel, LLM executor, hooks, and storage are all stubs — meaning the agent loop does not have a pluggable LLM execution layer, hook system for pre/post processing, or storage abstraction.

This has concrete consequences:
- The kernel runner is inline monolithic code, not a pluggable scheduler
- The LLM call is hardcoded Workers AI (no ability to swap providers)
- There is no hook system for before/after turn processing
- Storage is direct D1 access in the User DO

#### Gap 7.2b: Tool Calls Are Opaque to the Client

When the model returns a tool call, the client receives:

```json
{"kind": "llm.delta", "content_type": "tool_use_start", "content": "{\"id\":\"...\",\"name\":\"ls\",\"arguments\":\"{}\"}", "is_final": false}
```

This is a single event with the complete tool call serialized as a JSON string in the `content` field. The reference CLIs stream tool calls incrementally:
- **claude-code**: `content_block_start` → `content_block_delta` (with `input_json_delta`) → `content_block_stop`
- **codex**: `response.output_item.added` → incremental deltas → `response.output_item.done`

Our approach means a client cannot render a "tool is executing..." state or stream arguments as they arrive. The tool call appears atomically.

#### Gap 7.2c: No Tool Result Streaming Back to Client

When a tool executes (e.g., `ls`), its result is injected back into the agent loop as an assistant message, and the next LLM response streams to the client. But the client never sees the tool result as a distinct event. All 3 reference CLIs show tool results:
- **claude-code**: `tool_use` content block followed by `tool_result`
- **gemini-cli**: `functionResponse` in content parts
- **codex**: `LocalShellCall` → `LocalShellCallOutput` as distinct items

Our tool results are silently consumed within the DO. The client only sees the next `llm.delta` (the model's next response after processing the tool result).

### 7.3 Missing Client-Side Configuration Surfaces

#### Gap 7.3a: No Session / Conversation Metadata API

There is no way for a client to:
- Set a conversation title
- Archive a conversation
- Delete a conversation
- Add tags or metadata to a conversation
- Search conversation history (no FTS index on `nano_conversation_messages`)

#### Gap 7.3b: No Device/Session Management

`POST /me/devices/revoke` is listed as "尚未实现." A client cannot:
- List its connected sessions
- Revoke a specific session's access
- Force-disconnect a WebSocket connection from another device

#### Gap 7.3c: No Rate Limiting Headers or Information

Reference CLIs expose rate limits:
- **codex**: `x-codex-credits-has-credits`, `x-codex-credits-balance`, `x-codex-active-limit` headers
- **gemini-cli**: `:retrieveUserQuota` endpoint
- **claude-code**: `/api/oauth/usage` endpoint

Our `/sessions/{uuid}/usage` returns all-null values. There are no response headers indicating remaining quota.

### 7.4 Catalog Empty Shell

All three catalog endpoints return hard-coded empty arrays:

```typescript
// orchestrator-core/src/index.ts — handleCatalog()
case "skills": return facadeOk(req, { skills: [] });
case "commands": return facadeOk(req, { commands: [] });
case "agents": return facadeOk(req, { agents: [] });
```

No DDL table, no code, no configuration exists for populating these. A client cannot discover what capabilities are available.

---

## 8. Gap Priority Matrix

The following matrix ranks every gap by its impact on getting a real client to work end-to-end:

| # | Gap | Domain | Severity | First-Wave? |
|---|-----|--------|----------|-------------|
| 1 | `POST /sessions/{id}/messages` — structured message input | Context/Lifecycle | **Critical** | Yes |
| 2 | WebSocket `emitServerFrame()` never called — no bidirectional communication | WS Protocol | **Critical** | Yes |
| 3 | No context window inspection API for clients | Context | **Critical** | Yes |
| 4 | `verifyApiKey` is a permanent stub — no API key auth | Auth | **Critical** | Yes |
| 5 | DDL `session_status` missing `pending`/`expired` — can't persist session creation | DDL | **High** | Yes |
| 6 | `nano_quota_balances`/`nano_usage_events` zero write paths — no billing | Usage | **High** | Yes |
| 7 | Tool call streaming is atomic — no incremental `input_json_delta` | WS Protocol | **High** | Yes |
| 8 | No tool result visibility to client | Agent Loop | **High** | Yes |
| 9 | No `GET /models` or model selection API | LLM Config | **High** | Yes |
| 10 | No `GET /sessions/{id}/files` file API | Filesystem | **High** | Yes |
| 11 | No `GET /me/conversations` conversation listing | Lifecycle | **High** | Yes |
| 12 | Hardcoded system prompt — no user customization | LLM Config | **Medium** | Yes |
| 13 | Compaction not wired — sessions will hit context limit and break | Context | **Medium** | Yes |
| 14 | `nano_team_api_keys` zero read/write — no API key lifecycle | Auth | **Medium** | Yes |
| 15 | No per-team/per-user model configuration | LLM Config | **Medium** | Yes |
| 16 | Only 2 of 13 available Workers AI models registered; 0 vision models; context window values wrong (128K→131K) | LLM Config | **Medium** | Yes |
| 17 | 8 reasoning-capable Workers AI models available but not exposed to clients | LLM Config | **Medium** | Yes |
| 17 | No logout/token revocation endpoint | Auth | **Medium** | No |
| 18 | No user profile CRUD | Auth | **Medium** | No |
| 19 | No third-party OAuth (only email+password and WeChat) | Auth | **Medium** | No |
| 20 | Permission flow disconnected — HTTP writes but runtime ignores | Bash/Auth | **Medium** | Yes |
| 21 | Response envelope split (legacy vs facade) increases client complexity | API Surface | **Low** | Yes |
| 22 | No sandbox enforcement for bash execution | Bash | **Low** | No |
| 23 | No streaming progress for long-running commands | Bash | **Low** | No |
| 24 | No conversation title/metadata/archive/delete API | Lifecycle | **Low** | No |
| 25 | Catalog endpoints return empty arrays | Catalog | **Low** | Yes |
| 26 | No rate limiting headers or usage information | Usage | **Low** | Yes |
| 27 | DeepSeek adapter is a throwing stub | LLM Config | **Low** | No |
| 28 | `listDir` uses `new Date().toISOString()` for all mtimes | Filesystem | **Low** | No |
| 29 | No prompt caching, thinking, or structured output | LLM Config | **Low** | No |
| 30 | No `meta(opened)` WS frame on connection | WS Protocol | **Low** | Yes |

---

## 9. First-Wave Minimum Viable API Surface

Based on the gap analysis above, for a real client to function end-to-end (even minimally), these are the non-negotiable first-wave requirements:

### 9.1 Must-Have (Hard Blockers)

1. **DDL Migration**: Add `'pending'` and `'expired'` to `session_status` CHECK constraint. Wire `POST /me/sessions` to write pending records to D1.

2. **Unicode Message Input**: `POST /sessions/{id}/messages` — accept structured message bodies (not just `text`):
   ```json
   {
     "role": "user",
     "parts": [
       { "type": "text", "text": "analyze this" },
       { "type": "image_url", "url": "data:image/png;base64,..." }
     ]
   }
   ```
   This is the single most important missing endpoint. Without it, the client cannot send multi-modal, multi-part, or structured tool results.

3. **WebSocket Bidirectional Communication**: Wire `emitServerFrame()` to produce:
   - `meta(opened)` on connection establishment
   - `session.permission.request` when tool execution needs approval
   - `session.usage.update` when token counts change
   - `tool.result` when a capability call completes
   Consume client messages:
   - `session.permission.decision` — unblock waiting turns
   - `session.stream.ack` — update relay cursor

4. **API Key Auth**: Implement `verifyApiKey` with D1 read from `nano_team_api_keys`. Add `POST /auth/api-keys` to create keys and `DELETE /auth/api-keys/{id}` to revoke them.

5. **Usage Accounting**: Wire `QuotaAuthorizer` to actually write to `nano_usage_events` and update `nano_quota_balances`. Expose real values in `/sessions/{uuid}/usage`.

6. **Context Window Inspection**: Add `GET /sessions/{id}/context/usage` and `GET /sessions/{id}/context/layers` to the public facade (currently only in InspectorFacade behind env var).

### 9.2 Should-Have (High Impact)

7. **Model Listing API**: `GET /models` — return available models with capabilities, context windows, and pricing. Workers AI makes 13 function-calling models and 4 vision-capable models available; we should expose all of them.

8. **Per-Session Model Selection**: Allow `model` field in `POST /sessions/{id}/start` and `POST /sessions/{id}/input` to override default model. At minimum, offer the 3 tiers: `granite-4.0-h-micro` (default/fast), `llama-4-scout-17b` (balanced), `kimi-k2.6` / `gpt-oss-120b` (reasoning/heavy).

9. **Reasoning Model Support**: Wire the 8 Workers AI models with `reasoning: true` (kimi-k2.5, kimi-k2.6, gpt-oss-120b, gpt-oss-20b, qwen3-30b, gemma-4-26b, nemotron-3-120b, glm-4.7-flash) through the `ModelRegistry` and expose thinking/reasoning configuration to clients.

10. **Conversation Listing**: `GET /me/conversations` — with title (auto-generated from first turn), pagination, and archive status.

10. **Tool Result Visibility**: Emit `tool.call.progress`, `tool.call.result` event kinds through WS so clients can display tool execution state.

11. **Incremental Tool Call Streaming**: Break `tool_use_start` into incremental deltas (function name first, then arguments as they arrive) rather than a single atomic event.

12. **Permission Flow Wiring**: Connect the HTTP permission decision endpoint to the agent loop's capability execution gate — so `ask` policy decisions actually pause execution and resume on client approval via WS.

13. **Vision Model Registration**: Register `@cf/meta/llama-3.2-11b-vision-instruct` (vision + function_calling, 24K context) to enable image input. Wire `ModelCapabilities.supportsVision = true` and update `buildExecutionRequest()` validation to allow `image_url` content parts for vision-capable models.

### 9.3 Nice-to-Have (Incremental Value)

13. Dynamic system prompt composition from user preferences + workspace context
14. Conversation title generation (LLM-based from first turn)
15. User profile CRUD (`PATCH /me/profile`)
16. Logout/token revocation (`POST /auth/logout`)
17. Multi-provider LLM routing (per-team config)
18. Prompt caching headers for context efficiency
19. Streaming progress for long-running bash commands
20. File upload pipeline (3-step: create → upload → finalize)

---

## 10. Workers AI Availability Supplement

> Verified 2026-04-28 via `npx wrangler whoami` + `npx wrangler ai models --json`

**Account**: `sean.z@haimangtech.cn` (ID: `8b611460403095bdb99b6e3448d1f363`)  
**Permissions**: Full (`ai (write)`, `d1 (write)`, `workers (write)`, `workers_kv (write)`, etc.)

### Available Workers AI Function-Calling Models (13)

| Model | Context | Reasoning | Vision | Price (in/out per Mtok) |
|---|---|---|---|---|
| `@cf/ibm-granite/granite-4.0-h-micro` | 131K | No | No | $0.017 / $0.11 |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 131K | No | **Multimodal** | $0.27 / $0.85 |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 24K | No | No | — |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 128K | No | No | — |
| `@cf/google/gemma-4-26b-a4b-it` | **256K** | **Yes** | No | — |
| `@cf/openai/gpt-oss-120b` | 128K | **Yes** | No | — |
| `@cf/openai/gpt-oss-20b` | 128K | **Yes** | No | — |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 32K | **Yes** | No | — |
| `@cf/moonshotai/kimi-k2.5` | **256K** | **Yes** | No | — |
| `@cf/moonshotai/kimi-k2.6` | **262K** | **Yes** | No | — |
| `@cf/nvidia/nemotron-3-120b-a12b` | **256K** | **Yes** | No | — |
| `@cf/zai-org/glm-4.7-flash` | 131K | **Yes** | No | — |
| `@hf/nousresearch/hermes-2-pro-mistral-7b` | 24K | No | No | — |

### Available Workers AI Vision Models (4)

| Model | Context | Function Calling | Note |
|---|---|---|---|
| `@cf/meta/llama-3.2-11b-vision-instruct` | — | **Yes** | Best candidate for vision + tools |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | 131K | **Yes** | Natively multimodal, already our fallback |
| `@cf/llava-hf/llava-1.5-7b-hf` | — | No | Vision only |
| `@cf/google/gemma-3-12b-it` | — | No | Image understanding |

### Implications

1. **Current code hardcodes `contextWindow: 128_000`** for both models, but the actual values are 131,000. This is a minor but real mismatch that could cause premature truncation.

2. **LLama-4-Scout is already natively multimodal** — it can accept image inputs in Workers AI, but our code sets `supportsVision: false` for it. Activating vision for this model requires only a `ModelCapabilities` change, not a different model.

3. **8 reasoning models are available** — kimi-k2.5, kimi-k2.6, gpt-oss-120b, gpt-oss-20b, qwen3-30b, gemma-4-26b, nemotron-3-120b, and glm-4.7-flash all have `reasoning: true`. Our code has no infrastructure for reasoning/thinking configuration parameters.

4. **3 models offer 256K+ context** — kimi-k2.5 (256K), kimi-k2.6 (262K), gemma-4-26b (256K), nemotron-3-120b (256K). This is double our current 131K context, enabling significantly longer conversations.

---

## 11. Architecture Truth Score

| Dimension | Score | Explanation |
|-----------|-------|-------------|
| DDL Thickness | **60%** | Auth and session tables are solid; usage/quota/files/preferences are DDL-only or missing |
| Context Management | **25%** | Assembler/compactor exist but are not wired; InspectorFacade is internal-only; no client inspection API |
| Lifecycle / Agent Loop | **40%** | Kernel runner works for basic turn-by-turn; but compaction, hooks, and context seeding are stubs |
| Filesystem & Multi-Modality | **15% → 18%** | Code exists; Workers AI has 4 vision models (1 with function_calling); but no client API, no upload pipeline, no model registration for vision, mtimes are broken |
| Auth & Multi-Tenancy | **45%** | Basic auth works; API keys are ghost; no logout; no profile update; multi-tenancy labels but no enforcement |
| Bash Execution | **55%** | 21 tools work; but no streaming progress, no permission gate, no sandbox, no real KV/R2 probe |
| LLM Wrapper | **30% → 40%** | Workers AI binding authenticated with full `ai (write)` permission; 13 function-calling + 4 vision models available but only 2 registered; model selection is hardcoded; DeepSeek is stub; no caching/thinking/structured output; 8 reasoning models on platform but not wired |
| Client-Facing API Surface | **30%** | 22 endpoints exist but most are health/status read-only; the critical write paths (messages, files, permissions) are gaps |
| WS Protocol | **20%** | 4 frame types work half-duplex; no bidirectional communication; no permission/usage/elicitation push |
| **Overall** | **~37%** | Structure is solid; authentication is confirmed; Workers AI catalog is rich but under-wired; plumbing is missing |

---

## 11. Conclusion

The gap between our current API surface and what three production CLIs (claude-code, gemini-cli, codex) require is **not incremental — it is structural**. We have built the vertical stack (auth → session → DO → D1) but not the horizontal surfaces (messages, files, models, permissions, usage, conversations) that a client needs to function.

The most critical single gap is **the absence of a real-time, bidirectional message protocol**. Our WS relay streams `llm.delta` and `session.heartbeat` frames one-way, but never pushes permission requests, usage updates, tool results, or elicitation prompts to the client — and never processes client-to-server messages beyond "touch liveness." A real client needs this bidirectional channel to render tool execution states, request approval for dangerous operations, and display context utilization.

The second most critical gap is **the absence of API key auth**. All three reference CLIs authenticate via API keys in headers, not browser-based JWT flows. Our `verifyApiKey` returns `{supported: false}` and the `nano_team_api_keys` table is DDL-only.

The third is **model selection and configuration**. Our LLM wrapper hardcodes 2 Workers AI models with no client-facing choice. A real client must be able to ask "what models can I use?" and pick one.

To move from zero-to-real, we need to prioritize the 6 must-haves in section 9.1, which represent the minimum surface for a client to authenticate, converse, inspect context, and report usage. Everything else is incremental improvement.

---

*End of report.*