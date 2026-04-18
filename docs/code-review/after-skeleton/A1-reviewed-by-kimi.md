# Nano-Agent A1 Contract & Identifier Freeze — Code Review by Kimi

> 审查对象: `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`
> 审查时间: `2026-04-18`
> 审查人: `Kimi (k2p5)`
> 审查范围:
> - `packages/nacp-core/src/{envelope,version,compat/migrations,index,error-registry,types}.ts`
> - `packages/nacp-core/test/{envelope,version,compat,messages,transport,tenancy,admissibility,observability}.test.ts`
> - `packages/nacp-session/src/{messages,session-registry,frame,ingress,websocket,replay,index}.ts`
> - `packages/nacp-session/test/{messages,session-registry,frame,ingress,websocket,replay,integration}.test.ts`
> - `packages/session-do-runtime/src/{do/nano-session-do,turn-ingress}.ts`
> - `packages/llm-wrapper/src/adapters/openai-chat.ts`
> - `test/e2e/e2e-05-session-resume.test.mjs`
> - `test/e2e/e2e-11-ws-replay-http-fallback.test.mjs`
> - `docs/action-plan/after-skeleton/AX-QNA.md`
> - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
> - `docs/design/after-skeleton/P0-identifier-law.md`
> - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`A1 核心实现已落地，但存在 1 个公共 API 遗漏和 2 个向后兼容风险，应在关闭前修复。`
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `7 组 canonical rename 已全部完成，source 中无遗留 legacy field names`
  2. `compat/migrations.ts 从 placeholder 升级为真实可执行的 migrate_v1_0_to_v1_1，但通过浅拷贝实现，对深层嵌套 legacy 字段不递归`
  3. `NACP_VERSION_KIND 未导出到 nacp-core 公共 API，下游包无法断言 baseline 状态`

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`
  - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
  - `docs/design/after-skeleton/P0-identifier-law.md`
  - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
- **核查实现**：
  - `packages/nacp-core/src/{envelope,version,compat/migrations,index,error-registry,types}.ts`
  - `packages/nacp-session/src/{messages,session-registry,frame,ingress,websocket,replay,index}.ts`
  - `packages/session-do-runtime/src/{do/nano-session-do,turn-ingress}.ts`
  - `packages/llm-wrapper/src/adapters/openai-chat.ts`
  - `packages/nacp-core/test/**`
  - `packages/nacp-session/test/**`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/nacp-core test` → 12 files / 231 tests passed
  - `pnpm --filter @nano-agent/nacp-session test` → 14 files / 115 tests passed
  - `node --test test/trace-first-law-contract.test.mjs` → 9/9 passed
  - `node --test test/e2e/*.test.mjs` → 14/14 passed
  - `pnpm -r typecheck` → 10 projects 全绿
  - `grep -rn "trace_id\|producer_id\|consumer_hint\|span_id" packages/nacp-core/src/ packages/nacp-session/src/ | grep -v "compat/migrations"` → 0 matches

### 1.1 已确认的正面事实

- `packages/nacp-core/src/envelope.ts:115` — `trace_uuid: z.string().uuid()` 已正确替换 `trace_id`
- `packages/nacp-core/src/envelope.ts:118-120` — `stream_uuid`, `span_uuid` 已正确替换 `stream_id`, `span_id`
- `packages/nacp-core/src/envelope.ts:90-91` — `producer_key`, `consumer_key` 已正确替换 `producer_id`, `consumer_hint`
- `packages/nacp-core/src/envelope.ts:106` — `stamped_by_key` 已正确替换 `stamped_by`
- `packages/nacp-core/src/envelope.ts:167` — `reply_to_message_uuid` 已正确替换 `reply_to`
- `packages/nacp-core/src/compat/migrations.ts:48-101` — 真实实现 `migrate_v1_0_to_v1_1`，覆盖 header/authority/trace/control/session_frame/body 全部 rename 规则 + schema_version bump + canonical-wins 策略
- `packages/nacp-core/src/version.ts:19-29` — `NACP_VERSION = "1.1.0"`, `NACP_VERSION_COMPAT = "1.0.0"`, `NACP_VERSION_KIND = "frozen"`
- `packages/nacp-core/src/error-registry.ts:85` — `NACP_REPLY_TO_CLOSED` message 使用 canonical 字段名 `reply_to_message_uuid`
- `packages/nacp-session/src/messages.ts:71-76` — `SessionFollowupInputBodySchema` 已添加，shape = `{ text: string, context_ref?: NacpRef, stream_seq?: number }`
- `packages/nacp-session/src/session-registry.ts:31` — `session.followup_input` 已纳入 client producer set
- `packages/nacp-session/src/session-registry.ts:86,94` — `session.followup_input` 已纳入 `attached` 和 `turn_running` phase allowed sets，明确不在 `unattached` 中
- `packages/nacp-session/src/session-registry.ts:66-68` — session role 明确不 produce `session.followup_input`（正确：只有 client produce，session consume）
- `packages/nacp-session/src/websocket.ts:34-37` — `SessionContext` 使用 `trace_uuid`, `producer_key`, `stamped_by_key`
- `packages/nacp-session/src/ingress.ts:22,52` — `IngressContext` 使用 `stamped_by_key`
- `packages/nacp-session/src/frame.ts:25` — `SessionFrameFieldsSchema` 使用 `stream_uuid`
- `packages/session-do-runtime/src/turn-ingress.ts:97-109` — `extractTurnInput` 正确消费 `session.followup_input.body.text`
- `packages/session-do-runtime/src/do/nano-session-do.ts:310` — `session.followup_input` 进入 `dispatchAdmissibleFrame` 的 switch case，与 `session.start` 共享 turn input 路径
- `packages/llm-wrapper/src/adapters/openai-chat.ts:22-26` — 明确标注 `tool_call_id` 为 translation-zone exception，不泄漏到 canonical domain
- `packages/nacp-core/test/compat.test.ts` — 14 个 cases 覆盖全部 rename 规则、legacy payload acceptance、canonical-wins、schema_version bump

### 1.2 已确认的负面事实

- `packages/nacp-core/src/index.ts` — **未导出 `NacpVersionKind` 类型和 `NACP_VERSION_KIND` 常量**。虽然 `version.ts:28-29` 定义了它们，但 `index.ts` 的导出列表中没有它们。这意味着下游包（session-do-runtime、eval-observability 等）无法通过 `@nano-agent/nacp-core` 导入 `NACP_VERSION_KIND` 来断言当前 baseline 状态。
- `packages/nacp-core/src/compat/migrations.ts:30-38` — `rename()` 函数使用浅拷贝 `const cloned: Record<string, unknown> = { ...raw }` 和 `delete obj[from]`。这导致：
  1. 如果 raw payload 中有深层嵌套的 legacy 字段（如 `body.attachments[0].metadata.trace_id`），迁移函数不会递归处理。
  2. `delete` 操作在 v8 中可能触发 deopt（虽然对单次调用影响极小）。
- `packages/nacp-session/src/ingress.ts:25-73` — `normalizeClientFrame` 只接受已验证的 `NacpClientFrame` 类型，**不处理 legacy client frame**。如果老客户端发送了带 `trace_id` 的 session frame（而非 envelope-level 的 trace），normalizeClientFrame 不会调用 compat shim，而是直接拒绝。这与 envelope 层的 `validateEnvelope` 行为不一致——envelope 会先用 `migrate_v1_0_to_v1_1` 迁移再 parse，但 session frame 不会。
- `packages/nacp-core/src/types.ts` — 没有导出 `NacpVersionKind`，与 `index.ts` 的遗漏一致。

---

## 2. 审查发现

### R1. NACP_VERSION_KIND 未导出到公共 API

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/nacp-core/src/version.ts:28-29` 定义了 `export type NacpVersionKind = "provisional" | "frozen"` 和 `export const NACP_VERSION_KIND: NacpVersionKind = "frozen"`
  - `packages/nacp-core/src/index.ts` — 导出列表中没有 `NacpVersionKind` 或 `NACP_VERSION_KIND`
  - `grep -rn "NacpVersionKind\|NACP_VERSION_KIND" packages/nacp-session/src/ packages/session-do-runtime/src/` → 0 matches（下游包无法使用）
- **为什么重要**：
  - AX-QNA Q4 明确冻结 baseline 为 `1.1.0` 且 `NACP_VERSION_KIND = "frozen"`
  - 下游包（如 eval-observability、session-do-runtime）可能需要在运行时断言 "当前是否处于 frozen baseline" 来决策 trace 行为
  - 如果不导出，这个设计意图只停留在 version.ts 内部，无法形成跨包的契约
- **审查判断**：
  - 这是一个导出遗漏，不是逻辑错误
  - 修复成本极低：在 index.ts 中添加一行导出即可
- **建议修法**：
  - 在 `packages/nacp-core/src/index.ts` 中增加：`export { NACP_VERSION_KIND } from "./version.js"; export type { NacpVersionKind } from "./version.js";`

### R2. Compat 迁移的浅拷贝限制

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-core/src/compat/migrations.ts:48-49` — `const cloned: Record<string, unknown> = { ...raw };` 只浅拷贝顶层
  - `packages/nacp-core/src/compat/migrations.ts:30-38` — `rename()` 只操作直接属性，不递归
  - 当前迁移只处理：header.*, authority.*, trace.*, control.*, session_frame.*, body.stream_id（当 message_type = session.stream.ack）
- **为什么重要**：
  - 如果未来有人在 `body.extra.trace_id` 或 `refs[0].metadata.producer_id` 中放入 legacy 字段，迁移函数不会处理
  - 虽然当前规范不要求迁移深层字段，但这是一个潜在的向后兼容漏洞
  - 更关键的是：`validateEnvelope` 的 Layer 0 compat shim（`envelope.ts:279-288`）只对 `schema_version.startsWith("1.0.")` 的 payload 调用迁移。如果老 payload 被错误地标记为 `1.1.0`（例如手写测试），迁移不会执行，但 schema parse 会因为 `trace_id` 不存在而失败。这个失败信息（`trace.trace_uuid: Required`）对老用户不友好。
- **审查判断**：
  - 当前实现满足 A1 的收口标准（只处理 canonical rename 的字段）
  - 但应在 JSDoc 中明确说明限制范围，避免未来误用
- **建议修法**：
  - 在 `migrate_v1_0_to_v1_1` 的 JSDoc 中补充：`"NOTE: This migration only renames top-level envelope fields (header, authority, trace, control, session_frame, and body.stream_id for session.stream.ack). Deeply nested legacy fields inside body/extra/refs are not traversed."`

### R3. normalizeClientFrame 不处理 legacy session frame

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/nacp-core/src/envelope.ts:276-288` — `validateEnvelope` 在 Layer 0 对 `schema_version.startsWith("1.0.")` 的 payload 调用 `migrate_v1_0_to_v1_1`
  - `packages/nacp-session/src/ingress.ts:25-73` — `normalizeClientFrame` 的参数类型是 `NacpClientFrame`（已通过 `NacpClientFrameSchema` 验证），**没有 compat shim**
  - 这意味着老客户端发送的带 `trace_id` 的 session frame 会被 `NacpClientFrameSchema.safeParse` 拒绝（因为 schema 要求 `trace_uuid`）
- **为什么重要**：
  - envelope 层和 session frame 层的向后兼容策略不一致
  - envelope 接受 legacy payload 并迁移，但 session frame 直接拒绝
  - 对于直接通过 WebSocket 发送 session frame 的客户端（不经过 envelope encode/decode），这是一个 breaking change
- **审查判断**：
  - Opus 工作报告 §11.4 已自检此问题：`"compat shim 目前只覆盖 envelope 级别的迁移路径，对 validateEnvelope 之外的其它入口未做显式测试"`
  - 此问题属于 A3/A4 的责任范围（runtime 接入时处理 legacy client frame）
  - 但应在 A1 的 action-plan 中明确标记为 "known limitation"，并在 A3 action-plan 中添加对应工作项
- **建议修法**：
  - 在 A1.md §5.3 Phase 3 的 "风险提醒" 中补充：`"normalizeClientFrame 当前不处理 legacy client frame（带 trace_id/producer_id 等 retired 字段的 frame）。老客户端直接发送的 session frame 会被拒绝。此问题将在 A3/A4 中通过 session frame compat shim 解决。"`

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | Core canonical rename (7 组字段) | `done` | 全部完成，source 中无遗留 legacy names |
| S2 | Versioning/compat backbone | `done` | 1.1.0 frozen baseline + real migration + compat tests |
| S3 | Session follow-up family freeze | `done` | session.followup_input 已纳入，shape = {text, context_ref?, stream_seq?} |
| S4 | Direct consumer adoption | `done` | llm-wrapper translation-zone 注释 + 2 处 E2E 更新 |
| S5 | Review blocker / guardrail | `partial` | 代码已 enforcing，但缺少自动化 lint/codemod；NACP_VERSION_KIND 未导出 |

### 3.1 对齐结论

- **done**: 4
- **partial**: 1
- **missing**: 0

> A1 的核心工作（rename + compat + follow-up family）已全部落地，测试证据充分。partial 项包括：NACP_VERSION_KIND 公共 API 导出遗漏（R1），以及长期的 guardrail 自动化（超出单次执行范围）。

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

- **最终 verdict**：`A1 实现满足 action-plan 的核心收口标准，但存在 1 个公共 API 遗漏（R1）和 2 个向后兼容风险（R2、R3）。建议在关闭前修复 R1（1 行导出），并通过文档标记 R2/R3 为 known limitation。`
- **是否允许关闭本轮 review**：`yes-with-conditions`
- **关闭前必须完成的 blocker**：
  1. `R1`: 在 `packages/nacp-core/src/index.ts` 中导出 `NacpVersionKind` 和 `NACP_VERSION_KIND`
- **可以后续跟进的 non-blocking follow-up**：
  1. `R2`: 在 `compat/migrations.ts` 的 JSDoc 中补充浅拷贝限制说明
  2. `R3`: 在 A1.md 和 A3.md 中标记 normalizeClientFrame legacy frame 处理为 known limitation / future work
