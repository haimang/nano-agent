# API Compliance Audit — Part 3: Permissions / Session-WS-V1 / Session-HTTP

> 调查对象: `Permissions + Session-WS-V1 + Session-HTTP`
> 调查类型: `initial`
> 调查者: GLM
> 调查时间: 2026-05-01
> 调查范围:
> - `clients/api-docs/permissions.md`
> - `clients/api-docs/session-ws-v1.md`
> - `clients/api-docs/session.md`
> Profile / 协议族: `facade-http-v1`（HTTP 路由） + `session-ws-v1`（WebSocket 帧）
> 真相对照（SSoT，只读引用）:
> - `packages/orchestrator-auth-contract/src/facade-http.ts`（facade-http-v1 envelope + FacadeErrorCodeSchema）
> - `packages/orchestrator-auth-contract/src/auth-error-codes.ts`（auth error code taxonomy）
> - `packages/nacp-session/src/messages.ts`（NACP session 消息 Zod schema）
> - `packages/nacp-session/src/stream-event.ts`（13-kind stream event catalog）
> - `packages/nacp-session/src/type-direction-matrix.ts`（direction matrix）
> - `packages/nacp-session/src/session-registry.ts`（phase + role gating）
> - `workers/orchestrator-core/src/confirmation-control-plane.ts`（confirmation 7-kind/6-status enums）
> - `workers/orchestrator-core/src/session-lifecycle.ts`（session body type definitions）
> - `scripts/check-envelope-drift.mjs`（envelope drift gate）
> - `scripts/check-tool-drift.mjs`（tool drift gate）
> 复用 / 对照的既有审查:
> - `docs/eval/hero-to-pro/api-compliance/part2-by-GLM.md` — 独立复核（采纳 F-CFM-01 关于 `confirmation-already-resolved` 409 响应形状的发现，本报告发现同一模式在 permissions 簇仍存在）
> - `docs/eval/hero-to-pro/api-compliance/part1-by-GLM.md` — 仅作线索（采纳 F-AUTH-01 关于 device gate bypass 的发现）
> 文档状态: `draft`

---

## 0. 总判定 / Executive Summary

- **整体 verdict**：`本轮 Permissions + Session-WS-V1 + Session-HTTP 调查整体功能真实成链，但发现 3 项 FINDING（permissions 簇 2 端点成功响应缺字段 + 文档声明了不可达的错误码）和 4 项 WARN（400 扁平错误形状依赖 facade 补偿、若干 session 端点缺专项测试、legacy-do-action 与 facade-http-v1 双形状共存、WS emitter 多项未 live），不允许声明 fully-compliant，需先修 FINDING。`
- **结论等级**：`compliant-with-followups`
- **是否允许声明合规**：`no`
- **本轮最关键的 3 个判断**：
  1. `POST /sessions/{id}/permission/decision` 和 `POST /sessions/{id}/elicitation/answer` 成功响应缺少文档承诺的 `confirmation_uuid` 和 `confirmation_status` 字段 —— doc-reality 差异，客户端依赖此字段判读 confirmation 状态将失败。
  2. `permissions.md` 文档声明了 404 `confirmation-not-found` 和 503 `internal-error` 错误码，但实现中 `ensureConfirmationDecision()` 在 row 不存在时 auto-create 而非返回 404，RPC 失败时静默 catch 而非返回 503 —— 这些错误码不可达。
  3. Session-WS-V1 的 confirmation 和 todo emitter 尚未 live，`model.fallback` 和 `session.fork.created` 仅有 schema 无 emitter —— 均已在文档中标为 deferred/not-yet-live，暂不影响协议合规，但需跟进。

### 0.1 簇级总览矩阵

| 簇 | 端点数 | F1 功能性 | F2 测试覆盖 | F3 形态合规 | F4 NACP 合规 | F5 文档一致性 | F6 SSoT 漂移 | 簇 verdict |
|----|--------|-----------|-------------|-------------|--------------|---------------|--------------|------------|
| Permissions | 3 | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | PARTIAL |
| Session-WS-V1 | 1 (WS 协议) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN |
| Session-HTTP | 16 | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN |

### 0.2 Finding 数量汇总

| 严重级别 | 数量 | 是否 blocker（合规声明前必须修） |
|----------|------|----------------------------------|
| 🔴 CRITICAL | 0 | — |
| ❌ FINDING  | 3 | yes |
| ⚠️ WARN     | 4 | no（建议修） |
| 📝 OBSERVATION | 5 | no（仅记录） |

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
  - `clients/api-docs/transport-profiles.md`（形状指引引用）
  - `clients/api-docs/error-index.md`（错误码指引引用）
- **核查的实现**：
  - `workers/orchestrator-core/src/index.ts`（facade 路由解析 + 认证 + `wrapSessionResponse` 信封包装）
  - `workers/orchestrator-core/src/user-do-runtime.ts`（User DO 调度中心）
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts`（permission/decision, elicitation/answer, policy/permission_mode, usage, resume handlers）
  - `workers/orchestrator-core/src/user-do/session-flow.ts`（start, input, cancel, close, delete, title, verify, read/status/timeline/history handlers）
  - `workers/orchestrator-core/src/user-do/message-runtime.ts`（messages handler）
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts`（WS attach + emit server frames）
  - `workers/orchestrator-core/src/hp-absorbed-handlers.ts`（retry, fork absorbed handlers）
  - `workers/orchestrator-core/src/confirmation-control-plane.ts`（D1ConfirmationControlPlane）
  - `workers/orchestrator-core/src/entrypoint.ts`（forwardServerFrameToClient + emitterRowCreateBestEffort）
  - `workers/orchestrator-core/src/frame-compat.ts`（validateLightweightServerFrame）
  - `packages/nacp-session/src/stream-event.ts`（13-kind 流事件 Zod schema）
  - `packages/nacp-session/src/messages.ts`（20 种消息体 Zod schema）
  - `packages/nacp-session/src/type-direction-matrix.ts`（方向矩阵）
  - `packages/nacp-session/src/session-registry.ts`（phase + role gating）
  - `packages/nacp-session/src/websocket.ts`（WS helper + replay buffer）
  - `packages/orchestrator-auth-contract/src/facade-http.ts`（FacadeErrorCodeSchema + envelope schemas）
- **核查的契约 / SSoT**：
  - `packages/orchestrator-auth-contract/src/facade-http.ts:48-90`（FacadeErrorCodeSchema 33 种 code）
  - `packages/orchestrator-auth-contract/src/facade-http.ts:134-151`（FacadeSuccessEnvelopeSchema + FacadeErrorEnvelopeSchema）
  - `packages/nacp-session/src/type-direction-matrix.ts`（方向矩阵冻结）
  - `packages/nacp-session/src/stream-event.ts:139-145`（model.fallback schema）
  - `workers/orchestrator-core/src/confirmation-control-plane.ts:21-49`（7-kind / 6-status enums）
- **执行过的验证**：
  - `pnpm --filter nacp-session test` — 19 files, 196 tests, all pass
  - `pnpm --filter @haimang/orchestrator-core-worker test` — 33 files, 308 tests, all pass
  - `node scripts/check-envelope-drift.mjs` — ✅ green (1 public file clean)
  - `node scripts/check-tool-drift.mjs` — ✅ green (1 tool id registered)

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全链路代码逐行核实 |
| 单元 / 集成测试运行 | yes | orchestrator-core 308 tests pass; nacp-session 196 tests pass |
| Drift gate 脚本运行 | yes | envelope-drift ✅ green; tool-drift ✅ green |
| schema / contract 反向校验 | yes | FacadeErrorCodeSchema 含 `confirmation-already-resolved`; 7-kind/6-status freeze test pass |
| live / preview / deploy 证据 | no | 无 preview/deploy 环境 |
| 与上游 design / Q-law 对账 | yes | HP5 Q16/Q17 dual-write law 对照 confirmation-control-plane.ts; Q18 direction matrix 对照 type-direction-matrix.ts |

### 1.5 跨簇横切观察

- **架构与路由层**：所有 HTTP 路由经 `orchestrator-core/src/index.ts:dispatchFetch()` → `requireBearerAuth()` / `authenticateRequest()` → `parseSessionRoute()` → `stub.fetch()` 转发 User DO → `user-do-runtime.ts:fetch()` 调度具体 handler。
- **Envelope 契约**：User DO handler 内部使用 `jsonResponse()` 返回裸 JSON；facade 层 `wrapSessionResponse()`（index.ts:2962-3027）检测信封形状并注入 `trace_uuid`。双路径：(a) `ok:true + data` → facade success；(b) `ok:true + action:string` → legacy DO ack；(c) `ok:false + error:object` → facade error；(d) 其它裸 errors → error-lifting 重组为 facade error envelope。
- **Auth 模式**：所有 session 路由通过 `authenticateRequest()` 鉴权；WS 允许 `access_token` query param（`allowQueryToken: true`）。User DO 内部通过 `x-nano-internal-authority` header 接收 `IngressAuthSnapshot`。
- **Trace 传播**：facade 入口生成 `trace_uuid`，通过 `x-trace-uuid` header 传给 User DO，`wrapSessionResponse()` 保证响应体和 HTTP header 均含 `trace_uuid`。
- **NACP authority 翻译**：JWT claims → `IngressAuthSnapshot`（`users/orchestrator-core/src/auth.ts:298-309`），通过 `x-nano-internal-authority` 传给内部 handler。Cluster 内部调用不重签 JWT，使用 snapshot 直接传递。
- **错误代码治理**：`FacadeErrorCodeSchema`（33 种）为枚举超集；`AuthErrorCodeSchema` ⊂ `FacadeErrorCodeSchema`（编译期 guard `_authErrorCodesAreFacadeCodes`）；`RpcErrorCodeSchema` ⊂ `FacadeErrorCodeSchema`（编译期 guard `_rpcErrorCodesAreFacadeCodes`）。User DO 约 10+ 种 ad-hoc 错误字面量（如 `"session_missing"`, `"permission_mode_requires..."`) 不在 FacadeErrorCodeSchema 中，经 facade wrapper error-lifting 被 coerce 为 `internal-error` 或直接透传（如果已构成 `looksFacadeError` shape）。

---

## 2. 簇级总览矩阵（全端点）

| 簇 | 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 关键问题 |
|----|------|----|----|----|----|----|----|--------------|----------|
| Permissions | `POST /sessions/{id}/permission/decision` | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | FAIL | 成功响应缺 `confirmation_uuid` + `confirmation_status`；文档声明不可达的 404/503 |
| Permissions | `POST /sessions/{id}/policy/permission_mode` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | 400 扁平错误形状靠 facade wrapper 补偿 |
| Permissions | `POST /sessions/{id}/elicitation/answer` | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | FAIL | 同 permission/decision；成功响应缺字段 |
| Session-WS-V1 | `WS /sessions/{id}/ws` (connect) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-WS-V1 | 13-kind stream events | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | model.fallback + fork.created schema live 但 emitter not-live |
| Session-WS-V1 | confirmation frame family | ⚠️ | ✅ | ✅ | ✅ | 📝 | ✅ | PASS w/ WARN | emitter pending |
| Session-WS-V1 | todo frame family | ⚠️ | ✅ | ✅ | ✅ | 📝 | ✅ | PASS w/ WARN | emitter pending |
| Session-HTTP | `POST /sessions/{id}/start` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `POST /sessions/{id}/input` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `POST /sessions/{id}/messages` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `POST /sessions/{id}/cancel` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `POST /sessions/{id}/close` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `DELETE /sessions/{id}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无专项测试 |
| Session-HTTP | `PATCH /sessions/{id}/title` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无专项测试 |
| Session-HTTP | `GET /sessions/{id}/status` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无专项测试；proxy to agent-core |
| Session-HTTP | `GET /sessions/{id}/timeline` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | 无专项测试；proxy to agent-core |
| Session-HTTP | `GET /sessions/{id}/history` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `POST /sessions/{id}/verify` | ✅ | ⚠️ | ✅ | ✅ | 📝 | ✅ | PASS w/ WARN | preview 路由无专项测试 |
| Session-HTTP | `POST /sessions/{id}/resume` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `POST /sessions/{id}/retry` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | absorbed first-wave，legacy action ack |
| Session-HTTP | `POST /sessions/{id}/fork` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | absorbed first-wave，returns 202 |
| Session-HTTP | `GET /sessions/{id}/usage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Session-HTTP | `GET /conversations/{conversation_uuid}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

---

## 3. 簇级深度分析

### 3.1 簇 — Permissions（`clients/api-docs/permissions.md`）

#### 3.1.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()                    index.ts:521+
  → authenticateRequest(request, env)                    index.ts:789
  → parseSessionRoute(url)                               index.ts:473-487 (4-segment compound)
  → stub.fetch(POST /sessions/${uuid}/permission/decision) index.ts:821
  → NanoOrchestratorUserDO.fetch()                       user-do-runtime.ts:350+
  → user-do-runtime.ts:508-516 (dispatch)
  → surface-runtime.handlePermissionDecision()            surface-runtime.ts:285-387
      → ensureConfirmationDecision()                      surface-runtime.ts:77-115
          → D1ConfirmationControlPlane.create/applyDecision confirmation-control-plane.ts
      → ctx.put(`permission_decision/${requestUuid}`)    KV write (best-effort)
      → AGENT_CORE.permissionDecision()                   RPC (best-effort)
  → wrapSessionResponse(response, traceUuid)              index.ts:2962-3027
```

**链路注记**：`permission/decision` 和 `elicitation/answer` 共享相同的 pattern：D1 row-first dual-write → KV write → RPC forward。`policy/permission_mode` 仅写 KV，不经过 confirmation control plane。

#### 3.1.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `POST /sessions/{id}/permission/decision` | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | FAIL | F-PERM-01, F-PERM-03 |
| `POST /sessions/{id}/policy/permission_mode` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | W-PERM-01 |
| `POST /sessions/{id}/elicitation/answer` | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ | FAIL | F-PERM-02, F-PERM-03 |

#### 3.1.2 端点逐项分析

##### 3.1.2.1 `POST /sessions/{id}/permission/decision`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：index.ts:476-487 → user-do-runtime.ts:508-516 → surface-runtime.ts:285-387 → D1ConfirmationControlPlane.create + applyDecision（confirmation-control-plane.ts）→ KV write → AGENT_CORE.permissionDecision RPC；行为：HP5 Q16 row-first dual-write law 完整实现 |
| **F2 测试覆盖** | ✅ | 单测：permission-decision-route.test.ts（5 tests: auth, forwarding, 400, 404）；集成：confirmation-dual-write.test.ts（5 tests: row-first write, conflict detection）；逻辑：confirmation-control-plane.test.ts（10 tests: create, applyDecision, conflict, enum freeze） |
| **F3 形态合规** | ⚠️ | auth：bearer JWT `authenticateRequest()` ✅；request：`request_uuid` UUID ✅, `decision` ∈ {allow,deny,always_allow,always_deny} ✅, `scope` optional default `"once"` ✅；response 200：`{ ok:true, data: { request_uuid, decision, scope } }` — **缺少 `confirmation_uuid` 和 `confirmation_status`**（见 F-PERM-01）；response 400：User DO 返回扁平 `{ error:"invalid-input", message:"..." }` 格式，经 facade wrapper error-lifting 重建为 `{ ok:false, error:{code:"invalid-input",status:400,message:"..."}, trace_uuid }` — 依赖 wrapper 补偿（见 W-PERM-01）；response 409：User DO 返回 `{ ok:false, error:{code:"confirmation-already-resolved",status:409,message:"..."} }` — facade-http-v1 合规 shape |
| **F4 NACP 合规** | ✅ | envelope：facade wrapper 保证 `trace_uuid` 注入 + `x-trace-uuid` response header；authority：JWT claims → `IngressAuthSnapshot` → `x-nano-internal-authority` 内部传递；tenant：`team_uuid` required claim ✅ |
| **F5 文档一致性** | ❌ | (1) 文档承诺成功响应含 `confirmation_uuid` + `confirmation_status`，实现只返回 `{ request_uuid, decision, scope }`（F-PERM-01）；(2) 文档声明 404 `confirmation-not-found` 错误，但 `ensureConfirmationDecision()` 在 row 不存在时 auto-create 而非 404（F-PERM-03）；(3) 文档声明 503 `internal-error`（upstream RPC unreachable），但代码 catch RPC 错误后静默 log，不返回 503（F-PERM-03） |
| **F6 SSoT 漂移** | ✅ | drift gate ✅ green；`confirmation-already-resolved` 在 FacadeErrorCodeSchema 中 ✅（facade-http.ts:80）；7-kind/6-status enum freeze test pass |

**关联 finding**：F-PERM-01, F-PERM-03, W-PERM-01

##### 3.1.2.2 `POST /sessions/{id}/policy/permission_mode`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：index.ts:476-487 → user-do-runtime.ts:518-526 → surface-runtime.ts:646-671 → KV write `permission_mode/${sessionUuid}`)；行为：纯 session-scoped KV override，不写 confirmation row |
| **F2 测试覆盖** | ✅ | 单测：policy-permission-mode-route.test.ts（5 tests: forwarding, mode passthrough, 401, 400 empty body, cross-session isolation） |
| **F3 形态合规** | ⚠️ | auth：bearer JWT ✅；request：`mode` ∈ {auto-allow, ask, deny, always_allow} ✅；response 200：`{ ok:true, data: { session_uuid, mode } }` + trace_uuid by wrapper ✅；response 400：User DO 返回扁平 `{ error:"invalid-input", message:"..." }` ——经 wrapper 重建 ✅，但层级不一致（W-PERM-01） |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | ✅ | 文档声明与实现一致 |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-PERM-01

##### 3.1.2.3 `POST /sessions/{id}/elicitation/answer`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route：index.ts:476-487 → user-do-runtime.ts:528-536 → surface-runtime.ts:389-482 → D1ConfirmationControlPlane.create + applyDecision（kind="elicitation"）→ KV write → RPC AGENT_CORE.elicitationAnswer；行为：HP5 Q16 row-first dual-write，cancelled=true → status=superseded（Q16 禁止 `failed`） |
| **F2 测试覆盖** | ✅ | 单测：elicitation-answer-route.test.ts（5 tests）；集成：user-do.test.ts:1328-1381（RPC forwarding + 400 missing answer）；单元：confirmation-dual-write.test.ts |
| **F3 形态合规** | ⚠️ | auth：bearer JWT ✅；request：`request_uuid` UUID ✅, `answer` required ✅, `cancelled` optional boolean ✅；response 200：`{ ok:true, data: { request_uuid, answer } }` — **缺少 `confirmation_uuid` 和 `confirmation_status`**（F-PERM-02）；response 409：同 permission/decision 的 `{ ok:false, error:{code:"confirmation-already-resolved",...} }` ✅ |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | ❌ | (1) 成功响应缺 `confirmation_uuid` + `confirmation_status`（F-PERM-02）；(2) 404 和 503 同不可达（F-PERM-03） |
| **F6 SSoT 漂移** | ✅ | 同上 |

**关联 finding**：F-PERM-02, F-PERM-03, W-PERM-01

#### 3.1.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 `facade-http-v1` | ⚠️ | User DO 400 使用扁平错误格，靠 `wrapSessionResponse` error-lifting 重建；200/409 合规（surface-runtime.ts:334-343, 667-670, 478-480） |
| `x-trace-uuid` 在 response 头里 | ✅ | `wrapSessionResponse` 始终注入 `x-trace-uuid` header（index.ts:2998-3001） |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ✅ | `confirmation-already-resolved` 在 schema 中（facade-http.ts:80）；`invalid-input` 在 schema 中 ✅ |
| Tenant 边界 5 规则被守住 | ✅ | `authenticateRequest()` 强制 `team_uuid` claim → 403 `missing-team-claim` |
| Authority 翻译合法（HTTP claim → server-stamped） | ✅ | JWT → `IngressAuthSnapshot` → `x-nano-internal-authority` |

#### 3.1.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| F-PERM-01 | ❌ | F5 | permission/decision 成功响应缺字段 | 文档承诺 `confirmation_uuid` + `confirmation_status`，实现只返回 `{ request_uuid, decision, scope }` |
| F-PERM-02 | ❌ | F5 | elicitation/answer 成功响应缺字段 | 同 F-PERM-01 模式 |
| F-PERM-03 | ❌ | F5 | permissions 文档声明不可达的 404/503 错误码 | `ensureConfirmationDecision()` auto-create 使 404 `confirmation-not-found` 不可达；RPC catch silent 使 503 `internal-error` 不可达 |
| W-PERM-01 | ⚠️ | F3 | User DO 400 错误使用扁平形状 | `{ error:"string", message:"string" }` 而非 `{ ok:false, error:{code,...} }`，依赖 facade wrapper 补偿 |

#### 3.1.5 全 PASS 端点简表（合并展示）

无 — permissions 簇 3 端点均含 FINDING 或 WARN。

---

### 3.2 簇 — Session-WS-V1（`clients/api-docs/session-ws-v1.md`）

#### 3.2.0 路由轨迹（Route Trace）

```text
Client Browser/CLI
  → wss://<base>/sessions/{sessionUuid}/ws?access_token=<jwt>&trace_uuid=<uuid>&last_seen_seq=<integer>
  → orchestrator-core/index.ts:786-798 (authenticateRequest allowQueryToken=true + stub.fetch)
  → user-do-runtime.ts:499 (handleWsAttach)
  → ws-runtime.ts:50-151 (createWebSocketPair + attach + replay + heartbeat)

Server → Client push path:
  → agent-core → ORCHESTRATOR_CORE.forwardServerFrameToClient(sessionUuid, frame, meta)
  → entrypoint.ts:221-284 (emitterRowCreateBestEffort for HP5 dual-write)
  → user-do-runtime.ts:421-444 (__forward-frame endpoint)
  → user-do-runtime.ts:990-1031 (emitServerFrame → validateLightweightServerFrame → socket.send)
```

**链路注记**：WS upgrade 在 facade 层直接透传原始 Request 到 User DO（`stub.fetch(request)`），不做 body 包装修。Server→Client 帧走 RPC → WorkerEntrypoint → User DO → attachment.socket.send 路径。

#### 3.2.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `WS /sessions/{id}/ws` (handshake) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `event` outer frame (13 kinds) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | PASS w/ WARN | O-WS-03, O-WS-04 |
| `session.confirmation.request/update` | ⚠️ | ✅ | ✅ | ✅ | 📝 | ✅ | PASS w/ WARN | O-WS-01 |
| `session.todos.write/update` | ⚠️ | ✅ | ✅ | ✅ | 📝 | ✅ | PASS w/ WARN | O-WS-02 |
| `session.usage.update` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `session.heartbeat` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `session.attachment.superseded` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `session.end` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| Client→Server 3 frames | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

#### 3.2.2 端点逐项分析

##### 3.2.2.1 WS Handshake

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | index.ts:796-797 WS upgrade → stub.fetch(request) → user-do-runtime.ts:499 handleWsAttach → ws-runtime.ts:50-151 full lifecycle |
| **F2 测试覆盖** | ✅ | user-do.test.ts（WS attach/detach）；smoke.test.ts（WS upgrade routing 无 auth → 401） |
| **F3 形态合规** | ✅ | query params `access_token`, `trace_uuid`, `last_seen_seq` 与文档一致；handshake error codes 400/401/403/404/409 全部实现 |
| **F4 NACP 合规** | ✅ | subprotocol `nacp-session.v1`；authority 通过 JWT claim + device gate；tenant 通过 `team_uuid` claim |
| **F5 文档一致性** | ✅ | 文档描述与实现一致 |
| **F6 SSoT 漂移** | ✅ | NACP_SESSION_VERSION="1.4.0"；drift gate green |

##### 3.2.2.2 Stream Event 13-kind Catalog

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | 13 kinds 全部在 `SessionStreamEventBodySchema`（stream-event.ts:147-161）定义；11 kinds 有 active emitter；`model.fallback` 有 schema 无 emitter；`session.fork.created` 有 schema 无 executor |
| **F2 测试覆盖** | ✅ | stream-event.test.ts（9 tests）；各 adapter 详细测试 |
| **F3 形态合规** | ✅ | Zod schema 严格校验；`validateLightweightServerFrame` 在 emit 前跑 validate |
| **F4 NACP 合规** | ✅ | 方向矩阵冻结（type-direction-matrix.ts）；`session.confirmation.request/update` server→client only；`session.todos.write` client→server only / `session.todos.update` server→client only |
| **F5 文档一致性** | ⚠️ | `model.fallback` 文档标注 "schema live; 当前 emitter 仍未接通"；`session.fork.created` 文档标注 "schema live; executor 未 live" — 文档如实但功能未全 |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

##### 3.2.2.3 Confirmation Frame Family（§3.3）

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ⚠️ | Schema 定义完整（messages.ts:258-332）；D1 写入实现完整（confirmation-control-plane.ts）；但 WS emitter 尚未在 orchestrator runtime 实际 emit `session.confirmation.request` / `session.confirmation.update` 帧 |
| **F2 测试覆盖** | ✅ | hp5-confirmation-messages.test.ts（18 tests）；confirmation-control-plane.test.ts（10 tests）；confirmation-dual-write.test.ts（5 tests） |
| **F3 形态合规** | ✅ | Zod schema 严格校验 7 kind + 6 status |
| **F4 NACP 合规** | ✅ | 方向矩阵中 confirmation frames 为 `event`（server→client only） |
| **F5 文档一致性** | 📝 | 文档明确标注 "当前实现状态：confirmation 统一 HTTP plane 已 live，但这两个 WS frame 还没有在 orchestrator runtime 真实 emit" |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

##### 3.2.2.4 Todo Frame Family（§3.4）

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ⚠️ | Schema 定义完整（messages.ts:334-393）；D1 实现（todo-control-plane.ts）；但 WS emitter 未 live |
| **F2 测试覆盖** | ✅ | hp6-todo-messages.test.ts（13 tests）；todo-control-plane.test.ts（11 tests） |
| **F3 形态合规** | ✅ | Zod schema 5 status 枚举 |
| **F4 NACP 合规** | ✅ | `todos.write` = command（client→server），`todos.update` = event（server→client） |
| **F5 文档一致性** | 📝 | 文档明确标注 "todo HTTP control plane 已 live，但 WS todo 帧还没有真实 emitter" |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

#### 3.2.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| WS subprotocol 版本 | ✅ | `nacp-session.v1`（version.ts:19） |
| 方向矩阵冻结 | ✅ | type-direction-matrix.ts 20 message types + delivery kind 合法映射；HP5 confirmation + HP6 todo 已入 server-only/client-only 集合 |
| Phase + role gating | ✅ | session-registry.ts phase+role 断言（unattached/attached/turn_running/ended） |
| Frame schema 校验在 emit 前 | ✅ | frame-compat.ts:validateLightweightServerFrame 在 user-do-runtime.ts:990-1031 emit 前跑 validate |
| Client→Server decision 不能走 WS | ✅ | 文档 §4 明确禁止；代码无 WS decision handler |

#### 3.2.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| O-WS-01 | 📝 | F1 | confirmation WS emitter 未 live | HTTP plane 已 live，WS push 依赖后续实现 |
| O-WS-02 | 📝 | F1 | todo WS emitter 未 live | 同上 |
| O-WS-03 | 📝 | F1 | model.fallback stream event emitter 未接通 | schema 已冻结，runtime 发射器空 |
| O-WS-04 | 📝 | F1 | session.fork.created executor 未 live | schema 已冻结，快照复制未实现 |

#### 3.2.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `WS /sessions/{id}/ws` (handshake) | 无异常，WS lifecycle 完整 |
| `session.usage.update` | HP9 frozen 阶段已 live |
| `session.heartbeat` | 15s 默认 + 60s 超时 |
| `session.attachment.superseded` | reason ∈ {reattach, revoked}; close code 4001 |
| `session.end` | 3 个 durable terminal reason + close 1000 |
| Client→Server 3 frames | touch-only；decision 必走 HTTP |

---

### 3.3 簇 — Session-HTTP（`clients/api-docs/session.md`）

#### 3.3.0 路由轨迹（Route Trace）

```text
Client
  → orchestrator-core/dispatchFetch()                 index.ts:521+
  → authenticateRequest(request, env)                  index.ts:789
  → parseSessionRoute(url)                            index.ts:433-489
  → parseBody(request, optional)                      index.ts:816
  → stub.fetch(POST/GET/DELETE/PATCH /sessions/${uuid}/${action}) index.ts:821
  → NanoOrchestratorUserDO.fetch()                    user-do-runtime.ts:350+
  → handler dispatch                                  user-do-runtime.ts:446-574
  → handler implementation                            session-flow.ts / surface-runtime.ts / message-runtime.ts / hp-absorbed-handlers.ts
  → wrapSessionResponse(response, traceUuid)          index.ts:2962-3027
```

**链路注记**：
- `start`/`input`/`cancel`/`close`/`delete`/`title`/`verify`/`messages` → `session-flow.ts` / `message-runtime.ts`
- `status`/`timeline`/`history` → `session-flow.ts:handleRead()`（status 有 agent-core proxy 逻辑）
- `usage`/`resume` → `surface-runtime.ts`
- `permission/*`/`elicitation/*` → `surface-runtime.ts`（§3.1 已分析）
- `retry`/`fork` → `hp-absorbed-handlers.ts`（absorbed first-wave）
- `ws` → 透传原始 Request 到 User DO（§3.2 已分析）

#### 3.3.1 端点矩阵（簇内）

| 端点 | F1 | F2 | F3 | F4 | F5 | F6 | 端点 verdict | 主要 finding ID |
|------|----|----|----|----|----|----|--------------|-----------------|
| `POST /sessions/{id}/start` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/input` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/messages` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/cancel` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/close` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `DELETE /sessions/{id}` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-01 |
| `PATCH /sessions/{id}/title` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-01 |
| `GET /sessions/{id}/status` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-01 |
| `GET /sessions/{id}/timeline` | ✅ | ⚠️ | ✅ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-01 |
| `GET /sessions/{id}/history` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/verify` | ✅ | ⚠️ | ✅ | ✅ | 📝 | ✅ | PASS w/ WARN | W-SESS-01, O-SESS-01 |
| `POST /sessions/{id}/resume` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `POST /sessions/{id}/retry` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-02 |
| `POST /sessions/{id}/fork` | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | PASS w/ WARN | W-SESS-02 |
| `GET /sessions/{id}/usage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |
| `GET /conversations/{conversation_uuid}` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | PASS | — |

#### 3.3.2 端点逐项分析（仅展开有 ⚠️/❌/🔴 的端点）

##### 3.3.2.1 `DELETE /sessions/{id}`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | route → user-do-runtime.ts:472-475 → session-flow.ts:731-819 → `tombstoneConversation()` in D1 |
| **F2 测试覆盖** | ⚠️ | 仅在 chat-lifecycle-route.test.ts 中间接测试（close 后 delete），无专项 DELETE 测试 |
| **F3 形态合规** | ✅ | legacy-do-action envelope `{ ok:true, action:"delete", session_uuid, conversation_uuid, deleted_at }` + trace_uuid by wrapper |
| **F4 NACP 合规** | ✅ | bearer auth ✅；trace_uuid ✅ |
| **F5 文档一致性** | ✅ | 文档 §9 与实现一致（软删除 conversation，写 `deleted_at`） |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-SESS-01

##### 3.3.2.2 `PATCH /sessions/{id}/title`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | session-flow.ts:821-884 → `updateConversationTitle()` in D1 |
| **F2 测试覆盖** | ⚠️ | 无专项 title 修改测试 |
| **F3 形态合规** | ✅ | `{ title: string ≤ 200 chars }` validation ✅ |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | ✅ | 文档 §10 与实现一致 |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-SESS-01

##### 3.3.2.3 `GET /sessions/{id}/status`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | session-flow.ts:943-955 → proxy agent-core status + augment with `durable_truth` |
| **F2 测试覆盖** | ⚠️ | 无专项 status 测试（agent-core proxy 依赖集成测试） |
| **F3 形态合规** | ✅ | legacy-do-action shape `{ ok:true, action:"status", session_uuid, session_status, phase, ended_reason, ended_at, default_model_id, trace_uuid }` |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | ✅ | 文档 §11 与实现一致 |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-SESS-01

##### 3.3.2.4 `GET /sessions/{id}/timeline`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | session-flow.ts:931-963 → D1 timeline; if empty falls through to agent-core proxy |
| **F2 测试覆盖** | ⚠️ | 无专项 timeline 测试 |
| **F3 形态合规** | ✅ | legacy-do-action shape `{ ok:true, action:"timeline", session_uuid, events }` |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | ✅ | 文档 §12 与实现一致 |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-SESS-01

##### 3.3.2.5 `POST /sessions/{id}/verify`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | session-flow.ts:886-913 → forward to agent-core via `forwardInternalJsonShadow` |
| **F2 测试覆盖** | ⚠️ | 无专项 verify 测试 |
| **F3 形态合规** | ✅ | proxy pass-through |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | 📝 | 文档 §14 标注 "preview-only 校验路由。生产环境通常不暴露给最终用户" |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-SESS-01, O-SESS-01

##### 3.3.2.6 `POST /sessions/{id}/retry`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | hp-absorbed-handlers.ts:9-40 → 404 if missing, 409 if terminal, 200 with hint otherwise |
| **F2 测试覆盖** | ✅ | user-do.test.ts 间接覆盖率 |
| **F3 形态合规** | ⚠️ | 返回 legacy shape `{ ok:true, action:"retry", session_uuid, session_status, retry_kind, hint, requested_attempt_seed }` —— facade wrapper 注入 trace_uuid，但 `retry_kind` 和 `hint` 是 first-wave stub 字段 |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | ✅ | 文档 §17 明确标注 "request-acknowledged first wave" |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-SESS-02

##### 3.3.2.7 `POST /sessions/{id}/fork`

| 维度 | 状态 | 详细依据 |
|------|------|----------|
| **F1 功能性** | ✅ | hp-absorbed-handlers.ts:42-71 → 404 if missing, 202 with `fork_status:"pending-executor"` |
| **F2 测试覆盖** | ✅ | user-do.test.ts 间接覆盖率 |
| **F3 形态合规** | ⚠️ | 返回 202（非 200），legacy shape `{ ok:true, action:"fork", parent_session_uuid, child_session_uuid, from_checkpoint_uuid, label, fork_status }` |
| **F4 NACP 合规** | ✅ | 同上 |
| **F5 文档一致性** | ✅ | 文档 §18 明确标注 202 + "pending-executor" |
| **F6 SSoT 漂移** | ✅ | 无漂移 |

**关联 finding**：W-SESS-02

#### 3.3.3 簇级 NACP / SSoT 合规复核

| 复核项 | 结论 | 依据 |
|--------|------|------|
| Envelope 形态符合 profile | ⚠️ | session HTTP 端点混合使用 `legacy-do-action`（`{ok:true,action,...}`）和 `facade-http-v1`（`{ok:true,data:{...}}`）两种形状；文档 §3 承认此双形状 |
| `x-trace-uuid` 在 response 头里 | ✅ | `wrapSessionResponse` 始终注入（index.ts:2998-3001） |
| Error code 全部在 `FacadeErrorCodeSchema` 内 | ⚠️ | User DO 返回的约 10+ 种 ad-hoc 错误字面量（如 `"session_missing"`, `"session_terminal"`）不在 FacadeErrorCodeSchema 中，但经 facade error-lifting 大部分被 coerce 为 `not-found` 或 `internal-error`；仅有 `confirmation-already-resolved` 在 schema 中 |
| Tenant 边界 5 规则被守住 | ✅ | `authenticateRequest()` 强制检查 |
| Authority 翻译合法 | ✅ | JWT → IngressAuthSnapshot |

#### 3.3.4 簇级 finding 汇总

| Finding ID | 严重 | 维度 | 标题 | 一句话影响 |
|------------|------|------|------|------------|
| W-SESS-01 | ⚠️ | F2 | 若干 session 端点缺专项测试 | DELETE/title/status/timeline/verify 无专项路由测试 |
| W-SESS-02 | ⚠️ | F3 | retry/fork 返回 first-wave stub 形状 | 非标准 facade envelope，但文档已标注 first-wave |
| O-SESS-01 | 📝 | F5 | verify 路由 preview-only | 生产通常不暴露 |

#### 3.3.5 全 PASS 端点简表（合并展示）

| 端点 | 备注 |
|------|------|
| `POST /sessions/{id}/start` | 功能完整，测试覆盖 |
| `POST /sessions/{id}/input` | 透传到 messages，测试覆盖 |
| `POST /sessions/{id}/messages` | multipart 输入，测试覆盖 |
| `POST /sessions/{id}/cancel` | 幂等取消，测试覆盖 |
| `POST /sessions/{id}/close` | HP4 frozen，写 ended_reason=closed_by_user |
| `GET /sessions/{id}/history` | D1 cursor pagination |
| `POST /sessions/{id}/resume` | HTTP replay ack + replay_lost 检测 |
| `GET /sessions/{id}/usage` | facade-http-v1 shape，测试覆盖 |
| `GET /conversations/{conversation_uuid}` | HP4 read model，测试覆盖 |

---

## 4. 跨簇 NACP 协议合规

### 4.1 Authority 翻译（Client → Facade → Internal）

| 路由类别 | Authority 来源 | 翻译机制 | NACP 合规 |
|----------|----------------|----------|-----------|
| Session HTTP 路由 | JWT Bearer token | `authenticateRequest()` → `IngressAuthSnapshot` → `x-nano-internal-authority` header | ✅ |
| Session WS 连接 | JWT query param (`access_token`) | `authenticateRequest(allowQueryToken:true)` → same path | ✅ |
| Internal (agent-core → orchestrator) | `ORCHESTRATOR_CORE` service binding | `readInternalAuthority()` from `x-nano-internal-authority` | ✅ |

### 4.2 Trace UUID 传播

| 路由类别 | Trace 来源 | 传播路径 | 强制 vs 可选 | 状态 |
|----------|------------|----------|--------------|------|
| Session HTTP | Client `x-trace-uuid` header 或 facade fallback `crypto.randomUUID()` | `auth.value.trace_uuid` → `x-trace-uuid` header → `body.trace_uuid` → response `trace_uuid` + `x-trace-uuid` header | required (facade fallback if missing: 400) | ✅ |
| Session WS | Client `trace_uuid` query param | 同上 | required | ✅ |

### 4.3 Error Code 字典对齐

- `FacadeErrorCodeSchema` 是否为 `AuthErrorCodeSchema` / `RpcErrorCodeSchema` 的超集：✅（编译期 guard `facade-http.ts:93-101, 117-120`）
- 运行期回退：User DO ad-hoc 错误（`{ error: "string", message: "string" }`）经 `wrapSessionResponse` error-lifting 路径被 coerce：`code = errObj.code ?? errObj.error ?? "internal-error"`
- **不在 FacadeErrorCodeSchema 中的 User DO error 字面量**（约 12 种）：`session_missing`, `session_terminal`, `session_not_running`, `permission_mode_requires...`, `missing-authority`, `invalid-input-body`, `device-revoked`, `usage-d1-unavailable` 等——这些经 error-lifting 后变为 `not-found`, `conflict`, `internal-error` 等 FacadeErrorCodeSchema 成员，最终 facade envelope 合规
- **已加入 FacadeErrorCodeSchema 的 confirmation 专有 code**：`confirmation-already-resolved` ✅

### 4.4 Tenant 边界

| 路由 | tenant 检查方式 | 5 规则覆盖度 | 状态 |
|------|-----------------|--------------|------|
| 所有 session / conversation / permission 路由 | `authenticateRequest()` 强制 `team_uuid` claim → 403 `missing-team-claim` | 5/5 | ✅ |
| WS 连接 | 同上 `allowQueryToken:true` | 5/5 | ✅ |

### 4.5 Envelope 漂移与 Drift Gate

| 检查 | 结果 |
|------|------|
| `node scripts/check-envelope-drift.mjs` | ✅ green（1 public file clean） |
| `node scripts/check-tool-drift.mjs` | ✅ green（1 tool id registered） |
| 错误信封 drift（人工核查） | ⚠️ User DO 400 使用扁平 `{ error, message }` 格式，依赖 facade wrapper 补偿——非 envelope drift 但为架构 debt |

---

## 5. Findings 总账

### 5.1 Finding 汇总表

| ID | 严重 | 簇 | 端点 | 维度 | 标题 | 影响 | 是否 blocker | 行动项编号 |
|----|------|----|------|------|------|------|--------------|------------|
| F-PERM-01 | ❌ | Permissions | `POST /sessions/{id}/permission/decision` | F5 | permission/decision 成功响应缺 confirmation 字段 | 客户端无法从响应中读取 confirmation 状态，须额外 GET confirmation | yes | A1 |
| F-PERM-02 | ❌ | Permissions | `POST /sessions/{id}/elicitation/answer` | F5 | elicitation/answer 成功响应缺 confirmation 字段 | 同 F-PERM-01 | yes | A1 |
| F-PERM-03 | ❌ | Permissions | permission/decision + elicitation/answer | F5 | 文档声明不可达的 404/503 错误码 | 客户端按文档处理 404/503 将永不触发此逻辑分支 | yes | A2 |
| W-PERM-01 | ⚠️ | Permissions | 全部 3 端点 | F3 | User DO 400 扁平错误形状 | 依赖 facade wrapper 补偿；若 wrapper 被绕过则信封违约 | no | A3 |
| W-SESS-01 | ⚠️ | Session-HTTP | DELETE/title/status/timeline/verify | F2 | 若干 session 端点缺专项测试 | 测试缺口可能掩盖未来回归 | no | A4 |
| W-SESS-02 | ⚠️ | Session-HTTP | retry + fork | F3 | first-wave stub 形状 | 非标准 envelope，客户端需知道 retry_kind 等字段是暂定 | no | — |
| O-WS-01 | 📝 | Session-WS-V1 | confirmation frame family | F1 | WS emitter 未 live | HTTP plane 已 live | — | — |
| O-WS-02 | 📝 | Session-WS-V1 | todo frame family | F1 | WS emitter 未 live | HTTP plane 已 live | — | — |
| O-WS-03 | 📝 | Session-WS-V1 | model.fallback event | F1 | schema live, emitter not-live | 文档已标注 | — | — |
| O-WS-04 | 📝 | Session-WS-V1 | session.fork.created event | F1 | schema live, executor not-live | 文档已标注 | — | — |
| O-SESS-01 | 📝 | Session-HTTP | verify | F5 | preview-only 路由 | 生产通常不暴露 | — | — |

### 5.2 Finding 详情

#### `F-PERM-01` — permission/decision 成功响应缺 confirmation 字段

- **严重级别**：❌ FINDING
- **簇 / 端点**：Permissions / `POST /sessions/{id}/permission/decision`
- **维度**：F5
- **是否 blocker**：yes
- **事实依据**：
  - `surface-runtime.ts:383-386` —— 返回 `{ ok: true, data: { request_uuid, decision, scope } }`
  - `permissions.md:64-76` —— 文档声明成功响应含 `confirmation_uuid` + `confirmation_status`
  - `D1ConfirmationControlPlane.applyDecision()` 实际已写入 D1 row 并返回 `{ row, conflict }`，但 `handlePermissionDecision` 未将 `row.confirmation_uuid` / `row.status` 返回给客户端
- **为什么重要**：
  - 客户端按文档期望读取 `confirmation_status` 判断 confirmation 最终状态（esp. 409 conflict 之前成功的历史提交）
  - 缺字段迫使客户端额外调用 `GET /sessions/{id}/confirmations` 查询状态
- **修法（What + How）**：
  - **改什么**：`surface-runtime.ts:handlePermissionDecision` 成功返回应追加 `confirmation_uuid` 和 `confirmation_status` 字段
  - **怎么改**：利用 `ensureConfirmationDecision` 返回的 `rowResult`（已有 `row` 字段），在 200 响应中加 `confirmation_uuid: rowResult.row.confirmation_uuid` / `confirmation_status: rowResult.row.status`
  - **改完后的形态**：`{ ok: true, data: { request_uuid, decision, scope, confirmation_uuid, confirmation_status }, trace_uuid }`
  - **测试增量**：在 `permission-decision-route.test.ts` 新增断言验证 `confirmation_uuid` 和 `confirmation_status` 在 200 响应中出现
- **建议行动项**：A1
- **复审要点**：确认 `ensureConfirmationDecision` 的 non-conflict 路径返回的 `row` 包含 `confirmation_uuid` 和 `status`

#### `F-PERM-02` — elicitation/answer 成功响应缺 confirmation 字段

- **严重级别**：❌ FINDING
- **簇 / 端点**：Permissions / `POST /sessions/{id}/elicitation/answer`
- **维度**：F5
- **是否 blocker**：yes
- **事实依据**：
  - `surface-runtime.ts:478-480` —— 返回 `{ ok: true, data: { request_uuid, answer } }`
  - `permissions.md:137-148` —— 文档声明成功响应含 `confirmation_uuid` + `confirmation_status`
- **为什么重要**：同 F-PERM-01
- **修法（What + How）**：
  - **改什么**：同 F-PERM-01 模式，追加 `confirmation_uuid` 和 `confirmation_status`
  - **怎么改**：`handleElicitationAnswer` 在 200 响应中加入 `confirmation_uuid` / `confirmation_status`
  - **改完后的形态**：`{ ok: true, data: { request_uuid, answer, confirmation_uuid, confirmation_status }, trace_uuid }`
  - **测试增量**：在 `elicitation-answer-route.test.ts` 新增断言
- **建议行动项**：A1

#### `F-PERM-03` — permissions 文档声明不可达的 404/503 错误码

- **严重级别**：❌ FINDING
- **簇 / 端点**：Permissions / `permission/decision` + `elicitation/answer`
- **维度**：F5
- **是否 blocker**：yes
- **事实依据**：
  - `permissions.md:85-86` —— 文档声明 404 `confirmation-not-found` 和 503 `internal-error` 错误码
  - `surface-runtime.ts:77-115` —— `ensureConfirmationDecision()` 在 row 不存在时 auto-create，从不返回 404
  - `surface-runtime.ts:354-380, 450-475` —— RPC 失败被 try/catch 静默吞掉，不返回 503
- **为什么重要**：
  - 客户端按文档编写 404 / 503 处理逻辑将永不触发，浪费客户端代码
  - 文档声明的能力（graceful degradation on 404, resilience on 503）是虚假的
- **修法（What + How）**：
  - **选项 A（推荐）**：从 `permissions.md` 中移除 404 `confirmation-not-found` 和 503 `internal-error` 条目，因为当前实现行为是合理设计（auto-create row + best-effort RPC），文档应反映实现
  - **选项 B**：在 `ensureConfirmationDecision` 中增加 404 分支（当 D1 不可用时），在 RPC 失败时返回 503。但此方案与 HP5 Q16 row-first dual-write 设计矛盾（row-first 要求先写 row 再转发 RPC，不应在 RPC 失败时让整个请求失败）
  - **推荐选项 A**：修正文档
  - **测试增量**：无新增测试，仅需同步文档
- **建议行动项**：A2

#### `W-PERM-01` — User DO 400 扁平错误形状

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Permissions / 全部 3 端点 + Session 部分端点
- **维度**：F3
- **是否 blocker**：no
- **事实依据**：
  - `session-lifecycle.ts:264-269` 定义 `jsonResponse(status, body)` 直接 `Response.json(body, {status})`
  - User DO handler 中 400 错误使用 `{ error: "string", message: "string" }` 扁平格式
  - `index.ts:2962-3027` `wrapSessionResponse` 对非 facade shape 的 error 做了 error-lifting 重建
  - 如果绕过 facade 直接调用 User DO，将收到不符合 facade-http-v1 的错误格式
- **为什么重要**：架构 debt；如果在内部调用链中绕过 wrapper 则会泄露非标准形状
- **修法（What + How）**：
  - **改什么**：User DO handler 中的 400 错误应使用 `FacadeErrorSchema` 标准 `{ ok:false, error:{code,status,message} }` 格式
  - **怎么改**：在 `session-lifecycle.ts` 中添加 `facadeError()` helper（或从 `orchestrator-auth-contract` import），替换所有 `jsonResponse(400, { error: "string", message: "string" })` 为 `jsonResponse(400, { ok: false, error: { code: "invalid-input", status: 400, message: "..." } })`
  - **改完后的形态**：所有 User DO 错误都是 `{ ok:false, error:{code,status,message} }` 格式
  - **测试增量**：改 1-2 个 handler 的 400 测试断言验证 `error` 是 object 而非 string
- **建议行动项**：A3

#### `W-SESS-01` — 若干 session 端点缺专项测试

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Session-HTTP / DELETE, title, status, timeline, verify
- **维度**：F2
- **是否 blocker**：no
- **事实依据**：
  - DELETE /sessions/{id}：仅在 chat-lifecycle-route.test.ts 间接测试
  - PATCH /sessions/{id}/title：无专项
  - GET /sessions/{id}/status：无专项
  - GET /sessions/{id}/timeline：无专项
  - POST /sessions/{id}/verify：无专项
- **为什么重要**：回归风险
- **修法（What + How）**：
  - 为每个端点创建至少 2 个测试用例（happy path + 1 error path）
  - 工作量：S（可合并为 1-2 个 test 文件）
- **建议行动项**：A4

#### `W-SESS-02` — retry/fork first-wave stub 形状

- **严重级别**：⚠️ WARN
- **簇 / 端点**：Session-HTTP / retry, fork
- **维度**：F3
- **是否 blocker**：no
- **事实依据**：
  - `hp-absorbed-handlers.ts:9-40`（retry）返回 legacy shape with `retry_kind`, `hint`, `requested_attempt_seed`
  - `hp-absorbed-handlers.ts:42-71`（fork）返回 202 with `fork_status: "pending-executor"`
  - 两者已在文档 §17/§18 明确标注为 "first-wave"
- **为什么重要**：客户端需知道这些字段语义未最终冻结
- **修法**：文档标注已足够；当 retry/fork 主管线实现后更新响应中缀
- **建议行动项**：无（文档已充分标注）

---

## 6. 行动建议（按优先级）

| # | 优先级 | 关联 Finding | 簇 / 端点 | 行动项 | 涉及文件 | 测试要求 | 工作量 |
|---|--------|--------------|-----------|--------|----------|----------|--------|
| **A1** | P0 | F-PERM-01, F-PERM-02 | Permissions / permission/decision, elicitation/answer | 补充 `confirmation_uuid` + `confirmation_status` 到成功响应 | `surface-runtime.ts:383-386, 478-480` | 更新 permission-decision-route.test.ts + elicitation-answer-route.test.ts 断言 | S |
| **A2** | P0 | F-PERM-03 | Permissions / 全部 2 端点 | 从 permissions.md 移除不可达的 404/503 错误码条目（或实现 404/503 路径） | `clients/api-docs/permissions.md:85-86` | 文档同步验证 | XS |
| **A3** | P2 | W-PERM-01 | Permissions + Session | 将 User DO 400 扁平错误改造为 facade-http-v1 标准 shape | `session-lifecycle.ts`, `surface-runtime.ts`, `session-flow.ts`, `message-runtime.ts`, `hp-absorbed-handlers.ts` | 更新对应测试的 error shape 断言 | M |
| **A4** | P2 | W-SESS-01 | Session-HTTP | 补充 DELETE/title/status/timeline/verify 专项测试 | 新增 session-lifecycle-route.test.ts 或拆分 | 2+ test cases per endpoint | M |

### 6.1 整体修复路径建议

1. **A1** 应优先修复：涉及客户端 API 合同的字段缺失，影响真实使用场景。在 `surface-runtime.ts` 的 `handlePermissionDecision` 和 `handleElicitationAnswer` 中利用 `ensureConfirmationDecision` 已返回的 `row` 对象追加 `confirmation_uuid` 和 `confirmation_status`。此修复可合并为 1 个 PR。
2. **A2** 应与 A1 同步：文档修正独立于代码，但应在同一 PR 中附带，避免文档与代码不一致窗口。
3. **A3** 和 **A4** 可延后到 hero-to-pro 后续批次：A3 是架构 debt 级别，A4 是测试覆盖补充。两者不阻塞合规声明（FINDING 已确认但不阻塞）。
4. OBSERVATION 类（O-WS-01~04, O-SESS-01）无需本轮行动，在后续批次中跟进 emitter 实现。

### 6.2 不在本轮修复的项（defer 与原因）

| Finding ID | 不修原因 | 重评条件 | Owner | 下次复审日期 |
|------------|----------|----------|-------|--------------|
| O-WS-01 | confirmation WS emitter 需 agent-core 配合实现 | HP5 后续批次完成 confirmation emitter | orchestrator team | hero-to-pro 下个 milestone |
| O-WS-02 | todo WS emitter 需实现 | HP6 后续批次完成 todo emitter | orchestrator team | hero-to-pro 下个 milestone |
| O-WS-03 | model.fallback emitter 未接通 | HP2 后续批次 | agent-core team | hero-to-pro 下个 milestone |
| O-WS-04 | fork executor 未实现 | HP7 后续批次 | agent-core team | hero-to-pro 下个 milestone |
| W-SESS-02 | retry/fork first-wave 是已设计状态 | retry/fork 主管线实现后更新 | orchestrator team | hero-to-pro 下个 milestone |
| O-SESS-01 | verify 是 preview-only | 产品决策是否需要 Prod 暴露 | 产品+平台 | N/A |

---

## 7. 测试覆盖矩阵

| 端点 | 单元测试 | 集成 / 路由测试 | E2E / live 测试 | 错误路径覆盖 | 覆盖度评级 |
|------|----------|-----------------|------------------|--------------|------------|
| `POST /sessions/{id}/permission/decision` | confirmation-control-plane.test.ts | permission-decision-route.test.ts | — | 400 + 401 + 409 | ✅ |
| `POST /sessions/{id}/policy/permission_mode` | — | policy-permission-mode-route.test.ts | — | 400 + 401 + cross-session isolation | ✅ |
| `POST /sessions/{id}/elicitation/answer` | confirmation-dual-write.test.ts | elicitation-answer-route.test.ts | — | 400 + 401 + 409 | ✅ |
| `WS /sessions/{id}/ws` (connect) | ws-runtime.ts 单元 | user-do.test.ts | — | 401 + 400 + attach/supersede | ✅ |
| Stream events (13 kinds) | stream-event.test.ts + adapters | — | — | schema validate | ✅ |
| Confirmation frames | hp5-confirmation-messages.test.ts | confirmation-route.test.ts | — | kind/status enum + direction matrix | ✅ |
| Todo frames | hp6-todo-messages.test.ts | todo-route.test.ts | — | status enum + direction matrix | ✅ |
| `POST /sessions/{id}/start` | session-flow logic | auth.test.ts + smoke.test.ts | — | 401 + 409 + model-policy | ✅ |
| `POST /sessions/{id}/input` | session-flow logic | — (delegated to messages) | — | 400 empty text | ⚠️ |
| `POST /sessions/{id}/messages` | message-runtime.ts | messages-route.test.ts | — | 401 + 403 + 400 + 404 | ✅ |
| `POST /sessions/{id}/cancel` | session-flow logic | — (in user-do.test.ts) | — | 400 missing authority | ⚠️ |
| `POST /sessions/{id}/close` | session-flow logic | chat-lifecycle-route.test.ts | — | 409 already closed | ✅ |
| `DELETE /sessions/{id}` | session-flow logic | chat-lifecycle-route.test.ts (indirect) | — | — | ⚠️ |
| `PATCH /sessions/{id}/title` | session-flow logic | — | — | — | ❌ |
| `GET /sessions/{id}/status` | session-flow logic | — | — | — | ❌ |
| `GET /sessions/{id}/timeline` | session-flow logic | — | — | — | ❌ |
| `GET /sessions/{id}/history` | session-flow logic | — | — | — | ⚠️ |
| `POST /sessions/{id}/verify` | session-flow logic | — | — | — | ❌ |
| `POST /sessions/{id}/resume` | surface-runtime.ts | — | — | — | ⚠️ |
| `POST /sessions/{id}/retry` | hp-absorbed-handlers.ts | user-do.test.ts (indirect) | — | 404 + 409 | ⚠️ |
| `POST /sessions/{id}/fork` | hp-absorbed-handlers.ts | user-do.test.ts (indirect) | — | 404 | ⚠️ |
| `GET /sessions/{id}/usage` | usage-strict-snapshot.test.ts | — | — | 503 D1 failure | ✅ |
| `GET /conversations/{conversation_uuid}` | — | chat-lifecycle-route.test.ts | — | 404 | ✅ |

### 7.1 测试缺口清单（按优先级）

| 端点 | 缺什么 | 建议补在哪 | 关联 Finding |
|------|--------|------------|--------------|
| `PATCH /sessions/{id}/title` | 无专项路由测试 | session-lifecycle-route.test.ts (new file) | W-SESS-01 |
| `GET /sessions/{id}/status` | 无专项路由测试 | session-lifecycle-route.test.ts | W-SESS-01 |
| `GET /sessions/{id}/timeline` | 无专项路由测试 | session-lifecycle-route.test.ts | W-SESS-01 |
| `DELETE /sessions/{id}` | 无直接 DELETE 专项测试 | session-lifecycle-route.test.ts | W-SESS-01 |
| `POST /sessions/{id}/verify` | 无专项测试 | session-lifecycle-route.test.ts | W-SESS-01 |
| `POST /sessions/{id}/permission/decision` | 缺 200 成功响应字段断言 | permission-decision-route.test.ts | F-PERM-01 |
| `POST /sessions/{id}/elicitation/answer` | 缺 200 成功响应字段断言 | elicitation-answer-route.test.ts | F-PERM-02 |

---

## 8. 文件 & 引用索引

| 文件 | 行号范围 | 角色 |
|------|----------|------|
| `workers/orchestrator-core/src/index.ts` | 433-489, 786-840, 2962-3027 | 路由解析 / auth / facade wrapper |
| `workers/orchestrator-core/src/user-do-runtime.ts` | 350-574, 990-1031 | User DO 调度中心 / emitServerFrame |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts` | 77-115, 189-671 | permission/decision, elicitation/answer, policy/permission_mode, usage, resume |
| `workers/orchestrator-core/src/user-do/session-flow.ts` | 232-964 | start, input, cancel, close, delete, title, verify, read |
| `workers/orchestrator-core/src/user-do/message-runtime.ts` | 123-412 | messages handler |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts` | 50-151 | WS attach lifecycle |
| `workers/orchestrator-core/src/hp-absorbed-handlers.ts` | 9-71 | retry, fork absorbed handlers |
| `workers/orchestrator-core/src/confirmation-control-plane.ts` | 89-293 | D1ConfirmationControlPlane |
| `workers/orchestrator-core/src/frame-compat.ts` | 1-170 | validateLightweightServerFrame |
| `workers/orchestrator-core/src/entrypoint.ts` | 221-284 | forwardServerFrameToClient |
| `workers/orchestrator-core/src/session-lifecycle.ts` | 51-60, 264-269 | Body types / jsonResponse helper |
| `workers/orchestrator-core/src/auth.ts` | 34-72, 221-327 | IngressAuthSnapshot / authenticateRequest |
| `packages/orchestrator-auth-contract/src/facade-http.ts` | 48-90, 134-151 | FacadeErrorCodeSchema / envelope schemas |
| `packages/orchestrator-auth-contract/src/auth-error-codes.ts` | 3-17 | AuthErrorCodeSchema |
| `packages/nacp-session/src/messages.ts` | 1-474 | NACP message body schemas (20 types) |
| `packages/nacp-session/src/stream-event.ts` | 1-180 | 13-kind stream event Zod schemas |
| `packages/nacp-session/src/type-direction-matrix.ts` | 1-55 | Direction matrix |
| `packages/nacp-session/src/websocket.ts` | 1-248 | SessionWebSocketHelper |
| `clients/api-docs/permissions.md` | 1-165 | 受查文档 |
| `clients/api-docs/session-ws-v1.md` | 1-261 | 受查文档 |
| `clients/api-docs/session.md` | 1-285 | 受查文档 |

---

## 9. 复审与回应入口

### 9.1 实现者回应入口

> 实现者应按 `docs/templates/code-review-respond.md` 的形式在本文档 §10 append 回应；**不要改写 §0 – §8**。回应应逐条引用 Finding ID 给出处理结果（已修 / 不修 / 推迟），并贴出 PR / commit 链接。

### 9.2 二次审查方式

- **建议方式**：`independent reviewer`
- **二次审查触发条件**：
  1. A1 PR merged（confirmation 字段补充）
  2. A2 文档修正 merged
  3. drift gate 重新跑过且全绿
- **二次审查应重点核查**：
  1. `surface-runtime.ts` 中 `handlePermissionDecision` 和 `handleElicitationAnswer` 的 200 响应确实包含 `confirmation_uuid` 和 `confirmation_status`
  2. `permissions.md` 中 404/503 错误码条目已移除或标注为不可达
  3. 两个端点的 route test 新增断言 pass

### 9.3 合规声明前的 blocker

1. `F-PERM-01` — permission/decision 成功响应缺 `confirmation_uuid` + `confirmation_status` —— Action A1
2. `F-PERM-02` — elicitation/answer 成功响应缺 `confirmation_uuid` + `confirmation_status` —— Action A1
3. `F-PERM-03` — permissions 文档声明不可达的 404/503 错误码 —— Action A2

---

## 10. 实现者回应（仅在 `re-reviewed` 状态使用）

> （暂空，待实现者填写）