# Nano-Agent API Compliance 调查报告

> 调查对象: `Models + Todos + Transport Profiles`
> 调查类型: `full-surface`
> 调查者: `kimi`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/models.md`
> - `clients/api-docs/todos.md`
> - `clients/api-docs/transport-profiles.md`
> Profile / 协议族: `facade-http-v1` (Models/Todos); `health-probe`, `debug-health`, `legacy-do-action`, `session-ws-v1`, `binary-content` (Transport Profiles)
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/todo-control-plane.ts`
> - `workers/orchestrator-core/src/session-truth.ts`
> - `docs/design/hero-to-pro/HPX-qna.md` Q19/Q20/Q27
> - `scripts/check-envelope-drift.mjs`
> 复用 / 对照的既有审查:
> - 无 prior compliance report 直接对照 — 独立复核
> 文档状态: `reviewed`

---

## 0. 总判定 / Executive Summary

本轮 Models + Todos + Transport Profiles 调查整体**接近合规但存在 4 项 FINDING 和 2 项 WARN**，不允许声明 fully-compliant，需先修 FINDING。

- **整体 verdict**：`Models 与 Todos 功能链路真实可达，测试覆盖充分，NACP 信封与 auth 模式合规；但存在 API 文档与代码实现之间的响应形状/字段名/错误码不一致，需在声明合规前修复。`
- **结论等级**：`compliant-with-followups`
- **是否允许声明合规**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `GET /models/{modelIdOrAlias}` 的响应形状：文档声明模型字段在 `data` 顶层，但代码实际包裹在 `data.model` 内并附加 `requested_model_id`/`resolved_model_id`/`resolved_from_alias` —— 文档与代码存在形状背离。
  2. `GET /sessions/{id}/model` 的字段名：文档声明 `effective_default_source`，但代码/测试实际使用 `source`。
  3. Todo 404 错误码：文档声明 `todo-not-found`，但代码统一返回 `not-found`（后者在 `FacadeErrorCodeSchema` 内，前者不在）。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Models | 4 | ✅ | ✅ | ⚠️ | ✅ | ❌ | ⚠️ | PARTIAL |
| Todos | 4 | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | PARTIAL |
| Transport Profiles | 6 profiles | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 4 | yes |
| ⚠️ WARN     | 2 | no（建议修） |
| 📝 OBSERVATION | 1 | no（仅记录） |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性（Functionality） | 路由→实现是否真实成链？文档声明的能力是否真的存在？ | route → handler → backing repo / RPC 全链路可达，行为符合 doc |
| **F2** | 测试覆盖（Test Coverage） | 是否有测试在这条路径上跑过？覆盖了 happy path 与关键错误路径？ | 单测 + 集成 + （必要时）E2E / live 任一层有断言 |
| **F3** | 形态合规（Shape Compliance） | 请求/响应/错误形态、auth gate、status code 是否与 doc 与契约对齐？ | request/response 满足 schema；auth 行为与 doc 同；status code 同 |
| **F4** | NACP 协议合规（NACP Compliance） | envelope、authority、trace、tenant boundary、error code 是否符合 NACP profile？ | 信封正族；trace 贯通；authority 翻译合法；tenant 边界守住 |
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

- **对照的 API 文档**：
  - `clients/api-docs/models.md`
  - `clients/api-docs/todos.md`
  - `clients/api-docs/transport-profiles.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/index.ts:639-833` (dispatchFetch / route parsing)
  - `workers/orchestrator-core/src/index.ts:1078-1133` (model/todo route parsers)
  - `workers/orchestrator-core/src/index.ts:1681-1902` (todo handler)
  - `workers/orchestrator-core/src/index.ts:2224-2451` (model handlers)
  - `workers/orchestrator-core/src/todo-control-plane.ts:82-295` (todo CRUD)
  - `workers/orchestrator-core/src/session-truth.ts:411-590` (model state repo)
  - `workers/orchestrator-core/src/auth.ts:221-327` (authenticateRequest)
  - `workers/orchestrator-core/src/policy/authority.ts:21-52` (jsonPolicyError / readTraceUuid)
  - `workers/orchestrator-core/src/index.ts:2946-3011` (wrapSessionResponse)
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:1-219` (FacadeEnvelope / FacadeErrorCodeSchema)
  - `packages/nacp-core/src/error-registry.ts:1-370` (unified error registry)
  - `packages/nacp-core/src/envelope.ts:1-380` (NACP envelope validation)
- **执行过的验证**：
  - `node scripts/check-envelope-drift.mjs` → `1 public file(s) clean` ✅
  - `node scripts/check-tool-drift.mjs` → `catalog SSoT clean` ✅
  - `cd workers/orchestrator-core && npx vitest run` → `34 passed (34), 314 passed (314)` ✅

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行核对了 6 个核心实现文件 + 3 个契约文件 + 4 个测试文件 |
| 单元 / 集成测试运行 | yes | orchestrator-core 全部 314 个测试通过；含 model/todo 专用测试文件 |
| Drift gate 脚本运行 | yes | envelope drift + tool drift 均 green |
| schema / contract 反向校验 | yes | 对照 `FacadeErrorCodeSchema` 核验了所有文档声明的错误码 |
| live / preview / deploy 证据 | n/a | 未进行 live deploy 验证，依赖单元/集成测试 |
| 与上游 design / Q-law 对账 | yes | 对照 HPX-Q19/Q20/Q27 核验了 todo 状态机、envelope 规则 |

### 1.5 跨簇横切观察

- **架构与路由层**：所有簇都经 orchestrator-core `dispatchFetch()` 统一调度；Models/Todos 为 facade-http-v1 直连 D1，不经过 User DO。
- **Envelope 契约**：所有业务路由使用 `facade-http-v1` 的 `{ ok, data?, error?, trace_uuid }`；legacy-do-action 路由经 `wrapSessionResponse()` 透传。
- **Auth 模式**：统一使用 `authenticateRequest()`（Bearer JWT + device gate）；todo/model 路由不接受 query-string token。
- **Trace 传播**：client 必须发送 `x-trace-uuid` header；server 在 response header `x-trace-uuid` 与 body `trace_uuid` 中回显；缺失时返回 400 `invalid-trace`。
- **NACP authority 翻译**：JWT claim → `IngressAuthSnapshot` → `x-nano-internal-authority` header 转发给 User DO / RPC。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| Models | `GET /models` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Models | `GET /models/{id}` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-MOD-01 响应形状不匹配 |
| Models | `GET /sessions/{id}/model` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-SES-01 字段名不匹配 |
| Models | `PATCH /sessions/{id}/model` | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | W-MOD-01 503 错误码未全量文档化 |
| Todos | `GET /sessions/{id}/todos` | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | W-TOD-01 `?status=any` 未文档化 |
| Todos | `POST /sessions/{id}/todos` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-TOD-01 错误码不匹配 |
| Todos | `PATCH /sessions/{id}/todos/{id}` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-TOD-02 404 错误码不匹配 |
| Todos | `DELETE /sessions/{id}/todos/{id}` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-TOD-02 404 错误码不匹配 |

---

## 3. 簇级深度分析

### 3.1 簇 — Models（`clients/api-docs/models.md`）

#### 3.1.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()             workers/orchestrator-core/src/index.ts:639
  → parseModelDetailRoute() / parseSessionModelRoute()  index.ts:1078-1106
  → handleModelsList() / handleModelDetail() / handleSessionModel()  index.ts:2256-2451
  → authenticateRequest()                         index.ts/auth.ts:221-327
  → D1SessionTruthRepository                      session-truth.ts:411-590
  → Response.json({ ok: true, data, trace_uuid }) index.ts:2287-2344
```

**链路注记**：model 路由排在 auth/catalog 路由之后、session DO 路由之前；`parseModelDetailRoute` 与 `parseSessionModelRoute` 互不冲突（路径段数不同）。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /models` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /models/{id}` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-MOD-01 |
| `GET /sessions/{id}/model` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-SES-01 |
| `PATCH /sessions/{id}/model` | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | W-MOD-01 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `GET /models`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:708-711` → `handleModelsList:2256-2305` → `D1SessionTruthRepository.listActiveModelsForTeam:session-truth.ts:411-442`；行为：按 team policy 过滤 active models，返回列表 + ETag |
| **F2 测试覆盖** | ✅ | 单测：`models-route.test.ts:137-170` (200 happy, capabilities, aliases)；`models-route.test.ts:172-207` (304 ETag)；`models-route.test.ts:209-239` (team filter)；`models-route.test.ts:241-264` (503 D1 fail) |
| **F3 形态合规** | ✅ | auth：`Bearer JWT` + device gate；request：无 body，`If-None-Match` 可选；response：`{ ok, data:{models}, trace_uuid }` + `ETag` + `Cache-Control: private, max-age=60`；status：200/304/401/503；error：`invalid-auth`, `models-d1-unavailable` |
| **F4 NACP 合规** | ✅ | envelope：`facade-http-v1`；trace：`x-trace-uuid` header 回显；authority：JWT → `IngressAuthSnapshot` → `team_uuid` 过滤；tenant：按 `team_uuid` policy 过滤模型列表 |
| **F5 文档一致性** | ✅ | 文档与代码完全对齐 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过；契约对账：错误码 `invalid-auth` / `models-d1-unavailable` / `worker-misconfigured` 均已在 facade 或 registry 登记 |

**关联 finding**：无

##### 3.1.2.2 `GET /models/{modelIdOrAlias}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:704-707, 1078-1092` → `handleModelDetail:2307-2345` → `resolveTeamModelOrResponse:2224-2254` → D1 alias + policy 查询；行为：支持 canonical id 与 alias，返回完整 metadata |
| **F2 测试覆盖** | ✅ | 单测：`models-route.test.ts:266-298` (alias resolve)；`models-route.test.ts:301-349` (reasoning/vision backfill) |
| **F3 形态合规** | ✅ | auth/request/response envelope 均合规；status 200/400/403/404 与 doc 对齐 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ❌ | **文档声明响应形状**：模型字段直接在 `data` 顶层（`data.model_id`, `data.family`…）。**代码实际形状**：`data.model` 内嵌模型对象，并附加 `requested_model_id`, `resolved_model_id`, `resolved_from_alias`。测试与代码一致（`models-route.test.ts:288-298`）。doc 与代码存在形状背离。 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过 |

**关联 finding**：`F-MOD-01`

##### 3.1.2.3 `GET /sessions/{id}/model`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:773-776, 1096-1106` → `handleSessionModel:2347-2451` (branch at 2380) → `readSessionModelState:session-truth.ts:559-589`；行为：返回 session 当前 default model + global default + effective source |
| **F2 测试覆盖** | ✅ | 单测：`session-model-route.test.ts:177-221` (200 happy, source global, last turn audit) |
| **F3 形态合规** | ✅ | auth/request/response envelope 均合规；status 200/404/409 与 doc 对齐 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ❌ | **文档声明字段名**：`effective_default_source` ∈ `{"session", "global"}`。**代码/测试实际字段名**：`source`（`session-model-route.test.ts:218` 检查 `body.data.source`）。doc 与代码存在字段名背离。 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过 |

**关联 finding**：`F-SES-01`

##### 3.1.2.4 `PATCH /sessions/{id}/model`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route同上 → `handleSessionModel` branch 2386+ → `parseSessionModelPatchBody:session-lifecycle.ts:145-203` → `resolveTeamModelOrResponse` → `updateSessionModelDefaults:session-truth.ts:507-522`；行为：设置/清除 session default model + reasoning effort，支持 alias 解析与 reasoning normalization |
| **F2 测试覆盖** | ✅ | 单测：`session-model-route.test.ts:223-263` (alias resolve + reasoning normalize)；`session-model-route.test.ts:265-297` (clear with null)；`session-model-route.test.ts:299-325` (reject ended session 409) |
| **F3 形态合规** | ⚠️ | auth/request/response 均合规；但 503 db-binding-missing 时返回 `worker-misconfigured`，文档仅记载 `models-d1-unavailable`。 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ⚠️ | 请求形状/成功响应/错误 status 均对齐；仅 503 错误码文档未覆盖 `worker-misconfigured` 场景。 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过 |

**关联 finding**：`W-MOD-01`

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `Response.json({ ok:true, data, trace_uuid })` 于 `index.ts:2287-2344, 2381-2384, 2447-2450` |
| `x-trace-uuid` 在 response 头里 | ✅ | 所有 model 路由 handler 均设置 header `x-trace-uuid: traceUuid` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ⚠️ | `models-d1-unavailable`（`index.ts:2303`）**不在** `FacadeErrorCodeSchema` 内（`facade-http.ts:48-90`）。这是一个 SSoT 漂移。 |
| Tenant 边界 5 规则被守住 | ✅ | `teamUuid` 从 auth snapshot 提取，D1 查询均带 `team_uuid` 过滤；session 路由额外校验 `actor_user_uuid` |
| Authority 翻译合法（HTTP claim → server-stamped） | ✅ | JWT → `IngressAuthSnapshot` → `x-nano-internal-authority` → RPC meta (`index.ts:817-825`) |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-MOD-01` | ❌ | F5 | `GET /models/{id}` 响应形状文档与代码不一致 | 客户端若按 doc 解析会直接访问 `data.model_id` 失败 |
| `F-SES-01` | ❌ | F5 | `GET /sessions/{id}/model` 字段名 `effective_default_source` 实际为 `source` | 客户端按 doc 访问 `effective_default_source` 会得到 undefined |
| `F-MOD-02` | ❌ | F6 | `models-d1-unavailable` 不在 `FacadeErrorCodeSchema` 内 | 严格 schema 校验客户端会解析失败 |
| `W-MOD-01` | ⚠️ | F3 | `PATCH /sessions/{id}/model` 503 `worker-misconfigured` 未在 doc 记载 | 文档不完整，但错误码属于标准集合 |

#### 3.1.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `GET /models` | 无异常，ETag、team filter、D1 fail 均按 doc 实链 |

---

### 3.2 簇 — Todos（`clients/api-docs/todos.md`）

#### 3.2.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()             index.ts:639
  → parseSessionTodoRoute()                       index.ts:1108-1133
  → handleSessionTodos()                          index.ts:1681-1902
  → authenticateRequest()                         auth.ts:221-327
  → D1TodoControlPlane                            todo-control-plane.ts:82-295
  → Response.json({ ok: true, data, trace_uuid }) index.ts:1741-1808
```

**链路注记**：todo 路由完全不经过 User DO，直接对 D1 进行 CRUD；`parseSessionTodoRoute` 与 `parseSessionModelRoute` 路径不冲突（`/model` vs `/todos`）。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/todos` | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | W-TOD-01 |
| `POST /sessions/{id}/todos` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-TOD-01 |
| `PATCH /sessions/{id}/todos/{id}` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-TOD-02 |
| `DELETE /sessions/{id}/todos/{id}` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | FAIL | F-TOD-02 |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 `GET /sessions/{id}/todos`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:751-754, 1108-1133` → `handleSessionTodos:1720-1752` → `D1TodoControlPlane.list:todo-control-plane.ts:85-117`；行为：按 `created_at ASC` 列出 session todos，支持 `?status=` 过滤 |
| **F2 测试覆盖** | ✅ | 单测：`todo-route.test.ts:211-229` (list order)；`todo-route.test.ts:231-249` (status filter)；控制平面单测：`todo-control-plane.test.ts:140-151` (filter by status) |
| **F3 形态合规** | ✅ | auth：JWT + session ownership；request：`?status` 可选；response：`{ ok, data:{session_uuid, conversation_uuid, todos}, trace_uuid }`；status：200/400/401/404/409 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ⚠️ | 文档未记载 `?status=any` 过滤值，但代码支持（`index.ts:1734-1735`）。其余完全对齐。 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过；Q19/Q20 状态机冻结已由迁移测试确认 |

**关联 finding**：`W-TOD-01`

##### 3.2.2.2 `POST /sessions/{id}/todos`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route同上 → `handleSessionTodos:1755-1816` → `D1TodoControlPlane.create:todo-control-plane.ts:119-178`；行为：创建 todo，默认 `pending`，可选 `status`/`parent_todo_uuid`；at-most-1 `in_progress` invariant 由 SQL + 应用层双重 enforce |
| **F2 测试覆盖** | ✅ | 单测：`todo-route.test.ts:174-186` (default pending)；`todo-route.test.ts:188-195` (reject invalid status)；`todo-route.test.ts:197-209` (409 in_progress conflict)；控制平面单测：`todo-control-plane.test.ts:118-136` (create default / completed / reject second in_progress) |
| **F3 形态合规** | ✅ | auth/request/response envelope 均合规；status 201/400/401/404/409 与 doc 对齐 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ❌ | **文档声明错误码**：status 非法时返回 `invalid-status`（`todos.md:123`）。**代码实际错误码**：返回 `invalid-input`（`index.ts:1773`）。`invalid-status` 不在 `FacadeErrorCodeSchema` 内。 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过 |

**关联 finding**：`F-TOD-01`

##### 3.2.2.3 `PATCH /sessions/{id}/todos/{todo_uuid}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route同上 → `handleSessionTodos:1818-1878` → `D1TodoControlPlane.patch:todo-control-plane.ts:220-265`；行为：更新 status/content，自动设置 `completed_at` 于 terminal status，enforce at-most-1 invariant |
| **F2 测试覆盖** | ✅ | 单测：`todo-route.test.ts:251-270` (update status + completed_at)；控制平面单测：`todo-control-plane.test.ts:153-195` (patch updated_at, terminal completed_at, in_progress conflict, allow self in_progress) |
| **F3 形态合规** | ✅ | auth/request/response envelope 均合规；status 200/400/404/409 与 doc 对齐 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ❌ | **文档声明错误码**：todo 不存在时返回 `todo-not-found`（`todos.md:173`）。**代码实际错误码**：返回 `not-found`（`index.ts:1859`）。`todo-not-found` 不在 `FacadeErrorCodeSchema` 内。 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过 |

**关联 finding**：`F-TOD-02`

##### 3.2.2.4 `DELETE /sessions/{id}/todos/{todo_uuid}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route同上 → `handleSessionTodos:1881-1901` → `D1TodoControlPlane.delete:todo-control-plane.ts:276-294`；行为：硬删除 todo row，返回 `deleted: true` |
| **F2 测试覆盖** | ✅ | 单测：`todo-route.test.ts:272-289` (delete + 404 on second delete)；控制平面单测：`todo-control-plane.test.ts:197-208` (idempotent delete) |
| **F3 形态合规** | ✅ | auth/request/response envelope 均合规；status 200/404 与 doc 对齐 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ❌ | **文档声明错误码**：todo 不存在时返回 `todo-not-found`（`todos.md:196`）。**代码实际错误码**：返回 `not-found`（`index.ts:1887`）。 |
| **F6 SSoT 漂移** | ✅ | drift gate 通过 |

**关联 finding**：`F-TOD-02`

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | 所有 todo 路由均 `Response.json({ ok:true, data, trace_uuid })` |
| `x-trace-uuid` 在 response 头里 | ✅ | `index.ts:1751, 1808, 1871, 1900` 均设置 header |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `todo-not-found` 不在 schema 内；代码正确使用了 `not-found` |
| Tenant 边界 5 规则被守住 | ✅ | session 所有权校验 (`team_uuid` + `actor_user_uuid`) 于 `index.ts:1699-1706` |
| Authority 翻译合法 | ✅ | JWT → `IngressAuthSnapshot` → D1 查询带 team_uuid 过滤 |

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-TOD-01` | ❌ | F5 | `POST /sessions/{id}/todos` 错误码文档声明 `invalid-status`，代码返回 `invalid-input` | 文档与代码不一致；`invalid-status` 不在 `FacadeErrorCodeSchema` 内 |
| `F-TOD-02` | ❌ | F5 | Todo 404 错误码文档声明 `todo-not-found`，代码返回 `not-found` | 文档与代码不一致；`todo-not-found` 不在 `FacadeErrorCodeSchema` 内 |
| `W-TOD-01` | ⚠️ | F5 | `GET /sessions/{id}/todos` 支持 `?status=any` 但未在文档记载 | 文档不完整 |

#### 3.2.5 全 PASS 端点简表（合并展示）

无。本簇 4 个端点均带有 WARN 或 FINDING。

---

### 3.3 簇 — Transport Profiles（`clients/api-docs/transport-profiles.md`）

#### 3.3.0 路由轨迹（Route Trace）

Transport Profiles 是元文档，描述 envelope 规则而非具体业务路由。各 profile 的实现轨迹如下：

```text
health-probe:       Client → GET / or /health → createShellResponse() → raw JSON
                    index.ts:639-641, 127-138

debug-health:       Client → GET /debug/workers/health → buildWorkerHealthSnapshot() → raw JSON
                    index.ts:643-645, 188-218

facade-http-v1:     Client → business route → handler → Response.json({ ok, data, trace_uuid })
                    facade-http.ts:18-30, index.ts 各 handler

legacy-do-action:   Client → session DO action → session-flow.ts → wrapSessionResponse()
                    index.ts:2946-3011 (passthrough detection)

session-ws-v1:      Client → GET /sessions/{id}/ws → User DO → ws-runtime.ts → lightweight frames
                    index.ts:788-790, user-do/ws-runtime.ts:50-151

binary-content:     Client → GET /sessions/{id}/files/{id}/content → raw bytes
                    index.ts:739-742, 2778-2807
```

#### 3.3.1 Profile 矩阵

| Profile | F1 | F2 | F3 | F4 | F5 | F6 | verdict |
|---------|----|----|----|----|----|----|---------|
| `health-probe` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| `debug-health` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| `facade-http-v1` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| `legacy-do-action` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| `session-ws-v1` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| `binary-content` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |

#### 3.3.2 Profile 逐项分析

##### `facade-http-v1` Envelope

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `facade-http.ts:164-185` 提供 `facadeOk` / `facadeError` helper；所有业务路由使用这些 helper 或手动构造相同形状 |
| **F2 测试覆盖** | ✅ | `facade-http.test.ts` 测试 envelope schema；`check-envelope-drift.mjs` 在 CI 运行 |
| **F3 形态合规** | ✅ | 成功：`{ ok:true, data:T, trace_uuid }`；错误：`{ ok:false, error:{code,status,message,details?}, trace_uuid }` |
| **F4 NACP 合规** | ✅ | `trace_uuid` 强制存在；`error.code` 来自 `FacadeErrorCodeSchema`；`x-trace-uuid` header 回显 |
| **F5 文档一致性** | ✅ | `transport-profiles.md:25-47` 与 `facade-http.ts:18-30` 完全一致 |
| **F6 SSoT 漂移** | ✅ | `check-envelope-drift.mjs` 通过；`AuthErrorCode ⊂ FacadeErrorCode` 与 `RpcErrorCode ⊂ FacadeErrorCode` 由 TS compile-time guard 保证 (`facade-http.ts:98-120`) |

##### `legacy-do-action` Envelope

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-flow.ts` 各 handler 返回 `{ ok:true, action, session_uuid, ..., trace_uuid }`；`wrapSessionResponse()` 识别并透传 (`index.ts:2976-2983`) |
| **F2 测试覆盖** | ✅ | 大量 session action 路由测试覆盖（messages, start, cancel, close, delete 等） |
| **F3 形态合规** | ✅ | 成功无 `data` wrapper，payload 平铺顶层；错误回退到 `facade-http-v1` 错误 shape |
| **F4 NACP 合规** | ✅ | `trace_uuid` 由 `wrapSessionResponse` 注入（若缺失）；错误 shape 与 facade 一致 |
| **F5 文档一致性** | ✅ | `transport-profiles.md:58-79` 与代码实现一致 |
| **F6 SSoT 漂移** | ✅ | drift gate 透传逻辑已覆盖 legacy-do-action 形状 |

##### `session-ws-v1` Frame Shape

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `ws-runtime.ts` 处理 WebSocket upgrade；`frame-compat.ts` 提供 lightweight ↔ NACP frame 转换 |
| **F2 测试覆盖** | ✅ | `hp6-todo-messages.test.ts` 测试 todo frame schema；WS 集成测试在 E2E 层覆盖 |
| **F3 形态合规** | ✅ | server frame: `{ kind, seq, name, payload }`；client frame: `{ kind:"client.input", payload }` |
| **F4 NACP 合规** | ✅ | trace 通过 URL query `trace_uuid` 传递；server frame payload 内可带 `trace_uuid` |
| **F5 文档一致性** | ✅ | `transport-profiles.md:95-107` 与 `frame-compat.ts:29-32` 一致 |
| **F6 SSoT 漂移** | ✅ | NACP 版本兼容性由 `NACP_VERSION_COMPAT` 控制 |

##### `binary-content` Profile

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleSessionFiles:2778-2807` 返回 `new Response(bytes)` 带 `Content-Type` / `Content-Length` |
| **F2 测试覆盖** | ✅ | E2E 文件上传/下载测试覆盖 |
| **F3 形态合规** | ✅ | 200 返回 raw bytes；错误时回退到 `facade-http-v1` JSON envelope |
| **F4 NACP 合规** | ✅ | 错误回退路径使用 `jsonPolicyError` → facade envelope |
| **F5 文档一致性** | ✅ | `transport-profiles.md:111-116` 与代码一致 |
| **F6 SSoT 漂移** | ✅ | drift gate 跳过非 JSON response（`content-type` 不含 `application/json`） |

#### 3.3.3 Trace UUID Rule 验证

| 路由族 | trace_uuid 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|--------|-----------------|----------|--------------|------|
| `/models`, `/sessions/{id}/todos` 等业务路由 | `x-trace-uuid` header | request header → auth.ts:233-238 校验 → response header/body | required | ✅ |
| `/health`, `/` | 可选 | server 生成 `crypto.randomUUID()` | optional | ✅ |
| `/debug/workers/health` | 可选 | server 生成 | optional | ✅ |
| WS `/sessions/{id}/ws` | URL query `trace_uuid` | ws-runtime.ts 读取 → frame payload | required | ✅ |

#### 3.3.4 簇级 finding 汇总

无 finding。Transport Profiles 簇全部 PASS。

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| Models / Todos HTTP 路由 | `Authorization: Bearer <JWT>` | JWT verify → `IngressAuthSnapshot` (`auth.ts:298-309`) → D1 查询带 `team_uuid` + `actor_user_uuid` 过滤 | ✅ |
| Session DO action 路由 | 同上 | 同上 + `x-nano-internal-authority` header 转发 (`index.ts:817-818`) | ✅ |
| WS 路由 | 同上 + URL query token | `readWsAuthority()` 解析 → `enforceSessionDevice()` 设备门 | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| 业务 HTTP | `x-trace-uuid` header | `readTraceUuid()` → `authenticateRequest()` → response `x-trace-uuid` header + body `trace_uuid` | required | ✅ |
| Health probe | server 生成 | `crypto.randomUUID()` | optional | ✅ |
| WebSocket | URL query `trace_uuid` | `ws-runtime.ts` 读取 | required | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` / `RpcErrorCodeSchema` 的超集：✅
  - `AuthErrorCode ⊂ FacadeErrorCode`: `facade-http.ts:98-101` compile-time guard
  - `RpcErrorCode ⊂ FacadeErrorCode`: `facade-http.ts:117-120` compile-time guard
- 编译期 guard：`facade-http.ts:98-120` — `_authErrorCodesAreFacadeCodes` / `_rpcErrorCodesAreFacadeCodes`
- 运行期回退：未知 code → `internal-error` (`facadeFromAuthEnvelope:209-213`)
- **异常**：`models-d1-unavailable` 被代码使用但不在 `FacadeErrorCodeSchema` 内，属于运行时 schema 逃逸（`F-MOD-02`）。

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| Models | `teamUuid` 从 JWT claim 提取 → D1 `nano_team_model_policy` 过滤 | 5/5 | ✅ |
| Todos | `teamUuid` + `actor_user_uuid` 与 session row 匹配 | 5/5 | ✅ |
| Session DO actions | `auth_snapshot` 注入 DO → 每次操作校验 `team_uuid` | 5/5 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `pnpm check:envelope-drift` | ✅ green — `1 public file(s) clean` |
| `pnpm check:tool-drift` | ✅ green — `catalog SSoT clean` |
| `pnpm check:cycles` | 未执行 |
| `pnpm check:megafile` | 未执行 |
| 错误信封 drift（人工核查） | ✅ 未在 `index.ts` 发现 `AuthEnvelope` / `Envelope` 直接暴露给 public 的情况 |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| `F-MOD-01` | ❌ | Models | `GET /models/{modelIdOrAlias}` | F5 | 响应形状文档与代码不一致 | 客户端按 doc 解析 `data.model_id` 会失败 | yes | A1 |
| `F-SES-01` | ❌ | Models | `GET /sessions/{id}/model` | F5 | 字段名 `effective_default_source` 实际为 `source` | 客户端按 doc 访问会得到 undefined | yes | A2 |
| `F-MOD-02` | ❌ | Models | `GET /models` | F6 | `models-d1-unavailable` 不在 `FacadeErrorCodeSchema` 内 | 严格 schema 校验客户端解析失败 | yes | A3 |
| `F-TOD-01` | ❌ | Todos | `POST /sessions/{id}/todos` | F5 | 错误码文档声明 `invalid-status`，代码返回 `invalid-input` | 文档与代码不一致；`invalid-status` 非标准码 | yes | A4 |
| `F-TOD-02` | ❌ | Todos | `PATCH/DELETE /sessions/{id}/todos/{id}` | F5 | 错误码文档声明 `todo-not-found`，代码返回 `not-found` | 文档与代码不一致；`todo-not-found` 非标准码 | yes | A5 |
| `W-MOD-01` | ⚠️ | Models | `PATCH /sessions/{id}/model` | F3 | 503 `worker-misconfigured` 未在 doc 记载 | 文档不完整 | no | A6 |
| `W-TOD-01` | ⚠️ | Todos | `GET /sessions/{id}/todos` | F5 | `?status=any` 未在文档记载 | 文档不完整 | no | A7 |

### 5.2 Finding 详情

#### `F-MOD-01` — `GET /models/{modelIdOrAlias}` 响应形状文档与代码不一致

- **严重级别**：❌ FINDING
- **簇 / 端点**：Models / `GET /models/{modelIdOrAlias}`
- **维度**：F5
- **是否 blocker**：yes
- **事实依据**：
  - `models.md:96-117` — 文档示例显示模型字段直接在 `data` 顶层：`data.model_id`, `data.family`, `data.display_name`…
  - `index.ts:2332-2344` — 代码实际返回：
    ```ts
    {
      ok: true,
      data: {
        requested_model_id: route.modelRef,
        resolved_model_id: resolved.model.model_id,
        resolved_from_alias: resolved.resolved_from_alias,
        model: resolved.model,  // ← 实际模型字段在此
      },
      trace_uuid: traceUuid,
    }
    ```
  - `models-route.test.ts:288-298` — 测试与代码一致，检查 `body.data.model.aliases`。
- **为什么重要**：
  - 文档是前端 SSOT。若客户端按 doc 实现，会直接访问 `data.model_id` 得到 `undefined`。
  - 属于契约背离，违反 HP9 frozen pack "public surface 字段只增不减" 的 backward compat 原则（虽然此处是 doc 写错而非代码删字段，但效果相同）。
- **修法（What + How）**：
  - **改什么**：修正 `models.md` 中 `GET /models/{modelIdOrAlias}` 的 Success (200) 示例。
  - **怎么改**：将示例替换为代码实际返回的形状（含 `requested_model_id`, `resolved_model_id`, `resolved_from_alias`, `model`）。
  - **改完后的形态**：
    ```json
    {
      "ok": true,
      "data": {
        "requested_model_id": "@alias/balanced",
        "resolved_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
        "resolved_from_alias": true,
        "model": {
          "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
          "family": "workers-ai/granite",
          ...
        }
      },
      "trace_uuid": "..."
    }
    ```
  - **测试增量**：无（测试已与代码对齐，只需更新 doc）。
- **建议行动项**：A1
- **复审要点**：确认 doc 更新后，示例中的字段与 `models-route.test.ts:288-298` 断言一致。

#### `F-SES-01` — `GET /sessions/{id}/model` 字段名 `effective_default_source` 实际为 `source`

- **严重级别**：❌ FINDING
- **簇 / 端点**：Models / `GET /sessions/{id}/model`
- **维度**：F5
- **是否 blocker**：yes
- **事实依据**：
  - `models.md:139-154` — 文档声明字段 `effective_default_source` ∈ `{"session", "global"}`。
  - `session-model-route.test.ts:218` — 测试断言 `body.data.source === "global"`。
  - `session-truth.ts:559-589` (`readSessionModelState`) — 返回字段名为 `source`（由测试推断）。
- **为什么重要**：客户端按 doc 访问 `effective_default_source` 会得到 `undefined`。
- **修法（What + How）**：
  - **改什么**：统一字段名。推荐**修改代码**将 `source` 改为 `effective_default_source`，因为后者语义更清晰，且文档已冻结发布。
  - **怎么改**：在 `session-truth.ts:559-589` 的返回对象中，将 `source` 重命名为 `effective_default_source`；同步更新 `session-model-route.test.ts:218`。
  - **改完后的形态**：`data.effective_default_source: "session" | "global"`
  - **测试增量**：更新 `session-model-route.test.ts` 断言字段名。
- **建议行动项**：A2
- **复审要点**：确认 `session-model-route.test.ts` 通过；确认 `PATCH /sessions/{id}/model` 的返回也使用相同字段名（它返回 `nextState`，字段名应一致）。

#### `F-MOD-02` — `models-d1-unavailable` 不在 `FacadeErrorCodeSchema` 内

- **严重级别**：❌ FINDING
- **簇 / 端点**：Models / `GET /models`
- **维度**：F6
- **是否 blocker**：yes
- **事实依据**：
  - `index.ts:2303` — `return jsonPolicyError(503, "models-d1-unavailable", "models lookup failed", traceUuid);`
  - `facade-http.ts:48-90` — `FacadeErrorCodeSchema` 枚举中**无** `models-d1-unavailable`。
  - `jsonPolicyError` 内部将字符串 cast 为 `FacadeErrorCode`（`policy/authority.ts:31-37`），绕过编译期检查。
- **为什么重要**：
  - 违反 `FacadeErrorCodeSchema` 作为 SSOT 的约定。
  - 若客户端运行 schema 校验（如 zod parse），该错误响应会被判定为非法 envelope。
- **修法（What + How）**：
  - **改什么**：将 `models-d1-unavailable` 加入 `FacadeErrorCodeSchema`，或在代码中使用已有的 `worker-misconfigured` / `internal-error`。
  - **推荐方案**：加入 `FacadeErrorCodeSchema`，因为该码已在 doc 中登记且语义明确（D1 不可用 vs worker 配置错误）。
  - **涉及文件**：`packages/orchestrator-auth-contract/src/facade-http.ts`；`docs/api/error-codes.md`（若存在该码需确认）。
  - **测试增量**：在 `facade-http.test.ts` 中增加对该码的编译期/运行期覆盖。
- **建议行动项**：A3
- **复审要点**：确认 TS 编译通过；确认 `error-codes-coverage.test.ts` 通过（若该测试覆盖 facade 码表）。

#### `F-TOD-01` — `POST /sessions/{id}/todos` 错误码文档与代码不一致

- **严重级别**：❌ FINDING
- **簇 / 端点**：Todos / `POST /sessions/{id}/todos`
- **维度**：F5
- **是否 blocker**：yes
- **事实依据**：
  - `todos.md:123` — 文档声明 400 错误码为 `invalid-status`（status 不在 enum 时）。
  - `index.ts:1770-1776` — 代码实际返回 `invalid-input`：
    ```ts
    return jsonPolicyError(400, "invalid-input", `status must be one of ${TODO_STATUSES.join("|")}`, traceUuid);
    ```
  - `FacadeErrorCodeSchema` 中**无** `invalid-status`。
- **为什么重要**：
  - 文档声明了一个不存在的错误码；代码使用的是标准码。
  - 客户端若按 doc 处理 `invalid-status` 会错过实际错误。
- **修法（What + How）**：
  - **改什么**：修正 `todos.md` 文档，将 `invalid-status` 改为 `invalid-input`。
  - **怎么改**：更新 `todos.md:120-124` 的 Errors 表格。
  - **测试增量**：无（测试已与代码对齐）。
- **建议行动项**：A4
- **复审要点**：确认 doc 与 `todo-route.test.ts:188-195` 一致。

#### `F-TOD-02` — Todo 404 错误码文档声明 `todo-not-found`，代码返回 `not-found`

- **严重级别**：❌ FINDING
- **簇 / 端点**：Todos / `PATCH /sessions/{id}/todos/{id}` 与 `DELETE /sessions/{id}/todos/{id}`
- **维度**：F5
- **是否 blocker**：yes
- **事实依据**：
  - `todos.md:173` — PATCH 404 声明 `todo-not-found`。
  - `todos.md:196` — DELETE 404 声明 `todo-not-found`。
  - `index.ts:1859` — PATCH 实际返回 `jsonPolicyError(404, "not-found", "todo not found", traceUuid)`。
  - `index.ts:1887` — DELETE 实际返回 `jsonPolicyError(404, "not-found", "todo not found", traceUuid)`。
  - `FacadeErrorCodeSchema` 中**无** `todo-not-found`，但有 `not-found`。
- **为什么重要**：
  - 文档声明了一个非标准错误码；代码正确使用标准码。
  - 应统一文档与代码，避免客户端实现假错误码。
- **修法（What + How）**：
  - **改什么**：修正 `todos.md`，将 `todo-not-found` 改为 `not-found`。
  - **怎么改**：更新 `todos.md:168-174` 与 `todos.md:192-197` 的 Errors 表格。
  - **测试增量**：可在 `todo-route.test.ts` 中增加对 404 错误码的断言（当前只断言 status）。
- **建议行动项**：A5
- **复审要点**：确认 doc 与代码错误码一致；测试新增断言通过。

---

## 6. 行动建议（按优先级）

> 把 Findings 转成可直接转入 action-plan 的工作项。

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | `F-MOD-01` | Models / `GET /models/{id}` | 修正 doc 响应形状：将模型字段从 `data.*` 改为 `data.model.*`，并补充 `requested_model_id` 等字段 | `clients/api-docs/models.md` | 确认 `models-route.test.ts` 与 doc 一致 | XS |
| **A2** | P0 | `F-SES-01` | Models / `GET /sessions/{id}/model` | 重命名代码字段 `source` → `effective_default_source`；更新测试 | `workers/orchestrator-core/src/session-truth.ts`, `test/session-model-route.test.ts` | `session-model-route.test.ts` 通过 | XS |
| **A3** | P0 | `F-MOD-02` | Models / `GET /models` | 将 `models-d1-unavailable` 加入 `FacadeErrorCodeSchema` 并登记到 error-index | `packages/orchestrator-auth-contract/src/facade-http.ts`, `docs/api/error-codes.md` | `facade-http.test.ts` 通过 | XS |
| **A4** | P0 | `F-TOD-01` | Todos / `POST /sessions/{id}/todos` | 修正 doc 错误码：`invalid-status` → `invalid-input` | `clients/api-docs/todos.md` | 确认 `todo-route.test.ts` 与 doc 一致 | XS |
| **A5** | P0 | `F-TOD-02` | Todos / `PATCH/DELETE /todos/{id}` | 修正 doc 错误码：`todo-not-found` → `not-found`；可选在测试中增加错误码断言 | `clients/api-docs/todos.md`, `test/todo-route.test.ts` | `todo-route.test.ts` 通过 | XS |
| **A6** | P1 | `W-MOD-01` | Models / `PATCH /sessions/{id}/model` | 在 doc 中补充 503 `worker-misconfigured` 场景说明 | `clients/api-docs/models.md` | 无 | XS |
| **A7** | P1 | `W-TOD-01` | Todos / `GET /sessions/{id}/todos` | 在 doc 中补充 `?status=any` 过滤说明 | `clients/api-docs/todos.md` | 无 | XS |

### 6.1 整体修复路径建议

建议将 A1-A5 合并为**一个 PR**（`fix/api-docs-shape-and-code-parity`），因为均为 doc-code 不一致问题，修改面小且无运行时行为变更（A2 除外，但 A2 也是重命名字段）。A6-A7 可作为同一 PR 的附加 commit。

修复顺序：
1. **先修 A2**（代码字段重命名），因为 A2 是唯一需要改代码的项。
2. **再修 A3**（加入 error code schema），因为涉及跨包契约变更。
3. **最后修 A1, A4, A5, A6, A7**（纯文档更新）。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| 无 | — | — | — | — |

---

## 7. 测试覆盖矩阵

### 7.1 端点 × 测试层

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `GET /models` | `models-route.test.ts` | `models-route.test.ts` | `11-rh5-models-image-reasoning.test.mjs` | +401 / +304 / +503 | ✅ |
| `GET /models/{id}` | `models-route.test.ts` | `models-route.test.ts` | 同上 | +400 / +403 / +404 | ✅ |
| `GET /sessions/{id}/model` | `session-model-route.test.ts` | `session-model-route.test.ts` | 间接覆盖 | +404 / +409 | ✅ |
| `PATCH /sessions/{id}/model` | `session-model-route.test.ts` | `session-model-route.test.ts` | 间接覆盖 | +400 / +403 / +404 / +409 | ✅ |
| `GET /sessions/{id}/todos` | `todo-control-plane.test.ts` | `todo-route.test.ts` | 无 | +400 (invalid status) | ✅ |
| `POST /sessions/{id}/todos` | `todo-control-plane.test.ts` | `todo-route.test.ts` | 无 | +400 / +404 / +409 | ✅ |
| `PATCH /sessions/{id}/todos/{id}` | `todo-control-plane.test.ts` | `todo-route.test.ts` | 无 | +400 / +404 / +409 | ✅ |
| `DELETE /sessions/{id}/todos/{id}` | `todo-control-plane.test.ts` | `todo-route.test.ts` | 无 | +404 | ✅ |

### 7.2 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| `GET /models/{id}` | 403 `model-disabled` 路径 | `models-route.test.ts` | — |
| `GET /models/{id}` | 404 `not-found` (alias 不存在) | `models-route.test.ts` | — |
| `GET /sessions/{id}/model` | 409 `conversation-deleted` 路径 | `session-model-route.test.ts` | — |
| `POST /sessions/{id}/todos` | 400 `invalid-input` (content > 2000) | `todo-route.test.ts` | F-TOD-01 |
| `PATCH /sessions/{id}/todos/{id}` | 404 错误码断言 (`not-found`) | `todo-route.test.ts` | F-TOD-02 |
| `DELETE /sessions/{id}/todos/{id}` | 404 错误码断言 (`not-found`) | `todo-route.test.ts` | F-TOD-02 |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | 639-833 | 路由解析 / 调度入口 |
| `workers/orchestrator-core/src/index.ts` | 1078-1133 | Model / Todo 路由解析器 |
| `workers/orchestrator-core/src/index.ts` | 1681-1902 | Todo handler (`handleSessionTodos`) |
| `workers/orchestrator-core/src/index.ts` | 2224-2451 | Model handlers (`handleModelsList`, `handleModelDetail`, `handleSessionModel`) |
| `workers/orchestrator-core/src/todo-control-plane.ts` | 82-295 | Todo CRUD 数据层 |
| `workers/orchestrator-core/src/session-truth.ts` | 411-590 | Model state D1 repo |
| `workers/orchestrator-core/src/auth.ts` | 221-327 | 鉴权 / JWT / device gate |
| `workers/orchestrator-core/src/policy/authority.ts` | 21-52 | `jsonPolicyError` / `readTraceUuid` |
| `workers/orchestrator-core/src/index.ts` | 2946-3011 | `wrapSessionResponse` envelope wrapper |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | 1-219 | FacadeEnvelope / FacadeErrorCodeSchema |
| `packages/nacp-core/src/error-registry.ts` | 1-370 | Unified error registry |
| `packages/nacp-core/src/envelope.ts` | 1-380 | NACP envelope validation (6 layers) |
| `scripts/check-envelope-drift.mjs` | 1-152 | Public envelope drift gate |
| `workers/orchestrator-core/test/models-route.test.ts` | 1-350 | Model route 集成测试 |
| `workers/orchestrator-core/test/session-model-route.test.ts` | 1-326 | Session model route 集成测试 |
| `workers/orchestrator-core/test/todo-route.test.ts` | 1-290 | Todo route 集成测试 |
| `workers/orchestrator-core/test/todo-control-plane.test.ts` | 1-244 | Todo control plane 单元测试 |
| `clients/api-docs/models.md` | 1-240 | 受查文档 — Models |
| `clients/api-docs/todos.md` | 1-222 | 受查文档 — Todos |
| `clients/api-docs/transport-profiles.md` | 1-146 | 受查文档 — Transport Profiles |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**：`same reviewer rereview`
- **二次审查触发条件**：
  - A1-A5 全部 PR merged
  - `pnpm check:envelope-drift` 重新跑过且全绿
  - `workers/orchestrator-core` 测试全绿
- **二次审查应重点核查**：
  1. `models.md` 的 `GET /models/{id}` 示例是否与 `models-route.test.ts` 一致
  2. `session-truth.ts` 返回的 session model state 字段名是否统一为 `effective_default_source`
  3. `FacadeErrorCodeSchema` 是否包含 `models-d1-unavailable`

### 9.3 合规声明前的 blocker

在以下 blocker 全部关闭前，**不得**对外声明本批 API 已 NACP 合规。

1. **F-MOD-01** — 响应形状不一致 — Action `A1`
2. **F-SES-01** — 字段名不一致 — Action `A2`
3. **F-MOD-02** — 错误码不在 schema 内 — Action `A3`
4. **F-TOD-01** — 错误码不一致 — Action `A4`
5. **F-TOD-02** — 错误码不一致 — Action `A5`

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> （当前状态为 `reviewed`，待实现者修复后 append 本节内容。）
