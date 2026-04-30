# Nano-Agent 功能簇设计

> 功能簇: `HP4 Chat Lifecycle`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-17,31-38,49-59,76-99`
> - `workers/orchestrator-core/src/session-lifecycle.ts:15-39`
> - `workers/orchestrator-core/src/session-truth.ts:314-348`
> - `workers/orchestrator-core/src/index.ts:364-440,707-711,885-980`
> - `workers/orchestrator-core/src/user-do/surface-runtime.ts:178-218`
> - `workers/agent-core/src/host/do/session-do-persistence.ts:139-186`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（已冻结；本设计若与 QNA 冲突，以 QNA 为准）
> 文档状态: `reviewed`
> 外部 precedent 说明: 当前工作区已 vendored `context/` 源文件；文中出现的 `context/*` 仅作为外部 precedent / ancestry pointer，不能替代当前仓库代码、frozen QNA 与 charter 作为执行证据。

---

## 0. 背景与前置约束

当前 nano-agent 已经有了“会话存在”的 durable truth，但还没有“会话生命周期是产品面”的完整能力：

1. D1 已有 `nano_conversations`、`nano_conversation_sessions`、`nano_conversation_turns`、`nano_conversation_messages` 等基础表，`nano_conversations.title` 甚至已经存在（`workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-17,31-38,49-59,76-99`）。
2. public façade 当前支持的 session action 只有 `start/input/cancel/status/timeline/history/verify/ws/usage/resume/messages/files`，外加 `permission/decision`、`elicitation/answer`、`policy/permission_mode`，还没有 `close/delete/title/retry/checkpoints`（`workers/orchestrator-core/src/index.ts:364-440,707-711`）。
3. `/me/conversations` 已经有 cursor 外壳，但底层 `listSessionsForUser()` 仍是 limit-only 查询后再在 façade 内做聚合，所以会话列表与对话列表还没有真正统一的 cursor read model（`workers/orchestrator-core/src/session-truth.ts:314-348`; `workers/orchestrator-core/src/index.ts:885-980`）。
4. agent-core Session DO 的 checkpoint 目前仍是内部单键 `session:checkpoint`，不是客户端可见的 checkpoint registry，更不是可 restore 的 conversation product surface（`workers/agent-core/src/host/do/session-do-persistence.ts:139-186`）。

- **项目定位回顾**：HP4 负责把 session/conversation 从“可创建、可开始、可 resume”提升为“可关闭、可删除、可命名、可重试、可列 checkpoint、可 conversation-only restore”的完整生命周期。
- **本次讨论的前置共识**：
  - 当前 session status 冻结为 `pending|starting|active|detached|ended|expired`；HP4 不再发明新的 session 状态，而是在现有状态上补齐产品语义。
  - `nano_conversations.title` 已存在，所以 title 应优先落在 conversation 层，而不是新建 session title 平行真相。
  - 当前 schema 中还没有 checkpoint/restore/supersede/delete tombstone 专表或字段；HP4 不能假装这些前置已经在代码中存在。
  - HP3 将引入 boundary snapshot；HP4 的 conversation-only restore 必须消费 HP3/HP1 提供的 durable baseline，而不是另造历史语义。
- **本设计必须回答的问题**：
  - close 与 cancel 的区别是什么，close 是否需要新状态？
  - delete 应落在 session 还是 conversation 维度，如何做 soft tombstone？
  - title 与 retry 各自应该修改什么 durable truth？
  - checkpoint conversation_only 的 registry、diff、restore job 该如何成为产品面？
- **显式排除的讨论范围**：
  - files-only / conversation-and-files restore
  - session fork
  - LLM 自动生成 title

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP4 Chat Lifecycle`
- **一句话定义**：`把当前 session/conversation 的“生存”事实升级为用户可操作的生命周期控制面，包括 close、delete、title、retry、checkpoint list/create/diff/restore。`
- **边界描述**：这个功能簇**包含** session close、conversation soft delete、conversation title、latest-turn retry、cursor pagination、conversation detail、checkpoint conversation_only restore；**不包含** files restore、fork、多分支历史浏览器。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| session close | 正常结束一次 session，终态语义是 `completed` | 与 cancel 区分 |
| cancel | 中断当前运行中的 turn/session | 当前系统已支持 |
| conversation delete | 对整个对话做软删除，从默认列表隐藏，但不擦除 audit ledger | 不是硬删 D1 |
| title | conversation 级可读名称 | 不落在 session 表 |
| retry | 对最近一个 retryable turn 发起新的 attempt | 不是 fork |
| conversation-only checkpoint | 只针对 conversation durable truth 的锚点 | 不含文件快照 |
| restore job | 一次 restore 执行记录 | 不是 UI 临时状态 |

### 1.2 参考源码与现状锚点

- `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-17,31-38,49-59,76-99` — 当前 D1 真相只有会话/对话/turn/message 基础表；`title` 已存在，但 delete/checkpoint/restore 相关真相尚未出现。
- `workers/orchestrator-core/src/session-lifecycle.ts:15-39` — 当前 session 生命周期只定义了六个状态与 terminal 基本形态。
- `workers/orchestrator-core/src/session-truth.ts:314-348` — `listSessionsForUser()` 仍是 limit-only，不是真 cursor。
- `workers/orchestrator-core/src/index.ts:364-440,707-711,885-980` — façade 当前没有 close/delete/title/retry/checkpoints；`/me/conversations` 的 cursor 仍建立在内存聚合之上。
- `workers/orchestrator-core/src/user-do/surface-runtime.ts:178-218` — 当前已有 resume 面，但还没有 close/delete/title/retry。
- `workers/agent-core/src/host/do/session-do-persistence.ts:139-186` — 当前 DO checkpoint 是内部单键 latest checkpoint，不是 product-facing registry。
- `context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-360`, `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157`, `context/gemini-cli/packages/core/src/commands/restore.ts:11-58`, `context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198` — Gemini 说明 rewind/restore 必须同时处理 durable transcript、UI history 与可恢复锚点，而不是只改一个内存游标。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP4 在整体架构里扮演 **session/conversation 生命周期 owner**。
- 它服务于：
  - web / wechat / future CLI 的 conversation list、detail、rename、delete、retry、restore 面
  - HP7 之前的最小 restore 能力
  - audit / support / debug 对 conversation truth 的回溯
- 它依赖：
  - `nano_conversations` / `nano_conversation_sessions` / `nano_conversation_messages`
  - HP3 的 boundary snapshot 语义
  - agent-core Session DO 的 restore seam
- 它被谁依赖：
  - clients/api-docs
  - future conversation browser
  - checkpoint / restore / rollback 问题排查

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| HP3 Context State Machine | HP3 -> HP4 | 强 | restore 需要消费 compact 后的 boundary truth |
| Session DO checkpoint seam | HP4 <-> agent-core | 强 | restore 最终要让 DO snapshot 与 D1 truth 同步 |
| D1 session truth | HP4 <- D1 | 强 | close/delete/title/retry/checkpoint 都要落 durable truth |
| clients/web | HP4 -> client | 中 | 列表、detail、retry、restore 都是用户可见面 |
| HP5 Confirmation | HP4 <-> HP5 | 中 | delete/restore 等高风险动作应走统一确认面 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP4 Chat Lifecycle` 是 **conversation 产品面的生命周期主控层**，负责 **把关闭、删除、重命名、重试与 conversation-only restore 统一成 durable、可审计、可分页、可恢复的对话操作语义**，对上游提供 **真正可管理的 chat surface**，对下游要求 **D1 truth、DO snapshot 与 client 观察结果保持一致**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 给 close 新增一个 session status | 直觉上想做 `closed` | 当前 `ended + completed` 已足够表达，新增状态只会扩散全仓 switch 分支 | 否 |
| 对 delete 做硬删除 | 最省实现 | 会破坏 audit/debug/evidence | 否 |
| 把 retry 做成 session fork | 容易与 restore 混淆 | HP4 的 retry 目标是“重新跑最近一段”，不是分叉历史 | HP7 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| conversation detail | `GET /conversations/{conversation_uuid}` | 返回 title、状态、session list、latest turn | future 可扩 summary / tags |
| lifecycle actions | `POST /sessions/{id}/close`, `DELETE /sessions/{id}`, `PATCH /sessions/{id}/title`, `POST /sessions/{id}/retry` | 最小产品面 | future 可扩 bulk operations |
| checkpoint registry | `GET/POST /sessions/{id}/checkpoints` | 列表与手动命名创建 | future 可扩 filter/tag |
| restore job | `POST /.../restore`, `GET /.../restore-jobs/{id}` | conversation_only | future 可扩 files mode |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：retry 与 restore
- **解耦原因**：retry 是“针对最近一次 turn 再执行一次”，restore 是“把 conversation truth 回退到旧锚点”。
- **依赖边界**：retry 不修改旧 checkpoint registry；restore 不伪装成 retry。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：title、delete tombstone、checkpoint registry、restore job
- **聚合形式**：全部收敛到 conversation/session 的同一组 façade API 与 D1 真相
- **为什么不能分散**：如果 title 在 KV、delete 在 D1、checkpoint 只在 DO storage、restore 只在 UI 内存，生命周期将永远无法形成可靠产品面。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent 以当前仓库源码锚点为 authoritative evidence；若出现 `context/*`，仅作 external ancestry pointer。

### 4.1 Gemini CLI 的做法

- **实现概要**：Gemini 的 `ChatRecordingService` 把 transcript 记录为 durable conversation file；checkpoint data 会同时保存 `history`、`clientHistory`、`commitHash`、`toolCall`、`messageId` 等恢复锚点（`context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-360`; `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157`）。恢复路径又被拆成两层：`performRestore()` 负责加载历史与恢复文件快照（`context/gemini-cli/packages/core/src/commands/restore.ts:11-58`），而 UI 的 `rewindCommand` 负责把 rewound history 重新加载到客户端与 context manager（`context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198`）。
- **亮点**：
  - restore 不是“改一个 cursor”，而是 transcript、client history、文件状态三件事一起考虑
- **值得借鉴**：
  - checkpoint registry 与 restore 执行记录要分层
  - UI rewind 与 durable restore 不能混成一个概念
- **不打算照抄的地方**：
  - 第一版就把 git file snapshot 带进 nano-agent

### 4.2 当前仓库的 precedent / 反例

- **实现概要**：当前仓库已经有会话/对话基础表、`title` 列、resume 面与 `/me/conversations` 列表，但生命周期能力仍偏“最小可跑”。`/me/conversations` cursor 还是在 façade 层用 `listSessionsForUser(limit)` 做内存分组，Session DO checkpoint 也仍是内部 latest checkpoint（`workers/orchestrator-core/src/session-truth.ts:314-348`; `workers/orchestrator-core/src/index.ts:885-980`; `workers/agent-core/src/host/do/session-do-persistence.ts:139-186`）。
- **亮点**：
  - 基础 durable truth 已存在，HP4 不需要从零造会话模型
- **值得借鉴**：
  - title 继续落在 `nano_conversations`
  - `ended` 继续作为终态大类
- **不打算照抄的地方**：
  - 继续让 checkpoint 只停留在 DO 内部 latest key
  - 继续让 list cursor 停留在 façade 内存聚合

### 4.3 横向对比速查表

| 维度 | Gemini CLI | 当前 nano-agent | HP4 倾向 |
|------|------------|-----------------|----------|
| transcript durable truth | 有 conversation file | 有 D1 conversation/session/message | 继续以 D1 为主 |
| rewind / restore | 有区分 | 仅有 resume / DO latest checkpoint | 增加 checkpoint registry + restore job |
| title/delete | UI 驱动 | title 列已存在、delete 缺失 | conversation 级 title + soft tombstone |
| retry | 间接通过 rewind/continue | 尚无产品面 | 明确 latest-turn retry |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** `POST /sessions/{id}/close`：正常结束 session，terminal 语义为 `completed`。
- **[S2]** `DELETE /sessions/{id}`：conversation 级 soft tombstone，从默认列表隐藏，但保留 durable truth。
- **[S3]** `PATCH /sessions/{id}/title`：把 title 作为 conversation 级字段暴露出来。
- **[S4]** `POST /sessions/{id}/retry`：对最近一个 retryable turn 创建新的 attempt。
- **[S5]** `/me/sessions` 与 `/me/conversations` 真 cursor 化，并补 `GET /conversations/{conversation_uuid}`。
- **[S6]** conversation-only checkpoint：list / create / diff / restore / restore-job。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** files-only 与 conversation-and-files restore — HP7；重评条件：HP7 启动。
- **[O2]** session fork / branch tree — HP7；重评条件：产品边界调整。
- **[O3]** 自动 title 生成 — defer；重评条件：有单独产品需求。
- **[O4]** 删除后物理清理 audit ledger — 不做；重评条件：合规要求变化。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| close 是否新增 `closed` 状态 | out-of-scope | 现有 `ended + completed` 即可表达 | HP4 维持现有状态集合 |
| delete 是删 session 还是删 conversation | in-scope | 对用户来说删除的是整个对话而不是某一条 attach 记录 | HP4 定义为 conversation soft tombstone |
| retry 是否等同于 restore 最近 checkpoint | out-of-scope | retry 是新 attempt；restore 是回退历史 | HP4 分开设计 |
| checkpoint create 是否同时做 file snapshot | out-of-scope | 第一版只做 conversation-only | HP7 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **close 复用 `ended + completed`** 而不是 **引入 `closed` 新状态**
   - **为什么**：当前 status union 已广泛扩散，close 只是一种终止原因，不值得为它新开状态维度。
   - **我们接受的代价**：需要在 terminal/read model 上额外区分 `completed` vs `cancelled/error`。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **delete 做 conversation soft tombstone** 而不是 **按 session 逐条删**
   - **为什么**：用户的心智模型是“删除这个对话”，不是“删除这个 session attach”。
   - **我们接受的代价**：需要给 conversation list/detail 增加 tombstone 过滤与恢复余地。
   - **未来重评条件**：若产品未来要求 session 级归档，再单独扩展。

3. **取舍 3**：我们选择 **checkpoint registry + restore job** 而不是 **直接复用 DO 内部 latest checkpoint**
   - **为什么**：产品面需要 list/diff/restore status，而内部单键 latest checkpoint 无法承载这些语义。
   - **我们接受的代价**：需要新增 D1 durable truth 与一致性逻辑。
   - **未来重评条件**：无；这是 HP4 的核心目标。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| D1 truth 与 DO snapshot 分裂 | restore 只改一侧 | 用户看到的历史与 runtime 不一致 | restore 必须以 job 驱动双写/回滚 |
| cursor 分页重复/漏项 | list 仍靠 façade 先全拉再截断 | client 滚动列表不稳定 | HP4 改成真正 D1 cursor query |
| retry 覆盖原审计 | 直接重写旧 turn/message | 历史证据丢失 | retry 只新增 attempt，并把旧输出标 superseded |
| delete 误伤审计 | 用硬删 | support/debug 无法回溯 | 只做 soft tombstone，audit 永久保留 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能把“这个 session 已结束 / 这个对话应隐藏 / 我想重试上一轮 / 我想回到某个锚点”变成可测试 API，而不是手工操作。
- **对 nano-agent 的长期演进**：conversation 生命周期稳定后，clients/web 与 wechat 才有真正的聊天产品面可接。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：restore/retry 是后续调试复杂 agent loop、回放失败现场的关键基础设施。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | close / delete / title | 补齐基础 lifecycle control plane | ✅ 对话可被正常结束、重命名、隐藏 |
| F2 | retry | 对最近一个 turn 发起新的 attempt | ✅ 失败回合可在原会话内重试 |
| F3 | 真 cursor 列表与 conversation detail | 统一列表和详情 read model | ✅ 列表/详情不再靠半成品聚合 |
| F4 | checkpoint registry | conversation-only checkpoint list/create/diff | ✅ 用户第一次有可见 checkpoint 面 |
| F5 | restore job | conversation-only restore 双向同步 | ✅ 恢复后 D1 truth 与 runtime 一致 |

### 7.2 详细阐述

#### F1: close / delete / title

- **输入**：session uuid；close 可带 reason，title PATCH 带 title 字符串
- **输出**：更新后的 lifecycle / conversation metadata
- **主要调用者**：clients/web、support/debug、future mobile
- **核心逻辑**：
  - close：把当前 session 进入 `ended`，terminal 记为 `completed`
  - delete：把 conversation 标 tombstone（最小字段为 `deleted_at` 与 `deleted_by_user_uuid`）
  - title：直接写 `nano_conversations.title`
- **边界情况**：
  - deleted conversation 默认不再出现在 `/me/conversations`
  - ended session 仍允许 title 变更
- **一句话收口目标**：✅ **用户第一次能真正“管理一个对话”，而不是只能继续往里发消息**。

#### F2: retry

- **输入**：session uuid
- **输出**：新的 turn attempt 记录与新的 session activity
- **主要调用者**：client retry 按钮、support/manual recovery
- **核心逻辑**：只允许重试最近一个 retryable turn；原 turn 保留 audit，不覆盖；新 attempt 与旧 attempt 通过 durable attempt chain 关联
- **边界情况**：
  - 非最近 turn 不允许直接 retry
  - deleted conversation 不允许 retry
- **一句话收口目标**：✅ **“再试一次”成为有 durable truth 的系统行为，而不是前端重新发一条相似消息**。

#### F3: 真 cursor 列表与 conversation detail

- **输入**：`/me/sessions?cursor=...`、`/me/conversations?cursor=...`、`/conversations/{id}`
- **输出**：cursor page 与 conversation detail
- **主要调用者**：client conversation list / detail page
- **核心逻辑**：分页必须下沉到 D1 read model；conversation detail 聚合 title、tombstone、latest session、session summaries
- **边界情况**：
  - tombstoned conversation 默认过滤，但可为内部 debug 保留 include_deleted 开关
  - cursor 必须稳定，不受 in-memory regroup 干扰
- **一句话收口目标**：✅ **列表与详情都建立在真正 durable read model 之上**。

#### F4: checkpoint registry

- **输入**：`GET/POST /sessions/{id}/checkpoints`、`GET /sessions/{id}/checkpoints/{id}/diff`
- **输出**：checkpoint 列表、创建结果、message diff
- **主要调用者**：client、manual evidence、support/debug
- **核心逻辑**：checkpoint 至少支持 `turn_end`、`user_named`、`compact_boundary` 三类锚点；diff 第一版只显示 conversation message 差异
- **边界情况**：
  - 第一版不含 file diff
  - 没有任何 checkpoint 时返回空列表，而不是 404
- **一句话收口目标**：✅ **checkpoint 不再只是 DO 内部 latest blob，而成为用户可见 registry**。

#### F5: restore job

- **输入**：`POST /sessions/{id}/checkpoints/{id}/restore` with `{ mode: "conversation_only" }`
- **输出**：restore job 与最终状态
- **主要调用者**：client restore 按钮、support/manual recovery
- **核心逻辑**：先创建 restore job，再做 D1 supersede / DO restore；任一步失败都要显式回滚或标 `rolled_back`
- **边界情况**：
  - restore 后下一次 prompt 不得再看到 superseded message
  - restore 期间 worker 重启也要能从 job state 继续或安全失败
- **一句话收口目标**：✅ **conversation-only restore 是一个可追踪、可回滚、可验证的一等系统动作**。

### 7.3 非功能性要求与验证策略

- **性能目标**：列表分页不能依赖一次读取 200 条后再 regroup；checkpoint diff 查询需要有稳定索引路径。
- **可观测性要求**：close/delete/retry/restore 都要有 activity/audit 记录。
- **稳定性要求**：restore 失败时不能留下“D1 已改、DO 未改”且无 job 记录的半状态。
- **安全 / 权限要求**：所有 lifecycle 操作都继续走 team-scoped auth；delete/restore 需接入 HP5 confirmation。
- **测试覆盖要求**：close、delete、title、retry、checkpoint create/list/diff/restore 至少各 1 条 e2e；另要有 mid-restore restart 场景。
- **验证策略**：以“API response + D1 truth + 下一次会话可见历史”三者一致为准。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent 源码 | HP4 主要参考当前仓库与 Gemini 的 rewind/restore | 不再通过二手 markdown 转述 |

### 8.2 来自 Gemini CLI

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-360` | durable conversation record 初始化/迁移 | 说明 transcript truth 必须可持久恢复 | nano-agent 对应 D1 truth |
| `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157` | checkpoint 同时保存 history、clientHistory、commitHash、messageId | 说明 checkpoint 至少要能定位 conversation 状态 | HP4 第一版先取 conversation truth，不带 file snapshot |
| `context/gemini-cli/packages/core/src/commands/restore.ts:11-58` | restore 先 load history，再尝试恢复外部状态 | restore job 必须有明确步骤与失败反馈 | 适合映射到 D1 + DO 双向同步 |
| `context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198` | UI rewind 会同时刷新 client history 与 context manager | 说明 restore 不是单改后端真相；客户端视图也要切换 | HP4 文档面可借鉴，但 UI 不照抄 |

### 8.3 本仓库 precedent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-17` | `nano_conversations.title` 已存在 | title 应继续落在 conversation 表 | 无需再造平行 title truth |
| `workers/orchestrator-core/src/session-lifecycle.ts:15-39` | 当前 session 状态集已冻结 | close 不应新增 `closed` 新状态 | HP4 复用 `ended + completed` |
| `workers/orchestrator-core/src/session-truth.ts:314-348` | `listSessionsForUser()` 仍是 limit-only | 说明 cursor read model 还没真正闭合 | HP4 必须下沉分页到 D1 |
| `workers/orchestrator-core/src/index.ts:364-440,707-711` | 当前 public session action 不含 close/delete/title/retry/checkpoints | 说明 HP4 产品面尚未存在 | 需要新增 façade contract |
| `workers/orchestrator-core/src/index.ts:885-980` | `/me/conversations` cursor 目前建立在内存聚合上 | 是当前 read model 的可见断点 | HP4 需要修正 |
| `workers/orchestrator-core/src/user-do/surface-runtime.ts:178-218` | 当前已有 resume 面 | HP4 可以把 restore 与 resume 区分清楚，不混为一谈 |
| `workers/agent-core/src/host/do/session-do-persistence.ts:139-186` | Session DO 只有 latest checkpoint 单键 | 这是 HP4 要升级掉的内部-only 形态 |

### 8.4 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `workers/orchestrator-core/src/index.ts:885-980` | façade 先拉 session 再 regroup conversation | 数据量上来后 cursor 不稳定 | HP4 要改成真正 D1 cursor |
| `workers/agent-core/src/host/do/session-do-persistence.ts:139-186` | checkpoint 只有 latest blob、无 registry | 无法形成产品面 restore | HP4 不再沿用这种对外形态 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP4-D1` | close 是否引入新 session 状态？ | HP4 / read models / clients | 否；继续用 `ended + completed` | `frozen` | `workers/orchestrator-core/src/session-lifecycle.ts:15-39` |
| `HP4-D2` | delete 应落 session 还是 conversation？ | HP4 / clients | conversation soft tombstone | `frozen` | `docs/charter/plan-hero-to-pro.md:430-433,628-629`, `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-17`, `workers/orchestrator-core/src/session-truth.ts:314-348` |
| `HP4-D3` | checkpoint/restore 是否继续复用 DO latest checkpoint？ | HP4 / agent-core / clients | 否；必须新增 checkpoint registry + restore job | `frozen` | `docs/charter/plan-hero-to-pro.md:630-635`, `workers/agent-core/src/host/do/session-do-persistence.ts:139-186`, `workers/orchestrator-core/src/index.ts:885-980` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. close/delete/title/retry 各自修改的 durable truth 已经写清。
2. cursor list、conversation detail、checkpoint registry、restore job 的边界没有歧义。
3. retry 与 restore 的区别已冻结，不会在 action-plan 阶段重新混淆。
4. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP4-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP3-context-state-machine.md`
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
- **需要进入 QNA register 的问题**：
  - `若 HP1 schema extension 尚未落地，delete tombstone / retry attempt / checkpoint registry / restore job 的最小 D1 字段集是否作为 HP1 schema correction 一并处理（若 HP1 已 closure，则本题自动视为 not-triggered）`

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

HP4 会以 **lifecycle actions + true cursor read model + checkpoint registry + restore job** 的形式存在，覆盖对话从“生成出来”到“被关闭、被隐藏、被重命名、被重试、被回退”的完整产品面。它与 HP3 的耦合点在于 restore 所消费的 conversation baseline，与 HP5 的耦合点在于 delete/restore 等高风险动作的确认机制。它的复杂度主要来自 D1 truth 与 DO runtime 的一致性，而不是 endpoint 数量本身。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | `5` | chat lifecycle 是客户端真正可感知的产品骨架 |
| 第一版实现的性价比 | `4` | 需要碰 D1、DO、API 三层，但价值直接 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | `5` | restore/retry 是后续复杂调试与回放的核心基础 |
| 对开发者自己的日用友好度 | `5` | title/delete/retry/restore 都是日常高频操作 |
| 风险可控程度 | `3` | D1 与 DO 双向同步有实现风险 |
| **综合价值** | `5` | HP4 会把当前“会话能跑”升级成“对话能管理” |

---

## 附录

### A. 讨论记录摘要（可选）

- **分歧 1**：retry 要不要直接做 fork
  - **A 方观点**：fork 更通用
  - **B 方观点**：fork 会把 HP4 scope 直接炸开
  - **最终共识**：HP4 只做 latest-turn retry；fork 留给 HP7 或更后阶段

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | `2026-04-30` | `GPT-5.4` | 初稿 |
