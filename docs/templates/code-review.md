# Nano-Agent 代码审查模板

> 审查对象: `{REVIEW_TARGET}`
> 审查时间: `{DATE}`
> 审查人: `{REVIEWER}`
> 审查范围:
> - `{SCOPE_PATH_OR_DOC}`
> - `{SCOPE_PATH_OR_DOC}`
> 文档状态: `reviewed | changes-requested | re-reviewed | closed`

---

## 0. 总结结论

> 先给一句话 verdict。  
> 例如：`该实现主体成立，但当前不应标记为 completed。`  
> 或：`该实现已满足 action-plan / design doc 的收口标准，可以关闭本轮 review。`

- **整体判断**：`{ONE_LINE_VERDICT}`
- **结论等级**：`approve | approve-with-followups | changes-requested | blocked`
- **本轮最关键的 1-3 个判断**：
  1. `{KEY_JUDGEMENT_1}`
  2. `{KEY_JUDGEMENT_2}`
  3. `{KEY_JUDGEMENT_3}`

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。  
> 明确你看了哪些文件、跑了哪些命令、核对了哪些计划项/设计项。

- **对照文档**：
  - `{ACTION_PLAN_OR_DESIGN_DOC}`
  - `{RELATED_DOC}`
- **核查实现**：
  - `{IMPLEMENTATION_PATH}`
  - `{TEST_PATH}`
- **执行过的验证**：
  - `{COMMAND_1}`
  - `{COMMAND_2}`
  - `{COMMAND_3}`

### 1.1 已确认的正面事实

- `{FACT_POSITIVE_1}`
- `{FACT_POSITIVE_2}`
- `{FACT_POSITIVE_3}`

### 1.2 已确认的负面事实

- `{FACT_NEGATIVE_1}`
- `{FACT_NEGATIVE_2}`
- `{FACT_NEGATIVE_3}`

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`  
> 每条 finding 都应包含：严重级别、事实依据、为什么重要、审查判断。  
> 只写真正影响 correctness / security / scope / delivery 的问题，不写样式意见。

### R1. `{FINDING_TITLE}`

- **严重级别**：`critical | high | medium | low`
- **类型**：`correctness | security | scope-drift | delivery-gap | test-gap | docs-gap`
- **事实依据**：
  - `{FILE:LINE or FACT}`
  - `{FILE:LINE or FACT}`
- **为什么重要**：
  - `{WHY_IT_MATTERS}`
- **审查判断**：
  - `{REVIEW_JUDGEMENT}`
- **建议修法**：
  - `{ACTIONABLE_FIX}`

### R2. `{FINDING_TITLE}`

- **严重级别**：`critical | high | medium | low`
- **类型**：`correctness | security | scope-drift | delivery-gap | test-gap | docs-gap`
- **事实依据**：
  - `{FILE:LINE or FACT}`
  - `{FILE:LINE or FACT}`
- **为什么重要**：
  - `{WHY_IT_MATTERS}`
- **审查判断**：
  - `{REVIEW_JUDGEMENT}`
- **建议修法**：
  - `{ACTIONABLE_FIX}`

*（按需继续扩展 R3 / R4 / ...）*

---

## 3. In-Scope 逐项对齐审核

> 如果存在 action-plan / design doc，就必须有这一节。  
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `{ITEM}` | `done` | `{WHY}` |
| S2 | `{ITEM}` | `partial` | `{WHY}` |
| S3 | `{ITEM}` | `missing` | `{WHY}` |

### 3.1 对齐结论

- **done**: `{COUNT}`
- **partial**: `{COUNT}`
- **missing**: `{COUNT}`

> 用一到两句话总结“它更像什么状态”，例如：  
> `这更像“核心骨架完成，但 transport/enforcement 仍未收口”，而不是 completed。`

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | `{ITEM}` | `遵守` | `{WHY}` |
| O2 | `{ITEM}` | `部分违反` | `{WHY}` |
| O3 | `{ITEM}` | `违反` | `{WHY}` |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`{FINAL_VERDICT}`
- **是否允许关闭本轮 review**：`yes | no`
- **关闭前必须完成的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可以后续跟进的 non-blocking follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 如果不能关闭，请明确写出：  
> `本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。`