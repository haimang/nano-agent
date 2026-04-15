# Agent CLI 深度分析模板

> 分析对象: `MiniMax-AI/Mini-Agent` (mini-agent)
> 分析时间: `2026-04-15`
> 分析者: `Claude Opus 4.6 (1M context)`
> 文件位置: `context/mini-agent/`

---

## 1. 技术栈

| 维度 | 技术选型 |
|------|----------|
| **核心语言** | Python (≥3.10，使用 PEP 604 `\|` 联合类型) |
| **运行时 / 框架** | `asyncio` 全异步；纯进程内运行，无 web server |
| **包管理 / 构建工具** | `uv` (uv.lock + pyproject.toml)；`MANIFEST.in` 控制 sdist |
| **UI / CLI 库** | `prompt_toolkit` (`PromptSession` + `KeyBindings` + `WordCompleter` + `FileHistory`) + 手写 ANSI 颜色，**没有 ratatui / Ink / textual 这类组件框架** |
| **LLM SDK / API 客户端** | `anthropic` (官方 Python SDK) + `openai` (官方 Python SDK)，两者都走"自定义 base_url"绕到 MiniMax 自己的兼容端点 |
| **配置解析** | `PyYAML` (config.yaml)，`pydantic.BaseModel` 做 schema |
| **测试框架** | `tests/` 目录存在，但本快照里未见显式 runner 配置，`pyproject.toml` 默认走 pytest |
| **其他关键依赖** | `tiktoken` (token 估算)、`mcp` (官方 Model Context Protocol Python SDK，含 `stdio_client`/`sse_client`/`streamablehttp_client`)、`acp` (Agent Client Protocol bindings)、`pydantic` |

> 这是一个**轻量、教学向、同时刻意"小而完整"**的 agent CLI——总代码量约 **5,164 行**（含 ACP bridge、不含 bundled skill 文档），是 codex / claude-code 的几十分之一，但仍然覆盖了 LLM 双协议、MCP 三种 transport、Skills 渐进披露、ACP 远端协议等关键模块。它的目标显然不是成为 production-grade 的"全能 IDE 助手"，而是把 agent loop 的核心要素**示范干净**。

---

## 2. 目录结构

```
context/mini-agent/
├── mini_agent/
│   ├── __init__.py
│   ├── agent.py                # Agent 主循环 (523 行)
│   ├── cli.py                  # 交互式 CLI 入口 (873 行)
│   ├── config.py               # YAML 配置 + pydantic schema
│   ├── logger.py               # 单文件 plain-text 运行日志
│   ├── retry.py                # 异步重试装饰器
│   ├── llm/                    # === LLM 请求层 ===
│   │   ├── base.py             # `LLMClientBase` ABC
│   │   ├── anthropic_client.py # Anthropic SDK 实现
│   │   ├── openai_client.py    # OpenAI SDK 实现
│   │   └── llm_wrapper.py      # `LLMClient` 双协议 facade
│   ├── tools/                  # === Tool Use ===
│   │   ├── base.py             # Tool / ToolResult 基类
│   │   ├── bash_tool.py        # BashTool / BashOutputTool / BashKillTool + 后台进程管理
│   │   ├── file_tools.py       # ReadTool / WriteTool / EditTool
│   │   ├── note_tool.py        # SessionNoteTool / RecallNoteTool
│   │   ├── skill_loader.py     # SKILL.md 解析 + 路径替换
│   │   ├── skill_tool.py       # GetSkillTool（progressive disclosure level 2）
│   │   └── mcp_loader.py       # MCP server 连接与工具发现
│   ├── skills/                 # 14 个 bundled skill 目录
│   ├── schema/schema.py        # Message / ToolCall / LLMResponse / TokenUsage
│   ├── config/                 # config-example.yaml + mcp-example.json + system_prompt.md
│   ├── acp/                    # === ACP server ===
│   │   ├── __init__.py         # `MiniMaxACPAgent` 把现有 Agent 包装成 ACP 协议端
│   │   └── server.py
│   └── utils/terminal_utils.py # 显示宽度计算（含中日韩宽字符）
├── docs/
├── examples/
├── scripts/
├── tests/
├── pyproject.toml
├── uv.lock
└── README.md
```

> 关键观察：**没有** Hooks 子系统、**没有** Sub-Agent、**没有** Permission/Sandbox 模块、**没有** TodoList 工具、**没有** TUI 组件树。这些缺位都是有意识的极简化决策。

---

## 3. LLM 请求方式详细说明

### 3.1 LLM 请求引擎的实现

- **认证**：纯 API key + custom `base_url`。Anthropic 客户端 (`llm/anthropic_client.py:42-46`) 同时设置 `api_key` 与 `default_headers={"Authorization": f"Bearer {api_key}"}`——这是一个**罕见的双重注入**：anthropic SDK 自己会塞 `x-api-key` header，再叠一个 `Authorization: Bearer` 是为了让兼容端点（MiniMax `https://api.minimaxi.com/anthropic`）能识别成"OAuth bearer"。OpenAI 客户端（`openai_client.py:43-46`）只用 `api_key` 走标准注入。
- **入口封装**：`llm/llm_wrapper.py:18` 的 `LLMClient` 是 facade，按 `provider` (`LLMProvider.ANTHROPIC` / `LLMProvider.OPENAI`) 实例化对应子类；它额外做了一件事——**自动 base_url 改写**：检测到 `api.minimax.io` / `api.minimaxi.com` 域名时，按 provider 自动追加 `/anthropic` 或 `/v1` 后缀（L66-78）。这把"MiniMax 自家网关"的细节从用户手里拿走。
- **流式 vs 非流式**：**全部非流式**。`anthropic_client.py:80` 的 `await self.client.messages.create(**params)` 直接拿一次性的 `Message` 对象；`openai_client.py:76` 的 `await self.client.chat.completions.create(**params)` 同理。CLI 侧在拿到完整响应后才一次性 print——没有 token-by-token 输出。
- **请求体构建**：Anthropic 路径只放 `model`、`max_tokens=16384`（**硬编码**）、`messages`、可选 `system`、可选 `tools`；OpenAI 路径放 `model`、`messages`（system 内嵌在 messages 里）、`tools`、以及一个 MiniMax 专属的 `extra_body={"reasoning_split": True}` 让服务端把 thinking 段独立返回。**没有** `temperature`、`top_p`、`stop`、`metadata`、`thinking.budget_tokens`、`stream`、`cache_control`——全部按 SDK 默认值。
- **响应解析**：Anthropic 路径 (`anthropic_client.py:202-255`) 遍历 `response.content` 区分 `text` / `thinking` / `tool_use`，把 `tool_use.input` 直接保留为 dict（避免字符串解析）；token usage 把 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` 全加到 `prompt_tokens` 里，再加上 `output_tokens` 作为 `total_tokens`。OpenAI 路径 (`openai_client.py:203-259`) 把 `message.content` 当 text，从 `message.reasoning_details` 拉 thinking 段，从 `message.tool_calls` 拉工具调用并 `json.loads(arguments)` 还原成 dict；`finish_reason` 直接硬编码成 `"stop"`（这是个**潜在 bug**——OpenAI SDK 实际暴露的字段是 `choices[0].finish_reason`，作者注释里也承认"OpenAI doesn't provide finish_reason in the message"，其实是看错了位置）。
- **重试**：`retry.py` 的 `async_retry` 装饰器，配置项 `RetryConfig {enabled, max_retries=3, initial_delay=1.0, max_delay=60.0, exponential_base=2.0, retryable_exceptions=(Exception,)}`。指数退避**没有 jitter**，**没有 Retry-After header 解析**，**默认对 `Exception` 全捕获**——这意味着 `KeyboardInterrupt` 之类不会被吞，但 `ValueError` 这种"代码 bug"也会被无脑重试 3 次，浪费时间。
- **缓存**：客户端层**完全没有** prompt cache 设计。请求里没有 `cache_control`，响应里虽然能解析到 `cache_read_input_tokens` 与 `cache_creation_input_tokens`，但只是**累加进 prompt_tokens 总数**，没有任何"命中率统计 / cache break 检测 / TTL 管理"逻辑。
- **持久化**：`logger.py` 的 `AgentLogger` 把每次 `run()` 写到 `~/.mini-agent/log/agent_run_<timestamp>.log`，是**人类可读的 plain-text**（带 80 字符分隔线、`[N] REQUEST/RESPONSE/TOOL_RESULT` 标签、JSON 格式化的 messages/tools/result 块）——这意味着它**不是**用来程序化 resume 会话的格式，而是用来 debug / 复盘的。会话历史本身只活在 `Agent.messages: list[Message]` 内存里；进程一退出，就只剩 log 文件。

### 3.2 LLM 请求代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `mini_agent/llm/base.py` | `LLMClientBase` ABC |
| `mini_agent/llm/anthropic_client.py` | Anthropic SDK 实现：消息转换、tool_use/thinking 解析、token usage |
| `mini_agent/llm/openai_client.py` | OpenAI SDK 实现：含 MiniMax `reasoning_split` 与 `reasoning_details` 处理 |
| `mini_agent/llm/llm_wrapper.py` | 双协议 facade + MiniMax base_url 自动后缀 |
| `mini_agent/retry.py` | 异步指数退避装饰器 |
| `mini_agent/logger.py` | plain-text 运行日志 |
| `mini_agent/schema/schema.py` | `Message` / `ToolCall` / `LLMResponse` / `TokenUsage` |

### 3.3 LLM 请求子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 认证机制 | 纯 API key；Anthropic 路径再叠 `Authorization: Bearer` | 双重注入是为兼容 MiniMax 网关 |
| API Wrapper | `LLMClient` facade + `AnthropicClient` / `OpenAIClient` | provider 抽象很薄 |
| 重试机制 | 指数退避（无 jitter / 无 Retry-After）、默认 `Exception` 全捕获 | 简单但过于宽松 |
| 本地缓存 | **无** | 既无 cache_control 也无统计 |
| Session 持久化 | `~/.mini-agent/log/*.log` plain-text；不可程序 resume | 只服务 debug |
| 聊天记录结构 | `Message {role, content, thinking?, tool_calls?, tool_call_id?, name?}` | pydantic BaseModel |

### 3.4 Verdict 评价

- **完整性**：基本盘齐了——双 provider、tool use、thinking、retry、log——但 cache、stream、session 持久化都缺。
- **可靠性**：重试有，但默认捕获 `Exception` 是粗放的设计；OpenAI 路径的 `finish_reason` 硬编码是**事实上的小 bug**。
- **可观测性**：plain-text log 对人类很友好，对机器极不友好；token usage 累加方式正确但没有按类型拆分上报。
- **不足**：(1) 无流式输出，长任务的"实时反馈"靠 print；(2) 无 prompt cache 利用；(3) 无 Retry-After / 无 jitter；(4) `max_tokens=16384` 硬编码；(5) session 不可 resume；(6) `finish_reason` 硬编码 `"stop"`。

**评分**：⭐⭐⭐☆☆ (3/5)

---

## 4. Hooks 详细说明

### 4.1 引擎的实现

**Mini-Agent 没有 Hooks 子系统**。代码里没有 `hook` / `PreToolUse` / `PostToolUse` / `UserPromptSubmit` 之类的事件机制。`Agent.run()` 的循环里只有"call LLM → execute tools → append messages"三步，**没有任何位置允许第三方注入回调**。

唯一勉强算"hook 模式"的入口是 `LLMClient.retry_callback`：用户可以在重试时被通知一次（`cli.py` 里给它绑了个打印进度的回调），但这不是事件总线，更没有"匹配 + 阻断 + 注入上下文"的能力。

### 4.2 Hooks 代码文件清单

无。

### 4.3 全部 Hook 说明

无。

### 4.4 Verdict 评价

- 这是**有意识的极简化决策**——一个示范级 agent 没有理由在 5k 行内塞 hook engine。但站在"模板维度逐项打分"的视角，这是一个完整缺失。

**评分**：⭐☆☆☆☆ (1/5)

---

## 5. 上下文管理详细说明

### 5.1 上下文引擎的实现

- **状态持有者**：`Agent` 类本身（`agent.py:45`），核心字段就是 `self.messages: list[Message]`。没有 Session / Thread / TurnContext 这样的多层抽象——所有状态都挂在 Agent 实例上。
- **内存结构**：扁平的 `list[Message]`，第 0 条永远是 system prompt。`Message` 字段：`role`、`content`（str 或 list[dict]）、`thinking?`、`tool_calls?`、`tool_call_id?`、`name?`。
- **规范化**：在两个 LLM client 内部分别完成。Anthropic 路径会把 assistant message 拆成 `thinking + text + tool_use` 三种 block 数组，并把 tool 结果包裹成 `user role + tool_result content block` 这种 Anthropic 特殊格式；OpenAI 路径把 system 内嵌在 messages 数组里、并把 `assistant.thinking` 翻译成 `reasoning_details` 字段以保 MiniMax interleaved thinking 链路完整。这两套转换是 mini-agent 唯一的"消息归一化"工作。
- **CLAUDE.md 等"项目文档"**：**不存在**这一概念。System prompt 来自 `mini_agent/config/system_prompt.md`，里面只有一个 `{SKILLS_METADATA}` 占位符在启动时被 skill 元数据替换。没有 cwd 上推、没有 `.agentrules`、没有项目级 override。

### 5.2 上下文管理代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `mini_agent/agent.py` | `Agent.messages` + `_summarize_messages()` + `_create_summary()` + `_estimate_tokens()` |
| `mini_agent/llm/anthropic_client.py` | Anthropic 侧的消息→API 格式归一化 |
| `mini_agent/llm/openai_client.py` | OpenAI 侧的消息→API 格式归一化 + reasoning_details 透传 |
| `mini_agent/config/system_prompt.md` | 唯一的 system prompt 来源 |

### 5.3 全部分层说明

| 层级 | 内容 | 是否持久化 | 备注 |
|------|------|------------|------|
| System prompt | `system_prompt.md` + 启动时拼接的 workspace 信息 | 是（文件） | 单一来源 |
| Skills metadata | 启动时把 skill `name + description` 替换占位符 | 否（派生） | 详见 §7 |
| 对话历史 | `Agent.messages: list[Message]` | **否**（仅 log） | 进程退出即丢 |
| Tool result | 作为 `role="tool"` 消息追加 | 否 | |
| Notes | `SessionNoteTool` 写入 `<workspace>/.agent_memory.json` | **是**（独立文件） | 这是唯一的跨 session 持久化通道 |

### 5.4 上下文压缩机制

- **触发条件**：每一步进入 `Agent.run()` 循环之前调用 `_summarize_messages()`，条件是"`_estimate_tokens()` > token_limit  **或者** `api_total_tokens > token_limit`"，默认 token_limit = 80000。还有一个 `_skip_next_token_check` 标志位防止刚刚 summary 完又被立刻触发（因为 `api_total_tokens` 来自上一次响应、不会立即更新）。
- **策略**：**保留所有 user message + 把每对 user 之间的 agent 执行过程独立摘要**。具体路径：
  1. 找出所有 `role == "user"` 的索引；
  2. 对每两个 user 之间的 assistant + tool 序列，调一次 LLM 走 `_create_summary()`；
  3. 摘要 prompt 是硬编码的英文模板（"Please provide a concise summary..."），要求 1000 字以内；
  4. 每段摘要被以 `role="user"` 的形式插回新历史，标题写 `[Assistant Execution Summary]`。
- **分层逻辑**：**没有**。tool result / reasoning / 普通 assistant text 一视同仁。
- **摘要失败 fallback**：若 LLM 调用抛异常，回退到本地拼接的 plain-text 摘要（把 assistant 的 content 与 tool name 串起来）——这是个朴素但够用的兜底。
- **token 估算**：用 `tiktoken.cl100k_base` 编码计数 + 每条 message 加 4 token overhead；如果 tiktoken 加载失败，再 fallback 到 `len(chars) / 2.5`。

### 5.5 Verdict 评价

- **完整性**：覆盖了"触发 → 摘要 → 替换"的最小生命周期；user message 全保留是聪明的简化（保留用户意图）。
- **精细度**：单一阈值 + 单一策略；token 估算与 API 实际可能差几个百分点。
- **恢复能力**：因为 system prompt 不变、tool 列表每次重新传，摘要后不会失忆 tool schema；但 thinking 段被吃掉之后再让模型继续走 interleaved thinking 链路是有风险的——OpenAI 路径的 `reasoning_details` 注释里特地强调"必须保留 thinking 才能保证 chain of thought 不中断"，但 summary 一旦发生，thinking 就丢了。
- **不足**：(1) 摘要本身是一次"普通 LLM 调用"，会把工具列表也带过去——浪费 token；(2) `_skip_next_token_check` 只跳过一次，连续两次摘要溢出仍可能死循环；(3) 摘要 prompt 与会话语言无关地写死英文，对中文长会话会产生"中→英摘要→再中文"的损耗；(4) 把摘要插回成 `role="user"` 在某些后端的 token 计费规则下会被算成"用户输入"而非"系统注入"。

**评分**：⭐⭐⭐☆☆ (3/5)

---

## 6. Tool Use 详细说明

### 6.1 Tool Use 引擎的实现

- **抽象**：`tools/base.py` 的 `Tool` 类只要求四个属性/方法——`name`、`description`、`parameters`（JSON Schema dict）、`async execute(*args, **kwargs) -> ToolResult`。还提供两个序列化 helper：`to_schema()` 出 Anthropic 格式，`to_openai_schema()` 出 OpenAI 格式。`ToolResult` 是 pydantic 模型 `{success: bool, content: str, error?: str}`。整个 Tool 抽象**不到 60 行**。
- **注册**：完全静态——`cli.py` 的 `initialize_base_tools()` + `add_workspace_tools()` 按 config 标志位往 `tools: list[Tool]` 里 append；最后传给 `Agent(tools=...)`，`Agent.__init__` 转成 `{tool.name: tool}` 字典。没有 registry / router / spec builder。
- **执行流程**：在 `Agent.run()` (agent.py:431-501) 内嵌实现：
  1. 拿到 `response.tool_calls` 后，**串行**遍历每一个 tool_call；
  2. 在 `self.tools` 字典里查 name；
  3. 调 `await tool.execute(**arguments)`；
  4. 用 try/except 捕获所有异常，转成 `ToolResult(success=False, error=traceback)`；
  5. 把结果作为 `Message(role="tool", tool_call_id=..., name=...)` 追加到 history；
  6. 每一步之间 check `cancel_event`。
- **并行**：**没有**。所有 tool call 顺序执行，即便它们之间没有依赖。
- **结果回灌**：直接以 `role="tool"` message 形式 append。`content` 在成功时是 tool 的输出字符串，失败时被改写成 `f"Error: {result.error}"`。注意：因为是字符串而不是 `tool_result` content block，到了 anthropic_client 的 `_convert_messages` 里才被重新包成 `{"type": "tool_result", "tool_use_id": ..., "content": ...}`。

### 6.2 Tool Use 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `mini_agent/tools/base.py` | `Tool` / `ToolResult` 基类 + dual-schema serializer |
| `mini_agent/tools/bash_tool.py` | `BashTool` / `BashOutputTool` / `BashKillTool` + 后台进程管理 |
| `mini_agent/tools/file_tools.py` | `ReadTool` / `WriteTool` / `EditTool` + tiktoken 截断 |
| `mini_agent/tools/note_tool.py` | `SessionNoteTool` / `RecallNoteTool` |
| `mini_agent/tools/skill_loader.py` | SKILL.md 解析、相对路径替换 |
| `mini_agent/tools/skill_tool.py` | `GetSkillTool` |
| `mini_agent/tools/mcp_loader.py` | MCP server 连接、工具发现、超时控制 |
| `mini_agent/agent.py:431-501` | 工具分发逻辑（串行） |

### 6.3 内建工具逐一列举与分析

| 工具名 | 文件 | 核心能力 | 特殊设计 |
|--------|------|----------|----------|
| `bash` | `bash_tool.py` | 同步/后台执行 shell；Windows 走 PowerShell | 带后台 `BackgroundShellManager`，支持 stdout 行缓冲与监控任务 |
| `bash_output` | `bash_tool.py` | 拉取后台 shell 的增量输出 | 支持 regex `filter_str` |
| `bash_kill` | `bash_tool.py` | SIGTERM → SIGKILL 终止后台 shell | |
| `read_file` | `file_tools.py` | 带行号读取 + offset/limit 分页 | 输出超 32k token 自动头尾保留中间截断 |
| `write_file` | `file_tools.py` | 整文件覆盖写 | 自动建父目录 |
| `edit_file` | `file_tools.py` | 字符串精确替换（必须唯一） | 命中失败立即报错 |
| `record_note` | `note_tool.py` | 写入 `<workspace>/.agent_memory.json` | 带 timestamp + category；lazy init 文件 |
| `recall_notes` | `note_tool.py` | 读回所有 notes，可按 category 过滤 | 与 `record_note` 共享同一文件 |
| `get_skill` | `skill_tool.py` | 拉取 SKILL.md 全文（progressive disclosure level 2） | 详见 §7 |
| `MCP tools` | `mcp_loader.py` 动态生成 | 来自 `mcp.json` 配置的所有外部 server | 支持 stdio / sse / streamable_http 三种 transport，超时三段独立可配 |

> **注意：没有** TodoWrite / WebFetch / WebSearch / Grep / Glob / LSP / Notebook / Plan / Worktree / SubAgent / Task* 等工具。基础栈只有"shell + 文件 + note + skill + mcp"五件套。

### 6.4 Verdict 评价

- **完整性**：覆盖了"读 / 写 / 执行 / 记忆 / 远端工具"五个核心象限；后台 shell + 增量输出是这一体量里最像"production"的一段。
- **扩展性**：Tool 抽象 60 行就完事，加新工具非常便宜——只需要写一个子类、然后在 `cli.py` 里手动 append。
- **健壮性**：try/except 包了所有 tool 执行；后台 shell 有 SIGTERM→SIGKILL 升级；MCP 三层超时；read_file 有 token 截断防爆炸。
- **不足**：(1) **无并行执行**；(2) **无权限检查**（任何 LLM 决定的 bash 都直接跑）；(3) **无 dry-run / approval**；(4) 静态注册不支持运行时增删工具；(5) 没有 web 搜索 / 抓取，只能完全靠 MCP server 补；(6) `EditTool` 只支持精确字符串替换，没有正则、没有结构化 patch。

**评分**：⭐⭐⭐☆☆ (3/5)

---

## 7. Skill 详细说明

### 7.1 Skill 的分类

- **物理格式**：`SKILL.md`，每个 skill 是一个目录。YAML frontmatter 字段：`name` (必需)、`description` (必需)、`license` (可选)、`allowed-tools` (可选 list)、`metadata` (可选 dict)。
- **作用域**：只有**一个 source**——`config.tools.skills_dir`，默认按优先级在三处搜：(1) cwd 下 `mini_agent/skills`、(2) cwd 下 `skills`、(3) 安装包目录里的 `mini_agent/skills`（即 bundled）。**没有** project / user / plugin / MCP 这样的多 scope；用户想加自定义 skill，只能直接覆盖 `skills_dir`。

### 7.2 Skill 的加载顺序

- 在 `cli.py:initialize_base_tools` 里调 `create_skill_tools(skills_dir)`，内部通过 `SkillLoader.discover_skills()` 用 `rglob("SKILL.md")` 递归扫描整个目录树。
- 命中后存进 `loaded_skills: dict[str, Skill]`，**按 name 去重，后扫到的覆盖**（这跟 codex / claude-code 的"先到先得"相反）。
- **不支持**热更新——只在启动时扫一次。

### 7.3 Skill 与 System Prompt 的映射关系

- 启动时 `SkillLoader.get_skills_metadata_prompt()` 生成一段"## Available Skills"区块（每行 `- \`name\`: description`），通过字符串替换写进 system prompt 的 `{SKILLS_METADATA}` 占位符。这是 Progressive Disclosure 的 **Level 1**——只暴露 name + description，不带正文。
- 当模型决定调 `get_skill(skill_name)` 时，`GetSkillTool.execute()` 把对应 SKILL.md 的全文（含 `to_prompt()` 头部 wrapper）作为 tool result 返回。这是 **Level 2**。
- **Level 3+** 是 SKILL.md 正文里引用的 scripts / references / assets：`SkillLoader._process_skill_paths()` 在加载时把所有相对路径替换成绝对路径——包括三种正则模式：(a) `python scripts/x.py` / 反引号包裹的 `scripts|references|assets/*`；(b) 文档名 `.md/.txt/.json/.yaml` + 前缀动词（see/read/refer to/check）；(c) markdown link `[text](filepath)`。模型读到这些绝对路径后用 `read_file` / `bash` 去访问。这是同类 skill 实现里很少见的"加载期路径重写"。

### 7.4 动态 Skill 的注册、发现、注入与使用

- **发现触发**：仅启动时一次 `rglob`。运行时 fs 变化不会被感知。
- **注册表**：`SkillLoader.loaded_skills` 字典；`get_skill` / `list_skills` 是公共 API。
- **条件激活**：**不支持**——所有 skill 的元数据无差别全量进 system prompt；正文按需 fetch。
- **MCP 依赖**：bundled skills 里有 `mcp-builder` 这样的"教用户怎么写 MCP server"的 skill，但 SKILL.md 本身**不能声明运行时 MCP server 依赖**——没有 codex 那样的 `dependencies.tools` 字段。
- **Skill ↔ Hook 交互**：N/A（无 hook 系统）。

### 7.5 Verdict 评价

- **完整性**：Level 1 + Level 2 + Level 3 三档 progressive disclosure 齐了，路径重写是教科书式的实现。
- **Token 效率**：metadata-only 注入 + on-demand fetch；常数项很小。
- **扩展性**：单一 source 最简单也最局限——团队/项目级覆盖只能靠改 `skills_dir`。
- **不足**：(1) 单 source；(2) 无 fs 热更新；(3) 无条件激活 / no path filter；(4) 无 hook 反向绑定；(5) 无 MCP 依赖声明；(6) 重名后扫覆盖先扫的语义反直觉。

**评分**：⭐⭐⭐☆☆ (3/5)

---

## 8. Sub-Agent 详细说明

### 8.1 Sub-Agent 引擎的实现

**Mini-Agent 没有 Sub-Agent**。代码里既没有 `spawn` / `delegate` / `fork` 之类的 API，也没有"agent 类型定义"概念。`Agent` 类是单例的——一个进程一个 agent，一个 loop。

**ACP server 模式略有不同**：`acp/__init__.py` 的 `MiniMaxACPAgent` 把每个 ACP `newSession` 调用都对应到一个独立的 `Agent` 实例（`self._sessions: dict[str, SessionState]`），但这是"同进程多 session"，不是"主 agent 调用子 agent"——session 之间没有父子关系，没有上下文 fork，也没有结果回灌。

### 8.2 Sub-Agent 代码文件清单

无（除了 ACP server 的多 session 管理）。

### 8.3 Sub-Agent 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 调度引擎 | 无 | |
| 生命周期 | 无 | |
| 上下文隔离 | 仅 ACP 多 session 之间天然隔离 | 不是父子关系 |
| 权限与沙盒 | 无 | |
| 结果回归 | 无 | |

### 8.4 Verdict 评价

- 完全缺失。考虑到 mini-agent 的目标是"教学级最小可用 agent"，这不算意外，但与模板维度对照时仍是 0。

**评分**：⭐☆☆☆☆ (1/5)

---

## 9. TUI 详细说明

### 9.1 TUI 引擎的实现

- **驱动**：**没有 TUI 框架**。用的是 `prompt_toolkit` 的 REPL 风格——`PromptSession` 提供输入框、`KeyBindings` 绑快捷键、`WordCompleter` 做命令补全、`FileHistory` 持久化历史。所有"显示"都是 `print(...)` 加 ANSI escape sequences。
- **渲染机制**：流水式打印（write-only stdout），**不重绘**。每条输出都一次性 print 完，无脏区检测，无组件树。
- **刷新机制**：N/A——没有"frame"概念，事件就是用户回车一次。
- **组件树**：只有"输入提示符 + 输出区"两个隐式区域。`print_banner` / `print_session_info` / `print_help` / `print_stats` 这几个函数手工绘制 box-drawing 字符（`╭ ─ ╮ │ ╰`），用 `utils/terminal_utils.calculate_display_width` 处理中日韩宽字符的对齐。这是手写式而不是组件式。
- **数据通讯**：完全本地——CLI 主循环 `await agent.run(cancel_event)`，输出靠 print，状态共享靠 `Agent` 实例上的属性。
- **焦点 / 输入**：单焦点——只有一个输入框，prompt_toolkit 自动管理。Esc 键绑定 `cancel_event.set()` 来打断 `Agent.run()`。
- **主题 / 鼠标**：无主题系统（颜色硬编码在 `Colors` 类里）；prompt_toolkit 默认支持鼠标但项目没有显式启用。
- **Cancel 路径**：`asyncio.Event` + `Agent._check_cancelled()`——每个 step 开始 / tool 执行前后检查；命中后 `_cleanup_incomplete_messages()` 删掉本轮"未完成 tool result 的 assistant message"，保证 history 一致性。这是个**很干净的小设计**。

### 9.2 TUI 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `mini_agent/cli.py` | REPL 主循环 + banner / help / stats / log 命令 |
| `mini_agent/utils/terminal_utils.py` | CJK 宽字符显示宽度计算 |
| `mini_agent/agent.py` | print + cancel_event 检查 |

### 9.3 TUI 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 驱动引擎 | `prompt_toolkit.PromptSession` | REPL 模式 |
| 渲染引擎 | print + ANSI escape | 流水式 |
| 刷新机制 | 无重绘 | 一次性输出 |
| 数据通讯 | 同进程实例属性 + asyncio.Event 取消 | 极简 |

### 9.4 Verdict 评价

- **完整性**：作为"REPL 风格 CLI"是完整的——输入、输出、取消、命令补全、历史都有。
- **性能**：流水式 print 在长输出时可能撕裂，但因为没有重绘所以 CPU 稳定。
- **可扩展性**：只想加一个新的 slash command 很容易；但想加"侧边栏 / 进度条 / 多面板"就要重写。
- **不足**：(1) 无组件抽象；(2) 无主题；(3) 无鼠标；(4) 无流式 token 输出（受限于 LLM 层非流式）；(5) print 过程中如果 cancel，已经 print 出的部分无法擦除。

**评分**：⭐⭐☆☆☆ (2/5)

---

## 10. To-Do List 详细说明

### 10.1 To-Do List 引擎的实现

**Mini-Agent 没有 TodoList 工具**。模型不能维护一个结构化 task 列表；最接近的替代品是 `SessionNoteTool`，它把任意文本+category+timestamp 写入 `<workspace>/.agent_memory.json`，但这是"备忘录"语义，不是"状态机式 task 跟踪"。

也**没有** Plan Mode / interview phase / multi-agent planning 之类的执行前规划机制。

### 10.2 To-Do List 代码文件清单

无（仅 SessionNoteTool 作为弱替代）。

### 10.3 To-Do List 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| Parse 引擎 | 无 | |
| 创建注册 | `SessionNoteTool` 写 JSON 文件 | 备忘录而非 todo |
| 状态维护 | 无状态机 | |
| 持久化 | 是（`.agent_memory.json`） | 这是 mini-agent 唯一持久化的 agent 状态 |

### 10.4 Verdict 评价

- 完全缺失结构化 todo / plan。SessionNoteTool 可以让模型"自己用文本字段模拟一个 todo"，但缺少强制 schema，模型自律性会决定一切。

**评分**：⭐☆☆☆☆ (1/5)

---

## 11. CLI Permission 与执行模式详细说明

### 11.1 CLI Permission 引擎的实现

**Mini-Agent 没有 Permission 与 Sandbox 子系统**。
- 没有 `default / plan / acceptEdits / bypassPermissions` 之类的模式枚举；
- 没有规则解析、没有 deny list、没有 allowlist；
- 没有 dangerous pattern 分类器；
- 没有 OS 级 sandbox（landlock / seatbelt / bwrap / Job Object）；
- 没有"用户审批对话框"——一切由模型决定调的工具都直接执行；
- `BashTool` 直接 `asyncio.create_subprocess_shell(...)`，**唯一的安全约束是 `cwd=workspace_dir`**——它**不会**阻止 bash 命令读写 workspace 之外的路径，因为 `cd` / 绝对路径都不被拦截。
- 即便 `FileTool` 也只是把相对路径解析到 `workspace_dir`，但绝对路径直接放行（`file_tools.py:111-114` 的 `if not file_path.is_absolute()` 分支）。

唯一的"软安全"机制是 `cancel_event`——用户按 Esc 可以打断当前 step。

### 11.2 CLI Permission 代码文件清单

无。

### 11.3 CLI Permission 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 模式引擎 | 无 | 等价于"始终 yolo" |
| 权限分层 | 无 | |
| 审批中间件 | 无 | |
| 安全策略 | 仅 `cwd=workspace_dir` 的弱约束 | 可被绝对路径绕过 |

### 11.4 Verdict 评价

- 在"教学 / 个人玩具"用途下没问题，但**绝不能**放进任何不信任的环境——给一个能跑 bash 的 LLM 全权访问操作系统是高风险行为。这是 mini-agent 最大的安全缺口。

**评分**：⭐☆☆☆☆ (1/5)

---

## 12. API 接口处的缓存安排

- **Prompt Cache**：客户端**完全没有**显式利用。请求里没有 `cache_control` block，没有 cache 断点检测、没有 TTL 管理。
- **Cache 命中可见性**：唯一被用到的是 token usage——`AnthropicClient._parse_response` 把 `cache_read_input_tokens` + `cache_creation_input_tokens` 加进 `prompt_tokens`，但**不区分**"来自 cache 的 token"与"新算的 token"，运维者看不到命中率。
- **压缩与 cache 的联动**：无。`_summarize_messages()` 一旦触发，下一轮请求会出现完全不同的 `messages` 数组，命中的是不是同一个 cache key 对客户端是黑盒。
- **其他 API 优化**：(1) `extra_body={"reasoning_split": True}` 让 OpenAI 路径走 MiniMax 的 reasoning_details 通道；(2) 别无 batch / 合并请求 / 预连接。

> 站在"如果未来想接 Anthropic claude-3-5-sonnet 真用上 cache"的角度看，目前的代码在 `cache_control` 这一层是**完全空白**的——只要愿意，加一个 ephemeral cache_control 到 system block 上是 1 行修改，但作者没做，因为目标后端是 MiniMax 自家模型而非 Claude。

---

## 13. 对不同 LLM 模型的逻辑安排

- **支持的 provider**：两条物理 wire——Anthropic 协议（`anthropic` SDK）与 OpenAI 协议（`openai` SDK），由 `LLMProvider` enum 二选一。理论上只要后端兼容这两套 wire 之一就能接，例如：直连 Anthropic、直连 OpenAI、走 MiniMax `/anthropic` / `/v1` 兼容端点、走 SiliconFlow 之类的 OpenAI 兼容端点。
- **provider 抽象层**：`LLMClientBase` ABC + `LLMClient` facade。抽象层很薄，没有"按模型族差异化处理"的代码——所有 anthropic 模型都用同一份请求构造，所有 openai 兼容模型也都用同一份。
- **特殊处理**：MiniMax 专属的 `reasoning_split=True` 是唯一的 provider-specific tweak；Anthropic 路径里的 `default_headers={"Authorization": Bearer}` 是另一个。
- **模型切换 / fallback**：**没有**自动切换。模型由 config.yaml 的 `model` 字段写死，运行时无法换；连续失败就直接报错。

> 它是一个"为 MiniMax M2.5 量身打造、附带 OpenAI 兼容路径"的客户端，而不是一个 provider-agnostic 的多模型框架。

---

## 14. 其他 Agent-Specific 优势、亮点与效率提升

### 14.1 架构亮点

- **"Skill 路径加载期重写"**：`SkillLoader._process_skill_paths` 在加载 SKILL.md 的瞬间把所有 `scripts/x.py` / `references/y.md` / markdown link 全部替换为绝对路径。这让模型可以拿到的指令永远是"可立即执行的 read_file / bash 路径"，省掉了"我现在 cwd 在哪"的混乱。这是同类 skill 实现里很有教育意义的一招。
- **`_summarize_messages` 的"按 user 边界切分"策略**：每对 user 之间独立摘要、user 本身全保留，结构性强、不会丢失意图。
- **`_cleanup_incomplete_messages`**：cancel 后只删"最后一条 assistant 之后的悬空 tool result"，保留所有已完成的 step——比简单截断更尊重已有进展。
- **后台 shell + 增量输出 + regex filter**：对一个 5k 行的项目来说，`BackgroundShellManager` 提供 `start_monitor` / `get_new_output` / `terminate` 已经相当像样。
- **ACP 桥接**：mini-agent 把自己额外封装成一个 ACP server (`acp/__init__.py`)，让它能被 Zed / Claude desktop 这类支持 Agent Client Protocol 的客户端直接驱动，复用 LLM client / Tools / Skill 整套基础设施。这是教学级 agent 里少见的"桥接生态"动作。

### 14.2 性能与效率

- 全 asyncio；MCP 三段超时；read_file 的 head/tail token 截断；后台 shell 让长任务非阻塞——基础该有的都有。
- 反面：tool 调用强制串行，长 toolchain 体验偏慢；非流式 LLM 调用的 TTFB 完全暴露给用户。

### 14.3 安全与沙盒

- **几乎为 0**。仅有 `cwd=workspace_dir` 这一弱约束。

### 14.4 开发者体验

- plain-text log 易读；ANSI 颜色 + box-drawing 终端美化到位；slash 命令 (`/help`、`/clear`、`/history`、`/stats`、`/log`、`/exit`) 该有的都有；`--task` 提供 non-interactive 模式方便脚本。
- 反面：log 不可程序化、session 不能 resume、没有 telemetry 钩子。

### 14.5 独特功能

- **ACP server 模式**——可以把自己暴露成 ACP 协议端，供外部 client 调用；
- **Skill 路径加载期重写**；
- **MiniMax 网关 base_url 自动补尾**；
- **CJK 显示宽度对齐**（`utils/terminal_utils.calculate_display_width`）——很多 CLI 都不做这件事，结果在中文环境下 box-drawing 全错位。

---

## 总体评分

| 维度 | 评分 (1-5) | 一句话总结 |
|------|------------|------------|
| LLM 请求方式 | 3 | 双协议 facade 干净，但无流式 / 无 cache / 重试粗放 |
| Hooks | 1 | 不存在 |
| 上下文管理 | 3 | "按 user 边界摘要"策略聪明，但单一阈值、无层级 |
| Tool Use | 3 | 五件套够用 + 后台 shell 出彩，但串行、无权限 |
| Skill 管理 | 3 | 三档 progressive disclosure + 路径重写是亮点，但单 source / 无热更 |
| Sub-Agent | 1 | 不存在 |
| TUI | 2 | REPL + ANSI + CJK 对齐齐了，但无组件 / 无重绘 / 无主题 |
| To-Do List | 1 | 不存在 (SessionNote 是弱替代) |
| CLI Permission | 1 | 不存在 |
| API 缓存 | 1 | 不存在 |
| 多模型支持 | 3 | 双 wire 支持任何兼容端点，但无 fallback、无差异化处理 |
| 整体工程成熟度 | 3 | 5k 行内交付能跑的"教学级"agent，结构清晰但功能面窄 |

### 最终客观评价与辩证分析

**核心优势**：mini-agent 的最大优势是**"小而清晰"**——5,164 行 Python 实现了 LLM 双协议、9 个内建工具、三种 MCP transport、Skills 三档 progressive disclosure、ACP 桥接、消息摘要、CJK 终端对齐。每一个模块都尽量做到"最少可用"，几乎不引入抽象层；想读懂整个 agent loop，从 `agent.py` 的 `run()` 函数一路读到 `tool.execute()` 不超过一个小时。这是一个**教学级别接近完美的样本**——它让"agent 到底是怎么工作的"变得可触摸。一些细节（按 user 边界做摘要、cancel 时 cleanup 不完整 message、SKILL.md 加载期路径重写、CJK 显示宽度计算）甚至在 codex / claude-code 这种工程级实现里都没有等价物。

**明显短板**：以"模板维度全覆盖"的尺子量，mini-agent 缺得很多。(1) **没有 Hooks 系统**——不能挂回调、不能 PreToolUse 拦截、不能 PostToolUse 注入；(2) **没有 Sub-Agent**——不能并行委托、不能 fork 上下文、不能跨 agent 协作；(3) **没有 Permission / Sandbox**——bash 直接跑、绝对路径不拦、cwd 是唯一约束；(4) **没有 TodoList / Plan Mode**——结构化 task 跟踪缺失；(5) **没有 prompt cache 利用**——`cache_control` 字段在请求里完全不存在；(6) **没有流式输出**——LLM 拿到完整响应才一次性 print；(7) **没有 session 持久化**——`~/.mini-agent/log/*.log` 只是 plain-text 备忘，进程退出会话即丢；(8) **没有真 TUI**——`prompt_toolkit` REPL + 手画 box-drawing。这些短板很大程度上**是设计选择**而非工程缺陷，但也确实约束了 mini-agent 的应用边界——它不能放进任何不信任的环境，也不适合长程多步骤任务。

**适用场景**：最适合 **(a) 想读懂 agent 内部机制的学习者**、**(b) 把 MiniMax 模型快速接成个人助手的开发者**、**(c) 需要一个能被 ACP 客户端嵌入的最小 agent 后端的实验项目**。它**不**适合：(1) 任何接触 production 数据 / 私密文件 / 远程服务器的场景（无 sandbox / 无审批）；(2) 跨 session 的长期任务（无持久化）；(3) 需要复杂多 agent 协作的工作流（无 sub-agent）。

**发展建议**：若要从"教学样本"升一档到"小型 production-ready"，**首要补的是 Permission / Sandbox**——哪怕只是一个最朴素的"bash 命令必须用户在终端二次确认"机制，也能把 mini-agent 从"高风险玩具"提升为"可日常使用的小助手"；其次是**流式输出**——目前的 UX 等待感太重；第三是**结构化 session 持久化**——把 `Agent.messages` 序列化成 JSONL 而不是 plain-text log，配合 `--resume <session-id>` 启动参数，长任务才有意义；第四是**Hook 钩子**——哪怕只是一个 `on_tool_use` 回调列表，也能让 IDE 集成 / telemetry 接入变得可能。这四项优先级递减，第一项是安全，后三项是可用性。

**横向对比定位**：与同期其他 agent CLI 相比，mini-agent 的独特生态位是 **"5k 行能跑的教学级 agent + MiniMax 自家模型的官方推荐 demo"**。codex 是"OpenAI 自家的 production-grade Rust 工程"，claude-code 是"Anthropic 自家的 TypeScript 全功能 IDE 助手"，mini-agent 则是"MiniMax 自家的 Python 极简学习样本"——三家立场不同，体量也不同。把 mini-agent 与前两家放在同一个评分表里，**绝大多数维度它会落后**，但在"代码可读性 / 学习曲线 / 上手成本 / 对新接口（ACP）的实验性"上它独占优势。它更像是"agent SDK 的入门教科书附赠例子"，而不是"日常使用的 CLI"——这两种定位都正当，把它和 codex / claude-code 放一起比"哪个更好"是不公平的，应该比"哪个更适合你的使用场景"。
