# Nano-Agent 功能簇设计

> 功能簇: `HP7 Checkpoint Revert`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `packages/nacp-session/src/messages.ts:56-59,260-319`
> - `packages/nacp-session/src/frame.ts:26-30`
> - `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79`
> - `workers/agent-core/src/host/checkpoint.ts:1-15,43-56,89-121,145-206,218-282`
> - `workers/agent-core/src/host/do/session-do-persistence.ts:142-187,193-222`
> - `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`
> - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
> - `workers/filesystem-core/src/artifacts.ts:113-170,185-272`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（已冻结；本设计若与 QNA 冲突，以 QNA 为准）
> 文档状态: `reviewed`
> 外部 precedent 说明: 当前工作区未 vendored `context/` 源文件；文中出现的 `context/*` 仅作 drafting-time ancestry pointer，不作为当前冻结 / 执行证据。

---

## 0. 背景与前置约束

当前 nano-agent 已经有“latest checkpoint”这类 runtime seam，但它仍然不是 HP7 要求的 checkpoint/revert/fork 产品面：

1. `nacp-session` 里的 `session.resume` body 目前仍只接受 `last_seen_seq`，frame 层也只是把 `last_seen_seq` / `replay_from` 当成 replay 参数；它没有 checkpoint id、restore mode、fork 参数这些产品语义（`packages/nacp-session/src/messages.ts:56-59,260-319`; `packages/nacp-session/src/frame.ts:26-30`）。
2. agent-core 的 `SessionCheckpoint` 类型理论上已经为 `kernelFragment / replayFragment / workspaceFragment / hooksFragment` 预留了完整形态，但今天的 `persistCheckpoint()` 实际写入却仍是 `replayFragment: null`、`workspaceFragment: null`、`hooksFragment: null` 的 latest blob，说明当前 seam 是“DO hibernation restore”而不是“用户可管理 checkpoint registry”（`workers/agent-core/src/host/checkpoint.ts:43-56,89-121,145-206,218-282`; `workers/agent-core/src/host/do/session-do-persistence.ts:142-187`）。
3. `restoreFromStorage()` 也仍然只是去 tenant-scoped DO storage 读 `session:checkpoint` 单键，然后把 `kernelFragment/actorPhase/turnCount` 重新塞回 state；`session.resume` 则在 replay helper restore 后直接调用这条 latest-key 路径（`workers/agent-core/src/host/do/session-do-persistence.ts:193-222`; `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`）。
4. 仓库里当前已经有 artifact files truth，但它仍停留在 `nano_session_files` 这一层基础 metadata；没有 checkpoint registry、file shadow snapshots、restore jobs、fork lineage 这些产品级真相（`workers/orchestrator-core/migrations/004-session-files.sql:6-27`; `workers/filesystem-core/src/artifacts.ts:113-170,185-272`）。
5. 外部 precedent 已经很清楚：Gemini 的 checkpoint data 会同时保留 `history / clientHistory / toolCall / commitHash / messageId`，restore 与 rewind 还会同时刷新 transcript、文件状态与 UI history（`context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157`; `context/gemini-cli/packages/core/src/commands/restore.ts:11-58`; `context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198`）。Claude 的 fork 则会把 parent assistant 的 tool_use/thinking 保留住，再注入一个显式 fork boilerplate 与 directive，避免 child transcript 来源不明（`context/claude-code/constants/xml.ts:61-66`; `context/claude-code/tools/AgentTool/forkSubagent.ts:96-198`）。

- **项目定位回顾**：HP7 负责把“内部 latest checkpoint seam”升级成 **用户可枚举、可 diff、可按 mode restore、可 fork、可清理 TTL 的产品面**。
- **本次讨论的前置共识**：
  - HP7 消费的是 HP1 的目标 schema；当前仓库代码并没有这些表，文档不能假装它们已经存在。
  - restore 必须和 confirmation plane 对齐；`checkpoint_restore` 不允许绕开 HP5。
  - checkpoint 与 fork 都必须遵守 tenant-scoped R2 namespace；不能出现跨 session 直接引用旧 key 的“软链接式 fork”。
  - `session.resume` 继续保留 latest-key runtime seam，但 HP7 的产品 API 不能建立在这个单键之上。
- **本设计必须回答的问题**：
  - auto checkpoint 与 user-named checkpoint 的 TTL、materialization 策略如何区分？
  - `files_only` / `conversation_and_files` restore 应如何处理失败回滚？
  - fork 是新 conversation 还是同 conversation 的新 session？
  - file snapshot 是 eager 还是 lazy 物化？
- **显式排除的讨论范围**：
  - cross-conversation fork
  - checkpoint 可视化 diff UI
  - checkpoint export/import

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP7 Checkpoint Revert`
- **一句话定义**：`把当前内部 latest checkpoint seam 扩展成用户可操作的 checkpoint registry、三种 restore mode、文件影子快照、session fork 与 TTL/cleanup 机制。`
- **边界描述**：这个功能簇**包含** checkpoint registry、lazy file snapshot、restore jobs、`conversation_only/files_only/conversation_and_files` 三模式 restore、session fork、TTL/cleanup；**不包含** 跨 conversation fork、checkpoint export/import、UI visualizer。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| checkpoint | 一次可恢复的 durable 锚点 | 不等于 DO latest blob |
| lazy snapshot | 先记 checkpoint row，再在需要时物化文件快照 | HP7 第一版采用 |
| file shadow snapshot | 针对 workspace 文件的 R2 副本 | 独立于 artifact final files |
| restore job | 一次 restore 执行记录 | 承担 confirmation / rollback / outcome truth |
| files_only restore | 只回退文件层状态 | 不动 conversation transcript |
| conversation_and_files restore | 同时回退 conversation + files | 是最强模式 |
| session fork | 从某 checkpoint 分出一个同 conversation 的新 session | 不做 cross-conversation |

### 1.2 参考源码与现状锚点

- `packages/nacp-session/src/messages.ts:56-59,260-319` 与 `packages/nacp-session/src/frame.ts:26-30` — 当前协议入参还只有 `last_seen_seq`，尚无 checkpoint-aware resume。
- `workers/agent-core/src/host/checkpoint.ts:43-56,89-121,145-206,218-282` — 当前 SessionCheckpoint 是 runtime seam，不是产品 registry。
- `workers/agent-core/src/host/do/session-do-persistence.ts:142-187,193-222` 与 `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213` — persist/restore 仍是 single latest-key 路径。
- `workers/orchestrator-core/migrations/004-session-files.sql:6-27` 与 `workers/filesystem-core/src/artifacts.ts:113-170,185-272` — 现在仅有 artifact metadata / artifact object truth，还没有 file snapshot truth。
- `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79` — HP7 的 snapshot/fork R2 key 必须继续服从同一个 tenant prefix law。
- `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157`, `context/gemini-cli/packages/core/src/commands/restore.ts:11-58`, `context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198` — Gemini 证明 checkpoint/restore 必须同时考虑 history、client history、文件状态与 UI 重装载。
- `context/claude-code/constants/xml.ts:61-66` 与 `context/claude-code/tools/AgentTool/forkSubagent.ts:96-198` — Claude 证明 fork child 的来源说明必须显式写进 child transcript，而不是静默复制。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP7 在整体架构里扮演 **checkpoint / revert / fork owner**。
- 它服务于：
  - 用户可操作的 checkpoint list/create/diff/restore
  - workspace 状态与 conversation truth 的联动回退
  - session fork 的 lineage 管理
  - TTL / cleanup 对 snapshot 成本的控制
- 它依赖：
  - HP6 的 workspace temp file truth
  - HP5 的 confirmation plane
  - agent-core DO checkpoint seam
  - tenant-scoped R2 naming law
- 它被谁依赖：
  - future conversation browser / time-travel UX
  - support/debug 的 rollback 与 fork 排查
  - hero-to-pro “可恢复 agent loop”主目标

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP6 Workspace | HP6 -> HP7 | 强 | file snapshot 必须建立在 workspace truth 上 |
| HP5 Confirmation | HP5 -> HP7 | 强 | restore 前必须经过 confirmation |
| agent-core Session DO | HP7 <-> DO | 强 | conversation restore / fork 最终都要回到 DO runtime |
| filesystem-core | HP7 <-> FS | 强 | file snapshot create/restore/copy 都走 filesystem-core |
| clients/web | HP7 -> client | 中 | list/diff/restore/fork 都是未来产品面 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP7 Checkpoint Revert` 是 **对话与文件时间旅行能力的统一主控层**，负责 **把 checkpoint、diff、restore、fork、TTL cleanup 收敛成有 durable truth、有确认门、有回滚保护、有租户边界的产品系统**，对上游提供 **真正可恢复的历史锚点**，对下游要求 **D1、R2、DO runtime 与 lineage 元数据始终保持一致**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| eager 物化每个 turn-end 的全部文件快照 | 直觉上实现简单 | R2 成本与复制量不可控 | 否；第一版坚持 lazy |
| fork 为新 conversation | 看起来更干净 | 与“仅支持 session fork、不支持跨 conversation”冲突 | 否 |
| restore 失败后只报错不回滚 | 实现最省 | 会把 session 留在半恢复状态 | 否 |
| 继续依赖 DO latest blob 充当 checkpoint registry | 当前已有 seam | 无法 list/diff/TTL/fork | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| checkpoint mode | `conversation_only / files_only / conversation_and_files` | 三模式冻结 | future 可扩 workspace_only / partial path |
| snapshot status | `file_snapshot_status` / `snapshot_status` | `none/pending/materialized/...` | future 可扩 deduped |
| fork lineage | checkpoint/session lineage 字段 | 同 conversation fork | future 可扩 branch browser |
| TTL policy | `expires_at` + cleanup jobs | auto/user-named 分级 TTL | future 可扩 policy config |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：checkpoint registry 与 restore job。
- **解耦原因**：checkpoint 是可复用锚点；restore job 是某次执行尝试。混成一张真相后，无法表达“同一 checkpoint 被 restore 多次且结果不同”。
- **依赖边界**：checkpoint row 永不复写执行结果；restore outcome 全写 job 表。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：checkpoint row、file snapshot row、restore job、fork lineage、cleanup job。
- **聚合形式**：统一收敛到 orchestrator-core D1 truth 与 filesystem-core R2 snapshot namespace。
- **为什么不能分散**：如果 checkpoint 在 D1、file snapshot 只在 R2、rollback 只在 DO memory、fork 只记 UI 注释，HP7 根本无法成为可靠系统能力。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent 以当前仓库源码锚点为 authoritative evidence；若出现 `context/*`，仅作 external ancestry pointer。

### 4.1 Gemini CLI 的做法

- **实现概要**：Gemini 在处理可恢复 tool call 时，会把 `history / clientHistory / toolCall / commitHash / messageId` 一起写进 checkpoint data（`context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157`）。`performRestore()` 恢复时既会加载 history/clientHistory，也会尝试恢复文件快照（`context/gemini-cli/packages/core/src/commands/restore.ts:11-58`）。UI 侧 `rewindCommand` 则会在 rewound history 载入后刷新 client history 与 context manager（`context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198`）。
- **亮点**：
  - checkpoint 不是“只存一句消息 ID”，而是把 restore 需要的状态成组保存
  - restore 与 UI rewind 明确分层
- **值得借鉴**：
  - checkpoint row 与 restore job 分层
  - restore 必须同时考虑 conversation truth 与 file truth
- **不打算照抄的地方**：
  - 直接依赖 Git commit 作为 nano-agent 的 snapshot 载体

### 4.2 Claude Code 的做法

- **实现概要**：Claude 的 fork 逻辑会保留完整 parent assistant message（含 thinking 与 tool_use），再构造一个包含统一 boilerplate 与 per-child directive 的 child user message；boilerplate 还被单独用 XML tag 包起来，方便渲染器识别（`context/claude-code/constants/xml.ts:61-66`; `context/claude-code/tools/AgentTool/forkSubagent.ts:96-198`）。
- **亮点**：
  - fork child 的来源与约束是显式可见的，不是静默 clone
  - fork 语义与普通继续对话严格区分
- **值得借鉴**：
  - nano-agent 的 fork child 也必须拥有显式 lineage/system message
  - fork 不是 restore 的别名
- **不打算照抄的地方**：
  - 完全复制 Claude 的 prompt-cache/fork boilerplate 文本

### 4.3 当前仓库的 precedent / 反例

- **实现概要**：当前仓库的 DO checkpoint seam 已经能表达“一个 session checkpoint 应包含哪些 fragment”，但真正持久化时仍只写 latest blob，恢复时也只读 single key。它更像 hibernation resume seam，而不是 checkpoint registry（`workers/agent-core/src/host/checkpoint.ts:43-56,89-121,145-206,218-282`; `workers/agent-core/src/host/do/session-do-persistence.ts:142-187,193-222`; `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213`）。
- **亮点**：
  - fragment 化 checkpoint interface 已经存在，HP7 不必从零定义 fragment contract
- **值得借鉴**：
  - 继续沿用 `kernel/workspace/replay/hooks` 的分片思路
  - 继续让 restore 对 invalid checkpoint fail closed
- **不打算照抄的地方**：
  - 继续把 latest DO key 当成唯一 checkpoint 真相

### 4.4 横向对比速查表

| 维度 | Gemini CLI | Claude Code | 当前 nano-agent | HP7 倾向 |
|------|------------|-------------|-----------------|----------|
| checkpoint 内容 | history + clientHistory + file anchor | N/A | latest fragment blob | 增加 D1 registry + lazy file snapshot |
| restore | history/file/UI 联动 | N/A | latest-key resume | 三模式 restore + rollback job |
| fork lineage | N/A | child transcript 显式声明来源 | 尚无产品面 | 同 conversation fork + lineage message |
| TTL/cleanup | 依赖本地 temp/git | N/A | 尚无 registry | D1 `expires_at` + cleanup jobs |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** checkpoint registry + lazy file snapshot materialization。
- **[S2]** `conversation_only / files_only / conversation_and_files` 三模式 restore。
- **[S3]** restore diff 与 confirmation gate。
- **[S4]** restore failure rollback。
- **[S5]** 同 conversation 的 session fork。
- **[S6]** auto/user-named checkpoint TTL 与 cleanup jobs。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** cross-conversation fork —— 不做。
- **[O2]** checkpoint diff visualizer UI —— 只返 JSON，不做渲染器。
- **[O3]** checkpoint export/import —— 留到 hero-to-platform。
- **[O4]** 把 artifact immutable store 改造成 Git-like dedupe —— 不在 HP7。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| turn-end checkpoint 是否立刻复制全部文件 | out-of-scope | 成本过高，且大多数 checkpoint 不会被 restore | HP7 采用 lazy materialization |
| fork 是否创建新 conversation | out-of-scope | charter 已明确只做 session fork | HP7 同 conversation 新 session |
| restore 是否可以绕过 confirmation | out-of-scope | restore 是 destructive/high-risk action | HP5 `checkpoint_restore` |
| files_only restore 是否修改 artifact immutable bytes | out-of-scope | artifact store 与 workspace 语义不同 | HP7 只恢复 workspace/file attachment truth |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **lazy file snapshot**，而不是 **每次 turn-end eager 复制文件**
   - **为什么**：多数 checkpoint 只用于 conversation replay 或很快过期，eager 复制会把 HP7 直接推向 R2 成本陷阱。
   - **我们接受的代价**：第一次 restore / named checkpoint 可能需要补做 materialization。
   - **未来重评条件**：只有在有可靠 dedupe 或极强产品需求时。

2. **取舍 2**：我们选择 **restore job 显式携带 rollback checkpoint**，而不是 **失败后 best-effort 回到原状态**
   - **为什么**：files restore 是多步 I/O，任何“尽量恢复”都会留下半恢复状态。
   - **我们接受的代价**：每次 restore 前要额外做一次 rollback baseline。
   - **未来重评条件**：无；这是产品级恢复能力的底线。

3. **取舍 3**：我们选择 **fork 为同 conversation 的新 session**，而不是 **新建 conversation**
   - **为什么**：charter 明确排除了 cross-conversation fork，session fork 的语义就是在同一 conversation 内分出新执行支路。
   - **我们接受的代价**：conversation detail 后续要面对“多 session 分支”展示问题。
   - **未来重评条件**：当 branch browser 成为单独专项。

4. **取舍 4**：我们选择 **restore 与 fork 明确分离**，而不是 **把 fork 做成 restore + continue 的别名**
   - **为什么**：restore 改的是当前 session；fork 产生的是新 session，新旧两条线都要继续存在。
   - **我们接受的代价**：需要单独维护 lineage truth。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| lazy snapshot 信息丢失 | pending materialization 只留在内存 | restore 目标不可恢复 | `file_snapshot_status` 必须先写 D1，不允许只放 DO memory |
| restore 中途失败 | R2 copy / DO restore 任一步失败 | session 落在半恢复状态 | 先创建 rollback baseline，再执行 restore，失败后自动回滚并把 job 标 `rolled_back` |
| fork 共享原 session R2 key | 为省成本直接引用旧 key | 两个 session 串线 / cleanup 冲突 | fork 必须复制到 `child session` 新 namespace |
| TTL cron 只写配置不执行 | scheduled/alarm 未真实接线 | 快照长期泄漏 | cleanup job 必须有审计行与定时验证 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：checkpoint/fork 从“内部恢复技巧”变成“可列举、可复现、可调试”的正式系统能力。
- **对 nano-agent 的长期演进**：HP7 是 hero-to-pro 阶段把 chat/context/workspace 三条线真正收口的最后一笔。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：有了可靠 revert/fork，agentic loop 才谈得上“试错但可回头”。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | checkpoint registry + lazy snapshot | D1 checkpoint truth 与按需物化的 file snapshot | ✅ checkpoint 第一次成为产品面而不是 DO 单键 |
| F2 | restore 三模式 | `conversation_only/files_only/conversation_and_files` | ✅ 恢复能力第一次有明确模式边界 |
| F3 | restore job + rollback | destructive restore 的确认与失败回滚 | ✅ restore 失败不再把 session 留在半残状态 |
| F4 | session fork | 从 checkpoint 派生同 conversation 新 session | ✅ 分支第一次成为显式 lineage |
| F5 | TTL / cleanup | auto/user-named checkpoint 生命周期治理 | ✅ checkpoint 成本第一次可控 |

### 7.2 详细阐述

#### F1: checkpoint registry + lazy snapshot

- **输入**：turn-end 自动 checkpoint、用户主动创建 named checkpoint、restore/fork 触发的按需物化
- **输出**：checkpoint row + 可选 file snapshot rows
- **主要调用者**：orchestrator-core、filesystem-core、HP7 restore/fork handlers
- **核心逻辑**：
  - 新增目标 truth：`nano_session_checkpoints`
  - 最小字段冻结为：
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
    - `expires_at`
    - `created_at`
  - 新增目标 truth：`nano_checkpoint_file_snapshots`
  - 最小字段冻结为：
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
  - turn-end 自动 checkpoint 只写 `nano_session_checkpoints`，`file_snapshot_status = none`
  - 当用户显式 `POST /sessions/{id}/checkpoints`、执行 `files_only` / `conversation_and_files` restore、或执行 fork 时，再触发 snapshot materialization
  - snapshot R2 key 冻结为 `tenants/{team_uuid}/sessions/{session_uuid}/snapshots/{checkpoint_uuid}/{virtual_path}`
- **边界情况**：
  - 若 session 当前无 workspace 文件，则允许 materialization 成功但 0 rows
  - materialization 失败必须把 checkpoint row 标成 `failed` 或至少把 `file_snapshot_status = failed`
  - rollback baseline 不单独占用 checkpoint enum；它应表示为 `checkpoint_kind = system` + 明确 label / lineage
- **一句话收口目标**：✅ **checkpoint 第一次拥有独立于 DO latest blob 的 durable registry**。

#### F2: restore 三模式

- **输入**：checkpoint uuid、restore mode
- **输出**：restore job、diff 结果、被恢复的 conversation/file 状态
- **主要调用者**：client、support/debug、future automation
- **核心逻辑**：
  - `GET /sessions/{id}/checkpoints`
  - `POST /sessions/{id}/checkpoints`
  - `GET /sessions/{id}/checkpoints/{checkpoint_uuid}/diff`
  - `POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore`
  - mode 冻结为：
    1. `conversation_only`
    2. `files_only`
    3. `conversation_and_files`
  - `conversation_only`：回退 conversation/session/message truth，并通过 DO restore seam 重建 runtime 状态
  - `files_only`：只回退 workspace temp files 与 file attachment truth，不动 conversation transcript
  - `conversation_and_files`：两者都回退，且以一个 restore job 统一编排
  - 若目标 checkpoint 还未 materialize files，则 restore 前先补 materialization
  - diff 返回 JSON，至少含：
    - message added/removed span
    - workspace file added/removed/changed
    - promoted artifact attachment delta
- **边界情况**：
  - 对不存在的 checkpoint 返回 404
  - 对已过期或 cleanup 完成的 checkpoint 返回 explicit gone/error，而不是静默 fallback
- **一句话收口目标**：✅ **restore 第一次从内部恢复技巧变成有模式、有 diff、有 job 的正式产品操作**。

#### F3: restore job + rollback

- **输入**：restore 请求 + confirmation decision
- **输出**：restore job row、rollback baseline、最终 outcome
- **主要调用者**：restore handler、HP5 confirmation plane、support/debug
- **核心逻辑**：
  - 新增目标 truth：`nano_checkpoint_restore_jobs`
  - 最小字段冻结为：
    - `job_uuid`
    - `checkpoint_uuid`
    - `session_uuid`
    - `mode` (`conversation_only | files_only | conversation_and_files | fork`)
    - `target_session_uuid`
    - `status` (`pending | running | succeeded | partial | failed | rolled_back`)
    - `confirmation_uuid`
    - `failure_reason`
    - `started_at`
    - `completed_at`
  - restore 前必须先经过 HP5 `checkpoint_restore` confirmation
  - confirmation 通过后，系统先创建一条 `checkpoint_kind = system` 的 rollback baseline checkpoint，再执行真正 restore
  - restore 任一步失败时：
    1. 立即尝试从 rollback baseline 回放
    2. job 标记为 `rolled_back`
    3. 记录 `failure_reason`
    4. 若本次 restore 已写入 supersede/tombstone 等 D1 标记，则反标恢复
- **边界情况**：
  - confirmation deny/cancel/timeout 都不进入 `running`；第一版 restore job 在 confirmation 放行后创建
  - rollback 再失败时，job 进入 `failed`，并触发最高级别告警
- **一句话收口目标**：✅ **restore 第一次拥有“失败也能往回退”的产品级保护栏**。

#### F4: session fork

- **输入**：`from_checkpoint_uuid`、可选 `new_session_label`
- **输出**：同 conversation 下的新 session + lineage truth
- **主要调用者**：client、future branch UX、support/debug
- **核心逻辑**：
  - `POST /sessions/{id}/fork`
  - fork 冻结为“**同 conversation 的新 session**”，不创建新 conversation
  - 第一版 lineage 不新增 session 专属 lineage 列；它通过：
    1. `nano_checkpoint_restore_jobs.mode = fork`
    2. `nano_checkpoint_restore_jobs.target_session_uuid = child_session_uuid`
    3. child transcript 头部的显式 lineage system message
    共同表达 fork 来源
  - fork 流程：
    1. 校验 checkpoint 存在，必要时 materialize file snapshot
    2. 复制 checkpoint 之前的 conversation/session/message truth 到 child session
    3. 把 snapshot 文件复制到 child namespace：`tenants/{team}/sessions/{child_session_uuid}/workspace/{virtual_path}`
    4. 原 snapshot row 标记 `snapshot_status = copied_to_fork`
    5. 创建 child session 的初始 runtime / DO
    6. 在 child transcript 头部写一条显式 lineage system message，声明 fork 来源 checkpoint 与 parent session
  - child session 绝不直接复用 parent session 的 R2 key
- **边界情况**：
  - 无 snapshot 的 checkpoint 允许 fork conversation-only child，但如果用户要求 file-aware fork，就必须先 materialize
  - fork 后 parent/child 任一侧继续写文件，不能影响另一侧
- **一句话收口目标**：✅ **fork 第一次成为有 lineage、可隔离、可审计的新 session 创建语义**。

#### F5: TTL / cleanup

- **输入**：checkpoint kind、session end、scheduled sweep
- **输出**：过期 checkpoint/file snapshot 删除与 cleanup audit
- **主要调用者**：scheduled maintenance、support/debug
- **核心逻辑**：
  - TTL 策略冻结为：
    - turn-end auto checkpoint：保留最近 10 个
    - user-named checkpoint：30 天
    - compact-boundary checkpoint：与 compact summary 同 TTL
    - session end 后整体 snapshot cleanup：90 天
  - 每次 cleanup 都写 `nano_workspace_cleanup_jobs`，`scope = checkpoint_ttl`
  - 清理顺序：
    1. 先删 snapshot rows / R2 objects
    2. 再删 checkpoint row
    3. 保留 restore job 与 lineage/audit truth
- **边界情况**：
  - 正被 restore/fork 使用的 checkpoint 不可并发清理
  - cleanup 失败时 job 标 `failed`；失败明细写 audit / error log
- **一句话收口目标**：✅ **checkpoint 第一次拥有明确的生命周期治理，而不是无限堆积**。

### 7.3 非功能性要求与验证策略

- **性能目标**：turn-end auto checkpoint 默认 lazy；避免对每个 turn 做全量 R2 复制。
- **可观测性要求**：checkpoint create/materialize/restore/fork/cleanup 都必须有 job 或 row 可追。
- **稳定性要求**：restore/fork 任何一步失败都不能把 session 留在未定义状态。
- **安全 / 权限要求**：所有 snapshot/fork key 继续遵守 `tenants/{team_uuid}/...` law，禁止跨 session 复用原 key。
- **测试覆盖要求**：
  - 三模式 restore
  - diff 返回 message + file delta
  - confirmation gate
  - rollback on failure
  - fork namespace isolation
  - TTL cleanup
- **验证策略**：以“checkpoint row、snapshot row、restore/fork 结果、cleanup audit”四者一致为准。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent 源码 | HP7 主要参考当前仓库；若出现 `context/*`，仅作 external ancestry pointer | 不再通过二手 markdown 转述 |

### 8.2 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/claude-code/constants/xml.ts:61-66` | fork boilerplate tag 与 directive prefix 常量 | 说明 fork child transcript 需要显式来源语义 | HP7 借鉴“child 来源必须显式可见” |
| `context/claude-code/tools/AgentTool/forkSubagent.ts:96-198` | fork child 保留 parent assistant/tool_use/thinking，再注入 directive | 说明 fork 不应伪装成普通继续对话 | HP7 借鉴 lineage/system message 设计 |

### 8.3 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157` | checkpoint data 同时记录 history/clientHistory/toolCall/commitHash/messageId | 说明 checkpoint 必须是成组状态锚点 | HP7 借鉴 checkpoint registry 设计 |
| `context/gemini-cli/packages/core/src/commands/restore.ts:11-58` | restore 同时处理 history 与文件恢复 | 说明 restore mode 不能只改 transcript | HP7 借鉴三模式 restore 设计 |
| `context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198` | rewind 后刷新 client history 与 context manager | 说明 restore 后的可观察状态必须整体重载 | HP7 借鉴“conversation truth 与 runtime state 一起恢复” |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/agent-core/src/host/checkpoint.ts:43-56,89-121,145-206,218-282` | 当前 checkpoint fragment contract 已在 | HP7 继续复用 fragment 边界，而不是重写 checkpoint interface |
| `workers/agent-core/src/host/do/session-do-persistence.ts:142-187` | persistCheckpoint 目前仍写 latest blob，多个 fragment 还是 null | 这是 HP7 要从 runtime seam 升级为产品 registry 的直接断点 |
| `workers/agent-core/src/host/do/session-do-persistence.ts:193-222` 与 `workers/agent-core/src/host/do/session-do/ws-runtime.ts:197-213` | restore 仍只走 `session:checkpoint` single key | 说明当前 resume 不能承担 checkpoint product surface |
| `workers/orchestrator-core/migrations/004-session-files.sql:6-27` | 只有 artifact metadata truth | HP7 需要补 checkpoint/file snapshot/restore job 真相 |
| `workers/filesystem-core/src/artifacts.ts:113-170,185-272` | artifact key 已稳定落在 tenant/session namespace | HP7 的 snapshot/fork key 继续沿用同级命名原则 |
| `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79` | tenant prefix law 已经冻结 | HP7 的 snapshot 与 fork 不允许绕过这条 law |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP7-D1` | file snapshot 是 eager 还是 lazy 物化？ | HP7 / cost / cron | lazy | `frozen` | `docs/charter/plan-hero-to-pro.md:792-794`, `workers/agent-core/src/host/do/session-do-persistence.ts:142-187`, `workers/filesystem-core/src/artifacts.ts:113-170,185-272` |
| `HP7-D2` | fork 是不是新 conversation？ | HP7 / clients / lineage | 否；同 conversation 新 session | `frozen` | `docs/charter/plan-hero-to-pro.md:796`, `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79`, `workers/filesystem-core/src/artifacts.ts:113-170,185-272` |
| `HP7-D3` | restore 失败后是否允许 best-effort 留在部分成功状态？ | HP7 / support / reliability | 否；必须有 rollback baseline | `frozen` | `docs/charter/plan-hero-to-pro.md:795-796`, `workers/agent-core/src/host/checkpoint.ts:145-206,218-282`, `workers/agent-core/src/host/do/session-do-persistence.ts:193-222` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. checkpoint row、snapshot row、restore job、fork lineage 的 durable truth 已写清。
2. 三模式 restore 与 rollback 流程已经写清。
3. fork 的 session/conversation 边界与 R2 namespace 已冻结。
4. TTL/cleanup 与 confirmation gate 已有明确 owner 和行为。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
- **实现前额外提醒**：
  - HP7 必须先把 rollback baseline 设计与 confirmation gate 接线顺序固定，再写 restore 执行逻辑。

---

## 10. Value Verdict

### 10.1 价值结论

`HP7 Checkpoint Revert` 必须进入 hero-to-pro 主线，而且不能再继续 defer。因为当前系统虽然“看上去有 checkpoint”，但那只是 DO hibernation seam；它还不是用户可管理、可 diff、可 fork、可失败回退的产品能力。

### 10.2 对 charter 目标的支撑度

它直接支撑：

1. hero-to-pro 对“上下文/聊天/工作区可恢复”的核心承诺
2. HP4 chat lifecycle 与 HP6 workspace state machine 的真正收口
3. future clients 对时间旅行、分支、撤销实验的产品化能力

### 10.3 当前建议

- **建议状态**：`approved-for-action-plan`
- **原因**：当前断点、precedent、restore/fork 边界、TTL/rollback 设计都已经足够具体，可以进入 action-plan 与实现阶段。
