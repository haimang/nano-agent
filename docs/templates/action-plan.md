# Nano-Agent 行动计划模板

> 服务业务簇: `{SERVICE_CLUSTER_NAME}`
> 计划对象: `{PLAN_OBJECT}`
> 类型: `new | upgrade | modify | refactor | migration | remove`
> 作者: `{AUTHOR}`
> 时间: `{DATE}`
> 文件位置: `{TARGET_PATHS}`
> 上游前序 / closure:
> - `{PREDECESSOR_CLOSURE_OR_GATE}`
> 下游交接:
> - `{SUCCESSOR_PLAN_OR_HANDOFF}`
> 关联设计 / 调研文档:
> - `{RELATED_DESIGN_DOCS}`
> - `{RELATED_INVESTIGATION_DOCS}`
> 冻结决策来源:
> - `{DESIGN_QNA_OR_DECISION_REGISTER}`（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft | reviewed | executing | executed | superseded`

---

## 0. 执行背景与目标

> 用一到三段话说明：为什么现在要执行这份计划、它从哪些 frozen design / QNA / closure 继承输入、它要把哪些设计结论落成可交付物。
>
> **纪律**：如果仍有 owner / architect 需要回答的问题，不应在 action-plan 中开 Q/A；应回到 design / QNA register 完成冻结。本文件只消费已冻结结论。

- **服务业务簇**：`{SERVICE_CLUSTER_NAME}`
- **计划对象**：`{PLAN_OBJECT}`
- **本次计划解决的问题**：
  - `{PROBLEM_1}`
  - `{PROBLEM_2}`
  - `{PROBLEM_3}`
- **本次计划的直接产出**：
  - `{DELIVERABLE_1}`
  - `{DELIVERABLE_2}`
  - `{DELIVERABLE_3}`
- **本计划不重新讨论的设计结论**：
  - `{FROZEN_DECISION_1}`（来源：`{Q_OR_DESIGN_REF}`）
  - `{FROZEN_DECISION_2}`（来源：`{Q_OR_DESIGN_REF}`）

---

## 1. 执行综述

### 1.1 总体执行方式

> 用一段话概括：这份 action-plan 一共分几个 Phase，执行方式是“先审计后改动”、“先协议后实现”、“先底层后上层”、“先迁 consumer 后删除”等哪一种。这里写执行策略，不重新论证设计方案本身。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | `{PHASE_1_NAME}` | `XS / S / M / L / XL` | `{PHASE_1_SUMMARY}` | `-` |
| Phase 2 | `{PHASE_2_NAME}` | `XS / S / M / L / XL` | `{PHASE_2_SUMMARY}` | `{PHASE_DEP}` |
| Phase 3 | `{PHASE_3_NAME}` | `XS / S / M / L / XL` | `{PHASE_3_SUMMARY}` | `{PHASE_DEP}` |
| Phase N | `{PHASE_N_NAME}` | `XS / S / M / L / XL` | `{PHASE_N_SUMMARY}` | `{PHASE_DEP}` |

### 1.3 Phase 说明

1. **Phase 1 — `{PHASE_1_NAME}`**
   - **核心目标**：`{PHASE_1_GOAL}`
   - **为什么先做**：`{WHY_FIRST}`
2. **Phase 2 — `{PHASE_2_NAME}`**
   - **核心目标**：`{PHASE_2_GOAL}`
   - **为什么放在这里**：`{WHY_SECOND}`
3. **Phase N — `{PHASE_N_NAME}`**
   - **核心目标**：`{PHASE_N_GOAL}`
   - **为什么放在这里**：`{WHY_N}`

### 1.4 执行策略说明

- **执行顺序原则**：`{ORDERING_STRATEGY}`
- **风险控制原则**：`{RISK_STRATEGY}`
- **测试推进原则**：`{TEST_STRATEGY}`
- **文档同步原则**：`{DOCS_STRATEGY}`
- **回滚 / 降级原则**：`{ROLLBACK_OR_DEGRADE_STRATEGY}`

### 1.5 本次 action-plan 影响结构图

> 用树状结构快速展示：本计划会影响哪些模块、目录、运行链路、服务边界、测试层或文档资产。
>
> 这一节不是文件系统快照，而是**影响结构图**；推荐按业务链路或执行路径写。

```text
{PLAN_OBJECT}
├── Phase 1: {PHASE_1_NAME}
│   ├── {AFFECTED_BOUNDARY_1}
│   └── {AFFECTED_BOUNDARY_2}
├── Phase 2: {PHASE_2_NAME}
│   ├── {AFFECTED_BOUNDARY_3}
│   └── {AFFECTED_BOUNDARY_4}
└── Phase N: {PHASE_N_NAME}
    ├── {AFFECTED_BOUNDARY_5}
    └── {AFFECTED_BOUNDARY_6}
```

---

## 2. In-Scope / Out-of-Scope

> 把 action-plan 的执行边界集中写在这里。设计上的边界应来自 design/QNA；本节只说明本轮执行做什么、不做什么、何时重评。

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `{IN_SCOPE_ITEM}`
- **[S2]** `{IN_SCOPE_ITEM}`
- **[S3]** `{IN_SCOPE_ITEM}`
- **[S4]** `{IN_SCOPE_ITEM}`

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** `{OUT_OF_SCOPE_ITEM}`
- **[O2]** `{OUT_OF_SCOPE_ITEM}`
- **[O3]** `{OUT_OF_SCOPE_ITEM}`
- **[O4]** `{OUT_OF_SCOPE_ITEM}`

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `{ITEM}` | `in-scope` | `{WHY}` | `{REVISIT_CONDITION}` |
| `{ITEM}` | `out-of-scope` | `{WHY}` | `{REVISIT_CONDITION}` |
| `{ITEM}` | `defer / depends-on-design` | `{WHY}` | `{REVISIT_CONDITION}` |

---

## 3. 业务工作总表

> 这一节先给出总索引；后面 §4 会按 Phase 展开。编号建议使用 `P1-01 / P1-02 / P2-01` 这种形式，便于 review、handoff 与 closure 引用。

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | `{WORK_ITEM}` | `add | update | remove | refactor | migrate` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |
| P1-02 | Phase 1 | `{WORK_ITEM}` | `add | update | remove | refactor | migrate` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |
| P2-01 | Phase 2 | `{WORK_ITEM}` | `add | update | remove | refactor | migrate` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |
| P3-01 | Phase 3 | `{WORK_ITEM}` | `add | update | remove | refactor | migrate` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |

---

## 4. Phase 业务表格

> 每个 Phase 一张表，完整列出这个 Phase 内的工作项、目标、涉及文件、测试方式与收口条件。

### 4.1 Phase 1 — `{PHASE_1_NAME}`

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P1-02 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |

### 4.2 Phase 2 — `{PHASE_2_NAME}`

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P2-02 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |

### 4.3 Phase 3 — `{PHASE_3_NAME}`

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P3-02 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |

*（按需继续扩展 Phase 4 / Phase 5 / ...）*

---

## 5. Phase 详情

> 这一节按 Phase 展开详细执行说明。建议把“做什么、改哪些文件、怎么测、做到什么算结束”写清楚，避免后续实现时反复重读 design。

### 5.1 Phase 1 — `{PHASE_1_NAME}`

- **Phase 目标**：`{PHASE_GOAL}`
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - `{NEW_FILE_1}`
- **本 Phase 修改文件**：
  - `{MODIFIED_FILE_1}`
- **本 Phase 删除文件**（如无可删去）：
  - `{DELETED_FILE_1}`
- **具体功能预期**：
  1. `{FUNCTION_EXPECTATION_1}`
  2. `{FUNCTION_EXPECTATION_2}`
- **具体测试安排**：
  - **单测**：`{UNIT_TEST_SCOPE}`
  - **集成测试**：`{INTEGRATION_TEST_SCOPE}`
  - **回归测试**：`{REGRESSION_TEST_SCOPE}`
  - **手动验证**：`{MANUAL_CHECK_SCOPE}`
- **收口标准**：
  - `{EXIT_CRITERION_1}`
  - `{EXIT_CRITERION_2}`
- **本 Phase 风险提醒**：
  - `{PHASE_RISK_1}`

### 5.2 Phase 2 — `{PHASE_2_NAME}`

- **Phase 目标**：`{PHASE_GOAL}`
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 新增文件**：
  - `{NEW_FILE_1}`
- **本 Phase 修改文件**：
  - `{MODIFIED_FILE_1}`
- **本 Phase 删除文件**（如无可删去）：
  - `{DELETED_FILE_1}`
- **具体功能预期**：
  1. `{FUNCTION_EXPECTATION_1}`
  2. `{FUNCTION_EXPECTATION_2}`
- **具体测试安排**：
  - **单测**：`{UNIT_TEST_SCOPE}`
  - **集成测试**：`{INTEGRATION_TEST_SCOPE}`
  - **回归测试**：`{REGRESSION_TEST_SCOPE}`
  - **手动验证**：`{MANUAL_CHECK_SCOPE}`
- **收口标准**：
  - `{EXIT_CRITERION_1}`
  - `{EXIT_CRITERION_2}`
- **本 Phase 风险提醒**：
  - `{PHASE_RISK_1}`

*（按需继续扩展更多 Phase）*

---

## 6. 依赖的冻结设计决策（只读引用）

> 这里列出本 action-plan 依赖哪些 design / QNA / closure 结论。**不要在本节填写新 Q/A，也不要在这里等待 owner 回答。**
>
> 如果某条关键结论尚未冻结，本 action-plan 应保持 `draft-blocked` 或回退到 design 阶段。

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| `{Q1_OR_DECISION}` | `{DESIGN_OR_QNA_LINK}` | `{IMPACT_ON_PHASES}` | `{BLOCK_OR_ROLLBACK}` |
| `{Q2_OR_DECISION}` | `{DESIGN_OR_QNA_LINK}` | `{IMPACT_ON_PHASES}` | `{BLOCK_OR_ROLLBACK}` |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `{RISK_OR_DEP}` | `{DESCRIPTION}` | `low | medium | high` | `{MITIGATION}` |
| `{RISK_OR_DEP}` | `{DESCRIPTION}` | `low | medium | high` | `{MITIGATION}` |

### 7.2 约束与前提

- **技术前提**：`{TECH_CONSTRAINTS}`
- **运行时前提**：`{RUNTIME_CONSTRAINTS}`
- **组织协作前提**：`{COLLABORATION_CONSTRAINTS}`
- **上线 / 合并前提**：`{RELEASE_CONSTRAINTS}`

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `{DOC_1}`
  - `{DOC_2}`
- 需要同步更新的说明文档 / README：
  - `{README_OR_GUIDE}`
- 需要同步更新的测试说明：
  - `{TEST_DOC}`

### 7.4 完成后的预期状态

> 用 3-5 条说明本 action-plan 完成后，系统、仓库结构、测试、文档或运行链路会变成什么状态。这比泛泛“结语”更有用。

1. `{POST_COMPLETION_STATE_1}`
2. `{POST_COMPLETION_STATE_2}`
3. `{POST_COMPLETION_STATE_3}`

---

## 8. Action-Plan 整体测试与整体收口

> 这里写整个 action-plan 完成后的整体测试方法与整体收口标准，不重复某个单独 Phase 的局部测试。

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `{BASIC_CHECK_1}`
  - `{BASIC_CHECK_2}`
- **单元测试**：
  - `{UNIT_TEST_STRATEGY}`
- **集成测试**：
  - `{INTEGRATION_TEST_STRATEGY}`
- **端到端 / 手动验证**：
  - `{E2E_OR_MANUAL_STRATEGY}`
- **回归测试**：
  - `{REGRESSION_STRATEGY}`
- **文档校验**：
  - `{DOC_VALIDATION_STRATEGY}`

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `{GLOBAL_EXIT_CRITERION_1}`
2. `{GLOBAL_EXIT_CRITERION_2}`
3. `{GLOBAL_EXIT_CRITERION_3}`
4. `{GLOBAL_EXIT_CRITERION_4}`

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `{FUNCTION_DOD}` |
| 测试 | `{TEST_DOD}` |
| 文档 | `{DOC_DOD}` |
| 风险收敛 | `{RISK_DOD}` |
| 可交付性 | `{DELIVERY_DOD}` |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

> 若文档状态不是 `executed`，本节可以省略。执行完成后回填实际发生了什么、哪些计划发生偏差、哪些测试暴露新事实、哪些风险已关闭。

- **实际执行摘要**：`{EXECUTION_SUMMARY}`
- **Phase 偏差**：`{PHASE_VARIANCE}`
- **阻塞与处理**：`{BLOCKERS_AND_RESOLUTION}`
- **测试发现**：`{TEST_FINDINGS}`
- **后续 handoff**：`{FOLLOW_UP_HANDOFF}`

