# Nano-Agent 功能簇设计

> 功能簇: `HP1 Schema Extension`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-168`
> - `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:17-89,56-129`
> - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
> - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql:22-103`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（待统一回填 owner / ops 答案后再转 `frozen`；当前先登记建议结论）
> 文档状态: `reviewed`
> 外部 precedent 说明: 当前工作区未 vendored `context/` 源文件；文中出现的 `context/*` 仅作 drafting-time ancestry pointer，不作为当前冻结 / 执行证据。

---

## 0. 背景与前置约束

HP1 是 hero-to-pro 最重要的冻结点：它负责把后续 11 个 phase 所需的 D1 表/列一次性定义清楚。其价值不是“马上做出用户可见功能”，而是避免 HP2-HP10 在执行中边做边补 migration，重新制造 schema drift、prod baseline 不可知和 phase 间 contract 漂移。

- **项目定位回顾**：HP1 是 `DDL Freeze Gate`，不是业务功能 phase。
- **本次讨论的前置共识**：
  - 当前仓库 D1 migrations 真实 baseline 是 `001`-`006`；hero-to-pro 新 migration 从 `007` 起编号。
  - 后续 HP2-HP10 默认不得新增 migration，除非触发 charter 允许的 `HP1 schema correction` 受控例外。
  - HP1 必须覆盖 HP4 / HP7 checkpoint restore、HP6 workspace/provenance、HP5 confirmations、HP2 model metadata 的全部 schema 需求。
  - 现有 D1 表已包含 conversation/session/turn/message/context snapshot/activity log、usage/model catalog、session files、error/audit log。
- **本设计必须回答的问题**：
  - 现有 D1 baseline 与 hero-to-pro 目标之间，哪些表需要新建，哪些表只扩列？
  - checkpoint / restore / provenance / cleanup lineage 应怎样表达，才能避免 HP4/HP7 破戒？
  - model metadata 与 runtime `ModelCapabilities` 之间，HP1 要对齐到什么程度，哪些字段暂不进表？
  - migration 应如何拆分成 `007-013`，以便 review 与 apply 风险可控？
- **显式排除的讨论范围**：
  - 各端点与 runtime 的具体业务逻辑（留 HP2-HP7）
  - prod migration apply 过程与 owner 手工步骤（留 HP9 baseline）
  - `clients/api-docs/` 文档更新（留 HP9）

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP1 Schema Extension`
- **一句话定义**：`以 007-013 七个 migration 为单位，把 hero-to-pro 全阶段需要的 D1 durable truth 一次性冻结下来。`
- **边界描述**：这个功能簇**包含** model metadata、session/turn model audit、turn retry、message supersede、todos、temp files、artifact provenance、confirmations、product checkpoints、restore jobs、cleanup lineage；**不包含** route 逻辑、compact runtime、tool/workspace API、prod apply。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| DDL Freeze Gate | HP1 完成后 schema 视为冻结 | 后续 phase 默认不再加 migration |
| product checkpoint | 用户可见、可列出、可恢复、可审计的 checkpoint | 不等于 DO `session:checkpoint` |
| temp file | agent workspace 的临时文件真相 | 不等于 `nano_session_files` artifact |
| provenance | 文件或 artifact 的来源与 lineage | HP6/HP7 必须可审计 |
| restore job | checkpoint restore / fork 的 durable audit 记录 | 用于 rollback、失败恢复与 final closure |

### 1.2 参考源码与现状锚点

- `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-169` — 当前 conversation/session/turn/message/context snapshot/activity baseline
- `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:17-89,56-129` — 当前 usage/quota/model catalog baseline 与 `nano_models`
- `workers/orchestrator-core/migrations/004-session-files.sql:6-27` — 当前 artifact truth 仅有 `nano_session_files`
- `workers/orchestrator-core/migrations/006-error-and-audit-log.sql:22-103` — queryable error/audit truth 的现有风格
- `context/codex/codex-rs/protocol/src/openai_models.rs:248-299` — richer model metadata precedent
- `context/gemini-cli/packages/core/src/services/chatRecordingTypes.ts:92-140` 与 `context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-470,510-532,799-818` — durable chat/rewind record precedent
- `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:15-24,84-157` 与 `context/gemini-cli/packages/cli/src/ui/commands/restoreCommand.ts:43-123` — checkpoint / restore product truth precedent

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP1 在整体架构里扮演 **product durable truth freeze** 的角色。
- 它服务于：
  - HP2 model state machine
  - HP4/HP7 checkpoint / restore / fork
  - HP5 confirmation control plane
  - HP6 workspace / temp file / promotion / cleanup
  - HP9 prod schema baseline
- 它依赖：
  - 当前 migrations `001-006`
  - 当前 `/models`、messages、files、context 等已上线 contract
  - HP0 对字段命名的前置对齐
- 它被谁依赖：
  - 几乎所有 hero-to-pro 后续 phase
  - future final closure 对 “schema 是否完整、是否 drift” 的判定

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP0 Pre-Defer Fixes | HP0 -> HP1 | 中 | `base_instructions_suffix` 等字段命名需先对齐 |
| HP2 Model State Machine | HP1 -> HP2 | 强 | session/turn model audit 与 model metadata 依赖 HP1 |
| HP5 Confirmation | HP1 -> HP5 | 强 | `nano_session_confirmations` 是唯一 durable truth |
| HP6 Tool/Workspace | HP1 -> HP6 | 强 | temp files / provenance / cleanup jobs 都依赖 HP1 |
| HP7 Checkpoint Revert | HP1 -> HP7 | 强 | checkpoint 三表与 restore job 直接决定 HP7 能否收口 |
| HP9 Prod Baseline | HP1 -> HP9 | 中 | HP9 需要把 prod 真相与 `007-013` 对齐 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP1 Schema Extension` 是 **hero-to-pro 的 durable truth 冻结层**，负责 **把模型、聊天、确认、工作区、checkpoint 的产品真相一次性落入 D1**，对上游提供 **稳定的 schema contract**，对下游要求 **后续 phase 只写数据和逻辑，不再反复改表**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 每 phase 各自加 migration | “边做边补最灵活” 的诱因 | 会重演 F16 式 schema drift 与 prod baseline 不可知 | 否 |
| 把 checkpoint 信息塞进 `payload_json` | 最快可跑路径 | 不可查询、不可 TTL、不可审计 | 否 |
| 用 `nano_session_files` 直接兼任 temp workspace | 省表设计诱因 | artifact 与 temp file 生命周期不同 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| model metadata | `nano_models` 扩列 + `nano_model_aliases` | 覆盖当前 runtime 需要的 capability 子集 | hero-to-platform 再加 pricing / visibility / instructions template |
| restore modes | `nano_checkpoint_restore_jobs.mode` | `conversation_only/files_only/conversation_and_files/fork` | 后续扩 export/import |
| cleanup lineage | `nano_workspace_cleanup_jobs` | 记录 temp/checkpoint 清理 | 未来可扩更多 retention policy |
| confirmation kinds | `nano_session_confirmations.kind` | 先覆盖 charter 约定的 7 类 | 后续可再加新 control-plane kinds |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：artifact durable truth 与 workspace temp truth
- **解耦原因**：上传产物、agent 生成 artifact、workspace scratch file、checkpoint snapshot 的生命周期和读模型完全不同
- **依赖边界**：`nano_session_files` 继续表示长期 artifact 元数据；`nano_session_temp_files` 单独表示 workspace 临时文件；checkpoint snapshot 也单独建表

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：所有 hero-to-pro 新 durable truth
- **聚合形式**：聚合到 `007-013` 七个 migration，而不是继续零碎塞到旧 migration 或后续 phase
- **为什么不能分散**：一旦分散，HP4/HP7/HP9 都会重新陷入“这个字段到底在哪个 migration 引入”的不确定状态

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent 以当前仓库源码锚点为 authoritative evidence；若出现 `context/*`，仅作 external ancestry pointer，不把调查 markdown 当作二手证据引用。

### 4.1 Codex 的做法

- **实现概要**：Codex 的 `/models` 元数据不是薄目录，而是直接在 `ModelInfo` 中暴露 `default_reasoning_level`、`supported_reasoning_levels`、`base_instructions`、`truncation_policy`、`supports_parallel_tool_calls`、`context_window`、`auto_compact_token_limit`、`effective_context_window_percent`、`input_modalities` 等运行期字段（`context/codex/codex-rs/protocol/src/openai_models.rs:248-299`）。
- **亮点**：
  - metadata 直接足够支撑 runtime / compact / tool / modality 决策，而不是只给 list page 展示用字段
- **值得借鉴**：
  - 把 model metadata 先扩到足够支撑 runtime 决策，而不是只够 list page 展示
- **不打算照抄的地方**：
  - 一次把 Codex 全量 `ModelInfo` 都搬进 D1；HP1 只落当前 runtime 真需要的字段，不把 personality / 供应商私有开关一起冻结

### 4.2 Gemini CLI 的做法

- **实现概要**：Gemini CLI 把聊天持久化、rewind、checkpoint restore 都做成真实产品面：`ChatRecordingService` 以 JSONL 追加 `metadata` / `message` / `$set` / `$rewindTo` 记录（`context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-470,510-532,799-818`）；checkpoint 文件保存 `history`、`clientHistory`、`commitHash`、`toolCall`、`messageId`（`context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:15-24,84-157`）；`/restore` 会列出 checkpoint、加载历史并恢复 Git snapshot（`context/gemini-cli/packages/cli/src/ui/commands/restoreCommand.ts:43-123`; `context/gemini-cli/packages/core/src/commands/restore.ts:11-57`）。
- **亮点**：
  - restore / rewind / tool-call 恢复都有 durable 记录，而不是只存在内存或临时状态
- **值得借鉴**：
  - 把 checkpoint list、file snapshot、restore job 都做成可审计 durable truth
- **不打算照抄的地方**：
  - 直接照抄 JSONL transcript；nano-agent 仍以 D1 结构化真相为主

### 4.3 当前仓库 precedent

- **实现概要**：当前 `002`/`003`/`004`/`006` 已经证明本仓库偏好 “D1 主真相 + queryable indexes + minimal payload indirection”。
- **亮点**：
  - 表结构清晰，索引与 FK 边界明确
- **值得借鉴**：
  - 新表继续遵守 queryable truth，而不是把可查询信息塞进 JSON blob
- **不打算照抄的地方**：
  - 继续把 product checkpoint 混同为 `nano_conversation_context_snapshots`

### 4.4 横向对比速查表

| 维度 | 当前代码 | HP1 目标 | nano-agent 倾向 |
|------|----------|----------|------------------|
| model metadata | 只够 `/models` 基本展示 | 足够支撑 runtime / context / fallback | 适度扩，不盲目全量 |
| workspace truth | 只有 artifact files | temp + artifact + provenance 分离 | durable truth 分层 |
| checkpoint truth | 只有 context snapshot / DO checkpoint | product checkpoint + file snapshot + restore job | 可查询、可审计 |
| cleanup lineage | 主要靠 cron + logic | 独立 cleanup jobs 表 | 防止误删与 closure 失真 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** `nano_models` 扩列与 `nano_model_aliases` — HP2 / HP3 的模型状态机和 compact policy 都依赖 richer metadata。
- **[S2]** session / turn model audit 列 — 没有这些列，HP2 的 4 层模型状态机无法 durable。
- **[S3]** `turn_attempt`、message supersede、conversation tombstone — HP4 retry / delete / rollback 必需。
- **[S4]** `nano_session_todos`、`nano_session_temp_files`、`nano_session_files` provenance columns — HP6 workspace 与 artifact promotion 必需。
- **[S5]** `nano_session_confirmations` — HP5 的统一 confirmation control plane 必需。
- **[S6]** `nano_session_checkpoints`、`nano_checkpoint_file_snapshots`、`nano_checkpoint_restore_jobs`、`nano_workspace_cleanup_jobs` — HP4/HP7/HP6 的完整闭环必需。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** prod migration apply — 属于 HP9 owner-action；重评条件：HP9 baseline
- **[O2]** model pricing / billing / admin-plane fields — 属于 hero-to-platform；重评条件：阶段边界改变
- **[O3]** provider routing / secondary provider credentials — 属于 hero-to-platform；重评条件：multi-provider 决策变更
- **[O4]** temp file diff/patch editing model — 属于 HP6/hero-to-platform；重评条件：workspace API 进入第二版

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| `nano_conversation_context_snapshots` 直接兼任 product checkpoint | out-of-scope | 该表表达的是 compact/snapshot，不是用户可见 checkpoint timeline | HP1 必须单建 checkpoint 表 |
| 把 temp files 合并进 `nano_session_files` | out-of-scope | 生命周期、权限、cleanup、promotion 语义不同 | HP1 分表 |
| `nano_workspace_cleanup_jobs` 是否过度设计 | in-scope | HP6/HP7 cleanup 若无 durable lineage，closure 会失真 | HP1 |
| alias 只做客户端约定，不入 D1 | out-of-scope | session-level model setting 必须 durable / queryable | HP1 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **七个聚焦 migration（007-013）** 而不是 **一个超大 migration 或多 phase 零散 migration**
   - **为什么**：一个超大文件 review 成本过高，多 phase 零散 migration 又会破坏 DDL Freeze Gate。
   - **我们接受的代价**：HP1 review 本身仍然较重。
   - **未来重评条件**：无；这是本阶段基本纪律。

2. **取舍 2**：我们选择 **workspace temp truth / artifact truth / checkpoint snapshot truth 三分离** 而不是 **单表承载一切**
   - **为什么**：三者 lifecycle、权限面、cleanup 语义不同。
   - **我们接受的代价**：表数量更多。
   - **未来重评条件**：若后续 product scope 缩到“无 temp workspace、无 files-only restore”，才可能收缩。

3. **取舍 3**：我们选择 **HP1 只落 runtime 真需要的 model metadata** 而不是 **一次把 Codex 级超厚 metadata 全落表**
   - **为什么**：需要平衡 forward-thinking 与 current-scope。
   - **我们接受的代价**：future 仍可能新增字段。
   - **未来重评条件**：hero-to-platform 进入 richer model policy / provider policy。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| SQLite rebuild 失误 | `turn_attempt` 改 UNIQUE 需要重建表 | 迁移失败或数据损坏 | 把 rebuild 放入独立 migration 009，并写 schema test |
| checkpoint schema 漏字段 | 只看 HP4，不看 HP7 | HP7 中途被迫补 migration | 设计里同时对照 HP4/HP7 In-Scope |
| model metadata 过薄 | 只满足 `/models` list，不满足 runtime | HP3 compact policy / HP2 fallback 仍不完整 | 在 HP1 明确对齐 runtime 所需字段 |
| cleanup lineage 缺失 | 认为 cron 足够 | HP6/HP7 cleanup 不可审计 | 单独建 `nano_workspace_cleanup_jobs` |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：后续 phase 能在稳定表结构上开发，不再边做边猜 schema。
- **对 nano-agent 的长期演进**：为 checkpoint、workspace、model control plane 建立 durable truth 规范。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：checkpoint/restore 让上下文治理可回滚；workspace / confirmation 表让 agentic loop control plane 可审计；cleanup lineage 提高运行稳定性。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | 模型 metadata 与 alias 扩展 | 扩 `nano_models`，新增 `nano_model_aliases` | ✅ HP2/HP3 可直接读取 richer model truth |
| F2 | 聊天 durable truth 扩展 | 增加 turn retry、message supersede、conversation tombstone、session/turn model audit | ✅ HP2/HP4 的 durable audit 成立 |
| F3 | workspace / todo / confirmation durable truth | 新增 todos、temp files、confirmations、artifact provenance | ✅ HP5/HP6 的 control plane 有 queryable truth |
| F4 | product checkpoint durable truth | 新增 checkpoint / file snapshot / restore job / cleanup job | ✅ HP4/HP7 不需要额外补 migration |
| F5 | schema freeze 与 correction law | 用 `007-013` 和 `HP1 schema correction` 规则冻结迁移边界 | ✅ HP2-HP10 有明确 DDL 法律 |

### 7.1.1 `007-013` migration ledger（与 charter 对齐的冻结映射）

| Migration | 文件名 | 冻结职责 |
|-----------|--------|----------|
| 007 | `migrations/007-model-metadata-and-aliases.sql` | `nano_models` 10 个 metadata 列 + `nano_model_aliases` + model/alias seed 回填 |
| 008 | `migrations/008-session-model-audit.sql` | `nano_conversation_sessions.default_*` + `nano_conversation_turns.requested/effective/fallback_*` |
| 009 | `migrations/009-turn-attempt-and-message-supersede.sql` | `turn_attempt`、`UNIQUE(session_uuid, turn_index, turn_attempt)` rebuild、message supersede、conversation tombstone |
| 010 | `migrations/010-agentic-loop-todos.sql` | `nano_session_todos` |
| 011 | `migrations/011-session-temp-files-and-provenance.sql` | `nano_session_temp_files` + `nano_session_files` provenance columns |
| 012 | `migrations/012-session-confirmations.sql` | `nano_session_confirmations` |
| 013 | `migrations/013-product-checkpoints.sql` | `nano_session_checkpoints` + `nano_checkpoint_file_snapshots` + `nano_checkpoint_restore_jobs` + `nano_workspace_cleanup_jobs` |

这张 ledger 是 HP1 的 design-time freeze map：后续 HP2-HP10 若需要核对“某个 durable truth 是否已经在 HP1 DDL Freeze Gate 内”，一律先以此表为准，而不是靠 action-plan 或提交记录反推。

### 7.2 详细阐述

#### F1: 模型 metadata 与 alias 扩展

- **输入**：现有 `nano_models` 与 runtime `ModelCapabilities`
- **输出**：可支撑 HP2/HP3 的 richer D1 model truth
- **主要调用者**：`GET /models`、future `GET /models/{id}`、HP2 fallback、HP3 compact policy
- **核心逻辑**：把 `max_output_tokens`、`effective_context_pct`、`auto_compact_token_limit`、`supported_reasoning_levels`、`input_modalities`、`provider_key`、`fallback_model_id`、`base_instructions_suffix`、`description`、`sort_priority` 落入 D1，并用 alias 表表达 `/@alias/*`
- **边界情况**：
  - JSON 列必须由应用层严校验
  - 不冻结模型总数，只冻结字段结构
- **一句话收口目标**：✅ **D1 model truth 足够支撑 HP2/HP3，而不再只有 list-page 粗字段**。

#### F2: 聊天 durable truth 扩展

- **输入**：现有 `nano_conversation_sessions` / `turns` / `messages` / `conversations`
- **输出**：可支撑 retry、delete、session default model、turn effective model 的 durable truth
- **主要调用者**：HP2、HP4、HP7
- **核心逻辑**：在 session / turn 表补 model audit；把 `turn_index` 唯一约束改为 `(session_uuid, turn_index, turn_attempt)`；message 增 supersede 列；conversation 增 tombstone
- **边界情况**：
  - UNIQUE rebuild 必须保守处理
  - tombstone 不应破坏 audit / activity log
- **一句话收口目标**：✅ **HP2/HP4 的 durable audit、retry、soft delete 都有结构化落点**。

#### F3: workspace / todo / confirmation durable truth

- **输入**：workspace temp file、artifact promotion、tool permission/elicitation 等后续需求
- **输出**：todo、temp file、confirmation、provenance 的 D1 主真相
- **主要调用者**：HP5、HP6、HP9
- **核心逻辑**：新增 `nano_session_todos`、`nano_session_temp_files`、`nano_session_confirmations`；给 `nano_session_files` 增 provenance columns。字段冻结必须直接等同 charter，而不是由后续 phase 各自再补“更顺手”的列：
  - `nano_session_todos`
    - `todo_uuid`
    - `session_uuid`
    - `conversation_uuid`
    - `team_uuid`
    - `parent_todo_uuid`
    - `content`
    - `status` (`pending | in_progress | completed | cancelled | blocked`)
    - `created_at`
    - `updated_at`
    - `completed_at`
  - `nano_session_temp_files`
    - `temp_file_uuid`
    - `session_uuid`
    - `team_uuid`
    - `virtual_path`
    - `r2_object_key`
    - `mime`
    - `size_bytes`
    - `content_hash`
    - `last_modified_at`
    - `written_by` (`user | agent | tool`)
    - `created_at`
    - `expires_at`
    - `cleanup_status` (`pending | scheduled | done`)
    - `UNIQUE(session_uuid, virtual_path)`
  - `nano_session_confirmations`
    - `confirmation_uuid`
    - `session_uuid`
    - `kind` (`tool_permission | elicitation | model_switch | context_compact | fallback_model | checkpoint_restore | context_loss`)
    - `payload_json`
    - `status` (`pending | allowed | denied | modified | timeout | superseded`)
    - `decision_payload_json`
    - `created_at`
    - `decided_at`
    - `expires_at`
  - `nano_session_files` provenance columns
    - `provenance_kind` (`user_upload | agent_generated | workspace_promoted | compact_summary | checkpoint_restored`)
    - `source_workspace_path`
    - `source_session_uuid`
- **边界情况**：
  - temp file 与 artifact 不能混表
  - HP6/HP7 若需要 `title`、`details_json`、`sort_index`、自定义 cleanup terminal enum 等 read-model 便利字段，只能放到 API projection / payload 规范，不能反向污染 HP1 DDL freeze
- **一句话收口目标**：✅ **HP5/HP6 的控制面不再依赖 DO memory 或 ad-hoc KV**。

#### F4: product checkpoint durable truth

- **输入**：HP4 conversation-only restore、HP7 files-only / fork / cleanup
- **输出**：checkpoint list / snapshot / restore / cleanup 的全套 durable truth
- **主要调用者**：HP4、HP7、final closure
- **核心逻辑**：新增 `nano_session_checkpoints`、`nano_checkpoint_file_snapshots`、`nano_checkpoint_restore_jobs`、`nano_workspace_cleanup_jobs`。字段冻结同样直接以 charter 为准：
  - `nano_session_checkpoints`
    - `checkpoint_uuid`
    - `session_uuid`
    - `conversation_uuid`
    - `team_uuid`
    - `turn_uuid`
    - `turn_attempt`
    - `checkpoint_kind` (`turn_end | user_named | compact_boundary | system`)
    - `label`
    - `message_high_watermark`
    - `latest_event_seq`
    - `context_snapshot_uuid`
    - `file_snapshot_status` (`none | pending | materialized | failed`)
    - `created_by` (`user | system | compact | turn_end`)
    - `created_at`
    - `expires_at`
  - `nano_checkpoint_file_snapshots`
    - `snapshot_uuid`
    - `checkpoint_uuid`
    - `session_uuid`
    - `team_uuid`
    - `source_temp_file_uuid`
    - `source_artifact_file_uuid`
    - `source_r2_key`
    - `snapshot_r2_key`
    - `virtual_path`
    - `size_bytes`
    - `content_hash`
    - `snapshot_status` (`pending | materialized | copied_to_fork | failed`)
    - `created_at`
  - `nano_checkpoint_restore_jobs`
    - `job_uuid`
    - `checkpoint_uuid`
    - `session_uuid`
    - `mode` (`conversation_only | files_only | conversation_and_files | fork`)
    - `target_session_uuid`
    - `status` (`pending | running | succeeded | partial | failed | rolled_back`)
    - `confirmation_uuid`
    - `started_at`
    - `completed_at`
    - `failure_reason`
  - `nano_workspace_cleanup_jobs`
    - `job_uuid`
    - `session_uuid`
    - `team_uuid`
    - `scope` (`session_end | explicit | checkpoint_ttl`)
    - `target_count`
    - `deleted_count`
    - `status` (`pending | running | done | failed`)
    - `scheduled_at`
    - `started_at`
    - `completed_at`
- **边界情况**：
  - lazy snapshot 必须可表达 `pending/materialized/failed`
  - restore 失败必须能回写 `rolled_back` / `failure_reason`
  - `rollback baseline` 在 DDL 上不单独占 enum；它应表达为 `checkpoint_kind = system` + 明确 label / lineage，而不是另起 `rollback_baseline` 枚举
  - HP3 的 `/context/compact/jobs/{id}` 第一版复用 `compact_boundary` checkpoint handle，不新增 `nano_compact_jobs` 表
- **一句话收口目标**：✅ **HP4/HP7 的 checkpoint / restore / fork 在 HP1 就具备完整 durable footing**。

#### F5: schema freeze 与 correction law

- **输入**：hero-to-pro 全阶段 DDL 需求
- **输出**：`007-013` 迁移编排与 correction 例外机制
- **主要调用者**：HP2-HP10、HP9 prod baseline
- **核心逻辑**：先按 7 个主题 migration 拆分；若后续真漏 schema，只能作为 `HP1 schema correction` 进入 `014+`
- **边界情况**：
  - correction 不是普通“补一张表”，必须修 charter + schema doc
- **一句话收口目标**：✅ **HP2-HP10 默认不再以“临时补 migration”作为正常路径**。

### 7.3 非功能性要求与验证策略

- **性能目标**：migration 拆分后可局部 review 与 local apply；避免单文件过大
- **可观测性要求**：每张新表都有明确索引、用途和 downstream consumer
- **稳定性要求**：现有 `001-006` 不重写，只在 `007-013` 增量表达 hero-to-pro truth
- **安全 / 权限要求**：所有涉及 team/session 的新表都带 tenant 维度或可回溯的 FK / provenance
- **测试覆盖要求**：schema-mismatch test、migration local apply、HP4/HP7 sanity check、索引存在性检查
- **验证策略**：以 migration 级 review + schema 文档对照 HP2-HP7 的 consumer matrix 进行验证；任何 phase 若发现 blocker，必须走 `HP1 schema correction` 流程

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次没有直接采用 mini-agent 源码作为 schema precedent | HP1 主要依赖当前仓库 D1 baseline；若出现 `context/*`，仅作 external ancestry pointer | 不再通过二手 study 转述 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/codex/codex-rs/protocol/src/openai_models.rs:248-299` | `ModelInfo` 同时表达 reasoning、base instructions、truncation、parallel tools、context window、auto compact、input modalities | 支持 HP1 把 `nano_models` 从粗目录升级为能支撑 runtime 的 richer metadata | HP1 不全量照抄，只冻结当前 phase 真需要的字段 |

### 8.3 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/services/chatRecordingTypes.ts:92-140` | `ConversationRecord` / `RewindRecord` / `MetadataUpdateRecord` 等 durable record shape | 说明聊天记录、rewind marker、metadata update 都应有明确结构化真相 | nano-agent 不照抄 JSONL，但借鉴“结构化 durable record”原则 |
| `context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-470,510-532,799-818` | JSONL transcript、`$set` metadata、`$rewindTo` rewind marker | 说明聊天持久化与 rewind 不是纯内存行为 | HP1 对应 session/checkpoint/restore durable truth |
| `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:15-24,84-157` | checkpoint 文件包含 `history`、`clientHistory`、`commitHash`、`toolCall`、`messageId` | 说明 restore 要有足够 durable 输入，而不是临时拼凑 | HP1 对应 checkpoint / restore job / file snapshot |
| `context/gemini-cli/packages/cli/src/ui/commands/restoreCommand.ts:43-123` | `/restore` 列表、读 checkpoint、load history | 说明 restore 是产品面，不是隐形 debug helper | 具体 UI 不照抄 |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-168` | 当前 conversation/session/turn/message/context snapshot 基线 | HP1 在此基础上增量扩展，而不是重写旧 baseline |
| `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:56-128` | 当前 `nano_models` 表与 seed | HP1 明确在此表扩列，并避免另起第二套模型真相 |
| `workers/orchestrator-core/migrations/004-session-files.sql:6-27` | 当前 artifact truth 仅有 `nano_session_files` | 说明 temp file / provenance 不能继续硬塞进旧表 |
| `workers/orchestrator-core/migrations/006-error-and-audit-log.sql:22-103` | 当前 error / audit 表遵守 queryable truth + index 规则 | HP1 新表继续遵守相同风格 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP1-D1` | hero-to-pro 新 migration 是否固定为 `007-013` 七个文件？ | HP1 / HP9 | 是，按主题拆分；不再保留旧 `008/009-016` 口径 | `pending-HPX-qna` | `docs/charter/plan-hero-to-pro.md:466-474`, `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-168`, `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:17-89,56-129`, `workers/orchestrator-core/migrations/004-session-files.sql:6-27`, `workers/orchestrator-core/migrations/006-error-and-audit-log.sql:22-103` |
| `HP1-D2` | checkpoint / file snapshot / restore job 是否必须在 HP1 一次性落表？ | HP1 / HP4 / HP7 | 必须，否则后续 phase 会破戒 | `pending-HPX-qna` | `docs/charter/plan-hero-to-pro.md:443-449,491-504`, `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:86-105`, `workers/orchestrator-core/migrations/004-session-files.sql:6-27` |
| `HP1-D3` | 若 HP3-HP7 发现 schema blocker，是否允许直接新增 migration？ | HP1 / HP3-HP10 | 不允许；必须走 `HP1 schema correction` | `pending-HPX-qna` | `docs/charter/plan-hero-to-pro.md:499-504`, `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:41-62`, `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql:56-86`, `workers/orchestrator-core/migrations/004-session-files.sql:6-27` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. `007-013` 各 migration 的职责边界无冲突。
2. HP2/HP4/HP5/HP6/HP7 对 schema 的消费关系已能逐项映射到表/列。
3. temp file / artifact / checkpoint snapshot / cleanup lineage 的 durable truth 分层已写清。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP1-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP2-model-state-machine.md`
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
  - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
- **需要进入 QNA register 的问题**：
  - `none（本批次先在设计内冻结，后续统一汇总）`

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

HP1 会以 **7 个 migration + 1 份 schema 文档 + correction law** 的形式存在，覆盖 model metadata、聊天 durable truth、workspace durable truth、confirmation durable truth、checkpoint durable truth。它与所有后续 phase 强耦合，因为 HP2-HP7 的业务逻辑几乎都建立在这些表/列之上。这个功能簇的复杂度来自“需要一次冻结未来 7 个 phase 的 durable truth”，而不是单一功能点本身。设计质量直接决定后续是否会再次出现 schema drift。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | `5` | 没有 durable truth 冻结，hero-to-pro 不可能成为产品基线 |
| 第一版实现的性价比 | `4` | review 成本高，但能换来后续 phase 的稳定执行 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | `5` | checkpoint / workspace / model control plane 都直接受益 |
| 对开发者自己的日用友好度 | `4` | 初始工作重，但大幅减少后续“临时补表”的混乱 |
| 风险可控程度 | `4` | 主要风险来自遗漏与 SQLite rebuild，但通过拆 migration 可控 |
| **综合价值** | `5` | 是 hero-to-pro 最重要的前置基石之一 |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：checkpoint 是否可以先用现有 context snapshot 表顶着
  - **A 方观点**：先跑通 conversation-only restore，后面再补表
  - **B 方观点**：这会把 HP7 推入必然破戒状态
  - **最终共识**：HP1 一次性落 checkpoint 三表与 cleanup lineage

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-30` | `GPT-5.4` | 初稿 |
| v0.2 | `2026-04-30` | `GPT-5.4` | precedent 与 QNA 来源改为 `context/` / 当前仓库源码锚点 |
