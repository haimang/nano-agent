# W3 — Absorption Map, Representative Blueprints, and Optional Dry-Run

> 服务业务簇: `pre-worker-matrix / W3 / absorption-blueprint-and-dryrun`
> 计划对象: `产出 9 packages / 10 units 的吸收映射、2-3 份代表性 blueprint，以及 optional dry-run`
> 类型: `migration`
> 作者: `GPT-5.4`
> 时间: `2026-04-21`
> 文件位置: `docs/action-plan/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
> 关联设计 / 调研文档:
> - `docs/plan-pre-worker-matrix.md`
> - `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
> - `docs/design/pre-worker-matrix/W3-absorption-map.md`
> - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

W3 的任务不是提前执行 worker-matrix 的大规模包迁移，而是把后续吸收工作从“临场设计”降级为“按 map 与代表样本执行”。在 narrowed design 下，W3 的硬交付已经收窄成：**1 份覆盖 9 个 Tier B packages / 10 个 absorption units 的 map，2-3 份代表性 blueprint，1 份 pattern spec，以及 optional capability-runtime dry-run。**

因此，这份 action-plan 的重点是 **设计型交付物**：map、template、pattern、representative blueprints。dry-run 只是 optional 强化项，不再是 gate。W3 最终要交给 worker-matrix 的，是稳定的吸收地图与代表样本，而不是把包现在就搬完。

- **服务业务簇**：`pre-worker-matrix / W3`
- **计划对象**：`Absorption Map + Representative Blueprints + Optional Dry-Run`
- **本次计划解决的问题**：
  - `worker-matrix 缺少 package → worker 的稳定归宿图`
  - `split-package 与 host shell 吸收缺少代表样本`
  - `后续 action-plan 若无 map/pattern 容易回到逐包重新设计`
- **本次计划的直接产出**：
  - `W3 absorption map / pattern / template`
  - `2-3 份 representative blueprint`
  - `optional capability-runtime dry-run（若 owner 决定执行）`

---

## 1. 执行综述

### 1.1 总体执行方式

采用 **先建统一方法论，再写 map，再写代表样本，最后决定是否做 optional dry-run** 的方式推进。先方法、后样本、再可选验证，能避免 W3 重新膨胀成一次“提前吸收所有包”的新大阶段。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 模板与方法论 | `S` | 固化 template / pattern / map 结构 | `W0-W2 design ready` |
| Phase 2 | map 与代表 blueprint | `M` | 写 9 packages / 10 units map 与 2-3 份样本 | `Phase 1` |
| Phase 3 | optional dry-run 与 closure | `S` | 按 owner 决定做 capability-runtime dry-run，或保留 placeholder | `Phase 2` |

### 1.3 Phase 说明

1. **Phase 1 — 模板与方法论**
   - **核心目标**：把后续 blueprint 的固定结构与迁移纪律先冻结
   - **为什么先做**：没有统一模板，后面的 blueprint 会风格漂移
2. **Phase 2 — map 与代表 blueprint**
   - **核心目标**：完成真正可供执行层消费的 map 与样本
   - **为什么放在这里**：先有 pattern，再写代表样本更稳定
3. **Phase 3 — optional dry-run 与 closure**
   - **核心目标**：若 owner 选择做，则用 `capability-runtime` 强化 blueprint；否则诚实跳过
   - **为什么放在这里**：dry-run 是增强项，不该反向支配 W3 基础交付

### 1.4 执行策略说明

- **执行顺序原则**：`先 template/pattern，再 map/blueprint，最后 optional dry-run`
- **风险控制原则**：`不把 W3 写回 10 份 detailed blueprint 或 full absorb`
- **测试推进原则**：`文档产物为主；dry-run 若做，再补 package-local tests/build`
- **文档同步原则**：`W3 主文、map、pattern、blueprint、W5 predicate 同步`

### 1.5 本次 action-plan 影响目录树

```text
W3 Absorption Blueprint & Dry-Run
├── Phase 1: 模板与方法论
│   ├── docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md
│   └── docs/design/pre-worker-matrix/W3-absorption-pattern.md
├── Phase 2: map 与代表 blueprint
│   ├── docs/design/pre-worker-matrix/W3-absorption-map.md
│   ├── docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md
│   ├── docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md
│   └── docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md
└── Phase 3: optional dry-run 与 closure
    ├── workers/bash-core/src/ (optional)
    └── docs/issue/pre-worker-matrix/W3-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 固化 W3 template、pattern spec 与 9 packages / 10 units map
- **[S2]** 完成 `capability-runtime` / `workspace-context-artifacts-split` 代表 blueprint
- **[S3]** 保留 `session-do-runtime` optional host-shell blueprint
- **[S4]** 根据 owner 决定做或不做 `capability-runtime` optional dry-run，并写 W3 closure

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** 为所有 10 个 units 逐份写 detailed blueprint
- **[O2]** 实际吸收其他 Tier B package 到 workers/
- **[O3]** 删除旧 package 或提前加 deprecated banner
- **[O4]** 把 optional dry-run 写成强 gate

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `W3-absorption-map.md` | `in-scope` | 它是 W3 主交付物 | `W3 执行期` |
| 2-3 份代表 blueprint | `in-scope` | 这是 narrowed W3 的核心样本 | `W3 执行期` |
| 其余 7 份 detailed blueprint | `out-of-scope` | 会把 W3 膨胀成新大阶段 | `worker-matrix P0` |
| capability-runtime dry-run | `defer / depends-on-decision` | 只是增强项，不是 gate | `Phase 3 / owner 决策` |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | template 固化 | `add` | `TEMPLATE-absorption-blueprint.md` | 统一 blueprint 结构 | `low` |
| P1-02 | Phase 1 | pattern spec 固化 | `add` | `W3-absorption-pattern.md` | 统一迁移方法论 | `medium` |
| P1-03 | Phase 1 | W3 map 结构冻结 | `add` | `W3-absorption-map.md` | 统一 package→worker 视图 | `medium` |
| P2-01 | Phase 2 | capability-runtime blueprint | `add` | `W3-absorption-blueprint-capability-runtime.md` | 代表 bash-core 吸收模式 | `medium` |
| P2-02 | Phase 2 | WCA split blueprint | `add` | `W3-absorption-blueprint-workspace-context-artifacts-split.md` | 代表 split-package 模式 | `high` |
| P2-03 | Phase 2 | session-do-runtime optional blueprint | `add` | `W3-absorption-blueprint-session-do-runtime.md` | 代表 host shell landing 模式 | `medium` |
| P3-01 | Phase 3 | optional dry-run | `update` | `workers/bash-core/src/` | 强化 bash-core blueprint | `medium` |
| P3-02 | Phase 3 | W3 closure | `add` | `docs/issue/pre-worker-matrix/W3-closure.md` | 诚实记录 map/blueprint/dry-run 状态 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 模板与方法论

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | template 固化 | 固定 blueprint 章节与证据结构 | `TEMPLATE-absorption-blueprint.md` | 后续 blueprint 可直接 copy-fill | 文档 review | 模板稳定 |
| P1-02 | pattern spec 固化 | 固定 owner/test/deprecation/partial discipline | `W3-absorption-pattern.md` | 迁移方法不再散落 | 文档 review | generic rules 完整 |
| P1-03 | map 结构冻结 | 定义 9 packages / 10 units 总图 | `W3-absorption-map.md` | worker 归宿不再反复争论 | 文档 review | map 清晰 |

### 4.2 Phase 2 — map 与代表 blueprint

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | capability-runtime blueprint | 写 bash-core 代表样本 | `W3-absorption-blueprint-capability-runtime.md` | bash-core 吸收路径清晰 | 文档 review | fake-bash / typed runtime 纪律明确 |
| P2-02 | WCA split blueprint | 写 context/filesystem split 样本 | `W3-absorption-blueprint-workspace-context-artifacts-split.md` | split-package 路径清晰 | 文档 review | mixed helper 处理清晰 |
| P2-03 | session-do-runtime blueprint | 写 host shell optional 样本 | `W3-absorption-blueprint-session-do-runtime.md` | agent-core host shell landing 清晰 | 文档 review | 与 A1/A2-A5 边界不冲突 |

### 4.3 Phase 3 — optional dry-run 与 closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | optional dry-run | 若做，则按 blueprint 把 capability-runtime 先落 `workers/bash-core/src/` | `workers/bash-core/*` | 强化 blueprint 的执行信心 | package-local build/test | 若不做，也有明确 skip 理由 |
| P3-02 | W3 closure | 写 map/blueprint/dry-run 的最终状态 | `docs/issue/pre-worker-matrix/W3-closure.md` | W5 可引用 W3 成果 | 文档 review | closure 诚实完整 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 模板与方法论

- **Phase 目标**：先把 W3 的方法论统一掉
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `docs/design/pre-worker-matrix/TEMPLATE-absorption-blueprint.md`
  - `docs/design/pre-worker-matrix/W3-absorption-pattern.md`
  - `docs/design/pre-worker-matrix/W3-absorption-map.md`
- **本 Phase 修改文件**：
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
- **具体功能预期**：
  1. 以后不再为每份 blueprint 临时发明结构
  2. “9 packages / 10 units” 成为固定表述
  3. deprecation / test / partial discipline 都有统一写法
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`文档引用检查`
  - **手动验证**：`核对 map 与 design 主文一致`
- **收口标准**：
  - template / pattern / map 均稳定
  - W3 主文与子文一致
- **本 Phase 风险提醒**：
  - 最容易回到旧的“10 个 package”错误口径

### 5.2 Phase 2 — map 与代表 blueprint

- **Phase 目标**：用最少样本覆盖最关键吸收难点
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `W3-absorption-blueprint-capability-runtime.md`
  - `W3-absorption-blueprint-workspace-context-artifacts-split.md`
  - `W3-absorption-blueprint-session-do-runtime.md`
- **本 Phase 修改文件**：
  - `docs/design/pre-worker-matrix/W3-absorption-map.md`
- **具体功能预期**：
  1. bash-core 有代表样本
  2. context/filesystem split 有代表样本
  3. agent-core host shell 有 optional 样本
- **具体测试安排**：
  - **单测**：`无`
  - **集成测试**：`无`
  - **回归测试**：`文档引用检查`
  - **手动验证**：`核对源码锚点、目录映射、测试继承路径`
- **收口标准**：
  - 2-3 份 blueprint 满足 template 结构
  - 不越界到 full absorb
- **本 Phase 风险提醒**：
  - split-package 最容易出现 owner 误判与 consumer path 断裂

### 5.3 Phase 3 — optional dry-run 与 closure

- **Phase 目标**：决定是否用一个真实样本强化 blueprint
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `docs/issue/pre-worker-matrix/W3-closure.md`
- **本 Phase 修改文件**：
  - `workers/bash-core/*`（若做 dry-run）
- **具体功能预期**：
  1. 若做 dry-run，W3 获得执行级样本
  2. 若不做，也不能把 W3 判失败
  3. closure 需诚实写明哪种状态达成
- **具体测试安排**：
  - **单测**：`若做 dry-run，则复用 capability-runtime package-local tests`
  - **集成测试**：`无`
  - **回归测试**：`若做 dry-run，则 workers/bash-core build/test`
  - **手动验证**：`核对 W4 shell 目录兼容性`
- **收口标准**：
  - closure 明确记录 dry-run 做/不做
  - W5 可据此写结构兼容 predicate
- **本 Phase 风险提醒**：
  - 最危险的是把 optional dry-run 重新写成硬 gate

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 3`
- **为什么必须确认**：`决定 W3 是否执行 optional capability-runtime dry-run`
- **当前建议 / 倾向**：`可以不做，把 dry-run 留到 worker-matrix P0`
- **Q**：`owner 是否要求在 pre-worker-matrix 阶段完成 capability-runtime optional dry-run？`
- **A**：`待 owner 决定`

#### Q2

- **影响范围**：`Phase 2`
- **为什么必须确认**：`关系到 session-do-runtime blueprint 是否保持 optional`
- **当前建议 / 倾向**：`保持 optional representative blueprint，不升级为硬 gate`
- **Q**：`session-do-runtime host-shell blueprint 是否仅作为 optional representative 样本保留？`
- **A**：`待 owner 决定`

### 6.2 问题整理建议

- 只确认会改变 W3 是否“文档主导”还是“加一个增强样本”的问题
- 不把 worker-matrix P0 的真实吸收工作提前拉入 W3

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| W3 膨胀 | 最容易回到“10 份 full blueprint + dry-run gate” | `high` | 严守 map + 2-3 样本 + optional dry-run |
| split-package 误切 | `workspace-context-artifacts` 最容易切坏 consumer path | `high` | 用代表 blueprint 明确 staged cut-over |
| old wording 残留 | 会让 W5 与执行层误判 W3 scope | `medium` | 同步主文、map、pattern、closure |

### 7.2 约束与前提

- **技术前提**：`W0-W2 设计已收窄，W4 shell 路径存在`
- **运行时前提**：`optional dry-run 若做，优先落 workers/bash-core`
- **组织协作前提**：`owner 接受 9 packages / 10 units 口径`
- **上线 / 合并前提**：`W3 仍保持 design-heavy，不越界到实际大迁移`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/pre-worker-matrix/W3-absorption-blueprint-and-dryrun.md`
  - `docs/design/pre-worker-matrix/W5-closure-and-handoff.md`
- 需要同步更新的说明文档 / README：
  - `无`
- 需要同步更新的测试说明：
  - `docs/issue/pre-worker-matrix/W3-closure.md`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `template / pattern / map / blueprint 文件齐全`
  - `9 packages / 10 units 口径统一`
- **单元测试**：
  - `无（dry-run 若做则复用 package-local tests）`
- **集成测试**：
  - `无`
- **端到端 / 手动验证**：
  - `检查每份 blueprint 的源码锚点、目标目录、测试继承与风险声明`
- **回归测试**：
  - `若做 dry-run，则 workers/bash-core build/test`
- **文档校验**：
  - `W3 主文 / map / pattern / W5 引用链一致`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. map / template / pattern 齐全
2. 至少 2-3 份代表性 blueprint 完整
3. W3 不再声称需要 full package absorb
4. optional dry-run 状态被诚实记录
5. worker-matrix P0 可据此直接进入实施拆解

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `worker absorb 归宿图与代表样本稳定` |
| 测试 | `dry-run 若做则局部验证通过；若不做则 closure 诚实说明` |
| 文档 | `主文 / map / pattern / blueprint / closure 一致` |
| 风险收敛 | `W3 不再膨胀成 full migration phase` |
| 可交付性 | `worker-matrix P0 可直接消费` |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待执行后回填`
- **哪些编号的拆分还不够合理**：`待执行后回填`
- **哪些问题本应更早问架构师**：`待执行后回填`
- **哪些测试安排在实际执行中证明不够**：`待执行后回填`
- **模板本身还需要补什么字段**：`待执行后回填`

---

## 10. 结语

这份 action-plan 以 **把 package absorb 从“临场设计”变成“按 map 与代表样本执行”** 为第一优先级，采用 **先模板/方法，再 map/样本，最后 optional dry-run** 的推进方式，优先解决 **归宿模糊、split-package 难落地、worker-matrix P0 容易重新设计** 的问题，并把 **不提前 full absorb、不把 dry-run 写成强 gate、保持 9 packages / 10 units 口径** 作为主要约束。整个计划完成后，`pre-worker-matrix / W3` 应达到 **可直接被 worker-matrix P0 消费的吸收设计基线**，从而为后续的 **4 worker 实际吸收与 cutover** 提供稳定基础。
