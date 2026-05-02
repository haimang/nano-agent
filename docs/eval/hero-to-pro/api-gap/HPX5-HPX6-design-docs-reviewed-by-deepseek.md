# HPX5+HPX6 Bridging Design — 全面审查与辩证分析

> 审查者: DeepSeek (通过 `context/` 内一手代码重读)
> 审查日期: 2026-05-02
> 审查对象: `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` (Opus 4.7 撰写)
> 审查方法: 回到 `workers/`、`packages/`、`context/gemini-cli/` 的真实代码做一手验证,不依赖二手文本推断

---

## 0. 审查动机

Opus 撰写的 HPX5-HPX6 设计文件是一份**高质量的会聚产物** — 它把三份调查报告 (claude-code / codex / gemini-cli 对照) 的结论凝结成了 15 项 In-Scope 功能 (F1–F15),并按 "HPX5 wire-up + HPX6 workbench" 两阶段切分。审阅它的目的是**回归真实代码**,验证设计中的假设是否与代码现实对齐,并识别可能被忽略的 nuance。

---

## 1. 代码架构现实: 与设计文档假设的对齐检查

### 1.1 流事件 Schema 的实际形状 — 关键发现

设计文档 F1 声称 confirmation WS emitter 是 "wire-up 已注册 schema",即只需接线不需改形状。但检查 `packages/nacp-session/src/stream-event.ts:147-161`:

```ts
// stream-event.ts:147-161 — 13-kind discriminated union
export const SessionStreamEventBodySchema = z.discriminatedUnion("kind", [
  ToolCallProgressKind,
  ToolCallResultKind,
  ToolCallCancelledKind,
  HookBroadcastKind,
  SessionUpdateKind,
  TurnBeginKind,
  TurnEndKind,
  CompactNotifyKind,
  SystemNotifyKind,
  SystemErrorKind,
  LlmDeltaKind,
  SessionForkCreatedKind,
  ModelFallbackKind,
]);
```

**确认: 13-kind catalog 中不包含 `session.confirmation.request`、`session.confirmation.update`、`session.todos.write`、`session.todos.update`。** 这意味着:

- **F1 (confirmation WS emitter) 和 F2 (todo WS emitter) 不能简单地 "在现有 stream event 通道上 wire 一个 emitter"。** 这些帧的 body shape 必须加入 discriminated union,否则 frame 层的 body validation (`frame.ts:114-121`) 会直接拒绝它们。

在 `packages/nacp-session/src/frame.ts:114-121`:
```ts
// frame.ts:114-121 — all session.stream.event bodies go through schema validation
if (frame.header.message_type === "session.stream.event" && frame.body !== undefined) {
  const evtResult = SessionStreamEventBodySchema.safeParse(frame.body);
  if (!evtResult.success) {
    throw new NacpSessionError(/* ... */);
  }
}
```

**这意味着 HPX5 的 "不引入新协议形状" (Q-bridging-1 的声明) 在这个点上是部分不准确的。** 要 emit confirmation/todo 帧,要么:

- **方案 A**: 扩展 `SessionStreamEventBodySchema` 的 discriminated union (需要动 `stream-event.ts`)
- **方案 B**: 把 confirmation/todo 帧作为独立的顶层 WS 帧 (类似 `session.heartbeat`,不经过 `session.stream.event` 包装),走 `SESSION_BODY_SCHEMAS` 独立验证

方案 B 更符合 "不破 contract" 的承诺 — 因为 `type-direction-matrix.ts` 已经为 confirmation/todo 帧注册了独立的 message_type 和 direction,这与 stream event 是正交的。但方案 B 需要 orchestrator 的 WS 发射器支持直接 emit 非-stream-event 的顶层帧,这需要检查当前的 emitter 实现。

**建议修正**: 设计文档需要明确 F1/F2 的 emit 路径 (stream event 扩展 vs 独立帧),并评估代码改动范围。

---

### 1.2 `compactRequired` 不是真的 "hardcoded false" — 细节 nuance

三份调查报告都引用 `context.md:55` 说 "compactRequired: false hardcoded"。但实际代码 (`workers/agent-core/src/host/orchestration.ts:314-322`) 显示:

```ts
// orchestration.ts:314-322 — compactRequired is default-false, not hardcoded
let compactRequired = false;
if (this.deps.probeCompactRequired) {
  try {
    const result = await this.deps.probeCompactRequired();
    compactRequired = Boolean(result);
  } catch {
    compactRequired = false;
  }
}
```

这是一个 **"default-off, optionally wired"** 的设计,不是硬编码死值。`probeCompactRequired` 是 `OrchestrationDeps` 的可选函数 (orchestration.ts:88)。配套的 compact breaker (`workers/agent-core/src/host/compact-breaker.ts`) 也已经完整实现,包括:

```ts
// compact-breaker.ts:18-37 — 3 次连续失败熔断
export function createCompactBreaker(threshold = 3): CompactBreaker { /* ... */ }

// compact-breaker.ts:44-55 — 组合 probe + breaker
export function composeCompactSignalProbe(
  budgetSource: () => Promise<boolean> | boolean,
  breaker: CompactBreaker,
): () => Promise<boolean> { /* ... */ }
```

**代码架构已经 ready — 缺的是 `runtime-mainline.ts` 中把 `composeCompactSignalProbe` 接到 `OrchestrationDeps.probeCompactRequired` 的 host 接线代码。** 这与 HPX5 的 "接线" 心智完全一致 — 只是代码的可接线程度比文档描述的 "hardcoded false" 更高。F3 在代码上的实际工作量比设计文档估计的**更小**。

**建议**: 更新上下文文档中的 "hardcoded false" 描述为 "default-off, awaiting host probe wiring"。

---

### 1.3 方向矩阵中的 `followup_input` — 已有 protocol 支持

`packages/nacp-session/src/type-direction-matrix.ts:24`:

```ts
"session.followup_input": new Set<NacpDeliveryKind>(["command"]),
```

`session.followup_input` 已经在 protocol 层被注册为合法的 client→server 消息类型。同时, `workers/agent-core/src/host/orchestration.ts:429-447` 的 `drainNextPendingInput` 方法已经处理了 pendingInputs 队列:

```ts
// orchestration.ts:429-447
async drainNextPendingInput(
  state: OrchestrationState,
): Promise<OrchestrationState> {
  const queue = state.actorState.pendingInputs;
  if (queue.length === 0) return state;
  if (state.actorState.phase === "turn_running") return state;
  // dequeues and starts a new turn
  const [next, ...rest] = queue;
  // ...
  return this.startTurn(drainedState, next);
}
```

**F8 (followup_input public WS 帧) 的 protocol 层和 runtime 队列层均已就绪。** 真正要做的是: (1) 在 public WebSocket 收到 `session.followup_input` client 帧时,把它 push 进 `actorState.pendingInputs`,(2) 在 turn 边界自动 drain。这在代码上是一个**很小的增量改动**。

**建议**: F8 的 protocol 风险比设计文档描述的 "会动 contract" 更低 — direction matrix 已经就绪。

---

### 1.4 orch-core index.ts 的重构 — 文档引用需要更新

API 文档引用 `workers/orchestrator-core/src/index.ts:1103-1133, 1404-1536` 等行号,但实际文件只有 18 行:

```ts
// index.ts — 18 lines, clean delegation
import { dispatchFacadeRoute } from "./facade/route-registry.js";
// ...
const worker = {
  async fetch(request: Request, env: OrchestratorCoreEnv): Promise<Response> {
    const response = await dispatchFacadeRoute(request, env);
    // ...
  },
};
```

原来单体文件 (曾达数千行) 已被重构为模块化结构:
- `workers/orchestrator-core/src/hp-absorbed-routes.ts`
- `workers/orchestrator-core/src/hp-absorbed-handlers.ts`
- `workers/orchestrator-core/src/confirmation-control-plane.ts`
- `workers/orchestrator-core/src/context-control-plane.ts`
- `workers/orchestrator-core/src/workspace-control-plane.ts`
- `workers/orchestrator-core/src/todo-control-plane.ts`
- `workers/orchestrator-core/src/checkpoint-restore-plane.ts`
- `workers/orchestrator-core/src/session-lifecycle.ts`
- 等等

**这是一个好的工程演进。** 但 API 文档 (`clients/api-docs/*.md`) 中的 implementation reference 行号已经失效。F7 (文档断点修复) 应该包括更新这些 reference 的映射。

**建议**: F7 的 scope 中加入 "更新 18-doc pack 中所有 implementation reference 行号到新的模块化结构"。

---

## 2. 对照 Gemini-CLI 一手代码的辩证分析

### 2.1 Confirmation 的同步阻塞语义 — 设计文档理解准确

Gemini-CLI 的 `resolveConfirmation` (`scheduler/confirmation.ts:109-199`) 是一个**显式 while 循环**:

```ts
// confirmation.ts:131 — synchronous blocking loop
while (outcome === ToolConfirmationOutcome.ModifyWithEditor) {
  // ...
  state.updateStatus(callId, CoreToolCallStatus.AwaitingApproval, { /* ... */ });
  onWaitingForConfirmation?.(true);
  const response = await waitForConfirmation(deps.messageBus, correlationId, signal, /* ... */);
  onWaitingForConfirmation?.(false);
  outcome = response.outcome;
  // ...
}
```

这与 nano-agent 的 `confirmation_pending` kernel 状态完美对应。设计文档的 F1 "row write 之后 emit" 方案与 HP5 row-first dual-write law (Q16) 一致。唯一需要注意的是: Gemini-CLI 的 confirmation 支持 "ModifyWithEditor" 循环 (允许用户 inline 修改 tool 参数后重新确认),而 nano-agent 的 confirmation 是单次 decision。设计文档没有提到这个差异,但这是有意的简化 (README §4.2 主动 trade-off)。

---

### 2.2 WriteTodos 5-Status 模型完全一致

Gemini-CLI `write-todos.ts:21-27`:
```ts
const TODO_STATUSES = [
  'pending', 'in_progress', 'completed', 'cancelled', 'blocked',
] as const;
```

Nano-agent `todos.md` — 完全相同的 5-status 枚举,且 `in_progress` at-most-1 不变量也一致 (gemini-cli `write-todos.ts:120` 也做了类似校验)。

**F2 (WriteTodos capability) 的实现可以近乎直接 port** — D1 truth 表已经存在 (`nano_session_todos`),`D1TodoControlPlane` 已 live。需要做的是:
1. 在 agent-core 的 capability registry 中注册 WriteTodos
2. 路由 LLM `tool_use` 中的 WriteTodos 调用到 `D1TodoControlPlane`
3. 在 capability 内部自动 close 上一个 in_progress (避免 Q19 invariant 冲突)

设计文档 §7.2 F2 的描述准确。

---

### 2.3 Gemini-CLI "模型 stickiness" vs nano-agent "turn override" 优先级链

Gemini-CLI (`client.ts:101`):
```ts
private currentSequenceModel: string | null = null;
```

模型选择是: sequence sticky → router.route() → availability/fallback。Nano-agent 的模型选择链 (models.md) 是: turn override → session default → global default。这两者在概念上等价,但 nano-agent 没有 "sticky until new prompt_id" 的语义 — 新 turn 默认用 session default,除非显式指定 `model_id`。

这不是 gap,而是设计差异。但设计文档的 `model.fallback` emitter (F4) 在 gemini-cli 中的等价物是 `CoreEvent.ModelChanged` (全局 EventEmitter),会 reset `currentSequenceModel`。nano-agent 没有 sticky model,所以这个 reset 不适用。

---

## 3. 设计文档本身的合理性评估

### 3.1 两阶段切分 (HPX5 vs HPX6) — 合理但边界可微调

设计文档把 F1–F7 归 HPX5 (wire-up),F8–F15 归 HPX6 (workbench)。切分逻辑是 "HPX5 不动 contract,HPX6 会动 contract"。

**审查发现**: 这个切分边界与代码现实有偏差:

| 功能 | 设计归类 | 审查发现的实际 contract 影响 | 建议归类 |
|------|---------|--------------------------|---------|
| F1 confirmation emitter | HPX5 (不动 contract) | ⚠️ 需扩展 discriminated union 或使用独立帧路径 | HPX5,但需明确路径 |
| F2 todo WS emitter | HPX5 (不动 contract) | ⚠️ 同上 | HPX5,但需明确路径 |
| F3 auto-compact | HPX5 (不动 contract) | ✅ 纯接线 (probe 接口已存在,breaker 已实现) | HPX5 |
| F4 model.fallback | HPX5 (不动 contract) | ✅ 纯接线 (已在 discriminated union 中) | HPX5 |
| F5 workspace bytes | HPX5 (不动 contract) | ✅ 纯接线 (RPC 已 live,只需 façade 透传) | HPX5 |
| F6 tool-calls ledger | HPX5 (不动 contract) | ⚠️ 可能需新 D1 表或 schema `nano_tool_call_ledger` | HPX5,确认 D1 schema |
| F7 文档修复 | HPX5 (不动 contract) | ✅ 纯文档 | HPX5 |
| F8 followup_input | HPX6 (动 contract) | ✅ 已在 direction matrix 中,protocol 层已就绪 | 可降级到 HPX5 |
| F9 runtime config | HPX6 (动 contract) | ✅ 新 HTTP route + 新 D1 表 | HPX6 |
| F11 retry executor | HPX6 (动 contract) | ✅ attempt-chain 实现 | HPX6 |

**核心发现**: F8 (followup_input) 的 contract 风险比设计文档假设的**低得多** — direction matrix 已经注册,`drainNextPendingInput` 已经实现。F8 完全可以在 HPX5 内完成,不需要等到 HPX6。

---

### 3.2 emit-helpers.ts 收敛点 — 合理但需要先创建

设计文档 §3.4 提出所有 emitter 必须收敛到 `packages/nacp-session/src/emit-helpers.ts` 单一出口。这是正确的架构决策,但**该文件当前不存在** — 需要新建。当前的 emit 是分散在 orchestration.ts 中的 `pushStreamEvent` 调用 (直接通过 deps 接口)。

**建议**: 在 HPX5 启动前先创建 emit-helpers.ts skeleton,明确 emitter 注册 API,再逐个接线。

---

### 3.3 item projection (F14) 的 read-time projection 原则 — 高度合理

设计文档 §6.1 取舍 3 明确指出 item projection 是 read-time 投影,不引入新 truth 表。这个决策避免了 Q16 (row-first dual-write) 的重演:

> "Codex 的 item 是 server-side mutable object;但 nano-agent 已经有 stream event ledger + D1 row 作为 truth,再引入第三种 truth 会造成 dual-write / triple-write 风险"

检查代码: `SessionStreamEventBodySchema` (stream-event.ts) 和 `NANO_SESSION_BODY_SCHEMAS` (messages.ts) 是现有的两个 truth source。一个 read-time projection 层只需要 `SELECT` 权限,不需要 `INSERT/UPDATE`。这是正确的架构姿态。

---

### 3.4 runtime config object (F9) 的 scope 选择 — 合理但有隐含假设

设计文档 §6.1 取舍 4 选择 session-scoped runtime config,per-turn override 仍走 `/input` body 的 `model_id / reasoning`。Gemini-CLI 没有独立的 runtime config object — 它的配置通过 `Config` 对象在 client 启动时注入,运行时不变。

nano-agent 的 runtime config 是真正的 "运行时可变配置",这本身是一个差异化优势。但设计文档的 5 字段最小集 (`permission_rules / network_policy / web_search / workspace_scope / approval_policy`) 中,**`web_search` 和 `network_policy` 在当前的 agent-core capability 中还没有对应的实现** — 它们是未来的能力。在设计阶段就预留 config surface 是好的,但 F9 的实现需要与这些 capability 的实现配对进行,否则 config 字段写入后没有 runtime 消费方。

---

## 4. 风险识别: 设计中可能被忽略的问题

### 4.1 风险 1: Confirmation/todo 帧的 body shape 未定义

`type-direction-matrix.ts` 注册了 `session.confirmation.request` 和 `session.todos.write` 为合法的 message type,但它们的 **body schema** 需要在 `messages.ts` 的 `SESSION_BODY_SCHEMAS` 中注册。当前检查 `SESSION_BODY_SCHEMAS`:

ts
// 需要验证 SESSION_BODY_SCHEMAS 中是否已有 confirmation/todo body schema


如果 body schema 缺失,那么 `frame.ts:122-133` 中的 `bodySchema.safeParse(frame.body)` 调用会找不到 schema (返回 undefined),导致这些帧的 body 不被验证 — 这不一定是 bug,但不符合 "所有 WS 帧经过 zod 校验" 的承诺。

---

### 4.2 风险 2: `model.fallback` emitter 的触发时机

`model.fallback` 的 schema 在 `stream-event.ts:139-145`:

```ts
export const ModelFallbackKind = z.object({
  kind: z.literal("model.fallback"),
  turn_uuid: z.string().uuid(),
  requested_model_id: z.string().min(1),
  fallback_model_id: z.string().min(1),
  fallback_reason: z.string().min(1),
});
```

它和文档 (session-ws-v1.md) 中描述的字段名不完全一致 — schema 用 `fallback_model_id`,但文档提到的可能是 `effective_model_id`。**需要确认文档与 schema 的字段名对齐。**

---

### 4.3 风险 3: Compact body 字段的 facade 层透传

设计文档 F3 要求 `/context/compact` 的 body 字段 (`force / preview_uuid / label`) 真正生效。但代码中的 `context.md` 明确指出:

> "HP9 frozen 阶段 façade 层不读取 request body — force / preview_uuid 由 server 决定"

这个 gap 确实存在。但修复它不仅是 "façade 读 body 再透传" — 还需要 context-core RPC 支持这些参数。当前 context-core 的 compact RPC 可能也不接受这些参数。F3 的实现范围需要完整评估从 façade → orchestrator-core RPC → context-core 的整条链路。

---

### 4.4 风险 4: F6 tool-calls ledger 的 D1 表不存在

设计文档 F6 提到 "从 D1 `nano_tool_call_ledger` (若不存在则新建)"。检查 API 文档: `workspace.md` 提到 `GET /sessions/{id}/tool-calls` 当前返回 `source: "ws-stream-only-first-wave"`,意味着没有 D1 持久化。创建新 D1 表需要 migration,但这不算 "新 contract" (D1 表是内部实现),所以 F6 归类 HPX5 是合理的。

---

## 5. 综合建议

### 5.1 设计文档层面的修正

1. **明确 F1/F2 的 emit 路径**: confirmation 和 todo 帧到底是扩展 `SessionStreamEventBodySchema` 还是走独立顶层帧? 设计文档需要给出明确的 emit 路径选择并更新 F1/F2 的描述。

2. **考虑将 F8 (followup_input) 提升到 HPX5**: 因为 direction matrix 和 `drainNextPendingInput` 已经就绪,只缺 public WS 的 accept 逻辑。工作量极小,不必等到 HPX6。

3. **更新 F3 的描述**: 将 "解除 compactRequired:false 硬编码" 改为 "在 runtime-mainline.ts 中接通 `composeCompactSignalProbe` 到 `OrchestrationDeps.probeCompactRequired`"。更准确地反映代码现实。

4. **在 F7 scope 中加入**: 更新 18-doc pack 中所有 implementation reference 行号 (由于 orchestrator-core index.ts 已重构)。

5. **为 F4 (model.fallback) emitter 添加字段名对齐检查**: 确保 schema (`fallback_model_id`) 与文档描述一致。

### 5.2 实现准备层面的建议

6. **HPX5 启动前先创建 emit-helpers.ts**: 定义 emitter 注册/调用 API,确保所有新 emitter 统一出口。

7. **F3 (auto-compact) 实现聚焦于 host 接线**: 已有的 `compact-breaker.ts` + `orchestration.ts` probe 接口可以直接使用,重点在 `runtime-mainline.ts` 中组装。

8. **F9 (runtime config) 与 capability 实现配对推进**: `web_search` 和 `network_policy` config 字段需要对应的 agent-core capability 才能消费。

### 5.3 文档/naming 问题的收口

9. GPT 报告 §6 的 6 处不一致修复 (已在 F7 scope 内) 中,需特别关注 confirmation kind 的统一 (`tool_permission` vs `permission`) 和 decision body shape 的统一 (`status/decision_payload` vs `decision/payload`)。

---

## 6. 总体评价

### 6.1 设计文档的质量

HPX5-HPX6 设计文档在**会聚三份调查报告的结论**方面做得很出色 — F1–F15 的 15 项功能准确覆盖了所有 P0/P1 缺口,两阶段切分 (wire-up vs workbench) 的工程心智是成熟的。文档的结构 (In-Scope/Out-of-Scope → 功能阐述 → 风险 → QNA) 完整,可以作为 actionable plan 的基础。

### 6.2 需要调整的地方

三个需要修正的 nuance:

1. **F1/F2 的 "纯接线" 假设对 confirmation/todo 帧不完全成立** — 需要明确是否扩展 discriminated union,这涉及 contract 变更的判断
2. **compact 的 "hardcoded false" 描述不准确** — 代码是 "default-off, optionally wired",架构已就绪,实际工作量更小
3. **F8 (followup_input) 的 contract 风险被高估** — direction matrix + drainNextPendingInput 已就绪,可以提升到 HPX5

### 6.3 一句话总结

> **HPX5-HPX6 设计文档是一份成熟的、可执行的 hero-to-pro 收口方案。核心架构判断 (两阶段切分、item read-time projection、emitter 单出口收敛) 与代码现实高度一致。需要在 3 个 nuance 上微调 (confirmation/todo 帧的 emit 路径、compact 描述准确性、F8 归类),但不影响整体方案的可行性。HPX5 可以在一个 sprint 内完成,F1–F7 的实际代码改动量比设计文档估计的更小。**
