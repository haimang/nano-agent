# Nano-Agent 行动计划 — HP6 Tool/Workspace State Machine

> 服务业务簇: `hero-to-pro / HP6`
> 计划对象: `把当前只存在于 kernel、artifact 与下游 cancel transport 中的零散工具状态，升级为 todo / workspace temp file / tool inflight / artifact promotion 的统一工作区状态机`
> 类型: `modify + API + protocol + storage + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `packages/nacp-core/src/tenancy/scoped-io.ts`
> - `packages/nacp-session/src/{messages,stream-event}.ts`
> - `workers/orchestrator-core/migrations/004-session-files.sql`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/filesystem-core/src/{index,artifacts}.ts`
> - `workers/agent-core/src/kernel/state.ts`
> - `workers/agent-core/src/host/remote-bindings.ts`
> - `workers/bash-core/src/index.ts`
> - `test/cross-e2e/**`
> - `docs/issue/hero-to-pro/HP6-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP5-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.7 HP6
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP7-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q19-Q21（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `draft`

---

## 0. 执行背景与目标

HP6 不是“给 filesystem-core 再补几个接口”的小修，而是要把当前分散在 artifact store、kernel `pendingToolCalls`、以及 bash/filesystem cancel transport 里的局部骨架，收束成一个真正可查询、可清理、可审计、可跨 turn 持续的工作面。到当前代码现实为止，仓库已经有严格的 `tenants/{team_uuid}/...` 存储前缀 law，也已经有 artifact metadata + artifact R2 key、`pendingToolCalls` 以及 `/capability/cancel` 下行 transport；但 public façade 仍只有 `/sessions/{id}/files`，filesystem-core 仍只有 artifact 三个 RPC，NACP session 协议里也还没有 todo 消息族或 `tool.call.cancelled` 事件。

因此 HP6 的任务，是把“工作区/待办/工具执行”从隐含行为升级为正式产品状态机：todo 成为 durable registry，workspace temp file 获得独立 namespace 与 TTL/cleanup，tool inflight/cancel 获得可观察生命周期，workspace promote 成为带 provenance 的正式 artifact 产出。与此同时，Q19-Q21 已把关键边界冻结：**workspace API 对外以 `virtual_path` 为产品主键、promotion 必须复制成独立 artifact、tool cancel 必须进入统一可观察状态且第一版不纳入 confirmation kind**。

- **服务业务簇**：`hero-to-pro / HP6`
- **计划对象**：`hero-to-pro 的 tool/workspace control plane`
- **本次计划解决的问题**：
  - 当前没有 todo durable truth、workspace temp file CRUD、tool-calls 产品面，用户和调试面只能看到半截状态。
  - filesystem-core 仍是 artifact-only worker，workspace temp file 与 artifact 还没有清晰的 durable truth 分层。
  - cancel transport 已存在，但上层没有 terminal read model 与 `tool.call.cancelled` stream event，客户端无法区分“失败”和“主动取消”。
- **本次计划的直接产出**：
  - todo CRUD、workspace temp file CRUD、tool-calls list/cancel、workspace cleanup、artifact promote/provenance。
  - `session.todos.write` / `session.todos.update` 消息族、`tool.call.cancelled` stream event、agent-core 新 capability 接线。
  - traversal 防御、R2 tenant prefix 测试、24h cleanup job audit、`docs/issue/hero-to-pro/HP6-closure.md`。
- **本计划不重新讨论的设计结论**：
  - workspace temp file 的产品主键是 `virtual_path`，内部稳定引用保留 `temp_file_uuid` 供 HP7 snapshot 使用（来源：`docs/design/hero-to-pro/HPX-qna.md` Q19）。
  - workspace promote 必须复制成独立 artifact；重复 promote 生成新的 `file_uuid`，不得覆盖旧 artifact（来源：`docs/design/hero-to-pro/HPX-qna.md` Q20）。
  - tool cancel 必须拥有 terminal state + `tool.call.cancelled` stream event，payload 含 `cancel_initiator`；第一版不预留 `tool_cancel` confirmation kind（来源：`docs/design/hero-to-pro/HPX-qna.md` Q21）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP6 采用**先建立协议与 durable truth → 再把 workspace CRUD 接到 filesystem-core leaf RPC → 再把 inflight/cancel 投影成产品面 → 最后接 promotion、cleanup 与 e2e 收口** 的顺序。先把 todo/workspace/tool/product surface 的真相层定出来，能避免实现者继续把状态写在 transcript 或下游 worker 内存里；而把 promotion 与 cleanup 放在后半段，则能确保 temp-vs-artifact 分层和 tenant namespace law 已经稳定，不会在收口阶段再出现“cleanup 会不会误删 artifact”的根本性漂移。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Todo + Protocol Surface | M | 建立 todo durable truth、NACP todo 消息族与 façade CRUD | `-` |
| Phase 2 | Workspace Temp File CRUD | M | 建立 temp namespace、filesystem-core 4 RPC、workspace CRUD 与 path normalization | Phase 1 |
| Phase 3 | Tool Inflight + Cancel Surface | M | 让 `pendingToolCalls` 成为 list/cancel/read-model + `tool.call.cancelled` 事实 | Phase 1-2 |
| Phase 4 | Promotion + Cleanup + Namespace Law | M | 完成 workspace→artifact promotion、provenance、24h cleanup 与 traversal 守卫 | Phase 2-3 |
| Phase 5 | E2E + Closure | S | 用 todo/workspace/cancel/promotion/cleanup 端到端证据完成 HP6 closure | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Todo + Protocol Surface**
   - **核心目标**：让 todo 第一次成为 durable 工作面，并补齐 HP6 所需的 session 协议族。
   - **为什么先做**：没有协议面和 todo truth，后面的 workspace/tool 状态仍然无法被统一观察。
2. **Phase 2 — Workspace Temp File CRUD**
   - **核心目标**：把 artifact-only filesystem-core 升级为 workspace-aware leaf worker RPC，同时固定 `virtual_path` 安全 law。
   - **为什么放在这里**：workspace 是 HP6 的主地基；tool inflight、promotion、snapshot 都依赖这层 truth。
3. **Phase 3 — Tool Inflight + Cancel Surface**
   - **核心目标**：让 `pendingToolCalls` 与下游 `/capability/cancel` 变成真正的产品可见状态机。
   - **为什么放在这里**：只有 todo/workspace 已经有 read model 后，tool inflight/cancel 才能被整合进同一工作面。
4. **Phase 4 — Promotion + Cleanup + Namespace Law**
   - **核心目标**：把 temp file 正式 promote 成 artifact，并收口 TTL/cleanup/security。
   - **为什么放在这里**：promotion 与 cleanup 必须建立在 workspace truth 和 cancel/tool 终态都稳定之后。
5. **Phase 5 — E2E + Closure**
   - **核心目标**：证明 D1 truth、R2 对象和 client 可观察状态三者一致。
   - **为什么最后**：只有 todo/workspace/tool/promotion/cleanup 全部连起来，HP6 才能真正收口。

### 1.4 执行策略说明

- **执行顺序原则**：先协议/真相后接口，先 temp workspace 再 artifact promote，先 normalize path 再写 CRUD，先 terminal read model 再推 cancel event。
- **风险控制原则**：filesystem-core 保持 leaf worker，不新开 public workspace fetch；artifact 与 temp file 严格分层；任何 workspace key 都必须走统一 normalization + tenant prefix builder。
- **测试推进原则**：`@haimang/nacp-session`、orchestrator-core、agent-core、filesystem-core、bash-core 测试之外，必须有 todo、workspace 跨 turn、single tool cancel、promote、cleanup、traversal 的 cross-e2e。
- **文档同步原则**：closure 必须同时记录 todo verdict、workspace verdict、cancel verdict、promotion/cleanup verdict。
- **回滚 / 降级原则**：workspace/temp 元数据与 R2 对象采用 storage-first + explicit rollback；cancel 失败与 tool error 必须分两条路径，不得伪装。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP6 tool/workspace state machine
├── Phase 1: Todo + Protocol Surface
│   ├── packages/nacp-session/src/messages.ts
│   ├── /sessions/{id}/todos
│   └── agent-core WriteTodos capability
├── Phase 2: Workspace Temp File CRUD
│   ├── filesystem-core temp-file RPC
│   ├── /sessions/{id}/workspace/files/{*path}
│   └── virtual_path normalization + tenant prefix law
├── Phase 3: Tool Inflight + Cancel Surface
│   ├── pendingToolCalls projection
│   ├── /sessions/{id}/tool-calls
│   └── tool.call.cancelled event + capability/cancel
├── Phase 4: Promotion + Cleanup + Namespace Law
│   ├── /sessions/{id}/artifacts/promote
│   ├── provenance read surface
│   └── session.end + 24h cleanup jobs
└── Phase 5: E2E + Closure
    ├── test/cross-e2e/**
    └── docs/issue/hero-to-pro/HP6-closure.md
```

### 1.6 已核对的当前代码锚点

1. **tenant-scoped storage law 已存在，但还没有 workspace-specific helper**
   - `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79,123-146`
   - 当前项目已经强制 `tenants/{teamUuid}/...`，这正是 HP6 必须复用的底线安全 law。
2. **session 协议目前没有 todo family，stream event 也没有 cancel 终态**
   - `packages/nacp-session/src/messages.ts:56-59,260-319`
   - `packages/nacp-session/src/stream-event.ts:11-27,81-107`
   - 当前只有 `session.start/resume/cancel/.../permission/elicitation` 与 `tool.call.progress/result`，还没有 `session.todos.*` 或 `tool.call.cancelled`。
3. **D1 只有 artifact 元数据 truth，还没有 temp/provenance/cleanup/todo 表**
   - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
   - `nano_session_files` 只有 `r2_key/mime/size_bytes/original_name/created_at`，看不到 workspace temp、cleanup、provenance 列或 todo truth。
4. **orchestrator-core 当前只有 `/sessions/{id}/files`，没有 todo/workspace/tool-calls**
   - `workers/orchestrator-core/src/index.ts:443-460`
   - `workers/orchestrator-core/src/index.ts:1583-1697`
   - 当前 facade 只认 files list/upload/content 三面。
5. **filesystem-core 现在是 artifact-only leaf worker**
   - `workers/filesystem-core/src/index.ts:47-59,83-125`
   - `workers/filesystem-core/src/artifacts.ts:113-170,185-272`
   - 当前 RPC 只有 `readArtifact/writeArtifact/listArtifacts`，artifact key 固定为 `tenants/{team}/sessions/{session}/files/{file_uuid}`。
6. **kernel 已有 `pendingToolCalls`，cancel 下行 transport 也已打通**
   - `workers/agent-core/src/kernel/state.ts:39-65,94-105`
   - `workers/agent-core/src/host/remote-bindings.ts:305-331`
   - `workers/bash-core/src/index.ts:317-329,342-413`
   - 这说明 HP6 不需要从零定义 inflight/cancel，只需要把它从内部 seam 投影到产品面。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** todo durable registry 与 `GET/POST/PATCH/DELETE /sessions/{id}/todos`。
- **[S2]** workspace temp file CRUD：`GET/PUT/DELETE /sessions/{id}/workspace/files/{*path}`、`GET ?prefix=`、`POST /workspace/cleanup`。
- **[S3]** tool call list/cancel：`GET /sessions/{id}/tool-calls`、`POST /sessions/{id}/tool-calls/{request_uuid}/cancel`、`tool.call.cancelled`。
- **[S4]** workspace → artifact promotion 与 `GET /sessions/{id}/artifacts/{file_uuid}/provenance`。
- **[S5]** `virtual_path` normalization、tenant prefix 守卫、24h cleanup policy 与 cleanup job audit。
- **[S6]** HP6 closure 与 todo/workspace/cancel/promotion e2e。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** patch/diff/read-before-write 编辑器。
- **[O2]** todo parent-child DAG / sub-task spawn。
- **[O3]** 直接 public 暴露 filesystem-core workspace fetch。
- **[O4]** HP7 的 checkpoint file snapshot / fork / restore 模式。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| workspace API 对外是否按 UUID | `out-of-scope` | Q19 已冻结产品主键为 `virtual_path`；UUID 只做内部稳定引用 | 不重评；这是 HP6/HP7 衔接法则 |
| promote 是否 alias workspace object | `out-of-scope` | Q20 已冻结必须复制成独立 artifact | 未来若引入 dedupe，需新 phase 重评 |
| tool cancel 是否走 confirmation | `out-of-scope` | Q21 已冻结第一版不走 confirmation，且不预留 `tool_cancel` kind | 仅在 HPX-qna + charter 修订后重评 |
| todo 只保存在 transcript | `out-of-scope` | 与 HP6 “durable 工作面”目标冲突 | 不重评；这是 HP6 核心目标 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | todo durable truth | `update` | orchestrator-core + HP1 todo truth | 让 todo 从 prompt 文本升级为可查询状态面 | `high` |
| P1-02 | Phase 1 | NACP todo family + WriteTodos capability | `update` | `packages/nacp-session/src/messages.ts`, agent-core | 让 LLM 与 client 都能对 todo 做正式交互 | `medium` |
| P2-01 | Phase 2 | temp-file RPC + facade CRUD | `update` | filesystem-core + orchestrator-core | 让 workspace temp namespace 第一次 live | `high` |
| P2-02 | Phase 2 | path normalization + temp-file truth | `update` | normalization helper + D1/R2 write path | 让 `virtual_path` 成为安全产品主键 | `high` |
| P3-01 | Phase 3 | tool-calls read model | `update` | agent-core/orchestrator-core | 让 inflight/terminal tool call 可 list/query | `medium` |
| P3-02 | Phase 3 | cancel surface + cancelled event | `update` | remote bindings + bash-core + stream-event | 让 cancel 成为正式可观察终态 | `high` |
| P4-01 | Phase 4 | artifact promotion provenance | `update` | filesystem-core + orchestrator-core + file truth | 让 temp→artifact 血缘关系可追踪 | `medium` |
| P4-02 | Phase 4 | cleanup jobs + namespace audit | `update` | orchestrator-core cleanup owner + filesystem-core | 让 temp namespace 生命周期与安全边界一起收口 | `high` |
| P5-01 | Phase 5 | workspace/todo/cancel e2e matrix | `add` | `test/cross-e2e/**` | 用端到端场景证明 HP6 真闭环 | `medium` |
| P5-02 | Phase 5 | HP6 closure | `update` | `docs/issue/hero-to-pro/HP6-closure.md` | 让 HP7 能直接消费 HP6 verdict | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Todo + Protocol Surface

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | todo durable truth | 建立 `nano_session_todos` 的 create/read/update/delete 语义，冻结 `status = pending | in_progress | completed | cancelled | blocked` 与 `at most 1 in_progress` 约束 | orchestrator-core + HP1 todo truth | todo 第一次拥有单一 durable owner | D1 assertions + orchestrator-core tests | todo 不再只保存在 transcript 或 prompt |
| P1-02 | NACP todo family + WriteTodos capability | 新增 `session.todos.write` / `session.todos.update` 协议族，并把 agent-core `WriteTodos` capability 接到该 truth | `packages/nacp-session/src/messages.ts`, agent-core capability path | 模型与客户端都能以正式协议改 todo | package tests + agent-core tests | LLM 写 todo 与 HTTP CRUD 命中同一 truth |

### 4.2 Phase 2 — Workspace Temp File CRUD

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | temp-file RPC + facade CRUD | 在 filesystem-core 增加 `readTempFile/writeTempFile/listTempFiles/deleteTempFile`，并在 orchestrator-core 新增 workspace CRUD + cleanup surface | filesystem-core + orchestrator-core | session 第一次拥有真实 workspace temp namespace | filesystem-core/orchestrator-core tests | CRUD live，filesystem-core 仍保持 leaf worker |
| P2-02 | path normalization + temp-file truth | 固定 `normalizeVirtualPath()` 规则：拒绝前导 `/`、`..`、空 segment、`.`、`\`；写入 `nano_session_temp_files` 时同步更新 `expires_at` 与 `cleanup_status=pending` | normalization helper + D1/R2 write path | `virtual_path` 既可用又安全 | security tests + D1/R2 assertions | 所有 workspace key 都通过 normalize + tenant prefix 生成 |

### 4.3 Phase 3 — Tool Inflight + Cancel Surface

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | tool-calls read model | `GET /sessions/{id}/tool-calls?status=` 从 live kernel `pendingToolCalls` + D1 terminal history 组装 inflight/completed/cancelled/error 视图 | agent-core + orchestrator-core | tool call 生命周期第一次可 list/query | integration tests | inflight 与 terminal 视图不再只是下游内部状态 |
| P3-02 | cancel surface + cancelled event | `POST /sessions/{id}/tool-calls/{request_uuid}/cancel` 复用现有 `capability/cancel` transport；下游 ack 后同步写 terminal read model，并 emit `tool.call.cancelled { cancel_initiator }` | remote bindings + bash-core + `packages/nacp-session/src/stream-event.ts` | cancel 变成正式产品事实 | bash-core/agent-core/orchestrator-core tests | cancel 与 error 有明确分流，未知/已终态 request 返回显式错误 |

### 4.4 Phase 4 — Promotion + Cleanup + Namespace Law

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | artifact promotion provenance | `POST /sessions/{id}/artifacts/promote` 读取 temp file，复制字节到新 artifact key，并写 `provenance_kind=workspace_promoted` + `source_workspace_path`；重复 promote 必须生成新 `file_uuid` | filesystem-core + orchestrator-core + file truth | temp 和 artifact 第一次有稳定血缘关系 | integration tests + D1/R2 assertions | promoted artifact 不受 workspace cleanup 影响 |
| P4-02 | cleanup jobs + namespace audit | `POST /sessions/{id}/workspace/cleanup` + session.end + 24h cron；每次 cleanup 写 `nano_workspace_cleanup_jobs`，同时做 traversal / tenant prefix / bypass 单元测试 | orchestrator-core cleanup owner + filesystem-core | HP6 的生命周期与安全审计一起收口 | cleanup tests + security tests | cleanup 不误删 promoted artifact，tenant prefix 无 bypass |

### 4.5 Phase 5 — E2E + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | workspace/todo/cancel e2e matrix | 覆盖 LLM 写 todo、temp file 跨 turn 读回、single tool cancel、promote 后 artifact 可读、cleanup_jobs audit、traversal 防御至少 6 个 cross-e2e | `test/cross-e2e/**` | HP6 在真实链路里闭环 | `pnpm test:cross-e2e` | 6+ 场景全绿，且 D1 truth / R2 / client 可见状态一致 |
| P5-02 | HP6 closure | 回填 todo verdict、workspace verdict、cancel verdict、promotion/cleanup verdict | `docs/issue/hero-to-pro/HP6-closure.md` | HP7 可直接消费 HP6 输出 | doc review | closure 能独立回答“工作区状态机是否已成型” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Todo + Protocol Surface

- **Phase 目标**：让 todo 从 prompt 习惯升级为正式 durable 工作面，并补齐协议面。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/messages.ts`
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及新的 orchestrator-core todo truth helper
  - 可能涉及新的 agent-core todo capability 模块
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-session/src/messages.ts:56-59,260-319`
  - `workers/orchestrator-core/src/index.ts:443-460`
- **具体功能预期**：
  1. todo 会拥有独立 CRUD，而不是散落在 assistant 文本里。
  2. `session.todos.write/update` 会成为正式 session message type。
  3. 同一 session 最多 1 条 `in_progress` 约束会被系统硬化，而不是靠 client 约定。
- **具体测试安排**：
  - **单测**：protocol registry tests、todo constraint tests。
  - **集成测试**：LLM WriteTodos 与 HTTP CRUD 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/nacp-session typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - todo 已经成为可 query / patch / delete 的 durable truth。
  - 协议层和 façade 不再各自表达一套 todo 形状。
- **本 Phase 风险提醒**：
  - 若 todo 继续只保存在 transcript，后续 workspace/cancel/promotion 无法被组织成统一工作面。

### 5.2 Phase 2 — Workspace Temp File CRUD

- **Phase 目标**：建立 workspace temp namespace 与安全的 path/product truth。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `workers/filesystem-core/src/index.ts`
  - `workers/filesystem-core/src/artifacts.ts` 或新 temp-file 模块
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及新的 path normalization helper
- **本 Phase 已核对的源码锚点**：
  - `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79,123-146`
  - `workers/filesystem-core/src/index.ts:83-125`
  - `workers/orchestrator-core/src/index.ts:1583-1697`
- **具体功能预期**：
  1. workspace R2 key 固定为 `tenants/{team}/sessions/{session}/workspace/{virtual_path}`。
  2. `virtual_path` 是产品主键，但内部同时保留 `temp_file_uuid` 作为 immutable snapshot source。
  3. 写入同 hash 内容时只更新 mtime / `last_modified_at`，不重复覆盖对象。
- **具体测试安排**：
  - **单测**：path normalization / traversal tests、temp-file RPC tests。
  - **集成测试**：workspace CRUD + D1/R2 assertions。
  - **回归测试**：
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - workspace temp file 已经独立于 artifact truth。
  - traversal / absolute path / mixed slash 无法穿透 tenant boundary。
- **本 Phase 风险提醒**：
  - 若 normalization helper 没先固定，CRUD 很快会散落成多个“差不多正确”的 path 规则，后续 HP7 snapshot 会直接继承混乱。

### 5.3 Phase 3 — Tool Inflight + Cancel Surface

- **Phase 目标**：让 tool inflight/cancel 成为用户和 support 真能观察与操作的生命周期。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 修改文件**：
  - `workers/agent-core/src/kernel/state.ts`
  - `workers/agent-core/src/host/remote-bindings.ts`
  - `workers/bash-core/src/index.ts`
  - `packages/nacp-session/src/stream-event.ts`
  - `workers/orchestrator-core/src/index.ts`
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/kernel/state.ts:39-65,94-105`
  - `workers/agent-core/src/host/remote-bindings.ts:305-331`
  - `workers/bash-core/src/index.ts:317-329,342-413`
  - `packages/nacp-session/src/stream-event.ts:11-27,81-107`
- **具体功能预期**：
  1. inflight tool list 优先吃 live kernel `pendingToolCalls`，terminal history 吃 D1 ledger。
  2. cancel 继续复用现有 `/capability/cancel`，不再新开第二条 transport。
  3. `tool.call.cancelled` 会明确区分 `cancel_initiator = user | system | parent_cancel`。
- **具体测试安排**：
  - **单测**：cancel read-model tests、event schema tests。
  - **集成测试**：cancel request → downlink RPC → terminal projection → stream event。
  - **回归测试**：
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/bash-core-worker typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/nacp-session typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - 用户能够明确看到“这个 tool 被取消了”，而不是只看到 inflight 消失。
  - cancel 与 tool error 终态、错误码、事件族不再混淆。
- **本 Phase 风险提醒**：
  - 若 cancel 只在 bash-core 内部生效、上游不写终态，客户端仍会把它误判成超时或失败。

### 5.4 Phase 4 — Promotion + Cleanup + Namespace Law

- **Phase 目标**：收口 temp→artifact 血缘、24h cleanup 与 tenant namespace 安全。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 修改文件**：
  - `workers/filesystem-core/src/artifacts.ts` 或 promotion helper
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及新的 cleanup owner / audit helper
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/migrations/004-session-files.sql:6-27`
  - `workers/filesystem-core/src/artifacts.ts:113-170,185-272`
  - `packages/nacp-core/src/tenancy/scoped-io.ts:1-19,35-79`
- **具体功能预期**：
  1. promote 必须复制生成新 artifact key，绝不 alias workspace object。
  2. `provenance_kind = workspace_promoted` 与 `source_workspace_path` 会成为正式可读血缘信息。
  3. default cleanup policy 为 `session.end + 24h`，每次 cleanup 都写 `nano_workspace_cleanup_jobs`。
- **具体测试安排**：
  - **单测**：promotion/provenance tests、cleanup scheduler tests、tenant-prefix tests。
  - **集成测试**：temp file promote 后 artifact 可读且 cleanup 不影响。
  - **回归测试**：
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - repeated promote 同一路径生成新 artifact，不覆盖旧 artifact。
  - cleanup job audit 完整、promoted artifact 不被 temp cleanup 误删。
- **本 Phase 风险提醒**：
  - 如果 artifact 仍引用 workspace key，HP6 的 cleanup 一旦启动就会直接破坏正式产物。

### 5.5 Phase 5 — E2E + Closure

- **Phase 目标**：证明 HP6 的 D1 truth、R2 对象与 client 可见状态已经同真相。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `test/cross-e2e/**`（新增 6+ 场景）
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP6-closure.md`
- **具体功能预期**：
  1. todo/workspace/cancel/promotion/cleanup 都有真实链路证据。
  2. HP6 closure 能独立解释工作区状态机是否已经成型、剩余哪些内容明确留给 HP7。
- **具体测试安排**：
  - **单测**：无新增单测为主。
  - **集成测试**：orchestrator-core + filesystem-core + agent-core + bash-core 联动。
  - **回归测试**：
    - `pnpm test:cross-e2e`
    - `pnpm --filter @haimang/nacp-session typecheck build test`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
    - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
    - `pnpm --filter @haimang/bash-core-worker typecheck build test`
  - **手动验证**：closure 对照 e2e 结果回填。
- **收口标准**：
  - 6+ e2e 全绿。
  - closure 对 todo/workspace/tool/promote/cleanup 都给出明确 verdict。
- **本 Phase 风险提醒**：
  - 若只测 endpoint 200，不核对 D1 truth / R2 object / client event 三层，HP6 很容易出现“接口有了但系统状态面仍不可信”的假收口。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q19 — `virtual_path` 是产品主键 | `docs/design/hero-to-pro/HPX-qna.md` | 决定所有 workspace API、prefix list、promotion 输入都围绕 `virtual_path`；`temp_file_uuid` 只作内部稳定引用 | 若想改成 UUID-first，必须重开 HPX-qna |
| Q20 — promote 复制成独立 artifact | `docs/design/hero-to-pro/HPX-qna.md` | 决定 promotion 必须复制字节并生成新 `file_uuid`，cleanup 不可影响 artifact | 若未来要做 dedupe/reference counting，需新 phase 重评 |
| Q21 — cancel 必须可观察，但不进 confirmation | `docs/design/hero-to-pro/HPX-qna.md` | 决定 `tool.call.cancelled` 必须存在，且第一版不新增 `tool_cancel` kind | 若未来要把 cancel 纳入 confirmation，必须先修 QNA + charter |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP1 truth 依赖 | HP6 依赖 temp/provenance/cleanup/todo 目标 schema 已由 HP1 冻结 | `high` | HP6 不私补真相边界；若字段缺失，只能走 HP1 correction law |
| traversal / namespace bypass | `virtual_path` 若未统一 normalize，将直接威胁租户边界 | `high` | Phase 2 先固定 helper，再写 CRUD；补 traversal 单测 |
| temp 与 artifact 生命周期混淆 | promote 若 alias workspace object，cleanup 会误删 artifact | `high` | 强制复制新 artifact key，并把 provenance 写入正式 truth |
| cancel 上下游分裂 | bash-core 成功 cancel 但 orchestrator 不投影终态，client 会一直看到 inflight | `medium` | cancel handler 必须同步写 terminal projection + event |
| cleanup 漏执行 | cron/job 只停留在配置层，会导致 temp 对象长期泄漏 | `medium` | cleanup job 每次必写 audit 行，并做 end+24h 验证 |

### 7.2 约束与前提

- **技术前提**：filesystem-core 继续是 leaf worker；workspace CRUD 只能通过 service-binding RPC；artifact 与 temp file 必须分层。
- **运行时前提**：继续复用已有 `pendingToolCalls` 与 `/capability/cancel` transport，不另造第二套 cancel 通道。
- **组织协作前提**：path normalization helper 必须先定型，不能边实现边散落在多个 handler 内。
- **上线 / 合并前提**：todo、workspace、cancel、promotion、cleanup 五面都有 D1/R2/client 三层证据。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`（回填 HP6 workspace truth 作为 HP7 snapshot/fork 基面）
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`（若 closure 需要说明 cancel 未纳入 confirmation 的冻结边界）
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP6-closure.md`
- 需要同步更新的测试说明：
  - `test/index.md` 或相关 e2e 入口说明（若新增 todo/workspace/tool-calls 场景）

### 7.4 完成后的预期状态

1. todo、workspace temp file、tool inflight/cancel、artifact promotion 会第一次拥有统一的产品状态面。
2. filesystem-core 会从 artifact-only leaf worker 升级为 workspace-aware leaf worker，但仍不暴露 public workspace fetch。
3. client/support 将第一次能稳定回答“当前在做什么、工作区里有什么、哪个 tool 被取消了、artifact 从哪来”。
4. HP7 会第一次消费到稳定的 workspace truth、temp file UUID、cleanup lineage，而不是凭空假设文件基面已经存在。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `session.todos.write/update` 已进入 `packages/nacp-session/src/messages.ts`。
  - 检查 `tool.call.cancelled` 已进入 `packages/nacp-session/src/stream-event.ts`。
  - 检查 facade 已暴露 todo/workspace/tool-calls/promote/provenance surface。
- **单元测试**：
  - `pnpm --filter @haimang/nacp-session typecheck build test`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - `pnpm --filter @haimang/filesystem-core-worker typecheck build test`
  - `pnpm --filter @haimang/bash-core-worker typecheck build test`
- **集成测试**：
  - todo truth + workspace CRUD + cancel transport + promotion provenance + cleanup job
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`
- **回归测试**：
  - LLM 写 todo、temp file 跨 turn 读回、single tool cancel、promote 后 artifact 可读、cleanup audit、traversal 防御至少 6 场景
- **文档校验**：
  - `docs/issue/hero-to-pro/HP6-closure.md` 必须同时记录 todo / workspace / cancel / promotion / cleanup 五层 verdict

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. todo 状态机端到端 live，LLM `WriteTodos` 与 HTTP CRUD 同真相。
2. workspace temp file CRUD 已通过 filesystem-core 真 R2 接线，而非 in-memory 假实现。
3. tool call inflight + single tool cancel + `tool.call.cancelled` 已 live，能区分 cancel 与 error。
4. workspace → artifact promotion、24h cleanup、tenant prefix/traversal 防御都已被 e2e/单测证明。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | todo / workspace / tool-calls / promotion / cleanup 五个产品面已完整闭环 |
| 测试 | `nacp-session`、orchestrator-core、agent-core、filesystem-core、bash-core 测试通过，cross-e2e 覆盖 6+ 场景 |
| 文档 | HP6 closure 能独立解释工作区状态机的五层结果 |
| 风险收敛 | 无 tenant prefix bypass、无 temp/artifact 串线、无 cancel 假终态 |
| 可交付性 | HP7 可直接在 HP6 提供的 workspace/temp-file/provenance truth 之上实现 snapshot/revert/fork |
