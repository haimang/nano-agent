# Nano-Agent Trace Substrate Decision 功能簇设计

> 功能簇: `Trace Substrate Decision`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/plan-after-skeleton-reviewed-by-opus.md`
> - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
> - `docs/design/after-skeleton/P0-identifier-law.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

本阶段在真正铺开 trace-first observability 之前，必须先回答一个比“怎么打点”更底层的问题：

> **trace 的热写入、热恢复、冷归档、后续查询，分别落在哪个 substrate 上。**

当前 repo 的代码现实已经给出了很强的倾向：

- `@nano-agent/session-do-runtime` 的 checkpoint 明确以 `state.storage` 为当前 session actor 的热状态承载（`packages/session-do-runtime/src/checkpoint.ts:43-122`）。
- `@nano-agent/eval-observability` 已经实现了 `DoStorageTraceSink`，并采用 `tenants/{teamUuid}/trace/{sessionUuid}/{YYYY-MM-DD}.jsonl` 的 append-only JSONL 写法（`packages/eval-observability/src/sinks/do-storage.ts:1-194`）。
- `session-do-runtime` 的 `wrangler.jsonc` 当前只声明了 `SESSION_DO` binding（`packages/session-do-runtime/wrangler.jsonc:1-16`），而 `SessionRuntimeEnv` 虽然为 `R2_ARTIFACTS` / `KV_CONFIG` 预留了类型位，但没有任何 D1 binding reality（`packages/session-do-runtime/src/env.ts:14-34`）。
- `NacpRefKindSchema` 允许 `r2` / `kv` / `do-storage` / `d1`，说明协议层保留了多 substrate 空间，但不等于当前实现已经对这些 substrate 一视同仁（`packages/nacp-core/src/envelope.ts:185-211`）。

这意味着 Phase 1 的决策不能脱离代码现实空谈。它必须建立在“当前哪条路径已经最接近正确、最接近可恢复、最接近 DO actor locality”的事实上。

- **项目定位回顾**：nano-agent 是 Cloudflare-native、DO-centered、WebSocket-first 的 agent runtime；trace substrate 选择首先服务 runtime correctness，而不是服务 BI/报表。
- **本次讨论的前置共识**：
  - `trace_uuid` 是后续唯一 canonical trace identity。
  - 任何 accepted internal request 都必须最终落到 trace anchor 上；不能因为缺 trace 而让 runtime 崩溃。
  - 本阶段首先要保证 **热写入可靠、恢复可靠、session-local causal chain 清晰**。
  - `D1`、`R2`、`KV` 都可以是 future topology 的一部分，但它们承担的职责不必相同。
  - 本 memo 当前只冻结 **DO storage hot anchor + R2 cold archive + D1 deferred query substrate**；若未来有人想把 D1 提前拉回热路径，必须先提供单独 benchmark/investigation artifact，而不是重新口头讨论。
- **显式排除的讨论范围**：
  - 不讨论 billing / analytics warehouse
  - 不讨论跨租户 trace 查询 API
  - 不讨论 Logpush / Datadog / Grafana 集成
  - 不讨论 public observability API

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Trace Substrate Decision`
- **一句话定义**：它回答 nano-agent 的 trace/observability 在 Phase 1-2 应以哪个 Cloudflare substrate 作为**主热写入 substrate**、哪个作为**冷归档 substrate**、哪个明确**暂不承担主路径责任**。
- **边界描述**：**包含** D1 / DO storage / R2+KV 的对比、热/冷职责划分、最终推荐 decision；**不包含** D1 业务表设计、analytics schema、前端查询接口。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Hot Anchor Substrate** | 每次请求/turn/session 关键边界都能立即写入的热 substrate | 首先服务 correctness / recovery |
| **Durable Audit Substrate** | 能持久保留 append-only trace evidence 的 substrate | 不等于可高效查询 |
| **Cold Archive Substrate** | 长期归档、低成本保留的 substrate | 首先服务 transcript / audit export |
| **Query Substrate** | 用于结构化查询、聚合、筛选的 substrate | 可以晚于热 substrate 建设 |
| **Actor Locality** | 数据写入与当前 Session DO actor 尽量同地/同生命周期 | 这是 DO-centered 设计的关键 |
| **Trace Anchor** | 用来保证 trace_uuid 不丢失、可回溯、可重建的最小结构化记录 | 不要求承载全部 diagnostic detail |

### 1.2 参考调查报告

- `docs/investigation/codex-by-opus.md` — codex 在 rollout JSONL 与 trace context 上最强调“先有可回放证据，再谈更大平台”
- `docs/investigation/claude-code-by-opus.md` — claude-code 更像 rich telemetry platform，但它的事件队列与 deferred sink 也说明热路径必须先有可靠 sink
- `docs/investigation/mini-agent-by-opus.md` — mini-agent 的 plain-text local log 反证：没有 durable, queryable, recoverable substrate，后续能力都只能靠 grep 日志

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **Phase 1 决策门**。
- 它服务于：
  1. `trace-first-observability-foundation`
  2. `session-do-runtime`
  3. `storage-and-context-evidence-closure`
  4. 未来的 public API / data model 设计
- 它依赖：
  - 当前 `session-do-runtime` / `eval-observability` / `nacp-core` 的 substrate reality
  - owner 的 trace-first 与 UUID-only identity 决策
  - Cloudflare 的 DO / R2 / KV / D1 各自语义边界
- 它被谁依赖：
  - Phase 2 的 trace law / recovery design
  - Phase 3 的 session edge closure
  - Phase 6 的 storage evidence closure

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Trace-first Observability Foundation` | Decision -> Foundation | 强 | Foundation 必须建立在确定的 hot/cold substrate 上 |
| `Observability Layering` | 双向 | 强 | 分层策略决定不同层落在哪个 substrate |
| `Session Edge Closure` | Decision -> Session Edge | 强 | replay/resume/checkpoint 的热路径依赖 hot substrate |
| `Storage & Context Evidence Closure` | Decision -> Storage | 强 | 后续 placement evidence 需要基于此次 decision |
| `NACP-Core` | Decision -> Core | 中 | `NacpRef` 与 observability envelope 的 substrate 语义受其影响 |
| `Eval-Observability Package` | Decision -> Package | 强 | `DoStorageTraceSink` 是否继续成为主路径，取决于本决策 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Trace Substrate Decision` 是 **observability foundation 的物理基座决策**，负责 **确定 trace 的热写入、热恢复、冷归档与后续查询各自落在哪类 Cloudflare substrate 上**，对上游提供 **明确的主路径 substrate 选择**，对下游要求 **不要再把“热写入”“冷归档”“查询分析”混成同一个存储问题**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 把 D1 当作 v1 主热 trace substrate | 平台型系统常见做法 | 当前 repo 没有 D1 runtime reality，且 D1 更适合 query/index，不适合 DO actor 的最热 causal append | 可能 |
| 把 KV 当作 trace payload 主存储 | KV 常被误用为“什么都能放” | KV 不适合 append-heavy trace payload，也不适合 timeline reconstruction | 否 |
| 把 R2 当作唯一热写入 substrate | object store-first 做法 | R2 更适合 archive，不适合 session actor 的频繁细粒度热写 | 可能 |
| 一开始同时构建 DO + R2 + D1 三条全功能主路径 | 过度工程化路径 | 在 foundation 前会极大分散实现注意力 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Trace sink abstraction | `TraceSink.emit()/flush()` | 主实现为 `DoStorageTraceSink` | fan-out 到 D1 / Logpush |
| Archive seam | `R2 archive/export` | session end 或定期归档 | replay bundle / export job |
| Query seam | future `TraceQueryReader` / D1 indexer | 本阶段不进入主路径 | D1 索引、聚合、跨 session 查询 |
| NacpRef substrate kinds | `do-storage / r2 / d1 / kv` | 只冻结语义，不要求全部落地 | post-phase analytics / registry |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：Hot anchor/durable audit vs query analytics
- **解耦原因**：热路径需要 actor locality 与恢复可靠性；查询路径更关心索引与聚合。这是两个不同优化目标。
- **依赖边界**：Phase 1-2 先做 hot anchor/durable audit；D1 query 作为 future seam。

- **解耦对象**：Durable trace payload vs config registry
- **解耦原因**：`KV_CONFIG` 适合 warm config，不适合高频 trace payload。
- **依赖边界**：KV 只继续承担 config/shared manifest，不承担 trace JSONL 主体。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：trace 的主热写入 substrate 决策
- **聚合形式**：**DO storage as hot anchor + durable audit JSONL**, **R2 as cold archive**, **D1 deferred as query substrate**
- **为什么不能分散**：如果不同包各自假设主 substrate，最后会出现 replay 在 DO、trace 在 D1、archive 在 R2、debug 在 KV 的分裂现实，根本无法闭合。

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：plain-text local log，缺少真正的 runtime-local durable/query split。
- **亮点**：
  - 实作简单
  - 低认知负担
- **值得借鉴**：
  - 先把事件可靠写下来，再谈分析
- **不打算照抄的地方**：
  - 不依赖单机文件系统日志作为 trace substrate

### 4.2 codex 的做法

- **实现概要**：更接近“先有 JSONL rollout / trace context / replay evidence，再谈更大平台能力”。
- **亮点**：
  - JSONL 审计与 replay 非常强
  - W3C trace context 传播严谨
- **值得借鉴**：
  - 热路径首先服务 replay/recovery
  - 高价值 query 能力可以后置
- **不打算照抄的地方**：
  - 不复制其本地文件/SQLite 宿主前提

### 4.3 claude-code 的做法

- **实现概要**：rich telemetry + deferred sink + event queue，但宿主默认仍偏本地/服务侧混合平台。
- **亮点**：
  - 事件面成熟
  - sink 不 ready 时先排队，避免丢失
- **值得借鉴**：
  - 先保证热路径不丢事件
  - query/分析与热写入可以分离
- **不打算照抄的地方**：
  - 不一上来就进入 Datadog/多通道 telemetry 复杂度

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 热路径写入优先级 | 低 | 高 | 高 | 高 |
| durable replay 友好度 | 低 | 高 | 中高 | 高 |
| query substrate 中心性 | 低 | 中 | 高 | 中后置 |
| 本地宿主依赖 | 高 | 高 | 中 | 低 |
| 对 DO actor locality 的贴合 | 低 | 低 | 中 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] 明确 hot anchor substrate**：必须决定 trace_uuid anchor 与 session-local durable append 先落在哪。
- **[S2] 明确 cold archive substrate**：必须决定长期 transcript/audit archive 的物理落点。
- **[S3] 明确 D1 在本阶段的职责**：必须说清楚 D1 是主路径、辅路径，还是暂不进入主路径。
- **[S4] 明确 KV 不承担 trace payload**：否则后续 package 会再次误把 KV 当 append log 用。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] D1 表结构 / SQL 设计**：这属于下一层 implementation 设计。
- **[O2] 跨租户 trace 查询 API**：当前先保证正确写入与恢复。
- **[O3] 生产级 analytics pipeline**：当前不是 Logpush / BI 阶段。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| DO storage 热写入 | in-scope | 当前代码 reality 已经存在 |
| R2 冷归档 | in-scope | `SessionRuntimeEnv` 已显式预留，且 archive 角色清晰 |
| D1 主热路径 | out-of-scope（本阶段） | 当前无 runtime reality，且不适合 actor-local 最热 append |
| D1 future query/index | in-scope（方向） | 这是明确的 future seam，不是当前主路径 |
| KV trace payload | out-of-scope | 只保留 config / manifest 角色 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **DO storage 作为 hot anchor + durable audit 主 substrate**，而不是 **D1**
   - **为什么**：当前 session actor 就运行在 DO 里，`checkpoint` 与 `DoStorageTraceSink` 都已经自然落在 DO 语义上；actor-local append 与 hibernation restore 是现阶段最重要的正确性目标。
   - **我们接受的代价**：短期 query 能力较弱，需要 append + scan / index 辅助。
   - **未来重评条件**：当 trace foundation 稳定、需要大规模结构化查询时，再把 D1 引入为 query substrate。

2. **取舍 2**：我们选择 **R2 作为冷归档 substrate**，而不是 **让 DO storage 长期承载全部历史**
   - **为什么**：R2 更适合 transcript / archive / export bundles / 长期保留。
   - **我们接受的代价**：需要 archive seam 与 key policy。
   - **未来重评条件**：若 cold archive 规模不足以构成成本压力，可继续保持简单归档策略。

3. **取舍 3**：我们选择 **KV 不承载 trace payload**，而不是 **把 KV 也拉进 trace 主路径**
   - **为什么**：KV 适合 config/warm shared state，不适合 timeline reconstructable append log。
   - **我们接受的代价**：少了一个“看上去到处都能用”的简单桶。
   - **未来重评条件**：仅当某类极小、非序列化、非 append 的 trace metadata 适合 KV 时，才局部引入。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| DO storage 后续 query 成本升高 | 事件量显著上升 | timeline / filtering 成本上升 | 保持 D1 index seam 但不提前承担热路径 |
| archive seam 过晚 | 长 session / 多 session 历史堆积 | DO storage 膨胀 | 在 Phase 5/6 引入定期 R2 archive |
| 团队误把 D1“延后”理解成“放弃” | 只看结论不看职责拆分 | 后续 query 设计被忽略 | 在 decision 中明确 D1 是 **future query substrate**，不是被否定 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：立刻有一条与当前代码 reality 一致的主路径，不用一边写 foundation 一边猜底座。
- **对 nano-agent 的长期演进**：先把热路径与恢复路径做对，再把查询层后置，整体演进更稳。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：稳定性直接受益最大；上下文与 Skill 的审计/回放也会建立在这条 substrate 线上。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Hot Anchor Decision | 冻结热写入 substrate 选择 | 所有 Phase 2 设计都以同一 hot substrate 为前提 |
| F2 | Archive Decision | 冻结冷归档 substrate 角色 | transcript/audit archive 有明确去处 |
| F3 | Query Deferral Policy | 明确 D1 的当前与未来职责 | 不再把 D1 误当 v1 热路径 |
| F4 | KV Exclusion Policy | 明确 KV 不承担 trace payload | package 不再用 KV 写 append trace |

### 7.2 详细阐述

#### F1: `Hot Anchor Decision`

- **输入**：当前 `SessionCheckpoint` reality、`DoStorageTraceSink` reality、wrangler bindings reality
- **输出**：DO storage 作为 hot anchor/durable audit 主 substrate 的决策
- **主要调用者**：Phase 2 foundation、Phase 3 session edge
- **核心逻辑**：Session actor 内的最热 causal append 与 restore 必须优先贴近 DO lifecycle，而不是先贴近 query layer。
- **边界情况**：
  - 这不意味着所有事件都永久只在 DO 里
  - 只意味着 Phase 2 的主路径先在 DO 上闭合
- **一句话收口目标**：✅ **`Phase 2 的 trace foundation 不再需要再猜“先写 D1 还是先写 DO”`**

#### F2: `Archive Decision`

- **输入**：`SessionRuntimeEnv.R2_ARTIFACTS` 预留、transcript/archive 需求
- **输出**：R2 作为冷归档 substrate 的决策
- **主要调用者**：Phase 5/6 runtime verification 与 storage closure
- **核心逻辑**：高频热写在 DO；冷 archive 在 session end / periodic export 时落 R2。
- **边界情况**：
  - cold archive 不负责热恢复
- **一句话收口目标**：✅ **`长期保留和热恢复不再混成同一问题`**

#### F3: `Query Deferral Policy`

- **输入**：当前无 D1 runtime binding reality、未来需要查询/聚合的事实
- **输出**：D1 作为 future query/index substrate 的定位
- **主要调用者**：下一阶段 API/data model 设计
- **核心逻辑**：不否定 D1，而是把它从 v1 热路径里拿出来，避免 foundation 被 query 目标绑架。
- **进入条件**：若未来要提升 D1 地位，必须先提交一份专门 investigation/benchmark memo，对比 DO append/restore 与 D1 write/query 在 nano-agent trace 负载下的成本与恢复特性。
- **边界情况**：
  - 若 owner 明确要求更早做 D1，也应只做二级索引/镜像，不替代 DO hot anchor
- **一句话收口目标**：✅ **`D1 的角色从“模糊的可能底座”变成“明确的 future query seam”`**

#### F4: `KV Exclusion Policy`

- **输入**：当前 `KV_CONFIG` 的 warm config 角色、KV append 不友好
- **输出**：KV 不承担 trace payload 的政策
- **主要调用者**：runtime packages、future registry packages
- **核心逻辑**：KV 继续做 config/shared metadata，不进入 trace JSONL / timeline / transcript 主体。
- **边界情况**：
  - 极小规模的 summary marker 可未来单独讨论，但不属于本阶段主路径
- **一句话收口目标**：✅ **`KV 不再被误用为 trace append substrate`**

### 7.3 非功能性要求

- **性能目标**：热写入路径优先小对象、append-like、actor-local。
- **可观测性要求**：每个 substrate 决策都要映射到清晰职责，而不是“都能用”。
- **稳定性要求**：hot path 必须优先支持 hibernation-safe restore。
- **测试覆盖要求**：后续至少要验证 DO storage new-instance timeline reconstruction、R2 archive seam、D1 未进入热路径的边界。
- **验证门槛**：任何试图把 D1 从 deferred query seam 升格为主路径的提案，都必须附带独立 benchmark artifact；没有该 artifact，当前结论保持不变。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/mini-agent/mini_agent/logger.py:19-41` | 本地 plain-text run log | 证明“先写日志再说”是早期可行路径 | 但完全不适合 Cloudflare actor runtime |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:19-47` | 当前 span trace context / trace id 提取 | 说明 trace hot path首先要可持续传播 | 比 query 平台更基础 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/utils/telemetry/events.ts:21-75` | deferred sink + event sequence | sink 不 ready 时也不能丢热事件 | 适合吸收到 foundation，而非直接照抄平台 |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/session-do-runtime/src/env.ts:14-34` | R2/KV 有类型位，但 D1 没有任何 runtime reality | 说明不能凭未来想象让 D1 接管当前主路径 |
| `packages/nacp-core/src/envelope.ts:185-211` | 协议层允许多 substrate kind，但没有规定主路径职责 | Phase 1 必须补上职责划分 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Trace Substrate Decision` 不是在讨论“哪个数据库更强”，而是在讨论 nano-agent 当前最应该把可靠性压在哪个物理事实之上。基于现有代码现实，DO storage 已经同时承担 session checkpoint 与 durable trace append 两条最接近真实的路径；R2 已是自然的冷 archive 位置；D1 则更像一个尚未真正接线、但未来非常合理的 query/index substrate。这个决策的核心价值，是避免 observability foundation 从第一天就被 analytics 目标绑架。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | DO-centered runtime 非常适合 DO hot anchor |
| 第一版实现的性价比 | 5 | 最大化复用当前代码 reality |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | 稳定性的地基性决策 |
| 对开发者自己的日用友好度 | 4 | 少了“全都做”的幻觉，多了明确边界 |
| 风险可控程度 | 4 | 主要风险是 future query 诉求上升，但已留 D1 seam |
| **综合价值** | **5** | **建议正式采用：DO storage hot anchor + R2 archive + D1 deferred query substrate** |

### 9.3 下一步行动

- [x] **决策确认**：业主已通过 AX-QNA Q5 确认 substrate 方向（conditional yes）；A2 benchmark artifact 把它升格为 `package-local-isolate evidence-backed yes`（remote Q5 p50/p99 closure 仍保留给 A6 deployment dry-run）。
- [x] **Benchmark artifact**：`docs/eval/after-skeleton-trace-substrate-benchmark.md` 已产出，配套 runner `packages/eval-observability/scripts/trace-substrate-benchmark.ts` 与回归测试 `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`。A2-A3 review R2 已把 `BENCH_THRESHOLDS` 扩为 `emitP50MsMax = 20 / emitP99MsMax = 100`，并新增 listless (`_index`-only) readback probe。
- [x] **Q20 gate 落地**：D1 升格前必须先交独立 `trace-substrate-benchmark-vN.md` memo，并满足该 memo 的 5 项必备字段；本 memo 的 §4 / §5 已写入此口径。
- [x] **关联 Issue / PR**：A3 / P2 foundation 已按 DO storage hot path 推进；Finding F1 的 `maxBufferSize ≥ events-per-turn` + turn-boundary flush sizing policy 已在 A3 执行期间体现于 sink 行为。
- [ ] **待深入调查的子问题**：
  - [ ] R2 archive 的 flush/compaction 触发条件（A7 / P6 主线）
  - [ ] future D1 index 的最小 schema 何时进入议程（须满足 Q20 gate 才启动）
  - [ ] sink-level append-only-without-RMW 升级（属于后续 sink-level memo，不属于 substrate decision）
- [x] **需要同步更新的其他设计文档**：已同步
  - `A3-trace-first-observability-foundation.md`
  - `P2-observability-layering.md`
  - 跨阶段 handoff：真实 DO p50/p99 closure 保留给 A6 `deployment-dry-run-and-real-boundary-verification.md`

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：D1 是否应直接成为 v1 主 trace substrate
  - **A 方观点**：D1 更适合“日志查询”
  - **B 方观点**：当前最重要的是 actor-local hot write / restore
  - **最终共识**：先用 DO storage 做 hot anchor 与 durable audit，D1 后置为 query/index substrate

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
