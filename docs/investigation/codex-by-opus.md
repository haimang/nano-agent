# Agent CLI 深度分析模板

> 分析对象: `openai/codex` (Rust workspace)
> 分析时间: `2026-04-15`
> 分析者: `Claude Opus 4.6 (1M context)`
> 文件位置: `context/codex/`

---

## 1. 技术栈

| 维度 | 技术选型 |
|------|----------|
| **核心语言** | Rust (edition 2024 级 workspace，约 90+ 个 crate) |
| **运行时 / 框架** | `tokio` 多线程运行时；`tokio-tungstenite` (WebSocket)；`eventsource-stream` (SSE) |
| **包管理 / 构建工具** | Cargo workspace + Bazel (`MODULE.bazel`, `BUILD.bazel`)；Nix flake；`justfile` |
| **UI / CLI 库** | `ratatui` (with `scrolling-regions`, `unstable-widget-ref` 等 unstable feature)；`crossterm` 作为 backend；`clap` 驱动 CLI 参数 |
| **LLM SDK / API 客户端** | 自研 `codex-client`/`codex-api` crate，直连 OpenAI **Responses API** (SSE 或 v2 beta WebSocket)；无第三方 SDK 依赖 |
| **配置解析** | `toml` (`~/.codex/config.toml`)；`serde_json` (hooks.json)；`serde_yaml` (SKILL.md frontmatter) |
| **测试框架** | Rust 原生 `cargo test`；`insta` 快照；集成测试大量使用 `tempfile` + 手搓 mock server |
| **其他关键依赖** | `reqwest` (rustls)、`zstd` (请求体压缩)、`syntect`+`two-face` (语法高亮)、`landlock` / `seccompiler` (Linux 沙盒)、`rmcp` (MCP 客户端)、`uuid`、`tracing` |

> 这是一个以 Rust 为唯一主语言的大型多 crate workspace；`codex-cli/` 目录只保留 Node 壳以便通过 `npm` 安装分发，真正的实现全部在 `codex-rs/`。

---

## 2. 目录结构

```
context/codex/
├── codex-cli/                    # Node wrapper, 只负责分发
├── codex-rs/                     # 真正的 Rust 实现
│   ├── core/                     # Agent 循环、会话、上下文、工具执行、Guardian
│   │   └── src/
│   │       ├── codex.rs          # Codex / Session / TurnContext 主入口
│   │       ├── codex_delegate.rs # Sub-Agent 委托执行
│   │       ├── client.rs         # ModelClient / ModelClientSession (LLM 请求层)
│   │       ├── client_common.rs
│   │       ├── compact.rs        # 本地摘要压缩
│   │       ├── compact_remote.rs # 远端 (OpenAI Responses Compact) 压缩
│   │       ├── context_manager/  # ContextManager, history, normalize
│   │       ├── hook_runtime.rs   # Hook 分发入口
│   │       ├── guardian/         # 审批中间件 + Guardian LLM
│   │       ├── tools/            # Tool handler 实现集
│   │       └── ...
│   ├── codex-api/                # Responses API wire types + SSE/WS 解析
│   ├── codex-client/             # 通用 HTTP transport (retry/backoff/zstd)
│   ├── model-provider-info/      # Provider 抽象：OpenAI / Ollama / LMStudio
│   ├── rollout/                  # JSONL 会话持久化
│   ├── thread-store/             # 线程/子 Agent 的结构化存储
│   ├── hooks/                    # Hook 事件模型、discovery、config
│   ├── skills/ + core-skills/    # Skill 加载、注入、mention 识别
│   ├── tools/                    # 工具 schema 与 plan 构建器 (plan_tool.rs 等)
│   ├── tui/                      # ratatui 驱动的 TUI
│   ├── login/                    # API Key / ChatGPT OAuth 管理
│   ├── mcp-server/ + rmcp-client/ + codex-mcp/   # MCP 服务器与客户端
│   ├── execpolicy/ + sandboxing/ + linux-sandbox/ + windows-sandbox-rs/
│   ├── protocol/                 # 内部 submission/event 协议
│   ├── apply-patch/              # Codex 专有的 patch DSL 解析器
│   ├── chatgpt/ + cloud-tasks/   # ChatGPT Account / 云端任务桥接
│   └── ...
├── docs/                         # 用户向文档
└── sdk/                          # 对外的 SDK 封装
```

> `codex-rs/core/src/client.rs`、`codex-rs/codex-api/`、`codex-rs/codex-client/` 共同构成 LLM 请求栈；`codex-rs/core/src/tools/` + `codex-rs/tools/` 构成工具栈；`codex-rs/core/src/guardian/` + `execpolicy/` + `sandboxing/` 构成权限与沙盒栈。

---

## 3. LLM 请求方式详细说明

### 3.1 LLM 请求引擎的实现

- **认证**：`login/src/auth/manager.rs` 的 `AuthManager` 负责三类凭据——`OPENAI_API_KEY` (或 provider 的 `env_key`)、ChatGPT 设备码 OAuth (access+refresh，写入 `~/.codex/auth.json`)、以及 provider 配置中的 "auth 命令" (如 Ollama 可用 shell 命令生成 bearer token)。对 ChatGPT 登录，`core/src/client.rs:285` 附近还会从 JWT claims 中解析出 `ChatGPT-Account-ID` 并注入请求头。
- **入口封装**：会话级 `ModelClient` (`core/src/client.rs:193`) 持有 `auth_manager`、`model_provider`、`conversation_id`、`window_generation`、`installation_id`；每一轮再构造出 turn 级的 `ModelClientSession` (`client.rs:211`)，负责一次 turn 内的 SSE/WS 流式连接与路由 token (`x-codex-turn-state`)。外部调用方统一调用 `ModelClientSession::stream(prompt, telemetry, turn_meta)`。
- **流式 vs 非流式**：**只走流式**。默认是 HTTP POST `/responses` + SSE，解析在 `codex-api/src/sse/responses.rs` (`spawn_response_stream` ~L57)。此外内置一条 **WebSocket v2 beta** 路径 (`codex-api/src/endpoint/responses_websocket.rs`)，带 prewarm (`generate=false`) 与 sticky 路由。没有"一次性等完整 JSON"的模式。
- **请求体构建**：`ResponsesApiRequest` (`codex-api/src/common.rs:154`) 字段包括 `model`、`instructions`、`input` (一组 `ResponseItem`)、`tools` (通过 `create_tools_json_for_responses_api()` 拼装，`core/src/client.rs:79`)、`tool_choice`、`reasoning`、`store`、`stream` 和可选 `prompt_cache_key`。header 构造在 `codex-api/src/endpoint/responses.rs:84-95`，会挂上 installation id、turn state、metadata、可选 subagent header；若 provider 开启压缩，则再走一层 zstd 请求体压缩 (`core/src/client.rs:1114`)。
- **响应解析**：SSE 事件由 `ResponsesStreamEvent` 结构反序列化 (`codex-api/src/sse/responses.rs:163`)；`OutputTextDelta` 负责文本片段 (L316)；`FunctionCall`/`FunctionCallOutput` 作为 `ResponseItem` 变体进入历史；`usage` 中保留 `cached_tokens`、`reasoning_tokens`；服务器通过 `x-reasoning-included`、`openai-model`、`x-models-etag` 等 header 传递额外元数据，分别在 L64–L77 与 L186–L199 被提取。`finish_reason` **没有**显式公开字段，靠 completion event 来隐式推断——这是一个小的可观测性缺口。
- **重试**：`codex-client/src/retry.rs` 实现 **指数退避 + 10% jitter** (`2^(n-1) * base * rand(0.9..1.1)`)；默认 base=200ms；请求级重试 4 次、流式级重试 5 次 (`model-provider-info/src/lib.rs:25-32`)，硬上限 100。默认 5xx/网络错误重试，429 是否重试**由 provider 配置决定**，OpenAI Responses 默认**关闭**。**未处理** `Retry-After` header——在大规模被限流场景下会比较尴尬。
- **缓存**：没有 Anthropic 风格的 `cache_control` 断点；取而代之的是 Responses API 的 `prompt_cache_key` 字段 (`codex-api/src/common.rs:170`)。服务端 `x-models-etag` 被透出，但客户端没有主动的缓存命中率统计或 cache breakpoint 调度。
- **持久化**：rollout 走 `rollout/src/recorder.rs:65`，按 `~/.codex/sessions/rollout-<ts>-<uuid>.jsonl` 追加 JSONL；每行可以是 `SessionMeta`、`ResponseItem`、`CompactedItem`、`TurnContext` 或 `EventMsg`。`thread-store/` 在此之上又封装出 `LimitedEvents` / `ExtendedEvents` 两种持久化模式以支持 app-server 的 resume/fork/archive。字段保留角色、模型名、token usage、git 信息、sandbox policy 等，能够完整重放一条会话。
- **整体特点**：把 "HTTP 传输 + 重试 + 压缩" 单独抽成 `codex-client`，把 "wire types + SSE/WS 解析" 放在 `codex-api`，让业务层 `core/src/client.rs` 只关心 turn 状态。这种三层切分是同类 agent 中比较少见的清晰度。

### 3.2 LLM 请求代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/core/src/client.rs` | `ModelClient` / `ModelClientSession`：会话级 & turn 级客户端 |
| `codex-rs/core/src/client_common.rs` | 公共 helper、header 拼接、错误分类 |
| `codex-rs/codex-api/src/common.rs` | `ResponsesApiRequest` / 工具序列化 / `prompt_cache_key` |
| `codex-rs/codex-api/src/endpoint/responses.rs` | HTTP /responses 调用与 header 构建 |
| `codex-rs/codex-api/src/endpoint/responses_websocket.rs` | WebSocket v2 beta 通道 |
| `codex-rs/codex-api/src/sse/responses.rs` | SSE 解析、事件分发、header metadata |
| `codex-rs/codex-client/src/transport.rs` | `reqwest` 封装、zstd 压缩、TLS |
| `codex-rs/codex-client/src/retry.rs` | 指数退避 + jitter 重试 |
| `codex-rs/model-provider-info/src/lib.rs` | Provider 抽象、`wire_api`、重试/超时常量、内建 provider |
| `codex-rs/login/src/auth/manager.rs` | API Key / ChatGPT OAuth / provider auth 命令 |
| `codex-rs/rollout/src/recorder.rs` | JSONL 会话持久化 |
| `codex-rs/thread-store/src/types.rs` | Thread 结构化存储 + resume/fork |

### 3.3 LLM 请求子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 认证机制 | `AuthManager` + JWT claims 提取 + provider auth command | 支持 ChatGPT 订阅账户登录，这是 codex 独有的 |
| API Wrapper | `ModelClient` (会话级) + `ModelClientSession` (turn 级) | turn 级 session 是亮点，便于挂 sticky routing |
| 重试机制 | 指数退避 + ±10% jitter，请求 4 / 流 5，base 200ms | 无 `Retry-After`、429 默认不重试 |
| 本地缓存 | 无 LLM 响应缓存；只有服务端 `prompt_cache_key` | 比 Anthropic cache_control 粗很多 |
| Session 持久化 | `~/.codex/sessions/` JSONL rollout + `thread-store` | 足以完整 resume |
| 聊天记录结构 | `ResponseItem` enum (Message/Reasoning/FunctionCall/FunctionCallOutput/LocalShellCall/Compaction/GhostSnapshot/…) | 变体数量显著高于同类 CLI，表达力强 |

### 3.4 Verdict 评价

- **完整性**：认证、请求、重试、持久化完整；缓存侧只对齐了 OpenAI Responses 的 `prompt_cache_key`，没有 provider 无关的客户端缓存。
- **可靠性**：指数退避 + jitter 已经到位；但未处理 `Retry-After` 也没有断路器；在 ChatGPT 订阅通道被限流时客户端感知较弱。
- **可观测性**：OTEL 相关 crate (`codex-rs/otel`) 已在 workspace 中；SSE 会透出 `x-reasoning-included`、`x-models-etag`、`openai-model` 等 header，但缺 `finish_reason`、缺显式的 cache 命中率面板。
- **不足**：(1) 只支持 Responses 一种 wire API，`chat` 已被明文 reject (`model-provider-info/src/lib.rs:36,64`)；(2) 缺 `Retry-After` 解析；(3) 没有 Anthropic 风格的显式 cache breakpoint；(4) 单一 `finish_reason` 的缺失对调试模型行为略有不便。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 4. Hooks 详细说明

### 4.1 引擎的实现

- **注册与发现**：由 `hooks/src/engine/discovery.rs` 负责，沿 config layer stack (system → user → project) 扫描 `hooks.json`。每一层可以贡献独立的 handler 集合；缺失即代表该层无 hook。
- **调度器**：`hook_runtime.rs` 是 `core` 侧的入口，按事件类型调用对应 dispatcher (`pre_tool_use` / `post_tool_use` / `user_prompt_submit` / `stop` / `session_start`)，目前 **串行执行**，声明 `async` 的 handler 会被 **显式忽略** (discovery.rs 里的 warn 日志)。
- **执行模式**：唯一官方模式是 **Shell 命令**。通过子进程运行，stdin 传入 JSON payload，stdout/stderr 解析为结构化 outcome。默认超时 600 秒，可逐 handler 覆写 (`command_runner.rs`)。配置中虽然存在 `type: "prompt"` 和 `type: "agent"`，但 discovery 阶段会直接跳过——文档里的承诺比实际能力更大。
- **影响主流程**：`PreToolUse` 可以 `should_block + block_reason` 完全拦截工具调用；`PostToolUse` 可以 `should_stop` 打断本 turn 并通过 `additional_contexts` 把 stdout 注入为 DeveloperInstructions；`UserPromptSubmit` 与 `Stop` 类似，还能通过 `continuation_fragments` 干预 stop 行为。注入机制集中在 `core/src/hook_runtime.rs:281-299` 的 `record_additional_contexts()`。

### 4.2 Hooks 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/hooks/src/engine/discovery.rs` | 扫描各 config layer 的 `hooks.json` |
| `codex-rs/hooks/src/engine/config.rs` | JSON schema：hooks 映射、handler、matcher |
| `codex-rs/hooks/src/engine/dispatcher.rs` | handler 选择 + 同步调度 |
| `codex-rs/hooks/src/engine/command_runner.rs` | 子进程执行、超时、JSON stdin/stdout |
| `codex-rs/hooks/src/events/common.rs` | Matcher (regex) 工具函数 |
| `codex-rs/hooks/src/events/pre_tool_use.rs` | PreToolUse outcome 模型 |
| `codex-rs/hooks/src/events/post_tool_use.rs` | PostToolUse outcome 模型 |
| `codex-rs/hooks/src/events/user_prompt_submit.rs` | UserPromptSubmit |
| `codex-rs/hooks/src/events/stop.rs` | Stop outcome + continuation_fragments |
| `codex-rs/hooks/src/events/session_start.rs` | SessionStart (startup/resume/clear) |
| `codex-rs/core/src/hook_runtime.rs` | core 侧分发 + context 注入 |

### 4.3 全部 Hook 说明

| Hook 名称 | 触发时机 | Matcher 能力 | 输出影响 |
|-----------|----------|--------------|----------|
| `PreToolUse` | 每次工具调用前 | 按 tool 名称的 regex | `should_block` + `block_reason` 拦截工具 |
| `PostToolUse` | 工具调用返回后 | 按 tool 名称的 regex | `should_stop` 停 turn；`additional_contexts` 注入 Developer message |
| `UserPromptSubmit` | 用户提交输入时 | 无 matcher | 拦截输入 / 注入上下文 |
| `Stop` | Assistant 即将结束 turn | 无 matcher | 否决 stop / 通过 `continuation_fragments` 继续 |
| `SessionStart` | 启动/恢复/清空会话 | 按 source 字符串 regex (startup/resume/clear) | 注入 developer context / 阻止启动 |

### 4.4 Verdict 评价

- **成熟度**：事件覆盖了 tool 调用前后、prompt 提交、stop、session start，这在同类 CLI 中已经相当完整。
- **扩展性**：JSON + regex + shell 命令的组合对用户来说易上手；但 `type: "prompt"` / `type: "agent"` 的"预留槽"让配置和运行时承诺不对齐，用户可能踩坑。
- **安全性**：**完全没有**沙盒或信任检查，hook 命令以当前 cwd 与完整权限执行。这意味着恶意 `hooks.json` 落到 project 目录就是 RCE。虽然 codex 在 directory trust 上有整体防护，但 hook 本身并不参与 guardian 审核。
- **不足**：(1) 异步 hook 未实现；(2) prompt/agent 两种模式被吞掉；(3) 没有 Notification/MCP 等事件；(4) matcher 仅限 tool 名；(5) hook 结果没有 dry-run 预览。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 5. 上下文管理详细说明

### 5.1 上下文引擎的实现

- **状态持有者**：`Codex` (`core/src/codex.rs:401`) → `Session` (L840) → `TurnContext` (L881) → `ContextManager` (`context_manager/history.rs:34`)。其中 `Session` 以 `Mutex<SessionState>` 封装可变状态，`TurnContext` 只活在一次 turn 内，持有模型信息、reasoning effort、personality。
- **内存结构**：`ContextManager` 的 `items: Vec<ResponseItem>` 是唯一 source of truth；`ResponseItem` 是一个变体相当丰富的 enum，除常见的 `Message`/`FunctionCall` 外还包括 `Reasoning`、`LocalShellCall`、`ToolSearchCall`、`WebSearchCall`、`ImageGenerationCall`、`CustomToolCall`、`Compaction`、`GhostSnapshot`。附带 `history_version` (写后自增) 与 `token_info`，以及一个 `reference_context_item` 用来做"基准 vs 当前"的 diff 注入。
- **规范化**：每次送进 LLM 前会调 `ContextManager::for_prompt()` (history.rs:120)，内部串起 `normalize_history()` (去掉 ghost snapshot、按模型 modality 能力替换图像)、`ensure_call_outputs_present()` (为悬空的 `FunctionCall` 合成占位 output)。这是避免 Responses API 因为"调用缺 output"而 500 的关键防线。

### 5.2 上下文管理代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/core/src/codex.rs` | `Codex` / `Session` / `TurnContext` |
| `codex-rs/core/src/codex_thread.rs` | 与 thread-store 的衔接 |
| `codex-rs/core/src/context_manager/history.rs` | `ContextManager` + `for_prompt` + `record_items` |
| `codex-rs/core/src/context_manager/normalize.rs` | image/call-output 归一化 |
| `codex-rs/core/src/compact.rs` | 本地 LLM 摘要压缩 |
| `codex-rs/core/src/compact_remote.rs` | OpenAI Responses Compact 端点 |
| `codex-rs/core/src/environment_context.rs` | env 上下文构建 |
| `codex-rs/core/src/contextual_user_message.rs` | 用户消息预处理 (skill mention 等) |

### 5.3 全部分层说明

| 层级 | 内容 | 是否持久化 | 备注 |
|------|------|------------|------|
| System prompt | `get_model_instructions(personality)` + 模型族默认指令 | 否 (派生) | 按 personality 变种 |
| Developer instructions | 来自 config、实验 feature 的硬编码 developer message | 否 (派生) | |
| Project doc | AGENTS.md (`project_doc::discover_project_doc_paths`) | 是 (作为文件) | 按 cwd 向上遍历 |
| User instructions | 配置中的 `instructions` 字段 | 是 (config) | |
| Environment context | cwd、shell、sandbox policy、git info | 否 | 由 `environment_context.rs` 构建 |
| Skills metadata | 所有已发现 skill 的 name + 短描述 | 否 (派生) | render.rs |
| 对话历史 | `Vec<ResponseItem>` (含 reasoning / tool call / 输出) | 是 (JSONL rollout) | `ContextManager` |
| Reference context | `reference_context_item`：上次"初始上下文"快照 | 否 | 用于 diff 再注入 |
| Ghost snapshot | `/undo` 用的快照 | 是 (rollout) | 压缩时保留 |

### 5.4 上下文压缩机制

- **触发条件**：`model_auto_compact_token_limit` (config L238) 阈值；在两个地方检查——turn 开始前 (`codex.rs:6462`) 以及 turn 进行中 (L6710)。用户也可以手动触发。
- **两条压缩路径**：
  1. **本地摘要** (`compact.rs:64` `run_inline_auto_compact_task`)：用当前 LLM 走一次 `SUMMARIZATION_PROMPT` (模板在 `templates/compact/prompt.md`)，把历史压成一段 summary。
  2. **远端摘要** (`compact_remote.rs:34` `run_inline_remote_auto_compact_task`)：只对 OpenAI provider 生效 (`should_use_remote_compact_task`)，调用服务端的 Responses Compact 端点。这把摘要成本推给后端，是 codex 独有的优化。
- **分层逻辑**：工具输出通过 `codex_utils_output_truncation::TruncationPolicy` 截断；压缩 prompt 自身若超过窗口，会再走一次 history 头部裁剪 (codex.rs:6715)；ghost snapshot **不会**被压缩吞掉 (compact_remote.rs:135)，`/undo` 能力得以保留。
- **再注入策略**：`InitialContextInjection` 枚举 (compact.rs:55) 有 `BeforeLastUserMessage` 与 `DoNotInject` 两档，对应 mid-turn 和 pre-turn 场景；压缩完成后 `reference_context_item` 被清空 (history.rs:50)，下一轮 turn 会重建基线，保证系统 prompt、工具列表、skill 元数据都完整回到上下文。

### 5.5 Verdict 评价

- **完整性**：覆盖了"阈值监测 → 两路压缩 → 工具裁剪 → ghost 保留 → 再注入"的完整生命周期，是同类 CLI 里少见的精细。
- **精细度**：token 的估算走 `token_info`，粒度到条目级别；但压缩策略本身仍是"一次性整段摘要"，没有按层级差异化。
- **恢复能力**：`reference_context_item` + ghost snapshot + 下一轮 turn 重建 baseline，失忆风险相对低。`/undo` 明确被保护是个很好的工程信号。
- **不足**：(1) 没有 layer-aware 的差异化压缩策略 (例如 tool result 激进截断、reasoning 保留)；(2) 远端压缩是 OpenAI only，其他 provider 无对等降级；(3) `reference_context_item` 的语义在代码里不是最好读，维护成本偏高。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 6. Tool Use 详细说明

### 6.1 Tool Use 引擎的实现

- **抽象**：`ToolHandler` trait (`core/src/tools/registry.rs:39`) 规定 `kind()`、`matches_kind()`、`is_mutating()`、`pre_tool_use_payload()`、`post_tool_use_payload()`、`handle() -> Result<Self::Output, FunctionCallError>`；输出类型再实现 `ToolOutput` trait (`tools/context.rs:80`) 提供 `to_response_item()`、`log_preview()`、`code_mode_result()` 等投影。
- **注册**：`ToolRegistryBuilder` → `ToolRouter` (`tools/router.rs`)；`build_specs_with_discoverable_tools()` (`tools/spec.rs:58`) 把 schema 描述与 handler 实现绑定，产物是送进 LLM 的 tools 数组 + 路由表。schema 元数据由单独的 `codex-rs/tools/` crate 生成，handler 绑定则在 core 内完成——schema/实现分离让跨进程复用变得可行。
- **执行流程**：(1) SSE 解析出 `FunctionCall`；(2) `ToolCallRuntime` 拿到 `tool_supports_parallel()` 判断并发；(3) hook runtime 触发 `PreToolUse`；(4) guardian 做审批；(5) handler `handle()` 执行；(6) 产物经 `ToolOutput::to_response_item()` 回灌到历史；(7) `PostToolUse` 再触发。
- **并行**：`tools/parallel.rs:32` 用 `Arc<RwLock<()>>` 作为 "gate"：支持并行的 handler 取读锁，必须串行的取写锁。MCP server 也能按 server 声明 `supports_parallel_tool_calls` (`codex.rs:6218`)。
- **结果回灌**：`FunctionCallOutput { call_id, output: FunctionCallOutputPayload }`，输出体走 `TruncationPolicy` 截断后 push 进 `ContextManager`。

### 6.2 Tool Use 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/core/src/tools/registry.rs` | `ToolHandler` / `ToolRegistryBuilder` |
| `codex-rs/core/src/tools/router.rs` | `ToolRouter` 路由 & 并行锁 |
| `codex-rs/core/src/tools/spec.rs` | `build_specs_with_discoverable_tools` |
| `codex-rs/core/src/tools/parallel.rs` | 并行 gate (`ToolCallRuntime`) |
| `codex-rs/core/src/tools/handlers/` | 各具体 handler (shell / apply_patch / plan / spawn_agent…) |
| `codex-rs/tools/src/plan_tool.rs` | `update_plan` schema |
| `codex-rs/core/src/function_tool.rs` | Function tool 泛型支持 |
| `codex-rs/core/src/mcp.rs` | MCP handler 入口 |
| `codex-rs/rmcp-client/src/rmcp_client.rs` | MCP client transport |
| `codex-rs/mcp-server/` | Codex 作为 MCP server 的实现 |

### 6.3 内建工具逐一列举与分析

| 工具名 | 文件 | 核心能力 | 特殊设计 |
|--------|------|----------|----------|
| `shell` | `tools/handlers/shell.rs` | 执行 shell 命令 | 进沙盒 + execpolicy 规则匹配 |
| `unified_exec` | `tools/handlers/unified_exec.rs` | 跨平台统一执行前端 | 与 `local_shell` 配合 |
| `local_shell` / `container.exec` | `tools/handlers/shell_command.rs` | 平台相关 shell | 区分宿主机 vs 容器 |
| `apply_patch` | `tools/handlers/apply_patch.rs` + `apply-patch/` crate | 自研 patch DSL (非 git 标准 diff) | 可被文件系统沙盒拦截 |
| `list_dir` | `tools/handlers/list_dir.rs` | 目录遍历 | |
| `plan` / `update_plan` | `tools/src/plan_tool.rs` | 结构化 plan 更新 | 详见 §10 |
| `spawn_agent` v1/v2 | `tools/handlers/multi_agents*.rs` | 生成 sub-agent | v2 引入 `followup_task` |
| `wait_agent` v1/v2 | 同上 | 阻塞等待子 agent | |
| `send_input` / `send_message_v2` | 同上 | 向正在运行的子 agent 发消息 | 支持"实时对话式"子 agent |
| `close_agent` / `list_agents` v2 | 同上 | 终止 & 枚举子 agent | |
| `agent_jobs` | `tools/handlers/batch_job.rs` | 批量 job 编排 | |
| `tool_search` / `tool_suggest` | `tools/handlers/tool_search*.rs` | 动态发现工具 / 建议工具 | 与 connectors/apps 集成 |
| `request_permissions` | `tools/handlers/request_permissions.rs` | 模型主动申请放宽 sandbox | guardian 审批 |
| `request_user_input` | `tools/handlers/request_user_input.rs` | 主动向用户提问 | TUI 弹窗 |
| `view_image` | `tools/handlers/view_image.rs` | 读入图像 | 与 normalize_history 协同 |
| `js_repl` / `js_repl_reset` | `tools/handlers/js_repl.rs` | 内嵌 JS 执行 (v8-poc) | "代码即工具" |
| `code_mode_execute` / `code_mode_wait` | `tools/handlers/code_mode*.rs` | 专用 code mode 运行时 | 与 `code-mode/` crate 协同 |
| `mcp` / `mcp_resource` | `core/src/mcp.rs` | MCP tool/resource 代理 | 动态工具 |
| `dynamic_tools` | `tools/handlers/dynamic_tools.rs` | 用户自定义工具 | 运行时注入 |

### 6.4 Verdict 评价

- **完整性**：内置工具覆盖 shell / patch / plan / 子 agent / 权限申请 / 用户交互 / JS REPL / MCP / 动态工具，是 3 家对比项目中最"臃肿但全面"的一套。
- **扩展性**：schema 与实现分离、MCP 一等公民、`dynamic_tools` + `tool_search` 支持运行时发现；加新工具的成本主要是 handler + spec 两边注册，不需要改通用路径。
- **健壮性**：并行锁清晰；输出统一截断；但工具后台进程管理分散，`js_repl_reset`、`close_agent` 等清理入口暴露给模型而不是统一的生命周期管理器，容易出现"模型忘记关"的资源泄漏。
- **不足**：(1) 没有内建的 Web 搜索 (`WebSearchCall` variant 存在但依赖服务端能力)；(2) v1/v2 子 agent 工具并存，维护面很大；(3) 工具数量过多对 token 成本不友好——需要 `tool_search` 才能收敛。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 7. Skill 详细说明

### 7.1 Skill 的分类

- **物理格式**：`SKILL.md` (`core-skills/src/loader.rs:105`)，YAML frontmatter + Markdown 正文；frontmatter 字段包括 `name`、`description`、`metadata.short-description`。可选的 `agents/openai.yaml` 扩展 `interface` (display_name、icon、brand_color、default_prompt)、`dependencies.tools` (MCP server 依赖)、`policy.allow_implicit_invocation`、`products`。
- **作用域 / 类别**：
  - **Repo**：`<project>/.codex/skills/`
  - **User**：`~/.agents/skills/` (新)，`$CODEX_HOME/skills/` (旧，deprecated)
  - **Bundled (system)**：内置 skill 解压到 `$CODEX_HOME/skills/.system`，由 `bundled_skills_enabled` 开关
  - **Admin**：`/etc/codex/skills/` (Unix)
  - **Plugin**：由宿主通过 `plugin_skill_roots` 注入

### 7.2 Skill 的加载顺序

- 在 `loader.rs:187-303` 与 `manager.rs:58-195`：按 **Repo > User > System > Admin** 的优先级返回，plugin 插入在它们之间由宿主决定。重名按路径去重，保留第一个发现的副本 (`loader.rs:175-178`)。
- 入口有两个：`skills_for_cwd()` (按 cwd 缓存) 与 `skills_for_config()` (按 `ConfigSkillsCacheKey` 缓存，`manager.rs:89-125`)，两者都支持 `force_reload`。
- 支持嵌套目录发现，但 **不** 支持运行时热更新——重新进程或显式 reload。

### 7.3 Skill 与 System Prompt 的映射关系

- 加载阶段只把 `name + short-description + path` 放进 system prompt 的 "Skills" 区段 (`core-skills/src/render.rs:5-48`)。这是一种**显式的 progressive disclosure**：token 开销与 skill 数量成一次线性关系，但常数很小。
- 完整正文只有在被用户提到 (`$skill-name` sigil 或明文名称匹配) 时，才会由 `SkillCollector` (`core-skills/src/injection.rs:59-150`) 以 `SkillInstructions` 协议 item 注入到当前 turn。
- 名称歧义时的解析策略：只要存在歧义，就**不自动注入**，等待用户明确或直接给路径。这避免"同名 skill 打架"。

### 7.4 动态 Skill 的注册、发现、注入与使用

- **发现触发**：主要是 cwd / config layer 发生变化时的按需重扫，没有基于 fs notify 的热重载。
- **注册表 / 缓存**：`SkillsManager` 内部两级缓存 (cwd / config 哈希)，并由 `SkillConfigRules` (`manager.rs:17-18`) 过滤禁用项。
- **条件激活**：`policy.allow_implicit_invocation` 默认 true，但现阶段代码里的"隐式激活"基本依赖用户文本里出现 skill 名，没有 path-filter / regex trigger 这样的自动规则。
- **MCP 依赖拉起**：`core/src/mcp_skill_dependencies.rs:32-120`——如果 skill 声明了 `dependencies.tools[*]` 且是 MCP 类型，在用户确认下会把该 MCP server 写进全局 config 并在当前会话拉起。这是 codex skill 生态里比较特别的一环。
- **与 Hook 交互**：两套体系完全独立，没有代码路径相互调用。

### 7.5 Verdict 评价

- **完整性**：四个 scope + bundled 内置 + plugin 注入 + MCP 依赖拉起，功能面最完整。
- **Token 效率**：严格的 metadata-only 注入 + 显式 mention 展开，在 skill 量级上线之后仍然可控。
- **扩展性**：加 skill 只需放一个带 frontmatter 的目录；`policy.products` 让同一 skill 可按产品 gating；对第三方插件友好。
- **不足**：(1) 没有 fs watch 的热更新；(2) "隐式调用"目前名不副实，仍然强依赖用户显式提及；(3) skill 之间没有显式依赖图；(4) skill 无法 unload / disable-per-turn。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 8. Sub-Agent 详细说明

### 8.1 Sub-Agent 引擎的实现

- **是否存在独立引擎**：**有**，独立且成熟。核心在 `core/src/codex_delegate.rs` + `tools/handlers/multi_agents*.rs`。sub-agent 本质上是又 spawn 出来的一整个 `Codex` 实例 (`run_codex_thread_interactive`, codex_delegate.rs:65)，不是"再来一次 LLM 调用"的轻量封装。
- **并发与深度**：一次会话可同时存在多个 sub-agent；深度上限由 `agent_max_depth` 配置控制 (`spawn.rs:52`)；`exceeds_thread_spawn_depth_limit()` 与 `next_thread_spawn_depth()` 一起防止无限递归。
- **唤醒机制**：基于 `tokio::sync::mpsc` 的 `tx_sub` / `rx_event` 消息总线——sub-agent 是长期存活的，可以被 `send_input` / `send_message_v2` 随时注入用户消息、由 `wait_agent` 阻塞等待其产出、由 `close_agent` 主动终结，或由 `list_agents` 枚举。这种"可对话的子 agent"在同类产品里不多见。
- **注册与发现**：完全由模型通过 tool call 动态创建——没有"用户预先配置的 sub-agent 类型"这一层。
- **回归机制**：sub-agent 的事件流通过 `forward_events()` (codex_delegate.rs:130) 被过滤后转发到主 session；审批请求被特殊路由到主 session 的 guardian (L121)；最终答案被提取出来封装为 tool output 回注主历史。
- **注销 / 清理**：显式的 `close_agent` tool；会话结束时 `Session` 的 drop 也会回收 (因为 sub-agent 生命周期挂在父 `Codex` 的任务树上)；无显式 GC。
- **持久化**：每个 sub-agent 独立写自己的 `~/.codex/sessions/rollout-*.jsonl`；fork 的时刻会先把父 rollout flush 到磁盘 (`control.rs:363`) 再读取为子历史种子；state DB 里记录 thread-spawn 边，根会话 resume 时可通过 BFS (`control.rs:423-472`) 递归恢复整棵 agent 树。
- **权限**：sub-agent **继承** 父的 `inherited_exec_policy`、`inherited_shell_snapshot`、MCP manager、SkillsManager (`codex_delegate.rs:80-87`)，不支持独立的 sandbox 级别——想对子 agent 收紧权限只能通过 `request_permissions` 反向申请。
- **LLM 使用**：复用父的 `auth_manager` 和 `models_manager`；模型默认继承父 `TurnContext`，但可以通过 spawn 参数 `model` 覆写 (`spawn.rs:80-86`)——**支持不同模型**。
- **上下文管理**：`ForkStrategy` 两档 (`control.rs:46-48`)：`FullHistory` (整段克隆) 或 `LastNTurns(n)` (截断到最近 N turn)；`keep_forked_rollout_item` (control.rs:96) 进一步过滤，只保留 user / developer / 最终 assistant message，剥离 tool call 和 reasoning——这是为了让子 agent"看到对话但不继承完整执行痕迹"。
- **Cache 协作**：没有显式的跨 agent prompt cache 协调；每个 sub-agent 都是独立的 `ModelClientSession`，cache key 各走各的。
- **联动**：sub-agent 的 transcript 通过 rollout 合入磁盘态，通过 forward_events 合入运行时事件流；文件系统侧的并发冲突**没有**专门的锁，依赖 OS 行为。

### 8.2 Sub-Agent 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/core/src/codex_delegate.rs` | spawn / 事件转发 / 审批路由 |
| `codex-rs/core/src/codex_delegate_tests.rs` | 回归测试 |
| `codex-rs/core/src/tools/handlers/multi_agents.rs` (+ v2) | spawn/wait/send/close/list 工具 |
| `codex-rs/core/src/agent/control.rs` | Fork 策略 / 深度 / resume 队列 |
| `codex-rs/core/src/agent/spawn.rs` | 深度检查、模型 override |
| `codex-rs/thread-store/` | thread-spawn 边的持久化 |
| `codex-rs/rollout/` | 每个子 agent 独立 rollout |

### 8.3 Sub-Agent 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 调度引擎 | Tool-mediated spawn + mpsc 消息总线 | 可对话式 sub-agent |
| 生命周期管理 | `ForkStrategy`、`next_thread_spawn_depth`、`close_agent` | 无 GC，靠任务树 drop |
| 上下文隔离 | `FullHistory` / `LastNTurns`，filter tool/reasoning | 可配置粒度 |
| 权限与沙盒 | 继承父 exec policy、MCP、skills | 无独立收紧能力 |
| 结果回归 | `forward_events` + tool output 注入 | 审批事件单独路由 |

### 8.4 Verdict 评价

- **完整性**：创建 / 对话 / 等待 / 枚举 / 终止 / 恢复 / 持久化都齐了；甚至支持整棵 agent 树的 resume——这是目前我审查过的 CLI 里对 sub-agent 最认真的一家。
- **隔离性**：上下文 fork 粒度合理 (FullHistory / LastN)；但权限隔离薄弱，子 agent 不能被父强制"降权"。
- **可观测性**：每个 sub-agent 的 rollout 独立 + forward_events 打通，主 agent 能感知子 agent 的 token 使用与事件。
- **不足**：(1) 没有父→子的权限收紧机制；(2) 没有文件并发冲突的协调；(3) v1/v2 两套 API 并存，对用户和维护者都是负担；(4) 子 agent 的上限靠配置而非动态资源监控。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 9. TUI 详细说明

### 9.1 TUI 引擎的实现

- **驱动**：`ratatui` + `crossterm` 后端 (`codex-rs/tui/Cargo.toml:71-76`)；事件循环完全 tokio 异步。crossterm 的 `EventStream` 被 `EventBroker` (`tui/src/tui/event_stream.rs`) 包装成 tokio broadcast，让多个消费者共享，同时在外部编辑器 spawn 时可以"主动放弃 stdin 订阅"。
- **渲染**：**全量重绘**，每帧通过 `Terminal::draw(|frame| draw_fn(frame))` 重构整棵 widget 树；没有 virtual DOM 或 dirty region。`ratatui` 的 `scrolling-regions` feature 让长对话的滚动代价可控。
- **刷新**：`FrameRateLimiter` (`tui/src/tui/frame_rate_limiter.rs:13`) 把最小帧间隔固定在 ~8.33ms (120fps 上限)；实际是"事件驱动 + 帧率夹逼"：收到 `draw_tx` 信号才尝试画，画的频率被 limiter 钳位。
- **组件树**：顶层 `App` 拥有 `ChatWidget` (主对话，`chatwidget.rs`，单文件 ~437KB) 与 `BottomPane` (输入/状态栏/审批浮层)；`ChatWidget` 内部拆成一长串 `HistoryCell` (`history_cell.rs`，~166KB)；`ExecCell` 专门渲染命令输出；`Status` 面板呈现限流、账户；`bottom_pane/` 下还有 `chat_composer`、`textarea`、`footer`、`approval_overlay`、`file_search`、`command_picker`、MCP 配置等子组件。
- **通讯**：`AppEvent` enum 是事件总线的消息类型，`AppEventSender` 广播到 `App` 主循环；draw/pause/resume 走 tokio broadcast/watch；widgets 内部保持 `App` 持有可变状态的"store"模式。
- **焦点 / 输入**：没有显式 focus stack，靠 bottom pane 的模态状态 (是否显示 overlay) 隐式路由。支持 keyboard enhancement flags (当终端支持时)；**未检测到鼠标事件处理**。
- **主题**：`terminal_palette.rs` 通过 `best_color()` 把 RGB 自适应到 TrueColor / 256 / 16 色；`syntect` + `two-face` 提供语法高亮；主题覆盖由 `render/highlight.rs` 管理。

### 9.2 TUI 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/tui/src/tui.rs` | 事件循环 + Terminal 初始化 |
| `codex-rs/tui/src/tui/event_stream.rs` | `EventBroker` 共享 crossterm 事件 |
| `codex-rs/tui/src/tui/frame_rate_limiter.rs` | 帧率钳位 |
| `codex-rs/tui/src/app.rs` | `App` 主状态 |
| `codex-rs/tui/src/app_event.rs` + `app_event_sender.rs` | `AppEvent` 总线 |
| `codex-rs/tui/src/chatwidget.rs` | 主对话视图 |
| `codex-rs/tui/src/history_cell.rs` | 单条历史单元格 |
| `codex-rs/tui/src/bottom_pane/` | 输入、状态栏、弹层子组件 |
| `codex-rs/tui/src/exec_cell/` | 命令输出单元 |
| `codex-rs/tui/src/diff_render.rs` | diff 预览渲染 |
| `codex-rs/tui/src/terminal_palette.rs` | 色彩能力探测 |

### 9.3 TUI 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 驱动引擎 | tokio + crossterm EventStream + broadcast | 编辑器 spawn 时可释放 stdin |
| 渲染引擎 | ratatui 全量重绘 + scrolling-regions | 长对话专门优化 |
| 刷新机制 | 事件驱动 + 120fps 钳位 | `FrameRateLimiter` |
| 数据通讯 | `AppEvent` 广播 + 共享 App 状态 | 非 Elm 架构 |

### 9.4 Verdict 评价

- **完整性**：输入、渲染、刷新、通讯链路齐备；还额外覆盖了审批 overlay、diff 预览、命令 picker、MCP 配置这些运维面板。
- **性能**：120fps 上限 + 帧率钳位 + `scrolling-regions` 让高频流式输出也不会明显卡顿；但全量重绘对 `chatwidget.rs` / `history_cell.rs` 这种超大单文件来说是维护毒药，重绘本身开销在极端长会话下仍有放大空间。
- **可扩展性**：组件树靠 Rust 模块拆分而非组件注册表；加新组件需要改多处 `AppEvent` 分支——对新贡献者不是特别友好。
- **不足**：(1) 无鼠标支持；(2) 主题系统不是显式的可插拔主题而是 palette 自适应；(3) 单文件超大 (400KB+) 的 chatwidget 对代码可读性是挑战；(4) 无内建 accessibility 适配。

**评分**：⭐⭐⭐⭐☆ (4/5)

---

## 10. To-Do List 详细说明

### 10.1 To-Do List 引擎的实现

- **Parse 原理**：走结构化 tool call。`update_plan` tool (`codex-rs/tools/src/plan_tool.rs:6`) 的 schema 要求两个字段：`plan: [{step, status}]` 与可选 `explanation`，`status` 仅允许 `pending` / `in_progress` / `completed`，并且**"同时最多一个 in_progress"** 作为文本约束写进 description (L35-48)，但**不是**由 Rust 类型强制。
- **本地创建 / 注册**：完全在内存里，作为一次 tool call 的输出进入 `ContextManager`；没有独立的 store / SQLite / JSON 文件。
- **状态机**：pending → in_progress → completed 扁平三态，无 blocked / cancelled。
- **与 ReAct 循环的集成**：plan 被当作一次 tool call 的副作用，落到历史后自然会参与下一轮 prompt 构造；不会被上下文压缩特殊保留 (除非作为普通 `ResponseItem` 留存)。
- **更新机制**：由模型在下一轮 `update_plan` 覆盖写入；没有基于 tool result 的自动推进，也没有用户确认步骤。
- **持久化**：**不单独持久化**，只随 rollout JSONL 流存档；不能跨会话继承。
- **嵌套 / 依赖 / 优先级 / 截止日期**：全部不支持。

### 10.2 To-Do List 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/tools/src/plan_tool.rs` | `update_plan` schema |
| `codex-rs/core/src/tools/handlers/plan.rs` | PlanHandler 实现 (注入为 ToolSpec::Function) |
| (消费侧) `codex-rs/core/src/context_manager/history.rs` | 作为普通 `ResponseItem` 参与历史 |

### 10.3 To-Do List 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| Parse 引擎 | JSON schema + Responses API tool call | 无自然语言后处理 |
| 创建注册 | 随 tool call 入 `ContextManager` | 无独立 registry |
| 状态维护 | 由模型覆写全量 plan | 无增量 diff |
| 持久化 | 随 rollout JSONL | 无专门 store |

### 10.4 Verdict 评价

- **完整性**：最小可用：有 schema、有约束、有状态。
- **集成度**：与 Agent 循环的集成自然——就是普通 tool call——但也因此没有特殊待遇，压缩时可能被吞掉。
- **可靠性**：状态机清晰 (只有三态)，但"最多一个 in_progress"靠文本约束，模型理论上可以违反；整份 plan 每次全量覆盖也意味着状态丢失后无法从子步恢复。
- **不足**：无 blocked/cancelled；无嵌套/依赖；无优先级/截止；无与 sub-agent 的 plan 分发；无持久化到独立文件；无 `/plan` 之类的命令化入口。

**评分**：⭐⭐⭐☆☆ (3/5)

---

## 11. CLI Permission 与执行模式详细说明

### 11.1 CLI Permission 引擎的实现

- **模式枚举**：`AskForApproval::{Never, OnRequest, UnlessTrusted}` (`tui/src/cli.rs:79`)；与之正交的 `SandboxMode::{ReadOnly, WorkspaceWrite, DangerFullAccess}`；便捷组合 `--full-auto` = `OnRequest + WorkspaceWrite`，`--dangerously-bypass-approvals-and-sandbox` (`--yolo`) = `Never + DangerFullAccess`。这是"审批策略 × 沙盒等级"的二维矩阵，而不是 plan-mode / edit-mode 一维模式切换。
- **切换**：CLI 参数 (`-a`、`-s`、`--full-auto`、`--yolo`)、config 文件、或模型通过 `request_permissions` 工具运行时申请。支持"trusted directory"概念——在受信目录里 `UnlessTrusted` 退化为自动通过。
- **权限分层**：文件读 / 文件写 / shell 执行 / 网络 / MCP 调用各自独立。`guardian/approval_request.rs:15-68` 里能看到的 `ApprovalRequest` 变体包括 `Shell`、`ExecCommand`、`Execve`、`ApplyPatch`、`NetworkAccess`、`McpToolCall`，后者还带 `destructive_hint` / `open_world_hint` / `read_only_hint` 三元标注——这是 MCP spec 的 annotations 被忠实继承。
- **行为差异**：`Never` 一律放行；`OnRequest` 把敏感动作丢给 Guardian 或 UI；`UnlessTrusted` 在可信目录外等同于 `OnRequest`；`DangerFullAccess` 关闭沙盒但审批仍可开。最大并行数由前述 `parallel_execution` 控制，而不是模式相关。
- **审批中间件 — Guardian**：`core/src/guardian/mod.rs` 是本项目最有特色的设计之一：在 `OnRequest` 模式下，部分审批请求会先交给一个独立的 "Guardian LLM"，以 90 秒 timeout 调用 (`GUARDIAN_REVIEW_TIMEOUT`, mod.rs:38)，返回结构化 JSON `{risk_level, user_authorization, outcome, rationale}`，由它决定是否让动作落地或转人工确认。guardian 是一个被克隆出的父 config + 继承 network proxy / allowlist 的 mini session，**默认复用父会话当前的 active model**（`review_session.rs:721`）；常量 `GUARDIAN_PREFERRED_MODEL = "gpt-5.4"` (mod.rs:37) 只作为偏好 fallback，且有专门的回归测试 (`guardian_review_session_config_uses_parent_active_model_instead_of_hardcoded_slug`) 来保证不会硬绑模型。
- **安全策略**：`execpolicy/` crate 定义了一套基于程序名前缀的规则 DSL，`Policy::check()` 返回 `Allow / Prompt / Forbidden`；匹配不到时走启发式 fallback。沙盒层面：Linux 用 `landlock` + seccomp (`linux-sandbox/`)，macOS 走 seatbelt / sandbox-exec (`sandboxing/`)，Windows 有 `windows-sandbox-rs`。
- **Tool Result 反馈**：TUI 的 `diff_render.rs` (95KB) 负责 diff 预览高亮；审批 overlay 呈现即将执行的命令；但**没有**通用的 undo/回滚 (apply_patch 自己有 ghost snapshot 机制，和 `/undo` 挂钩)。
- **拒绝恢复路径**：guardian 或用户否决后，错误回传给模型，由模型自己决定是否降级策略或改走 `request_permissions` 重新申请。

### 11.2 CLI Permission 代码文件清单

| 文件路径 | 职责 |
|----------|------|
| `codex-rs/tui/src/cli.rs` | CLI flags / 模式别名 |
| `codex-rs/core/src/exec.rs` + `exec_policy.rs` | 执行调度与权限拼装 |
| `codex-rs/core/src/guardian/mod.rs` | Guardian session + GuardianAssessment |
| `codex-rs/core/src/guardian/review.rs` + `review_session.rs` | 审批路由 |
| `codex-rs/core/src/guardian/approval_request.rs` | 审批请求变体 |
| `codex-rs/execpolicy/src/policy.rs` + `decision.rs` | 规则匹配 |
| `codex-rs/sandboxing/` + `linux-sandbox/` + `windows-sandbox-rs/` | 多平台沙盒实现 |
| `codex-rs/shell-escalation/` | 提权/降权辅助 |
| `codex-rs/process-hardening/` | 进程级加固 |

### 11.3 CLI Permission 子系统说明

| 子系统 | 关键实现 | 备注 |
|--------|----------|------|
| 模式引擎 | `AskForApproval × SandboxMode` 二维组合 | 无 plan-mode |
| 权限分层 | 文件读写 / shell / 网络 / MCP / apply_patch 各自 ApprovalRequest | 粒度充足 |
| 审批中间件 | Guardian LLM + execpolicy + 人工确认 | 自动审批依赖第二个模型 |
| 安全策略 | landlock / seatbelt / windows-sandbox | 三平台都有 |

### 11.4 Verdict 评价

- **完整性**：模式切换、分层权限、多平台沙盒、diff 预览、Guardian 自动审核、`request_permissions` 反向申请——覆盖面是三家里最大的。
- **安全性**：默认最小权限 + 多平台沙盒 + LLM 审核是"Defense in Depth"。但 hook 子系统不参与 guardian 审核、子 agent 权限无法被父强制收紧，是两处明显的裂缝。
- **用户体验**：二维模式需要用户理解两个概念，不如 "plan/edit/auto" 式单维好解释；`--full-auto` / `--yolo` 别名补偿了这一点。
- **不足**：(1) 没有显式的 plan-mode；(2) Guardian 事实上复用父 active model，一旦父会话跑在非 OpenAI provider 上，guardian 的 "结构化 JSON 输出" 约束能否被满足是未验证的；(3) 拒绝后的自动降级没有标准路径，取决于模型自发行为；(4) hook 不过 guardian。

**评分**：⭐⭐⭐⭐⭐ (5/5)

---

## 12. API 接口处的缓存安排

- **Prompt Cache**：只实现了 Responses API 的 `prompt_cache_key` 字段 (`codex-api/src/common.rs:170`)；没有 Anthropic 式的多断点 `cache_control` 结构。
- **Cache 命中监控**：服务端透出 `x-models-etag` 与 `cached_tokens` (usage)，客户端会记录到事件里，但**没有**显式的命中率面板或告警。
- **压缩 / prompt 变更时的 cache 保护**：没有专门的 cache-aware 重建逻辑；`reference_context_item` 的重注入策略主要是为了保留语义一致性，而不是保护 cache key。
- **其他 API 层优化**：(1) zstd 请求体压缩 (对 ChatGPT auth 模式生效)；(2) 工具 schema 通过 `tool_search` 按需暴露给模型 (间接降低 token 开销)；(3) 远端 compact 把摘要成本外推；(4) WebSocket v2 beta 的 sticky turn routing。这几条加起来是不错的"非缓存类"优化，但 prompt cache 本身的利用相对保守。

---

## 13. 对不同 LLM 模型的逻辑安排

- **支持的 provider**：内建三家——OpenAI (ChatGPT / API Key)、Ollama、LM Studio (`model-provider-info/src/lib.rs:315-339`)；用户可在 `~/.codex/config.toml` 声明自定义 provider，但 `wire_api` **只允许 `Responses`**，老的 `chat` 枚举被明文 reject (L36, L64-67)。
- **Provider 抽象层**：`ModelProviderInfo` 结构 (L75-124) 是 provider 的可序列化定义，包含 `name / base_url / env_key / auth / wire_api / query_params / http_headers / env_http_headers` 以及重试、超时、WebSocket 支持开关。
- **特殊处理**：o-series 推理通过服务端 `x-reasoning-included` header 与 `reasoning_tokens` usage 字段表达；thinking block 直接透传到 `ResponseItem::Reasoning`。没有 client-side 的 "tool schema 差异化" 或 "max_tokens 按模型族调整"——这部分依赖服务端统一。
- **Fallback / Auto-switch**：**无**。模型由用户显式选择或会话初始化指定；失败就失败，不会自动降级到另一个 provider / 模型。

> 换句话说：codex 对模型异构性的态度是"统一到 Responses API wire，把差异推给服务端或 provider 配置"。好处是客户端简洁，坏处是偏离 OpenAI 生态之后需要目标 provider 兼容 Responses API (Ollama / LM Studio 通过自己的适配层完成这件事)。

---

## 14. 其他 Agent-Specific 优势、亮点与效率提升

### 14.1 架构亮点

- **HTTP / Wire / Client 三层分离** (`codex-client` / `codex-api` / `core/src/client.rs`)：极少数 CLI 能做到这种干净切分。
- **Guardian LLM**：用另一个模型做审批决策，是本项目最差异化的设计。
- **远端 compact**：把摘要计算推给服务端，避免本地再花一轮 token。
- **可对话的 sub-agent**：`send_message` + `wait_agent` + `list_agents` + BFS resume，远超一般"一次性 delegate"设计。
- **Skill 的 MCP 依赖声明**：skill 可以触发 MCP server 的自动安装，是 skill / tool / 配置三者联动的好例子。

### 14.2 性能与效率

- tokio 全异步 + 工具级并行锁 + TUI 帧率钳位 + SSE 流式 + 可选 WebSocket + zstd 请求压缩；典型的 "Rust 能做的优化都尽量做" 风格。

### 14.3 安全与沙盒

- Linux (landlock + seccomp)、macOS (seatbelt)、Windows (windows-sandbox-rs) 三平台都有真实现；execpolicy DSL + Guardian LLM + 分层审批；directory trust；apply_patch 的 ghost snapshot 支持 undo。

### 14.4 开发者体验

- `tracing` + `otel` 支持；rollout JSONL 可完整 replay；`thread-store` 让 resume/fork/archive 成为一等操作；`response-debug-context` 专门服务"LLM 响应复盘"。
- 反面：`core/src/codex.rs` 与 TUI 的 `chatwidget.rs` 都是几十万字节的单文件，阅读成本高。

### 14.5 独特功能

- ChatGPT 订阅账户登录；远端 compact；Guardian LLM；可对话式 sub-agent；skill-to-MCP 依赖拉起；apply_patch DSL；`/undo` via ghost snapshot；WebSocket v2 beta；`js_repl` 内嵌运行时；tool_search 动态工具发现。

---

## 总体评分

| 维度 | 评分 (1-5) | 一句话总结 |
|------|------------|------------|
| LLM 请求方式 | 4 | 三层分离 + 流式 + 指数退避 + jitter，但无 Retry-After 与客户端 prompt cache |
| Hooks | 4 | 五事件齐备，regex matcher 合理，但完全无沙盒 + async/prompt hook 未落地 |
| 上下文管理 | 4 | 双路压缩 (本地/远端) + ghost 保留 + 基线再注入，但缺 layer-aware 策略 |
| Tool Use | 5 | 25+ 工具 + 并行锁 + MCP 一等公民 + 动态工具发现 |
| Skill 管理 | 4 | 四 scope + progressive disclosure + MCP 依赖拉起，但无 hot reload |
| Sub-Agent | 5 | 可对话 / 深度限制 / BFS resume / 独立 rollout，工程完成度最高 |
| TUI | 4 | ratatui 120fps + scrolling-regions，但无鼠标、单文件过大 |
| To-Do List | 3 | 最小可用的三态 plan，无嵌套 / 依赖 / 独立持久化 |
| CLI Permission | 5 | 二维模式 + Guardian LLM + 三平台沙盒 + execpolicy DSL |
| API 缓存 | 3 | 只用 `prompt_cache_key`，无客户端缓存 / 无 cache breakpoint |
| 多模型支持 | 3 | 只认 Responses API，非 OpenAI 生态覆盖面窄 |
| 整体工程成熟度 | 5 | 90+ crate 的 Rust workspace，从沙盒到 TUI 到子 agent 全部自研 |

### 最终客观评价与辩证分析

**核心优势**：Codex 最突出的三块是 **Sub-Agent 体系**、**权限与沙盒**、以及**工具栈的广度**。这三者互相支撑：大量内建工具需要严肃的沙盒 + 审批，而复杂任务又需要可对话的 sub-agent 来拆分——少了任何一个另外两个都会失去意义。加上 `codex-client` / `codex-api` / `core::client` 的清晰分层与 `rollout` + `thread-store` 的完整会话持久化，整体是我看过的 agent CLI 里**工程成熟度最高**的那一档。

**明显短板**：短板集中在"开放性"与"广度"上。(1) 只允许 Responses API wire，非 OpenAI 生态 (尤其 Anthropic / Gemini) 没有一等位置；(2) 客户端层面的 prompt cache 几乎没做，对大上下文场景的 token 成本不友好；(3) Hook 没有沙盒，且 `type: prompt` / `type: agent` 承诺未兑现；(4) Guardian 虽然设计为复用父 active model，但它对"结构化 JSON + 固定 schema"的依赖，在非 OpenAI provider 上的鲁棒性是代码里没有覆盖的未知量；(5) `core/src/codex.rs` 与 `tui/src/chatwidget.rs` 两个"超大单文件"让二次开发门槛偏高；(6) To-Do List 能力最小化，和 sub-agent / 压缩链路之间缺乏联动；(7) 没有鼠标 / 无障碍 / 显式主题系统。这些短板在"只用 OpenAI + 单人开发者"的场景下几乎不影响使用，但在"跨厂商 + 团队插件生态"里会被放大。

**适用场景**：最适合 **有 ChatGPT 订阅或 OpenAI API 的开发者，在本地工作区执行需要强审批和多步子任务编排的工作**——大型 monorepo 的重构、需要跨多个子 agent 协作的修改、需要 sandbox 的远程服务器运维脚本都能很好地被覆盖。对"只想写写脚本的轻量用户"这套体系可能过度工程；对"需要接 Claude / Gemini / 本地 HuggingFace"的用户则会被 Responses API 的单一性劝退。

**发展建议**：若要整体再上一档，**首选补齐多 provider wire-API 抽象**——把 `wire_api` 从"只能是 Responses"变成一个真正的 provider-agnostic 枚举，这一条拿下之后 cache 断点、多模型 fallback、cross-vendor 工具 schema 差异、以及 Guardian 的跨 provider 鲁棒性才谈得上。其次是**给 Hook 引入 sandbox / trust 元数据**，补齐 guardian 未覆盖的这一侧攻击面。再其次是**拆解 `codex.rs` 与 `chatwidget.rs` 的超大单文件**，降低维护摩擦。

**横向对比定位**：和同期其他 CLI 相比，codex 的独特生态位是"**OpenAI 自家出品的、最接近 production-grade 工程化**的 agent CLI"。它用 Rust 换取可靠性与沙盒能力，用 90+ crate 换取职责分离，用 Guardian LLM 换取自动化审批，用可对话 sub-agent 换取复杂任务编排。代价是——它是一个几乎不打算离开 OpenAI 生态的系统。对于"想要一个随便接任何模型的轻量 agent"，它不是最合适的选择；对于"想要一个能严肃放进开发流水线、能限制 blast radius 的 agent"，它目前是同类开源实现里最有说服力的那一家。
