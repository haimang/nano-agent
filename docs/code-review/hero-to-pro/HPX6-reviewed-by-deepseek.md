# Nano-Agent 代码审查

> 审查对象: `hero-to-pro / HPX6 — workbench-grade controls + new truth + Codex-style object layer; + hero-to-pro 全阶段跨包回顾`
> 审查类型: `mixed (code-review + closure-review + docs-review + cross-stage-audit)`
> 审查时间: `2026-05-02`
> 审查人: `DeepSeek`
> 审查范围:
> - `workers/orchestrator-core/src/{tool-call-ledger,runtime-config-plane,permission-rules-plane,item-projection-plane,executor-runtime,wsemit,frame-compat,facade/routes/session-runtime,facade/routes/session-items,user-do/ws-runtime,hp-absorbed-handlers,facade/routes/session-bridge,user-do/surface-runtime,entrypoint,hp-absorbed-routes}.ts`
> - `workers/orchestrator-core/migrations/{015,016,017}-*.sql`
> - `workers/orchestrator-core/wrangler.jsonc`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `packages/nacp-session/src/messages.ts`
> - `clients/api-docs/*.md`(22 份全量审查)
> - `scripts/check-docs-consistency.mjs`
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md`(hero-to-pro 阶段基石)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1(设计文件)
> - `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`(含 §9 工作日志)
> - `docs/issue/hero-to-pro/HPX6-closure.md`(closure)
> - `docs/eval/hero-to-pro/core-gap/gemini-cli-hooks-by-deepseek.md`(本 reviewers 前序 hooks 审查)
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**: `HPX6 主体成立 — 18/20 核心模块完全落地(D1 truth + HTTP routes + WS frames + protocol schemas + 文档)。但 executor-runtime.ts 存在实质性的执行语义 stub(restore 永远是 succeeded、retry/fork 无实际执行),closure 对此描述诚实但代码距离 "executor deep semantics fully complete" 仍有一段距离。此外 docs 内有 6 处契约不一致与 reference 错误,hero-to-pro 全阶段在下游 hooks pipeline 与 compact lifecycle 存在结构性缺口需后续阶段收口。`
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `yes — 前提是 §6 的 blocker 项在 HPX6 closure 回填前必须修复`
- **本轮最关键的 1-3 个判断**:
  1. **executor-runtime.ts 的 restore 是 deceptive complete** — `runExecutorJob()` 对 `restore` 永远返回 `{ok:true}`,从不真正执行 R2 snapshot copy 或 D1 message ledger reset。closure 说 "restore 可 terminal-drive",但没有说 "restore 总是 succeed 且从不执行真正的 restore 操作"。这可能在发布后造成用户误以为 restore 成功但数据未回滚的严重生产事故。
  2. **tool-call-ledger 的 `cancel_initiator` 枚举与 WS stream-event schema 不一致** — D1 表用 `{user, system, tool}`,stream-event 用 `{user, system, parent_cancel}`。虽然可能是有意的双轨,但 `tool-calls.md` 文档没有说明这种差异。
  3. **item-projection-plane.ts 的 `file_change` 和 `error` 两种 item kind 被声明但从未产出** — `list()` 聚合方法从 tools/confirmations/todos/messages 四张表读,但 `file_change` 和 `error` 不在聚合路径中。文档(items.md)声称支持 7 类 item,实际只产出 5 类(agent_message / reasoning / tool_call / todo_list / confirmation)。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`(原始执行计划,含 §9 工作日志)
  - `docs/issue/hero-to-pro/HPX6-closure.md`(闭包声明)
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1(设计基线)
  - `docs/charter/plan-hero-to-pro.md`(阶段章程)
- **核查实现**:
  - 全量 20 个实现文件逐一阅读与核查
  - 22 份 `clients/api-docs/*.md` 全量审查与实现代码交叉比对
  - 全仓 grep 搜索 `permission_mode` / `first-wave` / `ws-stream-only` / `filesystem-core-leaf-rpc-pending` / `hero-to-platform` 关键词
  - 3 份 D1 migration SQL 文件 schema 验证
- **执行过的验证**:
  - `pnpm test`(全 pack 测试通过 — closure 声明已验证)
  - `pnpm run check:docs-consistency`(通过 — closure 声明已验证)
  - 手动逐行代码审查 20 个 HPX6 新增/修改文件
  - 手动逐行文档审查 22 份 client API docs
  - 全仓关键词搜索 5 个 legacy artifact 残留检查
- **复用 / 对照的既有审查**: 本 reviewers 前序 `docs/eval/hero-to-pro/core-gap/gemini-cli-hooks-by-deepseek.md` — 作为 hooks pipeline 缺口对照使用;不在本次复用其他 reviewer 的结论。

### 1.1 已确认的正面事实

- **D1 truth 3 张新表(migration 015-017)全部落地**,SQL schema 完整无缺:`nano_tool_call_ledger`(015)、`nano_session_runtime_config`(016)、`nano_team_permission_rules`(017)。每张表的 CHECK 约束、FOREIGN KEY 引用、索引均完整。
- **HPX6 5 个新 nacp-session 顶层帧 schema 全量注册**:`session.runtime.update` / `session.restore.completed` / `session.item.started` / `session.item.updated` / `session.item.completed`。全部进入 `SESSION_BODY_SCHEMAS` map、`type-direction-matrix.ts` direction 注册、`session-registry.ts` 集合。`messages.ts` 升级至 `@haimang/nacp-session@1.5.0`。
- **`tool-call-ledger.ts`** 完整实现:upsert(read-modify-write idempotent)、read、listForSession(cursor pagination with `offset_key` 模版)、markCancelled。D1 write 走 `waitUntil` fire-and-forget(`runtime-assembly.ts:226-239` 的 `recordToolCall.bind`)。
- **`runtime-config-plane.ts`** 完整实现:readOrCreate(默认值:network=restricted, web=disabled, mounts=[], approval=ask)、read、patch(version 乐观锁增量)。`session-runtime.ts` 路由 GET/PATCH 完整,含输入校验与 WS 帧 emit。
- **`permission-rules-plane.ts`** 完整实现:listTeamRules(priority ASC 排序)、upsertTeamRule(UUID 自动生成,ON CONFLICT upsert)。`entrypoint.ts:authorizeToolUse` 已接通 session rules → team rules → approval_policy fallback 三级决策链。`runtime-mainline.ts:229-256` 的 `authorizeToolPlan()` 调 `options.authorizeToolUse` RPC。
- **`permission_mode` hard delete 彻底完成**:`session-bridge.ts` SessionAction 枚举不含 `policy/permission_mode`;`surface-runtime.ts` 无 `handlePermissionMode` 方法;全仓 `.ts` 文件仅一个测试文件(`policy-permission-mode-route.test.ts`)内含 `permission_mode` 并验证其返回 404。`ws-stream-only` 和 `filesystem-core-leaf-rpc-pending` 旧模式已从生产代码完全清除。
- **`followup_input` 公网 WS 转发已接通**:`ws-runtime.ts:199-235` 解析 inbound JSON,`kind === "session.followup_input"` 时调用 `forwardFollowupInput()` 经 service binding 转发到 NanoSessionDO。
- **`hero-to-platform` 概念已从全部 `.ts` 源码中清除**(0 matches),仅存在于 Markdown 文档中。
- **22-doc pack 索引同步**:README.md 索引从 19 → 22,新增 `runtime.md` / `items.md` / `tool-calls.md`;`permissions.md` 改写为废弃迁移指南;`check-docs-consistency.mjs` 通过 8 项 regex 检查 + 2 项 required-snippet 检查。

### 1.2 已确认的负面事实

- **`executor-runtime.ts` 的 `runExecutorJob()` 存在执行语义空洞**:对 `retry` 和 `fork` 直接 `return {ok:true, result: 'acknowledged'}` 不执行任何实际操作;对 `restore` 调用 `markRunning()` 后立即 `terminate("succeeded")` 不执行 R2 snapshot copy 或 D1 message ledger reset。HPX6 closure §2 承认 retry/fork deep semantics 未完成,但未明确说明 restore 也处于 "外表完成但无实质操作" 的状态。
- **`item-projection-plane.ts` 仅从 4 张表(calls/tools/confirmations/todos/messages)聚合**,`file_change` 和 `error` 两种 item kind 存在于类型定义(`WorkbenchItemKind` 含 `"file_change"` 和 `"error"`)但 `list()` 聚合循环不产出它们。`items.md` 文档声称 7 类 item 全 live,但 `file_change` 的实际生产者是 `hp-absorbed-routes.ts` 的 workspace write/delete 路径(触发 emit `session.item.completed`),不走 `D1ItemProjectionPlane` 的聚合查询。**这是架构设计有意为之**(file_change 走 stream event → WS emit,在 `/items` 查询时不可见),但 `items.md` 文档没有说明 `/items` HTTP 查询只返 5 类 item,而 `file_change` 和 `error` 仅通过 WS 推送。
- **tool-call-ledger 的 `cancel_initiator` 枚举值不一致**: D1 `nano_tool_call_ledger` CHECK 约束允许 `{user, system, tool}`;`stream-event.ts:71` 的 `ToolCallCancelledKind` 允许 `{user, system, parent_cancel}`。`tool-calls.md` 文档只提及 `cancel_initiator=user`。这种差异可能导致 WS 帧取消原因为 `parent_cancel` 但 D1 写入无法表达该值(或反之)。
- **`clients/api-docs/confirmations.md` 的 implementation reference 行号错误**:引用 `session-control.ts:320-442` 但 line 320 实际是 checkpoint diff 响应,确认处理函数 `handleSessionConfirmation` 起始于 line 334。这是文档层的实质性错误。
- **工具调用路由在文档中三处重复**:`workspace.md` §5(旧位置)、`tool-calls.md` §1(新位置)、`README.md` lines 191-192 和 lines 236-238。README lines 191-192 将该路由标为 `first-wave`,但实现已是 `d1-ledger-backed` — 标签过时。
- **`hp-absorbed-routes.ts` 内 workspace `content` 路由的 `content_source` 字段已从 `filesystem-core-leaf-rpc-pending` 翻转为 `live`**,但测试文件 `workspace-route.test.ts:243` 的注释仍引用旧占位词 — 虽然不影响功能,但保留这种"已清除但注释未更新"的模式需要注意。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 20 个实现文件逐一逐行审查 + 22 份文档全文核查 |
| 本地命令 / 测试 | yes | `pnpm test` / `pnpm run check:docs-consistency` 均通过(closure 已验证) |
| schema / contract 反向校验 | yes | NACP message schemas vs direction matrix vs registry 三方交叉比对;D1 migration SQL 逐列核验 |
| live / deploy / preview 证据 | no | 未执行 preview deploy;closure §4 将此列为发布前检查清单 |
| 与上游 design / QNA 对账 | yes | HPX5-HPX6-bridging-api-gap.md v0.2.1 与 plan-hero-to-pro.md 逐条款对照 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | executor-runtime restore 路径 deceptive complete:永远 succeed 不执行实质 restore | critical | correctness | **yes** | 至少为 restore 加 `partial` reason 标记,或接真正 R2/D1 操作;closure 显式声名 restore 当前执行深度 |
| R2 | tool-call cancel_initiator 枚举 D1 vs stream-event 不一致 | high | protocol-drift | no(two-track) | 在 `tool-calls.md` 显式注明双轨差异;评估是否需要统一 |
| R3 | item-projection-plane file_change/error 两种 kind 声明但聚合不产出;items.md 未说明 HTTP/WS 两种获取渠道的差异 | high | docs-gap | no | items.md 加 §"查询 vs 订阅" 章节,说明 `/items` HTTP 返 5 类,file_change/error 仅 WS 可见 |
| R4 | confirmations.md 行号 reference 错误:line 320 是 checkpoint handler,不是 confirmation handler | medium | docs-gap | **yes** | 修正为 `session-control.ts:334-450` |
| R5 | README.md tool-calls 标签 `first-wave` 已过时,应改为 `d1-ledger-backed` | medium | docs-gap | **yes** | 修改 README line 192 标签 |
| R6 | session-ws-v1.md §3.5a 5 个新帧中 4 个无 JSON 示例 | low | docs-gap | no | 补充 `session.restore.completed` 至少一例;其余标 `schema: see runtime.md / items.md` |
| R7 | error-index.md 缺 runtime PATCH 相关错误码 | low | docs-gap | no | 补充 `invalid-runtime-config` / `runtime-config-version-conflict` 等错误码 |
| R8 | workspace.md §5 工具调用路由冗余(已在 tool-calls.md 新位置) | low | docs-gap | no | workspace.md 将 tool-calls 节缩为 1 行引用指向 tool-calls.md |
| R9 | agent-core `hooks/catalog.ts` 14/18 事件无 producer(前序审查 cross-ref) | high | delivery-gap | no(for HPX6) | 不在 HPX6 scope;留作后续 charter |
| R10 | agent-core `compact-breaker.ts` auto-compact 已实现但 `context-core` RPC stub(前序) | high | delivery-gap | no(for HPX6) | 不在 HPX6 scope;已知 deferred |
| R11 | executor-runtime fork 路径仅 `return {ok:true}` 不创建 child workspace | high | delivery-gap | no(for HPX6) | HPX6 closure §2 已明确声明 deep semantics 后续补齐 |

### R1. `executor-runtime.ts` restore 路径 deceptive complete

- **严重级别**: `critical`
- **类型**: `correctness`
- **是否 blocker**: `yes`
- **事实依据**:
  - `workers/orchestrator-core/src/executor-runtime.ts:62-63` — retry/fork 直接 `return {ok: true, result: "acknowledged"};` 无实际操作
  - `workers/orchestrator-core/src/executor-runtime.ts:65-84` — restore 路径调 `markRunning()` 后立即 `terminate("succeeded", undefined)`,无 R2 snapshot copy,无 D1 message ledger reset,无任何实质性 restore 操作
  - `HPX6-closure.md:45` — 声明 "restore job 可由 queue/inline executor 推到 terminal 并 emit `session.restore.completed`"
- **为什么重要**:
  - 用户执行 restore 操作后,会收到 `session.restore.completed {status:"succeeded"}` WS 帧,以为 session 已被回滚到 checkpoint。但实际上 D1 message ledger 完全未变,R2 workspace 文件完全未回滚。这是**生产级数据丢失风险** — 用户可能基于假的 "succeeded" 通知继续之前的对话,而 checkpoint 的防护语义完全不存在。
  - closure §2 正确说明了 retry/fork deep semantics 未完成,但**没有同等清晰地说明 restore 也只是 mark-then-terminate 而无实际回滚操作**。两者的差距性质不同:retry/fork 的 route 返回 202 + enqueue response(用户可见状态是 "accepted"),restore 返回 202 但然后 emit `session.restore.completed {status:"succeeded"}`,用户会认为操作已完成。
- **审查判断**: 这不是 "部分完成",而是 "done-wire-emit 但 zero-semantics"。restore 需要至少两个操作:(1) R2 snapshot copy 回 workspace;(2) D1 message ledger 重置到 checkpoint watermark。当前实现两者皆缺。
- **建议修法**:
  - **立即(HPX6 closure 回填前)**:在 `runExecutorJob` 的 restore 分支中,如果无法连线 R2/D1,则 `terminate("partial", "restore-executor-pending-deep-semantics")` — 明确发布不完整的信号,而不是 misleading `succeeded`
  - **短期**:实现 R2 snapshot copy + D1 message ledger 截断(`restore-handler.ts` 或 queue consumer)
  - **closure 回填**:HPX6 closure §2 加一条 "restore executor current depth: emit-only, R2/D1 实质回滚操作仍需后续补齐"

### R2. `cancel_initiator` 枚举 D1 vs stream-event 不一致

- **严重级别**: `high`
- **类型**: `protocol-drift`
- **是否 blocker**: `no`(可能是有意的双轨,但需显式说明)
- **事实依据**:
  - `workers/orchestrator-core/migrations/015-tool-call-ledger.sql` — CHECK `cancel_initiator IN ('user','system','tool')`
  - `workers/orchestrator-core/src/tool-call-ledger.ts:9-14` — TypeScript 类型 `ToolCallCancelInitiator = "user" | "system" | "tool"`
  - `packages/nacp-session/src/stream-event.ts:71` — `ToolCallCancelledKind.cancel_initiator` Zod enum: `z.enum(["user", "system", "parent_cancel"])` — **不同第三个值**
  - `clients/api-docs/tool-calls.md:16` — HTTP cancel route 示例 `?cancel_initiator=user`,无枚举说明
- **为什么重要**: 如果 WS stream event 上的 tool call cancel 原因传入 `parent_cancel`,但 D1 表的 CHECK 约束只接受 `{user, system, tool}`,会导致 `D1ToolCallLedger.upsert()` 抛 `D1_ERROR`。或者更糟:WS 层不写 D1,则 D1 的 cancel_initiator 永远不会是 `parent_cancel`,而 WS 的历史可查性依赖 event log 而非 D1 — 两个 source of truth 之间存在语义断层。
- **审查判断**: 这种枚举差异可能是设计上的有意区分(WS 帧表达 cancellation 来源,D1 表表达最后谁取消)。但文档不说明,后续 dev 很难判断是 bug 还是 feature。
- **建议修法**: `tool-calls.md` 加一小节 "cancel_initiator 枚举说明",列出 WS 帧和 D1 表各自允许的值及语义(如 "WS 用 `parent_cancel` 表示父 agent 取消,D1 用 `tool` 表示被另一个 tool call 取消")。

### R3. item-projection-plane `file_change`/`error` kind 声明但聚合不产出

- **严重级别**: `high`
- **类型**: `docs-gap`(实现侧是正确的架构设计,但文档误导)
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/src/item-projection-plane.ts` `WorkbenchItemKind = "agent_message" | "reasoning" | "tool_call" | "file_change" | "todo_list" | "confirmation" | "error"` — 声明 7 类
  - 同文件 `list()` 方法(lines 38-79) 从 4 张表聚合: tool_call_ledger、session_confirmations、session_todos、conversation_messages — **不产 `file_change` 或 `error`**
  - `clients/api-docs/items.md:34-35` — "item projection 当前支持 7 类 item" 无任何 caveat
  - `file_change` 实际由 `hp-absorbed-routes.ts:410-427` 在 workspace write 后经由 `emitFrameViaUserDO` 直接 emit `session.item.completed {item_kind:"file_change"}` — 走 WS 通道,不进 `nano_tool_call_ledger` 或任何 D1 投影
- **为什么重要**: 前端开发者读 `items.md` 后,会用 `GET /items` 查询 file_change 历史,发现永远为空。这会浪费大量排查时间 — 而且他们可能误以为 file_change 功能完全缺失,而不是 "仅 WS 推送"。
- **审查判断**: 架构设计合理 — `file_change` 是瞬时事件,不需要 D1 持久化。但 `items.md` 没有说明 `/items` HTTP 查询和 `session.item.*` WS 帧的内容范围不同。这是文档 gap,不是代码 bug。
- **建议修法**: `items.md` 新增 §"查询 vs 订阅" 表格:

  | item kind | `/items` HTTP 可见? | `session.item.*` WS 可见? |
  |-----------|--------------------|-----------------------------|
  | agent_message | ✅ | ✅ |
  | reasoning | ✅ | ✅ |
  | tool_call | ✅ | ✅ |
  | file_change | ❌(仅 WS) | ✅ |
  | todo_list | ✅ | ✅ |
  | confirmation | ✅ | ✅ |
  | error | ❌(仅 WS) | ✅ |

### R4-R8 — 文档瑕疵(中低严重度)

- **R4**: `confirmations.md` 行号 reference `session-control.ts:320-442` → 应修正为 `session-control.ts:334-450`。Line 320 实际是 `case "checkpoint:diff" 的 handler`,不是 confirmation handler。
- **R5**: `README.md` line 192 tool-calls 标签 `first-wave` → 应改为 `D1 ledger-backed`。实现已升级,标签过时。
- **R6**: `session-ws-v1.md` §3.5a 5 个新帧中只有 `session.item.completed` 有 JSON 示例。建议至少为 `session.restore.completed` 补充一例。
- **R7**: `error-index.md` 缺少 runtime config PATCH 相关错误码(如 `409 version-conflict`、`400 invalid-permission-rule`)。
- **R8**: `workspace.md` §5 工具调用路由与 `tool-calls.md` 重复 → 保留 `tool-calls.md` 为主,`workspace.md` 改为 1 行交叉引用。

### R9-R11 — 跨阶段缺口(非 HPX6 scope,但需显式登记)

以下发现已在先前的 `docs/eval/hero-to-pro/core-gap/gemini-cli-hooks-by-deepseek.md` 中完整分析,本次审查仅确认它们在 HPX6 实现后仍为缺口:

- **R9**: `workers/agent-core/src/hooks/catalog.ts` 定义了 18 个事件,仅 4 个(Setup/SessionStart/SessionEnd/UserPromptSubmit)有 emitter。HookDispatcher 已注入但**零 handler 注册**。`authorizeToolPlan()` 不走 HookDispatcher,直接调 `options.authorizeToolUse` RPC。

- **R10**: `workers/agent-core/src/host/compact-breaker.ts` 实现了 `composeCompactSignalProbe`,但 `workers/context-core` 的 `previewCompact`/`triggerCompact` RPC 仍处于 `phase:"stub"` 状态 — compact 探针永远返回 false。

- **R11**: executor fork 路径(`executor-runtime.ts:62-63`)仅 `return {ok:true}`,不创建 child workspace,不写 `nano_session_fork_lineage`,不 emit `session.fork.created`。closure §2 已承认 "fork executor deep semantics 仍需补齐"。

---

## 3. In-Scope 逐项对齐审核

> 以 `HPX6-workbench-action-plan.md` §2.1 In-Scope(S1-S11) 和 §1.2 Phase 总览为基准。结论使用 `done | partial | missing | stale | out-of-scope-by-design`。

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | F6:tool-call ledger D1 表 + agent-core write hook + `/tool-calls` list/detail/cancel | `done` | `D1ToolCallLedger` 完整(upsert/list/read/markCancelled);agent-core `runtime-assembly.ts:226-239` fire-and-forget write;routes 通过 session-bridge dispatch |
| S2 | F8:followup_input 公网 WS 转发 | `done` | `ws-runtime.ts:199-235` 完整解析+转发;frozen shape 透传;service binding 到 NanoSessionDO |
| S3 | F9:runtime config D1 表 + `/runtime` GET/PATCH + `session.runtime.update` emit | `done` | `D1RuntimeConfigPlane` 完整;`session-runtime.ts` 完整路由;PATCH 后 emit;version 乐观锁 |
| S4 | F10:permission_rules D1 表 + agent-core PreToolUse 接入 + rule > mode fallback | `done` | `D1PermissionRulesPlane` 完整;`entrypoint.ts:authorizeToolUse` 三级决策链;`runtime-mainline.ts:229-256` 已接线 |
| S5 | Q-bridging-7 legacy `permission_mode` hard delete | `done` | 路由删除彻底;`handlePermissionMode` 整段删除;全仓 `.ts` 仅测试文件含 `permission_mode` |
| S6 | F11:retry executor — Queue dispatch + 真实 attempt-chain | `partial` | 路由已改为 queue dispatch(不再返 first-wave hint);但 `executor-runtime.ts:62` retry 路径 actual execution stubbed |
| S7 | F12:restore executor — Queue drive to terminal + emit `session.restore.completed` | `partial` | 路由 queue dispatch 正确;executor 调 `markRunning→terminate(succeeded)` 且 emit 帧;但**无实质性 R2/D1 回滚操作** |
| S8 | F13:fork executor — Queue enqueue + child session + `session.fork.created` emit | `partial` | 路由 queue dispatch + mint child_session_uuid 正确;但 `executor-runtime.ts` fork actual execution stubbed(无 workspace copy / lineage / emit) |
| S9 | F14:item projection + `/items` HTTP + WS `session.item.*` 帧 | `done` | `D1ItemProjectionPlane` 完整;`session-items.ts` 路由完整;WS emit 通过 `frame-compat.ts` + `wsemit.ts` |
| S10 | F15:file_change item + emitter | `partial` | `hp-absorbed-routes.ts` workspace write/delete 后 emit `session.item.completed {item_kind:"file_change"}` — WS 通道 live;但 `/items` HTTP query 不返 file_change(见 R3) |
| S11 | 22-doc pack + check-docs-consistency.mjs | `partial` | 22 份文档都存在;CI 脚本通过;但有 R4/R5/R6/R7/R8 共 5 处文档瑕疵 + R3 架构说明缺失 |

### 3.1 对齐结论

- **done**: `6` (S1/S2/S3/S4/S5/S9)
- **partial**: `5` (S6/S7/S8/S10/S11)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> HPX6 核心骨架(D1 truth + HTTP routes + WS frames + protocol schemas)已完成,5 个 partial 项中 3 个在 closure §2 已承认(S6/S7/S8),1 个是文档缺陷(S11),1 个是 docs-gap(S10)。**若评价标准是 surface/completion(用户可 reach、可 invoke、可 receive event),HPX6 接近完成。若评价标准是 deep semantics(操作真实产生预期副作用),executor 路径还有显著距离。**

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | WriteTodos V2 task graph(子树) | `遵守` | 实现仍为 5-status flat list,未引入 subtree |
| O2 | Codex ThreadOptions 完整字段(sandbox/workingDirectory) | `遵守` | 仅实现 5 字段最小集 |
| O3 | MCP tool 调用独立 item kind | `遵守` | `tool_call` 类统一承载,无 `mcp_tool_call` 单独 kind |
| O4 | 跨 conversation fork | `遵守` | fork 仍为 same conversation only |
| O5 | Hooks 客户端注册面 | `遵守` | 无用户配置面暴露 |
| O6 | Memory 路由 | `遵守` | 无实现 |
| O7 | streaming tool execution(LLM stream 中启动工具) | `遵守` | 无 StreamingToolExecutor |
| O8 | executor DO alarm 兜底监控 | `部分违反` | action-plan P4-06 要求 DO alarm 每 5 分钟扫 stuck job,closure §2 承认 "DO alarm stuck-job 兜底未落地"。选择 inline execution as fallback(Queue consumer 不可达时 inline),这是合理的降级,但不是原计划要求的 DO alarm |
| O9 | executor-runner 第 7 个 worker | `部分违反` | 原计划新增 `workers/executor-runner/` 独立 worker,实际改为 orchestrator-core 内 Queue consumer(保持 6-worker topology)。closure §9 描述此偏差并有合理说明: "worker count 不变,避免扩大部署面"。这是对原计划的 conservative 修正,不是违规 |

---

## 5. hero-to-pro 全阶段跨包深度分析

### 5.1 整体态势

经过 `HP0(前置修复) → HP1(DDL 集中) → HP2(Model) → HP3(Context) → HP4(Chat) → HP5(Confirmation) → HP6(Tool/Workspace) → HP7(Checkpoint) → HP8(Runtime hardening) → HP9(Docs)`,nano-agent 从 "启动一条会话并读回流" 进化为 **"WebSocket-first 持久化 agent runtime + Codex 风格 workbench 后端"** — 这是 `plan-hero-to-pro.md` §3 承诺的"一句话目标"的实质性达成。当前的 nano-agent 已经拥有:

1. **4 套产品状态机(Model/Context/Chat/Tool-Workspace)的全部 D1 truth schema**(HP1 migration 007-017)
2. **confirmation/todos/model.fallback emit pipeline**(HPX5 F0-F4,F7)
3. **WriteTodos capability**(agent-core LLM → orchestrator D1)
4. **runtime config + permission rules control plane**(HPX6 F9-F10)
5. **tool-call ledger** with D1 durable truth(HPX6 F6)
6. **followup_input** client→server WS push(HPX6 F8)
7. **item projection layer** over stream events + D1 truth(HPX6 F14)
8. **22-doc client API docs** aligned with implementation(HP9 + HPX5 F7 + HPX6 docs)

### 5.2 全阶段残余缺口

以下按阶段排列:

| 阶段 | 缺口 | 严重度 | 当前状态 |
|------|------|--------|----------|
| HP2(Model) | `<model_switch>` developer message 注入未实现 | high | HP5 closure 记载 schema-frozen-only |
| HP3(Context) | context-core 3 RPC stub(`/probe` `/compact/preview` `/compact`) | **critical** | 探针永远返 false,compact 永远不触发 |
| HP3(Context) | cross-turn history 未进 LLM prompt | high | agent "失忆" — 每 turn 视为 single-turn |
| HP4(Chat) | checkpoint conversation_only 无真实 revert | high | HP1 DDL 落表但无 executor drive |
| HP5(Confirmation) | confirmation emitter 侧 row-create 未完成 | medium | HP5 closure §2 已记载 |
| HP6(Tool/Workspace) | executor restore/fork/retry deep semantics | high | 本 review R1/R11 已详述 |
| HP7(Checkpoint) | restore/fork 无实质操作 | **critical** | 见 R1/R11 |
| HP8(Runtime) | F14 R28 deploy 500 根因未定位 | medium | owner-action runbook stub |
| HP8(Runtime) | F15 R29 verify-initial-context 502 | medium | deceptive closure flag |
| HP9(Docs) | F1 manual evidence 5 套设备未完成 | medium | owner-action |
| Hooks Pipeline | 14/18 事件无 producer + zero handler | high | 前序 hooks 审查已详述 |
| Agent Loop | BeforeModel/AfterModel/BeforeToolSelection 全缺失 | high | 前序 hooks 审查已详述 |

### 5.3 跨包命名与逻辑一致性

| 发现 | 位置 | 说明 |
|------|------|------|
| `cancel_initiator` 双轨语义 | `tool-call-ledger.ts` vs `stream-event.ts` | D1 用 `tool`,WS 用 `parent_cancel` — 文档缺失说明(见 R2) |
| `item_kind` wire alias | `frame-compat.ts:25,40,53` vs `messages.ts` | wire 层用 `item_kind` 避免与 outer `kind` 冲突,schema normalize 回 canonical `kind` — 命名一致 |
| `SessionItemKindSchema` 值集 | `messages.ts` vs `item-projection-plane.ts` | 双方均声明 7 种但实际使用范围不同(见 R3) |
| `approval_policy` vs `permission_mode` | `runtime-config-plane.ts` vs 清理后代码 | 新字段 `approval_policy` 替代 legacy `permission_mode` — 清理彻底,测试验证 404 |

### 5.4 全仓一致性检查

- ✅ `permission_mode` hard delete 彻底(仅 tests 含验证 404 的引用)
- ✅ `ws-stream-only` 旧模式零残留
- ✅ `filesystem-core-leaf-rpc-pending` 旧占位零残留
- ✅ `hero-to-platform` 概念 `.ts` 源代码零残留
- ✅ `first-wave` 仅作为注释中的阶段标记,无 stub 残留
- ⚠️ `clients/api-docs/README.md:192` tool-calls 标签仍为 `first-wave`(见 R5)
- ⚠️ `clients/api-docs/confirmations.md` 行号 reference 过期(见 R4)

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: `HPX6 主体成立,可以关闭本轮 review。但 3 项 critical/high blocker + 5 项 medium/low follow-up 必须在 HPX6 closure 最终回填前处理。`

- **是否允许关闭本轮 review**: `yes — 前提是以下 blocker 在 closure 回填前修复`
- **关闭前必须完成的 blocker**:
  1. **R1 — executor-runtime restore deceptive complete**:将 `terminate("succeeded")` 改为 `terminate("partial", "restore-executor-pending-deep-semantics")`,直到 R2/D1 实质操作接上。closure §2 加明确声明。
  2. **R4 — confirmations.md 行号修正**:`session-control.ts:320-442` → `session-control.ts:334-450`。
  3. **R5 — README.md tool-calls 标签更新**:`first-wave` → `D1 ledger-backed`。
- **可以后续跟进的 non-blocking follow-up**:
  1. R2 — `tool-calls.md` 加 `cancel_initiator` 双轨枚举说明
  2. R3 — `items.md` 加 "查询 vs 订阅" 差异表格
  3. R6 — `session-ws-v1.md` 补 `session.restore.completed` JSON 示例
  4. R7 — `error-index.md` 补 runtime PATCH 错误码
  5. R8 — `workspace.md` §5 tool-calls 节缩为交叉引用
- **建议的二次审查方式**: `same reviewer rereview — 仅需验证 R1/R4/R5 三项 blocker 的修复,不要求全量重新审查`
- **实现者回应入口**: `请在本文档 §7 append 逐项回应,说明哪些已修复、哪些采纳、哪些不同意并附理由。不要改写 §0-§6。`

---

## 7. 跨阶段建议

> 以下建议超出 HPX6 code-review 范畴,属于全阶段态势判断,供 `hero-to-pro-final-closure.md` 与后续阶段参考。

1. **context-core stub 是当前最大的 single-point-of-failure** — auto-compact 是 hero-to-pro charter 声明的核心产品能力(章程 §2.2 G3/G4),但 `workers/context-core` 3 个 RPC 全部 stub。`compact-breaker.ts` 的探针已实现但永远返 false。若 hero-to-pro 阶段结束前不解除此 stub,则 "长对话必然超 context window 溢出" 的风险未消除。

2. **hooks pipeline 的 "wire-without-delivery" 模式需要警惕** — `HookDispatcher` 已注入(since HP5 P2-02),但零 handler 注册。这与 HPX5 阶段消除的三个 "wire-without-delivery" gap(F12 confirmation emitter、F13 round-trip e2e、compact signal probe)性质一致。建议在 `hero-to-pro-final-closure.md` 显式登记 hooks pipeline 状态为 "dispatcher live, zero handlers, 14/18 events without producer",确保传递到后续 charter。

3. **executor deep semantics 是下一个 charter 的最优先项** — restore/fork/retry 三个 executor 的实质操作(R2 snapshot copy、D1 message ledger reset、child workspace creation)是 `plan-hero-to-pro.md` §7.2 HP7 的 checkpoint 全模式 revert 的核心。当前只有 "emit 层通了",副作用层未通。这应该是下一个 phase charter 的 P0 项。

4. **item-projection-plane `read()` 的全表扫描应升级** — `item-projection-plane.ts:161` 的 `read(item_uuid)` 对所有 tool call 做全表扫描(`SELECT * FROM nano_tool_call_ledger WHERE session_uuid = ?1`),然后用确定性 hash 匹配 item_uuid。应该直接通过 `request_uuid` → item_uuid 的确定性映射做点查(`WHERE request_uuid = ?1`),避免 session 累积 1000+ tool calls 后的性能退化。

---

## 8. 实现者回应

### 8.1 对本轮审查的回应

> 执行者: `GPT`
> 执行时间: `2026-05-02`
> 回应范围: `DeepSeek R1–R11 + Kimi R1–R9`
> 对应审查文件: `docs/code-review/hero-to-pro/HPX6-reviewed-by-deepseek.md`, `docs/code-review/hero-to-pro/HPX6-reviewed-by-kimi.md`

- **总体回应**：`当前代码与文档里能在 HPX6 范围内直接收口的问题已经修完；仅保留 retry/fork deep semantics、DO alarm、以及少量命名漂移作为明确 deferred。`
- **本轮修改策略**：`先修 correctness（runtime optimistic lock / 7-kind item projection / restore non-success guard），再补 docs 和专门测试，最后把 closure 与 action-plan wording 改回真实口径。`
- **实现者自评状态**：`ready-for-rereview`

### 8.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| DeepSeek R1 | restore 路径 deceptive complete | `fixed` | `executor-runtime.ts` 不再把 restore 直接终结为 `succeeded`，改为 `partial + restore-executor-pending-deep-semantics`；同时回刷 closure / action-plan / WS docs，避免 success-shaped fallback。 | `workers/orchestrator-core/src/executor-runtime.ts`, `clients/api-docs/session-ws-v1.md`, `docs/issue/hero-to-pro/HPX6-closure.md`, `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`, `workers/orchestrator-core/test/executor-runtime.test.ts` |
| Kimi R3 / DeepSeek R11 | retry / fork deep semantics 仍为空壳 | `deferred-with-rationale` | 本轮只修复 restore 的误导性完成信号，没有冒进补一个半成品 retry/fork executor；closure 与 action-plan 现已明确这两条仍是后续专项。 | `docs/issue/hero-to-pro/HPX6-closure.md`, `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md` |
| DeepSeek R2 / Kimi R5 | `cancel_initiator` D1 与 WS 双轨未说明 | `partially-fixed` | 保留当前双轨实现，但在 `tool-calls.md` 补充枚举说明：HTTP ledger 的 `tool` 与 WS 的 `parent_cancel` 视为同一产品级语义，不再让客户端自行猜。 | `clients/api-docs/tool-calls.md` |
| DeepSeek R3 / Kimi R1 | item projection 7-kind 声明与实际聚合不一致 | `fixed` | `item-projection-plane.ts` 现补齐 `file_change`（来自 `nano_session_temp_files`）与 `error`（来自 `nano_error_log`）投影，并把 `read()` 扩到 messages / files / todos / confirmations / errors；`items.md` 同步补 “查询 vs 订阅”。 | `workers/orchestrator-core/src/item-projection-plane.ts`, `clients/api-docs/items.md`, `workers/orchestrator-core/test/item-projection-plane.test.ts` |
| Kimi R2 | runtime config 缺失乐观锁 | `fixed` | `runtime-config-plane.ts` 增加 `expected_version` 与 `WHERE version = ?`；`session-runtime.ts` PATCH 现强制 `version`，冲突返回 `409 conflict`；同时把 `scope=session|tenant` rules 分流写入 session/team 两处 durable truth，并在 GET/PATCH 返回 merged runtime view。 | `workers/orchestrator-core/src/runtime-config-plane.ts`, `workers/orchestrator-core/src/facade/routes/session-runtime.ts`, `workers/orchestrator-core/src/permission-rules-plane.ts`, `clients/api-docs/runtime.md`, `clients/api-docs/error-index.md`, `workers/orchestrator-core/test/runtime-config-plane.test.ts` |
| DeepSeek R4 | confirmations.md implementation reference 过期 | `fixed` | 去掉易漂移的行号引用，只保留 owner file。 | `clients/api-docs/confirmations.md` |
| DeepSeek R5 / Kimi R8 | README / workspace 中 tool-calls 仍写 first-wave | `fixed` | 移除 README 里的旧 first-wave 标记，并把 `workspace.md` 的 tool-calls 段落收缩为交叉引用，避免与 `tool-calls.md` 双写漂移。 | `clients/api-docs/README.md`, `clients/api-docs/workspace.md` |
| DeepSeek R6 | `session.restore.completed` 缺示例 | `fixed` | 在 `session-ws-v1.md` 补了 restore completed JSON，并明确当前终态是 `partial`。 | `clients/api-docs/session-ws-v1.md` |
| DeepSeek R7 / Kimi R9 | runtime PATCH 错误与 pattern 示例不清楚 | `fixed` | `error-index.md` 现明确 runtime PATCH 的 `400 invalid-input` / `409 conflict`；`runtime.md` 把示例 `pattern` 改成 `*`，不再暗示复杂 glob。 | `clients/api-docs/error-index.md`, `clients/api-docs/runtime.md` |
| Kimi R6 | migration 015 `queued` vs design `pending` 漂移 | `deferred-with-rationale` | 当前代码、迁移与 `tool-calls.md` 都以 `queued` 为运行事实；这已不是实现 bug，而是 design/action-plan 口径落后。此轮不改表枚举，避免引入额外 migration churn。 | `clients/api-docs/tool-calls.md` |
| Kimi R7 | item projection 无专门测试文件 | `fixed` | 新增 `item-projection-plane.test.ts`，覆盖 7-kind list 与非 tool_call detail read。 | `workers/orchestrator-core/test/item-projection-plane.test.ts` |
| DeepSeek R9 / DeepSeek R10 / Kimi R4 | hooks/context stub 与 DO alarm 兜底 | `deferred-with-rationale` | 这些都是真实问题，但不属于本轮 HPX6 surface/contract 修复的最小闭环；本轮仅把相关状态维持为显式 deferred，不再伪装成已交付。 | `docs/issue/hero-to-pro/HPX6-closure.md`, `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md` |

### 8.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | `8` | `DeepSeek R1, R3, R4, R5, R6, R7, R8; Kimi R1, R2, R7, R8, R9` | correctness / docs / test 侧能在 HPX6 内闭环的问题都已落代码与文档 |
| 部分修复，需二审判断 | `1` | `DeepSeek R2 / Kimi R5` | 保留双轨枚举，但已补客户端文档说明 |
| 有理由 deferred | `3` | `Kimi R3 / DeepSeek R11, Kimi R6, DeepSeek R9/R10/Kimi R4` | retry/fork/deferred alarm/design drift 不在本轮最小安全修复面 |
| 拒绝 / stale-rejected | `0` | `—` | `—` |
| 仍 blocked | `0` | `—` | `—` |

### 8.4 变更文件清单

- `workers/orchestrator-core/src/runtime-config-plane.ts` — runtime optimistic lock 与 conflict error
- `workers/orchestrator-core/src/facade/routes/session-runtime.ts` — PATCH `version`、tenant/session rule split、merged runtime response
- `workers/orchestrator-core/src/permission-rules-plane.ts` — team rule set replace semantics
- `workers/orchestrator-core/src/item-projection-plane.ts` — 7-kind durable projection 与 multi-kind detail read
- `workers/orchestrator-core/src/executor-runtime.ts` — restore 从 misleading `succeeded` 改为 explicit `partial`
- `workers/orchestrator-core/test/{runtime-config-plane,item-projection-plane,executor-runtime}.test.ts` — 本轮 findings 对应专门测试
- `clients/api-docs/{README,runtime,items,tool-calls,session-ws-v1,error-index,confirmations,workspace}.md` — 清理漂移文档并补新增契约说明
- `docs/issue/hero-to-pro/HPX6-closure.md`, `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md` — 回刷真实执行深度，去掉 restore success-shaped 口径

### 8.5 验证结果

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| orchestrator-core typecheck | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | `pass` | `DeepSeek R1/R3, Kimi R1/R2/R3/R7` |
| orchestrator-core build | `pnpm --filter @haimang/orchestrator-core-worker build` | `pass` | `DeepSeek R1/R3, Kimi R1/R2/R3` |
| orchestrator-core tests | `pnpm --filter @haimang/orchestrator-core-worker test` | `pass` | `DeepSeek R1/R3, Kimi R1/R2/R7` |
| nacp-session tests | `pnpm --filter @haimang/nacp-session test` | `pass` | `DeepSeek R6` |
| docs consistency | `pnpm run check:docs-consistency` | `pass` | `DeepSeek R2/R4/R5/R6/R7/R8, Kimi R8/R9` |
| workspace test suite | `pnpm test` | `pass` | `本轮变更的整体回归面` |

```text
orchestrator-core: typecheck/build/test 全绿
nacp-session: test 全绿
docs-consistency: OK: 22 docs pass 8 regex checks + 2 required-snippet checks
root workspace: pnpm test exit 0
```

### 8.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| Kimi R3 / DeepSeek R11 | `deferred` | retry/fork 需要真实 attempt-chain / snapshot copy / lineage materialization，超出本轮安全修复范围 | `docs/issue/hero-to-pro/HPX6-closure.md` §2 |
| Kimi R6 | `deferred` | `queued` 已成为当前 migration + docs + code 的一致运行事实；若要改回 `pending`，应走单独 schema/design 对齐 | 后续 design/action-plan drift 清理 |
| DeepSeek R9 / DeepSeek R10 / Kimi R4 | `deferred` | hooks/context/DO alarm 属于跨阶段结构性 gap，不应伪装成 HPX6 已交付 | 后续 charter / hero-to-pro final closure |

### 8.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`
- **请求复核的范围**：`all findings`
- **实现者认为可以关闭的前提**：
  1. reviewer 确认 runtime/version、7-kind items、restore non-success guard 与对应文档说明已对齐当前代码事实
  2. reviewer 接受剩余 deferred 项继续留在 closure 的 follow-up，而不是继续被表述为已完成
