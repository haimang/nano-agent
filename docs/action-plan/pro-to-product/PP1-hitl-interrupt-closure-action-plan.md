# Nano-Agent 行动计划

> 服务业务簇: `pro-to-product / PP1 — HITL Interrupt Closure`
> 计划对象: `把 approval_policy=ask、tool_permission、elicitation 与 confirmation decision 从 error path 接成 row-first pause-resume loop`
> 类型: `modify`
> 作者: `GPT-5.5`
> 时间: `2026-05-03`
> 文件位置: `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> 上游前序 / closure:
> - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
> - `docs/issue/pro-to-product/PP0-closure.md`
> - `docs/design/pro-to-product/02-hitl-interrupt-closure.md`
> 下游交接:
> - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP1-closure.md`
> 关联设计 / 调研文档:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/PPX-qna.md` Q6-Q8
> 冻结决策来源:
> - `docs/design/pro-to-product/PPX-qna.md` Q6（`approval_policy=ask` 必须 interrupt，不能 error-out）
> - `docs/design/pro-to-product/PPX-qna.md` Q7（confirmation decision 继续走 HTTP，不改 WS 写入）
> - `docs/design/pro-to-product/PPX-qna.md` Q8（confirmation kind 维持 7-kind freeze）
> 文档状态: `draft`

---

## 0. 执行背景与目标

PP1 是 pro-to-product 的第一条 runtime truth gate：HITL 必须从“错误提示”变成“真实等待用户、用户决策后恢复 agent loop”。当前 nano-agent 已经具备若干 substrate：`session-do-runtime.ts` 有 permission / elicitation 的 `emit...AndAwait()` wait primitive，orchestrator facade 已有 confirmation decision HTTP route，D1 confirmation row 与 WS update 也已存在。但主线 `authorizeToolPlan()` 仍在 `decision === "ask"` 时返回 `tool-permission-required` error（`workers/agent-core/src/host/runtime-mainline.ts:235-261`），这正是 PP1 必须修掉的断点。

参考 agent 的可借鉴点很明确：Gemini scheduler 在 confirmation loop 中把 call 状态更新为 `AwaitingApproval` 并按 correlation id 等待响应（`context/gemini-cli/packages/core/src/scheduler/confirmation.ts:51-175`）；Claude Code 的 `useCanUseTool` 把 allow/deny/ask/error 都终结到明确 resolve/cancel 路径（`context/claude-code/hooks/useCanUseTool.tsx:37-180`）；Codex 在 approval policy 不允许 prompt 时返回明确 rejection reason（`context/codex/codex-rs/core/src/exec_policy.rs:124-153`）。nano-agent 不照搬本地 UI queue，而是把同等语义落在 D1 row + WS frame + HTTP decision + DO/runtime await 上。

- **服务业务簇**：`pro-to-product / PP1 — HITL Interrupt Closure`
- **计划对象**：`tool_permission / elicitation pause-resume loop`
- **本次计划解决的问题**：
  - `approval_policy=ask` 仍被映射成工具错误，前端无法展示“等待用户确认”状态。
  - confirmation decision 虽已 row-first 写入并 emit update，但 runtime wait/wakeup 没有形成完整主线闭环。
  - pending confirmation read model 与 timeout/superseded 纪律需要进入 closure evidence，防止 infinite pending。
- **本次计划的直接产出**：
  - agent-core ask bridge：`ask → confirmation row + WS request + runtime await`。
  - orchestrator decision wakeup 与 duplicate decision e2e evidence。
  - `docs/issue/pro-to-product/PP1-closure.md`，登记 allow / deny / timeout / no-client 的真实证据。
- **本计划不重新讨论的设计结论**：
  - ask 必须 interrupt，不能继续作为 tool error 兜底（来源：`PPX-qna.md` Q6）。
  - decision 输入继续走 HTTP，WS 只广播 server→client frame（来源：`PPX-qna.md` Q7）。
  - PP1 不扩展 confirmation kind；`tool_permission` / `elicitation` 复用现有 7-kind freeze（来源：`PPX-qna.md` Q8）。

---

## 1. 执行综述

### 1.1 总体执行方式

PP1 采用 **先接 runtime ask bridge，再接 decision wakeup，最后补 pending/reconnect evidence** 的执行方式。先修 agent-core 主线让 ask 真进入等待；再保证 HTTP decision 能恢复等待者；最后通过 list/read pending、timeout、duplicate decision 与 no-client 边界证明它是可恢复 HITL，而不是内存里临时挂起的 promise。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Runtime Ask Bridge | `M` | 把 `authorizeToolPlan()` 的 ask 分支接到 row-first confirmation + await | `PP0 skeleton` |
| Phase 2 | Decision Wakeup & Terminal Discipline | `M` | 让 HTTP decision 唤醒 runtime，并覆盖 allow/deny/timeout/superseded/duplicate | `Phase 1` |
| Phase 3 | Pending Truth & Reconnect Evidence | `S` | 确认前端刷新后能列出 pending，并形成 PP1 e2e/closure | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — Runtime Ask Bridge**
   - **核心目标**：将 `decision: "ask"` 从 error path 改为 durable pending + runtime await。
   - **为什么先做**：这是 PP1 最大断点；不修主线，后续 route/WS/docs 都只是 substrate。
2. **Phase 2 — Decision Wakeup & Terminal Discipline**
   - **核心目标**：HTTP decision 写 row 后必须唤醒等待 runtime，且所有终态都可观测。
   - **为什么放在这里**：row-first 只解决“请求已存在”，wakeup 才解决“agent loop 继续”。
3. **Phase 3 — Pending Truth & Reconnect Evidence**
   - **核心目标**：把 pending list/detail、duplicate decision、timeout/no-client 边界转成 e2e 和 closure evidence。
   - **为什么放在最后**：只有 ask bridge 与 wakeup 已稳定，pending truth 才不是静态表数据。

### 1.4 执行策略说明

- **执行顺序原则**：agent-core mainline → orchestrator decision/wakeup → route/read-model/e2e → docs/closure。
- **风险控制原则**：不新增 confirmation kind，不把 decision 改成 WS 输入，不在 PP1 实现完整 permission rule editor。
- **测试推进原则**：先写/修 agent-core wait 单测，再补 orchestrator route/idempotency 测试，最后扩展 PP0 e2e skeleton。
- **文档同步原则**：PP1 只同步 confirmation/HITL 相关 truth；全量 `clients/api-docs` sweep 交给 PP6。
- **回滚 / 降级原则**：non-interactive/no-client 不得伪 pending；必须显式 timeout/deny/no-decider。

### 1.5 本次 action-plan 影响结构图

```text
PP1 HITL Interrupt Closure
├── Phase 1: Runtime Ask Bridge
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   ├── workers/agent-core/src/host/do/session-do-runtime.ts
│   └── workers/agent-core/test/**
├── Phase 2: Decision Wakeup & Terminal Discipline
│   ├── workers/orchestrator-core/src/facade/routes/session-control.ts
│   ├── workers/orchestrator-core/src/confirmation-control-plane.ts
│   └── workers/orchestrator-core/test/**
└── Phase 3: Pending Truth & Reconnect Evidence
    ├── test/package-e2e/** 或 test/cross-e2e/**
    ├── clients/api-docs/confirmations.md（必要最小同步）
    └── docs/issue/pro-to-product/PP1-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `authorizeToolPlan()` 的 `ask` 分支不再返回 `tool-permission-required` error，而是创建/关联 `tool_permission` confirmation 并等待用户决策。
- **[S2]** `elicitation` 与 `tool_permission` 共享 row-first / wait / timeout / terminal discipline。
- **[S3]** HTTP decision route 保持唯一 client→server 写入路径，并能唤醒等待中的 runtime。
- **[S4]** duplicate decision 返回 `409 confirmation-already-resolved`，客户端可视为已有终态。
- **[S5]** non-interactive/no-client 明确走 timeout/deny/no-decider，不伪造 pending。
- **[S6]** PP1 e2e 至少覆盖 interactive ask → pause-resume、timeout → terminal、no-client → explicit no-decider 三组。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不扩展 confirmation kind；`context_compact`、`checkpoint_restore` 等仍由对应 phase 接 caller。
- **[O2]** 不把 confirmation decision 改为 client→server WS frame。
- **[O3]** 不实现完整 permission rule editor、policy matrix 或 runtime 三字段 honesty；这些属于 PP5。
- **[O4]** 不修 replay restore / detached recovery；这些属于 PP3。
- **[O5]** 不做 full `clients/api-docs` pack sweep；只做 PP1 必需的最小 truth sync。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `approval_policy=ask` runtime bridge | `in-scope` | Q6 已冻结，当前 mainline 仍 error-out | 无；PP1 必做 |
| HTTP decision idempotency | `in-scope` | Q7 冻结 HTTP 输入，前端 retry 必须安全 | 协议 v2 才能改 |
| 7-kind confirmation freeze | `in-scope as constraint` | Q8 冻结不扩 enum | owner charter amendment |
| legacy `/permission/decision` | `compat` | 可保留但非推荐主合同 | PP6 docs sweep 决定标注 |
| permission rule editor | `out-of-scope` | PP1 只闭合 interrupt，不做管理 UI | PP5/后续产品阶段 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Ask bridge owner seam | `update` | `workers/agent-core/src/host/runtime-mainline.ts` | 把 ask 从 error 改成 wait | `high` |
| P1-02 | Phase 1 | Row-first request creation | `update` | `workers/agent-core/src/host/do/session-do-runtime.ts`, confirmation control plane | ask/elicitation 总是先落 pending row | `medium` |
| P1-03 | Phase 1 | No-client boundary | `add` | agent-core runtime tests | non-interactive 不伪 pending | `medium` |
| P2-01 | Phase 2 | HTTP decision wakeup | `update` | `session-control.ts`, DO/agent-core wake seam | decision 能恢复 runtime | `high` |
| P2-02 | Phase 2 | Terminal status discipline | `update` | confirmation control plane/tests | allow/deny/timeout/superseded 全部终态 | `medium` |
| P2-03 | Phase 2 | Duplicate decision idempotency | `update` | route tests | 重复提交稳定返回 409 + 终态 | `low` |
| P3-01 | Phase 3 | Pending read-model verification | `update` | confirmations list/detail routes/tests | 刷新后能恢复 pending UI | `medium` |
| P3-02 | Phase 3 | HITL e2e evidence | `add` | `test/package-e2e` / `test/cross-e2e` | 证明 pause-resume 真实闭环 | `high` |
| P3-03 | Phase 3 | PP1 closure | `add` | `docs/issue/pro-to-product/PP1-closure.md` | 记录三态证据与 latency alert | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Runtime Ask Bridge

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Ask bridge owner seam | 改造 `authorizeToolPlan()`，`decision: ask` 不再返回 error，而是调用 durable HITL wait seam | `runtime-mainline.ts` | tool call 暂停等待用户 | agent-core unit/integration test | ask 不产生 `tool-permission-required` terminal error |
| P1-02 | Row-first request creation | 确保 ask/elicitation 在 emit frame 前已有 pending truth，或明确 row-first/emit 顺序 | `session-do-runtime.ts`, confirmation plane | pending row 与 request frame 可对账 | worker tests | row commit 先于 frontend-visible request |
| P1-03 | No-client boundary | 为 non-interactive/no-client 增加 explicit no-decider/timeout/deny 行为 | runtime tests | 不产生无人可处理的 pending | unit/e2e | no-client 路径终结且可解释 |

### 4.2 Phase 2 — Decision Wakeup & Terminal Discipline

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | HTTP decision wakeup | 在 `applyDecision()` row write + WS update 后，确保等待 runtime 收到 allow/deny/modified payload | `session-control.ts`, DO wake seam | 用户 POST decision 后 agent loop 继续 | route + integration test | decision 可恢复 paused tool call |
| P2-02 | Terminal status discipline | timeout/superseded/deny 不再悬挂 promise，并能写入 row terminal status | confirmation plane/tests | 所有等待有终态 | targeted tests | 无 infinite pending |
| P2-03 | Duplicate decision idempotency | 重复提交同一 confirmation_uuid 返回 `409 confirmation-already-resolved`，沿用 `jsonPolicyError()` 的 `facade-http-v1` envelope；如需终态详情由 detail/list route 读取 | route tests | 前端 retry 安全 | route test | 不创建新 row、不 silent overwrite |

### 4.3 Phase 3 — Pending Truth & Reconnect Evidence

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Pending read-model verification | 验证 `GET /sessions/{id}/confirmations?status=pending` 能恢复 pending UI | confirmation routes/tests | reconnect 后能展示待确认项 | route/e2e | pending list 与 row truth 一致 |
| P3-02 | HITL e2e evidence | 扩展 PP0 skeleton，覆盖 interactive ask、timeout、no-client、duplicate decision | e2e tests | PP1 有 frontend-facing evidence | e2e | evidence shape 可直接写 closure |
| P3-03 | PP1 closure | 写 `PP1-closure.md`，登记 truth gate、latency alert、known issue | docs | PP2/PP3/PP4 可继承稳定 substrate | docs review | closure 不 overclaim |

---

## 5. Phase 详情

### 5.1 Phase 1 — Runtime Ask Bridge

- **Phase 目标**：修掉 `ask → error` 的主线断点。
- **本 Phase 对应编号**：`P1-01`, `P1-02`, `P1-03`
- **本 Phase 新增文件**：
  - 必要的 agent-core targeted tests。
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/host/do/session-do-runtime.ts`
  - 相关 host/runtime test files。
- **具体功能预期**：
  1. `authorizeToolUse` 返回 ask 时，runtime 进入 wait，不再把 ask 作为 tool error 交给模型。
  2. wait request 具备 `confirmation_uuid/request_uuid` correlation，能与 HTTP decision 对齐。
  3. no-client/non-interactive 不创建无人能处理的 pending row。
- **具体测试安排**：
  - **单测**：`authorizeToolPlan()` ask/deny/allow 分支。
  - **集成测试**：Session DO permission wait seam。
  - **回归测试**：`pnpm --filter @haimang/agent-core-worker test`。
  - **手动验证**：确认 `tool-permission-required` 不再出现在 interactive ask terminal path。
- **收口标准**：
  - ask 分支有 durable pending + await。
  - deny 仍保持 explicit deny，不与 ask 混淆。
- **本 Phase 风险提醒**：
  - 如果只创建 row 但 runtime 没 await，仍是假闭环。

### 5.2 Phase 2 — Decision Wakeup & Terminal Discipline

- **Phase 目标**：保证用户 decision 能恢复 runtime，并且所有等待都有终态。
- **本 Phase 对应编号**：`P2-01`, `P2-02`, `P2-03`
- **本 Phase 新增文件**：
  - 必要的 orchestrator-core route/plane tests。
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/facade/routes/session-control.ts`
  - `workers/orchestrator-core/src/confirmation-control-plane.ts`
  - 可能的 User DO / agent-core wake seam。
- **具体功能预期**：
  1. `POST /sessions/{id}/confirmations/{uuid}/decision` 写 row 后唤醒等待者。
  2. duplicate decision 返回 `facade-http-v1` envelope 的 `409 confirmation-already-resolved`，不创建第二个 decision；如需终态详情由 detail/list route 补读。
  3. timeout/superseded 不留 pending。
- **具体测试安排**：
  - **单测**：confirmation plane terminal transition。
  - **集成测试**：route apply decision + emit update + wakeup。
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker test` 与 agent-core 受影响测试。
  - **手动验证**：重复提交同一 uuid 的 response 与 docs 语义一致。
- **收口标准**：
  - allow/deny/modified/timeout/superseded 均可使 wait 终结。
  - duplicate decision 不破坏 row-first truth。
- **本 Phase 风险提醒**：
  - row terminal 与 runtime wakeup 必须一致，不能出现前端看到 resolved 但 agent 仍挂起。

### 5.3 Phase 3 — Pending Truth & Reconnect Evidence

- **Phase 目标**：把 HITL 从 runtime feature 提升为 frontend-recoverable truth。
- **本 Phase 对应编号**：`P3-01`, `P3-02`, `P3-03`
- **本 Phase 新增文件**：
  - PP1 e2e skeleton extension。
  - `docs/issue/pro-to-product/PP1-closure.md`
- **本 Phase 修改文件**：
  - pending confirmations route/tests。
  - 必要的 `clients/api-docs/confirmations.md` 最小 truth note。
- **具体功能预期**：
  1. 前端刷新/重连后能通过 `GET /sessions/{id}/confirmations?status=pending` 找回 pending confirmation。
  2. PP1 e2e 输出 PP0 统一 evidence shape。
  3. closure 登记 latency alert 与 no-client edge，并复用 PP0 定义的 `latency_alert.threshold_key / exceeded_count / accepted_by_owner / repro_condition`。
- **具体测试安排**：
  - **单测**：无新增或仅 helper。
  - **集成测试**：pending list/detail route test。
  - **回归测试**：`pnpm test:package-e2e` 或 `pnpm test:cross-e2e`。
  - **手动验证**：closure 中每条证据都能追溯代码 owner file。
- **收口标准**：
  - interactive ask → pause → decision → resume 成立。
  - timeout/no-client/duplicate decision 均有证据。
- **本 Phase 风险提醒**：
  - 不要把 unit test 成功写成 frontend-visible truth；至少一条 e2e 或等价 integration evidence 必须存在。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q6 | `PPX-qna.md` Q6 | ask 必须 interrupt，禁止 error-out | PP1 无法启动，回到 design/QNA |
| Q7 | `PPX-qna.md` Q7 | decision 输入走 HTTP，WS 只广播状态 | 若改 WS，需要协议新版本与 PP6 docs 重排 |
| Q8 | `PPX-qna.md` Q8 | PP1 不扩 confirmation kind | 若扩 kind，需 schema/charter amendment |
| D-00-1 | `00-agent-loop-truth-model.md` D-00-1 | HITL truth 是 hard gate 之一 | 未满足则 PP1 cannot close |
| D-01-1 | `01-frontend-trust-contract.md` D-01-1 | frontend 只依赖 facade contract | internal seam 不能写成 client docs |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| row/wait 双写不一致 | row pending 但 runtime 没 await，或 wait 了但 row 不存在 | `high` | row-first + wakeup test 必须同时覆盖 |
| no-client 假 pending | 无前端在线却创建 pending | `medium` | 明确 no-decider/timeout terminal |
| decision race | duplicate/retry 覆盖已有终态 | `medium` | 409 + 已有终态语义测试 |
| PP3 owner file 冲突 | PP3 也可能改 `session-do-runtime.ts` | `medium` | PP1 closure 必须冻结共享 owner file 清单（至少 `session-do-runtime.ts`）并声明稳定后 PP3 才切入 |

### 7.2 约束与前提

- **技术前提**：PP0 skeleton 已存在或本阶段先补齐可扩展 e2e owner file。
- **运行时前提**：D1 confirmation plane 与 User DO/agent-core wait seam 可通信。
- **组织协作前提**：FE-2 中期 mock review 会复用 PP1 输出。
- **上线 / 合并前提**：不能新增 confirmation kind 或改 decision transport；PP1 closure 还必须列出共享 owner file 稳定清单，供 PP3 只通过既定 extension point 切入。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 原则上无；若实现发现 design 决策不成立，回到 `PPX-qna.md` amend。
  - 若实现期发现 design/QNA 与代码事实冲突，必须先在本 action-plan 或 `PP1-closure.md` 记录发现，再判断是否回到 `PPX-qna.md` 补充 / 修订答案，并同步通知 PP2 / PP3 / PP4。
- 需要同步更新的说明文档 / README：
  - `docs/issue/pro-to-product/PP1-closure.md`
  - 必要时最小更新 `clients/api-docs/confirmations.md`
- 需要同步更新的测试说明：
  - PP1 e2e evidence 与运行脚本写入 closure。

### 7.4 完成后的预期状态

1. `approval_policy=ask` 不再表现为工具失败，而是真实 pending interrupt。
2. HTTP decision 可以恢复 agent loop，WS frame 只承担 server→client 可见性。
3. pending confirmations 可被前端刷新/重连后恢复。
4. PP2/PP3/PP4 可依赖稳定的 interrupt substrate，而不用各自发明人工确认控制面。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check -- docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
- **单元测试**：
  - agent-core runtime ask/allow/deny tests。
  - confirmation plane terminal transition tests。
- **集成测试**：
  - orchestrator-core decision route + wakeup tests。
- **端到端 / 手动验证**：
  - PP1 e2e：interactive ask → pause-resume、timeout → terminal、no-client → explicit no-decider。
- **回归测试**：
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm test:e2e`（若 e2e harness 有改动）
- **文档校验**：
  - `pnpm run check:docs-consistency`（若同步 clients/api-docs）。

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `ask` 真进入 pending interrupt，不再 error-out。
2. allow / deny / timeout / no-client / duplicate decision 均有真实证据。
3. pending read model 能支撑前端刷新恢复。
4. PP1 closure 明确共享 owner file 稳定清单（至少 `session-do-runtime.ts`）与可交给 PP2/PP3/PP4 的 extension point。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | HITL pause-resume live loop 成立 |
| 测试 | agent-core、orchestrator-core 与 e2e 覆盖主线和边界 |
| 文档 | PP1 closure 与必要 client docs truth 同步 |
| 风险收敛 | 无 error-out overclaim、无 infinite pending、无 WS decision 漂移 |
| 可交付性 | PP2/PP3/PP4 可复用 interrupt substrate |

---

## 9. 执行工作报告（2026-05-03）

1. 完成 `p2p-pp1-code`：确认当前 `runtime-mainline.ts` 已将 `decision: ask` 接入 `requestToolPermission` wait seam，ask 不再以 `tool-permission-required` 作为主线 terminal error。
2. 完成 agent-core no-client / timeout 收敛：`session-do-runtime.ts` 中 permission 与 elicitation 均通过 unified `session.confirmation.request` 发起 HITL，并在 `delivered=false` 或 await timeout 时调用 `settleConfirmation(status="timeout")`。
3. 完成 orchestrator row-first hard gate：`entrypoint.ts` 对 unified `session.confirmation.request` 要求 D1 confirmation row 创建成功后才 forward 到 User DO；legacy compat request 仍保留历史 best-effort。
4. 完成 generic decision wakeup：`session-control.ts` 的 `POST /sessions/{id}/confirmations/{uuid}/decision` 在 row terminal 后对 `tool_permission` / `elicitation` 调用 agent-core RPC；RPC missing、异常或非 2xx 会返回 `503 internal-error`，不再 success-shaped。
5. 补充 agent-core tests：`runtime-mainline.test.ts` 覆盖 ask→wait→allow 执行与 ask→deny 不执行；`nano-session-do.test.ts` 覆盖 permission / elicitation no-client timeout settle。
6. 补充 orchestrator route tests：`confirmation-route.test.ts` 覆盖 decision apply + permission wakeup、wakeup missing 返回 503、status enum rejection、duplicate conflicting decision 409、list/detail/pending read model。
7. 执行验证：`pnpm --filter @haimang/agent-core-worker typecheck`、`build`、`test -- test/host/runtime-mainline.test.ts test/host/do/nano-session-do.test.ts` 均通过；agent-core targeted tests 共 44 项通过。
8. 执行验证：`pnpm --filter @haimang/orchestrator-core-worker typecheck`、`build`、`test -- test/confirmation-route.test.ts` 均通过；orchestrator confirmation route tests 共 8 项通过。
9. 执行独立复审：第一轮 PP1 review 发现 3 个 significant issues（decision wakeup success-shaped、elicitation infinite pending、row-first best-effort）；全部完成修复。
10. 执行独立修复复审：第二轮 code review 确认 no significant issues found。
11. 清理生成漂移：build/test 产生的 `workers/*/src/generated/package-manifest.ts` timestamp-only drift 已复原，最终只保留 PP1 相关代码与测试改动。
12. 输出 closure：新增 `docs/issue/pro-to-product/PP1-closure.md`，明确 PP1 closed、证据矩阵、已知边界、共享 owner files 与 PP2/PP3/PP4 交接。
