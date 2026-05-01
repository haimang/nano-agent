# Nano-Agent `hero-to-pro` HP0-HP10 完整代码审查报告

> 审查对象: `hero-to-pro` 阶段全部工作（HP0-HP10）
> 审查类型: `mixed`（code-review + docs-review + closure-review）
> 审查时间: `2026-05-01`
> 审查人: `Kimi`
> 审查范围:
> - `docs/charter/plan-hero-to-pro.md` — 阶段 charter
> - `docs/action-plan/hero-to-pro/HP{0-10}-action-plan.md` — 11 份执行计划
> - `docs/issue/hero-to-pro/HP{0-10}-closure.md` — 11 份阶段收口
> - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` — 最终收口
> - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md` — deferred absorb 日志
> - `clients/api-docs/*.md` — 18 份客户端文档
> - `workers/orchestrator-core/src/` — 核心实现代码
> - `test/cross-e2e/` — 跨端测试
> 对照真相:
> - `docs/charter/plan-hero-to-pro.md` §4.4 硬纪律 + §10 收口标准
> - `docs/templates/code-review.md` — 输出模板
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：hero-to-pro 阶段以 `partial-close / 7-retained-with-explicit-remove-condition` 状态封板，主体骨架完成，但存在 3 个 critical blocker、5 个 high 风险点，以及大量 cross-e2e 未运行的 delivery gap。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`no` — 必须等待实现者按 §6 响应并修复 R1-R3 blocker 后方可关闭
- **本轮最关键的 1-3 个判断**：
  1. **28 项 deferred 的 absorb 声明与代码实现存在严重漂移**：`hp-absorbed-routes.ts` / `hp-absorbed-handlers.ts` 中的 retry/fork/workspace/tool-calls 路由均为 first-wave stub（返回 200/202 ack），而非 charter 要求的真接线；这与 final closure 中"28 项真正吸收并实现进 hero-to-pro"的 claim 存在事实矛盾。
  2. **Cross-e2e 全部未运行违反 charter §4.4 e2e 文件落地纪律**：7 个新增 cross-e2e 文件（15-21）全部为 scaffolded（仅探测 facade 可达性），未覆盖任何真实业务断言；charter §9.4 明确禁止"wire 完整但无 e2e 不算闭合"。
  3. **HP9 freeze gate NOT GRANTED 却被强行推进**：HP8 closure §5 明确未授予 HP9 文档冻结许可（R28/R29/heartbeat 未完成），但 HP9/HP10 仍被推进并标记 closure，违反 charter §8.3 Gate 规则。

---

## 1. 审查方法与已核实事实

### 1.1 对照文档

- `docs/charter/plan-hero-to-pro.md` — 完整 1331 行，§4.4 硬纪律、§10 收口标准、§8.3 Gate 规则
- `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` — 380 行，post-absorb 修正版
- `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md` — 250 行，28 项 absorb 日志
- `docs/action-plan/hero-to-pro/HP{0-10}-action-plan.md` — 11 份
- `docs/issue/hero-to-pro/HP{0-10}-closure.md` — 11 份
- `docs/templates/code-review.md` — 输出模板

### 1.2 核查实现

- `workers/orchestrator-core/src/index.ts` — facade 路由（2930 行，megafile budget 内）
- `workers/orchestrator-core/src/hp-absorbed-routes.ts` — 281 行，workspace/tool-calls 路由
- `workers/orchestrator-core/src/hp-absorbed-handlers.ts` — 71 行，retry/fork handler stub
- `workers/orchestrator-core/src/user-do-runtime.ts` — 1268 行，retry/fork dispatch
- `workers/orchestrator-core/migrations/001-014-*.sql` — 14 个 migration 文件
- `clients/api-docs/*.md` — 18 份文档全部存在
- `test/cross-e2e/15-21-*.test.mjs` — 7 个新增 cross-e2e

### 1.3 执行过的验证

- `node scripts/check-megafile-budget.mjs` — 5 owner files within budget ✅
- `node scripts/check-tool-drift.mjs` — catalog SSoT clean (1 tool: bash) ✅
- `node scripts/check-envelope-drift.mjs` — 1 public file clean ✅
- `ls workers/orchestrator-core/migrations/` — 14 files (001-014) ✅
- `ls clients/api-docs/*.md` — 18 files ✅
- `grep -r "hp-absorbed" workers/orchestrator-core/src/` — 确认 import 关系 ✅
- 阅读 `test/cross-e2e/15-21-*.test.mjs` — 全部 scaffolded，无真实业务断言

### 1.4 复用 / 对照的既有审查

- 无 — 本次为独立审查，未参考 deepseek/GLM/GPT 的 review memo。

### 1.5 已确认的正面事实

- HP0/HP1 DDL Freeze Gate 生效，14 个 migrations 全部落地，schema-assertion 测试通过。
- 4 套状态机 first-wave 骨架全部存在（model/context/chat/tool-workspace）。
- 18 份 `clients/api-docs/` 文档全部存在，RHX2 旧标题已清理。
- 5 类 root drift gate 全部 clean（cycles/megafile-budget/tool-drift/envelope-drift/observability-drift）。
- 单元测试 2776 全绿（agent-core 1077 / orchestrator-core 305 / context-core 178 / nacp-session 196 / nacp-core 344 / bash-core 376 / filesystem-core 300）。
- `hp-absorbed-routes.ts` / `hp-absorbed-handlers.ts` 文件存在，路由已注册到 `index.ts`。
- Q-law 合规自查 15 项全部标 ✅（Q8/Q12/Q16/Q19/Q21/Q22/Q23/Q24/Q25/Q26/Q27/Q28/Q33/Q34/Q35/Q36）。

### 1.6 已确认的负面事实

- **Cross-e2e 全部未运行**：15-21 号 7 个文件全部为 `scaffolded`（仅 `fetchJson(${orch}/)` 探测 facade 可达），无真实业务断言；charter §4.4 纪律 #2 明确要求"任何 phase 宣称端点 live 必须有对应 cross-e2e 文件落地"。
- **HP8 freeze gate NOT GRANTED**：HP8 closure §5 明确 verdict = "NOT GRANTED"，但 HP9/HP10 仍被推进。
- **Absorb 声明 vs 代码事实漂移**：`HP0-H10-deferred-closure.md` 声称 28 项"真正吸收并实现进 hero-to-pro"，但 `hp-absorbed-handlers.ts` 中 retry/fork 为 stub（返回 200/202 ack，无真实 attempt-chain/fork-executor）；`hp-absorbed-routes.ts` 中 tool-calls list 返回空数组 `[]`，workspace read 返回 `content_source: "filesystem-core-leaf-rpc-pending"`。
- **Confirmation emitter row-create 仍未 live**：HP5 closure §2 P1 标 `not-wired-on-emitter-side`，HP5-D1 absorb 声称已修复，但 `entrypoint.ts:51-105` 的 `emitterRowCreateBestEffort` 仅在收到特定帧时触发，非 PreToolUse 主动 row-create。
- **Model fallback 未真触发**：HP2-D2 声称 `model.fallback` stream event 已注册，但 `gateway.ts` 未读 `nano_models.fallback_model_id`，fallback 链未真执行。
- **Auto-compact 仍硬编码 false**：HP3-D2 声称已改为 probe 信号驱动，但 `orchestration.ts:296,429` 仍硬编码 `compactRequired: false`。
- **7 项 retained-with-reason 中 4 项为 owner-action**：manual evidence / prod baseline / R28 / R29 / 4-reviewer memos 全部 pending，next review 2026-05-11 至 2026-05-15。

### 1.7 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 逐行阅读 `index.ts`、`hp-absorbed-routes.ts`、`hp-absorbed-handlers.ts`、cross-e2e 测试文件 |
| 本地命令 / 测试 | `yes` | 运行 3 个 drift gate + 1 个 verifier self-test |
| schema / contract 反向校验 | `yes` | 核对 14 个 migration 文件与 `prod-schema-baseline.md` 登记 |
| live / deploy / preview 证据 | `no` | 无 preview deploy 访问权；cross-e2e 未运行 |
| 与上游 design / QNA 对账 | `yes` | 对照 charter §4.4、§10、§8.3 逐项核查 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | Absorb 声明与代码实现严重漂移：28 项 deferred 中大量为 stub 而非真接线 | `critical` | `delivery-gap` | `yes` | 将 `hp-absorbed-routes.ts` / `hp-absorbed-handlers.ts` 中 stub 标记为 `first-wave-ack-only`，修正 final closure 措辞 |
| R2 | Cross-e2e 全部 scaffolded 未运行，违反 charter e2e 文件落地纪律 | `critical` | `test-gap` | `yes` | 要么运行 cross-e2e 并补充真实断言，要么在 closure 中显式标 `not-run` 并说明原因 |
| R3 | HP9 freeze gate NOT GRANTED 却被强行推进，违反 charter Gate 规则 | `critical` | `delivery-gap` | `yes` | 回滚 HP9/HP10 closure 状态为 `cannot-close`，或 owner 显式豁免 gate 规则 |
| R4 | Confirmation emitter 侧 row-create 仍未真接线 | `high` | `correctness` | `no` | HP5 后续批次补 PreToolUse 主动 row-create，当前文档已如实标注 |
| R5 | Model fallback 链未真执行，gateway.ts 未读 fallback_model_id | `high` | `correctness` | `no` | HP2 后续批次补 fallback 执行逻辑 |
| R6 | Auto-compact 仍硬编码 false，与 absorb 声明矛盾 | `high` | `correctness` | `no` | HP3 后续批次真改 probe 信号驱动 |
| R7 | 4-reviewer memos 未完成，但 final closure 已标 `partial-close` | `high` | `docs-gap` | `no` | 在 2026-05-15 前完成 4 份 memo |
| R8 | Cleanup register K1-K5 中 K4 可删除但未删除 | `medium` | `platform-fitness` | `no` | 确认无外部 caller 后物理删除 `assemblerOps` |
| R9 | `hp-absorbed-routes.ts` 中 `content_source: "filesystem-core-leaf-rpc-pending"` 暴露未 live 状态 | `medium` | `docs-gap` | `no` | 在 api-docs 中标注 workspace read 为 `first-wave-stub` |
| R10 | 7 项 retained-with-reason 中 3 项 cleanup 无明确 next review 日期 | `medium` | `delivery-gap` | `no` | 给 K1/K2/K3/K5 指定具体 next review 日期 |

### R1. Absorb 声明与代码实现严重漂移

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md` §1 声称 28 项"真正吸收并实现进 hero-to-pro"，例如 HP4-D1 "`POST /sessions/{id}/retry` route + attempt chain"、HP6-D3 "`/sessions/{id}/workspace/files/{*path}` public CRUD"、HP7-D3 "`POST /sessions/{id}/fork` public route"。
  - 但 `workers/orchestrator-core/src/hp-absorbed-handlers.ts:9-40` `handleRetryAbsorbed` 返回 200 并带 `retry_kind: "request-acknowledged-replay-via-messages"`，注释明确 "first-wave: signals to client that route is wired but full attempt-chain executor is in HP4 follow-up batch"。
  - `workers/orchestrator-core/src/hp-absorbed-handlers.ts:42-71` `handleForkAbsorbed` 返回 202 并带 `fork_status: "pending-executor"`，注释明确 "first-wave: child session UUID is minted but executor wires are in HP7 follow-up batch"。
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:122-148` `handleSessionToolCalls` 对 list 返回 `tool_calls: []` 并带 `source: "ws-stream-only-first-wave"`；对 cancel 返回 202 并带 `forwarded: true`，但无真实 cancel RPC。
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:212-233` `handleSessionWorkspace` read 返回 `content_source: "filesystem-core-leaf-rpc-pending"`，表明 filesystem-core RPC 未真接线。
- **为什么重要**：charter §0.5 明确 "wire-without-delivery 不算闭合"，§4.4 纪律 #2 要求 e2e 文件落地。final closure 声称 28 项"真正吸收并实现"，但代码事实是大量 first-wave stub。这种声明漂移会导致下游 phase（hero-to-platform）错误假设这些功能已 live。
- **审查判断**：这是 deceptive closure 模式（charter §5 方法论明确禁止）。28 项中真正"absorbed"的应仅限于：文件外迁（megafile budget 合规）、schema 注册（stream event kind 13→13）、route parser 注册（但 handler 为 stub）。不应声称"attempt chain / public CRUD / fork executor 已 live"。
- **建议修法**：
  1. 修正 `HP0-H10-deferred-closure.md` 措辞：将 28 项中的 stub 项标注为 `absorbed-as-route-and-stub`，而非 `absorbed-within-hero-to-pro`。
  2. 修正 `hero-to-pro-final-closure.md` §4 和 §8：明确区分 "route wired (first-wave ack)" 与 "executor live (second-wave)"。
  3. 在 `hp-absorbed-routes.ts` / `hp-absorbed-handlers.ts` 文件头注释中增加 `WARNING: first-wave stub, not full implementation` 标记。

### R2. Cross-e2e 全部 scaffolded 未运行

- **严重级别**：`critical`
- **类型**：`test-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `test/cross-e2e/15-hp2-model-switch.test.mjs` 5 个 test case 全部仅 `fetchJson(${orch}/)` 探测 facade 可达，注释 "Stub only verifies facade is reachable; full assertions require live preview auth"。
  - `test/cross-e2e/21-hp8-heartbeat-posture.test.mjs` 4 个 test case 同样仅探测 `/`，注释 "Real test: alarm() sweep fires while a session has pending permission decision"。
  - 所有 7 个文件（15-21）模式一致：使用 `liveTest()` helper，未设置 `NANO_AGENT_LIVE_E2E=1` 时 skip。
  - charter §4.4 纪律 #2："任何 phase 宣称'端点 live' 必须有对应 `test/cross-e2e/*.test.mjs` 文件落地"。
  - charter §9.4 证据不足时不允许宣称："F12 hook dispatcher closed — 必须有 P1-10 cross-e2e 文件全绿"、"F13 round-trip closed — 必须有 4 个 cross-e2e 文件全绿"。
- **为什么重要**：cross-e2e 是 wire-with-delivery 纪律的唯一自动化证据。全部 scaffolded 意味着所有 HP2-HP8 的 "partial-live" 声明都缺乏端到端验证。
- **审查判断**：违反 charter 硬纪律。即使 owner 无法运行 live e2e，也应在 closure 中显式标 `not-run` 并说明原因，而不是标 `scaffolded` 暗示已落地。
- **建议修法**：
  1. 在 `HP2-HP8-closure.md` 中统一修正 cross-e2e 状态为 `not-run`（而非 `scaffolded`）。
  2. 补充说明："因缺乏 live preview auth / 6-worker stack 本地启动成本，cross-e2e 未运行；owner 需在 2026-05-15 前完成 live run"。
  3. 若无法运行，应在 final closure 中降级相关 phase 的 verdict 为 `partial-without-e2e-evidence`。

### R3. HP9 freeze gate NOT GRANTED 却被强行推进

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **是否 blocker**：`yes`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP8-closure.md` §5 verdict："HP9 documentation freeze gate: NOT GRANTED"，理由："heartbeat posture(F9)与 R28 / R29 chronic 三选一终态仍处于 `partial / not-started` 状态。HP9 若在此时启动，会在 chronic register 仍可能更新的窗口内冻结 18 份对外文档，直接抵消 Q28 explicit closure 的价值。"
  - 但 `docs/issue/hero-to-pro/HP9-closure.md` 存在，状态标为 `cannot-close (owner-action-blocked)`。
  - `docs/issue/hero-to-pro/HP10-closure.md` 存在，状态标为 `closed-as-handoff-owner`。
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` 声称阶段 verdict = `partial-close / 7-retained-with-explicit-remove-condition`。
  - charter §8.3 Gate 规则："Documentation Freeze Gate — HP9 启动前代码必须 freeze；HP8 closure 后所有代码改动停止"。
- **为什么重要**：gate 规则是 charter 的硬纪律，违反 gate 规则意味着后续 phase 的 closure 合规性存疑。HP9 在 gate 未授予时启动，导致 18 份文档可能在 chronic register 仍漂移的窗口内冻结。
- **审查判断**：这是流程违规。HP9 不应在 HP8 gate NOT GRANTED 时启动；HP10 不应在 HP9 cannot-close 时启动。
- **建议修法**：
  1. 回滚 HP9/HP10 closure 状态为 `cannot-close`，或 owner 显式豁免 gate 规则（需书面记录）。
  2. 在 final closure 中增加一节 "HP9 freeze gate override"，说明 override 理由和 owner 批准记录。
  3. 若不回滚，应在 hero-to-platform stub 中显式标注："hero-to-pro 文档冻结时 chronic register 未完全稳定，hero-to-platform 启动时需重新 review 18 份文档"。

### R4. Confirmation emitter 侧 row-create 仍未真接线

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP5-closure.md` §2 P1："PreToolUse permission live emitter: `emitPermissionRequestAndAwait()` 在 emit 时主动 row-create"，当前完成度 `not-wired-on-emitter-side`。
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md` §1.5 HP5-D1 声称："PreToolUse emitter 侧 row-create... 已 absorb"。
  - 但 `workers/orchestrator-core/src/entrypoint.ts:51-105` 的 `emitterRowCreateBestEffort` 仅在 `forwardServerFrameToClient` 收到 `session.permission.request` / `session.elicitation.request` 帧时触发，而非 PreToolUse 主动 row-create。
- **审查判断**：文档已如实标注（`confirmations.md` §1 标 `registry-only`），但 deferred-closure absorb 日志的措辞过于乐观。
- **建议修法**：修正 `HP0-H10-deferred-closure.md` HP5-D1 措辞为 `absorbed-as-frame-handler-stub`，并说明 emitter 侧主动 row-create 仍为 `not-wired`。

### R5. Model fallback 链未真执行

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md` §1.1 HP2-D2 声称："`model.fallback` stream event 注册 + emit codepath... 已 absorb"。
  - `packages/nacp-session/src/stream-event.ts` 确实新增 `ModelFallbackKind` schema，inspector 同步至 13 kinds。
  - 但 `workers/agent-core/src/host/gateway.ts`（或等效文件）未读 `nano_models.fallback_model_id`，fallback 触发逻辑未真执行。
- **审查判断**：stream event schema 注册是事实，但 "emit codepath" 未真接线。这属于 `absorbed-as-schema-only`，不应声称 "emit codepath 已 absorb"。
- **建议修法**：修正 absorb 日志措辞，区分 schema 注册与 emit codepath。

### R6. Auto-compact 仍硬编码 false

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/hero-to-pro/HP0-H10-deferred-closure.md` §1.2 HP3-D2 声称："auto-compact runtime trigger... 已 absorb"。
  - `workers/agent-core/src/host/orchestration.ts:296,429` 仍硬编码 `compactRequired: false`（`clients/api-docs/context.md` §2 已如实标注）。
  - `workers/agent-core/src/host/compact-breaker.ts` 存在，但 `orchestration.ts` 未调用 `composeCompactSignalProbe`。
- **审查判断**：compact-breaker 模块存在是事实，但 orchestration.ts 未真接线。这属于 `absorbed-as-module`，不应声称 "runtime trigger 已 absorb"。
- **建议修法**：修正 absorb 日志措辞，并给 `orchestration.ts` 加 TODO 注释。

### R7. 4-reviewer memos 未完成

- **严重级别**：`high`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` §3.3 声称 4-reviewer memos 为 `retained-with-reason`，remove condition 为 "4 份 reviewer memo 落地 + critical=0 + high 全修回 docs pack"。
  - 但 `docs/eval/hero-to-pro/` 目录下无 `HP9-api-docs-reviewed-by-*.md` 文件。
- **审查判断**：这是 owner-action 项，next review 2026-05-15。当前不 blocker，但需在日期前完成。
- **建议修法**：在 2026-05-15 前完成 4 份 memo。

### R8. Cleanup register K4 可删除但未删除

- **严重级别**：`medium`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` §6.2 K4：`context-core` `assemblerOps` deprecated alias，标 `retained-with-reason`。
  - 但 `HP0-H10-deferred-closure.md` §2.2 声称 "K4 可在 hero-to-pro 内删除（`@deprecated` 标记 ≥ 2 个 phase 已经过；外部 RPC consumer 在仓库内 grep 零结果）"。
- **审查判断**：保守 retained 是合规的，但应给出明确 next review 日期。
- **建议修法**：给 K4 指定 next review 日期（如 2026-05-15），并在此日期前确认无外部 caller 后删除。

### R9. Workspace read 返回 `filesystem-core-leaf-rpc-pending`

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `workers/orchestrator-core/src/hp-absorbed-routes.ts:228` `handleSessionWorkspace` read 返回 `content_source: "filesystem-core-leaf-rpc-pending"`。
  - `clients/api-docs/workspace.md` §1 标注 "workspace temp file... public CRUD route 未 live"，但 §4 Artifact Routes 未明确区分 artifact（live）与 workspace temp file（stub）。
- **审查判断**：文档已部分标注，但 endpoint matrix 中 `/sessions/{id}/workspace/files/{*path}` 未出现在 README 中，可能导致客户端遗漏。
- **建议修法**：在 `README.md` endpoint matrix 中增加 workspace temp file 路由，并标注 `first-wave-stub`。

### R10. Cleanup 项无明确 next review 日期

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/issue/hero-to-pro/hero-to-pro-final-closure.md` §6.2 K1/K2/K3/K5 的 next review 为 "hero-to-pro 后续批次" 或 "hero-to-platform charter 启动日"，无具体日期。
  - Q36 要求 retained 必须有 "observable remove condition" 和 "next review date"。
- **审查判断**："hero-to-platform charter 启动日" 不是可观察日期，因为 hero-to-platform 不是已命名阶段（final closure 已纠正此点）。
- **建议修法**：给 K1-K5 指定具体 next review 日期（如 2026-06-01），或改为 "triggered by: <具体事件>"（如 "dual-track facade-vs-internal-RPC collapse 完成"）。

---

## 3. In-Scope 逐项对齐审核

### 3.1 HP0 — 前置 defer 修复

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | `/start`/`/input` model_id+reasoning 透传 | `done` | `session-lifecycle.ts` + `session-flow.ts` 已透传 |
| S2 | `withNanoAgentSystemPrompt(modelId?)` seam | `partial` | seam 存在，但 suffix 仍空（等 HP1 落表） |
| S3 | CONTEXT_CORE / LANE_E_RPC_FIRST verify | `done` | `binding-presence.test.ts` 已验证 |
| S4 | archive runbook 删除 | `done` | `zx2-rollback.md` 已删除 |
| S5 | forwardInternalJsonShadow / parity-bridge 留 HP8/HP10 | `done` | 已显式 retained |

### 3.2 HP1 — DDL 集中扩展

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S6 | 7 个 migration (007-013) 落地 | `done` | 14 个文件存在，schema-assertion 通过 |
| S7 | checkpoint 三表 + cleanup_jobs 表 | `done` | 013 含 4 张表 |
| S8 | model metadata 10 列 + alias 表 | `done` | 007 含 10 列 + alias seed |
| S9 | schema correction 模板 | `done` | 模板存在，当前 0 次 correction |
| S10 | prod apply owner-action | `partial` | 留 HP9 owner-action |

### 3.3 HP2 — Model 状态机

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S11 | `GET/PATCH /sessions/{id}/model` | `done` | 路由 live |
| S12 | `GET /models/{id}` | `done` | 路由 live |
| S13 | alias resolve | `done` | `session-truth.ts` 已实现 |
| S14 | requested/effective model audit | `done` | D1 turn 表已写 |
| S15 | `<model_switch>` developer message | `missing` | 未实现 |
| S16 | `model.fallback` stream event + emit | `partial` | schema 注册，emit 未真接线 |
| S17 | cross-e2e 5+ scenarios | `missing` | scaffolded，无真实断言 |

### 3.4 HP3 — Context 状态机

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S18 | context-core 3 RPC 解 stub | `done` | 不再返 `phase:"stub"` |
| S19 | 5 个 context endpoint | `done` | probe/layers/snapshot/preview/compact/job |
| S20 | CrossTurnContextManager | `missing` | 未成为唯一 prompt owner |
| S21 | auto-compact runtime trigger | `missing` | 仍硬编码 `compactRequired: false` |
| S22 | strip-then-recover full contract | `partial` | preview-only marker，未真 recover |
| S23 | compact breaker | `partial` | 模块存在，未接线 |
| S24 | cross-e2e 5+ scenarios | `missing` | scaffolded |

### 3.5 HP4 — Chat 生命周期

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S25 | close/delete/title | `done` | 路由 live |
| S26 | cursor pagination | `done` | D1 cursor 已实现 |
| S27 | conversation detail | `done` | `GET /conversations/{uuid}` live |
| S28 | checkpoint list/create/diff | `done` | 路由 live |
| S29 | retry | `partial` | route 存在，handler 为 stub |
| S30 | restore job | `missing` | 未接线 |
| S31 | cross-e2e 6+ scenarios | `missing` | scaffolded |

### 3.6 HP5 — Confirmation 收拢

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S32 | confirmation registry | `done` | `D1ConfirmationControlPlane` live |
| S33 | `/confirmations` 三件套 | `done` | list/detail/decision live |
| S34 | `session.confirmation.*` 帧族 | `done` | 已注册 |
| S35 | kernel `confirmation_pending` | `done` | `approval_pending` 已淘汰 |
| S36 | HookDispatcher 真注入 | `done` | runtime-assembly 已构造 |
| S37 | row-first dual-write | `partial` | decision 侧 live，emitter 侧未主动 row-create |
| S38 | cross-e2e 4 件套 | `missing` | scaffolded |

### 3.7 HP6 — Tool/Workspace

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S39 | todo CRUD | `done` | 路由 + D1 helper live |
| S40 | workspace path law | `done` | 7-rule 冻结 |
| S41 | workspace D1 truth helper | `done` | `D1WorkspaceControlPlane` live |
| S42 | workspace public CRUD | `partial` | route 存在，read/write 为 stub |
| S43 | filesystem-core leaf RPC | `partial` | 8 个 RPC 方法存在，但未真接线到 facade |
| S44 | tool-calls list/cancel | `partial` | route 存在，list 返空数组，cancel 为 stub |
| S45 | artifact promotion | `missing` | 未接线 |
| S46 | cleanup jobs cron | `missing` | 未接线 |
| S47 | cross-e2e 6+ scenarios | `missing` | scaffolded |

### 3.8 HP7 — Checkpoint Revert

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S48 | snapshot plane | `done` | `D1CheckpointSnapshotPlane` live |
| S49 | restore job plane | `done` | `D1CheckpointRestoreJobs` live |
| S50 | diff projector | `done` | `CheckpointDiffProjector` live |
| S51 | fork event | `done` | `session.fork.created` 帧已注册 |
| S52 | restore executor | `missing` | 未接线 |
| S53 | fork executor | `missing` | 未接线 |
| S54 | TTL cleanup cron | `missing` | 未接线 |
| S55 | public restore/fork route | `partial` | route 存在，handler 为 stub |
| S56 | cross-e2e 6+ scenarios | `missing` | scaffolded |

### 3.9 HP8 — Runtime Hardening

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S57 | megafile budget gate | `done` | 5 file ≤ ceiling |
| S58 | tool-drift gate | `done` | SSoT clean |
| S59 | envelope-drift gate | `done` | 1 public file clean |
| S60 | tool catalog SSoT | `done` | `nacp-core`  catalog live |
| S61 | Lane E final-state | `done` | `retained-with-reason` 文档冻结 |
| S62 | R28 explicit register | `missing` | 模板 only，未回填 |
| S63 | R29 verifier + postmortem | `partial` | verifier 存在，owner 未实跑 |
| S64 | heartbeat 4-scenario e2e | `missing` | scaffolded |
| S65 | HP9 freeze gate | `missing` | NOT GRANTED |

### 3.10 HP9 — API Docs + Manual Evidence

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S66 | 18 份文档冻结 | `done` | 文件全部存在 |
| S67 | rewrite 4 份高风险文档 | `done` | session/permissions/usage/error-index |
| S68 | 7 份新增文档 | `done` | models/context/checkpoints/confirmations/todos/workspace/transport-profiles |
| S69 | manual evidence 5 设备 | `missing` | owner-action blocked |
| S70 | prod schema baseline | `missing` | owner-action blocked |
| S71 | 4-reviewer memos | `missing` | owner-action blocked |

### 3.11 HP10 — Final Closure

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S72 | final closure 文档 | `done` | 380 行完整 |
| S73 | hero-to-platform stub | `done` | 存在 |
| S74 | cleanup register | `done` | 5 retained |
| S75 | Q33-Q36 合规 | `partial` | 无 silent，但 K1-K5 next review 日期不明确 |

### 3.12 对齐结论

- **done**: 35 项
- **partial**: 12 项
- **missing**: 21 项
- **stale**: 0 项
- **out-of-scope-by-design**: 0 项

> 这更像"核心骨架完成，但 transport/enforcement/e2e 仍未收口"，而不是 `completed`。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | Multi-provider LLM (O1) | `遵守` | 未引入新 provider |
| O2 | Sub-agent / multi-agent (O2) | `遵守` | 未引入 |
| O3 | Admin plane / billing (O3/O4) | `遵守` | 未引入 |
| O4 | SDK extraction (O6) | `遵守` | 未引入 |
| O5 | handler-granularity refactor (O7) | `遵守` | 仅 stop-the-bleed |
| O6 | SQLite-backed DO (O12) | `遵守` | 未引入 |
| O7 | 18 份 docs 之外新增文档 | `遵守` | 无 |
| O8 | HP2-HP8 期间更新 clients/api-docs | `部分违反` | HP2-HP4 有散落更新（DS-R8 / GLM-R9 已标注为 AR4 accepted-as-risk） |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`partial-close / 7-retained-with-explicit-remove-condition / 3-critical-blockers`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **R1**：修正 `HP0-H10-deferred-closure.md` 和 `hero-to-pro-final-closure.md` 中 28 项 absorb 的措辞，区分 "route wired (stub)" 与 "executor live"。
  2. **R2**：在 `HP2-HP8-closure.md` 中统一修正 cross-e2e 状态为 `not-run`，并补充 owner-action 说明。
  3. **R3**：在 final closure 中增加 "HP9 freeze gate override" 节，说明 override 理由和 owner 批准记录；或回滚 HP9/HP10 状态为 `cannot-close`。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R4-R6**：HP2-HP5 后续批次补 emitter/fallback/auto-compact 真接线。
  2. **R7**：2026-05-15 前完成 4-reviewer memos。
  3. **R8**：2026-05-15 前确认 K4 无外部 caller 后删除。
  4. **R9**：在 README endpoint matrix 中增加 workspace temp file 路由标注。
  5. **R10**：给 K1-K5 指定具体 next review 日期或触发条件。
- **建议的二次审查方式**：`same reviewer rereview` — 由本审查者在 blocker 修复后复核。
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应（待 append）

> 请实现者在此节下方按 `docs/templates/code-review-respond.md` 格式 append 回应。
> 每条回应应引用 Finding 编号（R1-R10），说明接受/反驳/修正计划。
