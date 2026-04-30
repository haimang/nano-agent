# Nano-Agent 功能簇设计

> 功能簇: `HP3 Context State Machine`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `workers/context-core/src/index.ts:123-202`
> - `workers/context-core/src/context-assembler.ts:1-168`
> - `workers/orchestrator-core/src/index.ts:656-665,1432-1508`
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:134-138`
> - `workers/agent-core/src/host/runtime-mainline.ts:117-136,167-177,239-304`
> - `packages/nacp-session/src/stream-event.ts:52-57`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（已冻结；本设计若与 QNA 冲突，以 QNA 为准）
> 文档状态: `reviewed`
> 外部 precedent 说明: 当前工作区未 vendored `context/` 源文件；文中出现的 `context/*` 仅作 drafting-time ancestry pointer，不作为当前冻结 / 执行证据。

---

## 0. 背景与前置约束

当前 nano-agent 已经有两块 context 相关基础，但它们还没有闭环成真正的“上下文状态机”：

1. `context-core` 已经暴露 `getContextSnapshot` / `triggerContextSnapshot` / `triggerCompact` 三个 RPC，但返回仍是显式标注 `phase: "stub"` 的结构化占位结果，而不是真实 session context（`workers/context-core/src/index.ts:123-202`）。
2. `agent-core` 已经有 `ContextAssembler`、`runtime-mainline` 的 `contextProvider` seam、以及 `compact.notify` stream kind，但目前 `contextProvider` 仍服务于 quota / anchor 语境，尚未把 cross-turn history、boundary snapshot、manual compact、model-aware budget 串成一个产品级流程（`workers/context-core/src/context-assembler.ts:1-168`; `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:134-138`; `workers/agent-core/src/host/runtime-mainline.ts:117-136,239-304`; `packages/nacp-session/src/stream-event.ts:52-57`）。

- **项目定位回顾**：HP3 是 `context control plane first wave`，负责把“有一些 context 相关 helper”提升为“可探测、可压缩、可恢复、可被客户端理解”的完整状态机。
- **本次讨论的前置共识**：
  - HP2 已冻结 `<model_switch>` 语义；HP3 必须兼容它，而不是重新定义。
  - 当前 facade 已经把 `/sessions/{id}/context`、`/context/snapshot`、`/context/compact` 代理到 `context-core`，所以 HP3 不再讨论“要不要有 context endpoint”，而是讨论这些 endpoint 的真实语义应该是什么。
  - `ContextAssembler` 的 canonical layer ordering 已存在，HP3 应当在此基础上演进，而不是再造第二套 prompt assembly。
  - 当前 migrations 只到 `001-006`，没有任何 context checkpoint / compact job 专表；HP3 若需要 durable compact job，必须显式声明 schema 依赖，而不能假装已经存在。
- **本设计必须回答的问题**：
  - context 的 durable truth 应分成哪些层：recent transcript、boundary snapshot、workspace layers、model switch markers？
  - auto-compact 由谁触发、用什么 budget、怎样与 HP2 model metadata 对齐？
  - manual compact preview / job 要不要做成 durable job，以及 current endpoint 应如何重构？
  - compact 时 `<model_switch>` / `<state_snapshot>` 应如何 strip-then-recover，避免 summary 污染与语义丢失？
- **显式排除的讨论范围**：
  - file revert / file snapshot
  - checkpoint restore / conversation rewind
  - provider-specific prompt template engine

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP3 Context State Machine`
- **一句话定义**：`把当前 stub 化的 context endpoints、零散的 prompt assembly 与潜在 compact 能力，收敛成可探测、可压缩、可恢复、可由 model metadata 驱动的上下文状态机。`
- **边界描述**：这个功能簇**包含** context probe、layer exposure、cross-turn history assembly、auto-compact、manual compact preview/job、boundary snapshot、compact notify；**不包含** checkpoint restore、file revert、multi-session fork。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| recent transcript | 最近若干 turn 的原始 message 历史 | 不经过摘要，优先保真 |
| boundary snapshot | 一次 compact 后留下的 durable 摘要边界 | 代替被折叠掉的旧 transcript |
| context layers | `system / session / workspace_summary / artifact_summary / recent_transcript / injected` 等 prompt layer | 复用现有 `ContextAssembler` 术语 |
| auto-compact | 在 LLM call 前基于 model-aware budget 自动触发的压缩 | 属于 runtime 行为 |
| manual compact preview | 客户端显式请求的“如果现在 compact，会压掉什么”只读预演 | 不落 summary |
| compact job | 一次真正 compact 的可追踪执行记录 | 初版需要最小 durable 面 |

### 1.2 参考源码与现状锚点

- `workers/context-core/src/index.ts:123-202` — 当前 3 个 RPC 都是 `phase: "stub"` 的结构化占位实现。
- `workers/context-core/src/context-assembler.ts:1-168` — 当前已有 canonical layer ordering、required/optional layer、budget truncation 与 evidence seam。
- `workers/orchestrator-core/src/index.ts:656-665,1432-1508` — facade 已经公开了 3 个 context endpoint，并把请求转发到 `CONTEXT_CORE`。
- `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:134-138` 与 `workers/agent-core/src/host/runtime-mainline.ts:117-136,239-304` — runtime 已有 `contextProvider`/`hookDispatcher`/`onUsageCommit` seam，但还没有 cross-turn context state machine。
- `packages/nacp-session/src/stream-event.ts:52-57` — `compact.notify` 已是正式 stream kind。
- `context/codex/codex-rs/core/src/codex.rs:3948-3985` 与 `context/codex/codex-rs/core/tests/suite/compact.rs:132-142` — Codex 会在 context reinject 与 compact 场景处理中显式维护 `<model_switch>` 语义。
- `context/claude-code/services/compact/sessionMemoryCompact.ts:45-61,188-230,232-259` 与 `context/claude-code/services/compact/microCompact.ts:40-50,164-205` — Claude Code 证明 compact 必须保护 tool-use/tool-result 成对关系与 recent window，不是“简单裁剪”。
- `context/gemini-cli/packages/core/src/context/contextCompressionService.ts:50-59,108-160,223-255` 与 `context/gemini-cli/packages/core/src/context/contextManager.ts:74-117,152-169` — Gemini 把压缩状态、protected recent window、routing decision 与最终 render 分层管理。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP3 在整体架构里扮演 **context control plane + prompt budget owner**。
- 它服务于：
  - session/chat 客户端的 context probe / compact 操作面
  - model state machine 对 context_window / auto_compact_token_limit 的消费
  - runtime 的长对话稳定性
  - future checkpoint / restore 的 durable conversation boundary
- 它依赖：
  - `ContextAssembler`
  - `orchestrator-core` D1 durable history
  - HP2 的 model metadata 与 `<model_switch>` 语义
  - `nacp-session` 的 `compact.notify`
- 它被谁依赖：
  - HP4 checkpoint conversation_only
  - HP5 confirmation（manual compact preview 若后续需要确认）
  - HP9 clients/api-docs 文档

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP2 Model State Machine | HP2 <-> HP3 | 强 | compact 阈值、`<model_switch>` 恢复都依赖模型元数据 |
| orchestrator-core durable history | HP3 <- D1 | 强 | cross-turn history 与 boundary snapshot 都要与 durable truth 对齐 |
| workspace context artifacts | HP3 <-> assembler | 强 | layer ordering 与 evidence 以现有 assembler 为骨架 |
| HP4 Chat Lifecycle | HP3 -> HP4 | 中 | HP4 restore 需要消费 compact 后留下的 conversation boundary |
| clients/web / future clients | HP3 -> client | 中 | context probe、preview、job status 都是用户可见产品面 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP3 Context State Machine` 是 **长对话稳定性的主控层**，负责 **把 durable history、workspace layers、model-aware budget 与 compact 行为统一成一个可观察、可操作的上下文状态机**，对上游提供 **probe / preview / compact / layers 四类可见能力**，对下游要求 **runtime 不再在上下文溢出时靠偶然幸存**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 单独再造第二套 prompt assembler | 当前已存在 `ContextAssembler` | 会制造两套 layer ordering truth | 否 |
| “只靠字节数硬裁剪旧消息”的简化 compact | 实现最省 | 会破坏 tool pair、thinking continuity、model switch 语义 | 否 |
| 先做完整 file-aware compact | scope 容易膨胀 | HP3 目标是 conversation context，不是 file revert | HP7 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| context probe | `GET /sessions/{id}/context/probe` | 返回 budget、need_compact、recent window、latest boundary | future 可扩 token heatmap |
| context layers | `GET /sessions/{id}/context/layers` | 暴露当前 layer 组成与 token estimate | future 可扩 debug evidence |
| compact preview | `POST /sessions/{id}/context/compact/preview` | 只读预演，不写 snapshot | future 可接 HP5 confirmation |
| compact job | `POST /sessions/{id}/context/compact` + `GET /.../jobs/{job_id}` | durable 结果句柄；第一版 `job_id` 直接复用 `compact_boundary` checkpoint UUID | future 可扩真正异步 queue / retry |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：context compaction 与 session checkpoint restore
- **解耦原因**：compact 是“缩减 prompt 面积”，restore 是“回退 conversation truth”；两者都动历史，但目标完全不同。
- **依赖边界**：HP3 只写 boundary snapshot；`/compact/jobs/{id}` 第一版以 HP1 已冻结的 checkpoint / confirmation truth 组装读模型，不在本 phase 新增独立 compact job 表，也不修改 superseded message truth。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：context probe、recent transcript、boundary snapshot、manual/auto compact
- **聚合形式**：统一收敛到 `context-core` 的 probe/preview/job surface，以及 agent-core 内部单一 `CrossTurnContextManager`
- **为什么不能分散**：如果 probe 在 context-core、auto-compact 在 runtime、layers 在 assembler、manual preview 另起实现，最终会出现“同一 session 不同接口讲不同 context truth”。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent 以当前仓库源码锚点为 authoritative evidence；若出现 `context/*`，仅作 external ancestry pointer，不再使用二手调查文档。

### 4.1 Codex 的做法

- **实现概要**：Codex 在正常 turn 中持续记录最新 turn context item，当 reference snapshot 缺失时注入 full initial context；若 full reinject 期间发生模型切换，则前置 `<model_switch>`，确保压缩/重建后模型语义不丢（`context/codex/codex-rs/core/src/codex.rs:3948-3985`）。其 compact 测试也显式断言 pre-sampling compact request 要 strip 掉 trailing `<model_switch>`，而后续 request 又必须恢复它（`context/codex/codex-rs/core/tests/suite/compact.rs:132-142`）。
- **亮点**：
  - compact 与 context reinject 共用同一套 state baseline
- **值得借鉴**：
  - strip-then-recover 必须成为 contract
  - boundary snapshot 不是“多一份 summary”，而是新的 durable baseline
- **不打算照抄的地方**：
  - 一次复制 Codex 的全部 rollout item 体系

### 4.2 Claude Code 的做法

- **实现概要**：Claude Code 把 session memory compact 做成有阈值、有保底窗口、有 invariant 保护的显式子系统。它会保护最少 token / 最少文本消息，避免 tool_use/tool_result 成对关系与共享 message.id 的 thinking block 被截断；其 micro-compact 也只对特定高体积工具结果生效，而不是暴力压全历史（`context/claude-code/services/compact/sessionMemoryCompact.ts:45-61,188-230,232-259`; `context/claude-code/services/compact/microCompact.ts:40-50,164-205`）。
- **亮点**：
  - compact 首先保护 API invariants，而不是先追求 summary 覆盖率
- **值得借鉴**：
  - recent window + pair-preservation
  - compact 分层：微压缩与大边界压缩不是同一件事
- **不打算照抄的地方**：
  - 直接复制 Claude 特定 message shape 与工具枚举

### 4.3 Gemini CLI 的做法

- **实现概要**：Gemini 把 context 管理分成两层：`ContextManager` 负责观察 pristine history、在超预算时发出 consolidation 触发、并在 render 前执行最后的 GC backstop；`ContextCompressionService` 负责维护 compression state、保护 recent turns、批量做 routing decision，再把结果应用回 history（`context/gemini-cli/packages/core/src/context/contextManager.ts:74-117,152-169`; `context/gemini-cli/packages/core/src/context/contextCompressionService.ts:50-59,108-160,223-255`）。
- **亮点**：
  - “何时需要 compact”与“怎样 compact”分层
- **值得借鉴**：
  - preview/probe/job 可以共享同一份 state
  - recent turns 必须是 protected window
- **不打算照抄的地方**：
  - 文件级 compression state 直接落本地文件系统

### 4.4 横向对比速查表

| 维度 | Codex | Claude Code | Gemini CLI | nano-agent 倾向 |
|------|-------|-------------|------------|------------------|
| baseline 表达 | turn context item + reference baseline | session memory + compact boundary | pristine graph + working buffer | boundary snapshot + recent transcript |
| compact 保护点 | `<model_switch>` strip/recover | tool pair / thinking continuity | protected recent window | 三者都要保 |
| 触发模式 | runtime-aware reinject | token threshold + compact rules | budget trigger + render backstop | auto + manual preview/job 双轨 |
| 产品面 | 偏内部 | 偏内部 | 明确 context manager | 明确 facade context API |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** 将现有 `/sessions/{id}/context` 三端点重构为 product-facing 的 probe / compact 能力族：`probe`、`compact/preview`、`compact`、`compact/jobs/{id}`、`layers`。
- **[S2]** 在 agent-core 内引入单一 `CrossTurnContextManager`，统一 recent transcript、boundary snapshot 与 workspace layers 组装。
- **[S3]** 将 auto-compact 改为 model-aware budget，而不是固定 32K 假设。
- **[S4]** 冻结 compact 的 strip-then-recover 算法：`<model_switch>` / `<state_snapshot>` 不参与摘要正文，但必须在 compact 后恢复到后续 prompt。
- **[S5]** 让 `compact.notify` 成为 manual/auto compact 共享的可见 stream 事件。
- **[S6]** 加入 compact failure circuit breaker，避免连续失败时 runtime 无限尝试。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** file revert / file-only snapshot — 属于 HP7；重评条件：HP7 启动。
- **[O2]** conversation restore / supersede message truth — 属于 HP4；重评条件：HP4 启动。
- **[O3]** per-provider prompt compaction template — 属于 hero-to-platform；重评条件：进入 provider abstraction 阶段。
- **[O4]** 多 session 共享 context memory — 不属于 HP3 单 session 状态机；重评条件：产品边界变化。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| 继续保留 `GET /sessions/{id}/context` 作为最终 API 形态 | out-of-scope | 当前名字无法区分 probe 与 layer/detail | HP3 统一改成细分 surface |
| compact preview 是否必须写 job | out-of-scope | preview 是只读预演，不应污染 durable truth | HP3 明确禁止 |
| compact 结果是否需要 durable D1 handle | in-scope | 要支持 `GET /jobs/{id}` 与跨 worker 重读 | 第一版复用 HP1 的 checkpoint / confirmation schema，不另建 compact 专表 |
| recent transcript 长度是否固定 turn 数 | defer | 应由 token budget 与 protected window 联合决定 | HP3 action-plan 调参 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **“boundary snapshot + recent transcript”双层上下文** 而不是 **始终把完整历史直接送进 prompt**
   - **为什么**：完整历史会在长对话下失控，而纯 summary 又会丢局部精度。
   - **我们接受的代价**：需要维护 compact baseline 与 restore 语义。
   - **未来重评条件**：无；这是 HP3 的核心结构。

2. **取舍 2**：我们选择 **runtime 内单一 `CrossTurnContextManager`** 而不是 **context-core 每次远程重组全部 prompt**
   - **为什么**：LLM call 前每次跨 worker RPC 组 prompt 会放大 latency 与一致性风险。
   - **我们接受的代价**：context-core 更偏 control plane / inspection，而不是 prompt owner。
   - **未来重评条件**：若后续需要独立 context worker 持有真正 per-session state，再通过新 phase 重评。

3. **取舍 3**：我们选择 **manual preview + durable compact handle 双轨** 而不是 **所有 compact 都同步完成**
   - **为什么**：manual compact 是用户操作面，需要 preview；真实 compact 涉及 LLM summary 与 durable write，更适合 job 语义。
   - **我们接受的代价**：需要一个由 `compact_boundary` checkpoint 驱动的最小结果读模型。
   - **未来重评条件**：若 compact 始终足够快，可把 job 内收，但第一版不假设。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| token estimation 不准 | 中文/工具结果体积与估算偏差过大 | compact 触发过早或过晚 | 使用 `effective_context_pct * context_window` 的保守预算，并记录 probe 中的 estimated vs actual |
| `<model_switch>` 被错误摘要 | compact 直接拿全 prompt 去总结 | 后续模型切换语义丢失 | 冻结 strip-then-recover contract |
| compact 结果无 durable truth | worker 重启或 client 重连 | `/jobs/{id}` 不可读 | 以 `compact_boundary` checkpoint UUID 作为 `job_id`，`/jobs` 读取 checkpoint / confirmation / compact.notify 投影 |
| cross-turn history 与 D1 truth 不一致 | runtime 只看内存、不看 durable history | probe 与真实对话分裂 | `CrossTurnContextManager` 以 D1 recent history 为主，内存仅作热点缓存 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：长对话问题第一次有明确 probe 与 compact 调试面，不再只能猜“是不是 prompt 太长了”。
- **对 nano-agent 的长期演进**：HP3 是 checkpoint、rewind、workspace promotion 之前必须补齐的中间层。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：context state machine 一旦成型，tool-heavy agent loop 才可能稳定跨 24K / 131K 等不同模型窗口运行。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | probe / layers surface | 提供当前 context 预算、层次与 compact 建议 | ✅ client 能看到“当前上下文长什么样” |
| F2 | cross-turn context manager | 统一 recent transcript、boundary snapshot 与 assembler | ✅ LLM prompt 不再只看当前 turn |
| F3 | auto-compact | 在预算超阈值时自动触发 compact | ✅ 长对话在不同模型窗口下稳定工作 |
| F4 | manual compact preview + job | 用户可预演并发起一次真实 compact | ✅ compact 成为可操作而非黑盒行为 |
| F5 | strip-then-recover contract | 保护 `<model_switch>` / `<state_snapshot>` 等控制片段 | ✅ compact 不破坏模型和状态语义 |

### 7.2 详细阐述

#### F1: probe / layers surface

- **输入**：session uuid
- **输出**：`budget`, `estimated_tokens`, `need_compact`, `latest_boundary`, `protected_recent_turns`, `layers`
- **主要调用者**：clients/web、debug 面、manual evidence
- **核心逻辑**：把当前 `/context` 重命名/收敛为 `probe`；另给出 `layers` 明细，明确 assembled layer 与 token estimate
- **边界情况**：
  - 没有 compact 过的 session 也必须返回 `latest_boundary = null`
  - ended/expired session 仍可读 probe，但不可再发起 compact
- **一句话收口目标**：✅ **context 不再是黑盒内部状态，而是客户端可读的产品事实**。

#### F2: cross-turn context manager

- **输入**：当前 turn 输入、recent durable history、latest boundary snapshot、workspace layers、model metadata
- **输出**：一次规范化后的 LLM prompt message 列表
- **主要调用者**：`runtime-mainline`
- **核心逻辑**：在 agent-core 内部统一读取 recent transcript 与 latest boundary，然后交给现有 `ContextAssembler` 组装；`context-core` 负责 inspection/control plane，而不是每次 LLM call 的 prompt owner
- **边界情况**：
  - recent transcript 必须保留 protected window
  - boundary snapshot 缺失时允许 full recent path
- **一句话收口目标**：✅ **turn2 可以稳定记住 turn1 的 durable truth，而不是只依赖偶然残留在窗口里的消息**。

#### F3: auto-compact

- **输入**：assembled context token estimate、`context_window`、`effective_context_pct`、`auto_compact_token_limit`
- **输出**：是否触发 compact、compact 前后 token 统计、`compact.notify`
- **主要调用者**：LLM call 前 runtime
- **核心逻辑**：预算不再硬编码 32K；优先取 model metadata 驱动的阈值；超阈值则走 compact 流程并带 circuit breaker
- **边界情况**：
  - 连续 3 次 compact 失败必须停止自动重试并 surface error
  - 超阈值但 session 已 ended 时不允许触发
- **一句话收口目标**：✅ **131K 与 24K 模型的 compact 行为不再相同，而是由元数据真实驱动**。

#### F4: manual compact preview + job

- **输入**：`POST /sessions/{id}/context/compact/preview` 或 `POST /sessions/{id}/context/compact`
- **输出**：preview 报告或以 `compact_boundary` checkpoint UUID 表达的 durable result handle
- **主要调用者**：client、运维、manual evidence
- **核心逻辑**：preview 只读计算“会折叠哪些历史、保留哪些 recent window”；真实 compact 在必要时先走 `kind = context_compact` confirmation，随后写 `checkpoint_kind = compact_boundary` 的 checkpoint，并把该 `checkpoint_uuid` 作为 `job_id` 返回；`GET /compact/jobs/{id}` 读取的是 checkpoint / confirmation / compact.notify 的投影，而不是单独的 `nano_compact_jobs` 表
- **边界情况**：
  - preview 绝不写 summary
  - 若 compact 在写 checkpoint 前失败，则直接返回 terminal error；第一版不为“未接受执行”的请求额外造 job row
- **一句话收口目标**：✅ **manual compact 成为可解释、可追踪的操作，而不是一次看不见的后台副作用**。

#### F5: strip-then-recover contract

- **输入**：待 compact 的历史消息、控制片段（`<model_switch>`、`<state_snapshot>`）
- **输出**：供摘要使用的正文与 compact 后恢复到 future prompt 的控制片段
- **主要调用者**：compact delegate
- **核心逻辑**：摘要输入先 strip 控制片段；compact 成功后把控制片段转成新的 boundary metadata/next prompt injection
- **边界情况**：
  - strip 不能把真正用户输入误删
  - 恢复后的控制片段顺序必须稳定
- **一句话收口目标**：✅ **compact 后不会因为 summary 污染而丢失模型切换与状态切换语义**。

### 7.3 非功能性要求与验证策略

- **性能目标**：常规 LLM call 不因 context assembly 额外引入一次跨 worker prompt RPC；probe/read API 要保持轻量。
- **可观测性要求**：每次 compact 都必须同时留下 stream event、job/result、probe 可见差异。
- **稳定性要求**：compact 失败时要 fail-loud，不能静默丢历史。
- **安全 / 权限要求**：context probe/compact 都走现有 façade auth + team scope，不得跨 team 读取。
- **测试覆盖要求**：不同窗口模型的 auto-compact、cross-turn recall、compact fail circuit breaker、strip/recover 至少各 1 条 e2e。
- **验证策略**：以“同一 session 的 probe、stream event、下次 prompt 组装结果三者一致”为准；不能只验证 endpoint 200。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent 源码 | HP3 主要对照当前仓库与 `context/` 三个 agent | 不再通过二手 study 转述 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/core/src/codex.rs:3948-3985` | 记录最新 turn context baseline，并在 full reinject 时处理 model switch | compact / reinject 与 baseline 必须共用同一套 truth | HP3 借鉴 baseline 思想，不照抄 rollout item 全体系 |
| `context/codex/codex-rs/core/tests/suite/compact.rs:132-142` | compact 前 strip `<model_switch>`，后续请求恢复 `<model_switch>` | strip-then-recover 必须是 contract | 适合在 nano-agent e2e 中复刻 |

### 8.3 来自 claude-code / gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/services/compact/sessionMemoryCompact.ts:188-230,232-259` | 调整 compact 起点以保护 tool_use/tool_result 与 thinking continuity | compact 不能只按“从第 N 条开始裁”处理 | HP3 借鉴 invariant 保护 |
| `context/claude-code/services/compact/microCompact.ts:40-50,164-205` | 只对高体积工具结果做微压缩，并估算 token | 说明 micro-compact 与大边界 compact 是两层 | nano-agent 可先保留扩展点 |
| `context/gemini-cli/packages/core/src/context/contextCompressionService.ts:108-160,223-255` | 保护 recent window，批量做 routing decision，再统一应用压缩结果 | preview / auto-compact 可以共享同一份 compression state | 具体文件级决策不照抄 |
| `context/gemini-cli/packages/core/src/context/contextManager.ts:74-117,152-169` | budget trigger 与最终 render 分层 | “何时压缩”与“如何渲染”应解耦 | 适合作为 `CrossTurnContextManager` 结构 precedent |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/context-core/src/index.ts:123-202` | 3 个 RPC 当前都仍是 `phase: "stub"` | 说明 HP3 的第一优先级是把 context surface 从 placeholder 变成真实能力 |
| `workers/context-core/src/context-assembler.ts:1-168` | 现有 assembler 已冻结 layer ordering 与 evidence seam | HP3 应复用，而不是重造 prompt assembler |
| `workers/orchestrator-core/src/index.ts:656-665,1432-1508` | facade 已暴露 context 入口，但仍映射到 stub RPC | 当前 public surface 已存在，HP3 要修语义而不是再起新入口 |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:134-138` | `contextProvider` 当前只是 runtime seam，不是 context state machine | HP3 要把 seam 接成真正的 cross-turn manager |
| `workers/agent-core/src/host/runtime-mainline.ts:167-177,239-304` | system prompt 注入与 request build 已存在，但尚未纳入 compact/boundary state | HP3 要把 context assembly 真正接进 LLM 请求主线 |
| `packages/nacp-session/src/stream-event.ts:52-57` | `compact.notify` 已存在 | HP3 应直接复用正式 stream kind，而不是再造临时事件名 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP3-D1` | context prompt owner 放在 context-core 还是 agent-core runtime？ | HP3 / HP4 / runtime latency | 放在 agent-core runtime；context-core 负责 inspection/control plane | `frozen` | `docs/charter/plan-hero-to-pro.md:318-320,333-335`, `workers/agent-core/src/host/runtime-mainline.ts:117-136,239-304`, `workers/context-core/src/index.ts:123-202`, `workers/orchestrator-core/src/index.ts:1432-1508` |
| `HP3-D2` | compact 是否必须保护 `<model_switch>` / `<state_snapshot>` 而不是直接摘要所有内容？ | HP2 / HP3 | 必须保护，采用 strip-then-recover | `frozen` | `docs/charter/plan-hero-to-pro.md:520,555-556`, `workers/agent-core/src/host/runtime-mainline.ts:239-304`, `workers/context-core/src/context-assembler.ts:1-168` |
| `HP3-D3` | manual compact 是否需要 preview 与 durable job 分离？ | HP3 / clients | 需要；preview 只读，compact 才写 durable handle | `frozen` | `docs/charter/plan-hero-to-pro.md:318-320,441,444-446`, `workers/orchestrator-core/src/index.ts:1432-1508`, `packages/nacp-session/src/stream-event.ts:52-57` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. probe / layers / preview / compact / jobs 五个 surface 的职责边界已经写清。
2. `CrossTurnContextManager` 与 `ContextAssembler` 的分工已冻结。
3. auto-compact 的 budget law 与 strip-then-recover contract 已冻结。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP2-model-state-machine.md`
  - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
- **需要进入 QNA register 的问题**：
  - `若 HP1 schema extension 在 HP3 启动前仍未落地，manual compact 所依赖的 confirmation/checkpoint 字段是否允许作为 HP1 schema correction 一并处理（若 HP1 已 closure，则本题自动视为 not-triggered）`

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

HP3 会以 **agent-core 内的 `CrossTurnContextManager` + context-core 的 probe/compact control plane + model-aware compact budget + boundary snapshot** 的形式存在。它覆盖的不是“又多几个 endpoint”，而是让长对话上下文第一次拥有稳定结构：最近对话保真、旧历史可折叠、compact 可见、模型切换语义可恢复。它与 HP2 强耦合，与 HP4 中耦合，因为 compact 直接影响后续 restore 所看到的 conversation baseline。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | `5` | 长对话稳定性是 agentic loop 的核心要求 |
| 第一版实现的性价比 | `4` | 需要同时改 runtime、control plane、probe surface，但收益直接 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | `5` | HP4/HP7/更长上下文模型都依赖这层 |
| 对开发者自己的日用友好度 | `4` | 有了 probe/preview/job，调长对话会省很多时间 |
| 风险可控程度 | `3` | compact 与模型切换耦合较深，需要谨慎实现 |
| **综合价值** | `5` | HP3 是从“能跑 demo”走向“能承受真实长对话”的关键阶段 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：compact job 要不要延后到 HP4
  - **A 方观点**：先做同步 compact，避免 schema 扩展
  - **B 方观点**：没有 durable job 就没有可靠的 client surface
  - **最终共识**：HP3 第一版就保留最小 durable job 面；若 HP1 schema 未先落地，则作为 HP3 collateral migration 明确处理

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-30` | `GPT-5.4` | 初稿 |
