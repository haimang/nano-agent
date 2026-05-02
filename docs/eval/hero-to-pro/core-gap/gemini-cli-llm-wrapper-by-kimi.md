# Gemini CLI LLM Wrapper 深度审查 — Nano-Agent 差距评估

> **调查范围**: `context/gemini-cli` 的 LLM wrapper、agent loop、context management、tool execution、confirmation、compression、checkpoint 机制  
> **对标对象**: Nano-Agent `workers/agent-core` + `workers/orchestrator-core` 实际代码  
> **调查原则**: 不比较功能差距，而是判断 nano-agent 的 API 和代码能否支撑一个可运行的前端 agent loop  
> **日期**: 2026-05-02  
> **作者**: Kimi (基于 HPX5/HPX6 执行后代码快照)

---

## 0. 核心结论（前置）

经过对 gemini-cli 全量 LLM wrapper 代码的逐层解剖，与 nano-agent 当前代码的交叉比对，得出以下结论：

**Nano-agent 的 API 表面已经具备了一个成熟 agent CLI 的 70-75% 的端点覆盖，但其 agent-core 内核层存在 4 个致命的结构性断点，这些断点使得当前代码无法支撑一个可自主运行的前端。**

这 4 个断点是：

1. **Compact 执行是空操作** (`tokensFreed: 0`) — 长对话必然撞上下文窗口
2. **Context Window 预检完全缺失** — 没有 token 估算，LLM 调用前不检查窗口余量
3. **Permission "ask" 是死胡同** — 策略返回 `ask` 时直接报错给 LLM，不触发用户确认流程
4. **Hook 调度器是孤儿** — 构造了 `HookDispatcher` 但内核调度器不调用它

下面按维度展开详细比对。

---

## 1. 调查方法与代码范围

### 1.1 Gemini CLI 代码范围

| 模块 | 关键文件 | 分析行数 |
|------|----------|----------|
| LLM Client | `packages/core/src/core/geminiChat.ts` | ~1,099 |
| Agent Loop | `packages/core/src/core/client.ts` | ~1,273 |
| Turn | `packages/core/src/core/turn.ts` | ~600+ |
| Scheduler | `packages/core/src/scheduler/scheduler.ts` | ~940 |
| Tool Executor | `packages/core/src/scheduler/tool-executor.ts` | ~400+ |
| Policy Engine | `packages/core/src/policy/policy-engine.ts` | ~300+ |
| Confirmation | `packages/core/src/scheduler/confirmation.ts` | ~200+ |
| Chat Compression | `packages/core/src/context/chatCompressionService.ts` | ~479 |
| Context Compression | `packages/core/src/context/contextCompressionService.ts` | ~400+ |
| Token Calculation | `packages/core/src/utils/tokenCalculation.ts` | ~170 |
| Checkpoint | `packages/core/src/utils/checkpointUtils.ts` | ~187 |
| Loop Detection | `packages/core/src/services/loopDetectionService.ts` | ~300+ |

### 1.2 Nano-Agent 代码范围

| 模块 | 关键文件 | 分析行数 |
|------|----------|----------|
| LLM Gateway | `workers/agent-core/src/llm/gateway.ts` | ~300 |
| Request Builder | `workers/agent-core/src/llm/request-builder.ts` | ~121 |
| Workers AI Adapter | `workers/agent-core/src/llm/adapters/workers-ai.ts` | ~400 |
| Kernel Runner | `workers/agent-core/src/kernel/runner.ts` | ~437 |
| Scheduler | `workers/agent-core/src/kernel/scheduler.ts` | ~83 |
| Reducer | `workers/agent-core/src/kernel/reducer.ts` | ~295 |
| Runtime Mainline | `workers/agent-core/src/host/runtime-mainline.ts` | ~870 |
| Orchestration | `workers/agent-core/src/host/orchestration.ts` | ~400+ |
| Session DO | `workers/agent-core/src/host/do/session-do-runtime.ts` | ~737 |
| Runtime Assembly | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` | ~569 |
| Compact Breaker | `workers/agent-core/src/host/compact-breaker.ts` | ~60 |
| Hook Dispatcher | `workers/agent-core/src/hooks/dispatcher.ts` | ~200 |

---

## 2. 维度一：LLM 请求构造与流式处理

### 2.1 Gemini CLI 的做法

Gemini CLI 的 LLM 请求生命周期是一个**多阶段流水线**，在 `client.ts:593-669` 的 `processTurn` 中完成：

```typescript
// context/gemini-cli/packages/core/src/core/client.ts:593-669
private async *processTurn(
  request: PartListUnion,
  signal: AbortSignal,
  prompt_id: string,
  boundedTurns: number,
  isInvalidStreamRetry: boolean,
  displayContent?: PartListUnion,
): AsyncGenerator<ServerGeminiStreamEvent, Turn> {
  let turn = new Turn(this.getChat(), prompt_id);
  
  // 1. Session turn limit check
  this.sessionTurnCount++;
  if (this.config.getMaxSessionTurns() > 0 && 
      this.sessionTurnCount > this.config.getMaxSessionTurns()) {
    yield { type: GeminiEventType.MaxSessionTurns };
    return turn;
  }

  // 2. Context window overflow check (PRE-FLIGHT)
  const modelForLimitCheck = this._getActiveModelForCurrentTurn();
  const remainingTokenCount =
    tokenLimit(modelForLimitCheck) - this.getChat().getLastPromptTokenCount();
  const estimatedRequestTokenCount = await calculateRequestTokenCount(
    request, this.getContentGeneratorOrFail(), modelForLimitCheck,
  );
  if (estimatedRequestTokenCount > remainingTokenCount) {
    yield {
      type: GeminiEventType.ContextWindowWillOverflow,
      value: { estimatedRequestTokenCount, remainingTokenCount },
    };
    return turn;
  }

  // 3. Model selection with fallback
  const modelSelection = applyModelSelection(...);
  
  // 4. Send stream with retry + fallback
  turn = yield* this.sendMessageStream(...);
  
  // 5. Check next speaker (auto-continuation)
  const nextSpeakerCheck = await checkNextSpeaker(...);
  if (nextSpeakerCheck === 'model') {
    turn = yield* this.sendMessageStream(...);
  }
}
```

关键特征：
- **预检 token 数量**：每个 turn 发送前都估算请求 token 数，与剩余窗口比较
- **模型切换**：`applyModelSelection()` 支持 feature flag、availability、fallback chain
- **自动续说**：`checkNextSpeaker()` 用轻量模型判断主模型是否应继续发言
- **流式重试**：`retryWithBackoff()` 处理 429，支持模型降级重试
- **循环检测**：`LoopDetectionService` 检测重复模式并注入恢复消息

### 2.2 Nano-Agent 的做法

Nano-agent 的 LLM 请求在 `runtime-mainline.ts` 中构造：

```typescript
// workers/agent-core/src/host/runtime-mainline.ts ( scattered across ~159-195, 467-578 )
function readLlmRequestEvidence(messages: unknown[]) {
  // 从消息数组中推断 model_id、reasoning_effort、vision needs
  let modelId = "@cf/ibm-granite/granite-4.0-h-micro";
  let reasoningEffort: string | undefined;
  // ... 扫描 messages 找 model_id / reasoning 字段
  return { modelId, reasoningEffort, needsVision };
}
```

Gateway 层执行：

```typescript
// workers/agent-core/src/llm/gateway.ts
export class WorkersAiGateway {
  async executeStream(request: ExecutionRequest) {
    // 1. 规范化消息
    // 2. 加载模型能力 (contextWindow: 131072 等)
    // 3. 调用 ai.run() with fallback chain
    // 4. 解析 SSE stream
  }
}
```

Request Builder 验证能力但不检查窗口：

```typescript
// workers/agent-core/src/llm/request-builder.ts:34-80
export function buildExecutionRequest(
  canonical: CanonicalLLMRequest,
  providers: ProviderRegistry,
  models: ModelRegistry,
): ExecutionRequest {
  // 检查: streaming, tools, jsonSchema, vision, reasoning
  // ❌ 不检查: 消息总 token 数是否超过 contextWindow
  // ❌ 不检查: 是否需要在发送前 compact
}
```

### 2.3 差距分析

| 能力 | Gemini CLI | Nano-Agent | 状态 |
|------|-----------|------------|------|
| Token 预检 | `calculateRequestTokenCount()` 每 turn 预检 | ❌ 完全没有 | **断点** |
| 模型动态切换 | `applyModelSelection()` + `handleFallback()` | Fallback chain 仅在 `ai.run()` 失败时触发 | 部分 |
| 自动续说 | `checkNextSpeaker()` 轻量模型判断 | ❌ 无 | 缺失 |
| 循环检测 | `LoopDetectionService` 检测 + 恢复 | ❌ 无 | 缺失 |
| Session turn limit | `config.getMaxSessionTurns()` (默认 100) | ❌ 无 | 缺失 |
| 流式重试 | `retryWithBackoff()` 含指数退避 | `LLMExecutor` 有重试但 client 端无 | 部分 |

**核心断点 2：Context Window 预检完全缺失**

`request-builder.ts` 验证模型能力时检查了 `supportsStream`、`supportsTools`、`supportsVision`、`supportsReasoning`，但**没有任何一行代码**估算消息数组的 token 数量，也不与 `contextWindow` (131,072) 比较。这意味着：

- 长对话在发送给 Workers AI 之前，nano-agent 不知道是否会超出窗口
- 超窗时 Workers AI 会返回错误，但 nano-agent 没有优雅的降级路径（如自动 compact、截断旧消息、切换大上下文模型）
- 对比 Gemini CLI 的 `ContextWindowWillOverflow` 事件（`client.ts:649-654`），nano-agent 的前端无法提前收到警告

---

## 3. 维度二：Context 压缩与摘要

### 3.1 Gemini CLI 的做法

Gemini CLI 有两层压缩机制：

**第一层：Chat Compression** (`chatCompressionService.ts`)

```typescript
// context/gemini-cli/packages/core/src/context/chatCompressionService.ts:41-52
const DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5;
const COMPRESSION_PRESERVE_THRESHOLD = 0.3;
const COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET = 50_000;

// 触发条件: history token count > 0.5 * tokenLimit
// 策略:
// 1. 对旧 function response 应用 reverse token budget (截断到 30 行)
// 2. 在 ~70% 处 split history
// 3. 用轻量模型生成 <state_snapshot> 摘要
// 4. Probe verification: 第二个 LLM turn 评判摘要质量
// 5. 如果摘要后 token 数反而增加 → 拒绝压缩 (COMPRESSION_FAILED_INFLATED_TOKEN_COUNT)
```

**第二层：File-Level Context Routing** (`contextCompressionService.ts`)

对历史中的 `read_file`/`read_many_files` 输出，按内容 hash 缓存路由决策：
- `FULL` — 完整保留
- `PARTIAL` — 保留指定行范围
- `SUMMARY` — 替换为摘要
- `EXCLUDED` — 完全删除

### 3.2 Nano-Agent 的做法

Nano-agent 的 compact 路径：

```typescript
// workers/agent-core/src/host/runtime-mainline.ts:813-816
compact: {
  async requestCompact() {
    return { tokensFreed: 0 };
  },
},
```

Scheduler 支持 compact 决策：

```typescript
// workers/agent-core/src/kernel/scheduler.ts:49-52
// Priority 3: compaction needed
if (signals.compactRequired) {
  return { kind: "compact" };
}
```

Runner 调用 compact delegate：

```typescript
// workers/agent-core/src/kernel/runner.ts:344-359
private async handleCompact(...) {
  const compactResult = (await this.delegates.compact.requestCompact({
    totalTokens: tokensBefore,
  })) as { tokensFreed: number };
  
  snapshot = applyAction(snapshot, {
    type: "compact_done",
    tokensFreed: compactResult.tokensFreed,
  });
  
  events.push({
    type: "compact.notify",
    status: "completed",
    tokensBefore,
    tokensAfter: snapshot.session.totalTokens,
    timestamp: now,
  });
}
```

Compact signal 的探测：

```typescript
// workers/agent-core/src/host/do/session-do/runtime-assembly.ts:285-321
// composeCompactSignalProbe(budgetSource, breaker)
// budgetSource 调 ORCHESTRATOR_CORE.readContextDurableState 计算
// used >= auto_compact_token_limit (默认阈值 0.85)
```

### 3.3 差距分析

| 能力 | Gemini CLI | Nano-Agent | 状态 |
|------|-----------|------------|------|
| 压缩触发 | Token threshold (0.5) + pre-flight check | Signal probe (0.85) + breaker | 框架有，执行无 |
| 压缩执行 | LLM-generated state_snapshot + probe verification | ❌ `tokensFreed: 0` 空操作 | **断点** |
| 旧消息截断 | Reverse token budget (30 行) | ❌ 无 | 缺失 |
| 文件级路由 | FULL/PARTIAL/SUMMARY/EXCLUDED + hash 缓存 | ❌ 无 | 缺失 |
| 压缩质量验证 | Probe verification (第二个 LLM 评判) | ❌ 无 | 缺失 |
| 压缩失败回退 | `COMPRESSION_FAILED_INFLATED_TOKEN_COUNT` 拒绝 | ❌ 总是 "成功" | 缺陷 |

**核心断点 1：Compact 执行是空操作**

`runtime-mainline.ts:814-815` 的 `requestCompact` 直接返回 `{ tokensFreed: 0 }`。这意味着：

1. Scheduler 在 `compactRequired: true` 时会进入 `handleCompact`
2. Runner 会 emit `compact.notify` 事件，状态为 `"completed"`
3. 但 `tokensFreed` 永远是 0，`snapshot.session.totalTokens` 不会减少
4. 3 次失败后 compact-breaker 熔断，但 token 压力持续累积
5. 最终必然超出 Workers AI 的 context window，导致 LLM 调用失败

这是一个**业务断点**：API 表面有 `/context/compact` 端点和 `compact.notify` 事件流，但内核不执行任何实际的上下文缩减。前端收到 "compact completed" 后会认为窗口已清理，继续发送长对话，最终撞墙。

---

## 4. 维度三：工具执行与确认流

### 4.1 Gemini CLI 的做法

Gemini CLI 的 Scheduler 是一个**完整的状态机**：

```typescript
// context/gemini-cli/packages/core/src/scheduler/scheduler.ts:95-159
export class Scheduler {
  // 状态: Validating -> Scheduled -> Executing -> Terminal
  // 确认流:
  // 1. PolicyEngine.check() 评估规则
  // 2. 若 ASK_USER -> resolveConfirmation() 发布 TOOL_CONFIRMATION_REQUEST
  // 3. 等待 TOOL_CONFIRMATION_RESPONSE (支持 IDE race)
  // 4. 结果: ProceedOnce / ProceedAlways / ModifyWithEditor / Cancel
  // 5. Sandbox expansion 失败时触发特殊重确认
}
```

Policy Engine 规则系统：

```typescript
// context/gemini-cli/packages/core/src/policy/policy-engine.ts
// - 支持 wildcard、MCP server scoping、args regex、annotation matching
// - Shell 命令启发式: dangerous commands -> ASK_USER; safe commands -> ALLOW
// - 规则排序 + 优先级
```

### 4.2 Nano-Agent 的做法

工具执行在 `runtime-mainline.ts:538-554`：

```typescript
// workers/agent-core/src/host/runtime-mainline.ts:538-554
const permission = await authorizeToolPlan(
  options, requestId, toolName, normalizedToolInput,
);
if (!permission.allowed) {
  // ❌ 直接返回 error 给 LLM，不触发用户确认
  options.onToolEvent?.({
    kind: "tool_call_result",
    tool_call_id: requestId,
    tool_name: toolName,
    status: "error",
    error: permission.error,
  });
  yield { type: "result", status: "error", result: permission.error };
  return;
}
```

`authorizeToolPlan` 的实现 (`runtime-mainline.ts:229-256`)：

```typescript
async function authorizeToolPlan(...) {
  const result = await options.authorizeToolUse(...);
  if (result.decision === "allow") return { allowed: true };
  // ❌ "ask" 和 "deny" 都返回 error，不区分
  const code = result.decision === "ask" 
    ? "tool-permission-required" 
    : "tool-permission-denied";
  return { allowed: false, error: { code, message: ... } };
}
```

虽然 `NanoSessionDO` 有 `emitPermissionRequestAndAwait` (`session-do-runtime.ts:376-395`)：

```typescript
async emitPermissionRequestAndAwait(input: {...}) {
  await this.pushServerFrameToClient({
    kind: "session.permission.request",
    session_uuid: input.sessionUuid,
    request_uuid: input.requestUuid,
    capability: input.capability,
  });
  return this.awaitAsyncAnswer({
    kind: "permission",
    requestUuid: input.requestUuid,
    timeoutMs: input.timeoutMs,
  });
}
```

但**没有任何调用方**在 `authorizeToolPlan` 返回 `"ask"` 时调用它。

### 4.3 差距分析

| 能力 | Gemini CLI | Nano-Agent | 状态 |
|------|-----------|------------|------|
| 策略引擎 | PolicyEngine: wildcard + regex + annotation + shell heuristic | `permission_rules` (glob + literal) + `approval_policy` | 简化版 |
| 确认状态机 | Validating→Scheduled→Executing→Terminal + 5 种 outcome | ❌ 无状态机 | 缺失 |
| 确认交互 | MessageBus + TOOL_CONFIRMATION_REQUEST/RESPONSE | `emitPermissionRequestAndAwait` 存在但**无人调用** | **断点** |
| 确认修改 | ModifyWithEditor (Vim) | ❌ 无 | 缺失 |
| Sandbox 扩展确认 | 执行失败时重确认 | ❌ 无 | 缺失 |
| 工具进度流 | McpProgress 事件 + 进度百分比 | `tool.call.progress` 事件存在但 capability transport 不 emit | 部分 |

**核心断点 3：Permission "ask" 是死胡同**

当 `approval_policy` 为 `"ask"` 或 `permission_rules` 匹配到 `"ask"` 时：
1. `authorizeToolPlan` 返回 `{ allowed: false, error: { code: "tool-permission-required" } }`
2. `runtime-mainline.ts:544-553` 直接把这个 error 包装成 `tool_call_result` 返回给 LLM
3. LLM 收到错误后可能重试、换工具、或告知用户失败
4. **但用户永远看不到确认弹窗，也没有机会点击 allow/deny**

这意味着 nano-agent 的 confirmation 控制平面（`confirmation-control-plane.ts`、D1 `nano_session_confirmations` 表、WS `session.confirmation.request` 帧）虽然 schema 完整、D1 表就绪、emitter 已接通（HPX5），但**agent loop 内核不触发它**。

这是一个**业务流程断点**：API 可以创建 confirmation row，客户端可以轮询或订阅 WS 帧，但 LLM 调用工具时不会生成 confirmation。

---

## 5. 维度四：Hook 系统

### 5.1 Gemini CLI 的做法

Gemini CLI 有完整的 Hook 系统：

```typescript
// context/gemini-cli/packages/core/src/hooks/types.ts
export interface DefaultHookOutput {
  // BeforeAgent, AfterAgent, BeforeModel, AfterModel, BeforeTool, AfterTool
  // PreCompress, PostCompress, etc.
}
```

Hooks 在 agent loop 的关键节点被调用：
- `BeforeAgent`: 可在 turn 开始前注入上下文或停止执行
- `BeforeTool`: 可修改工具输入或阻止执行
- `PreCompress`: 可在压缩前修改参数

### 5.2 Nano-Agent 的做法

Nano-agent 有 `HookDispatcher` (`hooks/dispatcher.ts`)：

```typescript
// workers/agent-core/src/hooks/dispatcher.ts
export class HookDispatcher {
  // 支持事件: PermissionRequest, PreToolUse, PreCompact, SessionStart, etc.
  // fail-closed: 无 handler -> deny
}
```

`runtime-assembly.ts` 构造了它：

```typescript
// workers/agent-core/src/host/do/session-do/runtime-assembly.ts:196
hookDispatcher,
hookContextProvider: (): HookEmitContext => ({
  sessionUuid: ctx.getSessionUuid() ?? undefined,
}),
```

但内核调度器**不调用 hook emit**：

```typescript
// workers/agent-core/src/kernel/scheduler.ts:57-59
if (signals.pendingHookEvents && signals.pendingHookEvents.length > 0) {
  return { kind: "hook_emit", event: signals.pendingHookEvents[0]! };
}
```

```typescript
// workers/agent-core/src/kernel/runner.ts
// ❌ 没有 handleHookEmit 方法
// Scheduler 支持 hook_emit 决策，但 Runner 不处理它
```

更重要的是，`runtime-mainline.ts` 的 `MainlineKernelOptions` 中**没有注入 hook 相关信号**：

```typescript
// workers/agent-core/src/host/runtime-mainline.ts
// signals 构造中没有 pendingHookEvents
const signals: SchedulerSignals = {
  hasMoreToolCalls: ...,
  compactRequired: ...,
  cancelRequested: ...,
  timeoutReached: ...,
  llmFinished: ...,
  // ❌ pendingHookEvents 缺失
};
```

### 5.3 差距分析

| 能力 | Gemini CLI | Nano-Agent | 状态 |
|------|-----------|------------|------|
| Hook 注册 | HookRegistry + HookPlanner | HookDispatcher 存在 | 框架有 |
| Hook 调用 | BeforeAgent/AfterAgent/BeforeTool/AfterTool/PreCompress | ❌ 内核不调用 | **断点** |
| PreToolUse 拦截 | 可修改输入或阻止执行 | `authorizeToolUse` RPC 有，但 hook 层未接通 | 部分 |
| Hook 超时保护 | 有 | 有 (dispatcher 内实现) | 有 |

**核心断点 4：Hook 调度器是孤儿**

`HookDispatcher` 被构造了，但：
1. `runtime-mainline.ts` 不构造 `pendingHookEvents` 信号
2. `SchedulerSignals` 接口有 `pendingHookEvents` 字段，但无实际数据流入
3. `KernelRunner` 没有 `handleHookEmit` 方法处理 `hook_emit` 决策
4. 结果是：Hook 系统是一个 "wire 完成但无调用方" 的典型例子（ charter §5 方法论明确警告过的 `wire-without-delivery` 模式）

---

## 6. 维度五：检查点与恢复

### 6.1 Gemini CLI 的做法

Gemini CLI 的检查点是**per-tool-call 粒度**：

```typescript
// context/gemini-cli/packages/core/src/utils/checkpointUtils.ts
export interface ToolCallData {
  history?: HistoryType;
  clientHistory?: readonly Content[];
  commitHash?: string;  // git snapshot
  toolCall: { name: string; args: ArgsType };
  messageId?: string;
}

// 在破坏性工具(write_file, edit)前创建 git snapshot
// checkpoint 数据序列化为 JSON 存在 project temp dir
```

### 6.2 Nano-Agent 的做法

Nano-agent 有多层检查点：

**Kernel 层**：
```typescript
// workers/agent-core/src/kernel/checkpoint.ts
export function buildCheckpointFragment(snapshot: KernelSnapshot) {
  return { session: snapshot.session, activeTurn: snapshot.activeTurn };
}
```

**Session 层**：
```typescript
// workers/agent-core/src/host/checkpoint.ts
// 组合 6 个 fragment: kernel + replay + streamSeqs + workspace + hooks + usage
```

**DO 持久化**：
```typescript
// workers/agent-core/src/host/do/session-do-persistence.ts
// 存到 state.storage under "session:checkpoint"
```

**Orchestrator D1**：
```typescript
// workers/orchestrator-core/src/checkpoint-restore-plane.ts
// nano_session_checkpoints + nano_checkpoint_file_snapshots + nano_checkpoint_restore_jobs
```

但存在关键问题：

```typescript
// workers/agent-core/src/host/do/session-do/runtime-assembly.ts:334-335
buildCheckpoint: (snapshot) => snapshot,
restoreCheckpoint: (fragment) => fragment,
```

这里 `buildCheckpoint` 和 `restoreCheckpoint` 是**identity 函数** — 不实际捕获 workspace 状态。

### 6.3 差距分析

| 能力 | Gemini CLI | Nano-Agent | 状态 |
|------|-----------|------------|------|
| 检查点粒度 | Per-tool-call (git snapshot) | Per-session-DO (hibernation blob) | 不同 |
| 检查点内容 | History + git commit hash | Kernel snapshot + workspace (部分) | 部分 |
| 恢复执行 | 用户手动 revert | Queue executor (HPX6 Phase 4) | 新实现 |
| Workspace 快照 | `WorkspaceSnapshotBuilder` 有但 checkpoint 未接入 | ❌ `buildCheckpoint: (s) => s` | **断点** |
| 恢复模式 | 单一 revert | conversation_only / files_only / conversation_and_files / fork | 更完整 |

**断点 5：Workspace 检查点未接入**

`host/checkpoint.ts` 定义了 `workspaceFragment`，但 `runtime-assembly.ts:334` 的 `buildCheckpoint` 是 identity 函数。这意味着：
- DO checkpoint 只保存了 kernel 状态，不保存 workspace 文件索引
- 恢复后 workspace 上下文丢失
- 对比 HP7 设计的 "files_only + conversation_and_files + fork" 全模式恢复，当前代码无法支撑

---

## 7. 维度六：循环检测与防护

### 7.1 Gemini CLI 的做法

```typescript
// context/gemini-cli/packages/core/src/services/loopDetectionService.ts:133+
export class LoopDetectionService {
  // 检测重复模式:
  // 1. 相同工具调用序列重复
  // 2. 相同错误消息重复
  // 3. 相同 LLM 输出重复
  // 触发后: 注入 system feedback (_recoverFromLoop) + boundedTurns - 1
}
```

在 `client.ts` 中使用：

```typescript
// context/gemini-cli/packages/core/src/core/client.ts:96, 112
private readonly loopDetector: LoopDetectionService;
// ...
this.loopDetector = new LoopDetectionService(this.config);
```

### 7.2 Nano-Agent 的做法

❌ **完全缺失**。Kernel 和 Orchestrator 中没有任何循环检测逻辑。

### 7.3 差距分析

这是一个**防护层缺失**。没有循环检测意味着：
- LLM 可能陷入 "read_file → 失败 → read_file → 失败" 的无限循环
- 没有自动恢复机制
- 依赖外部（用户 cancel）终止

---

## 8. 维度七：Todo / Plan 机制

### 8.1 Gemini CLI 的做法

```typescript
// context/gemini-cli/packages/core/src/tools/write-todos.ts
// LLM 调用 write_todos 设置 todo list
// 状态: pending, in_progress, completed, cancelled, blocked
// 约束: 只能有一个 in_progress

// context/gemini-cli/packages/core/src/tools/enter-plan-mode.ts
// 进入 plan mode: 限制 write_file/edit 只能用于 .md 文件
// context/gemini-cli/packages/core/src/tools/exit-plan-mode.ts
// 退出 plan mode
```

### 8.2 Nano-Agent 的做法

Nano-agent 在 HPX5 中实现了 `write_todos`：

```typescript
// workers/agent-core/src/host/runtime-mainline.ts:559-580
if (toolName === "write_todos") {
  // 短路到 orchestrator-core D1TodoControlPlane
  const result = await options.writeTodosBackend(...);
  // 返回 created / auto_closed 列表给 LLM
}
```

Orchestrator 层：

```typescript
// workers/orchestrator-core/src/todo-control-plane.ts
// D1TodoControlPlane: 5 状态, at-most-1 in_progress
// emit session.todos.update 帧 (HPX5 已接通)
```

### 8.3 差距分析

| 能力 | Gemini CLI | Nano-Agent | 状态 |
|------|-----------|------------|------|
| Todo 工具 | `write_todos` | `write_todos` (HPX5 已接通) | 有 |
| Plan mode | `enter_plan_mode` / `exit_plan_mode` | ❌ 无 | 缺失 |
| Todo 状态 | 5 状态 | 5 状态 | 相同 |
| in_progress 约束 | 1 个 | 1 个 (transactional) | 相同 |

Plan mode 的缺失意味着 nano-agent 不支持 "先规划后执行" 的工作流。但这是一个产品特性差异，不是支撑前端运行的断点。

---

## 9. 其他重要发现

### 9.1 Token 计数不准确

```typescript
// workers/agent-core/src/kernel/reducer.ts
// llm_response action:
case "llm_response": {
  const inputTokens = action.usage?.inputTokens ?? 0;
  const outputTokens = action.usage?.outputTokens ?? 0;
  draft.session.totalTokens += inputTokens + outputTokens;
}
```

问题：`totalTokens` 是**累积值**（每次 LLM 调用的 input + output 之和），不是**当前 prompt 大小**。下一次 LLM 调用的 `inputTokens` 包含了之前所有的 assistant + tool 消息，但这些消息的 token 在上一轮已经被计入了 `totalTokens`。这导致 `totalTokens` 随 turn 数指数增长， compact signal 的 `used_tokens >= threshold` 判断会在实际上远未超窗时就触发（或触发后 compact 空操作无法降低它）。

### 9.2 Model Fallback 事件已接通但无智能降级

HPX5 接通了 `model.fallback` stream event：

```typescript
// workers/orchestrator-core/src/user-do/message-runtime.ts:333-432
// 从 inputAck.body 读 fallback_used / fallback_model_id / fallback_reason
// fallback_used=true 时 emit model.fallback 事件
```

但 nano-agent 的 fallback 仅限于 Workers AI `ai.run()` 调用失败时的模型链切换（`workers-ai.ts`），没有基于 token 限制、能力不匹配、团队策略的智能降级。

### 9.3 Session Turn Limit 缺失

Gemini CLI 有 `MAX_TURNS = 100` (`client.ts:78`)。Nano-agent 没有 turn limit，长 session 可能无限运行直到 context window 溢出。

### 9.4 Tool Cancel 未完全接通

```typescript
// workers/agent-core/src/host/runtime-mainline.ts:520
abort() {},  // ❌ 空实现
```

Capability transport 的 `cancel` 是空函数。虽然 schema 有 `tool.call.cancelled`，用户无法从 UI 取消正在执行的工具。

---

## 10. P0 / P1 优先级推荐（下一阶段纲领输入）

> **原则**：本章节为下一阶段（HPX7 / HPX8 或独立收口阶段）提供可直接落地的纲领输入。P0 = 前端无法自主运行的阻塞项；P1 = 显著提升产品体验的非阻塞项；Out-of-Scope = 明确推迟，避免阶段膨胀。

### 10.1 分类原则

| 级别 | 判定标准 | 数量控制 |
|------|----------|----------|
| **P0** | 缺少该功能，前端在标准使用场景下会遭遇不可恢复的失败（crash / hang / 数据丢失） | ≤ 3 项 |
| **P1** | 缺少该功能，前端可以运行但体验显著受损（效率低、误导性反馈、需要用户手动规避） | ≤ 4 项 |
| **Out-of-Scope** | 功能有价值，但当前阶段解决成本高、收益低，或可通过产品文档规避 | 明确列出 |

### 10.2 P0 级别 — 必须在下一阶段完成

#### P0-1：Compact 执行实装（断点 #1）

**现状**：`runtime-mainline.ts:814-815` 的 `requestCompact()` 返回 `{tokensFreed: 0}`。Scheduler 触发 compact → Runner 调用 → 事件流完整，但**消息历史未被截断或摘要**。

**为什么阻塞**：超过 ~20-30 轮对话（取决于模型 context window）后，`TurnState.messages` 累积的消息会超出 Workers AI 的 token 限制。此时 LLM 调用返回 400/413 错误，agent loop 进入 error 状态，用户被迫新建 session。

**修复范围**：
1. `context-core` 提供真实 compact 实现：将旧消息（超出阈值部分）摘要为 `<compact_summary>` 伪消息，写入 `nano_session_checkpoints`（`compact_boundary` 类型）
2. `agent-core` 的 `requestCompact` delegate 调用 context-core RPC，接收 `tokensFreed` 和 `summaryMessage`
3. Reducer 在 `compact_done` action 中**实际替换**旧消息为 summary，而非仅累加 `totalTokens`
4. 保留最近 N 轮完整消息（可配置，默认 5 轮）

**验收标准**：
- 50 轮对话 e2e 不撞 context window
- `compact.notify` 事件的 `tokensBefore / tokensAfter` 差值 > 0
- Compact 后 LLM 仍能正确引用 summary 中的关键信息

**预估工作量**：3-4 天（含 context-core compact 逻辑 + agent-core delegate 接线 + e2e）

#### P0-2：Permission "ask" 内核接通（断点 #3）

**现状**：`authorizeToolPlan` 返回 `"ask"` 时，`runtime-mainline.ts:544-553` 直接把 error 返回给 LLM。`emitPermissionRequestAndAwait` 在 `session-do-runtime.ts:376-395` 存在但**无调用方**。

**为什么阻塞**：前端已经订阅了 `session.confirmation.request` 帧（HPX5 已接通 emitter），但 LLM 调用工具时永远不会生成 confirmation。用户看到的永远是 "tool-permission-required" 错误，无法体验完整的 agentic loop。

**修复范围**：
1. 修改 `runtime-mainline.ts:538-554` 的 tool execution 路径：
   - `permission.decision === "ask"` 时，**不返回 error 给 LLM**
   - 改为：通过 `options.emitPermissionRequest` 调用 `NanoSessionDO.emitPermissionRequestAndAwait`
   - 将当前 turn 挂起（scheduler 进入 `wait` 状态，reason = `confirmation_pending`）
   - 用户决策到达后，恢复 turn 继续执行工具或跳过
2. `KernelRunner` 支持 `confirmation_pending` interrupt 的恢复路径
3. 确保 `session.confirmation.request` 帧包含完整的 `payload`（工具名、参数摘要、风险等级）

**验收标准**：
- `approval_policy = "ask"` 时，LLM 调用 Read/Bash 工具 → 前端收到 `session.confirmation.request` → 用户 allow → 工具执行成功
- 用户 deny → 工具跳过，LLM 收到 `tool_call_result` 含 `cancelled` 状态
- 超时（默认 60s）→ 自动 deny，emit `session.confirmation.update` status = `timeout`
- e2e 覆盖：allow / deny / timeout 三路径

**预估工作量**：2-3 天（主要改 runtime-mainline 的 tool exec 路径 + scheduler 挂起/恢复逻辑）

#### P0-3：Context Window 预检（断点 #2）

**现状**：`request-builder.ts` 验证模型能力（stream/tools/vision/reasoning），但**不估算消息 token 数**，也不与 `contextWindow` 比较。

**为什么阻塞**：没有预检，nano-agent 在发送 LLM 请求前不知道是否会超窗。对比 Gemini CLI 的 `ContextWindowWillOverflow` 事件（`client.ts:649-654`），nano-agent 的前端无法在超窗前收到警告并采取降级措施（如提示用户 compact、切换模型）。

**修复范围**：
1. `request-builder.ts` 增加 `estimateTokenCount()`：
   - 文本：字符数 / 4（ASCII）或 1.3（非 ASCII）的启发式估算
   - 图片：固定估算（如 3000 tokens/张）
   - 工具调用/结果：JSON 字符串长度估算
2. 发送前检查：`estimatedTokens + safetyMargin > contextWindow`
3. 若超窗：
   - 优先触发 compact（若 compact signal 未熔断）
   - 若 compact 后仍超窗 → emit `system.error` 事件，code = `CONTEXT_WINDOW_OVERFLOW`，建议用户新建 session
   - **绝不**在超窗状态下发送请求给 Workers AI

**验收标准**：
- 构造一个故意超窗的消息数组 → 不发送给 LLM，前端收到 `system.error` 事件
- 估算值与 Workers AI 实际返回的 usage 偏差 ≤ 20%
- 性能：估算耗时 ≤ 1ms（P99）

**预估工作量**：1-2 天（纯 agent-core 内实现，不依赖外部服务）

### 10.3 P1 级别 — 下一阶段应完成

#### P1-1：Token 计数准确性修复（缺陷 #6）

**现状**：`reducer.ts:llm_response` 累加 `inputTokens + outputTokens` 到 `totalTokens`，但 `inputTokens` 已包含前序 assistant + tool 消息，导致**双重计数**。

**为什么 P1**：不修复会导致 compact signal 过早触发（第 10 轮就触发，而非真正的第 30 轮），影响体验但不阻塞。

**修复**：区分 `cumulativeTokens`（累计处理量）和 `currentPromptTokens`（当前 prompt 大小）。Compact signal 应基于 `currentPromptTokens`。

**预估工作量**：0.5 天

#### P1-2：Hook 系统内核接通（断点 #4）

**现状**：`HookDispatcher` 构造了但 `runtime-mainline.ts` 不构造 `pendingHookEvents` 信号，runner 无 `handleHookEmit`。

**为什么 P1**：Hook 是高级能力（PreToolUse 拦截、PostToolUse 审计）。当前 `permission_rules` + `approval_policy` 已能覆盖基础权限场景，Hook 是增强层。

**修复**：
1. `runtime-mainline.ts` 在 scheduler signals 中构造 `pendingHookEvents`
2. `KernelRunner` 实现 `handleHookEmit`，调用 `HookDispatcher.emit`
3. `PreToolUse` hook 结果影响 tool execution 决策

**预估工作量**：2 天

#### P1-3：Workspace 检查点接入（缺陷 #5）

**现状**：`runtime-assembly.ts:334-335` 的 `buildCheckpoint` 是 identity 函数，workspace 状态未捕获。

**为什么 P1**：影响 checkpoint restore 的完整性，但基础 checkpoint（kernel state + replay buffer）已能工作。HP7 设计的 "files_only / conversation_and_files / fork" 全模式恢复依赖此修复。

**修复**：`buildCheckpoint` 调用 `workspaceComposition.captureSnapshot()`，将 workspace 文件索引、mount 状态、artifact refs 序列化到 checkpoint fragment。

**预估工作量**：1-2 天

#### P1-4：循环检测（缺陷 #7）

**现状**：无循环检测。LLM 可能陷入 "read_file → error → read_file → error" 无限循环。

**为什么 P1**：Gemini CLI 用 `LoopDetectionService` 检测重复模式并注入恢复消息。Nano-agent 没有此防护，依赖用户手动 cancel。

**修复**：
1. 在 `KernelRunner` 或 `SessionOrchestrator` 层跟踪最近 5 轮的工具调用序列
2. 若检测到完全重复的工具调用（同名 + 同参数 hash）≥ 3 次 → 中断 turn，emit `system.error` code = `AGENT_LOOP_DETECTED`
3. 可选：注入 system message 提示 LLM 已陷入循环

**预估工作量**：1-2 天

### 10.4 明确的 Out-of-Scope（下一阶段不做）

| 项目 | 不做理由 | 替代方案 |
|------|----------|----------|
| **Session Turn Limit** | 当前无此需求；context window 预检已能防止无限运行 | 留待 hero-to-platform |
| **Tool Cancel 端到端** | 体验优化，当前用户可通过 cancel turn 间接终止 | 留待 polish PR |
| **checkNextSpeaker 自动续说** | Gemini CLI 特有模式；非通用需求 | 产品决策后再评估 |
| **File-level Context Routing** | Gemini CLI 的精细优化（FULL/PARTIAL/SUMMARY/EXCLUDED）；实现成本高 | Compact 实装后评估必要性 |
| **Plan Mode** | 产品特性差异，非技术断点 | 产品 backlog |
| **Sub-agent / Multi-agent** | hero-to-pro charter 已明确 out-of-scope | hero-to-platform |
| **MCP Tool 集成** | 无现有基础设施 | hero-to-platform |

### 10.5 阶段边界建议

若将上述 P0 + P1 组织为一个新阶段（建议命名为 **HPX7 — Core Loop Closure**），其边界如下：

**In-Scope**：
- P0-1 Compact 执行实装（含 context-core compact 逻辑 + agent-core delegate + e2e）
- P0-2 Permission ask 内核接通（含 scheduler 挂起/恢复 + confirmation 全流程 e2e）
- P0-3 Context Window 预检（含 token estimator + overflow graceful degradation）
- P1-1 Token 计数修复
- P1-2 Hook 系统接通（至少 PreToolUse）
- P1-3 Workspace 检查点接入
- P1-4 循环检测

**Out-of-Scope**：
- 上表 7 项明确不做
- 不新增 worker
- 不新增 D1 migration（复用 HP1 已落表）
- 不修改 NACP 协议版本（仅新增 error code）

**进入条件**：
- HPX6 已 closure（emit-helpers、Queue executor、item projection 全 live）
- P0-1 需要 context-core compact 设计 doc 先 review

**交付标准**：
- 50 轮对话 e2e 通过（P0-1）
- Confirmation 7 种 kind 全路径 e2e 通过（P0-2）
- Context window overflow 模拟 e2e 通过（P0-3）
- `pnpm test` + `pnpm test:contracts` + `pnpm test:cross-e2e` 全绿
- 19-doc → 20-doc（新增 `context-window.md` 或扩展 `context.md`）

**预估总工期**：2 周（3 P0 × 3天 + 4 P1 × 1.5天 + 2天集成测试 + 2天文档）

### 10.6 对前端开发者的影响矩阵

| 前端场景 | 当前状态（HPX6 后） | 完成 P0 后 | 完成 P1 后 |
|----------|-------------------|-----------|-----------|
| 短对话（<10 轮） | 可用 | 无变化 | 更稳定 |
| 长对话（30-50 轮） | ❌ 必撞窗口 | ✅ 可用 | ✅ 可用 |
| 工具调用 + auto-allow | 可用 | 无变化 | 无变化 |
| 工具调用 + ask policy | ❌ 报错给 LLM | ✅ 弹窗确认 | ✅ 更流畅 |
| 超窗 gracefully | ❌ 直接 400 错误 | ✅ 提前警告 | ✅ 提前警告 |
| 恢复 session | 部分可用 | 部分可用 | ✅ 含 workspace |
| LLM 陷入循环 | ❌ 无限循环 | ❌ 无限循环 | ✅ 自动检测中断 |

---

## 11. 总结：断点清单与优先级

### 11.1 致命断点（阻止前端自主运行）

| # | 断点 | 代码位置 | 影响 | 修复复杂度 | 阶段分级 |
|---|------|----------|------|------------|----------|
| 1 | **Compact 空操作** | `runtime-mainline.ts:814-815` | 长对话必撞窗口 | 高 | **P0** |
| 2 | **Context Window 预检缺失** | `request-builder.ts` 无 token 估算 | 无 graceful degradation | 中 | **P0** |
| 3 | **Permission "ask" 死胡同** | `runtime-mainline.ts:247, 544-553` | 用户无法确认工具调用 | 中 | **P0** |
| 4 | **Hook 系统孤儿** | `runtime-assembly.ts:334-335`, runner 无 handleHookEmit | Hook 策略无法生效 | 中 | **P1** |

### 11.2 严重缺陷（显著降低产品体验）

| # | 缺陷 | 代码位置 | 影响 | 阶段分级 |
|---|------|----------|------|----------|
| 5 | **Workspace 检查点未接入** | `runtime-assembly.ts:334` identity 函数 | 恢复后 workspace 丢失 | **P1** |
| 6 | **Token 计数双重累加** | `reducer.ts:llm_response` | compact 信号误触发 | **P1** |
| 7 | **循环检测缺失** | 无 | LLM 可能无限循环 | **P1** |
| 8 | **Tool Cancel 空实现** | `runtime-mainline.ts:520` | 用户无法取消工具 | Out-of-Scope |
| 9 | **Session Turn Limit 缺失** | 无 | 无防止无限运行的 guard | Out-of-Scope |
| 10 | **No checkNextSpeaker** | 无 | 不支持自动续说 | Out-of-Scope |

### 11.3 API 表面 vs 内核实现差距

Charter §2.2 列出的 17 个核心 gap 中，经过 HPX5/HPX6 后：

**已闭环**:
- G1 `/start`/`/input` model_id 透传 (HP0)
- G3 context-core RPC stub → 部分 live (HP3 + HPX5 F3)
- G7 Permission/elicitation hook dispatcher → D1 表 + emitter 接通 (HP5 + HPX5)
- G10 Todo/plan API → `write_todos` live (HPX5)
- G12 API docs 漂移 → 19-doc 已刷新 (HPX5 F7)
- G13 turn_index UNIQUE → turn_attempt 改造 (HP1)

**仍然开放**:
- G2 DDL model metadata 字段 → HP1 已落表，但 `base_instructions_suffix` 未填真值
- G4 `compactRequired` 永远 false → **信号已接通但执行空操作** (本报告断点 #1)
- G5 无 cross-turn history → 部分有（TurnState.messages），但无 truncation
- G6 无模型切换语义 → fallback 事件已接通但无智能降级
- G8 `pushServerFrameToClient` e2e → HPX5 已 emitter 接通但 permission ask 不触发 (本报告断点 #3)
- G9 无 checkpoint revert → HP7 schema 就绪，executor 部分实现 (HPX6 Phase 4)
- G11 无统一 confirmation control plane → schema 就绪但 kernel 不触发 (本报告断点 #3)
- G14-G17 慢性 deferrals → HP8/HP9 待处理

---

## 12. 结论

Nano-agent 在 HPX5/HPX6 之后，**API 表面和 D1 控制平面**已经具备了支撑一个 agent CLI 前端的绝大多数基础设施：

- ✅ WebSocket 协议完整（NACP 1.1.0）
- ✅ Stream event 13 种已 emit
- ✅ Top-level frame emitter 已接通（confirmation、todo、model.fallback）
- ✅ Tool execution 端到端通
- ✅ Todo CRUD + WriteTodos capability
- ✅ Runtime config + Permission rules
- ✅ Checkpoint/restore schema + executor runtime (Queue)
- ✅ Item projection 7 类

但 **agent-core 内核层**存在 4 个致命断点，这些断点是**代码层面的 wire-without-delivery** — 结构存在但逻辑未接通：

1. **Compact 空操作**：API 返回 "completed"，实际什么都不做
2. **Context Window 盲飞**：不估算 token，直接发送给 LLM
3. **Permission 死胡同**：策略 "ask" 直接报错，不触发 confirmation 流程
4. **Hook 孤儿**：调度器不调用 hook，策略无法生效

**这些断点的共同特征**：它们都是 agent loop 的**闭环控制点**。缺少它们，前端无法可靠地处理长对话、无法安全地执行工具、无法优雅地降级。当前代码可以运行短对话 demo，但无法支撑生产级 agent loop。

### 12.1 修复路径（按第 10 章 P0/P1 优先级）

**P0（必须在下一阶段完成）**：
- **P0-1 Compact 执行实装**：context-core 提供真实 compact + agent-core delegate 接线 + 消息替换逻辑
- **P0-2 Permission ask 内核接通**：`runtime-mainline.ts` 在 `authorizeToolPlan` 返回 "ask" 时挂起 turn，调用 `emitPermissionRequestAndAwait`，用户决策后恢复
- **P0-3 Context Window 预检**：`request-builder.ts` 增加 token 估算 + 超窗 graceful degradation

**P1（下一阶段应完成）**：
- **P1-1 Token 计数修复**：区分 `cumulativeTokens` vs `currentPromptTokens`
- **P1-2 Hook 系统接通**：`runtime-mainline.ts` 构造 `pendingHookEvents` + runner 实现 `handleHookEmit`
- **P1-3 Workspace 检查点接入**：`buildCheckpoint` 调用 `workspaceComposition.captureSnapshot()`
- **P1-4 循环检测**：跟踪最近 5 轮工具调用序列，重复 ≥3 次时中断

**Out-of-Scope（明确推迟）**：
- Session turn limit、tool cancel、checkNextSpeaker、plan mode、sub-agent、MCP — 见第 10.4 节

### 12.2 对下一阶段纲领的输入

本报告的第 10 章（P0/P1 优先级推荐）可直接作为下一阶段（建议 **HPX7 — Core Loop Closure**）的纲领输入：

- **范围**：3 P0 + 4 P1 = 7 项，2 周工期
- **边界**：不新增 worker、不新增 D1 migration、不 bump NACP 版本
- **交付标准**：50 轮对话 e2e + confirmation 全路径 e2e + context window overflow e2e
- **前端影响**：完成 P0 后，长对话（30-50 轮）和 ask policy 工具调用从 "不可用" 变为 "可用"

这些修复完成后，nano-agent 将第一次具备**生产级 agent loop 的闭环能力**，前端开发者可以站在一个可靠的基线上构建 UI，而非不断绕过内核断点。

---

## 附录：关键代码引用索引

| 引用 | 文件路径 | 行号 |
|------|----------|------|
| Compact 空操作 | `workers/agent-core/src/host/runtime-mainline.ts` | 814-815 |
| Token 计数累加 | `workers/agent-core/src/kernel/reducer.ts` | llm_response action |
| Context Window 预检缺失 | `workers/agent-core/src/llm/request-builder.ts` | 全文件 |
| Permission ask 死胡同 | `workers/agent-core/src/host/runtime-mainline.ts` | 229-256, 538-554 |
| emitPermissionRequest 未调用 | `workers/agent-core/src/host/do/session-do-runtime.ts` | 376-395 (存在但无调用方) |
| Hook 信号未构造 | `workers/agent-core/src/host/runtime-mainline.ts` | signals 对象 |
| Hook 决策无 handler | `workers/agent-core/src/kernel/runner.ts` | 无 handleHookEmit |
| buildCheckpoint identity | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` | 334-335 |
| Tool cancel 空实现 | `workers/agent-core/src/host/runtime-mainline.ts` | 520 |
| Gemini CLI token 预检 | `context/gemini-cli/packages/core/src/core/client.ts` | 636-654 |
| Gemini CLI compression | `context/gemini-cli/packages/core/src/context/chatCompressionService.ts` | 41-52 |
| Gemini CLI loop detection | `context/gemini-cli/packages/core/src/services/loopDetectionService.ts` | 133+ |
| Gemini CLI scheduler confirmation | `context/gemini-cli/packages/core/src/scheduler/scheduler.ts` | 95-159 |
| Gemini CLI checkpoint | `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts` | 15-46 |
