# Nano-Agent Session Edge Closure 功能簇设计

> 功能簇: `Session Edge Closure`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
> - `docs/design/after-skeleton/P0-identifier-law.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

在当前 repo 中，`@nano-agent/nacp-session` 已经把 session profile 的合法合同冻结到了一个可用基线：

- `normalizeClientFrame()` 负责 authority stamping + full validation（`packages/nacp-session/src/ingress.ts:25-74`）
- `SessionWebSocketHelper` 已负责 attach/replay/ack/heartbeat/checkpoint/restore（`packages/nacp-session/src/websocket.ts:28-247`）
- `assertSessionRoleAllowed()` 与 `assertSessionPhaseAllowed()` 已明确 session-owned legality（`packages/nacp-session/src/session-registry.ts:23-104`）
- `SessionStreamEventBodySchema` 已冻结 9 个 server-push kinds（`packages/nacp-session/src/stream-event.ts:10-97`）

但 `@nano-agent/session-do-runtime` 当前还没有真正把这套 reality 装配成唯一 session edge：

- `NanoSessionDO.webSocketMessage()` 仍然直接 `JSON.parse()` 后按 `message_type` 分发（`packages/session-do-runtime/src/do/nano-session-do.ts:194-258`）
- `WsController` / `HttpController` 仍是明显 stub（`packages/session-do-runtime/src/ws-controller.ts:18-56`, `http-controller.ts:32-102`）
- `turn-ingress.ts` 明确表明 **当前只有 `session.start.body.initial_input` 是已冻结 turn ingress reality**（`packages/session-do-runtime/src/turn-ingress.ts:26-104`）
- Q8 之后，formal follow-up input family 已被 owner 提升为 **Phase 0 必须补齐的 `nacp-session` contract surface**，但 runtime 仍不能在它冻结前私造 wire truth

所以 Phase 3 的任务不是“发明新的 session edge”，而是把已经存在的 `nacp-session` truth 变成真正唯一的 session edge truth。

- **项目定位回顾**：nano-agent 是 WebSocket-first、DO-centered、single-active-turn 的 runtime，不是 REST-first 聊天 API。
- **本次讨论的前置共识**：
  - `nacp-session` 是 session edge legality 的 source of truth。
  - formal follow-up input family 已不再属于“下一阶段再说”；它必须先在 `nacp-session` / Phase 0 层冻结，再由 Phase 3 消费该 truth。
  - Session edge 必须同时服务 live WS、resume/replay、caller-managed health、HTTP fallback。
  - `trace_uuid` law 已经是上位约束，session edge 不能继续产生无 trace 的 accepted internal work。
  - Phase 3 的 trace wiring 依赖 P0 rename/compat 与 P2 foundation 升级先落地；在那之前，本设计讨论的是 owner-aligned target edge，而不是宣称当前代码已满足新 trace law。
- **显式排除的讨论范围**：
  - 不负责发明 multi-round prompt family 的 contract shape；该 shape 必须由 P0 / `nacp-session` 先冻结
  - 不讨论多客户端 attach / observer mode
  - 不讨论 sub-agent / cross-DO federation
  - 不讨论完整 public SDK 形态

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Session Edge Closure`
- **一句话定义**：它负责把 Worker entry、WS/HTTP ingress、authority stamping、session frame validation、replay/ack/heartbeat、single-active-turn orchestration 这条边界真正闭合成一条唯一主路径。
- **边界描述**：**包含** routing、upgrade、normalized ingress、helper assembly、replay/resume/health、HTTP fallback semantics、edge-side trace emission，以及对 upstream frozen follow-up family 的接线约束；**不包含** follow-up queue/replace policy 的完整产品化设计、前端 SDK、复杂 observer 模式。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Session Edge** | client 到 Session DO 的真实入口边界 | WS-first + HTTP fallback |
| **Normalized Ingress** | raw input 经 route + parse + authority stamping + schema/phase/role 校验后的唯一合法形态 | 以 `nacp-session` 为真相源 |
| **Single-active-turn** | 任意时刻最多一个 active turn 在运行 | 当前阶段 invariant |
| **Replay Edge** | reconnect/resume 后从 replay buffer 重新补发可见事件的路径 | 与 live WS 同属 edge |
| **Fallback Edge** | 不能使用 WebSocket 时的 HTTP polling/command 路径 | 不是新的业务模型 |

### 1.2 参考调查报告

- `docs/investigation/codex-by-opus.md` — session/turn state 分层与 resume/replay 参考最强
- `docs/investigation/claude-code-by-opus.md` — session runner 与 live activity extraction 很适合作为 live observation 参考
- `docs/investigation/mini-agent-by-opus.md` — 单线程 / 单活跃执行模型是可行基线，但缺少 durable edge

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **runtime closure 的第一道物理边界**。
- 它服务于：
  1. Client/Web UI
  2. `session-do-runtime`
  3. `nacp-session`
  4. `eval-observability`
- 它依赖：
  - `nacp-session` 的 frame/message/registry/websocket helper reality
  - `trace-first-observability-foundation.md`
  - `turn-ingress.ts` 的当前最小现实
- 它被谁依赖：
  - `agent-runtime-kernel`
  - future API / SDK design
  - E2E runner / replay / failure diagnosis

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `NACP-Session` | Closure -> Session | 强 | legality、stream schema、replay/ack/heartbeat 都受其约束 |
| `Session DO Runtime` | 双向 | 强 | Phase 3 的主要实现宿主 |
| `Trace-first Observability Foundation` | Closure -> Trace | 强 | ingress / attach / replay / alarm 都要 emit trace |
| `Agent Runtime Kernel` | Closure -> Kernel | 中 | edge 负责把合法 turn input 交给 kernel |
| `Eval-Observability` | Closure -> Eval | 中 | live stream 与 durable replay 需要对齐 |
| `Public API / Frontend` | Closure -> Public | 弱 | public seam 后续会建立在此基线上 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Session Edge Closure` 是 **client ↔ session actor 的唯一物理边界设计**，负责 **把 WS/HTTP ingress、authority stamping、role/phase legality、single-active-turn orchestration、replay/ack/heartbeat 统一成一条不漂移的 session edge 主路径**，对上游提供 **稳定的 live/reconnect/fallback 语义**，对下游要求 **不再绕开 `@nano-agent/nacp-session` 自造平行入口**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 在 `session-do-runtime` 私自发明 follow-up wire | 交付压力 + runtime 便利性 | 会制造 protocol/runtime 双真相 | 高 |
| 多客户端 attach / observer mode | 复杂 session 系统 | 会显著放大 replay/ack/state 复杂度 | 可能 |
| REST-first 替代 WS-first | 传统 API 风格 | 与 nano-agent 定位冲突 | 否 |
| 在 `session-do-runtime` 内继续手写平行 legality | 当前 stub 实现残留 | 会与 `nacp-session` 漂移 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Turn ingress seam | `extractTurnInput()` / future prompt family adapter | 先消费 `session.start.initial_input`，并为 upstream frozen follow-up family 预留正规接线点 | future queue / replace / approval-aware prompt policies |
| HTTP fallback | `HttpController` + timeline/status route | 与 WS 共享同一 session model | richer polling / resumable fetch |
| Replay control | `last_seen_seq` + helper resume path | reconnect 后 replay | future observer catch-up |
| Health gate | caller-managed `checkHeartbeatHealth/checkAckHealth` | 由 DO alarm/lifecycle 驱动 | richer backpressure policies |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：Session legality vs runtime orchestration
- **解耦原因**：frame/message/role/phase legality 应由 `nacp-session` 统一提供，DO runtime 只消费结果。
- **依赖边界**：`NanoSessionDO` 不再自己解析/猜测合法性。

- **解耦对象**：Live WS edge vs HTTP fallback edge
- **解耦原因**：两者是 transport 形态差异，不应变成两套 session 业务模型。
- **依赖边界**：共享同一 actor state、same event/output truth。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：所有 session ingress/egress legality
- **聚合形式**：`routeRequest()` → `normalizeClientFrame()` → `assertSessionRoleAllowed()` → `assertSessionPhaseAllowed()` → `SessionWebSocketHelper`
- **为什么不能分散**：分散后会重新出现 WS 路径一套、HTTP 路径一套、controller stub 一套的现实。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：单进程 loop，取消与 message cleanup 简洁，但没有 durable session edge。
- **亮点**：
  - 单活跃执行模型清楚
  - cancel cleanup 语义直接
- **值得借鉴**：
  - single-active-turn 作为早期正确性模型
- **不打算照抄的地方**：
  - 不继续停留在纯内存、无 replay 的边界

### 4.2 codex 的做法

- **实现概要**：session state 与 turn state 分层，pending input / cancellation / resume 意识很强。
- **亮点**：
  - session-wide vs turn-scoped 分层明确
  - pending inputs / approvals / cancellation token 设计成熟
- **值得借鉴**：
  - session edge 应明确区分 session-scoped 与 turn-scoped 状态
- **不打算照抄的地方**：
  - 不复制其本地 CLI / crate 复杂度

### 4.3 claude-code 的做法

- **实现概要**：session runner/live activity extraction 说明 live edge 需要稳定的活动提取与状态摘要。
- **亮点**：
  - live activity 的提取与 summarization 很实用
  - permission request / tool-use 活动有明显 bridge seam
- **值得借鉴**：
  - session edge 不只是 transport，还要能产生可诊断的活动流
- **不打算照抄的地方**：
  - 不引入其本地 child process/session bridge 复杂度

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 单活跃执行模型 | 高 | 中 | 中 | 高 |
| durable session edge | 低 | 高 | 中 | 高 |
| live activity extraction | 低 | 中 | 高 | 中高 |
| HTTP fallback / reconnect 语义 | 低 | 中 | 中 | 高 |
| 对 WebSocket-first DO 环境适配 | 低 | 低 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Worker route + WS upgrade + HTTP fallback 统一边界**
- **[S2] `nacp-session` legality 真正接入 session-do-runtime 主路径**
- **[S3] `SessionWebSocketHelper` 真正装配到 Session DO**
- **[S4] replay/ack/heartbeat/caller-managed health 闭合**
- **[S5] single-active-turn invariants 与 widened session ingress contract 对齐**
- **[S6] edge-side trace emission 对齐 Phase 2 foundation**

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] multi-turn queue / replace / merge policy 的完整产品语义**
- **[O2] multi-client attach / observer mode**
- **[O3] complex public SDK / frontend protocol**
- **[O4] sub-agent or cross-DO federation**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `session.start.body.initial_input` | in-scope | 当前唯一已冻结 turn ingress reality |
| `session.resume.body.last_seen_seq` | in-scope | replay/resume 主路径必须真实接线 |
| formal follow-up / multi-round input family | in-scope（依赖 P0） | Q8 已确认必须进入 `nacp-session` frozen surface，P3 不能再把它视为下一阶段事务 |
| follow-up queue / replace policy | out-of-scope | 需要独立的 turn scheduling / product semantics 设计 |
| HTTP fallback timeline/status | in-scope | 是 session edge 的一部分，不是下一阶段才有 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **`nacp-session` 作为唯一 legality truth**，而不是 **让 `session-do-runtime` 自己手写 JSON switch**
   - **为什么**：frame/body/role/phase/replay/health contract 都已经在 `nacp-session` 内冻结。
   - **我们接受的代价**：`session-do-runtime` 需要重构现有 stub 主路径。
   - **未来重评条件**：无；这是 closure 的根本方向。

2. **取舍 2**：我们选择 **WS-first + HTTP fallback**，而不是 **HTTP-first**
   - **为什么**：nano-agent 的主交互是流式 session，不是传统 request/response API。
   - **我们接受的代价**：需要更认真地处理 attach/replay/ack/heartbeat。
   - **未来重评条件**：只有当产品交互模型发生根本变化，才可能改写。

3. **取舍 3**：我们选择 **single-active-turn**，而不是 **并发 turn / queue-first**
   - **为什么**：即使 formal follow-up input family 被纳入 Phase 0，P3 仍需要一个最清晰、最易验证的执行基线；single-active-turn 能保证 widened input surface 不会直接把 runtime 推进到并发调度泥潭里。
   - **我们接受的代价**：follow-up family 的协议冻结会先于完整 queue / replace UX 落地。
   - **未来重评条件**：当 follow-up queue semantics 与 kernel turn policy 被正式设计后，再评估扩展。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| session-do-runtime 继续保留平行主路径 | 改动不彻底 | legality 漂移 | 强制所有 ingress 都经 `nacp-session` helper |
| HTTP fallback 变成另一套业务协议 | controller 自由发挥 | public seam 漂移 | 规定 HTTP 只是 transport fallback，不是新业务模型 |
| follow-up family 先完成协议冻结，但 runtime queue 语义仍未闭合 | Q8 要求 widened v1 surface | 用户预期可能先于执行语义成熟 | 明确区分“上游协议已冻结”和“下游调度语义仍待独立设计” |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能把 session edge 从 stub / 注释 / README 幻觉收敛成真实主路径。
- **对 nano-agent 的长期演进**：后续多轮输入、observer mode、public API 都能建立在已闭合的边界上。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性立即受益，context/skill 也因此获得稳定的 live/replay 入口。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Normalized Ingress Path | route + parse + authority + legality + dispatch | 不再存在绕开 `nacp-session` 的平行 ingress |
| F2 | WebSocket Helper Assembly | 真正装配 replay/ack/heartbeat/checkpoint/restore | Session DO 的 WS 边界由 helper 承担 |
| F3 | Single-active-turn Edge Model | 在 widened input contract 上维持单活跃执行基线 | edge 与 upstream contract / runtime policy 不再互相说谎 |
| F4 | HTTP Fallback Closure | 与 WS 共享同一 session model | fallback 不再只是静态 stub |
| F5 | Edge Trace Wiring | attach/resume/replay/health 都 emit trace evidence | Phase 2 foundation 真正进入 edge |

### 7.2 详细阐述

#### F1: `Normalized Ingress Path`

- **输入**：raw WebSocket/HTTP request
- **输出**：合法的 `NacpSessionFrame` 或明确错误
- **主要调用者**：`NanoSessionDO`、`WsController`、`HttpController`
- **核心逻辑**：
  1. `routeRequest()` 决定 WS 或 HTTP fallback
  2. raw payload 进入 `normalizeClientFrame()`
  3. `assertSessionRoleAllowed()` / `assertSessionPhaseAllowed()` 完成 role/phase gate
  4. 再 dispatch 到 `SessionWebSocketHelper` / orchestrator
- **边界情况**：
  - 对 HTTP fallback 也应复用同一 normalized edge truth，而不是发明旁路 body
- **一句话收口目标**：✅ **`所有进入 Session DO 的客户端输入都经统一合法化管道处理`**

#### F2: `WebSocket Helper Assembly`

- **输入**：合法 session frame、SessionContext、socket/storage
- **输出**：统一的 attach/replay/ack/heartbeat/checkpoint/restore 行为
- **主要调用者**：`NanoSessionDO`
- **核心逻辑**：真正持有并装配 `SessionWebSocketHelper`，不再手工维护 `pendingCount` 与 `lastHeartbeatAt` 的平行逻辑。
- **边界情况**：
  - caller-managed health 仍成立，但 health 检查必须调用 helper 提供的 API
- **一句话收口目标**：✅ **`WS replay/ack/heartbeat/checkpoint 由 helper 统一实现，不再散落在 DO 里`**

#### F3: `Single-active-turn Edge Model`

- **输入**：当前首轮 reality + upstream frozen follow-up input family
- **输出**：清晰的 edge invariant
- **主要调用者**：session edge、kernel host
- **核心逻辑**：
  - `session.start.body.initial_input` 仍是首个 turn 的 canonical 入口
  - formal follow-up / multi-round input family 必须由 `nacp-session` 先冻结，P3 只消费这条上游 truth，而不是继续把它推迟到下一阶段
  - 无论输入来自首轮还是 follow-up family，当前时刻最多一个 active turn
  - cancel/end/resume 均围绕此 invariant 设计
- **边界情况**：
  - 若 upstream frozen follow-up family 尚未在 runtime 中完全接线，Phase 3 也不得 silently coerce 到 `session.start` 或改用 DO 私有消息兜底
  - 具体 queue / replace / merge 结果必须由后续 turn policy 设计明确，而不是在 edge 层临时发挥
- **一句话收口目标**：✅ **`session edge 的执行边界与 upstream frozen contract 保持一致，同时不在 runtime 层偷造第二套语义`**

#### F4: `HTTP Fallback Closure`

- **输入**：`/sessions/:sessionId/:action`
- **输出**：与 WS 共享同一 actor state 与 output truth
- **主要调用者**：不能使用 WS 的客户端、测试 harness
- **核心逻辑**：
  - fallback 只提供 transport 替代，不提供另一套业务语义
  - `status` / `timeline` / `cancel` / `end` 需对齐真实 actor state 与 timeline
- **边界情况**：
  - 不在本阶段扩展复杂 input family
- **一句话收口目标**：✅ **`HTTP fallback 是 session edge 的另一种 transport，不是另一种协议宇宙`**

#### F5: `Edge Trace Wiring`

- **输入**：edge-side lifecycle
- **输出**：attach/resume/replay/health trace evidence
- **主要调用者**：`session-do-runtime`、`eval-observability`
- **核心逻辑**：WS attach、resume accepted、replay triggered、ack mismatch、heartbeat timeout、checkpoint/restore 都必须 emit trace。
- **边界情况**：
  - 高频 live stream 本身未必 durable，但关键 edge boundary 必须 durable 或至少 anchorable
- **一句话收口目标**：✅ **`session edge 不再是 trace blind spot`**

### 7.3 非功能性要求

- **性能目标**：edge legalization 必须薄且集中，不能引入多次重复 parse。
- **可观测性要求**：attach/resume/replay/health 全部有固定 evidence 位置。
- **稳定性要求**：不允许 WS 与 HTTP fallback 漂移成两套 reality。
- **测试覆盖要求**：至少覆盖 normalize path、phase/role gate、首轮 + formal follow-up family 的 ingress 路径、replay/ack/heartbeat、HTTP fallback 与 trace emission。
- **阶段门禁要求**：Phase 3 的 edge trace wiring 只能建立在 P2 升级后的 canonical trace carrier 上；若 `nacp-session` / `session-do-runtime` 仍停留在 retired trace fields，本阶段不得假装 trace closure 已经完成。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/agent.py:90-121` | cancel check + cleanup incomplete messages | single-active execution 与 cancel cleanup 的简洁模型值得借鉴 | 但缺 durable edge |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/state/session.rs:19-57` | session-scoped persistent state | session state 与 turn state 要分层 |
| `context/codex/codex-rs/core/src/state/turn.rs:26-109` | active turn / pending input / cancellation scaffolding | turn-scoped state 要有明确独立模型 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/bridge/sessionRunner.ts:107-199` | live activity extraction / result stream | live session edge 不只是 transport，还要有稳定活动抽取 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/session-do-runtime/src/do/nano-session-do.ts:194-258` | 当前直接 `JSON.parse()` + `message_type` switch | 这是必须被 Phase 3 替换的平行 ingress |
| `packages/session-do-runtime/src/ws-controller.ts:18-56` | 仍是 stub upgrade/message/close | 说明 edge 还没真正闭合 |
| `packages/session-do-runtime/src/http-controller.ts:32-102` | fallback 仍返回静态 stub body | 说明 fallback 还不是 session model 的 transport 替身 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Session Edge Closure` 是 post-skeleton 阶段把“协议包已经存在”转化为“真实运行时边界已经成立”的关键一步。它不是去在 runtime 层发明更多消息类型，而是把 `nacp-session` 的现有 reality 与即将由 Phase 0 冻结的 formal follow-up family 一起变成唯一主路径：统一合法化、统一 replay/health、统一 WS/HTTP fallback 语义、统一 trace evidence。这个 closure 一旦完成，session edge 才真正从 skeleton 过渡到 runtime。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | WS-first DO actor 的真实入口必须先闭合 |
| 第一版实现的性价比 | 5 | 主要是把现有包接成真，不是重新发明协议 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | 所有后续能力都依赖稳定 session edge |
| 对开发者自己的日用友好度 | 4 | 前期重构成本明显，但长期减少大量边界噪音 |
| 风险可控程度 | 4 | 风险主要来自 stub 主路径替换，但方向明确 |
| **综合价值** | **5** | **是 Phase 3 最核心的 runtime closure design** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 Phase 3 必须消费 P0 冻结后的 formal follow-up family，而不是继续把它声明为下一阶段事务。
- [ ] **关联 Issue / PR**：优先把 `NanoSessionDO` / `WsController` / `HttpController` 接到 `nacp-session` reality。
- [ ] **待深入调查的子问题**：
  - [ ] HTTP fallback 的最小返回体是否直接复用 timeline/status reader seam
- [ ] **需要更新的其他设计文档**：
  - `trace-first-observability-foundation.md`
  - `external-seam-closure.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是先扩多轮输入，还是先把现有 edge 真正闭合
  - **A 方观点**：先补用户最直观的 follow-up 能力
  - **B 方观点**：当前更关键的是不再让 session edge 漂移
  - **最终共识**：按 owner Q8 决策，formal follow-up family 必须先进入 Phase 0 的 `nacp-session` contract freeze；Phase 3 负责消费这条 truth，而不是继续 defer 或在 runtime 私造消息

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.2 | `2026-04-18` | `GPT-5.4` | 根据 PX-QNA Q8 改写 follow-up family 口径：不再 defer 到下一阶段，改为由 Phase 0 冻结并由 Phase 3 消费 |
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
