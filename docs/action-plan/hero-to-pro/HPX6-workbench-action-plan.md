# Nano-Agent 行动计划

> 服务业务簇: `HPX6 — workbench-grade controls + new truth + Codex-style object layer`
> 计划对象: `把 first-wave ack 推到 completed surface;新增 runtime config + permission rules;接通 followup_input client→server;executor 走 Cloudflare Queue;item projection 抽出 Codex 风格对象层`
> 类型: `add + upgrade + remove`
> 作者: `Owner + Opus 4.7 (1M)`
> 时间: `2026-05-02`
> 文件位置: `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`
> 上游前序 / closure:
> - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md`(F0/F1/F2/F3/F4/F5/F7 收口)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1(owner 决议:Q-bridging-7 直接删 / Q-bridging-8 同意 Queue / F7 OK)
> - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md` HP6 frozen(todos / workspace truth)
> - `docs/design/hero-to-pro/HP7-checkpoint-revert.md` HP7 frozen(restore job substrate)
> 下游交接:
> - 无(hero-to-pro 阶段最终收口;hero-to-platform 不存在,所有迁移必须 HPX6 内完成 — 见 owner 决议)
> 关联设计 / 调研文档:
> - `docs/eval/hero-to-pro/api-gap/{claude-code-compared-by-opus,codex-compared-by-GPT,gemini-cli-compared-by-deepseek}.md`
> - `docs/eval/hero-to-pro/api-gap/HPX5-HPX6-design-docs-reviewed-by-{deepseek,GPT,kimi}.md`
> 冻结决策来源:
> - `docs/design/hero-to-pro/HPX-qna.md`(Q1–Q27 仍适用)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` §0.4 / §6.1 / §9.1(Q-bridging-1..8)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` 附录 C(Source-of-Truth Matrix)
> 文档状态: `draft`

---

## 0. 执行背景与目标

HPX6 是 hero-to-pro 阶段的最终收口。HPX5 完成 emit seam 与 wire-up 之后,nano-agent 就是一个完整的 chat-with-events 后端;HPX6 把它推到 **agent loop workbench 后端**:

- `workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40` 的 `handleRetryAbsorbed` 当前返一段 `retry_kind: "request-acknowledged-replay-via-messages"` 的 hint,让客户端"自己 POST /messages 重发"。同文件 `:42-71` 的 `handleForkAbsorbed` 返 `fork_status: "pending-executor"`,只是 mint 了 `child_session_uuid` 但没有任何 executor 执行。`workers/orchestrator-core/src/checkpoint-restore-plane.ts:387-427` 的 `D1CheckpointRestoreJobs.openJob` 只把 row 推到 `pending`,executor 未 live(同文件 `:468-544` 已经实现 `markRunning` / `terminate`,但**没有任何 caller** 在 pending → running → terminal 之间 drive)。
- `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-170` 的 `/sessions/{id}/tool-calls` list 当前固定返 `{ tool_calls: [], source: "ws-stream-only-first-wave" }`;没有 D1 表持久化 tool call 的 input / output / status / cancel_initiator。
- `workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-33` 的 `SessionAction` 枚举不含 `followup_input`,`workers/orchestrator-core/src/user-do/ws-runtime.ts:167` 当前的 client-side `addEventListener("message")` **只是 activity touch**(不解析 inbound payload);但 agent-core 一侧 `workers/agent-core/src/host/do/session-do/ws-runtime.ts:166-184` 已经接住了 `session.followup_input`(走 `extractTurnInput` + `pendingInputs` 队列 + `drainNextPendingInput`)。所以 followup_input 的 protocol shape + 服务端处理都已就绪,**唯一缺**的是 orchestrator-core 公网 WS 把 inbound JSON 帧转发到 NanoSessionDO 的链路。
- `workers/orchestrator-core/src/user-do/surface-runtime.ts:660-682` 的 `handlePermissionMode` 还是 4 档 mode(`auto-allow / ask / deny / always_allow`)写入 KV `permission_mode/{sessionUuid}`;这与 owner 决议的"runtime config 一等公民 + permission_rules 优先级 > mode"**冲突**。Q-bridging-7 (v0.2.1) owner 决议:**直接删** legacy 路由,不做 dual-write 兼容窗口(hero-to-platform 不存在)。
- `workers/agent-core/src/kernel/events.ts:73-102` 的 `tool.call.progress / tool.call.result` 已经在 stream event 内 emit,但**没有持久化**到 D1;`request_uuid` / `tool_name` / `output` 都飘在 stream 上,无法 cursor scan 历史 tool call。
- 没有任何"对象级"投影:Codex 风格的 `agent_message / reasoning / tool_call / file_change / todo_list / confirmation / error` 7 类 item 可让前端 reducer 友好消费 — 当前前端必须从零散 stream event 自行拼对象。

HPX6 把这 9 项缺口闭环。**本计划不开 Q/A;所有取舍源于 design v0.2.1。**

- **服务业务簇**:`HPX6 — workbench-grade controls + new truth + Codex-style object layer`
- **计划对象**:F6 + F8 + F9 + F10 + F11 + F12 + F13 + F14 + F15 共 9 项功能(对应 design §5.1 HPX6 phase)
- **本次计划解决的问题**:
  - tool-calls 无法历史查询 → 前端 transcript / replay 残缺
  - followup_input 无 public WS 链路 → 用户必须 cancel + restart 才能改方向
  - runtime config 缺失 → 用户无法显式控制 agent 怎么运行
  - per-tool / per-pattern permission rules 缺失 → 只能整 session 切 mode
  - retry / restore / fork executor 都是 first-wave ack → "高级工作流"按钮全是装饰
  - 缺 Codex 风格 item 对象层 → 前端 reducer 工作量大
  - file_change 事件流缺失 → 无 IDE 风格 diff viewer
- **本次计划的直接产出**:
  - 新增 D1 表:`nano_tool_call_ledger`(F6)、`nano_session_runtime_config`(F9)、`nano_team_permission_rules`(F10)
  - 新增 public 路由:`GET/PATCH /sessions/{id}/runtime`(F9)、`GET /tool-calls/{request_uuid}`(F6)、`GET /sessions/{id}/items[?cursor=]`、`GET /items/{item_uuid}`(F14)
  - 新增 WS 顶层帧:`session.runtime.update`(F9)、`session.restore.completed`(F12)、`session.item.{started,updated,completed}`(F14)
  - 接通 client→server `session.followup_input`(F8)的公网 WS 转发链路
  - executor runtime:Cloudflare Queue consumer(retry/restore/fork)+ DO alarm 兜底监控(Q-bridging-8)
  - **删除** legacy `POST /sessions/{id}/policy/permission_mode` 路由 + `permission_mode` KV 写入(Q-bridging-7 owner 决议)
  - file_change item + emitter(F15)
- **本计划不重新讨论的设计结论**:
  - executor 走 Cloudflare Queue consumer 主路径 + DO alarm 兜底(来源:Q-bridging-8)
  - `permission_mode` 直接删,不做 dual-write 兼容窗口(来源:Q-bridging-7 v0.2.1 owner 决议)
  - `session.followup_input` 完整 frozen shape 暴露,首版 client MVP 只依赖 `text`(来源:Q-bridging-3 / `messages.ts:119-126`)
  - runtime config session-scoped,不引入 turn-scoped(来源:Q-bridging-4)
  - item projection = read-time 投影,不引入新 truth 表(来源:§6.1 取舍 3;source map 见 design 附录 C)

---

## 1. 执行综述

### 1.1 总体执行方式

**先 D1 truth 后路由 + 先 protocol 后 executor + 先 hard delete 后新增**。Phase 1 落 D1 migration(`nano_tool_call_ledger` / `nano_session_runtime_config` / `nano_team_permission_rules`)+ nacp-session schema 扩展(`session.runtime.update / .restore.completed / .item.*` 顶层帧)。Phase 2 公开 followup_input 公网 WS 转发链路 + 真实化 tool-calls ledger(F6 + F8)。Phase 3 落 runtime config object + permission rules + **删除** legacy permission_mode 路由(F9 + F10 + Q-bridging-7 hard delete)。Phase 4 上 Cloudflare Queue 与 executor(F11 retry / F12 restore / F13 fork)。Phase 5 抽 item projection 对象层 + file_change emitter(F14 + F15)。每个 Phase 完成必须 contracts/cross-e2e 全绿。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|------|------|------|----------|----------|
| Phase 1 | Schema + Migration Foundations | M | 3 张新 D1 表 migration;nacp-session 扩展 4 类新顶层帧 schema;direction matrix / SESSION_BODY_SCHEMAS 注册 | HPX5 收口 |
| Phase 2 | followup_input + Tool-calls Ledger(F6 + F8) | M | orchestrator-core 公网 WS 解析 inbound 帧并转发 NanoSessionDO;agent-core 在 tool execution 路径 fire-and-forget 写 D1;`/tool-calls` list/detail 真实化 | Phase 1 |
| Phase 3 | Runtime Config + Permission Rules + Legacy Hard Delete(F9 + F10 + Q-bridging-7) | M | `/runtime` GET/PATCH live;permission_rules 优先 > mode fallback;legacy `/policy/permission_mode` + `permission_mode` KV 全删 | Phase 1 |
| Phase 4 | Executor Runtime(F11 + F12 + F13) | L | Cloudflare Queue producer/consumer wrangler 配;retry / restore / fork 三类 executor 推到 terminal;DO alarm 兜底 5 分钟监控 | Phase 1 |
| Phase 5 | Item Projection + File-Change(F14 + F15) | M | `/items` HTTP + `session.item.{started,updated,completed}` WS;file_change item emit | Phase 1 + Phase 2(tool_call ledger 是 source)+ Phase 4(restore.completed 是 source) |

### 1.3 Phase 说明

1. **Phase 1 — Schema + Migration Foundations**
   - **核心目标**:把 HPX6 所有新 truth 表与新顶层帧 schema 一次性落到位(migration 015–017 + `nacp-session` 1.5.0)。
   - **为什么先做**:Phase 2–5 全部依赖这些新 schema / 表;一次性落地避免分散加 migration。

2. **Phase 2 — followup_input + Tool-calls Ledger(F6 + F8)**
   - **核心目标**:client→server `session.followup_input` 公网 WS 链路通;tool-calls 真实读 D1。
   - **为什么放在这里**:F6/F8 都是"接通现有 D1 + RPC 已实现的能力到 public surface",与 F9/F11 的 runtime config + executor 并行风险低。

3. **Phase 3 — Runtime Config + Permission Rules + Legacy Hard Delete(F9 + F10 + Q-bridging-7)**
   - **核心目标**:`/runtime` 路由 live,`permission_rules` 在 PreToolUse 决策中接入,**直接删** legacy `permission_mode` 路由 + KV。
   - **为什么放在这里**:F9/F10 是新 control plane,需要 Phase 1 的 D1 表与 nacp-session 帧 schema 都到位才能完整 emit `session.runtime.update`。Hard delete legacy mode 必须在新 runtime config 上线之后,确保前端有可迁移目标。

4. **Phase 4 — Executor Runtime(F11 + F12 + F13)**
   - **核心目标**:Cloudflare Queue 主路径 + DO alarm 兜底监控,把 retry/restore/fork 三类 job 真正推到 terminal。
   - **为什么放在这里**:executor 是 HPX6 最大的部署面变化(新增 wrangler Queue binding + producer/consumer worker),需要 Phase 1 的 D1 schema 全到位才能写 status 字段。

5. **Phase 5 — Item Projection + File-Change(F14 + F15)**
   - **核心目标**:抽出 7 类 item read-time projection,emit file_change item;前端 reducer 友好。
   - **为什么放在这里**:item projection 的 source 包含 F6 tool_call_ledger(P2)、F12 restore.completed(P4)— 必须最后做。

### 1.4 执行策略说明

- **执行顺序原则**:D1/schema 先于路由;协议帧 schema 先于 emitter;hard delete legacy 必须有可迁移目标后才执行。
- **风险控制原则**:executor 必须**幂等**(Queue at-least-once 投递);失败 dead-letter 后写 `failure_reason / rolled_back`(Q24);DO alarm 仅作为 5 分钟卡住兜底重投,**不**承担主执行职责(避免 30s 限制踩坑)。
- **测试推进原则**:每个 Phase 完成必须 contracts + cross-e2e 全绿;executor 必须有 Queue 模拟器测试(Cloudflare Workers Miniflare 支持);hard delete legacy 必须有 e2e 验证 `404 not-found` 取代 `200 OK`。
- **文档同步原则**:Phase 1 落 schema 时 `clients/api-docs/{runtime,items,tool-calls}.md`(新)同步落地;Phase 3 删 legacy 时 `clients/api-docs/permissions.md` 改写为"已废弃,迁移指南";`README.md` 索引同步更新到 22-doc。
- **回滚 / 降级原则**:每张新 D1 表 migration 单独可回滚;Queue executor 失败走 dead-letter 不阻塞主链路;legacy hard delete 是 hero-to-pro 内的最终态,**不**保留 feature flag 开关。

### 1.5 本次 action-plan 影响结构图

```text
HPX6 workbench
├── Phase 1: Schema + Migration Foundations
│   ├── workers/orchestrator-core/migrations/015-tool-call-ledger.sql (NEW)
│   ├── workers/orchestrator-core/migrations/016-session-runtime-config.sql (NEW)
│   ├── workers/orchestrator-core/migrations/017-team-permission-rules.sql (NEW)
│   └── packages/nacp-session/src/{messages.ts, type-direction-matrix.ts, session-registry.ts, stream-event.ts} (扩 4 类新帧)
├── Phase 2: followup_input + Tool-calls Ledger
│   ├── workers/orchestrator-core/src/user-do/ws-runtime.ts:167 (新增 inbound frame parse + 转发到 NanoSessionDO)
│   ├── workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-33 (SessionAction 加 "followup_input" — 仅供 HTTP 调试,WS 主路径)
│   ├── workers/agent-core/src/kernel/events.ts:73-102 (tool.call.progress/result 钩 fire-and-forget D1 write)
│   ├── workers/orchestrator-core/src/tool-call-ledger.ts (NEW)
│   └── workers/orchestrator-core/src/hp-absorbed-routes.ts:158-170 (真实读 D1)
├── Phase 3: Runtime Config + Permission Rules + Hard Delete
│   ├── workers/orchestrator-core/src/runtime-config-plane.ts (NEW)
│   ├── workers/orchestrator-core/src/permission-rules-plane.ts (NEW)
│   ├── workers/orchestrator-core/src/facade/routes/session-runtime.ts (NEW)
│   ├── workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-33,77,116 (DEL "policy/permission_mode")
│   ├── workers/orchestrator-core/src/user-do/surface-runtime.ts:660-682 (DEL handlePermissionMode)
│   └── workers/agent-core/src/* (PreToolUse 决策接 permission_rules)
├── Phase 4: Executor Runtime
│   ├── workers/orchestrator-core/wrangler.jsonc (新增 Queue binding;producer)
│   ├── workers/executor-runner/* (NEW worker;Queue consumer)
│   ├── workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40 (handleRetryAbsorbed → real attempt-chain producer)
│   ├── workers/orchestrator-core/src/hp-absorbed-handlers.ts:42-71 (handleForkAbsorbed → real producer)
│   ├── workers/orchestrator-core/src/checkpoint-restore-plane.ts:468-544 (markRunning/terminate 由 executor 调)
│   └── workers/agent-core/src/host/do/session-do/runtime-assembly.ts (DO alarm 兜底监控)
└── Phase 5: Item Projection + File-Change
    ├── workers/orchestrator-core/src/item-projection-plane.ts (NEW)
    ├── workers/orchestrator-core/src/facade/routes/session-items.ts (NEW)
    ├── workers/filesystem-core/src/index.ts:140-205 (write/delete RPC 完成回调 emit file_change)
    └── packages/nacp-session/src/messages.ts (item frame schemas)
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope(本次 action-plan 明确要做)

- **[S1]** F6:新建 `workers/orchestrator-core/migrations/015-tool-call-ledger.sql` D1 表;agent-core 在 `kernel/events.ts:73-102` 的 `tool.call.progress / tool.call.result` 路径 fire-and-forget 写 D1;`hp-absorbed-routes.ts:158-170` 真实读 D1;新增 `GET /sessions/{id}/tool-calls/{request_uuid}` detail。
- **[S2]** F8:`workers/orchestrator-core/src/user-do/ws-runtime.ts:167` 当前的 inbound message handler(只 activity touch)扩展为解析 JSON 帧 → 若 `kind === "session.followup_input"` 则经 service binding 转发到 NanoSessionDO(agent-core 一侧 `workers/agent-core/src/host/do/session-do/ws-runtime.ts:166-184` 已能处理);完整 frozen shape 透传(text + context_ref + stream_seq + model_id + reasoning + parts);首版 client MVP 只依赖 `text`。
- **[S3]** F9:新建 `migrations/016-session-runtime-config.sql` D1 表(`session_uuid PK, permission_rules_json, network_policy_mode, web_search_mode, workspace_scope_json, approval_policy, version, created_at, updated_at`);新建 `runtime-config-plane.ts`;新增 `GET/PATCH /sessions/{id}/runtime` 路由;PATCH 成功后 emit `session.runtime.update` 顶层帧(走 emit-helpers F0)。
- **[S4]** F10:新建 `migrations/017-team-permission-rules.sql` D1 表(scope=tenant);新建 `permission-rules-plane.ts`;agent-core PreToolUse 决策接入(rule 优先 > mode fallback);glob pattern 匹配(简单实现:`*` 与字面量);scope=session 走 `nano_session_runtime_config.permission_rules_json`,scope=tenant 走新表。
- **[S5]** Q-bridging-7 hard delete:**移除** `workers/orchestrator-core/src/facade/routes/session-bridge.ts:32, 77, 116` 中的 `"policy/permission_mode"` 枚举与路由分支;**移除** `workers/orchestrator-core/src/user-do/surface-runtime.ts:660-682` 的 `handlePermissionMode` 整段;**移除** KV `permission_mode/{sessionUuid}` 写入;agent-core 内任何读 `permission_mode` KV 的代码改为读 `runtime_config.approval_policy`。
- **[S6]** F11:`workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40` 的 `handleRetryAbsorbed` 改为:把 retry 任务推入 Cloudflare Queue;返 `{ retry_kind: "queue-enqueued", job_uuid }`;Queue consumer(新 `workers/executor-runner/`)消费时创建真实 attempt-chain(`nano_conversation_turns.requested_attempt_seed`);原 turn 标 `superseded_by_turn_attempt`(已在 `migrations/009-turn-attempt-and-message-supersede.sql` 内);emit `session.todos.update` / `turn.begin` 等真实下游帧。
- **[S7]** F12:`hp-absorbed-handlers.ts` 已无 fork 之外的 restore handler(restore 走 `session-control.ts:233-294` 的 `restore` 路径调 `D1CheckpointRestoreJobs.openJob` `:387-427`);F12 在 `executor-runner` 内消费 restore Queue 任务,调 `markRunning`(`:468-490`)→ 复制 R2 snapshot → 重置 D1 message ledger → `terminate(succeeded|partial|failed|rolled_back, failure_reason)`(`:498-544`);emit `session.restore.completed` 顶层帧(新 schema)。
- **[S8]** F13:`hp-absorbed-handlers.ts:42-71` 的 `handleForkAbsorbed` 改为:enqueue Queue;executor 创建 child session DO + 复制 snapshot 到 child workspace + 写 `nano_session_fork_lineage`;emit `session.fork.created`(schema 已冻于 `stream-event.ts:36-48`);child session 推到 `active`。
- **[S9]** F14:新建 `workers/orchestrator-core/src/item-projection-plane.ts`;新增 `GET /sessions/{id}/items[?cursor=]` 与 `GET /items/{item_uuid}`;按 design 附录 C.2 的 source map 投影 7 类 item;emit WS `session.item.{started,updated,completed}` 顶层帧(新 schema);**read-time 投影,绝不**新增 truth 表。
- **[S10]** F15:`workers/filesystem-core/src/index.ts:140-205` 的 `writeTempFile / deleteTempFile` 完成 ack 之后,通过 service binding 触发 emit `file_change` item(item.kind="file_change",含 `path / change_kind: created|modified|deleted / size_delta / content_hash`);依赖 F5(HPX5 已 live)+ F14(本 phase)。
- **[S11]** wrangler 配置:新增 Cloudflare Queue binding(`workers/orchestrator-core/wrangler.jsonc` 加 producer);新建 `workers/executor-runner/` worker(consumer);DO alarm 在 `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` 内每 5 分钟扫一次 stuck job(`nano_checkpoint_restore_jobs.status='running' AND started_at < now()-5min`),重投到 Queue。

### 2.2 Out-of-Scope(本次 action-plan 明确不做)

- **[O1]** 跨 conversation fork — Q23 frozen 不变(fork = same conversation only)。
- **[O2]** 跨 turn fallback chain — Q8 frozen single-step。
- **[O3]** WriteTodos V2 task graph — Q20 frozen 5-status flat list。
- **[O4]** MCP tool 调用作为独立 item kind — `mcp_tool_call` 暂统一为 `tool_call`,见 design O3。
- **[O5]** Sub-agent / sub-task 树 — README §4.2 主动 trade-off。
- **[O6]** Hooks 客户端注册面 — README §4.1 ③。
- **[O7]** Memory 路由 — 不在 hero-to-pro vision 内,且 hero-to-platform 不存在(owner 决议),memory 设计延后或不再做。
- **[O8]** streaming tool execution — Claude Code 风格 StreamingToolExecutor 不引入。
- **[O9]** runtime config 的 turn-scoped override — Q-bridging-4 frozen session-scoped。
- **[O10]** Codex `web_search / mcp_tool_call / patch_diff` 等扩展 item kind — 留作未来扩展点(见 design §3.2 接口保留点)。

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|------|------|------|----------|
| Cloudflare Queue 是 nano-agent 第一次引入 | `in-scope`(infra) | Q-bridging-8 owner 决议 | 若 Queue 部署面有 blocker,需要回 design |
| `executor-runner` 是新 worker(第 7 个) | `in-scope` | Queue consumer 需独立 worker;不混入 orchestrator-core 增加复杂度 | never |
| legacy `permission_mode` hard delete | `in-scope`(removal) | Q-bridging-7 owner 决议直接删,不做 dual-write | never;若客户端未迁移,在 HPX6 freeze 之前必须协调完成 |
| `runtime.web_search / network_policy` 字段是否实施 | `in-scope`(写入) / `not-yet-enforced`(消费) | 第一版 D1 写入 + GET/PATCH live;但 agent-core 没有对应 capability 消费,文档标 `not-yet-enforced` | 当对应 capability 实装时,文档去 `not-yet-enforced` 标 |
| item_uuid 与 source row 的稳定性 | `in-scope` | source 不被物理删除即 item_uuid 稳定;compact 走 soft delete | never |
| executor DO alarm 兜底监控 | `in-scope` | 5 分钟扫一次 stuck job;不参与主执行 | never |
| Queue dead-letter 监控告警 | `in-scope`(配置)/ `out-of-scope`(告警接入) | 配 dead-letter queue;告警接入由运维 | 若线上 dead-letter 频繁,触发 incident review |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | tool-call ledger migration | add | `workers/orchestrator-core/migrations/015-tool-call-ledger.sql` (NEW) | `nano_tool_call_ledger` 表 + 索引 | low |
| P1-02 | Phase 1 | runtime config migration | add | `workers/orchestrator-core/migrations/016-session-runtime-config.sql` (NEW) | `nano_session_runtime_config` 表 | low |
| P1-03 | Phase 1 | team permission rules migration | add | `workers/orchestrator-core/migrations/017-team-permission-rules.sql` (NEW) | `nano_team_permission_rules` 表 | low |
| P1-04 | Phase 1 | nacp-session 扩 4 类新顶层帧 schema | add | `packages/nacp-session/src/messages.ts`, `type-direction-matrix.ts`, `session-registry.ts` | `session.runtime.update` / `session.restore.completed` / `session.item.{started,updated,completed}` 全注册 | medium |
| P1-05 | Phase 1 | nacp-session 1.5.0 发版 | refactor(release) | `packages/nacp-session/package.json` | 升 minor 版本,publish to GitHub Packages | low |
| P2-01 | Phase 2 | F8 公网 WS inbound 解析 + 转发 | update | `workers/orchestrator-core/src/user-do/ws-runtime.ts:167` (扩) | inbound JSON 帧解析,`session.followup_input` 转发到 NanoSessionDO | medium |
| P2-02 | Phase 2 | F8 完整 frozen shape 透传 + e2e | add | `tests/contracts/followup-input.test.ts` (NEW) | text-only happy + advanced 字段透传 | low |
| P2-03 | Phase 2 | F6 tool-call ledger plane | add | `workers/orchestrator-core/src/tool-call-ledger.ts` (NEW) | `D1ToolCallLedger.upsert/list/read` API | low |
| P2-04 | Phase 2 | F6 agent-core 写 D1 hook | update | `workers/agent-core/src/kernel/events.ts:73-102` 的 progress/result 路径 + 服务绑定 | `waitUntil` 写 D1,不阻塞 stream | medium |
| P2-05 | Phase 2 | F6 `/tool-calls` 真实读 + detail | update | `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-170` (真实读), 新增 `:NN` `GET /tool-calls/{request_uuid}` | list 真实化;detail 路由 live | low |
| P3-01 | Phase 3 | F9 runtime config plane | add | `workers/orchestrator-core/src/runtime-config-plane.ts` (NEW), `workers/orchestrator-core/src/facade/routes/session-runtime.ts` (NEW) | `D1SessionRuntimeConfig.read/patch`;`/runtime` GET/PATCH 路由 | medium |
| P3-02 | Phase 3 | F9 PATCH emit `session.runtime.update` | add | `runtime-config-plane.ts`(emit)+ `packages/nacp-session/src/emit-helpers.ts`(F0 已 live) | PATCH 成功 ≤500ms emit | low |
| P3-03 | Phase 3 | F10 permission rules plane + 集成 | add | `workers/orchestrator-core/src/permission-rules-plane.ts` (NEW), agent-core PreToolUse 决策点 | rule 优先 > mode fallback;glob 匹配 | medium |
| P3-04 | Phase 3 | Q-bridging-7 hard delete legacy permission_mode | remove | `workers/orchestrator-core/src/facade/routes/session-bridge.ts:32,77,116` (DEL `"policy/permission_mode"`), `workers/orchestrator-core/src/user-do/surface-runtime.ts:660-682` (DEL `handlePermissionMode` 整段), agent-core 内 `permission_mode` KV 读取点(实施时 grep 定位) | legacy 路由返 404;KV 写入移除;读取改 runtime config | medium |
| P3-05 | Phase 3 | docs:permissions.md 改"已废弃,迁移指南" | update | `clients/api-docs/permissions.md`, `clients/api-docs/runtime.md` (NEW) | 老文档变迁移指南;新文档 `runtime.md` 收口 `/runtime` | low |
| P4-01 | Phase 4 | wrangler Queue binding | update | `workers/orchestrator-core/wrangler.jsonc`(producer)、`workers/executor-runner/wrangler.jsonc` (NEW; consumer) | Queue `nano-executor-jobs` + dead-letter `nano-executor-dlq` | medium |
| P4-02 | Phase 4 | executor-runner worker | add | `workers/executor-runner/src/index.ts` (NEW) + tests | Queue consumer dispatch 到 retry/restore/fork handler | high |
| P4-03 | Phase 4 | F11 retry executor + producer | update | `workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40` (改为 enqueue), `workers/executor-runner/src/retry-handler.ts` (NEW) | 真实 attempt-chain 创建 | medium |
| P4-04 | Phase 4 | F12 restore executor | add | `workers/executor-runner/src/restore-handler.ts` (NEW) | drive `D1CheckpointRestoreJobs` 到 terminal;emit `session.restore.completed` | high |
| P4-05 | Phase 4 | F13 fork executor | update | `workers/orchestrator-core/src/hp-absorbed-handlers.ts:42-71`(改 enqueue), `workers/executor-runner/src/fork-handler.ts` (NEW) | child session 创建 + snapshot 复制 + emit `session.fork.created` | high |
| P4-06 | Phase 4 | DO alarm 兜底监控 | add | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`(alarm 设置)+ orchestrator-core stuck-job 扫描 | 每 5 分钟扫 stuck job,重投 Queue | medium |
| P5-01 | Phase 5 | F14 item projection plane | add | `workers/orchestrator-core/src/item-projection-plane.ts` (NEW) | 7 类 item read-time 投影,按 source map 实施 | high |
| P5-02 | Phase 5 | F14 `/items` HTTP 路由 | add | `workers/orchestrator-core/src/facade/routes/session-items.ts` (NEW) | `GET /items[?cursor=]` + `GET /items/{uuid}` | medium |
| P5-03 | Phase 5 | F14 WS `session.item.*` emitter | add | `workers/orchestrator-core/src/item-projection-plane.ts`(emit hook) | source row 写入时同步 emit started/updated/completed | medium |
| P5-04 | Phase 5 | F15 file_change item + emitter | add | `workers/filesystem-core/src/index.ts:140-205`(write/delete 后 emit) | `file_change` item live | low |
| P5-05 | Phase 5 | docs:items.md + tool-calls.md(新)+ 索引 | add/update | `clients/api-docs/{items,tool-calls,runtime}.md` (NEW), `clients/api-docs/README.md`(索引 19 → 22) | 新 4 doc + 索引同步 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Schema + Migration Foundations

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | 015-tool-call-ledger.sql | 新表字段:`request_uuid TEXT PK, session_uuid TEXT NOT NULL, conversation_uuid TEXT NOT NULL, team_uuid TEXT NOT NULL, tool_name TEXT NOT NULL, input_json TEXT, input_r2_key TEXT, output_json TEXT, output_r2_key TEXT, status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','cancelled')), cancel_initiator TEXT CHECK(cancel_initiator IN ('user','system','parent_cancel')), error_message TEXT, started_at TEXT NOT NULL, ended_at TEXT, version INTEGER NOT NULL DEFAULT 1`;索引 `(session_uuid, started_at DESC)` 与 `(team_uuid, started_at DESC)` | `migrations/015-tool-call-ledger.sql` (NEW) | migration apply 成功 | `pnpm test:contracts` D1 schema verify | wrangler local D1 apply 通过 |
| P1-02 | 016-session-runtime-config.sql | `session_uuid TEXT PK, conversation_uuid TEXT NOT NULL, team_uuid TEXT NOT NULL, permission_rules_json TEXT NOT NULL DEFAULT '[]', network_policy_mode TEXT NOT NULL DEFAULT 'allow' CHECK(network_policy_mode IN ('allow','deny','ask')), web_search_mode TEXT NOT NULL DEFAULT 'off' CHECK(web_search_mode IN ('off','on','ask')), workspace_scope_json TEXT NOT NULL DEFAULT '{"mounts":[]}', approval_policy TEXT NOT NULL DEFAULT 'ask' CHECK(approval_policy IN ('auto-allow','ask','deny','always_allow')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL` | `migrations/016-session-runtime-config.sql` (NEW) | session 默认 row 由 `/me/sessions` mint 时一并创建(P3-01) | apply + insert 测试 | wrangler local apply + insert 通过 |
| P1-03 | 017-team-permission-rules.sql | `rule_uuid TEXT PK, team_uuid TEXT NOT NULL, tool_name TEXT NOT NULL, pattern TEXT, behavior TEXT NOT NULL CHECK(behavior IN ('allow','deny','ask')), created_at TEXT NOT NULL`;索引 `(team_uuid, tool_name)` | `migrations/017-team-permission-rules.sql` (NEW) | 表 + 索引 live | apply | wrangler local apply 通过 |
| P1-04 | nacp-session 扩 4 类顶层帧 | 在 `messages.ts` 新增 `SessionRuntimeUpdateBodySchema / SessionRestoreCompletedBodySchema / SessionItemStartedBodySchema / SessionItemUpdatedBodySchema / SessionItemCompletedBodySchema`;在 `type-direction-matrix.ts` 注册 5 个 message_type 为 server-only `event`;在 `session-registry.ts` 加入 server-side 集合;在 `messages.ts` `SESSION_BODY_SCHEMAS` map 注册 | `packages/nacp-session/src/{messages.ts,type-direction-matrix.ts,session-registry.ts}` | schema 全冻;direction matrix 通过 `pnpm --filter @haimang/nacp-session test` | nacp-session 单测 ≥ 5 case 覆盖新 schema | 所有新 schema 经 zod parse round-trip OK |
| P1-05 | nacp-session 1.5.0 发版 | `packages/nacp-session/package.json` `version: 1.4.0 → 1.5.0`;runtime 不 bump NACP_VERSION(仍 1.1.0,因 schema 是增量加 message_type) | `packages/nacp-session/package.json` | 1.5.0 publish to GitHub Packages | `pnpm --filter @haimang/nacp-session build && publish`(owner 走 npm publish) | dist 含新 export;`@haimang/nacp-session@1.5.0` 在 registry 可见 |

### 4.2 Phase 2 — followup_input + Tool-calls Ledger(F6 + F8)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | F8 公网 WS inbound 解析 + 转发 | `workers/orchestrator-core/src/user-do/ws-runtime.ts:167` 当前 `socket.addEventListener?.("message", () => { this.touchSession(...) })` 改为:在 touchSession 之外**先**解析 `event.data`(若为 string)→ JSON.parse → 检查 `kind` 字段:若 `=== "session.followup_input"`,通过 service binding 调 NanoSessionDO 的 inbound 入口(agent-core `workers/agent-core/src/host/do/session-do/ws-runtime.ts:166-184` 已有 case);其余 inbound 帧(`session.heartbeat / session.stream.ack / session.resume`)按现有逻辑维持 activity touch | `workers/orchestrator-core/src/user-do/ws-runtime.ts:167-178`, `workers/agent-core/src/host/do/session-do/ws-runtime.ts:166-184`(已就绪,不改) | followup_input 帧从公网 WS 流入 → 经 service binding 到 NanoSessionDO → `extractTurnInput` → `pendingInputs` 入队 → 下一轮 turn 自然合入 | per-worker test 模拟客户端 WS push followup → 验证 next turn user prompt 含 followup text;e2e contracts 跑 WS push 路径 | followup_input 在 attached/turn_running phase 接受;在 detached/ended phase 拒绝(`NACP_STATE_MACHINE_VIOLATION`);超 32 KB → `NACP_SIZE_EXCEEDED` |
| P2-02 | F8 完整 frozen shape e2e | 跑 4 case:仅 text;text + context_ref;text + parts(多模态);text + model_id 覆盖 | `tests/contracts/followup-input.test.ts` (NEW) | 4 case 全绿 | `pnpm test:contracts` | 测试覆盖完整 frozen shape;首版 client cookbook 标"text 必须,其他可选" |
| P2-03 | F6 tool-call ledger plane | 新建 `tool-call-ledger.ts`,实现 `D1ToolCallLedger.upsert(input)` / `list(input)` / `read(input)`;upsert 是 idempotent(`request_uuid` 是 PK);output 超 budget(参考 `applyToolResultBudget` 同款规则)写 R2 + 存 `output_r2_key`,D1 只存预览 | `workers/orchestrator-core/src/tool-call-ledger.ts` (NEW), `workers/orchestrator-core/test/tool-call-ledger.test.ts` (NEW) | plane API 单测全绿 | per-worker test ≥ 6 case(upsert / list / read / R2 spill / cancel_initiator / pagination) | 单测 100% 通过 |
| P2-04 | F6 agent-core 写 D1 hook | 在 `workers/agent-core/src/kernel/events.ts:73-102` 的 `tool.call.progress` 与 `tool.call.result` 路径外加一个钩子(实施时定位到 emitter 的统一出口或在 `runtime-mainline.ts` 的 onToolEvent 处),通过 service binding 调 orchestrator-core `D1ToolCallLedger.upsert`;调用走 `ctx.waitUntil`(不阻塞 stream);`tool.call.progress` 阶段 status='running',`tool.call.result` 阶段 status=`succeeded|failed`;`tool.call.cancelled`(`tool-call-cancelled.ts:56` HP6 已 live)阶段 status='cancelled' + cancel_initiator | `workers/agent-core/src/kernel/events.ts:73-102`, `workers/agent-core/src/host/runtime-mainline.ts`(钩子点) | tool execution 期间 D1 真实写入;stream 性能不退化 | per-worker e2e:跑一个 fake LLM tool call,验证 D1 row 出现 + stream 正常 | tool execution 延迟 P99 ≤ +5ms(D1 fire-and-forget) |
| P2-05 | F6 `/tool-calls` 真实读 + detail | `hp-absorbed-routes.ts:158-170` 改为调 `D1ToolCallLedger.list({ session_uuid, status?, limit, cursor })`;新增分支 `/sessions/{id}/tool-calls/{request_uuid}` 调 `read`;detail 含 input/output(redacted)/status/cancel_initiator/started_at/ended_at/error_message;input/output 过 budget 时返预览 + `output_r2_key`(客户端可二次拉) | `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-269` | list 不再返 `[]`;detail 路由 live | per-worker contracts:write tool call → list → read → R2 fetch | list 含真实 row;detail 含完整字段;`source` 字段标 `"d1-ledger-live"` |

### 4.3 Phase 3 — Runtime Config + Permission Rules + Hard Delete(F9 + F10 + Q-bridging-7)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | F9 runtime config plane | 新建 `runtime-config-plane.ts` 实现 `D1SessionRuntimeConfig.ensure(session_uuid)`(若不存在则插默认)/`read`/`patch(session_uuid, partial, version)`;乐观锁 `WHERE version=?`;新建 `session-runtime.ts` route 实现 `GET /sessions/{id}/runtime` + `PATCH /sessions/{id}/runtime`;route 注册到 `facade/route-registry.ts` | `workers/orchestrator-core/src/runtime-config-plane.ts` (NEW), `workers/orchestrator-core/src/facade/routes/session-runtime.ts` (NEW), `workers/orchestrator-core/src/facade/route-registry.ts` | 路由 live;PATCH 乐观锁冲突返 `409 conflict` | per-worker test ≥ 5 case(default insert / get / patch / version conflict / unknown field reject) | route 在 e2e fixture 通过 |
| P3-02 | F9 PATCH emit `session.runtime.update` | PATCH 成功后调 emit-helpers(F0 已 live)emit `session.runtime.update { session_uuid, version, fields_changed: [...], updated_at }` 顶层帧 | `workers/orchestrator-core/src/runtime-config-plane.ts`, F0 emit-helpers | PATCH 后 ≤500ms WS emit | e2e contracts | emit latency 达标;失败走 `system.error` |
| P3-03 | F10 permission rules plane + agent-core 集成 | 新建 `permission-rules-plane.ts` 实现 `D1TeamPermissionRules.list(team_uuid)`;在 PATCH `/runtime` body 中,`permission_rules[]` 内 scope=tenant 的项写 `nano_team_permission_rules`,scope=session 的项更新 `nano_session_runtime_config.permission_rules_json`;agent-core PreToolUse 决策点(实施时定位到 capability 调用前的 hook)按以下顺序匹配:(a)session-scoped rules(顺序匹配,首个命中即用)→ (b)team-scoped rules → (c)若都未命中,落 `runtime.approval_policy`(替代了 legacy `permission_mode`);glob pattern 第一版只支持 `*` 与字面量(实施时用简单 startsWith / endsWith / equals 三模式) | `workers/orchestrator-core/src/permission-rules-plane.ts` (NEW), `workers/agent-core/src/*`(PreToolUse 决策点,实施时定位) | rule hit 时**不**emit confirmation;rule miss 落 mode | per-worker test:always-allow Read / Bash 限定 git status / deny match;e2e:跑一个 LLM 触发的 Read 调用,确认 rule allow → 无 confirmation emit | 5+ case 覆盖 allow/deny/ask + scope=session/tenant + glob 与字面量 |
| P3-04 | Q-bridging-7 hard delete | 删除 `workers/orchestrator-core/src/facade/routes/session-bridge.ts:32` 的 `\| "policy/permission_mode"`、`:77` 的 `compound === "policy/permission_mode"`、`:116` 的 `route.action === "policy/permission_mode"`;删除 `workers/orchestrator-core/src/user-do/surface-runtime.ts:660-682` 整段 `handlePermissionMode`(连同它的 KV `permission_mode/${sessionUuid}` 写入);grep 整仓 `permission_mode` 找出所有读取点(agent-core / KV / docs),改读 `runtime_config.approval_policy` 或彻底删除;`POST /sessions/{id}/policy/permission_mode` 必须返 `404 not-found`(facade unknown route 默认行为) | `workers/orchestrator-core/src/facade/routes/session-bridge.ts:32,77,116`, `workers/orchestrator-core/src/user-do/surface-runtime.ts:660-682`, agent-core 内 grep 定位的读取点 | legacy 路由 404;KV 中 `permission_mode/*` 不再写入 | per-worker contracts:`POST /sessions/{id}/policy/permission_mode` 返 404;现有读 `permission_mode` KV 的代码全部消失 | grep `permission_mode` 仅出现在 docs 迁移指南与 D1 migration 历史 |
| P3-05 | docs:permissions.md 改"已废弃,迁移指南" + 新 runtime.md | `permissions.md` 改写为"已废弃 — `POST /policy/permission_mode` 已在 HPX6 移除,请改用 `PATCH /runtime { approval_policy }`";新建 `clients/api-docs/runtime.md` 详述 `/runtime` GET/PATCH + `permission_rules` schema + `session.runtime.update` 帧 | `clients/api-docs/permissions.md`, `clients/api-docs/runtime.md` (NEW), `clients/api-docs/README.md`(索引) | docs 索引 19 → 20 | check-docs-consistency 通过 | 索引同步;链接全活 |

### 4.4 Phase 4 — Executor Runtime(F11 + F12 + F13)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | wrangler Queue binding | `workers/orchestrator-core/wrangler.jsonc` 加 `queues.producers: [{ queue: "nano-executor-jobs", binding: "EXECUTOR_QUEUE" }]`;新建 `workers/executor-runner/wrangler.jsonc`,声明 `queues.consumers: [{ queue: "nano-executor-jobs", max_batch_size: 10, max_batch_timeout: 30, max_retries: 3, dead_letter_queue: "nano-executor-dlq" }]` + `services` binding 到 orchestrator-core / agent-core / filesystem-core | `workers/orchestrator-core/wrangler.jsonc`, `workers/executor-runner/wrangler.jsonc` (NEW) | preview 部署 Queue producer/consumer 都 live | wrangler deploy --dry-run | 配置文件 lint 通过;preview 环境部署成功 |
| P4-02 | executor-runner worker 骨架 | 新建 `workers/executor-runner/src/index.ts`,实现 `queue(batch, env, ctx)` 入口 → 按 `message.body.kind` dispatch 到 `retry-handler / restore-handler / fork-handler`;每个 handler 必须**幂等**(读 D1 status,已是 terminal 直接 ack);失败抛错让 Queue retry;3 次后进 dead-letter | `workers/executor-runner/src/index.ts` (NEW), `workers/executor-runner/src/{retry,restore,fork}-handler.ts` (NEW) | consumer 启动消息 → dispatch | per-worker test(miniflare Queue 模拟器)mock 3 类 message,验证 dispatch | 3 类 handler 单测全绿 |
| P4-03 | F11 retry executor + producer | `workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40` 的 `handleRetryAbsorbed` 改为:校验 session 状态 → `env.EXECUTOR_QUEUE.send({ kind: "retry", session_uuid, target_turn_uuid?, requested_attempt_seed? })` → 返 `{ retry_kind: "queue-enqueued", session_uuid, session_status: status, requested_attempt_seed }`(legacy `hint` 字段移除);`retry-handler.ts` 消费时:取最近一个 user turn → 复制其 user prompt → POST `/sessions/{id}/messages` 内部调用(或直接 service binding 调 NanoSessionDO startTurn)→ 写 `nano_conversation_turns.requested_attempt_seed = ?, turn_attempt = old + 1`(`migrations/009-turn-attempt-and-message-supersede.sql` 已支持) | `workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40`, `workers/executor-runner/src/retry-handler.ts` (NEW) | retry 触发新 turn,而不是返 hint;`turn.attempt > 1` 在客户端可见 | e2e:跑一个 turn → POST /retry → 验证 D1 turn row 含 `requested_attempt_seed` 与 attempt+1 | retry executor SLA ≤10s P95 |
| P4-04 | F12 restore executor | `restore-handler.ts` 消费 `{ kind: "restore", job_uuid }`:调 `D1CheckpointRestoreJobs.markRunning`(`checkpoint-restore-plane.ts:468-490`)→ 按 mode(`conversation_only` / `files_only` / `conversation_and_files`)分别复制 R2 snapshot(走 `workers/filesystem-core/src/index.ts:209-235` `readSnapshot` + `writeTempFile`)+ 重置 D1 message ledger 到 watermark → `terminate(succeeded|partial|failed|rolled_back, failure_reason)`(`:498-544`);emit `session.restore.completed` 顶层帧;失败必填 `failure_reason`(Q24);幂等:已 terminal 直接 ack;Queue retry 3 次后强制 `terminate(rolled_back, "executor-failed-3-retries")` | `workers/executor-runner/src/restore-handler.ts` (NEW) | restore SLA ≤120s P95;失败有 `failure_reason` | e2e:打 checkpoint → restore conversation_only → 验证 messages 回滚 + WS 帧 emit;模拟失败场景验证 dead-letter + rolled_back | restore terminal 4 状态全覆盖 |
| P4-05 | F13 fork executor | `workers/orchestrator-core/src/hp-absorbed-handlers.ts:42-71` 的 `handleForkAbsorbed` 改为 enqueue;`fork-handler.ts` 消费 `{ kind: "fork", parent_session_uuid, child_session_uuid, from_checkpoint_uuid? }`:写 `nano_session_fork_lineage`(若表不存在则在 P1 一并加入 P1-03 之前的 migrations 中,实施时定位)→ 复制 parent workspace 到 child(走 filesystem-core 既有 RPC)→ 创建 child session DO(若已存在则跳过)→ emit `session.fork.created`(schema 已冻 `stream-event.ts:36-48`);Q23 frozen "same conversation only" 由 producer 校验 | `workers/orchestrator-core/src/hp-absorbed-handlers.ts:42-71`, `workers/executor-runner/src/fork-handler.ts` (NEW) | fork SLA ≤30s P95;child session 在 fork 后可 attach | e2e:fork → 验证 child session active + workspace 内容一致 + WS 帧 emit | fork executor 幂等;Q23 不允许跨 conversation |
| P4-06 | DO alarm 兜底监控 | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` 在 DO 初始化时 set alarm(每 5 分钟);alarm 触发时:扫 `nano_checkpoint_restore_jobs WHERE status='running' AND started_at < now()-5min`,把这些 job 重新 enqueue;同样扫 retry/fork stuck | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`, `workers/orchestrator-core/src/checkpoint-restore-plane.ts`(扫描 query) | stuck job ≤10 分钟内被检测并重投 | 模拟 stuck job 测试 | alarm 不参与主执行;仅作为 5 分钟兜底 |

### 4.5 Phase 5 — Item Projection + File-Change(F14 + F15)

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | F14 item projection plane | 新建 `item-projection-plane.ts`;实现 `listItems({ session_uuid, cursor?, limit })` 与 `readItem({ session_uuid, item_uuid })`;按 design 附录 C.2 source map 投影:`agent_message ← nano_session_messages` / `reasoning ← stream event ledger(llm.delta content_type=reasoning)` / `tool_call ← nano_tool_call_ledger`(F6 已 live)/ `file_change ← nano_session_temp_files write event`(F15)/ `todo_list ← nano_session_todos snapshot` / `confirmation ← nano_session_confirmations` / `error ← nano_error_log`;cursor 走 7 张表并行 + 内存合并排序 + cursor pagination(limit ≤ 200) | `workers/orchestrator-core/src/item-projection-plane.ts` (NEW), `workers/orchestrator-core/test/item-projection-plane.test.ts` (NEW) | 7 类 item 投影正确;cursor 翻页正确 | per-worker test ≥ 14 case(7 类 × happy + edge) | 投影性能 ≤500ms P95(limit=50) |
| P5-02 | F14 `/items` HTTP 路由 | 新建 `session-items.ts` route 注册 `GET /sessions/{id}/items` + `GET /items/{item_uuid}`;返 facade-http-v1 envelope | `workers/orchestrator-core/src/facade/routes/session-items.ts` (NEW), `workers/orchestrator-core/src/facade/route-registry.ts` | `/items` 路由 live;source row archive → `404 item-archived` | per-worker contracts | 路由 e2e fixture 通过 |
| P5-03 | F14 WS `session.item.*` emitter | source row write 时同步 emit `session.item.started / .updated / .completed`(走 emit-helpers F0 + 新 schema P1-04);**已 live** stream-event(turn.begin / tool.call.* / llm.delta)继续作为 first-class stream,item.* 是对象层补充 | `workers/orchestrator-core/src/{confirmation-control-plane,todo-control-plane,tool-call-ledger,checkpoint-restore-plane}.ts` 的 row write 处加 hook | item 帧与 source row 同 commit;reconnect 时 `last_seen_seq` 同时覆盖 | e2e:跑完整 turn,确认所有 7 类 item 都有 `started → completed` 完整链路 | 7 类 item emit 全覆盖 |
| P5-04 | F15 file_change item + emitter | `workers/filesystem-core/src/index.ts:140-205` 的 `writeTempFile / deleteTempFile` 在 R2 写入成功 + D1 metadata 更新成功后,通过 service binding 调 orchestrator-core `item-projection-plane.emitFileChange({ session_uuid, virtual_path, change_kind: "created"|"modified"|"deleted", size_delta, content_hash })`;item.kind="file_change" | `workers/filesystem-core/src/index.ts:140-205`, `workers/orchestrator-core/src/item-projection-plane.ts` | LLM 写文件 ≤500ms 收到 file_change item | e2e:agent 写 / 修改 / 删除 workspace file,前端可见对应 file_change item | 3 种 change_kind 全覆盖;size_delta 与 content_hash 准确 |
| P5-05 | docs:items.md + tool-calls.md(新)+ 索引 | 新建 `clients/api-docs/items.md` 详述 7 类 item + WS 帧 + cursor pagination;新建 `clients/api-docs/tool-calls.md` 详述 `/tool-calls` list + detail + `nano_tool_call_ledger` 字段(从 `workspace.md` 内 tool-calls 一节移出);更新 `clients/api-docs/README.md` 索引到 22-doc(20 + items + tool-calls) | `clients/api-docs/items.md` (NEW), `clients/api-docs/tool-calls.md` (NEW), `clients/api-docs/workspace.md`(移出 tool-calls 一节), `clients/api-docs/README.md` | 22-doc 索引同步 | check-docs-consistency 通过 | docs 索引一致;链接全活 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Schema + Migration Foundations

- **Phase 目标**:把 HPX6 所有新 D1 表与新顶层帧 schema 一次性落到位。
- **本 Phase 对应编号**:`P1-01 / P1-02 / P1-03 / P1-04 / P1-05`
- **本 Phase 新增文件**:
  - `workers/orchestrator-core/migrations/015-tool-call-ledger.sql`
  - `workers/orchestrator-core/migrations/016-session-runtime-config.sql`
  - `workers/orchestrator-core/migrations/017-team-permission-rules.sql`
- **本 Phase 修改文件**:
  - `packages/nacp-session/src/messages.ts`(新增 5 个 schema + 注册 SESSION_BODY_SCHEMAS)
  - `packages/nacp-session/src/type-direction-matrix.ts`(注册 5 个新 message_type direction)
  - `packages/nacp-session/src/session-registry.ts`(注册 server-side / event delivery)
  - `packages/nacp-session/package.json`(版本 1.4.0 → 1.5.0)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. 3 张新 D1 表 migration 通过 `wrangler d1 migrations apply` 在 preview 环境落地
  2. nacp-session 1.5.0 publish to GitHub Packages,新 schema 在 zod parse round-trip OK
  3. direction matrix 校验:`session.runtime.update / .restore.completed / .item.{started,updated,completed}` 都是 server→client `event`
- **具体测试安排**:
  - **单测**:`pnpm --filter @haimang/nacp-session test`(新增 5 schema 各 ≥ 1 case)
  - **集成测试**:wrangler local D1 apply
  - **回归测试**:现有 14 个 migration 不退化;现有 13-kind stream-event union 不动
  - **手动验证**:`wrangler d1 execute --local DB1 --command "SELECT name FROM sqlite_master"` 看到新 3 表
- **收口标准**:
  - 3 表 + 5 schema 全 live
  - nacp-session 1.5.0 publish 成功
- **本 Phase 风险提醒**:
  - 注意 `nano_session_fork_lineage` 表是否已存在(若 HP7 substrate 已建则 P4-05 复用;否则 P1 内一并加 migration `018-session-fork-lineage.sql`,实施时 grep 现有 `migrations/*.sql` 验证)

### 5.2 Phase 2 — followup_input + Tool-calls Ledger(F6 + F8)

- **Phase 目标**:client→server `session.followup_input` 公网 WS 链路通;tool-calls 真实读 D1。
- **本 Phase 对应编号**:`P2-01 / P2-02 / P2-03 / P2-04 / P2-05`
- **本 Phase 新增文件**:
  - `workers/orchestrator-core/src/tool-call-ledger.ts`
  - `workers/orchestrator-core/test/tool-call-ledger.test.ts`
  - `tests/contracts/followup-input.test.ts`
- **本 Phase 修改文件**:
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts:167`(扩 inbound parse + 转发)
  - `workers/agent-core/src/kernel/events.ts:73-102` 邻近(钩 D1 write)
  - `workers/agent-core/src/host/runtime-mainline.ts`(钩位置具体在 onToolEvent)
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:158-269`(真实读 + detail 路由)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. 公网 WS inbound 帧解析:`event.data` JSON.parse → check `kind` → 若 `session.followup_input` 转发 NanoSessionDO,其余维持 activity touch 行为
  2. `D1ToolCallLedger.upsert` 在 tool.call.progress(status='running') 与 tool.call.result(status=终态)各调一次,idempotent
  3. `/tool-calls` list 走 cursor scan;detail 路由含完整字段;output 超 budget 走 R2 spill
- **具体测试安排**:
  - **单测**:`tool-call-ledger.test.ts` ≥ 6 case
  - **集成测试**:`followup-input.test.ts` 4 case
  - **回归测试**:既有 `/timeline` 仍可用;tool execution 性能不退化(P99 ≤ +5ms)
  - **手动验证**:wrangler 本地起,WS 客户端 push followup → 验证 next turn 含 followup
- **收口标准**:
  - tool execution 延迟 P99 ≤ +5ms
  - followup_input e2e 4 case 全绿
  - `/tool-calls` 真实化(`source: "d1-ledger-live"`)
- **本 Phase 风险提醒**:
  - F8 inbound parse 错误必须容错(JSON.parse fail → 仍走 activity touch + 不打断 socket);否则恶意客户端可一帧拆 socket
  - F6 D1 write 失败必须 `waitUntil` 异常 swallow + 计 metric,绝不阻塞 stream

### 5.3 Phase 3 — Runtime Config + Permission Rules + Hard Delete(F9 + F10 + Q-bridging-7)

- **Phase 目标**:`/runtime` 路由 live + permission_rules 生效 + 直接删 legacy permission_mode。
- **本 Phase 对应编号**:`P3-01 / P3-02 / P3-03 / P3-04 / P3-05`
- **本 Phase 新增文件**:
  - `workers/orchestrator-core/src/runtime-config-plane.ts`
  - `workers/orchestrator-core/src/permission-rules-plane.ts`
  - `workers/orchestrator-core/src/facade/routes/session-runtime.ts`
  - `clients/api-docs/runtime.md`
- **本 Phase 修改文件**:
  - `workers/orchestrator-core/src/facade/route-registry.ts`(注册 /runtime 路由)
  - `workers/orchestrator-core/src/facade/routes/session-bridge.ts:32, 77, 116`(**删** `"policy/permission_mode"`)
  - `workers/orchestrator-core/src/user-do/surface-runtime.ts:660-682`(**删** handlePermissionMode 整段)
  - agent-core 内任何 `permission_mode` KV 读取点(grep 定位)→ 改读 `runtime_config.approval_policy`
  - `clients/api-docs/permissions.md`(改写为已废弃 + 迁移指南)
  - `clients/api-docs/README.md`(索引 19 → 20)
- **本 Phase 删除文件**:无(代码段删除,不删整文件)
- **具体功能预期**:
  1. `GET /sessions/{id}/runtime` 返完整 RuntimeConfig;首次访问由 plane `ensure()` 创建默认 row
  2. `PATCH /sessions/{id}/runtime { permission_rules?, network_policy?, web_search?, workspace_scope?, approval_policy?, version }` 乐观锁更新;成功 emit `session.runtime.update`
  3. agent-core PreToolUse 决策:`permission_rules` 命中 → 终态(allow / deny / ask);全 miss 落 `approval_policy`(替代 legacy mode);**绝不**再读 `permission_mode/{sessionUuid}` KV
  4. `POST /sessions/{id}/policy/permission_mode` 返 `404 not-found`(facade unknown route 默认行为)
- **具体测试安排**:
  - **单测**:runtime-config-plane ≥ 5 case;permission-rules-plane ≥ 5 case
  - **集成测试**:e2e 跑 PATCH runtime → tool call 命中 rule 不 emit confirmation;legacy `POST /policy/permission_mode` 返 404
  - **回归测试**:现有 confirmation HTTP plane 不退化(rule miss + mode=ask 时仍 emit confirmation)
  - **手动验证**:wrangler 本地起,curl `POST /policy/permission_mode` 必须 404
- **收口标准**:
  - grep 整仓 `permission_mode` 仅出现在 docs 迁移指南与 D1 migration 历史
  - `/runtime` 路由 GET/PATCH e2e 全绿
  - rule 优先 > mode fallback 在 e2e 验证
- **本 Phase 风险提醒**:
  - **Q-bridging-7 hard delete 是 breaking change**:必须在 HPX6 freeze 前协调所有客户端完成迁移;owner 决议不留 dual-write 兼容窗口
  - permission_rules glob 第一版只支持 `*` 与字面量,复杂正则留扩展点

### 5.4 Phase 4 — Executor Runtime(F11 + F12 + F13)

- **Phase 目标**:Cloudflare Queue 主路径 + DO alarm 兜底,真实化 retry/restore/fork。
- **本 Phase 对应编号**:`P4-01 / P4-02 / P4-03 / P4-04 / P4-05 / P4-06`
- **本 Phase 新增文件**:
  - `workers/executor-runner/wrangler.jsonc`
  - `workers/executor-runner/src/index.ts`
  - `workers/executor-runner/src/{retry,restore,fork}-handler.ts`
  - `workers/executor-runner/test/*.test.ts`
- **本 Phase 修改文件**:
  - `workers/orchestrator-core/wrangler.jsonc`(Queue producer binding)
  - `workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40`(retry → enqueue)
  - `workers/orchestrator-core/src/hp-absorbed-handlers.ts:42-71`(fork → enqueue)
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`(DO alarm 兜底)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. Queue `nano-executor-jobs` + dead-letter `nano-executor-dlq` 在 preview / production wrangler 配置生效
  2. `executor-runner` worker 消费 batch;dispatch 到 retry / restore / fork handler
  3. 三类 handler 全部**幂等**(读 D1 status,已 terminal 直接 ack)
  4. 失败:Queue retry 3 次 → dead-letter;handler 内捕获并写 `failure_reason` + `terminate(rolled_back)`(restore)/ session `ended_reason="fork_failed"`(fork)
  5. DO alarm 每 5 分钟扫 stuck running job(`status='running' AND started_at < now()-5min`),重投 Queue
- **具体测试安排**:
  - **单测**:每个 handler ≥ 4 case(happy / 幂等 / 失败 / dead-letter)
  - **集成测试**:miniflare Queue 模拟器跑端到端 retry / restore / fork
  - **回归测试**:HPX5 e2e 不退化;`hp-absorbed-handlers.ts` 既有 first-wave ack 行为完全替换
  - **手动验证**:preview 部署 + curl `/retry` `/restore` `/fork`,验证 SLA 内推到 terminal
- **收口标准**:
  - retry SLA ≤10s P95;restore ≤120s P95;fork ≤30s P95
  - dead-letter 监控配置 OK
  - Q23 不允许跨 conversation fork(producer 校验)
- **本 Phase 风险提醒**:
  - executor-runner 是 nano-agent 第 7 个 worker;wrangler / 部署文档同步;监控告警接入由运维
  - DO alarm 5 分钟限制要严格,绝不在 alarm 内执行长任务

### 5.5 Phase 5 — Item Projection + File-Change(F14 + F15)

- **Phase 目标**:抽出 Codex 风格 7 类 item 对象层;file_change 事件 live。
- **本 Phase 对应编号**:`P5-01 / P5-02 / P5-03 / P5-04 / P5-05`
- **本 Phase 新增文件**:
  - `workers/orchestrator-core/src/item-projection-plane.ts`
  - `workers/orchestrator-core/src/facade/routes/session-items.ts`
  - `workers/orchestrator-core/test/item-projection-plane.test.ts`
  - `clients/api-docs/items.md`
  - `clients/api-docs/tool-calls.md`
- **本 Phase 修改文件**:
  - `workers/orchestrator-core/src/facade/route-registry.ts`(注册 /items)
  - `workers/orchestrator-core/src/{confirmation-control-plane,todo-control-plane,tool-call-ledger,checkpoint-restore-plane}.ts`(row write 时同步 emit item.*)
  - `workers/filesystem-core/src/index.ts:140-205`(write/delete 后 emit file_change)
  - `clients/api-docs/workspace.md`(移出 tool-calls 一节)
  - `clients/api-docs/README.md`(索引 20 → 22)
- **本 Phase 删除文件**:无
- **具体功能预期**:
  1. `GET /sessions/{id}/items?cursor=&limit=` 返按时间倒序的 7 类 item;cursor pagination
  2. `GET /items/{item_uuid}` 返单条详情
  3. WS `session.item.{started,updated,completed}` 与 source row 同 commit emit
  4. file_change item 含 path / change_kind(created|modified|deleted) / size_delta / content_hash
- **具体测试安排**:
  - **单测**:item-projection-plane ≥ 14 case(7 类 × happy + edge)
  - **集成测试**:e2e 跑完整 turn(含 confirmation / todo / tool_call / file_change / restore.completed),验证 7 类 item 都有完整 started→completed 链路
  - **回归测试**:既有 stream-event 13 帧不退化;前端可继续基于 stream 渲染,也可基于 item 渲染
  - **手动验证**:wrangler 本地起,跑一个 LLM 写文件 → file_change item 在 `/items` 出现 + WS push
- **收口标准**:
  - 7 类 item 全 live
  - cursor pagination 性能 ≤500ms P95(limit=50)
  - source row archive 时 item 返 `404 item-archived`
- **本 Phase 风险提醒**:
  - item projection 跨 7 张表查询性能;务必走索引(`session_uuid` + `started_at` 倒序);limit 必须强制 ≤200
  - `last_seen_seq` 必须同时覆盖 stream-event 与 item.* 帧 — 检查 reconnect buffer 实现

---

## 6. 依赖的冻结设计决策(只读引用)

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|-------------|----------|----------------|----------------|
| Q-bridging-1(NACP 1.1.0 不 bump) | `HPX5-HPX6-bridging-api-gap.md` §0.4 | nacp-session 包升 minor(1.5.0)+ 加新 message_type;runtime NACP_VERSION 不变 | n/a |
| Q-bridging-3(followup_input 完整 frozen shape) | `HPX5-HPX6-bridging-api-gap.md` §0.4 / `messages.ts:119-126` | F8 透传完整 shape;首版 client MVP 只依赖 text;不收窄 schema | n/a |
| Q-bridging-4(runtime config session-scoped) | `HPX5-HPX6-bridging-api-gap.md` §0.4 / §6.1 取舍 4 | F9 D1 表只在 session 级;不引入 turn-scoped | n/a |
| Q-bridging-5(executor 复用已冻 D1 表) | `HPX5-HPX6-bridging-api-gap.md` §0.4 | F11/F12/F13 复用 `nano_conversation_turns` / `nano_checkpoint_restore_jobs` / `nano_session_fork_lineage`,不新增 truth | n/a |
| Q-bridging-6(item 与新顶层帧走独立路径) | `HPX5-HPX6-bridging-api-gap.md` §0.4 / 附录 C.3 | F14 item.* + F12 restore.completed + F9 runtime.update 全部走 emit-helpers F0,**不**进 stream-event 13-kind union | n/a |
| Q-bridging-7(直接删 legacy `permission_mode`,不留 dual-write) | `HPX5-HPX6-bridging-api-gap.md` §0.4 v0.2.1 owner 决议 | P3-04 hard delete 是 HPX6 必做;无 fallback | breaking change,客户端必须协调迁移 |
| Q-bridging-8(executor 走 Cloudflare Queue + DO alarm 兜底) | `HPX5-HPX6-bridging-api-gap.md` §0.4 / §6.1 取舍 8 | F11/F12/F13 部署面 = wrangler Queue binding + 第 7 worker | 若 Queue 部署有 blocker,回 design 重选 runtime |
| Q24(restore 失败必填 failure_reason) | `HPX-qna.md` Q24 / `checkpoint-restore-plane.ts:498-516` | F12 restore-handler 必须遵守 | n/a(plane 已强校验) |
| Q23(fork = same conversation only) | `HPX-qna.md` Q23 | F13 producer 必须校验 | n/a |
| HP6 at-most-1 in_progress(Q19) | `HP6-tool-workspace-state-machine.md` / `HPX-qna.md` Q19 | F14 todo_list item 投影时尊重 invariant | n/a |
| HPX5 emit-helpers F0 已 live | HPX5 收口 | F9/F12/F14 所有新顶层帧都走 F0 | 若 HPX5 未收口,HPX6 blocked |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| Cloudflare Queue 首次引入部署面 | 7 个 worker + 新 Queue + dead-letter,部署复杂度上一档 | medium | preview 环境完整跑 P4 e2e;dead-letter 告警接入 |
| `permission_mode` hard delete | breaking change,客户端必须迁移 | high | HPX6 freeze 前与所有 client 协调;`permissions.md` 改写为迁移指南 |
| F8 inbound JSON.parse 容错 | 恶意客户端可一帧拆 socket | medium | parse fail → 仍 activity touch + 不打断 socket |
| F6 D1 写性能 | 每次 tool call +1 D1 write | low | `waitUntil` 异步;目标 P99 ≤ +5ms |
| F12 R2 大量复制 | restore 含大量 workspace 文件 | medium | 走 Queue at-least-once;失败 retry 3 次 + dead-letter;DO alarm 5 分钟兜底重投 |
| F14 item projection 性能 | 跨 7 表查询 + 内存合并 | medium | 强制 limit ≤ 200;cursor pagination;走索引 |
| F14 item_uuid 稳定性 | source row 被 compact / archive | low | compact / archive 走 soft delete;source 缺失返 `404 item-archived` |
| executor 幂等性 | Queue at-least-once 投递 | medium | 每个 handler 读 D1 status,已 terminal 直接 ack |
| docs 索引 19 → 22 doc 漂移 | 新增 3 doc 后索引可能漏 | low | check-docs-consistency 加索引一致性校验 |
| nacp-session 1.5.0 部署不同步 | runtime 用旧版 schema 不识别新帧 | medium | 部署顺序:nacp-session publish → 全 worker rebuild deploy → 客户端升级 |

### 7.2 约束与前提

- **技术前提**:HPX5 已收口(emit-helpers F0 live);Cloudflare Workers 支持 Queue + Durable Object alarm;`@haimang` GitHub Packages 发布权限。
- **运行时前提**:Cloudflare Queue producer/consumer binding;wrangler 1.x+ 支持 dead-letter;NanoSessionDO alarm API 可用。
- **组织协作前提**:Q-bridging-7 hard delete 必须在 HPX6 freeze 前与全部客户端协调完成迁移;运维接入 dead-letter 告警。
- **上线 / 合并前提**:每个 Phase 完成必须 `pnpm test` + `pnpm test:contracts` + `pnpm test:cross-e2e` 全绿;preview 部署验证 retry / restore / fork SLA;legacy `POST /policy/permission_mode` 在 preview 已返 404。

### 7.3 文档同步要求

- 需要同步更新的设计文档:
  - `docs/design/hero-to-pro/HP7-checkpoint-revert.md`(closure 章节加"HPX6 restore/fork executor 走 Cloudflare Queue 收口")
  - `docs/design/hero-to-pro/HP6-tool-workspace-state-machine.md`(closure 章节加"HPX6 tool-call ledger D1 truth + item projection 收口")
  - `docs/design/hero-to-pro/HP5-confirmation-control-plane.md`(closure 章节加"HPX6 confirmation 进入 item projection")
- 需要同步更新的说明文档 / README:
  - `clients/api-docs/README.md`(索引 19 → 22:加 `runtime.md` `items.md` `tool-calls.md`;`permissions.md` 改为废弃迁移指南)
  - `README.md`(若 root README 引用 worker count 6,改 7;引用 plan-hero-to-pro.md 处确认 hero-to-platform 已删)
  - `docs/charter/plan-hero-to-pro.md`(若有 hero-to-platform 引用,删)
- 需要同步更新的测试说明:
  - `workers/executor-runner/test/README.md`(NEW)
  - `workers/orchestrator-core/test/README.md`(加 runtime / items / tool-calls 测试范围)

### 7.4 完成后的预期状态

1. tool-calls 历史可查询(D1 truth + `/tool-calls` list/detail);前端 transcript / replay 完整。
2. followup_input 在 `attached / turn_running` phase 可通过 WS push,完整 frozen shape 透传;首版前端 client 只依赖 text,advanced 字段对 SDK 集成方开放。
3. `/runtime` GET/PATCH live;`permission_rules` 优先级 > mode fallback;legacy `POST /sessions/{id}/policy/permission_mode` 路由返 404,KV `permission_mode/*` 不再写入。
4. retry / restore / fork 三类 executor 走 Cloudflare Queue + DO alarm 兜底,均推到 terminal(SLA: retry ≤10s / fork ≤30s / restore ≤120s P95);`session.restore.completed` / `session.fork.created` 真实 emit。
5. 7 类 item(`agent_message / reasoning / tool_call / file_change / todo_list / confirmation / error`)可通过 `/items` HTTP + `session.item.{started,updated,completed}` WS 订阅;前端 reducer 友好。
6. `file_change` item 在 LLM 写 workspace 文件时 ≤500ms emit;前端 IDE-style diff viewer 基础就绪。
7. 22-doc pack 索引同步;`scripts/check-docs-consistency.mjs` 通过;hero-to-platform 概念全仓清除。
8. nano-agent 兑现 README "WebSocket-first 持久化 agent runtime" + Codex 风格 workbench 后端定位。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**:
  - `pnpm install`、`pnpm typecheck`、`pnpm lint` 全过
  - `pnpm check:cycles` 不退化
  - `wrangler d1 migrations apply`(015/016/017)preview/local 全成功
- **单元测试**:
  - `pnpm --filter @haimang/{nacp-session,orchestrator-core-worker,agent-core-worker,filesystem-core-worker,executor-runner-worker} test`
- **集成测试**:
  - `pnpm test:contracts`(F8 followup / F9 runtime / F10 rules / F14 item / F15 file_change 全覆盖)
  - `pnpm test:cross-e2e`(retry/restore/fork 端到端 SLA;hard delete legacy 路由 404;item projection 7 类全链路)
- **端到端 / 手动验证**:
  - preview 部署 + 本地 client:create session → patch runtime(set always-allow Read rule)→ tool call(应无 confirmation)→ patch runtime(remove rule + approval_policy=ask)→ 下次 tool call 应 emit confirmation;curl `POST /sessions/{id}/policy/permission_mode` 必须 404;create checkpoint → restore 不同 mode → 验证 restore.completed 帧;fork → child session active + workspace 一致
  - LLM 写 workspace file → 前端订阅 `/items` 看到 file_change
- **回归测试**:
  - HPX5 全部 e2e 不退化(F0–F5 + F7);现有 18-doc 描述路由行为 0 退化(除 legacy permission_mode 已 hard delete)
  - confirmation HTTP plane / todos HTTP plane / artifact bytes 全不退化
- **文档校验**:
  - `node scripts/check-docs-consistency.mjs` 0 违规
  - 22-doc 索引同步;无 broken link

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后,至少应满足以下条件:

1. F6 + F8 + F9 + F10 + F11 + F12 + F13 + F14 + F15 全部 e2e 通过对应 SLA
2. legacy `POST /sessions/{id}/policy/permission_mode` 路由 100% 返 404;`permission_mode` KV 在 preview 环境**完全为空**
3. Cloudflare Queue + executor-runner worker 在 preview 环境 7 worker 部署成功;dead-letter 配置 OK
4. nacp-session 1.5.0 publish 完成;runtime 全 worker 已升级
5. 22-doc pack 索引同步;hero-to-platform 概念全仓清除
6. `pnpm test` 根 alias、`pnpm test:contracts`、`pnpm test:cross-e2e` 全绿
7. 现有 HPX5 已 live 的 emitter / capability / runtime 0 退化

### 8.3 完成定义(Definition of Done)

| 维度 | 完成定义 |
|------|----------|
| 功能 | F6/F8/F9/F10/F11/F12/F13/F14/F15 九项功能均有 e2e fixture 覆盖 SLA;legacy permission_mode hard delete 验证 404 |
| 测试 | 单测 + contracts + cross-e2e + miniflare Queue 模拟器全绿;item projection 7 类 ≥ 14 case |
| 文档 | 22-doc pack 索引同步;`runtime.md` / `items.md` / `tool-calls.md` 新落地;`permissions.md` 改为废弃迁移指南;hero-to-platform 全仓清除 |
| 风险收敛 | §7.1 表内 10 项风险均有缓解或被 e2e 验证不发生 |
| 可交付性 | preview 部署 7 worker 全 live;客户端可基于 22-doc pack 写出完整 agent loop workbench;Cloudflare Queue dead-letter 监控告警接入 |

---

## 9. 执行日志回填(仅 `executed` 状态使用)

- **实际执行摘要**:`(待 executed 时回填)`
- **Phase 偏差**:`(待 executed 时回填)`
- **阻塞与处理**:`(待 executed 时回填)`
- **测试发现**:`(待 executed 时回填)`
- **后续 handoff**:`(待 executed 时回填)`
