# Nano-Agent Charter 模板

> **适用范围**：`phase charter | foundation charter | boundary charter`
> **不适用范围**：`auto-generated registry | code review | closure memo | handoff memo`
>
> **使用纪律**：
> 1. 这份模板用于写**基石纲领文件**，不是 action-plan、不是 design、也不是 closure。
> 2. charter 负责冻结：**为什么现在做、这一阶段到底做什么/不做什么、各 Phase 的职责边界、成功退出条件、失败退出识别、下一阶段触发条件**。
> 3. charter **不替代** design / QnA / action-plan。若 owner / architect 级问题尚未冻结，必须显式写出“谁在何时回答”，不能把模糊问题悄悄留给 action-plan。

---

# `{CHARTER_TITLE}`

> **文档对象**：`{PROJECT_OR_PHASE_OBJECT}`
> **状态**：`draft | active charter | reviewed charter | closed charter | superseded`
> **日期**：`{DATE}`
> **作者**：`{AUTHOR}`
> **文档性质**：`phase charter | foundation charter | boundary charter`
> **文档一句话定义**：`{ONE_LINE_DEFINITION}`
>
> **修订历史**：
> - `{REVISION_1}`
> - `{REVISION_2}`
>
> **直接输入包（authoritative）**：
> 1. `{UPSTREAM_DOC_1}`
> 2. `{UPSTREAM_DOC_2}`
> 3. `{UPSTREAM_DOC_3}`
>
> **ancestry-only / 背景参考（不作为直接入口）**：
> - `{ANCESTRY_REFERENCE_1}`
> - `{ANCESTRY_REFERENCE_2}`
>
> **下游预期产物**：
> - `{DESIGN_DOCS_TO_PRODUCE}`
> - `{ACTION_PLANS_TO_PRODUCE}`
> - `{CLOSURE_OR_HANDOFF_DOCS_TO_PRODUCE}`

---

## 0. 为什么这份 charter 要现在写

> 用一到四段回答 3 个问题：
>
> 1. **为什么是现在**，不是更早或更晚？
> 2. **上一阶段到底闭合了什么**，让这一阶段成为合理的下一个阶段？
> 3. 如果现在不写，会带来什么模糊空间、边界漂移或错误执行顺序？

### 0.1 当前时点的根本原因

`{WHY_NOW}`

### 0.2 这份文档要解决的模糊空间

1. `{AMBIGUITY_1}`
2. `{AMBIGUITY_2}`
3. `{AMBIGUITY_3}`

### 0.3 这份 charter 的职责，不是别的文件的职责

- **本 charter 负责冻结**：
  - `{CHARTER_RESPONSIBILITY_1}`
  - `{CHARTER_RESPONSIBILITY_2}`
  - `{CHARTER_RESPONSIBILITY_3}`
- **本 charter 不负责展开**：
  - `{NOT_CHARTER_RESPONSIBILITY_1}`（应在：`{TARGET_DOC}`）
  - `{NOT_CHARTER_RESPONSIBILITY_2}`（应在：`{TARGET_DOC}`）

---

## 1. 本轮已确认的 Owner Decisions 与基石事实

> 本节只写**已经成立**、本 charter 直接继承的决定与事实。
> 不要把猜想、倾向、尚未回答的问题写成“已确认”。

### 1.1 Owner Decisions（直接生效）

| 编号 | 决策 | 影响范围 | 来源 |
|------|------|----------|------|
| D1 | `{DECISION}` | `{AFFECTED_SCOPE}` | `{SOURCE}` |
| D2 | `{DECISION}` | `{AFFECTED_SCOPE}` | `{SOURCE}` |
| D3 | `{DECISION}` | `{AFFECTED_SCOPE}` | `{SOURCE}` |

### 1.2 已冻结的系统真相

| 主题 | 当前真相 | 本阶段如何继承 |
|------|----------|----------------|
| `{TOPIC}` | `{CURRENT_TRUTH}` | `{HOW_THIS_CHARTER_USES_IT}` |
| `{TOPIC}` | `{CURRENT_TRUTH}` | `{HOW_THIS_CHARTER_USES_IT}` |
| `{TOPIC}` | `{CURRENT_TRUTH}` | `{HOW_THIS_CHARTER_USES_IT}` |

### 1.3 明确不再重讨论的前提

1. `{FROZEN_PRECONDITION_1}`
2. `{FROZEN_PRECONDITION_2}`
3. `{FROZEN_PRECONDITION_3}`

---

## 2. 当前真实起点（Reality Snapshot）

> 这一节是**阶段起跑线快照**。
> 目的是防止后续把“设计理想态”误当成“仓库现实”。

### 2.1 已成立的 shipped / frozen truth

| 主题 | 当前现实 | 证据 |
|------|----------|------|
| `{AREA}` | `{REALITY}` | `{EVIDENCE}` |
| `{AREA}` | `{REALITY}` | `{EVIDENCE}` |
| `{AREA}` | `{REALITY}` | `{EVIDENCE}` |

### 2.2 当前仍然存在的核心 gap

| 编号 | gap | 为什么必须在本阶段处理 | 若不处理会怎样 |
|------|-----|------------------------|----------------|
| G1 | `{GAP}` | `{WHY_IN_SCOPE}` | `{RISK_IF_IGNORED}` |
| G2 | `{GAP}` | `{WHY_IN_SCOPE}` | `{RISK_IF_IGNORED}` |
| G3 | `{GAP}` | `{WHY_IN_SCOPE}` | `{RISK_IF_IGNORED}` |

### 2.3 本阶段必须拒绝的错误前提

- **错误前提 1**：`{FALSE_ASSUMPTION}`  
  **为什么错**：`{WHY_FALSE}`
- **错误前提 2**：`{FALSE_ASSUMPTION}`  
  **为什么错**：`{WHY_FALSE}`

---

## 3. 本阶段的一句话目标

> 用一句话把这个阶段的“唯一中心任务”写死。
> 这句话应能被拿来审判所有 in-scope / out-of-scope 判断。

> **阶段目标**：`{ONE_SENTENCE_GOAL}`

### 3.1 一句话产出

`{ONE_SENTENCE_OUTPUT}`

### 3.2 一句话非目标

`{ONE_SENTENCE_NON_GOAL}`

---

## 4. 本阶段边界：全局 In-Scope / Out-of-Scope

> 这是 charter 最重要的部分之一。
> 先定边界，再谈 phases。

### 4.1 全局 In-Scope（本阶段必须完成）

| 编号 | 工作主题 | 为什么必须在本阶段完成 | 对应 Phase |
|------|----------|------------------------|------------|
| I1 | `{IN_SCOPE_THEME}` | `{WHY_REQUIRED}` | `{PHASE}` |
| I2 | `{IN_SCOPE_THEME}` | `{WHY_REQUIRED}` | `{PHASE}` |
| I3 | `{IN_SCOPE_THEME}` | `{WHY_REQUIRED}` | `{PHASE}` |
| I4 | `{IN_SCOPE_THEME}` | `{WHY_REQUIRED}` | `{PHASE}` |

### 4.2 全局 Out-of-Scope（本阶段明确不做）

| 编号 | 项目 | 为什么现在不做 | 重评条件 / 下游落点 |
|------|------|----------------|----------------------|
| O1 | `{OUT_OF_SCOPE_ITEM}` | `{WHY_DEFERRED}` | `{REVISIT_CONDITION_OR_NEXT_DOC}` |
| O2 | `{OUT_OF_SCOPE_ITEM}` | `{WHY_DEFERRED}` | `{REVISIT_CONDITION_OR_NEXT_DOC}` |
| O3 | `{OUT_OF_SCOPE_ITEM}` | `{WHY_DEFERRED}` | `{REVISIT_CONDITION_OR_NEXT_DOC}` |
| O4 | `{OUT_OF_SCOPE_ITEM}` | `{WHY_DEFERRED}` | `{REVISIT_CONDITION_OR_NEXT_DOC}` |

### 4.3 灰区判定表（用来消除模糊空间）

| 项目 | 判定 | 判定理由 | 若要翻案，需要什么新事实 |
|------|------|----------|--------------------------|
| `{GREY_ITEM}` | `in-scope` | `{WHY}` | `{REOPEN_CONDITION}` |
| `{GREY_ITEM}` | `out-of-scope` | `{WHY}` | `{REOPEN_CONDITION}` |
| `{GREY_ITEM}` | `defer / later-phase` | `{WHY}` | `{REOPEN_CONDITION}` |

### 4.4 必须写进 charter 的硬纪律

1. `{HARD_DISCIPLINE_1}`
2. `{HARD_DISCIPLINE_2}`
3. `{HARD_DISCIPLINE_3}`

### 4.5 必须写明的例外（如有）

`{EXCEPTION_OR_N/A}`

---

## 5. 本阶段的方法论

> 本节只写**阶段级方法论**，不写实现细节。
> 每条方法论都必须回答：它约束什么行为，避免什么错误。

| 方法论 | 含义 | 它避免的错误 |
|--------|------|--------------|
| `{METHOD_1}` | `{MEANING}` | `{ANTI_PATTERN}` |
| `{METHOD_2}` | `{MEANING}` | `{ANTI_PATTERN}` |
| `{METHOD_3}` | `{MEANING}` | `{ANTI_PATTERN}` |
| `{METHOD_4}` | `{MEANING}` | `{ANTI_PATTERN}` |

### 5.1 方法论对 phases 的直接影响

- `{METHOD_1}` 影响：`{PHASE_IMPACT}`
- `{METHOD_2}` 影响：`{PHASE_IMPACT}`

---

## 6. Phase 总览与职责划分

> 这一节的目标是把“阶段切片”和“阶段职责边界”写清楚。
> 要做到：读者不需要进入 action-plan，就能知道每个 Phase 的任务、边界和交接关系。

### 6.1 Phase 总表

| Phase | 名称 | 类型 | 核心目标 | 主要风险 |
|------|------|------|----------|----------|
| `{P0}` | `{PHASE_NAME}` | `{freeze | design | implementation | migration | closure}` | `{GOAL}` | `{MAIN_RISK}` |
| `{P1}` | `{PHASE_NAME}` | `{TYPE}` | `{GOAL}` | `{MAIN_RISK}` |
| `{P2}` | `{PHASE_NAME}` | `{TYPE}` | `{GOAL}` | `{MAIN_RISK}` |
| `{PN}` | `{PHASE_NAME}` | `{TYPE}` | `{GOAL}` | `{MAIN_RISK}` |

### 6.2 Phase 职责矩阵（推荐必填）

| Phase | 本 Phase 负责 | 本 Phase 不负责 | 进入条件 | 交付输出 |
|------|---------------|----------------|----------|----------|
| `{P0}` | `{OWNS}` | `{DOES_NOT_OWN}` | `{ENTRY_CONDITION}` | `{OUTPUT}` |
| `{P1}` | `{OWNS}` | `{DOES_NOT_OWN}` | `{ENTRY_CONDITION}` | `{OUTPUT}` |
| `{P2}` | `{OWNS}` | `{DOES_NOT_OWN}` | `{ENTRY_CONDITION}` | `{OUTPUT}` |

### 6.3 Phase 之间的交接原则

1. `{HANDOFF_RULE_1}`
2. `{HANDOFF_RULE_2}`
3. `{HANDOFF_RULE_3}`

---

## 7. 各 Phase 详细说明

> 每个 Phase 至少回答 6 件事：
> 1. 目标
> 2. In-Scope
> 3. Out-of-Scope
> 4. 交付物
> 5. 收口标准
> 6. “什么不算完成”

### 7.1 `{P0} — {PHASE_NAME}`

#### 实现目标

`{PHASE_GOAL}`

#### In-Scope

1. `{PHASE_IN_SCOPE_1}`
2. `{PHASE_IN_SCOPE_2}`
3. `{PHASE_IN_SCOPE_3}`

#### Out-of-Scope

1. `{PHASE_OUT_SCOPE_1}`
2. `{PHASE_OUT_SCOPE_2}`

#### 交付物

1. `{DELIVERABLE_1}`
2. `{DELIVERABLE_2}`
3. `{DELIVERABLE_3}`

#### 收口标准

1. `{EXIT_CRITERION_1}`
2. `{EXIT_CRITERION_2}`
3. `{EXIT_CRITERION_3}`

#### 什么不算完成

1. `{NOT_DONE_CASE_1}`
2. `{NOT_DONE_CASE_2}`

#### 本 Phase 风险提醒

- `{PHASE_RISK_1}`
- `{PHASE_RISK_2}`

---

### 7.2 `{P1} — {PHASE_NAME}`

#### 实现目标

`{PHASE_GOAL}`

#### In-Scope

1. `{PHASE_IN_SCOPE_1}`
2. `{PHASE_IN_SCOPE_2}`
3. `{PHASE_IN_SCOPE_3}`

#### Out-of-Scope

1. `{PHASE_OUT_SCOPE_1}`
2. `{PHASE_OUT_SCOPE_2}`

#### 交付物

1. `{DELIVERABLE_1}`
2. `{DELIVERABLE_2}`
3. `{DELIVERABLE_3}`

#### 收口标准

1. `{EXIT_CRITERION_1}`
2. `{EXIT_CRITERION_2}`
3. `{EXIT_CRITERION_3}`

#### 什么不算完成

1. `{NOT_DONE_CASE_1}`
2. `{NOT_DONE_CASE_2}`

#### 本 Phase 风险提醒

- `{PHASE_RISK_1}`
- `{PHASE_RISK_2}`

---

### 7.3 `{P2} — {PHASE_NAME}`

#### 实现目标

`{PHASE_GOAL}`

#### In-Scope

1. `{PHASE_IN_SCOPE_1}`
2. `{PHASE_IN_SCOPE_2}`
3. `{PHASE_IN_SCOPE_3}`

#### Out-of-Scope

1. `{PHASE_OUT_SCOPE_1}`
2. `{PHASE_OUT_SCOPE_2}`

#### 交付物

1. `{DELIVERABLE_1}`
2. `{DELIVERABLE_2}`
3. `{DELIVERABLE_3}`

#### 收口标准

1. `{EXIT_CRITERION_1}`
2. `{EXIT_CRITERION_2}`
3. `{EXIT_CRITERION_3}`

#### 什么不算完成

1. `{NOT_DONE_CASE_1}`
2. `{NOT_DONE_CASE_2}`

#### 本 Phase 风险提醒

- `{PHASE_RISK_1}`
- `{PHASE_RISK_2}`

---

*（按需继续扩展 `7.N`）*

---

## 8. 执行顺序与 Gate

> charter 可以不下钻到 action-plan 任务级别，但应冻结“先后顺序”和“不能跳过的门槛”。

### 8.1 推荐执行顺序

1. `{ORDER_1}`
2. `{ORDER_2}`
3. `{ORDER_3}`

### 8.2 推荐 DAG / 依赖关系

```text
{P0}
├── {P1}
│   └── {P2}
└── {P3}
    └── {P4}
```

### 8.3 Gate 规则

| Gate | 含义 | 必须满足的条件 |
|------|------|----------------|
| Start Gate | `{MEANING}` | `{CONDITION}` |
| Build Gate | `{MEANING}` | `{CONDITION}` |
| Closure Gate | `{MEANING}` | `{CONDITION}` |

### 8.4 为什么这样排

`{WHY_THIS_ORDER}`

---

## 9. 测试与验证策略

> charter 层不需要列到每个测试文件，但必须冻结：
> - 需要哪几层证据
> - 哪些是不变量
> - 哪些验证是本阶段新增的

### 9.1 继承的验证层

1. `{INHERITED_LAYER_1}`
2. `{INHERITED_LAYER_2}`
3. `{INHERITED_LAYER_3}`

### 9.2 本阶段新增的验证重点

| 类别 | 验证内容 | 目的 |
|------|----------|------|
| `{CATEGORY}` | `{WHAT_TO_VALIDATE}` | `{WHY}` |
| `{CATEGORY}` | `{WHAT_TO_VALIDATE}` | `{WHY}` |
| `{CATEGORY}` | `{WHAT_TO_VALIDATE}` | `{WHY}` |

### 9.3 本阶段不变量

1. `{INVARIANT_1}`
2. `{INVARIANT_2}`
3. `{INVARIANT_3}`

### 9.4 证据不足时不允许宣称的内容

1. `{OVERCLAIM_1}`
2. `{OVERCLAIM_2}`

---

## 10. 收口分析（Exit / Non-Exit Discipline）

> 这是模板里最重要的新强化点之一。
> 必须把“成功退出”“带已知问题退出”“不能退出”区分清楚。

### 10.1 Primary Exit Criteria（硬闸）

1. `{PRIMARY_EXIT_1}`
2. `{PRIMARY_EXIT_2}`
3. `{PRIMARY_EXIT_3}`
4. `{PRIMARY_EXIT_4}`

### 10.2 Secondary Outcomes（结果加分项，不是硬闸）

1. `{SECONDARY_OUTCOME_1}`
2. `{SECONDARY_OUTCOME_2}`

### 10.3 NOT-成功退出识别

以下任一成立，则**不得**宣称本阶段收口：

1. `{NOT_SUCCESS_CASE_1}`
2. `{NOT_SUCCESS_CASE_2}`
3. `{NOT_SUCCESS_CASE_3}`

### 10.4 收口类型判定表

| 收口类型 | 含义 | 使用条件 | 文档要求 |
|----------|------|----------|----------|
| `full close` | 阶段核心目标与硬闸全部满足 | `{WHEN_ALLOWED}` | `{DOC_REQUIREMENT}` |
| `close-with-known-issues` | 主线已完成，但残留问题被明确降级且不破坏本阶段目标 | `{WHEN_ALLOWED}` | `{DOC_REQUIREMENT}` |
| `cannot close` | 仍存在 blocker / truth drift / 证据不足 | `{WHEN_ALLOWED}` | `{DOC_REQUIREMENT}` |

### 10.5 这一阶段成功退出意味着什么

`{WHAT_SUCCESS_MEANS}`

### 10.6 这一阶段成功退出**不意味着什么**

1. `{WHAT_SUCCESS_DOES_NOT_MEAN_1}`
2. `{WHAT_SUCCESS_DOES_NOT_MEAN_2}`

---

## 11. 下一阶段触发条件

> 写清楚“什么条件下，下一阶段才被合法打开”。

### 11.1 下一阶段会正式纳入 In-Scope 的内容

1. `{NEXT_PHASE_SCOPE_1}`
2. `{NEXT_PHASE_SCOPE_2}`
3. `{NEXT_PHASE_SCOPE_3}`

### 11.2 下一阶段的开启前提

1. `{NEXT_PHASE_PRECONDITION_1}`
2. `{NEXT_PHASE_PRECONDITION_2}`

### 11.3 为什么这些内容不能前移到本阶段

`{WHY_NOT_NOW}`

---

## 12. Owner / Architect 决策区（可选）

> **使用规则**：
> - 如果 owner 明确要求“charter 不写 QnA”，则本节删除，并在 §0 明写“不在本文件展开 QnA”。
> - 如果本阶段确实有少量必须在 charter 冻结的默认答案，可以保留本节。

### Q1 — `{QUESTION}`

- **为什么必须回答**：`{WHY}`
- **当前建议 / 默认答案**：`{DEFAULT_ANSWER}`
- **最晚冻结时点**：`{DEADLINE}`

### Q2 — `{QUESTION}`

- **为什么必须回答**：`{WHY}`
- **当前建议 / 默认答案**：`{DEFAULT_ANSWER}`
- **最晚冻结时点**：`{DEADLINE}`

---

## 13. 后续文档生产清单

### 13.1 Design 文档

- `{DESIGN_DOC_1}`
- `{DESIGN_DOC_2}`

### 13.2 Action-Plan 文档

- `{ACTION_PLAN_1}`
- `{ACTION_PLAN_2}`

### 13.3 Closure / Handoff 文档

- `{CLOSURE_DOC}`
- `{HANDOFF_DOC}`

### 13.4 建议撰写顺序

1. `{WRITE_ORDER_1}`
2. `{WRITE_ORDER_2}`
3. `{WRITE_ORDER_3}`

---

## 14. 最终 Verdict

### 14.1 对本阶段的最终定义

`{FINAL_DEFINITION}`

### 14.2 工程价值

`{ENGINEERING_VALUE}`

### 14.3 业务价值

`{BUSINESS_VALUE}`

### 14.4 一句话总结

> `{ONE_LINE_SUMMARY}`

---

## 15. 维护约定

1. **charter 只更新冻结边界、Phase 定义、退出条件，不回填逐任务执行日志。**
2. **执行过程中的具体变更进入 action-plan / closure / handoff。**
3. **若阶段方向被重写，必须在文首修订历史说明：改了什么、为什么改。**
4. **若某项由 in-scope 改为 out-of-scope（或反向），必须同步更新 §4、§7、§10、§11。**
5. **若采用 `close-with-known-issues`，必须在 closure 文档里复写对应残留问题、影响范围与下游落点。**
