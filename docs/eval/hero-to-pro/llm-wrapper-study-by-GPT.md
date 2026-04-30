# real-to-hero：LLM wrapper / 模型切换 / 聊天持久化专项调查（by GPT）

> 本报告只基于当前仓库真实代码、`context/` 下 Claude Code / Codex / Gemini CLI 三个参考 agent 的代码事实，以及当前 6-worker + NACP 拓扑进行独立判断。  
> 目标是回答 owner 提出的 6 个具体问题，并把当前系统在 LLM wrapper、模型 metadata、上下文压缩、聊天记录持久化、checkpoint/revert 方面真实存在的盲点、断点和事实混乱记录清楚。

## 0. 结论先行

当前 nano-agent **已经不再是“完全没有 LLM wrapper”**：`agent-core` 下存在第一版 Workers AI 路线，包括 model registry、Workers AI gateway、request builder、stream normalizer、quota usage commit、tool call round-trip 和 kernel runner 接线。

但这套实现还只是 **first-wave live loop**，距离 Claude Code / Codex / Gemini CLI 那种成熟 LLM wrapper 仍有明显差距：

1. **模型注册有两套事实源，且表达能力不一致。** D1 的 `nano_models` 只表达粗粒度 `context_window / is_reasoning / is_vision / is_function_calling`；`agent-core` 内存 `ModelCapabilities` 额外有 provider、stream、tools、json schema、max output、reasoning efforts。两者没有完整 schema 对齐。
2. **对话前模型选择存在接口雏形，但不是 session-level 配置。** `/models` 可以返回 per-team filtered catalog；`POST /sessions/{id}/messages` 可以带 `model_id` / `reasoning` 并转入 agent-core。但 `POST /sessions/{id}/start` 和 `/input` 的 public path 当前会丢失 `model_id` / `reasoning`，D1 的 conversation/session/turn 表也不持久化“本 session 当前模型”。
3. **上下文拼接是真实存在的，但还很薄。** 当前主链是 user text/parts → kernel turn messages → 自动补一条固定 system prompt → Workers AI execution request。`initial_context` 只走 workspace assembler 的 pending layer seam，尚未形成成熟的 per-request layered context assembly、token-aware history packing、summary reinjection。
4. **loop 中途切换模型可以在 follow-up 粒度“碰巧实现”，但没有模型切换语义。** 因为每个 turn message 可带 `model_id`，下一次 LLM call 会从 active turn messages 里 infer model；但没有 `<model_switch>` 提醒、previous model compaction、turn-level settings audit、用户确认、fallback chain 或跨模型 protected-thinking 清理。
5. **跨模型 context window 变化时的强制压缩机制基本未完成。** kernel scheduler 有 `compactRequired` 分支，`compact.notify` event 也存在；但 orchestrator 当前永远传 `compactRequired: false`，compact delegate 只是 `{ tokensFreed: 0 }`，context-core 的 `/context/compact` 也是 stub。
6. **聊天记录可持久化、可读，但 checkpoint/revert 不成熟。** D1 `nano_conversation_messages` 能保存 user message 和 stream event，`GET /sessions/{id}/history` 可拉取；Session DO 也会把 checkpoint 写到 DO storage 并在 resume 时恢复。但没有“回滚到某个用户可见 checkpoint”的 product API，也没有像 Codex rollout reconstruction 或 Gemini `/restore` 那样的可审计 revert 机制。

因此，对 owner 的问题可以一句话概括：

> **当前系统已经具备“模型目录 + turn 级模型参数 + Workers AI live loop + D1 消息真相 + DO checkpoint”的底座，但还没有完成“可产品化的 LLM wrapper 会话控制层”。真正缺的是 model/session setting SSOT、上下文窗口治理、压缩确认、模型切换语义、checkpoint/revert API 与对应 e2e。**

---

## 1. 参考实现如何回答这些问题

## 1.1 Claude Code：以 runtime model option + context window + auto compact 为中心

Claude Code 的模型选择不是单个字符串，而是运行时配置链：

1. `getUserSpecifiedModelSetting()` 按 session `/model` override、startup `--model`、`ANTHROPIC_MODEL` env、settings 顺序取用户指定模型。
2. `getMainLoopModel()` 返回主 loop 模型；`getRuntimeMainLoopModel()` 可根据 plan mode、permission mode、token 压力等 runtime 状态调整。
3. `modelCapabilities.ts` 会缓存 Anthropic models API 返回的 `max_input_tokens / max_tokens`。
4. `context.ts` 会基于 model capability、1M beta header、env override 等计算 context window、max output tokens 和 thinking budget。

上下文注入方面，Claude Code 在 query loop 中把历史经过 compact boundary、tool-result budget、snip、microcompact、context collapse、auto compact 后，再将 `systemPrompt + systemContext` 和 `userContext` 拼入真正的 model call。

模型切换方面，Claude Code 至少有两类能力：

1. session 里的 `/model` override 会影响后续 turn；
2. fallback model 触发后，loop 会切换 `currentModel`，并对 Anthropic protected thinking signature 做清理，避免跨模型签名失败。

压缩方面，Claude Code 的 auto compact 是强工程化机制：effective window = model window - reserved summary output，阈值、warning/blocking、retry 截断、compact 后 boundary/recent messages/attachments/tool schema/MCP instructions reinjection 都有具体实现。

持久化方面，Claude Code 用 JSONL transcript，消息带 parent UUID chain、compact boundary、tombstone 等；`/rewind` / `checkpoint` 提供用户可见回滚入口。

## 1.2 Codex：以丰富 ModelInfo + turn context override + rollout reconstruction 为中心

Codex 的 `ModelInfo` 明显比 nano-agent 当前 D1 表更 forward-looking。它包含 display、description、default/supported reasoning levels、visibility、priority、base instructions、model messages、reasoning summaries、verbosity、tool type、web search type、truncation policy、parallel tool calls、image detail、context window、auto compact token limit、effective context window percent、experimental tools、input modalities 等字段。

模型切换不是单纯换字符串。Codex 测试明确覆盖 `OverrideTurnContext` 后在下一请求中插入 `<model_switch>` developer message，并说明用户之前使用了不同模型。更关键的是，Codex 会用 previous model 做 inline compact，以适配新模型较小 context window。

上下文与持久化方面，Codex 的 `ContextManager` 管理 canonical history、history version、reference context item；`compact.rs` 生成 summary 并用 replacement history 替换旧历史；`rollout_reconstruction.rs` 能从 rollout 反向扫描 surviving replacement-history checkpoint、rollback、previous turn settings，再正向 replay suffix 重建会话。

这说明 Codex 把“聊天记录”视为可重建的操作日志，而不是只保存最终 message list。

## 1.3 Gemini CLI：以 model config service + `/model` 命令 + chat recording + checkpoint restore 为中心

Gemini CLI 的模型注册由 `ModelConfigService` 管理，包含 aliases、overrides、model definitions、model id resolutions、classifier resolutions、model chains；`ModelDefinition` 里有 displayName、tier、family、isPreview、isVisible、dialogDescription、features.thinking / multimodalToolUse。

用户可以通过 `/model set <model-name> [--persist]` 和 `/model manage` 显式切换模型；`GeminiChat` 在每次 `sendMessageStream()` 时从 config service 解析 active model，并处理 fallback / modifiedModel / onModelChanged。

压缩方面，Gemini CLI 默认在 token limit 50% 左右触发 compression，保留最新 30% history，对旧 function response 做文件化/截断，生成 `<state_snapshot>`，并做二次 verification/probe。

持久化方面，`ChatRecordingService` 用 JSONL 记录 metadata、message、`$set`、`$rewindTo`，Gemini response 还可记录 thoughts、tokens、model、toolCalls；`deleteSession()` 可删除 session 文件及 artifacts；checkpointing 文档和 integration test 覆盖 shadow git snapshot + conversation/tool-call restore。

---

## 2. nano-agent 当前真实实现

## 2.1 6-worker 中 LLM wrapper 的真实位置

当前 LLM live loop 在 `agent-core`，不是 `orchestrator-core`：

| 层级 | 当前职责 | 证据 |
|---|---|---|
| `orchestrator-core` | public facade、JWT/auth、User DO、D1 durable truth、`/models` catalog、转发 start/input/messages 到 `agent-core` RPC | `workers/orchestrator-core/src/index.ts:651-653,1347-1419`；`workers/orchestrator-core/src/user-do-runtime.ts:674-804` |
| `agent-core` | Session DO、kernel runner、Workers AI gateway、tool/capability loop、DO checkpoint | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:123-177`；`workers/agent-core/src/host/runtime-mainline.ts:286-574` |
| `context-core` | 当前 `/sessions/{id}/context/*` RPC 仍是 RH2 stub，不是真正 per-session context engine | `workers/context-core/src/index.ts:123-202` |
| `filesystem-core` | session file/artifact backing，供 image_url 解析和 file API 使用 | 通过 `agent-core` `sessionFileReader` 和 `orchestrator-core` files routes 接入 |
| `bash-core` | capability/tool execution binding | `agent-core` 的 `capabilityTransport` 调用 |
| `orchestrator-auth` | auth/register/login/device/API key | facade 代理到 auth worker |

这一点很重要：**LLM 请求不是 public facade 直接发起的，而是 User DO 转 RPC 到 Agent Core Session DO，再由 Session DO live kernel 调 Workers AI。**

## 2.2 模型目录与 metadata：已有，但不够完整

D1 侧模型表在 `003-usage-quota-and-models.sql`：

| 表 | 当前表达 |
|---|---|
| `nano_models` | `model_id`、`family`、`display_name`、`context_window`、`is_reasoning`、`is_vision`、`is_function_calling`、`status`、timestamps |
| `nano_team_model_policy` | `team_uuid` + `model_id` + `allowed` |
| `nano_usage_events` | usage ledger，包含 `provider_key`、`model_id`、input/output tokens、cost、reasoning/vision flags、request_uuid 等 |

`GET /models` 的 public handler 读取 D1：

```ts
SELECT model_id, family, display_name, context_window,
       is_reasoning, is_vision, is_function_calling, status
  FROM nano_models
 WHERE status = 'active'
```

然后按 `nano_team_model_policy.allowed = 0` 做 deny filter，并返回：

```json
{
  "model_id": "...",
  "family": "...",
  "display_name": "...",
  "context_window": 131072,
  "capabilities": {
    "reasoning": true,
    "vision": true,
    "function_calling": true
  },
  "status": "active"
}
```

证据：`workers/orchestrator-core/src/index.ts:1347-1419`。

`agent-core` 内存侧还有另一套 `ModelCapabilities`：

```ts
export interface ModelCapabilities {
  readonly modelId: string;
  readonly provider: string;
  readonly supportsStream: boolean;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsReasoning?: boolean;
  readonly reasoningEfforts?: readonly ("low" | "medium" | "high")[];
  readonly supportsJsonSchema: boolean;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly notes?: string;
}
```

证据：`workers/agent-core/src/llm/registry/models.ts:8-20`。

`agent-core` 会从 D1 `nano_models` 加载 Workers AI model capabilities，并补成 `supportsStream / supportsTools / supportsVision / supportsReasoning / reasoningEfforts / maxOutputTokens`：

证据：`workers/agent-core/src/llm/gateway.ts:68-91`。

这里的事实判断是：

> **有模型注册，但 D1 SSOT 的字段太薄；agent-core 内存 registry 比 D1 更懂执行需要；两者没有统一到一个 forward-thinking schema。**

缺失字段至少包括：

| 缺失字段类别 | 为什么重要 |
|---|---|
| provider profile | D1 只有 usage event 上有 `provider_key`，`nano_models` 本身没有 provider/source binding |
| max output tokens | request builder 需要，D1 不存，agent-core 固定补 `8192` |
| reasoning levels / default effort | D1 只有 bool `is_reasoning`，无法表达 minimal/low/medium/high/xhigh、thinking budget |
| input modalities | 只能粗略 vision bool，无法表达 text/image/audio/pdf/code 等 |
| tool capabilities granularity | D1 只有 function_calling bool，无法表达 parallel tool calls、tool choice、schema dialect、web search |
| truncation / auto compact policy | 无 token threshold、effective window percent、summary reserve |
| pricing / quota unit | usage 可以记录 cost，但 model catalog 不表达价格、currency、token class |
| fallback / model chain | 无 primary/fallback/preview/stable chain |
| availability / visibility / tier | status 太粗，缺 preview、deprecated、upgrade、team tier |
| system/base instruction compatibility | 无 model-specific instruction template、thinking block handling |

## 2.3 对话前模型选择：`/models` + `/messages.model_id` 有，但 start/input 存在断点

当前存在三个相关接口层：

1. **模型目录**：`GET /models`，返回 team-filtered active model catalog。
2. **多模态消息入口**：`POST /sessions/{id}/messages` 支持 `model_id` 和 `reasoning`。
3. **legacy text 入口**：`POST /sessions/{id}/start`、`POST /sessions/{id}/input`。

`/messages` 的 User DO handler 会验证 `model_id` 格式和 `reasoning.effort`，并调用 `requireAllowedModel()` 做 team policy gate，然后把 `{ model_id, reasoning }` 转发给 agent-core：

证据：`workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310`。

NACP session schema 也已经允许 `session.start`、`session.followup_input` 和 `SessionMessagePostBody` 携带 `model_id` / `reasoning`：

证据：`packages/nacp-session/src/messages.ts:43-52,119-136`。

但是 public facade 的 text start/input path 有两个明显断点：

1. `StartSessionBody` 类型没有 `model_id` / `reasoning` 字段，`handleStart()` 转发给 agent-core 时只包含 `initial_input`、`initial_context`、`trace_uuid`、`authority`，没有带上模型参数。证据：`workers/orchestrator-core/src/session-lifecycle.ts:41-48`；`workers/orchestrator-core/src/user-do/session-flow.ts:342-347`。
2. `/input` 兼容 path 先被转换成 `/messages` shape，但它只复制 text、auth、context_ref、stream_seq，没有复制 `model_id` / `reasoning`。证据：`workers/orchestrator-core/src/session-lifecycle.ts:50-57`；`workers/orchestrator-core/src/user-do/session-flow.ts:445-454`。

因此：

> **如果前端使用 `/messages`，模型选择可以进入 agent-core；如果使用 `/start` 或 `/input`，模型选择会在 orchestrator-core 兼容层被丢掉。**

此外，D1 `nano_conversation_sessions` / `nano_conversation_turns` 没有 `model_id` / `reasoning_effort` 字段；`recordUserMessage()` 在 durable history 中也只写 `{ parts }` 或 `{ text }`，不把模型选择写进 message body。证据：`workers/orchestrator-core/src/user-do/message-runtime.ts:265-273`；`workers/orchestrator-core/src/user-do/session-flow.ts:310-318`。

这导致后续审计只能从 `nano_usage_events` 的 committed usage 反推某次 LLM 消费用了什么模型，而不能从 conversation/session/turn truth 直接知道“用户请求这个 turn 时选择了什么模型”。

## 2.4 模型如何与上下文拼接并注入 agentic loop

当前真实链路如下：

1. client 调 `POST /sessions/{id}/messages` 或 `/start` / `/input`；
2. User DO 写 D1 turn/message/activity；
3. User DO 通过 RPC 调 `agent-core.start()` 或 `agent-core.input()`；
4. Agent Core Entrypoint 把 RPC 转成 `session.internal` DO request；
5. `NanoSessionDO` 的 HTTP fallback controller 构造 NACP client frame；
6. WS runtime `acceptIngress()` 通过 NACP schema / phase legality gate；
7. `extractTurnInput()` 从 `session.start` / `session.followup_input` 中取 `content`、`parts`、`modelId`、`reasoning`；
8. `SessionOrchestrator.startTurn()` 把 user message 写入 `activeTurn.messages`；
9. `KernelRunner` 调 delegates.llm.call；
10. `createMainlineKernelRunner()` 自动补固定 system prompt，然后构建 Workers AI execution request；
11. `WorkersAiGateway.executeStream()` 调 `invokeWorkersAi()` 并把 delta/tool/usage 映射回 runtime events。

关键代码证据：

| 环节 | 证据 |
|---|---|
| turn input 提取模型/parts | `workers/agent-core/src/host/turn-ingress.ts:77-130` |
| active turn message 写入 `model_id` / `reasoning` | `workers/agent-core/src/host/orchestration.ts:231-247` |
| 固定 system prompt | `workers/agent-core/src/host/runtime-mainline.ts:162-177` |
| LLM call 构建 Workers AI request | `workers/agent-core/src/host/runtime-mainline.ts:286-307` |
| request builder 做 capability validation | `workers/agent-core/src/llm/request-builder.ts:34-121` |
| Workers AI gateway stream | `workers/agent-core/src/llm/gateway.ts:281-346` |
| tool call round-trip | `workers/agent-core/src/host/runtime-mainline.ts:355-520` |

目前上下文拼接的实际成熟度是：

| 能力 | 当前状态 | 判断 |
|---|---|---|
| system prompt | 有固定 `NANO_AGENT_SYSTEM_PROMPT`，如果 messages 已有 system 则不重复插入 | 可用但很薄 |
| user message | 每个 turn 的 user content/parts 进入 active turn messages | 可用 |
| tool result reinjection | reducer 会把 assistant tool_call 和 tool result 写回 turn messages，并继续下一次 LLM call | 可用 |
| image_url session file 解析 | `resolveSessionFileImages()` 可把 session file content endpoint 转 data URL | 可用但依赖 file reader |
| initial_context | WS runtime 会把 `initial_context` append 到 workspace assembler pending layer | seam 存在 |
| full layered context | `ContextAssembler` 包存在，但 live loop 只显式注入固定 system prompt；没有看到按 layer/token budget 组装进每次 LLM request 的完整链路 | 未成熟 |
| durable history → next turn context | 当前新 turn 的 active messages 只包含当前 turn user message；上一 turn D1 history 不自动重放进 prompt | 明显缺口 |

这和 Claude/Codex/Gemini 最大差异是：参考实现会把历史、system context、workspace context、tool schema、summary boundary 统一纳入每次请求前的 context manager；nano-agent 当前更像“每个 turn 当前局部消息 + tool loop”，跨 turn 聊天上下文还没有成为 LLM request 的稳定输入。

## 2.5 loop 中是否可以中途切换不同模型

严格说，当前 nano-agent 有 **turn-level model override 的基础能力**，但没有成熟的“中途模型切换机制”。

可用部分：

1. `session.followup_input` 和 `/messages` body 可带 `model_id` / `reasoning`。
2. `extractTurnInput()` 会把 `model_id` / `reasoning` 放入 `TurnInput`。
3. `SessionOrchestrator.startTurn()` 会把它写进 active turn 的 user message。
4. `buildWorkersAiExecutionRequestFromMessages()` 会从 messages 里 infer `model_id` / `reasoning`，构建 execution request。

证据：`packages/nacp-session/src/messages.ts:119-136`；`workers/agent-core/src/host/turn-ingress.ts:85-97,120-129`；`workers/agent-core/src/host/orchestration.ts:237-245`；`workers/agent-core/src/llm/gateway.ts:165-188,208-231`。

缺失部分：

| 缺失点 | 影响 |
|---|---|
| session 当前模型状态 | 没有 `session.model_id` 或 active model settings；只能靠当前 turn message 里的字段 |
| turn-level durable setting | D1 turn/message 不持久化 model request setting |
| model switch event | 没有 `model.switch` / `<model_switch>` developer message |
| previous model compact | 从大窗口切到小窗口时不会先用旧模型压缩历史 |
| protected thinking 清理 | 没有 Claude Code 那类 signature block strip |
| fallback model chain | Workers AI gateway 有 primary/fallback 常量，但 request 执行没有成熟 fallback chain |
| 用户确认 | 没有“切换模型将压缩/丢弃上下文，是否继续”的产品接口 |

所以对问题 3 的回答是：

> **可以在 follow-up 粒度传入不同 `model_id`，但这只是参数覆盖，不是成熟模型切换。当前没有模型切换语义、审计、压缩适配或确认机制。**

## 2.6 跨模型 context window 不同：强制压缩机制是什么，是否让用户确认

当前没有可称为“强制压缩”的成熟机制。

已有原材料：

1. `ContextAssembler` 能按 `maxTokens - reserveForResponse` 做 layer 选择和 optional layer drop。证据：`packages/workspace-context-artifacts/src/context-assembler.ts:85-167`。
2. `CompactBoundaryManager` 能构造 `context.compact.request`，选择 split point，并把 compact response 应用为 boundary marker。证据：`packages/workspace-context-artifacts/src/compact-boundary.ts:125-219`。
3. Kernel scheduler 有 `compactRequired` 分支。证据：`workers/agent-core/src/kernel/scheduler.ts:49-52`。
4. Kernel runner 有 `handleCompact()`，会 emit `compact.notify`。证据：`workers/agent-core/src/kernel/runner.ts:337-361`。
5. `context-core` 暴露 `/context/compact` RPC，但当前明确返回 `phase: "stub"`。证据：`workers/context-core/src/index.ts:181-202`。

断点：

1. `SessionOrchestrator.runStepLoop()` 当前每次 signals 都传 `compactRequired: false`。证据：`workers/agent-core/src/host/orchestration.ts:294-300`。
2. `createMainlineKernelRunner()` 的 compact delegate 返回 `{ tokensFreed: 0 }`。证据：`workers/agent-core/src/host/runtime-mainline.ts:517-520`。
3. 没有看到基于 selected model context window 的 token counting、threshold、summary reserve、automatic compact trigger。
4. 没有用户确认接口；也没有像 Gemini CLI 那样的 compression failed guard、verification probe，或像 Claude Code 那样的 warning/blocking thresholds。

因此对问题 4 的回答是：

> **目前没有跨模型上下文窗口差异下的强制压缩机制，也没有用户确认接口。代码里有 compact primitive 和 event kind，但 live loop 没有接上 token threshold、summary 生成、history replacement、用户确认或失败恢复。**

## 2.7 DDL 如何表达模型注册，是否 forward-thinking

当前 DDL 是“可启动 model catalog”的水平，但不是 forward-thinking 的 LLM model registry。

优点：

1. `nano_models` 能让 `/models` 以 D1 为真相源，而不是 hardcode。
2. `nano_team_model_policy` 能做 team-level deny filter。
3. `nano_usage_events` 能把 usage 与 provider/model/request/session/turn 关联。

不足：

| DDL 缺口 | 具体问题 |
|---|---|
| `nano_models.provider_key` 缺失 | agent-core 只能默认把 D1 model 当 Workers AI model 处理 |
| model settings 不可审计 | session/turn 表没有 `requested_model_id`、`effective_model_id`、`reasoning_effort` |
| metadata 太粗 | 只有 context window 和三个 bool |
| 无 request compatibility | 不表达 JSON schema、parallel tools、tool choice、streaming、input modality |
| 无 compression policy | 不表达 auto compact threshold、summary budget、effective context percent |
| 无 fallback chain | 无 primary/fallback/stable/preview/deprecated 关系 |
| 无 pricing | usage ledger 有 cost 字段，但 model catalog 不表达 price table |
| 无 UI/产品属性 | 无 display tier、visibility、preview、upgrade、description、dialog/help text |
| 无版本与 provider sync | 无 provider model revision、deprecation timestamp、last synced |

如果对标 Codex `ModelInfo` 或 Gemini `ModelDefinition`，当前 DDL 明显偏保守。它适合 RHX 早期 catalog，但不适合作为长期 LLM wrapper SSOT。

## 2.8 聊天记录如何保存、拉取、销毁；是否支持 snapshot revert

当前持久化分两层：

### 2.8.1 D1 durable truth：产品侧会话记录

`002-session-truth-and-audit.sql` 定义：

| 表 | 作用 |
|---|---|
| `nano_conversations` | conversation 聚合 |
| `nano_conversation_sessions` | session 状态、trace、last phase、last event seq |
| `nano_conversation_turns` | turn index、turn kind/status、input text |
| `nano_conversation_messages` | message role/kind/body/event seq |
| `nano_conversation_context_snapshots` | initial/context snapshot payload |
| `nano_session_activity_logs` | session activity/audit |

`D1SessionTruthRepository` 写入：

1. `appendMessage()` 写 `nano_conversation_messages`。证据：`workers/orchestrator-core/src/session-truth.ts:573-586`。
2. `appendStreamEvent()` 把 stream event 作为 `message_kind = 'stream-event'` 写入同表，并更新 session `last_event_seq`。证据：`workers/orchestrator-core/src/session-truth.ts:588-624`。
3. `captureContextSnapshot()` 写 `nano_conversation_context_snapshots`。证据：`workers/orchestrator-core/src/session-truth.ts:626-665`。
4. `readTimeline()` 拉 stream events。证据：`workers/orchestrator-core/src/session-truth.ts:786-795`。
5. `readHistory()` 拉完整 messages。证据：`workers/orchestrator-core/src/session-truth.ts:797-820`。

User DO 暴露 `GET /sessions/{id}/history`，直接返回 D1 messages：

证据：`workers/orchestrator-core/src/user-do-runtime.ts:453-455`；`workers/orchestrator-core/src/user-do/session-flow.ts:593-608`。

`POST /sessions/{id}/resume` 只返回 status、last_phase、relay_cursor、replay_lost，不返回完整 history：

证据：`workers/orchestrator-core/src/user-do/surface-runtime.ts:178-219`。

### 2.8.2 DO checkpoint：runtime/hibernation 侧状态

`NanoSessionDO` 会持有 memory state、WS helper、stream seq、team/user uuid，并在 close/turn end 等路径做 checkpoint：

1. checkpoint shape 包含 `kernelFragment`、`replayFragment`、`streamSeqs`、`workspaceFragment`、`hooksFragment`、`usageSnapshot`。证据：`workers/agent-core/src/host/checkpoint.ts:43-56`。
2. `persistCheckpoint()` 实际写 `session:checkpoint`，当前 workspace/hooks/replay fragment 多数为 null/empty 或 helper 自己单独 checkpoint。证据：`workers/agent-core/src/host/do/session-do-persistence.ts:142-187`。
3. `restoreFromStorage()` 从 DO storage 读 checkpoint 并恢复 actor phase、kernel snapshot、turn count。证据：`workers/agent-core/src/host/do/session-do-persistence.ts:193-222`。
4. WS `session.resume` 会 restore helper 和 storage。证据：`workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`。

这说明“resume from hibernation”有基础能力，但“用户选择 checkpoint 并 revert back”没有成熟产品能力。

### 2.8.3 销毁与删除

当前看到的删除路径主要是：

1. start 失败时 rollback session start，删除 context snapshots/messages/activity/turns/session，必要时删除 conversation。证据：`workers/orchestrator-core/src/session-truth.ts:743-784`。
2. User DO alarm 清理 ended hot state，只删除 DO hot keys / recent frames / cache，不删除 D1 durable history。证据：`workers/orchestrator-core/src/user-do/durable-truth.ts:289-377`。
3. 未看到类似 Gemini `deleteSession()` 的产品级“删除会话 + artifacts + subagent dirs + durable truth”的接口。

### 2.8.4 checkpoint revert

当前不支持用户可见 revert：

1. 没有 `/restore`、`/rewind`、`/sessions/{id}/checkpoints/{checkpoint}/restore` 一类 public API。
2. D1 messages 没有 rollback marker、surviving checkpoint marker、parent chain 或 operation log。
3. DO checkpoint 只有最新 `session:checkpoint`，不是多 checkpoint timeline。
4. 没有看到完整 e2e 覆盖“对话历史 + 文件状态 + tool call + runtime state”一起 restore 到某个用户选择点。

因此对问题 6 的回答是：

> **聊天记录保存和拉取已存在，D1 是长期 truth；Session DO checkpoint 也能支持 hibernation resume。但当前没有产品级 snapshot revert/back-to-checkpoint 机制，也没有完整 e2e 证明 conversation/file/tool/runtime 四类状态可一起回滚。**

---

## 3. 对 owner 六个问题的逐项回答

## Q1：当前模型注册机制是什么？是否有对话开始前模型选择接口？模型是否有自己的 metadata？

**当前模型注册机制**：

1. D1 `nano_models` + `nano_team_model_policy` 是 public `/models` 的真相源。
2. `agent-core` 内部 `ModelRegistry` / `ProviderRegistry` 是执行时真相源。
3. Workers AI model capabilities 可从 D1 加载后注入 `agent-core` request builder。

**对话开始前模型选择接口**：

1. 有 `/models` 给前端选择模型。
2. `/messages` 支持 `model_id` / `reasoning`。
3. NACP `session.start` schema 支持 `model_id` / `reasoning`。
4. 但 public `POST /sessions/{id}/start` 当前没有把 `model_id` / `reasoning` 传给 agent-core；`/input` 也会丢掉它们。

**metadata 是否足够**：

不够。当前 D1 metadata 只够 UI 列表和粗 gate，不够长期 LLM wrapper。应补 provider、max output、reasoning levels/default、thinking budget、modalities、tool schema dialect、parallel tool calls、pricing、fallback chain、auto compact policy、visibility/tier/deprecation 等。

## Q2：模型如何与上下文拼接，并注入 agentic loop？

当前路径是：

`client message → User DO D1 truth → Agent Core RPC → Session DO NACP ingress → TurnInput → activeTurn.messages → fixed system prompt → Workers AI ExecutionRequest → KernelRunner loop → llm.delta/tool.call.result/turn.end stream events`。

这条链路可以跑真实 LLM 与工具回合，但上下文拼接还偏“当前 turn 局部”：

1. 不自动从 D1 history 拉取过去 turns 进入 prompt。
2. `ContextAssembler` / compact boundary package 尚未成为 live request 的主路径。
3. `initial_context` 只进入 workspace pending layer seam，尚未证明每次 LLM call 都稳定消费 layered context。

## Q3：loop 过程中是否可以中途切换不同模型？

可以在 follow-up / messages 粒度传不同 `model_id`，下一次 turn 的 LLM call 会 infer 该 model。

但没有成熟中途切换：

1. 没有 session active model setting。
2. 没有 model switch event / developer message。
3. 没有 previous model compact。
4. 没有跨模型 thinking/tool schema 清理。
5. 没有用户确认。
6. 没有 durable audit 表达 requested/effective model。

## Q4：切换模型后 context window 不同，强制压缩机制是什么？是否有用户确认？

当前没有可用机制。

代码里有 `compactRequired`、`compact.notify`、`CompactBoundaryManager`、`context-core.triggerCompact()` 这些原材料，但 live loop 没接：

1. `compactRequired` 永远 false。
2. compact delegate 返回 `{ tokensFreed: 0 }`。
3. context-core compact 是 stub。
4. 没有 token counting / threshold / summary prompt / replacement history。
5. 没有用户确认接口。

## Q5：DDL 中模型注册如何通过数据表表达？表达空间是否足够？

DDL 当前表达：

1. `nano_models`：粗 model catalog。
2. `nano_team_model_policy`：team deny/allow。
3. `nano_usage_events`：usage ledger。

不足以支撑长期 LLM wrapper。建议至少新增或扩展：

1. `provider_key`、`provider_model_id`、`model_revision`。
2. `max_output_tokens`、`input_modalities_json`、`tool_capabilities_json`。
3. `reasoning_efforts_json`、`default_reasoning_effort`、`thinking_budget_policy_json`。
4. `pricing_json`、`quota_unit_policy_json`。
5. `context_policy_json`：auto compact threshold、summary reserve、effective window percent。
6. `fallback_chain_json` / 单独 `nano_model_fallbacks`。
7. `visibility`、`tier`、`is_preview`、`deprecated_at`、`sunset_at`。
8. session/turn requested/effective model fields，避免 usage ledger 成为唯一追溯源。

## Q6：agent loop session 的聊天记录如何保存、拉取、销毁？snapshot revert 是否存在？

**保存**：

1. User input 写 `nano_conversation_messages`。
2. stream event 也写 `nano_conversation_messages`，`message_kind = 'stream-event'`。
3. context snapshot 写 `nano_conversation_context_snapshots`。
4. usage 写 `nano_usage_events`。
5. Session DO runtime checkpoint 写 DO storage `session:checkpoint`。

**拉取**：

1. `GET /sessions/{id}/history` 返回 D1 messages。
2. `GET /sessions/{id}/timeline` 返回 D1 stream events 或 agent-core timeline fallback。
3. `POST /sessions/{id}/resume` 返回 cursor/status，不返回完整 history。

**销毁**：

1. start 失败有 rollback。
2. ended hot state 有 User DO cleanup。
3. 未看到完整产品级 delete session / delete artifacts / delete durable truth API。

**snapshot revert**：

没有成熟机制。只有 hibernation-style latest checkpoint restore，不是用户选择历史 checkpoint 的 revert。也没有看到完整 e2e 覆盖 revert。

---

## 4. 当前最关键的盲点、断点、逻辑错误与事实混乱

## 4.1 “已有 LLM wrapper” 与 “产品级 LLM wrapper” 容易被混为一谈

当前 `agent-core/src/llm/*` 确实已经有真实实现：

1. model/provider registry；
2. request builder；
3. Workers AI gateway；
4. stream event normalization；
5. tool call loop；
6. quota usage commit。

但这不等于产品级 wrapper 完成。产品级 wrapper 还必须覆盖：

1. model/session settings；
2. cross-turn history packing；
3. context window accounting；
4. compaction；
5. model switch；
6. user confirmation；
7. checkpoint/revert；
8. durable audit。

当前代码完成了第一组的大部分，但第二组只有原材料。

## 4.2 `/start`、`/input`、`/messages` 三条入口的模型参数不一致

这是当前最实际的 API 断点：

1. NACP schema 支持 start/followup 的 `model_id`。
2. Agent Core HTTP fallback controller 支持把 `model_id` 放进 NACP frame。
3. User DO `/messages` 支持。
4. 但 orchestrator-core public `/start` 和 `/input` 兼容层没有传递。

这会让前端以为“开始对话前可选模型”，实际 start 请求无法生效，除非走 `/messages` 或以后修复 `/start` body。

## 4.3 D1 conversation truth 没有保存 model request setting

`nano_usage_events.model_id` 只能说明最终某次 usage commit 用了什么模型，不能完整表达：

1. 用户请求了什么模型；
2. policy 是否改写；
3. fallback 后 effective model 是什么；
4. reasoning effort 是什么；
5. 模型切换发生在第几个 turn；
6. 切换是否触发压缩或用户确认。

这会影响 billing dispute、debug、audit、client resume UI 和未来回放。

## 4.4 跨 turn 聊天上下文没有稳定注入 LLM

D1 history 已经能保存，但 live LLM request 当前主要从 active turn messages 出发。上一 turn 的 assistant response / tool result 是否作为下一 turn prompt 的历史输入，目前没有成熟 chain。

这意味着系统可能“看起来像 chat”，但模型侧更像“每次新 turn 只看当前输入”。如果这是有意的短期限制，应在 API docs / closure 中明确；如果不是，则是核心对话质量断点。

## 4.5 compact 相关代码存在多处原材料，但主链未接通

当前同时存在：

1. `ContextAssembler` 的 token budget；
2. `CompactBoundaryManager`；
3. kernel scheduler 的 `compactRequired`；
4. kernel runner 的 `compact.notify`；
5. context-core 的 `triggerCompact()` route；
6. D1 context snapshot 表；

但没有形成闭环：

`token measurement → threshold decision → user notice/confirm → summary generation → replacement history → durable snapshot → prompt reinjection → post-compact audit`。

因此文档或计划中不能把“有 compact primitive”表述成“已有强制压缩机制”。

## 4.6 Session DO checkpoint 是 hibernation restore，不是 product checkpoint/revert

`session:checkpoint` 的存在容易造成事实混乱。它当前更接近 DO hibernation/restore 的内部状态快照，不是用户可见 checkpoint：

1. 只保留最新 checkpoint；
2. 没有 checkpoint list；
3. 没有 restore target；
4. 没有 D1 rollback marker；
5. 没有 file/artifact/tool inflight 一体化恢复证明；
6. 没有用户确认和 e2e。

对外不能宣称已具备 Codex/Gemini 级别 rollback/revert。

## 4.7 context-core 的当前状态需要避免被误读

`context-core` 现在公开的 RH2 context inspection RPC 明确是 stub，返回 `phase: "stub"`。它不是成熟 per-session context manager。

如果后续文档说“context-core 已经负责 session context compact”，这是事实错误。正确说法应是：

> context-core 已经有 facade route 和 RPC seam；真实 per-session context inspector / compact engine 仍待后续阶段接入。

## 4.8 用户确认机制缺位

参考实现里，模型切换、压缩、checkpoint restore 往往会至少有用户可见命令、notice 或 UI affordance。nano-agent 当前对以下动作缺少确认机制：

1. 切换到更小 context window；
2. 强制压缩；
3. 丢弃旧 tool output；
4. replay lost 后重建；
5. revert checkpoint；
6. fallback 到另一个模型；
7. reasoning effort 降级。

这会影响用户信任，也会影响前端可解释性。

---

## 5. 建议的后续收口顺序

## 5.1 先修 API 和 truth 断点

1. 让 `StartSessionBody` / `FollowupBody` 包含 `model_id` / `reasoning`，并在 `/start`、`/input` 兼容层完整转发。
2. D1 turn/message 写入 requested model setting：至少 `requested_model_id`、`requested_reasoning_effort`、`effective_model_id`、`effective_reasoning_effort`。
3. `/history` 返回 message 时保留 model metadata，便于前端展示和 replay。

## 5.2 再建立 model registry SSOT

扩展 `nano_models` 或建立 `nano_model_capabilities`：

1. provider / model revision；
2. context + max output；
3. reasoning / thinking；
4. modalities；
5. tools；
6. pricing；
7. fallback；
8. compact policy；
9. UI visibility / tier / deprecation。

然后让 `/models` 和 `agent-core` request builder 读取同一表达，不再各自补字段。

## 5.3 再做 cross-turn context manager

最小闭环：

1. 从 D1 `readHistory()` 或 Session DO kernel snapshot 取历史；
2. 合并 system prompt、initial_context、workspace layers、recent transcript、tool results；
3. 按 selected model context window 做 token budget；
4. 生成 request assembly evidence；
5. 明确哪些 layer 被 drop，向 client/audit 解释。

## 5.4 再做压缩和模型切换

按参考实现组合：

1. 模型切换时写 `model.switch` 或 developer message；
2. 如果新模型窗口更小，先触发 compact planning；
3. 用户确认后执行 summary；
4. compact result 写 context snapshot / boundary；
5. prompt 中 reinject summary + recent messages；
6. e2e 覆盖大窗口 → 小窗口、reasoning → non-reasoning、vision → non-vision。

## 5.5 最后做 product checkpoint/revert

不要把当前 DO hibernation checkpoint 直接当 product checkpoint。建议单独设计：

1. checkpoint manifest 表；
2. checkpoint fragments：conversation messages、runtime kernel、workspace artifacts、tool inflight、usage；
3. rollback marker；
4. restore API；
5. user confirmation；
6. full e2e：文件修改 + tool call + LLM history + replay buffer + usage 不变量。

---

## 6. 最终判断

当前 nano-agent 的价值在于：它已经把 6-worker、NACP、D1 truth、Session DO live loop、Workers AI gateway、quota/audit/stream event 串成了一个能继续向真实 LLM wrapper 演进的底座。

但如果问题是“我们是否已经具备成熟 LLM wrapper 所需的模型注册、模型选择、上下文压缩、模型切换、聊天记录 checkpoint/revert 基础设施”，答案是：

> **还没有。当前具备的是 first-wave runtime substrate；缺的是 model/session configuration SSOT、cross-turn context manager、token-aware compaction、model-switch semantics、user confirmation，以及 product-grade checkpoint/revert。**

这不是小修小补的文档问题，而应该作为 real-to-hero 后续阶段的一个独立工程簇处理。
