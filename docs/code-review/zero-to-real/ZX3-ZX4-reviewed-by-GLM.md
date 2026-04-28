# Nano-Agent 代码审查 — ZX3-ZX4 阶段审查

> 审查对象: `zero-to-real / ZX3 Components Deprecation + ZX4 Transport True Close and Session Semantics`
> 审查类型: `mixed (code-review + closure-review + cross-phase-review)`
> 审查时间: 2026-04-28
> 审查人: GLM-5.1
> 审查范围:
> - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`（含 §14-§16 工作日志）
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`（含 §10-§16 工作日志）
> - `docs/issue/zero-to-real/ZX3-closure.md`
> - `docs/issue/zero-to-real/ZX4-closure.md`
> - `workers/orchestrator-core/src/{user-do.ts,session-lifecycle.ts,session-read-model.ts,session-truth.ts,ws-bridge.ts,parity-bridge.ts,index.ts}`
> - `workers/orchestrator-core/migrations/006-pending-status-extension.sql`
> - `workers/agent-core/src/host/{do/nano-session-do.ts,internal.ts,remote-bindings.ts}`
> - `workers/agent-core/src/hooks/permission.ts`
> - `test/cross-e2e/{01,02,03,07,10,11}*.test.mjs`
> - `test/cross-e2e/zx2-transport.test.mjs`
> - `test/root-guardians/*.test.mjs`
> - `test/shared/live.mjs`
> - `docs/transport/transport-profiles.md`
> - `docs/runbook/zx2-rollback.md`
> - `packages/`（目录含 6 keep-set 包）
> - `pnpm-workspace.yaml`、`package.json`、`pnpm-lock.yaml`
> 对照真相:
> - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`（full action plan）
> - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`（full action plan）
> - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-GLM.md`（前置审查，用于跨阶段对账）
> - `docs/code-review/zero-to-real/Z3-reviewed-by-opus.md`、`Z4-reviewed-by-opus.md`（同轮 Opus 审查，仅作为线索参考，不采纳其结论）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**: ZX3 + ZX4 两阶段的主体实现与 action-plan / closure claim 高度一致，代码可验证，测试证据充分。ZX3「组件退役 + test-legacy cutover」与 ZX4「transport 真收口 + session 语义闭环」的核心目标均已达成。存在 4 个需后续跟进的 non-blocking finding（1 个 stale comment、1 个 dead import、1 个 guardian 计数偏差、1 个 key-package import 计数偏差），不影响关闭本轮 review。
- **结论等级**: `approve-with-follow-ups`
- **是否允许关闭本轮 review**: `yes`
- **本轮最关键的 3 个判断**:
  1. ZX3 的 v2 reclassification（3 utility library 从 deletion candidate 改为 keep-set）是正确且审慎的决策——核验 `packages/` 实际有 6 个 keep-set 包、`test-legacy/` 已物理删除、`test:contracts` 指向 `root-guardians`，全部与 closure claim 一致。
  2. ZX4 的 P0-P9 全 phase 实现可验证——4 seam 模块实际存在且 user-do.ts 正确 import、R28 AbortController 修法落地、R1 status enum 6 状态同步、R11 ingress guard 落地、P9 flip 确认删掉 fetch fallback 与 non-stream handler、migration 006 已 apply。但存在 1 处 stale comment（`user-do.ts:948` 声称 fallback 仍在）和 2 处 dead import（`jsonDeepEqual` / `logParityFailure` 在 user-do.ts 中未被调用），属于 P9 flip 清理遗漏。
  3. 跨阶段（ZX1→ZX4 全链路）存在 2 项结构性关注：(a) `storage-topology` 和 `eval-observability` 的实际 import 数远低于 closure claim 的 16/2，意味着它们的 keep-set 分类虽正确但实际使用深度可能被高估；(b) ZX5 plan 中 Lane E「agent-core kernel hook await-resume 改造」与 ZX4 P4/P6 留下的「contract 已 land、runtime kernel 等待未做」gap 需要 ZX5 明确收口路径。

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/action-plan/zero-to-real/ZX3-components-deprecation.md`（943 行，含 §14-§16 工作日志）
  - `docs/action-plan/zero-to-real/ZX4-transport-true-close-and-session-semantics.md`（816 行，含 §10-§16 工作日志）
  - `docs/issue/zero-to-real/ZX3-closure.md`（161 行）
  - `docs/issue/zero-to-real/ZX4-closure.md`（232 行）
  - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-GLM.md`（跨阶段对账线索）
- **核查实现**:
  - `ls packages/` → 6 项（与 ZX3 §14.1 manifest 一致）
  - `ls test-legacy/` → 不存在（与 ZX3 Phase 5 物理删除 claim 一致）
  - `ls test/` → `INDEX.md / cross-e2e / package-e2e / root-guardians / shared`（与 ZX3 claim 一致）
  - `ls test/root-guardians/` → 6 个测试文件
  - `workers/orchestrator-core/src/{parity-bridge,ws-bridge,session-lifecycle,session-read-model,session-truth,user-do}.ts` — 全部存在且正确 import
  - `workers/orchestrator-core/migrations/006-pending-status-extension.sql` — 存在，283 行，table-swap 模式正确
  - `workers/agent-core/src/host/do/nano-session-do.ts` — AbortController 修法落地（line 1754-1771）
  - `workers/agent-core/src/host/internal.ts` — `SupportedInternalAction` 仅 `stream | stream_snapshot`（P9 flip 确认）
  - `docs/transport/transport-profiles.md` — `internal-http-compat: retired`
  - `docs/runbook/zx2-rollback.md` — ZX4 P9 update 已标注，archive date `2026-05-12`
- **执行过的验证**:
  - `grep -r "from '@nano-agent/agent-runtime-kernel'" workers/ test/` → 0 命中（6 个 deleted package 零残留）
  - `grep -rn "test-legacy" test/ workers/` → 仅 4 处注释引用，无代码 import
  - `pnpm -F @haimang/orchestrator-core-worker test` → 75/75 pass
  - `pnpm -F @haimang/agent-core-worker test` → 1056/1056 pass
  - `pnpm test:contracts` → 31/31 pass
  - `grep -rn "session-pending-only-start-allowed" workers/` → 2 处（user-do.ts + test file）
  - `grep -rn "AbortController" workers/agent-core/src/host/do/nano-session-do.ts` → 确认 R28 修法
  - `grep -rn "SUPPORTED_INTERNAL_ACTION" workers/agent-core/src/host/internal.ts` → 仅 stream/stream_snapshot
- **复用 / 对照的既有审查**:
  - `docs/code-review/zero-to-real/ZX1-ZX2-reviewed-by-GLM.md` — 用于跨阶段设计债务对账（3 种 envelope、JWT 重复、FacadeErrorCode 同步）
  - `docs/code-review/zero-to-real/Z3-reviewed-by-opus.md`、`Z4-reviewed-by-opus.md` — 仅作为线索，本审查独立复核所有事实

### 1.1 已确认的正面事实

- **ZX3 零残留**: 6 个 deleted package 无任何 runtime/test/doc 活跃 import；`pnpm-lock.yaml` 已无 stale 块（与部分 ZX3 closure claim 矛盾，见 §1.2）。
- **ZX3 test-legacy cutover 完成**: `test-legacy/` 物理删除、`test:contracts` 指向 `test/root-guardians/*.test.mjs`、`test:legacy:*` 脚本已删。4 层 canonical test tree（shared / root-guardians / package-e2e / cross-e2e）实际存在。
- **ZX3 v2 reclassification 正确**: 6 包 keep-set（3 protocol + 3 utility）分类审慎；`workspace-context-artifacts` 有 6 处活跃 import 证明其 utility 性质。
- **ZX4 Phase 0 seam extraction 落地**: `user-do.ts` 从 1950 行降至 1659 行；4 个 seam 模块合计 447 行；命名一致 kebab-case；tests 零回归。
- **ZX4 R28 修法正确**: `AbortController + signal` 替代独立 `transport.cancel`，同请求生命周期取消。未删 `transport.cancel` 接口定义（向后兼容保留），但调用点已消除。
- **ZX4 R1 状态机 6 状态同步落地**: SQL CHECK、TS `DurableSessionStatus` union、read-model 合并视图、alarm GC 四处对齐（migration 006 内容与 R10 schema 字段冻结一致）。
- **ZX4 R11 ingress guard 落地**: `sessionGateMiss()` helper 对 `pending` 返 409 `session-pending-only-start-allowed`，对 `expired` 返 409 `session-expired`，11 个 unit test 覆盖。
- **ZX4 P9 flip 真实**: `forwardInternalJsonShadow` 方法名保留但 HTTP fetch fallback 已删、只保留 RPC + try/catch 502 `agent-rpc-throw`；`SupportedInternalAction` 仅 `{stream, stream_snapshot}`；`forwardHttpAction` helper 整体删除。
- **ZX4 migration 006 已 apply 到 remote D1**（closure 记录 32 commands / 34ms）。
- **ZX4 全量测试**: 75 + 1056 + 374 + 31 = 1536 tests pass（orchestrator-core +33 vs ZX3 baseline）。
- **transport-profiles.md 已更新到 `retired` 终态**，runbook 标注 archive date `2026-05-12`。

### 1.2 已确认的负面事实

- **R1 — user-do.ts stale comment**: `user-do.ts` 约 line 948 仍写"forwardInternalJsonShadow falls back to HTTP-only"——这是 P9 flip 前的描述，post-flip 已不再 fallback 到 HTTP，注释与代码行为矛盾。
- **R2 — user-do.ts dead imports**: `jsonDeepEqual` 和 `logParityFailure` 从 `parity-bridge.ts` 导入到 `user-do.ts`，但 P9 flip 后不再被调用。它们在 `parity-bridge.ts` 中仍是有意义的导出（供 Phase 2 body diff 使用，P9 后 parity helper 保留供未来重启），但 `user-do.ts` 中的 import 是死代码。
- **R3 — root-guardians 计数偏差**: ZX3 closure 声称"5 个 surviving guardians"，但 `test/root-guardians/` 实际有 6 个文件（含 `test-command-coverage.test.mjs`）。后者是 meta-guardian（守护测试脚本覆盖）、保护契约语义不同但功能有效。Closure 应标注为 5 + 1 或 6。
- **R4 — key-package import 数量偏差**: Closure §14.1 声称 `workspace-context-artifacts` 有 37 active imports、`storage-topology` 有 16、`eval-observability` 有 2；实际 `from '@nano-agent/...'` 精确 grep 分别为 6 / 0 / 0。差距来自 3 个包的 `package.json` 依赖声明和间接引用（通过 `dist/` 或 barrel export），但 closure 使用的"37 active imports"数字可能包含了注释、类型声明、已删测试路径等非运行时 import，对读者有误导性。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐项核查 user-do.ts、session-lifecycle.ts、session-truth.ts、nano-session-do.ts、internal.ts、parity-bridge.ts、migration 006、live.mjs、package.json、transport-profiles.md、runbook |
| 本地命令 / 测试 | yes | orchestrator-core 75/75、agent-core 1056/1056、bash-core 374/374、root-guardians 31/31 |
| schema / contract 反向校验 | yes | R1 status enum 6 状态 4 处对齐（SQL CHECK + TS union + read-model + alarm GC） |
| live / deploy / preview 证据 | partial | 无法复现 preview deploy（需 owner 凭证），采用 closure 记录的 12/14 cross-e2e + 90/90 burst probe 作为证据 |
| 与上游 design / QNA 对账 | yes | ZX3 Q1-Q6 owner 决策、ZX4 Q1-Q5 owner 决策、R1/R10/R11 GPT 二审追加均已落地 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | user-do.ts stale comment 误述 P9 post-flip 行为 | medium | docs-gap | no | 修正 line 948 注释 |
| R2 | user-do.ts dead imports (jsonDeepEqual / logParityFailure) | low | correctness | no | 删除 user-do.ts 中两个 unused import |
| R3 | root-guardians 计数偏差(closure 称 5 实际 6) | low | docs-gap | no | 更新 ZX3 closure §1.4 / §2 计数 |
| R4 | key-package import 计数偏差(37 vs 6) | low | docs-gap | no | 在 ZX3 closure §14.1 备注计数口径差异 |
| R5 | P8 fast-track 对 ZX4 plan Q4 7-day 观察前提的偏离 | medium | delivery-gap | no | 在 closure 中显式标注 owner 方向覆盖 + 功能替代论证 |
| R6 | R28 verify-cancel deploy 500 仍存在但 closure 归为 non-blocking | medium | platform-fitness | no | 跟踪到 ZX5,确认为 I/O 隔离残留路径 |
| R7 | ZX3→ZX4 包围界不清:ZX3 仍 defer R30 到 ZX4 但 ZX4 closure 已 land P4-04 | low | docs-gap | no | ZX3 closure §16.7 defer 列表标注 R30 已在 ZX4 P4-04 land |
| R8 | D1SessionTruthRepository 缺少 readSide 事务一致性防护 | medium | correctness | no | P3-03 mintPendingSession 事务插 2 行但 hydrateSessionFromDurableTruth 返 null 不防并发表竞 |
| R9 | ZX5 Lane E session hook await-resume 与 ZX4 P4/P6 contract gap 无显式 handoff | medium | scope-drift | no | 在 ZX5 plan 中显式声明 P4/P6 已 land 的 contract 端点 + 需补的 kernel 等待改造 |

### R1. user-do.ts stale comment 误述 P9 post-flip 行为

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/src/user-do.ts` 约 line 948 注释仍写"forwardInternalJsonShadow falls back to HTTP-only"
  - P9 flip 后 `forwardInternalJsonShadow` 方法已改为 RPC-only + try/catch `agent-rpc-throw`
  - HTTP fallback 路径已删除，注释与代码行为矛盾
- **为什么重要**: 后续维护者读到注释会误以为 dual-track 仍在运行，可能在 debug 时走错方向
- **审查判断**: P9 flip 执行正确但注释清理遗漏——Closure §1.10 声称"P9 flip 真删 fetch fallback"，代码行为一致但注释滞后
- **建议修法**: 修正 line 948 注释为"P9 后此方法仅走 RPC 路径；HTTP fallback 已于 ZX4 Phase 9 删除"

### R2. user-do.ts dead imports (jsonDeepEqual / logParityFailure)

- **严重级别**: `low`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `user-do.ts` line 15-16 仍 import `jsonDeepEqual` 和 `logParityFailure` from `./parity-bridge.js`
  - P9 flip 后这两个函数在 user-do.ts 中无调用点（parity 比较已删除）
  - 它们在 `parity-bridge.ts` 中仍是有意义的导出（Phase 2 body diff 功能保留供未来重启），但 user-do.ts 的 import 是死代码
- **为什么重要**: 死 import 增加认知负担，且如果有 tree-shaking 不当可能引入无用 code
- **审查判断**: P9 flip 清理不完全，实际无运行时影响
- **建议修法**: 删除 `user-do.ts` 中 `jsonDeepEqual` 和 `logParityFailure` 的 import 语句

### R3. root-guardians 计数偏差

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX3 closure §1.4 写"5 个 surviving guardians 迁 `test/root-guardians/`"
  - 实际 `ls test/root-guardians/` 有 6 个文件：initial-context-schema-contract / nacp-1-3-matrix-contract / session-registry-doc-sync / storage-topology-contract / test-command-coverage / tool-call-live-loop
  - `test-command-coverage.test.mjs` 是 meta-guardian（守护测试脚本覆盖而非特定 runtime 契约），closure 将其单独归类为"P4-03 scripts 切换"的产物但未计入 guardian 总数
- **为什么重要**: 计数不精确会让后续贡献者对 test tree 的结构理解产生偏差
- **审查判断**: Closure 应写"5 个 contract guardians + 1 个 meta-guardian = 6 个文件"
- **建议修法**: 更新 ZX3 closure §1.4 从"5 个"改为"5 个 contract guardians + 1 个 meta-guardian（test-command-coverage）= 6 个文件"

### R4. key-package import 计数偏差

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX3 closure §14.1 声称 `workspace-context-artifacts` 有 "37 active imports"、`storage-topology` 有 "16"、`eval-observability` 有 "2"
  - 精确 `from '@nano-agent/workspace-context-artifacts'` 活跃 import 在 workers/test 中仅 6 处
  - Closure 计数可能包含了 `package.json` 依赖声明、TypeScript 类型引用、`dist/` 间接引用、注释、已删文件路径等
- **为什么重要**: 收口标准写"import 清零"或"37 active imports"，数字口径不一致会让后续执行者误判 risk
- **审查判断**: v2 reclassification 的核心判断（3 个 utility library 保留为 keep-set）是正确的；但 import 计数字段有误导性
- **建议修法**: 在 ZX3 closure §14.1 备注说明"37 指 package.json 依赖声明 + type/value import + test import 的合计口径，纯 `from '@nano-agent/...'` 活跃 runtime import 为 6"

### R5. P8 fast-track 对 ZX4 plan Q4 7-day 观察前提的偏离

- **严重级别**: `medium`
- **类型**: `delivery-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX4 plan Q4 冻结为"所有 parity 影响代码冻结 + cross-e2e 14/14 全绿后启动 7-day 观察"
  - Owner direction fast-track 命令:"我们没有时间等2周，Phase 8 需要立刻过掉"
  - 实际执行: 30-session burst probe（90/90 facade calls clean）替代 7-day window
  - Closure §4 风险表已标注"P8 fast-track 没跑满 1000 turns"但缓解为"180 calls 全 clean"
- **为什么重要**: ZX4 plan 显式将"≥ 1000 turns"作为 P8 退出标准；fast-track 在物理上无法覆盖长尾场景（慢查询、alarm GC、D1 冷启动），但 closure 将其归为 "medium" 而非 "high"
- **审查判断**: Owner 方向覆盖是合理的（开发节奏优先），但功能等价性论证不充分——30 sessions × 3 endpoints × 2 runs = 180 calls 与 7 天 ≥ 1000 turns 的覆盖面不在同一量级。Closure 应显式标注"功能验证等价而非性能/边界等价"
- **建议修法**: 在 ZX4 closure §4 风险表中追加一条注释:"fast-track 仅等价于功能验证（4 核心 facade endpoint 200 OK + 0 error），不等价于性能/边界/长尾验证；后续 dev 中如发现 mismatch，通过 `agent-rpc-throw` log 定位"

### R6. R28 verify-cancel deploy 500 仍存在

- **严重级别**: `medium`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX4 Phase 1 R28 修法（AbortController + signal）在本地全测试 pass，但 deploy 后 `POST /verify {check: capability-cancel}` 仍返 500 "Worker threw exception"
  - Closure §3.1 标注为 "verification harness only, 无 user-facing 影响"
  - 根因疑在 RPC 调用栈上层（orchestrator-core's User-DO `await rpc` 后某环节抛出）
  - P9 flip 后 verify 不走 dual-track，但 R28 500 是 RPC 路径本身的问题，不是 parity 问题
- **为什么重要**: 如果 verify 能力取消在未来产品化（如用户主动取消正在进行的 capability），500 会被 user-facing 路径触达
- **审查判断**: 当前确实不阻塞 dev velocity，但应明确跟踪到 ZX5
- **建议修法**: 在 ZX5 plan Lane A 或 Lane E 中显式声明 R28 deploy 500 的根因分析 follow-up；当前 closure 对 R28 的表述"verification harness only"可能过于乐观

### R7. ZX3→ZX4 包围界不清: R30 defer 列表与实际 land

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX3 closure §16.7 defer 列表将 R30 列为 "ZX4 Stream-1" 的项目
  - 但实际上 ZX3 Phase 4 P4-04 已在 ZX3 内 land 了 R30 cross-e2e 拓扑修（6 个 cross-e2e 文件改为 facade-唯一-entry 模型）
  - ZX4 closure §1.7 同样确认 P4-04 已在 ZX3 land
  - 该交叉引用说明 ZX3 closure 的 §16.7 defer 列表在 R30 这一项已经过时
- **为什么重要**: 后续阅读者会认为 R30 仍在 ZX4 待做
- **建议修法**: ZX3 closure §16.7 R30 行应标注"已在 ZX3 P4-04 land，不再 defer 到 ZX4"

### R8. D1SessionTruthRepository 缺少 readSide 事务一致性防护

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - P3-03 `mintPendingSession()` 事务插 2 行（`nano_conversations` + `nano_conversation_sessions`），D1 事务保证原子性
  - P3-07 `hydrateSessionFromDurableTruth` 对 pending/expired 返 null（防止假冒可写 entry）
  - 但 P3-05 `handleMeSessions()` 合并 KV index + D1 read-model 时，KV 读和 D1 读不在同一事务中——如果 alarm GC 在两次读之间将 detached session 标为 expired，KV 仍然返回旧 index，D1 返回 expired，merge 逻辑以 D1 为优先是正确的；但如果 KV 有 stale cache 而 D1 已被 GC 清理，可能出现短暂不一致
  - P3-06 handleStart 的 `UPDATE ... WHERE status='pending'` 没有 idempotency key——如果客户端重发 `/start`，可能在 `starting` → `active` 转换中出现竞态
- **为什么重要**: D1 是 SQLite 单库，单行事务是原子的，但 KV + D1 的跨存储一致性依赖"KV 是 warm cache, D1 是 truth"的设计假设。该假设在 ZX4 已显式落地（`hydrateSessionFromDurableTruth` 返 null 即是防御），但 handleStart 的 idempotency 缺口可能在重试场景下暴露
- **审查判断**: 当前 P3-06 保留了 `duplicate-start 409` guard（如果 KV 有 active entry 返 409），这在大部分场景下足够。但纯 D1 路径（KV miss + D1 pending）缺少幂等重试防护。这不是 ZX4 阻塞项，但应跟踪到 ZX5
- **建议修法**: 在 ZX5 Lane B 或 Lane A 中标注: "handleStart idempotency — 当 KV miss 且 D1 status='pending' 时，重试 `/start` 可能导致 `starting` → `active` 竞态；建议加 request-scoped idempotency key 或 D1 `UPDATE ... WHERE status='pending' AND started_at = :minted_at` 条件"

### R9. ZX5 Lane E session hook await-resume 与 ZX4 P4/P6 contract gap

- **严重级别**: `medium`
- **类型**: `scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - ZX4 P4 已 land permission decision 的 orchestrator-core → agent-core RPC + NanoSessionDO storage contract
  - ZX4 P6 已 land elicitation answer 的完全对称 contract
  - 但 agent-core 的 PermissionRequest / ElicitationRequest hook 仍未改造成 await DO storage waiter——runtime kernel 只是发出 server frame，不会阻塞等待 decision 回流
  - ZX4 closure §3.2 明确标注为"ZX5 Lane E cluster-level follow-up"
  - ZX5 plan 存在但内部 Lane E 的描述粒度不够——只说"在现有 6-worker 内部 wait-and-resume kernel 改造"，没有显式列出 P4/P6 已 land 的 contract 端点清单
- **为什么重要**: 如果 ZX5 Lane E 执行者不知道 P4/P6 已 land 了什么 contract，可能重复实现 RPC 层，或在错误的位置等待
- **建议修法**: 在 ZX5 plan Lane E 开头追加显式 handoff:"ZX4 P4/P6 已 land: (1) orchestrator-core `handlePermissionDecision()` KV + best-effort RPC 到 agent-core; (2) agent-core `AgentCoreEntrypoint.permissionDecision()` + `elicitationAnswer()` RPC 方法; (3) NanoSessionDO `recordAsyncAnswer()` storage 写入 `permission/decisions/${requestUuid}` 和 `elicitation/decisions/${requestUuid}`。Lane E 需要补: (a) PermissionRequest hook 在 emit frame 后 `await this.doState.storage.get(...)` 轮询 decision; (b) 同理 ElicitationRequest hook; (c) Usage push `session.usage.update` server frame emit"

---

## 3. In-Scope 逐项对齐审核

### ZX3 In-Scope 对齐

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | Phase 1: package posture manifest 冻结 | `done` | §14.1 manifest 列 6 keep-set + 6 deletion + 1 reserved，与实际 `ls packages/` 完全一致 |
| S2 | Phase 1: test-legacy inventory manifest 冻结 | `done` | §14.2 分 4 类 27 entries，P4 实际迁 5+1 guardian + 3 fixture，P5 物理删除，与 claim 一致 |
| S3 | Phase 1: ZX2 carryover scope decision | `done` | §14.3 + §11 逐条 mapping，R30 在 ZX3 P4-04 land（与 §16.7 defer 列表矛盾，见 R7） |
| S4 | Phase 2: 6 个 absorbed duplicate package 物理删除 | `done` | `ls packages/` = 6 keep-set，0 deleted 残留，0 active import |
| S5 | Phase 2: workspace/docs cleanup | `partial` | pnpm-workspace.yaml 自动处理，但 pnpm-lock.yaml stale 块在 closure 时标注需 owner action；实际核查发现 lockfile 已无 stale 块，closure 的 "部分完成" 标注可能过时 |
| S6 | Phase 3 v2: 3 utility library reclassify 为 keep-set | `done` | manifests 与实际一致，README posture freeze 完成 |
| S7 | Phase 4 P4-01: external-seam fixtures 迁 `test/shared/` | `done` | `test/shared/fixtures/external-seams/` 存在，agent-core import path 已更新 |
| S8 | Phase 4 P4-02: root-guardians 迁移 | `done` | 6 个文件在 `test/root-guardians/`；计数偏差见 R3 |
| S9 | Phase 4 P4-03: root scripts 切换 | `done` | `test:contracts` → root-guardians，`test:legacy:*` 已删 |
| S10 | Phase 4 P4-04: R30 cross-e2e 拓扑修 | `done` | live.mjs DEFAULT_URLS 仅 orchestrator-core，6 个 cross-e2e 文件已改为 facade-唯一-entry |
| S11 | Phase 5: test-legacy 物理删除 | `done` | `test-legacy/` 不存在 |
| S12 | Phase 5: docs sync | `done` | INDEX.md、action-plan、closure 同步完成 |
| S13 | Q1 test/root-guardians/ 命名确认 | `done` | 目录名与 owner 决策一致 |
| S14 | Q3 orchestrator-auth-contract keep-set 冻结 | `done` | §14.1 显式标注 |
| S15 | Q4 @haimang/jwt-shared reserved | `done` | ZX5 plan 已引用 |

### ZX4 In-Scope 对齐

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S16 | Phase 0: user-do.ts 4 模块 seam extraction | `done` | 4 文件存在，user-do.ts 正确 import，1950→1659 行 |
| S17 | Phase 1 R28: cancel I/O cross-request 修 | `done` | AbortController + signal 替代 transport.cancel，代码验证通过 |
| S18 | Phase 1 R29: verify body 双轨发散修 | `done` | 删 stateful phase/defaultEvalRecordCount，仅返 deterministic 字段 |
| S19 | Phase 1 P1-03: targeted preview smoke | `partial` | 本地测试全绿，deploy surfaced 2 carryover（R28/R29），ack'd 不阻塞 close |
| S20 | Phase 2: parity log body diff 升级 | `done` | computeBodyDiff + 18 unit test，parity-bridge.test.ts 新文件 |
| S21 | Phase 3 P3-01: migration 006 | `done` | 文件存在且已 apply 到 remote D1 |
| S22 | Phase 3 P3-02: TS union 扩展 | `done` | DurableSessionStatus 6 状态与 SQL CHECK 一致 |
| S23 | Phase 3 P3-03: mintPendingSession | `done` | D1SessionTruthRepository.mintPendingSession() 存在，事务插 2 行 |
| S24 | Phase 3 P3-04: alarm GC | `done` | expireStalePending() + PENDING_TTL_MS 24h 存在 |
| S25 | Phase 3 P3-05: read-model 5 状态合并 | `done` | handleMeSessions() 合并 KV + D1 |
| S26 | Phase 3 P3-06: handleStart 状态机 | `done` | pending→starting, expired/ended 拒 409 |
| S27 | Phase 3 P3-07: ingress guard | `done` | sessionGateMiss() + 11 unit test |
| S28 | Phase 4: permission decision contract | `done` | orchestrator-core→agent-core RPC + NanoSessionDO storage 全栈 land |
| S29 | Phase 5: usage live read | `done` | handleUsage 真读 D1 |
| S30 | Phase 6: elicitation answer contract | `done` | 与 P4 对称，4-段 route + handleElicitationAnswer() |
| S31 | Phase 7: cross-e2e 12/14 + 2 carryover | `done` | 8 pass + 4 skip + 2 carryover ack'd |
| S32 | Phase 8: 7-day observation fast-track | `partial` | 30-session burst 90/90 通过，但未跑满 1000 turns；见 R5 |
| S33 | Phase 9: P3-05 flip + R31 + retired | `done` | fetch fallback 删、non-stream handler 删、transport-profiles.md retired、runbook archive date 标注 |

### 3.1 对齐结论

- **done**: 28
- **partial**: 3（S5 lockfile 标注过时、S19 deploy carryover、S32 fast-track 等价性论证不充分）
- **missing**: 0
- **stale**: 1（S3 R30 defer 列表与实际 land 矛盾）
- **out-of-scope-by-design**: 0

> 整体状态: ZX3+ZX4 的 33 个 in-scope 项中，28 个完全达成、3 个部分达成（均有合理缓解）、1 个文档陈旧、0 个缺失。**这不是"有缺口"状态，而是"有 4 个清理性 follow-up"状态。核心功能目标和收口标准全部达成。**

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | ZX3 [O1] 把 utility 包合并到 nacp-core/nacp-session | `遵守` | v2 reclassification 三包保留为 keep-set，未合并 |
| O2 | ZX3 [O2] 新增 façade 功能 | `遵守` | 无新增 façade endpoint |
| O3 | ZX3 [O3] 重写 worker-matrix 历史 | `遵守` | 仅 archive header + 必要同步 |
| O4 | ZX3 [O4] orchestrator-auth-contract 改造 | `遵守` | 仅 keep-set freeze，未改造 |
| O5 | ZX4 [O1] @haimang/jwt-shared 抽取 | `遵守` | 推迟到 ZX5 Lane C |
| O6 | ZX4 [O2] envelope 三 type 收敛 | `遵守` | 推迟到 ZX5 Lane C |
| O7 | ZX4 [O3] FacadeErrorCode 跨包断言 | `遵守` | 推迟到 ZX5 Lane C |
| O8 | ZX4 [O4] JWT kid rotation 集成测试 | `遵守` | 推迟到 ZX5 Lane C |
| O9 | ZX4 [O5] 客户端 heartbeat/replay | `遵守` | 推迟到 ZX5 Lane C |
| O10 | ZX4 [O6-O7] catalog + 产品 endpoints | `遵守` | 推迟到 ZX5 Lane D |
| O11 | ZX4 [O8] WORKER_VERSION CI 注入 | `遵守` | 推迟到 ZX5 Lane D |
| O12 | ZX4 [O9] DO 提取独立 worker | `遵守` | owner direction 冻结，ZX5 不允许新增 worker |
| O13 | ZX4 [O10] context-core/filesystem-core 真 RPC | `遵守` | 推迟到 ZX5 Lane E |
| O14 | ZX4 [O11] WeChat 真机 smoke | `遵守` | owner-action，无 plan |

**Out-of-scope 守全部合规。** 没有发现任何实现越界到已冻结的 deferred 项。

---

## 5. 跨阶段深度分析

> 本节将审查面积从 ZX3-ZX4 扩大到 ZX1-ZX4 全链路，独立检查盲点、断点、命名规范和执行逻辑。

### 5.1 ZX1-ZX2 设计债务跟踪

在 ZX1-ZX2 GLM 审查中，我提出了 3 项跨包设计债务：

| 债务 | ZX1-ZX2 状态 | ZX3-ZX4 状态 | 判断 |
|------|-------------|-------------|------|
| 3 种 envelope 形状并存 | 已识别，defer ZX4-C | ZX4 未触碰；defer 到 ZX5 Lane C（原 ZX4-C，后 re-baseline）| 仍 deferred，跟踪正确 |
| JWT 验证逻辑 2 worker 重复 | 已识别，defer ZX4-C | ZX4 未触碰；defer 到 ZX5 Lane C，ZX3 预留 jwt-shared keep-set | 仍 deferred，跟踪正确 |
| FacadeErrorCode ⊂ RpcErrorCode 需手工同步 | 已识别，defer ZX4-C | ZX4 未触碰；defer 到 ZX5 Lane C | 仍 deferred，跟踪正确 |

**判断**: 3 项设计债务均正确 deferred。但需注意 ZX4 的 re-baseline 把它们从"ZX4-C"改为"ZX5 Lane C"并加了 R19/R20/R21 显式编号——这个跨阶段跟踪是完整的。

### 5.2 命名规范与一致性检查

| 检查项 | 结果 | 说明 |
|--------|------|------|
| ZX4 seam 模块命名 | 一致 | 全部 kebab-case：parity-bridge.ts / ws-bridge.ts / session-lifecycle.ts / session-read-model.ts |
| ZX4 status enum 命名 | 一致 | TS union `SessionStatus` / `DurableSessionStatus` 与 SQL CHECK 值完全对齐 |
| ZX4 error code 命名 | 一致 | `session-pending-only-start-allowed` / `session-expired` / `session-already-started` 统一 kebab-case |
| ZX4 方法命名 | 一致 | `mintPendingSession` / `expireStalePending` / `readUsageSnapshot` / `readSessionStatus` / `listSessionsForUser` 统一 camelCase |
| ZX4 RPC 方法命名 | 一致 | `permissionDecision` / `elicitationAnswer` 统一 camelCase |
| ZX3 包命名 | 一致 | 6 keep-set 包名与 `@haimang/` / `@nano-agent/` 前缀一致 |
| 跨阶段 transport profile 命名 | 一致 | `internal-http-compat` 从 ZX2 的 `retired-with-rollback` 推进到 ZX4 的 `retired`，文档引用一致 |

### 5.3 执行逻辑断点检查

| 断点 | 状态 | 说明 |
|------|------|------|
| ZX3 Phase 2→3 依赖: duplicate 删除→utility reclassify | 成立 | Phase 2 先删 6 个 duplicate，Phase 3 才 reclassify 3 个 utility，顺序正确 |
| ZX3 Phase 4→5 依赖: test-legacy cutover→物理删除 | 成立 | P4 迁移+切换完成后 P5 才删 test-legacy/，顺序正确 |
| ZX4 Phase 0→1 依赖: seam extraction→R28/R29 修 | 成立 | user-do.ts 拆分后才修 R28/R29，减少风险，正确 |
| ZX4 Phase 3→4 依赖: D1 pending truth→permission round-trip | 成立 | 无 pending session 则无法测 permission deny → 409，正确 |
| ZX4 Phase 8→9 依赖: 观察完成→P3-05 flip | 部分偏离 | Owner fast-track 等价论证不够充分，见 R5 |
| ZX3→ZX4 包围界: R30 cross-e2e 拓扑修 | 在 ZX3 land 而 ZX3 closure §16.7 仍 defer 到 ZX4 | 见 R7，文档陈旧 |
| ZX4 P4/P6→ZX5 Lane E: permission/elicitation contract→runtime hook | contract 已 land 但 await-resume 未做 | 见 R9，需 ZX5 显式 handoff |

### 5.4 盲点检查

| 盲点 | 说明 | 严重级别 | 建议 |
|------|------|----------|------|
| handleStart idempotency | P3-06 `UPDATE ... WHERE status='pending'` 无幂等键，重试可能竞态 | medium | 追踪到 ZX5 |
| P8 fast-track 等价性 | 30-session burst ≠ 7-day ≥ 1000 turns 的长尾覆盖 | medium | Closure 标注 "功能验证等价而非性能/边界等价" |
| stale comment | user-do.ts:948 仍写 fallback | medium | 修正注释 |
| dead import | jsonDeepEqual / logParityFailure 未调用 | low | 删除 |
| key-package import 计数 | 37 vs 6 口径差异未标注 | low | 备注口径 |
| ZX5 Lane E handoff | P4/P6 contract 清单未显式 handoff | medium | 追加 handoff 描述 |

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: ZX3+ZX4 两阶段的 action-plan / closure claim / 实际代码三方高度一致。核心目标（ZX3 组件退役 + test-legacy cutover、ZX4 transport 真收口 + session 语义闭环）全部达成。9 项 finding 中 0 项 critical、0 项 blocker；3 项 medium（stale comment、P8 fast-track 等价性论证、handleStart idempotency）均为文档/跟踪层面，不影响功能正确性。
- **是否允许关闭本轮 review**: `yes`
- **关闭前必须完成的 blocker**: 无
- **可以后续跟进的 non-blocking follow-up**:
  1. 修正 `user-do.ts` line 948 stale comment（P9 post-flip 描述）
  2. 删除 `user-do.ts` 中 `jsonDeepEqual` 和 `logParityFailure` 两个 dead import
  3. ZX3 closure §1.4 root-guardians 计数从"5 个"修正为"5 个 contract guardian + 1 个 meta-guardian = 6 个文件"
  4. ZX3 closure §14.1 备注包 import 计数口径（37 vs 6 的差异来源）
  5. ZX4 closure §4 追加 P8 fast-track 功能等价性注释（不等价于性能/边界/长尾验证）
  6. ZX3 closure §16.7 R30 行标注"已在 ZX3 P4-04 land，不再 defer 到 ZX4"
  7. ZX5 plan Lane E 开头追加 P4/P6 已 land contract 端点清单 + 需补的 kernel 等待改造清单
  8. R28 deploy 500 根因分析跟踪到 ZX5（当前归为 verification harness only 可能过于乐观）
  9. handleStart idempotency（pending session 重试竞态）跟踪到 ZX5 Lane A/B
- **建议的二次审查方式**: `no rereview needed` — 本轮 all findings 为 non-blocking docs/cleanup 跟进项，无需二次审查。如 ZX5 执行 P4/P6 kernel hookup，建议在 ZX5 Phase 0 审查 session hook await-resume 的 contract 对齐。

> **ZX3+ZX4 核心目标达成，允许收口。9 项 non-blocking follow-up 建议在 ZX5 启动前或启动时处理。**