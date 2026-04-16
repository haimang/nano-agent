# Nano-Agent 行动计划 — Agent Runtime Kernel

> 服务业务簇: `Agent Runtime`
> 计划对象: `@nano-agent/agent-runtime-kernel` — session actor 内的主循环与状态调度核心
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/agent-runtime-kernel/`（独立 repo，位于 `packages/` 下）
> 关联设计 / 调研文档:
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/hooks-by-GPT.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/plan-after-nacp.md`
> - `README.md`
> - 参考代码：`packages/nacp-core/`、`packages/nacp-session/`、`context/mini-agent/`、`context/codex/`、`context/claude-code/`
> 文档状态: `draft`

---

## 0. 执行背景与目标

`nacp-core` 和 `nacp-session` 已经把 **内部消息合同** 与 **client ↔ session DO 的 WebSocket profile** 收口，但 nano-agent 还缺一个真正能把这些合同组织成 agent 本体的运行时中心：

> **session actor 内的 turn loop 到底如何推进、何时中断、何时 compact、何时 checkpoint、以及它如何把 hooks / llm / capability 接成一个可恢复系统。**

这份 action-plan 的目标，不是直接开始写 Session DO 或 provider 适配，而是先把 **runtime kernel** 作为独立包落地，让后续 `session-do-runtime`、`llm-wrapper`、`capability-runtime`、`workspace-context-artifacts` 都能围绕一个稳定的主循环边界协作。  
这些 `packages/*` 不是最终的 Cloudflare 发布单元；后续会有一个可部署的 Worker / Session DO 组装层把它们拼装起来，并同时服务 **WebSocket-first** 与 **HTTP fallback** 的 session ingress。

- **服务业务簇**：`Agent Runtime`
- **计划对象**：`@nano-agent/agent-runtime-kernel`
- **本次计划解决的问题**：
  - nano-agent 目前只有协议地基，没有真正的主循环与状态仲裁中心
  - `hooks / llm / capability / compact / checkpoint` 之间还缺统一调度与统一中断语义
  - `NACP-Core` 与 `NACP-Session` 已冻结的 message / stream contract，需要一个运行时把它们映射成真实的 turn lifecycle
  - 后续 `session-do-runtime` 若没有稳定 kernel，会被迫同时承担 transport、storage、scheduler 三种复杂度
- **本次计划的直接产出**：
  - `packages/agent-runtime-kernel/` 独立包骨架
  - 明确的 `SessionState / TurnState / StepDecision / InterruptReason / RuntimeEvent / Delegate` 类型体系
  - 可测试的 reducer / scheduler / interrupt / checkpoint / event mapping 实现
  - 面向 `session-do-runtime` 的可恢复 kernel runner 与测试基座

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **5 个 Phase**，执行策略是 **“先状态与接口，再调度与中断，再事件与 checkpoint，最后用 scenario tests 收口”**。  
原因很直接：kernel 是纯逻辑核心，不该一开始就掺入 DO / WebSocket / provider / tool 实现细节；必须先把 **状态槽位、状态转移、delegate contract、event contract** 钉死，再接入 fake delegates 做验证。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Kernel 包骨架与领域类型 | M | 建立独立包、冻结核心类型与公共接口 | `-` |
| Phase 2 | Reducer / Scheduler / Interrupt Core | L | 让 turn 推进、中断与等待态进入统一逻辑中心 | Phase 1 |
| Phase 3 | Runtime Event 与 NACP 对齐层 | M | 对齐 `NACP-Core` message intent 与 `NACP-Session` stream kinds | Phase 1, Phase 2 |
| Phase 4 | Checkpoint / Restore / Runner Facade | M | 定义可恢复边界，并给 session DO 提供可调用的运行包装层 | Phase 1, Phase 2, Phase 3 |
| Phase 5 | Scenario Tests / 文档 / 收口 | M | 用 fake delegates 跑通典型 turn，完成 README、导出面与回归测试 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Kernel 包骨架与领域类型**
   - **核心目标**：建立包与最小导出面，冻结 `SessionState`、`TurnState`、`KernelStep`、`StepDecision`、`InterruptReason`、`RuntimeEvent`、`KernelDelegate` 等核心类型。
   - **为什么先做**：kernel 的第一层 guard 是类型，不先冻结接口，后面 scheduler / checkpoint 很容易重写。
2. **Phase 2 — Reducer / Scheduler / Interrupt Core**
   - **核心目标**：把“下一步做什么”“何时等待”“何时中断”全部集中进 reducer + scheduler + interrupt controller。
   - **为什么放在这里**：这是 kernel 的心脏，后续 event / checkpoint / runner 都依赖它。
3. **Phase 3 — Runtime Event 与 NACP 对齐层**
   - **核心目标**：把 runtime events 收敛为当前 `@nano-agent/nacp-session` 已冻结的 9 个 kind，并把 tool / hook / compact 等内部意图对齐到当前 `@nano-agent/nacp-core` message family。
   - **为什么放在这里**：只有调度中心稳定后，事件与 message mapping 才能不飘。
4. **Phase 4 — Checkpoint / Restore / Runner Facade**
   - **核心目标**：建立 kernel fragment 的 checkpoint/restore contract，并明确与 `SessionWebSocketHelper.checkpoint()/restore()` 的拼接方式。
   - **为什么放在这里**：checkpoint 必须建立在稳定状态机与事件边界之上。
5. **Phase 5 — Scenario Tests / 文档 / 收口**
   - **核心目标**：用 fake llm / fake capability / fake hook / fake compact delegates 跑通典型 turn 场景，完成 README 与公开导出。
   - **为什么放在这里**：kernel 是否靠谱，最终要靠 scenario tests 验证，而不是靠类型自信。

### 1.4 执行策略说明

- **执行顺序原则**：`types -> reducer/scheduler -> event mapping -> checkpoint -> scenario tests`
- **风险控制原则**：不把 provider / tool / DO 细节提前塞进 kernel；所有副作用都通过 delegate contract 与 fake implementation 验证
- **测试推进原则**：先写 reducer/scheduler/interrupt 的单测，再用 fake delegates 做 turn scenario；checkpoint 与恢复必须有显式回归测试
- **文档同步原则**：每个 Phase 结束后回填相关 design 文稿中的“下一步行动”与 cross-doc alignment 说明

### 1.5 本次 action-plan 影响目录树

```text
packages/agent-runtime-kernel/
├── src/
│   ├── version.ts
│   ├── types.ts
│   ├── state.ts
│   ├── step.ts
│   ├── delegates.ts
│   ├── errors.ts
│   ├── reducer.ts
│   ├── scheduler.ts
│   ├── interrupt.ts
│   ├── events.ts
│   ├── message-intents.ts
│   ├── session-stream-mapping.ts
│   ├── checkpoint.ts
│   ├── runner.ts
│   └── index.ts
├── test/
│   ├── state.test.ts
│   ├── reducer.test.ts
│   ├── scheduler.test.ts
│   ├── interrupt.test.ts
│   ├── events.test.ts
│   ├── message-intents.test.ts
│   ├── checkpoint.test.ts
│   └── scenarios/
│       ├── basic-turn.test.ts
│       ├── tool-turn.test.ts
│       ├── compact-turn.test.ts
│       └── interrupt-turn.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/agent-runtime-kernel` 独立包骨架
- **[S2]** `SessionState / TurnState` 双层状态模型
- **[S3]** `KernelStep / StepDecision / KernelPhase` 类型体系
- **[S4]** `InterruptReason` 与等待态 / cancel / timeout / compact-required 统一建模
- **[S5]** reducer / scheduler / runner facade
- **[S6]** llm / capability / hooks / compact 的 delegate interfaces
- **[S7]** runtime event emitter 与 event taxonomy
- **[S8]** 对齐当前 `nacp-core` message families 的 message intent builder
- **[S9]** 对齐当前 `nacp-session` event catalog 的 session stream mapping
- **[S10]** kernel checkpoint fragment / restore contract
- **[S11]** fake delegate scenario tests
- **[S12]** README、公开导出与 package scripts

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** Session DO / Worker fetch / WebSocket attach 物理装配
- **[O2]** provider request body、provider HTTP transport、API key 管理
- **[O3]** capability command registry、本地 bash、service binding tool worker 实现
- **[O4]** workspace / artifact 物理存储与最终 storage topology
- **[O5]** 完整 permission engine 与 policy engine
- **[O6]** sub-agent / multi-turn concurrency / background lane runtime
- **[O7]** 真实 analytics / metrics / cost pipeline
- **[O8]** D1 / KV / R2 schema 与 registry 持久化

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `single-active-turn` | `in-scope` | 这是 v1 正确性边界，也是 scheduler 的基础假设 | 仅在 future background lane 设计启动时 |
| `caller-managed health` | `in-scope` | 已由 `nacp-session` 收口；kernel 只消费 signal，不接管 WebSocket/HTTP 会话健康管理 | 不重评，除非 Session profile 改版 |
| capability progress stream | `in-scope` | kernel 必须知道如何接收并外送 progress | 当 capability runtime 冻结 long-running worker 时 |
| compact policy engine | `out-of-scope` | kernel 只接受 compact-required signal，不实现完整 token policy | observability / workspace evidence 出来后 |
| session prompt ingress contract | `defer / depends-on-decision` | 这是 `session-do-runtime` 的入口问题，不是 kernel 包本体；但 kernel 必须用 source-agnostic `PendingWait` / input-arrived signal 保持对未来 wire truth 的中立 | `session-do-runtime` action-plan 前 |
| background capability lane | `out-of-scope` | 会破坏单活跃 turn 假设，v1 不做 | 出现明确业务需求时 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出独立 kernel package | low |
| P1-02 | Phase 1 | 核心状态类型 | `add` | `src/types.ts`、`src/state.ts` | 冻结 Session/Turn state 结构 | medium |
| P1-03 | Phase 1 | step / phase / interrupt 类型 | `add` | `src/step.ts`、`src/interrupt.ts` | 统一推进与中断语义 | medium |
| P1-04 | Phase 1 | delegate contracts | `add` | `src/delegates.ts` | 为 llm/tool/hooks/compact 提供 typed seam | medium |
| P2-01 | Phase 2 | reducer | `add` | `src/reducer.ts` | 所有状态转移走单一 reducer | high |
| P2-02 | Phase 2 | scheduler | `add` | `src/scheduler.ts` | 统一决定下一步 StepDecision | high |
| P2-03 | Phase 2 | interrupt controller | `add` | `src/interrupt.ts` | 统一 cancel/timeout/compact/waiting | medium |
| P2-04 | Phase 2 | runner 基本循环 | `add` | `src/runner.ts` | 形成 step-driven main loop | high |
| P3-01 | Phase 3 | runtime event taxonomy | `add` | `src/events.ts` | 冻结 runtime events | medium |
| P3-02 | Phase 3 | NACP-Core message intents | `add` | `src/message-intents.ts` | 对齐 tool/hook/context/system/skill 语义 | medium |
| P3-03 | Phase 3 | Session event mapping | `add` | `src/session-stream-mapping.ts` | 对齐 `session.stream.event` 现有 kind catalog | medium |
| P4-01 | Phase 4 | checkpoint fragment | `add` | `src/checkpoint.ts` | 定义 kernel 可恢复边界 | high |
| P4-02 | Phase 4 | restore contract | `add` | `src/checkpoint.ts`、`src/runner.ts` | 支持 turn-safe restore | high |
| P4-03 | Phase 4 | websocket checkpoint 对齐 | `update` | `src/checkpoint.ts` | 显式兼容 `SessionWebSocketHelper` replay/seq fragment | medium |
| P5-01 | Phase 5 | 单元测试 | `add` | `test/*.test.ts` | 覆盖 reducer/scheduler/interrupt/event/checkpoint | medium |
| P5-02 | Phase 5 | scenario tests | `add` | `test/scenarios/*.test.ts` | 用 fake delegates 跑通典型 turn | high |
| P5-03 | Phase 5 | 文档与导出面 | `update` | `README.md`、`src/index.ts` | 让下游可直接 import kernel API | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Kernel 包骨架与领域类型

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 按 `nacp-core` / `nacp-session` 现有 package 约定建立独立 repo 骨架、scripts 与导出面 | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | package 可 `build/typecheck/test` | 基础命令校验 | 目录结构与脚本约定收口 |
| P1-02 | 核心状态类型 | 定义 `SessionState`、`TurnState`、`KernelSnapshotMeta`、source-agnostic `PendingWait` / input-arrived signal 等类型 | `src/types.ts`、`src/state.ts` | 跨 turn / 单 turn 状态槽位固定 | 类型测试 / compile-only | 状态字段与生命周期归属明确 |
| P1-03 | step / interrupt 类型 | 定义 `KernelStep`、`StepDecision`、`KernelPhase`、`InterruptReason` | `src/step.ts`、`src/interrupt.ts` | 推进与中断不再靠字符串散落 | 单测 + 类型断言 | 所有核心 union 类型冻结 |
| P1-04 | delegate contracts | 定义 `LlmDelegate`、`CapabilityDelegate`、`HookDelegate`、`CompactDelegate` | `src/delegates.ts` | kernel 与具体实现解耦 | 假对象编译测试 | 所有依赖方均可按 contract mock |

### 4.2 Phase 2 — Reducer / Scheduler / Interrupt Core

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | reducer | 把 runtime state transition 统一进 reducer，禁止 delegate 直接改状态 | `src/reducer.ts` | 状态流转可追踪、可回放 | reducer 单测 | 关键状态转移全部有测试 |
| P2-02 | scheduler | 基于当前状态与 signal 输出 `StepDecision` | `src/scheduler.ts` | “下一步做什么”只有一个出口 | scheduler 单测 | wait / llm / tool / compact / finish 全覆盖 |
| P2-03 | interrupt controller | 统一 cancel / timeout / compact-required / waiting 信号 | `src/interrupt.ts` | 中断原因可分类、可恢复 | interrupt 单测 | 无散落的 interrupt 分支 |
| P2-04 | runner 基本循环 | 提供 step-driven runner，而非黑盒 `runTurn()` | `src/runner.ts` | session runtime 可一拍一拍驱动 kernel | scenario smoke test | 单活跃 turn 语义成立 |

### 4.3 Phase 3 — Runtime Event 与 NACP 对齐层

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | runtime event taxonomy | 冻结 `turn.started`、`llm.delta`、`tool.call.progress`、`compact.*` 等 events | `src/events.ts` | event 成为统一上游 | 单测 | client/audit 可见事件集中化 |
| P3-02 | Core message intents | 将 runtime 语义映射到现有 `tool.call.*`、`hook.*`、`context.compact.*`、`system.*` | `src/message-intents.ts` | 对齐 `nacp-core` 现实，不自造 message family | mapping 单测 | 与现有 `nacp-core` schema 一致 |
| P3-03 | Session event mapping | 将 runtime event 收敛到当前 9 个 `session.stream.event.kind` | `src/session-stream-mapping.ts` | 不突破 `nacp-session` 已冻结 catalog | mapping 单测 | `llm.delta/tool.call.progress/result/...` 全部对齐 |

### 4.4 Phase 4 — Checkpoint / Restore / Runner Facade

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | checkpoint fragment | 只导出 kernel fragment，不抢 Session DO 的存储职责 | `src/checkpoint.ts` | 可恢复状态边界清晰 | checkpoint 单测 | in-flight 与 durable state 分离 |
| P4-02 | restore contract | 提供 restore helper，要求最小合法 TurnState 重建 | `src/checkpoint.ts`、`src/runner.ts` | hibernation / resume 语义成立 | restore 单测 | 恢复后可继续推进而不破相 |
| P4-03 | websocket checkpoint 对齐 | 与 `SessionWebSocketHelper.checkpoint()/restore()` 的 replay/seq fragment 明确拼接 | `src/checkpoint.ts` | kernel 不另造 session replay shape | compatibility 单测 | checkpoint 责任边界明确 |

### 4.5 Phase 5 — Scenario Tests / 文档 / 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | 单元测试 | 覆盖 state/reducer/scheduler/interrupt/event/checkpoint | `test/*.test.ts` | 核心逻辑可回归 | `vitest run` | 高风险模块覆盖充足 |
| P5-02 | scenario tests | 用 fake delegates 跑 basic/tool/compact/interrupt/idle-input-arrival 场景 | `test/scenarios/*.test.ts` | 验证 kernel 真能驱动 turn | scenario tests | 典型 turn 与等待输入恢复路径全部跑通 |
| P5-03 | 文档与导出面 | 更新 README、公开导出、下游集成说明 | `README.md`、`src/index.ts` | session-do-runtime 等可直接接入 | 文档检查 | 包边界与用法清晰 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Kernel 包骨架与领域类型

- **Phase 目标**：把 kernel 从“设计图”变成一个可导入、可 typecheck、可被 fake delegates 驱动的独立包。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
  - `P1-04`
- **本 Phase 新增文件**：
  - `packages/agent-runtime-kernel/package.json`
  - `packages/agent-runtime-kernel/tsconfig.json`
  - `packages/agent-runtime-kernel/src/types.ts`
  - `packages/agent-runtime-kernel/src/state.ts`
  - `packages/agent-runtime-kernel/src/step.ts`
  - `packages/agent-runtime-kernel/src/delegates.ts`
- **本 Phase 修改文件**：
  - `packages/agent-runtime-kernel/README.md`
  - `packages/agent-runtime-kernel/src/index.ts`
- **具体功能预期**：
  1. 状态模型直接吸收 `context/codex` 的 `SessionState` / `TurnState` 分层经验，但不复制其 provider realtime 复杂度。
  2. 中断与等待语义直接吸收 `context/codex/codex-rs/core/src/state/turn.rs` 的 pending input / approval 思路，并保持对 follow-up input wire truth 的 source-agnostic 建模。
  3. delegate contract 只暴露 typed input / output / progress / error，不暴露 transport 细节。
- **具体测试安排**：
  - **单测**：类型守卫、默认值、union exhaustiveness
  - **集成测试**：无
  - **回归测试**：compile-only contract tests
  - **手动验证**：检查与 `nacp-core` / `nacp-session` 现有类型引用是否自洽
- **收口标准**：
  - 包骨架与脚本约定对齐现有 `nacp-core` / `nacp-session`
  - 状态与步骤类型能完整表达 design doc 的 F1-F5
  - 后续 Phase 不需要再重写核心 public types
- **本 Phase 风险提醒**：
  - 如果字段槽位一次没分干净，后面 checkpoint 与 scheduler 会被迫返工
  - 不允许为了省事把 provider/tool 细节渗进类型层

### 5.2 Phase 2 — Reducer / Scheduler / Interrupt Core

- **Phase 目标**：让 kernel 真正拥有“如何推进 turn”的单一事实来源。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
  - `P2-04`
- **本 Phase 新增文件**：
  - `packages/agent-runtime-kernel/src/reducer.ts`
  - `packages/agent-runtime-kernel/src/scheduler.ts`
  - `packages/agent-runtime-kernel/src/interrupt.ts`
  - `packages/agent-runtime-kernel/src/runner.ts`
- **本 Phase 修改文件**：
  - `packages/agent-runtime-kernel/src/state.ts`
  - `packages/agent-runtime-kernel/src/step.ts`
- **具体功能预期**：
  1. `scheduleNextStep()` 成为唯一合法推进入口。
  2. interrupt / timeout / health signal 不再在各 delegate 中各自判断。
  3. runner 提供 step-by-step API，供后续 session DO 在每一步之间插入 health check 与 checkpoint 决策。
- **具体测试安排**：
  - **单测**：状态转移、scheduler 判定、interrupt 归类
  - **集成测试**：fake delegate smoke tests
  - **回归测试**：无工具 / 无文本 / waiting / cancel / timeout 路径
  - **手动验证**：对照 `mini-agent` loop 与 `codex` state split 检查行为是否符合预期
- **收口标准**：
  - 所有推进路径都必须经过 reducer + scheduler
  - 单活跃 turn 假设在 runner 层被强制
  - 等待态与中断态能显式表达，不靠隐式布尔值
- **本 Phase 风险提醒**：
  - 过度抽象会让 runner 难落地
  - 过早做并发 lane 会破坏 v1 正确性边界

### 5.3 Phase 3 — Runtime Event 与 NACP 对齐层

- **Phase 目标**：把 kernel 产出的内部语义，准确映射到已存在的 NACP 现实，而不是重新发明协议。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `packages/agent-runtime-kernel/src/events.ts`
  - `packages/agent-runtime-kernel/src/message-intents.ts`
  - `packages/agent-runtime-kernel/src/session-stream-mapping.ts`
- **本 Phase 修改文件**：
  - `packages/agent-runtime-kernel/src/runner.ts`
- **具体功能预期**：
  1. 对齐 `packages/nacp-core/src/messages/*.ts` 的现有 message types，不新增 `llm.invoke` 或 `tool.progress` 这类未冻结域。
  2. 对齐 `packages/nacp-session/src/stream-event.ts` 的现有 9 个 kind，不突破 v1 event catalog。
  3. 把 audit / system / phase update 统一走稳定事件出口。
- **具体测试安排**：
  - **单测**：runtime event -> session kind、kernel intent -> Core message family
  - **集成测试**：fake delegates 触发 tool / hook / compact / error 场景
  - **回归测试**：kind catalog 变更保护测试
  - **手动验证**：逐项对照 `agent-runtime-kernel-by-GPT.md` 的 7.2a / 7.2b 表
- **收口标准**：
  - 所有映射都严格建立在当前包现实之上
  - downstream 无需再次猜测 runtime event 命名
  - `session-do-runtime` 可直接消费 mapping helper
- **本 Phase 风险提醒**：
  - 如果随意新增 event kinds，会与 `nacp-session` 断裂

### 5.4 Phase 4 — Checkpoint / Restore / Runner Facade

- **Phase 目标**：明确 kernel 能恢复什么、不能恢复什么，并把责任边界留给 Session DO。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/agent-runtime-kernel/src/checkpoint.ts`
- **本 Phase 修改文件**：
  - `packages/agent-runtime-kernel/src/runner.ts`
  - `packages/agent-runtime-kernel/src/state.ts`
- **具体功能预期**：
  1. checkpoint 只导出 kernel fragment，不直接写 DO storage。
  2. restore 后能重建最小合法 TurnState，但不会伪装 in-flight provider/tool 为“完全恢复”。
  3. 明确与 `SessionWebSocketHelper.checkpoint()/restore()` 的 replay/seq fragment 拼接方式。
- **具体测试安排**：
  - **单测**：checkpoint build、restore、illegal restore
  - **集成测试**：checkpoint -> restore -> continue turn
  - **回归测试**：interrupt 中 checkpoint、compact 后 checkpoint
  - **手动验证**：对照 `packages/nacp-session/src/websocket.ts` / `replay.ts`
- **收口标准**：
  - checkpoint 责任边界清楚，不抢 session runtime 的活
  - restore 后 turn 可继续推进，不破坏状态机
  - 与 websocket replay fragment 的拼接文档明确
- **本 Phase 风险提醒**：
  - 过早冻结过细 checkpoint shape，会与 storage-topology 冲突

### 5.5 Phase 5 — Scenario Tests / 文档 / 收口

- **Phase 目标**：证明 kernel 在 fake world 里能稳定跑 turn，而不是只有一堆类型与 helper。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/agent-runtime-kernel/test/state.test.ts`
  - `packages/agent-runtime-kernel/test/reducer.test.ts`
  - `packages/agent-runtime-kernel/test/scheduler.test.ts`
  - `packages/agent-runtime-kernel/test/interrupt.test.ts`
  - `packages/agent-runtime-kernel/test/events.test.ts`
  - `packages/agent-runtime-kernel/test/checkpoint.test.ts`
  - `packages/agent-runtime-kernel/test/scenarios/basic-turn.test.ts`
  - `packages/agent-runtime-kernel/test/scenarios/tool-turn.test.ts`
  - `packages/agent-runtime-kernel/test/scenarios/compact-turn.test.ts`
  - `packages/agent-runtime-kernel/test/scenarios/interrupt-turn.test.ts`
  - `packages/agent-runtime-kernel/test/scenarios/idle-input-arrival.test.ts`
- **本 Phase 修改文件**：
  - `packages/agent-runtime-kernel/README.md`
  - `packages/agent-runtime-kernel/src/index.ts`
- **具体功能预期**：
  1. fake llm delegate 能输出 delta / tool call / finish。
  2. fake capability delegate 能输出 progress / result / cancel。
  3. fake hook / compact delegate 能改变 turn 路径。
  4. kernel 在 idle / waiting 状态下能通过 input-arrived signal 正确恢复推进，而不绑定某一种 follow-up input message shape。
- **具体测试安排**：
  - **单测**：核心逻辑覆盖
  - **集成测试**：scenario tests
  - **回归测试**：已修 bug 的 replay / interrupt / mapping case，以及 input arrives while turn is idle 的路径
  - **手动验证**：README 中提供最小 `runner.advance()` 示例
- **收口标准**：
  - 场景测试能覆盖普通 turn、tool turn、compact turn、interrupt turn、idle-input-arrival turn
  - 公开导出面足够给 `session-do-runtime` 与 future packages 直接使用
  - README 清楚说明 kernel 做什么 / 不做什么
- **本 Phase 风险提醒**：
  - 如果 scenario tests 只测 happy path，后续 Session DO 集成一定返工

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2 / Phase 4 / Phase 5`
- **为什么必须确认**：这是 scheduler、checkpoint 与 session runtime 的共同前提；若改掉，整个 kernel 形状都会改变。
- **当前建议 / 倾向**：`确认 v1 坚持 single-active-turn + caller-managed health + delegate-based kernel`
- **Q**：`v1 是否正式冻结“单活跃 turn、caller-managed health、delegate-based kernel”三项原则？`
- **A**：请冻结。

#### Q2

- **影响范围**：`Phase 2 / Phase 3 / Phase 5`
- **为什么必须确认**：它决定 progress 只作为当前 active turn 的一部分，还是需要 background lane 设计。
- **当前建议 / 倾向**：`v1 不引入 background lane；long-running capability 仍归属于当前 active turn`
- **Q**：`long-running capability 的 progress 是否允许脱离当前 active turn 独立存在？`
- **A**：目前不行。首先，我们不允许 sub-agent，其次，到后期我们允许 service-binding 形状的独立运行 DO/container worker。但对于 v1 而言，我们应该在目前是不能允许任何多线程的工作。我们首要目标是简单，避免竞态，避免上下文污染。我们v1不允许长期运行的内容。但我们要为 long-running capabilities 留够接口和后续发展空间。

#### Q3

- **影响范围**：`Phase 2 / Phase 4`
- **为什么必须确认**：compact 触发来源会影响 scheduler 输入面与 interrupt model。
- **当前建议 / 倾向**：`kernel 接收 compact-required signal 与目标 budget，但不承担完整 policy engine`
- **Q**：`compact-required 的判定是否继续由 kernel 上游（session runtime / observability / workspace budgeter）提供，而非由 kernel 自己实现完整策略？`
- **A**：compact 必须由独立的上线文压缩引擎来提供支持。不能由 kernel 自己完成上下文这部分的管理。

### 6.2 问题整理建议

- 当前最关键的是 **Q1**，它会直接改变整个实现路径。
- `Q2 / Q3` 可先按推荐答案推进 action-plan，但在编码前最好定稿。

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `@nano-agent/nacp-session` event catalog | kernel 不能突破现有 9 个 event kinds | medium | Phase 3 直接以 `packages/nacp-session/src/stream-event.ts` 为 source of truth |
| `@nano-agent/nacp-core` message reality | kernel 不能自造新的 Core domain | medium | Phase 3 只做 message intent 对齐，不发明新 protocol |
| session-do-runtime 未落地 | kernel 很容易被诱导去接管 DO/WebSocket/HTTP ingress 细节 | high | 严格把 runner 保持为纯逻辑，不碰 transport |
| workspace / capability / llm 尚未实现 | fake delegates 与 scenario tests 必须先顶上 | medium | 在 Phase 5 之前建立稳定 fake implementations |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / Durable Objects / TypeScript / 单线程 V8 isolate
- **运行时前提**：单活跃 turn、无 sub-agent、caller-managed session health、checkpoint 由 Session DO 决定 flush 时机；session runtime 后续应同时支持 WebSocket-first 与 HTTP fallback，而不是只依赖 heartbeat 管理
- **组织协作前提**：`packages/*` 为独立 repo；文档与实现需按多仓策略维护；最终 deployable Worker / DO 组装层在后续运行时包中完成，而不是把当前 package 直接当发布单元
- **上线 / 合并前提**：不得破坏现有 `nacp-core` / `nacp-session` 已冻结边界

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/agent-runtime-kernel-by-GPT.md`
  - `docs/design/session-do-runtime-by-opus.md`
  - `docs/design/eval-observability-by-opus.md`
- 需要同步更新的说明文档 / README：
  - `packages/agent-runtime-kernel/README.md`
  - 根目录 `README.md`（如包名与骨架顺序需要回填）
- 需要同步更新的测试说明：
  - `docs/plan-after-nacp.md` 中的执行顺序与基础设施说明

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm --filter @nano-agent/agent-runtime-kernel build`
  - `pnpm --filter @nano-agent/agent-runtime-kernel typecheck`
- **单元测试**：
  - reducer / scheduler / interrupt / event mapping / checkpoint 的 `vitest run`
- **集成测试**：
  - fake delegates 驱动的 scenario tests
- **端到端 / 手动验证**：
  - 手动构造一次 `user input -> llm delta -> tool progress/result -> turn finish`
  - 手动构造一次 `compact-required -> compact response -> continue turn`
- **回归测试**：
  - cancel / timeout / waiting / restore / illegal phase transition
  - waiting -> input-arrived -> resume scheduling
- **文档校验**：
  - README 的 API 示例与实际导出面一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/agent-runtime-kernel` 能以独立包形式 build、typecheck、test
2. kernel 的状态推进、中断、等待、checkpoint 都有统一且可测试的事实来源
3. runtime events 与现有 `nacp-session` kind catalog 对齐，不产生新漂移
4. tool / hook / compact / system 等 intent 与现有 `nacp-core` message family 对齐
5. `session-do-runtime` 可以在不重写 kernel 逻辑的前提下接入 runner 与 checkpoint fragment

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | kernel 已具备可运行的 step-driven turn loop、统一 interrupt、统一 event、统一 checkpoint fragment |
| 测试 | 单测与 scenario tests 能覆盖核心 turn 路径与错误路径 |
| 文档 | README、导出面、Q/A 与 cross-doc 说明同步完成 |
| 风险收敛 | 不再由 session runtime 或 delegates 猜测 kernel 生命周期语义 |
| 可交付性 | 下游可直接 import 包并用 fake 或真实 delegates 驱动 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **冻结 nano-agent 主循环与状态调度核心** 为第一优先级，采用 **先状态接口、后调度中断、再事件与 checkpoint、最后用 scenario tests 收口** 的推进方式，优先解决 **turn 如何推进、何时中断、怎样恢复、怎样对齐 NACP 现实**，并把 **不掺 transport、不掺 provider、不掺真实 tool 实现** 作为主要约束。整个计划完成后，`Agent Runtime Kernel` 应达到 **可作为 session actor 心脏被独立导入与测试** 的程度，从而为后续的 `session-do-runtime`、`capability-runtime`、`llm-wrapper`、`workspace-context-artifacts` 提供稳定基础。
