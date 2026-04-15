# mini-agent 深度分析

> 分析对象: `mini-agent`
> 分析时间: `2026-04-15`
> 分析者: `GPT-5.4`
> 文件位置: `docs/investigation/mini-agent-by-GPT.md`

---

## 1. 技术栈

| 维度 | 技术选型 |
|------|----------|
| **核心语言** | Python 3.10+ |
| **运行时 / 框架** | `asyncio` + 单进程单 Agent ReAct 循环 |
| **包管理 / 构建工具** | `pyproject.toml` + `setuptools`；文档推荐 `uv` |
| **UI / CLI 库** | `argparse` + `prompt-toolkit` + ANSI 终端输出 |
| **LLM SDK / API 客户端** | `anthropic.AsyncAnthropic`、`openai.AsyncOpenAI`，外加统一封装 `mini_agent/llm/llm_wrapper.py` |
| **配置解析** | `PyYAML` + `pydantic` |
| **测试框架** | `pytest` / `pytest-asyncio` |
| **其他关键依赖** | `mcp`, `tiktoken`, `agent-client-protocol` |

---

## 2. 目录结构

只展示与分析维度直接相关的文件与目录。

```text
context/mini-agent/
├── mini_agent/
│   ├── cli.py                      # CLI 入口、交互循环、工具装配
│   ├── agent.py                    # 单 Agent 主循环、上下文压缩、tool dispatch
│   ├── config.py                   # config.yaml 搜索与解析
│   ├── logger.py                   # 本地请求/响应/工具日志
│   ├── retry.py                    # 异步重试装饰器
│   ├── llm/                        # ← LLM 相关代码主目录
│   │   ├── base.py                 # LLM 抽象基类
│   │   ├── llm_wrapper.py          # provider facade
│   │   ├── anthropic_client.py     # Anthropic 协议实现
│   │   └── openai_client.py        # OpenAI 协议实现
│   ├── schema/
│   │   └── schema.py               # Message / ToolCall / LLMResponse 统一模型
│   ├── tools/
│   │   ├── base.py                 # Tool 抽象与 schema 序列化
│   │   ├── file_tools.py           # read/write/edit
│   │   ├── bash_tool.py            # 前后台 shell 执行
│   │   ├── note_tool.py            # Session Note 持久化
│   │   ├── skill_loader.py         # SKILL.md 发现与路径重写
│   │   ├── skill_tool.py           # get_skill（渐进式披露）
│   │   └── mcp_loader.py           # MCP server 连接与 tool 包装
│   ├── acp/
│   │   └── __init__.py             # ACP/Zed 适配层
│   ├── config/
│   │   ├── config-example.yaml
│   │   ├── mcp-example.json
│   │   └── system_prompt.md
│   └── skills/                     # 15 个 bundled skills（document/pdf/docx/pptx/xlsx 等）
├── tests/
│   ├── test_agent.py
│   ├── test_llm.py
│   ├── test_llm_clients.py
│   ├── test_mcp.py
│   ├── test_skill_loader.py
│   ├── test_session_integration.py
│   └── test_bash_tool.py
└── docs/
    ├── DEVELOPMENT_GUIDE.md
    └── PRODUCTION_GUIDE.md
```

> **注意**：LLM 相关实现集中在 `mini_agent/llm/`，请求入口由 `mini_agent/llm/llm_wrapper.py` 统一封装，再分发到 `anthropic_client.py` 或 `openai_client.py`。

---

## 3. LLM 请求方式详细说明

### 3.1 LLM 请求引擎的实现

- **认证信息获取与注入**：
  - 来自 `config.yaml` 中的 `api_key` / `api_base` / `provider` / `model`（`mini_agent/config.py`）。
  - Anthropic 客户端通过 `AsyncAnthropic(base_url, api_key, default_headers={"Authorization": "Bearer ..."})` 注入；OpenAI 客户端通过 `AsyncOpenAI(api_key, base_url)` 注入。
- **请求入口封装**：
  - 统一入口是 `mini_agent/llm/llm_wrapper.py::LLMClient`。
  - provider 抽象仅两种：`anthropic`、`openai`（`mini_agent/schema/schema.py`）。
- **流式支持**：**不支持**。两端都调用 SDK 的非 streaming `create()`。
- **请求体构建**：
  - Anthropic：`AnthropicClient._convert_messages()` + `_convert_tools()`。
  - OpenAI：`OpenAIClient._convert_messages()` + `_convert_tools()`；额外注入 `extra_body={"reasoning_split": True}` 以拆分 reasoning。
- **响应解析**：
  - Anthropic 解析 `text` / `thinking` / `tool_use` / `usage` / `stop_reason`。
  - OpenAI 解析 `message.content` / `reasoning_details` / `tool_calls` / `usage`。
- **重试机制**：
  - `mini_agent/retry.py::async_retry()` 提供指数退避，默认 `1s * 2^attempt`，无 jitter。
  - 最大重试次数和间隔可在 `config.yaml` 中配置。
  - 当前默认对 **所有 `Exception`** 重试，错误分类较粗。
- **超时机制**：
  - LLM SDK 层没有看到项目自定义的请求超时配置；超时主要存在于 MCP，而不在 LLM client。
- **缓存 / Prompt Cache**：
  - 没有显式 Prompt Cache breakpoint、cache key、cache break detection。
  - Anthropic 解析时会读取 `cache_read_input_tokens` / `cache_creation_input_tokens`，但仓库本身并未主动构造缓存策略。
- **本地持久化**：
  - 运行日志写入 `~/.mini-agent/log/agent_run_*.log`（`mini_agent/logger.py`）。
  - Prompt 历史写入 `~/.mini-agent/.history`（`prompt_toolkit.FileHistory`，`mini_agent/cli.py`）。
  - Session note 写入工作区 `.agent_memory.json`（`mini_agent/tools/note_tool.py`）。
  - 真正的会话历史 `Agent.messages` 仍只在内存中。
- **持久化元数据**：
  - 日志中记录 `role`、`content`、`thinking`、`tool_calls`、时间戳。
  - **未持久化**：模型名称、token usage、provider、finish_reason 的完整上下文信息。

### 3.2 LLM 请求代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/mini-agent/mini_agent/llm/llm_wrapper.py` | provider facade，统一对外暴露 `generate()` |
| `context/mini-agent/mini_agent/llm/base.py` | LLM client 抽象接口 |
| `context/mini-agent/mini_agent/llm/anthropic_client.py` | Anthropic 协议的消息转换、工具 schema 注入、响应解析 |
| `context/mini-agent/mini_agent/llm/openai_client.py` | OpenAI 协议的消息转换、reasoning/tool call 解析 |
| `context/mini-agent/mini_agent/retry.py` | 指数退避重试 |
| `context/mini-agent/mini_agent/schema/schema.py` | Message / ToolCall / LLMResponse 数据模型 |
| `context/mini-agent/mini_agent/logger.py` | 请求/响应/工具结果日志 |

### 3.3 LLM 请求子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 认证机制 | `Config.from_yaml()` + SDK client 初始化 | API Key 明文来自 YAML |
| API Wrapper | `LLMClient` | 仅两类 provider |
| 重试机制 | `async_retry()` | 指数退避，无 jitter，无错误类型细分 |
| 本地缓存 | 无 | 仅被动读取 Anthropic cache usage 字段 |
| Session 持久化 | `AgentLogger` + `FileHistory` + `.agent_memory.json` | 主消息历史不支持 resume |
| 聊天记录结构 | `list[Message]` | 极简 schema，易懂但信息密度有限 |

### 3.4 Verdict 评价

- **完整性**：基础链路完整，但缺少 streaming、LLM timeout、会话恢复、主动 cache 策略。
- **可靠性**：有可配置重试，但错误分类过粗；OpenAI 分支还把 `finish_reason` 固定写成 `"stop"`，精度不足。
- **可观测性**：有本地日志，但日志未记录模型名与 token usage，问题定位仍偏手工。
- **不足**：
  - 无流式输出。
  - 无模型 fallback。
  - 无 prompt cache 策略。
  - 日志默认全量落盘，存在敏感内容外泄风险。

**评分**：⭐⭐⭐ (3/5)

---

## 4. Hooks 详细说明

### 4.1 引擎的实现

- **注册/发现机制**：未实现独立 Hook 系统。
- **调度方式**：无事件总线、无 hook registry、无生命周期拦截。
- **执行模式**：无 Shell Hook / 内存回调 Hook / Agent Hook / HTTP Hook。
- **对主流程影响**：
  - 只有 CLI 层面的 `Esc` 取消和 ACP 的 `cancel` 通知，属于运行控制，不属于 Hook 体系。

### 4.2 Hooks 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `-` | 未实现专门的 Hooks 子系统 |

### 4.3 全部 Hook 说明

| Hook 名称 | 触发时机 | Matcher 能力 | 输出影响 |
|-----------|----------|--------------|----------|
| `-` | `-` | `-` | `-` |

### 4.4 Verdict 评价

- **成熟度**：基本为 0，没有 Claude Code / Codex 风格的生命周期 Hook。
- **扩展性**：扩展点主要靠直接改 Python 代码，不是声明式扩展。
- **安全性**：也就不存在基于 Hook 的 trust / sandbox / approval 设计。
- **不足**：缺少 PreToolUse / PostToolUse / SessionStart / Stop / Compact 等关键钩子。

**评分**：⭐ (1/5)

---

## 5. 上下文管理详细说明

### 5.1 上下文引擎的实现

- **核心状态持有者**：`mini_agent/agent.py::Agent`。
- **内存数据结构**：`self.messages: list[Message]`，初始只放一个 system prompt。
- **API 前转换阶段**：
  1. CLI 装配 system prompt，并把 skills metadata / workspace 信息注入。
  2. `Agent.run()` 直接把 `self.messages` 传给 `LLMClient.generate()`。
  3. provider client 再把 `Message` 转成 Anthropic / OpenAI 的请求格式。

### 5.2 上下文管理代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/mini-agent/mini_agent/agent.py` | 会话历史、token 估算、压缩、主循环 |
| `context/mini-agent/mini_agent/schema/schema.py` | 统一消息结构 |
| `context/mini-agent/mini_agent/llm/anthropic_client.py` | Anthropic 消息转换 |
| `context/mini-agent/mini_agent/llm/openai_client.py` | OpenAI 消息转换 |
| `context/mini-agent/mini_agent/config/system_prompt.md` | 基础 system prompt 模板 |

### 5.3 全部分层说明

| 层级 | 内容 | 是否持久化 | 备注 |
|------|------|------------|------|
| System Prompt | system prompt + skills metadata + workspace info | 否 | 每次启动时重新构造 |
| User / Assistant / Tool History | `list[Message]` | 否 | 仅在内存 |
| Execution Summary | `[Assistant Execution Summary]` 伪 user message | 否 | 压缩后替代旧 assistant/tool 过程 |
| Prompt History | `~/.mini-agent/.history` | 是 | 仅保存用户输入历史，不是完整 transcript |
| Session Note | `.agent_memory.json` | 是 | 独立于主消息历史 |

### 5.4 上下文压缩机制

- **压缩触发条件**：
  - 每 step 开始前检查本地 token 估算或 API 返回的 `total_tokens`。
  - 默认阈值 `token_limit=80000`。
- **压缩策略**：
  - 保留 system prompt。
  - 保留全部 user 消息。
  - 把每两个 user 消息之间的 assistant/tool 轨迹摘要成一条新的 user 消息；也就是说，旧的 assistant/tool 输出会被重新伪装成“新的 user 输入”。
- **分层压缩逻辑**：
  - system / user / assistant / tool 的处理并不精细；旧工具调用、工具 schema、skill 原文都会被摘要化。
- **压缩后恢复**：
  - 没有 Codex/Claude Code 那种“压缩后重建工具列表、已读文件、plan 状态、skill 注入”的恢复管道。
  - 主要依赖保留的 system prompt 和摘要文本，恢复能力有限。

### 5.5 Verdict 评价

- **完整性**：有“能工作”的上下文窗口控制，但只是轻量摘要，不是分层上下文管理。
- **精细度**：token 估算依赖 `tiktoken` + 粗略 metadata 常量；足够 demo，不够工业级。
- **恢复能力**：压缩后会丢失细粒度执行轨迹；若 skill 内容或工具输出很关键，恢复只能靠摘要质量。
- **不足**：
  - 没有最近 N / 固定元数据 / 文件状态重建等多策略压缩。
  - 会把执行摘要重新塞成 user message，角色语义被污染，assistant/tool 产物会被模型当成新的用户指令背景。
  - CLI 实际只注册了 `record_note`，未注册 `recall_notes`，导致“跨会话记忆”能力在真实 CLI 中不完整。

**评分**：⭐⭐⭐ (3/5)

---

## 6. Tool Use 详细说明

### 6.1 Tool Use 引擎的实现

- **抽象基类**：`mini_agent/tools/base.py::Tool`。
- **注册方式**：
  - `initialize_base_tools()`：装配 `bash_output`、`bash_kill`、skills、MCP。
  - `add_workspace_tools()`：装配 `bash`、文件工具、`record_note`。
- **执行流程**：
  1. LLM 输出 `tool_calls`。
  2. `Agent.run()` 遍历 `response.tool_calls`。
  3. 通过 `self.tools[function_name]` 找到工具并执行 `await tool.execute(**arguments)`。
  4. 把结果包装成 `Message(role="tool", ...)` 回注到 `self.messages`。
  5. 下一轮再送回 LLM。
- **并行执行**：
  - **主循环不支持并行 tool call**，所有工具顺序执行。
  - 只有 `BashTool` 支持后台进程管理。
- **Tool 结果序列化**：
  - Anthropic 分支把 tool result 转成 `user/tool_result block`。
  - OpenAI 分支把 tool result 作为 `role="tool"` 消息传回。

### 6.2 Tool Use 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/mini-agent/mini_agent/tools/base.py` | Tool / ToolResult 抽象与 schema 导出 |
| `context/mini-agent/mini_agent/agent.py` | tool dispatch 主链路 |
| `context/mini-agent/mini_agent/tools/file_tools.py` | 文件工具 |
| `context/mini-agent/mini_agent/tools/bash_tool.py` | shell / background shell |
| `context/mini-agent/mini_agent/tools/note_tool.py` | note 工具 |
| `context/mini-agent/mini_agent/tools/skill_tool.py` | get_skill |
| `context/mini-agent/mini_agent/tools/mcp_loader.py` | MCP tools 封装 |
| `context/mini-agent/mini_agent/cli.py` | 工具注册与装配 |

### 6.3 内建工具逐一列举与分析

| 工具名 | 文件 | 核心能力 | 特殊设计 |
|--------|------|----------|----------|
| `read_file` | `tools/file_tools.py` | 读取文件、带行号、支持 offset/limit | 超过 32k token 自动截断 |
| `write_file` | `tools/file_tools.py` | 覆盖式写文件 | 自动创建父目录 |
| `edit_file` | `tools/file_tools.py` | 文本替换编辑 | **实现与说明不一致**：文案声称需唯一匹配，代码却直接全局 `replace()` |
| `bash` | `tools/bash_tool.py` | 前台 / 后台 shell 执行 | 支持 `bash_output` / `bash_kill` |
| `bash_output` | `tools/bash_tool.py` | 读取后台进程增量输出 | 可带 regex 过滤 |
| `bash_kill` | `tools/bash_tool.py` | 终止后台进程 | SIGTERM 后必要时 SIGKILL |
| `record_note` | `tools/note_tool.py` | 写入 `.agent_memory.json` | 带时间戳与 category |
| `get_skill` | `tools/skill_tool.py` | 按需加载完整 skill 内容 | Progressive Disclosure Level 2 |
| `MCPTool(*)` | `tools/mcp_loader.py` | 代理远端 MCP tool | 支持 stdio / sse / http / streamable_http，但本地 tool 与 MCP tool 名称冲突时缺少显式冲突处理 |

### 6.4 Verdict 评价

- **完整性**：文件、bash、skills、MCP 都具备，足以支撑“最小可用”开发代理。
- **扩展性**：新增工具非常容易，`Tool` 抽象简单直接。
- **健壮性**：MCP 超时、后台 shell 基本可用；但主工具链缺少审批、路径沙盒、并行调度，后台 shell 清理也不是完全闭环。
- **不足**：
  - `edit_file` 语义不稳定。
  - 文件工具接受绝对路径，工作区不是安全边界。
  - CLI 漏掉 `recall_notes`，与文档/示例不一致。
  - 工具调用严格串行。
  - 模型触发的工具副作用在执行前没有独立的 approval / policy checkpoint。
  - MCP tool 与本地 tool 名称可能碰撞，存在覆盖/歧义风险。

**评分**：⭐⭐⭐ (3/5)

---

## 7. Skill 详细说明

### 7.1 Skill 的分类

- **物理格式**：目录 + `SKILL.md`，使用 YAML frontmatter。
- **作用域/类别**：
  - 以 bundled repo skills 为主（`mini_agent/skills/`）。
  - `skills_dir` 可配置，因此也可指向项目内或用户自定义目录。
  - 当前未看到 system-level / user-level / plugin-level 的显式多源合并协议。

### 7.2 Skill 的加载顺序

- 优先级从高到低：
  1. `config.tools.skills_dir` 若为绝对路径，直接使用。
  2. `./skills`
  3. `./mini_agent/skills`
  4. `Config.get_package_dir() / skills_dir`
- **发现方式**：`Path.rglob("SKILL.md")`，支持嵌套目录发现。

### 7.3 Skill 与 System Prompt 的映射关系

- **元数据进入 prompt**：
  - `SkillLoader.get_skills_metadata_prompt()` 生成 name + description 列表。
  - CLI 启动时把该 metadata 替换进 `system_prompt.md` 的 `{SKILLS_METADATA}` 占位符。
- **完整内容注入时机**：
  - 默认不注入。
  - 模型需要时调用 `get_skill(skill_name)`，tool result 再回注到对话历史。
- **Progressive Disclosure**：✅ 有，且是本仓库最成熟的子系统之一。

### 7.4 动态 Skill 的注册、发现、注入与使用

- **发现触发条件**：启动时一次性 discover。
- **注册表/缓存机制**：`SkillLoader.loaded_skills: Dict[str, Skill]`。
- **条件 Skill 激活**：由模型自行决定是否调用 `get_skill`，没有 path-filtered / implicit activation。
- **与 Hook 的交互**：无，Skill 不能声明 Hook。

### 7.5 Verdict 评价

- **完整性**：对 bundled skills 的发现、元数据注入、按需加载都比较完整。
- **Token 效率**：通过 metadata + on-demand full content，控制得很好。
- **扩展性**：新增 skill 很方便，且能自动把相对路径重写成绝对路径。
- **不足**：
  - 只在启动时 discover，不支持热重载。
  - `allowed-tools` 只是被解析并存储，**没有 enforcement**。
  - 没有 skill 依赖、版本、卸载机制。

**评分**：⭐⭐⭐⭐ (4/5)

---

## 8. Sub-Agent 详细说明

### 8.1 Sub-Agent 引擎的实现

- **专门的 Sub-Agent 调度引擎**：没有。
- **并发/层级限制**：不存在模型驱动的 sub-agent，所以也没有深度控制。
- **唤醒机制**：无。
- **注册与发现**：无 tool-call 动态 spawn。
- **分类策略**：无。
- **结果回归**：无。
- **注销/清理**：无。
- **输出持久化**：无。
- **权限管理**：无。
- **模型使用**：无单独 sub-agent model routing。
- **上下文管理**：无独立/共享上下文 fork 机制。

> 需要区分：`mini_agent/acp/__init__.py` 能为 ACP/Zed 创建多个**会话级 Agent 实例**，但这只是编辑器桥接，不是主 Agent 主动调度子代理。

### 8.2 Sub-Agent 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/mini-agent/mini_agent/acp/__init__.py` | ACP session 适配；不是 sub-agent 框架 |

### 8.3 Sub-Agent 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 调度引擎 | 无 | 只有 ACP session registry |
| 生命周期管理 | `MiniMaxACPAgent._sessions` | 会话级，不是任务级 |
| 上下文隔离 | 每个 ACP session 一个 `Agent` | 仅 editor integration |
| 权限与沙盒 | 无 | 继承主进程权限 |
| 结果回归 | ACP `sessionUpdate` | 只回流 UI 更新 |

### 8.4 Verdict 评价

- **完整性**：不具备 Sub-Agent 生命周期。
- **隔离性**：ACP session 彼此独立，但不是能力型代理。
- **可观测性**：ACP 有状态更新，但没有 token / 错误 / 工具级审计面板。
- **不足**：
  - 没有 spawn/delegate/fork。
  - `loadSession=False`，ACP 也不支持恢复历史。
  - `cancel` 只是布尔标记，不能中断已经在跑的 LLM 请求或工具。

**评分**：⭐ (1/5)

---

## 9. TUI 详细说明

### 9.1 TUI 引擎的实现

- **驱动方式**：`prompt-toolkit` 的 REPL + `asyncio` 交互循环。
- **渲染方式**：普通终端文本 + ANSI 颜色；不是 full-screen TUI。
- **刷新机制**：事件驱动式打印，没有虚拟 DOM / diff 渲染。
- **数据通讯**：CLI loop 直接操作 `Agent` 实例；无组件化状态总线。
- **多窗口/面板**：不支持。
- **焦点管理**：依赖 `prompt-toolkit`；额外用单独线程监听 `Esc` 取消。

### 9.2 TUI 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/mini-agent/mini_agent/cli.py` | 交互式 CLI、命令、key bindings |
| `context/mini-agent/mini_agent/utils/terminal_utils.py` | 宽字符/emoji 显示宽度计算 |

### 9.3 TUI 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 驱动引擎 | `PromptSession.prompt_async()` | 经典命令行交互 |
| 渲染引擎 | ANSI print | 无全屏重绘 |
| 刷新机制 | 每个事件直接输出 | 无脏区检测 |
| 数据通讯 | 共享 `Agent` 对象 | 简单但不分层 |

### 9.4 Verdict 评价

- **完整性**：对“命令行聊天”来说足够，对“TUI”来说偏简陋。
- **性能**：输出量不大时没问题；长日志/长 thinking 时会刷屏。
- **可扩展性**：要做 pane、浮层、状态栏，基本得重写。
- **不足**：
  - 无流式渲染。
  - 无多面板。
  - 无主题系统。
  - 无结构化 UI 组件树。

**评分**：⭐⭐ (2/5)

---

## 10. To-Do List 详细说明

### 10.1 To-Do List 引擎的实现

- **parse 原理**：未实现。
- **本地创建与注册**：未实现。
- **状态机**：未实现。
- **与 ReAct 集成**：未实现。
- **更新维护机制**：未实现。
- **持久化格式**：未实现。
- **子任务/依赖/优先级**：未实现。

### 10.2 To-Do List 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `-` | 未实现 To-Do 子系统 |

### 10.3 To-Do List 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| Parse 引擎 | 无 | |
| 创建注册 | 无 | |
| 状态维护 | 无 | |
| 持久化 | 无 | |

### 10.4 Verdict 评价

- **完整性**：无。
- **集成度**：无。
- **可靠性**：无。
- **不足**：缺少 todo parse、状态机、依赖关系、用户可见任务面板。

**评分**：⭐ (1/5)

---

## 11. CLI Permission 与执行模式详细说明

### 11.1 CLI Permission 引擎的实现

- **执行模式**：
  - 只有两种：交互模式 `mini-agent`，非交互模式 `mini-agent --task ...`。
  - 没有 plan-mode / edit-mode / auto-mode / yolo-mode。
- **模式切换**：完全由 CLI 参数决定。
- **权限分层模型**：
  - 基本没有独立权限引擎。
  - 更接近“工具开关”：`enable_file_tools` / `enable_bash` / `enable_note` / `enable_skills` / `enable_mcp`。
- **不同行为差异**：
  - 交互与非交互主要差在是否进入 REPL，并非安全策略差异。
- **Guardian / Policy / Approval 中间件**：没有；模型一旦产出 tool call，执行前也没有额外的策略闸门。
- **拦截后的恢复路径**：没有审批拒绝-再恢复的设计。

### 11.2 CLI Permission 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `context/mini-agent/mini_agent/config.py` | 工具启停配置 |
| `context/mini-agent/mini_agent/cli.py` | 交互 / 非交互模式分流 |
| `context/mini-agent/mini_agent/tools/file_tools.py` | 文件访问实际执行 |
| `context/mini-agent/mini_agent/tools/bash_tool.py` | shell 执行实际执行 |

### 11.3 CLI Permission 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 模式引擎 | `--task` vs REPL | 不是权限模式 |
| 权限分层 | tool enable flags | 粒度很粗 |
| 审批中间件 | 无 | 无 ask/deny/retry 流 |
| 安全策略 | 无 | 只能依赖外部容器/OS 限权 |

### 11.4 Verdict 评价

- **完整性**：远未覆盖现代 Agent CLI 的权限治理链路。
- **安全性**：工作区不是硬边界；`read_file` / `write_file` / `edit_file` 都接受绝对路径；`bash` 可直接执行任意命令。
- **用户体验**：简单直接，但前提是“信任本机 + 信任当前仓库 + 信任模型”。
- **不足**：
  - 无审批流。
  - 无 sandbox。
  - 无 workspace trust。
  - 无高风险命令拦截。

**评分**：⭐ (1/5)

---

## 12. API 接口处的缓存安排

- **Prompt Cache**：未实现。
- **Cache 断点检测 / 命中率监控**：未实现。
- **压缩 / system prompt / 工具变更时的 cache 保护**：未实现。
- **其他 API 优化**：
  - 有 tool schema 统一序列化。
  - 有 message summary 压缩。
  - 但没有请求合并、批量 tool result、cache key、preflight token budget 等显式优化。

---

## 13. 对不同 LLM 模型的逻辑安排

- **支持的 provider / 协议**：
  - `anthropic`
  - `openai`
- **Provider 抽象层**：有，体现为 `LLMProvider` + `LLMClient` facade。
- **特殊处理**：
  - Anthropic：支持 `thinking` block、`tool_use` block、usage cache 字段读取。
  - OpenAI：通过 `reasoning_split=True` 读取 `reasoning_details`；工具 schema 转成 OpenAI function format。
  - MiniMax 域名会自动补 `/anthropic` 或 `/v1` 后缀。
- **自动切换 / fallback**：没有。

---

## 14. 其他 Agent-Specific 优势、亮点与效率提升

### 14.1 架构亮点

- **最亮点是“渐进式 Skill 披露”**：
  - 启动时只注入 metadata。
  - 真正需要时再通过 `get_skill` 拉全量内容。
  - 这比把 15 个 skill 全塞进 prompt 更节省 token。
- **MCP 适配层做得比这个仓库的其余部分更成熟**：
  - 支持 stdio / sse / http / streamable_http。
  - 有全局与 per-server timeout。

### 14.2 性能与效率

- 主 Agent 本身没有并行 tool runtime。
- 背景 bash 支持长任务脱离主循环，并通过 `bash_output` 轮询增量输出。
- token 压缩是“能跑就行”的策略，成本低于工业级上下文恢复，但质量依赖模型摘要。

### 14.3 安全与沙盒

- 代码层面几乎没有真正的安全边界。
- 值得注意的审查结论：
  1. **文件工具不限制绝对路径**，工作区只是默认解析基准，不是沙盒。
  2. **`bash` 可执行任意 shell 命令**，无审批、无黑白名单。
  3. **模型触发的副作用型 tool call 在执行前没有 approval / policy checkpoint**。
  4. **运行日志默认写入 `~/.mini-agent/log` 且记录原始消息、thinking、工具参数与结果**，未做脱敏。

### 14.4 开发者体验

- 优点：
  - 代码结构清晰，小而容易读。
  - `Tool` / `LLMClient` 抽象简单，适合教学与二次开发。
  - ACP 适配能接入 Zed。
- 现有测试基线：
  - `pytest` 基线为 **106 通过 / 11 失败 / 1 error / 4 skip**。
  - 失败主因不是核心逻辑崩坏，而是缺少 `mini_agent/config/config.yaml`、`mini_agent/config/mcp.json` 或有效 API Key。
- 明显 DX 缺口：
  - 文档声称 session note 可跨会话回忆，但 CLI 只注册 `record_note`，没注册 `recall_notes`。

### 14.5 独特功能

- 在“极小代码量”前提下，同时示范了：
  - provider facade（Anthropic/OpenAI）
  - progressive disclosure skills
  - MCP tool bridge
  - background bash
- 这让它很适合当“Agent CLI 教学样板”，而不是生产基座。

---

## 总体评分

| 维度 | 评分 (1-5) | 一句话总结 |
|------|------------|------------|
| LLM 请求方式 | 3 | 基础链路完整，但无流式、无 fallback、无主动 cache |
| Hooks | 1 | 基本未实现 |
| 上下文管理 | 3 | 有轻量压缩，但恢复力弱且记忆链路不完整 |
| Tool Use | 3 | 核心工具齐全，但串行执行且安全边界薄弱 |
| Skill 管理 | 4 | Progressive Disclosure 设计成熟，是本项目亮点 |
| Sub-Agent | 1 | 无真正 sub-agent，只是 ACP 会话适配 |
| TUI | 2 | 交互 CLI 可用，但不是现代全屏 TUI |
| To-Do List | 1 | 未实现 |
| CLI Permission | 1 | 无审批、无沙盒、无 trust 边界 |
| API 缓存 | 1 | 未实现显式 cache 设计 |
| 多模型支持 | 3 | 两种 provider 抽象清晰，但无自动切换 |
| 整体工程成熟度 | 2 | 适合教学与 demo，不适合直接作为生产级 Agent CLI |

### 最终客观评价与辩证分析

- **核心优势**：
  - 代码量小、结构直、阅读成本低。
  - Skill 的 progressive disclosure 设计非常漂亮。
  - MCP 和后台 bash 已经把“最小可用 Agent CLI”搭起来了。
- **明显短板**：
  - 没有 Hooks、Sub-Agent、To-Do、权限治理、Prompt Cache 这些现代 Agent CLI 的关键基础设施。
  - 安全边界非常弱：绝对路径文件访问、任意 shell、无审批、无 sandbox，而且模型触发的副作用调用没有执行前闸门。
  - 文档宣称的“跨会话记忆”在 CLI 实际装配中并不完整。
- **适用场景**：
  - 最适合教学演示、内部 PoC、个人可信环境下的小型仓库任务。
  - 不适合高风险运维、多人共享环境、生产代码库大规模自动改动。
- **发展建议**：
  - 第一优先级应补 **CLI Permission / sandbox / approval**，因为这决定它能否从 demo 跨到真实可托管工具。
  - 第二优先级是补齐 **会话恢复 + recall_notes + 更精细的上下文压缩恢复**。
  - 第三优先级再考虑 streaming、todo、sub-agent、hook 生态。
- **横向对比定位**：
  - 相比 codex、claude-code 这类工业化 CLI，mini-agent 更像“可运行的参考实现”。
  - 它的独特生态位不是功能最强，而是**把 Agent CLI 的关键构件拆到足够简单，适合学习、改造和二次试验**。
