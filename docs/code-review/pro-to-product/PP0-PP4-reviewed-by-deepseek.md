# Nano-Agent 代码审查

> 审查对象: `pro-to-product / PP0-PP4（Charter & Truth Lock → Hook Delivery Closure）`
> 审查类型: `closure-review + code-review + docs-review`
> 审查时间: `2026-05-03`
> 审查人: `DeepSeek`
> 审查范围:
> - `docs/issue/pro-to-product/PP0-closure.md` 至 `PP4-closure.md`
> - `docs/action-plan/pro-to-product/PP0-*.md` 至 `PP4-*.md`
> - `docs/design/pro-to-product/00-*.md` 至 `05-*.md`
> - `workers/agent-core/src/host/` 全部改动文件
> - `workers/orchestrator-core/src/` 全部改动文件
> - `workers/orchestrator-core/src/facade/routes/` 新增与改动路由
> - `packages/nacp-session/src/` schema/message registry 全部改动
> - `clients/api-docs/` 22-doc pack 对账审计
> - `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs`
> - `workers/agent-core/src/hooks/` 全部 20 个文件
> 对照真相:
> - `docs/charter/plan-pro-to-product.md`（charter §1-§15，含 7 truth gates、Phase 边界、退出条件）
> - `docs/design/pro-to-product/PPX-qna.md` Q1-Q22（业主已全部回填的 22 项冻结决策）
> - `docs/design/pro-to-product/00-agent-loop-truth-model.md`
> - `docs/design/pro-to-product/01-frontend-trust-contract.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

> `PP0-PP4 的主体实现成立，closures 对 readiness 的诚实标注是正确姿态。但存在 3 项需要在 final closure 前收口的 high-severity 断点，以及 4 项 mid-severity 命名/文档漂移。P0-PP4 当前不应以 full-close 形态收口，应以 close-with-known-issues 进入 PP5-PP6，并在 PP6 final closure 中逐一消账。`

- **整体判断**：`PP0-PP4 主线实现主体成立，closures 诚实标注了 first-wave / minimal / not-claimed 状态，未 overclaim。但确认 decision 双写失败恢复缺失、compact breaker 冷却语义未兑现、hooks 缺乏独立 docs 文件构成 3 项 high blocker，阻止 full-close。`
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`（PP0-PP4 主体闭合可按当前 closure 签字进入 PP5，但需在 PP6 final closure 中将下述 R1-R10 逐项消账或显式 accept-degrade）
- **本轮最关键的 3 个判断**：
  1. `confirmation decision 双写路径（D1 row committed + agent-core wakeup failed）无恢复机制，已写 terminal 的 row 阻止前端重试，agent 未收到通知，形成静默状态不一致。`
  2. `compact breaker 的 "7-min cool-down" 仅停留在注释（runtime-assembly.ts:479），实际实现只有 failure count 无时间分量，长 session 中 breaker 可能永久关闭 compact。`
  3. `clients/api-docs 缺少独立 hooks.md，hooks 作为 first-class surface 仅以 ~35 行 inline 写在 session.md §15.1，与 todos/confirmations/runtime 等独立 docs 的深度不对等。`

---

## 1. 审查方法与已核实事实

> 本节只写事实，不写结论。

- **对照文档**：
  - `docs/charter/plan-pro-to-product.md`（7 truth gates、Phase 职责矩阵、收口标准、not-成功的退出识别）
  - `docs/design/pro-to-product/PPX-qna.md` Q1-Q22（业主已全部回填）
  - `docs/design/pro-to-product/00-agent-loop-truth-model.md` 至 `05-hook-delivery-closure.md`
  - `docs/action-plan/pro-to-product/PP0-*.md` 至 `PP4-*.md`
- **核查实现**：
  - `workers/agent-core/src/host/runtime-mainline.ts`（558 行，注：原 charter 引用的 line 835-840 号已因 PP1/PP2 refactor 移位至 runtime-capability.ts 与 runtime-assembly.ts）
  - `workers/agent-core/src/host/runtime-capability.ts`（557 行，含 `authorizeToolPlan` ask/approval 完整路径）
  - `workers/agent-core/src/host/do/session-do-runtime.ts` → 已拆至 `session-do-confirmation.ts`（146 行，permission/elicitation 请求+await+timeout settle）
  - `workers/agent-core/src/host/do/session-do-persistence.ts`（393 行，含 `awaitAsyncAnswer`/`recordAsyncAnswer`/`sweepDeferredAnswers`）
  - `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`（含 `buildRuntimeCompactMutation` + `requestCompact` bridge + `createLiveKernelRunner` 对 HookDispatcher 的注入）
  - `workers/agent-core/src/host/compact-breaker.ts`（56 行，纯 counter 无 timer）
  - `workers/agent-core/src/kernel/runner.ts`（含 `handleCompact` 完整逻辑：tokensBefore=session.total → requestCompact → degraded/complete_turn）
  - `workers/agent-core/src/kernel/reducer.ts`（`compact_done` 真替换 activeTurn.messages）
  - `workers/agent-core/src/hooks/` 全部 20 个文件（catalog/dispatcher/snapshot/outcome/audit/session-registration/session-mapping/local-ts-runtime/permission/guards/matcher/core-mapping/registry/types/service-binding-runtime）
  - `workers/agent-core/src/host/do/session-do-hooks.ts`（session hook register/unregister/list/persist RPC）
  - `workers/orchestrator-core/src/entrypoint.ts`（588 行，含 `emitterRowCreateBestEffort` row-first 纪律）
  - `workers/orchestrator-core/src/confirmation-control-plane.ts`（293 行，7-kind/6-status CHECK 约束 + `markSupersededOnDualWriteFailure` 定义但未调用）
  - `workers/orchestrator-core/src/facade/routes/session-confirmations.ts`（270 行，含 `wakeAgentConfirmationWaiter` + 503 返回路径）
  - `workers/orchestrator-core/src/facade/routes/session-runtime.ts`（PATCH 改用 `emitFrameViaUserDOAndWait` awaited 推送）
  - `workers/orchestrator-core/src/facade/routes/session-hooks.ts`（hook 控制面 HTTP 路由）
  - `workers/orchestrator-core/src/wsemit.ts`（新增 `emitFrameViaUserDOAndWait`，fire-and-forget 端口无错误日志）
  - `workers/orchestrator-core/src/user-do/ws-runtime.ts`（`session.replay.lost` 帧发射 + single attachment supersede 行为）
  - `workers/orchestrator-core/src/context-control-plane.ts`（compact boundary durable write 使用 `snapshot_kind='compact-boundary'` / `checkpoint_kind='compact_boundary'`）
  - `packages/nacp-session/src/replay.ts`（`NACP_REPLAY_OUT_OF_RANGE` 仍 throw，由上层 ws-runtime.ts 处理）
  - `packages/nacp-session/src/messages.ts`（`session.replay.lost` body schema 注册完整）
  - `packages/nacp-session/src/session-registry.ts`（`session.replay.lost` 出现在 role/phase/type-direction 全部 5 个注册表）
- **执行过的验证**：
  - 逐文件代码行号核查（agent-core `runtime-capability.ts:95-174`、`runtime-capability.ts:190-258`；orchestrator-core `session-confirmations.ts:59-131,243-257`、`entrypoint.ts:71-126,540-548`；compact-breaker.ts:18-37；reducer.ts:271-292；ws-runtime.ts:145-174；等等）
  - confirmations docs 7-kind×6-status 与代码 `confirmation-control-plane.ts:21-41` 逐项对账
  - nacp-session schema 全注册表逐 registry 对账（`session.replay.lost` 在 body schema / message types / role requirements / phase matrix / type-direction matrix / frame-compat 共 6 个 registry 均已注册）
  - clients/api-docs 22-doc pack 中 7 份核心 docs 逐条对账
  - PP0 skeleton test 代码逐行核查
- **复用 / 对照的既有审查**：
  - `PP1-closure.md` §4 登记了 "Independent PP1 code review" 与 "Independent PP1 fix review" — **本轮独立复核**，不依赖该结论，自行核查全部代码路径
  - `PP2-closure.md` §4 登记了 "Independent PP2 code review" 与 "Independent PP2 fix review" — **本轮独立复核**
  - `PP3-closure.md` §5 登记了 "Independent PP3 code review" 与 "Independent PP3 parity review" — **本轮独立复核**
  - `PP4-closure.md` §5 登记了 "Independent PP4 code review" 与 "Independent PP4 fix review" — **本轮独立复核**

### 1.1 已确认的正面事实

- `approval_policy=ask` 在 `runtime-capability.ts:113-133` 已真进入 `requestToolPermission` 阻塞 await，不再返回 `tool-permission-required` error
- compact no-op `{ tokensFreed: 0 }` 已真替换：`runner.ts:377-401` 的 degraded 路径通过 `complete_turn` 终结 turn，`reducer.ts:284-290` 的 `compact_done` 真替换 `activeTurn.messages`
- `session.replay.lost` 帧已完成 6 个 registry 的完整 nacp-session 注册（body schema / message types / role requirements / phase matrix / type-direction matrix / frame-compat）
- helper replay restore 对称性已成立：`persistCheckpoint` 写 `helper.checkpoint(helperStorage)`（persistence.ts:155-160），`restoreFromStorage` 恢复 `helper.restore(helperStorage)`（persistence.ts:207-211）
- PreToolUse hook loop 真闭合：register → emit → outcome → `hook.broadcast`（frontend visible）+ `hook.outcome` audit（audit visible），全部在 `runtime-capability.ts:190-258` + `runtime-assembly.ts:411-459` 中完成
- PermissionRequest 零 handler 时 `verdictOf()` 返回 `"deny"`、reason 为 `"no-handler-fail-closed"`，符合 Q17 业主拍板的 fail-closed 语义
- PP4 hook scope 三重硬闸存在且有效：`session-registration.ts:102-111` 限制 event=PreToolUse、runtime=local-ts、source=session
- `clients/api-docs/context.md` honest 标注 `auto-compact = first-wave`、`LLM summary = not-claimed`、`circuit breaker = not-enforced`，无 fake-live claims
- `clients/api-docs/confirmations.md` 7-kind×6-status 与代码完全一致，readiness matrix 诚实标注 5/7 为 registry-only

### 1.2 已确认的负面事实

- `session-confirmations.ts:250-256` 在 `applyDecision` (D1 row committed) 成功后、`wakeAgentConfirmationWaiter` 失败时返回 503，但 **未调用** `confirmation-control-plane.ts:271-292` 中已定义的 `markSupersededOnDualWriteFailure()` 方法。row 保持已写 terminal 状态（如 `"allowed"`），前端因 `conflict` guard（`confirmation-control-plane.ts:231-238`）无法用相同 status 重试，agent 未收到通知，形成静默状态不一致。
- `compact-breaker.ts:18-37` 仅 tracking `failures` counter，无时间分量。`runtime-assembly.ts:479` 注释写 "7-min cool-down" 但代码未实现。breaker 在 `canCompact()` 返回 `false` 后除非调用 `recordSuccess()` 否则永不恢复——但 `recordSuccess()` 只在 compact 成功后被调，而 breaker 打开后 compact 不再触发，无法成功 → breaker 永久关闭。
- `clients/api-docs` 无独立 `hooks.md` 文件。hook 文档仅以 `session.md` §15.1 的 ~35 行存在，缺少与 todos.md / confirmations.md / runtime.md 对等的独立 canonical reference。
- `runtime-capability.ts:140` 与 `entrypoint.ts:146` 使用了 `"always_allow"` 字符串，但该值不在 frozen `CONFIRMATION_STATUSES`（6 个 terminal: `allowed/denied/modified/timeout/superseded` + 1 个非 terminal: `pending`）中，属于未文档化的 legacy 残留。
- `session-confirmations.ts:81` 对 `tool_permission` 的 wakeup 映射 `decision: input.status === "allowed" ? "allow" : "deny"` — 将 `"modified"` 状态映射为 `"deny"` 传给 agent。语义失配：`"modified"` 通常表示"允许但修改参数"，不应等同 `"deny"`。
- `clients/api-docs/session-ws-v1.md` 记录 `session.attachment.superseded` reason 为 `{reattach, revoked}`，但 nacp-session schema `messages.ts:102` 实际 enum 为 `["device-conflict", "reattach", "revoked", "policy"]`，缺少 2 个有效 reason。
- `clients/api-docs/session.md` 记录 `session.end` reason 为 `{completed, cancelled, error}`，但 schema `messages.ts:69` 实际 enum 含 `timeout`，缺失该 reason。
- `wsemit.ts:83-86` fire-and-forget 路径 `void forwardFrameToUserDO(...)` 吞掉所有错误且无 log，User DO binding missing / network failure 时 frames 静默丢失。
- `session-runtime.ts:244-265` 使用 `emitFrameViaUserDOAndWait` awaited 推送 `session.runtime.update`，但 `delivered` 结果被忽略——HTTP 始终返回 200，WS delivery 失败对 caller 不可见。
- PP0 skeleton test (`16-pro-to-product-baseline-skeleton.test.mjs:168-171`) PATCH 请求使用 `headers: jsonHeaders`，未发送 `If-Match` ETag header，test 未实际覆盖 optimistic concurrency 路径。
- `confirmation-control-plane.ts:92-94` 的 `isKnownKind` type-narrowing helper 仅在此类内部使用，未被任何外部 consumer 调用——属于 dead code。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 全部 finding 均附精确文件:行号，基于实际代码阅读 |
| 本地命令 / 测试 | no | 本轮未在本地运行测试或构建命令 |
| schema / contract 反向校验 | yes | nacp-session schema 全部 6 个 registry 逐项与代码/closure/docs 对账 |
| live / deploy / preview 证据 | no | 依赖 PP0 closure 登记的 live evidence，未自行执行 preview 部署 |
| 与上游 design / QNA 对账 | yes | 22 项 QNA 决策与代码实现逐项对照 |

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`。

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | confirmation decision 双写失败静默状态不一致 | high | correctness | yes | PP5 或 PP6 前修复，调用 `markSupersededOnDualWriteFailure` 或在 wakeup 失败时回滚 row |
| R2 | compact breaker 缺失时间冷却，"7-min cool-down" 仅注释未实现 | high | delivery-gap | yes | PP5 实现含时间分量的 breaker 或在 closure 中显式 accept-degrade |
| R3 | `clients/api-docs` 缺失独立 `hooks.md` | high | docs-gap | yes | PP6 final closure 前创建 `hooks.md` 并完成 full docs sweep |
| R4 | `"modified"` confirmation decision 被映射为 `"deny"` 传给 agent | medium | correctness | no | PP5 明确 `"modified"` 语义：若表示 "allow + modified params"，则应映射为 `"allow"` 或新增独立分支 |
| R5 | `"always_allow"` 字符串未纳入 frozen `CONFIRMATION_STATUSES` | medium | naming-contract | no | PP5/PP6 统一清理或显式 register 为 legacy compat 标记 |
| R6 | `session.attachment.superseded` reason enum docs 缺少 2 项 | medium | docs-gap | no | PP6 docs sweep 同步至 `session-ws-v1.md` |
| R7 | `session.end` reason missing `timeout` in docs | medium | docs-gap | no | PP6 docs sweep 同步至 `session.md` 与 `session-ws-v1.md` |
| R8 | wsemit fire-and-forget 路径静默丢帧无日志 | medium | platform-fitness | no | PP5 reliability hardening 中最低加 warn-level log |
| R9 | PP0 skeleton test 未发送 `If-Match` 未覆盖 optimistic concurrency | low | test-gap | no | PP0/PP6 补充 ETag 路径覆盖 |
| R10 | `isKnownKind` dead code in confirmation-control-plane.ts | low | docs-gap | no | 移除或显式 register 为 future-use seam |

### R1. confirmation decision 双写失败静默状态不一致

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`
- **事实依据**：
  - `session-confirmations.ts:243-257`：`wakeAgentConfirmationWaiter()` 返回 `{ ok: false }` 时直接返回 503，未对已 commit 的 D1 row 做任何回滚或标记
  - `confirmation-control-plane.ts:271-292`：`markSupersededOnDualWriteFailure()` 专为此场景设计——将已 commit 的 row 改写为 `status: "superseded"` 并记录 `attempted_status` / `failure_reason`——但未被调用
  - `confirmation-control-plane.ts:221-262`：`applyDecision()` 已 commit D1 row（line 212）；`confirmation-control-plane.ts:231-238`：如果 caller 再次提交相同 status，返回 `conflict`（409）
- **为什么重要**：
  - row 已写 terminal 状态（如 `"allowed"`），但 agent 未收到通知 → 前端看到 "已允许"，agent 持续 await timeout
  - 前端无法重试（409 conflict guard），agent 只能等到 timeout settle → 用户体验劣化
  - 该 gap 在 PP1 closure §2 登记为 "HTTP decision success-shaped wakeup 断点（已修复）"，但修复的只是 200-伪装问题，未修复恢复路径
- **审查判断**：
  - `markSupersededOnDualWriteFailure` 已定义、文档齐全、设计意图明确，属于"有工具未使用"的实现疏忽
  - PP1 closure 未提及此项作为 known issue，但本轮确认其为事实存在
- **建议修法**：
  - 在 `session-confirmations.ts:250-256` 调用 `plane.markSupersededOnDualWriteFailure()` 后再返回 503
  - 或改为 `try { applyDecision(); wake(); } catch { rollback row to pending or mark superseded; }` 的事务化路径
  - 将此项登记进 PP1 或 PP5 closure 的 known issues，在 PP6 final closure 前消账

### R2. compact breaker 缺失时间冷却

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `compact-breaker.ts:18-37`：仅 tracking `failures` counter，`canCompact()` = `failures < threshold`，`recordSuccess()` = `failures = 0`
  - `runtime-assembly.ts:479`：注释写 "7-min cool-down" 但 `createCompactBreaker(3)` 的实现无任何时间分量
  - `runtime-assembly.ts:488`：`composeCompactSignalProbe()` 中 `breaker.canCompact()` 先于 budget 检查，若返回 `false` 则 `compactRequired` 恒为 `false`
- **为什么重要**：
  - breaker 打开后，唯一恢复路径是 `recordSuccess()`，但该函数只在 compact 成功后调用
  - breaker 打开 → `canCompact()` 返回 `false` → `compactRequired` 恒 `false` → compact 永不触发 → `recordSuccess()` 永不调用 → breaker 永久关闭
  - 长 session 中若连续 3 次 compact 因 transient reason（如 bridge 暂时 unavailable）失败后，后续真正的 context overflow 无法触发 compact
- **审查判断**：
  - PP2 closure §6 登记 "Compact 失败 3 次 circuit breaker 仍未 enforcement；此项进入 PP5 reliability hardening"——**但当前现状比 "未 enforcement" 更严重**：breaker 只有 counter 无时间分量，一打开就再也关不上
  - 这不是 "PP5 补齐 enforcement" 的问题，而是在 PP5 之前 compact 能力已经自锁
- **建议修法**：
  - 优先方案：在 `canCompact()` 中加时间检查，超过 N 分钟后自动 reset
  - 备选方案：将注释中的 "7-min cool-down" 改为 `windowSize` 记录首次失败时间，`canCompact()` 返回 `failures < threshold || elapsed > cooldownMs`
  - 短期：PP2/PP5 closure 显式登记此缺口的影响范围（长 session 中 compact 可能永久不可用），并注明 PP5 修复

### R3. `clients/api-docs` 缺失独立 `hooks.md`

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `clients/api-docs/` 当前 22 个文件中无 `hooks.md`
  - hooks route (`GET/POST/DELETE /sessions/{id}/hooks`) 在 README endpoint matrix 中列出（`README.md:160-162`），但 docs index 未登记对应 doc 文件
  - hook 文档仅以 ~35 行 inline 于 `session.md` §15.1，缺少 request/response shapes、error codes、handler lifecycle semantics、`hook.broadcast` WS frame payload reference、scope limitations 等独立 docs 应有的深度
- **为什么重要**：
  - todos / confirmations / runtime / context / items / tool-calls / checkpoints / workspace 等 first-class surface 均有独立 docs 文件；hooks 作为 PP4 核心交付的 minimal live loop，缺乏对等深度的 canonical reference
  - PP6 的 item-by-item docs sweep 必须有一个 `hooks.md` 才能做前端可靠的 contract 对账
- **审查判断**：
  - 这不是 PP4 实现缺陷（session.md §15.1 的描述准确），而是 PP0-PP4 范围内未能完成的 docs handoff 项
  - 按 charter §13.1 docs 清单，PP4 的交付物不含新增 `clients/api-docs` 文件——但这恰说明 docs 规划遗漏了 hooks
- **建议修法**：
  - PP6 前创建 `clients/api-docs/hooks.md`，覆盖：route shapes、handler lifecycle、`hook.broadcast` frame payload、scope 限制、error codes、readiness label
  - PP6 docs sweep 将此项作为强制性内容

### R4. `"modified"` confirmation decision 被映射为 `"deny"`

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `session-confirmations.ts:81`：`decision: input.status === "allowed" ? "allow" : "deny"`
  - `CONFIRMATION_STATUSES`（6 个 terminal）含 `"modified"`，在上述映射中落入 `"deny"` 分支
- **为什么重要**：
  - `"modified"` 的通常语义是 "allow with modified parameters" 而非 "deny"
  - `decision_payload` 会透传（line 86），agent 理论可从中推断真实意图，但 top-level `decision: "deny"` 给 agent 的 signal 是明确的拒绝
- **审查判断**：
  - 当前 `"modified"` 仅在 `tool_permission` wakeup path 有这个问题；`elicitation` path（line 106）只用 `timeout/superseded/denied` 判定 `cancelled`，不映射 `"modified"`
  - 由于 `"modified"` 实际使用场景取决于前端实现，且 `decision_payload` 透传，暂不构成 correctness blocker
- **建议修法**：
  - 在 PP5 中明确 `"modified"` 对 `tool_permission` 的语义：是 `"allow"` 还是新增 `"modified"` 分支
  - 同步更新 docs 中 `"modified"` 状态的语义说明

### R5. `"always_allow"` legacy string 未纳入 frozen contract

- **严重级别**：`medium`
- **类型**：`naming-contract`
- **是否 blocker**：`no`
- **事实依据**：
  - `runtime-capability.ts:140`：`legacyDecision === "always_allow"` 被视为 `allowed`
  - `entrypoint.ts:146`：`runtimePolicyFallback()` 中 `"always_allow"` → `"allow"`
  - Frozen `CONFIRMATION_STATUSES` 只有 7 个值（`pending/allowed/denied/modified/timeout/superseded` + 1 non-terminal），不含 `"always_allow"`
- **为什么重要**：
  - 如果 `"always_allow"` 只存在于 runtime `approval_policy` 字段（`auto-allow/always_allow/deny/ask` 4 选 1），则与 `confirmation_kind` 的 status 不属同一 enum，不应混淆
  - 但 `runtime-capability.ts:140` 将其写入 `confirmation decision` 的判断逻辑，使其事实参与 confirmation status 比较——这构成了 schema drift
- **审查判断**：
  - `"always_allow"` 是 `approval_policy` enum 的合法值（runtime.md docs 确认），但其不应作为 `confirmation decision status` 出现在 status 比较路径中
  - `runtimePolicyFallback()` 将其映射为 `"allow"` 是正确的，但 `runtime-capability.ts:140` 保留此 legacy guard 造成了混乱
- **建议修法**：
  - 移除 `runtime-capability.ts:140` 的 `legacyDecision === "always_allow"` guard，将 `"always_allow"` → `"allow"` 的映射收敛到 `runtimePolicyFallback()` 单一层级

### R6. `session.attachment.superseded` reason enum docs 漂移

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - docs（`session-ws-v1.md:213`）：`reason ∈ {reattach, revoked}`
  - schema（`messages.ts:102`）：`reason: z.enum(["device-conflict", "reattach", "revoked", "policy"])`
- **审查判断**：`device-conflict` 与 `policy` 在 ws-runtime.ts 的实际 emit 路径中存在（`ws-runtime.ts:333-371` device-revoke 路径），docs 漏写
- **建议修法**：PP6 docs sweep 同步至 `session-ws-v1.md`

### R7. `session.end` reason 缺失 `timeout`

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - docs（`session-ws-v1.md:243-248`、`session.md` 对应段）：implied 3 reasons
  - schema（`messages.ts:69`）：`reason: z.enum(["user", "timeout", "error", "completed"])`
- **审查判断**：`timeout` 在 schema 中存在但 docs 未记录
- **建议修法**：PP6 docs sweep 同步至 `session-ws-v1.md` 与 `session.md`

### R8. wsemit fire-and-forget 路径静默丢帧

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `wsemit.ts:83-86`：`void forwardFrameToUserDO(...)` 无 .catch log
  - 若 `ORCHESTRATOR_USER_DO` binding missing 或 network failure，frames 静默丢失且无从观测
- **审查判断**：stream event 高频路径中 fire-and-forget 是合理设计选择，但最小应记录 warn-level log 供 ops 感知
- **建议修法**：PP5 reliability hardening 中加 `void forwardFrameToUserDO(...).catch(e => console.warn(...))`

### R9. PP0 skeleton test 未覆盖 optimistic concurrency

- **严重级别**：`low`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `16-pro-to-product-baseline-skeleton.test.mjs:168-171`：PATCH 使用 `headers: jsonHeaders`，未发送 `If-Match`
  - `session-runtime.ts:204-207`：PATCH handler 检查 `If-Match` header，但 test 仅依赖 body `version` 字段
- **审查判断**：test 覆盖了 HTTP control path、WS event path、durable read-model path，但 ETag 乐观锁路径未覆盖
- **建议修法**：PP6 前补充 ETag/409-conflict 路径的 test 覆盖，或显式登记为 low-priority known gap

### R10. `isKnownKind` dead code

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `confirmation-control-plane.ts:92-94`：`isKnownKind` type-narrowing helper
  - 仅在此类内部使用，不被任何外部 consumer 调用
- **审查判断**：非功能性缺陷，但 clean code 原则建议移除或注册为 future-use seam
- **建议修法**：移除或显式保留并标注 `@future-use`

---

## 3. In-Scope 逐项对齐审核

### 3.1 Charter §7 / §10 主线对齐

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | PP0: truth lock + frontend boundary + e2e skeleton | `done` | 7 truth gates 已冻结于 charter §10 + PPX-qna；frontend boundary 冻结于 01-design；首个 skeleton live evidence 成立（PP0-closure §2） |
| S2 | PP1: `approval_policy=ask` → pause-resume（charter T1） | `partial` | ask 真进入 HITL await（runtime-capability.ts:113-133），allow/deny/timeout 三态有证据。但 R1（dual-write failure gap）使 HITL 在极端条件下不可信 |
| S3 | PP1: confirmation 7-kind freeze（Q8） | `done` | 7-kind 保持在 `confirmation-control-plane.ts:21-29`，PP1 未扩展 kind |
| S4 | PP1: decision HTTP input（Q7） | `done` | WS 只承担 server→client 广播，HTTP POST 承担 decision 输入，方向矩阵确认 |
| S5 | PP2: compact 真执行 → prompt mutation（charter T2） | `done` | no-op 已替换为 deterministic summary + prompt mutation（reducer.ts:284-290）；compact boundary durable write 使用正确 snapshot_kind/checkpoint_kind |
| S6 | PP2: 不新增 D1 compact jobs 表（Q9） | `done` | 复用 checkpoint/compact lineage，`snapshot_kind='compact-boundary'` / `checkpoint_kind='compact_boundary'` |
| S7 | PP2: auto compact 不标 live（Q10） | `done` | PP2 closure 标注 `first-wave`，context.md 标注 `first-wave / not-live`，诚实 |
| S8 | PP2: 不以 LLM summary 为前提（Q11） | `done` | PP2 closure 显式写着 `not-claimed`，使用 deterministic summary |
| S9 | PP3: replay gap → explicit degraded（charter T3, Q14） | `done` | `session.replay.lost` 帧在 WS attach 时优先发出（ws-runtime.ts:145-174），HTTP resume 返回 `replay_lost_detail` |
| S10 | PP3: helper replay restore 对称（charter T3 partial） | `done` | `persistCheckpoint` 写 helper（persistence.ts:155-160），`restoreFromStorage` 恢复 helper（persistence.ts:207-211） |
| S11 | PP3: single attachment + supersede（Q13） | `done` | ws-runtime.ts 维持 single attachment model + supersede 行为 |
| S12 | PP3: best-effort replay 不承诺 exactly-once（Q12） | `done` | replay-gap 显式 degraded，不 silent fallback |
| S13 | PP4: PreToolUse minimal live loop（charter T5, Q15） | `done` | register → emit → outcome → `hook.broadcast` + `hook.outcome` audit 全线闭合 |
| S14 | PP4: worker-safe declarative local-ts（Q16） | `done` | `session-registration.ts:105-108` 硬闸 local-ts，禁止 shell hook |
| S15 | PP4: PermissionRequest fail-closed（Q17） | `done` | `verdictOf()` 零 handler → `"deny"`，reason `"no-handler-fail-closed"`（hooks/permission.ts:50-58） |
| S16 | PP4: 不扩 full catalog | `done` | 仅 PreToolUse live，PostToolUse/PermissionRequest 等 17 类 catalog-only |

### 3.2 Charter §4.4 硬纪律对齐

| 编号 | 硬纪律 | 审查结论 | 说明 |
|------|--------|----------|------|
| S17 | 没有 live caller + e2e 证据不能宣称闭合 | `honest` | PP1-PP4 closures 均写 `not-claimed` 关于 live preview e2e，证据为 worker targeted tests + integration tests |
| S18 | 默认不新增 D1 migration，不新增 worker，不重写 topology | `done` | PP0-PP4 未新增 D1 表、未新增 worker、未改 6-worker topology |
| S19 | 每个 Phase closure 以 truth gate 为对账单 | `done` | PP1-PP4 closures 均引用 truth gate 判定，未以文档产量替代 |
| S20 | batch review 不逐文档 review 链 | `done` | 本轮审查覆盖 PP0-PP4 共 4 个 phase，为 batch review |

### 3.3 Phase 间交接守则对齐

| 编号 | Phase 间交接守则 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S21 | PP0 不抢 PP1-PP4 实现细节 | `done` | PP0 skeleton 仅为 evidence shape，未提前实现 HITL/compact/reconnect/hook |
| S22 | PP1 先提供 interrupt substrate，PP2/PP4 建立在它之上 | `done` | PP2 compact degraded 不会干扰 PP1 confirmation 路径，PP4 hook 复用了 PP1 的 session-do-runtime 框架 |
| S23 | PP3 不与 PP1 在同一 owner file 高频改动窗口重叠 | `done` | PP1 与 PP3 的 shared owner files（session-do-runtime.ts → 已拆至 session-do-confirmation.ts）由 PP1/PP2 拆分完毕，PP3 改动面与 PP1 分离 |
| S24 | D1 例外 law（charter §4.5） | `done` | PP0-PP4 未触发 D1 例外，新增 migration 编号无冲突 |

### 3.4 对齐结论

- **done**: `22`
- **partial**: `1`（S2 — HITL T1 因 dual-write gap 未能宣称 fully closed）
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

> PP0-PP4 的主体实现呈现 "核心骨架完成，但 1 项 correctness gap 阻止 T1 的 full-close，2 项 delivery/docs gap 阻止全线闭合" 的状态。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider routing | `遵守` | 未出现 provider abstraction 代码 |
| O2 | Sub-agent / multi-agent | `遵守` | 未出现 sub-agent 调度逻辑 |
| O3 | Admin plane / billing / SDK extraction | `遵守` | 未出现相关代码 |
| O4 | Full hook catalog（14/18 emit 全接通） | `遵守` | PP4 仅实现 PreToolUse minimal loop |
| O5 | Sandbox 隔离 / bash streaming progress | `遵守` | 未出现 sandbox 代码 |
| O6 | LLM-based summary | `遵守` | PP2 使用 deterministic summary，closure 明示 `not-claimed` |
| O7 | `context_compact` confirmation kind live wiring | `遵守` | 保持 registry-only，PP2 closure 明示未接入 HITL 主线 |
| O8 | `clients/api-docs` full sweep | `遵守` | PP2 仅做 `context.md` 最小同步，PP4 未做 docs sweep，均留给 PP6 |

> **结论**：PP0-PP4 严格遵守了 charter §4.2/§4.3 的 Out-of-Scope 边界与灰区判定，未越界实现 deferred 功能。

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`PP0-PP4 主体实现成立，closures 诚实标注了 readiness 状态。存在 3 项 high-severity 断点阻止 full-close，应在 PP5-PP6 中逐项消账。当前应以 close-with-known-issues 进入 PP5，并在 PP6 final closure 中完成全部 10 项 findings 的消账或显式 accept-degrade。`

- **是否允许关闭本轮 review**：`yes`（PP0-PP4 的 closure 签字可以保持，但 PP6 final closure 应对 R1-R10 逐项回填）

- **关闭前必须完成的 blocker**：
  1. `R1`（confirmation decision 双写失败恢复）：在 PP5 或 PP6 修复，确保 at-minimum 调用 `markSupersededOnDualWriteFailure()` 使 row 能从 terminal 回到 observable degraded
  2. `R2`（compact breaker 冷却）：在 PP5 reliability hardening 中实现含时间分量的 circuit breaker 或显式 accept 当前纯 counter 行为
  3. `R3`（hooks.md）：在 PP6 docs closure 前创建 `clients/api-docs/hooks.md` 并完成 full docs sweep

- **可以后续跟进的 non-blocking follow-up**：
  1. `R4`：明确 `"modified"` 对 `tool_permission` 的语义（PP5）
  2. `R5`：清理 `"always_allow"` legacy guard（PP5/PP6）
  3. `R6`/`R7`：docs enum 漂移同步（PP6 docs sweep）
  4. `R8`：wsemit fire-and-forget 加 log（PP5 reliability）
  5. `R9`：PP0 skeleton ETag 路径覆盖（PP0/PP6）
  6. `R10`：移除 `isKnownKind` dead code（PP6）

- **建议的二次审查方式**：`same reviewer rereview`（PP6 final closure 后对 full sweep 做终审）

- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

---

## 6. 交叉阶段深度分析

### 6.1 PP0-PP4 整体架构判断

经过 PP0-PP4 的逐层接线，nano-agent 的 agent loop backend 实现了以下关键转变：

| 维度 | PP0-PP4 前 | PP0-PP4 后 | 剩余 gap |
|------|-----------|-----------|----------|
| HITL | `ask` → error-out | `ask` → pause-resume + HTTP decision + timeout settle | dual-write failure 恢复缺失 (R1) |
| Context Budget | `compact` → `{ tokensFreed: 0 }` | compact → deterministic summary + prompt mutation + degraded contract | breaker 冷却缺失 (R2)、LLM summary 未实现 |
| Reconnect | replay out-of-range → throw | replay gap → explicit degraded + `session.replay.lost` frame + helper restore symmetry | live cross-e2e 未完成 |
| Hook | HookDispatcher 仅 injected substrate | PreToolUse → register → emit → block/updateInput → broadcast + audit loop | full catalog 未扩、hooks.md 缺失 (R3) |

### 6.2 Owner Files 拆分合理性

PP1/PP2/PP4 各自执行了 owner-file 拆分以维持 megafile budget：
- PP1/PP2 从 `runtime-mainline.ts` 拆出 `runtime-capability.ts`、从 `session-do-runtime.ts` 拆出 `session-do-confirmation.ts`
- PP4 从 `session-do-runtime.ts` 拆出 `session-do-hooks.ts`

各拆分文件的职责清晰、语义不漂移。验证结果：16 owner files within budget（PP2/PP4 closures 的 megafile-budget check 均 pass）。

### 6.3 Readiness Label 使用一致性

PP0-PP4 的 closures 与 clients/api-docs 对 readiness label 的使用趋势：

| 术语 | 使用位置 | 一致性 |
|------|----------|--------|
| `live` | PP0 skeleton verdict、`confirmations.md` tool_permission/elicitation | ✅ 一致 |
| `first-wave` | PP2/PP3 closure、`context.md` auto-compact | ✅ 一致 |
| `schema-live` | （未出现——good，比 `registry-only` 更诚实） | ✅ |
| `registry-only` | `confirmations.md` 5/7 kinds | ✅ 一致 |
| `not-enforced` | `context.md` circuit breaker | ✅ 一致 |
| `not-claimed` | PP1-PP4 closures 对 live e2e | ✅ 一致 |
| `closed-with-*` | PP2 `closed-with-first-wave-runtime-compact`、PP3 `closed-with-first-wave-reconnect-recovery`、PP4 `closed-with-pretooluse-minimal-live-loop` | ✅ type system 一致 |

**但在 charter §10 exit criteria T7（Frontend contract truth）层面**，当前 readiness label 的命名体系尚未完全线性化。charter §6.4 FE-3 要求 PP6 做 full integration review 时按真实 public surface 做 item-by-item 对账——这一步尚未发生。建议 PP6 在 docs sweep 时统一使用 4 选 1 标签集（依据 Opus 对 Q10 的补充建议）：`live / first-wave / schema-live / registry-only / not-enforced`，且不允许自由文本。

### 6.4 跨 Package 分析

`packages/nacp-session` 在 PP3 的改动中新增了 `session.replay.lost` frame 的完整注册，该注册覆盖：
- body schema（`messages.ts:110-120`）
- message types（`messages.ts:622`）
- role requirements — client consumes, session produces（`session-registry.ts:60,84`）
- phase matrix — attached/turn_running（`session-registry.ts:163,192`）
- type-direction matrix — delivery kind `["event"]`（`type-direction-matrix.ts:53`）
- frame compat（`frame-compat.ts:204-205`）

全链路注册无遗漏，与 docs 对账中发现的 R6/R7 是 docs 侧的单向漂移，不是 schema 侧漂移。

### 6.5 对后续 Phase 的进入条件评估

| Phase | 当前 start gate 满足度 | 风险评估 |
|------|----------------------|----------|
| PP5（Policy Honesty + Reliability Hardening） | ✅ 满足 | PP5 需要处理 R1/R2/R8 三个高/中 severity 断点；同时需要完成 Q18-Q20 的 policy decision |
| PP6（API Contract Sweep + Docs Closure + Final Closure） | ✅ 条件满足，但 docs gap 偏高 | 当前 docs 有 3+ 已知漂移项（R3/R6/R7），PP6 sweep 工作量将大于预期 |

---

## 7. 实现者回应入口

> `请按 docs/templates/code-review-respond.md 在本文档 §8 之后 append 回应，不要改写 §0–§7。`

---

## 8. 签字

`DeepSeek` — `2026-05-03` — `docs/code-review/pro-to-product/PP0-PP4-reviewed-by-deepseek.md`

---

## 附录 A. 详细代码位置索引

| Finding | 文件:行 | 代码片段（关键部分） |
|---------|---------|---------------------|
| R1 | `session-confirmations.ts:250-256` | `if (!wake.ok) { return jsonPolicyError(503, "internal-error", ...); }` — 未调用 `markSupersededOnDualWriteFailure` |
| R1 | `confirmation-control-plane.ts:271-292` | `async markSupersededOnDualWriteFailure(...)` — 已定义但未被调用 |
| R1 | `confirmation-control-plane.ts:231-238` | `if (CONFIRMATION_TERMINAL_STATUSES.has(existing.status)) return { row: existing, conflict: ... }` — retry guard |
| R2 | `compact-breaker.ts:18-37` | `createCompactBreaker(threshold = 3)` — 纯 counter，无 timer |
| R2 | `runtime-assembly.ts:479` | Comment: "7-min cool-down" — 代码未实现 |
| R2 | `runtime-assembly.ts:488` | `composeCompactSignalProbe()` — `breaker.canCompact()` gate |
| R3 | `clients/api-docs/` | 无 `hooks.md`；`session.md:226-260` 仅 ~35 行 |
| R4 | `session-confirmations.ts:81` | `decision: input.status === "allowed" ? "allow" : "deny"` |
| R5 | `runtime-capability.ts:140` | `legacyDecision === "always_allow"` |
| R5 | `entrypoint.ts:146` | `runtimePolicyFallback()` — `"always_allow"` → `"allow"` |
| R6 | `session-ws-v1.md:213` | `reason ∈ {reattach, revoked}` vs `messages.ts:102` `["device-conflict","reattach","revoked","policy"]` |
| R7 | `session-ws-v1.md:243-248` | implied 3 reasons vs `messages.ts:69` `["user","timeout","error","completed"]` |
| R8 | `wsemit.ts:83-86` | `void forwardFrameToUserDO(...)` — 无 .catch log |
| R9 | `16-pro-to-product-baseline-skeleton.test.mjs:168-171` | `headers: jsonHeaders` — 无 If-Match |
| R10 | `confirmation-control-plane.ts:92-94` | `isKnownKind` — dead code |
