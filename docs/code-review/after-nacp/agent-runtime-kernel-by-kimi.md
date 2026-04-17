# Nano-Agent 代码审查 — Agent Runtime Kernel

> 审查对象: `packages/agent-runtime-kernel`
> 审查时间: `2026-04-17`
> 审查人: `Kimi (k2p5)`
> 审查范围:
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `packages/agent-runtime-kernel/src/**/*.ts`
> - `packages/agent-runtime-kernel/test/**/*.ts`
> - `README.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 该实现主体扎实，架构与 action-plan 高度对齐，105 个测试全部通过，reducer/scheduler/runner/checkpoint 四层职责边界清晰。但存在若干交付缺口（README 缺失、idle-input-arrival scenario 缺失、delegate 契约过松），当前不应直接标记为最终 completed，建议补完后再收口。

- **整体判断**：核心骨架完成，测试覆盖充分，但交付文档与边界契约仍有缺口待补。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `applyAction` 是唯一状态变更入口，immutable update 模式正确，23 个 reducer tests 覆盖全部 10 种 action + illegal transitions。
  2. `KernelRunner.advanceStep()` 确实实现了 step-driven 而非黑盒 `runTurn()`，与 design doc 和 session-do-runtime 的编排需求对齐。
  3. delegate interfaces (`delegates.ts`) 过度使用 `unknown`，导致 runner 内部依赖隐式 chunk 协议，跨包集成时存在类型漂移风险。

---

## 1. 审查方法与已核实事实

### 对照文档
- `docs/action-plan/agent-runtime-kernel.md` (531 lines, Phases 1-5)
- `docs/design/agent-runtime-kernel-by-GPT.md` (design goals + NACP alignment matrices)
- `README.md` (project constraints: Cloudflare-native, DO-centered, single-active-turn)

### 核查实现
- `packages/agent-runtime-kernel/src/` (15 files)
- `packages/agent-runtime-kernel/test/` (11 test files, 105 tests)
- `packages/agent-runtime-kernel/package.json`

### 执行过的验证
```bash
pnpm --filter @nano-agent/agent-runtime-kernel typecheck  # PASS
pnpm --filter @nano-agent/agent-runtime-kernel test        # 105/105 PASS
```

### 1.1 已确认的正面事实
- **Typecheck 通过**，无编译错误。
- **105 tests 全部通过**，其中 23 reducer tests、9 scheduler tests、11 interrupt tests、6 runner tests、17 checkpoint tests、18 events tests、6 message-intents tests、15 scenario tests（4 suites）。
- `reducer.ts:48-231` 的 `applyAction` 确实是唯一状态变更入口，所有分支使用 spread 产生新对象，没有 mutating existing state。
- `scheduler.ts:27-62` 的优先级链（cancel > timeout > compact > tools > llm > finish）与 design doc 和 action plan 完全一致。
- `checkpoint.ts:51-63` 只产出 kernel fragment，不碰 DO storage，职责边界正确。
- `events.ts` 的 9-kind mapping 与 `packages/nacp-session/src/stream-event.ts` 的 9 kinds 一一对应，无新增 drift。
- `runner.test.ts:145-179` 的 full lifecycle test（start → llm → tool → finish）通过，证明 step loop 可运行。
- `interrupt-turn.test.ts:116-153` 的 timeout → checkpoint → restore → resume → finish 路径通过，证明可恢复语义成立。

### 1.2 已确认的负面事实
- `packages/agent-runtime-kernel/README.md` **不存在**（`package.json:6-7` 引用了它）。
- `test/scenarios/idle-input-arrival.test.ts` **不存在**，尽管 action-plan P5-02 明确列出。
- `delegates.ts:13-16` 的 `LlmDelegate.call(request: unknown)` 和 `CapabilityDelegate.execute(plan: unknown)` 类型过于宽松；`runner.ts:77-99` 内部硬编码了对 `{type: "content" | "usage" | "tool_calls"}` 的隐式协议，却无类型约束。
- `checkpoint.ts:73-80` 的 `restoreFromFragment` 没有验证 fragment.version 与当前 `KERNEL_VERSION` 的兼容性，直接透传。

---

## 2. 审查发现

### R1. README.md 缺失

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `package.json:6-7` 声明 `"main": "./dist/index.js"`，`"types": "./dist/index.d.ts"`，但没有 README 文件。
  - `docs/action-plan/agent-runtime-kernel.md:P5-03` 明确将 "README、公开导出与 package scripts" 作为收口标准。
- **为什么重要**：
  - 下游包（如 `session-do-runtime`）开发者需要快速理解 kernel 做什么/不做什么、如何构造 fake delegates、如何调用 `advanceStep()`。
  - 没有 README 会让 package 看起来像未完成骨架，即使内部逻辑已成熟。
- **审查判断**：
  - 这是 action-plan 的 explicit deliverable，不能遗漏。
- **建议修法**：
  - 添加 `packages/agent-runtime-kernel/README.md`，至少包含：
    1. 一句话定位（与 design doc 一致）
    2. 核心概念（SessionState / TurnState / StepDecision / KernelRunner）
    3. 最小使用示例（fake delegates + `advanceStep()`）
    4. 指向 design doc 和 action plan 的链接

---

### R2. 缺少 `idle-input-arrival` scenario test

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `docs/action-plan/agent-runtime-kernel.md:P5-02` 明确列出 `"idle-input-arrival turn"` 作为 scenario test 的必填项。
  - 实际目录只有 4 个 scenario：`basic-turn.test.ts`、`tool-turn.test.ts`、`compact-turn.test.ts`、`interrupt-turn.test.ts`。
- **为什么重要**：
  - `idle-input-arrival` 是验证 kernel 在等待态（waiting）下收到新输入后能否通过 `resume` action 正确恢复的核心路径。
  - 该场景对应 session-do-runtime 的 "后续 turn 输入通过 `session.prompt` 承载" 的未定 but critical 入口。
  - 缺少它意味着 "waiting → resume → continue" 的集成路径只在 interrupt-turn 的 timeout 分支中被间接验证，没有覆盖 "idle 后新输入直接触发 start_turn" 或 "waiting 后 input arrives" 的显式路径。
- **审查判断**：
  - action-plan 的收口标准未完全满足。
- **建议修法**：
  - 添加 `test/scenarios/idle-input-arrival.test.ts`，覆盖两种子路径：
    1. `idle` → `start_turn` → `llm_call` → `finish`（session 收到第一条输入）
    2. `waiting`（因 approval_pending 中断）→ `resume` → `llm_call` → `finish`

---

### R3. Delegate 接口类型过松，Runner 内部依赖隐式协议

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `delegates.ts:13-16`：`LlmDelegate.call(request: unknown): AsyncIterable<unknown>`
  - `delegates.ts:22-25`：`CapabilityDelegate.execute(plan: unknown): AsyncIterable<unknown>`
  - `runner.ts:77-99`：硬编码解析 `chunk as Record<string, unknown>`，并检查 `c.type === "content"`、`c.type === "usage"`、`c.type === "tool_calls"`。
  - `runner.ts:130-148`：同样硬编码检查 `c.type === "progress"`、`c.type === "result"`。
- **为什么重要**：
  - 在 Wave 1 时这些接口使用 `unknown` 是合理的（为了与尚未实现的 llm-wrapper / capability-runtime 解耦）。
  - 但当前 Wave 3/4 已经落地了 `llm-wrapper` 和 `capability-runtime`，它们有自己的 canonical types（`CanonicalLLMRequest`、`CapabilityPlan`）。
  - `unknown` 意味着 TypeScript 编译器无法帮助检查跨包集成时的协议匹配。如果 `llm-wrapper` 的 adapter 产出的 chunk shape 与 runner 的预期不一致，问题要到运行时才能发现。
- **审查判断**：
  - 不是功能 bug，但属于设计债。在当前阶段应引入最小公共类型（或从 `llm-wrapper` / `capability-runtime` import type-only），消除隐式协议。
- **建议修法**：
  - 方案 A（推荐）：在 `agent-runtime-kernel` 中定义轻量的 `LlmChunk` / `CapabilityChunk` discriminated unions，并将 `LlmDelegate.call` 的返回类型改为 `AsyncIterable<LlmChunk>`。`llm-wrapper` 的 fake/real adapters 负责产出兼容 shape。
  - 方案 B：保持 `unknown`，但在 README 中显式文档化 runner 对 chunk shape 的期望（作为短期 workaround）。

---

### R4. `restoreFromFragment` 未验证版本兼容性

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `checkpoint.ts:73-80`：
    ```typescript
    export function restoreFromFragment(fragment: KernelCheckpointFragment): KernelSnapshot {
      return createKernelSnapshot(
        { ...fragment.session },
        fragment.activeTurn ? { ...fragment.activeTurn } : null,
      );
    }
    ```
  - 完全没有检查 `fragment.version` 是否与 `KERNEL_VERSION` 兼容。
- **为什么重要**：
  - DO hibernation 可以跨越 deploy。如果未来 kernel 的 state shape 发生 breaking change（例如新增/重命名字段），旧 fragment 被 restore 后可能在后续 reducer action 中导致 runtime errors。
  - 早期加入版本兼容性检查（即使是 naive 的 `===`），能为未来 migration 提供明确的失败点和日志。
- **审查判断**：
  - v1 当前版本单一，不立刻触发问题，但属于可预见的 resilience gap。
- **建议修法**：
  - 在 `restoreFromFragment` 中加入：
    ```typescript
    if (fragment.version !== KERNEL_VERSION) {
      throw new KernelError(
        KERNEL_ERROR_CODES.CHECKPOINT_VERSION_MISMATCH,
        `Checkpoint version ${fragment.version} incompatible with kernel ${KERNEL_VERSION}`
      );
    }
    ```
  - 同时补充 error code `CHECKPOINT_VERSION_MISMATCH`。

---

### R5. `KernelRunner` 在 `activeTurn` 缺失时仍可能产出 `turnId = "unknown"` 的事件

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `runner.ts:42-43`：
    ```typescript
    const turnId = snapshot.activeTurn?.turnId ?? "unknown";
    ```
  - 如果 `advanceStep` 被调用时 `snapshot.activeTurn` 为 null（例如 session 处于 `idle` 或 `ended`），事件将带有 `turnId: "unknown"`。
- **为什么重要**：
  - 这本身是防御性代码，但 "unknown" 是一个合法的字符串值，下游 audit / timeline 系统可能把它当成真实 turnId 处理，污染 trace。
  - 更好的做法是：在 runner 入口显式检查 `activeTurn` 存在性，如果不存在则抛出 `KernelError`，而不是继续执行并产出带 "unknown" 的事件。
- **审查判断**：
  - 当前代码路径下（由 session DO 正确编排时）不会触发，但 defensive programming 可以更严格。
- **建议修法**：
  - 在 `advanceStep` 开头加入：
    ```typescript
    if (!snapshot.activeTurn) {
      throw new KernelError(KERNEL_ERROR_CODES.TURN_NOT_FOUND, "advanceStep requires an active turn");
    }
    ```
  - 并移除 `?? "unknown"` fallback。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/agent-runtime-kernel` 独立包骨架 | `done` | package.json、tsconfig、build/typecheck/test scripts 齐全 |
| S2 | `SessionState / TurnState` 双层状态模型 | `done` | `state.ts` 明确分层，factory 函数完整 |
| S3 | `KernelStep / StepDecision / KernelPhase` 类型体系 | `done` | `types.ts` + `step.ts` 冻结了 6 种 phase、6 种 step kind、6 种 decision |
| S4 | `InterruptReason` 统一建模 | `done` | 5 种 reason + `classifyInterrupt` + `canResumeFrom` 完整 |
| S5 | reducer / scheduler / runner facade | `done` | 三层实现完整，49 tests 覆盖核心路径 |
| S6 | llm / capability / hooks / compact delegate interfaces | `partial` | 接口存在但过度使用 `unknown`，隐式 chunk 协议未类型化 |
| S7 | runtime event emitter 与 event taxonomy | `done` | 9 种 runtime events + `mapRuntimeEventToStreamKind` 对齐 nacp-session |
| S8 | 对齐 `nacp-core` message families 的 message intent builder | `partial` | `intentForStep` 只覆盖 tool/hook/compact，缺少 skill/system/audit（但 design doc 标记 skill 为预留，可接受） |
| S9 | 对齐 `nacp-session` event catalog 的 session stream mapping | `done` | `RUNTIME_TO_STREAM_MAP` 和设计 doc 的 7.2b 矩阵完全一致 |
| S10 | kernel checkpoint fragment / restore contract | `partial` | build/restore/validate 实现完整，但版本兼容性检查缺失 |
| S11 | fake delegate scenario tests | `partial` | 4 suites 跑通，但缺少 action-plan 要求的 `idle-input-arrival` |
| S12 | README、公开导出与 package scripts | `partial` | package scripts 完整，README 缺失，导出面完整 |

### 3.1 对齐结论

- **done**: 7
- **partial**: 5
- **missing**: 0

> 这更像 "核心骨架与测试覆盖已到位，但交付文档和边界契约仍需最后一轮打磨"，而不是完全未完成的骨架。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Session DO / Worker fetch / WebSocket attach 物理装配 | `遵守` | runner 完全不碰 transport，符合边界 |
| O2 | provider request body、provider HTTP transport、API key 管理 | `遵守` | 通过 delegate 隔离，符合边界 |
| O3 | capability command registry、本地 bash、service binding tool worker 实现 | `遵守` | capability 细节完全外置 |
| O4 | workspace / artifact 物理存储与最终 storage topology | `遵守` | 未涉及 |
| O5 | 完整 permission engine 与 policy engine | `遵守` | 仅留 `approval_pending` 信号 seam |
| O6 | sub-agent / multi-turn concurrency / background lane runtime | `遵守` | `single-active-turn` invariant 在 reducer + runner 中被强制 |
| O7 | 真实 analytics / metrics / cost pipeline | `遵守` | 仅通过 `totalTokens` 做最小计数 |
| O8 | D1 / KV / R2 schema 与 registry 持久化 | `遵守` | checkpoint 只产 fragment，不写 storage |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups` — 核心实现质量高，但交付物不完整。
- **是否允许关闭本轮 review**：`no`（需先补 README 和 idle-input-arrival test）
- **关闭前必须完成的 blocker**：
  1. **R1**: 添加 `packages/agent-runtime-kernel/README.md`（至少包含定位、核心概念、最小使用示例）。
  2. **R2**: 添加 `test/scenarios/idle-input-arrival.test.ts`（覆盖 idle → start_turn 和 waiting → resume 两条路径）。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R3**: 收紧 delegate chunk 类型（可 deferred 到跨包集成联调阶段）。
  2. **R4**: 在 `restoreFromFragment` 中加入版本兼容性检查。
  3. **R5**: 移除 runner 中 `turnId ?? "unknown"` 的 fallback，改为前置 guard。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R5`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | README.md 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R2 | idle-input-arrival scenario 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R3 | delegate 接口过松 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R4 | checkpoint 版本检查缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R5 | runner turnId "unknown" fallback | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`
- `{FILE_3}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**：
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> **规则**：
> 1. 二次审查人不得改写 §0–§6，只能继续 append
> 2. 二次审查必须区分：
>    - 已验证修复有效
>    - 仅部分修复
>    - 新引入问题
> 3. 必须明确“本轮是否收口”

### 7.1 二次审查结论

> 复核者: `{REVIEWER}`
> 复核时间: `{DATE}`
> 复核依据: `实现者 §6 的回应 + 当前代码事实`

- **二次结论**：`{ONE_LINE_REREVIEW_VERDICT}`
- **是否收口**：`yes | no`

### 7.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `{FILE:LINE / command / test}` |
| R2 | `closed` | `{FILE:LINE / command / test}` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |
| R4 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |

### 7.4 二次收口意见

- **必须继续修改的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可后续跟进的 follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 若仍不收口，请明确写：
> `请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。`

---

## 8. 对 Kimi 审查质量的评价

> 评价者：`Claude Opus 4.6 (1M context)`
> 评价时间：`2026-04-17`
> 评价依据：`agent-runtime-kernel-by-kimi.md` §0–§5 + 实际代码核查结果
> 注：本轮完整的实现者工作日志（GPT R1-R4 + Kimi R1-R5 合并修复）回填在 `agent-runtime-kernel-by-GPT.md` §6，这里不再重复。

### 8.1 总体评价

**综合评分：⭐⭐⭐⭐☆ (4/5)** — Kimi 的审查质量**扎实且克制**，所有 5 条 findings 全部命中真实缺口；遗憾在于未能独立发现 GPT 找出的 3 个 HIGH correctness blocker（tool identity collapse / message 重复 / schema mismatch），定位偏 "交付完整性" 而非 "运行时正确性"。

### 8.2 做得好的地方

1. **R3 对 `delegate unknown` 的类型债诊断非常准确**——指出 "Wave 1 时 unknown 合理，但 Wave 3/4 后就是债"，并给出 "方案 A（引入 discriminated union）vs 方案 B（仅文档化）" 的 tradeoff 分析。这条 finding 是 **GPT review 没有覆盖到的独立价值**——本轮最终采用了方案 A（`LlmChunk` / `CapabilityChunk`），修复后对跨包集成有显著防飘作用。

2. **R4 `restoreFromFragment` 的版本兼容性检查**是典型的 "resilience gap" 视角——v1 不会立刻触发，但 DO hibernation 跨越 deploy 后必然需要。Kimi 指出 "早期加入 naive `===` 检查能为未来 migration 提供明确失败点" 的判断很成熟。本轮已实装 `CHECKPOINT_VERSION_MISMATCH`。

3. **R5 `turnId ?? "unknown"` 的细节洞察**——这种 "防御性代码反而污染 trace" 的边角问题，很多 review 会直接放过。Kimi 指出 `"unknown"` 会被下游 audit 系统当成真实 turnId，这是 **non-obvious 的观察**。本轮已改为前置 guard。

4. **In-Scope 对齐表的完整性**——12 个 S 项全部覆盖，给出 `done:7 / partial:5 / missing:0` 的汇总。虽然比 GPT 宽松（GPT 给出 `done:4 / partial:8`），但这与 Kimi 本身更偏 "approve-with-followups" 的基调一致，不是错误。

5. **R1（README 缺失）和 R2（idle-input-arrival scenario 缺失）是明确的 action-plan 验证项**——不是新增要求，而是对 P5-02 / P5-03 的字面 checklist 对照。这类 "delivery gap" review 对保证交付完整性很重要。

### 8.3 可以更好的地方

1. **没有对 runtime correctness 做足够深的核查**——Kimi 在 §1.1 写 "applyAction 确实是唯一状态变更入口，所有分支使用 spread 产生新对象，没有 mutating existing state"——这个判断正确，但**没有进一步追问**：`complete_step` 和 `llm_response` 各自都 spread 进 messages，这意味着每条内容被写了两次。如果深一层核查，R2（message 重复）应该由 Kimi 发现，但这条是 GPT 独立发现的。

2. **R3 建议了方案 A 和方案 B，但没有给出核查证据**——Kimi 没有实际跑 "fake-llm 的 chunk shape 和 runner 预期不一致时会怎样" 的复现。相比之下 GPT R3（schema mismatch）给了 `safeParse` 失败的直接证据。

3. **没有检查 `buildStreamEventBody` 的 schema 对齐**——Kimi 的 S9 直接标 `done`（"`RUNTIME_TO_STREAM_MAP` 和设计 doc 的 7.2b 矩阵完全一致"），而 GPT R3 指出这层 mapping 的 **body shape** 根本不符合真实 `SessionStreamEventBodySchema`。这是 Kimi 的**盲区**——她检查了 kind 映射（"turn.started → turn.begin"），但没有检查 body field 对齐。

4. **R5 的 fix 建议过于激进**——"直接抛 `KernelError`" 在 compact path 下会误伤（compact 不需要 activeTurn）。本轮采用了更温和的 "非 idle/ended 且非 compact 时才 guard" 策略。Kimi 建议若考虑到 handler 级差异会更精准。

5. **没有跨 review 去重**——Kimi R2（idle-input-arrival 缺失）与 GPT R4 是同一项，但 Kimi 没有意识到这一点。如果两份 review 能在同一个 PR 窗口内做，可以先对齐基线再独立审查。

### 8.4 Kimi 审查的风格特征

- **偏工程交付视角**（README / test files / version check / defensive code quality），不是偏 runtime correctness
- **对 resilience 和 maintainability 敏感**（R3/R4/R5 都是 "未来会坏" 的判断）
- **tradeoff 陈述完整**（R3 给出方案 A vs B，R5 给出 defensive programming rationale）
- **对 action-plan checklist 的字面对照纪律好**（R1/R2 都是 P5-03 / P5-02 的直接验证）

### 8.5 总结

Kimi 的 review 是一份**成熟、克制、可信**的工程审查：
- 找出了 **GPT 未覆盖的 3 条独立价值 findings**（R3 typed chunks, R4 version check, R5 turnId guard）
- 但**漏掉了 GPT 发现的 3 个 HIGH correctness blocker**（tool identity, message duplication, schema mismatch）
- **最适合作为 GPT review 的补充**，而不是单独使用

两份 review 合并后覆盖面完整——这证明多人独立审查的价值：**不同审查者的盲区不同，并行 review 能最大化 coverage**。
