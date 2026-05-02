# Connection Recovery Core-Gap — claude-code vs nano-agent

> Reviewer: GPT-5.4  
> Date: 2026-05-02  
> Scope baseline: `context/claude-code/` 中 Resume / Reconnect / Replay / detached recovery 相关一手代码 + `docs/charter/plan-hero-to-pro.md` + `docs/action-plan/hero-to-pro/{HPX5-wire-up-action-plan,HPX6-workbench-action-plan}.md` + nano-agent 当前 `clients/api-docs/` 与 `workers/{orchestrator-core,agent-core}/` 实现  
> 引用纪律: 仅使用一手代码与当前仓内文档；所有 `path:Lx-Ly` 引用均指向真实文件位置。

---

## 0. TL;DR

**结论一句话**：nano-agent 在 **Resume / Reconnect / Replay** 这条线上，已经具备一个前端可用的 **first-wave server-truth substrate**：有 `detached` 会话状态、有 `first_event_seq + last_seen_seq`、有 `session.attachment.superseded`、有 `/resume` 与 `/timeline` 兜底，也有 agent-core DO hibernation checkpoint。  
但它**还没有形成 claude-code 那种 transport-native 的完整恢复语义**。当前最关键的缺口不是“没有端点”，而是：

1. **public WS 的 replay 主要依赖 reattach query param，不是一个真正的 WS-level resume protocol**（`clients/api-docs/session-ws-v1.md:L273-L295`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L133-L145`, `workers/orchestrator-core/src/user-do/surface-runtime.ts:L280-L320`）。
2. **public top-level frames 没有统一 replay buffer**，断线后只能靠各自 HTTP read-model 重新拼（`workers/orchestrator-core/src/user-do-runtime.ts:L1015-L1063`, `clients/api-docs/items.md:L29-L38`, `clients/api-docs/client-cookbook.md:L87-L103`）。
3. **真正更强的 replay/ack/heartbeat/checkpoint 语义，目前主要存在于 agent-core 内部 `SessionWebSocketHelper`，而不是 public façade**（`packages/nacp-session/src/websocket.ts:L97-L157`, `packages/nacp-session/src/websocket.ts:L239-L317`, `workers/agent-core/src/host/do/session-do/ws-runtime.ts:L197-L236`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L199-L235`）。
4. **detached recovery 更像“后端 hot-state 幸存 + 客户端自己 reattach/reconcile”，还不是“用户可感知的 interrupted-turn resume 产品语义”**（`workers/agent-core/src/host/do/session-do/ws-runtime.ts:L243-L272`, `workers/agent-core/src/host/do/session-do-persistence.ts:L142-L222`, `clients/api-docs/checkpoints.md:L167-L170`, `clients/api-docs/checkpoints.md:L221-L231`）。

所以这条线的真实判断是：

- **对“做一个能重连、能补拉、能继续看的 Web 前端”**：**够用**。  
- **对“做一个成熟 agent loop 前端，让 reconnect/replay/detached recovery 成为产品级保证”**：**还不够**。

---

## 1. 作为对标尺，claude-code 在 connection recovery 上真正做了什么

这次对标我只看 connection recovery，不看通用 wrapper 能力。

### 1.1 它把 reconnect 做进 transport，而不是丢给上层页面自己想办法

`SessionsWebSocket` 本身就内置：

- reconnect delay / reconnect budget（`RECONNECT_DELAY_MS = 2000`, `MAX_RECONNECT_ATTEMPTS = 5`）
- ping interval
- 特判 `4001 session not found`，因为 compaction 期间 server 可能短暂把 session 当 stale（`context/claude-code/remote/SessionsWebSocket.ts:L17-L36`, `context/claude-code/remote/SessionsWebSocket.ts:L255-L299`）
- 显式 `reconnect()`，用于 stale subscription / container shutdown 后强制重连（`context/claude-code/remote/SessionsWebSocket.ts:L389-L403`）

这说明 claude-code 不把“断线了怎么办”留给 UI reducer，而是把它当 transport 自己的职责。

### 1.2 它把 replay 做成“连接恢复后自动补发未确认出站消息”

`WebSocketTransport` 做了 4 件很关键的事：

1. 出站消息进 `messageBuffer`，带 `uuid` 缓冲（`context/claude-code/cli/transports/WebSocketTransport.ts:L105-L109`, `context/claude-code/cli/transports/WebSocketTransport.ts:L660-L681`）  
2. 重连时把 `X-Last-Request-Id` 带上，让 server 告诉客户端“我已经收到了哪条请求”（`context/claude-code/cli/transports/WebSocketTransport.ts:L150-L157`, `context/claude-code/cli/transports/WebSocketTransport.ts:L243-L258`）  
3. 根据 server last-id 只 replay 未确认消息，并把已确认消息从 buffer 驱逐（`context/claude-code/cli/transports/WebSocketTransport.ts:L574-L605`）  
4. replay 后**不**立刻清空 buffer，直到 server 真确认，防止 replay 后再次掉线导致消息再次丢失（`context/claude-code/cli/transports/WebSocketTransport.ts:L622-L634`）

这是一种 **outbound reliable-ish replay**，不是简单的“重新连上再试一次”。

### 1.3 它明确处理 sleep / idle timeout / stale subscription

`WebSocketTransport` 还有：

- 10 分钟 reconnect time budget
- exponential backoff + jitter
- sleep detection：机器睡眠后重置 reconnect budget（`context/claude-code/cli/transports/WebSocketTransport.ts:L25-L36`, `context/claude-code/cli/transports/WebSocketTransport.ts:L465-L553`）
- ping/pong 检查死连接
- keep_alive data frame，专门刷新 proxy idle timer（`context/claude-code/cli/transports/WebSocketTransport.ts:L27-L28`, `context/claude-code/cli/transports/WebSocketTransport.ts:L97-L103`, `context/claude-code/cli/transports/WebSocketTransport.ts:L319-L329`, `context/claude-code/cli/transports/WebSocketTransport.ts:L697-L757`）

上层 `useRemoteSession()` 又补了一层 **stuck-session detector**：60s 无响应就警告并 force reconnect；compaction 期间把 timeout 延长到 3 分钟（`context/claude-code/hooks/useRemoteSession.ts:L37-L42`, `context/claude-code/hooks/useRemoteSession.ts:L534-L561`）。

### 1.4 它的 detached recovery 不只靠 WS，还能从 transcript 恢复并识别中断 turn

`conversationRecovery.ts` 会在 resume 时：

- 反序列化历史 transcript
- 检测当前 session 是否在 mid-turn 被打断
- 对 `interrupted_turn` 自动注入 “Continue from where you left off.” 元消息，形成可继续的输入（`context/claude-code/utils/conversationRecovery.ts:L159-L162`, `context/claude-code/utils/conversationRecovery.ts:L204-L224`, `context/claude-code/utils/conversationRecovery.ts:L272-L333`）

`loadConversationForResume()` 则是集中入口，支持：

- 最近会话 continue
- 指定 session id
- 指定 transcript jsonl 路径

并恢复 file history / session metadata / worktree 等（`context/claude-code/utils/conversationRecovery.ts:L442-L560`）。

`ResumeConversation.tsx` 最终用这套恢复逻辑把会话重新接回 UI（`context/claude-code/screens/ResumeConversation.tsx:L26-L32`, `context/claude-code/screens/ResumeConversation.tsx:L178-L223`）。

**这就是 claude-code 的关键差异**：它不是只有“重连 socket”，而是有 **transport reconnect + outbound replay + transcript resume + interrupted-turn recovery** 四层闭环。

---

## 2. nano-agent 当前已经成立的 connection substrate

先说清楚：nano-agent 这条线并不弱。它只是 **更偏 server-truth / Cloudflare session substrate**，没有把全部恢复语义收敛成一个 transport。

### 2.1 它已经有产品级的 detached session truth，而不是本地进程私有状态

在 nano-agent 里，session status 是显式 durable 状态机，包含 `pending / starting / active / detached / ended / expired`（`workers/orchestrator-core/src/session-lifecycle.ts:L15-L33`）。

`GET /me/sessions` 也明确会返回 `detached` 会话（`clients/api-docs/me-sessions.md:L80-L85`）。  
这点其实是 nano-agent 相比 claude-code 的**独特优势**：它不是靠本地 transcript 猜“上次聊到哪”，而是有服务端 session truth。

### 2.2 它已经补上了 start → ws attach 的 race window

`POST /sessions/{id}/start` 会返回 `first_event_seq`，文档要求客户端 attach WS 时把它带回 `last_seen_seq`，消除 start→attach 丢帧窗口（`clients/api-docs/session.md:L104-L107`, `clients/api-docs/session-ws-v1.md:L23-L30`）。

实现上，`handleStart()` 也确实把 `first_event_seq` 返回给了前端（`workers/orchestrator-core/src/user-do/session-flow/start.ts:L270-L292`）。

### 2.3 它已经有 reattach supersede / device revoke / heartbeat

public WS attach 时，如果已有 attachment：

- server 会 emit `session.attachment.superseded`
- 关闭旧 socket（4001）
- 把新 socket 设为当前 attachment

实现见 `workers/orchestrator-core/src/user-do/ws-runtime.ts:L86-L110`，文档见 `clients/api-docs/session-ws-v1.md:L202-L214`。

device revoke 也会主动把相关 socket 全部踢下线（`workers/orchestrator-core/src/user-do/ws-runtime.ts:L302-L339`）。

此外，server 会每 15s 发 `session.heartbeat`（`workers/orchestrator-core/src/user-do/ws-runtime.ts:L112-L123`, `clients/api-docs/session-ws-v1.md:L152-L159`）。

### 2.4 它已经有 reconnect 之后的 durable reconciliation surfaces

这条线 nano-agent 做得并不差：

- `GET /sessions/{id}/timeline`：durable stream event 时间线（`clients/api-docs/session.md:L186-L193`, `workers/orchestrator-core/src/user-do/session-flow/verify-read.ts:L58-L67`）
- `GET /sessions/{id}/history`：durable message history（`clients/api-docs/session.md:L190-L193`, `workers/orchestrator-core/src/user-do/session-flow/verify-read.ts:L48-L57`）
- `GET/PATCH /runtime`：runtime durable truth（`clients/api-docs/runtime.md:L12-L16`, `clients/api-docs/runtime.md:L67-L83`）
- `/items`：durable projection（`clients/api-docs/items.md:L10-L16`, `clients/api-docs/items.md:L29-L38`）
- `/confirmations` / `/todos`：断线后可主动 reconcile（`clients/api-docs/confirmations.md:L55-L101`, `clients/api-docs/todos.md:L31-L75`）

`client-cookbook.md` 甚至已经明确要求：WS 重连后，confirmation 要立刻补拉一次 pending 列表（`clients/api-docs/client-cookbook.md:L87-L103`）。

### 2.5 agent-core 内部其实已经有更强的 resume/replay/checkpoint substrate

`SessionWebSocketHelper` 已经支持：

- replay buffer
- ack window
- heartbeat tracker
- `handleResume()`
- `checkpoint()` / `restore()`，用于 DO hibernation 恢复（`packages/nacp-session/src/websocket.ts:L47-L63`, `packages/nacp-session/src/websocket.ts:L97-L157`, `packages/nacp-session/src/websocket.ts:L239-L317`）

`ReplayBuffer` 默认也是有 ring buffer 的：`maxPerStream = 200`, `maxTotal = 1000`（`packages/nacp-session/src/replay.ts:L21-L30`, `packages/nacp-session/src/replay.ts:L58-L72`）。

agent-core DO 在 WS close / alarm unhealthy 时会 `persistCheckpoint()`，并能 `restoreFromStorage()`（`workers/agent-core/src/host/do/session-do/ws-runtime.ts:L243-L272`, `workers/agent-core/src/host/do/session-do-runtime.ts:L583-L598`, `workers/agent-core/src/host/do/session-do-persistence.ts:L142-L222`）。

**所以 nano-agent 不是没有恢复底座，而是这套更强的恢复语义还主要停留在 agent-core 内部。**

---

## 3. 真实存在的盲点、断点与业务级 gap

### 3.1 G1 — public WS 的“resume”不是一个真正的 replay protocol

文档把 client→server `session.resume` 描述成 reconnect ack（`clients/api-docs/session-ws-v1.md:L273-L283`），但 public `orchestrator-core` WS 实现里：

- 真正被解析并转发的只有 `session.followup_input`
- 其他 client frame 只会走 activity touch

证据在 `workers/orchestrator-core/src/user-do/ws-runtime.ts:L199-L235`。

与此同时，HTTP `POST /sessions/{id}/resume` 也**不会回放任何帧**，它只返回：

- 当前 `relay_cursor`
- `replay_lost` 布尔值

证据在 `workers/orchestrator-core/src/user-do/surface-runtime.ts:L280-L320`。

也就是说，nano-agent 当前 public reconnect 的真实机制是：

1. **重新 attach WS**，靠 query `last_seen_seq` 尝试回放（`clients/api-docs/session-ws-v1.md:L13-L22`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L72-L145`）  
2. **必要时再调 `/resume`**，只是为了知道“有没有丢 replay”（`clients/api-docs/session-ws-v1.md:L288-L295`, `workers/orchestrator-core/src/user-do/surface-runtime.ts:L290-L318`）  
3. **若丢了，再调 `/timeline`** 做 reconciliation（`clients/api-docs/session-ws-v1.md:L288-L295`）

这和 claude-code 那种 transport 内建 reconnect + replay，不是一个等级。

更关键的是：**public attach 路径本身不会告诉你 replay 是否已经丢了**。  
`handleWsAttach()` 直接把 `replayCursor = min(serverCursor, clientLastSeenSeq)`，然后正常 forward；只有你额外再调 `/resume`，才会看到 `replay_lost=true`（`workers/orchestrator-core/src/user-do/ws-runtime.ts:L133-L145`, `workers/orchestrator-core/src/user-do/surface-runtime.ts:L290-L318`）。

这意味着一个前端如果只会“断线后重新开 WS”，它**可能已经 silently lost replay 而不自知**。

---

### 3.2 G2 — public replay 覆盖面不完整：top-level frames 没有统一 replay buffer

这是我认为最危险的断点。

`emitServerFrame()` 当前的实现是：

1. validate lightweight frame
2. 找当前 attachment
3. `socket.send(JSON.stringify(frame))`

如果没有 attachment，就直接 return false；**没有统一写入 replay buffer / recent frame store / durable log**（`workers/orchestrator-core/src/user-do-runtime.ts:L1015-L1063`）。

这会带来一个非常具体的结果：

- `session.stream.event` 这一族可以靠 `/timeline` / internal stream 补
- 但 `session.confirmation.request/update`
- `session.todos.update`
- `session.runtime.update`
- `session.item.*`
- `session.restore.completed`

这些 top-level frames **并没有同一个 replay 通道**

这并不是纯推断，仓内文档其实已经在不同地方分别承认了这件事：

1. confirmation 重连后要立即 `GET /confirmations?status=pending` 做 reconcile（`clients/api-docs/client-cookbook.md:L87-L103`）  
2. `/items` 明确说自己是 durable query surface，**不是 every transient WS frame 的 replay**（`clients/api-docs/items.md:L29-L38`）  
3. `/runtime` 有 durable GET，`session.runtime.update` 只是 PATCH 后广播（`clients/api-docs/runtime.md:L12-L16`, `clients/api-docs/runtime.md:L67-L83`）

**这意味着当前前端如果想做“可靠 reconnect”**，不能只依赖一个统一 replay reducer，而必须：

- stream event → `/timeline`
- confirmation → `/confirmations`
- todos → `/todos`
- runtime → `/runtime`
- item → `/items`

分别重拉。

这不是不能做，但它说明：**nano-agent 现在更像“多 read-model reconcile 架构”，不是“单 transport replay 架构”。**

---

### 3.3 G3 — replay window 是有硬上限的，但 public contract 没把这件事说透

这里至少有两个缓冲上限：

1. agent-core 内部 `ReplayBuffer`：默认每 stream 200 条，总 1000 条（`packages/nacp-session/src/replay.ts:L21-L30`, `packages/nacp-session/src/replay.ts:L58-L72`）  
2. orchestrator-core 热缓存 `MAX_RECENT_FRAMES = 50`，hydrate durable truth 时只回灌最近 50 帧（`workers/orchestrator-core/src/session-read-model.ts:L53-L65`, `workers/orchestrator-core/src/user-do/session-flow/hydrate.ts:L39-L52`, `workers/orchestrator-core/src/user-do/durable-truth.ts:L191-L194`）

同时，agent-core worker-level `/internal/.../stream` 也不是无限实时通道，而是从 timeline/status **合成一个有限 NDJSON snapshot**（`workers/agent-core/src/host/internal.ts:L86-L145`）。

但 public 文档对前端呈现的叙事是：

- `last_seen_seq=0` 时，server 会“从 stream 起点回放”（`clients/api-docs/client-cookbook.md:L58-L69`）
- reconnect 时 server 会 best-effort replay buffered events（`clients/api-docs/session-ws-v1.md:L288-L295`）

这些说法**不算错**，但不够诚实。  
更准确的说法应该是：

> server 会在当前可用 replay buffer / snapshot 窗口内做 best-effort replay；超过窗口后只能靠 `/resume + /timeline + 各 read-model` 补。

这件事如果不明确，前端很容易把 `last_seen_seq` 误当成“Kafka-like durable cursor”。

---

### 3.4 G4 — public stream 本质上仍是“snapshot + push 拼接”，不是一个完整的 transport session

`/internal/sessions/{id}/stream` 的实现非常关键：

- 先读 `timeline`
- 再读 `status`
- 合成一个有限 NDJSON 响应

它自己都在注释里承认：**first-wave relay is snapshot-based**（`workers/agent-core/src/host/internal.ts:L86-L145`）。

这说明 public attach/replay 当前依赖的是：

1. attach 时先抓一份内部 snapshot
2. attach 后再靠 live push

这不是坏事，但它和 claude-code 的 transport-native WebSocket session 不是同一范式。  
前端必须接受一个事实：**重连后自己拿到的是“server 当前还记得的快照 + 之后的新帧”**，不是一条严格连续、可确认、可补发的单一传输流。

---

### 3.5 G5 — client → server 的 reconnect semantics 明显偏弱，尤其是 `followup_input`

claude-code 的 transport 会：

- 给出站消息缓冲
- 用 request UUID / last-id 做 replay 与 dedup（`context/claude-code/cli/transports/WebSocketTransport.ts:L574-L681`）

nano-agent 的 public WS client→server 目前则是：

- `session.followup_input` 直接转发到 agent-core（`clients/api-docs/session-ws-v1.md:L275-L283`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L219-L235`）
- 没有 request_uuid 级别的 replay / dedup contract
- 没有 server ack 说“我已经接受了哪一个 followup_input”

其他 client 帧如 `session.resume / session.heartbeat / session.stream.ack` 当前更只是 activity touch，而不是可靠传输链的一部分（`clients/api-docs/session-ws-v1.md:L275-L283`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L177-L235`）。

**这会带来一个产品级问题**：

如果用户在 turn 进行中通过 WS 发 `followup_input`，而网络恰好在发送前后抖动，前端很难判断：

1. followup_input 是否已被 server 接收  
2. 是否需要重发  
3. 重发会不会重复注入 pending input queue

当前 public contract 对这件事没有闭环。

---

### 3.6 G6 — detached recovery 目前更像“基础设施恢复”，还不是“用户语义恢复”

nano-agent 现在确实已经有 detached / checkpoint / restore substrate：

- public session status 有 `detached`（`workers/orchestrator-core/src/session-lifecycle.ts:L15-L33`）
- WS close 时 orchestrator 会把 session 标成 detached（`workers/orchestrator-core/src/user-do/ws-runtime.ts:L164-L175`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L237-L255`）
- agent-core 在 WS close / alarm unhealthy 时会 persist checkpoint（`workers/agent-core/src/host/do/session-do/ws-runtime.ts:L243-L272`, `workers/agent-core/src/host/do/session-do-runtime.ts:L583-L598`）
- `restoreFromStorage()` 能恢复 actor phase / kernel fragment（`workers/agent-core/src/host/do/session-do-persistence.ts:L193-L222`）

但它距离 claude-code 那种“resume a previous conversation and continue interrupted turn”还差一层产品语义：

1. public façade 没有把 `session.resume` 转发到 agent-core 内部 `handleResume()`；更强的 internal resume 语义没暴露到 public WS（`workers/agent-core/src/host/do/session-do/ws-runtime.ts:L197-L236`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L199-L235`）  
2. checkpoint restore 的 public 面仍然只是 **open job**，不是真 restore completed（`clients/api-docs/checkpoints.md:L167-L170`, `clients/api-docs/checkpoints.md:L221-L231`）  
3. 当前也没有 claude-code 那种 transcript-level interrupted-turn detection + auto-continue prompt（对照 `context/claude-code/utils/conversationRecovery.ts:L159-L224`, `context/claude-code/utils/conversationRecovery.ts:L456-L560`）

**所以 nano-agent 的 detached recovery 当前更准确的定位是**：

> 后端热状态 survivability 已具备，但前端可感知的 interrupted-turn resume 语义还没有闭环。

---

## 4. nano-agent 的独特性：它不是更差，而是恢复模型不同

我不认为这里应该被写成“nano-agent 不如 claude-code”。  
更准确的判断是：**两者的恢复模型不同**。

### 4.1 nano-agent 的强项

1. **server-truth session discovery**：`/me/sessions` 能列出 detached，会话不是绑死在本地 transcript 上（`clients/api-docs/me-sessions.md:L80-L85`）  
2. **device-aware attachment governance**：reattach supersede / device revoke 是一等语义（`workers/orchestrator-core/src/user-do/ws-runtime.ts:L86-L110`, `workers/orchestrator-core/src/user-do/ws-runtime.ts:L302-L339`）  
3. **durable reconcile surfaces 多**：timeline / history / confirmations / todos / runtime / items 都能做事后恢复

### 4.2 nano-agent 的短板

1. **transport 语义分散**：replay、resume、polling reconcile、checkpoint 恢复分散在多层  
2. **public façade 没把内部更强的 replay/ack/checkpoint 直接暴露出来**  
3. **前端必须自己 orchestrate 多条恢复路径**，不能像 claude-code 那样主要依赖 transport/runtime 自闭环

所以从“支持我们自己的前端”这个问题来看，真正的 gap 不是“没法做”，而是：

> **前端必须自己承担太多恢复编排责任。**

---

## 5. 最终判断：当前 API 能否支撑我们的 agent loop 前端

### 5.1 如果目标是 first-wave Web client：**可以**

当前前端完全可以做出：

1. session 列表里看到 `detached` 会话  
2. `/start` 后用 `first_event_seq` attach WS  
3. 断线后带 `last_seen_seq` 重连  
4. 再用 `/resume` 检查 `replay_lost`  
5. 若丢了，再用 `/timeline` + `/confirmations` + `/todos` + `/runtime` + `/items` 做 reconciliation

也就是说，**一个可靠的前端策略是能设计出来的**。

### 5.2 如果目标是 mature loop front-end：**还不成立**

如果想要的是更像 claude-code 的体验——也就是：

- transport 自己处理 reconnect/replay
- client 出站消息可补发/去重
- detached 后能恢复 interrupted turn
- 一条连接恢复链路能覆盖大多数 live frames

那当前还不成立。

### 5.3 最准确的 verdict

**当前 nano-agent 的 Resume / Reconnect / Replay 系统，已经是一个有真实 server truth 的 first-wave recovery substrate；但它还不是一个产品级、自带完整恢复语义的 connection runtime。**

对前端而言，这意味着：

- **可以做**：前端可运行、可重连、可补拉、可恢复大部分状态。  
- **还不能偷懒**：前端必须显式实现 multi-surface reconciliation，不能只依赖单一 WS replay。

---

## 6. 我认为最值得写进下阶段纲领的收口点

如果后续要为前端抬高起点，这条线我会优先收口 4 件事：

1. **把 public `session.resume` 变成真 replay control，而不是 activity touch**  
2. **为 top-level frames 建一个统一 replay / durable cursor 语义**  
3. **给 `session.followup_input` 增加 request id / ack / dedup 语义**  
4. **明确 public replay window law，并把“超窗后如何 reconcile”写成 honest contract**

这 4 件事一旦补上，nano-agent 的 connection recovery 才会从“前端可以自己拼出来”升级到“前端能站在更高起点上直接用”。
