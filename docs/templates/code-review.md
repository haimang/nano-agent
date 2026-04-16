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

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R{N}`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `{ISSUE}` | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R2 | `{ISSUE}` | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`
- `{FILE_3}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**：
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> **规则**：
> 1. 二次审查人不得改写 §0–§6，只能继续 append
> 2. 二次审查必须区分：
>    - 已验证修复有效
>    - 仅部分修复
>    - 新引入问题
> 3. 必须明确“本轮是否收口”

### 7.1 二次审查结论

> 复核者: `{REVIEWER}`
> 复核时间: `{DATE}`
> 复核依据: `实现者 §6 的回应 + 当前代码事实`

- **二次结论**：`{ONE_LINE_REREVIEW_VERDICT}`
- **是否收口**：`yes | no`

### 7.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `{FILE:LINE / command / test}` |
| R2 | `closed` | `{FILE:LINE / command / test}` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |
| R4 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |

### 7.4 二次收口意见

- **必须继续修改的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可后续跟进的 follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 若仍不收口，请明确写：  
> `请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。`

---

## 8. 文档纪律

- review 文档是**append-only**的执行记录：
  - 初审写 §0–§5
  - 实现者回应写 §6
  - 二次审查写 §7
  - 如有第三轮，继续在底部追加 `§8+`
- 不要删除上一轮判断；如果观点变化，必须写“为什么变化”
- 每条结论都应尽量有**文件 / 行号 / 命令输出**支撑
- 如果 action-plan / design doc 的边界本身变了，先更新源文档，再继续 code review

