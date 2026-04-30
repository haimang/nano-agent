# Nano-Agent 功能簇设计

> 功能簇: `HP5 Confirmation Control Plane`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `packages/nacp-session/src/messages.ts:146-191,232-255`
> - `workers/agent-core/src/hooks/dispatcher.ts:45-148`
> - `workers/agent-core/src/hooks/permission.ts:31-70`
> - `workers/agent-core/src/kernel/types.ts:41-67`
> - `workers/agent-core/src/kernel/interrupt.ts:20-39`
> - `workers/agent-core/src/host/runtime-mainline.ts:136-140,499-503`
> - `workers/agent-core/src/host/do/session-do-runtime.ts:350-414`
> - `workers/agent-core/src/host/do/session-do-persistence.ts:288-385`
> - `workers/agent-core/src/host/do/session-do/fetch-runtime.ts:101-106`
> - `workers/orchestrator-core/src/index.ts:364-440,707-711`
> - `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320`
> - `context/claude-code/server/directConnectManager.ts:81-99`
> - `context/gemini-cli/packages/core/src/confirmation-bus/types.ts:18-79,145-155,200-212`
> - `context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:79-148,204-220`
> - `context/gemini-cli/packages/core/src/config/config.ts:1764-1778`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（待所有 hero-to-pro 设计文件落地后统一汇总；本设计先冻结 confirmation control plane 结论）
> 文档状态: `reviewed`

---

## 0. 背景与前置约束

当前 nano-agent 已经具备“异步等用户回答”的零散基础件，但这些基础件还没有组成统一 confirmation control plane：

1. `nacp-session` 已正式定义了 `session.permission.request/decision` 与 `session.elicitation.request/answer` 两组消息体（`packages/nacp-session/src/messages.ts:146-191,232-255`）。
2. Session DO 已具备 `emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()`、`awaitAsyncAnswer()`、`recordAsyncAnswer()` 这些 round-trip primitive，并且等待前会先 probe storage，回答写入后会立刻唤醒内存 awaiter（`workers/agent-core/src/host/do/session-do-runtime.ts:350-414`; `workers/agent-core/src/host/do/session-do-persistence.ts:288-385`）。
3. orchestrator-core public façade 也已经公开了 `permission/decision` 与 `elicitation/answer` 路由，并在 User DO 中把回答转存后再 forward 到 agent-core（`workers/orchestrator-core/src/index.ts:364-440,707-711`; `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320`）。
4. 但 hook dispatcher 目前只是一个可选 seam，permission helper 也仍然是把 aggregated hook outcome 解释成 allow/deny 的 fail-closed helper；kernel interrupt 只有 `approval_pending`，并没有统一 confirmation registry，也没有真正的 live caller 把这些 pieces 串起来（`workers/agent-core/src/hooks/dispatcher.ts:45-148`; `workers/agent-core/src/hooks/permission.ts:31-70`; `workers/agent-core/src/kernel/types.ts:41-67`; `workers/agent-core/src/host/runtime-mainline.ts:136-140,499-503`）。

- **项目定位回顾**：HP5 负责把当前“permission/elicitation 这两条异步回路”升级成统一的 confirmation control plane，并让 hook dispatcher 第一次成为真注入、真等待、真恢复的生产路径。
- **本次讨论的前置共识**：
  - 兼容层必须保留：现有 `permission/decision` 与 `elicitation/answer` 不能在 HP5 直接 break。
  - durable confirmation truth 当前尚未出现在代码里；HP5 不能假装 `nano_session_confirmations` 已经存在。
  - Session DO 的 `awaitAsyncAnswer()` / `recordAsyncAnswer()` 机制本身可复用，不应再发明第二套唤醒通道。
  - HP5 要统一的是 control plane，不是把所有交互都 UI 化；自动 allow/deny 仍然合法。
- **本设计必须回答的问题**：
  - confirmation 是继续按 kind 各自一套 endpoint/frame，还是统一 control plane？
  - kernel wait reason 是继续为每个 kind 新开 enum，还是抽象成统一 pending confirmation？
  - 哪些 confirmation kind 在第一版需要冻结进统一 registry？
  - 兼容旧 permission/elicitation endpoint 与新 `/confirmations` surface 的方式是什么？
- **显式排除的讨论范围**：
  - tool/workspace 状态机本身
  - file snapshot / files-only restore
  - UI 细节与最终客户端交互稿

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP5 Confirmation Control Plane`
- **一句话定义**：`把当前 permission/elicitation 等异步用户确认能力，统一成一个有 durable truth、有统一 API、有统一 stream frame、有统一 kernel wait 语义的确认控制面。`
- **边界描述**：这个功能簇**包含** confirmation registry、generic confirmation API、permission/elicitation live round-trip、hook dispatcher 真注入、compat layer；**不包含** 具体 tool/workspace feature 本身。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| confirmation | 一次等待用户/策略最终决策的异步交互对象 | 统一 durable read model |
| confirmation kind | 确认的业务类型 | 第一版冻结 7 个 kind |
| pending confirmation | kernel 当前因某个 confirmation 而暂停 | 是 wait 原因，不是 UI 概念 |
| decision | 某次 confirmation 的最终回答 | 可能是 allow/deny，也可能是结构化 answer |
| compat endpoint | 旧的 `permission/decision` 与 `elicitation/answer` | HP5 继续兼容 |
| live caller | 真正在 runtime 中触发 confirmation 的代码路径 | HP5 首先打通 hook permission 与 elicitation |

### 1.2 参考源码与现状锚点

- `packages/nacp-session/src/messages.ts:146-191,232-255` — 当前只有 permission 与 elicitation 两组异步消息体。
- `workers/agent-core/src/hooks/dispatcher.ts:45-148` — hook dispatcher 已完整存在，但目前仍是可选注入。
- `workers/agent-core/src/hooks/permission.ts:31-70` — 现有 permission helper 只会把 hook outcome 翻译成 allow/deny，并在无 handler 时 fail-closed。
- `workers/agent-core/src/kernel/types.ts:41-67` 与 `workers/agent-core/src/kernel/interrupt.ts:20-39` — 当前 kernel 只有 `approval_pending`，没有统一 confirmation pending 概念。
- `workers/agent-core/src/host/runtime-mainline.ts:136-140,499-503` — runtime 已有 `hookDispatcher?` seam，但没有强制注入与上层 live caller。
- `workers/agent-core/src/host/do/session-do-runtime.ts:350-414`, `workers/agent-core/src/host/do/session-do-persistence.ts:288-385`, `workers/agent-core/src/host/do/session-do/fetch-runtime.ts:101-106` — 当前 Session DO round-trip primitive 已可用。
- `workers/orchestrator-core/src/index.ts:364-440,707-711` 与 `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320` — public façade 已兼容 permission/elicitation answer return path。
- `context/claude-code/server/directConnectManager.ts:81-99` — Claude Code 把 `can_use_tool` 作为独立 control request subtype 交给 callback，而不是把它混在普通 assistant message 里。
- `context/gemini-cli/packages/core/src/confirmation-bus/types.ts:18-79,145-155,200-212` 与 `context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:79-148,204-220` — Gemini 已把 tool confirmation、ask user、policy update 等都统一到 correlation-id 驱动的 message bus。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP5 在整体架构里扮演 **interactive interruption owner**。
- 它服务于：
  - permission / elicitation 的实时 round-trip
  - HP3/HP4/HP6/HP7 中需要用户确认的高风险动作
  - future clients 的 pending confirmation 列表与恢复
- 它依赖：
  - Session DO 的 await/record primitive
  - hook dispatcher
  - orchestrator-core façade route forwarding
- 它被谁依赖：
  - HP3 manual compact
  - HP4 delete / restore
  - HP6 tool cancel / workspace cleanup

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| Hook system | HP5 <-> hooks | 强 | permission round-trip 是 HP5 第一条 live caller |
| Session DO async answer primitive | HP5 <- DO | 强 | confirmation 最终要靠现有 await/record 通道恢复 |
| HP3 Context State Machine | HP5 -> HP3 | 中 | manual compact 可挂到同一 confirmation plane |
| HP4 Chat Lifecycle | HP5 -> HP4 | 中 | delete/restore 等高风险动作应走统一确认 |
| clients/web | HP5 -> client | 强 | pending confirmation 列表与 decision surface 是用户可见产品面 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP5 Confirmation Control Plane` 是 **所有需要暂停 agent loop 等待决策的统一中断面**，负责 **把 permission、elicitation 以及后续 destructive actions 统一纳入同一份 durable confirmation truth、同一套 API 和同一套恢复语义**，对上游提供 **可列举、可决策、可恢复的 pending confirmation**，对下游要求 **runtime 不再用临时分叉路径处理每一种等待用户输入的场景**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 每种 kind 各做一套 endpoint/frame | 当前 permission/elicitation 现状 | 会继续放大协议碎片化 | 否 |
| 每种 kind 各开一个 kernel interrupt enum | 直觉上简单 | 会让 scheduler/restore/exhaustive switch 持续膨胀 | 否 |
| 只用内存 `deferredAnswers` 不写 durable confirmation truth | 当前 primitive 可跑通 | 重连、列表、支持排查都无从谈起 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| generic confirmation API | `/sessions/{id}/confirmations` | 支持 list/detail/decision | future 可扩 bulk / filters |
| confirmation kinds | `confirmation_kind` enum | 第一版冻结 7 kind | future 可扩更多业务类 |
| stream frames | `session.confirmation.request/update` | 统一 pending/resolved 推送 | future 可扩 rich preview payload |
| runtime wait reason | `confirmation_pending` + `kind` | 通用等待语义 | future 可扩 nested confirmation |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：confirmation control plane 与具体业务 feature
- **解耦原因**：permission、restore、compact、cleanup 的 payload 不同，但 pending/decision/recovery 的系统行为应统一。
- **依赖边界**：业务 feature 只负责构造 confirmation payload；registry、API、唤醒语义归 HP5。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：pending confirmation truth、decision 提交、stream update、runtime 恢复
- **聚合形式**：统一收敛到 `nano_session_confirmations`、`/confirmations` API、`session.confirmation.*` frames、Session DO await/record primitive
- **为什么不能分散**：如果 pending truth 在 D1、decision 只写 DO storage、客户端列表看另一个源，系统会出现“用户明明点了同意但列表还挂着 pending”之类的不一致。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent **只接受 `context/` 与当前仓库源码锚点**。

### 4.1 Claude Code 的做法

- **实现概要**：Claude Code 的 direct-connect 通道把 `can_use_tool` 识别为独立的 `control_request` subtype，一旦命中便调用 `onPermissionRequest(request, request_id)`，不会混入普通 assistant/message 流（`context/claude-code/server/directConnectManager.ts:81-99`）。
- **亮点**：
  - control request 与普通消息流明确分轨
- **值得借鉴**：
  - permission/confirmation 应该是独立控制面，不是“某种特殊 assistant 文本”
- **不打算照抄的地方**：
  - 直接复制 Claude 的 direct-connect transport

### 4.2 Gemini CLI 的做法

- **实现概要**：Gemini 已经有统一的 confirmation bus：message type 中同时定义 `TOOL_CONFIRMATION_REQUEST/RESPONSE`、`ASK_USER_REQUEST/RESPONSE`、`UPDATE_POLICY` 等，并且所有请求-响应都靠 `correlationId` 关联（`context/gemini-cli/packages/core/src/confirmation-bus/types.ts:18-79,145-155,200-212`; `context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:204-220`）。同一个 bus 在 publish 时还会先过 policy engine，ALLOW/DENY 可自动决策，ASK_USER 才真正透给 UI（`context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:79-148`）。
- **亮点**：
  - “需要问用户”与“已经可自动决策”属于同一 control plane，不是两套系统
- **值得借鉴**：
  - correlation-id 驱动的 request-response
  - policy 先行、UI 只处理 truly pending 的情况
- **不打算照抄的地方**：
  - 把确认总线完全做成进程内 EventEmitter

### 4.3 当前仓库的 precedent / 反例

- **实现概要**：当前仓库实际上已经有 permission/elicitation 的 transport primitive：Session DO 会 push 请求帧并 `awaitAsyncAnswer()`；fetch runtime 也会把 `permission-decision` / `elicitation-answer` 直接路由到 DO 写 storage；User DO 还会先持久化一份回答再 forward（`workers/agent-core/src/host/do/session-do-runtime.ts:350-414`; `workers/agent-core/src/host/do/session-do-persistence.ts:288-385`; `workers/agent-core/src/host/do/session-do/fetch-runtime.ts:101-106`; `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320`）。
- **亮点**：
  - round-trip primitive 已存在，HP5 不需要从零造 await/wakeup
- **值得借鉴**：
  - 兼容层继续保留旧 answer return path
  - storage-first 再唤醒 awaiter 的模式是对的
- **不打算照抄的地方**：
  - 继续只做 permission/elicitation 两条孤立路径，而不形成统一 registry

### 4.4 横向对比速查表

| 维度 | Claude Code | Gemini CLI | 当前 nano-agent | HP5 倾向 |
|------|-------------|------------|-----------------|----------|
| 控制请求与普通消息分轨 | 有 | 有 | 部分有 | 明确统一 |
| correlation id | request_id | correlationId | request_uuid | 统一 confirmation_uuid + request_uuid |
| policy 自动决策 | 有 | 有 | 仅局部 helper | 纳入统一 control plane |
| 用户待办列表 | 隐含 | 可通过 bus/UI 组织 | 无统一列表 | `/confirmations` |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** 统一 confirmation durable truth 与 `/confirmations` API。
- **[S2]** 保留并兼容现有 permission/elicitation endpoint，但将其收编到统一 registry。
- **[S3]** hook dispatcher 真注入 + 首条 live caller（PreToolUse permission）。
- **[S4]** kernel 统一 pending confirmation 语义，并支持 permission / elicitation 恢复。
- **[S5]** 新增统一 stream frames：`session.confirmation.request` / `session.confirmation.update`。
- **[S6]** 冻结第一版 7 个 confirmation kind。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** 直接删除 legacy permission/elicitation endpoint — 不做；重评条件：compat window 结束。
- **[O2]** 具体 tool/workspace feature payload 细节 — 留给 HP6/HP7；重评条件：对应 phase 启动。
- **[O3]** 客户端最终交互样式与视觉文案 — 不属于设计边界；重评条件：进入 client 专项。
- **[O4]** 把所有 confirmation 都做成必须人工决策 — 不做；自动 allow/deny 仍合法。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| kernel 为每个 kind 新增一个 interrupt reason | out-of-scope | 会造成 enum 爆炸，且恢复逻辑本质相同 | HP5 用统一 `confirmation_pending` 语义 |
| permission/elicitation 继续各自独立成孤岛 | out-of-scope | 与“统一 control plane”目标冲突 | HP5 收编 |
| 7 个 kind 是否要求 HP5 全部 live | out-of-scope | HP5 先打通 permission/elicitation；其他 kind 冻结 schema 与 API 入口 | HP3/HP4/HP6/HP7 后续接线 |
| compatibility 层是否继续直写 DO storage | in-scope | 这是现有 await primitive 的恢复通道 | HP5 保留，但前面先写 confirmation registry |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **统一 confirmation registry** 而不是 **permission/elicitation/restore 各自一套路由**
   - **为什么**：系统真正需要统一的是 pending/decision/recovery 语义，而不是每个业务 payload。
   - **我们接受的代价**：需要设计一个更通用的 confirmation row。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **统一 `confirmation_pending` 语义** 而不是 **继续扩张 `approval_pending` / `elicitation_pending` / ...**
   - **为什么**：kernel 关心的是“正在等待某个 confirmation”，而不是 UI 文案层面的细粒度差异。
   - **我们接受的代价**：实现时要做一次从现有 `approval_pending` 到统一 pending 语义的迁移。
   - **未来重评条件**：无；统一等待语义是更稳的骨架。

3. **取舍 3**：我们选择 **兼容层保留旧 endpoint/frame** 而不是 **一次性 break 到新协议**
   - **为什么**：当前 public API 与客户端都已经知道 `permission/decision` / `elicitation/answer`。
   - **我们接受的代价**：会有一段双轨兼容窗口。
   - **未来重评条件**：clients 全量切到 `/confirmations` 之后。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| confirmation registry 与 DO storage 双写不一致 | 先写一侧后一侧失败 | pending 列表与 runtime 恢复分裂 | 以 confirmation row 为准，DO storage 写失败则 row 标 failed 并显式告警 |
| 旧客户端 break | 直接移除 legacy route/frame | permission/elicitation 无法继续用 | 保留 compat endpoint/frame |
| hook dispatcher 真接线后暴露超时/递归问题 | 真实多轮交互开始运行 | tool call 被卡死或栈深炸裂 | 继续复用 dispatcher 的 timeout / depth guard，并把 confirmation 超时纳入统一 error law |
| kind enum 未来继续膨胀 | 每个新 feature 都发明新 confirmation type | registry 失控 | 第一版就冻结 7 kind，并要求后续扩张走 QNA |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：以后所有“为什么 agent 停住了在等用户”都能在统一列表里看见，而不是追多条私有路径。
- **对 nano-agent 的长期演进**：HP5 是 interactive agent loop 的必要骨架；没有它，HP3/HP4/HP6/HP7 都会各自发明等待用户的方式。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：统一 confirmation 之后，tool-heavy loop、restore、cleanup 等高风险动作才有可靠的人机边界。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | confirmation registry | 统一 pending/resolved confirmation durable truth | ✅ 系统第一次有统一的 pending confirmation 列表 |
| F2 | runtime live round-trip | hook permission 与 elicitation 真正暂停并恢复 | ✅ Session DO 的 await primitive 第一次有真实业务调用方 |
| F3 | generic confirmation API | `/confirmations` list/detail/decision + compat layer | ✅ 客户端不再只能使用碎片化旧 endpoint |
| F4 | unified stream frames | `session.confirmation.request/update` | ✅ 所有确认类事件进入同一推送协议族 |
| F5 | 7-kind freeze | 冻结第一版 confirmation kind enum | ✅ 后续 phase 不再各自发明 kind |

### 7.2 详细阐述

#### F1: confirmation registry

- **输入**：session uuid、kind、payload、timeout/expires_at
- **输出**：一条 durable confirmation row
- **主要调用者**：hook permission、elicitation、future compact/restore/delete/cleanup flows
- **核心逻辑**：统一 row 至少包含 `confirmation_uuid`, `request_uuid`, `session_uuid`, `conversation_uuid`, `kind`, `status`, `payload_json`, `decision_json`, `expires_at`, `resolved_at`, `created_at`
- **边界情况**：
  - 同一个 request_uuid 不能重复创建两个 active confirmation
  - timeout 后必须转 terminal status，而不是永远 pending
- **一句话收口目标**：✅ **pending confirmation 第一次拥有统一 durable truth**。

#### F2: runtime live round-trip

- **输入**：hook/event 触发的 confirmation request
- **输出**：runtime 等待 -> 收到 decision -> 恢复执行
- **主要调用者**：PreToolUse permission、elicitation
- **核心逻辑**：业务层先建 confirmation row，再复用 `emitPermissionRequestAndAwait()` / `emitElicitationRequestAndAwait()` 与 `awaitAsyncAnswer()`；恢复后把最终 decision 回填 registry
- **边界情况**：
  - 超时必须形成明确 deny/cancel/timeout terminal result
  - worker 重启后仍可通过 storage probe 恢复 decision
- **一句话收口目标**：✅ **ask-user 不再是设计图纸，而是真正运行中的 agent loop 中断点**。

#### F3: generic confirmation API

- **输入**：`GET /sessions/{id}/confirmations`, `GET /sessions/{id}/confirmations/{uuid}`, `POST /sessions/{id}/confirmations/{uuid}/decision`
- **输出**：confirmation list/detail/decision result
- **主要调用者**：client、support/debug、compat layer
- **核心逻辑**：new API 操作 confirmation row；legacy `permission/decision` / `elicitation/answer` 作为 compatibility alias，内部最终走同一 decision handler
- **边界情况**：
  - decision 对已 resolved confirmation 返回 conflict，而不是静默覆盖
  - legacy path 也必须写统一 registry
- **一句话收口目标**：✅ **confirmation 对外终于有统一 API，而不是两条专用回路**。

#### F4: unified stream frames

- **输入**：confirmation 创建、状态变化、decision 落地
- **输出**：`session.confirmation.request` / `session.confirmation.update`
- **主要调用者**：attached client、replay/stream consumers
- **核心逻辑**：request 帧包含 `confirmation_uuid`, `kind`, `payload`, `expires_at`；update 帧包含 `status`, `decision summary`, `resolved_at`
- **边界情况**：
  - 兼容期 legacy permission/elicitation frame 仍可双发
  - replay/reconnect 必须能拿到未决 confirmation 最新状态
- **一句话收口目标**：✅ **stream 协议第一次有统一 confirmation 族，不再把交互等待藏在业务专用帧里**。

#### F5: 7-kind freeze

- **输入**：各业务 phase 的 confirmation 需求
- **输出**：第一版 kind enum
- **主要调用者**：HP3/HP4/HP6/HP7 action-plan
- **核心逻辑**：第一版统一冻结 7 个 kind：
  1. `permission`
  2. `elicitation`
  3. `compact_execute`
  4. `checkpoint_restore`
  5. `conversation_delete`
  6. `workspace_cleanup`
  7. `tool_cancel`
- **边界情况**：
  - HP5 真正打通的 live kind 仅 `permission` 与 `elicitation`
  - 新 kind 扩张必须进 HPX-qna，而不是实现时临时添加
- **一句话收口目标**：✅ **未来各 phase 需要确认时先接统一 kind，而不是各起炉灶**。

### 7.3 非功能性要求与验证策略

- **性能目标**：confirmation decision 不增加多余 hop；继续复用现有 DO await/record primitive。
- **可观测性要求**：每个 confirmation 都应有 row、stream update、decision 结果与 timeout/error 记录。
- **稳定性要求**：pending confirmation 在 reconnect / worker restart 后仍可恢复到同一条 truth。
- **安全 / 权限要求**：decision 提交必须继续走 team-scoped auth；不同用户不能替他人 session 作答。
- **测试覆盖要求**：permission allow/deny/timeout、elicitation answer/cancel、legacy compat path、新 `/confirmations` path 至少各 1 条 cross-e2e。
- **charter 冻结的 cross-e2e 文件名**：
  - `test/cross-e2e/15-permission-roundtrip-allow.test.mjs`
  - `test/cross-e2e/16-permission-roundtrip-deny.test.mjs`
  - `test/cross-e2e/17-elicitation-roundtrip.test.mjs`
  - `test/cross-e2e/18-usage-push-live.test.mjs`
- **验证策略**：以“pending list、stream update、runtime 恢复行为”三者一致为准。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent 源码 | HP5 主要参考当前仓库与 Claude/Gemini 的 control request 结构 | 不再通过二手 markdown 转述 |

### 8.2 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/server/directConnectManager.ts:81-99` | `can_use_tool` 走独立 `control_request` subtype，并用 request id 交给 callback | confirmation/permission 应独立于普通 assistant message 流 | 适合借鉴“控制请求分轨”思想 |

### 8.3 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/confirmation-bus/types.ts:18-79` | 统一定义 request/response/policy rejection | 说明 confirmation 应有统一消息族，而不是 endpoint-per-kind | HP5 借鉴统一 control plane |
| `context/gemini-cli/packages/core/src/confirmation-bus/types.ts:145-155,200-212` | policy update 与 ask-user 也进入同一 bus | 说明“自动决策”和“问用户”属于同一系统 | 与 HP5 一致 |
| `context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:79-148` | 先过 policy engine，再决定 auto-allow/deny 还是 ask user | 说明 policy 与 confirmation 不应拆成两套路径 | HP5 可直接借鉴执行顺序 |
| `context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:204-220` | request-response 统一走 correlationId | 说明 pending confirmation 必须有稳定关联 ID | HP5 对应 `confirmation_uuid/request_uuid` |
| `context/gemini-cli/packages/core/src/config/config.ts:1764-1778` | sandbox manager 刷新时读取 approval mode | 说明 approval/confirmation 最终是 runtime posture 的组成部分 | 可为 future policy integration 留口 |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `packages/nacp-session/src/messages.ts:146-191,232-255` | 当前已经有 permission/elicitation 两组异步消息体 | HP5 在此基础上统一 control plane，而不是推翻现有 transport primitive |
| `workers/agent-core/src/hooks/dispatcher.ts:45-148` | dispatcher 已有 timeout/depth/aggregate 机制 | HP5 应直接复用，不能另造第三套 hook runtime |
| `workers/agent-core/src/hooks/permission.ts:31-70` | 现 helper 只解释 allow/deny 且零 handler fail-closed | 说明当前只覆盖同步 verdict，不足以承载 ask-user control plane |
| `workers/agent-core/src/kernel/types.ts:41-67` | 当前只有 `approval_pending` | 是 HP5 要升级为统一 pending confirmation 的直接断点 |
| `workers/agent-core/src/host/do/session-do-runtime.ts:376-414` | 已有 emit-and-await primitive | 这是 HP5 真接线的现成底座 |
| `workers/agent-core/src/host/do/session-do-persistence.ts:333-385` | 先 probe storage，再注册 awaiter，回答写入后立即 resolve | 这是可靠恢复语义的正确方向，应保留 |
| `workers/agent-core/src/host/do/session-do/fetch-runtime.ts:101-106` | permission/elicitation answer 已直达 DO | compat layer 不应破坏当前恢复通道 |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts:221-320` | User DO 已会持久化 permission/elicitation 回答再 forward | 说明 orchestrator 层已有可复用 answer ingress |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP5-D1` | confirmation 是否继续按业务各自一套路由，还是统一 control plane？ | HP5 / HP3 / HP4 / HP6 / HP7 | 统一 control plane | `frozen` | Gemini precedent 已证明 request/response/policy 可统一，而当前仓库也已有可复用 await primitive：`context/gemini-cli/packages/core/src/confirmation-bus/types.ts:18-79,145-155,200-212`, `context/gemini-cli/packages/core/src/confirmation-bus/message-bus.ts:79-148,204-220`, `workers/agent-core/src/host/do/session-do-runtime.ts:376-414` |
| `HP5-D2` | kernel wait reason 是否继续扩张为多个 pending enum？ | HP5 / scheduler / restore | 否；统一为 `confirmation_pending` 语义，kind 放在 pending confirmation 记录里 | `frozen` | 当前 `approval_pending` 已显露 enum 扩张风险：`workers/agent-core/src/kernel/types.ts:41-67`, `workers/agent-core/src/kernel/interrupt.ts:20-39` |
| `HP5-D3` | 第一版 confirmation kind 是否要先冻结？ | HP5+ | 是；冻结 7 kind | `frozen` | 若不先冻结，后续 phase 会继续各自发明 kind，当前仓库又尚无统一 registry，需要在 HP5 先把骨架立住 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. confirmation row、API、stream frame、runtime 恢复语义已经写清。
2. legacy permission/elicitation 与新 `/confirmations` 的兼容关系已经写清。
3. 7-kind enum 与统一 pending confirmation 语义已经冻结。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP5-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP3-context-state-machine.md`
  - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
- **需要进入 QNA register 的问题**：
  - 若 owner 不接受统一 `confirmation_pending` 命名，则是否保留外部兼容 alias 而内部统一语义

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

HP5 会以 **统一 confirmation registry + generic `/confirmations` API + unified stream frames + Session DO await primitive + hook dispatcher live caller** 的形式存在，覆盖 agent loop 中所有“需要暂停并等待决策”的系统行为。它不是单独服务于 permission 或 elicitation，而是未来所有高风险动作的人机边界骨架。它的复杂度主要在兼容层与双写一致性，而不是 decision payload 本身。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | `5` | 统一确认面是成熟 agent loop 的核心能力 |
| 第一版实现的性价比 | `4` | 改动面较广，但复用现有 primitive，收益很大 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | `5` | HP3/HP4/HP6/HP7 都会直接复用这层 |
| 对开发者自己的日用友好度 | `4` | 以后所有 pending decision 都能在一个地方看见 |
| 风险可控程度 | `3` | 兼容层与双写一致性需要谨慎处理 |
| **综合价值** | `5` | HP5 能结束“每种等待用户输入都自己造轮子”的局面 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否沿用 `approval_pending` 并追加 `elicitation_pending`
  - **A 方观点**：与现有代码更贴近
  - **B 方观点**：会导致后续每种 confirmation 都扩一个 enum
  - **最终共识**：内部统一到 `confirmation_pending` 语义；若需要对外兼容，可做 alias

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-30` | `GPT-5.4` | 初稿 |
