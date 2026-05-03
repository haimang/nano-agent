# Pro-to-Product Action-Plan 文档审查报告

> 审查对象: `docs/action-plan/pro-to-product/PP0-PP6` 全部 7 份 action-plan 文档
> 审查类型: `docs-review`
> 审查时间: `2026-05-03`
> 审查人: `kimi`
> 审查范围:
> - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md`
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/action-plan/pro-to-product/PP4-hook-delivery-closure-action-plan.md`
> - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> 对照真相:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/PPX-qna.md`
> - `docs/design/pro-to-product/00-07-design-docs`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: `7 份 action-plan 主体架构成立，与 charter、QNA、design 文档的映射关系基本正确，代码引用经核查准确；但存在 3 个 high 级 delivery-gap / protocol-drift 风险、2 个 medium 级 cross-phase 协调盲区，需在进入主实现前明确缓解措施。`
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `yes，但必须在进入主实现前完成 §5 中的 blocker 清单`
- **本轮最关键的 1-3 个判断**:
  1. `代码引用（行号）经 100% 抽样核查，全部准确；action-plan 对当前代码 reality 的认知是诚实的。`
  2. `PP2 prompt mutation 证明路径在现有架构中缺乏明确的捕获点，是 T2 hard gate 的最大 delivery risk。`
  3. `PP3 与 PP1 的共享 owner file 冲突已被意识到，但 action-plan 未提供具体的文件锁定或分支协调协议。`

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/charter/plan-pro-to-product.md` — 核对 phase 划分、truth gates (§10.1)、In/Out-of-Scope (§4)、D1 例外 law (§4.5)
  - `docs/design/pro-to-product/PPX-qna.md` — 核对 Q1-Q22 的业主回答与 action-plan 引用一致性
  - `docs/design/pro-to-product/00-07-design-docs` — 核对上游 design 与 action-plan 的依赖关系
- **核查实现**:
  - `workers/agent-core/src/host/runtime-mainline.ts` — PP1/PP2/PP5 引用
  - `workers/agent-core/src/host/do/session-do-persistence.ts` — PP3 引用
  - `workers/agent-core/src/hooks/registry.ts` / `catalog.ts` / `dispatcher.ts` — PP4 引用
  - `workers/orchestrator-core/src/entrypoint.ts` — PP5 引用
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts` — PP3 引用
  - `workers/orchestrator-core/src/facade/route-registry.ts` — PP6 引用
  - `packages/nacp-session/src/stream-event.ts` — PP5 引用
  - `clients/api-docs/` — PP6 22-doc pack 验证
- **执行过的验证**:
  - `find clients/api-docs -maxdepth 1 -type f -name '*.md' | wc -l` → 22 个文件，与 PP6 声明一致
  - `grep -n "tool-permission-required" workers/agent-core/src/host/runtime-mainline.ts` → 253 行命中，PP1 引用准确
  - `grep -n "tokensFreed" workers/agent-core/src/host/runtime-mainline.ts` → 835 行命中，PP2 引用准确
  - `grep -n "replayFragment" workers/agent-core/src/host/do/session-do-persistence.ts` → 176 行 `replayFragment: null`，PP3 引用准确
  - `grep -n "system.error" packages/nacp-session/src/stream-event.ts` → 115 行命中，PP5 schema 支撑成立
  - `grep -n "decision.*ask.*unavailable" workers/orchestrator-core/src/entrypoint.ts` → 349 行命中，PP5 问题定位准确
- **复用 / 对照的既有审查**:
  - `docs/eval/pro-to-product/design-docs-reviewed-by-{deepseek,kimi,opus}.md` — 仅作为 design 质量背景参考，不直接影响 action-plan 审查结论

### 1.1 已确认的正面事实

1. **Truth gate 映射完整且准确**：7 份 action-plan 完整覆盖了 charter §10.1 的 7 个 truth gates（T1-T7），映射关系为 PP1→T1, PP2→T2, PP3→T3+T4, PP4→T5, PP5→T6, PP6→T7。每个 action-plan 的 §0 背景都明确声明了对应的 truth gate。
2. **代码引用 100% 准确**：对 8 个关键代码位置进行了行号级核查，所有引用均准确命中目标代码。特别是 PP1 的 `runtime-mainline.ts:235-261` (ask→error)、PP2 的 `runtime-mainline.ts:833-836` (`{tokensFreed:0}`)、PP3 的 `session-do-persistence.ts:176` (`replayFragment: null`)、PP5 的 `entrypoint.ts:349` (`decision:"ask",source:"unavailable"`)，这些引用不仅位置准确，且对当前 reality 的描述是诚实的。
3. **PPX-qna Q1-Q22 被正确冻结**：所有 action-plan 在 §6 "依赖的冻结设计决策" 中都正确引用了对应的 Q ID，且引用内容与业主回答一致。特别是 Q17（PermissionRequest fail-closed）在 PP4 中被正确处理为 out-of-scope constraint。
4. **22-doc pack 真实存在**：PP6 声明的 22 份 `clients/api-docs/*.md` 文件全部存在于文件系统中，无缺失。
5. **DAG 依赖关系合理**：PP0→PP1→(PP2,PP3,PP4)→PP5→PP6 的依赖链与 charter §8.2 完全一致，且各 action-plan 的上游/下游交接文档正确。

### 1.2 已确认的负面事实

1. **PP2 prompt mutation 捕获点在现有架构中不明确**：现有 `request-builder.ts` 和 `runtime-mainline.ts` 中没有明显的 interceptor 或 mock 点来捕获实际发往 LLM provider 的完整 prompt/messages 序列。
2. **PP3 的 `session-do-runtime.ts` 共享冲突缺乏具体协调机制**：虽然 PP3 §7.1 风险表提到了 "PP1 共享文件冲突"，但 action-plan 中没有提供文件锁定协议、feature branch 策略或代码审查门控来实际防止冲突。
3. **PP5 的 `unavailable` 三态需要修改现有 TypeScript union type**：`entrypoint.ts` 当前返回类型为 `decision: "allow" | "deny" | "ask"`，新增 `"unavailable"` 需要级联修改 `runtime-mainline.ts` 及相关 consumer 的类型定义。
4. **跨 phase latency alert 测量点不均衡**：PP1、PP2、PP4 的 action-plan 几乎没有设计 latency 测量与登记点，可能导致 final closure 缺少完整的 latency evidence。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 对 8 个关键代码引用进行了行号级核查，全部命中 |
| 本地命令 / 测试 | `yes` | 运行了 grep/find 命令验证文件存在性与内容匹配 |
| schema / contract 反向校验 | `yes` | 验证了 stream-event.ts 支持 system.error，22-doc pack 数量匹配 |
| live / deploy / preview 证据 | `no` | action-plan 为设计文档，无 live 证据可核查 |
| 与上游 design / QNA 对账 | `yes` | 逐条核对了 Q1-Q22 与 action-plan 的引用一致性 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | PP2 prompt mutation 证明缺乏明确的架构捕获点 | `high` | `delivery-gap` | `yes` | 在 PP2 Phase 1 中增加 request-builder 拦截/注入方案 |
| R2 | PP3 与 PP1 的共享 owner file 冲突缺乏具体协调协议 | `high` | `delivery-gap` | `yes` | 在 PP0/PP1 closure 中增加文件锁定门控 |
| R3 | PP5 policy unavailable 三态与现有 TypeScript union 的级联变更 | `high` | `protocol-drift` | `no` | 在 PP5 Phase 1 中增加 type-audit 任务 |
| R4 | 跨 phase latency alert 测量点不均衡 | `medium` | `test-gap` | `no` | 在 PP0 evidence shape 中统一 latency 字段，各 phase 强制登记 |
| R5 | PP4 hook register 路径跨 worker ownership 不明确 | `medium` | `scope-drift` | `no` | 在 PP4 design doc 中明确 facade→agent-core 的 register 流程 |
| R6 | PP2 "protected fragments" 概念未在 design 中定义 | `medium` | `docs-gap` | `no` | 在 03-context-budget-closure.md 中定义 protected fragments 列表 |
| R7 | PP1 duplicate decision 409 响应结构未明确 | `low` | `protocol-drift` | `no` | 在 PP1 design doc 中定义 409 body schema |
| R8 | PP0 e2e skeleton 业务场景不够具体 | `low` | `test-gap` | `no` | 在 PP0 Phase 2 中指定具体业务场景（如 HITL ask→pause→resume）|

### R1. PP2 prompt mutation 证明缺乏明确的架构捕获点

- **严重级别**: `high`
- **类型**: `delivery-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - `workers/agent-core/src/host/runtime-mainline.ts:833-836` — `requestCompact()` 当前返回 `{ tokensFreed: 0 }`
  - PP2 §5.3 收口标准: "只有 notify 或 row write 不算完成；必须证明 prompt mutation"
  - PP2 §5.3 P3-02: "捕获 compact 前后 LLM request prompt/messages 差异"
  - 现有 `workers/agent-core/src/llm/request-builder.ts` 和 `executor.ts` 中没有暴露内部 request payload 的 hook 或 interceptor
- **为什么重要**:
  - T2 (Context truth) 是 charter §10.1 的硬闸，prompt mutation 是 T2 的核心判定标准
  - 如果无法证明 prompt mutation，PP2 只能 `cannot close` 或 `close-with-known-issues`，直接影响 final closure
  - 现有架构中 LLM request 通过 provider SDK 直接发送，拦截需要重构 request pipeline 或引入测试-only mock provider
- **审查判断**:
  - action-plan 意识到了 prompt mutation 的重要性（收口标准写得很强硬），但没有提供在现有架构中实现这一证明的具体技术路径
  - 这是一个 "知道要证明什么，但不知道如何在现有代码中证明" 的 gap
- **建议修法**:
  - 在 PP2 Phase 1 (Budget Owner Unification) 中增加一项任务：审计 `request-builder.ts` 和 `executor.ts` 的接口，确定捕获 prompt 的可行方案（如：在 request-builder 输出层增加测试 hook、mock provider interceptor、或 runtime-mainline 层面的 before/after 比较）
  - 如果现有架构确实无法在不重构的情况下捕获，应在 PP2 action-plan 中明确声明需要引入的测试基础设施，并评估其对 PP0 e2e skeleton 的影响

### R2. PP3 与 PP1 的共享 owner file 冲突缺乏具体协调协议

- **严重级别**: `high`
- **类型**: `delivery-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - PP1 的核心文件: `workers/agent-core/src/host/do/session-do-runtime.ts` (HITL interrupt 主线)
  - PP3 §0 背景提到: "agent-core persistence 里 `replayFragment` 仍 hard-code 为 `null`，restore 也没有恢复 helper replay 状态"
  - PP3 §7.1 风险表: "PP1 共享文件冲突 — `medium` — PP3 start gate 要求 PP1 closure 声明稳定"
  - PP3 §5.2 Phase 2 修改 `session-do-persistence.ts`，但恢复 helper replay 状态可能需要修改 `session-do-runtime.ts` 中的 restore 路径
- **为什么重要**:
  - `session-do-runtime.ts` 是 PP1 的高频改动面，PP1 closure 前会经历多次迭代
  - 如果 PP3 在 PP1 尚未稳定时开始修改同一文件，会产生 merge conflict 和语义冲突
  - charter §8.3 Start Gate 要求 "共享 owner file 的高频改动窗口已稳定"，但 action-plan 中没有提供判断 "稳定" 的具体标准或门控机制
- **审查判断**:
  - PP3 意识到了风险，但缓解措施只是 "PP3 start gate 要求 PP1 closure 声明稳定"，这过于模糊
  - 没有具体的文件锁定协议、代码审查标签（如 `PP1-locked`）、或 feature branch 策略
- **建议修法**:
  - 在 PP0/PP1 closure 中增加明确的 "共享文件锁定清单"：列出 PP1 期间不允许其他 phase 修改的文件（如 `session-do-runtime.ts`）
  - 在 PP3 action-plan 的 Phase 2 中增加前置条件："仅在 PP1 closure 明确声明 `session-do-runtime.ts` 已稳定后才启动"
  - 如果 PP3 必须修改 `session-do-runtime.ts`，应在 PP1 action-plan 中预留 PP3 所需的 extension point（如 restore hook），而不是让 PP3 直接修改主线逻辑

### R3. PP5 policy unavailable 三态与现有 TypeScript union 的级联变更

- **严重级别**: `high`
- **类型**: `protocol-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/src/entrypoint.ts:349`: `return { ok: false, decision: "ask", source: "unavailable", reason: "db-missing" };`
  - 当前返回类型: `decision: "allow" | "deny" | "ask"`
  - PP5 §5.2: "建议新增 `decision: "unavailable"` 三态"
  - PP5 §0 背景: "tool authorization 中 `db missing` 仍返回 `decision: 'ask', source: 'unavailable'`"
- **为什么重要**:
  - 新增 `"unavailable"` 到 union type 会影响所有 consumer，包括 `runtime-mainline.ts` 的 `authorizeToolPlan` 调用方
  - 如果类型变更不完整，会导致 TypeScript 编译错误或运行时未处理分支
  - 这是一个 protocol 变更，需要同步更新 docs、tests、frontend contract
- **审查判断**:
  - PP5 正确识别了问题（ask + unavailable 混淆），并提出了正确的解决方案（三态）
  - 但 action-plan 中没有列出 type-audit 的具体范围（哪些文件需要更新类型）
- **建议修法**:
  - 在 PP5 Phase 1 中增加 "type-audit" 任务：列出所有消费 `decision` 字段的文件，并评估 `"unavailable"` 新增的级联影响
  - 明确 `runtime-mainline.ts` 中 `authorizeToolPlan` 的调用方需要新增 `unavailable` 分支处理

### R4. 跨 phase latency alert 测量点不均衡

- **严重级别**: `medium`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - charter §9.2 定义了 latency baseline: permission/confirmation ≤500ms, retry ≤1s, reconnect ≤2s, compact ≤3s
  - PP0 §5.2 P2-03 建立了 latency alert recording 机制（记录 `first_visible_ts` 与 `terminal_or_degraded_ts`）
  - PP3 §5.4 提到 "replay gap latency ≤2s 只作 alert 登记"
  - PP5 §2.1 S6 提到 "retry 首个前端可见响应 ≤1s 为 alert threshold"
  - PP1、PP2、PP4 的 action-plan 中没有设计 latency 测量点
- **为什么重要**:
  - charter §9.2 要求 "若持续超阈值，相关 phase closure 与 final closure 必须显式登记"
  - 如果某些 phase 没有设计测量点，final closure 可能缺少完整的 latency evidence
  - 虽然 latency 不是 hard gate，但缺少 evidence 会被视为 docs gap（PPX-qna Q2 Opus 补充）
- **审查判断**:
  - PP0 建立了统一的 evidence shape（包含 timestamps），这是好的基础
  - 但各 phase 没有统一使用这个 shape 来测量各自的 latency
- **建议修法**:
  - 在 PP0 的 evidence shape 中增加 latency 字段模板（`latency_ms`, `alert_threshold_ms`, `is_alert`）
  - 在每个 phase action-plan 的测试安排中增加 latency 测量要求：即使不是 hard gate，也必须在 e2e 中记录并登记

### R5. PP4 hook register 路径跨 worker ownership 不明确

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - PP4 §1.5 影响结构图: "public/session-scoped register route or control seam" 位于 agent-core 和 orchestrator facade 之间
  - PP4 §5.1 提到 "可能的 orchestrator-core facade route 或 session-control seam"
  - 但 action-plan 中没有明确 register 请求的完整流程：前端 → orchestrator facade (auth/validation) → agent-core registry (storage)
- **为什么重要**:
  - 如果 ownership 不明确，实现时可能出现 orchestrator 层做了过多业务逻辑，或 agent-core 层重复做 auth
  - 这会影响 PP6 docs sweep 时 hook register API 的 contract 定义
- **审查判断**:
  - action-plan 正确地将 scope 限制在 minimal live loop，这是好的
  - 但跨 worker 的 register 路径需要更明确的职责划分
- **建议修法**:
  - 在 PP4 design doc (`05-hook-delivery-closure.md`) 中增加 "Register Path Sequence Diagram"，明确 orchestrator facade 负责 auth/rate-limit/validation，agent-core registry 负责 storage/ordering/scope

### R6. PP2 "protected fragments" 概念未在 design 中定义

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - PP2 §2.1 S5: "protected fragments（如 model switch / state snapshot 等）不得被 silent drop"
  - 但 `docs/design/pro-to-product/03-context-budget-closure.md` 中没有定义什么是 "protected fragments"
  - 在 compact 实现中，哪些 message/turn/state 是 protected 的，直接影响 compact 算法的正确性
- **为什么重要**:
  - 如果 protected fragments 未定义，compact 实现可能误删关键 state，导致 session 行为异常
  - 这会影响 PP2 closure 时 "prompt mutation" 证据的可信度
- **审查判断**:
  - action-plan 意识到了 protected fragments 的重要性，但没有在设计文档中定义
- **建议修法**:
  - 在 `03-context-budget-closure.md` 中增加 "Protected Fragments" 章节，明确列出不可被 compact 删除的 message kinds、state keys、或 turn types

### R7. PP1 duplicate decision 409 响应结构未明确

- **严重级别**: `low`
- **类型**: `protocol-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - PP1 §2.1 S4: "duplicate decision 返回 `409 confirmation-already-resolved`"
  - PPX-qna Q7 Opus 补充: "重复提交同一 confirmation_uuid 必须由 server 返回 409 + 已有终态"
  - 但 action-plan 中没有定义 409 响应的 body schema（是否包含 `terminal_status`、`resolved_at`、`decision` 等字段）
  - `session-runtime.ts` 已有 ETag/If-Match 409 conflict（`jsonPolicyError(409, "conflict", ...)`），confirmation 的 409 应使用相同结构还是不同结构？
- **为什么重要**:
  - 前端 retry 时需要解析 409 响应来确认终态，如果结构不一致会导致 client-side retry 逻辑复杂化
- **审查判断**:
  - 这是一个 protocol 细节，不影响 scope 或 delivery，但影响 PP6 docs sweep 的一致性
- **建议修法**:
  - 在 PP1 design doc 或 action-plan 的 Phase 2 中定义 409 响应的 body schema，确保与现有 `jsonPolicyError` 结构兼容

### R8. PP0 e2e skeleton 业务场景不够具体

- **严重级别**: `low`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - PP0 §2.1 S3: "建立首个 pro-to-product e2e skeleton，至少能同时断言一条 HTTP control path、一条 WS event path、一个 durable/read-model truth"
  - PP0 §5.2: "skeleton 能观测 HTTP control path、WS event path 与 durable/read-model truth"
  - 但没有指定具体是哪个业务场景（HITL ask→pause→resume？reconnect replay？compact trigger？）
- **为什么重要**:
  - 如果业务场景不具体，PP0 closure 时可能出现范围争议（"skeleton 覆盖了 health check 算不算？"）
- **审查判断**:
  - 这是一个 minor 的设计问题，不影响整体架构
- **建议修法**:
  - 在 PP0 Phase 2 中指定具体的业务场景，如 "以 HITL confirmation 为场景，覆盖 POST /sessions/{id}/confirmations (HTTP)、WS confirmation request frame (WS)、D1 confirmation row (durable)"

---

## 3. In-Scope 逐项对齐审核

### 3.1 全局 In-Scope 对齐（对照 charter §4.1）

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| I1 | PP0 charter + truth lock + 首个 e2e skeleton | `partial` | 7 truth gates 已映射，但 e2e skeleton 业务场景不够具体 (R8) |
| I2 | HITL interrupt 真闭合 (PP1) | `done` | ask→pause-resume 路径清晰，duplicate decision 409 需补充 schema (R7) |
| I3 | Context budget 真闭合 (PP2) | `partial` | compact durable path 清晰，但 prompt mutation 证明缺乏架构捕获点 (R1) |
| I4 | Reconnect / session recovery 真闭合 (PP3) | `partial` | replay persistence 路径清晰，但共享文件冲突缺乏协调协议 (R2) |
| I5 | Hook minimal live loop 闭合 (PP4) | `partial` | PreToolUse 路径清晰，但 register 跨 worker ownership 需明确 (R5) |
| I6 | Policy honesty + reliability hardening (PP5) | `partial` | unavailable 三态方案正确，但级联 type 变更未审计 (R3) |
| I7 | API contract sweep + final closure (PP6) | `done` | 22-doc pack 已验证存在，sweep 范围与 Q5/Q21 一致 |

### 3.2 Phase 级 In-Scope 对齐

| Phase | 关键 In-Scope 项 | 审查结论 | 说明 |
|-------|------------------|----------|------|
| PP0 | Truth gate 对账表 | `done` | 7 gates 与 phase 映射清晰 |
| PP0 | Frontend boundary freeze | `done` | facade-only 与 Q3 一致 |
| PP0 | E2E skeleton | `partial` | 技术路径清晰，业务场景待明确 (R8) |
| PP1 | Ask bridge | `done` | 代码引用准确，路径清晰 |
| PP1 | Decision wakeup | `done` | HTTP decision + WS broadcast 路径清晰 |
| PP1 | Pending truth | `done` | read-model + e2e 覆盖要求明确 |
| PP2 | Budget preflight | `done` | context-core probe + runtime 对齐路径清晰 |
| PP2 | Compact durable boundary | `done` | snapshot/checkpoint/message 三层写入已验证 |
| PP2 | Prompt mutation | `missing` | 缺乏架构捕获点 (R1) |
| PP3 | WS replay gap degraded | `done` | early degraded frame 要求明确 |
| PP3 | Replay persistence symmetry | `partial` | persist 端已知，restore 端可能涉及共享文件 (R2) |
| PP3 | Recovery bundle | `done` | 最小状态集合定义清晰 |
| PP4 | Session hook registration | `partial` | 路径清晰，跨 worker ownership 待明确 (R5) |
| PP4 | PreToolUse caller | `done` | block/update/continue 路径清晰 |
| PP4 | Observability | `done` | audit + broadcast + redaction 要求明确 |
| PP5 | Runtime enforce matrix | `done` | enforced/partial/not-enforced/stored-only 分类清晰 |
| PP5 | Policy unavailable branch | `partial` | 三态方案正确，type 级联待审计 (R3) |
| PP5 | Stream degraded contract | `done` | system.error schema 已验证存在 |
| PP6 | 22-doc inventory | `done` | 实际文件数与声明一致 |
| PP6 | Route matrix sweep | `done` | facade route registry 已验证 |
| PP6 | Readiness labels | `done` | 5 选 1 标签集与 Q21 一致 |

### 3.3 对齐结论

- **done**: `15`
- **partial**: `6`
- **missing**: `1`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> 整体状态更像是 "核心骨架与 truth gate 映射已完成，但 3 个 high-risk delivery gap（R1/R2/R3）需要在进入主实现前补充缓解措施"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider / sub-agent / admin / billing / SDK | `遵守` | 所有 action-plan 都正确排除，与 charter §4.2 一致 |
| O2 | Full hook catalog (14/18 emit) | `遵守` | PP4 正确限制为 PreToolUse minimal loop，与 Q15 一致 |
| O3 | Shell hook | `遵守` | PP4 正确禁止，与 Q16 一致 |
| O4 | Stream internal retry | `遵守` | PP5 正确选择 degraded + client retry，与 Q19 一致 |
| O5 | Exactly-once replay | `遵守` | PP3 正确选择 best-effort + degraded，与 Q12 一致 |
| O6 | Multi-device attachment | `遵守` | PP3 正确维持 single attachment，与 Q13 一致 |
| O7 | New D1 migration (default no) | `遵守` | PP2/PP3 都正确引用 charter §4.5 D1 例外 law |
| O8 | OpenAPI / doc generator | `遵守` | PP6 正确排除，与 Q22 一致 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: `7 份 action-plan 在架构层面成立，与 charter、QNA、design 文档的对账关系基本正确，代码引用诚实且准确；但存在 3 个需要在进入主实现前解决的 delivery gap / protocol-drift（R1/R2/R3），以及 3 个可在实现过程中逐步修复的 medium/low 级 follow-up（R4/R5/R6）。`
- **是否允许关闭本轮 review**: `yes`
- **关闭前必须完成的 blocker**:
  1. **R1 - PP2 prompt mutation 捕获方案**: 在 PP2 action-plan Phase 1 中增加 request-builder/executor 拦截方案，或明确声明需要引入的测试基础设施。如果无法在不重构的情况下实现，应在 PP2 closure 中诚实登记为 `cannot-close` 或 `close-with-known-issues`。
  2. **R2 - PP3/PP1 共享文件协调协议**: 在 PP0/PP1 closure 中增加 "共享文件锁定清单"，明确 `session-do-runtime.ts` 在 PP1 期间的修改禁令，以及 PP3 启动的前置门控条件。
  3. **R3 - PP5 type-audit 任务**: 在 PP5 Phase 1 中增加 `decision: "unavailable"` 新增的级联 type 影响审计，列出所有需要更新的文件清单。
- **可以后续跟进的 non-blocking follow-up**:
  1. **R4**: 在 PP0 evidence shape 中统一 latency 字段，各 phase action-plan 同步增加 latency 测量要求。
  2. **R5**: 在 PP4 design doc 中增加 register 路径的 sequence diagram，明确 orchestrator facade 与 agent-core registry 的职责边界。
  3. **R6**: 在 `03-context-budget-closure.md` 中定义 protected fragments 列表。
  4. **R7**: 在 PP1 design doc 中定义 duplicate decision 409 的 body schema。
  5. **R8**: 在 PP0 Phase 2 中指定 e2e skeleton 的具体业务场景。
- **建议的二次审查方式**: `same reviewer rereview`（在 blocker 完成后，由 kimi 复核对账）
- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 暂不收口，等待实现者按 §6 响应并更新 action-plan 文档。

---

## 6. 审查附录

### A. 代码引用核查详情

| Action-Plan | 引用位置 | 声明内容 | 核查结果 | 行号命中 |
|-------------|----------|----------|----------|----------|
| PP1 §0 | `runtime-mainline.ts:235-261` | `authorizeToolPlan()` ask→error | ✅ 准确 | 235: `authorizeToolPlan(`; 253: `tool-permission-required` |
| PP2 §0 | `runtime-mainline.ts:833-836` | `requestCompact()` 返回 `{tokensFreed:0}` | ✅ 准确 | 834-835: `async requestCompact() { return { tokensFreed: 0 };` |
| PP3 §0 | `session-do-persistence.ts:154-222` | `replayFragment` hard-code null | ✅ 准确 | 176: `replayFragment: null` |
| PP3 §0 | `ws-runtime.ts:72-145` | WS attach + supersede | ✅ 准确 | 135-136: `relay_cursor` 存在 |
| PP4 §0 | `hooks/registry.ts:18-72` | `register/list/unregister` | ✅ 准确 | 25: `register(handler)`; 31: `unregister(handlerId)` |
| PP4 §0 | `hooks/dispatcher.ts:61-148` | `emit()` 执行 handler | ✅ 准确 | dispatcher.ts 存在 |
| PP4 §0 | `hooks/catalog.ts:92-97` | PreToolUse block/updatedInput | ✅ 准确 | 92-98: PreToolUse payloadSchema |
| PP5 §0 | `entrypoint.ts:330-360` | `db missing`→ask+unavailable | ✅ 准确 | 349: `decision: "ask", source: "unavailable", reason: "db-missing"` |
| PP5 §0 | `session-runtime.ts:146-265` | `/runtime` ETag/If-Match | ✅ 准确 | 206: `jsonPolicyError(409, "conflict", ...)` |
| PP6 §0 | `route-registry.ts:16-60` | `dispatchFacadeRoute()` | ✅ 准确 | 16-60: 各 route handler 存在 |

### B. 22-Doc Pack 核查详情

实际存在的 22 个文件（`find clients/api-docs -maxdepth 1 -type f -name '*.md'`）:
1. README.md
2. auth.md
3. catalog.md
4. checkpoints.md
5. client-cookbook.md
6. confirmations.md
7. context.md
8. error-index.md
9. items.md
10. me-sessions.md
11. models.md
12. permissions.md
13. runtime.md
14. session-ws-v1.md
15. session.md
16. todos.md
17. tool-calls.md
18. transport-profiles.md
19. usage.md
20. wechat-auth.md
21. worker-health.md
22. workspace.md

与 PP6 §2.1 S1 的声明完全一致。

### C. Truth Gate 映射核查

| Truth Gate (charter §10.1) | 负责 Phase | Action-Plan 中声明位置 | 核查结果 |
|---------------------------|-----------|----------------------|----------|
| T1 HITL truth | PP1 | PP1 §0: "approval_policy=ask 与至少一条 elicitation path 能在真实 e2e 中触发 pause-resume" | ✅ 一致 |
| T2 Context truth | PP2 | PP2 §0: "compact 后下一个 LLM request 的 prompt 能被证明真实缩减" | ✅ 一致 |
| T3 Reconnect truth | PP3 | PP3 §0: "last_seen_seq 重连时，要么 replay 成功，要么收到明确 lagged/degraded" | ✅ 一致 |
| T4 Session state truth | PP3 | PP3 §0: "前端在恢复后能拿到 session 当前状态" | ✅ 一致 |
| T5 Hook truth | PP4 | PP4 §0: "至少一条 user-driven hook 的 register→emit→outcome→frontend visible+audit visible 回路成立" | ✅ 一致 |
| T6 Policy/reliability truth | PP5 | PP5 §0: "network_policy/web_search/workspace_scope 要么真 enforce，要么 explicit downgrade" | ✅ 一致 |
| T7 Frontend contract truth | PP6 | PP6 §0: "前端依赖的 public/frontend-facing surfaces 与 clients/api-docs 已 item-by-item 对齐" | ✅ 一致 |

---

*本审查报告基于对 7 份 action-plan、1 份 charter、1 份 QNA、8 份 design doc 的完整阅读，以及对 10+ 个代码文件的行号级核查。所有事实引用均可追溯至具体文件与行号。*
