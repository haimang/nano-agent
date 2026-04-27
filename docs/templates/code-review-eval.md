# Nano-Agent 代码审查质量评价模板

> 评价对象: `{REVIEWER_OR_REVIEW_SET}`
> 评价人: `{EVALUATOR}`
> 评价时间: `{DATE}`
> 评价范围:
> - `{REVIEW_DOC_PATH}`
> - `{REVIEW_DOC_PATH}`
> 评价类型: `single-review-eval | comparative-reviewer-eval | post-fix-rereview-eval`
> 文档状态: `draft | evaluated | superseded`

---

## 0. 评价结论

- **一句话评价**：`{ONE_LINE_STYLE_AND_VALUE}`
- **综合评分**：`{SCORE} / 5`
- **推荐使用场景**：`{WHEN_TO_USE_THIS_REVIEWER_OR_STYLE}`
- **不建议单独依赖的场景**：`{WHEN_NOT_TO_USE_ALONE}`

---

## 1. 评价方法与样本基础

> 本模板评价的是“审查质量”，不是被审代码本身。
> 评价必须基于可复核样本：审查文档、实现者回应、二次复核、最终代码事实或后续 closure。

- **样本范围**：`{SAMPLE_SCOPE}`
- **对照真相**：`{CODE_FACTS_OR_DESIGN_OR_CLOSURE}`
- **是否包含实现者事后修复结果**：`yes | no`
- **是否存在利益冲突 / 自评风险**：`yes | no` — `{DISCLOSURE}`
- **评价方法**：`{METHOD}`

---

## 2. 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | `{PROTOCOL_TRUTH / RUNTIME / CHECKLIST / PLATFORM / ETC}` | `{EXAMPLE}` |
| 证据类型 | `{LINE_REFERENCES / COMMANDS / SCHEMA_PARSE / LIVE_EVIDENCE}` | `{EXAMPLE}` |
| Verdict 倾向 | `{STRICT / BALANCED / OPTIMISTIC}` | `{EXAMPLE}` |
| Finding 粒度 | `{COARSE / BALANCED / FINE}` | `{EXAMPLE}` |
| 修法建议风格 | `{ABSTRACT / ACTIONABLE / OVER-PRESCRIPTIVE}` | `{EXAMPLE}` |

---

## 3. 优点与短板

### 3.1 优点

1. `{STRENGTH_1}`
2. `{STRENGTH_2}`
3. `{STRENGTH_3}`

### 3.2 短板 / 盲区

1. `{WEAKNESS_1}`
2. `{WEAKNESS_2}`
3. `{WEAKNESS_3}`

---

## 4. Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| `{R_ID}` | `critical | high | medium | low` | `true-positive | partial | false-positive | stale | missed-by-others` | `excellent | good | mixed | weak` | `{ANALYSIS}` |

### 4.1 False positive / stale 分析

- `{FALSE_POSITIVE_OR_STALE_CASE}`

### 4.2 False negative / 漏判分析

- `{MISSED_CASE}`

### 4.3 Severity 校准分析

- `{SEVERITY_CALIBRATION_NOTE}`

---

## 5. 多维度评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | `{SCORE}` | `{WHY}` |
| 判断严谨性 | `{SCORE}` | `{WHY}` |
| 修法建议可执行性 | `{SCORE}` | `{WHY}` |
| 对 action-plan / design / QNA 的忠实度 | `{SCORE}` | `{WHY}` |
| 协作友好度 | `{SCORE}` | `{WHY}` |
| 找到问题的覆盖面 | `{SCORE}` | `{WHY}` |
| 严重级别 / verdict 校准 | `{SCORE}` | `{WHY}` |
| 复核能力 / falsely-claimed-fixed 识别 | `{SCORE_OR_NA}` | `{WHY}` |

---

## 6. 对比分析（可选）

> 如果评价多个 reviewer，使用本节；单份 review 评价可删除。

| Reviewer | 强项 | 盲区 | 最适合阶段 |
|----------|------|------|------------|
| `{REVIEWER_A}` | `{STRENGTH}` | `{WEAKNESS}` | `{STAGE}` |
| `{REVIEWER_B}` | `{STRENGTH}` | `{WEAKNESS}` | `{STAGE}` |

### 6.1 Shared / Unique findings

| 类别 | 数量 | 说明 |
|------|------|------|
| 共享命中 | `{COUNT}` | `{DETAIL}` |
| `{REVIEWER_A}` 独家 | `{COUNT}` | `{DETAIL}` |
| `{REVIEWER_B}` 独家 | `{COUNT}` | `{DETAIL}` |

---

## 7. 使用建议

- **默认推荐用法**：`{RECOMMENDED_USAGE}`
- **需要搭配的补位 reviewer / 方法**：`{COMPLEMENT}`
- **给未来 prompt 的改进建议**：
  1. `{PROMPT_HINT_1}`
  2. `{PROMPT_HINT_2}`

---

## 8. 附录：作为主 review 追加评价时的短格式

> 如果必须把评价 append 到某份 `code-review.md` 后面，可以只使用本节短格式；独立 reviewer 质量复盘仍建议使用 §0–§7 完整模板。

### 8.1 对 {同事名称} 代码审查质量的评价

> 评价人: `{实现者名称}`
> 评价时间: `{日期}`
> 评价依据: `{审查文件的具体位置}`

- **一句话评价**：`{ONE_LINE}`
- **综合评分**：`{SCORE} / 5`
- **主要优点**：`{STRENGTHS}`
- **主要盲区**：`{WEAKNESSES}`
- **后续使用建议**：`{USAGE_RECOMMENDATION}`
