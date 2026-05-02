# Nano-Agent 代码审查报告

> 审查对象: `HPX6 — workbench-grade controls + new truth + Codex-style object layer`
> 审查类型: `mixed (code-review + docs-review + closure-review)`
> 审查时间: `2026-05-02`
> 审查人: `kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md` (含 §9 执行日志)
> - `docs/issue/hero-to-pro/HPX6-closure.md`
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1
> - `docs/charter/plan-hero-to-pro.md`
> - `workers/orchestrator-core/src/{tool-call-ledger,runtime-config-plane,permission-rules-plane,item-projection-plane,executor-runtime,wsemit,frame-compat}.ts`
> - `workers/orchestrator-core/src/facade/routes/{session-runtime,session-items,session-bridge}.ts`
> - `workers/orchestrator-core/src/user-do/ws-runtime.ts`
> - `workers/orchestrator-core/src/hp-absorbed-routes.ts`
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `packages/nacp-session/src/messages.ts`
> - `clients/api-docs/{runtime,items,tool-calls,permissions,README}.md`
> 对照真相:
> - `docs/action-plan/hero-to-pro/HPX6-workbench-action-plan.md`
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: `HPX6 核心骨架与表面已落地，但存在 5 项实质性缺口、3 项命名/契约漂移、2 项文档不一致，当前状态应为 executed-with-followups，不应标记为 completed。`
- **结论等级**: `approve-with-followups`
- **是否允许关闭本轮 review**: `no`
- **本轮最关键的 1-3 个判断**:
  1. **item-projection-plane 存在功能残缺**：7 类 item 中 error 无投影实现，read() 仅支持 tool_call；这与 design 附录 C 的 source map 承诺不符。
  2. **runtime-config-plane 缺失乐观锁**：patch 未按 action-plan 要求实现 `WHERE version=?` 乐观锁，并发 PATCH 存在 race 风险。
  3. **executor deep semantics 未完成**：retry/fork handler 为空壳；restore handler 未执行真正的 R2 snapshot 复制与 D1 message ledger 重置；DO alarm 兜底未落地 — 与 closure 自述一致，但 action-plan 收口标准未达成。

---

## 1. 审查方法与已核实事实

### 1.1 已确认的正面事实

- **nacp-session 1.5.0 schema 已冻结**：`messages.ts` 新增 `SessionRuntimeUpdateBodySchema / SessionRestoreCompletedBodySchema / SessionItem{Started,Updated,Completed}BodySchema` 共 5 个 schema；`type-direction-matrix.ts` 注册为 server-only `event`；`session-registry.ts` 加入 server-side / event delivery 集合；`SESSION_BODY_SCHEMAS` map 注册完成。测试：`packages/nacp-session/test/hpx6-workbench-messages.test.ts` 9 case 全绿。
- **D1 migration 015-017 已落地**：`015-tool-call-ledger.sql`、`016-session-runtime-config.sql`、`017-team-permission-rules.sql` 均存在，字段与索引基本符合 action-plan 要求。
- **tool-call ledger plane 已实现**：`D1ToolCallLedger.upsert/list/read/markCancelled` API 完整；agent-core `runtime-assembly.ts:219-239` 通过 `ORCHESTRATOR_CORE.recordToolCall` RPC fire-and-forget 写入 D1。
- **public WS followup_input 链路已通**：`ws-runtime.ts:177-234` 解析 inbound JSON → 检查 `kind === "session.followup_input"` → 经 `forwardFollowupInput` 转发到 agent-core。
- **runtime config 路由 live**：`session-runtime.ts` 实现 `GET/PATCH /sessions/{id}/runtime`；PATCH 后调用 `emitFrameViaUserDO` 发射 `session.runtime.update`。
- **permission rules 决策 seam 已接入**：`entrypoint.ts:authorizeToolUse` 实现 session rule → tenant rule → approval_policy fallback 三级决策；`runtime-mainline.ts:236` 在 tool execution 前调用 `authorizeToolUse`。
- **legacy permission_mode hard delete 已执行**：`session-bridge.ts` 中 `"policy/permission_mode"` 已从 `SessionAction` 枚举移除；`test/policy-permission-mode-route.test.ts` 5 case 全绿验证 404。
- **Queue binding 已配置**：`wrangler.jsonc` 中 `NANO_EXECUTOR_QUEUE` producer/consumer 已声明。
- **file_change item emit 已落地**：`hp-absorbed-routes.ts:410-427` 在 workspace write 后 emit `session.item.completed` 含 `file_change` payload；`:447-463` 在 delete 后同样 emit。
- **22-doc pack 索引同步**：`clients/api-docs/README.md` 已扩展为 22 份；`check:docs-consistency` 通过。
- **测试全绿**：`pnpm --filter @haimang/nacp-session test` 217 pass；`pnpm --filter @haimang/orchestrator-core-worker test` 336 pass；`pnpm --filter @haimang/agent-core-worker test` 1072 pass；`pnpm run check:docs-consistency` OK；`pnpm test:cross-e2e` exit 0（live cases skipped）。

### 1.2 已确认的负面事实

- **item-projection-plane.ts 功能残缺**：`list()` 仅投影 messages、tool_calls、todos、confirmations 四类；`read()` 仅遍历 tool_call 表。7 类 item 中 `error` 有类型声明但无任何投影逻辑；`reasoning` 被合并到 messages 中但无区分逻辑（所有非 assistant message 都标为 reasoning 可能不准确）。
- **runtime-config-plane.ts 无乐观锁**：`patch()` 直接执行 `UPDATE ... WHERE session_uuid = ?`，未按 action-plan P3-01 要求实现 `WHERE version = ?` 乐观锁；并发 PATCH 会丢失更新。
- **executor-runtime.ts retry/fork 为空壳**：`runExecutorJob` 对 `kind !== "restore"` 直接返回 `{ok: true}`，没有真正创建 attempt-chain、复制 workspace snapshot、写 fork lineage。
- **executor-runtime.ts restore 未执行真实 restore 逻辑**：restore handler 仅调用 `markRunning` 和 `terminate(succeeded)`，未按 action-plan 执行 R2 snapshot 复制、D1 message ledger 重置等真实 restore 步骤。
- **DO alarm 兜底未落地**：action-plan P4-06 要求 agent-core DO 每 5 分钟扫 stuck job 并重投 Queue，但 `runtime-assembly.ts` 中无 alarm 设置逻辑。
- **migration 015 中 cancel_initiator 枚举漂移**：action-plan 设计为 `('user','system','parent_cancel')`，实际 migration 为 `('user','system','tool')`；TypeScript 类型 `ToolCallCancelInitiator` 为 `"user" | "system" | "tool"`。`parent_cancel` 与 `tool` 语义不同。
- **migration 015 中 status 枚举漂移**：action-plan 设计为 `('pending','running','succeeded','failed','cancelled')`，实际 migration 为 `('queued','running','succeeded','failed','cancelled')`。`queued` 与 `pending` 状态语义不同，可能导致合约不一致。
- **item projection 无专门测试文件**：action-plan P5-01 要求 `test/item-projection-plane.test.ts` ≥ 14 case，但仓库中不存在该文件。
- **workspace.md 文档未更新**：README.md 中 `/sessions/{id}/tool-calls` 仍标注 "first-wave tool-call list"，但实际已改为 D1 ledger；`/sessions/{id}/tool-calls/{request_uuid}/cancel` 仍标注 "first-wave cancel ack"。
- **runtime.md 文档中 pattern 示例可能误导**：文档示例 `"pattern": "*git status*"` 暗示 glob 支持复杂匹配，但 `entrypoint.ts:115-118` 的 `globLikeMatches` 实现仅支持 `*` 全匹配和字面量，`*git status*` 不会按预期匹配 `git status`（因为中间有空格，且正则构建方式可能不匹配）。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行阅读了 15+ 个核心文件，交叉核对 action-plan / design doc 要求 |
| 本地命令 / 测试 | yes | 运行了 nacp-session / orchestrator-core / agent-core / docs-consistency / cross-e2e 测试 |
| schema / contract 反向校验 | yes | 核对了 migration DDL、TypeScript 类型、zod schema、文档描述三者一致性 |
| live / deploy / preview 证据 | no | 未执行 preview deploy，仅本地测试 |
| 与上游 design / QNA 对账 | yes | 对照 HPX5-HPX6-bridging-api-gap.md v0.2.1、HPX6 action-plan、plan-hero-to-pro.md charter |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | item-projection-plane 功能残缺：error 无投影、read() 仅支持 tool_call | high | correctness | yes | 补全 7 类 item 投影逻辑；重写 read() 为按 item_uuid prefix 路由到对应 source 表 |
| R2 | runtime-config-plane 缺失乐观锁 | high | correctness | yes | patch() 添加 `WHERE version = ?` 条件，冲突返 409 |
| R3 | executor-runtime retry/fork 为空壳、restore 未执行真实逻辑 | high | delivery-gap | yes | 补全 retry handler（attempt-chain 创建）、restore handler（R2 复制 + D1 重置）、fork handler（child session + snapshot） |
| R4 | DO alarm 兜底监控未落地 | medium | delivery-gap | no | 在 agent-core DO 初始化时设置 alarm，每 5 分钟扫 stuck running job |
| R5 | migration 015 枚举漂移：cancel_initiator='tool' vs 设计 'parent_cancel' | medium | protocol-drift | no | 统一为设计文档中的枚举；若 'tool' 是刻意新增，需在 design doc 中补 rationale |
| R6 | migration 015 枚举漂移：status='queued' vs 设计 'pending' | medium | protocol-drift | no | 统一为 'pending'；或在文档中明确 'queued' 的语义边界 |
| R7 | item projection 无专门测试文件 | medium | test-gap | no | 新增 `test/item-projection-plane.test.ts` ≥ 14 case |
| R8 | workspace.md 文档未更新 tool-calls 描述 | low | docs-gap | no | 更新 README.md workspace 节中 tool-calls 描述为 "D1 ledger-backed" |
| R9 | runtime.md pattern 示例可能误导 | low | docs-gap | no | 将示例改为 `"pattern": "*"` 或 `"pattern": "bash"`，避免暗示不支持的空格 glob |

### R1. item-projection-plane 功能残缺

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/src/item-projection-plane.ts:4-11` 声明了 7 类 item kind（含 error）
  - `:66-153` 的 `list()` 仅查询 messages、tool_calls、todos、confirmations 四类；无任何 error 投影逻辑
  - `:155-183` 的 `read()` 仅遍历 `nano_tool_call_ledger` 全表，无法读取 agent_message/todo_list/confirmation 等其他 kind
  - `clients/api-docs/items.md:17-28` 明确承诺 7 类 item 均可查询
- **为什么重要**：前端 reducer 依赖 7 类 item 完整投影来构建 workbench UI；error item 缺失导致异常状态不可见；read() 仅支持 tool_call 导致 `/items/{item_uuid}` 对非 tool_call 永远 404。
- **审查判断**：这是 action-plan P5-01 的未完成项，直接影响 F14 收口标准。
- **建议修法**：
  1. `list()` 中补全 error 投影（可从 `nano_error_log` 或 stream event 投影）
  2. `read()` 改为按 `item_uuid` prefix 路由到对应 source 表查询（msg: → messages, tool: → tool_call_ledger, confirmation: → confirmations 等）
  3. 为 messages 的 reasoning 区分增加启发式逻辑（如检查 message_kind 或 body 内容）

### R2. runtime-config-plane 缺失乐观锁

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/src/runtime-config-plane.ts:99-118` 的 `patch()` 执行 `UPDATE ... WHERE session_uuid = ?1`，无任何 version 条件
  - action-plan P3-01 明确要求：`patch(session_uuid, partial, version)` 乐观锁 `WHERE version=?`
  - `session-runtime.ts` 的 PATCH 路由未在 body 中要求或传递 version 字段
- **为什么重要**：并发 PATCH（如两个客户端同时修改 runtime config）会导致更新丢失；这是典型的 lost-update 问题。
- **审查判断**：action-plan 的收口标准明确要求 "PATCH 乐观锁冲突返 409 conflict"，当前实现不满足。
- **建议修法**：
  1. `patch()` 增加 `version` 参数，UPDATE 语句改为 `WHERE session_uuid = ?1 AND version = ?7`
  2. 若 changes = 0，检查是否 version 冲突，返回 409
  3. `session-runtime.ts` 的 PATCH body parser 接受可选 `version` 字段并传入

### R3. executor-runtime retry/fork 为空壳、restore 未执行真实逻辑

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/src/executor-runtime.ts:62-63` 对 `kind !== "restore"` 直接返回 `{ok: true}`
  - `:65-95` restore handler 仅调用 `markRunning` 和 `terminate(succeeded)`，无 R2 复制、无 D1 message ledger 重置
  - action-plan P4-03/P4-04/P4-05 明确要求 retry handler 创建 attempt-chain、restore handler 复制 snapshot + 重置 ledger、fork handler 创建 child session + snapshot copy
- **为什么重要**：HPX6 的核心价值之一是把 "first-wave ack" 推到 "真实执行"；空壳 executor 意味着 retry/fork/restore 仍是装饰按钮。
- **审查判断**：与 HPX6-closure.md §2 自述一致（"retry executor deep semantics 尚未完成"、"fork executor deep semantics 尚未完成"），但 closure 状态不应是 completed。
- **建议修法**：
  1. retry handler：取最近 user turn → 复制 prompt → POST /messages 或调 NanoSessionDO startTurn → 写 `requested_attempt_seed` + `turn_attempt = old + 1`
  2. restore handler：按 mode 复制 R2 snapshot → 重置 D1 message ledger 到 watermark → `terminate()` 带真实状态
  3. fork handler：写 `nano_session_fork_lineage` → 复制 workspace → 创建 child session DO → emit `session.fork.created`

### R4. DO alarm 兜底监控未落地

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P4-06 要求 `runtime-assembly.ts` 在 DO 初始化时 set alarm（每 5 分钟）
  - 搜索 `alarm` / `setAlarm` / `alarm()` 在 `runtime-assembly.ts` 中无结果
  - HPX6-closure.md §2 第 3 点也承认 "DO alarm stuck-job 兜底未落地"
- **为什么重要**：Queue consumer 可能因 worker 崩溃而卡住；DO alarm 是 5 分钟兜底的最后防线。
- **审查判断**：当前选择 Queue consumer + inline fallback 作为替代，但 action-plan 明确要求 DO alarm 作为第二道防线。
- **建议修法**：在 agent-core DO `fetch()` handler 或初始化逻辑中设置 `state.storage.setAlarm(Date.now() + 5 * 60 * 1000)`，alarm 触发时扫 `nano_checkpoint_restore_jobs WHERE status='running' AND started_at < now()-5min` 并重投 Queue。

### R5. migration 015 cancel_initiator 枚举漂移

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P2-04 / §4.2 设计：`cancel_initiator TEXT CHECK(cancel_initiator IN ('user','system','parent_cancel'))`
  - 实际 migration 015：`cancel_initiator TEXT CHECK(cancel_initiator IS NULL OR cancel_initiator IN ('user', 'system', 'tool'))`
  - TypeScript 类型：`export type ToolCallCancelInitiator = "user" | "system" | "tool";`
- **为什么重要**：`parent_cancel` 与 `tool` 语义不同。parent_cancel 表示父 turn 取消导致子 tool call 被取消；tool 表示 tool 自身取消。若设计意图是 parent_cancel，则当前实现偏离合约。
- **审查判断**：需要确认是设计变更还是实现漂移。若为刻意变更，需在 design doc / action-plan 中补充 rationale。
- **建议修法**：统一枚举为设计文档中的 `'user','system','parent_cancel'`；或更新 design doc 说明 `'tool'` 的新语义。

### R6. migration 015 status 枚举漂移

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P1-01 / §4.2 设计：`status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','cancelled'))`
  - 实际 migration 015：`status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'))`
- **为什么重要**：`queued` 与 `pending` 是不同语义。`queued` 通常表示在 Queue 中等待执行；`pending` 表示等待用户确认或等待前置条件。文档和 API 消费者可能混淆。
- **审查判断**：API 文档 `tool-calls.md` 中 status enum 写的是 `queued | running | succeeded | failed | cancelled`，与 migration 一致，但与 action-plan 设计不同。
- **建议修法**：若 `queued` 是刻意引入的新状态（对应 tool call 刚创建但尚未开始执行），更新 action-plan 和 design doc；否则统一为 `pending`。

### R7. item projection 无专门测试文件

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P5-01 明确要求 `workers/orchestrator-core/test/item-projection-plane.test.ts` ≥ 14 case
  - 仓库中不存在该文件
- **为什么重要**：item projection 跨 7 张表查询，逻辑复杂，无测试覆盖意味着 regression 风险高。
- **建议修法**：新增测试文件，覆盖 7 类 item 的 happy path + edge case（cursor pagination、空 session、跨表排序、item_uuid 稳定性）。

### R8. workspace.md 文档未更新 tool-calls 描述

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/README.md:191-192` 中 `/sessions/{id}/tool-calls` 仍标注 "first-wave tool-call list"；`/sessions/{id}/tool-calls/{request_uuid}/cancel` 仍标注 "first-wave cancel ack"
  - 实际已实现 D1 ledger-backed
- **建议修法**：更新描述为 "D1 ledger-backed tool call list" 和 "mark tool call cancelled in D1 ledger"。

### R9. runtime.md pattern 示例可能误导

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/runtime.md:27-28` 示例 `"pattern": "*git status*"`
  - `entrypoint.ts:115-118` 的 `globLikeMatches` 实现：`pattern.replace(/\*/g, ".*")` 构建正则，然后 `^${escaped}$` 匹配
  - `"*git status*"` 经转义后正则为 `^.*git status.*$`，确实能匹配 `git status`，但文档未说明只支持 `*` 和字面量
- **建议修法**：将示例改为 `"pattern": "*"` 或 `"pattern": "bash"`，避免暗示支持复杂 glob 模式；或在文档中明确 "第一版 glob 只支持 `*` 全匹配和字面量"。

---

## 3. In-Scope 逐项对齐审核

基于 action-plan 的 9 项功能（F6/F8/F9/F10/F11/F12/F13/F14/F15）和 5 个 Phase（P1-P5）:

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | F6 tool-call ledger D1 表 + agent-core fire-and-forget 写 + /tool-calls 真实读 | done | migration 015、tool-call-ledger.ts、agent-core hook、hp-absorbed-routes 均实现 |
| S2 | F8 public WS followup_input 解析 + 转发 | done | ws-runtime.ts:177-234 实现完整 frozen shape 透传 |
| S3 | F9 runtime config GET/PATCH + session.runtime.update emit | partial | PATCH 缺乐观锁（R2）；其余完成 |
| S4 | F10 permission rules + PreToolUse 决策 seam | done | authorizeToolUse 实现三级决策；legacy hard delete 完成 |
| S5 | F11 retry executor 真实 attempt-chain | missing | executor-runtime.ts 为空壳（R3） |
| S6 | F12 restore executor 真实驱动到 terminal | partial | Queue consumer 框架存在，restore handler 未执行真实逻辑（R3） |
| S7 | F13 fork executor child session + snapshot | missing | executor-runtime.ts 为空壳（R3） |
| S8 | F14 item projection 7 类 item + /items 路由 | partial | 框架完成，但 error 无投影、read() 仅支持 tool_call（R1） |
| S9 | F15 file_change item + emitter | done | hp-absorbed-routes.ts:410-427,447-463 在 write/delete 后 emit |
| S10 | P1-04 nacp-session 1.5.0 扩 4 类新顶层帧 schema | done | 5 个 schema 已注册，测试通过 |
| S11 | P3-04 Q-bridging-7 hard delete legacy permission_mode | done | 路由已删，KV 写入已移除，测试验证 404 |
| S12 | P4-01 wrangler Queue binding | done | producer/consumer 已配置 |
| S13 | P4-02 executor-runner worker 骨架 | partial | 实际在 orchestrator-core 内实现 Queue consumer，非独立 worker；closure 已说明偏差 |
| S14 | P4-06 DO alarm 兜底监控 | missing | 未实现（R4） |
| S15 | P5-05 docs 22-doc pack | done | runtime/items/tool-calls/permissions 文档已落地，索引同步 |

### 3.1 对齐结论

- **done**: `9`
- **partial**: `4`
- **missing**: `3`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这更像"**核心骨架与表面已落地，但 transport/enforcement/deep semantics 仍未收口**"，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 跨 conversation fork | 遵守 | Q23 frozen；fork handler 虽为空壳但 producer 端无跨 conversation 支持 |
| O2 | 跨 turn fallback chain | 遵守 | Q8 frozen single-step |
| O3 | WriteTodos V2 task graph | 遵守 | Q20 frozen 5-status flat list |
| O4 | MCP tool 调用作为独立 item kind | 遵守 | design O3 明确 out-of-scope |
| O5 | Sub-agent / sub-task 树 | 遵守 | README §4.2 trade-off |
| O6 | Hooks 客户端注册面 | 遵守 | README §4.1 ③ trade-off |
| O7 | Memory 路由 | 遵守 | 不在 hero-to-pro vision |
| O8 | streaming tool execution | 遵守 | action-plan O8 明确不做 |
| O9 | runtime config turn-scoped override | 遵守 | Q-bridging-4 frozen session-scoped |
| O10 | Codex web_search / mcp_tool_call / patch_diff 扩展 item kind | 遵守 | design §3.2 接口保留点 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: `HPX6 已实现 workbench surfaces + durable truth + Queue substrate，但 executor deep semantics、item projection 完整性、runtime config 乐观锁 3 项关键 blocker 未解决，当前状态为 executed-with-followups，不得标记为 completed。`
- **是否允许关闭本轮 review**: `no`
- **关闭前必须完成的 blocker**:
  1. **R1 — 补全 item projection**：error item 投影实现 + read() 多 kind 支持
  2. **R2 — runtime config 乐观锁**：patch() 添加 `WHERE version = ?` + 冲突返 409
  3. **R3 — executor deep semantics**：retry handler 真实 attempt-chain、restore handler 真实 R2 复制 + D1 重置、fork handler 真实 child session + snapshot
- **可以后续跟进的 non-blocking follow-up**:
  1. **R4 — DO alarm 兜底**：在 agent-core DO 内增加 5 分钟 alarm sweep
  2. **R5/R6 — 枚举漂移统一**：cancel_initiator 和 status 枚举与设计文档对齐
  3. **R7 — item projection 测试**：新增 ≥ 14 case 的测试文件
  4. **R8/R9 — 文档修正**：tool-calls 描述更新、pattern 示例修正
- **建议的二次审查方式**: `independent reviewer`（建议由 Deepseek 或 GPT 复核 executor 语义实现）
- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 跨阶段跨包深度分析

### 6.1 跨 hero-to-pro 全阶段回顾

HPX6 作为 hero-to-pro 的最终收口，其完成度直接影响整个阶段的封板。从 charter 的 4 套状态机视角审视：

| 状态机 | HPX6 贡献 | 完整度 |
|--------|-----------|--------|
| Model | F9 runtime config 中的 model_id 透传已在 HP0 完成；HPX6 无新增 | ✅ 完整 |
| Context | F3 auto-compact 已在 HPX5 接通；HPX6 无新增 | ✅ 完整 |
| Chat | F11/F12/F13 retry/restore/fork executor 是 Chat 生命周期的高级控制；当前为部分完成 | ⚠️ 部分 |
| Tool-Workspace | F6 tool-call ledger + F14 item projection + F15 file_change 是 Tool-Workspace 状态机的 durable 层；item projection 有残缺 | ⚠️ 部分 |

### 6.2 跨包命名规范与执行逻辑错误

**命名规范问题**：
1. `item_kind` vs `kind` 的 wire alias 策略在 `wsemit.ts:44-48` 和 `frame-compat.ts:56-61` 中实现，但文档 `items.md:48` 说 "Wire frames use `item_kind` because the outer lightweight frame already owns `kind`. Canonical schema field name remains `kind`." 这是合理的 compat 策略，但 `clients/api-docs/session-ws-v1.md` 中是否有相同说明？经核查，`session-ws-v1.md` 未提及 `item_kind` 字段，存在文档缺口。

**执行逻辑错误**：
1. `item-projection-plane.ts:147` 的排序使用 `localeCompare` 对 ISO 8601 时间戳排序。ISO 8601 时间戳的字符串字典序与 chronological 序一致（只要格式固定且使用 UTC），此处在功能上安全，但严格来说应使用 `Date` 比较以避免边缘情况。
2. `item-projection-plane.ts:125-130` 查询 confirmations 时未限制 `created_at < cursor`，导致 cursor pagination 可能包含 confirmations 的 "未来" 项。虽然最终通过 `items.sort` 和 `slice` 处理，但数据库端未过滤会增加不必要的 IO。

### 6.3 clients/api-docs 与代码实现匹配度核实

| 文档 | 匹配度 | 问题 |
|------|--------|------|
| runtime.md | ✅ 基本匹配 | PATCH body 未提及 version 字段（因代码未实现乐观锁） |
| items.md | ⚠️ 部分匹配 | 承诺 7 类 item，但代码仅投影 5 类 + reasoning 无区分逻辑 |
| tool-calls.md | ✅ 匹配 | source 标注为 "d1-tool-call-ledger"，与代码一致 |
| permissions.md | ✅ 匹配 | legacy 移除说明清晰，迁移路径明确 |
| README.md | ⚠️ 部分匹配 | workspace 节中 tool-calls 描述仍为 "first-wave"（R8） |

### 6.4 真实盲点与断点

**盲点 1 — 无 item projection 性能基准**：
action-plan P5-01 要求 "投影性能 ≤500ms P95(limit=50)"，但当前实现未添加任何性能计时或 metric。`list()` 方法跨 4 张表并行查询（虽然代码中是串行），随着 session 累积 message/tool-call/todo/confirmation，性能可能退化。

**盲点 2 — tool-call ledger 的 R2 spill 未实现**：
action-plan P2-03 / P2-05 明确要求 "output 超 budget 写 R2 + 存 output_r2_key"，但当前 `tool-call-ledger.ts` 的 upsert 直接将 output 序列化为 JSON 存入 D1 `output_json` 列，无任何 budget 检查或 R2 spill 逻辑。虽然当前 tool output 通常不大，但随着 capability 扩展（如文件读取、大型搜索），D1 row size 可能超过 SQLite 限制。

**盲点 3 — item projection 的 source row archive 处理**：
action-plan P5-01 要求 "source row archive → 404 item-archived"，但当前 `read()` 在无匹配时直接返回 `null`，`session-items.ts` 将其转换为 404 "not-found"，而非 404 "item-archived"。语义不同："not-found" 可能表示 item_uuid 不存在；"item-archived" 表示 item 曾经存在但被 compact/archive。

**盲点 4 — permission_rules 的 tenant scope 写入路径缺失**：
action-plan P3-03 要求 "scope=tenant 的项写 nano_team_permission_rules，scope=session 的项更新 nano_session_runtime_config.permission_rules_json"，但当前 `session-runtime.ts` 的 PATCH 路由将所有 `permission_rules` 都写入 `nano_session_runtime_config.permission_rules_json`，无论 scope 是 session 还是 tenant。`D1PermissionRulesPlane.upsertTeamRule` 虽存在，但无任何路由调用它。这意味着 tenant-scoped permission rules 无法通过 `/runtime` PATCH 创建。

**断点 1 — followup_input 与 retry/cancel 的 actor-state race**：
action-plan §5.2 风险提醒中提到 "followup_input 与 retry/cancel actor-state race"，但当前 `ws-runtime.ts` 的 `handleClientMessage` 仅解析 followup_input 并转发，未检查当前 session phase 是否为 `turn_running` 或 `attached`。若用户在 turn_running 中 push followup 同时点 retry，可能产生 actor-state 歧义。agent-core 一侧虽有 `pendingInputs` 队列，但 orchestrator-core 公网 WS 端未做 phase gate。

---

*审查完成。以上分析完全基于本轮审查人独立阅读代码、文档和测试的推理，未参考其他同事（Kimi、Deepseek、GPT）的分析报告。*
