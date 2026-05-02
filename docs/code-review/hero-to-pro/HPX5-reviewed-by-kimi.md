# HPX5 Wire-up — Code Review

> 审查对象: `HPX5 — schema-frozen wire-up + bounded surface completion`
> 审查类型: `mixed (code-review + docs-review + closure-review)`
> 审查时间: `2026-05-02`
> 审查人: `kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` (action-plan + §9 工作日志)
> - `docs/issue/hero-to-pro/HPX5-closure.md` (closure 声明)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1 (design 冻结基线)
> - `docs/charter/plan-hero-to-pro.md` (hero-to-pro 阶段 charter)
> - `clients/api-docs/*.md` (18→19 doc pack)
> - `packages/nacp-session/src/emit-helpers.ts` + `test/emit-helpers.test.ts`
> - `workers/orchestrator-core/src/wsemit.ts`
> - `workers/orchestrator-core/src/facade/routes/session-control.ts`
> - `workers/orchestrator-core/src/facade/routes/session-context.ts`
> - `workers/orchestrator-core/src/hp-absorbed-routes.ts`
> - `workers/orchestrator-core/src/user-do/message-runtime.ts`
> - `workers/orchestrator-core/src/user-do/session-flow/start.ts`
> - `workers/orchestrator-core/src/entrypoint.ts`
> - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
> - `workers/agent-core/src/host/runtime-mainline.ts`
> - `workers/context-core/src/index.ts`
> - `scripts/check-docs-consistency.mjs`
> 对照真相:
> - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` §2.1 In-Scope (S1–S9)
> - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` §5.1 / §7.2 (F0–F7)
> - `docs/issue/hero-to-pro/HPX5-closure.md` §1 Resolved 项 (R0–R11)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`代码实现主体成立且测试全绿，但文档存在 5 处严重漂移/矛盾，不应标记为 fully closed。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no`（文档 blocker 未清）
- **本轮最关键的 1-3 个判断**：
  1. `clients/api-docs/session-ws-v1.md` §3.3/§3.4、`confirmations.md` §5、`todos.md` §7/§9 仍标记 emitter 为 "pending"，与已 live 代码事实严重矛盾 — 客户端开发者会误以为 confirmation/todo WS 帧不可用。
  2. `clients/api-docs/context.md` §4.2 与 §5/§6 对 body 透传状态的描述自相矛盾（"已生效" vs "当前 ignored"）。
  3. `clients/api-docs/session.md` 未记录 `/start` 返回的 `first_event_seq` 字段，`session-ws-v1.md` 未说明 "start→ws attach 帧保留窗口"，P5-03 文档交付 incomplete。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/hero-to-pro/HPX5-wire-up-action-plan.md` (660 lines, §9 工作日志)
  - `docs/issue/hero-to-pro/HPX5-closure.md` (139 lines)
  - `docs/design/hero-to-pro/HPX5-HPX6-bridging-api-gap.md` v0.2.1 (873 lines)
  - `docs/charter/plan-hero-to-pro.md` (1331 lines)
  - `docs/templates/code-review.md`
- **核查实现**：
  - `packages/nacp-session/src/emit-helpers.ts` + `test/emit-helpers.test.ts` (10 case)
  - `workers/orchestrator-core/src/wsemit.ts` (cross-worker bridge)
  - `workers/orchestrator-core/src/facade/routes/session-control.ts` (confirmation/todo emitters)
  - `workers/orchestrator-core/src/user-do/message-runtime.ts` (model.fallback)
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` (compact probe + emitTopLevelFrame)
  - `workers/agent-core/src/host/runtime-mainline.ts` (WriteTodos capability)
  - `workers/context-core/src/index.ts` (compact body pass-through)
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts` (workspace bytes GET)
  - `workers/orchestrator-core/src/user-do/session-flow/start.ts` (first_event_seq)
  - `scripts/check-docs-consistency.mjs`
- **执行过的验证**：
  - `pnpm --filter @haimang/nacp-session test` → 207 passed ✅
  - `pnpm --filter @haimang/orchestrator-core-worker test` → 332 passed ✅
  - `pnpm --filter @haimang/agent-core-worker test` → 1072 passed ✅
  - `pnpm --filter @haimang/context-core-worker test` → 178 passed ✅
  - `node scripts/check-docs-consistency.mjs` → OK (19 docs, 4 checks) ✅
  - `pnpm test:contracts` → 28/29 passed (1 pre-existing failure, 与 HPX5 无关) ⚠️
  - `pnpm check:cycles` → 0 cycle ✅
- **复用 / 对照的既有审查**：
  - 无 — 本次审查为独立一手核查，未参考 deepseek/GPT/kimi 既有评审结论。

### 1.1 已确认的正面事实

1. `emit-helpers.ts` 正确实现 `emitTopLevelFrame` + `emitStreamEvent`，zod 校验 + system.error fallback + EmitObserver 指标通道完整，10 case 单测覆盖 happy/unknown/invalid/sink-throw/drop/observer。
2. `wsemit.ts` 正确封装 cross-worker bridge：orchestrator-core → User DO `__forward-frame` → WS push，fire-and-forget 不阻塞 row write。
3. Confirmation emitter (F1) 在 `session-control.ts:420-434` 接通：`applyDecision` 成功后调用 `emitFrameViaUserDO` 发射 `session.confirmation.update`；legacy permission/elicitation dual-write 路径同样在 `surface-runtime.ts` 接通。
4. Todo emitter (F2c) 在 `session-control.ts:521-533` 和 `entrypoint.ts:248-260` 接通：row write 后发射 `session.todos.update` 全量 list snapshot。
5. WriteTodos capability (F2a/F2b) 在 `runtime-mainline.ts:500-587` 接通：`toolName === "write_todos"` 短路到 `writeTodosBackend`，auto-close in_progress + 同 batch 多 in_progress 降级为 pending 逻辑正确。
6. Auto-compact probe (F3) 在 `runtime-assembly.ts:251-283` 接通：`composeCompactSignalProbe` 注入 `OrchestrationDeps.probeCompactRequired`，budgetSource 调 `readContextDurableState` 计算 `used >= limit`。
7. Compact body 透传 (F3) 在 `session-context.ts:6-69` 和 `context-core/src/index.ts:228-377` 接通：`force/preview_uuid/label` 作为 optional 参数透传，backward-compatible。
8. Model.fallback emitter (F4) 在 `message-runtime.ts:400-443` 接通：硬编码 `fallback_used: false` 已替换为从 `inputAck.body` 读取真实值，fallback_used=true 时 emit `model.fallback` stream-event。
9. Workspace bytes GET (F5) 在 `hp-absorbed-routes.ts:298-344` 接通：binary-content profile + 25 MiB cap + `content_source: "live"`。
10. `/start` 返回 `first_event_seq` (F7) 在 `start.ts:275-289` 代码落地。
11. `client-cookbook.md` 新建，12 节实战兜底内容完整。
12. `check-docs-consistency.mjs` 通过 4 项检查，但检查项少于 action-plan 声明的 6 项。
13. 全部改动 backward-compatible：新增 deps/字段全 optional，legacy 路径不动。

### 1.2 已确认的负面事实

1. `clients/api-docs/session-ws-v1.md` 第100行仍声明 confirmation WS 帧 "还没有在 orchestrator runtime 真实 emit"，第132行声明 todo WS 帧 "还没有真实 emitter" — 与已 live 代码直接矛盾。
2. `clients/api-docs/todos.md` 第201行声明 todo 帧 "schema registered / emitter pending"，第221行声明 "agent-core 当前没有 WriteTodos capability" — 与代码矛盾。
3. `clients/api-docs/confirmations.md` 第186行声明 confirmation 帧 "schema registered / emitter pending" — 与代码矛盾。
4. `clients/api-docs/context.md` 第97行声明 "body 字段已生效"，但第109行和第140行声明 "Body 字段当前 ignored" — 同一份文档自相矛盾。
5. `clients/api-docs/session.md` 完全未提及 `/start` 返回的 `first_event_seq` 字段；`session-ws-v1.md` 未添加 "start→ws attach 帧保留窗口" 章节。
6. `clients/api-docs/permissions.md` 第20行、第28行、第164行使用 `kind: "permission"`，但 action-plan 和 confirmations.md 要求统一为 `tool_permission`。
7. `scripts/check-docs-consistency.mjs` 只有 4 项检查，action-plan P5-05 声明应有 6 项（缺 `session_status` 7 值枚举一致性、缺 `tool_permission` vs `permission` kind 名一致性）。
8. `pnpm test:contracts` 有 1 项 pre-existing 失败 (`session-registry-doc-sync.test.mjs`)，与 HPX5 无关但需在 HP10 前清理。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 一手读取 20+ 源文件，逐行核对 action-plan 声称的行号 |
| 本地命令 / 测试 | yes | 运行 4 个 worker 测试套件 + contracts + docs-consistency + cycles |
| schema / contract 反向校验 | yes | 核对 SESSION_BODY_SCHEMAS、SessionStreamEventBodySchema、type-direction-matrix |
| live / deploy / preview 证据 | no | 仅本地代码审查，无 wrangler deploy 验证 |
| 与上游 design / QNA 对账 | yes | 对照 HPX5-HPX6-bridging-api-gap.md v0.2.1 的 Q-bridging-1..8 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | session-ws-v1.md / confirmations.md / todos.md 中 confirmation/todo emitter 状态仍标 "pending" | critical | docs-gap | yes | 更新文档为 "live since HPX5"，补充 emit 时机说明 |
| R2 | context.md 对 compact body 透传状态自相矛盾 | high | docs-gap | yes | 删除 "Body 字段当前 ignored" 段落，统一为 "HPX5 F3 已生效" |
| R3 | session.md 未记录 first_event_seq；session-ws-v1.md 未加 start→ws attach 保留窗口章节 | high | docs-gap | yes | session.md §4 补充 first_event_seq 字段说明；session-ws-v1.md 新增 §3.x |
| R4 | permissions.md 中 confirmation kind 仍用 "permission" 而非 "tool_permission" | medium | docs-gap | no | 全文替换为 tool_permission，与 confirmations.md 统一 |
| R5 | check-docs-consistency.mjs 检查项少于 action-plan 声明 | medium | test-gap | no | 补充 2 项缺失检查：session_status 枚举、tool_permission kind 名 |
| R6 | compact.notify 4 状态链路未在代码中完整验证 | medium | delivery-gap | no | 需确认 started/completed/failed/skipped 全路径有 e2e 覆盖 |

### R1. session-ws-v1.md / confirmations.md / todos.md emitter 状态仍标 "pending"

- **严重级别**：`critical`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/session-ws-v1.md:100` — "这两个 WS frame 还没有在 orchestrator runtime 真实 emit"
  - `clients/api-docs/session-ws-v1.md:132` — "WS todo 帧还没有真实 emitter"
  - `clients/api-docs/confirmations.md:186` — "当前这些帧是 schema registered / emitter pending"
  - `clients/api-docs/todos.md:201` — "这些 todo 帧当前是 schema registered / emitter pending"
  - `clients/api-docs/todos.md:221` — "agent-core 当前没有 WriteTodos capability，LLM 不能直接写 todo"
  - 代码事实：`session-control.ts:420-434` (confirmation emit)、`session-control.ts:521-533` (todo HTTP emit)、`entrypoint.ts:248-260` (todo LLM emit)、`runtime-mainline.ts:500-587` (WriteTodos capability)
- **为什么重要**：客户端开发者基于文档决策。若文档说 emitter pending，前端会写 polling fallback 而非 WS event-driven reducer，导致 HPX5 "WebSocket-first" 目标落空。
- **审查判断**：这是 action-plan F7 的交付缺口。代码已实现，但文档未同步更新。closure 声称 "18-doc pack 内零契约不一致" 不成立。
- **建议修法**：
  1. `session-ws-v1.md` §3.3 和 §3.4 的 "当前实现状态" 备注改为 "HPX5 F1/F2c live — row write 后 ≤500ms emit"
  2. `confirmations.md` §5 的 "emitter pending" 改为 "emitter live since HPX5"
  3. `todos.md` §7 的 "emitter pending" 改为 "emitter live since HPX5"
  4. `todos.md` §9 的 "agent-core 当前没有 WriteTodos capability" 改为 "HPX5 F2a/F2b 已接通 — LLM 可调 write_todos"

### R2. context.md 对 compact body 透传状态自相矛盾

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/context.md:97` — "> **HPX5 F3 — body 字段已生效**: façade 层 ... 读取 `{ force?, preview_uuid?, label? }` 并透传 ..."
  - `clients/api-docs/context.md:109` — "> **Body 字段当前 ignored**：HP9 frozen 阶段 façade 层不读取 request body，`force` 由 server 决定"
  - `clients/api-docs/context.md:140` — "> **Body 字段当前 ignored**：HP9 frozen 阶段 façade 层不读取 request body，`force`/`preview_uuid` 由 server 决定"
- **为什么重要**：同一份文档对同一功能给出相反描述，客户端开发者无法判断 body 字段是否有效，会构造不必要的 defensive code。
- **审查判断**：§4.2 (snapshot) 的 "body 字段已生效" 描述正确，但 §5 (preview) 和 §6 (compact) 的 "ignored" 描述是 HP9 frozen 时期的遗留，未在 HPX5 文档刷新时清理。
- **建议修法**：删除 §5 和 §6 中 "Body 字段当前 ignored" 的两段备注，统一为 "HPX5 F3 — body 字段已生效；legacy 客户端不发 body 时行为不变"。

### R3. session.md 未记录 first_event_seq；session-ws-v1.md 未加保留窗口章节

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - action-plan P5-03 要求："`clients/api-docs/session.md` `:104` 更新 success 示例；`clients/api-docs/session-ws-v1.md` 加章节'start→ws attach 之间的帧保留窗口'说明"
  - `session.md` 全文搜索 `first_event_seq` → 0 hits
  - `session-ws-v1.md` 无 "start→ws attach" 或 "帧保留窗口" 章节
  - 代码事实：`start.ts:288-289` 确实返回 `first_event: ...payload, first_event_seq: firstEventSeq`
- **为什么重要**：`first_event_seq` 是消除 start→ws-attach race window 的关键字段。文档缺失导致客户端不知道有此字段可用，继续用 `last_seen_seq=0` 兜底，浪费带宽。
- **审查判断**：action-plan P5-03 的代码交付完成，但文档交付 incomplete。
- **建议修法**：
  1. `session.md` §4 `/start` success 示例中补充 `first_event_seq` 字段
  2. `session.md` 字段说明中增加 `first_event_seq: number` — "客户端可用作 `last_seen_seq` 兜底"
  3. `session-ws-v1.md` 新增 §3.x "start→ws attach 帧保留窗口"，说明 `/start` 返回的 `first_event_seq` 与 WS `last_seen_seq` 的衔接关系

### R4. permissions.md 中 confirmation kind 仍用 "permission" 而非 "tool_permission"

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/permissions.md:20` — "应订阅 `session.confirmation.request{kind: "permission"}` 帧"
  - `clients/api-docs/permissions.md:28` — "kind = `permission` 或 `elicitation`"
  - `clients/api-docs/permissions.md:164` — "监听 `session.confirmation.request{kind: "permission"}`"
  - action-plan P5-01 第3条要求："confirmation kind 统一为 `tool_permission`"
  - `confirmations.md` 和 `session-ws-v1.md` 已正确使用 `tool_permission`
- **为什么重要**：kind 名不一致会导致客户端 reducer 的 case 匹配失败（监听 `tool_permission` 但收到 `permission` 或反之）。
- **审查判断**：permissions.md 是 legacy 兼容层文档，但仍有新客户端会参考。应在文档中统一。
- **建议修法**：`permissions.md` 全文 `kind: "permission"` → `kind: "tool_permission"`，并在 legacy 映射表中注明 "legacy code 内部仍用 permission，但 public frame 统一为 tool_permission"。

### R5. check-docs-consistency.mjs 检查项少于 action-plan 声明

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P5-05 声明 6 项检查：(a) confirmation kind 统一为 `tool_permission`；(b) decision body 字段；(c) `session_status` 7 值枚举；(d) `index.ts:NNN` 零出现；(e) `effective_model_id` 零出现；(f) `tool_permission` vs `permission` kind 名一致
  - 实际脚本只有 4 项：`(d) index.ts:NNN`、`(e) effective_model_id`、`(c) session_status: "running"`、`content_source: pending`
  - 缺失：(a) confirmation kind `(b) decision body` 形状检查、(f) `tool_permission` vs `permission` 一致性
- **为什么重要**：缺失的检查项会导致文档 drift 无法在 CI 中自动捕获。
- **审查判断**：脚本已能 catch 已知的 4 类 drift，但 coverage 不完整。HPX6 文档扩展时 drift 风险上升。
- **建议修法**：补充 2 项检查：(a) 全 doc 中 `kind.*"permission"`（排除 `tool_permission` 合法引用）应为零；(b) decision body 示例中必须同时出现 `status` 和 `decision_payload`。

### R6. compact.notify 4 状态链路未在代码中完整验证

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action-plan P4-03 要求："compact.notify 4 状态 (started/completed/failed/skipped) 全路径 emit"
  - design doc §7.2 F3 要求："完整 4 状态 `compact.notify` 链路 emit"
  - 代码中 `compact.notify` 作为 stream-event kind 已在 agent-core kernel 中注册，agent-core test 覆盖 `compact-turn.test.ts` 验证了 compact 触发和 notify emit
  - 但未找到显式的 e2e 覆盖 "started→completed"、"started→failed"、"skipped" 三种状态转换的独立 test case
- **为什么重要**：auto-compact 的可靠性直接取决于 4 状态 notify 的完整覆盖。缺少 e2e 保护意味着未来 regression 可能 silently 丢失某个状态。
- **审查判断**：代码实现存在（agent-core kernel 已处理 compact.notify），但 action-plan 要求的 "4 状态都有 e2e 覆盖" 尚未完全验证。
- **建议修法**：在 `tests/contracts/` 或 `test/cross-e2e/` 中添加 compact.notify 4 状态覆盖用例，或至少在 closure 中明确标记 "代码路径 live，e2e 覆盖待 HPX6 补充"。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | F0: 新建 emit-helpers.ts + runtime-assembly 注入 emitTopLevelFrame | done | 代码 + 10 case 单测全绿；EmitObserver 接 latency/drop/fallback 指标 |
| S2 | F1: confirmation 顶层帧 emit | done | `session-control.ts:420-434` + `surface-runtime.ts` legacy 路径接通；row write 后 emit |
| S3 | F2a: write_todos tool schema 注册 | done | `runtime-mainline.ts:500-520` tool schema 通过 capability execute 入口注册 |
| S4 | F2b: execution 路由 + auto-close | done | `entrypoint.ts:157-264` writeTodos RPC 接通；auto-close in_progress + 同 batch 降级逻辑正确 |
| S5 | F2c: todo 顶层帧 emit | done | `session-control.ts:521-533` + `entrypoint.ts:248-260` 双路径接通 |
| S6 | F3: auto-compact runtime trigger | done | `runtime-assembly.ts:251-283` probeCompactRequired 注入；budgetSource 计算逻辑正确 |
| S7 | F3: façade body 透传 | done | `session-context.ts:6-69` 读 body + `context-core/src/index.ts:228-377` 签名扩展；optional backward-compat |
| S8 | F4: model.fallback emitter | done | `message-runtime.ts:400-443` 替换硬编码 + emit stream-event |
| S9 | F5: workspace bytes GET | done | `hp-absorbed-routes.ts:298-344` binary GET + 25 MiB cap + content_source: "live" |
| S10 | F7: 13 处契约修齐 | partial | 4 项已修（effective_model_id、session_status、content_source、index.ts ref），但 confirmation/todo emitter 状态文档未更新 |
| S11 | F7: implementation reference 刷新 | done | 9 份 doc reference 行号已刷新到 facade/routes/*.ts + *-control-plane.ts |
| S12 | F7: /start 返 first_event_seq | partial | 代码完成，但 session.md 和 session-ws-v1.md 未更新文档 |
| S13 | F7: client-cookbook.md 新建 | done | 12 节实战兜底内容完整 |
| S14 | F7: check-docs-consistency.mjs CI gate | partial | 脚本通过但检查项少于 action-plan 声明的 6 项 |

### 3.1 对齐结论

- **done**: 9
- **partial**: 4
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> 结论：核心骨架（代码 + 测试）已完成，但 F7 文档交付存在 4 项 partial，导致 "18-doc pack 内零契约不一致" 的声明不成立。这更像 "功能 live 但文档未同步"，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | F6 tool-calls 真实化 ledger → HPX6 | 遵守 | 代码中 `/tool-calls` 仍返 first-wave shape，无 D1 table 写入 |
| O2 | F8 followup_input public WS → HPX6 | 遵守 | `SessionAction` 枚举不含 followup_input，NanoSessionDO 无 WS handler |
| O3 | F9–F15 (runtime config / permission rules / executor / item projection / file_change) → HPX6 | 遵守 | 未在 HPX5 中实施 |
| O4 | stream-event 13-kind 已 live emitter 全量迁移到 emit-helpers | 遵守 | 现有 pushStreamEvent 路径未动，仅新 emitter 走 helpers |
| O5 | WriteTodos V2 task graph | 遵守 | 仍为 flat 5-status list |
| O6 | legacy session.permission.request / session.elicitation.request 恢复 | 遵守 | 未恢复， confirmation 新帧族 live |
| O7 | Q-bridging-7 permission_mode 直接删 | 遵守 | legacy `POST /policy/permission_mode` 完全保留，留 HPX6 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`HPX5 代码实现质量高、测试全绿、backward-compatible 设计到位；但 F7 文档交付存在 4 项 partial（R1–R3/R5），导致 18-doc pack 与代码事实不一致。在文档 blocker 清理前，本轮 review 不收口。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R1** — 更新 `session-ws-v1.md` §3.3/§3.4、`confirmations.md` §5、`todos.md` §7/§9 的 emitter 状态为 "live since HPX5"
  2. **R2** — 删除 `context.md` §5/§6 中 "Body 字段当前 ignored" 的残留备注
  3. **R3** — `session.md` 补充 `first_event_seq` 字段说明；`session-ws-v1.md` 新增 start→ws attach 保留窗口章节
- **可以后续跟进的 non-blocking follow-up**：
  1. **R4** — `permissions.md` 统一 `permission` → `tool_permission`
  2. **R5** — `check-docs-consistency.mjs` 补充 2 项缺失检查
  3. **R6** — compact.notify 4 状态 e2e 覆盖补充（可在 HPX6 中一并处理）
- **建议的二次审查方式**：`same reviewer rereview`（文档修改后由本 reviewer 快速复核即可）
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码与文档。

---

## 6. 跨阶段跨包深度分析

### 6.1 hero-to-pro 整体工作回顾

HPX5 是 hero-to-pro 阶段最后一个 "接线工程" phase，位于 HP1–HP9 之后、HPX6 之前。从 charter 视角看：

- **G3 (context-core stub)** — HPX5 F3 接通了 auto-compact runtime trigger 和 body 透传，但 context-core 的 "3 RPC 解 stub"（完整 cross-turn history、真实 context layers）仍依赖 HP3 的原始实现。HPX5 仅做了 "接线"，未解 stub。
- **G4 (compactRequired 永远 false)** — HPX5 F3 已接通 `composeCompactSignalProbe`，但 budgetSource 计算的是 `used >= auto_compact_token_limit`。若 `readContextDurableState` 返回的 usage 数据不准确（stub 数据），auto-compact 仍可能 false-negative。这是 HP3 的残留风险，非 HPX5 责任。
- **G7 (hook dispatcher 无注入)** — HPX5 未触及。HP5 的 hook dispatcher 已在 `runtime-assembly.ts:192` 注入，但 `hooks/permission.ts` 仍无真实调用方。这是 F12 慢性 deferral，不在 HPX5 scope。
- **G8 (pushServerFrameToClient 缺 e2e)** — HPX5 新增了 `forwardServerFrameToClient` 的调用方（confirmation/todo/fallback emitters），但 action-plan 未要求补 P1-10/P1-11/P1-12 round-trip e2e。这符合 HPX5 "bounded surface" 的边界纪律。
- **G10 (todo/plan API)** — HPX5 F2 已完成 todo CRUD + WriteTodos capability + WS emitter，G10 的 "todo/plan API" 缺口已闭合。
- **G12 (clients/api-docs 漂移)** — HPX5 F7 声称修齐 13 处断点，但审查发现新增 5 处文档 drift（R1–R4）。这说明 "文档断点修复" 比 "代码接线" 更容易被低估。

### 6.2 跨包依赖健康度

| 依赖对 | 状态 | 风险 |
|--------|------|------|
| nacp-session → emit-helpers | 新增，无循环 | 低；已 publish 到 `@haimang/nacp-session` |
| orchestrator-core → nacp-session (emit-helpers) | 新增 import | 低；wsemit.ts 正确引用 |
| agent-core → orchestrator-core (writeTodosBackend) | 新增 optional deps | 低；`MainlineKernelOptions.writeTodosBackend?` optional |
| agent-core → orchestrator-core (readContextDurableState) | 新增 optional deps | 低；`MainlineKernelOptions.compactSignalProbe?` optional |
| orchestrator-core → context-core (compact body pass-through) | RPC 签名扩展 | 低；optional 末位参数 |
| orchestrator-core → filesystem-core (readTempFile) | 复用已有 RPC | 低；仅 façade pass-through |

`pnpm check:cycles` 确认 0 新增循环依赖。

### 6.3 命名规范与执行逻辑检查

- **命名规范**：`emitTopLevelFrame` / `emitStreamEvent` / `EmitSink` / `EmitContext` 命名清晰，与 design doc §3.4 的 "emit seam helper" 术语一致。
- **字段命名**：`fallback_model_id`（非 `effective_model_id`）在代码和文档中已统一，符合 Q-bridging-6。
- **执行逻辑**：
  - confirmation/todo emit 严格在 row write 之后（HP5 Q16 row-first dual-write 遵守）
  - WriteTodos auto-close 先 PATCH 旧 in_progress 再 INSERT 新 todo（Q19 at-most-1 invariant 遵守）
  - emit 失败 fall back 到 system.error，不静默丢帧（design §3.4 取舍 6 遵守）
  - compact body 透传 optional，legacy 客户端不传不退化（backward-compat 遵守）

### 6.4 真实盲点与断点

1. **文档-代码同步盲点**：HPX5  closure 声称 "18-doc pack 内零契约不一致"，但审查发现 5 处矛盾。这说明 "文档收口" 不能仅靠 `check-docs-consistency.mjs` 的 4 项 regex 检查来保障，需要人工对 "实现状态" 描述的逐段复核。
2. **compact.notify 4 状态测试断点**：代码中 compact.notify 的 emit 路径存在，但 action-plan 要求的 "4 状态全 e2e 覆盖" 未找到独立 test case。
3. **first_event_seq 消费断点**：代码返回了 `first_event_seq`，但文档未说明如何使用。客户端开发者可能忽略此字段，继续用 `last_seen_seq=0` 重放全部历史。
4. **permissions.md 的 legacy→canonical 映射断点**：`kind: "permission"` 的残留会导致客户端 reducer 的 pattern matching 失败，尤其是新客户端从 permissions.md 入门时。

### 6.5 对 HPX6 的 handoff 影响

HPX6 直接消费 HPX5 的 F0 emit-helpers 基础设施，这为本审查确认的健康状态：
- emit-helpers.ts 的 `EmitSink` / `EmitContext` / `EmitObserver` 接口足够支撑 HPX6 F9 (`session.runtime.update`)、F12 (`session.restore.completed`)、F14 (`session.item.*`) 的新顶层帧
- cross-worker bridge (`wsemit.ts`) 模式可复制到 HPX6 的新 emitter
- 但 HPX6 需注意：**不要在文档中重复 HPX5 的 "pending" 错误** — 任何新 emitter 在代码接通后必须同步更新文档状态

---

## 7. 实现者回应区

> 请按 `docs/templates/code-review-respond.md` 在本文档 §7 之后 append 回应，不要改写 §0–§6。

