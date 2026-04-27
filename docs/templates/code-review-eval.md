# Nano-Agent 代码审查质量评价模板

> 评价对象: `{REVIEWER_OR_REVIEW_SET}`
> 评价人: `{EVALUATOR}`
> 评价时间: `{DATE}`

---

## 0. 评价结论

- **一句话评价**：`{ONE_LINE_STYLE_AND_VALUE}`
- **综合评分**：`{SCORE} / 10`
- **推荐使用场景**：`{WHEN_TO_USE_THIS_REVIEWER_OR_STYLE}`
- **不建议单独依赖的场景**：`{WHEN_NOT_TO_USE_ALONE}`

---

## 1. 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | `{PROTOCOL_TRUTH / RUNTIME / CHECKLIST / PLATFORM / ETC}` | `{EXAMPLE}` |
| 证据类型 | `{LINE_REFERENCES / COMMANDS / SCHEMA_PARSE / LIVE_EVIDENCE}` | `{EXAMPLE}` |
| Verdict 倾向 | `{STRICT / BALANCED / OPTIMISTIC}` | `{EXAMPLE}` |
| Finding 粒度 | `{COARSE / BALANCED / FINE}` | `{EXAMPLE}` |
| 修法建议风格 | `{ABSTRACT / ACTIONABLE / OVER-PRESCRIPTIVE}` | `{EXAMPLE}` |

---

## 2. 优点与短板

### 2.1 优点

1. `{STRENGTH_1}`
2. `{STRENGTH_2}`
3. `{STRENGTH_3}`

### 2.2 短板 / 盲区

1. `{WEAKNESS_1}`
2. `{WEAKNESS_2}`
3. `{WEAKNESS_3}`

---

## 3. Findings 质量清点

| 问题编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|----------|--------------|----------|--------------|------------|
| `{R_ID}` | `critical | high | medium | low` | `true-positive | partial | false-positive | stale | missed-by-others` | `excellent | good | mixed | weak` | `{ANALYSIS}` |


---

## 4. 多维度评分 - 单向总分10分

| 维度 | 评分（1–10） | 说明 |
|------|-------------|------|
| 证据链完整度 | `{SCORE}` | `{WHY}` |
| 判断严谨性 | `{SCORE}` | `{WHY}` |
| 修法建议可执行性 | `{SCORE}` | `{WHY}` |
| 对 action-plan / design / QNA 的忠实度 | `{SCORE}` | `{WHY}` |
| 协作友好度 | `{SCORE}` | `{WHY}` |
| 找到问题的覆盖面 | `{SCORE}` | `{WHY}` |
| 严重级别 / verdict 校准 | `{SCORE}` | `{WHY}` |