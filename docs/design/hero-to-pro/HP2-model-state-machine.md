# Nano-Agent 功能簇设计

> 功能簇: `HP2 Model State Machine`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `packages/nacp-session/src/messages.ts:43-52,119-136`
> - `workers/orchestrator-core/src/session-lifecycle.ts:41-57`
> - `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454`
> - `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161`
> - `workers/orchestrator-core/src/index.ts:1347-1419`
> - `workers/agent-core/src/llm/canonical.ts:67-78`
> - `workers/agent-core/src/llm/request-builder.ts:57-121`
> - `workers/agent-core/src/llm/gateway.ts:165-231`
> - `context/codex/codex-rs/app-server/src/codex_message_processor.rs:7018-7028`
> - `context/codex/codex-rs/protocol/src/models.rs:471-474`
> - `context/codex/codex-rs/core/src/codex.rs:3954-3961`
> - `context/claude-code/utils/model/model.ts:49-98`
> - `context/claude-code/commands/model/model.tsx:250-258`
> - `context/claude-code/query.ts:572-578,659-670,894-897`
> - `context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-45`
> - `context/gemini-cli/packages/core/src/config/config.ts:1872-1898`
> - `context/gemini-cli/packages/core/src/services/modelConfigService.ts:16-40,56-80,116-125,149-215,268-328,341-389`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（待所有 hero-to-pro 设计文件落地后统一汇总；本设计先冻结 model state machine 结论）
> 文档状态: `reviewed`

---

## 0. 背景与前置约束

当前 nano-agent 并不是完全没有模型能力：`GET /models` 已 live，`/messages` 已可带 `model_id` / `reasoning`，`agent-core` 也已有 `ModelCapabilities`、Workers AI gateway、reasoning/vision capability check。但这些能力仍然停留在 **turn 级零散透传**，还没有形成用户可理解、可切换、可审计、可 fallback 的产品级 model state machine。

- **项目定位回顾**：HP2 是 `model control plane first wave`。
- **本次讨论的前置共识**：
  - HP1 已先提供 session/turn model audit、richer model metadata 与 alias 表。
  - HP0 已把 `/start` / `/input` / `/messages` 三入口模型字段 law 对齐。
  - 当前 public `/models` 是 team-filtered list，不是 session-level model setting API。
  - 当前 canonical request、request builder、Workers AI adapter 已支持 reasoning/vision capability 校验与翻译，但 durable product semantics 尚未闭环。
- **本设计必须回答的问题**：
  - model state machine 的四层状态应该是什么，分别落在哪一层 durable truth？
  - session-level default model 与 turn-level override 的边界是什么？
  - alias、fallback、`<model_switch>` developer message 三者如何配合，避免“只是换了个字符串”？
  - 模型切换和未来 HP3 compact / window governance 的耦合点是什么？
- **显式排除的讨论范围**：
  - multi-provider routing
  - per-model billing / pricing / admin plane
  - full context compaction 流程（留 HP3）
  - checkpoint / restore / fork（留 HP4 / HP7）

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP2 Model State Machine`
- **一句话定义**：`把当前“message 里能塞 model_id”的零散能力提升为 session 可理解、turn 可覆盖、runtime 可审计、fallback 可追踪的模型控制面。`
- **边界描述**：这个功能簇**包含** session default model、turn override、effective model audit、alias 解析、`/sessions/{id}/model`、`/models/{id}`、fallback audit、`<model_switch>` 语义；**不包含** multi-provider、pricing/quota policy、full compact / checkpoint。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| global default | 当前部署默认模型 | 初版仍由运行时默认值提供 |
| session default | 某 session 当前持久化的默认模型与默认 reasoning effort | 存在于 `nano_conversation_sessions.default_*` |
| turn override | 某次 follow-up 或 start 对本 turn 指定的模型/effort | 由 request body 提供 |
| effective model | runtime 真正执行的模型 | 可能等于 requested，也可能因 fallback 变化 |
| alias | 面向客户端的逻辑别名，如 `@alias/reasoning` | 在 D1 `nano_model_aliases` 中表达 |
| `<model_switch>` | 在跨模型切换时插入的 developer message | 用于明确告知 LLM “你与上一 turn 模型不同” |

### 1.2 参考源码与现状锚点

- `packages/nacp-session/src/messages.ts:43-52,119-136` — 协议层已经支持 `model_id` / `reasoning`
- `workers/orchestrator-core/src/session-lifecycle.ts:41-57` 与 `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454` — public `/start` / `/input` 尚未形成完整模型控制面
- `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161` — `/messages` 已经具备 `model_id` / `reasoning` gate
- `workers/orchestrator-core/src/index.ts:1347-1419` — 当前 `/models` 仍只有 list，没有 detail/current-model API
- `workers/agent-core/src/llm/canonical.ts:67-78`, `workers/agent-core/src/llm/request-builder.ts:57-121`, `workers/agent-core/src/llm/gateway.ts:165-231` — runtime 已具备 canonical model/reasoning/capability seams，但仍偏 infer-only
- `context/codex/codex-rs/app-server/src/codex_message_processor.rs:7018-7028`, `context/codex/codex-rs/protocol/src/models.rs:471-474`, `context/codex/codex-rs/core/src/codex.rs:3954-3961` — Codex 的 turn override + `<model_switch>` precedent
- `context/claude-code/utils/model/model.ts:49-98`, `context/claude-code/commands/model/model.tsx:250-258`, `context/claude-code/query.ts:572-578,659-670,894-897` — Claude Code 的 session-level model + fallback precedent
- `context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-45`, `context/gemini-cli/packages/core/src/config/config.ts:1872-1898`, `context/gemini-cli/packages/core/src/services/modelConfigService.ts:16-40,56-80,116-125,149-215,268-328,341-389` — Gemini 的 current model / active model / alias-resolution precedent

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP2 在整体架构里扮演 **模型控制面 / session setting owner** 的角色。
- 它服务于：
  - web / wechat / future CLI 的 model picker
  - context compaction 的 model-aware budget
  - runtime fallback / capability law
  - usage / audit / closure 的模型可追溯性
- 它依赖：
  - HP1 的 model metadata、alias 表、session/turn audit 列
  - 当前 `/models` list 与 `requireAllowedModel()` gate
  - 当前 canonical request / Workers AI gateway
- 它被谁依赖：
  - HP3 context state machine
  - HP9 `models.md` / `session.md`
  - manual evidence 中的模型切换场景

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP1 Schema Extension | HP1 -> HP2 | 强 | HP2 所有 durable model state 都依赖 HP1 列 |
| HP3 Context State Machine | HP2 <-> HP3 | 强 | 模型切换会改变 compact 阈值与 `<model_switch>` 剥离逻辑 |
| `/models` facade | HP2 <-> list/detail | 中 | `GET /models` 是 catalog，`GET /models/{id}` 与 session current model 是 control plane |
| request-builder / gateway | HP2 -> runtime | 强 | alias / reasoning / fallback 最终要落到 canonical request 与 audit |
| usage ledger | HP2 -> usage | 中 | future 能按 effective model 回溯 usage evidence |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP2 Model State Machine` 是 **把模型从 catalog 提升为产品控制面的 phase**，负责 **定义 session default、turn override、effective+fallback audit 与 model switch 语义**，对上游提供 **可选择、可解释、可追溯的模型控制**，对下游要求 **compact、usage、checkpoint 都能感知真实模型状态**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| turn-only 隐式模型切换 | 当前最快可跑路径 | 用户无法理解“为什么下一 turn 变了模型” | 否 |
| fallback chain 多层级 | 想一次支持复杂路由 | scope 膨胀，且当前 runtime 只适合单层 fallback | hero-to-platform |
| alias 仅靠客户端常识 | 最省实现路径 | 无 durable truth、无 team policy、无 detail endpoint | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| session current model API | `GET/PATCH /sessions/{id}/model` | 支持 default model / default reasoning effort | future 可扩 persist scope / preview / confirm |
| model detail API | `GET /models/{id}` | 暴露 HP1 metadata | future 可扩 availability / pricing / release channel |
| alias | D1 `nano_model_aliases` | `@alias/fast|balanced|reasoning|vision` | future 可扩 team-defined alias |
| fallback audit | turn table + stream event | 记录 single-step fallback | future 可扩 chain / policy reason |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：模型选择与配额 / 计费策略
- **解耦原因**：HP2 的目标是控制面与可追溯性，不是 billing governance
- **依赖边界**：HP2 只记录 requested/effective/fallback 事实，不在本 phase 做 per-model quota 决策

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：session default、turn override、effective model、fallback reason
- **聚合形式**：统一收敛到 session/turn 表、`/sessions/{id}/model` 端点、`<model_switch>` developer message 和 `model.fallback` stream event
- **为什么不能分散**：如果有一部分在 message body、一部分只在 runtime log、一部分只在 client state，模型控制面就不再可审计

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent **只接受 `context/` 与当前仓库源码锚点**，不再把调查 markdown 当作二手证据引用。

### 4.1 Codex 的做法

- **实现概要**：Codex 会先把 turn 级覆盖写入 `OverrideTurnContext`，其中直接带 `model` 与 `effort`（`context/codex/codex-rs/app-server/src/codex_message_processor.rs:7012-7032`）；随后用 `model_switch_message()` 生成 `<model_switch>` developer message（`context/codex/codex-rs/protocol/src/models.rs:471-474`），并在 full-context reinject 且发生模型切换时显式前置该消息（`context/codex/codex-rs/core/src/codex.rs:3954-3961`）；测试也会断言第二次请求的 developer input 必含 `<model_switch>`（`context/codex/codex-rs/core/tests/suite/model_switching.rs:183-190`）。同时，Codex 的 `ModelInfo` 也把 `context_window`、`auto_compact_token_limit`、`effective_context_window_percent` 等 compact 相关字段一起建模（`context/codex/codex-rs/protocol/src/openai_models.rs:248-299`）。
- **亮点**：
  - model switch 是明确语义，不是 silent string swap
- **值得借鉴**：
  - `<model_switch>` 作为 developer message
  - richer metadata 驱动 context / reasoning law
- **不打算照抄的地方**：
  - 一次把所有 ModelInfo 字段全落进 D1

### 4.2 Claude Code 的做法

- **实现概要**：Claude Code 明确提供 `/model` 命令与当前模型展示（`context/claude-code/commands/model/index.ts:1-16`）；其模型解析优先级把“会话内 `/model` 覆盖”放在启动 flag、环境变量和 settings 之前（`context/claude-code/utils/model/model.ts:49-98`）；命令 UI 会写入 `mainLoopModel`、清空 `mainLoopModelForSession`，并在读取当前模型时显式显示 “session override from plan mode”（`context/claude-code/commands/model/model.tsx:47-57,198-202,250-258`）。运行时则维护 `currentModel`，把它传给 `callModel()`，若触发 `FallbackTriggeredError` 则切换到 `fallbackModel` 重试；若流式 fallback 已发生，会 tombstone orphaned messages，尤其是 thinking blocks，避免 transcript 污染（`context/claude-code/query.ts:572-578,659-680,712-718,894-897`）。
- **亮点**：
  - 模型设置是 session-level 产品面
- **值得借鉴**：
  - 模型选择不能只存在于某条 message body 里
  - fallback 后要留下清晰语义与 audit
- **不打算照抄的地方**：
  - 直接复制 Anthropic 的 app-state / fast-mode / provider-specific 细节

### 4.3 Gemini CLI 的做法

- **实现概要**：Gemini 直接提供 `/model set <model-name> [--persist]`（`context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-45`; `context/gemini-cli/docs/reference/commands.md:283-292`），其 `Config.setModel(newModel, isTemporary)` 会同时更新 `model` 与 `_activeModel`，只有在非 temporary 时才触发持久化回调；fallback 也通过 `activateFallbackMode()` 把 active model 切到 fallback（`context/gemini-cli/packages/core/src/config/config.ts:1872-1898`）。除此之外，Gemini 还有 ACP `setModel()` 入口（`context/gemini-cli/packages/cli/src/acp/acpClient.ts:620-622`），以及支持 alias / override / modelDefinitions / resolveModelId 的 `ModelConfigService`（`context/gemini-cli/packages/core/src/services/modelConfigService.ts:16-40,56-80,116-125,149-215,268-328,341-389`）。
- **亮点**：
  - transient / persistent model setting 有清楚边界
- **值得借鉴**：
  - 先把 session-level current model API 做出来，再谈更复杂的 model management
- **不打算照抄的地方**：
  - 在 HP2 就做完整 manage UI / persist scopes

### 4.4 横向对比速查表

| 维度 | Codex | Claude Code | Gemini CLI | nano-agent 倾向 |
|------|-------|-------------|------------|------------------|
| model metadata | 很厚 | runtime capability + settings chain | config service + aliases | HP1/HP2 先落运行所需字段 |
| model switch 语义 | `<model_switch>` + compact 配套 | runtime switch + cleanup | `/model set` | session API + `<model_switch>` |
| fallback | 有 model-aware context reconstruction | 有 currentModel 切换 | 有 active model management | 先做 single-step fallback audit |
| persistence | 操作日志可重建 | runtime/session settings | config persisted | D1 session/turn audit |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** 四层模型状态机：global default → session default → turn override → effective + fallback。
- **[S2]** `GET /sessions/{id}/model` / `PATCH /sessions/{id}/model` — 让 session-level 当前模型成为产品面。
- **[S3]** `GET /models/{id}` 与 alias 解析层 — 让 `/models` 不再只是粗列表。
- **[S4]** requested/effective/fallback 的 D1 audit — 让 model switch/fallback 可回溯。
- **[S5]** `<model_switch>` developer message — 让跨模型切换成为显式 LLM 语义。
- **[S6]** single-step fallback + `model.fallback` stream event — 让 fallback 成为用户可见事实，而不是 silent replacement。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** multi-provider routing — 属于 hero-to-platform；重评条件：阶段边界改变
- **[O2]** per-model pricing / quota / admin management — 属于 hero-to-platform；重评条件：owner 推翻当前边界
- **[O3]** model switch confirmation UI / compact confirmation UI — 统一确认面属于 HP5；重评条件：HP5 启动
- **[O4]** cross-model compact / previous model cleanup 的完整 runtime 策略 — 属于 HP3；重评条件：HP3 design

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `/messages` 带 `model_id` 就算完成模型切换 | out-of-scope | 只是 turn payload，不是 state machine | HP2 必须补 session current model 与 audit |
| alias 只在客户端映射 | out-of-scope | 不可被 policy gate / detail API / audit 复用 | HP2 + HP1 |
| fallback 后不写 stream event | out-of-scope | 会形成 silent behavior shift | HP2 |
| compact 前不插入 `<model_switch>` | defer | 与 HP3 耦合，但 HP2 先冻结 developer message 语义 | HP2 + HP3 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **session default + turn override 双层模型设置** 而不是 **只保留 turn 级 `model_id`**
   - **为什么**：用户需要知道“当前会话默认模型是什么”，否则模型选择无法成为产品控制面。
   - **我们接受的代价**：需要新增 `/sessions/{id}/model` 与 session durable columns。
   - **未来重评条件**：无；这是 HP2 的核心边界。

2. **取舍 2**：我们选择 **single-step fallback + explicit audit** 而不是 **多层 fallback chain**
   - **为什么**：当前 runtime 与 product面都还不适合复杂链式路由。
   - **我们接受的代价**：fallback 弹性不如未来多 provider 方案。
   - **未来重评条件**：hero-to-platform 进入 richer routing policy。

3. **取舍 3**：我们选择 **把 `<model_switch>` 作为 developer message 语义冻结** 而不是 **等 HP3 compact 再讨论**
   - **为什么**：模型切换与 compact 耦合，但 developer message 本身属于 HP2 控制面定义。
   - **我们接受的代价**：HP3 需要按照 HP2 已冻结语义实现 strip/recover。
   - **未来重评条件**：若 HP3 证明另一路径更稳，再通过 QNA 重评。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| session default 与 turn override 语义混淆 | API / durable columns 说不清 | client 难以理解 current model | 设计里明确四层模型状态 |
| fallback 与 policy gate 脱节 | alias/policy 只校验 requested，不处理 fallback | 可能触发不可解释行为 | fallback model 也必须来自 D1 metadata，且写 audit/event |
| HP2 与 HP3 边界不清 | 把 compact 逻辑塞进 model phase | phase scope 漂移 | HP2 只冻结 switch 语义，window/compact 交给 HP3 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续调试时能分清 requested / effective / fallback，不再只看 message body 猜。
- **对 nano-agent 的长期演进**：model state machine 是未来 provider routing、pricing、policy 的天然前提层。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：模型状态清晰后，compact、reasoning、vision、checkpoint 才能感知真实 runtime 语境。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | session-level current model API | 新增 `/sessions/{id}/model` 读写面 | ✅ 用户可读写当前 session 默认模型 |
| F2 | turn-level override 与 durable audit | requested/effective/fallback 写入 D1 | ✅ 每个 turn 的实际模型可回溯 |
| F3 | alias 与 model detail | `GET /models/{id}` 与 alias 解析 | ✅ 模型目录从 list 升级为 control plane |
| F4 | `<model_switch>` 语义 | 跨模型切换时插入 developer message | ✅ LLM 被显式告知当前模型已变更 |
| F5 | fallback event 与 error law | single-step fallback + `model.fallback` stream event | ✅ fallback 成为显式产品事实 |

### 7.2 详细阐述

#### F1: session-level current model API

- **输入**：session uuid、PATCH body `{ model_id, reasoning? }`
- **输出**：session 当前默认模型 / 默认 reasoning effort
- **主要调用者**：web / wechat / future CLI model picker
- **核心逻辑**：GET 读取 session durable default；PATCH 做 alias resolve、team policy gate 与 session state update
- **边界情况**：
  - ended/expired session 不允许再改当前模型
  - PATCH 失败时不得污染 session durable truth
- **一句话收口目标**：✅ **客户端第一次有独立于 message body 的 session 当前模型控制面**。

#### F2: turn-level override 与 durable audit

- **输入**：start/messages/followup 里的 `model_id` / `reasoning`
- **输出**：turn 的 requested / effective / fallback_used durable truth
- **主要调用者**：runtime、history/audit、future checkpoint
- **核心逻辑**：requested 写 turn start；effective/fallback 在 turn end 回填；若未指定 turn override，则从 session default 继承
- **边界情况**：
  - session default 未设时回退 global default
  - fallback 后 `effective_model_id != requested_model_id`
- **一句话收口目标**：✅ **每个 turn 的模型事实不再只存在于临时消息中**。

#### F3: alias 与 model detail

- **输入**：`/models/{id}`、`@alias/*`
- **输出**：detail shape 与 resolved model id
- **主要调用者**：client picker、policy gate、runtime
- **核心逻辑**：alias 在 D1 lookup 前先 resolve，detail 暴露 HP1 metadata；`/models` list 中也返回 alias 集
- **边界情况**：
  - alias 指向 disabled model 时必须显式报错
  - alias 不得绕过 team deny policy
- **一句话收口目标**：✅ **模型目录不再是粗列表，而是支持 detail + alias 的产品面**。

#### F4: `<model_switch>` 语义

- **输入**：session default 变化或 turn override 与前一有效模型不同
- **输出**：一条 developer message，解释当前模型与上一 turn 不同
- **主要调用者**：LLM request assembly
- **核心逻辑**：在 active turn messages 进入 canonical request 前检测 effective model 变化并注入 developer message
- **边界情况**：
  - 首 turn 不注入
  - 若只是 reasoning effort 变化而 model id 不变，可不注入 model switch，但应保留 effort audit
- **一句话收口目标**：✅ **跨模型切换不再只是 silent swap，而成为 LLM 可见语义**。

#### F5: fallback event 与 error law

- **输入**：provider/runtime 报错、fallback model metadata
- **输出**：`model.fallback` stream event + D1 fallback audit
- **主要调用者**：client、history、debug、manual evidence
- **核心逻辑**：只允许单层 fallback；触发时记录 requested/effective 差异与 reason；若 fallback 也失败，则 surface error
- **边界情况**：
  - fallback model 也必须通过 capability law
  - 不能把 capability missing 伪装成 fallback success
- **一句话收口目标**：✅ **fallback 是可见、可审计、可解释的行为，而不是 silent replacement**。

### 7.3 非功能性要求与验证策略

- **性能目标**：model switch / alias resolve 不引入显著额外 D1 round-trip；优先复用现有 catalog loading
- **可观测性要求**：requested/effective/fallback 三态在 D1、stream event 与 debug 面上可对齐
- **稳定性要求**：不破坏当前 `/messages` 已支持的 reasoning/vision law
- **安全 / 权限要求**：所有 session model 变更都必须经过 team policy / allow-model gate
- **测试覆盖要求**：reasoning↔non-reasoning、vision↔non-vision、131K↔24K、alias resolve、fallback 5+ e2e
- **验证策略**：以 API + D1 audit + stream event 三层对撞为准；不能只看 endpoint 返回 200 就宣称闭合

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次没有直接采用 mini-agent 源码作为 precedent | HP2 以当前仓库与 `context/` 三个 agent 的源码为主 | 不再通过二手 study 转述 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/app-server/src/codex_message_processor.rs:7018-7028` | `OverrideTurnContext` 直接带 `model` 与 `effort` | 说明模型/effort 是 turn 级显式控制输入 | HP2 借鉴状态机入口，不照抄整个 app-server 协议 |
| `context/codex/codex-rs/protocol/src/models.rs:471-474` | `model_switch_message()` 生成 `<model_switch>` developer message | 冻结 `<model_switch>` 语义的直接 precedent | HP3 再处理 compact strip/recover |
| `context/codex/codex-rs/core/src/codex.rs:3954-3961` | full-context reinject 且模型切换时显式前置 `<model_switch>` | 说明 model switch 与 context rebuild 是耦合但可分层的 | HP2 先冻结语义，HP3 再接 compact |
| `context/codex/codex-rs/core/tests/suite/model_switching.rs:183-190` | 测试断言第二次请求必含 `<model_switch>` | 说明这是 contract，不是实现偶然 | 值得在 nano-agent e2e 中复刻 |

### 8.3 来自 claude-code / gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/model/model.ts:49-98` | 模型解析优先级显式包含 session `/model` override | 说明模型选择是 session-level 产品面，不只是 message 参数 | HP2 借鉴 session default/control plane |
| `context/claude-code/commands/model/model.tsx:250-258` | 当前模型展示会区分 base model 与 session override | 说明“当前模型”需要独立可读 API，而不是让用户自己从 turn payload 猜 | 具体 UI 不照抄 |
| `context/claude-code/query.ts:572-578,659-670,894-897` | runtime 维护 `currentModel` 并在 fallback 时切换后重试 | 说明 fallback 会改变 effective model，应被明确审计 | nano-agent 先做 single-step fallback |
| `context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-45` | `/model set <model-name> [--persist]` | 说明 current model 是显式命令面 | HP2 先做 session default，不扩 persist scope |
| `context/gemini-cli/packages/core/src/config/config.ts:1872-1898` | `setModel()` / `activateFallbackMode()` 同时维护 model 与 activeModel | 说明 requested model 与 active/effective model 必须分层表达 | HP2 对应 requested/effective/fallback audit |
| `context/gemini-cli/packages/core/src/services/modelConfigService.ts:16-40,56-80,116-125,149-215,268-328,341-389` | alias / override / definitions / resolution / resolution context | 说明 model catalog 不能只有 list，还需要 alias 与 resolution 层 | HP2 借鉴 alias/detail/control-plane 结构 |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `packages/nacp-session/src/messages.ts:43-52,119-136` | NACP schema 已支持 `model_id` / `reasoning` / `image_url` | HP2 在此基础上补 session-level control plane，而不是另发明新 payload |
| `workers/orchestrator-core/src/session-lifecycle.ts:41-57` | public `/start` / `/input` body 仍未声明模型字段 | 说明当前公共入口还没形成统一模型控制面 |
| `workers/orchestrator-core/src/user-do/session-flow.ts:342-347,445-454` | `/start` / `/input` 当前仍会丢模型字段 | 这是 HP2 之前必须先被 HP0 收掉的断点 |
| `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161,243-245,296-310` | `/messages` 已有 model gate 与 forward 路径 | 作为 public ingress precedent |
| `workers/orchestrator-core/src/index.ts:1347-1419` | 当前 `/models` 只有 list，没有 detail/current model | 说明 HP2 必须补 `/models/{id}` 与 `/sessions/{id}/model` |
| `workers/agent-core/src/llm/canonical.ts:67-78` | canonical request 已有 `model` / `reasoning` 字段 | HP2 可直接在 canonical seam 之上扩 session product semantics |
| `workers/agent-core/src/llm/request-builder.ts:57-121` | 已有 reasoning / vision capability law | HP2 不重写底层 law，只把 product state 接到这条链上 |
| `workers/agent-core/src/llm/gateway.ts:165-231` | 当前仍以 message infer model 为主 | 这是 HP2 要升级的重点：从 infer-only 走向 state machine |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP2-D1` | 模型控制面是否必须引入 session default，而不能只靠 turn payload？ | HP2 / HP3 / clients | 必须；否则不构成产品级 model state machine | `frozen` | 当前仓库仍主要停留在 turn payload：`workers/orchestrator-core/src/session-lifecycle.ts:41-57`, `workers/orchestrator-core/src/user-do/message-runtime.ts:134-161`, `packages/nacp-session/src/messages.ts:43-52,119-136`；而 Claude / Gemini 都已有独立模型控制面：`context/claude-code/utils/model/model.ts:49-98`, `context/claude-code/commands/model/model.tsx:250-258`, `context/gemini-cli/packages/cli/src/ui/commands/modelCommand.ts:18-45`, `context/gemini-cli/packages/core/src/config/config.ts:1872-1898` |
| `HP2-D2` | fallback 是否做成单层还是链式？ | HP2 / HP3 / future routing | 先单层，必须写 audit + stream event | `frozen` | Claude / Gemini 的现有产品面都先落“切到一个当前模型再重试/继续”，而不是链式路由：`context/claude-code/query.ts:894-897`, `context/gemini-cli/packages/core/src/config/config.ts:1888-1893`; 当前 nano-agent 也尚无多 provider / chain policy durable truth，因此 HP2 先冻结 single-step |
| `HP2-D3` | `<model_switch>` developer message 是否在 HP2 就冻结？ | HP2 / HP3 | 是；HP3 按此语义做 compact strip/recover | `frozen` | `context/codex/codex-rs/protocol/src/models.rs:471-474`, `context/codex/codex-rs/core/src/codex.rs:3954-3961`, `context/codex/codex-rs/core/tests/suite/model_switching.rs:183-190`, `context/codex/codex-rs/core/src/event_mapping.rs:27-33` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. 四层模型状态机与其 durable 落点已经写清。
2. session current model、turn override、effective/fallback audit 的边界没有歧义。
3. alias、`<model_switch>`、fallback stream event 的产品语义已经冻结。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP3-context-state-machine.md`
- **需要进入 QNA register 的问题**：
  - `none（本批次先在设计内冻结，后续统一汇总）`

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

HP2 会以 **session-level current model API + turn audit + alias/detail + model-switch developer message + fallback event** 的形式存在，覆盖用户可见模型控制与 runtime 可追溯模型事实。它与 HP3 强耦合，因为模型切换直接影响 context window 与 compact 策略；也与 usage、history、checkpoint 有中度耦合，因为这些面都要看 effective model。它的复杂度不在“再加几个 endpoint”，而在把当前零散的 message-level parameter 升级为完整产品状态机。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | `5` | model state machine 是成熟 LLM wrapper 的核心组成 |
| 第一版实现的性价比 | `4` | 需要同时改 API、runtime、audit，但直接提升用户控制力 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | `5` | HP3 compact、future routing、checkpoint 都依赖真实模型状态 |
| 对开发者自己的日用友好度 | `4` | 调试 requested/effective/fallback 会明显更清楚 |
| 风险可控程度 | `4` | 主要风险在 HP2/HP3 边界，但设计已冻结分工 |
| **综合价值** | `5` | 是 hero-to-pro 从“能跑模型”迈向“可控模型”的关键 phase |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：是否应该先只补 `/models/{id}`，把 session current model 留到后面
  - **A 方观点**：先做 detail endpoint 成本更低
  - **B 方观点**：没有 session current model，就没有真正的控制面
  - **最终共识**：HP2 必须同时建立 session-level model API

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-30` | `GPT-5.4` | 初稿 |
| v0.2 | `2026-04-30` | `GPT-5.4` | precedent 与 QNA 来源改为 `context/` / 当前仓库源码锚点 |
