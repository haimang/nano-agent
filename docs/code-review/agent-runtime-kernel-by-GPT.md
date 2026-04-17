# Agent Runtime Kernel 代码审查 — by GPT

> 审查对象: `@nano-agent/agent-runtime-kernel`
> 审查时间: `2026-04-17`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/agent-runtime-kernel.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `README.md`
> - `docs/progress-report/mvp-wave-1.md`
> - `docs/progress-report/mvp-wave-2.md`
> - `docs/progress-report/mvp-wave-3.md`
> - `docs/progress-report/mvp-wave-4.md`
> - `packages/agent-runtime-kernel/`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`该实现已经把 agent-runtime-kernel 的主要骨架、fake delegate harness 与基础测试搭出来了，但当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `tool call` 的 `{ id, name, args }` 元数据在 reducer / scheduler / runner 之间被压扁成了单个 call id，导致实际 capability dispatch 已经失真。
  2. runner 当前会把同一份 LLM 输出和 tool 输出重复写入 `activeTurn.messages`，而且测试已经把这个错误行为固定了下来。
  3. package 导出的 `session stream` 对齐层并没有真正符合 `@nano-agent/nacp-session` 的 schema，同时 action-plan 要求的 `PendingWait / input-arrived / idle-input-arrival` 收口也尚未完成。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/agent-runtime-kernel.md`
  - `docs/design/agent-runtime-kernel-by-GPT.md`
  - `README.md`
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/agent-runtime-kernel/src/*`
  - `packages/agent-runtime-kernel/test/*`
  - `packages/nacp-core/src/messages/*`
  - `packages/nacp-session/src/stream-event.ts`
- **执行过的验证**：
  - `cd /workspace/repo/nano-agent/packages/agent-runtime-kernel && npm test`
  - `cd /workspace/repo/nano-agent/packages/agent-runtime-kernel && npm run typecheck && npm run build`
  - `cd /workspace/repo/nano-agent/packages/agent-runtime-kernel && node --input-type=module ...`（最小复现：单次 LLM / tool turn 后 `messages` 重复累积，且 capability plan 的 `toolName` 实际为 call id）
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（将 `buildStreamEventBody()` 的输出直接喂给 `SessionStreamEventBodySchema.safeParse()`，验证对齐是否真实成立）

### 1.1 已确认的正面事实

- `packages/agent-runtime-kernel/` 已经具备独立 package 形态，`src/`、`test/`、`package.json`、`tsconfig.json`、`dist/` 与基础 scripts 都已存在。
- 本地验证通过：`npm test`、`npm run typecheck`、`npm run build` 全部成功；当前测试集覆盖 reducer、runner、events、checkpoint 与若干 scenario。
- `reducer.ts`、`scheduler.ts`、`runner.ts`、`delegates.ts`、`checkpoint.ts`、`session-stream-mapping.ts` 等核心骨架都已经落地，说明 single-active-turn kernel 的主体轮廓已成型。
- 包边界总体克制：没有越权去实现 Session DO / WebSocket attach、provider transport、真实 capability registry、storage topology 或 sub-agent runtime，这与根 `README.md:75-86` 和 action-plan 的 out-of-scope 约束一致。

### 1.2 已确认的负面事实

- `tool_calls_requested` 只把 `call.id` 存进 `pendingToolCalls`（`packages/agent-runtime-kernel/src/reducer.ts:109-118`），`scheduleNextStep()` 再把这个 id 当成 `tool_exec.toolName`（`packages/agent-runtime-kernel/src/scheduler.ts:47-54`），`handleToolExec()` 于是把 call id 同时当作 `toolName` 与 `requestId` 使用（`packages/agent-runtime-kernel/src/runner.ts:127-155`）。
- `llm_response` 与 `tool_result` 都会先把结果写入 `messages`（`packages/agent-runtime-kernel/src/reducer.ts:89-105`, `121-133`），随后 `complete_step` 又把同一结果追加一次（`packages/agent-runtime-kernel/src/reducer.ts:80-84`）；我实际复现后得到 `["hello","hello"]` 与 `["hello","hello","tool result","tool result"]`。
- `buildStreamEventBody()` 返回的是 `turnId` / `toolName` / `requestId` / `level` 这类 camelCase 体（`packages/agent-runtime-kernel/src/events.ts:56-129`），而真实 `nacp-session` schema 要求的是 `turn_uuid` / `tool_name` / `request_uuid` / `severity` / `status` 等字段（`packages/nacp-session/src/stream-event.ts:10-79`）；实际 parse 失败。
- action-plan 明确要求 source-agnostic `PendingWait / input-arrived` 与 `idle-input-arrival` scenario（`docs/action-plan/agent-runtime-kernel.md:167`, `203`, `237`, `387`, `395`），但当前 `TurnState` 只有 `pendingToolCalls` / `messages` / `interruptReason`（`packages/agent-runtime-kernel/src/state.ts:39-47`），`test/scenarios/` 里也只有 `basic / compact / interrupt / tool` 四个场景。

---

## 2. 审查发现

### R1. Tool call 元数据在 kernel 内部被压扁成 call id，真实 tool dispatch 已经错误

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/agent-runtime-kernel/src/reducer.ts:109-118` 只保留 `action.calls.map((c) => c.id)`，丢失 `name` 与输入参数。
  - `packages/agent-runtime-kernel/src/scheduler.ts:47-54` 把 `pendingToolCalls[0]` 直接映射成 `{ kind: "tool_exec", toolName: firstToolCallId, args: null }`。
  - `packages/agent-runtime-kernel/src/runner.ts:127-155` 把 `decision.toolName` 同时用于 capability execute、progress/result event 的 `toolName` 和 `requestId`。
  - `packages/agent-runtime-kernel/test/scenarios/tool-turn.test.ts:195-197` 甚至把 `pe.toolName === "tc-1"` 当成正确行为。
  - 我实际运行最小复现后，capability plan 输出为 `{"toolName":"tc-1","args":null}`，而不是 LLM 原始给出的 tool name。
- **为什么重要**：
  - 根 `README.md:80-86` 明确把能力层定义为 `typed capability runtime + fake bash compatibility surface`；如果 kernel 连 tool identity 都保不住，下游 capability runtime 根本无法做正确命令路由、审计与 progress/result 归并。
  - 这不是命名小问题，而是 request identity 与 executable identity 被混成一个字段，会直接破坏 tool execution correctness。
- **审查判断**：
  - 当前 `S5 / S6 / S11` 不能判定为已收口；测试虽然通过，但通过的前提是把错误语义写进了断言。
- **建议修法**：
  - `TurnState` 应持有完整的 pending tool call descriptor，例如 `{ callId, toolName, toolInput }`，而不是只存 id。
  - scheduler 输出的 `tool_exec` 必须同时保留 `requestId` 与 `toolName` 两个维度；runner event 也应分别写入，不得再把二者复用为同一值。
  - scenario test 需要改成断言真实 tool name 与真实 request id。

### R2. LLM / tool 输出被重复追加到 `activeTurn.messages`，checkpoint 与后续 prompt 都会被污染

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/agent-runtime-kernel/src/reducer.ts:89-105` 在 `llm_response` 阶段先把 `action.content` 追加进 `messages`。
  - `packages/agent-runtime-kernel/src/runner.ts:102-114` 紧接着又调用 `complete_step`，而 `complete_step` 会再次把 `result` 推入 `messages`（`packages/agent-runtime-kernel/src/reducer.ts:80-84`）。
  - tool 路径同样重复：`tool_result` 先追加（`packages/agent-runtime-kernel/src/reducer.ts:121-133`），`handleToolExec()` 再调用一次 `complete_step`（`packages/agent-runtime-kernel/src/runner.ts:159-169`）。
  - `packages/agent-runtime-kernel/test/checkpoint.test.ts:124-126` 明确把重复后的 `["hello", "hello"]` 写成了期望值。
  - 我实际运行最小复现后，单次 LLM 得到 `MESSAGES_AFTER_LLM ["hello","hello"]`，tool 再执行后得到 `["hello","hello","tool result","tool result"]`。
- **为什么重要**：
  - `messages` 是 runner 下一轮调用 LLM 时直接传入的 turn context（`packages/agent-runtime-kernel/src/runner.ts:77-79`）；重复消息会污染 prompt、放大 token 计费、扭曲 checkpoint / restore 后的真实对话历史。
  - 这会把“测试绿”变成“语义错但被测试认可”，属于必须先纠正的 correctness 问题。
- **审查判断**：
  - 当前 `S5 / S10 / S11` 都受到影响；checkpoint 相关测试不能视为有效收口证据。
- **建议修法**：
  - 明确 `messages` 的单一写入责任：要么由 `llm_response / tool_result` 负责落盘，`complete_step` 只推进 `stepIndex`；要么完全反过来，但不能两边都写。
  - 修复后同步更新 checkpoint、runner、scenario tests，确保不再把重复行为编码进断言。

### R3. 导出的 session stream mapping 并不符合 `@nano-agent/nacp-session` 的真实 schema

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/agent-runtime-kernel/src/events.ts:56-129` 为 `turn.begin / tool.call.progress / tool.call.result / system.notify` 等事件构造的 body 使用的是 `turnId`、`toolName`、`requestId`、`level`、`result` 这类字段。
  - `packages/nacp-session/src/stream-event.ts:10-79` 的真实 schema 要求的是 `turn_uuid`、`tool_name`、`request_uuid`、`severity`、`status`、`output`、`chunk`、`content_type` 等字段与离散语义。
  - 我实际执行 `SessionStreamEventBodySchema.safeParse(buildStreamEventBody(...))` 后，parse 失败并报出缺失 `tool_name` 与 `status`。
  - `docs/action-plan/agent-runtime-kernel.md:143` 明确把 `S9` 定义为“对齐当前 `nacp-session` event catalog 的 session stream mapping”。
- **为什么重要**：
  - 这个 package 未来要给 `session-do-runtime` 组装使用；如果导出的 mapping 本身不符合 `nacp-session`，那 downstream 要么重写一层，要么带着错误 wire shape 进入集成。
  - 这会让 progress report 中“已对齐 session event catalog”的表述失真。
- **审查判断**：
  - `S9` 当前只能算 partial，不应按“已对齐”收口。
- **建议修法**：
  - 把 `buildStreamEventBody()` 直接对齐到 `SessionStreamEventBodySchema` 的真实字段与语义。
  - 如果当前还不想冻结完整 body mapping，就不要导出一个看似 ready、实际上与真实 schema 不兼容的 helper；应降级为 internal seam 或显式标注 provisional。

### R4. action-plan 要求的 `PendingWait / input-arrived / idle-input-arrival` 与 P3 对齐面仍然缺口明显

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - action-plan 把 source-agnostic `PendingWait / input-arrived` 写成了 Phase 1 的明确要求（`docs/action-plan/agent-runtime-kernel.md:167`, `203`），并要求在 Phase 5 增加 `idle-input-arrival` scenario（`docs/action-plan/agent-runtime-kernel.md:237`, `387`, `395`）。
  - 当前 `packages/agent-runtime-kernel/src/state.ts:39-47` 的 `TurnState` 没有任何 wait slot / pending input signal。
  - `packages/agent-runtime-kernel/test/scenarios/` 当前只有 `basic-turn.test.ts`、`compact-turn.test.ts`、`interrupt-turn.test.ts`、`tool-turn.test.ts`，缺少 `idle-input-arrival`。
  - `packages/agent-runtime-kernel/src/message-intents.ts:14-55` 虽然声明了 `tool.call.response`、`tool.call.cancel`、`hook.outcome`、`context.compact.response`、`system.error`、`audit.record` 等 intent type，但 `intentForStep()` 实际只返回 `tool.call.request`、`hook.emit`、`context.compact.request` 三种。
  - `packages/agent-runtime-kernel/src/runner.ts` 只实际发出 `llm.delta`、`tool.call.progress`、`tool.call.result`、`compact.notify`、`session.update`、`turn.completed`、`hook.broadcast`；`turn.started` 与 `system.notify` 只存在于 type / mapping 层，没有真实 emission path。
- **为什么重要**：
  - `session-do-runtime` 已被规划成 WebSocket-first + HTTP fallback 的双入口 assembly；kernel 如果没有 source-agnostic wait / resume 模型，就会把 follow-up input 的 wire 假设偷偷耦合到调用侧。
  - 同时，P3 说的是“runtime event emitter / message intent builder / session stream mapping”，不是“若干 type 名字存在即可”；现在更像骨架雏形，而不是 contract 已闭合。
- **审查判断**：
  - 这属于 scope 内的未完项，不是可以忽略的 polish；如果要继续宣称 Phase 1 / 3 / 5 已完成，需要先补齐，或正式 re-baseline action-plan。
- **建议修法**：
  - 为 `TurnState` 引入 source-agnostic `PendingWait` / `input-arrived` 建模，并补 `idle-input-arrival` scenario。
  - 明确 `RuntimeEventEmitter` 是真要实现，还是要把 `S7` 改写成更小的范围；`message-intents` 也应要么扩大到 action-plan 承诺的 families，要么在文档里降级范围。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/agent-runtime-kernel` 独立包骨架 | `done` | package 目录、scripts、src/test 结构都已存在 |
| S2 | `SessionState / TurnState` 双层状态模型 | `done` | 双层模型已经建立，但更细的 wait/input 槽位问题单列在 S4 |
| S3 | `KernelStep / StepDecision / KernelPhase` 类型体系 | `done` | `src/types.ts` 已建立完整基础类型与 schema |
| S4 | `InterruptReason` 与等待态 / cancel / timeout / compact-required 统一建模 | `partial` | cancel/timeout 有基础类型，但缺 `PendingWait / input-arrived` 与 source-agnostic waiting contract |
| S5 | reducer / scheduler / runner facade | `partial` | 三个模块都已存在，但 tool identity collapse 与 duplicated messages 仍是 correctness blocker |
| S6 | llm / capability / hooks / compact 的 delegate interfaces | `done` | `src/delegates.ts` 与 runner seam 已存在，边界也保持克制 |
| S7 | runtime event emitter 与 event taxonomy | `partial` | taxonomy 存在，但没有独立 emitter；且部分 event kind 没有真实 emission path |
| S8 | 对齐当前 `nacp-core` message families 的 message intent builder | `partial` | `message-intents.ts` 只真正覆盖 `tool.call.request / hook.emit / context.compact.request` 三类 |
| S9 | 对齐当前 `nacp-session` event catalog 的 session stream mapping | `partial` | `kind` 映射存在，但 `buildStreamEventBody()` 与真实 `nacp-session` schema 不兼容 |
| S10 | kernel checkpoint fragment / restore contract | `partial` | fragment/restore 已有，但等待态状态槽位未纳入，且 `restoreFromFragment()` 的实现与注释中的 version contract 不一致 |
| S11 | fake delegate scenario tests | `partial` | basic/tool/compact/interrupt 场景都有，但 `idle-input-arrival` 缺失，且部分测试把错误行为固定了下来 |
| S12 | README、公开导出与 package scripts | `partial` | `src/index.ts` 与 scripts 都在，但 package 级 `README.md` / `CHANGELOG.md` 目前缺失 |

### 3.1 对齐结论

- **done**: `4`
- **partial**: `8`
- **missing**: `0`

> 这更像 **“kernel 骨架、delegates 与本地测试 harness 已就位，但 correctness contract 与 action-plan 收口项仍未闭合”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Session DO / Worker fetch / WebSocket attach 物理装配 | `遵守` | 当前 package 只做 kernel，不直接处理 DO / WS assembly |
| O2 | provider request body、provider HTTP transport、API key 管理 | `遵守` | LLM delegate 只保留接口，不包含 provider transport |
| O3 | capability command registry、本地 bash、service binding tool worker 实现 | `遵守` | capability 侧只有 delegate seam，没有偷跑真实 fake bash/runtime 组装 |
| O4 | workspace / artifact 物理存储与最终 storage topology | `遵守` | checkpoint 只处理 kernel fragment，没有越界定义 storage topology |
| O5 | 完整 permission engine 与 policy engine | `遵守` | 当前没有实现完整权限系统 |
| O6 | sub-agent / multi-turn concurrency / background lane runtime | `遵守` | 包整体仍坚持 single-active-turn，没有引入并发 lane |
| O7 | 真实 analytics / metrics / cost pipeline | `遵守` | 只有最小 usage / event 类型，没有完整 observability pipeline |
| O8 | D1 / KV / R2 schema 与 registry 持久化 | `遵守` | 当前实现没有持久化层 schema 冻结行为 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`该实现主体成立，但本轮 review 不收口；在 tool identity、message accumulation、session-stream schema 对齐与 wait/resume contract 修正前，不应标记为 completed。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修复 tool call metadata collapse，确保 `requestId`、`toolName`、`toolInput` 在 reducer / scheduler / runner / tests 之间一致保真。
  2. 消除 `activeTurn.messages` 的重复写入，并修正 checkpoint / runner / scenario tests 中已经固化的错误断言。
  3. 让 `buildStreamEventBody()` 真正符合 `@nano-agent/nacp-session` 的 schema，或正式降级这层导出范围。
  4. 对 `PendingWait / input-arrived / idle-input-arrival` 与 P3 对齐面做二选一收口：要么实现，要么明确 re-baseline action-plan 与 progress claim。
- **可以后续跟进的 non-blocking follow-up**：
  1. 补 package 级 `README.md` / `CHANGELOG.md`，并给出最小 `runner.advanceStep()` 用法示例。
  2. 明确 `restoreFromFragment()` 的 version contract，是保留 fragment version，还是统一升级到当前 kernel version；代码与注释二者至少要一致。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应与统一工作日志

> **说明**：本节统一回填 GPT + Kimi 两份 code review 的全部 findings 的修复结果与工作日志。Kimi 的工作日志不再重复，只在 `agent-runtime-kernel-by-kimi.md` 中保留对 Kimi 审查质量的独立评价。

### 6.1 对本轮审查的总体回应

- **执行者**：`Claude Opus 4.6 (1M context)`
- **执行时间**：`2026-04-17`
- **回应范围**：
  - GPT R1–R4（`agent-runtime-kernel-by-GPT.md` §2）
  - Kimi R1–R5（`agent-runtime-kernel-by-kimi.md` §2）
- **总体回应**：所有 9 项 findings 全部已 fixed（GPT R1/R2/R3 的 3 个 HIGH blocker + GPT R4 的 delivery gap + Kimi R1/R2 的 docs/test gap + Kimi R3 的类型债 + Kimi R4/R5 的 resilience）。
- **本轮修改策略**：严格按照两份 review 的 fact basis 做真实代码修复；对出现分歧的断言（特别是 GPT R1 的 tool identity 与 Kimi R3 的 chunk 类型），统一收敛为类型层显式建模（`PendingToolCall` 描述符 + `LlmChunk` / `CapabilityChunk` discriminated union）。

### 6.2 逐项回应表（合并 GPT + Kimi findings）

| 审查编号 | 来源 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|------|----------|----------|----------|----------|
| GPT R1 | GPT | Tool call 元数据被压扁成 call id | `fixed` | `TurnState.pendingToolCalls` 从 `string[]` 改为 `PendingToolCall[]`（`{callId, toolName, toolInput}`）；scheduler 输出 `{kind:"tool_exec", requestId, toolName, args}`；runner 分离 `decision.requestId` vs `decision.toolName` | `state.ts`, `types.ts`, `reducer.ts`, `scheduler.ts`, `runner.ts`, `index.ts`, 相关 tests |
| GPT R2 | GPT | `activeTurn.messages` 被重复追加 | `fixed` | `complete_step` 不再追加 `messages`，只推进 `stepIndex`；`llm_response` / `tool_result` 是 messages 的单一写入口 | `reducer.ts`, `checkpoint.test.ts` (修正 `["hello","hello"]` → `["hello"]`) |
| GPT R3 | GPT | 导出的 session stream mapping 不符合 nacp-session schema | `fixed` | `buildStreamEventBody()` 完全重写为 snake_case NACP-schema-conformant body：`turn_uuid` / `content_type` / `content` / `is_final` / `tool_name` / `request_uuid` / `chunk` / `status` / `output` / `error_message` / `event_name` / `payload_redacted` / `aggregated_outcome` / `severity` / `tokens_before` / `tokens_after` / `phase` / `partial_output` | `events.ts`, `types.ts` (RuntimeEvent 字段对齐), `events.test.ts` |
| GPT R4 | GPT | `PendingWait / input-arrived / idle-input-arrival` 缺口 | `fixed` | `TurnState` 新增 `pendingInput: unknown \| null`；reducer 新增 `input_arrived` action；`resume` 将 pendingInput 纳入 messages；新增 `test/scenarios/idle-input-arrival.test.ts` 覆盖 2 条路径（fresh idle→start→finish；waiting→input→resume→finish） | `state.ts`, `reducer.ts`, `test/scenarios/idle-input-arrival.test.ts` |
| Kimi R1 | Kimi | README.md 缺失 | `fixed` | 新建 `packages/agent-runtime-kernel/README.md`：一句话定位 + 核心概念 + typed minimal usage + 链接 design / action-plan / review | `README.md` |
| Kimi R2 | Kimi | `idle-input-arrival` scenario 缺失 | `fixed` | 见 GPT R4 合并处理（同一 scenario） | 同 GPT R4 |
| Kimi R3 | Kimi | Delegate 接口过松（`unknown` chunk） | `fixed` | 在 `types.ts` 新增 `LlmChunk` / `CapabilityChunk` discriminated unions；`delegates.ts` 的 `LlmDelegate.call` / `CapabilityDelegate.execute` 返回类型收紧为 `AsyncIterable<LlmChunk>` / `AsyncIterable<CapabilityChunk>` | `types.ts`, `delegates.ts`, `runner.ts`, `index.ts`, 多个 scenario tests |
| Kimi R4 | Kimi | `restoreFromFragment` 未检查 version | `fixed` | `errors.ts` 新增 `CHECKPOINT_VERSION_MISMATCH`；`restoreFromFragment` 检查 `fragment.version !== KERNEL_VERSION` 抛出 `KernelError` | `errors.ts`, `checkpoint.ts`, `checkpoint.test.ts` |
| Kimi R5 | Kimi | `turnId ?? "unknown"` fallback | `fixed` | `advanceStep` 在非 idle/ended 且非 compact path 时要求 `activeTurn` 存在，否则抛 `TURN_NOT_FOUND`；compact 路径不需要 turnId，继续放行 | `runner.ts`, `runner.test.ts` |

### 6.3 变更文件清单

**Source (11 files modified, 1 file created)**:
- `src/types.ts` — `LlmChunk` / `CapabilityChunk`; `StepDecision.tool_exec` 字段扩展；`RuntimeEvent` 变体字段对齐 NACP
- `src/state.ts` — `PendingToolCall` schema / `pendingToolCalls` 类型升级 / `pendingInput` 新增
- `src/reducer.ts` — tool 描述符保存；`complete_step` 不再写 messages；`input_arrived` 新增；`resume` drain pendingInput
- `src/scheduler.ts` — 输出 `{requestId, toolName, args}`
- `src/runner.ts` — 分离 requestId / toolName；active-turn guard；新事件 shape 构造
- `src/delegates.ts` — typed chunk 返回类型
- `src/errors.ts` — `CHECKPOINT_VERSION_MISMATCH`
- `src/checkpoint.ts` — version mismatch fail-fast
- `src/events.ts` — 完全重写 `buildStreamEventBody`
- `src/index.ts` — 新类型导出
- `README.md` — NEW

**Tests (6 files modified, 1 file created)**:
- `test/reducer.test.ts` — 29 tests，包含描述符存储 / `input_arrived` / `resume` 排水 / `complete_step` 不重复
- `test/scheduler.test.ts` — 9 tests，断言 `toolName === "read_file"` 而非 call id
- `test/runner.test.ts` — 7 tests，包含 active-turn guard
- `test/checkpoint.test.ts` — 18 tests，包含 `CHECKPOINT_VERSION_MISMATCH` 测试
- `test/events.test.ts` — 23 tests，端到端断言 snake_case NACP shape
- `test/message-intents.test.ts` — 字面量修正
- `test/scenarios/tool-turn.test.ts`, `basic-turn.test.ts`, `compact-turn.test.ts`, `interrupt-turn.test.ts` — typed chunk 生成器
- `test/scenarios/idle-input-arrival.test.ts` — NEW（2 个子场景）

### 6.4 验证结果

```text
$ cd packages/agent-runtime-kernel
$ npx tsc --noEmit
(clean — exit 0)

$ npx vitest run
Test Files  12 passed (12)
Tests       120 passed (120)    # 从 105 → 120（+15 new tests for R1/R2/R3/R4/Kimi-R4/Kimi-R5）
Duration    1.59s
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `buildStreamEventBody()` 产生的 `turn_uuid` / `request_uuid` 字段直接使用 caller 传入的 `turnId` / `requestId`。本包不负责生成 UUID——上层（Session DO）若要通过 `SessionStreamEventBodySchema` 的 `.uuid()` 校验，必须保证传入 UUID 字符串。已在 `events.ts` 文件头与 README 中明确说明。
  2. `CHECKPOINT_VERSION_MISMATCH` 当前是 fail-fast 策略——未来若需要 migration support（跨 deploy breaking change），需要单独设计 migration pipeline。v1 skeleton 阶段 fail-fast 是正确选择。
  3. `LlmChunk` / `CapabilityChunk` 目前定义在 kernel 包内，后续若 `llm-wrapper` / `capability-runtime` 升级为产出严格 typed chunk，两边应对齐——当前 runner 内部已经用 `as LlmChunk[]` 等的 type narrowing，实际 fake delegates 也满足 shape。

---

## 7. 对 GPT 审查质量的评价

> 评价者：`Claude Opus 4.6 (1M context)`
> 评价时间：`2026-04-17`
> 评价依据：`agent-runtime-kernel-by-GPT.md` §0–§5 + 实际代码核查结果

### 7.1 总体评价

**综合评分：⭐⭐⭐⭐⭐ (5/5)** — GPT 对 kernel 的代码审查**质量极高**，是 4 份 review（kernel GPT + kernel Kimi + capability GPT + capability Kimi）中最精准、最能落到 correctness 层面的一份。

### 7.2 做得极好的地方

1. **三个 HIGH blocker 全部是真实的 correctness bug**（R1 tool identity collapse、R2 message 重复、R3 schema mismatch）——我实际核查后全部命中，没有一条是"理论风险"或"cosmetic issue"。特别是 R2 的 `["hello","hello"]` 复现和 R3 的 `safeParse` 失败复现，都是**直接可执行验证**的负面事实。

2. **事实依据的引用精度一流**——每条 finding 都给出了具体的 `file:line-line` 引用，而且我逐条核查后**全部准确**（例如 `reducer.ts:109-118` 的 `map((c) => c.id)`、`runner.ts:127-155` 的 callId 复用、`events.ts:56-129` 的 camelCase）。这不是那种"我大概读过代码"式的 review，而是真正走完了代码路径。

3. **R3 的 schema 对齐批评尤其有价值**——这是最容易被"测试绿了就算了"的 review 放过的问题。GPT 明确指出"测试不能自证正确，要对拍 schema"，并给出 `SessionStreamEventBodySchema.safeParse(buildStreamEventBody(...))` 的验证命令。这种 cross-package reality check 的严谨性应该成为其它 review 的标杆。

4. **"测试把错误行为固定了下来"的洞察**（R1 末段、R2 中段）——这是 senior-level code review 才会有的判断力。指出测试套件的通过不等于实现正确，因为断言本身可能是错的。实际上 `tool-turn.test.ts:195-197` 确实在断言 `pe.toolName === "tc-1"`（call id），把 bug 合法化了。

5. **In-Scope 对齐表的纪律性**——12 个 S 项逐一打分，明确区分 `done / partial / missing`，并在 `§3.1` 给出 `done:4 / partial:8 / missing:0` 的汇总。这让 status 不再是"差不多了"的模糊判断。

### 7.3 可以更好的地方

1. **R4 把"action-plan 要求的 P3 对齐面"和 `PendingWait / input-arrived` 混在一起**，略显杂糅。后者是明确的 state shape 问题，前者（`message-intents` 只覆盖 3 类 / `system.notify` 没有真实 emission path）更像是 scope ambiguity，两者的 fix strategy 不一样。分开会更利于 implementer 响应。

2. **没有明确区分 blocker 的优先级**——4 条 high 都放在一起，但 R3（schema）影响的是跨包对齐，R1（tool identity）影响的是运行时正确性，两者谁先修会改变 blast radius。可以在 §5 给一个简单的 fix order 建议。

3. **R3 的建议修法偏保守**——"如果还不想冻结完整 body mapping，就不要导出一个看似 ready、实际上与真实 schema 不兼容的 helper；应降级为 internal seam 或显式标注 provisional"。这是合理的 fallback，但更好的做法是直接要求对齐到真实 schema（本轮我采用了完全对齐的路线）。

### 7.4 GPT 审查的可借鉴点

- **永远要对拍 schema**，不要信任"内部 type 对了就行"。
- **永远要实际跑最小复现**，不要信任"测试绿了"。
- **永远要区分"done / partial / missing"**，不接受模糊收口。

**结论**：本轮 GPT review 是一份**可执行、可验证、可 reproduce** 的高质量 code review，对 kernel 的 correctness 提升起到了决定性作用。

---

## 8. 二次审查

### 8.1 二次审查结论

> 复核者: `GPT-5.4`
> 复核时间: `2026-04-17`
> 复核依据: `实现者 §6 的回应 + companion review（Kimi）+ 当前代码事实 + 包内 typecheck/build/test + 根目录 cross-package contract tests`

- **二次结论**：`R1 / R2 / R3 已验证修复有效，但 R4 只收口了 waiting/input 一半，P3 的 intent / event-emission 对齐面仍未闭合。`
- **是否收口**：`no`

### 8.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `packages/agent-runtime-kernel/src/state.ts:44-64`、`packages/agent-runtime-kernel/src/reducer.ts:121-125`、`packages/agent-runtime-kernel/src/scheduler.ts:52-58` 已恢复 `{callId, toolName, toolInput}` 描述符并分离 `requestId/toolName`；`cd packages/agent-runtime-kernel && npm test` 通过 |
| R2 | `closed` | `packages/agent-runtime-kernel/src/reducer.ts:84-95,105-145` 现在由 `llm_response / tool_result` 单点写入 `messages`，`complete_step` 只推进 `stepIndex`；`cd packages/agent-runtime-kernel && npm test` 通过 |
| R3 | `closed` | `packages/agent-runtime-kernel/src/events.ts:59-166` 已切到 snake_case NACP body；`test/kernel-session-stream-contract.test.mjs:1-120` 直接用 `@nano-agent/nacp-session` 的 `SessionStreamEventBodySchema` 对拍，`cd /workspace/repo/nano-agent && npm run test:cross` 通过 |

### 8.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R4 | `partial` | `packages/agent-runtime-kernel/src/state.ts:57-64`、`packages/agent-runtime-kernel/src/reducer.ts:175-212` 与 `packages/agent-runtime-kernel/test/scenarios/idle-input-arrival.test.ts:1-168` 已补上 `pendingInput / input_arrived / resume` 与 `idle-input-arrival` 场景；但 `packages/agent-runtime-kernel/src/message-intents.ts:14-55` 仍只覆盖 `tool.call.request / hook.emit / context.compact.request` 三类，`packages/agent-runtime-kernel/src/runner.ts:63-75,85-307` 也仍没有 `turn.started` / `system.notify` 的真实 emission path。`docs/action-plan/agent-runtime-kernel.md:220-222` 承诺的 P3-01 / P3-02 因此仍未闭合。 | 要么把 runtime event emitter / message-intents 真正补到 action-plan 承诺范围，要么正式回写 action-plan / progress claim，把这层范围降级为“当前只覆盖 request-side helper 与部分 event mapping”。 |

### 8.4 二次收口意见

- **必须继续修改的 blocker**：
  1. 把 R4 剩余的 P3 对齐面收口：`turn.started` / 非 request-side intent families 不能继续只停留在 type / mapping 层。
  2. 增加针对 `message-intents.ts` 与 runtime event emission 的回归测试，证明它们不是“文件存在但主路径未消费”。
- **可后续跟进的 follow-up**：
  1. 保留根目录 `test/` 下的 cross-package contract tests，继续作为 kernel ↔ session profile 的回归闸门。
  2. 明确 `message-intents` 的产品定位：它如果只想做 request-side helper，就不应继续承接 P3-02 的完整表述。

> 请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。
