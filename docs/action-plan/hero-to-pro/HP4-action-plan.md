# Nano-Agent 行动计划 — HP4 Chat Lifecycle

> 服务业务簇: `hero-to-pro / HP4`
> 计划对象: `把当前“会话能跑”的内部 truth 升级为可关闭、可隐藏、可命名、可重试、可列锚点、可 conversation-only restore 的对话生命周期控制面`
> 类型: `modify + API + D1 + runtime + test`
> 作者: `Owner + GPT-5.4`
> 时间: `2026-04-30`
> 文件位置:
> - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`
> - `workers/orchestrator-core/src/session-lifecycle.ts`
> - `workers/orchestrator-core/src/session-truth.ts`
> - `workers/orchestrator-core/src/index.ts`
> - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
> - `workers/agent-core/src/host/do/session-do-persistence.ts`
> - `workers/agent-core/src/host/do/session-do-runtime.ts`
> - `test/cross-e2e/**`
> - `docs/issue/hero-to-pro/HP4-closure.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HP3-action-plan.md`
> - `docs/charter/plan-hero-to-pro.md` §7.5 HP4
> 下游交接:
> - `docs/action-plan/hero-to-pro/HP5-action-plan.md`
> 关联设计 / 调研文档:
> - `docs/design/hero-to-pro/HP4-chat-lifecycle.md`
> - `docs/design/hero-to-pro/HPX-qna.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md` Q13-Q15、Q38（只读引用；本 action-plan 不填写 Q/A）
> 文档状态: `executing`

---

## 0. 执行背景与目标

HP4 不是“给 session 多补几个按钮”的表层增量，而是要把当前已经存在的 D1 会话真相、半成品 façade 列表、以及 DO 内部 checkpoint seam，收束成真正可管理的 chat lifecycle。到当前代码现实为止，`nano_conversations.title` 已经存在，但 `ended_reason`、`deleted_at`、checkpoint registry、restore job 这些产品级 durable truth 还不在现状代码里；public façade 也仍然只暴露 `start/input/cancel/status/timeline/history/verify/ws/usage/resume/messages/files`，还没有 close/delete/title/retry/checkpoints/conversation detail。

因此 HP4 的任务，是把“会话存在”升级为“对话可管理”：让 close/delete/title/retry 成为正式产品面，让 `/me/sessions` 与 `/me/conversations` 从 façade regroup 升级为真实 cursor read model，让 checkpoint registry / diff / restore job 建立在 HP1 冻结的 durable truth 上，而不是继续冒充 DO latest checkpoint。与此同时，Q13-Q15 和条件题 Q38 已把关键边界拍死：**close 不增新状态、delete 落 conversation soft tombstone、restore 不得复用 DO latest checkpoint、若 HP1 未 closure 默认不走 HP4 collateral DDL**。

- **服务业务簇**：`hero-to-pro / HP4`
- **计划对象**：`hero-to-pro 的 chat lifecycle control plane`
- **本次计划解决的问题**：
  - 当前 public façade 没有 `close/delete/title/retry/checkpoints` 与 `GET /conversations/{conversation_uuid}`，客户端仍缺真正的 conversation lifecycle surface。
  - `listSessionsForUser()` 仍是 limit-only，`/me/conversations` 仍在 façade 内存 regroup，导致 cursor read model 并未闭合。
  - Session DO 目前只有内部单键 latest checkpoint，与产品级 checkpoint registry / diff / restore job 不是一回事。
- **本次计划的直接产出**：
  - `POST /sessions/{id}/close`、`DELETE /sessions/{id}`、`PATCH /sessions/{id}/title`、`POST /sessions/{id}/retry`。
  - `/me/sessions` / `/me/conversations` 真 cursor 化、`GET /conversations/{conversation_uuid}`、checkpoint list/create/diff/restore。
  - restore job + D1/DO 一致性回滚路径 + `docs/issue/hero-to-pro/HP4-closure.md`。
- **本计划不重新讨论的设计结论**：
  - close 不引入新 session state；继续使用 `session_status = ended`，并以 `ended_reason` 表达 `closed_by_user` 等终止原因（来源：`docs/design/hero-to-pro/HPX-qna.md` Q13）。
  - delete 落在 conversation 维度，第一版只冻结 `nano_conversations.deleted_at`，不新增 undelete 产品面或 `deleted_by_user_uuid`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q14）。
  - 产品级 checkpoint / restore 不得直接复用 DO latest checkpoint，source-of-truth 顺序固定为 `D1 checkpoint registry → D1 message ledger → DO snapshot`（来源：`docs/design/hero-to-pro/HPX-qna.md` Q15）。

---

## 1. 执行综述

### 1.1 总体执行方式

HP4 采用**先补 lifecycle surface 与 durable 语义 → 再统一 retry/read model → 再把 checkpoint registry 产品面做出来 → 最后接 restore job 与回滚一致性**的顺序。先把“关闭 / 删除 / 命名 / 列表 / 详情”这些用户可见控制面和 read model 定下来，能避免 restore/retry 继续建立在模糊的半成品会话视图之上；而把 restore 放在 checkpoint registry 之后，则能保证 restore 消费的是已经成型的 checkpoint truth，而不是实现期临时拼出来的 latest blob。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Lifecycle Surface + Durable Semantics | M | 建立 close/delete/title 产品面，并把其 durable owner 对齐到 HP1 freeze | `-` |
| Phase 2 | Retry + Cursor Read Models | M | 建立 latest-turn retry 与真正的 session/conversation cursor read model | Phase 1 |
| Phase 3 | Checkpoint Registry + Diff Surface | M | 让 checkpoint 从 DO latest key 升级成 list/create/diff 的产品资产 | Phase 1-2 |
| Phase 4 | Restore Job + D1/DO Consistency | M | 落地 conversation_only restore、回滚与 restart-safe 一致性 | Phase 3 |
| Phase 5 | E2E + Closure | S | 用 close/delete/title/retry/restore 端到端证据完成 HP4 closure | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — Lifecycle Surface + Durable Semantics**
   - **核心目标**：让 close/delete/title 第一次成为正式对话管理面。
   - **为什么先做**：没有 lifecycle surface，retry/read model/restore 都会继续建立在“会话只是能跑起来”的旧心智上。
2. **Phase 2 — Retry + Cursor Read Models**
   - **核心目标**：让 latest-turn retry 和 conversation/session 列表都建立在真正 durable read model 上。
   - **为什么放在这里**：retry 需要明确的 turn/session/conversation owner；cursor 也必须在 checkpoint/restore 前稳定下来。
3. **Phase 3 — Checkpoint Registry + Diff Surface**
   - **核心目标**：让 checkpoint 先成为可列举、可命名、可对比的产品面。
   - **为什么放在这里**：restore 必须依赖 registry truth，不能越过 registry 直接碰 DO latest blob。
4. **Phase 4 — Restore Job + D1/DO Consistency**
   - **核心目标**：把 restore 变成有 job、有回滚、有 source-of-truth 顺序的正式系统动作。
   - **为什么放在这里**：只有 registry/diff/read model 都稳定后，restore 才能被证明“恢复的是哪一个历史锚点”。
5. **Phase 5 — E2E + Closure**
   - **核心目标**：证明 API、D1 truth、DO restore 与后续对话可见历史是同一真相。
   - **为什么最后**：只有 lifecycle、retry、checkpoint、restore 全部连起来，closure 才能回答 HP4 是否真的完成。

### 1.4 执行策略说明

- **执行顺序原则**：先 lifecycle control plane，后 retry/read model，先 registry 再 restore，先 durable truth 再 client-visible 行为。
- **风险控制原则**：不新增 `closed` 状态、不引入 undelete、不让 DO latest checkpoint 冒充产品面；若 HP1 schema 仍未闭合，只能按 Q38 走 owner 批准的 correction law。
- **测试推进原则**：orchestrator-core 与 agent-core 单测之外，必须有 close/delete/title/retry/checkpoint/restore 的 cross-e2e，并覆盖 mid-restore restart。
- **文档同步原则**：closure 必须同时记录 API verdict、D1 verdict、restore job verdict、下一次会话可见历史 verdict。
- **回滚 / 降级原则**：restore 一律先写 job，再改 D1 supersede，再触发 DO restore；任何一步失败都必须显式 `rolled_back` 并反标 D1，而不是留下半状态。

### 1.5 本次 action-plan 影响结构图

```text
hero-to-pro HP4 chat lifecycle
├── Phase 1: Lifecycle Surface + Durable Semantics
│   ├── workers/orchestrator-core/src/index.ts
│   ├── close / delete / title routes
│   └── HP1 ended_reason / deleted_at truth
├── Phase 2: Retry + Cursor Read Models
│   ├── workers/orchestrator-core/src/session-truth.ts
│   ├── /me/sessions + /me/conversations + GET /conversations/{id}
│   └── latest-turn retry / attempt chain
├── Phase 3: Checkpoint Registry + Diff Surface
│   ├── checkpoint list/create/diff
│   └── HP1 checkpoint registry truth
├── Phase 4: Restore Job + D1/DO Consistency
│   ├── restore job orchestration
│   ├── D1 supersede / rollback
│   └── agent-core DO restore seam
└── Phase 5: E2E + Closure
    ├── test/cross-e2e/**
    └── docs/issue/hero-to-pro/HP4-closure.md
```

### 1.6 已核对的当前代码锚点

1. **D1 只有会话/对话基础表，还没有 HP4 所需的 tombstone / restore durable truth**
   - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-38,41-84`
   - 当前 `nano_conversations` 只有 `title`，`nano_conversation_sessions` 只有 `session_status/started_at/ended_at`；还看不到 `deleted_at`、`ended_reason`、checkpoint registry、restore job 这些 HP4 依赖真相。
2. **session 生命周期当前只有 6 个状态与 3 个 terminal kind**
   - `workers/orchestrator-core/src/session-lifecycle.ts:15-39`
   - 现状只有 `pending|starting|active|detached|ended|expired` 与 `completed|cancelled|error`，这正是 Q13 要求“close 不增新状态、而是消费 HP1 ended_reason”的直接原因。
3. **public façade 目前还没有 close/delete/title/retry/checkpoints**
   - `workers/orchestrator-core/src/index.ts:364-440,707-711`
   - 现有 `SessionAction` 只认 `start/input/cancel/status/timeline/history/verify/ws/usage/resume/messages/files`，加上旧的 permission/elicitation/policy compound actions。
4. **当前列表 read model 仍是 limit-only + façade regroup，不是真 cursor**
   - `workers/orchestrator-core/src/session-truth.ts:318-348`
   - `workers/orchestrator-core/src/index.ts:885-980`
   - `listSessionsForUser()` 仍只支持 `LIMIT ?3`，`/me/conversations` 仍先拉 session 再按 `conversation_uuid` 内存 group。
5. **User DO 只有 resume / legacy answer surface，还没有 lifecycle mutation 面**
   - `workers/orchestrator-core/src/user-do/surface-runtime.ts:178-218,221-320`
   - 现在能看到 `resume`、`permission/decision`、`elicitation/answer`，但没有 close/delete/title/retry/checkpoint/restore 的真正 write path。
6. **agent-core 当前 checkpoint 仍是内部 latest key，不是 registry**
   - `workers/agent-core/src/host/do/session-do-persistence.ts:142-186,193-222`
   - `persistCheckpoint()` / `restoreFromStorage()` 只围绕单个 `CHECKPOINT_STORAGE_KEY` 工作，这个 seam 可被 restore 消费，但不能直接冒充产品级 checkpoint list/diff/restore job。
7. **外部 precedent 已核对并支持 HP4 的 transcript / restore 分层**
   - `context/gemini-cli/packages/core/src/services/chatRecordingService.ts:303-360`, `context/gemini-cli/packages/core/src/utils/checkpointUtils.ts:84-157`, `context/gemini-cli/packages/core/src/commands/restore.ts:11-58`, `context/gemini-cli/packages/cli/src/ui/commands/rewindCommand.tsx:40-90,143-198`
   - precedent 共同说明 rewind / restore 不能只改单一内存游标，而要同时处理 durable transcript、恢复锚点与客户端可见状态；HP4 吸收“restore 必须有明确 job / verdict”的原则，不照抄外部 UI 流程。

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `POST /sessions/{id}/close`、`DELETE /sessions/{id}`、`PATCH /sessions/{id}/title` 的正式 lifecycle control plane。
- **[S2]** latest-turn retry、attempt chain、supersede truth 与 `/me/sessions` / `/me/conversations` 真 cursor 化。
- **[S3]** `GET /conversations/{conversation_uuid}` conversation detail read model。
- **[S4]** checkpoint list/create/diff 与 `POST /sessions/{id}/checkpoints/{id}/restore { mode: "conversation_only" }`。
- **[S5]** restore job、D1/DO 一致性回滚、mid-restore restart 安全性。
- **[S6]** HP4 closure 与 lifecycle/retry/restore cross-e2e 证据。

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** files-only / conversation_and_files restore 与 file diff。
- **[O2]** session fork / branch tree。
- **[O3]** 自动 title 生成。
- **[O4]** undelete 产品面、硬删除 audit ledger、额外 `deleted_by_user_uuid` 列。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| close 是否新增 `closed` 状态 | `out-of-scope` | Q13 已冻结 close 复用 `ended`，差异由 `ended_reason` 表达 | 仅在 lifecycle charter 被正式重写时重评 |
| delete 是删 session 还是删 conversation | `in-scope` | Q14 已冻结为 conversation soft tombstone | 若未来出现 session-level archive 产品面 |
| 产品级 restore 是否复用 DO latest checkpoint | `out-of-scope` | Q15 已冻结必须走独立 registry + restore job | 不重评；这是 HP4 核心法律 |
| HP1 未 closure 时直接由 HP4 私补 DDL | `defer / not-triggered` | Q38 已冻结默认不允许，除非 owner 明确批准 collateral correction | 仅在执行顺序被打破时触发 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | lifecycle route surface | `update` | `workers/orchestrator-core/src/index.ts`, User DO surface | 让 close/delete/title 从缺席变成正式产品面 | `medium` |
| P1-02 | Phase 1 | terminal/tombstone durable semantics | `update` | session lifecycle + session truth + HP1 truth consumer | 让 close/delete/title 写到正确 durable owner | `high` |
| P2-01 | Phase 2 | latest-turn retry | `update` | orchestrator-core session/turn truth | 让“再试一次”成为 attempt chain，而不是重写旧 turn | `high` |
| P2-02 | Phase 2 | true cursor read models | `update` | `workers/orchestrator-core/src/session-truth.ts`, `src/index.ts` | 让 session/conversation list/detail 建立在真正 D1 cursor 上 | `high` |
| P3-01 | Phase 3 | checkpoint registry surface | `update` | orchestrator-core façade + checkpoint truth | 让 checkpoint 可 list/create，不再只是内部 blob | `medium` |
| P3-02 | Phase 3 | checkpoint diff | `update` | checkpoint diff projection | 让 checkpoint 能解释 message supersede 差异 | `medium` |
| P4-01 | Phase 4 | restore job orchestration | `update` | orchestrator-core + agent-core DO seam | 让 restore 成为有 job、有 SoT 顺序的正式动作 | `high` |
| P4-02 | Phase 4 | rollback + restart safety | `update` | restore coordinator + DO restore seam | 让 mid-restore failure 不留下半状态 | `high` |
| P5-01 | Phase 5 | lifecycle/retry/restore e2e matrix | `add` | `test/cross-e2e/**` | 用端到端场景证明 chat lifecycle 真闭环 | `medium` |
| P5-02 | Phase 5 | HP4 closure | `update` | `docs/issue/hero-to-pro/HP4-closure.md` | 让 HP5/HP7 能直接消费 HP4 verdict | `low` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Lifecycle Surface + Durable Semantics

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | lifecycle route surface | 新增 `POST /sessions/{id}/close`、`DELETE /sessions/{id}`、`PATCH /sessions/{id}/title`；保持 session-based path，但 delete/title 的 durable owner 仍是 parent conversation | `workers/orchestrator-core/src/index.ts`, User DO surface/runtime | lifecycle action 第一次出现在 public façade | orchestrator-core route tests | 三个 action 全 live，auth/team scope 正确 |
| P1-02 | terminal/tombstone durable semantics | close 写 `session_status=ended` + `ended_reason=closed_by_user`；delete 写 `nano_conversations.deleted_at`；title 继续写 `nano_conversations.title`；若 HP1 truth 未到位，按 Q38 保持 blocked 而非私补 DDL | session lifecycle + session truth | lifecycle 动作终于写入正确 durable owner | D1 assertions + orchestrator-core tests | close 不新增新状态；delete 只做 soft tombstone；title 不分叉出 session title |

### 4.2 Phase 2 — Retry + Cursor Read Models

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | latest-turn retry | `POST /sessions/{id}/retry` 只允许最近一个 retryable turn，基于 HP1 turn-attempt/supersede truth 创建新 attempt，旧输出保留为历史证据 | orchestrator-core session/turn truth | “再试一次”成为 durable system action | D1 attempt chain tests | retry 不覆盖旧 turn，不伪装成 fork |
| P2-02 | true cursor read models | 把 `/me/sessions`、`/me/conversations` 下沉到真实 cursor query，并新增 `GET /conversations/{conversation_uuid}` 聚合 title、tombstone、latest session、session summaries | `workers/orchestrator-core/src/session-truth.ts`, `src/index.ts` | 列表/详情不再靠 façade regroup | repo tests + API tests | cursor 稳定；tombstoned conversation 默认过滤；detail 与 list 不漂移 |

### 4.3 Phase 3 — Checkpoint Registry + Diff Surface

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | checkpoint registry surface | `GET /sessions/{id}/checkpoints`、`POST /sessions/{id}/checkpoints` 接到 HP1 `nano_session_checkpoints`；第一版支持 `turn_end`、`user_named`、`compact_boundary`，用户创建时 `file_snapshot_status=none` | orchestrator-core façade + checkpoint truth | checkpoint 第一次变成用户可见 registry | orchestrator-core tests | 空列表返回空集合而非 404；create 可命名 |
| P3-02 | checkpoint diff | 新增 `GET /sessions/{id}/checkpoints/{id}/diff`，第一版只返回 conversation message diff / superseded ledger，不做 file diff | checkpoint diff projection | checkpoint 不再只是“一个点”，而能解释变化 | D1 diff tests | diff 可解释 superseded message 集，且不误入 file diff |

### 4.4 Phase 4 — Restore Job + D1/DO Consistency

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | restore job orchestration | `POST /sessions/{id}/checkpoints/{id}/restore` 先写 restore job，再按 `D1 checkpoint registry → D1 message ledger → DO snapshot` 顺序执行 `conversation_only` restore，并在成功后回填 `status=succeeded` | orchestrator-core + agent-core DO seam | restore 成为一等系统动作 | integration tests + D1/DO assertions | restore 后下一次 prompt 不再看 superseded message |
| P4-02 | rollback + restart safety | 若 D1 supersede 后 DO restore 失败，则 restore job 标 `rolled_back` 并反标 D1；worker restart 后可重试或安全失败，不留无主半状态 | restore coordinator + `restoreFromStorage()` seam | mid-restore failure 不再留下脏状态 | restart scenario tests | `rolled_back` 明确可见，D1/DO truth 最终一致 |

### 4.5 Phase 5 — E2E + Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | lifecycle/retry/restore e2e matrix | 覆盖 close、delete、title、retry、checkpoint create/list/diff/restore、mid-restore restart 至少 6 个 cross-e2e；建议文件名使用 `chat-close-delete-title` / `chat-retry-turn-attempt` / `chat-checkpoint-list-diff` / `chat-restore-conversation` / `chat-restore-mid-restart` / `chat-conversation-cursor` 描述性前缀；若采用编号文件，必须为 HP5 预留 `15-18` | `test/cross-e2e/**` | chat lifecycle 在真实链路里闭环 | `pnpm test:cross-e2e` | 6+ 场景全绿，且 API + D1 + next prompt 一致 |
| P5-02 | HP4 closure | 回填 lifecycle verdict、cursor/detail verdict、checkpoint/restore verdict、rollback verdict，并显式登记 F1-F17 chronic status（`closed / partial / not-touched / handed-to-platform`） | `docs/issue/hero-to-pro/HP4-closure.md` | HP5/HP7 可直接消费 HP4 输出 | doc review | closure 能独立回答“对话是否已经真正可管理” |

---

## 5. Phase 详情

### 5.1 Phase 1 — Lifecycle Surface + Durable Semantics

- **Phase 目标**：让 close/delete/title 第一次成为正式对话管理面，并写到正确 durable owner。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/session-lifecycle.ts`
  - `workers/orchestrator-core/src/session-truth.ts`
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts`
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/src/session-lifecycle.ts:15-39`
  - `workers/orchestrator-core/src/index.ts:364-440,707-711`
  - `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql:7-38`
- **具体功能预期**：
  1. close 不新增 `closed` 状态，而是通过 `ended_reason=closed_by_user` 表达主动关闭。
  2. delete 虽走 `/sessions/{id}` path，但真正落到 parent conversation 的 `deleted_at`。
  3. title 继续以 `nano_conversations.title` 为唯一真相，不平行落 session title。
- **具体测试安排**：
  - **单测**：orchestrator-core route + lifecycle mapping tests。
  - **集成测试**：close/delete/title 的 D1 owner 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - close/delete/title 三个动作对客户端可见、对 D1 可追溯。
  - close 与 cancel 不再只能靠“都 ended 了”猜测区别。
- **本 Phase 风险提醒**：
  - 若实现时又把 close 做成新状态，HP4 会立刻与 Q13 和全仓 status switch 漂移。

### 5.2 Phase 2 — Retry + Cursor Read Models

- **Phase 目标**：让 retry 与 session/conversation list/detail 一起建立在真正 durable read model 上。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/session-truth.ts`
  - `workers/orchestrator-core/src/index.ts`
  - 可能涉及新的 lifecycle/read-model helper 模块
- **本 Phase 已核对的源码锚点**：
  - `workers/orchestrator-core/src/session-truth.ts:318-348`
  - `workers/orchestrator-core/src/index.ts:885-980`
- **具体功能预期**：
  1. retry 只允许最近一个 retryable turn，且通过 attempt chain + supersede truth 表达。
  2. `/me/sessions` 和 `/me/conversations` 不再先拉 200 条 session 再 regroup。
  3. `GET /conversations/{conversation_uuid}` 能直接回答对话当前 title、tombstone、latest session 与 summaries。
- **具体测试安排**：
  - **单测**：session truth cursor tests、retry eligibility tests。
  - **集成测试**：conversation detail / retry D1 assertions。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - cursor 稳定，不因 façade regroup 漏项或重项。
  - retry 不覆盖旧输出，不与 restore 混成一个动作。
- **本 Phase 风险提醒**：
  - 若 retry 继续直接重写旧 turn/message，support/debug 需要的历史证据会被永久污染。

### 5.3 Phase 3 — Checkpoint Registry + Diff Surface

- **Phase 目标**：让 checkpoint 先成为可管理的 registry，再谈 restore。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/session-truth.ts`
  - 可能涉及新的 checkpoint projection helper
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/do/session-do-persistence.ts:142-186`
  - `workers/orchestrator-core/src/index.ts:364-440`
- **具体功能预期**：
  1. checkpoint list/create 消费 HP1 registry truth，而不是暴露 DO latest blob。
  2. 用户创建 checkpoint 时可以命名，但第一版不带 file snapshot。
  3. diff 只解释 message supersede 差异，不越界到 files restore。
- **具体测试安排**：
  - **单测**：checkpoint projection / diff tests。
  - **集成测试**：checkpoint list/create/diff API + D1 assertions。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - **手动验证**：无额外手工步骤。
- **收口标准**：
  - checkpoint 成为可 list/create/diff 的正式产品面。
  - diff 结果可以解释 restore 前后 message 变化。
- **本 Phase 风险提醒**：
  - 若 registry 仍偷用 DO latest key，HP4 表面有 restore，实际上仍没有 checkpoint 产品语义。

### 5.4 Phase 4 — Restore Job + D1/DO Consistency

- **Phase 目标**：把 restore 变成可追踪、可回滚、可 restart-safe 的系统动作。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/session-truth.ts`
  - `workers/agent-core/src/host/do/session-do-persistence.ts`
  - `workers/agent-core/src/host/do/session-do-runtime.ts`
  - 可能涉及新的 restore coordinator 模块
- **本 Phase 已核对的源码锚点**：
  - `workers/agent-core/src/host/do/session-do-persistence.ts:193-222`
  - `workers/agent-core/src/host/do/session-do-persistence.ts:288-385`
- **具体功能预期**：
  1. restore job 先创建，再进入 D1 supersede / DO restore / consistency verification。
  2. restore 以 `conversation_only` 为唯一 mode，不带 files restore。
  3. DO restore 失败时，job 进入 `rolled_back`，D1 supersede 反标，不留半状态。
- **具体测试安排**：
  - **单测**：restore coordinator tests、rollback tests。
  - **集成测试**：D1 checkpoint registry → message ledger → DO snapshot 对撞。
  - **回归测试**：
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：mid-restore restart 场景验证。
- **收口标准**：
  - restore 后下一次 prompt 不再看到 superseded message。
  - restore 失败时可从 job 状态与 D1 ledger 解释现场。
- **本 Phase 风险提醒**：
  - D1 与 DO 之间没有天然事务；如果没有显式 rollback law，就会留下最难排查的“看起来像成功”的假恢复。

### 5.5 Phase 5 — E2E + Closure

- **Phase 目标**：证明 chat lifecycle 已从内部能力升级为真正产品面。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
- **本 Phase 新增文件**：
  - `test/cross-e2e/**`（新增 6+ 场景）
- **本 Phase 修改文件**：
  - `docs/issue/hero-to-pro/HP4-closure.md`
- **具体功能预期**：
  1. close/delete/title/retry/checkpoint/restore/mid-restore restart 都有端到端证据。
  2. HP4 closure 能独立回答生命周期、cursor、restore 一致性是否已经成型。
- **具体测试安排**：
  - **单测**：无新增单测为主。
  - **集成测试**：orchestrator-core + agent-core + D1 restore chain。
  - **回归测试**：
    - `pnpm test:cross-e2e`
    - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
    - `pnpm --filter @haimang/agent-core-worker typecheck build test`
  - **手动验证**：closure 对照 e2e 结果回填。
- **收口标准**：
  - 6+ e2e 全绿。
  - closure 对 close/delete/title/retry/restore 的 verdict 不含模糊留白。
- **本 Phase 风险提醒**：
  - 若只验证 API 200，而不核对 D1 truth 与 restore 后下一次 prompt，HP4 会出现典型 deceptive closure。

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q13 — close 不新增状态 | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP4 只能沿用 `ended`，并消费 `ended_reason=closed_by_user` | 若执行期又想加 `closed`，必须退回 design/QNA |
| Q14 — delete 为 conversation soft tombstone | `docs/design/hero-to-pro/HPX-qna.md` | 决定 delete 写 `nano_conversations.deleted_at`，且不增 undelete / `deleted_by_user_uuid` | 若未来要 session-level archive，需新开 design |
| Q15 — restore 不复用 DO latest checkpoint | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP4 必须建立 registry + restore job，并遵守 `D1 checkpoint registry → D1 message ledger → DO snapshot` | 不重评；这是 HP4 骨架 |
| Q38 — HP1 未 closure 时默认不走 collateral DDL | `docs/design/hero-to-pro/HPX-qna.md` | 决定 HP4 对 schema 缺口默认 blocked，而不是私补 migration | 仅在 owner 明确批准时启动 correction law |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| HP1 truth 依赖 | HP4 依赖 `ended_reason`、`deleted_at`、turn-attempt、checkpoint/restore tables | `high` | HP4 不私补 DDL；默认等待 HP1 closure，缺口按 Q38 处理 |
| D1 + DO restore 非事务 | restore 横跨 D1 ledger 与 DO snapshot，两侧失败模式不同 | `high` | 先写 restore job，再按顺序执行，并显式 `rolled_back` |
| cursor 漂移 | 若 `/me/conversations` 继续先拉 session 再 regroup，分页一定不稳定 | `high` | 把 cursor query 下沉到 repo/D1，禁止 façade 聚合冒充 read model |
| retry / restore 语义混淆 | 实现时最容易把 retry 做成 restore 最近 checkpoint 或 fork | `medium` | retry 只针对 latest retryable turn；restore 只针对 checkpoint registry |
| delete 过滤误伤审计 | tombstone 若做成硬删，会破坏 support/debug 证据 | `medium` | 保留 audit ledger；只在默认 list/detail 过滤 tombstoned conversation |

### 7.2 约束与前提

- **技术前提**：HP1 已提供 `ended_reason`、turn-attempt/supersede truth、checkpoint registry 与 restore job 表；HP3 已冻结 `compact_boundary` checkpoint 语义。
- **运行时前提**：DO latest checkpoint 只作为 restore seam，被 HP4 消费，但绝不直接暴露为产品 registry。
- **组织协作前提**：delete/restore 的确认动作不在 HP4 自行发明第二套 confirmation；后续统一消费 HP5 control plane。
- **上线 / 合并前提**：API、D1 truth、restore job、next prompt、restart rollback 五层证据齐全。

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`（如 HP4 最终明确 delete/restore 的 confirmation consumer payload）
  - `docs/design/hero-to-pro/HP7-checkpoint-and-restore.md`（如 HP4 closure 需要回填 source-of-truth 顺序消费结果）
- 需要同步更新的说明文档 / README：
  - `docs/issue/hero-to-pro/HP4-closure.md`
- 需要同步更新的测试说明：
  - `test/index.md` 或相关 e2e 入口说明（若新增 lifecycle/revert restart 场景）

### 7.4 完成后的预期状态

1. close/delete/title/retry 会成为正式 chat lifecycle API，而不是客户端自行拼装的假动作。
2. `/me/sessions`、`/me/conversations` 与 `GET /conversations/{id}` 会建立在真实 cursor/read model 上。
3. checkpoint 会成为可 list/create/diff/restore 的产品资产，而不再只是 DO latest blob。
4. HP5/HP7 将第一次消费到稳定的 lifecycle / restore durable truth，而不是半成品会话视图。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 检查 `close/delete/title/retry/checkpoints/restore` 路由已存在，且 auth/team scope 正确。
  - 检查 `/me/conversations` / `/me/sessions` 不再依赖 façade regroup 假 cursor。
- **单元测试**：
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck build test`
  - `pnpm --filter @haimang/agent-core-worker typecheck build test`
- **集成测试**：
  - lifecycle actions + D1 truth + restore job + DO snapshot consistency
- **端到端 / 手动验证**：
  - `pnpm test:cross-e2e`
- **回归测试**：
  - close、delete、title、retry、checkpoint create/list/diff/restore、mid-restore restart 至少 6 场景
- **前序 phase 回归**：
  - 至少回归 HP2 的模型切换 / fallback 场景与 HP3 的 compact / next-prompt 场景，确认 lifecycle / retry / restore 不把既有 transcript truth 打断。
- **文档校验**：
  - `docs/issue/hero-to-pro/HP4-closure.md` 必须同时记录 API / D1 / restore-job / next-prompt verdict
  - `docs/issue/hero-to-pro/HP4-closure.md` 必须显式登记 F1-F17 chronic status

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. close/delete/title/retry 与 conversation detail 已 live。
2. `/me/sessions` / `/me/conversations` 已真 cursor 化，默认过滤 tombstoned conversation。
3. checkpoint registry / diff / restore job 已建立，restore 后下一次 prompt 不再看到 superseded message。
4. mid-restore restart 回滚路径已被 e2e 证明，closure 已清楚写出 HP4 最终 verdict。
5. HP4 closure 已显式声明 F1-F17 的 phase 状态，不把 chronic 判定滞后到 HP10 首次整理。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | chat lifecycle 已覆盖 close/delete/title/retry/checkpoint/restore |
| 测试 | orchestrator-core / agent-core 测试通过，cross-e2e 覆盖 6+ 生命周期场景 |
| 文档 | HP4 closure 能独立解释 API、D1、restore、next prompt 四层结果 |
| 风险收敛 | 不新增 `closed` 状态，不把 DO latest checkpoint 暴露成产品面，不遗留半恢复状态 |
| 可交付性 | HP5/HP7 可以直接在 HP4 的 lifecycle / registry / restore truth 之上继续推进 |

---

## 11. 工作日志回填

1. 核对 charter / HP4 action-plan / HP4 design / HPX-qna 与真实代码后，确认用户点名的 `docs/design/hero-to-pro/HP4-pre-defer-fixes.md` 并不存在，本轮以 action-plan 实际引用的 `docs/design/hero-to-pro/HP4-chat-lifecycle.md` 为 authoritative design。
2. 回溯 `workers/orchestrator-core/migrations/008-session-model-audit.sql`、`009-turn-attempt-and-message-supersede.sql`、`013-product-checkpoints.sql` 后，确认 HP1 已经提供 `ended_reason`、`deleted_at`、turn-attempt/supersede、checkpoint registry / restore job schema；本轮 HP4 的真实缺口是 façade / user-do / read-model / checkpoint consumer，而不是再补 DDL。
3. 更新 `workers/orchestrator-core/src/session-lifecycle.ts`，新增 `CloseBody`、`DeleteSessionBody`、`TitlePatchBody`，把 HP4 lifecycle first-wave 的 public body 口径固定下来。
4. 扩展 `workers/orchestrator-core/src/session-truth.ts`，新增 `readSessionLifecycle`、true-cursor `listSessionsForUser` / `listConversationsForUser`、`readConversationDetail`、`updateConversationTitle`、`tombstoneConversation`、`listCheckpoints`、`createUserCheckpoint`、`readCheckpointDiff`，把 HP4 first-wave durable read/write helper 收束到 D1 truth owner。
5. 更新 `workers/orchestrator-core/src/user-do/session-flow.ts` 与 `src/user-do-runtime.ts`，新增 close / delete / title 的 runtime owner 与 dispatch；close 复用 `ended + completed + ended_reason=closed_by_user`，delete 以 conversation tombstone 为准，title 继续只写 `nano_conversations.title`。
6. 更新 `workers/orchestrator-core/src/index.ts`，让 public façade 新增 `POST /sessions/{id}/close`、`DELETE /sessions/{id}`、`PATCH /sessions/{id}/title`、`GET /conversations/{conversation_uuid}`、`GET/POST /sessions/{id}/checkpoints`、`GET /sessions/{id}/checkpoints/{checkpoint_uuid}/diff`，并把 `/me/sessions` / `/me/conversations` 改为 direct D1 true-cursor read model。
7. 重写 `workers/orchestrator-core/test/me-conversations-route.test.ts`，并新增 `test/me-sessions-route.test.ts`、`test/chat-lifecycle-route.test.ts`、`test/user-do-chat-lifecycle.test.ts`，覆盖 HP4 first-wave 的 route wiring、cursor read model 与 user-do lifecycle 语义。
8. 同步修正 `docs/design/hero-to-pro/HP4-chat-lifecycle.md` 中与 Q14 冲突的 `deleted_by_user_uuid` 漂移，并把 `clients/api-docs/README.md`、`clients/api-docs/me-sessions.md`、`clients/api-docs/session.md`、`clients/api-docs/error-index.md` 回填到当前 HP4 first-wave 代码事实。
9. 本轮刻意不把 HP4 伪装成“已全量完成”：latest-turn retry、restore job orchestration、D1↔DO rollback / restart-safe 恢复链、cross-e2e matrix 仍未落地，因此本次 closure 结论只会收口为 **HP4 first wave / partial-live**，不会误报 full HP4 done。
