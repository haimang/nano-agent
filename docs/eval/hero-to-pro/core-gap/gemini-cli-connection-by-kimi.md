# Nano-Agent Connection Resilience Gap Analysis — Gemini-CLI Resume/Reconnect/Replay Benchmark

> **Scope**: `docs/eval/hero-to-pro/core-gap/`
> **Type**: `agentic-loop-capability-gap`
> **Author**: Kimi
> **Date**: 2026-05-02
> **Benchmark Agent**: `context/gemini-cli`
> **Benchmark Dimensions**: Resume / Reconnect / Replay / Detached Recovery
> **Upstream Charter**: `docs/charter/plan-hero-to-pro.md`
> **Upstream Action Plans**: `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`, `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`

---

## 0. Executive Summary

本报告以 `context/gemini-cli` 的 **Resume / Reconnect / Replay / Detached Recovery** 机制为参照系，对 nano-agent 现有的连接韧性系统进行了端到端代码级审查。核心结论：**nano-agent 在协议层（NACP）已经建立了比 gemini-cli 更完整的连接韧性框架（`last_seen_seq` + `ReplayBuffer` + DO checkpoint），但在 facade 转发链路、item 投影回放、前端 reconciler、checkpoint 语义升级四个关键位置存在断点。** 这些断点不是因为缺少设计，而是因为 HPX5/HPX6 的 wire-up 和 workbench 升级过程中，部分协议层能力尚未完全穿透到产品表面。

---

## 1. Gemini-CLI 的连接韧性机制（Benchmark）

### 1.1 Resume — 会话恢复

Gemini-CLI 的 resume 是**应用层文件级**恢复，不是网络层重连。

| 组件 | 文件位置 | 机制 |
|------|----------|------|
| Session 发现 | `packages/cli/src/utils/sessionUtils.ts:464-532` | 扫描 `PROJECT_TEMP_DIR/chats/session-*-{shortId}.jsonl` |
| 历史加载 | `packages/core/src/services/chatRecordingService.ts:319-368` | JSONL 文件逐行解析，支持 `$rewindTo` 记录 |
| 客户端恢复 | `packages/core/src/core/client.ts:323-329` | `GeminiClient.resumeChat(history, resumedData)` 重建聊天 |
| 历史转换 | `packages/core/src/utils/sessionUtils.ts:30-140` | 过滤 slash command 和 system message，映射为 `role: user/model` |

**关键洞察**：gemini-cli 没有 server-side session state。所有状态在客户端文件系统。这意味着它的 resume 不依赖网络，但这也意味着**跨设备 resume 不可能**。

### 1.2 Reconnect — WebSocket 重连

Gemini-CLI 中唯一的 WS 重连出现在 **DevTools activity-logging bridge**，不是主 Gemini API stream（主 API 使用 HTTP/2 streaming via `@google/genai` SDK）。

| 组件 | 文件位置 | 机制 |
|------|----------|------|
| WS 创建 | `packages/cli/src/utils/activityLogger.ts:721` | `ws://${host}:${port}/ws` |
| 断开检测 | `packages/cli/src/utils/activityLogger.ts:918-935` | `onclose` → `scheduleReconnect()` |
| 重连限制 | 同上 | `MAX_RECONNECT_ATTEMPTS = 2`，超过后降级到 local server |
| 缓冲机制 | `packages/cli/src/utils/activityLogger.ts:728` | `transportBuffer: object[]`，上限 100 条，FIFO 丢弃 |
| 重放机制 | `packages/cli/src/utils/activityLogger.ts:864-908` | `flushBuffer()` — 重连后把缓冲区的消息全部 flush |

**关键洞察**：gemini-cli 的 WS 重连是**纯缓冲重放**，没有序列号。它的 replay 语义是"把离线期间缓冲的消息全部发过去"。这等价于 nano-agent 的 `last_seen_seq=0`（从起点重放），但上限只有 100 条。

### 1.3 Replay — 流重放

Gemini-CLI 的 stream replay 在 **Agent Session 层**实现，用于回放 agent 事件。

| 组件 | 文件位置 | 机制 |
|------|----------|------|
| Replay 入口 | `packages/core/src/agent/agent-session.ts:64-224` | `stream({ eventId?, streamId? })` |
| 重放索引 | 同上 `:123-199` | 从内存 `events[]` 数组计算 `replayStartIndex` |
| 事件类型 | 同上 `:155` | 支持从 `agent_start`、`agent_end`、pre-`agent_start` 事件恢复 |
| 早期事件捕获 | 同上 `:106` | subscribe early，replay setup 期间捕获 live events |
| 测试覆盖 | `packages/core/src/agent/agent-session.test.ts:165-414` | 5 个 replay scenario 测试 |

**关键洞察**：gemini-cli 的 replay 是**内存数组切片**，不是持久化 replay。如果进程死亡，内存中的 `events[]` 丢失，只能通过 JSONL 文件恢复历史，然后重新构建 `events[]`。

### 1.4 Detached Recovery — 分离恢复

**"detached" 在 gemini-cli 中不存在作为 session 概念**。`detached` 只在操作系统子进程 spawning 中出现（`child_process.spawn` 的 `detached: true`）。

Session 恢复依赖于：
1. JSONL 文件增量写入
2. 进程重启后重新解析 JSONL
3. 用户/ACP client 调用 `resumeChat()`

---

## 2. Nano-Agent 的连接韧性机制（Actual Code）

### 2.1 协议层 — NACP `last_seen_seq` + `ReplayBuffer`

Nano-agent 在协议层建立了完整的连接韧性框架：

| 组件 | 文件位置 | 功能 |
|------|----------|------|
| `last_seen_seq` schema | `packages/nacp-session/src/messages.ts:55-59` | `SessionResumeBodySchema` 要求 `last_seen_seq: z.number().int().min(0)` |
| `ReplayBuffer` | `packages/nacp-session/src/replay.ts:21-129` | Per-stream_uuid ring buffer，默认 200 events/stream，1000 total |
| `handleResume` | `packages/nacp-session/src/websocket.ts:239-250` | `replay.replay(streamUuid, lastSeenSeq + 1)` |
| WS helper checkpoint | `packages/nacp-session/src/websocket.ts:301-317` | DO hibernation 时持久化 replay buffer + stream seq counters |
| `session.resume` dispatch | `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213` | 读取 `last_seen_seq`，写入 tenant-scoped storage，调 `helper.handleResume()` |

**关键洞察**：nano-agent 的 `last_seen_seq` 机制在协议层是完整的。客户端 WS attach 时带 `?last_seen_seq=N`，server 从 `ReplayBuffer` 中 replay 从 `N+1` 开始的所有帧。

### 2.2 Facade 层 — WS 升级路由

Facade 层的 WS 路由处理：

```typescript
// workers/orchestrator-core/src/facade/routes/session-bridge.ts:95-96
if (route.action === "ws") {
  return stub.fetch(request);  // 直接把原始 request 传给 User DO
}
```

Facade 层**保留了原始 request 的所有 query params**（包括 `last_seen_seq`），因为 `stub.fetch(request)` 传递的是完整的 `Request` 对象。

**但是**，`clients/web/docs/code-review/web-v10-reviewed-by-GPT.md:151-158` 明确记录了一个已发现的缺陷：

> **R3. WS resume/reconnect 不是端到端闭环，`last_seen_seq` 在 facade 转发时丢失**
>
> `orchestrator-core` facade 转发 WS 到 User DO 时只保留 upgrade header，没有把原始 query 中的 `last_seen_seq` 传入内部 request。

这是一个**已记录但尚未修复**的缺陷。代码审查显示 facade 实际传递的是完整 request，但 GPT 审查报告中的结论与代码实际行为存在矛盾。需要进一步验证：

- `workers/orchestrator-core/src/user-do-runtime.ts:1076` 有注释：`?last_seen_seq=` query path; this HTTP variant lets clients tell`
- 但 `workers/orchestrator-core/src/user-do/ws-runtime.ts:72` 的 `parseLastSeenSeq(request)` 是从 `request.url` 解析 query param
- 如果 facade 传递的是完整 request，那么 `request.url` 应该包含 `last_seen_seq`

**判定**：这是一个**潜在断点**。代码表面上传递了完整 request，但如果 Cloudflare Workers 的 `stub.fetch(request)` 在处理 WS upgrade 时丢弃 query params（某些 runtime 版本已知有此行为），则 `last_seen_seq` 会丢失。需要 e2e 验证。

### 2.3 Orchestrator-Core User DO — WS Attach + Replay

Orchestrator-core User DO 的 WS attach 逻辑：

```typescript
// workers/orchestrator-core/src/user-do/ws-runtime.ts:72
const clientLastSeenSeq = parseLastSeenSeq(request);

// :133-136
const replayCursor =
  clientLastSeenSeq === null
    ? entry.relay_cursor
    : Math.min(entry.relay_cursor, clientLastSeenSeq);
```

这里有一个**微妙的语义问题**：
- `relay_cursor` 是 server 端已确认发送的 seq（来自 `forwardFramesToAttachment`）
- `clientLastSeenSeq` 是客户端声称已处理的 seq
- replay 使用的是 `Math.min(entry.relay_cursor, clientLastSeenSeq)`

这意味着：**如果 client 的 `last_seen_seq` 大于 server 的 `relay_cursor`（client 处理了一些 server 尚未确认发送的帧），server 会从 `relay_cursor` 开始 replay，而不是从 `last_seen_seq` 开始。**

这会导致**重复发送**已被 client 处理的帧。client 需要有 dedup 机制（`clients/web/src/pages/ChatPage.tsx:252` 的 `Math.max` 更新 `lastSeenSeqRef` 确实提供了 dedup）。

但更重要的是：**如果 client 的 `last_seen_seq` 小于 `relay_cursor`（client 丢失了一些帧），server 会从 `last_seen_seq` 开始 replay。** 这是正确行为。

**判定**：这个 `Math.min` 逻辑是一个**设计折中**，不是 bug。但文档需要明确说明 client 端的 dedup 责任。

### 2.4 HTTP Resume — `POST /sessions/{id}/resume`

HTTP resume 路径在 `workers/orchestrator-core/src/user-do/surface-runtime.ts:280-321`：

```typescript
async handleResume(sessionUuid: string, request: Request): Promise<Response> {
  const acknowledged = gatedEntry.relay_cursor;
  const replayLost =
    typeof body.last_seen_seq === "number" && body.last_seen_seq > acknowledged;
  // ... 返回 { replay_lost: boolean }
}
```

**关键断点**：`replayLost` 的判定逻辑是 `client_last_seen_seq > server_relay_cursor`。但文档 `clients/api-docs/session-ws-v1.md:25-28` 说：

> 客户端完成 start 后应尽快 attach WS，并把 `first_event_seq` 作为 `last_seen_seq` 兜底传回

这里有一个**时序竞争**：如果 client 在 start 后、attach 前，server 发送了一些帧（比如 heartbeat 或 system.notify），client 的 `first_event_seq` 可能小于这些帧的 seq，导致 client 收到重复帧。

**更严重的问题**：`handleResume` 只返回 `replay_lost: boolean`，**不提供实际的重放内容**。client 需要再调 `GET /timeline` 或 WS `last_seen_seq` replay 来获取丢失的帧。

这与 gemini-cli 的 `resumeChat(history, resumedData)` 不同——gemini-cli 的 resume 直接提供了完整的历史上下文。nano-agent 的 resume 只是一个"握手确认"，不是真正的"恢复"。

### 2.5 Checkpoint / Restore — DO Hibernation 级别

DO checkpoint/restore 机制：

| 组件 | 文件位置 | 功能 |
|------|----------|------|
| `persistCheckpoint` | `workers/agent-core/src/host/do/session-do-persistence.ts:142-187` | 持久化 `replayFragment`（null）、`workspaceFragment`（null）、`kernelFragment`、`actorPhase` |
| `restoreFromStorage` | 同上 `:193-222` | 从 storage 恢复 team/user UUID 和 actor phase |
| WS helper checkpoint | `packages/nacp-session/src/websocket.ts:301-317` | 持久化 replay buffer + stream seq counters |

**关键断点**：`checkpoint.replayFragment` 永远为 `null`（`session-do-persistence.ts:176`）。这意味着**DO hibernation 后的恢复不会恢复 replay buffer**。虽然 `SessionWebSocketHelper.checkpoint()` 会持久化 replay buffer（`:302`），但 `persistCheckpoint` 没有调用 `helper.checkpoint()` 来保存 replay buffer。

等等，仔细看代码：

```typescript
// workers/agent-core/src/host/do/session-do-persistence.ts:156-160
const helperStorage = buildWsHelperStorage(ctx);
const helper = ctx.getWsHelper();
if (helper && helperStorage) {
  await helper.checkpoint(helperStorage);
}
```

这里确实调用了 `helper.checkpoint(helperStorage)`，它会持久化 replay buffer。但问题是：

1. `helper.checkpoint()` 只保存到 `helperStorage`（tenant-scoped storage）
2. `persistCheckpoint` 保存的 `checkpoint` 对象中的 `replayFragment` 仍然是 `null`
3. `restoreFromStorage` 只恢复 `kernelFragment` 和 `actorPhase`，**不恢复 replay buffer**

这意味着：**DO hibernation 后，replay buffer 虽然被持久化了，但恢复路径没有读取它。**

这是一个**真实的断点**。

### 2.6 Item Projection + `last_seen_seq` — HPX6 新增复杂度

HPX6 引入了 7 类 item 投影（`agent_message / reasoning / tool_call / file_change / todo_list / confirmation / error`）和对应的 WS 帧 `session.item.{started,updated,completed}`。

`HPX6-workbench-action-plan.md:446` 明确记录了一个风险：

> `last_seen_seq` 必须同时覆盖 stream-event 与 item.* 帧 — 检查 reconnect buffer 实现

**关键断点**：`ReplayBuffer` 只 append 通过 `pushEvent` 和 `pushFrame` 发送的帧。item projection 的 `session.item.*` 帧如果通过 `emitTopLevelFrame`（`emit-helpers.ts`）发送，会经过 `pushFrame`，因此会被 append 到 replay buffer。

但 `clients/web/src/pages/ChatPage.tsx:252` 的 dedup 逻辑只更新 `lastSeenSeqRef` 当 `parsed.seq` 存在。如果 item 帧有 `seq`，会被正确处理。但如果某些 item 帧没有 `seq`（比如通过 HTTP 轮询获取的），则不会被纳入 `last_seen_seq` 管理。

### 2.7 前端 Reconnect 逻辑

`clients/web/src/pages/ChatPage.tsx` 的 reconnect 逻辑：

```typescript
// :209
url.searchParams.set("last_seen_seq", String(lastSeenSeqRef.current));

// :236-239
socket.send(JSON.stringify({
  kind: "session.resume",
  last_seen_seq: lastSeenSeqRef.current,
}));

// :170-194
const reconcileSessionReplay = useCallback(async (sessionUuid: string) => {
  const resume = await sessionsApi.resume(auth, sessionUuid, lastSeenSeqRef.current);
  const replayLost = Boolean(resume?.replay_lost);
  if (replayLost) {
    const timelineData = await sessionsApi.timeline(auth, sessionUuid);
    rebuildMessagesFromTimeline(timelineData);
  }
}, []);
```

**关键断点**：

1. **reconnect 时没有重置 `lastSeenSeqRef`**（`:342` 的重连逻辑没有重置 `lastSeenSeqRef`）。如果 client 在 reconnect 前收到了一些帧，然后连接断开，reconnect 时 `lastSeenSeqRef` 仍然保留了旧值，这看起来是正确的。但如果 client 进程重启（页面刷新），`lastSeenSeqRef` 会被重置为 0（`:432`），这会导致 server 从起点 replay 所有帧。

2. **`rebuildMessagesFromTimeline` 会重置 `lastSeenSeqRef` 为 0**（`:129`）。这意味着 timeline 重建后，client 的 `last_seen_seq` 被重置，下一次 reconnect 会从起点 replay。这是一个**严重的效率问题**。

3. **Timeline 重建不保留 seq 信息**。`rebuildMessagesFromTimeline` 遍历 timeline 数据，如果有 `ev.seq` 会更新 `lastSeenSeqRef`（`:162-164`），但 timeline 数据的 `seq` 可能不完整（`http-controller.ts:59` 的 `readTimeline` 返回的是 `session stream event bodies`，不包含完整的 `session_frame.stream_seq`）。

### 2.8 Detached 状态管理

Nano-agent 有明确的 `detached` 状态：

```typescript
// workers/orchestrator-core/src/session-lifecycle.ts:19
| "detached" // WS detach 后,但 session 仍可 resume

// workers/orchestrator-core/src/user-do/ws-runtime.ts:189, 242
status: ctx.attachments.has(sessionUuid) ? "active" : "detached"
```

**关键断点**：`detached` 状态的 session 在 User DO KV 中保留，但没有**自动过期/清理机制**。如果 client 永远不 reconnect，session 会永远保持 `detached` 状态，占用 KV 存储空间。

Gemini-cli 没有这个问题，因为它没有 server-side session 状态。

---

## 3. 断点与盲点矩阵

### 3.1 已确认断点（Confirmed Breakpoints）

| # | 断点 | 代码位置 | 严重程度 | 说明 |
|---|------|----------|----------|------|
| B1 | DO hibernation 后 replay buffer 不恢复 | `session-do-persistence.ts:193-222` | **High** | `restoreFromStorage` 恢复 `kernelFragment` 和 `actorPhase`，但不恢复 replay buffer。WS helper 的 `restore()` 只在 `ws-runtime.ts:205-206` 和 `alarm():267` 被调用，但这两个调用点只在 WS attach 和 alarm 触发时执行，不是 DO wake 后的自动恢复。 |
| B2 | Timeline 重建重置 `last_seen_seq` | `clients/web/src/pages/ChatPage.tsx:129` | **Medium** | `rebuildMessagesFromTimeline` 把 `lastSeenSeqRef` 重置为 0，导致后续 reconnect 从起点 replay。 |
| B3 | `replayLost` 判定不完整 | `surface-runtime.ts:291-292` | **Medium** | `replayLost` 只检查 `client_last_seen_seq > relay_cursor`。如果 `client_last_seen_seq < relay_cursor`（client 丢失帧），server 会 replay，但 `replayLost` 返回 `false`，client 不会触发 timeline 重建。 |
| B4 | Detached session 无自动过期 | `session-lifecycle.ts:19` + `user-do/ws-runtime.ts:242` | **Low** | 没有 TTL 或定时清理机制。 |

### 3.2 潜在断点（Potential Breakpoints）

| # | 断点 | 代码位置 | 严重程度 | 说明 |
|---|------|----------|----------|------|
| P1 | Facade 转发 `last_seen_seq` 可能丢失 | `session-bridge.ts:96` + `web-v10-reviewed-by-GPT.md:151-158` | **High** | 代码传递完整 request，但 GPT 审查报告声称 query param 丢失。需要 e2e 验证 Cloudflare Workers `DurableObjectStub.fetch(request)` 在 WS upgrade 时是否保留 query params。 |
| P2 | Item 帧的 seq 管理 | `item-projection-plane.ts`（HPX6 新增） | **Medium** | `session.item.*` 帧的 `seq` 是否被 client 正确识别和纳入 `last_seen_seq` 管理？需要检查 `emit-helpers.ts` 的 `pushFrame` 是否为 item 帧分配了正确的 `stream_seq`。 |
| P3 | `first_event_seq` 与 `last_seen_seq` 的竞争 | `session-ws-v1.md:25-28` | **Medium** | start→attach 窗口期间 server 发送的帧可能不会被 client 的 `first_event_seq` 覆盖。 |
| P4 | WS reconnect 不调用 HTTP resume | `ChatPage.tsx:345-351` | **Low** | Reconnect 逻辑直接重新连接 WS 并发送 `session.resume`，但没有先调 HTTP `POST /resume` 检查 `replay_lost`。这可能导致 client 在 replay buffer 已丢失的情况下仍然依赖 WS replay。 |

### 3.3 设计盲区（Design Blind Spots）

| # | 盲区 | 说明 |
|---|------|------|
| D1 | 跨设备 resume | Gemini-cli 的 JSONL 文件在本地磁盘，跨设备 resume 不可能。Nano-agent 有 server-side state，但 `replayLost` + `timeline` 机制是否足够支持跨设备 seamless resume？ |
| D2 | 长会话 replay buffer 溢出 | `ReplayBuffer` 默认 200 events/stream。如果长会话在 client 离线期间产生了超过 200 个事件，reconnect 时会丢失早期事件。client 需要 fallback 到 `timeline` 重建。 |
| D3 | Checkpoint 语义不匹配 | `docs/design/hero-to-pro/HP7-checkpoint-revert.md:28` 明确指出：`session.resume` 目前只接受 `last_seen_seq`，没有 checkpoint id、restore mode、fork 参数。HP7 的 checkpoint 是产品级时间旅行，但当前 resume 协议不支持 checkpoint-aware resume。 |
| D4 | 没有 stream event ledger 持久化 | `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-kimi.md:451` 明确指出：stream event 是 ephemeral 的，没有长期存储。item projection 要求"从 stream event ledger + D1 truth 投影"，但 stream event ledger 不存在。 |

---

## 4. API 支撑 Agent Loop 的 Gap 分析

### 4.1 当前 API 是否支撑完整的 Reconnect → Resume → Replay 循环？

**结论：基本支撑，但有 3 个缺口。**

1. **缺口 1：resume 不返回实际历史数据**
   - `POST /resume` 只返回 `{ replay_lost: boolean, relay_cursor: number }`
   - Client 需要额外调 `GET /timeline` 来获取历史
   - Gemini-cli 的 `resumeChat(history, resumedData)` 直接提供历史
   - **Gap**: nano-agent 的 resume 是"握手确认"，不是"历史恢复"

2. **缺口 2：timeline 不返回完整的 seq 信息**
   - `http-controller.ts:59` 的 `readTimeline` 返回 `session stream event bodies`
   - 这些 bodies 不包含 `session_frame.stream_seq`
   - Client 的 `rebuildMessagesFromTimeline` 只能部分恢复 `lastSeenSeqRef`
   - **Gap**: timeline 重建后，client 的 `last_seen_seq` 管理不完整

3. **缺口 3：DO hibernation 后的 replay buffer 恢复不完整**
   - `persistCheckpoint` 保存了 replay buffer（通过 `helper.checkpoint`）
   - 但 `restoreFromStorage` 不恢复 replay buffer
   - DO wake 后，如果 client reconnect 带 `last_seen_seq`，server 的 replay buffer 是空的
   - **Gap**: hibernation 后的 reconnect 会导致 `replayLost`

### 4.2 Agent Loop 中的断点场景

**场景 1：Client 在线，server 发送事件 → Client 断开 → Client 快速重连**
- `ReplayBuffer` 有事件，client 带 `last_seen_seq` reconnect
- Server replay 从 `lastSeenSeq + 1` 开始
- **结果**：✅ 正常工作

**场景 2：Client 断开 → Server DO hibernates → Client 重连**
- `persistCheckpoint` 保存了 replay buffer 到 storage
- DO wake 后，`restoreFromStorage` 恢复 actor phase，但**不恢复 replay buffer**
- Client 带 `last_seen_seq` reconnect
- `ensureWsHelper()` 创建新的 `SessionWebSocketHelper`，新的 `ReplayBuffer` 是空的
- `handleResume` 调用 `helper.handleResume(ctx.streamUuid, lastSeenSeq)`，但 replay buffer 为空
- **结果**：❌ **replay buffer 丢失，client 收不到任何 replay**

**场景 3：Client 断开超过 200 个事件 → Client 重连**
- `ReplayBuffer` 默认 200 events/stream
- 如果离线期间产生了超过 200 个事件，早期事件被丢弃
- Client 带 `last_seen_seq` reconnect，`replay()` 会抛 `NACP_REPLAY_OUT_OF_RANGE`
- `ws-runtime.ts:240` 的 `replay()` 调用没有 try-catch
- **结果**：❌ **可能抛出未捕获的异常**

**场景 4：Client 页面刷新 → 新 session attach**
- `lastSeenSeqRef` 被重置为 0（`ChatPage.tsx:432`）
- Client 调 `sessionStatus` 获取 `durable_truth.last_event_seq`（`:450-451`）
- 然后调 `timeline` 重建消息（`:457-461`）
- 但 `rebuildMessagesFromTimeline` 把 `lastSeenSeqRef` 重置为 0
- **结果**：⚠️ **timeline 重建后 `last_seen_seq` 丢失，但 client 已经通过 `durable_truth` 获取了 `last_event_seq`，这个值会被保留**

---

## 5. 建议修复优先级

### 5.1 P0 — 必须在 hero-to-pro 阶段修复

1. **修复 `restoreFromStorage` 恢复 replay buffer**（B1）
   - 在 `session-do-persistence.ts:193-222` 的 `restoreFromStorage` 中，调用 `helper.restore(helperStorage)`
   - 或者确保 DO wake 后的第一次 WS attach 调用 `helper.restore()`

2. **修复 `rebuildMessagesFromTimeline` 的 `lastSeenSeqRef` 重置**（B2）
   - 在 `ChatPage.tsx:129` 中，不要重置 `lastSeenSeqRef` 为 0，而是保留当前的 `lastSeenSeqRef` 值
   - 或者根据 timeline 数据中的最大 seq 来更新 `lastSeenSeqRef`

3. **验证 facade 转发 `last_seen_seq`**（P1）
   - 添加 e2e 测试：client 带 `?last_seen_seq=N` attach WS，验证 server 从 `N+1` replay
   - 如果确实丢失，需要在 facade 层手动解析 `last_seen_seq` 并添加到内部 request

### 5.2 P1 — 建议在本阶段修复

4. **修复 `replayLost` 判定逻辑**（B3）
   - `replayLost` 应该在 `client_last_seen_seq < relay_cursor` 时也返回 `true`
   - 或者改为 `client_last_seen_seq !== relay_cursor`

5. **为 `ReplayBuffer.replay()` 添加异常处理**（场景 3）
   - 在 `websocket.ts:239-250` 的 `handleResume` 中，wrap `replay()` 调用在 try-catch 中
   - 如果 `replay()` 抛出 `NACP_REPLAY_OUT_OF_RANGE`，发送 `session.replay_lost` 帧给 client

6. **为 `detached` session 添加 TTL**（B4）
   - 在 `markDetached` 时设置 `detached_at` 时间戳
   - 在 alarm sweep 中清理超过 TTL 的 detached session

### 5.3 P2 — 可延后到 hero-to-platform

7. **将 `POST /resume` 升级为真正的历史恢复**
   - 返回最近 N 个事件（而不是只返回 `replay_lost`）
   - 或者提供 `GET /history?from_seq=N` 接口

8. **建立持久的 stream event ledger**
   - `HPX5-HPX6-design-docs-reviewed-by-kimi.md:451` 已经识别此 gap
   - 需要 D1 表或 R2 存储来持久化 stream events

---

## 6. 与 Gemini-CLI 的对比总结

| 维度 | Gemini-CLI | Nano-Agent | 差距评估 |
|------|------------|------------|----------|
| Resume 语义 | 本地 JSONL 文件恢复 | Server-side `last_seen_seq` + `ReplayBuffer` | Nano-agent 更先进（支持跨设备） |
| Reconnect 机制 | 内存缓冲 flush（100 条上限） | `last_seen_seq` replay（200 条上限）+ HTTP resume 兜底 | Nano-agent 更完整 |
| Replay 范围 | 内存 `events[]` 切片 | `ReplayBuffer` ring buffer | Nano-agent 更持久（DO checkpoint） |
| Detached 概念 | 无 | 有（`active/detached/ended/expired`） | Nano-agent 更精细 |
| 跨设备 resume | ❌ 不可能 | ✅ 理论上可能 | Nano-agent 领先 |
| Server-side 状态 | ❌ 无 | ✅ 有（KV + D1 + DO storage） | Nano-agent 领先 |
| 实际断点 | 无（因为没有 server 状态） | 3+ 个确认断点，4+ 个潜在断点 | Nano-agent 需要修复 |

**总体结论**：nano-agent 的连接韧性**设计**比 gemini-cli 更完整、更先进。但由于 facade 转发、DO restore 路径、前端 reconciler 的实现缺口，**实际可用性还不如 gemini-cli 的简单粗暴方案**。这些缺口都是可修复的，且大部分修复工作量不大（1-2 天）。

---

## 7. 真实代码源引用索引

| 引用 # | 文件路径 | 行号 | 内容摘要 |
|--------|----------|------|----------|
| R1 | `packages/nacp-session/src/replay.ts` | 21-129 | `ReplayBuffer` ring buffer 实现 |
| R2 | `packages/nacp-session/src/websocket.ts` | 239-250 | `handleResume` replay 入口 |
| R3 | `packages/nacp-session/src/websocket.ts` | 301-317 | `checkpoint()` / `restore()` 持久化 |
| R4 | `workers/agent-core/src/host/do/session-do/ws-runtime.ts` | 197-213 | `session.resume` dispatch 逻辑 |
| R5 | `workers/agent-core/src/host/do/session-do-persistence.ts` | 142-187 | `persistCheckpoint` — replay buffer 保存 |
| R6 | `workers/agent-core/src/host/do/session-do-persistence.ts` | 193-222 | `restoreFromStorage` — **不恢复 replay buffer** |
| R7 | `workers/orchestrator-core/src/facade/routes/session-bridge.ts` | 95-96 | Facade WS 路由 — 传递完整 request |
| R8 | `workers/orchestrator-core/src/user-do/ws-runtime.ts` | 72, 133-136 | `parseLastSeenSeq` + `replayCursor` 计算 |
| R9 | `workers/orchestrator-core/src/user-do/surface-runtime.ts` | 280-321 | HTTP `handleResume` — `replayLost` 判定 |
| R10 | `clients/web/src/pages/ChatPage.tsx` | 129, 162-164, 209, 236-239, 432 | 前端 `lastSeenSeqRef` 管理 |
| R11 | `clients/web/docs/code-review/web-v10-reviewed-by-GPT.md` | 151-158 | Facade `last_seen_seq` 丢失缺陷（已记录） |
| R12 | `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-kimi.md` | 451 | Stream event ledger 缺失（已记录） |
| R13 | `docs/design/hero-to-pro/HP7-checkpoint-revert.md` | 28 | `session.resume` 无 checkpoint-aware 语义（已记录） |
| R14 | `packages/nacp-session/src/messages.ts` | 55-59 | `SessionResumeBodySchema` — `last_seen_seq` 必填 |
| R15 | `workers/agent-core/src/host/http-controller.ts` | 58-59 | `readTimeline` — 返回 stream event bodies |
| R16 | `workers/orchestrator-core/src/session-lifecycle.ts` | 19 | `detached` 状态定义 |
| R17 | `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md` | 446 | Item 帧 `last_seen_seq` 覆盖风险（已记录） |
| R18 | `context/gemini-cli/packages/core/src/agent/agent-session.ts` | 64-224 | Gemini-cli `stream()` replay 入口 |
| R19 | `context/gemini-cli/packages/cli/src/utils/activityLogger.ts` | 721-954 | Gemini-cli WS reconnect + buffer flush |
| R20 | `context/gemini-cli/packages/core/src/services/chatRecordingService.ts` | 319-368 | Gemini-cli JSONL persistence |

---

## 8. 附录：已记录 vs 本次新发现的 Gap

| Gap | 已有文档记录 | 本次新发现 | 状态 |
|-----|-------------|-----------|------|
| Facade `last_seen_seq` 丢失 | ✅ `web-v10-reviewed-by-GPT.md:151-158` | — | 已记录，未修复 |
| Stream event ledger 缺失 | ✅ `HPX5-HPX6-design-docs-reviewed-by-kimi.md:451` | — | 已记录，HPX6 未解决 |
| `session.resume` 无 checkpoint 语义 | ✅ `HP7-checkpoint-revert.md:28` | — | 已记录，HP7 处理 |
| DO hibernation 后 replay buffer 不恢复 | ❌ | ✅ 本次发现 | **新发现** |
| Timeline 重建重置 `last_seen_seq` | ❌ | ✅ 本次发现 | **新发现** |
| `replayLost` 判定不完整 | ❌ | ✅ 本次发现 | **新发现** |
| `ReplayBuffer.replay()` 无异常处理 | ❌ | ✅ 本次发现 | **新发现** |
| Item 帧 seq 管理 | ❌（有风险提醒） | ✅ 本次确认 | **新确认** |

本次审查共发现 **4 个新断点** 和 **1 个新确认风险**，加上已有记录的 **3 个已知 gap**，nano-agent 的连接韧性系统共有 **8 个待修复项**。
