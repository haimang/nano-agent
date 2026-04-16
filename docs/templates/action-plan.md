# Nano-Agent 行动计划模板

> 服务业务簇: `{SERVICE_CLUSTER_NAME}`
> 计划对象: `{PLAN_OBJECT}`
> 类型: `new | upgrade | modify | refactor | migration`
> 作者: `{AUTHOR}`
> 时间: `{DATE}`
> 文件位置: `{TARGET_PATHS}`
> 关联设计 / 调研文档:
> - `{RELATED_DESIGN_DOCS}`
> - `{RELATED_INVESTIGATION_DOCS}`
> 文档状态: `draft | reviewed | executing | completed`

---

## 0. 执行背景与目标

> 用一到三段话说明：为什么现在要做这份 action-plan、它对应哪个功能簇或子系统、这次行动计划想解决什么问题、最终希望落到什么可交付物。

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

---

## 1. 执行综述

### 1.1 总体执行方式

> 用一段话概括：这份 action-plan 一共分几个 Phase，执行方式是“先骨架后集成”、“先协议后实现”、“先底层后上层”，还是其他策略。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
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

### 1.5 本次 action-plan 影响目录树

> 用树状结构快速展示：本次 action-plan 会影响哪些模块、目录、文件、运行链路或服务边界。  
> 这一节不是文件系统快照，而是**影响结构图**；既可以按目录写，也可以按业务链路写。

```text
{SERVICE_CLUSTER_NAME}/
├── runtime/
│   ├── {RUNTIME_FILE_OR_MODULE}
│   └── {RUNTIME_FILE_OR_MODULE}
├── transport/
│   ├── {TRANSPORT_FILE_OR_MODULE}
│   └── {TRANSPORT_FILE_OR_MODULE}
├── storage/
│   ├── {STORAGE_FILE_OR_MODULE}
│   └── {STORAGE_FILE_OR_MODULE}
├── tests/
│   ├── {TEST_FILE_OR_MODULE}
│   └── {TEST_FILE_OR_MODULE}
└── docs/
    ├── {DOC_FILE}
    └── {DOC_FILE}
```

或使用业务链路树：

```text
{PLAN_OBJECT}
├── Phase 1: {PHASE_1_NAME}
│   ├── {AFFECTED_BOUNDARY_1}
│   └── {AFFECTED_BOUNDARY_2}
├── Phase 2: {PHASE_2_NAME}
│   ├── {AFFECTED_BOUNDARY_3}
│   └── {AFFECTED_BOUNDARY_4}
└── Phase 3: {PHASE_3_NAME}
    ├── {AFFECTED_BOUNDARY_5}
    └── {AFFECTED_BOUNDARY_6}
```

---

## 2. In-Scope / Out-of-Scope

> 把 action-plan 的边界集中写在这里。  
> 其他章节不再重复写“这次不做什么”，避免 scope 分散在多个位置。

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

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `{ITEM}` | `in-scope` | `{WHY}` | `{REVISIT_CONDITION}` |
| `{ITEM}` | `out-of-scope` | `{WHY}` | `{REVISIT_CONDITION}` |
| `{ITEM}` | `defer / depends-on-decision` | `{WHY}` | `{REVISIT_CONDITION}` |

---

## 3. 业务工作总表

> 这一节先给出总索引；后面 §4 会按 Phase 展开。编号建议使用 `P1-01 / P1-02 / P2-01` 这种形式，便于讨论与追踪。

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | `{WORK_ITEM}` | `add | update | remove | refactor` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |
| P1-02 | Phase 1 | `{WORK_ITEM}` | `add | update | remove | refactor` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |
| P2-01 | Phase 2 | `{WORK_ITEM}` | `add | update | remove | refactor` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |
| P3-01 | Phase 3 | `{WORK_ITEM}` | `add | update | remove | refactor` | `{FILES}` | `{ONE_LINE_GOAL}` | `low | medium | high` |

---

## 4. Phase 业务表格

> 每个 Phase 一张表，完整列出这个 Phase 内的工作项、目标、涉及文件、测试方式与收口条件。  
> 如果某个 Phase 很大，可以拆成多个小表，但仍建议保持单一编号体系。

### 4.1 Phase 1 — `{PHASE_1_NAME}`

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P1-02 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P1-03 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |

### 4.2 Phase 2 — `{PHASE_2_NAME}`

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P2-02 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P2-03 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |

### 4.3 Phase 3 — `{PHASE_3_NAME}`

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |
| P3-02 | `{ITEM_NAME}` | `{ITEM_DESCRIPTION}` | `{FILES}` | `{EXPECTED_OUTPUT}` | `{TEST_METHOD}` | `{DONE_CRITERION}` |

*（按需继续扩展 Phase 4 / Phase 5 / ...）*

---

## 5. Phase 详情

> 这一节按 Phase 展开详细执行说明。建议把“做什么、改哪些文件、怎么测、做到什么算结束”写清楚，避免后续实现时反复重读上下文。

### 5.1 Phase 1 — `{PHASE_1_NAME}`

- **Phase 目标**：`{PHASE_GOAL}`
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `{NEW_FILE_1}`
  - `{NEW_FILE_2}`
- **本 Phase 修改文件**：
  - `{MODIFIED_FILE_1}`
  - `{MODIFIED_FILE_2}`
- **本 Phase 删除文件**（如无可删去）：
  - `{DELETED_FILE_1}`
- **具体功能预期**：
  1. `{FUNCTION_EXPECTATION_1}`
  2. `{FUNCTION_EXPECTATION_2}`
  3. `{FUNCTION_EXPECTATION_3}`
- **具体测试安排**：
  - **单测**：`{UNIT_TEST_SCOPE}`
  - **集成测试**：`{INTEGRATION_TEST_SCOPE}`
  - **回归测试**：`{REGRESSION_TEST_SCOPE}`
  - **手动验证**：`{MANUAL_CHECK_SCOPE}`
- **收口标准**：
  - `{EXIT_CRITERION_1}`
  - `{EXIT_CRITERION_2}`
  - `{EXIT_CRITERION_3}`
- **本 Phase 风险提醒**：
  - `{PHASE_RISK_1}`
  - `{PHASE_RISK_2}`

### 5.2 Phase 2 — `{PHASE_2_NAME}`

- **Phase 目标**：`{PHASE_GOAL}`
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `{NEW_FILE_1}`
- **本 Phase 修改文件**：
  - `{MODIFIED_FILE_1}`
  - `{MODIFIED_FILE_2}`
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

### 5.3 Phase 3 — `{PHASE_3_NAME}`

- **Phase 目标**：`{PHASE_GOAL}`
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 新增文件**：
  - `{NEW_FILE_1}`
- **本 Phase 修改文件**：
  - `{MODIFIED_FILE_1}`
  - `{MODIFIED_FILE_2}`
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

## 6. 需要业主 / 架构师回答的问题清单

> 把当前 action-plan 里仍未冻结、必须由业主或架构师拍板的问题集中列出。  
> 每个问题都要说明：问题是什么、为什么必须回答、影响哪些 Phase，并预留 **Q / A** 结构，方便架构师或业主直接在文档里填写。

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`{AFFECTED_PHASES}`
- **为什么必须确认**：`{WHY_IT_MATTERS}`
- **当前建议 / 倾向**：`{RECOMMENDED_ANSWER}`
- **Q**：`{QUESTION}`
- **A**：`{ARCHITECT_OR_OWNER_ANSWER}`

#### Q2

- **影响范围**：`{AFFECTED_PHASES}`
- **为什么必须确认**：`{WHY_IT_MATTERS}`
- **当前建议 / 倾向**：`{RECOMMENDED_ANSWER}`
- **Q**：`{QUESTION}`
- **A**：`{ARCHITECT_OR_OWNER_ANSWER}`

#### Q3

- **影响范围**：`{AFFECTED_PHASES}`
- **为什么必须确认**：`{WHY_IT_MATTERS}`
- **当前建议 / 倾向**：`{RECOMMENDED_ANSWER}`
- **Q**：`{QUESTION}`
- **A**：`{ARCHITECT_OR_OWNER_ANSWER}`

*（按需继续扩展 Q4 / Q5 / ...）*

### 6.2 问题整理建议

- 优先问 **会直接改变实现路径** 的问题
- 优先问 **影响多个 Phase** 的问题
- 不要把“实现时自然可确定”的细节也塞进待确认项
- 每个问题最好给出 **当前建议答案**，方便架构师决策

---

## 7. 其他补充说明

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

---

## 8. Action-Plan 整体测试与整体收口

> 这里写的是整个 action-plan 完成后的**整体测试方法**与**整体收口标准**，不是某个单独 Phase 的局部测试。

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
5. `{GLOBAL_EXIT_CRITERION_5}`

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `{FUNCTION_DOD}` |
| 测试 | `{TEST_DOD}` |
| 文档 | `{DOC_DOD}` |
| 风险收敛 | `{RISK_DOD}` |
| 可交付性 | `{DELIVERY_DOD}` |

---

## 9. 执行后复盘关注点

> 这一节不是必填，但建议在 action-plan 执行结束后回填，用于后续迭代与模板复用。

- **哪些 Phase 的工作量估计偏差最大**：`{RETRO_1}`
- **哪些编号的拆分还不够合理**：`{RETRO_2}`
- **哪些问题本应更早问架构师**：`{RETRO_3}`
- **哪些测试安排在实际执行中证明不够**：`{RETRO_4}`
- **模板本身还需要补什么字段**：`{RETRO_5}`

---

## 10. 结语

> 用一段话总结这份 action-plan 的总体执行立场：  
> 我们准备如何推进、优先保证什么、接受什么 trade-off、完成后会给项目带来什么确定性。

示例句式：

> 这份 action-plan 以 **{PRIMARY_GOAL}** 为第一优先级，采用 **{EXECUTION_STRATEGY}** 的推进方式，优先解决 **{MOST_IMPORTANT_PROBLEMS}**，并把 **{RISK_BOUNDARIES}** 作为主要约束。整个计划完成后，`{SERVICE_CLUSTER_NAME}` 应达到 **{FINAL_EXPECTATION}**，从而为后续的 **{NEXT_CAPABILITIES}** 提供稳定基础。
