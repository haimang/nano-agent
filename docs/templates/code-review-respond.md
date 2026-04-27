
## 6. 实现者回应

> **规则**：
> 1. 不要改写 reviewer 写下的 §0–§5；只允许从这里往下 append。
> 2. 回应必须按 `R1/R2/...` 对应，不能模糊写“已修一些问题”。
> 3. 必须写明“哪些修了、怎么修、改了哪些文件、跑了什么验证”。
> 4. 若选择不修某条 finding，必须写明理由、tradeoff、后续承接位置。
> 5. 如果本节用于二次 / 三次回应，请保留历史 §6 内容，在后面追加 `## 6B / 6C` 或新的 dated section。

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R{N}`
> 对应审查文件: `{REVIEW_DOC_PATH}`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`
- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `{ISSUE}` | `fixed | partially-fixed | rejected | stale-rejected | deferred-with-rationale | blocked` | `{HOW}` | `{FILES}` |
| R2 | `{ISSUE}` | `fixed | partially-fixed | rejected | stale-rejected | deferred-with-rationale | blocked` | `{HOW}` | `{FILES}` |

### 6.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | `{COUNT}` | `{R_IDS}` | `{DETAIL}` |
| 部分修复，需二审判断 | `{COUNT}` | `{R_IDS}` | `{DETAIL}` |
| 有理由 deferred | `{COUNT}` | `{R_IDS}` | `{FOLLOWUP_DOC_OR_PHASE}` |
| 拒绝 / stale-rejected | `{COUNT}` | `{R_IDS}` | `{WHY}` |
| 仍 blocked | `{COUNT}` | `{R_IDS}` | `{BLOCKER}` |

### 6.4 变更文件清单

- `{FILE_1}` — `{WHY_CHANGED}`
- `{FILE_2}` — `{WHY_CHANGED}`
- `{FILE_3}` — `{WHY_CHANGED}`

### 6.5 验证结果

> 只写与本轮 findings 直接相关的验证。命令失败时必须保留失败摘要与当前判断，不要写成 success-shaped fallback。

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| `{VALIDATION_NAME}` | `{COMMAND_OR_EVIDENCE}` | `pass | fail | skipped-with-rationale` | `{R_IDS}` |

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| `{R_ID}` | `deferred | blocked | rejected` | `{RATIONALE}` | `{DOC_OR_PHASE_OR_ISSUE}` |

### 6.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes | no`
- **请求复核的范围**：`all findings | only R{N}/R{M} | closure wording | validation only`
- **实现者认为可以关闭的前提**：
  1. `{CLOSE_CONDITION_1}`
  2. `{CLOSE_CONDITION_2}`
