# Nano-Agent Agent Runtime Kernel 功能簇设计

> 功能簇: `Agent Runtime Kernel`
> 讨论日期: `2026-04-16`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/design/hooks-by-GPT.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/plan-after-nacp.md`
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么现在必须冻结 Agent Runtime Kernel

`nacp-core` 和 `nacp-session` 已经收口，它们解决了 **内部消息合同** 与 **client ↔ session DO 的会话流合同**，但它们都没有回答一个更上层的问题：

> **在 session DO 内，nano-agent 本体的主循环究竟长什么样。**

如果这层不先冻结，后续的 `hooks`、`llm-wrapper`、`capability runtime`、`workspace/context/artifacts` 都只能停留在“功能簇设计”，没法真正装配成一个能跑的 session actor。

### 0.2 本次讨论的前置共识

- nano-agent 是 **Cloudflare-native、WebSocket-first、DO-centered、Worker/V8 isolate 宿主** 的 agent runtime。
- nano-agent **不以 Linux / shell / 本地 FS 为宿主真相**。
- `NACP-Core` 负责内部 envelope；`NACP-Session` 负责 client-visible session stream。
- `Hooks` 是治理与扩展层；`LLM Wrapper` 是模型执行边界；两者都应被 Runtime Kernel 调度，而不是反向定义 Runtime Kernel。
- v1 的 nano-agent 仍以 **单 agent、单线程、单活跃 turn** 为核心正确性模型。
- ack / heartbeat 已在 `nacp-session` 收口为 **caller-managed health enforcement**，因此 session DO lifecycle 必须有显式 tick/health 检查点。

### 0.3 显式排除的讨论范围

- 不讨论 provider 适配细节（属于 `LLM Wrapper`）
- 不讨论 fake bash 命令细节（属于 `Capability Runtime`）
- 不讨论 virtual FS / artifact 物理存储细节（属于 `Workspace / Context / Artifacts`）
- 不讨论完整 session DO 部署 wiring（属于后续 `session-do-runtime`）
- 不讨论 registry / DDL / analytics pipeline

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Agent Runtime Kernel`
- **一句话定义**：Agent Runtime Kernel 是 nano-agent 本体的**主循环与状态调度核心**，负责在一个 session actor 内组织 turn、step、事件、取消、中断、compact、tool 调用与 LLM 调用。
- **边界描述**：
  - **包含**：session state / turn state、step scheduler、turn reducer、interrupt/cancel contract、compact seam、runtime event emission、delegate interfaces
  - **不包含**：具体 provider SDK、具体 tool/bindings 实现、具体 workspace 存储实现、WebSocket ingress 细节、registry / DDL

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Session Actor** | 一个 Durable Object 承载的 agent 会话实例 | 生命周期长于单个 turn |
| **Session State** | 跨 turn 持续存在的热状态 | 如历史、权限快照、checkpoint metadata |
| **Turn State** | 单个 turn 内的运行态 | 如 pending input、pending approvals、当前 tool/llm step |
| **Step** | turn 内的一次原子推进动作 | 如 `invoke-llm`、`run-tool`、`compact`、`emit-event` |
| **Reducer** | 对 runtime state 做唯一合法状态转移的中心逻辑 | 不允许各模块私改状态 |
| **Runtime Tick** | session DO 主动执行的一次 health / schedule / flush 检查点 | 用于 caller-managed health enforcement |
| **Delegate** | 由 kernel 调用、但不由 kernel 实现的外部单元 | 如 LLM executor、tool executor、hook dispatcher |
| **Checkpoint** | 为 hibernation / resume 写出的最小恢复快照 | 不是全量数据库导出 |
| **Interrupt** | 中断当前 turn 的信号 | 包括 cancel、timeout、permission wait、compact required |

### 1.3 参考调查报告

- `context/mini-agent/mini_agent/agent.py` — `run()` 的单 agent loop（`321-420`）
- `context/codex/codex-rs/core/src/state/session.rs` — session-scoped state 分层（`19-229`）
- `context/codex/codex-rs/core/src/state/turn.rs` — turn-scoped state / pending approvals / cancellation token（`26-247`）
- `context/codex/codex-rs/core/src/realtime_conversation.rs` — conversation manager 与 active state 分离（`87-260`）
- `context/claude-code/services/tools/toolOrchestration.ts` — tool batch orchestration（`19-177`）
- `context/claude-code/services/tools/toolExecution.ts` — tool execution 与 permission/hook/telemetry 串联（`126-131`, `173-245`）
- `context/claude-code/services/compact/compact.ts` — compact 入口、附件/消息裁剪、post-compact reinjection（`55-90`, `122-145`, `202-240`）
- `context/claude-code/bridge/sessionRunner.ts` — session runner / activity extraction / permission request bridge（`28-67`, `107-199`）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**：核心骨架
- **服务对象**：
  1. session DO 本体
  2. llm-wrapper
  3. capability runtime
  4. hooks runtime
  5. observability / eval harness
- **它依赖于**：
  - `NACP-Core`
  - `NACP-Session`
  - hooks / llm-wrapper / capability runtime 的 delegate contract
  - workspace/context/artifact runtime
  - DO storage checkpoint 能力
- **它被谁依赖**：
  - session DO runtime
  - storage topology
  - eval / observability
  - hooks / tool / compact 的上游调度语义

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `NACP-Session` | Kernel -> Session | 强 | kernel 的所有 client-visible 进展都要落为 `session.stream.event` |
| `NACP-Core` | Kernel -> Core | 中 | 内部 hook / tool / compact / audit 可通过 Core 域消息外送 |
| `LLM Wrapper` | 双向 | 强 | kernel 发起模型执行，wrapper 回传 normalized stream/result/error |
| `Capability Runtime` | 双向 | 强 | kernel 发起 tool/capability 执行，接收 progress/result/cancel outcome |
| `Hooks` | 双向 | 强 | kernel 决定 hook 触发点，hook outcome 又能影响 kernel 行为 |
| `Workspace / Context / Artifacts` | 双向 | 强 | kernel 决定何时读取上下文、何时 compact、何时创建 artifact ref |
| `Permission / Policy` | Kernel -> Permission | 中 | v1 可由 hooks/capability delegates 提供结果，但 kernel 决定阻塞点 |
| `Session DO Runtime` | Session DO -> Kernel | 强 | kernel 不负责 transport / WebSocket 细节，但 session DO 以其为心脏 |
| `Eval / Observability` | Kernel -> Eval | 强 | timeline、trace、replay 都依赖 kernel 暴露稳定观察点 |
| `Registry / DDL` | Kernel -> Registry | 弱 | registry 的最终形态要由 kernel 跑出来的访问模式反推 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Agent Runtime Kernel` 是 **session actor 内的主循环与状态调度核心**，负责 **把 llm、tools、hooks、compact、checkpoint 组织成可恢复的单 turn 执行模型**，对上游提供 **稳定的 runtime phases / event points / delegate contract**，对下游要求 **显式状态边界、显式中断边界、显式观察点**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| sub-agent 树式调度 | codex / claude-code | 与 v1 “单 agent、单线程”正确性模型冲突 | 可能 |
| provider 直连 WebSocket / realtime 会话内核 | codex | Worker v1 成本过高，且会污染 kernel 边界 | 可能 |
| tool 并行作为 kernel 默认行为 | claude-code | isolate/DO 下先保证顺序、恢复与可回放 | 可能 |
| 递归式“模型自己驱动全部状态” | mini-agent 风格简循环的放大版 | 云端 actor 需要显式 phase/interrupt/checkpoint | 否 |
| giant orchestrator 直接持有所有实现细节 | claude-code 重型 orchestrator | 不利于 service binding / Worker-native 组合 | 否 |
| client-facing TUI / REPL 状态机 | 本地 CLI 设计 | nano-agent 的交互入口是 WebSocket session，不是本地终端 UI | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Step scheduler | `scheduleNextStep(state): StepDecision` | 单活跃 turn、顺序推进 | 多 lane / background queue |
| LLM delegate | `invokeLLM(turnCtx, request)` | 单 provider call path | service-binding inference gateway |
| Tool delegate | `invokeCapability(stepCtx, call)` | 顺序工具调用 | 并发安全分组 / long-running worker |
| Hook delegate | `emitHook(event, payload)` | inline hook 为主 | observer/queue fan-out |
| Compact delegate | `runCompact(sessionCtx, compactInput)` | 显式边界调用 | auto-compact policy engine |
| Checkpoint contract | `buildCheckpoint()` / `restoreCheckpoint()` | DO hibernation 场景 | partial snapshot / export bundle |
| Interrupt model | `InterruptReason` union | cancel / timeout / compact-required | user steering / background handoff |

### 3.3 完全解耦点（哪里必须独立）

- **Session State 与 Turn State**
  - **解耦原因**：`codex` 把 `SessionState` 与 `TurnState` 分开（`context/codex/codex-rs/core/src/state/session.rs:19-229`, `state/turn.rs:96-247`）是对的；nano-agent 也不应把跨 turn 持久态和单 turn 暂存态揉在一起。
  - **依赖边界**：Session State 可被 checkpoint；Turn State 在 turn 结束时清空或归档。

- **Kernel Reducer 与 Delegate Executors**
  - **解耦原因**：kernel 负责“何时做”，delegate 负责“怎么做”。
  - **依赖边界**：kernel 只依赖 typed result / progress / error，不依赖 provider / tool 实现细节。

- **Runtime Event Emitter 与 Transport**
  - **解耦原因**：event emission 是 kernel 的职责；真正送往 WebSocket / audit sink / queue 是 transport/runtime 装配层职责。
  - **依赖边界**：kernel 产出 typed runtime events，session DO runtime 再映射到 `NACP-Session` / `NACP-Core`。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 turn 状态转移都进 `KernelReducer`**
- **所有调度决策都进 `StepScheduler`**
- **所有 runtime event 都进统一 `RuntimeEventEmitter`**
- **所有 checkpoint 构建都进 `CheckpointBuilder`**
- **所有 cancel/interrupt 判定都进 `InterruptController`**

如果这些散在多个 delegate 里，后面一定会出现：

1. lifecycle 语义不一致
2. replay / restore 不完整
3. observability 点位不统一

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：`mini_agent/agent.py` 的 `run()` 是一个非常典型的单 agent loop：检查 cancel、压缩历史、调用 LLM、追加 assistant message、执行 tool calls、直到无 tool call 或达到步数上限（`context/mini-agent/mini_agent/agent.py:321-420`）。
- **亮点**：
  - loop 简单清晰
  - `max_steps` 与 cancel checkpoint 显式存在
  - 消息数组就是核心状态
- **值得借鉴**：
  - v1 的 runtime kernel 要保留这种“小而明”的主循环可读性
  - cancel 必须只在“安全点”生效，而不是任意位置打断
- **不打算照抄的地方**：
  - 把几乎所有状态都压进一条 message list
  - 将 compact / tool / runtime lifecycle 混在单函数里
  - 默认本地进程 / 本地文件系统的宿主假设

### 4.2 codex 的做法

- **实现概要**：`codex` 把 session 级和 turn 级状态拆得很明确。`SessionState` 管跨 turn 的 history / rate limit / permission profile / startup prewarm（`state/session.rs:19-229`）；`TurnState` 管 pending approvals、pending input、mailbox delivery phase、granted permissions（`state/turn.rs:96-247`）。
- **亮点**：
  - session / turn 分层非常成熟
  - interrupt / approval / pending input 都有独立状态槽
  - active conversation manager 和 turn state 不是一个东西（`realtime_conversation.rs:87-260`）
- **值得借鉴**：
  - nano-agent 应该一开始就把 session state / turn state 分开
  - mailbox / approval / pending input 这类“等待外部响应”的东西，不能直接散在工具执行代码里
- **不打算照抄的地方**：
  - 过重的 provider realtime / conversation manager 工程量
  - 本地 sandbox / multi-lane 复杂度
  - Responses/realtime 绑定过深

### 4.3 claude-code 的做法

- **实现概要**：`claude-code` 没有单独写一个叫 Kernel 的薄层，但实际上把 runtime kernel 分散在 tool orchestration、tool execution、compact、session runner、session storage 这些模块里：
  - `toolOrchestration.ts:19-177` 负责把工具调用按并发安全性分批
  - `toolExecution.ts:126-245` 把 permission、hooks、telemetry、tool result storage 串在一起
  - `compact.ts:55-240` 管理 compact 前后边界与 reinjection
  - `bridge/sessionRunner.ts:28-67,107-199` 管理会话级活动与 permission request bridge
- **亮点**：
  - 对真实产品 runtime 问题覆盖很深
  - compact 不是附属功能，而是 loop 一部分
  - tool 执行与 hooks / permission / telemetry 的挂接很完整
- **值得借鉴**：
  - kernel 必须给 compact 预留一等入口
  - tool execution 不应只是“run + return”，而应允许 hook / telemetry / persisted output 等 side effects
  - session activity / progress 提炼成统一事件很重要
- **不打算照抄的地方**：
  - 太多 Node/local FS 前提
  - orchestration 分散在很多本地 CLI 模块里，不适合 Worker-first skeleton
  - 过深耦合本地 session transcript / permission 文件

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| Kernel 显式程度 | 高（单 loop） | 高（state 分层） | 中（分散 orchestration） | 高 |
| Session/Turn 分层 | 弱 | 强 | 中 | 强 |
| 中断/等待建模 | 弱 | 强 | 中高 | 强 |
| compact 位置 | 较弱 | 中 | 强 | 强 |
| tool orchestration | 低 | 中高 | 高 | 中 |
| 对 Worker 宿主适配度 | 低 | 低 | 低 | 高 |
| 适合作为 nano-agent 蓝本的部分 | 单 loop clarity | session/turn split | orchestration & compact seams | explicit kernel + delegates |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Session State / Turn State 双层模型**
  - 必须把跨 turn 的热状态与单 turn 的运行态分开，否则 hibernation / compact / resume 很快会失控。

- **[S2] 显式 Step Scheduler**
  - kernel 必须能回答“下一步该做什么”，而不是把调度逻辑散落到 hooks / llm / tool delegates。

- **[S3] 显式 Interrupt / Cancel / Timeout 边界**
  - `cancel`、`compact-required`、`timeout`、`permission-wait` 都必须进入统一中断模型。

- **[S4] Runtime Event Emitter**
  - turn 开始、llm delta、tool progress、compact 边界、turn 结束都要变成统一 runtime event，再由 session DO 映射到 `NACP-Session`。

- **[S5] Delegate Contract**
  - LLM、tool、hooks、compact 都必须通过 typed delegate interface 接入 kernel。

- **[S6] Checkpoint / Restore Contract**
  - 不是现在就做全套 storage，而是先定义什么状态允许 checkpoint、什么状态不允许恢复。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 多 turn 并发执行**
  - v1 不做 concurrent turns；单活跃 turn 是早期正确性边界。

- **[O2] sub-agent / swarm runtime**
  - 当前 README 已明确早期不以 sub-agent 为核心。

- **[O3] provider realtime session kernel**
  - 这会让 runtime kernel 被某一类 provider transport 反向定义。

- **[O4] 完整 permission engine**
  - kernel 只定义阻塞点和调用时机，不承载权限策略本体。

- **[O5] 业务 registry / database schema**
  - 这些是 runtime 验证后的收敛层，不是 kernel 的第一版范围。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| compact policy engine | out-of-scope | kernel 只留 compact seam，不在 v1 冻结“何时 compact”的完整策略 |
| tool progress event emission | in-scope | kernel 必须定义如何接收和外送 progress |
| permission wait / user input wait | in-scope | 这些会影响 turn lifecycle，不能留给业务层私自处理 |
| long-running capability worker | defer | contract 要留，但真正后台 worker 行为由 capability runtime 冻结 |
| health check tick | in-scope | `nacp-session` 已明确 caller-managed，需要 session DO lifecycle 调用 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **显式状态机 + step scheduler** 而不是 **“循环里直接 if/else 推进”**
   - **为什么**：云端 session actor 要求 checkpoint、resume、compact、interrupt 都可观察、可恢复。
   - **我们接受的代价**：多写 reducer / state / event 类型。
   - **未来重评条件**：如果 v1 的 step 种类极少且完全稳定，可以考虑薄化 façade，但不会回退到隐式状态。

2. **取舍 2**：我们选择 **Session State / Turn State 分层** 而不是 **一个大对象装所有状态**
   - **为什么**：这能直接对齐 hibernation / restore 和 turn-local cleanup。
   - **我们接受的代价**：更多状态同步点。
   - **未来重评条件**：只有在某些状态证明永远不会跨 turn 时，才允许从 Session State 下沉到 Turn State。

3. **取舍 3**：我们选择 **delegate-based kernel** 而不是 **巨石 orchestrator**
   - **为什么**：后续 hooks / llm-wrapper / capability runtime / workspace runtime 都需要独立包与独立 action-plan。
   - **我们接受的代价**：接口设计要更克制、测试桩更多。
   - **未来重评条件**：如果某些 delegate 交互过于频繁，再考虑局部 façade 聚合，不改 kernel 边界。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| kernel 设计过重 | 一开始塞入过多 provider/tool 细节 | 实现迟缓、难以落地 | 严格坚持 delegate contract，不直接吞业务实现 |
| 状态边界不清 | Session / Turn 状态互相泄漏 | checkpoint / resume 错乱 | 一开始就分层，并为每类状态写“生命周期归属表” |
| runtime event 太散 | 不同 delegate 自己发事件 | session stream shape 不一致 | 统一 `RuntimeEventEmitter` |
| compact 变成补丁逻辑 | 等到实现时再插入 compact | turn lifecycle 断裂 | 设计阶段就把 compact 设为显式 step |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续写 session DO、hooks、llm-wrapper 时都有统一 runtime seam，不会互相猜对方语义。
- **对 nano-agent 的长期演进**：能把“可恢复 session actor”真正变成产品级内核，而不是几个 helper 的拼装物。
- **对"上下文管理 / Skill / 稳定性"三大深耕方向的杠杆作用**：
  - 上下文管理：compact / context reinjection 有正式边界
  - Skill：后续 skill runtime 可以作为 kernel delegate 接入
  - 稳定性：interrupt / checkpoint / event emission 都有统一骨架

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Session/Turn State Model | 定义跨 turn 与 turn 内状态 | ✅ **状态槽位与生命周期归属一次性冻结** |
| F2 | Step Scheduler | 决定 turn 下一步动作 | ✅ **任何 runtime 推进都经过统一调度函数** |
| F3 | Interrupt Controller | 统一 cancel/timeout/compact-required/waiting | ✅ **中断原因被建模成显式 union，而不是字符串散落** |
| F4 | Runtime Event Emitter | 统一对外可观察事件 | ✅ **所有 client-visible / audit-visible 事件都有统一出口** |
| F5 | Delegate Contracts | llm/tool/hooks/compact 的 typed interface | ✅ **kernel 不依赖具体实现，也不失去控制权** |
| F6 | Checkpoint Contract | 定义 hibernation 可恢复边界 | ✅ **可恢复状态与不可恢复状态边界明确** |

### 7.2 详细阐述

#### F1: `SessionState` / `TurnState`

- **输入**：session start/resume、历史消息、workspace refs、permission snapshot、runtime metadata
- **输出**：可被 kernel reducer 消费的稳定状态对象
- **主要调用者**：session DO runtime、step scheduler、checkpoint builder
- **核心逻辑**：
  1. SessionState 持有跨 turn 持续状态
  2. TurnState 持有 pending input / pending approval / in-flight step 等短期状态
  3. turn 结束后，TurnState 只归档必要摘要，其余清空
- **边界情况**：
  - resume 后需要重建 TurnState 的最小合法形式
  - compact 后 SessionState 的 history 不是简单追加，而是边界替换
- **一句话收口目标**：✅ **`SessionState` 与 `TurnState` 的字段、生命周期、checkpoint 归属全部明确。**

#### F2: `StepScheduler`

- **输入**：当前 SessionState、TurnState、外部 signal
- **输出**：下一步 `StepDecision`
- **主要调用者**：kernel main loop
- **核心逻辑**：
  1. 检查 interrupt / wait / timeout / compact-required
  2. 决定是发起 LLM、执行 tool、等待外部输入、还是结束 turn
  3. 不允许 delegate 反向私自推进状态
- **边界情况**：
  - tool progress 不应被误判成“进入下一步”
  - LLM 无 tool call 且无文本时也必须有明确 finish 规则
- **一句话收口目标**：✅ **`scheduleNextStep()` 成为 turn 推进的唯一入口。**

#### F3: `InterruptController`

- **输入**：user cancel、heartbeat/ack health、tool error、compact trigger、permission wait
- **输出**：`InterruptReason`
- **主要调用者**：kernel main loop、session DO tick
- **核心逻辑**：
  - 将所有“暂停 / 中止 / 切换 phase”的信号归一化
- **边界情况**：
  - caller-managed health 需要 DO tick 显式触发，不在 delegate 内部偷偷 close
- **一句话收口目标**：✅ **所有 runtime interrupt 都能被统一分类、统一记录、统一恢复。**

#### F4: `RuntimeEventEmitter`

- **输入**：kernel 各阶段的 state transition / delegate result
- **输出**：typed runtime events
- **主要调用者**：session stream adapter、audit sink、eval harness
- **核心逻辑**：
  - 统一 event kinds、payload shape、redaction 元数据
- **边界情况**：
  - 同一事件既可能发给 session stream，也可能发给 audit sink，但 shape 不应各自定义
- **一句话收口目标**：✅ **runtime events 成为 session / audit / eval 的统一上游。**

#### F5: `Kernel Delegates`

- **输入**：turn context、step context
- **输出**：result / progress / error / control outcome
- **主要调用者**：llm-wrapper、capability runtime、hooks runtime、compact runtime
- **核心逻辑**：
  - kernel 只看 typed contract，不看内部 transport / SDK / binding
- **边界情况**：
  - long-running delegate 需要 progress channel + cancel handle
- **一句话收口目标**：✅ **llm/tool/hooks/compact 都通过同类 contract 被 kernel 调用。**

#### F6: `Checkpoint Contract`

- **输入**：session state、active turn summary、replay metadata
- **输出**：checkpoint payload
- **主要调用者**：session DO runtime
- **核心逻辑**：
  - 定义什么能持久化、什么只能丢弃
- **边界情况**：
  - in-flight tool call 不应被伪装成“完全可恢复”
- **一句话收口目标**：✅ **checkpoint 与 restore 的语义边界不再含糊。**

### 7.3 非功能性要求

- **性能目标**：单次 scheduler / reducer 判定应保持轻量，不引入大对象重复序列化
- **可观测性要求**：每个 turn 至少有开始、关键 step、结束、interrupt 四类稳定事件
- **稳定性要求**：kernel 不允许依赖具体 provider / tool 实现细节
- **测试覆盖要求**：状态转移、interrupt、checkpoint 边界、event emission 至少各有独立测试组

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:321-420` | 单 agent 主循环 | 保留 loop 可读性、safe checkpoint cancel | 不照抄其本地宿主假设 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/state/session.rs:19-229` | session-scoped mutable state | SessionState 分层 | 强烈借鉴 |
| `context/codex/codex-rs/core/src/state/turn.rs:26-247` | ActiveTurn / TurnState / pending approvals | TurnState 与等待态建模 | 强烈借鉴 |
| `context/codex/codex-rs/core/src/realtime_conversation.rs:87-260` | conversation manager 与 active state 管理 | 传输管理与 turn/state 分离 | 只借鉴分层，不抄 provider realtime |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/services/tools/toolOrchestration.ts:19-177` | 工具调用批次调度 | “调度”和“执行”分层 | 借鉴边界，不借鉴并发默认值 |
| `context/claude-code/services/tools/toolExecution.ts:126-245` | tool execution + permission/hook/telemetry | delegate result 可带 side effects | 借鉴 orchestration seam |
| `context/claude-code/services/compact/compact.ts:55-90` | compact 前置状态装配 | compact 是 loop 一部分 | 强烈借鉴 |
| `context/claude-code/services/compact/compact.ts:122-145` | strip images before compact | compact 输入需有单独裁剪逻辑 | 借鉴思路 |
| `context/claude-code/bridge/sessionRunner.ts:107-199` | activity extraction | 会话级 activity 可独立抽象 | 借鉴为 runtime event |

### 8.4 需要避开的"反例"位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `context/mini-agent/mini_agent/agent.py:321-420` | loop 过度依赖本地 message list 与本地 tool/FS 假设 | nano-agent 需要可恢复 actor，不是一次性 CLI run |
| `context/codex/codex-rs/core/src/realtime_conversation.rs:1-260` | provider realtime 侧复杂度极高 | v1 不让 kernel 被 provider transport 绑架 |
| `context/claude-code/bridge/sessionRunner.ts:1-240` | 强绑定子进程 CLI bridge | nano-agent 不以本地子进程作为 runtime 骨架 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Agent Runtime Kernel 在 nano-agent 中将以一个**小而硬的 runtime core** 存在：代码量不一定最大，但它会是所有 session actor 的中心骨架。它与 hooks、llm-wrapper、capability runtime、workspace runtime 都是强耦合关系，但通过 delegate interface 保持模块边界清晰。复杂度属于 **中高**：不是 provider/tool 最重的实现层，却是所有状态语义的唯一仲裁层。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 没有 runtime kernel，协议层无法变成 agent 本体 |
| 第一版实现的性价比 | 5 | 先冻结内核，比盲写 worker/DO 代码更省返工 |
| 对未来"上下文管理 / Skill / 稳定性"演进的杠杆 | 5 | 这三条都直接依赖稳定的 turn lifecycle |
| 对开发者自己的日用友好度 | 4 | 一开始多写状态机，但后续实现会明显更顺 |
| 风险可控程度 | 4 | 风险主要在过度设计；通过 delegate 化可控 |
| **综合价值** | **5** | 这是 post-NACP 阶段最该先冻结的设计之一 |

### 9.3 下一步行动

- [ ] **决策确认**：业主确认 v1 是否坚持“单活跃 turn、caller-managed health、delegate-based kernel”三项原则
- [ ] **关联 Issue / PR**：创建 `docs/action-plan/agent-runtime-kernel.md`
- [ ] **待深入调查的子问题**：
  - background capability progress 是否允许占用当前 turn
  - compact-required 的触发时机由谁判定
- [ ] **需要更新的其他设计文档**：
  - `docs/design/session-do-runtime-by-GPT.md`
  - `docs/design/eval-observability-by-GPT.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-16` | `GPT-5.4` | 初稿 |
