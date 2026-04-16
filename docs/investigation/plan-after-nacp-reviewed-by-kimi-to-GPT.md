# Plan After NACP — GPT 生成设计文档审核报告

> 审核者: Kimi (k2p5)
> 审核对象:
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> 审核依据:
> - `README.md` (项目精神与技术栈前提)
> - `docs/action-plan/nacp-core.md` (NACP-Core 协议基座)
> - `docs/action-plan/nacp-session.md` (NACP-Session 协议基座)
> - `docs/plan-after-nacp.md` (阶段规划与缺口定义)
> - `context/mini-agent/`, `context/codex/`, `context/claude-code/`, `context/just-bash/` (代码事实)
> 审核日期: 2026-04-16

---

## 0. 审核方法论

本次审核采用四维验证框架：

1. **README 精神一致性**: 是否坚持 Cloudflare-native、WebSocket-first、DO-centered、无真实 Linux 宿主假设、fake bash 作为 compatibility surface。
2. **NACP 基座真实性**: 是否正确消费 NACP-Core 的内部消息合同与 NACP-Session 的 client-facing 流合同，而非重新发明。
3. **代码事实映射**: 对 mini-agent / codex / claude-code / just-bash 的吸收是否准确，批判是否合理。
4. **演进可支撑性**: 设计是否为后续 hooks、llm-wrapper、storage topology、session DO runtime 提供了稳定 seam。

---

## 1. 总体结论（TL;DR）

| 文档 | 评级 | 核心判断 |
|------|------|----------|
| `agent-runtime-kernel-by-GPT.md` | ⭐⭐⭐⭐☆ (4/5) | 架构方向清醒，session/turn 分层正确，但与 NACP-Core 具体消息类型的调度映射不足，状态模型字段过于概念化。 |
| `capability-runtime-by-GPT.md` | ⭐⭐⭐⭐⭐ (5/5) | 最扎实的一份。对 fake bash 的定位、参考代码的吸收与批判、治理边界的定义都非常到位。 |
| `workspace-context-artifacts-by-GPT.md` | ⭐⭐⭐⭐☆ (4/5) | 语义边界清晰，对 claude-code 的 attachment/compact 经验吸收充分，但与 NACP-Core `refs` / `context.compact.*` 的衔接、DO storage checkpoint 数据流描述不足。 |

**综合判断**: 三份文档整体符合 README 精神与 NACP 基座方向，能够支撑后续演进，但存在一个共同的结构性缺口——**缺少“NACP-Core Message Type → 功能簇映射矩阵”**。如果不补齐这个矩阵，后续 session DO runtime 的装配会出现职责模糊。

---

## 2. `agent-runtime-kernel-by-GPT.md` 逐条审核

### 2.1 与 README 精神的一致性

**结论: ✅ 高度一致，偶有模糊**

- **符合点**:
  - 明确将 nano-agent 定义为 "Cloudflare-native、WebSocket-first、DO-centered、Worker/V8 isolate 宿主" (§0.2)。
  - 坚持 "单 agent、单线程、单活跃 turn" 作为 v1 正确性模型 (§0.2)，与 README §4.2 的主动 trade-off 完全对齐。
  - 明确砍掉 sub-agent 树式调度、provider realtime 会话内核、本地 CLI TUI 状态机 (§3.1)，体现 "拒绝错误宿主假设"。
  - 将 compact 设为一等入口 (§7.1 F3)，与 README 强调的 "上下文管理是核心差异化价值" 一致。

- **模糊点**:
  - §7.1 F1 中 `SessionState` / `TurnState` 的字段定义停留在概念层，没有说明 "跨 turn 热状态" 在 DO hibernation 时如何与 README 所说的 "memory-first + durable-backed persistence" 配合。
  - §7.1 F6 `Checkpoint Contract` 提到 "什么能持久化、什么只能丢弃"，但没有明确指出：在 DO 模型中，**checkpoint 不是 kernel 自主写盘，而是由 DO lifecycle (hibernate / alarm / 显式 flush) 触发**。这个宿主语义需要更明确。

### 2.2 与 NACP 基座的契合度

**结论: ⚠️ 方向正确，但具体映射不足**

- **符合点**:
  - 承认 ack/heartbeat 已在 `nacp-session` 收口为 caller-managed health enforcement，因此 kernel 需要显式 Runtime Tick (§0.2, §7.1 F3)。
  - 明确 kernel 产出的 client-visible 进展要落为 `session.stream.event` (§2.2 交互矩阵)，与 NACP-Session 的 "统一 push channel" 原则对齐。

- **不足点**:
  - NACP-Core 已完成实现，包含 11 个消息类型: `tool.call.{request,response,cancel}` / `hook.{emit,outcome}` / `skill.invoke.{request,response}` / `context.compact.{request,response}` / `system.error` / `audit.record`。但本文档**没有给出 kernel 如何消费这些消息类型进行状态转移的映射矩阵**。
  - 例如: 当 kernel 收到 `tool.call.response` 时，TurnState 如何从 "in-flight tool" 转移到 "等待 scheduler 决策"？当收到 `hook.outcome` 时，是中断 turn 还是继续？这些都没有明确。
  - `RuntimeEventEmitter` (§7.1 F4) 说要产出 typed runtime events，但没有说明这些 events 与 NACP-Session `stream-event.ts` 中 v1 kinds 的对应关系。

### 2.3 代码事实映射的准确性

**结论: ✅ 准确，但可再深入一层**

- **mini-agent** (`agent.py:321-420`):
  - 文档正确指出 mini-agent 的 loop 可读性和 cancel checkpoint 值得借鉴，同时批判其 "把所有状态压进 message list"、"本地宿主假设"。
  - **可补充**: mini-agent 的 `cancel_event` 是 `asyncio.Event`，在 Worker 中没有对应物。kernel 的 `InterruptController` 应该说明这是否映射为 NACP-Session 的 `session.cancel` 消息 + DO alarm timeout。

- **codex** (`session.rs`, `turn.rs`):
  - 文档对 codex 的 session/turn 分层评价为 "强烈借鉴"，这是正确的。
  - **可补充**: codex 的 `TurnState` 有具体的 `pending_approvals` / `pending_input` / `mailbox_delivery_phase` 槽位。nano-agent kernel 应该明确这些槽位是否存在、如何命名、如何与 NACP-Core 消息关联。当前文档只到 "应该分层" 这一层。

- **claude-code** (`compact.ts`, `toolOrchestration.ts`, `toolExecution.ts`, `sessionRunner.ts`):
  - 文档正确吸收了 compact seams、tool execution side effects、session activity extraction 等经验。
  - **可补充**: claude-code 的 `toolExecution.ts` 中 permission/hook/telemetry 是**串联**在单次工具执行中的。kernel 的 `Delegate Contract` 应该说明这种 "串联" 是在 capability runtime 内完成，还是由 kernel 分步调度。

### 2.4 演进可支撑性

**结论: ✅ 良好，但需要细化接口**

- 文档为 LLM delegate、Tool delegate、Hook delegate、Compact delegate 都预留了接口 (§3.2)，这是正确的。
- 但 "Step Scheduler" 的输入输出签名过于抽象: `scheduleNextStep(state): StepDecision`。在实际实现中，这个函数必须能读取 NACP-Core 消息的 inbox、判断当前 turn 是否有 pending approval、是否有未完成的 LLM stream。这些输入没有显式化。
- **风险**: 如果 `StepDecision` 的类型设计不够克制，后续很容易膨胀成 "又一个 giant orchestrator"。

### 2.5 本文件的 verdict

> **方向正确、架构清醒，但必须补充 "Kernel 状态机 ↔ NACP-Core 消息类型 ↔ NACP-Session event kinds" 的三层映射表，否则 session DO runtime 的装配会缺少具体依据。**

---

## 3. `capability-runtime-by-GPT.md` 逐条审核

### 3.1 与 README 精神的一致性

**结论: ✅ 高度一致，定位精准**

- 全文贯穿 "fake bash 是 LLM compatibility surface，不是系统内核" (§0.1, §1.1, §3.1)，这与 README §4.2 的主动 trade-off 完全一致。
- 明确砍掉完整 POSIX shell、本地子进程 / background shell manager、任意 Python 执行 (§3.1, §5.2)，体现 "不以 Linux 为宿主真相"。
- 保留 `ts-exec` 作为 Worker-native TS 执行路径 (§5.3)，与 README 技术栈中 "Agent 能力层 = 声明式 tool registry + fake bash compatibility surface + typed capability runtime" 直接对齐。
- 将 browser-rendering 作为 service-binding execution target 预留 (§3.2)，与 README 中 "浏览器能力 = Cloudflare Browser Rendering" 一致。

### 3.2 与 NACP 基座的契合度

**结论: ⚠️ 边界正确，但内部映射可再细化**

- **符合点**:
  - 明确 NACP-Core 负责 internal contracts，NACP-Session 负责 progress/result 对客户端的 stream (§0.2, §2.2)。
  - 将 progress/cancel/result 统一为 typed contract，便于后续映射到 `session.stream.event` (§5.1 S5)。

- **不足点**:
  - 没有给出 capability runtime 与 NACP-Core `tool.call.*` 消息的精确对应关系图。例如:
    - `tool.call.request` 的 body `{tool_name, tool_input}` 是由 `FakeBashAdapter` 产出后由 `CapabilityRegistry` 填充 schema，还是由 `CapabilityExecutor` 重新组装？
    - `tool.call.cancel` 如何路由到正在执行的 long-running capability worker？是通过 CancellationToken 还是 NACP-Core 消息转发？
    - capability 执行中的 `progress` 是走 NACP-Core `ReadableStream` (service-binding transport) 还是直接作为 `hook.emit` 发送？
  - 这些在 `nacp-core.md` 的 Phase 5 和 `nacp-session.md` 的 P4-04 中已有技术路径（`{response, progress?: ReadableStream}`）， capability runtime 设计应该显式引用。

### 3.3 代码事实映射的准确性

**结论: ✅ 非常准确，批判到位**

- **just-bash**:
  - 文档明确指出 just-bash 的 "shell runtime 直接承载过多宿主能力" 是反例 (§8.4)，这是正确的。
  - 同时吸收了 command registry 思想 (§8.1)，但收窄了命令面。
  - **特别准确**: 文档没有掉进 "just-bash 的 mountable-fs 可以直接用" 的陷阱，而是将其归类为 "Node-hosted 参考很好，但不是 Worker 真相"。

- **codex**:
  - 对 `tool_definition.rs` 和 `tool_registry_plan.rs` 的吸收非常到位："先定义 capability metadata，再决定对模型/运行时暴露什么" (§4.2)。
  - 正确避开了 codex 的 "本地 sandbox 成本太高" (§4.2)。

- **claude-code**:
  - 正确吸收了 tool pool 中心化 + pre-filter deny rules (§4.3)。
  - 正确指出 tool execution 不只是纯函数调用，而是治理/审计/持久化链条的一部分。
  - 对 `toolResultStorage.ts` 的引用特别有价值：大工具结果持久化为文件引用，这在 nano-agent 中应直接映射为 artifact ref。

- **mini-agent**:
  - 反向借鉴准确：真实 shell / 真实本地 FS / background process manager 都不适合 Worker 宿主。

### 3.4 演进可支撑性

**结论: ✅ 优秀**

- `CapabilityRegistry` + `CapabilityExecutor` + `FakeBashAdapter` + `CapabilityPolicyGate` 的四层拆分 (§7.1 F1-F4) 非常克制，为 skills、browser、WASM 等 future target 留出了正确边界。
- `Minimal Capability Pack` (§7.1 F6) 的 `pwd` / `ls` / `cat` / `write` / `rg` / `curl` / `ts-exec` 覆盖了最小真实工作流，足以支撑第一轮端到端验证。
- **唯一可补充**: `rg` 在 V8 isolate 中没有真实子进程，文档没有说明其实现路径。建议明确：`rg` 要么通过 service binding 路由到专门的 search worker，要么在 v1 用纯 TS 的轻量 grep 模拟（并在文档中声明这是模拟）。

### 3.5 本文件的 verdict

> **三份设计文档中最扎实的一份。fake bash 的定位、参考代码的吸收、治理边界的定义都可直接落地。建议补充 capability runtime 与 NACP-Core `tool.call.*` 消息类型的精确映射图，以及 `rg` 的实现路径说明。**

---

## 4. `workspace-context-artifacts-by-GPT.md` 逐条审核

### 4.1 与 README 精神的一致性

**结论: ✅ 高度一致**

- 坚持 "virtual FS / mount-based workspace / memory-first + durable-backed persistence" (§0.2)，与 README 技术栈直接对应。
- 明确砍掉 "真实宿主 FS 作为真相"、"任意大文件直接 inline 进模型上下文"、"全量 session transcript 直接当上下文真相" (§3.1)，这些都是 README §4.2 中的核心 trade-off。
- 将 artifact ref / prepared artifact 作为大对象路径 (§6.1 取舍 2)，与 README "对 LLM 友好、对平台可治理" 的目标一致。

### 4.2 与 NACP 基座的契合度

**结论: ⚠️ 语义层对齐，但协议衔接模糊**

- **符合点**:
  - 明确 NACP-Session 负责 client event 流，不负责 workspace/object 存储 (§0.2)。
  - 提到 storage topology 还未冻结，因此先定义语义边界 (§0.2)，这与 `plan-after-nacp.md` §7 的 "由验证反推 storage" 原则一致。

- **不足点**:
  - NACP-Core 的 `NacpRefSchema` 已经定义了 `{kind, binding, team_uuid, key, bucket?, ...}`，并且通过 `.refine` 强制 `key.startsWith("tenants/${team_uuid}/")`。本文档虽然提到了 ArtifactRef，但**没有说明 ArtifactRef 是否直接复用 `NacpRefSchema` 的结构**。
  - NACP-Core 有 `context.compact.{request,response}` 消息类型。本文档的 `CompactBoundaryManager` (§7.1 F5) 应该明确说明：
    - 谁触发 `context.compact.request`？是 kernel 还是 workspace runtime？
    - `context.compact.response` 中的 `summary_ref` 如何进入 `ContextAssembler` 的层级？
  - 当前这些关系是隐含的，需要显式化。

### 4.3 代码事实映射的准确性

**结论: ✅ 非常准确，对 claude-code 经验吸收尤其到位**

- **claude-code**:
  - `attachments.ts`: 文档正确指出 "attachment 不是文件内容字符串"，这对应 Prepared Artifact 的设计。
  - `compact.ts`: 对 compact 前 strip images/documents、compact 后 reinjection 的吸收被评为 "强烈借鉴"，完全正确。这是 nano-agent 在 Worker 宿主下控制上下文大小的关键。
  - `sessionStorage.ts`: 正确区分 durable transcript 与 ephemeral progress (§8.3)，这与 `nacp-session.md` 中 replay buffer 只保留 transcript-like events、不保留 ephemeral progress 的原则一致。
  - `toolResultStorage.ts`: 大工具结果持久化为文件引用，直接映射为本文档的 `Result-to-Artifact Promotion` (§5.1 S7)。

- **codex**:
  - 对 `sandboxed_file_system.rs` 的借鉴准确：文件访问要带 sandbox/context，而不是裸路径。
  - 对 `session.rs` 中 history/context 单独建模的吸收也正确。

- **just-bash**:
  - 吸收了 `IFileSystem` 接口思想 (§8.2) 和 mount-based namespace 思想。
  - 正确避开 overlay-fs 的 Node 宿主假设 (§8.4)。

- **mini-agent**:
  - 对 `file_tools.py` 的借鉴价值较低，因为该文件几乎都是本地 FS 直接路径操作，几乎没有 workspace 层设计。文档说 "借鉴读取体验，不借宿主真相" 是准确的，但实际上可借鉴的内容很少。

### 4.4 演进可支撑性

**结论: ✅ 良好，但需要明确数据流**

- `WorkspaceNamespace` / `ArtifactRef` / `PreparedArtifact` / `ContextAssembler` / `CompactBoundaryManager` / `WorkspaceSnapshotBuilder` 的六模块拆分 (§7.1 F1-F6) 覆盖了核心需求。
- **但存在两个关键数据流缺口**:
  1. **Workspace Snapshot → DO storage checkpoint**: 文档说 `WorkspaceSnapshotBuilder` 产出 "checkpoint/export bundle"，但没有说明这个 bundle 是写入 DO storage (hibernation 时自动持久化) 还是显式调用 `ctx.storage.put()`。在 Cloudflare DO 中，这两者成本模型和一致性模型不同。
  2. **Prepared Artifact 的生成责任方**: 是由 capability runtime 在产出大结果时同步生成，还是由独立的 artifact preparation worker 异步生成？这个问题会影响 artifact ref 进入 LLM wrapper 的时序。

### 4.5 本文件的 verdict

> **语义边界定义清晰，对参考代码的吸收成熟，是 nano-agent 脱离本地 FS 心智的关键设计层。但需要补充 ArtifactRef 与 `NacpRefSchema` 的结构复用关系、compact 消息的具体消费方式、以及 workspace snapshot 与 DO storage 的交互数据流。**

---

## 5. 跨文档一致性与断点分析

### 5.1 三份文档之间的职责边界

| 边界 | 当前定义 | 问题 |
|------|----------|------|
| **Kernel ↔ Capability Runtime** | Kernel 通过 `invokeCapability(stepCtx, call)` 调用 Capability Executor (§3.2 agent-runtime-kernel) | 没有说明 `call` 是已经解析好的 capability plan，还是原始的 NACP-Core `tool.call.request` 消息。 |
| **Kernel ↔ Workspace/Artifacts** | Kernel 决定何时 compact、何时 snapshot (§2.2 agent-runtime-kernel) | 没有说明 compact trigger 是 kernel 内部状态机判定，还是收到 `context.compact.request` 后的响应。 |
| **Capability Runtime ↔ Workspace** | 几乎所有 capability 都读写 workspace / artifacts (§2.2 capability-runtime) | 没有说明 capability 的读写是否通过 `NACP-Core` `refs` 字段声明，还是直接调用 workspace API。 |
| **Runtime Event ↔ NACP-Session** | Kernel 的 `RuntimeEventEmitter` 产出 typed events，再由 session DO 映射到 `NACP-Session` | 三份文档对 event kinds 的定义各自独立，没有统一 catalog。 |

### 5.2 共同存在的结构性缺口

**缺口 A: NACP-Core Message Type 消费矩阵缺失**

`nacp-core.md` 已经完成了 `tool.call.*` / `hook.*` / `skill.*` / `context.compact.*` / `system.error` / `audit.record` 等 11 个消息类型的 schema 和 role gate。但三份 GPT 设计文档中，没有任何一份给出如下矩阵：

| NACP-Core Message Type | 由谁消费 | 消费后触发什么状态转移 / 行为 |
|------------------------|----------|------------------------------|
| `tool.call.request` | Capability Runtime? Kernel? | ... |
| `tool.call.response` | Kernel | TurnState 从 in-flight → scheduler decision |
| `tool.call.cancel` | Capability Runtime | 路由到 target-specific cancel handle |
| `hook.emit` | Kernel / Hooks Runtime | 可能触发 Interrupt 或仅记录 |
| `hook.outcome` | Kernel | 可能影响 scheduler 决策 |
| `context.compact.request` | Workspace Runtime / Kernel | 启动 compact pipeline |
| `context.compact.response` | Kernel / ContextAssembler | 替换 history 层并 rehydrate |

没有这个矩阵，session DO runtime 的装配会缺少具体依据。

**缺口 B: `session.stream.event` kinds 与 RuntimeEvent 的映射缺失**

`nacp-session.md` 定义了 `SessionStreamEventBody` 的最小 discriminated union (P1-04)。但三份设计文档中：
- agent-runtime-kernel 定义了 `RuntimeEventEmitter` 产出 "turn 开始、llm delta、tool progress、compact 边界、turn 结束" 等 events。
- capability-runtime 定义了 progress/cancel/result contract。
- workspace-context-artifacts 定义了 artifact promotion / compact boundary / snapshot build 等 events。

这些 event 分类没有统一到一个 catalog 中。例如：tool progress 是一种 runtime event 还是 capability event？compact boundary 是一种 kernel event 还是 workspace event？

**缺口 C: DO storage checkpoint 的触发与内容边界**

三份文档都提到了 checkpoint/restore/snapshot，但都没有明确回答：
1. checkpoint 是由 DO hibernation 自动触发，还是由 kernel 显式调用 `ctx.storage.put()` 触发？
2. TurnState 中的 `pending_approvals` 是否应该被 checkpoint？（在 codex 中这些是不跨 turn 的，但在 nano-agent 的断线重连场景下可能需要。）
3. replay buffer 在 DO storage 中的持久化策略是什么？（`nacp-session.md` Q4 提到 "last 200 + DO storage checkpoint"，但 agent-runtime-kernel 没有引用这个决策。）

---

## 6. 是否符合后续演进要求

### 6.1 对 Session DO Runtime 的支撑

- **支撑度: 中上**
- 三份文档为 session DO runtime 提供了 "要装什么" 的清单（kernel、capability runtime、workspace runtime），但没有提供 "怎么装" 的协议矩阵。
- 建议下一步 `docs/design/session-do-runtime-by-GPT.md` 必须以一张 "消息路由图" 开篇，明确 NACP-Core 消息进入 DO 后的分发路径。

### 6.2 对 Eval/Observability 的支撑

- **支撑度: 良好**
- agent-runtime-kernel 的 `RuntimeEventEmitter`、capability-runtime 的 progress/result contract、workspace 的 compact boundary 都提供了明确的观察点。
- 但缺少一个统一的 event catalog，这会让 observability harness 难以定义 "要捕获哪些 event kinds"。

### 6.3 对 Storage Topology 的支撑

- **支撑度: 良好（语义层）/ 不足（物理层）**
- workspace-context-artifacts 明确将语义层与物理层解耦，符合 `plan-after-nacp.md` "由验证反推 storage" 的原则。
- 但 `ArtifactRef` 与 `NacpRefSchema` 的关系未明确，这会让 storage topology 设计时难以判断 "artifact ref 本身是否进 KV / R2 / DO storage"。

---

## 7. 总结性陈述

### 7.1 对三份文档的总体评价

这三份由 GPT-5.4 生成的设计文档，在 **战略方向、价值取舍、参考代码批判** 三个维度上都表现出很高的质量。它们没有犯下 post-NACP 阶段最容易犯的两种错误——

1. 直接开始写 worker/DO/tool/LLM 代码，让实现顺序反过来主导架构；
2. 过早开始设计 DDL/KV/R2 细节，把还没被运行时验证过的访问模式先固化成数据结构。

相反，它们坚持了 `plan-after-nacp.md` 的核心方法论：**先补齐骨架设计，再做跨文档联审，再搭观察窗口，最后按推荐顺序实现；而存储最终方案由验证反推。**

### 7.2 关键优点

1. **agent-runtime-kernel** 正确确立了 "显式状态机 + step scheduler + delegate-based kernel" 的骨架，吸收了 codex 的 session/turn 分层和 claude-code 的 compact seams，同时避开了本地 CLI 的 TUI 假设和 provider realtime 的复杂度。
2. **capability-runtime** 对 fake bash 的定位堪称精准——"bash-shaped surface + typed runtime"，既吸收 LLM 先验，又不背 Linux 兼容债。对 just-bash、codex、claude-code 的吸收与批判都很到位。
3. **workspace-context-artifacts** 成功将 claude-code 成熟的 attachment/compact/toolResultStorage 经验，迁移到 Cloudflare-native 的 mount-based virtual workspace 语义中。这是 nano-agent 与本地 CLI 最本质的分水岭之一。

### 7.3 关键缺陷与改进建议

**缺陷 1: 三份文档都缺少与 NACP-Core 具体消息类型的显式映射。**

- **改进**: 在三份文档的附录中，各增加一张 "NACP-Core Message Type 消费矩阵"。明确说明本功能簇消费哪些 message type、生产哪些 message type、与哪些消息类型无关。

**缺陷 2: `session.stream.event` kinds 与 RuntimeEvent 的映射未统一。**

- **改进**: 在 `agent-runtime-kernel` 的 `RuntimeEventEmitter` 章节中，明确列出 v1 的 event kind catalog，并指出这些 kinds 如何映射到 `nacp-session` 的 `SessionStreamEventBody`。

**缺陷 3: agent-runtime-kernel 的状态模型过于概念化。**

- **改进**: 补充 `SessionState` 和 `TurnState` 的建议字段清单（不是最终 DDL，而是设计级字段草案），并说明每个字段的生命周期归属（跨 turn / 单 turn / 可 checkpoint / 不可恢复）。

**缺陷 4: workspace-context-artifacts 中 DO storage checkpoint 的数据流未明确。**

- **改进**: 在 `WorkspaceSnapshotBuilder` 章节中，明确说明 snapshot 的触发时机（hibernation / alarm / 显式 flush）和写入目标（DO storage `ctx.storage.put()`），以及恢复时的读取路径。

**缺陷 5: capability-runtime 中 `rg` 的实现路径缺失。**

- **改进**: 在 `Minimal Capability Pack` 中补充 `rg` 的 v1 实现策略：是通过 service binding 路由到 search worker，还是用纯 TS 的轻量 grep 模拟？

### 7.4 最终判断: 是否可以通过审核进入下一阶段

**我的判断是: 可以通过，但必须在进入 action-plan 编写之前，先做一次跨文档联审（即 `plan-after-nacp.md` 所说的 Stage C），重点解决上述 5 个缺陷。**

具体来说，我建议在创建 action-plan 之前，先由业主 / 架构师确认以下三个决策：

1. **Kernel 消息调度模型**: kernel 是直接消费 NACP-Core 消息的 "消息路由器"，还是通过 delegate 调用的 "状态调度器"？（我倾向于后者：NACP-Core 消息由 session DO runtime 的 ingress 层解析后，再调用 kernel 的 reducer。）
2. **ArtifactRef 与 NacpRefSchema 的关系**: ArtifactRef 是否直接继承 `NacpRefSchema` 的结构？（我倾向于直接复用，并在 workspace runtime 中增加 `prepared` / `preview` / `redaction` 等业务字段。）
3. **Checkpoint 触发模型**: workspace snapshot 和 replay buffer 的持久化，是依赖 DO hibernation 的自动 checkpoint，还是由 kernel 显式 flush？（我倾向于：replay buffer 由 `nacp-session` 的 helper 按策略显式写入 DO storage；workspace snapshot 在 hibernation 时由 DO lifecycle 调用 kernel 的 `buildCheckpoint()`。）

---

## 8. 给 GPT 的反馈

你的三份设计文档在 **"为什么这样设计"** 和 **"不抄什么"** 两个维度上做得非常好。特别是 `capability-runtime-by-GPT.md`，展现了很强的参考代码批判能力。

下一步，请你在修订时重点补强 **"与 NACP-Core 的接口映射"** 这一层。因为 NACP-Core 和 NACP-Session 已经完成收口，它们不再是 "参考实现"，而是 **nano-agent 的法定协议基座**。所有上游设计文档（kernel、capability、workspace）都必须能够回答：

> **"当这个 NACP-Core 消息到达时，我的功能簇会做什么？"**

当你能为 11 个 NACP-Core message type 都给出明确答案时，这三份文档就从 "设计方向" 变成了 "可直接装配的蓝图"。

---

*报告结束。*
