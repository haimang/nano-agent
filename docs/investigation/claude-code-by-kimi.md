# claude-code 深度分析

> 分析时间：2026-04-15  
> 分析对象：`/Users/feimeng/nano-agent/claude-code`  
> 分析者：Kimi
> 
> **本分析重点聚焦**：hooks 的详细实现机制、上下文管理的分层与压缩策略、skill 的加载顺序与去重逻辑。

---

## 1. 技术栈与项目结构

### 1.1 技术栈

| 维度 | 技术选型 |
|------|----------|
| **核心语言** | TypeScript (Node.js, ESM) |
| **UI 框架** | React + Ink（终端 React 渲染） |
| **状态管理** | 自定义基于 `Map` 的 AppState + React 上下文 |
| **API 客户端** | `@anthropic-ai/sdk` |
| **配置解析** | 自定义 frontmatter 解析 + Zod schema 验证 |
| **测试/VCR** | 自定义 VCR fixture 系统 |
| **构建/打包** | Bun (`bun:bundle`) |

### 1.2 关键目录

```
claude-code/
├── utils/hooks.ts              # Hook 执行总入口（5022 行）
├── utils/hooks/                # Hook 子系统
│   ├── AsyncHookRegistry.ts    # 异步 Hook 注册表
│   ├── execAgentHook.ts        # Agent 模式 Hook
│   ├── execPromptHook.ts       # Prompt/LLM 模式 Hook
│   ├── execHttpHook.ts         # HTTP 模式 Hook
│   ├── hooksConfigManager.ts   # Hook 配置元数据
│   └── sessionHooks.ts         # Session 级内存 Hook
├── services/compact/           # 上下文压缩核心
│   ├── compact.ts              # 主压缩逻辑
│   ├── autoCompact.ts          # 自动压缩触发器
│   └── microCompact.ts         # 微压缩
├── skills/
│   └── loadSkillsDir.ts        # Skill 发现、加载、去重
├── utils/messages.ts           # 消息规范化（API 前转换层，5512 行）
├── tools/                      # 40+ 个工具实现
└── services/api/claude.ts      # LLM API 调用层
```

---

## 2. Hooks 实现深度分析

claude-code 的 Hook 系统是其最具特色的架构之一。与 codex 的 Rust hook 引擎和 mini-agent 的缺乏通用 hook 形成鲜明对比，claude-code 实现了一套**多执行模式、事件驱动、支持匹配器（matcher）过滤**的完整 Hook 体系。

### 2.1 Hook 事件全景

在 `utils/hooks/hooksConfigManager.ts` 和 `types/hooks.ts` 中定义了 25+ 种事件：

| Hook 事件 | 触发时机 | Matcher 字段 |
|-----------|----------|--------------|
| `PreToolUse` | 工具执行前 | `tool_name` |
| `PostToolUse` | 工具执行成功后 | `tool_name` |
| `PostToolUseFailure` | 工具执行失败后 | `tool_name` |
| `PermissionDenied` | 自动模式拒绝工具调用后 | `tool_name` |
| `PermissionRequest` | 权限对话框显示时 | `tool_name` |
| `UserPromptSubmit` | 用户提交 prompt 时 | 无 |
| `SessionStart` | Session 启动/恢复/压缩后 | `source` (startup/resume/clear/compact) |
| `SessionEnd` | Session 结束时 | `reason` |
| `Stop` | Assistant 结束响应前 | 无 |
| `StopFailure` | API 错误结束 turn 时 | `error` |
| `SubagentStart` / `SubagentStop` | 子代理启动/停止时 | `agent_type` |
| `PreCompact` / `PostCompact` | 压缩前/后 | `trigger` (manual/auto) |
| `Setup` | Repo setup (init/maintenance) | `trigger` |
| `Elicitation` / `ElicitationResult` | MCP elicitation 请求/响应时 | `mcp_server_name` |
| `ConfigChange` | 配置文件变更时 | `source` |
| `CwdChanged` / `FileChanged` | 工作目录变更/监视文件变更时 | 无 |
| `InstructionsLoaded` | CLAUDE.md / rule 加载时 | `load_reason` |
| `TeammateIdle` / `TaskCreated` / `TaskCompleted` | 团队协作相关 | 无 |
| `WorktreeCreate` / `WorktreeRemove` | Worktree 操作 | 无 |

### 2.2 Hook 的五种执行引擎

claude-code 的 Hook 不局限于 shell 脚本，支持 **5 种执行模式**，由 `executeHooks` 统一调度（`utils/hooks.ts:1952`）：

#### (1) Command Hook（Shell 命令）

`execCommandHook`（`utils/hooks.ts:747`）是最大、最复杂的实现：

- **Shell 选择**：`hook.shell` → 默认 `bash`；Windows 上显式查找 Git Bash（`findGitBashPath()`）；支持 `powershell` 模式（`-NoProfile -NonInteractive -Command`）。
- **环境变量注入**：
  - `CLAUDE_PROJECT_DIR` = 稳定项目根目录
  - `CLAUDE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_DATA` = 插件根目录和数据目录
  - `CLAUDE_PLUGIN_OPTION_*` = 插件配置项
  - `CLAUDE_ENV_FILE` = `.sh` 文件路径（仅 SessionStart/Setup/CwdChanged/FileChanged），Hook 可往里面写 `export FOO=bar`，后续 BashTool 会自动 source。
- **路径处理**：Windows bash 路径通过 `windowsPathToPosixPath` 将 `C:\Users\foo` 转为 `/c/Users/foo`。
- **执行模式**：
  - 同步：等待子进程退出，解析 stdout 第一行 JSON。
  - 异步（`hook.async: true`）：通过 `shellCommand.background()` 后台化，注册到 `AsyncHookRegistry`，由主循环定期检查完成状态。
  - 异步唤醒（`hook.asyncRewake: true`）：更特殊的后台模式，完成后若 exit code 2 则通过 `enqueuePendingNotification` 唤醒模型继续处理。

#### (2) Prompt Hook（单轮 LLM）

`execPromptHook`（`utils/hooks/execPromptHook.ts:21`）：

- 使用 `queryModelWithoutStreaming` 调用一个轻量模型（默认 Haiku/`getSmallFastModel()`）。
- Prompt 中会将 `$ARGUMENTS` 替换为 JSON 化的 hook input。
- 要求模型返回结构化 JSON：`{"ok": true}` 或 `{"ok": false, "reason": "..."}`。
- 超时默认 30 秒。

#### (3) Agent Hook（多轮 Agent）

`execAgentHook`（`utils/hooks/execAgentHook.ts:36`）：

- 创建一个全新的子 Agent（`hook-agent-${UUID}`），复用主会话的 tool 集合（但过滤掉 `ALL_AGENT_DISALLOWED_TOOLS`，禁止子 Agent 再 spawn 子 Agent 或进入 plan mode）。
- 通过 `query({ ... })` 执行最多 `MAX_AGENT_TURNS = 50` 轮的多轮对话。
- 子 Agent 必须调用 `StructuredOutput` 工具返回 `{"ok": boolean, "reason?": string}`。
- 子 Agent 的权限模式被强制设为 `dontAsk`，并自动允许读取 transcript 文件。
- 超时默认 60 秒。

#### (4) HTTP Hook

`execHttpHook`（`utils/hooks/execHttpHook.ts:123`）：

- 通过 `axios.post` 将 JSON input 发送到配置的 URL。
- 支持 `headers` 中的环境变量插值（仅限 `allowedEnvVars` 白名单中的变量），防止 secrets 外泄。
- 支持 URL allowlist（`allowedHttpHookUrls`）和 SSRF 防护（`ssrfGuardedLookup`）。
- 当沙盒启用时，自动通过 SandboxManager 的网络代理路由请求。

#### (5) Callback / Function Hook（内存回调）

`sessionHooks.ts` 实现：

```typescript
export type FunctionHook = {
  type: 'function'
  id?: string
  timeout?: number
  callback: FunctionHookCallback  // (messages: Message[], signal?) => boolean | Promise<boolean>
  errorMessage: string
  statusMessage?: string
}
```

- 完全在内存中执行 TypeScript 回调，**不持久化**到 `settings.json`。
- 用于插件或内部逻辑（如归因追踪、session file access analytics）。
- `executeHooks` 中对纯 callback hooks 有 **fast path**：跳过 JSON 序列化、进度追踪、OTel span，直接串行调用（实测 6µs → 1.8µs）。

### 2.3 Hook 统一调度器：`executeHooks`

所有事件最终都流入 `async function* executeHooks({ ... })`（`utils/hooks.ts:1952`）。

**执行流程（代码事实）**：

1. **前置检查**：
   - `shouldDisableAllHooksIncludingManaged()` → 全局禁用则直接返回。
   - `isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)` → simple 模式禁用。
   - `shouldSkipHookDueToTrust()` → **交互模式下所有 Hook 都需要 workspace trust**，这是防御 RCE 的核心安全边界。

2. **匹配 Hook**：
   ```typescript
   const matchingHooks = await getMatchingHooks(
     appState, sessionId, hookEvent, hookInput, toolUseContext?.options?.tools
   )
   ```
   匹配逻辑支持：
   - `settings.json` 中配置的 hooks
   - plugin 注册的 hooks (`getRegisteredHooks`)
   - session 级别的临时 hooks (`sessionHooks`)
   - matcher 过滤（如 `tool_name === "Bash"`）

3. **并行执行**：
   ```typescript
   const hookPromises = matchingHooks.map(async function* ({ hook, pluginRoot, pluginId, skillRoot }, hookIndex): AsyncGenerator<HookResult> {
     if (hook.type === 'callback') { ... }
     if (hook.type === 'function') { ... }
     // command / prompt / agent / http hooks 共享同一个 jsonInput 序列化结果
     const jsonInput = getJsonInput()
     // ...
   })
   ```
   所有匹配到的 Hook **并发执行**，每个有自己的 timeout 和 `AbortSignal`。

4. **输出解析**：
   - 对于 command hook：读取 stdout，尝试解析第一行以 `{` 开头的 JSON。
   - 若解析出 `{"async": true}`，则后台化该 hook。
   - 否则调用 `processHookJSONOutput` 将 JSON 映射为 `HookResult`。

### 2.4 Hook 结果与权限系统的深度集成

在 `services/tools/toolHooks.ts:332`，`resolveHookPermissionDecision` 函数明确了 Hook 决策与权限规则的关系：

```typescript
// Hook 'allow' 不会绕过 settings.json 的 deny/ask 规则
if (hookPermissionResult?.behavior === 'allow') {
  const ruleCheck = await checkRuleBasedPermissions(tool, hookInput, toolUseContext)
  if (ruleCheck === null) {
    return { decision: hookPermissionResult, input: hookInput }
  }
  if (ruleCheck.behavior === 'deny') {
    return { decision: ruleCheck, input: hookInput }
  }
  // ask rule — 仍然需要弹出权限对话框
  return { decision: await canUseTool(...), input: hookInput }
}
```

这意味着：
- **Hook 可以收紧权限**（deny），但不能完全绕过用户配置的 deny/ask 规则。
- `updatedInput` 机制允许 Hook 修改工具参数后再交给权限系统判断（例如自动填充交互式工具的参数）。

### 2.5 PreToolUse / PostToolUse 的调用点

在 `services/tools/toolHooks.ts` 中：

- `runPreToolUseHooks`（line 435）在工具执行前被调用，yield 的结果包括：
  - `hookPermissionResult`（allow/deny/ask）
  - `updatedInput`（修改后的参数）
  - `additionalContext`（注入给模型的上下文）
  - `blockingError` / `stopReason`
- `runPostToolHooks`（line 39）在工具成功后调用，yield 的结果包括：
  - `updatedMCPToolOutput`（修改 MCP 工具输出）
  - `additionalContexts`
  - `blockingError` / `preventContinuation`
- `runPostToolUseFailureHooks`（line 193）在工具失败后调用。

---

## 3. 上下文管理与分层策略

claude-code 的上下文管理是一个**多层、多阶段**的管道，核心文件是 `utils/messages.ts`（5512 行）和 `services/compact/compact.ts`（1705 行）。

### 3.1 消息类型的丰富性

claude-code 内部消息流远比简单的 user/assistant/tool 复杂：

| 类型 | 子类型/说明 |
|------|-------------|
| `user` | 普通用户消息、meta 消息（如附件、系统提醒） |
| `assistant` | 模型回复，包含 text/thinking/tool_use |
| `system` | `compact_boundary`, `api_error`, `microcompact_boundary`, `local_command` |
| `attachment` | 文件附件、hook 结果、delta 通知（如工具列表变更） |
| `progress` | 流式进度（如 Hook 执行中、工具调用中） |
| `virtual` | 仅用于 REPL 内部显示，**绝不会发送到 API** |

### 3.2 消息规范化管道：`normalizeMessagesForAPI`

在每次调用 API 前，所有消息都必须经过 `normalizeMessagesForAPI`（`utils/messages.ts:1989`）。这是一个**多阶段转换管道**：

```typescript
export function normalizeMessagesForAPI(
  messages: Message[],
  tools: Tools = [],
): (UserMessage | AssistantMessage)[] {
```

**阶段 1：重新排序与过滤**
- `reorderAttachmentsForAPI`：将 attachment 消息向上冒泡，直到碰到 tool result 或 assistant message。
- 过滤掉 `isVirtual` 消息和 `progress` 消息。
- 过滤掉 `system` 消息（除了 `local_command` 会被转为 user message）。

**阶段 2：错误驱动的内容剥离**
- 如果之前出现过 `pdf_too_large`、`image_too_large`、`request_too_large` 等合成错误消息，会回溯找到对应的 `isMeta` user message，**剥离掉 document/image 块**，防止在后续每次 API 调用中重复发送导致错误的内容。

**阶段 3：User Message 合并与 Tool Reference 处理**
- 合并连续的 user message（Bedrock 不支持连续 user turn）。
- 处理 `tool_reference` 块的特殊边界注入（防止模型在 tool result 后错误地输出 stop sequence）。

**阶段 4：Assistant Message 规范化**
- 对每个 `tool_use` 块，通过 `normalizeToolInputForAPI` 清理字段（如从 `ExitPlanModeV2` 中移除 `plan` 字段）。
- **合并相同 `message.id` 的 assistant message**：支持并发 agent（teammates）的交错流式内容块合并。

**阶段 5：后处理链**
- `relocateToolReferenceSiblings`：重新定位 tool_reference 的文本兄弟节点。
- `filterOrphanedThinkingOnlyMessages`：过滤掉只有 thinking 块没有文本内容的孤立 assistant 消息（避免 API 400 错误）。
- `filterTrailingThinkingFromLastAssistant`：移除最后一个 assistant 末尾的 thinking 块。
- `filterWhitespaceOnlyAssistantMessages`：过滤掉仅包含空白字符的 assistant 消息。
- `ensureNonEmptyAssistantContent`：确保 assistant 消息非空。
- `smooshSystemReminderSiblings`：将 `<system-reminder>` 前缀的文本块折叠到相邻的 tool_result 中（ gated 功能）。
- `sanitizeErrorToolResultContent`：清理错误 tool_result 中的图像内容。
- `appendMessageTagToUserMessage`：为 snip 工具添加 `[id:xxx]` 标签。
- `validateImagesForAPI`：验证所有图像未超出 API 大小限制。

### 3.3 上下文压缩（Compaction）

当上下文窗口接近阈值时，claude-code 会触发 `compactConversation`（`services/compact/compact.ts:387`）。这是一个**全量摘要**策略，与 mini-agent 的轮询式摘要和 codex 的 pre-turn/mid-turn compaction 都不同。

**压缩流程（代码事实）**：

1. **PreCompact Hooks**：执行 `executePreCompactHooks`，可返回 `newCustomInstructions` 注入到摘要 prompt 中。

2. **摘要生成**：
   ```typescript
   const compactPrompt = getCompactPrompt(customInstructions)
   const summaryRequest = createUserMessage({ content: compactPrompt })
   summaryResponse = await streamCompactSummary({
     messages: messagesToSummarize,
     summaryRequest,
     ...
   })
   ```
   将**整个历史**（或截断后的历史）作为输入，让 LLM 生成一段自然语言摘要。

3. **Prompt-Too-Long 重试**：
   如果摘要请求本身触发 PTL（prompt too long），会调用 `truncateHeadForPTLRetry` 截断最旧的消息组（按 API round 分组），最多重试 `MAX_PTL_RETRIES` 次。

4. **状态清理**：
   - `context.readFileState.clear()`
   - `context.loadedNestedMemoryPaths?.clear()`
   - **不重置** `sentSkillNames`（避免重新注入完整的 skill listing 浪费 token）

5. **Post-Compact 附件重建**：
   压缩后，claude-code 会主动重建一系列上下文附件，确保模型在压缩后仍有足够背景：
   - `createPostCompactFileAttachments`：恢复最近读取的最多 5 个文件（每个 5000 token 预算）。
   - `createAsyncAgentAttachmentsIfNeeded`：恢复活跃子代理信息。
   - `createPlanAttachmentIfNeeded`：恢复计划文件。
   - `createPlanModeAttachmentIfNeeded`：如果当前在 plan mode，恢复 plan mode 指令。
   - `createSkillAttachmentIfNeeded`：恢复已调用的 skill 内容。
   - `getDeferredToolsDeltaAttachment`：重新宣布 deferred tool schema。
   - `getAgentListingDeltaAttachment`：重新宣布活跃 agent 列表。
   - `getMcpInstructionsDeltaAttachment`：重新宣布 MCP 指令。

6. **边界标记与摘要消息**：
   ```typescript
   const boundaryMarker = createCompactBoundaryMessage(
     isAutoCompact ? 'auto' : 'manual',
     preCompactTokenCount,
     messages.at(-1)?.uuid,
   )
   ```
   生成一个 `system` 类型的 `compact_boundary` 消息，标记压缩点。

   同时生成一个 `isCompactSummary: true` 的 user message：
   ```typescript
   const summaryMessages: UserMessage[] = [
     createUserMessage({
       content: getCompactUserSummaryMessage(summary, suppressFollowUpQuestions, transcriptPath),
       isCompactSummary: true,
       isVisibleInTranscriptOnly: true,
     }),
   ]
   ```

7. **SessionStart + PostCompact Hooks**：压缩完成后，还会再次执行 SessionStart hooks 和 PostCompact hooks，允许外部逻辑在压缩后注入额外上下文。

### 3.4 压缩后的消息切片

在 API 调用前，`getMessagesAfterCompactBoundary`（`utils/messages.ts:4643`）负责决定哪些消息进入 API：

```typescript
export function getMessagesAfterCompactBoundary<T extends Message | NormalizedMessage>(
  messages: T[],
  options?: { includeSnipped?: boolean }
): T[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  const sliced = boundaryIndex === -1 ? messages : messages.slice(boundaryIndex)
  if (!options?.includeSnipped && feature('HISTORY_SNIP')) {
    return projectSnippedView(sliced as Message[]) as T[]
  }
  return sliced
}
```

- 如果历史中有 `compact_boundary`，则**只从该边界开始往后取**（包含边界本身，但边界是 system 消息，会在 `normalizeMessagesForAPI` 中被过滤）。
- 如果开启了 `HISTORY_SNIP`，还会进一步应用 snip 投影，将某些消息标记为 "snipped" 并跳过。

### 3.5 上下文分层的整体视图

可以将 claude-code 的上下文视为以下层次（从底到顶）：

1. **System Prompt**：基础人格、工具 schema、MCP 指令、Agent 列表。
2. **User Context**：当前工作目录、文件附件、图片、计划文件。
3. **Message History**：
   - 若发生过 Compaction：仅保留 `compact_boundary` 之后的消息。
   - 最老的一条通常是 Compact Summary（user message）。
   - 中间是最近的 N 轮 user/assistant/tool 交互。
   - 最新的 user message 包含当前用户输入 + 各种 attachment。
4. **实时注入**：
   - 在 `normalizeMessagesForAPI` 阶段，attachment 被合并到 user message 中。
   - 工具调用参数在最后一刻被规范化（`normalizeToolInputForAPI`）。

---

## 4. Skill 实现与加载顺序

claude-code 的 Skill 系统位于 `skills/loadSkillsDir.ts`（1086 行），采用**多级目录扫描 + 去重 + 条件激活**的复杂策略。

### 4.1 Skill 的物理格式

- **目录格式**：`skill-name/SKILL.md`
- **Legacy 命令格式**：`.claude/commands/*.md`（单个文件）
- **Frontmatter 字段**：`name`, `description`, `tools` (allowedTools), `paths` (条件匹配), `hooks`, `model`, `when-to-use`, `version`, `user-invocable` 等。

### 4.2 Skill 加载顺序（优先级从高到低）

核心函数 `getSkillDirCommands`（`skills/loadSkillsDir.ts:638`）使用 `memoize` 缓存结果，按以下顺序并行加载：

```typescript
const [
  managedSkills,      // ~/.claude-managed/.claude/skills  (policySettings)
  userSkills,         // ~/.claude/skills                (userSettings)
  projectSkillsNested, // 从 CWD 向上遍历的 .claude/skills (projectSettings)
  additionalSkillsNested, // --add-dir 指定的目录          (projectSettings)
  legacyCommands,     // .claude/commands/*               (commands_DEPRECATED)
] = await Promise.all([...])
```

**注意**：虽然加载是并行的，但**去重逻辑采用 first-wins**。合并数组的顺序是：

```typescript
const allSkillsWithPaths = [
  ...managedSkills,      // 最高优先级
  ...userSkills,
  ...projectSkillsNested.flat(),
  ...additionalSkillsNested.flat(),
  ...legacyCommands,     // 最低优先级
]
```

### 4.3 去重机制：基于真实路径

claude-code 不使用简单的文件路径字符串去重，而是通过 `realpath` 解析符号链接：

```typescript
async function getFileIdentity(filePath: string): Promise<string | null> {
  try {
    return await realpath(filePath)
  } catch {
    return null
  }
}
```

去重流程（`loadSkillsDir.ts:728-763`）：

```typescript
const fileIds = await Promise.all(
  allSkillsWithPaths.map(({ skill, filePath }) =>
    skill.type === 'prompt' ? getFileIdentity(filePath) : Promise.resolve(null)
  )
)

const seenFileIds = new Map<string, SettingSource | 'builtin' | 'mcp' | 'plugin' | 'bundled'>()
const deduplicatedSkills: Command[] = []

for (let i = 0; i < allSkillsWithPaths.length; i++) {
  const entry = allSkillsWithPaths[i]
  const fileId = fileIds[i]
  if (fileId === null || fileId === undefined) {
    deduplicatedSkills.push(skill)
    continue
  }
  const existingSource = seenFileIds.get(fileId)
  if (existingSource !== undefined) {
    // 跳过重复文件（保留先出现的 = 高优先级来源）
    continue
  }
  seenFileIds.set(fileId, skill.source)
  deduplicatedSkills.push(skill)
}
```

这意味着：
- 如果同一个 skill 文件通过符号链接出现在 `userSettings` 和 `projectSettings` 中，`realpath` 会识别出它们是同一个文件，优先保留 `userSettings` 的那个（因为合并顺序中 userSkills 在前）。
- 非 `prompt` 类型的 skill 不参与去重（直接保留）。

### 4.4 条件 Skills（Conditional Skills）

Skill 可以通过 `paths` frontmatter 声明条件匹配规则（gitignore 风格）：

```yaml
---
name: react-component-skill
paths: "src/components/**"
---
```

加载时，这些 skill 被分离出来：

```typescript
const unconditionalSkills: Command[] = []
const newConditionalSkills: Command[] = []
for (const skill of deduplicatedSkills) {
  if (skill.type === 'prompt' && skill.paths && skill.paths.length > 0 && !activatedConditionalSkillNames.has(skill.name)) {
    newConditionalSkills.push(skill)
  } else {
    unconditionalSkills.push(skill)
  }
}
```

- **无条件 Skills**：立即进入 skill listing，对模型可见。
- **条件 Skills**：存入 `conditionalSkills` Map，**初始不暴露给模型**。

当 `ReadTool`、`WriteTool`、`EditTool` 等文件操作触及特定路径时，`activateConditionalSkillsForPaths` 被调用：

```typescript
export function activateConditionalSkillsForPaths(filePaths: string[], cwd: string): string[] {
  // 使用 ignore 库进行 gitignore 风格匹配
  const newlyActivated: string[] = []
  for (const [skillName, skill] of conditionalSkills) {
    const ig = ignore().add(skill.paths)
    const relativePaths = filePaths.map(p => relative(cwd, p))
    if (relativePaths.some(p => ig.ignores(p))) {
      activatedConditionalSkillNames.add(skillName)
      dynamicSkills.set(skillName, skill)
      newlyActivated.push(skillName)
    }
  }
  return newlyActivated
}
```

一旦激活，该 skill 就会被加入 `dynamicSkills`，后续 skill listing 会包含它。

### 4.5 动态 Skill 发现（Nested Discovery）

当用户在深层目录工作时，claude-code 不仅加载 CWD 级别的 skills，还会**沿文件路径向上发现嵌套目录的 skills**（直到 CWD 为止，不包含 CWD 本身）：

```typescript
export async function discoverSkillDirsForPaths(filePaths: string[], cwd: string): Promise<string[]> {
  for (const filePath of filePaths) {
    let currentDir = dirname(filePath)
    while (currentDir.startsWith(resolvedCwd + pathSep)) {
      const skillDir = join(currentDir, '.claude', 'skills')
      if (!dynamicSkillDirs.has(skillDir)) {
        // 检查 gitignored（防止 node_modules/.claude/skills）
        if (await isPathGitignored(currentDir, resolvedCwd)) {
          continue
        }
        newDirs.push(skillDir)
      }
      currentDir = dirname(currentDir)
    }
  }
  // 按路径深度排序（最深的优先）
  return newDirs.sort((a, b) => b.split(pathSep).length - a.split(pathSep).length)
}
```

加载动态 skills 时，更深的目录会覆盖更浅的同名 skill：

```typescript
for (let i = loadedSkills.length - 1; i >= 0; i--) {
  for (const { skill } of loadedSkills[i] ?? []) {
    if (skill.type === 'prompt') {
      dynamicSkills.set(skill.name, skill)
    }
  }
}
```

这实现了**目录层级越接近文件，skill 优先级越高**的语义。

### 4.6 Skill 中的 Hooks

Skill 可以通过 frontmatter 声明自己的 hooks：

```typescript
function parseHooksFromFrontmatter(frontmatter: FrontmatterData, skillName: string): HooksSettings | undefined {
  if (!frontmatter.hooks) return undefined
  const result = HooksSchema().safeParse(frontmatter.hooks)
  return result.success ? result.data : undefined
}
```

当 skill 被加载时，这些 hooks 会通过 `registerSkillHooks` 注册到 session hooks 中，与 `settings.json` 中配置的 hooks 合并执行。

---

## 5. 其他有意思的地方

### 5.1 权限与 Hook 的交叉设计

`utils/hooks.ts:286` 中有一个极其关键的安全设计：

```typescript
export function shouldSkipHookDueToTrust(): boolean {
  const isInteractive = !getIsNonInteractiveSession()
  if (!isInteractive) return false
  const hasTrust = checkHasTrustDialogAccepted()
  return !hasTrust
}
```

**所有 Hook 在交互模式下都要求 workspace trust**。这直接防止了未信任项目中的 `.claude/settings.json` 或 skill hooks 在用户不知情时执行任意代码。历史上曾出现过 "用户拒绝 trust dialog 后 SessionEnd hook 仍然执行" 的漏洞，这个集中式检查就是修复方案。

### 5.2 `asyncRewake` Hook 的特殊生命周期

某些 Stop hooks 使用 `asyncRewake: true`，它们不会进入 `AsyncHookRegistry`，而是直接 `then()` 等待 shell 结果：

```typescript
void shellCommand.result.then(async result => {
  await new Promise(resolve => setImmediate(resolve))
  const stdout = await shellCommand.taskOutput.getStdout()
  const stderr = shellCommand.taskOutput.getStderr()
  shellCommand.cleanup()
  if (result.code === 2) {
    enqueuePendingNotification({
      value: wrapInSystemReminder(`Stop hook blocking error...`),
      mode: 'task-notification',
    })
  }
})
```

这意味着：**Stop hook 可以在用户已经回到 idle 状态后，通过 notification 机制重新唤醒 Agent 继续对话**。这是实现 "后台检查完成后报告结果" 的关键。

### 5.3 Compaction 的成本意识

在 `compact.ts` 中，claude-code 精确追踪了 compact 的真实成本：

```typescript
const truePostCompactTokenCount = roughTokenCountEstimationForMessages([
  boundaryMarker,
  ...summaryMessages,
  ...postCompactFileAttachments,
  ...hookMessages,
])
```

并且会记录 `willRetriggerNextTurn` 指标，用于 A/B 测试和自动压缩阈值的调优。这种对 token 成本的精细化度量，反映了 Anthropic 在工程上的严谨性。

### 5.4 Tool Reference 的模型行为矫正

`normalizeMessagesForAPI` 中有大量代码专门处理 `tool_reference` 块：

```typescript
// Server renders tool_reference expansion as <functions>...</functions>
// (same tags as the system prompt's tool block). When this is at the
// prompt tail, capybara models sample the stop sequence at ~10% ...
```

这揭示了生产级 Agent 的一个深刻教训：**模型输出 stop sequence 的 bug 往往源于 system prompt 中的工具声明与消息历史中 tool_reference 内容的边界冲突**。claude-code 通过多重 fallback（注入 turn boundary、relocate siblings、merge and smoosh）来修正这种边缘行为。

---

## 总结

claude-code 在三个维度上展现出了远超 mini-agent 和 codex 的设计深度：

1. **Hooks**：不仅是生命周期回调，更是一个**多执行引擎（shell/LLM/agent/HTTP/callback）的插件运行时**，与权限系统深度交织，且以 workspace trust 为刚性安全边界。
2. **上下文管理**：通过 `normalizeMessagesForAPI` 实现了一个**工业级的消息规范化和修复管道**，配合 Compaction 实现了在上下文窗口限制下的**状态ful 恢复**（重建文件附件、plan、skill、agent 列表）。
3. **Skill 系统**：采用了**多级来源（managed > user > project > additional > legacy）+ 真实路径去重 + 条件激活 + 动态目录发现**的复杂策略，使得 skill 的加载既灵活又不会产生重复或冲突。
