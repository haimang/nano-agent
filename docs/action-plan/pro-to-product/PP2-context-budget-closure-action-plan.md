# Nano-Agent 行动计划

> 服务业务簇: `pro-to-product / PP2 — Context Budget Closure`
> 计划对象: `把 token preflight、manual compact、runtime compact bridge、prompt mutation 与 overflow degrade 接成真实 context budget loop`
> 类型: `modify`
> 作者: `GPT-5.5`
> 时间: `2026-05-03`
> 文件位置: `docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
> 上游前序 / closure:
> - `docs/action-plan/pro-to-product/PP1-hitl-interrupt-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP1-closure.md`
> - `docs/design/pro-to-product/03-context-budget-closure.md`
> 下游交接:
> - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
> - `docs/action-plan/pro-to-product/PP5-policy-reliability-hardening-action-plan.md`
> - `docs/action-plan/pro-to-product/PP6-api-contract-docs-closure-action-plan.md`
> - `docs/issue/pro-to-product/PP2-closure.md`
> 关联设计 / 调研文档:
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> - `docs/design/pro-to-product/PPX-qna.md` Q9-Q11
> 冻结决策来源:
> - `docs/design/pro-to-product/PPX-qna.md` Q9（不新增 compact jobs 表，复用 checkpoint / compact lineage）
> - `docs/design/pro-to-product/PPX-qna.md` Q10（auto compact 未 live 前不得写成 live；准确 readiness label 为 registry-only）
> - `docs/design/pro-to-product/PPX-qna.md` Q11（PP2 closure 不以 LLM summary 为前提）
> 文档状态: `draft`

---

## 0. 执行背景与目标

PP2 要解决的不是“摘要质量”问题，而是长会话预算真相问题：runtime 发 LLM request 前是否能知道将要超窗、manual compact 是否真的写 durable boundary、compact 后下一次 prompt 是否真实缩减、失败时前端是否得到 explicit degraded，而不是 provider error 或 `{ tokensFreed: 0 }` 假成功。

当前代码已经有可复用 substrate：`context-core` 的 `resolveBudget()` 会基于模型窗口与 usage 算出 `needCompact`（`workers/context-core/src/control-plane.ts:176-198`），manual compact 会通过 `triggerCompact()` 写入 orchestrator compact boundary（`workers/context-core/src/index.ts:308-370`），orchestrator 会写 `nano_conversation_context_snapshots`、`nano_session_checkpoints` 与 `compact.notify` stream-event（`workers/orchestrator-core/src/context-control-plane.ts:394-511`）。但 agent-core runtime 仍有硬断点：`requestCompact()` 只返回 `{ tokensFreed: 0 }`（`workers/agent-core/src/host/runtime-mainline.ts:833-836`），无法证明 prompt mutation。参考上，Claude Code 在 query loop 中先取 compact boundary 后做 tool result budget / snip / microcompact（`context/claude-code/query.ts:365-420`），Codex compact task 会发布包含 context window 的 turn started，并在超窗时发送 error event（`context/codex/codex-rs/core/src/compact.rs:91-103`, `214-229`），Gemini 将错误结构化为 stream event（`context/gemini-cli/packages/core/src/core/turn.ts:360-404`）。

- **服务业务簇**：`pro-to-product / PP2 — Context Budget Closure`
- **计划对象**：`runtime budget preflight + compact durable truth + prompt mutation evidence`
- **本次计划解决的问题**：
  - probe/context-core 与 agent-core runtime budget owner 分叉，UI 可能认为需要 compact，但 runtime 继续超窗。
  - manual compact substrate 已能写 durable boundary，但 action loop 尚未证明 compact 后 prompt 真实变化。
  - auto compact 未接线前容易被 docs/closure 写成 live，造成 fake-live contract。
- **本次计划的直接产出**：
  - agent-core request-builder / runtime preflight 接入统一 budget truth。
  - runtime compact bridge 替换 `{ tokensFreed: 0 }`，并能证明下一次 LLM request prompt 缩减或 explicit degraded。
  - `docs/issue/pro-to-product/PP2-closure.md`，登记 compact evidence、readiness label 与 deterministic summary limitation。
- **本计划不重新讨论的设计结论**：
  - 不新增 compact jobs 专用表；复用 snapshot/checkpoint/message lineage，并校验 `snapshot_kind` / `checkpoint_kind` 区分（来源：`PPX-qna.md` Q9）。
  - auto compact 未 live 前必须标为 `registry-only`，不得写成 live（来源：`PPX-qna.md` Q10）。
  - PP2 first-wave 不以 LLM summary 为硬前提；deterministic summary limitation 必须诚实登记（来源：`PPX-qna.md` Q11）。

---

## 1. 执行综述

### 1.1 总体执行方式

PP2 采用 **先统一 budget owner，再闭合 manual compact durable path，最后接 agent runtime bridge** 的方式。先确保 probe、docs 与 runtime 都读同一套 budget 计算；再验证 compact boundary 的 durable 写入和分类；最后把 agent-core LLM 前 preflight / compact / prompt mutation 接通，并用 e2e 证明不是只发 notify 或返回 0。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Budget Owner Unification | `M` | 统一 context-core probe 与 agent-core runtime preflight 的 budget truth | `PP1 closure` |
| Phase 2 | Manual Compact Durable Boundary | `M` | 校验 `/context/compact` 写 snapshot/checkpoint/message，并区分 compact/checkpoint lineage | `Phase 1` |
| Phase 3 | Runtime Compact Bridge & Prompt Mutation | `L` | 替换 agent-core no-op compact，证明 compact 后 prompt 真实缩减或 explicit degraded | `Phase 2` |
| Phase 4 | Docs Honesty & Closure Evidence | `S` | 标注 auto compact readiness、deterministic limitation，并输出 PP2 closure/e2e | `Phase 3` |

### 1.3 Phase 说明

1. **Phase 1 — Budget Owner Unification**
   - **核心目标**：让 runtime preflight 使用与 context-core probe 相同的 model window / usage / threshold 语义。
   - **为什么先做**：如果 budget owner 分叉，后续 compact 成功也无法证明前端看到的风险与 runtime 行为一致。
2. **Phase 2 — Manual Compact Durable Boundary**
   - **核心目标**：确认 manual compact 写入 snapshot/checkpoint/message 三层 durable truth，并能被读取/分类。
   - **为什么放在这里**：Q9 禁止新 jobs 表，所以现有 lineage 必须足以承载 PP2 truth。
3. **Phase 3 — Runtime Compact Bridge & Prompt Mutation**
   - **核心目标**：替换 `{ tokensFreed: 0 }`，在 LLM request 前触发 compact 或返回 explicit degraded。
   - **为什么放在这里**：这是 charter T2 的硬闸；只有 durable boundary 不代表 agent prompt 真变。
4. **Phase 4 — Docs Honesty & Closure Evidence**
   - **核心目标**：把 live / registry-only / degraded / limitation 写入 closure，为 PP6 docs sweep 提供事实。
   - **为什么放在最后**：docs 必须写代码事实，而不是预期行为。

### 1.4 执行策略说明

- **执行顺序原则**：budget helper → durable compact → runtime bridge → evidence/docs。
- **风险控制原则**：不新增 D1 表；如确需 schema 例外，必须满足 charter D1 exception law 并从 migration `018` 起顺延。
- **测试推进原则**：先测 budget/compact helper，再测 context-core/orchestrator compact route，最后测 agent-core prompt mutation 与 cross-e2e。
- **文档同步原则**：PP2 只做 context-related minimum docs truth；full pack sweep 留给 PP6。
- **回滚 / 降级原则**：compact failed/blocked 必须是 explicit degraded，不得伪造成成功；如果只做到 degraded 而无法 prompt mutation，PP2 不能 full close。

### 1.5 本次 action-plan 影响结构图

```text
PP2 Context Budget Closure
├── Phase 1: Budget Owner Unification
│   ├── workers/context-core/src/control-plane.ts
│   ├── workers/agent-core/src/llm/request-builder.ts
│   └── shared budget helper（若需要抽取）
├── Phase 2: Manual Compact Durable Boundary
│   ├── workers/context-core/src/index.ts
│   ├── workers/orchestrator-core/src/context-control-plane.ts
│   └── compact snapshot/checkpoint/message tests
├── Phase 3: Runtime Compact Bridge & Prompt Mutation
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   ├── workers/agent-core/src/kernel/runner.ts
│   └── agent-core LLM request tests
└── Phase 4: Docs Honesty & Closure Evidence
    ├── clients/api-docs/context.md（必要最小同步）
    └── docs/issue/pro-to-product/PP2-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** runtime LLM request 前执行 budget preflight，使用模型窗口、response reserve、usage 与 compact threshold。
- **[S2]** manual compact route 真写 durable compact boundary，并可读取 `tokens_before/tokens_after`、`snapshot_kind`、`checkpoint_kind`。
- **[S3]** agent-core `requestCompact()` no-op 被替换为真实 bridge 或 explicit degraded path。
- **[S4]** compact 后下一次 request 的 prompt mutation 可被测试证明，不只看 `compact.notify`。
- **[S5]** protected fragments（如 model switch / state snapshot 等）不得被 silent drop。
- **[S6]** auto compact 未接线前在 closure/docs 中标 `registry-only`；接线后再按代码事实升级。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 不引入 LLM-based summary 作为 PP2 closure 前提。
- **[O2]** 不新增 compact jobs 专用 D1 表。
- **[O3]** 不做完整 long-term memory / semantic memory / prompt optimizer。
- **[O4]** 不修 replay restore；compact boundary 的 replay 消费交给 PP3。
- **[O5]** 不把 `context_compact` confirmation kind 接成 HITL 主线；当前仍按 registry-only/phase-specific caller 处理。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| runtime budget preflight | `in-scope` | charter T2 要求 LLM request 前能识别预算风险 | 无；PP2 必做 |
| manual compact durable write | `in-scope` | 已有 substrate，必须证明 live | 无 |
| auto compact | `in-scope as honesty` | 未 live 不得 overclaim | 若 PP2 实现真实 caller，可升级为 live |
| deterministic summary | `in-scope first-wave limitation` | Q11 允许 first-wave，但要标 limitation | 若 owner 要求 LLM summary，需新 scope |
| preview cache 60s | `out-of-scope` | 设计已标 first wave 不做 | PP6 docs 标注即可 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Budget helper audit/extract | `update` | `workers/context-core/src/control-plane.ts`, possible shared helper | 防止 probe/runtime 使用两套预算算法 | `medium` |
| P1-02 | Phase 1 | Agent runtime preflight | `update` | `workers/agent-core/src/llm/request-builder.ts`, `runtime-mainline.ts` | LLM invoke 前识别 needCompact/overflow | `high` |
| P2-01 | Phase 2 | Compact boundary write verification | `update` | `context-core`, `orchestrator-core/context-control-plane.ts` | manual compact 真实写 durable lineage | `medium` |
| P2-02 | Phase 2 | Lineage classification | `update` | compact read job/tests | compact 与 checkpoint 可区分 | `medium` |
| P3-01 | Phase 3 | Replace no-op `requestCompact()` | `update` | `runtime-mainline.ts` | 不再返回 `{ tokensFreed: 0 }` 假成功 | `high` |
| P3-02 | Phase 3 | Prompt mutation proof | `add` | agent-core tests/e2e | 证明 compact 后下一次 prompt 变短 | `high` |
| P3-03 | Phase 3 | Overflow degraded contract | `add` | runtime/degraded path | compact 失败/blocked 可前端处理 | `medium` |
| P4-01 | Phase 4 | Context docs truth sync | `update` | `clients/api-docs/context.md` | auto/manual readiness 诚实标注 | `low` |
| P4-02 | Phase 4 | PP2 closure | `add` | `docs/issue/pro-to-product/PP2-closure.md` | 登记 T2 truth 与 limitations | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Budget Owner Unification

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Budget helper audit/extract | 审计 `resolveBudget()` 与 runtime request-builder，必要时抽共享 helper | context-core / agent-core | probe 与 runtime 同语义 | unit tests | 同一输入得到同一 needCompact/headroom |
| P1-02 | Agent runtime preflight | 在 LLM request 前执行 budget 判断，输出 needCompact/overflow/degraded 决策 | `request-builder.ts`, `runtime-mainline.ts` | 不再等 provider 超窗后失败 | agent-core tests | 超阈值前能触发 compact/degraded |

### 4.2 Phase 2 — Manual Compact Durable Boundary

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Compact boundary write verification | 覆盖 `triggerCompact()` → `commitContextCompact()` → snapshot/checkpoint/message 写入 | context-core / orchestrator-core | manual compact 是 durable operation | worker tests | 三层记录齐全，`compact.notify` 可读 |
| P2-02 | Lineage classification | 校验 `snapshot_kind='compact-boundary'` 与 `checkpoint_kind='compact_boundary'` 可被 PP6/docs 区分 | compact read path/tests | compact 不与普通 checkpoint 混淆 | tests | read job 返回可分类信息 |

### 4.3 Phase 3 — Runtime Compact Bridge & Prompt Mutation

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Replace no-op `requestCompact()` | 把 `{ tokensFreed: 0 }` 替换为真实 compact bridge 或 explicit degraded | `runtime-mainline.ts` | runtime 不再伪成功 | agent-core tests | no-op 不存在于 live compact path |
| P3-02 | Prompt mutation proof | 捕获 compact 前后 LLM request prompt/messages 差异 | request-builder/runtime tests | compact 后 prompt 真实缩减 | integration/e2e | evidence 含 tokens_before/after 与 request diff |
| P3-03 | Overflow degraded contract | compact failed/blocked/not-needed/overflow 分别输出明确状态 | runtime/degraded path | 前端不收到 undocumented provider error | tests/e2e | 每种失败可文档化 |

### 4.4 Phase 4 — Docs Honesty & Closure Evidence

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Context docs truth sync | 最小同步 manual/auto compact readiness label 与 degraded behavior | `clients/api-docs/context.md` | 不再 overclaim auto compact | docs consistency | label 与代码事实一致 |
| P4-02 | PP2 closure | 输出 compact truth、prompt mutation、latency alert、deterministic limitation | `PP2-closure.md` | PP5/PP6 可消费事实 | docs review | T2 gate verdict 诚实 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Budget Owner Unification

- **Phase 目标**：消除 probe/runtime budget 分叉。
- **本 Phase 对应编号**：`P1-01`, `P1-02`
- **本 Phase 新增文件**：
  - 可能的 shared budget helper test。
- **本 Phase 修改文件**：
  - `workers/context-core/src/control-plane.ts`
  - `workers/agent-core/src/llm/request-builder.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
- **具体功能预期**：
  1. runtime preflight 使用 model `context_window`、`effective_context_pct`、`auto_compact_token_limit` 与 response reserve。
  2. usage/headroom/needCompact 与 context-core probe 一致。
- **具体测试安排**：
  - **单测**：budget helper threshold cases。
  - **集成测试**：agent-core request-builder preflight。
  - **回归测试**：`pnpm --filter @haimang/context-core-worker test`, `pnpm --filter @haimang/agent-core-worker test`。
  - **手动验证**：同一 session 的 probe 与 runtime evidence 不冲突。
- **收口标准**：
  - no model row/default profile 行为明确。
  - response reserve 不被忽略。
- **本 Phase 风险提醒**：
  - token estimate 可以近似，但不能无纪律地乐观低估。

### 5.2 Phase 2 — Manual Compact Durable Boundary

- **Phase 目标**：证明 `/context/compact` 是 durable operation。
- **本 Phase 对应编号**：`P2-01`, `P2-02`
- **本 Phase 新增文件**：
  - compact boundary targeted tests。
- **本 Phase 修改文件**：
  - `workers/context-core/src/index.ts`
  - `workers/orchestrator-core/src/context-control-plane.ts`
  - 相关 tests。
- **具体功能预期**：
  1. compact 写 snapshot/checkpoint/message 三层记录。
  2. `tokens_before/tokens_after`、protected fragments、compacted/kept message count 可读取。
  3. session inactive/detached/active 的行为清晰：active/detached 可处理，其他 blocked。
- **具体测试安排**：
  - **单测**：build compact input。
  - **集成测试**：D1 compact write/read。
  - **回归测试**：context-core + orchestrator-core tests。
  - **手动验证**：PP6 可用 `snapshot_kind/checkpoint_kind` 区分 docs label。
- **收口标准**：
  - 不新增 compact jobs 表。
  - durable lineage 能支撑 reconnect/docs 查询。
- **本 Phase 风险提醒**：
  - 如果 classification 不清，PP6 会无法解释 compact vs checkpoint。

### 5.3 Phase 3 — Runtime Compact Bridge & Prompt Mutation

- **Phase 目标**：让 compact 真影响 agent LLM request。
- **本 Phase 对应编号**：`P3-01`, `P3-02`, `P3-03`
- **本 Phase 新增文件**：
  - prompt mutation / overflow degraded tests。
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/src/kernel/runner.ts`
  - `workers/agent-core/src/llm/request-builder.ts`
- **具体功能预期**：
  1. `requestCompact()` 返回真实 `tokensFreed > 0` 或 explicit failure/degraded，不再固定 0。
  2. compact 成功后下一次 LLM request 的 message set / prompt token estimate 真实降低。
  3. compact blocked/failed/overflow 都能形成 frontend-visible degraded contract。
- **具体测试安排**：
  - **单测**：requestCompact bridge result mapping。
  - **集成测试**：compact before LLM invoke。
  - **回归测试**：agent-core tests。
  - **端到端**：长对话触发 needCompact，观察 prompt mutation evidence。
- **收口标准**：
  - 只有 notify 或 row write 不算完成；必须证明 prompt mutation。
  - 如果做不到 prompt mutation，只能 `cannot close` 或 charter amendment。
- **本 Phase 风险提醒**：
  - deterministic summary 可能丢语义；closure 必须写 limitation。

### 5.4 Phase 4 — Docs Honesty & Closure Evidence

- **Phase 目标**：把 PP2 真实完成度交给 PP6。
- **本 Phase 对应编号**：`P4-01`, `P4-02`
- **本 Phase 新增文件**：
  - `docs/issue/pro-to-product/PP2-closure.md`
- **本 Phase 修改文件**：
  - `clients/api-docs/context.md`（必要最小同步）
- **具体功能预期**：
  1. manual compact readiness 与 auto compact readiness 被分开标注。
  2. deterministic summary limitation 与 long-session 风险明确。
  3. compact latency alert 按 PP0 evidence shape 登记。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：docs consistency（如涉及）。
  - **回归测试**：`pnpm run check:docs-consistency`。
  - **手动验证**：closure 中每项 evidence 都能追溯真实代码路径。
- **收口标准**：
  - docs 不写 fake live。
  - PP5/PP6 可基于 PP2 facts 做后续 hardening/docs sweep。
- **本 Phase 风险提醒**：
  - 不要把“registry-only”写成“not implemented”或“live”；readiness label 要精确。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q9 | `PPX-qna.md` Q9 | 不新增 compact jobs 表，复用 checkpoint lineage | 若需要新表，必须 charter/D1 exception amendment |
| Q10 | `PPX-qna.md` Q10 | auto compact 未接线不得写 live，标 registry-only | 若实现 live caller，PP6 按代码事实升级 |
| Q11 | `PPX-qna.md` Q11 | 不以 LLM summary 为 closure 前提 | 若 owner 要求 LLM summary，PP2 scope 需重写 |
| T2 | `plan-pro-to-product.md` §10.1 | prompt mutation 是 Context truth 硬闸 | 做不到则 cannot close |
| D1 exception law | `plan-pro-to-product.md` §4.5 | 默认不新增 D1；若触发从 `018` 起 | 未批准不得迁移 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| prompt mutation 难以证明 | compact 写 durable 但 request-builder 仍读旧 history | `high` | 测试必须捕获下一次 LLM request 输入 |
| token estimate 不准 | 粗估低估导致仍超窗 | `medium` | 保守阈值 + response reserve + degraded |
| deterministic summary 语义退化 | first-wave 非 LLM summary 可能丢上下文 | `medium` | closure 登记 limitation 与实测边界 |
| PP3 replay 依赖 | compact boundary 后续恢复由 PP3 消费 | `medium` | PP2 只保证 durable truth，PP3 保证 replay/recovery |

### 7.2 约束与前提

- **技术前提**：PP1 interrupt substrate 已稳定，避免 context compact confirmation 与 HITL row 语义冲突。
- **运行时前提**：context-core 能通过 orchestrator-core RPC 写 compact boundary。
- **组织协作前提**：frontend 需要知道 manual/auto readiness label 差异。
- **上线 / 合并前提**：不得新增 D1 表；如需 schema 例外必须先冻结。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - 原则上无；若实现改变 Q9-Q11，必须回到 `PPX-qna.md`。
- 需要同步更新的说明文档 / README：
  - `docs/issue/pro-to-product/PP2-closure.md`
  - `clients/api-docs/context.md`（必要最小同步）
- 需要同步更新的测试说明：
  - compact truth e2e evidence 写入 closure。

### 7.4 完成后的预期状态

1. runtime 能在 LLM invoke 前识别 context budget 风险。
2. manual compact 能写 durable boundary，且 PP6 能分类 compact/checkpoint。
3. compact 成功能证明 prompt mutation；失败能返回 explicit degraded。
4. auto compact readiness 不再 overclaim，docs/closure 诚实标注。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `git --no-pager diff --check -- docs/action-plan/pro-to-product/PP2-context-budget-closure-action-plan.md`
- **单元测试**：
  - budget helper threshold tests。
  - requestCompact bridge result mapping tests。
- **集成测试**：
  - context-core triggerCompact + orchestrator compact boundary write/read。
  - agent-core LLM preflight / prompt mutation tests。
- **端到端 / 手动验证**：
  - 长对话触发 needCompact，观察 compact notify、tokens_before/after、下一次 prompt 缩减或 degraded。
- **回归测试**：
  - `pnpm --filter @haimang/context-core-worker test`
  - `pnpm --filter @haimang/orchestrator-core-worker test`
  - `pnpm --filter @haimang/agent-core-worker test`
  - `pnpm test:e2e`（若扩展 e2e）
- **文档校验**：
  - `pnpm run check:docs-consistency`（若改 clients/api-docs）。

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. runtime budget preflight 与 context-core probe 不分叉。
2. manual compact durable boundary 可读、可分类、可追溯。
3. agent-core no-op compact 被替换，且 prompt mutation 有证据。
4. auto compact 与 deterministic summary limitation 在 closure/docs 中诚实登记。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | Context budget loop 能 preflight、compact、mutation、degrade |
| 测试 | budget/compact/runtime/e2e 均有覆盖 |
| 文档 | readiness label 与 limitation 不 overclaim |
| 风险收敛 | 无新 jobs 表、无 fake-live auto compact、无 `{ tokensFreed: 0 }` 假成功 |
| 可交付性 | PP3 可消费 compact boundary，PP6 可消费 docs truth |
