# Nano-Agent 代码审查报告

> 审查对象: `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`
> 审查时间: `2026-04-18`
> 审查人: `GPT-5.4`
> 审查范围:
> - `packages/nacp-core/**`
> - `packages/nacp-session/**`
> - `packages/llm-wrapper/src/adapters/openai-chat.ts`
> - `README.md`
> - `docs/design/after-skeleton/P0-*.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`A1 的代码主线已经成立，但 exit pack 仍未收口；当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `core rename + compat backbone + session.followup_input frozen surface` 已在代码与测试层真实落地。
  2. `nacp-session` 的公共版本/文档出口仍停留在 pre-A1 口径，和当前 `1.1.0 + 8 kinds + followup frozen` reality 冲突。
  3. P0 design suite 仍保留互相矛盾的 pre-execution 文案与未关闭问题，尚不能作为 A2/A3/A4 可直接继承的 frozen baseline。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`
  - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`
  - `docs/design/after-skeleton/P0-contract-freeze-matrix.md`
  - `docs/design/after-skeleton/P0-identifier-law.md`
  - `docs/design/after-skeleton/P0-nacp-versioning-policy.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
- **核查实现**：
  - `packages/nacp-core/src/{envelope,compat/migrations,version}.ts`
  - `packages/nacp-session/src/{messages,session-registry,frame,ingress,websocket,version}.ts`
  - `packages/llm-wrapper/src/adapters/openai-chat.ts`
  - `packages/nacp-core/test/**`, `packages/nacp-session/test/**`
  - `README.md`, `packages/nacp-session/README.md`, `docs/nacp-session-registry.md`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/nacp-core test`
  - `pnpm --filter @nano-agent/nacp-core typecheck && pnpm --filter @nano-agent/nacp-core build`
  - `pnpm --filter @nano-agent/nacp-core build:schema && pnpm --filter @nano-agent/nacp-core build:docs`
  - `pnpm --filter @nano-agent/nacp-session test`
  - `pnpm --filter @nano-agent/nacp-session test:integration`
  - `pnpm --filter @nano-agent/nacp-session typecheck && pnpm --filter @nano-agent/nacp-session build`
  - `pnpm test:cross`
  - `rg 'trace_id|stream_id|span_id|producer_id|consumer_hint|stamped_by|reply_to' packages/**/src/**/*.ts`

### 1.1 已确认的正面事实

- `packages/nacp-core/src/envelope.ts` 与 `packages/nacp-core/src/compat/migrations.ts` 已完成 canonical rename，并在 `validateEnvelope()` 上接入 `migrate_v1_0_to_v1_1` 的 Layer 0 compat shim。
- `packages/nacp-core/src/version.ts` 已切到 `NACP_VERSION = "1.1.0"`、`NACP_VERSION_COMPAT = "1.0.0"`、`NACP_VERSION_KIND = "frozen"`；`packages/nacp-core/test/compat.test.ts` 也已覆盖 legacy 1.0 → 1.1 迁移证据。
- `packages/nacp-session/src/messages.ts`、`session-registry.ts`、`ingress.ts`、`websocket.ts` 已把 `session.followup_input` 与 `trace_uuid / stream_uuid / producer_key / stamped_by_key` 真正接入 session truth；`packages/llm-wrapper/src/adapters/openai-chat.ts` 也已把 `tool_call_id` 明确圈在 translation zone。

### 1.2 已确认的负面事实

- `packages/nacp-session/README.md:7-8,61-66` 仍写着“7 Session message schemas”，并把 formal follow-up input family 说成 deferred。
- `packages/nacp-session/src/version.ts:1-3` 仍导出 `NACP_SESSION_VERSION = "1.0.0"`；`packages/nacp-session/scripts/gen-registry-doc.ts:8-15` 用它生成文档，而 `docs/nacp-session-registry.md:1-17` 当前确实仍是 `v1.0.0` 且缺失 `session.followup_input`。
- `docs/design/after-skeleton/P0-contract-freeze-matrix.md:258-276,315-325,332-333,385-389` 与 `P0-nacp-versioning-policy.md:17,364-370`、`P0-contract-and-identifier-freeze.md:388-396`、`P0-identifier-law.md:369-373` 仍保留 pre-A1 文案、未关闭 checklist 或互相冲突的 freeze 状态。

---

## 2. 审查发现

### R1. `nacp-session` 公共版本与文档出口仍停留在 pre-A1 口径

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/nacp-session/README.md:7-8` 仍声明只有 7 条 session message types；`README.md:65-66` 仍把 follow-up family 写成 deferred。
  - `packages/nacp-session/src/version.ts:1-3` 导出 `NACP_SESSION_VERSION = "1.0.0"`；`packages/nacp-session/scripts/gen-registry-doc.ts:8-15` 用该常量生成 registry doc。
  - `docs/nacp-session-registry.md:1-17` 当前标题仍是 `v1.0.0`，消息表也没有 `session.followup_input`。
- **为什么重要**：
  - A1 的 Phase 3/5 明确要求把 formal follow-up family 冻结进 session profile，并用 README/docs/baseline cut 形成可被下游直接消费的 exit pack。
  - 当前 runtime/source truth 与公共文档出口相互矛盾，会直接误导 A4 session edge、后续 reviewer、以及任何只读 package README/registry 的实现者。
- **审查判断**：
  - 这不是“文案没跟上”的轻微问题，而是 A1 交付件的一部分没有完成；当前 `nacp-session` 还在对外暴露旧 baseline。
- **建议修法**：
  - 统一 `packages/nacp-session/src/version.ts` 与实际 wire baseline 的关系（删除 session-local version 常量，或显式改到与 A1 一致的口径）。
  - 更新 `packages/nacp-session/README.md` 与 `docs/nacp-session-registry.md`，确保其明确反映 `1.1.0 + 8 kinds + session.followup_input frozen` reality。
  - 重新执行并提交 `build:docs` 产物，确认生成链与 source truth 一致。

### R2. P0 design suite 仍未同步成单一、可信的 frozen baseline

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/design/after-skeleton/P0-contract-freeze-matrix.md:258-276` 仍把 core/session 若干面写成 `Frozen with Rename` / `Directional Only`，但 `:315-325` 的 matrix 本体又写成 `Frozen`；`:332-333` 的 gate note 也仍假设 rename 尚未完成。
  - `docs/design/after-skeleton/P0-nacp-versioning-policy.md:17` 仍写“当前 version.ts 是 `1.0.0`/placeholder”；`:364-370` 仍把 `1.1.0` baseline 当待确认事项。
  - `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md:388-396` 与 `P0-identifier-law.md:369-373` 仍保留已被 AX-QNA/A1 落地的问题与“需要更新其他设计文档”的待办。
- **为什么重要**：
  - A1 的 Phase 4/5 明确把 `README + P0 docs + review gate` 作为交付本体；这些文档不是附属说明，而是 A2/A3/A4 的 baseline source of truth。
  - 如果 P0 design suite 仍处于“部分已执行、部分仍是 pre-execution 草案”的混合状态，后续 phase 会继续围绕已解决问题重复争论，等于 A1 没真正完成 contract governance 收口。
- **审查判断**：
  - 当前 README 虽已补 baseline cut，但 P0 docs 套件仍未完成冻结后的统一回写；A1 还不能声称自己产出了可靠的 owner-aligned exit pack。
- **建议修法**：
  - 把 `P0-contract-freeze-matrix.md` 的详细阐述、gate note、checklist 与当前 matrix 本体统一到执行后 reality。
  - 把 `P0-nacp-versioning-policy.md`、`P0-contract-and-identifier-freeze.md`、`P0-identifier-law.md` 中已被 QNA/A1 解决的 open questions 改成已确认结论或显式 follow-up。
  - 完成后再做一次跨文档人工核对，确保 README / P0 docs / action-plan / code reality 不再互相打架。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `nacp-core` canonical envelope rename batch | `done` | `envelope.ts`、`compat/migrations.ts`、相关 tests 均已切到 `*_uuid/*_key/reply_to_message_uuid`。 |
| S2 | `nacp-core` versioning / compat backbone | `done` | `1.1.0` baseline、`1.0.0` compat floor、`migrate_v1_0_to_v1_1` 与 compat tests 都已成立。 |
| S3 | `nacp-session` frame/context rename + formal follow-up freeze | `done` | `messages/session-registry/frame/ingress/websocket` 与 tests 均已纳入 `session.followup_input` 与 canonical rename。 |
| S4 | direct consumers / package tests / README / P0 docs sync | `partial` | direct consumer 与 package tests 基本到位，但 `nacp-session` README/registry 与 P0 docs 套件仍未同步到 A1 reality。 |
| S5 | translation-zone exception 与 review blocker | `partial` | `llm-wrapper` translation-zone 注释已加，但 review/baseline 文档仍未形成单一可信口径。 |

### 3.1 对齐结论

- **done**: `3`
- **partial**: `2`
- **missing**: `0`

这更像 **“代码与测试骨架已完成，但 baseline docs / governance exit pack 仍未收口”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Trace substrate benchmark / P1 decision memo | `遵守` | 未提前进入 A2 的 substrate benchmark / storage decision 范围。 |
| O2 | `TraceEventBase.traceUuid` observability 落地 | `遵守` | A1 没把 observability P2 contract 偷带进来。 |
| O3 | follow-up queue / replace / merge / approval-aware 调度语义 | `遵守` | 当前只冻结了最小 `session.followup_input` shape，没有提前扩张调度语义。 |
| O4 | public API / frontend contract / business DDL / full fake bash | `遵守` | A1 仍聚焦于 contract freeze，而非越界做后续 phase 的产品面。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`代码实现主线成立，但 A1 仍需补齐 docs/baseline exit pack；本轮 review 不收口。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 同步 `packages/nacp-session` 的公共版本与文档出口：至少修正 `src/version.ts`、`packages/nacp-session/README.md`、`docs/nacp-session-registry.md`，使其与 `1.1.0 + 8 kinds + session.followup_input frozen` reality 一致。
  2. 完成 `docs/design/after-skeleton/P0-*.md` 的执行后回写，移除与 A1 已落地事实冲突的 pre-execution 文案、旧 freeze 状态与未关闭 checklist。
- **可以后续跟进的 non-blocking follow-up**：
  1. 在后续 session runtime phase 明确：`normalizeClientFrame()/validateSessionFrame()` 是否也需要消费 legacy 1.0 client-frame compat，而不仅是 envelope-level compat。
  2. 在 action-plan 元数据里补一句说明：`context/codex` / `context/claude-code` 在 A1 中属于 benchmark reference，而非直接实现来源，避免后续 reviewer 误读。

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-18`
> 回应范围: `GPT 的 R1–R2 + Kimi 的 R1–R3（见 Kimi 报告 §6）`

- **总体回应**：`GPT 提出的两条 blocker（R1 nacp-session 公共出口未同步、R2 P0 design suite 未完成执行后回写）完全属实，已全部 fix；Kimi 提出的 R1（NACP_VERSION_KIND 未导出）属实已 fix，R2（compat 浅拷贝限制）与 R3（normalizeClientFrame 不处理 legacy session frame）按建议追加 JSDoc + action-plan 已知限制披露。`
- **本轮修改策略**：`GPT blocker 先 fix，使 A1 exit pack 达到 closable；Kimi 的 R1 作为 follow-up blocker 一并 fix；R2/R3 属于 known-limitation 披露类，按 Kimi 推荐落入代码注释 + A1 §5.3 风险提醒，不越界扩大 A1 scope。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GPT R1 | nacp-session public version + README + registry doc 仍停留在 v1.0.0 / 7 kinds / follow-up deferred | `fixed` | `src/version.ts` 升到 `1.1.0`（`NACP_SESSION_VERSION_COMPAT = "1.0.0"`）；README 覆盖为 `1.1.0 + 8 kinds + followup frozen`；`pnpm --filter @nano-agent/nacp-session build:docs` 重新生成 `docs/nacp-session-registry.md`（v1.1.0 + `session.followup_input` 已入表） | `packages/nacp-session/src/version.ts`, `packages/nacp-session/README.md`, `docs/nacp-session-registry.md` |
| GPT R2 | P0 design suite 仍保留 pre-execution 文案 / 未关闭 checklist / 冲突 freeze 状态 | `fixed` | `P0-contract-freeze-matrix.md` §7.2 把 `Frozen with Rename / Directional Only` 改为 `Frozen` 并标注 A1 落地点；Gate note 重写为执行后口径；§9.3 checklist 关闭；`P0-nacp-versioning-policy.md` §0 追加 A1 收口状态段 + §9.3 checklist 关闭；`P0-identifier-law.md` §9.3 checklist 关闭（保留 lint guard-rail 开放项）；`P0-contract-and-identifier-freeze.md` §9.3 checklist 关闭并显式把 observability alert 的 trace_uuid 例外延后到 A3 | `docs/design/after-skeleton/P0-contract-freeze-matrix.md`, `docs/design/after-skeleton/P0-nacp-versioning-policy.md`, `docs/design/after-skeleton/P0-identifier-law.md`, `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md` |
| Kimi R1 | `NACP_VERSION_KIND` + `NacpVersionKind` 未导出到 nacp-core 公共 API | `fixed` | `packages/nacp-core/src/index.ts` 的 version 导出块追加 `NACP_VERSION_KIND` 常量与 `NacpVersionKind` 类型；下游包（session-do-runtime / eval-observability 等）现在可直接 `import { NACP_VERSION_KIND } from "@nano-agent/nacp-core"` 做 baseline 断言 | `packages/nacp-core/src/index.ts` |
| Kimi R2 | compat migration 为浅拷贝 + 单层 rename，JSDoc 未声明限制范围 | `fixed` (docs-only，符合 Kimi 建议) | `rename()` 新增注释段声明只操作直接属性、不递归；`migrate_v1_0_to_v1_1` 的 JSDoc 追加 `Scope (Kimi R2)` 段，显式枚举六个被 rename 的 section 与 `body.stream_id` 特例，并说明 `body / extra / refs[]` 深层字段不会被遍历、shallow spread 只克隆顶层 | `packages/nacp-core/src/compat/migrations.ts` |
| Kimi R3 | `normalizeClientFrame` 不运行 `migrate_v1_0_to_v1_1`，legacy session frame 会被直接拒绝 | `deferred` (按 Kimi 建议 docs-only 披露，实际修复归 A3/A4) | `A1-contract-and-identifier-freeze.md` §5.3 的 "本 Phase 风险提醒" 下新增一段「已知局限（Kimi A1 review R3 — 2026-04-18 追加）」：显式声明当前 ingress 与 envelope compat 行为不一致、限制范围、以及 A3/A4 是后续负责 session frame compat shim 的阶段 | `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md` |

### 6.3 变更文件清单

- `packages/nacp-core/src/index.ts`（Kimi R1 — export NACP_VERSION_KIND + NacpVersionKind）
- `packages/nacp-core/src/compat/migrations.ts`（Kimi R2 — rename() 注释 + migrate_v1_0_to_v1_1 JSDoc 扩展）
- `packages/nacp-session/src/version.ts`（GPT R1 — bump 1.1.0 + compat 说明）
- `packages/nacp-session/README.md`（GPT R1 — 8 kinds + followup frozen 段重写）
- `docs/nacp-session-registry.md`（GPT R1 — 由 `build:docs` 重新生成，v1.1.0 + session.followup_input 入表）
- `docs/design/after-skeleton/P0-contract-freeze-matrix.md`（GPT R2 — §7.2 状态、Gate note、§9.3 checklist）
- `docs/design/after-skeleton/P0-nacp-versioning-policy.md`（GPT R2 — §0 A1 收口段、§9.3 checklist）
- `docs/design/after-skeleton/P0-identifier-law.md`（GPT R2 — §9.3 checklist）
- `docs/design/after-skeleton/P0-contract-and-identifier-freeze.md`（GPT R2 — §9.3 checklist）
- `docs/action-plan/after-skeleton/A1-contract-and-identifier-freeze.md`（Kimi R3 — §5.3 已知局限段）

### 6.4 验证结果

```text
pnpm -r typecheck                                 →  10 包全绿
pnpm -r build                                     →  10 包全绿
pnpm --filter @nano-agent/nacp-core test          →  231 passed
pnpm --filter @nano-agent/nacp-session test       →  115 passed
pnpm --filter @nano-agent/nacp-core build:schema  →  dist/nacp-core.schema.json (17 definitions)
pnpm --filter @nano-agent/nacp-session build:docs →  docs/nacp-session-registry.md 重新生成 (v1.1.0 + 8 message types)
node --test test/*.test.mjs  (root e2e)           →  52/52 passed
npm run test:cross                                →  14/14 passed
```

全量跨 10 包 1691 cases 零回归：`nacp-core 231 / nacp-session 115 / eval-observability 194 / hooks 132 / llm-wrapper 103 / agent-runtime-kernel 123 / capability-runtime 227 / storage-topology 114 / workspace-context-artifacts 163 / session-do-runtime 309`。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `normalizeClientFrame()` 不对 session frame 运行 `migrate_v1_0_to_v1_1`（Kimi R3）— 属 A3/A4 scope，已在 A1 §5.3 显式声明为已知限制。
  2. 暂未引入 lint rule 阻止 canonical code 中新增 `*_id` 命名 — 属 A1 范围外的长期 guard-rail，保留为 follow-up（`P0-identifier-law.md` §9.3 仍有开放勾）。

### 6.6 对两位 reviewer 报告的整体评价

- **GPT 报告评价**：GPT 的切入角度是「exit pack 完整性」—— 两条 finding 都直接锁定了 A1 声称完成但实际未同步的交付件（nacp-session 公共出口 / P0 design suite post-exec 文案），并且通过跨 README + src/version.ts + docs + design doc 交叉取证，证据链硬度高。两条 finding 全部属实，且均属 blocker 级别；执行者接受全部判断并逐项修复。GPT 的 §1.2 直接点出 `packages/nacp-session/README.md:7-8,61-66` 与 `src/version.ts:1-3` 这种行号级证据最省 reviewer 复核时间。**这份报告质量极高，把「代码主线成立」与「exit pack 未完成」两件事清晰切开，避免了 A1 被误判为 completed。**
- **Kimi 报告评价**：Kimi 从「公共 API 契约完整性 + 向后兼容深度」切入，三条 finding（R1 公共 API 遗漏、R2 compat shallow 限制、R3 session frame compat 缺位）都是 GPT 没覆盖的、更底层的代码契约问题；R3 尤其尖锐——它明确指出 envelope 层走了 compat shim、session frame 层却没有，两者行为不一致。Kimi 对 R2/R3 的建议也很克制：都推荐「docs-only 披露而非 A1 范围扩张」，这让实现者可以在不越界的前提下关闭 finding。R1 的 1 行 fix 成本 + 强影响比最典型地体现了 Kimi 的价值。**这份报告质量极高，既补齐了 GPT 未覆盖的代码契约盲区，又对修复边界给出了合理的收敛建议。**
- **综合结论**：两份报告视角互补——GPT 关注 exit pack / delivery 完整性，Kimi 关注 public API / 向后兼容正确性。两份都是 approve-grade 审查工作，执行者根据两份合并的 blocker + follow-up 列表完整闭环所有 findings；建议未来继续沿用「delivery 维度 + 契约维度」双 reviewer 的配合模式。
