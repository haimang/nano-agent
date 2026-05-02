# HPX5-HPX6 设计文档评审报告

> 评审者: Kimi (k2p6)  
> 日期: 2026-05-02  
> 评审对象: `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` (Opus 4.7 起草)  
> 输入来源:
> - `docs/eval/hero-to-pro/api-gap/claude-code-compared-by-opus.md`
> - `docs/eval/hero-to-pro/api-gap/codex-compared-by-GPT.md`
> - `docs/eval/hero-to-pro/api-gap/gemini-cli-compared-by-deepseek.md`
> - 一手代码扫描: `workers/`, `packages/`, `context/claude-code/`, `context/codex/`, `context/gemini-cli/`

---

## 0. 方法论声明

本评审**不依赖二手文本推断**。所有关于 claude-code、codex、gemini-cli 的代码引用均来自 `context/` 目录下真实源码的直接读取;所有关于 nano-agent 现状的引用均来自 `workers/` 与 `packages/` 下真实源码的直接读取。

---

## 1. 执行摘要

**总评**: Opus 的设计文档在"会聚共识"层面做得极为出色，将三份报告的 P0/P1 缺口归纳为 15 项 In-Scope 功能(F1-F15)，并给出了清晰的两阶段切分(HPX5 wire-up + HPX6 workbench)。但文档在若干关键点上存在**对实现难度的低估**、**对 schema 现状的误判**、以及**对风险缓解的过度乐观**。本报告将逐点指出，并给出修正建议。

**最高优先级修正建议**:
1. `session.confirmation.request/.update` 的 WS 帧 schema **尚未冻结**在 `stream-event.ts` 中，HPX5 必须先补 schema 再接线——这与文档"不动 contract"的声明矛盾。
2. `followup_input` 在 `session-bridge.ts` 的 `SessionAction` 枚举中**根本不存在**，HPX6 需要动 contract 的程度比文档承认的更深。
3. `item projection` 层需要新增 3 种 WS 帧 + 2 条 HTTP 路由，其"read-time 投影"的实现复杂度被低估——当前没有从 stream event ledger 反查 D1 的 infrastructure。
4. `runtime config object` 与现有 `permission_mode` 4 档的共存策略文档中未给出迁移路径，存在 breaking change 风险。

---

## 2. HPX5 逐功能评审: 真实代码 vs 设计宣称

### 2.1 F1: Confirmation WS Emitter Wire-up

**设计宣称**: "不引入新协议形状,只把 emitter 接到真实 runtime 上" (§0.2)。

**一手代码发现**:

```typescript
// packages/nacp-session/src/stream-event.ts (line 147-161)
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

**问题**: `session.confirmation.request` 和 `session.confirmation.update` **不在** `SessionStreamEventBodySchema` 的 discriminated union 中。虽然 `type-direction-matrix.ts:37-38` 注册了这两个 message_type 的合法性:

```typescript
// packages/nacp-session/src/type-direction-matrix.ts (line 37-38)
"session.confirmation.request": new Set<NacpDeliveryKind>(["event"]),
"session.confirmation.update": new Set<NacpDeliveryKind>(["event"]),
```

但 `stream-event.ts` 的 union 是 WS 帧实际通过 zod 校验的入口。 confirmation 帧若要成为"server → client event"，必须要么:
- 加入 `SessionStreamEventBodySchema`(即成为 `session.stream.event` 的 body)，或
- 成为独立的 WS message type(类似 `session.heartbeat` / `session.update`)。

当前设计文档§7.2 F1 说"row write 之后 emit 帧"，但未明确 emit 到哪个 channel。如果是 `session.stream.event` channel，则必须改 `SessionStreamEventBodySchema`——这是**contract 变更**，与 §0.2 "不引入新协议形状"矛盾。

**建议**:
- 明确 confirmation 帧走独立 message type(`session.confirmation.request`) 还是 stream event body。
- 若走独立 type，需确认 `nano-session-do.ts` 的 `emitServerFrame` 是否已支持非-stream-event 的 frame emit。
- 若走 stream event，必须 bump `nacp-session` 包的 schema 并发布新版本——这构成 contract 变更。

### 2.2 F2: WriteTodos Capability + WS Emitter

**设计宣称**: "agent-core kernel 暴露 WriteTodos;实现复用 HP6 已 live 的 `D1TodoControlPlane`" (§7.2 F2)。

**一手代码发现**:

```typescript
// workers/orchestrator-core/src/todo-control-plane.ts (line 79-150)
export class D1TodoControlPlane {
  constructor(private readonly db: D1Database) {}
  async list(...) { ... }
  async read(...) { ... }
  private async readActiveInProgress(...) { ... }
  // ... create, update, delete
}
```

`D1TodoControlPlane` 确实存在且功能完整。但 **agent-core kernel 中没有任何 capability 注册表或工具调用路由指向 todo plane**。`runtime-mainline.ts` 的 `CapabilityTransportLike` 接口存在，但当前仅用于外部 RPC 调用，没有内部 capability 自调用机制。

更关键的是，WriteTodos 作为"LLM 可调用的 tool"，需要:
1. 在 LLM 的 tool schema 中注册 `write_todos` 函数定义;
2. 在 tool execution 路径中把 `write_todos` 路由到 `D1TodoControlPlane`;
3. 在 tool result 中把 D1 写入结果格式化为 LLM 可读的文本。

当前文档仅说"复用 D1TodoControlPlane"，未涉及 tool schema 注册和路由——这不是简单的"接线"，而是**新增 capability 的完整实现链**。

**建议**:
- 将 F2 拆分为: (a) tool schema 注册 + (b) tool execution 路由 + (c) WS emitter 接线。
- (a) 和 (b) 的复杂度与"新增一个 tool"等价，不应被归入"wire-up"心智。

### 2.3 F3: Auto-compact Runtime Trigger

**设计宣称**: "解除 `compactRequired:false` 硬编码;触发 `context-core.executeCompact` RPC" (§7.2 F3)。

**一手代码发现**:

```typescript
// workers/agent-core/src/host/orchestration.ts (line 314-325)
let compactRequired = false;
if (this.deps.probeCompactRequired) {
  try {
    const result = await this.deps.probeCompactRequired();
    compactRequired = Boolean(result);
  } catch {
    compactRequired = false;
  }
}
const signals = {
  hasMoreToolCalls: pendingToolCalls.length > 0,
  compactRequired,
  // ...
};
```

```typescript
// workers/agent-core/src/kernel/scheduler.ts (line 49-52)
// Priority 3: compaction needed
if (signals.compactRequired) {
  return { kind: "compact" };
}
```

```typescript
// workers/agent-core/src/host/compact-breaker.ts (line 44-56)
export function composeCompactSignalProbe(
  budgetSource: () => Promise<boolean> | boolean,
  breaker: CompactBreaker,
): () => Promise<boolean> {
  return async () => {
    if (!breaker.canCompact()) return false;
    try {
      return Boolean(await budgetSource());
    } catch {
      return false;
    }
  };
}
```

**评估**: 这里的实现成熟度**超出设计文档的预期**。`compact-breaker.ts` 已经实现了 circuit breaker(HP3-D4);`scheduler.ts` 已经处理 `compact` decision;`orchestration.ts` 已经预留了 `probeCompactRequired` dep。真正的缺口只有两个:
1. `runtime-mainline.ts` 的 `compactSignalProbe` 未被实际传入 `SessionOrchestrator` 的 deps;
2. `budgetSource` 需要接入 `context-core.previewCompact` 或等效的 token 探针。

**建议**:
- F3 确实是"接线"工程，但需明确: 当前不是"硬编码 `false`"的问题，而是"dep 未传入"的问题。
- 文档应更新对 `compact-breaker.ts` 已有实现的引用，避免重复设计 circuit breaker。

### 2.4 F4: Model.fallback WS Emitter

**设计宣称**: "agent-core 在 fallback 决策点 emit `model.fallback`" (§7.2 F4)。

**一手代码发现**:

```typescript
// packages/nacp-session/src/stream-event.ts (line 139-145)
export const ModelFallbackKind = z.object({
  kind: z.literal("model.fallback"),
  turn_uuid: z.string().uuid(),
  requested_model_id: z.string().min(1),
  fallback_model_id: z.string().min(1),
  fallback_reason: z.string().min(1),
});
```

`ModelFallbackKind` **已经**在 `SessionStreamEventBodySchema` 中(union 的最后一个成员)。这意味着 schema 是冻好的，emitter 未接是纯粹的实现缺口。

**评估**: 这是 HPX5 中最接近"纯接线"的功能。但需注意: `requested_model_id / effective_model_id / fallback_reason` 三字段需要 agent-core 在 model resolution 路径中**同时持有**这三项信息。当前 `runtime-mainline.ts` 的 model resolution 逻辑是否已暴露这三项，需要进一步确认。

**建议**: 保持 F4 在 HPX5，但需在 action-plan 中明确"从 model resolution 路径提取三字段"的具体代码位置。

### 2.5 F5: Workspace Bytes GET

**设计宣称**: "`GET /sessions/{id}/workspace/files/{*path}/content` (binary profile, 25 MiB cap)" (§7.2 F5)。

**一手代码发现**:

```typescript
// workers/orchestrator-core/src/hp-absorbed-routes.ts (line 248-269)
if (route.kind === "read") {
  const file = await plane.readByPath({...});
  if (!file) { return 404; }
  return Response.json(
    {
      ok: true,
      data: {
        session_uuid: route.sessionUuid,
        virtual_path: normalized,
        r2_key: r2Key,
        metadata: file,
        content_source: "filesystem-core-leaf-rpc-pending",
      },
      trace_uuid: traceUuid,
    },
    { status: 200 },
  );
}
```

当前 workspace `read` 返回的是 **JSON metadata**，不是 binary content。设计文档建议新增 `/content` 子路由，这与现有 artifact bytes 路由(`/sessions/{id}/files/{uuid}/content`)形状一致。

**关键缺口**: `filesystem-core` 的 RPC 接口中是否有 `readTempFile` 方法? 当前 `session-files.ts` 中只有 `readArtifact`:

```typescript
// workers/orchestrator-core/src/facade/routes/session-files.ts (line 152-161)
if (typeof fs.readArtifact !== "function") { ... }
const result = await fs.readArtifact(
  { team_uuid, session_uuid, file_uuid },
  meta,
);
```

workspace temp file 的 R2 key 格式与 artifact 不同(`buildWorkspaceR2Key` vs artifact uuid)。若 `filesystem-core` 没有 `readTempFile` RPC，则 F5 需要先扩 RPC 接口——这超出了"façade 接线"的范畴。

**建议**:
- 明确 `filesystem-core` 是否已有 `readTempFile` RPC;若没有，F5 需要 filesystem-core 的改动，不应视为纯 HPX5 wire-up。
- 考虑复用 `readArtifact` 的 RPC 形状但传入不同的 key 类型，减少 cross-worker 改动。

### 2.6 F6: Tool-calls Ledger 真实化

**设计宣称**: "`GET /sessions/{id}/tool-calls` 真实读 D1;新增 `GET /tool-calls/{request_uuid}` detail" (§7.2 F6)。

**一手代码发现**:

```typescript
// workers/orchestrator-core/src/hp-absorbed-routes.ts (line 158-170)
if (route.kind === "list") {
  return Response.json(
    {
      ok: true,
      data: {
        session_uuid: route.sessionUuid,
        tool_calls: [],
        source: "ws-stream-only-first-wave",
      },
      trace_uuid: traceUuid,
    },
    { status: 200 },
  );
}
```

当前返回空数组。设计文档说"从 D1 `nano_tool_call_ledger` 读取"，但 **该表在 migration 中不存在**。tool call 的信息目前仅存于 WS stream event 中(由 `runtime-mainline.ts` 的 `onToolEvent` 推送)，没有 D1 persistence。

**严重问题**: F6 要求"真实读 D1"，但前提是**先创建 D1 表 + 修改 agent-core 在 tool execution 时写入 D1**。这不是"wire-up"，是"新增 persistence 层"。

**建议**:
- 将 F6 从 HPX5 移至 HPX6，或至少拆分为:(a) 创建 D1 tool_call_ledger 表 + 写入逻辑;(b) HTTP 路由读取逻辑。
- 若坚持留在 HPX5，需承认这是"新增 truth 表"而非"wire-up"，并评估对现有 tool execution 性能的影响(每次 tool call 增加一次 D1 write)。

### 2.7 F7: 文档断点修复

**设计宣称**: "D1–D7 + GPT §6.1–6.6 共 13 处修齐" (§7.2 F7)。

**评估**: 这是三份报告会聚度最高的领域，也是风险最低的。但需注意:
- `confirmation decision body` 从 `decision/payload` 到 `status/decision_payload` 的 dual-accept 策略，需要改 `session-control.ts:385-396` 的解析逻辑:

```typescript
// workers/orchestrator-core/src/facade/routes/session-control.ts (line 385-396)
const status = body.status;
if (!isConfirmationStatus(status)) {
  return jsonPolicyError(400, "invalid-input", "status must be one of...", traceUuid);
}
const decisionPayloadRaw = body.decision_payload;
```

当前代码只接受 `status`，不接受 legacy `decision`。dual-accept 需要在这里加入 fallback 逻辑。

**建议**: F7 是纯粹的文档+小代码修改，可以安全留在 HPX5。但需在 action-plan 中列出每个断点的具体文件位置。

---

## 3. HPX6 逐功能评审: Workbench 扩展的深层问题

### 3.1 F8: Followup_input WS Frame

**设计宣称**: "暴露 `session.followup_input` 为 public WS client→server frame(`{text}` only)" (§7.2 F8)。

**一手代码发现**:

```typescript
// packages/nacp-session/src/type-direction-matrix.ts (line 24)
"session.followup_input": new Set<NacpDeliveryKind>(["command"]),
```

```typescript
// workers/orchestrator-core/src/facade/routes/session-bridge.ts (line 14-33)
type SessionAction =
  | "start"
  | "input"
  | "cancel"
  | "close"
  | "delete"
  | "title"
  | "status"
  | "timeline"
  | "history"
  | "verify"
  | "ws"
  | "usage"
  | "resume"
  | "messages"
  | "retry"
  | "fork"
  | "permission/decision"
  | "policy/permission_mode"
  | "elicitation/answer";
```

**问题**: `followup_input` **不在** `SessionAction` 枚举中。这意味着:
1. HTTP façade 没有路由接收 `followup_input`;
2. `session-bridge.ts` 的 `dispatchDoSessionRoute` 不会把它转发到 User DO;
3. 即使 WS 帧到达，NanoSessionDO 也没有 handler。

更深层的问题: `orchestration.ts:429` 的 `drainNextPendingInput()` 已经实现了 pending input queue 的 drain，但**queue 的入口仅在 `startTurn` 时接收 HTTP `input`/`messages`**。要让 `followup_input` 在 turn_running 阶段入队，需要:
- 在 NanoSessionDO 的 WS message handler 中新增 `session.followup_input` 分支;
- 在 `actor-state.ts` 的 pendingInputs 队列中追加(而非替换当前 turn);
- 在 turn end 后由 `drainNextPendingInput()` 消费。

**建议**:
- 明确承认 F8 需要新增 HTTP route + WS handler + actor state 变更，这不是"把已冻协议提升到 public"，而是**新增端到端链路**。
- 考虑 F8 与 F11(retry)的交互: followup_input 和 retry 都影响 pending input queue 的语义，需在 HPX6 设计阶段统一建模。

### 3.2 F9+F10: Runtime Config Object + Permission Rules

**设计宣称**: "`GET/PATCH /sessions/{id}/runtime` + `RuntimeConfigSchema`" (§7.2 F9); "`runtime.permission_rules[]`" (§7.2 F10)。

**一手代码发现**:

```typescript
// context/codex/sdk/typescript/src/threadOptions.ts (line 9-20)
export type ThreadOptions = {
  model?: string;
  sandboxMode?: SandboxMode;
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: ModelReasoningEffort;
  networkAccessEnabled?: boolean;
  webSearchMode?: WebSearchMode;
  webSearchEnabled?: boolean;
  approvalPolicy?: ApprovalMode;
  additionalDirectories?: string[];
};
```

```typescript
// context/claude-code/types/permissions.ts (line 15-79)
export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits', 'bypassPermissions', 'default', 'dontAsk', 'plan',
] as const
export type PermissionBehavior = 'allow' | 'deny' | 'ask'
export type PermissionRule = {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}
```

**问题**: 设计文档的 `RuntimeConfigSchema` 只取 5 字段(`permission_rules`, `network_policy`, `web_search`, `workspace_scope`, `approval_policy`)，但 Codex 的 `ThreadOptions` 有 10 字段，Claude Code 的 permission 模型有 5 种 mode + rule source 层级。

更关键的是，nano-agent 当前有 `permission_mode` 4 档(`auto-allow/ask/deny/always_allow`)，分布在:
- `session-bridge.ts` 的 `"policy/permission_mode"` action;
- `session-truth.ts` 的 D1 schema;
- agent-core 的 `canUseTool` 等价逻辑。

引入 `runtime.permission_rules[]` 后，**必须定义与 `permission_mode` 的优先级规则**。文档 §6.2 风险表中提到 "rule 优先级高于 mode"，但没有给出具体实现策略:
- 是否 deprecate `permission_mode`?
- 若保留，D1 中需要同时存 `permission_mode` 和 `permission_rules` 吗?
- PATCH runtime 时是否允许同时修改两者?

**建议**:
- 在 HPX6 设计中加入 `permission_mode` → `approval_policy` 的迁移策略。
- 明确 `runtime config` 的 D1 表设计:是新建 `nano_session_runtime_config` 表，还是扩展 `nano_conversation_sessions`?
- 参考 Claude Code 的 `PermissionRuleSource` 分级(`userSettings`/`projectSettings`/`localSettings`)，评估 nano-agent 是否需要 `scope: session|tenant` 之外的层级(如 `team`)。

### 3.3 F11-F13: Retry / Restore / Fork Executor

**设计宣称**: retry "创建真实 attempt-chain"(§7.2 F11); restore "drive status to terminal"(§7.2 F12); fork "drive lineage 完整建立"(§7.2 F13)。

**一手代码发现**:

```typescript
// workers/orchestrator-core/src/facade/routes/session-control.ts (line 233-294)
if (route.kind === "restore") {
  const restoreJobs = new D1CheckpointRestoreJobs(db);
  const restoreJob = await restoreJobs.openJob({
    checkpoint_uuid: route.checkpointUuid,
    session_uuid: route.sessionUuid,
    mode,
    confirmation_uuid: confirmationUuid,
    target_session_uuid: null,
  });
  return Response.json({ ok: true, data: { restore_job: restoreJob }, ... }, { status: 202 });
}
```

当前 restore 仅创建 pending job，没有 executor。**executor 的实现需要跨多个 worker 的协调**:
- `orchestrator-core` 创建 job row;
- 某个 worker(可能是 alarm 或 queue consumer)需要 poll job 并执行 R2 复制 + D1 更新;
- 执行完成后需要 emit WS 帧到 target session。

设计文档说"executor 走已冻的 `nano_session_checkpoints` + `nano_checkpoint_restore_jobs`"，但**这些表只有 schema，没有 executor 的运行时**。在 Cloudflare Workers 中，executor 通常用:
- Durable Object alarm(但 alarm 有 30s 执行限制);
- Queue consumer(需要 binding);
- Cron trigger(不适合 session-scoped job)。

**建议**:
- 明确 executor 的运行时模型:是用 DO alarm、Queue、还是新的 Durable Object?
- 评估 30s alarm 限制对 restore executor 的约束(R2 复制大量文件可能超时)。
- 将 F11-F13 的 executor 设计从 HPX6 进一步拆分:先设计 executor runtime 架构，再实现具体 retry/restore/fork。

### 3.4 F14: Item Projection 层

**设计宣称**: "read-time 投影,不引入新 truth 表" (§7.2 F14); "7 类 item" (§5.1 S14)。

**一手代码发现**:

```typescript
// context/codex/sdk/typescript/src/items.ts (line 119-127)
export type ThreadItem =
  | AgentMessageItem
  | ReasoningItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | TodoListItem
  | ErrorItem;
```

Codex 的 ThreadItem 有 8 类，设计文档的 item projection 有 7 类(`agent_message / reasoning / tool_call / file_change / todo_list / confirmation / error`)。设计文档把 `command_execution` 和 `mcp_tool_call` 合并为 `tool_call`，把 `web_search` 排除在外(O3)。这是合理的简化。

**但实现层面的问题被严重低估**:

1. **没有 stream event ledger 的持久化**: 当前 WS stream event 是 ephemeral 的，仅通过 `last_seen_seq` 做 reconnect 回放，没有长期存储。item projection 要求"从 stream event ledger + D1 truth 投影"，但 stream event ledger **不存在**。

2. **`GET /items?cursor=` 的性能**: 若 item 来自 D1 多表 join(message + tool_call + todo + confirmation + file_change)，cursor-based pagination 的查询复杂度很高。设计文档说"cursor scan 不全表"，但未给出具体 SQL 策略。

3. **WS `session.item.{started,updated,completed}` 帧**: 这需要新增 3 种 WS message type，且需要在每个 source event 产生时做 item 映射。例如 `tool.call.result` 产生时要同时 emit `session.item.updated` + `session.item.completed`——这是**dual-emit**，与 HP5 的 row-first dual-write law 有相似的复杂性。

**建议**:
- 将 F14 拆分为:(a) item HTTP API(read-time projection);(b) item WS 帧族。
- (a) 可以基于现有 D1 表实现，但需承认性能风险;(b) 需要新增 WS frame schema + emitter，复杂度接近 F1。
- 考虑是否先实现 HTTP API，WS 帧在 hero-to-platform 阶段补充。

### 3.5 F15: File_change Item 与 Emitter

**设计宣称**: "LLM 写 workspace 文件时 emit `file_change` item" (§7.2 F15)。

**评估**: F15 依赖 F5(workspace bytes GET)和 F14(item projection)。若 F5 发现 filesystem-core 缺少 `readTempFile` RPC，则 F15 的 `size_delta / content_hash` 计算也无从谈起。

**建议**: F15 应与 F5 绑定在同一个 action-plan 中，并明确 filesystem-core RPC 的扩展范围。

---

## 4. 跨阶段结构性问题

### 4.1 "Wire-up" vs "Design" 的边界模糊

设计文档 §0.2 明确定义 HPX5 = "接线"、HPX6 = "协议扩展"。但实际情况:
- F1(confirmation emitter)需要补 schema → 是 design;
- F2(WriteTodos)需要新增 capability 链 → 是 design;
- F6(tool-calls ledger)需要新增 D1 表 → 是 design。

这三项都不应被归为"wire-up"。**建议重新评估 HPX5/HPX6 切分**:
- 真正的 wire-up(纯接线,不动 schema,不新增表): F3(auto-compact dep 传入), F4(model.fallback emitter), F7(文档修复)。
- 需要 schema/contract 变动的: F1, F2, F5, F6。
- 需要新增对象模型的: F8-F15。

### 4.2 Emitter 聚合到单一出口的可行性

设计文档 §3.4 要求"所有 wire-up emitter 必须收敛到 `packages/nacp-session/src/emit-helpers.ts` 单一出口"。

**一手代码发现**: `emit-helpers.ts` **不存在**。当前 emitter 分散在:
- `orchestration.ts` 的 `pushStreamEvent`(内部使用);
- `runtime-mainline.ts` 的 `onToolEvent` / `onUsageCommit`(callback 式);
- 各 façade route handler 的 `Response.json`(HTTP 平面)。

新建 `emit-helpers.ts` 并把所有 emitter 收敛进去，需要重构现有代码——这在"低风险快收口"的 HPX5 中引入额外风险。

**建议**:
- 若 `emit-helpers.ts` 是新建文件，应作为 HPX5 的 infrastructure 任务，而不是所有 emitter 的强制迁移。
- 优先保证 F1/F4 的 emitter 在新文件中实现，现有 emitter 的迁移可 deferred。

### 4.3 Polling Fallback 的双轨策略

设计文档 §6.1 取舍 5 选择保留 polling fallback。但当前 confirmation 的 HTTP plane 是 live 的，polling 已有基础设施。真正的问题是:**WS emitter 接通后，polling 是否还需要在文档中作为"reconcile fallback"被推荐?**

**评估**: 是的。WS reconnect 窗口确实有事件丢失风险。但文档需要明确:
- 前端**必须**实现 dedup(confirmation_uuid 全局唯一);
- polling 的推荐频率应从"1.5-3s"降低到"仅在 reconnect 后一次性拉取"。

---

## 5. 与参照系的对比校准

### 5.1 Claude Code: Confirmation 阻塞语义

```typescript
// context/claude-code/query.ts (line 560-568)
const useStreamingToolExecution = config.gates.streamingToolExecution
let streamingToolExecutor = useStreamingToolExecution
  ? new StreamingToolExecutor(
      toolUseContext.options.tools,
      canUseTool,
      toolUseContext,
    )
  : null
```

Claude Code 的 `canUseTool` 是同步阻塞点，且与 `StreamingToolExecutor` 深度集成。nano-agent 的 confirmation 是异步 HTTP decision，这导致:
- 不支持"用户修改 tool 参数后重试"(Claude Code 的 `ModifyWithEditor` 语义);
- 不支持 streaming tool execution(O10 out-of-scope)。

**评估**: 设计文档正确识别了这些不在 scope 内。但需在前端文档中明确说明 confirmation 的"fire-and-forget"语义，避免前端开发者期望 Claude Code 级别的交互深度。

### 5.2 Codex: Item Projection 的成功与代价

Codex 的 `ThreadItem` 是 server-side 可变对象，有明确的 `id` 和生命周期。nano-agent 设计文档选择"read-time projection"来避免引入第三种 truth——这符合 nano-agent 的架构哲学。

**但代价是**: 前端无法像 Codex 那样对 item 做 stable reference。例如用户点击一个 tool_call item 后，如果底层 stream event 被 compact 掉，该 item 的 `id` 可能失效。

**建议**: 在 F14 的设计中明确 item_uuid 的稳定性保证。若 item_uuid 来自 source row 的 uuid，则需保证 source row 不被删除(只做 soft delete 或 archive)。

### 5.3 Gemini-CLI: Auto-compact 阈值 vs MessageBus

```typescript
// context/gemini-cli/packages/core/src/context/chatCompressionService.ts (line 41)
const DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5;
```

设计文档 F3 采用 0.85 阈值，显著高于 Gemini-CLI 的 0.5。这意味着 nano-agent 的 auto-compact 触发更晚，留给前端更多"手动 compact"的窗口——这与 nano-agent 把 compact 视为"runtime 责任"而非"客户端责任"的目标一致。

但 Gemin-CLI 的 `ChatCompressionService` 还包含 `COMPRESSION_PRESERVE_THRESHOLD = 0.3` 和 `COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET = 50_000` 等精细策略。设计文档 F3 的"阈值触发"过于简化，未涉及:
- 压缩后保留最近多少比例的历史?
- function response 的 token budget 如何处理?
- 压缩失败后的 fallback(截断 vs 报错)?

**建议**: F3 的 action-plan 应包含压缩策略的详细参数，而非仅"解除硬编码"。

---

## 6. 风险评估与缓解建议(修正版)

| 风险 | 设计文档评级 | 本评审修正评级 | 原因 | 缓解建议 |
|------|-------------|---------------|------|----------|
| F1 confirmation emitter race with polling | 中 | **高** | schema 未冻，需补 contract | 先补 `stream-event.ts` schema，再 emit;明确走独立 message type 还是 stream event body |
| F2 WriteTodos at-most-1 invariant 冲突 | 中 | **高** | LLM 可能频繁调用，auto-close 逻辑复杂 | 在 capability 层加入 queue，而非简单 auto-close |
| F3 auto-compact mid-turn 触发 | 低 | **低** | 文档已明确 turn-boundary 触发 | 保持现有设计 |
| F5 workspace bytes R2 延迟 | 低 | **中** | filesystem-core RPC 可能不存在 | 先验证 `readTempFile` RPC 存在性 |
| F6 tool-calls ledger D1 写入性能 | 未列 | **高** | 每次 tool call 增加 D1 write | 考虑 batch write 或 async fire-and-forget |
| F8 followup_input queue 语义 | 中 | **高** | 与 retry/cancel 的交互未定义 | 在 actor-state.ts 中定义清晰的 state machine |
| F9 runtime config 与 permission_mode 冲突 | 中 | **高** | 并存策略未定义 | 明确 deprecation timeline;dual-read 一个版本 |
| F12 restore executor 30s alarm 限制 | 中 | **高** | R2 复制可能超时 | 用 Queue consumer 替代 DO alarm |
| F14 item projection 性能退化 | 中 | **高** | 多表 join + cursor pagination | 先物化到单表或限制 history depth |

---

## 7. 总体价值判断与优先级重排

### 7.1 对设计文档价值评级的修正

| 维度 | 文档评级 | 修正评级 | 修正理由 |
|------|---------|---------|----------|
| 核心定位贴合度 | 5 | **4** | 部分 F1/F2/F6 超出"wire-up"范畴，若强行归入 HPX5 会 dilute "纯接线"心智 |
| 第一版实现性价比 | 5 | **3** | HPX5 真正的纯接线只有 F3/F4/F7;F1/F2/F5/F6 都需要 cross-worker 改动 |
| 未来演进杠杆 | 4 | **4** | 保持不变;auto-compact 和 runtime config 确实 unlock 长 session 和 multi-tenant |
| 开发者友好度 | 5 | **4** | 文档对"哪些已 live、哪些 pending"的描述准确，但低估了前端在 HPX5 后仍需写 fallback 的时间 |
| 风险可控程度 | 4 | **3** | F6/F12/F14 的风险在设计文档中被低估;executor runtime 模型未定义 |
| **综合价值** | 5 | **4** | 仍是 hero-to-pro 的关键设计，但需要 HPX5/HPX6 的重新切分和更保守的 scope |

### 7.2 优先级重排建议

**真正的 P0(阻断级,必须 hero-to-pro 完成)**:
1. F1 补 confirmation schema + emitter(F1 的 schema 缺口是真实的 contract 断点)
2. F3 auto-compact dep 传入 + threshold 参数化(最接近纯接线，ROI 最高)
3. F4 model.fallback emitter(纯接线，schema 已冻)
4. F7 文档断点修复(零风险，提升前端开发速度)

**P1(重要级,可延至 HPX6 早期)**:
5. F2 WriteTodos capability(需要新增 tool schema + execution 路由，不是接线)
6. F5 workspace bytes GET(依赖 filesystem-core RPC 扩展)
7. F8 followup_input WS frame(需要新增 HTTP route + WS handler)
8. F9 runtime config object(需要 D1 表设计 + migration)

**P2(高级功能,明确归入 HPX6)**:
9. F6 tool-calls ledger(需要新增 D1 persistence)
10. F10 permission rules(依赖 F9 的 runtime config 基础设施)
11. F11 retry executor(需要 executor runtime 模型)
12. F12 restore executor(需要跨-worker job scheduling)
13. F13 fork executor(同 F12)
14. F14 item projection(需要 stream event ledger 或物化表)
15. F15 file_change emitter(依赖 F5 + F14)

---

## 8. 可操作建议

### 8.1 立即行动(本周)

1. **确认 `emit-helpers.ts` 的架构**: 如果新建，定义其接口(输入: zod schema + payload + sessionUuid;输出: WS emit 或 system.error fallback)。不要强制迁移现有 emitter。
2. **明确 F1 的 schema 路径**: 在 `stream-event.ts` 中新增 `SessionConfirmationRequestKind` 和 `SessionConfirmationUpdateKind`，并加入 `SessionStreamEventBodySchema` union;或在 `type-direction-matrix.ts` 中确认独立 message type 的可行性。
3. **审计 filesystem-core RPC**: 确认 `readTempFile` 方法是否存在;若不存在，评估是扩展 RPC 还是复用 `readArtifact` 形状。

### 8.2 HPX5 Action-plan 修正(冻结前)

- **In-Scope**: F3, F4, F7
- **Conditionally In-Scope**: F1(若 schema 补完在一周内可完成), F5(若 filesystem-core RPC 已存在)
- **Moved to HPX6**: F2, F6(均需新增 capability/persistence，非接线)

### 8.3 HPX6 Action-plan 扩展(设计阶段)

- 新增 "Executor Runtime Architecture" 子设计:明确 DO alarm vs Queue vs Cron 的选择。
- 新增 "Stream Event Ledger Persistence" 子设计:为 F14 的 read-time projection 提供数据来源。
- 新增 "Permission Mode Migration" 子设计:定义 `permission_mode` → `approval_policy` 的 deprecation timeline。

### 8.4 文档修正

- §0.2 "HPX5 = 接线"的声明需加限定:"HPX5 以接线为主，但 F1/F5 可能涉及 schema/RPC 的小幅扩展"。
- §3.4 "聚合到 emit-helpers.ts"需改为"新建 emit-helpers.ts 作为推荐出口，现有 emitter 的 deferred migration"。
- §6.2 风险表需加入 F6 D1 write 性能风险和 F12 alarm 超时风险。
- §7.2 F6 的"真实读 D1"需改为"先创建 D1 tool_call_ledger 表，再实现读取路由"。

---

## 9. 结论

Opus 的 HPX5-HPX6 设计文档是一份**高质量的会聚分析**，成功地将三份独立调查报告的共识转化为可执行的功能清单。但其核心缺陷在于**对"wire-up"范畴的过度乐观**: 真正的纯接线工程(F3/F4/F7)仅占 15 项功能的 20%，其余功能均涉及 schema 补充、capability 新增、D1 表扩展或 executor 运行时设计——这些不应被"wire-up"的标签所掩盖。

本评审建议:**收缩 HPX5 至真正的纯接线子集(F3/F4/F7 + 条件性 F1/F5)，将 F2/F6 移至 HPX6，并在 HPX6 中优先定义 executor runtime 架构和 stream event ledger persistence**——这两项基础设施是 F11-F14 的共同前提。

只有如此，nano-agent 才能从"chat-first 后端"稳健地升级为"agent loop workbench 后端"，而不是在 hero-to-pro 的最后阶段承担未被识别的 design debt。

---

*评审结束。所有代码引用均来自一手源码读取，未依赖二手文本推断。*
