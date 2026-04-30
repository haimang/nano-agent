# Nano-Agent 行动计划 — HP3 Context State Machine

> 服务业务簇: `hero-to-pro / HP3`
> 计划对象: `把当前 stub 化的 context endpoints、零散 prompt assembly 与 compact 能力收敛成可探测、可压缩、可恢复、可由模型元数据驱动的上下文状态机`
> 类型: `modify + runtime + control-plane + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `workers/context-core/src/index.ts`
> - `workers/context-core/src/context-assembler.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `packages/nacp-session/src/stream-event.ts`
> - `workers/context-core/test/**`
> - `workers/agent-core/test/**`
> - `workers/orchestrator-core/test/**`
> - `test/cross-e2e/**`
> - `docs/issue/hero-to-pro/HP3-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.4 HP3
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP3-context-state-machine.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q10-Q12（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP3 是 hero-to-pro 的 context control plane first wave。当前仓库已经有 context 相关零件，但还没有一台真正的“上下文状态机”：`context-core` 对外暴露的 `getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact` 仍全部返回 `phase: "stub"`；`ContextAssembler` 已冻结 canonical layer ordering；agent-core 的 runtime 已有 `contextProvider` seam、system prompt 注入与 request build 主线；`compact.notify` 也已经是正式 stream kind。问题不在“完全没有能力”，而在这些能力还没有被收束成统一的 probe / layers / preview / job / auto-compact / strip-recover 真相。

因此 HP3 的任务是把现有 stub surface 和 runtime seam 升级为产品级 context state machine：让 context probe、cross-turn history、boundary snapshot、manual compact preview/job、auto-compact budget 与 `compact.notify` 全部围绕同一 truth 工作。与此同时，Q10-Q12 已冻结三条关键法律：prompt owner 在 agent-core runtime、compact 必须保护 `<model_switch>` / `<state_snapshot>` 并 strip-then-recover、manual compact 必须区分 preview 与 durable job。

- **服务业务簇**：`hero-to-pro / HP3`
- **计划对象**：`hero-to-pro 的上下文状态机与 compact control plane`
- **本次计划解决的问题**：
  - `context-core` 三个 RPC 当前仍只返回 stub，占位形状无法代表真实 session context。
  - agent-core runtime 还没有单一的 cross-turn context manager，contextProvider 仍偏 quota / anchor seam，而不是 prompt owner。
  - compact 还没有 model-aware budget、manual preview/job 分离、strip-recover contract 与 durable result handle。
- **本次计划的直接产出**：
  - `probe` / `layers` / `compact/preview` / `compact` / `compact/jobs/{id}` 五个 surface 与 context-core RPC 解 stub。
  - agent-core 内的 `CrossTurnContextManager`、auto-compact、strip-then-recover、`compact.notify` 共享语义。
  - 长对话 cross-e2e、circuit breaker 验证与 `docs/issue/hero-to-pro/HP3-closure.md`。
- **本计划不重新讨论的设计结论**：
  - prompt owner 放在 agent-core runtime，context-core 只做 inspection / control plane（来源：`docs/design/hero-to-pro/HPX-qna.md` Q10）。
  - compact 必须保护 `<model_switch>` / `<state_snapshot>` 并采用 strip-then-recover；受保护片段 enum 第一版只含这两类（来源：`docs/design/hero-to-pro/HPX-qna.md` Q11）。
  - manual compact 必须区分 preview 与 durable job；preview 只读，job handle 第一版复用 `compact_boundary` checkpoint UUID，并支持 60s 同 high-watermark preview cache 与 `would_create_job_template` hint（来源：`docs/design/hero-to-pro/HPX-qna.md` Q12）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP3 采用**先重做 façade/context-core surface → 再在 agent-core 内接入单一 `CrossTurnContextManager` → 再落 auto-compact / preview / job / strip-recover → 最后补长对话 e2e 与 closure** 的顺序。先把外部可见 surface 与 control-plane 结构定下来，再把 runtime prompt owner 接上，可以避免实现者同时在两个 worker 各写一套 context truth；而把 compact 的真正执行逻辑放在 surface 与 cross-turn manager 之后，则能确保 preview、probe、stream event 与后续 prompt 看到的是同一份状态。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Surface Refactor + RPC Destub | M | 把当前 `/context` 三入口升级为五个 product-facing surface，并让 context-core 解 stub | `-` |
| Phase 2 | CrossTurnContextManager Wiring | M | 在 agent-core 内建立单一 prompt owner，统一 recent transcript、boundary snapshot、workspace layers | Phase 1 |
| Phase 3 | Auto-Compact + Manual Preview/Job | M | 接入 model-aware budget、preview/job 分离、checkpoint-backed durable handle | Phase 1-2 |
| Phase 4 | Strip-Recover + Circuit Breaker | S | 冻结受保护片段 contract，并让 compact 失败 3 次后 fail-loud | Phase 2-3 |
| Phase 5 | E2E + Closure | S | 用长对话与跨模型窗口场景证明 probe / stream / prompt 三层一致 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Surface Refactor + RPC Destub**
   - **核心目标**：把 context surface 从 coarse `/context` 三件套升级成 product-facing 五件套，并让 context-core 真正返回有意义的结果。
   - **为什么先做**：没有 product surface，后续 runtime compact 即使能跑，也仍然是黑盒行为。
2. **Phase 2 — CrossTurnContextManager Wiring**
   - **核心目标**：让 agent-core runtime 成为 context prompt owner。
   - **为什么放在这里**：Q10 已冻结 owner 在 agent-core；只有 owner 定了，probe/preview/job 才能围绕同一真相。
3. **Phase 3 — Auto-Compact + Manual Preview/Job**
   - **核心目标**：把 budget、preview、job handle、checkpoint-backed result 全部接到统一 compact 流程。
   - **为什么放在这里**：它依赖 Phase 1 的 surface 和 Phase 2 的 prompt owner。
4. **Phase 4 — Strip-Recover + Circuit Breaker**
   - **核心目标**：确保 compact 不吞掉控制片段，且失败时不会无限自动重试。
   - **为什么放在这里**：必须建立在 compact 主链已经存在之后。
5. **Phase 5 — E2E + Closure**
   - **核心目标**：证明同一 session 的 probe、stream event、下次 prompt 组装结果三者一致。
   - **为什么最后**：只有 compact、preview、job、probe 都已落地，e2e 才有意义。

### 1.4 执行策略说明

- **执行顺序原则**：先 surface 后 owner、先 owner 后 compact、先 contract 后优化。
- **风险控制原则**：不把 restore/file revert/multi-session memory 吸进 HP3；若依赖 HP1 schema truth 缺失，只能走 HP1 correction，而不是临时造 compact 专表。
- **测试推进原则**：context-core / agent-core / orchestrator-core 单测之外，必须有长对话 cross-e2e，覆盖 131K / 24K 不同窗口、cross-turn recall、compact failure。
- **文档同步原则**：closure 必须同时记录 probe、preview/job、stream event、下次 prompt 组装四层证据。
- **回滚 / 降级原则**：compact 连续失败 3 次后必须 fail-loud，禁止静默继续裁历史或无限重试。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP3 context state machine
├── Phase 1: Surface Refactor + RPC Destub
│   ├── workers/orchestrator-core/src/index.ts
│   └── workers/context-core/src/index.ts
├── Phase 2: CrossTurnContextManager Wiring
│   ├── workers/agent-core/src/host/do/session-do/runtime-assembly.ts
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   └── workers/context-core/src/context-assembler.ts
├── Phase 3: Auto-Compact + Manual Preview/Job
│   ├── compact preview
│   ├── compact boundary checkpoint handle
│   └── compact/jobs/{id}
├── Phase 4: Strip-Recover + Circuit Breaker
│   ├── protected fragment enum
│   └── compact.notify + error surface
└── Phase 5: E2E + Closure
    ├── test/cross-e2e/**
    └── docs/issue/hero-to-pro/HP3-closure.md
```

### 1.6 已核对的当前代码锚点

1. **context-core 三个 RPC 目前全部是 stub**
   - `workers/context-core/src/index.ts:123-202`
   - `getContextSnapshot()`、`triggerContextSnapshot()`、`triggerCompact()` 都显式返回 `phase: "stub"`。
2. **已有 canonical layer ordering，不应再造第二套 assembler**
   - `workers/context-core/src/context-assembler.ts:1-168`
   - `CANONICAL_LAYER_ORDER = system → session → workspace_summary → artifact_summary → recent_transcript → injected` 已冻结。
3. **façade 当前只暴露 coarse `/context` 三件套**
   - `workers/orchestrator-core/src/index.ts:1432-1508`
   - 目前还是 `GET /sessions/{uuid}/context`、`POST /context/snapshot`、`POST /context/compact`，且直接映射到 stub RPC。
4. **runtime 已有 contextProvider seam，但还不是 cross-turn state machine**
   - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:130-137`
   - `workers/agent-core/src/host/runtime-mainline.ts:117-136,167-177,239-304`
   - runtime 现有 `contextProvider` 与 request build 主线还没有 recent transcript / boundary snapshot / compact manager。
5. **`compact.notify` 已是正式 stream kind**
   - `packages/nacp-session/src/stream-event.ts:52-57,81-107`
   - HP3 应复用这条正式事件，而不是另造临时 compact event 名。
6. **外部 precedent 已核对并支持 HP3 的 compact / reinject 分层策略**
   - `context/codex/codex-rs/core/src/codex.rs:3948-3985`, `context/codex/codex-rs/core/tests/suite/compact.rs:132-142`, `context/claude-code/services/compact/sessionMemoryCompact.ts:45-61,188-230,232-259`, `context/claude-code/services/compact/microCompact.ts:40-50,164-205`, `context/gemini-cli/packages/core/src/context/contextCompressionService.ts:50-59,108-160,223-255`, `context/gemini-cli/packages/core/src/context/contextManager.ts:74-117,152-169`
   - precedent 共同说明 compact / reinject / render 必须分层，且 `<model_switch>` 与 protected recent window 需要显式保护；HP3 吸收 contract 与 layering，不照抄外部具体 token 策略。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `probe` / `layers` / `compact/preview` / `compact` / `compact/jobs/{id}` 五个 surface。
- **[S2]** agent-core 内的 `CrossTurnContextManager`，统一 recent transcript、boundary snapshot、workspace layers 与 model-aware budget。
- **[S3]** auto-compact、manual compact preview/job、checkpoint-backed durable handle。
- **[S4]** `<model_switch>` / `<state_snapshot>` strip-then-recover contract、3 次失败 circuit breaker。
- **[S5]** 长对话 e2e、cross-turn recall、不同上下文窗口模型行为验证。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** checkpoint restore / files-only restore / file revert / fork。
- **[O2]** provider-specific prompt template engine。
- **[O3]** 多 session 共享 context memory。
- **[O4]** 新建 `nano_compact_jobs` 或其它脱离 HP1 freeze 的 compact schema。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| prompt owner 放在 context-core | `out-of-scope` | Q10 已冻结 owner 在 agent-core runtime | 除非未来重新开 QNA |
| manual compact preview 写 durable job | `out-of-scope` | Q12 明确 preview 只读，不污染 durable truth | 若 preview/commit contract 被正式修订 |
| compact 结果另建 `nano_compact_jobs` | `out-of-scope` | Q12 已冻结 job handle 复用 `compact_boundary` checkpoint UUID | 若 HP1 correction 正式开新 schema |
| 受保护片段扩张 | `defer / depends-on-HPX` | Q11 第一版只含 `<model_switch>` / `<state_snapshot>` | HPX 治理 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | façade context surface refactor | `update` | `workers/orchestrator-core/src/index.ts` | 把 coarse `/context` 三件套升级为五个 product-facing surface | `medium` |
| P1-02 | Phase 1 | context-core RPC destub | `update` | `workers/context-core/src/index.ts` | 让 probe/snapshot/compact 不再返回 `phase: "stub"` | `high` |
| P2-01 | Phase 2 | `CrossTurnContextManager` | `add` | agent-core host/runtime modules | 让 agent-core 成为唯一 prompt owner | `high` |
| P2-02 | Phase 2 | assembler contract reuse | `update` | `workers/context-core/src/context-assembler.ts`, shared types | 让 probe API 与真实 prompt 共享同一层次契约 | `medium` |
| P3-01 | Phase 3 | model-aware auto-compact | `update` | runtime compact path | 让 compact 阈值由 `effective_context_pct * context_window` 驱动 | `high` |
| P3-02 | Phase 3 | manual compact preview/job | `update` | façade + context-core + runtime | 让 preview 与 durable job 明确分离 | `medium` |
| P4-01 | Phase 4 | strip-then-recover contract | `update` | compact delegate / prompt assembly | 让 compact 不破坏 `<model_switch>` / `<state_snapshot>` 语义 | `high` |
| P4-02 | Phase 4 | circuit breaker | `update` | compact runtime / error path | 连续 3 次 compact 失败后 fail-loud | `medium` |
| P5-01 | Phase 5 | long-conversation e2e | `add` | `test/cross-e2e/**` | 用不同窗口模型与长对话验证 probe/compact/prompt 一致 | `medium` |
| P5-02 | Phase 5 | HP3 closure | `update` | `docs/issue/hero-to-pro/HP3-closure.md` | 让 HP4/HP9 可直接消费 HP3 结果 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Surface Refactor + RPC Destub

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | façade context surface refactor | 将当前 coarse `/sessions/{id}/context` 三件套重构为 `probe`、`layers`、`compact/preview`、`compact`、`compact/jobs/{id}`；必要时可短期保留兼容映射，但最终 product surface 以细分路由为准 | `workers/orchestrator-core/src/index.ts` | context API 不再黑盒 | orchestrator-core test | 五个 surface 路由与 auth/team scope 正确 |
| P1-02 | context-core RPC destub | 把 `getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact` 从 stub 升级为真实读取 session / D1 / assembler / compact state 的 control-plane 接口 | `workers/context-core/src/index.ts` | context-core 返回真实 probe/preview/job 数据 | context-core test | 不再出现 `phase: "stub"` 返回值 |

### 4.2 Phase 2 — CrossTurnContextManager Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | `CrossTurnContextManager` | 在 agent-core 内建立单一 manager：读取 recent durable history、latest boundary snapshot、workspace layers、model metadata，并产出规范化 LLM prompt | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`, `workers/agent-core/src/host/runtime-mainline.ts`, new host context manager module | prompt owner 从 seam 升级为状态机 | agent-core test | turn2 稳定记住 turn1 durable truth |
| P2-02 | assembler contract reuse | 让 context-core probe API 与 agent-core `CrossTurnContextManager` 共享 `ContextAssembler` 的 canonical layer ordering / nacp-session 类型契约，禁止双写 layer 顺序 | `workers/context-core/src/context-assembler.ts` + shared types | inspection 与真实 prompt 不再漂移 | unit/integration tests | probe/layers 返回的 order 与 prompt assembly 一致 |

### 4.3 Phase 3 — Auto-Compact + Manual Preview/Job

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | model-aware auto-compact | 用 `effective_context_pct * context_window` 与 `auto_compact_token_limit` 驱动 compact 阈值，不再硬编码 32K | runtime-mainline + model metadata consumption | 131K 与 24K 模型 compact 行为不同且可解释 | agent-core/context-core tests | budget law 与 model metadata 一致 |
| P3-02 | manual compact preview/job | `preview` 只读返回 `budget/estimated_tokens/need_compact/latest_boundary/protected_recent_turns/layers/would_create_job_template`，同 session + 同 high-watermark 60s 内复用 in-memory cache；真实 `compact` 写 `checkpoint_kind = compact_boundary` 的 checkpoint，并以该 `checkpoint_uuid` 直接作为 `job_id`；`/compact/jobs/{id}` 读取 checkpoint + `compact.notify` 投影，严禁新建 `nano_compact_jobs`（承接 HP1 `P4-01`） | façade + context-core + runtime | compact 成为可解释、可追踪操作 | orchestrator/context-core/agent-core tests | preview 不写 summary；job 可跨 worker 重读 |

### 4.4 Phase 4 — Strip-Recover + Circuit Breaker

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | strip-then-recover contract | compact 前 strip `<model_switch>` / `<state_snapshot>`；compact 成功后按“原 prompt 相对位置 + boundary metadata 配对”恢复 | compact delegate / prompt assembly | compact 不再污染控制语义 | targeted tests + prompt verification | 受保护片段 enum 第一版仅含两类，recover 顺序稳定 |
| P4-02 | circuit breaker | compact 连续失败 3 次后停止自动重试并明确 surface error；不得静默继续裁历史 | runtime compact path | 长对话失败时 fail-loud | runtime/error tests | 3 次失败后 breaker 生效且错误可见 |

### 4.5 Phase 5 — E2E + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | long-conversation e2e | 覆盖 131K 模型 ~118K 自动 compact、24K 模型 ~22K 自动 compact、cross-turn recall、layer probe、compact fail breaker 至少 5 场景；建议文件名使用 `context-auto-compact-131k` / `context-auto-compact-24k` / `context-cross-turn-recall` / `context-layer-probe` / `context-breaker-fail-loud` 描述性前缀；若采用编号文件，必须为 HP5 预留 `15-18` | `test/cross-e2e/**` | 长对话与多窗口模型行为可审计 | `pnpm test:cross-e2e` | 5+ e2e 全绿，且 probe / stream / prompt 一致 |
| P5-02 | HP3 closure | 回填 probe/layers verdict、preview/job verdict、stream event verdict、next-prompt verdict，并显式登记 F1-F17 chronic status（`closed / partial / not-touched / handed-to-platform`） | `docs/issue/hero-to-pro/HP3-closure.md` | HP4/HP9 能直接消费 HP3 结果 | doc review | closure 能独立回答“context state machine 是否已经成型” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Surface Refactor + RPC Destub

- **Phase 目标**：把 context control plane 从 placeholder surface 变成真实产品面。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/context-core/src/index.ts`
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/src/index.ts:1432-1508`
  - `workers/context-core/src/index.ts:123-202`
- **具体功能预期**：
  1. façade 已能区分 probe、layers、preview、compact、jobs 五类操作。
  2. context-core 不再返回 `phase: "stub"`。
  3. ended/expired session 仍可读 probe/layers，但不可再发起 compact。
- **具体测试安排**：
  - **单测**：orchestrator-core route tests、context-core RPC tests。
  - **集成测试**：façade auth → service binding RPC → JSON shape 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/context-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - 五个 surface 的职责边界清晰。
  - context-core 与 façade 的 JSON shape 都不再出现 stub 占位字段。
- **本 Phase 风险提醒**：
  - 如果 surface 仍沿用 coarse `/context` 三件套，后续 preview/job/layers 会继续挤在一条模糊接口上。

### 5.2 Phase 2 — CrossTurnContextManager Wiring

- **Phase 目标**：让 agent-core runtime 成为唯一 prompt owner。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/context-core/src/context-assembler.ts`
  - 新的 agent-core context manager 模块
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:130-137`
  - `workers/agent-core/src/host/runtime-mainline.ts:117-136,167-177,239-304`
  - `workers/context-core/src/context-assembler.ts:1-168`
- **具体功能预期**：
  1. `CrossTurnContextManager` 负责 recent transcript、boundary snapshot、workspace layers 与 model metadata 的合成。
  2. context-core probe/layers 看到的 layer ordering 与 runtime prompt 看到的 ordering 完全一致。
  3. boundary snapshot 缺失时允许走 full recent transcript path。
- **具体测试安排**：
  - **单测**：agent-core context manager tests、assembler contract tests。
  - **集成测试**：cross-turn recall 与 layer ordering 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/context-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - turn2 能稳定回答 turn1 durable truth，不再依赖偶然窗口残留。
  - prompt owner 只在 agent-core，不在 context-core 再复制一份 prompt assembler。
- **本 Phase 风险提醒**：
  - 如果 inspection 与 prompt owner 仍各有一套 layer-ordering，实现完成后会立即出现 probe 与真实 prompt 漂移。

### 5.3 Phase 3 — Auto-Compact + Manual Preview/Job

- **Phase 目标**：把 compact 从黑盒动作变成 model-aware、可预演、可追踪的 control plane。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 修改文件**：
  - façade / context-core compact handlers
  - runtime compact path
  - 可能涉及 checkpoint-backed read model 的组装代码
- **具体功能预期**：
  1. auto-compact 阈值按 model metadata 驱动，而不是固定 32K。
  2. preview 只读，返回 `would_create_job_template` 与 60s cache 命中语义。
  3. 真实 compact 写 `compact_boundary` checkpoint，并以该 UUID 作为 `job_id`。
- **具体测试安排**：
  - **单测**：budget/policy tests、preview cache tests、job projection tests。
  - **集成测试**：checkpoint-backed compact job read model。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/context-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - preview 不写 summary、不创建 job row。
  - `/compact/jobs/{id}` 可跨 worker 重读，并与 `compact_boundary` checkpoint truth 对齐。
- **本 Phase 风险提醒**：
  - 若 HP1 checkpoint/confirmation truth 缺口暴露，HP3 不能私下新建 compact 专表；只能回到 HP1 correction law。

### 5.4 Phase 4 — Strip-Recover + Circuit Breaker

- **Phase 目标**：保护控制语义并防止无限自动重试。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 修改文件**：
  - compact delegate / runtime path
  - 可能涉及 protected fragment helper 与 error surface
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-session/src/stream-event.ts:52-57`
  - `workers/agent-core/src/host/runtime-mainline.ts:239-304`
- **具体功能预期**：
  1. `<model_switch>` / `<state_snapshot>` 不参与摘要正文，但 compact 后会稳定恢复。
  2. compact 连续失败 3 次后触发 breaker，并对 client / ops 可见。
  3. `compact.notify` 成为 manual/auto compact 共享事件，而不是只服务某一支路。
- **具体测试安排**：
  - **单测**：protected fragment strip/recover tests、breaker tests。
  - **集成测试**：compact.notify + prompt recovery 对撞。
  - **回归测试**：受影响 worker test 矩阵。
  - **手动验证**：确认三次失败后停止自动重试。
- **收口标准**：
  - strip/recover 合同稳定，recover 顺序不漂移。
  - breaker 生效时不是 silent degrade，而是 fail-loud。
- **本 Phase 风险提醒**：
  - compact 最容易“看起来成功但语义悄悄丢失”；必须把受保护片段当 contract，不当实现细节。

### 5.5 Phase 5 — E2E + Closure

- **Phase 目标**：证明同一 session 的 probe、stream event、下次 prompt 组装三者一致。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `test/cross-e2e/**`（新增 5+ 场景）
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP3-closure.md`
- **具体功能预期**：
  1. 131K 与 24K 模型在相近上下文密度下会触发不同 compact 阈值。
  2. 长对话 cross-turn recall、probe/layers、preview/job、breaker 都有 e2e 证据。
- **具体测试安排**：
  - **单测**：无新增单测为主。
  - **集成测试**：façade + context-core + agent-core 跨 worker 组合。
  - **回归测试**：
    - `pnpm test:cross-e2e`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/context-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：closure 对照 e2e 结果回填。
- **收口标准**：
  - 5+ e2e 全绿。
  - closure 能独立解释“context state machine 是否已经成型，以及还欠什么不属于 HP3 的内容”。
- **本 Phase 风险提醒**：
  - 如果只看 endpoint 200，不核对下次 prompt 是否真的使用了 compact 结果，HP3 会出现典型 deceptive closure。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q10 — prompt owner 在 agent-core runtime | `docs/design/hero-to-pro/HPX-qna.md` | 决定 `CrossTurnContextManager` 落在 agent-core，context-core 只做 inspection/control plane | 若未来想迁 owner，必须重开 QNA |
| Q11 — compact 必须 strip-then-recover | `docs/design/hero-to-pro/HPX-qna.md` | 决定 compact delegate 不能把 `<model_switch>` / `<state_snapshot>` 并入摘要正文 | 若想变更 protected fragment enum，进入 HPX 治理 |
| Q12 — preview 与 durable job 分离 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 preview 不写 summary/job，真实 compact 复用 `compact_boundary` checkpoint UUID | 若未来改 schema，新 truth 仍须回到 HP1 correction |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP1 truth 依赖 | compact durable handle 依赖 HP1 checkpoint/confirmation truth | `high` | HP3 不私加表；缺口只能走 HP1 correction |
| token estimation 误差 | 中文与工具结果体积估算可能偏差较大 | `high` | 使用保守预算、记录 estimated vs actual，并以 e2e 约束误差上界 |
| probe 与 prompt 漂移 | context-core 与 agent-core 若各写一套 layer 顺序，会立即分裂 | `high` | 强制共享 `ContextAssembler` / nacp-session 契约 |
| compact 无限重试 | 长对话失败时如果无 breaker，会持续消耗资源并制造更多错误 | `medium` | 3 次失败 breaker + surface error |

### 7.2 约束与前提

- **技术前提**：HP2 已冻结 `<model_switch>` 语义；HP1 已提供 checkpoint / confirmation / model metadata truth。
- **运行时前提**：compact.notify 继续使用现有正式 stream kind；context prompt owner 不迁移到 context-core。
- **组织协作前提**：preview/job 分离、strip-recover、agent-core owner 三条 QNA 不重开。
- **上线 / 合并前提**：probe、preview/job、stream event、next-prompt 四层证据完整，且长对话 e2e 通过。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`（如 HP3 最终 compact boundary contract 对 HP4 consumer 有明确补充）
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP3-closure.md`
- 需要同步更新的测试说明：
  - `test/index.md` 或相关 worker test README（若新增 context e2e 入口说明）

### 7.4 完成后的预期状态

1. context 不再是黑盒：client 可以 probe / preview / compact / read job / inspect layers。
2. agent-core 会拥有唯一的 cross-turn prompt owner，长对话不会再只靠偶然窗口幸存。
3. compact 将由模型元数据真实驱动，不同窗口模型会出现不同阈值行为。
4. HP4 以后消费到的 conversation boundary 将第一次有稳定 durable footing。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 context-core 三个 RPC 不再返回 `phase: "stub"`。
  - 检查 façade 已暴露五个细分 context surface。
- **单元测试**：
  - `pnpm --filter @haimang/context-core-worker typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
- **集成测试**：
  - façade → context-core → agent-core 跨 worker 组合；probe/layers 与 next prompt 对撞
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`
- **回归测试**：
  - 131K ~118K 自动 compact、24K ~22K 自动 compact、cross-turn recall、layer probe、compact fail breaker 至少 5 场景
- **前序 phase 回归**：
  - 至少回归 HP2 的 `<model_switch>` 注入 / fallback 语义，确认 HP3 strip-then-recover 不会把 HP2 冻结的模型语义打断。
- **文档校验**：
  - `docs/issue/hero-to-pro/HP3-closure.md` 必须同时写明 probe / preview-job / stream / next-prompt 四层 verdict
  - `docs/issue/hero-to-pro/HP3-closure.md` 必须显式登记 F1-F17 chronic status

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. façade 五个 context surface 与 context-core RPC 均已 live，且不再返回 stub。
2. `CrossTurnContextManager` 已成为唯一 prompt owner，probe/layers 与真实 prompt 不漂移。
3. auto-compact 由 model metadata 驱动，manual compact 支持 preview 与 durable job 分离。
4. strip-recover 与 breaker 生效，长对话 cross-e2e 5+ 场景全绿。
5. HP3 closure 已显式声明 F1-F17 的 phase 状态，并把 compact job truth 与 HP1 freeze 的连接写清。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | context probe / layers / preview / compact / jobs 与 cross-turn manager 已完整闭环 |
| 测试 | context-core / agent-core / orchestrator-core 测试通过，cross-e2e 覆盖 5+ 长对话场景 |
| 文档 | HP3 closure 能独立解释 probe、job、stream、prompt 四层结果 |
| 风险收敛 | compact 不再是黑盒，不再无限重试，不再吞掉控制片段 |
| 可交付性 | HP4 能直接消费 HP3 的 boundary snapshot 与 compact contract 继续推进 |
