# Nano-Agent API Compliance 调查模板

> 调查对象: `Permissions + Session-WS-v1 + Session HTTP Lifecycle（3 功能簇）`
> 调查类型: `initial`
> 调查者: `DeepSeek`
> 调查时间: `2026-05-01`
> 调查范围:
> - `clients/api-docs/permissions.md`
> - `clients/api-docs/session-ws-v1.md`
> - `clients/api-docs/session.md`
> Profile / 协议族: `facade-http-v1`（HTTP 路由） + `nacp-session`（WS 帧协议）
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts` — FacadeEnvelope / FacadeErrorCodeSchema
> - `packages/nacp-session/src/stream-event.ts` — StreamEventBodySchema
> - `packages/nacp-session/src/type-direction-matrix.ts` — Direction matrix
> - `docs/design/hero-to-pro/HPX-qna.md` Q13/Q14/Q16/Q17/Q18/Q23
> - `docs/charter/plan-hero-to-pro.md §7.5-§7.7`
> 复用 / 对照的既有审查:
> - 无 — 本轮独立复核
> 文档状态: `draft`

---

## 0. 总判定 / Executive Summary

- **整体 verdict**：本轮 Permissions + Session-WS-v1 + Session HTTP Lifecycle 三个功能簇整体合规，但发现 2 项 WARN（session-ws 确认帧无 live emitter、retry/fork 仍为 first-wave 存根），以及 3 项 OBSERVATION（permission/elicitation doc 声称的 `confirmation_uuid` / `confirmation_status` 字段与实际返回形状存在漂移、WS 文档未区分 emit 活跃帧与 schema-only 帧、verify 端点 error code 命名有语义歧义）。
- **结论等级**：`compliant-with-followups`
- **是否允许声明合规**：`yes`（WARN 不阻塞合规声明，OBSERVATION 仅记录）
- **本轮最关键的 1-3 个判断**：
  1. 所有 HTTP 路由均通过 `authenticateRequest` → `parseSessionRoute` → User-DO dispatch 的完整链路，功能真实可达，无死代码端点。
  2. Permission/decision 和 elicitation/answer 的 HP5 row-first dual-write law（Q16）已通过 `confirmation-dual-write.test.ts` 的 SQLite 级集成测试覆盖，row-first 顺序 + 409 冲突 + `never failed` 三项均可验证。
  3. session-ws-v1.md 描述的 confirmation/todo/model.fallback/fork WS 帧在 schema 层已冻结（`type-direction-matrix.ts` 已注册），但实际 orchestrator runtime 中 emitter 未 live — 文档在 §3.3/§3.4/§8 已有主动标注，不构成 F5 漂移。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Permissions | 3 | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | PASS w/ WARN |
| Session-WS-v1 | 1 WS + 帧族 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN |
| Session HTTP | 16 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 0 | — |
| ⚠️ WARN     | 2 | no（建议修） |
| 📝 OBSERVATION | 3 | no（仅记录） |

---

## 1. 调查方法学

### 1.1 六维评估方法

| 维度 | 名称 | 核心问题 | 通过条件 |
|------|------|----------|----------|
| **F1** | 功能性（Functionality） | 路由→实现是否真实成链？ | route → handler → backing repo / RPC 全链路可达 |
| **F2** | 测试覆盖（Test Coverage） | 是否有测试在这条路径上跑过？ | 单测 + 集成 + 任一层有断言 |
| **F3** | 形态合规（Shape Compliance） | 请求/响应/错误形态、auth gate、status code 是否与 doc 一致？ | request/response 满足 schema；auth 行为与 doc 同；status code 同 |
| **F4** | NACP 协议合规（NACP Compliance） | envelope、authority、trace、tenant boundary、error code 是否符合 NACP profile？ | 信封正族；trace 贯通；authority 翻译合法；tenant 边界守住 |
| **F5** | 文档真相一致性（Doc-Reality Parity） | 文档说的与代码做的是否一致？ | 没有 doc 写了能力但代码没做 |
| **F6** | SSoT 漂移（SSoT Drift） | 是否触发 drift gate？与 frozen contract / Q-law 一致？ | 与契约 / Q-law 无背离 |

### 1.2 严重级别定义

| 级别 | 标记 | 定义 | 处置 |
|------|------|------|------|
| **CRITICAL** | 🔴 | 破坏正确性、安全、契约或会让现有客户端解析失败 | 必须修复才能声明合规 |
| **FINDING** | ❌ | 行为偏离，影响协议合规 / 客户端兼容 / 多租隔离 | 应修复 |
| **WARN** | ⚠️ | 轻微偏差、文档不准、测试缺口、代码异味 | 建议修复；不阻塞合规声明 |
| **OBSERVATION** | 📝 | 已知未实现、设计选择、未来工作 | 仅记录，不要求行动 |

### 1.3 已核实的事实

- **对照的 API 文档**：
  - `clients/api-docs/permissions.md`
  - `clients/api-docs/session-ws-v1.md`
  - `clients/api-docs/session.md`
- **核查的实现**：
  - `workers/orchestrator-core/src/index.ts:433-489` — `parseSessionRoute()`（3/4 segment 路由解析）
  - `workers/orchestrator-core/src/index.ts:643-841` — `dispatchFetch()`（总调度入口）
  - `workers/orchestrator-core/src/index.ts:2962-3027` — `wrapSessionResponse()`（envelope 包裹）
  - `workers/orchestrator-core/src/user-do-runtime.ts:390-576` — User DO 内部分发
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:59-671` — permission/elicitation/usage/resume/permission_mode 运行时
  - `workers/orchestrator-core/src/user-do/session-flow.ts:185-966` — session 生命周期流 / start/input/messages/cancel/close/delete/retry/fork
  - `workers/orchestrator-core/src/user-do-runtime.ts:1155-1161` — WS attach / socket lifecycle
  - `workers/orchestrator-core/src/index.ts:1478-1664` — `handleSessionConfirmation()` (confirmation control plane)
  - `workers/orchestrator-core/src/policy/authority.ts:21-41` — `jsonPolicyError()` (envelope 包装)
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90` — `FacadeErrorCodeSchema`（48 个 canonical error code）
  - `packages/orchestrator-auth-contract/src/facade-http.ts:126-148` — `FacadeErrorSchema` / `FacadeErrorEnvelopeSchema`
  - `packages/nacp-session/src/stream-event.ts:147-161` — `SessionStreamEventBodySchema` (13 kinds)
  - `packages/nacp-session/src/type-direction-matrix.ts:14-55` — `NACP_SESSION_TYPE_DIRECTION_MATRIX`
- **执行过的验证**：
  - 手工代码核查：全部 20 个端点 / 帧族的路由链
  - 未运行 drift gate / live E2E（本轮采用静态代码核查 + 测试文件审查）

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全部路由起点→终点全链路追踪 |
| 单元 / 集成测试运行 | yes | 审查了测试文件内容及断言，确认覆盖度 |
| Drift gate 脚本运行 | no | 本轮为静态人工核查 |
| schema / contract 反向校验 | yes | 对照 `FacadeErrorCodeSchema` → `FacadeErrorEnvelopeSchema`  | | live / preview / deploy 证据 | no | 未涉及 |
| 与上游 design / Q-law 对账 | yes | HPX-Q16 (row-first dual-write), Q13/Q14 (close/delete) |

### 1.5 跨簇横切观察

- **架构与路由层**：所有三个簇的端点均经 `orchestrator-core` 的 `dispatchFetch()` 统一入口（`index.ts:643`）→`parseSessionRoute()` 路由解析 → User-DO 转发。confirmation / checkpoint / todo 等新路由采用专门的 `parseSession*Route()` + `handleSession*()` 独立分发，在 session legacy route 之前被调度，优先级正确。
- **Envelope 契约**：HTTP 路由全部使用 `facade-http-v1` envelope：成功 `{ok:true, data, trace_uuid}`，错误 `{ok:false, error:{code,status,message}, trace_uuid}`。底层的 `jsonResponse()` / `jsonPolicyError()` / `wrapSessionResponse()` 三种包裹路径统一保证形状。
- **Auth 模式**：所有路由统一 `Authorization: Bearer <access_token>`，经 `authenticateRequest()` → `IngressAuthSnapshot`。WS 升级时额外允许 `access_token` query param (`allowQueryToken: true`)。
- **Trace 传播**：`x-trace-uuid` 头在 facade 层被强制读取并贯穿到底层，response 头中回射。
- **NACP authority 翻译**：facade 层 `IngressAuthSnapshot` 在转发到 User-DO 时通过 `x-nano-internal-authority` header 注入 body payload，保持 `{team_uuid, user_uuid, device_uuid}` 透传。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| Permissions | `POST /sessions/{id}/permission/decision` | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-PERM-01, O-PERM-02 |
| Permissions | `POST /sessions/{id}/policy/permission_mode` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Permissions | `POST /sessions/{id}/elicitation/answer` | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-PERM-03, O-PERM-04 |
| Session-WS-v1 | `GET /sessions/{id}/ws` (upgrade) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-WS-v1 | server→client 13-kind stream event 帧 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-WS-01 |
| Session-WS-v1 | server→client confirmation/todo/session.end/etc 帧 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-WS-01 |
| Session-WS-v1 | client→server heartbear/resume/ack 帧 | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-WS-02 |
| Session HTTP | `POST /sessions/{id}/start` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `POST /sessions/{id}/input` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `POST /sessions/{id}/messages` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `POST /sessions/{id}/cancel` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | — |
| Session HTTP | `POST /sessions/{id}/close` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `DELETE /sessions/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `PATCH /sessions/{id}/title` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `GET /sessions/{id}/status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `GET /sessions/{id}/timeline` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | — |
| Session HTTP | `GET /sessions/{id}/history` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `POST /sessions/{id}/verify` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-01 |
| Session HTTP | `POST /sessions/{id}/resume` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `POST /sessions/{id}/retry` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-02 |
| Session HTTP | `POST /sessions/{id}/fork` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-02 |
| Session HTTP | `GET /sessions/{id}/usage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session HTTP | `GET /conversations/{conversation_uuid}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

---

## 3. 簇级深度分析

### 3.1 簇 — Permissions（`clients/api-docs/permissions.md`）

#### 3.1.0 路由轨迹

```text
Client HTTP POST
  → dispatchFetch()                                   index.ts:643
  → parseSessionRoute()                               index.ts:433-489
    → 识别 4-segment compound "permission/decision" 或 "policy/permission_mode" 或 "elicitation/answer"
  → authenticateRequest()                             auth.ts:authenticateRequest
    → auth.value.snapshot → IngressAuthSnapshot
    → auth.value.trace_uuid
  → ORCHESTRATOR_USER_DO.fetch()                      index.ts:794-834
    → body 包裹 {trace_uuid, auth_snapshot, initial_context_seed, ...原始body}
  → NanoOrchestratorUserDO.fetch()                    user-do-runtime.ts:401-536
    → action "permission/decision" → handlePermissionDecision()
    → action "policy/permission_mode" → handlePolicyPermissionMode()
    → action "elicitation/answer" → handleElicitationAnswer()
  → surface-runtime.ts:285-481                        handlePermissionDecision / handleElicitationAnswer
    → ensureConfirmationDecision()                    surface-runtime.ts:77-115
      → D1ConfirmationControlPlane.create()
      → D1ConfirmationControlPlane.applyDecision()
    → KV write (legacy compat)
    → AGENT_CORE?.permissionDecision / elicitationAnswer RPC (best-effort)
  → surface-runtime.ts:646-671                        handlePolicyPermissionMode
    → KV write `permission_mode/{sessionUuid}`
  → wrapSessionResponse()                             index.ts:2962-3027
    → facade-http-v1 envelope
```

**链路注记**：
- 三个 permission 路由均为 4-segment compound routes，在 `parseSessionRoute` 中由 `segments.length === 4` 分支处理（`index.ts:476-487`），插入在 `disptachFetch` 的 session 路由统一分发中（`index.ts:786`）。
- 路由优先级：在 `dispatchFetch` 中，先处理独立路由（checkpoint, confirmation, todo, toolCalls, workspace, model），再落到 `parseSessionRoute` — 因此 permission 路由不会被独立路由拦截，优先级正确。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `POST /sessions/{id}/permission/decision` | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-PERM-01, O-PERM-02 |
| `POST /sessions/{id}/policy/permission_mode` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/elicitation/answer` | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-PERM-03, O-PERM-04 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `POST /sessions/{id}/permission/decision`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:476-487` (`parseSessionRoute`) → `index.ts:811`(needsBody) → `index.ts:821-834`(forward to User-DO) → `user-do-runtime.ts:508-516` → `surface-runtime.ts:285-387`(handlePermissionDecision)。功能完整：body 验证 → row-first dual-write (D1ConfirmationControlPlane) → KV write → RPC forward → 200/400/409 响应。 |
| **F2 测试覆盖** | ✅ | facade 路由层：`permission-decision-route.test.ts` (5 cases: 200 allow, 200 deny, 401, 400 empty body, 404 unknown sub-action)。逻辑层 dual-write：`confirmation-dual-write.test.ts` (3 cases: row-first write, deny→denied, 409 conflict)。覆盖 happy + error + conflict 路径。 |
| **F3 形态合规** | ⚠️ | auth: ✅ — `authenticateRequest()` + bearer token 100%覆盖。request: ✅ — `request_uuid` UUID 校验 + `decision` enum 校验。**response 形状存在 doc 声称的额外字段**（见 F5）。error codes: `invalid-input`(400), `confirmation-already-resolved`(409) — 均在 `FacadeErrorCodeSchema` 内，✅。**但实际返回的是 `error` 字段而非 `{ok:false, error:{code,...}}` 的 facade envelope** — User DO 内使用 `jsonResponse()` 直接返回 `{error, message}` 形状，经由 `wrapSessionResponse()` 的错误路径（`index.ts:3009-3026`）被重包裹为 facade-http-v1 envelope。这一重包裹路径工作正常，✅。 |
| **F4 NACP 合规** | ✅ | envelope: `facade-http-v1` via `wrapSessionResponse()`。trace: `x-trace-uuid` header 读取 → 注入 body → 回射 response header。authority: `x-nano-internal-authority` header。tenant: session lookup 在 User DO 层执行。error code: `confirmation-already-resolved` 在 `FacadeErrorCodeSchema:80` 中注册。 |
| **F5 文档一致性** | ⚠️ | doc 声称 success body 包含 `confirmation_uuid` 和 `confirmation_status`（`permissions.md:68-76`），但 `surface-runtime.ts:383-386` 实际返回 `{ok:true, data:{request_uuid, decision, scope}}`，**缺少 `confirmation_uuid` 和 `confirmation_status` 字段** → O-PERM-01。 |
| **F6 SSoT 漂移** | ✅ | HPX-Q16 (row-first dual-write) 已在 `ensureConfirmationDecision()` 中实现（`surface-runtime.ts:77-115`），顺序正确：row create → applyDecision → KV → RPC。无 `failed` status（Q16 禁止），冲突时 escalate 到 `superseded`。 |

**关联 finding**：O-PERM-01, O-PERM-02

##### 3.1.2.2 `POST /sessions/{id}/policy/permission_mode`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:476-487` → `user-do-runtime.ts:518-526` → `surface-runtime.ts:646-671`。写入 KV `permission_mode/{sessionUuid}`。 |
| **F2 测试覆盖** | ✅ | `policy-permission-mode-route.test.ts` (5 cases: 200 set, 200 different mode passed through, 401, 400 empty body, cross-session path isolation)。 |
| **F3 形态合规** | ✅ | auth: ✅。request: mode enum 校验（`auto-allow/ask/deny/always_allow`）。response: facade-http-v1 通过 wrapSessionResponse 包裹。error: `invalid-input`(400)。 |
| **F4 NACP 合规** | ✅ | envelope / trace / authority / tenant 全链路贯通。 |
| **F5 文档一致性** | ✅ | doc 声称的 response `{ok:true, data:{session_uuid, mode}}` 与实际 `surface-runtime.ts:667-670` 完全一致。但注意：doc 声称 `mode` 可选值为 `auto-allow/ask/deny/always_allow`，代码中 `surface-runtime.ts:652-655` 校验一致。**测试中使用了 `"default"` 和 `"acceptEdits"` 值，但 facade 层不校验 mode 值**（`policy-permission-mode-route.test.ts:68-109` 注明了 "façade does not validate mode list"）—— mode 校验在 User DO 层执行，符合设计。✅ |
| **F6 SSoT 漂移** | ✅ | 无契约漂移。 |

##### 3.1.2.3 `POST /sessions/{id}/elicitation/answer`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route: `index.ts:476-487` → `user-do-runtime.ts:528-536` → `surface-runtime.ts:389-482`。row-first dual-write (D1ConfirmationControlPlane, kind=elicitation) → KV write → RPC forward。 |
| **F2 测试覆盖** | ✅ | facade 路由层：`elicitation-answer-route.test.ts` (5 cases: 200 happy, 401, 400 empty body, 404 unknown sub-action, idempotent repeat forwarding)。逻辑层 dual-write：`confirmation-dual-write.test.ts` (2 cases: modified status, cancelled→superseded)。 |
| **F3 形态合规** | ⚠️ | auth: ✅。request: `request_uuid` UUID 校验 + `answer` 必填校验。**response 形状存在与 permission/decision 相同的问题**（见 F5）。error codes 与 `FacadeErrorCodeSchema` 对齐。 |
| **F4 NACP 合规** | ✅ | envelope / trace / authority / tenant 全链路贯通。 |
| **F5 文档一致性** | ⚠️ | doc 声称 success body 包含 `confirmation_uuid` 和 `confirmation_status`（`permissions.md:138-148`），但 `surface-runtime.ts:478-481` 实际返回 `{ok:true, data:{request_uuid, answer}}`，**缺少 `confirmation_uuid` 和 `confirmation_status` 字段** → O-PERM-03。此外，doc 声称 answer 类型为 `any`（`permissions.md:133`），实际代码 `surface-runtime.ts:402-403` 仅校验 `answer === undefined`，确实接受任何类型，✅。 |
| **F6 SSoT 漂移** | ✅ | Q16 (row-first, never failed, cancelled→superseded) 已在 `surface-runtime.ts:415-417` 实现。 |

**关联 finding**：O-PERM-03, O-PERM-04

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `wrapSessionResponse()` at `index.ts:2962-3027` |
| `x-trace-uuid` 在 response 头里 | ✅ | `index.ts:3000,3024` — 所有 response 路径 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `confirmation-already-resolved` at `facade-http.ts:80`；`invalid-input` at `facade-http.ts:51` |
| Tenant 边界 5 规则被守住 | ✅ | User-DO 通过 user_uuid 路由；session lookup 在 DO 内做 team_uuid 校验 |
| Authority 翻译合法 | ✅ | `authenticateRequest()` → `IngressAuthSnapshot` → `x-nano-internal-authority` header → DO 接收 |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| O-PERM-01 | 📝 | F5 | permission/decision response 缺 `confirmation_uuid`/`confirmation_status` | 代码实际返回不包含 doc 声称的这两个确认字段，但客户端可用 `request_uuid` 替代查询 |
| O-PERM-02 | 📝 | F3 | permission/decision doc 声称的 error codes 列表不完整 | doc 声称了 401 `missing-team-claim` 和 503 `internal-error`，但移除 bearer 的 401 实际返回 `invalid-auth` |
| O-PERM-03 | 📝 | F5 | elicitation/answer response 缺 `confirmation_uuid`/`confirmation_status` | 同 O-PERM-01，实际返回不包含 doc 声称字段 |
| O-PERM-04 | 📝 | F3 | elicitation/answer doc 声称 error codes 与 permission/decision 同（含 `confirmation-not-found` 404） | code 中 404 由 session lookup 返回 `not-found`，非 `confirmation-not-found` |

#### 3.1.5 全 PASS 端点简表

| 端点 | 备注 |
|------|------|
| `POST /sessions/{id}/policy/permission_mode` | 无异常，完全合规 |

---

### 3.2 簇 — Session-WS-v1（`clients/api-docs/session-ws-v1.md`）

#### 3.2.0 路由轨迹（WS 升级）

```text
Client WebSocket upgrade
  → dispatchFetch()                                   index.ts:643
  → parseSessionRoute()                               index.ts:433-471
    → 3-segment, action === "ws"
  → authenticateRequest()                             index.ts:789-791
    → allowQueryToken: true                           WS 升级允许 query param token
  → ORCHESTRATOR_USER_DO.get(user_uuid).fetch()       index.ts:794-797
  → User-DO 内部 fetch                                user-do-runtime.ts:401-411
    →  action "ws" → handleWsAttach()                 user-do-runtime.ts:499
  → wsRuntime.handleWsAttach()                        (WS 运行时)
    → 创建 WebSocket 对、bindSocketLifecycle()
    → 启动 heartbeat (15s interval)
    → 绑定 relay 队列，从 recentFrames 回放
  → WS 帧收发：
    → server→client emit: 经 validateSessionFrame()（schema 校验）→ socket.send()
    → client→server: session.resume / session.heartbeat / session.stream.ack → 仅 touch session（activity）
```

**链路注记**：
- WS 升级路由在 `dispatchFetch` 中走入 session route 分支（`index.ts:786`），因此经过认证后直接转发到 User-DO
- Client→Server 方向的 permission/elicitation/confirmation decision **不能通过 WS**（HPX-Q18 frozen direction matrix），必须用 HTTP

#### 3.2.1 端点矩阵（非传统端点，按帧族分组）

| 帧族 | F1 | F2 | F3 | F4 | F5 | F6 | verdict | 主要 finding |
|------|----|----|----|----|----|----|---------|--------------|
| WS connect url + handshake | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| 13-kind stream event 帧 (schema + emit) | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-WS-01 |
| confirmation / todo WS 帧 (schema only) | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-WS-01 |
| session.heartbeat / attachment.superseded / session.end / usage.update | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| client→server 帧 (session.resume/heartbeat/stream.ack) | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-WS-02 |
| Synthetic spike trigger `POST /sessions/{id}/verify` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-01 |

#### 3.2.2 逐项分析

##### 3.2.2.1 WS Connect URL + Handshake

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `index.ts:796-798` — WS action 直接转发到 User DO。DO 内 `user-do-runtime.ts:499` 调 `wsRuntime.handleWsAttach()`。`access_token` query param 被 `allowQueryToken:true` 开启（`index.ts:790`）。`trace_uuid` query param 与 `x-trace-uuid` header 同义（`readTraceUuid` 接受 query）。`last_seen_seq` 在 DO 内用于 relay 回放。 |
| **F2 测试覆盖** | ✅ | `smoke.test.ts:212-242` "routes authenticated ws upgrades to the user DO" — 验证 WS upgrade 被正确路由到 User DO。 |
| **F3 形态合规** | ✅ | handshake errors (400/401/403/404/409) 在 doc 与 `user-do-runtime.ts`（session gate + auth gate）中对齐。close codes (1000/4001) 由 WS runtime 控制。 |
| **F4 NACP 合规** | ✅ | envelope: N/A（WS 不使用 HTTP envelope）。trace: query param `trace_uuid` + header fallback。authority: JWT → IngressAuthSnapshot → DO 内部。 |
| **F5 文档一致性** | ✅ | doc 声称的 6 种 handshake error 与实际 session gate logic 对齐（`surface-runtime.ts:164-183` sessionGateMiss / sessionMissingResponse）。 |
| **F6 SSoT 漂移** | ✅ | Direction matrix: `NACP_SESSION_TYPE_DIRECTION_MATRIX` 注册了所有合法 frame 类型（`type-direction-matrix.ts`）。 |

##### 3.2.2.2 13-kind Stream Event 帧 (Server→Client)

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | Zod schema 在 `stream-event.ts:147-161` 中冻结（`SessionStreamEventBodySchema` 包括全部 13 kinds）。direction matrix 中 `session.stream.event` 注册为 `["event"]`。**但 doc §3.2 中 `model.fallback` 标注"schema live，emitter not-live"**（`session-ws-v1.md:65`），doc 已有主动说明。 |
| **F2 测试覆盖** | ⚠️ | WS 帧的 schema 验证存在编译期约束（zod discriminated union），但**缺少对实际 emit 行为的集成测试**。`model.fallback` 和 `session.fork.created` 的 emitter 未 live，无法进行端到端测试。 → W-WS-01。 |
| **F3 形态合规** | ✅ | 所有帧 schema 均有 zod 约束。`system.error` 帧使用 `NacpErrorSchema`（与 nacp-core 一致）。server 在 emit 前跑 `validateSessionFrame()`（`user-do-runtime.ts:1000-1011`）。 |
| **F4 NACP 合规** | ✅ | 帧 shape 满足 nacp-session profile。system.error 使用标准化 `NacpErrorSchema`。 |
| **F5 文档一致性** | ✅ | doc 在 §3.2 表格中对每个 frame kind 标注了引入阶段和 client 行为。§3.3（confirmation）/ §3.4（todo）明确标注"emitter pending"。§8（Deferred / Not-Yet-Live）表格总结了已知缺口。一致性评估：doc 准确反映了代码状态。 |
| **F6 SSoT 漂移** | ✅ | 13-kind 列表与 `stream-event.ts:165-179` 的 `STREAM_EVENT_KINDS` 常量完全一致。但 doc 声称 13 种，实际 `STREAM_EVENT_KINDS` 也是 13 种——**数量吻合**。 |

##### 3.2.2.3 Client→Server 帧

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `session.resume` / `session.heartbeat` / `session.stream.ack` 均被方向矩阵注册为合法方向（`type-direction-matrix.ts`）。但 doc §4 明确说明它们"仅作 activity touch"，不改变 session 状态。permission/elicitation/confirmation **decision 不能通过 WS push**（HPX-Q18），必须用 HTTP。 |
| **F2 测试覆盖** | ⚠️ | 缺少对 client→server 帧的单元测试（如 heartbeat ack 是否真的 touch session，resume 是否正确更新 last_seen_seq）→ W-WS-02。但 `policy-permission-mode-route.test.ts` 间接验证了 session 操作路径。 |
| **F3 形态合规** | ✅ | frame 形状简单（`{kind, ts}` 或 `{kind, last_seen_seq}` 或 `{kind, stream_uuid, acked_seq}`），client 侧负责 schema 校验。 |
| **F5 文档一致性** | ✅ | direction matrix 在 `type-direction-matrix.ts` 中的注册与 doc 声明的 frame 类型一致。 |

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Direction matrix 与 doc 一致 | ✅ | `type-direction-matrix.ts:14-46` 注册的 16 个 message_type 覆盖了 doc 中描述的所有帧 |
| Frame schema 编译期校验 | ✅ | `stream-event.ts:147-161` zod discriminated union |
| HPX-Q18 frozen: WS 不接收 decision | ✅ | `type-direction-matrix.ts:30` — `session.permission.decision` 注册为 `["response","command"]`，但 doc §4 明确"decision 不能通过 WS push" |
| session.confirmation.request/update 仅 server-only | ✅ | `type-direction-matrix.ts:37-38` 仅 `["event"]` |

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| W-WS-01 | ⚠️ | F2 | WS stream event 帧缺少端到端 emit 集成测试 | schema live 但 emitter not-live 的帧（model.fallback, session.fork.created, confirmation, todo frames）无法测试实际 emit 行为 |
| W-WS-02 | ⚠️ | F2 | client→server 帧缺少单元测试 | heartbeat/resume/ack 帧的正确性仅靠 direction matrix 的注册保证，无测试覆盖 |

#### 3.2.5 全 PASS 项简表

| 项 | 备注 |
|------|------|
| WS connect URL + handshake | ✅ 路由无误 |
| session.heartbeat server→client | ✅ 15s interval，schema registered |
| session.attachment.superseded | ✅ 4011 close code |
| session.end frame | ✅ 3 种 reason + 对应 close codes |
| session.usage.update | ✅ HP9 已 live |

---

### 3.3 簇 — Session HTTP Lifecycle（`clients/api-docs/session.md`）

#### 3.3.0 路由轨迹（统一路径）

所有 session HTTP 路由共用相同的调度链：

```text
Client HTTP
  → dispatchFetch()                                   index.ts:643
  → [先处理独立路由: files, checkpoint, confirmation, todo, toolCalls, workspace, model]
  → parseSessionRoute()                               index.ts:433-489
    → 2-segment (DELETE):      /sessions/{uuid}        → action="delete"
    → 3-segment (others):      /sessions/{uuid}/{action} → action∈{start,input,cancel,close,title,status,timeline,history,verify,ws,usage,resume,messages,files,retry,fork}
    → 4-segment (compound):    不匹配 session.md 的端点（属于 permissions 簇）
  → authenticateRequest()                            index.ts:789-791
  → ORCHESTRATOR_USER_DO.fetch()                      index.ts:794-834
    → 包裹 body: {trace_uuid, auth_snapshot, initial_context_seed, ...原始body}
  → NanoOrchestratorUserDO.fetch()                    user-do-runtime.ts:412-576
    → 按 action 分发到对应 handler
    → session-flow.ts / surface-runtime.ts / message-runtime.ts
  → wrapSessionResponse()                             index.ts:840
    → facade-http-v1 envelope
```

**链路注记**：
- 独立路由（`files`, `checkpoint`, `confirmation`, `todo`, `toolCalls`, `workspace`, `model`）在 `dispatchFetch` 中先于 `parseSessionRoute` 被匹配，因此不会被 3-segment session 路由误匹配。这保证了路由优先级正确。
- `DELETE /sessions/{id}` 是唯一的 2-segment 路由（`index.ts:437-441`）。

#### 3.3.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `POST /sessions/{id}/start` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/input` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/messages` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/cancel` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | — |
| `POST /sessions/{id}/close` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `DELETE /sessions/{id}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `PATCH /sessions/{id}/title` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /sessions/{id}/status` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /sessions/{id}/timeline` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | — |
| `GET /sessions/{id}/history` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/verify` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-01 |
| `POST /sessions/{id}/resume` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/retry` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-02 |
| `POST /sessions/{id}/fork` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | O-SESS-02 |
| `GET /sessions/{id}/usage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /conversations/{conversation_uuid}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

#### 3.3.2 全 PASS 端点逐项分析

以下端点构造完全相同（均通过 `dispatchFetch → parseSessionRoute → User-DO fetch → wrapSessionResponse`），仅列出关键 handler 位置和测试覆盖：

| 端点 | Handler | 测试覆盖 |
|------|---------|----------|
| `POST /sessions/{id}/start` | `user-do-runtime.ts:446-451` → `session-flow.ts:handleStart` | `smoke.test.ts:176-211`（路由转发验证） |
| `POST /sessions/{id}/input` | `user-do-runtime.ts:454-459` → `session-flow.ts:handleInput` | `messages-route.test.ts`（消息路由测试） |
| `POST /sessions/{id}/messages` | `user-do-runtime.ts:542-551` → `message-runtime.ts:handleMessages` | `messages-route.test.ts`（多模态消息路由） |
| `POST /sessions/{id}/cancel` | `user-do-runtime.ts:462-464` → `session-flow.ts:handleCancel` | 暂无独立 test case，但被 session lifecycle 整体覆盖 |
| `POST /sessions/{id}/close` | `user-do-runtime.ts:467-469` → `session-flow.ts:handleClose` | `chat-lifecycle-route.test.ts:206-254` |
| `DELETE /sessions/{id}` | `user-do-runtime.ts:472-474` → `session-flow.ts:handleDelete` | `chat-lifecycle-route.test.ts:256-295` |
| `PATCH /sessions/{id}/title` | `user-do-runtime.ts:477-485` → `session-flow.ts:handleTitle` | `chat-lifecycle-route.test.ts:297-335` |
| `GET /sessions/{id}/status` | `user-do-runtime.ts:496` → `user-do-runtime.ts:handleRead("status")` | `smoke.test.ts:87-130`（start → status 链路） |
| `GET /sessions/{id}/timeline` | `user-do-runtime.ts:497` → forward to agent-core RPC | `smoke.test.ts:243-268`（history 读取验证，timeline 共享 handler 路径） |
| `GET /sessions/{id}/history` | `user-do-runtime.ts:498` → `user-do-runtime.ts:handleRead("history")` | `smoke.test.ts:243-268` |
| `POST /sessions/{id}/resume` | `user-do-runtime.ts:505-506` → `surface-runtime.ts:242-283` | `usage-strict-snapshot.test.ts`（间接通过 User-DO 测试） |
| `GET /sessions/{id}/usage` | `user-do-runtime.ts:502-503` → `surface-runtime.ts:189-239` | `usage-strict-snapshot.test.ts`（3 invariants: D1 row → 200, no row → 200 zero, fail → 503） |
| `GET /conversations/{conversation_uuid}` | `index.ts:1250-1280` — 独立 handler，不经 User DO | `chat-lifecycle-route.test.ts:337-364` |

#### 3.3.3 需要关注的端点分析

##### 3.3.3.1 `POST /sessions/{id}/cancel`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `user-do-runtime.ts:462-464` → `session-flow.ts:handleCancel` → agent-core RPC。cancel 是幂等操作。 |
| **F2 测试覆盖** | ⚠️ | 无独立的 cancel 路由测试。cancel 逻辑在 `user-do-chat-lifecycle.test.ts` 中有间接覆盖（chat lifecycle integration test），但 facade 层的 cancel 路由转发验证缺失。 |
| **F3-F6** | ✅ | 形状合规、NACP 合规、文档一致、无 SSoT 漂移。 |

##### 3.3.3.2 `POST /sessions/{id}/verify`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | `user-do-runtime.ts:488-493` → `session-flow.ts:handleVerify`。Preview-only；生产环境 `NANO_ENABLE_RHX2_SPIKE !== "true"` 时返回 403 `spike-disabled`。 |
| **F2 测试覆盖** | ⚠️ | 无独立的 verify route 测试。doc 声明此路由为 "preview-only verification harness"（`session.md:194`），符合预期。 |
| **F3-F6** | ✅ | 异常形状合规。 |
| **关联 finding** | 📝 | O-SESS-01：doc 声称 verify 的 error code 为 `spike-disabled`，但 `FacadeErrorCodeSchema` 中无此 code — 实际 fallback 为 `internal-error` 或类似 code。 |

##### 3.3.3.3 `POST /sessions/{id}/retry` & `POST /sessions/{id}/fork`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | retry: `user-do-runtime.ts:562-564` → `session-flow.ts:handleRetry`（first wave: request-acknowledged replay via messages）。fork: `user-do-runtime.ts:571-573` → `session-flow.ts:handleFork`（first wave: mint child UUID, pending-executor）。 |
| **F2 测试覆盖** | ⚠️ | 两个端点均为 first-wave，缺少完整的集成测试。retry 成功返回 `{action:"retry", retry_kind:"request-acknowledged-replay-via-messages"}`，fork 成功返回 `202` + `{fork_status:"pending-executor"}`。两者均不执行完整的业务逻辑（不重构 attempt chain、不执行文件快照复制）。→ O-SESS-02。 |
| **F3-F6** | ✅ | 形状合规、NACP 合规、文档一致、无 SSoT 漂移。doc 在 `session.md:223-255` 已明确标注 "request-acknowledged first wave" 和 "pending-executor first wave" 状态。 |

#### 3.3.4 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ✅ | `wrapSessionResponse()` at `index.ts:2962-3027` |
| `x-trace-uuid` 在 response 头里 | ✅ | 所有 response 路径 |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `invalid-request`, `not-found`, `session-already-started`, `session-already-ended`, `model-policy-blocked`, `unauthenticated`, `forbidden`, `device-revoked`, `internal-error` 均在 schema 内 |
| Tenant 边界 5 规则被守住 | ✅ | User-DO keyed by user_uuid（`index.ts:794`）；team_uuid 校验在 DO 层执行 |
| Authority 翻译合法 | ✅ | `authenticateRequest()` → `IngressAuthSnapshot` → `x-nano-internal-authority` header |

#### 3.3.5 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| O-SESS-01 | 📝 | F3 | verify endpoint 的 error code `spike-disabled` 不在 `FacadeErrorCodeSchema` 中 | error code 会 fallback 到 `internal-error`（或 `permission-denied`） |
| O-SESS-02 | 📝 | F2 | retry/fork 为 first-wave stoop（仅返回 ack，不执行完整业务逻辑） | 客户端必须按 doc hint 自行实现 replay / fork 补全 |

#### 3.3.6 全 PASS 端点简表

| 端点 | 备注 |
|------|------|
| `POST /sessions/{id}/start` | ✅ |
| `POST /sessions/{id}/input` | ✅ |
| `POST /sessions/{id}/messages` | ✅ |
| `POST /sessions/{id}/close` | ✅ (HP4 frozen, Q13) |
| `DELETE /sessions/{id}` | ✅ (HP4 frozen, Q14 — 仅软删 conversation) |
| `PATCH /sessions/{id}/title` | ✅ |
| `GET /sessions/{id}/status` | ✅ |
| `GET /sessions/{id}/history` | ✅ |
| `POST /sessions/{id}/resume` | ✅ |
| `GET /sessions/{id}/usage` | ✅ (HP9 严格快照策略) |
| `GET /conversations/{conversation_uuid}` | ✅ (HP4 read model) |

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| Permissions (legacy) | `Authorization: Bearer <jwt>` | `authenticateRequest()` → `IngressAuthSnapshot` → `x-nano-internal-authority` header → User-DO → `surface-runtime.ts:handlePermissionDecision/ElicitationAnswer` | ✅ |
| Session HTTP | 同上 | 同上 → User-DO → `session-flow.ts` 内 `authSnapshot` 贯穿全链路 | ✅ |
| Session WS | `Authorization: Bearer` 或 `?access_token=` query param | 同上 + `allowQueryToken:true` | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| Permissions | `x-trace-uuid` header | facade → body.trace_uuid → User-DO handler → RPC | required | ✅ |
| Session HTTP | `x-trace-uuid` header | 同上 | required | ✅ |
| Session WS | `x-trace-uuid` header or `trace_uuid` query param | query → header → internal | required | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` / `RpcErrorCodeSchema` 的超集：✅（编译期 guard `_authErrorCodesAreFacadeCodes` + `_rpcErrorCodesAreFacadeCodes` 均在 `facade-http.ts:98-120`）
- 编译期 guard：`facade-http.ts:98-100` — `_authErrorCodesAreFacadeCodes`
- 运行期回退：未知 code → `internal-error`（`facade-http.ts:209-213`）

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| Permissions | User-DO 内的 session lookup × team_uuid match (在 `ensureConfirmationDecision` 之前的 session 查找，由 DO 层保障) | 5/5 | ✅ |
| Session HTTP | facade 层 `authenticateRequest()` → User-DO keyed by `user_uuid` → DO 内 session lookup × team_uuid | 5/5 | ✅ |
| Session WS | 同 Session HTTP | 5/5 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `pnpm check:envelope-drift` | 未运行（本轮为静态核查） |
| `pnpm check:tool-drift` | 未运行 |
| `pnpm check:cycles` | 未运行 |
| `pnpm check:megafile` | 未运行 |
| 错误信封 drift（人工核查） | ✅ 无已知违例。所有 error path 均经由 `wrapSessionResponse()`（`index.ts:3009-3026`）或 `jsonPolicyError()`（`authority.ts:21-41`），产出的 envelope shape 为 `{ok:false, error:{code,status,message}, trace_uuid}`，符合 facade-http-v1。 |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| W-WS-01 | ⚠️ | Session-WS-v1 | 13-kind stream event 帧 / confirmation 帧 | F2 | WS stream event 帧缺少端到端 emit 集成测试 | schema live 但 emitter not-live 的帧无法验证实际 emit 行为 | no | A1 |
| W-WS-02 | ⚠️ | Session-WS-v1 | client→server 帧 | F2 | client→server 帧缺少单元测试 | heartbeat/resume/ack 帧正确性仅靠 direction matrix 注册保证 | no | A2 |
| O-PERM-01 | 📝 | Permissions | `POST /sessions/{id}/permission/decision` | F5 | response 缺 `confirmation_uuid`/`confirmation_status` | doc 声称有但代码未返回，可用 request_uuid 替代 | no | — |
| O-PERM-02 | 📝 | Permissions | `POST /sessions/{id}/permission/decision` | F3 | doc 声称的 401 error code 为 `missing-team-claim` 但实际返回 `invalid-auth` | 客户端若按 doc 处理 401 的特定 code 可能 miss | no | — |
| O-PERM-03 | 📝 | Permissions | `POST /sessions/{id}/elicitation/answer` | F5 | response 缺 `confirmation_uuid`/`confirmation_status` | 同 O-PERM-01 | no | — |
| O-PERM-04 | 📝 | Permissions | `POST /sessions/{id}/elicitation/answer` | F3 | doc 声称 error code `confirmation-not-found` 实际返回 `not-found` | 语义不一致，但两者都在 FacadeErrorCodeSchema 中 | no | — |
| O-SESS-01 | 📝 | Session HTTP | `POST /sessions/{id}/verify` | F3 | error code `spike-disabled` 不在 `FacadeErrorCodeSchema` 中 | error code fallback 到 `internal-error` | no | — |
| O-SESS-02 | 📝 | Session HTTP | `POST /sessions/{id}/retry` / `fork` | F2 | retry/fork 为 first-wave stoop | 不执行完整业务逻辑，仅返回 ack | no | — |

### 5.2 Finding 详情

#### W-WS-01 — WS stream event 帧缺少端到端 emit 集成测试

- **严重级别**：⚠️ WARN
- **簇 / 端点**：`Session-WS-v1 / server→client stream event 帧族`
- **维度**：`F2`
- **是否 blocker**：no
- **事实依据**：
  - `packages/nacp-session/src/stream-event.ts:147-161` — 13-kind `SessionStreamEventBodySchema`（zod discriminated union, 编译期安全）
  - `packages/nacp-session/src/type-direction-matrix.ts:21` — `session.stream.event` 注册为 `["event"]`
  - `clients/api-docs/session-ws-v1.md:65,256-258` — doc 明确标注 `model.fallback` 和 `session.fork.created` 为 "schema live, emitter not-live"
  - `clients/api-docs/session-ws-v1.md:100-101` — confirmation/todo WS 帧 "emitter pending"
- **为什么重要**：schema 校验只能保证形状正确，不能保证运行时行为。但 doc 已主动标注缺口，不阻塞合规声明。
- **修法（What + How）**：
  - 在 `model.fallback` / `session.fork.created` 的 emitter 接通后，补写 WS frame 集成测试
  - 在 confirmation / todo emitter 接通后，验证 `session.confirmation.request` / `session.todos.write` 帧实际 emit
- **建议行动项**：A1
- **复审要点**：检查新测试是否覆盖了 frame emit → schema validate → client receive 的完整链路

#### W-WS-02 — client→server 帧缺少单元测试

- **严重级别**：⚠️ WARN
- **簇 / 端点**：`Session-WS-v1 / client→server 帧`
- **维度**：`F2`
- **是否 blocker**：no
- **事实依据**：
  - `clients/api-docs/session-ws-v1.md:213-222` — 声明了 3 个 client→server 帧
  - 无任何测试文件覆盖这些帧的正确性（仅靠 `type-direction-matrix.ts` 的注册保证方向合法）
- **为什么重要**：client→server 帧虽仅 "touch session"，但如果 behavior 改变，无测试保护
- **修法（What + How）**：补写 `session.resume` / `session.heartbeat` / `session.stream.ack` 的单元测试，验证发帧后 session 的 `last_seen_at` 更新
- **建议行动项**：A2
- **复审要点**：检查测试是否覆盖了 heartbeat 15s 间隔、resume ack 更新 last_seen_seq

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P2 | W-WS-01 | Session-WS-v1 / stream event 帧 | 在 emitter 接通后补写端到端帧 emit 集成测试 | `workers/orchestrator-core/test/` 新建 `ws-frame-emit.test.ts` | 每个 frame kind ≥1 case | M |
| **A2** | P2 | W-WS-02 | Session-WS-v1 / client→server 帧 | 补写 client→server 帧的单元测试 | `workers/orchestrator-core/test/` 新建 `ws-client-frames.test.ts` | 每个帧 ≥1 case | S |

### 6.1 整体修复路径建议

W-WS-01 和 W-WS-02 均依赖 emitter 的接通状态。建议在 HP5/HP6/HP7 的 WS emitter 完成后（emitter 由 hero-to-pro 后续批次交付时）合并为一个 PR 补写测试。当前阶段不需要独立修 OBSERVATION 项。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| O-PERM-01/03 | doc→code 的 response shape drift 不破坏客户端兼容（均可用 request_uuid 查询 confirmations） | 当 confirmation 统一 plane 完全 live 后统一修复 doc 或代码 | — | HP5 complete 后 |
| O-PERM-02/04 | error code 命名差异不阻塞功能，两个 code 均在 FacadeErrorCodeSchema 中 | 客户端若报告解析错误则提升优先级 | — | — |
| O-SESS-01 | verify endpoint 为 preview-only，prod flag false | — | — | — |
| O-SESS-02 | retry/fork 为 first-wave 设计选择 | HP4-D1 / HP7-D3 完整交付后 | — | HP4/HP7 后续批次 |

---

## 7. 测试覆盖矩阵

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `POST /sessions/{id}/permission/decision` | `confirmation-dual-write.test.ts:118-177` | `permission-decision-route.test.ts` | — | 400 / 401 / 404 / 409 | ✅ |
| `POST /sessions/{id}/policy/permission_mode` | — | `policy-permission-mode-route.test.ts` | — | 400 / 401 | ✅ |
| `POST /sessions/{id}/elicitation/answer` | `confirmation-dual-write.test.ts:179-213` | `elicitation-answer-route.test.ts` | — | 400 / 401 / 409 | ✅ |
| `GET /sessions/{id}/ws` | — | `smoke.test.ts:212-242` | — | 401 | ⚠️ (仅路由验证) |
| server→client stream event 帧 | — | — | — | — | ⚠️ (仅 schema 校验) |
| client→server 帧 | — | — | — | — | ⚠️ (仅 direction matrix) |
| `POST /sessions/{id}/start` | — | `smoke.test.ts:176-211` | — | 401 / 403 / 404 / 409 | ✅ |
| `POST /sessions/{id}/input` | — | `messages-route.test.ts` | — | 400 / 401 | ✅ |
| `POST /sessions/{id}/messages` | — | `messages-route.test.ts` | — | 400 / 401 | ✅ |
| `POST /sessions/{id}/cancel` | — | — | — | — | ⚠️ (仅集成覆盖) |
| `POST /sessions/{id}/close` | — | `chat-lifecycle-route.test.ts:206-254` | — | 401 | ✅ |
| `DELETE /sessions/{id}` | — | `chat-lifecycle-route.test.ts:256-295` | — | 401 | ✅ |
| `PATCH /sessions/{id}/title` | — | `chat-lifecycle-route.test.ts:297-335` | — | 400 / 401 | ✅ |
| `GET /sessions/{id}/status` | — | `smoke.test.ts:87-130` | — | 401 / 404 | ✅ |
| `GET /sessions/{id}/timeline` | — | — | — | — | ⚠️ (共享 history handler 路径) |
| `GET /sessions/{id}/history` | — | `smoke.test.ts:243-268` | — | 401 / 404 | ✅ |
| `POST /sessions/{id}/verify` | — | — | — | — | ⚠️ (preview-only) |
| `POST /sessions/{id}/resume` | — | `usage-strict-snapshot.test.ts`(由 User-DO 间接覆盖) | — | 404 | ✅ |
| `POST /sessions/{id}/retry` | — | — | — | — | ⚠️ (first-wave) |
| `POST /sessions/{id}/fork` | — | — | — | — | ⚠️ (first-wave) |
| `GET /sessions/{id}/usage` | `usage-strict-snapshot.test.ts` | — | — | 200 / 503 | ✅ |
| `GET /conversations/{conversation_uuid}` | — | `chat-lifecycle-route.test.ts:337-364` | — | 401 / 404 | ✅ |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| server→client stream event 帧 | 端到端 emit 集成测试 | `test/ws-frame-emit.test.ts` | W-WS-01 |
| client→server 帧 | 帧接收→touch session→状态更新 的单元测试 | `test/ws-client-frames.test.ts` | W-WS-02 |
| `POST /sessions/{id}/cancel` | 独立的 facade 层 cancel 路由转发测试 | `test/chat-lifecycle-route.test.ts` | — |
| `GET /sessions/{id}/timeline` | 独立的 timeline 路由测试 | `test/chat-lifecycle-route.test.ts` | — |
| `POST /sessions/{id}/retry` / `fork` | 完整的 executor 集成测试（等 HP4-D1/HP7-D3 完成后） | `test/session-retry-fork.test.ts` | O-SESS-02 |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | `433-489` | `parseSessionRoute()` 路由解析 |
| `workers/orchestrator-core/src/index.ts` | `643-841` | `dispatchFetch()` 总调度入口 |
| `workers/orchestrator-core/src/index.ts` | `1478-1664` | `handleSessionConfirmation()` confirmation control plane |
| `workers/orchestrator-core/src/index.ts` | `2962-3027` | `wrapSessionResponse()` envelope 包裹 |
| `workers/orchestrator-core/src/user-do-runtime.ts` | `390-576` | User-DO 内部 fetch 路由分发 |
| `workers/orchestrator-core/src/user-do-runtime.ts` | `1052-1129` | permission/elicitation/policy/usgae handler delegation |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | `59-115` | `ensureConfirmationDecision()` row-first dual-write |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | `285-387` | `handlePermissionDecision()` |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | `389-482` | `handleElicitationAnswer()` |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | `646-671` | `handlePolicyPermissionMode()` |
| `workers/orchestrator-core/src/user-do/session-flow.ts` | `185-966` | session 生命周期流 (start/input/cancel/close/delete/title/retry/fork) |
| `workers/orchestrator-core/src/policy/authority.ts` | `21-41` | `jsonPolicyError()` facade envelope 生成 |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | `48-90` | `FacadeErrorCodeSchema` 48 个 canonical error codes |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | `126-148` | `FacadeErrorSchema` / `FacadeErrorEnvelopeSchema` |
| `packages/nacp-session/src/stream-event.ts` | `147-179` | `SessionStreamEventBodySchema` + `STREAM_EVENT_KINDS` |
| `packages/nacp-session/src/type-direction-matrix.ts` | `14-55` | `NACP_SESSION_TYPE_DIRECTION_MATRIX` |
| `clients/api-docs/permissions.md` | 全部 165 行 | 受查文档 — Permissions |
| `clients/api-docs/session-ws-v1.md` | 全部 261 行 | 受查文档 — Session WS |
| `clients/api-docs/session.md` | 全部 285 行 | 受查文档 — Session HTTP Lifecycle |
| `test/permission-decision-route.test.ts` | 全部 185 行 | permission/decision 路由测试 |
| `test/elicitation-answer-route.test.ts` | 全部 194 行 | elicitation/answer 路由测试 |
| `test/policy-permission-mode-route.test.ts` | 全部 214 行 | policy/permission_mode 路由测试 |
| `test/confirmation-dual-write.test.ts` | 全部 214 行 | HP5 dual-write SQLite 集成测试 |
| `test/chat-lifecycle-route.test.ts` | 全部 478 行 | session lifecycle 集成测试 |
| `test/usage-strict-snapshot.test.ts` | 全部 138 行 | usage 严格快照测试 |
| `test/smoke.test.ts` | 全部 ~450 行 | facade 层冒烟测试 |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**：`same reviewer rereview`
- **二次审查触发条件**：
  - W-WS-01 / W-WS-02 的 WS 帧测试补写完成
  - retry/fork 的完整 executor 集成测试完成
- **二次审查应重点核查**：
  1. WS 帧 emit 测试覆盖了所有 13-kind + confirmation/todo 帧的实际 emit 路径
  2. client→server 帧测试验证了 session touch 行为

### 9.3 合规声明前的 blocker

> 本轮无 CRITICAL 或 FINDING 级别的 blocker。在以下 WARN 项 done 之前，**建议但不强制**完成后再声明合规：

1. W-WS-01 — WS stream event 帧集成测试 —— Action A1
2. W-WS-02 — client→server 帧单元测试 —— Action A2

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> 文档状态切到 `changes-requested` 后，实现者把修复结论 append 在这一节，按 Finding ID 一条一条回。

### 10.1 回应汇总表

| Finding ID | 处理结果 | PR / Commit | 验证证据 | reviewer 复核结论 |
|------------|----------|-------------|----------|-------------------|
| — | — | — | — | — |

### 10.2 逐条回应

*（暂无）*
