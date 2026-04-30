# Nano-Agent 设计文档审查：`docs/design/hero-to-pro/` 全量

> 审查对象: `docs/design/hero-to-pro/HP0-HP10 + HPX-qna (12 份设计文件)`
> 审查类型: `docs-review | schema-alignment-review | cross-reference-review`
> 审查时间: `2026-04-30`
> 审查人: `DeepSeek`
> 审查范围:
> - `docs/design/hero-to-pro/HP0-pre-defer-fixes.md`
> - `docs/design/hero-to-pro/HP1-schema-extension.md`
> - `docs/design/hero-to-pro/HP2-model-state-machine.md`
> - `docs/design/hero-to-pro/HP3-context-state-machine.md`
> - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
> - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
> - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
> - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
> - `docs/design/hero-to-pro/HP8-runtime-hardening-and-chronic-closure.md`
> - `docs/design/hero-to-pro/HP9-api-docs-and-manual-evidence.md`
> - `docs/design/hero-to-pro/HP10-final-closure-and-cleanup.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md` (phase charter, 唯一权威基线)
> - 当前仓库源码 (`workers/`, `packages/`, `test/cross-e2e/`, `migrations/`)
> - `docs/charter/review/plan-hero-to-pro-reviewed-by-GPT.md` (charter 审查, R1-R9 已修订)
> 文档状态: `changes-requested`

---

## 0. 总结结论

> **整体判断**: 12 份设计文件的 phase 边界划分、方法论继承、In-Scope/Out-of-Scope 判定基本正确，4 套产品状态机的骨架设计方向成立。但存在 **一类系统性致命缺陷 + 四类跨文档 schema 不一致 + 一类无验证 precedents + 多处条件盲点**，当前不可直接进入 action-plan 制作。

- **整体判断**: `设计方向成立，但存在 charter-design 合同级不一致，不可直接解冻 action-plan`
- **结论等级**: `changes-requested`
- **是否允许关闭本轮 review**: `no`
- **本轮最关键的 1-3 个判断**:
  1. **12 份设计文档的全部 `context/codex/`、`context/claude-code/`、`context/gemini-cli/` 外部 precedent 引用均指向当前仓库中不存在的文件** — 所有第 4 节"参考实现/历史 precedent 对比"与第 8 节"可借鉴的代码位置清单"中的外部锚点均无法验证，设计文档的证据基础存在系统性断层。
  2. **HP5 confirmation kind 7 类枚举在 charter 与 HP5 设计文档中存在根本性冲突** — charter 定义的 `kind` 集合与 HP5 设计冻结的 7 kind 有 4 个不重叠，这会导致 DDL schema 与业务代码产生合同级漂移。
  3. **HP6/HP7 的三张核心表（`nano_session_todos`、`nano_session_temp_files`、`nano_session_checkpoints`）的字段定义在 charter 与对应设计文档之间存在显著不一致** — 字段名、字段集、枚举值均有差异，若不统一，action-plan 会因不知道该按哪份定义施工而陷入停滞。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。

- **对照文档**:
  - `docs/charter/plan-hero-to-pro.md` (全文 1331 行，唯一权威基线)
  - `docs/charter/review/plan-hero-to-pro-reviewed-by-GPT.md` (GPT 对 charter 的 R1-R9 审查，charter r1 已修订)
- **核查实现**:
  - 12 份设计文件全文 (`docs/design/hero-to-pro/HP*.md` + `HPX-qna.md`)
  - 当前仓库代码 (`workers/orchestrator-core/migrations/`, `workers/agent-core/wrangler.jsonc`, `workers/context-core/src/index.ts`, `workers/agent-core/src/hooks/permission.ts`, `workers/agent-core/src/host/do/session-do-runtime.ts`, `packages/nacp-session/src/messages.ts`, `test/cross-e2e/`)
- **执行过的验证**:
  - `glob context/*` — 验证 `context/` 目录是否存在
  - `ls workers/orchestrator-core/migrations/` — 验证当前 migration 基线编号
  - `glob test/cross-e2e/1[5-8]*` — 验证 F13 round-trip e2e 文件是否存在
  - 逐字段比对 charter §7.2 schema 定义与各 HP 设计文档的功能详细列表
- **复用 / 对照的既有审查**:
  - `docs/charter/review/plan-hero-to-pro-reviewed-by-GPT.md` — 独立复核了 GPT 审查中关于 migration 编号基线、CONTEXT_CORE binding 状态、cross-e2e 文件缺失的结论，全部属实。

### 1.1 已确认的正面事实

- **HP0-HP10 的 phase 边界划分与 charter §6-§7 完全对齐**。每个 phase 的 In-Scope/Out-of-Scope 判定与 charter 一致，phase 之间依赖关系正确。
- **HP0 设计正确区分了"立即修复"、"verify-only"、"later-cleanup"三类边界**。特别是对 R29-dependent residue 的"HP0 不删，留 HP8-B/HP10 决议"纪律与 charter R3 修订一致。
- **HP1 设计文档中的 007-013 migration ledger 与 charter §7.2 的 7 个 migration 文件列表一致**。migration 编号从 007 起与当前仓库 001-006 基线衔接正确。
- **HP3/HP4 对 HP1 尚未落地时的条件处理已在 HPX-qna Q37/Q38 中登记**，虽然 owner 尚未回答，但问题本身已归档。
- **HP8 design 正确更新了 megafile gate 的目标文件**：不再盯 `nano-session-do.ts` / `user-do.ts`（已退化为 wrapper），改盯当前真实 owner 文件（`index.ts`、`user-do-runtime.ts`、`session-do-runtime.ts`），与仓库现状一致。
- **`clients/api-docs/` 当前确有 11 份文档（非 charter v0.draft 误计的 10 份）**，HP9 设计文档正确承认为 11+7=18。
- **所有设计文档的"文档状态"字段均已标 `reviewed`**，说明 GPT-5.4 认为部分审查已完成。但本轮发现的大量不一致说明这些审查未覆盖 charter-design 交叉验证。

### 1.2 已确认的负面事实

- **`context/` 目录在当前仓库中完全不存在**。`glob context/*` 返回零结果。这意味着所有 12 份设计文件中引用的外部 precedent（`context/codex/...`、`context/claude-code/...`、`context/gemini-cli/...`）**在当前工作环境中均不可独立验证**。虽然 charter §0 将这些文件标注为"ancestry-only / 背景参考(不作为直接入口)"，但设计文档将其用作第 4 节 precedent 对比和第 8 节代码位置借鉴清单的核心证据，其可验证性对于设计审查至关重要。
- **`test/cross-e2e/` 中文件 15-18 不存在**。当前仅有 01-14 + `zx2-transport.test.mjs` 共 15 个文件。HP5 设计文档承诺的 4 个 round-trip e2e 文件（15-permission-roundtrip-allow, 16-permission-roundtrip-deny, 17-elicitation-roundtrip, 18-usage-push-live）尚未创建，这在当前阶段属于正常（HP5 尚未执行），但 charter 将此列为 F13 慢性四阶段的终结条件（§9.4）。
- **HPX-qna.md 中 Q1-Q39 的"业主回答"栏全部为空**。设计文档将其作为"待回答"问题寄存，用户已明确指示本轮不将"QNA 回答为空"登记为问题。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 已验证关键仓库源码文件（migrations、wrangler、context-core、cross-e2e、permission 等） |
| 本地命令 / 测试 | yes | `glob` 验证 context/ 不存在、cross-e2e/15-18 不存在；`ls` 验证 migration 基线 |
| schema / contract 反向校验 | yes | 逐字段对比 charter §7.2 schema 定义与各 HP 设计文档的功能详细列表 |
| live / deploy / preview 证据 | n/a | 本轮为设计文档审查，不涉及 live/deploy 验证 |
| 与上游设计 / QNA 对账 | yes | 以 charter 为唯一权威基线对账所有 12 份设计文档 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | 全部外部 precedent 引用 (`context/codex/`, `context/claude-code/`, `context/gemini-cli/`) 在当前仓库中无对应文件 | critical | scope-drift | yes | 补充 vendored context 文件或删除所有不可验证的外部锚点引用 |
| R2 | HP5 confirmation kind 7 类枚举在 charter 与 HP5 设计文档之间存在根本冲突 | critical | correctness | yes | 统一到一份 authoritative definition，并回修 charter 或 HP5 设计文档 |
| R3 | `nano_session_todos` 字段定义在 charter 与 HP6 设计文档之间不一致 | high | correctness | yes | 以 charter 为准统一字段名和枚举值 |
| R4 | `nano_session_temp_files` 字段定义在 charter 与 HP6 设计文档之间不一致 | high | correctness | yes | 以 charter 为准统一字段集 |
| R5 | `nano_session_checkpoints` 的 `checkpoint_kind` 枚举值在 charter 与 HP7 设计文档之间不一致 | high | correctness | yes | 统一 `checkpoint_kind` 枚举，消除 `system` vs `rollback_baseline` 歧义 |
| R6 | `nano_checkpoint_file_snapshots` 和 `nano_checkpoint_restore_jobs` 的字段结构与 charter 有差异 | high | correctness | yes | HP7 设计文档的字段定义需与 charter §7.2 对齐 |
| R7 | HP3/HP4 设计文档中存在对 HP1 schema 未落地的条件性回退路径 | medium | delivery-gap | no | HPX-qna Q37/Q38 已登记，但需在 action-plan 制作前获得 owner 明确回答 |
| R8 | HP9 设计文档的文档编号清单中 README 计入现有 11 份但自身也需更新 | low | docs-gap | no | 在 HP9 action-plan 中明确 README 的更新归属 |

### R1. 全部外部 precedent 引用 (`context/`) 在当前仓库中无对应文件

- **严重级别**: `critical`
- **类型**: `scope-drift`
- **是否 blocker**: `yes`
- **事实依据**:
  - `glob context/*` 在当前仓库 `/workspace/repo/nano-agent/` 返回零结果。`context/` 目录完全不存在。
  - 12 份设计文档中大量引用这些不存在的文件，例如：
    - HP2 设计: `context/codex/codex-rs/protocol/src/openai_models.rs:248-299`、`context/codex/codex-rs/protocol/src/models.rs:471-474`、`context/codex/codex-rs/core/src/codex.rs:3954-3961`、`context/claude-code/utils/model/model.ts:49-98`、`context/gemini-cli/packages/core/src/config/config.ts:1872-1898` 等
    - HP3 设计: `context/codex/codex-rs/core/src/codex.rs:3948-3985`、`context/claude-code/services/compact/sessionMemoryCompact.ts:45-61`、`context/gemini-cli/packages/core/src/context/contextCompressionService.ts:50-59` 等
    - HP5 设计: `context/claude-code/server/directConnectManager.ts:81-99`、`context/gemini-cli/packages/core/src/confirmation-bus/types.ts:18-79` 等
    - HP6/HP7 设计中类似引用同样存在。
  - 所有设计文档的第 4 节"参考实现/历史 precedent 对比"和第 8 节"可借鉴的代码位置清单"中的外部 precedent 均依赖这些文件。
- **为什么重要**:
  - 设计文档声称的"从 Codex/Claude/Gemini 真实源码中借鉴的设计决策"无法被任何审查者独立验证。
  - 如果这些行号引用是不准确的（由 LLM 在生成设计文档时虚构），则基于这些 precedent 做出的设计选择（如 strip-then-recover contract、lazy snapshot、confirmation bus 等）缺乏独立证据支撑。
  - 这直接影响 QNA 决策表中标注 `frozen` 的多个决策（如 HP2-D3 `<model_switch>` 冻结、HP3-D1 context prompt owner 位置、HP5-D1 统一 control plane），因为这些决策的"答复来源"列大多引用了 `context/` 文件。
- **审查判断**:
  - 这不是设计文档本身的方向性错误，而是**证据可验证性的系统性缺陷**。charter 将这些 context/ 文件标注为"ancestry-only"是对的，但设计文档在将其作为第 4/8 节核心证据时，没有注明这些文件当前不在仓库中。
  - 有两种可能的解释：(1) context/ 文件是外部仓库（Codex/Claude/Gemini 的开源代码），在设计时被单独 clone 到本地参考，但未提交到本仓库；(2) 部分引用是 LLM 在设计文档生成时虚构的。无论哪种情况，都需要明确处理。
- **建议修法**:
  - 如果 context/ 源文件真实存在且可获取: 将三个 agent 的关键 precedent 源文件 vendored 到本仓库的 `context/` 目录下。
  - 如果 context/ 源文件无法获取: 删除所有设计文档中指向不存在文件的精确行号引用，替换为"已从 Codex/Claude/Gemini 公开源码中确认，当前版本未 vendored"的说明。
  - 如果在审查阶段无法验证: 设计文档的 QNA 决策表中 `${frozen}` 状态应降级为 `frozen-pending-context-verification`，在 context/ 文件就位后重新确认。

### R2. HP5 confirmation kind 7 类枚举在 charter 与 HP5 设计文档之间存在根本冲突

- **严重级别**: `critical`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - **Charter §7.2 HP1 In-Scope 第 4 项** (DDL schema 定义):
    > `kind[tool_permission/elicitation/model_switch/context_compact/fallback_model/checkpoint_restore/context_loss]`
    - Charter 定义的 7 类: (1) `tool_permission` (2) `elicitation` (3) `model_switch` (4) `context_compact` (5) `fallback_model` (6) `checkpoint_restore` (7) `context_loss`
  - **HP5 设计文档 §7.2 F5** (7-kind freeze):
    > 第一版统一冻结 7 个 kind：
    > 1. `permission` 2. `elicitation` 3. `compact_execute` 4. `checkpoint_restore` 5. `conversation_delete` 6. `workspace_cleanup` 7. `tool_cancel`
  - **共同项**: `permission`/`tool_permission` (可视为等价), `elicitation`, `checkpoint_restore` = 3 项
  - **Charter 独有项** (4 项): `model_switch`, `context_compact`, `fallback_model`, `context_loss`
  - **HP5 独有项** (4 项): `compact_execute`, `conversation_delete`, `workspace_cleanup`, `tool_cancel`
  - 两份文件的总交集仅 3/7，差异达 4/7。
- **为什么重要**:
  - HP1 的 DDL migration 012 (`nano_session_confirmations`) 的 `kind` 列将按 charter 定义创建。如果 HP5 业务代码使用设计文档定义的 kind 值（如 `compact_execute`、`conversation_delete`），将与 DDL schema 不匹配。
  - HP5 设计文档 §6.1 取舍 3 明确要求"兼容层保留旧 endpoint/frame"，但如果新旧 kind 值完全不同，兼容层也无法工作。
  - 这会让 HP5 的 action-plan 在第一个实现步骤就陷入"该按哪份文档写 SQL/business logic"的困境。
- **审查判断**:
  - Charter 的 kind 定义偏 "LLM 内部状态事件" (`model_switch`, `context_compact`, `fallback_model`, `context_loss`)。HP5 设计文档的 kind 定义偏 "用户可见高风险动作" (`compact_execute`, `conversation_delete`, `workspace_cleanup`, `tool_cancel`)。
  - 两种视角都有道理，但必须在 **同一份文档中被统一裁定**。当前两份文档各自冻结不同的集合，构成合同级冲突。
- **建议修法**:
  - 方案 A (推荐): 合并两份集合，将 charter 的 7 种 + HP5 的 7 种合并去重为一个更大的 kind 枚举（约 11 种），并修订 charter §7.2 + HP5 §7.2 F5 + HP1 migration 012 schema。
  - 方案 B: 以其中一份为权威（建议以 charter 为准，因为它是 DDL schema 的权威来源），修订另一份。HP5 设计文档中独有的 kind（`conversation_delete`, `workspace_cleanup`, `tool_cancel`）应通过 HPX-qna 提案新增。
  - **无论哪种方案，必须在 HP1 action-plan 启动前完成决议**，否则 migration 012 的 `kind` 枚举会冻结错误的集合。

### R3. `nano_session_todos` 字段定义在 charter 与 HP6 设计文档之间不一致

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - **Charter §7.2 HP1 In-Scope 第 3 项** (DDL schema):
    > `nano_session_todos (todo_uuid PK, session_uuid FK, conversation_uuid FK, team_uuid, parent_todo_uuid, content, status[pending/in_progress/completed/cancelled/blocked], created_at, updated_at, completed_at)`
  - **HP6 设计文档 §7.2 F1** (todo durable registry 最小字段):
    > `todo_uuid, session_uuid, team_uuid, title, details_json, status(pending | in_progress | completed), sort_index, source_request_uuid, created_at, updated_at, deleted_at`
  - 对比差异:
    | 维度 | Charter | HP6 Design | 冲突 |
    |------|---------|------------|------|
    | 内容字段 | `content` (单字段) | `title` + `details_json` (双字段) | **是** |
    | 状态枚举 | `pending/in_progress/completed/cancelled/blocked` (5 值) | `pending/in_progress/completed` (3 值) | **是** |
    | FK | `conversation_uuid FK` | 未列出 | 缺失 |
    | V2 预留 | `parent_todo_uuid` (charter 明确) | 未列出 | 缺失 |
    | 排序 | 未指定 | `sort_index` | **新增** |
    | 审计 | `completed_at` | `deleted_at` | **不同** |
    | 来源 | 未指定 | `source_request_uuid` | **新增** |
- **为什么重要**:
  - HP1 的 migration 010 (`nano_session_todos`) 将按 charter 定义创建表结构。如果 HP6 业务代码期望 `title`/`details_json`/`sort_index` 等字段但表中没有，会发生运行时错误。
  - 状态枚举差异更严重：charter 包含 `cancelled` 和 `blocked`，HP6 设计只认 3 种状态。HP6 action-plan 将无法正确引用所有可能的状态值。
- **审查判断**:
  - HP6 设计文档的字段定义比 charter 更详细和实用（增加 `sort_index`、`source_request_uuid`、`deleted_at` 用于软删除是合理的设计选择），但这些新增字段必须先在 charter §7.2 中登记，才能在迁移中落地。
  - 将 `content` 拆分为 `title` + `details_json` 是合理的设计选择（更结构化），但必须在 charter 中统一。
- **建议修法**:
  - 修订 charter §7.2 HP1 In-Scope 第 3 项，将 HP6 设计文档的字段定义合并到 charter 的 schema 定义中（包括新增 `title`/`details_json`/`sort_index`/`source_request_uuid`/`deleted_at`，合并状态枚举为 5 值含 `cancelled`/`blocked`）。
  - 或者（如果 charter 已冻结不可改），将 HP6 设计文档的字段定义严格对齐为 charter 的字段集。

### R4. `nano_session_temp_files` 字段定义在 charter 与 HP6 设计文档之间不一致

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - **Charter §7.2 HP1 In-Scope 第 3 项** (DDL schema, R7 修订版):
    > `nano_session_temp_files (temp_file_uuid PK, session_uuid FK, team_uuid, virtual_path, r2_object_key, mime, size_bytes, content_hash, last_modified_at, written_by[user/agent/tool], created_at, expires_at, cleanup_status[pending/scheduled/done], UNIQUE(session_uuid, virtual_path))`
  - **HP6 设计文档 §7.2 F2** (workspace temp file 最小字段):
    > `temp_file_uuid, session_uuid, team_uuid, virtual_path, r2_key, content_hash, size_bytes, mime, created_at, updated_at, expires_at, cleanup_status(pending | retained_with_reason | deleted | failed)`
  - 对比差异:
    | 维度 | Charter | HP6 Design | 冲突 |
    |------|---------|------------|------|
    | 对象 key | `r2_object_key` | `r2_key` | 命名不一致 |
    | 修改时间 | `last_modified_at` | `updated_at` | 命名不一致 |
    | 写入者 | `written_by[user/agent/tool]` | 未列出 | **缺失关键字段** |
    | cleanup 状态 | `pending/scheduled/done` (3 值) | `pending/retained_with_reason/deleted/failed` (4 值) | **是** |
- **为什么重要**:
  - `written_by` 是 R7 retention/provenance 的关键审计字段，若 HP6 业务代码不写此字段，后续 provenance/audit 无法追踪文件来源。
  - `cleanup_status` 的状态值不同意味着 HP6 的 cleanup job 逻辑将使用不被 DDL schema 支持的枚举值。
  - `r2_object_key` vs `r2_key` 的命名不一致会导致 migration SQL 与业务代码使用不同的列名。
- **审查判断**:
  - Charter 的 R7 修订已经包含了 `written_by`、`expires_at`、`cleanup_status` 三个 retention 必需字段，HP6 设计文档不应遗漏 `written_by`。
  - HP6 设计文档的 `cleanup_status` 枚举更实用（增加了 `retained_with_reason` 和 `failed` 状态），但必须先在 charter 中登记。
- **建议修法**:
  - 修订 charter §7.2 或 HP6 设计文档 §7.2 F2，使字段名和枚举值在两份文件中完全一致。建议以 charter 为基线，将 HP6 设计文档中有价值的补充（`retained_with_reason`、`failed` 状态）反向合并到 charter。

### R5. `nano_session_checkpoints` 的 `checkpoint_kind` 枚举在 charter 与 HP7 设计文档之间不一致

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - **Charter §7.2 HP1 In-Scope 第 5 项** (R1 修订):
    > `checkpoint_kind[turn_end/user_named/compact_boundary/system]`，另有 `created_by[user/system/compact/turn_end]`
  - **HP7 设计文档 §7.2 F1** (checkpoint registry 最小字段):
    > `checkpoint_kind (turn_end | user_named | compact_boundary | rollback_baseline)`
    - HP7 新增了 `rollback_baseline`，移除了 `system`。
    - HP7 的字段列表中没有 `created_by`。
- **为什么重要**:
  - HP1 migration 013 中的 `checkpoint_kind` CHECK 约束将只包含 charter 的 4 个值。HP7 若试图插入 `rollback_baseline`，会触发 D1 constraint violation。
  - `created_by` 是追溯 checkpoint 来源的审计字段，若 HP7 不写入，后续 audit 将不完整。
  - `rollback_baseline` 是 HP7 F3 "restore rollback" 功能的核心依赖（在 restore 前创建基线 checkpoint），但 migration 013 的 schema 不支持这个 kind，会导致 HP7 运行时失败。
- **审查判断**:
  - `rollback_baseline` 是一个合理的 checkpoint kind 扩展，但必须先在 charter §7.2 中登记，否则不能进入 HP1 migration 013。
  - 移除 `created_by` 可能会丢失 checkpoint 的创建来源信息（虽然其他字段如 `checkpoint_kind` 可部分推断）。
- **建议修法**:
  - 修订 charter §7.2 HP1 第 5 项，在 `checkpoint_kind` 中增加 `rollback_baseline`（变为 5 种枚举），并说明 `created_by` 在第一版中是否保留、保留的话由谁负责写入。

### R6. `nano_checkpoint_file_snapshots` 和 `nano_checkpoint_restore_jobs` 的字段结构与 charter 有差异

- **严重级别**: `high`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:

  **File Snapshots**:
  - **Charter §7.2 HP1 第 5 项**:
    > `snapshot_uuid PK, checkpoint_uuid FK, session_uuid FK, team_uuid, source_temp_file_uuid FK?, source_artifact_file_uuid FK?, source_r2_key, snapshot_r2_key, virtual_path, size_bytes, content_hash, snapshot_status[pending/materialized/copied_to_fork/failed], created_at`
  - **HP7 设计文档 §7.2 F1**:
    > `checkpoint_uuid, session_uuid, team_uuid, virtual_path, r2_key, content_hash, snapshot_status(pending | materialized | copied_to_fork | failed), created_at`
  - 差异: HP7 缺少 `snapshot_uuid`(PK)、`source_temp_file_uuid`、`source_artifact_file_uuid`、`source_r2_key`、`snapshot_r2_key`、`size_bytes`，使用 `r2_key` 代替 `snapshot_r2_key`。

  **Restore Jobs**:
  - **Charter §7.2 HP1 第 5 项**:
    > `job_uuid PK, checkpoint_uuid FK, session_uuid FK, mode[conversation_only/files_only/conversation_and_files/fork], target_session_uuid TEXT?, status[pending/running/succeeded/partial/failed/rolled_back], confirmation_uuid FK, started_at, completed_at, failure_reason TEXT`
  - **HP7 设计文档 §7.2 F3**:
    > `restore_job_uuid, session_uuid, team_uuid, checkpoint_uuid, mode, confirmation_uuid, rollback_checkpoint_uuid, status(pending_confirmation | running | completed | rolled_back | failed), failure_reason, created_at, finished_at`
  - 差异: HP7 缺少 `target_session_uuid`，增加了 `team_uuid`、`rollback_checkpoint_uuid`；状态枚举不同（`succeeded` vs `completed`，`pending` vs `pending_confirmation`）；字段命名不同（`job_uuid` vs `restore_job_uuid`，`started_at/completed_at` vs `created_at/finished_at`）。
- **为什么重要**:
  - 与 R3/R4/R5 同样的合同级冲突：HP1 migration 013 按 charter 创建表，HP7 业务代码按 HP7 设计文档写数据，两者不兼容。
- **审查判断**:
  - HP7 设计文档的字段细化（如增加 `rollback_checkpoint_uuid`、`team_uuid`）是合理的，但必须先回填到 charter。
  - 状态枚举中的 `pending_confirmation` vs `pending`、`completed` vs `succeeded` 需要用同一组词。
- **建议修法**:
  - 统一修订 charter §7.2 与 HP7 设计文档 §7.2 F1/F3，确保字段集、字段名、枚举值完全一致。建议保留 `rollback_checkpoint_uuid`（HP7 设计文档新增的有价值字段），统一字段命名风格（全部使用蛇形命名 `snake_case`）。

### R7. HP3/HP4 设计文档中存在对 HP1 schema 未落地的条件性回退路径

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - HP3 设计文档 §5.3 边界清单: "compact job 是否需要 durable D1 — in-scope — 若 HP1 schema 未落则补最小表"
  - HP3 设计文档 §9.3: "若 HP1 schema extension 在 HP3 启动前仍未落地，compact job 的最小 D1 表是否作为 HP3 collateral migration 一并落地" → HPX-qna Q37
  - HP4 设计文档 §9.3: "若 HP1 schema extension 尚未落地，delete tombstone / retry attempt / checkpoint registry / restore job 的最小 D1 字段集是否作为 HP4 collateral migration 一并处理" → HPX-qna Q38
- **为什么重要**:
  - Charter §4.4 硬纪律 1 (R8 修订) 规定: HP2-HP10 默认严禁加新 migration 文件，只允许在 HP1 已落表上写数据。但 HP3/HP4 设计文档中"若 HP1 未落则补最小表"的表述打开了违反该纪律的后门。
  - HPX-qna Q37/Q38 已在 HPX-qna 中登记为条件触发题，但如果 owner 在 HP3/HP4 启动时回答"允许 collateral migration"，则 charter 的 DDL Freeze Gate 会被破坏。
- **审查判断**:
  - 这不是设计文档的错误（设计文档只是记录了"如果执行顺序被打破该怎么办"的应急预案）。但如果 HP1 按计划先完成 closure 再启动 HP2/HP3/HP4，则这两个条件题永远不会触发。
  - 真正的问题是: HP3/HP4 设计文档在创建时，HP1 尚未执行，设计者需要为"worst case"留预案。但这份预案的正确性取决于 owner 在 HPX-qna 中的回答，而该回答当前为空。
- **建议修法**:
  - HP3/HP4 的 action-plan 制作应假设 HP1 已完成 closure（charter §8.1 推荐执行顺序要求 HP1 先 closure）。如果 action-plan 需要覆盖"HP1 未落地"场景，则 action-plan 应包含一个 gate-check 步骤：在 HP3/HP4 启动前验证 HP1 closure 状态，若不通过则终止执行并上报。
  - 在 HPX-qna Q37/Q38 获得 owner 回答前，不应将 collateral migration 视为默认备选路径写入 action-plan。

### R8. HP9 设计文档中 README 计入现有 11 份文档但自身在重组后也需要更新

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - HP9 设计文档 §7.2 F1: 现有 11 份包括 README 自身。
  - Charter §7.10: 现有 11 份 + 新增 7 份 = 18 份。
  - README 作为索引文件，在新增 7 份文档和重组 `session.md` 后也需要重写其索引部分，但 HP9 设计文档中 README 未被显式放入 rewrite 或 sanity-check 分类中。
- **为什么重要**:
  - README 的所有索引链接在文档包重组后必然过期。这是一个低风险的文档维护细节，不会影响 action-plan 的方向。
- **审查判断**:
  - 当前归类不影响 HP9 的整体交付，但 action-plan 中应明确 README 属于"自动跟随更新的文档"类别。
- **建议修法**:
  - 在 HP9 action-plan 中增加一条: "README: 在所有 18 份文档就位后做索引一致性更新"。

---

## 3. In-Scope 逐项对齐审核

> 以 charter §4.1 中定义的 11 项全局 In-Scope (I1-I11) 为对照基线，审核 12 份设计文档的覆盖度。

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|-----------------|----------|------|
| I1 | HP0 前置 defer 修复 | `done` | HP0 design 与 charter §7.1 对齐，R3 修订区分"仍需做/已完成需 verify/依赖 R29 后判定"三类边界正确 |
| I2 | HP1 DDL 集中扩展 | `partial` | HP1 design 的 migration ledger (007-013) 与 charter 一致，但 R2/R3/R4/R5/R6 发现的字段不一致意味着 charter 和 design doc 的 schema 定义存在合同级差异，需先统一 |
| I3 | HP2 Model 状态机 | `partial` | HP2 design 功能边界与 charter §7.3 对齐，但 R1 (context/ 不可验证) 影响 HP2 的 precedent 引用和 QNA 决策依据 |
| I4 | HP3 Context 状态机 | `partial` | HP3 design 与 charter §7.4 对齐，但 R7 (条件性 collateral migration 风险) 需在 action-plan 启动前关闭；R1 同样影响 |
| I5 | HP4 Chat 生命周期 | `partial` | HP4 design 与 charter §7.5 对齐，但 R7 (同样的条件性风险) 和 R1 存在 |
| I6 | HP5 Confirmation 收拢 + F12/F13 | `blocked` | **R2 (confirmation kind 冲突) 是 blocker**：HP5 design 的 7 kind 与 charter 的 7 kind 不同，HP1 migration 012 将按 charter 创建，HP5 业务代码无法使用设计文档定义的 kind。在 R2 解决前，HP5 不可进入 action-plan |
| I7 | HP6 Tool/Workspace 状态机 | `blocked` | **R3/R4 (todo/workspace temp file 字段不一致) + R1 是 blocker**：HP6 业务代码依赖的字段结构与 charter 定义的 DDL schema 不兼容，在统一前不可进入 action-plan |
| I8 | HP7 Checkpoint 全模式 revert | `blocked` | **R5/R6 (checkpoint/snapshot/restore_job 字段不一致) 是 blocker**：HP7 设计文档依赖的字段结构和枚举值与 charter 的 DDL 定义不兼容 |
| I9 | HP8 Runtime hardening + chronic 收口 | `done` | HP8 design 与 charter §7.9 对齐，megafile gate 目标已正确更新为当前真实 owner 文件，chronic issue register 分类正确 |
| I10 | HP9 `clients/api-docs/` + manual evidence | `done` | HP9 design 与 charter §7.10 对齐，18 份文档清单正确，设备矩阵、rewrite/sanity-check 分级合理 |
| I11 | HP10 Final closure | `done` | HP10 design 与 charter §7.11 对齐，closure register 分类 (deleted/retained-with-reason/handed-to-platform) 与 charter §10.4 收口类型判定表一致 |

### 3.1 对齐结论

- **done**: 4 (HP0, HP8, HP9, HP10)
- **partial**: 4 (HP1, HP2, HP3, HP4)
- **missing**: 0
- **blocked**: 3 (HP5, HP6, HP7)
- **stale**: 0
- **out-of-scope-by-design**: 0

> HP0/HP8/HP9/HP10 四个 phase 的设计文档可以直接引导 action-plan 制作。HP1 设计文档大部分正确但需要先与 charter 统一 schema 字段定义。HP2/HP3/HP4 受 context/ 不可验证问题影响但方向正确。**HP5/HP6/HP7 三个 phase 的设计文档因与 charter 存在 schema 级不一致，在当前状态下不能直接进入 action-plan 制作**。

---

## 4. Out-of-Scope 核查

> 本节检查设计文档是否越界，也确认 reviewer 是否误判。

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider LLM routing | `遵守` | 所有设计文档均未涉及 multi-provider，HP2 明确排除 |
| O2 | Sub-agent / multi-agent | `遵守` | 所有设计文档均未涉及，HP6 明确排除 todo V2 task graph |
| O3 | Admin plane / billing | `遵守` | 所有设计文档均未涉及 |
| O4 | SQLite-backed DO | `遵守` | 所有设计文档均未涉及 |
| O5 | 完整 SDK extraction | `遵守` | HP8 只做 tool catalog SSoT，不做 SDK 发布 |
| O6 | 完整 handler-granularity refactor | `遵守` | HP8 只做 stop-the-bleed gate，不做全面重构 |
| O7 | 每 phase 各自 migration | `遵守` | HP1 design 明确 DDL Freeze Gate 纪律，HP3/HP4 的条件路径已在 HPX-qna 中登记但不符合默认路径 |
| O8 | `clients/api-docs/` 每 phase 散打 | `遵守` | 所有 HP2-HP8 设计文档均未涉及 api-docs 更新，HP9 集中处理 |
| O9 | Multi-agent artifact store redesign | `遵守` | 不存在越界 |
| O10 | WeChat miniprogram 完整适配 | `遵守` | HP9 明确排除，manual evidence 与 miniprogram 适配分离 |

> 所有设计文档均未越界到 charter §4.2 定义的 Out-of-Scope 区域。灰区判定表（charter §4.3）中的各项判定在设计文档中也得到一致遵守。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: `设计方向成立，但 6 项 Finding（R1-R6）构成 charter-design 合同级不一致，必须在 action-plan 制作前完成修订。HP0/HP8/HP9/HP10 四个 phase 的设计文档已可以进入 action-plan 制作（HP0 可以立即启动）。HP1 需要先冻结 schema 字段定义的一致性。HP2/HP3/HP4 在 R1 得到处理后可以启动。HP5/HP6/HP7 必须等 R2/R3/R4/R5/R6 全部 closed 后才能启动 action-plan。`

- **是否允许关闭本轮 review**: `no`

- **关闭前必须完成的 blocker**:
  1. **R1 解决**: 为所有 `context/` 外部 precedent 引用提供可验证的证据（补充源文件或删除不可验证引用并重新确认受影响的 QNA 决策）。
  2. **R2 解决**: 统一 charter §7.2 和 HP5 设计文档中 confirmation kind 的 7 类（或更多类）枚举集合。
  3. **R3 解决**: 统一 charter §7.2 和 HP6 设计文档中 `nano_session_todos` 的字段定义和状态枚举。
  4. **R4 解决**: 统一 charter §7.2 和 HP6 设计文档中 `nano_session_temp_files` 的字段定义和枚举。
  5. **R5 解决**: 统一 charter §7.2 和 HP7 设计文档中 `nano_session_checkpoints.checkpoint_kind` 枚举，并确定 `created_by` 字段的归属。
  6. **R6 解决**: 统一 charter §7.2 和 HP7 设计文档中 `nano_checkpoint_file_snapshots` 和 `nano_checkpoint_restore_jobs` 的字段结构。

- **可以后续跟进的 non-blocking follow-up**:
  1. **R7**: 在 HPX-qna Q37/Q38 获得 owner 回答后，关闭 HP3/HP4 的条件性 collateral migration 路径。
  2. **R8**: 在 HP9 action-plan 中明确 README 的索引更新归属。
  3. **设计文档自身的一致性**: 50% 设计文档在"文档状态"标 `reviewed`，但本轮发现说明审查未系统性地 cross-reference charter schema。建议在所有 block 清除后，对全部 12 份设计文档做一轮 charter-design 交叉验证再标记 `frozen`。

- **建议的二次审查方式**: `same reviewer rereview` — 在所有 6 项 blocker 修订完成后，由同一审查者对修订后的设计文档进行 re-review。

- **实现者回应入口**: `待本文件定稿后，请在 HPX-qna.md 或本文件末尾 append 回应，不要改写 §0–§5。`

---

## 6. 附加分析：设计文档能否直接引导 action-plan 制作？

### 6.1 可以立即进入 action-plan 的 phase

| Phase | 理由 | 前置条件 |
|-------|------|----------|
| HP0 | 设计文档与 charter 完全一致，无 schema 依赖，无 context/ 关键决策依赖 | 无额外条件 |
| HP8 | 设计文档与 charter 完全一致，所有 chronic issue 分类正确，megafile gate 目标文件已更新 | HP7 closure（但设计文档本身可先行制作 action-plan） |
| HP9 | 设计文档与 charter 完全一致，18 份文档清单正确，rewrite/sanity-check 分级合理 | HP8 closure（但 design doc action-plan 可先行） |
| HP10 | 设计文档与 charter 完全一致，closure register 分类与 §10.4 对齐 | HP9 closure（但 design doc action-plan 可先行） |

### 6.2 需要先修订才能进入 action-plan 的 phase

| Phase | Block 原因 | 修订范围 |
|-------|-----------|----------|
| HP1 | R1 + schema 字段需与其他 HP 设计文档统一（charter 是权威，但 HP6/HP7 设计文档有更详细的字段设计，需双向修订） | Charter §7.2 + HP1 design + HP5/HP6/HP7 design |
| HP2 | R1 — context/ 引用不可验证影响 QNA 决策依据 | 补充 context/ 或修订 HP2 design 第 4/8 节 |
| HP3 | R1 + R7 | 同上 + 关闭 Q37 条件路径 |
| HP4 | R1 + R7 | 同上 + 关闭 Q38 条件路径 |
| HP5 | R1 + R2 (blocker) | Charter §7.2 confirmation kind 枚举 + HP5 design §7.2 F5 |
| HP6 | R1 + R3 + R4 (blocker) | Charter §7.2 todo/temp_file schema + HP6 design §7.2 F1/F2 |
| HP7 | R1 + R5 + R6 (blocker) | Charter §7.2 checkpoint/snapshot/restore_job schema + HP7 design §7.2 F1/F3 |

### 6.3 总体建议

**分两批启动 action-plan**:
- **第一批 (立即)**: HP0 + HP8 + HP9 + HP10 — 这四个 phase 的设计文档无 blocker。
- **第二批 (R1-R6 修订后)**: HP1 → HP2 → HP3 → HP4 → HP5 → HP6 → HP7 — 严格按 charter §8.2 依赖顺序，先统一 schema 定义再依次启动。

**HP1 设计文档的优先修订策略**: 鉴于 HP1 是后续 9 个 phase 的 DDL 基础，建议在启动任一批次 action-plan 之前，**先完成 charter §7.2 与 HP1/HP5/HP6/HP7 四份设计文档的 schema 字段全量对齐**，生成一份 `HP1-schema-extension-v1.1.md` 的统一 schema 定义，作为 unique source of truth。这份统一 schema 应覆盖:
- R2: confirmation 7/11 类 kind 统一
- R3: `nano_session_todos` 字段统一
- R4: `nano_session_temp_files` 字段统一
- R5: `nano_session_checkpoints.checkpoint_kind` 枚举统一（含 `rollback_baseline`）
- R6: `nano_checkpoint_file_snapshots` + `nano_checkpoint_restore_jobs` 字段统一
