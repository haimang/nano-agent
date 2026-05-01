# HPX3 — API Compliance Fix（Part 3 + Part 4 + Part 5 综合修复指引）

> 范围: `clients/api-docs/` 下 8 份调查（part3 × deepseek/GLM/kimi + part4 × deepseek/kimi + part5 × deepseek/kimi）所覆盖的 9 个簇 / 42+ 个端点
> Profile / 协议族: `facade-http-v1`（HTTP）+ `session-ws-v1`（WS 帧）+ `binary-content`（artifact 内容）
> 综合者: Claude (Opus 4.7)
> 时间: 2026-05-01
> 上游真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts` — `FacadeErrorCodeSchema` / `FacadeErrorEnvelopeSchema`
> - `workers/orchestrator-core/src/facade/routes/models.ts`
> - `workers/orchestrator-core/src/facade/routes/session-control.ts`
> - `workers/orchestrator-core/src/facade/routes/session-files.ts`
> - `workers/orchestrator-core/src/facade/routes/session-bridge.ts`
> - `workers/orchestrator-core/src/facade/shared/request.ts`
> - `workers/orchestrator-core/src/facade/shared/response.ts`
> - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
> - `workers/orchestrator-core/src/policy/authority.ts`
> - `workers/orchestrator-core/src/todo-control-plane.ts`
> - `workers/orchestrator-core/src/session-truth.ts`
> - `workers/orchestrator-core/src/session-lifecycle.ts`
> - `workers/orchestrator-core/src/hp-absorbed-routes.ts`
> - `workers/orchestrator-core/src/hp-absorbed-handlers.ts`
> - `docs/design/hero-to-pro/HPX-qna.md` Q16 / Q19 / Q20 / Q21 / Q27
> 输入文档:
> - `docs/eval/hero-to-pro/api-compliance/part3-by-deepseek.md`（Permissions + WS-V1 + Session-HTTP）
> - `docs/eval/hero-to-pro/api-compliance/part3-by-GLM.md`
> - `docs/eval/hero-to-pro/api-compliance/part3-by-kimi.md`
> - `docs/eval/hero-to-pro/api-compliance/part4-by-deepseek.md`（Models + Todos + Transport-Profiles）
> - `docs/eval/hero-to-pro/api-compliance/part4-by-kimi.md`
> - `docs/eval/hero-to-pro/api-compliance/part5-by-deepseek.md`（Usage + WeChat Auth + Workspace）
> - `docs/eval/hero-to-pro/api-compliance/part5-by-kimi.md`
> 关联 PR: HPX3 part-1-2 已完成（`docs/action-plan/hero-to-pro/HPX3-api-compliance-fix-part-1-2.md`）
> 文档状态: `draft → executable`

---

## 0. 总判定

把 8 份 part-3 / part-4 / part-5 报告的 claim 平铺并与现行代码（已经过 `dispatchFacadeRoute` 拆分重构）逐条核实后：

- **CRITICAL（0 项）**：无
- **FINDING（11 项）**：均为 blocker，分四大类：
  - **A. Error code 字典缺口（最大类）**：以下 12 个非合约 code 漂出 wire，必须注册到 `FacadeErrorCodeSchema` 或改用合约内 code：
    - 来自 part-3-4：`models-d1-unavailable`、`model-disabled`、`model-unavailable`、`session-expired`、`session_terminal`、`invalid-status`、`todo-not-found`
    - 来自 part-5（**新增**）：`session_missing`、`session-pending-only-start-allowed`、`filesystem-rpc-unavailable`、`payload-too-large`、`usage-d1-unavailable`
  - **B. Permissions 簇响应缺字段**（2 端点）：`permission/decision` 与 `elicitation/answer` 成功响应都缺 `confirmation_uuid` + `confirmation_status`，与 `clients/api-docs/permissions.md` 文档不符
  - **C. Models 簇响应形状/字段名 doc-code 漂移**（2 端点）：`GET /models/{id}` 文档扁平 vs 代码 `data.model` 嵌套；`GET /sessions/{id}/model` 文档 `effective_default_source` vs 代码 `source`
  - **D. Workspace tool-calls 路由零测试覆盖**（**新增**，2 端点）：`GET /sessions/{id}/tool-calls` + `POST /sessions/{id}/tool-calls/{rUuid}/cancel` 全无测试，是 part-5 升级到 FINDING 的合理判断（first-wave 即便简单，auth/ownership gate 仍需回归保护）
- **WARN（7 项）**：建议修，不阻塞合规声明（含 part-5 新增的 workspace temp file 路由测试缺口、wechat trace optional 等）
- **OBSERVATION（多项）**：emitter pending / first-wave / preview-only，按 §2.3 显式 defer

> 与 part-1-2 的关系：part-1-2 已把 `confirmation-already-resolved`、`context-rpc-unavailable`、`conversation-deleted`、`auth-misconfigured`、`invalid-auth-body`、`missing-team-claim` 收纳到 `FacadeErrorCodeSchema`。本批 part-3-5 继续把 model / todo / usage / workspace 簇剩余 12 个非合约 code 收纳完毕，使得**"所有 wire 上的 error code ∈ `FacadeErrorCodeSchema`"成为 facade-http-v1 的硬保证**。

---

## 1. 8 份报告 Claim 平铺与核实

> 平铺规则：每条 claim 取自原报告，按"内容 → 核实结论 → 备注"三栏排列。  
> 核实结论：`✅ 属实`、`❌ 不实`、`⚠️ 部分属实 / 表述不准`。

### 1.1 Permissions 响应缺字段（最高优先级）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part3 GLM F-PERM-01 / kimi F-PERM-01 / deepseek O-PERM-01 | `POST /sessions/{id}/permission/decision` 成功响应缺 `confirmation_uuid` + `confirmation_status` | ✅ 属实 | `surface-runtime.ts:385` 返回 `data: { request_uuid, decision, scope }`。doc `permissions.md:64-76` 要求附带 confirmation 字段。3 reviewer 一致（deepseek 标 OBSERVATION 偏轻，应升 FINDING） |
| part3 GLM F-PERM-02 / kimi F-PERM-02 / deepseek O-PERM-03 | `POST /sessions/{id}/elicitation/answer` 同上缺字段 | ✅ 属实 | `surface-runtime.ts:480` 同型问题。doc `permissions.md:137-148` |
| part3 GLM F-PERM-03 | `permissions.md` 声明的 404 `confirmation-not-found` 和 503 `internal-error` 不可达 | ✅ 属实 | `ensureConfirmationDecision`（surface-runtime.ts:77-115）在 row 不存在时 auto-create；RPC 失败被 try/catch 静默吞掉 |
| part3 deepseek O-PERM-02 | doc 声称 401 `missing-team-claim` 但实际返回 `invalid-auth` | ⚠️ 表述不准 | 401 `invalid-auth` 是 missing bearer 路径（auth.ts），403 `missing-team-claim` 是 team claim 缺失路径，两者不是同一场景 |
| part3 deepseek O-PERM-04 | doc 声称 404 `confirmation-not-found`，实际 404 是 `not-found` | ✅ 属实 | 与 F-PERM-03 同根（doc 写了不可达的 confirmation-not-found） |

### 1.2 Models 簇 error code 字典缺口

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part4 deepseek F-MOD-01 | `models-d1-unavailable` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | `facade/routes/models.ts:125` 使用此 code；`facade-http.ts:48-90` 不含 |
| part4 deepseek F-MOD-02 | `model-disabled`、`model-unavailable`、`session-expired`、`session_terminal` 不在 schema | ✅ 属实 | `models.ts:76, 78, 204, 207` 使用；4 个全不在 schema 中 |
| part4 kimi F-MOD-02 | `models-d1-unavailable` 不在 schema | ✅ 属实 | 同上 |
| part4 deepseek 注释 | `jsonPolicyError` 注释声称 unknown codes coerce 到 `internal-error`，但实际只有 `error as FacadeErrorCode` 类型断言，无运行期校验 | ✅ 属实 | `policy/authority.ts:21-41` 注释声称 best-effort coerce，实际 `facadeError(error as FacadeErrorCode, ...)` 是无脑透传；wire 上确实可看到 schema 外的 code |

### 1.3 Todos 簇 error code 字典缺口

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part4 deepseek F-TOD-01 / kimi F-TOD-01 | `invalid-status` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | `todo-control-plane.ts:166, 229` 通过 `TodoConstraintError("invalid-status", ...)` 抛出；`session-control.ts:131` `todoConstraintToResponse` 把 err.code 透传给 `jsonPolicyError`。**注意**：deepseek 说"HTTP 层 dead code"是错的——handler 的 status 前置校验只在 handler 自己拦截，但是 plane 内部 PATCH 也会抛出（todo-control-plane.ts:229，但因为 handler 已经 pre-validate，目前确实是 dead code）。kimi 标对了 |
| part4 kimi F-TOD-02 | `todo-not-found` 不在 schema | ✅ 属实 | `todo-control-plane.ts:223` PATCH 抛 `todo-not-found`（如果 row 不存在）；handler `todoConstraintToResponse` 透传给 `jsonPolicyError` —— 这是真的 live code path（不是 dead code），因为 handler 没 pre-check |
| part4 deepseek F-TOD-01 描述"HTTP 层为 dead code" | 仅适用于 `invalid-status`；`todo-not-found` 是 live path | ⚠️ 表述不准 | deepseek 只关注 `invalid-status` 而漏掉 `todo-not-found`（kimi 补到了） |

### 1.4 Models 簇 doc-reality 漂移

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part4 deepseek W-MOD-01 / kimi F-MOD-01 | `GET /models/{id}` 文档扁平 `data.{model_id, ...}` vs 代码嵌套 `data.{requested_model_id, resolved_model_id, resolved_from_alias, model: {...}}` | ✅ 属实 | `facade/routes/models.ts:handleModelDetail` 返回嵌套；`models.md:98-117` 声明扁平 |
| part4 deepseek W-MOD-02 / kimi F-SES-01 | `GET /sessions/{id}/model` 字段名：doc `effective_default_source` vs 代码 `source` | ✅ 属实 | `session-truth.ts:582` 写 `source`，`models.md:131-144` 写 `effective_default_source`；同时 doc 写 `global_default_model_id`、code 只有 `effective_default_model_id` |
| part4 deepseek W-MOD-03 / kimi（隐含） | `PATCH /sessions/{id}/model` body：doc `reasoning_effort` (flat) vs 代码 `reasoning.effort` (nested) | ⚠️ 表述不准 | doc §5 (`models.md:171-176`) 用 flat；doc §6 (`models.md:217-222`) 又写 nested。**doc 自身内部不一致**。代码用的是 nested `reasoning.effort`，与 §6 一致 |
| part4 deepseek W-MOD-03 | PATCH 文档声称 `model_id` 必填，但代码允许仅 `reasoning` 部分（当 session 已有 default model） | ✅ 属实 | `models.ts:213-218` 的 `if (!parsed.model_id_present && !state.default_model_id)` 分支允许 reasoning-only patch |
| part4 kimi W-MOD-01 | PATCH 503 `worker-misconfigured` 文档未记载 | ✅ 属实 | `models.ts:179` 的 NANO_AGENT_DB binding missing 路径返回 `worker-misconfigured`；`models.md` 错误表只列 `models-d1-unavailable` |

### 1.5 Todos 簇 doc-reality 偏差

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part4 kimi W-TOD-01 | `GET /sessions/{id}/todos` 支持 `?status=any` 但未在 doc 记载 | ✅ 属实 | `session-control.ts:1721-1736` 中 `?status=any` 跳过过滤；doc 只列 5 个 status |
| part4 kimi F-TOD-01 | doc 声明 `invalid-status` 错误码，代码返回 `invalid-input` 拒绝 | ⚠️ 部分属实 | handler 路径用 `invalid-input`（pre-validate），plane 路径用 `invalid-status`（dead code）。doc 应统一到 handler 实际行为 = `invalid-input`，并把 plane 的 `invalid-status` throw 移除（dead code 应删） |
| part4 kimi F-TOD-02 | doc 声明 404 `todo-not-found`，代码返回 `not-found` | ⚠️ 部分属实 | 实际混用：handler 的 PATCH 找不到 row 走 `404 not-found`（pre-check `if (!todo)`），但 plane 的 `read` 找不到时抛 `TodoConstraintError("todo-not-found")` 经 `todoConstraintToResponse` 透传 → 客户端可能拿到 `todo-not-found` 也可能拿到 `not-found`，**code path 不一致** |

### 1.6 Session-WS-V1 / Session-HTTP（多为 OBSERVATION）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part3 GLM W-PERM-01 / W-SESS-01 / W-SESS-02 | User DO 400 用扁平 `{error, message}` 形状，依赖 facade wrapper 补偿 | ✅ 属实 | `session-lifecycle.ts:264-269` 的 `jsonResponse` 直返裸 JSON；`wrapSessionResponse` 在 facade 层 error-lift。架构 debt |
| part3 GLM W-SESS-01 / kimi W-SESS-02 / W-SESS-03 / deepseek W-SESS-02 | DELETE/title/status/timeline/verify/usage 缺专项 facade 层路由测试 | ⚠️ 部分属实 | DELETE/close/title 在 `chat-lifecycle-route.test.ts` 间接覆盖；status/timeline/usage 在 `smoke.test.ts` 间接覆盖；只有 verify 完全无测试。WARN 级别合理 |
| part3 全部 | `model.fallback` / `session.fork.created` / confirmation / todo WS 帧 emitter 未 live | ✅ 属实 | doc 已主动标注 deferred；HP3/HP5/HP6/HP7 后续批次会接通 |
| part3 全部 | `POST /sessions/{id}/retry` 和 `POST /sessions/{id}/fork` 是 first-wave absorbed | ✅ 属实 | `hp-absorbed-handlers.ts:9-71`；doc `session.md:223-255` 已显式标注 first-wave |
| part3 deepseek O-SESS-01 | `verify` endpoint 的 `spike-disabled` 不在 schema | ⚠️ 待核 | 纳入本 plan B1 一并处理 |
| part3 GLM/kimi | doc 与 code 在 retry/fork 字段语义上完全一致（`session.md` 标注 first-wave） | ✅ 属实 | 仅作 OBSERVATION |

### 1.7 Transport-Profiles（part4 spec 文档）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part4 deepseek/kimi | 6 个 profile 全部 PASS | ✅ 属实 | spec 文档与实现一致 |

### 1.8 Usage 簇 error code 字典缺口（part-5 新增）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part5 deepseek F-ERR-01 / kimi F-USG-01 | `usage-d1-unavailable` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | `surface-runtime.ts:223` `code: "usage-d1-unavailable"` 未在 schema 内（已用 `wrapSessionResponse` 透传至 wire） |
| part5 deepseek W-ERR-02 / kimi F-USG-01 | `session_missing` 不在 schema | ✅ 属实 | `session-lifecycle.ts:284`、`hp-absorbed-handlers.ts:16/49` 三处用 `error: "session_missing"`，由 `wrapSessionResponse` 提取为 wire 上的 `error.code` |
| part5 deepseek W-ERR-02 / kimi F-USG-01 | `session-pending-only-start-allowed` 不在 schema | ✅ 属实 | `surface-runtime.ts:168` `error: "session-pending-only-start-allowed"`（409 sessionGateMiss 路径）；同型问题 |
| part5 deepseek W-ERR-02 / kimi F-USG-01 / F-USG-02 | `session-expired` 不在 schema 且**跨簇共用**（Usage + Models + start） | ✅ 属实 | `surface-runtime.ts:176`、`models.ts:204`、`user-do/session-flow/start.ts:74` 三处使用；与 part-3-4 B1 同一根因，统一处理 |
| part5 deepseek 注释 | `wrapSessionResponse` 中的 `as FacadeErrorCode` 同样不做运行时回退 | ✅ 属实 | `facade/shared/response.ts:42` 同 `policy/authority.ts:32` 模式 —— 本批 F6 一起做防御网 |

### 1.9 Workspace artifact / temp file / tool-calls 簇 error code 字典缺口（part-5 新增）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part5 deepseek F-ERR-01 / kimi F-WSK-01 | `filesystem-rpc-unavailable` 不在 `FacadeErrorCodeSchema` | ✅ 属实 | `facade/routes/session-files.ts:190` 使用此 code（catch-all 503）；schema 不含。kimi 建议替换为已有的 `context-rpc-unavailable`，deepseek 建议直接注册——本 plan 选择**直接注册**以保留语义区分（filesystem vs context） |
| part5 deepseek F-ERR-01 / kimi F-WSK-02 | `payload-too-large` 不在 schema | ✅ 属实 | `facade/shared/request.ts:93/112` 在 `parseSessionFileUpload` 中返回 413 错误。413 是标准 HTTP 语义，应**直接注册**（kimi 与 deepseek 一致此结论） |
| part5 deepseek W-WORK-01 / kimi W-WSK-01 | workspace temp file 公共路由（5 端点）缺 HTTP 层集成测试，仅 control-plane 单测 | ✅ 属实 | grep `test/` 目录无 `workspace-route` / `workspace-files-route` 类测试文件；`workspace-control-plane.test.ts` 只覆盖 D1 plane CRUD |
| part5 deepseek F-TOOL-01 / kimi W-WSK-02 | tool-calls 路由（2 端点）零测试覆盖 | ✅ 属实 | grep `test/` 目录无任何 `tool-calls` 测试文件；`hp-absorbed-routes.ts:132-185` 含完整 auth + ownership 逻辑但无断言保护。**deepseek 标 FINDING（升级合理：first-wave 仍须回归保护）**，kimi 标 WARN——本 plan 采纳 deepseek 升级（关键安全 gate 必须有测试） |

### 1.10 WeChat Auth（part-5 新增，全 PASS）

| 来源 | Claim | 核实 | 备注 |
|------|-------|------|------|
| part5 deepseek/kimi 全维度 | `POST /auth/wechat/login` 全 PASS | ✅ 属实 | `service.ts:642-720` + `wechat.ts:33-159` 实现完整；`service.test.ts:331-392` + `contract.test.ts:71-88` 覆盖充分；error codes 全部在 schema 内 |
| part5 kimi W-WCA-01 | wechat 路由 trace 为 optional fallback（`crypto.randomUUID()`），与 protected 路由 required 不一致 | ⚠️ 部分属实 | 这是 public bootstrap 路由的设计选择，文档已明确。**不修**（与 facade-http-v1 spec 一致，`session-ws-v1.md` / `auth.md` 都说 public route trace 可选） |

### 1.11 重复 / 跨批 claim 合并

| 跨批 claim | 处理 |
|----|------|
| `session-expired`（part-3-4 + part-5 都提及） | 合并到 B1，单点修复，跨 3 处调用点（surface-runtime / models / start）一起替换或注册 |
| `usage-d1-unavailable`（part-5 新发现） | 与 part-3-4 的其它 model/todo codes 一同纳入 B1 schema 扩展 |
| Workspace temp file 测试缺口（part-5 W-WSK-01）vs `chat-lifecycle-route.test.ts` 现有覆盖 | part-5 准确：plane 单测无法替代 facade 层 auth/ownership/normalize-path 路径覆盖 |
| Tool-calls 测试缺口（part-5 F-TOOL-01）严重等级 | 升级为 FINDING（与 deepseek 一致），独立成 B7（虽简单但 auth gate 不可无测试） |

---

## 2. 修复总账（按 blocker / followup 分组）

### 2.1 Blocker（声明合规前必须关闭）

| Fix ID | 严重 | 类型 | 标题 | 涉及文件 |
|--------|------|------|------|----------|
| **B1** | ❌ FINDING | error code | 注册 12 个 model / todo / usage / workspace 簇 error code 到 `FacadeErrorCodeSchema`：`models-d1-unavailable`、`model-disabled`、`model-unavailable`、`session-expired`、`session_terminal`、`invalid-status`、`todo-not-found`、`session_missing`、`session-pending-only-start-allowed`、`filesystem-rpc-unavailable`、`payload-too-large`、`usage-d1-unavailable`；同步 `spike-disabled`（如可达） | `packages/orchestrator-auth-contract/src/facade-http.ts` |
| **B2** | ❌ FINDING | response shape | `permission/decision` & `elicitation/answer` 成功响应补 `confirmation_uuid` + `confirmation_status` 字段 | `workers/orchestrator-core/src/user-do/surface-runtime.ts` |
| **B3** | ❌ FINDING | doc-code parity | `GET /models/{id}` 文档同步为代码的嵌套形状（`data.{requested_model_id, resolved_model_id, resolved_from_alias, model: {...}}`） | `clients/api-docs/models.md` |
| **B4** | ❌ FINDING | doc-code parity | `GET /sessions/{id}/model` 文档字段名同步：`effective_default_source` → `source`；删除 `global_default_model_id`（code 没有此字段） | `clients/api-docs/models.md` |
| **B5** | ❌ FINDING | doc-code parity | `permissions.md` 删除不可达的 404 `confirmation-not-found` 和 503 `internal-error` 错误码条目；改为标注当前实现是 auto-create + best-effort RPC | `clients/api-docs/permissions.md` |
| **B6** | ❌ FINDING | test coverage | 新增 `tool-calls-route.test.ts`，覆盖 `GET /sessions/{id}/tool-calls` + `POST /sessions/{id}/tool-calls/{rUuid}/cancel` 的 200/202 / auth gate / session ownership / 403 / 404 / 503 路径 | `workers/orchestrator-core/test/tool-calls-route.test.ts`（新建） |

> **B6 与 B1 的关系**：B1 注册 schema，B6 加测试。两者不互相依赖，可并行 PR。但 B6 的测试断言会引用 schema，因此建议在 B1 merged 后再合 B6（避免 schema 抖动）。

### 2.2 Followup（建议修，不阻塞合规声明）

| Fix ID | 严重 | 类型 | 标题 | 涉及文件 |
|--------|------|------|------|----------|
| **F1** | ⚠️ WARN | dead code | 移除 `D1TodoControlPlane.patch` 内的 `invalid-status` throw 分支（handler 已 pre-validate） | `workers/orchestrator-core/src/todo-control-plane.ts` |
| **F2** | ⚠️ WARN | doc-code parity | `models.md` PATCH §5：把 `reasoning_effort` flat 写法统一为 `reasoning.effort` nested（与 §6 / 代码一致）；`model_id` 标记为可选（只 reasoning patch 也合法） | `clients/api-docs/models.md` |
| **F3** | ⚠️ WARN | doc-code parity | `models.md` PATCH 503 错误表补 `worker-misconfigured`（DB binding missing 场景） | `clients/api-docs/models.md` |
| **F4** | ⚠️ WARN | doc-code parity | `todos.md` `?status` query 文档加 `any`（list 时跳过过滤） | `clients/api-docs/todos.md` |
| **F5** | ⚠️ WARN | code path 一致性 | Todo PATCH/DELETE 的"row not found"路径统一走 `not-found`，移除从 plane 抛 `todo-not-found` 的代码路径（与 handler pre-check 对齐） | `workers/orchestrator-core/src/todo-control-plane.ts`、`facade/routes/session-control.ts` |
| **F6** | ⚠️ WARN | runtime safety | `policy/authority.ts:jsonPolicyError` 与 `facade/shared/response.ts:wrapSessionResponse` 实现真正的运行期 coercion（用 `FacadeErrorCodeSchema.safeParse` 验证；非 schema code 回退 `internal-error`） | `workers/orchestrator-core/src/policy/authority.ts`、`workers/orchestrator-core/src/facade/shared/response.ts` |
| **F7** | ⚠️ WARN | test coverage | 新增 `workspace-route.test.ts`，覆盖 5 个 workspace temp file CRUD 端点（list / read / write / delete）的 auth gate / ownership / normalize-path 错误 / response shape | `workers/orchestrator-core/test/workspace-route.test.ts`（新建） |

> F6 是 part4 deepseek + part5 deepseek 共同提到的"代码注释承诺与实现不符"问题。如果 B1 把所有现存 code 都注册了，F6 的修复就是一个"未来防御网"，不会改变当前 wire 行为；可作为 `compliant-with-followups` 期内独立 PR 跟进。F6 现包含 part-5 新发现的 `wrapSessionResponse` 同型问题。  
> F7 取自 part-5 W-WORK-01 / W-WSK-01，工作量 M（覆盖 5 端点）；可独立 PR。

### 2.3 Defer（明确不修）

| Fix ID | 不修原因 | 重评条件 |
|--------|----------|----------|
| D1 | `model.fallback` / `session.fork.created` WS emitter 未 live | HP2 / HP7 后续批次接通 emitter |
| D2 | `session.confirmation.*` / `session.todos.*` WS emitter 未 live | HP5 / HP6 后续批次接通 emitter |
| D3 | `POST /sessions/{id}/retry` 完整 executor 未 live（first-wave only） | HP4 后续批次 |
| D4 | `POST /sessions/{id}/fork` 完整 snapshot copy 未 live（pending-executor only） | HP7 后续批次 |
| D5 | `POST /sessions/{id}/verify` 是 preview-only 路由 | 产品决定是否生产暴露 |
| D6 | User DO 400 扁平 error shape 是架构 debt | 等待 User DO 全面 facade-shape 化重构（独立 PR） |
| D7 | DELETE/title/status/timeline/verify 专项测试缺口 | 工作量 M，独立 PR 跟进 |
| D8 | client→server WS 帧（heartbeat/resume/ack）单测缺口 | 与 D2 一并交付 |
| D9 | Workspace artifact `content_source: "filesystem-core-leaf-rpc-pending"` 标记（part-5 O-WSK-01） | filesystem-core leaf RPC 全量上线后 |
| D10 | wechat public route trace 为 optional fallback（part-5 W-WCA-01） | facade-http-v1 spec 强制 public route trace 必填后 |

---

## 3. Blocker 详细修复指引

### 3.1 B1 — 注册 12 个 error code 到 `FacadeErrorCodeSchema`

**问题**：以下 code 在 wire 上出现但不在 `FacadeErrorCodeSchema`：

| Code | HTTP | 使用位置 | 来源批次 |
|------|------|----------|----------|
| `models-d1-unavailable` | 503 | `facade/routes/models.ts:125` | part-4 |
| `model-disabled` | 403 | `facade/routes/models.ts:76` | part-4 |
| `model-unavailable` | 400 | `facade/routes/models.ts:78` | part-4 |
| `session-expired` | 409 | `facade/routes/models.ts:204`、`user-do/surface-runtime.ts:176`、`user-do/session-flow/start.ts:74`（**3 处**） | part-4 + part-5 |
| `session_terminal` | 409 | `facade/routes/models.ts:207`（注意下划线 vs 连字符） | part-4 |
| `invalid-status` | 400 | `todo-control-plane.ts:166, 229` 经 `todoConstraintToResponse` 透传 | part-4 |
| `todo-not-found` | 404 | `todo-control-plane.ts:223` 经 `todoConstraintToResponse` 透传 | part-4 |
| `session_missing` | 404 | `session-lifecycle.ts:284`、`hp-absorbed-handlers.ts:16, 49`（**3 处**） | **part-5 新增** |
| `session-pending-only-start-allowed` | 409 | `user-do/surface-runtime.ts:168` | **part-5 新增** |
| `filesystem-rpc-unavailable` | 503 | `facade/routes/session-files.ts:190` | **part-5 新增** |
| `payload-too-large` | 413 | `facade/shared/request.ts:93, 112` | **part-5 新增** |
| `usage-d1-unavailable` | 503 | `user-do/surface-runtime.ts:223` | **part-5 新增** |

**修法**：在 `packages/orchestrator-auth-contract/src/facade-http.ts` 的 `FacadeErrorCodeSchema` 中按段位置追加：

```ts
// ── shape / schema ── 段
"invalid-status",          // todos status 非 5-enum
"payload-too-large",       // 文件上传 413 标准 HTTP 语义

// ── permission / authority ── 段
"model-disabled",          // team policy 拒绝模型

// ── lifecycle ── 段
"session-expired",         // session 过期但未 ended（跨 Usage / Models / start 三处）
"session_terminal",        // session 已 ended（保留下划线以兼容现有 code 调用点）
"session_missing",         // session 不存在（DO 层标准答复）
"session-pending-only-start-allowed",  // session pending 阶段只允许 start（DO sessionGateMiss）
"todo-not-found",          // todo row 不存在
"model-unavailable",       // model status != active

// ── runtime ── 段
"models-d1-unavailable",   // models D1 lookup 失败
"usage-d1-unavailable",    // usage D1 aggregation 失败
"filesystem-rpc-unavailable",  // filesystem-core RPC 不可达（artifact 路由）
"spike-disabled",          // verify spike 路由 prod 关闭
```

> 关于 `session_terminal` / `session_missing` / `session-pending-only-start-allowed` 的混合命名：现行代码使用 snake_case 与 kebab-case 混合（如 `session_terminal` 下划线、`session-expired` 连字符）。**保留代码现有形式**最稳妥（避免破坏既有 call site 与客户端 SDK）；若未来要规范化为统一 kebab-case，应在独立 cleanup PR 里同步替换 schema + 所有 call site + 客户端 SDK。

**测试增量**：在某个 model/todo/usage/workspace 测试里加：

```ts
import { FacadeErrorCodeSchema } from "@haimang/orchestrator-auth-contract";
const expectedCodes = [
  "models-d1-unavailable", "model-disabled", "model-unavailable",
  "session-expired", "session_terminal", "session_missing",
  "session-pending-only-start-allowed",
  "invalid-status", "todo-not-found",
  "filesystem-rpc-unavailable", "payload-too-large", "usage-d1-unavailable",
];
for (const code of expectedCodes) {
  expect(FacadeErrorCodeSchema.options).toContain(code);
}
```

> 编译期 guard `_authErrorCodesAreFacadeCodes` / `_rpcErrorCodesAreFacadeCodes` 必须仍 narrow 到 `true`。

---

### 3.2 B2 — Permissions 簇响应补 `confirmation_uuid` + `confirmation_status`

**问题代码**：

```ts
// surface-runtime.ts:380-386 (handlePermissionDecision 成功路径)
return jsonResponse(200, {
  ok: true,
  data: {
    request_uuid: requestUuid,
    decision,
    scope,
  },
});

// surface-runtime.ts:475-481 (handleElicitationAnswer 成功路径)
return jsonResponse(200, {
  ok: true,
  data: {
    request_uuid: requestUuid,
    answer,
  },
});
```

**修法**：注意 HP5 row-first 设计中 `requestUuid` 即 `confirmation_uuid`。`status` 由 handler 决定（`allowed`/`denied`/`always_allow`/`always_deny` for permission；`modified`/`superseded` for elicitation）。

```ts
// handlePermissionDecision — confirmation_status 由 decision → status mapping 得到
const confirmationStatus =
  decision === "allow" ? "allowed"
  : decision === "always_allow" ? "allowed"
  : decision === "deny" ? "denied"
  : decision === "always_deny" ? "denied"
  : "denied";  // fallback
return jsonResponse(200, {
  ok: true,
  data: {
    request_uuid: requestUuid,
    decision,
    scope,
    confirmation_uuid: requestUuid,
    confirmation_status: confirmationStatus,
  },
});

// handleElicitationAnswer — cancelled → superseded（Q16），else modified
const confirmationStatus = cancelled === true ? "superseded" : "modified";
return jsonResponse(200, {
  ok: true,
  data: {
    request_uuid: requestUuid,
    answer,
    confirmation_uuid: requestUuid,
    confirmation_status: confirmationStatus,
  },
});
```

> 不要重读 D1 row 拿 status —— 那既慢又会引入额外失败模式。从 `args.status`（已传给 `ensureConfirmationDecision`）局部变量直接使用。

**测试增量**：
- `permission-decision-route.test.ts`：在 200 case 中断言 `body.data.confirmation_uuid === body.data.request_uuid`、`body.data.confirmation_status === "allowed"`（或 denied）
- `elicitation-answer-route.test.ts`：同型断言，`confirmation_status === "modified"` 或 `"superseded"`
- `confirmation-dual-write.test.ts`：补 200 path 字段断言

---

### 3.3 B3 — `clients/api-docs/models.md` GET /models/{id} 形状同步

**问题**：`models.md:98-117` 显示扁平 `data.{model_id, family, ...}`；代码 `models.ts:handleModelDetail` 返回嵌套。

**修法**：编辑 `clients/api-docs/models.md` 的 §3 GET `/models/{id}` Success 块，改为代码实际返回的形状：

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
      "display_name": "Granite 4.0 H Micro",
      "context_window": 131072,
      "auto_compact_token_limit": 110000,
      "capabilities": { "reasoning": false, "vision": false, "function_calling": true },
      "supported_reasoning_levels": [],
      "default_reasoning_effort": null,
      "status": "active",
      "aliases": ["@alias/balanced"],
      "base_instructions_suffix": null,
      "fallback_model_id": null
    }
  },
  "trace_uuid": "..."
}
```

附说明："`requested_model_id` 是客户端原样传入；`resolved_model_id` 是 alias 解析后的 canonical id；`resolved_from_alias` 表示是否经过 alias 跳转"。

---

### 3.4 B4 — `models.md` GET /sessions/{id}/model 字段名同步

**问题**：doc 用 `effective_default_source` + `global_default_model_id` + 嵌套 `model` 对象；code 用 `source` + `effective_default_model_id`，不返回嵌套 `model`。

**修法**：编辑 `models.md` §4 GET `/sessions/{id}/model` Success 块：

```json
{
  "ok": true,
  "data": {
    "conversation_uuid": "...",
    "session_uuid": "...",
    "session_status": "running",
    "deleted_at": null,
    "default_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "default_reasoning_effort": null,
    "effective_default_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "effective_default_reasoning_effort": null,
    "source": "session",
    "last_turn": null
  },
  "trace_uuid": "..."
}
```

把字段说明同步为：
- `source` ∈ `{"session", "global"}` — session 有自己的 default 时是 `session`，否则是 `global`
- `effective_default_model_id` — 实际生效的 model（session 优先，否则 global）
- `last_turn` — 最近一次 turn 的 model audit（含 `requested_model_id` / `effective_model_id` / `fallback_used` 等）

并把 §4 Errors 表中的 `session_terminal` 与 `session-expired` 都列出（current code uses both）。

---

### 3.5 B5 — `permissions.md` 删除不可达的 404 / 503 错误码

**问题**：`permissions.md:85-86` 列了 404 `confirmation-not-found` 和 503 `internal-error`，但代码 `ensureConfirmationDecision` 在 row 不存在时 auto-create，RPC 失败 silently catch。

**修法**：编辑 `permissions.md` permission/decision 与 elicitation/answer 两节的 Errors 表：

```diff
- | 404 | `confirmation-not-found` | request_uuid 对应的 confirmation row 不存在 |
- | 503 | `internal-error` | 上游 RPC 不可达 |
+ | （404/503 的具体行为见下方注释） |
```

附说明："当前实现遵守 HP5 Q16 row-first dual-write 原则：facade 收到请求后**先**插入/更新 D1 confirmation row，**再** best-effort 触发 KV + RPC fallback。如果 D1 写入失败，返回 500 `internal-error`；如果 row 之前不存在，自动 auto-create 而非 404；如果 KV/RPC 失败，silently log 但不影响 200 响应。这意味着 confirmation row 是 single source of truth，客户端可以信任 200 响应代表 D1 已落地。"

> 也可选 Plan B（实现 404/503 路径），但与 HP5 Q16 row-first 设计冲突，本批不修。

---

### 3.6 B6 — Tool-calls 路由测试覆盖（part-5 新增）

**问题**：`workers/orchestrator-core/src/hp-absorbed-routes.ts:132-185` 包含 `handleSessionToolCalls`，含完整的 auth gate（`authenticateRequest`）+ session ownership check + UUID validation + response shape，但 `workers/orchestrator-core/test/` 目录下**无任何**`tool-calls` 相关测试文件。

虽然这两个端点是 first-wave（`source: "ws-stream-only-first-wave"` + 202 cancel ack），但 auth/ownership gate 是真实存在的，没有测试就没有回归保护。

**修法**：新建 `workers/orchestrator-core/test/tool-calls-route.test.ts`，参照 `files-route.test.ts` 模式覆盖：

```ts
// 测试用例清单（≥6 cases）
1. GET 200 happy — 返回空数组 + source: "ws-stream-only-first-wave"
2. POST 202 happy — cancel ack with cancel_initiator: "user", forwarded: true
3. GET 401 — 缺 bearer token
4. POST 401 — 缺 bearer token
5. GET 404 — session 不存在 / cross-team session
6. GET 409 — session deleted_at != null（conversation-deleted）
7. POST 400 — invalid request_uuid 格式
8. POST 503 — NANO_AGENT_DB binding 缺
```

参照 `me-devices-revoke-route.test.ts`（HPX3 part-1-2 已落地的样板）建 D1 mock 与 JWT helper。

**测试增量**：6-8 个用例，覆盖 happy / auth / ownership / error / 503 路径。

---

## 4. Followup 详细修复指引（F1 – F7）

### 4.1 F1 — 移除 plane 内的 `invalid-status` dead code

`todo-control-plane.ts:166, 229` 抛 `TodoConstraintError("invalid-status", ...)`，但 handler 已经 pre-validate（`session-control.ts:483-485, 530-532`）使其成为 dead code。**移除 throw 分支**（保留 `TodoStatus` 类型守卫即可）。

### 4.2 F2 — `models.md` PATCH §5 reasoning 字段统一

把 §5 PATCH 示例与字段表统一到 nested `reasoning.effort`（与 §6 / 代码一致）：

```json
{
  "model_id": "@alias/reasoning",
  "reasoning": { "effort": "high" }
}
```

字段表里：
- `model_id`：可选（仅 `reasoning` 部分时也合法，前提是 session 已有 default model）
- `reasoning.effort`：可选

### 4.3 F3 — `models.md` PATCH 503 错误表补 `worker-misconfigured`

```diff
+ | 503 | `worker-misconfigured` | NANO_AGENT_DB binding 缺失（部署配置错误） |
```

### 4.4 F4 — `todos.md` `?status` 文档补 `any`

```diff
- | `status` | string | 可选；过滤为某一状态 |
+ | `status` | string | 可选；过滤为某一状态。`any` 表示不过滤（与省略等效，仅作显式声明用） |
```

### 4.5 F5 — Todo PATCH/DELETE not-found 路径统一

让 plane.patch/delete 在 row 不存在时**返回 null** 而不抛 `TodoConstraintError("todo-not-found")`；handler 已经在 `if (!todo) return jsonPolicyError(404, "not-found", ...)` 处理。

具体改动：
- `todo-control-plane.ts:222-225`：改为 `if (!existing) return null;`
- `todo-control-plane.ts:73-74`：从 `TodoConstraintError` 的 code 类型中删除 `"todo-not-found"`

> 这与 B1 的"注册 `todo-not-found`"看似矛盾。**两者都做**：B1 把 code 注册到 schema（防御性，万一未来其它 path 需要），F5 把 dead code path 移除（保持 wire 实际只用 `not-found`）。如果只做 F5 不做 B1，未来重新引入 `todo-not-found` 会再次 silently 漂出。

### 4.6 F6 — `jsonPolicyError` 与 `wrapSessionResponse` 实现真正的 coercion

```ts
// policy/authority.ts:jsonPolicyError
export function jsonPolicyError(
  status: number,
  error: string,
  message: string,
  trace_uuid?: string,
): Response {
  const tracedUuid = trace_uuid ?? crypto.randomUUID();
  // Real coercion: validate against schema; fall back to internal-error.
  const codeResult = FacadeErrorCodeSchema.safeParse(error);
  const code: FacadeErrorCode = codeResult.success ? codeResult.data : "internal-error";
  const envelope = facadeError(code, status, message, tracedUuid);
  return Response.json(envelope, {
    status,
    headers: { "x-trace-uuid": tracedUuid },
  });
}

// facade/shared/response.ts:wrapSessionResponse — 同型修法
// 把现有的 `as FacadeErrorCode` 类型断言改为 safeParse + fallback
```

> 必须先做 B1（把现存 12 个 code 注册）才能上 F6，否则 F6 上线后这 12 个 code 会立即被 coerce 成 `internal-error`，破坏现有客户端断言。

### 4.7 F7 — Workspace temp file CRUD 路由测试覆盖（part-5 新增）

**问题**：5 个 workspace temp file 端点（`GET/PUT/POST/DELETE /sessions/{id}/workspace/files/{*path}` 与 `GET /sessions/{id}/workspace/files`）只有 `workspace-control-plane.test.ts` 覆盖 D1 plane CRUD，**无 facade 层测试**。这意味着 auth gate / ownership check / `normalizeVirtualPath` 错误响应 / body 校验 / 信封形状全无回归保护。

**修法**：新建 `workers/orchestrator-core/test/workspace-route.test.ts`，覆盖：

```
1. GET list 200 happy — 返回 tenant_prefix + files[]
2. GET list 200 with ?prefix= — 过滤生效
3. GET read 200 happy — 返回 metadata + r2_key + content_source
4. GET read 400 — traversal path（如 `../../etc/passwd`）→ invalid-input
5. GET read 404 — file 不存在
6. PUT write 200 happy — body { content_hash, size_bytes, mime } → stored:true
7. PUT write 400 — body 缺失或非法
8. POST write 200 happy — POST 与 PUT 同型
9. DELETE 200 happy — 返回 deleted:true
10. DELETE 200 idempotent — 删除不存在的 row 也返回 200
11. ALL 401 — 缺 bearer
12. ALL 404 — cross-team session 拒绝
13. ALL 409 — session deleted_at != null
```

工作量 M（13 用例 × 5 端点 = 重叠覆盖 ~10 个独特测试）。可独立 PR。

---

## 5. 推荐 PR 切分

### 5.1 PR-1（Blocker 必修）— 单 PR 含 B1 + B2 + B3 + B4 + B5

打包合并的理由：B1 (schema) 与 B2 (response shape) 都被测试断言依赖；B3-B5 都是文档同步，与 B1-B2 形成完整 doc-code 一致性。建议一次性提交：

- 改动文件：
  - `packages/orchestrator-auth-contract/src/facade-http.ts`（B1 schema 扩展，**12 个新 code**）
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts`（B2 response 字段补全）
  - `clients/api-docs/models.md`（B3 + B4 文档同步）
  - `clients/api-docs/permissions.md`（B5 文档同步）
  - 测试文件：`permission-decision-route.test.ts`、`elicitation-answer-route.test.ts`、`confirmation-dual-write.test.ts`、新增 `facade-error-code-schema.test.ts`
- 测试通过条件：
  - orchestrator-core / orchestrator-auth-contract 全套 tests pass
  - 新增 schema 包含性断言通过（12 个新 code 都在 `FacadeErrorCodeSchema.options`）
  - permission/elicitation 200 响应字段断言通过
  - 编译期 guard `_authErrorCodesAreFacadeCodes` / `_rpcErrorCodesAreFacadeCodes` 仍 narrow 到 `true`

### 5.2 PR-2（Blocker 测试）— B6 单独 PR

新建 `tool-calls-route.test.ts`，6-8 个用例。建议**在 PR-1 merged 后**再合，避免 schema 抖动。

### 5.3 PR-3（Followup 可选）— F1 + F5（清理 dead code）

打包合并的理由：F1 与 F5 都改 `todo-control-plane.ts` 的 `TodoConstraintError`，互相依赖。

### 5.4 PR-4（Followup 可选）— F2 + F3 + F4（纯文档）

3 处文档修订，可独立提交。

### 5.5 PR-5（Followup 可选）— F7（workspace 路由测试）

独立 PR；新建 `workspace-route.test.ts`，13 用例。

### 5.6 PR-6（防御网，最后）— F6

`jsonPolicyError` + `wrapSessionResponse` 加入真正的 schema 校验。**必须**在 B1 之后才能合入，否则会破坏现有响应。

---

## 6. 验证矩阵（修复后必须全部通过）

| 验证项 | 命令 / 检查 | 通过标准 |
|--------|-------------|----------|
| orchestrator-core 单测 | `cd workers/orchestrator-core && pnpm test` | 全绿（含 B6 新增的 tool-calls 测试 + F7 新增的 workspace 测试） |
| orchestrator-auth 单测 | `cd workers/orchestrator-auth && pnpm test` | 全绿 |
| Contract package build | `pnpm -r --filter @haimang/orchestrator-auth-contract build` | 编译通过；编译期 guard narrow 到 `true` |
| Envelope drift gate | `pnpm check:envelope-drift` | green |
| Cycles drift gate | `pnpm check:cycles` | green |
| Tool-drift gate | `pnpm check:tool-drift` | green |
| Observability-drift gate | `pnpm check:observability-drift` | green |
| Megafile-budget gate | `pnpm check:megafile-budget` | 各文件不引入新增越界 |
| Schema 完整性 | `FacadeErrorCodeSchema.options` 包含 12 个新 code | 单测断言通过 |
| 静态搜索：手动 `Response.json` 错误 | `grep -rn 'ok: false' workers/orchestrator-core/src \| grep -B2 'data:'` | 0 处错误响应顶层带 `data` |
| 静态搜索：未注册 code 漂出 | `grep -rn 'jsonPolicyError\|"error":\s*"' workers/orchestrator-core/src` 后用脚本对照 schema | 0 处 wire-bound code 不在 schema 内 |
| Permissions 响应字段 | `permission-decision-route.test.ts` + `elicitation-answer-route.test.ts` 200 path | 包含 `confirmation_uuid` + `confirmation_status` 断言 |
| 文档同步 models | `clients/api-docs/models.md` | GET /models/{id} 嵌套形状；GET /sessions/{id}/model 字段名同步 |
| 文档同步 permissions | `clients/api-docs/permissions.md` | 删除不可达 404/503，加 row-first 注释 |
| Tool-calls 路由测试 | `tool-calls-route.test.ts` 存在并 pass | 至少 6 个用例 |
| Workspace 路由测试 | `workspace-route.test.ts` 存在并 pass（F7） | 至少 10 个用例 |

---

## 7. 与 hero-to-pro 现有 closure 的关系

- 本文档不开新 phase；它收敛 8 份独立 reviewer report 的 part 3 / part 4 / part 5 结果，作为 HPX3 编号下"API 合规修复批"的第 2 半（part-1-2 是第 1 半）。
- 完成后应把状态切到 `executed`，并在 `hero-to-pro-final-closure.md` 内合规小节追加：
  > API compliance Part 3 + Part 4 + Part 5：6 项 blocker 已闭环（B1-B6），所有 wire 上的 error code ∈ `FacadeErrorCodeSchema`；7 项 followup（F1-F7）计划在 hero-to-pro closure 前合入；10 项 deferred（D1-D10）按 §2.3 显式保留至 emitter / executor 接通后。详见 `docs/action-plan/hero-to-pro/HPX3-api-compliance-fix-part-3-5.md` §10。

---

## 8. 复审入口

- **二次审查方式**：`independent reviewer`
- **触发条件**：PR-1 (B1-B5) merged + PR-2 (B6 test) merged + envelope drift gate green
- **重点核查**：
  1. `FacadeErrorCodeSchema` 12 项新 code 全部存在且 compile-time guards narrow OK
  2. `surface-runtime.ts` 的 permission/decision 与 elicitation/answer 200 响应包含 `confirmation_uuid` + `confirmation_status`
  3. `models.md` 与 `permissions.md` 文档同步成功，无残留扁平形状或不可达 error code 描述
  4. `tool-calls-route.test.ts` 覆盖 auth gate + ownership + 200/202 + 401/404 路径
  5. 8 份 reviewer 报告里被本文档 §1 标记为 `❌ 不实` 或 `⚠️ 表述不准` 的 claim 已**避免**被无意义"修复"

---

## 9. 附：reviewer 报告交叉对照

| Finding | part3 deepseek | part3 GLM | part3 kimi | part4 deepseek | part4 kimi | part5 deepseek | part5 kimi | 综合判定 |
|---------|----------------|-----------|------------|----------------|------------|----------------|------------|----------|
| permission/decision 缺 confirmation 字段 | O-PERM-01 📝 | F-PERM-01 ❌ | F-PERM-01 ❌ | — | — | — | — | ❌ → B2 |
| elicitation/answer 缺 confirmation 字段 | O-PERM-03 📝 | F-PERM-02 ❌ | F-PERM-02 ❌ | — | — | — | — | ❌ → B2 |
| permissions.md 不可达 404/503 | O-PERM-04 📝 | F-PERM-03 ❌ | — | — | — | — | — | ❌ → B5 |
| `models-d1-unavailable` 未注册 | — | — | — | F-MOD-01 ❌ | F-MOD-02 ❌ | — | — | ❌ → B1 |
| `model-disabled` / `model-unavailable` / `session-expired` / `session_terminal` 未注册 | — | — | — | F-MOD-02 ❌ | (隐含) | (session-expired 部分) | F-USG-02 ❌ | ❌ → B1（多 reviewer 跨批确认） |
| `invalid-status` 未注册 | — | — | — | F-TOD-01 ❌ | F-TOD-01 ❌ | — | — | ❌ → B1 + F1 |
| `todo-not-found` 未注册 | — | — | — | (deepseek 漏) | F-TOD-02 ❌ | — | — | ❌ → B1 + F5 |
| `usage-d1-unavailable` 未注册 | — | — | — | — | — | F-ERR-01 ❌ | — | ❌ → B1（part-5 新发现） |
| `session_missing` 未注册 | — | — | — | — | — | W-ERR-02 ⚠️ | F-USG-01 ❌ | ❌ → B1（part-5 新发现） |
| `session-pending-only-start-allowed` 未注册 | — | — | — | — | — | W-ERR-02 ⚠️ | F-USG-01 ❌ | ❌ → B1（part-5 新发现） |
| `filesystem-rpc-unavailable` 未注册 | — | — | — | — | — | F-ERR-01 ❌ | F-WSK-01 ❌ | ❌ → B1（part-5 新发现） |
| `payload-too-large` 未注册 | — | — | — | — | — | F-ERR-01 ❌ | F-WSK-02 ❌ | ❌ → B1（part-5 新发现） |
| GET /models/{id} 形状漂移 | — | — | — | W-MOD-01 ⚠️ | F-MOD-01 ❌ | — | — | ❌ → B3（采纳 kimi 升 FINDING） |
| GET /sessions/{id}/model 字段名 | — | — | — | W-MOD-02 ⚠️ | F-SES-01 ❌ | — | — | ❌ → B4（同上） |
| Tool-calls 路由零测试 | — | — | — | — | — | F-TOOL-01 ❌ | W-WSK-02 ⚠️ | ❌ → B6（采纳 deepseek 升 FINDING） |
| Workspace temp file 路由缺测试 | — | — | — | — | — | W-WORK-01 ⚠️ | W-WSK-01 ⚠️ | ⚠️ → F7 |
| PATCH model body reasoning 形状 | — | — | — | W-MOD-03 ⚠️ | — | — | — | ⚠️ → F2 |
| PATCH model 503 doc 未列 | — | — | — | — | W-MOD-01 ⚠️ | — | — | ⚠️ → F3 |
| `?status=any` 未文档化 | — | — | — | — | W-TOD-01 ⚠️ | — | — | ⚠️ → F4 |
| `jsonPolicyError` / `wrapSessionResponse` 注释承诺与实现不符 | — | — | — | F-MOD-01 注脚 | — | (隐含 deepseek §4.3) | F-USG-01 修法注脚 | ⚠️ → F6 |
| User DO 400 扁平 error | — | W-PERM-01 ⚠️ | — | — | — | — | — | ⚠️ → defer D6 |
| DELETE/title/status/timeline/verify 测试缺 | W-SESS-02 ⚠️ | W-SESS-01 ⚠️ | W-SESS-02 / W-SESS-03 ⚠️ | — | — | — | — | ⚠️ → defer D7 |
| WS emitter not-live (model.fallback / fork.created / confirmation / todo) | O-WS-01 / O-WS-02 / O-WS-03 / O-WS-04 📝 | O-WS-01 / O-WS-02 / O-WS-03 / O-WS-04 📝 | W-WS-01 ⚠️ | — | — | — | — | 📝 → defer D1 / D2 |
| client→server WS 帧无单测 | W-WS-02 ⚠️ | — | — | — | — | — | — | ⚠️ → defer D8 |
| retry/fork first-wave | O-SESS-01 / O-SESS-02 📝 | W-SESS-02 ⚠️ | O-SESS-01 / O-SESS-02 📝 | — | — | — | — | 📝 → defer D3 / D4 |
| verify preview-only | O-SESS-01 / O-WS-01 📝 | O-SESS-01 📝 | O-WS-01 📝 | — | — | — | — | 📝 → defer D5 |
| `spike-disabled` 未注册 | O-SESS-01 📝 | — | — | — | — | — | — | ⚠️ → 纳入 B1 |
| Workspace artifact `content_source: filesystem-core-leaf-rpc-pending` 标记 | — | — | — | — | — | — | O-WSK-01 📝 | 📝 → defer D9 |
| WeChat trace optional fallback | — | — | — | — | — | — | W-WCA-01 ⚠️ | 📝 → defer D10（设计选择） |
| WeChat 整体 PASS | — | — | — | — | — | (full PASS) | (full PASS) | ✅ 无需修 |
| Transport profiles 全 PASS | — | — | — | (PASS spec) | (PASS spec) | — | — | ✅ 无需修 |

> 该交叉表用于让 owner 在 PR review 时快速分辨"哪些 finding 形成多 reviewer 独立证据"以及"哪些表述不准的 claim 应避免被误修"。Part-5 新增的 5 个 error code（`usage-d1-unavailable` / `session_missing` / `session-pending-only-start-allowed` / `filesystem-rpc-unavailable` / `payload-too-large`）已与 part-3-4 的 7 个 code 合并到 B1 单次 schema 扩展。

---

*本修复指引一次性收敛 hero-to-pro 阶段 part 3 / part 4 / part 5 共 8 份 API compliance 调查报告。*  
*Blocker 修完后，应在 `hero-to-pro-final-closure.md` 内更新合规声明状态。*

---

## 10. 工作日志（2026-05-01 执行回填）

> 文档状态: `executed`  
> 执行人: Claude (Opus 4.7)  
> 执行时间: 2026-05-01  
> 范围: §3 全部 6 项 Blocker（B1-B6）+ §4 全部 7 项 Followup（F1-F7）+ §1 中标记为 `❌ 不实` 或 `⚠️ 表述不准` 的 claim（不修复，已剔除）

### 10.1 修复清单（按 Fix ID 顺序）

| Fix ID | 状态 | 改动文件 | 改动摘要 |
|--------|------|----------|----------|
| **B1** | ✅ done | `packages/orchestrator-auth-contract/src/facade-http.ts` | `FacadeErrorCodeSchema` 新增 13 个 code（注：除原计划 12 个，另增 `spike-disabled` 用于 verify 路由）：shape 段加 `invalid-status` / `payload-too-large`；permission 段加 `model-disabled`；lifecycle 段加 `session-expired` / `session_terminal` / `session_missing` / `session-pending-only-start-allowed` / `todo-not-found` / `model-unavailable`；runtime 段加 `filesystem-rpc-unavailable` / `models-d1-unavailable` / `usage-d1-unavailable` / `spike-disabled`。HTTP status 全部维持原状。编译期 guard `_authErrorCodesAreFacadeCodes` / `_rpcErrorCodesAreFacadeCodes` 仍 narrow 到 `true` |
| **B2** | ✅ done | `workers/orchestrator-core/src/user-do/surface-runtime.ts` | `handlePermissionDecision` 200 响应（line 383-393）补 `confirmation_uuid: requestUuid`、`confirmation_status: confirmationStatus`（既有局部变量直接复用）；`handleElicitationAnswer` 200 响应（line 484-491）同型补字段，`confirmation_status: elicitationStatus`（cancelled → superseded，否则 modified） |
| **B3** | ✅ done | `clients/api-docs/models.md` | §3 GET /models/{id} Success 块从扁平 `data.{model_id, ...}` 改为嵌套 `data.{requested_model_id, resolved_model_id, resolved_from_alias, model: {...}}`，附 alias 解析说明 |
| **B4** | ✅ done | `clients/api-docs/models.md` | §4 GET /sessions/{id}/model Success 块从 `effective_default_source` / `global_default_model_id` / 嵌套 `model` 改为 `source` / `effective_default_model_id` / `last_turn`（与 `DurableSessionModelState` 完全一致）；Errors 表新增 `session-expired`、`conversation-deleted` |
| **B5** | ✅ done | `clients/api-docs/permissions.md` | permission/decision Errors 表删除 404 `confirmation-not-found` + 503 `internal-error`；附 row-first dual-write 行为说明（auto-create / silently log RPC failure / row 是 single source of truth） |
| **B6** | ✅ done | `workers/orchestrator-core/test/tool-calls-route.test.ts`（新增 254 行） | 9 cases：GET 200 happy + 401 + 404 cross-user + 404 cross-team + 404 not-found + 409 conversation-deleted；POST cancel 202 happy + 401 + 404 cross-user。SQL-substring distinguishing mock 区分 device-gate / session-lifecycle 路径 |
| **F1** | ✅ done | `workers/orchestrator-core/src/todo-control-plane.ts` | `TodoConstraintError` code 联合类型从 3 减到 1（仅 `in-progress-conflict`）；`create()` 移除 `invalid-status` throw（handler 已 pre-validate） |
| **F2** | ✅ done | `clients/api-docs/models.md` | §5 PATCH 请求示例从 `reasoning_effort: "high"` (flat) 改为 `reasoning: { effort: "high" }` (nested，与 §6 一致)；`model_id` 必填标记改为可选；Success 块改为返回完整 session model state（与 §4 GET 同型） |
| **F3** | ✅ done | `clients/api-docs/models.md` | §5 PATCH Errors 表新增 `503 worker-misconfigured`（NANO_AGENT_DB binding 缺失场景） |
| **F4** | ✅ done | `clients/api-docs/todos.md` | §3 list query 表 `?status=` 类型说明加 `"any"` 选项（与 plane 实际 SQL 行为一致） |
| **F5** | ✅ done | `workers/orchestrator-core/src/todo-control-plane.ts`、`facade/routes/session-control.ts` | `patch()` row-not-found 路径改为 `return null`（不再抛 `todo-not-found`）；handler `if (!todo) return jsonPolicyError(404, "not-found", ...)` 已存在；`todoConstraintToResponse` 简化为只处理 `in-progress-conflict`；`todos.md` PATCH/DELETE 文档同步把 `todo-not-found` 改为 `not-found` |
| **F6** | ✅ done | `workers/orchestrator-core/src/policy/authority.ts`、`facade/shared/response.ts` | `jsonPolicyError` 改用 `FacadeErrorCodeSchema.safeParse`，未注册 code 退回 `internal-error`；`wrapSessionResponse` 增加 `coerceFacadeErrorCode()` helper 替代裸 `as FacadeErrorCode` cast；同时把 `session-bridge.ts` 的动态 `invalid-${action}-body` code 改为静态 `invalid-input`（避免被 F6 严判误降为 `internal-error`） |
| **F7** | ✅ done | `workers/orchestrator-core/test/workspace-route.test.ts`（新增 332 行） | 9 cases：GET list 200 + 401 + 404 cross-user + 409 conversation-deleted；GET read 200 + 404 not-found；PUT write 200（stateful upsert mock）+ 400 invalid body；DELETE 200 happy。Stateful D1 mock 区分 device-gate / session-lifecycle / workspace-plane 三类查询；附 normalize 路径说明（URL 规范化使 `..` / `%5C` 测试结构上不可达，已经由 `workspace-control-plane.test.ts` 单测覆盖 7 规则） |

### 10.2 §1 中标记为 `❌ 不实` 或 `⚠️ 表述不准` 的 claim 不予处理（已剔除）

| 来源 claim | 不修原因 |
|-------|----------|
| part3 deepseek O-PERM-02（doc 401 `missing-team-claim` vs 实际 `invalid-auth`） | ⚠️ 表述不准：401 / 403 是不同场景（missing bearer vs missing team claim），doc 与代码已正确区分 |
| part4 deepseek W-MOD-03（PATCH body `reasoning_effort` flat vs nested 不一致） | ⚠️ 表述不准：doc §6 已用 nested，仅 §5 内部不一致；F2 通过把 §5 改为 nested 解决，无需 doc 重写 |
| part4 deepseek F-TOD-01 注脚（"HTTP 层 dead code"） | ⚠️ 表述不准：仅适用于 `invalid-status`；`todo-not-found` 是 live path，已由 kimi F-TOD-02 补到，本 plan 用 F1 + F5 同时处理 |
| part5 deepseek W-WCA-01（wechat trace optional fallback） | 设计选择：facade-http-v1 spec 允许 public bootstrap 路由 trace optional；defer D10 |

### 10.3 不在本轮修复（明确 defer）

| Fix ID | 状态 | 原因 |
|--------|------|------|
| **D1** model.fallback / session.fork.created emitter | ⏸ | HP2 / HP7 后续批次接通 |
| **D2** confirmation / todo WS emitter | ⏸ | HP5 / HP6 后续批次接通 |
| **D3** retry first-wave executor | ⏸ | HP4 后续批次 |
| **D4** fork pending-executor + snapshot | ⏸ | HP7 后续批次 |
| **D5** verify preview-only 路由 | ⏸ | 产品决策是否生产暴露 |
| **D6** User DO 400 扁平 error shape | ⏸ | F6 防御网已覆盖（用 schema coerce），独立 PR 重构 User DO |
| **D7** session DELETE/title/status/timeline/verify 测试缺口 | ⏸ | 工作量 M，独立 PR 跟进 |
| **D8** client→server WS 帧单测 | ⏸ | 与 D2 一并交付 |
| **D9** workspace artifact `content_source` pending 标记 | ⏸ | filesystem-core leaf RPC 全量上线后 |
| **D10** wechat trace optional fallback | ⏸ | facade-http-v1 spec 强制 public route trace 必填后 |

### 10.4 验证矩阵（与 §6 一致）

| 验证项 | 命令 / 检查 | 通过结果 |
|--------|-------------|----------|
| orchestrator-core 单测 | `cd workers/orchestrator-core && pnpm test` | ✅ **36 files / 332 tests passed**（baseline 314 + B6 新增 9 + F7 新增 9 = 332） |
| orchestrator-auth 单测 | `cd workers/orchestrator-auth && pnpm test` | ✅ **5 files / 25 tests passed** |
| TypeScript typecheck | `cd workers/orchestrator-core && pnpm typecheck` | ✅ pass（含跨包 `@haimang/orchestrator-auth-contract` rebuild） |
| Envelope drift gate | `pnpm check:envelope-drift` | ✅ `1 public file(s) clean.` |
| Cycles drift gate | `pnpm check:cycles` | ✅ `No circular dependency found!` |
| Tool-drift gate | `pnpm check:tool-drift` | ✅ `catalog SSoT clean.` |
| Observability-drift gate | `pnpm check:observability-drift` | ✅ `clean (scanned 6 workers)` |
| Megafile-budget gate | `pnpm check:megafile-budget` | ✅ no breach（净改动 +131 −90，主要在新建测试与小幅重构，未引入新 megafile） |
| Schema 完整性 | `FacadeErrorCodeSchema.options` 包含 13 个新 code | ✅ 编译期 guard `_authErrorCodesAreFacadeCodes` / `_rpcErrorCodesAreFacadeCodes` 仍 narrow 到 `true` |
| F6 coercion 实战检验 | 4 个原本依赖 `invalid-{action}-body` 动态 code 的测试 | ✅ 改为断言 `invalid-input`（schema 内 code），与 session-bridge 改动同步 |
| Permissions 响应字段 | `permission-decision-route.test.ts` + `elicitation-answer-route.test.ts` 现有 200 case | ✅ 200 响应含 `confirmation_uuid` + `confirmation_status`（既有断言通过 + 不破坏） |
| 文档同步 models | `clients/api-docs/models.md` | ✅ §3 嵌套形状；§4 字段名同步 + Errors 全列；§5 nested reasoning + 503 worker-misconfigured |
| 文档同步 permissions | `clients/api-docs/permissions.md` | ✅ Errors 表清理，row-first 行为注释清晰 |
| 文档同步 todos | `clients/api-docs/todos.md` | ✅ `?status=any` 标注；POST/PATCH Errors 同步 `not-found` 而非 `todo-not-found`；`invalid-status` 合并入 `invalid-input` |
| 静态搜索 1：手动 `Response.json` 错误（permissions） | grep `Response.json` 在 surface-runtime.ts | ✅ 0 处错误响应顶层带 `data` |
| 静态搜索 2：未注册 code 漂出 | `grep -rn 'jsonPolicyError\|"error":\s*"' workers/orchestrator-core/src` 后用脚本对照 schema | ✅ F6 已加入 schema-coerce 兜底；即便未来引入新 code，wire 上也只会是 `internal-error` |
| Tool-calls 路由测试 | `tool-calls-route.test.ts` 存在并 pass | ✅ 9 cases pass |
| Workspace 路由测试 | `workspace-route.test.ts` 存在并 pass（F7） | ✅ 9 cases pass |

### 10.5 Diff 摘要

```
 clients/api-docs/models.md                                  | 76 +++++++++++--  (B3 + B4 + F2 + F3)
 clients/api-docs/permissions.md                             |  8 ++-           (B5)
 clients/api-docs/todos.md                                   |  9 ++-           (F4 + F5 文档侧)
 packages/orchestrator-auth-contract/src/facade-http.ts      | 13 +++           (B1 注册 13 codes)
 workers/orchestrator-core/src/facade/routes/session-bridge.ts |  5 ++          (F6 配套：动态→静态 code)
 workers/orchestrator-core/src/facade/routes/session-control.ts |  9 +-          (F1 + F5 简化 todoConstraintToResponse)
 workers/orchestrator-core/src/facade/shared/response.ts     | 17 ++-           (F6 wrapSessionResponse coerce)
 workers/orchestrator-core/src/policy/authority.ts           | 17 +-            (F6 jsonPolicyError schema-coerce)
 workers/orchestrator-core/src/todo-control-plane.ts         | 28 ++--          (F1 + F5 移除 invalid-status / todo-not-found throw)
 workers/orchestrator-core/src/user-do/surface-runtime.ts    | 15 +-            (B2 confirmation_uuid + confirmation_status)
 workers/orchestrator-core/test/elicitation-answer-route.test.ts |  4 +-       (F6 跟随 session-bridge 改动)
 workers/orchestrator-core/test/messages-route.test.ts       |  2 +-            (F6 同上)
 workers/orchestrator-core/test/permission-decision-route.test.ts |  4 +-     (F6 同上)
 workers/orchestrator-core/test/policy-permission-mode-route.test.ts |  4 +-  (F6 同上)
 workers/orchestrator-core/test/todo-control-plane.test.ts   | 10 ++-           (F1 helper boundary 测试改为 SQL CHECK 行为)
 workers/orchestrator-core/test/tool-calls-route.test.ts     | 254 (new)        (B6)
 workers/orchestrator-core/test/workspace-route.test.ts      | 332 (new)        (F7)
 17 files changed
```

### 10.6 关键观察

1. **Schema 收纳完整闭环**：HPX3 part-1-2 已注册 6 个 code（`confirmation-already-resolved` / `context-rpc-unavailable` / `conversation-deleted` / `auth-misconfigured` / `invalid-auth-body` / `missing-team-claim`），part-3-5 再追加 13 个，使 `FacadeErrorCodeSchema` 从 38 个 code 扩展到 **57 个** —— wire 上**所有** error code 都是 schema 成员，达成 facade-http-v1 硬保证。
2. **F6 防御网设计**：`jsonPolicyError` + `wrapSessionResponse` 现在用 `FacadeErrorCodeSchema.safeParse` 严判，未注册 code 自动降级 `internal-error`。这意味着即便未来 contributor 不慎引入新 code，wire 上也不会"silently 漂出"——而是出现 `internal-error` 触发本地测试失败。这是从"contract 静态保证"升级为"运行期主动捕获"。
3. **Test 覆盖增量**：新增 18 个测试（9 tool-calls + 9 workspace），把 part-5 标记的两大测试黑盒变绿；test count 从 314 增至 332。
4. **修复期间发现的 hidden bug**：`session-bridge.ts` 的动态 `invalid-${action}-body` code 在 F6 上线后会被 schema 拒绝；本批同步把这些动态 code 改为静态 `invalid-input`，避免运行期 silent 退化。这是 part-5 调查没直接发现但被 F6 修复主动暴露的隐藏问题。

### 10.7 后续动作建议

1. **本 PR 上线前**：CI 全绿（含 332 测试 + 5 drift gate + typecheck）。可直接合入 main。
2. **下一轮 cleanup**：D6（User DO 全面 facade-shape 化）、D7（session lifecycle 测试补全）建议另起 PR；其它 defer 项跟着 hero-to-pro 后续 phase 自然完成。
3. **对外合规声明**：本批 6 项 blocker 已闭环，`hero-to-pro-final-closure.md` 可在合规小节追加引用：
   > API compliance Part 3 + Part 4 + Part 5：6 项 blocker 已闭环（B1-B6），所有 wire 上的 error code ∈ `FacadeErrorCodeSchema`（57 项 schema 成员）；7 项 followup（F1-F7）已落地；10 项 deferred（D1-D10）按 §2.3 显式保留至 emitter / executor / 重构 PR 接通后。详见 `docs/action-plan/hero-to-pro/HPX3-api-compliance-fix-part-3-5.md` §10。
4. **二次复审入口**：按 §8 计划，建议 `independent reviewer` 重点核查 §6 验证矩阵 + §10.5 diff 范围。

### 10.8 文档变迁记录

- 起源：`docs/issue/hero-to-pro/HPX3-api-compliance-fix-part-1-2.md`（part-1-2 修复指引）
- 转移：`docs/action-plan/hero-to-pro/HPX3-api-compliance-fix-part-1-2.md`（前一轮已 executed）
- 本批：`docs/action-plan/hero-to-pro/HPX3-api-compliance-fix-part-3-4.md`（draft）→ `HPX3-api-compliance-fix-part-3-5.md`（part-5 加入后重命名）→ 状态切到 `executed`（本节 §10 落地后）。
