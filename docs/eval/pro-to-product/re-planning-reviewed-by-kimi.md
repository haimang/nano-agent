# Re-Planning Reviewed by Kimi

> **文档性质**: `eval / review-of-re-planning`（对 `re-planning-by-opus.md` 的辩证审查）
> **作者**: Kimi
> **日期**: 2026-05-02
> **审查前提**: HPX7 已完成，`hero-to-pro` 已升级为 `close-with-known-issues / 4-owner-action-retained`
>
> **立场声明**: 本 review 不受 owner 偏好干扰，基于代码现实、工程经济学、以及"已完成 HPX7"这一不可撤回的事实，对 re-planning 的 Phase 设定与 design 蓝图做独立判断。

---

## 0. 核心结论（TL;DR）

**re-planning-by-opus.md 过度复杂化了 pro-to-product。**

在 HPX7 已完成的今天，hero-to-pro 的真实终态是 `close-with-known-issues / 4-owner-action-retained`。这意味着：
- 工程侧 blocker 已全部清除
- 28 个 deferred 项已 absorbed within hero-to-pro
- 4 套状态机 substrate 已就绪
- 只剩下 4 项 owner-action（物理设备、prod credential、external reviewer、wrangler tail）—— 这些不是 engineering work

但 re-planning 仍按 "partial-close / 7-retained / 大量隐性 debt" 的假设来规划，导致：
1. **Phase 数量膨胀**：从 6 个增加到 7 个
2. **Design doc 膨胀**：提出 13 份，比 hero-to-pro 还多 1 份
3. **工作量膨胀**：从 initial 60-90 天上调到 101-146 天（单工程师）
4. **Governance 维度爆炸**：6 truth gate + 用户感知度矩阵 + 前端介入 schedule + 4 性能阈值 + contingency contract + debt acknowledgement gate + 2 种工程组织模型

**这不是在规划一个阶段，这是在写一部宪法。**

---

## 1. 过度复杂化的具体症状

### 1.1 Phase 切分：从"合理"到"官僚"

re-planning 把 PP1 拆成 PP1a(HITL) + PP1b(Context)，理由是"compact 风险高，不应拖住 ask-path"。

**问题**：
- HITL interrupt 和 Context budget 共享同一个核心机制：scheduler 的 pause-resume 语义
- 分开后，PP1 和 PP2 都各自需要一个完整的 interrupt 路径设计，反而增加了重复工作
- 更重要的是：**如果 PP1 的 confirmation_pending 机制设计得好，PP2 的 compact-interrupt 可以直接复用**
- 从实际代码看，`orchestration.ts` 里已经有了 `probeCompactRequired` + `compactSignalProbe` 的 hook 点，PP2 的 compact 只是 PP1 interrupt 的一个新 trigger

**我的判断**：PP1 和 PP2 应该合并为 **"Interrupt & Budget Closure"**。不是把它们拆开降低风险，而是合并后共享 interrupt 框架，反而降低风险。如果 compact 真的不可行，contingency 是在 PP1/PP2 内部 scope-cut，而不是把它推到另一个 phase。

### 1.2 Design Doc 蓝图：13 份是荒谬的

re-planning §9.2 提出 13 份 design doc（3 Tier1 + 4 Tier2 + 6 Tier3），并自豪地说"比 hero-to-pro 多 1 份是因为 Tier2 多了 honesty + observability"。

**这是完全颠倒的优先级**：
- hero-to-pro 是**建设阶段**（新建 4 套状态机、13→13 event kinds、14 migrations、6 workers）— 12 份 design 合理
- pro-to-product 是**接线阶段**（把已有的东西接通到 live caller）— 居然还要 13 份？

**按这个逻辑，修个水管要比建房子画更多图纸。**

**具体问题**：
- **Tier1.2 `debt-acknowledgement-matrix.md`**（3-4天）：hero-to-pro 已经是 `close-with-known-issues`，20 项 debt 中 28 个已 absorbed，只剩 4 个 owner-action。这份 matrix 的价值接近于 0。
- **Tier1.3 `9-report-deferral-matrix-by-opus.md`**（3-5天）：9 份 core-gap 报告已经是 eval 文档，它们的 deferral 应该在 PP0 charter 的 §7 各 phase In-Scope 中自然消化，不需要单独一份 matrix。
- **Tier2.3 `honesty-contract.md`** + **Tier2.4 `observability-baseline.md`**：这两份可以合并到 charter 的 §10 + §14 中，不需要单独成文。
- **Tier3 6 份 per-phase design**：如果 phase 合并为 4 个，这里只需要 4 份。

**合理数量**：**6-7 份**
- 1 份 closing-thoughts（已有）
- 1 份 cross-cutting architecture（truth + frontend contract 合并）
- 1 份 charter（PP0 产出）
- 4 份 per-phase design（按合并后的 4 phase）

这样 Tier1/Tier2/Tier3 分别是 1/1/4 = 6 份，加上 charter 自身共 7 份。

### 1.3 PP0 工期：从 3-5 天膨胀到 18-23 天

re-planning §9.4 说"PP0 需要 Day 1-23 写 design doc"，然后 §8.1 把 PP0 估为 8-12 天（ Tier1 + Tier2 写完后 charter 才能定稿）。

**问题**：
- 如果按 re-planning 自己的逻辑，PP0 内要写 7 份 design（3 Tier1 + 4 Tier2），每份 3-5 天，那 PP0 应该是 21-35 天
- re-planning 又试图把 PP0 压到 8-12 天，但 Tier1.3 和 Tier2.4 各需要 3-5 天，这已经 6-10 天了，还没算 charter 写作
- 这个估算自相矛盾

**我的判断**：PP0 应该控制在 **5-7 天**。产出物：
1. charter（含 6 truth gate、contingency、frontend schedule、observability baseline 作为 charter 内章节，不单独成文）
2. 1 份 cross-cutting architecture doc
3. PP1 design（因为 PP1 是 critical path，需要最早 frozen）

其他 per-phase design 可以在各 phase 启动前按需写，不必全部 frontload 到 PP0。

### 1.4 工作量膨胀缺乏事实支撑

| 维度 | initial | re-planning | 变化 |
|---|---|---|---|
| 单工程师总工期 | 60-90 天 | 101-146 天 | +68-62% |
| 3 工程师并行 | 35-50 天 | 56-80 天 | +60-60% |
| Phase 数量 | 6 | 7 | +1 |
| Design 数量 | 未明确 | 13 | +∞ |

**但 pro-to-product 的工程本质没有变**：仍然是"把已有的 schema/storage/façade 接通到 live caller"。为什么工作量反而增加了 60%？

re-planning 的解释是：
- "PP1 拆分后各自需要更多时间" → 但这是规划者自己制造的复杂性，不是工程现实
- "新增 6 个 governance 维度" →  governance 是 overhead，不是 deliverable
- "PP0 要写 7 份 design" → 同样是 self-inflicted

**按这个膨胀率，pro-to-product 比 hero-to-pro 还重。这不合理。**

---

## 2. 基于 HPX7 已完成的事实，重新评估起点

### 2.1 真实起点比 re-planning 假设的更好

re-planning §2.2 的 Reality Snapshot 仍引用 `hero-to-pro-final-closure.md` 的 `partial-close/7-retained` 版本。但 HPX7 完成后，真实起点是：

| 维度 | re-planning 假设 | HPX7 完成后现实 |
|---|---|---|
| hero-to-pro 状态 | partial-close / 7-retained | **close-with-known-issues / 4-owner-action** |
| 工程 retained | 3+ 项 | **0 项** |
| Debt 矩阵项数 | 20 项 | **4 项 owner-action（非 engineering）** |
| Deferred 状态 | 22 项 handed-to-platform（旧 framing） | **28 项 absorbed within hero-to-pro** |
| F12 hook dispatcher | "closed"（deceptive） | **"dispatcher injected / caller deferred to PP4"**（诚实） |

**这意味着**：
1. **Debt Acknowledgement Gate（D1）实际上已关闭** — 没有 engineering debt 需要 pro-to-product 承接
2. **Retained Non-Block Gate（D2）也实际关闭** — 4 项 owner-action 不影响 engineering 启动
3. **9-report-deferral-matrix 不需要在 PP0 内做** — 因为 deferred 项已经 absorbed，不是"待 defer"
4. **Honesty contract 的一大部分已经由 HPX7 完成** — F12、token accounting、tool cancel、attach race、R1/R2 都已 honest closure

### 2.2 re-planning 没有充分利用这个"干净起点"

re-planning 仍在 §7.6 列出 14 节 charter 必含内容，其中至少 4 节是基于"仍有大量 debt"的假设：
- Gate D1（13 项 debt）→ **实际 0 项 engineering debt**
- Gate D2（7-retained 非阻塞声明）→ **实际只剩 owner-action，不需要 engineering gate**
- Tier1.2 debt-matrix（3-4 天）→ **不需要**
- Tier1.3 deferral-matrix（3-5 天）→ **不需要**

如果把这些基于过时假设的 overhead 砍掉，PP0 可以从 18-23 天压缩到 **5-7 天**。

---

## 3. 辩证审视：re-planning 中哪些仍然正确

尽管我认为 re-planning 整体过度复杂化，但以下判断是正确且有价值的：

### 3.1 PP3 优先于 PP4（正确）

GPT §5 提出 reconnect 在 hook 之前，re-planning 采纳了这个判断。

**我的确认**：正确。reconnect 不修，前端刷新就崩；hook 不修，只是"看不到 backend 状态变化"。产品 trust 的基础是"不崩"，其次才是"看得见"。

### 3.2 6 truth gate 框架（正确，但不需要单独成文）

GPT §6 的 6 条 truth 是 closure 纪律的可操作化，比 initial 草案的 6 个闭环更具体。

**我的确认**：正确。但应作为 charter §10 的 exit criteria，不需要单独的 `honesty-contract.md`。把 6 条 truth 写成表格嵌入 charter，每个 phase closure 时引用即可。

### 3.3 PP1 拆分建议（部分正确）

GPT 和 Kimi 都建议 PP1 拆分。我（Kimi）在 initial review 中确实支持拆分。

**我的修正**：现在我认为拆分是过度反应。HITL 和 Context 共享 interrupt 框架，合并在同一个 phase 内用 sub-task 区分即可。拆分后增加了 phase 管理开销（每个 phase 需要 closure、review、gate），边际收益为负。

**但如果 owner 坚持拆分**，我的妥协方案是：PP1 不分拆为两个独立 phase，而是在 PP1 内部明确分为 **Stage 1: HITL interrupt** 和 **Stage 2: Context budget**，共享同一个 design doc 和同一个 closure，但 Stage 2 可以在 Stage 1 的 interrupt 框架冻结后开始编码。

### 3.4 D1 freeze 受控例外（正确）

GPT §3.5 的 5 条例外条件合理。

**我的确认**：正确，但应作为 charter §4 的一段，不需要单独讨论。

### 3.5 前端介入节奏（正确，但太细）

Kimi §9.1 提出 6 个时点的前端 schedule。

**我的确认**：方向正确（前端不应 PP5 才介入），但 6 个时点太细。实际上只需要 3 个时点：
1. PP0 末：前端 review charter + mock API contract
2. PP1 中：前端开始实现 confirmation UI
3. PP3 中：前端实现 reconnect 状态恢复 UI

其他时点的介入都是自然跟随（PP2/PP4/PP5 没有独立的前端 milestone）。

### 3.6 用户感知度三级矩阵（正确，但应简化）

must-have / should-have / nice-have 三级矩阵帮助排序。

**我的确认**：有用，但应作为 charter §4 的一张表格，不需要单独章节或单独文档。

---

## 4. 重新设计的 Phase 结构（4 Phase）

基于"HPX7 已完成 + 起点干净 + 工程本质接线"三个事实，我提议以下简化结构：

```
PP0 — Charter & Architecture Lock              [5-7 天]
PP1 — Core Product Loop (HITL + Context + Hook) [35-50 天]   ── 主 critical path
PP2 — Connection & Recovery (Reconnect + Reliability) [20-30 天]  ── 可与 PP1 后半并行
PP3 — Product Polish & Launch (Policy + Observability + Final) [10-15 天]
```

### 4.1 合并逻辑

**PP1 = HITL + Context + Hook（原 PP1+PP2+PP4）**
- 三者共享同一个核心：scheduler interrupt 框架
- HITL 是 user-driven interrupt（confirmation_pending）
- Context 是 quota-driven interrupt（compact signal）
- Hook 是 tool-driven interrupt（PreToolUse → confirmation / auto-run）
- 把它们放在一起，可以统一设计 interrupt 状态机、统一恢复路径、统一 timeout 语义
- 预计节省 10-15 天（避免重复设计 interrupt 框架 + 减少 phase 切换 overhead）

**PP2 = Reconnect + Reliability（原 PP3+PP5）**
- reconnect 修的是"断线后怎么恢复"
- reliability 修的是"出错后怎么恢复"
- 两者共享"恢复"语义，可以统一设计 restore path + retry policy
- reconnect 可以与 PP1 后半并行（文件冲突小）

**PP3 = Policy + Observability + Final（原 PP5 后半+PP6）**
- 这是"兜底 + 抛光"阶段
- policy honesty 和 observability 不涉及核心交互路径，可以放在最后
- final closure 自然收口

### 4.2 DAG 与并行窗口

```text
PP0 (charter + architecture)
  └── PP1 (Core Product Loop)
        ├── PP2 (Connection & Recovery — PP1 Stage 2 启动后可并行)
        └── PP3 (Product Polish — 等 PP1 + PP2 closure)
```

**Critical path**: PP0 → PP1 → PP3 = 50-72 天（单工程师）
**并行窗口**: PP2 与 PP1 后半并行，节省 10-15 天

### 4.3 3 工程师并行模型

| Engineer | 承担 | 时间线 |
|---|---|---|
| A — Core Loop | PP1 全程 + PP3 部分 | 最重的 critical path |
| B — Connection | PP2 全程 + PP1 中 Hook 子项 | PP0 后立即启动 |
| C — Polish / e2e | PP0 charter + PP3 全程 + e2e 基础设施 | 前期轻、后期重 |

预计 3 工程师并行：**35-50 天 calendar**（对比 re-planning 的 56-80 天）。

---

## 5. 重新设计的 Design Doc 蓝图（6 份）

### 5.1 清单

| # | 文件 | 职责 | 何时写 |
|---|---|---|---|
| 1 | `docs/eval/pro-to-product/closing-thoughts-by-kimi.md` | 本 review 的 reasoning 沉淀 | PP0 Day 1-2 |
| 2 | `docs/charter/plan-pro-to-product.md` | Charter（含 6 truth gate、contingency、frontend schedule、observability baseline 作为章节） | PP0 Day 3-5 |
| 3 | `docs/architecture/pro-to-product-cross-cutting.md` | Truth architecture + frontend contract + honesty contract + observability baseline 合并为一份 | PP0 Day 3-7 |
| 4 | `docs/design/pro-to-product/PP1-core-product-loop.md` | HITL interrupt + Context budget + Hook delivery 统一 design | PP0 末段写，PP1 启动前 frozen |
| 5 | `docs/design/pro-to-product/PP2-connection-recovery.md` | Reconnect + Reliability 统一 design | PP1 Stage 1 写，PP2 启动前 frozen |
| 6 | `docs/design/pro-to-product/PP3-product-polish.md` | Policy + Observability + Final closure | PP2 中段写，PP3 启动前 frozen |

**总计：6 份**（含 charter 自身）。

### 5.2 被砍掉的 7 份

| re-planning 原文件 | 砍除理由 |
|---|---|
| `debt-acknowledgement-matrix.md` | HPX7 完成后 engineering debt 为 0，不需要矩阵 |
| `9-report-deferral-matrix-by-opus.md` | 9 份报告的 deferral 已在 hero-to-pro absorbed，不需要新矩阵 |
| `pro-to-product-honesty-contract.md` | 合并到 charter §10 + cross-cutting architecture |
| `pro-to-product-observability-baseline.md` | 合并到 charter §14 + cross-cutting architecture |
| `PP2-context-budget-closure.md` | 合并到 PP1 design |
| `PP4-hook-delivery-closure.md` | 合并到 PP1 design |
| `PP5-reliability-and-policy-honesty.md` | 拆分到 PP2（reliability）+ PP3（policy） |

---

## 6. 重新估算的工作量

### 6.1 各 phase（单工程师）

| Phase | 内容 | 估算 | vs re-planning |
|---|---|---|---|
| PP0 | charter + cross-cutting architecture + PP1 design | 5-7 天 | **-60%**(re-planning 12-18 天) |
| PP1 | Core Product Loop（HITL+Context+Hook） | 35-50 天 | **-30%**(re-planning PP1+PP2+PP4 = 50-71 天) |
| PP2 | Connection & Recovery | 20-30 天 | **≈**(re-planning PP3+PP5 = 30-44 天) |
| PP3 | Product Polish & Final | 10-15 天 | **≈**(re-planning PP6 = 10-15 天) |
| **总计单工程师** | — | **70-102 天 ≈ 3.5-5 人月** | **-30%**(re-planning 101-146 天) |
| **总计 3 工程师并行** | critical path = PP0+PP1+PP3 | **35-50 天 ≈ 1.5-2.5 人月** | **-35%**(re-planning 56-80 天) |

### 6.2 工期诚实性

这个估算与 initial-planning（60-90 天单 / 35-50 天三人）更接近，而不是 re-planning 的膨胀版本。

**关键假设**：
- PP1 的 35-50 天基于"interrupt 框架统一设计、三场景共享恢复路径"
- 如果 Hook 的 14/18 emit 真的需要全部接通，工期会上浮 5-10 天
- 如果 compact 不可行（contingency），PP1 内 scope-cut 到 manual compact，不影响整体工期

---

## 7. 对 re-planning 中具体 design 文件的评价

### 7.1 `pro-to-product-truth-architecture.md`（Tier 2.4）→ 保留但合并

这份 doc 的职责是定义"三层真相（D1/DO storage/DO memory）在 6 个闭环中的责任划分"。

**评价**：这是 re-planning 中**最有价值**的 Tier2 doc。但不需要单独成文，应该作为 cross-cutting architecture doc 的核心章节。

### 7.2 `PP1-hitl-interrupt-closure.md`（Tier 3.8）→ 扩展为 PP1 统一 design

re-planning 这份 doc 只覆盖 HITL。

**评价**：如果只写 HITL，PP2 的 compact interrupt 和 PP4 的 Hook interrupt 会重复解决同一个问题（scheduler 怎么 pause/resume）。应该扩展为"Interrupt Framework Design"，把三种 interrupt trigger（user/quota/tool）统一设计。

### 7.3 `PP2-context-budget-closure.md`（Tier 3.9）→ 砍除，合并到 PP1

re-planning 这份 doc 单独覆盖 Context。

**评价**：Context budget 的 interrupt 机制与 HITL 共享 scheduler。单独一份 design 会导致两份 doc 中"interrupt 状态机"章节互相复制。合并到 PP1 design 的"Quota-Driven Interrupt"子章节即可。

### 7.4 `PP4-hook-delivery-closure.md`（Tier 3.11）→ 砍除，合并到 PP1

re-planning 这份 doc 单独覆盖 Hook。

**评价**：Hook 的 PreToolUse 触发 confirmation，与 HITL 的 user-driven confirmation 是同一个 confirmation_pending 机制。Hook design 应该只写"Hook 如何接入已有的 confirmation 框架"，而不是重新设计 confirmation。

### 7.5 其余 per-phase designs → 按合并后的 phase 重组

不再逐一点评，原则一致：减少重复、共享框架、按技术主题而非政治边界组织。

---

## 8. Governance 维度的"减肥"方案

re-planning 引入了大量 governance 维度。我判断哪些是必需的，哪些是 overhead：

| Governance 维度 | re-planning 处理方式 | 我的判断 | 减肥方案 |
|---|---|---|---|
| **6 truth gate** | Primary Exit Criteria | **必需保留** | 作为 charter §10 表格 |
| **用户感知度矩阵** | 独立 §4.7 | 有用但过细 | 并入 charter §4 In-Scope 表的一列 |
| **前端介入 schedule** | 独立 §13，6 时点 | 方向正确但过细 | 简化为 3 个时点，写入 charter §12 |
| **性能基准 4 阈值** | 独立 §14 | 有用 | 作为 charter §14 的一张表 |
| **Contingency contract** | 独立 §15 | **必需保留** | 作为 charter §15 |
| **Debt acknowledgement gate** | 独立 Gate D1 | HPX7 后**不需要** | 从 charter 删除 |
| **Retained non-block gate** | 独立 Gate D2 | HPX7 后**不需要** | 从 charter 删除，4 项 owner-action 在 §2 一句话带过 |
| **工作量估算纪律 4 条** | 方法论第 8 条 | 有用 | 作为 charter §5 的一段话 |
| **工程组织模型 A/B** | 独立 §6.4 | 有用 | 作为 charter §6 的一张表 |

**结果**：charter 从 re-planning 提议的 14 节减到 **11 节**，删除 §2 中的 D1/D2 gate 专节、合并 §4.7/§13/§14 到对应章节。

---

## 9. 风险与 Contingency（精简版）

re-planning §7.6 §15 的 Top-3 risk contingency 有价值，但可以更聚焦：

### 9.1 真正的 Top-3 Risk

| 风险 | 触发条件 | Fallback |
|---|---|---|
| **R1: compact 不可行** | PP1 内 2 周无法实现真 summary 生成 | scope-cut 到 manual compact（confirmation `kind:context_compact`），不移除功能只降级体验 |
| **R2: hook 与 permission_rules 冲突** | PreToolUse 走 HookDispatcher 后，D1PermissionRulesPlane 的仲裁顺序不明确 |  fallback 到"先 permission_rules 后 Hook"，Hook 只用于 audit 不用于阻断 |
| **R3: reconnect restore 失败率高** | `restoreFromStorage` 接通 helper.restore 后，replay 仍 throw | 降级到 lagged contract only（不发 replay），只保证"不崩"不保证"无缝恢复" |

### 9.2 被 re-planning 高估的风险

- **scheduler interrupt regression**：这是 normal engineering risk，用测试覆盖即可，不需要 contingency contract
- **Hook 14/18 emit 全部接通**：这是 scope 问题，不是 risk。如果 14/18 太多，在 PP1 design 中就限定"只接通 PreToolUse + 2 个高频 hook"
- **D1 freeze 例外**：5 条例外条件已经足够严格，实际发生概率极低

---

## 10. 最终立场：对 re-planning 的裁决

### 10.1 采纳（正确且应保留）

1. **PP3 优先于 PP4** 的顺序调整
2. **6 truth gate** 作为 closure 纪律框架（但嵌入 charter，不单独成文）
3. **D1 freeze 受控例外** 原则
4. **前端早期介入** 的方向（但简化为 3 个时点）
5. **Truth architecture** 的技术必要性（但合并到 cross-cutting doc）
6. **工作量上调的必要性**（但上调到 70-102 天，不是 101-146 天）

### 10.2 修正（正确但过度）

1. **PP1 拆分** → 应合并回 PP1（HITL+Context+Hook），内部用 sub-task 区分
2. **13 份 design** → 应精简到 6 份
3. **PP0 18-23 天** → 应压缩到 5-7 天
4. **6 个 governance 维度** → 应精简到 3 个（truth gate + contingency + observability baseline）
5. **工作量 101-146 天** → 应修正到 70-102 天

### 10.3 否决（基于 HPX7 完成后已不成立）

1. **Debt Acknowledgement Gate（D1）** — HPX7 后 engineering debt 为 0
2. **Retained Non-Block Gate（D2）** — 4 项 owner-action 不需要 engineering gate
3. **Tier1.2 debt-matrix** — 不需要单独文档
4. **Tier1.3 deferral-matrix** — 9 份报告已 absorbed，不需要新矩阵
5. **Phase 数量 7 个** — 应合并为 4 个

### 10.4 新增（re-planning 漏掉的）

1. **HPX7 完成后的"干净起点"声明** — PP0 charter §2 应明确说"hero-to-pro 已 close-with-known-issues，engineering retained 为 0"
2. **PP1 的 interrupt 统一设计** — re-planning 把三种 interrupt 分散到三个 phase，应该统一
3. **e2e 基础设施前置** — re-planning 没有提到 cross-e2e 测试基础设施，但 hero-to-pro 的 cross-e2e 仍只有 1/52 pass。PP0 应该包含"让 cross-e2e 可跑"作为一项交付物。

---

## 11. 修订后的 Owner 决策清单

| 问题 | re-planning 提议 | 我的立场 | 建议 owner 决断 |
|---|---|---|---|
| Phase 数量 | 7 | **4** | 接受 4 还是坚持 7？ |
| PP1 是否合并 HITL+Context+Hook | 拆成 3 个 phase | **合并为 1 个** | 接受合并还是坚持拆分？ |
| Design doc 数量 | 13 | **6** | 接受 6 还是保留更多？ |
| PP0 工期 | 12-18 天 | **5-7 天** | 是否接受压缩？ |
| 单工程师总工期 | 101-146 天 | **70-102 天** | 哪个区间更可信？ |
| 6 truth gate 位置 | 单独 doc + charter | **仅 charter** | 是否接受不单独成文？ |
| Debt/Retained gate | D1 + D2 | **删除** | 是否接受 HPX7 后已不需要？ |
| Hook 14/18 emit | 全部接通 | **先接 3 个高频** | 接全部还是先 MVP？ |
| Cross-e2e 基础设施 | 未提及 | **PP0 必交付** | 是否接受？ |

---

## 12. 一句话定位（修订版）

> **pro-to-product = 把 hero-to-pro 已就绪的 workbench-grade backend substrate，通过统一的 interrupt 框架（HITL + Context + Hook）接通到 live agent loop，再补上 reconnect/recovery 的韧性层，最后完成 policy 诚实与 observability 抛光。阶段目标不是"写 13 份 design doc"，而是"让前端第一次能站在一个可交互、可恢复、可观测的产品级 backend 上"。**

---

## 维护约定

1. 本 review 是对 `re-planning-by-opus.md` 的独立审查，不是替代。
2. 如果 owner 采纳本 review 的立场，应据此修订 `re-planning-by-opus.md` 或直接写入 PP0 charter。
3. 本 review 与 re-planning 之间的分歧（Phase 数量、design 数量、工作量）应在 owner 决策后显式记录。

(End of file)
