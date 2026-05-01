# Nano-Agent API Compliance 调查报告

> 调查对象: `Usage + WeChat Auth + Workspace`
> 调查类型: `full-surface`
> 调查者: `kimi`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/usage.md`
> - `clients/api-docs/wechat-auth.md`
> - `clients/api-docs/workspace.md`
> Profile / 协议族: `facade-http-v1` (全部簇); `binary-content` (Workspace artifact content)
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts` (FacadeEnvelope / FacadeErrorCodeSchema)
> - `packages/orchestrator-auth-contract/src/auth-error-codes.js`
> - `workers/orchestrator-core/src/index.ts` (dispatchFetch / route parsing)
> - `workers/orchestrator-core/src/auth.ts` (authenticateRequest)
> - `workers/orchestrator-core/src/policy/authority.ts` (jsonPolicyError / readTraceUuid)
> - `workers/orchestrator-core/src/facade/shared/response.ts` (wrapSessionResponse)
> - `workers/orchestrator-core/src/user-do/surface-runtime.ts` (handleUsage / sessionGateMiss)
> - `workers/orchestrator-core/src/hp-absorbed-routes.ts` (workspace / tool-calls handlers)
> - `workers/orchestrator-core/src/facade/routes/session-files.ts` (artifact handlers)
> - `workers/orchestrator-core/src/facade/routes/session-bridge.ts` (route dispatch)
> - `workers/orchestrator-core/src/facade/routes/auth.ts` (wechat login proxy)
> - `workers/orchestrator-auth/src/service.ts` (wechatLogin service)
> - `docs/design/hero-to-pro/HPX-qna.md` Q19 (path law), Q21 (cancel event)
> - `scripts/check-envelope-drift.mjs`
> - `scripts/check-tool-drift.mjs`
> 复用 / 对照的既有审查:
> - `docs/eval/hero-to-pro/api-compliance/part4-by-kimi.md` — 仅作格式与评估方法学参照
> 文档状态: `reviewed`

---

## 0. 总判定 / Executive Summary

本轮 Usage + WeChat Auth + Workspace 调查整体**存在 4 项 FINDING 和 4 项 WARN**，不允许声明 fully-compliant，需先修 FINDING。

- **整体 verdict**：`Usage 功能链路真实可达且测试覆盖核心路径，但存在 3 个错误码不在 FacadeErrorCodeSchema 内；WeChat Auth 功能与测试均合规；Workspace artifact 路由合规，但存在 2 个错误码不在 Schema 内，且 workspace temp file / tool-calls 公共路由缺少 HTTP 层集成测试。`
- **结论等级**：`compliant-with-followups`
- **是否允许声明合规**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `GET /sessions/{id}/usage` 的 404/409 错误响应使用 `session_missing`、`session-pending-only-start-allowed`、`session-expired`，三者均不在 `FacadeErrorCodeSchema` 枚举内，构成 facade-http-v1 契约违约。
  2. `POST /sessions/{id}/files` 的 413 错误码 `payload-too-large` 与 `filesystem-rpc-unavailable` 均不在 `FacadeErrorCodeSchema` 内，构成契约违约。
  3. Workspace temp file 公共 CRUD 路由与 tool-calls 路由当前为 first-wave，虽文档已诚实披露限制，但缺少 HTTP 层集成测试覆盖。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Usage | 1 | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | PARTIAL |
| WeChat Auth | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| Workspace (Artifact) | 3 | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | PARTIAL |
| Workspace (Temp File) | 5 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PARTIAL |
| Workspace (Tool-Calls) | 2 | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | PARTIAL |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 4 | yes |
| ⚠️ WARN     | 4 | no（建议修） |
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
  - `clients/api-docs/usage.md`
  - `clients/api-docs/wechat-auth.md`
  - `clients/api-docs/workspace.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/facade/routes/session-bridge.ts:48-66,86-145` (session route dispatch / usage forwarding)
  - `workers/orchestrator-core/src/facade/routes/session-files.ts:59-200` (artifact handlers)
  - `workers/orchestrator-core/src/facade/routes/auth.ts:21-117` (wechat login proxy)
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:67-317` (workspace / tool-calls handlers)
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:189-239` (handleUsage)
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:164-183` (sessionGateMiss)
  - `workers/orchestrator-core/src/session-lifecycle.ts:282-287` (sessionMissingResponse)
  - `workers/orchestrator-core/src/auth.ts:221-327` (authenticateRequest)
  - `workers/orchestrator-auth/src/service.ts:642-720` (wechatLogin service)
  - `workers/orchestrator-core/src/workspace-control-plane.ts:92-140` (normalizeVirtualPath)
  - `workers/filesystem-core/src/index.ts:319-412` (filesystem-core path law)
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` (FacadeErrorCodeSchema 枚举值)
  - `packages/orchestrator-auth-contract/src/facade-http.ts:126-158` (FacadeEnvelopeSchema)
- **执行过的验证**：
  - `node scripts/check-envelope-drift.mjs` → `1 public file(s) clean` ✅
  - `node scripts/check-tool-drift.mjs` → `catalog SSoT clean` ✅

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行阅读了 facade 路由层、DO runtime、auth service、D1 repo、filesystem-core RPC 实现 |
| 单元 / 集成测试运行 | yes | 阅读了所有相关 test 文件，确认测试代码结构与断言存在；未执行完整 test suite（环境限制） |
| Drift gate 脚本运行 | yes | envelope-drift 与 tool-drift 均 green |
| schema / contract 反向校验 | yes | 将代码中使用的所有 error code 与 FacadeErrorCodeSchema 枚举逐字比对 |
| live / preview / deploy 证据 | no / n/a | 无 live 环境访问权限，依赖代码静态分析 |
| 与上游 design / Q-law 对账 | yes | 核对了 Q19 path law、Q21 cancel event |

### 1.5 跨簇横切观察

- **架构与路由层**：全部簇均经 orchestrator-core `dispatchFacadeRoute` → `tryHandleSessionBridgeRoute` / `tryHandleSessionFilesRoute` / `tryHandleAuthRoute` 分发。Auth 路由优先于 session 路由，避免冲突。
- **Envelope 契约**：全部簇均使用 `facade-http-v1` 的 `{ ok, data?, error?, trace_uuid }` 信封。成功响应由 handler 直接构造或经 `wrapSessionResponse` 注入 trace；错误响应经 `jsonPolicyError` 构造。
- **Auth 模式**：
  - Protected routes（Usage、Workspace）：facade-level `authenticateRequest()` → Bearer JWT 验证 → `team_uuid` / `device_uuid` claim 检查 → device gate（`nano_user_devices` 表 `status=active`）。
  - Public routes（WeChat login）：无 Bearer 要求，但读取 `x-trace-uuid`（fallback `crypto.randomUUID()`）与 optional device headers。
- **Trace 传播**：
  - Protected routes：`authenticateRequest` 强制要求 `x-trace-uuid` header 或 `trace_uuid` query param（400 `invalid-trace`）。
  - Public routes：`readTraceUuid(request) ?? crypto.randomUUID()`，trace 始终存在于响应头 `x-trace-uuid`。
- **NACP authority 翻译**：JWT claim → `IngressAuthSnapshot`（`auth.ts:298-309`），内含 `sub`, `user_uuid`, `team_uuid`, `tenant_uuid`, `device_uuid`, `tenant_source`, `membership_level`, `exp`。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| Usage | `GET /sessions/{id}/usage` | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | FAIL | `session_missing` / `session-pending-only-start-allowed` / `session-expired` 不在 FacadeErrorCodeSchema |
| WeChat Auth | `POST /auth/wechat/login` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Workspace | `GET /sessions/{id}/files` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | FAIL | `filesystem-rpc-unavailable` / `payload-too-large` 不在 FacadeErrorCodeSchema |
| Workspace | `POST /sessions/{id}/files` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | FAIL | 同上 |
| Workspace | `GET /sessions/{id}/files/{uuid}/content` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | FAIL | 同上 |
| Workspace | `GET /sessions/{id}/workspace/files` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无 HTTP 层集成测试 |
| Workspace | `GET /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 同上 |
| Workspace | `PUT/POST /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 同上 |
| Workspace | `DELETE /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 同上 |
| Workspace | `GET /sessions/{id}/tool-calls` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | 无 HTTP 层测试 |
| Workspace | `POST /sessions/{id}/tool-calls/{uuid}/cancel` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | 无 HTTP 层测试 |

---

## 3. 簇级深度分析

### 3.1 簇 — Usage（`clients/api-docs/usage.md`）

#### 3.1.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFacadeRoute()           workers/orchestrator-core/src/index.ts
  → tryHandleSessionBridgeRoute()                     workers/orchestrator-core/src/facade/routes/session-bridge.ts:148
  → parseSessionRoute()                               workers/orchestrator-core/src/facade/routes/session-bridge.ts:35
  → authenticateRequest()                             workers/orchestrator-core/src/auth.ts:221
  → stub.fetch() (User DO internal)                   workers/orchestrator-core/src/facade/routes/session-bridge.ts:128
  → NanoOrchestratorUserDO.fetch()                    workers/orchestrator-core/src/user-do-runtime.ts:502
  → handleUsage()                                     workers/orchestrator-core/src/user-do-runtime.ts:1038
  → surfaceRuntime.handleUsage()                      workers/orchestrator-core/src/user-do/surface-runtime.ts:189
  → ctx.requireReadableSession()                      workers/orchestrator-core/src/user-do/surface-runtime.ts:190
  → D1SessionTruthRepository.readUsageSnapshot()      workers/orchestrator-core/src/session-truth.ts:1834
  → wrapSessionResponse()                             workers/orchestrator-core/src/facade/shared/response.ts:3
```

**链路注记**：`usage`  action 在 `parseSessionRoute` 的 `GET` 白名单内（`session-bridge.ts:48-65`）。DO 层返回的原始响应（含 `ok: true/false` 或裸 `error` 字段）由 `wrapSessionResponse` 在 facade 层统一补 `trace_uuid` 与 `x-trace-uuid` header。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/usage` | ✅ | ✅ | ❌ | ⚠️ | ⚠️ | ❌ | FAIL | `F-USG-01`, `F-USG-02` |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `GET /sessions/{sessionUuid}/usage`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`session-bridge.ts:35-84` → `surface-runtime.ts:189-239` → `session-truth.ts:1834-1879`；行为：构造 zero placeholder → D1 聚合 → 503 严格失败。与文档 §3 Behavior 完全一致。 |
| **F2 测试覆盖** | ✅ | 单测：`workers/orchestrator-core/test/usage-strict-snapshot.test.ts` 覆盖 (a) has-rows 200、(b) no-rows zero-shape 200、(c) D1 失败 503。三 invariant 均有断言。 |
| **F3 形态合规** | ❌ | auth：Bearer + `x-trace-uuid` 强制（`auth.ts:233`）；request：路径参数即可；response：200 形状与 doc 一致。但 **error code 偏离**：文档声明 404 `session_missing`、409 `session-pending-only-start-allowed` / `session-expired`、503 `usage-d1-unavailable`。其中 `usage-d1-unavailable` ✅ 在 `FacadeErrorCodeSchema`，但 `session_missing`、`session-pending-only-start-allowed`、`session-expired` ❌ 均 **不在** Schema 内。 |
| **F4 NACP 合规** | ⚠️ | envelope：`facade-http-v1`（`wrapSessionResponse` 处理）；trace：`x-trace-uuid` 贯通；authority：JWT → `IngressAuthSnapshot`；tenant：`team_uuid` claim 检查 + `requireReadableSession` 所有权 gate。但 **error code 超出 Schema 导致 facade envelope 契约违约**。 |
| **F5 文档一致性** | ⚠️ | 文档 §3 明确列出 `session_missing`、`session-pending-only-start-allowed`、`session-expired` 三个 code，与代码完全一致；但文档未指出这些 code 不在 FacadeErrorCodeSchema 内，造成契约隐式违约。 |
| **F6 SSoT 漂移** | ❌ | `FacadeErrorCodeSchema` 未覆盖 `session_missing`、`session-pending-only-start-allowed`、`session-expired`，与 facade-http-v1 契约漂移。Drift gate 只检查 envelope 结构，不检查 error code 枚举完备性。 |

**关联 finding**：`F-USG-01`, `F-USG-02`

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `wrapSessionResponse` (`response.ts:3`) 对 success/error 均补 `trace_uuid` |
| `x-trace-uuid` 在 response 头里 | ✅ | `response.ts:30, 36, 54` 统一注入 header |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `session_missing`、`session-pending-only-start-allowed`、`session-expired` 不在枚举内 |
| Tenant 边界 5 规则被守住 | ✅ | `requireReadableSession` → `sessionGateMiss` → `sessionMissingResponse` 均按 team/user 过滤 |
| Authority 翻译合法（HTTP claim → server-stamped） | ✅ | `auth.ts:298-309` `IngressAuthSnapshot` 构造；`session-bridge.ts:133` `x-nano-internal-authority` 透传 |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-USG-01` | ❌ | F3/F4 | Usage 404/409 错误码不在 FacadeErrorCodeSchema | 客户端收到的 `code` 值超出契约枚举，强类型解析会失败 |
| `F-USG-02` | ❌ | F6 | `session-expired` 同时在 Usage 与 Models 簇使用，亦不在 Schema | 跨簇共用的 error code 未纳入 SSoT，存在重复违约风险 |

#### 3.1.5 全 PASS 端点简表（合并展示）

无 — 本簇唯一端点未通过。

---

### 3.2 簇 — WeChat Auth（`clients/api-docs/wechat-auth.md`）

#### 3.2.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFacadeRoute()           workers/orchestrator-core/src/index.ts
  → tryHandleAuthRoute()                              workers/orchestrator-core/src/facade/routes/auth.ts:111
  → parseAuthRoute()                                  workers/orchestrator-core/src/facade/routes/auth.ts:21
  → proxyAuthRoute()                                  workers/orchestrator-core/src/facade/routes/auth.ts:37
  → readDeviceMetadata()                              workers/orchestrator-core/src/facade/shared/auth.ts:42
  → ORCHESTRATOR_AUTH.wechatLogin() (RPC)             workers/orchestrator-core/src/facade/routes/auth.ts:94
  → orchestrator-auth/service.wechatLogin()           workers/orchestrator-auth/src/service.ts:642
  → createWeChatClient.exchangeCode()                 workers/orchestrator-auth/src/wechat.ts:33
  → WeChat jscode2session API
  → facadeFromAuthEnvelope()                          packages/orchestrator-auth-contract/src/facade-http.ts:192
```

**链路注记**：`wechatLogin` 为 public bootstrap 路由，facade 层不调用 `authenticateRequest`。Device headers（`x-device-uuid`, `x-device-label`, `x-device-kind`）被读取并合并进 RPC input。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `POST /auth/wechat/login` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 `POST /auth/wechat/login`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`auth.ts:29` → `proxyAuthRoute:94` → `service.ts:642` → `wechat.ts:33` → WeChat API。`encrypted_data`+`iv` 解密、openid 一致性校验、identity bootstrap/reuse 均真实存在。 |
| **F2 测试覆盖** | ✅ | 单测：`workers/orchestrator-auth/test/service.test.ts:331-392` 覆盖 bootstrap & reuse、decrypted display_name、mismatched openid 拒绝。Contract 测试：`packages/orchestrator-auth-contract/test/contract.test.ts:71-88` 验证 `encrypted_data`/`iv` 成对校验。 |
| **F3 形态合规** | ✅ | auth：无 Bearer（public route）；request：`{ code, encrypted_data?, iv?, display_name? }`，`WeChatLoginInputSchema` 在 `orchestrator-auth-contract:152-168` 定义；response：`AuthFlowResult` 形状与 doc 一致；error：`invalid-wechat-code`、`invalid-wechat-payload`、`worker-misconfigured` 均在 `FacadeErrorCodeSchema`。 |
| **F4 NACP 合规** | ✅ | envelope：`facade-http-v1`（`facadeFromAuthEnvelope` 转换）；trace：`x-trace-uuid` optional → fallback `crypto.randomUUID()`，响应带 `x-trace-uuid` header；authority：无（bootstrap）；tenant：新 user bootstrap 时创建新 team，符合多租模型。 |
| **F5 文档一致性** | ✅ | 文档列出的 server-side flow（1-7 步）与代码完全对应。Env 配置表（WECHAT_APPID, WECHAT_SECRET, WECHAT_API_BASE_URL）与 `wechat.ts:43-49` 一致。 |
| **F6 SSoT 漂移** | ✅ | 无 drift。`invalid-wechat-code`、`invalid-wechat-payload` 已在 `FacadeErrorCodeSchema`。Drift gate 全绿。 |

**关联 finding**：无

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `facadeFromAuthEnvelope` (`facade-http.ts:192`) 统一转换 |
| `x-trace-uuid` 在 response 头里 | ✅ | `auth.ts:107` 注入 header |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `invalid-wechat-code`、`invalid-wechat-payload`、`worker-misconfigured` 均在枚举 |
| Tenant 边界 5 规则被守住 | n/a | Bootstrap 路由创建新 tenant，不涉及跨租访问 |
| Authority 翻译合法 | n/a | 无 upstream authority（public route） |

#### 3.2.4 簇级 finding 汇总

无。

#### 3.2.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `POST /auth/wechat/login` | 无异常，public bootstrap 路由，功能与测试均合规 |

---

### 3.3 簇 — Workspace（`clients/api-docs/workspace.md`）

#### 3.3.0 路由轨迹（Route Trace）

**Artifact 路由（Live）：**

```text
Client
  → orchestrator-core/dispatchFacadeRoute()
  → tryHandleSessionFilesRoute()                      workers/orchestrator-core/src/facade/routes/session-files.ts:194
  → parseSessionFilesRoute()                          workers/orchestrator-core/src/facade/routes/session-files.ts:59
  → authenticateRequest()                             workers/orchestrator-core/src/auth.ts:221
  → requireOwnedSession()                             workers/orchestrator-core/src/facade/shared/ownership.ts:5
  → FILESYSTEM_CORE.listArtifacts / writeArtifact / readArtifact (RPC)
  → filesystem-core leaf handlers                      workers/filesystem-core/src/index.ts
```

**Workspace Temp File 路由（First-Wave）：**

```text
Client
  → orchestrator-core/dispatchFacadeRoute()
  → tryHandleSessionBridgeRoute()                     workers/orchestrator-core/src/facade/routes/session-bridge.ts:148
  → parseSessionWorkspaceRoute()                      workers/orchestrator-core/src/hp-absorbed-routes.ts:91
  → handleSessionWorkspace()                          workers/orchestrator-core/src/hp-absorbed-routes.ts:187
  → authenticateRequest()                             workers/orchestrator-core/src/auth.ts:221
  → D1SessionTruthRepository.readSessionLifecycle()   workers/orchestrator-core/src/session-truth.ts
  → D1WorkspaceControlPlane.list / readByPath / upsert / deleteByPath
  → R2 key via buildWorkspaceR2Key()                  workers/orchestrator-core/src/workspace-control-plane.ts:188
```

**Tool-Calls 路由（First-Wave）：**

```text
Client
  → orchestrator-core/dispatchFacadeRoute()
  → tryHandleSessionBridgeRoute()                     workers/orchestrator-core/src/facade/routes/session-bridge.ts:148
  → parseSessionToolCallsRoute()                      workers/orchestrator-core/src/hp-absorbed-routes.ts:67
  → handleSessionToolCalls()                          workers/orchestrator-core/src/hp-absorbed-routes.ts:132
```

#### 3.3.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/files` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | FAIL | `F-WSK-01` |
| `POST /sessions/{id}/files` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | FAIL | `F-WSK-01`, `F-WSK-02` |
| `GET /sessions/{id}/files/{uuid}/content` | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | FAIL | `F-WSK-01` |
| `GET /sessions/{id}/workspace/files` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WSK-01` |
| `GET /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WSK-01` |
| `PUT/POST /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WSK-01` |
| `DELETE /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WSK-01` |
| `GET /sessions/{id}/tool-calls` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | `W-WSK-02` |
| `POST /sessions/{id}/tool-calls/{uuid}/cancel` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | `W-WSK-02` |

#### 3.3.2 端点逐项分析

##### 3.3.2.1 `GET /sessions/{id}/files`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-files.ts:99-116` → `fs.listArtifacts()` RPC。返回 `{ ok: true, data: { files, next_cursor }, trace_uuid }`。功能链路真实。 |
| **F2 测试覆盖** | ✅ | `files-route.test.ts:116-210` 覆盖 happy path、401 missing bearer、403 wrong user、503 missing binding、503 RPC failure。 |
| **F3 形态合规** | ❌ | auth：Bearer + trace；request：`?limit` / `?cursor`；response：200 形状正确。但 catch-all error `filesystem-rpc-unavailable` (`session-files.ts:190`) **不在** `FacadeErrorCodeSchema`。 |
| **F4 NACP 合规** | ✅ | envelope：`facade-http-v1`；trace：header 贯通；authority：JWT → `IngressAuthSnapshot` → `requireOwnedSession` team/user 双检；tenant：`team_uuid` 匹配 session row。 |
| **F5 文档一致性** | ✅ | 文档 §4 列出的响应字段与代码一致。 |
| **F6 SSoT 漂移** | ❌ | `filesystem-rpc-unavailable` 不在 `FacadeErrorCodeSchema`。 |

**关联 finding**：`F-WSK-01`

##### 3.3.2.2 `POST /sessions/{id}/files`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-files.ts:119-149` → `parseSessionFileUpload` → `fs.writeArtifact()` RPC。返回 201 `{ ok: true, data: { file_uuid, ... }, trace_uuid }`。 |
| **F2 测试覆盖** | ✅ | `files-route.test.ts:212-330` 覆盖 happy path、400 invalid content-type、400 missing file field、413 oversize、503 RPC failure。 |
| **F3 形态合规** | ❌ | 413 `payload-too-large` (`request.ts:93,112`) **不在** `FacadeErrorCodeSchema`。`filesystem-rpc-unavailable` 亦不在。 |
| **F4 NACP 合规** | ✅ | 同 `GET /sessions/{id}/files`。 |
| **F5 文档一致性** | ✅ | 文档 §4 列出的 400/413/503 与代码一致。 |
| **F6 SSoT 漂移** | ❌ | `payload-too-large`、`filesystem-rpc-unavailable` 均不在 Schema。 |

**关联 finding**：`F-WSK-01`, `F-WSK-02`

##### 3.3.2.3 `GET /sessions/{id}/files/{fileUuid}/content`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-files.ts:152-177` → `fs.readArtifact()` RPC。返回 `Response` 原始字节，`Content-Type` / `Content-Length` / `Content-Disposition` 正确。Profile 为 `binary-content`。 |
| **F2 测试覆盖** | ✅ | `files-route.test.ts:332-418` 覆盖 happy path、404 not found、403 cross-team。 |
| **F3 形态合规** | ❌ | catch-all error 同样使用 `filesystem-rpc-unavailable`，不在 Schema。 |
| **F4 NACP 合规** | ✅ | 原始字节响应不套 JSON envelope，这是 `binary-content` profile 的预期行为。`x-trace-uuid` header 仍在。 |
| **F5 文档一致性** | ✅ | 文档 §4 明确标注本路由 Profile 为 `binary-content`，与实现一致。 |
| **F6 SSoT 漂移** | ❌ | `filesystem-rpc-unavailable` 不在 Schema。 |

**关联 finding**：`F-WSK-01`

##### 3.3.2.4 `GET /sessions/{id}/workspace/files` (list)

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:215-230` → `D1WorkspaceControlPlane.list()`。返回 `{ ok: true, data: { session_uuid, tenant_prefix, files }, trace_uuid }`。支持 `?prefix=`。 |
| **F2 测试覆盖** | ⚠️ | `workspace-control-plane.test.ts` 覆盖 `D1WorkspaceControlPlane.list()` 单测，但 **无 HTTP 层集成测试** 验证路由解析、auth gate、ownership、响应形状。 |
| **F3 形态合规** | ✅ | auth：Bearer + trace；request：`?prefix`；response：200 形状与 doc §5 一致。error：`invalid-input`（normalize 失败）、`not-found`（session）、`conversation-deleted`（409）均在 Schema。 |
| **F4 NACP 合规** | ✅ | envelope、`x-trace-uuid`、authority 翻译、tenant 边界均合规。 |
| **F5 文档一致性** | ✅ | 文档 §5 诚实标注为 "metadata-first first wave"，与代码一致。 |
| **F6 SSoT 漂移** | ✅ | 无漂移。`invalid-input`、`not-found`、`conversation-deleted` 均在 Schema。 |

**关联 finding**：`W-WSK-01`

##### 3.3.2.5 `GET /sessions/{id}/workspace/files/{*path}` (read)

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:248-269` → `plane.readByPath()`。返回 metadata + canonical `r2_key` + `content_source: "filesystem-core-leaf-rpc-pending"`。 |
| **F2 测试覆盖** | ⚠️ | 同 list，无 HTTP 层集成测试。 |
| **F3 形态合规** | ✅ | normalizeVirtualPath 7-rule 在 `hp-absorbed-routes.ts:234` 执行，非法 path 返 400 `invalid-input`。404 `not-found` 在 Schema。 |
| **F4 NACP 合规** | ✅ | 同上。 |
| **F5 文档一致性** | ✅ | `content_source: "filesystem-core-leaf-rpc-pending"` 与文档 §5 标注一致。 |
| **F6 SSoT 漂移** | ✅ | Q19 path law 在 `normalizeVirtualPath` (`workspace-control-plane.ts:92-140`) 与 `buildWorkspaceR2Key` (`workspace-control-plane.ts:188-193`) 中冻结并执行。 |

**关联 finding**：`W-WSK-01`

##### 3.3.2.6 `PUT/POST /sessions/{id}/workspace/files/{*path}` (write)

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:271-303` → `plane.upsert()`。返回 `{ ok: true, data: { stored: true, r2_key }, trace_uuid }`。 |
| **F2 测试覆盖** | ⚠️ | 无 HTTP 层集成测试。 |
| **F3 形态合规** | ✅ | request body 取 `content_hash`、`size_bytes`、`mime`；400 `invalid-input` 在 Schema。 |
| **F4 NACP 合规** | ✅ | 同上。 |
| **F5 文档一致性** | ✅ | 文档 §5 标注 `stored: true`，与代码一致。 |
| **F6 SSoT 漂移** | ✅ | 同上。 |

**关联 finding**：`W-WSK-01`

##### 3.3.2.7 `DELETE /sessions/{id}/workspace/files/{*path}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:305-316` → `plane.deleteByPath()`。返回 `{ ok: true, data: { deleted: true }, trace_uuid }`。 |
| **F2 测试覆盖** | ⚠️ | 无 HTTP 层集成测试。 |
| **F3 形态合规** | ✅ | 同 read/write。 |
| **F4 NACP 合规** | ✅ | 同上。 |
| **F5 文档一致性** | ✅ | 与文档 §5 一致。 |
| **F6 SSoT 漂移** | ✅ | 同上。 |

**关联 finding**：`W-WSK-01`

##### 3.3.2.8 `GET /sessions/{id}/tool-calls`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:158-170` 返回空数组 + `source: "ws-stream-only-first-wave"`。功能存在但为 stub。 |
| **F2 测试覆盖** | ❌ | **无任何测试** 覆盖此 HTTP 端点。 |
| **F3 形态合规** | ✅ | 200 响应形状与文档一致。 |
| **F4 NACP 合规** | ✅ | envelope、trace、authority 均合规。 |
| **F5 文档一致性** | ✅ | 文档 §5 诚实标注为 first-wave，与代码一致。 |
| **F6 SSoT 漂移** | ✅ | Q21 tool cancel 不走 confirmation plane，与代码一致。 |

**关联 finding**：`W-WSK-02`

##### 3.3.2.9 `POST /sessions/{id}/tool-calls/{request_uuid}/cancel`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:172-184` 返回 202 ack + `forwarded: true`。功能存在但为 stub。 |
| **F2 测试覆盖** | ❌ | **无任何测试** 覆盖此 HTTP 端点。 |
| **F3 形态合规** | ✅ | 202 响应形状与文档一致。 |
| **F4 NACP 合规** | ✅ | 同上。 |
| **F5 文档一致性** | ✅ | 文档 §5 诚实标注为 first-wave，与代码一致。 |
| **F6 SSoT 漂移** | ✅ | 同上。 |

**关联 finding**：`W-WSK-02`

#### 3.3.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | Artifact 路由直接构造 envelope；workspace/tool-calls 路由直接构造 envelope。全部含 `trace_uuid`。 |
| `x-trace-uuid` 在 response 头里 | ✅ | 全部 handler 手动注入 header，或经 `wrapSessionResponse` 注入。 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `filesystem-rpc-unavailable`、`payload-too-large` 不在枚举。 |
| Tenant 边界 5 规则被守住 | ✅ | Artifact 路由：`requireOwnedSession` (`ownership.ts:5`) 检查 team_uuid + actor_user_uuid。Workspace 路由：`ensureSessionOwnedOrError` (`hp-absorbed-routes.ts:31`) Inline 检查。R2 key law：`tenants/{team_uuid}/sessions/{session_uuid}/...`。 |
| Authority 翻译合法 | ✅ | JWT → `IngressAuthSnapshot` → RPC `meta.team_uuid`。filesystem-core 内部 `assertAuthority` (`filesystem-core/src/index.ts:428-432`) 二次校验。 |

#### 3.3.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-WSK-01` | ❌ | F3/F6 | Workspace artifact 错误码 `filesystem-rpc-unavailable` 不在 FacadeErrorCodeSchema | 客户端强类型解析失败，契约违约 |
| `F-WSK-02` | ❌ | F3/F6 | Workspace artifact 413 错误码 `payload-too-large` 不在 FacadeErrorCodeSchema | 同上 |
| `W-WSK-01` | ⚠️ | F2 | Workspace temp file 公共路由缺少 HTTP 层集成测试 | 仅 control-plane 单测，未覆盖 facade auth + ownership + 响应形状 |
| `W-WSK-02` | ⚠️ | F2 | Tool-calls 端点无测试覆盖 | first-wave stub 无断言保护，回归风险高 |

#### 3.3.5 全 PASS 端点简表（合并展示）

无 — 本簇所有端点均带 ⚠️/❌/🔴。

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| Protected (Usage, Workspace) | `Authorization: Bearer <jwt>` | `auth.ts:221` 解析 JWT → `IngressAuthSnapshot` → `x-nano-internal-authority` header (User DO) 或 inline ownership check (workspace) | ✅ |
| Public bootstrap (WeChat login) | 无 | Device headers 透传至 auth service；auth service bootstrap 后签发新 JWT | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| Protected routes | `x-trace-uuid` header | `authenticateRequest` → handler → response header `x-trace-uuid` | required (400 `invalid-trace`) | ✅ |
| Public auth routes | `x-trace-uuid` header (optional) | `readTraceUuid(request) ?? crypto.randomUUID()` → response header | optional | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` 的超集：`✅` (`facade-http.ts:98-101` 编译期 guard)
- `FacadeErrorCodeSchema` 是否为 `RpcErrorCodeSchema` 的超集：`✅` (`facade-http.ts:117-120` 编译期 guard)
- 运行期回退：未知 code → `internal-error` (`facade-http.ts:209-214` `safeParse` fallback)
- **当前问题**：代码中实际使用但未纳入 Schema 的 code 清单：
  - `session_missing`
  - `session-pending-only-start-allowed`
  - `session-expired`
  - `filesystem-rpc-unavailable`
  - `payload-too-large`

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| Usage | `requireReadableSession` → D1 session row team_uuid match | 5/5 | ✅ |
| WeChat login | Bootstrap 创建新 team | n/a | ✅ |
| Artifact CRUD | `requireOwnedSession` + filesystem-core `assertAuthority` | 5/5 | ✅ |
| Workspace temp file | Inline `readSessionLifecycle` team_uuid match | 5/5 | ✅ |
| Tool-calls | Inline `readSessionLifecycle` team_uuid match | 5/5 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `node scripts/check-envelope-drift.mjs` | ✅ green (`1 public file(s) clean`) |
| `node scripts/check-tool-drift.mjs` | ✅ green (`catalog SSoT clean`) |
| `pnpm check:cycles` | n/a (未执行) |
| `pnpm check:megafile` | n/a (未执行) |
| 错误信封 drift（人工核查） | ❌ 发现违例：`session_missing`、`session-pending-only-start-allowed`、`session-expired`、`filesystem-rpc-unavailable`、`payload-too-large` 不在 `FacadeErrorCodeSchema` |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| `F-USG-01` | ❌ | Usage | `GET /sessions/{id}/usage` | F3/F4 | Usage 404/409 错误码不在 FacadeErrorCodeSchema | `session_missing`、`session-pending-only-start-allowed` 均不在枚举，强类型客户端解析失败 | yes | A1 |
| `F-USG-02` | ❌ | Usage | `GET /sessions/{id}/usage` | F6 | `session-expired` 跨簇共用但不在 Schema | Models 端点同样使用，扩大契约违约面 | yes | A1 |
| `F-WSK-01` | ❌ | Workspace | `GET/POST /sessions/{id}/files`, `GET /sessions/{id}/files/{uuid}/content` | F3/F6 | Workspace artifact RPC 错误码不在 Schema | `filesystem-rpc-unavailable` 不在枚举 | yes | A2 |
| `F-WSK-02` | ❌ | Workspace | `POST /sessions/{id}/files` | F3/F6 | 文件上传 413 错误码不在 Schema | `payload-too-large` 不在枚举 | yes | A3 |
| `W-WSK-01` | ⚠️ | Workspace | `GET/PUT/POST/DELETE /sessions/{id}/workspace/files/{*path}` | F2 | Workspace temp file 公共路由缺 HTTP 测试 | 仅 control-plane 单测，facade 层回归无保护 | no | A4 |
| `W-WSK-02` | ⚠️ | Workspace | `GET /sessions/{id}/tool-calls`, `POST /sessions/{id}/tool-calls/{uuid}/cancel` | F2 | Tool-calls 端点零测试覆盖 | first-wave stub 无断言 | no | A5 |
| `W-WCA-01` | ⚠️ | WeChat Auth | `POST /auth/wechat/login` | F4 | Public route trace 为 optional fallback | 虽然 NACP 允许 fallback，但文档示例显示 trace header 存在，建议统一为 required | no | — |
| `O-WSK-01` | 📝 | Workspace | `GET/PUT/POST/DELETE /sessions/{id}/workspace/files/{*path}` | F5 | first-wave 限制已诚实披露 | 文档与代码一致，无需修复 | no | — |

### 5.2 Finding 详情

#### `F-USG-01` — Usage 404/409 错误码不在 FacadeErrorCodeSchema

- **严重级别**：❌ FINDING
- **簇 / 端点**：`Usage / GET /sessions/{id}/usage`
- **维度**：F3 / F4
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:164-183` —— `sessionGateMiss` 返回 `error: "session-pending-only-start-allowed"`（409）与 `sessionMissingResponse`（404）
  - `workers/orchestrator-core/src/session-lifecycle.ts:282-287` —— `sessionMissingResponse` 返回 `error: "session_missing"`
  - `workers/orchestrator-core/src/facade/shared/response.ts:42` —— `wrapSessionResponse` 提取 `errObj.error` 作为 `code`，得到 `"session_missing"` 或 `"session-pending-only-start-allowed"`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` —— `FacadeErrorCodeSchema` 枚举不含以上两值
- **为什么重要**：
  - facade-http-v1 契约要求所有 error code 必须来自 `FacadeErrorCodeSchema`。客户端若基于 Schema 做 exhaustive switch / union type 解析，会遇到未知值导致编译期或运行期失败。
- **修法（What + How）**：
  - **改什么**：将 `session_missing` 替换为 Schema 中已存在的 `not-found`（404）；将 `session-pending-only-start-allowed` 替换为 `session-not-running`（409）或新增 `session-pending-only-start-allowed` 到 Schema。
  - **怎么改**：修改 `sessionMissingResponse` 与 `sessionGateMiss` 的 error 字段值；同步修改 `wrapSessionResponse` 中的提取逻辑（若需要）。
  - **改完后的形态**：404 `{ ok: false, error: { code: "not-found", status: 404, message: "..." }, trace_uuid }`；409 `{ ok: false, error: { code: "session-not-running", ... }, trace_uuid }`
  - **测试增量**：在 `usage-strict-snapshot.test.ts` 中补 404/409 facade envelope 断言，验证 `error.code` 在 Schema 内。
- **建议行动项**：A1
- **复审要点**：确认 `not-found` 与 `session-not-running` 在 Schema 内；确认所有调用 `sessionMissingResponse` / `sessionGateMiss` 的端点行为一致。

#### `F-USG-02` — `session-expired` 跨簇共用但不在 FacadeErrorCodeSchema

- **严重级别**：❌ FINDING
- **簇 / 端点**：`Usage / GET /sessions/{id}/usage`（亦影响 Models）
- **维度**：F6
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:175-180` —— `sessionGateMiss` 返回 `error: "session-expired"`
  - `workers/orchestrator-core/src/facade/routes/models.ts:204` —— Models 端点同样使用 `session-expired`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` —— 枚举不含 `session-expired`
- **为什么重要**：跨簇共用的 error code 若不在 Schema 内，影响面大于单簇。
- **修法（What + How）**：
  - **改什么**：将 `session-expired` 替换为 Schema 中已有的 `session-already-ended`（语义接近），或新增 `session-expired` 到 `FacadeErrorCodeSchema`。
  - **怎么改**：修改 `surface-runtime.ts:176` 与 `models.ts:204` 的 code 值；若新增 Schema 值，需同步运行 drift gate。
  - **改完后的形态**：409 `{ ok: false, error: { code: "session-already-ended", status: 409, message: "..." }, trace_uuid }`
  - **测试增量**：补 Models 与 Usage 的 409 断言。
- **建议行动项**：A1（可与 F-USG-01 合并修复）
- **复审要点**：确认跨所有使用 `session-expired` 的端点均已替换。

#### `F-WSK-01` — Workspace artifact RPC 错误码 `filesystem-rpc-unavailable` 不在 FacadeErrorCodeSchema

- **严重级别**：❌ FINDING
- **簇 / 端点**：`Workspace / GET/POST /sessions/{id}/files`, `GET /sessions/{id}/files/{uuid}/content`
- **维度**：F3 / F6
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/facade/routes/session-files.ts:190` —— catch-all error 返回 `code: "filesystem-rpc-unavailable"`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` —— 枚举不含该值
- **为什么重要**：Artifact 路由为 live 路由，客户端会实际遇到此错误码。
- **修法（What + How）**：
  - **改什么**：将 `filesystem-rpc-unavailable` 替换为 Schema 中已有的 `context-rpc-unavailable`（语义一致：下游 RPC 不可用），或新增 `filesystem-rpc-unavailable` 到 Schema。
  - **怎么改**：修改 `session-files.ts:190` 的 code 字符串。
  - **改完后的形态**：503 `{ ok: false, error: { code: "context-rpc-unavailable", status: 503, message: "..." }, trace_uuid }`
  - **测试增量**：在 `files-route.test.ts` 中更新 503 断言的 expected code。
- **建议行动项**：A2
- **复审要点**：确认 `context-rpc-unavailable` 在 Schema 内；确认测试断言同步更新。

#### `F-WSK-02` — 文件上传 413 错误码 `payload-too-large` 不在 FacadeErrorCodeSchema

- **严重级别**：❌ FINDING
- **簇 / 端点**：`Workspace / POST /sessions/{id}/files`
- **维度**：F3 / F6
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/facade/shared/request.ts:93,112` —— `parseSessionFileUpload` 返回 `code: "payload-too-large"`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` —— 枚举不含该值
- **为什么重要**：413 是客户端可恢复错误，需有稳定 code。
- **修法（What + How）**：
  - **改什么**：新增 `payload-too-large` 到 `FacadeErrorCodeSchema`，或替换为已有 code（如 `invalid-input`，但语义不准）。**推荐新增**，因为 413 是标准 HTTP 语义。
  - **怎么改**：在 `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` 的 z.enum 数组中加入 `"payload-too-large"`；修改 `request.ts` 若需调整。
  - **改完后的形态**：413 `{ ok: false, error: { code: "payload-too-large", status: 413, message: "..." }, trace_uuid }`
  - **测试增量**：`files-route.test.ts` 中更新 413 断言。
- **建议行动项**：A3
- **复审要点**：确认 Schema 编译通过；确认新增 code 未破坏 `_rpcErrorCodesAreFacadeCodes` guard。

#### `W-WSK-01` — Workspace temp file 公共路由缺 HTTP 层集成测试

- **严重级别**：⚠️ WARN
- **簇 / 端点**：`Workspace / GET/PUT/POST/DELETE /sessions/{id}/workspace/files/{*path}`
- **维度**：F2
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-core/test/workspace-control-plane.test.ts` 覆盖 `D1WorkspaceControlPlane` CRUD 与 `normalizeVirtualPath`
  - 无测试文件覆盖 `hp-absorbed-routes.ts` 中的 `handleSessionWorkspace` HTTP handler
- **修法**：
  - 新建 `workers/orchestrator-core/test/workspace-route.test.ts`，参照 `files-route.test.ts` 模式，mock `NANO_AGENT_DB` 与 JWT，测试：
    - 200 list / read / write / delete happy path
    - 400 invalid path
    - 404 session not found / cross-team
    - 409 conversation-deleted
    - 401 missing bearer
- **建议行动项**：A4

#### `W-WSK-02` — Tool-calls 端点零测试覆盖

- **严重级别**：⚠️ WARN
- **簇 / 端点**：`Workspace / GET /sessions/{id}/tool-calls`, `POST /sessions/{id}/tool-calls/{uuid}/cancel`
- **维度**：F2
- **是否 blocker**：no
- **事实依据**：
  - 全局 grep 未找到 `tool-calls` 相关 `.test.ts` 文件
  - `hp-absorbed-routes.ts:158-184` 为 stub 实现，无断言保护
- **修法**：
  - 新建 `workers/orchestrator-core/test/tool-calls-route.test.ts`，测试：
    - 200 list 返回空数组 + `source: "ws-stream-only-first-wave"`
    - 202 cancel ack + `forwarded: true`
    - 401/404/409 error paths
- **建议行动项**：A5

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | `F-USG-01`, `F-USG-02` | Usage / `GET /sessions/{id}/usage` | 将 `session_missing` → `not-found`，`session-pending-only-start-allowed` → `session-not-running`，`session-expired` → `session-already-ended`；同步修改所有调用点 | `session-lifecycle.ts`, `surface-runtime.ts`, `models.ts` | 更新 `usage-strict-snapshot.test.ts` 与 Models 测试 | S |
| **A2** | P0 | `F-WSK-01` | Workspace / Artifact CRUD | 将 `filesystem-rpc-unavailable` → `context-rpc-unavailable` | `session-files.ts` | 更新 `files-route.test.ts` 503 断言 | XS |
| **A3** | P0 | `F-WSK-02` | Workspace / `POST /sessions/{id}/files` | 将 `payload-too-large` 加入 `FacadeErrorCodeSchema` | `packages/orchestrator-auth-contract/src/facade-http.ts` | 更新 `files-route.test.ts` 413 断言 | XS |
| **A4** | P1 | `W-WSK-01` | Workspace / Temp File CRUD | 补 HTTP 层集成测试 | 新建 `workspace-route.test.ts` | 覆盖 happy path + 400/401/404/409 | M |
| **A5** | P1 | `W-WSK-02` | Workspace / Tool-Calls | 补 HTTP 层集成测试 | 新建 `tool-calls-route.test.ts` | 覆盖 200/202 + error paths | S |

### 6.1 整体修复路径建议

建议按 **A1 → A2 → A3 → A4/A5** 顺序修复：
1. 先修 error code（A1-A3），因为它们是契约违约，阻塞合规声明。A1 影响多个文件，建议单独一个 PR。
2. A2 与 A3 可合并为一个 PR（Workspace error code 修复）。
3. A4 与 A5 为测试补全，可合并为一个 PR（Workspace test coverage）。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| `O-WSK-01` | first-wave 已知限制，文档已披露 | filesystem-core leaf RPC 全量上线后 | TBD | HP9 |
| `W-WCA-01` | public route trace fallback 为设计选择，不阻塞 | 若 NACP 规范强制要求 public route trace 必填 | TBD | — |

---

## 7. 测试覆盖矩阵

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `GET /sessions/{id}/usage` | `usage-strict-snapshot.test.ts` (DO 层) | — | — | 200+zero / 503 | ⚠️ |
| `POST /auth/wechat/login` | `service.test.ts` (auth service) | — | — | 200 / 400 `invalid-wechat-payload` | ✅ |
| `GET /sessions/{id}/files` | — | `files-route.test.ts` | — | 200 / 401 / 403 / 503 | ✅ |
| `POST /sessions/{id}/files` | — | `files-route.test.ts` | — | 200 / 400 / 413 / 503 | ✅ |
| `GET /sessions/{id}/files/{uuid}/content` | — | `files-route.test.ts` | — | 200 / 404 / 403 | ✅ |
| `GET /sessions/{id}/workspace/files` | `workspace-control-plane.test.ts` (plane) | — | — | happy path (plane) | ⚠️ |
| `GET/PUT/POST/DELETE /sessions/{id}/workspace/files/{*path}` | `workspace-control-plane.test.ts` (plane) | — | — | 400 normalize (plane) | ⚠️ |
| `GET /sessions/{id}/tool-calls` | — | — | — | — | ❌ |
| `POST /sessions/{id}/tool-calls/{uuid}/cancel` | — | — | — | — | ❌ |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| `GET /sessions/{id}/usage` | Facade 层 401/403/404/409 集成测试 | `usage-route.test.ts` (新建) | `W-USG-01` |
| `GET/PUT/POST/DELETE /sessions/{id}/workspace/files/{*path}` | HTTP handler 集成测试（auth + ownership + 响应形状） | `workspace-route.test.ts` (新建) | `W-WSK-01` |
| `GET /sessions/{id}/tool-calls` | HTTP handler 任何测试 | `tool-calls-route.test.ts` (新建) | `W-WSK-02` |
| `POST /sessions/{id}/tool-calls/{uuid}/cancel` | HTTP handler 任何测试 | `tool-calls-route.test.ts` (新建) | `W-WSK-02` |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/facade/routes/session-bridge.ts` | `1-170` | Session 路由分发（含 usage forwarding / workspace / tool-calls dispatch） |
| `workers/orchestrator-core/src/facade/routes/session-files.ts` | `1-200` | Artifact 路由 handler（list / upload / content） |
| `workers/orchestrator-core/src/facade/routes/auth.ts` | `1-117` | Auth 路由 proxy（含 wechat login） |
| `workers/orchestrator-core/src/hp-absorbed-routes.ts` | `1-317` | Workspace temp file + tool-calls handler |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | `164-239` | Usage handler + sessionGateMiss |
| `workers/orchestrator-core/src/session-lifecycle.ts` | `282-287` | sessionMissingResponse |
| `workers/orchestrator-core/src/auth.ts` | `221-327` | authenticateRequest |
| `workers/orchestrator-core/src/facade/shared/response.ts` | `1-56` | wrapSessionResponse |
| `workers/orchestrator-core/src/facade/shared/request.ts` | `70-120` | parseSessionFileUpload（含 payload-too-large） |
| `workers/orchestrator-core/src/workspace-control-plane.ts` | `78-193` | normalizeVirtualPath + buildWorkspaceR2Key |
| `workers/orchestrator-auth/src/service.ts` | `642-720` | wechatLogin service |
| `workers/orchestrator-auth/src/wechat.ts` | `33-98` | WeChat client（exchangeCode / decryptProfile） |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | `48-90, 126-158` | FacadeErrorCodeSchema + FacadeEnvelopeSchema |
| `workers/orchestrator-core/test/usage-strict-snapshot.test.ts` | `1-138` | Usage DO 层测试 |
| `workers/orchestrator-core/test/files-route.test.ts` | `1-418` | Artifact HTTP 路由测试 |
| `workers/orchestrator-core/test/workspace-control-plane.test.ts` | `1-320` | Workspace control plane 单测 |
| `workers/orchestrator-auth/test/service.test.ts` | `331-392` | WeChat auth service 测试 |
| `clients/api-docs/usage.md` | `1-125` | Usage API 文档 |
| `clients/api-docs/wechat-auth.md` | `1-119` | WeChat Auth API 文档 |
| `clients/api-docs/workspace.md` | `1-173` | Workspace API 文档 |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**：`same reviewer rereview`（kimi）
- **二次审查触发条件**：
  - A1 PR merged（error code 修复）
  - A2/A3 PR merged（Workspace error code 修复）
  - `node scripts/check-envelope-drift.mjs` 重新跑过且全绿
- **二次审查应重点核查**：
  1. 所有修改后的 error code 均在 `FacadeErrorCodeSchema` 内（编译期 guard 通过）
  2. 测试断言中的 expected code 已同步更新
  3. 无新增裸 `error` 字段响应（全部经 `jsonPolicyError` 或 `facadeError` 构造）

### 9.3 合规声明前的 blocker

在以下 blocker 全部关闭前，**不得**对外声明本批 API 已 NACP 合规。

1. `session_missing` / `session-pending-only-start-allowed` / `session-expired` 替换为 Schema 内 code — Finding `F-USG-01`, `F-USG-02` —— Action `A1`
2. `filesystem-rpc-unavailable` 替换为 Schema 内 code — Finding `F-WSK-01` —— Action `A2`
3. `payload-too-large` 纳入 `FacadeErrorCodeSchema` — Finding `F-WSK-02` —— Action `A3`

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> 文档状态切到 `changes-requested` 后，实现者把修复结论 append 在这一节，按 Finding ID 一条一条回。

### 10.1 回应汇总表

| Finding ID | 处理结果 | PR / Commit | 验证证据 | reviewer 复核结论 |
|------------|----------|-------------|----------|-------------------|
| | | | | |

### 10.2 逐条回应

> （待实现者回应后展开）
