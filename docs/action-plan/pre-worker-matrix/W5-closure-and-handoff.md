# W5 — Closure & Handoff

> 服务业务簇: `pre-worker-matrix / W5 / closure-and-handoff`
> 计划对象: `对 W0-W4 产出做横向一致性收口，并生成 final closure / handoff pack`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-22`
> 文件位置: `docs/action-plan/pre-worker-matrix/W5-closure-and-handoff.md`
> 关联设计 / 调研文档:
> - `docs/plan-pre-worker-matrix.md`
> - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
> - `docs/action-plan/pre-worker-matrix/W0-nacp-consolidation.md`
> - `docs/action-plan/pre-worker-matrix/W1-cross-worker-protocols.md`
> - `docs/action-plan/pre-worker-matrix/W2-publishing-pipeline.md`
> - `docs/action-plan/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
> - `docs/action-plan/pre-worker-matrix/W4-workers-scaffolding.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

W5 不是新的实现 phase，而是 pre-worker-matrix 的**整体收口 phase**。W0-W4 各自产出 closure memo 之后，仍然需要一个独立执行计划把这些产物拉到同一张桌子上：检查横向 5 对角线一致性、形成 final closure、形成 handoff memo、更新 meta-doc，并把 `plan-worker-matrix.md` 正式切到 `needs-rewrite-r2` 的下一阶段状态。

如果没有 W5，pre-worker-matrix 就只有“5 份各自成立的局部计划”，没有“整个阶段是否真的 ready 进入 worker-matrix”的单一执行路径。W5 的价值正是在这里：它不重跑实现，不重写 design，但把 W0-W4 的收窄成果压成一个可被下游直接消费的 SSOT handoff pack。

- **服务业务簇**：`pre-worker-matrix / W5`
- **计划对象**：`Pre-Worker-Matrix Closure & Handoff`
- **本次计划解决的问题**：
  - `W0-W4 各自 closure 之后，缺少整体聚合与横向一致性检查`
  - `charter r2 §11 的第 6 条 handoff 就绪缺少执行路径`
  - `worker-matrix charter r2 作者缺少可直接消费的 input pack`
- **本次计划的直接产出**：
  - `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
  - `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
  - `docs/issue/pre-worker-matrix/W5-closure.md`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先审 W0-W4 closure 与横向一致性、再写 final closure / handoff、最后更新 meta-doc 与 charter 状态** 的方式推进。W5 不做代码，不补 deploy，不替上游 phase 擦屁股；它的职责是把“已经完成的事实”核成一套单一可信的交接包。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | closure 审阅与横向核对 | `S` | 审阅 W0-W4 closure，并完成 X2 五条对角线检查 | `W0-W4 completed` |
| Phase 2 | final closure 与 handoff | `M` | 写 final closure、handoff memo、W5 自身 closure | `Phase 1` |
| Phase 3 | meta-doc 更新与 charter 解锁 | `S` | 更新 gate-truth / after-foundations final closure，并触发 worker-matrix rewrite 状态 | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — closure 审阅与横向核对**
   - **核心目标**：确认 W0-W4 各自 closure 可用，且 5 条对角线一致性成立
   - **为什么先做**：没有事实核对，后面的 final closure 只会重复局部乐观叙事
2. **Phase 2 — final closure 与 handoff**
   - **核心目标**：把 W0-W4 的结果压成 1 份 final closure + 1 份 handoff memo + 1 份 W5 closure
   - **为什么放在这里**：只有横向一致性已成立，handoff 才值得下游直接消费
3. **Phase 3 — meta-doc 更新与 charter 解锁**
   - **核心目标**：更新跨阶段索引文档，并把 worker-matrix charter 切换到 rewrite-ready 状态
   - **为什么放在这里**：meta 与状态变更必须建立在 final closure 产出之后

### 1.4 执行策略说明

- **执行顺序原则**：`先核对，再聚合，最后解锁下游 charter`
- **风险控制原则**：`W5 只消费事实，不替 W0-W4 发明新完成口径`
- **测试推进原则**：`以 closure evidence + 文档交叉核对为主，不重跑代码测试`
- **文档同步原则**：`final closure / handoff / meta-doc / charter state wording 一次对齐`

### 1.5 本次 action-plan 影响目录树

```text
W5 Closure & Handoff
├── Phase 1: closure 审阅与横向核对
│   ├── docs/issue/pre-worker-matrix/W0-closure.md
│   ├── docs/issue/pre-worker-matrix/W1-closure.md
│   ├── docs/issue/pre-worker-matrix/W2-closure.md
│   ├── docs/issue/pre-worker-matrix/W3-closure.md
│   └── docs/issue/pre-worker-matrix/W4-closure.md
├── Phase 2: final closure 与 handoff
│   ├── docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md
│   ├── docs/handoff/pre-worker-matrix-to-worker-matrix.md
│   └── docs/issue/pre-worker-matrix/W5-closure.md
└── Phase 3: meta-doc 更新与 charter 解锁
    ├── docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md
    ├── docs/issue/after-foundations/after-foundations-final-closure.md
    └── docs/plan-worker-matrix.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 审阅并确认 W0-W4 各自 closure memo 已 shipped 且可被 W5 消费
- **[S2]** 执行 W5 design 定义的横向 5 对角线一致性检查
- **[S3]** 产出 final closure、handoff memo 与 W5 自身 closure
- **[S4]** 更新 meta-doc，并触发 `plan-worker-matrix.md` 进入 rewrite-ready 状态

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 修改 `packages/*` 或 `workers/*` 的任何代码
- **[O2]** 重跑 W0-W4 已完成的全量 regression / deploy / publish
- **[O3]** 直接重写 `docs/plan-worker-matrix.md`
- **[O4]** 提前给 Tier B packages 打 deprecated banner 或执行 worker absorb

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| W0-W4 closure memo 聚合 | `in-scope` | 这是 W5 的核心职责 | `W5 执行期` |
| 横向 5 对角线检查 | `in-scope` | 单个 phase closure 不会自动完成 | `W5 执行期` |
| `plan-worker-matrix.md` 全文重写 | `out-of-scope` | W5 只触发 rewrite，不直接代写 | `worker-matrix charter r2` |
| 因 W4 凭据缺失而补一次真实 deploy | `out-of-scope` | W5 只记录 fallback 或 real 事实，不反向执行 W4 | `worker-matrix P0` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | W0-W4 closure 审阅 | `update` | `docs/issue/pre-worker-matrix/W{0,1,2,3,4}-closure.md` | 确认 5 份上游 closure 可消费 | `medium` |
| P1-02 | Phase 1 | 横向 5 对角线检查 | `update` | `W0/W1/W2/W3/W4 closures + action-plans` | 核对 cross-phase consistency | `high` |
| P1-03 | Phase 1 | 6 就绪状态判定 | `update` | `charter + closures + handoff inputs` | 给 handoff memo 提供 readiness 表 | `medium` |
| P2-01 | Phase 2 | pre-worker final closure | `add` | `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md` | 给 owner 一份阶段综合结论 | `medium` |
| P2-02 | Phase 2 | worker-matrix handoff memo | `add` | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | 给下游一份直接可消费 input pack | `medium` |
| P2-03 | Phase 2 | W5 closure memo | `add` | `docs/issue/pre-worker-matrix/W5-closure.md` | 记录 W5 自身执行事实 | `low` |
| P3-01 | Phase 3 | meta-doc 更新 | `update` | `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` `docs/issue/after-foundations/after-foundations-final-closure.md` | 让跨阶段索引反映 pre-worker close 状态 | `medium` |
| P3-02 | Phase 3 | charter state flip | `update` | `docs/plan-worker-matrix.md` | 把 worker-matrix charter 切到 `needs-rewrite-r2` | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — closure 审阅与横向核对

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | W0-W4 closure 审阅 | 核对 5 份 phase closure 是否齐全、是否与对应 action-plan/设计 scope 一致 | `docs/issue/pre-worker-matrix/W{0..4}-closure.md` | 上游 closure 可被 W5 消费 | 文档 review | 5 份 closure 全齐，且无明显 scope 漂移 |
| P1-02 | 横向 5 对角线检查 | 核对 W0 evidence/import truth、W1 RFC、W2 publish path、W3 blueprint、W4 shell/deploy evidence 之间的 5 条对角线一致性 | `closures + action-plans + design` | cross-phase consistency 成立 | 文档 review / grep | 5 条对角线逐条有 verdict |
| P1-03 | 6 就绪状态判定 | 把协议 topology / package 策略 / import-publish / orphan 决定 / scaffold / handoff 六项状态明确写成 ready table | `charter + closures` | handoff 输入表稳定 | 文档 review | 6 就绪状态可直接被下游引用 |

### 4.2 Phase 2 — final closure 与 handoff

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | pre-worker final closure | 聚合 W0-W4 结果、遗留项、6 就绪状态与整体 verdict | `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md` | owner 可直接得到阶段综合结论 | 文档 review | 不重复局部细节，但给出完整 verdict |
| P2-02 | worker-matrix handoff memo | 把下游需要的输入浓缩成 input pack、rewrite checklist、open items | `docs/handoff/pre-worker-matrix-to-worker-matrix.md` | charter r2 作者可直接消费 | 文档 review | handoff 不越位代写下游 charter |
| P2-03 | W5 closure memo | 记录 W5 自身执行项、证据来源、发现与状态翻转 | `docs/issue/pre-worker-matrix/W5-closure.md` | W5 自己也有 phase closure | 文档 review | W5 自身 evidence 完整 |

### 4.3 Phase 3 — meta-doc 更新与 charter 解锁

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | meta-doc 更新 | 更新 gate-truth 与 after-foundations final closure，使其反映 pre-worker 已闭环 | `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md` `docs/issue/after-foundations/after-foundations-final-closure.md` | 跨阶段索引同步到最新真相 | 文档 review | revision history 与状态叙事一致 |
| P3-02 | charter state flip | 把 `docs/plan-worker-matrix.md` 从 deprecated 切到 `needs-rewrite-r2`，只解锁不重写 | `docs/plan-worker-matrix.md` | 下游 cycle 被显式解锁 | 文档 review | charter 状态明确、rewrite checklist 可见 |

---

## 5. Phase 详情

### 5.1 Phase 1 — closure 审阅与横向核对

- **Phase 目标**：先证明 pre-worker-matrix 真的收敛成一组可交付事实
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `W5 执行中使用的 closure checklist / notes`
- **具体功能预期**：
  1. 5 份上游 closure 都可被引用
  2. 横向 5 对角线检查逐条有结论
  3. 6 就绪状态不再只是 design 口号，而是 evidence-backed table
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归；做文档交叉核对`
  - **手动验证**：`逐条检查 closure / action-plan / design / charter 的引用关系`
- **收口标准**：
  - 5 份 closure 齐全
  - 5 条对角线均得到 `pass / partial / blocked` 明确 verdict
  - 6 就绪状态表可直接写进 handoff
- **本 Phase 风险提醒**：
  - 最容易把“局部完成”误写成“阶段完成”
  - 最容易忽略 W2 optional 首发、W4 credentials fallback 这类条件分支

### 5.2 Phase 2 — final closure 与 handoff

- **Phase 目标**：把上游分散的 closure 压成最终阶段结论与下游输入包
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
  - `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
  - `docs/issue/pre-worker-matrix/W5-closure.md`
- **本 Phase 修改文件**：
  - `无`
- **具体功能预期**：
  1. final closure 只给综合判断，不再逐条复述 W0-W4 全量细节
  2. handoff memo 以 6 就绪 + open items + rewrite checklist 为中心
  3. W5 closure 记录本 phase 的具体执行事实与证据来源
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归`
  - **手动验证**：`交叉阅读 final closure / handoff / W5 closure，确认角色分工不重叠`
- **收口标准**：
  - owner 可只读 final closure 判断阶段是否完成
  - 下游可只读 handoff memo 开始 worker-matrix charter r2 rewrite
  - W5 自身也有可被后续审计引用的 closure
- **本 Phase 风险提醒**：
  - 最容易把 handoff 写成下游 charter 草稿，越位设计
  - 最容易把 final closure 写成 closure memo 的复制粘贴合集

### 5.3 Phase 3 — meta-doc 更新与 charter 解锁

- **Phase 目标**：把 pre-worker close 的结果同步进跨阶段索引与下游状态机
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `无`
- **本 Phase 修改文件**：
  - `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`
  - `docs/issue/after-foundations/after-foundations-final-closure.md`
  - `docs/plan-worker-matrix.md`
- **具体功能预期**：
  1. gate-truth 的 revision history 明确出现 pre-worker closure 集成
  2. after-foundations final closure 不再误导当前 gate 状态
  3. `plan-worker-matrix.md` 明确进入 `needs-rewrite-r2`，但不在 W5 内被重写
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`无代码回归`
  - **手动验证**：`检查 3 份 meta 文档对同一状态的描述是否一致`
- **收口标准**：
  - meta-doc 与 final closure / handoff 口径一致
  - worker-matrix charter 状态明确从 deprecated 进入 rewrite-ready
- **本 Phase 风险提醒**：
  - 最容易在 meta-doc 更新时保留旧 phase 的过满叙事

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 3`
- **为什么必须确认**：`关系到 W5 是否只触发 worker-matrix rewrite，还是顺手代写下游 charter`
- **当前建议 / 倾向**：`W5 只触发 rewrite，不直接代写`
- **Q**：`W5 是否只负责把 plan-worker-matrix.md 切到 needs-rewrite-r2，而不在本 phase 内直接重写其正文？`
- **A**：`是。W5 只负责状态解锁与 handoff，不越位代写 worker-matrix charter r2。`

#### Q2

- **影响范围**：`Phase 1 / Phase 2`
- **为什么必须确认**：`关系到 W4 credentials fallback 与 W2 first-publish optional 如何进入最终 verdict`
- **当前建议 / 倾向**：`W5 应接受条件完成态，只要 closure 诚实、evidence 完整即可`
- **Q**：`W5 是否接受 W2 “skeleton complete / first publish deferred” 与 W4 “shell-deployable pending credentials” 作为合法 handoff 状态？`
- **A**：`是。W5 接受这两类条件完成态，只要求 closure 和 handoff 明确写清当前路径与后续触发条件。`

### 6.2 问题整理建议

- 只保留会改变 W5 是否越位到下游 charter / 是否否定条件完成态的问题
- 不在 W5 重新打开 W0-W4 的设计争论

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 上游 closure 缺失或过满 | W5 只能消费已存在 closure，不能替上游重做实现 | `high` | Phase 1 先审 closure，再决定是否允许进入 Phase 2 |
| 条件完成态被误判为失败 | W2/W4 都存在 design-level fallback | `medium` | 在 final closure / handoff 显式写条件完成与触发条件 |
| handoff 越位 | 容易把 W5 写成 worker-matrix charter 草稿 | `medium` | 明确 handoff 只给 input pack + rewrite checklist |

### 7.2 约束与前提

- **技术前提**：`W0-W4 的 action-plan 与 closure 已存在且可读`
- **运行时前提**：`W5 纯文档 phase，不新增 deploy / test 负担`
- **组织协作前提**：`owner 接受 W5 只做收口与解锁，不越位代写下游 charter`
- **上线 / 合并前提**：`meta-doc / final closure / handoff / charter state wording 保持一致`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
- 需要同步更新的说明文档 / README：
  - `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`
  - `docs/issue/after-foundations/after-foundations-final-closure.md`
- 需要同步更新的测试说明：
  - `docs/issue/pre-worker-matrix/W5-closure.md`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `W0-W4 closure memo 全部存在`
  - `final closure / handoff / W5 closure 三份文档齐全`
- **单元测试**：
  - `无`
- **集成测试**：
  - `无`
- **端到端 / 手动验证**：
  - `逐条核对横向 5 对角线、6 就绪状态表、rewrite checklist`
- **回归测试**：
  - `无代码回归；以文档交叉核对替代`
- **文档校验**：
  - `final closure / handoff / meta-doc / charter state wording 一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. W0-W4 closure memo 全部可被 W5 消费
2. 横向 5 对角线检查逐条有 verdict
3. 6 就绪状态表完整
4. final closure、handoff memo、W5 closure 三份核心文档齐全
5. gate-truth / after-foundations final closure / plan-worker-matrix 状态同步完成
6. worker-matrix charter r2 被显式解锁，但未被 W5 越位代写

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `pre-worker-matrix 阶段拥有单一 final closure 与 handoff pack` |
| 测试 | `横向 5 对角线与 6 就绪状态表均有 evidence-backed verdict` |
| 文档 | `final closure / handoff / W5 closure / meta-doc / charter state 全对齐` |
| 风险收敛 | `条件完成态不再悬空，worker-matrix rewrite 入口明确` |
| 可交付性 | `worker-matrix charter r2 作者可直接据此开始下阶段` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待执行后回填`
- **哪些编号的拆分还不够合理**：`待执行后回填`
- **哪些问题本应更早问架构师**：`待执行后回填`
- **哪些测试安排在实际执行中证明不够**：`待执行后回填`
- **模板本身还需要补什么字段**：`待执行后回填`

---

## 10. 结语

这份 action-plan 以 **把 W0-W4 的 narrowed 成果压成一个真正可交付的阶段终局** 为第一优先级，采用 **先核对、再聚合、最后解锁下游 charter** 的推进方式，优先解决 **局部完成无法自动推出整体完成、handoff 缺少执行路径、meta-doc 与真实 gate 状态脱节** 的问题，并把 **不重跑实现、不越位代写 worker-matrix、接受条件完成态但必须诚实记录** 作为主要约束。整个计划完成后，`pre-worker-matrix / W5` 应达到 **阶段闭环完成且 worker-matrix charter r2 可被正式启动** 的状态。
