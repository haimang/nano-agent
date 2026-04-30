# Nano-Agent 行动计划 — HP0 Pre-Defer Fixes

> 服务业务簇: `hero-to-pro / HP0`
> 计划对象: `在不改 D1 schema 的前提下，完成 hero-to-pro 开工前的 ingress law repair、model seam 预留、verify-only 基线冻结与 residue cleanup`
> 类型: `modify + test + cleanup`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `packages/nacp-session/src/messages.ts`
> - `workers/orchestrator-core/src/session-lifecycle.ts`
> - `workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts`
> - `workers/orchestrator-core/src/parity-bridge.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `workers/agent-core/wrangler.jsonc`
> - `workers/orchestrator-core/wrangler.jsonc`
> - `workers/orchestrator-core/test/**`
> - `workers/agent-core/test/**`
> - `docs/runbook/zx2-rollback.md`
> - `pnpm-lock.yaml`（仅在 grep 证明确有 stale importer 漂移时触碰）
> - `docs/issue/hero-to-pro/HP0-closure.md`
> 上游前序 / closure:
> - `docs/issue/real-to-hero/RHX2-closure.md`
> - `docs/charter/plan-hero-to-pro.md` §7.1 HP0
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP0-pre-defer-fixes.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q1-Q3（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP0 不是功能扩张 phase，而是 hero-to-pro 的开工闸门。RHX2 收口后，代码已经具备继续前进的基础，但 design review 仍明确留下几类“必须先收”的前置问题：`/start` / `/input` / `/messages` 的模型字段与 body law 还没有完全对齐 hero-to-pro 命名；`withNanoAgentSystemPrompt()` 还没有为 HP1 的 model metadata 留出稳定接缝；`CONTEXT_CORE` / `LANE_E_RPC_FIRST`、archive residue、旧 runbook、lockfile stale importer 这几类 verify-only 或 cleanup 项也还没有形成 closure 级证据。

本计划只消费已经冻结的 QNA / charter / design 结论，不重新开 owner 问题。HP0 的任务是把“可以立刻修完且不会引入 schema 变化”的内容全部做成可验证交付物，并把明确不该在 HP0 强删、强启或强改的 residue 用 closure 法律钉住，交给 HP1/HP8/HP10 后续消费。

- **服务业务簇**：`hero-to-pro / HP0`
- **计划对象**：`hero-to-pro 启动前的 pre-defer 修复与 verify-only 基线冻结`
- **本次计划解决的问题**：
  - `packages/nacp-session` 协议层已经接受 `model_id` / `reasoning`，但 `session-lifecycle.ts` 的 `StartSessionBody` / `FollowupBody` 仍未声明这两个字段，public ingress 的三入口 law 仍然断裂。
  - `session-flow.ts` 的 `forwardStart()` / `handleInput()` 目前没有把 `model_id` / `reasoning` 带到 agent-core；只有 `/messages` 在 `message-runtime.ts` 中完成了格式校验、`requireAllowedModel()` gate 和内部转发。
  - `withNanoAgentSystemPrompt()` 还没有 `modelId?` seam，HP1 的 `base_instructions_suffix` 落表后仍需再改函数边界。
  - verify-only / cleanup 项尚未收口：`CONTEXT_CORE` / `LANE_E_RPC_FIRST` 证据未冻结、`docs/runbook/zx2-rollback.md` 过期、`pnpm-lock.yaml` stale importer 是否残留未判定、`forwardInternalJsonShadow` / parity-bridge 还缺 residue 法律。
- **本次计划的直接产出**：
  - `/start` / `/input` / `/messages` 的字段/body law 修正与回归测试基线。
  - `withNanoAgentSystemPrompt(modelId?)` 的 seam 与 HP0 partial closure 规则。
  - binding-presence verify、archive cleanup、conditional lockfile cleanup、HP0 closure residue ledger。
- **本计划不重新讨论的设计结论**：
  - HP0 **不新增 D1 schema**，只做 ingress law repair、seam 预留、verify-only 与 cleanup（来源：`docs/charter/plan-hero-to-pro.md` §7.1、`docs/design/hero-to-pro/HPX-qna.md` Q1/Q2）。
  - `CONTEXT_CORE` / `LANE_E_RPC_FIRST` 在 HP0 **只 verify 不改 wrangler / 不改 final-state**（来源：`docs/design/hero-to-pro/HPX-qna.md` Q3）。
  - `forwardInternalJsonShadow` / parity-bridge 在 HP0 **禁止强删**，最终 retained-or-delete 决议留给 HP8 / HP10（来源：`docs/design/hero-to-pro/HPX-qna.md` Q3）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP0 采用**先做 residue baseline → 再修 ingress law → 再开 model seam → 最后做 verify-only cleanup 与 closure**的顺序。先把 alias/binding/residue 的当前事实钉住，再改 public ingress，可避免实现者一边修接口一边猜“哪些 residue 本轮该删、哪些只能登记”；同时把 `withNanoAgentSystemPrompt(modelId?)` 放在 ingress 修复之后、HP1 之前，确保函数边界只改一次。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Residue Baseline + Freeze Alignment | XS | 记录 alias / binding / residue 当前事实，建立 HP0 closure 骨架 | `-` |
| Phase 2 | Ingress Model Law Repair | M | 修正 `/start` / `/input` / `/messages` 的模型字段与 body law | Phase 1 |
| Phase 3 | System Prompt Seam | S | 落 `withNanoAgentSystemPrompt(modelId?)` seam，但暂不读取 D1 真字段 | Phase 2 |
| Phase 4 | Verify-Only Gate + Cleanup | S | 完成 binding verify、旧 runbook 删除、conditional lockfile cleanup | Phase 1-3 |
| Phase 5 | Closure + Residue Handoff | XS | 形成 HP0 closure 与 `expires-at: HP1 closure` handoff 法律 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Residue Baseline + Freeze Alignment**
   - **核心目标**：把 HP0 要消费的 frozen 规则、grep baseline 与 closure 骨架先钉住。
   - **为什么先做**：没有 baseline，后面无法证明 alias/residue 真被消化，或哪些只是被“暂时藏起来”。
2. **Phase 2 — Ingress Model Law Repair**
   - **核心目标**：统一 `/start` / `/input` / `/messages` 在 hero-to-pro 下的字段/body 语义。
   - **为什么放在这里**：HP2/HP4 后续所有状态机、checkpoint、context compact 都站在这三个入口之上。
3. **Phase 3 — System Prompt Seam**
   - **核心目标**：把 `withNanoAgentSystemPrompt(modelId?)` 的函数边界先打开。
   - **为什么放在这里**：它依赖 Phase 2 已经把 ingress 端的 `modelId` 透传语义钉稳，但又必须在 HP1 之前完成接缝。
4. **Phase 4 — Verify-Only Gate + Cleanup**
   - **核心目标**：对 Q3 约束逐条给出验证或清理，不偷做超 scope 变更。
   - **为什么放在这里**：只有在代码侧主修复完成后，才能明确哪些 residue 是“已解决”，哪些必须 handoff。
5. **Phase 5 — Closure + Residue Handoff**
   - **核心目标**：把 HP0 的 partial / retained / deferred 写成 closure 规则。
   - **为什么最后**：closure 必须基于已经发生的代码与测试事实，而不是设计倾向。

### 1.4 执行策略说明

- **执行顺序原则**：先证据后修复、先入口后 seam、先 verify-only 再 cleanup。
- **风险控制原则**：不在 HP0 引入任何 schema / enum / state-machine 变化；所有有诱惑“顺手做完”的内容一律回到 boundary table 判断。
- **测试推进原则**：以 orchestrator-core / agent-core 现有测试矩阵承接；新增 case 要直接覆盖三入口 law 与 system prompt seam。
- **文档同步原则**：所有 partial / retained / expires-at 规则统一写入 `docs/issue/hero-to-pro/HP0-closure.md`，不散落在 PR 描述或 commit message。
- **回滚 / 降级原则**：若 ingress 修复与现有 route behavior 冲突，以 Q1 frozen law 为准回退旧行为；若 `pnpm-lock.yaml` 不存在真实漂移，则禁止“顺手重写”。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP0 pre-defer fixes
├── Phase 1: Residue Baseline + Freeze Alignment
│   ├── docs/design/hero-to-pro/HP0-pre-defer-fixes.md（只读消费）
│   └── docs/issue/hero-to-pro/HP0-closure.md
├── Phase 2: Ingress Model Law Repair
│   ├── workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts
│   └── workers/orchestrator-core/test/**/*route.test.ts
├── Phase 3: System Prompt Seam
│   ├── workers/agent-core/src/host/runtime-mainline.ts
│   └── workers/agent-core/test/**
├── Phase 4: Verify-Only Gate + Cleanup
│   ├── docs/runbook/zx2-rollback.md
│   ├── pnpm-lock.yaml（conditional）
│   └── residue grep / binding verify evidence
└── Phase 5: Closure + Residue Handoff
    ├── docs/issue/hero-to-pro/HP0-closure.md
    └── docs/action-plan/hero-to-pro/HP1-action-plan.md
```

### 1.6 已核对的当前代码锚点

1. **协议层已支持目标字段**
   - `packages/nacp-session/src/messages.ts:17-20,43-52,119-136`
   - `SessionStartBodySchema`、`SessionFollowupInputBodySchema`、`SessionMessagePostBodySchema` 已接受 `model_id` 与 `reasoning.effort`，且 `reasoning.effort` 只允许 `low | medium | high`。
2. **public ingress 类型仍未对齐**
   - `workers/orchestrator-core/src/session-lifecycle.ts:41-57`
   - `StartSessionBody` / `FollowupBody` 还没有 `model_id` / `reasoning`，所以 action-plan 的第一落点不是“改 agent-core”，而是先补 ingress body 类型。
3. **`/start` 与 `/input` 当前确实丢字段**
   - `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454`
   - `forwardStart()` 当前只转 `initial_input / initial_context / trace_uuid / authority`；`handleInput()` 只构造 `parts[]` 和上下文字段，没有把 `model_id` / `reasoning` 带进 `handleMessages()`。
4. **`/messages` 已经是 reference implementation**
   - `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310`
   - 这里已经完成 `model_id` 格式校验、`reasoning.effort` 校验、`requireAllowedModel()` gate，以及最终向 agent-core 转发 `model_id` / `reasoning`，HP0 应复用这条 law，而不是再造第二套 validator。
5. **system prompt seam 当前仍是无参 helper**
   - `workers/agent-core/src/host/runtime-mainline.ts:162-177`
   - `withNanoAgentSystemPrompt()` 目前只接受 `messages`，没有 `modelId?`。
6. **verify-only 项在配置层已真实存在**
   - `workers/agent-core/wrangler.jsonc:20-23,44-51,78-87,97-101`
   - `workers/orchestrator-core/wrangler.jsonc:57-63,80-104`
   - `LANE_E_RPC_FIRST=false` 和 `CONTEXT_CORE` binding 在 prod/preview 配置里已经存在，因此 HP0 只做 verify。
7. **R29 residue 当前是 deliberate retain，不是误留 dead code**
   - `workers/orchestrator-core/src/user-do/message-runtime.ts:72-77`
   - `workers/orchestrator-core/src/parity-bridge.ts:5-9,57-63`
   - `forwardInternalJsonShadow` 与 parity helper 仍是被显式保留的诊断/兼容 seam，HP0 不得把它们当普通 dead code 清掉。
8. **外部 precedent 已核对并支持 HP0 只做“显式透传 + seam 占位”**
   - `context/codex/codex-rs/app-server/src/codex_message_processor.rs:7018-7028`, `context/claude-code/utils/model/model.ts:49-98`, `context/claude-code/query.ts:659-670`, `context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-45`, `context/gemini-cli/packages/core/src/config/config.ts:1872-1885`
   - 三家 precedent 共同说明 model / effort 是显式控制输入，不应在 ingress 静默丢失；HP0 只吸收“字段可靠到达状态层”和“system prompt seam 预留”的纪律，不提前展开 HP2 的完整模型状态机。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `/start` / `/input` / `/messages` 的 `model_id` / `reasoning.effort` / body law 对齐。
- **[S2]** `withNanoAgentSystemPrompt(modelId?)` 的函数签名与调用 seam；HP1 前允许 `partial`，但必须可被 closure 追踪。
- **[S3]** `CONTEXT_CORE` / `LANE_E_RPC_FIRST` verify-only 证据、binding-presence test、residue grep baseline。
- **[S4]** `docs/runbook/zx2-rollback.md` 删除、`pnpm-lock.yaml` stale importer 条件式清扫、HP0 closure 回填。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 任何新 D1 表/列/migration、任何 confirmation/checkpoint/workspace durable truth 变更。
- **[O2]** 修改 `wrangler.jsonc` 以启用/切换 `CONTEXT_CORE`、`LANE_E_RPC_FIRST` 或 Lane E final-state。
- **[O3]** 删除 `forwardInternalJsonShadow`、`parity-bridge`、shadow compare 相关 retained seam。
- **[O4]** 客户端文档、checkpoint/revert、context compact、tool workspace、API docs 等后续产品面逻辑。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `pnpm-lock.yaml` stale importer 清理 | `in-scope（conditional）` | Q3 明确允许仅在 grep 证明确有漂移时清理 | grep 结果为 0 时不再重评 |
| `wrangler.jsonc` 新增 / 修改 service binding | `out-of-scope` | HP0 只 verify，不做 wiring policy 变化 | HP3/HP8 若触发 correction |
| `forwardInternalJsonShadow` / parity helper 删除 | `out-of-scope` | Q3 明确保留到 HP8/HP10 决议 | HP8 residue review / HP10 final closure |
| `modelId` seam 的 partial 状态 | `in-scope` | Q2 明确允许先开 seam，但必须带 `expires-at: HP1 closure` | HP1 closure 时强制升级为完整接线 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | residue baseline + closure skeleton | `update` | `docs/issue/hero-to-pro/HP0-closure.md`, grep evidence | 先把 HP0 的 retained / partial / expires-at 法律写成可回填骨架 | `low` |
| P2-01 | Phase 2 | `StartSessionBody` / `FollowupBody` 类型补齐 | `update` | `packages/nacp-session/src/messages.ts`, `workers/orchestrator-core/src/session-lifecycle.ts` | 让 public ingress 类型与协议层 schema 对齐 | `medium` |
| P2-02 | Phase 2 | `/start` / `/input` 透传对齐到 `/messages` law | `update` | `workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts`, route tests | 统一三入口的字段校验、gate 与内部转发语义 | `medium` |
| P3-01 | Phase 3 | `withNanoAgentSystemPrompt(modelId?)` seam | `update` | `workers/agent-core/src/host/runtime-mainline.ts`, agent tests | 先固定函数边界，HP1 后再读真字段 | `medium` |
| P4-01 | Phase 4 | binding-presence verify + residue grep evidence | `add` | `workers/orchestrator-core/test/binding-presence.test.ts`（或同等 verify case）, closure evidence | 形成 `CONTEXT_CORE` / `LANE_E_RPC_FIRST` 当前事实证据 | `low` |
| P4-02 | Phase 4 | 删除过期 rollback runbook | `remove` | `docs/runbook/zx2-rollback.md` | 去掉 ZX2 时代的错误操作指引 | `low` |
| P4-03 | Phase 4 | conditional lockfile drift cleanup | `update` | `pnpm-lock.yaml` | 仅在真实漂移存在时清掉 stale importer | `medium` |
| P5-01 | Phase 5 | HP0 closure + residue handoff | `update` | `docs/issue/hero-to-pro/HP0-closure.md` | 把 HP0 成果与未决 residue 交给 HP1/HP8/HP10 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Residue Baseline + Freeze Alignment

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | residue baseline + closure skeleton | 收集 alias/binding/residue grep baseline；在 HP0 closure 中预建 `partial / retained / expires-at` 台账 | `docs/issue/hero-to-pro/HP0-closure.md`, targeted grep evidence | HP0 不再以口头方式记录 residue | grep + doc review | 至少登记：`modelId seam partial`、`CONTEXT_CORE` verify-only、`LANE_E_RPC_FIRST` verify-only、parity/shadow retained |

### 4.2 Phase 2 — Ingress Model Law Repair

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | `StartSessionBody` / `FollowupBody` 类型补齐 | 以 `packages/nacp-session/src/messages.ts` 为 authoritative schema，对齐 `session-lifecycle.ts` 中 `StartSessionBody` / `FollowupBody`，补入 `model_id` 与 `reasoning` | `packages/nacp-session/src/messages.ts`, `workers/orchestrator-core/src/session-lifecycle.ts` | public ingress 类型不再落后于协议层 | `pnpm --filter @haimang/orchestrator-core-worker test` | `session-lifecycle.ts` 与协议层字段名一致，后续 runtime 不再靠 `Record<string, unknown>` 隐式吞字段 |
| P2-02 | `/start` / `/input` 透传对齐到 `/messages` law | 以 `message-runtime.ts` 为单一 law reference：`/start` 在 `forwardStart()` 时带上 `model_id` / `reasoning`，`/input` 在转 `handleMessages()` 时不再丢这两个字段，并沿用 `requireAllowedModel()` gate 语义 | `workers/orchestrator-core/src/user-do/{session-flow,message-runtime}.ts`, route tests | 三入口的成功/失败行为与 agent-core 入参语义统一 | 同上 | 非法 `model_id` 返回 400，非法 `reasoning.effort` 返回 400，合法字段都能到达 agent-core |

### 4.3 Phase 3 — System Prompt Seam

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `withNanoAgentSystemPrompt(modelId?)` seam | 调整函数签名和调用位点，预留 `modelId?`；HP0 阶段不读取 D1，只允许空 suffix / placeholder 行为 | `workers/agent-core/src/host/runtime-mainline.ts`, agent tests | HP1 落 `base_instructions_suffix` 时无需再改函数边界 | `pnpm --filter @haimang/agent-core-worker test` | seam 已落地，HP0 closure 明确记录 `partial` 与 `expires-at: HP1 closure` |

### 4.4 Phase 4 — Verify-Only Gate + Cleanup

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | binding-presence verify + residue grep evidence | 新增/补齐 `workers/orchestrator-core/test/binding-presence.test.ts`（或同等 verify case），记录 `CONTEXT_CORE` wiring 与 `LANE_E_RPC_FIRST` 当前值；补 residue grep baseline | tests, closure evidence | HP0 对 verify-only 项有可审计证据 | targeted test + grep | closure 中出现 binding/lane-e/residue 三类证据 |
| P4-02 | 删除过期 rollback runbook | 物理删除 `docs/runbook/zx2-rollback.md`，避免继续引用过期回滚路径 | `docs/runbook/zx2-rollback.md` | 仓内不再保留错误历史 runbook | file existence check | 该文件删除，且无设计/closure 再把它当有效 runbook |
| P4-03 | conditional lockfile drift cleanup | 仅在 grep 证明确有 stale importer 时更新 `pnpm-lock.yaml`；否则保持不动 | `pnpm-lock.yaml` | lockfile 不再带已删除 importer，或明确证据表明无需改动 | grep + `pnpm install --frozen-lockfile`（若触碰 lockfile） | 若 lockfile 修改，则 frozen install 成功；若未修改，则 closure 写清“不触碰原因” |

### 4.5 Phase 5 — Closure + Residue Handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | HP0 closure + residue handoff | 写出 HP0 已解决项、partial 项、retained 项与下游 phase handoff，并显式登记 F1-F17 chronic status（`closed / partial / not-touched / handed-to-platform`） | `docs/issue/hero-to-pro/HP0-closure.md` | HP1/HP8/HP10 能直接消费 HP0 结果而不重做审计 | doc review | closure 对每个 retained/partial 都有去向、条件和 phase owner |

---

## 5. Phase 详情

### 5.1 Phase 1 — Residue Baseline + Freeze Alignment

- **Phase 目标**：先把 HP0 需要遵守的 frozen law 和 residue baseline 固定下来。
- **本 Phase 对应编号**：
  - `P1-01`
- **本 Phase 新增文件**：
  - 无强制新增；以 closure 骨架与测试证据为主
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP0-closure.md`
- **具体功能预期**：
  1. 明确哪些项是 `resolved`、哪些是 `partial`、哪些是 `retained`。
  2. 为 Q2 的 `modelId seam` 建立 `expires-at: HP1 closure` 规则，防止永久 partial。
- **具体测试安排**：
  - **单测**：无新增业务逻辑单测。
  - **集成测试**：无。
  - **回归测试**：grep alias/binding/residue baseline。
  - **手动验证**：closure 条目与 Q1-Q3 一一对照。
- **收口标准**：
  - HP0 closure 中已出现完整 residue ledger。
  - 后续 Phase 引用同一台账，不再散落重复解释。
- **本 Phase 风险提醒**：
  - 如果 baseline 不完整，HP0 结束时会误把 retained 问题包装成“已经完成”。

### 5.2 Phase 2 — Ingress Model Law Repair

- **Phase 目标**：统一三入口对模型字段与 body 的行为。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - 无强制新增文件；以补齐/修订现有 route tests 为主
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/messages.ts`（只读对齐参考，不应在 HP0 再发明第二套字段名）
  - `workers/orchestrator-core/src/session-lifecycle.ts`
  - `workers/orchestrator-core/src/user-do/session-flow.ts`
  - `workers/orchestrator-core/src/user-do/message-runtime.ts`
  - `workers/orchestrator-core/test/**`
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-session/src/messages.ts:17-20,43-52,119-136`
  - `workers/orchestrator-core/src/session-lifecycle.ts:41-57`
  - `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454`
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310`
- **具体功能预期**：
  1. `StartSessionBody` / `FollowupBody` 与 `SessionStartBodySchema` / `SessionFollowupInputBodySchema` 一样，接受 `model_id` 与 `reasoning`。
  2. `/start` 与 `/input` 复用 `/messages` 已有的字段 law：`model_id` 走同一正则与 `requireAllowedModel()` gate，`reasoning.effort` 只允许 `low | medium | high`。
  3. 非法 body / legacy-only alias 不再出现“某个入口放行、另一个入口拒绝”的断层。
- **具体测试安排**：
  - **单测**：orchestrator-core route / runtime 测试。
  - **集成测试**：三入口成功/失败 case 的端点级回归。
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - 三入口相关回归全部通过。
  - `/messages` 继续作为单一 reference implementation，不新增第二套 `model_id` / `reasoning` validator。
  - closure 能清晰说明旧 alias 是否仍保留、保留到何时失效。
- **本 Phase 风险提醒**：
  - 这里最容易出现“为了兼容先双写字段”的诱惑；若不在 closure 登记到期条件，会制造永久双语义。

### 5.3 Phase 3 — System Prompt Seam

- **Phase 目标**：先固定 `modelId?` seam，再把真值读取留给 HP1。
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `workers/agent-core/test/**`
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/runtime-mainline.ts:162-177`
- **具体功能预期**：
  1. `withNanoAgentSystemPrompt` 接受可选 `modelId`，但默认行为仍与当前无参 helper 等价。
  2. 调用点已把后续会用到的 `modelId` 边界传进来，但不擅自依赖尚未落表的字段。
- **具体测试安排**：
  - **单测**：runtime-mainline 相关测试。
  - **集成测试**：agent-core host/runtime 主链回归。
  - **回归测试**：`pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：检查 closure 中 `partial` 标记是否存在。
- **收口标准**：
  - seam 已落地且不会改变当前 system prompt 运行语义。
  - HP0 closure 已记录 `expires-at: HP1 closure`。
- **本 Phase 风险提醒**：
  - 若在 HP0 偷读尚不存在的 schema 字段，会把本应属于 HP1 的失败路径提前引入。

### 5.4 Phase 4 — Verify-Only Gate + Cleanup

- **Phase 目标**：完成 Q3 规定的 verify-only 与 cleanup 项。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - 允许新增最小 verify test / evidence 载体
- **本 Phase 修改文件**：
  - `workers/agent-core/wrangler.jsonc`
  - `workers/orchestrator-core/wrangler.jsonc`
  - `workers/orchestrator-core/src/parity-bridge.ts`
  - `workers/orchestrator-core/test/**`
  - `workers/agent-core/test/**`
  - `pnpm-lock.yaml`（conditional）
- **本 Phase 删除文件**：
  - `docs/runbook/zx2-rollback.md`
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/wrangler.jsonc:20-23,44-51,78-87,97-101`
  - `workers/orchestrator-core/wrangler.jsonc:57-63,80-104`
  - `workers/orchestrator-core/src/user-do/message-runtime.ts:72-77`
  - `workers/orchestrator-core/src/parity-bridge.ts:5-9,57-63`
- **具体功能预期**：
  1. verify-only 项都能通过证据说明“当前是什么”，而不是“未来想变成什么”。
  2. `CONTEXT_CORE` / `LANE_E_RPC_FIRST` 被证明已经存在于当前配置中，因此 HP0 不再改 wrangler。
  3. `forwardInternalJsonShadow` / parity helper 被明确登记为 retained residue，而不是被 HP0 清掉。
  4. 过期 runbook 与可能存在的 stale importer residue 被清掉或被明确判定为无需触碰。
- **具体测试安排**：
  - **单测**：新增 `workers/orchestrator-core/test/binding-presence.test.ts`（或同等 verify case）与 residue verify case。
  - **集成测试**：无新增集成面。
  - **回归测试**：受影响包测试全绿；若触碰 lockfile，补 `pnpm install --frozen-lockfile`。
  - **手动验证**：检查 closure 里 binding/lane-e/lockfile 三类证据是否完整。
- **收口标准**：
  - `docs/runbook/zx2-rollback.md` 已删除。
  - lockfile 若被触碰，必须能自证是“真实漂移修复”而非无差别重写。
- **本 Phase 风险提醒**：
  - cleanup 项最容易扩大成 unrelated churn，尤其是 lockfile；必须保持“有证据才改”。

### 5.5 Phase 5 — Closure + Residue Handoff

- **Phase 目标**：把 HP0 从“做过一些修复”收束成“下游可直接消费的 start gate 结果”。
- **本 Phase 对应编号**：
  - `P5-01`
- **本 Phase 新增文件**：
  - 无
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP0-closure.md`
- **具体功能预期**：
  1. 已解决项、partial 项、retained 项都有明确 verdict。
  2. 每个 retained 项都指向 HP1 / HP8 / HP10 的具体后续 phase，而不是“以后再说”。
  3. HP0 closure 已对 F1-F17 全量标注 `closed / partial / not-touched / handed-to-platform`，禁止 silent inherit。
- **具体测试安排**：
  - **单测**：无。
  - **集成测试**：无。
  - **回归测试**：以 closure 对照测试结果与 grep baseline。
  - **手动验证**：检查 `expires-at: HP1 closure` 是否写清且不可绕过。
- **收口标准**：
  - HP0 closure 能独立解释 HP0 是否完成。
  - 下游 phase 不需要重新挖 HP0 的隐含前提。
- **本 Phase 风险提醒**：
  - 如果 closure 只写“done”而不写 partial/residue 条件，后续 phase 会重新掉进同一坑。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q1 — 三入口模型字段/body law 统一 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 Phase 2 的字段命名、拒绝策略与回归测试口径 | 若代码现实与 Q1 冲突，按 Q1 修代码，不在 HP0 临时新开兼容语义 |
| Q2 — `withNanoAgentSystemPrompt(modelId?)` 允许先 partial | `docs/design/hero-to-pro/HPX-qna.md` | 决定 Phase 3 只开 seam、不读 D1 真字段；closure 必须带 `expires-at: HP1 closure` | 若 HP1 未补完整接线，则 HP1 视为 incomplete，而不是把 partial 永久保留 |
| Q3 — `CONTEXT_CORE` / `LANE_E_RPC_FIRST` 只 verify，parity/shadow 不强删 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 Phase 4 的 verify-only 与 cleanup 边界 | 若执行期想新增 wiring / 删除 parity helper，必须退回后续 phase 或新 review，不得在 HP0 越界 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| ingress law 回归风险 | 三入口已有历史兼容路径，修正后可能暴露旧测试假设 | `medium` | 以 route-level regression 明确成功/失败路径，统一三入口 verdict |
| seam 与 HP1 字段命名耦合 | HP0 先开 `modelId?` seam，HP1 再接 `base_instructions_suffix` 真值 | `medium` | 在 closure 写明 `expires-at: HP1 closure`，HP1 若改字段命名必须同步修 seam |
| lockfile cleanup 扩散 | 若无条件地重写 `pnpm-lock.yaml`，会引入 unrelated diff | `medium` | 只有 grep 证明确有 stale importer 才改，且补 frozen install 证据 |
| residue 判断失真 | parity/shadow/binding 这类 retained 项若未登记，会在 HP8/HP10 重新变成隐患 | `low` | 统一纳入 HP0 closure residue ledger |

### 7.2 约束与前提

- **技术前提**：只使用仓内既有测试/构建命令；HP0 不创建任何新的 schema/migration。
- **运行时前提**：保持现有 `CONTEXT_CORE`、`LANE_E_RPC_FIRST`、parity/shadow runtime 现状，不在 HP0 改 final-state。
- **组织协作前提**：Q1-Q3 已冻结；执行期若发现新 owner 问题，必须退回 design / QNA，而不是在 action-plan 内追加问答。
- **上线 / 合并前提**：orchestrator-core 与 agent-core 相关测试矩阵通过，closure 已完整回填 partial / retained 条目。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP0-pre-defer-fixes.md`（仅在执行事实证明 freeze 文本仍有漂移时回退修订）
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP0-closure.md`
- 需要同步更新的测试说明：
  - `workers/orchestrator-core/test/README.md`（如新增/调整了三入口回归矩阵）

### 7.4 完成后的预期状态

1. `/start` / `/input` / `/messages` 将共享同一套 hero-to-pro 模型字段/body law，不再各自为政。
2. `withNanoAgentSystemPrompt(modelId?)` 的 seam 已经存在，HP1 只需补真实字段接线而不是再改边界。
3. `CONTEXT_CORE` / `LANE_E_RPC_FIRST`、parity/shadow、archive/lockfile residue 都有 closure 级证据与去向。
4. HP0 结束后，后续 phase 不需要再争论“这些前置清理到底做没做、做到哪一步算结束”。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查三入口相关代码与测试中不再残留未登记的 legacy-only 字段语义。
  - 检查 `docs/runbook/zx2-rollback.md` 是否已删除，`pnpm-lock.yaml` 是否仅在必要时发生变更。
- **单元测试**：
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
- **集成测试**：
  - 三入口 route regression + runtime-mainline seam regression
- **端到端 / 手动验证**：
  - 以 grep evidence + closure ledger 做 verify-only / residue handoff 检查
- **回归测试**：
  - 若触碰 `pnpm-lock.yaml`，补 `pnpm install --frozen-lockfile`
- **文档校验**：
  - `docs/issue/hero-to-pro/HP0-closure.md` 必须显式列出 `partial / retained / expires-at`
  - `docs/issue/hero-to-pro/HP0-closure.md` 必须显式登记 F1-F17 chronic status

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. 三入口的 hero-to-pro 模型字段/body law 已统一并被测试覆盖。
2. `withNanoAgentSystemPrompt(modelId?)` seam 已落地，且 closure 明确其 HP1 完成条件。
3. Q3 涉及的 verify-only / cleanup 项都已形成证据或被清理。
4. HP0 closure 已明确写出所有 retained / partial 项的后续落点。
5. HP0 closure 已显式声明 F1-F17 的 phase 状态，而不是把 chronic 判定拖到 HP10 才第一次登记。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 三入口 law 修复完成，system prompt seam 已预留 |
| 测试 | orchestrator-core / agent-core 受影响测试矩阵通过；必要时 frozen install 通过 |
| 文档 | HP0 closure 能独立解释已完成项、partial 项、retained 项 |
| 风险收敛 | verify-only 和 cleanup 项不再依赖口头记忆 |
| 可交付性 | HP1 可以直接基于 HP0 closure 继续执行，不再重做前置审计 |
