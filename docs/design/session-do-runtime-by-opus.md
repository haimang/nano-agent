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

- **实现概要**：单进程 Python，`Agent` class 持有 `messages: list[Message]`，`run()` 是一个 while loop。没有持久化、没有 actor、没有恢复。
- **值得借鉴**：`Agent.run()` 的极简结构——"call LLM → check tool calls → execute tools → append → repeat"。这是 kernel 的最小形态。
- **不打算照抄的**：完全无持久化、无 cancel、无 checkpoint。

### 4.2 codex 的做法

- **实现概要**：Rust workspace，`Codex` / `Session` / `TurnContext` 三层状态；rollout JSONL 持久化；sub-agent 通过 `codex_delegate.rs` fork 独立 `Codex` 实例。
- **值得借鉴**：
  - **Session / TurnContext 分离**：Session 是长期状态（跨 turn），TurnContext 是短期状态（单 turn 内）。这个分层对 nano-agent 的 DO storage 结构有直接启发。
  - **rollout JSONL 的流式追加**：每个 event 一行 JSON，既可 replay 又可 audit。
  - **`forward_events()` 把子 agent 事件转发到主 session**：对 nano-agent 来说，这等价于"tool worker 的 progress 如何通过 service binding 的 ReadableStream 回到 Session DO"。
- **不打算照抄的**：Rust 进程内的 `Mutex<SessionState>` 模型（我们用 DO storage）；sub-agent 的 `ForkStrategy`（v1 不做 sub-agent）。

### 4.3 claude-code 的做法

- **实现概要**：TypeScript，`AppState` Zustand-style store，`query.ts` 的 agent loop，`forkedAgent.ts` 的 `CacheSafeParams` 保护子 agent 不撞碎父 cache。
- **值得借鉴**：
  - **`CacheSafeParams` 的 freeze-on-fork 心智**：session 分裂时冻结 system prompt + tool schema 保证 cache key 稳定。nano-agent 的 DO checkpoint 应该有类似的"system context snapshot"。
  - **`runToolsConcurrently()` 按 `isConcurrencySafe` 划分批次**：这是 kernel 的 step 调度逻辑的参考。
  - **`flushSessionStorage()` 在进程退出时清盘**：类似 DO `webSocketClose` / `alarm` 时的 checkpoint。
- **不打算照抄的**：React-based TUI / AppStateProvider（我们用 WebSocket + DO storage）；`tools.ts` 里 40+ 工具的 UI 渲染耦合。

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | **nano-agent 倾向** |
|------|-----------|-------|-------------|---------------------|
| 会话 actor 模型 | 无（单进程） | `Codex` / `Session` 类 | `AppState` store | **Durable Object instance** |
| 持久化 | 无 | JSONL rollout | sessionStorage | **DO state.storage checkpoint** |
| 恢复能力 | 无 | rollout replay | 无 | **DO hibernation + checkpoint/restore** |
| WebSocket | 无 | 无 | 无 | **一等公民** |
| Turn loop 宿主 | `Agent.run()` while | `codex.rs:343+` while | `query.ts` agent loop | **Session DO 内嵌 kernel** |
| 子系统组装 | 构造函数注入 tools | Rust trait + config | React context + lazy import | **DO constructor 注入 composition** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（v1 要做）

- **[S1]** Worker entry point：fetch handler，routing WebSocket upgrade → DO
- **[S2]** Session DO class 定义：`export class NanoSessionDO implements DurableObject`
- **[S3]** WebSocket accept + attach（消费 `@nano-agent/nacp-session` 的 `SessionWebSocketHelper`）
- **[S4]** Session state machine（`unattached → attached → turn_running → ended`）使用 `@nano-agent/nacp-session` 的 phase gate
- **[S5]** Agent turn loop 的宿主编排：接收用户输入 → 调 kernel → 调 LLM → 调 tools → push stream events → 循环或结束
- **[S6]** DO storage checkpoint/restore：`webSocketClose` 时 checkpoint，`webSocketMessage` (resume) 时 restore
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
| `packages/nacp-core/src/admissibility.ts` | `checkAdmissibility()` with `session_phase` — DO 的 phase-aware admissibility |

### 8.3 来自 codex

| 文件 | 借鉴点 |
|------|--------|
| `context/codex/codex-rs/core/src/codex.rs:343-514` | Turn loop 结构：while step < max_steps |
| `context/codex/codex-rs/core/src/codex.rs:840` | Session state 分离 |
| `context/codex/codex-rs/rollout/src/recorder.rs:65` | JSONL 流式追加作为 audit trail |

### 8.4 来自 claude-code

| 文件 | 借鉴点 |
|------|--------|
| `context/claude-code/query.ts` | agent loop + normalizeMessagesForAPI + runTools |
| `context/claude-code/utils/forkedAgent.ts` | `CacheSafeParams` freeze-on-fork 心智 |
| `context/claude-code/state/AppStateStore.ts` | 中央 store pattern |

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

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-16 | Opus 4.6 | 初稿 |
