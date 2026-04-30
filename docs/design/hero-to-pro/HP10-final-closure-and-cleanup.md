# Nano-Agent 功能簇设计

> 功能簇: `HP10 Final Closure + Cleanup`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `docs/issue/zero-to-real/zero-to-real-final-closure.md:1-29,31-115,119-133`
> - `docs/issue/zero-to-real/ZX5-closure.md:1-39,41-90`
> - `docs/issue/real-to-hero/RHX2-closure.md:1-29,124-142`
> - `docs/runbook/zx5-r28-investigation.md:124-141`
> - `workers/agent-core/src/host/do/nano-session-do.ts:1-8`
> - `workers/orchestrator-core/src/user-do.ts:1-9`
> - `workers/orchestrator-core/src/index.ts:1880-1904`
> - `package.json:7-17`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（已冻结；本设计若与 QNA 冲突，以 QNA 为准）
> 文档状态: `reviewed`

---

## 0. 背景与前置约束

HP10 不是又一个实现 phase，它是整个 hero-to-pro 阶段的“封板规则”：

1. 当前仓库已经有明确的阶段 final closure precedent：`zero-to-real-final-closure.md` 不只是写一句“完成了”，而是包含 phase 映射、退出条件、最重要真相、未做事项和最终 verdict；这正是 HP10 需要延续的结构级 precedent（`docs/issue/zero-to-real/zero-to-real-final-closure.md:1-29,31-115,119-133`）。
2. 仓库也已经形成 per-phase closure precedent：例如 ZX5 closure 会把 action-plan、决定、已完成项、defer 项写成 phase-specific closure；RHX2 closure 则把 design/action-plan/spike evidence 一起挂进去（`docs/issue/zero-to-real/ZX5-closure.md:1-39,41-90`; `docs/issue/real-to-hero/RHX2-closure.md:1-29,124-142`）。
3. HP8/HP9 之前的某些“残余项”已经发生了现实变化：例如 `nano-session-do.ts` 与 `user-do.ts` 已分别退化为 re-export wrapper，而真正的大文件 owner 变成了别处；这说明 HP10 的 cleanup 决议必须基于**当前真实残余**，而不是基于历史名字想象（`workers/agent-core/src/host/do/nano-session-do.ts:1-8`; `workers/orchestrator-core/src/user-do.ts:1-9`; `workers/orchestrator-core/src/index.ts:1880-1904`）。
4. 当前 root pipeline 也还没有直接承载“final closure gate”的脚本位点，说明 HP10 必须把删除/保留/hand-off 的证据组织清楚，而不能假设已有一条现成命令替它做总结（`package.json:7-17`）。
5. R28 runbook 已经明确要求 owner 在 closure 文档中回填 root cause / chosen branch；HP10 要做的，是把这类 chronic issue 从“分散在 runbook/phase closure 的细节”提升为阶段总 closure 的统一分类（`docs/runbook/zx5-r28-investigation.md:124-141`）。

- **项目定位回顾**：HP10 的职责是把 hero-to-pro 的所有 phase 结果、残余项、保留项、移交项和下一阶段入口统一收口，而不是再新增任何功能。
- **本次讨论的前置共识**：
  - HP10 不能早于 HP9 closure 合法启动。
  - final closure 必须显式分类 residual，不允许写“已静默解决”。
  - retained-with-reason 是合法终态，但前提是 retained scope / reason / remove condition 都写清。
  - hero-to-platform 入口 stub 只登记 inherited issues，不抢写下一阶段实质内容。
- **本设计必须回答的问题**：
  - final closure 应如何组织 phase map、deferred map、F1-F17 chronic map 与 inherited issues？
  - cleanup 决议的最小分类集合是什么？
  - 哪些项允许 retained-with-reason，哪些项必须物理删除？
  - hero-to-platform stub 应记录到什么粒度才算“有入口但不越界”？
- **显式排除的讨论范围**：
  - hero-to-platform 的实质规划与实现
  - HP9 之后再新增任何功能
  - 再开新的 manual evidence 轮次

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP10 Final Closure + Cleanup`
- **一句话定义**：`把 hero-to-pro 的 phase 结果、残余 cleanup 决议、chronic deferral 最终判定与 hero-to-platform 入口统一固化成阶段封板文件。`
- **边界描述**：这个功能簇**包含** final closure、cleanup decision register、retained-with-reason registry、hero-to-platform stub；**不包含** 下一阶段实质内容、任何新功能、任何新增 manual evidence。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| final closure | 整个阶段的总收口文档 | 不等于某个 phase closure |
| residual cleanup | 对应删/该留/该移交项的最终决议 | 必须显式分类 |
| retained-with-reason | 因边界、成本或阶段范围保留，但已写清原因和移除条件 | 合法终态之一 |
| handed-to-platform | 明确移交 hero-to-platform 的 inherited issue | 不是模糊 defer |
| stage stub | 下一阶段入口文档 | 只登记 inherited issues 与范围边界 |

### 1.2 参考源码与现状锚点

- `docs/issue/zero-to-real/zero-to-real-final-closure.md:1-29,31-115,119-133` — 当前仓库已有完整 final closure precedent。
- `docs/issue/zero-to-real/ZX5-closure.md:1-39,41-90` 与 `docs/issue/real-to-hero/RHX2-closure.md:1-29,124-142` — 仓库已有 phase closure precedent。
- `docs/runbook/zx5-r28-investigation.md:124-141` — chronic issue 已有分散在 runbook 中的 closure backfill 入口。
- `workers/agent-core/src/host/do/nano-session-do.ts:1-8`, `workers/orchestrator-core/src/user-do.ts:1-9`, `workers/orchestrator-core/src/index.ts:1880-1904` — residual cleanup 必须基于当前现实，而不是历史文件名。
- `package.json:7-17` — 当前没有 final closure 级别的 root helper/script。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP10 在整体架构里扮演 **stage closure owner**。
- 它服务于：
  - hero-to-pro 阶段封板
  - inherited issues 的清晰 handoff
  - owner / reviewers 的最终合规判断
  - 下一阶段进入前的统一入口
- 它依赖：
  - HP8 chronic closure
  - HP9 docs/evidence/schema baseline
  - per-phase closure 文档
  - retained/deleted/handed-off 的最终判定
- 它被谁依赖：
  - hero-to-platform charter / stub
  - repo 历史审计
  -后续 review / closure / onboarding

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP8 chronic closure | HP8 -> HP10 | 强 | HP10 直接消费 HP8 的 retained / handoff 判定 |
| HP9 docs/evidence | HP9 -> HP10 | 强 | HP10 的合法启动依赖 HP9 closure |
| Per-phase closure docs | HP10 <- phase docs | 强 | HP10 不是凭空总结，必须回挂 phase closure |
| hero-to-platform stub | HP10 -> next stage | 强 | HP10 负责创建唯一入口 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP10 Final Closure + Cleanup` 是 **阶段封板与 inherited issues 出口 owner**，负责 **把 hero-to-pro 的全部 phase 结果、残余清理决议和下一阶段入口统一固化成 closure 体系**，对上游提供 **最终可审计 verdict**，对下游要求 **hero-to-platform 继承问题来源清晰、边界不混乱**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| final closure 只写口头总结 | 仓库已有完整 precedent | 无法支撑 inherited issue handoff | 否 |
| 用“silently resolved”处理残余项 | 历史 closure 风险 | 会让 stage boundary 再次模糊 | 否 |
| 在 stub 里直接写 hero-to-platform 实质内容 | 很容易过界 | 会混淆阶段边界 | 否 |
| cleanup 只写“建议删除”不做分类登记 | 省事 | HP10 后无法追踪为什么保留/删除 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| final closure structure | `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` | phase map + deferred map + chronic map + inherited issues | future 可扩指标/dashboard 链接 |
| retained registry | final closure 内独立 section | retained-with-reason 明细 | future 可拆成机器可读 JSON |
| stage stub | `docs/charter/plan-hero-to-platform.md` | 只登记 inherited issues 与范围 | future 由下一阶段重写成正式 charter |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：hero-to-pro final closure 与 hero-to-platform 正式 charter。
- **解耦原因**：一个负责总结和移交，一个负责下一阶段的目标设定；混在一起会同时破坏两边边界。
- **依赖边界**：HP10 只负责创建 stub 和 inherited issues 索引，不负责替下一阶段做架构决定。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：phase 状态、deferred map、chronic F1-F17、cleanup 决议、inherited issues。
- **聚合形式**：统一收敛到 final closure 与 plan stub。
- **为什么不能分散**：这些内容如果继续分散在 ZX5/RHX2/HP8/HP9 多处文档里，阶段结束后就没有唯一入口可追。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent 以当前仓库源码锚点为 authoritative evidence；若出现 `context/*`，仅作 external ancestry pointer。

### 4.1 zero-to-real final closure 的做法

- **实现概要**：`zero-to-real-final-closure.md` 采用了“phase 映射 -> 退出条件 -> 最重要真相 -> 明确未做 -> operational notes -> verdict”的强结构化闭合方式（`docs/issue/zero-to-real/zero-to-real-final-closure.md:1-29,31-115,119-133`）。
- **亮点**：
  - final closure 有清晰的信息分区，而不是大段叙述
- **值得借鉴**：
  - phase map
  - explicit remaining issues
  - final verdict
- **不打算照抄的地方**：
  - 直接复用 zero-to-real 的问题分类而不做 hero-to-pro 的 chronic/F1-F17 适配

### 4.2 phase closure 的做法

- **实现概要**：ZX5 closure 偏 action-plan + decision + defer；RHX2 closure 偏 design/action-plan/spike evidence 绑定。两者共同说明：phase closure 应各自完整，而 final closure 负责统一回挂（`docs/issue/zero-to-real/ZX5-closure.md:1-39,41-90`; `docs/issue/real-to-hero/RHX2-closure.md:1-29,124-142`）。
- **亮点**：
  - 每个 phase 的证据和 deferred 都已各自成文
- **值得借鉴**：
  - final closure 只做归并，不重复把 phase 实现细节整段搬运
- **不打算照抄的地方**：
  - 在 final closure 中继续保留 phase 级展开细节

### 4.3 当前仓库的 residual reality

- **实现概要**：一些历史“需要 cleanup 的文件名”已经变化为 wrapper，而另一些 owner file 仍保持高行号，这说明 HP10 的 cleanup register 必须基于当前 repo reality（`workers/agent-core/src/host/do/nano-session-do.ts:1-8`; `workers/orchestrator-core/src/user-do.ts:1-9`; `workers/orchestrator-core/src/index.ts:1880-1904`）。
- **亮点**：
  - 当前 repo reality 已足以支撑“按现在而不是按历史”做 cleanup 决策
- **值得借鉴**：
  - retained/deleted 以当前 owner 文件与现行责任为准
- **不打算照抄的地方**：
  - 继续按历史名词做清理决议

### 4.4 横向对比速查表

| 维度 | zero-to-real final closure | phase closures | HP10 倾向 |
|------|----------------------------|---------------|----------|
| 信息组织 | 强结构化 | phase-specific | 结合两者 |
| retained/handoff | 有但不够系统 | 分散 | 提升为显式 registry |
| 下一阶段入口 | 无单独 stub | N/A | 新建 stage stub |
| cleanup 依据 | 阶段事实 | 局部事实 | 以当前 repo reality 为准 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** hero-to-pro final closure 主文档。
- **[S2]** residual cleanup 分类与 retained-with-reason registry。
- **[S3]** chronic F1-F17 最终判定归并。
- **[S4]** hero-to-platform 入口 stub。
- **[S5]** per-phase closure 回挂与 inherited issues 索引。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** hero-to-platform 的实质路线设计 —— 留给下一阶段；重评条件：stub 建立后。
- **[O2]** HP9 之后再补 manual evidence —— 不在 HP10；重评条件：HP9 未 closure 时 HP10 不启动。
- **[O3]** 新功能开发 —— HP10 只做 cleanup + closure；重评条件：无。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| retained-with-reason 是否等于“先不管” | out-of-scope | retained 必须有范围、理由、移除条件 | HP10 retained registry |
| hero-to-platform stub 是否可提前写详细方案 | out-of-scope | 会越界到下一阶段 charter | 仅登记 inherited issues |
| final closure 是否应重复 phase 施工细节 | out-of-scope | final closure 负责归并，不是 phase log 再写一遍 | phase closure 继续承载细节 |
| 应删项是否可不做 grep/显式核对 | out-of-scope | 这会让 cleanup 变成口头承诺 | HP10 cleanup verification |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **final closure 强结构化归并**，而不是 **写成一篇叙述性总结**
   - **为什么**：只有结构化，phase map / chronic map / inherited issues 才可检索、可复核。
   - **我们接受的代价**：文档准备工作量更高。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **cleanup 分类显式化**，而不是 **只说“有些删了、有些留下”**
   - **为什么**：HP10 的价值之一就是给下一阶段一个可审计的边界。
   - **我们接受的代价**：需要为每个 retained 项补理由和移除条件。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **hero-to-platform stub 只做入口，不抢写实质内容**，而不是 **趁 HP10 顺手把下一阶段也规划掉**
   - **为什么**：阶段边界一旦混淆，HP10 就无法真正封板。
   - **我们接受的代价**：stub 会显得保守。
   - **未来重评条件**：下一阶段正式启动时。

4. **取舍 4**：我们选择 **cleanup 决议以当前 repo reality 为准**，而不是 **继续沿用历史问题名词**
   - **为什么**：例如 `nano-session-do.ts` / `user-do.ts` 已经基本被拆空，继续围绕旧名字下决议会失真。
   - **我们接受的代价**：需要重新核对当前残余 owner。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| HP10 提前启动 | HP9 未 closure | final closure 无法合法完成 | HP10 启动前显式检查 HP9 gate |
| retained 项理由写不清 | cleanup 决议匆忙 | 下一阶段接不动 | retained registry 必须含 remove condition |
| final closure 只是 phase closure 拼接 | 归并时偷懒 | 信息噪音大、入口失效 | 使用结构化 section 而非全文拼接 |
| stub 越界成下一阶段规划 | 想一次做完 | 破坏阶段边界 | stub 只登记 inherited issues / O1-O15 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：阶段结束后会有一个真正可引用、可复盘、可交接的唯一入口。
- **对 nano-agent 的长期演进**：HP10 把 hero-to-pro 从“做完一堆工作”升级为“完成一次可审计的阶段封板”。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：只有在 HP10 里把 retained/deleted/handed-off 讲清楚，后续稳定性工作才不会反复回头追旧债。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | final closure memo | hero-to-pro 总收口文档 | ✅ 阶段第一次拥有唯一 closure 入口 |
| F2 | cleanup decision register | 删除/保留/移交分类 | ✅ residual 不再模糊存在 |
| F3 | chronic map merge | F1-F17 与 105 项 deferred 统一判定 | ✅ chronic issue 第一次集中可查 |
| F4 | hero-to-platform stub | 下一阶段入口与 inherited issues 索引 | ✅ 下一阶段不会从零摸索入口 |
| F5 | closure law verification | 启动条件与不合格条件 | ✅ HP10 完成定义第一次被写死 |

### 7.2 详细阐述

#### F1: final closure memo

- **输入**：HP0-HP10 phase closures、HP8 chronic register、HP9 docs/evidence/prod baseline
- **输出**：`docs/issue/hero-to-pro/hero-to-pro-final-closure.md`
- **主要调用者**：owner、reviewers、hero-to-platform
- **核心逻辑**：
  - final closure 至少包含：
    1. 阶段总览（phase map + 4 套状态机最终状态）
    2. deferred / inherited issues map
    3. chronic F1-F17 最终判定
    4. hero-to-platform handoff 清单
    5. final verdict
  - 每个 phase 只引用 phase closure，不重复大段拷贝施工日志
- **边界情况**：
  - 任一 primary gate 未满足时，不得写 `closed`
  - 允许 `partial-close / cannot-close / handoff-ready` 等显式 verdict
- **一句话收口目标**：✅ **hero-to-pro 第一次拥有真正意义上的阶段总 closure**。

#### F2: cleanup decision register

- **输入**：历史 residual、当前 repo reality、HP8 retained/handoff 判定
- **输出**：final closure 中的 cleanup register
- **主要调用者**：HP10 closure、hero-to-platform inherited issues
- **核心逻辑**：
  - cleanup register 最小分类冻结为：
    1. `deleted`
    2. `retained-with-reason`
    3. `handed-to-platform`
  - `retained-with-reason` 至少包含：
    - retained object
    - why retained
    - remove condition
    - current owner
  - `deleted` 至少包含：
    - deleted object
    - verification method（grep/test/manual scan）
- **边界情况**：
  - 不允许 `silently resolved`
  - 不允许“应该删，但本次先不记”
- **一句话收口目标**：✅ **HP10 之后，每一项残余都只会以显式分类存在**。

#### F3: chronic map merge

- **输入**：F1-F17 chronic items、105 项 deferred、phase closures
- **输出**：统一 chronic/deferred map
- **主要调用者**：owner、reviewers、next stage
- **核心逻辑**：
  - 105 项 deferred 与 F1-F17 chronic 不可分别散落
  - 每项至少归入：
    - `closed`
    - `accepted-as-risk`
    - `retained-with-reason`
    - `handed-to-platform`
  - chronic map 应直接引用 HP8/HP9 的 hard gate 结论
- **边界情况**：
  - 一项问题可以同时属于 deferred 与 chronic，但在 final closure 里只能有一条 canonical verdict
- **一句话收口目标**：✅ **历史 carryover 第一次从多处文档分散状态被压成统一判定表**。

#### F4: hero-to-platform stub

- **输入**：HP10 inherited issues 清单
- **输出**：`docs/charter/plan-hero-to-platform.md`
- **主要调用者**：下一阶段 owner / architect / reviewer
- **核心逻辑**：
  - stub 只包含：
    - inherited issues list
    - O1-O15 / retained items 来源
    - 本阶段不再覆盖的边界说明
  - 不写下一阶段 action-plan、设计细节或阶段目标展开
- **边界情况**：
  - stub 必须足够让下一阶段“有入口”
  - 但不能写到足以替代真正 charter
- **一句话收口目标**：✅ **下一阶段入口第一次被正式创建，而不是靠聊天上下文接力**。

#### F5: closure law verification

- **输入**：HP8/HP9 完成状态、cleanup register、stub
- **输出**：HP10 是否可 closure 的合法结论
- **主要调用者**：HP10 执行者、reviewers
- **核心逻辑**：
  - HP10 启动前必须确认：
    1. HP9 已 closure
    2. manual evidence / prod baseline 已 explicit
    3. HP8 chronic items 已 explicit
  - HP10 完成前必须确认：
    1. final closure 文档已落地
    2. cleanup register 已分类
    3. hero-to-platform stub 已创建
- **边界情况**：
  - 缺任一项即 `cannot close`
- **一句话收口目标**：✅ **HP10 的“完成”第一次有严格法律定义，而不是主观感觉**。

### 7.3 非功能性要求与验证策略

- **性能目标**：HP10 以文档/核对为主，不引入大规模实现成本。
- **可观测性要求**：final closure 必须可追溯回 phase closure 和 evidence。
- **稳定性要求**：所有 retained/deleted/handoff 结论都必须能被后续复核。
- **安全 / 权限要求**：closure/stub 不得写入 secrets 或敏感生产信息。
- **测试覆盖要求**：
  - final closure section 完整性检查
  - retained/deleted/handoff 分类完整性检查
  - hero-to-platform stub 存在性检查
- **验证策略**：以“文档存在 + 分类完整 + gate 满足”三项同时成立为准。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent closure 源码 | HP10 以当前仓库 closure precedent 为主 | 不再通过二手 markdown 转述 |

### 8.2 来自外部 precedent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 `context/` 外部 agent 的 closure/stub 源码 | HP10 以当前仓库 phase/final closure 传统为主 | 保持空缺 |

### 8.3 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `docs/issue/zero-to-real/zero-to-real-final-closure.md:1-29,31-115,119-133` | 仓库已有 final closure 强结构 precedent | HP10 继续沿用结构化 closure，而不是自由叙述 |
| `docs/issue/zero-to-real/ZX5-closure.md:1-39,41-90` 与 `docs/issue/real-to-hero/RHX2-closure.md:1-29,124-142` | phase closure 已自带 action-plan / evidence 回挂 | HP10 只做归并，不重复 phase 实现细节 |
| `docs/runbook/zx5-r28-investigation.md:124-141` | chronic issue 回填仍散在 runbook | HP10 要把这类结论上提到 final closure |
| `workers/agent-core/src/host/do/nano-session-do.ts:1-8` 与 `workers/orchestrator-core/src/user-do.ts:1-9` | 历史 megafile 名称已失真 | cleanup register 必须基于当前 repo reality |
| `workers/orchestrator-core/src/index.ts:1880-1904` | 真正的大 owner file 仍存在 | HP10 cleanup 不得忽视当前残余 owner |
| `package.json:7-17` | 当前没有 final closure helper | HP10 需要靠明确 closure law 而不是现成脚本 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP10-D1` | final closure 是否允许“silently resolved”分类？ | HP10 / review / handoff | 否 | `frozen` | 仓库已有强结构 final closure precedent，但未完成项必须显式陈列：`docs/issue/zero-to-real/zero-to-real-final-closure.md:99-115` |
| `HP10-D2` | cleanup register 是否按历史文件名决议？ | HP10 / cleanup | 否；按当前 repo reality | `frozen` | 旧 megafile 入口已被拆空，当前 owner 已变化：`workers/agent-core/src/host/do/nano-session-do.ts:1-8`, `workers/orchestrator-core/src/user-do.ts:1-9`, `workers/orchestrator-core/src/index.ts:1880-1904` |
| `HP10-D3` | hero-to-platform stub 是否可以写实质计划？ | HP10 / next stage | 否；只写 inherited issues 入口 | `frozen` | HP10 的角色是封板和移交，不是替下一阶段立正式 charter |
| `HP10-D4` | retained-with-reason 是否是合法终态？ | HP10 / inherited issues | 是，但必须带 remove condition | `frozen` | HP8/HP10 要解决的是“模糊残留”，不是“强行全部删除” |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. final closure 的 section 结构已经写清。
2. cleanup register 的分类已经写清。
3. hero-to-platform stub 的边界已经写清。
4. HP10 启动与 closure 的 gate 条件已经写清。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP10-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md`
  - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md`
- **实现前额外提醒**：
  - HP10 不应再接受任何“先写 final closure，后补证据/判定”的倒序做法。

---

## 10. Value Verdict

### 10.1 价值结论

`HP10 Final Closure + Cleanup` 是 hero-to-pro 成为一个“真正结束的阶段”所必需的最后一步。没有它，前面所有工作都仍然只是大量 phase closure 的堆叠，而不是一次可审计、可移交的阶段封板。

### 10.2 对 charter 目标的支撑度

它直接支撑：

1. hero-to-pro 的 Final Closure Gate
2. 下一阶段 hero-to-platform 的唯一入口
3. 全阶段 retained/deleted/handed-off 的统一审计

### 10.3 当前建议

- **建议状态**：`approved-for-action-plan`
- **原因**：当前仓库 precedent、cleanup 现实与 closure 边界都已经足够明确，可以进入 action-plan。
