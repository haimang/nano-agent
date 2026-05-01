# Nano-Agent API Compliance 调查 — Part 4: Models + Todos + Transport Profiles

> 调查对象: `Models (4 endpoints) + Todos (4 endpoints) + Transport Profiles (spec)`
> 调查类型: `initial`
> 调查者: `deepseek`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/models.md`
> - `clients/api-docs/todos.md`
> - `clients/api-docs/transport-profiles.md`
> Profile / 协议族: `facade-http-v1`
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts` — FacadeEnvelope contract
> - `packages/orchestrator-auth-contract/src/auth-error-codes.ts` — AuthErrorCodeSchema
> - `packages/nacp-core/src/error-registry.ts` — NACP error taxonomy
> - `docs/design/hero-to-pro/HPX-qna.md` Q19 / Q20 / Q27
> - `scripts/check-envelope-drift.mjs` — Root drift gate
> 复用 / 对照的既有审查:
> - `docs/eval/hero-to-pro/api-compliance/part1-by-deepseek.md` — 独立复核
> - `docs/eval/hero-to-pro/api-compliance/part2-by-deepseek.md` — 独立复核
> - `docs/eval/hero-to-pro/api-compliance/part3-by-deepseek.md` — 独立复核
> 文档状态: `reviewed`

---

## 0. 总判定 / Executive Summary

- **整体 verdict**: 本轮 Models + Todos 调查发现 0 项 CRITICAL、3 项 FINDING（error code 非合规）、3 项 WARN（doc-code shape 偏差）、2 项 OBSERVATION。功能实现真实可链路，测试覆盖完整全部 PASS。核心问题集中在 `jsonPolicyError` 的 error code 类型安全缺口和 API 文档与代码之间的字段命名、形状不一致。
- **结论等级**: `partial-compliance`
- **是否允许声明合规**: `no` — 需先修 F-MOD-01、F-MOD-02、F-TOD-01 才能声明 NACP 合规
- **本轮最关键的 1-3 个判断**:
  1. `jsonPolicyError` 的 `error as FacadeErrorCode` 类型断言未做运行期 coercion，导致 `models-d1-unavailable`、`session-expired`、`session_terminal`、`model-unavailable`、`model-disabled`、`invalid-status` 等 6 个未注册 code 泄漏到 wire 上
  2. API 文档与代码之间存在多处字段命名和响应形状不一致（W-MOD-01~03），需同步修正文档或代码
  3. 所有端点 functional route trace 全链路可达，测试覆盖率好，envelope drift gate PASS

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| `models` | 4 | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | PARTIAL |
| `todos` | 4 | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL |
| `transport-profiles` | (spec) | n/a | n/a | ✅ | ✅ | ✅ | ✅ | PASS |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 3 | yes |
| ⚠️ WARN     | 3 | no（建议修） |
| 📝 OBSERVATION | 2 | no（仅记录） |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性（Functionality） | 路由→实现是否真实成链？文档声明的能力是否真的存在？ | route → handler → backing repo / RPC 全链路可达，行为符合 doc |
| **F2** | 测试覆盖（Test Coverage） | 是否有测试在这条路径上跑过？覆盖了 happy path 与关键错误路径？ | 单测 + 集成 +（必要时）E2E / live 任一层有断言 |
| **F3** | 形态合规（Shape Compliance） | 请求/响应/错误形态、auth gate、status code 是否与 doc 与契约对齐？ | request/response 满足 schema；auth 行为与 doc 同；status code 同 |
| **F4** | NACP 协议合规（NACP Compliance） | envelope、authority、trace、tenant boundary、error code 是否符合 NACP profile？ | 信封正族；trace 贯通；authority 翻译合法；tenant 边界全守住；error code 全部在 FacadeErrorCodeSchema 内 |
| **F5** | 文档真相一致性（Doc-Reality Parity） | 文档说的与代码做的是否一致？ | 没有 doc 写了能力但代码没做、或代码做了 doc 没写 |
| **F6** | SSoT 漂移（SSoT Drift） | 是否触发了 drift gate？是否与 frozen contract / 契约表 / Q-law 一致？ | drift gate 全绿；与契约 / Q-law 无背离 |

### 1.2 严重级别定义

| 级别 | 标记 | 定义 | 处置 |
|------|------|------|------|
| **CRITICAL** | 🔴 | 破坏正确性、安全、契约或会让现有客户端解析失败 | **必须修复**才能声明合规 |
| **FINDING** | ❌ | 行为偏离，影响协议合规 / 客户端兼容 / 多租隔离 | **应修复**；如延后，须明确条件与 owner |
| **WARN** | ⚠️ | 轻微偏差、文档不准、测试缺口、代码异味 | 建议修复；不阻塞合规声明 |
| **OBSERVATION** | 📝 | 已知未实现、设计选择、未来工作 | 仅记录，不要求行动 |

### 1.3 已核实的事实

- **对照的 API 文档**:
  - `clients/api-docs/models.md`（4 端点 + state machine）
  - `clients/api-docs/todos.md`（4 端点 + route matrix）
  - `clients/api-docs/transport-profiles.md`（6 种 profile + envelope law + trace rule）
- **核查的实现**:
  - `workers/orchestrator-core/src/index.ts:704-711` — model route dispatching
  - `workers/orchestrator-core/src/index.ts:751-754` — todo route dispatching
  - `workers/orchestrator-core/src/index.ts:1076-1106` — parseModelDetailRoute / parseSessionModelRoute
  - `workers/orchestrator-core/src/index.ts:1108-1133` — parseSessionTodoRoute
  - `workers/orchestrator-core/src/index.ts:1660-1902` — handleSessionTodos (full CRUD)
  - `workers/orchestrator-core/src/index.ts:2224-2451` — resolveTeamModelOrResponse, handleModelsList, handleModelDetail, handleSessionModel
  - `workers/orchestrator-core/src/session-truth.ts:411-589` — listActiveModelsForTeam, resolveModelForTeam, readSessionModelState, updateSessionModelDefaults
  - `workers/orchestrator-core/src/session-lifecycle.ts:98-220` — parseModelOptions, parseSessionModelPatchBody, normalizeReasoningOptions
  - `workers/orchestrator-core/src/todo-control-plane.ts:1-295` — D1TodoControlPlane (full CRUD + at-most-1 invariant)
  - `workers/orchestrator-core/src/auth.ts:1-329` — authenticateRequest (Bearer + JWT + device gate)
  - `workers/orchestrator-core/src/policy/authority.ts:1-59` — jsonPolicyError, readTraceUuid, ensureConfiguredTeam
- **核查的契约 / SSoT**:
  - `packages/orchestrator-auth-contract/src/facade-http.ts` — FacadeEnvelope, FacadeErrorCodeSchema (38 codes), compile-time guards
  - `packages/orchestrator-auth-contract/src/auth-error-codes.ts` — AuthErrorCodeSchema (13 codes)
  - `packages/nacp-core/src/error-registry.ts` — NACP error taxonomy, unified ErrorMeta registry
  - `packages/nacp-core/src/rpc.ts` — RpcErrorCodeSchema (30 codes), Envelope<T>
- **执行过的验证**:
  - `node scripts/check-envelope-drift.mjs` — **PASS**（1 file clean）
  - `pnpm --filter "@haimang/orchestrator-core-worker" test -- --run` — **全部 34 files / 314 tests PASS**
- **核对过的测试实现**:
  - `workers/orchestrator-core/test/models-route.test.ts`（7 cases, 350 lines）
  - `workers/orchestrator-core/test/session-model-route.test.ts`（4 cases, 326 lines）
  - `workers/orchestrator-core/test/todo-route.test.ts`（7 cases, 290 lines）
  - `workers/orchestrator-core/test/todo-control-plane.test.ts`（11 cases, 244 lines）
  - `workers/orchestrator-core/test/migrations-schema-freeze.test.ts`（model + todo schema assertions）
  - `test/cross-e2e/15-hp2-model-switch.test.mjs`（2 live tests, skipped unless env var set）
  - `test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs`（1 live test）
  - `packages/nacp-session/test/hp6-todo-messages.test.ts`（5 describe blocks, frame schema validation）

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 完整链路追踪，所有 handler/repo/parser 均以 `file:line` 引用 |
| 单元 / 集成测试运行 | yes | 314 tests PASS（含 models-route, session-model-route, todo-route, todo-control-plane） |
| Drift gate 脚本运行 | yes | `check-envelope-drift.mjs` PASS — 1 file clean |
| schema / contract 反向校验 | yes | 逐码对比 FacadeErrorCodeSchema 与 wire 实际输出的 code |
| live / preview / deploy 证据 | no | 无需 live 环境（router 级测试使用 in-memory D1 mock） |
| 与上游 design / Q-law 对账 | yes | Q19 (at-most-1 in_progress), Q20 (5-status enum), Q27 (FacadeEnvelope) 全部冻结准入 |

### 1.5 跨簇横切观察

- **架构与路由层**: 所有 endpoint 都经 `orchestrator-core/src/index.ts` 的 `dispatchFetch()` 分发（line 635），model 路由排在 session 路由之前（line 704-711 vs 751-754），todo 路由在 session 路由之后。model 路由优先级正确（detail route `/models/{id}` 先于 list route `/models`）。
- **Envelope 契约**: 所有 8 个端点均使用 `facade-http-v1` 的 `{ ok: true, data, trace_uuid }` / `{ ok: false, error: { code, status, message }, trace_uuid }`。304 响应不遵循此 shape（无 body），符合 HTTP 语义。Drift gate 确认无 `AuthEnvelope` 泄漏、无缺失 `trace_uuid` 的 `Response.json(...)`。
- **Auth 模式**: 全部 8 个端点调用 `authenticateRequest()`（`auth.ts:221-327`）作为第一步。Auth 已验证: Bearer token → JWT/API Key 双路径 → team_uuid claim → device_uuid + device status gate → 返回 AuthContext。Session-scoped 端点（model/todos）额外校验 team ownership + actor_user_uuid。
- **Trace 传播**: `x-trace-uuid` header 在所有 handler 中强制要求（auth gate `auth.ts:233-239` 若缺失返回 `400 invalid-trace`）。Response 同时返回 `x-trace-uuid` header 和 body 内 `trace_uuid` 字段。
- **NACP authority 翻译**: JWT claim → `IngressAuthSnapshot`（含 `team_uuid`, `tenant_uuid`, `user_uuid`, `device_uuid` 等）。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| `models` | `GET /models` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-MOD-01: `models-d1-unavailable` 不在 schema |
| `models` | `GET /models/{id}` | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ | PARTIAL | F-MOD-02 + W-MOD-01 |
| `models` | `GET /sessions/{id}/model` | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ | PARTIAL | F-MOD-02 + W-MOD-02 |
| `models` | `PATCH /sessions/{id}/model` | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | PARTIAL | F-MOD-02 + W-MOD-03 |
| `todos` | `GET /sessions/{id}/todos` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |
| `todos` | `POST /sessions/{id}/todos` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |
| `todos` | `PATCH /sessions/{id}/todos/{uuid}` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |
| `todos` | `DELETE /sessions/{id}/todos/{uuid}` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |

> F4/F6 ❌ 对 models 簇指向 F-MOD-01 / F-MOD-02，对 todos 簇指向 F-TOD-01（同根因：`jsonPolicyError` 的 error code 类型安全缺口）

---

## 3. 簇级深度分析

### 3.1 簇 — `models`（`clients/api-docs/models.md`）

#### 3.1.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core dispatchFetch()              index.ts:635
  → parseModelDetailRoute() / direct pathname match index.ts:704-711
  → authenticateRequest()                          auth.ts:221-327
    → parseBearerToken()                           auth.ts:78-88
    → JWT verify + device gate                     auth.ts:245-291
  → resolveTeamModelOrResponse()                   index.ts:2224-2254
    → repo.resolveModelForTeam()                   session-truth.ts:444-494
      → D1: nano_model_aliases (alias lookup)
      → D1: nano_models WHERE model_id=?
      → D1: nano_team_model_policy (deny check)
    → fallback: direct alias + policy check        index.ts:2236-2253
  → handleModelsList / handleModelDetail / handleSessionModel
    → D1: nano_models + nano_team_model_policy + nano_model_aliases
    → D1: nano_conversation_sessions + nano_conversation_turns
  → Response.json({ ok, data, trace_uuid })
    + headers: { x-trace-uuid, etag, cache-control }
```

**链路注记**: 路由优先级正确 — `parseModelDetailRoute`（`/models/{id}`，line 704）先于 exact match `/models`（line 709），避免 detail 被 list 误吞。session model routes 通过 `parseSessionModelRoute` 统一分配 GET/PATCH action（line 773-775）。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /models` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-MOD-01 |
| `GET /models/{modelIdOrAlias}` | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ | PARTIAL | F-MOD-02, W-MOD-01 |
| `GET /sessions/{id}/model` | ✅ | ✅ | ✅ | ❌ | ⚠️ | ❌ | PARTIAL | F-MOD-02, W-MOD-02 |
| `PATCH /sessions/{id}/model` | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | PARTIAL | F-MOD-02, W-MOD-03 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `GET /models`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:709-711` (exact `GET /models`) → `handleModelsList` (`index.ts:2256`) → `D1SessionTruthRepository.listActiveModelsForTeam` (`session-truth.ts:411-442`): 并行查询 `nano_models WHERE status='active'` + `nano_team_model_policy`，deny set 过滤 + alias map 加载。ETag SHA-256 (`index.ts:2214,2276`)。304 no body (`index.ts:2278-2286`)。 |
| **F2 测试覆盖** | ✅ | 6 cases in `models-route.test.ts`: L121 (401 missing bearer), L137 (200 happy + capabilities + ETag), L172 (304 ETag match), L209 (team policy filter excludes denied model), L241 (503 D1 fail graceful). All PASS. |
| **F3 形态合规** | ✅ | auth: `Authorization: Bearer <jwt>` (`index.ts:2260`)。request: `If-None-Match` optional (`index.ts:2277`)。response: `{ ok, data: { models }, trace_uuid }` + `x-trace-uuid`, `etag`, `cache-control: private, max-age=60` headers (`index.ts:2287-2297`)。200/304/401/503 status codes 与 doc 一致。 |
| **F4 NACP 合规** | ❌ | **F-MOD-01**: `index.ts:2303` 使用 `jsonPolicyError(503, "models-d1-unavailable", ...)` 但 `"models-d1-unavailable"` 不在 `FacadeErrorCodeSchema`（`facade-http.ts:48-91`）中。`jsonPolicyError` 的 `error as FacadeErrorCode`（`authority.ts:32`）是类型断言，非运行期 coercion（尽管注释声称会 coercion，`authority.ts:28-30`）。详见 §5.2。 |
| **F5 文档一致性** | ✅ | doc (`models.md:34-86`) catalog list、ETag/304、error table 与 code 完全匹配。 |
| **F6 SSoT 漂移** | ❌ | 同 F-MOD-01。Drift gate (`check-envelope-drift.mjs`) 仅检查 `trace_uuid` 和 `AuthEnvelope` 泄漏，不检查 error code schema 合入。 |

**关联 finding**: `F-MOD-01`

##### 3.1.2.2 `GET /models/{modelIdOrAlias}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:704-707` → `parseModelDetailRoute` (`index.ts:1078`, regex `/^\/models\/(.+)$/`, URL decode, GET only) → `handleModelDetail` (`index.ts:2307`)。Alias resolution: `resolveModelForTeam` (`session-truth.ts:444-494`) → `nano_model_aliases → nano_models → nano_team_model_policy`。Fallback: repo 返回 null 时手工查 alias + policy (`index.ts:2236-2253`)。 |
| **F2 测试覆盖** | ✅ | 2 cases in `models-route.test.ts`: L266 (alias → `requested_model_id`/`resolved_model_id`/`resolved_from_alias`/`aliases`/`input_modalities`), L301 (capability backfill: `supported_reasoning_levels`、`input_modalities`)。All PASS. |
| **F3 形态合规** | ✅ | auth 统一。status codes: 200/400/403/404 与 doc 一致。`modelIdOrAlias` URL-encoded canonical id 和 alias 两种路径均正确解析。 |
| **F4 NACP 合规** | ❌ | **F-MOD-02**: `resolveTeamModelOrResponse` (`index.ts:2251,2253`) 使用 `jsonPolicyError(403, "model-disabled", ...)` 和 `jsonPolicyError(400, "model-unavailable", ...)`。两个 code 都不在 `FacadeErrorCodeSchema` 中。同根因 F-MOD-01。 |
| **F5 文档一致性** | ⚠️ | **W-MOD-01**: doc (`models.md:98-117`) 显示 response 为扁平 model detail（`data.{model_id, family, display_name, ...}`），但 code (`index.ts:2332-2344`) 返回嵌套 `data.{requested_model_id, resolved_model_id, resolved_from_alias, model: {...}}`。Doc 缺少路由元数据字段且形状为扁平而非嵌套。 |
| **F6 SSoT 漂移** | ❌ | 同 F-MOD-02。 |

**关联 finding**: `F-MOD-02`, `W-MOD-01`

##### 3.1.2.3 `GET /sessions/{id}/model`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:773-775` → `parseSessionModelRoute` (`index.ts:1096`) → `handleSessionModel` (`index.ts:2347`) GET path (`index.ts:2380-2385`)。读取 session lifecycle + model state + latest turn audit via `readSessionModelState` (`session-truth.ts:559-589`)。返回 `effective_default_model_id` 及 `source: "session" | "global"`。 |
| **F2 测试覆盖** | ✅ | 1 case in `session-model-route.test.ts`: L177 (200 — returns `source`, `effective_default_model_id`, `last_turn.effective_model_id`)。All PASS。 |
| **F3 形态合规** | ✅ | auth + team/user ownership gate (`index.ts:2368-2373`)。Status codes: 200/404/409。Response envelope 正确（`index.ts:2381-2384`）。 |
| **F4 NACP 合规** | ❌ | 同 F-MOD-02（handler 内 PATCH 分支使用同组 non-schema codes）。另 `index.ts:2387-2390` 使用 `jsonPolicyError(409, "session-expired", ...)` 和 `jsonPolicyError(409, "session_terminal", ...)`，二者都不在 `FacadeErrorCodeSchema` 中。 |
| **F5 文档一致性** | ⚠️ | **W-MOD-02**: doc (`models.md:137-151`) 使用 `global_default_model_id`（code: `effective_default_model_id`）、`effective_default_source`（code: `source`）。Doc 显示嵌套 `model` 对象但 code 返回 session state 本身（不包含嵌套 model）。 |
| **F6 SSoT 漂移** | ❌ | 同 F-MOD-02。 |

**关联 finding**: `F-MOD-02`, `W-MOD-02`

##### 3.1.2.4 `PATCH /sessions/{id}/model`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: 同上 → `handleSessionModel` (`index.ts:2347`) PATCH path (`index.ts:2386-2450`)。Body parse via `parseSessionModelPatchBody` (`session-lifecycle.ts:145-203`)。Model resolve: `resolveTeamModelOrResponse`。Reasoning normalize: `normalizeReasoningOptions` (`session-lifecycle.ts:205-220`)。Write: `updateSessionModelDefaults` (`session-truth.ts:507-522`)。Clear via `model_id: null`。Lifecycle guards: expired → 409, ended → 409 (`index.ts:2386-2391`)。 |
| **F2 测试覆盖** | ✅ | 3 cases in `session-model-route.test.ts`: L223 (alias resolve → `default_model_id` + reasoning effort normalized "high"→"medium"), L265 (clear with `model_id: null` → `source: "global"`), L299 (reject ended session → 409)。All PASS。 |
| **F3 形态合规** | ⚠️ | **W-MOD-03**: doc (`models.md:171-176`) 声明 body 为 flat `model_id` + `reasoning_effort: "high"`，但 code 解析 `model_id`（string/null）和嵌套 `reasoning: { effort }`（object）（`session-lifecycle.ts:145-203`）。Doc 标记 `model_id` 必填（✅）但 code 允许仅有 `reasoning` 的 PATCH（当 session 已有 default model 时，`index.ts:2397-2404`）。另 doc §6（`models.md:217-222`）正确地描述了嵌套 `reasoning` 形状用于 `start`/`input`/`messages`，但 PATCH body 示例使用了矛盾的 flat 形状。 |
| **F4 NACP 合规** | ❌ | 同 F-MOD-02。 |
| **F5 文档一致性** | ⚠️ | 同上 W-MOD-03。Doc response (`models.md:191-201`) 显示嵌套 `model` 对象但 code 返回 `data: nextState`（完整 session model state, 含 `source`、`last_turn` 等）。 |
| **F6 SSoT 漂移** | ❌ | 同 F-MOD-02。 |

**关联 finding**: `F-MOD-02`, `W-MOD-03`

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | 所有 4 端点 success: `{ ok:true, data, trace_uuid }`；error: `{ ok:false, error:{code,status,message}, trace_uuid }`。304 无 body 符合 HTTP。 |
| `x-trace-uuid` 在 response 头里 | ✅ | 每个 handler `Response.json` 调用均带 `headers: { "x-trace-uuid": traceUuid }` (`index.ts:2287-2293,2343,2384,2449`)。 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | **F-MOD-01/F-MOD-02**: `models-d1-unavailable`, `model-disabled`, `model-unavailable`, `session-expired`, `session_terminal` 不在 schema 中。 |
| Tenant 边界 5 规则被守住 | ✅ | `authenticateRequest` 强制 `team_uuid`/`tenant_uuid` claim（`auth.ts:260-268`）。Session 端点额外校验 `session.team_uuid === auth.team_uuid`（`index.ts:2368-2373`）。 |
| Authority 翻译合法 | ✅ | JWT claim → `IngressAuthSnapshot`（`auth.ts:298-326`），含完整 tenant/user/device claims。 |

---

### 3.2 簇 — `todos`（`clients/api-docs/todos.md`）

#### 3.2.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core dispatchFetch()              index.ts:635
  → parseSessionTodoRoute()                        index.ts:751-754
    → regex /^\/sessions\/([^/]+)\/todos$/         index.ts:1118  (list/create)
    → regex /^\/sessions\/([^/]+)\/todos\/([^/]+)$/ index.ts:1124 (patch/delete)
    → UUID_RE validation on both UUID segments
  → authenticateRequest()                          auth.ts:221-327
  → session lifecycle gate:                        index.ts:1698-1715
    → repo.readSessionLifecycle()                  session-truth.ts:781-819
    → ownership check: team_uuid + actor_user_uuid
    → deleted_at guard: 409 conversation-deleted
  → D1TodoControlPlane                             todo-control-plane.ts:83-294
    → list / create / patch / delete
    → at-most-1 in_progress invariant:
      → readActiveInProgress()                     todo-control-plane.ts:138-152
      → CREATE: status==in_progress → check        todo-control-plane.ts:170-178
      → PATCH: transitioning to in_progress
        && existing!=in_progress → check           todo-control-plane.ts:233-244
    → D1: nano_session_todos table
    → TodoConstraintError → todoConstraintToResponse → jsonPolicyError
  → Response.json({ ok, data, trace_uuid })
    + headers: { x-trace-uuid }
```

**链路注记**: `parseSessionTodoRoute` 先匹配 `/todos$`（list/create），再匹配 `/todos/{uuid}$`（patch/delete），两个 UUID segment 都经过 `UUID_RE` 校验。Session lifecycle gate（`readSessionLifecycle`）在所有 CRUD 前统一校验 ownership。At-most-1 `in_progress` 在 application 层双路径 enforce（D1 无 session-scoped partial UNIQUE 支持，`todo-control-plane.ts:12-15` 设计说明）。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/todos` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |
| `POST /sessions/{id}/todos` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |
| `PATCH /sessions/{id}/todos/{uuid}` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |
| `DELETE /sessions/{id}/todos/{uuid}` | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | PARTIAL | F-TOD-01 |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 `GET /sessions/{id}/todos`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:1121` → `handleSessionTodos` kind="list" (`index.ts:1720-1753`)。`?status=` filter (5-status enum + "any", `index.ts:1721-1736`)，`plane.list` (`todo-control-plane.ts:85-117`)。ORDER BY `created_at ASC, todo_uuid ASC`。 |
| **F2 测试覆盖** | ✅ | 2 todo-route cases: L211 (list 2 todos in created_at order), L231 (`?status=in_progress` filter)。2 todo-control-plane cases: L140 (list filtered)。All PASS。 |
| **F3 形态合规** | ✅ | auth + lifecycle gate。Response: `{ data: { session_uuid, conversation_uuid, todos }, trace_uuid }` (`index.ts:1741-1752`)。`?status=` 输入校验 (`index.ts:1724-1736`)。 |
| **F4 NACP 合规** | ❌ | **F-TOD-01**: 同 handler 调用 `jsonPolicyError`，其 `error as FacadeErrorCode` 模式有 schema 缺口。List 自身 error paths (400 `invalid-input`) 使用 schema 内 code。 |
| **F5 文档一致性** | ✅ | doc (`todos.md:42-76`) query params、response shape、error table 完全匹配。 |
| **F6 SSoT 漂移** | ❌ | 同 F-TOD-01（同簇间接影响）。 |

**关联 finding**: `F-TOD-01`

##### 3.2.2.2 `POST /sessions/{id}/todos`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:1122` → kind="create" (`index.ts:1755-1816`)。Body parse → validate `content`（non-empty, ≤2000, `index.ts:1760-1768`）, `status`（5-enum, `index.ts:1769-1777`）, `parent_todo_uuid`（UUID, `index.ts:1778-1787`）。Default `status="pending"` (`todo-control-plane.ts:163`)。At-most-1 check on `in_progress` create (`todo-control-plane.ts:170-178`)。201 response。 |
| **F2 测试覆盖** | ✅ | 3 todo-route cases: L174 (POST → 201 pending), L188 (reject invalid status=deferred → 400), L197 (409 at-most-1)。4 todo-control-plane cases: L118 (pending default), L128 (completed + completed_at), L134 (reject second in_progress), L211 (reject unknown status)。All PASS。 |
| **F3 形态合规** | ✅ | body validation 完备：content 长度、status enum、parent_todo_uuid UUID。201 response: `{ data: { session_uuid, conversation_uuid, todo } }` (`index.ts:1798-1809`)。 |
| **F4 NACP 合规** | ❌ | **F-TOD-01**: `TodoConstraintError("invalid-status")` → `todoConstraintToResponse` → `jsonPolicyError(400, "invalid-status", ...)` 不在 schema。**但在 HTTP 层**: handler 在调 `plane.create()` 前已拦截 invalid status 为 `400 invalid-input`（schema 合规，`index.ts:1769-1777`），因此 `"invalid-status"` 在此路径是 dead code。详见 §5.2。 |
| **F5 文档一致性** | ✅ | doc (`todos.md:79-127`) body fields、201 response、error table 完全匹配。 |
| **F6 SSoT 漂移** | ❌ | 同 F-TOD-01。 |

**关联 finding**: `F-TOD-01`

##### 3.2.2.3 `PATCH /sessions/{id}/todos/{todoUuid}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:1130` → kind="patch" (`index.ts:1818-1879`)。Validate body: optional `content`（≤2000）、optional `status`（5-enum）、≥1 of content/status required (`index.ts:1842-1849`)。At-most-1 on transitioning to `in_progress`（self-allowed, `todo-control-plane.ts:233-244`）。Returns 200。 |
| **F2 测试覆盖** | ✅ | 1 todo-route case: L251 (PATCH updates status + bumps completed_at)。3 todo-control-plane cases: L153 (patch status + updated_at/completed_at), L168 (reject in_progress when another holds it), L181 (holder keeps status)。All PASS。 |
| **F3 形态合规** | ✅ | body validation 完备。At-most-1 → 409。Not found → 404。Response: `{ data: { session_uuid, conversation_uuid, todo } }`（`index.ts:1861-1872`）。 |
| **F4 NACP 合规** | ❌ | **F-TOD-01**: 同上。HTTP 层前置校验 status（`index.ts:1833-1841`）使得 `invalid-status` error 在 HTTP 路径中亦为 dead code。 |
| **F5 文档一致性** | ✅ | doc (`todos.md:130-175`) 完全匹配。 |
| **F6 SSoT 漂移** | ❌ | 同 F-TOD-01。 |

**关联 finding**: `F-TOD-01`

##### 3.2.2.4 `DELETE /sessions/{id}/todos/{todoUuid}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:1131` → kind="delete" (`index.ts:1881-1902`)。Hard delete (no soft-delete, `todo-control-plane.ts:17-19`)。Idempotent: first → 200 + `{ deleted: true }`, second → 404 (`todo-control-plane.ts:276-294` + `index.ts:1886-1888`)。 |
| **F2 测试覆盖** | ✅ | 1 todo-route case: L272 (DELETE 200 → 404 on second) + 1 todo-control-plane case: L195 (idempotent)。All PASS。 |
| **F3 形态合规** | ✅ | No body。Response: `{ data: { session_uuid, conversation_uuid, todo_uuid, deleted: true } }` (`index.ts:1889-1901`)。Error 404 `"not-found"`（schema 内）。 |
| **F4 NACP 合规** | ❌ | DELETE 不涉及 `invalid-status` error（仅用 `"not-found"` 合规），但作为同簇端点共享 handler 的 `jsonPolicyError` 模式，属同簇 F4 降级。 |
| **F5 文档一致性** | ✅ | doc (`todos.md:178-197`) 完全匹配。 |
| **F6 SSoT 漂移** | ❌ | 同上（同簇间接）。 |

**关联 finding**: `F-TOD-01`（同簇间接）

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | 所有 4 端点 success: `{ ok:true, data, trace_uuid }`；POST uses 201（正确）。 |
| `x-trace-uuid` 在 response 头里 | ✅ | 每个 `Response.json` 带 `headers: { "x-trace-uuid": traceUuid }`（`index.ts:1751,1808,1871,1900`）。 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | **F-TOD-01**: `invalid-status` 不在 schema（HTTP 层当前 dead code 但仍为 domain→HTTP 映射合约缺口）。 |
| Tenant 边界 5 规则被守住 | ✅ | session lifecycle gate: `team_uuid === auth.team_uuid` + `actor_user_uuid === auth.user_uuid`（`index.ts:1700-1707`）。 |
| Q19 at-most-1 in_progress | ✅ | create (L170-178) + patch (L233-244) 双路径强制。测试覆盖充分。D1 层面有意不使用 UNIQUE（设计文档说明）。 |
| Q20 5-status enum frozen | ✅ | `TODO_STATUSES` exact 5 values (`todo-control-plane.ts:21-27`)。SQL CHECK constraint。Tests confirm。 |
| Authority 翻译合法 | ✅ | 同 models 簇。 |

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-TOD-01` | ❌ | F4/F6 | `invalid-status` error code 不在 `FacadeErrorCodeSchema` | `TodoConstraintError("invalid-status")` → `jsonPolicyError` 的非合约 code；HTTP 层 dead code 但仍为合约缺口 |
| `O-TOD-01` | 📝 | F3 | WebSocket todo frames 为 schema-registered / emitter-pending | `session.todos.write` / `session.todos.update` 帧已 schema-registered，emitter 未 live；agent-core `WriteTodos` 未实现——duly documented |

---

### 3.3 簇 — `transport-profiles`（`clients/api-docs/transport-profiles.md`）

作为 transport 层规范文档（非端点定义），其规范声明在本轮分析内用作对照基准：

| 检查项 | 结论 | 依据 |
|--------|------|------|
| `facade-http-v1` envelope shape (`§2`) | ✅ | 所有 8 个 model/todos 端点遵守 |
| `legacy-do-action` envelope shape (`§3`) | n/a | 不适用于本簇端点 |
| `health-probe` / `debug-health` (`§4`) | n/a | 不适用 |
| `session-ws-v1` frame shape (`§5`) | n/a | 不适用（todos WS frames schema-registered only） |
| `binary-content` profile (`§6`) | n/a | 不适用 |
| Trace UUID Rule (`§7`) | ✅ | `x-trace-uuid` header enforced by auth gate；response body + header 双通道回传 |
| Internal Envelopes (`§8` — Q27 invariant) | ✅ | Drift gate 确认无 `AuthEnvelope`/`Envelope<T>` 泄漏到 public HTTP |
| Versioning Discipline (`§9`) | ✅ | 当前未发现 backward-incompatible 变更 |

**簇级 verdict: PASS**

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| `/models`, `/models/{id}` | Authorization: Bearer `<jwt>` | `authenticateRequest` → verified JWT → `IngressAuthSnapshot{team_uuid, user_uuid, device_uuid}` → team-scoped D1 query | ✅ |
| `/sessions/{id}/model`, `/sessions/{id}/todos`, `/sessions/{id}/todos/{id}` | 同上 | 同上 + `readSessionLifecycle` ownership gate: `team_uuid === auth.team_uuid` + `actor_user_uuid === auth.user_uuid` | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| `/models`, `/models/{id}`, `/sessions/{id}/model` | `x-trace-uuid` request header | `authenticateRequest` → `auth.value.trace_uuid` → response body `trace_uuid` + header `x-trace-uuid` | 强制（auth gate `400 invalid-trace`） | ✅ |
| `/sessions/{id}/todos`, `/sessions/{id}/todos/{id}` | 同上 | 同上 | 强制 | ✅ |

### 4.3 Error Code 字典对齐

- **`FacadeErrorCodeSchema` ⊇ `AuthErrorCodeSchema`**: ✅ compile-time guard `facade-http.ts:98-101`
- **`FacadeErrorCodeSchema` ⊇ `RpcErrorCodeSchema`**: ✅ compile-time guard `facade-http.ts:117-120`
- **发生漂移的 code（non-schema codes found on wire）**:
  | Code | HTTP | 使用位置 |
  |------|------|----------|
  | `models-d1-unavailable` | 503 | `index.ts:2303` |
  | `model-disabled` | 403 | `index.ts:2251` |
  | `model-unavailable` | 400 | `index.ts:2253` |
  | `session-expired` | 409 | `index.ts:2387` |
  | `session_terminal` | 409 | `index.ts:2390` |
  | `invalid-status` | 400 | `todo-control-plane.ts:166,229` → `index.ts:1678` |
- **根因**: `jsonPolicyError(authority.ts:32)` 的 `error as FacadeErrorCode` 是类型断言，非运行期 coercion。注释 (`authority.ts:16-17`: "Legacy callers that pass an unknown code get coerced to `internal-error`") 与实现不符。
- **影响**: 如果 coercion 真的实现，客户端的这些 code 依赖会全部断裂；当前安全网（注释承诺）不存在。

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 覆盖度 | 状态 |
|------|-----------------|--------|------|
| `/models`, `/models/{id}` | JWT `team_uuid` → D1 query scoped to team（policy, catalog, model deny gate） | 5/5 | ✅ |
| `/sessions/{id}/model`, todos CRUD | JWT + D1 ownership gate（`team_uuid` + `actor_user_uuid`） + `deleted_at` guard | 5/5 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `node scripts/check-envelope-drift.mjs` | ✅ PASS — `[check-envelope-drift] 1 public file(s) clean.` |
| 错误信封 drift（人工核查） | ❌ 6 non-schema codes found；drift gate 不检查此维度 |
| `AuthEnvelope`/`Envelope<T>` 泄漏 | ✅ 无泄漏 |
| 缺失 `trace_uuid` | ✅ 无缺失 |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | blocker | 行动项 |
|----|------|----|------|------|------|------|---------|--------|
| `F-MOD-01` | ❌ | models | `GET /models` | F4/F6 | `models-d1-unavailable` 不在 `FacadeErrorCodeSchema` | 503 error code 不是合约 schema 成员；`jsonPolicyError` 的类型断言缺口 | yes | A1 |
| `F-MOD-02` | ❌ | models | `GET /models/{id}`, `GET/PATCH /sessions/{id}/model` | F4/F6 | `model-disabled`, `model-unavailable`, `session-expired`, `session_terminal` 不在 schema | 4 个模型/会话路由的 error code 泄漏到 wire | yes | A1 |
| `F-TOD-01` | ❌ | todos | 全部 4 端点（间接） | F4/F6 | `invalid-status` error code 不在 schema | `TodoConstraintError` → `jsonPolicyError` 的非合约 code；HTTP 层 dead code 但仍为 schema 缺口 | yes | A1 |
| `W-MOD-01` | ⚠️ | models | `GET /models/{id}` | F5 | Response 形状 doc-code 不一致 | doc 扁平 vs code 嵌套 `{ requested_model_id, resolved_model_id, resolved_from_alias, model }` | no | A2 |
| `W-MOD-02` | ⚠️ | models | `GET /sessions/{id}/model` | F5 | 字段命名 doc-code 不一致 | `global_default_model_id`/`effective_default_source` vs `effective_default_model_id`/`source` + 缺失嵌套 `model` | no | A2 |
| `W-MOD-03` | ⚠️ | models | `PATCH /sessions/{id}/model` | F3/F5 | Body/response 形状 doc-code 不一致 | flat `reasoning_effort` vs 嵌套 `reasoning.effort`；`model_id` 必填声明与逻辑不符 | no | A2 |
| `O-MOD-01` | 📝 | models | (n/a) | F5 | Deferred 能力文档化标注 not-yet-live | `<model_switch>`、`model.fallback` stream event、跨 turn fallback chain 均标记为 deferred，客户端不应假设存在 | no | — |
| `O-TOD-01` | 📝 | todos | (n/a) | F3 | WS todo frames schema-registered / emitter-pending | `session.todos.write`/`session.todos.update` 帧已注册、emitter 未 live；agent-core `WriteTodos` 未实现 | no | — |

### 5.2 Finding 详情

#### `F-MOD-01` — `models-d1-unavailable` error code 不在 `FacadeErrorCodeSchema`

- **严重级别**: ❌ FINDING
- **簇 / 端点**: `models / GET /models`
- **维度**: F4 (NACP 合规) / F6 (SSoT 漂移)
- **是否 blocker**: yes
- **事实依据**:
  - `workers/orchestrator-core/src/index.ts:2303` — `jsonPolicyError(503, "models-d1-unavailable", "models lookup failed", traceUuid)` 发射 code `"models-d1-unavailable"`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-91` — `FacadeErrorCodeSchema` 包含 38 codes，不包含 `models-d1-unavailable`
  - `workers/orchestrator-core/src/policy/authority.ts:16-17` — 注释声称 unknown codes "get coerced to `internal-error`"
  - `workers/orchestrator-core/src/policy/authority.ts:32` — 实际实现为 `error as FacadeErrorCode`（类型断言，非 coercion）
  - `scripts/check-envelope-drift.mjs` — 仅检查 `trace_uuid` 和 `AuthEnvelope` 泄漏，不检查 error code schema 合入
  - `workers/orchestrator-core/test/models-route.test.ts:263` — 测试断言 `body.error.code === "models-d1-unavailable"`，表明此 code 已为客户端所依赖
- **为什么重要**:
  - 违反 Q27（public surface 必须使用 FacadeEnvelope）的完整性——虽信封结构合规，但 error code 不在契约清单内
  - 如果 `jsonPolicyError` 的 coercion 被按注释实现，现有客户端对 `models-d1-unavailable` 的断言会全部断裂
  - 当前安全网（注释承诺）实际不存在，未来任何 contributor 可能「修复」coercion 从而造成 zero-warning breaking change
- **修法（What + How）**:
  - **改什么**: 将 `models-d1-unavailable` 添加到 `FacadeErrorCodeSchema`，或实现运行期 coercion（将 non-schema codes 映射到 `internal-error`）
  - **怎么改 — Plan A（推荐）**: 在 `FacadeErrorCodeSchema` 中添加 `"models-d1-unavailable"`，与现有 38 codes 对齐，保持 backward compat
  - **怎么改 — Plan B**: 在 `jsonPolicyError` 中加入运行期 `FacadeErrorCodeSchema.safeParse(error) === false` 时 fallback 到 `"internal-error"`，然后所有现有测试更新为 `internal-error`
  - **测试增量**: 无论 Plan A 或 B，都需新增 envelope-level schema validation 测试确保所有 HTTP response 的 `error.code` 均在 `FacadeErrorCodeSchema` 内
- **建议行动项**: A1（与 F-MOD-02, F-TOD-01 合并处理）
- **复审要点**: 确认所有 wire 上的 error code 均 ∈ `FacadeErrorCodeSchema`

#### `F-MOD-02` — `model-disabled`, `model-unavailable`, `session-expired`, `session_terminal` 不在 `FacadeErrorCodeSchema`

- **严重级别**: ❌ FINDING
- **簇 / 端点**: `models / GET /models/{id}, GET/PATCH /sessions/{id}/model`
- **维度**: F4 / F6
- **是否 blocker**: yes
- **事实依据**: 同根因 F-MOD-01。使用位置:
  - `index.ts:2251` — `model-disabled` (403)
  - `index.ts:2253` — `model-unavailable` (400)
  - `index.ts:2387` — `session-expired` (409)
  - `index.ts:2390` — `session_terminal` (409)
- **为什么重要**: 同 F-MOD-01。影响模型选择（`GET /models/{id}`）和 session model 控制面（`PATCH /sessions/{id}/model`）的关键错误路径
- **修法**: 同 F-MOD-01
- **建议行动项**: A1
- **复审要点**: 同上

#### `F-TOD-01` — `invalid-status` error code 不在 `FacadeErrorCodeSchema`

- **严重级别**: ❌ FINDING
- **簇 / 端点**: `todos / 全部 4 端点（间接）`
- **维度**: F4 / F6
- **是否 blocker**: yes
- **事实依据**:
  - `workers/orchestrator-core/src/todo-control-plane.ts:166,229` — `TodoConstraintError("invalid-status", ...)` 在 `D1TodoControlPlane` 中定义
  - `workers/orchestrator-core/src/index.ts:1668-1679` — `todoConstraintToResponse` 映射 → `jsonPolicyError(status, err.code, err.message, traceUuid)` 将 `"invalid-status"` 作为 error code 发射
  - **但在实际 HTTP 路径中**: handler 层在调用 `plane.create()`/`plane.patch()` 前已前置校验 status 为 5-enum（`index.ts:1769-1777`, `index.ts:1833-1841`），拦截为 `400 invalid-input`（schema 合规）。因此 `"invalid-status"` 在当前 HTTP flow 中是 dead code。
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-91` — `FacadeErrorCodeSchema` 不包含 `invalid-status`
- **为什么重要**:
  - 虽在 HTTP 层为 dead code，但 `D1TodoControlPlane` 作为 domain module 抛出的 `TodoConstraintError("invalid-status")` 可能被其他调用方（如未来的内部 RPC、agent-core）复用并映射到 HTTP
  - `jsonPolicyError` 的类型安全缺口使此 code 在未来任何路径中可无感知泄漏
  - 合约完整性要求所有可能的 HTTP error codes 均为 `FacadeErrorCodeSchema` 成员
- **修法**:
  - **Plan A**: 从 `TodoConstraintError` 中移除 `invalid-status` 分支，因为 handler 层已有前置校验保护。domain 层不再抛此 error
  - **Plan B**: 将 `"invalid-status"` 添加到 `FacadeErrorCodeSchema`
  - **建议**: Plan A（去除 dead code），因为 handler 层已正确处理 invalid status 为 `invalid-input`
- **建议行动项**: A1
- **复审要点**: 验证 `todo-control-plane.ts` 的 `TodoConstraintError` 中不再有未注册的 error codes

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | F-MOD-01, F-MOD-02, F-TOD-01 | models + todos / 全部 | 统一 error code 合规：将 6 个 non-schema code 注册到 `FacadeErrorCodeSchema`，或实现 `jsonPolicyError` 运行期 coercion；从 `TodoConstraintError` 移除 dead code `invalid-status` | `facade-http.ts`, `authority.ts`, `todo-control-plane.ts`, `index.ts` | 新增 envelope error-code-schema validation 单测；更新现有 model/todo 测试 code 断言 | S |
| **A2** | P2 | W-MOD-01, W-MOD-02, W-MOD-03 | models / `GET /models/{id}`, `GET/PATCH /sessions/{id}/model` | 同步 API 文档字段名和形状与代码实现一致 | `clients/api-docs/models.md` | 无需新测试，现有测试已覆盖实际行为 | XS |

### 6.1 整体修复路径建议

推荐修复顺序（2 步）：

**Step 1 — A1 (P0)**: 先在 `authority.ts` 的 `jsonPolicyError` 中实现运行期 coercion（检查 `FacadeErrorCodeSchema.safeParse(error)`，不匹配则 fallback 到 `"internal-error"`）。同时将 6 个实际使用的 codes 添加到 `FacadeErrorCodeSchema`（`models-d1-unavailable`, `model-disabled`, `model-unavailable`, `session-expired`, `session_terminal`, `invalid-status`），保证 backward compat。从 `TodoConstraintError` 移除 `invalid-status`。所有现有 test assertions 保持通过。可合入一个 PR。

**Step 2 — A2 (P2)**: 修正 `clients/api-docs/models.md` 中文档与代码的字段名和形状不一致。可在 A1 的 PR 中一起提交或独立 PR。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| O-MOD-01 | `model_switch`、`model.fallback` stream event、cross-turn fallback 明确标记为 deferred/not-yet-live | HP2 后续批次完成时 | HP2 owner | — |
| O-TOD-01 | WS todo frames emitter not live、agent-core `WriteTodos` 未实现 — 均为 HP6 后续批次 | WS emitter 上线时 | HP6 owner | — |

---

## 7. 测试覆盖矩阵

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `GET /models` | — | `models-route.test.ts:77-263` (6 cases) | `cross-e2e/15-hp2-model-switch.test.mjs` (live) | 401, 200, 304, 503, team filter | ✅ |
| `GET /models/{id}` | — | `models-route.test.ts:266-350` (2 cases) | 同上 + `package-e2e/11-rh5-models-image-reasoning.test.mjs` (live) | 200, alias resolve, capability backfill | ✅ |
| `GET /sessions/{id}/model` | — | `session-model-route.test.ts:177-221` (1 case) | — | 200, session state + last_turn | ✅ |
| `PATCH /sessions/{id}/model` | — | `session-model-route.test.ts:223-325` (3 cases) | — | 200, alias resolve + normalize, clear, 409 ended | ✅ |
| `GET /sessions/{id}/todos` | — | `todo-route.test.ts:211-249` (2 cases) | — | 200 list, ?status= filter | ✅ |
| `POST /sessions/{id}/todos` | `todo-control-plane.test.ts:118-148` (4 cases) | `todo-route.test.ts:174-209` (3 cases) | — | 201, 400 invalid status, 409 at-most-1 | ✅ |
| `PATCH /sessions/{id}/todos/{uuid}` | `todo-control-plane.test.ts:153-193` (3 cases) | `todo-route.test.ts:251-270` (1 case) | — | 200, completed_at, 409 at-most-1 | ✅ |
| `DELETE /sessions/{id}/todos/{uuid}` | `todo-control-plane.test.ts:195-210` (1 case) | `todo-route.test.ts:272-289` (1 case) | — | 200 success, 404 idempotent | ✅ |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| `GET /models` | Error code schema validation (确认 `models-d1-unavailable` ∈ `FacadeErrorCodeSchema`) | `models-route.test.ts` 或新增 contract validation test | F-MOD-01 |
| `GET /models/{id}` | 400 (`model-unavailable`)、403 (`model-disabled`) error code schema validation | `models-route.test.ts` | F-MOD-02 |
| `GET /sessions/{id}/model` | 409 (`session-expired`, `session_terminal`) error code schema validation | `session-model-route.test.ts` | F-MOD-02 |

> 所有路由级 happy path + 关键 error path 已有覆盖。唯一缺口是 error code 是否符合 `FacadeErrorCodeSchema` 的 schema-level validation（属于 A1 测试增量范围）。

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | 635-846 | 路由分发 `dispatchFetch` |
| `workers/orchestrator-core/src/index.ts` | 704-711 | Model 路由 dispatch |
| `workers/orchestrator-core/src/index.ts` | 751-754 | Todo 路由 dispatch |
| `workers/orchestrator-core/src/index.ts` | 1076-1106 | `parseModelDetailRoute`, `parseSessionModelRoute` |
| `workers/orchestrator-core/src/index.ts` | 1108-1133 | `parseSessionTodoRoute` |
| `workers/orchestrator-core/src/index.ts` | 1660-1902 | `handleSessionTodos` + helpers |
| `workers/orchestrator-core/src/index.ts` | 2224-2451 | `resolveTeamModelOrResponse`, `handleModelsList`, `handleModelDetail`, `handleSessionModel` |
| `workers/orchestrator-core/src/session-truth.ts` | 411-442 | `listActiveModelsForTeam` (D1 catalog query) |
| `workers/orchestrator-core/src/session-truth.ts` | 444-494 | `resolveModelForTeam` (alias + policy query) |
| `workers/orchestrator-core/src/session-truth.ts` | 507-522 | `updateSessionModelDefaults` (D1 UPDATE) |
| `workers/orchestrator-core/src/session-truth.ts` | 559-589 | `readSessionModelState` (session model state assembly) |
| `workers/orchestrator-core/src/session-truth.ts` | 781-819 | `readSessionLifecycle` (session ownership gate) |
| `workers/orchestrator-core/src/session-lifecycle.ts` | 98-143 | `parseModelOptions` (model_id/reasoning validator) |
| `workers/orchestrator-core/src/session-lifecycle.ts` | 145-203 | `parseSessionModelPatchBody` (PATCH body validator) |
| `workers/orchestrator-core/src/session-lifecycle.ts` | 205-220 | `normalizeReasoningOptions` (reasoning effort normalizer) |
| `workers/orchestrator-core/src/todo-control-plane.ts` | 1-295 | `D1TodoControlPlane` (full todo CRUD + constraints) |
| `workers/orchestrator-core/src/auth.ts` | 1-329 | `authenticateRequest` (Bearer/JWT/device gate) |
| `workers/orchestrator-core/src/policy/authority.ts` | 1-59 | `jsonPolicyError`, `readTraceUuid` |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | 1-219 | `FacadeErrorCodeSchema`, `FacadeEnvelope` contract |
| `packages/orchestrator-auth-contract/src/auth-error-codes.ts` | 1-18 | `AuthErrorCodeSchema` (13 codes) |
| `packages/nacp-core/src/error-registry.ts` | 1-378 | NACP error taxonomy, unified ErrorMeta |
| `scripts/check-envelope-drift.mjs` | 1-156 | Root drift gate |
| `workers/orchestrator-core/test/models-route.test.ts` | 1-350 | Model routes unit/integration tests |
| `workers/orchestrator-core/test/session-model-route.test.ts` | 1-326 | Session model routes unit/integration tests |
| `workers/orchestrator-core/test/todo-route.test.ts` | 1-290 | Todo HTTP routes integration tests |
| `workers/orchestrator-core/test/todo-control-plane.test.ts` | 1-244 | Todo control plane unit tests |
| `clients/api-docs/models.md` | 1-240 | 受查文档 — Models API |
| `clients/api-docs/todos.md` | 1-222 | 受查文档 — Todos API |
| `clients/api-docs/transport-profiles.md` | 1-146 | 受查文档 — Transport Profiles spec |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §9**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**: same reviewer rereview
- **二次审查触发条件**:
  - A1 PR merged（error code 合规修复）
  - Drift gate 重新跑过 + `FacadeErrorCodeSchema` 增量 schema validation test 全绿
- **二次审查应重点核查**:
  1. 所有 wire 上的 `error.code` 是否都 ∈ `FacadeErrorCodeSchema`（新增 schema validation test 应包含此断言）
  2. `jsonPolicyError` 的 coercion 是否正确运行（或所有 code 已注册）
  3. `TodoConstraintError` 是否不再包含 `invalid-status`

### 9.3 合规声明前的 blocker

1. `F-MOD-01` — Action A1
2. `F-MOD-02` — Action A1
3. `F-TOD-01` — Action A1
4. Drift gate + 新增 schema validation test 全 green

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> 文档状态切到 `changes-requested` 后，实现者把修复结论 append 在这一节，按 Finding ID 一条一条回。

### 10.1 回应汇总表

| Finding ID | 处理结果 | PR / Commit | 验证证据 | reviewer 复核结论 |
|------------|----------|-------------|----------|-------------------|
| `F-MOD-01` | — | — | — | — |
| `F-MOD-02` | — | — | — | — |
| `F-TOD-01` | — | — | — | — |
| `W-MOD-01` | — | — | — | — |
| `W-MOD-02` | — | — | — | — |
| `W-MOD-03` | — | — | — | — |

### 10.2 逐条回应

*（当实现者完成修复后追加）*
