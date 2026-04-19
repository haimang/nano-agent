# Context Window Management — Evaluation by GPT

> 状态：`exploratory evaluation`
> 目的：`结合 DeepSeek 讨论、context/ 中真实 agent-cli 代码、以及 nano-agent 当前 foundations，评估 context window management 的下一阶段方向`
> References:
> - `docs/eval/after-foundations/context-management-discussion-with-deepseek.md`
> - `docs/eval/after-foundations/before-worker-matrix-eval-with-GPT.md`
> - `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md`
> - `context/claude-code/context.ts`
> - `context/claude-code/utils/context.ts`
> - `context/claude-code/utils/analyzeContext.ts`
> - `context/claude-code/utils/contextAnalysis.ts`
> - `context/claude-code/utils/contextSuggestions.ts`
> - `context/claude-code/services/compact/autoCompact.ts`
> - `context/claude-code/services/compact/microCompact.ts`
> - `context/claude-code/services/compact/compact.ts`
> - `context/claude-code/services/SessionMemory/sessionMemory.ts`
> - `context/claude-code/services/extractMemories/extractMemories.ts`
> - `context/claude-code/commands/context/context-noninteractive.ts`
> - `context/claude-code/entrypoints/sdk/controlSchemas.ts`
> - `context/claude-code/entrypoints/sdk/coreSchemas.ts`
> - `context/claude-code/commands/memory/memory.tsx`
> - `context/claude-code/memdir/memoryTypes.ts`
> - `context/mini-agent/mini_agent/agent.py`
> - `context/mini-agent/mini_agent/tools/note_tool.py`
> - `packages/workspace-context-artifacts/src/context-layers.ts`
> - `packages/workspace-context-artifacts/src/context-assembler.ts`
> - `packages/workspace-context-artifacts/src/compact-boundary.ts`
> - `packages/workspace-context-artifacts/src/snapshot.ts`
> - `packages/hooks/src/catalog.ts`
> - `packages/nacp-core/src/messages/context.ts`
> - `packages/nacp-session/src/messages.ts`
> - `packages/session-do-runtime/src/routes.ts`
> - `packages/session-do-runtime/src/worker.ts`

---

## 0. 先给结论

我对你这组 context management 要求的总体判断是：

> **方向正确，而且非常有价值；但它不应该被理解成“做一个更大的 compact 功能”，而应该被理解成“把 nano-agent 做成一个可治理、可检查、可分层、可异步维护的上下文操作系统”。**

更具体地说：

1. **Claude Code 是很强的参考对象**，尤其在：
   - context usage 可视化
   - token budget / buffer 管理
   - auto-compact / manual compact
   - PreCompact / PostCompact hooks
   - `/context` 与 SDK `get_context_usage`
   - memory command + background memory extraction
2. **但 Claude Code 的 context/memory 心智仍然明显建立在本地文件系统与 forked subagent 上**
3. **你想要的目标，比 Claude Code 更 Worker-native，也更结构化**
4. **因此，nano-agent 不应该照抄 Claude Code 的实现，而应该吸收它的预算治理、inspection 与 compact lifecycle，再把底层换成 KV / DO / artifact / hook / protocol 的 Worker-native 实现**

一句话总结：

> **要学习 Claude Code 的“上下文治理能力”，不要继承它的“本地文件与 forked agent 依赖”。**

---

## 1. 真实代码里，Claude Code 到底是怎么管理 context 的

如果只看真实代码，而不看营销描述，那么 Claude Code 的 context management 主要由 6 条线组成。

## 1.1 它有明确的 context window / output / buffer 预算观念

在 `context/claude-code/utils/context.ts` 和 `services/compact/autoCompact.ts` 里，可以看到 Claude Code 并不是“等超了再说”，而是从一开始就在管理预算：

- `MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`
- `COMPACT_MAX_OUTPUT_TOKENS = 20_000`
- `getContextWindowForModel()` 支持：
  - model capability 推导
  - `[1m]` suffix
  - beta header
  - env override
- `getEffectiveContextWindowSize()` 会从 context window 中扣掉 compact summary 输出保留
- `AUTOCOMPACT_BUFFER_TOKENS = 13_000`
- `MANUAL_COMPACT_BUFFER_TOKENS = 3_000`

这说明 Claude Code 的核心理念不是“我有多大窗口”，而是：

> **我必须为输出、压缩、告警、阻断预留空间。**

这是一个非常值得 nano-agent 吸收的点。

## 1.2 它有真实的 context inspection，而不是纯黑盒

Claude Code 不是只有 compact，它还有一整套 inspection / analysis 面：

- `commands/context/context.tsx`
- `commands/context/context-noninteractive.ts`
- `utils/analyzeContext.ts`
- `utils/contextAnalysis.ts`
- `utils/contextSuggestions.ts`
- `entrypoints/sdk/controlSchemas.ts` 中的 `get_context_usage`

特别重要的是：

`get_context_usage` 不是 UI 小功能，而是一个正式的 SDK control request。它会返回：

- categories
- totalTokens
- maxTokens
- rawMaxTokens
- percentage
- gridRows
- memoryFiles
- mcpTools
- systemTools
- systemPromptSections

也就是说，Claude Code 已经证明了一件事：

> **“上下文窗口状态”本身就应该是一个可查询、可传输、可结构化返回的 runtime surface。**

这和你提的“独立 http / websocket inspection 接口”高度同方向。

## 1.3 它不只有 full compact，还有 microcompact / context collapse / post-compact restore

Claude Code 的 context 管理并不只是一个 `/compact` 命令。

从代码上看，它至少有三层机制：

1. **microcompact**
   - `services/compact/microCompact.ts`
   - 对部分大 tool result 做内容裁剪或清理
2. **autoCompact**
   - `services/compact/autoCompact.ts`
   - 超过阈值后自动执行 compact
3. **full compact**
   - `services/compact/compact.ts`
   - 生成 compact summary，并在 compact 后重建可继续工作的消息序列

`commands/context/context.tsx` 和 `context-noninteractive.ts` 甚至明确说明：

> `/context` 展示的是“模型真正看到的视图”，而不是原始 REPL history。

这点非常关键，因为它意味着：

> **inspection 必须跟真实 prompt assembly 对齐。**

否则 inspection 只是安慰剂。

## 1.4 它有 compact hooks，但 context hook 面并不算真正细粒度

Claude Code 确实有 context 相关 hooks：

- `PreCompact`
- `PostCompact`

在 `entrypoints/sdk/coreSchemas.ts` 里：

- `PreCompact` payload 包含：
  - `trigger: manual | auto`
  - `custom_instructions`
- `PostCompact` payload 包含：
  - `trigger: manual | auto`
  - `compact_summary`

在 `services/compact/compact.ts` 里，这些 hooks 被真实接入了 compact lifecycle。

但要注意：

> **Claude Code 的 hook 粒度，重点仍然是“compact 前后”，而不是“上下文分层管理全过程”。**

它没有把：

- layer assemble
- layer eviction
- hot tier write
- artifact demotion
- context inspection publish

这些动作都提升为一等 hook event。

所以你提出“更多 hooks 用于 context management”，不是重复造轮子，而是在往更完整的治理面推进。

## 1.5 它有 memory，但 memory 的真实形态仍然是“文件化 memory 系统”

这是最重要的辨别点之一。

Claude Code 的 memory 现实不是 KV，也不是结构化 hot context store，而是：

1. `context.ts` / `utils/claudemd.ts` 会把 memory files / CLAUDE.md 注入 user context
2. `commands/memory/memory.tsx` 提供 `/memory` 命令，用编辑器直接打开 memory file
3. `memdir/memoryTypes.ts` 定义 memory taxonomy：
   - `user`
   - `feedback`
   - `project`
   - `reference`
4. `services/SessionMemory/sessionMemory.ts`
   - 自动维护当前会话 memory markdown
   - 使用 forked agent 后台提取
5. `services/extractMemories/extractMemories.ts`
   - 在 query loop 结束后，将 durable memory 写入 memory directory

换句话说，Claude Code 的 memory 虽然成熟，但它的实现前提仍然是：

> **本地文件目录 + markdown 文件 + forked agent 后台更新。**

这跟你设想的：

- KV 中热上下文
- system / memory / messages / tool use 的结构化分层
- skill 工具级独立管理

并不是一回事。

## 1.6 它已经证明“异步背景 memory 提取”是成立的

虽然 Claude Code 的主要 compact 仍然会阻断当前 compact 流程，但它已经证明了另一件重要事实：

> **上下文维护任务可以在后台异步执行。**

证据有两处：

1. `services/SessionMemory/sessionMemory.ts`
   - 自动维护 session memory
   - “without interrupting the main conversation flow”
2. `services/extractMemories/extractMemories.ts`
   - 使用 forked agent，在 stop hooks 后提取 durable memories

所以你提出：

> **异步上下文压缩，不阻断推理流程**

这个方向并不违背真实世界经验，反而是顺着 Claude Code 的一个已验证趋势继续往前走。

---

## 2. 其他 agent-cli 给出的对照

## 2.1 mini-agent：有 token limit 和 summary，但更轻、更单层

`context/mini-agent/mini_agent/agent.py` 显示：

- `token_limit` 是一个显式阈值
- 超过阈值会触发 `_summarize_messages()`
- 其策略是保留 user messages，概括 user-user 之间的过程

`context/mini-agent/mini_agent/tools/note_tool.py` 则显示：

- memory 是 `./workspace/.agent_memory.json`
- 通过 `record_note` / `recall_notes` 管理

这说明 mini-agent 的 context management 是成立的，但它的风格更接近：

- 单 session 历史总结
- 简单 note memory
- 单机文件存储

它没有 Claude Code 那种：

- usage inspection
- compact hook
- multi-path compact
- system/user context injection

也更没有你想做的：

- 结构化热上下文
- KV/DO/R2 分层
- inspection API

## 2.2 codex：在当前 vendored 快照里，没有看到与 Claude Code 同等级的 context subsystem

我对 `context/codex` 做了关键字扫描，但在当前 vendored 快照里，没有看到类似下面这些已冻结能力：

- `get_context_usage`
- `/context`
- `PreCompact / PostCompact`
- 明确的 compact subsystem

这意味着：

> **如果只讨论“context window management”这一专项，Claude Code 是主要对标对象，mini-agent 是轻量对照组，而 codex 在这个议题上并不是最强参照。**

---

## 3. nano-agent 当前 foundations 的真实起点

你现在不是从零开始。

当前 packages/ 里已经有一些非常重要的 context foundations，但它们还没有长成完整的 context engine。

## 3.1 我们已经有 budget-aware 的 layered assembler

`packages/workspace-context-artifacts/src/context-layers.ts` 和 `context-assembler.ts` 已经定义了：

- `ContextLayerKind`
- `ContextLayer`
- `ContextAssemblyConfig`
- `ContextAssembler`

当前 canonical layers 是：

- `system`
- `session`
- `workspace_summary`
- `artifact_summary`
- `recent_transcript`
- `injected`

而且 `ContextAssembler` 已经支持：

- ordered allowlist
- priority
- `maxTokens - reserveForResponse`
- required layer 必保留

这说明：

> **nano-agent 已经具备“分层 + 预算 + reserve” 的雏形。**

## 3.2 我们已经有 compact boundary contract，但还没有完整 compact engine

`packages/workspace-context-artifacts/src/compact-boundary.ts` 里已经有：

- `context.compact.request`
- `context.compact.response`
- `pickSplitPoint()`
- boundary record
- reinject marker

`packages/nacp-core/src/messages/context.ts` 也已经只有这两类 core message：

- `context.compact.request`
- `context.compact.response`

这说明当前 nano-agent 的 compact 真相是：

> **我们已经定义了 compact 的协议边界，但还没有形成 Claude Code 级别的 compact runtime。**

## 3.3 我们可以 snapshot context fragment，但还没有独立 inspection 面

`packages/workspace-context-artifacts/src/snapshot.ts` 能把：

- mountConfigs
- fileIndex
- artifactRefs
- contextLayers

打成 `WorkspaceSnapshotFragment`。

这是好事，因为它说明：

> **context fragment 已经可以被 durable object checkpoint path 带走。**

但同时，当前 `session-do-runtime`：

- `routes.ts` 只定义 `/sessions/:sessionId/ws` 与 HTTP fallback
- `worker.ts` 只是最薄的 worker entry
- `nacp-session` 也没有专门的 context inspection message family

所以目前还没有：

- 独立 context usage endpoint
- context layer introspection stream
- context policy mutation interface

## 3.4 我们当前的 hook catalog 还太粗

`packages/hooks/src/catalog.ts` 当前只有 8 个 canonical events：

- `SessionStart`
- `SessionEnd`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PreCompact`
- `PostCompact`

这套 catalog 足够 after-skeleton，但对你现在的目标来说还不够。

原因不是它错了，而是：

> **它还没有把 context management 当作一个独立治理域。**

---

## 4. 对你 6 个功能要求的逐条评价

---

## 4.1 自定义 buffer size 管理

### 我的评价

**强烈推荐，而且应该优先做。**

### 为什么

Claude Code 已经证明：

- context window 不能等于可用工作区
- 需要给 output 留空间
- 需要给 compact / warning / blocking 留 buffer
- auto-compact threshold 不能等于 hard limit

你这里如果要做 Worker-native context manager，那么 buffer management 应该成为一等配置，而不是藏在内部常量里。

### 对 nano-agent 的具体建议

不要只保留一个 `maxTokens`，至少应区分：

1. `hardLimitTokens`
2. `softLimitTokens`
3. `responseReserveTokens`
4. `compactReserveTokens`
5. `inspectionWarningThreshold`

还应支持：

1. session 级 override
2. model profile 默认值
3. tenant / project policy 默认值

### Trade-off

代价是：

- 配置面更多
- 调试更复杂

价值是：

- 上下文治理从“玄学”变成“策略系统”
- inspection 结果更可解释
- future auto-compact / async compact / client warning 都有统一依据

### Verdict

> **这不是锦上添花，而是整套 context management 的地基。**

---

## 4.2 更多的 hooks 用于 context management

### 我的评价

**推荐，但要克制扩张。**

### 为什么

Claude Code 的 `PreCompact / PostCompact` 已经证明 compact hooks 非常有用，但它的 hook granularity 还不够覆盖你想要的分层治理面。

而 nano-agent 当前 8-event catalog 也明显不够表达：

- assemble
- inspect
- layer write
- hot tier promote/demote
- async compact scheduling

### 我不建议的方向

我不建议直接走成 Claude Code 25+ event 那种大爆炸事件面，也不建议做 shell-script hook universe。

### 我建议的最小新增族

如果要新增，我更推荐优先补下面这些，而不是一次性做很多：

1. `ContextAssemble`
   - prompt assembly 前
   - 可加 diagnostics / additionalContext
2. `ContextPressure`
   - 到达 soft threshold
   - 可触发提醒、调度压缩、切换策略
3. `ContextLayerWrite`
   - memory / summary / transcript / tool-result 被写入热层前后
4. `ContextInspect`
   - 对外 inspection 请求时触发
5. `ContextCompactCommit`
   - async compact 真正提交边界时触发

### Trade-off

代价：

- catalog 更复杂
- protocol / audit / UI 也要跟着扩

价值：

- 上下文治理成为真正的可观察系统
- 后续 skill / policy / service-binding 协作更自然

### Verdict

> **应该扩 hooks，但要围绕“context lifecycle 的关键节点”扩，不要扩成事件噪音。**

---

## 4.3 热上下文，在 KV 中，通过结构化的方式，进行 system / memory / messages / tool use 的分层管理

### 我的评价

**方向很强，也是你这份方案里最有产品辨识度的一项。**

### 为什么它比 Claude Code 更进一步

Claude Code 当前做法本质上是：

- system/user context 注入
- memory files
- session memory markdown
- compact summary

它是成熟的，但底层还是文件导向。

你提出的方向则是：

> **把“上下文”从 prompt side effect，升级成结构化状态模型。**

这在 Worker / DO / KV / R2 架构里是非常自然的。

### 但我建议你不要简单地把所有东西都塞进 KV

虽然你说“热上下文在 KV 中”，但从工程角度我更推荐一个 **hybrid truth**：

| 层 | 推荐存储 | 原因 |
|---|---|---|
| system | KV / static config | 小、稳定、读多写少 |
| memory | KV | 结构化、热读、高价值 |
| active transcript head | DO memory / DO storage | 高频写、强 session locality |
| tool results / large payloads | artifact refs + R2 / do-storage | 不能把大块内容直接热挂在 prompt 里 |
| compact summaries / manifests | KV 或 D1 manifest | 需要结构化索引，但不是每次都热写 |

### 这对当前 nano-agent 意味着什么

当前 `ContextLayerKind` 仍然偏粗：

- `system`
- `session`
- `workspace_summary`
- `artifact_summary`
- `recent_transcript`
- `injected`

它不足以直接表达你说的：

- `memory`
- `messages`
- `tool_use`
- possibly `summary_manifest`
- possibly `policy_overlay`

所以如果你真要进入这个方向，就应该把 layer taxonomy 再冻结一轮。

### Trade-off

代价：

- schema 设计成本高
- 存储职责边界必须说清
- inspection 和 compaction 都更复杂

价值：

- 真正形成 Worker-native context engine
- 后续 skill / hooks / inspection / compaction 都能在统一数据模型上工作
- 这会成为 nano-agent 与本地 CLI agent 的显著差异点

### Verdict

> **推荐，而且这是最值得做成 nano-agent 核心能力的地方；但必须走 hybrid storage，而不是“KV 装下一切”。**

---

## 4.4 skill 中提供工具，可以更精细化，针对于不同上下文分层的独立管理

### 我的评价

**推荐。**

### 为什么

Claude Code 有：

- `/context`
- `/memory`
- `get_context_usage`

但它没有真正把 context layers 暴露成一组细粒度工具能力。

你如果做 Worker-native nano-agent，就不该只给 `/compact` 和 `/context` 这种粗命令，而应该让 context management 成为 skill/core capability。

### 我推荐的能力形态

不要做成“模拟 shell 命令”，而是做成 typed context capabilities，例如：

1. `context.inspectUsage`
2. `context.inspectLayers`
3. `context.pinMemory`
4. `context.dropLayer`
5. `context.scheduleCompact`
6. `context.promoteArtifact`
7. `context.restoreSummary`
8. `context.setBudgetPolicy`

### 为什么不用 fake bash 来做这件事

因为这不是 bash 语义最擅长表达的领域。

你的 fake bash 很适合：

- `ls`
- `cat`
- `rg`
- `curl`
- `git`

但不适合表达：

- “把 L1 记忆层的一条记录标记为 protected”
- “只压缩 tool result 层，不动 user-visible session head”

这些应该由 skill / typed tool surface 表达。

### Trade-off

代价：

- 需要额外 tool schema
- 需要更多 policy guard

价值：

- LLM 对上下文的操作更精准
- inspection / audit 更干净
- 避免把高级 context 操作伪装成脆弱的 shell 习惯

### Verdict

> **context management 应该成为独立的 typed tool cluster，而不是 /compact 一个命令包打天下。**

---

## 4.5 异步上下文压缩，不阻断推理流程

### 我的评价

**推荐，但必须明确“何时异步、何时提交”。**

### 为什么说这个想法成立

Claude Code 已经证明：

- 背景 session memory 提取成立
- durable memory extract 成立

所以“后台维护上下文资产”这件事是成立的。

### 但为什么不能简单理解成“边推理边改 prompt”

因为一旦一个 turn 已经开始，当前模型调用的 prompt 已经冻结。

所以真正安全的异步 compact 不是：

- 在当前请求中途改写上下文

而更像：

1. 后台准备 compact candidate / summary
2. 后台生成 summary artifact / manifest
3. 等到下一个安全边界再 commit compact boundary

### 我推荐的语义

把 async compact 拆成两阶段：

1. **prepare phase**
   - 不阻断当前推理
   - 生成 summary / refs / candidate
2. **commit phase**
   - 在 turn boundary 或 session idle 点发生
   - 更新 live context head
   - 触发 `ContextCompactCommit` / `PostCompact`

### 为什么这比 Claude Code 更适合 nano-agent

Claude Code 的 compact 很强，但它的主路径仍然较依赖同步 conversation compact。

而 nano-agent 的 Worker / DO 模型更适合：

- alarm
- idle scheduling
- background worker
- service binding compactor

这正是你的平台优势。

### Trade-off

代价：

- 一致性更复杂
- 需要 candidate versioning
- 需要防止过期 summary commit

价值：

- 用户心流更稳
- context maintenance 从“卡一下再继续”变成“平滑后台维护”
- 这是 Worker-native agent 很好的差异化能力

### Verdict

> **非常值得做，但必须走 prepare/commit 双阶段，而不是直接做并发写上下文。**

---

## 4.6 独立的 http / websocket 接口，用于对上下文窗口中的内容进行同步 inspection

### 我的评价

**强烈推荐。**

### 为什么

Claude Code 的 `get_context_usage` 已经证明：

> **context inspection 是一个控制面协议，而不是一个 UI 彩蛋。**

而 nano-agent 当前正好天然拥有：

- WebSocket session transport
- HTTP fallback
- Durable Object session host

这比本地 CLI 更容易把 inspection 做成正式接口。

### 当前代码 reality

目前 `session-do-runtime` 已有：

- `/sessions/:sessionId/ws`
- `/sessions/:sessionId/:action`

但没有专门的 context inspection contract。

`nacp-session` 当前 message families 也没有：

- `session.context.inspect`
- `session.context.snapshot`
- `session.context.policy.update`

所以这项工作是非常合理的 after-foundations 任务。

### 我建议的最小接口

先不要一口气做复杂 API，我建议先冻结两类：

1. **read-only inspection**
   - current usage
   - layers
   - active summaries
   - recent compact events
2. **controlled policy mutation**
   - buffer policy update
   - compact scheduling
   - memory pin/unpin

### 具体推荐形态

#### WebSocket control

- `session.context.get_usage`
- `session.context.get_layers`
- `session.context.get_policy`

#### HTTP fallback

- `GET /sessions/:id/context/usage`
- `GET /sessions/:id/context/layers`
- `GET /sessions/:id/context/policy`

如果后面要做 UI inspector，这样的接口会非常自然。

### Trade-off

代价：

- session protocol 要扩
- redaction / auth 要做对

价值：

- context engine 可观测
- 客户端可做真正的 context inspector
- 为 debug、ops、governance 提供硬抓手

### Verdict

> **应该做，而且这会是 nano-agent context system 从“内部机制”升级成“产品能力”的关键一步。**

---

## 5. 我对整体方案的辩证判断

## 5.1 我认可你的方向

你的这套想法不是“把 compact 做复杂”，而是在做三件更重要的事：

1. **把上下文从黑盒 prompt 变成结构化状态**
2. **把上下文管理从同步故障恢复变成持续后台治理**
3. **把上下文状态从内部隐式逻辑变成可 inspection 的协议面**

这三件事都很有价值。

## 5.2 但我不建议直接照抄 Claude Code

Claude Code 值得学习的部分是：

- budget discipline
- context analysis
- context suggestions
- compact lifecycle
- memory taxonomy
- inspection control request

不应该照抄的部分是：

- 以本地文件为中心的 memory 存储
- forked subagent 作为主要维护机制
- 本地 CLI / REPL 形态下的 UI 假设

## 5.3 你真正应该做的，是把它改写成 Worker-native 版本

如果用一句最准确的话说：

> **Claude Code 已经证明了“上下文治理”是必要的；你现在想做的是把这套治理，从本地 CLI 文件心智，迁移成 Cloudflare Worker 的结构化运行时。**

我认为这是成立的，而且是值得做的。

---

## 6. 我建议的 nano-agent context 管理下一步形态

## 6.1 建议的新分层模型

在当前 `ContextLayerKind` 基础上，我建议下一轮冻结时至少考虑拆出：

1. `system`
2. `memory`
3. `session_head`
4. `tool_evidence`
5. `summary`
6. `artifact_ref`
7. `injected`

当前的：

- `session`
- `workspace_summary`
- `artifact_summary`
- `recent_transcript`

对 v1 foundations 足够，但对你现在的目标太粗。

## 6.2 建议的新协议面

在 `nacp-core / nacp-session` 里建议新增 context 族，而不是只保留 compact request/response：

1. `context.inspect.request/response`
2. `context.policy.update`
3. `context.layer.write`
4. `context.compact.prepare`
5. `context.compact.commit`

不一定要全部进 core，也可以分一部分进 session profile，但协议面迟早要扩。

## 6.3 建议的新 hook 面

建议只补最关键的：

1. `ContextAssemble`
2. `ContextPressure`
3. `ContextLayerWrite`
4. `ContextCompactCommit`
5. `ContextInspect`

## 6.4 建议的新 tool / skill 面

建议形成一个 `context.*` tool cluster：

- `context.inspectUsage`
- `context.inspectLayers`
- `context.pinMemory`
- `context.unpinMemory`
- `context.scheduleCompact`
- `context.overrideBudget`

## 6.5 建议的新 runtime 策略

建议采用：

1. **同步 assemble**
2. **异步 prepare**
3. **边界 commit**
4. **可查询 inspection**

而不是：

1. 同步堆上下文
2. 超了再压
3. 压完继续盲跑

---

## 7. 最终 verdict

### 7.1 对这组需求本身的评价

**我认可，而且我认为这是 nano-agent after-foundations 阶段最值得投入的专题之一。**

### 7.2 与 Claude Code 的关系

**Claude Code 是最强参考对象，但不是最终模板。**

它证明了：

- context budget 要治理
- context usage 要可视化
- compact 要有 hook
- memory 要有独立入口

但它没有解决：

- Worker-native structured hot context
- KV/DO/R2 分层真相
- async compact commit 模型
- protocolized context inspection surface

### 7.3 对 nano-agent 的最终判断

如果 nano-agent 认真做这套 context management，那么它获得的不会只是“更聪明的 compact”。

它真正获得的是：

> **一个可以解释、可以检查、可以编排、可以异步维护、并且真正适配 Worker 运行时的上下文操作系统。**

### 7.4 最终一句话

> **我建议正式把 context window management 提升为 after-foundations 的核心工作流之一：吸收 Claude Code 在 budget / inspection / compact lifecycle 上的经验，但不要复制它的文件心智；把 nano-agent 做成一个结构化、Worker-native、可协议化的 context runtime。**
