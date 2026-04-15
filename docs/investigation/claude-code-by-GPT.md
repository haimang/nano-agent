# Agent CLI 深度分析报告

> 分析对象: `claude-code`
> 分析时间: `2026-04-15`
> 分析者: `GPT-5.4`
> 文件位置: `context/claude-code`

---

## 1. 技术栈

| 维度 | 技术选型 |
|------|----------|
| **核心语言** | TypeScript / TSX |
| **运行时 / 框架** | Bun 运行时与打包特性（大量 `bun:bundle`）、React、定制化 Ink/Yoga TUI |
| **包管理 / 构建工具** | 从源码可见证据看，核心构建/运行围绕 Bun；当前快照未包含 `package.json` / lockfile |
| **UI / CLI 库** | `@commander-js/extra-typings`、React、Ink 自研分支、Yoga layout、终端 ANSI / alt-screen 控制 |
| **LLM SDK / API 客户端** | `@anthropic-ai/sdk`、`@anthropic-ai/bedrock-sdk`、`@anthropic-ai/vertex-sdk`、`@anthropic-ai/foundry-sdk`、`axios`（CCR 会话历史） |
| **配置解析** | Zod、frontmatter 解析器、settings loader、GrowthBook feature gate |
| **测试框架** | 当前源码快照中未看到明确测试目录或测试入口；代码层面大量依赖 Bun 特性 |
| **其他关键依赖** | MCP SDK、`proper-lockfile`、`lodash-es`、`ignore`、OAuth / 云鉴权 SDK、沙盒运行时适配层 |

---

## 2. 目录结构

只展示与分析维度直接相关的目录。

```text
context/claude-code/
├── main.tsx                          # CLI 入口、模式初始化、权限/模型/会话启动
├── QueryEngine.ts                    # 单会话查询引擎与持久化消息状态
├── query.ts                          # 主 ReAct / query loop、压缩、工具编排入口
├── Tool.ts                           # Tool / ToolUseContext / PermissionContext 抽象
├── tools.ts                          # 内建工具注册、权限过滤、MCP 合并
├── Task.ts                           # 后台任务抽象与 task id/status
├── tasks.ts                          # task 类型注册
├── services/
│   ├── api/                          # LLM 请求层（client / claude / retry / cache / ingress）
│   ├── compact/                      # auto compact / microcompact / session memory compact
│   ├── tools/                        # tool execution / orchestration / streaming executor
│   ├── mcp/                          # MCP 连接、配置、认证、资源与工具发现
│   ├── oauth/                        # OAuth 相关流程
│   └── plugins/                      # 插件安装与管理
├── skills/
│   ├── bundled/                      # bundled skills 定义
│   ├── bundledSkills.ts              # bundled skill registry
│   ├── loadSkillsDir.ts              # skills / commands / conditional / dynamic discovery
│   └── mcpSkillBuilders.ts           # MCP skill 构造
├── tools/
│   ├── BashTool/
│   ├── FileReadTool/
│   ├── FileEditTool/
│   ├── FileWriteTool/
│   ├── SkillTool/
│   ├── AgentTool/                    # Sub-Agent / fork / worktree / remote / team
│   ├── TodoWriteTool/
│   ├── TaskCreateTool/
│   ├── TaskListTool/
│   ├── TaskUpdateTool/
│   ├── AskUserQuestionTool/
│   ├── ListMcpResourcesTool/
│   ├── ReadMcpResourceTool/
│   ├── WebFetchTool/
│   └── WebSearchTool/
├── utils/
│   ├── permissions/                  # permission mode / rules / classifier / path validation
│   ├── hooks/                        # hook registry / async hook / event bus / frontmatter hooks
│   ├── sandbox/                      # sandbox adapter
│   ├── sessionStorage.ts             # transcript / sidechain / resume 持久化
│   ├── queryContext.ts               # cache-safe prefix 构造
│   └── tasks.ts                      # task v2 持久化与锁
├── remote/                           # CCR / remote session / permission bridge
├── components/                       # UI 组件、TaskListV2、dialogs、messages
├── screens/REPL.tsx                  # 主 REPL/TUI 屏幕
├── ink/                              # 自定义 Ink 渲染、输入、屏幕缓冲
├── keybindings/                      # 键位系统与 chord 解析
├── assistant/sessionHistory.ts       # CCR 会话历史分页读取
└── commands.ts                       # slash commands 与 skills/commands 合流
```

> **LLM 相关代码位置**：主要集中在 `services/api/`、`query.ts`、`QueryEngine.ts`、`utils/api.ts`、`utils/queryContext.ts`。

---

## 3. LLM 请求方式详细说明

### 3.1 LLM 请求引擎的实现

- **认证获取与注入**
  - 直接 Anthropic API：`utils/auth.ts` 提供 API key / OAuth token，`services/api/client.ts::getAnthropicClient()` 注入 `x-app`、`User-Agent`、`X-Claude-Code-Session-Id` 等 header。
  - Bedrock / Vertex / Foundry：同一入口函数按环境变量切换到 `AnthropicBedrock`、`AnthropicVertex`、`AnthropicFoundry`，并分别接 AWS/GCP/Azure 凭证刷新逻辑。
  - OAuth 在每次建 client 前先做 `checkAndRefreshOAuthTokenIfNeeded()`，401/403 时还会在 retry 流里强制 refresh。
- **LLM 请求入口**
  - 顶层在 `query.ts::query()` / `queryLoop()`。
  - 真正的 API wrapper 是 `services/api/claude.ts`：`queryModelWithStreaming()`、`queryModelWithoutStreaming()`、`executeNonStreamingRequest()`、`queryWithModel()`。
  - `QueryEngine.submitMessage()` 负责把一轮对话状态装入 `query()` 并持有跨 turn 的 `mutableMessages`。
- **流式 / 非流式**
  - 默认支持流式；`queryModelWithStreaming()` 作为 async generator 向上游持续产出 stream events。
  - 存在专门的非流式回退路径：`executeNonStreamingRequest()`，用于 streaming timeout / 某些重试场景。
- **请求体构建**
  - 消息规范化：`utils/messages.ts::normalizeMessagesForAPI()`。
  - system prompt 切块与 cache scope：`utils/api.ts::splitSysPromptPrefix()`、`services/api/claude.ts::buildSystemPromptBlocks()`。
  - 工具 schema 注入：`utils/api.ts::toolToAPISchema()`，支持 `strict`、`eager_input_streaming`、`defer_loading`、`cache_control`。
  - message-level cache breakpoint：`services/api/claude.ts::addCacheBreakpoints()`。
  - 额外参数：thinking、effort、task budget、beta headers、anti-distillation、extra body params 都在 `services/api/claude.ts` 里拼接。
- **响应解析**
  - 流式事件在 `services/api/claude.ts` 内解析成 `StreamEvent`、`AssistantMessage`、`SystemAPIErrorMessage`。
  - 内容块标准化由 `utils/messages.ts::normalizeContentFromAPI()` 负责。
  - usage 在 `services/api/claude.ts::updateUsage()` / `accumulateUsage()` 汇总，QueryEngine 继续累计到 session 级别。
- **自动重试**
  - `services/api/withRetry.ts::withRetry()` 是统一重试器。
  - 默认最大重试为 10；429/529 做指数退避；foreground query source 才会积极重试 529。
  - 401/403 会触发 OAuth / 云凭证刷新并重建 client；`ECONNRESET` / `EPIPE` 会关闭 keep-alive 后再试。
  - 连续 529 达阈值可触发 fallback model。
- **可配置项**
  - API timeout：`API_TIMEOUT_MS`，默认 600s。
  - 非流式 fallback timeout：`services/api/claude.ts` 中单独控制。
  - persistent unattended retry 可由 `CLAUDE_CODE_UNATTENDED_RETRY` 开启，支持长时间 keep-alive 式重试。
- **缓存 / prompt cache**
  - 显式实现了 Anthropic prompt caching，并细分为 global / org / 1h TTL / 5m TTL。
  - 额外有 `promptCacheBreakDetection.ts`，会跟踪 system hash、tool hash、betas、effort、model 等并对 cache break 做 diff 分析。
  - 还实现了 cache_edits / cache_reference 级别的微压缩配合。
- **聊天记录持久化**
  - 主 transcript：`utils/sessionStorage.ts::getTranscriptPath()` 指向 `~/.claude/projects/.../<sessionId>.jsonl` 风格路径。
  - Sub-agent sidechain transcript：`getAgentTranscriptPath(agentId)`。
  - 全局 history：`history.ts`。
  - CCR 远程历史：`assistant/sessionHistory.ts` 通过 `/v1/sessions/{sessionId}/events` 分页抓取。
- **元数据记录**
  - `SerializedMessage` / transcript entry 包含 `sessionId`、`timestamp`、`cwd`、`gitBranch`、`version` 等。
  - assistant usage、cache token、tool use、request id 在多处被保留并持续累计。

### 3.2 LLM 请求代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/services/api/client.ts` | 认证、provider client 构造、header/fetch 注入 |
| `context/claude-code/services/api/claude.ts` | Claude API 主封装、streaming/non-streaming、prompt cache、usage |
| `context/claude-code/services/api/withRetry.ts` | 重试、fallback、认证恢复、capacity handling |
| `context/claude-code/services/api/promptCacheBreakDetection.ts` | cache break 检测与 diff 落盘 |
| `context/claude-code/query.ts` | query loop 与 LLM/tool turn 集成 |
| `context/claude-code/QueryEngine.ts` | 单会话状态、turn 提交、转录持久化 |
| `context/claude-code/utils/api.ts` | tool schema、system prompt block、上下文拼接 |
| `context/claude-code/utils/queryContext.ts` | cache-safe prefix 组装 |
| `context/claude-code/utils/sessionStorage.ts` | transcript / sidechain / resume 持久化 |

### 3.3 LLM 请求子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 认证机制 | `utils/auth.ts` + `services/api/client.ts` | 支持 API Key、OAuth、AWS、GCP、Azure |
| API Wrapper | `services/api/claude.ts` | 流式优先，非流式兜底 |
| 重试机制 | `services/api/withRetry.ts` | 429/529、认证错误、连接复用故障、fallback model |
| 本地缓存 | prompt caching + `promptCacheBreakDetection.ts` | 不只是“开缓存”，还追踪 cache break 原因 |
| Session 持久化 | `utils/sessionStorage.ts` | 主 transcript 与 subagent sidechain 分离 |
| 聊天记录结构 | `types/message.ts` / `types/logs.ts` | 区分 assistant/user/system/attachment/progress 等类型 |

### 3.4 Verdict 评价

- **完整性**：从 auth、provider routing、streaming、retry、cache 到 transcript 持久化是一条完整工业链路。
- **可靠性**：`withRetry()`、auth refresh、streaming fallback、capacity 退避都相当成熟。
- **可观测性**：cache break diff、usage 累计、debug/tracing、request profiling 都很强。
- **不足**：
  - 明显偏向 Anthropic 生态；虽然 provider 很多，但仍是“Anthropic 模型的多入口”，不是 OpenAI/Cohere/本地模型通用层。
  - 大量 feature gate 与 provider 分支让代码路径非常多，维护复杂度高。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 4. Hooks 详细说明

### 4.1 引擎的实现

- **注册 / 发现**
  - Hook schema 与事件类型在 `types/hooks.ts`。
  - 来源既可以是 settings / plugin，也可以来自 skill / agent frontmatter：`loadSkillsDir.ts`、`registerFrontmatterHooks.ts`、`loadPluginHooks.ts`。
  - 异步 hook 通过 `utils/hooks/AsyncHookRegistry.ts` 做全局挂起登记。
- **调度器**
  - hook 不是简单“执行 shell 然后忽略结果”，而是分成 started / progress / response 三阶段事件流。
  - `hookEvents.ts` 提供独立事件总线，支持延迟注册、bounded pending queue、按事件类型 selective emit。
  - 异步 hook 会周期性读取 stdout/stderr，产出 progress event。
- **执行模式**
  - 代码层面至少覆盖 shell/command、prompt hook、agent hook、HTTP hook；对应 `execPromptHook.ts`、`execAgentHook.ts`、`execHttpHook.ts`。
  - callback hook 也被显式建模在 `types/hooks.ts`。
- **结果如何影响主流程**
  - 可以 `continue=false` / `decision=block`。
  - 可注入 `additionalContext`、`systemMessage`、`updatedInput`、`updatedPermissions`。
  - 对不同 hookEvent 有专门 hookSpecificOutput：比如 `PreToolUse` 可改输入、`PermissionRequest` 可直接给 allow/deny、`SessionStart` 可下发 watchPaths。

### 4.2 Hooks 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/types/hooks.ts` | hook schema、事件类型、sync/async output 协议 |
| `context/claude-code/utils/hooks/hookEvents.ts` | started/progress/response 事件总线 |
| `context/claude-code/utils/hooks/AsyncHookRegistry.ts` | 异步 hook 注册、轮询、完成清理 |
| `context/claude-code/utils/hooks/registerFrontmatterHooks.ts` | 将 skill/agent frontmatter hooks 注册进会话 |
| `context/claude-code/utils/plugins/loadPluginHooks.ts` | 插件 hook 热重载与 prune |
| `context/claude-code/services/tools/toolHooks.ts` | pre/post tool hooks 与 tool pipeline 集成 |

### 4.3 全部 Hook 说明

| Hook 名称 | 触发时机 | Matcher 能力 | 输出影响 |
|-----------|----------|--------------|----------|
| `SessionStart` | 会话初始化 | 配置 / frontmatter / plugin | `additionalContext`、`initialUserMessage`、`watchPaths` |
| `Setup` | setup 阶段 | 同上 | 附加上下文 |
| `UserPromptSubmit` | 用户 prompt 提交前 | 同上 | 附加上下文 |
| `PreToolUse` | tool 调用前 | 可按 tool/matcher 选择 | block / 改输入 / 权限建议 / additionalContext |
| `PostToolUse` | tool 成功后 | 可按 tool/matcher 选择 | 附加上下文、更新 MCP output |
| `PostToolUseFailure` | tool 失败后 | 同上 | 附加上下文 |
| `PermissionRequest` | 权限审批时 | 同上 | 直接 allow/deny、更新 permission rules |
| `PermissionDenied` | 权限被拒后 | 同上 | 可触发 retry |
| `SubagentStart` | sub-agent 启动时 | agent/frontmatter | 附加上下文 |
| `FileChanged` | 监控路径变化 | watchPaths | watch 更新 |
| `CwdChanged` | cwd 切换后 | 配置 hook | 更新 watchPaths |
| `WorktreeCreate` | worktree 创建后 | 配置 hook | 返回 worktree path |
| `Notification` / `Elicitation*` | UI / 用户交互相关 | 特定 hook | 对提示/用户决策建模 |

### 4.4 Verdict 评价

- **成熟度**：这是完整生命周期 hook 系统，不是“预留几个回调点”的程度。
- **扩展性**：settings、plugin、skill、agent 都能成为 hook 来源，而且支持热重载。
- **安全性**：hook 本身仍能触发外部动作，但至少与 permission / session state 有正式接口，不是旁路脚本。
- **不足**：
  - 事件面极广，带来强扩展性的同时，也提高了调试难度和行为可预测性门槛。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 5. 上下文管理详细说明

### 5.1 上下文引擎的实现

- **核心状态持有者**
  - 交互 REPL 层由 `screens/REPL.tsx` + `AppState` 持有 UI/session 状态。
  - 对话核心则是 `QueryEngine`：`mutableMessages`、`readFileState`、`totalUsage`、permission denial 等都在这里跨 turn 保留。
- **内存数据结构**
  - `Message` 是一个丰富 union：user / assistant / system / attachment / progress / tool summaries 等。
  - QueryEngine 内部直接持有 `Message[]`，并在需要时规范化成 API message params。
- **进入 API 前的转换阶段**
  1. `fetchSystemPromptParts()` 取 system prompt / userContext / systemContext。
  2. `processUserInput()` 处理 slash command、memory attachment、prompt 变换。
  3. `normalizeMessagesForAPI()` 清洗内部消息结构。
  4. `buildSystemPromptBlocks()` / `addCacheBreakpoints()` 构造 cache-stable API payload。

### 5.2 上下文管理代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/QueryEngine.ts` | 会话级消息状态与 turn 生命周期 |
| `context/claude-code/query.ts` | 主 query loop、compact、tool round |
| `context/claude-code/utils/queryContext.ts` | system/user/system context 构造 |
| `context/claude-code/services/compact/autoCompact.ts` | 自动压缩阈值与触发逻辑 |
| `context/claude-code/services/compact/compact.ts` | 压缩执行 |
| `context/claude-code/services/compact/apiMicrocompact.ts` | cache_edits / API context management |
| `context/claude-code/utils/sessionStorage.ts` | transcript / compact boundary / resume |

### 5.3 全部分层说明

| 层级 | 内容 | 是否持久化 | 备注 |
|------|------|------------|------|
| System Prompt | 默认 system prompt、custom append、agent prompt | 间接持久化（通过 transcript 与 metadata 重建） | 还会切成 cache-safe blocks |
| User / System Context | `getUserContext()` / `getSystemContext()` 输出 | 否，按会话环境动态重算 | 包含 claudeMd、gitStatus 等 |
| Mutable Messages | `QueryEngine.mutableMessages` | 是 | 主对话链 |
| Attachments / Memory | relevant memory、nested memory、hook additional context | 是，作为消息/attachment 进入 transcript | 参与压缩与 resume |
| Compact Boundary | compact metadata、保留段信息 | 是 | 用于 resume / projection / GC |
| Read/File State Cache | read file cache、content replacement state | 部分持久化 | sub-agent 可 clone/fork |

### 5.4 上下文压缩机制

- **触发条件**
  - `autoCompact.ts` 根据模型 context window、buffer tokens、当前 token 估算决定。
  - 还存在 reactive compact、manual compact、session memory compaction、context collapse / snip 等旁路。
- **压缩策略**
  - 不是单一 summarization，而是多路：
    - auto compact；
    - API-level microcompact（`clear_tool_uses_*`、`clear_thinking_*`）；
    - session memory compact；
    - snip/history projection；
    - context collapse（feature-gated）。
- **分层压缩**
  - system prompt、tool result、thinking block、tool use 可以采用不同策略。
  - `cache_edits` / `cache_reference` 说明它不仅在“文本上缩短”，还试图保护 API prompt cache。
- **压缩后恢复**
  - compact boundary、content replacement、sidechain transcript、resume path 都是恢复管道的一部分。
  - sub-agent 还有自己的 transcript / metadata / worktree metadata，可在恢复时重连。

### 5.5 Verdict 评价

- **完整性**：覆盖了估算、预警、自动压缩、边界记录、恢复与 sidechain 管理。
- **精细度**：明显比普通“把前文总结一下”细很多，已经是分层上下文工程。
- **恢复能力**：compact boundary 与 sidechain transcript 使 resume 能维持较强连续性。
- **不足**：
  - feature gate 很多，真实运行行为会受具体发行通道与配置强烈影响。
  - 压缩策略组合极多，调试成本高。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 6. Tool Use 详细说明

### 6.1 Tool Use 引擎的实现

- **抽象接口**
  - `Tool.ts` 定义 `Tool`、`ToolUseContext`、`ToolPermissionContext` 等核心接口。
  - 单个 tool 有 `inputSchema`、`checkPermissions()`、`call()`、`isConcurrencySafe()`、`isReadOnly()` 等能力面。
- **注册方式**
  - `tools.ts::getAllBaseTools()` 列出内建 tool 总表。
  - `getTools()` 负责按 mode / feature / deny rule 过滤。
  - `assembleToolPool()` 再把内建工具与 MCP 工具拼接，并以 built-in 优先 dedupe。
- **执行流程**
  1. `query.ts` 收到 assistant tool_use blocks。
  2. `services/tools/toolOrchestration.ts::runTools()` 按并发安全性拆批。
  3. `services/tools/toolExecution.ts::runToolUse()` 做 permission check、pre/post hook、tool.call。
  4. 结果重新封装成 `tool_result` 消息回注主对话。
  5. 下一轮再送回模型。
- **并行执行**
  - 支持。
  - 并发安全工具可批量并行，默认最大并发 10（`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 可调）。
  - streaming 场景还有 `StreamingToolExecutor`，能边收 tool_use 边执行。
- **结果序列化**
  - 统一回注为 Anthropic tool_result block；大输出可落盘后只回传预览与路径。
  - 还有进度消息、tool summary、notification 等辅助消息类型。

### 6.2 Tool Use 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/Tool.ts` | Tool / ToolUseContext 抽象 |
| `context/claude-code/tools.ts` | 工具注册、过滤、MCP 合流 |
| `context/claude-code/services/tools/toolExecution.ts` | 单次 tool use 执行主链 |
| `context/claude-code/services/tools/toolOrchestration.ts` | 串并行编排 |
| `context/claude-code/services/tools/StreamingToolExecutor.ts` | streaming tool 并发执行器 |
| `context/claude-code/tools/BashTool/BashTool.tsx` | Bash tool |
| `context/claude-code/tools/AgentTool/AgentTool.tsx` | Sub-agent tool |
| `context/claude-code/services/mcp/client.ts` | MCP tools / resources 发现 |

### 6.3 内建工具逐一列举与分析

| 工具名 | 文件 | 核心能力 | 特殊设计 |
|--------|------|----------|----------|
| `BashTool` | `tools/BashTool/` | 本地 shell、后台任务、输出落盘、沙盒封装 | 读写/搜索命令识别、auto-background、权限与 sandbox 联动 |
| `FileReadTool` | `tools/FileReadTool/` | 读文件 | 与 readFileState / token budgeting 集成 |
| `FileEditTool` | `tools/FileEditTool/` | 文本修改 | diff / file history / permission UI |
| `FileWriteTool` | `tools/FileWriteTool/` | 写文件 | 与路径权限规则联动 |
| `GlobTool` / `GrepTool` | `tools/GlobTool/` / `tools/GrepTool/` | 搜索文件/内容 | 并发安全、适合与其他只读工具批量运行 |
| `NotebookEditTool` | `tools/NotebookEditTool/` | Jupyter 编辑 | 特化 notebook 结构 |
| `WebFetchTool` / `WebSearchTool` | `tools/WebFetchTool/` / `tools/WebSearchTool/` | HTTP 获取与搜索 | 纳入 permission pipeline |
| `SkillTool` | `tools/SkillTool/SkillTool.ts` | 调用 skills / prompt commands | 支持 forked skill agent、MCP skills、description/whenToUse 筛选 |
| `AgentTool` | `tools/AgentTool/` | spawn/fork/background/remote/team agent | 支持 worktree isolation、remote CCR、mailbox、task-notification |
| `TodoWriteTool` | `tools/TodoWriteTool/` | 旧版 session todo checklist | 与 AppState 直接绑定 |
| `TaskCreate/List/Update/Get/Stop` | `tools/Task*` | 新版 Task v2 | 文件锁、依赖关系、共享 task list |
| `AskUserQuestionTool` | `tools/AskUserQuestionTool/` | 结构化提问 | 与 TUI/SDK 交互整合 |
| `ListMcpResourcesTool` / `ReadMcpResourceTool` | `tools/*Mcp*` | MCP 资源读取 | 与 MCP 连接状态同步 |
| `LSPTool` | `tools/LSPTool/` | LSP/IDE 集成 | feature gated |

### 6.4 Verdict 评价

- **完整性**：工具面已经覆盖本地开发代理的大多数主线能力，并与 MCP、skills、sub-agent 联动。
- **扩展性**：工具接口统一，MCP 工具和本地工具能进入同一执行/权限管线。
- **健壮性**：串并行编排、streaming executor、output 落盘、task notification 都相当成熟。
- **不足**：
  - 能力极多，理解成本高。
  - 内部 feature flag 大量存在，某些工具在不同发行通道下会显著变形。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 7. Skill 详细说明

### 7.1 Skill 的分类

- **物理格式**
  - 标准目录式 skill：`skill-name/SKILL.md`。
  - 兼容 legacy `/commands/*.md` 与目录内 `SKILL.md`。
  - bundled skill 通过代码注册，但仍映射为 `Command(type='prompt')`。
- **作用域 / 类别**
  - `policySettings`（managed）
  - `userSettings`
  - `projectSettings`
  - `bundled`
  - `plugin`
  - `mcp`
  - 另外还有 conditional / dynamic discovered skills

### 7.2 Skill 的加载顺序

- 从 `skills/loadSkillsDir.ts::getSkillDirCommands()` 可见：
  1. managed skills
  2. user skills
  3. project skills
  4. additional `--add-dir` project skills
  5. legacy commands
- 从 `commands.ts::loadAllCommands()` 可见，最终合流顺序是：
  1. bundled skills
  2. built-in plugin skills
  3. skill dir commands
  4. workflow commands
  5. plugin commands
  6. plugin skills
  7. built-in slash commands
  8. dynamic discovered skills（插在 plugin skills 与 built-in commands 之间）
- **动态发现**
  - `discoverSkillDirsForPaths()` 会沿被触达文件路径向上找嵌套 `.claude/skills`。
  - conditional skills 通过 frontmatter `paths` 激活。

### 7.3 Skill 与 System Prompt 的映射关系

- **元数据进入 prompt 的方式**
  - claude-code 不把所有 skill 正文塞进主 system prompt。
  - Skill metadata 主要通过 `SkillTool` 的 tool prompt 暴露给模型：name、description、whenToUse、是否可 model invocation。
- **完整内容何时注入**
  - `SkillTool` 触发后，`createSkillCommand(...).getPromptForCommand()` 才会把 skill 正文、参数替换、`${CLAUDE_SKILL_DIR}` 等拼好。
  - fork-context skill 甚至通过 `runAgent()` 在独立 agent 内执行。
- **渐进式披露**
  - 明确存在；这是 claude-code 的主流设计之一。

### 7.4 动态 Skill 的注册、发现、注入与使用

- **发现触发条件**
  - 文件操作触发的 nested discovery。
  - 启动时扫描 user/project/managed/legacy 路径。
  - MCP skills 作为外部来源补充。
- **注册表 / 缓存**
  - `dynamicSkills`、`conditionalSkills`、`activatedConditionalSkillNames`。
  - `getSkillDirCommands` 与 `getSkillToolCommands` 都做了 memoize。
- **条件 Skill 激活**
  - `paths` frontmatter 指定 path-filtered skill。
  - 文件命中后才加入活跃集合。
- **Skill 与 Hook 交互**
  - skill frontmatter 可声明 hooks。
  - skill 正文中的 shell block 会被转换为工具调用；但 MCP skill 被显式禁止执行内联 shell，以降低远端 prompt 注入风险。

### 7.5 Verdict 评价

- **完整性**：多来源加载、dedupe、conditional activation、dynamic discovery 都有。
- **Token 效率**：明显采用 progressive disclosure，而不是把全部技能正文灌进 prompt。
- **扩展性**：用户、项目、策略、插件、MCP 都能提供技能。
- **不足**：
  - 技能体系与 commands 体系兼容并存，概念边界对新读者不算轻。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 8. Sub-Agent 详细说明

### 8.1 Sub-Agent 引擎的实现

- **是否有专门的引擎**
  - 有。核心在 `tools/AgentTool/AgentTool.tsx` + `runAgent.ts` + `tasks/LocalAgentTask/`。
- **同时存在多少个 sub-agent**
  - 源码里能看到大量后台/前台 agent 支持，但我没有在当前快照里看到一个清晰的全局硬上限常量。
  - 实际上它依靠 task system、permission context、team/swarm context 来管理多个并发 worker。
- **唤醒机制**
  - 同步 agent：直接 inline 返回结果。
  - 异步 agent：通过 LocalAgentTask / task-notification / output file / SDK event queue。
  - team/swarm：`SendMessageTool` + mailbox。
- **注册与发现**
  - 内建、自定义、插件 agent 统一由 `loadAgentsDir.ts` 加载。
  - 模型通过 `AgentTool` 动态选择 `subagent_type`，也可走 implicit fork。
- **分类策略**
  - 按 agentType、model、permissionMode、requiredMcpServers、memory、background、isolation、worktree/remote 分类。
- **结果回归**
  - sync：`AgentTool` 直接拿 `runAgent()` 的消息流做结果归并。
  - async：写 sidechain transcript，最终通过 `<task-notification>` 回到主线程。
  - team：mailbox / panel / task system 并存。
- **注销 / 清理**
  - `killAsyncAgent()`、MCP cleanup、prompt cache tracking cleanup、worktree cleanup、sidechain transcript metadata 写入。
- **持久化**
  - sub-agent transcript：`getAgentTranscriptPath(agentId)`。
  - task output：`getTaskOutputPath(taskId)`。
  - agent metadata：`writeAgentMetadata()`。
- **权限管理**
  - 可继承父权限，也可由 agent frontmatter 覆盖 mode。
  - `bubble` mode 支持把审批气泡上抛到父终端。
  - `allowedTools` 会重建 session allow rules，防止父级授权泄漏。
- **LLM 使用方式**
  - 每个 sub-agent 都有自己的 `runAgent()` / `query()` 会话。
  - 模型可以继承或覆盖；fork path 还会尽量继承父 prompt bytes 和 exact tool set，以保 prompt cache 命中。
- **上下文管理**
  - 普通 sub-agent：独立 prompt + 可选 preload skills / MCP / memory。
  - fork sub-agent：完整继承父消息上下文，连 tool result placeholder 都设计成 byte-stable。
  - read file cache 可 clone；content replacement state 可继承。
- **与主 Agent 联动**
  - 任务进度会写入 panel / AppState / SDK events。
  - mailbox、todo/task list、permission context、MCP 工具可共享或桥接。
  - worktree isolation 是主要并发冲突缓解手段；没有看到自动三方 merge 这类更激进的冲突解决器。

### 8.2 Sub-Agent 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/tools/AgentTool/AgentTool.tsx` | AgentTool schema、spawn/fork/background/team/remote 分流 |
| `context/claude-code/tools/AgentTool/runAgent.ts` | sub-agent 执行、上下文/权限/skills/MCP 装配 |
| `context/claude-code/tools/AgentTool/forkSubagent.ts` | fork child prompt 与 cache-stable prefix 设计 |
| `context/claude-code/tools/AgentTool/loadAgentsDir.ts` | agent 定义加载与优先级 |
| `context/claude-code/tasks/LocalAgentTask/LocalAgentTask.tsx` | 异步 agent task 生命周期 |
| `context/claude-code/remote/RemoteSessionManager.ts` | 远端会话与权限桥接 |
| `context/claude-code/tools/SendMessageTool/SendMessageTool.ts` | teammate/mailbox 通信 |

### 8.3 Sub-Agent 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 调度引擎 | `AgentTool.tsx` + `runAgent.ts` | sync / async / teammate / remote / fork |
| 生命周期管理 | `LocalAgentTask.tsx` | task、notification、kill、resume |
| 上下文隔离 | `forkSubagent.ts`、`createSubagentContext()`、worktree isolation | full fork 与 isolated worktree 两套机制 |
| 权限与沙盒 | agent-specific permission mode、bubble、allowedTools、sandbox inheritance | 异步 worker 可自动避免 permission prompt |
| 结果回归 | inline result / task-notification / mailbox / sidechain transcript | 兼顾 TUI、SDK、remote |

### 8.4 Verdict 评价

- **完整性**：sub-agent 生命周期几乎被工程化到产品级。
- **隔离性**：上下文、权限、工作区隔离都有清晰选项。
- **可观测性**：progress tracker、task panel、sidechain transcript、output file 很完整。
- **不足**：
  - 复杂度极高，local/remote/fork/team/worktree 叠加后理解门槛很高。
  - 当前快照中未见简单明了的全局 agent 并发上限说明。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 9. TUI 详细说明

### 9.1 TUI 引擎的实现

- **驱动引擎**
  - `ink/ink.tsx` 是高度定制化的 Ink runtime：React reconciler + Yoga + frame buffer。
  - `scheduleRender` 走 microtask + `throttle(FRAME_INTERVAL_MS)`，并监听 resize / SIGCONT。
- **渲染引擎**
  - 有 front/back frame、style pool、char pool、hyperlink pool。
  - DOM -> Yoga layout -> render-to-screen -> optimize -> diff write。
  - alt-screen、cursor parking、mouse tracking、extended keys 都做了底层控制。
- **刷新机制**
  - 事件驱动重绘，不是粗暴全屏循环刷帧。
  - 还会在 terminal resume / resize / alt-screen contamination 时强制全量绘制。
- **数据通讯**
  - React context + AppState store + hooks 驱动。
  - keybinding context、notifications、overlay、modal、prompt overlay 都是独立 context。
- **多窗口/面板**
  - REPL 有 `prompt` / `transcript` 两大 screen。
  - 还有 expanded task view、teammate view、dialogs、terminal panel、search bar、notifications。
- **输入焦点与键盘路由**
  - `keybindings/useKeybinding.ts` 支持 context-aware keybindings 与 chord。
  - `useGlobalKeybindings.tsx` 管理 transcript/todo/teammate/terminal 等全局键。

### 9.2 TUI 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/ink/ink.tsx` | TUI runtime、frame buffer、输入/重绘 |
| `context/claude-code/screens/REPL.tsx` | 主交互屏幕 |
| `context/claude-code/components/TaskListV2.tsx` | task/todo 面板 |
| `context/claude-code/keybindings/useKeybinding.ts` | 键位解析与 handler 注册 |
| `context/claude-code/hooks/useGlobalKeybindings.tsx` | 全局键位行为 |
| `context/claude-code/components/` | dialogs、messages、permissions、mcp、shell 等 UI 组件 |

### 9.3 TUI 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 驱动引擎 | `ink/ink.tsx` | React reconciler + Yoga + alt-screen |
| 渲染引擎 | front/back frame + pools + optimizer | 非常像一个终端版小型渲染器 |
| 刷新机制 | throttle + event-driven repaint | 带 resize / resume / full redraw recovery |
| 数据通讯 | AppState + React hooks/context | 组件树和状态树都比较成熟 |

### 9.4 Verdict 评价

- **完整性**：输入、布局、渲染、选择、搜索、高亮、dialogs 都是一整套。
- **性能**：从池化、diff、throttle、virtual scroll 到 panel TTL，都有明显性能意识。
- **可扩展性**：组件和 hook 非常多，但也说明它已经沉淀出较稳定的扩展结构。
- **不足**：
  - TUI 复杂度高，理解和修改成本远高于传统 CLI。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 10. To-Do List 详细说明

### 10.1 To-Do List 引擎的实现

- **Parse 原理**
  - 不是 regex 从自然语言里猜 task，而是显式 tool call：
    - 旧版：`TodoWriteTool`
    - 新版：`TaskCreateTool` / `TaskUpdateTool` / `TaskListTool` / `TaskGetTool`
- **创建与注册**
  - `TodoWriteTool` 直接写 `AppState.todos`。
  - `Task v2` 则由 `utils/tasks.ts` 创建 JSON task 文件，并用 `proper-lockfile` 做并发锁。
- **状态机**
  - Task v2：`pending` / `in_progress` / `completed`；tool 层额外支持 `deleted` 动作。
  - 旧 todo checklist 也沿用类似 completed 语义。
- **与 Agent 循环集成**
  - todo/task 是正式 tool，不是旁路 UI 状态。
  - `TaskListV2` 在 TUI 内实时渲染。
  - team/swarm 场景下 task list 还能跨 agent 共享。
- **更新与维护**
  - `TaskUpdateTool` 支持 owner、status、metadata、blockedBy / blocks 变更。
  - 创建/完成 task 时还能触发 hooks。
  - `TodoWriteTool` 与 `TaskUpdateTool` 都会在一次性关闭 3+ 项任务且没有 verification step 时追加 verifier nudge。
- **持久化**
  - Task v2 落盘到 Claude config home 下的 `tasks/<taskListId>/<taskId>.json`。
  - 还有 `.highwatermark` 与 `.lock` 文件辅助并发安全和 task id 单调增长。
- **嵌套 / 依赖 / 优先级**
  - 有依赖关系（`blocks` / `blockedBy`）。
  - 没看到子任务树、优先级、截止日期这些更复杂字段。

### 10.2 To-Do List 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/tools/TodoWriteTool/TodoWriteTool.ts` | 旧版 todo checklist tool |
| `context/claude-code/tools/TaskCreateTool/TaskCreateTool.ts` | Task v2 创建 |
| `context/claude-code/tools/TaskUpdateTool/TaskUpdateTool.ts` | Task v2 更新 |
| `context/claude-code/tools/TaskListTool/TaskListTool.ts` | Task v2 列表 |
| `context/claude-code/utils/tasks.ts` | Task v2 持久化、锁、依赖关系 |
| `context/claude-code/components/TaskListV2.tsx` | TUI 展示 |

### 10.3 To-Do List 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| Parse 引擎 | 结构化 tool call | 非 regex 抽取 |
| 创建注册 | `createTask()` / `TodoWriteTool.call()` | 新旧两套系统并存 |
| 状态维护 | `TaskUpdateTool` + `utils/tasks.ts` | 支持 owner、依赖、删除 |
| 持久化 | JSON + lockfile | swarm/多进程友好 |

### 10.4 Verdict 评价

- **完整性**：Task v2 已经覆盖创建、更新、持久化、依赖、UI 展示。
- **集成度**：与 agent、team、hooks、TUI 的结合都很自然。
- **可靠性**：JSON + lockfile + highwatermark 说明作者认真处理了多进程竞争。
- **不足**：
  - 新旧两套 todo/task 并存，架构上稍显重复。
  - 状态机仍偏简化，没有 blocked/cancelled/priority/due date 等更完整项目管理字段。

**评分**：⭐⭐⭐⭐ (4/5)

---

## 11. CLI Permission 与执行模式详细说明

### 11.1 CLI Permission 引擎的实现

- **执行模式**
  - 明确存在：`default`、`plan`、`acceptEdits`、`bypassPermissions`、`dontAsk`。
  - 内部还可出现 `auto`（classifier 驱动）与 `bubble`（sub-agent prompt 上抛）等模式。
- **模式切换**
  - CLI 参数、settings、Enter/ExitPlanMode tool、sub-agent definition 都能触发模式变化。
  - `permissionSetup.ts` 负责初始化，`PermissionMode.ts` 则维护显示标题、symbol、external/internal 映射。
- **权限分层模型**
  - 工具级：blanket allow/deny/ask。
  - 内容级：如 `Bash(npm publish:*)` 这种 content-specific rule。
  - 工作目录级：additional working directories。
  - 还叠加 classifier、hook、sandbox、MCP server approval、swarm/coordinator 权限分流。
- **不同模式下的行为差异**
  - `bypassPermissions`：尽量直通，但用户交互类工具与 ask rule 仍可阻断。
  - `dontAsk`：把 ask 变 deny。
  - `plan`：切换到更偏规划导向的交互模式，而不是默认执行导向。
  - `auto`：交给 classifier 判定。
  - sub-agent `bubble`：审批浮到父终端。
- **Guardian / Policy / Approval 中间件**
  - 核心在 `utils/permissions/permissions.ts::hasPermissionsToUseTool()`。
  - `tool.checkPermissions()`、permission rules、hooks、classifier、mode handler 都会串起来。
  - `BashTool` 还有专门的危险命令模式检测、classifier 与 sandbox 逻辑。
- **反馈机制**
  - 交互模式可弹 permission dialog / sandbox dialog。
  - TUI 有专门的 rejected message / diff 组件 / task notification。
  - background agent 则通过 task notification 和 output file 反馈。
- **拒绝后的恢复路径**
  - deny 后可保留/更新 permission rules。
  - hooks 与 permission update schema 支持用户把一次决策持久化到不同 source。

### 11.2 CLI Permission 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/claude-code/utils/permissions/PermissionMode.ts` | permission mode 定义 |
| `context/claude-code/utils/permissions/permissionSetup.ts` | 模式初始化与切换准备 |
| `context/claude-code/utils/permissions/permissions.ts` | 权限决策主链 |
| `context/claude-code/tools/BashTool/bashPermissions.ts` | Bash 细粒度权限与 classifier |
| `context/claude-code/tools/BashTool/shouldUseSandbox.ts` | sandbox 决策 |
| `context/claude-code/utils/sandbox/sandbox-adapter.ts` | 沙盒适配层 |
| `context/claude-code/hooks/useCanUseTool.tsx` | UI/交互模式 permission hook |

### 11.3 CLI Permission 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 模式引擎 | `PermissionMode.ts` + `permissionSetup.ts` | plan / accept / bypass / dontAsk / auto / bubble |
| 权限分层 | blanket rule + content rule + directory + tool.checkPermissions | 粒度足够细 |
| 审批中间件 | `hasPermissionsToUseTool()` + handlers | 支持 interactive / coordinator / swarm |
| 安全策略 | sandbox、dangerous patterns、classifier、plugin-only policy | 明确的最小权限意识 |

### 11.4 Verdict 评价

- **完整性**：这是该项目最“产品化”的子系统之一。
- **安全性**：有明确的 rule source、sandbox、dangerous permission stripping、classifier 与 hook 联动。
- **用户体验**：既能细粒度 ask，也有 auto/bypass/plan 等不同工作模式。
- **不足**：
  - 复杂度很高；理解为什么某个 tool 被 allow/deny，往往要跨多个层次。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 12. API 接口处的缓存安排

- **Prompt Cache**
  - 已实现，而且是非常深入的实现。
  - `getPromptCachingEnabled()`、`getCacheControl()`、`buildSystemPromptBlocks()`、`addCacheBreakpoints()` 共同控制 system/message 级 cache marker。
- **Cache break detection**
  - `promptCacheBreakDetection.ts` 会记录 system/tool/model/beta/effort/hash，并在下一次请求对比是否发生 cache break。
  - 不只是埋点，还能输出 diffable content 与差异原因。
- **压缩 / system prompt / 工具变更与缓存保护**
  - fork sub-agent 会刻意继承父 prompt bytes 与 exact tools，显式为 prompt cache 设计。
  - microcompact 用 `cache_edits` / `cache_reference` 尽量在不毁掉 prefix 的情况下回收上下文。
  - tool schema 还有 session-stable cache，避免 GrowthBook 翻转导致 schema 字节漂移。
- **其他 API 优化**
  - defer_loading tool search；
  - eager input streaming；
  - task budget；
  - fast mode / effort；
  - tool schema cache；
  - startup auth/keychain prefetch。

---

## 13. 对不同 LLM 模型的逻辑安排

- **支持的 provider / 模型入口**
  - Anthropic first-party
  - AWS Bedrock
  - Google Vertex
  - Azure Foundry
- **Provider 抽象层**
  - 有。`services/api/client.ts` + `utils/model/providers.js` 负责 provider routing。
- **针对不同模型的特殊处理**
  - prompt caching 可按 model 开关；
  - Haiku / Sonnet / Opus 的 max token、thinking、effort、context window 分别处理；
  - strict tool schema 与 fine-grained tool streaming 只在部分模型/提供商上开放；
  - 1h TTL / betas / fast mode 也与 provider/model 相关。
- **自动切换 / fallback**
  - `withRetry()` 支持 fallbackModel。
  - repeated 529 / capacity 问题下可回退到更小/更稳的模型。
  - fast mode 还有 cooldown 逻辑。
- **边界**
  - 这是“Anthropic 模型跨部署入口”的抽象，不是 OpenAI/local/open-source 模型统一层。

---

## 14. 其他 Agent-Specific 优势、亮点与效率提升

### 14.1 架构亮点

- **prompt cache 不只是打开，而是被视作一等架构目标**：tool schema cache、fork cache-stable prefix、cache break detection、cache_edits 都围绕它设计。
- **Sub-agent 不是附属功能**：本地、异步、remote、worktree、team/swarm 全部进入同一框架。
- **TUI 不是外壳**：它本身是高度工程化的终端应用层。

### 14.2 性能与效率

- 并发安全工具可批量并行；
- background task / agent / notification pipeline 成熟；
- startup prefetch（MDM/keychain/bootstrap）明显为冷启动优化；
- frame buffer / pool / virtual scroll / transcript bootstrap 都有针对性能的专门处理；
- session sidechain transcript 避免把所有 agent 输出都挤进主对话链。

### 14.3 安全与沙盒

- permission mode、rule source、sandbox manager、dangerous pattern classifier、plugin-only policy 共同构成防线。
- Bash 是重点防御对象，拥有专门的命令分类、安全校验、sandbox 决策与 suggestion 生成。
- remote CCR 模式还有本地 permission bridge，不把审批完全丢给远端。

### 14.4 开发者体验

- 调试/诊断设施很多：debug logs、telemetry、prompt dump、session history、resume、transcript search。
- hooks、skills、plugins、agents 都支持动态加载或热重载。
- 任务、panel、progress tracker、mailbox 让多 agent 行为可见而不是“黑盒后台线程”。

### 14.5 独特功能

- 与本仓另外两个对比对象相比，claude-code 的独特点包括：
  - **prompt cache break detection** 这类近乎“LLM infra 级”的自监控；
  - **本地 + remote CCR + teammate swarm** 的统一代理模型；
  - **Task v2 文件锁持久化**，而不是只靠 UI 内存 checklist；
  - **定制 Ink runtime**，不是薄薄一层 readline REPL。

---

## 总体评分

| 维度 | 评分 (1-5) | 一句话总结 |
|------|------------|------------|
| LLM 请求方式 | 5 | Anthropic 生态内做到了请求、缓存、重试、持久化的深度工程化 |
| Hooks | 5 | 生命周期完整、来源丰富、可阻断可注入的成熟 hook 系统 |
| 上下文管理 | 5 | 分层压缩、compact boundary、resume 与 sidechain 设计非常成熟 |
| Tool Use | 5 | 工具抽象统一，串并行编排、MCP 合流和大输出处理都很强 |
| Skill 管理 | 5 | 多来源、渐进式披露、动态发现、conditional activation 全覆盖 |
| Sub-Agent | 5 | 从 fork 到 worktree 到 remote/swarm，几乎是完整代理操作系统 |
| TUI | 5 | 不是普通 CLI，而是高度定制的终端应用框架 |
| To-Do List | 4 | Task v2 已很强，但新旧两套 task/todo 并存且状态机仍偏简化 |
| CLI Permission | 5 | 模式、规则、审批、classifier、sandbox 构成了强权限治理链 |
| API 缓存 | 5 | prompt caching 与 cache break detection 是该项目最独特的基础设施之一 |
| 多模型支持 | 4 | 多 provider 很强，但仍主要局限在 Anthropic 模型家族 |
| 整体工程成熟度 | 5 | 明显是重产品化、重可观测性、重风险控制的成熟 Agent CLI |

### 最终客观评价与辩证分析

- **核心优势**：
  - 最突出的不是单点功能，而是多个子系统之间的协同：LLM cache、permission、sub-agent、task、TUI、hooks 彼此打通。
  - 它既能做高交互的本地终端代理，又能做后台 worker、team swarm、remote CCR，会话和权限模型仍保持统一。
  - 与 codex 相比，它在 TUI、permission/approval、Anthropic prompt caching 这三块更“产品化”；与 mini-agent 相比，几乎是两个时代的工程成熟度。
- **明显短板**：
  - 第一短板不是“缺功能”，而是**复杂度过高**。feature gates、双轨系统（TodoWrite vs Task v2）、多种 agent 执行路径都会抬高理解与维护成本。
  - 第二短板是**模型生态偏 Anthropic 中心**。多 provider 支持很强，但本质仍是 Anthropic 模型跨入口治理，不是广义多模型代理平台。
  - 第三短板是**外部可读性不足**：当前源码快照里缺少包管理/测试清单等外围元信息，外部贡献者需要从源码本身反推很多事实。
- **适用场景**：
  - 适合需要强交互、强审批、长会话、复杂上下文、多步骤工具调用的大型工程任务。
  - 特别适合大仓库代码改造、需要 remote/local 混合、需要多 agent 并行、又必须保留用户审批与回放能力的场景。
  - 不太适合追求“极小实现 / 容易二开 / 几百行就能掌握”的教学型或轻量 PoC 场景。
- **发展建议**：
  - 若要再提升一个档次，我认为优先级最高的是**收敛系统复杂度**：统一 TodoWrite 与 Task v2、减少 feature-path 爆炸、对外补更清晰的架构分层文档。
  - 它现在最可能拖后腿的不是某个缺失能力，而是复杂度带来的维护负担与行为可预测性问题。
- **横向对比定位**：
  - 相比 codex，claude-code 的独特生态位是：**Anthropic-first、TUI-first、approval-first 的重产品化终端代理**。
  - 相比 mini-agent，它不是“最小可用代理样板”，而是**完整工作台 + 权限系统 + 多代理调度器**。
  - 如果说 mini-agent 更像教学原型，codex 更像基础设施/平台内核，那么 claude-code 更像一个已经长期打磨的终端产品。
