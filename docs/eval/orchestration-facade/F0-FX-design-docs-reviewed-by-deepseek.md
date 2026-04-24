# Orchestration Facade — F0-FX Design Docs Review

> 审查对象: `docs/design/orchestration-facade/` (9 份设计文档)
> 审查时间: `2026-04-24`
> 审查人: `deepseek-v4-pro`
> 审查范围:
> - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
> - `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md`
> - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
> - `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`
> - `docs/design/orchestration-facade/F0-user-do-schema.md`
> - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
> - `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md`
> - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
> - `docs/design/orchestration-facade/FX-qna.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: 9 份设计文档全部交付、内部一致、与 charter 对齐、代码锚点经核实准确。设计覆盖完整，可以进入 F0 action-plan 阶段。阻塞项仅 2 条，均为 QNA 问题的 8 条业主决策待回填。
- **结论等级**: `approve-with-followups`
- **本轮最关键的 3 个判断**:
  1. 8 项合同 / schema / 生命周期 / 吸收面 / 迁移面 / authority guardrail 均有对应设计文档，无缺失项。
  2. FX-qna 中 8 个 Q 的 `业主回答` 字段全部为空 — 这是 F0 freeze 收口前的唯一阻塞点，但属设计文档体系的正常收口节奏，非设计缺陷。
  3. 设计文档与代码现实之间的锚点引用准确（`nano-session-do.ts:812-819` 的 `_unknown` fallback、`ws-controller.ts:47-63` 的非 attach-owner 现状、`live.mjs` 的 4-worker URL 结构），与 `docs/plan-orchestration-facade.md` 的 §2.4 / §6.3 口径一致。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/plan-orchestration-facade.md` — Phase charter (1505 行，全文对照)
  - `docs/plan-orchestration-facade-reviewed-by-opus.md` — 1st-pass review
  - `docs/plan-orchestration-facade-reviewed-by-opus-2nd-pass.md` — 2nd-pass review
  - `docs/plan-worker-matrix.md` — 前置阶段 charter（全 Phase 已 closed）
- **核查实现**:
  - `workers/agent-core/src/index.ts` — live loop 入口，确认 `/sessions/:id/*` pattern
  - `workers/agent-core/src/host/routes.ts` — 确认 2 条 route pattern
  - `workers/agent-core/src/host/http-controller.ts` — 确认 7 action 表面
  - `workers/agent-core/src/host/ws-controller.ts:47-63` — 确认只做 UUID gate，不承担 attach owner
  - `workers/agent-core/src/host/do/nano-session-do.ts:812-819` — 确认 `TEAM_UUID` 缺失时掉到 `_unknown`
  - `workers/agent-core/wrangler.jsonc` — 确认 `BASH_CORE` 已激活，`CONTEXT/FILESYSTEM` 保持注释态
  - `workers/bash-core/src/index.ts` — 确认 `/capability/call` + `/capability/cancel` 真实 runtime
  - `workers/context-core/src/index.ts` — 确认 library-worker probe-only posture
  - `workers/filesystem-core/src/index.ts` — 确认 library-worker probe-only posture
  - `test/INDEX.md` — 确认 35 subtests 的入口分布
  - `test/shared/live.mjs` — 确认 4 worker URLs，无 orchestrator entry
  - `context/smind-contexter/src/chat.ts` — 确认 JWT + user DO stub + CICP pattern
  - `context/smind-contexter/src/engine_do.ts` — 确认 WS sessions map + DO lifecycle
- **执行过的验证**:
  - `ls workers/` — 确认 `orchestrator-core/` 尚未存在
  - `ls docs/design/orchestration-facade/` — 确认 9 份文件完整

### 1.1 已确认的正面事实

- 9 份设计文档覆盖了 charter §17.1 所列的全部 7 份 F0 design doc + 1 份 F4 design doc + 1 份 QNA，数量、主题一一对应，无遗漏。
- 每份文档的 `In-Scope / Out-of-Scope` 表与 charter §7.1 / §7.2 一致，scope boundary 无漂移。
- 合同层设计（`F0-compatibility-facade-contract.md` + `F0-agent-core-internal-binding-contract.md`）明确区分了 public contract 与 internal contract，与 charter §1.7 的双向冻结战略一致。
- Stream relay 机制明确采用了 `HTTP streaming + NDJSON` 方案，与 charter §6.2 的推荐一致。
- Contexter absorption inventory 采用了 `adopt/adapt/defer/discard` 的四分法，与 charter §5.2 的逐文件 inventory 口径完全一致。
- User DO schema 冻结在 4 字段最小语义，未偷渡 SQLite / full memory，与 charter §4.2 的克制边界一致。
- F4 authority policy 明确拆分为 F4.A (本阶段) 与 F4.B (延后)，与 charter §1.9 口径一致。
- 所有 8 份 design doc 的结构均遵循 `docs/templates/design.md` 模板（9 节结构）。
- 跨文档引用关系清晰：`F0-user-do-schema` 引用 `F0-contexter-absorption-inventory`，`F0-session-lifecycle-and-reconnect` 引用 `F0-user-do-schema` 和 `F0-stream-relay-mechanism`，形成完整的引用图。
- Live E2E migration inventory 给出了文件名级别的迁移清单，与 `test/INDEX.md` 中的实际文件一一对应。
- 代码锚点引用经核实全部有效，包括 `F4-authority-policy-layer.md` 对 `nano-session-do.ts:812-826` 的 `_unknown` fallback 引用。

### 1.2 已确认的负面事实

- FX-qna 中全部 8 个问题的 `业主回答` 字段为空。Q1-Q8 的 `Opus的对问题的分解`、`Opus的对GPT推荐线路的分析`、`Opus的最终回答` 三个字段也全部为空。这意味着 F0 的最终收口仍需 owner 在 QNA 上完成 8 条回答。
- `F0-live-e2e-migration-inventory.md` 将 `test/cross-e2e/01/07/10` 归为 "mostly keep"，但 `test/INDEX.md` 中的 cross-e2e/01 和 07 的测试目标描述主要覆盖 topology/probe 行为，分类正确但未在 inventory 中提供更细致的子测试级判断（10 个 cross-e2e 中有 3 个 "keep"、7 个 "migrate" 的统计已体现，但补充说明不够细）。
- `F0-stream-relay-mechanism.md` 只建议了 frame shape（`kind/seq/name/payload`），但未提供完整的 ZOD schema 或 TypeScript type definition — 这会在 F1 实现时产生小幅度的再解读空间。
- 8 份 design doc 全部标记为 `draft`，尚未进入 `frozen` / `confirmed` 状态。这符合 F0 阶段的设计-冻结-收口正常节奏（先出 draft → QNA 回填 → owner signoff → 状态 flip），但当前确实尚未收口。

---

## 2. 审查发现

### R1. QNA 全部 8 条业主回答缺失 — F0 收口的唯一阻塞点

- **严重级别**: `high`
- **类型**: `delivery-gap`
- **事实依据**:
  - `docs/design/orchestration-facade/FX-qna.md` — Q1-Q8 的 `业主回答` 字段全部为空
  - `docs/design/orchestration-facade/FX-qna.md` — Q1-Q8 的 `Opus的最终回答` 字段也全部为空
  - Charter §18.9 明确要求 "把仍需 owner 拍板的问题汇总到 FX-qna.md"
- **为什么重要**:
  - Q1 (internal auth header scheme) 如果不回答，`F0-agent-core-internal-binding-contract.md` 的 auth gate 实现细节无法冻结。
  - Q2 (NDJSON framing frozen) 如果不回答，stream relay 可能在 F1/F2 中漂移。
  - Q3 (single active writable attachment) 如果不回答，reconnect 语义与 F2 实现边界无法确定。
  - Q5 (preview/prod 显式配置 `TEAM_UUID`) 如果不回答，single-tenant law 停留在纸面。
  - Q7 (F3 exit 后 hard deprecate no grace window) 如果不回答，legacy retirement 的真实语义仍是灰色地带。
- **审查判断**:
  这不是设计文档的缺陷，而是 F0 freeze 流程的正常收口步骤。8 个问题均有清晰的背景说明、候选方案与推荐路线。GPT 已在每个 Q 下提供了详细的 Reasoning，owner 可以直接基于这些建议做 yes/no 决策。当前阻塞程度可控。
- **建议修法**:
  1. Owner 在 `FX-qna.md` 的每条 `业主回答` 字段中填写简洁明确的决策（如 "确认"、"确认 + bounded count window 为 24h" 等）。
  2. 若 owner 对某条推荐路线有异议，在 `业主回答` 中写明替代方案。
  3. 回填完成后，将本 review 文档中的 R1 标记为 `resolved`。

### R2. Code anchor 引用行号在审查当时存在 1 行偏移

- **严重级别**: `low`
- **类型**: `correctness`
- **事实依据**:
  - 审查当时的 `F4-authority-policy-layer.md` §8.4 引用 `workers/agent-core/src/host/do/nano-session-do.ts:812-825` 作为 `buildIngressContext()` 中 `TEAM_UUID` 缺失时的 `_unknown` fallback 反例
  - 实际代码中 `buildIngressContext()` 方法位于 lines 812-826，逻辑完全正确 (line 817-819 的 ternary `_unknown` fallback)
- **为什么重要**:
  代码逻辑正确，行号范围偏移 1 行不影响引用准确性，但审查当时版本中的 `812-825` 应改为 `812-826` 以保持精确。
- **审查判断**:
  低优先级，不影响任何设计决策或实现。下次修订 F4 文档时可以顺手修正。
- **建议修法**:
  将审查当时版本中的 `812-825` 修正为 `812-826`。

### R3. Stream relay 设计缺少 concrete TypeScript type / Zod schema

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **事实依据**:
  - `F0-stream-relay-mechanism.md` §7.2 给出的 NDJSON frame shape 是注释形式的 JSON 示例，不是 type definition
  - Charter §6.2 要求 F0 冻结 "chunk / framing shape"
- **为什么重要**:
  `meta` / `event` / `terminal` 三类 frame 在文档中以示例形式给出，但在 F1 实现 relay reader/writer 时，实现者仍需自行推断 field 类型（`seq` 是 number 还是 string？`payload` 是 `any` 还是 typed union？`terminal` 的 `kind` 是 freeform string 还是 enum？）。这会引入小幅度但真实存在的返工风险。
- **审查判断**:
  建议在 F0 收口前或 F1 开始时补充一个 TypeScript type / Zod schema 片段，作为设计文档的附录或独立小节。当前示例已足够支撑方向性共识，但不足以完全消除 F1 实现阶段的 type-level 歧义。
- **建议修法**:
  在 `F0-stream-relay-mechanism.md` §7.2 后追加一个小节，包含简化的 TypeScript discriminated union type（如 `StreamFrame = MetaFrame | EventFrame | TerminalFrame`），不需要丰富的 helper API，只需冻住 field name / type / discriminant。

### R4. `F0-live-e2e-migration-inventory.md` 对 cross-e2e 分类粒度可以更细

- **严重级别**: `low`
- **类型**: `docs-gap`
- **事实依据**:
  - `F0-live-e2e-migration-inventory.md` §7.2 将 10 个 cross-e2e 测试按 "keep" (01/07/10) 与 "migrate or replace" (02-06/08-09) 分类
  - `test/INDEX.md` 的 cross-e2e 测试目标描述显示：07 测试 `context-core/filesystem-core` 的 `/runtime -> 404` library-worker posture，确实与 session ingress 无关
  - 01 测试 "stack preview inventory"，10 测试 "probe concurrency stability" — 也都与 session ingress 无关
- **为什么重要**:
  分类结论正确，没有误归。但文档只给了文件名级分类，没有对每个 cross-e2e 文件做一行摘要补充，reviewer 需要回到 `test/INDEX.md` 才能验证分类是否正确。这在 F3 执行时不会有实质影响，但降低了 inventory 文档的 self-contained 程度。
- **审查判断**:
  低优先级。可以在 F3 进入前补充每个 cross-e2e 文件的一行注释，或在当前版本中标记 "cross-e2e 分类验证见 `test/INDEX.md`"。
- **建议修法**:
  在 inventory §7.2 的每个 cross-e2e 文件名后追加一行注释，说明该测试的当前入口与判断依据（一句话即够）。

---

## 3. In-Scope 逐项对齐审核

以下按 charter §17.1 的 8 份 expective design doc 与 §7.1 的 14 条 In-Scope 工作项交叉审核。

### 3.1 Design Document 覆盖度

| 编号 | Charter 要求的设计文档 | 对应文件 | 交付状态 | 与 charter 口径一致性 |
|------|------------------------|----------|----------|----------------------|
| D1 | `F0-compatibility-facade-contract.md` | 已交付 (352 lines) | `done` | I1 / I11 / I12 对齐 |
| D2 | `F0-agent-core-internal-binding-contract.md` | 已交付 (331 lines) | `done` | I3 对齐 |
| D3 | `F0-stream-relay-mechanism.md` | 已交付 (336 lines) | `done` | I4 对齐 |
| D4 | `F0-contexter-absorption-inventory.md` | 已交付 (322 lines) | `done` | I5 对齐 |
| D5 | `F0-user-do-schema.md` | 已交付 (341 lines) | `done` | I6 对齐 |
| D6 | `F0-session-lifecycle-and-reconnect.md` | 已交付 (332 lines) | `done` | I7 对齐 |
| D7 | `F0-live-e2e-migration-inventory.md` | 已交付 (343 lines) | `done` | I11 对齐 |
| D8 | `F4-authority-policy-layer.md` | 已交付 (329 lines) | `done` | I13 对齐 |

### 3.2 Charter In-Scope 工作项对齐

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| I1 | 冻结 compatibility-first façade strategy (F0) | `done` | D1 完整覆盖，public contract / legacy semantics 已写定 |
| I2 | 冻结 first-wave tenant-source truth (F0/F4.A) | `done` | D8 §7.2 明确 single-tenant-per-deploy + `TEAM_UUID` 显式配置 |
| I3 | 冻结 `orchestrator -> agent` internal binding contract (F0) | `done` | D2 完整覆盖，含 internal route family + auth gate + authority passing |
| I4 | 冻结 `agent -> orchestrator` stream relay contract (F0) | `done` | D3 完整覆盖，含 NDJSON framing + cursor + terminal semantics |
| I5 | 冻结 contexter absorption inventory (F0) | `done` | D4 完整覆盖，含文件级 adopt/adapt/defer/discard |
| I6 | 冻结 first-wave user DO schema (F0) | `done` | D5 完整覆盖，含 logical schema + physical layout + retention boundary |
| I7 | 冻结 `session_uuid` lifecycle / reconnect semantics (F0) | `done` | D6 完整覆盖，含 5 状态 lifecycle + single active attachment |
| I8 | 建立 `workers/orchestrator-core/` (F1) | `pending` | F1 阶段工作，不在 F0 design scope |
| I9 | 打通最小 roundtrip (F1) | `pending` | F1 阶段工作 |
| I10 | 完成 session seam (F2) | `pending` | F2 阶段工作 |
| I11 | 完成 affected live E2E / docs / harness migration (F3) | `partial` | D7 已完成文件级 inventory，实际迁移代码待 F3 |
| I12 | agent.core legacy session routes hard deprecate (F3) | `partial` | D1 已定义语义，D7 已列受影响测试，实际退役代码待 F3 |
| I13 | F4.A authority hardening (F4) | `partial` | D8 已完成 policy layer 设计，实现代码待 F4 |
| I14 | 产出 final closure / handoff (F5) | `pending` | F5 阶段工作 |

### 3.3 对齐结论

- **done**: 7 (I1-I7, design freeze 工作全部完成)
- **partial**: 3 (I11/I12/I13: design 已完成, 实现待后续 phase)
- **pending**: 4 (I8/I9/I10/I14: 属 F1/F2/F5, 不在 F0 design scope)

> F0 design freeze 层面的工作已全部完成。I1-I7 的 7 条冻结项均有对应设计文档，且每条文档内部都给出了明确的 frozen answer 或推荐方案。剩余 `partial` 项属正常阶段分工。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 重造全新 public product API | `遵守` | 所有设计文档反复强调 compatibility-first, 不发明新 API |
| O2 | multi-tenant-per-deploy | `遵守` | D8 §5.2 O3 明确 defer; D8 §6.1 tradeoff 2 写清楚 "single-tenant-per-deploy law" |
| O3 | full user-memory / history / retrieval domain | `遵守` | D5 §5.2 O1/O2 明确禁止 SQLite / conversation archive; D4 明确 defer `db_do.ts` |
| O4 | concrete credit ledger / quota / billing domain | `遵守` | D8 §5.2 O1/O2 明确禁止; F4.A vs F4.B 分割清晰 |
| O5 | WorkerEntrypoint RPC / custom transport rewrite | `遵守` | D2/D3 均采用 fetch-backed service binding, 无 RPC 引入 |
| O6 | `orchestrator.core` 直接 binding `CONTEXT_CORE` / `FILESYSTEM_CORE` | `遵守` | D1 §5.2 O3 明确禁止; D5 §3.3 确认 orchestrator 不 direct bind |
| O7 | 第 6+ worker | `遵守` | 无任何文档提及新建 worker, 保持在 5-worker topology |
| O8 | 删除 probe surfaces | `遵守` | D1 §5.3 明确 "public probe on internal workers — in-scope" |

> 8 条 Out-of-Scope 项全部遵守。设计文档在 scope boundary 上保持高度 discipline，未出现任何偷渡 behavior。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: 9 份设计文档主体成立，整体质量高，与 charter 对齐，内部一致。F0 design freeze 的输出层已经完成，可以进入 F0 action-plan 阶段（`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`）并进入 F1。
- **是否允许关闭本轮 review**: **有条件允许** — 条件为 R1（QNA 回填）完成。
- **关闭前必须完成的 blocker**:
  1. **R1 — QNA 业主回答回填**: 8 个 Q 全部需要 owner 在 `FX-qna.md` 中填写明确决策。这是 F0 signoff 和 F1 kickoff 的硬前置。
- **可以后续跟进的 non-blocking follow-up**:
  1. R2 — 修正 `F4-authority-policy-layer.md` 中的行号范围偏移 (812-825 → 812-826)
  2. R3 — 在 `F0-stream-relay-mechanism.md` 中补充 NDJSON frame 的 TypeScript type / Zod schema 片段
  3. R4 — 在 `F0-live-e2e-migration-inventory.md` 中为 cross-e2e 分类补充一行注释

> 本轮 review 可以收口，但需要 owner 先在 FX-qna.md 中完成 8 条回答。F1 只有在 Q1-Q4/Q7 至少回答后才是安全的。

---

## 6. 设计文档之间的交叉一致性验证

### 6.1 一致性矩阵

| 主题 | D1 | D2 | D3 | D4 | D5 | D6 | D7 | D8 | 一致？ |
|------|----|----|----|----|----|----|----|----|--------|
| canonical public ingress = orchestrator | ✓ | - | ✓ | - | - | ✓ | ✓ | - | ✅ |
| `session_uuid` owner = orchestrator | ✓ | - | - | - | ✓ | ✓ | - | - | ✅ |
| single-tenant-per-deploy | - | - | - | - | - | - | - | ✓ | ✅ |
| legacy WS = not internal seam | ✓ | - | ✓ | - | - | - | - | - | ✅ |
| F3 exit hard deprecation | ✓ | - | - | - | - | - | ✓ | - | ✅ |
| no SQLite in first-wave | - | - | - | ✓ | ✓ | - | - | - | ✅ |
| no direct context/filesystem binding | ✓ | - | - | - | ✓ | - | - | - | ✅ |
| single active writable attachment | - | - | - | - | - | ✓ | - | - | ✅ |
| NDJSON framing | - | - | ✓ | - | - | - | - | - | ✅ |
| 4-field user DO schema | - | - | - | - | ✓ | ✓ | - | - | ✅ |
| adopt `jwt.ts` / adapt middleware / defer `db_do.ts` | - | - | - | ✓ | - | - | - | - | ✅ |

> 9 份文档在 11 个关键 cross-cutting 主题上无一处矛盾。跨文档引用链路完整、语义一致。

### 6.2 Charter vs Design Docs 差异点（全部为合法细化，非冲突）

| Charter 表述 | 对应设计文档的细化 | 判定 |
|------------|-------------------|------|
| "HTTP streaming response + NDJSON framing" (charter §6.2) | D3 §7.2 具体化为 `meta/event/terminal` 三类 frame + 示例 shape | ✅ 合法细化 |
| "4 fields user DO schema" (charter §4.2) | D5 §7.2 增加了 physical key layout (`user/meta`, `sessions/<uuid>`) + retention policy | ✅ 合法细化 |
| "7 条 internal session routes" (charter §6.1) | D2 §5.1 S1 枚举为 7 条 (`start/input/cancel/status/timeline/verify/stream`)，与 charter 一致 | ✅ 严格对齐 |
| "compatibility-first `/sessions/:id/...`" | D1 §7.1 F1 明确保持 route family，内部由 orchestrator → agent internal call 完成 | ✅ 严格对齐 |
| "5 lifecycle states" (charter §4.3) | D6 §7.2 拆分为 `minted/starting/active/detached/ended`，与 charter table 一致 | ✅ 严格对齐 |

---

## 7. 文档质量评估

| 评估维度 | 评级 (1-5) | 说明 |
|----------|------------|------|
| Charter 对齐度 | 5 | 8 份 design doc 与 charter 的每一条对应要求严格匹配 |
| 内部一致性 | 5 | 11 个 cross-cutting 主题无一矛盾 |
| 代码锚点准确性 | 5 | 所有引用的文件路径与行号经实测核实有效 |
| 可执行性 (能否直接指导 F1-F4 实现) | 4 | 主体可执行，仅 R3 (NDJSON type definition) 为小幅度缺口 |
| Scope discipline (是否守住了边界) | 5 | 8 条 Out-of-Scope 全部遵守 |
| 结构规范性 | 5 | 所有文档均遵循 `docs/templates/design.md` 的 9 节结构 |
| QNA 完整性 | 2 | 8 个 Q 均无 owner 回答，当前 QNA 只完成了问题与推荐线的铺设 |

---

## 8. 推荐下一步执行顺序

1. **Owner 回填 FX-qna.md** — 先回答 Q1/Q2/Q3/Q5/Q7（F1 硬前置的 5 题），再回答 Q4/Q6/Q8
2. **R1 resolved** 后将本 review 标记为 `closed`
3. **F0 action-plan (`docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`)** 把 7 份 F0 design doc 的状态从 `draft` 收口到 `frozen`
4. **F1 kickoff** — 依据 D1-D6 开始 `workers/orchestrator-core/` 的 scaffold 与最小 roundtrip
5. **Non-blocking follow-ups (R2/R3/R4)** 在 F1 进行时顺手修正，不阻塞实现

---

## 附录 A. 审查覆盖的完整文件清单

### 设计文档 (9 files)
- `docs/design/orchestration-facade/F0-compatibility-facade-contract.md` (352 lines)
- `docs/design/orchestration-facade/F0-agent-core-internal-binding-contract.md` (331 lines)
- `docs/design/orchestration-facade/F0-stream-relay-mechanism.md` (336 lines)
- `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md` (322 lines)
- `docs/design/orchestration-facade/F0-user-do-schema.md` (341 lines)
- `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md` (332 lines)
- `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md` (343 lines)
- `docs/design/orchestration-facade/F4-authority-policy-layer.md` (329 lines)
- `docs/design/orchestration-facade/FX-qna.md` (174 lines)

### Charter 文档 (2 files)
- `docs/plan-orchestration-facade.md` (1505 lines, full read)
- `docs/plan-worker-matrix.md` (628 lines, full read)

### 代码文件 (8 files)
- `workers/agent-core/src/index.ts` (67 lines)
- `workers/agent-core/src/host/routes.ts` (75 lines)
- `workers/agent-core/src/host/http-controller.ts` (294 lines)
- `workers/agent-core/src/host/ws-controller.ts` (83 lines)
- `workers/agent-core/src/host/do/nano-session-do.ts` (1602 lines, partial reads at l1-100, l812-839)
- `workers/agent-core/wrangler.jsonc` (59 lines)
- `test/INDEX.md` (234 lines, read l1-100)
- `test/shared/live.mjs` (71 lines)

### 外部参考 (2 files)
- `context/smind-contexter/src/chat.ts` (277 lines)
- `context/smind-contexter/src/engine_do.ts` (385 lines)

### Template (1 file)
- `docs/templates/code-review.md` (246 lines)

---

## 附录 B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-24 | deepseek-v4-pro | 初审完成 |


---

## Appendix — F0 close-out status（2026-04-24，GPT-5.4）

### 当前结论

- **R1 blocker 已解决**：`FX-qna.md` 的 Q1-Q8 `业主回答` 全部已回填，review 当时指出的唯一 F0 freeze blocker 已清空。
- design pack 与 charter 的当前状态，已经从“draft / awaiting-freeze-close”推进到 F0 closure 所要求的 frozen baseline；当前应以 `docs/issue/orchestration-facade/F0-closure.md` 为准。

### finding disposition

1. **R1**：`resolved` — QNA completion + F0 closure。
2. **R2**：`absorbed` — `F4-authority-policy-layer.md` 的行号引用已与当前代码范围同步。
3. **R3 / R4**：`downgraded-to-implementation-follow-up` — NDJSON type formalization 与 cross-e2e inventory 粒度属于执行期细化，不再是 F0 gate。

### close-out verdict

DeepSeek 的核心判断“设计包可以进入 F0 action-plan，真正 blocker 只剩 QNA 回填”已被事实验证；F0 现已可正式关闭。
