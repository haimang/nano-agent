# Nano-Agent 代码审查模板

> 审查对象: `orchestration-facade / F0~F2`
> 审查时间: `2026-04-24`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
> - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
> - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
> - `docs/issue/orchestration-facade/F0-closure.md`
> - `docs/issue/orchestration-facade/F1-closure.md`
> - `docs/issue/orchestration-facade/F2-closure.md`
> - `workers/orchestrator-core/src/{index,auth,user-do}.ts`
> - `workers/agent-core/src/host/internal.ts`
> - `test/package-e2e/orchestrator-core/*.test.mjs`
> - `workers/orchestrator-core/test/*.test.ts`
> - `context/smind-contexter/src/{chat.ts,engine_do.ts}`
> - `docs/design/orchestration-facade/F0-{stream-relay-mechanism,user-do-schema,session-lifecycle-and-reconnect,compatibility-facade-contract}.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：F0~F2 的主体交付已成立，文档冻结与代码实现之间存在少量偏离，当前不应标记为无条件 completed，应带 follow-ups 收口。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. F0 文档冻结工作完整、closure 可信，Q1-Q8 回填与 blocker 清空的事实可被交叉验证。
  2. F1 核心骨架（orchestrator-core worker、guarded internal route、first event relay）已从概念落地为真实代码路径，probe 与最小 live e2e 成立。
  3. F2 完整 session seam 已补齐，但实现层存在若干偏离 frozen design 的细节（stream frame 运行时校验缺失、cursor 语义与设计文档不一致、completed/error terminal 到 lifecycle ended 的映射路径缺失），需要以 non-blocking follow-up 形式记录并后续修正。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。

- **对照文档**：
  - `docs/action-plan/orchestration-facade/F0-concrete-freeze-pack.md`
  - `docs/action-plan/orchestration-facade/F1-bringup-and-first-roundtrip.md`
  - `docs/action-plan/orchestration-facade/F2-session-seam-completion.md`
  - `docs/issue/orchestration-facade/F0-closure.md`
  - `docs/issue/orchestration-facade/F1-closure.md`
  - `docs/issue/orchestration-facade/F2-closure.md`
  - `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`
  - `docs/design/orchestration-facade/F0-user-do-schema.md`
  - `docs/design/orchestration-facade/F0-session-lifecycle-and-reconnect.md`
  - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
  - `docs/design/orchestration-facade/F0-contexter-absorption-inventory.md`
  - `docs/plan-orchestration-facade.md`（charter 顶层状态）
- **核查实现**：
  - `workers/orchestrator-core/src/index.ts`
  - `workers/orchestrator-core/src/auth.ts`
  - `workers/orchestrator-core/src/user-do.ts`
  - `workers/agent-core/src/host/internal.ts`
  - `workers/agent-core/src/index.ts`
  - `test/package-e2e/orchestrator-core/01-preview-probe.test.mjs`
  - `test/package-e2e/orchestrator-core/02-session-start.test.mjs`
  - `test/package-e2e/orchestrator-core/03-ws-attach.test.mjs`
  - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs`
  - `test/package-e2e/orchestrator-core/05-verify-status-timeline.test.mjs`
  - `workers/orchestrator-core/test/smoke.test.ts`
  - `workers/orchestrator-core/test/user-do.test.ts`
- **执行过的验证**：
  - `grep -r "orchestration-facade-F2" workers/orchestrator-core/src/` — probe marker 确认
  - `grep -r "invalid-internal-auth" workers/agent-core/src/` — internal auth gate 确认
  - `grep -r "attachment_superseded" workers/orchestrator-core/src/` — WS supersede 确认
  - `grep -r "relay_cursor" workers/orchestrator-core/src/` — cursor 语义确认
  - `grep -r "z\.discriminatedUnion\|z\.object" workers/orchestrator-core/src/` — Zod 校验缺失确认
  - 交叉阅读 design docs vs 代码实现的关键字段与类型定义

### 1.1 已确认的正面事实

- F0 closure 中声明的 6 项实际交付（charter 状态同步、8 份 design docs 翻 frozen、FX-qna Q1-Q8 回填、review findings 追加 close-out、action-plan 切 executed、本文档解锁 F1）均可在对应文件路径中找到物化证据。
- F1 closure 中声明的 5 项实际交付（orchestrator-core worker 新建、agent-core `/internal/*` 落地、user DO SessionEntry 写入、package-e2e 新增、F1 action-plan 回填）均可在代码树中找到对应文件与实现。
- F2 closure 中声明的 5 项实际交付（route family 补齐、agent-core internal 补齐、user DO lifecycle/retention/supersede/terminal、live suite 扩面、probe marker bump）均可在代码与测试文件中找到对应实现。
- `orchestrator-core` 的 probe marker 确为 `phase: "orchestration-facade-F2"`，与 closure 一致。
- `agent-core` 的 `/internal/sessions/:id/{start,input,cancel,status,timeline,verify,stream}` 路由族真实存在，且 `x-nano-internal-binding-secret` gate 与 typed `401 invalid-internal-auth` 真实执行。
- user DO 的 `SessionEntry` 字段（`created_at / last_seen_at / status / last_phase / relay_cursor / ended_at`）与 `F0-user-do-schema.md` 的定义一致。
- WS supersede 的实现顺序为：先从 `attachments` Map 删除旧 attachment → 发送 `attachment_superseded` → `close(4001)` → 写入新 attachment。这与 F2 工作日志中描述的细缝修复一致。
- `24h + 100` 双上限 retention 在代码中真实存在（`ENDED_TTL_MS = 24 * 60 * 60 * 1000`, `MAX_ENDED_SESSIONS = 100`）。
- `context/smind-contexter` 的 CICP 协议层、SQLite 域、`db_do.ts`、RAG 均未在 orchestrator-core 中出现，F0 的 absorption inventory 边界被遵守。
- `initial_context_seed` 的 JWT claim 直映射（`realm_hints / source_name / default_layers=[] / user_memory_ref=null`）在 `auth.ts` 中真实落地。

### 1.2 已确认的负面事实

- `workers/orchestrator-core/src/user-do.ts` 的 `readNdjsonFrames` 直接使用 `JSON.parse(line) as StreamFrame`，没有运行时类型校验框架（Zod 或类似）。
- `forwardFramesToAttachment` 仅对 `kind === 'event'` 的 frame 推进 `relay_cursor`，`meta` 与 `terminal` frame 被跳过。这与 `F0-stream-relay-mechanism.md` §7.2 "terminal frame 也计入已 forward 序列" 不一致。
- `handleStart` 与 `handleInput` 读取 internal stream 后，不处理 `terminal` frame 对 lifecycle 的映射；当前代码中只有 `handleCancel` 会写入 `ended` 状态与 `SessionTerminalRecord`。因此 `completed` / `error` terminal 不会触发 lifecycle 状态迁移到 `ended`，也不会进入 retention cleanup。
- `test/package-e2e/orchestrator-core/04-reconnect.test.mjs` 仅测试了 `detached -> success` 分支，未覆盖 `terminal` 与 `missing` 的 live reconnect 证据。
- `workers/orchestrator-core/src/auth.ts` 导出了 `signJwt` 函数，但 orchestrator-core 作为 public façade 只需 verify；`signJwt` 仅被测试代码使用，却位于生产代码路径中。
- `workers/orchestrator-core/src/index.ts:43` 的 `ensureTenantConfigured` 在非 test 环境下强制要求 `TEAM_UUID`，但 `auth.ts:152` 允许 JWT payload 中无 tenant claim（`effectiveTenant = claimTenant ?? deployTenant` 可能为 `undefined`）。两者的 tenant 宽松度不一致。
- `workers/agent-core/src/host/internal.ts:32` 的 `validateInternalSecret` 在 `env.NANO_INTERNAL_BINDING_SECRET` 未配置时（`!expected` 为 true），会拒绝所有请求（包括合法请求）；而 `orchestrator-core/src/user-do.ts:568` 在 `NANO_INTERNAL_BINDING_SECRET` 缺失时返回 `503 internal-auth-unconfigured`。两者的未配置行为不对称。

---

## 2. 审查发现

### R1. StreamFrame 缺少运行时类型校验

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:133-158` 中 `readNdjsonFrames` 使用 `JSON.parse(line) as StreamFrame`。
  - `F0-stream-relay-mechanism.md` §7.2 明确要求："F1 实现时应以同样的 `kind` discriminator 构造 `z.discriminatedUnion("kind", [...])`"，且 "`seq` 必须校验为 `number().int().nonnegative()`"。
  - `grep` 确认 `workers/orchestrator-core/src/` 中无任何 `zod` 或 `z.` 的使用。
- **为什么重要**：
  - 如果 `agent-core` 因内部变更返回畸形 NDJSON line（例如缺少 `kind`、seq 为负数、或 `terminal` 为非法字符串），`orchestrator-core` 会在运行时抛出未捕获异常或产生类型断言失效后的静默错误。façade 作为 session owner，应当对流输入具备防御性校验。
- **审查判断**：
  - 实现偏离了 frozen design 的明确要求。虽然当前 first-wave 的 agent-core 受控，但 façade 层应对下游流具备最小校验纪律。
- **建议修法**：
  - 在 `orchestrator-core` 中引入轻量 Zod schema（或至少手动 discriminator 校验），对 `kind`、`seq`、`terminal` 的合法性做运行时断言，并在校验失败时返回 typed `invalid-stream-frame` 错误而不是裸抛异常。

### R2. relay_cursor 语义偏离 frozen design（terminal frame 未计入 cursor）

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:505-530` 的 `forwardFramesToAttachment` 中：`if (frame.kind !== 'event') continue;`，因此 `meta` 与 `terminal` frame 不会被转发给 WS client，也不会推进 `relay_cursor`。
  - `F0-stream-relay-mechanism.md` §7.2 原文："只要 frame 被成功 forward 给当前 attachment，cursor 就更新；**terminal frame 也计入已 forward 序列**"。
- **为什么重要**：
  - cursor 是 reconnect resume 的核心依据。如果 terminal frame 的 seq 大于最后一个 event 的 seq，但 cursor 没有推进到 terminal seq，则 reconnect 时可能重复收到已经被 forward 过的 terminal frame，或导致 off-by-one 的 resume 偏移。
- **审查判断**：
  - 代码行为与 frozen design 直接冲突。F2 closure 工作日志提到 "relay_cursor 现在只在 façade 真正向 WS client forward event 时推进"，说明这是实现者有意为之的修正，但修正没有同步回 design doc。design freeze 的纪律要求：如果实现发现 design 需要调整，应更新 design doc 再执行，而不是单方面偏离。
- **建议修法**：
  - 方案 A（首选）：恢复 design 原语义，让 `forwardFramesToAttachment` 对 `event` 与 `terminal` 都推进 cursor（`meta` 可继续跳过，因为 seq=0 是固定起点）。同时同步更新 design doc 说明 `meta` 不计入、`terminal` 计入。
  - 方案 B（若坚持当前语义）：在 design doc 中显式修改 cursor 定义，说明 "cursor 只追踪已转发的 event seq，terminal 不纳入 cursor"，并评估对 reconnect 逻辑的影响。

### R3. completed/error stream terminal 不触发 lifecycle ended，导致 retention 清理路径缺失

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:234-300` 的 `handleStart` 与 `:302-339` 的 `handleInput` 在读取 internal stream frames 后，仅调用 `forwardFramesToAttachment` 转发 event，不检查是否存在 `terminal` frame，也不根据 `terminal` 的值更新 session lifecycle 为 `ended`。
  - 当前只有 `:341-382` 的 `handleCancel` 会写入 `ended` 状态、`SessionTerminalRecord` 与 `ENDED_INDEX_KEY`。
  - `cleanupEndedSessions` 仅清理 `ENDED_INDEX_KEY` 中的 session；非 `ended` 的 `detached` session 不会被清理。
  - `F0-session-lifecycle-and-reconnect.md` §7.2 的状态机表格中，`completed` / `cancelled` / `error` 都映射到 `lifecycle.status = "ended"`。
- **为什么重要**：
  - 如果 agent-core 的 session 正常完成（`terminal: completed`）或因错误终止（`terminal: error`），façade 侧永远将其保留为 `detached`，既不会进入 ended retention 清理，也不会在后续 reconnect 时返回 `session_terminal`（因为 status 不是 `ended`）。这与设计状态机直接矛盾，长期会导致 user DO storage 中积累大量实际上已终结的 session entry。
- **审查判断**：
  - F2 closure 工作日志声称 "F1 时 internal stream 的 terminal frame 被错误当成 session terminal；F2 已把'request 完成'与'session ended'从 façade lifecycle 角度重新分开"。我理解实现者的意图：不希望 agent-core 的 stream terminal 自动等同 façade 的 session ended。但设计文档的状态机明确将 `completed` / `error` 映射到 `ended`。如果实现者认为这需要在 F3/F4 由更上层的 "session-level terminal law" 来判定，则当前 F2 的代码实际上把 completed/error 的处理完全留空了——这不是 "分开"，而是 "缺失路径"。
- **建议修法**：
  - 在 `handleStart` / `handleInput` 的 frame 消费循环中，增加对 `terminal` frame 的检测。若读到 `terminal: completed` 或 `terminal: error`，应将 session 状态迁移到 `ended`，写入 `SessionTerminalRecord`，调用 `rememberEndedSession`，并执行 `notifyTerminal` 关闭当前 WS attachment（如有）。
  - 如果实现者坚持认为 completed/error 的判定需要额外的 "session-level terminal law"（例如需要二次确认 agent-core 的 status），则应在代码中显式 TODO/FIXME 注释，并在 F3 action-plan 中增加对应工作项，而不是静默忽略。

### R4. package-e2e 缺少 terminal/missing reconnect 的 live 证据

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `test/package-e2e/orchestrator-core/04-reconnect.test.mjs` 仅测试了 `detached -> success` 场景（start → ws attach → close → reconnect → success）。
  - `F2-session-seam-completion.md` §8.2 收口标准第 3 条要求：`success/terminal/missing reconnect taxonomy 可被断言`。
  - `workers/orchestrator-core/test/user-do.test.ts:251-290` 有单元测试覆盖 `session_terminal` 与 `session_missing` 的 WS attach rejection，但这不是 reconnect 测试，而是 attach 测试。
- **为什么重要**：
  - reconnect 的完整 taxonomy（success / terminal / missing）是 F2 的核心交付之一。live e2e 中只验证了 success，无法证明在真实 deploy 环境下 terminal 与 missing 分支的行为正确。单元测试不能替代 live e2e 对网络边界、DO storage、预览环境一致性的验证。
- **审查判断**：
  - 属于 delivery gap，但不阻塞 F2 的核心功能（因为单元测试已覆盖）。应在 F3 前补齐。
- **建议修法**：
  - 在 `04-reconnect.test.mjs` 或新增 `04b-reconnect-terminal.test.mjs` 中，增加两个 live 用例：
    1. `cancel` 后 reconnect → 断言收到 `session_terminal`（HTTP 409）。
    2. 使用从未 start 过的随机 session UUID reconnect → 断言收到 `session_missing`（HTTP 404）。

### R5. auth.ts 中的 signJwt 混入生产代码路径

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - `workers/orchestrator-core/src/auth.ts:97-111` 导出了 `signJwt`。
  - 搜索确认 `signJwt` 仅在 `workers/orchestrator-core/test/smoke.test.ts` 中被使用，未在生产代码中被调用。
  - orchestrator-core 的职责是 verify JWT，不是 issue JWT。
- **为什么重要**：
  - 虽然 `signJwt` 需要 secret 才能运行，不存在直接的安全漏洞，但它增加了代码表面积，混淆了 façade 的职责边界。未来维护者可能误用。
- **审查判断**：
  - 属于 scope drift，non-blocking。
- **建议修法**：
  - 将 `signJwt` 移动到测试 helper 文件中（例如 `test/jwt-helper.ts`），或至少在 `auth.ts` 中添加显式注释说明 "测试专用，façade 不签发 token"。

### R6. ensureTenantConfigured 与 authenticateRequest 的 tenant 宽松度不一致

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/index.ts:42-47`：`if (!env.TEAM_UUID && env.ENVIRONMENT !== "test")` 返回 503。
  - `workers/orchestrator-core/src/auth.ts:146-152`：允许 `claimTenant` 与 `deployTenant` 同时缺失，此时 `effectiveTenant` 为 `undefined`，仍能通过 auth。
- **为什么重要**：
  - 如果 `TEAM_UUID` 未配置（非 test 环境），worker 在 auth 之前就会返回 503，导致 auth 中的宽松 tenant 逻辑实际上 unreachable。如果意图是 "非 test 必须配 TEAM_UUID"，则 auth 中的 fallback 逻辑是 dead code；如果意图是 "允许纯 JWT claim 驱动 tenant"，则 `ensureTenantConfigured` 过于严格。
- **审查判断**：
  - 逻辑不一致，但当前行为有明确偏向（强制配 TEAM_UUID）。属于 low priority 的语义对齐问题。
- **建议修法**：
  - 明确统一 tenant 策略：要么删除 `ensureTenantConfigured` 让 auth 统一处理（推荐，因为 auth 已经处理了 claim/deploy mismatch），要么在 auth 中拒绝无 tenant 的 JWT（如果业务要求必须绑定 tenant）。

---

## 3. In-Scope 逐项对齐审核

### F0 — Concrete Freeze Pack

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 审计 charter / design / qna 一致性 | `done` | 8 份 design docs、FX-qna、charter 之间未发现自相矛盾。 |
| S2 | 明确区分 owner-level blocker 与 implementation follow-up | `done` | `503 vs throw`、URL 组装、partial replay 已正确降级。 |
| S3 | F1-F5 进入条件与交付物清单化 | `done` | 6 份 action-plan 已形成连续执行链。 |
| S4 | 产出 F0-closure.md | `done` | closure 文件存在，内容完整，F1 已解锁。 |

### F1 — Bring-up and First Roundtrip

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 新建 orchestrator-core worker shell | `done` | package/wrangler/src/tests 齐备，workspace 已纳管。 |
| S2 | public start ingress | `done` | `POST /sessions/:id/start` 由 orchestrator 接住并路由到 user DO。 |
| S3 | agent-core `/internal/*` 最小集 + secret gate | `done` | 四条 path 存在，401 typed 错误真实执行。 |
| S4 | first event NDJSON relay | `done` | `readNdjsonFrames` + `forwardFramesToAttachment` 链路存在，probe 与 live e2e 通过。 |

### F2 — Session Seam Completion

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | lifecycle / registry / retention | `done` | `SessionEntry` 状态流转、`24h+100` lazy cleanup、ended index 均落地。 |
| S2 | public route family completion | `done` | `input/cancel/status/timeline/verify` 全部经 façade 路由。 |
| S3 | WS attach / reconnect / supersede | `done` | single active writable attachment 成立，supersede 顺序正确。 |
| S4 | cursor / terminal / missing | `partial` | `session_terminal` / `session_missing` 的 WS attach rejection 已落地，但 completed/error 不映射到 ended（见 R3），且 cursor 对 terminal 的计入语义偏离设计（见 R2）。 |

### 3.1 对齐结论

- **done**: `11`
- **partial**: `1`
- **missing**: `0`

> F2 的 S4 更像 "核心骨架完成，但 terminal->lifecycle 的完整映射与 cursor 语义仍未完全收口"，而不是 completed。需要以 follow-up 形式在 F3 前补齐。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | multi-writer / read-only mirror | `遵守` | 代码中仅支持单 attachment，无 multi-writer 逻辑。 |
| O2 | partial replay / richer replay protocol | `遵守` | 无 replay 实现，cursor 仅用于 reconnect 的单一 resume 点。 |
| O3 | full history archive / SQLite | `遵守` | 未引入 SQLite，retention 使用 DO storage key-value 实现。 |
| O4 | F3 canonical cutover / legacy deprecation | `遵守` | 未在 F2 中提前实现 410/426 的 legacy 退役。 |
| O5 | F0 偷渡实现工作 | `遵守` | F0 无代码新增，仅文档冻结。 |
| O6 | CICP / RAG / db_do.ts | `遵守` | 未在 orchestrator-core 中出现 contexter 的协议层或数据库层。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：F0~F2 的主体交付已成立，文档冻结完整，代码骨架真实存在，live e2e 证据成立。但实现层存在 3 项偏离 frozen design 的细节（R1 类型校验缺失、R2 cursor 语义偏离、R3 completed/error ended 映射缺失）和 2 项工程整洁度问题（R4 live 测试缺口、R5 signJwt 位置、R6 tenant 逻辑不一致）。这些不应作为 F2 的 reopen blocker，但必须在 F3 前以 follow-up 形式修复或显式记录为已知限制。
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：
  1. 无。当前无 critical 级别问题，R3 虽标 high 但属于架构债务而非立即崩溃风险，且 F2 的 scope 边界内 "session.end richer semantics" 本就被 defer。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R1**：引入 StreamFrame 运行时类型校验（Zod 或手动 discriminator）。
  2. **R2**：对齐 cursor 与 terminal frame 的计入语义；若修改 design，需同步更新 `F0-stream-relay-mechanism.md`。
  3. **R3**：在 `handleStart` / `handleInput` 中检测 `terminal: completed|error` 并迁移 lifecycle 到 `ended`，补全 retention 清理路径；若需 deferred，应在代码中显式 TODO 并纳入 F3 action-plan。
  4. **R4**：补齐 `terminal` / `missing` reconnect 的 live e2e 用例。
  5. **R5**：将 `signJwt` 移出生产代码路径。
  6. **R6**：统一 `ensureTenantConfigured` 与 `authenticateRequest` 的 tenant 策略。

---

## 8. 对 Kimi 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-24`
> 评价依据: `workers/orchestrator-core/src/{auth,user-do}.ts`, `test/package-e2e/orchestrator-core/{04-reconnect,05-verify-status-timeline}.test.mjs`, `docs/design/orchestration-facade/F0-stream-relay-mechanism.md`

### 8.1 一句话评价
Kimi 这轮 review 偏“工程卫生 + 可测试性”取向，能抓到直接可落地的小中型缺口，落地价值很高。

### 8.2 优点
1. 准确抓到了 `readNdjsonFrames` 缺少运行时校验、`signJwt` 混入生产路径、reconnect live taxonomy 证据不全，这三条都直接可修且修完收益明确。
2. 对 cursor 语义与 design 不一致的提醒很有用，逼着文档与 shipped semantics 重新对齐。

### 8.3 事实确认 - 审核文档中，所有真实存在的问题
1. StreamFrame 运行时校验缺失确实存在。
2. reconnect 的 live e2e 之前确实只覆盖 success，没有 terminal/missing。
3. `signJwt` 之前确实只为测试服务，却留在生产 `auth.ts` 中。
4. verify negative 断言之前确实偏弱，没锁住 supported checks。

### 8.4 事实错误 - 审核文档中，所有的事实错误
1. R3 把 `completed/error` 未迁移到 `ended` 定性为当前 correctness bug 过重；在现有 session model 下，turn 完成并不等于 session 结束，强迁移会误杀可继续 follow-up 的 session。
2. R6 把 tenant 宽松度不一致当成现时逻辑缺陷也偏重；非 test 环境下 `ensureTenantConfigured` 已先行收口，当前生产路径没有真实分叉。

---
以上内容均不局限于只有2个，如果多个请一一列举。
---

### 8.5 评分 - 总体 ** 4.5 / 5** 

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 4 | 证据足够支撑工程修复，但架构上下文展开略少。 |
| 判断严谨性 | 4 | 大部分 finding 成立，session-ended 那条偏重。 |
| 修法建议可执行性 | 5 | runtime validation、test gap、helper 抽离都很容易直接落地。 |
| 对 action-plan / design 的忠实度 | 5 | 能够抓出 design 与 shipped semantics 的偏差。 |
| 协作友好度 | 5 | 建议清楚、工程上可直接执行。 |
