# Codex Hooks 深度对标审查：nano-agent Hooks 系统 gap 分析

> **审查视角**: 从 `context/codex` 的 hooks 功能出发，对标 nano-agent 现有 Hooks 实现  
> **审查对象**: `workers/agent-core/src/hooks/*` + `packages/nacp-core/src/hooks-catalog/*` + `workers/agent-core/src/host/*`  
> **日期**: 2026-05-02  
> **作者**: kimi-for-coding/k2p6  

---

## 0. 执行摘要

经过对 `context/codex/codex-rs/hooks/src/` 完整源码（registry、engine、events、schema、types 五层）与 nano-agent `workers/agent-core/src/hooks/`（dispatcher、registry、catalog、outcome、runtimes、permission、audit、matcher、guards）的深度比对，得出以下结论：

| 维度 | Codex | nano-agent | 判定 |
|------|-------|-----------|------|
| Hook 事件数量 | 5 (PreToolUse/PostToolUse/SessionStart/UserPromptSubmit/Stop) | 18 (含 Class A/B/D) | nano-agent 更丰富 |
| 客户端可见性 | **HookStartedEvent/HookCompletedEvent 通过 EventMsg 实时推送** | **无客户端可见 hook 事件流** | nano-agent 存在重大断点 |
| Hook 输出结构化 | HookOutputEntry { kind, text } × 5 种 kind | 仅 action + additionalContext + diagnostics | nano-agent 语义贫乏 |
| Preview 机制 | 有（先推 preview runs，再执行） | **无** | nano-agent 缺失 |
| 执行运行时 | CommandShell（外部命令）+ 内置 | 仅 LocalTsRuntime（进程内函数） | nano-agent 运行时单一 |
| Matcher 能力 | Regex（含 alternation、star） | exact / wildcard / toolName | nano-agent 匹配能力弱 |
| 与 Permission 集成 | PreToolUse 直接产 permissionDecision | PermissionRequest 是独立 hook 事件 | 架构不同 |
| TUI 渲染语义 | 完整的 quiet-success / reveal-delay / linger 策略 | **无** | nano-agent 无前端消费面 |

**核心结论**: nano-agent 的 Hooks 系统在**服务端事件覆盖度**上超越 Codex（18 vs 5），但在**客户端可见性**、**结构化输出**、**preview 机制**、**执行运行时多样性**四个维度存在**结构性断点**。这些断点导致 agent loop 中 hook 的执行过程对用户完全不可见，也无法支持 Codex 风格的 "hook 执行可视化" 工作流。

---

## 1. Codex Hooks 系统架构（context/codex 源码级拆解）

### 1.1 事件层（Event Layer）

Codex 定义了 5 个核心 hook 事件，全部在 `codex-rs/hooks/src/events/` 下实现：

```rust
// context/codex/codex-rs/hooks/src/events/pre_tool_use.rs:21-31
pub struct PreToolUseRequest {
    pub session_id: ThreadId,
    pub turn_id: String,
    pub cwd: AbsolutePathBuf,
    pub transcript_path: Option<PathBuf>,
    pub model: String,
    pub permission_mode: String,
    pub tool_name: String,
    pub tool_use_id: String,
    pub command: String,
}

pub struct PreToolUseOutcome {
    pub hook_events: Vec<HookCompletedEvent>,
    pub should_block: bool,
    pub block_reason: Option<String>,
}
```

每个事件都有：
- **preview()** — 根据 matcher 筛选出将要执行的 handlers，返回 `Vec<HookRunSummary>`
- **run()** — 实际执行 handlers，返回 `Vec<HookCompletedEvent>` + 业务 outcome

### 1.2 协议层（Protocol Layer）

Codex 通过 `codex_protocol::protocol` 定义了完整的 hook 协议形状：

```rust
// context/codex/codex-rs/protocol/src/protocol.rs:1604-1694
pub enum HookEventName { PreToolUse, PostToolUse, SessionStart, UserPromptSubmit, Stop }

pub enum HookRunStatus { Running, Completed, Failed, Blocked, Stopped }

pub enum HookOutputEntryKind { Warning, Stop, Feedback, Context, Error }

pub struct HookOutputEntry {
    pub kind: HookOutputEntryKind,
    pub text: String,
}

pub struct HookRunSummary {
    pub id: String,
    pub event_name: HookEventName,
    pub handler_type: HookHandlerType,      // Command / Prompt / Agent
    pub execution_mode: HookExecutionMode,  // Sync / Async
    pub scope: HookScope,                   // Thread / Turn
    pub source_path: AbsolutePathBuf,
    pub display_order: i64,
    pub status: HookRunStatus,
    pub status_message: Option<String>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub duration_ms: Option<i64>,
    pub entries: Vec<HookOutputEntry>,
}

pub struct HookStartedEvent { pub turn_id: Option<String>, pub run: HookRunSummary }
pub struct HookCompletedEvent { pub turn_id: Option<String>, pub run: HookRunSummary }
```

**关键设计**: `HookRunSummary` 是一个**完整的状态机快照**，客户端可以据此渲染 hook 执行的完整生命周期（Running → Completed/Failed/Blocked/Stopped）。

### 1.3 引擎层（Engine Layer）

```rust
// context/codex/codex-rs/hooks/src/engine/mod.rs:61-66
pub(crate) struct ClaudeHooksEngine {
    handlers: Vec<ConfiguredHandler>,
    warnings: Vec<String>,
    shell: CommandShell,
}

// context/codex/codex-rs/hooks/src/engine/dispatcher.rs:63-83
pub(crate) async fn execute_handlers<T>(
    shell: &CommandShell,
    handlers: Vec<ConfiguredHandler>,
    input_json: String,
    cwd: &Path,
    turn_id: Option<String>,
    parse: fn(&ConfiguredHandler, CommandRunResult, Option<String>) -> ParsedHandler<T>,
) -> Vec<ParsedHandler<T>> {
    let results = join_all(
        handlers.iter().map(|handler| run_command(shell, handler, &input_json, cwd)),
    ).await;
    // ...
}
```

**关键设计**:
- `execute_handlers` 使用 `join_all` **并行执行**所有 matched handlers（对于非阻塞事件）
- 每个 handler 是一个**外部命令**（CommandShell），通过 stdin/stdout 交互
- 支持 `matcher` regex 匹配（含 `*` star matcher、`^Bash$` 精确匹配、`Edit\|Write` alternation）

### 1.4 客户端渲染层（TUI Layer）

```rust
// context/codex/codex-rs/tui/src/history_cell/hook_cell.rs:29-90
pub(crate) struct HookCell {
    runs: Vec<HookRunCell>,
    animations_enabled: bool,
}

enum HookRunState {
    PendingReveal { start_time, reveal_deadline },      // 新启动，隐藏 300ms
    VisibleRunning { start_time, visible_since },       // 可见运行中
    QuietLinger { start_time, removal_deadline },       // 成功但无输出，短暂停留
    Completed { status, entries },                      // 完成，持久化
}
```

**关键设计**:
- `HOOK_RUN_REVEAL_DELAY = 300ms` — 避免瞬时 hook 闪烁
- `QUIET_HOOK_MIN_VISIBLE = 600ms` — 成功但无输出的 hook 短暂可见后消失
- 只有 **Failed / Blocked / Stopped / 有 entries 的 Completed** 才会成为持久历史记录

### 1.5 与 Agent Loop 的集成点

```rust
// context/codex/codex-rs/core/src/hook_runtime.rs:89-116
pub(crate) async fn run_pre_tool_use_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    tool_use_id: String,
    command: String,
) -> Option<String> {
    let request = PreToolUseRequest { /* ... */ };
    let preview_runs = sess.hooks().preview_pre_tool_use(&request);
    emit_hook_started_events(sess, turn_context, preview_runs).await;  // ← 先推 preview

    let PreToolUseOutcome { hook_events, should_block, block_reason } = 
        sess.hooks().run_pre_tool_use(request).await;
    emit_hook_completed_events(sess, turn_context, hook_events).await; // ← 再推 completed

    if should_block { block_reason } else { None }
}
```

**关键设计**: 
- `preview` → `emit_hook_started_events` → `run` → `emit_hook_completed_events` 形成**完整的客户端可见生命周期**
- 通过 `EventMsg::HookStarted` / `EventMsg::HookCompleted` 进入 session 事件流

---

## 2. nano-agent Hooks 系统现状（代码级拆解）

### 2.1 事件目录（18 事件）

```typescript
// packages/nacp-core/src/hooks-catalog/index.ts:3-22
export const HOOK_EVENT_NAMES = [
  "SessionStart", "SessionEnd", "UserPromptSubmit",
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "PreCompact", "PostCompact",
  "Setup", "Stop", "PermissionRequest", "PermissionDenied",
  "ContextPressure", "ContextCompactArmed", "ContextCompactPrepareStarted",
  "ContextCompactCommitted", "ContextCompactFailed", "EvalSinkOverflow",
] as const;
```

nano-agent 的 18 个事件分为三类：
- **Class A (8)**: 基础生命周期（SessionStart/End, UserPromptSubmit, Pre/PostToolUse, PostToolUseFailure, Pre/PostCompact）
- **Class B (4)**: 运行时控制（Setup, Stop, PermissionRequest, PermissionDenied）
- **Class D (6)**: 异步压缩生命周期（ContextPressure, ContextCompactArmed, ContextCompactPrepareStarted, ContextCompactCommitted, ContextCompactFailed, EvalSinkOverflow）

### 2.2 Dispatcher 架构

```typescript
// workers/agent-core/src/hooks/dispatcher.ts:45-149
export class HookDispatcher {
  constructor(
    private registry: HookRegistry,
    private runtimes: Map<HookRuntimeKind, HookRuntime>,
    private options?: { defaultTimeoutMs?: number; maxDepth?: number },
  ) {}

  async emit(
    eventName: HookEventName,
    payload: unknown,
    context?: HookEmitContext,
  ): Promise<AggregatedHookOutcome> {
    const handlers = this.registry.lookup(eventName);
    const matched = handlers.filter((h) => matchEvent(h.matcher, eventName, context));
    
    // blocking 事件串行执行，非阻塞事件并行执行
    if (blocking) {
      for (const handler of matched) {
        const outcome = await executeOne(handler);
        if (outcome.action === "block" || outcome.action === "stop") break;
      }
    } else {
      outcomes = await Promise.all(matched.map(executeOne));
    }
    return aggregateOutcomes(outcomes, eventName);
  }
}
```

**关键差异**: 
- Codex 的 dispatcher 按 event 类型分发到专门的 `run_*` 函数（`run_pre_tool_use`, `run_post_tool_use` 等），每个函数有**定制化的输入/输出 schema 和解析逻辑**
- nano-agent 的 dispatcher 是**通用型**，所有事件走同一个 `emit()` 入口，通过 `payload` 和 `context` 传递参数，**无 per-event 的定制化输入验证和输出解析**

### 2.3 Outcome 模型

```typescript
// workers/agent-core/src/hooks/outcome.ts:23-45
export interface HookOutcome {
  readonly action: HookOutcomeAction;          // "continue" | "block" | "stop"
  readonly updatedInput?: unknown;
  readonly additionalContext?: string;
  readonly diagnostics?: Record<string, unknown>;
  readonly handlerId: string;
  readonly durationMs: number;
}

export interface AggregatedHookOutcome {
  readonly finalAction: HookOutcomeAction;
  readonly outcomes: readonly HookOutcome[];
  readonly blocked: boolean;
  readonly blockReason?: string;
  readonly updatedInput?: unknown;
  readonly mergedContext?: string;
  readonly mergedDiagnostics?: Record<string, unknown>;
}
```

**关键差异**:
- Codex 的 outcome 是** per-handler 的 HookRunSummary**，包含丰富的 `entries: Vec<HookOutputEntry>`
- nano-agent 的 outcome 是**聚合后的 action**，只有 `additionalContext`（纯文本）和 `diagnostics`（键值对）
- **Codex 支持 per-handler 的 Warning/Stop/Feedback/Context/Error 输出；nano-agent 不支持**

### 2.4 Registry 与 Matcher

```typescript
// workers/agent-core/src/hooks/registry.ts:12-16,41-54
const SOURCE_PRIORITY: Record<HookSource, number> = {
  "platform-policy": 0,
  session: 1,
  skill: 2,
};

lookup(eventName: HookEventName): HookHandlerConfig[] {
  const matches: HookHandlerConfig[] = [];
  for (const handler of this.handlers.values()) {
    if (handler.event === eventName) matches.push(handler);
  }
  return matches.sort((a, b) => {
    const pA = SOURCE_PRIORITY[a.source];
    const pB = SOURCE_PRIORITY[b.source];
    if (pA !== pB) return pA - pB;
    return (this.insertionOrder.get(a.id) ?? 0) - (this.insertionOrder.get(b.id) ?? 0);
  });
}
```

```typescript
// workers/agent-core/src/hooks/matcher.ts:22-43
export function matchEvent(
  config: HookMatcherConfig | undefined,
  eventName: string,
  context?: { toolName?: string },
): boolean {
  if (config === undefined) return true;
  switch (config.type) {
    case "exact": return config.value === eventName;
    case "wildcard": return config.value === "*";
    case "toolName": return context?.toolName === config.value;
    default: return false;
  }
}
```

**关键差异**:
- Codex 的 matcher 是**regex**（支持 `^Bash$`、`*`、`Edit\|Write`）
- nano-agent 的 matcher 只有**精确匹配、wildcard、toolName**三种，**不支持 regex**
- nano-agent 有**source priority**（platform-policy > session > skill），Codex 没有这个概念

### 2.5 Runtime 层

```typescript
// workers/agent-core/src/hooks/runtimes/local-ts.ts:29-51
export class LocalTsRuntime implements HookRuntime {
  private handlers: Map<string, LocalHookHandler> = new Map();

  registerHandler(handlerId: string, fn: LocalHookHandler): void {
    this.handlers.set(handlerId, fn);
  }

  async execute(handler: HookHandlerConfig, payload: unknown, context: unknown): Promise<HookOutcome> {
    const fn = this.handlers.get(handler.id);
    if (!fn) throw new Error(`LocalTsRuntime: no handler function registered for id "${handler.id}"`);
    return fn(payload, context);
  }
}
```

**关键差异**:
- Codex 支持**CommandShell**（外部命令执行），这是其 hooks 的核心运行时
- nano-agent 目前**只有 LocalTsRuntime**（进程内 TypeScript 函数）
- Codex 的 `service-binding` runtime 在 nano-agent 的 `types.ts` 中定义了，但**未找到实际实现**

### 2.6 与 Agent Loop 的集成点

```typescript
// workers/agent-core/src/host/orchestration.ts:236-253
async startTurn(state: OrchestrationState, input: TurnInput): Promise<OrchestrationState> {
  const sessionUuid = this.realSessionUuid();
  if (state.actorState.phase === "unattached") {
    await this.deps.emitHook("Setup", { sessionUuid, turnId: input.turnId });
  }
  if (state.turnCount === 0) {
    await this.deps.emitHook("SessionStart", { sessionUuid, turnId: input.turnId, content: input.content });
  }
  await this.deps.emitHook("UserPromptSubmit", { turnId: input.turnId, content: input.content });
  // ...
}
```

```typescript
// workers/agent-core/src/host/runtime-mainline.ts:538-553
const permission = await authorizeToolPlan(options, requestId, toolName, normalizedToolInput);
if (!permission.allowed) {
  options.onToolEvent?.({
    kind: "tool_call_result",
    tool_call_id: requestId,
    tool_name: toolName,
    status: "error",
    error: permission.error,
  });
  yield { type: "result" as const, status: "error" as const, result: permission.error };
  return;
}
```

```typescript
// workers/agent-core/src/host/runtime-mainline.ts:229-256
async function authorizeToolPlan(
  options: MainlineKernelOptions,
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ allowed: true } | { allowed: false; error: { code: string; message: string; source?: string } }> {
  const ctx = options.contextProvider();
  if (!ctx || !options.authorizeToolUse) return { allowed: true };
  const result = await options.authorizeToolUse(
    { session_uuid: ctx.sessionUuid, team_uuid: ctx.teamUuid, tool_name: toolName, tool_input: toolInput },
    { trace_uuid: ctx.traceUuid, team_uuid: ctx.teamUuid },
  );
  if (result.decision === "allow") return { allowed: true };
  // ...
}
```

**关键发现**:
- `orchestration.ts` 在 `Setup`、`SessionStart`、`UserPromptSubmit` 三个点调用了 `emitHook`
- **但 `PreToolUse` 和 `PostToolUse` 并未在 orchestration.ts 中直接调用**
- 工具权限决策走 `authorizeToolPlan()`，这是一个**独立的 service-binding RPC**（`options.authorizeToolUse`），**不是通过 HookDispatcher 的 `PermissionRequest` 事件**
- `runtime-assembly.ts:354` 中的 `emitHook` 实现通过 `subsystems.hooks?.emit` 调用，但**只记录 audit，不向客户端发送任何事件**

---

## 3. 逐项比对与 Gap 定位

### Gap-1: 客户端 Hook 事件流完全缺失（最严重断点）

**Codex 实现**:

```rust
// context/codex/codex-rs/core/src/hook_runtime.rs:302-328
async fn emit_hook_started_events(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    preview_runs: Vec<HookRunSummary>,
) {
    for run in preview_runs {
        sess.send_event(
            turn_context,
            EventMsg::HookStarted(HookStartedEvent {
                turn_id: Some(turn_context.sub_id.clone()),
                run,
            }),
        ).await;
    }
}

async fn emit_hook_completed_events(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    completed_events: Vec<HookCompletedEvent>,
) {
    for completed in completed_events {
        sess.send_event(turn_context, EventMsg::HookCompleted(completed)).await;
    }
}
```

**nano-agent 现状**:

```typescript
// workers/agent-core/src/host/do/session-do/runtime-assembly.ts:354-431
emitHook: async (event, payload, context) => {
  const hooks = subsystems.hooks as { emit?: (e: string, p: unknown, c?: unknown) => Promise<unknown> } | undefined;
  if (hooks?.emit) {
    const result = await hooks.emit(event, payload, merged);
    // ... 只记录 audit，不向客户端发送任何事件 ...
    return result;
  }
  return undefined;
}
```

**问题定位**:
- `runtime-assembly.ts:354-431` 的 `emitHook` 实现**没有任何向客户端推送 hook 事件的代码**
- `orchestration.ts:69-73` 的 `emitHook` 接口返回 `Promise<unknown>`，**不返回 HookRunSummary 或任何可渲染的结构**
- `packages/nacp-session/src/stream-event.ts:75-80` 虽然定义了 `HookBroadcastKind`，但仅作为 `stream-event.ts:151` 的 13-kind union 之一，**无实际 emitter 调用**

**业务影响**:
- 前端无法知道 PreToolUse hook 是否正在执行
- 前端无法显示 hook 的 block/stop/additionalContext 输出
- 前端无法渲染 Codex 风格的 "hook 执行历史" 面板
- **整个 Hooks 系统对用户完全不可见**，退化为纯服务端内部机制

---

### Gap-2: Hook 输出语义贫乏（无结构化 entries）

**Codex 实现**:

```rust
// context/codex/codex-rs/protocol/src/protocol.rs:1656-1659
pub struct HookOutputEntry {
    pub kind: HookOutputEntryKind,  // Warning | Stop | Feedback | Context | Error
    pub text: String,
}
```

```rust
// context/codex/codex-rs/hooks/src/events/pre_tool_use.rs:162-175
if let Some(reason) = parsed.block_reason {
    status = HookRunStatus::Blocked;
    should_block = true;
    block_reason = Some(reason.clone());
    entries.push(HookOutputEntry {
        kind: HookOutputEntryKind::Feedback,
        text: reason,
    });
}
```

**nano-agent 现状**:

```typescript
// workers/agent-core/src/hooks/outcome.ts:27-34
export interface HookOutcome {
  readonly action: HookOutcomeAction;          // "continue" | "block" | "stop"
  readonly updatedInput?: unknown;
  readonly additionalContext?: string;          // ← 只有纯文本
  readonly diagnostics?: Record<string, unknown>;
  readonly handlerId: string;
  readonly durationMs: number;
}
```

**问题定位**:
- `workers/agent-core/src/hooks/outcome.ts:27-34` — `additionalContext` 是**纯文本字符串**，无法区分 Warning/Stop/Feedback/Context/Error
- `workers/agent-core/src/hooks/core-mapping.ts:60-67` — `HookOutcomeBody` 只有 `ok / block / stop / updated_input / additional_context / diagnostics`，**无 entries 数组**
- `packages/nacp-core/src/messages/hook.ts:4-22` — `HookEmitBodySchema` / `HookOutcomeBodySchema` 也**无 entries 概念**

**业务影响**:
- 即使未来补上了客户端事件流，前端也只能收到 "block: reason string"，无法渲染 Codex 风格的彩色条目（Warning 黄色、Error 红色、Feedback 蓝色等）
- `additionalContext` 的语义是 "给 LLM 看的额外上下文"，不是 "给用户看的结构化输出"，两者混淆

---

### Gap-3: 无 Preview 机制

**Codex 实现**:

```rust
// context/codex/codex-rs/hooks/src/registry.rs:92-104
pub fn preview_pre_tool_use(&self, request: &PreToolUseRequest) -> Vec<HookRunSummary> {
    self.engine.preview_pre_tool_use(request)
}

pub async fn run_pre_tool_use(&self, request: PreToolUseRequest) -> PreToolUseOutcome {
    self.engine.run_pre_tool_use(request).await
}
```

```rust
// context/codex/codex-rs/core/src/hook_runtime.rs:135-143
let preview_runs = sess.hooks().preview_pre_tool_use(&request);
emit_hook_started_events(sess, turn_context, preview_runs).await;  // ← preview 先推

let PreToolUseOutcome { hook_events, should_block, block_reason } = 
    sess.hooks().run_pre_tool_use(request).await;
emit_hook_completed_events(sess, turn_context, hook_events).await; // ← 执行后推 completed
```

**nano-agent 现状**:

```typescript
// workers/agent-core/src/hooks/dispatcher.ts:61-148
async emit(eventName: HookEventName, payload: unknown, context?: HookEmitContext): Promise<AggregatedHookOutcome> {
  const handlers = this.registry.lookup(eventName);
  const matched = handlers.filter((h) => matchEvent(h.matcher, eventName, context));
  // 直接执行，无 preview 阶段
  // ...
}
```

**问题定位**:
- `workers/agent-core/src/hooks/dispatcher.ts:61-148` — `emit()` 直接执行 handlers，**无 preview 筛选阶段**
- `workers/agent-core/src/hooks/registry.ts:41-54` — `lookup()` 只返回 handlers，**不生成 preview summary**
- 整个 nano-agent 代码库中**无 `preview` 函数或方法**

**业务影响**:
- 前端无法在 hook 执行前显示 "即将执行 X 个 handlers" 的预览
- 无法显示 handler 的 id / type / timeout 等元信息
- 用户体验从 "我知道将要发生什么" 退化为 "黑盒执行"

---

### Gap-4: 运行时单一（无 CommandShell 等价物）

**Codex 实现**:

```rust
// context/codex/codex-rs/hooks/src/engine/mod.rs:23-27
pub(crate) struct CommandShell {
    pub program: String,
    pub args: Vec<String>,
}

// context/codex/codex-rs/hooks/src/engine/command_runner.rs
pub(crate) async fn run_command(
    shell: &CommandShell,
    handler: &ConfiguredHandler,
    input_json: &str,
    cwd: &Path,
) -> CommandRunResult {
    // 实际 fork 进程执行 handler.command，通过 stdin 传 input_json，从 stdout/stderr 读输出
}
```

**nano-agent 现状**:

```typescript
// workers/agent-core/src/hooks/types.ts:14-16
export type HookRuntimeKind = "local-ts" | "service-binding";

// workers/agent-core/src/hooks/runtimes/local-ts.ts:29-51
export class LocalTsRuntime implements HookRuntime {
  // 只有进程内函数注册
}
```

**问题定位**:
- `workers/agent-core/src/hooks/runtimes/` 目录下**只有 `local-ts.ts`**，无 `command-shell.ts` 或类似实现
- `workers/agent-core/src/hooks/types.ts:15` 定义了 `"service-binding"` runtime kind，但**未找到对应实现文件**
- `runtime-assembly.ts:155-160` 的 `createSessionHookDispatcher()` 只注册了 `LocalTsRuntime`

**业务影响**:
- 用户无法通过配置文件（如 Codex 的 `hooks.json`）自定义 hook 行为
- 所有 hook 必须是预先编译进 worker bundle 的 TypeScript 函数
- 丧失了 Codex "用户可扩展 hook" 的核心能力

---

### Gap-5: Matcher 不支持 Regex

**Codex 实现**:

```rust
// context/codex/codex-rs/hooks/src/engine/dispatcher.rs:25-43
pub(crate) fn select_handlers(
    handlers: &[ConfiguredHandler],
    event_name: HookEventName,
    matcher_input: Option<&str>,
) -> Vec<ConfiguredHandler> {
    handlers.iter()
        .filter(|handler| handler.event_name == event_name)
        .filter(|handler| match event_name {
            HookEventName::PreToolUse | HookEventName::PostToolUse | HookEventName::SessionStart => {
                matches_matcher(handler.matcher.as_deref(), matcher_input)
            }
            HookEventName::UserPromptSubmit | HookEventName::Stop => true,
        })
        .cloned()
        .collect()
}
```

```rust
// context/codex/codex-rs/hooks/src/events/common.rs
pub(crate) fn matches_matcher(matcher: Option<&str>, input: Option<&str>) -> bool {
    // 支持 regex、* star matcher、字面量
}
```

**nano-agent 现状**:

```typescript
// workers/agent-core/src/hooks/matcher.ts:22-43
export function matchEvent(
  config: HookMatcherConfig | undefined,
  eventName: string,
  context?: { toolName?: string },
): boolean {
  if (config === undefined) return true;
  switch (config.type) {
    case "exact": return config.value === eventName;
    case "wildcard": return config.value === "*";
    case "toolName": return context?.toolName === config.value;
    default: return false;
  }
}
```

**问题定位**:
- `workers/agent-core/src/hooks/matcher.ts:22-43` — 仅支持 exact/wildcard/toolName，**无 regex 支持**
- 无法表达 `"Bash.*"` 或 `"Read|Write"` 这类 pattern
- `permission-rules-plane.ts:19` 的 `pattern` 字段在 DB 层有存储，但 matcher 层未使用

**业务影响**:
- 无法按 tool name pattern 批量配置 hook
- 每个 tool 必须单独注册 handler，管理成本高

---

### Gap-6: Permission 决策架构不一致

**Codex 实现**:

Codex 的 PreToolUse hook 直接产出 permission decision：

```rust
// context/codex/codex-rs/hooks/src/schema.rs:139-147
pub(crate) enum PreToolUsePermissionDecisionWire {
    #[serde(rename = "allow")] Allow,
    #[serde(rename = "deny")] Deny,
    #[serde(rename = "ask")] Ask,
}
```

```rust
// context/codex/codex-rs/hooks/src/events/pre_tool_use.rs:261-279
fn permission_decision_deny_blocks_processing() {
    // PreToolUse hook 的 stdout 可返回 {"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"..."}}
    // 这会直接阻塞 tool 执行
}
```

**nano-agent 现状**:

```typescript
// workers/agent-core/src/hooks/permission.ts:31-58
export type PermissionVerdict = "allow" | "deny";

export function verdictOf(outcome: AggregatedHookOutcome, eventName?: HookEventName): PermissionVerdict {
  if (outcome.outcomes.length === 0) return "deny";
  if (outcome.finalAction === "continue") return "allow";
  return "deny";
}
```

```typescript
// workers/agent-core/src/host/runtime-mainline.ts:229-256
async function authorizeToolPlan(
  options: MainlineKernelOptions,
  requestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ allowed: true } | { allowed: false; error: {...} }> {
  const ctx = options.contextProvider();
  if (!ctx || !options.authorizeToolUse) return { allowed: true };
  const result = await options.authorizeToolUse(
    { session_uuid: ctx.sessionUuid, team_uuid: ctx.teamUuid, tool_name: toolName, tool_input: toolInput },
    { trace_uuid: ctx.traceUuid, team_uuid: ctx.teamUuid },
  );
  // ...
}
```

**问题定位**:
- `workers/agent-core/src/hooks/permission.ts` 存在，但**未在 `runtime-mainline.ts` 中被调用**
- `runtime-mainline.ts:538` 的 `authorizeToolPlan()` 调用的是 `options.authorizeToolUse`，这是一个**外部注入的函数**（来自 `runtime-assembly.ts` 的 `subsystems.authorization`），**不是 HookDispatcher**
- `runtime-assembly.ts:155-160` 创建 HookDispatcher，但**未将 PermissionRequest handler 注册进去**
- `orchestrator-core/src/entrypoint.ts:350-370` 的 `authorizeToolUse` 实现直接查询 D1 permission rules，**不走 hook 系统**

**业务影响**:
- `PermissionRequest` hook 事件在 catalog 中存在（`catalog.ts:160-165`），但**实际永不被触发**
- 权限决策与 hook 系统**解耦**，无法通过 hook 拦截和修改权限决策
- 失去了 "hook 可以动态改变 permission policy" 的能力

---

### Gap-7: 无 Hook 审计持久化到 D1

**Codex 实现**:

Codex 的 hook events 通过 `EventMsg` 进入 session 事件流，**天然持久化**在 transcript 中。

**nano-agent 现状**:

```typescript
// workers/agent-core/src/host/do/session-do/runtime-assembly.ts:369-427
const outcome = parseHookOutcomeBody(result, { handlerId: `session.${event}`, durationMs: Date.now() - startedAt });
if (outcome.action !== "continue") {
  const body = buildHookAuditRecord(event as HookEventName, { ... }, Date.now() - startedAt, { ... });
  await recordAuditEvent({ ... }, async (record) => {
    await persistAudit.call(orch, record);
  });
}
```

**问题定位**:
- `runtime-assembly.ts:369-427` 只在 `outcome.action !== "continue"` 时记录 audit
- **成功的 hook（action === "continue"）完全不记录**
- audit 记录通过 `ORCHESTRATOR_CORE.recordAuditEvent` service binding 发送，**不是 D1 直接写入**
- 无 `nano_hook_audit_log` 或类似 D1 表

**业务影响**:
- 无法查询历史 hook 执行记录
- 无法调试 "为什么这个 hook 没触发"
- 无法做 hook 执行统计

---

### Gap-8: PostToolUse / PostToolUseFailure 未在 Agent Loop 中触发

**Codex 实现**:

```rust
// context/codex/codex-rs/core/src/hook_runtime.rs:148-173
pub(crate) async fn run_post_tool_use_hooks(
    sess: &Arc<Session>,
    turn_context: &Arc<TurnContext>,
    tool_use_id: String,
    command: String,
    tool_response: Value,
) -> PostToolUseOutcome {
    let request = PostToolUseRequest { tool_response, /* ... */ };
    let preview_runs = sess.hooks().preview_post_tool_use(&request);
    emit_hook_started_events(sess, turn_context, preview_runs).await;
    let outcome = sess.hooks().run_post_tool_use(request).await;
    emit_hook_completed_events(sess, turn_context, outcome.hook_events.clone()).await;
    outcome
}
```

**nano-agent 现状**:

搜索 `PostToolUse` 在 `workers/agent-core/src/` 的调用点：

```bash
$ grep -r "PostToolUse" workers/agent-core/src/
workers/agent-core/src/hooks/catalog.ts:98       // PostToolUse 定义
workers/agent-core/src/hooks/catalog.ts:106      // PostToolUseFailure 定义
workers/agent-core/src/hooks/catalog.ts:180      // ASYNC_COMPACT_HOOK_EVENTS
packages/nacp-core/src/hooks-catalog/index.ts:9  // HOOK_EVENT_NAMES 包含 PostToolUse
```

**问题定位**:
- `workers/agent-core/src/host/runtime-mainline.ts` — 无 `PostToolUse` 调用
- `workers/agent-core/src/host/orchestration.ts` — 无 `PostToolUse` 调用
- `workers/agent-core/src/kernel/*` — 无 `PostToolUse` 调用
- **PostToolUse 和 PostToolUseFailure 虽然在 catalog 中定义，但 nowhere 被触发**

**业务影响**:
- 工具执行后的清理、审计、additional context 注入完全缺失
- 无法实现 Codex 风格的 "post-tool-use hook 注入上下文到下一 turn"

---

### Gap-9: ContextCompact 生命周期 Hooks 与实际压缩流程脱节

**nano-agent 现状**:

Class D 的 6 个 async-compact 生命周期事件：

```typescript
// workers/agent-core/src/hooks/catalog.ts:252-258
export const ASYNC_COMPACT_HOOK_EVENTS: readonly HookEventName[] = [
  "ContextPressure",
  "ContextCompactArmed",
  "ContextCompactPrepareStarted",
  "ContextCompactCommitted",
  "ContextCompactFailed",
] as const;
```

搜索这些事件在 `workers/agent-core/src/` 的调用点：

```bash
$ grep -r "ContextPressure\|ContextCompactArmed\|ContextCompactPrepareStarted\|ContextCompactCommitted\|ContextCompactFailed" workers/agent-core/src/
workers/agent-core/src/hooks/catalog.ts:184-221  // 定义
packages/nacp-core/src/hooks-catalog/index.ts:13-20  // HOOK_EVENT_NAMES 包含
```

**问题定位**:
- `workers/agent-core/src/host/compact-breaker.ts` — 只实现 `composeCompactSignalProbe`，**无 hook 触发**
- `workers/agent-core/src/host/orchestration.ts:332-338` — `probeCompactRequired` 只返回 boolean，**不触发 ContextPressure**
- `workers/agent-core/src/host/runtime-mainline.ts:813-817` — `compact.requestCompact()` 返回 `{ tokensFreed: 0 }`，**不触发任何 compact hook**
- **Class D 的 6 个事件全部 nowhere 被触发**

**业务影响**:
- 压缩过程对前端完全不可见
- 无法通过 hook 拦截压缩决策
- 无法记录压缩历史

---

### Gap-10: EvalSinkOverflow 无生产者

```typescript
// workers/agent-core/src/hooks/catalog.ts:227-232
EvalSinkOverflow: {
  blocking: false,
  allowedOutcomes: ["additionalContext", "diagnostics"],
  payloadSchema: HOOK_EVENT_PAYLOAD_SCHEMA_NAMES.EvalSinkOverflow,
  redactionHints: [],
}
```

搜索调用点：

```bash
$ grep -r "EvalSinkOverflow" workers/agent-core/src/
workers/agent-core/src/hooks/catalog.ts:227-232  // 定义
```

**问题定位**:
- `BoundedEvalSink`（`runtime-assembly.ts:498`）在溢出时**不触发此 hook**
- 注释说 "Real producer lives in eval-observability (B6 SessionInspector dedup patch)"，但**未找到该 patch**

---

## 4. nano-agent 的独特优势（不应被忽视的差异化）

在指出 gap 的同时，必须承认 nano-agent 在以下方面超越了 Codex：

### 4.1 更完整的事件目录

Codex 只有 5 个事件，nano-agent 有 18 个。特别是：
- `SessionEnd` — Codex 无对应事件
- `PostToolUseFailure` — Codex 的 PostToolUse 不区分 success/failure
- `PreCompact` / `PostCompact` — Codex 无 compact hook
- `Setup` — Codex 的 SessionStart 混合了 startup 和 turn 语义
- `PermissionRequest` / `PermissionDenied` — Codex 的 permission 内嵌在 PreToolUse

### 4.2 Source Priority 机制

```typescript
// workers/agent-core/src/hooks/registry.ts:12-16
const SOURCE_PRIORITY: Record<HookSource, number> = {
  "platform-policy": 0,  // 最高
  session: 1,
  skill: 2,
};
```

Codex 没有 source 分层概念，所有 handlers 扁平执行。nano-agent 的 priority 机制允许 platform-policy hook 优先拦截，这是多租户场景的必需。

### 4.3 深度集成 D1 Permission Rules

```typescript
// workers/orchestrator-core/src/permission-rules-plane.ts:28-78
export class D1PermissionRulesPlane {
  async listTeamRules(teamUuid: string): Promise<TeamPermissionRuleRow[]> { ... }
  async upsertTeamRule(input: { ... }): Promise<TeamPermissionRuleRow> { ... }
}
```

虽然 `Gap-6` 指出 permission 决策未走 hook 系统，但 D1 持久化的 permission rules 本身是一个比 Codex 更企业级的特性。

### 4.4 递归深度与超时保护

```typescript
// workers/agent-core/src/hooks/guards.ts:13-16,78-83
export const DEFAULT_GUARD_OPTIONS: GuardOptions = {
  timeoutMs: 10_000,
  maxDepth: 3,
};

export function checkDepth(currentDepth: number, maxDepth: number): void {
  if (currentDepth > maxDepth) throw new Error(`Hook recursion depth ${currentDepth} exceeds maximum of ${maxDepth}`);
}
```

Codex 的 hooks 没有显式的递归保护和超时保护（依赖 shell command 的 timeout）。

---

## 5. Agent Loop 支撑能力判定

### 5.1 当前 Agent Loop 中 Hook 的真实调用链

```
[Client WS] 
  → orchestrator-core (user-do/ws-runtime.ts:167)
    → agent-core SessionDO (ws-runtime.ts:166-184)
      → orchestration.ts:startTurn()
        → emitHook("Setup")          ✓ 调用
        → emitHook("SessionStart")   ✓ 调用 (turnCount === 0)
        → emitHook("UserPromptSubmit") ✓ 调用
      → runStepLoop()
        → kernel.advanceStep()
          → capability.execute()
            → runtime-mainline.ts:authorizeToolPlan()
              → options.authorizeToolUse()  ← 独立 RPC，不走 HookDispatcher
        → [无 PostToolUse 触发]
        → [无 PostToolUseFailure 触发]
        → [无 ContextPressure 触发]
        → [无 ContextCompact* 触发]
      → shutdown.ts:gracefulShutdown()
        → emitHook("Stop")           ✓ 调用 (但只传 { reason })
        → emitHook("SessionEnd")     ✓ 调用
```

### 5.2 断点总结

| Hook 事件 | 是否触发 | 触发位置 | 问题 |
|-----------|---------|---------|------|
| Setup | ✅ | orchestration.ts:238 | 无客户端可见性 |
| SessionStart | ✅ | orchestration.ts:244 | 无客户端可见性 |
| UserPromptSubmit | ✅ | orchestration.ts:250 | 无客户端可见性 |
| SessionEnd | ✅ | shutdown.ts:97 / orchestration.ts:512 | 无客户端可见性 |
| Stop | ✅ | shutdown.ts:97 | payload 过于简单 |
| PreToolUse | ❌ | — | **未触发** |
| PostToolUse | ❌ | — | **未触发** |
| PostToolUseFailure | ❌ | — | **未触发** |
| PermissionRequest | ❌ | — | **未触发**（authorizeToolPlan 走独立 RPC） |
| PermissionDenied | ❌ | — | **未触发** |
| PreCompact | ❌ | — | **未触发** |
| PostCompact | ❌ | — | **未触发** |
| ContextPressure | ❌ | — | **未触发** |
| ContextCompactArmed | ❌ | — | **未触发** |
| ContextCompactPrepareStarted | ❌ | — | **未触发** |
| ContextCompactCommitted | ❌ | — | **未触发** |
| ContextCompactFailed | ❌ | — | **未触发** |
| EvalSinkOverflow | ❌ | — | **未触发** |

**结论**: 18 个 hook 事件中，**只有 5 个实际被触发**，且全部**无客户端可见性**；其余 13 个事件是 "死事件"（在 catalog 中定义但 nowhere 调用）。

---

## 6. 修复建议（按优先级排序）

### P0: 补全客户端 Hook 事件流（阻断性）

1. 在 `packages/nacp-session/src/messages.ts` 中新增 `session.hook.started` / `session.hook.completed` 顶层帧 schema
2. 在 `runtime-assembly.ts:354` 的 `emitHook` 中，于 hooks.emit 调用前后插入 WS 推送逻辑
3. 参考 Codex 的 `HookRunSummary` 形状，设计 nano-agent 的 `HookExecutionSummary`（含 status / duration / entries）

### P1: 修复 Permission 决策走 HookDispatcher

1. 删除 `runtime-mainline.ts:229-256` 的独立 `authorizeToolPlan()`，改为在 capability execute 前触发 `PermissionRequest` hook
2. 在 `permission-rules-plane.ts` 中实现一个 `LocalHookHandler`，将 D1 rules 查询封装为 hook handler
3. 确保 `verdictOf()` 在 `PermissionRequest` 后被调用

### P2: 补全 PostToolUse / PostToolUseFailure 触发

1. 在 `runtime-mainline.ts:705-783` 的 capability execute 成功/失败分支后，插入 `emitHook("PostToolUse", ...)` 和 `emitHook("PostToolUseFailure", ...)`

### P3: 补全 Compact 生命周期 Hooks

1. 在 `compact-breaker.ts` 的 `composeCompactSignalProbe()` 中，于返回 true 前触发 `ContextPressure`
2. 在 `runtime-mainline.ts:813-817` 的 `compact.requestCompact()` 中，于 compact 各阶段触发对应的 Class D 事件

### P4: 增强 Outcome 结构化

1. 在 `hooks/outcome.ts` 中新增 `entries?: HookOutputEntry[]` 字段
2. 在 `packages/nacp-core/src/messages/hook.ts` 中扩展 `HookOutcomeBodySchema`
3. 参考 Codex 的 `HookOutputEntryKind` 定义 nano-agent 的 `HookEntryKind`

### P5: 实现 CommandShell Runtime

1. 新增 `workers/agent-core/src/hooks/runtimes/command-shell.ts`
2. 在 `runtime-assembly.ts` 中注册 CommandShell runtime
3. 支持通过环境变量/配置读取 hook command

---

## 7. 附录：关键代码引用索引

| 文件 | 行号 | 内容 |
|------|------|------|
| `context/codex/codex-rs/hooks/src/registry.rs` | 30-90 | Hooks registry + dispatch |
| `context/codex/codex-rs/hooks/src/engine/mod.rs` | 61-153 | ClaudeHooksEngine |
| `context/codex/codex-rs/hooks/src/engine/dispatcher.rs` | 25-83 | Handler selection + execution |
| `context/codex/codex-rs/hooks/src/events/pre_tool_use.rs` | 21-131 | PreToolUse event + outcome |
| `context/codex/codex-rs/protocol/src/protocol.rs` | 1604-1694 | Hook protocol types |
| `context/codex/codex-rs/tui/src/history_cell/hook_cell.rs` | 29-90 | TUI rendering semantics |
| `workers/agent-core/src/hooks/dispatcher.ts` | 45-149 | HookDispatcher |
| `workers/agent-core/src/hooks/registry.ts` | 12-72 | HookRegistry |
| `workers/agent-core/src/hooks/catalog.ts` | 68-266 | HOOK_EVENT_CATALOG |
| `workers/agent-core/src/hooks/outcome.ts` | 27-107 | HookOutcome + aggregation |
| `workers/agent-core/src/hooks/matcher.ts` | 22-43 | matchEvent |
| `workers/agent-core/src/hooks/runtimes/local-ts.ts` | 29-51 | LocalTsRuntime |
| `workers/agent-core/src/host/orchestration.ts` | 236-253 | startTurn hook calls |
| `workers/agent-core/src/host/runtime-mainline.ts` | 229-256 | authorizeToolPlan |
| `workers/agent-core/src/host/runtime-mainline.ts` | 538-553 | capability execute permission check |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` | 354-431 | emitHook implementation |
| `workers/orchestrator-core/src/permission-rules-plane.ts` | 28-78 | D1PermissionRulesPlane |
| `workers/orchestrator-core/src/confirmation-control-plane.ts` | 21-131 | Confirmation control plane |
| `packages/nacp-core/src/hooks-catalog/index.ts` | 3-193 | Hook event names + payload schemas |
