# Nano-Agent 行动计划

> 服务业务簇: `pro-to-product / PP5 — Policy Honesty + Reliability Hardening`
> 计划对象: `消除 runtime policy overclaim，补齐 tool policy unavailable 语义，并把 stream failure 收敛为显式 degraded + client retry + docs truth`
> 类型: `modify`
> 作者: `GPT-5.5`
> 时间: `2026-05-03`
> 文件位置: `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> 上游前序 / closure:
> - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP2-closure.md`
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/issue/pro-to-product/PP3-closure.md`
> - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP4-closure.md`
> - `docs/design/pro-to-product/06-policy-reliability-hardening.md`
> 下游交接:
> - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP5-closure.md`
> 关联设计 / 调研文档:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/PPX-qna.md` Q18-Q20
> 冻结决策来源:
> - `docs/design/pro-to-product/PPX-qna.md` Q18（config-only 字段可保留，但必须标 not-enforced / stored-only）
> - `docs/design/pro-to-product/PPX-qna.md` Q19（stream retry first-wave 为显式 degraded + client retry + docs truth）
> - `docs/design/pro-to-product/PPX-qna.md` Q20（policy plane unavailable 禁止 silent allow，需显式 deny/degraded/error surfaced）
> 文档状态: `draft`

---

## 0. 执行背景与目标

PP5 是 PP6 contract sweep 前的最后一轮工程硬化。它不负责把 nano-agent 做成完整 policy platform，而是要消除三类会让前端误判安全/可靠性的 ambiguity：`/runtime` 字段“能存”但未必“生效”、policy plane unavailable 时被混入 ask 流程、non-stream 与 stream LLM failure 行为不一致。

当前代码事实支持这个判断：`/runtime` GET/PATCH 已有 ETag/If-Match、permission_rules、network_policy、web_search、workspace_scope 与 runtime.update frame（`workers/orchestrator-core/src/facade/routes/session-runtime.ts:146-265`），但字段可配置不等于执行层逐项 enforce；tool authorization 中 `db missing` 仍返回 `decision: "ask", source: "unavailable"`（`workers/orchestrator-core/src/entrypoint.ts:330-360`），容易撞穿 PP1 的 ask interrupt 语义；LLM non-stream `execute()` 有 retry/backoff/429 rotation（`workers/agent-core/src/llm/executor.ts:59-132`），stream `executeStream()` 则在 `!response.ok` 时直接 throw（`executor.ts:134-198`）。参考 agent 的原则也一致：Gemini non-interactive ask 会直接 throw，不伪造可交互（`context/gemini-cli/packages/core/src/scheduler/policy.ts:76-184`）；Codex network denial 产生 user-facing reason（`context/codex/codex-rs/core/src/network_policy_decision.rs:26-72`）；Claude Code allow/deny/ask/error 分支全部终结（`context/claude-code/hooks/useCanUseTool.tsx:37-180`）。

- **服务业务簇**：`pro-to-product / PP5 — Policy Honesty + Reliability Hardening`
- **计划对象**：`runtime enforce matrix + policy chain + reliability degraded contract`
- **本次计划解决的问题**：
  - `network_policy / web_search / workspace_scope` 等 public runtime 字段需要逐项证明 enforce，不能只因 GET/PATCH 存在就写成 active policy。
  - policy control plane unavailable 不能落入 `ask` 或 silent allow；它需要独立 fail-visible unavailable/degraded 语义。
  - stream failure 不做内部重试对齐，而要显式 `system.error` / retryable / client retry contract。
- **本次计划的直接产出**：
  - runtime enforce matrix：enforced / not-enforced / partial / stored-only，并为 not-enforced 登记 enforce/sunset 窗口。
  - policy decision chain：session rule → tenant rule → approval_policy → PP1 HITL → PP4 hook 的优先级与 failure handling。
  - `docs/issue/pro-to-product/PP5-closure.md`，为 PP6 提供 no-ambiguity runtime/error truth。
- **本计划不重新讨论的设计结论**：
  - config-only 字段允许保留，但必须标 not-enforced/stored-only 并登记预期 enforce 或 sunset（来源：`PPX-qna.md` Q18）。
  - stream first-wave 不追求内部 retry 与 non-stream 完全对齐，采用显式 degraded + client retry（来源：`PPX-qna.md` Q19）。
  - policy unavailable 不允许 silent allow，也不应复用 ask 语义（来源：`PPX-qna.md` Q20）。

---

## 1. 执行综述

### 1.1 总体执行方式

PP5 采用 **先事实矩阵，再决策链，再错误合同** 的执行方式。第一步逐字段从 facade config 反查执行层 consumption；第二步把 tool authorization 的 allow/deny/ask/unavailable 分支收敛，尤其避免 unavailable 复用 ask；第三步把 stream failure 转成 `system.error` / degraded / client retry contract，并把 latency alert 与 docs truth 交给 PP6。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Runtime Enforce Matrix | `M` | 逐字段验证 `/runtime` public config 是否执行层 enforce | `PP2-PP4 closure` |
| Phase 2 | Tool Policy Chain Hardening | `M` | 明确 session/tenant/approval/HITL/hook/unavailable 优先级 | `Phase 1` |
| Phase 3 | Reliability Degraded Contract | `M` | stream failure 输出 `system.error` + retryable + client retry docs truth | `Phase 2` |
| Phase 4 | Closure & PP6 Handoff | `S` | 输出 PP5 closure、not-enforced window、PP6 sweep input | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Runtime Enforce Matrix**
   - **核心目标**：把每个 runtime 字段从“可配置”拆成 enforced / partial / not-enforced / stored-only。
   - **为什么先做**：PP6 docs sweep 不能在字段执行状态不明时开始。
2. **Phase 2 — Tool Policy Chain Hardening**
   - **核心目标**：统一 tool auth 决策顺序和 failure branch，避免 ask/unavailable 混淆。
   - **为什么放在这里**：PP1/PP4 已闭合后，PP5 才能安全定义 HITL/hook/policy 的组合优先级。
3. **Phase 3 — Reliability Degraded Contract**
   - **核心目标**：stream failure 不内部重试对齐，而是 early/structured degraded，前端可 retry。
   - **为什么放在这里**：可靠性 truth 必须基于 policy chain 的 trace/source 语义。
4. **Phase 4 — Closure & PP6 Handoff**
   - **核心目标**：把 runtime matrix、error code、known limitations 写成 PP6 可消费输入。
   - **为什么放在最后**：PP6 是 docs closure，不应回头替 PP5 做事实判断。

### 1.4 执行策略说明

- **执行顺序原则**：config surface audit → execution consumption proof → policy unavailable branch → stream degraded contract → closure.
- **风险控制原则**：不新增 policy DSL，不建 network proxy，不做完整 SDK retry abstraction。
- **测试推进原则**：先写 runtime field consumption tests，再写 authorization unavailable tests，最后写 stream failure/system.error tests。
- **文档同步原则**：PP5 做最小 runtime/error truth sync；PP6 做完整 22-doc pack sweep。
- **回滚 / 降级原则**：无法安全 enforce 的字段不删除，但必须标 not-enforced/stored-only 并登记 enforce/sunset 窗口。

### 1.5 本次 action-plan 影响结构图

```text
PP5 Policy Honesty + Reliability Hardening
├── Phase 1: Runtime Enforce Matrix
│   ├── workers/orchestrator-core/src/facade/routes/session-runtime.ts
│   ├── workers/orchestrator-core/src/runtime-config-plane.ts
│   ├── workers/agent-core / bash-core / filesystem-core consumption path
│   └── clients/api-docs/runtime.md（必要最小同步）
├── Phase 2: Tool Policy Chain Hardening
│   ├── workers/orchestrator-core/src/entrypoint.ts
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   └── PP1 HITL + PP4 hook priority tests
├── Phase 3: Reliability Degraded Contract
│   ├── workers/agent-core/src/llm/executor.ts
│   ├── packages/nacp-core/src/observability/logger/system-error.ts
│   └── stream/error e2e tests
└── Phase 4: Closure & PP6 Handoff
    ├── docs/issue/pro-to-product/PP5-closure.md
    └── docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md handoff
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 对 `approval_policy`、`permission_rules`、`network_policy.mode`、`web_search.mode`、`workspace_scope.mounts` 建 runtime enforce matrix。
- **[S2]** 对 not-enforced / stored-only / partial 字段保留 public shape，但在 API/docs/closure 中必须映射到 frozen 5-label 集：`live / first-wave / schema-live / registry-only / not-enforced`，并登记 enforce/sunset window。
- **[S3]** 把 policy unavailable 从 `ask/unavailable` 改成独立 fail-visible branch，优先新增 `unavailable` 三态或等价 structured degraded。
- **[S4]** 写明 PP1 HITL 与 PP4 hook 在 tool policy chain 中的优先级，不允许 allow/deny 互相覆盖。
- **[S5]** stream failure 输出 `system.error` 或等价 degraded frame，包含 retryable、trace_uuid、retry_after/source。
- **[S6]** latency alert evidence：retry 首个前端可见响应 ≤1s 为 alert threshold，不是 hard gate。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不新增完整 policy DSL、org-wide admin policy editor 或 rule language v2。
- **[O2]** 不做完整 network proxy 或 sandbox worker。
- **[O3]** 不实现 stream 内部 retry 与 partial chunk rollback。
- **[O4]** 不做完整 SDK retry abstraction；前端/SDK 后续只消费 retryable contract。
- **[O5]** 不重开 PP1/PP4 主线；PP5 只消费它们的 closure truth。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| runtime enforce matrix | `in-scope` | Q18 要求不 overclaim | 无 |
| policy unavailable branch | `in-scope` | Q20 禁止 silent allow/ask 混淆 | 无 |
| stream internal retry | `out-of-scope first wave` | Q19 冻结为 degraded + client retry | 未来 protocol redesign |
| network proxy | `out-of-scope` | PP5 不建新 sandbox/network subsystem | platform-foundations |
| not-enforced sunset | `in-scope as closure metadata` | Q18 owner 补强要求登记窗口 | 无 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Runtime field audit | `update` | runtime route/config + execution consumers | 逐字段证明 enforce 状态 | `high` |
| P1-02 | Phase 1 | Not-enforced metadata | `update` | runtime docs/closure | stored-only / partial 不再 overclaim | `medium` |
| P2-01 | Phase 2 | Decision chain ordering | `update` | `entrypoint.ts`, agent-core auth seam | session/tenant/approval/HITL/hook 顺序清晰 | `high` |
| P2-02 | Phase 2 | Unavailable tri-state/degraded | `update` | `workers/orchestrator-core/src/entrypoint.ts`, `workers/agent-core/src/host/runtime-mainline.ts`, `workers/agent-core/src/host/env.ts`, authorization tests | db/control-plane missing 不再 ask | `high` |
| P2-03 | Phase 2 | Policy source diagnostics | `add` | authorization tests/audit | 每次 deny/ask/unavailable 有 source | `medium` |
| P3-01 | Phase 3 | Stream failure system.error | `update` | `executor.ts`, system-error emission path | stream 失败变 retryable degraded | `high` |
| P3-02 | Phase 3 | Client retry contract tests | `add` | stream/e2e tests | 前端可基于 trace/retryable retry | `medium` |
| P4-01 | Phase 4 | PP5 closure | `add` | `docs/issue/pro-to-product/PP5-closure.md` | PP6 有 no-ambiguity input | `low` |
| P4-02 | Phase 4 | Minimal runtime/error docs sync | `update` | `clients/api-docs/runtime.md`, error docs | docs 不 overclaim | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Runtime Enforce Matrix

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Runtime field audit | 逐字段反查 execution consumers，标 enforced/partial/not-enforced/stored-only | runtime route/config + worker consumers | 字段状态清晰 | tests + code audit | 每字段有 owner evidence |
| P1-02 | Not-enforced metadata | 为 not-enforced / stored-only / partial 字段登记 enforce/sunset window，并映射到 PP6 frozen 5-label 集 | closure/docs | 前端不误认为 active policy | docs review | Q18 满足 |

### 4.2 Phase 2 — Tool Policy Chain Hardening

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Decision chain ordering | 固化 session rule → tenant rule → approval policy → PP1 HITL → PP4 hook 的优先级 | `entrypoint.ts`, auth seam | 工具授权可解释 | unit/integration | 不存在互相覆盖 |
| P2-02 | Unavailable tri-state/degraded | 将 db/control-plane missing 从 ask 改为 independent unavailable/degraded，并同步更新本地 decision union owner | `entrypoint.ts`, `runtime-mainline.ts`, `env.ts` | unavailable fail-visible | tests | 不撞 PP1 ask |
| P2-03 | Policy source diagnostics | 记录 decision source/reason/trace，供 error/docs 使用 | auth/audit/tests | deny/unavailable 可解释 | tests | source 不丢失 |

### 4.3 Phase 3 — Reliability Degraded Contract

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Stream failure system.error | 对 stream `!response.ok` / no body / network failure 产出 structured degraded/system.error | `executor.ts`, system-error | 前端可见失败 | unit/integration | retryable/trace 字段齐全 |
| P3-02 | Client retry contract tests | 验证 stream failure 不内部重试覆盖 partial chunk，而是提示 client retry | stream/e2e tests | Q19 执行化 | tests/e2e | docs 可写单一路径 |

### 4.4 Phase 4 — Closure & PP6 Handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | PP5 closure | 输出 enforce matrix、policy chain、stream degraded evidence、known issues | `PP5-closure.md` | PP6 可直接 sweep | docs review | 不留 open option |
| P4-02 | Minimal runtime/error docs sync | 最小同步 not-enforced 与 retryable degraded label | `clients/api-docs` | docs 不误导前端 | docs consistency | PP6 无需先重判事实 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Runtime Enforce Matrix

- **Phase 目标**：把 public runtime 字段的执行状态说清。
- **本 Phase 对应编号**：`P1-01`, `P1-02`
- **本 Phase 新增文件**：
  - runtime enforce matrix tests 或 closure evidence。
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/facade/routes/session-runtime.ts`
  - `workers/orchestrator-core/src/runtime-config-plane.ts`
  - execution consumers in agent-core/bash-core/filesystem-core as applicable。
- **具体功能预期**：
  1. `approval_policy` 与 `permission_rules` 的 enforce 路径可证明。
  2. `network_policy.mode`、`web_search.mode`、`workspace_scope.mounts` 若未完全 enforce，明确 not-enforced/partial。
  3. 每个 not-enforced / stored-only / partial 字段登记 enforce/sunset window，并映射到 PP6 frozen 5-label 集。
- **具体测试安排**：
  - **单测**：runtime field parsing/merge。
  - **集成测试**：字段改变后执行层行为或 not-enforced label。
  - **回归测试**：orchestrator-core + affected worker tests。
  - **手动验证**：字段存在不被当作 enforce evidence。
- **收口标准**：
  - matrix 中没有 unknown 状态。
  - docs/closure 不写 stored-not-enforced 为 active policy。
- **本 Phase 风险提醒**：
  - workspace_scope 可能部分 enforce；必须拆 mounts/path law，而不是粗暴二分。

### 5.2 Phase 2 — Tool Policy Chain Hardening

- **Phase 目标**：让每次 tool auth 的来源、优先级、失败都可解释。
- **本 Phase 对应编号**：`P2-01`, `P2-02`, `P2-03`
- **本 Phase 新增文件**：
  - policy chain tests。
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/entrypoint.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/host/env.ts`
  - related auth/audit types。
- **具体功能预期**：
  1. session rule 优先 tenant rule，tenant rule 优先 approval fallback，HITL/hook 语义明确。
  2. unavailable 不再返回 ask；优先新增 `decision: "unavailable"` 或等价 degraded branch，并同步更新当前本地 decision union owner：`entrypoint.ts`、`runtime-mainline.ts`、`env.ts`。
  3. deny/unavailable/ask 都包含 source/reason/trace；其中 `hook-no-handler` 属于 terminal deny，不能 fall through 到 PP1 HITL 或 allow。
- **具体测试安排**：
  - **单测**：rule priority and unavailable branch。
  - **集成测试**：agent-core authorizeToolUse mapping。
  - **回归测试**：agent-core + orchestrator-core tests。
  - **手动验证**：db missing 不会触发 PP1 confirmation。
- **收口标准**：
  - policy unavailable fail-visible。
  - PP1 ask 只代表真实用户可决策场景。
- **本 Phase 风险提醒**：
  - 如果用 deny 复用 unavailable，要避免前端把控制面故障误认为用户/规则拒绝；三态更清晰。

### 5.3 Phase 3 — Reliability Degraded Contract

- **Phase 目标**：把 stream failure 变成前端可处理的 retryable degraded。
- **本 Phase 对应编号**：`P3-01`, `P3-02`
- **本 Phase 新增文件**：
  - stream failure tests。
- **本 Phase 修改文件**：
  - `workers/agent-core/src/llm/executor.ts`
  - system.error emission integration path。
- **具体功能预期**：
  1. stream `!response.ok`、no body、network/timeout error 产出 structured error/degraded。
  2. error 包含 retryable、trace_uuid、category、retry_after_ms（如存在）。
  3. 不在 PP5 内做 partial stream rollback 或内部 retry 对齐。
- **具体测试安排**：
  - **单测**：stream error classification。
  - **集成测试**：system.error emitted/delivered。
  - **回归测试**：agent-core tests。
  - **端到端**：模拟 provider stream failure，前端可见 retryable degraded。
- **收口标准**：
  - Q19 单一路径执行化：显式 degraded + client retry。
  - non-stream retry 与 stream degraded 的差异被 docs/closure 诚实描述。
- **本 Phase 风险提醒**：
  - 不要在 stream 已发送 partial chunks 后尝试透明重试；这会引入协议重设计。

### 5.4 Phase 4 — Closure & PP6 Handoff

- **Phase 目标**：把 PP5 的事实交给 PP6。
- **本 Phase 对应编号**：`P4-01`, `P4-02`
- **本 Phase 新增文件**：
  - `docs/issue/pro-to-product/PP5-closure.md`
- **本 Phase 修改文件**：
  - 必要的 `clients/api-docs/runtime.md` / error docs。
- **具体功能预期**：
  1. closure 附 runtime enforce matrix。
  2. closure 附 policy chain priority / unavailable behavior。
  3. closure 附 stream degraded evidence 与 retry contract，并复用 PP0 evidence shape + `latency_alert.threshold_key / exceeded_count / accepted_by_owner / repro_condition`。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：docs consistency。
  - **回归测试**：`pnpm run check:docs-consistency`。
  - **手动验证**：PP6 不需要重新判断 PP5 fact。
- **收口标准**：
  - PP6 可直接按 matrix 更新 docs。
  - 无 Q19 open option 残留。
- **本 Phase 风险提醒**：
  - PP5 不能变成 leftover 杂物抽屉；仅处理 policy/reliability ambiguity。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q18 | `PPX-qna.md` Q18 | config-only 字段保留但标 not-enforced/stored-only | 若要求删除字段，需 breaking contract review |
| Q19 | `PPX-qna.md` Q19 | stream first-wave 为 degraded + client retry | 若要求内部 retry，需要 stream protocol redesign |
| Q20 | `PPX-qna.md` Q20 | policy unavailable 禁止 silent allow/ask 混淆 | 未实现则 PP5 cannot close |
| T6 | `plan-pro-to-product.md` §10.1 | Policy/reliability truth 是 hard gate | 未满足不得进入 PP6 full closure |
| PP1/PP4 closure | PP1/PP4 closure docs | HITL/hook 优先级可被 PP5 消费 | 若未闭合，PP5 只能 partial |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| stored-not-enforced 永久化 | 字段一直存在但没人 enforce | `high` | closure 登记 enforce/sunset window |
| unavailable 混入 ask | 控制面故障触发 HITL UI | `high` | 独立 unavailable/degraded branch |
| stream degraded 太晚 | provider failure 只在日志里 | `medium` | system.error/frontend-visible test |
| policy/hook 优先级冲突 | PP4 hook 与 PP5 policy 双方都能 block | `medium` | 写明 decision chain，并测试来源 |

### 7.2 约束与前提

- **技术前提**：PP1 HITL、PP4 hook minimal loop 已闭合。
- **运行时前提**：system.error 或等价 stream event 可被 frontend 看到。
- **组织协作前提**：frontend 接受 retryable degraded contract，不依赖透明内部 retry。
- **上线 / 合并前提**：不得把 not-enforced 字段写成 active policy。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 原则上无；若 Q18-Q20 改变，回到 PPX-qna。
  - 若实现期发现 design/QNA 与代码事实冲突，必须先在本 action-plan 或 `PP5-closure.md` 记录发现，再判断是否回到 `PPX-qna.md` 补充 / 修订答案，并同步通知 PP6。
- 需要同步更新的说明文档 / README：
  - `docs/issue/pro-to-product/PP5-closure.md`
  - 必要时最小更新 `clients/api-docs/runtime.md`、error docs。
- 需要同步更新的测试说明：
  - policy/reliability evidence 写入 PP5 closure。

### 7.4 完成后的预期状态

1. `/runtime` 字段状态不再 ambiguous。
2. policy unavailable 是 fail-visible degraded/error，不再 masquerade as ask。
3. stream failure 对前端是 retryable degraded contract，而不是 unknown throw。
4. PP6 可以开始 item-by-item docs sweep，而不用先重做 PP5 fact audit。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check -- docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
- **单元测试**：
  - runtime field parsing/merge/enforce label tests。
  - policy decision chain and unavailable branch tests。
  - stream error classification tests。
- **集成测试**：
  - `/runtime` GET/PATCH + ETag + enforcement/label tests。
  - agent-core authorization path tests。
  - system.error delivery tests。
- **端到端 / 手动验证**：
  - provider stream failure produces frontend-visible retryable degraded.
- **回归测试**：
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm test:e2e`（若扩展 e2e）
- **文档校验**：
  - `pnpm run check:docs-consistency`。

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. runtime enforce matrix 完整，无 unknown 字段。
2. unavailable 独立于 ask，且 fail-visible。
3. stream failure 有 `system.error` / degraded / retryable contract。
4. PP5 closure 无 Q18-Q20 open option，能直接交给 PP6。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | policy/config/reliability ambiguity 被消除 |
| 测试 | runtime/policy/stream/error paths 均有覆盖 |
| 文档 | not-enforced、unavailable、degraded retry contract 诚实标注 |
| 风险收敛 | 无 silent allow、无 stored-not-enforced overclaim、无 stream retry open option |
| 可交付性 | PP6 可进入 API contract sweep + docs closure |
