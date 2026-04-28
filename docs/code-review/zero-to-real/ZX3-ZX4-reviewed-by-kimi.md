# ZX3~ZX4 阶段代码审查报告

> 审查对象: `zero-to-real / ZX3-components-deprecation + ZX4-transport-true-close-and-session-semantics`
> 审查类型: `mixed (code-review + closure-review + cross-phase architecture review)`
> 审查时间: `2026-04-28`
> 审查人: `kimi (K2p6)`
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`
> - `docs/issue/zero-to-real/ZX3-closure.md`
> - `docs/issue/zero-to-real/ZX4-closure.md`
> - `workers/orchestrator-core/src/{user-do.ts,session-truth.ts,session-lifecycle.ts,session-read-model.ts,parity-bridge.ts,ws-bridge.ts,index.ts}`
> - `workers/agent-core/src/{host/do/nano-session-do.ts,host/internal.ts,index.ts}`
> - `test/{root-guardians,cross-e2e,shared}/**`
> - `packages/` 目录树
> - `pnpm-workspace.yaml` / `package.json`
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` §4.3 + §5 R11-R31 + §8.2
> - `docs/transport/transport-profiles.md`
> - `docs/runbook/zx2-rollback.md`
> - `docs/templates/code-review.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：ZX3 与 ZX4 的主体工程骨架已完成，物理删除与 transport 真收口的目标已达成；但存在文档口径滞后、deploy-only 根因未定位、ops gap 未闭合等 follow-up 项，本轮不应标记为"零残留完成"。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`，但须在 closure 中追加 §3.1 的 3 项 blocker 与 §3.2 的 4 项 follow-up
- **本轮最关键的 1-3 个判断**：
  1. `test/INDEX.md` 存在与物理删除事实矛盾的文档裂缝（§2 R1）。
  2. R28 deploy-only 500 的根因未被定位，仅被 outer try/catch 掩盖（§2 R4）。
  3. ZX4 P4/P6 的 permission/elicitation contract 已 land，但 runtime kernel waiter 未接通，closure 中对此的表述不够醒目（§2 R7）。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`（v2 增强版，Opus 4.7, 2026-04-27）
  - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`（v3 post-GPT 二审，Opus 4.7, 2026-04-28）
  - `docs/issue/zero-to-real/ZX3-closure.md`
  - `docs/issue/zero-to-real/ZX4-closure.md`
  - `docs/issue/zero-to-real/ZX2-closure.md` §4.3 + §5 + §8.2（carryover mapping 对账）
- **核查实现**：
  - `workers/orchestrator-core/src/user-do.ts`（1910 行，P0 seam + P3 D1 + P4/P6 contract + P9 flip）
  - `workers/agent-core/src/host/do/nano-session-do.ts`（1905 行，R28/R29 fix）
  - `workers/agent-core/src/host/internal.ts`（P9 flip，仅保留 stream/stream_snapshot）
  - `workers/orchestrator-core/migrations/006-pending-status-extension.sql`（283 行，table-swap）
  - `test/cross-e2e/zx2-transport.test.mjs`（ZX4 e2e 扩展段）
  - `test/root-guardians/test-command-coverage.test.mjs`
  - `docs/transport/transport-profiles.md`
  - `docs/runbook/zx2-rollback.md`
- **执行过的验证**：
  - `pnpm test:contracts` → 31/31 pass
  - `pnpm -F @haimang/orchestrator-core-worker test` → 75/75 pass
  - `pnpm -F @haimang/agent-core-worker test` → 1056/1056 pass
  - `pnpm -F @haimang/bash-core-worker test` → 374/374 pass
  - `ls packages/` → 6 项（全 keep-set），`ls test/` → 4 layer，`test -d test-legacy` → DELETED
  - `grep -c "agent-runtime-kernel\|capability-runtime\|llm-wrapper\|context-management\|hooks\|session-do-runtime" pnpm-lock.yaml` → 6（stale 块存在）
- **复用 / 对照的既有审查**：
  - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-kimi.md` — 仅作为跨阶段连续性线索，所有结论独立复核
  - `docs/eval/zero-to-real/ZX4-action-plan-reviewed-by-GPT.md` + `ZX4-ZX5-action-plan-reviewed-by-GPT.md` — 作为 plan scope 收敛的 upstream 输入，不作为代码正确性依据

### 1.1 已确认的正面事实

- `test-legacy/` 已物理删除，repo 中无残留 import（代码层）。
- 6 个 duplicate package（agent-runtime-kernel / capability-runtime / llm-wrapper / context-management / hooks / session-do-runtime）已从 `packages/` 物理删除。
- `packages/` 收敛到 6 个 keep-set：nacp-core / nacp-session / orchestrator-auth-contract / workspace-context-artifacts / storage-topology / eval-observability。
- `test/` 4-layer canonical 树（shared / root-guardians / package-e2e / cross-e2e）已建立，`package.json` scripts 已切换。
- ZX4 P0：user-do.ts 从 1950 行瘦身到 1659 行，4 个 seam 模块（parity-bridge / ws-bridge / session-lifecycle / session-read-model）合计 447 行，零回归。
- ZX4 P1：R28 改用 AbortController + signal 同请求生命周期取消；R29 删除 stateful `phase` / `defaultEvalRecordCount` 字段。
- ZX4 P2：parity log 升级到 JSON pointer + field-level delta，18 个 unit test 覆盖。
- ZX4 P3：migration 006 已 apply 到 remote D1（32 commands / 34ms）；`nano_conversation_sessions.session_status` CHECK 扩到 6 状态；P3-07 ingress guard 11 个 unit test 覆盖。
- ZX4 P4/P6：permission decision + elicitation answer contract 全栈 land（orchestrator-core KV + best-effort RPC → agent-core DO storage）。
- ZX4 P5：handleUsage 真读 D1 `nano_usage_events` + `nano_quota_balances`。
- ZX4 P9：`forwardInternalJsonShadow` 删 fetch fallback 与 parity 比较；`agent-core/host/internal.ts` 收紧到 `{stream, stream_snapshot}`；`internal-http-compat: retired` 文档落地；runbook 标注 archive date `2026-05-12`。
- 全量测试：orchestrator-core 75 + agent-core 1056 + bash-core 374 + root-guardians 31 = **1536/1536 pass**，零回归。

### 1.2 已确认的负面事实

- `test/INDEX.md:176-178` 仍宣称 "`test-legacy/` 继续保留历史 contract / guardian 价值"，与物理删除事实直接矛盾。
- `pnpm-lock.yaml` 仍含 6 个已删 package 的 stale 块（ZX3 closure 已记录为 owner-action，至今未执行）。
- `docs/runbook/zx2-rollback.md` 内文 §1.1/§2.1 仍描述 "`forwardInternalJsonShadow` 在 `typeof rpc !== 'function'` 时自动退化为 HTTP 路径"，这在 P9 flip 后已不成立。
- R28 `verifyCapabilityCancel` 在 preview deploy 仍返 500 "Worker threw exception"（ZX4 closure §3.1 已 ack）。Phase 7 的 outer try/catch 仅将 500 转换为 diagnostic envelope，未定位根因。
- migration 006 仅 apply 到 preview D1，prod 未应用（ZX4 closure §4 风险表已记录）。
- agent-core PermissionRequest / ElicitationRequest hook 的 await DO storage waiter 未实现；usage WS push `session.usage.update` 未实现（ZX4 scope-out 到 ZX5，但 closure 中标记为 "contract done / runtime hookup deferred" 的醒目程度不足）。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐行核对了 user-do.ts / nano-session-do.ts / internal.ts / migration 006 / transport-profiles.md / runbook |
| 本地命令 / 测试 | yes | root-guardians + orchestrator-core + agent-core + bash-core 全量通过 |
| schema / contract 反向校验 | yes | migration 006 CHECK 与 session-truth.ts `DurableSessionStatus` / session-lifecycle.ts `SessionStatus` 逐值核对 |
| live / deploy / preview 证据 | yes (间接) | 依赖 ZX4 closure 中记录的 deploy Version IDs 与 cross-e2e 结果；本地 sandbox 无法直接 deploy，但 unit test 与 e2e parse 验证通过 |
| 与上游 design / QNA 对账 | yes | 对照 ZX2 closure carryover mapping §11+§12 逐项核对 R28/R29/R30/R16/R27 等落点 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `test/INDEX.md` 文档裂缝：仍宣称 test-legacy 存在 | medium | docs-gap | no | 删除 §7 并更新版本历史 |
| R2 | `pnpm-lock.yaml` stale 块未清理 | low | delivery-gap | no | owner 注入 NODE_AUTH_TOKEN 后 `pnpm install` |
| R3 | runbook 内文未随 P9 flip 同步重写 | medium | docs-gap | no | 重写 §1.1/§2.1 为 "P9 后无 HTTP 回退路径" |
| R4 | R28 deploy-only 500 根因未定位，仅被 try/catch 掩盖 | high | correctness | yes (follow-up) | 在 ZX5 或独立 hotfix 中用 wrangler tail 定位根因 |
| R5 | Phase 8 fast-track burst 不等价于 7-day 观察 | medium | test-gap | no | 在 ZX5 启动后补 7-day 观察，或明确接受 fast-track 风险 |
| R6 | migration 006 未 apply 到 prod D1 | high | platform-fitness | yes | prod deploy 前必须执行 `wrangler d1 migrations apply --env prod --remote` |
| R7 | P4/P6 runtime kernel waiter 未接通，closure 标记不够醒目 | medium | scope-drift | no | 在 ZX4 closure §3.2 加显式 "contract land, runtime NOT wired" 标注 |
| R8 | forwardInternalJsonShadow 方法名与注释中的 "P3-05 flip" 时间锚点混淆 | low | docs-gap | no | 注释改为 "ZX4 P9 flip" |

### R1. `test/INDEX.md` 文档裂缝：仍宣称 `test-legacy/` 存在

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `test/INDEX.md:13` — "不是 `test-legacy/` 里的旧 contract / root guardian 树"
  - `test/INDEX.md:176-178` — "`test-legacy/` 继续保留历史 contract / guardian 价值；新的 `test/` 只负责 **deploy-time live E2E**。两棵树的职责不要再混写。"
  - `test-legacy/` 已在 ZX3 Phase 5 物理删除（`rm -rf test-legacy/`）。
- **为什么重要**：文档是后续贡献者的首要真相来源。若新成员读到 "test-legacy 继续保留"，会花费时间寻找已不存在的目录，或误以为仓库存在某种"归档但未删除"的中间态。
- **审查判断**：这是典型的"代码已删、文档未改"裂缝。ZX3 closure 声称 "docs sync" 已完成，但遗漏了 `test/INDEX.md`。
- **建议修法**：
  1. 删除 `test/INDEX.md` §7（与 `test-legacy/` 的关系）整节。
  2. 更新 §8 版本历史，追加 `v0.4` 行记录 ZX3 cutover 后 test-legacy 已删除。
  3. 将 §0 "不是什么" 中的 "不是 `test-legacy/` 里的旧 contract" 改为 "不是已归档的 legacy contract 树（ZX3 已物理删除）"。

### R2. `pnpm-lock.yaml` stale 块未清理

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `grep -c "agent-runtime-kernel\|capability-runtime\|llm-wrapper\|context-management\|hooks\|session-do-runtime" pnpm-lock.yaml` → **6**
  - ZX3 closure §3.1 已记录为 owner-action："`pnpm-lock.yaml` 一次清理 — 需 `NODE_AUTH_TOKEN` 注入后 `pnpm install`"
- **为什么重要**：stale lockfile 块不会导致功能错误，但会拖慢 install 速度、增加 lockfile diff 噪音，并在未来 Renovate/Dependabot 流程中制造困惑。
- **审查判断**：ZX3 执行人正确识别了这个问题并标记为 owner-action，但至今未执行。这不阻塞 ZX3/ZX4 close，但应在 prod deploy 前顺手清理。
- **建议修法**：owner 在任意 deploy 窗口执行 `NODE_AUTH_TOKEN=<token> pnpm install` 后提交更新的 lockfile。

### R3. runbook 内文未随 P9 flip 同步重写

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/runbook/zx2-rollback.md` 头部已加 ZX4 Phase 9 update block + archive date `2026-05-12`。
  - 但 §1.1 仍写："orchestrator-core `forwardInternalJsonShadow` 在 `typeof rpc !== 'function'` 时**自动退化为 HTTP 路径**"
  - §2.1 仍描述软回滚步骤："取消 orchestrator-core 的 `AGENT_CORE.input/cancel/verify/timeline/streamSnapshot` 绑定... 自动退化为 HTTP 路径"
  - 实际上 P9 flip 后 `forwardInternalJsonShadow` 已无 HTTP fallback 分支，无 binding 时直接返 503 `agent-rpc-unavailable`。
- **为什么重要**：runbook 是 prod regression 时的操作手册。若运维人员按旧 runbook 执行 "软回滚"，期望看到 HTTP 路径自动生效，实际会得到 503，造成误判。
- **审查判断**：头部更新 ≠ 内文重写。P9 flip 后 runbook 的 "软回滚" 概念已不存在（因为 HTTP handler 已被删除），需重新定义为 "重新启用 internal-http-compat profile" 的重型流程。
- **建议修法**：
  1. 在 §1 加 "P9 后状态" 子节，明确说明软回滚已不可用。
  2. 重写 §2 为 "重新启用流程"（需代码 revert + rebuild + redeploy，不再是 secret toggle）。
  3. 删除所有提到 "`typeof rpc !== 'function'` 自动退化" 的句子。

### R4. R28 deploy-only 500 根因未定位，仅被 try/catch 掩盖

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`yes`（作为 follow-up，不阻塞 ZX4 close）
- **事实依据**：
  - ZX4 closure §1.8 / §3.1："`POST /verify {check: capability-cancel}` 返 500 'Worker threw exception'... verification harness 路径，无 user-facing 影响"
  - `nano-session-do.ts:1725-1825`：Phase 7 加了 outer try/catch，将 500 转换为 diagnostic envelope（`verify-cancel-internal` error code）。
  - 但 closure 明确写："根因疑在 RPC 调用栈上层（orchestrator-core's User-DO `await rpc` 后某环节抛出）"
  - cross-e2e 03 在 preview deploy 仍 fail。
- **为什么重要**："无 user-facing 影响" 不等于 "无 bug"。`verifyCapabilityCancel` 是 capability transport 的验证路径，若根因是 transport seam 中的深层 race 或 state machine 不一致，可能在其他 action（如 `cancel`）的边界条件下复现。try/catch 掩盖了根因，使问题无法被诊断。
- **审查判断**：ZX4 的处置（降级为 known carryover + 不阻塞 close）在 owner direction 下合理，但应在 closure 中更明确地标记为 "根因未定位，需 wrangler tail 深挖"。
- **建议修法**：
  1. 在 ZX4 closure §3.1 R28 行追加："根因待 wrangler tail 定位；当前仅 symptom 缓解（500 → diagnostic envelope）"。
  2. 若 owner 在 `2026-05-12` runbook archive 前不定位根因，应在归档时把 R28 升级为 ZX5 的 P0 bug。

### R5. Phase 8 fast-track burst 不等价于 7-day 观察

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - ZX4 closure §1.9 / §3.2：owner direction "我们正在积极开发的过程中，没有时间等2周，因此 Phase 8 需要立刻过掉"
  - 替代方案：30-session burst（start/status/history × 30）= 90 facade calls，0 errors。
  - action-plan §7.2 原定阈值："0 误报 + ≥ 1000 turns"。
- **为什么重要**：burst 测试的是 happy path 的瞬时一致性，7-day 观察捕获的是：alarm GC timing、并发竞争、D1 连接池耗尽、Workers AI 配额波动、websocket 心跳超时等时间敏感问题。两者在统计意义上不等价。
- **审查判断**：owner direction 有权决定时间线，但 closure 应更诚实地记录 "fast-track accepted with risk acknowledgment"，而非暗示 burst 等价于 7-day。
- **建议修法**：在 ZX4 closure §1.9 追加一行："fast-track 仅验证 happy-path 瞬时一致性；边界条件 / GC / 并发 race 由后续 dev 阶段自然 surface"。

### R6. migration 006 未 apply 到 prod D1

- **严重级别**：`high`
- **类型**：`platform-fitness`
- **是否 blocker**：`yes`
- **事实依据**：
  - ZX4 closure §4 风险表："migration 006 仅 apply 到 preview D1, prod 待 owner deploy 时一并应用"
  - "否则 prod handleMeSessions / handleStart 会因 D1 schema mismatch 抛错"
  - 当前 migration 006 包含 `session_status` CHECK 从 4 值扩到 6 值，以及 `idx_nano_conversation_sessions_pending_started_at` 新索引。
- **为什么重要**：prod schema 滞后于 code 是灾难性风险。若 owner 在任意后续 deploy 中忘记先 apply migration，prod 所有涉及 `/me/sessions` 或 session start 的调用会直接 500。
- **审查判断**：这不是 ZX4 执行人的失误（preview 是唯一可验证环境），但必须在 prod deploy 前显式阻塞。
- **建议修法**：
  1. 在 `docs/runbook/zx2-rollback.md` 或独立 `docs/runbook/prod-deploy.md` 中加 "prod deploy checklist"，第一条即 "apply pending D1 migrations"。
  2. 在 CI/CD pipeline（若存在）中加 `wrangler d1 migrations apply --dry-run` 预检。

### R7. P4/P6 runtime kernel waiter 未接通，closure 标记不够醒目

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - ZX4 plan §13.2 明确 scope："Runtime hookup deferred(明确 scope) — agent-core 的 PermissionRequest hook 实际去等待 `permission/decisions/${requestUuid}` 的 polling / event-loop 改造 — **ZX4 不做**"
  - ZX4 closure §3.2："agent-core PermissionRequest / ElicitationRequest hook 改造为 await DO storage waiter... 留 ZX5 Lane E follow-up"
  - 但 closure §0 TL;DR 与 §5.1 签字栏中，P4/P6 被标记为 "✅ done"，没有显式区分 "contract land" vs "runtime wired"。
- **为什么重要**：后续阅读者（尤其是 ZX5 执行人）可能误以为 P4/P6 的 permission round-trip 已经端到端可用，而忽略了 "runtime kernel 尚未消费 decision" 这一关键缺口。这会导致 ZX5 的 workload 被低估。
- **审查判断**：ZX4 的 scope-out 决策正确，但 closure 的完成标记过于乐观。
- **建议修法**：在 ZX4 closure §5.1 P4/P6 行改为 "✅ contract land / ⏸ runtime waiter deferred"，与 §3.2 的措辞一致。

### R8. `forwardInternalJsonShadow` 方法名与注释中的 "P3-05 flip" 时间锚点混淆

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `user-do.ts:581-584`："ZX4 Phase 9 P9-01 — P3-05 flip executed... Method name preserved (forwardInternalJsonShadow) so call sites stay unchanged; the 'Shadow' semantic is now historical"
  - 但方法体内 error message：`agent-core RPC binding required after P3-05 flip (action=${action})`
- **为什么重要**：新读者看到 "P3-05 flip" 会以为是 ZX2 的旧状态，而非 ZX4 刚完成的动作。时间锚点的混淆会增加阅读成本。
- **审查判断**：不影响功能，但属于命名/注释 hygiene 问题。
- **建议修法**：error message 改为 `agent-core RPC binding required after ZX4 P9 flip (action=${action})`。

---

## 3. In-Scope 逐项对齐审核

### ZX3 In-Scope 对齐

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | Phase 1: manifest 冻结（package + test-legacy + ZX2 carryover scope） | done | P1-01/P1-02/P1-03 全部落地，v2 reclassification 合理 |
| S2 | Phase 2: 删除 6 个 absorbed duplicate package | done | 物理删除已验证，`packages/` 从 12 → 6 |
| S3 | Phase 3(v2): 6 个 utility library 显式 keep-set | done | v2 reclassification 正确识别了 bridge/helper 性质 |
| S4 | Phase 4: test-legacy cutover（5 guardians + 14 retire + R30 + scripts） | done | 但 `test/INDEX.md` 未同步更新（见 R1） |
| S5 | Phase 5: `test-legacy/` 物理删除 + docs sync | partial | 物理删除完成，docs sync 遗漏 `test/INDEX.md` 与 `legacy-test-and-package-deprecation.md` |
| S6 | Q1-Q6 owner 决策落地 | done | 全部确认并记录在案 |
| S7 | 2400 + 31 = 2431 tests 全绿 | done | 本地验证通过 |

### ZX4 In-Scope 对齐

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S8 | Phase 0: user-do.ts 4 模块 seam extraction | done | 1950 → 1659 行，零回归 |
| S9 | Phase 1: R28 cancel I/O fix + R29 verify body fix | done | 本地单测全绿；deploy carryover ack'd（见 R4） |
| S10 | Phase 2: parity log body diff 升级 | done | 18 unit test，JSON pointer 正确 |
| S11 | Phase 3: D1 pending truth（migration 006 + 7 sub-task + R10/R11/R1） | done | 4 处同步（CHECK / TS union / read-model / alarm GC）已验证；migration applied to preview |
| S12 | Phase 4: permission round-trip producer + consumer + resolver | partial | contract 全栈 land，但 runtime kernel waiter 未接通（见 R7） |
| S13 | Phase 5: usage live push + 真预算 snapshot | partial | read-side 完成，WS push `session.usage.update` 未实现（scope-out 正确，但 closure 标记需调整） |
| S14 | Phase 6: elicitation round-trip + live e2e 扩展 | partial | contract 全栈 land，runtime waiter 未接通（同 R7） |
| S15 | Phase 7: cross-e2e 14/14 + ops gate | done | 12/14 pass + 2 known carryover + 4 by-design skip；R3 ops gate 规则已遵守 |
| S16 | Phase 8: 7-day parity 观察 | partial | fast-track 替代，需风险 acknowledgment（见 R5） |
| S17 | Phase 9: P3-05 flip + R31 + retired | done | fetch fallback 删除 / non-stream handler 删除 / retired 文档 / runbook archive date 标注 |
| S18 | 1536 worker+contract tests 全绿 | done | 本地验证通过 |

### 3.1 对齐结论

- **done**: 13
- **partial**: 5
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 0

> 整体更像 "主体骨架与物理动作全部完成，但文档收口、runtime hookup deferred 标记、deploy-only 根因定位存在 follow-up"，而不是 "零残留 completed"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | `@haimang/jwt-shared` package 抽取(R20) → ZX5 Lane C | 遵守 | 未在 ZX3/ZX4 内创建 |
| O2 | envelope 三 type 收敛(R19) → ZX5 Lane C | 遵守 | 未改动 public wire |
| O3 | `FacadeErrorCode ⊂ RpcErrorCode` 跨包断言(R21) → ZX5 Lane C | 遵守 | 未触及 |
| O4 | JWT kid rotation 集成测试 → ZX5 Lane C | 遵守 | 未触及 |
| O5 | web / wechat client heartbeat / replay 切到 nacp-session → ZX5 Lane C | 遵守 | 未触及 |
| O6 | catalog content 填充(R18) → ZX5 Lane D | 遵守 | 未触及 |
| O7 | 4 个产品型 endpoint → ZX5 Lane D | 遵守 | 未触及 |
| O8 | WORKER_VERSION CI 动态注入(R25) → ZX5 Lane D | 遵守 | 未触及 |
| O9 | DO 提取独立 worker → 冻结/延后 | 遵守 | owner direction R8 硬冻结禁止新增 worker |
| O10 | context-core / filesystem-core 升级真 RPC → ZX5 Lane E | 遵守 | 未触及 |
| O11 | WeChat 真机 smoke(R17) → owner-action | 遵守 | 持续 carryover，无 plan |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：ZX3 与 ZX4 的物理目标（package 退役、test-legacy 删除、transport 真收口、session 语义闭环）已全部达成；代码质量高、测试覆盖充分、零回归。但存在 3 项应在关闭前解决的文档/ops blocker，以及 4 项可后续跟进的 non-blocking follow-up。
- **是否允许关闭本轮 review**：`yes`，但须先完成以下 blocker：
  1. **修复 `test/INDEX.md` §7 文档裂缝**（R1）— 删除对 `test-legacy/` 的引用。
  2. **更新 `docs/runbook/zx2-rollback.md` 内文**（R3）— 删除 P9 后已不成立的软回滚描述。
  3. **在 ZX4 closure 中追加 prod migration 前置检查**（R6）— 明确 prod deploy 前必须先 apply migration 006。
- **可以后续跟进的 non-blocking follow-up**：
  1. 清理 `pnpm-lock.yaml` stale 块（R2）。
  2. R28 根因定位（R4）— 建议纳入 ZX5 P0 或独立 hotfix。
  3. Phase 8 fast-track 风险 acknowledgment（R5）— 在后续 dev 中补 7-day 观察或加压力测试。
  4. P4/P6 runtime kernel waiter 标记调整（R7 + R8）— 让 closure 更准确地反映 "contract land / runtime deferred"。
- **建议的二次审查方式**：`same reviewer rereview` — 只需验证 3 个 blocker 是否已按 §6 响应。
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 跨阶段深度分析与 zero-to-real 整体回顾

### 6.1 阶段连贯性判断

zero-to-real（Z0-Z5 + ZX1-ZX4）的整体叙事是连贯的：

- **Z0-Z2** 建立了 auth / session truth / D1 baseline。
- **Z3-Z4** 将 runtime 推进到 Workers AI mainline 与 quota gate。
- **ZX1-ZX2** 补齐了 WeChat / transport profile / RPC / client narrow。
- **ZX3** 清理了历史 package 与 test-legacy 的物理残留。
- **ZX4** 完成了 transport 真收口与 session 语义闭环。

每一阶段的 closure 都正确地承接了上一阶段的 carryover，并将超出 scope 的项显式 defer 到下一阶段。这种 "closed-with-carryover" 模式比 "假装全部完成" 更健康。

### 6.2 架构层面的真实断点

跨阶段审查发现以下 3 个架构断点，它们不是当前阶段的错误，而是需要在 ZX5 中重点解决的结构性问题：

**断点 A：Permission / Elicitation / Usage 的 runtime hookup 缺口**
- ZX2 设计了 `session.permission.request` / `session.usage.update` / `session.elicitation.request` 的 WS frame 语义。
- ZX4 把 decision-forwarding contract 从 orchestrator-core 铺到了 agent-core DO storage。
- 但 agent-core 的 kernel actor-state machine 尚未被改造为 "await DO storage waiter + resume" 模式。
- 这意味着：客户端可以发 decision / answer，orchestrator 可以存到 DO，但 **runtime 不会主动消费**。
- ZX5 Lane E 必须解决这个断点，否则 permission / usage / elicitation 三件套只是 "协议上存在、运行时死代码"。

**断点 B：D1 single-truth 与 KV hot-state 的同步裂缝**
- ZX4 P3 引入了 `pending` / `expired` 两个新 D1 状态，并建立了 D1 → KV 的合并视图（`handleMeSessions`）。
- 但 KV 的 `SessionEntry` 与 D1 的 `nano_conversation_sessions` 之间没有强一致性保证。
- 例如：alarm GC 将 D1 `pending` → `expired`，但 KV 中对应的 `sessionKey` 可能仍存在（直到 `cleanupEndedSessions` 触发）。
- 虽然 P3-07 ingress guard（`sessionGateMiss`）通过 D1 lookup 兜底了大部分场景，但 **长期存在两个 truth source（KV + D1）的架构债务**。
- ZX5 应考虑：是否将 KV 中的 session state 逐渐收敛到 D1 read-model，让 KV 仅保留 WS attachment / recent frames 等真正需要低延迟的纯 hot-state？

**断点 C：6-worker 架构硬冻结与 library worker RPC 升级的冲突**
- owner direction R8 硬冻结 "ZX5 不允许新增 worker"。
- 但 ZX5 Lane E 的 backlog 包含 "context-core / filesystem-core 升级真 RPC"，而这两者当前是 library-only worker（无 RPC entrypoint）。
- 若不能新增 worker，则 "真 RPC 升级" 只能在现有 6 worker 内部通过增加 `WorkerEntrypoint` 方法实现。
- 这本身可行，但意味着 context-core / filesystem-core 的 public surface 会增加（即使只是 internal RPC），与 ZX2 P1-03 "非 facade worker 必须返 401" 的 binding-scope 守卫产生设计张力。
- ZX5 启动前，需要 owner 对 "library worker 的 internal RPC surface 边界" 做一次显式决策。

### 6.3 命名规范与执行逻辑错误

本轮审查未发现命名规范或执行逻辑的 **错误**（即导致功能不正确的问题）。但发现以下 **漂移**：

1. **时间锚点漂移**：代码注释中混用 "ZX2 P3-05"、"ZX4 P9-01"、"P3-05 flip" 等不同粒度的时间标签。建议统一为 `{阶段编号} {Phase编号}`（如 "ZX4 Phase 9"）。
2. **方法名语义漂移**：`forwardInternalJsonShadow` 在 P9 后已无 "Shadow" 行为，但方法名保留。这是 deliberate 的（减少 diff），但应在注释中更明确地说明 "保留方法名仅为减少 call site diff，语义已变为 RPC-only"。
3. **文档状态标签漂移**：`transport-profiles.md` 中 `internal-http-compat` 标为 `retired`，但 `runbook/zx2-rollback.md` 内文仍使用 `retired-with-rollback` 时期的回滚流程描述。两者口径不一致。

### 6.4 盲点检查

| 检查维度 | 结果 | 说明 |
|----------|------|------|
| 是否有已删 package 的代码残留 import | 无 | `grep` 验证通过 |
| 是否有已删 test-legacy 的代码残留 import | 无 | `grep` 验证通过（除文档外） |
| 是否有 secret/key 泄露 | 无 | 所有 binding secret 均通过 env 注入 |
| 是否有 schema 不一致（CHECK vs TS union vs read-model） | 无 | 4 处同步已验证 |
| 是否有未覆盖的 error code | 有 | `session-pending-only-start-allowed` 等新 error code 已在 P3-07 测试覆盖，但 cross-e2e 中未验证 |
| 是否有 memory leak / DO alarm  overrun | 未发现 | `expireStalePendingSessions` 已设 LIMIT 200，alarm 10min 周期合理 |
| 是否有 race condition（pending → starting → active） | 未发现 | `beginSession` 使用 `INSERT OR IGNORE`，`updateSessionState` 使用显式 UPDATE，idempotent |

---

## 7. 结语

ZX3~ZX4 是 zero-to-real 阶段的收官之作。ZX3 把仓库从"12 packages + test-legacy 历史共存"的混沌态，收敛到"6 keep-set + 4-layer canonical test tree"的秩序态。ZX4 把 transport 从"dual-track parity with HTTP fallback"的中间态，推进到"RPC-only + retired internal-http-compat"的终态，并在现有 D1 truth 上补全了 session 语义闭环。

这两项工作的工程质量很高：seam extraction 的零回归、migration 006 的 table-swap 安全性、parity log body diff 的工具价值、ingress guard 的防御深度，都体现了执行人对边界条件的审慎考虑。

但高质量的代码不等于零残留的交付。本轮审查发现的 3 个 blocker（文档裂缝、runbook 过时、prod migration 前置检查）和 4 个 follow-up（lockfile 清理、R28 根因、fast-track 风险、runtime hookup 标记）应在 ZX5 启动前被处理，以避免"历史残留"以文档和 ops gap 的形式继续累积。

zero-to-real 真正交付的不是"完美的终点"，而是"可审计、可交接、可继续演进的稳定基线"。ZX3~ZX4 做到了前者，接下来需要做的，是把 follow-up 项压成明确的 backlog，而不是让它们散落在 closure 的备注栏中。

> kimi (K2p6), 2026-04-28

---

## 评价附录 — Implementer Evaluation of This Review

> 评价对象: `kimi (K2p6) — ZX3-ZX4 review`
> 评价人: `Opus 4.7(实现者,逐项核查 4 reviewer 的 finding 后)`
> 评价时间: `2026-04-28`

### 0. 评价结论

- **一句话评价**:工程交接质量视角的均衡型审查;ops 文档缺口(R3 runbook 内文)是 4 reviewer 中独家发现,跨阶段架构思辨深度最强,但具体 finding 颗粒度偏中等,部分判断不如 deepseek 锐利。
- **综合评分**:`8.0 / 10`
- **推荐使用场景**:阶段收口前需要"既看 docs sync 也看代码 hygiene + ops gate"的全链路体检;当 review 需要跨阶段连续性判断(ZX1→ZX2→ZX3→ZX4)与设计债务跟踪时,kimi 的视角不可替代。
- **不建议单独依赖的场景**:需要量化数据反向核查(行数 / import 计数 / 实际代码 vs closure claim)时单独依赖会漏掉 deepseek 那类硬证据;需要捕捉代码注释级 hygiene 问题(stale comment / dead import)时单独依赖会漏掉 GLM 那种细颗粒。

### 1. 审查风格画像

| 维度 | 观察 | 例证 |
|------|------|------|
| 主要切入点 | 工程交接质量 — closure claim 与运营文档的对齐(docs sync + runbook + ops gate)| R1 INDEX.md / R3 runbook 内文 / R6 prod migration 是 hard gate |
| 证据类型 | 命令 + 文件 + 行号 + 跨阶段对账 | §1 列出 7 条本地命令 + ZX2 closure §11 carryover mapping 逐项核对 |
| Verdict 倾向 | balanced(approve-with-followups,允许收口但 3 项 blocker 必须先修) | 整体允许 yes 关闭,但写明"3 blocker + 4 follow-up" |
| Finding 粒度 | 中等(8 条,系统级 + 文档级混合) | R3 runbook 内文是 ops 级 / R8 时间锚点是 docs 级 |
| 修法建议风格 | actionable(具体到子节 / 行 / 命令) | R3 给出 §1/§2 重写 + 删除"自动退化"句子的具体步骤 |

### 2. 优点与短板

#### 2.1 优点

1. **R3 runbook 内文未随 P9 同步重写 — 4 reviewer 中独家发现**。GPT/GLM/deepseek 均未察觉 runbook §1.1/§2.1 仍描述 "auto-fallback to HTTP" 这种 P9 后已不成立的语义。这是真正的 ops 风险(运维人员按旧 runbook 执行会期望软回滚生效但得到 503)。
2. **§6 跨阶段深度分析有真正的架构思辨**。给出 3 个架构断点(permission/usage/elicitation runtime hookup / KV-D1 同步裂缝 / 6-worker 与 RPC 升级冲突),不是简单 surface-level critique。
3. **R6 prod migration hard gate 框架最清晰**。明确指出"这不是 ZX4 执行人的失误(preview 是唯一可验证环境),但必须在 prod deploy 前显式阻塞",并给出 CI/CD pipeline `--dry-run` 预检的具体建议。
4. **协作友好度高**。verdict 是 "yes 但须先完成 3 blocker",对实现者 surgically 友好;不像 GPT/deepseek 直接给 no。

#### 2.2 短板 / 盲区

1. **代码注释级 hygiene 没看到**。GLM 抓到的 user-do.ts:948 stale comment + 死 import 这一层,kimi 只在 R8 提了"时间锚点混淆"但没具体到 line。
2. **量化数据反向核查缺失**。deepseek R1/R2 直接 wc -l 拆穿了 closure 的行数声明,kimi 没做这一步,虽然 §1 引用了"user-do.ts(1910 行)"作为事实但未与 closure claim 对比。
3. **R4 R28 处置偏温和**。kimi 给了 "follow-up,不阻塞 ZX4 close" 的口径;deepseek R3 直接 challenge 为 "carryover 退场而非修复"更尖锐,kimi 的措辞容易被读作"已知问题接受"。
4. **R5 fast-track 论述偏文字**。"瞬时一致性 vs 时间敏感问题" 句式靠语义描述;GLM/deepseek 都给了"180 calls vs 7 day × 1000 turns 不在统计意义上等价"的更直接论证。

### 3. Findings 质量清点

| 编号 | 原始严重程度 | 事后判定 | Finding 质量 | 分析与说明 |
|------|--------------|----------|--------------|------------|
| R1 | medium | true-positive | good | 与 GPT R5 同步发现;颗粒度合理。 |
| R2 | low | true-positive | weak | 已知 owner-action,价值不高,但 4 reviewer 都列了。 |
| R3 | medium | true-positive | excellent | **唯一发现**;runbook §1.1/§2.1 旧语义残留属真正 ops 风险。 |
| R4 | high (follow-up) | true-positive | excellent | R28 deploy bug 跟踪到位;deepseek R3 的 challenge 更尖锐但 kimi 处置合理。 |
| R5 | medium | true-positive | good | 论证偏文字,颗粒度中等。 |
| R6 | high | true-positive | excellent | prod migration hard gate 框架清晰;具体到 CI/CD `--dry-run` 建议。 |
| R7 | medium | true-positive | good | 与 GPT R1 互补,强调 closure 标记醒目度;落点准确。 |
| R8 | low | true-positive | good | "P3-05 flip" 时间锚点混淆点准确,但未抓 user-do.ts:948 具体 stale comment。 |

### 4. 多维度评分(单项 1-10,综合 §0)

| 维度 | 评分(1–10) | 说明 |
|------|-------------|------|
| 证据链完整度 | 8 | 命令 + 文件 + 行号 + 跨阶段对账齐全;但缺量化数据反向核查(行数/import 计数 vs closure claim)。 |
| 判断严谨性 | 8 | 主体判断准确;R4 R28 的处置偏温和,R5 论述偏文字,稍弱于 deepseek 的尖锐性。 |
| 修法建议可执行性 | 8 | 具体到子节 / 命令 / 删除哪些句子;R3 runbook 重写指导 actionable。 |
| 对 action-plan / design / QNA 的忠实度 | 9 | ZX2 closure §11 carryover mapping 逐项核对 + ZX3/ZX4 plan §1.3 §4 cluster note 准确引用。 |
| 协作友好度 | 9 | "yes 但须先完成 3 blocker" 的口径对实现者友好;§7 结语强调 "可审计、可交接、可继续演进的稳定基线" 是好的协作框架语言。 |
| 找到问题的覆盖面 | 8 | 8 finding 覆盖 docs / runbook / ops / 命名 / R28/R29;但漏 user-do.ts 注释级 hygiene + 量化反核。 |
| 严重级别 / verdict 校准 | 8 | severity 大致合理;R4 R28 follow-up 与 R6 prod migration blocker 的区分准确。 |


