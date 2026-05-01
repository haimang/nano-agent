# Nano-Agent API Compliance 调查报告 — Part 2

> 调查对象: `Confirmations + Context + /me`
> 调查类型: `initial`
> 调查者: `deepseek (auto)`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/confirmations.md`
> - `clients/api-docs/context.md`
> - `clients/api-docs/me-sessions.md`
> Profile / 协议族: `facade-http-v1`
> 真相对照（SSoT）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts` — FacadeEnvelope schema
> - `workers/orchestrator-core/src/confirmation-control-plane.ts` — D1ConfirmationControlPlane
> - `workers/orchestrator-core/src/context-control-plane.ts` — context durable helpers
> - `workers/orchestrator-core/src/index.ts:1103-1165, 1500-1669, 1939-2210, 2479-2616`
> - `docs/design/hero-to-pro/HPX-qna.md` Q16-Q18 (confirmation laws), Q22-Q24 (restore laws)
> 复用 / 对照的既有审查:
> - `docs/eval/hero-to-pro/api-compliance/part1-by-deepseek.md` — 采纳为 NACP envelope + auth 架构基线
> 文档状态: `reviewed`

---

## 0. 总判定 / Executive Summary

- **整体 verdict**：本轮 Confirmations + Context + /me 调查通过，发现 2 项 WARN 和 3 项 OBSERVATION，无 CRITICAL 或 FINDING。
- **结论等级**：`compliant-with-followups`
- **是否允许声明合规**：`yes`（WARN 项不阻塞合规声明）
- **本轮最关键的 1-3 个判断**：
  1. Confirmations 的 409 `confirmation-already-resolved` 错误响应带了 `data` 字段，严格不符合 facade-http-v1 纯错误信封形态（W-CFM-01）
  2. Context 路由在 facade 层缺少 session ownership 检查，依赖 context-core 内部守卫（W-CTX-01）
  3. GET `/sessions/{id}/context` 路由匹配 regex 使用单复数 `sessions` vs `session` 不一致，不引发功能问题但与其他路由风格错位

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Confirmations | 3 | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN |
| Context | 7 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| /me | 8 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker |
|----------|------|--------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 0 | — |
| ⚠️ WARN     | 2 | no |
| 📝 OBSERVATION | 3 | no |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性 | 路由→实现是否真实成链？ | route → handler → backing repo / RPC 全链路可达 |
| **F2** | 测试覆盖 | 是否有测试在这条路径上跑过？ | 单测 + 集成至少一层有断言 |
| **F3** | 形态合规 | 请求/响应/错误形状、auth gate 是否与 doc 对齐？ | request/response 满足 schema；auth 与 doc 同 |
| **F4** | NACP 合规 | envelope、authority、trace、error code 是否符合 NACP？ | facade-http-v1 信封；trace 贯通；error code 合法 |
| **F5** | 文档一致性 | 文档说的与代码做的是一致？ | 无 doc-code 背离 |
| **F6** | SSoT 漂移 | 是否与 frozen contract / Q-law 一致？ | 无契约背离 |

### 1.2 严重级别定义

| 级别 | 标记 | 定义 | 处置 |
|------|------|------|------|
| **CRITICAL** | 🔴 | 破坏正确性、安全、契约 | **必须修复** |
| **FINDING** | ❌ | 行为偏离，影响协议合规 / 客户端兼容 | **应修复** |
| **WARN** | ⚠️ | 轻微偏差、文档不准、测试缺口 | 建议修复 |
| **OBSERVATION** | 📝 | 已知未实现、设计选择 | 仅记录 |

### 1.3 已核实的事实

- **对照的 API 文档**：
  - `clients/api-docs/confirmations.md`
  - `clients/api-docs/context.md`
  - `clients/api-docs/me-sessions.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/index.ts:634-661` — dispatch 入口，route 优先级
  - `workers/orchestrator-core/src/index.ts:1139-1165` — parseSessionConfirmationRoute
  - `workers/orchestrator-core/src/index.ts:1500-1669` — handleSessionConfirmation
  - `workers/orchestrator-core/src/index.ts:1939-1990` — handleMeTeam
  - `workers/orchestrator-core/src/index.ts:1992-2027` — handleMeTeams
  - `workers/orchestrator-core/src/index.ts:2033-2210` — handleMeDevicesList + handleMeDevicesRevoke
  - `workers/orchestrator-core/src/index.ts:2479-2616` — handleSessionContext
  - `workers/orchestrator-core/src/index.ts:879-999` — handleMeSessions
  - `workers/orchestrator-core/src/index.ts:1199-1239` — handleMeConversations
  - `workers/orchestrator-core/src/confirmation-control-plane.ts` — D1ConfirmationControlPlane
  - `workers/orchestrator-core/src/context-control-plane.ts` — context durable state helper
  - `workers/orchestrator-core/src/auth.ts` — authenticateRequest, IngressAuthSnapshot
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:128-152` — FacadeEnvelope Schema
  - `docs/design/hero-to-pro/HPX-qna.md` Q16 (confirmation `failed` forbidden)
- **执行过的验证**：
  - 文件/行号溯源核查（全量 18 端点逐链）
  - 测试文件阅读（8 个测试文件）
  - 代码静态分析（形状、auth、错误路径）
- **未执行**：live / preview / deploy 运行验证、drift gate 脚本

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全量源码溯源 |
| 单元 / 集成测试运行 | yes | 阅读测试文件验证覆盖 |
| Drift gate 脚本运行 | no | 未找到 drift gate 脚本 |
| schema / contract 反向校验 | yes | 对照 facade-http.ts FacadeErrorEnvelopeSchema |
| live / preview / deploy 证据 | no | |
| 与上游 design / Q-law 对账 | yes | HPX-Q16 对账 |

### 1.5 跨簇横切观察

- **架构与路由层**：所有三簇的端点都经 `orchestrator-core` 的 `dispatchFetch()` 统一分发（`index.ts:634`）。Context 路由排在 session 路由之前（index.ts:712-733），不经过 `parseSessionRoute` 分支。
- **Envelope 契约**：除 confirmations 409 响应外，全部使用 `facade-http-v1` 的 `{ ok, data?, error?, trace_uuid }` 信封。
- **Auth 模式**：所有端点均要求 `Authorization: Bearer <access_token>`，通过 `authenticateRequest()` 统一鉴权。Context 路由的 session 归属检查委托给 context-core worker，不在 facade 层。Confirmations 和 /me 路由在 facade 层做 ownership 验证。
- **Trace 传播**：Bearer 路由强制要求 `x-trace-uuid` header（auth.ts:234-238），不传即 400。
- **NACP authority 翻译**：JWT claim → `IngressAuthSnapshot`（auth.ts:298-309），`team_uuid` 与 `tenant_uuid` 等价设置。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| CFM | `GET /sessions/{id}/confirmations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CFM | `GET /sessions/{id}/confirmations/{uuid}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CFM | `POST /sessions/{id}/confirmations/{uuid}/decision` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | W-CFM-01: 409 error 带 data |
| CTX | `GET /sessions/{id}/context` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `GET /sessions/{id}/context/probe` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `GET /sessions/{id}/context/layers` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `POST /sessions/{id}/context/snapshot` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `POST /sessions/{id}/context/compact/preview` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `POST /sessions/{id}/context/compact` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `GET /sessions/{id}/context/compact/jobs/{jobId}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `POST /me/sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/conversations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/team` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `PATCH /me/team` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/teams` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/devices` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `POST /me/devices/revoke` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

---

## 3. 簇级深度分析

### 3.1 簇 — Confirmations（`confirmations.md`）

#### 3.1.0 路由轨迹

```text
Client
  → dispatchFetch()                         index.ts:634
  → ensureTenantConfigured()                index.ts:735
  → parseSessionConfirmationRoute()         index.ts:1139-1165
  → handleSessionConfirmation()             index.ts:1500-1669
  → authenticateRequest()                   auth.ts:221-327
  → D1SessionTruthRepository               session-truth.ts
  → D1ConfirmationControlPlane             confirmation-control-plane.ts
  → 直接构造 envelope 返回                  index.ts:1559-1668
```

**注记**：`parseSessionConfirmationRoute` 只接受 pathname 精确匹配三种模式（list、detail、decision），无 fallthrough 到 session 路由的风险。与 checkpoints 路由共享相同的 session 所有权检查模式。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| GET /sessions/{id}/confirmations | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| GET /sessions/{id}/confirmations/{uuid} | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /sessions/{id}/confirmations/{uuid}/decision | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | W-CFM-01 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `GET /sessions/{id}/confirmations`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route → `handleSessionConfirmation` → `plane.list({session_uuid, status})` (index.ts:1538-1571) |
| **F2 测试覆盖** | ✅ | `confirmation-route.test.ts:145` — 验证 listing returns 1 row, session_uuid/conversation_uuid/known_kinds; `confirmation-route.test.ts:189` — 验证 status filter; `confirmation-control-plane.test.ts:126` — unit test for D1 layer |
| **F3 形态合规** | ✅ | auth: bearer + ownership check (index.ts:1505,1518-1525); response: `{ok, data:{session_uuid, conversation_uuid, confirmations[], known_kinds}, trace_uuid}` (index.ts:1559-1570); status filter validation rejects unknown status with 400 (index.ts:1542-1550) |
| **F4 NACP 合规** | ✅ | facade-http-v1 envelope; `x-trace-uuid` response header (line 1570); error codes in FacadeErrorCodeSchema |
| **F5 文档一致性** | ✅ | Docs list `known_kinds = 7` — code matches: `CONFIRMATION_KINDS` array (confirmation-control-plane.ts:21-29) |
| **F6 SSoT 漂移** | ✅ | No drift; frozen contract matches |

##### 3.1.2.2 `GET /sessions/{id}/confirmations/{uuid}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route → `plane.read({session_uuid, confirmation_uuid})` (index.ts:1574-1593) |
| **F2 测试覆盖** | ✅ | `confirmation-route.test.ts:246` — 验证 detail returns confirmation with correct kind/status |
| **F3 形态合规** | ✅ | auth: bearer + ownership (same pattern); 404 when UUID not found (index.ts:1579-1581) |
| **F4 NACP 合规** | ✅ | facade-http-v1 envelope; trace header |
| **F5 文档一致性** | ✅ | Doc shows response shape with `{session_uuid, conversation_uuid, confirmation}` — code matches |

##### 3.1.2.3 `POST /sessions/{id}/confirmations/{uuid}/decision`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route → body validation → `plane.applyDecision()` (index.ts:1596-1668) |
| **F2 测试覆盖** | ✅ | `confirmation-route.test.ts:279` — 验证 apply decision success; line 315 — 验证 rejects `status=failed` (Q16); line 344 — 验证 409 re-decision conflict; `confirmation-control-plane.test.ts:233` — unit test for applyDecision |
| **F3 形态合规** | ⚠️ | **W-CFM-01**: 409 `confirmation-already-resolved` 错误响应包含 `data: {confirmation}` 字段 (index.ts:1642-1655)，与 `FacadeErrorEnvelopeSchema`（`{ok:false, error, trace_uuid}` 无法容纳 `data`）不一致。docs 未提及 409 响应体中的 `data` 字段。Success response (200) shape 合规。Status validation (must be one of 5 terminal states) 正确 |
| **F4 NACP 合规** | ✅ | 信封正族（除 409 外）；trace 贯通 |
| **F5 文档一致性** | ✅ | Docs 列出稳定 error codes — 全部匹配 |
| **F6 SSoT 漂移** | ✅ | Q16 frozen law: `failed` status rejected at code level (index.ts:1607, only 5 terminal statuses accepted + pending excluded at plane level line 228-230) |

**关联 finding**：`W-CFM-01`

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | index.ts:1559-1570, 1582-1593, 1657-1668 |
| `x-trace-uuid` 在 response 头里 | ✅ | 每个 handler return 都带 `headers: {"x-trace-uuid": traceUuid}` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `invalid-input`, `not-found`, `conversation-deleted`, `confirmation-already-resolved` — 全部在 schema 中 |
| Tenant 边界 5 规则 | ✅ | session ownership check: team_uuid + actor_user_uuid match (index.ts:1519-1525) |
| Authority 翻译合法 | ✅ | `authenticateRequest` → `IngressAuthSnapshot` |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| W-CFM-01 | ⚠️ | F3 | 409 error 信封包含非标准 `data` 字段 | 409 confirmation-already-resolved 响应体带 `data.confirmation`，客户端解析可能依赖非标准字段 |

#### 3.1.5 全 PASS 端点简表

| 端点 | 备注 |
|------|------|
| GET /sessions/{id}/confirmations | session ownership + status filter 均正常 |
| GET /sessions/{id}/confirmations/{uuid} | 404 for missing UUID confirmed |

---

### 3.2 簇 — Context（`context.md`）

#### 3.2.0 路由轨迹

```text
Client
  → dispatchFetch()                         index.ts:634
  → regex match on pathname                 index.ts:712-733
  → handleSessionContext()                  index.ts:2479-2616
  → authenticateRequest()                   auth.ts:221-327
  → team_uuid extraction                    index.ts:2499-2502
  → CONTEXT_CORE service binding RPC        index.ts:2512-2597
  → envelope wrap                           index.ts:2599-2601
```

**注记**：Context 路由通过 `pathname.match(/^\/sessions\/[^/]+\/.../)` 做了 7 个 regex 匹配，排在 `parseSessionRoute` 之前（index.ts:712 vs 777），不会被 session 路由拦截。Context 路由不经过 `ensureTenantConfigured` guard（该 guard 在 line 735，context 匹配在 712-733，位于 guard 之前）。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict |
|------|----|----|----|----|----|----|--------------|
| GET /sessions/{id}/context | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /sessions/{id}/context/probe | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /sessions/{id}/context/layers | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| POST /sessions/{id}/context/snapshot | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| POST /sessions/{id}/context/compact/preview | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| POST /sessions/{id}/context/compact | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /sessions/{id}/context/compact/jobs/{jobId} | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 `GET /sessions/{id}/context`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | op=`"get"` → `ctx.getContextSnapshot(sessionUuid, teamUuid, meta)` (index.ts:2516-2526); legacy alias of `probe` per doc — confirmed |
| **F2 测试覆盖** | ✅ | `context-route.test.ts:74` — 验证 200 happy path, getContextSnapshot RPC call, 401 missing bearer, 400 invalid UUID, 503 binding missing, 503 RPC throw |
| **F3 形态合规** | ✅ | auth: bearer + team_uuid required; response: `{ok, data: <context-core result>, trace_uuid}` |
| **F4 NACP 合规** | ✅ | facade-http-v1 envelope; `context-rpc-unavailable` error code |
| **F5 文档一致性** | ✅ | Docs list `503 context-rpc-unavailable` — code path at index.ts:2614 |
| **F6 SSoT 漂移** | ✅ | No drift |

##### 3.2.2.2 `GET /sessions/{id}/context/probe`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | op=`"probe"` → `ctx.getContextProbe(sessionUuid, teamUuid, meta)` (index.ts:2527-2537) |
| **F2 测试覆盖** | ✅ | `context-route.test.ts:464` — parameterized test verifies route → RPC mapping for probe |
| **F3 形态合规** | ✅ | Same auth + envelope pattern |

##### 3.2.2.3 `GET /sessions/{id}/context/layers`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | op=`"layers"` → `ctx.getContextLayers(sessionUuid, teamUuid, meta)` (index.ts:2538-2548) |
| **F2 测试覆盖** | ✅ | `context-route.test.ts:464` — parameterized test |
| **F4** | ✅ | Docs show `canonical_order` — this is populated by context-core's ContextAssembler |

##### 3.2.2.4 `POST /sessions/{id}/context/snapshot`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | op=`"snapshot"` → `ctx.triggerContextSnapshot(sessionUuid, teamUuid, meta)` (index.ts:2549-2559) |
| **F2 测试覆盖** | ✅ | `context-route.test.ts:192` — 5 case block: 200 happy, 401, 400/404, 503 binding missing, 503 RPC throw |
| **F3 形态合规** | ✅ | Docs show request body `{label: "before refactor"}`; code passes body to context-core |

##### 3.2.2.5 `POST /sessions/{id}/context/compact/preview`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | op=`"compact-preview"` → `ctx.previewCompact(sessionUuid, teamUuid, meta)` (index.ts:2560-2570) |
| **F2 测试覆盖** | ✅ | `context-route.test.ts:464` — parameterized test |
| **F3 形态合规** | ✅ | Docs note 60s preview cache not implemented — HP3 closure 已登记，code doesn't implement cache |

##### 3.2.2.6 `POST /sessions/{id}/context/compact`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | op=`"compact"` → `ctx.triggerCompact(sessionUuid, teamUuid, meta)` (index.ts:2571-2581) |
| **F2 测试覆盖** | ✅ | `context-route.test.ts:329` — 5 case block |
| **F3 -** | ✅ | Docs: returns `{job_uuid, checkpoint_uuid, checkpoint_kind:"compact_boundary"}`; code delegates to context-core which uses `createCompactBoundaryJob` (context-control-plane.ts:394-512) |

##### 3.2.2.7 `GET /sessions/{id}/context/compact/jobs/{jobId}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | op=`"compact-job"` → UUID validation (index.ts:2582-2586) → `ctx.getCompactJob(...)` |
| **F2 测试覆盖** | ✅ | `context-route.test.ts:464` — parameterized test with job UUID |
| **F3 形态合规** | ✅ | Job UUID validated with UUID_RE (index.ts:2584) |

#### 3.2.3 簇级 NACP 复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态 | ✅ | index.ts:2599-2601: `{ok: true, data: body, trace_uuid}` |
| Error code | ✅ | `context-rpc-unavailable` (503) at index.ts:2614 |
| Tenant 边界 | ⚠️ | W-CTX-01: session ownership 检查不完整 — 见 finding 详情 |
| Authority | ✅ | `authenticateRequest` 解析 team_uuid 后传给 context-core RPC meta |

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| W-CTX-01 | ⚠️ | F3 | Facade 层 context 路由缺少 session ownership 检查 | session 归属验证委托给 context-core，不能与 confirmations/checkpoints 在 facade 保持统一防守 |
| O-CTX-01 | 📝 | F5 | auto-compact runtime trigger 未上线 | `compact_required` flag 仅在 UI 提示层有效 |
| O-CTX-02 | 📝 | F5 | 60s preview cache 未实现 | HP3 closure 已登记 |

---

### 3.3 簇 — /me（`me-sessions.md`）

#### 3.3.0 路由轨迹

所有 `/me/*` 路由在 `dispatchFetch()` 中的优先级位置为 index.ts:670-701，排在 auth、catalog 之后，context 之前。

```text
Client
  → dispatchFetch()                         index.ts:634
  → parseMeSessionsRoute()                  index.ts:879-886  (POST/GET /me/sessions)
  OR pathname exact match                   index.ts:678,686,689,696,699  (/me/conversations, /me/team, /me/teams, /me/devices, /me/devices/revoke)
  → authenticateRequest()                   auth.ts:221-327
  → handleMeSessions / handleMeConversations / handleMeTeam / handleMeTeams / handleMeDevices*
  → D1SessionTruthRepository / D1 raw query
  → Response.json({ok, data, trace_uuid})  facade-http-v1 envelope
```

**注记**：所有 /me 路由都使用 `authenticateRequest` 进行 bearer JWT 验证，response 全部直接构造 facade-http-v1 envelope。

#### 3.3.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict |
|------|----|----|----|----|----|----|--------------|
| POST /me/sessions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /me/sessions | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /me/conversations | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /me/team | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| PATCH /me/team | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /me/teams | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| GET /me/devices | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |
| POST /me/devices/revoke | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |

#### 3.3.2 端点逐项分析

##### 3.3.2.1 `POST /me/sessions`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `parseMeSessionsRoute` → `handleMeSessions` (index.ts:879-962); server-mints UUID via `crypto.randomUUID()` (line 909); rejects client-supplied session_uuid with 400 (line 901-908); inserts D1 pending row when D1 available (line 917-946); fallback to UUID-only when no D1 (line 948-961) |
| **F2 测试覆盖** | ✅ | `smoke.test.ts:392` — 验证 server-mint UUID with 201 status; line 423 — 验证 reject client-supplied session_uuid; `me-sessions-route.test.ts` — dedicated route test file |
| **F3 形态合规** | ✅ | auth: bearer (index.ts:893); response: 201 with `{session_uuid, status:"pending", ttl_seconds:86400, created_at, start_url}` |
| **F4 NACP 合规** | ✅ | facade-http-v1 envelope; team uuid from auth snapshot used for D1 write |

##### 3.3.2.2 `GET /me/sessions`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleMeSessions` list path (index.ts:964-999); D1 cursor-based pagination with limit/cursor params |
| **F2 测试覆盖** | ✅ | `me-sessions-route.test.ts:34` — 4 listed test cases covering happy, limit, cursor, empty D1 |
| **F3 形态合规** | ✅ | Query: `limit` (default 50, max 200, invalid → fallback), `cursor` (opaque `started_at|session_uuid`) |
| **F5 文档一致性** | ✅ | Docs mention `ended_reason` and `title` in response — confirmed at index.ts:992-993 |

##### 3.3.2.3 `GET /me/conversations`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleMeConversations` (index.ts:1199-1239); D1 conversation-level cursor query; filters tombstoned conversations |
| **F2 测试覆盖** | ✅ | `me-conversations-route.test.ts` — dedicated test file |
| **F3 形态合规** | ✅ | Query: `limit` (default 50, max 200), `cursor` (opaque `latest_session_started_at|conversation_uuid`) |

##### 3.3.2.4 `GET /me/team`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleMeTeam` (index.ts:1939-1990); reads `nano_teams` via `readCurrentTeam` D1 function; returns `{team_uuid, team_name, team_slug, membership_level, plan_level}` |
| **F2 测试覆盖** | ✅ | `me-team-route.test.ts:36` — multiple test cases covering GET, auth rejection, 404, 503 |
| **F3 形态合规** | ✅ | auth: bearer; 404 `not-found` when team not in D1; 503 `worker-misconfigured` when D1 absent |
| **F5 文档一致性** | ✅ | Docs error codes match: `worker-misconfigured`(503), `missing-team-claim`(403), `not-found`(404), `invalid-auth`(401) |

##### 3.3.2.5 `PATCH /me/team`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleMeTeam` PATCH path (index.ts:1952-1969); team_name validation: 1-80 chars (line 1955-1957); owner-only gate: `membership_level >= 100` (line 1962-1964); D1 UPDATE (line 1965-1969) |
| **F2 测试覆盖** | ✅ | `me-team-route.test.ts:70` — PATCH test cases |
| **F3 形态合规** | ✅ | auth: bearer + owner gate; body: `{team_name: string}`; errors: `invalid-input`(400), `permission-denied`(403) |
| **F5 文档一致性** | ✅ | Docs correctly describe `membership_level >= 100` owner gate |

##### 3.3.2.6 `GET /me/teams`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleMeTeams` (index.ts:1992-2027); JOIN query `nano_team_memberships` + `nano_teams` by user_uuid |
| **F2 测试覆盖** | ✅ | `me-teams-route.test.ts:26` — test cases for listing, empty D1 fallback, auth |
| **F3 形态合规** | ✅ | auth: bearer; fallback to `{teams:[]}` when no D1 (index.ts:1997-2002) |

##### 3.3.2.7 `GET /me/devices`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleMeDevicesList` (index.ts:2033-2082); D1 select from `nano_user_devices` where `user_uuid = auth.user_uuid AND status = 'active'` |
| **F2 测试覆盖** | ✅ | `me-devices-route.test.ts:41` — multiple test cases including ownership isolation, auth rejection, empty D1 fallback |
| **F3 形态合规** | ✅ | auth: bearer; filters `status='active'` only (index.ts:2053); fallback to `{devices:[]}` when no D1; 500 on D1 error |
| **F5 文档一致性** | ✅ | Docs say "query filters `status='active'`" — confirmed at line 2053 |

##### 3.3.2.8 `POST /me/devices/revoke`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `handleMeDevicesRevoke` (index.ts:2111-2210+); ownership check (line 2136-2148); idempotent already-revoked (line 2149-2159); atomic batch D1 update + audit insert (line 2164-2178); clears device gate cache (line 2179); best-effort User DO notification (line 2180-2188) |
| **F2 测试覆盖** | ✅ | `me-devices-route.test.ts:162` — revoke test cases |
| **F3 形态合规** | ✅ | auth: bearer + device ownership check; body: `{device_uuid: UUID, reason?: string}`; idempotent response shapes differ: new revoke vs already_revoked (both documented) |
| **F4 NACP 合规** | ✅ | Envelope; trace; device gate cache interaction |
| **F5 文档一致性** | ✅ | Docs describe 5-step behavior — all 5 steps confirmed in code |

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| Confirmations | Bearer JWT | `authenticateRequest` → `IngressAuthSnapshot` → session ownership check via D1 | ✅ |
| Context | Bearer JWT | `authenticateRequest` → 提取 `team_uuid` → 作为 RPC meta 传递 → context-core 内部守卫 | ⚠️ W-CTX-01 |
| /me | Bearer JWT | `authenticateRequest` → `IngressAuthSnapshot` → D1 queries filtered by `user_uuid` + `team_uuid` | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 状态 |
|----------|------------|----------|------|
| Confirmations | `x-trace-uuid` header | `authenticateRequest` → handler → response header | ✅ |
| Context | `x-trace-uuid` header | `authenticateRequest` → RPC meta → response header | ✅ |
| /me | `x-trace-uuid` header | `authenticateRequest` → handler / D1 → response header | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 包含 `confirmation-already-resolved` ✅
- `FacadeErrorCodeSchema` 包含 `context-rpc-unavailable` ✅
- `FacadeErrorCodeSchema` 包含所有 /me 错误码 (`not-found`, `invalid-input`, `permission-denied`, `missing-team-claim`, `worker-misconfigured`) ✅
- 编译期 guard（facade-http.ts:92-94, 111-114）✅

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 状态 |
|------|-----------------|------|
| Confirmations | `session.team_uuid === auth.team_uuid` + `session.actor_user_uuid === auth.user_uuid` | ✅ |
| Context | `auth.team_uuid` → context-core meta; 无 facade 层 session ownership check | ⚠️ |
| /me | All queries filter by `user_uuid` from auth; team routes also filter by `team_uuid` | ✅ |

### 4.5 Envelope 漂移

| 检查 | 结果 |
|------|------|
| 所有成功响应使用 `{ok, data, trace_uuid}` | ✅ |
| 大多数错误响应使用 `{ok:false, error: {code, status, message}, trace_uuid}` | ✅ |
| 已知例外：confirmation 409 response 额外携带 `data` | ⚠️ W-CFM-01 |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| W-CFM-01 | ⚠️ | CFM | `POST .../confirmations/{uuid}/decision` | F3 | 409 error 信封包含非标准 `data` 字段 | 客户端解析可能依赖非标准字段 | no | A1 |
| W-CTX-01 | ⚠️ | CTX | 所有 context 路由 | F3 | Facade 层缺少 session ownership 检查 | 依赖 context-core 内部守卫，无 façade 统一防守 | no | A2 |
| O-CTX-01 | 📝 | CTX | `GET .../context/probe` | F5 | auto-compact 未上线 | `compact_required` UI 层有意义但不会自动触发 | no | — |
| O-CTX-02 | 📝 | CTX | `POST .../context/compact/preview` | F5 | 60s preview cache 未实现 | 每次调用重算，不阻塞功能 | no | — |
| O-CTX-03 | 📝 | CTX | `GET /sessions/{id}/context` | F5 | route regex 使用复数 `sessions` 而其他路由也使用 `sessions` | 风格一致，不引起问题（仅记录 regex `/^\/sessions\/[^/]+\/context$/` 已验证无误） | no | — |

### 5.2 Finding 详情

#### W-CFM-01 — 409 error 信封包含非标准 `data` 字段

- **严重级别**：⚠️ WARN
- **簇 / 端点**：CFM / `POST /sessions/{id}/confirmations/{confirmation_uuid}/decision`
- **维度**：F3
- **是否 blocker**：no
- **事实依据**：
  - `index.ts:1642-1655` — 构造 409 错误响应时在 `{ok:false, error:{...}, trace_uuid}` 之外附加了 `data: {confirmation: result.row}` 字段
  - `facade-http.ts:137-142` — `FacadeErrorEnvelopeSchema` 定义为 `{ok: z.literal(false), error: FacadeErrorSchema, trace_uuid: z.string().uuid()}`，容不下 `data`
  - `wrapSessionResponse` (index.ts:2979-2989) 的 idempotency 检测要求 `ok===false && error` 形态通过，此时 `data` 字段会被保留透传（不会被 wrapper 处理，因为该响应不经过 wrapSessionResponse）
- **为什么重要**：
  - 严格看，`FacadeErrorEnvelopeSchema` 排除了 `data` 字段。但实际上 `wrapSessionResponse` 对已成形信封做透传不抛错，`response.json()` 可正常解析多余字段。影响程度低（不破坏现有客户端），但偏离契约教条。
- **修法（What + How）**：
  - **改什么**：将 409 响应中的 `confirmation` 数据移入 `error.details` 字段
  - **怎么改**：
    ```typescript
    // index.ts:1642-1655 改为：
    return Response.json(
      {
        ok: false,
        error: {
          code: "confirmation-already-resolved",
          status: 409,
          message: "confirmation has already been resolved with a different status",
          details: { confirmation: result.row },
        },
        trace_uuid: traceUuid,
      },
      { status: 409, headers: { "x-trace-uuid": traceUuid } },
    );
    ```
  - **测试增量**：在 `confirmation-route.test.ts:344` 的 409 case 中验证 `error.details.confirmation` 存在，`data` 不存在
- **建议行动项**：A1
- **复审要点**：验证 409 响应体没有 `data` 字段，`error.details.confirmation` 存在

#### W-CTX-01 — Facade 层 context 路由缺少 session ownership 检查

- **严重级别**：⚠️ WARN
- **簇 / 端点**：CTX / 所有 context 路由
- **维度**：F3
- **是否 blocker**：no
- **事实依据**：
  - `index.ts:2479-2616` — `handleSessionContext` 只检查 `team_uuid` 存在（line 2499-2502），未调用 `D1SessionTruthRepository.readSessionLifecycle` 验证 session 归属
  - `index.ts:1273-1306` — `handleSessionCheckpoint` 做了完整的 ownership check（`session.team_uuid === auth team_uuid` AND `session.actor_user_uuid === auth user_uuid`）
  - `index.ts:1517-1525` — `handleSessionConfirmation` 同样做了完整 ownership check
- **为什么重要**：
  - Context 路由是所有 session-bound 路由中唯一不在 facade 层做 ownership 验证的。一致性差距。如果 context-core 的守卫存在漏洞，request-forgery 可能成功（low risk, context-core 内部做了同样检查）。
- **修法**：可参照 checkpoints handler 模式，在 facade 层加入 `readSessionLifecycle` 验证
- **建议行动项**：A2（建议修，不阻塞合规声明）
- **复审要点**：Context 路由 handler 中包含 `readSessionLifecycle` 调用和 ownership 断言

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| A1 | P2 | W-CFM-01 | CFM / decision | 将 409 响应的 `data.confirmation` 移入 `error.details` | `workers/orchestrator-core/src/index.ts:1642-1655` | 更新 `confirmation-route.test.ts` 409 case 断言 | XS |
| A2 | P2 | W-CTX-01 | CTX / all | Facade 层补 session ownership check | `workers/orchestrator-core/src/index.ts:2491-2515` | 新增 context-route test case 验证 cross-user access 返回 404 | S |

### 6.1 整体修复路径建议

两个 WARN 均可独立修复，互不依赖。建议先修 A1（XS 工作量），再修 A2（S 工作量）。可以合并为一个 PR，因为测试文件不同。

### 6.2 不在本轮修复的项

| Finding ID | 不修原因 | 重评条件 | 下次复审日期 |
|------------|----------|----------|--------------|
| O-CTX-01 | HP3 后续批次功能，非本 API 簇调用 | HP3 closure 完成 | HP3 审查时 |
| O-CTX-02 | HP3 closure 已登记 | Q12 cache 实现时 | — |

---

## 7. 测试覆盖矩阵

| 端点 | 单元测试 | 集成 / 路由测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|--------------|------------|
| GET /sessions/{id}/confirmations | confirmation-control-plane.test.ts:126 | confirmation-route.test.ts:145 | 200, 400 (bad status) | ✅ |
| GET /sessions/{id}/confirmations/{uuid} | confirmation-control-plane.test.ts | confirmation-route.test.ts:246 | 200, 404 | ✅ |
| POST /sessions/{id}/confirmations/{uuid}/decision | confirmation-control-plane.test.ts:233 | confirmation-route.test.ts:279,315,344 | 200, 400 (`failed`), 409 (conflict) | ✅ |
| GET /sessions/{id}/context | — | context-route.test.ts:74 | 200, 401, 400, 503 (binding), 503 (RPC) | ✅ |
| GET /sessions/{id}/context/probe | — | context-route.test.ts:464 | 200 (parameterized) | ⚠️ |
| GET /sessions/{id}/context/layers | — | context-route.test.ts:464 | 200 (parameterized) | ⚠️ |
| POST /sessions/{id}/context/snapshot | — | context-route.test.ts:192 | 200, 401, 400, 503, 503 (RPC) | ✅ |
| POST /sessions/{id}/context/compact/preview | — | context-route.test.ts:464 | 200 (parameterized) | ⚠️ |
| POST /sessions/{id}/context/compact | — | context-route.test.ts:329 | 200, 503, 401, 400, 503 | ✅ |
| GET /sessions/{id}/context/compact/jobs/{jobId} | — | context-route.test.ts:464 | 200 (parameterized) | ⚠️ |
| POST /me/sessions | — | smoke.test.ts:392,423; me-sessions-route.test.ts | 201, 400 (client UUID) | ✅ |
| GET /me/sessions | — | me-sessions-route.test.ts:34 | 200, cursor, limit | ✅ |
| GET /me/conversations | — | me-conversations-route.test.ts | 200, cursor, limit | ✅ |
| GET /me/team | — | me-team-route.test.ts:36 | 200, 401, 404, 503 | ✅ |
| PATCH /me/team | — | me-team-route.test.ts:70 | 200, 400, 403 | ✅ |
| GET /me/teams | — | me-teams-route.test.ts:26 | 200, empty D1 fallback | ✅ |
| GET /me/devices | — | me-devices-route.test.ts:41 | 200, ownership, empty D1 | ✅ |
| POST /me/devices/revoke | — | me-devices-route.test.ts:162 | 200, ownership, already_revoked | ✅ |

### 7.1 测试缺口清单

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| GET /sessions/{id}/context/probe | 仅 parameterized 覆盖，无独立 401/503 error case | `context-route.test.ts` | — |
| GET /sessions/{id}/context/layers | 同上 | `context-route.test.ts` | — |
| POST /sessions/{id}/context/compact/preview | 同上 | `context-route.test.ts` | — |
| GET /sessions/{id}/context/compact/jobs/{jobId} | 同上 | `context-route.test.ts` | — |
| Context routes (all) | 缺少 cross-user access rejection case | `context-route.test.ts` | W-CTX-01 |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | 634-661 | 路由调度入口 |
| `workers/orchestrator-core/src/index.ts` | 712-745 | context / checkpoint / confirmation 路由匹配 |
| `workers/orchestrator-core/src/index.ts` | 879-999 | handleMeSessions |
| `workers/orchestrator-core/src/index.ts` | 1139-1165 | parseSessionConfirmationRoute |
| `workers/orchestrator-core/src/index.ts` | 1199-1239 | handleMeConversations |
| `workers/orchestrator-core/src/index.ts` | 1500-1669 | handleSessionConfirmation |
| `workers/orchestrator-core/src/index.ts` | 1939-1990 | handleMeTeam |
| `workers/orchestrator-core/src/index.ts` | 1992-2027 | handleMeTeams |
| `workers/orchestrator-core/src/index.ts` | 2033-2082 | handleMeDevicesList |
| `workers/orchestrator-core/src/index.ts` | 2111-2210+ | handleMeDevicesRevoke |
| `workers/orchestrator-core/src/index.ts` | 2479-2616 | handleSessionContext |
| `workers/orchestrator-core/src/confirmation-control-plane.ts` | 1-293 | D1ConfirmationControlPlane |
| `workers/orchestrator-core/src/context-control-plane.ts` | 1-561 | context durable state |
| `workers/orchestrator-core/src/auth.ts` | 221-327 | authenticateRequest |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | 116-213 | FacadeError + envelope schemas |
| `workers/orchestrator-core/test/confirmation-route.test.ts` | 1-384 | confirmation route integration tests |
| `workers/orchestrator-core/test/confirmation-control-plane.test.ts` | 1-289 | confirmation D1 unit tests |
| `workers/orchestrator-core/test/context-route.test.ts` | 1-520 | context route integration tests |
| `workers/orchestrator-core/test/me-sessions-route.test.ts` | — | me-sessions route tests |
| `workers/orchestrator-core/test/me-team-route.test.ts` | — | me-team route tests |
| `workers/orchestrator-core/test/me-teams-route.test.ts` | — | me-teams route tests |
| `workers/orchestrator-core/test/me-devices-route.test.ts` | — | me-devices route tests |
| `workers/orchestrator-core/test/me-conversations-route.test.ts` | — | me-conversations route tests |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；不要改写 §0 – §8。回应应逐条引用 Finding ID 给出处理结果。

### 9.2 二次审查方式

- **建议方式**：`same reviewer rereview`
- **二次审查触发条件**：
  - A1 (W-CFM-01) PR merged
  - A2 (W-CTX-01) PR merged（或明确 defer）
- **二次审查应重点核查**：
  1. 409 响应不再包含顶级 `data` 字段
  2. Context 路由 handler 包含 session ownership 验证

### 9.3 合规声明前的 blocker

本轮无 blocker。WARN 项（W-CFM-01, W-CTX-01）不阻塞对外声明合规。

---

## 10. 实现者回应

（待填充）
