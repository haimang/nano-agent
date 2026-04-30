# Hero-to-Pro D1 Schema Reference (`007-013` DDL Freeze)

> 来源:`docs/charter/plan-hero-to-pro.md` §7.2、`docs/design/hero-to-pro/HP1-schema-extension.md`、`docs/issue/hero-to-pro/HP1-closure.md`
> 状态:`frozen`(HP1 closure 已生效;后续 phase 默认禁止新增 migration)
> 日期:`2026-04-30`

本文档面向 reviewer 与 HP2-HP10 实施者,把 `007-013` 七个 migration 引入的所有 hero-to-pro durable truth 写在同一处,以便消费者(HP2-HP9)在不读 SQL 的前提下也能定位字段、索引、enum 与 phase 责任分配。

---

## 0. Migration Ledger(与 HP1 closure §0 verdict 一致)

| Migration | 主题 | 文件 |
|-----------|------|------|
| 007 | model metadata + alias | `migrations/007-model-metadata-and-aliases.sql` |
| 008 | session / turn audit + ended_reason | `migrations/008-session-model-audit.sql` |
| 009 | turn_attempt rebuild + message supersede + conversation tombstone | `migrations/009-turn-attempt-and-message-supersede.sql` |
| 010 | agentic-loop todo durable truth | `migrations/010-agentic-loop-todos.sql` |
| 011 | workspace temp file + artifact provenance | `migrations/011-session-temp-files-and-provenance.sql` |
| 012 | confirmation control plane(7 kinds / 6 statuses) | `migrations/012-session-confirmations.sql` |
| 013 | product checkpoint lineage(4 tables) | `migrations/013-product-checkpoints.sql` |

未来 schema correction(若触发,概率应为 0)从 `014-correction-of-NNN-<topic>.sql` 起;模板见 HP1 closure §3.3。

---

## 1. Migration 007 — Model Metadata + Alias

### 1.1 `nano_models`(由 003 引入,本次扩 10 列)

| 列 | 类型 | 说明 | 主消费者 |
|----|------|------|----------|
| `max_output_tokens` | INTEGER | 单次 LLM 输出上限(tokens) | HP2 |
| `effective_context_pct` | REAL | 实际可用 context 占比(剩余给 system prompt / tools / safety margin) | HP3 |
| `auto_compact_token_limit` | INTEGER | 触发 auto-compact 的输入上限 | HP3 |
| `supported_reasoning_levels` | TEXT(JSON array<string>) | `low / medium / high` 子集;由 HP2 reasoning gate 校验 | HP2 |
| `input_modalities` | TEXT(JSON array<string>) | `text / vision / audio / ...`;由 HP2 vision/multimodal gate 校验 | HP2 |
| `provider_key` | TEXT | provider routing 与 usage events join | HP2 / HP9 |
| `fallback_model_id` | TEXT | 单跳 fallback 链(下一跳模型) | HP2 / HP5(`fallback_model` confirmation) |
| `base_instructions_suffix` | TEXT | 模型专属 system prompt suffix | HP2(HP0 P3-01 seam 在 HP2 落表后接线) |
| `description` | TEXT | `/models` UI 描述 | HP2 |
| `sort_priority` | INTEGER NOT NULL DEFAULT 0 | `/models` 排序权重(高在前) | HP2 |

附加索引:`idx_nano_models_status_sort_priority(status, sort_priority DESC, model_id)`。

### 1.2 `nano_model_aliases`(新表)

| 列 | 类型 | 说明 |
|----|------|------|
| `alias_id` | TEXT PK | 形如 `@alias/fast` |
| `target_model_id` | TEXT NOT NULL FK→`nano_models.model_id` | alias 指向的真实模型 |
| `created_at` | TEXT | ISO timestamp |

索引:`idx_nano_model_aliases_target(target_model_id)`。

Seed(4 条,Q4 frozen):

| alias | 当前 target |
|-------|-------------|
| `@alias/fast` | `@cf/meta/llama-3.2-3b-instruct` |
| `@alias/balanced` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` |
| `@alias/reasoning` | `@cf/meta/llama-4-scout-17b-16e-instruct` |
| `@alias/vision` | `@cf/meta/llama-3.2-90b-vision-instruct` |

HP2 后续可通过 UPDATE rebind alias 目标(无须 migration)。

---

## 2. Migration 008 — Session / Turn Audit + `ended_reason`

### 2.1 `nano_conversation_sessions` 扩列

| 列 | 类型 | 说明 |
|----|------|------|
| `default_model_id` | TEXT | session-level 默认模型(turn 未显式指定时的回填来源) |
| `default_reasoning_effort` | TEXT | session-level 默认 reasoning |
| `ended_reason` | TEXT | Q13 frozen — 终止原因列(**不**新增 session_status enum 值) |

附加索引:`idx_nano_conversation_sessions_ended_reason(ended_reason, ended_at)`。

### 2.2 `nano_conversation_turns` 扩列

| 列 | 类型 | 说明 |
|----|------|------|
| `requested_model_id` | TEXT | 客户端/上游请求模型 |
| `requested_reasoning_effort` | TEXT | 客户端/上游请求 reasoning |
| `effective_model_id` | TEXT | 实际生效模型(可能因 fallback 与 requested 不同) |
| `effective_reasoning_effort` | TEXT | 实际生效 reasoning |
| `fallback_used` | INTEGER NOT NULL DEFAULT 0 CHECK IN (0,1) | 是否触发了 fallback 链 |

附加索引:`idx_nano_conversation_turns_session_effective_model(session_uuid, effective_model_id)`。

> ⚠️ `nano_conversation_turns` 在 009 中被 rebuild;以上列在 rebuild 后保留。schema-freeze 测试断言 rebuild 后的 column 集合。

---

## 3. Migration 009 — `turn_attempt` Rebuild + Message Supersede + Conversation Tombstone

### 3.1 `nano_conversation_turns` rebuild

- 新列:`turn_attempt INTEGER NOT NULL DEFAULT 1`
- 新唯一约束:`UNIQUE(session_uuid, turn_index, turn_attempt)`(替换 002 的 `UNIQUE(session_uuid, turn_index)`)
- 全部 008 列保留;FK / 既有 CHECK 不变

附加索引:`idx_nano_conversation_turns_session_index_attempt(session_uuid, turn_index, turn_attempt)`。

### 3.2 `nano_conversation_messages` supersede 标记

| 列 | 类型 | 说明 |
|----|------|------|
| `superseded_at` | TEXT | 软覆盖时间;NULL 表示活跃 |
| `superseded_by_turn_attempt` | INTEGER | 由哪个 attempt 覆盖 |

附加索引:`idx_nano_conversation_messages_session_superseded(session_uuid, superseded_at)`。

### 3.3 `nano_conversations` tombstone

| 列 | 类型 | 说明 |
|----|------|------|
| `deleted_at` | TEXT | soft-delete 时间;NULL 表示活跃 |

附加索引:`idx_nano_conversations_team_deleted_at(team_uuid, deleted_at)`。

---

## 4. Migration 010 — Agentic-Loop Todos

`nano_session_todos`(新表):

| 列 | 类型 | 说明 |
|----|------|------|
| `todo_uuid` | TEXT PK | |
| `session_uuid` | TEXT NOT NULL FK→sessions | |
| `conversation_uuid` | TEXT NOT NULL FK→conversations | |
| `team_uuid` | TEXT NOT NULL FK→teams | |
| `parent_todo_uuid` | TEXT FK→self ON DELETE SET NULL | 树形 |
| `content` | TEXT NOT NULL | |
| `status` | TEXT CHECK IN (`pending` / `in_progress` / `completed` / `cancelled` / `blocked`) | 5 值 frozen |
| `created_at` / `updated_at` / `completed_at` | TEXT | |

索引:`idx_todos_session(session_uuid, status)` / `idx_todos_team_updated(team_uuid, updated_at DESC)`。

主消费者:HP6。

---

## 5. Migration 011 — Workspace Temp Files + Artifact Provenance

### 5.1 `nano_session_temp_files`(新表)

workspace scratch 文件,与 `nano_session_files`(004 artifact 表)分层。

| 列 | 类型 | 说明 |
|----|------|------|
| `temp_file_uuid` | TEXT PK | |
| `session_uuid` / `team_uuid` | TEXT NOT NULL FK | |
| `virtual_path` | TEXT NOT NULL | workspace 内逻辑路径 |
| `r2_object_key` | TEXT NOT NULL | R2 真路径 |
| `mime` / `size_bytes` / `content_hash` / `last_modified_at` | — | |
| `written_by` | TEXT CHECK IN (`user` / `agent` / `tool`) | 3 值 |
| `created_at` / `expires_at` | TEXT | retention 由 `expires_at` 与 `cleanup_status` 控制 |
| `cleanup_status` | TEXT NOT NULL DEFAULT `pending` CHECK IN (`pending` / `scheduled` / `done`) | |
| `UNIQUE(session_uuid, virtual_path)` | 唯一约束 | 同一会话的 path 不可冲突 |

索引:`idx_temp_files_session(session_uuid)` / `idx_temp_files_cleanup(cleanup_status, expires_at)` / `uq_nano_session_temp_files_r2_key`(R2 key 全局唯一)。

### 5.2 `nano_session_files` 扩 3 列(provenance)

| 列 | 类型 | 说明 |
|----|------|------|
| `provenance_kind` | TEXT CHECK IN (`user_upload` / `agent_generated` / `workspace_promoted` / `compact_summary` / `checkpoint_restored`) | 5 值 |
| `source_workspace_path` | TEXT | 若 `provenance_kind = workspace_promoted`,引用 temp file path |
| `source_session_uuid` | TEXT | 若 `provenance_kind = checkpoint_restored` / fork,记录源 session |

附加索引:`idx_nano_session_files_provenance_kind(provenance_kind)` / `idx_nano_session_files_source_session(source_session_uuid)`。

主消费者:HP6 / HP7。

---

## 6. Migration 012 — Confirmation Control Plane

`nano_session_confirmations`(新表):

| 列 | 类型 | 说明 |
|----|------|------|
| `confirmation_uuid` | TEXT PK | |
| `session_uuid` | TEXT NOT NULL FK | |
| `kind` | TEXT CHECK IN(7 值) | `tool_permission` / `elicitation` / `model_switch` / `context_compact` / `fallback_model` / `checkpoint_restore` / `context_loss` |
| `payload_json` | TEXT NOT NULL | 结构由 HP5 control-plane runtime 决定 |
| `status` | TEXT NOT NULL DEFAULT `pending` CHECK IN(6 值) | `pending` / `allowed` / `denied` / `modified` / `timeout` / `superseded` |
| `decision_payload_json` | TEXT | client 应答 |
| `created_at` / `decided_at` / `expires_at` | TEXT | |

**Q16 / Q18 frozen 不变量**:
- `kind` 必须严格等于上述 7 值集合;**禁止** `tool_cancel`(Q18)
- `status` 必须严格等于上述 6 值集合;**禁止** `failed`(Q16)。回滚终态使用 `superseded`

附加索引:`idx_confirmations_session_status(session_uuid, status)` / `idx_confirmations_kind_status(kind, status, created_at)` / `idx_confirmations_expires_at(expires_at) WHERE status='pending'`(partial index)。

主消费者:HP5(主写)、HP2(`model_switch` / `fallback_model`)、HP7(`checkpoint_restore` / `context_loss`)。

---

## 7. Migration 013 — Product Checkpoint Lineage(4 张表)

> 与 DO `session:checkpoint` runtime state **完全分层**;013 表达的是用户可见、可列出、可恢复、可审计的产品级 checkpoint。

### 7.1 `nano_session_checkpoints`

| 列 | 类型 / Enum | 说明 |
|----|-------------|------|
| `checkpoint_uuid` | TEXT PK | |
| `session_uuid` / `conversation_uuid` / `team_uuid` | TEXT NOT NULL FK | |
| `turn_uuid` | TEXT FK→turns ON DELETE SET NULL | |
| `turn_attempt` | INTEGER | 与 009 的 attempt 维度一致 |
| `checkpoint_kind` | CHECK IN (`turn_end` / `user_named` / `compact_boundary` / `system`) | 4 值 |
| `label` | TEXT | 用户命名 checkpoint 时的展示文本 |
| `message_high_watermark` | TEXT | restore 时确定回放截止点 |
| `latest_event_seq` | INTEGER | |
| `context_snapshot_uuid` | TEXT FK→`nano_conversation_context_snapshots` ON DELETE SET NULL | |
| `file_snapshot_status` | DEFAULT `none` CHECK IN (`none` / `pending` / `materialized` / `failed`) | lazy materialization |
| `created_by` | CHECK IN (`user` / `system` / `compact` / `turn_end`) | |
| `created_at` / `expires_at` | TEXT | |

索引:`idx_checkpoints_session(session_uuid, created_at)` / `idx_checkpoints_team_created` / `idx_checkpoints_kind_created` / `idx_checkpoints_expires_at`。

### 7.2 `nano_checkpoint_file_snapshots`

| 列 | 说明 |
|----|------|
| `snapshot_uuid` PK | |
| `checkpoint_uuid` FK | |
| `session_uuid` / `team_uuid` FK | |
| `source_temp_file_uuid` FK→`nano_session_temp_files` ON DELETE SET NULL | 二选一 |
| `source_artifact_file_uuid` FK→`nano_session_files` ON DELETE SET NULL | 二选一 |
| `source_r2_key` / `snapshot_r2_key` / `virtual_path` / `size_bytes` / `content_hash` | |
| `snapshot_status` | DEFAULT `pending` CHECK IN (`pending` / `materialized` / `copied_to_fork` / `failed`) |
| `created_at` | |

索引:`idx_checkpoint_snapshots_checkpoint` / `idx_checkpoint_snapshots_status` / `idx_checkpoint_snapshots_session`。

### 7.3 `nano_checkpoint_restore_jobs`

| 列 | 说明 |
|----|------|
| `job_uuid` PK | |
| `checkpoint_uuid` / `session_uuid` FK | |
| `mode` | CHECK IN (`conversation_only` / `files_only` / `conversation_and_files` / `fork`) |
| `target_session_uuid` | FK→sessions ON DELETE SET NULL(fork 模式才填) |
| `status` | DEFAULT `pending` CHECK IN (`pending` / `running` / `succeeded` / `partial` / `failed` / `rolled_back`) |
| `confirmation_uuid` | FK→`nano_session_confirmations` ON DELETE SET NULL |
| `started_at` / `completed_at` / `failure_reason` | |

索引:`idx_restore_jobs_session` / `idx_restore_jobs_checkpoint` / `idx_restore_jobs_status_started`。

### 7.4 `nano_workspace_cleanup_jobs`(HP6 / HP7 共表)

| 列 | 说明 |
|----|------|
| `job_uuid` PK | |
| `session_uuid` / `team_uuid` FK | |
| `scope` | CHECK IN (`session_end` / `explicit` / `checkpoint_ttl`) — 3 值 frozen |
| `target_count` / `deleted_count` | INTEGER |
| `status` | DEFAULT `pending` CHECK IN (`pending` / `running` / `done` / `failed`) |
| `scheduled_at` / `started_at` / `completed_at` | |

索引:`idx_cleanup_jobs_session_status` / `idx_cleanup_jobs_scope_status` / `idx_cleanup_jobs_scheduled_at`。

**HP1 closure §7.4 frozen 责任分配**:

| `scope` | 写入者 |
|---------|--------|
| `session_end` | HP6(workspace 状态机) |
| `explicit` | HP6 |
| `checkpoint_ttl` | HP7(checkpoint TTL cron) |

> HP3 第一版 `/context/compact/jobs/{id}` 复用 `nano_session_checkpoints.checkpoint_kind = 'compact_boundary'` handle,**不**新增 `nano_compact_jobs` 表。如果 HP3 实施期发现 handle 不足,必须走 HP1 closure §3 schema correction 流程。

---

## 8. Phase Consumer Map(HP1 closure §7 的扩展投影)

| Migration | HP2 | HP3 | HP4 | HP5 | HP6 | HP7 | HP8 | HP9 |
|-----------|-----|-----|-----|-----|-----|-----|-----|-----|
| 007 | ✓✓✓(主) | ✓ | | ✓(via fallback_model_id) | | | | ✓(provider_key join) |
| 008 | ✓(audit 主) | | ✓(replay/ended_reason) | | | ✓(restore decisions) | | |
| 009 | | | ✓✓✓(主) | | | ✓(restore target) | | |
| 010 | | | | | ✓✓✓(主) | | | |
| 011 | | | | | ✓✓(temp + provenance) | ✓(snapshot 源 / restored provenance) | | |
| 012 | ✓(model_switch / fallback_model) | ✓(context_compact) | | ✓✓✓(主) | ✓(tool_permission / elicitation) | ✓(checkpoint_restore / context_loss) | | |
| 013 | | ✓(`compact_boundary` handle) | | ✓(restore_jobs.confirmation_uuid) | ✓(cleanup_jobs.scope='session_end' \| 'explicit') | ✓✓✓(主)(`scope='checkpoint_ttl'` 由此处写) | ✓(cron TTL) | |

(`✓` 弱;`✓✓` 中;`✓✓✓` 主)

---

## 9. Schema Correction Law(Q6 frozen)

完整模板见 HP1 closure §3。这里列出最小要求:

1. 双签:Owner + Architect
2. 编号从 `014-correction-of-NNN-<topic>.sql` 起
3. SQL 文件头必须含 `correction-of:` / `triggered-by:` / `approved-by:` / `charter-link:` / `design-link:` / `closure-link:` 六行
4. 触发 phase closure §0 verdict 与 charter §7.2 都要回填 correction history 段

截至 HP1 closure(2026-04-30):**0 次 correction**。

---

## 10. 测试与验证证据

- `workers/orchestrator-core/test/migrations-schema-freeze.test.ts` 用 `node:sqlite` 顺序 apply 001 → 013 后断言:
  - 010 status enum 5 值
  - 011 cleanup_status / written_by / provenance_kind enum
  - 012 confirmation 7 kinds + 6 statuses(显式拒绝 `failed` / `tool_cancel`)
  - 013 checkpoint_kind / file_snapshot_status / created_by / mode / status / scope / snapshot_status enum
  - 009 UNIQUE(session_uuid, turn_index, turn_attempt) 已生效;旧 UNIQUE(session_uuid, turn_index) 已消失
  - 4 alias seed
  - 不存在 `nano_compact_jobs`;不存在 `014+` correction migration
- `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`:全绿(21 files / 196 tests)
