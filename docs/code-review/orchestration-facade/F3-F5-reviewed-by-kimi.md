# Nano-Agent 代码审查模板

> 审查对象: `orchestration-facade / F3~F5`
> 审查时间: `2026-04-24`
> 审查人: `Kimi (k2p6)`
> 审查范围:
> - `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`
> - `docs/action-plan/orchestration-facade/F4-authority-hardening.md`
> - `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`
> - `docs/issue/orchestration-facade/F3-closure.md`
> - `docs/issue/orchestration-facade/F4-closure.md`
> - `docs/issue/orchestration-facade/F5-closure.md`
> - `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
> - `docs/handoff/orchestration-facade-to-next-phase.md`
> - `workers/agent-core/src/index.ts` (F3 legacy retirement)
> - `workers/orchestrator-core/src/index.ts` (F3/F5 probe marker)
> - `workers/orchestrator-core/src/policy/authority.ts` (F4)
> - `workers/orchestrator-core/src/auth.ts` (F4)
> - `workers/agent-core/src/host/internal-policy.ts` (F4)
> - `workers/agent-core/src/host/internal.ts` (F4)
> - `workers/orchestrator-core/src/user-do.ts` (F3-F4)
> - `workers/bash-core/src/executor.ts` (F4)
> - `workers/bash-core/test/executor.test.ts` (F4)
> - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs` (F4)
> - `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs` (F3)
> - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs` (F5)
> - `test/INDEX.md`
> - `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：F3~F5 的主体交付已成立，canonical cutover、authority hardening、final closure/handoff 均已完成，live evidence 真实存在。但跨阶段审查发现了 3 个此前未被记录的结构性缺口和 2 个文档与代码之间的事实矛盾，需要在 handoff 中显式标注为已知限制。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. **F3 legacy retirement 是一次 honest cutover**：同 PR 完成 7 个 HTTP action + 1 个 WS 的 typed 410/426，canonical suite 迁移完整，没有留下 dual-ingress 的灰色地带。
  2. **F4 authority layer 不是纸面 law**：`internal-policy.ts` 的 no-escalation enforcement、`policy/authority.ts` 的 trace law、5 worker 的 `TEAM_UUID` bootstrap 均已成为 runtime truth，negative tests 覆盖了 public/internal 两侧。
  3. **F0-F2 遗留的 R2/R3 在 F3-F5 中仍未修复**：`relay_cursor` 不计入 terminal frame、`completed`/`error` stream terminal 不触发 lifecycle ended，这两个问题从 F2 带入 F5，是当前阶段最显著的未收口技术债务。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/orchestration-facade/F3-canonical-cutover-and-legacy-retirement.md`
  - `docs/action-plan/orchestration-facade/F4-authority-hardening.md`
  - `docs/action-plan/orchestration-facade/F5-closure-and-handoff.md`
  - `docs/design/orchestration-facade/F0-compatibility-facade-contract.md`
  - `docs/design/orchestration-facade/F4-authority-policy-layer.md`
  - `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
  - `docs/handoff/orchestration-facade-to-next-phase.md`
  - `docs/code-review/orchestration-facade/F0-F2-reviewed-by-kimi.md`（跨阶段回溯）
- **核查实现**：
  - `workers/agent-core/src/index.ts`（legacy retirement 逻辑）
  - `workers/orchestrator-core/src/{index,auth,user-do,policy/authority}.ts`
  - `workers/agent-core/src/host/{internal,internal-policy}.ts`
  - `workers/bash-core/src/executor.ts`
  - `test/package-e2e/orchestrator-core/06-auth-negative.test.mjs`
  - `test/package-e2e/orchestrator-core/07-legacy-agent-retirement.test.mjs`
  - `test/cross-e2e/11-orchestrator-public-facade-roundtrip.test.mjs`
  - `workers/{orchestrator-core,agent-core,bash-core,context-core,filesystem-core}/wrangler.jsonc`
- **执行过的验证**：
  - `grep -n "legacy-session-route-retired\|legacy-websocket-route-retired" workers/agent-core/src/index.ts` — legacy retirement shape 确认
  - `grep -n "orchestration-facade-closed" workers/orchestrator-core/src/index.ts test/package-e2e/orchestrator-core/01-preview-probe.test.mjs` — terminal marker 确认
  - `grep -n "TEAM_UUID" workers/*/wrangler.jsonc` — 5 worker bootstrap 确认
  - `grep -n "beforeCapabilityExecute" workers/bash-core/src/executor.ts workers/bash-core/test/executor.test.ts` — executor seam 确认
  - `grep -n "validateInternalAuthority" workers/agent-core/src/host/internal.ts` — internal policy 接入确认
  - `grep -n "readTraceUuid\|ensureConfiguredTeam" workers/orchestrator-core/src/policy/authority.ts workers/orchestrator-core/src/auth.ts` — trace law 确认
  - `grep -n "relay_cursor" workers/orchestrator-core/src/user-do.ts` — cursor 语义复核
  - 交叉核对 F3/F4/F5 closure 中的 claims 与代码事实

### 1.1 已确认的正面事实

- F3 legacy HTTP retirement 覆盖 7 个 action（start/input/cancel/end/status/timeline/verify），WS retirement 覆盖 1 个路径，均返回 typed JSON body + canonical hint。
- `agent-core` package-e2e 仅剩 `01-preview-probe`，session-facing 测试全部删除；`orchestrator-core` package-e2e 拥有 7 个文件 12+ subtests，成为 canonical suite。
- Cross-e2e 的 11 个文件全部存在，其中 `11-orchestrator-public-facade-roundtrip` 覆盖 `JWT -> orchestrator -> agent -> bash -> stream back` 的完整拓扑。
- `workers/orchestrator-core/src/policy/authority.ts` 真实存在，提供 `ensureConfiguredTeam`、`readTraceUuid`、`jsonPolicyError`。
- `workers/agent-core/src/host/internal-policy.ts` 真实存在，实现 `validateInternalAuthority`，覆盖 secret gate、trace law、authority header JSON 校验、body/header no-escalation、tenant truth。
- 5 个 worker 的 `wrangler.jsonc` 均显式配置 `TEAM_UUID = "nano-agent"`，`_unknown` fallback 已被驱逐。
- `bash-core/src/executor.ts` 的 `beforeCapabilityExecute` seam 存在，测试覆盖 happy path 与 fail-closed。
- `auth.ts` 中的 `signJwt` 已被移除生产代码路径，测试使用独立的 `test/jwt-helper.ts`（F0-F2 的 R5 已修复）。
- `user-do.ts` 已引入 `parseStreamFrame` 手动 discriminator 校验，替代了早期的裸 `JSON.parse() as StreamFrame`（F0-F2 的 R1 已修复）。
- `04-reconnect.test.mjs` 现包含 2 个 liveTest，覆盖 detached-success 与 terminal/missing taxonomy（F0-F2 的 R4 已修复）。
- Final closure、handoff memo、F5 closure、terminal probe marker 均已落地。

### 1.2 已确认的负面事实

- `workers/orchestrator-core/src/user-do.ts:611` 的 `forwardFramesToAttachment` 仍只对 `kind === 'event'` 推进 `relay_cursor`，`terminal` frame 被跳过。这与 `F0-stream-relay-mechanism.md` §7.2 "terminal frame 也计入已 forward 序列" 不一致（F0-F2 R2 未修复）。
- `handleStart`（:324-392）与 `handleInput`（:394-433）在消费 stream frames 后，不检测 `terminal: completed|error`，不迁移 lifecycle 到 `ended`，不写入 `SessionTerminalRecord`（F0-F2 R3 未修复）。
- `handleStart` 在 `startAck.response.ok === false` 时直接返回错误响应，但此前已写入 storage 的 `startingEntry` 不会回滚，留下 ghost starting session。
- `readInternalStream`（:699-717）在 `forwardInternalRaw` 返回非 ok 时返回 `{ ok: true, frames: [] }`，掩盖了 stream 读取失败的真实原因。
- F3 closure 声称 "probe marker 已 rollover 到 `orchestration-facade-F3`"，但代码历史显示 marker 从 F2 直接跳到了 F5 的 `orchestration-facade-closed`，F3 声称的中间态在代码中无物化证据。
- `test/INDEX.md` 声称 "44 subtests / 44 pass"，但 F4/F5 closure 分别报告 46/46 和 47/47 pass，INDEX 的 subtest 计数未随 F4/F5 的 suite 扩充而更新。
- F4 action-plan P3-02 要求 "先 grep 确认 `packages/capability-runtime` 无 runtime consumers"，但 closure 与代码中均未留下该 grep 的结果或结论记录。

---

## 2. 审查发现

### R1. `relay_cursor` 仍不计入 terminal frame（跨阶段遗留，F0-F2 R2 未修复）

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:611`：`if (frame.kind !== 'event') continue;`
  - `F0-stream-relay-mechanism.md` §7.2 原文："terminal frame 也计入已 forward 序列"。
- **为什么重要**：
  - cursor 是 reconnect resume 的核心依据。如果 terminal seq 大于最后一个 event seq，但 cursor 未推进，reconnect 可能重复消费 terminal frame 或产生 off-by-one。
- **审查判断**：
  - 这是一个跨阶段 persistent drift。F2 closure 声称已修正，但 F4/F5 的代码中该逻辑未变。说明 F2 的 "修正" 实际上是把 design 改成了实现的样子，而不是把实现改成了 design 的样子，但未同步更新 design doc。
- **建议修法**：
  - 方案 A：修改 `forwardFramesToAttachment`，对 `event` 和 `terminal` 都推进 cursor（`meta` 可继续跳过，因为 seq=0 是固定起点）。同步更新 `F0-stream-relay-mechanism.md` 明确 `meta` 不计入、`terminal` 计入。
  - 方案 B：如果坚持当前语义，必须在 design doc 中显式修改 cursor 定义，并评估 reconnect 逻辑的影响。

### R2. completed/error stream terminal 不触发 lifecycle ended（跨阶段遗留，F0-F2 R3 未修复）

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `handleStart`（:365-392）与 `handleInput`（:414-433）读取 stream frames 后，仅调用 `forwardFramesToAttachment`，不检查是否存在 `terminal: completed|error`。
  - 当前只有 `handleCancel`（:450-476）会写入 `ended` 状态与 `SessionTerminalRecord`。
  - `F0-session-lifecycle-and-reconnect.md` §7.2 状态机表格：`completed` / `error` 均映射到 `lifecycle.status = "ended"`。
- **为什么重要**：
  - 如果 agent-core 的 session 正常完成或因错误终止，façade 侧永远保留为 `detached`，不会进入 ended retention 清理，也不会在 reconnect 时返回 `session_terminal`。这与设计状态机直接矛盾，长期导致 user DO storage 中积累实际上已终结的 session entry。
- **审查判断**：
  - F2 closure 声称 "F1 时 internal stream 的 terminal frame 被错误当成 session terminal；F2 已把'request 完成'与'session ended'重新分开"。我理解其意图，但 "分开" 不意味着 "忽略"。当前代码对 completed/error 的处理是完全缺失的，不是 "分开"。
- **建议修法**：
  - 在 `handleStart` / `handleInput` 的 frame 消费后，若检测到 `terminal: completed` 或 `terminal: error`，应迁移 session 状态到 `ended`，写入 `SessionTerminalRecord`，调用 `rememberEndedSession` 与 `notifyTerminal`。
  - 若认为 completed/error 的判定需要额外的 session-level terminal law，应在代码中显式 TODO/FIXME 并纳入下一阶段 action-plan，而不是静默忽略。

### R3. `handleStart` 失败时留下 ghost starting session

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:348-349`：先 `put(sessionKey, startingEntry)`。
  - `:357-363`：若 `startAck.response.ok === false`，直接返回错误响应，不清理已写入的 `startingEntry`。
- **为什么重要**：
  - 一个 start 失败的 session 会以 `starting` 状态永久留在 user DO storage 中（直到被 cleanup 以 24h+100 规则清理）。这会污染 registry，并在后续 reconnect 时产生不可预测的行为（`starting` 不是 reconnect 的有效入口状态，但也不会被识别为 terminal/missing）。
- **审查判断**：
  - 属于错误路径的 cleanup 缺失。虽然 start 失败不是高频场景，但 façade 作为 session owner 应保证错误路径下的 registry 一致性。
- **建议修法**：
  - 在 `startAck.response.ok === false` 的分支中，追加 `await this.put(sessionKey(sessionUuid), {...startingEntry, status: 'ended', ended_at: now})` 或显式删除该 session entry。

### R4. `readInternalStream` 掩盖 stream 读取失败

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `workers/orchestrator-core/src/user-do.ts:701`：`if (!response.ok) return { ok: true, frames: [] };`
- **为什么重要**：
  - 如果 `agent-core` 的 `/internal/stream` 返回 404（session 不存在）或 500（内部错误），façade 侧将其解释为空 frame 列表，而不是错误。这会导致调用者（`handleStart` / `handleInput` / `handleWsAttach`）认为 stream 成功但无事件，从而返回 200 而非错误响应。
- **审查判断**：
  - 在 F1 首次实现时，这种 "宽容" 可能有助于 first roundtrip 的稳定性。但在 F5 阶段，internal contract 已稳定，不应再继续掩盖下游错误。
- **建议修法**：
  - 将 `!response.ok` 分支改为返回 `{ ok: false, response: ... }`，并在调用者处处理 stream 读取失败（例如返回 502 或 503）。

### R5. F3 closure 中的 probe marker 声明与代码事实矛盾

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - F3 closure 原文："`workers/orchestrator-core/src/index.ts` probe marker 已 rollover 到 `orchestration-facade-F3`"。
  - 当前代码 `workers/orchestrator-core/src/index.ts:22,33`：`phase: "orchestration-facade-closed"`。
  - `git log` 显示 F3/F4/F5 在同一个执行链内完成，F4 closure 说明 "F4 原计划中的短暂 probe marker 过渡态已被终态 marker 吸收"。
- **为什么重要**：
  - closure 是阶段审计的核心依据。如果 closure 声称的代码事实与实际代码历史不一致，会降低 closure 的可信度，也可能误导 downstream 的 phase 审计。
- **审查判断**：
  - 这是一个文档与代码之间的时间线矛盾。F3 的 "orchestration-facade-F3" marker 可能只在极短的 commit 中存在，随后被 F5 的 "closed" 覆盖。但 F3 closure 没有注明这一后续覆盖。
- **建议修法**：
  - 在 F3 closure 中追加附注说明 "由于 F4/F5 在同一执行链内紧接着完成，当前 HEAD 的 marker 已为 `orchestration-facade-closed`"。或接受现状，但在 final closure 中统一说明 marker 历史。

### R6. `test/INDEX.md` 的 subtest 计数未随 F4/F5 更新

- **严重级别**：`low`
- **类型**：`docs-gap`
- **事实依据**：
  - `test/INDEX.md:34`："当前状态（2026-04-24）：`44 subtests / 44 pass / 0 fail / 0 skip`"。
  - F4 closure："`pnpm test:package-e2e` → `35 / 35 pass`; `pnpm test:cross` → `46 / 46 pass`"。
  - F5 closure："`pnpm test:package-e2e` → `35 / 35 pass`; `pnpm test:cross` → `47 / 47 pass`"。
- **为什么重要**：
  - INDEX.md 是测试树的单一真相源。如果其计数与实际运行结果长期不一致，维护者会难以判断 suite 的健康状态。
- **审查判断**：
  - 可能是 F3 更新 INDEX 后，F4/F5 新增了 auth-negative、legacy-retirement、final-roundtrip 等测试，但 INDEX 未被同步更新。
- **建议修法**：
  - 重新统计 package-e2e 与 cross-e2e 的 subtest 总数，更新 INDEX.md 的 "覆盖面总结" 与 "当前状态" 行。

### R7. F4 action-plan 的 deprecated package consumer grep 无记录

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **事实依据**：
  - F4 action-plan P3-02 要求："启动前先 grep 确认 `packages/capability-runtime` 无 runtime consumers，若仍有则同步 patch 或先清消费者"。
  - F4 closure 的 7 项交付中未提及该 grep 的结果。
  - 代码中未发现相关 grep 记录或结论注释。
- **为什么重要**：
  - 如果 `packages/capability-runtime` 仍有未发现的 runtime consumer，executor seam 的修改可能会破坏下游代码。F4 的 no-escalation enforcement 和 executor recheck 假设了 "没有遗留消费者"，但这一假设未经验证记录。
- **审查判断**：
  - 属于过程缺口。虽然当前仓库中 `packages/capability-runtime` 很可能确实没有消费者，但 "没有记录" 不等于 "已确认"。
- **建议修法**：
  - 补一个 grep 结果记录（例如在 `workers/bash-core/README.md` 或 F4 closure 中追加一行），明确声明 "已 grep 确认 `packages/capability-runtime` 无 runtime consumers"。

---

## 3. In-Scope 逐项对齐审核

### F3 — Canonical Cutover and Legacy Retirement

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 新建并填充 orchestrator canonical public suite | `done` | 7 个测试文件落地，agent-core session tests 已删除。 |
| S2 | 迁移 package-e2e / cross-e2e / live.mjs / INDEX.md | `done` | cross-e2e 11 个文件全部存在， affected tests 已切到 orchestrator。 |
| S3 | agent-core legacy HTTP 410 / WS 426 | `done` | 7 HTTP actions + 1 WS 路径均返回 typed retirement envelope。 |
| S4 | cutover closure + legacy negative tests | `done` | `07-legacy-agent-retirement.test.mjs` 覆盖 HTTP 与 WS retirement。 |

### F4 — Authority Hardening

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | centralized legality helper | `done` | `policy/authority.ts` + `internal-policy.ts` 已落地。 |
| S2 | TEAM_UUID bootstrap + tenant_source snapshot | `done` | 5 worker wrangler.jsonc 显式配置，auth snapshot 含 tenant_source。 |
| S3 | no-escalation + executor recheck seam | `done` | body/header authority 比对、trace 比对、executor `beforeCapabilityExecute` 均落地。 |
| S4 | negative tests + F4 closure | `done` | 06-auth-negative 覆盖 4 个负例，executor test 覆盖 recheck fail-closed。 |

### F5 — Closure and Handoff

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | F0-F4 evidence review + final topology verification | `done` | 5 份 closure 齐全，cross-e2e/11 作为 final roundtrip 存在。 |
| S2 | final closure | `done` | `orchestration-facade-final-closure.md` 存在且内容完整。 |
| S3 | handoff memo + F5 closure | `done` | handoff memo 明确区分 assumption/open items/operational disciplines。 |
| S4 | meta-doc 同步与阶段翻转 | `done` | charter 状态已改为 closed，probe marker 已翻为 terminal。 |

### 3.1 对齐结论

- **done**: `16`
- **partial**: `0`
- **missing**: `0`

> F3-F5 的 action-plan 交付物全部落地。阶段级 In-Scope 无缺失。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 重造产品级 public API | `遵守` | 保持 compatibility-first `/sessions/:id/*` 形状。 |
| O2 | 删除 GET / /health probe | `遵守` | agent-core 与 orchestrator-core 的 probe 均保留。 |
| O3 | 迁移 bash/context/filesystem 的 internal posture suites | `遵守` | 这三个 worker 的测试未被动迁移。 |
| O4 | 引入完整 WS-only live suite | `遵守` | WS 测试限于 attach/reconnect/final roundtrip。 |
| O5 | credit/quota/billing domain | `遵守` | F4 只做 law，不做 domain；executor seam 为未来预留。 |
| O6 | multi-tenant-per-deploy | `遵守` | 5 worker 的 TEAM_UUID 仍绑定 single-tenant deploy truth。 |
| O7 | F5 代写下一阶段 charter | `遵守` | handoff memo 只给 inputs，未越位写 charter 正文。 |
| O8 | F5 回头重做 F1-F4 实现 | `遵守` | F5 只消费已完成事实。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：F3~F5 的主体交付已成立，canonical cutover、authority hardening、final closure/handoff 均已完成，live evidence 真实存在，阶段可以闭合。但跨阶段审查发现 3 个结构性代码缺口（R1-R4）和 2 个文档/过程矛盾（R5-R7），这些不影响阶段级 closure，但必须在 handoff 中显式标注为已知限制，以免下一阶段在不知情的情况下继承。
- **是否允许关闭本轮 review**：`yes`
- **关闭前必须完成的 blocker**：
  1. 无。当前无 critical 级别问题。
- **可以后续跟进的 non-blocking follow-up**：
  1. **R1 / R2（跨阶段遗留）**：修复 `relay_cursor` 对 terminal frame 的计入语义，以及 `completed`/`error` terminal 到 lifecycle `ended` 的映射。建议在下一阶段（authority-domain 或 streaming charter）的首个周期中作为 "已知债务" 修复。
  2. **R3**：在 `handleStart` 的 agent-start-failed 分支中清理 ghost starting session。
  3. **R4**：将 `readInternalStream` 的 `!response.ok` 分支从 "返回空 frames" 改为 "返回错误"，并更新调用者。
  4. **R5**：在 F3 closure 或 final closure 中追加附注，说明 probe marker 的实际历史。
  5. **R6**：更新 `test/INDEX.md` 的 subtest 计数与覆盖面总结，使其与 F5 实际 suite 一致。
  6. **R7**：补一个 `packages/capability-runtime` 无 runtime consumers 的 grep 结论记录。

---

## 附录：跨阶段 F0~F5 全景回顾

### A.1 阶段级技术债务清单

| 债务项 | 首次发现 | 当前状态 | 影响范围 | 建议处理时机 |
|--------|----------|----------|----------|-------------|
| relay_cursor 不计入 terminal | F0-F2 review R2 | `未修复` | reconnect/resume | 下一阶段首个周期 |
| completed/error 不触发 ended | F0-F2 review R3 | `未修复` | lifecycle/retention | 下一阶段首个周期 |
| handleStart 失败留下 ghost session | 本次审查 R3 | `新发现` | registry 一致性 | 下一阶段首个周期 |
| readInternalStream 掩盖失败 | 本次审查 R4 | `新发现` | error path 透明度 | 下一阶段首个周期 |

### A.2 文档与代码之间的事实矛盾

| 矛盾点 | 文档声明 | 代码事实 | 建议 |
|--------|----------|----------|------|
| F3 probe marker | F3 closure 声称 "已 rollover 到 F3" | 代码中无 F3 marker，直接从 F2 跳到 closed | 在 F3 closure 中追加附注 |
| INDEX subtest 计数 | INDEX 声称 44 subtests | F5 实际 47/47 pass | 更新 INDEX.md |

### A.3 阶段级架构健康度评估

| 维度 | 评级 | 说明 |
|------|------|------|
| public owner 清晰度 | ✅ 优秀 | orchestrator-core 已成为唯一 canonical ingress，legacy 已退役 |
| runtime host 分离度 | ✅ 优秀 | agent-core 的 `/internal/*` 与 legacy 退役清晰 |
| authority layer 完整度 | ✅ 良好 | trace/tenant/no-escalation 均落地，负例覆盖充分 |
| session lifecycle 闭合度 | ⚠️ 中等 | `ended` 状态仅由 `cancel` 触发，completed/error 路径缺失 |
| stream relay 健壮度 | ⚠️ 中等 | frame 校验已补齐，但 cursor 语义与 failure transparency 仍有缺口 |
| docs/tests 同步度 | ⚠️ 中等 | 主体同步，但计数与时间线声明存在偏差 |
| handoff 可消费度 | ✅ 优秀 | final closure、handoff memo、operational disciplines 齐备 |

### A.4 对下一阶段的关键建议

1. **不要忽略跨阶段债务**：R1-R4 虽然不会立即导致系统崩溃，但会在 richer reconnect、session analytics、history archive 阶段被放大。建议在下一阶段 charter 中明确列出 "补齐 orchestration-facade 已知债务" 作为首批工作项。
2. **继续保持 probe marker 纪律**：F5 的 `orchestration-facade-closed` 是 terminal marker，下一阶段应使用新的 marker（例如 `credit-domain-F1` 或 `streaming-v2-F1`），不要复用 F1-F4 的编号。
3. **强化 error path 的透明度**：当前代码在 internal binding、stream read、start failure 等路径上存在 "宽容 fallback" 的习惯（返回空结果或静默忽略），这在 first-wave 是合理的，但在 authority-domain 阶段必须收紧。

---

## 8. 对 Kimi 代码审查质量的评价

> 评价人: `GPT-5.4`
> 评价时间: `2026-04-24`
> 评价依据: `workers/orchestrator-core/src/user-do.ts`, `workers/orchestrator-core/test/user-do.test.ts`, `test/INDEX.md`, `docs/issue/orchestration-facade/{F3-closure,F4-closure}.md`

### 8.1 一句话评价
Kimi 这轮最擅长抓具体的 owner-DO 错误路径与文档漂移，问题落点很“能修”，但对跨阶段 lifecycle / relay 语义的两条回看仍然沿用了旧假设，没有完全跟上 F2 之后的 snapshot-over-NDJSON 现实。

### 8.2 优点
1. R3、R4、R5、R6、R7 都很实用：ghost starting session、stream error 被吞、F3 marker 文档矛盾、INDEX 计数漂移、grep 记录缺失，几乎都能直接转成当前 patch。
2. 对 closure 与 test-index 的事实校对很细，能把“代码可能没坏，但文档已经开始撒谎”的问题及时揪出来。

### 8.3 事实确认 - 审核文档中，所有真实存在的问题
1. R3 成立：`handleStart()` 在 internal start 失败时原先确实会留下 ghost `starting` entry；本轮已在失败分支删除 session key。
2. R4 成立：`readInternalStream()` 原先会把 non-ok internal stream 吞成空 frames；本轮已改成 `{ ok: false, response }` 并补了测试。
3. R5 成立：F3 closure 现已补充 marker 历史说明。
4. R6 成立：`test/INDEX.md` 原先的手工 subtest 统计已过期，本轮已改成真实通过数 + 文件数的更稳写法。
5. R7 成立：F4 closure 现已追加 capability-runtime consumer grep 结论。

### 8.4 事实错误 - 审核文档中，所有的事实错误
1. R1 不成立：当前 first-wave reconnect/cursor truth 并不把 terminal frame 当成必须推进 `relay_cursor` 的 canonical law；继续沿用 F0-F2 早期预设，会误把当前 snapshot relay 语义当成 bug。
2. R2 不成立：当前 `/internal/stream` 的 `terminal` 更接近“本次 request/stream 完结”而不是严格的 session-ended 事实；在没有新的 session-level terminal law 前，不能把所有 `completed/error` terminal 直接映射为 façade `ended`。

---
以上内容均不局限于只有2个，如果多个请一一列举。
---

### 8.5 评分 - 总体 **4.2 / 5**

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 4 | 针对 user-do 与 docs drift 的证据很具体。 |
| 判断严谨性 | 4 | 多数 finding 很准，但 R1/R2 仍受旧阶段语义影响。 |
| 修法建议可执行性 | 5 | R3-R7 基本都可以直接转成当前 patch。 |
| 对 action-plan / design 的忠实度 | 4 | 能回看 design/closure，但对 F2 之后的 relay/terminal 语义更新跟得不够彻底。 |
| 协作友好度 | 4 | 列表化、问题切片清楚，便于 implementer 执行。 |
