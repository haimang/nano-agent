# Nano-Agent 行动计划 — HP1 Schema Extension

> 服务业务簇: `hero-to-pro / HP1`
> 计划对象: `把 HP2-HP10 依赖的 durable truth 一次性冻结为 007-013 migration + correction law + consumer map`
> 类型: `migration + docs + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
> - `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql`
> - `workers/orchestrator-core/migrations/004-session-files.sql`
> - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
> - `workers/orchestrator-core/migrations/007-model-metadata-and-aliases.sql`
> - `workers/orchestrator-core/migrations/008-session-model-audit.sql`
> - `workers/orchestrator-core/migrations/009-turn-attempt-and-message-supersede.sql`
> - `workers/orchestrator-core/migrations/010-agentic-loop-todos.sql`
> - `workers/orchestrator-core/migrations/011-session-temp-files-and-provenance.sql`
> - `workers/orchestrator-core/migrations/012-session-confirmations.sql`
> - `workers/orchestrator-core/migrations/013-product-checkpoints.sql`
> - `workers/orchestrator-core/test/**`
> - `docs/architecture/hero-to-pro-schema.md`
> - `docs/charter/plan-hero-to-pro.md`
> - `docs/design/hero-to-pro/HP1-schema-extension.md`
> - `docs/issue/hero-to-pro/HP1-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP0-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.2 HP1
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP2-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP1-schema-extension.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q4-Q6、Q13、Q16、Q18（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP1 是 hero-to-pro 的 DDL Freeze Gate。仓库当前经过 RHX1 / RHX2 后，`workers/orchestrator-core/migrations/` 现实停在 `001-006`，而 HP2-HP7 即将消费的 durable truth 仍未落入 D1：model metadata、session/turn audit、turn attempt uniqueness、todo items、temp file provenance、confirmation rows、checkpoint/file snapshot/restore/cleanup lineage 都还只是设计冻结，不是 schema 现实。

同时，最新 frozen QNA 又补了几条不能被忽略的派生规则：migration baseline 固定为 `007-013`，`014+` 只能作为 `HP1 schema correction`；checkpoint lineage 必须在 HP1 一次性落表；`ended_reason` 列必须进入 `008` 而不是新增状态；confirmation 必须冻结为 7 kinds，失败回滚不能引入 `failed` status，也不预留 `tool_cancel`。这些规则如果不在 HP1 action-plan 中显式落实，HP2-HP10 会在实现中重新发明 schema。

- **服务业务簇**：`hero-to-pro / HP1`
- **计划对象**：`hero-to-pro 的一次性 schema freeze 与 correction law 落地`
- **本次计划解决的问题**：
  - HP2-HP7 依赖的 durable truth 仍未进入 D1，后续 phase 若直接写逻辑会重新制造 schema drift。
  - `007-013` freeze、`014+` correction、checkpoint lineage 一次落表、`ended_reason`、7-kind confirmations 等冻结规则尚未全部显式转成执行边界。
  - 当前还缺少可审计的 consumer map、local apply 证据和 HP1 closure，无法证明 DDL Freeze Gate 真的成立。
- **本次计划的直接产出**：
  - `007-013` 七个 migration、相关 seed/backfill 与 schema 验证。
  - `plan-hero-to-pro.md` 与 `HP1-schema-extension.md` 对 frozen QNA 派生规则的显式对齐。
  - `docs/architecture/hero-to-pro-schema.md`、HP1 closure、consumer map、schema correction registry / 模板。
- **本计划不重新讨论的设计结论**：
  - migration baseline 固定为 `007-013`；`014+` 只允许 `HP1 schema correction` 占用（来源：`docs/design/hero-to-pro/HPX-qna.md` Q4/Q6）。
  - checkpoint / file snapshot / restore job / cleanup lineage 必须在 HP1 一次性落表（来源：`docs/design/hero-to-pro/HPX-qna.md` Q5）。
  - session close **不新增状态**，而使用 `ended_reason` 列表达终止原因；该列进入 `008`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q13）。
  - confirmation 冻结为 7 kinds；失败回滚使用现有失效终态（本轮冻结为 `superseded`），不新增 `failed`，不预留 `tool_cancel`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q16/Q18）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP1 采用**先做 freeze 对齐与 consumer map → 再分主题落 007-013 migration → 最后做 local apply / schema test / closure**的顺序。先把 charter / design / QNA 的派生规则统一成单一执行口径，再写 SQL，可以避免“migration 已写完才发现文档 freeze 没显式登记”的返工；而把 checkpoint lineage 放在独立 Phase，可确保 reviewer 逐项映射 HP4 / HP6 / HP7 consumer，不把 013 误判成“可以以后再补”。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Freeze Alignment + Consumer Map | S | 对齐 charter/design 与 frozen QNA，并建立 HP2/HP4/HP5/HP6/HP7 消费映射 | `-` |
| Phase 2 | 007-009 Core Schema Freeze | M | 落 model metadata、session/turn audit、turn attempt rebuild | Phase 1 |
| Phase 3 | 010-012 Workspace + Confirmation Truth | M | 落 todo、temp file/provenance、confirmation durable truth | Phase 2 |
| Phase 4 | 013 Checkpoint / Restore / Cleanup Lineage | M | 一次性落 checkpoint 三表 + cleanup job 并完成 consumer sanity map | Phase 2-3 |
| Phase 5 | Local Apply + Closure + Correction Law | S | 形成 HP1 closure、schema test、correction registry 与 freeze 证据 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Freeze Alignment + Consumer Map**
   - **核心目标**：让执行所依据的 charter / design / QNA 三层口径完全一致。
   - **为什么先做**：如果 `ended_reason`、correction registry、7-kind confirmation 这些规则仍只存在于 QNA，后续 reviewer 无法判断 SQL 是否忠实执行了 freeze。
2. **Phase 2 — 007-009 Core Schema Freeze**
   - **核心目标**：先冻结最上游的 model / chat / turn audit truth。
   - **为什么放在这里**：HP2/HP4/HP5 的逻辑层最先依赖这些列与唯一性约束。
3. **Phase 3 — 010-012 Workspace + Confirmation Truth**
   - **核心目标**：把 workspace durable truth 与 confirmation control plane 放入 D1。
   - **为什么放在这里**：HP5/HP6 的执行路径都依赖这组三表，但它们又不该挤进 013 的 checkpoint lineage 评审噪音里。
4. **Phase 4 — 013 Checkpoint / Restore / Cleanup Lineage**
   - **核心目标**：把 HP4/HP6/HP7 的 durable truth 一次性落表。
   - **为什么放在这里**：013 是整组 lineage 的硬依赖，必须在前面几张基础表稳定后做整体审查。
5. **Phase 5 — Local Apply + Closure + Correction Law**
   - **核心目标**：让 HP1 不是“SQL 文件存在”，而是“freeze 已被证据化”。
   - **为什么最后**：local apply、schema test 与 closure 必须在完整 ledger 形成后才能成立。

### 1.4 执行策略说明

- **执行顺序原则**：先 freeze 对齐、再写 SQL、再跑 apply/test、最后写 closure。
- **风险控制原则**：后续 phase 默认不得私加 migration；HP1 必须先把 correction law 模板写清。
- **测试推进原则**：每个 migration 主题都要有 local apply + schema assertion；013 额外要求 consumer map sanity review。
- **文档同步原则**：`docs/charter/plan-hero-to-pro.md`、`docs/design/hero-to-pro/HP1-schema-extension.md`、`docs/issue/hero-to-pro/HP1-closure.md` 三处同步维护，不允许 QNA 单独承载关键派生规则。
- **回滚 / 降级原则**：若某主题 schema 在 HP1 内仍无法冻结，不能偷加第八个 migration；必须按 correction law 回退到文档修订与 owner/architect 双签流程。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP1 schema extension
├── Phase 1: Freeze Alignment + Consumer Map
│   ├── docs/charter/plan-hero-to-pro.md
│   └── docs/design/hero-to-pro/HP1-schema-extension.md
├── Phase 2: 007-009 Core Schema Freeze
│   ├── 007-model-metadata-and-aliases.sql
│   ├── 008-session-model-audit.sql
│   └── 009-turn-attempt-and-message-supersede.sql
├── Phase 3: 010-012 Workspace + Confirmation Truth
│   ├── 010-agentic-loop-todos.sql
│   ├── 011-session-temp-files-and-provenance.sql
│   └── 012-session-confirmations.sql
├── Phase 4: 013 Checkpoint / Restore / Cleanup Lineage
│   ├── 013-product-checkpoints.sql
│   └── HP4 / HP6 / HP7 consumer sanity map
└── Phase 5: Local Apply + Closure + Correction Law
    ├── workers/orchestrator-core/test/**
    ├── docs/issue/hero-to-pro/HP1-closure.md
    └── schema correction registry
```

### 1.6 已核对的当前代码锚点

1. **当前 session/chat durable truth baseline**
   - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-169`
   - 这里已经有 `nano_conversations`、`nano_conversation_sessions`、`nano_conversation_turns`、`nano_conversation_messages`、`nano_conversation_context_snapshots`、`nano_session_activity_logs`，HP1 必须在此基础上增量扩展，而不是重写旧表。
2. **当前 model baseline**
   - `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:56-129`
   - `nano_models` 目前只有基础展示/能力字段；HP1 的 `007` 要在这张表上扩 10 个 runtime-oriented metadata 列，并补 `nano_model_aliases` 与 alias seed。
3. **当前 artifact baseline**
   - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
   - 现在只有 `nano_session_files`，说明 temp file / checkpoint snapshot / provenance 绝不能继续硬塞进旧表。
4. **当前 queryable-truth 风格 precedent**
   - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql:22-103`
   - RHX2 已经证明本仓库偏好“主真相 + 索引 + 明确 FK / enum 约束”，因此 HP1 新表也应保持 queryable truth，而不是退回 JSON blob 兜底。
5. **charter 已冻结的 HP1 交付物**
   - `docs/charter/plan-hero-to-pro.md:430-487`
   - 这里已经明确写出 `007-013` 的职责、`docs/architecture/hero-to-pro-schema.md`、HP1 closure，以及 local apply / schema doc review / seed 真值回填等收口标准，action-plan 必须一一对齐。
6. **外部 precedent 已核对并用于约束 HP1 的 durable truth 形状**
   - `context/codex/codex-rs/protocol/src/openai_models.rs:248-299`, `context/gemini-cli/packages/core/src/services/chatRecordingTypes.ts:92-140`, `context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-470,510-532,799-818`, `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:15-24,84-157`, `context/gemini-cli/packages/cli/src/ui/commands/restoreCommand.ts:43-123`
   - precedent 共同说明 model metadata、chat durable record、checkpoint/restore 都必须是结构化 truth；HP1 借鉴“字段必须可查询、可恢复、可消费”的原则，不照抄外部 JSONL 或 UI 协议。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 对齐 charter / design / QNA：显式补入 `007-013` freeze、`schema correction registry`、`ended_reason`、7-kind confirmation 等派生规则。
- **[S2]** 新增 `007-013` 七个 migration，覆盖 model metadata、chat durable truth、turn attempt、todo、temp file/provenance、confirmation、checkpoint/restore/cleanup lineage。
- **[S3]** local apply、schema assertion、consumer map sanity review、HP1 closure。
- **[S4]** correction law 模板：owner + architect 双签、`014+` 编号规则、`correction-of` 标记、closure/charter 登记要求。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** remote/prod D1 apply 与 prod schema baseline（留给 HP9 owner-action）。
- **[O2]** HP2-HP7 的业务逻辑、HTTP/WS surface、runtime 状态机与客户端实现。
- **[O3]** 在 `014+` 预留普通 migration 空间，或用第八张 migration 继续扩 HP1 主题。
- **[O4]** confirmation kind 扩张（尤其 `tool_cancel`）或新增 session close state。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| `ended_reason` 列进入 `008` | `in-scope` | Q13 已冻结为 HP1 durable truth，不能拖到 HP4 collateral | 仅当 owner/architect 正式触发 correction |
| `schema correction registry` 写入 charter / design / closure | `in-scope` | Q6 要求模板在 HP1 closure 前就位 | HP1 未执行前不得重评为 out-of-scope |
| `tool_cancel` confirmation kind | `out-of-scope` | Q18 明确第一版不预留 `tool_cancel` | 未来若业务需要，回到 HPX-qna |
| remote/prod apply | `out-of-scope` | HP1 只做 local apply 与 freeze；prod baseline 留 HP9 | HP9 owner-action |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | freeze doc alignment | `update` | `docs/charter/plan-hero-to-pro.md`, `docs/design/hero-to-pro/HP1-schema-extension.md` | 把 Q4/Q5/Q6/Q13/Q16/Q18 派生规则显式写入可执行文档 | `medium` |
| P1-02 | Phase 1 | consumer map scaffolding | `update` | HP1 design / closure supporting sections | 建立 HP2/HP4/HP5/HP6/HP7 对 007-013 的字段消费映射 | `medium` |
| P2-01 | Phase 2 | `007-model-metadata-and-aliases.sql` | `migrate` | `workers/orchestrator-core/migrations/007-model-metadata-and-aliases.sql` | 冻结 `base_instructions_suffix` 等 10 个 model metadata 列与 alias truth | `medium` |
| P2-02 | Phase 2 | `008-session-model-audit.sql` | `migrate` | `workers/orchestrator-core/migrations/008-session-model-audit.sql` | 冻结 session/turn durable audit truth，并补 `ended_reason` | `high` |
| P2-03 | Phase 2 | `009-turn-attempt-and-message-supersede.sql` | `migrate` | `workers/orchestrator-core/migrations/009-turn-attempt-and-message-supersede.sql` | 通过 rebuild 固化 turn attempt 唯一性、message supersede 与 conversation tombstone | `high` |
| P3-01 | Phase 3 | `010-agentic-loop-todos.sql` | `migrate` | `workers/orchestrator-core/migrations/010-agentic-loop-todos.sql` | 落 product-level todo durable truth | `medium` |
| P3-02 | Phase 3 | `011-session-temp-files-and-provenance.sql` | `migrate` | `workers/orchestrator-core/migrations/011-session-temp-files-and-provenance.sql` | 落 temp file truth 与 `nano_session_files` provenance 列 | `medium` |
| P3-03 | Phase 3 | `012-session-confirmations.sql` | `migrate` | `workers/orchestrator-core/migrations/012-session-confirmations.sql` | 冻结 confirmation row schema、7 kind 与回滚终态 law | `high` |
| P4-01 | Phase 4 | `013-product-checkpoints.sql` | `migrate` | `workers/orchestrator-core/migrations/013-product-checkpoints.sql` | 一次落 checkpoint/file snapshot/restore job/cleanup job lineage | `high` |
| P5-01 | Phase 5 | local apply + schema assertions | `add` | `workers/orchestrator-core/test/**` | 证明 007-013 可在当前 baseline 上稳定 apply | `medium` |
| P5-02 | Phase 5 | schema doc + HP1 closure + correction registry | `update` | `docs/architecture/hero-to-pro-schema.md`, `docs/issue/hero-to-pro/HP1-closure.md`, charter/design docs | 让 DDL Freeze Gate 变成可审计事实 | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Freeze Alignment + Consumer Map

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | freeze doc alignment | 把 Q4/Q5/Q6/Q13/Q16/Q18 的派生规则显式补入 charter / HP1 design：`007-013` freeze、`014+` correction-only、`ended_reason`、7-kind confirmation、`superseded` rollback 终态、无 `tool_cancel` | `docs/charter/plan-hero-to-pro.md`, `docs/design/hero-to-pro/HP1-schema-extension.md` | 执行边界不再只存在于 QNA | doc review | 文档能独立解释 HP1 的 schema law，而不依赖读者反查 QNA |
| P1-02 | consumer map scaffolding | 逐项映射 HP2/HP4/HP5/HP6/HP7 对 007-013 的表/列/索引消费关系，尤其是 013 | HP1 design / closure supporting sections | reviewer 能看到每张表为何存在 | design-to-consumer review | consumer map 覆盖 HP2/HP4/HP5/HP6/HP7，不再留下“看不到消费者”的表 |

### 4.2 Phase 2 — 007-009 Core Schema Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | `007-model-metadata-and-aliases.sql` | 在 `003` 的 `nano_models` baseline 上扩 10 个 runtime-oriented metadata 列（含 `base_instructions_suffix`、`fallback_model_id`、`supported_reasoning_levels`、`input_modalities` 等），新增 `nano_model_aliases`，并回填 active model seed + `@alias/fast|balanced|reasoning|vision` 4 条 alias seed | `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql`, `workers/orchestrator-core/migrations/007-model-metadata-and-aliases.sql` | HP0 的 `modelId seam` 到 HP1 可完成真接线，HP2/HP3 可直接读取 richer model truth | local apply + schema assert | 新列存在且 seed 可读；alias 表与 4 条 alias seed 存在 |
| P2-02 | `008-session-model-audit.sql` | 为 `nano_conversation_sessions` / `nano_conversation_turns` 增补 session default、turn requested/effective/fallback audit，并按 Q13 把 `ended_reason` 放入本 migration；终止原因用列表达，不新增状态维度 | `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`, `workers/orchestrator-core/migrations/008-session-model-audit.sql` | HP2/HP4/HP7 能复用同一套 session truth | local apply + schema assert | `ended_reason` 与 model audit 列存在，enum/约束与 Q13 一致 |
| P2-03 | `009-turn-attempt-and-message-supersede.sql` | 在 `002` baseline 上把 `turn_index` 唯一约束重建为 `(session_uuid, turn_index, turn_attempt)`，并为 message 增 supersede marker、为 conversation 增 `deleted_at` tombstone（仅此一列，不再发明新 tombstone owner 字段） | `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`, `workers/orchestrator-core/migrations/009-turn-attempt-and-message-supersede.sql` | 后续重试/fallback/delete 不再依赖脆弱旧约束 | local apply + targeted test | rebuild 可重复 apply 于 fresh baseline，唯一性生效，`deleted_at` 存在 |

### 4.3 Phase 3 — 010-012 Workspace + Confirmation Truth

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | `010-agentic-loop-todos.sql` | 新建 `nano_session_todos`，字段至少覆盖 `todo_uuid/session_uuid/conversation_uuid/team_uuid/parent_todo_uuid/content/status/created_at/updated_at/completed_at`，并补 `idx_todos_session(session_uuid, status)` 等索引 | `workers/orchestrator-core/migrations/010-agentic-loop-todos.sql` | HP6 之前就有稳定 todo baseline | local apply + schema assert | 表、索引、FK 符合 HP1 design 与 charter |
| P3-02 | `011-session-temp-files-and-provenance.sql` | 新建 `nano_session_temp_files`（含 `expires_at` / `cleanup_status` / `UNIQUE(session_uuid, virtual_path)`），并为现有 `nano_session_files` 增 `provenance_kind/source_workspace_path/source_session_uuid` | `workers/orchestrator-core/migrations/004-session-files.sql`, `workers/orchestrator-core/migrations/011-session-temp-files-and-provenance.sql` | HP6 workspace 生命周期有稳定 durable truth | local apply + schema assert | temp file truth 与 artifact provenance truth 已分层，retention 字段齐全 |
| P3-03 | `012-session-confirmations.sql` | 建 confirmation row schema，冻结 7 kinds、`pending|allowed|denied|modified|timeout|superseded` 六个状态，以及双写失败回滚终态 | `workers/orchestrator-core/migrations/012-session-confirmations.sql` | HP5 control plane 可在不再改 schema 的前提下实现 | local apply + schema assert | kind 集合与 Q18 一致；无 `failed` / `tool_cancel`；回滚终态支持 `superseded` |

### 4.4 Phase 4 — 013 Checkpoint / Restore / Cleanup Lineage

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | `013-product-checkpoints.sql` | 一次建立 `nano_session_checkpoints`、`nano_checkpoint_file_snapshots`、`nano_checkpoint_restore_jobs`、`nano_workspace_cleanup_jobs`，并把 HP4/HP6/HP7 的字段消费关系逐项映射进 review；第一版 compact job 继续复用 `compact_boundary` checkpoint handle，不新增 `nano_compact_jobs`；consumer map 中同步锁定 `nano_workspace_cleanup_jobs.scope` 分工：`session_end` / `explicit` 归 HP6，`checkpoint_ttl` 归 HP7 | `workers/orchestrator-core/migrations/013-product-checkpoints.sql`, consumer map | HP4/HP6/HP7 不再需要 collateral migration | local apply + consumer sanity review | 013 已覆盖 checkpoint 三表 + cleanup；consumer map 对应关系完整；未引入额外 compact job 表 |

### 4.5 Phase 5 — Local Apply + Closure + Correction Law

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | local apply + schema assertions | 对 fresh baseline 运行 007-013 local apply，补 schema assert / index / enum / consumer sanity tests | `workers/orchestrator-core/test/**`, migration toolchain | DDL Freeze Gate 从“文件存在”升级为“apply + assert 通过” | test + local apply | 007-013 local apply 通过，关键列/索引/约束有断言 |
| P5-02 | schema doc + HP1 closure + correction registry | 回填 `docs/architecture/hero-to-pro-schema.md` 与 HP1 closure，登记 ledger、字段说明、phase consumer map、schema correction law、`nano_workspace_cleanup_jobs.scope` 责任分配，以及未触发的 014+ 状态；closure 同时显式登记 F1-F17 chronic status | `docs/architecture/hero-to-pro-schema.md`, `docs/issue/hero-to-pro/HP1-closure.md`, charter/design docs | HP2-HP10 可以无歧义消费 HP1 freeze | doc review | schema doc 与 closure 明确：freeze 生效、014+ 未触发、若未来触发 correction 应如何走流程 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Freeze Alignment + Consumer Map

- **Phase 目标**：先把执行口径统一成单一真相。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 新增文件**：
  - 无硬性新增；以 charter / design / closure 对齐为主
- **本 Phase 修改文件**：
  - `docs/charter/plan-hero-to-pro.md`
  - `docs/design/hero-to-pro/HP1-schema-extension.md`
  - `docs/issue/hero-to-pro/HP1-closure.md`
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-169`
  - `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:56-129`
  - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
  - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql:22-103`
  - `docs/charter/plan-hero-to-pro.md:430-487`
- **具体功能预期**：
  1. 读者不查 QNA 也能知道 HP1 的 freeze law。
  2. reviewer 可以直接看到 HP2/HP4/HP5/HP6/HP7 为什么消费 007-013。
- **具体测试安排**：
  - **单测**：无业务逻辑单测。
  - **集成测试**：无。
  - **回归测试**：文档对照审查。
  - **手动验证**：核对 Q4/Q5/Q6/Q13/Q16/Q18 是否都已有显式落点。
- **收口标准**：
  - `schema correction registry` 与 `correction-of` 规则已写明。
  - `ended_reason`、7-kind、`superseded` 等派生规则不再只存在于 QNA。
- **本 Phase 风险提醒**：
  - 若文档仍不对齐，后续 SQL 即使正确，也会被误审或被下游 phase 误读。

### 5.2 Phase 2 — 007-009 Core Schema Freeze

- **Phase 目标**：优先冻结最上游的 model / session / turn truth。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/migrations/007-model-metadata-and-aliases.sql`
  - `workers/orchestrator-core/migrations/008-session-model-audit.sql`
  - `workers/orchestrator-core/migrations/009-turn-attempt-and-message-supersede.sql`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/test/**`
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-169`
  - `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:56-129`
- **具体功能预期**：
  1. `007` 在现有 `nano_models` 上扩 10 个 metadata 列，并补 `nano_model_aliases` + 4 alias seed，而不是再造第二套 model truth。
  2. `008` 把 session default、turn requested/effective/fallback audit 与 `ended_reason` 一次写入同一层 session truth。
  3. `009` 完成 UNIQUE rebuild、message supersede 与 conversation `deleted_at` tombstone。
- **具体测试安排**：
  - **单测**：migration/schema assertion tests。
  - **集成测试**：local D1 apply from current baseline。
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：检查 007/008/009 的 column/index/constraint 是否与 design/QNA 一致。
- **收口标准**：
  - 007-009 在 fresh baseline 上可稳定 apply。
  - `base_instructions_suffix`、`ended_reason`、`deleted_at`、`turn_attempt` 等关键列已存在且被断言。
- **本 Phase 风险提醒**：
  - `009` rebuild 是本阶段最容易伤到旧约束的部分，必须配套 schema test。

### 5.3 Phase 3 — 010-012 Workspace + Confirmation Truth

- **Phase 目标**：冻结 workspace 与 confirmation durable truth。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/migrations/010-agentic-loop-todos.sql`
  - `workers/orchestrator-core/migrations/011-session-temp-files-and-provenance.sql`
  - `workers/orchestrator-core/migrations/012-session-confirmations.sql`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/test/**`
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
- **具体功能预期**：
  1. `010` 的 todo truth 直接覆盖 HP6 需要的会话级 todo durable state。
  2. `011` 明确把 temp file truth 与 artifact truth 分表，并给 `nano_session_files` 增 provenance 列。
  3. `012` 从第一天就锁住 7-kind / 6-status confirmation 边界。
- **具体测试安排**：
  - **单测**：schema assertion tests。
  - **集成测试**：local apply + confirmation enum/constraint checks。
  - **回归测试**：orchestrator-core 全套测试。
  - **手动验证**：逐项核对 Q16/Q18 对 kind/status/rollback 的要求。
- **收口标准**：
  - 010-012 local apply 通过。
  - 012 不引入 `failed`/`tool_cancel`，并能表达 `superseded` 回滚终态。
- **本 Phase 风险提醒**：
  - confirmation schema 若留 escape hatch，下游最容易用“临时 kind”把 control plane 做散。

### 5.4 Phase 4 — 013 Checkpoint / Restore / Cleanup Lineage

- **Phase 目标**：一口气完成 checkpoint lineage 的 durable freeze。
- **本 Phase 对应编号**：
  - `P4-01`
- **本 Phase 新增文件**：
  - `workers/orchestrator-core/migrations/013-product-checkpoints.sql`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/test/**`
  - HP1 consumer map supporting sections
- **具体功能预期**：
  1. HP4/HP6/HP7 所需的 checkpoint / snapshot / restore / cleanup truth 全部在 013 内可映射。
  2. reviewer 能看见 013 不是“提前设计过度”，而是后续三 phase 的硬依赖。
  3. 第一版 compact job 继续复用 `checkpoint_kind = compact_boundary` handle，不在 HP1 引入 `nano_compact_jobs`。
- **具体测试安排**：
  - **单测**：schema assertion + index/FK checks。
  - **集成测试**：local apply + consumer sanity review。
  - **回归测试**：orchestrator-core 全套测试。
  - **手动验证**：对照 HP4/HP6/HP7 design 逐项核字段消费关系。
- **收口标准**：
  - checkpoint 三表 + cleanup job 已全部落地。
  - consumer map 明确显示 013 与 HP4/HP6/HP7 的一一对应关系。
- **本 Phase 风险提醒**：
  - 若 013 只看 HP4 不看 HP6/HP7，后面几乎必然重开 collateral migration 争议。

### 5.5 Phase 5 — Local Apply + Closure + Correction Law

- **Phase 目标**：把 HP1 从“schema 设计稿”升级成“已证据化的 freeze gate”。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - 无强制新增；以测试与 closure 回填为主
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/test/**`
  - `docs/architecture/hero-to-pro-schema.md`
  - `docs/issue/hero-to-pro/HP1-closure.md`
  - `docs/charter/plan-hero-to-pro.md`
- **具体功能预期**：
  1. `007-013` 不是纸面 ledger，而是 local apply + schema assert 已通过的基线。
  2. `docs/architecture/hero-to-pro-schema.md` 明确说明每张新表/新列的业务用途与 phase consumer 关系。
  3. 未来若真触发 schema blocker，团队有唯一合法路径，而不是私加 migration。
- **具体测试安排**：
  - **单测**：schema assert / migration tests。
  - **集成测试**：local D1 apply from current baseline。
  - **回归测试**：`pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：审查 closure 是否显式写明“014+ 未触发 / 若触发如何处理”。
- **收口标准**：
  - HP1 closure 明确宣布 DDL Freeze Gate 生效。
  - correction law 模板和 registry 已就位，且未被普通执行路径绕过。
- **本 Phase 风险提醒**：
  - 如果 closure 只写“migrations added”，下游仍会把 HP1 当成建议性 freeze，而不是法律。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q4 — migration baseline 固定为 `007-013`，`014+` 只留 correction | `docs/design/hero-to-pro/HPX-qna.md` | 决定全部 SQL ledger 与编号策略 | 若执行期发现 blocker，不得私加第八张 migration，必须触发 correction law |
| Q5 — checkpoint lineage 必须一次落表 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 013 的 scope 与 consumer map 必须覆盖 HP4/HP6/HP7 | 若 013 无法覆盖，HP1 不得 closure |
| Q6 — 后续 schema blocker 只能走 correction | `docs/design/hero-to-pro/HPX-qna.md` | 决定 charter/design/closure 必须有 registry + `correction-of` 模板 | 若模板未就位，HP1 视为 incomplete |
| Q13 — `ended_reason` 进入 `008`，不新增 close state | `docs/design/hero-to-pro/HPX-qna.md` | 决定 session truth 的表达方式与 HP4 的终态读取方式 | 若代码/文档想新增 state，必须退回 design/QNA |
| Q16/Q18 — confirmation status/kind freeze | `docs/design/hero-to-pro/HPX-qna.md` | 决定 `012` 不能出现 `failed` / `tool_cancel`，回滚终态使用现有 schema 能表达的 `superseded` | 若后续实现需要新增 kind/status，必须回到 HPX-qna + charter 修订 |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| 文档 freeze 漂移 | QNA 已冻结，但 charter / design 尚未全部显式吸收派生规则 | `high` | 把文档对齐作为 Phase 1 硬前置，不允许“先写 SQL 再补文档” |
| `009` rebuild 风险 | turn attempt rebuild 可能引发旧唯一性/索引行为变化 | `high` | 独立 migration + local apply + schema assertion，不与其它主题混写 |
| 013 consumer 漏映射 | 若 reviewer 看不到 HP4/HP6/HP7 消费面，会误判 013 过度设计 | `high` | Phase 1/4 强制建立 consumer map |
| confirmation enum 漂移 | 实现期最容易再想加临时 kind 或 `failed` 状态 | `medium` | 在 012 和 closure 中把 Q16/Q18 约束写死，并通过 schema assert 固化 |

### 7.2 约束与前提

- **技术前提**：以当前 `001-006` baseline 为起点新增 `007-013`；HP1 不做 remote/prod apply。
- **运行时前提**：HP1 只冻结 schema truth，不提前实现 HP2-HP7 业务逻辑与 client flow。
- **组织协作前提**：若未来触发 schema correction，必须 owner + architect 双签；普通执行者无权私开 `014+`。
- **上线 / 合并前提**：`007-013` local apply 通过、orchestrator-core 测试通过、HP1 closure 与 correction registry 已回填。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP1-schema-extension.md`
- 需要同步更新的说明文档 / README：
  - `docs/charter/plan-hero-to-pro.md`
  - `docs/issue/hero-to-pro/HP1-closure.md`
- 需要同步更新的测试说明：
  - `workers/orchestrator-core/test/README.md`（如新增 migration/schema test 入口）

### 7.4 完成后的预期状态

1. `007-013` 将成为 hero-to-pro 后续所有 phase 共用的 DDL baseline，`014+` 默认保持空闲。
2. HP2-HP7 的业务逻辑可以建立在稳定表结构上，而不是边写逻辑边改 schema。
3. `ended_reason`、7-kind confirmation、checkpoint lineage、cleanup lineage 都会成为第一类 durable truth，而非隐含约定。
4. 若未来真的发现 schema blocker，团队拥有唯一可审计的 correction 流程，不再靠“临时多加一个 migration”解决。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `workers/orchestrator-core/migrations/` 下新增 `007-013` 七个文件，且未出现未经登记的 `014+`。
  - 检查 charter / HP1 design / HP1 closure 三处均已显式出现 correction law、`ended_reason`、7-kind confirmation 等关键规则。
- **单元测试**：
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
- **集成测试**：
  - local D1 apply from current baseline + schema assertion tests
- **端到端 / 手动验证**：
  - consumer map review：逐项核对 HP2/HP4/HP5/HP6/HP7 对 007-013 的消费关系
- **回归测试**：
  - 迁移相关测试、索引/约束断言、confirmation/checkpoint sanity checks
- **文档校验**：
  - `docs/architecture/hero-to-pro-schema.md` 与 `docs/issue/hero-to-pro/HP1-closure.md` 必须同时写明 DDL Freeze Gate 生效与 correction law 未触发状态
  - consumer map / HP1 closure 必须显式写出 `nano_workspace_cleanup_jobs.scope` 分工与 F1-F17 chronic status

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `007-013` 七个 migration 已存在并能在当前 baseline 上 local apply。
2. charter / design / closure 已显式对齐 Q4/Q5/Q6/Q13/Q16/Q18 的冻结规则。
3. 关键表/列/索引/约束存在性可被 schema test 断言，包括 `base_instructions_suffix`、`ended_reason`、7-kind confirmations、checkpoint lineage。
4. HP1 closure 已明确宣布 DDL Freeze Gate 生效，并写清 future correction 的唯一合法路径。
5. HP1 closure 已显式声明 F1-F17 的 phase 状态，并把 cleanup scope 分工作为后续 HP6/HP7 的单一文档基线。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | 007-013 migration 已完整覆盖 HP2-HP7 所需 durable truth |
| 测试 | local apply、schema assertion、orchestrator-core 测试矩阵通过 |
| 文档 | charter / HP1 design / HP1 closure 三处已同步 freeze law 与 correction registry |
| 风险收敛 | 后续 phase 不再能以“临时加 migration”绕过 HP1 freeze |
| 可交付性 | HP2-action-plan 可以直接基于 HP1 ledger 继续推进，无需再猜 schema 真相 |
