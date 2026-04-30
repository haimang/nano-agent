# Nano-Agent 功能簇设计

> 功能簇: `HP6 Tool/Workspace State Machine`
> 讨论日期: `2026-04-30`
> 讨论者: `Owner + GPT-5.4`
> 关联基线文档:
> - `docs/charter/plan-hero-to-pro.md`
> 关联源码锚点:
> - `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79,123-146`
> - `packages/nacp-session/src/messages.ts:56-59,260-319`
> - `packages/nacp-session/src/stream-event.ts:11-27,81-107`
> - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
> - `workers/orchestrator-core/src/index.ts:443-460,1583-1697`
> - `workers/filesystem-core/src/index.ts:47-59,83-125`
> - `workers/filesystem-core/src/artifacts.ts:90-170,185-272`
> - `workers/agent-core/src/kernel/state.ts:39-65,94-105`
> - `workers/agent-core/src/kernel/types.ts:41-67`
> - `workers/agent-core/src/host/remote-bindings.ts:305-331`
> - `workers/bash-core/src/index.ts:317-329,342-413`
> 关联 QNA / 决策登记:
> - `docs/design/hero-to-pro/HPX-qna.md`（已冻结；本设计若与 QNA 冲突，以 QNA 为准）
> 文档状态: `reviewed`
> 外部 precedent 说明: 当前工作区已 vendored `context/` 源文件；文中出现的 `context/*` 仅作为外部 precedent / ancestry pointer，不能替代当前仓库代码、frozen QNA 与 charter 作为执行证据。

---

## 0. 背景与前置约束

当前 nano-agent 已经具备了“artifact 文件”和“tool inflight”的局部骨架，但还远没有形成 HP6 要求的完整 Tool/Workspace 状态机：

1. 仓库里已经有严格的租户前缀 law：`tenantKey()` 会把所有 R2/KV/DO storage key 强制收敛到 `tenants/{teamUuid}/...`，而且源码注释明确要求所有存储访问都必须走这些 helper（`packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79,123-146`）。
2. filesystem-core 现在仍然只暴露 `readArtifact / writeArtifact / listArtifacts` 三个 RPC，public fetch 也仍然只有 `/health`，说明“workspace temp file CRUD”今天并不存在（`workers/filesystem-core/src/index.ts:47-59,83-125`）。
3. 当前 artifact R2 key 已稳定为 `tenants/{team_uuid}/sessions/{session_uuid}/files/{file_uuid}`，D1 里的 `nano_session_files` 也只有 `r2_key / mime / size_bytes / original_name / created_at` 这组基础元数据，还没有 workspace provenance、temp file、cleanup job 真相（`workers/filesystem-core/src/artifacts.ts:113-170,185-272`; `workers/orchestrator-core/migrations/004-session-files.sql:6-27`）。
4. orchestrator-core façade 当前也只有 `/sessions/{id}/files` list/upload/content 三个 file surface，没有 `/workspace/files/*`、`/todos`、`/tool-calls/{id}/cancel` 这些产品面（`workers/orchestrator-core/src/index.ts:443-460,1583-1697`）。
5. 但 agent-core kernel 并非完全没有底座：`TurnState` 已有 `pendingToolCalls`，scheduler 已经围绕它驱动 `tool_exec`；bash-core 也已经 live 了 `/capability/cancel`，agent-core remote binding 也已经能向下游发 cancel（`workers/agent-core/src/kernel/state.ts:39-65,94-105`; `workers/agent-core/src/host/remote-bindings.ts:305-331`; `workers/bash-core/src/index.ts:317-329,342-413`）。
6. 现有 NACP session 消息族仍停留在 `start/resume/cancel/end/permission/elicitation/attachment.superseded`，stream event 也只有 `tool.call.progress/result` 等基础 kind，还没有 todo 家族与 `tool.call.cancelled`（`packages/nacp-session/src/messages.ts:56-59,260-319`; `packages/nacp-session/src/stream-event.ts:11-27,81-107`）。

- **项目定位回顾**：HP6 要做的不是“再加几个 endpoint”，而是把 todo、workspace temp files、tool inflight、workspace -> artifact promotion 收敛成一套可持久化、可恢复、可清理、可做安全审查的系统状态机。
- **本次讨论的前置共识**：
  - filesystem-core 继续保持 leaf worker；workspace CRUD 只能通过 service-binding RPC，不新增 public fetch 面。
  - 当前代码并没有 `nano_session_todos`、`nano_session_temp_files`、`nano_workspace_cleanup_jobs` 等真表；HP6 讨论的是 **目标设计**，不是回溯宣称这些表已存在。
  - artifact 与 workspace temp file 必须是两种不同的 durable truth；不能拿 `nano_session_files` 直接假装 workspace。
  - multi-tenant R2 边界是 HP6 的 hard requirement，不是实现后附带补的安全测试。
- **本设计必须回答的问题**：
  - todo 要不要成为第一类 durable object，还是继续做 prompt 内文本约定？
  - workspace temp file 用 UUID 还是用虚拟路径作为产品主键？
  - tool cancel 的可观察真相应该落在哪里，如何与现有 `pendingToolCalls` 对齐？
  - workspace promote 到 artifact 时，如何保证后续 cleanup 不会误删已发布产物？
- **显式排除的讨论范围**：
  - patch/diff 模式编辑器
  - parent-child task graph / sub-agent todo DAG
  - HP7 的 checkpoint file snapshot / fork

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`HP6 Tool/Workspace State Machine`
- **一句话定义**：`把 LLM 的待办、临时工作区文件、进行中的 tool call 与最终 artifact promote，统一成一个有 durable truth、有清理策略、有租户边界校验的工具工作面。`
- **边界描述**：这个功能簇**包含** todo registry、workspace temp file CRUD、tool call inflight/cancel、workspace -> artifact promotion、R2 namespace safety；**不包含** patch 编辑器、fork snapshot、checkpoint 恢复。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| todo | agent loop 对当前 session 维护的一条任务项 | 是 durable read model，不是 prompt 注释 |
| workspace temp file | session 级临时文件 | 生命周期受 session 与 cleanup policy 约束 |
| artifact | 用户可下载/复用的正式文件 | 与 temp file 分开存活 |
| promotion | 把 workspace temp file 变成 artifact | 必须保留 provenance |
| inflight tool call | 已发起但尚未收到终态 result 的 tool call | 与 kernel `pendingToolCalls` 对齐 |
| virtual path | workspace 文件对外暴露的逻辑路径 | 不是绝对路径，不接受 `..` |

### 1.2 参考源码与现状锚点

- `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79,123-146` — 当前仓库已经把 `tenants/{team_uuid}/...` 作为跨 R2/KV/DO storage 的统一 law。
- `packages/nacp-session/src/messages.ts:56-59,260-319` — 现有 session 消息族还没有 todo family，说明 HP6 需要新增协议面，而不是只补 façade endpoint。
- `packages/nacp-session/src/stream-event.ts:11-27,81-107` — 现有 stream 只有 `tool.call.progress/result`，没有 cancel/update/todo 事件。
- `workers/orchestrator-core/migrations/004-session-files.sql:6-27` — 当前 D1 只有 artifact 元数据表，没有 workspace temp/provenance/cleanup truth。
- `workers/orchestrator-core/src/index.ts:443-460,1583-1697` — façade 今天仍只有 `/sessions/{id}/files`，不是 workspace 产品面。
- `workers/filesystem-core/src/index.ts:47-59,83-125` 与 `workers/filesystem-core/src/artifacts.ts:113-170,185-272` — filesystem-core 今天只会操作 artifact，不会操作 workspace temp file。
- `workers/agent-core/src/kernel/state.ts:39-65,94-105` 与 `workers/agent-core/src/kernel/types.ts:41-67` — kernel 已有 `pendingToolCalls`，但还没有 todo/workspace 级能力面。
- `workers/agent-core/src/host/remote-bindings.ts:305-331` 与 `workers/bash-core/src/index.ts:317-329,342-413` — cancel 向 bash-core 下行的 transport seam 已经真实存在。
- `context/gemini-cli/packages/core/src/config/storage.ts:185-189,317-365` — Gemini 把 temp dir 做成 project-scoped，并把 `plans/tracker/tasks` 做成 session-scoped子目录，说明“工作区临时状态”应有独立、可清理的存储边界。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- HP6 在整体架构里扮演 **tool execution workspace owner**。
- 它服务于：
  - tool-heavy agent loop 的显式 todo 与工作区读写
  - client 的 todo/workspace/tool-call 状态面
  - artifact 生成前的临时文件沉淀与最终 promote
  - HP7 之前的最小文件持久化骨架
- 它依赖：
  - tenant-scoped storage helper
  - filesystem-core leaf worker RPC
  - agent-core kernel 的 `pendingToolCalls`
  - HP1 目标 schema 中的 temp-file / cleanup / provenance truth
- 它被谁依赖：
  - future clients/web / wechat 对 todo/workspace 的 UI
  - HP7 checkpoint file snapshot
  - support/debug 对 cancel / cleanup / promotion 的排查

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| filesystem-core | HP6 <-> FS | 强 | workspace CRUD 与 artifact promote 最终都要进 filesystem-core |
| agent-core kernel | HP6 <-> kernel | 强 | inflight tool call 与 todo capability 都在 agent loop 内发生 |
| HP5 Confirmation | HP5 -> HP6 | 中 | tool cancel / workspace cleanup 可挂统一 confirmation plane |
| HP7 Checkpoint | HP6 -> HP7 | 强 | HP7 的 file snapshot 必须建立在 HP6 的 workspace truth 上 |
| clients/web | HP6 -> client | 中 | todo/workspace/tool-call 都是用户可见状态 |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`HP6 Tool/Workspace State Machine` 是 **tool 执行与临时工作区的统一状态所有者**，负责 **把 todo、workspace temp files、tool inflight/cancel 与 artifact promote 统一成可查询、可恢复、可清理、可审计的 durable truth**，对上游提供 **真正可编程的工作区产品面**，对下游要求 **R2/D1/agent kernel 的状态边界保持一致且不可跨租户串线**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 在 filesystem-core 直接开放 public workspace fetch | 直觉上更省事 | 会打破 leaf worker / binding-scope guard | 否 |
| 直接拿 `nano_session_files` 兼任 workspace temp file | 当前已有 files 表 | artifact 与 temp file 生命周期完全不同 | 否 |
| 把 todo 只做成 prompt 约定 | 实现最少 | 无法 list/query/recover，也无法约束 `at most 1 in_progress` | 否 |
| 第一版就做 patch/diff 编辑 | 需求容易扩张 | 会让 HP6 与 editor 语义纠缠，打散闭环 | hero-to-platform 重评 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| todo API | `/sessions/{id}/todos` | CRUD + 单条 in-progress 约束 | future 可扩 DAG / labels |
| workspace file API | `/sessions/{id}/workspace/files/{*path}` | 整文件 CRUD + prefix list | future 可扩 patch/diff |
| tool call surface | `/sessions/{id}/tool-calls` | list + cancel | future 可扩 retry / rerun |
| promotion provenance | `nano_session_files` provenance 列 | 记录来源 workspace path | future 可扩 richer lineage graph |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：workspace temp file 与 artifact。
- **解耦原因**：temp file 需要 TTL 与 cleanup，artifact 需要稳定下载与长期引用；如果共用同一真相，cleanup 会误伤正式产物。
- **依赖边界**：promotion 只能从 workspace 复制到 artifact，不能让 artifact 反向引用 workspace key。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：todo truth、workspace temp file truth、cleanup jobs、tool call cancel 终态。
- **聚合形式**：统一收敛到 orchestrator-core 的 D1 truth + filesystem-core RPC + agent-core kernel state。
- **为什么不能分散**：如果 todo 在 memory、workspace 在 R2、cancel 只在 bash-core 内存结束、cleanup 另记一套日志，用户永远看不到一致的 session 工作面。

---

## 4. 参考实现 / 历史 precedent 对比

> 本节 precedent 以当前仓库源码锚点为 authoritative evidence；若出现 `context/*`，仅作 external ancestry pointer。

### 4.1 Gemini CLI 的做法

- **实现概要**：Gemini 的 storage 层先把 temp dir 固定为 project-scoped，再把 `checkpoints / logs / plans / tracker / tasks` 等目录放入 project temp 下；其中 `plans / tracker / tasks` 在有 `sessionId` 时进一步进入 `.../{sessionId}/...` 子目录（`context/gemini-cli/packages/core/src/config/storage.ts:185-189,317-365`）。
- **亮点**：
  - “临时工作状态”有明确的 project/session 双层边界
  - plans/tasks 与 durable chat history 没有混成一类真相
- **值得借鉴**：
  - nano-agent 的 workspace temp file 应当成为独立命名空间，而不是混入 artifact
  - session-scoped 清理边界要从第一版就做出来
- **不打算照抄的地方**：
  - 直接搬 Gemini 的本地文件系统目录结构

### 4.2 当前仓库的 precedent / 反例

- **实现概要**：当前仓库已经具备三块有价值的骨架：第一，tenant-scoped storage helper 已经把 `tenants/{team_uuid}/...` 作为统一 law（`packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79,123-146`）；第二，filesystem-core 的 artifact R2 key 已经证明 `tenants/{team}/sessions/{session}/...` 的命名可以真实落地（`workers/filesystem-core/src/artifacts.ts:113-170,185-272`）；第三，tool cancel 的 transport seam 已经从 agent-core 通到 bash-core（`workers/agent-core/src/host/remote-bindings.ts:305-331`; `workers/bash-core/src/index.ts:317-329,342-413`）。
- **亮点**：
  - tenant prefix law 与 leaf-worker RPC 边界已经是可复用的对路骨架
  - `pendingToolCalls` 让 HP6 不必从零发明 inflight tool 概念
- **值得借鉴**：
  - workspace key 命名继续沿用 `tenants/{team}/sessions/{session}/...`
  - cancel transport 继续复用现有 `capability/cancel`
- **不打算照抄的地方**：
  - 继续把 filesystem-core 限定在 artifact-only
  - 继续让 `pendingToolCalls` 只停留在 kernel 内部，而不投影到产品面

### 4.3 横向对比速查表

| 维度 | Gemini CLI | 当前 nano-agent | HP6 倾向 |
|------|------------|-----------------|----------|
| 临时工作区边界 | project/session scoped temp dirs | 仅 artifact R2 key | 增加 workspace temp namespace |
| tool inflight | 有任务/计划目录配套 | kernel 内有 `pendingToolCalls` | 增加 list/cancel 产品面 |
| 正式产物与临时产物分离 | 有 | 仅 artifact 已分离 | 严格保持 temp vs artifact 分层 |
| 多租户前缀 law | N/A | 已有统一 helper | 继续强制执行并补 traversal 测试 |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** todo durable truth + `GET/POST/PATCH/DELETE /sessions/{id}/todos`。
- **[S2]** workspace temp file CRUD：`GET/PUT/DELETE /sessions/{id}/workspace/files/{*path}` + `GET ?prefix=` + `POST /workspace/cleanup`。
- **[S3]** tool call list/cancel：`GET /sessions/{id}/tool-calls` + `POST /sessions/{id}/tool-calls/{request_uuid}/cancel`。
- **[S4]** workspace -> artifact promotion：`POST /sessions/{id}/artifacts/promote` + provenance read。
- **[S5]** `virtual_path` 规范化与 R2 namespace 安全审查。
- **[S6]** default `session.end + 24h` cleanup policy 与 cleanup job audit。

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** patch/diff/read-before-write 编辑器 —— 留到 hero-to-platform。
- **[O2]** todo parent-child DAG / sub-task spawn —— 不在 HP6 第一版。
- **[O3]** 直接 public 暴露 filesystem-core workspace 接口 —— 不做。
- **[O4]** HP7 的 checkpoint file snapshot / fork —— 由 HP7 处理。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| todo 是否只保存在 transcript | out-of-scope | transcript 只能记录说过什么，不能承担当前状态查询 | HP6 建独立 durable truth |
| workspace file 是否用 UUID 做主键 | out-of-scope | 用户与模型都围绕路径思考，不是围绕 opaque file id | HP6 用 `virtual_path` |
| promoted artifact 是否可继续引用 workspace R2 key | out-of-scope | cleanup 会误删或串线 | HP6 promotion 必须复制并写 provenance |
| cancel 是否等同于 tool result error | out-of-scope | 用户与系统需要区分“执行失败”和“主动取消” | HP6 增加单独终态 / event |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **把 todo 做成 D1 durable truth**，而不是 **继续让模型把 todo 写进普通消息**
   - **为什么**：HP6 的价值之一就是“外部可以 list/query/patch 当前任务面”；纯 transcript 做不到这个目标。
   - **我们接受的代价**：需要引入额外的 D1 表与一致性约束。
   - **未来重评条件**：无。

2. **取舍 2**：我们选择 **workspace 以 `virtual_path` 为主键**，而不是 **再造一层 UUID temp file id**
   - **为什么**：工作区文件天生是路径语义；如果 API 对外暴露 UUID，模型与客户端都要额外做映射。
   - **我们接受的代价**：必须严肃处理 path normalization 与 traversal 防御。
   - **未来重评条件**：无；路径语义是这类工作区的自然边界。

3. **取舍 3**：我们选择 **promotion 复制生成新 artifact**，而不是 **让 artifact 直接 alias workspace object**
   - **为什么**：workspace file 自带 TTL 与 cleanup，而 artifact 需要稳定引用与下载。
   - **我们接受的代价**：promotion 会有一次额外复制成本。
   - **未来重评条件**：当 R2 dedupe / reference counting 有成熟方案时。

4. **取舍 4**：我们选择 **tool cancel 有单独终态与 stream event**，而不是 **把取消伪装成 generic error**
   - **为什么**：support/debug/客户端都需要区分 user cancel 与 tool failure。
   - **我们接受的代价**：协议面要新增 cancel event 与 read model 组装。
   - **未来重评条件**：无。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| `virtual_path` traversal 绕过租户边界 | 接受 `..`、绝对路径、反斜杠混淆 | 跨目录/跨租户读写 | 统一 `normalizeVirtualPath()`，拒绝 `..`、前导 `/`、空 segment、`\` |
| D1 truth 与 R2 对象不同步 | 先写一侧后一侧失败 | workspace 列表与真实对象分裂 | 以 storage-first + explicit rollback 方式落盘，失败行标 terminal error |
| cancel 只在下游生效、上游状态未更新 | bash-core 成功 cancel，但 façade 不写终态 | client 仍看到 inflight | cancel handler 必须同步写 read model 与 stream event |
| cleanup 误删 promoted artifact | artifact 继续引用 workspace key | 用户下载 404 | promotion 复制到 artifact key，workspace cleanup 只看 temp namespace |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：todo/workspace/tool-call 从“模型隐含行为”变成“系统显式状态”，排障成本会大幅下降。
- **对 nano-agent 的长期演进**：没有 HP6，HP7 的 checkpoint file snapshot 就没有稳定的文件基面，client 也无法做可见的工作区。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：tool-heavy agent loop 只有在 workspace/todo/cancel 可观测后，才真正具备产品化空间。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | todo durable registry | 统一 session todo 的 CRUD 与状态约束 | ✅ 系统第一次有真正可查询的 todo 面 |
| F2 | workspace temp file truth | 独立的 workspace temp namespace + CRUD + cleanup | ✅ temp file 不再伪装成 artifact |
| F3 | tool inflight / cancel | inflight list、cancel、cancelled event | ✅ tool call 生命周期第一次可见且可中断 |
| F4 | artifact promotion provenance | 从 workspace promote 到 artifact，并保留来源 | ✅ 正式产物与临时产物关系可追踪 |
| F5 | namespace security + cleanup jobs | traversal 防御、tenant prefix law、cleanup audit | ✅ HP6 在安全与生命周期上可收口 |

### 7.2 详细阐述

#### F1: todo durable registry

- **输入**：模型写出的 todo 列表、客户端 patch/delete 请求
- **输出**：session 级 todo list/read model
- **主要调用者**：agent-core `WriteTodos` capability、client、support/debug
- **核心逻辑**：
  - 新增目标 truth：`nano_session_todos`
  - 最小字段冻结为：
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
  - façade 暴露：
    - `GET /sessions/{id}/todos`
    - `POST /sessions/{id}/todos`
    - `PATCH /sessions/{id}/todos/{todo_uuid}`
    - `DELETE /sessions/{id}/todos/{todo_uuid}`
  - NACP 新增：
    - `session.todos.write`
    - `session.todos.update`
- **边界情况**：
  - 同一 session 同时最多 1 条 `in_progress`
  - `DELETE` 第一版直接删除 row；历史 lineage 依赖消息 / 审计面，而不是 `deleted_at`
  - 若未来需要 `title` / `details_json` / 显式排序，只能作为 API projection 或 `content` 约定，不得回改 HP1 DDL freeze
- **一句话收口目标**：✅ **todo 第一次成为 durable 工作面，而不是 prompt 里的文本习惯**。

#### F2: workspace temp file truth

- **输入**：workspace file 的 list/read/write/delete/cleanup 请求
- **输出**：session 级 temp file namespace 与 D1 元数据
- **主要调用者**：agent-core 新 capability、client、future checkpoint
- **核心逻辑**：
  - workspace R2 key 固定为 `tenants/{team_uuid}/sessions/{session_uuid}/workspace/{virtual_path}`
  - `virtual_path` 规范化规则冻结为：
    1. 必须使用 `/` 分隔
    2. 拒绝前导 `/`
    3. 拒绝 `..`
    4. 拒绝空 segment、`.`、`\`
    5. 规范化后再落 R2 与 D1，禁止原样透传
  - 新增目标 truth：`nano_session_temp_files`
  - 最小字段冻结为：
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
  - filesystem-core 新 RPC：
    - `readTempFile`
    - `writeTempFile`
    - `listTempFiles`
    - `deleteTempFile`
  - orchestrator-core façade 新 surface：
    - `GET /sessions/{id}/workspace/files/{*path}`
    - `PUT /sessions/{id}/workspace/files/{*path}`
    - `DELETE /sessions/{id}/workspace/files/{*path}`
    - `GET /sessions/{id}/workspace/files?prefix=...`
    - `POST /sessions/{id}/workspace/cleanup`
  - 写入时若内容 hash 未变，则仅更新 `last_modified_at`，不重复覆盖对象
  - 默认 TTL 为 `session.end + 24h`
- **边界情况**：
  - active session 可手动 cleanup，但不得删除被 promotion 锁定的 path
  - session 未结束时不执行默认 TTL 清理
  - list 必须按 prefix 工作，而不是把整个 namespace 一次性扫回客户端
  - `cleanup_status` 只表达生命周期调度状态；失败明细进入 `nano_workspace_cleanup_jobs` / audit，不在 temp-file 行内自创 terminal enum
- **一句话收口目标**：✅ **session 第一次拥有独立、可查询、可清理的临时工作区**。

#### F3: tool inflight / cancel

- **输入**：kernel `pendingToolCalls`、client cancel 请求、下游 capability cancel 结果
- **输出**：inflight tool read model、cancel 终态、stream event
- **主要调用者**：client、support/debug、scheduler
- **核心逻辑**：
  - `GET /sessions/{id}/tool-calls?status=inflight|completed|cancelled|error`
  - `POST /sessions/{id}/tool-calls/{request_uuid}/cancel`
  - list 组装策略：
    - `status=inflight` 优先读取 live kernel/DO 状态
    - terminal history 读取 D1 message ledger 的 tool request/result/cancel 记录
  - stream 新增 `tool.call.cancelled`
  - cancel 下行继续复用 `capability/cancel` transport，不新开第二条 RPC
  - 下游 worker 返回 cancel ack 后，facade 必须同步写 terminal read model，并推 `tool.call.cancelled`
- **边界情况**：
  - 对已终态 request_uuid 再次 cancel 返回 conflict/not-cancellable
  - 对未知 request_uuid 返回 404，而不是静默成功
  - cancel 失败与 tool 本身 error 必须分成两个 code path
- **一句话收口目标**：✅ **tool call 第一次拥有“看得见、停得住、能区分取消与失败”的生命周期**。

#### F4: artifact promotion provenance

- **输入**：workspace `virtual_path`
- **输出**：新的 artifact row + provenance metadata
- **主要调用者**：client、future restore/diff、support/debug
- **核心逻辑**：
  - `POST /sessions/{id}/artifacts/promote`
  - `GET /sessions/{id}/artifacts/{file_uuid}/provenance`
  - `nano_session_files.provenance_kind` 全枚举冻结为：
    - `user_upload`
    - `agent_generated`
    - `workspace_promoted`
    - `compact_summary`
    - `checkpoint_restored`
  - promote 流程冻结为：
    1. 读取 temp file 当前元数据与 R2 对象
    2. 生成新的 artifact `file_uuid`
    3. 复制字节到 artifact key：`tenants/{team}/sessions/{session}/files/{file_uuid}`
    4. 写 `nano_session_files` 目标 provenance 列：
        - `provenance_kind = workspace_promoted`
        - `source_workspace_path`
        - `source_session_uuid = NULL`
  - artifact 一经 promote，不再受 workspace cleanup TTL 影响
- **边界情况**：
  - 不允许直接 promote 不存在或已过期的 temp file
  - 同一路径重复 promote 合法，但必须生成新 artifact row，而不是覆盖旧 artifact
  - 其余 provenance kinds 由 upload / compact / restore / fork 写入，HP6 只负责 `workspace_promoted`
- **一句话收口目标**：✅ **正式产物与临时工作区第一次有可追溯的血缘关系**。

#### F5: namespace security + cleanup jobs

- **输入**：path 请求、session end 事件、scheduled cleanup 扫描
- **输出**：安全拒绝、cleanup job audit、过期 temp file 删除
- **主要调用者**：orchestrator cron、filesystem-core、security review
- **核心逻辑**：
  - 所有 workspace R2 key 必须通过统一 `normalizeVirtualPath()` + tenant prefix builder 生成
  - cleanup job 以 orchestrator-core 为 owner：它持有 D1 truth，filesystem-core 只负责对象操作
  - 每次 cleanup 必写一行 `nano_workspace_cleanup_jobs`，至少包含：
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
  - traversal / absolute path / mixed slash 命中时直接 400，不做自动修复
  - cleanup 遇到单文件失败时 job 标 `failed`，失败明细进 audit / error log，不额外给 cleanup_jobs 自造 `failed_count`
- **一句话收口目标**：✅ **HP6 从第一版就把安全边界和生命周期审计一起收口**。

### 7.3 非功能性要求与验证策略

- **性能目标**：workspace list 默认分页/前缀过滤；promotion 与 cleanup 不做全桶扫描。
- **可观测性要求**：todo/write/delete、workspace write/delete/cleanup、tool cancel、artifact promotion 都必须进入统一日志/审计面。
- **稳定性要求**：worker 重启后，todo/workspace/tool terminal truth 仍以 D1/R2 为准重建。
- **安全 / 权限要求**：team-scoped authority、tenant prefix、path normalization 三层同时成立；任一失败都要拒绝。
- **测试覆盖要求**：
  - todo live CRUD + `at most 1 in_progress`
  - workspace 跨 turn 读回
  - single tool cancel
  - workspace promote 后 artifact 可读
  - traversal / prefix bypass 无法突破
  - session end + 24h cleanup job audit 正确写入
- **验证策略**：以“D1 truth、R2 对象、client 可观察状态”三者一致为准。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次未直接采用 mini-agent 源码 | HP6 主要参考当前仓库与 Gemini 的 workspace 存储边界 | 不再通过二手 markdown 转述 |

### 8.2 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `N/A` | 本批次没有直接采用 claude-code 的 workspace/todo 源码 | HP6 关注的是 durable workspace 与 tenant namespace，而非 Claude 的进程内工作流 | 本节保持空缺，不做二手引用 |

### 8.3 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `context/gemini-cli/packages/core/src/config/storage.ts:185-189` | project temp dir 统一收敛到稳定目录 | 说明临时工作状态应与 durable history 分层 | HP6 借鉴 temp namespace 分层 |
| `context/gemini-cli/packages/core/src/config/storage.ts:317-365` | checkpoints/logs/plans/tracker/tasks 以 project/session 两层组织 | 说明 session-scoped temp state 应有明确清理边界 | HP6 借鉴 workspace/session 作用域 |

### 8.4 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---------|------------------|----------------------|
| `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79,123-146` | 所有存储访问都必须进入 `tenants/{team_uuid}/...` 前缀 | HP6 的 workspace key 继续遵守同一 law |
| `workers/filesystem-core/src/index.ts:47-59,83-125` | filesystem-core 当前只公开 `/health`，RPC 只含 artifact 三件套 | HP6 不打破 leaf-worker 边界，只在 RPC 面扩 workspace 操作 |
| `workers/filesystem-core/src/artifacts.ts:113-170,185-272` | artifact key 与 D1 record 已稳定存在 | promotion 继续复用这套 artifact finalization 模式 |
| `workers/orchestrator-core/migrations/004-session-files.sql:6-27` | 当前 files truth 只有 artifact 元数据 | 这是 HP6 需要补 temp/provenance truth 的直接断点 |
| `workers/orchestrator-core/src/index.ts:443-460,1583-1697` | façade 只有 `/sessions/{id}/files` | 说明 workspace 产品面目前确实缺席 |
| `workers/agent-core/src/kernel/state.ts:39-65,94-105` | kernel 已有 `pendingToolCalls` | inflight tool 不是从零开始，HP6 要把它投影到产品面 |
| `workers/agent-core/src/host/remote-bindings.ts:305-331` 与 `workers/bash-core/src/index.ts:317-329,342-413` | cancel 下行 transport 已打通 | HP6 直接复用，而不是重造一套 cancel RPC |
| `packages/nacp-session/src/messages.ts:260-319` 与 `packages/nacp-session/src/stream-event.ts:81-107` | 当前协议里没有 todo family 与 cancel event | 这是 HP6 需要明确补齐的协议断点 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

| Q ID / 决策 ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|----------------|------|----------|----------|------|----------|
| `HP6-D1` | workspace temp file 对外是否使用 UUID，而不是路径？ | HP6 / clients / HP7 | 否；以 `virtual_path` 作为产品主键 | `frozen` | `docs/charter/plan-hero-to-pro.md:437,739-741`, `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79`, `workers/filesystem-core/src/artifacts.ts:113-170,185-272` |
| `HP6-D2` | promotion 是 alias 现有 workspace object，还是复制成独立 artifact？ | HP6 / cleanup / restore | 复制成独立 artifact | `frozen` | `docs/charter/plan-hero-to-pro.md:438,741`, `workers/filesystem-core/src/artifacts.ts:117-170,268-272`, `workers/orchestrator-core/migrations/004-session-files.sql:6-27` |
| `HP6-D3` | tool cancel 是否继续只作为下游内部动作，不进入统一可观察状态？ | HP6 / client / debug | 否；要有 terminal state + stream event | `frozen` | `docs/charter/plan-hero-to-pro.md:740,742-743`, `workers/agent-core/src/host/remote-bindings.ts:305-331`, `workers/bash-core/src/index.ts:317-329,342-413`, `packages/nacp-session/src/stream-event.ts:81-107` |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. todo/workspace/tool-call/promotion 的 durable truth 已写清。
2. `virtual_path` normalization 与 tenant prefix law 已冻结。
3. cleanup job 与 TTL 行为已明确，不依赖隐式约定。
4. 所有会影响 action-plan 执行顺序的前置问题都已在本设计或 QNA 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - `docs/action-plan/hero-to-pro/HP6-action-plan.md`
- **需要同步更新的设计文档**：
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`
  - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`
- **实现前额外提醒**：
  - HP6 代码实现必须先把 path normalization helper 固定，再写 CRUD 与 cleanup；不能边写边散落各处。

---

## 10. Value Verdict

### 10.1 价值结论

`HP6 Tool/Workspace State Machine` 值得做，而且必须在 hero-to-pro 阶段落地。原因不是“客户端想看 todo”，而是 **没有 HP6，tool-heavy agent loop 仍然缺少真正的工作状态面**：todo 只是文本、workspace 只是想象、cancel 只是下游内部动作、artifact 也无法说明来源。

### 10.2 对 charter 目标的支撑度

它直接支撑：

1. hero-to-pro 对“可恢复、可控制、可审计 agent loop”的目标
2. HP7 checkpoint file snapshot 的前置文件真相
3. future clients/web 与 wechat 对工作区、待办、取消的产品化能力

### 10.3 当前建议

- **建议状态**：`approved-for-action-plan`
- **原因**：当前断点、目标边界、协议扩展、存储分层与安全策略都已经足够清楚，可以进入 action-plan 与实现阶段。
