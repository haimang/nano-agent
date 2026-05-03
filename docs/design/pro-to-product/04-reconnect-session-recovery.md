# Nano-Agent 功能簇设计模板

> 功能簇: `PP3 / Reconnect Session Recovery`
> 讨论日期: `2026-05-02`
> 讨论者: `GPT-5.5`
> 关联调查报告:
> - `docs/charter/plan-pro-to-product.md`
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> 关联 QNA / 决策登记:
> - `docs/charter/plan-pro-to-product.md` §10 T3/T4
> 文档状态: `draft`

---

## 0. 背景与前置约束

- **项目定位回顾**：前端不是一次性 CLI 输出；浏览器刷新、网络断线、设备切换、后台执行都必须能恢复到“可解释”的 session 状态。
- **本次讨论的前置共识**：
  - `session-ws-v1` 已公开 `last_seen_seq`。
  - 当前 public WS 是 User DO attach + agent-core snapshot stream，而不是端到端持久 push log。
- **本设计必须回答的问题**：
  - reconnect 后 server 如何判断 replay 起点？
  - replay 丢失/lagged 时前端看到什么？
  - detached recovery 与 single-attachment supersede 如何与 session truth 对齐？
- **显式排除的讨论范围**：
  - 不设计多活动客户端协同编辑。
  - 不把内部 agent-core helper replay 当成 public contract。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Reconnect Session Recovery`
- **一句话定义**：让前端能在断线/刷新/重连后，用 `last_seen_seq` + durable read model 重建 agent loop 状态。
- **边界描述**：包含 WS attach、last_seen_seq、snapshot replay、detached/active 状态、single attachment supersede、replay_lost/degraded、pending confirmations/context/todos/items 的恢复；不包含多客户端协作、永久 event store v2。

| 术语 | 定义 | 备注 |
|------|------|------|
| `last_seen_seq` | 客户端最后成功处理的 event seq | WS query / HTTP resume |
| `relay_cursor` | User DO 存储的已转发 cursor | 当前 public replay cursor |
| `detached` | socket close 后 session 仍可恢复的非终态 | 不等于 ended |
| `replay_lost` | 客户端声称的 seq 超出 server 可确认 cursor | 当前 HTTP resume 可返回 |
| `lagged/degraded` | 不能完整 replay 时的 frontend-visible recovery state | PP3 必须补强 |

### 1.2 参考调查报告

- `clients/api-docs/session-ws-v1.md` — 当前 WS contract。
- `packages/nacp-session/src/replay.ts` — session replay helper precedent。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

PP3 是前端 agent loop 从 demo 变成产品的关键：用户刷新页面后，不能只靠“重新打开 WS”碰运气。它要求 WS attach、HTTP read model、pending confirmation、context boundary、items/todos 都能形成恢复路径。当前实现已有 `last_seen_seq`、detached 状态、single-attachment supersede、snapshot stream pagination，但 replay loss 与 degraded UX 仍不够完整。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| `01-frontend-trust-contract` | `01 → 04` | 强 | 前端刷新后的最小 state inputs |
| `02-hitl-interrupt-closure` | `04 ↔ 02` | 强 | pending confirmations 必须可恢复 |
| `03-context-budget-closure` | `04 ↔ 03` | 强 | compact boundary/replay 影响历史重建 |
| `05-hook-delivery-closure` | `04 ↔ 05` | 中 | hook outcome frame 不得丢失或 overclaim |
| `07-api-contract-docs-closure` | `04 → 07` | 强 | WS docs 必须标明 replay/lagged 行为 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Reconnect Session Recovery` 是 **远程前端的会话连续性层**，负责 **把断线、重连、replay、detached 状态与 durable read model 统一成可解释恢复流程**，对上游提供 **不中断 agent loop 的体验**，对下游要求 **WS/HTTP docs 不夸大 replay guarantee**。

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 多活动 attachment | Web 协同诱因 | 当前 single attachment 已实现 supersede | 多端协作 phase |
| 永久 WS event log v2 | replay 完美性诱因 | 当前 D1 timeline/read model 足够 PP3 | replay loss 无法接受时 |
| 内部 helper replay public 化 | `ReplayBuffer` 已有 | public WS 实际走 User DO + agent snapshot | protocol v2 再统一 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| `last_seen_seq` | WS query / HTTP resume body | best-effort replay | at-least-once ack |
| `replay_lost` | HTTP resume/read model | degraded signal | WS degraded frame |
| `session.attachment.superseded` | top-level frame | single attachment law | multi-device policy |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：public recovery contract 与 agent-core internal replay helper。
- **解耦原因**：`packages/nacp-session` 的 `ReplayBuffer` 可用于 DO helper，但当前 public WS attach 并不直接对外暴露该 buffer 的 out-of-range error。
- **依赖边界**：前端只依赖 `session-ws-v1`、HTTP resume/status/read models。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：session durable truth + public read models。
- **聚合形式**：重连后前端先 attach WS，再读取 pending confirmations/context/items/todos/runtime；或 attach 失败时走 HTTP resume/status。
- **为什么不能分散**：如果 WS replay 与 HTTP read model 各自表达状态，前端无法判断哪个更权威。

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 gemini-cli 的做法

- **实现概要**：Gemini CLI 在启动时解析 session id、初始化 storage，并清理 expired sessions。
- **亮点**：
  - `resolveSessionId()` 处理 `--resume` / session picker（`context/gemini-cli/packages/cli/src/gemini.tsx:194-225`）。
  - CLI 初始化 storage，挂载 policy updater，并在结束时触发 SessionEnd hook/cleanup（`context/gemini-cli/packages/cli/src/gemini.tsx:524-555`）。
- **值得借鉴**：resume 不是单个 socket 操作，而是 storage + session identity + cleanup discipline。
- **不打算照抄的地方**：Gemini 本地存储没有远程 WS last_seen/replay 问题。

### 4.2 codex 的做法

- **实现概要**：Codex protocol 将 submissions/events 作为客户端-agent 异步队列，session 内有 event sender、status、active turn 与 mailbox。
- **亮点**：
  - protocol 注释明确 submission queue/event queue 边界（`context/codex/codex-rs/protocol/src/protocol.rs:1-5`）。
  - `Codex` 高层接口暴露 submit 与 next_event（`context/codex/codex-rs/core/src/codex.rs:399-410`）。
  - session state 包含 `tx_event/status/active_turn/mailbox`（`context/codex/codex-rs/core/src/codex.rs:837-862`）。
- **值得借鉴**：recovery 的核心是“事件队列 + 当前状态”两者并存。
- **不打算照抄的地方**：不在 PP3 重写成完整 SQ/EQ protocol；先用现有 HTTP/WS facade。

### 4.3 claude-code 的做法

- **实现概要**：Claude Code 支持从日志恢复会话，并支持 background/foreground task 状态同步。
- **亮点**：
  - resume picker 加载 same-repo/all-project logs，并处理 cross-project resume（`context/claude-code/commands/resume/resume.tsx:107-170`）。
  - background hook 在 foregrounded task 与主视图之间同步 messages、loading、abort controller（`context/claude-code/hooks/useSessionBackgrounding.ts:76-144`）。
- **值得借鉴**：恢复不是只回放文本，还要恢复 loading/abort/foreground 状态。
- **不打算照抄的地方**：Claude 的本地 AppState 不适合直接搬到远程后端。

### 4.4 横向对比速查表

| 维度 | gemini-cli | codex | claude-code | nano-agent 倾向 |
|------|------------|-------|-------------|------------------|
| session identity | local storage/session id | protocol conversation/session | message logs | D1 session/conversation |
| event recovery | local chat state | event queue | logs/messages | WS replay + HTTP read models |
| detached/background | local process | session status/mailbox | task AppState | DO `detached` + durable state |
| replay loss | less relevant | queue cursor | log missing/error | `replay_lost` + degraded |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1] WS reconnect via `last_seen_seq`** — attach 时必须从 client cursor 之后 replay。
- **[S2] Detached recovery** — socket close 不等于 session terminal。
- **[S3] Replay lost/degraded UX** — 无法完整 replay 时必须有 frontend-visible signal。
- **[S4] State snapshot recovery bundle** — confirmations/context/items/todos/runtime 共同组成恢复状态。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1] 多活动客户端** — 当前 single attachment。
- **[O2] Exactly-once delivery** — 当前最多做到 at-least-visible + degraded。
- **[O3] event-store v2** — PP3 不重写底层存储。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `ReplayBuffer` out-of-range | precedent/internal | public path未直接暴露 | PP3 借鉴，不作为 docs contract |
| `stream_snapshot` internal RPC | internal | agent-core internal surface | 不进 client docs |
| `/sessions/{id}/resume` HTTP | in-scope if public | 当前可返回 `replay_lost` | PP6 核对 docs |
| `session.attachment.superseded` | in-scope | 前端必须处理 close/replaced | WS docs |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **best-effort replay + durable read model** 而不是 **立即建设永久 event log**
   - **为什么**：当前 D1 session truth/read models 已能支撑前端恢复大部分状态。
   - **我们接受的代价**：不能承诺 exactly-once 或无限 replay。
   - **未来重评条件**：live 前端频繁遇到 replay gap。

2. **取舍 2**：我们选择 **single attachment supersede** 而不是 **多端同时在线**
   - **为什么**：避免并发 cursor/decision/todo 冲突。
   - **我们接受的代价**：用户第二设备会踢掉第一设备。
   - **未来重评条件**：明确多端协作需求。

3. **取舍 3**：我们选择 **degraded 明示** 而不是 **silent fallback to latest state**
   - **为什么**：前端需要知道中间 stream 可能丢失，才能提示用户刷新/重读。
   - **我们接受的代价**：多一种 UI 状态。
   - **未来重评条件**：event log 保证完整 replay 后可简化。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| seq 语义分叉 | agent snapshot seq 与 D1 event_seq 不同源 | replay 错位 | PP3 明确 public seq owner |
| replay loss silent | client last_seen > relay_cursor | UI 误以为完整 | HTTP/WS degraded signal |
| pending state 漏恢复 | 只回放 stream，不读 read models | HITL 卡住 | recovery bundle 强制包含 confirmations |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：明确当前 first-wave WS 与真正 recovery closure 的差距。
- **对 nano-agent 的长期演进**：为多端、SDK、persistent event store 留出清晰接口。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：HITL/context/hook 都能在 reconnect 后恢复可解释状态。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Reconnect Cursor Law | `last_seen_seq` 与 relay cursor 的使用规则 | ✅ reconnect 不丢已知新帧 |
| F2 | Detached State Recovery | close 后 session 保持 detached/readable | ✅ 刷新可恢复 |
| F3 | Replay Lost Degraded | replay gap 变成 public signal | ✅ silent loss 消失 |
| F4 | Recovery Bundle | pending/read-model 状态组合恢复 | ✅ UI 可重建 |

### 7.2 详细阐述

#### F1: Reconnect Cursor Law

- **输入**：WS query `last_seen_seq`、session `relay_cursor`、agent stream frames。
- **输出**：从 replay cursor 之后转发 event frames。
- **主要调用者**：User DO WS runtime。
- **核心逻辑**：`ws-runtime.ts:133-145` 当前用 `clientLastSeenSeq === null ? entry.relay_cursor : Math.min(entry.relay_cursor, clientLastSeenSeq)` 计算 replay cursor，并转发 `seq > cursor`。
- **边界情况**：client seq 超前时不能 silent；需要 degraded/replay_lost。
- **一句话收口目标**：✅ **last_seen_seq 有明确、可文档化语义。**

#### F2: Detached State Recovery

- **输入**：socket close、session entry。
- **输出**：session status `detached`，后续 attach 改回 active。
- **主要调用者**：User DO WS runtime。
- **核心逻辑**：`markDetached()` 在 socket close 后写 `status: "detached"`；attach 后写 `status: "active"`。
- **边界情况**：terminal session 不允许恢复，应返回 terminal response。
- **一句话收口目标**：✅ **断线不是结束。**

#### F3: Replay Lost Degraded

- **输入**：HTTP resume 或 WS attach 的 client cursor。
- **输出**：`replay_lost` / degraded frame / audit。
- **主要调用者**：frontend、User DO。
- **核心逻辑**：当前 `surface-runtime.ts:280-319` 的 HTTP resume 能判断 `last_seen_seq > relay_cursor` 并记录 `session.replay_lost`，但 WS attach 还缺等价 frontend-visible degraded。
- **边界情况**：如果 server 只能给 latest state，应显式告诉前端中间 stream 不完整。
- **一句话收口目标**：✅ **replay gap 不再静默。**

#### F4: Recovery Bundle

- **输入**：WS replay、confirmations list、context probe、runtime、items/todos/tool-calls。
- **输出**：前端重建 UI 的最小状态包。
- **主要调用者**：frontend、PP6 docs。
- **核心逻辑**：重连流程不能只依赖 WS；必须规定哪些 HTTP read models 是 reconnect 后强制刷新项。
- **边界情况**：pending confirmation 或 compact boundary 可能没有新的 WS frame，但 D1 row 是 truth。
- **一句话收口目标**：✅ **刷新后 UI 状态完整可解释。**

### 7.3 非功能性要求与验证策略

- **性能目标**：reconnect replay/lagged verdict ≤2s alert threshold。
- **可观测性要求**：`session.replay_lost` audit、`session.attachment.superseded` audit/frame。
- **稳定性要求**：reattach 不得双 socket 同时写同 session。
- **安全 / 权限要求**：WS attach 必须 auth/device gate。
- **测试覆盖要求**：last_seen replay、seq超前 degraded、single attachment supersede、detached reattach、terminal session rejection。
- **验证策略**：orchestrator route/DO tests + live WS cross-e2e。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/cli/src/gemini.tsx:194-225` | resume/session id resolution | session identity first | |
| `context/gemini-cli/packages/cli/src/gemini.tsx:524-555` | storage init + cleanup hooks | resume 需要 storage discipline | |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/protocol/src/protocol.rs:1-5` | SQ/EQ boundary | event queue + submissions | |
| `context/codex/codex-rs/core/src/codex.rs:399-410` | submit / next_event interface | client-agent async loop | |
| `context/codex/codex-rs/core/src/codex.rs:837-862` | session tx_event/status/mailbox | recovery state不只是消息 | |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/commands/resume/resume.tsx:107-170` | resume logs + cross-project handling | resume 需要可解释失败路径 | |
| `context/claude-code/hooks/useSessionBackgrounding.ts:76-144` | foreground/background sync | detached recovery 包含 loading/abort state | |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `clients/api-docs/session-ws-v1.md:13-29` | connect URL + `last_seen_seq` + start attach window | public contract baseline |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts:72-145` | parse cursor, attach, replay stream frames | current first-wave implementation |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts:86-110` | attachment supersede | single attachment law |
| `workers/orchestrator-core/src/user-do/ws-runtime.ts:237-245` | mark detached on close | recovery state |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts:280-319` | HTTP resume replay_lost | degraded precedent |
| `packages/nacp-session/src/replay.ts:58-73` | ReplayBuffer out-of-range error | internal precedent for explicit loss |
| `workers/agent-core/src/host/do/session-do-persistence.ts:154-160,193-222` | helper checkpoint writes but restore only restores main checkpoint | internal/public recovery 不可混淆 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| D-04-1 | PP3 是否承诺 exactly-once replay？ | PP3/PP6 | 否 | proposed | 本设计 |
| D-04-2 | 是否支持多活动 attachment？ | PP3 | 否，single attachment | frozen/current code | `ws-runtime.ts` |
| D-04-3 | replay gap 是否允许 silent latest-state fallback？ | PP3 | 否，必须 degraded | proposed | 本设计 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. `last_seen_seq` 与 `relay_cursor` 语义明确。
2. WS attach 与 HTTP resume 的 replay_lost 行为对齐。
3. detached/terminal/reattach/supersede 状态有 docs。
4. 重连后 frontend recovery bundle 明确。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/pro-to-product/PP3-reconnect-session-recovery-action-plan.md`
- **需要同步更新的设计文档**：
  - `07-api-contract-docs-closure.md` 的 WS docs sweep。
- **需要进入 QNA register 的问题**：
  - 无；当前取舍可由 charter truth gates 支撑。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

`Reconnect Session Recovery` 的价值在于让前端不再把 WS 当成“在线时才有意义”的临时管道。当前代码已有很多正确 substrate：`last_seen_seq`、single attachment、detached、HTTP resume、snapshot stream；但 PP3 closure 需要把 replay gap、state bundle 与 docs truth 补齐，否则前端仍会在刷新/断线后遇到不可解释状态。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | web frontend 必需 |
| 第一版实现的性价比 | 4 | substrate 已有，需补 degraded/对账 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 5 | 所有异步能力都依赖 recovery |
| 对开发者自己的日用友好度 | 5 | 刷新/断线可恢复 |
| 风险可控程度 | 3 | seq owner 与 replay guarantee 需谨慎 |
| **综合价值** | 5 | P0 必做 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否需要现在做永久 event log。
  - **A 方观点**：否则 replay 不能完美。
  - **B 方观点**：PP3 可以用 best-effort replay + durable read model + degraded 明示。
  - **最终共识**：先不建 event log v2，但不得 silent loss。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-05-02` | `GPT-5.5` | 初稿 |
