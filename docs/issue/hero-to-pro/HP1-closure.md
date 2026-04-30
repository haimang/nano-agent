# HP1 Schema Extension — Closure

> 服务业务簇: `hero-to-pro / HP1`
> 上游 action-plan: `docs/action-plan/hero-to-pro/HP1-action-plan.md`
> 上游 design: `docs/design/hero-to-pro/HP1-schema-extension.md`
> 冻结决策来源: `docs/design/hero-to-pro/HPX-qna.md` Q4 / Q5 / Q6 / Q13 / Q16 / Q18
> 闭环日期: `2026-04-30`
> 文档状态: `frozen`

---

## 0. 总体 Verdict

| 维度 | 结论 |
|------|------|
| DDL Freeze Gate | `effective`(`007-013` 七个 migration 全部落地;后续 phase 默认禁止新增 migration) |
| `014+` 状态 | `unused`(未触发 schema correction) |
| Q4 — `007-013` 编号 | `obeyed`(七张文件分主题,与 charter §7.2 §466-474 一一对应) |
| Q5 — checkpoint lineage 一次落表 | `obeyed`(013 含 `nano_session_checkpoints` / `nano_checkpoint_file_snapshots` / `nano_checkpoint_restore_jobs` / `nano_workspace_cleanup_jobs` 四张表) |
| Q6 — schema correction law | `template-frozen`(本 closure §3 已写明 `correction-of:` 模板与 owner+architect 双签流程) |
| Q13 — `ended_reason` 列 | `landed-in-008`(`nano_conversation_sessions.ended_reason` 由 008 引入) |
| Q16/Q18 — confirmation 7 kinds / 6 statuses | `frozen-in-012`(无 `failed`、无 `tool_cancel`;rollback 终态使用 `superseded`) |
| 测试矩阵 | `green`(orchestrator-core typecheck + build + test 全绿;新增 schema-assertion 测试用 `node:sqlite` 顺序 apply 001→013 后逐项断言) |

---

## 1. Resolved 项(本次 HP1 已落地、可终结)

| ID | 描述 | 证据 |
|----|------|------|
| `R1` | `007-model-metadata-and-aliases.sql`:`nano_models` 扩 10 列(`max_output_tokens`、`effective_context_pct`、`auto_compact_token_limit`、`supported_reasoning_levels`、`input_modalities`、`provider_key`、`fallback_model_id`、`base_instructions_suffix`、`description`、`sort_priority`)+ `nano_model_aliases` + 4 alias seed(`@alias/fast \| balanced \| reasoning \| vision`) | `workers/orchestrator-core/migrations/007-model-metadata-and-aliases.sql` |
| `R2` | `008-session-model-audit.sql`:`nano_conversation_sessions` 加 `default_model_id` / `default_reasoning_effort` / `ended_reason`;`nano_conversation_turns` 加 `requested_model_id` / `requested_reasoning_effort` / `effective_model_id` / `effective_reasoning_effort` / `fallback_used` | `workers/orchestrator-core/migrations/008-session-model-audit.sql` |
| `R3` | `009-turn-attempt-and-message-supersede.sql`:`nano_conversation_turns` 表 rebuild,`turn_attempt INTEGER NOT NULL DEFAULT 1` + `UNIQUE(session_uuid, turn_index, turn_attempt)`;`nano_conversation_messages` 加 `superseded_at` / `superseded_by_turn_attempt`;`nano_conversations.deleted_at` tombstone | `workers/orchestrator-core/migrations/009-turn-attempt-and-message-supersede.sql` |
| `R4` | `010-agentic-loop-todos.sql`:`nano_session_todos`(完整 charter §7.2 §436 字段集 + status 5 值)+ `idx_todos_session(session_uuid, status)` | `workers/orchestrator-core/migrations/010-agentic-loop-todos.sql` |
| `R5` | `011-session-temp-files-and-provenance.sql`:`nano_session_temp_files`(含 `expires_at` / `cleanup_status` / `UNIQUE(session_uuid, virtual_path)`)+ `nano_session_files` provenance 三列(`provenance_kind` / `source_workspace_path` / `source_session_uuid`) | `workers/orchestrator-core/migrations/011-session-temp-files-and-provenance.sql` |
| `R6` | `012-session-confirmations.sql`:`nano_session_confirmations`(7 kinds、6 statuses;**无** `failed`、**无** `tool_cancel`;rollback 用 `superseded` 表达) | `workers/orchestrator-core/migrations/012-session-confirmations.sql` |
| `R7` | `013-product-checkpoints.sql`:四张表全部落地;`nano_workspace_cleanup_jobs.scope` 三值(`session_end` / `explicit` / `checkpoint_ttl`) | `workers/orchestrator-core/migrations/013-product-checkpoints.sql` |
| `R8` | `docs/architecture/hero-to-pro-schema.md` 与 consumer map | `docs/architecture/hero-to-pro-schema.md` |
| `R9` | schema-assertion 测试:`workers/orchestrator-core/test/migrations-schema-freeze.test.ts` 用 `node:sqlite` 顺序 apply 001→013 → introspect column / index / unique / enum / seed | 测试文件 |

---

## 2. Partial 项(HP1 收口但带 expires-at / handoff)

| ID | 描述 | 当前完成度 | `expires-at` | 后续 phase | 说明 |
|----|------|-----------|--------------|-----------|------|
| `P1` | `nano_models.base_instructions_suffix` 真值未填(seed 留 `NULL`) | `column-exists-only` | `HP2 closure`(模型状态机 + suffix 真值接线) | HP2 | HP1 仅冻结 column;真 prompt suffix 由 HP2 状态机决定每模型/每 reasoning 级文本 |
| `P2` | HP0 `withNanoAgentSystemPrompt(modelId?)` seam 由 HP1 列接线 | `column-ready-not-wired` | `HP2 closure` | HP2 | HP1 已为该 seam 提供 D1 列;runtime 真读由 HP2 落 |
| `P3` | prod baseline | `local-only` | `HP9 closure` | HP9 | HP1 仅 local apply;prod migration 由 HP9 owner-action 完成 |

---

## 3. Schema Correction Registry(Q6 frozen 模板)

> HP2-HP10 默认禁止新增 migration。如果未来真的发现 schema blocker(blocker 必须由 HP1 design review 时未识别),**唯一合法路径**如下;任何脱离此流程的私加 migration 视为破戒。

### 3.1 触发条件

- 必要条件 A:HP3-HP10 的 phase design review 给出"非加列/加表无法收口"的具体证据(行号 + 字段消费链)。
- 必要条件 B:Owner 显式批准 + Architect 显式批准(双签)。
- 必要条件 C:`docs/charter/plan-hero-to-pro.md` 与 `docs/design/hero-to-pro/HP1-schema-extension.md` 修订并入新 PR;说明哪条原 freeze 规则被例外。

### 3.2 编号与命名

- 新 migration 编号从 `014-...sql` 起,**禁止占用** `014` 之外的旧编号槽。
- 文件名前缀必须为 `014-correction-of-NNN-<topic>.sql`(其中 `NNN` 为本次 correction 引用的原始 migration 编号,例如 `014-correction-of-008-session-foo.sql`)。
- `<topic>` 必须能从 phase consumer map 直接定位到该 schema 缺失对应的 phase。

### 3.3 文件头模板

```sql
-- HP1 schema correction (Q6 frozen law)
--
-- correction-of: 008-session-model-audit.sql
-- triggered-by:  HP3 phase design review §<section>
-- approved-by:   <owner-handle>, <architect-handle>
-- charter-link:  docs/charter/plan-hero-to-pro.md §<heading>
-- design-link:   docs/design/hero-to-pro/HP1-schema-extension.md §<heading>
-- closure-link:  docs/issue/hero-to-pro/HP<N>-closure.md §<heading>
--
-- NOTE: 这是 schema correction,不是普通 migration。任何后续 phase 若想再触发,
-- 必须重新走 charter / design / closure 三处对齐 + 双签流程。
```

### 3.4 Closure / Charter 登记要求

- 触发 correction 的 phase closure 必须在 §0 verdict 表格中显式记一条 `schema-correction-triggered` 行,并指向 014+ 文件。
- `docs/charter/plan-hero-to-pro.md` §7.2 In-Scope 之后必须新增 §7.2.X "schema correction history" 段记录每次 correction 的 ID / 触发原因。
- HP10 final closure 必须独立总结 hero-to-pro 全程 correction 数;0 次为最佳目标。

### 3.5 当前状态

- 截至 HP1 closure 时间(2026-04-30),`014+` 文件**不存在**;hero-to-pro 全程 correction 数 = 0。

---

## 4. Retained 项(HP1 显式不删 / 不动)

| ID | 描述 | 来源 frozen 法律 | 后续 phase |
|----|------|-----------------|-----------|
| `K1` | `001-006` migration 不重写 | charter §7.2 §484 | n/a — 永久 |
| `K2` | `nano_conversation_context_snapshots` 表(由 002 引入)不被 product checkpoint 替代 | HP1 design §3.3 | 由 HP3 context state machine 继续消费(它表达 compact / snapshot,不表达用户可见 checkpoint) |
| `K3` | HP3 第一版 `/context/compact/jobs/{id}` 不引入 `nano_compact_jobs` 表;复用 `nano_session_checkpoints.checkpoint_kind = 'compact_boundary'` handle | HP1 action-plan §4.4 P4-01 | HP3 — 若 HP3 发现 handle 不足,走 §3 correction registry |

---

## 5. F1-F17 chronic status 登记(强制)

> 来源:HP1 action-plan §8.1 文档校验要求;F1-F17 沿用 HP0 closure §5 编号体系。

| chronic | 说明 | HP1 verdict | 备注 |
|---------|------|-------------|------|
| F1 | 公共入口模型字段透传断裂 | `closed-by-HP0` | HP0 已 closed;HP1 未触碰 |
| F2 | system prompt model-aware suffix 缺失 | `column-ready-by-HP1` | 007 已落 `base_instructions_suffix` 列;真值与运行时接线归 HP2 |
| F3 | session-level current model 与 alias resolution | `schema-ready-by-HP1` | 007 alias 表 + 008 session/turn audit 落地;状态机归 HP2 |
| F4 | context state machine | `schema-ready-by-HP1` | `nano_conversation_context_snapshots` 已存在;HP3 接线 |
| F5 | chat lifecycle | `schema-ready-by-HP1` | 009 turn_attempt / message supersede / conversation tombstone |
| F6 | confirmation control plane | `schema-ready-by-HP1` | 012 已冻结 7 kinds / 6 statuses |
| F7 | tool workspace state machine | `schema-ready-by-HP1` | 010 todos + 011 temp files + 011 provenance |
| F8 | checkpoint / revert | `schema-ready-by-HP1` | 013 四表 + lazy snapshot 状态机字段 |
| F9 | runtime hardening | `not-touched` | HP8 |
| F10 | R29 postmortem & residue verdict | `handed-to-platform` | HP8-B / HP10(HP0 已登记) |
| F11 | API docs + 手工证据 | `not-touched` | HP9 |
| F12 | final closure | `not-touched` | HP10 |
| F13 | observability drift | `not-touched` | HP8 / HP9 |
| F14 | tenant-scoped storage | `partial-by-HP1` | 011 temp files 已带 `team_uuid`;R2 path policy 仍归 HP6 |
| F15 | DO checkpoint vs product checkpoint registry 解耦 | `closed-by-HP1` | 013 product checkpoint 三表与 DO `session:checkpoint` 完全分层 |
| F16 | confirmation_pending kernel wait reason 统一 | `schema-ready-by-HP1` | 012 已落 `pending` status;runtime 等待原因统一归 HP5 / HP6 |
| F17 | `<model_switch>` developer message strip-then-recover during compact | `not-touched` | HP3 / HP4 联合 |

---

## 6. 下游 phase 交接 (handoff)

| 接收 phase | 交接物 | 形式 | HP1 内引用 |
|-----------|--------|------|------------|
| HP2 | 模型状态机 — 消费 007 metadata + 008 session/turn audit + 007 alias 表 | 强依赖;`P1` / `P2` 在 HP2 closure 时清空 | §1 R1-R2 |
| HP3 | context state machine — 复用 `nano_conversation_context_snapshots` + `compact_boundary` checkpoint handle | 中等;若发现 schema 缺口,走 §3 correction | §4 K2-K3 |
| HP4 | chat lifecycle — 消费 009 + 008 `ended_reason` | 强依赖 | §1 R2-R3 |
| HP5 | confirmation control plane — 消费 012 | 强依赖 | §1 R6 |
| HP6 | tool/workspace — 消费 010 + 011 + 013 `nano_workspace_cleanup_jobs.scope IN ('session_end', 'explicit')` | 强依赖 | §1 R4-R5、R7;§7.4 cleanup scope 分工 |
| HP7 | checkpoint / revert — 消费 013(全部四表)+ `nano_workspace_cleanup_jobs.scope = 'checkpoint_ttl'` | 强依赖 | §1 R7;§7.4 cleanup scope 分工 |
| HP8 | runtime hardening — 引用 schema 但默认不改 | 弱 | n/a |
| HP9 | prod baseline — apply 007-013 至 prod D1 + 校验 drift | 强依赖 | §2 P3 |
| HP10 | final closure — 总结 correction registry 状态 | 弱;§3.5 已写 0 次 | §3 |

---

## 7. Schema Consumer Map(007-013 → HP2-HP9)

> 用于 reviewer / 后续 phase 在不读源码的前提下,直接看到每张表/每列的消费者。

### 7.1 Migration 007 — model metadata + alias 表

| 列 / 对象 | HP2 | HP3 | HP5 | HP6 | HP7 | HP9 |
|-----------|-----|-----|-----|-----|-----|-----|
| `nano_models.max_output_tokens` | ✓(LLM 调用上限) | | | | | |
| `nano_models.effective_context_pct` | | ✓(compact threshold) | | | | |
| `nano_models.auto_compact_token_limit` | | ✓(compact threshold) | | | | |
| `nano_models.supported_reasoning_levels` | ✓(reasoning gate) | | | | | |
| `nano_models.input_modalities` | ✓(vision/text gate) | | | | | |
| `nano_models.provider_key` | ✓(provider routing) | | | | | ✓(usage events join) |
| `nano_models.fallback_model_id` | ✓(fallback chain) | | ✓(model_switch confirm) | | | |
| `nano_models.base_instructions_suffix` | ✓(system prompt) | | | | | |
| `nano_models.description` | ✓(`/models` UI) | | | | | |
| `nano_models.sort_priority` | ✓(`/models` order) | | | | | |
| `nano_model_aliases` | ✓(alias resolve) | | | | | |
| 4 alias seed | ✓(默认 alias 集合) | | | | | |

### 7.2 Migration 008 — session / turn model audit

| 列 | HP2 | HP4 | HP7 |
|-----|-----|-----|-----|
| `nano_conversation_sessions.default_model_id` | ✓ | ✓(replay) | |
| `nano_conversation_sessions.default_reasoning_effort` | ✓ | ✓ | |
| `nano_conversation_sessions.ended_reason`(Q13) | | ✓(终态原因) | ✓(restore 决策) |
| `nano_conversation_turns.requested_model_id` | ✓ | ✓ | ✓ |
| `nano_conversation_turns.requested_reasoning_effort` | ✓ | ✓ | |
| `nano_conversation_turns.effective_model_id` | ✓(fallback 后真值) | ✓ | ✓ |
| `nano_conversation_turns.effective_reasoning_effort` | ✓ | ✓ | |
| `nano_conversation_turns.fallback_used` | ✓ | ✓(audit) | |

### 7.3 Migration 009 — turn attempt / message supersede / conversation tombstone

| 对象 | HP4 | HP7 |
|------|-----|-----|
| `nano_conversation_turns.turn_attempt` | ✓(retry 次数) | ✓(restore target) |
| `UNIQUE(session_uuid, turn_index, turn_attempt)` | ✓ | |
| `nano_conversation_messages.superseded_at` | ✓(soft-supersede) | ✓ |
| `nano_conversation_messages.superseded_by_turn_attempt` | ✓ | |
| `nano_conversations.deleted_at` | ✓(soft-delete tombstone) | |

### 7.4 Migration 010-013 — workspace / confirmation / checkpoint

| 表 | HP5 | HP6 | HP7 | HP8 | 备注 |
|-----|-----|-----|-----|-----|------|
| `nano_session_todos`(010) | | ✓ | | | |
| `nano_session_temp_files`(011) | | ✓ | ✓(snapshot 源) | | retention by `expires_at` / `cleanup_status` |
| `nano_session_files` provenance(011) | | ✓ | ✓ | | promotion / restore lineage |
| `nano_session_confirmations`(012) | ✓(主消费) | ✓(`tool_permission` / `elicitation`) | ✓(`checkpoint_restore` / `context_loss`) | | `model_switch` / `fallback_model` 由 HP2 触发,但落到 012 |
| `nano_session_checkpoints`(013) | | | ✓ | ✓(cron TTL) | |
| `nano_checkpoint_file_snapshots`(013) | | | ✓ | | lazy materialization |
| `nano_checkpoint_restore_jobs`(013) | ✓(`confirmation_uuid` FK) | | ✓ | | restore audit |
| `nano_workspace_cleanup_jobs`(013) | | ✓(`scope = 'session_end' \| 'explicit'`) | ✓(`scope = 'checkpoint_ttl'`) | | scope 分工 frozen |

`nano_workspace_cleanup_jobs.scope` 三值的 phase 分工属于 HP6/HP7 后续行为口径,closure 此处显式锁定:**`session_end` 与 `explicit` 由 HP6 写入,`checkpoint_ttl` 由 HP7 cron 写入**。HP6/HP7 closure 须在自身的 §1 Resolved 内引用本节 §7.4。

---

## 8. 测试与证据矩阵

| 类型 | 命令 / 路径 | 状态 |
|------|-------------|------|
| typecheck (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | ✅ |
| build (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker build` | ✅ |
| test (orchestrator-core) | `pnpm --filter @haimang/orchestrator-core-worker test` | ✅(全绿;新增 1 个 schema-freeze 测试文件) |
| schema-assertion(关键证据)| `workers/orchestrator-core/test/migrations-schema-freeze.test.ts` | ✅ 用 `node:sqlite` 顺序 apply 001-013,逐项断言 column / index / unique / enum / seed |
| local apply on fresh baseline | 同上(测试在 `:memory:` D1 上 apply 完整链) | ✅ |
| prod apply | not run(留 HP9 owner-action) | n/a |

---

## 9. 与 frozen QNA 一一对照

| QNA | HP1 落点 |
|-----|----------|
| Q4 — `007-013` 编号、`014+` 仅 correction | §0 verdict;§3 correction registry |
| Q5 — checkpoint lineage 一次落表 | §1 R7 — 013 四张表 |
| Q6 — schema correction 法律 | §3 整段 |
| Q13 — `ended_reason` 列进入 008 | §1 R2;§7.2 |
| Q16 — confirmation 6 statuses,无 `failed` | §1 R6;§7.4 |
| Q18 — confirmation 7 kinds,无 `tool_cancel` | §1 R6;§7.4 |

---

## 10. 收尾签字

- HP1 的 in-scope 全部落地,partial 三项均带去向(HP2 / HP9)。
- DDL Freeze Gate 生效;后续 HP2-HP10 默认禁止新增 migration,例外路径见 §3。
- 任何后续 phase 若试图再加 migration,必须显式援引本 closure §3 并完成 owner+architect 双签。
