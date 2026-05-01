# Nano-Agent API Compliance 调查报告 — Part 5 (Usage / WeChat Auth / Workspace)

> 调查对象: `Usage + WeChat Auth + Workspace`（3 个 API 文档簇）
> 调查类型: `initial`
> 调查者: `deepseek (auto)`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/usage.md`
> - `clients/api-docs/wechat-auth.md`
> - `clients/api-docs/workspace.md`
> Profile / 协议族: `facade-http-v1`（部分路由使用 `binary-content`）
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts` — FacadeErrorCodeSchema
> - `clients/api-docs/transport-profiles.md` — 6 种 profile 定义
> - `docs/design/hero-to-pro/HPX-qna.md` — Q19 (path law), Q21 (cancel event), Q27 (FacadeEnvelope)
> - `scripts/check-envelope-drift.mjs` — root drift gate
> 复用 / 对照的既有审查:
> - `docs/eval/hero-to-pro/api-compliance/part1-by-deepseek.md` — 仅作线索（Auth cluster 已有 wechat login 分析，本轮独立复核）
> 文档状态: `draft`

---

## 0. 总判定 / Executive Summary

- **整体 verdict**：本轮 Usage + WeChat Auth + Workspace 调查整体合规，但发现 **1 项 FINDING**（FacadeErrorCodeSchema 缺失 3 个已用 error code）和 **3 项 WARN**（tool-calls/workspace 路由缺少测试覆盖、DO 内部 error code 未注册）。不允许声明 fully-compliant，需先修 FINDING。
- **结论等级**：`partial-compliance`
- **是否允许声明合规**：`no`
- **本轮最关键的 1-3 个判断**：
  1. ❌ 3 个在生产代码中使用的 error code（`filesystem-rpc-unavailable`、`usage-d1-unavailable`、`payload-too-large`）未在 `FacadeErrorCodeSchema` 注册，破坏 canonical taxonomy 的 SSOT 地位。
  2. ⚠️ tool-calls（`GET/POST`）路由零测试覆盖；workspace file CRUD 路由缺少 handler 级集成测试（仅 control-plane 单测存在）。
  3. ⚠️ DO 内部 error code（`session-pending-only-start-allowed`、`session-expired`、`session_missing`）尚未注册到 `FacadeErrorCodeSchema`。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Usage | 1 | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | PARTIAL |
| WeChat Auth | 1 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| Workspace | 10 | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | ✅ | PARTIAL |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 1 | yes |
| ⚠️ WARN     | 3 | no（建议修） |
| 📝 OBSERVATION | 0 | — |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性 | 路由→实现是否真实成链？ | route → handler → backing repo / RPC 全链路可达 |
| **F2** | 测试覆盖 | 是否有测试覆盖？ | 单测 + 集成 + E2E 任一层有断言 |
| **F3** | 形态合规 | 请求/响应/错误形态、auth gate、status code 是否与契约对齐？ | request/response 满足 schema；auth 行为与 doc 同；error code 在 FacadeErrorCodeSchema 内 |
| **F4** | NACP 协议合规 | envelope、authority、trace、tenant boundary、error code 是否合规？ | 信封正族；trace 贯通；authority 翻译合法；error code 注册 |
| **F5** | 文档一致性 | 文档写的与代码做的是否一致？ | 无 doc-code 不一致 |
| **F6** | SSoT 漂移 | 是否触发 drift gate？是否与 frozen contract 一致？ | 无背离 |

### 1.2 严重级别定义

| 级别 | 标记 | 定义 | 处置 |
|------|------|------|------|
| **CRITICAL** | 🔴 | 破坏正确性、安全、契约或会让客户端解析失败 | **必须修复** |
| **FINDING** | ❌ | 行为偏离，影响协议合规 / 客户端兼容 / SSOT 完备性 | **应修复** |
| **WARN** | ⚠️ | 轻微偏差、测试缺口、代码异味 | 建议修复 |
| **OBSERVATION** | 📝 | 已知未实现、设计选择、未来工作 | 仅记录 |

### 1.3 已核实的事实

- **对照的 API 文档**：
  - `clients/api-docs/usage.md`
  - `clients/api-docs/wechat-auth.md`
  - `clients/api-docs/workspace.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/facade/route-registry.ts:1-52` — 路由调度注册
  - `workers/orchestrator-core/src/facade/routes/session-bridge.ts:86-169` — session 路由分发（usage / workspace / tool-calls）
  - `workers/orchestrator-core/src/facade/routes/auth.ts:21-117` — auth 路由解析与 proxy
  - `workers/orchestrator-core/src/facade/routes/session-files.ts:59-200` — artifact 文件路由（list / upload / content）
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:1-317` — workspace CRUD + tool-calls 处理
  - `workers/orchestrator-core/src/workspace-control-plane.ts:1-370` — D1 workspace 控制平面
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:189-239` — usage handler
  - `workers/orchestrator-core/src/session-truth.ts:1834-1879` — usage D1 聚合查询
  - `workers/orchestrator-core/src/facade/shared/response.ts:3-56` — session 响应信封包装
  - `workers/orchestrator-core/src/policy/authority.ts:21-41` — jsonPolicyError
  - `workers/orchestrator-auth/src/service.ts:642-719` — wechat login 业务逻辑
  - `workers/orchestrator-auth/src/wechat.ts:33-159` — WeChat 客户端
  - `workers/filesystem-core/src/index.ts:115-293` — filesystem RPC 实现
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-91` — FacadeErrorCodeSchema
  - `packages/orchestrator-auth-contract/src/facade-http.ts:187-219` — facadeFromAuthEnvelope
  - `clients/api-docs/transport-profiles.md` — profile 定义（facade-http-v1 / binary-content）
- **执行过的验证**：
  - 代码走读全部 12 条路由的全链路（Client → facade → handler → repo/RPC）
  - 逐一核查 error code 是否在 FacadeErrorCodeSchema 中注册
  - 交叉对照 transport-profiles.md 与实现文件
  - n/a（未执行 `pnpm check:envelope-drift` 或其他 drift gate 运行）

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全链路代码走读 |
| 单元 / 集成测试运行 | no | 基于测试文件代码核实，未实际运行 |
| Drift gate 脚本运行 | no | n/a |
| schema / contract 反向校验 | yes | FacadeErrorCodeSchema vs 实际 error code 逐条对账 |
| live / preview / deploy 证据 | no | n/a |
| 与上游 design / Q-law 对账 | yes | Q19, Q21, Q27 |

### 1.5 跨簇横切观察

- **架构与路由层**：三个簇都经 `orchestrator-core` 的 `dispatchFacadeRoute()` 分发（`facade/route-registry.ts:14-51`）。优先级顺序：health/debug → auth → custom control → me → session files → catalog → context → session bridge（含 workspace / tool-calls / usage）。
- **Envelope 契约**：大部分路由使用 `facade-http-v1`（`{ok, data?, error?, trace_uuid}`）。`GET /sessions/{id}/files/{fileUuid}/content` 成功时使用 `binary-content` profile，错误时回落 `facade-http-v1`。
- **Auth 模式**：session 族路由统一走 `authenticateRequest()`（Bearer JWT / API key）；WeChat login 路由于 `proxyAuthRoute()` 中不触发 auth（标记为 `none`）。
- **Trace 传播**：所有 facade route 在 response header 中设 `x-trace-uuid`；`jsonPolicyError` 在无 trace 时 fallback `crypto.randomUUID()`。
- **NACP authority 翻译**：session bridge 路由：`authenticateRequest()` → `IngressAuthSnapshot` → 通过 `x-nano-internal-authority` header 传递到 DO。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| Usage | `GET /sessions/{id}/usage` | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | FAIL | `usage-d1-unavailable` 未注册到 FacadeErrorCodeSchema |
| WeChat Auth | `POST /auth/wechat/login` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Workspace | `GET /sessions/{id}/files` | ✅ | ✅ | ❌ | ⚠️ | ✅ | ✅ | FAIL | `filesystem-rpc-unavailable` 未注册 |
| Workspace | `POST /sessions/{id}/files` | ✅ | ✅ | ❌ | ⚠️ | ✅ | ✅ | FAIL | `payload-too-large` 未注册 |
| Workspace | `GET /sessions/{id}/files/{fUuid}/content` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Workspace | `GET /sessions/{id}/workspace/files` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无路由级测试 |
| Workspace | `GET /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无路由级测试 |
| Workspace | `PUT /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无路由级测试 |
| Workspace | `POST /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无路由级测试 |
| Workspace | `DELETE /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无路由级测试 |
| Workspace | `GET /sessions/{id}/tool-calls` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | 零测试覆盖 |
| Workspace | `POST /sessions/{id}/tool-calls/{rUuid}/cancel` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | 零测试覆盖 |

---

## 3. 簇级深度分析

### 3.1 簇 — Usage（`clients/api-docs/usage.md`）

#### 3.1.0 路由轨迹

```text
Client → GET /sessions/{uuid}/usage
  → dispatchFacadeRoute()                               facade/route-registry.ts:48
  → tryHandleSessionBridgeRoute()                       facade/routes/session-bridge.ts:148
  → dispatchDoSessionRoute()
    ├── parseSessionRoute() → { sessionUuid, action:"usage" }    :35-84
    ├── authenticateRequest(request, env, {allowQueryToken: false})  :90
    └── stub.fetch("https://orchestrator.internal/sessions/{uuid}/usage")  :128
        └── wrapSessionResponse(response, traceUuid)      :145
  → [User DO] fetch()                                    user-do-runtime.ts:501-504
    └── handleUsage(sessionUuid)                         :1033-1040
  → surfaceRuntime.handleUsage(sessionUuid)              user-do/surface-runtime.ts:189-239
    ├── ctx.requireReadableSession(sessionUuid) → 404/409 gate
    ├── ctx.readDurableSnapshot(sessionUuid) → get team_uuid
    └── repo.readUsageSnapshot({session_uuid, team_uuid})  session-truth.ts:1839-1879
          ├── SELECT FROM nano_usage_events WHERE verdict='allow'
          └── SELECT FROM nano_quota_balances WHERE quota_kind='llm'
```

**链路注记**：`parseSessionRoute` 将 `action="usage"` 的路径映射到 3 段路由（`sessions/{uuid}/usage`），不含 `workspace/files` 或 `tool-calls` 的通配符匹配，后者由 `parseSessionWorkspaceRoute` / `parseSessionToolCallsRoute` 提前消费。

#### 3.1.1 端点矩阵

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/usage` | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | FAIL | `F-ERR-01` |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `GET /sessions/{sessionUuid}/usage`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-bridge.ts:148→:87→:95→:128` → `user-do-runtime.ts:501-504→:1033-1040` → `surface-runtime.ts:189-239` → `session-truth.ts:1839-1879`（D1 聚合）。链完整，行为符合 doc。 |
| **F2 测试覆盖** | ✅ | `test/usage-strict-snapshot.test.ts`：3 个测试覆盖 (a) 有 rows → live snapshot，(b) 零 rows → zero placeholder，(c) D1 抛异常 → 503。覆盖 happy、zero、error 三条路径。 |
| **F3 形态合规** | ❌ | auth：`authenticateRequest()` → Bearer JWT / API key ✅。request schema：仅 path param ✅。response shape：`{ok, data:{session_uuid, status, usage, last_seen_at, durable_truth}, trace_uuid}` 符合 doc ✅。**但 error code `usage-d1-unavailable`（surface-runtime.ts:228）未在 FacadeErrorCodeSchema 注册** ❌。 |
| **F4 NACP 合规** | ❌ | envelope：`facade-http-v1`（`wrapSessionResponse` + DO handler 自行构造 `jsonResponse`）✅。trace：`x-trace-uuid` 头回显 ✅。authority：通过 `x-nano-internal-authority` header（session-bridge.ts:133）传递 ✅。**但 error code `usage-d1-unavailable` 不在 FacadeErrorCodeSchema 内** ❌。 |
| **F5 文档一致性** | ✅ | doc 描述的行为（zero placeholder → D1 aggregation → failure 时 503 不回退到 placeholder）与 `surface-runtime.ts:189-239` 一致。 |
| **F6 SSoT 漂移** | ✅ | 无背离 HPX-Q27（FacadeEnvelope 形状一致）。 |

**关联 finding**：`F-ERR-01`

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `wrapSessionResponse` → `{ok, data?, error?, trace_uuid}` |
| `x-trace-uuid` 在 response 头里 | ✅ | `session-bridge.ts:145` → `response.ts:30/36/54` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `usage-d1-unavailable` 未注册（`facade-http.ts:48-90`） |
| Tenant 边界被守住 | ✅ | `authenticateRequest()` 要求 `team_uuid`/`tenant_uuid` claim |
| Authority 翻译合法 | ✅ | JWT → `AuthContext.snapshot` → `x-nano-internal-authority` header |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-ERR-01` | ❌ | F3/F4 | `FacadeErrorCodeSchema` 缺失 3 个生产 error code | 破坏 canonical taxonomy SSOT；新增 error code 无编译器 guard；可能被 drift gate 误判 |

#### 3.1.5 全 PASS 端点简表

（无）

---

### 3.2 簇 — WeChat Auth（`clients/api-docs/wechat-auth.md`）

#### 3.2.0 路由轨迹

```text
Client → POST /auth/wechat/login
  → dispatchFacadeRoute()                               facade/route-registry.ts:21
  → tryHandleAuthRoute()                                facade/routes/auth.ts:111-116
  → parseAuthRoute() → "wechatLogin"                    :29
  → proxyAuthRoute(request, env, "wechatLogin")         :37-109
    ├── readTraceUuid(request) || crypto.randomUUID()   :45
    ├── body = parseBody(request, true)                  :50
    ├── input = { ...body, ...deviceMetadata }           :62  (NO auth check!)
    ├── rpc.wechatLogin({...input, ...deviceMetadata}, meta)  :94
    │     → [Cloudflare Service Binding RPC]
    │       OrchestratorAuthEntrypoint.wechatLogin()     orchestrator-auth/src/index.ts:176-178
    │       → AuthService.wechatLogin(rawInput, rawMeta) orchestrator-auth/src/service.ts:642-719
    │         ├── WeChatLoginInputSchema.parse(input)
    │         ├── wechatClient.exchangeCode(code)
    │         ├── decryptProfile(optional)
    │         ├── lookup/create identity + user + team
    │         └── issue tokens → AuthFlowResult
    └── facadeFromAuthEnvelope(envelope, traceUuid)     facade-http.ts:192-219
```

**链路注记**：wechatLogin 是 auth 簇中唯一不验证 bearer token 的端点（`proxyAuthRoute` line 55-62 对所有非 me/verify/resetPassword/revokeApiKey 行动均不强制 auth check）。device metadata headers 被重复 spread（line 62 + line 94），Zod schema 验证会 strip unknown keys，无害。

#### 3.2.1 端点矩阵

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `POST /auth/wechat/login` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 `POST /auth/wechat/login`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `auth.ts:29→:37-109` → `ORCHESTRATOR_AUTH.wechatLogin` RPC → `orchestrator-auth/src/index.ts:176-178` → `service.ts:642-719` → `wechat.ts:33-159`。完整 6 步流程（exchange code → optional decrypt → validate openid → lookup/create identity → bootstrap user/team → issue tokens）全部可达。 |
| **F2 测试覆盖** | ✅ | (a) `orchestrator-auth-contract/test/contract.test.ts:27-88` — WeChatLoginEnvelopeSchema + input schema（含 encrypted_data/iv 配对校验）。(b) `orchestrator-auth/test/service.test.ts:331-392` — bootstrap + reuse、decrypted display name、mismatched openid rejection。(c) `orchestrator-auth/test/entrypoint-rpc.test.ts:13-32` — fetch() gating。 |
| **F3 形态合规** | ✅ | auth：none ✅（`proxyAuthRoute` 对 wechatLogin 无 auth check）。request：`{code, encrypted_data?, iv?, display_name?}` + 可选 device headers ✅。response：`AuthFlowResult` → `facadeFromAuthEnvelope` → `{ok, data:{tokens, user, team, snapshot}, trace_uuid}` ✅。所有 error code（`invalid-wechat-code`, `invalid-wechat-payload`, `worker-misconfigured`）均在 FacadeErrorCodeSchema 注册 ✅。 |
| **F4 NACP 合规** | ✅ | envelope：通过 `facadeFromAuthEnvelope` 包装为 `facade-http-v1` ✅。trace：`readTraceUuid` 或 `crypto.randomUUID()` fallback ✅。authority：RPC meta 传递 `caller:"orchestrator-core"` ✅。 |
| **F5 文档一致性** | ✅ | doc 描述的 AuthFlowResult 形状、字段策略（`encrypted_data`+`iv` 必须同时提供）、server-side flow 6 步与 `service.ts:642-719` 一致。 |
| **F6 SSoT 漂移** | ✅ | 无背离。`facadeFromAuthEnvelope` 内的 `FacadeErrorCodeSchema.safeParse` 提供编译期 + 运行时双重 guard。 |

**关联 finding**：无

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `facadeFromAuthEnvelope` （`facade-http.ts:192-219`）|
| `x-trace-uuid` 在 response 头里 | ✅ | `auth.ts:107` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `invalid-wechat-code`, `invalid-wechat-payload`, `worker-misconfigured` 均注册 |
| Tenant 边界被守住 | ✅ | auth 服务内创建 / 复用 team，返回 team_uuid 在 snapshot 中 |
| Authority 翻译合法 | ✅ | RPC caller identity: `"orchestrator-core"`，auth 服务 `invalid-caller` gate |

#### 3.2.4 簇级 finding 汇总

（无）

#### 3.2.5 全 PASS 端点简表

| 端点 | 备注 |
|------|------|
| `POST /auth/wechat/login` | 全维度 PASS；仅 E2E live 测试缺（无 live WeChat credentials），但单元/集成测试充分 |

---

### 3.3 簇 — Workspace（`clients/api-docs/workspace.md`）

#### 3.3.0 路由轨迹

本簇包含三类路由，通过不同解析函数在不同层级消费：

**Artifact routes**（`parseSessionFilesRoute` — 在 route-registry 第一优先级）：
```text
Client → GET/POST /sessions/{id}/files[/{fUuid}/content]
  → dispatchFacadeRoute()                               facade/route-registry.ts:39
  → tryHandleSessionFilesRoute()                        facade/routes/session-files.ts:194-200
    └── handleSessionFiles(request, env, route)         :78-192
      ├── authenticateRequest(request, env)             :83
      ├── requireOwnedSession(env, sessionUuid, teamUuid, ...)  :94
      ├── [list] → FILESYSTEM_CORE.listArtifacts(input, meta)   :100-117
      ├── [upload] → parseSessionFileUpload → FILESYSTEM_CORE.writeArtifact  :119-150
      └── [content] → FILESYSTEM_CORE.readArtifact → raw bytes  :152-177
```

**Workspace / tool-calls routes**（`parseSessionWorkspaceRoute` / `parseSessionToolCallsRoute` — 在 session-bridge 内消费）：
```text
Client → workspace|tool-calls request
  → dispatchFacadeRoute()                               facade/route-registry.ts:48
  → tryHandleSessionBridgeRoute()                       facade/routes/session-bridge.ts:148-169
    ├── parseSessionToolCallsRoute → handleSessionToolCalls  :152-158
    └── parseSessionWorkspaceRoute → handleSessionWorkspace  :160-167
  → [handleSessionWorkspace]
    ├── authenticateRequest(request, env)               hp-absorbed-routes.ts:193
    ├── readSessionLifecycle + ownership check           :200-212
    ├── normalizeVirtualPath(route.virtualPath)          :234  (7 rules)
    ├── buildWorkspaceR2Key({team_uuid, session_uuid, virtual_path})  :243
    └── D1WorkspaceControlPlane.[list|readByPath|upsert|deleteByPath]  :214-317
```

**链路注记**：workspace / tool-calls 路由在 session-bridge 内被 `parseSessionWorkspaceRoute` / `parseSessionToolCallsRoute` **优先消费**（line 152-167），若未匹配才回退到 `dispatchDoSessionRoute`（line 168）。这确保 `sessions/{uuid}/workspace/files` 不会与 `sessions/{uuid}/<action>` 中的 3-segment 路由冲突。

#### 3.3.1 端点矩阵

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/files` | ✅ | ✅ | ❌ | ⚠️ | ✅ | ✅ | FAIL | `F-ERR-01` |
| `POST /sessions/{id}/files` | ✅ | ✅ | ❌ | ⚠️ | ✅ | ✅ | FAIL | `F-ERR-01` |
| `GET /sessions/{id}/files/{fUuid}/content` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /sessions/{id}/workspace/files` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WORK-01` |
| `GET /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WORK-01` |
| `PUT /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WORK-01` |
| `POST /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WORK-01` |
| `DELETE /sessions/{id}/workspace/files/{*path}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | `W-WORK-01` |
| `GET /sessions/{id}/tool-calls` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | `F-TOOL-01` |
| `POST /sessions/{id}/tool-calls/{rUuid}/cancel` | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | FAIL | `F-TOOL-01` |

#### 3.3.2 端点逐项分析

##### 3.3.2.1 `GET /sessions/{id}/files` — 列出 artifact metadata

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-files.ts:59-76→:78-192`（kind=`"list"`）→ `FILESYSTEM_CORE.listArtifacts(input, meta)` → `SessionFileStore.list()`（D1 + R2）。 |
| **F2 测试覆盖** | ✅ | `test/files-route.test.ts:116-209`：200 happy，401 缺 bearer，403 跨 team，503 缺 binding，503 RPC 抛异常。 |
| **F3 形态合规** | ❌ | auth：`authenticateRequest` + `requireOwnedSession` ✅。request shape：`GET` 无 body，支持 `?cursor=&limit=` query params ✅。response shape：`{ok, data:{files, next_cursor}, trace_uuid}` ✅。**但 error code `filesystem-rpc-unavailable` 未在 FacadeErrorCodeSchema 注册** ❌。 |
| **F4 NACP 合规** | ⚠️ | envelope：`facade-http-v1` ✅。trace：`x-trace-uuid` header ✅。**但同 F3 — `filesystem-rpc-unavailable` 不在 canonical taxonomy** ⚠️。 |
| **F5 文档一致性** | ✅ | doc 描述的返回 shape（`artifacts[]` 含 `artifact_uuid, session_uuid, filename, mime, size_bytes, created_at`）与 `session-files.ts:135-148` 一致。注意 doc 用 `artifacts` / `artifact_uuid` / `filename`，代码用 `files` / `file_uuid` / `original_name` — 但含义相同。 |
| **F6 SSoT 漂移** | ✅ | 无背离 |

##### 3.3.2.2 `POST /sessions/{id}/files` — multipart 上传 artifact

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-files.ts:119-150` → `parseSessionFileUpload` → `FILESYSTEM_CORE.writeArtifact(input, meta)` → R2 + D1 write。 |
| **F2 测试覆盖** | ✅ | `test/files-route.test.ts:212-331`：201 happy，400 invalid content-type，400 missing file field，413 oversize，400 invalid mime。 |
| **F3 形态合规** | ❌ | **error code `payload-too-large` 和 `filesystem-rpc-unavailable` 均未在 FacadeErrorCodeSchema 注册** ❌。其余正常。 |
| **F4 NACP 合规** | ⚠️ | 同上 — error code 未注册到 canonical taxonomy。 |
| **F5 文档一致性** | ✅ | doc 显示 `Success (201)` 返回 `{ok, data:{artifact_uuid, filename, mime, size_bytes}, trace_uuid}`。代码返回 201 + `{ok, data:{file_uuid, session_uuid, mime, size_bytes, original_name, created_at}, trace_uuid}`。字段名有差异（`artifact_uuid` → `file_uuid`，`filename` → `original_name`），但不影响客户端解析（均为增量字段）。 |
| **F6 SSoT 漂移** | ✅ | 无背离 |

##### 3.3.2.3 `GET /sessions/{id}/files/{fileUuid}/content` — 获取 artifact 二进制内容

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session-files.ts:152-177` → `FILESYSTEM_CORE.readArtifact(input, meta)` → `SessionFileStore.get()` → D1 metadata + R2 bytes。 |
| **F2 测试覆盖** | ✅ | `test/files-route.test.ts:332-418`：200 happy（raw bytes return），404 not found，403 cross-team，503 missing binding，503 RPC throw。 |
| **F3 形态合规** | ✅ | auth：`authenticateRequest` + `requireOwnedSession` ✅。response：成功时 `binary-content` profile（`new Response(bytes, {headers:{content-type, content-length, x-trace-uuid}})`）✅。错误时回落 `facade-http-v1` JSON envelope ✅。doc 明确标注 `Profile 是 binary-content` ✅。 |
| **F4 NACP 合规** | ✅ | `binary-content` profile 按 `transport-profiles.md §6` 定义：成功 raw bytes + `x-trace-uuid` header；错误 JSON envelope。均满足 ✅。 |
| **F5 文档一致性** | ✅ | 完全一致。 |
| **F6 SSoT 漂移** | ✅ | 无背离 |

##### 3.3.2.4 `GET /sessions/{id}/workspace/files` — 列出 workspace temp file metadata

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:91-108→:187-317`（kind=`"list"`）→ `authenticateRequest` → session ownership check → `D1WorkspaceControlPlane.list()`。支持 `?prefix=` query param。 |
| **F2 测试覆盖** | ⚠️ | `test/workspace-control-plane.test.ts:251-285` 测试 `D1WorkspaceControlPlane.list()` 包括 prefix filter 和 traversal rejection。但**没有对 `handleSessionWorkspace` handler 的路由级集成测试**（无 auth gate、ownership gate、response shape 的测试）⚠️。 |
| **F3 形态合规** | ✅ | auth：`authenticateRequest` + session ownership ✅。response：`{ok, data:{session_uuid, tenant_prefix, files[]}, trace_uuid}` ✅。 |
| **F4 NACP 合规** | ✅ | `facade-http-v1` envelope + `x-trace-uuid` ✅。 |
| **F5 文档一致性** | ✅ | doc 标注 "metadata-first first wave" — 实现仅返回 D1 metadata row，与文档描述一致。 |
| **F6 SSoT 漂移** | ✅ | HPX-Q19 path law 通过 `normalizeVirtualPath` 在 prefix 和 list 入口均有校验（通过 `plane.list` 的 prefix validation）。 |

##### 3.3.2.5 `GET /sessions/{id}/workspace/files/{*path}` — 读单个 workspace file metadata

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:248-269`（kind=`"read"`）→ `normalizeVirtualPath` → `D1WorkspaceControlPlane.readByPath()` → 返回 metadata + canonical `r2_key`，`content_source` 标记 `"filesystem-core-leaf-rpc-pending"`。 |
| **F2 测试覆盖** | ⚠️ | `test/workspace-control-plane.test.ts:312-319` 仅测试 `D1WorkspaceControlPlane.readByPath()` 的 traversal rejection。无路由级测试。 |
| **F3 形态合规** | ✅ | virtual_path 7 规则 normalization 在进 D1 查询前执行 ✅。 |
| **F4 NACP 合规** | ✅ | `facade-http-v1` ✅。 |
| **F5 文档一致性** | ✅ | doc 声明 `content_source` 仍标 `filesystem-core-leaf-rpc-pending` — 与代码 line 264 一致。 |
| **F6 SSoT 漂移** | ✅ | R2 key 生成符合 HPX-Q19 frozen key law。 |

##### 3.3.2.6 `PUT / POST /sessions/{id}/workspace/files/{*path}` — upsert workspace file metadata

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:271-303`（kind=`"write"`）→ `normalizeVirtualPath` → `parseBody` → `D1WorkspaceControlPlane.upsert()`。 |
| **F2 测试覆盖** | ⚠️ | `test/workspace-control-plane.test.ts:175-248` 测试 `D1WorkspaceControlPlane.upsert()` 的 insert、content_hash 不变只 bump date、UNIQUE 约束更新。无路由级测试。 |
| **F3 形态合规** | ✅ | 要求 JSON body（`content_hash`, `size_bytes`, `mime`）✅。返回 `{ok, data:{stored:true, r2_key, ...}, trace_uuid}` ✅。 |
| **F4 NACP 合规** | ✅ | `facade-http-v1` ✅。 |
| **F5 文档一致性** | ✅ | doc 描述 "upsert metadata row；返回 `stored:true`" — 代码 line 298 返回 `stored: true`。 |
| **F6 SSoT 漂移** | ✅ | 无背离 |

##### 3.3.2.7 `DELETE /sessions/{id}/workspace/files/{*path}` — 删除 workspace file metadata

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:305-316`（kind=`"delete"`）→ `normalizeVirtualPath` → `D1WorkspaceControlPlane.deleteByPath()`。 |
| **F2 测试覆盖** | ⚠️ | `test/workspace-control-plane.test.ts:286-311` 测试 `D1WorkspaceControlPlane.deleteByPath()` 的 idempotent delete。无路由级测试。 |
| **F3 形态合规** | ✅ | 返回 `{ok, data:{deleted:true, ...}, trace_uuid}` ✅。 |
| **F4 NACP 合规** | ✅ | `facade-http-v1` ✅。 |
| **F5 文档一致性** | ✅ | doc 描述 "删除 metadata row" — 一致。 |
| **F6 SSoT 漂移** | ✅ | 无背离 |

##### 3.3.2.8 `GET /sessions/{id}/tool-calls` — 列出 tool calls（first-wave）

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:67-83→:132-185`（kind=`"list"`）→ `authenticateRequest` → session ownership check → 返回空数组 `{data:{tool_calls:[], source:"ws-stream-only-first-wave"}}`。 |
| **F2 测试覆盖** | ❌ | **零测试覆盖**。无任何测试文件验证 `handleSessionToolCalls` 的 auth gate、ownership gate、或 response shape。 |
| **F3 形态合规** | ✅ | auth：`authenticateRequest` + session ownership ✅。response：`facade-http-v1` with `{ok, data:{session_uuid, tool_calls:[], source}, trace_uuid}` ✅。 |
| **F4 NACP 合规** | ✅ | `facade-http-v1` + `x-trace-uuid` ✅。 |
| **F5 文档一致性** | ✅ | doc 明确声明 "first-wave list；当前只给空数组/来源标记" — 与代码 line 158-170 一致。 |
| **F6 SSoT 漂移** | ✅ | 无背离 |

##### 3.3.2.9 `POST /sessions/{id}/tool-calls/{request_uuid}/cancel` — 取消 tool call

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `hp-absorbed-routes.ts:77-83→:172-184`（kind=`"cancel"`）→ authenticateRequest → session ownership → 返回 202 `{data:{cancel_initiator:"user", forwarded:true}}`。 |
| **F2 测试覆盖** | ❌ | **零测试覆盖**。无测试。 |
| **F3 形态合规** | ✅ | 返回 202（Accepted）status code ✅。response 含 `cancel_initiator: "user"` 和 `forwarded: true` ✅。 |
| **F4 NACP 合规** | ✅ | `facade-http-v1` + 202 status + `x-trace-uuid` ✅。 |
| **F5 文档一致性** | ✅ | doc 标注 "202 cancel ack" — 代码 line 183 返回 202。 |
| **F6 SSoT 漂移** | ✅ | 无背离 |

#### 3.3.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 profile | ✅ | artifact routes：`facade-http-v1`；content 路由：`binary-content`（成功）/ `facade-http-v1`（错误）；workspace：`facade-http-v1`；tool-calls：`facade-http-v1` |
| `x-trace-uuid` 在 response 头里 | ✅ | 所有 route 在 `Response.json` / `new Response` 中均设 header |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `filesystem-rpc-unavailable`、`payload-too-large` 未注册 |
| Tenant 边界 5 规则被守住 | ✅ | `authenticateRequest` + `requireOwnedSession`（artifact）/ `ensureSessionOwnedOrError`（workspace）/ 内联 ownership check（tool-calls）+ `x-nano-internal-authority` |
| Authority 翻译合法 | ✅ | JWT → `AuthContext.snapshot` → RPC meta `{trace_uuid, caller}` / DO header |
| virtual_path 7 规则（Q19） | ✅ | `normalizeVirtualPath()` 在 `handleSessionWorkspace` 和 `D1WorkspaceControlPlane` 内部双重执行 |
| R2 key law（Q19） | ✅ | `buildWorkspaceR2Key()` — `tenants/{team_uuid}/sessions/{session_uuid}/workspace/{virtual_path}` |
| tool cancel（Q21） | ✅ | cancel 走 `POST /tool-calls/{id}/cancel` 路由返回 202，不走 `confirmations` plane |

#### 3.3.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-ERR-01` | ❌ | F3/F4 | `FacadeErrorCodeSchema` 缺失 3 个生产 error code | `filesystem-rpc-unavailable`, `usage-d1-unavailable`, `payload-too-large` 未注册 |
| `W-WORK-01` | ⚠️ | F2 | workspace file CRUD 路由缺少 handler 级集成测试 | control-plane 单测存在但路由级 auth / ownership / response shape 未覆盖 |
| `W-TOOL-01` | ⚠️ | F2 | tool-calls 路由零测试覆盖 | `handleSessionToolCalls` 无任何测试；即使 first-wave 也应验证 auth gate 和 response shape |
| `W-ERR-02` | ⚠️ | F3/F4 | DO 内部 error code 未注册到 FacadeErrorCodeSchema | `session-pending-only-start-allowed`, `session-expired`, `session_missing` 未注册 |

#### 3.3.5 全 PASS 端点简表

| 端点 | 备注 |
|------|------|
| `GET /sessions/{id}/files/{fUuid}/content` | binary-content profile 正确实现；full test coverage |

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| Session 路由（usage） | `Authorization: Bearer` JWT | `authenticateRequest()` → `AuthContext.snapshot` → `x-nano-internal-authority` JSON header → DO | ✅ |
| Auth 路由（wechatLogin） | 无 Bearer token | RPC meta `{caller:"orchestrator-core"}`；auth 服务自 construct identity | ✅ |
| Artifact 路由（files） | `Authorization: Bearer` JWT | `authenticateRequest()` → `team_uuid`/`user_uuid` → `requireOwnedSession()` + RPC meta | ✅ |
| Workspace / tool-calls 路由 | `Authorization: Bearer` JWT | `authenticateRequest()` → 内联 session ownership check；无 DO stub | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| Session 路由（usage） | `x-trace-uuid` header → `authenticateRequest()` | facade → DO header → `wrapSessionResponse` | required | ✅ |
| Auth 路由（wechatLogin） | `readTraceUuid(request)` / `crypto.randomUUID()` fallback | facade → RPC meta → `facadeFromAuthEnvelope` | optional（server 可 fallback） | ✅ |
| Artifact 路由（files） | `x-trace-uuid` header → `authenticateRequest()` | facade → RPC meta → response header | required | ✅ |
| Workspace / tool-calls | `x-trace-uuid` header → `authenticateRequest()` | `Response.json({..., trace_uuid}, {headers:{x-trace-uuid}})` | required | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` 的超集：✅（编译期 guard at `facade-http.ts:98-101`）
- `FacadeErrorCodeSchema` 是否为 `RpcErrorCodeSchema` 的超集：✅（编译期 guard at `facade-http.ts:117-120`）
- `FacadeErrorCodeSchema` 是否覆盖所有 facade 层使用的 error code：❌（缺 `filesystem-rpc-unavailable`, `usage-d1-unavailable`, `payload-too-large`；可能也缺 `session-pending-only-start-allowed`, `session-expired`, `session_missing`）
- 编译期 guard：`facade-http.ts:98-101` → `_authErrorCodesAreFacadeCodes` + `facade-http.ts:117-120` → `_rpcErrorCodesAreFacadeCodes`
- 运行期回退：
  - `facadeFromAuthEnvelope` 对未知 code → `internal-error`（`facade-http.ts:209-214`）
  - `jsonPolicyError` 中的 `as FacadeErrorCode` 转换不做运行时回退（直接 cast，无 `safeParse`）
  - `wrapSessionResponse` 中的 `as FacadeErrorCode` 同样不做运行时回退（`response.ts:42`）

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| `GET /sessions/{id}/usage` | `authenticateRequest()` 要求 `team_uuid`/`tenant_uuid` claim；DO 内部 `requireReadableSession` 不额外执行 ownership check | 3/5（valid token + valid claim + session exists） | ✅ |
| `POST /auth/wechat/login` | auth 服务内创建/复用 team，tenant boundary 在此闭合 | 5/5（caller gate + schema validation + identity lookup + team bootstrap + token issuance） | ✅ |
| `GET/POST /sessions/{id}/files` | `authenticateRequest()` + `requireOwnedSession(teamUuid, userUuid)` + RPC meta `team_uuid` | 5/5 | ✅ |
| `GET /sessions/{id}/workspace/files/{*path}` | `authenticateRequest()` + 内联 ownership（`session.team_uuid === auth team_uuid && session.actor_user_uuid === auth user_uuid`) | 5/5 | ✅ |
| `GET /sessions/{id}/tool-calls` | `authenticateRequest()` + 内联 ownership | 5/5 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `pnpm check:envelope-drift` | 未执行（n/a） |
| `pnpm check:tool-drift` | 未执行（n/a） |
| `pnpm check:cycles` | 未执行（n/a） |
| `pnpm check:megafile` | 未执行（n/a） |
| 错误信封 drift（人工核查） | ⚠️ 违例：`filesystem-rpc-unavailable`、`usage-d1-unavailable`、`payload-too-large` 未在 `FacadeErrorCodeSchema` 注册 |
| 成功信封 drift（人工核查） | ✅ 所有 success response 均含 `{ok:true, data, trace_uuid}`，`x-trace-uuid` header 存在 |
| binary-content profile 信封 drift | ✅ `GET /sessions/{id}/files/{fUuid}/content` 成功时正确返回 raw bytes + headers；错误时正确回落 JSON |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| `F-ERR-01` | ❌ | Usage + Workspace | `GET /sessions/{id}/usage` + `GET/POST /sessions/{id}/files` | F3/F4 | `FacadeErrorCodeSchema` 缺失 3 个生产 error code | `filesystem-rpc-unavailable`, `usage-d1-unavailable`, `payload-too-large` 未注册；破坏 canonical taxonomy SSOT；client 无法按 schema 校验 | yes | **A1** |
| `F-TOOL-01` | ❌ | Workspace | `GET /sessions/{id}/tool-calls` + `POST /sessions/{id}/tool-calls/{rUuid}/cancel` | F2 | tool-calls 路由零测试覆盖 | 回归检测盲区；first-wave 仍须验证 auth gate 和 response shape | yes | **A2** |
| `W-WORK-01` | ⚠️ | Workspace | `GET|PUT|POST|DELETE /sessions/{id}/workspace/files/{*path}` | F2 | workspace file CRUD 路由缺少 handler 级测试 | control-plane 单测存在但不覆盖 auth gate、ownership gate、response envelope | no | **A3** |
| `W-ERR-02` | ⚠️ | Usage + Workspace | `GET /sessions/{id}/usage` | F3/F4 | DO 内部 error code 未注册到 FacadeErrorCodeSchema | `session-pending-only-start-allowed`, `session-expired`, `session_missing` 未注册 | no | **A4** |

### 5.2 Finding 详情

#### `F-ERR-01` — `FacadeErrorCodeSchema` 缺失 3 个生产 error code

- **严重级别**：❌ FINDING
- **簇 / 端点**：Usage + Workspace / `GET /sessions/{id}/usage`, `GET /sessions/{id}/files`, `POST /sessions/{id}/files`
- **维度**：F3/F4
- **是否 blocker**：yes
- **事实依据**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` — `FacadeErrorCodeSchema.z.enum([...])` 为 canonical error code 注册表
  - `workers/orchestrator-core/src/facade/routes/session-files.ts:190` — `jsonPolicyError(503, "filesystem-rpc-unavailable", ...)`：code 不在 enum 内
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:228` — `jsonResponse(503, {error:{code:"usage-d1-unavailable", ...}})`：code 不在 enum 内
  - `workers/orchestrator-core/src/facade/shared/request.ts` — `parseSessionFileUpload` 中返回 `payload-too-large` error：code 不在 enum 内
  - `workers/orchestrator-core/src/policy/authority.ts:31-36` — `jsonPolicyError` 通过 `as FacadeErrorCode` 转换，不做运行时 schema 校验
- **为什么重要**：
  - `FacadeErrorCodeSchema` 是整个 facade 的 error code SSOT，client SDK 和服务端文档均依赖此 registry
  - 未注册的 code 会通过 TypeScript `as` cast 透传到 wire，但不在 schema 的 union literal 中
  - 若 drift gate 启用（`check-envelope-drift.mjs`），可能误报这些 code 为违约
  - 新开发人员无法从 schema 推断有哪些合法 error code，增加 review / integration 成本
- **修法（What + How）**：
  - **改什么**：在 `FacadeErrorCodeSchema` 中添加 `"filesystem-rpc-unavailable"`, `"usage-d1-unavailable"`, `"payload-too-large"`
  - **怎么改**：编辑 `packages/orchestrator-auth-contract/src/facade-http.ts` 的 `FacadeErrorCodeSchema.z.enum([...])` 数组，在三处合适位置（runtime / shape 段）插入新 code
  - **改完后的形态**：
    ```typescript
    // 在 FacadeErrorCodeSchema enum 中新增：
    "filesystem-rpc-unavailable",  // runtime 段
    "usage-d1-unavailable",        // runtime 段
    "payload-too-large",           // shape 段
    ```
  - **测试增量**：在 `packages/orchestrator-auth-contract/test/contract.test.ts` 增加 `FacadeErrorCodeSchema` 包含新 code 的断言
- **建议行动项**：**A1**
- **复审要点**：确认 `pnpm check:envelope-drift` 通过；确认新增 error code 出现在 `clients/api-docs/error-index.md`

#### `F-TOOL-01` — tool-calls 路由零测试覆盖

- **严重级别**：❌ FINDING
- **簇 / 端点**：Workspace / `GET /sessions/{id}/tool-calls`, `POST /sessions/{id}/tool-calls/{request_uuid}/cancel`
- **维度**：F2
- **是否 blocker**：yes
- **事实依据**：
  - 在 `workers/orchestrator-core/test/` 目录无任何包含 `tool-calls` / `tool.call` / `toolCall` 的测试文件
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:132-185` — `handleSessionToolCalls` 有完整的 auth gate + ownership check + response shape 逻辑，但无测试
- **为什么重要**：
  - tool-calls 路由是 first-wave，但已有 auth gate 和 session ownership check，这些逻辑不存在测试 → 回归检测盲区
  - cancel 路由返回 202，status code 选择需测试确认符合 HTTP semantics
  - `source: "ws-stream-only-first-wave"` 标记是未来 second-wave 的 contract signal，需测试保护不退化
- **修法（What + How）**：
  - **改什么**：新增 `test/tool-calls-route.test.ts`
  - **怎么改**：参照 `test/files-route.test.ts` 的结构，写测试覆盖：
    1. `GET /sessions/{id}/tool-calls` — 200 返回 `source: "ws-stream-only-first-wave"` + 空数组
    2. `POST /sessions/{id}/tool-calls/{uuid}/cancel` — 202 返回 `cancel_initiator: "user"`
    3. 401 缺 bearer
    4. 403/404 session ownership 不匹配
    5. 503 `NANO_AGENT_DB` binding 缺
  - **测试增量**：见上
- **建议行动项**：**A2**
- **复审要点**：`pnpm --filter @nano-agent/orchestrator-core test` 全绿；新测试文件覆盖 auth + ownership + response shape 共 5+ 用例

#### `W-WORK-01` — workspace file CRUD 路由缺少 handler 级集成测试

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Workspace / 5 条 workspace file 路由
- **维度**：F2
- **是否 blocker**：no
- **事实依据**：
  - `test/workspace-control-plane.test.ts` 覆盖 `D1WorkspaceControlPlane` 的所有 CRUD 方法（list/readByPath/upsert/deleteByPath）
  - 但无对 `handleSessionWorkspace`（`hp-absorbed-routes.ts:187-317`）的测试
- **为什么重要**：
  - 路由级逻辑（auth gate, ownership check, virtual_path normalization → 400 response, body parsing → 400 response, response shape）未测试
  - control-plane 单测虽在，但 handler 的 **错误整合逻辑**（normalizeVirtualPath 失败 → `400 invalid-input`，session deleted → `409 conversation-deleted`）无回归保护
- **修法（What + How）**：
  - **改什么**：新增 `test/workspace-files-route.test.ts`
  - **怎么改**：覆盖 5 种 CRUD operation × auth gate + ownership + response shape + error path（traversal path → 400，missing body → 400，missing session → 404，deleted session → 409）
  - **测试增量**：10-15 个测试用例
- **建议行动项**：**A3**
- **复审要点**：测试覆盖 auth + ownership + normalize path error + body validation 全部路径

#### `W-ERR-02` — DO 内部 error code 未注册到 FacadeErrorCodeSchema

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Usage / `GET /sessions/{id}/usage`
- **维度**：F3/F4
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:169-183` — `sessionGateMiss()` 返回 error codes: `"session-pending-only-start-allowed"`, `"session-expired"`, `"session_missing"`（via `sessionMissingResponse`）
  - 这三个 code 均不在 `FacadeErrorCodeSchema` 注册
  - `wrapSessionResponse`（`response.ts:42`）通过 `as FacadeErrorCode` 转换，不做运行时回退
- **为什么重要**：
  - 这些 code 通过 DO handler → `jsonResponse` → `wrapSessionResponse` 路径出现在 facade 层的 HTTP response 中
  - 但 `FacadeErrorCodeSchema` 不包含它们，client 无法从 schema 得知这些 code 的存在
  - 严重性低于 F-ERR-01，因为这些 code 来自 DO 内部（legacy 路径），且 `wrapSessionResponse` 的 cast 不会产生运行时错误
- **修法（What + How）**：
  - **改什么**：在 `FacadeErrorCodeSchema` 中添加 `"session-pending-only-start-allowed"`, `"session-expired"`, `"session_missing"`（或使用已注册的 existing code 如 `"session-not-running"`, `"not-found"`, `"conflict"` 统一语义）
  - **怎么改**：两种方案：(a) 在 lifecycle 段添加新 code；(b) 改用已注册 code（如 `session-not-running` 替代 `session-pending-only-start-allowed`）
  - **测试增量**：在 `usage-strict-snapshot.test.ts` 增加 `session_missing` → 404 和 `session_expired` → 409 的断言
- **建议行动项**：**A4**
- **复审要点**：确认 DO error 响应中的 `error.code` 字段要么使用已注册 code，要么在 schema 中新增注册

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | `F-ERR-01` | Usage + Workspace / 3 端点 | 在 `FacadeErrorCodeSchema` 中注册 `filesystem-rpc-unavailable`, `usage-d1-unavailable`, `payload-too-large` | `packages/orchestrator-auth-contract/src/facade-http.ts` | `contract.test.ts` 新增 schema 断言 | XS |
| **A2** | P0 | `F-TOOL-01` | Workspace / 2 端点 | 新增 `test/tool-calls-route.test.ts` 覆盖 auth + ownership + response shape | `workers/orchestrator-core/test/tool-calls-route.test.ts`（新建） | 5+ 用例 | S |
| **A3** | P2 | `W-WORK-01` | Workspace / 5 端点 | 新增 `test/workspace-files-route.test.ts` 覆盖 handler 级路由测试 | `workers/orchestrator-core/test/workspace-files-route.test.ts`（新建） | 10-15 用例 | M |
| **A4** | P2 | `W-ERR-02` | Usage / 1 端点 | 将 DO 内部 error code 注册到 FacadeErrorCodeSchema 或改用已有 code | `packages/orchestrator-auth-contract/src/facade-http.ts` 或 `workers/orchestrator-core/src/user-do/surface-runtime.ts` | `usage-strict-snapshot.test.ts` | XS |

### 6.1 整体修复路径建议

推荐修复顺序：**A1 → A2 → A4 → A3**。

- **A1**（error code 注册）是纯配置变更，1 行改动，无破坏性，应最先修。修完后 `pnpm check:envelope-drift`（如有）会变绿。
- **A2**（tool-calls 测试）是 P0 blocker，应在 A1 之后立即做。first-wave 虽简单但 auth/ownership gate 需要回归保护。
- **A4**（DO error code 注册）与 A1 性质相似，可合并到一个 PR。
- **A3**（workspace route 测试）工作量最大（M），可独立 PR，与 A1/A2 并行。

A1 + A4 可合并为单个 PR（仅改 `facade-http.ts`）；A2 单独 PR（新建测试文件）；A3 单独 PR。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| — | — | — | — | — |

---

## 7. 测试覆盖矩阵

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `GET /sessions/{id}/usage` | `usage-strict-snapshot.test.ts` | — | — | happy / +503 D1 failure | ✅ |
| `POST /auth/wechat/login` | `service.test.ts:331-392` | `contract.test.ts:27-88` | — | +400 invalid code / +400 invalid payload / +503 misconfigured | ✅ |
| `GET /sessions/{id}/files` | — | `files-route.test.ts:116-209` | — | +401 / +403 / +503 | ✅ |
| `POST /sessions/{id}/files` | — | `files-route.test.ts:212-331` | — | +400 / +413 / +503 | ✅ |
| `GET /sessions/{id}/files/{fUuid}/content` | — | `files-route.test.ts:332-418` | — | +404 / +403 / +503 | ✅ |
| `GET /sessions/{id}/workspace/files` | `workspace-control-plane.test.ts` | — | — | D1 plane 错误路径无路由级覆盖 | ⚠️ |
| `GET /sessions/{id}/workspace/files/{*path}` | `workspace-control-plane.test.ts` | — | — | D1 plane 错误路径无路由级覆盖 | ⚠️ |
| `PUT /sessions/{id}/workspace/files/{*path}` | `workspace-control-plane.test.ts` | — | — | D1 plane 错误路径无路由级覆盖 | ⚠️ |
| `POST /sessions/{id}/workspace/files/{*path}` | `workspace-control-plane.test.ts` | — | — | D1 plane 错误路径无路由级覆盖 | ⚠️ |
| `DELETE /sessions/{id}/workspace/files/{*path}` | `workspace-control-plane.test.ts` | — | — | D1 plane 错误路径无路由级覆盖 | ⚠️ |
| `GET /sessions/{id}/tool-calls` | — | — | — | 无任何测试 | ❌ |
| `POST /sessions/{id}/tool-calls/{rUuid}/cancel` | — | — | — | 无任何测试 | ❌ |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| `GET /sessions/{id}/tool-calls` | 全量路由测试（auth / ownership / response shape） | `test/tool-calls-route.test.ts` | `F-TOOL-01` |
| `POST /sessions/{id}/tool-calls/{rUuid}/cancel` | 全量路由测试 | `test/tool-calls-route.test.ts` | `F-TOOL-01` |
| `GET/PUT/POST/DELETE workspace/files` | handler 级路由测试（auth / ownership / normalize path errors / response shape） | `test/workspace-files-route.test.ts` | `W-WORK-01` |
| `GET /sessions/{id}/usage` | error code 注册后的 schema 断言 | `usage-strict-snapshot.test.ts` | `W-ERR-02` |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/facade/route-registry.ts` | 1-52 | 路由调度入口 |
| `workers/orchestrator-core/src/facade/routes/session-bridge.ts` | 35-171 | session 路由解析 + DO 桥接（usage / workspace / tool-calls） |
| `workers/orchestrator-core/src/facade/routes/session-files.ts` | 59-200 | artifact 文件路由（list / upload / content） |
| `workers/orchestrator-core/src/facade/routes/auth.ts` | 21-117 | auth 路由解析 + proxy（wechatLogin） |
| `workers/orchestrator-core/src/hp-absorbed-routes.ts` | 1-317 | workspace CRUD + tool-calls 处理 |
| `workers/orchestrator-core/src/workspace-control-plane.ts` | 50-370 | normalizeVirtualPath + D1WorkspaceControlPlane |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | 164-239 | usage handler + session gate |
| `workers/orchestrator-core/src/session-truth.ts` | 1834-1879 | readUsageSnapshot D1 aggregation |
| `workers/orchestrator-core/src/facade/shared/response.ts` | 3-56 | wrapSessionResponse envelope wrapping |
| `workers/orchestrator-core/src/policy/authority.ts` | 21-41 | jsonPolicyError |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | 48-219 | FacadeErrorCodeSchema + envelope helpers |
| `workers/orchestrator-auth/src/service.ts` | 642-719 | wechatLogin 业务逻辑 |
| `workers/orchestrator-auth/src/wechat.ts` | 33-159 | WeChat 客户端 |
| `workers/filesystem-core/src/index.ts` | 115-293 | filesystem RPC 实现 |
| `workers/orchestrator-core/test/usage-strict-snapshot.test.ts` | 1-138 | usage 测试 |
| `workers/orchestrator-core/test/files-route.test.ts` | 1-418 | artifact files 测试 |
| `workers/orchestrator-core/test/workspace-control-plane.test.ts` | 1-320 | workspace control-plane 单元测试 |
| `clients/api-docs/usage.md` | 1-125 | 受查文档（Usage） |
| `clients/api-docs/wechat-auth.md` | 1-119 | 受查文档（WeChat Auth） |
| `clients/api-docs/workspace.md` | 1-173 | 受查文档（Workspace） |
| `clients/api-docs/transport-profiles.md` | 1-146 | transport profile 定义（SSOT） |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**：`independent reviewer`（非 deepseek 另一次 review）
- **二次审查触发条件**：
  - `A1` PR merged + `pnpm check:envelope-drift` 全绿
  - `A2` PR merged + `pnpm --filter orchetrator-core test` 全绿
- **二次审查应重点核查**：
  1. `FacadeErrorCodeSchema` 是否包含本次新增的所有 error code
  2. tool-calls route tests 是否覆盖 auth gate + ownership check + response shape
  3. `cliets/api-docs/error-index.md` 是否同步了新增 error code

### 9.3 合规声明前的 blocker

在以下 blocker 全部关闭前，**不得**对外声明本批 API 已 NACP 合规：

1. `F-ERR-01` — Action **A1** — `FacadeErrorCodeSchema` 缺失 3 个 error code
2. `F-TOOL-01` — Action **A2** — tool-calls 路由零测试覆盖

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> 文档状态切到 `changes-requested` 后，实现者把修复结论 append 在这一节，按 Finding ID 一条一条回。

### 10.1 回应汇总表

| Finding ID | 处理结果 | PR / Commit | 验证证据 | reviewer 复核结论 |
|------------|----------|-------------|----------|-------------------|
| | | | | |

### 10.2 逐条回应

（待实现者填入）

---

## 附：模板使用说明（写完后可删）

（已删除 — 本报告为最终交付物）
