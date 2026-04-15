# Agent CLI 深度分析模板

> 分析对象: `anthropics/claude-code` (Node/TypeScript 运行时)
> 分析时间: `2026-04-15`
> 分析者: `Claude Opus 4.6 (1M context)`
> 文件位置: `context/claude-code/`

---

## 1. 技术栈

| 维度 | 技术选型 |
|------|----------|
| **核心语言** | TypeScript + JSX (Ink/React) |
| **运行时 / 框架** | Node.js；`@anthropic-ai/sdk` 作为主 LLM 客户端；Ink 为 TUI 框架（但**自带一份 fork**放在 `ink/` 子目录，而非 npm 依赖）；Yoga 布局引擎 (`native-ts/yoga-layout/`) |
| **包管理 / 构建工具** | 看起来是 Bun 风格 bundle（`feature()` 条件编译、`import()` 动态加载用于环切断循环依赖）；入口 `entrypoints/cli.tsx` 与 `main.tsx` |
| **UI / CLI 库** | 自带 Ink reconciler (`ink/reconciler.ts`, `ink/dom.ts`, `ink/output.ts`, `ink/render-to-screen.ts`, `ink/focus.ts`, `ink/termio/`)；React 18+ + React Compiler runtime；Yoga Flexbox |
| **LLM SDK / API 客户端** | `@anthropic-ai/sdk`、`@anthropic-ai/bedrock-sdk`、`@anthropic-ai/vertex-sdk`、`@anthropic-ai/foundry-sdk`（按 env 动态选择）；以 `anthropic.beta.messages.create({stream:true}).withResponse()` 作为主调用面 |
| **配置解析** | `~/.claude/settings.json`（user）、`.claude/settings.json`（project）、`.claude/settings.local.json`（local）、policy settings（企业 MDM 下发）；YAML frontmatter 解析 SKILL.md / agent 定义 |
| **测试框架** | 仓库里看不到独立 test runner 导入；测试基础设施依托自写 utils，实际可运行的测试不在这份快照里 |
| **其他关键依赖** | `@anthropic-ai/sandbox-runtime`（文件系统与网络的"监控层"沙盒）；GrowthBook feature gate；Zustand 风格自写 store；Zod schema；lockfile；ansi 工具 |

> 这是一份以 **TypeScript / React / Ink** 为骨架的 CLI：它把前端 (TUI 组件)、中间层 (state/store + hooks) 与后端 (services/api/、utils/) 组织成类似"终端 Web app"的结构。与 Rust workspace 的 codex 形成鲜明对照——这里的抽象单位是"React 组件 + hook"而非"crate + trait"。

---

## 2. 目录结构

```
context/claude-code/
├── entrypoints/
│   ├── cli.tsx                  # CLI 主入口
│   └── sdk/                     # 对外 SDK
├── main.tsx                     # 顶层 React 树挂载
├── QueryEngine.ts               # 顶层 query 执行引擎
├── query.ts / query/            # 主 agent loop (消息归一化、system prompt、工具分发)
├── Task.ts                      # Task 抽象 (本地 bash / local agent / remote agent / in-process teammate / workflow / monitor)
├── Tool.ts                      # Tool 接口 + ToolResult 模型
├── tools.ts                     # 工具注册与组装
├── tools/                       # 全部 40+ 内建工具 (AgentTool / BashTool / FileEdit / TodoWrite / Task* / Skill / …)
├── services/
│   ├── api/
│   │   ├── client.ts            # Anthropic / Bedrock / Vertex / Foundry 多 provider 客户端
│   │   ├── claude.ts            # queryModel 流式主入口 + paramsFromContext + 系统 prompt 缓存
│   │   ├── withRetry.ts         # 指数退避 + jitter + Retry-After + 持久重试模式
│   │   └── promptCacheBreakDetection.ts   # Prompt cache 命中/断裂检测
│   ├── compact/                 # autoCompact / microCompact / apiMicrocompact / sessionMemoryCompact
│   ├── mcp/                     # MCP client 与多种 transport
│   └── oauth/                   # Claude.ai OAuth 会话
├── utils/
│   ├── hooks/                   # 真正的 Hooks 系统 (AsyncHookRegistry, execAgentHook, execHttpHook, execPromptHook, ssrfGuard, registerSkillHooks)
│   ├── permissions/             # 权限模式、规则、危险命令分类器、auto-mode classifier
│   ├── sandbox/                 # sandbox-runtime 适配层
│   ├── skills/                  # skill 变更检测
│   ├── claudemd.ts              # CLAUDE.md 发现与加载
│   ├── todo/                    # TodoList 类型
│   ├── planModeV2.ts            # Plan Mode v2 (多 agent 的 interview + 分阶段生成)
│   ├── ultraplan/               # ultraplan 实验性规划
│   ├── forkedAgent.ts           # 子 agent fork（cache-safe params、child abort controller）
│   └── standaloneAgent.ts       # 独立 agent 入口
├── skills/                      # bundled skill 定义 + loadSkillsDir.ts + mcpSkillBuilders.ts
├── hooks/                       # React hooks (TUI 驱动)，与 utils/hooks 完全不同
├── state/                       # AppState / store / AppStateProvider
├── components/                  # 100+ 个 Ink/React UI 组件
├── screens/                     # REPL / ResumeConversation / Doctor
├── ink/                         # 自带 Ink 实现 (reconciler/dom/output/focus/render-to-screen/termio/)
├── commands/                    # slash 命令实现 (/commit, /plan, /model, /permissions, /hooks, …)
├── native-ts/                   # Yoga layout native bindings
├── coordinator/                 # 多 agent 协作 / swarm
├── tasks/                       # LocalAgentTask / RemoteAgentTask / InProcessTeammateTask
├── history.ts                   # ~/.claude/history.jsonl
└── …
```

> 注意：`hooks/` 与 `utils/hooks/` 名字相同但**职责完全不同**——前者是 React 的"组件级 hook"（如 `useMainLoopModel`、`useTextInput`），后者才是 Claude Code 面向用户的 **Hooks 系统**（`PreToolUse` / `PostToolUse` / …）。本文所有对"Hook"一词的引用，除非明说是 React，都指 `utils/hooks/` 下的系统。

---

## 3. LLM 请求方式详细说明

### 3.1 LLM 请求引擎的实现

- **认证**：`services/api/client.ts` 中的构造器按优先级依次尝试——(1) claude.ai OAuth token (`getClaudeAIOAuthTokens()?.accessToken`)；(2) `ANTHROPIC_API_KEY`；(3) `ANTHROPIC_AUTH_TOKEN`；(4) `apiKeyHelper` 脚本出参；(5) provider 专属凭证 (AWS IAM/STS、GCP GoogleAuth、Azure DefaultAzureCredential)。每次请求前还会调用 token refresh (`client.ts:131-133`)。header 侧注入 `x-app: cli`、`X-Claude-Code-Session-Id`、`User-Agent`、`x-anthropic-additional-protection`，并允许 `ANTHROPIC_CUSTOM_HEADERS` 追加自定义 header。
- **入口封装**：面向 agent loop 的"一次模型调用"入口是 `queryModel()` (`services/api/claude.ts:1017` 附近)；它派生出 `queryModelWithStreaming()` 与 `queryModelWithoutStreaming()`，再由 `query.ts`/`QueryEngine.ts` 的顶层 agent loop 使用。实际发请求的那一行是：
  ```ts
  const result = await anthropic.beta.messages
      .create({ ...params, stream: true }, { signal, headers })
      .withResponse();
  ```
- **流式 vs 非流式**：**强制流式**。非流式模式也是"等流式收完后返回最终 AssistantMessage"。有一个 90 秒的 idle watchdog (`CLAUDE_STREAM_IDLE_TIMEOUT_MS`, claude.ts:1874) 专门处理"连接没断但几十秒没新 chunk"的僵死场景。
- **请求体构建**：`paramsFromContext()` (`claude.ts:1538-1760`) 把当前会话压平为 `beta.messages.create` 的参数：`model`、`messages` (经 `normalizeMessagesForAPI`)、`system` (由 `buildSystemPromptBlocks()` 逐块带 cache_control)、`max_tokens`、`thinking` (自适应或 `budget_tokens`)、`tools` (`toolToAPISchema()`)、`betas` (beta header 列表)、`output_config`、`metadata`、`extra_body_params`。关键是**每个 system block 独立挂 `cache_control`**（而不是"一个 global 断点"），这给了上下游变更时精细保护缓存的空间。
- **响应解析**：消费 `Stream<BetaRawMessageStreamEvent>` 的 `message_start` / `content_block_start` / `content_block_delta` / `message_delta` / `message_stop` 等事件；`content_block_delta` 里分别处理文本 delta、tool input JSON delta、thinking block；`usage` 的 `cache_creation_input_tokens`、`cache_read_input_tokens` 在 `services/api/logging.ts` 里累加。
- **重试**：`services/api/withRetry.ts` 是本项目**最工程化的单文件之一**——500ms × 2^(n-1)、上限 32s、±25% jitter、默认最多 10 次 (`CLAUDE_CODE_MAX_RETRIES` 可覆盖)；**显式读取 `Retry-After`** 以及 Anthropic 专属的 `anthropic-ratelimit-unified-reset` Unix 时间戳；按状态码分类 (429/529/408/409/5xx/连接错误)；非前台任务对 529 直接放弃；连续 3 次 529 会触发 **Opus → 更小模型的 fallback** (`tengu_api_opus_fallback_triggered`)；ant 内部用户有一个"持久重试模式" (`CLAUDE_CODE_UNATTENDED_RETRY`)，最长重试 6 小时，每 30s 一次心跳式 `SystemAPIErrorMessage` 保活；连接错误、max_tokens 溢出（客户端自动降 max_tokens 再试）也都被独立分支处理。
- **Prompt 缓存**：除了前面说的"per-block `cache_control`"，还有专门的 `promptCacheBreakDetection.ts`：预请求阶段 `recordPromptState(snapshot)` 对 system/tools/betas/cache_control/effort/extra_body 打 hash；响应阶段 `checkResponseForCacheBreak()` 看 `cache_read_input_tokens` 是否相对上一轮跌幅 >5% 且绝对值 >2000，若是则触发 `tengu_prompt_cache_break` 事件、并能自动区分"是 TTL 到期"还是"某个字段变了"。同时支持 **1 小时 TTL**（`should1hCacheTTL()`：ant / 订阅用户 / GrowthBook 命中，latched 于 session bootstrap 避免 cache key 来回翻转）以及 Bedrock 上的 `ENABLE_PROMPT_CACHING_1H_BEDROCK` 开关。
- **持久化**：`~/.claude/history.jsonl` 作为全局跨项目的"用户输入历史"存档 (`history.ts:115,299,319`)；每行是 `{input, context?, timestamp?, pastedContents}`，走 lockfile 安全写入、0o600 权限。会话 transcript 则由 `utils/sessionStorage.ts` 的 `recordTranscript()` 负责，按 session 与 sub-agent 分文件写入；`flushSessionStorage()` 在进程退出时清盘。

### 3.2 LLM 请求代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `services/api/client.ts` | 多 provider 客户端构造、OAuth/API key/Bedrock/Vertex/Foundry 切换、header 注入 |
| `services/api/claude.ts` | `queryModel` 主入口、`paramsFromContext`、system prompt block + cache_control、流式事件解析 |
| `services/api/withRetry.ts` | 指数退避 + jitter + Retry-After + 持久重试 + Opus→fallback |
| `services/api/promptCacheBreakDetection.ts` | Prompt cache hash / break 检测 / TTL 分类 |
| `services/api/logging.ts` | `tengu_api_*` 事件、usage 累加 |
| `services/compact/microCompact.ts` + `apiMicrocompact.ts` | cache_edits 删除块 + 服务端 `context_management` 策略 |
| `query.ts` / `QueryEngine.ts` | agent loop、消息归一化、工具分发 |
| `history.ts` | `~/.claude/history.jsonl` 持久化 |
| `utils/sessionStorage.ts` | 会话 transcript 持久化 |
| `utils/auth.ts` / `utils/authPortable.ts` | API key 发现与保存 |
| `services/oauth/*` | Claude.ai OAuth |

### 3.3 LLM 请求子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 认证机制 | OAuth first → env key → helper → 第三方 provider 凭证 | 5 级优先，跨 provider 统一 |
| API Wrapper | `anthropic.beta.messages.create({stream:true}).withResponse()` | 以 SDK 原生流式为基础 |
| 重试机制 | 500ms × 2^n（上限 32s）、±25% jitter、Retry-After、持久模式、模型 fallback | 同类中最细致 |
| 本地缓存 | Prompt cache per-block `cache_control` + 1h TTL + break detection | 真正用好 Anthropic 缓存的一家 |
| Session 持久化 | `~/.claude/history.jsonl` + per-session transcript | 两层：输入历史 + 完整 transcript |
| 聊天记录结构 | `UserMessage / AssistantMessage / AttachmentMessage / ToolUseSummaryMessage / TombstoneMessage` | 变体覆盖 tombstone 便于压缩后"墓碑化" |

### 3.4 Verdict 评价

- **完整性**：认证、请求、重试、缓存、持久化全链路，并且每一环都有专门的子模块支撑。
- **可靠性**：`withRetry.ts` 是亮点——显式处理 `Retry-After`、持久重试、Opus → fallback、max_tokens 自适应，远高于同类；idle watchdog 对"无 chunk 僵死"这种罕见但极恶心的场景有覆盖。
- **可观测性**：`tengu_api_*` 事件族 + `promptCacheBreakDetection` 的 root-cause 解释 + usage 跟踪；整个 LLM 层几乎每个关键分支都会打点。
- **不足**：(1) 客户端缓存命中率没有专门 UI 面板（只落 telemetry）；(2) session transcript 的存储格式没有像 codex rollout 那样正式化为"可 resume 的 JSONL schema"；(3) 对非 Anthropic provider，1h TTL 的 gating 是手动开关而不是自动探测。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 4. Hooks 详细说明

### 4.1 引擎的实现

- **注册与发现**：由 `utils/hooks/hooksConfigManager.ts` 负责，从 **4 层 settings** (userSettings / projectSettings / localSettings / policySettings) 收集 hooks，并叠加 **plugin-provided hooks** 与 **session hooks** (`registerSkillHooks`、`registerFrontmatterHooks` 在 skill/agent 被触发时动态注入)。policy 层有两个熔断开关：`allowManagedHooksOnly`（只跑管控层 hook）与 `disableAllHooks`（全关，连 managed 也关）。
- **调度器**：`AsyncHookRegistry.ts` + `hookHelpers.ts` 维护事件→handler 的分发；每个事件有独立的 `exec*Hook` 执行器 (shell / prompt / HTTP / agent)，并按 matcher 筛选出适用 handler 后 **并发或顺序执行**，取决于事件语义。
- **执行模式**：共 **4 种**。
  1. **Shell 命令** (`type: "command"`)：走 `ShellCommand`，可指定 bash/powershell、timeout、`statusMessage`、`once`、`async`、`asyncRewake`。
  2. **Prompt** (`type: "prompt"`, `execPromptHook.ts`)：直接打一个 LLM query (默认 small/fast model，也可 `hook.model` 覆写)，期望返回 `{ok: boolean, reason?: string}`，默认 30s timeout。
  3. **HTTP** (`type: "http"`, `execHttpHook.ts`)：POST JSON 到指定 URL；URL 需要通过 `allowedHttpHookUrls` 白名单；header 里允许 `$VAR_NAME` 但只能引用 `httpHookAllowedEnvVars` 白名单内的环境变量；调用 `ssrfGuard.ts` 阻止私有 IP (10/8、172.16-31/12、192.168/16、169.254/16、100.64-127/10、0/8)，但**放行 127/8 loopback**（允许本地 dev 用）。默认 10 分钟超时——这个值比其他三种模式都激进得多，因为 HTTP hook 常用来做"批审核"这类长任务。
  4. **Agent** (`type: "agent"`, `execAgentHook.ts`)：起一个有工具的 mini agent 去"验证"prompt 里的条件，通过结构化输出 tool 返回 `{ok, reason?}`；`maxTurns = 50`、默认 60s 超时；自动禁用 `SubagentStart`、plan-mode、结构化输出重复等工具以避免死循环。
- **影响主流程**：通过返回值 + exit code + JSON `hookSpecificOutput` 影响主流程。Exit 2 = 阻断性错误（stderr 返回给模型或直接拦截）；其他非零 = 非阻断性错误（只给用户看）。JSON 的 `hookSpecificOutput` 按事件类型开放不同字段，最丰富的是 `PreToolUse`（`permissionDecision` / `updatedInput` / `additionalContext`）与 `PermissionRequest`（`decision: {behavior, updatedInput, updatedPermissions}`）。
- **安全层**：(1) SSRF 守卫；(2) URL 白名单；(3) env var 白名单；(4) workspace trust 对话（交互模式下必过，SDK 模式跳过）；(5) policy 级别的 `allowManagedHooksOnly` / `disableAllHooks`；(6) HTTP header 的 `$VAR` 替换只在 allowlist 内。

### 4.2 Hooks 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `utils/hooks/hooksConfigManager.ts` | 4 层 settings + plugin + session 合并、`captureHooksConfigSnapshot` |
| `utils/hooks/hooksSettings.ts` / `hooksConfigSnapshot.ts` | 快照与配置类型 |
| `utils/hooks/AsyncHookRegistry.ts` | 运行时事件分发 |
| `utils/hooks/hookEvents.ts` | 事件元数据、matcher 字段 |
| `utils/hooks/execAgentHook.ts` | Agent 模式执行器 |
| `utils/hooks/execHttpHook.ts` | HTTP 模式执行器 + 白名单/timeout |
| `utils/hooks/execPromptHook.ts` | Prompt 模式执行器 |
| `utils/hooks/hookHelpers.ts` | matcher、命令派发、shell 复用 |
| `utils/hooks/ssrfGuard.ts` | 私有 IP 守卫 |
| `utils/hooks/apiQueryHookHelper.ts` | LLM 调用前后的 hook 挂钩 |
| `utils/hooks/postSamplingHooks.ts` | 采样后 hook (如 transcript 回写) |
| `utils/hooks/sessionHooks.ts` | session 级动态 hook 注册 |
| `utils/hooks/registerSkillHooks.ts` | skill 触发时把 frontmatter hooks 注册为 session hook |
| `utils/hooks/registerFrontmatterHooks.ts` | 通用 frontmatter → hook 转换 |
| `utils/hooks/fileChangedWatcher.ts` | `FileChanged` 事件的 fs watcher |
| `utils/hooks.ts` | 顶层 `runHooks` + matcher |

### 4.3 全部 Hook 说明

| Hook 名称 | 触发时机 | Matcher | 主要输出影响 |
|-----------|----------|---------|--------------|
| `PreToolUse` | 工具执行前 | `tool_name` (exact / `A\|B` / 正则) | `permissionDecision` / `updatedInput` / `additionalContext`；exit 2 阻断 |
| `PostToolUse` | 工具成功返回后 | `tool_name` | `additionalContext`、`updatedMCPToolOutput` (替换 MCP 返回) |
| `PostToolUseFailure` | 工具报错/超时/中断 | `tool_name` | `additionalContext` |
| `PermissionDenied` | auto 模式拒绝 | `tool_name` | `retry: true` 允许重试 |
| `PermissionRequest` | 弹出权限对话框 | `tool_name` | `decision` (allow/deny + 更新规则) |
| `Notification` | 系统通知发送时 | `notification_type` (permission_prompt/idle_prompt/auth_success/elicitation_*) | 仅观测 |
| `UserPromptSubmit` | 用户提交 prompt | 无 | exit 2 阻断；`additionalContext` 注入 |
| `SessionStart` | 新会话启动 | `source` (startup/resume/clear/compact) | `additionalContext` / `initialUserMessage` / `watchPaths` |
| `Stop` | 模型准备停止 | 无 | exit 2 继续对话 |
| `StopFailure` | 因 API 错误结束 | `error` (rate_limit/auth/billing/invalid/server/max_tokens/unknown) | 仅观测 |
| `SubagentStart` | Agent 工具启动子 agent | `agent_type` | `additionalContext` |
| `SubagentStop` | 子 agent 结束 | `agent_type` | exit 2 继续（即让子 agent 再多跑一轮） |
| `PreCompact` | 压缩前 | `trigger` | exit 2 阻断压缩 |
| `PostCompact` | 压缩后 | `trigger` | 观测 + `additionalContext` |
| `Setup` | init / 维护 | `trigger` (init/maintenance) | 仅观测 |
| `TeammateIdle` | 队友 agent 进入 idle | `teammate_name, team_name` (无 matcher 字段) | exit 2 阻止进入 idle |
| `TaskCreated` | 创建任务 | — | exit 2 阻止 |
| `TaskCompleted` | 任务完成 | — | exit 2 阻止 |
| `Elicitation` | MCP 请求用户输入 | `mcp_server_name` | `action` (accept/decline/cancel) + `content` |
| `ElicitationResult` | 用户回应 MCP 请求 | `mcp_server_name` | exit 2 阻断 |
| `ConfigChange` | settings 文件变更 | `source` (user/project/local/policy/skills) | exit 2 阻断 |
| `InstructionsLoaded` | CLAUDE.md / rule 加载 | `load_reason` | 仅观测 |
| `WorktreeCreate` | 创建 worktree | — | stdout 为创建的路径 |
| `WorktreeRemove` | 删除 worktree | — | 仅观测 |
| `CwdChanged` | cwd 改变 | 无 metadata matcher | `watchPaths` 注册文件监视 |
| `FileChanged` | 被监视的文件变更 | 无 | 同上 |

> 25 个事件类型是**目前所有开源 agent CLI 中最多**的。Post 成功/失败拆分、`TeammateIdle`、`TaskCreated/Completed`、`Elicitation*`、`WorktreeCreate/Remove`、`ConfigChange`、`InstructionsLoaded`、`CwdChanged`、`FileChanged` 这些都非常具体，对应 Claude Code 真实用到的功能面。

### 4.4 Verdict 评价

- **成熟度**：25 个事件 + 4 种执行模式 + 丰富的结构化返回，是"hook 系统"在同类产品里的事实标杆。
- **扩展性**：四种模式里 Prompt / Agent 用 LLM 做判断、HTTP 用于对接企业工单系统、Shell 覆盖 legacy 场景；加上 skill frontmatter 声明 hooks → session hook 注册，扩展路径非常清晰。
- **安全性**：SSRF 守卫 + URL 白名单 + env var 白名单 + workspace trust + policy 熔断这一套"多层防御"比 codex 的 hook 安全模型严谨得多。Shell hook 本身**不跑沙盒**，但整体还有 permission engine 兜底；policy 层能 kill 整个 hook 系统是企业场景的关键。
- **不足**：(1) Shell handler 本身没有沙盒；(2) `TeammateIdle/TaskCreated/TaskCompleted` 等事件的 matcher 定义留空（`getHookEventMetadata` 返回空串），意味着这些事件的 handler 实际上是"全量 match"，有点不一致；(3) hooks 列表长到一定程度后，没有 dry-run 工具来预演命中情况。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 5. 上下文管理详细说明

### 5.1 上下文引擎的实现

- **状态持有者**：`state/AppStateStore.ts` 创建一个 Zustand 风格的 Store，然后由 `state/AppState.tsx` 的 `AppStoreContext` / `AppStateProvider` 把它挂到 React 树顶。组件用 `useAppState(selector)` 订阅局部切片，后端逻辑（query engine、tool handler）则直接从 store 获取/修改。这是"TUI + agent"双消费者共享状态的标准姿势。
- **内存结构**：消息是 `UserMessage / AssistantMessage / AttachmentMessage / ToolUseSummaryMessage / TombstoneMessage` 等变体（类型别名通过 `./types/message.js` 导出）；tool 结果通过 `ToolResult<T>` 包装，可以携带 `newMessages` 数组，以便工具产生"副作用消息"。
- **规范化**：`query.ts` 里调 `normalizeMessagesForAPI()`（来自 `utils/messages.js`），再用 `fetchSystemPromptParts()` / `asSystemPrompt()` 组装 system block；CLAUDE.md 的加载在 `utils/claudemd.ts` 里按优先级 `managed → user → project/local` 展开，并且支持 `@include` 递归引入且有循环检测。`appendSystemContext` 与 `prependUserContext` 两个工具函数负责把外部上下文（hook 注入的 `additionalContext`、skill 全文等）塞进消息流。

### 5.2 上下文管理代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `state/AppStateStore.ts` | 中央 store，Zustand 风格 |
| `state/AppState.tsx` | React Context provider + `useAppState` |
| `query.ts` / `QueryEngine.ts` | agent loop + 消息归一化 + 工具分发 |
| `utils/claudemd.ts` | `CLAUDE.md` / `.claude/rules/` 发现 + `@include` |
| `services/compact/compact.ts` | 完整压缩（生成 summary） |
| `services/compact/autoCompact.ts` | 自动压缩阈值 + failure circuit breaker |
| `services/compact/microCompact.ts` | 客户端 microcompact |
| `services/compact/apiMicrocompact.ts` | 服务端 `context_management` (cache_edits + clear_thinking + clear_tool_uses) |
| `services/compact/sessionMemoryCompact.ts` | 长时记忆的会话压缩 |
| `services/compact/postCompactCleanup.ts` | 压缩后清理 |
| `services/api/promptCacheBreakDetection.ts` | 缓存断裂检测 (与压缩联动) |

### 5.3 全部分层说明

| 层级 | 内容 | 是否持久化 | 备注 |
|------|------|------------|------|
| System prompt | `buildSystemPromptBlocks()`：身份 + 工具指南 + 环境说明 + CLAUDE.md 片段 | 否 (派生) | 每个 block 独立 `cache_control` |
| Managed memory | `/etc/claude-code/CLAUDE.md` | 是 (文件) | 企业 MDM 可下发 |
| User memory | `~/.claude/CLAUDE.md` | 是 | |
| Project memory | cwd 上推路径下的 `CLAUDE.md` / `.claude/CLAUDE.md` / `.claude/rules/*.md` | 是 | 后加载覆盖先加载 |
| Local memory | `CLAUDE.md.local` | 是 | 不建议入 git |
| Tools schema | `toolToAPISchema()` | 否 (派生) | 独立 cache block |
| Message history | `UserMessage / AssistantMessage / …` 序列 | 是 (transcript) | 持久 + 可 resume |
| Todos | `AppState.todos[agentId]` | **否** | 内存态；全部完成就清空 |
| `additionalContext` | hook / skill 注入块 | 随 session | 受 `PreToolUse` 等 hook 控制 |
| Sidechain transcripts | 子 agent / teammate 单独文件 | 是 | `recordSidechainTranscript()` |

### 5.4 上下文压缩机制

- **四种压缩路径**同时存在，互相补位：
  1. **autoCompact** (`autoCompact.ts`)：当 token 达到 `getAutoCompactThreshold(model)`（`上下文窗口 − AUTOCOMPACT_BUFFER_TOKENS (13,000)`）时触发 `compactConversation()`，生成 summary 替换旧消息。失败容错：连续 3 次失败就进入 circuit breaker（`AutoCompactTrackingState`），暂停自动压缩。
  2. **microCompact** (`microCompact.ts`)：客户端层的增量压缩，直接把"要丢弃的消息"整理成 `cache_edits` 删除块，期望命中 Anthropic 的增量缓存编辑接口。
  3. **apiMicrocompact** (`apiMicrocompact.ts`)：把压缩策略委托给服务端——请求里挂 `context_management` block，包含 `clear_thinking_20251015`（只保留最近 N 轮 thinking，或全清）和 `clear_tool_uses_20250919`（超过 token 阈值的 tool result 被清；排除个别工具）。默认 180k max / 40k target。tool 清理仅对 ant 用户开放，thinking 清理对所有用户开放。
  4. **sessionMemoryCompact** (`sessionMemoryCompact.ts`)：对接"长时记忆" (`services/SessionMemory/`)，把多个会话的要点沉淀为外部记忆附件，用于跨 session 复用。
- **与 cache 的联动**：microcompact 发出 `cache_edits: delete` 之前，会调 `notifyCacheDeletion()` 告知 `promptCacheBreakDetection`——这样**下一轮响应里 `cache_read_input_tokens` 的跌落就不会被误报为 cache break**。这是少数认真处理"压缩 vs 缓存"冲突的设计。
- **压缩触发点**：`query.ts` 在每轮 turn 开始前检查；用户也能通过 `/compact` 手动触发；`PreCompact` / `PostCompact` hooks 可以观察与阻止。

### 5.5 Verdict 评价

- **完整性**：四种压缩路径 + 独立的 cache-break 检测 + hooks 挂钩 + session memory，生命周期覆盖面非常宽。
- **精细度**：服务端 `context_management` 让 "clear thinking / clear tool uses" 拿到了**按内容类型的差异化裁剪能力**，这是 codex 的单一摘要路径做不到的。
- **恢复能力**：压缩前后 system prompt / 工具 schema 不变，配合 per-block cache_control，失忆与 cache 失效风险都得到约束；connect 压缩失败有 circuit breaker 防止无限重试。
- **不足**：(1) microCompact / apiMicrocompact 有部分能力仅对 ant 内部用户开放；(2) todos 不被压缩特殊保留，靠"全部完成就清空"做简化；(3) 各路径之间的优先顺序文档化不强，阅读代码才能弄清楚它们如何组合。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 6. Tool Use 详细说明

### 6.1 Tool Use 引擎的实现

- **抽象**：`Tool.ts` 顶层定义 `Tool<Input, Output, P>` 接口。必需字段包括 `name`、`call()`、`description()`、`inputSchema`、`checkPermissions()`、`prompt()`、`userFacingName()`、`isEnabled()`、`isReadOnly()`、`isConcurrencySafe()`、`toAutoClassifierInput()`、`mapToolResultToToolResultBlockParam()`、`renderToolResultMessage()`、`renderToolUseMessage()`。可选字段带 `isDestructive()`、`interruptBehavior()`、`validateInput()`、`getActivityDescription()`、`renderToolUseProgressMessage()`、`alwaysLoad`、`shouldDefer`、`strict`、`mcpInfo` 等。这是一个明显比 codex `ToolHandler` 更"大"的接口——它既含业务语义、又含 UI 渲染职责。
- **注册**：`tools.ts` 把全部内建工具按 feature flag 组装，`assembleToolPool()` (AgentTool.tsx:16) 再结合 agent 定义 / coordinator mode 的限制做最终过滤；MCP 工具在运行时被加入；`require()` 动态加载主要是为了打破 `TeamCreateTool / SendMessageTool` 等的循环依赖。
- **执行流程**：(1) LLM 产出 `tool_use` block；(2) `runTools()` (toolOrchestration) 按 `isConcurrencySafe` 划分批次；(3) 每个 tool 调用自己的 `checkPermissions()` 做预检；(4) `StreamingToolExecutor` 逐步 yield 输出并构造 `tool_result` block；(5) `applyToolResultBudget()` 在 `query.ts:99` 对超长结果做裁剪或落盘，返回 "结果已保存到 X" 之类的 handle；(6) hooks 的 `PreToolUse` / `PostToolUse` / `PostToolUseFailure` 在这个过程中被分别调用。
- **并行**：**是**。`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 默认 10；concurrency-safe 的工具被 `runToolsConcurrently()` 并发执行，不安全的（写文件、改 state 的）强制串行；并发期间产生的"context modifier"（对 app state 的副作用）被排队，在所有工具都结束后顺序 apply，避免 race。
- **结果序列化**：`Tool.ts:557-560` 的 `mapToolResultToToolResultBlockParam()` 负责把工具特有的 output 转成 API 规定的 `ToolResultBlockParam`，并保存 `ContentReplacementState` 以支持 transcript 里的"旧内容被新内容替换"的可视化。

### 6.2 Tool Use 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `Tool.ts` | `Tool` 接口 + `ToolResult` 模型 + UI 渲染接口 |
| `tools.ts` | 内建工具注册 + feature flag 过滤 |
| `tools/*` | 40+ 具体工具目录 |
| `query.ts` | agent loop + `runTools` + tool result budget |
| `QueryEngine.ts` | Higher-level query coordinator |
| `services/mcp/client.ts` | MCP 客户端 (stdio/sse/sse-ide/http/ws/sdk) |
| `tools/MCPTool/*` | MCP 工具代理 |
| `coordinator/*` | swarm / coordinator mode 下的工具池裁剪 |

### 6.3 内建工具逐一列举与分析

| 工具名 | 文件（相对 `tools/`） | 核心能力 |
|--------|---------------------|----------|
| `AgentTool` | `AgentTool/AgentTool.tsx` | 生成子 agent，支持 `subagent_type / model / run_in_background / team_name / mode / isolation / cwd` |
| `AskUserQuestionTool` | `AskUserQuestionTool/` | 主动向用户发问并等待回答 |
| `BashTool` | `BashTool/` | 执行 shell 命令 + 流式输出 |
| `BriefTool` | `BriefTool/` | 上传文件做 brief 注入 |
| `ConfigTool` | `ConfigTool/` | 动态修改用户 settings |
| `EnterPlanModeTool` | `EnterPlanModeTool/EnterPlanModeTool.ts` | 切换到 plan 模式（Kairos 模式下禁用） |
| `EnterWorktreeTool` / `ExitWorktreeTool` | `EnterWorktreeTool/` / `ExitWorktreeTool/` | 开/关隔离的 git worktree |
| `ExitPlanModeTool` | `ExitPlanModeTool/ExitPlanModeV2Tool.ts` | 退出 plan 模式 |
| `FileEditTool` | `FileEditTool/` | 基于 diff 的文件编辑 |
| `FileReadTool` | `FileReadTool/` | 带 size/token 上限的读文件 |
| `FileWriteTool` | `FileWriteTool/` | 新建/覆盖文件 |
| `GlobTool` | `GlobTool/` | 路径 glob |
| `GrepTool` | `GrepTool/` | 内容正则搜索 |
| `LSPTool` | `LSPTool/` | 调 LSP 做类型/引用/诊断 |
| `ListMcpResourcesTool` / `ReadMcpResourceTool` | `ListMcpResourcesTool/` / `ReadMcpResourceTool/` | MCP resource 枚举与读取 |
| `MCPTool` | `MCPTool/` | MCP server 工具代理 |
| `McpAuthTool` | `McpAuthTool/` | MCP OAuth 管理 |
| `NotebookEditTool` | `NotebookEditTool/` | Jupyter notebook cell 编辑 |
| `PowerShellTool` | `PowerShellTool/` | Windows-first 的 PowerShell 执行 |
| `REPLTool` | `REPLTool/` | Python/Node REPL (ant-only) |
| `RemoteTriggerTool` | `RemoteTriggerTool/` | 触发远程 scheduled agent |
| `ScheduleCronTool` | `ScheduleCronTool/` (Create/List/Delete 三件套) | 定时任务调度 |
| `SendMessageTool` | `SendMessageTool/` | 向 teammate / swarm 发消息 |
| `SkillTool` | `SkillTool/SkillTool.ts` | 调用已发布的 skill |
| `SleepTool` | `SleepTool/` | 延迟（用于轮询/后台） |
| `SyntheticOutputTool` | `SyntheticOutputTool/` | 向 transcript 插入合成 tool result |
| `TaskCreateTool` / `TaskGetTool` / `TaskListTool` / `TaskOutputTool` / `TaskStopTool` / `TaskUpdateTool` | `Task*Tool/` | 后台任务 (bash / agent / workflow / monitor) 生命周期管理 |
| `TeamCreateTool` / `TeamDeleteTool` | `TeamCreateTool/` / `TeamDeleteTool/` | swarm team 上下文 |
| `TodoWriteTool` | `TodoWriteTool/TodoWriteTool.ts` | 写入/更新 TODO 列表 |
| `ToolSearchTool` | `ToolSearchTool/` | 动态发现 deferred 工具 |
| `WebFetchTool` | `WebFetchTool/` | 抓 URL → markdown |
| `WebSearchTool` | `WebSearchTool/` | Web 搜索 |

> 一共 40+ 个工具，比 codex 更广，但也因此对 tool schema 的 token 成本更敏感——`ToolSearchTool` + `alwaysLoad` + `shouldDefer` 三个字段就是用来做"按需暴露工具"的。

### 6.4 Verdict 评价

- **完整性**：文件 / Bash / PowerShell / Notebook / LSP / REPL / Task / Agent / Skill / MCP / Web / Schedule / Team / worktree 应有尽有，同类最全。
- **扩展性**：Tool 接口比 codex 重，但也把"UI 渲染 + permission 检查 + 活动描述"都并入了基类，二次开发时单个文件就能写完"逻辑 + 显示 + 授权"三件事。
- **健壮性**：并发划分清晰；tool result budget 让大输出落盘而不是撑爆上下文；`StreamingToolExecutor` 支持边执行边展示。
- **不足**：(1) 工具数量太多导致 tool schema token 成本天然高，`ToolSearchTool` 是必要的缓解器；(2) 某些工具（REPL、Team*）是 ant-only 或 feature-gated 的，文档分散；(3) Tool 接口"UI 渲染 + 业务逻辑"耦合在一起，对想改 UI 不改逻辑的修改不友好。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 7. Skill 详细说明

### 7.1 Skill 的分类

- **物理格式**：目录 `skill-name/` + 必需的 `SKILL.md`（YAML frontmatter + Markdown 正文）。legacy `commands/` 目录还支持单文件 `.md`，但新的 `.claude/skills/` 只接受目录格式。
- **Frontmatter 字段**（`skills/loadSkillsDir.ts:185-265`）：`name`、`description`、`user-invocable`、`allowed-tools`、`argument-hint`、`arguments`、`when_to_use`、`version`、`model` (可 `inherit`)、`disable-model-invocation`、`effort`（`quick|moderate|long` 或 1-10）、`context`（`'fork'` → 用子 agent 跑）、`agent`（引用另一个 agent 定义）、`paths`（glob 限定作用范围）、`hooks`（内嵌 HooksSettings）、`shell`（shell override）。这份 frontmatter 的**能力面比 codex 的 openai.yaml 更广**，尤其是 `context: fork` 和 `paths`。
- **Scopes**（共 7 类）：
  1. **bundled**（编译期 `registerBundledSkill()` 注册）
  2. **`.claude/skills/`** (project)
  3. **`.claude/commands/`** (legacy, 同时承载 project + user)
  4. **`~/.claude/skills/`** (user)
  5. **`~/.claude/plugins/*/skills/`** (plugin)
  6. **MCP-derived** (`mcpSkillBuilders.ts` 把 MCP prompts 包装成 skill)
  7. **session-scoped** (临时)

### 7.2 Skill 的加载顺序

- 入口在 `SkillTool/SkillTool.ts:81-94`：先取本地 commands (`user + project + bundled`)，再叠加 MCP skills，`uniqBy(..., 'name')` 保证"先到先得"——本地会**遮蔽**同名 MCP skill。
- 支持嵌套目录发现；skill 的 discovery 在 `utils/skills/skillChangeDetector.ts` 里有 fs watcher 做文件变更感知，可以做到**近实时热更新**（而不是 codex 那种手动 reload）。

### 7.3 Skill 与 System Prompt 的映射关系

- **Progressive disclosure**：system prompt 里只包含 skill 的元数据（`name + description + when_to_use + argument-hint + allowed-tools`），全文正文只有在 skill 被显式调用时才通过 `getPromptForCommand()` 加载。
- 正文加载时还会做 **三层替换**：
  1. `$ARGUMENTS` → 用户提供的 args
  2. `${CLAUDE_SKILL_DIR}` → skill 目录
  3. `${CLAUDE_SESSION_ID}` → 当前 session id
  并且允许正文里嵌入"反引号内的 shell 片段"，会在加载时执行并替换——**但 MCP skill 被显式排除**，因为内容来自远端不可信。
- `disable-model-invocation: true` 可以把 skill 从 system prompt 里隐藏（只允许用户手动 `/skill-name` 触发）。

### 7.4 动态 Skill 的注册、发现、注入与使用

- **发现触发**：fs watcher (`skillChangeDetector.ts`) 感知 `.claude/skills/` 目录变化；还有 `ConfigChange` / `InstructionsLoaded` 两个 hook 事件供用户挂 watcher 脚本。
- **条件激活**：通过 frontmatter `paths` 字段按文件路径做限定；bundled skill 还能定义 `isEnabled?: () => boolean` 在启动时动态决定是否装载。
- **Skill → Hook 的反向绑定**：`registerSkillHooks.ts` 会在 skill 被调用时，把 frontmatter 里的 `hooks` 结构注册为 **session 级 hook**；`once: true` 的 hook 成功执行一次后自动注销。`registerFrontmatterHooks.ts` 则为 agent 定义做类似的事情，并把 `Stop` 自动转成 `SubagentStop`（因为 agent 触发的是子 agent 停机事件）。
- **MCP skill 的生成**：`mcpSkillBuilders.ts` 把 MCP server 声明的 prompts 动态翻译为 skill，允许把 MCP 生态的 prompt 资源一等地接入 skill 系统。

### 7.5 Verdict 评价

- **完整性**：7 种来源 + hot reload + fork context + path filter + skill → session hook + MCP prompt 导入，是**三家中最完整**的 skill 系统。
- **Token 效率**：严格 progressive disclosure；此外 `alwaysLoad` 与 `shouldDefer` 让一些 skill 的元数据都能缓到 ToolSearch 入口而非 system prompt。
- **扩展性**：单目录 + frontmatter，上手门槛低；`context: fork` 让复杂 skill 可以开子 agent 跑；`paths` 让 skill 作用域可控。
- **不足**：(1) frontmatter 字段太多，用户容易漏配；(2) MCP skill 的 shell 片段被禁但 file 引用未必被完全限制；(3) `disable-model-invocation` 与 `user-invocable` 语义接近但不同，容易混淆。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 8. Sub-Agent 详细说明

### 8.1 Sub-Agent 引擎的实现

- **双层抽象**：顶层对模型暴露的是 **AgentTool**（`tools/AgentTool/AgentTool.tsx`），底层是 **Task.ts** 的通用任务模型——`TaskType = 'local_bash' | 'local_agent' | 'remote_agent' | 'in_process_teammate' | 'local_workflow' | 'monitor_mcp' | 'dream'`。AgentTool 的参数覆盖 `description / prompt / subagent_type / model / run_in_background / name / team_name / mode / isolation / cwd`，对模型非常友好。
- **唤醒与并发**：子 agent 可以同步跑、也可以后台跑（`run_in_background: true`），进入 `AppState.tasks[taskId]` 后由 `TaskOutputTool` / `TaskGetTool` / `TaskListTool` / `TaskStopTool` / `TaskUpdateTool` 五件套维护；`TaskCreated` / `TaskCompleted` / `SubagentStart` / `SubagentStop` 四个 hook 事件贯穿生命周期。
- **Agent 定义**：`.claude/agents/` 目录下的 YAML 文件声明 subagent 类型 (`loadAgentsDir.ts`)：字段包括 `description / tools / disallowedTools / prompt / model / effort / permissionMode / mcpServers / hooks / maxTurns / skills / initialPrompt / memory / background / isolation`。这是 codex 没有的能力——**sub-agent "类型"是用户可预配置的命名资源**，而不是只能在 tool call 里临时指定。
- **并行 / 深度**：并行支持很好（多个后台任务互不阻塞），但深度限制**看起来没有显式字段**——subagent 理论上能再 spawn subagent。这是一个潜在风险，依赖 agent 定义的 `maxTurns` 间接收敛。
- **Context 隔离**：`utils/forkedAgent.ts` 的 `createSubagentContext()`：(a) 克隆文件状态缓存 `cloneFileStateCache()`；(b) 建子 `AbortController`；(c) 克隆 `ContentReplacementState`；(d) 异步 agent 的 `setAppState` 被替换为 no-op 避免污染主 UI；(e) **system prompt 冻结**并通过 `CacheSafeParams` 传给子 agent——这保证了父子共享的那段 system block 的 cache key 稳定，不会因为父/子边跑边改而互相打断缓存。这种"cache-safe fork"的自觉是 claude-code 的独门招数。
- **权限**：默认继承父 permission mode，也可以通过 AgentTool 的 `mode` 参数覆写（`plan / auto / bypass / default / dontAsk`）；在 coordinator mode 下（`isCoordinatorMode()`），worker 的工具池被限定到安全子集 (AgentTool / SkillTool / Bash / File 工具 / MCPTool / SendMessage)。
- **LLM 使用**：复用父的 client 与 provider；默认继承父模型，也可 per-call 覆写。
- **持久化**：
  - **local agent**：`AppState.tasks[taskId]` + 输出文件（`Task.ts:54` 有 `outputFile` 字段）
  - **remote agent**：上送到 CCR 云端，session URL 由 `getRemoteTaskSessionUrl()` 返回
  - **in-process teammate**：`recordSidechainTranscript()` + `writeAgentMetadata()` 按 session 目录存档
- **结果回归**：同步调用直接返回 `ToolResult<Output>`；后台任务靠 `TaskOutputTool` 流式拉取；`SendMessageTool` 支持 teammate 之间或主/子之间的消息中转。

### 8.2 Sub-Agent 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `Task.ts` | Task 抽象与状态机 |
| `tools/AgentTool/AgentTool.tsx` | 对模型暴露的 AgentTool |
| `tasks/LocalAgentTask.tsx` | 本地 agent 任务 |
| `tasks/RemoteAgentTask.ts` | 远程 agent 任务 |
| `tasks/InProcessTeammateTask.ts` | 同进程 teammate |
| `utils/forkedAgent.ts` | fork + cache-safe params + child abort |
| `utils/standaloneAgent.ts` | 独立 agent 入口 |
| `coordinator/*` | coordinator 模式下的工具池裁剪 |
| `commands/agents/` | `.claude/agents/` 加载 |
| `utils/hooks/registerFrontmatterHooks.ts` | agent hook 注册 |
| `utils/sessionStorage.ts` | sidechain transcript 持久化 |
| `tools/SendMessageTool/*` | 跨 agent 通讯 |
| `tools/Task*Tool/*` | 后台任务五件套 |

### 8.3 Sub-Agent 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 调度引擎 | AgentTool + Task.ts + `AppState.tasks` | 前台+后台两种模式 |
| 生命周期管理 | `SubagentStart/Stop` + `TaskCreated/Completed` + `maxTurns` | 无显式深度限制 |
| 上下文隔离 | `createSubagentContext()`、`CacheSafeParams` | cache-safe 是亮点 |
| 权限与沙盒 | 继承父 mode / 可覆写 / coordinator 子集 | 比 codex 灵活 |
| 结果回归 | `ToolResult` / `TaskOutputTool` / `SendMessageTool` | 三条路径可选 |

### 8.4 Verdict 评价

- **完整性**：前台子 agent / 后台 task / 远程 agent / 同进程 teammate / swarm team 五类全覆盖；`.claude/agents/` 让 subagent 成为用户可声明的一等资源。
- **隔离性**：cache-safe fork 的自觉是同类中少见的工程质量；文件状态也被克隆，避免父子互相污染。
- **可观测性**：Task 五件套 + hook 事件 + transcript 落盘，让主 agent 能追溯每一个子任务。
- **不足**：(1) **没有显式的递归深度上限**，只靠 `maxTurns` 间接收敛；(2) 文件系统并发冲突没有专门的协调层；(3) 前台 AgentTool 与后台 Task 的职责有重叠，决策树偏复杂。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 9. TUI 详细说明

### 9.1 TUI 引擎的实现

- **驱动 / 渲染**：自带 Ink。`ink/reconciler.ts` 基于 React Reconciler API + 自写 DOM 层 (`ink/dom.ts`) + Yoga Flexbox（`native-ts/yoga-layout/`），把 JSX 布局算出矩形后交给 `ink/output.ts` 与 `ink/render-to-screen.ts` 输出 ANSI。`ink/focus.ts` 管焦点树，`ink/termio/` 管 DEC 私有模式（显示/隐藏光标、bracketed paste、alt screen）。
- **刷新机制**：完全**状态驱动**——React state 变化 → `useSyncExternalStore` 订阅者被通知 → reconciler 算 diff → 终端输出。没有固定帧率钳位（不像 codex 的 120fps 上限），而是"变了就画"。
- **组件树**：顶层 `App` (`components/App.tsx`) 套三层 Provider（AppState、Stats、FpsMetrics）；主屏 `screens/REPL.tsx` 内含 `Messages` / `PromptInput` / `StatusLine` / `Spinner` / 一众 Dialog。`components/` 下有 100+ 个组件，从 `ApproveApiKey` 到 `BypassPermissionsModeDialog` 到 `ThemePicker` 到 `ContextVisualization` 到 `ClaudeMdExternalIncludesDialog`——UI 面积非常大。
- **通讯**：中央 Store (`state/AppStateStore.ts`) + React Context (`AppStateProvider`)；组件用 `useAppState(selector)` 订阅切片，业务层用 store API 直接读写；还有一系列 React hook（`useMainLoopModel`、`useSessionBackgrounding`、`useCommandKeybindings`、`useGlobalKeybindings`、`useTextInput`…）把 "React 侧副作用" 与 "agent loop 侧事件" 桥接起来。
- **焦点 / 输入**：`hooks/useTextInput.ts` 是主文本框控制器，支持 multiline、cursor 字符、密码 mask、图片粘贴、vim 模式（`hooks/useVimInput.ts`）；光标的 Emacs 风格 kill ring / yank 在 `utils/Cursor.ts`；全局快捷键走 `hooks/useGlobalKeybindings.tsx`（Ctrl+C/D/Z、命令派发）。
- **主题**：`commands/theme/theme.tsx` + `components/ThemePicker.tsx` + `outputStyles/` 目录的主题定义；`ink/colorize.ts` 负责 ANSI 颜色；`components/design-system/Pane.tsx` 抽了"语义颜色" (`permission / planMode / error / warning / text`)。
- **鼠标**：没检测到鼠标事件处理。Ink 本身支持 raw mode 鼠标，但 claude-code 没挂相应 hook。

### 9.2 TUI 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `ink/reconciler.ts` | React Reconciler 实现 |
| `ink/dom.ts` | 自定义 DOM + Yoga 布局节点 |
| `ink/output.ts` | 帧 → ANSI 序列 |
| `ink/render-to-screen.ts` | 终端输出管理 |
| `ink/focus.ts` | 焦点树 |
| `ink/termio/` | 终端控制序列 |
| `ink/colorize.ts` | 颜色工具 |
| `main.tsx` | 进程入口 |
| `entrypoints/cli.tsx` | CLI arg 解析 + React 树挂载 |
| `components/App.tsx` | 顶层 Provider 壳 |
| `screens/REPL.tsx` | 主交互屏 |
| `components/Messages.tsx` + `components/Message.tsx` + `components/MessageResponse.tsx` + `components/Markdown.tsx` | 对话流 |
| `components/PromptInput/PromptInput.tsx` + `components/BaseTextInput.tsx` | 输入框 |
| `components/StatusLine.tsx` / `components/Spinner.tsx` | 状态栏 / 进度 |
| `components/permissions/PermissionRequest.tsx` | 权限对话框 |
| `components/ModelPicker.tsx` / `components/ThemePicker.tsx` | 模型 / 主题切换 |
| `state/AppState.tsx` + `state/AppStateStore.ts` | 状态中心 |
| `hooks/useTextInput.ts` / `hooks/useGlobalKeybindings.tsx` / `hooks/useCommandKeybindings.tsx` | 输入与快捷键 |
| `utils/Cursor.ts` | 光标 / kill ring |

### 9.3 TUI 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 驱动引擎 | 自带 Ink（React Reconciler + Yoga） | 不依赖 npm ink |
| 渲染引擎 | React diff → DOM tree → Yoga layout → ANSI | 类 web 栈 |
| 刷新机制 | 状态驱动，无帧率钳位 | 更像 SPA，而非 game loop |
| 数据通讯 | store + React context + 自写 hooks | UI 与 agent loop 共享一个 AppState |

### 9.4 Verdict 评价

- **完整性**：100+ 组件 + 40+ 种 dialog/overlay，对 CLI 来说 UI 面积极大；对比之下 codex 的 ratatui 布局更紧凑但更"底层"。
- **性能**：React 的"状态驱动 reconciliation"模型在高频流式 token 输出下对 CPU 不友好（尤其当消息列表很长时）；不过有 `FpsMetricsProvider` / `useDeferredHookMessages` 这类 hook 尝试优化。
- **可扩展性**：加新组件非常像写前端——`components/` 加文件、接 hook、订阅 store 即可；加新主题改 `outputStyles/`；这对 web 背景的开发者非常友好。
- **不足**：(1) 没有鼠标支持；(2) 没有固定帧率钳位，极端场景下有重渲染压力；(3) 自带 Ink fork 增加了维护负担；(4) UI 与业务逻辑耦合（Tool 接口就把 `render*Message` 放进来了），剥离成本高。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 10. To-Do List 详细说明

### 10.1 To-Do List 引擎的实现

- **Parse 原理**：结构化 tool call。`TodoWriteTool` 的 input 是 `{ todos: TodoListSchema() }`，每个 item 是 `{ content: string(min 1), status: 'pending'|'in_progress'|'completed', activeForm: string(min 1) }`。`activeForm` 是 claude-code 独有的字段——用来标识"是哪个 agent form / 模式写的这条 todo"，间接支持 agent 切换时 todo 的来源追溯。
- **存储**：`AppState.todos[agentId or sessionId]` 内存态；**不写磁盘**。tool 输出包括 `oldTodos` / `newTodos` / 可选 `verificationNudgeNeeded`，每次调用是**整表覆盖写**。
- **状态机**：三态（pending / in_progress / completed），扁平列表，不支持嵌套 / 依赖 / 优先级 / 截止日期。全部 completed 时会被整表清空（`const newTodos = allDone ? [] : todos`）——这与普通 todo app 的语义略有不同。
- **与 Agent loop 的集成**：todo 写入后会被下一轮 system/user context 读到；`verificationNudgeNeeded` 允许提示模型"还有没标记完成的 todo"；hooks 里没有专门的 `PreTodoWrite` / `PostTodoWrite`，因此 todo 不是 hook 可拦截的对象。
- **与 Plan Mode 的区别**：todo 是"执行期跟踪"；Plan Mode (`EnterPlanModeTool` + `utils/planModeV2.ts`) 是"执行前规划"，完全不同的系统。Plan Mode 还有 interview phase、multi-agent 并行规划（tier 1 用户 3 个 agent）、分阶段 prompt，属于单独的重型特性；`commands/plan/plan.tsx` 提供 `/plan` 命令入口，`utils/ultraplan/` 还是实验中的另一个规划变体。

### 10.2 To-Do List 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `tools/TodoWriteTool/TodoWriteTool.ts` | 工具实现 |
| `tools/TodoWriteTool/constants.ts` | 常量 |
| `utils/todo/types.ts` | Zod schema |
| `state/AppStateStore.ts` | `todos` 字段存储 |
| `hooks/useTaskListWatcher.ts` | todo 变更的 React 侧监听（TUI 用） |
| `tools/EnterPlanModeTool/EnterPlanModeTool.ts` + `tools/ExitPlanModeTool/ExitPlanModeV2Tool.ts` | Plan Mode 进/出 |
| `utils/planModeV2.ts` | Plan Mode v2 配置 |
| `commands/plan/plan.tsx` | `/plan` 命令 |
| `utils/ultraplan/` | 实验性规划变体 |

### 10.3 To-Do List 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| Parse 引擎 | JSON schema + tool call | 无 NLP |
| 创建注册 | `AppState.todos[agentId]` | 内存 |
| 状态维护 | 整表覆盖 + `verificationNudgeNeeded` | 无增量 diff |
| 持久化 | **无**（只在 AppState） | 不跨 session |

### 10.4 Verdict 评价

- **完整性**：最小三态 + `activeForm` 追溯字段，满足"执行期跟踪"的最基本需求。
- **集成度**：整表覆盖 + verification nudge 的组合很朴素但够用；React 侧 `useTaskListWatcher` 能让 TUI 即时反馈。
- **可靠性**：三态清晰；但"全部完成清空"是约定而非保护，偶尔会让用户失去历史上下文。
- **不足**：(1) 不写磁盘，跨 session 无法续写；(2) 没有嵌套 / 依赖 / 优先级 / 截止日期；(3) 没有 hook 可拦截 todo 变更；(4) 与 Plan Mode 的分工模糊（Plan Mode 生成的计划并不自动变成 todo）。

**评分**：⭐⭐⭐☆☆ (3/5)

---

## 11. CLI Permission 与执行模式详细说明

### 11.1 CLI Permission 引擎的实现

- **模式枚举**：外部 5 种 — `default / plan / acceptEdits / bypassPermissions / dontAsk`；内部（ant / feature-gated）再加 `auto`（分类器驱动的自动审批） 和一个 `bubble` 类状态。定义在 `types/permissions.ts:16-38` 的 `EXTERNAL_PERMISSION_MODES` 与 `INTERNAL_PERMISSION_MODES`。
- **模式切换**：CLI 参数、settings 文件、`/permissions` 命令、AgentTool 的 `mode` 参数、以及用户通过权限对话框主动选择"bypass/ask/accept"等。`EnterPlanModeTool` 还能由模型主动触发切换。
- **权限分层**：所有决策收敛到 `utils/permissions/permissions.ts` 的中央函数。它枚举 7 级规则来源（user / project / local / flag / policy / CLI / session），按 allow / ask / deny 逐条匹配。规则语法是 `Tool` 或 `Tool(pattern)`，pattern 根据工具语义解释——`Bash` 的是"命令前缀"（如 `Bash(npm:*)` 等于 `npm ...` 都允许）、`FileEdit` 的是文件 path 模式、括号里的 `(` 与 `)` 用反斜杠转义。`permissionRuleParser.ts` 负责这一整套。
- **auto 模式 / 分类器**：feature-gated `TRANSCRIPT_CLASSIFIER`。`classifierDecisionModule.makeDecision()` 会读近期 transcript + 当前 tool call 做一次分类，缓存在 `autoModeState`；分类器不可用时会"fail-closed"（`CLASSIFIER_FAIL_CLOSED_REFRESH_MS = 30min`）回退到手动 prompt。`bashClassifier.ts` 与 `yoloClassifier.ts` 分别是 Bash 命令的风险分类器和"激进放行"分类器，它们共同在 auto 模式下做决策。
- **危险模式硬编码**：`dangerousPatterns.ts` 硬编码了一组"代码执行"模式——python/python3/node/deno/tsx/ruby/perl/php/lua、npx/bunx/npm run/yarn run/pnpm run/bun run、bash/sh、ssh 等；Bash 专属扩展还包括 zsh/fish/eval/exec/env/xargs/sudo；ant 内部用还覆盖 `fa run`、`coo`、`gh api`、`curl`、`wget`、`git`、`kubectl`、`aws`、`gcloud`、`gsutil`。这些规则在进入 auto 模式时会主动**剥离**掉匹配的 allow 规则（避免一个 `Bash(*)` 让 auto 模式变成 yolo）。
- **Sandbox**：`utils/sandbox/sandbox-adapter.ts` 对接外部 npm 包 `@anthropic-ai/sandbox-runtime`，配置来源是 `sandbox.filesystem.{allowRead,allowWrite,denyRead,denyWrite}` 与 `sandbox.network.{allowDomains,denyDomains}`；它**既不是纯监控层也不是"软"沙盒**：在 Linux 上 sandbox-runtime 内部用 **bubblewrap (`bwrap`)** 做真·mount-namespace 级隔离——`utils/Shell.ts:386-390` 和 `sandbox-adapter.ts:263` 的注释都明确提到"bwrap 会在 host 上为不存在的 deny path 留下 0 字节 mount-point 文件，macOS 上是 no-op"，这是 ro-bind mount 的典型副作用。macOS 与 Windows 走不同代码路径 (macOS 可能用 sandbox-exec，Windows 代码里没找到等价实现)。除了 OS 级隔离之外，adapter 还维护一层"应用级 deny list"——`settings.json`、`.claude/skills/`、`.claude/agents/` 在 denyWrite 里被**无条件加黑**防止 sandbox escape。所以完整判断是：**Linux 上 sandbox 是真阻断，跨平台程度不如 codex 的 landlock+seatbelt+windows-sandbox-rs 三端齐全**。
- **Bypass 熔断**：`utils/permissions/bypassPermissionsKillswitch.ts` 的 `checkAndDisableBypassPermissionsIfNeeded()` 在首次 query 前做一次远端 Statsig gate 检查（`shouldDisableBypassPermissions()`），命中即调用 `createDisabledBypassPermissionsContext()` 关掉 bypass 模式入口；加上 policy settings 侧的 `isBypassPermissionsModeAvailable` 静态开关，就形成"启动时静态熔断 + 运行时动态熔断"的双保险。这是企业 MDM 与 Anthropic 自身都能调用的 kill switch。
- **审批 UI**：`components/permissions/PermissionRequest.tsx` 是主 dialog，展示 tool 名 + 参数 + 拒绝理由（classifier / rule / hook），并附带四个选项：一次允许 / 永远允许（写 allow rule） / 一次拒绝 / 永远拒绝（写 deny rule），再加一个"更多信息"扩展。针对 plan mode 入口还有专门的 `EnterPlanModePermissionRequest`；OAuth / API key / MCP server 审批各有独立 dialog。
- **Tool Result 反馈**：`FileEditTool` 的 diff 通过 `FileEditToolDiff` 组件渲染；`TurnDiffs` hook 跟踪一轮 turn 内所有文件变更；apply 后的撤销依赖 VCS (git)，没有 ghost snapshot 这样的自研 undo。

### 11.2 CLI Permission 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `utils/permissions/PermissionMode.ts` | 模式枚举与切换 |
| `utils/permissions/permissions.ts` | 中央决策引擎 |
| `utils/permissions/PermissionRule.ts` + `permissionRuleParser.ts` | 规则语法 + 解析 + 转义 |
| `utils/permissions/dangerousPatterns.ts` | 硬编码危险命令前缀 |
| `utils/permissions/bashClassifier.ts` / `yoloClassifier.ts` | 分类器 |
| `utils/permissions/classifierDecision.ts` / `classifierShared.ts` | 分类决策 |
| `utils/classifierApprovals.ts` + `classifierApprovalsHook.ts` | 分类器与 hook 系统的桥 |
| `utils/permissions/autoModeState.ts` | auto 模式状态 |
| `utils/permissions/denialTracking.ts` | 拒绝历史跟踪 (用于 fallback) |
| `utils/permissions/pathValidation.ts` + `filesystem.ts` + `shellRuleMatching.ts` + `shadowedRuleDetection.ts` | 各类规则辅助 |
| `utils/sandbox/sandbox-adapter.ts` | sandbox-runtime 适配 |
| `utils/permissions/bypassPermissionsKillswitch.ts` | 运行时 Statsig gate 关掉 bypass 模式 |
| `components/permissions/*` | 审批 UI |
| `components/BypassPermissionsModeDialog.tsx` | bypass 开启对话框 |

### 11.3 CLI Permission 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 模式引擎 | 5 外部 + 2 内部模式；与 `auto` 分类器联动 | 比 codex 的二维组合更"UX 原语" |
| 权限分层 | 7 级规则来源 + 按工具语义匹配 pattern | 转义规则最细 |
| 审批中间件 | `classifierDecision` + hook 系统 + UI 对话 | 三层 |
| 安全策略 | Linux 上 bwrap 级真沙盒 + `dangerousPatterns` 剥离 + policy 熔断 | Linux 真阻断；macOS/Windows 覆盖面逊于 codex |

### 11.4 Verdict 评价

- **完整性**：模式 / 规则 / 分类器 / hooks / 企业 policy / UI，各层都很厚。
- **安全性**：`dangerousPatterns` 的"进入 auto 模式时主动剥离 allow 规则"是认真想过的防滥权设计；policy 熔断给企业运维一个真实的闸门；Linux 上 bwrap 提供真正的 mount namespace 隔离，`.claude/skills/` / `.claude/agents/` / `settings.json` 默认拉黑防 sandbox escape——这些都落在实现里。**短板**在于：macOS/Windows 的沙盒覆盖面不如 codex 的三端原生实现齐全，依赖 `sandbox-runtime` 内部是否能提供等价能力。
- **用户体验**：5 种模式的原语直接对应用户心智（"just ask me / accept edits only / plan first / bypass everything / do not even ask"）；审批 UI 的"一次允许 / 永远允许 + 规则建议"比 codex 更顺手。
- **不足**：(1) Linux 有 bwrap 级隔离，但 macOS/Windows 对等实现依赖 `sandbox-runtime` 内部的"是否真阻断"，代码里没看到显式的 sandbox-exec 或 Windows Job Object 集成（可能在 npm 包里，本快照里读不到）；(2) 规则语法强大但文档相对少，转义规则新用户容易踩；(3) auto 模式依赖 classifier，非 Anthropic provider 上的退化路径不够清晰。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 12. API 接口处的缓存安排

- **Prompt Cache**：全 system block 级 `cache_control: {type: "ephemeral", ttl?: "1h", scope?: "global"}`，按 block 单独下发；`buildSystemPromptBlocks()` 会把变化频率不同的段落切开，最大化缓存命中。
- **1h TTL gating**：`should1hCacheTTL()` 结合 user type (ant / 订阅 / 非订阅)、GrowthBook allowlist、session bootstrap 时的 latch 策略决定；**latched 是关键**：一旦一个 session 决定走 1h，整段 session 就不再翻转，避免 cache key 来回飘。Bedrock 上还有独立的 `ENABLE_PROMPT_CACHING_1H_BEDROCK` 开关。
- **Cache Break 检测**：`promptCacheBreakDetection.ts` 把 system/tools/betas/cache_control/effort/extra_body 打 hash；每次响应回来比对 `cache_read_input_tokens` 相对上一轮的跌幅（>5% 且 >2000 token 才算"断裂"），断裂时反查 pending changes、识别是"TTL 到期 (>1h 或 >5min 无 assistant message)" 还是"哪个字段变了"，日志打 `tengu_prompt_cache_break`。Haiku 模型被排除（缓存行为不同）。`notifyCacheDeletion()` 让 microcompact 的删除操作**不被误报**为 cache break。
- **压缩 vs cache 联动**：microCompact 发 `cache_edits` 删除块之前先 notify，下一轮响应的 cached_tokens 下跌被标成"预期内"而非断裂。这是同类里**唯一**明确处理这一耦合的设计。
- **其他优化**：`extra_body_params.context_management` 把 thinking/tool_uses 的裁剪外推到服务端；`services/api/adminRequests.ts` 有管理态请求合并；`apiPreconnect` 提前预热连接；`firstTokenDate` 记录第一 token 时延；`dumpPrompts.ts` 支持 prompt 导出调试。

---

## 13. 对不同 LLM 模型的逻辑安排

- **支持的 provider**：4 种——firstParty Anthropic（默认）/ AWS Bedrock / Google Vertex / Azure Foundry。由 `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` / `CLAUDE_CODE_USE_FOUNDRY` 三个 env 切换，互斥选择；`ANTHROPIC_BASE_URL` 可覆盖第一方 base URL 但有"必须是 Anthropic 域"校验。
- **Provider 抽象层**：`services/api/client.ts` 按 provider 加载对应 SDK (`@anthropic-ai/bedrock-sdk` / `vertex-sdk` / `foundry-sdk`)，共享 `beta.messages.create` 接口；header / 认证 / URL 在构造阶段差异化。
- **特殊处理**：(1) `thinking` 在支持 adaptive 的模型上不传 `budget_tokens`，其他模型走 `budget_tokens`；(2) 温度在启用 thinking 时必须省略；(3) Bedrock 的 inference profile 支持 `us.`/`eu.`/`apac.`/`global.` 跨区前缀；(4) `ANTHROPIC_SMALL_FAST_MODEL_AWS_REGION` 允许 small/fast 模型用独立区域；(5) `VERTEX_REGION_CLAUDE_3_5_SONNET` 之类的 per-model 区域变量。
- **模型切换 / fallback**：`hooks/useMainLoopModel.ts` 做运行时模型切换；`ModelPicker.tsx` 是 UI 入口；`withRetry.ts` 里有**连续 3 次 529 触发 Opus → fallback 模型**的逻辑（默认只对 Opus，`FALLBACK_FOR_ALL_PRIMARY_MODELS` 可打开全模型 fallback），打 `tengu_api_opus_fallback_triggered` 事件。这是唯一的自动降级路径；fast mode 长时间被限流也会触发"冷却 30 分钟 → 回退标准 speed 模型"。

> 总结：claude-code 是"用 Anthropic SDK 统一，通过三个兄弟 SDK 打通云厂商"的设计。对非 Anthropic / 非 Bedrock-Anthropic 模型族（例如 OSS 本地模型）支持不好——但那从来不是 Anthropic 自家 CLI 的目标。

---

## 14. 其他 Agent-Specific 优势、亮点与效率提升

### 14.1 架构亮点

- **`promptCacheBreakDetection` + `microCompact` 的联动**：是同类里唯一明确处理"压缩操作会撞碎 cache"的设计。
- **Cache-safe sub-agent fork**：父子共享冻结 system prompt + `CacheSafeParams`，让 sub-agent 不会撞碎父的 prompt cache。
- **Hook 系统的事件密度**：25 种事件 + 4 种执行模式 + SSRF/白名单/policy 多层防御，目前市面最丰富。
- **Skill / Agent frontmatter → session hook 的反向注册**：让"skill 声明自己依赖什么 hook"成为一等语义。
- **权限模式的 UX 原语化**：`acceptEdits` / `plan` / `bypassPermissions` / `dontAsk` 直接对应用户心智，是产品打磨多轮的结果。
- **Plan Mode v2 的 multi-agent interview**：用多个 agent + 分阶段 prompt 做"执行前规划"，比单次 LLM 规划严谨。
- **自带 Ink fork**：避免对三方 npm 依赖的软约束，可以对 Yoga / focus / output 做深度改造。
- **`.claude/agents/` 让 subagent 类型可声明**：这是 codex 没有的能力——subagent 不是"每次都临时起"，而是命名资源。

### 14.2 性能与效率

- `StreamingToolExecutor` 流式展示工具输出；`runToolsConcurrently` 并发执行；`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 可调；`tool result budget` 落盘避免撑爆上下文；`FpsMetricsProvider` + `useDeferredHookMessages` 对 React 重渲染做缓解。

### 14.3 安全与沙盒

- 多层规则来源 + 危险命令硬编码剥离 + SSRF + URL 白名单 + env var 白名单 + policy 熔断 + workspace trust 对话 + bypass mode 运行时 killswitch + Linux 上的 bwrap 真沙盒。**弱点**：macOS/Windows 上的 sandbox 覆盖面与 codex 三端原生实现相比不够透明。

### 14.4 开发者体验

- `tengu_*` telemetry 事件非常密；`dumpPrompts.ts` 支持 prompt 导出；`Doctor.tsx` 提供健康检查屏；`/resume` / `/rewind` / 各种 session 命令让调试很顺。反面：自带 Ink fork 与 Tool 接口"业务+UI 耦合"提高二次开发门槛。

### 14.5 独特功能

- Claude.ai OAuth 登录（第一方订阅通道）；`PlanMode v2` interview；`.claude/agents/` 声明式 subagent；`TeammateIdle` / `SendMessageTool` 驱动的 swarm；远程 agent (CCR) 与本地 agent 的统一 task 模型；`RemoteTriggerTool` + `ScheduleCronTool` 的定时/远端触发；`ClaudeMdExternalIncludesDialog` + CLAUDE.md `@include`；CLAUDE.md 的 `managed memory` 企业下发通道。

---

## 总体评分

| 维度 | 评分 (1-5) | 一句话总结 |
|------|------------|------------|
| LLM 请求方式 | 5 | SDK 四路 + per-block cache_control + 1h TTL + Retry-After + 持久重试 + Opus fallback |
| Hooks | 5 | 25 种事件 + 4 种模式 + SSRF/policy 多层 + skill 反向注册 |
| 上下文管理 | 5 | autoCompact + microCompact + apiMicrocompact + sessionMemory + cache-break 联动 |
| Tool Use | 5 | 40+ 工具 + 并发执行 + tool result budget + MCP 六种 transport |
| Skill 管理 | 5 | 7 scope + fs watcher 热更新 + `context: fork` + skill → hook 注册 |
| Sub-Agent | 5 | AgentTool + 后台 Task + cache-safe fork + `.claude/agents/` 声明式 |
| TUI | 4 | 自带 Ink + 100+ 组件 UI，但无鼠标、无帧率钳位 |
| To-Do List | 3 | 三态扁平 + `activeForm` 追溯，但不持久化、无嵌套 |
| CLI Permission | 4 | 模式 UX 原语化 + 7 级规则 + classifier + Linux bwrap 真沙盒，跨平台一致性逊于 codex |
| API 缓存 | 5 | 业界目前对 Anthropic prompt cache 利用最深的实现 |
| 多模型支持 | 3 | Anthropic + Bedrock/Vertex/Foundry，OSS 生态零支持 |
| 整体工程成熟度 | 5 | 服务 / 状态 / UI / 安全 / 观测 / telemetry 全链路完整 |

### 最终客观评价与辩证分析

**核心优势**：claude-code 最突出的两块是**"对 Anthropic prompt cache 的工程利用"**与**"Hook / Skill / Sub-Agent 三位一体的扩展系统"**。前者体现在 per-block `cache_control` + 1h TTL latched + `promptCacheBreakDetection` + `notifyCacheDeletion` 的联动上——这是目前所有 agent CLI 中唯一真正"把 cache 当一等公民"的实现；后者体现在 25 种 hook 事件、7 种 skill scope、`.claude/agents/` 声明式 subagent 的组合上——扩展点多到让用户几乎任何 agent 行为都能插桩或替换。此外，`withRetry.ts` 的 Retry-After + 持久重试 + Opus fallback、`classifierDecision` 的 auto 模式、Plan Mode v2 的 multi-agent 规划、以及自带 Ink fork 带来的 UI 深度，都体现出一种"按产品真实需求打磨过很多轮"的成熟度。

**明显短板**：短板主要在**"沙盒的跨平台一致性"**与**"多模型生态开放性"**两方面。(1) Linux 上的 sandbox 通过 `@anthropic-ai/sandbox-runtime` 的 bwrap 路径做真隔离，但 macOS/Windows 上是否有等价强度的原生实现在这份代码快照里不直接可见（相关实现封在 npm 包内），对比之下 codex 在 Rust workspace 里同时维护 landlock / seatbelt / windows-sandbox-rs 三份明文实现，跨平台一致性更透明。(2) 多模型支持仅限 Anthropic + 三个云厂商 Anthropic 代理通道，OSS 本地模型、Gemini、GPT 完全没有一等位置——这在 Anthropic 自家 CLI 里是可以理解的商业选择，但会导致"想接非 Anthropic 模型的团队"无法采用。(3) TUI 的自带 Ink fork 和 Tool 接口的"业务+UI 耦合"对**二次开发**不友好，但对 Anthropic 内部快速迭代其实是优势。(4) Todo 不持久化、不嵌套、无依赖，对大型多 session 任务管理偏弱。(5) Plan Mode 与 Todo 之间语义没打通，计划完成后还要人工录成 todo。

**适用场景**：最适合 **已经在 Anthropic 生态（Claude.ai / API / Bedrock / Vertex / Foundry）内的开发者与企业团队**，尤其是需要 **"多 hook 深度插桩 + skill 库驱动 + 多 agent 协作 + 细粒度权限"** 的中大型项目。Plan Mode v2 与 coordinator mode 让它在 "一整天交给 agent 自己跑" 的长任务上有独特优势。反过来，如果你想在本地跑开源模型、或者完全不 buy in Anthropic 生态，这套 CLI 的价值会大幅缩水。

**发展建议**：若要再上一档，**首要补的是 sandbox 的跨平台透明度**——把 `@anthropic-ai/sandbox-runtime` 里 macOS/Windows 的具体后端（是否用 sandbox-exec / Job Object / seccomp filter 等）显式文档化，和 Linux 的 bwrap 路径对齐，避免"跨平台用户不知道自己到底有没有被真沙盒保护"。第二是**递归 sub-agent 的深度上限与资源配额**——目前只靠 `maxTurns` 间接收敛，容易出现 agent spawn 树失控。第三是**把 Todo 持久化并与 Plan Mode 打通**，让"规划 → 执行 → 跟踪 → 归档"成为一条线。

**横向对比定位**：和同期其他 CLI 相比，claude-code 的独特生态位是 **"Anthropic 自家出品的、把 Anthropic API 的每一条高级特性都吃透的 agent CLI"**——prompt caching、context management、thinking block、structured output、beta header、Bedrock/Vertex/Foundry 代理路径，它都有深度集成。它用 TypeScript + React + 自带 Ink 换取前端式的快速迭代与丰富 UI，用 hook / skill / agent 三件套换取极强的可扩展性，代价是跨平台 sandbox 的一致性/透明度比 codex 的 Rust 三端实现差一些，以及对非 Anthropic 生态几乎零开放。对 **"想在 Anthropic 生态里把 agent 能力用到极致"** 的用户，它是目前最佳选择；对 **"想要多厂商、需要清晰可审计的跨平台 sandbox"** 的用户，需要搭配别的工具或自行补齐。
