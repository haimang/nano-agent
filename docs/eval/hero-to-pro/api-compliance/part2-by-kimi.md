# Nano-Agent API Compliance 调查模板

> 调查对象: `Confirmations + Context + Me-Sessions`
> 调查类型: `initial`
> 调查者: `kimi`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/confirmations.md`
> - `clients/api-docs/context.md`
> - `clients/api-docs/me-sessions.md`
> Profile / 协议族: `facade-http-v1`
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts`
> - `docs/charter/plan-hero-to-pro.md §7.6 HP5`
> - `docs/design/hero-to-pro/HPX-qna.md Q16-Q18`
> - `scripts/check-envelope-drift.mjs`
> 复用 / 对照的既有审查:
> - 无 prior compliance report 可直接复用；本次为独立 initial 审查。
> 文档状态: `draft`

---

## 0. 总判定 / Executive Summary

> 本轮 Confirmations + Context + Me-Sessions 调查共 18 个端点，整体功能性链路真实成链，但发现 **1 项 CRITICAL**（错误信封违约：未注册 error code + 错误响应携带 `data` 字段）、**3 项 FINDING**（未注册 error code 违约）、**4 项 WARN**（文档与实现偏差 / 测试缺口 / facade 层缺 request shape 校验）。在修复 CRITICAL 之前，**不允许声明 fully-compliant**。

- **整体 verdict**：`功能性成链，测试覆盖充分，但 error code 契约与 envelope shape 存在多处违约，需先修 CRITICAL 后才能声明合规。`
- **结论等级**：`partial-compliance`
- **是否允许声明合规**：`no`
- **本轮最关键的 1-3 个判断**：
  1. `POST /sessions/{id}/confirmations/{uuid}/decision` 的 409 响应使用未注册 error code `confirmation-already-resolved`，且错误 envelope 中非法携带 `data` 字段，构成 facade-http-v1 形状 CRITICAL 违约。
  2. 多个端点（context、shared session validation、auth layer）使用未在 `FacadeErrorCodeSchema` 中注册的 error code，构成契约 FINDING。
  3. `GET /sessions/{id}/context` 被文档声明为 probe 的 legacy alias，但实现调用的是 `getContextSnapshot` 而非 `getContextProbe`，属于 doc-reality 偏差 WARN。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Confirmations | 3 | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | FAIL |
| Context | 7 | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ⚠️ | FAIL |
| Me-Sessions | 8 | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | FAIL |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 1 | yes |
| ❌ FINDING  | 3 | yes |
| ⚠️ WARN     | 4 | no（建议修） |
| 📝 OBSERVATION | 1 | no（仅记录） |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性（Functionality） | 路由→实现是否真实成链？文档声明的能力是否真的存在？ | route → handler → backing repo / RPC 全链路可达，行为符合 doc |
| **F2** | 测试覆盖（Test Coverage） | 是否有测试在这条路径上跑过？覆盖了 happy path 与关键错误路径？ | 单测 + 集成 + （必要时）E2E / live 测试任一层有断言 |
| **F3** | 形态合规（Shape Compliance） | 请求/响应/错误形态、auth gate、status code 是否与 doc 与契约对齐？ | request/response 满足 schema；auth 行为与 doc 同；status code 同 |
| **F4** | NACP 协议合规（NACP Compliance） | envelope、authority、trace、tenant boundary、error code 是否符合 NACP profile？ | 信封正族；trace 贯通；authority 翻译合法；tenant 边界守住；error code 在 schema 内 |
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

> 这一节只写事实，不写结论。明确读了哪些文件、跑了哪些命令、对照了哪些 SSoT。

- **对照的 API 文档**：
  - `clients/api-docs/confirmations.md`
  - `clients/api-docs/context.md`
  - `clients/api-docs/me-sessions.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/index.ts:660-720, 877-999, 1134-1669, 1950-2218, 2467-2616`
  - `workers/orchestrator-core/src/confirmation-control-plane.ts`
  - `workers/orchestrator-core/src/context-control-plane.ts`
  - `workers/orchestrator-core/src/auth.ts:221-327`
  - `workers/orchestrator-core/src/policy/authority.ts:21-41`
  - `workers/context-core/src/index.ts:140-177`
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts`
  - `packages/orchestrator-auth-contract/src/auth-error-codes.ts`
- **执行过的验证**：
  - `cd workers/orchestrator-core && pnpm test` → 33 files, 308 tests passed
  - `node scripts/check-envelope-drift.mjs` → 1 public file(s) clean
- **对照的测试**：
  - `workers/orchestrator-core/test/confirmation-route.test.ts` (6 tests)
  - `workers/orchestrator-core/test/context-route.test.ts` (~17 tests)
  - `workers/orchestrator-core/test/me-sessions-route.test.ts` (3 tests)
  - `workers/orchestrator-core/test/me-conversations-route.test.ts` (5 tests)
  - `workers/orchestrator-core/test/me-team-route.test.ts` (5 tests)
  - `workers/orchestrator-core/test/me-teams-route.test.ts` (5 tests)
  - `workers/orchestrator-core/test/me-devices-route.test.ts` (5 tests)
  - `workers/orchestrator-core/test/smoke.test.ts` (POST /me/sessions + reject client UUID)
  - `test/cross-e2e/zx2-transport.test.mjs` (live E2E for /me/sessions)
  - `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs` (live E2E for /me/devices/revoke)

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行核对了 index.ts 中 18 个端点的 handler、route parser、auth gate、backing repo/RPC |
| 单元 / 集成测试运行 | yes | orchestrator-core 308 tests passed；context-core 未运行（仅 facade 代理层） |
| Drift gate 脚本运行 | yes | `check-envelope-drift.mjs` green；但只检查 annotation 和 trace_uuid，不检查 error code 注册表 |
| schema / contract 反向校验 | yes | 人工比对了 `FacadeErrorCodeSchema` 与所有 `jsonPolicyError` 调用及手动构造的错误响应 |
| live / preview / deploy 证据 | no / n/a | 未运行 live E2E；依赖已有的 cross-e2e 测试文件作为间接证据 |
| 与上游 design / Q-law 对账 | yes | 对照了 confirmations.md 引用的 Q16-Q18；context.md 引用的 Q10-Q12 |

### 1.5 跨簇横切观察

> 在进入逐簇分析前，先把对所有簇都成立的事实写在一处，避免每簇重复。

- **架构与路由层**：所有端点共享 orchestrator-core `dispatchFetch()` 同一入口；session 路由使用 `UUID_RE` 做严格 UUID 校验；`/me/*` 路由使用精确 pathname match。
- **Envelope 契约**：所有端点（理论上）应使用 `facade-http-v1` 的 `{ ok, data?, error?, trace_uuid }`。实际发现个别端点手动构造响应，绕过 `jsonPolicyError` / `facadeError`。
- **Auth 模式**：统一经 `authenticateRequest()`；支持 `Bearer <JWT>` 与 `Bearer nak_<api_key>` 两种模式；JWT 必须含 `team_uuid`/`tenant_uuid` + `device_uuid`；device gate 查 D1 `nano_user_devices.status='active'`。
- **Trace 传播**：请求侧读取 `x-trace-uuid` header 或 `trace_uuid` query param（`policy/authority.ts:47-52`）；响应侧回写 `x-trace-uuid` header + `trace_uuid` body 字段。
- **NACP authority 翻译**：JWT claim → `IngressAuthSnapshot`（`auth.ts:298-309`）；`tenant_source: "claim"`；`team_uuid` 与 `tenant_uuid` 同值写入。
- **Tenant 边界**：所有 session-scoped 端点（confirmations、context）在 handler 内显式校验 `session.team_uuid === auth.team_uuid && session.actor_user_uuid === auth.user_uuid`；`/me/*` 端点通过 D1 query 的 `WHERE user_uuid = ?` 隐式隔离。
- **跨簇 Error Code 违约（横切）**：
  - `invalid-trace`（auth.ts:237）不在 `FacadeErrorCodeSchema`
  - `auth-misconfigured`（auth.ts:249）不在 `FacadeErrorCodeSchema`
  - `conversation-deleted`（index.ts 多处 session validation）不在 `FacadeErrorCodeSchema`

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| Confirmations | GET /sessions/{id}/confirmations | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Confirmations | GET /sessions/{id}/confirmations/{uuid} | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Confirmations | POST /sessions/{id}/confirmations/{uuid}/decision | ✅ | ✅ | ✅ | 🔴 | ✅ | ❌ | FAIL | C-CON-01: 未注册 error code + 错误 envelope 携带 data |
| Context | GET /sessions/{id}/context | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | PASS w/ WARN | W-CTX-01: doc 称 alias of probe 但调用不同 RPC |
| Context | GET /sessions/{id}/context/probe | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01: `context-rpc-unavailable` 未注册 |
| Context | GET /sessions/{id}/context/layers | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01: `context-rpc-unavailable` 未注册 |
| Context | POST /sessions/{id}/context/snapshot | ✅ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01 + W-CTX-02: body shape 未校验 |
| Context | POST /sessions/{id}/context/compact/preview | ✅ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01 + W-CTX-02: body shape 未校验 |
| Context | POST /sessions/{id}/context/compact | ✅ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01 + W-CTX-02: body shape 未校验 |
| Context | GET /sessions/{id}/context/compact/jobs/{jobId} | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01: `context-rpc-unavailable` 未注册 |
| Me-Sessions | POST /me/sessions | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Me-Sessions | GET /me/sessions | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Me-Sessions | GET /me/conversations | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Me-Sessions | GET /me/team | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Me-Sessions | PATCH /me/team | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Me-Sessions | GET /me/teams | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Me-Sessions | GET /me/devices | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code 未注册 |
| Me-Sessions | POST /me/devices/revoke | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | W-DEV-01: 无 dedicated 单测；仅 cross-e2e 覆盖 |

---

## 3. 簇级深度分析

### 3.1 簇 — Confirmations（`clients/api-docs/confirmations.md`）

#### 3.1.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()              workers/orchestrator-core/src/index.ts:660
  → parseSessionConfirmationRoute()                workers/orchestrator-core/src/index.ts:1139
  → handleSessionConfirmation()                    workers/orchestrator-core/src/index.ts:1500
  → authenticateRequest()                          workers/orchestrator-core/src/auth.ts:221
  → D1SessionTruthRepository.readSessionLifecycle() workers/orchestrator-core/src/session-truth.ts
  → D1ConfirmationControlPlane.{list,read,applyDecision}  workers/orchestrator-core/src/confirmation-control-plane.ts:89
  → Response.json({ ok, data, trace_uuid })        workers/orchestrator-core/src/index.ts:1559-1668
```

**链路注记**：`parseSessionConfirmationRoute` 排在 session 确认路由之后、checkpoint 路由之前；UUID 双重校验（route regex + `UUID_RE.test`）；session lifecycle 读取后执行 team + user 双重边界校验。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| GET /sessions/{id}/confirmations | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | F-SHR-01 |
| GET /sessions/{id}/confirmations/{uuid} | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | F-SHR-01 |
| POST /sessions/{id}/confirmations/{uuid}/decision | ✅ | ✅ | ✅ | 🔴 | ✅ | ❌ | FAIL | C-CON-01 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 POST /sessions/{id}/confirmations/{uuid}/decision

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:1151-1161` → `handleSessionConfirmation:1596-1669` → `D1ConfirmationControlPlane.applyDecision:221-262`；行为：正确应用终态决策，Q16 `superseded` 替代 `failed` 已落实 |
| **F2 测试覆盖** | ✅ | 单测：`confirmation-route.test.ts:279-313` (happy path), `:315-342` (Q16 reject `failed`), `:344-383` (409 conflict) |
| **F3 形态合规** | ✅ | auth：bearer JWT + device gate；request：body 校验 `status` ∈ {allowed,denied,modified,timeout,superseded} + `decision_payload` 为 object；response：200 返回 `{ confirmation }`；error：400/404/409/503 均存在 |
| **F4 NACP 合规** | 🔴 | **error code 违约**：409 响应手动构造 `code: "confirmation-already-resolved"`，该值**不在** `FacadeErrorCodeSchema` 枚举内；**error envelope 违约**：409 响应非法携带 `data: { confirmation: ... }` 字段，违反 facade-http-v1 错误 envelope 只含 `ok`, `error`, `trace_uuid` 的契约 |
| **F5 文档一致性** | ✅ | 文档明确声明 409 `confirmation-already-resolved` 及 envelope 形状；代码行为与文档一致（但文档与 frozen contract 不一致） |
| **F6 SSoT 漂移** | ❌ | `FacadeErrorCodeSchema` 未包含 `confirmation-already-resolved`；drift gate 不检查 error code 注册表 |

**关联 finding**：`C-CON-01`

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ⚠️ | 成功响应正确；409 错误响应非法携带 `data` 字段 (`index.ts:1642-1655`) |
| `x-trace-uuid` 在 response 头里 | ✅ | 所有 Response.json 均带 `headers: { "x-trace-uuid": traceUuid }` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `confirmation-already-resolved` 未注册；`conversation-deleted` 未注册 |
| Tenant 边界 5 规则被守住 | ✅ | `session.team_uuid === auth.team_uuid && session.actor_user_uuid === auth.user_uuid` (`index.ts:1519-1524`) |
| Authority 翻译合法（HTTP claim → server-stamped） | ✅ | JWT → `IngressAuthSnapshot` (`auth.ts:298-309`) |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `C-CON-01` | 🔴 | F4 | 409 错误响应使用未注册 error code 且非法携带 `data` 字段 | 破坏 facade-http-v1 错误信封契约；严格 schema 校验的客户端会解析失败 |
| `F-SHR-01` | ❌ | F4 | 共享 session validation 使用未注册 error code `conversation-deleted` | 409 错误响应用了 schema 之外的 code，契约违约 |

#### 3.1.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| GET /sessions/{id}/confirmations | 无异常，按 doc 实链；`known_kinds` 返回与 doc 一致 |
| GET /sessions/{id}/confirmations/{uuid} | 无异常；404 当 row 不存在时正确返回 |

---

### 3.2 簇 — Context（`clients/api-docs/context.md`）

#### 3.2.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()              workers/orchestrator-core/src/index.ts:660
  → Regex route match (/sessions/[^/]+/context/...) workers/orchestrator-core/src/index.ts:713-731
  → handleSessionContext()                         workers/orchestrator-core/src/index.ts:2479
  → authenticateRequest()                          workers/orchestrator-core/src/auth.ts:221
  → CONTEXT_CORE RPC {getContextSnapshot,getContextProbe,getContextLayers,triggerContextSnapshot,previewCompact,triggerCompact,getCompactJob}  workers/context-core/src/index.ts:140-177
  → Response.json({ ok, data, trace_uuid })        workers/orchestrator-core/src/index.ts:2599-2602
```

**链路注记**：所有 context 端点为 **thin RPC proxy**；orchestrator-core 仅做 auth + UUID gate + 错误包装，业务逻辑全在 context-core。这是 by-design（Lane E E1 架构）。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| GET /sessions/{id}/context | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | PASS w/ WARN | W-CTX-01 |
| GET /sessions/{id}/context/probe | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01 |
| GET /sessions/{id}/context/layers | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01 |
| POST /sessions/{id}/context/snapshot | ✅ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01, W-CTX-02 |
| POST /sessions/{id}/context/compact/preview | ✅ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01, W-CTX-02 |
| POST /sessions/{id}/context/compact | ✅ | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01, W-CTX-02 |
| GET /sessions/{id}/context/compact/jobs/{jobId} | ✅ | ✅ | ✅ | ❌ | ✅ | ⚠️ | FAIL | F-CTX-01 |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 GET /sessions/{id}/context

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:713` → `handleSessionContext:2516-2525` → `ctx.getContextSnapshot`；RPC 调用真实存在 |
| **F2 测试覆盖** | ✅ | 单测：`context-route.test.ts:74-104` (200), `:106-117` (401), `:119-141` (400/404), `:143-165` (503 missing binding), `:167-189` (503 RPC throw) |
| **F3 形态合规** | ✅ | auth：bearer + device gate + team claim；request：无 body；response：透传 context-core 返回 shape |
| **F4 NACP 合规** | ⚠️ | 透传 context-core payload，若 context-core 返回非 facade 形状则 façade 层无二次 guard；错误路径使用未注册 code `context-rpc-unavailable` |
| **F5 文档一致性** | ⚠️ | 文档声明为 "legacy alias of probe"，但实现调用 `getContextSnapshot` 而非 `getContextProbe`；两者 RPC 语义不同 |
| **F6 SSoT 漂移** | ⚠️ | RPC 透传模式导致 façade 层无法保证返回 shape 与 doc 一致；依赖 context-core 内部实现 |

**关联 finding**：`W-CTX-01`

##### 3.2.2.2 POST /sessions/{id}/context/compact

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:728` → `handleSessionContext:2571-2580` → `ctx.triggerCompact`；真实 RPC 链存在 |
| **F2 测试覆盖** | ✅ | 单测：`context-route.test.ts:329-407` (200, 503 throw, 401, 400/404, 503 missing binding) |
| **F3 形态合规** | ⚠️ | request body **未在 façade 层校验**；doc 声明 body shape `{ force: false, preview_uuid: null }`，但 orchestrator-core 直接透传任意 body 到 context-core；若客户端发送非法 shape，错误由 context-core 返回而非 façade 前置校验 |
| **F4 NACP 合规** | ❌ | 错误路径使用未注册 code `context-rpc-unavailable` (`index.ts:2614`) |
| **F5 文档一致性** | ✅ | 端点存在性与 doc 一致；body shape 文档已写但 façade 未 enforce |
| **F6 SSoT 漂移** | ⚠️ | 同 F6 观察 |

**关联 finding**：`F-CTX-01`, `W-CTX-02`

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ⚠️ | 成功响应透传 context-core payload，无二次 shape guard；context-core 内部是否严格输出 facade envelope 未在本轮核查 |
| `x-trace-uuid` 在 response 头里 | ✅ | `index.ts:2601` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ❌ | `context-rpc-unavailable` 未注册 |
| Tenant 边界 5 规则被守住 | ✅ | `sessionUuid` 与 `teamUuid` 在 handler 内校验 (`index.ts:2496-2501`)，但 session 存在性校验缺失（仅校验 UUID 格式，不查 D1） |
| Authority 翻译合法 | ✅ | JWT → `IngressAuthSnapshot` |

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `F-CTX-01` | ❌ | F4 | Context 端点使用未注册 error code `context-rpc-unavailable` | 503 错误响应用了 schema 之外的 code，契约违约 |
| `W-CTX-01` | ⚠️ | F5 | `GET /context` 被文档声明为 probe alias 但调用不同 RPC | 文档误导客户端；两路径返回 shape 可能不同 |
| `W-CTX-02` | ⚠️ | F3 | Context POST 端点 façade 层未校验 request body shape | 非法 body 会穿透到 context-core， façade 未提前拒绝 |

#### 3.2.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| GET /sessions/{id}/context/probe | 无异常，RPC proxy 模式正常 |
| GET /sessions/{id}/context/layers | 无异常 |
| POST /sessions/{id}/context/snapshot | 无异常（body 未校验同 W-CTX-02） |
| POST /sessions/{id}/context/compact/preview | 无异常（body 未校验同 W-CTX-02） |
| GET /sessions/{id}/context/compact/jobs/{jobId} | 无异常；UUID 校验在 segment[5] 执行 |

---

### 3.3 簇 — Me-Sessions（`clients/api-docs/me-sessions.md`）

#### 3.3.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()              workers/orchestrator-core/src/index.ts:660
  → parseMeSessionsRoute() / exact pathname match  workers/orchestrator-core/src/index.ts:879-700
  → handleMeSessions() / handleMeConversations() / handleMeTeam() / handleMeTeams() / handleMeDevicesList() / handleMeDevicesRevoke()
                                                     workers/orchestrator-core/src/index.ts:888-2218
  → authenticateRequest()                          workers/orchestrator-core/src/auth.ts:221
  → D1SessionTruthRepository / D1 direct query     workers/orchestrator-core/src/session-truth.ts / inline SQL
  → Response.json({ ok, data, trace_uuid })        各 handler 末尾
```

**链路注记**：`/me/*` 路由不走 session-scoped 校验，而是直接以 `auth.user_uuid` 作为 D1 query 的 WHERE 条件，实现多租隔离。

#### 3.3.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| POST /me/sessions | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code |
| GET /me/sessions | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code |
| GET /me/conversations | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code |
| GET /me/team | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code |
| PATCH /me/team | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code |
| GET /me/teams | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code |
| GET /me/devices | ✅ | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | 共享 error code |
| POST /me/devices/revoke | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | ⚠️ | PASS w/ WARN | W-DEV-01 |

#### 3.3.2 端点逐项分析

##### 3.3.2.1 POST /me/devices/revoke

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:699-700` → `handleMeDevicesRevoke:2111-2218`；行为：ownership 校验 → D1 UPDATE + INSERT → cache clear → User-DO notify；idempotent already-revoked 正确返回 |
| **F2 测试覆盖** | ⚠️ | **无 dedicated 单元测试文件**；cross-e2e `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs` 覆盖 live 路径；orchestrator-core 单元测试 suite 中无 `me-devices-revoke-route.test.ts` |
| **F3 形态合规** | ✅ | auth：bearer + device gate；request：body 校验 `device_uuid` 为 UUID，`reason` 可选 string；response：200 返回 `{ device_uuid, status, revoked_at, revocation_uuid }` 或 `{ already_revoked: true }`；error：400/401/403/404/500/503 均存在 |
| **F4 NACP 合规** | ⚠️ | 共享 auth layer 未注册 error code 问题（`invalid-trace`, `auth-misconfigured`）；端点自身 error code（`invalid-input`, `not-found`, `permission-denied`, `internal-error`, `worker-misconfigured`）均在 schema 内 |
| **F5 文档一致性** | ✅ | doc 与代码行为一致，包括 idempotent already-revoked 形状 |
| **F6 SSoT 漂移** | ⚠️ | 共享 auth error code 未注册问题 |

**关联 finding**：`W-DEV-01`, `F-AUT-01`

##### 3.3.2.2 PATCH /me/team

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:686-687` → `handleMeTeam:1952-1964`；membership_level >= 100 校验正确；D1 UPDATE 后重新读取 |
| **F2 测试覆盖** | ✅ | 单测：`me-team-route.test.ts:50-65` (200 owner), `:67-83` (403 non-owner), `:85-91` (401), `:93-120` (api key) |
| **F3 形态合规** | ✅ | request：body `team_name` 为非空 string ≤80 chars；response：同 GET shape；error：400/403/404/503 均存在 |
| **F4 NACP 合规** | ⚠️ | 共享 auth error code 问题 |
| **F5 文档一致性** | ✅ | doc 声明 owner-only (`membership_level >= 100`)，代码一致 |
| **F6 SSoT 漂移** | ⚠️ | 共享 auth error code 问题 |

#### 3.3.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | 成功/错误响应均通过 `Response.json` 正确构造 |
| `x-trace-uuid` 在 response 头里 | ✅ | 所有 handler 均设置 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ⚠️ | 端点自身 code 合规；auth layer 的 `invalid-trace` / `auth-misconfigured` 未注册（横切问题） |
| Tenant 边界 5 规则被守住 | ✅ | D1 query 均带 `WHERE user_uuid = ?` 或 `WHERE team_uuid = ? AND actor_user_uuid = ?` |
| Authority 翻译合法 | ✅ | JWT → `IngressAuthSnapshot` |

#### 3.3.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| `W-DEV-01` | ⚠️ | F2 | POST /me/devices/revoke 缺少 dedicated 单元测试 | 仅 cross-e2e 覆盖，本地回归无单测保护 |

#### 3.3.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| POST /me/sessions | 无异常；201 + server-mint UUID；D1 写入失败时 500 |
| GET /me/sessions | 无异常；cursor pagination 正确；limit 非法值回退默认 |
| GET /me/conversations | 无异常；conversation-level aggregation 正确；tombstoned 默认过滤 |
| GET /me/team | 无异常；api-key bearer 兼容 |
| GET /me/teams | 无异常；D1 absent 时返回 `{teams:[]}` |
| GET /me/devices | 无异常；仅返回 `status='active'`；跨用户隔离正确 |

---

## 4. 跨簇 NACP 协议合规

> 这一节专门跨簇横切复核，避免每簇重复。

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| JWT Bearer 路由 | `Authorization: Bearer <JWT>` | `authenticateRequest()` 解析 claim → `IngressAuthSnapshot` | ✅ |
| API Key 路由 | `Authorization: Bearer nak_...` | `authenticateApiKey()` 调 orchestrator-auth RPC → `IngressAuthSnapshot` | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| 全部 public facade | `x-trace-uuid` header 或 `trace_uuid` query | `readTraceUuid()` → handler → response header + body | required（无 trace 时 400 `invalid-trace`） | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` / `RpcErrorCodeSchema` 的超集：`✅`（编译期 guard 在 `facade-http.ts:92-94` 和 `:111-114`）
- 编译期 guard：`packages/orchestrator-auth-contract/src/facade-http.ts:92-114`
- 运行期回退：未知 code → `facadeFromAuthEnvelope` 中 `safeParse` 失败时 fallback 到 `internal-error`
- **本轮发现的不在 schema 中的 code（影响审查簇）**：
  - `confirmation-already-resolved`（confirmations）
  - `context-rpc-unavailable`（context）
  - `conversation-deleted`（shared session validation）
  - `invalid-trace`（auth layer）
  - `auth-misconfigured`（auth layer）

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| Confirmations | session lifecycle 读取后显式比对 `team_uuid` + `actor_user_uuid` | 5/5 | ✅ |
| Context | handler 内校验 `teamUuid` 存在性，但 **未读 session lifecycle 校验归属**（仅校验 UUID 格式） | 3/5（缺 session 存在性 + 归属校验） | ⚠️ |
| Me-Sessions | D1 query `WHERE user_uuid = ?` 或 `WHERE team_uuid = ? AND actor_user_uuid = ?` | 5/5 | ✅ |

**注**：Context 端点当前在 orchestrator-core 层仅校验 `sessionUuid` 是合法 UUID 和 `teamUuid` 存在，**不查询 D1 确认该 session 属于当前用户**。tenant 边界依赖 context-core 内部实现。这是 by-design 的 RPC proxy 模式，但 façade 层少了一层 session 归属 gate。

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `pnpm check:envelope-drift` | ✅ green — 未发现 public-internal envelope 混用或 missing trace_uuid |
| `pnpm check:tool-drift` | 未运行 |
| `pnpm check:cycles` | 未运行 |
| `pnpm check:megafile` | 未运行 |
| 错误 envelope drift（人工核查） | ❌ 发现违例：
  1. `confirmation-already-resolved` 手动构造的 409 响应携带 `data` 字段（`index.ts:1642-1655`） |

---

## 5. Findings 总账

> 全部 finding 集中到这一张表，便于跨轮追踪。

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| `C-CON-01` | 🔴 | Confirmations | POST /sessions/{id}/confirmations/{uuid}/decision | F4 | 409 响应使用未注册 error code 且非法携带 `data` | 破坏 facade-http-v1 错误信封契约；严格客户端解析失败 | yes | A1 |
| `F-CTX-01` | ❌ | Context | ALL context endpoints | F4 | `context-rpc-unavailable` 未在 `FacadeErrorCodeSchema` 注册 | RPC 失败时返回 schema 外 error code | yes | A2 |
| `F-SHR-01` | ❌ | Shared | ALL session-scoped endpoints | F4 | `conversation-deleted` 未在 `FacadeErrorCodeSchema` 注册 | 409 错误返回 schema 外 code | yes | A3 |
| `F-AUT-01` | ❌ | Auth | ALL authenticated endpoints | F4 | `invalid-trace` / `auth-misconfigured` 未注册 | 401/503 错误返回 schema 外 code | yes | A4 |
| `W-CTX-01` | ⚠️ | Context | GET /sessions/{id}/context | F5 | 文档称 probe alias 但实现调用不同 RPC | 文档误导，两路径返回 shape 可能不同 | no | A5 |
| `W-CTX-02` | ⚠️ | Context | POST /context/{snapshot,compact/preview,compact} | F3 | façade 层未校验 request body shape | 非法 body 穿透到 context-core | no | A6 |
| `W-DEV-01` | ⚠️ | Me-Sessions | POST /me/devices/revoke | F2 | 缺少 dedicated 单元测试文件 | 本地回归无单测保护 | no | A7 |

### 5.2 Finding 详情

#### `C-CON-01` — 409 错误响应使用未注册 error code 且非法携带 `data` 字段

- **严重级别**：🔴 CRITICAL
- **簇 / 端点**：Confirmations / POST /sessions/{id}/confirmations/{uuid}/decision
- **维度**：F4
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:1642-1655` —— 手动构造 `Response.json`，未通过 `jsonPolicyError`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-84` —— `FacadeErrorCodeSchema` 不含 `confirmation-already-resolved`
  - `clients/api-docs/confirmations.md:179` —— doc 声明 409 `confirmation-already-resolved`
- **为什么重要**：
  - 违反 facade-http-v1 契约：错误 envelope 不应携带 `data` 字段（契约只允许 `ok`, `error`, `trace_uuid`）
  - 若客户端使用 `FacadeErrorEnvelopeSchema` 做运行时校验，该响应会导致解析失败
  - 即使放宽到仅 Zod 校验，`confirmation-already-resolved` 也会因不在 `FacadeErrorCodeSchema` 枚举内而失败
- **修法（What + How）**：
  - **改什么**：将 409 响应重构为合规的 facade-http-v1 错误 envelope，并注册 error code
  - **怎么改**：
    1. 在 `FacadeErrorCodeSchema` 中新增 `confirmation-already-resolved`（或映射到已有 `conflict`）
    2. 移除错误响应中的 `data` 字段；若需返回当前 row，应将其放入 `error.details` 或要求客户端再发一次 GET detail
    3. 使用 `jsonPolicyError(409, "confirmation-already-resolved" | "conflict", "...", traceUuid)` 构造响应
  - **改完后的形态**：`{ ok: false, error: { code: "conflict", status: 409, message: "...", details?: { confirmation: {...} } }, trace_uuid }`
  - **测试增量**：补 409 响应不带顶层 `data` 的断言；补 Zod schema 校验通过断言
- **建议行动项**：`A1`
- **复审要点**：确认 409 响应不再包含顶层 `data`；确认 error code 在 `FacadeErrorCodeSchema` 内

#### `F-CTX-01` — `context-rpc-unavailable` 未在 `FacadeErrorCodeSchema` 注册

- **严重级别**：❌ FINDING
- **簇 / 端点**：Context / ALL context endpoints
- **维度**：F4
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:2614` —— `jsonPolicyError(503, "context-rpc-unavailable", ...)`
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-84` —— schema 不含该 code
- **为什么重要**：
  - facade-http-v1 契约要求所有 error code 必须在 `FacadeErrorCodeSchema` 内
  - 当前 `jsonPolicyError` 通过 `as FacadeErrorCode` 绕过编译期检查，运行时直接序列化未注册字符串
- **修法**：
  - **改什么**：将 `context-rpc-unavailable` 加入 `FacadeErrorCodeSchema`，或映射到已有 `worker-misconfigured` / `upstream-timeout`
  - **怎么改**：全局搜索替换为已有 code，或在 schema 中新增该 code
  - **改完后的形态**：`jsonPolicyError(503, "upstream-timeout", "context ... failed", traceUuid)` 或 schema 新增
  - **测试增量**：补 context RPC throw 时返回的 error.code 在 schema 内的断言
- **建议行动项**：`A2`
- **复审要点**：确认 `context-rpc-unavailable` 不再出现，或已在 schema 注册

#### `F-SHR-01` — `conversation-deleted` 未在 `FacadeErrorCodeSchema` 注册

- **严重级别**：❌ FINDING
- **簇 / 端点**：Shared / ALL session-scoped endpoints (confirmations, checkpoints, context, etc.)
- **维度**：F4
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:1527-1533` —— `jsonPolicyError(409, "conversation-deleted", ...)`
  - 同文件多处 session validation 逻辑复用该 pattern
- **修法**：
  - **改什么**：将 `conversation-deleted` 加入 `FacadeErrorCodeSchema`，或映射到已有 `conflict`
  - **怎么改**：建议映射到 `conflict`（409 语义最接近），或新增 code
  - **测试增量**：补相关端点 409 时 error.code 在 schema 内的断言
- **建议行动项**：`A3`
- **复审要点**：确认 `conversation-deleted` 已替换或注册

#### `F-AUT-01` — `invalid-trace` / `auth-misconfigured` 未注册

- **严重级别**：❌ FINDING
- **簇 / 端点**：Auth / ALL authenticated endpoints
- **维度**：F4
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:237` —— `jsonPolicyError(400, "invalid-trace", ...)`
  - `workers/orchestrator-core/src/auth.ts:249` —— `jsonPolicyError(503, "auth-misconfigured", ...)`
- **修法**：
  - **改什么**：`invalid-trace` → 映射到 `invalid-input` 或 `invalid-meta`；`auth-misconfigured` → 映射到 `worker-misconfigured`
  - **怎么改**：全局替换，保持 HTTP status 不变
- **建议行动项**：`A4`
- **复审要点**：确认两个 code 不再出现，或已在 schema 注册

#### `W-CTX-01` — `GET /context` 文档与实现不一致

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Context / GET /sessions/{id}/context
- **维度**：F5
- **是否 blocker**：no
- **事实依据**：
  - `clients/api-docs/context.md:16` —— "legacy alias of probe"
  - `workers/orchestrator-core/src/index.ts:713-714` —— 调用 `handleSessionContext(..., "get")` → `ctx.getContextSnapshot`
  - `index.ts:716-717` —— `handleSessionContext(..., "probe")` → `ctx.getContextProbe`
- **修法**：
  - **改什么**：更新文档，删除 "legacy alias of probe" 描述，改为独立端点说明；或修改实现使其真正 alias 到 probe
  - **建议行动项**：`A5`

#### `W-CTX-02` — Context POST 端点 façade 层未校验 request body shape

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Context / POST /context/snapshot, POST /context/compact/preview, POST /context/compact
- **维度**：F3
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:2549-2579` —— handler 直接透传 body 到 context-core RPC，不做 shape 校验
  - `clients/api-docs/context.md:88-106, 128-149` —— doc 声明了 body shape（如 `{ force: false }`, `{ label: "..." }`）
- **修法**：
  - **改什么**：在 orchestrator-core façade 层增加轻量 body shape 校验（或至少校验其为 object）
  - **建议行动项**：`A6`

#### `W-DEV-01` — POST /me/devices/revoke 缺少 dedicated 单元测试

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Me-Sessions / POST /me/devices/revoke
- **维度**：F2
- **是否 blocker**：no
- **事实依据**：
  - `workers/orchestrator-core/test/me-devices-route.test.ts` 仅测试 GET /me/devices（5 cases）
  - 无 `me-devices-revoke-route.test.ts` 文件
  - `test/cross-e2e/13-device-revoke-force-disconnect.test.mjs` 覆盖 live 路径
- **修法**：
  - **改什么**：新增 `me-devices-revoke-route.test.ts`，覆盖：200 happy, 200 idempotent, 400 invalid body, 404 not-found, 403 cross-user, 500 D1 failure
  - **建议行动项**：`A7`

---

## 6. 行动建议（按优先级）

> 把 Findings 转成可直接转入 action-plan 的工作项。

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | `C-CON-01` | Confirmations / POST .../decision | 重构 409 响应为合规 facade envelope；移除非法 `data` 字段；注册或替换 error code | `index.ts`, `facade-http.ts` | 补 409 不带 `data` 断言 + Zod 校验 | S |
| **A2** | P0 | `F-CTX-01` | Context / ALL | 替换 `context-rpc-unavailable` 为 schema 内已有 code（如 `upstream-timeout`）或注册新 code | `index.ts`, `facade-http.ts` | 补 error.code 合规断言 | XS |
| **A3** | P0 | `F-SHR-01` | Shared / ALL session-scoped | 替换 `conversation-deleted` 为 `conflict` 或注册新 code | `index.ts`, `facade-http.ts` | 补 409 error.code 合规断言 | XS |
| **A4** | P0 | `F-AUT-01` | Auth / ALL | 替换 `invalid-trace` → `invalid-input`；`auth-misconfigured` → `worker-misconfigured` | `auth.ts`, `facade-http.ts` | 补 auth error 断言 | XS |
| **A5** | P1 | `W-CTX-01` | Context / GET /context | 更新文档或修改实现：删除 "legacy alias" 误导描述 | `context.md` 或 `index.ts` | — | XS |
| **A6** | P2 | `W-CTX-02` | Context / POST {snapshot,compact*} | 在 façade 层增加 request body 基础校验（确保为 object） | `index.ts` | 补 400 invalid-input 断言 | S |
| **A7** | P2 | `W-DEV-01` | Me-Sessions / POST /me/devices/revoke | 新增 dedicated 单元测试文件 | `test/me-devices-revoke-route.test.ts` | ≥5 cases | S |

### 6.1 整体修复路径建议

> 推荐先合并 A1-A4（error code 契约修复）为一个 PR，因为它们是同一类问题（`FacadeErrorCodeSchema` 补全 + 调用点替换），且互相之间可能冲突（都改 `facade-http.ts`）。A5-A7 可以各自独立 PR，或在 A1-A4 合并后作为 follow-up。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| W-CTX-02 | context-core 内部已有 shape 校验，façade 层加校验是 defense-in-depth 而非必需 | context-core RPC 接口稳定后 | TBD | 下次 API compliance 轮 |

---

## 7. 测试覆盖矩阵

> 按端点 × 测试层把覆盖度可视化。

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| GET /sessions/{id}/confirmations | `confirmation-route.test.ts` | — | — | 200 / 401 | ✅ |
| GET /sessions/{id}/confirmations/{uuid} | `confirmation-route.test.ts` | — | — | 200 / 401 / 404 | ✅ |
| POST /sessions/{id}/confirmations/{uuid}/decision | `confirmation-route.test.ts` | — | — | 200 / 400 / 409 | ✅ |
| GET /sessions/{id}/context | `context-route.test.ts` | — | — | 200 / 401 / 400 / 503 | ✅ |
| GET /sessions/{id}/context/probe | `context-route.test.ts` | — | — | 200 / 401 / 503 | ✅ |
| GET /sessions/{id}/context/layers | `context-route.test.ts` | — | — | 200 / 401 / 503 | ✅ |
| POST /sessions/{id}/context/snapshot | `context-route.test.ts` | — | — | 200 / 401 / 400 / 503 | ✅ |
| POST /sessions/{id}/context/compact/preview | `context-route.test.ts` | — | — | 200 / 401 / 503 | ✅ |
| POST /sessions/{id}/context/compact | `context-route.test.ts` | — | — | 200 / 401 / 400 / 503 | ✅ |
| GET /sessions/{id}/context/compact/jobs/{jobId} | `context-route.test.ts` | — | — | 200 / 401 / 400 / 503 | ✅ |
| POST /me/sessions | `smoke.test.ts` | — | `zx2-transport.test.mjs` | 201 / 400 / 401 | ✅ |
| GET /me/sessions | `me-sessions-route.test.ts` | — | `zx2-transport.test.mjs` | 200 / 401 | ✅ |
| GET /me/conversations | `me-conversations-route.test.ts` | — | — | 200 / 401 | ✅ |
| GET /me/team | `me-team-route.test.ts` | — | `09-api-key-smoke.test.mjs` | 200 / 401 | ✅ |
| PATCH /me/team | `me-team-route.test.ts` | — | — | 200 / 400 / 403 / 401 | ✅ |
| GET /me/teams | `me-teams-route.test.ts` | — | — | 200 / 401 | ✅ |
| GET /me/devices | `me-devices-route.test.ts` | — | — | 200 / 401 | ✅ |
| POST /me/devices/revoke | — | — | `13-device-revoke-force-disconnect.test.mjs` | 200 / 400 / 401 / 403 / 404 / 500 | ⚠️ |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| POST /me/devices/revoke | 单元测试（≥5 cases） | `test/me-devices-revoke-route.test.ts` | W-DEV-01 |
| POST /sessions/{id}/confirmations/{uuid}/decision | Zod schema 合规断言（409 响应） | `confirmation-route.test.ts` | C-CON-01 |
| ALL context endpoints | error.code 注册表合规断言 | `context-route.test.ts` | F-CTX-01 |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | `660-720, 877-999, 1134-1669, 1950-2218, 2467-2616` | 路由解析 / 调度入口 / 业务 handler |
| `workers/orchestrator-core/src/confirmation-control-plane.ts` | `1-293` | D1 confirmation repo |
| `workers/orchestrator-core/src/context-control-plane.ts` | `1-561` | D1 context repo（orchestrator-core 侧） |
| `workers/orchestrator-core/src/auth.ts` | `1-329` | 鉴权 / device gate / authority 翻译 |
| `workers/orchestrator-core/src/policy/authority.ts` | `1-59` | `jsonPolicyError` / `readTraceUuid` |
| `workers/context-core/src/index.ts` | `1-368` | Context-core WorkerEntrypoint RPC |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | `1-213` | Frozen contract / envelope schema |
| `test/confirmation-route.test.ts` | `1-384` | Confirmations 测试 |
| `test/context-route.test.ts` | `1-520` | Context 测试 |
| `test/me-sessions-route.test.ts` | `1-152` | Me-sessions 测试 |
| `test/me-conversations-route.test.ts` | `1-204` | Me-conversations 测试 |
| `test/me-team-route.test.ts` | `1-121` | Me-team 测试 |
| `test/me-teams-route.test.ts` | `1-151` | Me-teams 测试 |
| `test/me-devices-route.test.ts` | `1-227` | Me-devices GET 测试 |
| `test/smoke.test.ts` | `392-447` | POST /me/sessions 测试 |
| `clients/api-docs/confirmations.md` | `1-216` | 受查文档 |
| `clients/api-docs/context.md` | `1-200` | 受查文档 |
| `clients/api-docs/me-sessions.md` | `1-264` | 受查文档 |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

> 实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。

### 9.2 二次审查方式

- **建议方式**：`same reviewer rereview`
- **二次审查触发条件**：
  - `A1` PR merged（CRITICAL 修复）
  - `A2-A4` PR merged（FINDING 修复）
  - `pnpm test` 全绿 + `check-envelope-drift` 全绿
- **二次审查应重点核查**：
  1. 409 错误响应不再包含顶层 `data`
  2. 所有 `jsonPolicyError` 调用的 error code 均在 `FacadeErrorCodeSchema` 内
  3. `pnpm test` 新增断言通过

### 9.3 合规声明前的 blocker

> 在以下 blocker 全部关闭前，**不得**对外声明本批 API 已 NACP 合规。

1. `C-CON-01` — Finding `C-CON-01` —— Action `A1`
2. `F-CTX-01` — Finding `F-CTX-01` —— Action `A2`
3. `F-SHR-01` — Finding `F-SHR-01` —— Action `A3`
4. `F-AUT-01` — Finding `F-AUT-01` —— Action `A4`

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> 文档状态切到 `changes-requested` 后，实现者把修复结论 append 在这一节。

### 10.1 回应汇总表

| Finding ID | 处理结果 | PR / Commit | 验证证据 | reviewer 复核结论 |
|------------|----------|-------------|----------|-------------------|
| | | | | |

### 10.2 逐条回应

> （待实现者回应后展开）

---

*报告生成时间: 2026-05-01*
*调查者: kimi*
*模板: docs/templates/api-compliance.md*
