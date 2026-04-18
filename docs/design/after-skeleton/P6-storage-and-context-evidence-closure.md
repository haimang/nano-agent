# Nano-Agent Storage and Context Evidence Closure 功能簇设计

> 功能簇: `Storage and Context Evidence Closure`
> 讨论日期: `2026-04-17`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P2-observability-layering.md`
> - `docs/design/after-nacp/workspace-context-artifacts-by-GPT.md`
> - `docs/design/after-nacp/storage-topology-by-opus.md`
> - `docs/design/after-nacp/eval-observability-by-opus.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

Phase 1-5 做完之后，nano-agent 会拥有：

1. 一个关于 substrate 的明确主张（DO storage hot anchor / R2 archive / D1 deferred）
2. 一个 trace-first observability foundation
3. 一个闭合的 session edge
4. 一套 external seam 与 deploy-shaped verification

但这还不等于我们已经真正回答了 owner 最关心的问题之一：

> **上下文究竟是怎样被装配、裁剪、提升、归档、恢复的；而这些行为又是否真的得到了证据支撑。**

当前代码现实其实已经埋好了大量证据 seam：

- `StoragePlacementLog` 已能记录 per-operation 的 storage placement（`packages/eval-observability/src/placement-log.ts:10-81`）。
- `EvidenceSignal` 与 `CalibrationHint` 已经定义了 evidence-driven calibration vocabulary（`packages/storage-topology/src/evidence.ts:27-110`）。
- `PLACEMENT_HYPOTHESES` 已明确所有 placement 都只是 provisional，必须等待 evidence 升格（`packages/storage-topology/src/placement.ts:98-208`）。
- `ContextAssembler` 已返回 `assembled / totalTokens / truncated / orderApplied`，说明 context assembly 已具备可观测输出面（`packages/workspace-context-artifacts/src/context-assembler.ts:34-120`）。
- `CompactBoundaryManager` 已有 request/response mirror、split point heuristic、boundary record（`packages/workspace-context-artifacts/src/compact-boundary.ts:31-177`）。
- `WorkspaceSnapshotBuilder` 已不再返回空壳，而是真正读取 mount configs、file index、artifact refs、context layers（`packages/workspace-context-artifacts/src/snapshot.ts:67-171`）。
- `DoStorageTraceSink` 已能把 durable evidence 写入 tenant-scoped JSONL timeline（`packages/eval-observability/src/sinks/do-storage.ts:1-194`）。

所以 Phase 6 的任务不是重新设计 storage topology，而是：

> **让 storage / context / compact / artifact 这些行为真正持续地产生 evidence，并把 provisional hypothesis 收敛为 evidence-backed judgement。**

- **项目定位回顾**：nano-agent 最长期的差异化方向之一就是 context management；如果没有 evidence，所谓“上下文管理”就只会停留在理念层。
- **本次讨论的前置共识**：
  - DDL / D1 仍然不是第一步；Phase 6 先做 evidence closure。
  - context assembly、artifact promotion、compact boundary、snapshot/restore 都必须进入 trace/evidence 面。
  - live stream 不等于 durable evidence；transcript 也不等于 storage/context evidence。
  - 所有 evidence 仍需服从 `trace_uuid`、tenant namespace、audience/redaction law。
  - Phase 6 的主任务其实是 **instrumentation + evidence closure**：当前类型与 vocabulary 已出现，但大量 runtime emitters 仍需真正接入主路径。
  - P6 的 calibration verdict 用来判断 **hypothesis status**；它不是 PX 里 E0-E3 那种 **capability maturity** 分级，这两套词不能混用。
- **显式排除的讨论范围**：
  - 不讨论 D1 query schema
  - 不讨论 semantic retrieval / embedding index
  - 不讨论完整 compact 算法本体
  - 不讨论 R2/KV/DO 的完整生产适配器实现细节

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Storage and Context Evidence Closure`
- **一句话定义**：它负责把 nano-agent 的 storage placement、context assembly、compact lifecycle、artifact lifecycle、workspace snapshot/restore 这些关键行为变成可持续采集、可回放、可校准的 evidence，而不是停留在 provisional design hypothesis。
- **边界描述**：**包含** placement evidence、context assembly evidence、compact evidence、artifact evidence、snapshot evidence、calibration closure rules；**不包含** D1 schema、完整 archive scheduler、frontend context UI、semantic index。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| **Placement Evidence** | 某条数据真实落在哪个 storage backend、被怎样读写的证据 | 对应 `StoragePlacementLog` |
| **Context Assembly Evidence** | 一次上下文装配实际选了哪些 layer、按什么顺序、删了什么 | 不是“理论上的 layer order” |
| **Compact Evidence** | 一次 compact 的输入、split point、summary ref、tokens before/after、boundary record | 是正式生命周期证据 |
| **Artifact Lifecycle Evidence** | result/attachment 从 inline → prepared → promoted → archived 的证据 | 贯通 workspace 与 storage |
| **Snapshot Evidence** | 某次 checkpoint/restore 实际包含哪些 workspace/context fragment | 不是抽象接口说明 |
| **Evidence-Backed** | 某个 provisional hypothesis 已被足够 evidence 支撑 | 与“设计上觉得合理”不同 |

### 1.2 参考调查报告

- `context/just-bash/src/fs/mountable-fs/mountable-fs.ts` — mount-based namespace 是可解释 workspace 的基础（`49-220`）
- `context/claude-code/services/compact/compact.ts` — compact 的 strip / reinject 必须是正式、可解释、可重放的 lifecycle（`133-200`, `202-260`）
- `context/claude-code/utils/toolResultStorage.ts` — large tool result 持久化为引用，而不是无脑截断，这是 artifact evidence 的关键前例（`130-199`）
- `context/codex/codex-rs/otel/src/trace_context.rs` — evidence 必须仍然能够挂回 trace continuation（`19-88`）
- `context/claude-code/services/analytics/index.ts` — early events 先入队，说明 evidence 不能因为 sink 尚未 attach 而丢失（`80-164`）

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 这个功能簇在整体架构里扮演 **从 provisional storage/context design 走向 evidence-backed closure 的收口层**。
- 它服务于：
  1. `workspace-context-artifacts`
  2. `storage-topology`
  3. `eval-observability`
  4. `session-do-runtime`
  5. future DDL / API / frontend decisions
- 它依赖：
  - Phase 5 deploy-shaped verification
  - trace-first observability
  - tenant-scoped ref and storage laws
  - current workspace/storage/eval seams
- 它被谁依赖：
  - 后续 context management 迭代
  - storage threshold freeze
  - future DDL / query / archive decisions

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| `Trace-first Observability Foundation` | Evidence -> Trace | 强 | 所有 evidence 都必须挂 trace_uuid |
| `Observability Layering` | Evidence -> Layering | 强 | placement/context/compact evidence 属于 durable evidence，不是 live noise |
| `Session Edge Closure` | Session -> Evidence | 中 | session resume/checkpoint 是 snapshot evidence 入口 |
| `External Seam Closure` | External -> Evidence | 中 | remote capability/provider 输出会影响 artifact/placement evidence |
| `Workspace / Context / Artifacts` | 双向 | 强 | context assembly、compact、snapshot 都在这里 |
| `Storage Topology` | 双向 | 强 | hypotheses 只有被 evidence 支撑后才能收口 |
| `Eval-Observability` | 双向 | 强 | trace sink / timeline / placement log 是 evidence 宿主 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Storage and Context Evidence Closure` 是 **storage/context 设计的证据收口层**，负责 **把 placement、context assembly、compact、artifact、snapshot 这些行为转换成可校准、可回放、可审阅的 durable evidence**，对上游提供 **evidence-backed verdict**，对下游要求 **不要再拿 provisional hypothesis 当最终真相**。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 一上来冻结最终 byte thresholds | 过早精确化冲动 | 当前 `placement.ts` 明确所有 placement 先是 provisional | 否 |
| 把所有 evidence 混成 generic trace detail blob | logging 直觉 | 之后无法回答“是 placement 问题还是 compact 问题” | 否 |
| 只看 transcript / user-visible record | 对话产品直觉 | transcript 无法解释 storage/context 内部决策 | 否 |
| 先建 D1 表再补 evidence | database-first 冲动 | 与本阶段目标相反 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段) | 第一版行为 | 未来可能的演进方向 |
|--------|---------------------------------------|------------|---------------------|
| Placement evidence | `StoragePlacementLog` + `placementLogToEvidence` | 先记录并转校准信号 | future D1 / query API |
| Context evidence | `ContextAssembler` result + audit mapping | 记录 orderApplied / truncated / tokens | future richer token attribution |
| Compact evidence | `CompactBoundaryRecord` + trace event mapping | 记录 split/before/after/ref | future compaction quality analysis |
| Snapshot evidence | `WorkspaceSnapshotFragment` + checkpoint attribution | 记录 fragment shape | future restore diff |
| Artifact evidence | `ArtifactRef` / `PreparedArtifactRef` lifecycle records | 记录 promotion/prepared/archive | future OCR/summary pipeline |

### 3.3 完全解耦点（哪里必须独立）

- **Placement evidence 与 trace timeline**
  - **解耦原因**：placement evidence 是 trace 的一个子域，不应把所有 trace 都当成 placement log。
  - **依赖边界**：placement log 保留自己的 typed vocabulary，再由 eval-observability 统一持久化。

- **Context assembly evidence 与 compact evidence**
  - **解耦原因**：装配上下文与压缩上下文是两个不同决策过程。
  - **依赖边界**：一次 turn 可以只有 assembly evidence，没有 compact；也可能 compact 发生但 assembly 结果未变化。

- **Artifact lifecycle evidence 与 transcript**
  - **解耦原因**：artifact 的 promotion/prepared/archive 过程大多不是 transcript 关注的内容。
  - **依赖边界**：transcript 最多保留 preview/ref，不承载全量 artifact evidence。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 placement observation 都进统一 `StoragePlacementLog` vocabulary**
- **所有 context assembly verdict 都进统一 assembly evidence shape**
- **所有 compact outcome 都进统一 compact evidence shape**
- **所有 artifact lifecycle transitions 都进统一 ref-based evidence shape**
- **所有 calibration verdict 都进统一 evidence-backed / provisional judgement**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：更接近“读写文件 + 摘要消息 + log”，缺少真正的 storage/context evidence 分层。
- **亮点**：
  - 最小路径清楚
- **值得借鉴**：
  - 不要把 evidence 面做得比系统本体更复杂
- **不打算照抄的地方**：
  - 不停留在“人肉看日志”层面

### 4.2 codex 的做法

- **实现概要**：更强调 trace continuation、rollout/replay、session/turn state 分层。
- **亮点**：
  - evidence 能挂回 trace
  - replay 能反推某次决策发生时的上下文
- **值得借鉴**：
  - storage/context evidence 必须能回到 trace/timeline 上
- **不打算照抄的地方**：
  - 不复制其本地 FS / SQLite 背景前提

### 4.3 claude-code 的做法

- **实现概要**：在 compact、tool result persistence、attachment reinjection、analytics queue 上非常成熟。
- **亮点**：
  - compact 不是黑盒
  - 大结果替 ref 的 lifecycle 很清楚
  - early analytics events 不丢
- **值得借鉴**：
  - evidence closure 要覆盖 compact 与 large-result replacement 这类真实高价值边界
- **不打算照抄的地方**：
  - 不照抄其本地磁盘 transcript / output layout

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| placement evidence 显式度 | 低 | 中 | 中 | 高 |
| compact lifecycle 可解释性 | 低 | 中高 | 高 | 高 |
| artifact/result replacement 成熟度 | 低 | 中 | 高 | 高 |
| trace 关联度 | 低 | 高 | 中高 | 高 |
| 对 Worker/DO/storage 分层适配 | 低 | 低 | 低 | 高 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent 第一版要做）

- **[S1] Placement evidence closure**
  - 必须让真实读写/promotion/demotion 行为持续写入 placement evidence，而不是只保留 hypothesis table。

- **[S2] Context assembly evidence**
  - 必须记录某次 LLM/context assembly 实际采用了哪些 layer、顺序如何、是否截断。

- **[S3] Compact evidence**
  - 必须记录 compact request/response、split point、summary ref、tokens before/after、boundary reinjection。

- **[S4] Artifact lifecycle evidence**
  - 必须记录 large result / attachment / prepared artifact 的 promotion、prepared、archive、ref publication。

- **[S5] Snapshot / restore evidence**
  - 必须记录 checkpoint 里到底有什么 workspace/context fragment，restore 后又恢复了什么。

- **[S6] Calibration and verdict rules**
  - 必须规定何时一个 provisional placement/context policy 可以被认为 evidence-backed。

### 5.2 Out-of-Scope（nano-agent 第一版不做）

- **[O1] D1 query schema**
- **[O2] semantic retrieval / embeddings evidence**
- **[O3] 完整 compaction quality benchmark**
- **[O4] frontend evidence explorer UI**
- **[O5] automated archive lifecycle manager**

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| `StoragePlacementLog` 只存在于测试 | out-of-scope 现状，需要补齐 | Phase 6 就是把它带进真实 runtime |
| `ContextAssembler` 返回 `truncated` / `orderApplied` | in-scope | 这些就是 context evidence 的天然起点 |
| `CompactBoundaryRecord` 只用于 snapshot | out-of-scope 现状，需要扩展 | Phase 6 要把它升格为 trace/evidence 记录 |
| transcript export | 不是主要 evidence | 它是 user-facing record，不替代 storage/context evidence |
| `PreparedArtifactRef` 仍是 stub pipeline | in-scope，但只要求 evidence closure | 先记录 decision 与 ref，再谈复杂处理器 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **evidence-first closure** 而不是 **先冻结最终阈值与最终 policy**
   - **为什么**：当前 `placement.ts`、`storage-topology` 已明确 everything starts provisional；没有 evidence 的冻结只会制造下一轮返工。
   - **我们接受的代价**：短期内文档里会保留一些“待 evidence 校准”的开放项。
   - **未来重评条件**：当 evidence 累积到足够覆盖面后，再转 frozen。

2. **取舍 2**：我们选择 **多条 typed evidence 流** 而不是 **单一 generic trace blob**
   - **为什么**：placement、context、compact、artifact、snapshot 需要被分别分析和分别校准。
   - **我们接受的代价**：观测模型会比“只打一批日志”更复杂。
   - **未来重评条件**：如果某两类 evidence 长期完全重合，再考虑收敛。

3. **取舍 3**：我们选择 **让 evidence 绑定 trace_uuid 与 tenant namespace** 而不是 **后处理再猜关联**
   - **为什么**：storage/context 的很多错误只在跨 turn、跨 seam、跨 archive 路径上才显现，后处理猜测代价极高。
   - **我们接受的代价**：更多 runtime 点位需要主动 emit evidence。
   - **未来重评条件**：无；这属于 trace-first 的直接外延。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| evidence 面太大、实现分散 | 各包各自发明 evidence shape | review 困难 | 统一 vocabulary：placement / assembly / compact / artifact / snapshot 五类 |
| 只有 trace 没有 calibration | 只记录，不分析 | 无法形成收口 verdict | 强制把 evidence 接入 `evaluateEvidence()` 与 verdict rules |
| context evidence 只停留在 happy path | 只记成功装配，不记 dropped/truncated | 无法解释 prompt drift | `ContextAssembler` 必须记录 dropped optional layers 与 truncation |
| compact evidence 丢 early events | sink 未 ready / early compact | 证据断链 | 借鉴 queued-events 模式，重要 early evidence 先缓存后 flush |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能把“上下文为什么变这样”“文件为什么被提到 R2”“为什么这次 compact 后模型丢信息”这些高成本问题变成可回答的问题。
- **对 nano-agent 的长期演进**：为未来的 DDL / API / frontend / analytics 都提供真实证据基础，而不是先拍表结构。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：对上下文管理的杠杆最大；对稳定性和 skill 也会通过 better replay / better artifact lifecycle 直接受益。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Placement Evidence | 真实记录数据放置与读写行为 | 每条关键数据都能回答“它住在哪、为何在那里” |
| F2 | Context Assembly Evidence | 记录 layer order、token budget、truncation | 每次请求都能解释“上下文是怎样拼出来的” |
| F3 | Compact Evidence | 记录 compact 输入/输出/边界/引用 | compact 不再是黑盒删历史 |
| F4 | Artifact & Snapshot Evidence | 记录 artifact lifecycle 与 workspace fragment | promotion/restore 不再靠猜测 |
| F5 | Calibration Verdict | 将 evidence 转成 provisional vs evidence-backed judgement | placement/context policy 能真正收口 |

### 7.2 详细阐述

#### F1: `Placement Evidence`

- **输入**：所有 storage read/write/delete、promotion/demotion 行为
- **输出**：`StoragePlacementLog` entry + evidence signals
- **主要调用者**：`storage-topology`、`session-do-runtime`、`workspace-context-artifacts`
- **核心逻辑**：
  1. 每次关键 I/O 行为都记录 `dataItem / storageLayer / key / op / sizeBytes / timestamp`。
  2. 这些 entry 再被转换为 `size / read-frequency / write-frequency / access-pattern / placement-observation` evidence signals。
  3. evidence 不只在测试里生成，也要在真实 runtime 中持续生成。
  4. `eval-observability` 提供 `StoragePlacementLog` 类型与 sink vocabulary；live emission owner 仍是 `storage-topology` / `workspace-context-artifacts` / `session-do-runtime` 这些实际执行 I/O 的包。
- **边界情况**：
  - `_platform/` 例外路径必须也被明确标注为 platform-scoped，不得混入 tenant evidence。
- **一句话收口目标**：✅ **`placement hypothesis 不再只是表格，而是有持续产生的运行证据`**

#### F2: `Context Assembly Evidence`

- **输入**：`ContextAssembler.assemble()` 调用
- **输出**：一次 assembly verdict record
- **主要调用者**：`llm-wrapper`、`agent-runtime-kernel`
- **核心逻辑**：
  1. 记录 `orderApplied`、`assembled kinds`、`totalTokens`、`truncated`。
  2. 记录哪些 optional layers 被丢弃，以及原因（预算/allowlist/政策），至少包含 `dropped_optional_layers`、`drop_reason`、`required_layer_budget_violation?` 三类字段。
  3. 若 assembly 使用了 prepared artifacts，也要记录其 sourceRef 与 preparedKind。
- **边界情况**：
  - required layers 超预算不是“没事”，而是高价值 evidence；必须被明确记录。
- **一句话收口目标**：✅ **`每次 LLM 请求前，我们都能解释上下文为何是当前这个形状`**

#### F3: `Compact Evidence`

- **输入**：`CompactBoundaryManager.buildCompactRequest()` 与 `applyCompactResponse()`
- **输出**：compact request/response evidence + boundary record evidence
- **主要调用者**：`workspace-context-artifacts`、`agent-runtime-kernel`
- **核心逻辑**：
  1. 记录 compact request 的 `history_ref`、target token budget、split point。
  2. 记录 response 的 `status`、`summary_ref`、`tokens_before`、`tokens_after`、error。
  3. 记录 reinjected boundary marker 与 `turnRange`，让 restore/replay 可以解释“哪些 turn 被折叠了”。
- **边界情况**：
  - compact error 也是一等 evidence，不能只记录成功路径。
  - early compact / early evidence queue 只允许由 `session-do-runtime` 的装配层/emit buffer 承担；compact manager 自身不发明第二套队列语义。
- **一句话收口目标**：✅ **`compact 的输入、决策、输出、边界都能在 trace/evidence 中被重建`**

#### F4: `Artifact & Snapshot Evidence`

- **输入**：`promoteToArtifactRef`、`PreparedArtifactRef`、`WorkspaceSnapshotBuilder`
- **输出**：artifact lifecycle record + snapshot evidence
- **主要调用者**：`capability-runtime`、`workspace-context-artifacts`、`session-do-runtime`
- **核心逻辑**：
  1. 记录哪些结果被 inline，哪些被 promoted 为 `ArtifactRef`，为什么。
  2. 记录 prepared artifact 的 sourceRef → preparedRef 关系。
  3. 记录 snapshot fragment 中的 mountConfigs、fileIndex、artifactRefs、contextLayers。
  4. restore 时记录哪些 fragment 被恢复、哪些未恢复。
- **边界情况**：
  - malformed ref 不得 silently 进入 snapshot；应作为 evidence rejection 记录。
- **一句话收口目标**：✅ **`artifact promotion 与 workspace restore 都能被解释成可审阅的生命周期，而不是若干神秘副作用`**

#### F5: `Calibration Verdict`

- **输入**：placement/context/compact/artifact evidence signals
- **输出**：evidence-backed verdict
- **主要调用者**：owner / reviewer / 后续 DDL/API 设计
- **核心逻辑**：
  1. 定义最小 verdict 维度：`provisional / evidence-backed / needs-revisit / contradicted-by-evidence`。
  2. 对 placement 使用 `evaluateEvidence()` 之类 seam 做推荐。
  3. 对 context/compact 也建立等价 verdict：例如某条 context policy 是否稳定、某个 compact threshold 是否过激。
  4. 只有 evidence-backed 的条目，才允许在后续文档里被当作 frozen baseline。
  5. 这组 verdict 明确只描述 hypothesis status；PX 的 E0-E3 继续描述 capability maturity，两者必须并列说明、不得互相替代。
- **边界情况**：
  - evidence 不足时，结论应保持 provisional，而不是勉强给出肯定 verdict。
- **一句话收口目标**：✅ **`Phase 6 结束后，我们能说清楚哪些 storage/context 决策已被证据支撑，哪些仍只是暂定假设`**

### 7.3 非功能性要求

- **性能目标**：evidence emission 必须是增量、轻量、可采集的；不得为了“留证据”而引入大对象同步写放大。
- **可观测性要求**：placement/context/compact/artifact/snapshot 五类 evidence 都必须能挂回 `trace_uuid` 与 tenant scope。
- **稳定性要求**：runtime emitters 的 owner 必须清楚——`eval-observability` 提供 vocabulary/sink，实际业务包负责在关键动作发生时 emit evidence。
- **术语要求**：P6 verdict 一律称为 **calibration verdict / hypothesis status**；PX 的 E0-E3 一律称为 **capability maturity grade**。
- **测试覆盖要求**：至少需要 placement runtime emission、assembly drop/truncation evidence、compact success/error evidence、artifact lifecycle evidence、snapshot restore evidence 五类验证。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nano-agent 当前代码

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/eval-observability/src/placement-log.ts:33-79` | `StoragePlacementLog` | placement evidence vocabulary 已具备 | 但 live emission owner 仍待接线 |
| `packages/workspace-context-artifacts/src/context-assembler.ts:37-119` | `ContextAssembler` 的 `truncated / orderApplied / totalTokens` | context evidence 已有天然输出面 | 仍需补 dropped-layer fields |
| `packages/workspace-context-artifacts/src/compact-boundary.ts:81-159` | `CompactBoundaryManager` request/response + boundary record | compact 已有可升级的 lifecycle seam | 仍需正式 evidence emission |
| `packages/workspace-context-artifacts/src/snapshot.ts:67-121` | `WorkspaceSnapshotBuilder.buildFragment()` | snapshot 已能携带 mounts/fileIndex/contextLayers | 很适合进入 evidence closure |
| `packages/eval-observability/src/sinks/do-storage.ts:49-194` | durable JSONL trace sink | evidence 的 durable landing zone 已存在 | 与 P1/P2 直接衔接 |

### 8.2 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/services/compact/compact.ts:133-260` | compact strip/reinject lifecycle | compact 必须可解释、可回放 | 很适合 P6 作为 boundary evidence |
| `context/claude-code/services/analytics/index.ts:80-164` | queued-events startup buffering | early evidence 不能因为 sink 未 attach 而丢失 | 但队列应归装配层持有 |
| `context/claude-code/utils/toolResultStorage.ts:130-199` | large result persistence | artifact lifecycle 需要正式 evidence，而不是隐式 side effect | 对 promotion evidence 很有参考价值 |

### 8.3 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/otel/src/trace_context.rs:19-88` | trace continuation discipline | 所有 storage/context evidence 仍应挂回 trace continuation | 不应变成孤立 debug blob |

### 8.4 需要避开的“反例”位置

| 文件:行 | 问题 | 我们为什么避开 |
|---------|------|----------------|
| `packages/storage-topology/src/placement.ts:98-208` | placement hypotheses 仍是 provisional | 说明没有 runtime evidence 就不能提前冻结 policy |
| `packages/workspace-context-artifacts/src/compact-boundary.ts:81-159` | 目前只是 request/response mirror，不等于 evidence 已自动落盘 | 说明 P6 需要补 instrumentation，而不是只靠对象模型自洽 |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

`Storage and Context Evidence Closure` 是 after-skeleton 阶段把“我们自认为 context/storage 设计得不错”变成“我们真的能拿出证据解释这些行为”的那一层。它要收口的不是某个单一算法，而是五条证据流：放置、装配、压缩、artifact 生命周期、snapshot/restore。只有这些 evidence 持续进入 runtime，context management 才会从理念变成可校准、可复盘、可裁决的工程系统。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | context management 是长期差异化主线，证据闭环是其地基 |
| 第一版实现的性价比 | 4 | 需要补 instrumentation owner 与 runtime emitters，但收益巨大 |
| 对未来“上下文管理 / Skill / 稳定性”演进的杠杆 | 5 | 三条主线都会直接消费这些证据流 |
| 对开发者自己的日用友好度 | 4 | 早期会更啰嗦，但能显著减少“为什么变成这样”的黑盒感 |
| 风险可控程度 | 4 | 关键风险是 emitters 分散；通过 vocabulary + owner 分工可控 |
| **综合价值** | **4** | **应作为 Phase 6 的正式 charter 保留，但要把 instrumentation owner 与术语边界写死** |

### 9.3 下一步行动

- [ ] **决策确认**：确认 P6 verdict 采用 `provisional / evidence-backed / needs-revisit / contradicted-by-evidence`，并与 PX 的 capability maturity grade 明确分开。
- [ ] **关联 Issue / PR**：补 placement/context/compact/artifact/snapshot 五类 runtime emitter，把 `StoragePlacementLog` 与 durable sink 接入真实主路径。
- [ ] **待深入调查的子问题**：
  - [ ] `dropped_optional_layers` / `drop_reason` / `required_layer_budget_violation` 是否统一进入 assembly evidence schema
  - [ ] early evidence queue 是否与 Phase 4/P5 的 startup queue 共享同一装配层缓冲
- [ ] **需要更新的其他设计文档**：
  - `P2-trace-first-observability-foundation.md`
  - `PX-capability-inventory.md`

---

## 附录

### C. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.2 | `2026-04-18` | `GPT-5.4` | 补齐尾部章节；增加 instrumentation owner、术语边界与 evidence schema 细节 |
| v0.1 | `2026-04-17` | `GPT-5.4` | 初稿 |
