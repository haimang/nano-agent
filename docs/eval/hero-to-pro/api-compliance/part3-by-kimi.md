# Nano-Agent API Compliance 调查报告

> 调查对象: `Permissions + Session WebSocket v1 + Session HTTP Lifecycle`
> 调查类型: `initial`
> 调查者: `kimi`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/permissions.md`
> - `clients/api-docs/session-ws-v1.md`
> - `clients/api-docs/session.md`
> Profile / 协议族: `facade-http-v1` + `session-ws-v1`
> 真相对照（SSoT，只读引用）:
> - `packages/nacp-session/src/stream-event.ts`
> - `packages/nacp-session/src/type-direction-matrix.ts`
> - `packages/nacp-session/src/messages.ts`
> - `packages/nacp-core/src/error-registry.ts`
> - `docs/design/hero-to-pro/HPX-qna.md` (Q16, Q18, Q23, Q32)
> - `docs/charter/plan-hero-to-pro.md` §7.1–7.8
> 复用 / 对照的既有审查:
> - `docs/eval/hero-to-pro/agentic-loop-api-study-by-GLM.md` — 仅作线索
> - `docs/eval/hero-to-pro/agentic-loop-api-study-by-GPT.md` — 仅作线索
> - `docs/eval/hero-to-pro/closing-thoughts-part-2-by-opus.md` — 仅作线索
> 文档状态: `draft`

---

## 0. 总判定 / Executive Summary

- **整体 verdict**：`Permissions 簇存在 2 项响应形状 FINDING；Session WS 簇存在 emitter-pending 的已知 WARN；Session HTTP Lifecycle 簇基本合规，但 retry/fork 仍为 first-wave absorbed。`
- **结论等级**：`compliant-with-followups`
- **是否允许声明合规**：`no`（需先修 F-PERM-01 / F-PERM-02）
- **本轮最关键的 1-3 个判断**：
  1. `POST /sessions/{id}/permission/decision` 与 `POST /sessions/{id}/elicitation/answer` 的响应 payload 与 API 文档约定不符（缺少 `confirmation_uuid` / `confirmation_status`），构成 FINDING。
  2. `retry` / `fork` 端点是 first-wave absorbed，功能骨架完整但核心 executor 未接通，属于已知设计选择（OBSERVATION）。
  3. `session-ws-v1` 的 `model.fallback` / `session.fork.created` 帧为 schema live、emitter pending，符合文档声明。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Permissions | 3 | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | PARTIAL |
| Session WS v1 | 1+frames | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN |
| Session HTTP Lifecycle | 17 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 2 | yes |
| ⚠️ WARN     | 2 | no（建议修） |
| 📝 OBSERVATION | 3 | no（仅记录） |

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
  - `clients/api-docs/permissions.md`
  - `clients/api-docs/session-ws-v1.md`
  - `clients/api-docs/session.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/index.ts:433-489` (`parseSessionRoute`)
  - `workers/orchestrator-core/src/index.ts:786-841` (session route dispatch + wrap)
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:285-387` (`handlePermissionDecision`)
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:389-481` (`handleElicitationAnswer`)
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:646-671` (`handlePolicyPermissionMode`)
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts:50-151` (`handleWsAttach`)
  - `workers/orchestrator-core/src/user-do/session-flow.ts:232-964` (lifecycle handlers)
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:123-319` (`handleMessages`)
  - `workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-71` (retry / fork first-wave)
- **核查的契约 / SSoT**：
  - `packages/nacp-session/src/stream-event.ts` (13-kind catalog)
  - `packages/nacp-session/src/type-direction-matrix.ts`
  - `packages/nacp-session/src/messages.ts`
  - `packages/nacp-core/src/error-registry.ts` (ad-hoc + NACP error codes)
  - `docs/design/hero-to-pro/HPX-qna.md` Q16 (row-first dual-write)
- **执行过的验证**：
  - `workers/orchestrator-core/test/confirmation-dual-write.test.ts` (HP5 row-first)
  - `workers/orchestrator-core/test/permission-decision-route.test.ts`
  - `workers/orchestrator-core/test/elicitation-answer-route.test.ts`
  - `workers/orchestrator-core/test/policy-permission-mode-route.test.ts`
  - `workers/orchestrator-core/test/chat-lifecycle-route.test.ts`
  - `workers/orchestrator-core/test/user-do.test.ts`
  - `workers/orchestrator-core/test/user-do-chat-lifecycle.test.ts`
  - `workers/orchestrator-core/test/messages-route.test.ts`
  - `workers/orchestrator-core/test/usage-strict-snapshot.test.ts`

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行核对了 handler 实现、路由解析、响应包装 |
| 单元 / 集成测试运行 | yes | 读取了测试源码并分析了覆盖路径，未实际执行测试 runner |
| Drift gate 脚本运行 | no | 本轮未执行 `pnpm check:*`；依赖既有 closure 报告 |
| schema / contract 反向校验 | yes | 核对了 `stream-event.ts` 13-kind catalog 与 `type-direction-matrix.ts` |
| live / preview / deploy 证据 | no | 未接入 live 环境 |
| 与上游 design / Q-law 对账 | yes | 核对了 Q16/Q18/Q23/Q32 等 frozen law |

### 1.5 跨簇横切观察

- **架构与路由层**：所有簇都经 `orchestrator-core` `dispatchFetch()` → `parseSessionRoute()` / compound route parser → `stub.fetch()` → User DO handler。
- **Envelope 契约**：
  - 大部分 session 路由使用 `facade-http-v1` 的 `{ ok, data?, error?, trace_uuid }`（`wrapSessionResponse` 在 `index.ts:2962-3027` 做 idempotent wrap）。
  - 少数 legacy DO action ack 保持 `{ ok, action, session_uuid, session_status, trace_uuid }` 透传。
- **Auth 模式**：
  - HTTP 路由统一使用 `Authorization: Bearer <jwt>` header。
  - WS 路由使用 `?access_token=<jwt>` query param（`allowQueryToken: true`）。
- **Trace 传播**：
  - facade 层从 `x-trace-uuid` header 读取 trace；proxy 到 User DO 时注入 `x-trace-uuid` 和 `x-nano-internal-authority`。
  - 响应头带回 `x-trace-uuid`。
- **NACP authority 翻译**：JWT claim → `IngressAuthSnapshot` → JSON 序列化后通过 `x-nano-internal-authority` 透传。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| Permissions | POST /sessions/{id}/permission/decision | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | FAIL | 响应缺 confirmation_uuid/confirmation_status (F-PERM-01) |
| Permissions | POST /sessions/{id}/policy/permission_mode | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Permissions | POST /sessions/{id}/elicitation/answer | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | FAIL | 响应缺 confirmation_uuid/confirmation_status (F-PERM-02) |
| Session WS v1 | GET /sessions/{id}/ws | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session WS v1 | POST /sessions/{id}/verify (spike) | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | preview-only，生产默认关闭 |
| Session WS v1 | server→client frames (13 kinds) | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | model.fallback / session.fork.created emitter pending |
| Session HTTP Lifecycle | POST /sessions/{id}/start | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | POST /sessions/{id}/input | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | POST /sessions/{id}/messages | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | POST /sessions/{id}/cancel | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | POST /sessions/{id}/close | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | DELETE /sessions/{id} | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | PATCH /sessions/{id}/title | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | GET /sessions/{id}/status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | GET /sessions/{id}/timeline | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 直接 D1 读取 vs forward 路径混用 |
| Session HTTP Lifecycle | GET /sessions/{id}/history | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 直接 D1 读取 vs forward 路径混用 |
| Session HTTP Lifecycle | POST /sessions/{id}/verify | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | preview-only |
| Session HTTP Lifecycle | POST /sessions/{id}/resume | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP Lifecycle | POST /sessions/{id}/retry | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | first-wave absorbed，非真 retry (O-SESS-01) |
| Session HTTP Lifecycle | POST /sessions/{id}/fork | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | first-wave absorbed，pending-executor (O-SESS-02) |
| Session HTTP Lifecycle | GET /sessions/{id}/usage | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | snapshot 测试为主 |
| Session HTTP Lifecycle | GET /conversations/{conversation_uuid} | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

---

## 3. 簇级深度分析

### 3.1 簇 — Permissions（`clients/api-docs/permissions.md`）

#### 3.1.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()            workers/orchestrator-core/src/index.ts:848
  → parseSessionRoute() (4-segment compound)     workers/orchestrator-core/src/index.ts:476-488
  → authenticateRequest()                        workers/orchestrator-core/src/auth.ts
  → stub.fetch() → User DO                       workers/orchestrator-core/src/index.ts:821-834
  → user-do-runtime.dispatch()                   workers/orchestrator-core/src/user-do-runtime.ts:508-536
  → surface-runtime.handlePermissionDecision()   workers/orchestrator-core/src/user-do/surface-runtime.ts:285-387
     ├─ ensureConfirmationDecision()             workers/orchestrator-core/src/user-do/surface-runtime.ts:77-115
     ├─ ctx.put() KV fallback                    workers/orchestrator-core/src/user-do/surface-runtime.ts:346-351
     └─ AGENT_CORE.permissionDecision RPC         workers/orchestrator-core/src/user-do/surface-runtime.ts:354-380
  → wrapSessionResponse()                        workers/orchestrator-core/src/index.ts:2962-3027
```

**链路注记**：`permission/decision` 与 `elicitation/answer` 共享同一 4-segment compound route parser；`policy/permission_mode` 同理。三者都经 facade → User DO → surface-runtime → D1 row-first dual-write。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| POST /permission/decision | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | FAIL | F-PERM-01 |
| POST /policy/permission_mode | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /elicitation/answer | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | FAIL | F-PERM-02 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 POST `/sessions/{id}/permission/decision`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:481` → `user-do-runtime.ts:508` → `surface-runtime.ts:285` → `ensureConfirmationDecision:77` → D1 + KV + RPC；行为：row-first dual-write（Q16），conflict 走 409，RPC 失败不抛错 |
| **F2 测试覆盖** | ✅ | 单测：`confirmation-dual-write.test.ts:118-177`（row-first + conflict）；路由测试：`permission-decision-route.test.ts`（5 cases，含 401/400/404） |
| **F3 形态合规** | ❌ | auth：bearer（符合）；request：UUID + decision enum 校验（符合）；response：❌ **文档要求 `{ data: { confirmation_uuid, confirmation_status } }`，代码只返回 `{ request_uuid, decision, scope }`**（`surface-runtime.ts:383-386`）；error：400/401/409 符合 |
| **F4 NACP 合规** | ✅ | envelope：`facade-http-v1` `{ ok, data, trace_uuid }`；trace：header 注入 + 响应带回；authority：`x-nano-internal-authority` 透传；tenant：team_uuid claim 校验 |
| **F5 文档一致性** | ❌ | 文档 `permissions.md:64-76` 声明的响应形状与代码 `surface-runtime.ts:383-386` 不符 |
| **F6 SSoT 漂移** | ✅ | drift gate：未触发；契约对账：Q16 row-first dual-write 已实现 |

**关联 finding**：`F-PERM-01`

##### 3.1.2.2 POST `/sessions/{id}/elicitation/answer`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:483` → `user-do-runtime.ts:528` → `surface-runtime.ts:389` → `ensureConfirmationDecision:77` → D1 + KV + RPC；行为：cancelled → superseded（Q16），conflict 走 409 |
| **F2 测试覆盖** | ✅ | 单测：`confirmation-dual-write.test.ts:179-214`（modified + superseded）；路由测试：`elicitation-answer-route.test.ts`（5 cases，含 401/400/404/idempotency） |
| **F3 形态合规** | ❌ | auth：bearer（符合）；request：UUID + answer 必填（符合）；response：❌ **文档要求 `{ data: { confirmation_uuid, confirmation_status: "modified" } }`，代码只返回 `{ request_uuid, answer }`**（`surface-runtime.ts:478-481`）；error：400/401/409 符合 |
| **F4 NACP 合规** | ✅ | envelope：`facade-http-v1`；trace/authority/tenant 同 permission/decision |
| **F5 文档一致性** | ❌ | 文档 `permissions.md:137-148` 声明的响应形状与代码 `surface-runtime.ts:478-481` 不符 |
| **F6 SSoT 漂移** | ✅ | Q16 已实现；无 drift |

**关联 finding**：`F-PERM-02`

##### 3.1.2.3 POST `/sessions/{id}/policy/permission_mode`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：`index.ts:482` → `user-do-runtime.ts:518` → `surface-runtime.ts:646`；行为：写入 User DO KV `permission_mode/${sessionUuid}`，不经过 confirmation row |
| **F2 测试覆盖** | ✅ | 路由测试：`policy-permission-mode-route.test.ts`（5 cases，含 cross-session 隔离） |
| **F3 形态合规** | ✅ | auth：bearer；request：`{ mode }` enum 校验；response：`{ data: { session_uuid, mode } }`（`surface-runtime.ts:667-670`）与文档一致 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority/tenant 均合规 |
| **F5 文档一致性** | ✅ | 文档 `permissions.md:94-116` 与代码一致 |
| **F6 SSoT 漂移** | ✅ | 无 drift |

**关联 finding**：无

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `wrapSessionResponse:index.ts:2962-3027` |
| `x-trace-uuid` 在 response 头里 | ✅ | `wrapSessionResponse:3000,3006,3025` |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `error-registry.ts` 注册了 `invalid-input`、`confirmation-already-resolved`、`missing-team-claim` 等 |
| Tenant 边界 5 规则被守住 | ✅ | `authenticateRequest` 中 team_uuid/tenant_uuid claim 校验 |
| Authority 翻译合法（HTTP claim → server-stamped） | ✅ | `auth.value.snapshot` 序列化后透传 |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| F-PERM-01 | ❌ | F3 | `permission/decision` 响应缺少 `confirmation_uuid` / `confirmation_status` | 客户端按文档解析会失败或拿到 undefined |
| F-PERM-02 | ❌ | F3 | `elicitation/answer` 响应缺少 `confirmation_uuid` / `confirmation_status` | 同上 |

#### 3.1.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| POST /sessions/{id}/policy/permission_mode | 无异常，按 doc 实链 |

---

### 3.2 簇 — Session WS v1（`clients/api-docs/session-ws-v1.md`）

#### 3.2.0 路由轨迹（Route Trace）

```text
Client (WebSocket upgrade)
  → orchestrator-core/dispatchFetch()            workers/orchestrator-core/src/index.ts:848
  → parseSessionRoute() (action === "ws")        workers/orchestrator-core/src/index.ts:458
  → authenticateRequest(allowQueryToken: true)   workers/orchestrator-core/src/index.ts:789-792
  → stub.fetch(request) [透传原始 upgrade req]   workers/orchestrator-core/src/index.ts:797
  → user-do-runtime.dispatch()                   workers/orchestrator-core/src/user-do-runtime.ts:499
  → ws-runtime.handleWsAttach()                  workers/orchestrator-core/src/user-do/ws-runtime.ts:50
     ├─ requireReadableSession()                 session gate
     ├─ readWsAuthority() / readInternalAuthority()  auth
     ├─ isWebSocketUpgrade()                     ws-bridge.ts
     ├─ createWebSocketPair()                    ws-bridge.ts
     ├─ readInternalStream()                     parity-bridge / KV
     ├─ supersede old attachment                 emit session.attachment.superseded
     └─ forwardFramesToAttachment()              replay buffered events
  → Response(101, webSocket: pair.client)        ws-runtime.ts:142-150
```

**链路注记**：public façade 对 WS 路由直接透传原始 request（含 upgrade headers）到 User DO，不再 synthetic 新 request（HPX2 P2-01 修复）。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| GET /sessions/{id}/ws | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /sessions/{id}/verify (spike) | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-WS-01 |
| server→client frames | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-WS-01 |
| client→server frames | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 GET `/sessions/{id}/ws`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | 完整链路：upgrade 检测 → auth → session gate → supersede → heartbeat → frame replay → 101 response |
| **F2 测试覆盖** | ✅ | package-e2e：`03-ws-attach.test.mjs`、`04-reconnect.test.mjs`（HPX2 修复后 live green） |
| **F3 形态合规** | ✅ | auth：query token；请求：upgrade header + `last_seen_seq`；响应：101 Switching Protocols；错误：400/401/403/404/409 |
| **F4 NACP 合规** | ✅ | WS frame envelope 由 `nacp-session` schema 定义；trace 通过 HTTP handshake 注入 |
| **F5 文档一致性** | ✅ | `session-ws-v1.md` 与实现一致 |
| **F6 SSoT 漂移** | ✅ | 13-kind catalog 与 `stream-event.ts:165-179` 一致 |

##### 3.2.2.2 Server → Client Frames（13-kind catalog）

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | zod schema 在 `stream-event.ts:147-161` 定义；server emit 前跑 schema validate |
| **F2 测试覆盖** | ⚠️ | `model.fallback` / `session.fork.created` 无真实 emitter 测试；其余 kinds 有 live-e2e / unit 覆盖 |
| **F3 形态合规** | ✅ | 所有 13 kinds 有 strict zod schema；`type-direction-matrix.ts` 定义了合法方向 |
| **F4 NACP 合规** | ✅ | `session.stream.event` outer frame + payload.kind 双层枚举；direction matrix 守住 server-only / client-only 边界 |
| **F5 文档一致性** | ✅ | `session-ws-v1.md:51-67` 的 13-kind 列表与代码一致；readiness 标注清晰 |
| **F6 SSoT 漂移** | ✅ | 无 drift |

**关联 finding**：`W-WS-01`

##### 3.2.2.3 POST `/sessions/{id}/verify` (Synthetic Spike Trigger)

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | preview-only；`NANO_ENABLE_RHX2_SPIKE !== "true"` 时返回 403 `spike-disabled`；无 WS 附着时返回 409 `no-attached-client` |
| **F2 测试覆盖** | ⚠️ | 无专门的路由级测试文件；功能在 `verify` handler 中内联实现 |
| **F3 形态合规** | ✅ | 请求/响应/错误码与文档一致 |
| **F4 NACP 合规** | ✅ | envelope/trace 合规 |
| **F5 文档一致性** | ✅ | `session-ws-v1.md:203-209` 与代码一致 |
| **F6 SSoT 漂移** | ✅ | 无 drift |

**关联 finding**：`O-WS-01`

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Frame schema 全部由 zod 定义 | ✅ | `stream-event.ts` |
| Direction matrix 守住 server→client / client→server 边界 | ✅ | `type-direction-matrix.ts` |
| `session.confirmation.*` / `session.todos.*` 为 server-only | ✅ | `type-direction-matrix.ts:37-43` |
| Legacy `session.permission.request` / `session.elicitation.request` 仍注册但不再 emit | ✅ | 文档已声明（`permissions.md:20`） |

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| W-WS-01 | ⚠️ | F2 | `model.fallback` / `session.fork.created` emitter 未接通 | 客户端无法收到这两个帧；schema 已注册但 runtime 不 emit |
| O-WS-01 | 📝 | F2 | `POST /sessions/{id}/verify` spike trigger 无独立路由测试 | preview-only 功能，生产关闭 |

#### 3.2.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| GET /sessions/{id}/ws | 无异常，HPX2 修复后 attach/reconnect 稳定 |
| client→server frames (session.resume / session.heartbeat / session.stream.ack) | 无异常，仅作 activity touch |

---

### 3.3 簇 — Session HTTP Lifecycle（`clients/api-docs/session.md`）

#### 3.3.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()            workers/orchestrator-core/src/index.ts:848
  → parseSessionRoute() (3-segment)              workers/orchestrator-core/src/index.ts:443-471
  → authenticateRequest()                        workers/orchestrator-core/src/auth.ts
  → stub.fetch() → User DO                       workers/orchestrator-core/src/index.ts:821-834
  → user-do-runtime.dispatch()                   workers/orchestrator-core/src/user-do-runtime.ts:451-574
     ├─ session-flow.ts (start/input/cancel/close/delete/title/verify/read)
     ├─ message-runtime.ts (messages)
     ├─ ws-runtime.ts (ws attach)
     ├─ surface-runtime.ts (usage/resume/permission/elicitation)
     └─ hp-absorbed-handlers.ts (retry/fork)
  → wrapSessionResponse()                        workers/orchestrator-core/src/index.ts:2962-3027
```

**链路注记**：`retry` / `fork` 走 `hp-absorbed-handlers.ts`，不经过 agent-core；其余 lifecycle 路由经过 `session-flow.ts` 或 `message-runtime.ts`。

#### 3.3.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| POST /start | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /input | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /messages | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /cancel | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /close | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| DELETE /{id} | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| PATCH /title | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| GET /status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| GET /timeline | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-02 |
| GET /history | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-02 |
| POST /verify | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-WS-01 |
| POST /resume | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| POST /retry | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-01 |
| POST /fork | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-02 |
| GET /usage | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-03 |
| GET /conversations/{uuid} | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

#### 3.3.2 端点逐项分析

##### 3.3.2.1 POST `/sessions/{id}/retry`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route 真实存在；handler 在 `hp-absorbed-handlers.ts:9-40`；返回 `retry_kind: "request-acknowledged-replay-via-messages"` |
| **F2 测试覆盖** | ⚠️ | 无独立测试文件；功能为 first-wave absorbed（HP4-D1） |
| **F3 形态合规** | ✅ | 请求/响应/错误码与文档一致 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority 合规 |
| **F5 文档一致性** | ✅ | `session.md:221-236` 已明确标注为 first-wave |
| **F6 SSoT 漂移** | ✅ | 无 drift |

**关联 finding**：`O-SESS-01`

##### 3.3.2.2 POST `/sessions/{id}/fork`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route 真实存在；handler 在 `hp-absorbed-handlers.ts:42-71`；mint child UUID，返回 `fork_status: "pending-executor"` |
| **F2 测试覆盖** | ⚠️ | 无独立测试文件；功能为 first-wave absorbed（HP7-D3） |
| **F3 形态合规** | ✅ | 202 响应 + `child_session_uuid` 与文档一致 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority 合规 |
| **F5 文档一致性** | ✅ | `session.md:239-255` 已明确标注为 pending-executor |
| **F6 SSoT 漂移** | ✅ | 无 drift |

**关联 finding**：`O-SESS-02`

##### 3.3.2.3 GET `/sessions/{id}/timeline` / GET `/sessions/{id}/history`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `timeline`：直接 D1 读取或 forward 到 agent-core；`history`：直接 D1 读取（HP4 cursor 化） |
| **F2 测试覆盖** | ⚠️ | `chat-lifecycle-route.test.ts` 未覆盖 timeline/history；`user-do.test.ts` 未直接断言 |
| **F3 形态合规** | ✅ | 请求/响应/错误码与文档一致 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority 合规 |
| **F5 文档一致性** | ✅ | `session.md:186-191` 与代码一致 |
| **F6 SSoT 漂移** | ✅ | 无 drift |

**关联 finding**：`W-SESS-02`

##### 3.3.2.4 GET `/sessions/{id}/usage`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `surface-runtime.ts:189-240`：D1 `readUsageSnapshot` + KV fallback |
| **F2 测试覆盖** | ⚠️ | `usage-strict-snapshot.test.ts` 覆盖 snapshot 读取，但非端到端 |
| **F3 形态合规** | ✅ | 响应形状 `{ data: { session_uuid, status, usage, last_seen_at, durable_truth } }` 与文档一致 |
| **F4 NACP 合规** | ✅ | envelope/trace/authority 合规 |
| **F5 文档一致性** | ✅ | `session.md:257-259` 指向 `usage.md` |
| **F6 SSoT 漂移** | ✅ | 无 drift |

**关联 finding**：`W-SESS-03`

#### 3.3.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `wrapSessionResponse` idempotent wrap |
| `x-trace-uuid` 在 response 头里 | ✅ | 全部 facade 响应带回 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `error-registry.ts` 注册了所有 ad-hoc codes |
| Tenant 边界 5 规则被守住 | ✅ | `enforceSessionDevice` + team claim 校验 |
| Authority 翻译合法（HTTP claim → server-stamped） | ✅ | `auth_snapshot` 透传 |

#### 3.3.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| O-SESS-01 | 📝 | F2 | `POST /retry` 为 request-acknowledged first wave，无真 retry executor | 客户端需按 hint 重发 messages |
| O-SESS-02 | 📝 | F2 | `POST /fork` 为 pending-executor first wave，snapshot copy 未执行 | 客户端需轮询 child session status |
| W-SESS-02 | ⚠️ | F2 | `GET /timeline` / `GET /history` 缺少 facade-level 集成测试 | 依赖 D1 直接读取路径未在 facade 测试覆盖 |
| W-SESS-03 | ⚠️ | F2 | `GET /usage` 仅 snapshot 单元测试，缺少 facade-level 集成测试 | — |

#### 3.3.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| POST /sessions/{id}/start | 无异常，支持 model_id/reasoning 透传 |
| POST /sessions/{id}/input | 无异常，透传至 messages handler |
| POST /sessions/{id}/messages | 无异常，multipart + model gate |
| POST /sessions/{id}/cancel | 无异常，幂等 |
| POST /sessions/{id}/close | 无异常，HP4 frozen |
| DELETE /sessions/{id} | 无异常，soft tombstone |
| PATCH /sessions/{id}/title | 无异常，200 char limit |
| GET /sessions/{id}/status | 无异常，D1 + runtime merge |
| POST /sessions/{id}/resume | 无异常，replay ack |
| GET /conversations/{conversation_uuid} | 无异常，D1 read model |

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| HTTP session routes | `Authorization: Bearer` header | JWT verify → `IngressAuthSnapshot` → JSON → `x-nano-internal-authority` | ✅ |
| WS session route | `?access_token=` query param | 同上，但 `allowQueryToken: true` | ✅ |
| Internal User-DO RPC | `x-nano-internal-authority` header | 反序列化为 `IngressAuthSnapshot` | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| HTTP session routes | `x-trace-uuid` header | facade → User DO `x-trace-uuid` → response header | required | ✅ |
| WS session route | `x-trace-uuid` header / `trace_uuid` query | handshake → User DO → audit log | required | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` / `RpcErrorCodeSchema` 的超集：✅
- 编译期 guard：`error-registry.ts:324-353` — `listCrossSourceDuplicateCodes()`
- 运行期回退：未知 code → `internal-error`

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| All session routes | `team_uuid` / `tenant_uuid` JWT claim + `enforceSessionDevice` | 5/5 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `pnpm check:envelope-drift` | 未执行（本轮未跑 drift gate） |
| `pnpm check:tool-drift` | 未执行 |
| `pnpm check:cycles` | 未执行 |
| `pnpm check:megafile` | 未执行 |
| 错误信封 drift（人工核查） | ✅ 未发现违例：`wrapSessionResponse` 的 idempotency 检测已硬化（DeepSeek R6 / Kimi R9） |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| F-PERM-01 | ❌ | Permissions | POST /permission/decision | F3 | 响应缺少 `confirmation_uuid` / `confirmation_status` | 客户端按文档解析拿到 undefined | yes | A1 |
| F-PERM-02 | ❌ | Permissions | POST /elicitation/answer | F3 | 响应缺少 `confirmation_uuid` / `confirmation_status` | 同上 | yes | A2 |
| W-WS-01 | ⚠️ | Session WS v1 | server→client frames | F2 | `model.fallback` / `session.fork.created` emitter pending | 客户端无法收到这两个帧 | no | — |
| W-SESS-02 | ⚠️ | Session HTTP | GET /timeline, GET /history | F2 | 缺少 facade-level 集成测试 | 路径变更风险 | no | A3 |
| W-SESS-03 | ⚠️ | Session HTTP | GET /usage | F2 | 仅 snapshot 单元测试 | 路径变更风险 | no | A4 |
| O-SESS-01 | 📝 | Session HTTP | POST /retry | F2 | first-wave absorbed，无真 retry executor | 客户端需手动 replay | no | — |
| O-SESS-02 | 📝 | Session HTTP | POST /fork | F2 | pending-executor first wave | 客户端需轮询 | no | — |
| O-WS-01 | 📝 | Session WS v1 | POST /verify | F2 | preview-only spike，无独立测试 | 生产默认关闭 | no | — |

### 5.2 Finding 详情

#### `F-PERM-01` — `permission/decision` 响应缺少 `confirmation_uuid` / `confirmation_status`

- **严重级别**：❌ FINDING
- **簇 / 端点**：Permissions / POST `/sessions/{id}/permission/decision`
- **维度**：F3
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:383-386` — 返回 `{ data: { request_uuid, decision, scope } }`
  - `clients/api-docs/permissions.md:64-76` — 文档期望 `{ data: { request_uuid, decision, scope, confirmation_uuid, confirmation_status } }`
  - 契约对照：HP5 row-first dual-write 已将 `request_uuid` 映射为 `confirmation_uuid`，代码中 `requestUuid` 变量即 confirmation row UUID
- **为什么重要**：
  - 客户端按文档解析会拿到 `undefined`，破坏协议契约
  - 这是 HP5 统一 confirmation plane 的 legacy compat 层，响应应与 `/confirmations/{uuid}/decision` 对齐
- **修法（What + How）**：
  - **改什么**：在 `handlePermissionDecision` 的响应 payload 中补入 `confirmation_uuid: requestUuid` 和 `confirmation_status: confirmationStatus`
  - **怎么改**：修改 `surface-runtime.ts:383-386`
  - **改完后的形态**：
    ```typescript
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
    ```
  - **测试增量**：在 `confirmation-dual-write.test.ts` 中断言 response body 包含 `confirmation_uuid` 和 `confirmation_status`
- **建议行动项**：`A1`
- **复审要点**：确认 `confirmation_status` 的值域（`allowed` / `denied`）与文档一致

#### `F-PERM-02` — `elicitation/answer` 响应缺少 `confirmation_uuid` / `confirmation_status`

- **严重级别**：❌ FINDING
- **簇 / 端点**：Permissions / POST `/sessions/{id}/elicitation/answer`
- **维度**：F3
- **是否 blocker**：yes
- **事实依据**：
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:478-481` — 返回 `{ data: { request_uuid, answer } }`
  - `clients/api-docs/permissions.md:137-148` — 文档期望 `{ data: { request_uuid, answer, confirmation_uuid, confirmation_status: "modified" } }`
  - 契约对照：同上，`requestUuid` 即 confirmation row UUID
- **为什么重要**：同 F-PERM-01
- **修法（What + How）**：
  - **改什么**：补入 `confirmation_uuid: requestUuid` 和 `confirmation_status: elicitationStatus`
  - **怎么改**：修改 `surface-runtime.ts:478-481`
  - **改完后的形态**：
    ```typescript
    return jsonResponse(200, {
      ok: true,
      data: {
        request_uuid: requestUuid,
        answer,
        confirmation_uuid: requestUuid,
        confirmation_status: elicitationStatus,
      },
    });
    ```
  - **测试增量**：在 `confirmation-dual-write.test.ts` 中断言 response body 包含 `confirmation_uuid` 和 `confirmation_status`
- **建议行动项**：`A2`
- **复审要点**：确认 `elicitationStatus` 值域（`modified` / `superseded`）与文档一致

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | F-PERM-01 | Permissions / POST /permission/decision | 补 `confirmation_uuid` / `confirmation_status` 到响应 payload | `surface-runtime.ts` | `confirmation-dual-write.test.ts` 加断言 | XS |
| **A2** | P0 | F-PERM-02 | Permissions / POST /elicitation/answer | 补 `confirmation_uuid` / `confirmation_status` 到响应 payload | `surface-runtime.ts` | `confirmation-dual-write.test.ts` 加断言 | XS |
| **A3** | P1 | W-SESS-02 | Session HTTP / GET /timeline, GET /history | 补 facade-level 集成测试（mock User DO + D1） | `chat-lifecycle-route.test.ts` 或新建 | 覆盖 happy path + 404 | S |
| **A4** | P1 | W-SESS-03 | Session HTTP / GET /usage | 补 facade-level 集成测试 | 新建 `usage-route.test.ts` | 覆盖 happy path + D1 失败降级 | S |

### 6.1 整体修复路径建议

1. **A1 + A2 合并为一个 PR**：两处修改都在 `surface-runtime.ts`，语义一致（HP5 legacy compat 响应补全），合并修改减少 churn。
2. **A3 + A4 可合并为另一个 PR**：都是 Session HTTP Lifecycle 簇的测试缺口补全。
3. **W-WS-01**（model.fallback / session.fork.created emitter）不阻塞本轮合规声明，但应在 hero-to-pro closure 前明确 owner 和 timeline。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| O-SESS-01 | first-wave absorbed 是 HP4 设计选择，full executor 在后续批次 | HP4 closure 或 retry executor 接通 | — | — |
| O-SESS-02 | pending-executor 是 HP7 设计选择，snapshot copy 在后续批次 | HP7 closure 或 fork executor 接通 | — | — |
| W-WS-01 | schema live、emitter pending 是已知状态，文档已标注 | emitter 接通后 | — | — |

---

## 7. 测试覆盖矩阵

### 7.1 端点 × 测试层

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| POST /permission/decision | `confirmation-dual-write.test.ts` | `permission-decision-route.test.ts` | 无 | +400/+401/+404 | ✅ |
| POST /policy/permission_mode | 无 | `policy-permission-mode-route.test.ts` | 无 | +400/+401 | ✅ |
| POST /elicitation/answer | `confirmation-dual-write.test.ts` | `elicitation-answer-route.test.ts` | 无 | +400/+401/+404 | ✅ |
| GET /ws | 无 | 无 | `03-ws-attach.test.mjs` | +400/+401/+403/+404/+409 | ✅ |
| POST /start | `user-do.test.ts` | 无 | live | +400/+401/+409 | ✅ |
| POST /input | `user-do.test.ts` | 无 | live | +400 | ✅ |
| POST /messages | `user-do.test.ts` | `messages-route.test.ts` | live | +400/+403 | ✅ |
| POST /cancel | `user-do.test.ts` | 无 | live | +400 | ✅ |
| POST /close | `user-do-chat-lifecycle.test.ts` | `chat-lifecycle-route.test.ts` | live | +400/+409 | ✅ |
| DELETE /{id} | `user-do-chat-lifecycle.test.ts` | `chat-lifecycle-route.test.ts` | live | +400/+404 | ✅ |
| PATCH /title | `user-do-chat-lifecycle.test.ts` | `chat-lifecycle-route.test.ts` | live | +400 | ✅ |
| GET /status | 无 | 无 | live | +404 | ⚠️ |
| GET /timeline | 无 | 无 | live | +404 | ⚠️ |
| GET /history | 无 | 无 | live | +404 | ⚠️ |
| POST /verify | 无 | 无 | 无 | +403/+409 | ❌ |
| POST /resume | 无 | 无 | live | +400 | ⚠️ |
| POST /retry | 无 | 无 | 无 | +404/+409 | ❌ |
| POST /fork | 无 | 无 | 无 | +404/+409 | ❌ |
| GET /usage | 无 | `usage-strict-snapshot.test.ts` | 无 | +503 | ⚠️ |
| GET /conversations/{uuid} | 无 | `chat-lifecycle-route.test.ts` | live | +404 | ✅ |

### 7.2 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| GET /sessions/{id}/timeline | facade-level 集成测试 | `chat-lifecycle-route.test.ts` | W-SESS-02 |
| GET /sessions/{id}/history | facade-level 集成测试 | `chat-lifecycle-route.test.ts` | W-SESS-02 |
| GET /sessions/{id}/usage | facade-level 集成测试 | 新建 `usage-route.test.ts` | W-SESS-03 |
| POST /sessions/{id}/retry | 基础路由测试 | 新建 `retry-route.test.ts` | O-SESS-01 |
| POST /sessions/{id}/fork | 基础路由测试 | 新建 `fork-route.test.ts` | O-SESS-02 |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | 433-489, 786-841, 2962-3027 | 路由解析 / 调度入口 / envelope wrap |
| `workers/orchestrator-core/src/user-do-runtime.ts` | 451-574 | 业务 handler 分发 |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | 77-115, 285-387, 389-481, 646-671 | permission / elicitation / policy / usage handler |
| `workers/orchestrator-core/src/user-do/session-flow.ts` | 232-964 | session lifecycle handlers |
| `workers/orchestrator-core/src/user-do/message-runtime.ts` | 123-319 | messages handler |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts` | 50-151 | WebSocket attach handler |
| `workers/orchestrator-core/src/hp-absorbed-handlers.ts` | 9-71 | retry / fork first-wave handlers |
| `packages/nacp-session/src/stream-event.ts` | 147-161 | 13-kind zod schema |
| `packages/nacp-session/src/type-direction-matrix.ts` | 14-55 | frame direction legality |
| `packages/nacp-core/src/error-registry.ts` | 270-306 | ad-hoc error codes |
| `workers/orchestrator-core/test/confirmation-dual-write.test.ts` | 1-214 | HP5 row-first dual-write 单元测试 |
| `workers/orchestrator-core/test/permission-decision-route.test.ts` | 1-185 | permission decision 路由测试 |
| `workers/orchestrator-core/test/elicitation-answer-route.test.ts` | 1-194 | elicitation answer 路由测试 |
| `workers/orchestrator-core/test/policy-permission-mode-route.test.ts` | 1-214 | policy mode 路由测试 |
| `workers/orchestrator-core/test/chat-lifecycle-route.test.ts` | 1-478 | close/delete/title/conversation 路由测试 |
| `workers/orchestrator-core/test/user-do.test.ts` | 1260-1402 | user DO 集成测试 |
| `clients/api-docs/permissions.md` | 1-165 | 受查文档 |
| `clients/api-docs/session-ws-v1.md` | 1-261 | 受查文档 |
| `clients/api-docs/session.md` | 1-285 | 受查文档 |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

> 实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**：`same reviewer rereview`
- **二次审查触发条件**：
  - `A1` PR merged
  - `A2` PR merged
- **二次审查应重点核查**：
  1. `confirmation-dual-write.test.ts` 是否包含 `confirmation_uuid` / `confirmation_status` 断言
  2. `wrapSessionResponse` 是否保持 idempotent（不破坏现有 envelope）

### 9.3 合规声明前的 blocker

> 在以下 blocker 全部关闭前，**不得**对外声明本批 API 已 NACP 合规。

1. `F-PERM-01` — Finding `permission/decision` 响应形状 — Action `A1`
2. `F-PERM-02` — Finding `elicitation/answer` 响应形状 — Action `A2`

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> （当前状态为 draft，此节留白待实现者 append。）

### 10.1 回应汇总表

| Finding ID | 处理结果 | PR / Commit | 验证证据 | reviewer 复核结论 |
|------------|----------|-------------|----------|-------------------|
| | | | | |

### 10.2 逐条回应

> （待实现者补充）
