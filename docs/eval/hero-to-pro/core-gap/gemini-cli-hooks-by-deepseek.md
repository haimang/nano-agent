# Gemini CLI Hooks vs Nano-Agent Hooks — 全量比对与缺口审查

> **调查方法**: 深度 `context/gemini-cli` 全量 hooks 源码 + `workers/agent-core` 全量实现比对
> **对标对象**: `Gemini CLI` (`packages/core/src/hooks/` + `packages/core/src/core/` 集成点)
> **审查范围**: 11 事件(CLI) vs 18 事件(nano) 的语义覆盖、集成深度、盲点、断点、agent loop 支撑度
> **日期**: 2026-05-02
> **前序参考**:
> - `docs/charter/plan-hero-to-pro.md` (hero-to-pro 阶段基石)
> - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` (emit seam + emitter wiring)
> - `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md` (workbench controls + item layer)
> - `docs/issue/hero-to-pro/HP5-closure.md` (HP5 partial closure)

---

## 0. Executive Summary

**总体判断: nano-agent 的 hooks 系统存在显著的结构性缺口。不是"方案有但没接线"的问题,而是 18-event catalog 中大量事件与 Gemini CLI 11-event 语义完全不重叠,且关键集成断点(BeforeModel / BeforeToolSelection / AfterAgent / Notification)在 Gemini CLI 是 agent loop 的有机组成部分,在 nano-agent 中完全不存在。**

nano-agent catalog 的设计哲学是"lifecycle observation"(观察事件),Gemini CLI 的设计哲学是"intervention seam"(干预接缝)。两者的根本分歧在于:nano-agent hooks 只能观察到发生了什么,但不能改变将要发生什么。Gemini CLI hooks 可以 block/stop/modify 每一个关键决策点。

---

## 1. Gemini CLI Hooks 系统完整架构

### 1.1 核心文件与代码引用

| 文件 | 职责 | 行数 |
|------|------|------|
| `context/gemini-cli/packages/core/src/hooks/types.ts` | 11 事件枚举 + 事件专用 I/O 类型 + 输出类 | 748 |
| `context/gemini-cli/packages/core/src/hooks/hookSystem.ts` | 门面,orchestrate Registry/Runner/Aggregator/Planner/EventHandler | 447 |
| `context/gemini-cli/packages/core/src/hooks/hookRegistry.ts` | 多源注册(用户/项目/扩展/系统/运行时),trust check | 356 |
| `context/gemini-cli/packages/core/src/hooks/hookRunner.ts` | 双模式执行: Command(spawn 子进程) + Runtime(进程内) | 561 |
| `context/gemini-cli/packages/core/src/hooks/hookPlanner.ts` | 按 matcher 过滤 + dedup + 优先级排序 + seq/parallel 策略 | 150 |
| `context/gemini-cli/packages/core/src/hooks/hookAggregator.ts` | 多 hook 输出合并: OR-decision / field-replace / union | 371 |
| `context/gemini-cli/packages/core/src/hooks/hookEventHandler.ts` | 事件总线,对接 11 类 fire* 方法到上层 consumer | 532 |
| `context/gemini-cli/packages/core/src/hooks/hookTranslator.ts` | GenAI SDK 类型与 stable hook API 之间的解耦转换层 | 372 |
| `context/gemini-cli/packages/core/src/core/geminiChat.ts` | BeforeModel / AfterModel / BeforeToolSelection 集成点 | 1099 |
| `context/gemini-cli/packages/core/src/core/coreToolHookTriggers.ts` | BeforeTool / AfterTool 包围每个 tool execution | 247 |
| `context/gemini-cli/packages/core/src/core/client.ts` | BeforeAgent / AfterAgent 包围整个 sendMessageStream | 1273 |

### 1.2 11 事件语义

```
HookEventName {
  BeforeTool          // 每个 tool 执行前: 可 block/deny, modify input
  AfterTool           // 每个 tool 执行后: 可 block result, add context, request tail tool
  BeforeAgent         // 每 prompt_id 首次: 可 stop/block, inject additionalContext
  AfterAgent          // 最后 turn 完成后(无 pending tools): 可 stop/block, clearContext, auto-retry
  Notification        // tool 需要 confirmation 时: 仅通知
  SessionStart        // 会话启动: 可 emit systemMessage, additionalContext
  SessionEnd          // 会话结束: 仅通知
  PreCompress         // 压缩前(手动/自动): 可 block
  BeforeModel         // 每次 LLM 调用前: 可 block(synthetic response), modify model/config/contents, stop
  AfterModel          // 每次 streaming chunk 到达: 可 modify response, block, stop
  BeforeToolSelection // 工具选择前: 可 restrict/filter 可用 tools, modify toolConfig
}
```

### 1.3 输出类型与干预能力(per event)

| 事件 | 输出类型 | 可干预能力 |
|------|---------|-----------|
| BeforeTool | `BeforeToolHookOutput` | `decision: ask\|block\|deny\|approve\|allow`; `updatedInput`; `stopReason`; `systemMessage`; `suppressOutput` |
| AfterTool | `DefaultHookOutput` + `additionalContext` + `tailToolCallRequest` | Block result; inject context; request tail call |
| BeforeAgent | `BeforeAgentHookOutput` | `additionalContext`; `stopReason`; `continue: false` |
| AfterAgent | `AfterAgentHookOutput` | `stopReason`; `continue: false`; `clearContext`; `continueReason`(触发 auto-retry) |
| BeforeModel | `BeforeModelHookOutput` | `blocked`(synthetic response); `modifiedModel`; `modifiedConfig`; `modifiedContents`; `stopped` |
| AfterModel | `AfterModelHookOutput` | `blocked`(modified response); `stopped`; `response`(替换 chunk) |
| BeforeToolSelection | `BeforeToolSelectionHookOutput` | `toolConfig`(mode + allowed names); `tools`(restricted list) |

关键模式: 每种输出都是**类型化的子类**,不是通用 `Record<string,unknown>`。这使得消费者可以安全地读取 `modifiedModel` / `syntheticResponse` / `toolConfig` 等字段。

### 1.4 Agent Loop 中的集成位置(代码引用)

```
sendMessageStream()                                     [client.ts:890-1000]
  │
  ├── fireBeforeAgentHookSafe(request, prompt_id)        [client.ts:153-205, called at :901]
  │   ├── 可 inject additionalContext → 合并入 request contents
  │   └── 可 stop → throw AgentExecutionStoppedError
  │
  └── processTurn() loop                                [geminiChat.ts]
      │
      ├── fireBeforeModelEvent({model, config, contents})             [geminiChat.ts:578]
      │   ├── blocked? → throw AgentExecutionBlockedError(syntheticResponse)
      │   ├── stopped? → throw AgentExecutionStoppedError
      │   ├── modifiedModel? → resolveModel(new model name)
      │   ├── modifiedConfig? → Object.assign(config, ...)
      │   └── modifiedContents? → replace contentsToUse
      │
      ├── fireBeforeToolSelectionEvent({model, config, contents})     [geminiChat.ts:632]
      │   ├── toolConfig? → config.toolConfig = ...
      │   └── tools? → config.tools = restricted list
      │
      ├── [Model generates response → streaming loop]
      │
      ├── fireAfterModelEvent(request, chunk)            [geminiChat.ts:925]
      │   ├── stopped? → throw AgentExecutionStoppedError
      │   ├── blocked? → throw AgentExecutionBlockedError(response)
      │   └── response? → yield hookResult.response (替代 original chunk)
      │
      └── [Per tool call] executeToolWithHooks()         [coreToolHookTriggers.ts:68-247]
          ├── fireBeforeToolEvent(toolName, toolInput, mcpContext)    [coreToolHookTriggers.ts:89]
          │   ├── shouldStopExecution()? → return stop result
          │   ├── decision: block/deny? → return block result
          │   ├── decision: ask? → fireToolNotificationEvent()
          │   └── updatedInput? → modify input params
          │
          ├── [Tool actually executes]
          │
          └── fireAfterToolEvent(toolName, toolInput, toolResponse)  [coreToolHookTriggers.ts:~160]
              ├── shouldStopExecution()?
              ├── additionalContext? → merge into response
              └── tailToolCallRequest? → schedule tail call
```

---

## 2. Nano-Agent Hooks 系统完整架构

### 2.1 核心文件与代码引用

| 文件 | 职责 | 行数 |
|------|------|------|
| `workers/agent-core/src/hooks/catalog.ts` | 18-event catalog, blocking 语义, allowedOutcomes | 266 |
| `workers/agent-core/src/hooks/dispatcher.ts` | 单 emit 入口,lookup → filter → execute → aggregate | 149 |
| `workers/agent-core/src/hooks/registry.ts` | 中央 handler 注册,source 优先级排序 | 72 |
| `workers/agent-core/src/hooks/outcome.ts` | 聚合规则: strictest-wins(stop > block > continue) | 125 |
| `workers/agent-core/src/hooks/guards.ts` | timeout(10s default) + recursion depth(max 3) 防护 | 84 |
| `workers/agent-core/src/hooks/types.ts` | HookSource/HookRuntimeKind/HookMatcherConfig 基础类型 | 38 |
| `workers/agent-core/src/hooks/permission.ts` | PermissionRequest 的 continue→allow / block→deny 转换 | 70 |
| `workers/agent-core/src/hooks/runtimes/local-ts.ts` | 进程内 TypeScript handler 执行 | 51 |
| `workers/agent-core/src/hooks/runtimes/service-binding.ts` | 远程 hook 执行(transport 接口定义,未 wired) | 153 |
| `workers/agent-core/src/host/orchestration.ts` | 在 startTurn/endSession 中 emit Setup/SessionStart/UserPromptSubmit/SessionEnd | 550 |
| `workers/agent-core/src/kernel/runner.ts` | beforeLlmInvoke/afterLlmInvoke hooks + handleToolExec/handleLlmCall/handleCompact | 437 |
| `workers/agent-core/src/host/runtime-mainline.ts` | hook.emit delegate wiring + authorizeToolPlan(直接调 RPC,不走 hook) | 870 |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` | HookDispatcher 构造 + 注入 runtime-mainline | 569 |

### 2.2 18 事件语义

```
Class A (8, unchanged from original baseline):
  SessionStart        — blocking: false,  outcomes: [additionalContext, diagnostics]
  SessionEnd          — blocking: false,  outcomes: [diagnostics]
  UserPromptSubmit    — blocking: true,   outcomes: [block, additionalContext, diagnostics]
  PreToolUse          — blocking: true,   outcomes: [block, updatedInput, additionalContext, diagnostics]
  PostToolUse         — blocking: false,  outcomes: [additionalContext, diagnostics]
  PostToolUseFailure  — blocking: false,  outcomes: [additionalContext, stop, diagnostics]
  PreCompact          — blocking: true,   outcomes: [block, diagnostics]
  PostCompact         — blocking: false,  outcomes: [additionalContext, diagnostics]

Class B (4, new in B5 expansion):
  Setup               — blocking: false,  outcomes: [additionalContext, diagnostics]
  Stop                — blocking: false,  outcomes: [diagnostics]
  PermissionRequest   — blocking: true,   outcomes: [block, additionalContext, diagnostics]
  PermissionDenied    — blocking: false,  outcomes: [additionalContext, diagnostics]

Class D (6, new in B5 expansion):
  ContextPressure              — blocking: false, outcomes: [additionalContext, diagnostics]
  ContextCompactArmed          — blocking: false, outcomes: [diagnostics]
  ContextCompactPrepareStarted — blocking: false, outcomes: [diagnostics]
  ContextCompactCommitted      — blocking: false, outcomes: [additionalContext, diagnostics]
  ContextCompactFailed         — blocking: false, outcomes: [diagnostics]
  EvalSinkOverflow             — blocking: false, outcomes: [additionalContext, diagnostics]
```

### 2.3 当前真实接线状态(关键)

| 事件 | catalog 存在? | 有 emitter? | 有 handler 注册? | 接线位置 |
|------|--------------|------------|-----------------|---------|
| Setup | ✅ | ✅ | ❌ | `orchestration.ts:238-241` — `startTurn()` 中首次 `unattached→attached` 时 emit |
| SessionStart | ✅ | ✅ | ❌ | `orchestration.ts:244-249` — `turnCount===0` 时 emit |
| SessionEnd | ✅ | ✅ | ❌ | `orchestration.ts:512-515` — `endSession()` 中 emit |
| UserPromptSubmit | ✅ | ✅ | ❌ | `orchestration.ts:250-253` — 每次 startTurn emit |
| PreToolUse | ✅ | ❌ | ❌ | **断点** — catalog 定义 blocking=true + allowedOutcomes 含 block/updatedInput,但工具授权走 `authorizeToolPlan()` 直接调 `options.authorizeToolUse` RPC(`runtime-mainline.ts:229-256`),不经过 HookDispatcher |
| PostToolUse | ✅ | ❌ | ❌ | **断点** — `runner.ts:262-335` `handleToolExec()` 没有 emit PostToolUse hook,只在 stream event 上发 tool.call.result |
| PostToolUseFailure | ✅ | ❌ | ❌ | **断点** — 同上,无 emit |
| PreCompact | ✅ | ❌ | ❌ | **断点** — `runner.ts:338-362` `handleCompact()` 直接调 `delegates.compact.requestCompact()`,不发射 PreCompact hook |
| PostCompact | ✅ | ❌ | ❌ | **断点** — 同上,compact 完成后只发 stream event compact.notify,不发射 PostCompact |
| PermissionRequest | ✅ | ❌ | ❌ | **断点** — catalog 定义 blocking=true,但无 emitter。`permission.ts` `verdictOf()` 已实现但无 caller |
| PermissionDenied | ✅ | ❌ | ❌ | **断点** — 同 PermissionRequest |
| Stop | ✅ | ❌ | ❌ | **断点** — `endSession()` 只 emit SessionEnd,不 emit Stop |
| ContextPressure→Committed→Failed (6 个) | ✅ | ❌ | ❌ | **全 6 事件断点** — catalog 全部就位,无任何 producer wired |

**结论**: 18 个事件中,只有 4 个(Setup/SessionStart/SessionEnd/UserPromptSubmit)有 emitter,其中 0 个有 handler 注册。其他 14 个事件处于 catalog-only 状态。

---

## 3. 事件比对矩阵

### 3.1 语义覆盖比对

| Gemini CLI 事件(11) | Nano-Agent 等价事件(18) | 覆盖判定 | 差距 |
|---------------------|------------------------|---------|------|
| BeforeTool | PreToolUse (Class A) | ⚠️ 部分覆盖 | nano catalog 有 PreToolUse(blocking=true, allowedOutcomes 含 block/updatedInput),语义匹配。但 **无 emitter 接线**,实际工具授权走 `authorizeToolPlan()` → `ORCHESTRATOR_CORE.authorizeToolUse` RPC 直接路径,完全不经过 HookDispatcher |
| AfterTool | PostToolUse + PostToolUseFailure (Class A) | ⚠️ 部分覆盖 | nano catalog 有 PostToolUse(additionalContext) + PostToolUseFailure(additionalContext/stop)。但 **无 emitter 接线**,runner.ts handleToolExec 不 emit |
| BeforeAgent | UserPromptSubmit (Class A) | ⚠️ 弱覆盖 | nano 有 UserPromptSubmit(blocking=true, allowedOutcomes 含 block/additionalContext)。但 Gemini CLI 的 BeforeAgent 可以 inject `additionalContext` 到 request contents;nano 的 UserPromptSubmit 虽然 blocking 但allowedOutcomes 没有 `updatedInput`,**不能修改 user prompt contents** |
| AfterAgent | 无等价事件 | ❌ 缺失 | Gemini CLI AfterAgent 可以在最后 turn 完成后 stop/block,clear context,触发 auto-retry loop。nano **完全没有** AfterAgent 概念 |
| Notification | PermissionRequest + PermissionDenied (Class B) | ⚠️ 部分覆盖 | nano 有 PermissionRequest(blocking) + PermissionDenied(observational),语义匹配 Gemini CLI 的 Notification(ToolPermission) 模式。但 **无 emitter 接线** |
| SessionStart | SessionStart (Class A) | ✅ 覆盖 | 已 emit(`orchestration.ts:244-249`) |
| SessionEnd | SessionEnd (Class A) | ✅ 覆盖 | 已 emit(`orchestration.ts:512-515`) |
| PreCompress | PreCompact (Class A) | ⚠️ 仅 catalog | nano PreCompact(blocking=true, allowedOutcomes [block,diagnostics]) 语义匹配。但 **无 emitter** — compact 路径不走 hook |
| BeforeModel | 无等价事件 | ❌ 缺失 | **关键缺口**。Gemini CLI BeforeModel 可以: (1) block → 返回 synthetic response; (2) modify model/config/contents; (3) stop agent execution。nano runner.ts 只有 `beforeLlmInvoke` hook(`runner.ts:160-162`),该 hook **仅用于 quota authorization**,不接受任何 model/config/contents 修改,也不支持 block/stop |
| AfterModel | 无等价事件 | ❌ 缺失 | **关键缺口**。Gemini CLI AfterModel 在 **每个 streaming chunk** 上触发,可以 modify response/block/stop。nano runner.ts 只有 `afterLlmInvoke` hook(`runner.ts:235-241`),该 hook **仅用于 quota commit + usage push**,不接受 response modification,也不是 per-chunk |
| BeforeToolSelection | 无等价事件 | ❌ 缺失 | **关键缺口**。Gemini CLI BeforeToolSelection 可以 filter/restrict 可用 tools,修改 toolConfig(ANY/NONE mode)。nano **完全没有** 工具选择前的干预点 |

### 3.2 Nano-Agent 特有事件(不在 Gemini CLI 语义域)

| Nano 事件 | 用途 | 当前状态 |
|-----------|------|---------|
| Setup (Class B) | actor/runtime startup,第一次 attached 前的 seam | ✅ 已 emit,无 handler |
| Stop (Class B) | graceful shutdown 前 seam | ❌ 无 emitter |
| ContextPressure (Class D) | usage 接近 ARM 阈值信号 | ❌ 无 producer |
| ContextCompactArmed/PrepareStarted/Committed/Failed (Class D) | 异步 compact 状态机 4 个 transition | ❌ 无 producer(B4 compact orchestrator 尚未接到 B5 bridge) |
| EvalSinkOverflow (Class D) | evaluator sink 溢出披露 | ❌ 无 producer(等 B6 eval-observability) |

这些事件是 nano-agent 独特的"compact lifecycle"监控面,不是与 Gemini CLI 对标缺失,而是 nano-agent 独有的扩展。但它们全部处于 catalog-only 状态。

---

## 4. 结构性差距深度分析

### 4.1 Gap #1 — BeforeModel / AfterModel 完全缺失(关键)

**这是 nano-agent 当前最大的单点缺口。**

**Gemini CLI 实现**(`geminiChat.ts:576-648`):
```typescript
// BeforeModel: 在 generateContentStream 调用前
const beforeModelResult = await hookSystem.fireBeforeModelEvent({
  model: modelToUse,
  config,
  contents: contentsToUse,
});
// → 可以 blocked(syntheticResponse) / stopped / modifiedModel / modifiedConfig / modifiedContents

// AfterModel: 在每个 streaming chunk 到达时
const hookResult = await hookSystem.fireAfterModelEvent(
  originalRequest,  // 用于 WeakMap dedup
  chunk,
);
// → 可以 stopped / blocked(modified response) / yield hookResult.response
```

**Nano-Agent 现状**(`runner.ts:150-259`):
```typescript
// beforeLlmInvoke — 仅用于 quota authorization
if (this.hooks.beforeLlmInvoke) {
  await this.hooks.beforeLlmInvoke({ snapshot, turnId });
}
// → 不接受 model/config/contents 修改;不能 block/stop

// afterLlmInvoke — 仅用于 quota commit + usage push
if (this.hooks.afterLlmInvoke) {
  await this.hooks.afterLlmInvoke({ snapshot, turnId, usage, content });
}
// → 不接受 response modification;不能 block/stop;不是 per-chunk
```

**影响**: 
- 无法实现 per-model 的安全审查(在请求发送前拦截并注入 synthetic response)
- 无法实现内容审查 hook(AfterModel per-chunk)
- 无法实现动态 model/config 修改(模型降级、temperature 调整)
- 配额推送和 hook 语义被混在同一调用点上

### 4.2 Gap #2 — BeforeToolSelection 完全缺失(关键)

**Gemini CLI 实现**(`geminiChat.ts:631-648`):
```typescript
const toolSelectionResult = await hookSystem.fireBeforeToolSelectionEvent({
  model: modelToUse,
  config,
  contents: contentsToUse,
});
// → 可以 set toolConfig(ANY/NONE/allowed_tool_names)
// → 可以 filter config.tools
```

**Nano-Agent 现状**: 无等价事件。工具列表由 `capabilityTransport.call()` 间接承载,没有在 LLM 调用前对 tools[] 进行钩子干预的 seam。

**影响**: 
- 无法实现 per-session 工具白名单(限制某些 session 只能使用 Read 不能使用 Bash)
- 无法基于上下文动态调整可用工具集
- 这与 HPX6 F10 permission_rules 的设计方向重叠 — 但 permission_rules 是 durable policy,不是 runtime hook

### 4.3 Gap #3 — AfterAgent 完全缺失(重要)

**Gemini CLI 实现**(`client.ts:210-260`):
```typescript
const hookOutput = await this.fireAfterAgentHookSafe(request, prompt_id);
// → 可以 stopReason / clearContext / continueReason(auto-retry)
// → 可以 stop → fireBeforeAgent again on retry
```

**Nano-Agent 现状**: 无 AfterAgent 事件。turn 完成后直接返回,无 hook seam。

**影响**:
- 无法实现带 hook 审查的 auto-retry loop
- 无法实现基于 hook 输出的 context clearing
- 无法在 turn 边界注入 after-action review

### 4.4 Gap #4 — PreToolUse / PermissionRequest 有 catalog 无接线(关键)

**Gemini CLI 实现**(`coreToolHookTriggers.ts:68-120`):
```typescript
const beforeOutput = await hookSystem.fireBeforeToolEvent(
  toolName, toolInput, mcpContext, originalRequestName
);
// → decision: ask|block|deny|approve|allow
// → updatedInput → modify params
// → shouldStopExecution()
```

**Nano-Agent 现状**:
1. `catalog.ts:92-97` 定义了 PreToolUse(blocking=true, allowedOutcomes: [block, updatedInput, additionalContext, diagnostics]) — **catalog 正确**
2. `catalog.ts:160-165` 定义了 PermissionRequest(blocking=true, allowedOutcomes: [block, additionalContext, diagnostics]) — **catalog 正确**
3. `permission.ts:50-57` 实现了 `verdictOf()` 将 continue→allow, block→deny — **转换层正确**
4. **但是** `runtime-mainline.ts:229-256` 的 `authorizeToolPlan()` 直接调用 `options.authorizeToolUse()` RPC,不走 HookDispatcher — **接线断点**

**代码证据**:
```typescript
// runtime-mainline.ts:229-256 — 工具授权直接走 RPC,不经过 hooks
async function authorizeToolPlan(options, requestId, toolName, toolInput) {
  const ctx = options.contextProvider();
  if (!ctx || !options.authorizeToolUse) return { allowed: true };
  const result = await options.authorizeToolUse({ ... });  // ← 直接 RPC
  if (result.decision === "allow") return { allowed: true };
  // ...
}
```

HookDispatcher 已经被注入(`runtime-assembly.ts:155-161` `createSessionHookDispatcher()`),但因为没有任何 handler 注册,且 `authorizeToolPlan()` 不走 dispatcher,整个 PreToolUse/PermissionRequest pipeline 处于"地基有但房子没盖"的状态。

### 4.5 Gap #5 — PreCompact / PostCompact 无接线

**Gemini CLI 实现**(PreCompress, `hookSystem.firePreCompressEvent()`):
```typescript
// PreCompress can block compression (manual/auto trigger)
```

**Nano-Agent 现状**: `runner.ts:338-362` `handleCompact()` 直接调 `delegates.compact.requestCompact()`,不经过 PreCompact/PostCompact hook。

### 4.6 Gap #6 — 输出类型缺失干预字段

Gemini CLI 的事件输出是**强类型子类**,携带事件特有的干预字段。nano-agent 的 `HookOutcome` 是统一的:

```typescript
// Nano-Agent (outcome.ts:27-34)
interface HookOutcome {
  readonly action: HookOutcomeAction;  // "continue" | "block" | "stop"
  readonly updatedInput?: unknown;     // 仅 PreToolUse 有效
  readonly additionalContext?: string;  // 字符串拼接
  readonly diagnostics?: Record<string, unknown>;
}

// Gemini CLI — 每个事件有不同的输出类:
class BeforeModelHookOutput {
  blocked?: boolean;
  stopped?: boolean;
  syntheticResponse?: GenerateContentResponse;  // ← nano 无
  modifiedModel?: string;                        // ← nano 无
  modifiedConfig?: Partial<GenerateContentConfig>; // ← nano 无
  modifiedContents?: Content[];                  // ← nano 无
}
class BeforeToolSelectionHookOutput {
  toolConfig?: { mode: 'ANY' | 'NONE'; allowed_tool_names: string[] }; // ← nano 无
  tools?: Tool[];                                                        // ← nano 无
}
class AfterModelHookOutput {
  blocked?: boolean;
  response?: GenerateContentResponse;  // ← nano 无(替换 chunk)
}
class AfterAgentHookOutput {
  clearContext?: boolean;              // ← nano 无
  continueReason?: string;             // ← nano 无(auto-retry)
}
```

nano-agent 的 `additionalContext` 是 plain string,无法表达 structured context injection(如 Gemini CLI 的 `{ type: "user", content: [...] }`)。

### 4.7 Gap #7 — 无 Streaming-aware AfterModel

Gemini CLI 的 AfterModel hooks 在**每个 streaming chunk** 上触发,并使用 `WeakMap`(见 `hookEventHandler.ts:58`) 去重 per-request 的失败警告。nano-agent 的 `afterLlmInvoke` 只在 LLM 调用完成后触发一次,不是 per-chunk。

### 4.8 Gap #8 — 无用户 hook 配置面

Gemini CLI 通过 `~/.gemini/settings.json` 和 `.gemini/settings.json` 支持用户/项目两层 hook 配置:

```json
{
  "hooksConfig": { "enabled": true, "disabled": [], "notifications": true },
  "hooks": {
    "BeforeTool": [
      { "matcher": "write_file", "hooks": [{ "type": "command", "command": "node hook.js" }] }
    ]
  }
}
```

nano-agent 无任何用户配置面。所有 handler 必须由代码层通过 `HookRegistry.register()` 注册。

### 4.9 Gap #9 — 无 Command 类型 runtime

Gemini CLI 支持两种 hook 类型:
1. **Command**: spawn 子进程,stdin JSON → stdout JSON,支持 timeout + SIGTERM/SIGKILL
2. **Runtime**: 进程内 async function

nano-agent 只有:
1. **local-ts**: 进程内 TypeScript handler(`runtimes/local-ts.ts`)
2. **service-binding**: 远程 hook(transport 接口定义,但实际未 wired 到 dispatcher)

不支持 command-line executable hooks,意味着用户/项目自定义 shell/python 脚本形式的 hook 完全不可能。

### 4.10 Gap #10 — 无 Matcher 过滤粒度

Gemini CLI 的 matcher 是 regex/literal,对 tool name 或 trigger string 进行匹配过滤。nano-agent 的 `HookMatcherConfig`(`types.ts:18-21`) 只有 `exact | wildcard | toolName` 三模式,不支持 regex。

---

## 5. API 能否支撑完整 Agent Loop

### 5.1 当前 agent loop 流程与 hook 介入位置

```
nano-agent agent loop(精简):
─────────────────────────────────────────────────────
startTurn()                                          [orchestration.ts:213]
  ├── emitHook("Setup")           ✅ wired (首次 attached)
  ├── emitHook("SessionStart")     ✅ wired (turnCount===0)
  ├── emitHook("UserPromptSubmit") ✅ wired (每 turn)
  ├── pushStreamEvent("turn.begin")
  └── runStepLoop()
      │
      └── advanceStep()                              [runner.ts:54]
          ├── handleLlmCall()                        [runner.ts:150]
          │   ├── beforeLlmInvoke → quota auth       ⚠️ 仅有 quota,不支持 model/config/contents 干预
          │   ├── delegates.llm.call(messages)        ← 无 BeforeModel hook!
          │   │   [per chunk]
          │   │     → pushStreamEvent("llm.delta")    ← 无 AfterModel hook!
          │   ├── afterLlmInvoke → quota commit       ⚠️ 仅有 quota push
          │   └── return { events, done: false }
          │
          ├── handleToolExec()                       [runner.ts:262]
          │   ├── authorizeToolPlan() → RPC           ← 无 PreToolUse hook! 直接调 RPC
          │   ├── delegates.capability.execute(...)    ← 无 BeforeToolSelection!
          │   │   [per chunk]
          │   │     → pushStreamEvent("tool.call.progress")
          │   │     → pushStreamEvent("tool.call.result")
          │   └── return                                ← 无 PostToolUse/PostToolUseFailure hook!
          │
          ├── handleCompact()                         [runner.ts:338]
          │   └── delegates.compact.requestCompact()   ← 无 PreCompact hook! 无 PostCompact hook!
          │
          ├── handleWait() / handleFinish()
          └── handleHookEmit()                        ← scheduler 中 hook_emit decision
```

### 5.2 断点汇总

| 断点编号 | 位置 | 问题 | 严重度 |
|---------|------|------|--------|
| **BP-1** | `runner.ts:150-259` handleLlmCall | BeforeModel/AfterModel 完全缺失 — LLM 调用前后无 hook 干预点 | **CRITICAL** |
| **BP-2** | `runner.ts:150-259` handleLlmCall | beforeLlmInvoke/afterLlmInvoke 仅承载 quota,语义与 hook 系统解耦 | HIGH |
| **BP-3** | `runner.ts:262-335` handleToolExec | PreToolUse hook catalog 存在但未接入 — 工具授权直接走 RPC | **CRITICAL** |
| **BP-4** | `runner.ts:262-335` handleToolExec | PostToolUse/PostToolUseFailure 有 catalog 无 emit | HIGH |
| **BP-5** | `runner.ts:262-335` handleToolExec | BeforeToolSelection 完全缺失 — 无工具集过滤 hook | HIGH |
| **BP-6** | `orchestration.ts:511-549` endSession | AfterAgent 完全缺失 — turn 完成后无 hook seam | HIGH |
| **BP-7** | `orchestration.ts:511-549` endSession | Stop hook 不 emit — graceful shutdown 无 seam | MEDIUM |
| **BP-8** | `runner.ts:338-362` handleCompact | PreCompact/PostCompact 有 catalog 无 emit | MEDIUM |
| **BP-9** | `outcome.ts:27-34` | HookOutcome 缺 typed intervention 字段(modifiedModel/syntheticResponse/toolConfig/clearContext) | MEDIUM |
| **BP-10** | `hooks/runtimes/` | service-binding runtime 未 wired 到 dispatcher | MEDIUM |
| **BP-11** | `hooks/types.ts` | 无 Command hook runtime(不支持外部脚本) | LOW |
| **BP-12** | 全局 | 零 handler 注册 — HookDispatcher 有,但空 registry | HIGH |
| **BP-13** | Class D 6 事件 | catalog 全就位,无任何 producer wired | MEDIUM |

### 5.3 API 支撑度判定

| 维度 | 支撑度 | 说明 |
|------|--------|------|
| HookRegistry + HookDispatcher | ✅ 已支撑 | registry 有 register/unregister/lookup/listAll + source 优先级;dispatcher 有 depth/timeout/abortSignal guard + blocking/non-blocking seq/parallel 执行 — 基础设施合格 |
| Catalog (18 events) | ⚠️ 过度设计但未落地 | 18 events 比 Gemini CLI 的 11 更多,但其中 14 个无 emitter,0 个有 handler。Catalog 是正确的,但没有与之配套的 emitter caller |
| Outcome aggregation | ⚠️ 部分支撑 | strictest-wins + allowlist validation 正确,但缺少 Gemini CLI 的 per-event 输出专化能力(modifiedModel/syntheticResponse/toolConfig/clearContext) |
| Agent loop integration | ❌ 大幅不足 | 仅 4/18 事件 wired(Setup/SessionStart/SessionEnd/UserPromptSubmit)。关键干预点(Model/ToolSelection/AfterAgent)全缺 |
| Stream-level hooks (AfterModel per-chunk) | ❌ 缺失 | beforeLlmInvoke/afterLlmInvoke 不是 per-chunk,无法实现 streaming-aware 干预 |
| User configuration surface | ❌ 缺失 | 无 settings 配置、无 CLI command、无 UI feedback |
| Handler registration | ❌ 未出发 | 0 handler registered in any runtime |

---

## 6. 修复优先级建议

### Tier 1 — 必须立即修复(HPX5/HPX6 期间)

| 优先级 | 断点 | 修复措施 | 对应 action-plan |
|--------|------|----------|-----------------|
| P0 | BP-1: BeforeModel 缺失 | 在 `runner.ts` handleLlmCall 的 LLM 调用前插入 `emitHook("BeforeModel")`,支持 block(stop)+ modify model/config | 新 HPX item |
| P0 | BP-3: PreToolUse 未接入 | 在 `runtime-mainline.ts` authorizeToolPlan 内将工具授权路径从直接 RPC 改为先走 HookDispatcher.emit("PreToolUse"),再走 authorizeToolUse fallback | HPX5 P2-01(已规划,未执行) |
| P1 | BP-5: BeforeToolSelection 缺失 | 在 capability execute 前插入工具集过滤 hook | 新 HPX item |
| P1 | BP-12: 零 handler | 至少注册一个 platform-policy handler 实现 PreToolUse allow/deny 语义,证明 pipeline 通 | HP5后续 |

### Tier 2 — 应在 hero-to-pro 阶段完成

| 优先级 | 断点 | 修复措施 |
|--------|------|----------|
| P2 | BP-2: AfterModel 缺失 | per-chunk 或 per-response AfterModel hook |
| P2 | BP-4: PostToolUse/PostToolUseFailure 接线 | 在 handleToolExec 结果处理时 emit |
| P2 | BP-6: AfterAgent 事件 | 在 runStepLoop done 分支 emit AfterAgent |
| P3 | BP-9: 输出类型增强 | 扩展 HookOutcome 支持 modifiedModel/syntheticResponse 等字段,或引入 per-event outcome 子类型 |

### Tier 3 — 留 hero-to-platform 或 polish

| 优先级 | 断点 | 修复措施 |
|--------|------|----------|
| P4 | BP-11: Command hook runtime | 支持 spawn 子进程 + stdin/stdout JSON |
| P4 | BP-12d: 用户配置面 | settings 文件 + CLI commands |
| P5 | BP-13: Class D compact lifecycle | B4 compact orchestrator bridge 到 B5 hook emitter |

---

## 7. 与 HPX5/HPX6 Action Plan 的对齐

### 7.1 HPX5 已覆盖的断点

| HPX5 item | 对应本报告断点 | 覆盖度 |
|-----------|--------------|--------|
| F1 confirmation emitter | 间接相关(BP-3 的 PreToolUse confirmation 面) | confirmation 帧 emit 通了,但 PreToolUse hook pipeline 本身未通 |
| F4 model.fallback emitter | 不直接相关 | fallback 是 stream event,不是 hook 事件 |
| P2-01 F1 confirmation emitter | 目标是在 row write 后 emit confirmation WS 帧 | 解决了 client notification 面,未解决 hook dispatch 面 |

### 7.2 HPX6 已覆盖的断点

| HPX6 item | 对应本报告断点 | 覆盖度 |
|-----------|--------------|--------|
| F9 runtime config + permission rules | 部分覆盖 BP-3/BP-5 | permission_rules 是 durable policy 层,与 hook runtime 层正交 |
| Q-bridging-7 delete legacy permission_mode | 间接相关 | 清旧路由后,permission decision 必须走新路径 |

### 7.3 HPX5/HPX6 未覆盖的断点(本报告新增)

| 断点 | HPX5 覆盖? | HPX6 覆盖? | 需新增? |
|------|-----------|-----------|---------|
| BP-1 BeforeModel 缺失 | ❌ | ❌ | ✅ 新增 |
| BP-2 AfterModel 缺失 | ❌ | ❌ | ✅ 新增 |
| BP-5 BeforeToolSelection 缺失 | ❌ | ❌ | ✅ 新增 |
| BP-6 AfterAgent 缺失 | ❌ | ❌ | ✅ 新增 |
| BP-8 PreCompact/PostCompact 无 emit | ❌ | ❌ | ✅ 新增 |
| BP-9 outcome 类型不足 | ❌ | ❌ | ✅ 新增 |

---

## 8. 总结

nano-agent 的 hooks 系统在 **基础设施层**(Registry/Dispatcher/Guards/Outcome/Catalog)已经奠定了坚实的地基,与 Gemini CLI 的架构思路(registry → planner → runner → aggregator)高度一致。但当前处于"框架有但完全无业务填充"的状态:

1. **18 事件 catalog** 覆盖了 Gemini CLI 11 事件的绝大部分语义(有额外的 compact lifecycle 6 事件),但 **14 事件无 emitter,18 事件无 handler**
2. **3 个关键干预点缺失**: BeforeModel / BeforeToolSelection / AfterAgent 在 catalog 中不存在,但在 agent loop 中是必需的
3. **PreToolUse/PermissionRequest pipeline** (catalog 正确 + permission 转换层正确 + dispatcher 已注入)是最接近"接通"的,只差 `authorizeToolPlan()` 调用 HookDispatcher 而非直接 RPC 这一行
4. **outcome 类型** 缺少 Gemini CLI 的 typed intervention 字段(modifiedModel/syntheticResponse/toolConfig),导致即使 hooks 接通也无法实现 model/config/contents/tools 的运行时修改
5. **HPX5/HPX6 主要解决的是 confirmation frame emit + permission rules durable policy**,而不是 runtime hook 的执行管道 — 两个层级的 permission 控制(durable policy + runtime hook)需要同时存在

**核心建议**: 在 HPX5 收口后、HPX6 推进前,用一个专门的 HPX item 接通 PreToolUse hook pipeline(最小可行 — 就一行改动:让 `authorizeToolPlan` 在调 RPC 前先过 HookDispatcher),以验证整个 hook 机制从头到尾是通的,然后再规划 BeforeModel/BeforeToolSelection 等干预点的接入。
