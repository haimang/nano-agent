# real-to-hero：Agentic Loop API 缺口专项调查（by GPT）

> 本报告基于当前仓库真实代码、`clients/api-docs/` 当前文档、`docs/eval/hero-to-pro/` 三份 LLM wrapper 调查报告，以及 `context/` 下 Claude Code / Codex / Gemini CLI 的参考实现进行进一步 API 面调查。  
> 调查重点不是重复判断“LLM wrapper 是否完整”，而是从产品 API 角度回答：如果要支撑完整 agentic loop，当前模型、上下文、聊天、确认、工具、临时文件与 checkpoint/revert 接口还缺什么。

## 0. 结论先行

当前 nano-agent 的 API 面已经能支撑 RHX2 后的 **first-wave live session**：

1. `GET /models` 已有 D1 模型目录、team policy deny filter、ETag/304。
2. `POST /me/sessions`、`POST /sessions/{id}/start`、`POST /sessions/{id}/input`、`POST /sessions/{id}/messages`、`GET /status|timeline|history`、`GET /ws`、`POST /resume` 已经形成客户端可用的 session 主链。
3. `POST /sessions/{id}/permission/decision`、`POST /sessions/{id}/elicitation/answer`、`POST /sessions/{id}/policy/permission_mode` 已有 HTTP 替代入口。
4. `GET|POST /sessions/{id}/files` 和 `GET /sessions/{id}/files/{fileUuid}/content` 已经接到 `filesystem-core` 的 artifact/R2 路线。
5. `GET|POST /sessions/{id}/context*` 已经有 public facade 路由。

但如果目标是 hero-to-pro 阶段的完整 agentic loop，这些 API 仍然只是“能启动和观察一条会话”的壳，而不是成熟 agent 产品的控制面。最重要的断点如下：

| 领域 | 当前事实 | 核心缺口 |
|---|---|---|
| 模型 API | 只有 `GET /models`；`/messages` 可带 `model_id` / `reasoning`；`/start` / `/input` public path 会丢失模型字段 | 无 default/current model、无 session-level model setting、无模型切换 preview/confirm、无 rich metadata、无 alias、无 fallback chain |
| 上下文 API | `/context` / `/context/snapshot` / `/context/compact` 存在，但 `context-core` 返回 `phase:"stub"` | 无 context probe、无 token budget、无 layer 列表、无 compact preview/job、无用户确认、无 checkpoint list/restore |
| 聊天 API | session 创建、启动、输入、取消、读 history/timeline、resume 已 live | 无显式 close/delete、无 retry/rollback/fork、无 continuation policy、无完整 replay reconciliation、无 message/turn 级操作 |
| 确认/授权 API | permission/elicitation HTTP endpoint 存在；NACP schema 也有 request/decision/answer family | public WS request round-trip 未 live，runtime 不等待 decision/answer；没有统一 confirmation API 覆盖压缩、模型切换、fallback、上下文损失 |
| Agentic loop API | bash-core 有受控 capability，filesystem-core 有 artifact API | 无 todo-list/plan state API、无 tool-call/inflight 查询与单 tool cancel、无 workspace temp file read/write/cleanup 产品 API |

一句话判断：

> **当前 API 适合“启动一个 first-wave agent session 并读回流”，但不适合“用户可控、可回滚、可审计、可跨模型切换、可主动压缩、可管理工具与临时工作区”的完整 agentic loop。下一阶段不应只继续增加 worker 内部能力，而必须把 session control plane 作为独立产品面补齐。**

---

## 1. 三份 hero-to-pro LLM wrapper 调查报告的共同指向

三份报告虽然在若干细节上有差异，但共识很清楚：

1. 模型 metadata 目前不够表达真实 agent runtime 需要。D1 `nano_models` 当前字段只有 `model_id / family / display_name / context_window / is_reasoning / is_vision / is_function_calling / status`，而 agent-core runtime `ModelCapabilities` 还需要 `provider / supportsStream / supportsTools / supportsJsonSchema / maxOutputTokens / reasoningEfforts` 等字段。
2. 上下文能力存在若干包内基础设施，但主 LLM 调用路径仍然是 active turn messages 加固定 system prompt，再进入 Workers AI。没有产品级 context probe、token budget、压缩策略和跨模型窗口治理。
3. 当前可持久化 conversation/session/turn/message/stream event，但没有用户可见 checkpoint list、restore、rollback、fork 或 revert API。
4. 模型切换目前最多是 turn-level `model_id` 传递，不是产品语义上的 switch：没有 preview、用户确认、压缩预处理、model-switch developer message、fallback audit。

需要特别修正一个事实：DeepSeek 报告中关于 `runtime-assembly.ts` 没有传 `modelCatalogDb` 的说法，按当前代码已经不成立。`createLiveKernelRunner()` 现在把 `runtimeEnv.NANO_AGENT_DB` 传给 `createMainlineKernelRunner()`，证据是 `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:123-133`。因此当前更准确的判断是：**D1 model catalog 已经进入 agent-core LLM runner 的 capability loading 路径，但 public session API 与 D1 durable truth 对模型选择的持久化/产品语义仍未闭环。**

---

## 2. 参考 agent 对 API/命令面的解法

## 2.1 Claude Code：把模型、压缩、回滚、任务都做成用户显式命令

Claude Code 暴露的是 CLI 命令面，但它对应的是成熟 agentic loop API 的产品语义。

| 能力 | 参考实现事实 | 对 nano-agent 的启发 |
|---|---|---|
| 模型选择 | `/model` 命令说明为 “Set the AI model for Claude Code”，并显示当前 main loop model；证据：`context/claude-code/commands/model/index.ts:5-16` | 需要 session-level 当前模型与可变更入口，而不是只在 message body 里塞 `model_id` |
| 主动压缩 | `/compact` 支持“清空历史但保留摘要”，并允许自定义 summarization instructions；证据：`context/claude-code/commands/compact/index.ts:4-13` | compact 应是用户可触发、可解释、可带指令的动作 |
| 回滚/检查点 | `/rewind` alias `checkpoint`，描述为恢复代码和/或对话到 previous point；证据：`context/claude-code/commands/rewind/index.ts:3-11` | checkpoint 不能只存在 DO storage 内部，需要列表、选择、恢复模式 |
| 后台任务 | `/tasks` / `bashes` 可列出和管理 background tasks；证据：`context/claude-code/commands/tasks/index.ts:3-9` | 长工具调用、后台任务、inflight tool 必须有独立可见 API |
| 上下文文件 | `/files` 可列出当前 context 中的文件；证据：`context/claude-code/commands/files/index.ts:3-10` | artifact list 不等于 context file list，客户端需要知道“哪些文件正在进入上下文” |

Claude Code 的核心经验是：**模型选择、压缩、回滚、任务、上下文文件都是用户可感知的 loop 控制面，不应只作为内部 runtime 细节存在。**

## 2.2 Codex：把模型切换、rollback、undo、rollout reconstruction 作为协议事件

Codex 的 API 面更像事件化 runtime：

1. 模型 metadata 很厚。测试中的 `ModelInfo` 包含 `default_reasoning_level`、`supported_reasoning_levels`、`shell_type`、`visibility`、`input_modalities`、`base_instructions`、`truncation_policy`、`supports_parallel_tool_calls`、`context_window`、`auto_compact_token_limit`、`effective_context_window_percent` 等字段；证据：`context/codex/codex-rs/core/tests/suite/model_switching.rs:63-104`。
2. 模型切换不是沉默换模型，而是通过 `Op::OverrideTurnContext` 改写 turn context，并在下一次请求里插入 `<model_switch>` developer message；证据：`context/codex/codex-rs/core/tests/suite/model_switching.rs:142-190`。
3. rollout reconstruction 能从 compacted replacement history、rollback event、previous turn settings、reference context item 重建历史；证据：`context/codex/codex-rs/core/src/codex/rollout_reconstruction.rs:86-240`。
4. undo 能恢复由 turn 创建的新文件或 tracked/untracked file edit；证据：`context/codex/codex-rs/core/tests/suite/undo.rs:114-205`。

Codex 的核心经验是：**agentic loop 的 API 不只是 CRUD，而是可重放的操作日志。模型切换、压缩、rollback、undo 都应是可记录、可重建、可审计的事件。**

## 2.3 Gemini CLI：把 model/compress/restore/rewind/session recording 做成完整用户工作流

Gemini CLI 的命令面也直接映射到产品 API 需求：

| 能力 | 参考实现事实 | 对 nano-agent 的启发 |
|---|---|---|
| 模型设置 | `/model set <model-name> [--persist]`，可持久化；`/model manage` 打开配置 dialog；证据：`context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-74` | 需要 transient/permanent 两类模型设置 |
| 主动压缩 | `/compress` / `/summarize` / `/compact` 会展示 pending、原 token、新 token、compression status；证据：`context/gemini-cli/packages/cli/src/ui/commands/compressCommand.ts:10-83` | compact API 应返回 before/after token、状态、失败原因 |
| restore tool call | `/restore` 可列出 checkpoint JSON，读取 tool call data，恢复 conversation/file history 并重新执行工具；证据：`context/gemini-cli/packages/cli/src/ui/commands/restoreCommand.ts:35-173` | checkpoint restore 需要同时覆盖对话和文件状态 |
| rewind | `/rewind` 能选择 RewindOnly、RevertOnly、RewindAndRevert，并会重置 client history 和 memory context manager；证据：`context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-199` | 回滚 API 需要支持“只回对话 / 只回文件 / 同时回” |
| transcript | `ChatRecordingService` 解析 JSONL 中的 message、`$set`、`$rewindTo` 等记录；证据：`context/gemini-cli/packages/core/src/services/chatRecordingService.ts:75-176` | D1 message list 不够，需要可表达 rewind/tombstone/metadata update 的 transcript 语义 |

Gemini 的核心经验是：**用户不是只要“历史记录”，而是要能理解、压缩、恢复、删除、重放一段 agent 工作。**

---

## 3. 当前 nano-agent 真实 API 面

## 3.1 Public facade：orchestrator-core 是唯一客户端入口

`clients/api-docs/README.md` 明确 public facade owner 是 `orchestrator-core`，其他 worker 都通过 service binding/RPC 调用；完整 endpoint matrix 覆盖 health/debug、auth、catalog、user/team、models/session/context/files/permissions；证据：`clients/api-docs/README.md:1-123`。

当前客户端主要 API：

| 类别 | 当前 live 路由 |
|---|---|
| Auth | `/auth/register`、`/auth/login`、`/auth/refresh`、`/auth/verify`、`/auth/me`、`/me`、`/auth/password/reset`、`/auth/wechat/login`、`/auth/api-keys/revoke` |
| Session | `/me/sessions`、`/me/conversations`、`/sessions/{id}/start`、`/input`、`/messages`、`/cancel`、`/status`、`/timeline`、`/history`、`/verify`、`/resume`、`/usage`、`/ws` |
| Model | `/models` |
| Context | `/sessions/{id}/context`、`/context/snapshot`、`/context/compact` |
| Files | `/sessions/{id}/files`、`/sessions/{id}/files/{fileUuid}/content` |
| Confirmation | `/permission/decision`、`/policy/permission_mode`、`/elicitation/answer` |
| Debug | `/debug/workers/health`、`/debug/logs`、`/debug/recent-errors`、`/debug/audit`、`/debug/packages` |

这个矩阵对 RHX2 阶段是有效的，但它还不是 hero-to-pro agentic loop API 矩阵。

## 3.2 模型 API 当前事实

`GET /models` 读取 `nano_models` 和 `nano_team_model_policy`，返回 active models，并按 team deny policy 过滤；证据：`workers/orchestrator-core/src/index.ts:1347-1419`。D1 表结构在 `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:56-90`，seed 模型在同文件 `91-128`。

`agent-core` runtime 侧有更丰富的 `ModelCapabilities`：`provider`、`supportsStream`、`supportsTools`、`supportsVision`、`supportsReasoning`、`reasoningEfforts`、`supportsJsonSchema`、`contextWindow`、`maxOutputTokens`；证据：`workers/agent-core/src/llm/registry/models.ts:8-20`。D1 active models 会被 `loadWorkersAiModelCapabilities()` 转换成 runtime capabilities；证据：`workers/agent-core/src/llm/gateway.ts:68-92`。

模型参数传递现状需要分层看：

1. NACP schema 支持 `session.start.model_id`、`session.start.reasoning`、`session.followup_input.model_id`、`session.followup_input.reasoning`、`SessionMessagePostBody.model_id`、`reasoning`；证据：`packages/nacp-session/src/messages.ts:43-52,119-136`。
2. `POST /sessions/{id}/messages` public handler 会校验 `model_id` / `reasoning`、调用 `requireAllowedModel()`，并转发给 agent-core；证据：`workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310`。
3. agent-core `turn-ingress` 会把 `model_id` / `reasoning` 提取成 `TurnInput`；证据：`workers/agent-core/src/host/turn-ingress.ts:85-129`。
4. `SessionOrchestrator` 会把 `model_id` / `reasoning` 写入 active turn message；证据：`workers/agent-core/src/host/orchestration.ts:231-247`。
5. LLM delegate 会从 messages infer model，并构造 Workers AI execution request；证据：`workers/agent-core/src/llm/gateway.ts:165-231` 与 `workers/agent-core/src/host/runtime-mainline.ts:286-307`。

但是 public `/start` 与 `/input` 有断点：`handleStart()` 转 `ctx.forwardStart()` 时只带 `initial_input`、`initial_context`、`trace_uuid`、`authority`，没有带 `body.model_id` / `body.reasoning`；`handleInput()` 归一化到 `/messages` 时也没有带 `model_id` / `reasoning`；证据：`workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454`。

因此，当前模型选择 API 的真实结论是：

> **只有 `/messages` 的 model_id/reasoning 是 public path 上相对完整的；NACP 和 agent-core 内部已支持 start/followup 模型参数，但 orchestrator public `/start`、`/input` 兼容层没有把字段接过去。**

## 3.3 上下文 API 当前事实

public routes 已经存在，`clients/api-docs/session.md` 也描述了三条 context routes；证据：`clients/api-docs/session.md:300-317`。

但 `context-core` 当前返回的是结构化 stub：

| RPC | 当前返回 |
|---|---|
| `getContextSnapshot()` | `status:"ready"`、`summary:"context-core RH2 stub: per-session inspector in RH4"`、`artifacts_count:0`、`need_compact:false`、`phase:"stub"` |
| `triggerContextSnapshot()` | 随机 `snapshot_id`、`created_at`、`phase:"stub"` |
| `triggerCompact()` | `compacted:true`、`before_size:0`、`after_size:0`、`phase:"stub"` |

证据：`workers/context-core/src/index.ts:123-202`。

同时，主 LLM loop 中 compact 尚未真实启用。`SessionOrchestrator.runStepLoop()` 每轮都把 `compactRequired` 写死为 `false`；证据：`workers/agent-core/src/host/orchestration.ts:282-300`。`runtime-mainline` 的 compact delegate 只返回 `{ tokensFreed: 0 }`；证据：`workers/agent-core/src/host/runtime-mainline.ts:517-520`。

因此 context API 的真实结论是：

> **当前已有 API 形状，但没有真实 per-session context inspector、token probe、compact plan、compact job、summary archive、checkpoint restore。`/context/compact` 今天不应被产品解释为“完成了压缩”。**

## 3.4 聊天/session API 当前事实

当前 session 主链已经比早期成熟很多：

1. `POST /me/sessions` mint pending UUID；`clients/api-docs/session.md:83-89` 描述 pending → start 生命周期。
2. `/start` 启动 session，写 D1 conversation/session/turn/message，转发 agent-core，读 stream frames，再落 D1；证据：`workers/orchestrator-core/src/user-do/session-flow.ts:212-435`。
3. `/messages` 写 user message、activity、转发 agent-core，并保留 multipart/artifact/image URL；证据：`workers/orchestrator-core/src/user-do/message-runtime.ts:162-310`。
4. `/history` 从 D1 `nano_conversation_messages` 读 durable history；证据：`workers/orchestrator-core/src/session-truth.ts:797-820`。
5. `/timeline` 从 D1 stream-event 行读 timeline；证据：`workers/orchestrator-core/src/session-truth.ts:786-795`。
6. `/resume` 是 HTTP replay ack，WS 也支持 `last_seen_seq`；证据：`clients/api-docs/session.md:274-299` 与 `clients/api-docs/session-ws-v1.md:137-143`。

DDL 当前有 `nano_conversations`、`nano_conversation_sessions`、`nano_conversation_turns`、`nano_conversation_messages`、`nano_conversation_context_snapshots`、`nano_session_activity_logs`；证据：`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-129`。

但聊天 API 仍缺产品级控制：

1. `session.end` 在 NACP schema 中存在，但 agent-core HTTP fallback 明确把 `end` 当作 server-emitted family，client 不能生产；证据：`workers/agent-core/src/host/http-controller.ts:30-39,256-260`。public facade 也没有 `/sessions/{id}/end` 或 `/close`。
2. `cancel` 当前会把 session 终止为 cancelled，不等于“停止当前 turn 后保留 session 可继续”的产品语义。
3. 没有 `DELETE /sessions/{id}`、`POST /sessions/{id}/retry`、`POST /sessions/{id}/rollback`、`POST /sessions/{id}/fork`。
4. `history` 是 message list，不能表达 rewind marker、tombstone、branch、replacement history、previous turn settings。
5. D1 turn/message 表没有保存 requested/effective model、reasoning、context budget、compact snapshot id、checkpoint id。

## 3.5 确认/授权 API 当前事实

NACP session schema 已经有 permission、usage、skill invoke、command invoke、elicitation 等 family；证据：`packages/nacp-session/src/messages.ts:169-279`。

public HTTP 替代路径也存在，`clients/api-docs/permissions.md` 明确记录：

1. `permission/decision` 与 `elicitation/answer` 会先写 User DO KV，再 best-effort forward 到 agent-core RPC。
2. 当前不会校验 session 是否真实存在、是否 active、是否 terminal。
3. runtime kernel 当前不会等待这些 decision/answer。
4. public WS `session.permission.request` / `session.elicitation.request` round-trip 未 live。

证据：`clients/api-docs/permissions.md:22-28,68-73,114-117,161-165,177-186`。

agent-core RPC 入口也明确说 permission/elicitation 的未来 runtime waiter 还未接上；证据：`workers/agent-core/src/index.ts:234-247`。

因此确认/授权 API 的真实结论是：

> **当前 permission/elicitation 已有“记录答案”的 API，但没有“runtime 发起问题、客户端收到问题、用户回答、kernel 等待并恢复”的完整确认流。更没有统一 confirmation primitive 覆盖模型切换、强制压缩、fallback、checkpoint restore 等高风险动作。**

## 3.6 Agentic loop / 工具 / 临时文件 API 当前事实

工具执行能力在 worker 内部是真实存在的：

1. `bash-core` 非 public business worker，只有 `/health` public；`/capability/call` 和 `/capability/cancel` 必须经 service binding/internal secret；证据：`workers/bash-core/src/index.ts:417-460`。
2. minimal fake-bash commands 包括 `pwd / ls / cat / write / mkdir / rm / mv / cp / rg / curl / ts-exec / git / wc / head / tail / jq / sed / awk / sort / uniq` 等，且写入、mkdir、rm、mv、cp、curl、ts-exec 等多为 ask policy；证据：`workers/bash-core/src/fake-bash/commands.ts:16-260`。
3. workspace filesystem handler 支持 read/write/delete/copy/move，但 `mkdir` 只是 ack-only prefix，且有 `mkdir-partial-no-directory-entity` 明确披露；证据：`workers/bash-core/src/capabilities/filesystem.ts:102-237`。
4. `filesystem-core` 的 public facade route 是 session artifacts：`writeArtifact`、`listArtifacts`、`readArtifact`，而非任意 workspace temp file tree；证据：`workers/filesystem-core/src/index.ts:83-115` 与 `workers/orchestrator-core/src/index.ts:1583-1697`。

这说明系统已有受控 tool/capability 层，但客户端 API 仍缺：

1. todo-list / plan state 的读写接口；
2. inflight tool calls 的列表、状态、取消、重试；
3. workspace temp/scratch 文件的读、写、删除、清理接口；
4. agent 生成临时文件与用户上传 artifact 的边界区分；
5. session 结束后 temp workspace 的保留、归档、清理策略；
6. tool-call output 从 inline 到 artifact promotion 的客户端可见状态。

---

## 4. `clients/api-docs/` 当前文档与真实代码的 API gap

`clients/api-docs/` 对 RHX2 Phase 6/7-9 的现状基本诚实：它明确了 facade owner、session routes、WS dual-emit、permission/elicitation 未 live、usage live push 未 live、context routes 是 context-core result、files 已接 filesystem-core。

但如果用 hero-to-pro 的 agentic loop 需求来审查，仍有几处重要错位：

1. **模型参数文档不足。** `clients/api-docs/session.md` 的 `/messages` request example 只写了 `parts/context_ref/stream_seq`，没有暴露代码已支持的 `model_id/reasoning`；`/start` 和 `/input` 例子也没有模型字段。代码事实则是 `/messages` live 支持，`/start`/`/input` schema/agent-core 支持但 public path 丢字段。客户端会不知道应该走哪个入口做模型选择。
2. **`GET /models` 文档形状过薄。** 当前文档只返回 `reasoning/vision/function_calling` 三个 boolean；没有 `max_output_tokens`、`reasoning_efforts`、`default_reasoning_effort`、`provider_key`、`input_modalities`、`tool dialect`、`auto_compact_token_limit`、`pricing`、`deprecation`、`aliases`、`recommended_for`。
3. **context route 文档没有足够醒目标记 stub 风险。** `session.md` 说 success 是 `{ "...context-core result...": true }`，但真实返回 `phase:"stub"`，且 `triggerCompact()` 会返回 `compacted:true`。这对产品前端很危险，容易把“stub ack”误读成“压缩完成”。
4. **permissions 文档诚实但也暴露了系统缺口。** 它明确 runtime 不等待 decision/answer、route 不校验 session 是否存在。这意味着它暂时不能作为真正工具授权安全闭环。
5. **files 文档覆盖的是 artifact，而不是 agent workspace。** 对完整 agentic loop 来说，上传文件、模型可见上下文文件、临时 scratch 文件、工具生成 artifact、最终输出文件是四类不同资源；当前 API 只覆盖其中一部分。
6. **WS 文档说明 client messages 只 touch session。** `session-ws-v1.md` 明确 public WS 对 client messages 只做 activity touch，permission/elicitation 使用 HTTP route；证据：`clients/api-docs/session-ws-v1.md:125-160`。这意味着实时交互类 API 还没有走通。

---

## 5. 按用户提出的四类 API 逐项回答

## 5.1 模型类 API：模型选择、模型列表等

### 当前已有

1. `GET /models`：模型列表、team policy deny filter、ETag。
2. `/sessions/{id}/messages` body 可带 `model_id` / `reasoning`，并做 model allow gate。
3. NACP schema 与 agent-core 内部支持 start/followup 携带模型字段。
4. usage ledger 能记录 LLM usage 的 `provider_key` / `model_id` / token / reasoning / vision；证据：`workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:17-39`。

### 当前缺失

1. `GET /models/{model_id}`：查看单模型 rich metadata、capability、limits、pricing、fallback、deprecation。
2. `GET /me/model-preferences` / `PUT /me/model-preferences`：用户默认模型、reasoning 默认 effort、是否持久化。
3. `GET /sessions/{id}/model`：当前 session effective model、requested model、fallback model、reasoning、last switched at。
4. `PATCH /sessions/{id}/model` 或 `POST /sessions/{id}/model/switch-preview` + `/switch-confirm`：模型切换 preview/confirm。
5. `GET /models/aliases` 或在 `/models` 内返回 alias：例如 `fast`、`balanced`、`reasoning`、`vision`、`cheap`。
6. `GET /models/{id}/compatibility?session_id=...`：检查当前 session 历史是否适配目标模型 context window。

### 关键判断

模型选择不能只靠 message-level `model_id`。完整 API 至少要区分四个层次：

| 层次 | 说明 |
|---|---|
| global default | 用户或 team 默认模型 |
| session default | 本 session 的默认模型，可被后续 turn 继承 |
| turn override | 单个 turn 临时覆盖 |
| effective model | runtime 实际调用模型，可能被 fallback/availability/policy 改写 |

当前系统只有“turn override 的一部分”，没有其他三层。

## 5.2 上下文类 API：上下文探针、主动压缩、checkpoint 列表/返回

### 当前已有

1. `/sessions/{id}/context`。
2. `/sessions/{id}/context/snapshot`。
3. `/sessions/{id}/context/compact`。
4. D1 `nano_conversation_context_snapshots` 表可保存 snapshot payload、summary_ref、prompt_token_estimate；证据：`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:86-105`。

### 当前缺失

1. `GET /sessions/{id}/context/probe`：返回当前 prompt token estimate、model context window、reserved output、soft/hard threshold、need_compact、risk。
2. `GET /sessions/{id}/context/layers`：列出 system/session/workspace/artifacts/recent transcript/injected layers，各自 token、source、是否可丢弃。
3. `POST /sessions/{id}/context/compact/preview`：返回 compact plan、预计保留/删除范围、摘要策略、是否需要用户确认。
4. `POST /sessions/{id}/context/compact`：真实发起 compact job，而不是 stub ack。
5. `GET /sessions/{id}/context/compact/jobs/{job_id}`：查询 compact 状态、before/after token、summary ref、失败原因。
6. `GET /sessions/{id}/checkpoints`：列出 checkpoint，包含 message/turn/file/context 对齐点。
7. `POST /sessions/{id}/checkpoints`：用户主动创建 checkpoint。
8. `POST /sessions/{id}/checkpoints/{checkpoint_id}/restore`：支持 conversation-only、files-only、both 三种 restore mode。
9. `GET /sessions/{id}/checkpoints/{checkpoint_id}/diff`：恢复前显示会影响的消息、工具、文件、context snapshot。

### 关键判断

当前 `/context/compact` 返回 `compacted:true` 但实际是 stub，这是最高风险 API 表述。进入 hero-to-pro 前应把它改为以下之一：

1. 在文档和响应中明确 `phase:"stub"` 且 `compacted:false`；
2. 或者真正接上 compact job；
3. 或者从前端产品面隐藏，直到真实可用。

## 5.3 聊天类 API：新建 session、session 终止、继续、聊天中的确认、授权

### 当前已有

1. `POST /me/sessions` mint pending session。
2. `POST /sessions/{id}/start` start。
3. `POST /sessions/{id}/input` text-only follow-up。
4. `POST /sessions/{id}/messages` multipart follow-up。
5. `POST /sessions/{id}/cancel` cancel。
6. `GET /sessions/{id}/status`。
7. `GET /sessions/{id}/history`。
8. `GET /sessions/{id}/timeline`。
9. `POST /sessions/{id}/resume`。
10. `GET /sessions/{id}/ws`。
11. permission/elicitation HTTP substitute。

### 当前缺失

1. `POST /sessions/{id}/close`：正常关闭 session，不一定等同 cancel。
2. `DELETE /sessions/{id}`：删除 session/transcript/artifacts，或至少 tombstone。
3. `POST /sessions/{id}/continue`：从 ended/detached conversation 创建新 session 继续，而不是复用 terminal session。
4. `POST /sessions/{id}/retry`：重试最近失败 turn。
5. `POST /sessions/{id}/rollback`：回滚到 message/turn/checkpoint。
6. `POST /sessions/{id}/fork`：从某个历史点分叉出新 session/conversation。
7. `GET /sessions/{id}/pending-confirmations`：列出当前等待用户决策的 permission/elicitation/model-switch/compact/fallback/restore。
8. `POST /sessions/{id}/confirmations/{request_uuid}/decision`：统一确认 API，而不是 permission/elicitation 各自为政。
9. `GET /sessions/{id}/events?after_seq=`：HTTP event polling 与 WS replay 使用同一语义。
10. `GET /conversations/{conversation_uuid}`：conversation-level view，区分 conversation 与 session。

### 关键判断

“继续对话”不能再等同于“对已 terminal session 再 input”。当前 schema 和 D1 已有 `conversation_uuid`，更合理的产品语义是：

1. conversation 是长期主题；
2. session 是某次 agent runtime；
3. turn 是一次 user action；
4. message/event 是持久 transcript；
5. continuation 应创建新 session，并继承 conversation context / checkpoint / model defaults。

## 5.4 Agentic loop API：todo-list、临时文件写、临时文件读、临时文件清理等

### 当前已有

1. `bash-core` 有受控 fake-bash capability。
2. `filesystem-core` 有 session artifact list/upload/read。
3. `session.stream.event` 能下发 `tool.call.progress`、`tool.call.result`、`llm.delta`、`turn.begin`、`turn.end`、`compact.notify`、`system.error` 等事件；证据：`packages/nacp-session/src/stream-event.ts:11-108`。

### 当前缺失

1. `GET /sessions/{id}/todos`：列出 agent 当前 todo/plan。
2. `POST /sessions/{id}/todos` / `PATCH /sessions/{id}/todos/{todo_id}`：用户或 agent 更新 todo 状态。
3. `GET /sessions/{id}/tool-calls`：列出 running/completed/failed tool calls。
4. `POST /sessions/{id}/tool-calls/{request_uuid}/cancel`：取消单个工具，而不是取消整个 session。
5. `GET /sessions/{id}/workspace/files?path=...`：读 workspace/scratch 文件。
6. `PUT /sessions/{id}/workspace/files?path=...`：用户写入/覆盖 workspace 文件。
7. `DELETE /sessions/{id}/workspace/files?path=...`：删除 workspace 文件。
8. `POST /sessions/{id}/workspace/cleanup`：清理临时文件，支持 dry-run。
9. `POST /sessions/{id}/artifacts/promote`：把 temp/workspace 文件提升为持久 artifact。
10. `GET /sessions/{id}/artifacts/{id}/provenance`：查看 artifact 是用户上传、工具生成、压缩摘要还是导出产物。

### 关键判断

`/sessions/{id}/files` 现在是 **session artifact API**，不是完整 workspace API。不要用它承诺“临时文件读写清理”。真实 agent 产品至少需要把资源分为四类：

| 类型 | 当前覆盖 | 需要补齐 |
|---|---|---|
| user upload artifact | 基本覆盖 | provenance、context inclusion state |
| tool generated artifact | 部分可通过 filesystem-core 表达 | promotion、download、retention |
| workspace temp/scratch file | bash-core 内部可写，public 不可管理 | read/write/delete/list/cleanup |
| context materialized file | 未产品化 | list included files、token estimate、remove from context |

---

## 6. 真实存在的盲点、断点与事实混乱

## 6.1 盲点 A：把 NACP schema 当作 live API

`packages/nacp-session` 已经定义了许多 session message family，包括 permission request/decision、usage update、skill invoke、command invoke、elicitation request/answer。但客户端真正可用的是 orchestrator-core public facade，不是 schema 本身。

当前 public WS 对 client messages 只做 touch，permission/elicitation 走 HTTP 替代；runtime 也不等待 decision/answer。因此不能因为 NACP schema 存在，就宣称对应产品 API 已完成。

## 6.2 断点 B：模型字段跨层不一致

同一个模型选择能力在四处表达不一致：

1. D1 `nano_models` 字段薄；
2. agent-core `ModelCapabilities` 字段厚；
3. `/models` response 只返回三类 boolean capability；
4. `/messages` 支持 `model_id/reasoning`，`/start`/`/input` public path 丢字段；
5. D1 conversation/session/turn/message 不保存 requested/effective model。

这会导致前端可以看到模型列表，却无法可靠知道 session 当前模型，也无法在历史里解释某一轮到底用了哪个模型。

## 6.3 断点 C：context API 形状过早暴露，语义未完成

`triggerCompact()` 返回 `compacted:true` 但没有真正 compact，这比没有 API 更危险。它会让客户端、测试或 owner 误判压缩链路已完成。

## 6.4 断点 D：确认 API 是“答案收件箱”，不是“阻塞恢复流”

permission/elicitation endpoint 当前会存 KV 并 best-effort forward，但 runtime 不等待。这意味着它目前不是安全授权闭环，只是未来闭环的一半。

## 6.5 断点 E：session 与 conversation 的边界还没有产品化

D1 schema 已有 conversation/session 区分，但 public client API 仍主要围绕 session UUID。继续、fork、rollback、delete、archive 等都需要 conversation-level API，否则长期聊天记录会变成 session 列表堆叠。

## 6.6 事实混乱 F：files、artifacts、workspace、context files 被混用

`filesystem-core` 的 `/files` public route 处理 session artifacts；`bash-core` fake-bash workspace handler 处理 agent 内部 workspace；Claude/Gemini 的 `/files` 命令更多是“当前进入上下文的文件”。这三者不能混为一谈。

## 6.7 事实混乱 G：cancel、end、close、terminate 语义未拆分

当前 public `/cancel` 返回 session ended/cancelled。完整 agent 产品至少需要：

1. cancel current turn；
2. stop tool call；
3. close session normally；
4. terminate session with error；
5. archive conversation；
6. delete transcript/artifacts。

这些不能都压成一个 `/cancel`。

---

## 7. 建议的最小 API 收口路线

## 7.1 P0：先修正会误导客户端的现有 API

1. 修 `/start`、`/input` public path：转发 `model_id` / `reasoning`，或明确文档只允许 `/messages` 做模型选择。
2. 更新 `clients/api-docs/session.md`：写清 `/messages.model_id` / `reasoning` 的真实 live 状态。
3. 修 `/context/compact` stub 语义：不要返回 `compacted:true`，改成 `compacted:false` + `phase:"stub"`，或仅在真实 compact 后返回 true。
4. permissions 文档继续保留警告，但 API response 增加 `runtime_waiter_live:false` 一类显式字段，避免误读。

## 7.2 P1：补模型控制面

最小集合：

| Route | 目的 |
|---|---|
| `GET /models` | 扩 rich metadata |
| `GET /models/{id}` | 单模型详情 |
| `GET /sessions/{id}/model` | 当前 requested/effective model |
| `PATCH /sessions/{id}/model` | 设置后续 turn 默认模型 |
| `POST /sessions/{id}/model/switch-preview` | 返回是否需要 compact/确认 |
| `POST /sessions/{id}/model/switch-confirm` | 用户确认切换 |

同时 D1 至少补充：`max_output_tokens`、`reasoning_efforts_json`、`default_reasoning_effort`、`provider_key`、`input_modalities_json`、`tool_dialect`、`auto_compact_token_limit`、`effective_context_window_percent`、`pricing_json`、`aliases_json`、`deprecation_at`、`fallback_model_id`。

## 7.3 P2：补 context/checkpoint 控制面

最小集合：

| Route | 目的 |
|---|---|
| `GET /sessions/{id}/context/probe` | token/window/risk |
| `GET /sessions/{id}/context/layers` | layer list |
| `POST /sessions/{id}/context/compact/preview` | compact plan |
| `POST /sessions/{id}/context/compact` | start real job |
| `GET /sessions/{id}/context/compact/jobs/{job_id}` | job status |
| `GET /sessions/{id}/checkpoints` | checkpoint list |
| `POST /sessions/{id}/checkpoints` | create checkpoint |
| `POST /sessions/{id}/checkpoints/{id}/restore` | restore |

这里必须明确 restore mode：`conversation_only`、`files_only`、`conversation_and_files`。

## 7.4 P3：补 confirmation/control plane

用统一 confirmation API 收拢所有“需要用户确认”的动作：

| Route | 目的 |
|---|---|
| `GET /sessions/{id}/confirmations` | 当前待确认事项 |
| `POST /sessions/{id}/confirmations/{request_uuid}/decision` | allow/deny/modify |
| `GET /sessions/{id}/confirmations/{request_uuid}` | 单项详情 |

confirmation kind 至少包括：

1. `tool_permission`
2. `elicitation`
3. `model_switch`
4. `context_compact`
5. `context_loss`
6. `checkpoint_restore`
7. `fallback_model`

这比继续扩散 `permission/decision`、`elicitation/answer`、未来 `compact/confirm`、`model/confirm` 更干净。

## 7.5 P4：补 agent workspace / todo / tool visibility

最小集合：

| Route | 目的 |
|---|---|
| `GET /sessions/{id}/todos` | agent plan/todo list |
| `PATCH /sessions/{id}/todos/{todo_id}` | 更新 todo 状态 |
| `GET /sessions/{id}/tool-calls` | inflight/completed tool list |
| `POST /sessions/{id}/tool-calls/{id}/cancel` | 单 tool cancel |
| `GET /sessions/{id}/workspace/files` | list/read workspace files |
| `PUT /sessions/{id}/workspace/files` | write temp/workspace file |
| `DELETE /sessions/{id}/workspace/files` | delete workspace file |
| `POST /sessions/{id}/workspace/cleanup` | cleanup with dry-run |
| `POST /sessions/{id}/artifacts/promote` | temp → persistent artifact |

---

## 8. 总体判断

当前 6-worker + NACP 架构的价值是真实的：auth/facade/session DO/agent-core/bash-core/context-core/filesystem-core 的边界已经比较清楚，trace_uuid/authority/service binding/RPC topology 也适合继续扩展。

但完整 agentic loop 的 API 不是“再多几个 endpoint”这么简单。真正需要补的是四个产品级状态机：

1. **Model state machine**：default → session setting → turn override → effective/fallback → audit。
2. **Context state machine**：probe → risk → preview compact → confirm → compact job → checkpoint → restore。
3. **Chat state machine**：conversation → session → turn → message/event → retry/rollback/fork/delete。
4. **Tool/workspace state machine**：planned todo → tool request → permission → execution → artifact/temp file → promotion/cleanup。

在这些状态机补齐前，当前 API 可以继续服务 RHX2 first-wave web spike，但不应被宣称为“完整 agentic loop API”。hero-to-pro 阶段最应该优先收口的，不是继续增加新的内部 helper，而是把上述四类状态机用 public facade API、D1 durable truth、NACP event schema 和客户端文档一起冻住。
