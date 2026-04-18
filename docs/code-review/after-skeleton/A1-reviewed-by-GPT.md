# Nano-Agent A1 Contract & Identifier Freeze — Code Review

> 审查对象: `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`
> 审查时间: `2026-04-18`
> 审查人: `GPT-4.7 (Kimi k2p5)`
> 审查范围:
> - `packages/nacp-core/src/{envelope,version,compat/migrations,index,error-registry}.ts`
> - `packages/nacp-core/test/{envelope,version,compat,messages,transport,tenancy,admissibility}.test.ts`
> - `packages/nacp-session/src/{messages,session-registry,frame,ingress,websocket,replay,index}.ts`
> - `packages/nacp-session/test/{messages,session-registry,frame,ingress,websocket,replay,integration}.test.ts`
> - `packages/llm-wrapper/src/adapters/openai-chat.ts`
> - `test/e2e/e2e-05-session-resume.test.mjs`
> - `test/e2e/e2e-11-ws-replay-http-fallback.test.mjs`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`A1 实现已满足 action-plan 的收口标准，可以关闭本轮 review。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `所有 7 组 canonical rename 已正确落地，且 source 中不再存在 legacy field names`
  2. `compat/migrations.ts 从 placeholder 升级为真实可执行的 migrate_v1_0_to_v1_1，覆盖全部 rename 规则`
  3. `session.followup_input 作为最小 follow-up family 已正确纳入 nacp-session 冻结面，且 phase/role gate 完整`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`
  - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
  - `docs/design/after-skeleton/P0-identifier-law.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
- **核查实现**：
  - `packages/nacp-core/src/envelope.ts`
  - `packages/nacp-core/src/compat/migrations.ts`
  - `packages/nacp-core/src/version.ts`
  - `packages/nacp-session/src/messages.ts`
  - `packages/nacp-session/src/session-registry.ts`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/nacp-core test` → 12 files / 231 tests passed
  - `pnpm --filter @nano-agent/nacp-session test` → 14 files / 115 tests passed
  - `node --test test/trace-first-law-contract.test.mjs` → 9/9 passed
  - `node --test test/e2e/*.test.mjs` → 14/14 passed
  - `grep -rn "trace_id\|producer_id\|consumer_hint\|span_id" packages/nacp-core/src/ packages/nacp-session/src/ | grep -v "compat/migrations"` → 0 matches

### 1.1 已确认的正面事实

- `packages/nacp-core/src/envelope.ts:115` — `trace_uuid: z.string().uuid()` 已正确替换 `trace_id`
- `packages/nacp-core/src/envelope.ts:118-120` — `stream_uuid`, `span_uuid` 已正确替换 `stream_id`, `span_id`
- `packages/nacp-core/src/envelope.ts:90-91` — `producer_key`, `consumer_key` 已正确替换 `producer_id`, `consumer_hint`
- `packages/nacp-core/src/envelope.ts:106` — `stamped_by_key` 已正确替换 `stamped_by`
- `packages/nacp-core/src/envelope.ts:167` — `reply_to_message_uuid` 已正确替换 `reply_to`
- `packages/nacp-core/src/compat/migrations.ts` — 真实实现 `migrate_v1_0_to_v1_1`，覆盖 7 组 rename + schema_version bump + canonical-wins 策略
- `packages/nacp-core/src/version.ts:19` — `NACP_VERSION = "1.1.0"`, `NACP_VERSION_KIND = "frozen"`
- `packages/nacp-session/src/messages.ts:71-76` — `SessionFollowupInputBodySchema` 已添加，shape = `{ text, context_ref?, stream_seq? }`
- `packages/nacp-session/src/session-registry.ts:31` — `session.followup_input` 已纳入 client producer set
- `packages/nacp-session/src/session-registry.ts:86,94` — `session.followup_input` 已纳入 `attached` 和 `turn_running` phase allowed sets
- `packages/llm-wrapper/src/adapters/openai-chat.ts:22-26` — 明确标注 `tool_call_id` 为 translation-zone exception，不泄漏到 canonical domain
- `packages/nacp-core/test/compat.test.ts` — 14 个 cases 覆盖全部 rename 规则、legacy payload acceptance、canonical-wins、schema_version bump

### 1.2 已确认的负面事实

- `packages/nacp-core/src/compat/migrations.ts` — 迁移函数使用浅拷贝 `{ ...raw }`，对深层嵌套对象（如 `body.attachments[].metadata` 中的 legacy 字段）不会递归迁移
- `test/e2e/` 中只有 2 处被更新（e2e-05 和 e2e-11），其他 E2E 测试中如果使用了 legacy field names 可能未被主动更新（虽然通过代码搜索确认没有遗留）
- `packages/session-do-runtime/src/do/nano-session-do.ts:310` — `session.followup_input` 的 case 存在但尚未在 A4 中实现完整的 turn 调度（这是预期内的，A1 只负责 protocol freeze）

---

## 2. 审查发现

### R1. Compat Migration 浅拷贝限制

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-core/src/compat/migrations.ts:48-49` — `const cloned: Record<string, unknown> = { ...raw };`
  - 迁移只处理 header/authority/trace/control/session_frame 的顶层字段，对深层嵌套不递归
- **为什么重要**：
  - 如果未来有人在 `body.metadata` 或 `extra` 中放入 legacy 字段，迁移函数不会处理
  - 虽然当前规范不要求 body/extra 中的字段迁移，但这是一个潜在的遗漏点
- **审查判断**：
  - 当前实现满足 A1 的收口标准（只处理 canonical rename 的字段）
  - 但应在代码注释中明确说明此限制，避免未来误用
- **建议修法**：
  - 在 `migrate_v1_0_to_v1_1` 的 JSDoc 中增加：`"NOTE: This migration only renames top-level envelope fields. Deeply nested legacy fields inside body/extra are not traversed."`

### R2. Session Followup Phase 限制未在 Action-Plan 中显式记录

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/nacp-session/src/session-registry.ts:86,94` — `session.followup_input` 只允许在 `attached` 和 `turn_running` phase 中
  - `packages/nacp-session/src/session-registry.ts:74-77` — `unattached` phase 只允许 `session.start` 和 `session.resume`
- **为什么重要**：
  - 这意味着在 session 未 attach 之前，client 不能发送 follow-up input
  - 这是一个合理的限制，但 action-plan 中没有明确说明此设计决策
- **审查判断**：
  - 设计本身正确（防止未 attach session 接收 follow-up）
  - 应在 A1 的 Phase 3 说明中补充此限制的理由
- **建议修法**：
  - 在 A1.md §5.3 的 Phase 3 说明中补充：`"session.followup_input 被限制在 attached 和 turn_running phase，不允许在 unattached phase 发送，以防止未初始化 session 接收后续输入。"`

### R3. 测试覆盖率 gap：normalizeClientFrame 的 legacy frame 处理

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - Opus 工作报告 §11.4 已自检：`"compat shim 目前只覆盖 envelope 级别的迁移路径，对 validateEnvelope 之外的其它入口（例如 future normalizeClientFrame 要不要也支持 legacy client frame）未做显式测试"`
  - `packages/nacp-session/src/ingress.ts` — `normalizeClientFrame` 目前只处理 canonical 字段
- **为什么重要**：
  - 如果老客户端发送了带 `trace_id` 的 session frame，normalizeClientFrame 会拒绝而非迁移
  - 这可能导致向后兼容性问题
- **审查判断**：
  - Opus 已正确识别此问题并标记为 non-blocking
  - 此问题属于 A3/A4 的责任范围（runtime 接入时处理 legacy client frame）
- **建议修法**：
  - 在 A3 action-plan 中明确添加一项工作：`"在 normalizeClientFrame 中添加 legacy session frame 的 compat shim 测试"`

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | Core canonical rename (7 组字段) | `done` | 全部完成，source 中无遗留 legacy names |
| S2 | Versioning/compat backbone | `done` | 1.1.0 frozen baseline + real migration + compat tests |
| S3 | Session follow-up family freeze | `done` | session.followup_input 已纳入，shape = {text, context_ref?, stream_seq?} |
| S4 | Direct consumer adoption | `done` | llm-wrapper translation-zone 注释 + 2 处 E2E 更新 |
| S5 | Review blocker / guardrail | `partial` | 代码中已 enforcing，但缺少自动化 lint/codemod（见 R1） |

### 3.1 对齐结论

- **done**: 4
- **partial**: 1
- **missing**: 0

> A1 的核心工作（rename + compat + follow-up family）已全部落地，测试证据充分。唯一 partial 项是长期的 guardrail 自动化，这不属于 A1 的单次执行范围。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Trace substrate benchmark (A2) | `遵守` | 未涉及 |
| O2 | TraceEventBase.traceUuid (A3) | `遵守` | 未涉及，但为 A3 预留了接口 |
| O3 | Queue/replace/merge 语义 | `遵守` | session.followup_input 仅含最小 shape，无 queue 语义 |
| O4 | Public API / frontend / DDL | `遵守` | 未涉及 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`A1 实现已满足 action-plan 的收口标准，可以关闭本轮 review。`
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：
  1. 无 blocker
- **可以后续跟进的 non-blocking follow-up**：
  1. `R1`: 在 compat/migrations.ts 的 JSDoc 中补充浅拷贝限制说明（1 行注释）
  2. `R2`: 在 A1.md Phase 3 说明中补充 follow-up phase 限制的解释（1 段文字）
  3. `R3`: 在 A3 action-plan 中添加 normalizeClientFrame legacy frame 测试项

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说"已修一些问题"
> 3. 必须写明"哪些修了、怎么修的、改了哪些文件、跑了什么验证"
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R3`

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
> 3. 必须明确"本轮是否收口"

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
