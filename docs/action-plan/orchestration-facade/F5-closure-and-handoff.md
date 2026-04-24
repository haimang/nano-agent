# F5 — Closure and Handoff

> 服务业务簇: `orchestration-facade / F5 / closure-and-handoff`
> 计划对象: `对 F0-F4 产出做整体收口，并形成 final closure / handoff pack`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-24`
> 文件位置: `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`
> 关联设计 / 调研文档:
> - `docs/plan-orchestration-facade.md`
> - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
> - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
> - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
> - `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`
> - `docs/action-plan/orchestration-facade/F4-authority-hardening.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

F5 不是新实现 phase，而是 orchestration-facade 的**整阶段收口 phase**。到了这一轮，F0-F4 各自都应已有 closure；但没有 F5，就仍然缺一份单一答案来回答：

> **orchestration-facade 是否真的闭合了？下一阶段到底以什么输入继续？**

F5 的价值在于把分散在 design、action-plan、closure、live evidence、tenant law、legacy retirement 中的事实压成一套可直接被下游消费的 final closure / handoff pack，而不是让下一阶段作者自己重新翻整棵文档树。

- **服务业务簇**：`orchestration-facade / F5`
- **计划对象**：`Closure and Handoff`
- **本次计划解决的问题**：
  - `F0-F4 各自 closure 之后，仍缺少阶段级综合 verdict`
  - `下一阶段缺少 single handoff pack`
  - `meta 文档与阶段状态仍需要同步翻转`
- **本次计划的直接产出**：
  - `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
  - `docs/handoff/orchestration-facade-to-<next>.md`
  - `docs/issue/orchestration-facade/F5-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先审 F0-F4 closure 与 exit criteria、再写 final closure / handoff、最后更新 meta 文档与阶段状态** 的方式推进。F5 只消费已完成事实，不替上游 phase 发明“新的完成口径”，也不代写下一阶段 charter 正文。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | F0-F4 evidence review | `S` | 审阅各 phase closure 与 exit criteria | `F0-F4 completed` |
| Phase 2 | final closure / handoff pack | `M` | 写 final closure、handoff memo、F5 closure | `Phase 1` |
| Phase 3 | meta-doc 同步与阶段翻转 | `S` | 更新 charter 状态 / next-phase trigger docs | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — F0-F4 evidence review**
   - **核心目标**：证明 F0-F4 的局部完成能被拼成阶段完成
   - **为什么先做**：没有横向核对，final closure 只会复读局部乐观叙事
2. **Phase 2 — final closure / handoff pack**
   - **核心目标**：为 owner 与下游分别提供一份最短可消费真相包
   - **为什么放在这里**：只有 Phase 1 通过，handoff 才有可信基础
3. **Phase 3 — meta-doc 同步与阶段翻转**
   - **核心目标**：让仓库级状态表达与 final closure 保持一致
   - **为什么放在最后**：meta 翻转只能建立在 final closure 已存在之后

### 1.4 执行策略说明

- **执行顺序原则**：`先核对 phase evidence，再聚合结论，最后翻阶段状态`
- **风险控制原则**：`F5 只消费事实，不回头替 F0-F4 造新完成口径`
- **测试推进原则**：`以 closure evidence / live proof / 文档交叉核对为主，不重做实现期工作`
- **文档同步原则**：`final closure、handoff、meta-doc、charter state wording 一次对齐`

### 1.5 本次 action-plan 影响目录树

```text
F5 Closure and Handoff
├── docs/issue/orchestration-facade/
│   ├── F0-closure.md
│   ├── F1-closure.md
│   ├── F2-closure.md
│   ├── F3-closure.md
│   ├── F4-closure.md
│   ├── F5-closure.md
│   └── orchestration-facade-final-closure.md
├── docs/handoff/
│   └── orchestration-facade-to-<next>.md
├── docs/plan-orchestration-facade.md
└── next-phase trigger docs / eval docs (按实际需要)
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 审阅 F0-F4 closure、exit criteria 与 live evidence
- **[S2]** 产出 `orchestration-facade-final-closure.md`
- **[S3]** 产出 `orchestration-facade-to-<next>.md` handoff memo 与 `F5-closure.md`
- **[S4]** 同步阶段状态、next-phase triggers 与相关 meta 文档

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 回头重做 F1-F4 任一实施项
- **[O2]** 直接起草下一阶段完整 charter
- **[O3]** 新增产品能力或重开 design debate
- **[O4]** 再写一轮 design review 作为 F5 主体

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| final closure | `in-scope` | 这是 F5 的主交付物 | `F5 执行期` |
| next-phase charter 正文 | `out-of-scope` | F5 只交接，不代写 | `下一阶段启动时` |
| 回补遗漏实现 | `out-of-scope` | F5 只消费上游完成事实 | `若 closure 发现 blocker，再回对应 phase` |
| meta-doc 状态翻转 | `in-scope` | 仓库必须有单一阶段真相 | `F5 执行期` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | F0-F4 closure 审阅 | `update` | `docs/issue/orchestration-facade/F{0..4}-closure.md` | 确认各 phase 已具备可消费事实 | `medium` |
| P1-02 | Phase 1 | exit criteria 核对 | `update` | `charter + action-plans + closures` | 给阶段级 verdict 提供依据 | `high` |
| P2-01 | Phase 2 | final closure | `add` | `docs/issue/orchestration-facade/orchestration-facade-final-closure.md` | 给 owner 一份综合 verdict | `medium` |
| P2-02 | Phase 2 | handoff memo | `add` | `docs/handoff/orchestration-facade-to-<next>.md` | 给下游一份可直接消费的输入包 | `medium` |
| P2-03 | Phase 2 | F5 closure | `add` | `docs/issue/orchestration-facade/F5-closure.md` | 记录 F5 自身执行事实 | `low` |
| P3-01 | Phase 3 | meta-doc / charter state sync | `update` | `docs/plan-orchestration-facade.md` + next-phase triggers | 让仓库状态反映 phase closure | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — F0-F4 evidence review

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | F0-F4 closure 审阅 | 核对 5 份 phase closure 是否齐全、是否与 action-plan 交付物一致 | `F0-F4 closures` | 上游 phase 可被 F5 消费 | 文档 review | 5 份 closure 全齐 |
| P1-02 | exit criteria 核对 | 对照 charter / F0-F5 action-plan 检查阶段 exit criteria 是否全满足 | `charter + action-plans + closures` | final verdict 有 evidence 链 | 文档 review | 阶段 exit criteria 可逐条勾稽 |

### 4.2 Phase 2 — final closure / handoff pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | final closure | 聚合 F0-F4 结果、残余 follow-up、整体 verdict | `orchestration-facade-final-closure.md` | owner 可只读一份文档得出结论 | 文档 review | verdict 明确、不过度复述 |
| P2-02 | handoff memo | 把下游需要的输入包、依赖、已冻结真相与遗留 follow-up 压成 handoff | `orchestration-facade-to-<next>.md` | next-phase 作者可直接消费 | 文档 review | handoff 不越位代写下游 charter |
| P2-03 | F5 closure | 记录本 phase 自己的执行事实与证据来源 | `F5-closure.md` | F5 自身也可被审计 | 文档 review | F5 有独立 closure |

### 4.3 Phase 3 — meta-doc 同步与阶段翻转

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | meta-doc / charter state sync | 更新 `plan-orchestration-facade` 状态、next-phase trigger docs 与相关索引 | `plan-orchestration-facade.md` + related docs | 仓库状态表达与 final closure 一致 | 文档 review | 不再出现“phase 还在进行中”的旧口径 |

---

## 5. Phase 详情

### 5.1 Phase 1 — F0-F4 evidence review

- **Phase 目标**：证明 orchestration-facade 已经从 design 到实现都形成闭环
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `closure working notes`
- **具体功能预期**：
  1. 5 份上游 closure 都可直接引用
  2. charter exit criteria 有真实 evidence
  3. remaining follow-up 被识别为 next-phase inputs，而非未完成工作
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归；做文档交叉核对`
  - **手动验证**：`逐 phase 对照 closure / action-plan / live evidence`
- **收口标准**：
  - F0-F4 closure 齐全
  - 阶段 exit criteria 可逐条引用证据
- **本 Phase 风险提醒**：
  - 最容易把局部成功错写成阶段完成

### 5.2 Phase 2 — final closure / handoff pack

- **Phase 目标**：把 F0-F4 的碎片事实压成 owner 与下游都能直接消费的文档包
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
  - `docs/handoff/orchestration-facade-to-<next>.md`
  - `docs/issue/orchestration-facade/F5-closure.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. owner 只看 final closure 即可判断 phase 是否完成
  2. 下游只看 handoff 即可拿到 next-phase 输入包
  3. F5 自身 closure 记录本 phase 证据链
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归`
  - **手动验证**：`final closure / handoff / F5 closure 角色分工核对`
- **收口标准**：
  - 三份文档各自角色清楚、不互相重复
  - 下游不必重读全部 F0-F4 原始材料才能起步
- **本 Phase 风险提醒**：
  - 最容易把 handoff 写成“下游 charter 半成品”

### 5.3 Phase 3 — meta-doc 同步与阶段翻转

- **Phase 目标**：让仓库级状态表达与 final closure 同步翻转
- **本 Phase 对应编号**：
  - `P3-01`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/plan-orchestration-facade.md`
  - `next-phase trigger / index docs`
- **具体功能预期**：
  1. `plan-orchestration-facade` 状态从 active/reviewed 语气切到 closed/handoff-ready
  2. next-phase 触发条件被单一文档表达
  3. 仓库内不再存在“orchestration-facade 还未闭合”的旧口径
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归`
  - **手动验证**：`meta-doc / final closure / handoff 交叉核对`
- **收口标准**：
  - 阶段状态表达统一
  - next-phase trigger 可直接引用
- **本 Phase 风险提醒**：
  - 最容易只写 closure，不翻转 meta 状态

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 当前结论

本阶段 **不应再新增 owner-level blocker**。  
F5 的职责是消费 F0-F4 已完成事实，而不是重开设计问题。

### 6.2 问题整理建议

- 若 F5 仍发现真正 blocker，应回滚到对应 phase，而不是在 F5 临时修补完成口径
- handoff 中的 next-phase follow-up 应严格区分“已知后续工作”与“本阶段遗漏”

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| closure 只做聚合，不做核对 | final verdict 失真 | `high` | Phase 1 必须先做 evidence review |
| handoff 越位 | F5 很容易顺手写下游 charter 草稿 | `medium` | handoff 只给 inputs，不代写正文 |
| meta-doc 状态未翻 | 仓库仍出现双重叙事 | `medium` | Phase 3 必须同步状态翻转 |

### 7.2 约束与前提

- **技术前提**：`F0-F4 已各自 closure`
- **运行时前提**：`关键 live evidence、legacy negative tests、authority negative tests 都已存在`
- **组织协作前提**：`F5 不回头替 F1-F4 擦屁股`
- **上线 / 合并前提**：`final closure 与 handoff 都必须可独立被引用`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `无新增设计文档`
- 需要同步更新的说明文档 / README：
  - `按实际需要更新下一阶段入口文档`
- 需要同步更新的测试说明：
  - `若 final closure 发现索引文档需翻状态，则一并更新`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `F0-F4 closure 齐全`
  - `charter exit criteria 有证据链`
- **单元测试**：
  - `无`
- **集成测试**：
  - `无新增；消费上游现有 evidence`
- **端到端 / 手动验证**：
  - `final closure / handoff / meta-doc 交叉核对`
- **回归测试**：
  - `无代码回归`
- **文档校验**：
  - `final closure 与 handoff 各自能独立被 owner / 下游消费`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `F0-F4 closure 已全部被 F5 核对并纳入阶段级 verdict`
2. `orchestration-facade-final-closure.md` 已形成单一阶段结论
3. `orchestration-facade-to-<next>.md` 已形成可直接消费的 handoff pack
4. `F5-closure.md` 已记录本 phase 的执行事实与证据`
5. `仓库内阶段状态表达已同步翻转`

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `orchestration-facade 整阶段已形成单一 closure / handoff 事实包` |
| 测试 | `阶段级结论基于上游实际 evidence，而非口头判断` |
| 文档 | `final closure / handoff / meta-doc 同步完成` |
| 风险收敛 | `不再需要下游自己重新拼装阶段真相` |
| 可交付性 | `下一阶段可直接拿 handoff 开工` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`Phase 1 若 evidence 分散过度，核对成本会明显放大`
- **哪些编号的拆分还不够合理**：`若 final closure 与 handoff 写作仍频繁打架，可再细拆`
- **哪些问题本应更早问架构师**：`若 F5 才发现本应属于 F3/F4 的 blocker，说明上游 closure 不够硬`
- **哪些测试安排在实际执行中证明不够**：`若 final closure 缺关键 negative evidence，应回查上游 closure discipline`
- **模板本身还需要补什么字段**：`future 可为 handoff 增加“direct inputs / known non-goals”专栏`

---

## 10. 结语

这份 action-plan 以 **把 orchestration-facade 从一组局部完成推进成整阶段闭合事实** 为第一优先级，采用 **先核对 evidence、再压缩成 final closure / handoff、最后翻转 meta 状态** 的推进方式，优先解决 **阶段真相仍分散在多份文档** 与 **下游缺少单一输入包** 两个问题，并把 **不越位代写下游 charter、不回头偷补上游实现** 作为主要约束。整个计划完成后，`orchestration-facade / F5` 应达到 **阶段已正式闭合、下一阶段 handoff-ready** 的状态，从而为后续的 **新 charter / richer orchestrator / multi-tenant or credit domain 议题** 提供稳定起点。
