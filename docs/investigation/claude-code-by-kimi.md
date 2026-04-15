# Agent CLI 深度分析报告：Anthropic Claude Code

> 分析对象: `Anthropic Claude Code`
> 分析时间: 2026-04-15
> 分析者: `Kimi`
> 文件位置: `context/claude-code`

---

## 1. 技术栈

| 维度 | 技术选型 |
|------|----------|
| **核心语言** | TypeScript (TSX) |
| **运行时 / 框架** | Bun（`bun:bundle` 特性开关用于编译时死码消除），兼容 Node.js 路径（npm 全局安装） |
| **包管理 / 构建工具** | Bun 内置打包器；大量条件 `require()` 配合 `feature('FLAG')` 实现编译期代码裁剪 |
| **UI / CLI 库** | 自定义 Ink fork（`ink/` 目录内包含完整 reconciler、DOM、事件循环、焦点管理、渲染管线） |
| **LLM SDK / API 客户端** | `@anthropic-ai/sdk`（Messages Beta API），扩展 Bedrock/Vertex/Foundry SDK |
| **配置解析** | Zod v4（`zod/v4`），配合 `lazySchema` 延迟初始化 |
| **测试框架** | 代码中存在 `process.env.NODE_ENV === 'test'` 分支，结合 bun test |
| **其他关键依赖** | React 18（Ink 的 VDOM 基础）、Commander.js、`lodash-es`、Chalk、`proper-lockfile`（Task V2 并发锁）、`@modelcontextprotocol/sdk` |

---

## 2. 目录结构

只展示与分析维度直接相关的文件与目录。

```
context/claude-code/
├── services/api/              # LLM API 请求层
│   ├── claude.ts              # 核心请求构建、流式消费、缓存与 beta 头管理
│   ├── client.ts              # Anthropic/Bedrock/Vertex/Foundry 客户端创建
│   ├── withRetry.ts           # 手动重试循环（含 529/429 策略、fallback 模型）
│   ├── promptCacheBreakDetection.ts  # Prompt Cache 断点检测与 diff 诊断
│   └── errors.ts / logging.ts # API 错误分类与日志
├── query.ts                   # 主 Agent ReAct 循环（queryLoop）
├── QueryEngine.ts             # SDK/Headless 路径的查询引擎类
├── Tool.ts                    # Tool 抽象定义与 ToolUseContext
├── tools.ts                   # 全局工具注册表与过滤逻辑
├── tools/                     # 内建工具实现
│   ├── AgentTool/             # Sub-Agent 调度（runAgent.ts、forkSubagent.ts）
│   ├── BashTool/
│   ├── FileEditTool/
│   ├── FileReadTool/
│   ├── TodoWriteTool/         # V1 Todo（内存）
│   ├── TaskCreateTool/        # V2 Task（文件持久化）
│   ├── SkillTool/
│   └── MCPTool/               # MCP 工具适配
├── tasks/                     # 任务运行时（LocalAgentTask、RemoteAgentTask 等）
├── utils/hooks.ts             # Agent 生命周期 Hooks 执行引擎（~5000 行）
├── utils/hooks/               # Hook 子模块（sessionHooks、execHttpHook、execAgentHook 等）
├── utils/permissions/         # 权限模式、规则、审批中间件
├── services/compact/          # 上下文压缩（microCompact、autoCompact、snipCompact）
├── skills/                    # Skill 加载与注入
│   ├── loadSkillsDir.ts
│   └── bundledSkills.ts
├── ink/                       # 自定义 TUI 引擎（reconciler、renderer、screen、focus、events）
├── screens/REPL.tsx           # 主交互式 REPL 屏幕（~5000 行）
├── components/                # React 组件库（消息、权限、Diff、TaskList、Spinner 等）
├── utils/sessionStorage.ts    # 会话/子代理持久化（JSONL sidechain）
└── utils/tasks.ts             # Task V2 核心（文件锁、阻塞关系、高水位线）
```

> **注意**：LLM 相关代码集中在 `services/api/`、`query.ts`、`QueryEngine.ts`，其中 `claude.ts` 是唯一真正发起网络请求的入口。

---

## 3. LLM 请求方式详细说明

### 3.1 LLM 请求引擎的实现

- **认证信息的获取与注入方式**：`services/api/client.ts` 按需构建 `@anthropic-ai/sdk` 客户端。直接 API 使用 `ANTHROPIC_API_KEY` 或 OAuth（`getClaudeAIOAuthTokens`）；AWS Bedrock 使用 `refreshAndGetAwsCredentials`；GCP Vertex 使用 `GoogleAuth`；Azure Foundry 使用 `DefaultAzureCredential` 或 `ANTHROPIC_FOUNDRY_API_KEY`。认证头在 `getAnthropicClient` 中动态注入 `defaultHeaders`。

- **LLM 请求的入口封装**：核心入口是 `services/api/claude.ts` 中导出的 `queryModelWithStreaming`（大-generator 函数，~2600 行），负责：构建 system prompt blocks、工具 schema、消息规范化、添加 cache breakpoints、调用 `withRetry`、消费 SSE stream、组装 `AssistantMessage`。`query.ts` 的 `queryLoop` 和 `QueryEngine.ts` 均调用此入口。

- **是否支持流式响应 (streaming) 和非流式响应**：主流路径**仅使用流式**（`stream: true`）。在流式遇到 529 错误时，代码存在 `didFallBackToNonStreaming` 分支，但实际实现中 fallback 到非流式的代码路径在文件后部有预留，整体以流式为绝对主导。

- **请求体构建逻辑**：集中在 `claude.ts` 的 `paramsFromContext` 闭包中。包含：动态 beta 头拼接（thinking、fast mode、afk mode、cache editing、structured outputs、task budgets 等）、工具 schema 生成（`toolToAPISchema`，支持 `defer_loading`）、消息规范化（`normalizeMessagesForAPI`）、MCP 工具/Deferred 工具过滤、`cache_control` 注入。

- **响应解析逻辑**：在同一 `claude.ts` 的 `for await (const part of stream)` 循环中。逐事件处理 `message_start`、`content_block_start`、`content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`，将内容累积为 `BetaContentBlock` 数组，最终组装成 `AssistantMessage`。`usage`、`stopReason`、`costUSD`、`ttftMs` 均在此提取。

- **网络失败或 API 错误时是否有自动重试？**：有。`withRetry.ts` 实现了独立于 SDK 的手动重试。
  - 策略：指数退避 + jitter，base delay 500ms，最大重试默认 10 次。
  - 529 (Overloaded) 在前台来源（`repl_main_thread`、`sdk`、`agent:*` 等）最多重试 3 次；后台来源（摘要、分类器）立即放弃，防止网关级联放大。
  - `UNATTENDED_RETRY` 特性可对 429/529 进行持久化无限重试，带 30s heartbeat 和最高 5min 退避。
  - 认证错误（401）会触发 OAuth 刷新或清除缓存后重试；`FallbackTriggeredError` 支持模型降级（如 Sonnet → Haiku）。

- **最大重试次数和超时时间是否可配置？**：`maxRetries` 在 `withRetry` 选项中可覆盖；默认 `API_TIMEOUT_MS = 600_000`（10 分钟）。流式 idle watchdog 默认 90 秒（`CLAUDE_STREAM_IDLE_TIMEOUT_MS`）。

- **是否存在 LLM 响应缓存或 Prompt Cache breakpoint？**：**深度集成 Anthropic Prompt Caching**。
  - `addCacheBreakpoints` 在 system prompt 和消息链特定位置注入 `cache_control: { type: 'ephemeral' }`。
  - `promptCacheBreakDetection.ts` 维护跨请求状态，通过哈希比对 system prompt、工具 schema、beta 头、模型等，检测未预期的 cache miss（可输出 diff 到临时文件）。
  - `cachedMicrocompact`（ant-only）使用 API 的 `cache_edits` 在不重写 prompt 前缀的情况下删除旧工具结果。
  - `globalCacheStrategy` 支持 `system_prompt` 级别的全局缓存（通过 `prompt_caching_scope` beta 头）。

- **聊天记录的本地持久化格式、路径与触发时机**：`utils/sessionStorage.ts` 使用 **JSONL** 格式，路径为 `~/.claude/projects/<projectDir>/<sessionId>.jsonl`（或 `sessionProjectDir`）。每条消息以独立 JSON 行追加写入。子代理有独立的 sidechain 路径（`getAgentTranscriptPath`）。触发时机：流式循环中收到可记录消息时立即 `appendFile`。

- **持久化数据中是否区分角色并记录 token usage、模型名称、时间戳等元数据？**：是。JSONL 中的 `Entry` 类型包含 `user`/`assistant`/`attachment`/`system` 消息，assistant 消息带有 `usage`（input/output/cache 读/写）、`model`、`uuid`、`timestamp`（由 `messages.ts` 的构造器填充）。

### 3.2 LLM 请求代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `services/api/claude.ts` | 核心 LLM 请求构建、流式消费、消息组装、beta 头管理、cache breakpoint 注入 |
| `services/api/client.ts` | 按 provider（Anthropic/Bedrock/Vertex/Foundry）创建 SDK 客户端，处理认证头 |
| `services/api/withRetry.ts` | 手动重试循环、错误分类、529/429 特殊策略、模型 fallback |
| `services/api/promptCacheBreakDetection.ts` | Cache key 状态追踪、cache break 检测与 diff 诊断 |
| `services/api/logging.ts` | API 请求/成功/错误日志与 usage 统计 |
| `services/api/errors.ts` | API 错误分类（`isPromptTooLongMessage`、`is529Error` 等） |
| `query.ts` | 主 ReAct 循环，调用 `claude.ts` 并在工具调用结果后 `continue` |
| `QueryEngine.ts` | SDK/Headless 封装，维护 messages、usage、denials、file cache |
| `utils/messages.ts` | 消息规范化、system prompt 构造、工具结果配对修复 |

### 3.3 LLM 请求子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 认证机制 | `client.ts` + `utils/auth.ts` | 支持 API Key、OAuth、AWS IAM、GCP ADC、Azure AD；运行时自动刷新 |
| API Wrapper | `claude.ts` 的 `streamClaudeResponse` generator | 对 SDK 的 `beta.messages.create` 进行厚封装；不直接使用 SDK 的 BetaMessageStream（避免 O(n²) partial JSON 解析） |
| 重试机制 | `withRetry.ts` | 手动实现，区分前台/后台来源；支持模型 fallback；有 `CannotRetryError` 终止信号 |
| 本地缓存 | `promptCacheBreakDetection.ts` + `addCacheBreakpoints` | 客户端检测 cache miss 原因；服务端 cache 通过 Anthropic Prompt Caching 实现 |
| Session 持久化 | `utils/sessionStorage.ts` | JSONL 追加写；支持会话恢复、子代理 sidechain、工作区切换 |
| 聊天记录结构 | `types/message.ts` + `types/logs.ts` | 强类型区分 User/Assistant/System/Attachment/Progress/CompactBoundary/Tombstone |

### 3.4 Verdict 评价

- **完整性**：覆盖了认证、请求、重试、缓存、持久化的全链路，且每个环节都有厚封装和可观测性埋点。
- **可靠性**：重试策略精细（区分 529 来源、认证刷新、模型降级），流式 idle watchdog 防止静默挂起。
- **可观测性**：`logEvent`/`logForDebugging`/`logForDiagnosticsNoPII` 三层日志，配合 `queryCheckpoint`/`headlessProfilerCheckpoint` 进行时序剖析；cache break 检测可直接输出 diff。
- **不足**：
  - 核心入口 `claude.ts` 超过 3400 行，请求构建逻辑与流式消费耦合在同一 generator 中，长期维护成本高。
  - Prompt Cache 断点检测虽然完善，但属于**事后诊断**（检测到 cache miss 再分析原因），而非事前预测。
  - 非 Anthropic 模型的原生支持有限：Bedrock/Vertex/Foundry 仅改变 transport 和认证，模型仍限定在 Claude 系列。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 4. Hooks 详细说明

### 4.1 引擎的实现

- **Hook 的注册/发现机制**：Hook 来源多元：
  1. `.claude/settings.json` 中的 `hooks` 配置；
  2. Skill/Agent frontmatter 中的 `hooks` 块（`registerFrontmatterHooks.ts`）；
  3. 插件启动时加载（`loadPluginHooks`）；
  4. 运行时内存注册（`addFunctionHook` / `addSessionHook`，供 SDK/内部使用）。
  配置在会话启动时被 `captureHooksConfigSnapshot` 捕获为快照，避免运行中配置变更导致的不确定性。

- **Hook 的调度器是如何执行的**：`utils/hooks.ts` 中的 `executeHooks` 是统一调度器。
  - **串行**执行同类型的同步 Hook（按注册顺序）；
  - **并行**执行异步 Hook（`Promise.all`）；
  - 支持 **background** 模式（`asyncResponse.rewake` 可在完成后通过任务通知重新唤醒会话）。

- **Hook 的执行模式有哪些**：
  1. **Shell 命令**（默认）：通过 `wrapSpawn` 启动子进程；
  2. **HTTP/Webhook**：`execHttpHook.ts`；
  3. **LLM 代理**：`execAgentHook.ts`（内部将 hook 输入作为 prompt 发给子代理）；
  4. **Prompt Hook**：`execPromptHook.ts`（弹 UI prompt 向用户收集信息）；
  5. **Function Hook**：内存中的 TypeScript 回调（`FunctionHook`）。

- **Hook 的结果如何影响主流程**：
  - 同步 Hook 返回 `PermissionUpdate` 可直接修改权限规则；返回 `updatedInput` 可在 `PreToolUse` 阶段改写工具入参。
  - `exit` 为 `2` 时视为阻塞错误，可中断主循环（如 `Stop` hook）。
  - 异步 Hook 通过 `enqueuePendingNotification` 向消息队列注入系统提醒，间接影响下一轮 LLM 决策。

### 4.2 Hooks 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `utils/hooks.ts` | 核心 Hook 执行引擎（`executeHooks`、`executePreCompactHooks`、`executeSubagentStartHooks` 等） |
| `utils/hooks/sessionHooks.ts` | 内存 Hook 注册表（Map 存储，避免 O(N²) 拷贝） |
| `utils/hooks/registerFrontmatterHooks.ts` | 将 frontmatter 中的 hooks 声明转换为 session hooks |
| `utils/hooks/registerSkillHooks.ts` | Skill 发现后的 Hook 注册 |
| `utils/hooks/execAgentHook.ts` | 通过 Agent 工具执行 Hook |
| `utils/hooks/execHttpHook.ts` | HTTP/Webhook Hook 执行 |
| `utils/hooks/execPromptHook.ts` | Prompt Hook 执行 |
| `utils/hooks/AsyncHookRegistry.ts` | 追踪后台异步 Hook，支持结果回归 |
| `utils/sessionStart.ts` | 会话启动时 orchestrate `processSessionStartHooks` 和 `processSetupHooks` |

### 4.3 全部 Hook 说明

| Hook 名称 | 触发时机 | Matcher 能力 | 输出影响 |
|-----------|----------|--------------|----------|
| `SessionStart` | 会话开始（信任对话框后） | 无 | 可注入上下文、预热缓存 |
| `Setup` | 项目初始化 | 无 | 可执行一次性配置脚本 |
| `PreToolUse` | 工具调用前 | 支持 tool name / agent type 匹配 | 可拦截、修改入参、返回替代结果 |
| `PostToolUse` | 工具调用成功 | 同上 | 可追加消息、修改状态 |
| `PostToolUseFailure` | 工具调用失败 | 同上 | 错误恢复、通知 |
| `PermissionDenied` | 权限被拒绝 | 同上 | 审计、自动规则调整 |
| `PreCompact` / `PostCompact` | 上下文压缩前后 | 无 | 可保存/恢复外部状态 |
| `SubagentStart` / `SubagentStop` | 子代理生命周期 | agent type 匹配 | 可注入/清理环境 |
| `TaskCreated` / `TaskCompleted` | Task V2 创建/完成 | 无 | 工作流联动 |
| `UserPromptSubmit` | 用户提交新消息 | 无 | 可修改用户输入 |
| `Elicitation` / `ElicitationResult` | MCP 需要用户授权 URL | server name 匹配 | 自动化 OAuth 流程 |
| `SessionEnd` | 会话结束/清除 | 无 | 执行快速清理（默认 1.5s 超时） |

### 4.4 Verdict 评价

- **成熟度**：生命周期覆盖极广，从会话启动到子代理停止、从工具调用到上下文压缩都有 hook 点。
- **扩展性**：用户可通过 settings.json、skill frontmatter、插件、SDK `addFunctionHook` 四种方式扩展。
- **安全性**：所有 Hook 执行前检查 `shouldSkipHookDueToTrust()`（要求工作区信任）；`shouldAllowManagedHooksOnly()` 可阻止不可信插件 Hook。
- **不足**：
  - Hook 以**串行 Shell 命令**为主，高频率触发时（如 `PostToolUse` 在每个工具后执行）子进程开销较大。
  - `--bare` 模式为了速度会**跳过所有 Hook**，导致脚本化执行与交互式执行的行为差异较大。
  - Hook 的执行结果类型（Sync/Async/Background）由配置决定，但在复杂场景下（多个 Hook 同时返回 permission update）的合并规则不够显式。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 5. 上下文管理详细说明

### 5.1 上下文引擎的实现

- **核心状态持有者**：`QueryEngine`（SDK 路径）和 `screens/REPL.tsx` 中的 AppState（交互路径）。消息链存储在 `mutableMessages`（`QueryEngine`）或 `AppState.messages`（REPL）。

- **消息在内存中的数据结构**：`Message[]`（`types/message.ts` 中强类型的 union：UserMessage、AssistantMessage、SystemMessage、AttachmentMessage、ProgressMessage 等）。每条消息有 `uuid` 和 `parentUuid` 构成链表。

- **消息在进入 LLM API 前经过哪些规范化/转换阶段**：
  1. `processUserInput`（解析附件、引用、命令队列）；
  2. `normalizeMessagesForAPI`（移除 UI-only 字段、修复工具结果配对、strip advisor blocks、strip tool_reference blocks、strip excess media items）；
  3. `ensureToolResultPairing`（修复 resume/teleport 后的 orphan tool_use/tool_result）；
  4. `addCacheBreakpoints`（注入 `cache_control`）。

### 5.2 上下文管理代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `QueryEngine.ts` | SDK 路径的上下文持有者，维护 mutableMessages、usage、file cache |
| `screens/REPL.tsx` | 交互路径的上下文持有者，管理消息列表、流式状态、后台任务 |
| `utils/messages.ts` | 消息构造、规范化、配对修复、内容提取 |
| `services/compact/compact.ts` | 传统完整压缩（LLM 摘要 + compact_boundary） |
| `services/compact/autoCompact.ts` | 自动压缩触发器与熔断器 |
| `services/compact/microCompact.ts` | 每轮请求前的轻量压缩（cache_edits / 时间清除） |
| `services/compact/sessionMemoryCompact.ts` | 基于 session-memory 的无 LLM 压缩 |
| `services/compact/snipCompact.ts` | HISTORY_SNIP 特性：截断前缀历史（SDK 模式） |
| `utils/context.ts` | 上下文窗口大小、max_output_tokens、1M 上下文实验判定 |
| `utils/tokens.ts` | Token 估算（基于 API usage 或 fallback heuristic） |

### 5.3 全部分层说明

| 层级 | 内容 | 是否持久化 | 备注 |
|------|------|------------|------|
| System Prompt | 系统指令、工具描述、Skills、UserContext | 否（每轮重建） | 通过 `cache_control` 缓存前缀 |
| User Messages | 用户输入、附件、命令队列产物 | 是（JSONL） | `normalizeMessagesForAPI` 后进入 API |
| Assistant Messages | 模型输出（text/thinking/tool_use） | 是 | 携带 usage、model、timestamp |
| Tool Results | 工具执行结果（`tool_result` block） | 是 | 大结果可外存为文件 |
| Compact Boundary | `system` 消息 subtype=`compact_boundary` | 是 | 标记摘要与活跃历史的边界 |
| Progress Messages | 工具进度（bash_progress、sleep_progress） | **否** | UI-only，不参与 API |

### 5.4 上下文压缩机制

- **压缩触发条件**：
  1. **AutoCompact**：token 超过模型阈值（`calculateTokenWarningState`）或收到 `prompt_too_long` API 错误；
  2. **MicroCompact**：每轮请求前，若距上次 assistant 消息超过时间阈值（约 5min），用占位符替换旧 tool result 内容；
  3. **用户手动触发**：`/compact` 命令；
  4. **Reactive Compact**（feature-gated）：基于运行时 token 压力的即时压缩。

- **压缩策略**：
  - **Summarization**（`compact.ts`）：调用 LLM 生成对话摘要，注入 `compact_boundary`；
  - **Session-Memory Compact**（`sessionMemoryCompact.ts`）：利用 session memory 子系统剪枝，无需额外 LLM 调用；
  - **Truncation/Snip**（`snipCompact.ts`）：在 SDK 模式下直接丢弃前缀消息；
  - **Cache Edits**（`microCompact.ts`，ant-only）：通过 API `cache_edits` 删除旧 tool result，不破坏 prompt cache。

- **分层压缩逻辑**：
  - System prompt 和工具 schema 通常受 cache 保护，压缩主要针对 **user/assistant/tool_result** 历史。
  - 压缩后通过 `postCompactCleanup.ts` 以每 skill 5000 token 上限重新注入 skill，防止 unbounded growth。

- **压缩后恢复**：
  - `compact_boundary` 消息携带压缩摘要元数据，用于恢复时定位活跃历史边界。
  - 会话恢复（`loadTranscriptFromFile`）会识别 `compact_boundary` 并重建上下文链；压缩后 skills 会按预算重新注入。

### 5.5 Verdict 评价

- **完整性**：覆盖了从轻量 micro-compact 到重度 LLM-summary 的全谱系压缩策略。
- **精细度**：Token 估算有 API usage 优先路径，fallback 到 heuristic；auto-compact 有 3 次熔断器防止 API hammering。
- **恢复能力**：`compact_boundary` 元数据 + sidechain transcript 使得压缩后恢复成为可能，但**工具 schema 和 system prompt 的恢复依赖重新注入**，若 GrowthBook 状态在压缩前后变化，可能因 cache key 不一致导致隐式的上下文漂移。
- **不足**：
  - 多层级压缩（micro + auto + reactive）的**优先级与互斥规则**分散在多个文件中，调试复杂。
  - `QueryEngine` 与 `REPL.tsx` 的压缩行为不完全一致（REPL 保留完整 scrollback，QueryEngine 截断），SDK 与交互式用户体验存在差异。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 6. Tool Use 详细说明

### 6.1 Tool Use 引擎的实现

- **Tool 的抽象基类 / Trait / Interface**：`Tool.ts` 中导出的 `Tool<Input, Output, P>` 类型（TypeScript 结构类型，非 class）。包含 `call`、`description`、`inputSchema`、`outputSchema`、`isEnabled`、`checkPermissions`、`mapToolResultToToolResultBlockParam`、`renderToolResultMessage`、`toAutoClassifierInput` 等约 20 个字段/方法。

- **Tool 是如何注册到 Agent 的**：
  1. `tools.ts` 的 `getAllBaseTools()` 返回硬编码的内建工具列表（含大量 feature-gated 条件加载）。
  2. `getTools(permissionContext)` 调用 `filterToolsByDenyRules`，根据权限规则的 deny list 过滤。
  3. MCP 工具在运行时通过 `useMergedTools`（React hook）动态合并进 AppState。
  4. 最终工具池通过 `toolUseContext.options.tools` 传入 `query.ts` 的循环。

- **Tool 的执行流程**：
  1. LLM 输出 `tool_use` block；
  2. `query.ts` 调用 `runTools`（`services/tools/toolOrchestration.ts`）或 `StreamingToolExecutor`；
  3. 对每个 tool_use，先 `validateInput`，再 `checkPermissions`（经过规则→Hook→分类器→UI 确认），然后执行 `tool.call()`；
  4. `call()` 返回 `ToolResult`，通过 `mapToolResultToToolResultBlockParam` 序列化为 `tool_result` block；
  5. 将 `tool_result` 追加到 messages，触发 queryLoop 的 `continue`，进入下一轮 LLM。

- **是否支持并行执行**：**是**。`isConcurrencySafe(input)` 返回 true 的工具会在同一轮 assistant message 的多个 tool_use 间并行执行。`isDestructive` 和 `interruptBehavior` 用于控制并行时的安全性。

- **Tool 结果如何序列化并重新注入对话历史**：`mapToolResultToToolResultBlockParam` 将工具的 domain-specific `Output` 转换为标准的 Anthropic `ToolResultBlockParam`（支持 text/image/json）。大结果（超过 `maxResultSizeChars`）会被持久化为文件，只向模型返回文件路径预览。

### 6.2 Tool Use 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `Tool.ts` | Tool 类型定义、ToolUseContext、辅助函数 |
| `tools.ts` | 内建工具列表、默认 preset、deny-rule 过滤 |
| `services/tools/toolOrchestration.ts` | 工具执行编排（并行/串行调度） |
| `services/tools/StreamingToolExecutor.ts` | 流式工具执行器 |
| `utils/toolPool.ts` | 工具池合并逻辑（MCP + 内建 + 动态） |
| `hooks/useMergedTools.ts` | React hook：动态合并 MCP 工具到主池 |
| `hooks/useCanUseTool.tsx` | 权限检查 Hook（规则→Hook→分类器→UI） |

### 6.3 内建工具逐一列举与分析

| 工具名 | 文件 | 核心能力 | 特殊设计 |
|--------|------|----------|----------|
| `Bash` | `BashTool/` | 执行 shell 命令 | 支持 sandbox、 speculative permission、RCE 黑名单 |
| `FileRead` | `FileReadTool/` | 读取文件内容 | 内置 LRU cache (`fileStateCache`)、行范围读取 |
| `FileEdit` | `FileEditTool/` | 基于 diff 的文件编辑 | 支持 diff preview、undo（fileHistory） |
| `FileWrite` | `FileWriteTool/` | 写入文件 | 覆盖保护、路径规范化 |
| `Glob` / `Grep` | `GlobTool/` / `GrepTool/` | 文件搜索 | 在存在 embedded search tools 时自动隐藏 |
| `WebSearch` | `WebSearchTool/` | 网络搜索 | 带引用溯源 |
| `WebFetch` | `WebFetchTool/` | 抓取网页 | 支持本地缓存 |
| `Agent` | `AgentTool/` | 子代理调度 | 支持 sync/async/background、worktree/fork/remote 隔离 |
| `TaskCreate/TaskGet/TaskUpdate/TaskList` | `TaskCreateTool/` 等 | Task V2 管理 | 文件锁、阻塞关系、claimer 机制 |
| `TodoWrite` | `TodoWriteTool/` | V1 内存 Todo | 在 V2 启用时自动禁用 |
| `Skill` | `SkillTool/` | 调用 Skill | 支持参数替换和渐进式发现 |
| `AskUserQuestion` | `AskUserQuestionTool/` | 向用户提问 | 阻塞式 UI 弹窗 |
| `McpAuth/ListMcpResources/ReadMcpResource` | `McpAuthTool/` 等 | MCP 生态接入 | OAuth elicitation、资源只读 |
| `EnterPlanMode` / `ExitPlanModeV2` | `EnterPlanModeTool/` 等 | 权限模式切换 | 模型可主动进入 plan mode |

### 6.4 Verdict 评价

- **完整性**：覆盖了开发工作流的核心需求（文件、Shell、搜索、Web、子代理、Task、MCP）。
- **扩展性**：MCP 支持成熟（stdio/SSE/HTTP/WebSocket/IDE），Tool schema 动态加载；但**目前没有通用的 MCP resource write 工具**（只读）。
- **健壮性**：有并行执行控制、结果大小上限、文件外存、工具结果配对修复、 speculative permission 等机制。
- **不足**：
  - `AgentTool` 的 schema 动态裁剪（根据 feature gate 隐藏字段）增加了模型理解的不可预测性。
  - MCP 工具的结果截断和 binary 外部化在 `services/mcp/client.ts` 中集中处理，与主工具的 `maxResultSizeChars` 存在两套逻辑，可能导致不一致。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 7. Skill 详细说明

### 7.1 Skill 的分类

- **物理格式**：目录形式，如 `.claude/skills/<skill-name>/SKILL.md`，支持 YAML frontmatter。
- **作用域/类别**：
  1. **Bundled Skills**：内置在代码中的 skill（`skills/bundled/`）；
  2. **Project Skills**：来自 `.claude/skills/`（项目级）；
  3. **User/Global Skills**：来自 `~/.claude/skills/`；
  4. **Plugin Skills**：由插件提供；
  5. **MCP-derived Skills**：由 MCP server prompts 动态生成（feature-gated）；
  6. **Conditional Skills**：带有 `paths` frontmatter，仅在匹配文件被操作时激活。

### 7.2 Skill 的加载顺序

来源优先级（从高到低）：
1. 命令行 `--add-dir` 显式指定；
2. 插件提供的 skills；
3. 项目 `.claude/skills/`；
4. 用户 `~/.claude/skills/`；
5. 内置 bundled skills；
6. MCP-derived skills（动态发现时）。

支持动态发现嵌套目录：当工具操作某个文件路径时，系统会沿路径向上搜索 `.claude/skills` 并热加载未发现的 skills。

### 7.3 Skill 与 System Prompt 的映射关系

- `fetchSystemPromptParts`（`utils/queryContext.ts`）在每次 turn 开始时收集：默认 system prompt、user context、system context、激活的 skills。
- Skill 的 **name + description + when_to_use** 进入 system prompt 的 skills 列表。
- Skill 的 **完整内容** 仅在模型通过 `SkillTool` 显式调用时，或通过 slash command（`/skillName`）触发时，作为用户消息注入对话。
- 因此存在**渐进式披露**：大量 skills 不会一次性塞满 prompt，只有被调用时才展开。

### 7.4 动态 Skill 的注册、发现、注入与使用

- **发现触发条件**：
  1. 会话启动时扫描预设目录；
  2. 文件操作时沿路径向上发现（`utils/skills/skillChangeDetector.ts`）；
  3. 用户显式 `/skills add-dir`。
- **注册表/缓存**：Skills 被转换为 `Command` 对象存入 `AppState.commands`，dedup 基于 `realpath`。
- **条件 Skill 激活**：`activateConditionalSkillsForPaths` 检查 `paths` frontmatter（gitignore 风格），匹配时将该 skill 加入可用命令池。
- **Skill 与 Hook 交互**：Skill 和 Agent 的 frontmatter 均可声明 `hooks` 块，通过 `registerFrontmatterHooks.ts` 注入会话级 Hook。

### 7.5 Verdict 评价

- **完整性**：支持多来源加载、去重、条件激活、frontmatter 元数据、inline shell（`!`code blocks）。
- **Token 效率**：通过"列表进 prompt，内容按需调用"的策略，有效避免了 skill 膨胀问题。
- **扩展性**：用户只需创建目录 + SKILL.md 即可添加自定义 skill，门槛极低。
- **不足**：
  - 动态发现的路径向上遍历在 monorepo 深层目录中可能触发意料之外的 skill 加载。
  - MCP-derived skills 明确禁止 inline shell execution，安全设计合理，但限制了 MCP skill 的表达能力。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 8. Sub-Agent 详细说明

### 8.1 Sub-Agent 引擎的实现

- **是否存在专门的 Sub-Agent 调度引擎**：`tools/AgentTool/AgentTool.tsx` 是主入口，`runAgent.ts` 是核心生命周期实现。不存在独立的"调度器进程"，而是以函数调用 + AppState 任务映射的方式调度。

- **单一会话最多可同时存在或调用多少个 Sub-Agent**：
  无硬编码全局上限。AgentTool 支持 `run_in_background`，后台代理通过 `AppState.tasks` 持久化。大量并发后台代理会受限于文件描述符、MCP 连接数和 token 预算。

- **Sub-Agent 的唤醒机制**：
  - 后台代理完成后，通过 `enqueuePendingNotification` 向主会话注入系统通知（任务完成摘要）。
  - In-process teammates 通过 Mailbox/Bridge 机制（`useMailboxBridge`、`useSwarmPermissionPoller`）进行事件通知。

- **Sub-Agent 的注册与发现**：
  - **模型动态创建**：AgentTool 的 schema 允许 LLM 在运行时决定创建子代理；
  - **用户预配置**：`.claude/agents/` 或 `.claude/skills/` 中的 agent definitions 在启动时加载。

- **Sub-Agent 的分类策略**：
  - 按隔离级别：`none`（同进程）、`worktree`（git worktree 副本）、`fork`（独立子进程）、`remote`（CCR 远程会话）。
  - 按运行模式：`sync`（阻塞主会话）、`async`（后台运行）、`teammate`（swarm 协作）。

- **Sub-Agent 完成任务后如何回归主 Agent**：
  - `sync` 代理：直接通过 `ToolResult` 返回结果；
  - `async` / `background` 代理：结果写入磁盘 sidechain，主代理通过 `TaskOutputTool` 或通知消息读取；
  - `preserveToolUseResults` 为 true 的 in-process teammate 会在自身消息链中保留 `toolUseResult`，便于用户通过 sidechain 查看完整执行轨迹。

- **Sub-Agent 的注销/清理机制**：
  - `runAgent.ts` 在 generator 结束时调用 `cleanupAgentTracking`（清除 prompt cache break detection 状态）和 MCP cleanup。
  - `fork` 代理随着子进程退出自动清理。
  - `SessionEnd` Hook 在会话清除时批量执行清理。

- **Sub-Agent 的 output 是否持久化**：**是**。通过 `recordSidechainTranscript` 写入 `getAgentTranscriptPath(agentId)`（JSONL），独立于主会话的 transcript。

- **Sub-Agent 的权限管理**：
  - 默认**继承**主 Agent 的 `ToolPermissionContext`，但 `allowedTools` 参数可替换为更严格的规则集。
  - `createSubagentContext` 中 `setAppState` 被替换为 no-op（防止子代理修改主状态），只有 `setAppStateForTasks` 能触及根状态。
  - Fork 代理和 remote 代理拥有更强的文件系统隔离。

- **Sub-Agent 对 LLM 引擎的使用**：复用同一个 `query.ts` / `claude.ts`，但传入独立的 `ToolUseContext` 和 `abortController`。子代理可指定不同模型（通过 `model` 参数覆盖）。

- **Sub-Agent 的上下文管理**：
  - `fork` 代理通过 `CacheSafeParams` 复制父代理的 system prompt、user context、工具池，以**共享 prompt cache**；
  - 默认子代理复制父代理的 `messages` 作为初始历史（可配置裁剪）；
  - `contentReplacementState` 默认 clone 父状态。

- **Sub-Agent 的上下文缓存机制**：`forkedAgent.ts` 的 `saveCacheSafeParams` / `getLastCacheSafeParams` 保存父代理的缓存安全参数，fork 代理复用以保证 cache hit。

- **Sub-Agent 与主 Agent 的逻辑联动**：
  - **聊天记录合并**：in-process teammate 的 transcript 可通过 sidechain 被主代理查看；`preserveToolUseResults` 控制是否保留 tool result。
  - **状态同步**：通过 `AppState.tasks` 共享任务状态；通过 Mailbox 同步权限请求。
  - **并发冲突处理**：代码中**没有显式的文件锁或合并冲突解决机制**，多个子代理同时编辑同一文件时依赖操作系统的最后写入者胜出（潜在风险）。

### 8.2 Sub-Agent 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `tools/AgentTool/AgentTool.tsx` | 子代理工具的 schema 定义与调用分发 |
| `tools/AgentTool/runAgent.ts` | 子代理核心生命周期（MCP 初始化、queryLoop、sidechain 持久化） |
| `tools/AgentTool/forkSubagent.ts` | Fork 隔离子代理的进程管理与 cache 共享 |
| `tools/AgentTool/resumeAgent.ts` | 后台代理恢复逻辑 |
| `tools/AgentTool/agentToolUtils.ts` | 代理结果格式化、进度跟踪 |
| `utils/forkedAgent.ts` | Fork 代理的 `CacheSafeParams` 管理与上下文准备 |
| `tasks/LocalAgentTask/LocalAgentTask.tsx` | 本地后台代理任务状态机 |
| `tasks/RemoteAgentTask/RemoteAgentTask.js` | 远程 CCR 代理会话管理 |
| `tasks/InProcessTeammateTask/` | Swarm teammate 的进程内协作实现 |

### 8.3 Sub-Agent 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 调度引擎 | `AgentTool.tsx` + `AppState.tasks` | 函数级调度，无独立调度进程 |
| 生命周期管理 | `runAgent.ts` | 启动→queryLoop→清理；支持 sync/async/background |
| 上下文隔离 | `createSubagentContext` + `forkSubagent.ts` | 同进程/工作树/fork/remote 四级隔离 |
| 权限与沙盒 | `allowedTools` 覆盖 + `ToolPermissionContext` 继承 | 主状态不可写（setAppState no-op） |
| 结果回归 | `TaskOutputTool` / sidechain JSONL / 通知消息 | 后台代理通过磁盘和消息队列回归 |

### 8.4 Verdict 评价

- **完整性**：覆盖了创建、执行、持久化、恢复、清理的完整生命周期；隔离级别丰富。
- **隔离性**：`fork` 和 `remote` 的隔离较强；同进程子代理的隔离主要依赖 `setAppState` no-op 和权限规则，**内存/文件系统并未真正隔离**。
- **可观测性**：每个子代理有独立 sidechain transcript 和 perfetto tracing 注册；token 消耗通过 `accumulateUsage` 聚合。
- **不足**：
  - **并发冲突解决缺失**：多子代理同时写文件无显式协调机制。
  - **CacheSafeParams** 的设计虽然精妙，但要求 fork 代理的 system prompt 与父代理**逐字节一致**，任何 GrowthBook 热切换都可能导致 cache miss，而代码中对此仅有检测无自动修复。
  - 子代理的"后台化"阈值（120s）是硬编码的 feature-gated 常量，用户不可调。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 9. TUI 详细说明

### 9.1 TUI 引擎的实现

- **TUI 的驱动引擎**：基于 **React 18** 的自定义事件循环。`ink/` 目录包含完整的 reconciler（`reconciler.ts`）、DOM 抽象（`dom.ts`）、键盘事件系统（`events/`、`parse-keypress.ts`）和焦点管理（`focus.ts`）。本质上是 Ink 的一个深度定制 fork。

- **TUI 的渲染引擎**：
  - 使用自定义的 Yoga-like 布局引擎（`layout/`）和 ANSI 转义码输出（`output.ts`、`render-to-screen.ts`）；
  - 组件树渲染为文本缓冲区，再经 `screen.ts` 输出到 stdout；
  - 支持增量更新（通过 reconciler 的 commit 阶段），但大规模输出时仍可能全屏重绘。

- **TUI 的刷新机制**：事件触发重绘为主。`AlternateScreen` 组件控制全屏/交替屏幕缓冲区；没有固定帧率，而是依赖 React setState / store 更新驱动重新渲染。

- **TUI 的数据通讯机制**：
  - 主状态使用 **Zustand-like 自定义 store**（`state/store.ts`），通过 `useAppState` 等 Hook 订阅；
  - 键盘事件通过 Ink 的 `useInput` 分发；
  - 复杂的跨组件通讯（如权限弹窗）通过命令队列（`messageQueueManager.ts`）和系统通知实现。

- **是否支持多窗口/面板/浮层**：支持。`components/` 中有大量 Dialog、Modal、PermissionRequest 组件；`FullscreenLayout` 管理全屏覆盖层；`ScrollBox` 提供可滚动区域。

- **输入焦点管理与键盘事件路由**：`focus.ts` 实现焦点树和焦点切换；`useInput` 在组件级别订阅，REPL 中的 `PromptInput` 通过 `useInput` 捕获键盘输入；Vim 模式有独立的 `useVimInput`。

### 9.2 TUI 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `ink/reconciler.ts` | 自定义 React reconciler |
| `ink/dom.ts` / `ink/renderer.ts` | VDOM 与渲染管线 |
| `ink/screen.ts` / `ink/output.ts` | 终端屏幕管理与 ANSI 输出 |
| `ink/events/` | 键盘/鼠标事件解析与分发 |
| `ink/focus.ts` | 焦点管理器 |
| `screens/REPL.tsx` | 主 REPL 屏幕（消息列表、输入框、流式状态、权限、任务列表） |
| `components/` | 150+ React 组件（消息、权限、Diff、Spinner、TaskListV2 等） |
| `components/design-system/` | 主题化基础组件 |
| `interactiveHelpers.tsx` | Dialog 渲染辅助函数 |

### 9.3 TUI 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 驱动引擎 | 自定义 Ink fork + React 18 | 深度定制，支持 tab status OSC、hyperlinks、双向文本 |
| 渲染引擎 | `render-to-screen.ts` + `layout/` | ANSI 文本输出，Yoga-like 布局 |
| 刷新机制 | 事件驱动 + store 订阅 | 无固定帧率；依赖 React re-render |
| 数据通讯 | 自定义 store + `useInput` + 消息队列 | `messageQueueManager.ts` 处理跨 turn 的异步消息注入 |

### 9.4 Verdict 评价

- **完整性**：从输入捕获、VDOM、渲染、焦点管理到全屏/浮层，链路完整。
- **性能**：`VirtualMessageList` 虚拟化长消息列表；但 `REPL.tsx` 作为 ~5000 行的巨型组件，协调所有子系统，任何全局状态更新都可能触发大范围 re-render，在极端长会话中存在性能衰减风险。
- **可扩展性**：组件化程度高，新增 UI 组件遵循 React 模式即可；但 Ink fork 的维护由内部团队承担，外部贡献者难以修改底层渲染行为。
- **不足**：
  - `REPL.tsx` 的**上帝组件**问题严重，消息处理、流式逻辑、权限路由、后台任务、MCP 连接、Vim 模式等全部耦合其中。
  - 鼠标支持有限（`isMouseTrackingEnabled` 存在但主要用于 tmux 提示）。
  - 无障碍适配（screen reader）基本缺失。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 10. To-Do List 详细说明

### 10.1 To-Do List 引擎的实现

- **To-Do 的 parse 原理**：Claude Code 不主动 parse 模型的自然语言输出中的 todo。Todo 的更新完全由**模型显式调用工具**驱动（`TodoWriteTool` 或 `TaskCreateTool`）。

- **To-Do 在本地是如何创建与注册的**：
  - **V1（TodoWriteTool）**：存储在 `AppState.todos` 字典中，key 为 `sessionId` 或 `agentId`，值为 `TodoItem[]`。纯内存，会话结束即丢失。
  - **V2（Task V2）**：存储在 `~/.claude/tasks/<taskListId>/<taskId>.json` 文件中。使用 `proper-lockfile` 处理多代理并发写。

- **To-Do 的状态机**：V2 支持 `pending`、`in_progress`、`completed`。V1 支持更多状态（`blocked`、`cancelled` 等，由 `TodoItem` schema 定义），但当前代码中 V1 实际使用的似乎也是这三态的子集。

- **To-Do 列表如何与 Agent 的 ReAct 循环集成**：
  - 模型通过 `TaskCreateTool` 创建任务后，任务列表 UI（`TaskListV2`）自动展开；
  - 任务状态变化不会直接打断 ReAct 循环，但 `verificationNudgeNeeded`（V1）会在 tool result 中提示模型 spawn verification agent；
  - 在上下文压缩时，todos/tasks 作为 AppState 的一部分被保留，不进入 API messages，因此**不会占用 prompt tokens**。

- **To-Do 的更新与维护机制**：模型自主调用 `TaskUpdateTool` 更新状态；V2 支持 `blocks`/`blockedBy` 依赖关系，`claimTask` 支持原子性的任务认领（带 agent 忙碌检查）。

- **To-Do 的持久化格式、路径与触发时机**：V2 为 JSON 文件，每次 `createTask`/`updateTask` 时 `writeFile`；V1 无持久化。

- **是否支持子任务嵌套、依赖关系、优先级排序或截止日期**：
  - V2 显式支持 **依赖关系**（`blocks`/`blockedBy`）；
  - 不支持子任务嵌套、优先级排序、截止日期。

### 10.2 To-Do List 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `tools/TodoWriteTool/TodoWriteTool.ts` | V1 内存 Todo 工具 |
| `utils/todo/types.ts` | V1 Todo 的 Zod schema |
| `utils/tasks.ts` | V2 Task 核心（CRUD、锁、依赖、高水位线） |
| `tools/TaskCreateTool/TaskCreateTool.ts` | 创建 V2 Task |
| `tools/TaskUpdateTool/TaskUpdateTool.ts` | 更新 V2 Task |
| `tools/TaskListTool/TaskListTool.ts` | 列出 V2 Task |
| `tools/TaskOutputTool/TaskOutputTool.tsx` | 读取后台任务输出 |
| `components/TaskListV2.tsx` | V2 Task 列表 UI |

### 10.3 To-Do List 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| Parse 引擎 | 无需 parse，纯工具调用驱动 | 模型主动调用 |
| 创建注册 | `AppState.todos` (V1) / `~/.claude/tasks/` (V2) | V2 文件锁保证并发安全 |
| 状态维护 | 模型通过 `TaskUpdateTool` 自主维护 | `claimTask` 提供原子认领 |
| 持久化 | V2 JSON 文件，V1 无持久化 | `resetTaskList` 带高水位线防止 ID 复用 |

### 10.4 Verdict 评价

- **完整性**：V2 覆盖了创建、更新、列表、读取、依赖、并发锁定的生命周期。
- **集成度**：与 Agent 循环结合自然（模型自主调用），且不占用 prompt tokens。
- **可靠性**：V2 的文件锁设计在 swarm 场景下可靠；V1 的内存模式过于脆弱。
- **不足**：
  - V1 与 V2 双轨并行增加了认知负担，V1 在交互模式下已被禁用（`isTodoV2Enabled()` 在交互模式下为 true），但代码仍保留。
  - 不支持子任务、优先级、截止日期，对于复杂项目管理能力不足。
  - `TaskOutputTool` 在 ant builds 中被标记为 deprecated，说明任务结果的读取路径仍在演进中。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 11. CLI Permission 与执行模式详细说明

### 11.1 CLI Permission 引擎的实现

- **是否存在 plan-mode / edit-mode / auto-mode / yolo-mode 等执行模式**：**是**。`utils/permissions/PermissionMode.ts` 定义了以下模式：
  - `default`：敏感工具需用户确认；
  - `plan`：只读模式，禁止写操作和 Shell；
  - `acceptEdits`：自动接受文件编辑，但仍确认 Shell；
  - `auto`（ant-only，feature-gated）：基于分类器的自动审批；
  - `bypassPermissions` / `dontAsk`：全自动通过（危险，UI 以 error 色高亮）。

- **模式切换的引擎**：
  1. 用户显式命令（`/permissions`、`/plan`）；
  2. 模型调用 `EnterPlanModeTool` / `ExitPlanModeTool`；
  3. 自动推断（如 `auto` 模式的分类器输出）；
  4. CLI 启动参数（`--permission-mode`）。

- **权限分层模型**：按工具类型分层：文件读取、文件写入（edit/write）、Shell 执行（bash/powershell）、网络请求（web_fetch/web_search）、MCP 调用、代码执行（REPL）、敏感操作（git push、PR 创建）。规则可精确到 `Bash(git *)` 这种带参数的模式。

- **不同模式下对工具调用的行为差异**：
  - `plan` 模式下所有非只读工具被 blanket deny；
  - `auto` 模式下分类器（yoloClassifier、bashClassifier）预筛高风险操作，低风险的自动通过；
  - `bypassPermissions` 下 `canUseTool` 直接返回 `allow`。

- **是否存在 Guardian / Policy / Approval 中间件**：**是**。`utils/permissions/permissions.ts` 中的 `canUseTool` 是统一中间件，流程为：
  1. `validateInput`；
  2. 显式规则匹配（alwaysAllow / alwaysDeny / alwaysAsk）；
  3. `PreToolUse` Hook；
  4. 模式约束（如 plan mode deny）；
  5. 分类器（auto mode）；
  6. 工具专属 `checkPermissions`；
  7. UI 弹窗确认（REPL 路径）。
  企业策略还可通过 `services/policyLimits/` 进一步限制可用模式。

- **权限拒绝或拦截后的恢复路径**：
  - 单条工具被拒绝时，向模型返回 `tool_result` 说明拒绝原因，模型可调整策略继续；
  - `OrphanedPermission` 支持恢复被意外中断的权限请求；
  - 连续多次拒绝可触发 fallback 到更保守的模式（`checkAndDisableBypassPermissionsIfNeeded`）。

### 11.2 CLI Permission 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `utils/permissions/PermissionMode.ts` | 模式定义、颜色、外部映射 |
| `utils/permissions/permissions.ts` | 核心审批管道 (`canUseTool`) |
| `utils/permissions/PermissionResult.ts` | `allow`/`ask`/`deny` 结果类型 |
| `utils/permissions/PermissionRule.ts` | 规则数据结构 |
| `utils/permissions/permissionSetup.ts` | CLI 启动时的权限初始化 |
| `utils/permissions/permissionsLoader.ts` | 规则持久化加载 |
| `utils/permissions/autoModeState.ts` | Auto mode 分类器状态 |
| `utils/permissions/bashClassifier.ts` | Bash 专用分类器 |
| `utils/permissions/yoloClassifier.ts` | YOLO 通用分类器 |
| `utils/permissions/bypassPermissionsKillswitch.ts` | 危险模式的熔断降级 |
| `components/permissions/PermissionRequest.tsx` | UI 权限请求路由器 |
| `services/policyLimits/index.ts` | 企业策略限制 |

### 11.3 CLI Permission 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 模式引擎 | `PermissionMode.ts` + `EnterPlanModeTool` | 支持模型主动进入 plan mode |
| 权限分层 | `permissions.ts` 的 7 步管道 | 规则→Hook→分类器→UI |
| 审批中间件 | `canUseTool` (React hook + 函数) | SDK 路径与 REPL 路径复用同一核心逻辑 |
| 安全策略 | `policyLimits/` + `bypassPermissionsKillswitch.ts` | 企业可覆盖；危险模式有自动降级 |

### 11.4 Verdict 评价

- **完整性**：从模式切换、规则引擎、Hook 拦截、分类器、UI 确认到企业策略，链路完整。
- **安全性**：明确的信任边界（workspace trust）、最小权限原则（`allowedTools` 可替换父规则）、多层 failsafe（分类器不可用时 fails closed）。
- **用户体验**：Plan mode 是模型可主动进入的协作式流程；auto mode 减少了高频低风险操作的打断。
- **不足**：
  - `auto` 模式目前为 **ant-only**（内部 dogfooding），外部用户无法使用，限制了自动化场景的体验。
  - `bypassPermissions` 和 `dontAsk` 虽然视觉上以 error 色警告，但仍允许一键启用，对新手用户存在误触风险。
  - 权限规则的参数级匹配（如 `Bash(rm -rf /)`）依赖字符串模式，对复杂 JSON 输入的工具缺乏结构化匹配能力。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 12. API 接口处的缓存安排

- **是否实现了 Prompt Cache（如 Anthropic 的 prompt caching）？**
  **是，且是核心架构假设。** `claude.ts` 中 `addCacheBreakpoints` 在 system prompt 和消息链特定位置注入 `cache_control: { type: 'ephemeral' }`。缓存策略根据 `querySource`（主线程/子代理/compact）动态调整。

- **是否有 Cache 断点检测（cache break detection）或 Cache 命中率监控？**
  `promptCacheBreakDetection.ts` 维护了一个 `previousStateBySource` Map，对 system prompt hash、工具 schema hash、beta 头、模型、fast mode 状态等进行逐请求比对。若检测到未预期的 cache read token 骤降（>2000 tokens），会生成 diff 文件到临时目录，并上报 `tengu_prompt_cache_break_detected` 事件。

- **压缩、修改 system prompt、工具变更时，是否有意识地去保护或重建 cache？**
  - **保护**：`sticky-on` latch（`setAfkModeHeaderLatched`、`setFastModeHeaderLatched`、`setCacheEditingHeaderLatched`）确保一旦某 beta 头被发送，后续请求不再移除，避免 mid-session toggle 破坏 cache key。
  - **重建**：`microCompact.ts` 的 `cache_edits` 功能（ant-only）允许在不重写 prompt 前缀的情况下删除旧内容，保护已有 cache。
  - **压缩后**：`postCompactCleanup.ts` 重新注入 skills，但限制每 skill 5000 tokens，防止重建时过度膨胀。

- **是否有其他 API 层面的优化（如请求合并、批量工具结果、token 估算预检）？**
  - Token 估算：`utils/tokens.ts` 提供 `tokenCountWithEstimation`，在 API usage 不可用时进行 heuristic 估算。
  - 批量工具结果：同一轮 assistant message 中的多个 tool_use 并行执行，结果一次性批量注入。
  - 请求合并：未观察到显式的多请求合并机制。

---

## 13. 对不同 LLM 模型的逻辑安排

- **支持哪些模型/提供商？**
  - **模型**：Claude 系列（Haiku、Sonnet、Opus 及其变体）。`utils/model/model.ts` 中有详细的别名解析（`getDefaultSonnetModel`、`getDefaultOpusModel` 等）。
  - **提供商**：Anthropic 官方 API、AWS Bedrock、GCP Vertex AI、Azure Foundry。

- **是否存在 Provider 抽象层？**
  存在，但较薄。`services/api/client.ts` 的 `getAnthropicClient` 根据环境变量选择不同的 SDK 包装器（`AnthropicBedrock`、`AnthropicVertex`、`AnthropicFoundry`），但统一返回 `Anthropic` 类型实例。真正的 API 调用代码（`claude.ts`）对 provider 基本透明。

- **针对不同模型是否有特殊处理？**
  - `thinking` 配置：自适应 thinking 仅对部分模型启用；不支持 thinking 的模型会完全禁用。
  - `max_output_tokens`：不同模型有不同上限（`utils/context.ts`）。
  - `tool_search` / `structured_outputs` / `fast_mode`：均有 `modelSupportsXxx` 检查。
  - Bedrock 需要额外 `betas`（`getBedrockExtraBodyParamsBetas`）。
  - 1M 上下文实验（`CONTEXT_1M_BETA_HEADER`）按模型动态注入。

- **是否支持模型自动切换或降级（fallback）？**
  **支持。** `withRetry.ts` 中的 `FallbackTriggeredError` 可在特定错误（如上下文过长）时触发模型降级。`fallbackModel` 参数从 `QueryEngineConfig` / `QueryParams` 一路传递到重试层。

---

## 14. 其他 Agent-Specific 优势、亮点与效率提升

### 14.1 架构亮点

- **编译期死码消除**：通过 `feature('FLAG')`  from `bun:bundle` 和条件 `require()`，ant-only 或实验性功能在对外构建时被完全剥离，保持发布包精简。
- **单一 truth source 的 message 类型**：`types/message.ts` 强类型区分了 API-facing message 与 UI-only message（如 ProgressMessage），配合 `normalizeMessagesForAPI` 在编译期保证 UI 状态不会泄漏到 LLM prompt。
- **QueryEngine / REPL 双路径**：核心逻辑（`query.ts`、`QueryEngine.ts`）与交互式 UI（`REPL.tsx`）解耦，使得同一套 Agent 引擎可同时服务于 CLI 交互和 SDK/headless 调用。

### 14.2 性能与效率

- **并行工具执行**：`isConcurrencySafe` 让安全的读操作（Read/Glob/Grep）并行运行，显著降低多文件分析任务的 latency。
- **Prompt Cache 深度优化**：sticky-on latch、cache_edits、global cache scope 三重机制，使得长会话的 API latency 和成本得到有效控制。
- **文件状态缓存**：`fileStateCache`（LRU）避免同一文件在短时间内被反复读取。
- **流式 idle watchdog**：防止网络静默断开导致会话无限挂起。

### 14.3 安全与沙盒

- **多层权限管道**：规则 + Hook + 分类器 + UI + 企业策略，五层 failsafe。
- **SandboxManager**：为 Bash/PowerShell 提供额外的隔离层（网络访问限制、RCE 黑名单）。
- **Workspace Trust**：所有 Hooks、插件、MCP 配置均依赖用户显式信任工作区。
- ** speculative permission**：Bash 工具在真正执行前可进行 speculative 检查，提前拦截危险命令。

### 14.4 开发者体验

- **丰富的可观测性**：`tengu_*` 系列 analytics 事件、`queryProfiler` 打点、`perfettoTracing` 支持，便于定位长链路中的性能瓶颈。
- **会话恢复**：JSONL transcript + `loadTranscriptFromFile` + `conversationRecovery` 支持从任意点恢复会话，甚至跨 worktree/teleport。
- **Skill 热重载**：`useSkillsChange` 监听 skill 目录变更，开发 skill 时无需重启 CLI。

### 14.5 独特功能

- **Claude-in-Chrome MCP**：将本地 Chrome 浏览器作为 MCP server，使 Claude Code 具备实时网页浏览能力（`CLAUDE_IN_CHROME_MCP_SERVER_NAME`）。
- **Agent Swarms / Teammates**：`InProcessTeammateTask` 和 `TeamCreateTool` 支持多 agent 协作，Leader-Worker 架构通过 Mailbox 同步权限和消息。
- **Teleport 会话迁移**：支持将会话从本地迁移到远程 CCR 环境，或反之，保持上下文和文件状态一致。

---

## 总体评分

| 维度 | 评分 (1-5) | 一句话总结 |
|------|------------|------------|
| LLM 请求方式 | 5 | 认证-请求-重试-缓存-持久化全链路成熟，可观测性极强 |
| Hooks | 5 | 生命周期覆盖极广，扩展方式多样，安全信任检查完善 |
| 上下文管理 | 5 | 多级压缩策略完备，prompt cache 优化深入 |
| Tool Use | 5 | 内建工具丰富，MCP 集成成熟，并行执行与结果截断机制完善 |
| Skill 管理 | 5 | 渐进式披露、条件激活、热重载，token 效率与扩展性俱佳 |
| Sub-Agent | 4 | 生命周期与隔离策略丰富，但并发冲突解决与同进程内存隔离仍有短板 |
| TUI | 4 | 自定义 Ink 功能强大，但 REPL.tsx 过于上帝组件，长期维护压力大 |
| To-Do List | 4 | V2 文件锁与依赖关系设计优秀，但不支持子任务/优先级，且 V1/V2 双轨并存 |
| CLI Permission | 5 | 多层审批管道与企业策略完备，auto-mode 体验领先（ant-only 略显遗憾） |
| API 缓存 | 5 | Prompt Caching 是架构级核心假设，cache break detection 与 sticky latch 设计精妙 |
| 多模型支持 | 4 | Provider 抽象层较薄，模型本质上仍局限于 Claude 生态，但 fallback 与特性适配完善 |
| 整体工程成熟度 | 5 | 代码规模巨大但类型安全、测试分支、编译期裁剪、可观测性均达到生产级顶尖水准 |

### 最终客观评价与辩证分析

- **核心优势**：Claude Code 在 **上下文管理、权限安全、Prompt Cache 优化** 三个维度上形成了强大的协同效应。多级压缩 + cache break 检测 + sticky latch 使得长会话既经济又快速；多层权限管道让自动化与安全性不再是非此即彼；而 `QueryEngine` / `REPL` 双路径设计则确保了同一引擎能同时服务人机交互与程序化集成。此外，对 MCP 生态的深度整合（stdio/SSE/HTTP/WebSocket/Chrome）使其在工具扩展性上领先同期竞品。

- **明显短板**：
  1. **架构债务**：`REPL.tsx`（~5000 行）和 `claude.ts`（~3400 行）承担了过多职责，上帝组件问题显著。随着功能持续堆叠，这两个文件的修改风险和回归测试成本将指数级上升。
  2. **子代理隔离的半开状态**：同进程子代理虽然通过 `setAppState` no-op 做了一定保护，但内存、文件系统、全局单例（如 `previousStateBySource`）并未真正隔离。并发编辑同一文件时缺乏显式冲突解决。
  3. **模型生态的封闭性**：虽然支持 Bedrock/Vertex/Foundry 等多种部署渠道，但 API 层本质上仍围绕 Anthropic Messages API 设计，换用非 Claude 模型（如 GPT-4o、Gemini）需要大量适配工作。

- **适用场景**：
  - **中大型 monorepo 开发**：Glob/Grep/并行 Read 与 FileEdit 的组合非常适合大规模代码库探索与重构。
  - **长会话复杂任务**：得益于顶尖的 prompt cache 和上下文压缩，Claude Code 在需要数十轮交互的复杂调试、架构设计中表现优异。
  - **多 Agent 协作（Swarm）**：Leader-Worker 模式适合需要分解给多个子任务并行执行的运维、测试、文档生成场景。
  - **不适合**：对模型选择有强开放性要求的场景、需要深度 GUI 自动化（非 Web）的场景、以及完全无网络/无 API 访问的内网环境。

- **发展建议**：
  若要提升整体工程成熟度，**最优先应拆解 `REPL.tsx` 和 `claude.ts`**。将 REPL 拆分为消息列表、输入处理、后台任务面板、权限路由等独立 coordinator 组件；将 `claude.ts` 的请求构建、流式消费、缓存管理拆分为独立模块。其次是**补全同进程子代理的隔离能力**（如引入文件级乐观锁或基于操作日志的合并策略），以释放 Swarm 场景在写操作上的潜力。

- **横向对比定位**：
  与 Codex（OpenAI）相比，Claude Code 的 **上下文压缩与缓存效率** 明显更优，更适合长会话；与 mini-agent 等轻量框架相比，Claude Code 的 **TUI、权限系统、MCP 集成** 是重武器级别的完整方案。其独特生态位是：**面向专业开发者的、支持超长上下文和多 Agent 协作的重量级编码助手 CLI**。它不是"最小可用"的 Agent 框架，而是将 IDE 级别的功能（LSP、Diff、Undo、Task 管理）压缩进终端的"终端原生智能体操作系统"。
