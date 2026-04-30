# Nano-Agent Agentic Loop API 差距分析 — DeepSeek v4-pro

> 调查对象: `nano-agent 在模型/上下文/聊天/agentic-loop 四个 API 维度的设计完整度`
> 调查类型: `api-gap-analysis（API 接口差距分析）`
> 调查时间: `2026-04-30`
> 调查人: `DeepSeek v4-pro（独立审查，未参考其他 reviewer 报告）`
> 对照参考:
> - `context/claude-code/` — Anthropic Claude Code CLI（TypeScript）
> - `context/codex/` — OpenAI Codex CLI（Rust）
> - `context/gemini-cli/` — Google Gemini CLI（TypeScript）
> 上游输入:
> - `docs/eval/hero-to-pro/llm-wrapper-study-by-deepseek.md`
> - `docs/eval/hero-to-pro/llm-wrapper-study-by-GLM.md`
> - `docs/eval/hero-to-pro/llm-wrapper-study-by-GPT.md`
> 文档状态: `draft — 待 owner 审阅`

---

## 0. 一句话结论

> nano-agent 的 HTTP+WS API 面在"auth + session CRUD + 基础消息收发 + debug 探测"上已经成立且齐全（~30 个端点）。但跨入"模型选择决策面、上下文主动管理、agentic loop 规划/确认/回退、临时工作区"四个真实 Agent 产品必需的 API 类别时，当前缺失 **17 个实质性端点**和 **6 个端点语义缺陷**——Claude Code、Codex、Gemini CLI 三类参考实现中系统性存在而 nano-agent 完全缺失的，主要落在 todo/plan、线程检查点回退、模型切换语义、压缩用户确认、工作区读写这几个关键面。

---

## 1. 调查方法

### 1.1 nano-agent 当前 API 面全量枚举

以下是从 `workers/orchestrator-core/src/index.ts` 中逐一提取的 HTTP+WS 端点，按类别分组：

```
═══════════ Auth APIs（8 端点）═══════════
POST /auth/register              注册
POST /auth/login                 登录
POST /auth/refresh               刷新 token
POST /auth/verify                验证 token
GET  /auth/me                    当前用户
POST /auth/resetPassword         重置密码
POST /auth/wechatLogin           微信登录
POST /auth/revokeApiKey          吊销 API key

═══════════ Session APIs（17 端点）═══════════
POST /sessions/{uuid}/start          启动会话
POST /sessions/{uuid}/input          发送文本
POST /sessions/{uuid}/cancel         取消会话
GET  /sessions/{uuid}/status         会话状态
GET  /sessions/{uuid}/timeline       流事件时间线
GET  /sessions/{uuid}/history        完整消息历史
POST /sessions/{uuid}/verify         验证/调试
GET  /sessions/{uuid}/ws             WebSocket 升级
POST /sessions/{uuid}/permission/decision  权限决策
POST /sessions/{uuid}/policy/permission_mode 权限模式
POST /sessions/{uuid}/elicitation/answer    需求应答
GET  /sessions/{uuid}/usage          用量查询
POST /sessions/{uuid}/resume         恢复连接
POST /sessions/{uuid}/messages       多模态消息
GET  /sessions/{uuid}/files          文件列表
POST /sessions/{uuid}/files          上传文件
GET  /sessions/{uuid}/files/{fid}/content  下载文件

═══════════ Context APIs（3 端点 — 均为 stub）═══════════
GET  /sessions/{uuid}/context            上下文状态
POST /sessions/{uuid}/context/snapshot   触发快照
POST /sessions/{uuid}/context/compact    触发压缩  ← stub: phase:"stub"

═══════════ Model APIs（1 端点）═══════════
GET  /models                        模型目录

═══════════ Me/Team/Device APIs（6 端点）═══════════
GET  /me/sessions                    会话列表
GET  /me/conversations               对话列表
GET  /me/team        (+ PATCH)       团队信息
GET  /me/teams                       团队列表
GET  /me/devices                     设备列表
POST /me/devices/revoke              吊销设备

═══════════ Catalog APIs（3 端点）═══════════
GET  /catalog/skills                 技能目录
GET  /catalog/commands               命令目录
GET  /catalog/agents                 Agent 目录

═══════════ Debug APIs（5 端点）═══════════
GET  /debug/workers/health           健康检查
GET  /debug/logs                     错误日志
GET  /debug/recent-errors            最近错误
GET  /debug/audit                    审计日志
GET  /debug/packages                 包版本

═══════════ WebSocket（1 端点）═══════════
WS   /sessions/{uuid}/ws            双向实时通道
```

**总计：约 44 个 HTTP/WS 操作**（含不同 HTTP method）。

### 1.2 参考实现对照

| 参考实现 | API 面形态 | 端点/命令数量级 |
|---------|-----------|--------------|
| Claude Code | CLI slash commands (~30) + `POST /sessions` + WebSocket `control_request`/`control_response` | ~35 |
| Codex | CLI slash commands + JSON-RPC `thread/*`/`turn/*`/`model/*`/`fs/*`/`compact/*` + `codex resume/fork` 子命令 | ~30 RPC methods |
| Gemini CLI | CLI slash commands (~25) + internal `ChatRecordingService` + `PolicyEngine` API | ~30 commands |

---

## 2. 模型类 API 差距

### 2.1 当前 nano-agent 模型 API 面

| 端点 | 方法 | 功能 | 状态 | 代码证据 |
|------|------|------|------|---------|
| `/models` | GET | 返回 team-filtered active model 列表，含 `model_id/family/display_name/context_window/capabilities/status` | ✅ 可用 | `index.ts:1347-1426` |

**模型选择嵌入在 session message body 中（非独立 API）：**
```json
// POST /sessions/{uuid}/messages body
{
  "model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "reasoning": { "effort": "high" },
  "parts": [{ "kind": "text", "text": "..." }]
}
```
`nacp-session/messages.ts` 的 `SessionStartBodySchema`、`SessionFollowupInputBodySchema`、`SessionMessagePostBodySchema` 均支持 `model_id` + `reasoning` 可选字段。

### 2.2 参考实现的模型 API

| 能力 | Claude Code | Codex | Gemini CLI |
|------|------------|-------|------------|
| 模型列表 | 内部 API `models.list()` 拉取 Anthropic API | `model/list` RPC（返回 `ModelPreset` 列表） | `ModelConfigService` 内部配置 |
| 模型详情 | API 返回 `max_input_tokens`/`max_tokens` | `model/get` RPC（返回 `ModelInfo` 丰富元数据） | `ModelDefinition` 含 tier/family/features |
| 模型切换 | `/model [name]` slash command + `model_config` event | `/model` slash command + `ModelRerouteEvent` | `/model set <name> [--persist]` |
| 默认模型 | `getRuntimeMainLoopModel()` 动态解析 | `ModelPreset.is_default` + `resolveModel()` | `resolveModel()` alias → concrete model |
| reasoning effort | `/effort` command | per-model `supported_reasoning_levels` + `default_reasoning_effort` | per-model `features.thinking` |
| 速度模式 | `/fast` toggle | `/fast` toggle | N/A（tier-based） |

### 2.3 nano-agent 模型 API 差距

**M1 (critical) — 缺 `GET /models/{model_id}` 端点。** 当前 `/models` 返回列表，但不支持按单个模型 ID 获取详细信息。Codex 有 `model/get` RPC 返回完整的 `ModelInfo` 结构（801 行 Rust struct），含 `auto_compact_token_limit`、`truncation_policy`、`base_instructions`、`upgrade` 等 20+ 字段。

**M2 (high) — `/models` 列表响应缺少 per-model 关键字段。** 当前返回 `{model_id, family, display_name, context_window, capabilities: {reasoning, vision, function_calling}, status}`。缺失：
- `max_output_tokens` — 模型最大输出长度（全部模型当前均不返回）
- `reasoning_efforts` — 支持的 thinking effort 等级列表（仅返回 boolean `reasoning: true`）
- `description` — 面向用户的说明文字
- `default_temperature` — per-model 推荐默认参数
- `pricing_tier` — 成本分级

Codex 的 `ModelInfo` 包含 20+ 字段；nano-agent 仅返回 7 个基础字段。

**M3 (high) — 缺模型切换语义事件。** 用户通过 per-turn `model_id` 切换模型时，没有 `model.switch` 事件通知。Codex 在切换时注入 `<model_switch>` developer message；Claude Code 在切换时清理 protected thinking signature。nano-agent 的模型切换是"静默的参数覆盖"。

**M4 (medium) — 缺模型 fallback chain 可配置性。** Workers AI gateway 有硬编码的 primary→fallback 链（`gateway.ts:283-286`），但客户端无法通过 API 配置或查询 fallback 策略。

**M5 (medium) — 缺模型 alias/default 解析。** 客户端必须使用完整 `@cf/ibm-granite/granite-4.0-h-micro` 这样的 provider model ID。Claude Code 支持 `sonnet`/`opus`/`best` 等 alias；Gemini CLI 支持 `auto`/`pro`/`flash` 解析。

**M6 (low) — `POST /sessions/{uuid}/start` 和 `POST /sessions/{uuid}/input` 不承载 `model_id`。** GPT 的调查（llm-wrapper-study §2.3）已确认：legacy text start/input path 在 orchestrator-core 兼容层会丢掉 `model_id`。虽然 `/messages` endpoint 支持，但 `/start` 和 `/input` 路径不支持。

---

## 3. 上下文类 API 差距

### 3.1 当前 nano-agent 上下文 API 面

| 端点 | 方法 | 功能 | 状态 | 代码证据 |
|------|------|------|------|---------|
| `/sessions/{uuid}/context` | GET | 上下文状态查询 | ⚠️ stub | 调用 context-core stub RPC |
| `/sessions/{uuid}/context/snapshot` | POST | 手动触发上下文快照 | ⚠️ stub | 调用 context-core stub RPC |
| `/sessions/{uuid}/context/compact` | POST | 手动触发上下文压缩 | ❌ stub | `index.ts:1430+` → context-core `phase:"stub"` |

### 3.2 参考实现的上下文 API

| 能力 | Claude Code | Codex | Gemini CLI |
|------|------------|-------|------------|
| 上下文探针 | `/context` — 显示当前 context usage percentage | status card 显示 `percent_remaining`、`tokens_in_context` | `ContextWindowWillOverflow` event |
| 主动压缩 | `/compact [instructions]` — 三种压缩路径 | `thread/compact/start` RPC + auto-compact at 90% threshold | `ChatCompressionService.compress()` at 50% |
| checkpoint 列表 | `/rewind` → message selector UI | `thread/checkpoint/list` RPC（重建自 rollout） | `getCheckpointInfoList()` 读取 JSON 文件 |
| checkpoint restore | 选择消息 → 回退到该点 | `thread/rollback` RPC → `replace_history()` | `performRestore()` → Git 文件系统恢复 + conversation restore |
| 压缩确认 | 用户可通过 `/compact [instructions]` 提供压缩提示 | N/A（自动） | compression failed guard + verification probe |
| 上下文层检查 | N/A（内部使用） | `ContextManager` 管理 canonical history | `AgentHistoryProvider` + rolling summary |

### 3.3 nano-agent 上下文 API 差距

**C1 (critical) — 全部 3 个 context endpoint 返回 stub。** 这是继承自 RH4 "Lane E consumer migration" 未完成的直接表现。`context-core/src/index.ts:79-203` 的 RPC 方法全部返回 `phase: "stub"`。用户无法通过任何 API 获取真实的上下文使用信息。

**C2 (high) — 缺上下文使用率探针。** Claude Code 的 `/context` 显示 `(input_tokens + cache) / contextWindowSize` 百分比。nano-agent 的 `/sessions/{uuid}/context` 端点存在但返回 stub——即使通电，当前设计也只返回 context layers，不返回 token 使用率百分比。

**C3 (high) — 缺主动压缩端点。** Claude Code 的 `/compact [instructions]` 支持用户提供压缩提示；Codex 有专门的 `thread/compact/start` RPC。nano-agent 的 `POST /sessions/{uuid}/context/compact` 存在但返回 `phase:"stub"`。

**C4 (high) — 缺 checkpoint 列表/恢复 API。** Codex 有 `thread/rollback` RPC 支持回退到任意 turn；Gemini CLI 的 `$rewindTo` marker 在 JSONL 文件中记录 checkpoint 并支持恢复。nano-agent 的 checkpoint 系统仅用于 DO 内部生命周期（hibernate→wake），不暴露为 product API。

**C5 (medium) — 缺上下文层枚举与配置 API。** context-core 设计了 6 层上下文组装（system/session/workspace_summary/artifact_summary/recent_transcript/injected），但没有任何 API 让客户端查看或配置这些层。客户端无法知道"当前上下文由哪些层构成、各层占多少 token、哪些层将被截断"。

**C6 (medium) — 缺压缩确认/用户提示机制。** Claude Code 的 `/compact` 支持用户提供压缩指令；Gemini CLI 在压缩失败时触发 `CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT`。nano-agent 即使压缩通电后，也没有设计"通知用户即将压缩并征求确认"的交互面。

---

## 4. 聊天类 API 差距

### 4.1 当前 nano-agent 聊天 API 面

```
会话生命周期:
  POST /sessions/{uuid}/start          启动（从 pending→active）
  POST /sessions/{uuid}/input          发送消息
  POST /sessions/{uuid}/messages       发送多模态消息
  POST /sessions/{uuid}/cancel         取消会话
  POST /sessions/{uuid}/resume         恢复断连

会话查询:
  GET  /sessions/{uuid}/status         当前状态
  GET  /sessions/{uuid}/timeline       流事件（stream-event only）
  GET  /sessions/{uuid}/history        完整历史
  GET  /me/sessions                    我的会话列表
  GET  /me/conversations               我的对话列表

交互控制:
  POST /sessions/{uuid}/permission/decision   权限决策确认
  POST /sessions/{uuid}/policy/permission_mode 权限模式切换
  POST /sessions/{uuid}/elicitation/answer    需求应答

WebSocket:
  WS   /sessions/{uuid}/ws            实时通信
```

### 4.2 参考实现的聊天 API

| 能力 | Claude Code | Codex | Gemini CLI |
|------|------------|-------|------------|
| 新对话 | `/clear` (清空上下文) | `thread/start` RPC → `CreateThreadParams` (含 cwd/dynamic_tools) | 新 CLI session |
| 恢复对话 | `/resume [id]` (选择历史 session) | `thread/resume` RPC + `codex resume` CLI | `ResumedSessionData` + `rewindTo()` |
| 分支对话 | N/A | `thread/fork` RPC + `codex fork` CLI — 从历史 thread 分支 | N/A |
| 对话终止 | `/clear` | `thread/archive` RPC + `thread/delete` | `deleteSession()` |
| 对话重命名 | N/A | `thread/name/set` RPC | N/A |
| 对话列表 | `/resume` 互动选择器 | `thread/list` RPC (cursor pagination) | `listSessions()` |
| 权限确认 | `/permissions` + WebSocket `can_use_tool` | `/approvals` slash command + `thread/*` elicitation | `PolicyEngine` check → `MessageBus` confirmation |
| Plan 模式 | `/plan [desc]` toggle | `/plan` toggle → `ApprovalMode.PLAN` | `ApprovalMode.PLAN` |

### 4.3 nano-agent 聊天 API 差距

**S1 (high) — 缺 session 终止端点。** 当前 session 只能 `cancel`（取消）或自然 `end`（loop 完成），但没有 `DELETE /sessions/{uuid}` 或 `POST /sessions/{uuid}/terminate` 让用户主动结束会话。Codex 有 `thread/archive` RPC；Gemini CLI 有 `deleteSession()`。当前可通过 cancel 间接结束，但语义不同：cancel = "中断正在运行的 loop"，terminate = "标记此 session 为已结束/归档"。

**S2 (high) — 缺 session 重命名/标题端点。** Codex 有 `thread/name/set` RPC。nano-agent 的 D1 表 `nano_conversations.title` 字段已存在（migration 002），但没有任何 public API 可以设置它。

**S3 (medium) — 缺 session 分支/克隆端点。** Codex 的 `thread/fork` RPC 允许从历史 thread 的某个点创建分支——这是 Agent 调试和 A/B 对比的核心 UX。nano-agent 无此能力。

**S4 (medium) — 缺 session 列表游标分页。** `GET /me/sessions` 和 `GET /me/conversations` 当前返回全量结果（最多 200 条），不支持 `cursor`/`limit`/`since` 等标准分页参数。Codex 的 `thread/list` 使用 cursor pagination。

**S5 (low) — `/start` 和 `/input` 丢 `model_id`。** 已有 GPT 调查确认（llm-wrapper-study §2.3）。`StartSessionBody` 类型不含 `model_id`/`reasoning` 字段。

**S6 (low) — 缺"对话中需用户确认"的标准 API 模式。** 当前 permission/decision 和 elicitation/answer 端点是存在的，但它们是特化的（针对具体 hook 场景）。没有一个通用的"系统请求用户确认某个操作"的消息模式。Claude Code 用 WebSocket `control_request(can_use_tool)`；Gemini CLI 用 `MessageBusType.TOOL_CONFIRMATION_REQUEST` 总线模式。

---

## 5. Agentic Loop API 差距

### 5.1 当前 nano-agent 的 agentic loop API 面

**当前状态：0 个专用 agentic loop API。** nano-agent 的 agentic loop 全部发生在 agent-core 内部（kernel runner → scheduler → tool execution → LLM call），对外部客户端完全透明。客户端只能看到：

- 输入：通过 `/messages` 或 `/input` 发送消息
- 输出：通过 WebSocket `session.stream.event` 接收 `llm.delta`/`tool.call.*`/`turn.*`/`system.error` 等事件
- 控制：通过 `/cancel` 中断、通过 `permission/decision` 响应权限请求、通过 `elicitation/answer` 响应需求

**没有**将 agentic loop 的内部状态暴露为可读、可写、可控制的 API。

### 5.2 参考实现的 agentic loop API

#### Claude Code

| 能力 | 实现 | 细节 |
|------|------|------|
| **Todo/Task 列表** | `/tasks` — `BackgroundTasksDialog` | 列出和管理后台任务；`/clear` 时先杀 foreground tasks 保留 background tasks |
| **Plan 模式** | `/plan [description]` — 定义执行计划 | plan file 管理（`getPlan()` / `getPlanFilePath()`）；plan mode 状态持久化 |
| **临时文件写** | `write_to_file` / `replace_in_file` tool call | 在 workspace 中写文件，受 sandbox policy 约束 |
| **临时文件读** | `read_file` / `glob_files` / `grep_files` tool call | 在 workspace 中读文件 |
| **临时文件清理** | `/clear` 时 evict task output | `evictTaskOutput(taskId)` |
| **Agent 内存** | `memdir/` — 自动内存系统 | `saveMemory()` / `loadMemory()` / `isAutoMemoryEnabled()` |
| **会话 persist** | `/resume` — 从历史恢复 | `agenticSessionSearch()` / `loadFullLog()` |
| **权限规则** | `/permissions` — 管理 allow/deny 规则 | `PermissionRuleList` + `createPermissionRetryMessage()` |
| **工作区管理** | 多个 workspace folder | `workspaceFolders` / `rootUri` 可在会话中动态更改 |

#### Codex

| 能力 | 实现 | 细节 |
|------|------|------|
| **Todo/Task** | `plan_tool` Rust module + `<proposed_plan>` XML parser | `PlanItemArg`、`StepStatus`；`/plan` slash command |
| **Filesystem CRUD** | 7 个 `fs/*` JSON-RPC 方法 | `fs/readFile`、`fs/writeFile`、`fs/createDirectory`、`fs/getMetadata`、`fs/readDirectory`、`fs/remove`、`fs/copy`、`fs/watch`、`fs/unwatch` |
| **Thread 管理** | 11 个 `thread/*` JSON-RPC 方法 | `thread/start`、`resume`、`fork`、`archive`、`unarchive`、`unsubscribe`、`name/set`、`metadata/update`、`list`、`loaded/list`、`read`、`rollback` |
| **Session 配置** | `thread/metadata/update` + `TurnStarted` context window | 会话级别的 model/settings 配置持久化 |
| **Approval 管理** | `/approvals` slash command | `thread/*` elicitation methods |
| **历史重建** | `rollout_reconstruction.rs` | 从 rollout 反向重建 session——可审计的 revert |

#### Gemini CLI

| 能力 | 实现 | 细节 |
|------|------|------|
| **Plan 模式** | `ApprovalMode.PLAN` + `planUtils` | `validatePlanPath()`/`validatePlanContent()` 安全校验；plan tool visibility 特殊处理 |
| **Checkpoint 文件** | `checkpoint-{tag}.json` | `saveCheckpoint()`/`loadCheckpoint()`/`deleteCheckpoint()`/`checkpointExists()` |
| **Git 快照** | `gitService.createCheckpointSnapshot()` | 文件系统 checkpoint + `restoreProjectFromSnapshot()` |
| **会话恢复** | `rewindTo(messageId)` + `performRestore()` | 恢复到 checkpoint → Git 文件恢复 + 对话状态恢复 |
| **会话摘要** | `SessionSummaryService` | LLM 生成 one-line 摘要，缓存 |
| **工作区管理** | `WorkspaceContext` 类 | `addDirectory()`/`getDirectories()`/`isPathInWorkspace()`；多 workspace 支持 |
| **滚动摘要** | `rollingSummaryProcessor` | 增量 summarization，跨 turn 上下文压缩 |

### 5.3 nano-agent agentic loop API 差距

**A1 (critical) — 完全缺 todo/plan 管理 API。** 三类参考实现都有规划能力暴露为 API：Claude Code `/plan`+`/tasks`；Codex `plan_tool` Rust module + `<proposed_plan>` 解析；Gemini CLI `ApprovalMode.PLAN` + checkpoint task tracking。nano-agent 不仅没有对应的 API，甚至没有对应的内部概念（kernel 不知道"这个 session 当前在执行一个 plan"）。

**A2 (critical) — 完全缺工作区/临时文件管理 API。** Codex 有 7 个 `fs/*` JSON-RPC 端点：读/写/创建目录/读取目录/删除/拷贝/监听。Claude Code 的 `memdir/` 系统为 agent 和用户提供持久工作区。nano-agent 有 `filesystem-core` 作为文件存储底层（R2 + KV），但没有暴露为 agent 或用户可直接操作的 workspace file CRUD API。当前的 `/sessions/{uuid}/files` 端点仅用于上传/下载人工附件——不是 agent tool call 写临时文件再读回来的工作流面。

**A3 (high) — 完全缺 checkpoint restore/rollback API。** Codex 有 `thread/rollback` RPC（重建自 rollout）；Gemini CLI 有 `rewindTo()` + `performRestore()`（Git 文件快照 + JSONL 对话恢复）；Claude Code 有 `/rewind`（message selector UI）。nano-agent 的 checkpoint 系统仅在 DO 内部用于 hibernate→wake 生命周期管理，不暴露为 product API。用户无法"回到第 3 轮重新开始"。

**A4 (high) — 缺 session 级别的 settings/configuration API。** Codex 的 `thread/metadata/update` RPC 允许客户端修改 thread 的 model/approval_mode/reasoning_effort 等 metadata。nano-agent 的 session model_id 隐含在每轮消息中，没有"此 session 的默认模型是什么、当前权限模式是什么"的可查询/可修改状态端点。

**A5 (medium) — 缺 agent 内部状态的查询 API。** kernel runner 的当前 phase（idle/thinking/tool_wait/compact）、pending tool calls 列表、active hooks、token 使用量——这些信息在 agent-core 内部存在但不暴露。客户端只能从 stream events 被动接收，不能主动查询"agent 现在在干什么、还有多少 token 可用"。

**A6 (medium) — 缺 tool call 历史/审计 API。** nano-agent 的 kernel 在执行 tool call 时通过 `nano_session_activity_logs` 记录事件，但没有任何 endpoint 返回"这个 session 中执行了哪些 tool call、各花了多少 token、成功了还是失败了"的结构化列表。`GET /sessions/{uuid}/history` 虽然返回消息历史，但 tool call 信息嵌入在 `body_json` 中，需要客户端自行解析。

**A7 (medium) — 缺 workspace 初始化/上下文 preload API。** Claude Code 在 session 开始时注入工作区信息（文件树、Git 状态、环境变量）；Codex 通过 `build_initial_context()` 发送完整环境初始化消息；Gemini CLI 有 `WorkspaceContext` 管理。nano-agent 的 `initial_context` 字段在 NACP schema 中存在（`session.start` body），但只是透传占位，没有任何工作区扫描/预加载逻辑。

**A8 (low) — 缺会话摘要/标题生成。** Gemini CLI 有 `SessionSummaryService`（LLM 生成 one-line 摘要）。nano-agent 的 D1 表 `nano_conversations.title` 字段存在但无任何自动填充或 API 设置——标题永远为 NULL。

---

## 6. 跨类别结构性差距

除了上述按类别列举的差距，以下跨类别结构性问题值得单独标注：

### 6.1 端点与底层实现的通电断层

nano-agent 的一个独特问题是：**端点存在，但背后的 worker/RPC 返回 stub**。这不是"没设计这个 API"，而是"API 已注册但未通电"：

| 端点 | 状态 | 根因 |
|------|------|------|
| `GET /sessions/{uuid}/context` | stub | context-core RPC 全部 `phase:"stub"` |
| `POST /sessions/{uuid}/context/snapshot` | stub | 同上 |
| `POST /sessions/{uuid}/context/compact` | stub | 同上 — 这是整个 context 管理面的阻塞点 |

这三条 stub endpoint 恰好覆盖了上下文管理的全部三个核心操作（查询/快照/压缩），意味着这一整类 API 在 facade 层已声明但不可用——对 client 开发者的误导性极强。

### 6.2 NACP 协议面 vs HTTP REST 面的张力

nano-agent 有两套 API 面：HTTP REST（orchestrator-core facade）和 NACP WS（agent-core stream events）。当前设计存在张力：

- **模型选择**在 NACP 层做（`model_id` 在 session message body 中），但**模型列表**在 HTTP REST 层暴露（`GET /models`）。客户端需要在两个 API 面之间跳转。
- **context** 的 C 层（context-core worker）设计为 RPC consumer，但 HTTP endpoint 在 orchestrator-core facade。一旦 context-core 通电，facade → context-core RPC → agent-core compact 需要三轮跨 worker 调用。
- Codex 用统一的 JSON-RPC 面（`thread/*`/`turn/*`/`model/*`/`fs/*`）避免了这种多面张力。nano-agent 的 HTTP+NACP 双面架构是故意的（6-worker 拓扑的必然结果），但 API 设计的连贯性被双面割裂。

### 6.3 nudging/staging 状态管理的缺失

Claude Code、Codex、Gemini CLI 都把"当前会话的模型、权限模式、plan 状态、effort level"作为显式的 session-level 状态管理。这体现在：

- Claude Code: `session.model`/`session.permissionMode`/`session.effort`
- Codex: `StoredThread.model_provider`/`model`/`reasoning_effort`/`approval_mode`
- Gemini CLI: `GeminiChat` 内部的 `currentSequenceModel` + `activeApprovalMode`

nano-agent 没有对应的 session-level state。`model_id` 是 per-turn 参数，不是 session 配置；没有 `session.model_id` endpoint；`policy/permission_mode` 端点存在但改变的是客户端行为而非 session 持久状态。

---

## 7. 汇总表：全部差距

| 编号 | 类别 | 差距 | 严重性 | 参考依据 |
|------|------|------|--------|---------|
| M1 | 模型 | 缺 `GET /models/{id}` 端点 | high | Codex `model/get` RPC |
| M2 | 模型 | `/models` 响应字段不够丰富（缺 max_output_tokens/reasoning_efforts/description 等） | high | Codex `ModelInfo` 20+ 字段 |
| M3 | 模型 | 缺模型切换语义事件 | medium | Codex `<model_switch>` developer msg |
| M4 | 模型 | 缺 fallback chain 可配置性 | medium | Claude Code `/model` 可指定 |
| M5 | 模型 | 缺模型 alias/default 解析 | low | Claude Code `best`/Gemini `auto` |
| M6 | 模型 | `/start`/`/input` 不承载 model_id | low | GPT 调查 §2.3 |
| C1 | 上下文 | 全部 3 个 context endpoint 返回 stub | **critical** | `context-core/index.ts:79-203` |
| C2 | 上下文 | 缺上下文使用率探针 | high | Claude Code `/context` |
| C3 | 上下文 | 缺主动压缩端点（stub 存在但不通电） | high | Claude Code `/compact`/Codex `thread/compact/start` |
| C4 | 上下文 | 缺 checkpoint 列表/恢复 API | high | Codex `thread/rollback`/Gemini `rewindTo()` |
| C5 | 上下文 | 缺上下文层信息与配置 API | medium | context-core 6 layers 设计 |
| C6 | 上下文 | 缺压缩确认/用户提示机制 | medium | Claude Code `/compact [instructions]` |
| S1 | 聊天 | 缺 session 终止端点 | high | Codex `thread/archive` |
| S2 | 聊天 | 缺 session 重命名/标题端点 | high | Codex `thread/name/set` |
| S3 | 聊天 | 缺 session 分支/克隆端点 | medium | Codex `thread/fork` |
| S4 | 聊天 | 缺 session 列表游标分页 | medium | Codex `thread/list` cursor |
| S5 | 聊天 | `/start`/`/input` 丢 model_id | low | GPT 调查 §2.3 |
| S6 | 聊天 | 缺通用确认消息模式 | low | Gemini `MessageBus` confirmation |
| A1 | loop | 完全缺 todo/plan 管理 API | **critical** | 三者皆有：Claude `/plan`/Codex `plan_tool`/Gemini `ApprovalMode.PLAN` |
| A2 | loop | 完全缺工作区/临时文件 CRUD API | **critical** | Codex 7 个 `fs/*` RPC |
| A3 | loop | 完全缺 checkpoint restore/rollback API | high | 三者皆有：Claude `/rewind`/Codex `thread/rollback`/Gemini `rewindTo` |
| A4 | loop | 缺 session 级 settings/config API | high | Codex `thread/metadata/update` |
| A5 | loop | 缺 agent 内部状态查询 API | medium | kernel phase/pending tools 不暴露 |
| A6 | loop | 缺 tool call 历史/审计 API | medium | 需 client 解析 body_json |
| A7 | loop | 缺 workspace 初始化/preload API | medium | Claude Code 环境注入 |
| A8 | loop | 缺会话摘要/标题生成 | low | Gemini `SessionSummaryService` |

---

## 8. 修复优先级路线

```
Phase 1（通电已注册但 stubbed 的端点）— unlock C1/C3/C5
  1. context-core RPC 方法由 stub 升级为真实实现（Lane E migration）
  2. POST /sessions/{uuid}/context/compact 接入 agent-core compact pipeline
  3. GET /sessions/{uuid}/context 返回真实 token 使用率（% of model context_window）

Phase 2（补齐模型选择决策面）— unlock M1/M2/M6
  1. 新增 GET /models/{model_id} detail endpoint
  2. GET /models 列表增加 max_output_tokens/reasoning_efforts/description/pricing_tier
  3. 修复 /start 和 /input 的 model_id 丢失问题
  4. 实现模型 alias/default 解析层

Phase 3（补齐聊天生命周期面）— unlock S1/S2/S4
  1. 新增 POST /sessions/{uuid}/terminate 和 POST /sessions/{uuid}/archive
  2. 新增 PATCH /sessions/{uuid}/title
  3. 为 /me/sessions 和 /me/conversations 添加 cursor pagination

Phase 4（补齐 agentic loop 产品面）— unlock A1/A2/A3/A4/C4
  1. 设计并实现 todo/plan 管理 API 面
  2. 暴露 workspace file CRUD API（基于 filesystem-core）
  3. 新增 POST /sessions/{uuid}/rollback 端点（基于 checkpoint + D1 历史重建）
  4. 新增 session 级 settings/config endpoint
  5. 新增 checkpoint 列表查询 endpoint
```

---

## 9. 最终判断

> nano-agent 在 "auth + session lifecycle + message send/receive + debug observability" 四个基础面已经拥有与三参考实现在**数量级上相当的 API 面**（~44 个端点）。但差距不在数量，而在**关键产品面的完整性**：
>
> - **模型选择**是隐含在 message body 中的参数覆盖，不是一等 API 公民
> - **上下文管理**的三个端点全部返回 stub——整个产品类等于零
> - **agentic loop**的 plan/todo/workspace/checkpoint/rollback 五个关键面完全不存在
>
> 这不是"API 面需要扩展 100 个新端点"的问题，而是 **13 个高价值端点（M1/M2/C2/C3/C4/S1/S2/A1/A2/A3/A4/A5/A6）需要从零建设 + 3 个端点（C1/C3/C5）需要通电**的问题。其中 A1（todo/plan）和 A2（workspace CRUD）在产品语义上是从 "single-model chatbot" 到 "managed agent" 的质变点——不做这两个面，nano-agent 永远无法支撑一个真正的多步 agentic loop 产品。
