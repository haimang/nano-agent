# codex 深度分析

> 分析时间：2026-04-15  
> 分析对象：`/Users/feimeng/nano-agent/codex`  
> 分析者：Kimi

---

## 1. 技术栈分析

### 1.1 核心信息

| 维度 | 技术选型 |
|------|----------|
| **核心运行时** | Rust 2024 edition, Tokio async |
| **CLI 入口** | Node.js 22+ (ESM) shim → 下载并启动原生 Rust 二进制 |
| **TUI** | `ratatui` + `crossterm` |
| **HTTP / WebSocket** | `reqwest`, `tokio-tungstenite`, SSE streaming |
| **认证** | OAuth device flow, API key, ChatGPT session token (`codex-login`) |
| **持久化** | JSONL rollout 文件 + `sqlx` (SQLite) 元数据 |
| **沙盒** | macOS Seatbelt, Linux Landlock/bubblewrap, Windows restricted tokens |
| **MCP 协议** | `rmcp` crate (OpenAI 官方 Rust MCP SDK) |
| **构建** | Cargo + Bazel (内部使用) |
| **追踪/观测** | `tracing`, `opentelemetry` |

### 1.2 仓库结构（Monorepo）

```
codex/
├── codex-cli/                # 极薄的 Node shim，负责下载平台相关二进制
├── codex-rs/                 # 核心 Rust 实现（70+ crates）
│   ├── core/                 # Agent 核心：Session, Codex, Tool dispatch
│   ├── tui/                  # 终端交互 UI
│   ├── exec/                 # 非交互式 `codex exec` / `codex review`
│   ├── app-server/           # JSON-RPC 服务端
│   ├── app-server-protocol/  # 协议定义（v1 + v2）
│   ├── app-server-client/    # 客户端 facade（TUI/exec 使用）
│   ├── protocol/             # 底层共享类型
│   ├── tools/                # Tool Registry 规划/定义
│   ├── hooks/                # Hook 引擎（Claude-style hooks）
│   ├── core-skills/          # Skill 加载、缓存、渲染
│   ├── codex-mcp/            # MCP 连接管理器、认证、skill 依赖
│   ├── state/                # SQLite 元数据存储
│   └── mcp-server/           # Codex 自身作为 MCP server 的暴露
├── sdk/
│   ├── python/               # Python 客户端
│   └── typescript/           # TypeScript 客户端
└── package.json / pnpm-workspace.yaml
```

### 1.3 关键入口文件

- **Node shim**：`codex-cli/bin/codex.js` —— 解析平台依赖（如 `@openai/codex-darwin-arm64`）并 `spawn` 原生二进制。
- **Rust CLI**：`codex-rs/cli/src/main.rs`
- **核心引擎**：`codex-rs/core/src/codex.rs`
- **协议层**：`codex-rs/app-server-protocol/src/protocol/v2.rs`

---

## 2. Hooks 实现分析

### 2.1 结论：拥有完整的、受 Claude Code 启发的 Hook 系统

与 mini-agent 不同，**codex 实现了一套完整的生命周期 Hook 架构**，单独封装在 `codex-hooks` crate 中，并在 `codex-core` 的 `hook_runtime.rs` 中集成到主循环。

### 2.2 支持的事件类型

| Hook 事件 | 触发时机 | 能力 |
|-----------|----------|------|
| `SessionStart` | Session 启动时 | 注入上下文或阻止启动 |
| `UserPromptSubmit` | 用户提交 prompt 时 | 拦截、修改或注入额外上下文 |
| `PreToolUse` | 工具执行前 | **阻止**工具执行（返回 block reason） |
| `PostToolUse` | 工具执行后 | 注入额外的 developer message |
| `Stop` | Session 停止时 | 清理或记录 |

### 2.3 架构层次

```rust
// codex-rs/hooks/src/registry.rs
pub struct Hooks {
    after_agent: Vec<Hook>,           // 遗留兼容
    after_tool_use: Vec<Hook>,        // 遗留兼容
    engine: ClaudeHooksEngine,        // 主引擎
}
```

1. **发现层** (`hooks/src/engine/discovery.rs`)：扫描配置目录（如 `.codex/hooks/`），加载 `hook.toml`。
2. **引擎层** (`hooks/src/engine/mod.rs`)：`ClaudeHooksEngine` 维护一组 `ConfiguredHandler`。
3. **Registry 层** (`hooks/src/registry.rs`)：对外暴露 `run_pre_tool_use`、`run_post_tool_use` 等异步方法。

### 2.4 核心运行时代码

`core/src/hook_runtime.rs` 中，`Session` 在关键生命周期点调用 Hook Runtime：

```rust
// codex-rs/core/src/hook_runtime.rs (lines 118-146)
pub(crate) async fn run_pre_tool_use_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    tool_use_id: String,
    command: String,
) -> Option<String> {
    let request = PreToolUseRequest {
        session_id: sess.conversation_id,
        turn_id: turn_context.sub_id.clone(),
        cwd: turn_context.cwd.clone(),
        transcript_path: sess.hook_transcript_path().await,
        model: turn_context.model_info.slug.clone(),
        permission_mode: hook_permission_mode(turn_context),
        tool_name: "Bash".to_string(),
        tool_use_id,
        command,
    };
    let preview_runs = sess.hooks().preview_pre_tool_use(&request);
    emit_hook_started_events(sess, turn_context, preview_runs).await;

    let PreToolUseOutcome { hook_events, should_block, block_reason } =
        sess.hooks().run_pre_tool_use(request).await;
    emit_hook_completed_events(sess, turn_context, hook_events).await;

    if should_block { block_reason } else { None }
}
```

**关键设计**：
- `preview_*` 方法可以在真正执行前向 UI 发送 `HookStartedEvent`，提供即时反馈。
- `should_block` 为 `true` 时，工具不会执行，而是将 `block_reason` 作为错误返回给模型。
- `additional_contexts` 机制允许 Hook 在事件结束后向对话中注入 `developer` 角色的消息。

---

## 3. 上下文管理分析

### 3.1 核心抽象：`Codex` → `Session` → `TurnContext`

| 层级 | 职责 | 关键字段 |
|------|------|----------|
| **`Codex`** | 对外公开的 handle，管理事件通道 | `tx_sub`, `rx_event`, `session: Arc<Session>` |
| **`CodexThread`** | 线程级包装，提供 `steer`、`submit`、`agent_status` 等方法 | `codex: Codex`, `rollout_path` |
| **`Session`** | **所有持久状态的持有者** | `state: Mutex<SessionState>`, `services: SessionServices`, `active_turn: Mutex<Option<ActiveTurn>>` |
| **`TurnContext`** | 单次 user turn 的上下文快照 | `cwd`, `model_info`, `approval_policy`, `sandbox_policy`, `config` |

```rust
// codex-rs/core/src/codex.rs (lines 401-410)
pub struct Codex {
    pub(crate) tx_sub: Sender<Submission>,
    pub(crate) rx_event: Receiver<Event>,
    pub(crate) agent_status: watch::Receiver<AgentStatus>,
    pub(crate) session: Arc<Session>,
    pub(crate) session_loop_termination: SessionLoopTermination,
}

// lines 840-862
pub(crate) struct Session {
    pub(crate) conversation_id: ThreadId,
    tx_event: Sender<Event>,
    agent_status: watch::Sender<AgentStatus>,
    state: Mutex<SessionState>,
    features: ManagedFeatures,
    pub(crate) conversation: Arc<RealtimeConversationManager>,
    pub(crate) active_turn: Mutex<Option<ActiveTurn>>,
    pub(crate) services: SessionServices,
    // ... mailbox, idle_pending_input, js_repl 等
}
```

### 3.2 多层持久化机制

#### (1) Rollout JSONL

每次 Session 的完整事件流都会写入 `~/.codex/sessions/<date>/<id>.jsonl`，由 `core/src/rollout/` 管理：
- 原子追加事件
- 支持 Thread 列表、恢复、分叉（fork）
- 支持 **Compaction**（压缩旧历史以节省 token）

#### (2) SQLite State DB

`codex-state` crate 维护一个 SQLite 数据库，存储 rollout 的元数据（thread 名称、最后活动时间、backfill 状态）。这样 TUI 可以快速列出/恢复 thread，而无需扫描所有 JSONL 文件。

#### (3) 全局历史文件

`core/src/message_history.rs`：追加式的 `~/.codex/history.jsonl`，仅保存 `{session_id, ts, text}`，用于 TUI 的快速历史搜索。

### 3.3 Token 压缩（Compaction / Summarization）

codex 同样面临上下文窗口限制，但它采用了更精细的 **Compaction** 策略，由 `core/src/compact.rs` 实现：

```rust
// codex-rs/core/src/compact.rs
pub(crate) async fn run_inline_auto_compact_task(
    sess: Arc<Session>,
    turn_context: Arc<TurnContext>,
    initial_context_injection: InitialContextInjection,
    reason: CompactionReason,
    phase: CompactionPhase,
) -> CodexResult<()> {
    let prompt = turn_context.compact_prompt().to_string();
    let input = vec![UserInput::Text { text: prompt, text_elements: Vec::new() }];
    run_compact_task_inner(sess, turn_context, ...).await
}
```

- **Pre-turn compaction**：在用户 turn 开始前压缩，替换历史为摘要。
- **Mid-turn compaction**：在 turn 中间（如大量 tool 调用后）压缩。
- **Remote compaction**：对于 OpenAI 后端，会调用远程压缩任务。
- 压缩结果以 `ContextCompactionItem` 形式重新注入历史。

### 3.4 实时对话（Realtime Conversation）

`core/src/realtime_conversation.rs` 支持 WebRTC/WebSocket 实时音频/文本会话（GPT-4o realtime API），并与同一个 `Session` 事件循环集成。这意味着 codex 不仅支持基于文本的 ReAct 循环，也支持低延迟的语音交互。

---

## 4. Tool Use 的管理和使用

### 4.1 两层架构：`codex-tools`（规划）+ `core`（执行）

| Crate | 职责 |
|-------|------|
| `codex-tools` | 根据配置/模型/MCP 动态构建 `ToolRegistryPlan`，决定哪些工具对模型可见 |
| `codex-core` | `ToolRouter` 将 plan 转换为运行时的 `ToolRegistry`，并负责实际分发 |

### 4.2 ToolRouter 与 Registry

```rust
// codex-rs/core/src/tools/router.rs (lines 36-41)
pub struct ToolRouter {
    registry: ToolRegistry,
    specs: Vec<ConfiguredToolSpec>,
    model_visible_specs: Vec<ToolSpec>,
    parallel_mcp_server_names: HashSet<String>,
}
```

- **`registry`**：运行时 `ToolName → Arc<dyn AnyToolHandler>` 的映射。
- **`model_visible_specs`**：实际发送给 LLM 的 tool schema 列表。支持 `code_mode_only_enabled` 时过滤掉嵌套工具。
- **并行支持**：通过 `parallel_mcp_server_names` 和 `supports_parallel_tool_calls` 标记，决定哪些 MCP 工具可以并行调用。

### 4.3 Tool Handler Trait

```rust
// codex-rs/core/src/tools/registry.rs
pub trait ToolHandler: Send + Sync {
    type Output: ToolOutput + 'static;
    fn kind(&self) -> ToolKind;
    fn handle(&self, invocation: ToolInvocation) -> impl Future<Output = Result<Self::Output, FunctionCallError>> + Send;
}
```

`ToolInvocation` 封装了执行所需的全部上下文：

```rust
pub struct ToolInvocation {
    pub session: Arc<Session>,
    pub turn: Arc<TurnContext>,
    pub tracker: SharedTurnDiffTracker,
    pub call_id: String,
    pub tool_name: ToolName,
    pub payload: ToolPayload,
}
```

### 4.4 工具分发流程

1. 模型输出 `ResponseItem::FunctionCall`（或 `LocalShellCall`、`CustomToolCall`、`ToolSearchCall`）。
2. `ToolRouter::build_tool_call(session, item)` 将其解析为 `ToolCall`（含 `ToolPayload`）。
3. `ToolRouter::dispatch_tool_call_with_code_mode_result` 调用 `registry.dispatch_any(invocation)`。
4. **Pre-tool hooks** 先执行；若被 block，返回错误给模型。
5. **Post-tool hooks** 在成功后执行，可注入额外上下文。

### 4.5 并行执行

`core/src/tools/parallel.rs` 中的 `ToolCallRuntime` 支持并发执行多个独立工具调用。它通过 `Arc<RwLock<()>>` 实现并行执行的协调，并通过 `CancellationToken` 支持取消。

### 4.6 内置工具一览

| Handler | 文件 | 能力 |
|---------|------|------|
| `ShellHandler` / `UnifiedExecHandler` | `handlers/shell.rs` | 本地 shell 执行（受沙盒策略约束） |
| `ApplyPatchHandler` | `handlers/patch.rs` | 应用代码 diff |
| `McpHandler` | `handlers/mcp.rs` | 调用 MCP 工具 |
| `McpResourceHandler` | `handlers/mcp_resource.rs` | 读取 MCP resource |
| `SpawnAgentHandlerV2` | `multi_agents_v2/spawn.rs` | 生成子代理 |
| `SendMessageHandlerV2` | `multi_agents_v2/send.rs` | 向子代理发消息 |
| `WaitAgentHandlerV2` | `multi_agents_v2/wait.rs` | 等待子代理完成 |
| `ListAgentsHandlerV2` | `multi_agents_v2/list.rs` | 列出活跃子代理 |
| `CloseAgentHandlerV2` | `multi_agents_v2/close.rs` | 终止子代理 |
| `JsReplHandler` | `handlers/js_repl.rs` | JavaScript REPL |
| `PlanHandler` | `handlers/plan.rs` | Plan 工具 |
| `ToolSearchHandler` | `handlers/tool_search.rs` | 动态 MCP 工具发现 |
| `CodeModeExecuteHandler` | `code_mode/` | Code-mode 执行路径 |
| `RequestPermissionsHandler` | `handlers/permissions.rs` | 运行中请求用户权限 |

### 4.7 MCP 深度集成

`codex-mcp` crate 是 codex 的一大亮点：

- **连接管理器** (`mcp_connection_manager.rs`)：维护到多个 MCP server 的持久连接（stdio、SSE、streamable HTTP）。
- **工具暴露**：MCP 工具名称被规范化为 `mcp__{server_name}__{tool_name}` 的格式，适配 Responses API。
- **认证** (`mcp/auth.rs`)：支持 Bearer token、OAuth flow、ChatGPT-backed app MCP server。
- **Codex 自身作为 MCP server**：`codex-rs/mcp-server/` 将整个 codex runtime 暴露为一个 MCP server，供其他客户端调用。

---

## 5. Skill 的使用与管理

### 5.1 核心 crate：`codex-core-skills`

与 mini-agent 的渐进式披露思路类似，codex 也有 skill 系统，但实现更加工程化和完备。

### 5.2 Skill 结构

```rust
// codex-rs/core-skills/src/model.rs (conceptual)
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub short_description: Option<String>,
    pub interface: Option<SkillInterface>,
    pub dependencies: Option<SkillDependencies>,
    pub policy: Option<SkillPolicy>,
    pub path_to_skills_md: AbsolutePathBuf,
    pub scope: SkillScope,  // System | User | Repo | Admin
}
```

Skill 的作用域（Scope）分为四级：
- `System`：系统内置 skill
- `User`：用户级 skill（如 `~/.codex/skills/`）
- `Repo`：项目级 skill（如 `./.codex/skills/`）
- `Admin`：管理员强制部署的 skill

### 5.3 SkillsManager：双层缓存

```rust
// codex-rs/core-skills/src/manager.rs (lines 50-55)
pub struct SkillsManager {
    codex_home: AbsolutePathBuf,
    restriction_product: Option<Product>,
    cache_by_cwd: RwLock<HashMap<AbsolutePathBuf, SkillLoadOutcome>>,
    cache_by_config: RwLock<HashMap<ConfigSkillsCacheKey, SkillLoadOutcome>>,
}
```

- **`cache_by_cwd`**：按工作目录缓存，加速同目录下的重复加载。
- **`cache_by_config`**：按 effective config 缓存，避免不同 role/会话配置之间的 skill 泄露。

### 5.4 隐式调用（Implicit Invocation）

Skill 可以根据文件路径或命令被**隐式触发**，无需用户显式提及：

```rust
// codex-rs/core-skills/src/manager.rs (lines 289-299)
fn finalize_skill_outcome(
    mut outcome: SkillLoadOutcome,
    disabled_paths: HashSet<AbsolutePathBuf>,
) -> SkillLoadOutcome {
    outcome.disabled_paths = disabled_paths;
    let (by_scripts_dir, by_doc_path) =
        build_implicit_skill_path_indexes(outcome.allowed_skills_for_implicit_invocation());
    outcome.implicit_skills_by_scripts_dir = Arc::new(by_scripts_dir);
    outcome.implicit_skills_by_doc_path = Arc::new(by_doc_path);
    outcome
}
```

在 turn 开始时，codex 会检查当前上下文（如文件路径、即将执行的命令），自动注入匹配的 skill。

### 5.5 Prompt 注入方式

Skills 被渲染为结构化的 XML-like 区块注入到 system/developer instructions 中：

- `<skills_instructions>...</skills_instructions>`
- `<apps_instructions>...</apps_instructions>`
- `<plugins_instructions>...</plugins_instructions>`

`core/src/skills/render.rs` 负责将这些内容拼接到 `DeveloperInstructions` 中，最终进入模型上下文。

### 5.6 Skill 依赖的 MCP 工具

Skill 可以声明自己依赖的 MCP 工具。`core/src/mcp_skill_dependencies.rs` 会在加载 skill 时检查这些依赖，如果缺少相应的 MCP server，会提示用户安装或自动发起 elicitation。

---

## 6. 其他有意思的地方

### 6.1 多代理（Multi-Agent）系统

codex 实现了相当成熟的子代理系统，位于 `core/src/tools/handlers/multi_agents_v2/`。

#### Spawn Agent

```rust
// codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs (lines 15-17)
pub(crate) const SPAWN_AGENT_DEVELOPER_INSTRUCTIONS: &str = r#"<spawned_agent_context>
You are a newly spawned agent in a team of agents collaborating to complete a task...
</spawned_agent_context>"#;
```

子代理被创建时，会在其 system/developer instructions 中注入上述上下文，让它意识到自己是一个团队成员。

#### 历史分叉（Fork Modes）

```rust
// codex-rs/core/src/agent/control.rs (conceptual)
pub enum SpawnAgentForkMode {
    None,
    FullHistory,
    LastNTurns(u32),
}
```

- `None`：子代理几乎没有历史。
- `FullHistory`：继承完整父代理历史（但此时不允许 model/role 覆盖）。
- `LastNTurns(n)`：只继承最近 n 轮对话。

#### 深度限制

`agent_max_depth` 防止无限递归 spawn：

```rust
// spawn.rs (lines 51-57)
let child_depth = next_thread_spawn_depth(&session_source);
let max_depth = turn.config.agent_max_depth;
if exceeds_thread_spawn_depth_limit(child_depth, max_depth) {
    return Err(FunctionCallError::RespondToModel(
        "Agent depth limit reached. Solve the task yourself.".to_string(),
    ));
}
```

### 6.2 App-Server Protocol (ACP) V2
codex 的核心被设计为一个 **JSON-RPC server**，前端（TUI、VSCode 插件、Python/TS SDK）通过协议与之通信。

- **传输**：stdio（默认）、WebSocket (`ws://` / `wss://`)、in-process channels。
- **关键方法**：
  - `thread/start`, `turn/start`, `turn/steer`, `turn/interrupt`
  - `thread/list`, `thread/read`, `thread/resume`
  - `mcp/server/elicit`, `config/get`, `feedback/submit`

协议定义在 `app-server-protocol/src/protocol/v2.rs`，长度超过 8000 行，足见其完备性。

### 6.3 配置分层（Config Layering）

`core/src/config_loader.rs`（或等效模块）实现了多层配置合并：

1. 系统默认值
2. 项目 `.codex/config.toml`
3. 用户 `~/.codex/config.toml`
4. MDM 策略层
5. CLI `-c` 覆盖层

每一层都可以单独启用/禁用，最终生成 `ConfigLayerStack`。

### 6.4 沙盒与审批策略

| 维度 | 选项 |
|------|------|
| **Approval** | `Never`, `UnlessTrusted`, `OnFailure`, `OnRequest`, `Granular` |
| **Sandbox** | `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess` + 平台级外部沙盒 |

`codex-execpolicy` crate 支持 YAML-based 的策略文件，可以按 pattern allowlist/blocklist 命令。

### 6.5 Code Mode

`core/src/tools/code_mode/` 实现了一个特殊的执行路径：在 code mode 下，模型直接输出代码块（而非 function call），这些代码会被立即执行（JS/TS/Python）。这绕过了常规的 `ToolRouter` 分发，适用于高频、低延迟的代码执行场景。

### 6.6 OpenTelemetry 追踪传播

codex 在子代理 spawn 时会传递 W3C Trace Context：

```rust
// codex-rs/core/src/codex.rs
use codex_otel::current_span_w3c_trace_context;
use codex_otel::set_parent_from_w3c_trace_context;
```

这使得多代理调用链在观测平台上可以串联成一条完整的 trace。

### 6.7 实时音频与文本的混合会话

`realtime_conversation.rs` 不仅让 codex 支持语音对话，还能将实时音频流与文本-based 的 ReAct 循环共享同一个 `Session` 状态。这意味着用户可以先语音下达指令，Agent 随后用文本+工具调用完成任务，状态完全连贯。

---

## 总结

如果说 **mini-agent 是一个极简、清晰的概念验证**，那么 **codex 就是一个面向生产、规模庞大的工业级 Agent 平台**。它的架构选择体现了 OpenAI 对"Agent 基础设施"的系统性思考：

1. **全生命周期 Hook 系统**：从 prompt 提交到工具执行，每个环节都可被外部逻辑拦截、审计、增强。
2. **三层上下文持久化**：JSONL rollout（完整审计）+ SQLite state（快速检索）+ Global history（快捷搜索），兼顾可追溯性与性能。
3. ** compaction 策略**：pre-turn / mid-turn / remote 多种压缩模式，精细控制上下文窗口。
4. **Tool 架构的高度模块化**：规划层与执行层分离、并行执行、MCP 原生集成、Code Mode 特殊路径。
5. **Skill 的隐式调用与作用域分层**：System/User/Repo/Admin 四级作用域 + 隐式触发 + MCP 依赖检查。
6. **原生多代理**：支持历史分叉、深度限制、跨代理消息传递，且追踪上下文可传递。
7. **协议优先设计**：ACP V2 让 codex 不仅仅是一个 CLI，而是一个可以被任何前端嵌入的后端运行时。
