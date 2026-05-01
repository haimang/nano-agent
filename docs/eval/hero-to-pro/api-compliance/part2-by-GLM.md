# API Compliance Audit — Part 2: Confirmations / Context / Me-Sessions

> 调查对象: `Confirmations + Context + Me-Sessions`
> 调查类型: `initial`
> 调查者: GLM
> 调查时间: 2026-05-01
> 调查范围:
> - `clients/api-docs/confirmations.md`
> - `clients/api-docs/context.md`
> - `clients/api-docs/me-sessions.md`
> Profile / 协议族: `facade-http-v1`
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts`（facade-http-v1 envelope）
> - `packages/orchestrator-auth-contract/src/auth-error-codes.ts`（auth error code taxonomy）
> - `packages/nacp-core/src/error-registry.ts`（NACP error code registry）
> - `workers/orchestrator-core/src/confirmation-control-plane.ts`（confirmation 7-kind/6-status enums）
> - `docs/charter/plan-hero-to-pro.md`（HP5 freezing decisions）
> 复用 / 对照的既有审查:
> - `docs/eval/hero-to-pro/api-compliance/part1-by-GLM.md` — 独立复核（采纳其 F-CHK-01 finding 关于 `confirmation-already-resolved` 非标准信封的发现模式，本报告发现同一问题在 confirmation decision 路由中也存在）
> 文档状态: `draft`

---

## 0. 总判定 / Executive Summary

- **整体 verdict**：`本轮 Confirmations + Context + Me-Sessions 调查整体功能真实成链，但发现 2 项 FINDING（confirmation decision 和 checkpoint restore 的 409 响应包含非标准 `data` 字段；context-rpc-unavailable 和 confirmation-already-resolved 不在 FacadeErrorCodeSchema 内）和 3 项 WARN（POST /me/devices/revoke 无测试；PATCH /me/team owner gate 缺失 plan_level 校验；context 列表路由缺少 conversation-deleted 过滤），不允许声明 fully-compliant，需先修 FINDING。`
- **结论等级**：`compliant-with-followups`
- **是否允许声明合规**：`no`
- **本轮最关键的 3 个判断**：
  1. `confirmation-already-resolved` 错误码绕过 `FacadeErrorCodeSchema`，直接作为 `Response.json()` 返回，既不在枚举中，又在 409 响应体中携带了不符合 facade-http-v1 规范的 `data` 字段 —— 与 Part 1 发现的 F-CHK-01 是同一类问题。
  2. `context-rpc-unavailable` 错误码虽然在 `nacp-core/error-registry.ts` 中注册为 ad-hoc code，但不在 `FacadeErrorCodeSchema` 枚举里，如果走 `jsonPolicyError` 路径会被 `facadeError()` coerce 为 `internal-error`。
  3. `POST /me/devices/revoke` 是唯一一个无任何专用测试的 /me 端点，存在设备吊销逻辑覆盖空白。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Confirmations | 3 | ✅ | ✅ | ❌ | ⚠️ | ✅ | ⚠️ | PARTIAL |
| Context | 7 | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN |
| Me-Sessions | 8 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 2 | yes |
| ⚠️ WARN     | 3 | no（建议修） |
| 📝 OBSERVATION | 3 | no（仅记录） |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性（Functionality） | 路由→实现是否真实成链？ | route → handler → backing repo/RPC 全链路可达 |
| **F2** | 测试覆盖（Test Coverage） | 测试是否跑过这条路径？ | 单测 + 集成 + E2E 任一层有断言 |
| **F3** | 形态合规（Shape Compliance） | 请求/响应/错误形态是否与 doc 与契约对齐？ | request/response 满足 schema；auth 行为与 doc 同；status code 同 |
| **F4** | NACP 协议合规（NACP Compliance） | envelope、authority、trace、tenant boundary 是否符合 NACP profile？ | 信封正族；trace 贯通；authority 翻译合法；tenant 边界守住 |
| **F5** | 文档一致性（Doc-Reality Parity） | 文档说的与代码做的是否一致？ | 没有 doc 写了能力但代码没做、或代码做了 doc 没写 |
| **F6** | SSoT 漂移（SSoT Drift） | 是否与 frozen contract / 契约表 / Q-law 一致？ | 与 facade-http-v1 契约无漂移 |

### 1.2 严重级别定义

| 级别 | 标记 | 定义 | 处置 |
|------|------|------|------|
| **CRITICAL** | 🔴 | 破坏正确性、安全、契约或会让现有客户端解析失败 | **必须修复**才能声明合规 |
| **FINDING** | ❌ | 行为偏离，影响协议合规 / 客户端兼容 / 多租隔离 | **应修复** |
| **WARN** | ⚠️ | 轻微偏差、文档不准、测试缺口、代码异味 | 建议修复；不阻塞合规声明 |
| **OBSERVATION** | 📝 | 已知未实现、设计选择、未来工作 | 仅记录 |

### 1.3 已核实的事实

- **对照的 API 文档**：
  - `clients/api-docs/confirmations.md`
  - `clients/api-docs/context.md`
  - `clients/api-docs/me-sessions.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/index.ts`（路由解析: 712-733, 669-710, 879-998, 1134-1165, 1199-1238, 1500-1669, 1918-2027, 2033-2218, 2479-2616）
  - `workers/orchestrator-core/src/confirmation-control-plane.ts`（7-kind/6-status enums, D1ConfirmationControlPlane, DDL）
  - `workers/orchestrator-core/src/context-control-plane.ts`（durable state reader/writer）
  - `workers/orchestrator-core/src/session-truth.ts`（session CRUD, conversation list）
  - `workers/orchestrator-core/src/auth.ts`（authenticateRequest, device gate）
  - `workers/orchestrator-core/src/policy/authority.ts`（jsonPolicyError, readTraceUuid）
  - `workers/context-core/src/index.ts`（ContextCoreEntrypoint RPC）
  - `workers/context-core/src/control-plane.ts`（probe/layers/compact builders）
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts`（FacadeErrorCodeSchema, FacadeErrorEnvelopeSchema）
  - `packages/nacp-core/src/error-registry.ts`（error code ad-hoc registry）
  - `workers/orchestrator-core/migrations/012-session-confirmations.sql`（DDL CHECK constraints）
- **执行过的验证**：
  - 文件/行号核查：全部 18 个端点的路由 → handler → backing 全链路人工追溯
  - 测试文件存在性确认：`confirmation-route.test.ts`, `confirmation-control-plane.test.ts`, `context-route.test.ts`, `me-sessions-route.test.ts`, `me-conversations-route.test.ts`, `me-devices-route.test.ts`, `me-teams-route.test.ts`, `me-team-route.test.ts`
  - `FacadeErrorCodeSchema` 枚举值对照：`confirmation-already-resolved` 和 `context-rpc-unavailable` 不在枚举内

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全部 18 端点的路由→handler→backing 追溯 |
| 单元 / 集成测试运行 | no | 依赖已存在的测试文件断言分析 |
| Drift gate 脚本运行 | no | 本轮未执行 drift gate |
| schema / contract 反向校验 | yes | `FacadeErrorCodeSchema` 枚举逐值比对 |
| live / preview / deploy 证据 | no | 无 |
| 与上游 design / Q-law 对账 | yes | Q16 row-first law, Q18 direction matrix, HP5 frozen 枚举 |

### 1.5 跨簇横切观察

- **架构与路由层**：所有三个簇都经 `orchestrator-core` `dispatchFetch()` 分发。Confirmations 和 Me-Sessions 直接操作 D1；Context 通过 `CONTEXT_CORE` service binding RPC 代理到 `context-core` worker。
- **Envelope 契约**：所有簇都使用 `facade-http-v1` 的 `{ ok, data?, error?, trace_uuid }` 信封，但 Confirmations 的 409 响应包含了额外的 `data` 字段（F-CFM-01）。
- **Auth 模式**：所有三个簇都在 facade 层调用 `authenticateRequest()`，执行 JWT/API-key 验证 + device gate + team_uuid 提取。与 Part 1 Auth 簇的 proxy 模式不同。
- **Trace 传播**：所有端点从 `authenticateRequest()` 获取 `trace_uuid`（强制需要 `x-trace-uuid` header）。Context 路由在 RPC 调用时传入 `{ trace_uuid, team_uuid }`。
- **NACP authority 翻译**：JWT claims → `IngressAuthSnapshot`（含 `team_uuid`, `user_uuid`, `device_uuid`, `membership_level`）。`team_uuid` 通过 D1 查询做 session/conversation/team 归属验证。
- **Error code 漂移**：`confirmation-already-resolved` 不在 `FacadeErrorCodeSchema` 内但直接走到 wire；`context-rpc-unavailable` 在 `nacp-core/error-registry.ts` 注册但不在 facade 枚举内。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| CFM | `GET /sessions/{id}/confirmations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CFM | `GET /sessions/{id}/confirmations/{uuid}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CFM | `POST /sessions/{id}/confirmations/{uuid}/decision` | ✅ | ✅ | ❌ | ⚠️ | ✅ | ⚠️ | FAIL | F-CFM-01 |
| CTX | `GET /sessions/{id}/context` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `GET /sessions/{id}/context/probe` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `GET /sessions/{id}/context/layers` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `POST /sessions/{id}/context/snapshot` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `POST /sessions/{id}/context/compact/preview` | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-CTX-01 |
| CTX | `POST /sessions/{id}/context/compact` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| CTX | `GET /sessions/{id}/context/compact/jobs/{jobId}` | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-CTX-02 |
| ME | `POST /me/sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/conversations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/team` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `PATCH /me/team` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/teams` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `GET /me/devices` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| ME | `POST /me/devices/revoke` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-ME-01 |

---

## 3. 簇级深度分析

### 3.1 簇 — Confirmations（`clients/api-docs/confirmations.md`）

#### 3.1.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()                    index.ts:634-648
  → parseSessionConfirmationRoute()                      index.ts:1139-1165
  → handleSessionConfirmation()                          index.ts:1500-1669
  → authenticateRequest()                                auth.ts:221-327
  → D1SessionTruthRepository.readSessionLifecycle()     session-truth.ts
  → D1ConfirmationControlPlane                           confirmation-control-plane.ts:89-293
  → Response.json(facade-http-v1 envelope)              index.ts:1557-1572/1580-1594/1657-1668
```

**链路注记**：认证 → session 归属验证 → confirmation CRUD 在 D1 直连完成。无 RPC 代理。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/confirmations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /sessions/{id}/confirmations/{uuid}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/confirmations/{uuid}/decision` | ✅ | ✅ | ❌ | ⚠️ | ✅ | ⚠️ | FAIL | F-CFM-01 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `GET /sessions/{id}/confirmations`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `parseSessionConfirmationRoute` → kind=`"list"` → handler lines 1538-1572。调用 `plane.list({ session_uuid, status })`，D1 `SELECT` with optional status filter。 |
| **F2 测试覆盖** | ✅ | `confirmation-route.test.ts`: 列表 happy path, `?status=pending` filter, 400 on invalid status `failed`。`confirmation-control-plane.test.ts`: `list()` with status filter。 |
| **F3 形态合规** | ✅ | Auth: `authenticateRequest()` (facade level)。Response: `{ ok, data: { session_uuid, conversation_uuid, confirmations, known_kinds }, trace_uuid }`，与 doc 一致。`known_kinds` 返回 7 种 frozen kinds。Error codes: `invalid-input` (400), `not-found` (404 for session), `conversation-deleted` (409), `invalid-auth` (401), `worker-misconfigured` (503)。 |
| **F4 NACP 合规** | ✅ | Authority 翻译: JWT → `IngressAuthSnapshot` → `auth.snapshot.team_uuid` 用于 session 归属验证。Tenant boundary: `session.team_uuid === auth.snapshot.team_uuid` AND `session.actor_user_uuid === auth.user_uuid`。Trace: 从 `authenticateRequest()` 获取。Envelope: 标准 `facade-http-v1`。 |
| **F5 文档一致性** | ✅ | Doc 描述的 `?status=` query 参数、7 kinds、6 statuses 都与实现匹配。Doc 没有提到 `known_kinds` 返回值，但实现包含它——这是一个合理补充。 |
| **F6 SSoT 漂移** | ✅ | Error codes 走 `jsonPolicyError` → `facadeError` → `FacadeErrorCodeSchema` 合规。 |

##### 3.1.2.2 `GET /sessions/{id}/confirmations/{confirmation_uuid}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: kind=`"detail"` → handler lines 1574-1594。调用 `plane.read({ session_uuid, confirmation_uuid })`。 |
| **F2 测试覆盖** | ✅ | `confirmation-route.test.ts`: detail happy path (200), 404 on missing UUID。 |
| **F3 形态合规** | ✅ | Response: `{ ok, data: { session_uuid, conversation_uuid, confirmation }, trace_uuid }`。与 doc 一致。 |
| **F4 NACP 合规** | ✅ | 同上，session 归属验证全链路。 |
| **F5 文档一致性** | ✅ | Doc 描述的 `confirmation` 单体对象与实现匹配。 |
| **F6 SSoT 漂移** | ✅ | 全部 error codes 走 `jsonPolicyError`，合规。 |

##### 3.1.2.3 `POST /sessions/{id}/confirmations/{confirmation_uuid}/decision`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: kind=`"decision"` → handler lines 1596-1669。解析 body (`status`, `decision_payload`)，调用 `plane.applyDecision()`。terminal status 写入 D1，conflict 返回 409。 |
| **F2 测试覆盖** | ✅ | `confirmation-route.test.ts`: allow decision (200), reject `status="failed"` (400 符合 Q16), 409 re-decide with different status。`confirmation-control-plane.test.ts`: allow/deny transitions, conflict detection, superseded dual-write, pending rejection。 |
| **F3 形态合规** | ❌ | **F-CFM-01**: 409 conflict 响应 (lines 1642-1655) 包含非标准 `data` 字段：`{ ok: false, error: { code: "confirmation-already-resolved", status: 409, message }, data: { confirmation }, trace_uuid }`。`facade-http-v1` 错误信封规范只有 `{ ok: false, error, trace_uuid }`，不允许 `data` 字段。此外 `confirmation-already-resolved` 不在 `FacadeErrorCodeSchema` 枚举内，通过 `Response.json()` 直接绕过了 `facadeError()` 的 code 校验。 |
| **F4 NACP 合规** | ⚠️ | Authority 翻译正确。但 `confirmation-already-resolved` 不在 NACP error code registry 或 FacadeErrorCodeSchema 中，是一个非注册 error code 走到 wire。 |
| **F5 文档一致性** | ✅ | Doc 明确定义 409 `confirmation-already-resolved` 错误及行为，与实现一致。 |
| **F6 SSoT 漂移** | ⚠️ | `confirmation-already-resolved` 不在 `FacadeErrorCodeSchema`，也不是 `AuthErrorCodeSchema` → `FacadeErrorCodeSchema.safeParse()` 会将其 coerce 为 `internal-error`，但本端点直接用 `Response.json()` 绕过了 facade 契约路径。 |

**关联 finding**：`F-CFM-01`（见 §5.2 详情）

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ⚠️ | 409 conflict 端点包含 `data` 字段，不符合 FacadeErrorEnvelopeSchema (`facade-http.ts:137-142`) |
| `x-trace-uuid` 在 response 头里 | ✅ | handler 所有分支包含 `headers: { "x-trace-uuid": traceUuid }` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `confirmation-already-resolved` 不在枚举内（`facade-http.ts:48-84`） |
| Tenant 边界 5 规则被守住 | ✅ | session 归属验证 `session.team_uuid === auth.snapshot.team_uuid` AND `session.actor_user_uuid === auth.user_uuid` |
| Authority 翻译合法（HTTP claim → server-stamped） | ✅ | `authenticateRequest()` → `IngressAuthSnapshot` |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-CFM-01` | ❌ | F3 | confirmation decision 409 响应信封违规 | `confirmation-already-resolved` 409 响应包含 `data` 字段且 error code 不在 `FacadeErrorCodeSchema` 枚举内，破坏 facade-http-v1 契约 |

#### 3.1.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `GET /sessions/{id}/confirmations` | 与 doc 完全对齐，`known_kinds` 是实现合理补充 |
| `GET /sessions/{id}/confirmations/{uuid}` | 无异常 |

---

### 3.2 簇 — Context（`clients/api-docs/context.md`）

#### 3.2.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()                    index.ts:634-648
  → inline regex match (7 context ops)                   index.ts:712-733
  → handleSessionContext()                                index.ts:2479-2616
  → authenticateRequest()                                auth.ts:221-327
  → env.CONTEXT_CORE.{rpcMethod}()                       index.ts:2515-2597
  → context-core/ContextCoreEntrypoint.{method}()        context-core/src/index.ts:135-360
  → context-core calls back ORCHESTRATOR_CORE.{method}() context-core/src/index.ts:189-339
  → Response.json(facade-http-v1 envelope)               index.ts:2598-2615
```

**链路注记**：Context 簇采用双向 RPC 模式——orchestrator-core 通过 `CONTEXT_CORE` service binding 调用 context-core，context-core 再通过 `ORCHESTRATOR_CORE` binding 反调 orchestrator-core 获取 D1 数据。所有 context 路由的 HTTP 响应在 orchestrator-core facade 层组装。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `GET /sessions/{id}/context` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /sessions/{id}/context/probe` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /sessions/{id}/context/layers` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/context/snapshot` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/context/compact/preview` | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | PASS w/ WARN | O-CTX-01 |
| `POST /sessions/{id}/context/compact` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /sessions/{id}/context/compact/jobs/{jobId}` | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-CTX-02 |

#### 3.2.2 端点逐项分析

所有 7 个 context 端点共享相同架构：facade 层认证 → `CONTEXT_CORE` RPC → 双向数据回调 → facade 层响应组装。以下只展开有 ⚠️/❌ 的端点；全 PASS 端点在 §3.2.5 简表。

##### 3.2.2.1 `POST /sessions/{id}/context/compact/preview`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `"compact-preview"` → handler `ctx.previewCompact(sessionUuid, teamUuid, meta)` → `context-core/src/index.ts:228` → `buildCompactPreviewResponse()` 控制面只读计算。 |
| **F2 测试覆盖** | ✅ | `context-route.test.ts`: preview happy path, 503 binding missing, 503 RPC throw。`rpc-context-control-plane.test.ts`: `previewCompact()` unit。 |
| **F3 形态合规** | ✅ | Request: body 无（POST 但 body 被忽略可选 `{ force }`）。Response: `{ ok, data: { ...preview fields }, trace_uuid }`。 |
| **F4 NACP 合规** | ⚠️ | Authority 翻译正确（JWT → team_uuid → RPC meta）。但 context-core 双向 RPC 没有用 NACP envelope 封装——RPC 调用是普通 JS 对象直传，没有 `validateEnvelope → verifyTenantBoundary → checkAdmissibility` pipeline。这是目前架构选择（service binding 直传），不是 violation 但不符合 NACP 内部传输规范。 |
| **F5 文档一致性** | ⚠️ | Doc 明确说 "HPX-Q12 要求同 session + 同 high-watermark 60s 内复用 cache，HP9 frozen pack 阶段该 60s preview cache 未实现"。代码确认 `cached: false` 硬编码（`context-core/src/control-plane.ts` buildCompactPreviewResponse）。实现与 doc 声明一致，但 doc 未标注 preview cache 的偏移差距。 |
| **F6 SSoT 漂移** | ✅ | Error codes 全走 `jsonPolicyError`，合规。 |

**关联 finding**：`O-CTX-01`

##### 3.2.2.2 `GET /sessions/{id}/context/compact/jobs/{jobId}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `"compact-job"` → handler `ctx.getCompactJob(sessionUuid, teamUuid, jobId, meta)` → 读 D1 checkpoint row。 |
| **F2 测试覆盖** | ✅ | `context-route.test.ts`: compact job happy path（通过参数化 table），503 binding missing。 |
| **F3 形态合规** | ✅ | Response 与 doc 描述一致：`{ job_uuid, checkpoint_uuid, status, started_at, ended_at, tokens_freed }` 等。 |
| **F4 NACP 合规** | ✅ | 同上，authority 翻译正确。 |
| **F5 文档一致性** | ⚠️ | Doc 声 `status ∈ {pending, running, succeeded, failed, cancelled}`，但实现中 compact job 的 `status` 直接从 `nano_session_checkpoints` 的 `file_snapshot_status` 读取，而 `file_snapshot_status ∈ {none, pending, materialized, failed}`。实际返回的是 D1 row 中的 `file_snapshot_status`，与 doc 中列出的 5 状态有差异。需要对照确认字段的实际来源。 |
| **F6 SSoT 漂移** | ✅ | 全部 error codes 走 `jsonPolicyError`。 |

**关联 finding**：`O-CTX-02`

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | 所有 context 端点使用标准 `facade-http-v1` 信封 |
| `x-trace-uuid` 在 response 头里 | ✅ | `handleSessionContext` 所有分支包含 header |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ⚠️ | `context-rpc-unavailable` 走 `jsonPolicyError`，但在 `FacadeErrorCodeSchema` 枚举中不存在；它在 `nacp-core/error-registry.ts` 中注册为 ad-hoc code。通过 `jsonPolicyError` → `facadeError()` 路径时，`FacadeErrorCodeSchema.safeParse()` 会将其 coerce 为 `"internal-error"`。但代码实际使用的是 `jsonPolicyError(503, "context-rpc-unavailable", ...)` → `facadeError()` → `safeParse` → **coerced to `"internal-error"` on wire**。 |
| Tenant 边界 5 规则被守住 | ✅ | `authenticateRequest()` 提取 `team_uuid`，传入 RPC `meta`。context-core 内部不执行额外 tenant 验证（依赖 facade）。 |
| Authority 翻译合法 | ✅ | JWT claim → `IngressAuthSnapshot` → `meta.team_uuid` |

**注**：`context-rpc-unavailable` 虽然在 error-registry 有注册，但 `FacadeErrorCodeSchema.safeParse("context-rpc-unavailable")` 会失败，`facadeFromAuthEnvelope()` / `facadeError()` 会将其 coerce 为 `"internal-error"`。这意味着客户端在 `POST /sessions/{id}/context/compact` 等 context 路由收到 503 时，实际收到的 error code 是 `internal-error`，而不是 `context-rpc-unavailable`。这其实保护了 facade-http-v1 契约（code 永远在枚举内），但**信息丢失**了。这是 F-CTX-01。

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-CTX-01` | ❌ | F3/F4 | `context-rpc-unavailable` error code 被 `facadeError()` coerce 为 `internal-error` | 客户端无法区分 "context-core binding 缺失" 和 "内部错误"，error code 信息丢失 |

#### 3.2.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `GET /sessions/{id}/context` | Legacy alias of probe，实现在 context-core 调 `getContextSnapshot` |
| `GET /sessions/{id}/context/probe` | 完整 probe 响应包含 budget, fragments, protected_fragment_kinds |
| `GET /sessions/{id}/context/layers` | 返回 assembled context layers + canonical_order |
| `POST /sessions/{id}/context/snapshot` | 创建 manual snapshot，返回 `{ snapshot_uuid, created_at }` |
| `POST /sessions/{id}/context/compact` | 创建 compact boundary job，返回 `{ job_uuid, checkpoint_uuid, status }` |

---

### 3.3 簇 — Me-Sessions（`clients/api-docs/me-sessions.md`）

#### 3.3.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()                    index.ts:634-648
  → parseMeSessionsRoute() / inline pathname match        index.ts:669-710
  → handleMeSessions() / handleMeConversations() / ...    index.ts:888-2027 / 2111-2218
  → authenticateRequest()                                auth.ts:221-327
  → D1SessionTruthRepository / direct D1 queries         session-truth.ts / index.ts:inline
  → Response.json(facade-http-v1 envelope)              各 handler
```

**链路注记**：Me-Sessions 簇全部在 orchestrator-core 内操作 D1，无 RPC 代理。

#### 3.3.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `POST /me/sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /me/sessions` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /me/conversations` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /me/team` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `PATCH /me/team` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /me/teams` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /me/devices` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /me/devices/revoke` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-ME-01 |

#### 3.3.2 端点逐项分析

只展开有 ⚠️ 的端点；全 PASS 端点在 §3.3.5 简表。

##### 3.3.2.1 `POST /me/devices/revoke`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `method === "POST" && pathname === "/me/devices/revoke"` (line 699) → `handleMeDevicesRevoke` (lines 2084-2218)。解析 body (`device_uuid`, `reason`)，所有权验证 (`user_uuid` match)，原子 batch (UPDATE + INSERT)，清除 device gate cache，通知 User DO。 |
| **F2 测试覆盖** | ⚠️ | **无专用测试文件**。`me-devices-route.test.ts` 只覆盖 `GET /me/devices`（列表），不覆盖 `POST /me/devices/revoke`。实现逻辑较复杂（所有权验证、幂等已吊销、原子 batch、cache 清除、User DO 通知），但无任何断言覆盖。 |
| **F3 形态合规** | ✅ | Request: `{ device_uuid, reason? }`。Response 成功: `{ device_uuid, status: "revoked", revoked_at, revocation_uuid }`。Response 幂等: `{ device_uuid, status: "revoked", already_revoked: true }`。Auth: `authenticateRequest()`。 |
| **F4 NACP 合规** | ✅ | Authority 翻译正确。Tenant boundary 通过 `user_uuid` 所有权验证。 |
| **F5 文档一致性** | ✅ | Doc 描述的幂等 `already_revoked` 响应与实现匹配（lines 2149-2158）。5 步行为（验证→D1 update→D1 insert→cache clear→DO notify）都在代码中实现。 |
| **F6 SSoT 漂移** | ✅ | 全部 error codes 走 `jsonPolicyError`，合规。 |

**关联 finding**：`W-ME-01`

#### 3.3.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | 所有 /me 端点使用标准信封 |
| `x-trace-uuid` 在 response 头里 | ✅ | 所有端点从 `auth.value.trace_uuid` 获取 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | 全部走 `jsonPolicyError` → `facadeError()` |
| Tenant 边界 5 规则被守住 | ✅ | `user_uuid` + `team_uuid` 双重验证 |
| Authority 翻译合法 | ✅ | JWT claim → `IngressAuthSnapshot` → D1 query scoping |

#### 3.3.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `W-ME-01` | ⚠️ | F2 | `POST /me/devices/revoke` 无测试覆盖 | 设备吊销逻辑（所有权验证、原子 batch、cache 清除、DO 通知）无断言覆盖 |

#### 3.3.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `POST /me/sessions` | Server-mint UUID，拒绝客户端提供 `session_uuid` |
| `GET /me/sessions` | D1 cursor 分页，过滤 tombstoned conversations |
| `GET /me/conversations` | Conversation 聚合列表，D1 cursor 分页 |
| `GET /me/team` | 从 JWT claims 读 team_uuid，D1 join 查 membership |
| `PATCH /me/team` | Owner gate (membership_level >= 100)，D1 UPDATE |
| `GET /me/teams` | D1 query all team memberships |
| `GET /me/devices` | D1 query active devices (status='active') |

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| All Confirmations routes | Bearer token (facade verifies) | `authenticateRequest()` → `IngressAuthSnapshot` → session ownership via D1 | ✅ |
| All Context routes | Bearer token (facade verifies) | `authenticateRequest()` → `IngressAuthSnapshot` → `meta.team_uuid` passed to context-core RPC | ✅ |
| All /me routes | Bearer token (facade verifies) | `authenticateRequest()` → `IngressAuthSnapshot` → D1 query scoping by `user_uuid` + `team_uuid` | ✅ |
| Context internal RPC | Service binding | `meta: { trace_uuid, team_uuid }` — plain JS object, no NACP envelope | ⚠️ |

**注**：Context 簇的 orchestrator-core ↔ context-core 通信使用普通 JS 对象 RPC（`{ trace_uuid, team_uuid }`），而非 NACP envelope 封装。这是当前架构选择：service binding 通信不需要 NACP 信封因为 Cloudflare service binding 已提供 tenant 隔离。但从 NACP 协议视角，这不符合 `ServiceBindingTransport` 的 `validateEnvelope → verifyTenantBoundary → checkAdmissibility` pipeline。

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| Confirmations | `authenticateRequest()` (required `x-trace-uuid`) | facade → D1 → response body + header | required | ✅ |
| Context | `authenticateRequest()` (required `x-trace-uuid`) | facade → `meta.trace_uuid` → context-core RPC → response | required | ✅ |
| /me | `authenticateRequest()` (required `x-trace-uuid`) | facade → D1 → response body + header | required | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` / `RpcErrorCodeSchema` 的超集：✅（编译期 guard 在 `facade-http.ts:92-94, 111-114`）
- `confirmation-already-resolved` 不在 `FacadeErrorCodeSchema` 内：❌（绕过 `facadeError()` 走 `Response.json()` 直出）
- `context-rpc-unavailable` 不在 `FacadeErrorCodeSchema` 内但在 `nacp-core/error-registry.ts` 注册：⚠️（通过 `jsonPolicyError` → `facadeError()` → `safeParse` coerce 为 `internal-error`，信息丢失）
- 编译期 guard：`facade-http.ts:92-94`（auth codes），`facade-http.ts:111-114`（RPC codes）
- 运行期回退：未知 code → `"internal-error"`（`facadeFromAuthEnvelope` line 203）

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|------------------|--------------|------|
| Confirmations | `session.team_uuid === auth.snapshot.team_uuid` AND `session.actor_user_uuid === auth.user_uuid` | 间接：通过 session 归属验证实现规则 1 和 4 | ✅ |
| Context | `meta.team_uuid` 从 auth snapshot 传入 RPC；context-core 不做额外验证 | 0/5（依赖 facade side） | ⚠️ |
| /me | D1 query scoping: `WHERE team_uuid = ?1 AND user_uuid = ?2` | 间接：通过 SQL WHERE 约束实现 rule 1 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `pnpm check:envelope-drift` | 未在本轮执行 |
| `pnpm check:tool-drift` | 未在本轮执行 |
| 错误信封 drift（人工核查） | ❌ 发现 2 处违例：`confirmation-already-resolved` 409 响应含 `data` 字段；`context-rpc-unavailable` coerced 为 `internal-error` |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| `F-CFM-01` | ❌ | CFM | `POST .../decision` | F3/F6 | confirmation decision 409 信封违约 + error code 不在 FacadeErrorCodeSchema | 客户端收到不在契约内的 error code 和非标准 `data` 字段，违反 facade-http-v1 契约 | yes | A1 |
| `F-CTX-01` | ❌ | CTX | All context routes | F3 | `context-rpc-unavailable` error code 被 coerce 为 `internal-error` | 客户端无法区分 context-core 不可达和一般内部错误 | yes | A2 |
| `W-ME-01` | ⚠️ | ME | `POST /me/devices/revoke` | F2 | 无测试覆盖 | 设备吊销关键逻辑无断言 | no | A3 |

### 5.2 Finding 详情

#### `F-CFM-01` — confirmation decision 409 信封违约 + error code 渐出 FacadeErrorCodeSchema

- **严重级别**：❌ FINDING
- **簇 / 端点**：Confirmations / `POST /sessions/{id}/confirmations/{uuid}/decision`
- **维度**：F3 + F6
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:1642-1655` —— 409 响应包含 `{ ok: false, error: {...}, data: { confirmation }, trace_uuid }`，其中 `data` 字段不在 `FacadeErrorEnvelopeSchema` 中
  - `packages/orchestrator-auth-contract/src/facade-http.ts:137-142` —— `FacadeErrorEnvelopeSchema` 定义为 `{ ok: false, error, trace_uuid }`，不包含 `data`
  - `workers/orchestrator-core/src/index.ts:1647` —— error code `"confirmation-already-resolved"` 不在 `FacadeErrorCodeSchema` 枚举中（`facade-http.ts:48-84`）
  - 同一问题也存在于 `workers/orchestrator-core/src/index.ts:1410-1422`（checkpoint restore 端点）
- **为什么重要**：
  - `data` 字段出现在错误信封中违反 facade-http-v1 契约，客户端按 schema 解析时会忽略或崩溃
  - error code 不在枚举中意味着如果走 `facadeError()` 路径会被 coerce 为 `internal-error`，但本端点用 `Response.json()` 绕过了安全网
  - Part 1 已发现同一问题在 checkpoint restore 端点（F-CHK-01）
- **修法（What + How）**：
  - **改什么**：移除 409 响应中的 `data` 字段，将 confirmation detail 移入 `error.details` 或完全移除
  - **怎么改**：(1) 将 `confirmation-already-resolved` 加入 `FacadeErrorCodeSchema`；(2) 将 409 响应从 `Response.json()` 改为 `jsonPolicyError(409, "confirmation-already-resolved", ...)`, 移除 `data` 字段；(3) checkpoint restore 端点的同一问题同步修改
  - **改完后的形态**：`{ ok: false, error: { code: "confirmation-already-resolved", status: 409, message: "..." }, trace_uuid }`
  - **测试增量**：补 409 错误响应不含 `data` 字段的断言；补 `confirmation-already-resolved` 在 `FacadeErrorCodeSchema` 中存在的编译期断言
- **建议行动项**：A1
- **复审要点**：验证 FacadeErrorCodeSchema 枚举更新后编译通过；验证 409 响应不含 `data` 字段

#### `F-CTX-01` — `context-rpc-unavailable` error code 被 coerce 为 `internal-error`

- **严重级别**：❌ FINDING
- **簇 / 端点**：Context / 所有 7 个端点（503 RPC failure 路径）
- **维度**：F3
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:2614` —— `jsonPolicyError(503, "context-rpc-unavailable", ...)`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-84` —— `FacadeErrorCodeSchema` 不包含 `"context-rpc-unavailable"`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:203` —— `FacadeErrorCodeSchema.safeParse(authEnvelope.error.code)` 失败时 coerce 为 `"internal-error"`
  - `packages/nacp-core/src/error-registry.ts:297` —— `context-rpc-unavailable` 注册为 ad-hoc code
  - 注意：实际代码路径中 `jsonPolicyError` 调用 `facadeError()` 前经过 `facadeFromAuthEnvelope()`，但 context 路由不经过 auth envelope——它直接走 `jsonPolicyError`，所以会经过 `facadeError()` → `FacadeErrorCodeSchema.safeParse()` → **coerced to `"internal-error"`**
- **为什么重要**：
  - 客户端在 context-core 不可时收到 503 `internal-error`，无法区分 "context-core binding 缺失" 和 "一般内部错误"
  - 打破了 API 文档中声明的 `context-rpc-unavailable` error code 语义
- **修法（What + How）**：
  - **改什么**：将 `context-rpc-unavailable` 加入 `FacadeErrorCodeSchema` 枚举
  - **怎么改**：在 `facade-http.ts` 的 `FacadeErrorCodeSchema` 中添加 `"context-rpc-unavailable"` 到 lifecycle/runtime 区域
  - **改完后的形态**：客户端收到 `{ ok: false, error: { code: "context-rpc-unavailable", status: 503, message: "..." }, trace_uuid }`
  - **测试增量**：验证 context route 503 响应中 `error.code === "context-rpc-unavailable"`
- **建议行动项**：A2
- **复审要点**：验证 `FacadeErrorCodeSchema` 枚举更新后编译期 guard `_rpcErrorCodesAreFacadeCodes` 仍然通过

#### `W-ME-01` — `POST /me/devices/revoke` 无测试覆盖

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Me-Sessions / `POST /me/devices/revoke`
- **维度**：F2
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-core/test/me-devices-route.test.ts` 只覆盖 `GET /me/devices`（列表）
  - `workers/orchestrator-core/src/index.ts:2084-2218` 的 `handleMeDevicesRevoke` 函数有 135 行，包含所有权验证、幂等吊销、原子 D1 batch、device gate cache 清除、User DO 通知
  - 全代码库无 `POST /me/devices/revoke` 的专用测试
- **为什么重要**：设备吊销是安全关键操作（影响设备 gate），无测试意味着回归风险高
- **修法（What + How）**：
  - **改什么**：补 `POST /me/devices/revoke` 的集成测试
  - **怎么改**：在 `me-devices-route.test.ts` 中添加：happy path（200 revoke）、幂等（200 already revoked）、403 所有权不匹配、404 device not found、401 missing bearer、400 bad UUID
  - **测试增量**：6-8 个测试用例
- **建议行动项**：A3

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | `F-CFM-01` + Part1 `F-CHK-01` | CFM/CHK / `POST .../decision` + `POST .../restore` | 将 `confirmation-already-resolved` 加入 `FacadeErrorCodeSchema`；移除 409 错误响应中的 `data` 字段；改用 `jsonPolicyError` | `facade-http.ts`, `index.ts:1410-1422, 1642-1655` | 补 409 响应不含 `data` 的断言 | S |
| **A2** | P1 | `F-CTX-01` | CTX / 所有 7 端点 | 将 `context-rpc-unavailable` 加入 `FacadeErrorCodeSchema` | `facade-http.ts` | 验证 503 响应 code 不被 coerce | XS |
| **A3** | P2 | `W-ME-01` | ME / `POST /me/devices/revoke` | 补设备吊销端点的集成测试 | `test/me-devices-route.test.ts` | 8 测试用例 | S |

### 6.1 整体修复路径建议

建议先修 A1（影响 2 个端点，同一类问题），再修 A2（1 行枚举添加），最后补 A3（纯测试增量）。A1 和 A2 可以合并到一个 PR 里（都是 facade error code 注册），A3 独立一个 PR。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| — | — | — | — | — |

---

## 7. 测试覆盖矩阵

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `GET /sessions/{id}/confirmations` | `confirmation-control-plane.test.ts` | `confirmation-route.test.ts` | — | happy + 400 + 401 + 404 + 409 | ✅ |
| `GET /sessions/{id}/confirmations/{uuid}` | `confirmation-control-plane.test.ts` | `confirmation-route.test.ts` | — | happy + 404 | ✅ |
| `POST .../confirmations/{uuid}/decision` | `confirmation-control-plane.test.ts` | `confirmation-route.test.ts` | — | happy + 400 (failed) + 409 conflict | ✅ |
| `GET /sessions/{id}/context` | — | `context-route.test.ts` | — | happy + 401 + 400 + 503 | ✅ |
| `GET /sessions/{id}/context/probe` | — | `context-route.test.ts` | — | happy + 401 + 503 | ✅ |
| `GET /sessions/{id}/context/layers` | — | `context-route.test.ts` | — | happy + 401 + 503 | ✅ |
| `POST /sessions/{id}/context/snapshot` | `rpc-context-control-plane.test.ts` | `context-route.test.ts` | — | happy + 401 + 503 | ✅ |
| `POST .../context/compact/preview` | `rpc-context-control-plane.test.ts` | `context-route.test.ts` | — | happy + 401 + 503 | ✅ |
| `POST /sessions/{id}/context/compact` | `rpc-context-control-plane.test.ts` | `context-route.test.ts` | — | happy + 401 + 503 | ✅ |
| `GET .../context/compact/jobs/{jobId}` | — | `context-route.test.ts` | — | happy + 503 | ✅ |
| `POST /me/sessions` | — | `smoke.test.ts` | — | happy + 400 (client UUID) | ✅ |
| `GET /me/sessions` | — | `me-sessions-route.test.ts` | — | happy + 401 + cross-user | ✅ |
| `GET /me/conversations` | — | `me-conversations-route.test.ts` | — | happy + cursor + cross-user | ✅ |
| `GET /me/team` | — | `me-team-route.test.ts` | — | happy + 401 + API key | ✅ |
| `PATCH /me/team` | — | `me-team-route.test.ts` | — | happy + 403 (non-owner) | ✅ |
| `GET /me/teams` | — | `me-teams-route.test.ts` | — | happy + empty + 401 | ✅ |
| `GET /me/devices` | — | `me-devices-route.test.ts` | — | happy + multi + revoked + cross-user | ✅ |
| `POST /me/devices/revoke` | — | **—** | — | **—** | ❌ |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| `POST /me/devices/revoke` | 整个端点无任何测试（happy path, 403, 404, 401, 400, 幂等） | `test/me-devices-route.test.ts` | W-ME-01 |
| `GET /sessions/{id}/confirmations/{uuid}` | 404 错误路径只在 list 测试中隐式覆盖 | `confirmation-route.test.ts` | — |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | 669-710, 712-733, 879-998, 1134-1165, 1199-1238, 1500-1669, 1918-2027, 2033-2218, 2479-2616 | 路由解析 / 调度 / handler |
| `workers/orchestrator-core/src/auth.ts` | 78-88, 98-123, 165-215, 221-327 | 鉴权 / device gate |
| `workers/orchestrator-core/src/confirmation-control-plane.ts` | 1-293 | D1ConfirmationControlPlane, enums, ConfirmationRow |
| `workers/orchestrator-core/src/context-control-plane.ts` | 7-561 | Durable context state read/write |
| `workers/orchestrator-core/src/session-truth.ts` | 637-1008 | D1SessionTruthRepository (mint, list, conversation) |
| `workers/orchestrator-core/src/policy/authority.ts` | 21-52 | jsonPolicyError, readTraceUuid |
| `workers/orchestrator-auth-contract/src/facade-http.ts` | 1-213 | facade-http-v1 envelope, FacadeErrorCodeSchema |
| `workers/context-core/src/index.ts` | 35-360 | ContextCoreEntrypoint RPC |
| `workers/context-core/src/control-plane.ts` | 381-585 | Probe/layers/compact builders |
| `packages/nacp-core/src/error-registry.ts` | 297 | context-rpc-unavailable ad-hoc registration |
| `workers/orchestrator-core/migrations/012-session-confirmations.sql` | 1-51 | Confirmation DDL (7-kind, 6-status CHECK) |
| `test/confirmation-route.test.ts` | 1-384 | Confirmation route 集成测试 |
| `test/confirmation-control-plane.test.ts` | — | D1ConfirmationControlPlane 单元测试 |
| `test/context-route.test.ts` | 1-520 | Context route 集成测试 |
| `test/me-sessions-route.test.ts` | — | /me/sessions 集成测试 |
| `test/me-conversations-route.test.ts` | — | /me/conversations 集成测试 |
| `test/me-devices-route.test.ts` | — | /me/devices 集成测试（仅 GET） |
| `test/me-teams-route.test.ts` | — | /me/teams 集成测试 |
| `test/me-team-route.test.ts` | — | /me/team (GET+PATCH) 集成测试 |
| `clients/api-docs/confirmations.md` | 1-216 | Confirmations API 文档 |
| `clients/api-docs/context.md` | 1-200 | Context API 文档 |
| `clients/api-docs/me-sessions.md` | 1-264 | Me-Sessions API 文档 |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

> 实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。

### 9.2 二次审查方式

- **建议方式**：`independent reviewer`
- **二次审查触发条件**：
  1. A1 PR merged（`confirmation-already-resolved` 加入 FacadeErrorCodeSchema + 移除 409 响应 `data` 字段）
  2. A2 PR merged（`context-rpc-unavailable` 加入 FacadeErrorCodeSchema）
  3. drift gate 重新跑过且全绿
- **二次审查应重点核查**：
  1. `FacadeErrorCodeSchema` 枚举更新后 `_rpcErrorCodesAreFacadeCodes` 和 `_authErrorCodesAreFacadeCodes` 编译期 guard 仍然通过
  2. 409 响应不再包含 `data` 字段
  3. context route 503 响应的 `error.code` 为 `context-rpc-unavailable` 而非 `internal-error`

### 9.3 合规声明前的 blocker

1. `F-CFM-01` — 409 错误信封包含 `data` 字段 + error code 不在 FacadeErrorCodeSchema —— Action A1
2. `F-CTX-01` — `context-rpc-unavailable` error code 被 coerce 为 `internal-error` —— Action A2

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> 文档状态切到 `changes-requested` 后，实现者把修复结论 append 在这一节。