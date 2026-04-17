# Cross-Package E2E Test Suite 01

> 版本: `v0.2`
> 日期: `2026-04-17`
> 作者: `Kimi`
> 范围: `packages/*` 全 10 包跨包集成
> 更新说明: `根据 GPT 审查意见进行 API reality refresh，修正过时的公共 API 引用，补充 4 个关键 E2E 场景，并标注 phase-gated 依赖项`
> 依据:
> - `context/mini-agent/mini_agent/agent.py` (单 agent 核心循环)
> - `context/codex/codex-rs/core/src/codex.rs` (turn loop + compact + rollout)
> - `context/claude-code/query.ts` (streaming + reactive compact + tool budget)
> - `test/*.test.mjs` (现有 **8** 份协议契约测试)
> - `docs/action-plan/*.md` + `docs/design/*.md` (各包 action-plan 与设计目标)

---

## 0. 综述

本文件定义 nano-agent MVP skeleton 在 **Wave 4 完成后** 应建立的跨包 E2E 测试矩阵。

现有 `test/*.test.mjs` 已经验证了**协议契约层**（nacp-core schema 与各包子系统 builder 的兼容性），但尚未覆盖**真实执行链路**（一个用户输入如何穿透 kernel → llm → tool → hook → workspace → observability → session stream）。

本 test suite 的目标不是“再写一遍单测”，而是利用 `context/` 中三个成熟 agent CLI 的真实执行线路，反推出 nano-agent 10 个包之间**必须被验证的端到端数据流**。

### 0.1 设计原则

1. **一测一链**: 每个 E2E 测试对应一条从 context/ 中提取的真实执行链路。
2. **fake but faithful**: LLM 与外部网络使用 fake delegate / mock fetcher，但数据流必须穿过真实包的公共 API。
3. **observable**: 每个测试必须能断言中间产物（stream events、trace events、checkpoint fragments、artifact refs）。
4. **reproducible**: 不依赖随机性（`Math.random()` 必须被 seed/mock 替代）。
5. **value-tied**: 每个测试必须对应一个业务价值维度（上下文管理、Skill、稳定性之一）。

### 0.2 与现有 root test 的关系

| 现有 root test | 已覆盖内容 | 本 suite 补什么 |
|----------------|------------|----------------|
| `capability-toolcall-contract.test.mjs` | capability-runtime ↔ nacp-core schema | 真实的 tool execution loop（LLM 发起 → capability 执行 → kernel 消费） |
| `hooks-protocol-contract.test.mjs` | hooks ↔ nacp-core/nacp-session schema | 真实的 blocking hook 在 turn 中短路 tool 执行 |
| `kernel-session-stream-contract.test.mjs` | kernel runtime events → nacp-session stream | 从真实 step loop 生成事件并流经 eval-observability sink |
| `llm-wrapper-protocol-contract.test.mjs` | llm-wrapper ↔ nacp-session + retry/rotate | 从 kernel 驱动 LLM 请求 + artifact context 注入 |
| `observability-protocol-contract.test.mjs` | eval inspector + audit codec | 真实 session 执行后 trace 的 durable promotion 与 timeline 回放 |
| `session-do-runtime-contract.test.mjs` | orchestrator + checkpoint round-trip | 真实 turn 在 DO lifecycle 中的持久化与恢复 |
| `storage-topology-contract.test.mjs` | key builders + evidence calibration | 真实运行数据驱动 placement 策略调整 |
| `workspace-context-artifacts-contract.test.mjs` | ArtifactRef ↔ NacpRef + compact boundary | 真实 workspace mount + artifact promotion + prepared artifact 链路 |

### 0.3 Phase-Gated 标注说明

每个 E2E 测试会带一个 readiness tag：

- **`ready`**: 可以在当前公共 API 上直接实现，无需等待新的组装层代码。
- **`phase-gated`**: 方向正确，但依赖尚未完全冻结的 runtime glue（如 Worker fetch routing、WS accept、ingress 消息族扩展），需要等 session-do-runtime / nacp-session 再收口一轮后才能完整执行。

---

## 1. 从 context/ 提炼的执行链路

### 1.1 mini-agent 核心循环 (`agent.py:321-519`)

```python
while step < max_steps:
    _summarize_messages()           # compact/token management
    response = llm.generate(...)    # LLM call
    messages.append(assistant_msg)
    if not tool_calls: return
    for tc in tool_calls:
        result = tool.execute(...)  # tool execution
        messages.append(tool_msg)
```

**对应 nano-agent 的价值**: 单线程 agent loop 的可预期性、cancel 后消息一致性。

### 1.2 codex turn loop (`codex.rs:6134-`)

```rust
run_turn():
    run_pre_sampling_compact()      # compact boundary
    skill_injections()              # skill/context assembly
    user_prompt_submit_hooks()      # blocking hooks
    llm_sampling()                  # stream + tool calls
    handle_output_items()           # post-sampling hooks
    tool_execution()
    rollout_recording()             # observability + durable transcript
```

**对应 nano-agent 的价值**: compact 成为正式生命周期、skill 与 hook 的可治理性、rollout 可回放。

### 1.3 claude-code query loop (`query.ts:241-`)

```typescript
while (true):
    applyToolResultBudget()         # large result → ref replacement
    snip / microcompact             # proactive compact
    llm_streaming()                 # stream events
    runTools()                      # tool orchestration
    handleStopHooks()               # stop/abort hooks
    reactiveCompact()               # post-turn compact
```

**对应 nano-agent 的价值**: 大对象不内联、上下文分层管理、流式体验、自动 compact 的稳定性。

---

## 2. E2E 测试矩阵

### E2E-01: Full Turn — Input → Kernel → LLM → Tool → Result → Stream
> **readiness**: `ready`

#### 2.1 真实来源
- **mini-agent**: `agent.py:343-501` (run loop: LLM → tool execute → tool msg)
- **codex**: `codex.rs:6134-` 中 sampling request → tool execution 路径
- **claude-code**: `query.ts` 中 LLM streaming → `runTools()` 路径

#### 2.2 跨包列表
`agent-runtime-kernel` → `llm-wrapper` → `capability-runtime` → `hooks` → `eval-observability` → `nacp-session`

#### 2.3 功能簇集合
- **kernel**: `KernelRunner.advanceStep()` + `scheduleNextStep()`
- **llm-wrapper**: `LLMExecutor.execute()` with fake fetcher (mock OpenAI-compatible response that emits a tool call)
- **capability-runtime**: `CapabilityExecutor.execute()` with `LocalTsTarget`
- **hooks**: `HookDispatcher.emit("PreToolUse")` + `PostToolUse`
- **eval-observability**: `TraceSink.emit()` + `SessionInspector`
- **nacp-session**: `SessionStreamEventBodySchema` validation on kernel-generated bodies

#### 2.4 测试场景
1. 构造一个 user prompt: `"List files in /workspace"`。
2. Fake LLM 返回 assistant message + `tool_use` (function: `ls`, args: `{ path: "/workspace" }`)。
3. Kernel step scheduler 识别 `tools_pending` 信号，将控制交回 Session DO / test harness。
4. Test harness 调用 `CapabilityExecutor` 执行 `ls`，获得 `["file1.txt", "file2.txt"]`。
5. `PreToolUse` hook 被触发（非 blocking），`PostToolUse` hook 在工具完成后触发。
6. Trace sink 收集到 `llm.request`, `tool.call.request`, `tool.call.result` 三类事件。
7. Kernel 将结果 reinject 到 turn state，生成 `tool.call.result` stream event。
8. 断言:
   - `SessionStreamEventBodySchema.safeParse(streamBody).success === true`
   - `SessionInspector` 无 rejection
   - `TraceSink` 中 `tool.call.result` 的 `durationMs > 0`
   - kernel 的 `TurnState.phase` 从 `llm_pending` → `tools_pending` → `complete`

#### 2.5 对应价值
- **稳定性**: 验证单 turn 内 LLM → tool → result 的闭环不会因为包边界而断裂。
- **Skill**: capability runtime 的 fake-bash 命令面作为 skill 的 v1 载体被完整驱动。

#### 2.6 结果报告
- **通过标准**: 8 条断言全部成立，stream event 通过 nacp-session schema 校验。
- **失败分析**: 若 `SessionStreamEventBodySchema` 校验失败，说明 kernel event → stream mapping 与 nacp-session reality 漂移；若 hook 未触发，说明 hook dispatcher 与 kernel step loop 接线断裂；若 trace 缺失，说明 eval-observability sink 未被 kernel delegates 调用。

---

### E2E-02: Blocking Hook Short-Circuits Tool Execution
> **readiness**: `ready`

#### 2.1 真实来源
- **codex**: `codex.rs:6297-6310` (`run_user_prompt_submit_hooks` 返回 `should_stop`)
- **claude-code**: `query.ts` 中 hooks 的 `CanUseToolFn` 与 stop/recovery 逻辑
- **mini-agent**: `agent.py:90-121` (cancel event 清理未完成消息的模式可类比)

#### 2.2 跨包列表
`hooks` → `agent-runtime-kernel` → `capability-runtime` → `nacp-session` → `eval-observability`

#### 2.3 功能簇集合
- **hooks**: `HookDispatcher.emit("PreToolUse")` with blocking handler that returns `block`
- **kernel**: step loop 在 `tools_pending` 前检查 hook outcome，遇到 `block` 则中断 turn
- **capability-runtime**: tool 被短路，实际不执行
- **nacp-session**: 生成 `hook.broadcast` stream event + `system.notify` (block reason)
- **eval-observability**: audit record 中记录 `hook.block` 事件

#### 2.4 测试场景
1. 注册一个 blocking `PreToolUse` handler，规则: 若 `tool_name === "curl"` 则 `action: "block"`。
2. Kernel 驱动 turn，fake LLM 请求调用 `curl https://example.com`。
3. `HookDispatcher.emit("PreToolUse", ...)` 被顺序执行，blocking handler 命中并返回 block。
4. Kernel 收到 `AggregatedHookOutcome` 的 `finalAction === "block"`，跳过 capability 执行。
5. Kernel 生成 `hook.broadcast` (kind) 与 `system.notify` (severity=error, message=block reason)。
6. Turn 结束，状态为 `attached` (而非 `turn_running` 持续)。
7. 断言:
   - `curl` 对应的 `CapabilityPlan` 从未进入 `CapabilityExecutor`
   - stream events 中包含 `hook.broadcast`
   - audit trace 中包含 `tool.call.blocked` 或等价的 hook audit entry
   - `SessionStreamEventBodySchema` 对两种 event 均验证通过

#### 2.5 对应价值
- **稳定性**: 安全/策略 hook 能在最外层（Session DO / kernel）生效，避免 tool 已经执行后再补拦截。
- **Skill**: skills 可通过 hook 注册安全 guard，这是 skill 平台化的前提。

#### 2.6 结果报告
- **通过标准**: tool 未执行、stream events 与 audit 完整记录 block 决策。
- **失败分析**: 若 tool 仍被执行，说明 kernel step loop 未正确消费 hook outcome；若缺少 `hook.broadcast`，说明 `hookEventToSessionBroadcast` 未在 block 路径被调用。

---

### E2E-03: Context Compact Boundary — Strip → Summary Ref → Reinjection
> **readiness**: `ready`

#### 2.1 真实来源
- **codex**: `codex.rs:6152-6161` (`run_pre_sampling_compact`) + `compact.rs` archive
- **claude-code**: `query.ts:365-` (`getMessagesAfterCompactBoundary`, reactive compact)
- **mini-agent**: `agent.py:180-259` (`_summarize_messages` 保留 user message、摘要中间段)

#### 2.2 跨包列表
`agent-runtime-kernel` → `workspace-context-artifacts` → `storage-topology` → `nacp-core` → `eval-observability`

#### 2.3 功能簇集合
- **kernel**: `InterruptReason.compact-required` + compact delegate 调用
- **workspace-context-artifacts**: `CompactBoundaryManager.buildCompactRequest()` / `applyCompactResponse()` + `pickSplitPoint()`
- **storage-topology**: `R2_KEYS.compactArchive()` + `buildR2Ref()` (summary ref 构造)
- **nacp-core**: `ContextCompactRequestBodySchema` / `ContextCompactResponseBodySchema` 验证
- **eval-observability**: compact 事件作为 `durable-audit` trace

#### 2.4 测试场景
1. 构造一个 session，包含 8 条 message（4 turn），总 token 超过 compact 阈值。
2. Kernel scheduler 输出 `compact-required` 信号。
3. Test harness 调用 `CompactBoundaryManager.buildCompactRequest({ historyRef, messages, targetTokenBudget: 2000 })`。
4. `pickSplitPoint(messages, 2000)` 按 `tokenEstimate` / `content.length` 启发式计算分割点。
5. 模拟 compact worker 返回 `ContextCompactResponseBody`:
   - `status: "ok"`
   - `summary_ref` 指向 R2 archive (`tenants/{teamUuid}/sessions/{sess}/archive/0-3.jsonl`)
   - `tokens_before: 120`, `tokens_after: 32`
6. `applyCompactResponse(currentMessages, response, summaryRef, "0-3")` 返回 `[boundaryMarker, ...recentMessages]`。
7. 新的 message list 被 reinject 回 kernel，`session:messages` checkpoint 只保留 boundary marker + recent。
8. 断言:
   - compact 后的 messages 长度 = `1 (boundary) + len(recent)`
   - `summaryRef.key` 以 `tenants/{team_uuid}/` 开头（符合 storage-topology 约束）
   - `NacpRefSchema.safeParse(toNacpRef(summaryRef)).success === true`
   - `ContextCompactRequestBodySchema` 与 `ContextCompactResponseBodySchema` 的 nacp-core schema 验证通过
   - eval trace 中包含 `compact.notify` event

#### 2.5 对应价值
- **上下文管理**: compact 是 nano-agent 长期价值的核心；此测试验证 compact 不是“黑盒删历史”，而是可追踪的 formal stage。
- **稳定性**: resume 时能从 boundary marker 恢复上下文，而不是丢失旧 turn。

#### 2.6 结果报告
- **通过标准**: 消息结构符合 `boundary + recent` 模式，ref 合法，trace 完整，split point 按 token budget 计算而非简单对半分。
- **失败分析**: 若 `summaryRef` 不通过 `NacpRefSchema`，说明 workspace-context-artifacts 的 `ArtifactRef` 仍未对齐 nacp-core；若 compact 后 message 数量不对，说明 `applyCompactResponse` 的 reinject 逻辑有误；若 `pickSplitPoint` 忽略 budget，说明 compact 边界仍为 count-based stub。

---

### E2E-04: Large Tool Result Promotion → Artifact Ref → Workspace Snapshot
> **readiness**: `ready`

#### 2.1 真实来源
- **claude-code**: `query.ts:379-388` (`applyToolResultBudget` 大结果替换为引用)
- **codex**: `codex.rs` 中 tool output truncation / rollout archive 模式
- **mini-agent**: `agent.py:487-490` (结果截断预览，但未做 ref 提升)

#### 2.2 跨包列表
`capability-runtime` → `workspace-context-artifacts` → `storage-topology` → `session-do-runtime` → `eval-observability`

#### 2.3 功能簇集合
- **capability-runtime**: `CapabilityResult` size 超过 `INLINE_RESULT_MAX_BYTES`
- **workspace-context-artifacts**: `shouldPromoteResult()` + `promoteToArtifactRef(teamUuid, content, mimeType, artifactKind, { idFactory })`
- **storage-topology**: `validateRefKey()` 校验 artifact ref 的 tenant 前缀
- **session-do-runtime**: `SessionCheckpoint` 中的 `workspaceFragment` 字段收录 artifact ref
- **eval-observability**: `buildToolAttribution()` 将 artifact 加入 trace evidence

#### 2.4 测试场景
1. `CapabilityExecutor` 执行 `rg` 搜索，返回 100KB 的文本结果（超过 `INLINE_RESULT_MAX_BYTES = 64KB`）。
2. `shouldPromoteResult(result, "text/plain")` 返回 `promote: true`。
3. `promoteToArtifactRef("team-1", result, "text/plain", "document", { idFactory: () => "art-001" })` 生成 `ArtifactRef`:
   - `kind: "do-storage"` (若 ≤1MB) 或 `"r2"` (若 >1MB)
   - `binding: "SESSION_DO"` 或 `"WORKSPACE_R2"`
   - `team_uuid: "team-1"`
   - `key: "tenants/team-1/artifacts/document/art-001"`
   - `role: "attachment"`
   - `content_type: "text/plain"`
   - `size_bytes: 100_000`
   - `artifactKind: "document"`
4. `storage-topology` 的 `validateRefKey({ kind: ref.kind, team_uuid: ref.team_uuid, key: ref.key })` 返回 `true`。
5. `InMemoryArtifactStore` 注册该 artifact，`WorkspaceSnapshotBuilder.buildFragment()` 将其纳入 `artifactRefs`。
6. 构造 `SessionCheckpoint`，其 `workspaceFragment` 包含该 artifact ref。
7. 断言:
   - `ref.size_bytes > 64_000`
   - 若结果 >1MB，则 `ref.kind === "r2"` 且 `ref.binding === "WORKSPACE_R2"`
   - `ref.key.startsWith("tenants/team-1/")` 为 true
   - `NacpRefSchema.safeParse(toNacpRef(ref)).success === true`
   - `WorkspaceSnapshotFragment.artifactRefs` 包含该 ref
   - trace event 中 `resultSizeBytes` 与 `ref.size_bytes` 一致

#### 2.5 对应价值
- **上下文管理**: 大工具结果不污染 LLM 上下文和 transcript，是 artifact-first 路径的根基。
- **Skill**: skills 产生的大输出（如日志搜索、测试报告）需要统一 promotion 语义。

#### 2.6 结果报告
- **通过标准**: promotion 触发、ref 合法、snapshot 收录、trace 有 size 记录。
- **失败分析**: 若 `promoteToArtifactRef` 生成的 key 不以 `tenants/` 开头，说明 workspace-context-artifacts 与 storage-topology 约束脱节；若 snapshot 未收录，说明 `WorkspaceSnapshotBuilder` 未实际消费 artifact store。

---

### E2E-05: Session Resume — Checkpoint → Restore → Continue Turn
> **readiness**: `ready`

#### 2.1 真实来源
- **codex**: `codex-rs/thread-store/types.rs:47-72` (`ResumeThreadRecorderParams` / `LoadThreadHistoryParams`)
- **claude-code**: 无显式 resume（但 session storage 与 context 水合逻辑类似）
- **mini-agent**: 无持久化 resume（纯内存）— 作为**反例**说明为何需要 checkpoint

#### 2.2 跨包列表
`session-do-runtime` → `agent-runtime-kernel` → `workspace-context-artifacts` → `storage-topology` → `nacp-session`

#### 2.3 功能簇集合
- **session-do-runtime**: `buildSessionCheckpoint()` / `restoreSessionCheckpoint()` 公共 seams
- **agent-runtime-kernel**: `restoreCheckpoint()` 水合 `KernelSnapshot`
- **workspace-context-artifacts**: `WorkspaceSnapshotBuilder.restoreFragment()` 重建 mount configs + artifact refs
- **storage-topology**: checkpoint 中 storage key 与 ref 的 version 校验
- **nacp-session**: `ReplayBuffer.checkpoint()` / `restore()` seq 连续性

#### 2.4 测试场景
1. 一个已结束 turn 的 session:
   - `actorState.phase = "attached"`
   - `turnCount = 2`
   - kernel snapshot 中有 3 步历史 + 1 个 compact boundary
   - workspace snapshot 中有 2 个 artifact refs + 1 个 mount config (`/workspace` → memory backend)
   - replay buffer checkpoint 中 `main` stream 的 `baseSeq = 12`，events 长度 = 8
2. `buildSessionCheckpoint(sessionUuid, teamUuid, phase, turnCount, usageSnapshot, fragmentProviders)` 生成完整 `SessionCheckpoint`。
3. `validateSessionCheckpoint(checkpoint)` 返回 true。
4. 模拟 hibernation → wake:
   - `restoreSessionCheckpoint(checkpoint, { restoreKernel, restoreReplay, restoreWorkspace, restoreHooks })`
   - 在 `restoreReplay` 回调中调用 `ReplayBuffer.restore(replayFragment)`
   - 在 `restoreWorkspace` 回调中调用 `WorkspaceSnapshotBuilder.restoreFragment(workspaceFragment)`
5. 用户发送新 prompt `"Continue"`。
6. Kernel 从 restored state 开始新 turn，`turnCount` 变为 3。
7. 断言:
   - 恢复后 `actorPhase === "attached"`
   - `turnCount === 2` (恢复时)，新 turn 开始后为 `3`
   - workspace namespace 能列出 `/workspace` 下的文件（mount 已恢复）
   - `ReplayBuffer` 经 `checkpoint()` round-trip 后，`replay("main", 12)` 能返回原始 events
   - `SessionStreamEventBodySchema` 对新 turn 的 `turn.begin` event 验证通过

#### 2.5 对应价值
- **稳定性**: DO hibernation 与 resume 是 Cloudflare-native agent 的核心差异化能力。
- **上下文管理**: resume 后上下文（workspace + kernel + replay）不丢失，用户无感继续对话。

#### 2.6 结果报告
- **通过标准**: checkpoint 可 round-trip，resume 后新 turn 正常执行，replay 连续性可验证。
- **失败分析**: 若 workspace mount 未恢复，说明 `WorkspaceSnapshotBuilder.restoreFragment` 或 session-do 的接线未闭环；若 replay seq 不一致，说明 `ReplayBuffer.checkpoint()` / `restore()` 与 session-do checkpoint 格式脱节。

---

### E2E-06: Cancel Mid-Turn → Cleanup Incomplete Messages → Resume
> **readiness**: `ready`

#### 2.1 真实来源
- **mini-agent**: `agent.py:90-121` (`_check_cancelled()` + `_cleanup_incomplete_messages()`)
- **codex**: `codex.rs` 中 `CancellationToken` 与 turn abort 路径
- **claude-code**: `query.ts` 中的 abort/continue 恢复逻辑

#### 2.2 跨包列表
`session-do-runtime` → `agent-runtime-kernel` → `capability-runtime` → `eval-observability`

#### 2.3 功能簇集合
- **session-do-runtime**: `orchestrator.cancelTurn()` (通过 public seam 调用)
- **agent-runtime-kernel**: `InterruptReason.cancel` + 清理 assistant + 悬空 tool results
- **capability-runtime**: cancel 后 inflight tool 被中断
- **eval-observability**: cancel 事件作为 `durable-audit` trace

#### 2.4 测试场景
1. Turn 开始，fake LLM 返回 assistant msg + 2 个 tool calls (`read_file`, `long_running_task`)。
2. Kernel 进入 `tools_pending`，开始执行第一个 tool `read_file`。
3. 在第二个 tool `long_running_task` 执行前，调用 `cancelTurn()`。
4. kernel 收到 cancel signal。
5. Kernel 清理:
   - 删除最后一条 assistant message
   - 删除已完成的 `read_file` tool result（若未完成则一并删除）
   - 保留 `read_file` 之前的所有历史
6. Turn 结束，actor state 回到 `attached`。
7. 用户发送新 prompt，新 turn 从干净状态开始。
8. 断言:
   - cancel 后 messages 中无 assistant message（含 tool_calls）
   - 无 dangling tool result（即没有 tool result 缺少对应 assistant tool_call）
   - trace 中包含 `turn.interrupted` 或 `session.cancel` 事件
   - 新 turn 的 `turn.begin` 正常生成

#### 2.5 对应价值
- **稳定性**: 用户可随时安全中断 agent，不会留下不一致的消息状态。
- **上下文管理**: cancel 后历史保持干净，不会污染后续 turn。

#### 2.6 结果报告
- **通过标准**: cancel 后消息结构一致，新 turn 可正常开始。
- **失败分析**: 若 assistant message 未被清理，说明 kernel 的 cancel cleanup 未实现 mini-agent 的“只删未完成”模式；若存在 dangling tool result，说明消息对齐逻辑有 bug。

---

### E2E-07: Workspace File Operations via Capability Runtime Mount Router
> **readiness**: `ready`

#### 2.1 真实来源
- **just-bash**: `src/fs/mountable-fs/mountable-fs.ts:181-220` (`routePath()` 最长前缀匹配)
- **mini-agent**: `agent.py:61-66` (workspace_dir 创建与路径解析)
- **codex**: `codex-rs/exec-server/src/sandboxed_file_system.rs:28-240` (sandbox-aware FS routing)

#### 2.2 跨包列表
`capability-runtime` → `workspace-context-artifacts` → `session-do-runtime`

#### 2.3 功能簇集合
- **capability-runtime**: fake-bash filesystem handlers (`pwd`, `ls`, `cat`, `write`, `mkdir`, `rm`, `mv`, `cp`)
- **workspace-context-artifacts**: `WorkspaceNamespace` + `MountRouter` + `MemoryBackend`
- **session-do-runtime**: `SessionOrchestrator` 将 capability result 路由回 stream event

#### 2.4 测试场景
1. Session harness 初始化 workspace namespace，mount `/workspace` 到 `MemoryBackend` (writable)。
2. 用户发送命令序列（通过 `SessionOrchestrator.startTurn()` 或等价的 test harness entry）：
   - `mkdir /workspace/src`
   - `write /workspace/src/main.ts "console.log('hello')"`
   - `cat /workspace/src/main.ts`
   - `ls /workspace`
3. `CapabilityExecutor` 将 bash command 解析为 capability plan，调用 `workspace-context-artifacts` namespace 操作。
4. `MemoryBackend` 实际读写文件，`MountRouter` 将 `/workspace/src/main.ts` 路由到 `/workspace` mount，relative path = `src/main.ts`。
5. `cat` 和 `ls` 的结果通过 kernel → nacp-session → stream event 返回客户端。
6. 断言:
   - `ls /workspace` 返回 `["src"]`
   - `cat /workspace/src/main.ts` 返回 `"console.log('hello')"`
   - readonly mount 拒绝 write（若存在 `/readonly` mount）
   - stream events 中的 `tool.call.result` 内容通过 `redactPayload()`（不暴露内部路径）

#### 2.5 对应价值
- **Skill**: fake bash 是 skills 的 v1 执行面，workspace namespace 是其数据底座。
- **稳定性**: mount-based routing 保证了 session-local 与 shared readonly 的边界不被突破。

#### 2.6 结果报告
- **通过标准**: 命令序列正确执行，读写隔离有效，stream 输出合法。
- **失败分析**: 若路径路由错误，说明 `MountRouter` 的最长前缀匹配与 just-bash 语义不一致；若 readonly mount 可被写，说明 `WorkspaceNamespace` 的 access check 缺失。

---

### E2E-08: Attachment/Prepared Artifact → LLM Context Assembly
> **readiness**: `ready`

#### 2.1 真实来源
- **claude-code**: `query.ts:301-304`, `utils/attachments.ts` (attachment messages + memory prefetch)
- **codex**: 无显式 attachment pipeline（但 plugin/app injection 可类比）
- **mini-agent**: 无 attachment 层（文件直接读入字符串）

#### 2.2 跨包列表
`workspace-context-artifacts` → `llm-wrapper` → `agent-runtime-kernel` → `nacp-session`

#### 2.3 功能簇集合
- **workspace-context-artifacts**: `StubArtifactPreparer` (`extracted-text` / `summary` / `preview`) + `ContextAssembler`
- **llm-wrapper**: `planAttachment()` + `toWorkspacePreparedArtifactRef()` + canonical `messages` content parts (`TextContentPart` / `ImageUrlContentPart`)
- **agent-runtime-kernel**: kernel step loop 在 `llm_pending` 前调用 context assembly
- **nacp-session**: client 收到 `session.update` 或 `system.notify` 提示 attachment 已加载

#### 2.4 测试场景
1. 用户上传一个 PDF 文件，系统生成 `ArtifactRef` (`kind="r2"`, `artifactKind="document"`, `key="tenants/team-1/artifacts/..."`)。
2. `StubArtifactPreparer.prepare({ sourceRef, targetKind: "extracted-text" })` 返回 prepared artifact。
3. `toWorkspacePreparedArtifactRef({ ...artifactRef, preparedKind: "extracted-text", sourceRef: artifactRef, textContent: "..." })` 去除 wrapper-side 字段，得到与 `PreparedArtifactRefSchema` 对齐的结构。
4. `ContextAssembler` 将 prepared artifact 作为 `artifact_summary` layer 插入 context，优先级高于 `recent_transcript`。
5. `planAttachment()` 将 artifact 转换为 canonical content part（如 `TextContentPart` 或 `ImageUrlContentPart`）。
6. `buildExecutionRequest()` 将 content part 加入 `CanonicalLLMRequest.messages`（不存在独立的 `attachments` 字段）。
7. Fake LLM 返回的 assistant response 引用 PDF 中的内容。
8. 断言:
   - `ContextAssembler.assemble()` 的输出中包含 `artifact_summary` layer
   - `CanonicalLLMRequest.messages` 中存在包含 attachment text 的 content part
   - prepared artifact 的 `sourceRef` 指向原始 PDF 的 `ArtifactRef`
   - `ArtifactRefSchema` 与 `PreparedArtifactRefSchema` 验证通过
   - `NacpRefSchema.safeParse(toNacpRef(sourceRef)).success === true`

#### 2.5 对应价值
- **上下文管理**: 附件不是裸二进制 inline，而是经过 prepared artifact 进入上下文，是多模态/大文档处理的根基。
- **Skill**: skills 可通过 attachment 机制消费外部文档。

#### 2.6 结果报告
- **通过标准**: attachment 成功进入 LLM context， prepared artifact 链路完整。
- **失败分析**: 若 `ContextAssembler` 丢弃 `artifact_summary`，说明 layer order 或 budget 截断策略有误；若 LLM request 中无 attachment，说明 `llm-wrapper` 的 `planAttachment` 或 `buildExecutionRequest` 未接入 workspace-context-artifacts。

---

### E2E-09: Observability Pipeline — Kernel Events → Trace Sink → Durable Audit → Timeline Replay
> **readiness**: `ready`

#### 2.1 真实来源
- **codex**: `codex-rs/rollout/src/recorder.rs:74-81` (JSONL rollout + event recording)
- **claude-code**: `utils/sessionStorage.ts:128-205` (transcript 与 progress 分离)
- **mini-agent**: `logger.py` (plain-text log，不可程序化查询 — 反例)

#### 2.2 跨包列表
`agent-runtime-kernel` → `eval-observability` → `nacp-core` → `storage-topology`

#### 2.3 功能簇集合
- **agent-runtime-kernel**: `RuntimeEventEmitter` 产出全量 runtime events
- **eval-observability**:
  - `TraceSink.emit()` (live + durable-audit + durable-transcript 三分)
  - `DoStorageTraceSink` 持久化 JSONL
  - `SessionTimeline` 排序与过滤
  - `traceEventToAuditBody()` 编码
- **nacp-core**: `AuditRecordBodySchema` 验证
- **storage-topology**: `validateRefKey()` 校验 trace storage key 的 tenant 前缀

#### 2.4 测试场景
1. 执行一个 3-step turn（llm → tool → llm），kernel 产生 8 个 runtime events:
   - `turn.started`
   - `llm.delta` (x2)
   - `tool.call.progress`
   - `tool.call.result`
   - `llm.delta`
   - `turn.completed`
   - `session.update`
2. `mapRuntimeEventToStreamKind()` 映射为 nacp-session 9 kinds。
3. `TraceSink` 根据 `classifyEvent()` 分发:
   - `llm.delta` → `live` only（不持久化）
   - `tool.call.result` → `durable-audit`
   - `turn.completed` → `durable-transcript`
4. `DoStorageTraceSink` 将 durable 事件追加写入 fake storage (`Map<string, string[]>` 模拟 JSONL)。
5. `SessionTimeline` 读取 durable 事件，按时间排序。
6. `traceEventToAuditBody()` 将 `tool.call.result` 转换为 audit record，通过 `AuditRecordBodySchema` 验证。
7. 断言:
   - `SessionTimeline.getEvents().length === 6` (8 - 2 live-only)
   - `DoStorageTraceSink` 的 storage key 以 `tenants/team-1/` 开头
   - `AuditRecordBodySchema.safeParse(auditBody).success === true`
   - `SessionInspector` 全程无 rejection

#### 2.5 对应价值
- **稳定性**: observability 是生产调试与合规的基础；此测试验证事件流从产生到归档不丢失、不漂移。
- **上下文管理**: durable transcript 是 long session 恢复与 compact 决策的输入之一。

#### 2.6 结果报告
- **通过标准**: live/audit/transcript 三分法正确，持久化与 timeline 回放完整，audit schema 验证通过。
- **失败分析**: 若 `llm.delta` 被错误持久化，说明 `LIVE_ONLY_EVENTS` 分类失效；若 timeline 排序错误，说明 `SessionTimeline` 未按 timestamp 排序；若 audit schema 失败，说明 `traceEventToAuditBody` 与 nacp-core schema 脱节。

---

### E2E-10: Storage Topology Evidence → Calibration → Placement Recommendation
> **readiness**: `ready`

#### 2.1 真实来源
- **codex**: `codex-rs/rollout/src/recorder.rs:189-212` (output truncation / size evidence)
- **claude-code**: `services/compact/autoCompact.ts:72-239` (token threshold + circuit breaker)
- **mini-agent**: `agent.py:123-158` (token estimation 启发式)

#### 2.2 跨包列表
`eval-observability` → `storage-topology` → `workspace-context-artifacts` → `session-do-runtime`

#### 2.3 功能簇集合
- **eval-observability**: `StoragePlacementLog` 记录 per-layer read/write/size evidence
- **storage-topology**: `evaluateEvidence()` 分析信号并输出 `CalibrationRecommendation`
- **workspace-context-artifacts**: `WorkspaceSnapshotBuilder` 根据 recommendation 调整 inline/promotion 策略（通过 `promoteToArtifactRef` 的 `policy` 参数）
- **session-do-runtime**: alarm handler 周期性触发 evidence 收集与 calibration

#### 2.4 测试场景
1. 模拟 10 次 session，每次产生 `workspace-file-small` 和 `workspace-file-large` 的 evidence:
   - small: size 500KB, read frequency 2, write frequency 1
   - large: size 2MB, read frequency 0, write frequency 1
2. `StoragePlacementLog` 累积 evidence signals:
   - `{ kind: "size", dataItem: "workspace-file-large", value: 2_000_000 }`
   - `{ kind: "write-frequency", dataItem: "workspace-file-small", value: 10 }`
3. `storage-topology` 的 `evaluateEvidence()` 输出:
   - `workspace-file-large`: `change-placement` (do-storage → r2)
   - `workspace-file-small`: `maintain`（或 `adjust-threshold` 若写频极高）
4. Test harness 根据 recommendation 调整 `promoteToArtifactRef()` 的 `policy.coldTierSizeBytes` 参数。
5. 新 session 中，1.5MB 文件自动走 r2，500KB 文件仍 inline 到 DO storage。
6. 断言:
   - `evaluateEvidence(signals, hypothesis)` 的 `action` 与预期一致
   - `confidence` 随信号数量增加（`low` → `medium` → `high`）
   - 调整后的 promotion 策略与 recommendation 一致
   - `PLACEMENT_HYPOTHESES` 中对应 data item 的 `provisional` 标志仍为 true（evidence 不自动冻结）

#### 2.5 对应价值
- **上下文管理**: storage topology 的“证据后收敛”是 nano-agent 不提前绑定物理 schema 的核心设计。
- **稳定性**: 通过真实运行数据校准存储策略，避免拍脑袋定阈值。

#### 2.6 结果报告
- **通过标准**: evidence 驱动 recommendation，promotion 策略动态调整。
- **失败分析**: 若 `evaluateEvidence` 对 2MB size 不触发 `change-placement`，说明 `DO_SIZE_THRESHOLD_BYTES` 硬编码或逻辑错误；若 recommendation 未影响下游 promotion，说明 storage-topology 与 workspace-context-artifacts 的接线未闭环。

---

### E2E-11: WebSocket-first Live Stream → Ack/Replay → HTTP Fallback Durable Read
> **readiness**: `phase-gated`

#### 2.1 真实来源
- **claude-code**: `cli/remoteIO.ts:140-189` (internal event writer / reader, delivery state, keep_alive 帧)
- **claude-code**: transcript 与内部事件分层持久化的 session storage 思路
- **nacp-session**: `ReplayBuffer` + `last_seen_seq` 语义

#### 2.2 跨包列表
`session-do-runtime` → `nacp-session` → `eval-observability` → `storage-topology`

#### 2.3 功能簇集合
- **session-do-runtime**: WebSocket-first ingress、HTTP fallback read、`NanoSessionDO` 的 fetch routing
- **nacp-session**: `last_seen_seq` / replay buffer / stream sequencing
- **eval-observability**: live vs durable event 分类、timeline read
- **storage-topology**: durable trace / transcript ref key reality

#### 2.4 测试场景
1. 建立一个 WS session，执行 1 个真实 turn，产生序列：`turn.begin` → `llm.delta` → `tool.call.progress` → `tool.call.result` → `turn.end`。
2. 客户端对部分事件发送 ack / `last_seen_seq`。
3. 中途模拟 WS 断开。
4. 通过 HTTP fallback 拉取 durable timeline。
5. 再次通过 WS resume，请求 replay 缺失区间。
6. 断言：
   - replay 只重放 **缺失** 的 stream event，不重复已 ack 区间；
   - HTTP fallback 只能看到 durable 产物，**看不到** `keep_alive` 与不应持久化的 live-only 数据；
   - replay 与 durable read 组合后，客户端能恢复出一致的 turn 视图；
   - event seq 单调递增，没有倒序与重复。

#### 2.5 对应价值
- **稳定性**: 这是 Worker-native agent 与本地 CLI 最大的工程差异点之一。
- **可运维性**: 它同时验证了 live stream 与 durable read 的双通道协作，不只是“能不能收日志”。

#### 2.6 结果报告
- **通过标准**: WS replay、HTTP fallback、durable timeline 三者对同一 turn 的恢复结果一致。
- **失败分析**: 若 HTTP fallback 混入 live-only 事件，说明 observability 分层漂移；若 replay 重复或跳号，说明 `nacp-session` 与 session runtime 的 seq / ack 合同未闭环。

---

### E2E-12: Dirty Resume — 在 `tools_pending` 中途 checkpoint 后恢复继续执行
> **readiness**: `phase-gated`

#### 2.1 真实来源
- **codex**: `codex-rs/core/src/codex.rs` 的 turn restoration / thread restore 路径
- **claude-code**: `cli/remoteIO.ts:147-153` 的 internal event reader，用于 resume 时重建前景状态
- **mini-agent**: mid-turn cancel/cleanup 的“不要留下半截消息”心智模型

#### 2.2 跨包列表
`session-do-runtime` → `agent-runtime-kernel` → `capability-runtime` → `workspace-context-artifacts` → `nacp-session`

#### 2.3 功能簇集合
- **session-do-runtime**: `buildSessionCheckpoint()` / `restoreSessionCheckpoint()`
- **agent-runtime-kernel**: `tools_pending` 状态恢复、pending step 继续
- **capability-runtime**: pending capability 的一次性继续执行
- **workspace-context-artifacts**: 中途已产生的 refs / snapshot fragment 恢复
- **nacp-session**: replay continuity

#### 2.4 测试场景
1. 用户发起 turn，fake LLM 返回 assistant message + 1 个 tool call。
2. kernel 已进入 `tools_pending`，但 tool 还没有真正执行。
3. 此时构建 `SessionCheckpoint`，模拟 DO hibernation。
4. 在新实例上调用 `restoreSessionCheckpoint()` 恢复全部 fragment。
5. 继续该 turn，而不是新开一个 turn。
6. 断言：
   - 恢复后不会重复注入第二条 assistant tool-call message；
   - 该 pending tool **只执行一次**；
   - 最终只产生一条对应的 `tool.call.result`；
   - turn 完成后 phase 正确回到 `attached`；
   - replay / stream seq 与 checkpoint 前后连续。

#### 2.5 对应价值
- **稳定性**: clean resume 只能证明“turn 结束后能恢复”；dirty resume 才能证明 Worker hibernation 真正可用。
- **业务价值**: Cloudflare 场景下，真正难的是中途唤醒恢复，不是 turn 结束后重开一个新会话。

#### 2.6 结果报告
- **通过标准**: 中途 checkpoint 后恢复继续执行，不重复、不丢步、不重放半截消息。
- **失败分析**: 若 tool 被重复执行，说明 checkpoint 保存的是“可恢复状态”而不是“可重演状态”；若 tool 丢失，说明 pending-step contract 没进入 checkpoint truth。

---

### E2E-13: Content Replacement + Prepared Artifact 在 compact / resume 后仍保持一致
> **readiness**: `phase-gated`

#### 2.1 真实来源
- **claude-code**: `query.ts:369-420` (`applyToolResultBudget()` 先做大结果替换，再进入 microcompact / autocompact)
- **claude-code**: `utils/sessionStorage.ts:1494-1499` (`recordContentReplacement()` 将替换记录持久化)
- **claude-code**: `utils/attachments.ts` / `services/compact/compact.ts` (attachment prefetch、去重、compact 后再注入)

#### 2.2 跨包列表
`capability-runtime` → `workspace-context-artifacts` → `llm-wrapper` → `agent-runtime-kernel` → `session-do-runtime`

#### 2.3 功能簇集合
- **capability-runtime**: 大结果产出
- **workspace-context-artifacts**: promotion、prepared artifact、compact boundary、snapshot
- **llm-wrapper**: `planAttachment()`、`prepared-text` route、canonical messages
- **agent-runtime-kernel**: compact 前后的上下文重组
- **session-do-runtime**: content replacement / prepared refs 的持久化恢复

#### 2.4 测试场景
1. 同一 turn 内同时发生两件事：
   - 一个 tool 返回超大文本结果，触发 promotion；
   - 用户还上传了一个 PDF，触发 prepared artifact。
2. 在发送给 LLM 之前执行 content replacement 与 attachment planning（大结果替换为 artifact ref，PDF 变为 extracted-text content part）。
3. 随后触发 compact，再做一次 checkpoint / resume。
4. 恢复后继续构造下一次 `buildExecutionRequest()`。
5. 断言：
   - 大 tool result 不再以内联正文形式重新出现，而是继续以 artifact ref / replacement record 存活；
   - prepared artifact 只注入一次，不因 resume 或 compact 发生重复；
   - 进入 `CanonicalLLMRequest.messages` 的是当前 route 决定后的文本 / content part，而不是假想的 `attachments` 字段；
   - `sourceRef -> preparedRef` 链条在 snapshot / restore 后仍然成立。

#### 2.5 对应价值
- **上下文管理**: 这条链路几乎就是 nano-agent 的核心差异化能力组合。
- **业务价值**: 大结果、附件、compact、resume 一旦任一处断裂，用户会直接感觉“上下文失忆”或“内容重复污染”。

#### 2.6 结果报告
- **通过标准**: promotion、prepared artifact、compact、resume 四条链组合后仍只保留一份正确语义。
- **失败分析**: 若恢复后再次出现大文本 inline，说明 replacement 未持久化；若 attachment 重复，说明 dedup / post-compact reinjection contract 未闭环。

---

### E2E-14: Runtime-registered Session Hooks — 聚合结果与跨 resume 持久化
> **readiness**: `ready`

#### 2.1 真实来源
- **codex**: `run_user_prompt_submit_hooks()` 这类多 handler 顺序执行与 stop 判定
- **claude-code**: `utils/hooks.ts` / post-sampling hook 体系的多 handler 聚合模式
- **nano-agent v1 owner decision**: session-scoped runtime hook 允许跨 resume 持久化

#### 2.2 跨包列表
`hooks` → `session-do-runtime` → `agent-runtime-kernel` → `nacp-session` → `eval-observability`

#### 2.3 功能簇集合
- **hooks**: `aggregateOutcomes()`、`HookRegistry.snapshot()` / `restore()`
- **session-do-runtime**: hooks fragment checkpoint / restore
- **agent-runtime-kernel**: turn 内消费 aggregated outcome
- **nacp-session**: `hook.broadcast`
- **eval-observability**: hook audit evidence

#### 2.4 测试场景
1. 运行时注册 3 个 session-scoped hooks：
   - handler A: `continue` + diagnostics
   - handler B: `updatedInput`
   - handler C: `block`
2. 先对 registry 做 checkpoint（通过 `getHooksFragment` + `buildSessionCheckpoint`），再 restore 到新 session 实例。
3. 在恢复后的 turn 中触发 `PreToolUse`。
4. 断言：
   - 恢复后 handler 数量与顺序不变；
   - `aggregateOutcomes()` 的最终结果与当前 contract 一致（例如 block 优先级最高，`updatedInput` 采用最后一次有效写入）；
   - kernel 正确消费聚合结果，而不是只看单一 handler；
   - `hook.broadcast` 与 audit evidence 都能看到 aggregated outcome；
   - 若最终是 `block`，tool execution 不发生。

#### 2.5 对应价值
- **Skill / 治理**: 运行时可注册 hooks 是后续 skill 平台化的基础。
- **稳定性**: 如果 hooks 不能跨 resume 持久化，Worker hibernation 之后行为会瞬间漂移。

#### 2.6 结果报告
- **通过标准**: restore 前后 hook 行为等价，聚合逻辑与 runtime 消费逻辑一致。
- **失败分析**: 若恢复后 handler 丢失，说明 hooks snapshot 没进入 session truth；若聚合结果与实际执行结果不一致，说明 hooks package 与 kernel wiring 断裂。

---

## 3. 测试组织与执行计划

### 3.1 目录结构建议

文档建议将 E2E 测试与现有根目录 `test/` 融合，而非平行造新目录：

```text
test/
├── capability-toolcall-contract.test.mjs        # 现有
├── hooks-protocol-contract.test.mjs             # 现有
├── kernel-session-stream-contract.test.mjs      # 现有
├── llm-wrapper-protocol-contract.test.mjs       # 现有
├── observability-protocol-contract.test.mjs     # 现有
├── session-do-runtime-contract.test.mjs         # 现有
├── storage-topology-contract.test.mjs           # 现有
├── workspace-context-artifacts-contract.test.mjs # 现有
└── e2e/                                         # 新增 E2E 场景
    ├── fixtures/
    │   ├── fake-llm.ts
    │   ├── fake-storage.ts
    │   ├── fake-session.ts
    │   └── seed-data.ts
    ├── e2e-01-full-turn.test.mjs
    ├── e2e-02-blocking-hook.test.mjs
    ├── e2e-03-compact-boundary.test.mjs
    ├── e2e-04-large-result-promotion.test.mjs
    ├── e2e-05-session-resume.test.mjs
    ├── e2e-06-cancel-midturn.test.mjs
    ├── e2e-07-workspace-fileops.test.mjs
    ├── e2e-08-attachment-context.test.mjs
    ├── e2e-09-observability-pipeline.test.mjs
    ├── e2e-10-storage-calibration.test.mjs
    ├── e2e-11-ws-replay-http-fallback.test.mjs
    ├── e2e-12-dirty-resume.test.mjs
    ├── e2e-13-content-replacement-consistency.test.mjs
    └── e2e-14-hooks-resume.test.mjs
```

### 3.2 执行顺序与依赖

| Phase | 测试 | 前置条件 | 说明 |
|-------|------|----------|------|
| Phase 1 | E2E-01, E2E-07, E2E-14 | 无 | 验证最基本的数据平面、capability 面与 hook 持久化 |
| Phase 2 | E2E-02, E2E-06 | Phase 1 通过 | 加入 hook 与 cancel 的异常路径 |
| Phase 3 | E2E-03, E2E-04, E2E-08 | Phase 1-2 通过 | 加入 compact、artifact、attachment 等上下文管理 |
| Phase 4 | E2E-05, E2E-09 | Phase 3 通过 | 验证持久化、恢复、observability |
| Phase 5 | E2E-10 | Phase 4 通过 | 验证 evidence-backed calibration 闭环 |
| Phase 6 | E2E-11, E2E-12, E2E-13 | Phase 5 通过 + session ingress/WS 收口 | 验证 WS/HTTP 双通道、dirty resume、复杂 context 一致性 |

### 3.3 失败分类与响应

| 失败层级 | 定义 | 响应方式 |
|----------|------|----------|
| L1 Schema Drift | nacp-core schema 验证失败 | 立即 block，说明子系统 builder 与协议层 reality 漂移 |
| L2 Event Mapping Drift | kernel event → stream kind 映射失败 | high priority，影响 client-visible stream |
| L3 Delegate Wiring Gap | 子系统接口未接或接错 | 定位具体包（kernel/llm/capability/hooks） |
| L4 Data Plane Gap | workspace/snapshot/artifact 数据未流通 | 定位 workspace-context-artifacts 或 storage-topology |
| L5 Observability Gap | trace/timeline/audit 缺失 | medium priority，不影响核心功能但影响可运维性 |
| L6 Runtime Glue Gap | WS accept、ingress routing、Worker fetch handler 缺失 | 定位 session-do-runtime 或 nacp-session 的未收口部分 |

### 3.4 结果报告模板（每个 E2E 测试输出）

```yaml
test_id: E2E-01
name: Full Turn — Input → Kernel → LLM → Tool → Result → Stream
readiness: ready
status: pass | fail | skip
packages_involved:
  - agent-runtime-kernel
  - llm-wrapper
  - capability-runtime
  - hooks
  - eval-observability
  - nacp-session
assertions:
  total: 8
  passed: 8
  failed: 0
key_metrics:
  steps_executed: 3
  stream_events_emitted: 4
  trace_events_emitted: 3
  schema_validation_time_ms: 12
failure_analysis: |
  (若失败) 哪一步断裂、哪个包的公共 API 未按预期工作、
  与 context/ 中对应 agent CLI 的行为差异。
```

---

## 4. 风险与调整策略

### 4.1 已知风险

1. **WorkspaceSnapshotBuilder 当前为空壳**: E2E-03/04/05 会在此失败，需要先修复 `buildFragment()` 的 mount/file 提取逻辑。
2. **ArtifactRef 已对齐 NacpRef**: 此问题已在二次审查中被 Opus 修复，当前 `ArtifactRefSchema` 已是 NacpRef-shaped。
3. **session-do-runtime 的 Worker entry 缺失**: E2E-11/12/13 需要真实 Worker fetch routing，需先补 `src/worker.ts` 和 WS accept 真实接入。
4. **promoteToArtifactRef 已支持 idFactory**: 可复现性风险已消除，测试中应始终传入 `idFactory`。

### 4.2 调整策略

- **MVP 阶段**: 若某些子系统（如真实的 DO storage API）无法在 Node test runner 中运行，可用 `fake-storage.ts` 模拟，但**数据流必须穿过真实包的公共 API**。
- **Stub 升级路径**: `StubArtifactPreparer` → 真实 OCR/summary worker；`ReferenceBackend` → 真实 R2 adapter；`fake-llm.ts` → 真实 OpenAI-compatible provider。
- **分批执行**: 不必等全部 14 个 E2E 同时 green；按 Phase 1→6 逐步推进，每通过一 Phase 就锁定该数据平面。

---

## 5. 结语

这 14 个 E2E 测试不是对单测的替代，而是对**“nano-agent 10 个包能否组装成一个可运行的 agent”**的最终验证。它们全部来源于 `context/` 中三个成熟 agent CLI 的真实执行线路，并映射到 nano-agent 的三大价值方向：

- **上下文管理**: E2E-03, E2E-04, E2E-08, E2E-10, E2E-13
- **Skill**: E2E-01, E2E-02, E2E-07, E2E-14
- **稳定性**: E2E-05, E2E-06, E2E-09, E2E-11, E2E-12

执行本 suite 的过程中发现的任何断裂点，都应直接反馈到对应包的 action-plan 与 code-review 文档，作为二次审查的输入。

---

## 6. 审查历史

### 6.1 Kimi 初稿 (v0.1)
- 提出 10 个 E2E 测试，覆盖核心跨包数据流。
- 存在若干过时的 API 引用（如旧版 `buildCompactInput`、旧版 `ArtifactRef` 字段、旧版 `workspace_refs` 等）。

### 6.2 GPT 审查意见 (2026-04-17)
- **优点**: 方向正确，链路抽取方式成立，中间产物断言设计有价值，Phase 化执行顺序合理。
- **修正要求**: root test 数量从 5 更新为 8；compact API 需对齐 `buildCompactRequest`/`applyCompactResponse`；`ArtifactRef` 需使用 NacpRef-shaped 字段；`SessionCheckpoint` 需使用 `workspaceFragment`；`CanonicalLLMRequest` 无 `attachments` 字段；部分测试不应断言未公开的内部字段（如 `ReplayBuffer.baseSeq`）。
- **补充项**: 新增 E2E-11 (WS→Ack/Replay→HTTP Fallback)、E2E-12 (Dirty Resume)、E2E-13 (Content Replacement + Prepared Artifact 一致性)、E2E-14 (Runtime-registered Session Hooks 持久化)。

### 6.3 Kimi 更新 (v0.2)
- 已根据实际代码逐一修正 API 引用。
- 已补充 4 个 GPT 提议的测试项。
- 已为每个测试标注 `ready` 或 `phase-gated`。
- 已建议将 E2E 目录融入现有 `test/e2e/` 而非新建顶层目录。
