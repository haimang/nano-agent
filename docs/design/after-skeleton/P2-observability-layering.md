# Nano-Agent Observability Layering 功能簇设计

> 功能簇: `Observability Layering`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

当前仓里已经有一套三分法现实：

- `classifyEvent()` 把事件分成 `live` / `durable-audit` / `durable-transcript`（`packages/eval-observability/src/classification.ts:13-72`）
- `DurablePromotionRegistry` 进一步描述某些 event kind 如何被 durable 化、以 full/summary/sample 哪种粒度落盘（`packages/eval-observability/src/durable-promotion-registry.ts:15-203`）
- `SessionInspector` 处理 live session stream，`SessionTimeline` 处理 durable timeline，`DoStorageTraceSink` 处理 append-only 持久化（`packages/eval-observability/src/inspector.ts:1-147`, `timeline.ts:17-82`, `sinks/do-storage.ts:49-194`）

但在 post-skeleton 这个阶段，我们还需要一个更高一层的 **conceptual layering memo**，把这些实现细节重新组织成 owner 真正关心的三层模型：

1. **Anchor Layer**
2. **Durable Evidence Layer**
3. **Diagnostic Layer**

它的价值不是替代现有 `TraceLayer` enum，而是解释：

> **哪些信号必须永远有、哪些应该落盘、哪些只是现场调试信号。**

- **项目定位回顾**：nano-agent 的目标不是“搜集尽可能多的日志”，而是用最少但最稳定的层级，把 runtime 变得可恢复、可回放、可解释。
- **本次讨论的前置共识**：
  - conceptual layering 与当前 package 内 `live/durable-audit/durable-transcript` 不冲突，而是其上位解释层。
  - Anchor 层首先服务 trace survival 与 recovery。
  - Durable 层首先服务 audit / transcript / replay / storage evidence。
  - Diagnostic 层首先服务 live debug、噪声隔离与问题定位。
  - 这份 memo **不替代** 当前 `TraceLayer` enum / classification reality；它只提供上位解释，并要求实现层保持映射清晰、集合互斥。
- **显式排除的讨论范围**：
  - 不讨论具体 dashboard
  - 不讨论 analytics query model
  - 不讨论外部 exporter

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Observability Layering`
- **一句话定义**：它是 trace-first foundation 的配套分层备忘录，用来定义 nano-agent 的观测信号应该如何分成 Anchor、Durable、Diagnostic 三个层级，以及这些层级之间如何映射到当前实现的 event taxonomy。
- **边界描述**：**包含** 三层定义、与当前 `TraceLayer` 的映射、layer responsibilities、promotion rules；**不包含** query API、dashboard、DDL。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Anchor Layer** | 最小且必须存在的 trace 锚点层 | 先保证 trace survival |
| **Durable Evidence Layer** | 需要持久保留的 replay/audit/transcript 证据层 | 先保证可追责、可回放 |
| **Diagnostic Layer** | 高频、现场、可丢弃或可采样的诊断层 | 先保证 live debug |
| **Promotion** | 事件从 live/diagnostic 升格到 durable 的规则 | 由 registry 决定 |
| **Summarization** | durable 时只保留摘要而非全量 payload | 例如 tool result summary |

### 1.2 参考调查报告

- `docs/investigation/codex-by-opus.md` — rollout/evidence 和 trace context 的分层意识最强
- `docs/investigation/claude-code-by-opus.md` — live telemetry 与 durable transcript 天然不是同一层
- `docs/investigation/mini-agent-by-opus.md` — 没有 layering 时，一切都退化成单一日志流

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **trace-first foundation 的说明书与裁判尺**。
- 它服务于：
  1. `eval-observability`
  2. `session-do-runtime`
  3. future public API / docs / review
- 它依赖：
  - `A3-trace-first-observability-foundation.md`
  - 当前 `classification` / `durable-promotion-registry` / `inspector` / `timeline` reality
- 它被谁依赖：
  - 后续所有 event kind 增删判断
  - PR review 中对“该不该 durable”的判定
  - storage evidence / archive 策略

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Trace-first Observability Foundation` | Layering -> Foundation | 强 | layer memo 是 foundation 的配套准则 |
| `Eval-Observability` | 双向 | 强 | package 当前三分法需被本 memo 解释和约束 |
| `Trace Substrate Decision` | Layering -> Substrate | 中 | 不同层会落到不同 substrate |
| `Session Edge Closure` | Layering -> Session | 中 | live stream 与 durable replay 的边界受其约束 |
| `Storage & Context Evidence Closure` | Layering -> Storage | 强 | cold archive 与 durable evidence 强耦合 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Observability Layering` 是 **trace 信号分层说明书**，负责 **把 Anchor / Durable / Diagnostic 三层的责任讲清楚**，对上游提供 **“为什么这个事件该落在哪层”的统一裁判标准**，对下游要求 **不要把所有事件都当成同一种 observability 信号来处理**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 把所有 live event 都 durable 化 | 富 telemetry 平台 | 写放大严重，也会削弱真正高价值 evidence 的可读性 | 否 |
| 把 anchor 与 durable 完全合并成一个概念 | 简化认知的冲动 | 会让“必须存在的最小锚点”和“应该保留的证据”混淆 | 否 |
| 把 transcript 当作全部 durable truth | 对话系统常见误区 | transcript 不能替代 audit evidence | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| `TraceLayer` enum | `live / durable-audit / durable-transcript` | 保持当前 reality | 未来可显式增 `anchor`/`diagnostic` 子层 |
| Promotion registry | `DurablePromotionRegistry` | 控制 durable granularity | future sampling / archival policy |
| Inspector vs timeline seam | `SessionInspector` / `SessionTimeline` | live 与 durable 分读 | future joined view / compare tool |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：Anchor Layer vs Diagnostic Layer
- **解耦原因**：前者必须稳定存在，后者可以高频、可丢弃、可采样。
- **依赖边界**：不能因为 diagnostic 丢失而失去 trace anchor。

- **解耦对象**：Durable transcript vs Durable audit
- **解耦原因**：用户可见对话记录与内部 runtime evidence 不是同一类对象。
- **依赖边界**：transcript 是 durable evidence 的子集，不是其替代。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：什么叫 anchor、什么叫 durable、什么叫 diagnostic
- **聚合形式**：由本 memo 统一定义，再由 `classification` 与 `registry` 去映射
- **为什么不能分散**：否则每个包都可能重新发明自己的“durable”标准。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：单层 append-only local log。
- **亮点**：
  - 没有分层，理解简单
- **值得借鉴**：
  - 早期阶段保持事件记录动作本身简单
- **不打算照抄的地方**：
  - 不继续停留在“无 layering”的阶段

### 4.2 codex 的做法

- **实现概要**：trace/replay/rollout 更接近 anchor+evidence 的分层思维。
- **亮点**：
  - replay 与 trace continuation 非常清晰
- **值得借鉴**：
  - structural boundary 与 diagnostic detail 要区分
- **不打算照抄的地方**：
  - 不复制其完整本地 runtime 体系

### 4.3 claude-code 的做法

- **实现概要**：live telemetry 与 transcript/持久数据天然分层。
- **亮点**：
  - `event.sequence`、deferred sink、cache break attribution 都说明 layer 间责任不同
- **值得借鉴**：
  - live 不是 durable，durable 也不是 transcript
- **不打算照抄的地方**：
  - 不照抄其极大事件面与外部 telemetry 依赖

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 是否有显式 layering | 低 | 中高 | 高 | 高 |
| live/durable 区分 | 低 | 中高 | 高 | 高 |
| transcript 与 audit 区分 | 低 | 中 | 高 | 高 |
| 对 replay 友好度 | 低 | 高 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] 定义 Anchor / Durable / Diagnostic 三层**
- **[S2] 给出现有 `TraceLayer` 与三层的映射**
- **[S3] 明确哪些 event kind 默认属于哪层**
- **[S4] 明确 promotion 与 summarization 规则**

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] 为每个 layer 单独造完整新枚举体系**
- **[O2] query API / dashboard**
- **[O3] 外部 APM/exporter**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `turn.begin` / `turn.end` | anchor + durable | 既是结构锚点，也是 durable replay 分界 |
| `assistant.message` / `user.message` | durable | 更偏 transcript than anchor |
| `llm.delta` / `tool.call.progress` | diagnostic | 高频 live 调试信号 |
| `api.error` | durable | 属于 incident evidence，不是 transcript |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **三层 conceptual model** 而不是 **只保留当前 package 的三种 enum 名字**
   - **为什么**：conceptual model 服务设计与评审，enum 服务实现；两者解决的问题不同。
   - **我们接受的代价**：多一层解释成本。
   - **未来重评条件**：如果将来实现枚举能完整表达 conceptual layering，可合并表达。

2. **取舍 2**：我们选择 **Anchor Layer 是最小层** 而不是 **让 anchor 承担全部 durable payload**
   - **为什么**：anchor 的任务是 survival 与 recovery，不是把所有 evidence 都写进最热路径。
   - **我们接受的代价**：需要区分 anchor 与 durable evidence。
   - **未来重评条件**：无；这是分层的根本意义。

3. **取舍 3**：我们选择 **Diagnostic 可以丢，但 Durable 不可丢** 而不是 **一视同仁**
   - **为什么**：高频 diagnostic 如果全量 durable，会牺牲性能与信噪比。
   - **我们接受的代价**：某些 live 现场信息无法永久保留。
   - **未来重评条件**：仅在确有必要时对特定 diagnostic 事件做 sampled durable promotion。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| 三层与当前 `TraceLayer` 被误读为冲突 | 文档解释不清 | 实现团队混乱 | 在本 memo 中明确“conceptual > implementation mapping” |
| anchor 被做得过厚 | 把全部 detail 推进最热层 | 写放大上升 | anchor 只保留最小恢复事实 |
| diagnostic 被做得过薄 | live debug 信息不足 | 排查效率下降 | 对高价值 diagnostic 保留 sequence/timestamp/body basics |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：评审时终于能回答“这个事件到底该不该落盘”。
- **对 nano-agent 的长期演进**：后续 event taxonomy 能在一个清晰分层框架里增长。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性提升最大；context/skill 的 evidence 也因此更易解释。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Three-Layer Model | 定义 Anchor / Durable / Diagnostic | 任何信号都能被清楚归层 |
| F2 | Mapping Memo | 映射当前 `TraceLayer` reality | conceptual 与 implementation 不再漂移 |
| F3 | Promotion Rules | 明确何时 durable、何时 summary、何时 sample | promotion 不再拍脑袋 |

### 7.2 详细阐述

#### F1: `Three-Layer Model`

- **输入**：当前 event taxonomy
- **输出**：三层定义
- **主要调用者**：foundation、reviewers、runtime implementers
- **核心逻辑**：
  - **Anchor**：最小结构事实，如 trace_uuid/session_uuid/turn_uuid 边界
  - **Durable**：需要长期保留的 audit/transcript/placement evidence
  - **Diagnostic**：live、ephemeral、高频、可采样信号
- **一句话收口目标**：✅ **`观测信号不再只有“写了”或“没写”两种状态`**

#### F2: `Mapping Memo`

- **输入**：`classifyEvent()` 与 `DurablePromotionRegistry`
- **输出**：当前实现映射
- **主要调用者**：`eval-observability`
- **核心逻辑**：
  - current `live` 主要落在 **Diagnostic**
  - current `durable-audit` 同时覆盖 **Anchor + Durable**
  - current `durable-transcript` 是 **Durable** 的用户可见子集
  - conceptual layering 不能被拿来为实现层 overlap 漂移辩护；`classification` 与 `DurablePromotionRegistry` 仍应保持集合互斥、职责单一
- **一句话收口目标**：✅ **`现有代码 reality 与 conceptual layering 能互相解释`**

#### F3: `Promotion Rules`

- **输入**：event kinds + registry
- **输出**：默认 promotion 原则
- **主要调用者**：observability foundation、future event reviewers
- **核心逻辑**：
  - 结构边界事件默认 durable
  - 用户对话事件 durable transcript
  - 高频 progress 默认 diagnostic only
  - 当 diagnostic 对 replay 或 incident 解释非常关键时，再通过 registry promote
- **一句话收口目标**：✅ **`新增 event kind 时，有固定标准决定它该去哪层`**

### 7.3 非功能性要求

- **性能目标**：Diagnostic 层默认不写重 durable。
- **可观测性要求**：Anchor/Durable/Diagnostic 的边界必须可被解释。
- **稳定性要求**：layering 一旦冻结，不随单个包 convenience 轻易改变。
- **测试覆盖要求**：至少需要 layer drift guard 与 promotion drift guard。
- **实现纪律要求**：若 `durable-audit` / `durable-transcript` / `live` 的实现集合发生重叠或歧义，应先修实现与 mapping，再调整 memo，不允许靠 prose 把 bug 解释成 feature。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/logger.py:122-157` | Tool result 单层写日志 | 证明无 layering 时一切都混在一起 | 正好作为反例 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:72-88` | trace header -> context | 结构锚点与诊断细节应分层处理 | continuation 比 query 更基础 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/telemetry/events.ts:42-74` | live event telemetry | 典型 diagnostic/live 层 |
| `context/claude-code/bridge/sessionRunner.ts:107-199` | live activity extraction | 说明 live observation 与 durable transcript 并非同层 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/eval-observability/src/classification.ts:54-72` | 当前实现只有 `live/durable-*`，若不补 conceptual memo，容易让 anchor 消失在 durable-audit 中 | 需要上位分层解释 |
| `packages/eval-observability/src/inspector.ts:93-119` | live inspector 专注实时事件，不能被误解为 durable truth | 需要明确它属于 Diagnostic |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Observability Layering` 不是一份“再造一套 event enum”的设计，而是一份认知收敛 memo。它的作用是把当前 `eval-observability` 已经成形的实现三分法，解释成一个更适合架构治理的三层模型：Anchor 保命，Durable 存证，Diagnostic 看现场。这样后续任何新增事件、archive 决策、replay 讨论，都有一个统一的语言。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 4 | 是 foundation 的支撑 memo，不是主设计本体 |
| 第一版实现的性价比 | 5 | 成本小，但治理收益很高 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 4 | 为后续 event growth 提供统一分层语言 |
| 对开发者自己的日用友好度 | 5 | 大幅减少“该不该 durable”的争论 |
| 风险可控程度 | 5 | 主要是解释与对齐，风险很低 |
| **综合价值** | **5** | **应作为 Phase 2 foundation 的配套 memo 保留** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 Anchor / Durable / Diagnostic 三层口径。
- [ ] **关联 Issue / PR**：让 `TraceEvent`、`classification`、`registry` 的注释与 README 一致。
- [ ] **待深入调查的子问题**：
  - [ ] 是否在 future `TraceLayer` enum 中显式引入 `anchor`
- [ ] **需要更新的其他设计文档**：
  - `A3-trace-first-observability-foundation.md`
  - `A7-storage-and-context-evidence-closure.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
