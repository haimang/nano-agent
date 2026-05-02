# Codex Resume/Reconnect/Replay vs nano-agent API Gap Analysis

> **Scope**: `context/codex` WS 重连 + `last_seen_seq` + stream replay + detached recovery 体系  
> **Principle**: 逐条真实代码引用，定位缺口文件/行号，只判断是否阻塞前端运行  
> **Date**: 2026-05-02

---

## 1. 调查范围

本次调查聚焦 nano-agent 的 **连接生命周期管理体系**：
- WebSocket 重连（with re-auth + state sync）
- `last_seen_seq` / ack / sequence 协议
- 离线期间的 stream replay（missed event delivery）
- Detached recovery（session 在断连后存活并被恢复）

以 Codex 的同类系统为透镜，审视 nano-agent 离 "前端可以可靠地从断连中恢复并继续 agent loop" 还有多大差距。

---

## 2. Codex 体系总览

### 2.1 Detached Session Recovery（进程级存活）

Codex 的 exec-server 实现了一个带 TTL 的 attach/detach 模式：

```
SessionRegistry.attach(resume_session_id?)
  ├─ Some(id) + not expired + not already attached → reattach to existing session
  ├─ Some(id) + expired → remove + kill process
  ├─ Some(id) + already attached → error
  └─ None → create new session
```

```rust
// context/codex/codex-rs/exec-server/src/server/session_registry.rs:15-17
#[cfg(not(test))]
const DETACHED_SESSION_TTL: Duration = Duration::from_secs(10);
```

```rust
// context/codex/codex-rs/exec-server/src/server/session_registry.rs:58-117
pub(crate) async fn attach(&self, resume_session_id: Option<String>, ...) -> Result<SessionHandle>
```

关键行为：
- 断连时 `Handler::shutdown()` → `session.detach()` → 进程继续在后台运行
- `detach()` 设置 `detached_expires_at = now + TTL`（10s）
- 后台 task 在 TTL 后检查 → 如仍 detached → kill process + remove entry
- 重连时通过 `InitializeParams.resume_session_id` 恢复（`handler.rs:64-68`）

测试验证：`exec-server/tests/process.rs:79` — `exec_server_resumes_detached_session_without_killing_processes()`

### 2.2 Rollout Reconstruction（全量历史恢复）

Codex 将每个 `RolloutItem` 持久化到 JSONL 文件或 thread-store：

```rust
// context/codex/codex-rs/protocol/src/protocol.rs:2782-2789
pub enum RolloutItem {
    SessionMeta(SessionMetaLine),
    ResponseItem(ResponseItem),
    Compacted(CompactedItem),       // ← 包含 replacement_history 检查点
    TurnContext(TurnContextItem),    // ← per-turn 上下文快照（model/cwd/sandbox/...）
    EventMsg(EventMsg),
}
```

反向重放引擎 `reconstruct_history_from_rollout()`：

```rust
// context/codex/codex-rs/core/src/codex/rollout_reconstruction.rs:86-301
pub(super) async fn reconstruct_history_from_rollout(
    &self, turn_context, rollout_items: &[RolloutItem]
) -> RolloutReconstruction {
    // 1. 反向扫描 (newest→oldest)
    // 2. 找到最新的 replacement_history 检查点作为 history base
    // 3. 提取 previous_turn_settings (model + realtime_active)
    // 4. 提取 reference_context_item (最新 turn context)
    // 5. 往前重放 rollout_suffix 重建精确 history
}
```

Resume 时调用：
```rust
// context/codex/codex-rs/core/src/codex.rs:2369-2473
InitialHistory::Resumed(resumed_history) => {
    rollout_items = resumed_history.history;
    // Reconstruct history, seed previous_turn_settings + reference_context_item
    // Warn if model changed
    // Seed token usage info from rollout
}
```

`SessionConfiguredEvent` 提供恢复后的完整会话上下文（model, sandbox, cwd, approval_policy, initial_messages）。

### 2.3 Remote Control WS 重连（seq_id + subscribe_cursor）

Codex 的 remote control 传输层有完整的自动重连：

```rust
// context/codex/codex-rs/app-server/src/transport/remote_control/websocket.rs:113-127
pub(crate) struct RemoteControlWebsocket {
    remote_control_url: String,
    state_db: Option<Arc<StateRuntime>>,
    auth_manager: Arc<AuthManager>,
    shutdown_token: CancellationToken,
    reconnect_attempt: u64,          // ← 指数退避计数器
    // ...
}
```

**重连循环**（`connect()` 方法，line 235-319）：
1. 每次连接前重新认证（`load_remote_control_auth()`）
2. 加载持久化的 enrollment（SQLite）
3. 发送 `x-codex-subscribe-cursor` header → 后端从该 cursor 处恢复事件流
4. 401/403 → 触发 auth recovery → 重试
5. 404 → 清除旧 enrollment → 重新注册
6. 其他错误 → 指数退避（`backoff(reconnect_attempt)`），increment
7. 成功 → 重置 `reconnect_attempt = 0`

**Ack / Retransmit 协议**（`websocket.rs:59-105`）：
```rust
// BoundedOutboundBuffer 按 client_id 索引，BTreeMap<seq_id, ServerEnvelope>
// Backend 发送 ClientEvent::Ack { seq_id } 确认
// 重连时 run_server_writer_inner() 先重放所有未确认的 envelopes
```

**subscribe_cursor**（line 51, 109, 588-589）：
```rust
// subscribe_cursor 存储在 WebsocketState
// 重连时通过 x-codex-subscribe-cursor header 发送
// 后端因此可以从断点恢复流
```

### 2.4 App-Server Client（无自动重连，但区分 lossless/best-effort）

```rust
// context/codex/codex-rs/app-server-client/src/remote.rs:802-903
fn event_requires_delivery(event: &AppServerEvent) -> bool {
    match event {
        AppServerEvent::ServerNotification(..) => notification_requires_delivery(..),
        AppServerEvent::Disconnected { .. } => true,  // ← 必须通知
        AppServerEvent::Lagged { .. } => false,
    }
}
```

传输断开时 emit `AppServerEvent::Disconnected` → 由上层（TUI/CLI）决定重连策略。

---

## 3. nano-agent 体系总览

### 3.1 双层 Replay 架构

nano-agent 有**两个独立的 Replay 层**：

#### Layer A: Orchestrator (User DO) — `relay_cursor` 层

```
last_seen_seq (URL query) → User DO handleWsAttach()
  ├─ replayCursor = Math.min(entry.relay_cursor, clientLastSeenSeq)
  ├─ forwardFramesToAttachment() → 从内部 NDJSON 流重放
  └─ relay_cursor 持久化到 KV SessionEntry
```

源码：`workers/orchestrator-core/src/user-do/ws-runtime.ts:56-157`

```typescript
// ws-runtime.ts:72
const clientLastSeenSeq = parseLastSeenSeq(request);

// ws-runtime.ts:133-136
const replayCursor =
  clientLastSeenSeq === null
    ? entry.relay_cursor
    : Math.min(entry.relay_cursor, clientLastSeenSeq);

// ws-runtime.ts:257-282
async forwardFramesToAttachment(entry, frames) {
  let cursor = entry.relay_cursor;
  for (const frame of frames) {
    if (frame.kind !== "event") continue;
    if (frame.seq <= cursor) continue;      // ← 跳过已投递的帧
    attachment.socket.send(JSON.stringify(frame));
    cursor = frame.seq;
  }
  await ctx.put(sessionKey(sessionUuid), { ...entry, relay_cursor: cursor });
}
```

#### Layer B: Agent-Core (Session DO) — `ReplayBuffer` 层

```
session.resume { last_seen_seq } → Session DO ws-runtime dispatchAdmissibleFrame()
  ├─ 保存 last_seen_seq 到 DO storage
  ├─ helper.restore(storage) → 从持久化恢复 replay buffer
  ├─ helper.handleResume(streamUuid, lastSeenSeq) → replay.replay(streamUuid, lastSeenSeq + 1)
  └─ 每个重放的帧 tracking ack
```

源码：

```typescript
// workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213
case "session.resume": {
  const lastSeenSeq = body?.["last_seen_seq"];
  if (typeof lastSeenSeq === "number" && Number.isFinite(lastSeenSeq)) {
    const scoped = ctx.getTenantScopedStorage();
    if (scoped) await scoped.put(LAST_SEEN_SEQ_KEY, lastSeenSeq);
    const helper = ctx.ensureWsHelper();
    if (helper) {
      const helperStorage = ctx.wsHelperStorage();
      if (helperStorage) await helper.restore(helperStorage);
      helper.handleResume(ctx.streamUuid, lastSeenSeq);
    }
  }
  await ctx.restoreFromStorage();
  break;
}

// packages/nacp-session/src/websocket.ts:239-250
handleResume(streamUuid: string, lastSeenSeq: number): NacpSessionFrame[] {
  const frames = this.replay.replay(streamUuid, lastSeenSeq + 1);
  if (this.socket && this.attached) {
    for (const f of frames) {
      this.socket.send(JSON.stringify(f));
      if (f.session_frame.ack_required) {
        this.ackWindow.track(f.session_frame.stream_uuid, f.session_frame.stream_seq);
      }
    }
  }
  return frames;
}
```

### 3.2 ReplayBuffer 容量

```typescript
// packages/nacp-session/src/replay.ts:27-29
constructor(opts: ReplayBufferOptions = {}) {
  this.maxPerStream = opts.maxPerStream ?? 200;   // 每 stream 200 事件
  this.maxTotal = opts.maxTotal ?? 1000;           // 总共 1000
}
```

Buffer 溢出时 EVICT 最旧的帧：
```typescript
// replay.ts:53-55
while (this.totalCount > this.maxTotal) {
  this.evictOldest();  // 删除最大的 stream 中最旧的帧
}
```

```typescript
// replay.ts:62-68 — 当 fromSeq < baseSeq 时抛错误
if (fromSeq < buf.baseSeq) {
  throw new NacpSessionError(
    [`replay_from ${fromSeq} is before buffer start ${buf.baseSeq} for stream '${streamUuid}'`],
    SESSION_ERROR_CODES.NACP_REPLAY_OUT_OF_RANGE,
  );
}
```

### 3.3 断连处理

**Agent-Core DO 侧**：
```typescript
// ws-runtime.ts:243-260
async webSocketClose(_ws: unknown): Promise<void> {
  await ctx.emitEdgeTrace("session.edge.detach");
  await ctx.persistCheckpoint();  // ← checkpoint replay buffer + kernel state
  // 转换 phase: turn_running → attached → unattached
  // 或: attached → unattached
}
```

**Orchestrator User DO 侧**：
```typescript
// user-do/ws-runtime.ts:164-175 — bindSocketLifecycle close handler
socket.addEventListener?.("close", () => {
  ctx.attachments.delete(sessionUuid);
  if (current.heartbeat_timer) clearInterval(current.heartbeat_timer);
  this.markDetached(sessionUuid).catch(...);  // ← 标记 status: "detached"
});

// ws-runtime.ts:237-245
async markDetached(sessionUuid: string): Promise<void> {
  const entry = await ctx.get<SessionEntry>(sessionKey(sessionUuid));
  if (!entry || entry.status === "ended") return;
  await ctx.put(sessionKey(sessionUuid), {
    ...entry,
    status: "detached",
    last_seen_at: new Date().toISOString(),
  });
}
```

### 3.4 Checkpoint（Durable Object Hibernation）

```typescript
// workers/agent-core/src/host/checkpoint.ts:43-56
export interface SessionCheckpoint {
  readonly version: string;
  readonly sessionUuid: string;
  readonly teamUuid: string;
  readonly actorPhase: string;
  readonly turnCount: number;
  readonly kernelFragment: unknown;
  readonly replayFragment: unknown;      // ← ReplayBuffer.checkpoint()
  readonly streamSeqs: Record<string, number>;
  readonly workspaceFragment: unknown;
  readonly hooksFragment: unknown;
  readonly usageSnapshot: UsageSnapshot;
  readonly checkpointedAt: string;
}
```

Session DO alarm 定期检查健康并持久化：
```typescript
// session-do-runtime.ts:583-599
async alarm(): Promise<void> {
  const status = this.healthGate.checkHealth(this.heartbeatTracker, this.ackWindow);
  if (this.healthGate.shouldClose(status)) {
    await this.persistCheckpoint();   // ← 在不健康时 checkpoint
  }
  await this.sweepDeferredAnswers();
  if (storage?.setAlarm) {
    await storage.setAlarm(Date.now() + this.config.heartbeatIntervalMs);
  }
}
```

### 3.5 客户端重连

```typescript
// clients/web/src/client.ts:29-87
export function openSessionStream(auth, sessionUuid, onEvent, options = {}) {
  const url = new URL(`${wsBase}/sessions/${sessionUuid}/ws`);
  url.searchParams.set("last_seen_seq", String(Math.max(0, options.lastSeenSeq ?? 0)));

  const socket = new WebSocket(url.toString());
  // ... heartbeat, cleanup

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      message_type: "session.resume",
      body: { last_seen_seq: Math.max(0, options.lastSeenSeq ?? 0) },
    }));
  });

  socket.addEventListener("message", (event) => {
    const parsed = JSON.parse(event.data);
    if (parsed.seq > 0) {
      socket.send(JSON.stringify({
        message_type: "session.stream.ack",
        body: { stream_uuid: "main", acked_seq: parsed.seq },
      }));
    }
    onEvent(parsed);
  });

  socket.addEventListener("close", cleanup);  // ← 清理但不重连
  socket.addEventListener("error", cleanup);
  return socket;
}
```

---

## 4. 缺口分析

### 🔴 阻塞性缺口

#### GAP-1: Replay Buffer 容量不足以支撑长期断连

**Codex 做法**：Rollout items 无限持久化到 JSONL + thread-store。Line 1860+ lines 的 `reconstruct_history_from_rollout()` 可以从任意长的持久化历史恢复完整会话状态。

**nano-agent 现状**：

```typescript
// packages/nacp-session/src/replay.ts:27-29
this.maxPerStream = opts.maxPerStream ?? 200;
this.maxTotal = opts.maxTotal ?? 1000;
```

200 events/stream 在活跃会话中可能只代表 2-5 分钟的流式输出。超过此窗口：

```typescript
// replay.ts:62-68
if (fromSeq < buf.baseSeq) {
  throw new NacpSessionError(
    [`replay_from ${fromSeq} is before buffer start ${buf.baseSeq} for stream '${streamUuid}'`],
    SESSION_ERROR_CODES.NACP_REPLAY_OUT_OF_RANGE,
  );
}
```

**影响**：前端断连超过 200 个事件后重连，agent-core 的 `handleResume()` 会抛 `NACP_REPLAY_OUT_OF_RANGE`。客户端收到的帧序列会出现不可恢复的断点。Orchestrator 层的 `relay_cursor` 没有此限制（NDJSON 直接从 agent-core 实时读取），但 agent-core 的 NACP protocol 层 replay 有。

**定位**：`packages/nacp-session/src/replay.ts:58-68`

---

#### GAP-2: 双层 Seq 不一致导致 Ack 验证失败

**Codex 做法**：单一 `seq_id` 空间，backend ack 直接匹配 server 发送的 seq_id。

**nano-agent 现状**：客户端看到两个序列号系统：

1. **Orchestrator frame seq**：`StreamFrame.seq`（parity-bridge.ts NDJSON 的 seq）
2. **Agent-core stream_seq**：`NacpSessionFrame.session_frame.stream_seq`

客户端 ack 代码（`client.ts:71-76`）：
```typescript
if (typeof parsed.seq === "number" && parsed.seq > 0) {
  socket.send(JSON.stringify({
    message_type: "session.stream.ack",
    body: { stream_uuid: "main", acked_seq: parsed.seq },  // ← 用的是 orchestrator 的 seq
  }));
}
```

这个 `session.stream.ack` 到达 agent-core，触发 `handleAck("main", parsed.seq)`：

```typescript
// packages/nacp-session/src/websocket.ts:263-272
handleAck(streamUuid: string, ackedSeq: number): number {
  const latestSeq = this.replay.getLatestSeq(streamUuid);
  if (latestSeq >= 0 && ackedSeq > latestSeq) {
    throw new NacpSessionError(
      [`ack seq ${ackedSeq} is beyond latest sent seq ${latestSeq} for stream '${streamUuid}'`],
      SESSION_ERROR_CODES.NACP_SESSION_ACK_MISMATCH,
    );
  }
}
```

如果 orchestrator 的 `seq`（包装层序列号）与 agent-core 的 `stream_seq`（NACP 协议层序列号）不同步，ack 验证会失败。

**影响**：前端可能收到 `NACP_SESSION_ACK_MISMATCH` 错误，ack 窗口中的 pending entry 永远不会被清除 → 30s 后 `checkAckHealth()` 超时 → 可能触发 alarm 的 `shouldClose()`。

**定位**：
- `clients/web/src/client.ts:71-76`（ack 使用错误层的 seq）
- `packages/nacp-session/src/websocket.ts:263-272`（验证层期望 agent-core 的 stream_seq）
- `workers/orchestrator-core/src/user-do/ws-runtime.ts:266-271`（orchestrator 发送自己的 seq）

---

#### GAP-3: 无断连后的 Turn 状态通知

**Codex 做法**：
- `SessionConfiguredEvent` 携带完整会话状态（model, sandbox, cwd, approval_policy, initial_messages）
- `AgentStatus` watch channel: `Running / Interrupted / Completed / Errored / PendingInit / Shutdown`
- TUI 重连后可以立即渲染会话状态

**nano-agent 现状**：重连时没有 "当前会话状态快照"。客户端接收到的是从 `replayCursor` 开始的帧序列，但没有：
- 当前 actor phase（`idle / turn_running / attached / unattached / ended`）
- 当前 turn ID（如果有 turn 在进行中）
- 会话元数据（model, capabilities, etc.）

Agent DO 有 `ActorState`（`actor-state.ts:110`）：
```typescript
// workers/agent-core/src/host/actor-state.ts
export interface ActorState {
  phase: "unattached" | "attached" | "turn_running" | "ended";
  activeTurnId: string | null;
  pendingInputs: TurnInput[];
  // ...
}
```

但这个状态**不会作为帧发送给客户端**。客户端只能通过解析 replayed events 推断状态。

**影响**：前端重连后不知道 agent 是否正在处理 turn、是否有 pending input。如果 turn 在进行中，前端不能立即展示 "正在生成..." 的 UI 状态，只能等下一帧到达后推断。

**定位**：
- `workers/agent-core/src/host/actor-state.ts`（ActorState 存在但不推送到客户端）
- `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`（session.resume 仅做 replay，不发送状态快照）

---

### 🟡 严重缺口

#### GAP-4: 无 Detached Session TTL / 无后台 Turn 终止

**Codex 做法**：
```rust
// context/codex/codex-rs/exec-server/src/server/session_registry.rs:119-140
async fn expire_if_detached(&self, session_id: String, connection_id: ConnectionId) {
    tokio::time::sleep(DETACHED_SESSION_TTL).await;  // 10s
    let entry = self.sessions.lock().await.get(&session_id).cloned();
    if entry can expire → remove + shutdown process
}
```

10 秒 TTL 后如果未重连 → kill 后台进程 → 释放资源。

**nano-agent 现状**：无 TTL 机制。

```typescript
// workers/orchestrator-core/src/user-do/ws-runtime.ts:237-245
async markDetached(sessionUuid: string): Promise<void> {
  await ctx.put(sessionKey(sessionUuid), {
    ...entry,
    status: "detached",          // ← 永久 detached，不会过期
    last_seen_at: new Date().toISOString(),
  });
}
```

Agent DO 断连后 phase 变为 `unattached`，但 `turn_running` 中的 turn **不会停止**：

```typescript
// ws-runtime.ts:247-249 — webSocketClose
if (state.actorState.phase === "turn_running") {
  const attached = transitionPhase(state.actorState, "attached");
  ctx.setState({ ...state, actorState: transitionPhase(attached, "unattached") });
}
```

transition 到 `unattached`，但 kernel 的 turn loop 在 DO 内存中**继续运行**（DO 未被销毁）。新的 turn 不能启动（因为 phase 是 `unattached`，只能接受 `session.start` / `session.resume`），但正在运行的 turn 的 step loop 不会中断。

**影响**：如果客户端在 turn 中间断开并永远不重连，turn 会消耗 DO 的 CPU 时间和 LLM 配额直到 steploop 自然结束。没有超时机制来终止孤立的 turn。

**定位**：
- `workers/orchestrator-core/src/user-do/ws-runtime.ts:237-245`（无 TTL）
- `workers/agent-core/src/host/do/session-do/ws-runtime.ts:243-260`（webSocketClose 不 cancel turn）

---

#### GAP-5: 无客户端自动重连

**Codex 做法**：RemoteControlWebsocket 有完整的自动重连循环（指数退避 + auth recovery + enrollment 恢复）。

**nano-agent 现状**：

```typescript
// clients/web/src/client.ts:84-85
socket.addEventListener("close", cleanup);
socket.addEventListener("error", cleanup);
```

`cleanup()` 仅清除 heartbeat timer，不重连。重连由调用方（页面组件）负责。

**影响**：这不是 LLM wrapper 层或 API 层的问题，而是客户端实现层面的缺失。但直接影响前端可用性。

**定位**：`clients/web/src/client.ts:84-85`

---

#### GAP-6: 无跨 Worker 的 Turn 状态恢复

**Codex 做法**：Rollout 文件是 JSONL，与进程生命周期解耦。`reconstruct_history_from_rollout()` 可以从任意 rollout 文件完整恢复会话。

**nano-agent 现状**：Checkpoint 存储在 DO storage 中，绑定到单个 DO 实例。如果 DO 被回收（CF 的 eviction），checkpoint 可能丢失（取决于 CF DO 的 storage 语义）。没有从 D1（`nano_conversation_messages`）恢复完整 agent state 的机制。

```typescript
// workers/agent-core/src/host/checkpoint.ts:302-303 — restore
async restoreCheckpoint(storage): Promise<SessionCheckpoint | null> {
  const raw = await storage.get<SessionCheckpoint>("nacp_session:checkpoint");
  // ← 仅从 DO storage 恢复，不 fallback 到 D1
}
```

Agent DO 重建时（如 CF 迁移 DO 到新机器），`restoreFromStorage()` 恢复 checkpoint，但 checkpoint 不包括完整的历史消息（仅 replay fragment 的 200 frames + kernel snapshot）。如果 DO 被冷启动（无 storage），会话将丢失除了 D1 中 `nano_conversation_messages` 之外的几乎所有运行时状态。

**影响**：极端场景（DO migration）下，客户端重连时可能发现会话状态不完整。

**定位**：
- `workers/agent-core/src/host/checkpoint.ts:43-56`（SessionCheckpoint 结构）
- `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`（恢复仅从 DO storage）

---

#### GAP-7: 无 session.attachment.superseded 对 Agent-Core 层的通知

**Codex 做法**：exec-server 的 `SessionEntry.has_active_connection()` 检查阻止双重 attach。

**nano-agent 现状**：

Orchestrator User DO 在 `handleWsAttach()` 中处理 superseded：
```typescript
// user-do/ws-runtime.ts:86-110
if (current) {
  ctx.emitServerFrame(sessionUuid, {
    kind: "session.attachment.superseded",
    reason: "reattach",
  });
  current.socket.close(4001, "attachment_superseded");
}
```

但 agent-core Session DO 的 `SessionWebSocketHelper.attach()` 在重复 attach 时抛错：
```typescript
// packages/nacp-session/src/websocket.ts:73-79
attach(socket: SessionSocketLike): void {
  if (this.attached) {
    throw new NacpSessionError(
      ["session already has an active WebSocket attachment"],
      SESSION_ERROR_CODES.NACP_SESSION_ALREADY_ATTACHED,
    );
  }
}
```

如果 orchestrator 已经关闭旧 socket 并 attach 新的，agent DO 不会收到 `detach()` 调用（因为旧 socket 在 orchestrator 层被关闭，agent DO 层的 close handler 会异步触发）。这中间有一个 race condition：新请求可能在新 socket 的 `handleResume()` 之前到达，而 `helper` 仍认为旧 socket 在 attached 状态。

实际保护：`attachHelperToSocket()` 用 try/catch 包裹：
```typescript
// session-do-runtime.ts:666-682
private attachHelperToSocket(rawSocket: unknown): void {
  try {
    helper.attach({ ... });
  } catch {
    // reconnect path owns the already-attached case
  }
}
```

**影响**：如果 race condition 发生，新的 resume 请求可能被忽略（catch block 为空），客户端重连后无法获得 replay。

**定位**：
- `packages/nacp-session/src/websocket.ts:73-79`（双重 attach 抛错）
- `workers/agent-core/src/host/do/session-do-runtime.ts:679`（catch block 为空）

---

### 🟢 改善性缺口

#### GAP-8: 无 subscribe_cursor 等价物（后端侧 catch-up）

**Codex 做法**：`subscribe_cursor` 存储在 `WebsocketState` 中，重连时通过 HTTP header 发送，后端从此 cursor 恢复事件流。

**nano-agent 现状**：Orchestrator 层的 `relay_cursor` 类似但不完全相同。Relay cursor 是客户端侧的概念（"我投递到哪个位置了"），而 subscribe_cursor 是后端流的概念（"请从这里开始发送"）。nano-agent 的 NDJSON 流从 agent-core 读取时永远是实时流，没有 seek 能力。

**影响**：如果 agent-core 重启或 DO migration 发生，NDJSON 流 reseed，client 的旧 cursor 可能指向不存在的 offset。

**定位**：`workers/orchestrator-core/src/parity-bridge.ts`（readNdjsonFrames 不支持 seek）

#### GAP-9: 无 Replay 失败的 Graceful Degradation

当 `NACP_REPLAY_OUT_OF_RANGE` 发生在 agent-core 层时，客户端只收到错误。没有类似 Codex `Lagged { skipped: N }` 的通知来告知客户端 "你有 N 个事件被跳过了"。

**定位**：`packages/nacp-session/src/replay.ts:62-68`（throw 而不是 graceful degrade）

#### GAP-10: 无 SessionEnd 后的 Replay 拒绝

Orchestrator 的 `handleWsAttach()` 检查 `entry.status === "ended"` 并返回错误。但如果 session 在客户端重连之前刚刚结束（race condition），客户端可能收到 `session.end` 帧然后立即尝试 reconnect → 被拒绝但不知道原因（返回的是 generic error）。

**定位**：`workers/orchestrator-core/src/user-do/ws-runtime.ts:59-61`

---

## 5. 汇总表

| ID | 缺口 | 严重度 | 阻塞前端？ | 定位 |
|----|------|--------|-----------|------|
| GAP-1 | ReplayBuffer 容量不足（200/stream, 1000 total），溢出后抛错 | 🔴 | **是** — 断连后重连可能永久丢失事件 | `packages/nacp-session/src/replay.ts:58-68` |
| GAP-2 | 双层 Seq 不一致（orchestrator seq ≠ agent stream_seq），Ack 验证失败 | 🔴 | **是** — Ack 错配导致连接不可靠 | `clients/web/src/client.ts:71-76` + `websocket.ts:263-272` |
| GAP-3 | 重连无会话状态快照（ActorState 不推送） | 🔴 | **是** — 前端无法渲染正确的 UI 状态 | `actor-state.ts` + `ws-runtime.ts:197-213` |
| GAP-4 | 无 Detached TTL，断连后 Turn 无限运行消耗资源 | 🟡 | 间接 — 资源泄漏影响服务稳定性 | `user-do/ws-runtime.ts:237-245` |
| GAP-5 | 客户端无自动重连逻辑 | 🟡 | 间接 — 用户体验差 | `clients/web/src/client.ts:84-85` |
| GAP-6 | DO migration 场景下无法从 D1 恢复完整会话状态 | 🟡 | 极端场景 | `checkpoint.ts:43-56` + `ws-runtime.ts:197-213` |
| GAP-7 | Agent DO 层无 superseded attachment 保护（race） | 🟡 | 边缘 race | `session-do-runtime.ts:679` |
| GAP-8 | NDJSON 流不支持 seek/cursor 恢复 | 🟢 | 不 — DO 重启罕见 | `parity-bridge.ts` |
| GAP-9 | Replay 失败无 Graceful Degradation | 🟢 | 不 | `replay.ts:62-68` |
| GAP-10 | SessionEnd 后的重连无友好错误 | 🟢 | 不 | `ws-runtime.ts:59-61` |

---

## 6. 优先级建议

### P0 — 必须修复才能支持可靠前端
1. **GAP-1 (ReplayBuffer 容量)** — 将 replay 从纯内存 ring buffer 扩展为支持 D1/DO storage 的 persistent buffer，或者至少支持 graceful degradation（发送 `Lagged` 通知而不是 throw）
2. **GAP-3 (会话状态快照)** — 在 `session.resume` 响应或首个 replayed frame 之前发送 `session.status` 帧，携带 `phase`, `activeTurnId`, `modelId`

### P1 — 严重影响 UX
3. **GAP-2 (双层 Seq 统一)** — 让客户端 ack 使用正确的序列号层，或统一 orchestrator 和 agent-core 的序列号空间
4. **GAP-4 (Detached TTL)** — 在 orchestrator 层实现可配置的 detached TTL，超时后 cancel turn + end session

### P2 — 改善性
5. **GAP-5 (客户端重连)** — 在 `openSessionStream` 中实现自动重连 + 指数退避
6. **GAP-6 (D1-based session recovery)** — 在 checkpoint restore 失败时 fallback 到 D1 重建

---

## Appendix: 关键源码引用索引

### nano-agent 侧
| 文件 | 行号 | 内容 |
|------|------|------|
| `packages/nacp-session/src/replay.ts` | 27-29 | maxPerStream=200, maxTotal=1000 |
| `packages/nacp-session/src/replay.ts` | 58-68 | replay() out-of-range throw |
| `packages/nacp-session/src/websocket.ts` | 73-79 | attach() already-attached throw |
| `packages/nacp-session/src/websocket.ts` | 239-250 | handleResume() |
| `packages/nacp-session/src/websocket.ts` | 263-272 | handleAck() seq validation |
| `packages/nacp-session/src/delivery.ts` | 22-64 | AckWindow (maxUnacked=50, timeout=30s) |
| `workers/agent-core/src/host/actor-state.ts` | — | ActorState (phase, activeTurnId, pendingInputs) |
| `workers/agent-core/src/host/checkpoint.ts` | 43-56 | SessionCheckpoint 结构 |
| `workers/agent-core/src/host/do/session-do/ws-runtime.ts` | 197-213 | session.resume handler |
| `workers/agent-core/src/host/do/session-do/ws-runtime.ts` | 243-260 | webSocketClose (transition to unattached) |
| `workers/agent-core/src/host/do/session-do-runtime.ts` | 583-599 | alarm() health check + checkpoint |
| `workers/agent-core/src/host/do/session-do-runtime.ts` | 666-682 | attachHelperToSocket (catch empty) |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts` | 56-157 | handleWsAttach() |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts` | 133-136 | replayCursor calculation |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts` | 237-245 | markDetached() (no TTL) |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts` | 257-282 | forwardFramesToAttachment() |
| `clients/web/src/client.ts` | 29-87 | openSessionStream() (no reconnect) |
| `clients/web/src/client.ts` | 71-76 | ack uses orchestrator seq → agent stream_uuid |

### Codex 侧
| 文件 | 行号 | 内容 |
|------|------|------|
| `exec-server/src/server/session_registry.rs` | 15-17 | DETACHED_SESSION_TTL = 10s |
| `exec-server/src/server/session_registry.rs` | 58-117 | attach(resume_session_id) |
| `exec-server/src/server/session_registry.rs` | 119-140 | expire_if_detached() |
| `core/src/codex/rollout_reconstruction.rs` | 86-301 | reconstruct_history_from_rollout() |
| `core/src/codex.rs` | 2369-2473 | record_initial_history() resume/fork paths |
| `protocol/src/protocol.rs` | 2782-2789 | RolloutItem enum |
| `protocol/src/protocol.rs` | 2126-2145 | SessionConfiguredEvent |
| `protocol/src/protocol.rs` | 1786-1806 | AgentStatus (Running/Interrupted/Completed/...) |
| `app-server/src/transport/remote_control/websocket.rs` | 113-127 | RemoteControlWebsocket struct |
| `app-server/src/transport/remote_control/websocket.rs` | 235-319 | connect() with backoff + auth recovery |
| `app-server/src/transport/remote_control/websocket.rs` | 59-105 | BoundedOutboundBuffer (seq_id + ack) |
| `app-server-client/src/remote.rs` | 802-903 | event delivery (lossless/best-effort) |
| `thread-store/src/types.rs` | 46-54 | ResumeThreadRecorderParams |
| `thread-store/src/types.rs` | 65-72 | LoadThreadHistoryParams |
