# PP0–PP4 Pro-to-Product 完整审查报告

> 审查对象: `pro-to-product / PP0–PP4`
> 审查类型: `mixed — code-review + docs-review + closure-review`
> 审查时间: `2026-05-03`
> 审查人: `kimi-for-coding/k2p6`
> 审查范围:
> - `docs/charter/plan-pro-to-product.md` §6–§10
> - `docs/issue/pro-to-product/PP0-closure.md` 至 `PP4-closure.md`
> - `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md` 至 `PP4-hook-delivery-closure-action-plan.md`
> - `docs/design/pro-to-product/PPX-qna.md` Q1–Q17
> - `workers/agent-core/src/host/{runtime-mainline.ts,runtime-capability.ts}`
> - `workers/agent-core/src/host/do/{session-do-runtime.ts,session-do-persistence.ts,session-do-hooks.ts}`
> - `workers/orchestrator-core/src/{wsemit.ts,user-do/ws-runtime.ts,facade/routes/session-control.ts,facade/routes/session-hooks.ts}`
> - `workers/agent-core/src/hooks/catalog.ts`
> - `clients/api-docs/**/*.md` (22 docs pack)
> 对照真相:
> - `docs/charter/plan-pro-to-product.md` §10.1 (7 truth gates)
> - `docs/design/pro-to-product/PPX-qna.md` Q1–Q17
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：PP0–PP4 主线实现诚实、架构边界清晰、文档与代码事实基本对齐；但存在一处显著的 `clients/api-docs` 缺漏（hooks.md 缺失），且所有 Phase 均诚实声明未达成 live cross-e2e，导致 4 条 truth gate 目前仅靠 worker-level targeted tests 支撑。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`，但必须在 PP5/PP6 前处理以下 blocker
- **本轮最关键的 1-3 个判断**：
  1. **PP1–PP4 均未交付 live cross-e2e**，closure 均诚实标记为 `not-claimed`；虽然符合 honesty-first 纪律，但 7 truth gates 的 HITL/Context/Reconnect/Hook truth 目前尚未被端到端骨架直接验证。
  2. **clients/api-docs 缺少 hooks.md**：PP4 已实现 `/sessions/{id}/hooks` 路由与 PreToolUse 语义，但 22-doc pack 中无对应文档，构成 PP6 docs sweep 的显著 blocker。
  3. **Q17 fail-closed 语义在代码与文档间保持一致**：catalog.ts:158-159、PP4 closure、PPX-qna 业主回答三者对齐，无漂移。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/charter/plan-pro-to-product.md` — 核对 7 truth gates、Phase 边界、D1 exception law
- `docs/design/pro-to-product/PPX-qna.md` Q1–Q17 — 核对业主冻结决策与代码实现
- `docs/issue/pro-to-product/PP0-closure.md` 至 `PP4-closure.md` — 核对 closure claim、evidence shape、known issues
- `docs/action-plan/pro-to-product/PP0-charter-truth-lock-action-plan.md` 至 `PP4-hook-delivery-closure-action-plan.md` — 核对执行日志与计划项对齐

### 1.2 核查实现

- `workers/orchestrator-core/src/wsemit.ts` — PP0 `emitFrameViaUserDOAndWait()` 新增 awaited delivery helper
- `workers/agent-core/src/host/runtime-capability.ts:95-174` — PP1 `authorizeToolPlan()` ask 分支进入 `requestToolPermission` wait seam，不再返回 `tool-permission-required` terminal error
- `workers/agent-core/src/host/runtime-capability.ts:190-258` — PP4 `runPreToolUseHook()` 在工具执行前调用 dispatcher，block/updateInput 均验证
- `workers/orchestrator-core/src/user-do/ws-runtime.ts:145-175` — PP3 WS attach 时 `last_seen_seq > relay_cursor`  emit `session.replay.lost`
- `workers/agent-core/src/host/do/session-do-persistence.ts:207-211` — PP3 `restoreFromStorage()` 恢复 helper storage 对称
- `workers/orchestrator-core/src/facade/routes/session-hooks.ts` — PP4 facade route 存在且通过测试
- `clients/api-docs/` — 22 docs pack 全量扫描

### 1.3 执行过的验证

```bash
pnpm run check:docs-consistency          # ✅ pass (22 docs / 8 regex + 2 snippet)
pnpm run check:megafile-budget           # ✅ pass (16 owner files within budget)
pnpm run check:envelope-drift            # ✅ pass
pnpm --filter @haimang/agent-core-worker test -- test/host/runtime-mainline.test.ts
                                         # ✅ 12 tests pass
pnpm --filter @haimang/agent-core-worker test -- test/host/do/nano-session-do.test.ts
                                         # ✅ 36 tests pass
pnpm --filter @haimang/orchestrator-core-worker test -- test/confirmation-route.test.ts
                                         # ✅ 8 tests pass
pnpm --filter @haimang/orchestrator-core-worker test -- test/session-hooks-route.test.ts
                                         # ✅ 2 tests pass
pnpm --filter @haimang/orchestrator-core-worker test -- test/user-do.test.ts
                                         # ✅ 40 tests pass
```

### 1.4 复用 / 对照的既有审查

- 无其他 reviewer 报告被直接采纳；本审查基于独立代码/文档/closure 三方对账。

### 1.5 已确认的正面事实

- PP0 的 7 truth gates、latency alert discipline、evidence shape 已冻结且被 PP1–PP4 closure 复用。
- PP1 的 `approval_policy=ask` 不再 error-out；row-first request creation、duplicate decision 409、no-client timeout 均有代码与测试证据。
- PP2 的 `requestCompact()` 不再固定返回 `{ tokensFreed: 0 }`；prompt mutation 有 `kernel/reducer.ts` `compact_done` 与测试覆盖；deterministic summary limitation 在 closure 与 context.md 中诚实登记。
- PP3 的 WS `session.replay.lost` frame 已进入 `packages/nacp-session` schema/registry/direction matrix；HTTP resume `replay_lost_detail` 与 WS parity 已对齐；helper replay persist/restore 对称。
- PP4 的 PreToolUse caller 在 `runtime-capability.ts` 中真实运行；block 阻止工具执行；updatedInput 重新进入 schema 校验；audit (`hook.outcome`) 与 broadcast (`hook.broadcast` + `caller:"pre-tool-use"`) 双可见。
- `session-do-runtime.ts` 在 PP1/PP2/PP4 累积改动后，通过拆出 capability adapter、confirmation runtime、hook control 等模块，保持在 megafile budget 内。

### 1.6 已确认的负面事实

- PP1–PP4 closure 的 `live e2e` 字段均为 `not-claimed`；charter §9.2 要求 "PP1-P5 至少各有一条能直接判定对应 truth 是否成立的真实回路"，目前尚未被 cross-worker e2e 满足。
- `clients/api-docs/hooks.md` 不存在；PP4 的 `/sessions/{id}/hooks` 路由、PreToolUse 语义、block/updateInput contract 在 api-docs 中无独立入口。
- `workers/agent-core/src/host/do/session-do-persistence.ts:176` 的 `replayFragment: null` 仍保留在 checkpoint schema 中；PP3 action-plan 工作日志称 "helperStorage-only" 路径已落实，但主 checkpoint object 的 `replayFragment` 字段未清理，存在历史残留。
- PP2 closure 登记 "Compact 失败 3 次 circuit breaker 仍未 enforcement"，该事项进入 PP5 reliability hardening，但当前代码中 `createCompactBreaker()` 已存在于 `compact-breaker.ts` 并被 re-export，其 enforcement 状态未在 closure 中进一步说明。

### 1.7 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有关键 claim 均回溯到具体源码行号 |
| 本地命令 / 测试 | yes | 运行了 6 组 targeted tests + 3 组全局 governance gates |
| schema / contract 反向校验 | yes | 核对 nacp-session schema registry、frame-compat.ts 映射 |
| live / deploy / preview 证据 | no | 无 live preview 环境访问权限；依赖 closure 中登记的 live evidence |
| 与上游 design / QNA 对账 | yes | 逐条核对 PPX-qna Q1–Q17 与代码/closure |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | clients/api-docs 缺少 hooks.md | high | docs-gap | yes | PP5/PP6 前补写 hooks.md |
| R2 | PP1–PP4 均未交付 live cross-e2e | high | delivery-gap | no | PP5/PP6 阶段评估是否补建 cross-e2e 或接受 worker-test evidence |
| R3 | checkpoint schema 中 replayFragment: null 残留 | medium | correctness | no | PP5/PP6 清理或显式标注 deprecated |
| R4 | PP1 action-plan S6 三组 e2e 场景未在 closure 中明确达成 | medium | delivery-gap | no | 在 PP1 closure 或 PP6 final closure 中补充说明 worker tests 与 e2e 的等价性 |
| R5 | PP2 compact breaker 已存在但 enforcement 未闭合 | medium | scope-drift | no | PP5 必须处理并登记 |
| R6 | PP4 PermissionRequest 在 catalog 中 allowedOutcomes 不含 updatedInput | low | protocol-drift | no | 确认是否设计意图，PP6 docs 中说明 |

### R1. clients/api-docs 缺少 hooks.md

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - PP4 已实现 `/sessions/{id}/hooks` GET/POST/DELETE 路由 (`workers/orchestrator-core/src/facade/routes/session-hooks.ts`)
  - PreToolUse 语义已进入生产路径 (`workers/agent-core/src/host/runtime-capability.ts:190-258`)
  - `hook.broadcast` frame 已加入 WS protocol (`clients/api-docs/session-ws-v1.md` §3.2)
  - 但 `clients/api-docs/` 目录下无 `hooks.md` (glob 搜索返回空)
- **为什么重要**：PP6 的核心职责是 "item-by-item 扫描前端依赖的 public/frontend-facing surfaces"。若 PP4 已交付的 hook 路由与语义在 api-docs 中完全缺位，PP6 无法完成诚实收口；前端也无法获得 hook 注册与消费的合同。
- **审查判断**：这是 PP0–PP4 阶段中最显著的 docs truth 缺口，必须补写。
- **建议修法**：
  1. 新增 `clients/api-docs/hooks.md`，覆盖：
     - `GET/POST /sessions/{id}/hooks` 请求/响应 shape
     - `DELETE /sessions/{id}/hooks/{handlerId}`
     - handler validation rules（只允许 PreToolUse / local-ts / session source）
     - `hook.broadcast` frame shape 与 `caller:"pre-tool-use"` provenance
     - redaction policy 与 audit visibility
     - readiness label：`PreToolUse=live`，其余=catalog-only
  2. 在 `clients/api-docs/README.md` 目录索引中增加 hooks.md 链接。

### R2. PP1–PP4 均未交付 live cross-e2e

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - PP0 closure：live e2e skeleton 仅覆盖 runtime control baseline（PATCH /runtime → WS update → GET /runtime），未覆盖 HITL/compact/reconnect/hook
  - PP1 closure："live e2e = not-claimed"
  - PP2 closure："live e2e = not-claimed"
  - PP3 closure："cross-e2e = not-claimed"
  - PP4 closure："e2e = not-claimed"
- **为什么重要**：charter §9.2 要求 "PP1-P5 至少各有一条能直接判定对应 truth 是否成立的真实回路"。当前所有 Phase 的 truth 证据均为 worker targeted tests + route integration tests，尚未有跨 worker 的端到端骨架直接验证 pause-resume、prompt mutation、reconnect recovery、hook loop。
- **审查判断**：这不是 dishonesty，而是 scope 内的诚实缺口。但 PP5/PP6 必须决定：是补建 cross-e2e，还是在 final closure 中显式接受 "worker-level targeted evidence 足够证明 truth gate" 的降级论述。
- **建议修法**：
  1. PP5 action-plan 增加一项评估：是否基于现有 PP0 skeleton 扩展一条覆盖 PP1–PP4 主线的 cross-e2e。
  2. 若因时间/资源原因不扩展，PP6 final closure 必须显式登记："HITL/Context/Reconnect/Hook truth 由 worker targeted tests + route tests 证明，非 live cross-e2e"。

### R3. checkpoint schema 中 replayFragment: null 残留

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/src/host/do/session-do-persistence.ts:176`：`replayFragment: null`
  - PP3 action-plan 工作日志称："helperStorage-only 路径已落实"
  - PP3 closure 称："helper replay restore 对称"
- **为什么重要**：`replayFragment` 字段在 checkpoint schema 中仍硬编码为 `null`，与 "helperStorage-only" 的论述并存，会在长期维护中造成困惑：新开发者无法判断 `replayFragment` 是已废弃的遗留字段，还是未来会重新启用。
- **审查判断**：当前功能正确（helper checkpoint/restore 对称），但 schema 存在历史残留。
- **建议修法**：
  1. 在 `session-do-persistence.ts` 中增加注释说明 `replayFragment` 已废弃，当前 replay state 完全由 `helper.checkpoint()` / `helper.restore()` 承载。
  2. 或在 PP5/PP6 中从 checkpoint object 中移除 `replayFragment` 字段，并同步更新 `validateSessionCheckpoint()`。

### R4. PP1 action-plan S6 三组 e2e 场景未在 closure 中明确达成

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - PP1 action-plan §2.1 S6："PP1 e2e 至少覆盖 interactive ask → pause-resume、timeout → terminal、no-client → explicit no-decider 三组"
  - PP1 closure：证据矩阵列出的是 `runtime-mainline.test.ts` (44 tests)、`nano-session-do.test.ts`、`confirmation-route.test.ts` (8 tests)，未声明任何 cross-e2e
  - PP1 closure 总体 verdict："live e2e = not-claimed"
- **为什么重要**：action-plan 中明确要求 e2e，closure 诚实声明未完成。这一矛盾应在 closure 或 final closure 中做显式 reconciliation，否则后续 reviewer 会反复质疑 "S6 到底算 done 还是 not done"。
- **审查判断**：PP1 closure 的 honesty 值得肯定，但 action-plan 与 closure 之间的缺口需要显式说明。
- **建议修法**：在 PP1 closure §1 或 §6 中增加一条说明："S6 要求的 cross-e2e 场景由 worker targeted tests 覆盖，未交付 live cross-e2e； Truth gate T1 的证据来源为 integration tests + route tests，非 e2e skeleton。"

### R5. PP2 compact breaker 已存在但 enforcement 未闭合

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/src/host/runtime-mainline.ts:163-167` re-export `createCompactBreaker, composeCompactSignalProbe`
  - PP2 closure §6 Known Issues："Compact 失败 3 次 circuit breaker 仍未 enforcement；此项进入 PP5 reliability hardening"
  - PP2 action-plan 工作日志未提及 breaker enforcement 的实现
- **为什么重要**：若 breaker 代码已存在但未接入 runtime mainline，则属于 "substrate ready but not live" 的典型模式，与 pro-to-product 的 honesty-first 主线一致，但必须在 PP5 中收口。
- **审查判断**：PP2 的 scope 边界正确（不把 breaker 纳入 closure），但 PP5 必须将此事项列为 hard task 而非 soft follow-up。
- **建议修法**：PP5 action-plan 显式列出 "compact breaker enforcement" 作为 T2 reliability hardening 子任务，并明确验证方式。

### R6. PP4 PermissionRequest 在 catalog 中 allowedOutcomes 不含 updatedInput

- **严重级别**：`low`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/agent-core/src/hooks/catalog.ts:160-165`：`PermissionRequest` 的 `allowedOutcomes: ["block", "additionalContext", "diagnostics"]`，不含 `updatedInput`
  - `PreToolUse` 的 `allowedOutcomes` 含 `updatedInput`
  - PP4 closure 未将 PermissionRequest 纳入 hard gate
- **为什么重要**：PermissionRequest 是 capability ask-gated 的 permission seam；若其 allowedOutcomes 不含 updatedInput，则 hook 无法改写 permission 的 tool input。这与 PreToolUse 的能力不对等，但可能是设计意图（permission 只负责 verdict，不负责 input mutation）。
- **审查判断**：若这是设计意图，应在 PP6 docs 中显式说明；若非意图，应在 PP5 中修正。
- **建议修法**：在 `hooks/catalog.ts` PermissionRequest 的注释中增加说明："PermissionRequest  intentionally 不支持 updatedInput，input mutation 仅由 PreToolUse 处理"。

---

## 3. In-Scope 逐项对齐审核

### 3.1 PP0 — Charter & Truth Lock

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | 7 truth gates 冻结 | done | PP0 closure §0 明确冻结；PP1–PP4 closure 均引用该 gates |
| S2 | evidence shape 统一 | done | `transport/trace_uuid/start_ts/first_visible_ts/terminal_or_degraded_ts/verdict/latency_alert` 已统一 |
| S3 | 首个 e2e skeleton | done | `test/cross-e2e/16-pro-to-product-baseline-skeleton.test.mjs` 存在且 live pass |
| S4 | FE-1 handoff | done | 形成 minimum state inputs / surface taxonomy，但标记为 `closed-with-owner-action` |
| S5 | PP0 closure 输出 | done | `docs/issue/pro-to-product/PP0-closure.md` 完整登记 truth gate、latency、known issues |

### 3.2 PP1 — HITL Interrupt Closure

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | ask 分支不再 error-out | done | `runtime-capability.ts:113-164` 进入 `requestToolPermission` wait seam |
| S2 | elicitation 共享 row-first discipline | done | `session-do-runtime.ts` unified `session.confirmation.request` 已覆盖 |
| S3 | HTTP decision wakeup | done | `session-control.ts` 在 row commit + WS update 后调用 agent-core RPC |
| S4 | duplicate decision 409 | done | `confirmation-route.test.ts` 覆盖重复提交返回 409 |
| S5 | no-client timeout | done | `session-do-runtime.ts` 在 `delivered=false` 时 settle timeout |
| S6 | 三组 e2e 场景 | partial | 场景由 worker tests 覆盖，但未交付 live cross-e2e；closure 诚实标记 `not-claimed` |

### 3.3 PP2 — Context Budget Closure

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | runtime budget preflight | done | `runtime-mainline.ts` compactSignalProbe 接入 scheduler |
| S2 | manual compact durable boundary | done | `context-control-plane.ts` 写入 `checkpoint_kind="compact_boundary"` |
| S3 | requestCompact no-op 替换 | done | bridge 接入 host `requestCompact()`，不再固定返回 0 |
| S4 | prompt mutation proof | done | `kernel/reducer.ts` `compact_done` 支持 messages 替换；tests 覆盖 |
| S5 | protected fragments 不 silent drop | done | deterministic scan 记录 `<model_switch>` / `<state_snapshot>` fragment kind |
| S6 | auto compact registry-only 标注 | done | closure 与 context.md 均标 `registry-only`，未 overclaim |

### 3.4 PP3 — Reconnect & Session Recovery

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | WS replay gap early degraded | done | `ws-runtime.ts:145-175` emit `session.replay.lost` frame |
| S2 | HTTP/WS replay_lost parity | done | `surface-runtime.ts:308` 与 WS frame 使用同一语义 |
| S3 | helper replay checkpoint/restore 对称 | done | `session-do-persistence.ts:154-160` checkpoint + `207-211` restore |
| S4 | single attachment supersede | done | `user-do.test.ts` 40 tests 覆盖 supersede/detached/terminal |
| S5 | recovery bundle 定义 | done | `session-ws-v1.md` §3.7 与 closure §4 定义 bundle |
| S6 | T3/T4 truth 登记 | done | closure 诚实登记为 `closed-with-first-wave-reconnect-recovery` |

### 3.5 PP4 — Hook Delivery Closure

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | session hook register/list/unregister | done | `session-hooks.ts` 实现 GET/POST/DELETE；tests 通过 |
| S2 | handler validation | done | `session-registration.ts` 限制 event/runtime/matcher/timeout |
| S3 | PreToolUse production caller | done | `runtime-capability.ts:190-258` 在工具执行前 emit |
| S4 | block outcome enforcement | done | block 返回 `hook-blocked` tool result，阻止 transport 调用 |
| S5 | updatedInput validation | done | updatedInput 必须是 object 且重新进入 schema；`write_todos` 测试覆盖 |
| S6 | audit + frontend broadcast | done | `hook.outcome` audit + `hook.broadcast` frame + `caller:"pre-tool-use"` |

### 3.6 对齐结论

- **done**: 28
- **partial**: 1 (PP1 S6 e2e)
- **missing**: 1 (clients/api-docs/hooks.md)
- **stale**: 1 (`replayFragment: null` 残留)
- **out-of-scope-by-design**: 4 (LLM summary, full hook catalog, shell hook, multi-attachment)

> 整体状态更像 "核心骨架与 worker-level truth 全部完成，但 live cross-e2e 与部分 docs truth 仍未收口"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider / sub-agent / admin / billing | 遵守 | 所有 closure 均未涉及 |
| O2 | Full hook catalog (14/18 events) | 遵守 | PP4 仅接通 PreToolUse，其余标 catalog-only |
| O3 | Shell hook | 遵守 | catalog.ts 与 session-registration.ts 均拒绝 shell runtime |
| O4 | LLM summary (PP2) | 遵守 | closure 与 context.md 均标 limitation |
| O5 | Exactly-once replay / multi-attachment (PP3) | 遵守 | Q12/Q13 冻结，closure 诚实标记 best-effort + single attachment |
| O6 | Full clients/api-docs sweep (PP1–PP4) | 部分违反 | PP1–PP3 的最小 docs sync 已做，但 PP4 的 hooks.md 完全缺失，属于 out-of-scope 执行不彻底 |

---

## 5. 跨阶段深度分析与判断

### 5.1 跨 Phase 代码耦合分析

**PP1 → PP3 共享 owner file：`session-do-runtime.ts`**
- PP1 修改了 confirmation wait/timeout/row-first 逻辑；PP3 复用了 pending row 用于 reconnect recovery。
- 当前 `session-do-runtime.ts` 已拆出 `session-do-confirmation.ts` 与 `session-do-hooks.ts`，megafile budget 通过。
- **判断**：PP1 与 PP3 的共享改动面已稳定，PP3 未引入与 PP1 冲突的 parallel pending store，符合 charter §6.3 交接原则。

**PP1 → PP4 仲裁顺序：`runtime-capability.ts`**
- PP4 的 PreToolUse hook 在 `authorizeToolPlan()` 之前运行（`runtime-capability.ts:280-296`）。
- 这意味着：hook 可以 block/updateInput 一个工具，然后再进入 permission 仲裁。
- **判断**：仲裁顺序清晰，与 PP1 的 HITL substrate 无冲突。但 PP5 必须 frozen 这一顺序并在 docs 中记录，否则前端无法解释 "为什么 hook 改了 input 但 permission 仍 deny"。

**PP2 → PP3 恢复链：`compact boundary` 在 recovery bundle 中的消费**
- PP3 recovery bundle 包含 "context probe / context docs surfaces"，用于消费 PP2 compact truth。
- `session-do-persistence.ts` 的 checkpoint 中 `workspaceFragment: null`，compact boundary 的 durable truth 由 D1 承载，非 checkpoint object。
- **判断**：reconnect 后前端刷新 context probe 可获得 compact boundary，但 session state snapshot 中不含 compact 后 messages 的内存状态；DO hibernation 恢复后，下一 turn 的 prompt 会由 runtime 重新从 D1 读取 compact boundary 并重建。这一路径在 `checkpoint-roundtrip.test.ts` 中未显式覆盖，属于潜在盲点。

### 5.2 命名规范与语义一致性

| 主题 | 代码事实 | 文档表述 | 一致性 |
|------|----------|----------|--------|
| `session.replay.lost` (WS frame) | `ws-runtime.ts:166` | `session-ws-v1.md` §3.7 | ✅ 一致 |
| `session.replay_lost` (audit event) | `ws-runtime.ts:151` | `session-ws-v1.md` §3.7 | ✅ 一致（audit 用下划线，frame 用点） |
| `hook.broadcast.caller` | `runtime-capability.ts:221` | `session-ws-v1.md` §3.2 | ✅ 一致 |
| `checkpoint_kind="compact_boundary"` | `context.md` §6 | `orchestrator-core/context-control-plane.ts` | ✅ 一致 |
| `snapshot_kind="compact-boundary"` | `context.md` §6 | `orchestrator-core/context-control-plane.ts` | ⚠️ 代码中为 `"compact-boundary"`（连字符），closure 中写作 `"compact_boundary"`（下划线）；需确认 D1 schema 实际存储值 |

**R7 潜在发现：`snapshot_kind` 的连字符 vs 下划线**
- PP2 closure §2 提到 `snapshot_kind="compact-boundary"`（连字符）与 `checkpoint_kind="compact_boundary"`（下划线）。
- 若 D1 实际存储值不一致，PP6 docs sweep 时会出现分类错误。
- **建议**：PP5/PP6 必须做一次 `SELECT DISTINCT snapshot_kind, checkpoint_kind FROM ...` 的 D1 查询，确认存储值与 docs 一致。

### 5.3 clients/api-docs 22-doc 包核实

对 `clients/api-docs/` 全包进行逐项扫描：

| 文档 | 与代码匹配度 | 备注 |
|------|--------------|------|
| `README.md` | ✅ | 目录索引完整 |
| `auth.md` | ✅ | 无变更 |
| `catalog.md` | ✅ | 无变更 |
| `checkpoints.md` | ✅ | 与 checkpoint restore gate 对齐 |
| `client-cookbook.md` | ✅ | 无变更 |
| `confirmations.md` | ✅ | 7-kind / 6-status 与代码一致；`tool_permission`/`elicitation` 标 live |
| `context.md` | ✅ | PP2 后 manual compact=live, auto compact=first-wave, deterministic limitation 已登记 |
| `error-index.md` | ✅ | 未发现明显 drift |
| `items.md` | ✅ | 无变更 |
| `me-sessions.md` | ✅ | 无变更 |
| `models.md` | ✅ | 无变更 |
| `permissions.md` | ✅ | legacy 路径 dual-write 说明完整 |
| `runtime.md` | ✅ | ETag/If-Match contract 与 `session-runtime.ts` 一致 |
| `session.md` | ✅ | HTTP resume `replay_lost_detail` 与代码一致 |
| `session-ws-v1.md` | ✅ | `session.replay.lost` / `session.runtime.update` / `hook.broadcast` 均同步 |
| `todos.md` | ✅ | 无变更 |
| `tool-calls.md` | ✅ | 无变更 |
| `transport-profiles.md` | ✅ | 无变更 |
| `usage.md` | ✅ | 无变更 |
| `wechat-auth.md` | ✅ | 无变更 |
| `worker-health.md` | ✅ | 无变更 |
| `workspace.md` | ✅ | 无变更 |
| **hooks.md** | ❌ **缺失** | PP4 已 implement，但 api-docs 中完全缺位 |

### 5.4 真实盲点与断点

**B1. `context_compact` confirmation kind 仍是 registry-only**
- PP2 closure §6："`context_compact` confirmation kind 仍是 registry-only / future caller substrate；PP2 未把 compact 接入 HITL confirmation 主线"。
- 这意味着：若 runtime auto compact 触发，不会走 PP1 的 confirmation row + HTTP decision 流程。
- **判断**：符合 scope（PP2 只做 first-wave runtime compact），但 PP5/PP6 必须决定 `context_compact` 是否永远保持 registry-only，还是未来接入 HITL。

**B2. PP3 recovery bundle 中 timeline 的 reconciliation 未验证**
- PP3 closure §4："当 replay lost 时作为补偿性 read model"。
- 但 timeline 的 reconciliation 逻辑在代码中未找到显式实现；timeline 更多是 read-model，而非 reconciliation engine。
- **判断**：这不是实现错误，而是 docs 中的描述可能过于乐观。PP6 应修正 `session-ws-v1.md` 中 "用 timeline 做 reconciliation" 的措辞，改为 "用 timeline 做补偿性 read" 即可。

**B3. `emitFrameViaUserDOAndWait()` 的 fire-and-forget 回退路径**
- PP0 修复了 `session.runtime.update` 的 delivery 缺口，使用 awaited forward。
- 但 `wsemit.ts:77-101` 的 `makeUserDoSink` 仍为 fire-and-forget；其他 frame（如 `session.confirmation.request`）仍走原路径。
- **判断**：这是设计意图（confirmation request 的 row truth 不依赖 WS delivery），但 PP6 docs 应明确说明哪些 frame 使用 awaited delivery、哪些使用 best-effort。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：PP0–PP4 的主线实现已完成，代码诚实、边界清晰、测试覆盖充分；但存在 **1 个 blocker（hooks.md 缺失）** 与 **1 个 high 级别 follow-up（live cross-e2e 缺口）**。
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：
  1. **R1**：补写 `clients/api-docs/hooks.md`，覆盖 PP4 实现的 hook 注册、PreToolUse 语义、frame shape、redaction 与 readiness label。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R2**：PP5/PP6 评估是否补建覆盖 PP1–PP4 主线的 cross-e2e，或在 final closure 中显式接受 worker-test evidence。
  2. **R3**：清理 checkpoint schema 中的 `replayFragment: null` 残留。
  3. **R5**：PP5 必须将 compact breaker enforcement 列为 hard task。
  4. **R7**：确认 `snapshot_kind` 与 `checkpoint_kind` 在 D1 中的实际存储值是否一致。
  5. **B3**：在 PP6 docs 中区分 awaited delivery frame 与 best-effort frame 的清单。
- **建议的二次审查方式**：`same reviewer rereview` 在 hooks.md 补写完成后进行窄范围复核。
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §7 append 回应，不要改写 §0–§6。

---

*审查结束。以上判断基于独立代码/文档/closure 三方对账，未参考其他 reviewer（Kimi/Deepseek/GPT）的既有报告。*
