# Nano-Agent 功能簇设计模板

> 功能簇: `RH2 LLM Delta Policy`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/design/real-to-hero/RH2-models-context-inspection.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH2 明确新增一份专项设计，专门冻结 `snapshot-vs-push` 与 `semantic-chunk vs token-level` 的边界。这份文档的作用不是再开一个 phase，而是避免 RH2/RH5/RH6 对“到底要不要做 token-level streaming”“usage 是 push 真相还是 snapshot 真相”继续漂移。

- **项目定位回顾**：这是 RH2 的专项策略文档，用来冻结 stream policy，而不是扩 scope。
- **本次讨论的前置共识**：
  - token-level streaming 在 real-to-hero out-of-scope
  - usage snapshot 仍由 HTTP strict read model 提供
- **本设计必须回答的问题**：
  - 哪些内容应 push，哪些内容必须 snapshot？
  - semantic-chunk 的定义和止损边界是什么？
- **显式排除的讨论范围**：
  - provider-native raw SSE 暴露
  - 多 provider streaming 抽象

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH2 LLM Delta Policy`
- **一句话定义**：`冻结 real-to-hero 阶段的流式策略：semantic-chunk push、HTTP snapshot strict、token-level defer。`
- **边界描述**：这个功能簇**包含** semantic-chunk 定义、usage/permission/elicitation push-vs-snapshot 边界、tool result 可见性；**不包含** token-level text streaming 与 provider-native raw frame 透传。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| semantic-chunk | 工具语义块级别的 streaming | `llm.delta.content_type` ∈ `{text, thinking, tool_use_start, tool_use_delta}`；**结束语义由 `tool_use_delta`（后续可加 `is_final` 标志）+ 独立 `tool.call.result` frame 表达**，不引入 `tool_use_stop` 枚举（当前 schema 不存在）|
| token-level | 文本 token 级别逐 token 下发 | 明确不在 RH 阶段 |
| strict snapshot | 以 HTTP/D1 为严格读模型 | push 丢失时的回读面 |
| best-effort push | 面向 attached client 的实时预览 | 不承担严格一致性义务 |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §4.0 item 2、§7.3 P2-E
- `docs/design/real-to-hero/RH2-models-context-inspection.md` — WS / client visibility 主设计

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这份策略文档在整体架构里扮演 **streaming policy freeze** 的角色。
- 它服务于：
  - RH2 WS 设计
  - RH1 usage push 语义
  - RH5 多模型 / 多模态 streaming 一致性
- 它依赖：
  - `nacp-session` event taxonomy
  - current quota usage snapshot path
  - current Workers AI semantic event normalisation
- 它被谁依赖：
  - client renderer
  - action-plan 中的 WS / stream 任务拆分

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| RH1 Usage Push | policy -> RH1 | 强 | usage push 语义由本策略定义 |
| RH2 WS Upgrade | policy -> RH2 | 强 | frame taxonomy 与 client adapter 需按本策略落地 |
| RH5 Multi-model | policy -> RH5 | 中 | 不同模型的 streaming 差异要被同一策略吸收 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH2 LLM Delta Policy` 是 **streaming 行为的冻结文档**，负责 **界定什么应该推、什么必须回读、什么明确不做**，对上游提供 **统一的 client 语义**，对下游要求 **实现不得自行扩成 token-level 或 raw-provider pass-through**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| token-level text streaming | 为了“更像现代 chat UI” 的诱因 | 成本高、协议复杂、与 first-wave 价值不成比例 | hero-to-platform |
| provider raw SSE frame 直通 client | 图省映射层 | 泄漏 provider 边界，难做兼容 | 否 |
| 把 usage push 当作严格真相 | 追求“实时就是事实” | 推送天然会丢，不适合作为 strict source | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| `llm.delta` | `SessionStreamEventBody.kind = "llm.delta"` | semantic content_type | 未来可扩 token-level 子类型 |
| usage read model | `/sessions/{id}/usage` | strict snapshot | hero-to-platform 再接 richer ledger |
| tool result | `tool.call.result` | 必须始终单独发 | 未来可扩结构化 payload |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：usage snapshot vs usage push
- **解耦原因**：snapshot 负责一致性，push 负责体验。
- **依赖边界**：push 不回写真相层，snapshot 不承诺实时频率。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：所有 server -> client 流式能力的语义边界
- **聚合形式**：统一收敛到 `nacp-session` event taxonomy + façade docs
- **为什么不能分散**：否则不同 endpoint / client adapter 会各自理解“streaming”的含义

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前 schema 的做法

- **实现概要**：`llm.delta`、`tool.call.progress`、`tool.call.result` 已有 schema，但未冻结 first-wave 策略口径。
- **亮点**：
  - taxonomy 已经足够表达 semantic-chunk
- **值得借鉴**：
  - 不重新发明 frame kind，只冻结 policy
- **不打算照抄的地方**：
  - 把每个 event kind 都当作必须实时、严格一致

### 4.2 当前 runtime 的做法

- **实现概要**：Workers AI adapter 目前能归一化 tool call / finish / delta，但 public WS policy 尚未写死。
- **亮点**：
  - runtime 内已有 provider -> canonical 映射
- **值得借鉴**：
  - 让 provider 差异先在 runtime 内被吸收
- **不打算照抄的地方**：
  - 把 provider 特有语义直接暴露给 client

### 4.3 RH2 的设计倾向

- **实现概要**：用最少的事件种类，承载 first-wave 最有价值的 streaming 体验。
- **亮点**：
  - 清楚区分 preview 与 strict
- **值得借鉴**：
  - tool result 永远不能被 semantic chunk 替代
- **不打算照抄的地方**：
  - 让“以后也许要做 token-level”成为现在的 scope 泄洪口

### 4.4 横向对比速查表

| 维度 | 当前 taxonomy | RH 策略 | nano-agent 倾向 |
|------|---------------|---------|------------------|
| text delta | 有 `llm.delta` | semantic only | defer token-level |
| tool progress | 有 schema | 必做 push | client 可见 |
| tool result | 有 schema | 必做 push | 单独 frame |
| usage | 有 update body | push preview + snapshot strict | 双轨但不混真相 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** semantic-chunk `llm.delta`
- **[S2]** `tool.call.progress` 与 `tool.call.result` 的客户端可见性
- **[S3]** usage = WS push best-effort + HTTP snapshot strict-consistent
- **[S4]** permission / elicitation = WS push first，HTTP mirror 只作 ack/backstop

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** token-level text streaming — 成本/收益不适合 RH 阶段；重评条件：hero-to-platform
- **[O2]** provider-native raw stream 透传 — 会泄漏 provider 边界；重评条件：无
- **[O3]** 以 push 替代 snapshot — 会破坏 strict read model；重评条件：无

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `llm.delta` 里承载 tool_use semantic | in-scope | 当前 taxonomy 已支持 | RH2 |
| 逐 token 文本 push | out-of-scope | 非 first-wave 必需 | hero-to-platform |
| usage push 丢失后客户端回 `/usage` | in-scope | 这是双轨设计的一部分 | RH1/RH2 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **semantic-chunk** 而不是 **token-level text**
   - **为什么**：工具执行可见性比文本逐 token 更解决当前客户端断点。
   - **我们接受的代价**：文本 UI 不会像最细粒度 chat 那样连续。
   - **未来重评条件**：hero-to-platform。

2. **取舍 2**：我们选择 **snapshot strict / push preview 双轨** 而不是 **单轨 push 真相**
   - **为什么**：读模型与体验模型必须分离。
   - **我们接受的代价**：客户端要理解 push 丢失后需要回读。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| client 误把 push 当真相 | 文档未写清 | usage 漂移争议 | 在 API docs / design / qna 同步固定口径 |
| provider 差异泄漏 | 直接暴露 raw SSE | client 兼容困难 | 一律先 canonical 化 |
| team 期待 token-level | 只看“streaming”字样 | 期望管理失衡 | 在 charter 和本设计都明确写 out-of-scope |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：避免 RH2/RH5 再为“要不要做 token-level”反复摇摆。
- **对 nano-agent 的长期演进**：把 future richer stream 保留为可扩展但不阻塞现在。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：让 live 事件与 strict truth 分工明确。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Semantic Delta Policy | 冻结 `llm.delta` 仅承担 semantic chunk | ✅ `不再对 token-level 有歧义期待` |
| F2 | Snapshot vs Push Law | 冻结 usage/permission/elicitation 的双轨关系 | ✅ `客户端与服务端对真相层理解一致` |

### 7.2 详细阐述

#### F1: `Semantic Delta Policy`

- **输入**：runtime canonical event、`nacp-session` event taxonomy
- **输出**：客户端可消费的 semantic `llm.delta`
- **主要调用者**：WS renderer、tool execution timeline
- **核心逻辑**：允许文本增量的语义块级呈现，但不承诺 token-level；tool_use_start/delta/stop 与 tool result 必须明确分离。
- **边界情况**：
  - provider 可能不给出完全相同的 tool-use chunk 形态，runtime 负责归一化。
- **一句话收口目标**：✅ **`RH 阶段的 streaming 语义被明确限制在 semantic-chunk`**

#### F2: `Snapshot vs Push Law`

- **输入**：usage update、permission request、elicitation request、HTTP read model
- **输出**：统一的 preview/strict 责任划分
- **主要调用者**：client adapter、API docs、action-plan
- **核心逻辑**：usage 采用 WS push preview + HTTP snapshot strict；permission/elicitation 采用 WS push + HTTP fallback/ack。
- **边界情况**：
  - push 丢失不得被解释为真相丢失。
- **一句话收口目标**：✅ **`流式与回读之间的职责边界不再漂移`**

### 7.3 非功能性要求与验证策略

- **性能目标**：不因追求 token-level 而扩大 RH2 复杂度
- **可观测性要求**：每类 event kind 都能被 schema 校验
- **稳定性要求**：client 在 push 丢失时总能回读严格真相
- **安全 / 权限要求**：push 不越过既有 auth / authority law
- **测试覆盖要求**：至少有 WS frame validation 与 `/usage` / permission / elicitation 行为对齐测试
- **验证策略**：通过 schema tests、client adapter smoke、HTTP vs WS 一致性说明证明策略成立

---

## 8. 可借鉴的代码位置清单

### 8.1 Event taxonomy

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/nacp-session/src/stream-event.ts:10-95` | `llm.delta` / `tool.call.progress` / `tool.call.result` taxonomy | 本策略的直接 schema 根基 | single source |
| `packages/nacp-session/src/messages.ts:136-199` | `session.usage.update` / permission / elicitation body schema | push-vs-snapshot law 需围绕现有 body 定义 | current bodies |

### 8.2 Runtime canonical layer

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/llm/adapters/workers-ai.ts:148-220` | provider SSE → `LlmChunk`（content/usage/tool_calls 三 variants）—— **第 1 层归一化** | semantic-chunk 在此先吸收 provider 差异；策略层不直接改这一层 | provider seam |
| `workers/agent-core/src/host/runtime-mainline.ts:148-187` | `LlmChunk` → `NormalizedLLMEvent`（llm.request.started/delta/tool_call/finish/error 五 variants）—— **第 2 层归一化** | RH2 streaming policy 真正下发到 client 的入口在此层，frame 形态由 `nacp-session` schema 决定 | current mainline |

> **两层归一化**：`LlmChunk`（adapter 出口）≠ `NormalizedLLMEvent`（runtime 出口）≠ WS frame body；任何 streaming 行为修改都需要同时审视这三层。

---

## 9. 多审查修订记录（2026-04-29 design rereview）

| 编号 | 审查者 | 原 finding | 采纳的修订 |
|------|--------|-------------|------------|
| GPT-R2 | GPT | `tool_use_stop` 枚举在当前 `stream-event.ts` 不存在 | §1.1 关键术语改为"结束语义由 `tool_use_delta` + `tool.call.result` 表达"；选择 GPT 给出的方案 B（不扩 schema）|
| GLM-R10 | GLM | RH2 未区分 `LlmChunk` vs `NormalizedLLMEvent` 两层归一化 | §8.2 重写为"两层归一化"明示，并加注 RH2 不改 adapter 层 |
| GLM-R13 | GLM | orchestrator-core `emitServerFrame` / `handleWsAttach` 路径不走 `validateSessionFrame`，构成 protocol gap | 主设计 `RH2-models-context-inspection.md` §9 已补；本策略文不展开实施细节 |
