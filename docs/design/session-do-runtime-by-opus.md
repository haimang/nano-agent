# Nano-Agent 功能簇设计 — Session DO Runtime

> 功能簇: `Session DO Runtime`
> 讨论日期: `2026-04-16`
> 讨论者: `Claude Opus 4.6 (1M context)`
> 关联调查报告:
> - `docs/investigation/codex-by-opus.md` §8 (Sub-Agent / Rollout / Durable Session)
> - `docs/investigation/claude-code-by-opus.md` §8 (AgentTool + Task + forkedAgent)
> - `docs/investigation/mini-agent-by-opus.md` §8 (无 sub-agent / 纯内存会话)
> - `docs/nacp-by-opus.md` v2 (协议家族: Core + Session)
> - `docs/action-plan/nacp-core.md` (已收口 — transport / tenancy / validate pipeline)
> - `docs/action-plan/nacp-session.md` (已收口 — replay / ack / heartbeat / ingress)
> - `docs/design/hooks-by-opus.md` (HookDispatcher 的宿主在 Session DO 内)
> - `docs/design/llm-wrapper-by-GPT.md` (LLM Executor 的调用者是 Session DO)
> - `README.md` §1–§4 (Cloudflare-native、DO-centered、WebSocket-first)
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么现在讨论 Session DO Runtime

`nacp-core` 和 `nacp-session` 两个协议包都已收口，但它们是"合同"不是"实现"。现在需要回答：**协议之上的 agent 本体 actor 到底长什么样**。

Session DO Runtime 是 nano-agent 的**物理心脏**——它是一个 Cloudflare Durable Object class，一个 session = 一个 DO 实例，内部组装了：agent runtime kernel（主循环）+ NACP-Session WebSocket helper + Hooks dispatcher + LLM executor + capability runtime + workspace context。

不先定义 Session DO 的内部装配方式，后续所有子系统（hooks / llm / tool / compact）都不知道"自己在谁里面被调用、lifecycle 由谁管"。

### 0.2 前置共识

- **运行时**：Cloudflare Workers + Durable Objects + WebSocket hibernation
- **一条 WebSocket = 一个 session = 一个 DO**：`env.SESSION_DO.idFromName("team:{team_uuid}:session:{session_uuid}")`
- **多租户**：authority.team_uuid 在 DO id 中、在 NACP envelope 中、在 refs 中三处对齐
- **Session profile**：`@nano-agent/nacp-session` 提供 replay buffer + ack window + heartbeat + ingress normalize + stream adapters
- **Core transport**：`@nano-agent/nacp-core` 的 service-binding / do-rpc / queue 三种 transport 在 Session DO 内部被用来调用外部 skill / capability / compactor worker

### 0.3 显式排除的讨论范围

- 不讨论 agent runtime kernel 的 step scheduling 算法（那是另一个功能簇）
- 不讨论 LLM provider 选型与 model registry 细节（那是 llm-wrapper 的范畴）
- 不讨论 fake bash 的命令注册表（那是 capability-runtime 的范畴）
- 不讨论 DDL / D1 schema 设计（那是 storage-topology 的范畴）
- 不讨论客户端 SDK / UI 实现

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Session DO Runtime`
- **一句话定义**：Session DO Runtime 是 nano-agent 的**会话 actor 宿主**——一个 Durable Object class 实例，负责组装所有子系统（agent loop + WebSocket + hooks + LLM + tools + workspace + context）并管理整个 session 的生命周期。
- **边界描述**：
  - **包含**：Worker entry point (fetch handler)、DO class 定义、WebSocket accept/attach/detach/resume、session state 管理（phase transitions）、agent turn loop 的宿主编排、子系统 composition（hooks / llm / tools 的 wiring）、DO storage checkpoint/restore、alarm handler（self-wake）、graceful shutdown
  - **不包含**：agent loop 的 step 调度算法本体（那是 kernel）、具体工具的执行逻辑（那是 capability runtime）、LLM 请求的构建/重试逻辑（那是 llm-wrapper）、context 压缩算法（那是 workspace-context）

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Session DO** | 一个 Durable Object 实例，对应一个 agent 会话 | `env.SESSION_DO.idFromName("team:{team_uuid}:session:{session_uuid}")` |
| **Session Actor** | Session DO 的运行时行为体：接收 WebSocket 消息、驱动 agent loop、管理状态 | 概念上类似 Erlang actor |
| **Worker Entry** | Cloudflare Worker 的 `fetch` handler，负责 routing（WebSocket upgrade / HTTP API / internal RPC） | 每个请求先到 Worker，再 forward 给 DO |
| **Turn** | 一次"用户输入 → agent 思考 → tool 调用 → agent 回复"的完整循环 | 一个 session 包含多个 turn |
| **Step** | Turn 内的一个原子操作（一次 LLM 调用 / 一次 tool 执行 / 一次 hook emit） | 由 kernel 调度 |
| **Checkpoint** | 把 DO 内存态序列化到 `state.storage` 的操作 | 在 hibernation 前自动触发，也可手动触发 |
| **Alarm** | DO 的 self-wake 机制，用于 cron-like 任务、heartbeat 检查、delayed tool resume | `state.storage.setAlarm(Date.now() + ms)` |

### 1.3 参考调查报告

- codex §8：sub-agent 的 `codex_delegate.rs` + `forward_events()` + rollout JSONL = 最接近"actor model"的本地实现
- claude-code §8：`forkedAgent.ts` 的 `CacheSafeParams` + `AppState` store = 子 agent cache 保护的参考
- mini-agent §8：无 sub-agent / 纯内存 = 反例（nano-agent 必须做持久化）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

Session DO Runtime 是 nano-agent 的**核心 actor**——所有其他功能簇都是"被 Session DO 调用的子系统"。

```
                 Client (WebSocket)
                        │
                        ▼
              ┌─────────────────────┐
              │   Worker Entry      │ ← routing: WS upgrade → DO
              │   (fetch handler)   │
              └────────┬────────────┘
                       │
                       ▼
              ┌─────────────────────┐
              │   Session DO        │ ← THE ACTOR
              │                     │
              │  ┌───────────────┐  │
              │  │ NACP-Session  │  │ ← WebSocket helper (replay/ack/heartbeat)
              │  │ helper        │  │
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │ Agent Kernel  │  │ ← turn loop + step scheduler + cancel
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │ Hook          │  │ ← emit → handler → outcome → merge
              │  │ Dispatcher    │  │
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │ LLM Executor  │  │ ← canonical request → provider → stream normalize
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │ Capability    │──┼──→ service binding → Skill/Tool workers
              │  │ Runtime       │  │
              │  └───────────────┘  │
              │  ┌───────────────┐  │
              │  │ Workspace     │──┼──→ R2 / DO storage
              │  │ Context       │  │
              │  └───────────────┘  │
              │                     │
              │  state.storage      │ ← checkpoint / restore / alarm
              └─────────────────────┘
```

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|---------|---------|------|
| **NACP-Core** | Session DO 使用 Core transport 调外部 worker | 强 | service-binding / do-rpc / queue |
| **NACP-Session** | Session DO 内嵌 `SessionWebSocketHelper` | 强 | attach / pushEvent / handleResume / checkpoint |
| **Agent Runtime Kernel** | Session DO 驱动 kernel 的 turn loop | 强 | Session DO 是 kernel 的宿主 |
| **Hooks** | Session DO 内嵌 `HookDispatcher` | 强 | emit 在 turn loop 内；handler 可能调 service binding |
| **LLM Wrapper** | Session DO 调 LLM Executor 做推理 | 强 | 请求构建 + 流式消费 |
| **Capability Runtime** | Session DO 通过 Core transport 调 tool/skill worker | 强 | tool.call.request → response |
| **Workspace / Context** | Session DO 管理 workspace 的 mount + snapshot | 中 | R2-backed FS / DO storage context |
| **Storage Topology** | Session DO 的 state.storage 是 hot state 的物理承载 | 强 | checkpoint 格式由 topology 定义 |
| **Eval / Observability** | Session DO emit 事件 → trace sink | 弱 | 只在 audit/trace 消费侧 |

### 2.3 一句话定位陈述

> "Session DO Runtime 是 nano-agent 的 **唯一 actor**，负责 **把 WebSocket 连接、agent turn loop、hooks、LLM、tools、workspace、context 组装成一个可持久、可恢复、可治理的会话服务**。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（v1 不做）

| 被砍项 | 参考来源 | 砍的理由 | 未来是否回补 |
|--------|---------|---------|-------------|
| 多 DO 联邦（session migration / cross-DO resume） | codex 的 thread-store | 单 DO 足够 v1 | 按需 |
| Sub-agent spawning（从 Session DO fork 子 DO） | codex 的 codex_delegate | README 明确"单 agent 单线程为早期核心" | 中期 |
| 多客户端 attach（observer mode） | 未来需求 | 复杂度翻倍 | v2 |
| Worker-level load balancing | CF 平台自带 | 不需要自己做 | — |
| DO 跨区域迁移 | CF 平台管理 | 不需要自己做 | — |

### 3.2 接口保留点（v1 留 seam）

| 扩展点 | 表现形式 | v1 行为 | 未来可能演进 |
|--------|---------|---------|-------------|
| `onTurnComplete(turnResult)` 回调 | Session DO 的 method | v1 把 turn result push 到 WebSocket 并写 audit | 未来可以触发 queue 编排、cron schedule |
| `alarmHandler()` | DO alarm 方法 | v1 只用于 heartbeat check | 未来用于 delayed tool resume、cron task |
| `compositionConfig` | 构造时注入的子系统配置 | v1 在 DO constructor 中硬编码 | 未来从 KV manifest 动态加载 |
| `onHibernation()` / `onWake()` | DO lifecycle hooks | v1 checkpoint/restore 到 state.storage | 未来可能迁移到 R2 |

### 3.3 完全解耦点

- **Worker entry 与 Session DO 分开**：Worker 只做 routing（WebSocket upgrade → DO fetch），不做业务逻辑。这让 Worker 的代码量极小（< 50 行），容易替换。
- **Agent kernel 与 Session DO 分开**：kernel 是纯函数式的 step scheduler，不知道自己跑在 DO 里。Session DO 只调 `kernel.runTurn(messages, tools, hooks)` 拿结果。这让 kernel 可以在单元测试里脱离 DO 运行。
- **LLM Executor 与 Session DO 分开**：executor 只管"发请求、收 stream、归一化"；Session DO 只管"什么时候调它、拿到结果后怎么 dispatch"。

### 3.4 聚合点

- **所有 WebSocket 交互收敛到 `SessionWebSocketHelper`**：Session DO 不直接操作 `WebSocket.send()`，只通过 helper 的 `pushEvent()` / `handleResume()` / `handleAck()`。
- **所有 NACP 消息发送收敛到 Core transport**：Session DO 不直接调 `env.SKILL_WORKER.fetch()`，只通过 `ServiceBindingTransport.send(envelope)`。
- **所有状态变更收敛到 `state.storage`**：Session DO 的 checkpoint 格式是统一的 JSON 结构，不散落到多个 KV/R2 位置。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：单进程 Python，`Agent.__init__`（`agent.py:48-84`）持有：`self.llm: LLMClient`、`self.tools: dict[str, Tool]`、`self.messages: list[Message]`、`self.max_steps=50`、`self.token_limit=80000`、`self.cancel_event: Optional[asyncio.Event]`、`self.api_total_tokens: int`。`run()`（`agent.py:321-340`）是一个 async while loop，接受 `cancel_event` 做协作式取消。
- **值得借鉴**：
  - **`cancel_event` + `_check_cancelled()` + `_cleanup_incomplete_messages()`**（`agent.py:90-121`）：每个 step 之间检查取消标志，取消时只删"最后一条 assistant + 悬空 tool result"。这个"只删未完成的"模式直接适用于 Session DO 的 abort 路径。
  - **`_summarize_messages()` 的 user-boundary 切分**（`agent.py:180-259`）：保留所有 user message，只压中间的 agent/tool 序列。这是 compact trigger 的最简模型。
- **不照抄的**：完全无持久化——进程退出会话即丢。log 只有 plain-text（`logger.py:11-40`），不可程序化 replay。

### 4.2 codex 的做法

- **实现概要**：Rust workspace。核心状态分三层：
  - **`CodexThread`**（`codex_thread.rs:51-71`）：持有 `Codex` 实例 + `rollout_path: Option<PathBuf>` + `out_of_band_elicitation_count`，对外暴露 `submit(op)` / `next_event()` / `agent_status()`
  - **`StoredThread`**（`thread-store/types.rs:135-178`）：持久化元数据含 `thread_id`、`forked_from_id`、`preview`、`model`、`cwd`、`approval_mode`、`sandbox_policy`、`token_usage`、`first_user_message`、`git_info`、`history: Option<StoredThreadHistory>`
  - **`ThreadConfigSnapshot`**（`codex_thread.rs:37-49`）：per-turn 快照含 `model`、`model_provider_id`、`approval_policy`、`sandbox_policy`、`reasoning_effort`、`personality`、`session_source`
- **值得借鉴（直接复用模式）**：
  - **Session / TurnContext 分层**：`StoredThread` = 跨 turn 持久态（→ DO storage），`ThreadConfigSnapshot` = per-turn 临时态（→ DO 内存）。这个分层直接映射到 nano-agent 的 `state.storage.put("session:*")` vs isolate-local 变量。
  - **RolloutRecorder 的 JSONL 格式**（`recorder.rs:74-81`）：每行一个 `RolloutItem` enum（`SessionMeta` / `ResponseItem` / `CompactedItem` / `TurnContext` / `EventMsg`）。rollout 文件名 `rollout-{ts}-{uuid}.jsonl`（`metadata.rs:32-33`）。这是 nano-agent 审计日志的直接模板。
  - **Thread resume 参数**（`thread-store/types.rs:47-72`）：`ResumeThreadRecorderParams { thread_id, include_archived, event_persistence_mode }` + `LoadThreadHistoryParams { thread_id, include_archived }`。nano-agent 的 `session.resume` body 应包含类似字段。
  - **Auto-compact trigger**（`codex.rs:6404-6724`）：`model_info.auto_compact_token_limit()` 阈值，在 post-sampling 和 pre-turn 两处检查。`CompactionPhase::MidTurn`（`BeforeLastUserMessage` injection）vs `PreTurn`（`DoNotInject`）。
  - **Rollout item sanitization**（`recorder.rs:189-212`）：command output 截断到 10,000 bytes。nano-agent 的 audit event 也需要类似的 truncation。
- **不照抄的**：`Mutex<SessionState>` 内存锁（我们用 DO storage 的单实例保证）；`ForkStrategy`（v1 无 sub-agent）；SQLite state DB backfill（`metadata.rs:136-355`，v1 不引入 D1）。

### 4.3 claude-code 的做法

- **实现概要**：TypeScript。`AppState`（`AppStateStore.ts:89-452`）是 `DeepImmutable` 包裹的中央 store，含 `settings`、`mainLoopModel`、`tasks: Record<string, TaskState>`（mutable）、`agentNameRegistry: Map`、`fileHistory`、`mcp`（clients/tools/commands/resources）、`sessionHooks`、`speculation`、`denialTracking`、`teamContext`。Store 接口（`store.ts:4-8`）只有 `getState()` / `setState(updater)` / `subscribe(listener)`。
- **值得借鉴（直接复用模式）**：
  - **AutoCompactTrackingState**（`autoCompact.ts:51-60`）：`compacted: boolean`、`turnCounter`、`turnId`、`consecutiveFailures`。Circuit breaker 在 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3` 次后停止自动 compact。`getAutoCompactThreshold()`（`autoCompact.ts:72-91`）= `effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS(13_000)`。这整套 compact 状态机直接适用于 nano-agent 的 Session DO。
  - **Transcript recording**（`sessionStorage.ts`）：entry types 含 `user / assistant / attachment / system / progress`（progress 排除在 parentUuid chain 外以避免 fork 孤儿）。`flushSessionStorage()` 锁定后批量追加。这对应 DO `webSocketClose` 时的 checkpoint 逻辑。
  - **Cost tracking per-session per-model**（`cost-tracker.ts:71-174`）：`lastCost`、`lastAPIDuration`、`lastToolDuration`、per-model `input/output/cache tokens + cost in USD`。`restoreCostStateForSession()` 在 resume 时重新水合。nano-agent 的 DO checkpoint 应包含类似的 usage tracking。
  - **Settings 4 层 cascade**（`settings.ts:58-199`）：managed → user → project → local，parseSettingsFile() 缓存 + clone-on-return 防 mutation。这对应 nano-agent 的 KV shared config 多层合并。
- **不照抄的**：React `DeepImmutable` store（我们用 DO storage KV API）；`AppStateStore` 的 400+ 行字段定义（我们的 checkpoint 更薄）；工具侧 40+ 工具的 UI 渲染耦合。

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | **nano-agent 倾向** |
|------|-----------|-------|-------------|---------------------|
| 会话 actor 模型 | `Agent` class（`agent.py:48`） | `CodexThread`（`codex_thread.rs:51`） | `AppState` store（`AppStateStore.ts:89`） | **Durable Object instance** |
| 持久化 | 无 | JSONL rollout（`recorder.rs:74`） | sessionStorage（`sessionStorage.ts`） | **DO state.storage checkpoint** |
| 恢复 | 无 | `LoadThreadHistoryParams`（`types.rs:67`） | `restoreCostStateForSession()`（`cost-tracker.ts:87`） | **DO hibernation + checkpoint/restore** |
| Compact trigger | `token_limit=80000` 单阈值 | `auto_compact_token_limit()`（`codex.rs:6404`） | `effectiveWindow - 13000` + circuit breaker（`autoCompact.ts:72`） | **codex 模型 + claude-code circuit breaker** |
| Turn loop | `run()` while step < max（`agent.py:343`） | `while step < max_steps`（`codex.rs:343`） | `query.ts` agent loop | **Session DO 内嵌 kernel** |
| Cancel | `cancel_event: asyncio.Event` | API abort signal | `AbortController` | **DO 侧 cancel event → kernel abort** |
| 子系统组装 | 构造函数注入 tools | Rust trait + config + `ThreadConfigSnapshot` | React context + lazy import | **DO constructor 注入 composition** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（v1 要做）

- **[S1]** Worker entry point：fetch handler，routing WebSocket upgrade → DO
- **[S2]** Session DO class 定义：`export class NanoSessionDO implements DurableObject`
- **[S3]** WebSocket accept + attach（消费 `@nano-agent/nacp-session` 的 `SessionWebSocketHelper`）
- **[S4]** Session state machine（`unattached → attached → turn_running → ended`）使用 `@nano-agent/nacp-session` 的 `assertSessionPhaseAllowed()`（**不走 Core 的 `isMessageAllowedInPhase`**——Session WebSocket profile 的 phase 由 Session 包自己维护）
- **[S5]** Agent turn loop 的宿主编排：Session DO **驱动 kernel 的 step loop 并向其注入 delegates**（不是 `kernel.runTurn()` 单函数黑盒——kernel 是 step-driven、可中断、可 checkpoint 的 core，Session DO 在每一步之间做 health check / event dispatch / checkpoint 决策）。**v1 invariant：同一时刻最多一个 active turn（single-active-turn）。**
- **[S5b]** Turn ingress contract（**尚未冻结，需要在 action-plan 前决定**）：当前 NACP-Session 的 7 个消息类型中，"正常用户 turn 输入"没有明确的协议入口。v1 倾向方案：`session.start.body.initial_input` 承载首条输入；后续 turn 输入通过新增的 `session.prompt` 消息类型承载（或复用 `session.start` 的 `initial_input` 语义）。**此项必须在进入 action-plan 前由业主确认。**
- **[S6]** DO storage checkpoint/restore：checkpoint 触发点**不限于 `webSocketClose`**——turn 结束、compact 完成、tool inflight 状态变更、session end 都可能触发。具体 checkpoint seam 由 kernel + workspace snapshot 共同定义。`webSocketClose` 只是触发点之一。
- **[S7]** Alarm handler：v1 仅用于 heartbeat liveness check（`checkHeartbeatHealth()`）
- **[S8]** Ingress authority stamping：消费 `normalizeClientFrame()` 注入 tenant context
- **[S9]** Hook emit integration：在 turn loop 的 PreToolUse / PostToolUse / UserPromptSubmit / Stop / PreCompact / PostCompact 点调用 HookDispatcher
- **[S10]** LLM call integration：在 turn loop 内调用 LLM Executor，消费 stream normalize → `session.stream.event` with `llm.delta` kind
- **[S11]** Tool call integration：通过 Core `ServiceBindingTransport` 调用 capability worker，消费 response + progress → `session.stream.event`
- **[S12]** Graceful shutdown：`session.end` → checkpoint → WebSocket close
- **[S13]** Multi-tenant enforcement：DO id 含 team_uuid；每次 WebSocket frame 入口跑 `verifyTenantBoundary()`

### 5.2 Out-of-Scope（v1 不做）

- **[O1]** Sub-agent spawning / multi-DO federation
- **[O2]** Multi-client attach / observer mode
- **[O3]** Cross-region DO migration
- **[O4]** Session metrics / billing pipeline
- **[O5]** Full agent kernel step scheduling algorithm（那是 kernel 功能簇，Session DO 只调它）
- **[O6]** LLM request construction details（那是 llm-wrapper）
- **[O7]** Tool command registry details（那是 capability-runtime）
- **[O8]** Context compaction algorithm（那是 workspace-context）
- **[O9]** DDL / D1 schema

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **"一个 Session = 一个 DO"** 而不是 **"一个 DO 服务多个 session"**
   - **为什么**：DO 的 strong consistency 是 per-instance 的。多 session 共享一个 DO 会引入锁竞争和隔离漏洞。
   - **代价**：每个 session 一个 DO 实例，CF 按 DO 计费。但单会话成本是美分级。
   - **重评条件**：当 session 密度大到 DO 启动成本成为瓶颈时。

2. **取舍 2**：我们选择 **"kernel 是纯逻辑，Session DO 是宿主"** 而不是 **"kernel 直接操作 WebSocket / storage"**
   - **为什么**：让 kernel 可以在 vitest 里脱离 DO 运行，降低测试成本。
   - **代价**：Session DO 需要做一层"编排 glue"把 kernel output 路由到 WebSocket / storage。
   - **重评条件**：如果 glue 层的代码量超过 kernel 本身，说明抽象不当。

3. **取舍 3**：我们选择 **"DO storage 作为唯一 hot state 存储"** 而不是 **"部分 hot state 放 KV / R2"**
   - **为什么**：DO storage 是 session actor 级别的 strong consistency 存储，读写延迟 ~1ms。KV 的最终一致性不适合 turn-by-turn 的 hot state。
   - **代价**：单 DO 50GB 上限；大文件 / 长 transcript 需要外推到 R2。
   - **重评条件**：当 DO storage 的 key 数量或 value size 接近限制时。

### 6.2 风险与缓解

| 风险 | 触发条件 | 缓解 |
|------|----------|------|
| DO 冷启动延迟 | 长时间无请求后首次 WebSocket 连接 | CF 的 DO 冷启动 < 50ms；alarm 可以提前预热 |
| WebSocket 断线期间丢事件 | client 网络不稳定 | ReplayBuffer + `session.resume` + `last_seen_seq` |
| 单 DO 内存不足（128MB isolate） | 超长会话 + 大 context | checkpoint 到 storage 释放内存；context compact 触发 |
| Alarm 粒度限制（秒级） | 需要亚秒级 polling | 不做亚秒级 polling；用 WebSocket push 替代 |

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|---------------|
| F1 | Worker entry point | `export default { fetch }` handler，routing WS upgrade → DO | ✅ Worker 只做 routing，< 50 行 |
| F2 | NanoSessionDO class | `export class NanoSessionDO implements DurableObject` with `fetch` / `webSocketMessage` / `webSocketClose` / `alarm` | ✅ DO class 可实例化并接受 WebSocket |
| F3 | WebSocket lifecycle | accept → attach(SessionWebSocketHelper) → message dispatch → detach/close | ✅ attach/resume/detach 三条路径走通 |
| F4 | Session phase machine | `unattached → attached → turn_running → ended` transitions in DO state | ✅ 非法 phase transition 被拒绝 |
| F5 | Turn loop orchestration | receive prompt → run kernel → push stream events → loop or end | ✅ 一次完整 turn 可执行 |
| F6 | Checkpoint/restore | `webSocketClose` → checkpoint to storage; resume → restore | ✅ hibernation → wake → resume 走通 |
| F7 | Alarm handler | periodic heartbeat check via `state.storage.setAlarm` | ✅ heartbeat timeout → close |
| F8 | Ingress authority stamp | `normalizeClientFrame(raw, ingressCtx)` on every WS message | ✅ forged authority 被拒绝 |
| F9 | Hook integration | emit PreToolUse / PostToolUse / etc. at turn loop checkpoints | ✅ hook outcome 影响主 loop |
| F10 | LLM integration | call executor → stream normalize → pushEvent `llm.delta` | ✅ LLM stream 走到 client |
| F11 | Tool integration | ServiceBindingTransport → capability worker → response + progress | ✅ tool result 回注 turn loop |
| F12 | Graceful shutdown | session.end → final checkpoint → WS close | ✅ 不丢状态 |
| F13 | Tenant enforcement | DO id team check + NACP boundary check on every message | ✅ 跨租户消息被拒绝 |

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nacp-session（已实现）

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-session/src/websocket.ts` | `SessionWebSocketHelper` — Session DO 直接实例化并使用 |
| `packages/nacp-session/src/ingress.ts` | `normalizeClientFrame()` — DO 内 WebSocket message handler 调用 |
| `packages/nacp-session/src/session-registry.ts` | `assertSessionPhaseAllowed()` — DO 的 phase gate |
| `packages/nacp-session/src/replay.ts` | `ReplayBuffer.checkpoint()` / `.restore()` — DO hibernation 使用 |

### 8.2 来自 nacp-core（已实现）

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-core/src/transport/service-binding.ts` | `ServiceBindingTransport` — DO 调用外部 skill/tool worker |
| `packages/nacp-core/src/tenancy/boundary.ts` | `verifyTenantBoundary()` — DO 的每条消息入口校验 |
| `packages/nacp-core/src/admissibility.ts` | `checkAdmissibility()` — 仅用于 Core 内部消息的 deadline / capability scope 检查。**注意：Session/WebSocket phase legality 不走 Core admissibility，走 `@nano-agent/nacp-session` 的 `assertSessionPhaseAllowed()`** |

### 8.3 来自 codex

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `codex-rs/core/src/codex.rs:343-514` | Turn loop `while step < max_steps` + cancel check + tool exec + event emit | kernel 的主循环骨架 |
| `codex-rs/core/src/codex.rs:6404-6724` | Auto-compact 双检查点（post-sampling + pre-turn）+ `CompactionPhase` enum | Session DO 的 compact trigger 逻辑 |
| `codex-rs/core/src/codex_thread.rs:37-71` | `ThreadConfigSnapshot`（per-turn 临时态）vs `CodexThread`（跨 turn 持久态）的分层 | DO storage 的 checkpoint 分层 |
| `codex-rs/thread-store/src/types.rs:47-72` | `ResumeThreadRecorderParams` / `LoadThreadHistoryParams` 的 resume 参数 | `session.resume` body 设计 |
| `codex-rs/thread-store/src/types.rs:135-178` | `StoredThread` 的 22 个字段（含 git_info, token_usage, first_user_message） | DO checkpoint 的字段清单 |
| `codex-rs/rollout/src/recorder.rs:74-81,189-212` | `RolloutRecorder` JSONL + output 10KB 截断 | 审计日志格式 + trace event truncation |
| `codex-rs/rollout/src/metadata.rs:16-62` | `SessionMetaLine` 含 model_provider, git info, memory_mode | checkpoint 的 metadata 字段 |

### 8.4 来自 claude-code

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `claude-code/state/AppStateStore.ts:89-452` | `AppState` 的字段集（mainLoopModel, tasks, mcp, sessionHooks, speculation, denialTracking） | Session DO 需要 checkpoint 哪些字段的参考 |
| `claude-code/services/compact/autoCompact.ts:51-239` | `AutoCompactTrackingState`（circuit breaker, consecutiveFailures=3）+ `getAutoCompactThreshold()`（`effectiveWindow - 13000`） | **借鉴 circuit breaker 模式和阈值建模方式**——具体阈值需要等 nano-agent 的 LLM wrapper / workspace runtime / Session DO 全部落地后，根据实际 token 分布重新校准 |
| `claude-code/cost-tracker.ts:71-174` | Per-session per-model usage tracking（input/output/cache tokens + cost USD）+ `restoreCostStateForSession()` | checkpoint 应含 usage tracking |
| `claude-code/utils/sessionStorage.ts` | `flushSessionStorage()` 锁定后批量追加 + entry types | DO checkpoint 时的 flush 逻辑 |
| `claude-code/utils/settings/settings.ts:58-199` | 4 层 settings cascade（managed→user→project→local）+ parseSettingsFile 缓存+clone-on-return | KV shared config 的层级模型 |

### 8.5 来自 mini-agent

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `mini_agent/agent.py:90-121` | `_check_cancelled()` + `_cleanup_incomplete_messages()`（只删未完成的 assistant + tool） | Session DO 的 abort 路径 |
| `mini_agent/agent.py:180-259` | `_summarize_messages()` 的 user-boundary 切分策略 | compact 的最简模型 |
| `mini_agent/agent.py:48-84` | `Agent.__init__` 的 5 个核心字段（llm, tools, messages, max_steps, token_limit） | Session DO 的最小状态集 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Session DO Runtime 是 nano-agent 的**物理心脏**。它把 Worker 的 `fetch` 入口、Durable Object 的 `webSocketMessage` / `webSocketClose` / `alarm` 生命周期、以及 NACP-Session 的 replay/ack/heartbeat 能力，组装成一个可持久、可恢复、可治理的**会话 actor**。

v1 的 Session DO 预期代码量 ~500-800 行 TypeScript（不含被调用的子系统），主要职责是"编排 glue"——把 kernel output 路由到 WebSocket / storage / hooks / audit。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | 这是 Cloudflare-native agent 的本质形态 |
| 第一版实现的性价比 | 5 | 大部分重活已被 nacp-session / nacp-core 做完；DO 只做 glue |
| 对三大深耕方向的杠杆 | 5 | 上下文管理走 DO storage；Skill 走 service binding；稳定性走 checkpoint/alarm |
| 风险可控程度 | 4 | DO 冷启动 + 128MB 内存是硬约束；需要 compact 配合 |
| **综合价值** | **5** | **nacp-core + nacp-session + Session DO = 最小可运行的 agent actor** |

### 9.3 下一步行动

- [ ] 等 agent-runtime-kernel 设计完成后，Session DO 的 turn loop orchestration（F5）才能冻结
- [ ] 等 capability-runtime 设计完成后，F11 的 tool integration 才能冻结
- [ ] 等 llm-wrapper action-plan 执行后，F10 的 LLM integration 才能冻结
- [ ] Session DO 的 action-plan 应当是 **post-kernel** 的第一个执行项

---

## 附录

### A. Session DO 的 Durable Object Lifecycle 映射

```
CF Worker fetch(request)
  ↓
  if (WebSocket upgrade) → env.SESSION_DO.get(id).fetch(request)
    ↓
    NanoSessionDO.fetch(request)
      → accept WebSocket → this.state.acceptWebSocket(ws)
      → return new Response(null, { status: 101, webSocket: client })

NanoSessionDO.webSocketMessage(ws, message)
  → parse frame → normalizeClientFrame → authority stamp
  → match message_type:
    "session.start"   → initSession(body) → phase = attached
    "session.resume"  → restoreFromStorage → handleResume(last_seen_seq) → phase = attached
    "session.cancel"  → cancel kernel → phase = attached
    "session.stream.ack" → handleAck(stream_id, acked_seq)
    "session.heartbeat"  → handleHeartbeat()
    (user prompt)     → addToHistory → runTurn() → phase = turn_running
      → kernel steps → pushEvent(llm.delta / tool.call.progress / ...)
      → turn complete → phase = attached

NanoSessionDO.webSocketClose(ws)
  → checkpoint(state.storage) → detach helper

NanoSessionDO.alarm()
  → checkHeartbeatHealth() → if timeout → close socket
  → state.storage.setAlarm(next interval)
```

### B. 跨文档断点待决事项（Cross-Doc Open Items）

> 以下断点由 GPT 和 Kimi 的 cross-review 识别，需在 Stage C 联审中冻结。

**B.1 RuntimeEventEmitter → session.stream.event 映射表**

GPT 的 `agent-runtime-kernel` 定义了 `RuntimeEventEmitter` 产出 runtime events；NACP-Session 已实现 9 种 `SessionStreamEventBody` kinds。以下是候选 1:1 映射（需联审确认）：

| Kernel Runtime Event | Session Stream Event Kind | 说明 |
|----------------------|---------------------------|------|
| turn.started | `turn.begin` | kernel 开始一个 turn |
| turn.completed | `turn.end` | kernel 完成一个 turn |
| llm.delta | `llm.delta` | LLM 流式 token |
| tool.progress | `tool.call.progress` | tool 执行中间状态 |
| tool.completed | `tool.call.result` | tool 执行完成 |
| hook.broadcast | `hook.broadcast` | hook outcome 通知 |
| compact.boundary | `compact.notify` | compact 边界变更 |
| system.error | `system.notify` | 系统级通知（severity=error） |
| session.update | `session.update` | session 元数据变更 |

**B.2 ArtifactRef 与 NacpRefSchema 的关系**

GPT 的 `workspace-context-artifacts` 定义了 `ArtifactRef`；NACP-Core 已实现 `NacpRefSchema`（`{kind, binding, team_uuid, key, role}`）。候选决策：

- `ArtifactRef` 的**核心结构 = NacpRefSchema 实例**（`role: "attachment" | "output"`）
- `ArtifactRef` 可在 `NacpRef` 基础上增加业务字段（`prepared`, `preview_url`, `content_type`, `size_bytes`），放在 `NacpRef.extra` 或一个 typed wrapper 中
- `storage-topology` 的 `workspace_refs: NacpRef[]` 因此可以直接存储 artifact refs

**B.3 Compact 触发权归属**

- **Kernel** 的 `StepScheduler` 预留 `compact-required` 的 `InterruptReason`，但 kernel 本身不直接调用 compact worker
- **Session DO** 负责在 turn 边界检查 token 阈值（借鉴 claude-code `autoCompact` 策略），当阈值触发时，通过 NACP-Core `context.compact.request` 调用 compact worker，然后将结果重新注入 kernel
- 这样 kernel 保持"纯逻辑"，Session DO 保持"宿主编排 + 资源管理"

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-16 | Opus 4.6 | 初稿 |
| v0.2 | 2026-04-16 | Opus 4.6 | 基于 GPT + Kimi review 修订：修正 Session/Core phase 边界(#1)、补 turn ingress contract(#2)、kernel 改为 step-driven(#5)、加 single-active-turn invariant(#6)、扩 checkpoint 触发点(#7)、compact 公式改为"借鉴"(#8)、types.ts→types.rs(#13)、加跨文档断点附录(#16/#17/#18) |
