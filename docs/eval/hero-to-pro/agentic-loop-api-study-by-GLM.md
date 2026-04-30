# Agentic Loop API 差距分析 — GLM-5.1

> 调查重点: `模型类 API、上下文 API、聊天类 API、Agentic Loop API` 四个维度
> 调查方法: 基于 context/ 下 Claude Code、Codex CLI、Gemini CLI 三个参考 agent 的代码事实，与 nano-agent 6-worker + NACP 协议的实际代码对比
> 调查时间: `2026-04-30`
> 对照参考:
> - `context/claude-code/` — Anthropic Claude Code CLI
> - `context/codex/` — OpenAI Codex CLI (Rust)
> - `context/gemini-cli/` — Google Gemini CLI (TypeScript)
> 文档状态: `draft — 待 owner 审阅`

---

## 0. 一句话结论

> nano-agent 的 API 面已有完整骨架——NACP 协议定义了 13 种消息类型、9 种 stream event kind、6 种 session phase、4 种 interrupt reason——但"真实通电"的部分仅覆盖"单轮 LLM 调用 + 工具回合"的最小闭环。与三个参考 agent 相比，在模型选择接口、上下文治理、会话确认流、agentic loop 控制面这四个维度存在系统性 API 缺口。

---

## 1. 调查方法与范围

### 1.1 参考实现核查范围

| 参考 | 核查文件 | 核心 API 模式 |
|------|----------|--------------|
| claude-code | `commands/model/model.tsx`, `services/compact/compact.ts`, `services/compact/autoCompact.ts`, `commands/compact/compact.ts`, `commands/context/context.tsx`, `commands/rewind/`, `commands/clear/conversation.ts`, `commands/resume/resume.tsx`, `tools/TodoWriteTool/`, `tools/TaskCreateTool/`, `tools/AskUserQuestionTool/`, `utils/permissions/permissions.ts`, `services/tools/toolExecution.ts` | `/model` 命令、auto-compact、context probe、rewind、session clear/resume、TodoWrite/TaskCreate、AskUserQuestion、PermissionMode 五级 |
| codex | `core/src/compact.rs`, `core/src/context_manager/history.rs`, `core/src/context_manager/updates.rs`, `core/src/codex.rs` (submission_loop)、`protocol/src/protocol.rs` (Op 枚举)、`protocol/src/approvals.rs`、`models-manager/src/manager.rs`、`thread-store/src/store.rs` | `Op::OverrideTurnContext` 模型切换、`Op::Compact` 手动压缩、`Op::Undo/ThreadRollback` 回滚、`Op::ExecApproval/PatchApproval` 确认、`ThreadStore` 持久化、`ModelRerouteEvent` |
| gemini-cli | `services/modelConfigService.ts`, `context/chatCompressionService.ts`, `context/contextManager.ts`, `services/chatRecordingService.ts`, `services/gitService.ts`, `commands/restoreCommand.ts`, `confirmation-bus/message-bus.ts`, `tools/write-todos.ts`, `tools/ask-user.ts`, `scheduler/types.ts`, `core/turn.ts` | `/model` 命令、ModelConfigService 别名链、ChatCompressionService 两阶段压缩、`$rewindTo` JSONL 回滚、shadow git checkpoint、`MessageBus` + `PolicyEngine` 确认、`WriteTodosTool`、`AskUserTool` |

### 1.2 nano-agent 核查范围

| 层级 | 文件路径 | API 关键点 |
|------|----------|-----------|
| NACP 协议 | `packages/nacp-session/src/messages.ts`, `stream-event.ts`, `session-registry.ts` | 13 种消息类型、9 种 stream event kind |
| Session 路由 | `workers/orchestrator-core/src/index.ts:650-700` | 25+ HTTP 路由定义 |
| 模型注册 | `workers/agent-core/src/llm/registry/models.ts`, `gateway.ts`, `request-builder.ts` | ModelRegistry + ProviderRegistry |
| 上下文系统 | `workers/context-core/src/` (assembler, compact-boundary, budget, async-compact, snapshot) | 全套存在但主 loop 未接入 |
| Kernel | `workers/agent-core/src/kernel/` (scheduler, runner, state, reducer, delegates, interrupt, checkpoint) | 完整 kernel 循环 |
| 运行时 | `workers/agent-core/src/host/` (runtime-mainline, orchestration, turn-ingress) | 主 LLM loop 通电 |
| DO 持久化 | `workers/agent-core/src/host/do/` (session-do, session-do-persistence, runtime-assembly) | Checkpoint 恢复 |
| 用户面 | `workers/orchestrator-core/src/user-do/` (session-flow, message-runtime, surface-runtime, ws-runtime) | Session 状态机 |

---

## 2. 模型类 API

### 2.1 参考实现对比

#### Claude Code — 运行时模型选择链

| API 模式 | 实现 |
|----------|------|
| 模型选择入口 | `/model` 命令 → `AppStat.mainLoopModelOverride`; CLI `--model` flag; env `ANTHROPIC_MODEL`; settings fallback |
| 模型能力查询 | `modelCapabilities.ts` → Anthropic API `models.list()` 实时拉取; 缓存到 `~/.claude/cache/model-capabilities.json` |
| 别名解析 | `MODEL_ALIASES: { opus, sonnet, haiku, opusplan, best }` |
| 模型切换 | `setAppState(prev => ({ ...prev, mainLoopModel: model }))` → 后续 turn 使用新模型 |
| 1M context 窗口 | `modelSupports1M()` → 200K default / 1M with beta header |
| 权限门 | `isModelAllowed(model)` → organization restriction |

#### Codex CLI — 丰富 ModelInfo + 远程拉取

| API 模式 | 实现 |
|----------|------|
| 模型列表 | `ModelsManager.list_models(RefreshStrategy)` → 本地缓存 or HTTP `/models` 端点 + 5min ETag 缓存 |
| 模型能力 | `ModelInfo` 28+ 字段: slug, display_name, description, context_window, max_context_window, auto_compact_token_limit, effective_context_window_percent, default_reasoning_level, supported_reasoning_levels, truncation_policy, base_instructions, model_messages, input_modalities, upgrade, additional_speed_tiers... |
| 模型切换 | `Op::OverrideTurnContext { model, effort, ... }` → 部分更新 session context; `build_model_instructions_update_item()` 注入 `<model_switch>` developer message |
| 模型兜底 | `ModelRerouteEvent { from_model, to_model, reason }` → 服务端触发 |
| 模型配置覆盖 | `ModelInfo.with_config_overrides()` — 允许用户 config 覆盖 context_window、auto_compact_token_limit 等 |

#### Gemini CLI — 别名链 + 分层配置

| API 模式 | 实现 |
|----------|------|
| 模型配置 | `ModelConfigService` 管理 alias chains (extends 继承)、override、model definition |
| 模型定义 | `ModelDefinition { displayName, tier (pro/flash/flash-lite/custom/auto), family, isPreview, isVisible, features: { thinking, multimodalToolUse } }` |
| 模型解析 | `resolveModelId()` → 别名链 → 具体模型; `getAvailableModelOptions()` 上下文感知 |
| 模型切换 | `config.setModel()` → `modelChanged` 事件; `config.setActiveModel()` 高频切换; `activateFallbackMode()` 应急 |
| `/model` 命令 | `/model set <name> [--persist]`; `/model manage` 交互选择器 |
| 工具集联动 | `getToolSet(modelId)` → 不同模型家族获取不同工具定义集 |

### 2.2 nano-agent 现状

| API 模式 | 当前状态 | 代码证据 |
|----------|---------|----------|
| `GET /models` | ✅ 功能性 | `index.ts:1347-1426` ← D1 `nano_models` + team policy 过滤 + ETag |
| `POST /sessions/{id}/messages` 携带 `model_id` | ✅ 功能性 | `message-runtime.ts:134-310` ← 携带并转发 `model_id` |
| NACP `session.start` / `session.followup_input` 携带 `model_id` | ✅ 功能性 | `messages.ts:43-52, 119-136` |
| 模型能力仓库 (ModelRegistry/ProviderRegistry) | ✅ 功能性 | `registry/models.ts:8-63`, `registry/providers.ts:17-102` |
| Workers AI Gateway + Request Builder | ✅ 功能性 | `gateway.ts:208-346`, `request-builder.ts:34-121` |
| `POST /sessions/{id}/start` 传递 `model_id` | ❌ **断点** | `session-lifecycle.ts:41-48` — `StartSessionBody` 不含 `model_id`; 转发时不携带 |
| `POST /sessions/{id}/input` 传递 `model_id` | ❌ **断点** | `session-lifecycle.ts:50-57` — 兼容层不复制 `model_id` |
| 模型别名解析 | ❌ **缺失** | 客户端必须使用完整 `@cf/...` ID |
| 模型切换事件通知 | ❌ **缺失** | 无 `model.switch` 或 `<model_switch>` developer message |
| 模型能力动态拉取 | ❌ **缺失** | `modelCapabilities` 无 API 拉取; D1 静态种 + 硬编码 2 模型 |
| per-team 过滤 + 定价/可见性 | ⚠️ 部分 | `nano_team_model_policy` 仅 allow/deny 布尔，无 tier/pricing/visibility |
| fallback 链 | ⚠️ 简单 | `gateway.ts:283-286` 仅 serial fallback to FALLBACK_MODEL |
| 推理等级精细表达 | ⚠️ 失真 | DDL `is_reasoning` 是 0/1 布尔; runtime 全部硬编码为 `["low","medium","high"]` |

### 2.3 模型类 API 盲点与断点

**B-M1 — `/start` 和 `/input` 路径丢失 `model_id`**

这是最直接的 API 断点。`StartSessionBody` 不含 `model_id`，`/input` 兼容层也不复制。只有走 `/messages` 路径才能携带模型参数。

证据: `session-lifecycle.ts:41-48, 50-57`; `session-flow.ts:342-347, 445-454`

**B-M2 — 没有模型切换语义注入**

Codex 在模型切换时注入 `<model_switch>` developer message 告知 LLM 新模型的指令变化。Claude Code 切换模型时清理 protected thinking signature。Gemini CLI `setModel` 触发 `modelChanged` 事件。nano-agent 只是在下一个 turn 的 `model_id` 字段变了，无任何上下文语义通知。

**B-M3 — 没有模型能力动态拉取机制**

Claude Code 从 `anthropic.models.list()` 拉取 `max_input_tokens` / `max_tokens` 并缓存。Codex 从远程 `/models` 端点拉取 `ModelInfo` 28+ 字段。nano-agent 依赖 D1 静态种子和 2 个硬编码模型。

**B-M4 — DDL 与 runtime schema 不对齐**

`nano_models` 表有 `is_reasoning` (0/1 布尔)，runtime `ModelCapabilities.reasoningEfforts` 是 `("low"|"medium"|"high")[]`。DDL 无法表达"这个模型只支持 medium reasoning"。类似地:
- DDL 缺 `max_output_tokens` (runtime 硬编码 8192)
- DDL 缺 `effective_context_pct` (无"只使用 95% context window"概念)
- DDL 缺 `auto_compact_token_limit` (无 per-model 压缩阈值)
- DDL 缺 `base_instructions` (无模型专属提示)
- DDL 缺 `supported_reasoning_levels` (与 runtime 硬编码冲突)

**B-M5 — D1 种子未通电到主 LLM 路径**

`loadWorkersAiModelCapabilities(db)` 存在但 `createLiveKernelRunner()` 不传入 `modelCatalogDb`。25 个 D1 种子模型中只有 2 个硬编码模型在运行时可用。

证据: `runtime-assembly.ts:185`; `gateway.ts:68-92`

---

## 3. 上下文 API

### 3.1 参考实现对比

#### Claude Code — 三层上下文治理

| API 模式 | 实现 |
|----------|------|
| 上下文探测 | `/context` 命令 → `analyzeContextUsage()` → token breakdown by category (system prompt, tools, MCP, agents, memory, messages). `context.ts:1-221` 提供 `getContextWindowForModel()` |
| 自动压缩 | `autoCompactIfNeeded()` at 93% effective window; microCompact 清理旧 tool result; session-memory compact 截断 CLAUDE.md; 断路器 MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3 |
| 手动压缩 | `/compact` 命令 → `compactConversation()` LLM 摘要; 或 `partialCompactConversation()` 指定 from/to 消息 |
| 压缩保留策略 | compact 后保留: tool results (cache_edits API), recent messages, system prompt, attachments, MCP instructions |
| 压缩通知 | 无显式通知 — 静默执行 |
| 上下文窗口感知 | `getContextWindowForModel()` → 200K default / 1M with `[1m]` 用户标识 |

#### Codex CLI — 完整压缩管线 + 回滚重建

| API 模式 | 实现 |
|----------|------|
| 上下文探测 | `ContextManager::estimate_token_count()` (字节启发式); `get_total_token_usage_breakdown()` (详细消耗); `TurnStarted` 事件携带 `model_context_window` |
| 自动压缩 | `auto_compact_token_limit` (per-model 90% of context_window); `run_inline_auto_compact_task()` 或 `run_inline_remote_auto_compact_task()` |
| 手动压缩 | `Op::Compact` → `run_compact_task()` → LLM 摘要 + 保留最近 20K token 用户消息 |
| 压缩格式 | `CompactedItem { message, replacement_history }` — 替换历史，不含被压缩消息 |
| 压缩后重新注入 | `InitialContextInjection { BeforeLastUserMessage, DoNotInject }` — 压缩后重新注入初始上下文 |
| 模型切换适配 | `build_model_instructions_update_item()` 在模型切换时 diff 注入; 压缩时剥离 `<model_switch>` 片段 |
| 工具结果截断 | `TruncationPolicyConfig` — per-model 的工具输出截断策略（按字节 or 按 token） |
| 回滚重建 | `reconstruct_history_from_rollout()` — 反向扫描 rollout，找最新 surviving CompactedItem checkpoint，前向 replay suffix |

#### Gemini CLI — 两阶段压缩 + 影子 Git 检查点

| API 模式 | 实现 |
|----------|------|
| 上下文探测 | `ContextManager.evaluateTriggers()` — 监控 token budget vs `retainedTokens` 阈值 |
| 自动压缩 | `ChatCompressionService.compress()` — 两阶段：先截断大型工具输出（50K token 预算），再 LLM 摘要（`<state_snapshot>` 锚定 + 保留最近 30%） |
| 压缩验证 | 二次 `verification pass` — LLM 自我修正摘要 |
| 压缩状态 | `CompressionStatus` 枚举: COMPRESSED, NOOP, COMPRESSION_FAILED_EMPTY_SUMMARY, COMPRESSION_FAILED_INFLATED_TOKEN_COUNT, CONTENT_TRUNCATED |
| 文件级压缩 | `ContextCompressionService` — `FileLevel: FULL|PARTIAL|SUMMARY|EXCLUDED`; 持久化 `compression_state.json` |
| 检查点 | `GitService.createFileSnapshot()` = shadow git add+commit; `restoreProjectFromSnapshot()` = git restore + clean |
| 回滚 | `ChatRecordingService.rewindTo(messageId)` — JSONL 内嵌 `$rewindTo` marker; 加载时跳过后续消息 |
| 恢复命令 | `/restore` — 从 checkpoint JSONL 加载 history + 工具调用数据 + shadow git 文件快照 |

### 3.2 nano-agent 现状

| API 模式 | 当前状态 | 代码证据 |
|----------|---------|----------|
| `GET /sessions/{id}/context` | ⚠️ 路由存在但 context-core 是 stub | `index.ts:657` 路由到 context-core RPC; `context-core/src/index.ts:135-158` 返回 `phase: "stub"` |
| `POST /sessions/{id}/context/snapshot` | ⚠️ 路由存在但 stub | 同上 |
| `POST /sessions/{id}/context/compact` | ⚠️ 路由存在但 stub | 同上 |
| ContextAssembler (6 层组装) | ✅ 代码存在 | `context-assembler.ts` — 6 层: system→session→workspace_summary→artifact_summary→recent_transcript→injected |
| CompactBoundaryManager | ✅ 代码存在 | `compact-boundary.ts:125-219` — pickSplitPoint, applyCompactResponse |
| Budget Policy | ✅ 代码存在 | `budget/policy.ts` — softTriggerPct=0.75, hardFallbackPct=0.95 |
| Async Compact Scheduler | ✅ 代码存在 | `async-compact/scheduler.ts` — idle→armed→preparing→committing 状态机 |
| compactRequired signal | ❌ **永远 false** | `orchestration.ts:294-300` — scheduler 分支存在但信号来源未接入 |
| CompactDelegate.requestCompact() | ❌ **返回 {tokensFreed: 0}** | `runtime-mainline.ts:517-519` |
| Token 计数 | ⚠️ 仅累计总数 | `kernel/reducer.ts` — `totalTokens` 累加; 无 per-message 计数 |
| Token 阈值触发 | ❌ 不存在 | 无代码检查 `totalTokens / contextWindow > threshold` |
| 上下文组装未接入主 loop | ❌ **关键断点** | `runtime-mainline.ts:296-352` — 使用 `withNanoAgentSystemPrompt()` 而非 ContextAssembler |
| 压缩通知 stream event | ✅ schema 存在 | `stream-event.ts:52` — `compact.notify` kind; 但无触发方 |

### 3.3 上下文 API 盲点与断点

**B-C1 — context-core 与主 agent loop 完全脱节**

整个 context-core (3000+ 行代码) 是孤岛。所有 RPC 方法返回 `phase: "stub"`。主 LLM 调用路径 `runtime-mainline.ts:296-352` 不使用 context-core 的任何设施。这意味着:
- 6 层上下文组装不可用
- 压缩机制不可用
- 上下文预算策略不可用
- 客户端无法通过 `/context` 查看真实上下文状态

证据: `context-core/src/index.ts:79-203`; `runtime-mainline.ts:286-352`

**B-C2 — budget/policy.ts 硬编码 32K maxTokens**

`DEFAULT_ASSEMBLER_CONFIG.maxTokens: 32_000` 不感知模型实际 `contextWindow`。当模型 context_window 是 131K 时浪费 ~100K token 空间；当模型 context_window 是 8K 时造成溢出。

证据: `budget/policy.ts`

**B-C3 — 没有上下文探测 API**

`GET /sessions/{id}/context` 返回 stub 数据。客户端无法获取:
- 当前 token 使用量
- 各层的 token 分布
- 压缩状态
- 接近阈值的警告

Claude Code 的 `/context` 命令提供完整 token breakdown。Codex 的 `get_total_token_usage_breakdown()` 提供详细消耗。Gemini CLI 的 `evaluateTriggers()` 触发 `consolidationNeeded` 事件。

**B-C4 — 没有模型感知的上下文预算**

`budget/policy.ts` 的固定值与模型 `contextWindow` 完全脱钩。切换到更小 context window 的模型时不触发压缩或警告。

**B-C5 — 压缩结果无持久化**

即使压缩机制通电，`compact_done` action 只递减 `totalTokens` 和递增 `compactCount`。但重组后的消息历史没有持久化到 D1 或 DO storage。对比 Codex 的 `CompactedItem { message, replacement_history }` 写入 ThreadStore，Gemini 的 `compression_state.json` 持久化到磁盘。

**B-C6 — 无用户面压缩命令**

Claude Code 有 `/compact` 命令。Codex 有 `Op::Compact`。nano-agent 有 `POST /sessions/{id}/context/compact` 端点但它是 stub。

---

## 4. 聊天类 API

### 4.1 参考实现对比

#### Claude Code — 完整的会话生命周期

| API 模式 | 实现 |
|----------|------|
| 新建 session | `/clear` 或 `/exit` → `clearConversation()` → 清空 messages → 新 session ID → 执行 SessionStart hooks |
| 继续会话 | `/resume` → `context.resume(sessionId, log, entrypoint)` → 从 transcript 文件加载历史 |
| 终止会话 | `/exit` → 退出 REPL; `/clear` → 清空并新 session |
| 聊天中确认 | `PermissionMode` 五级: `default`, `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`; `AskUserQuestionTool` 支持多选题 |
| 授权界面 | 9 种 PermissionRequest 组件: Bash, FileEdit, FileWrite, Filesystem, Sed, WebFetch, AskUserQuestion, EnterPlanMode, Skill |
| 会话元信息 | `setSessionCustomTitle()` 设置标题; `searchSessionsByCustomTitle()` 搜索 |

#### Codex CLI — 结构化会话控制

| API 模式 | 实现 |
|----------|------|
| 新建 session | `InitialHistory::New` → 创建新 thread |
| 继续会话 | `InitialHistory::Resumed(ResumedHistory)` → 从 ThreadStore 恢复; `InitialHistory::Forked(Vec<RolloutItem>)` → 从 checkpoint 分叉 |
| 终止会话 | `Op::Shutdown` → 退出提交循环 |
| 回滚 | `Op::Undo` (撤销上一 turn) + `Op::ThreadRollback { num_turns }` (回滚 N 个 turn) |
| 聊天中确认 | `AskForApproval` 枚举: `UnlessTrusted`, `OnFailure`, `OnRequest`, `Granular(GranularApprovalConfig)`, `Never`; `ExecApprovalRequestEvent` / `PatchApprovalRequestEvent` / `ElicitationRequestEvent` |
| 守护审批 | `GuardianAssessmentEvent` — 子 agent 执行高风险操作前由 guardian sub-agent 审核 |
| 缓存审批 | `ApprovalStore` + `with_cached_approval()` — 避免重复确认同类命令 |

#### Gemini CLI — 消息总线 + JSONL 记录

| API 模式 | 实现 |
|----------|------|
| 新建 session | `GeminiClient.startChat()` → 初始化 `ChatRecordingService`，创建 JSONL 文件 |
| 继续会话 | `/chat resume <tag>` → 加载 checkpoint JSONL + 恢复认证; `useSessionResume()` hook 自动恢复 |
| 终止会话 | `ChatRecordingService` 刷盘; `deleteSession()` 删除 JSONL + artifacts |
| 聊天中确认 | `MessageBus` 发布 `ToolConfirmationRequest`; `PolicyEngine` 返回 `ALLOW/DENY/ASK_USER`; `SerializableConfirmationDetails` 歧义联合类型 (sandbox_expansion/info/edit/exec/mcp/ask_user/exit_plan_mode) |
| AskUser 工具 | `AskUserTool` — CHOICE (2-4 选项)、TEXT (自由文本)、YESNO (可选 Other) |
| Todo 列表 | `WriteTodosTool` — 状态 pending/in_progress/completed/cancelled/blocked; 至多一个 in_progress |
| 会话记录 | `ChatRecordingService` — JSONL 持久化 + `$rewindTo` marker + `$set` metadata 更新 |

### 4.2 nano-agent 现状

| API 模式 | 当前状态 | 代码证据 |
|----------|---------|----------|
| `POST /me/sessions` 新建会话 | ✅ 功能性 | `index.ts:789-866` — 创建 D1 记录 + KV pending |
| `GET /me/sessions` 列表 | ✅ 功能性 | `index.ts:869-883` |
| `GET /me/conversations` 聚合 | ✅ 功能性 | `index.ts:936-1015` |
| `POST /sessions/{id}/start` | ✅ 功能性 | 通过 User-DO 代理到 agent-core |
| `POST /sessions/{id}/input` | ✅ 功能性 | 兼容层 |
| `POST /sessions/{id}/messages` | ✅ 功能性 | 多模态消息 |
| `POST /sessions/{id}/cancel` | ✅ 功能性 | `session-flow.ts:457-561` |
| `POST /sessions/{id}/resume` | ✅ 功能性 | `surface-runtime.ts:178-219` — 返回 cursor/status |
| `GET /sessions/{id}/status` | ✅ 功能性 | |
| `GET /sessions/{id}/timeline` | ✅ 功能性 | stream-event 拉取 |
| `GET /sessions/{id}/history` | ✅ 功能性 | 完整消息历史 |
| `GET /sessions/{id}/usage` | ✅ 功能性 | 使用量统计 |
| `POST /sessions/{id}/permission/decision` | ✅ 路由存在 | NACP `session.permission.decision` |
| `POST /sessions/{id}/policy/permission_mode` | ✅ 路由存在 | |
| `POST /sessions/{id}/elicitation/answer` | ✅ 路由存在 | NACP `session.elicitation.answer` |
| NACP `session.permission.request` | ✅ 协议定义 | `messages.ts:169-181` — request_uuid, tool_name, tool_input, expires_at |
| NACP `session.elicitation.request` | ✅ 协议定义 | `messages.ts:235-242` — prompt, answer_schema |
| 会话删除 | ❌ **缺失** | 无 `DELETE /sessions/{id}` or `/me/sessions/{id}` 端点 |
| 会话元信息更新 | ❌ **缺失** | 无 `PATCH /sessions/{id}` (title/metadata) 端点 |
| 批量会话操作 | ❌ **缺失** | 无 multi-session cancel/prune |
| session.end 后的可恢复性 | ⚠️ 有限 | `POST /sessions/{id}/resume` 在 detached 状态恢复 WS; 但 ended 状态不可恢复 |
| 确认中断循环 | ⚠️ 协议存在但未通电 | `interrupt.ts:12` — `approval_pending` interrupt reason 存在; 但 runtime-mainline 未在工具执行前注入此中断 |
| Elicitation 中断循环 | ⚠️ 协议存在但无 kernel 级支持 | `session.elicitation.request/answer` 有 NACP 定义和 HTTP 路由; 但 kernelInterruptReason 无 `elicitation` 枚举 |

### 4.3 聊天类 API 盲点与断点

**B-S1 — 会话生命周期不完整**

| 操作 | Claude Code | Codex | Gemini CLI | nano-agent |
|------|------------|-------|-----------|-----------|
| 新建 | ✅ `/clear` | ✅ `New` | ✅ `startChat()` | ✅ `POST /me/sessions` |
| 继续 | ✅ `/resume` | ✅ `Resumed`/`Forked` | ✅ `/chat resume` | ⚠️ `POST /sessions/{id}/resume` 仅 detached→active |
| 终止 | ✅ `/exit` | ✅ `Shutdown` | ✅ `deleteSession()` | ⚠️ 无显式删除/清理 |
| 回滚 | ✅ `/rewind` | ✅ `Undo`/`ThreadRollback` | ✅ `$rewindTo` + `/restore` | ❌ 无 |
| 元信息 | ✅ `setCustomTitle` | ✅ `SetThreadName` | ✅ `$set` metadata | ❌ 无 |

**B-S2 — permission 确认流未端到端通电**

NACP 协议定义了 `session.permission.request → session.permission.decision` 消息对。HTTP 路由 `POST /sessions/{id}/permission/decision` 存在。kernel 定义了 `approval_pending` interrupt reason。但连接两端的代码路径缺失:
- kernel runner 的 `handleToolExec()` 不在工具执行前暂停循环等待用户确认
- `runtime-mainline.ts` 的 `CapabilityDelegate` 有 `QuotaAuthorizer` 检查但没有"暂停执行等待 permission decision"的逻辑
- hooks 系统有 `PermissionRequest` hook 分类但它在工具执行后 emit 而不是之前

对比 Claude Code: `canUseTool()` → `PermissionResult { behavior: 'ask' }` → interactive permission queue → 阻塞直到用户响应。对比 Codex: `Op::ExecApproval` / `Op::PatchApproval` 事件驱动确认。对比 Gemini: `MessageBus.publish()` → `PolicyEngine.check()` → `ASK_USER` → UI 确认流程。

**B-S3 — Elicitation 缺少 kernel 级中断**

`session.elicitation.request/answer` 有完整的 NACP 协议定义和 HTTP 路由。但 kernel 没有 `elicitation` interrupt reason。Codex 有 `Op::UserInputAnswer` / `Op::ResolveElicitation`。Gemini 有 `AskUserTool` 通过 `MessageBus` 异步通信。Claude Code 有 `AskUserQuestionTool` 支持 1-4 选项。

nano-agent 的 elicitation 设计是让 host-level hook 处理，但 kernel 不会因为这个原因暂停 step loop。这意味着 agent 在等待用户回答时会继续执行后续步骤，导致 elicitation 形同虚设。

**B-S4 — 会话结束后的数据清理不完整**

`rollbackSessionStart()` 仅在 start 失败时执行全量删除。`cleanupEndedSessions()` 仅清理 KV 热 key。没有:
- 用户可见的 session 删除 API
- conversation 维度的 prune/cleanup
- 文件清理（filesystem-core artifacts 关联到 ended session 的情况）

---

## 5. Agentic Loop API

### 5.1 参考实现对比

#### Claude Code — 丰富的 agentic 控制

| API 模式 | 实现 |
|----------|------|
| Todo 列表 | `TodoWriteTool` — 替换式 todo list (pending/in_progress/completed); `TaskCreateTool` + `TaskUpdateTool` — task graph (V2) |
| 文件写 | `FileWriteTool` — 验证 read-before-write, 原子写, LSP 通知, mtime 检查, file history tracking |
| 文件读 | `FileReadTool` — line offset/limit, readFileState cache |
| 文件编辑 | `FileEditTool` — search/replace edit |
| 工具执行流程 | Zod 验证 → `validateInput()` → `startSpeculativeClassifierCheck()` → `runPreToolUseHooks()` → `resolveHookPermissionDecision()` → `canUseTool()` / interactive queue → `tool.call()` → `processToolResultBlock()` → `runPostToolUseHooks()` |
| 并发执行 | `StreamingToolExecutor` — `isConcurrencySafe` 并行，非并发等待排他锁，结果按原序 yield |
| 完成任务 | 结果截断 (`maxResultSizeChars`) + 持久化到磁盘 |
| CLI 命令系统 | 40+ slash commands, `COMMANDS()` memoized array, `findCommand()` dispatcher |

#### Codex CLI — 结构化 Op 调度 + 沙箱

| API 模式 | 实现 |
|----------|------|
| Op 调度系统 | `submission_loop()` — 60+ Op 变体: UserTurn, OverrideTurnContext, Compact, Undo, ThreadRollback, ExecApproval, PatchApproval, Shutdown, ListModels, SetThreadName, UserInputAnswer, RequestPermissionsResponse, etc. |
| 沙箱执行 | `FileSystemSandboxPolicy` — path-based 精细控制 (Read/Write/None); `WritableRoot` with `read_only_subpaths`; `SandboxPermissions` 枚举 |
| 守护审批 | `GuardianAssessmentEvent` — 高风险操作由 guardian sub-agent 审核 |
| 子 agent 系统 | `Op::MultiAgentsSpawnV2` → 创建子 agent，独立沙箱 |
| 工具输出截断 | `TruncationPolicyConfig` — per-model 策略控制工具输出长度 |
| 动态工具 | `DynamicTool*` — 运行时注册和发现工具 |

#### Gemini CLI — MessageBus 确认 + JSONL 审计

| API 模式 | 实现 |
|----------|------|
| Todo 列表 | `WriteTodosTool` — 状态 pending/in_progress/completed/cancelled/blocked; 至多一个 in_progress |
| 文件写 | `WriteFileTool` — `getConfirmationDetails()` diff 预览 + IDE 集成 + `processSingleFileContent()` |
| 文件读 | `ReadFileTool` — start_line/end_line + MIME 检测 + JIT context discovery |
| 文件编辑 | `EditTool` — 模糊匹配 (strict/flexible/regex/fuzzy) + IDE diff 确认 |
| Shell 执行 | `ShellTool` — sandbox 集成 + 后台进程管理 + 权限 |
| 确认系统 | `MessageBus` → `PolicyEngine` → ALLOW/DENY/ASK_USER; 7 种确认类型 |
| 任务完成 | `CompleteTaskTool` — 子 agent 循环终止 + 结构化输出 |
| 会话管理 | `ChatRecordingService` — JSONL 持久化; `WorktreeService` — git worktree 隔离 |
| 调度器 | `CoreToolCallStatus` — Validating/Scheduled/Executing/AwaitingApproval/Success/Error/Cancelled |
| 事件系统 | `GeminiEventType` — 16 种: Content, ToolCallRequest, ToolCallResponse, ToolCallConfirmation, UserCancelled, Error, ChatCompressed, ContextWindowWillOverflow, ModelInfo, AgentExecutionStopped/Blocked... |

### 5.2 nano-agent 现状

| API 模式 | 当前状态 | 代码证据 |
|----------|---------|----------|
| Kernel scheduler | ✅ 功能性 | `scheduler.ts:35-83` — 6 种决策: llm_call, tool_exec, hook_emit, compact, wait, finish |
| Kernel runner | ✅ 功能性 | `runner.ts:48-436` — advanceStep, handleLlmCall, handleToolExec, handleCompact, handleWait, handleFinish |
| Kernel reducer | ✅ 功能性 | `reducer.ts:62-284` — 11 种 action |
| Kernel state | ✅ 功能性 | `state.ts` — SessionState, TurnState, PendingToolCall, KernelSnapshot |
| Kernel interrupt | ✅ 功能性 | `interrupt.ts` — 4 种: cancel, timeout, compact_required, approval_pending, fatal_error |
| Step loop | ✅ 功能性 | `orchestration.ts:282-375` — 循环直到 done 或 step budget |
| NACP stream events | ✅ 功能性 | 9 种: tool.call.progress, tool.call.result, hook.broadcast, session.update, turn.begin, turn.end, compact.notify, system.notify, system.error |
| Permission 协议 | ✅ 定义存在 | `messages.ts:169-191` — request_uuid, tool_name, tool_input, suggested_decision |
| Elicitation 协议 | ✅ 定义存在 | `messages.ts:235-253` — prompt, answer_schema |
| Capability 执行 | ✅ 功能性 | `runtime-mainline.ts:356-488` — 通过 CapabilityDelegate 调用 bash-core/filesystem-core |
| Quota 授权 | ✅ 功能性 | `runtime-mainline.ts:524-569` — QuotaAuthorizer hooks |
| Todo 列表 | ❌ **完全缺失** | 无 TodoWrite/TaskCreate 工具或等效 NACP 消息类型 |
| 临时文件写/读/清理 | ⚠️ 仅 artifact API | `filesystem-core` 有 artifact CRUD 但无临时文件概念 |
| Compact 执行 | ❌ **stub** | `runtime-mainline.ts:517-519` — `{ tokensFreed: 0 }` |
| Permission gate | ⚠️ 协议有但未通电 | kernel 有 `approval_pending` 但 runtime-mainline 不在工具执行前注入 |
| 模型切换事件 | ❌ **缺失** | 无 `model.switch` NACP 事件 |
| Thread rollback | ❌ **缺失** | 无 `session.rollback` 或等效操作 |
| 动态工具注册 | ❌ **缺失** | CapabilityRegistry 是预注册的，无运行时注册 |

### 5.3 Agentic Loop API 盲点与断点

**B-A1 — 没有 Todo/List 任务管理**

三个参考 agent 都有明确的 todo/task 管理工具:
- Claude Code: `TodoWriteTool` (V1 flat) + `TaskCreateTool`/`TaskUpdateTool`/`TaskListTool`/`TaskGetTool`/`TaskStopTool`/`TaskOutputTool` (V2 task graph)
- Codex: 通过 `Op` 系统管理子 agent 任务
- Gemini CLI: `WriteTodosTool` + `CompleteTaskTool`

nano-agent 完全没有此功能。Kernel 的 `PendingToolCall` 不等于任务管理——它是当前 turn 的待执行工具调用列表，不是跨 turn 的任务计划。

**B-A2 — 没有临时文件管理**

参考 agent 的文件操作模式:
- Claude Code: `FileWriteTool` — 验证 read-before-write, 原子写, file history tracking
- Codex: `ApplyPatchHandler` — 沙箱文件写 + 审批流程
- Gemini CLI: `WriteFileTool` — diff 预览 + 确认 + shadow git 快照

nano-agent 的 `filesystem-core` 提供了 artifact CRUD，但这和临时文件管理不同:
- 没有会话级临时文件生命周期（创建→读写→清理）
- 没有读写前验证（read-before-write）
- 没有 mtime 检查（冲突检测）
- 没有文件 history tracking（undo 能力）
- 没有 shadow git 快照

**B-A3 — Compact 是无操作占位符**

Kernel scheduler 能决策 `compact`，kernel reducer 有 `compact_done` action，NACP 有 `compact.notify` stream event。但:
- `compactRequired` 信号永远为 false（无触发源）
- CompactDelegate 返回 `{ tokensFreed: 0 }`（无实际压缩）
- 结果是: 当对话 token 数超过模型 context window 时，LLM 调用失败（Workers AI 返回 `ContextWindowExceeded`），没有任何优雅降级

**B-A4 — Permission gate 有协议无实现**

NACP 定义了 `session.permission.request → session.permission.decision` 完整流程。HTTP 路由存在。Kernel 定义了 `approval_pending` 中断原因。但三端未连接:
1. Kernel runner 不会在 `handleToolExec()` 前检查"是否需要用户确认"
2. Runtime mainline 的 CapabilityDelegate 直接执行工具，不中断等待
3. Permission decision 从 HTTP endpoint 到 kernel 中断恢复的路径不存在

对比: Claude Code 的 `canUseTool()` 在所有工具执行前同步闸门。Codex 的 `Op::ExecApproval` 异步事件驱动。Gemini CLI 的 `MessageBus.publish()` 同步判断。

**B-A5 — 缺少模型切换控制流**

当模型在 loop 中被切换时:
- 无 `model.switch` NACP 事件通知客户端
- 无 `<model_switch>` developer message 注入 LLM 上下文
- 无 reasoning effort 映射（切到不支持 reasoning 的模型后参数被 silent ignore）
- 无 context window 重新计算
- 无压缩触发

Codex 的 `Op::OverrideTurnContext` 是完整的模型切换控制流。Claude Code 的 `setAppState` + protected thinking 清理。Gemini CLI 的 `setModel()` + `modelChanged` 事件。

---

## 6. 综合差距分析

### 6.1 四维度差距矩阵

| API 维度 | Claude Code | Codex CLI | Gemini CLI | nano-agent |
|----------|-------------|------------|-----------|-----------|
| **模型选择** | `/model` + API 拉取 + 别名 | `Op::OverrideTurnContext` + remote `/models` | `/model set` + ModelConfigService 别名链 | `GET /models` + `POST /messages.model_id` (但 `/start`/`/input` 丢失) |
| **模型能力** | API 实时拉取 `max_input_tokens` / `max_tokens` | `ModelInfo` 28+ 字段 | `ModelDefinition` + features | DDL 4 字段 + runtime 硬编码 |
| **上下文探测** | `/context` 命令 + token breakdown | `estimate_token_count()` + breakdown | `evaluateTriggers()` + consolidation event | ❌ GET /context 返回 stub |
| **自动压缩** | autoCompactIfNeeded at 93% | per-model `auto_compact_token_limit` at 90% | 两阶段: 截断 + LLM 摘要 at 50% | ❌ stub (compactRequired永远false) |
| **手动压缩** | `/compact` 命令 | `Op::Compact` | N/A (自动) | ❌ POST /context/compact 是 stub |
| **检查点回滚** | `/rewind` → partial compact | `Op::Undo` / `Op::ThreadRollback` | `$rewindTo` + `/restore` + shadow git | ❌ 仅 DO hibernate restore |
| **会话新建** | `/clear` → new session ID | `InitialHistory::New` | `startChat()` | `POST /me/sessions` |
| **会话继续** | `/resume` → transcript 加载 | `InitialHistory::Resumed`/`Forked` | `/chat resume` + JSONL 加载 | `POST /sessions/{id}/resume` (仅 detached→active) |
| **聊天确认** | 9 种 PermissionRequest 组件 | ExecApproval/PatchApproval/Elicitation | 7 种 SerializableConfirmationDetails | 协议有但 kernel 不中断 |
| **Elicitation** | AskUserQuestionTool (1-4 选项) | RequestUserInput event | AskUserTool (CHOICE/TEXT/YESNO) | 协议有但 kernel 无中断支持 |
| **Todo 列表** | TodoWriteTool + TaskCreateTask (V2) | 子 agent 任务管理 | WriteTodosTool | ❌ 完全缺失 |
| **文件操作** | Read/Write/Edit + history tracking | ApplyPatch + sandbox + approval | Read/Write/Edit + diff + shadow git + confirmation | artifact CRUD (无临时文件/无 history) |
| **模型切换** | setAppState + thinking 清理 | `<model_switch>` + compact adaptation | `setModel()` + `modelChanged` event | ❌ 仅 per-turn `model_id` 参数覆盖 |

### 6.2 盲点清单（按严重性排序）

| # | 盲点 | 严重性 | 影响 |
|---|------|--------|------|
| B-C1 | context-core 与主 agent loop 完全脱节 | **CRITICAL** | 长对话必然 crash（ContextWindowExceeded） |
| B-A3 | Compact delegate 是无操作占位符 | **CRITICAL** | 无压缩→无降级→token 溢出 |
| B-C3 | 无上下文探测 API | **CRITICAL** | 客户端无法知道上下文使用率 |
| B-A4 | Permission gate 有协议无实现 | **HIGH** | 工具执行无法暂停等待用户确认 |
| B-S2 | Permission 确认流未端到端通电 | **HIGH** | 上述同一问题的另一面 |
| B-M1 | `/start`/`/input` 路径丢失 `model_id` | **HIGH** | 前端兼容层无法携带模型参数 |
| B-A1 | 没有 Todo/List 任务管理 | **HIGH** | 长任务无法跟踪进度 |
| B-S1 | 会话生命周期不完整（无删除/回滚/元信息） | **HIGH** | 用户体验基础缺失 |
| B-C2 | budget/policy.ts 硬编码 32K maxTokens | **MEDIUM** | 大窗口模型浪费，小窗口模型溢出 |
| B-M2 | 没有模型切换语义注入 | **MEDIUM** | LLM 不知道发生了模型切换 |
| B-M4 | DDL 与 runtime schema 不对齐 | **MEDIUM** | 无法表达 per-model reasoning efforts |
| B-S3 | Elicitation 缺少 kernel 级中断 | **MEDIUM** | Agent 不会暂停等待用户结构化输入 |
| B-A2 | 没有临时文件管理 | **MEDIUM** | 文件操作缺少生命周期和冲突检测 |
| B-M5 | D1 种子未通电到主 LLM 路径 | **MEDIUM** | 25 个模型只有 2 个可用 |

### 6.3 断点清单（代码路径存在但未接通）

| # | 断点 | 文件 | 行为 | 接通路径 |
|---|------|------|------|----------|
| D1 | `compactRequired` 永远 false | `orchestration.ts:294-300` | 永远不触发压缩 | 连接 token 计数到 `shouldArm()` / `shouldHardFallback()` |
| D2 | `CompactDelegate.requestCompact()` 返回空 | `runtime-mainline.ts:517-519` | 压缩空返回 | 实现 LLM 摘要或截断降级 |
| D3 | context-core RPC 返回 `phase: "stub"` | `context-core/src/index.ts:135-158` | 3 个 context 端点返回假数据 | 实现 real RPC |
| D4 | `/start` 不传递 `model_id` | `session-lifecycle.ts:41-48` | start 请求丢失模型参数 | 扩展 StartSessionBody |
| D5 | `/input` 不传递 `model_id` | `session-lifecycle.ts:50-57` | 兼容层丢失模型参数 | 扩展 FollowupBody |
| D6 | token 计数只有累计总数 | `kernel/state.ts` | 无法判断哪条消息消耗了多少 | 实现 per-message token estimation |
| D7 | `approval_pending` 中断未被 runtime 使用 | `interrupt.ts:12` | kernel 有此枚举但无人设置 | 在工具执行路径添加权限闸门 |
| D8 | elicitation 无 kernel 中断 | 无 | agent 不会为用户输入暂停 | 添加 `elicitation_pending` interrupt reason |

### 6.4 逻辑错误

| # | 错误 | 文件 | 说明 |
|---|------|------|------|
| L1 | `readLlmRequestEvidence` 只从第一条消息取 `model_id` | `runtime-mainline.ts:179-201` | 如果对话历史中有多条消息携带不同 `model_id`，只有第一条生效 |
| L2 | 硬编码 fallback 仅 2 个模型 | `gateway.ts:21-57` | 当 D1 不可用且请求 model_id 不在硬编码中时，模型选择失败 |
| L3 | `auto_compact_token_limit` 概念不存在 | 全局 | 没有 per-model 压缩阈值；`budget/policy.ts` 用固定 32K/75%/95% |
| L4 | DO storage 单 blob checkpoint 无 size 限制 | `session-do-persistence.ts` | Cloudflare DO storage 有 128KB per value 实际软限制；长对话可能超限 |
| L5 | `ContextAssembler` 在主 loop 中未被调用 | `runtime-mainline.ts:286-352` | 使用 `withNanoAgentSystemPrompt()` 固定提示而非 context-core 组装 |

### 6.5 事实认知混乱

| # | 混乱 | 说明 |
|---|------|------|
| C1 | charter 声称 "GET /sessions/{id}/context 与 InspectorFacade 数据互通" | 实际 context-core RPC 返回 `phase: "stub"`，没有真实数据互通 |
| C2 | charter 声称 "POST snapshot/compact 工作" | 端点存在但 context-core 返回 stub |
| C3 | DO checkpoint 被视为"产品级检查点" | 实际是 hibernation restore，不是用户可见 checkpoint/revert |
| C4 | `ModelCapabilities.runtime` 有 `maxOutputTokens` 但 DDL 不存此字段 | runtime 硬编码 8192，与模型实际限制不匹配 |
| C5 | `is_reasoning` 是 0/1 布尔但 runtime `reasoningEfforts` 是三档数组 | D1 无法存储 per-model reasoning effort 可选值 |
| C6 | 消息有两个写入路径（DO 和 D1）但无原子性 | DO storage checkpoint 和 D1 messages 之间可能不一致 |
| C7 | NACP 有完整 permission/elicitation 协议但 kernel 不中断 | 协议层看起来完备但执行层缺失 |

---

## 7. API 缺口的修复优先级建议

### Phase A — 通电现有骨架（解除关键阻断）

| 编号 | 修复 | 预计影响 |
|------|------|----------|
| A1 | 连接 context-core RPC 到主 loop | 解除 B-C1、D3、L5 |
| A2 | 实现 CompactDelegate 真实压缩逻辑 | 解除 B-A3、D2 |
| A3 | 实现 compactRequired 信号生成（token 计数 → 阈值） | 解除 D1、D6 |
| A4 | 扩展 `POST /sessions/{id}/start` 和 `/input` 传递 `model_id` | 解除 B-M1、D4、D5 |

### Phase B — 补齐模型接口（解除模型选择断点）

| 编号 | 修复 | 预计影响 |
|------|------|----------|
| B1 | `createLiveKernelRunner()` 传入 `modelCatalogDb` | 解除 B-M5 |
| B2 | DDL 新增 `max_output_tokens`, `effective_context_pct`, `supported_reasoning_levels` | 解除 B-M4 |
| B3 | 实现 `GET /sessions/{id}/context` 真实数据 | 解除 B-C3 |
| B4 | 实现 reasonig_efforts 和 context_window 从模型能力动态加载到 budget policy | 解除 B-C2、B-C4 |

### Phase C — 补齐聊天控制（解除会话与确认断点）

| 编号 | 修复 | 预计影响 |
|------|------|----------|
| C1 | 在工具执行路径添加 permission gate 中断 | 解除 B-A4、B-S2、D7 |
| C2 | 添加 `elicitation_pending` kernel interrupt | 解除 B-S3、D8 |
| C3 | 添加 `POST /sessions/{id}/rollback` 和 `DELETE /sessions/{id}` | 解除 B-S1 |
| C4 | 添加 `model.switch` NACP event | 解除 B-M2 |

### Phase D — 补齐 agentic loop（解除 loop 控制断点）

| 编号 | 修复 | 预计影响 |
|------|------|----------|
| D1 | 添加 TodoWrite NACP 消息类型和 kernel 状态管理 | 解除 B-A1 |
| D2 | 添加临时文件生命周期管理（session-scoped temp files） | 解除 B-A2 |
| D3 | 实现模型切换时 context window 重新计算和压缩触发 | 解除 B-C4、B-M2 |

---

## 附录 A: nano-agent NACP 协议完整消息类型

| 类型 | 方向 | 状态 | 说明 |
|------|------|------|------|
| `session.start` | C→S | ✅ 通电 | 含 model_id, reasoning, initial_context, initial_input |
| `session.resume` | C→S | ✅ 通电 | 含 last_seen_seq |
| `session.cancel` | C→S | ✅ 通电 | 含 reason |
| `session.end` | S→C | ✅ 通电 | 含 reason, usage_summary |
| `session.stream.ack` | 双向 | ✅ 通电 | |
| `session.heartbeat` | 双向 | ✅ 通电 | |
| `session.followup_input` | C→S | ✅ 通电 | 含 text, parts, model_id, reasoning |
| `session.permission.request` | S→C | ⚠️ 协议有但 kernel 不中断 | |
| `session.permission.decision` | C→S | ⚠️ 协议有但 kernel 不中断 | |
| `session.usage.update` | S→C | ✅ 通电 | |
| `session.skill.invoke` | C→S | ⚠️ 存在但未验证 | |
| `session.command.invoke` | C→S | ⚠️ 存在但未验证 | |
| `session.elicitation.request` | S→C | ⚠️ 协议有但 kernel 无中断 | |
| `session.elicitation.answer` | C→S | ⚠️ 协议有但 kernel 无中断 | |
| `SessionMessagePostBody` | C→S | ✅ 通电 | 多模态消息 |
| `session.attachment.superseded` | S→C | ⚠️ 存在但未验证 | |

## 附录 B: NACP Stream Event Kinds

| Kind | 状态 | 说明 |
|------|------|------|
| `tool.call.progress` | ✅ 通电 | |
| `tool.call.result` | ✅ 通电 | |
| `hook.broadcast` | ✅ 通电 | |
| `session.update` | ✅ 通电 | |
| `turn.begin` | ✅ 通电 | |
| `turn.end` | ✅ 通电 | |
| `compact.notify` | ⚠️ schema 存在但无触发方 | |
| `system.notify` | ✅ 通电 | |
| `system.error` | ✅ 通电 | |
| `llm.delta` | ✅ 通电 | |

## 附录 C: nano-agent Kernel Interrupt Reasons

| Reason | Recoverable | requiresCheckpoint | 实际使用 |
|--------|-------------|-------------------|----------|
| `cancel` | No | No | ✅ 使用 |
| `timeout` | Yes | Yes | ✅ 使用 |
| `compact_required` | Yes | No | ❌ 从未被设置 |
| `approval_pending` | Yes | Yes | ❌ 从未被设置 |
| `fatal_error` | No | Yes | ✅ 使用 |

## 附录 D: 关键代码路径索引

| 功能 | 文件路径 | 关键函数/结构 |
|------|----------|---------------|
| NACP 消息定义 | `packages/nacp-session/src/messages.ts` | 13 种消息类型 |
| Stream Event 定义 | `packages/nacp-session/src/stream-event.ts` | 9 种 event kind |
| Session Phase 合法性 | `packages/nacp-session/src/session-registry.ts` | 6 种 phase × 允许消息 |
| HTTP 路由定义 | `workers/orchestrator-core/src/index.ts:650-700` | 25+ 路由 |
| 模型注册 DDL | `migrations/003-usage-quota-and-models.sql` | `nano_models` 表 |
| 运行时模型注册 | `workers/agent-core/src/llm/registry/models.ts` | `ModelCapabilities` 接口 |
| 硬编码 fallback | `workers/agent-core/src/llm/gateway.ts:21-57` | 2 个模型 |
| GET /models | `workers/orchestrator-core/src/index.ts:1347-1426` | `handleModelsList()` |
| 上下文组装 (未接入) | `packages/workspace-context-artifacts/src/context-assembler.ts` | 6 层组装 |
| 压缩边界 (未接入) | `packages/workspace-context-artifacts/src/compact-boundary.ts` | pickSplitPoint, applyCompactResponse |
| 预算策略 (未接入) | `packages/workspace-context-artifacts/src/budget/policy.ts` | 75%/95% 阈值 |
| Kernel Scheduler | `workers/agent-core/src/kernel/scheduler.ts` | scheduleNextStep() |
| Kernel Runner | `workers/agent-core/src/kernel/runner.ts` | advanceStep(), handleCompact() |
| Kernel Interrupt | `workers/agent-core/src/kernel/interrupt.ts` | 5 种 interrupt reason |
| Compact Delegate (stub) | `workers/agent-core/src/host/runtime-mainline.ts:517-519` | `{ tokensFreed: 0 }` |
| Context Core RPC (stub) | `workers/context-core/src/index.ts:135-158` | `phase: "stub"` |
| Session 流程 | `workers/orchestrator-core/src/user-do/session-flow.ts` | handleStart, handleInput, handleCancel |
| Permission 协议 | `packages/nacp-session/src/messages.ts:169-191` | request_uuid, tool_name, tool_input |
| Elicitation 协议 | `packages/nacp-session/src/messages.ts:235-253` | prompt, answer_schema |