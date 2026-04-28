# Nano-Agent 代码审查报告 — ZX3-ZX4 by DeepSeek

> 审查对象: `zero-to-real / ZX3 (Components Deprecation) + ZX4 (Transport True Close + Session Semantics)`
> 审查类型: `mixed (code-review + closure-review + cross-stage-audit)`
> 审查时间: `2026-04-28`
> 审查人: `DeepSeek (独立审查，不引用 GPT/Opus/GLM 既有报告)`
> 审查范围:
> - `packages/` — 6 个 keep-set 留存 + 6 个已删包验证
> - `workers/orchestrator-core/src/` — 4 个 seam 模块 + user-do.ts + session-truth.ts + index.ts
> - `workers/agent-core/src/host/` — nano-session-do.ts (R28/R29 修复) + internal.ts (P3-05 flip)
> - `test-legacy/` (应已删除) + `test/` 新 4 层树
> - `workers/orchestrator-core/migrations/006-pending-status-extension.sql`
> - `docs/transport/transport-profiles.md`
> - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`
> - `docs/issue/zero-to-real/ZX3-closure.md`
> - `docs/issue/zero-to-real/ZX4-closure.md`
> 对照真相:
> - ZX3 / ZX4 action-plan 中的 phase-by-phase 执行目标
> - ZX3 / ZX4 closure 中的完成声明与验证证据
> - 事实代码与测试运行结果
> 文档状态: `changes-requested`

---

## 0. 总结结论

> `ZX3-ZX4 完成了仓库结构瘦身与 transport 收尾的主线目标，但 closure 文档中存在多处与事实代码不符的量化声明，且 R28 部署级 bug 以 "known carryover" 退场而非修复，P3-05 翻转通过删除问题路径而非修复根因完成——这些构成阻止本轮审查关闭的硬缺陷。`

- **整体判断**: `ZX3 (组件退役 + test 树 cutover) 的主体工作扎实可信，但 closure 的量化声明需纠正。ZX4 (transport 真收口 + session 语义) 的代码层交付成立，但 R28 修复未达 deploy 级验证目标、R29 以路径删除代替根因修复、7-day 观察期被 30-burst 替代的做法需要更诚实的文档表述。`
- **结论等级**: `approved-with-followups`
- **是否允许关闭本轮 review**: `no — 需 closure 文档修正 R1/R2 不实声明 + 答复 R5/R6/R8 三项架构级遗留`
- **本轮最关键的 3 个判断**:
  1. `ZX3 closure 声称 user-do.ts = 1659 行（-15%），实际 1910 行（仅 -2%）；parity-bridge.ts 声称 200 行，实际 342 行。两份 closure 均以此不实数据作为 "seam extraction 成功" 的量化证据——必须修正。`
  2. `R28 cancel I/O 修复在本地单元测试通过但在 preview deploy 仍 500 "Worker threw exception"——closure 以 "known carryover" 退场，但 action-plan 的 Phase 1 目标是 "修复 R28"，closure 应诚实写 "R28 在 deploy 环境未修复"。`
  3. `R29 修复路径——删 stateful 字段后仍产生 parity mismatch——最终靠 P3-05 flip 整体删除 dual-track parity 比较来 "解决"。这不是修复 502，而是删除了产生 502 的代码。closure 未清晰区分 "修复根因" 与 "删除问题路径"。`

---

## 1. 审查方法与已核实事实

> 本节只写事实，不写结论。不引用 GPT/Opus/GLM 的分析结论。所有引用均为本审查独立核查的结果。

- **对照文档**:
  - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md` (v2 增强版，含 §14-§16 工作日志)
  - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md` (v3 版，含 §10-§16 工作日志)
  - `docs/issue/zero-to-real/ZX3-closure.md`
  - `docs/issue/zero-to-real/ZX4-closure.md`
- **核查实现**:
  - `workers/orchestrator-core/src/user-do.ts` (1910 行)
  - `workers/orchestrator-core/src/session-lifecycle.ts` (134 行)
  - `workers/orchestrator-core/src/session-read-model.ts` (69 行)
  - `workers/orchestrator-core/src/ws-bridge.ts` (47 行)
  - `workers/orchestrator-core/src/parity-bridge.ts` (342 行)
  - `workers/orchestrator-core/src/session-truth.ts` (884 行)
  - `workers/orchestrator-core/src/index.ts`
  - `workers/agent-core/src/host/do/nano-session-do.ts`
  - `workers/agent-core/src/host/internal.ts`
  - `workers/orchestrator-core/migrations/006-pending-status-extension.sql`
  - `packages/` (完整目录)
  - `test/root-guardians/` (6 文件)
  - `test/shared/fixtures/external-seams/` (4 文件)
  - `docs/transport/transport-profiles.md`
- **执行过的验证**:
  - `wc -l` 精确行数统计 (user-do.ts + 4 seam 模块 + session-truth.ts)
  - `pnpm test:contracts` → **31/31 pass** (root-guardians 零回归)
  - `pnpm -F @haimang/orchestrator-core-worker test` → **75/75 pass**
  - `pnpm -F @haimang/agent-core-worker test` → **1056/1056 pass**
  - `grep -rn` 代码级反向搜索: 已删 6 包的 import 残留=0、test-legacy 路径引用=0
  - `ls` 目录级验证: packages/ 仅 6 项、test-legacy/ 已不存在
  - `grep` migration 006 SQL CHECK 约束 vs TypeScript DurableSessionStatus/SessionStatus 枚举一致性
- **复用 / 对照的既有审查**: `无` — 本审查不引用 Opus/GPT 的既有报告

### 1.1 已确认的正面事实

- `packages/` 从 12 收敛至 6: 6 个 absorbed duplicate 已物理删除，6 个 keep-set 全部留存 (nacp-core / nacp-session / orchestrator-auth-contract / workspace-context-artifacts / storage-topology / eval-observability)
- `test-legacy/` 目录已完成物理删除，不存在于文件系统
- `test/` 新树 4 层结构就绪: shared / root-guardians (6 文件) / package-e2e / cross-e2e
- `package.json:test:contracts` 已切换到 `test/root-guardians/*.test.mjs`，`test:legacy:*` 脚本已删除
- 4 个 seam 模块 (session-lifecycle / session-read-model / ws-bridge / parity-bridge) 全部存在且 user-do.ts 正确 import
- `SessionStatus` (session-lifecycle.ts:15-21) 和 `DurableSessionStatus` (session-truth.ts:5-11) 均已包含 `pending` / `expired` 6 状态 union
- migration 006 (`006-pending-status-extension.sql`, 283 行) 存在，SQL CHECK 约束 6 状态与 TS union 同源
- `verifyCapabilityCancel` 已使用 `AbortController + signal` 替代独立的 `transport.cancel()` 调用 (nano-session-do.ts:1755-1771)
- `verifyInitialContext` 已删除 `phase` 和 `defaultEvalRecordCount` 两个时序敏感字段 (nano-session-do.ts:1828-1845 注释确认)
- `SUPPORTED_INTERNAL_ACTIONS` 已收紧为 `{ stream, stream_snapshot }` (internal.ts:20-25)
- `mintPendingSession` 在 index.ts:492 被调用，事务插入 2 行 (nano_conversations + nano_conversation_sessions)
- `handlePermissionDecision` (user-do.ts:1300-1369)、`handleElicitationAnswer` (user-do.ts:1374-1427)、`handleUsage` (user-do.ts:1231-1268) 均已实现
- `transport-profiles.md` 明确标注 `internal-http-compat: retired`
- cross-e2e 已切换为 facade-唯一-entry 模型 (仅 probe orchestrator-core)
- deleted packages 在代码层面无 import 残留 (仅 docs/design 历史文档中有示例性引用)
- 全量测试: orchestrator-core 75/75 + agent-core 1056/1056 + bash-core 374/374 + root-guardians 31/31 = **1536/1536 全绿**

### 1.2 已确认的负面事实

- **user-do.ts 实际行数 = 1910**，ZX3 closure §15 和 ZX4 closure §0 均声明为 1659。差值 251 行。closure 以 "1950→1659 (-15%)" 作为量化成功标志，该数字不实。
- **parity-bridge.ts 实际行数 = 342**，ZX4 plan §10.1 声明 200 行。差值 142 行。Phase 2 body diff 升级的代码增长未在 closure 中体现。
- **R28 修复在 deploy 环境未生效**: Phase 1 的 AbortController + signal 修法在本地 unit test 通过 (agent-core 1056/1056)，但 preview deploy 后 `POST /verify {check: capability-cancel}` 仍返回 500 "Worker threw exception" (ZX4 plan §16.1 自行记录)。
- **R29 根因未被定位**: Phase 1 删除了 stateful 字段后 deploy 仍出现 502 `agent-rpc-parity-failed` (ZX4 plan §16.1)。最终通过 Phase 9 删除整个 dual-track parity 比较路径来 "解决"——不是 fix。
- **7 天 parity 观察被 30-session burst 替代**: Phase 8 原定 "7 天 + 1000 turns + 0 误报"，实际执行为 "30 session × 3 endpoint × 2 runs = 180 facade calls"。ZX4 closure §4 将此列为 medium risk 但未见缓解措施。
- **R2/KV 仍未绑定到任何 worker 的 wrangler.jsonc**: grep 确认所有 6 个 worker 的 `wrangler.jsonc` 均无 `r2_buckets` 或 `kv_namespaces` 声明——即 ZX4 的整个 session-interaction 全栈改造始终运行在 MemoryBackend 上的伪文件系统 (bash-core)。
- **workspace-context-artifacts 仍有 29 处 import**，storage-topology 仍有 19 处 import。ZX3 Phase 3 原计划 "清零 consumer 后删除这些包"，因 v2 reclassification 改为 "永久 keep-set"——但 import 计数证明它们仍是重度依赖的 runtime bridge。
- **docs/ 中 `test-legacy` 引用仍有 161 处**: 绝大多数为 ZX3/ZX4 相关文档本身的合理引用 (记录退役过程)，但 `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md` 和 `docs/action-plan/worker-matrix/PX-new-tests.md` 等 3 份非退役相关文档仍将 `test-legacy/` 作为 active 路径提及。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有代码引用均经 `wc -l` / `grep -n` / 逐行阅读验证 |
| 本地命令 / 测试 | yes | `pnpm test:contracts` + `pnpm -F ... test` 全量跑通 |
| schema / contract 反向校验 | yes | migration 006 SQL CHECK vs TS DurableSessionStatus vs SessionStatus 三方枚举一致性校验 |
| live / deploy / preview 证据 | no | 无 deploy 环境访问权限，deploy 级发现来自 ZX4 plan §16.1 自行记录的 cross-e2e 结果 |
| 与上游 design / QNA 对账 | yes | ZX3 plan §11 carryover mapping + ZX4 plan §2.2 out-of-scope 逐项对照 |

---

## 2. 审查发现

> 使用稳定编号 R1-R13。每条含: 严重级别、类型、事实依据、为什么重要、审查判断、建议修法。

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | user-do.ts 行数声明不实 (closure:1659 actual:1910) | **high** | docs-gap | yes | 修正 ZX3/ZX4 两份 closure 的行数声明 |
| R2 | parity-bridge.ts 行数声明不实 (plan:200 actual:342) | **medium** | docs-gap | no | 修正 ZX4 plan §10.1 |
| R3 | R28 deploy bug 以 "known carryover" 退场而非修复 | **high** | delivery-gap | yes | 在 closure 中诚实标注 "deploy 级未修复" |
| R4 | R29 通过删除路径 "解决" 而非定位根因 | **medium** | correctness | no | 在 closure 中区分 "fix root cause" vs "remove problematic path" |
| R5 | 7-day 观察被 30-burst 替代——验证覆盖不足 | **medium** | test-gap | no | ZX5 启动后建立真正的持续 parity 监控 (单 track) |
| R6 | P3-05 flip 后 parity-bridge.ts 中 logParityFailure 仍被保留但永不触发 | **medium** | scope-drift | no | 若确实永久 retired，在源码中标注或后续清理 |
| R7 | workspace-context-artifacts 29 import + storage-topology 19 import——ZX3 v2 reclassification 虽正确但未解决依赖问题 | **medium** | delivery-gap | no | ZX5 中明确这些包的长期演化路线 |
| R8 | 整个 session-interaction cluster 在 MemoryBackend 上运行——R2/KV 仍未绑定 | **medium** | platform-fitness | no | ZX5 中优先 wiring |
| R9 | `forwardInternalJsonShadow` 方法名保留 "Shadow" 但行为已非 Shadow | **low** | naming | no | 若 owner 同意可 rename 或加更长的注释 |
| R10 | ZX3 Phase 3 v2 reclassification 使原 "组件退役" 计划从 "删除 3 个 bridge 包" 退化为 "全部 keep-set, 仅改 README"——closure 未清晰承认计划降级 | **medium** | scope-drift | no | closure 明确记录 scope reduction |
| R11 | docs/design 中仍有 3 份非退役文档将 `test-legacy/` 作 active 路径提及 | **low** | docs-gap | no | 修正或标注 archive |
| R12 | migration 006 的 table-swap 模式在 prod deploy 时存在短暂不一致窗口 | **medium** | platform-fitness | no | 确保 prod deploy 串行执行 |
| R13 | test/root-guardians/ 仅 6 文件 (原 19 guardians 中 14 个 retired)——14 个 retired guardian 覆盖的契约是否已全量迁至 worker-local tests 未做系统验证 | **low** | test-gap | no | ZX5 启动后对照 cross-reference |

### R1. user-do.ts 行数声明不实 (closure: 1659, actual: 1910)

- **严重级别**: `high`
- **类型**: `docs-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - ZX3 closure §1.4: "user-do.ts: 1950 → **1659**(-15%)"
  - ZX4 closure §0: "1950 → 1659 行(-15%)"
  - ZX3 plan §10.1: "user-do.ts: 1950 → 1659 行(**-291 行**;-15%)"
  - 实际 `wc -l`: `user-do.ts = 1910 行`
  - 4 seam 模块合计: 134 + 69 + 47 + 342 = 592 行 (plan 声称 447 行)
  - 实际总计: 1910 + 592 = 2502 行 (plan 声称 1659 + 447 = 2106 行)
- **为什么重要**:
  - "行数减少" 是 ZX3/ZX4 closure 反复引用的量化成功指标
  - user-do.ts 的 -15% 声称是 seam extraction "成功" 的核心量化证据
  - 实际缩减仅为 (1950 - 1910) / 1950 = **2%**，不是 15%
  - 两份 closure 均存在同样的不实声明，表明数字未在更新文件后重新验证
- **审查判断**:
  - seam extraction 本身是成功的 (4 模块职责分明)，但行数声明严重失实
  - 差值 251 行的来源: ZX4 Phase 3-6 的代码回填 (pending ingress guard、permission/elicitation forwarder、usage read、me/sessions D1 merge) 在文件上增加了新行数
  - closure 应诚实说明: seam extraction 在 Phase 0 时确为 1659 行，但在后续 Phase 3-6 中因功能增长恢复到 1910 行
- **建议修法**:
  - 修正 ZX4 closure §0 + §1.1 + §2 共 3 处行数声明
  - 修正 ZX3 closure §1.4 行数声明 (虽 ZX3 时间点可能为 1659，但 closure 应在更新时注明 "post-ZX3 因 ZX4 功能增长已恢复到 1910")
  - 修正 ZX4 plan §10.1 + §10.3 + §15 共 3 处行数声明
  - parity-bridge.ts 行数从 200→342 需同步修正 ZX4 plan §10.1 + §10.3

### R2. parity-bridge.ts 行数声明不实 (plan: 200, actual: 342)

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX4 plan §10.1: `parity-bridge.ts` (200 行)
  - 实际 `wc -l`: `parity-bridge.ts = 342 行`
  - ZX4 plan §11.2 记录了 Phase 2 body diff 升级新增的 helper 函数 (escapePointerSegment / appendPointer / previewDiffValue / diffNodes / computeBodyDiff)，但未更新行数
- **为什么重要**: 200→342 的增长是合理的 (新增 body diff 功能)，但 plan/closure 记录的行数与事实不符，削弱文档可信度
- **审查判断**: 同 R1 同源问题——plan 在写完工作日志后未 re-verify 行数
- **建议修法**: 在 ZX4 plan §10.1 + §10.3 中修正 parity-bridge.ts 行数为 342

### R3. R28 deploy bug 以 "known carryover" 退场而非修复

- **严重级别**: `high`
- **类型**: `delivery-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - ZX4 plan Phase 1 目标 (P1-01): "R28 cancel I/O 修复"
  - ZX4 plan §16.1: deploy 后 "`verify check=capability-cancel` 仍返 500 'Worker threw exception'"
  - ZX4 closure §3.1: 标注为 "known deploy-only carryover" 且 "不阻塞 ZX4 close"
  - 代码层: AbortController + signal 修法在 nano-session-do.ts:1755-1771 已实现
- **为什么重要**:
  - Action-plan 目标是 "修复 R28"，closure 却说 "R28 没修复但不阻塞 close"——这两者矛盾
  - 本地单元测试通过、deploy 仍 fail 说明 bug 的 deploy-only 特性比预想更复杂
  - 这不是 "known carryover" 应有的语义——carryover 意味着承接到下阶段，而非 "不修了"
- **审查判断**:
  - 代码修改 (AbortController + signal) 的方向是正确的——它把 cancel 从独立子请求 B 移到同请求生命周期内
  - 但 deploy 上的 500 说明还有其他 I/O 隔离路径未被覆盖 (可能是 RPC 调用栈上层的 orchestrator-core's User-DO `await rpc` 触发)
  - closure 应明确写: "R28 在 deploy 环境未修复——根因需 wrangler tail + prod 调试定位，已承接到 ZX5 Lane E。代码层修复方向已落地。"
- **建议修法**:
  - ZX4 closure §3.1 中 R28 的 "影响" 列从 "verification harness 路径,无 user-facing 影响" 修正为 "verification harness 路径, deploy 根因未定位,已承接到 ZX5"
  - ZX4 closure §0 "已完成" 列表中去掉 "R28 cancel I/O cross-request 修" 的 ✅，改为 "R28 代码层修复方向落地, deploy 验证未 pass → ZX5"

### R4. R29 通过删除路径 "解决" 而非定位根因

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX4 plan §16.1: deploy 后 "`verify check=initial-context` 返 502 `agent-rpc-parity-failed`。Phase 1 删了 phase/defaultEvalRecordCount, 本地仍稳定, 但 deploy 上 RPC vs HTTP body 仍微小 divergence"
  - ZX4 plan §16.3: Phase 9 flip 后删除整个 parity 比较——"R29 自动消失"
  - 实际: R29 不是被修复了，而是产生 R29 502 的代码路径被删除了
- **为什么重要**:
  - "修复 R29" 和 "删除会产生 R29 的 parity 比较代码" 是两种性质截然不同的操作
  - Closure 描述 R29 为 "自动消失" 容易误导读者以为 divergence 被 fix 了
  - 实际上 RPC vs HTTP body 之间的微小 divergence 仍然存在——只是不再有代码去检测它
- **审查判断**: 删除 dual-track 是 P3-05 flip 的正确操作，但 closure 不应把 "删除检测代码" 表述为 "bug 消失"。应明确: "R29 所指的 RPC/HTTP body 微小 divergence 因 parity 比较被整体删除而不再触发——未定位 divergence 的根因。"
- **建议修法**: ZX4 closure §0 和 §3.1 中修正 R29 的表述

### R5. 7-day 观察被 30-burst 替代——验证覆盖不足

- **严重级别**: `medium`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX4 plan Phase 8 原定: preview env 7 天 + wrangler tail grep `agent-rpc-parity-failed` + ≥ 1000 turns + 0 误报
  - 实际: owner approved fast-track — 30-session × 3 endpoint × 2 runs = 180 facade calls
  - ZX4 closure §4 将此 risk 标注为 "medium" 且 "acknowledged" 但未见任何缓解措施
- **为什么重要**:
  - 180 facade calls 无法等价于 7 天 + 1000 turns 的统计置信度
  - 180 calls 只覆盖 4 个 endpoint (start/status/history/me-list)，不覆盖 full lifecycle (permission/elicitation/cancel/verify/usage/ws)
  - Phase 9 P3-05 flip 翻转后 parity 比较代码被删除——退出 fast-track 的窗口已关闭 (无法回头补 7 天观察)
- **审查判断**: Fast-track 是开发节奏的合理让步，但 closure 应诚实标注 "7 天观察被缩短为 180-call burst，翻转后无法重新验证单 track 在 1000 turns 下的稳定性"——而不是声称 180 calls 等价于 7 天窗口。
- **建议修法**: ZX4 closure §4 中 "fast-tracked" 描述后补充验证覆盖不足的具体说明

### R6. P3-05 flip 后 parity-bridge.ts 中 logParityFailure 仍被保留但永不触发

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `parity-bridge.ts` 中的 `logParityFailure` (line 182) 和 `computeBodyDiff` (line 170) 仍存在于源码中
  - ZX4 plan §16.3 Step 1: "删 `jsonDeepEqual` parity 比较 + 删 502 `agent-rpc-parity-failed` 路径"
  - 但 `logParityFailure` 函数本身未被删除——它仅不再被任何调用方调用
  - ZX4 closure §1.9 注释 "P9 后 parity 比较已删, helper 保留供未来重启"
- **为什么重要**:
  - 保留不死的工具函数本身无害，但它会造成 "备用双 track 随时可重启" 的假象——实际上 dual-track 的 HTTP 路径已被删除，重启 parity 需要先恢复 HTTP fetch fallback
  - 这与 `transport-profiles.md` 中 "retired" 终态的叙事冲突: retired 意味着不应有计划内的重启路径
- **审查判断**: 若 helper 真为 "供未来重启"，则 `internal-http-compat: retired` 的 "retired" 不是终态。closure 这里存在叙事分裂——一边说 retired 不会回来，一边保留重启 helper。
- **建议修法**: 若确定 `internal-http-compat` 为 permanent retired，将 `logParityFailure` / `computeBodyDiff` 标记为 `@deprecated` 或移除。若保留以备重启，在 `transport-profiles.md` 中标注 "retired 不排除未来新增 track 时复用 body diff helper"。

### R7. workspace-context-artifacts (29 import) + storage-topology (19 import)——ZX3 v2 reclassification 虽正确但未解决依赖问题

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX3 plan Phase 3 原目标: 清零 `workspace-context-artifacts` / `storage-topology` 的 consumer → 删除这些包
  - ZX3 plan §14.1 v2 reclassification: 改为 keep-set utility library，"consumer 不迁移，仅 README posture freeze"
  - 实际: 29 + 19 = 48 处 import 仍然依赖这两个包
  - ZX3 manifest 声称 `workspace-context-artifacts` 37 个 import、`storage-topology` 16 个——实际 grep 得 29 和 19 (差异可能与 grep 范围有关)
- **为什么重要**:
  - Reclassification 作为决策是正确的 (这些包确是真 shared infrastructure)，但 closure 应诚实记录: "原计划删除 3 个 bridge package → 经重新评估改为 keep-set → 48 处 import 保持不动 → 包的 fate 从 '退役' 变为 '长期维护'"
  - 目前 closure 的叙事给人 "Phase 3 顺利完成" 的印象，掩盖了 "Phase 3 的 53 个 import 迁移目标被整体取消" 这个重大 scope reduction
- **审查判断**: ZX3 closure §1.3 描述了 "v2 reclassification"，但应有一条明确的 "scope reduction" 记录，说明原本 P3-01/P3-02/P3-03 的工作不再执行以及原因。
- **建议修法**: ZX3 closure §3 补充 scope reduction 记录: Phase 3 的 consumer migration 目标从 "53 import → 0" 改为 "keep as-is (48 import)"

### R8. 整个 session-interaction cluster 在 MemoryBackend 上运行——R2/KV 仍未绑定

- **严重级别**: `medium`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`
- **事实依据**:
  - `grep -E "r2|kv|KV_NAMESPACE|R2_BUCKET" workers/bash-core/wrangler.jsonc` → 无匹配
  - `grep` 同样确认所有 6 个 worker 均无 R2/KV binding
  - ZX4 的 `handleUsage` 真读 D1、`mintPendingSession` 写 D1——这些是真持久化操作
  - 但 bash-core 的所有文件操作仍走 `MemoryBackend` (纯内存)
- **为什么重要**:
  - ZX4 的所有 session interaction (permission/elicitation decision → KV/DO storage) 是真实的持久化
  - 但整个 bash-core capability execution (filesystem/network) 仍然是假的——这意味着任何需要文件系统的 agent 操作都不可用
  - 从 "zero-to-real" 的视角，这意味着 agent 仍然无法执行文件 I/O (即使 R2 bucket 已存在)
- **审查判断**: 这个问题不是 ZX4 的责任 (R2 wiring 不在 ZX4 scope 内), 但审查需要指出它仍然是 "zero-to-real" 真实客户端体验的硬阻塞项。
- **建议修法**: 标注为 ZX5 Lane E 的必须优先项 (在 context-core/filesystem-core 真 RPC 升级时一并做 R2 wiring)

### R9. `forwardInternalJsonShadow` 方法名保留 "Shadow" 但行为已非 Shadow

- **严重级别**: `low`
- **类型**: `naming`
- **是否 blocker**: `no`
- **事实依据**:
  - `user-do.ts:585` 注释: "Method name preserved (forwardInternalJsonShadow) so call sites stay minimal diff"
  - 实际行为: Phase 9 翻转后不再有 Shadow (dual-track parity)，仅剩 RPC-only 调用
  - ZX4 plan §16.3 注释: "Shadow 是历史称呼, P9 之后无 shadow 行为"
- **为什么重要**: 纯粹是命名卫生问题——方法名暗示 "shadow" 存在但行为已无 shadow。新贡献者阅读时会困惑。
- **审查判断**: 注释已足够清晰，rename 可在后续任意时间做 (不阻碍本轮 review)
- **建议修法**: ZX5 中随 envelope refactor 一并 rename 为 `forwardInternalRpc` 或类似

### R10. ZX3 Phase 3 scope reduction——closure 未清晰承认

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX3 plan Phase 3 原目标: P3-01/P3-02/P3-03 迁移 3 个 bridge package 的 consumer → 清零后删除包
  - ZX3 plan §14.1 v2 reclassification: 3 个包改为 keep-set utility library，"Phase 3 简化为 README posture freeze (docs-only)"
  - 这意味着 Phase 3 的工作量从原本的 "refactor 53 个 import + 建 worker export 面" 降级为 "不改代码"
  - ZX3 closure §1.3 仅说 "v2 simplified" 而未标注此为 scope reduction
- **为什么重要**:
  - Action-plan 的 Phase 3 目标 (清零 consumer → 删除包) 和实际交付 (keep-set, 不做迁移) 有本质差异
  - 这不是 "simplified"，而是 "redefined scope"
  - 不标注 scope reduction 会让未来 reader 误以为 P3-01/P3-02/P3-03 的迁移工作已执行
- **审查判断**: ZX3 closure 应明确记录: "P3-01/P3-02/P3-03 的 consumer migration 目标已取消 (reclassified as keep-set, 不再需要清零 import)。Phase 3 的实际交付物为 6 份 README posture freeze (docs-only)。"
- **建议修法**: ZX3 closure §1.3 + §3 中补充 scope reduction 记录

### R11. docs/design 中有 3 份非退役文档仍将 test-legacy/ 作 active 路径

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `docs/design/orchestration-facade/F0-live-e2e-migration-inventory.md:22` — 引用 "test-legacy/ contract guardians"
  - `docs/action-plan/worker-matrix/PX-new-tests.md` — 多处以 active 语气描述 test-legacy 结构
  - `docs/action-plan/zero-to-real/Z2-session-truth-and-audit-baseline.md:477` — 引用 "test-legacy/session-registry-doc-sync.test.mjs"
- **为什么重要**: 这些文件不属于 ZX3/ZX4 退役文档，是独立的设计文档。其中仍将 test-legacy 作为 active 路径，可能误导未来读者。
- **审查判断**: 非退役主线文档，不阻碍本轮 review。建议逐步标注 archive note。
- **建议修法**: 在 3 份文档头部加 "POST-ZX3 NOTE: test-legacy/ has been deleted per ZX3 Phase 5"

### R12. migration 006 table-swap 模式在 prod deploy 时的短暂不一致窗口

- **严重级别**: `medium`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`
- **事实依据**:
  - migration 006 采用 SQLite table-swap 模式: 新建带新 CHECK 约束的表 → 数据迁移 → drop old → rename new → reindex
  - ZX4 closure §4 提醒: "prod 待 owner deploy 时一并应用"
  - ZX4 closure §1.8 确认 migration 仅 apply 到 preview D1
- **为什么重要**:
  - Table-swap 期间 D1 短暂处于双 schema 状态——如果 deploy 时 worker 仍然往旧表写入，数据会丢失
  - preview deploy 执行的 "migration → deploy" 如果顺序正确则无害；但 closure 未记录 preview 的 deploy + migration 执行顺序
- **审查判断**: 这是一个运维级提醒而非代码缺陷。因 table-swap 是标准 D1 migration 操作，风险可控。
- **建议修法**: ZX4 closure §4 中补充: "prod deploy 时先 deploy migration → 等待 migration complete → 再 deploy 6 worker" 的顺序建议

### R13. 14 个 retired guardians 的契约覆盖未做系统 cross-reference

- **严重级别**: `low`
- **类型**: `test-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX3 原 19 个 guardians → Phase 4 迁 5 个 surviving → retire 14 个
  - ZX3 closure §4: "这些 guardians 测试的是已被 absorbed 到 worker 的 runtime 模块; 现在的契约保护已分散在 worker-local tests 中"
  - 但 closure 未做逐条映射: retired guardian X 的契约现在由哪些 worker tests 覆盖？
- **为什么重要**: 若某个 retired guardian 覆盖的 cross-cutting 契约未被任何 worker-local test 取代，则测试保护出现缺口
- **审查判断**: 当前 1536 tests 全绿 + 31 root-guardians 全绿是强信号，但不能代替 cross-reference。属于低风险的审慎提醒。
- **建议修法**: ZX5 启动后做一次 "contract cross-reference audit"——对照 14 个 retired guardian 的 assert 语句与 worker-local test 覆盖

---

## 3. In-Scope 逐项对齐审核

> 结论: `done | partial | missing | stale | out-of-scope-by-design`
> 对照 ZX3 plan §3 业务工作总表 + ZX4 plan §3 业务工作总表

### 3.1 ZX3 Phase 1-5 逐项审核

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P1-01 | package posture manifest | `done` | §14.1 manifest 准确对应 packages/ 实际结构 |
| P1-02 | test-legacy inventory manifest | `done` | §14.2 分类与最终执行一致 |
| P1-03 | ZX2 carryover scope decision | `done` | §11 mapping 表准确 |
| P2-01 | delete absorbed duplicate packages | `done` | 6 个包物理删除, 无 import 残留 |
| P2-02 | workspace/docs cleanup | `partial` | lockfile 清理因 NODE_AUTH_TOKEN 未完成, 但测试全绿 |
| P3-01 | migrate workspace-context-artifacts consumers | `out-of-scope-by-design` | v2 reclassified as keep-set → 不做 consumer migration |
| P3-02 | migrate storage-topology consumers | `out-of-scope-by-design` | 同上 |
| P3-03 | migrate eval-observability test helpers | `out-of-scope-by-design` | 同上 |
| P3-04 | freeze orchestrator-auth-contract posture | `done` | §14.1 manifest 显式标注 keep-set |
| P4-01 | move external seam fixtures | `done` | 4 fixture 文件迁到 test/shared/fixtures/, agent-core test 正确引用 |
| P4-02 | create root-guardians tree | `done` | 5 guardians 迁入 + 14 retired + test-command-coverage 改写 |
| P4-03 | switch root scripts | `done` | test:contracts → test/root-guardians/*.test.mjs, test:legacy:* 删除 |
| P4-04 | cross-e2e topology fix (R30) | `done` | 所有 cross-e2e 切换为 facade-唯一-entry 模型 |
| P5-01 | remove remaining legacy tree | `done` | test-legacy/ 物理删除 |
| P5-02 | final docs and closure sync | `done` | §14-§16 工作日志 + ZX3-closure.md 完成 |

### 3.2 ZX4 Phase 0-9 逐项审核

| 编号 | 计划项 | 审查结论 | 说明 |
|------|--------|----------|------|
| P0-01 | user-do.ts 4 模块 seam extraction | `done` | 4 模块全部存在, import 迁移正确, 零 regression |
| P0-02 | import/test 迁到新 4 模块 | `done` | user-do.ts import 路径已切换 |
| P1-01 | R28 cancel I/O 修 | `partial` | 代码层修法落地 (AbortController+signal), deploy 验证未通过 (仍 500) |
| P1-02 | R29 verify body 双轨发散修 | `partial` | 代码层删 stateful 字段, deploy 仍产生 parity mismatch (P9 flip 后因路径删除不再触发) |
| P1-03 | R28/R29 targeted preview smoke | `partial` | P1-03 原 exit gate 要求 targeted smoke pass, 但 ZX4 plan §16.1 记录 R28 500 仍存——gate 条件未达 |
| P2-01 | parity log body diff 升级 | `done` | body diff 已落地, 18 unit tests |
| P3-01 | D1 migration 006 | `done` | 已 apply 到 remote preview D1, SQL CHECK 6 状态 |
| P3-02 | TS union 扩展 | `done` | DurableSessionStatus + SessionStatus 均为 6 状态 |
| P3-03 | POST /me/sessions 写 D1 pending | `done` | index.ts:492 mintPendingSession 事务插 2 行 |
| P3-04 | DO alarm GC | `done` | user-do.ts:1849 expireStalePendingSessions 实现 |
| P3-05 | GET /me/sessions read-model 5 状态合并 | `done` | user-do.ts handleMeSessions 合并 KV+D1 |
| P3-06 | handleStart pending→active 状态机 | `done` | R10 conversation_uuid NOT NULL 约束已处理 |
| P3-07 | ingress guard 同步改写 | `done` | user-do.ts sessionGateMiss 按 pending/expired/null 分流, 11 unit tests |
| P4-01 | permission request producer | `done` | agent-core internal.ts + nano-session-do.ts recordAsyncAnswer |
| P4-02 | permission decision consumer + resolver | `done` | user-do.ts handlePermissionDecision + AGENT_CORE RPC |
| P5-01 | usage live push + 真预算 snapshot | `done` | user-do.ts handleUsage 真读 D1 nano_usage_events + nano_quota_balances |
| P6-01 | elicitation round-trip | `done` | 同 P4 对称实现, 4 contract tests |
| P6-02 | live e2e 扩展 | `done` | zx2-transport.test.mjs ZX4 段已扩展 |
| P7-01 | preview deploy + cross-e2e 14/14 | `partial` | 12/14 pass + 2 known carryover (R28/R29), 但 closure 已诚实记录 |
| P8-01 | 7-day parity observation | `partial` | Fast-tracked to 30-session burst — 覆盖不足, 但 owner-approved |
| P9-01 | P3-05 flip | `done` | fetch fallback 删除, SUPPORTED_INTERNAL_ACTIONS 收紧, deploy + burst 验证 |
| P9-02 | R31 workers_dev 撤销 | `done` | 5 leaf worker workers_dev: false, 状态确认 |
| P9-03 | transport-profiles.md retired | `done` | 3 处更新到 retired |
| P9-04 | runbook/zx2-rollback.md 归档 | `done` | 标注 archive date 2026-05-12 |

### 3.3 对齐结论

- **done**: `28`
- **partial**: `6` (P2-02 lockfile, P1-01 R28, P1-02 R29, P1-03 smoke gate, P7-01 cross-e2e, P8-01 observation)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `3` (P3-01/P3-02/P3-03 因 v2 reclassification 取消)

> 综合判断: ZX3 是 "主体 100% 完成"；ZX4 的 Lane A (transport close) 以 P3-05 flip 的 "删除路径" 策略闭合而非以 "修复根因" 闭合，Lane B (session semantics) 的 contract 层 100% 完成但 runtime kernel waiter 留到 ZX5。

---

## 4. Out-of-Scope 核查

> 本节用于检查实现是否越界，也用于确认 reviewer 是否把已冻结的 deferred 项误判为 blocker。

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | `@haimang/jwt-shared` package 创建 (R20) → ZX5 | `遵守` | 未创建，包名已 reserved in manifest |
| O2 | envelope 三 type 收敛 (R19) → ZX5 | `遵守` | 未实现 |
| O3 | FacadeErrorCode ⊂ RpcErrorCode 跨包断言 (R21) → ZX5 | `遵守` | 未实现 |
| O4 | JWT kid rotation 集成测试 → ZX5 | `遵守` | 未实现 |
| O5 | web/wechat heartbeat/replay → ZX5 | `遵守` | 未实现 |
| O6 | catalog content 填充 (R18) → ZX5 | `遵守` | catalog 仍返空数组 |
| O7 | 4 个产品型 endpoint → ZX5 | `遵守` | 未实现 |
| O8 | WORKER_VERSION CI 动态化 (R25) → ZX5 | `遵守` | 未实现 |
| O9 | DO 提取独立 worker → owner frozen, not ZX5 | `遵守` | 6-worker 架构硬冻结, 未动 |
| O10 | context-core/filesystem-core 真 RPC → ZX5 | `遵守` | 未实现 |
| O11 | WeChat 真机 smoke (R17) → owner-action | `遵守` | 未实现 |
| — | P4/P6 agent-core runtime kernel waiter | `遵守` | ZX4 scope 明确 "cluster work deferred to ZX5 Lane E", 代码层只交付 contract 全栈 |
| — | P5 WS push `session.usage.update` server frame | `遵守` | 同上 |
| — | 7 天 parity 观察被 fast-track | `部分违反` | ZX4 plan 主路径要求 7 天 + 1000 turns，实际 180 calls——属 owner-approved deviation 但 closure 未记录为 scope deviation |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**: `ZX3 (组件退役 + test 树 cutover) — 通过。ZX4 (transport 真收口 + session 语义) — 代码层通过，closure 文档需修正 R1/R2/R3 三项硬缺陷后才可收口。`

- **是否允许关闭本轮 review**: `no — 需修正 R1/R2/R3 三项后重新审查`

- **关闭前必须完成的 blocker**:
  1. **R1**: 修正 ZX3 closure §1.4 + ZX4 closure §0/§1.1/§2 中 user-do.ts 行数声明 (1659 → 1910)
  2. **R2**: 修正 ZX4 plan §10.1/§10.3 中 parity-bridge.ts 行数声明 (200 → 342) + 4 seam 模块总计 (447 → 592)
  3. **R3**: 修正 ZX4 closure §0/§3.1 中 R28 的状态从 "✅ 已完成" 改为 "代码层修复落地, deploy 验证未 pass → ZX5 承接"，并明确区分 "code fix" vs "deploy verification"

- **可以后续跟进的 non-blocking follow-up**:
  1. R4: ZX4 closure 中区分 "修复 R29 根因" vs "删除产生 R29 的代码路径"
  2. R5: ZX5 启动后建立单 track RPC-only 的持续稳定性监控 (替代已删除的 parity 比较)
  3. R6: 决定 parity-bridge.ts 中 `logParityFailure`/`computeBodyDiff` 的长期 fate (remove vs retain-as-reference)
  4. R7: ZX5 中明确 workspace-context-artifacts / storage-topology 的长期演化路线
  5. R8: ZX5 启动后优先完成 R2/kv wrangler.jsonc wiring (bash-core → R2Adapter + KvAdapter)
  6. R10: ZX3 closure §3 补充 scope reduction 记录 (Phase 3 的 53-import 迁移目标取消)
  7. R11: 3 份非退役 docs/design 文件中标注 test-legacy 已删除
  8. R12: ZX4 closure §4 补充 prod deploy 顺序建议 (migration 006 → deploy 6 workers)
  9. R13: ZX5 启动后做 contract cross-reference audit (retired guardians → worker-local tests)

- **建议的二次审查方式**: `same reviewer rereview — 仅需 verify closure 文档修正 + R3 的 R28 状态改写，不需要重新跑全量代码核查`

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §6 append 回应，不要改写 §0–§5。`

---

> 本轮 review 不收口，等待实现者按 §6 响应修正 closure 文档中的 R1 (user-do.ts 行数)、R2 (parity-bridge.ts 行数)、R3 (R28 deploy 验证状态) 三项不实声明。其余 findings (R4-R13) 为非阻塞 follow-up，可在 ZX5 启动后逐项清理。
