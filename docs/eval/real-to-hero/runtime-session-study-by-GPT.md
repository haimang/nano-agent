# real-to-hero：runtime / session 架构专项调查（by GPT）

> 本报告只使用当前仓库真实代码作为证据，并结合我对当前 6-worker 拓扑的独立分析给出建议。  
> 目标不是发明新拓扑，而是回答四个问题：  
> 1. 你对 `user do` / `session do` / 内部 SQLite 的理解是否正确；  
> 2. 当前真实运行路线是什么；  
> 3. `workers/agent-core/src/host/do/nano-session-do.ts` 这个巨石文件应该怎么拆；  
> 4. 后续推荐走什么演进路线，既不破坏安全边界，也不把 runtime 做成新的巨石或双重真相。

## 0. 结论先行

你的理解里有三点是**方向正确**的：

1. **`session do` 应该负责单 session 内部运行时流转与当前状态控制。**
2. **`user do` 应该负责单用户视角下的 session 隔离、索引与聚合。**
3. **hot path 不应该依赖 KV / R2 这类远端、较慢、弱查询能力的存储。**

但如果把这三点进一步推导成：

- `user do` 现在已经在 `this.storage.sqlite` 里注册和管理用户下全部 session；
- `session do` 现在已经在 `this.storage.sqlite` 里维护 agent loop 的内部状态机；
- 当前代码已经是 “每用户一个 SQLite DO + 每 session 一个 SQLite DO” 的结构；

那这个判断**与当前真实代码不符**。

当前真实路线是：

1. **每用户一个 `NanoOrchestratorUserDO`**：这一点成立，但它现在用的是 `storage.get/put/delete/setAlarm` 这类 key-value 风格接口，不是 `this.storage.sqlite`（`workers/orchestrator-core/wrangler.jsonc:34-46`，`workers/orchestrator-core/src/user-do.ts:97-104,1891-1900`）。
2. **每 session 一个 `NanoSessionDO`**：这一点也成立，但它同样不是 SQLite-backed DO；它的 runtime 主要是**内存 actor state + DO storage checkpoint/replay + 少量 D1 quota**，而不是 SQL 驱动的 loop（`workers/agent-core/wrangler.jsonc:24-37`，`workers/agent-core/src/host/do/nano-session-do.ts:123-129,160-176,791-834,1325-1411`）。
3. **系统级 durable truth 仍然在 D1，而不是在两个 DO 的本地数据库里。** `orchestrator-core` 的 `user-do` 会通过 `D1SessionTruthRepository` 写 `conversation/session/turn/message/activity/usage` 真相；`session do` 并不是产品事实库（`workers/orchestrator-core/src/user-do.ts:219-260,930-1005,1229-1269`）。

所以更准确的判断是：

> **你对职责分层的方向判断是对的；但你描述的 “内部 SQLite 已经存在/应该直接成为当前主路线” 并不是当前事实，也不是我建议立刻一步到位替换成的路线。**

---

## 1. 当前真实 runtime 路线是什么

## 1.1 拓扑矩阵

| 层级 | 当前真实节点 | 关键证据 | 当前职责 |
|---|---|---|---|
| public facade | `orchestrator-core` | `workers_dev: true`，唯一 public facade（`workers/orchestrator-core/wrangler.jsonc:3-8`） | JWT 鉴权、public HTTP/WS 入口、转发到 user DO |
| per-user actor | `NanoOrchestratorUserDO` | `ORCHESTRATOR_USER_DO` + `idFromName(auth.value.user_uuid)`（`workers/orchestrator-core/src/index.ts:380-416,529-543`） | 单用户下 session 索引、attachment、recent frames、cache、部分 hot read model |
| per-session actor | `NanoSessionDO` | `SESSION_DO` + `idFromName(sessionId)`（`workers/agent-core/src/host/worker.ts:75-90`） | 单 session agent loop、WS/helper、checkpoint、resume、permission/elicitation answer 存储 |
| durable product truth | D1 (`NANO_AGENT_DB`) | 两个 worker 都绑定同一 D1（`workers/orchestrator-core/wrangler.jsonc:24-33,64-71`，`workers/agent-core/wrangler.jsonc:50-56,83-89`） | session/conversation/turn/message/activity/usage 等长期事实 |
| internal capability | `bash-core` | `BASH_CORE` service binding（`workers/agent-core/wrangler.jsonc:45-49`） | tool/capability RPC |
| internal auth | `orchestrator-auth` | facade 代理 auth routes（`workers/orchestrator-core/src/index.ts:357-360`） | 注册、登录、刷新、鉴权 |
| internal context/filesystem | `context-core` / `filesystem-core` | `orchestrator-core` 绑定二者，但 `agent-core` 仍未启用绑定（`workers/orchestrator-core/wrangler.jsonc:48-54`，`workers/agent-core/wrangler.jsonc:41-49`） | 当前更多是库级原材料，不是 session runtime 的实装 RPC 主路径 |

## 1.2 当前不是 “SQLite DO” 路线

两个 DO 的 wrangler 都只声明了 `new_classes`，没有 `new_sqlite_classes`：

1. `NanoSessionDO`：`workers/agent-core/wrangler.jsonc:24-37`
2. `NanoOrchestratorUserDO`：`workers/orchestrator-core/wrangler.jsonc:34-47`

两个 DO 类在 TypeScript 层暴露的 `DurableObjectStateLike` 也都只包含 `storage.get/put/delete/setAlarm` 这类 key-value 子集，而没有 `storage.sql`：

1. `NanoSessionDO` 的 `DurableObjectStateLike`：`workers/agent-core/src/host/do/nano-session-do.ts:119-129`
2. `NanoOrchestratorUserDO` 的 `DurableObjectStateLike`：`workers/orchestrator-core/src/user-do.ts:97-104`

因此，从**应用代码和迁移声明**看，当前根本不是“每 DO 一套 SQL schema”的设计。

---

## 2. 当前存储现实 snapshot

## 2.1 `NanoOrchestratorUserDO`：每用户一个 actor，但现在是 key-value hot read model

`orchestrator-core` 在 public 入口先做 JWT 鉴权，然后直接以 `user_uuid` 取 user DO：

```ts
const stub = env.ORCHESTRATOR_USER_DO.get(
  env.ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid)
);
```

证据：`workers/orchestrator-core/src/index.ts:380-416,529-543`

这说明：

1. **每个用户对应一个 user DO stub**：这是你理解中正确的部分。
2. 但这个 DO 内部当前不是 SQL registry，而是基于 key 的 hot read model：

| key | 文件证据 | 作用 |
|---|---|---|
| `user/meta` | `workers/orchestrator-core/src/session-read-model.ts:44-46` | 当前 user 元信息 |
| `user/auth-snapshot` | 同上 | 持久化 auth snapshot |
| `user/seed` | 同上 | 初始 context seed |
| `sessions/{sessionUuid}` | `workers/orchestrator-core/src/session-lifecycle.ts:72-78` | 某 session 的热状态条目 |
| `session-terminal/{sessionUuid}` | 同上 | 某 session 的 terminal 结果 |
| `sessions/ended-index` | `workers/orchestrator-core/src/session-read-model.ts:47-48` | ended session 索引 |
| `conversation/index` | `workers/orchestrator-core/src/session-read-model.ts:48-49` | conversation 级索引 |
| `conversation/active-pointers` | `workers/orchestrator-core/src/session-read-model.ts:49-50` | 当前 active conversation/session/turn 指针 |
| `recent-frames/{sessionUuid}` | `workers/orchestrator-core/src/session-read-model.ts:50-65` | 最近 stream frames |
| `cache/{name}` | `workers/orchestrator-core/src/session-read-model.ts:51-69` | 短期缓存 |

`NanoOrchestratorUserDO` 自己最终也是：

- `get()` → `this.state.storage?.get(key)`
- `put()` → `this.state.storage?.put(key, value)`
- `delete()` → `this.state.storage?.delete?.(key)`

证据：`workers/orchestrator-core/src/user-do.ts:1891-1900`

所以当前 user DO 的真实定位是：

> **每用户一个 hot coordinator / index owner**，但其内部实现是 key-value read model，不是本地 SQL session registry。

## 2.2 `NanoSessionDO`：每 session 一个 actor，但现在是 memory-first runtime

`agent-core` worker entry 明确按 `sessionId` 转发到 `SESSION_DO.idFromName(sessionId)`，证据见 `workers/agent-core/src/host/worker.ts:75-90`。

因此 `NanoSessionDO` 的隔离单位就是**一个 session 一个 DO**。这也和你的直觉一致。

但它的内部状态管理并不是 SQL：

1. **热状态主要在内存**
   - `state: OrchestrationState`
   - `wsHelper`
   - `traceUuid`
   - `streamSeq`
   - `heartbeatTracker`
   - `ackWindow`
   - `defaultEvalSink`
   - `workspaceComposition`
   - `subsystems`

   证据：`workers/agent-core/src/host/do/nano-session-do.ts:159-250`

2. **DO storage 只承接 checkpoint / replay / async-answer / tenant key**
   - `session:teamUuid`
   - `session:checkpoint`
   - `session:lastSeenSeq`
   - `permission/decisions/{requestUuid}`
   - `elicitation/decisions/{requestUuid}`
   - `nacp_session:replay`
   - `nacp_session:stream_seqs`

   证据：`workers/agent-core/src/host/do/nano-session-do.ts:132-139,628-667,791-834,1325-1411`；`packages/nacp-session/src/websocket.ts:222-240`

3. **它对 DO storage 的访问也不是 SQL，而是 tenant-scoped key-value wrapper**
   - `tenantDoStorageGet / Put / Delete`
   - `getTenantScopedStorage()`

   证据：`packages/nacp-core/src/tenancy/scoped-io.ts:115-146`；`workers/agent-core/src/host/do/nano-session-do.ts:781-834`

4. **`session do` 不拥有系统级 durable truth**
   - session/conversation/turn/message/activity/usage 的持久真相由 `user-do` 通过 `D1SessionTruthRepository` 写入 D1
   - `session do` 只在 quota authorizer 场景下直接接触 D1

   证据：`workers/orchestrator-core/src/user-do.ts:219-260,930-1005,1229-1269`；`workers/agent-core/src/host/do/nano-session-do.ts:452-479`

所以当前 `session do` 的现实更接近：

> **in-memory actor + DO storage checkpoint/replay + D1 truth-by-proxy**

而不是：

> **SQLite-backed state machine**

## 2.3 这与 “hot path 不访问 KV” 的关系

你的这句判断：

> “为了稳定性以及速度，热操作不能，也不应该去访问 kv”

我是同意的，而且这和当前真实路线是一致的。

当前 hot path 里：

1. session loop 不走 KV
2. replay/checkpoint 在 DO storage
3. product truth 在 D1
4. current code 里并没有把 hot loop 放进 `filesystem-core` 的 KV/R2

也就是说，**你对 hot path 的性能边界理解是对的；只是当前实现采用的是 “内存 + DO storage + D1” 三层，而不是 “内存 + SQLite DO” 两层。**

---

## 3. 你提出的 SQLite 方案：哪里对，哪里不对

## 3.1 正确的部分

你的方案有四个强点：

1. **把 session 运行态和 user 视角索引分开**  
   这是正确的 actor 粒度。
2. **user DO 管“一个用户下面的多个 session”**  
   这也与当前入口路由一致。
3. **session DO 管单 session loop，而不是让 orchestrator-core 直接背 loop**  
   这是正确的运行边界。
4. **热状态不要跑到 KV/R2**  
   也是正确的性能/稳定性判断。

## 3.2 不正确或不完整的部分

### A. “现在已经是 this.storage.sqlite” 这一点不对

当前代码没有 `storage.sql`，也没有 SQLite DO migration，见前文证据。

### B. “session loop 应该主要由 SQLite 驱动” 这点我不推荐直接这么做

如果把 session loop 的核心状态推进改成：

- 每次 ingress 写一条 SQL event
- 每个 step 从 SQL 读写 turn state / actor state
- ack/heartbeat/replay 也以 SQL 为主路径

那会带来三个问题：

1. **把 runtime actor 从 memory-first 变成 persistence-first**  
   当前 `NanoSessionDO` 的优势正是 loop 主状态在内存里，checkpoint/restore 是边界动作。
2. **把 DO 内部 schema 与 D1 schema 变成两套系统真相**
   - DO SQLite：session runtime state
   - D1：conversation/session/message/activity/usage
   
   如果边界不冻结，就会很快出现“这条信息到底在哪边才是真相”的问题。
3. **会在巨石还没拆开时，把重构和存储路线切换绑死**
   这很危险，因为你很难区分 bug 是来自拆分，还是来自存储语义变化。

### C. “user DO / session DO 都应该立刻改 SQLite” 这也不是最佳 first move

两者价值并不相同：

1. `user DO` 上 SQLite 的价值主要是：
   - 列表、分页、排序、过滤
   - pending/expired GC
   - recent frames / cache / session index 更结构化

2. `session DO` 上 SQLite 的价值主要是：
   - checkpoint 结构化
   - replay / async answer queue / inspection snapshot
   - 更丰富的 debug/inspection probe

也就是说，**即便未来引入 SQLite-backed DO，也不应该把 user DO 和 session DO 视为同一优先级、同一落地方式。**

---

## 4. 当前路线与推荐路线的核心差别

| 维度 | 当前真实路线 | 你设想的路线 | 我的推荐路线 |
|---|---|---|---|
| user 级隔离 | 每用户一个 DO，key-value hot index | 每用户一个 SQLite DO | 可以保留“每用户一个 DO”；是否升 SQLite 取决于 query 压力 |
| session 级隔离 | 每 session 一个 DO，memory-first runtime | 每 session 一个 SQLite DO | 保留“每 session 一个 DO”；loop 继续 memory-first |
| session 热状态 | 内存 actor + helper | SQLite 驱动 | 继续以内存为主，SQLite 只做 checkpoint/read model 扩展 |
| durable truth | D1 | 容易滑向 DO 本地真相 | 继续由 D1 负责 product truth |
| replay/checkpoint | DO storage key-value | SQLite 表 | 可选演进到 SQLite，但不是先决条件 |
| 风险 | 巨石文件难维护，但状态责任基本清楚 | 容易出现双重真相和重构耦合 | 先拆职责，再评估是否需要 SQLite |

我的总体判断是：

> **你提出的是一个“可能的未来优化路线”，不是“当前已经如此”，也不是“现在最该先做的事情”。**

---

## 5. `NanoSessionDO` 巨石文件为什么必须先拆

`workers/agent-core/src/host/do/nano-session-do.ts` 当前已经同时承担了：

1. runtime bootstrap / composition
2. HTTP fallback / internal routing
3. WS ingress / NACP normalize / phase gate
4. actor state transition / orchestrator deps
5. checkpoint / restore / tenant-scoped storage
6. preview verification / capability probes

从文件结构看，这已经不是“一个大类”，而是**多个子系统被堆在一个 DO facade 里**（证据见 `workers/agent-core/src/host/do/nano-session-do.ts:252-392,493-710,781-834,1023-1498,1550-1876`）。

如果在这个状态下直接改成 SQLite DO，会把两件事绑在一起：

1. 文件拆分
2. 状态存储路线变更

这是不推荐的。

## 5.1 推荐拆分方式

我建议把 `NanoSessionDO` 收缩成薄 facade，只保留：

- constructor
- `fetch`
- `webSocketMessage`
- `webSocketClose`
- `alarm`
- 少量字段定义

其余按职责拆到 `workers/agent-core/src/host/do/` 下：

| 建议文件 | 职责 |
|---|---|
| `nano-session-do.ts` | DO facade + entrypoints + 字段 |
| `session-do-bootstrap.ts` | composition/eval/workspace/quota/live-kernel 装配 |
| `session-do-identity.ts` | session/team/trace/cross-seam/tenant storage |
| `session-do-ingress.ts` | `acceptClientFrame` / `dispatchAdmissibleFrame` / async-answer record |
| `session-do-ws.ts` | helper、upgrade、attach、ack、resume、heartbeat |
| `session-do-persistence.ts` | checkpoint / restore / helper storage |
| `session-do-orchestration-deps.ts` | `buildOrchestrationDeps` / `drainPendingInputs` |
| `session-do-verify.ts` | preview verification / capability checks |

## 5.2 拆分顺序

推荐顺序不是平均切，而是按风险从低到高：

1. **先拆 `session-do-verify.ts`**  
   最独立，对主路径影响最小。
2. **再拆 `session-do-persistence.ts`**  
   存储边界清晰，便于后续讨论要不要升级 SQLite。
3. **再拆 `session-do-ws.ts` 与 `session-do-ingress.ts`**  
   把 transport 与 actor 主逻辑分开。
4. **最后拆 bootstrap / orchestration deps**  
   这是最容易触发构造期耦合的部分，放最后。

---

## 6. 安全边界分析

## 6.1 public boundary：`orchestrator-core` 才是唯一 public facade

`orchestrator-core` 对外公开，负责 JWT 鉴权与 facade-http-v1 包装，证据见：

- `workers/orchestrator-core/wrangler.jsonc:3-8`
- `workers/orchestrator-core/src/index.ts:374-416`
- `workers/orchestrator-core/src/auth.ts:171-220`

它在 public session 路径上先做：

1. `authenticateRequest()`
2. 得到 `user_uuid`
3. 再路由到该用户的 `ORCHESTRATOR_USER_DO`

这意味着**客户端永远不直接打 user DO 或 session DO**。

## 6.2 user boundary：每用户一个 `NanoOrchestratorUserDO`

`ORCHESTRATOR_USER_DO.idFromName(auth.value.user_uuid)` 明确把 user DO 粒度固定在用户维度（`workers/orchestrator-core/src/index.ts:380-416,529-543`）。

这层负责：

1. 同一个用户名下 session 的热索引
2. 和当前 attached client socket 的关系
3. 对 agent-core 的内部转发

这使它天然成为**用户范围的 session 隔离层**。

## 6.3 session boundary：每 session 一个 `NanoSessionDO`

`SESSION_DO.idFromName(sessionId)` 明确把 session DO 粒度固定在 session 维度（`workers/agent-core/src/host/worker.ts:75-90`）。

这层负责：

1. 单 session loop
2. ingress legality
3. replay/checkpoint
4. permission/elicitation answer 暂存

因此它是**运行态的 session isolation boundary**。

## 6.4 internal boundary：不是裸 HTTP，而是 internal-secret + authority + trace

`user-do` 转发到 `agent-core` 时，会带：

- `x-nano-internal-binding-secret`
- `x-trace-uuid`
- `x-nano-internal-authority`

证据：`workers/orchestrator-core/src/user-do.ts:1758-1771`

`NanoSessionDO.fetch()` 会对 `session.internal` hostname 请求执行 `validateInternalAuthority()`，证据：`workers/agent-core/src/host/do/nano-session-do.ts:499-511`。

而 `validateInternalAuthority()` 又强校验：

1. internal binding secret
2. UUID-shaped trace
3. authority JSON
4. body JSON object

证据：`workers/agent-core/src/host/internal-policy.ts:149-240`

这说明当前内部边界**不是裸内网 HTTP**，而是已经有一层受控 internal control plane。

## 6.5 tenant boundary：NACP ingress + tenant-scoped storage 双重约束

`NanoSessionDO` 对 client frame 的入口并不是直接解析 JSON，而是：

1. `acceptIngress()`：authority stamp + schema validate + phase/role legality（`workers/agent-core/src/host/session-edge.ts:72-188`）
2. `normalizeClientFrame()`：客户端不能自带 authority，authority 必须 server-stamped（`packages/nacp-session/src/ingress.ts:25-74`）
3. `verifyTenantBoundary()`：DO 在接收合法 frame 后仍做 tenant boundary 校验（`workers/agent-core/src/host/do/nano-session-do.ts:723-765`）
4. `tenantDoStorage*`：DO storage key 全部加 `tenants/{teamUuid}/...` 前缀（`packages/nacp-core/src/tenancy/scoped-io.ts:123-146`）

所以当前 session runtime 的安全边界并不是只有“入口 JWT”，而是：

> public auth → user boundary → internal authority → NACP ingress legality → tenant-scoped storage

这条链条总体是成立的。

---

## 7. NACP compatible 通讯分析

## 7.1 当前不是“每一跳都 full NACP”，而是“三层不同协议面”

当前真实通信面其实分成三层：

| 层 | 当前形态 | 说明 |
|---|---|---|
| public facade | facade-http-v1 JSON | 给 client 用，不必强行 full NACP |
| internal control plane | internal JSON + authority/trace headers | `user-do -> agent-core` 当前是这条 |
| session wire | `nacp-session` frame | WS / HTTP fallback 最终都会在 `NanoSessionDO` 内进入这层 |

这三层并不完全同形，但并非错误；它们各自服务不同目标。

## 7.2 当前最 NACP-compatible 的部分其实在 `session do` 边缘

`NanoSessionDO` 的 session edge 设计是当前最接近 NACP 真相的部分：

1. client frame 不允许自带 authority
2. server 统一 stamp authority
3. 统一走 `acceptIngress()`
4. phase / role legality 不在 DO 里重复发明

证据：`workers/agent-core/src/host/session-edge.ts:1-188`；`packages/nacp-session/src/ingress.ts:1-74`

## 7.3 当前碎片点不在 session edge，而在 `user-do -> agent-core` 转发面

`user-do` 到 `agent-core` 现在是 internal HTTP + JSON body + internal headers，证据见 `workers/orchestrator-core/src/user-do.ts:1758-1771`。

这意味着：

1. **它是 NACP-compatible 的**：authority/trace/tenant truth 仍被携带
2. **但它不是 full NACP session frame**：真正的 frame 组装发生在 `NanoSessionDO` 的 `HttpController.buildClientFrame()` / `acceptIngress()` 这一层

这不是立即必须推翻的缺陷，但它解释了为什么你会感觉“内部还是有一点碎片”。

## 7.4 推荐的协议冻结方式

我不建议强迫每一跳都模仿 client WS frame。推荐冻结三层：

1. **public facade 层**：继续 facade-http-v1
2. **internal control plane 层**：继续 authority + trace + typed JSON body
3. **session runtime 层**：继续由 `nacp-session` 作为 wire truth

这样既保留 NACP 的安全与 schema 价值，也避免为了“形状统一”把每条内部 hop 都做成过重的 full envelope。

---

## 8. 我对 SQLite 路线的推荐判断

## 8.1 我不反对未来引入 SQLite-backed DO

如果未来你们希望：

1. user DO 对 session 列表/分页/过滤/GC 更结构化
2. session DO 对 replay/checkpoint/inspect/debug/async answer queue 更结构化

那引入 SQLite-backed DO **是可以讨论的**。

## 8.2 但我不推荐现在把它作为主线重构

原因有四个：

1. **当前 first problem 不是“没有 SQL”，而是 giant DO + product API gap。**
2. **当前系统的 durable truth 已在 D1，有清晰归属；贸然引入 DO SQLite 容易制造第二套真相。**
3. **session loop 目前是 memory-first，性能路径本身并不依赖 KV；这条主线并没有坏。**
4. **在 giant file 未拆、职责未冻结时改存储路线，排障成本太高。**

## 8.3 我真正推荐的路线

### Phase A：先做纯拆分，不改存储语义

目标：把 `NanoSessionDO` 从巨石变成薄 facade + 多个职责文件。

### Phase B：冻结“三层真相”

1. **session do memory**：当前运行态 truth
2. **user do hot read model**：每用户 session 列表/缓存/attachment/hot index
3. **D1**：product durable truth

只有这三层职责冻结了，后面才知道 SQLite 应该插在哪一层。

### Phase C：如果要引入 SQLite，优先考虑 user DO，不要先动 session loop

因为 user DO 的需求本质上更像本地 query/read-model：

- 会话列表
- pending/expired 清理
- conversation index
- cache / recent frames 管理

这比 session loop state machine 更适合先做成表。

### Phase D：session DO 即便引入 SQLite，也只做“辅助持久层”，不要做 loop 主驱动

我建议 session DO 若未来升 SQLite，也只承接：

1. replay buffer checkpoint
2. async answer queue（permission / elicitation）
3. inspection snapshots
4. debug timeline / local traces

而不是把 actor state machine、step scheduler、heartbeat/ack 主路径改成 SQL 驱动。

---

## 9. 最终判断

如果把你的问题压缩成一句话，我的回答是：

> **你的职责边界理解基本正确，但你把“推荐的未来路线”说成了“当前实现事实”，并且把 session loop 过早推向 SQLite 主驱动；这两点我都不同意。**

更准确的结论是：

1. **当前现实**
   - 每用户一个 user DO：对
   - 每 session 一个 session DO：对
   - 当前内部 `this.storage.sqlite`：不对
   - 当前 session runtime 是 SQLite state machine：不对

2. **我认可的设计方向**
   - user DO 负责用户内 session 隔离与热索引
   - session DO 负责单 session runtime
   - hot path 不走 KV/R2
   - D1 继续做 durable truth

3. **我推荐的执行路线**
   1. 先拆 `NanoSessionDO` 巨石文件
   2. 冻结 memory / user-DO / D1 三层职责
   3. 如确有必要，再把 user DO 升为 SQLite-backed read model
   4. session DO 若升 SQLite，也只做 checkpoint/replay/queue/inspect 的辅助持久层
   5. 不要把 agent loop 主路径改成 SQL-first runtime

从 real-to-hero 的优先级看，**现在最该做的不是“全面 SQLite 化”，而是“把 session runtime 的职责边界和文件结构整理清楚，再把真实 client API 打通”**。

---

## 10. 附加：`user DO + session DO` 小型执行计划

> 目标：不在当前阶段引入 `this.state.storage.sqlite` 改造；优先用小步、低风险方式，提升 `user DO + session DO` 的可维护性、协议一致性、热路径边界清晰度，以及对真实客户端的支撑能力。

### Phase 1：先拆 `NanoSessionDO` 巨石文件

1. 把 `NanoSessionDO` 收缩成薄 facade，只保留 constructor、`fetch`、`webSocketMessage`、`webSocketClose`、`alarm` 与字段定义。
2. 按职责拆出 `session-do-bootstrap / identity / ingress / ws / persistence / orchestration-deps / verify` 七类小文件。
3. 要求这一步是 **pure refactor**：不改 route shape、不改 storage key shape、不改现有 runtime 语义。

### Phase 2：收口 `user DO <-> session DO` 通讯碎片

1. 冻结三层协议面：public facade 继续 `facade-http-v1`，internal control plane 继续 `authority + trace + typed JSON`，session runtime 继续 `nacp-session` wire truth。
2. 把 `user-do -> agent-core -> session do` 当前零散的 internal action body 明确成稳定 contract，避免 route/body 继续漂移。
3. 新增或收紧 parity / contract 校验，确保 `start / input / cancel / verify / permission / elicitation` 这些内部 hop 不再各自发散。

### Phase 3：明确并强化热存取边界

1. 冻结三层状态职责：`session do memory = 当前 loop truth`，`user do storage = 每用户 hot index/read model`，`D1 = durable product truth`。
2. 明确禁止把 session hot path 推到 KV/R2；checkpoint、replay、recent frames、短期 cache 继续留在 DO memory / DO storage。
3. 对现有 hot key 空间做一次小型整顿：统一命名、补注释、补 cleanup / TTL / alarm discipline，减少未来演化时的隐性漂移。

### Phase 4：补强真实客户端对齐能力

1. 先补 `user DO + session DO` 最直接支撑真实 client 的接口与内部能力，而不是先做 SQLite 化。
2. 优先补强的方向是：session messages 统一入口、conversation/session read model、context inspection、文件/artifact 可见性、permission/elicitation 闭环。
3. 评估标准不是“内部抽象更漂亮”，而是：稳定性是否提高、internal contract 是否更清楚、真实 client gap 是否缩小。

### Gate

1. `NanoSessionDO` 完成拆分后，主路径行为不变。
2. `user DO + session DO` 的 internal contract 有单一真相，不再出现多种 body/route 变体并存。
3. 热路径边界有明确文档与代码注释约束：什么在 memory，什么在 DO storage，什么必须落 D1。
4. 在不引入 SQLite DO 的前提下，系统的稳定性、可执行性、以及与真实客户端需求的对齐程度都有可见提升。
