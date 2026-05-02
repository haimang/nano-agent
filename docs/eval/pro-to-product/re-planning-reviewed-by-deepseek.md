# Re-Planning by Opus — 独立审查

> 审查对象: `docs/eval/pro-to-product/re-planning-by-opus.md` v1
> 审查焦点: 经 HPX7 完成后的 Phase 结构与 Design Doc 规划
> 审查者: Deepseek
> 日期: 2026-05-02
> 审查立场: 独立技术审查。不承载 owner 偏好，不迎合已有共识。

---

## 0. 一句话判断

**Phase 结构大体正确。Design Doc 蓝图严重过度工程化。** 两份方案混装在同一文档里，导致一份合理的 phase 规划被一份不切实际的 document production plan 拖累。下面分开评审。

---

## 1. Phase 结构 — 基本成立，有一处微调

### 1.1 7-phase 切分 (PP0-PP6) 的判断

Opus 将 initial 的 6 phase 改为 7 phase，核心动作是 **PP1 拆分为 PP1 (HITL) + PP2 (Context)**。这个决策的 reasoning 链条：

> PP1 不应同时吞下 C1 (HITL interrupt) + C2 (Context budget)，两者都涉及 interrupt 但触发条件、恢复路径、timeout 语义都不同。

**这项拆分是正确的**。GPT 和 Kimi 独立得到了同一结论，从代码结构也能印证——HITL interrupt 的改动面在 `runtime-mainline.ts authorizeToolPlan` + `scheduler`，Context budget 的改动面在 `request-builder.ts token estimation` + `context-core summary`，两者的文件冲突面极小但语义耦合面极大（共享 `confirmation_pending` interrupt 路径作为交互点）。拆开后，PP1 成为 PP2/PP4 的复用基面，逻辑干净。

**其他阶段 (PP3-PP6) 的判断**: 也基本成立。PP3 (Reconnect) 前置到 PP4 (Hook) 之前是正确的——reconnect 是 product trust 的基础（用户刷新页面崩了，hook 做得再好也看不到），GPT 的这条排序论证比 Opus 的 initial 排序更有说服力。

### 1.2 不成立的地方: PP6 是个"杂物抽屉"

PP6 的定义是:

> Observability + Reasoning Stream + Final Closure

这三个子任务的性质完全不同:
- **Observability** (TokenCount/RateLimits/ContextWindow% push) 是 **跨 phase 的共享能力**——PP2 是否需要 expose compact 进度到 observability layer? PP5 是否需要 expose retry count? 如果 PP6 才做，PP2/PP5 会做成不完整闭环。
- **Reasoning Stream** 是单一的 content_type 扩展——技术上是 1-2 天的工作，不应单独占一个 phase。
- **Final Closure** 是阶段封板——这是治理动作，不应和技术实现并列。

建议: 把 observability push 的 schema 提前到 PP0 阶段定义（2 页纸的 cross-phase contract），具体实现在各自 phase 内完成（PP2 compact 进度在 PP2 做，PP5 retry count 在 PP5 做）。Reasoning stream 并入 PP6 的 observability 收尾子任务，不单独成项。Final closure 恢复为独立治理动作（类似 hero-to-pro HP10），不挤在实现 phase 里。

### 1.3 DAG 与并行窗口的判断

```text
PP0 → PP1 → PP2 → PP6    (critical path: 65-92 天单工程师)
PP3 与 PP1 并行
PP5 与 PP1 后期/PP2 并行
PP4 串行依赖 PP1
```

**DAG 本身是合理的**。但有一个隐含假设需要显式检查:

PP3 (Reconnect) 声称与 PP1 "几乎无文件冲突"。检查实际代码: PP3 的 `restoreFromStorage` 在 `session-do-runtime.ts`（agent-core），replay 在 `replay.ts`（packages），ws-runtime 在 `user-do/ws-runtime.ts`（orchestrator-core）。PP1 的 scheduler interrupt 在 `runtime-mainline.ts`（agent-core），OrchestrationState 在 `orchestration.ts`（agent-core），PermissionRequest 在 `session-do-runtime.ts`（agent-core）。

**文件冲突面**: `session-do-runtime.ts` 被 PP1 和 PP3 同时改动——PP1 需要扩展 `emitPermissionRequestAndAwait`，PP3 需要修改 `restoreFromStorage`。虽然改动的是同一个文件的不同函数，但在代码层面仍会引发 merge conflict。这个冲突不是设计问题——是提醒 PP3 不应在 PP1 的 week 1 就启动，应等 PP1 的 `session-do-runtime.ts` 改动稳定后再并行。

**建议**: 将 PP3 的启动条件从"PP0 closure 后"调整为"PP1 完成 session-do-runtime.ts 改动后（约 PP1 的第 2 周）"。

---

## 2. Design Doc 蓝图 — 核心问题

Opus §9 提出 13 份 design + 26 份 review = **39 份新文档**，分 3 个 Tier，耗时 18-23 天（PP0 阶段）。

**这条计划有 4 个层面的问题。**

### 2.1 体量问题: 39 份文档在什么工程语境下合理

当前仓库已有 **267 份 eval/code-review 文档**，加上 13 份 design + 15 份 closure + 19 份 action-plan = 超过 300 份治理文档。这条文档链已经产生了真实的维护成本——hero-to-pro final closure 自身经历了 3 次 major revision（handed-to-platform 误标 → absorbed → close-with-known-issues），每次修正都需要扫描多条文档链。

再加上 39 份新文档，且其中 26 份是 LLM review 稿，意味着 pro-to-product 的**文档维护成本将超过代码维护成本**。

举一个具体例子: 如果 Tier 2 的 `frontend-contract.md` 在 PP4 实施时发现 must-have/should-have/nice-have 的分类需要调一档，那么这份文档需要更新，它的 2 个 review 可能不再准确，消费它的 3 个 per-phase design 也可能需要调整。**一层文档变更 = 向下传播 3-4 层涟漪**。

Opus 在 §5 中的元元结论说:

> nano-agent 的工程问题不在"做了多少"，而在"宣称完成的多少 ≠ 实际接通的多少"

**但是 39 份 design doc 恰恰在重复同一反模式**——它把"write design"混淆为"make progress"。Design doc 数量不保证 design 质量。

### 2.2 Tier 1: 3 份文档，2 份是文档-about-文档

| # | 文档 | 性质 |
|---|------|------|
| 1 | `closing-thoughts-by-opus.md` | 合成已有分析的 meta-analysis |
| 2 | `debt-acknowledgement-matrix.md` | 登记已在 closure 链中标注的 debt |
| 3 | `9-report-deferral-matrix-by-opus.md` | 把 9 份 report 的 P0/P1/P2 逐项映射到 phase |

文档 (1) 的输入: initial-planning + GPT review + Kimi review + 9 份 core-gap = 13 份已有文档。产出一个"这些文档说了什么"的摘要。如果这些文档本身的结论还没消化，写一篇摘要不会让它们变得更消化。

文档 (2) 的输入: 20 项 debt（hero-to-pro retained 7 + HPX6 closure followups 4 + HPX6 review findings 9）。但 HPX7 完成后的真实状态是:
- 28 个 deferred 细分项 already absorbed within hero-to-pro
- 4 项 owner-action retained 已在 final-closure §3 带 Q36 6 字段登记
- 5 项 cleanup → accepted-as-risk

**20 项中的大部分已经不存在**。HPX7 执行完之后，debt 矩阵的实际内容从 20 项缩减到约 5-6 项真正需要在 pro-to-product 阶段关注的条目。为这些写一份独立文档是过度归档。

文档 (3) 是唯一有实质价值的——9 份 core-gap 报告覆盖 3 个维度 × 3 个竞争者，它们之间的 P0/P1/P2 归一确实存在交叉和矛盾。但这份归一的结果完全可以在 PP0 charter §6 的 phase 表中直接呈现，不需要独立文档。

**替代方案**: 将 Tier 1 从 3 份缩减为 1 份 `pro-to-product-pre-charter-reasoning.md` (≤10 页)，直接产出 charter 需要的事实锚点，不绕道做 meta-analysis。

### 2.3 Tier 2: 4 份 cross-cutting architecture 的问题

Opus 说 Tier 2 是"阶段级最高抽象层"，需要 4 份独立文档。逐一审查:

**(4) `truth-architecture.md` (三层真相责任划分)**

这是 Tier 2 中唯一**确实需要独立存在**的文档。原因是: PP1-PP6 的 6 个闭环各自会做持久化决策（confirmation_pending 状态存哪？compact 后的 message 存哪？replay 后的状态从哪 hydrate？），如果每一份 per-phase design 各自判断，必然出现不一致。这份文档的价值是 **prevent cross-phase inconsistency**。

**保留。**

**(5) `frontend-contract.md` (前端契约)**

这份文档的内容是两个维度交叉:
- Kimi 的用户感知度三级矩阵 (must-have/should-have/nice-have)
- GPT 的 6 truth gate (作为 acceptance)

这两者本质上应该各自归位:
- 用户感知度矩阵是一个 **分类工具**——它应该出现在 charter §4 的 In-Scope/Out-of-Scope 判定表中，作为判定"某工作属于哪个 phase"的辅助标准，而不是一份独立 contract。
- 6 truth gate 是 **exit criteria**——它们应该出现在 charter §10 Primary Exit Criteria，在每个 phase closure 时被消费。

把这两者合并成一份独立的 `frontend-contract.md` 造成的问题是: 它把"分类工具"升格为"前端契约"——但 pro-to-product 阶段的前端团队可能根本不存在（Opus 自己也承认前端介入节奏是 6 个独立时点，PP0 阶段前端 lead 最多参与 review）。没有前端 consumer 的 contract 不是 contract，是 wishlist。

**(6) `honesty-contract.md` (阶段纪律 doc)**

这是所有文档中概念最模糊的一个。它的 4 项内容:
- 6 truth 各自的 e2e 验收方式 → 属于 Tier 3 per-phase design 的 exit criteria 定义
- "wire-with-delivery 不算闭合"的判定 → 属于 charter §5 方法论
- 文档诚实表述准则 → 这本质上是一段 coding guideline，可以在 charter §5 或 AGENTS.md 中写 3 条规则
- `check-docs-consistency.mjs` 的扩展 rule → 一个脚本配置变更

把以上 4 项装进一份独立文档，就是给一段 coding guideline 赋予"contract"的地位。hero-to-pro 没有这份文档也能完成——不是因为没有 honesty 纪律，而是因为 honesty 纪律不在写一份叫 honesty-contract 的文档里，在**实际 review 时拒绝 deceptive closure 表述**的行为里（这正是 HPX7 H1-H6 的运作方式）。

**(7) `observability-baseline.md` (4 个 latency 阈值)**

4 个阈值: confirmation interrupt ≤500ms / compact ≤3s / reconnect 重放 ≤2s / retry 首响 ≤1s。

这是一张**4 行 × 4 列的表**（阈值 / 测量方式 / 消费 phase / 失败动作）。写成独立文档意味着这张表要配上引言、背景、每一行的展开说明。最终产出是一篇 5-8 页的文档，其中 80% 的篇幅是 padding。

这张表应该出现在 PP6 design doc 的"性能验收"小节，作为 PP6 的 exit criteria 的一个子项。它不是阶段级的，它是 PP6 级的。

**替代方案**: Tier 2 从 4 份缩减为 2 份:
- `pro-to-product-truth-architecture.md` — 保留
- 前端契约 + honesty contract + observability baseline 的内容下沉到它们应该归属的地方: charter §4/§5/§10 + per-phase designs 的 exit criteria 小节

### 2.4 Tier 3: 6 份 per-phase design — 数量不是问题，撰写时序是问题

6 份 per-phase design (PP1-PP6 各一份) 的数量是合理的——每个 phase 需要一份实施前 design 锁定。hero-to-pro 的 13 份 per-phase design 也是这样运作的。

**但 Opus §9.4 的撰写时序有问题**:

```
Day 21-23: PP1 design + PP3 design (PP0 closure前写完)
PP1 中段: PP2 design
PP1 closure: PP4 design
```

这意味着 **PP1 启动前，PP1/PP2/PP3 的 design 都要完成**。而 PP2 的 design 需要消费 PP1 的实施反馈（"PP1 中段写 PP2 design"）。这就是一个 timing 矛盾: PP2 design 应该在 PP1 实施中段才知道 PP1 的实际决策面有多大、哪些被砍、哪些延迟，然后调整自己的假设。但如果 PP2 design 已经写完并 frozen，调整就需要 re-open。

hero-to-pro 的实际情况也是类似——HP6 在实施时发现 design 中假设的某些接口不存在，需要 HPX5/HPX6 bridging 重新设计。一份提前写完的 design 不会阻止这种发现，只会让修订成本更高。

**建议**: 保留 6 份 per-phase design 的数量和结构，但调整撰写时序——每个 phase 的 design 在该 phase 启动前 2-3 天完成即可，不需要在 PP0 阶段 frontload。PP0 只产出: charter + truth-architecture.md。

---

## 3. 26 份 Review Doc — 不合理的乘数效应

Opus §9.5 的 review 计划:

| Tier | 文档数 | 每家 review 数 | review doc 数 |
|------|--------|:--------------:|:-------------:|
| Tier 1 | 3 | 4 (GPT+Kimi+Deepseek+Opus) | 12 |
| Tier 2 | 4 | 2 (GPT+Kimi) | 8 |
| Tier 3 | 6 | 1 (任选) | 6 |
| **总计** | **13** | | **26** |

26 份 review doc 的 time cost:
- 每份 review 需要 reviewer 阅读 design + 分析 + 撰写 = 估计 1-2 小时 LLM time
- 26 × 1.5h = 约 39 小时纯 LLM review time
- 加上 revision 轮次和 review 后的 design 修订: 实际耗时 ×1.5~2 = 60-80 小时

对比 hero-to-pro 的 review 体量:
- hero-to-pro 有约 57 份 code-review 文档
- 但它们是**按 phase batch 做的**（HP2-HP4 一份 review、HP6-HP8 一份 review），不是按逐份 design 做的
- review 密度最高的阶段（zero-to-real）是严格的 1-phase 1-review

Pro-to-product 的 review 计划把 **逐文档 review** 当作默认——这是 hero-to-pro 的经验反例。hero-to-pro 最有效的 review 是 **batch review**（一次 review 覆盖 2-4 个 phase 的全部 design + 代码），不是逐 design 逐 review。

**建议**: Pro-to-product review 采用 batch 模式:
- PP0 阶段: 1 份 review (charter + truth-architecture.md 合并 review)
- PP1-PP2 阶段: 1 份 review (两个紧耦合 phase 合并 review)
- PP3-PP4 阶段: 1 份 review
- PP5-PP6 阶段: 1 份 review
- 总 review 数: **4 份** (vs 计划的 26 份)

---

## 4. PP0 工期问题: 18-23 天是自指矛盾

Opus 在 §9.4 中把 PP0 工期从 initial 的 8-12 天上调为 18-23 天，理由是:

> Kimi 的 PP0 8-12 天估算偏少 — 因为没把 13 份 design 全 frontload 算进去

这个上调暴露了 Opus 自身在 §5 中识别的元元结论与 design 计划之间的**自指矛盾**:

> 元元结论: nano-agent 的工程问题不在"做了多少"，而在"宣称完成的多少 ≠ 实际接通的多少"

如果这条结论成立，那么 pro-to-product 的正确策略是:
- **尽早开始写代码**（因为只有代码接通了才是真的接线，design 接通了不算）
- **用 truth gate 在校验层做 hard check**（而不是用 design doc 在规划层做 soft assumption）

但是 18-23 天的 PP0（不写一行代码，只写 design + charter）是把最大的 time budget 投在了 **最不能保证"接通"的 layer** 上。

Pro-to-product 的核心命题是"把已有的 substrate 接通到 live caller"。如果已有的 substrate 已经 workbench-grade（hero-to-pro §16.4），那么是否能"接通"的第一道检验不是在 design 里完成的——它是在 **第一次写 e2e 自动化测试** 时完成的（这个 e2e 测试会立刻暴露"design 里假设可以直接复用的接口实际上缺少某个参数"）。

**建议**: PP0 的目标不是"写完 13 份 design"，而是"完成 charter + 锁定 truth architecture + 写出第一个 e2e 骨架"。这会自然将 PP0 的工期拉回 8-12 天（Kimi 的原始估计），并且让 PP1 的实际代码实施成为（而不是 design 成为）pro-to-product 的第一推进力。

---

## 5. HPX7 完成后的实际起点 — re-planning 未充分承认的变化

Re-planning §6.4 描述了 HPX7 完成后的目标状态:
- F12 (HookDispatcher) → `dispatcher-injected / caller-deferred to PP4`
- token accounting → explicit closed or verified
- tool cancel → explicit closed
- attach race → explicit hardened
- HPX6 R1/R2 → explicit closed

HPX7 执行完毕后（2026-05-02），这些全部兑现。但 re-planning **没有重新绘制 pro-to-product 的 debt landscape 在 HPX7 之后的样子**。

具体来说:
1. **Deferred 吸收**: HPX7 完成后，28 个 deferred 细分项已 absorbed within hero-to-pro。这意味着 pro-to-product 需要承接的 debt 从"20 项"（re-planning §9.2 Tier 1.2 引用的 Kimi §6）大幅缩减。Tier 1.2 的 debt-matrix 文档的价值比例下降了。
2. **Replay buffer 三层联动 (HPX7-A)**: 下放到 PP3a 入口任务。但 HPX6 已经实现了 Queue-backed executor + restore handler，HPX7 完善了 optimistic lock。PP3 的起点已经被 HPX6/HPX7 抬高了: `restoreFromStorage` 现在有了配套的 `D1CheckpointRestoreJobs`、`filesystem-core copyToFork`、Queue consumer。PP3 不是从零开始做 replay，是从"substrate 已有，只差 replay path 接线 + lagged contract 降级"开始做。这是一个 8-12 天的工作包，不是 15-22 天。
3. **Hook delivery (PP4)**: HPX7 H1 把 HookDispatcher 标记为 `dispatcher-injected / caller-deferred`。HPX6 R5 实现了 PreToolUse permission_rules 决策。PP4 的起点不是"从零建 hook system"，而是"在已有的 HookDispatcher + permission_rules 之上，先让 PreToolUse 走 HookDispatcher.emit，再走 authorizeToolUse fallback"。这是一个 8-12 天的工作包，不是 12-18 天。

**以上 3 条 = pro-to-product 的实际工时基线被 HPX7 明显抬高了。但如果 re-planning 不重新校准，这份文档的工时估算就会偏保守，进而影响 owner 的 resourcing 决策。**

---

## 6. 综合建议: 一份轻量化方案

基于以上分析，对 re-planning 提出以下修订:

### 6.1 Phase 结构

| Phase | 名称 | 修正后工期 | vs re-planning |
|-------|------|:-------:|:--------------:|
| **PP0** | Charter + Truth Architecture | 8-12 天 | **↓ 10-11 天** |
| **PP1** | HITL Interrupt (C1) | 18-25 天 | 持平 |
| **PP2** | Context Budget (C2) | 20-28 天 | 持平 |
| **PP3** | Reconnect (C6) | 10-16 天 | **↓ 5-6 天** (HPX6/HPX7 抬高起点) |
| **PP4** | Hook Delivery (C5) | 8-14 天 | **↓ 4 天** (HPX7 H1 + HPX6 R5 抬高起点) |
| **PP5** | Reliability + Policy (C3+C4) | 15-22 天 | 持平 |
| **PP6** | Final Closure (观测收尾 + 封板) | 6-9 天 | **↓ 4-6 天** (observability push 移到各 phase) |
| **总计** | | **85-126 天** | **↓ 16-20 天** vs re-planning 的 101-146 天 |

### 6.2 Design Doc 缩减

| 文档 | re-planning | 修订后 | 理由 |
|------|:----------:|:------:|------|
| Tier 1 docs | 3 | **1** | `pre-charter-reasoning.md` (合并 closing-thoughts + debt-summary + 9-report-normalization) |
| Tier 2 docs | 4 | **2** | `truth-architecture.md` + charter §4/§5/§10 内嵌前端契约/honesty/observability |
| Tier 3 docs | 6 | **6** | 保留，但写在该 phase 启动前 2-3 天 |
| **Design 总计** | **13** | **9** | ↓ 4 份 |
| Review docs | 26 | **4** | batch review by phase group |
| **总文档量** | **39** | **13** | ↓ 66% |

### 6.3 PP0 的产出（vs re-planning）

| 产出 | re-planning PP0 | 修订后 PP0 |
|------|:--------------:|:----------:|
| Charter (plan-pro-to-product.md) | ✅ | ✅ |
| Pre-charter reasoning (1 份) | ❌ (3 份 Tier 1) | ✅ (1 份合并) |
| Truth architecture (1 份) | ✅ | ✅ |
| Frontend contract 独立档 | ✅ | ❌ → charter §4 内嵌 |
| Honesty contract 独立档 | ✅ | ❌ → charter §5 + AGENTS.md |
| Observability baseline 独立档 | ✅ | ❌ → PP6 design exit criteria |
| PP1 design | ✅ | ❌ (PP1 启动前 2-3 天写) |
| PP3 design | ✅ | ❌ (PP3 启动前 2-3 天写) |
| 首个 e2e 骨架 | ❌ | ✅ (**新增** — 比 design 更能暴露 substrate 真相) |
| **工期** | **18-23 天** | **8-12 天** |

---

## 7. 一个未在 re-planning 中讨论的替代思路: "反转 design 与实现的关系"

Re-planning 的整个 §9（Design Doc 蓝图）建立在同一个前提上: **先设计、再实施**。这是 hero-to-pro 的模式，也是 re-planning 推给 pro-to-product 的默认模式。

但 pro-to-product 的工作性质与 hero-to-pro 根本不同:
- Hero-to-pro 是 **建 substrate**: 需要先设计 schema/storage/façade，因为建错了重构成本极高。
- Pro-to-product 是 **接 live caller**: 已有的 substrate 是否真的可以被接通，第一手判断不在 design 里，在 **尝试接线** 里。

为 pro-to-product 考虑一个替代模式:

```
PP0: Charter + Truth Architecture + 首个 e2e 骨架 (拿已有的 substrate 写一个真实的 end-to-end 测试)  [8-12 天]
  └── 这个 e2e 骨架会立刻暴露"substrate 哪里还没准备好"
       → 把暴露出的问题补进 PP1-PP6 的 scope
       → PP1-PP6 design 基于实测信息而非推理

PP1-PP6: 按 DAG 执行
  └── 每个 phase 的 design 写在该 phase 启动前 2-3 天
  └── 每个 phase 的 e2e 是该 phase 的一部分（不是 PP6 的收尾动作）
```

这个模式的核心理念是: **别猜 substrate 哪里不够好，直接测它**。一个 2 天的 e2e 骨架（例如 "HITL interrupt: user sends message → system asks confirmation → user allows → agent continues"）会让 PP1 的 design 建立在实测而非推测之上。

这不是反对 design——是反对 **frontloaded design**。Pro-to-product 的 design 应该写在你已经知道问题在哪之后，而不是之前。

---

## 8. 总结

| 维度 | re-planning (Opus) | 本次审查立场 |
|------|-------------------|-------------|
| Phase 切分 | 7 phase (PP0-PP6) | **同意**。PP1/PP2 拆分是正确决策。PP6 需要重新定义（拆出 observability 到各 phase + restore standalone final closure） |
| PP3 启动时机 | PP0 closure 后立即 | **有异议**。`session-do-runtime.ts` 与 PP1 共享冲突，应等 PP1 第 2 周再启动 |
| Design doc 数量 | 13 份 (3+4+6) | **过度**。建议 9 份 (1+2+6)。砍掉 4 份的原因是: 2 份是文档-about-文档，2 份可以内嵌在 charter 中 |
| Review doc 数量 | 26 份 | **严重过度**。建议 4 份 batch review。hero-to-pro 的经验证明逐 doc review 不经济 |
| PP0 工期 | 18-23 天 | **太长**。建议 8-12 天。PP0 不应 frontload 全部 design |
| 总工期 (单工程师) | 101-146 天 | **84-126 天** (HPX7 抬高起点 + 砍 design overhead) |
| 核心方法论 | Design-first | **E2E-first**。先写 e2e 骨架暴露真实 gap，再用 design 锁定方案 |

**最后一条建议**: re-planning 的元元结论（§5）说"pro-to-product 的核心治理目标是建立一种 closure 纪律"。我同意。但 closure 纪律不是靠 13 份 design + 26 份 review 的文档体系建立的——是靠每个 phase 结束后跑一个 10 行的 e2e 测试，如果不过就不 closure。**Truth gate 是技术动作，不是文档动作。**
