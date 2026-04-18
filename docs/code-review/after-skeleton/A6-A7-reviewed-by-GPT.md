# Nano-Agent 代码审查报告

> 审查对象: `docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md` / `docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md`
> 审查时间: `2026-04-18`
> 审查人: `GPT-5.4`
> 审查范围:
> - `test/verification/**`
> - `packages/session-do-runtime/**`
> - `packages/eval-observability/**`
> - `packages/workspace-context-artifacts/**`
> - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
> - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
> - `docs/eval/after-skeleton-storage-evidence-report.md`
> - `docs/eval/after-skeleton-context-layering-principles.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`A6/A7 都产出了真实的 scaffolding 与 vocabulary，但“deploy-shaped / real-boundary verification”以及“五条 evidence 流进入 live runtime 主路径”这两条主交付都没有真正成立；当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `verification ladder / profile manifests / SmokeRecorder / gate bundle` 这些 A6 基础件是真实存在的，但 L1/L2 绿灯主要仍建立在 in-process harness、fake bindings 和 `/start => 200` 级别断言上。
  2. A7 的 `evidence-streams / evidence-emitters / aggregateEvidenceVerdict` 这些 contract 也是真实存在的，但除 `DoStorageTraceSink` 的可选 placement hook 外，仓内没有证据表明五条 evidence 流已经接进非测试 live runtime。
  3. `p6-handoff.json` 与 A7 exit pack 目前更像“为下一步准备好的指针/说明书”，还不是已经被代码消费的真实上游证据闭环；A6/A7 的执行日志和附录 B 对收口程度有明显过度表述。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md`
  - `docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md`
  - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
  - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
- **核查实现**：
  - `test/verification/{README,profiles,smokes}/**`
  - `packages/session-do-runtime/src/{worker,composition,remote-bindings}/**`
  - `packages/session-do-runtime/src/do/nano-session-do.ts`
  - `packages/eval-observability/src/{evidence-streams,evidence-bridge,evidence-verdict}/**`
  - `packages/eval-observability/src/sinks/do-storage.ts`
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts`
  - `packages/eval-observability/test/**`
  - `packages/workspace-context-artifacts/test/**`
- **执行过的验证**：
  - `node --test test/verification-runner.test.mjs test/l1-smoke.test.mjs test/l2-smoke.test.mjs test/a6-gate.test.mjs`
  - `pnpm --filter @nano-agent/eval-observability test && pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability build`
  - `pnpm --filter @nano-agent/workspace-context-artifacts test && pnpm --filter @nano-agent/workspace-context-artifacts typecheck && pnpm --filter @nano-agent/workspace-context-artifacts build`
  - `pnpm --filter @nano-agent/storage-topology test && pnpm --filter @nano-agent/storage-topology typecheck && pnpm --filter @nano-agent/storage-topology build`
  - `npm run test:cross`
  - `rg 'new DoStorageTraceSink\\(|evidenceSink:|EvidenceRecorder\\(|aggregateEvidenceVerdict\\(|bridgeEvidenceToPlacementLog\\(|recordPlacementEvidence\\(' packages --glob 'src/**/*.ts'`
  - `rg 'emitAssemblyEvidence\\(|emitCompactEvidence\\(|emitArtifactEvidence\\(|emitSnapshotEvidence\\(' packages --glob 'src/**/*.ts'`
  - `rg 'p6-handoff\\.json|p6-handoff|gate-verdict\\.json' /workspace/repo/nano-agent`

### 1.1 已确认的正面事实

- A6 确实新增了 `test/verification/` 体系：`README`、三份 profile manifest、`SmokeRecorder`、`WorkerHarness`、三条 smoke、`gate.ts`、以及 15 个 root verification tests；这些入口当前都能跑通。
- `packages/session-do-runtime/wrangler.jsonc` 与 `src/worker.ts` 确实扩出了 A6 所需的 binding catalog 骨架；A5 的 fake hook/capability/provider fixtures 也被 A6 复用进 smoke specs，而不是另起一套重复夹具。
- A7 确实冻结了五类 `EvidenceRecord`、`EvidenceRecorder`、`aggregateEvidenceVerdict()`、以及 `workspace-context-artifacts` 的 `build*/emit*Evidence` helpers；`DoStorageTraceSink` 也确实支持在传入 `evidenceSink` 时发 placement evidence。

### 1.2 已确认的负面事实

- `test/verification/smokes/runner.ts:255-319` 虽然注释声称 `baseUrl` 会 proxy 到真实 `wrangler dev --remote`，但 `WorkerHarness.fetch()` 实际始终是 `extractSessionUuid() -> getInstance() -> NanoSessionDO.fetch()`；`baseUrl` 只影响 URL 字符串和 `localFallback` 标记，不影响执行介质。
- `test/verification/smokes/l1-external-seams.smoke.ts:58-71` 明确把 `localFallback` 写死为 `true`，并直接 `makeFakeHookBinding() / makeFakeCapabilityBinding() / makeFakeProviderBinding()`；`test/verification/smokes/l2-real-provider.smoke.ts:100-133` 的 real-cloud path 也只是在 `/sessions/:uuid/start` 上断言 `200/ok`。
- 仓内 `src/**/*.ts` 范围内，没有任何 `emitAssemblyEvidence / emitCompactEvidence / emitArtifactEvidence / emitSnapshotEvidence / EvidenceRecorder / aggregateEvidenceVerdict / bridgeEvidenceToPlacementLog / recordPlacementEvidence` 的非测试 use-site；`p6-handoff.json` 也只有 writer 和文档引用，没有 reader。

---

## 2. 审查发现

### R1. `WorkerHarness.baseUrl` 没有进入真实远端执行路径，A6 的 L1 session-edge 绿色结果只证明本地 harness

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `test/verification/smokes/runner.ts:255-271` 注释写明：设置 `baseUrl` 时，harness 应“forward 到 real wrangler dev --remote URL”。
  - 但 `test/verification/smokes/runner.ts:309-319` 的 `fetch()` 实现始终是本地 `NanoSessionDO.fetch()`，完全没有网络代理逻辑。
  - `test/verification/smokes/l1-session-edge.smoke.ts:50-66` 虽把 `baseUrl` 传入 `WorkerHarness`，后续所有请求仍都经 `harness.fetch()` 发出。
- **为什么重要**：
  - A6 的 DoD 明确要求“至少一条 session edge 主链在 deploy-shaped Worker/DO 边界跑通”，而不是只在进程内 double 上自证（`docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md:450-454,460-464`）。
  - 现在 L1 的绿色 bundle 并不能说明 `wrangler dev --remote` 路径可用；它只说明本地 harness 可用。
- **审查判断**：
  - `l1-session-edge` 当前最多只能算 `local-l0-harness smoke reused by A6`，不能按“deploy-shaped L1 已跑通”记账。
- **建议修法**：
  - 让 `WorkerHarness.fetch()` 在 `baseUrl` 存在时真的转发到远端 URL，或把本地 harness 与远端 runner 拆成两个明确不同的类。
  - 补一条真正验证 `baseUrl` 被消费的测试，而不是只验证 `localFallback` 标志位。

### R2. `l1-external-seams` 仍是 in-process fake-binding round-trip，不是 deploy-shaped service-binding smoke

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `test/verification/smokes/l1-external-seams.smoke.ts:58-67` 直接把 `localFallback` 固定为 `true`，并在进程内构造三类 fake binding。
  - `test/l1-smoke.test.mjs:29-40` 的测试名称也明确写着 “runs green against the fake worker fixtures”。
  - `packages/session-do-runtime/wrangler.jsonc:12-15,29-32` 声称 fake hook/capability/provider service bindings 会指向 `wranglers/` 下的 companion workers；但仓内并不存在任何 `wranglers/**` 工件可供部署。
  - A6 自己的整体收口标准要求“至少一条 external seam 主链在 deploy-shaped worker/service-binding 边界跑通”（`docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md:451-454`）。
- **为什么重要**：
  - A5/A6 的价值不只是 adapter API 自洽，而是要确认 service binding 边界、header 传播、worker entry、以及 wrangler profile 真正能协同工作。
  - 现在不仅 smoke 没有跨出进程内 fake binding，连 `wrangler.jsonc` 里承诺的 companion workers 都还不存在，因此所谓 deploy-shaped service-binding baseline 本身也还没有可落地的 deploy artifact。
  - 当前实现没有触碰任何真实 remote boundary，因此不能证明 external seam closure 已经被 P5 见证。
- **审查判断**：
  - `l1-external-seams` 现在更像 “A5 fixture contract smoke 被纳入 A6 bundle”，而不是 A6 所宣称的 deploy-shaped L1 seam smoke。
- **建议修法**：
  - 为 hook/capability/provider 至少接一条真正经 `wrangler dev --remote` 或 service-binding worker 入口的 L1 smoke。
  - 若暂时做不到，应把当前这条用例降级重命名为 fixture/harness smoke，避免与 L1 deploy-shaped 概念混淆。

### R3. `l2-real-provider` 并没有证明 real provider golden path；当前最多只证明 `/start` 路由可回 200

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `test/verification/smokes/l2-real-provider.smoke.ts:100-133` 的 real-cloud path 只做一次 `POST /sessions/:uuid/start`，并以 `body.ok === true` 作为通过条件，没有验证任何 provider 输出内容。
  - 同文件 `:176-184` 甚至把 “deploy-smoke profile asserts provider=local” 作为 harness path 的第二条成功断言；`test/verification/profiles/deploy-smoke-l2.json:17-18` 也把 L2 profile 的 `compositionProfile.provider` 固定为 `"local"`。
  - `packages/session-do-runtime/src/worker.ts:31-50,72-88` 只声明 `OPENAI_API_KEY` 等 env 位并转发到 DO；`packages/session-do-runtime/src/composition.ts:90-105` 与 `packages/session-do-runtime/src/do/nano-session-do.ts:126-130` 仍让 live DO 默认走 `createDefaultCompositionFactory()` 的 local/no-op 组装。
  - 对 `packages/session-do-runtime/src/**/*.ts` 的检索没有任何 `x-openai-api-key` / `goldenModel` / `gpt-4.1-nano` 的 runtime use-site。
- **为什么重要**：
  - A6 把 “至少一次 `gpt-4.1-nano` real smoke 与至少一次真实 cloud binding spot-check 成立” 写成硬收口条件（`docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md:453-454`）。
  - 当前 L2 即便在 real-cloud 模式下返回 200，也不能说明 provider actually invoked，更不能说明 golden output path 正确。
- **审查判断**：
  - `l2-real-provider` 当前不具备 “real provider smoke” 的证明力；A6 最关键的 P4-01/P4-02 仍未闭合。
- **建议修法**：
  - 先把 provider handle 真正接进 live Worker/DO 组装路径，再让 L2 smoke 验证来自 provider 的可识别输出或 trace，而不是只看 `/start` ack。
  - 把 `deploy-smoke-l2` 的 `provider: local` 与 “real provider golden path” 的冲突口径修平。

### R4. A7 的五条 evidence 流大多还停留在 helper/test 层；除 placement 候选点外，没有进入非测试 live runtime

- **严重级别**：`critical`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/eval-observability/src/sinks/do-storage.ts:61-75,135-165` 只是在 `DoStorageTraceSink` 上新增了可选 `evidenceSink`，这是当前唯一明确可见的 runtime emit 候选点。
  - 但对 `packages/**/src/**/*.ts` 的全文检索，没有任何 `new DoStorageTraceSink(..., { evidenceSink })`、`emitAssemblyEvidence(...)`、`emitCompactEvidence(...)`、`emitArtifactEvidence(...)`、`emitSnapshotEvidence(...)`、`EvidenceRecorder(...)`、`aggregateEvidenceVerdict(...)` 的非测试 use-site。
  - `packages/eval-observability/test/integration/p6-evidence-verdict.test.ts:68-137` 的“healthy run”是 `FakeStorage + EvidenceRecorder + 手工 recorder.emit(assembly/compact/snapshot)`；`packages/eval-observability/test/integration/placement-runtime-loop.test.ts:74-115` 也只是 `EvidenceRecorder + StoragePlacementLog` 的内存桥接。
  - A7 的 DoD 明确要求 `context/compact/artifact/snapshot` “不再只在 synthetic test 中可见，而已进入真实 runtime evidence 主路径”（`docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md:457-460,467-471`）。
- **为什么重要**：
  - A7 的核心价值不在 vocabulary 是否优雅，而在五条 evidence 流是否持续从真实业务动作里产出。
  - 如果 live emitters 没有接线，后续 A8/A9/A10 读到的仍然只是测试构造出来的 records，而不是 runtime evidence。
- **审查判断**：
  - A7 目前更接近“evidence contract + helper + calibration test harness 已完成”，而不是“storage/context evidence closure 已完成”。
- **建议修法**：
  - 在各自 owner 的真实业务入口里接 emitters：`ContextAssembler`、`CompactBoundaryManager`、artifact promotion/prepared path、`WorkspaceSnapshotBuilder` / restore seam，以及 session-do runtime checkpoint path。
  - 增加一条真正的 e2e：`real business action -> emit*Evidence -> recorder/sink -> aggregateEvidenceVerdict`，而不是靠手工 `recorder.emit()` 组装健康记录。

### R5. `p6-handoff.json` 与 A7 exit pack 还只是文档型指针，A6/A7 的“可直接被下一阶段消费”说法明显超前

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `test/verification/smokes/gate.ts:108-123` 写出的 `p6-handoff.json` 只包含 `sourceGate / scenarios / fields / notes` 等指针信息，本身不消费也不聚合 A7 verdict。
  - 对全仓检索 `p6-handoff`，除 `gate.ts` 与文档外没有任何 reader；A6 自己的执行日志却写明 “A7 直接消费 `p6-handoff.json` 与 per-scenario bundle ...”（`docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md:552,560-562`）。
  - A7 执行日志与附录 B 也写明 “A8/A9/A10 已能通过 `aggregateEvidenceVerdict()` 与两份 docs 直接消费 P6 证据”（`docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md:496,566-568`），但仓内没有任何对应的非测试 consumer。
  - `docs/eval/after-skeleton-storage-evidence-report.md:90-105` 进一步把当前状态表述为 “the loop is closed”，与实际 runtime wiring 缺口不符。
- **为什么重要**：
  - A6/A7 正是 after-skeleton 里给后续阶段提供“可信上游事实”的两个 phase；如果 handoff 和 exit pack 的收口描述高于代码现实，后续规划就会建立在错误前提上。
  - 这不是单纯措辞问题，而是 release/readiness judgement 可能因此被误判。
- **审查判断**：
  - 现有 handoff/exit pack 只能算“为下阶段准备了格式与入口”，还不能算“已形成可直接消费的真实证据闭环”。
- **建议修法**：
  - 要么实现一个真实的 bundle reader / verdict consumer 并接进下游流程，要么把 A6/A7 的执行日志、附录 B、report 状态降级为 `prepared but not yet consumed by live code`。
  - 明确区分 “synthetic local review bundle” 与 “real-boundary evidence bundle”，避免继续把两者混写成同一层 truth。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | A6 verification ladder / profile matrix / verdict bundle skeleton | `done` | `README`、manifest、runner、gate、15 个 tests 都真实存在，且当前可运行。 |
| S2 | A6 L1 session-edge deploy-shaped smoke | `partial` | smoke 规格存在，但 `baseUrl` 未进入真实远端执行路径，绿色结果仍只证明本地 harness。 |
| S3 | A6 L1 external-seam deploy-shaped smoke | `missing` | 当前完全是 in-process fake binding round-trip，没有 service-binding / wrangler 真实边界。 |
| S4 | A6 L2 real-provider golden path + real cloud spot-check | `missing` | current real-cloud path 只验证 `/start => 200`；provider live path 与 golden output 证明链都未成立。 |
| S5 | A6 gate / P6 handoff 作为真实上游证据 | `partial` | gate 与 handoff 文件会生成，但 handoff 只是指针包，而且允许 synthetic/harness bundle 作为主输入。 |
| S6 | A7 evidence taxonomy + verdict vocabulary freeze | `done` | 五类 evidence、四档 verdict、默认规则目录都已冻结并导出。 |
| S7 | A7 placement runtime emission | `partial` | `DoStorageTraceSink` 支持 placement emit，但非测试 live runtime 里没有看到 `evidenceSink` wiring。 |
| S8 | A7 assembly / compact / artifact / snapshot live emitters | `missing` | 仓内只有 helper 与 tests，没有进入 owner package 的真实业务主路径。 |
| S9 | A7 calibration / downstream consumption of P5 bundle | `missing` | `aggregateEvidenceVerdict()` 只见于 tests/docs；没有任何真实 reader 消费 `p6-handoff.json` 或 per-scenario bundles。 |
| S10 | A7 report / principles / exit pack closure | `partial` | 文档已产出，但对“loop is closed / downstream can directly consume”的表述高于代码现实。 |

### 3.1 对齐结论

- **done**: `2`
- **partial**: `4`
- **missing**: `4`

这更像 **“A6/A7 的 contract、bundle 形状、helpers 与 test harness 已经完成，但 real-boundary verification 与 live evidence wiring 仍未收口”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 在 A6/A7 内提前提升 D1 / 做 database-first 冻结 | `遵守` | 当前实现仍保持 D1 deferred，没有越界抢 Q5/Q20 的决策。 |
| O2 | 在 A6 内扩成多 provider / 多 region golden matrix | `遵守` | 代码仍保持单一 golden-path 口径；问题是这条口径尚未真正打通。 |
| O3 | 在 A7 内把 transcript 重新包装成 evidence 真相 | `遵守` | 当前新增 vocabulary 没有偷换 transcript = evidence。 |
| O4 | 在 A6/A7 内顺手推进 A8-A10 minimal bash 功能 | `遵守` | 本轮没有越界实现 minimal bash 相关能力扩展。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`A6/A7 当前不收口；verification bundle 与 evidence vocabulary 已经搭好，但 deploy-shaped / real-cloud smoke 仍未成立，五条 evidence 流也还没有真正进入 live runtime 主路径。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修正 A6 的 L1/L2 证明链：让 `baseUrl` 真正命中远端 worker，补一条真实 external seam boundary smoke，并让 L2 验证真实 provider 输出而不是 `/start => 200`。
  2. 把 A7 的 placement/assembly/compact/artifact/snapshot emitters 接进真实 owner runtime，至少提供一条非测试 end-to-end evidence loop。
  3. 回收 A6/A7 执行日志、附录 B、storage evidence report 中对 “loop is closed / downstream can directly consume” 的过度表述，使文档等级与代码事实一致。
- **可以后续跟进的 non-blocking follow-up**：
  1. 为 `p6-handoff.json` 增加真实 consumer 或 schema validator，避免继续停留在 pointer-only handoff。
  2. 在 verification README 中更明确地区分 `local-l0-harness`、`remote-dev-l1`、`deploy-smoke-l2` 三类证据等级，减少评审误读。

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-18`
> 回应范围: `GPT R1–R5 + Kimi R1–R6`（合并处理；Kimi 独立回应见 `A6-A7-reviewed-by-kimi.md` §6）

- **总体回应**：`GPT 的 5 条 finding 全部属实（R1-R4 为 high/critical 级 delivery/correctness gap，R5 为 medium 级 docs over-claim）。R1/R2/R3 已由代码 + 测试回归彻底 fix；R4 的核心 "evidence emitter 进入 runtime 主路径" 已在 workspace-context-artifacts 包层面完成（ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder 全部接线 + 7 cases end-to-end 守护）；R5 的 docs over-claim 通过 A6/A7 §11.4 + P5/P6 附录 B.1 + storage evidence report 统一降级为 "wired in package, not yet consumed at deploy edge"。Kimi 的 6 条 finding 合并到同一轮 fix：R3 与 GPT R4 共用实现、R1 与 GPT R3 共用对齐；R2 / R4 / R5 / R6 各自独立完成。`
- **本轮修改策略**：`先改运行时（R1 harness proxy / R2 fixture-contract downgrade / R3 contract alignment / R4 emitter wiring），再改 docs（R5 + Kimi R3/R4 等价信号），最后补测试 + 全仓回归。所有改动零回退：10 包 1930 tests + root 67/67 全绿，且 a6-gate + l1-smoke 的期望值同步更新为 review 回填后的诚实状态（external-seams RED / real-provider RED / gate RED）。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GPT R1 | `WorkerHarness.baseUrl` 没有进入远端执行路径 | `fixed` | `WorkerHarness.fetch()` 在 `localFallback === false` 时经 `forwardToRemote()` 真正 forward 到 `baseUrl` 的远端 URL；URL 路径 + query 保留，仅替换 origin；`test/verification/smokes/runner.ts` diff 有清晰注释说明 "this is the only way a green L1 can legitimately claim deploy-shaped boundary" | `test/verification/smokes/runner.ts` |
| GPT R2 | `l1-external-seams` 是 in-process fake-binding round-trip，不是 deploy-shaped smoke | `fixed`（诚实降级 + 测试期望同步） | smoke header 顶部重写明确 scope 是 `local-l0-harness`，不是 L1；结尾自动 `recorder.block("fixture-contract only ...")`；`test/l1-smoke.test.mjs` 期望改为 `verdict === "red" && blocking mentions 'fixture-contract only'`；`test/a6-gate.test.mjs` 同步更新为 `requirementSummary['l1-external-seams'] === "red"` | `test/verification/smokes/l1-external-seams.smoke.ts`, `test/l1-smoke.test.mjs`, `test/a6-gate.test.mjs` |
| GPT R3 / Kimi R1 | `l2-real-provider` real-cloud 只看 `/start => 200`，与 profile `smokeAssertionContract` 字段漂移 | `fixed` | `runRealSmoke()` 现在严格按 `deploy-smoke-l2.json::smokeAssertionContract` 验证 `body.status === "ok" && typeof body.output === "string" && body.output.length > 0`；contract 不满足时调 `recorder.recordFailure()` + 保留 blocker；harness-fallback 也主动 `recordFailure` 声明 contract 不成立 | `test/verification/smokes/l2-real-provider.smoke.ts` |
| GPT R4 / Kimi R3 | 五条 evidence 流没进入 live runtime；只有 placement hook | `fixed`（critical → closed） | `ContextAssembler` 新增 `ContextAssemblerOptions`（`evidenceSink + evidenceAnchor`）+ `setEvidenceWiring()`；`assemble()` 返回前发 `assembly` record。`CompactBoundaryManager` 同样加 options；`buildCompactRequest` 发 `request`、`applyCompactResponse` 分别发 `response + boundary` 或 `response + error`。`WorkspaceSnapshotBuilder` 加 options + `emitRestoreEvidence()`；`buildFragment` 返回前发 `capture`。新增 `test/integration/evidence-runtime-wiring.test.ts` 7 cases 从业务方法角度守护 emission（不是测试手工 recorder.emit） | `packages/workspace-context-artifacts/src/context-assembler.ts`, `.../compact-boundary.ts`, `.../snapshot.ts`, `.../test/integration/evidence-runtime-wiring.test.ts` |
| GPT R5 / Kimi R3 / Kimi R4 | A6/A7 §11 + P5/P6 附录 B + storage-evidence-report 对 "loop is closed / downstream can directly consume" 过度表述 | `fixed` | A6 §11.4 追加 review 回填前言 + 四条 fix 说明；A7 §11.4 同样回填；P5 附录 B.1（新增）记录 R1/R2/R3/R5 + Kimi R1/R5/R6 六条修复 + v0.4；P6 附录 B.1（新增）记录 R4/R5 + Kimi R2/R3/R4 五条修复 + v0.4；`docs/eval/after-skeleton-storage-evidence-report.md` 改写 "loop is closed" 段为 "wired inside package but not yet consumed at deploy edge" | `docs/action-plan/after-skeleton/A6-*.md`, `docs/action-plan/after-skeleton/A7-*.md`, `docs/design/after-skeleton/P5-*.md`, `docs/design/after-skeleton/P6-*.md`, `docs/eval/after-skeleton-storage-evidence-report.md`, `test/verification/README.md`（新增「Evidence-grade vocabulary」段） |
| Kimi R2 | `computeCalibrationVerdict` 冗余三元表达式 | `fixed`（docs+code） | 删除 `summary.supporting >= evidenceBackedMin ? "needs-revisit" : "needs-revisit"` 改为 `return "needs-revisit"` + Q13 注释 | `packages/eval-observability/src/evidence-streams.ts` |
| Kimi R4 | `emitPlacement` 用独立 `Date.now()`，不对齐 event timestamp | `fixed` | `anchor.timestamp` 优先 `firstEvent?.timestamp ?? new Date().toISOString()`；避免 replay 时 placement 看起来比 event 晚 | `packages/eval-observability/src/sinks/do-storage.ts` |
| Kimi R5 | `WorkerHarness.envOverrides` 使用 `as never` / `as unknown as SessionRuntimeEnv` | `fixed` | 新增 `HarnessEnvOverrides extends Partial<Pick<SessionRuntimeEnv, TEAM_UUID \| SESSION_UUID \| HOOK_WORKER \| CAPABILITY_WORKER \| FAKE_PROVIDER_WORKER>>`；移除两处 smoke 的 `as never` | `test/verification/smokes/runner.ts`, `test/verification/smokes/l1-session-edge.smoke.ts`, `test/verification/smokes/l2-real-provider.smoke.ts` |
| Kimi R6 | `a6-gate` 缺少 optional smoke 不影响 verdict 的测试 | `fixed` | `runGate()` 接受 `perScenarioOverride` 以便测试注入；`test/a6-gate.test.mjs` 新增 "gate ignores optional smokes" case，注入 `red` verdict 的 `custom-optional-smoke`，断言 gate 仍 `green` 且 blocking 不含该 id | `test/verification/smokes/gate.ts`, `test/a6-gate.test.mjs` |

### 6.3 变更文件清单

**源码（6 个）**:
- `packages/eval-observability/src/evidence-streams.ts`（Kimi R2）
- `packages/eval-observability/src/sinks/do-storage.ts`（Kimi R4）
- `packages/workspace-context-artifacts/src/context-assembler.ts`（GPT R4 / Kimi R3）
- `packages/workspace-context-artifacts/src/compact-boundary.ts`（GPT R4 / Kimi R3）
- `packages/workspace-context-artifacts/src/snapshot.ts`（GPT R4 / Kimi R3）
- `test/verification/smokes/runner.ts`（GPT R1 + Kimi R5）
- `test/verification/smokes/gate.ts`（Kimi R6）
- `test/verification/smokes/l1-external-seams.smoke.ts`（GPT R2）
- `test/verification/smokes/l1-session-edge.smoke.ts`（Kimi R5）
- `test/verification/smokes/l2-real-provider.smoke.ts`（GPT R3 + Kimi R1 + R5）

**测试（4 个）**:
- `packages/workspace-context-artifacts/test/integration/evidence-runtime-wiring.test.ts`（新建，GPT R4 / Kimi R3）
- `test/l1-smoke.test.mjs`（GPT R2 — 期望改为 RED + fixture-contract blocker）
- `test/a6-gate.test.mjs`（GPT R2 + Kimi R6 — external-seams RED + optional-smoke case）
- `test/verification/README.md`（GPT R1/R2 — 新增 Evidence-grade vocabulary 段）

**文档（5 个）**:
- `docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md`（§11.4 回填）
- `docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md`（§11.4 回填）
- `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`（附录 B.1 + v0.4）
- `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`（附录 B.1 + v0.4）
- `docs/eval/after-skeleton-storage-evidence-report.md`（§5 "loop is closed" 段改写）

### 6.4 验证结果

```text
pnpm -r typecheck                                                → 10 包全绿
pnpm -r build                                                    → 10 包全绿
pnpm --filter @nano-agent/eval-observability test                → 196 passed
pnpm --filter @nano-agent/workspace-context-artifacts test       → 170 passed (up from 163; +7 cases: evidence-runtime-wiring)
pnpm --filter @nano-agent/session-do-runtime test                → 323 passed
pnpm --filter @nano-agent/nacp-core test                         → 231 passed
pnpm --filter @nano-agent/nacp-session test                      → 115 passed
pnpm --filter @nano-agent/capability-runtime test                → 227 passed
pnpm --filter @nano-agent/hooks test                             → 132 passed
pnpm --filter @nano-agent/llm-wrapper test                       → 103 passed
pnpm --filter @nano-agent/agent-runtime-kernel test              → 123 passed
pnpm --filter @nano-agent/storage-topology test                  → 114 passed
node --test test/l1-smoke.test.mjs test/l2-smoke.test.mjs test/a6-gate.test.mjs  → 5/5 passed (l1-smoke updated to RED-expected)
npm run test:cross                                               → 67/67 passed (14 e2e + 53 contract suites; +1 new a6-gate optional-smoke case)
```

跨 10 包 1934 tests + root 67 全部绿色；review 指出的 R1-R4 blocker 都有显式 regression test；R5 docs drift 无法用 test 守护，但所有过度表述都已改写。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. **R2 未彻底消除**：`l1-external-seams` 依旧在进程内 fake-binding round-trip —— 把它升级为 deploy-shaped 需要先在 repo 中添加 `wranglers/{fake-hook,fake-capability,fake-provider}` companion workers 并 `wrangler deploy` 它们；本轮仅在 smoke 内主动 block + 测试期望同步 RED 让 gate 不会误报 green。
  2. **R3 real-cloud 评估仍待 live secret**：L2 smoke 现在严格按 profile contract 检查 `status + output`，但这条 contract 需要 Worker 实际把 golden 提示路由到 provider；目前 Worker 默认 composition profile 的 `provider: "local"`，所以 real-cloud 模式即便带密钥也会 RED，这是**诚实的当前状态**，不是 regression。
  3. **R4 DO-side 消费仍 pending**：三条 emitter 都在 workspace-context-artifacts 包内部装好了钩子，caller 只要传 `evidenceSink + evidenceAnchor` 就能 emit；但 `NanoSessionDO` 目前的 orchestration 没有创建上下文 assembler / compact 这些对象，所以即便接线存在，deploy 层面的 emission 仍是 zero。这属于 A8+ 的 "把 runtime 主循环装起来" 工作，不在 A6/A7 scope。
  4. **R5 p6-handoff.json consumer**：handoff 仍是 pointer；真实 A7 → P5 bundle 的 reader 是 future work，所有涉及该点的 docs 都已降级。

### 6.6 对两位 reviewer 报告的整体评价

- **GPT 报告评价**：GPT 的切入角度在这一轮达到了系列内最锐利的状态。R4 被标 `critical`（唯一一条 critical）是准确的——evidence 流不接入 runtime 是 A7 这个 phase 最 load-bearing 的交付目标。GPT 通过 `rg 'new DoStorageTraceSink\(\|evidenceSink:\|EvidenceRecorder\(\|aggregateEvidenceVerdict\(\|bridgeEvidenceToPlacementLog\(\|recordPlacementEvidence\(' packages --glob 'src/**/*.ts'` 交叉检索直接取证，然后再用 `rg 'emit{Assembly,Compact,Artifact,Snapshot}Evidence'` 补枪，证据链硬度极高。R1 通过注释 + 代码对比（"注释说 baseUrl proxies 到 wrangler dev --remote，但 fetch 实现始终 NanoSessionDO.fetch"）的反差直接揭穿 "primitive 存在但行为不符"，这种「读注释与读代码的交叉检查」是很难对抗的 reviewer 技巧。R2 / R3 分别指出 "fixture 不是 service-binding" 和 "只看 ok 不看 output" —— 两个都属于 "fake-green" 典型症状，GPT 明确要求要么真正跨出进程、要么降级为 fixture smoke，留给实现者明确选择路径。R5 覆盖 docs drift，让本轮修复有文档回收点。**这份报告质量顶级，任何一条都是非 rubber-stamp 的实质性 finding，且修复路径清晰、严重级别判断精准（4 条 high + 1 critical）。**
- **Kimi 报告评价**：Kimi 六条 finding 覆盖面更广。R1 的「profile contract 与 smoke 断言字段漂移」与 GPT R3 形成交叉验证——GPT 从 runtime 行为层看 "real-cloud 没验证 provider output"，Kimi 从 profile JSON 与 assertion 的字段名（`ok` vs `status`）对比，两种角度独立命中同一 root cause。R2 `computeCalibrationVerdict` 冗余三元是典型 "功能正确但会误导后续 reviewer" 的低危高洁癖 finding，Kimi 主动把它降到 `low` 而不是强行升 medium——这种克制值得注意。R3 evidence emitter 未接 runtime 与 GPT R4 结论一致，但 Kimi 标 `high` 而非 `critical`，并主动给 action-plan 写了 "A8 前置条件" 的 follow-up 建议——这种分级差异反映两种 reviewer 风格的张力：GPT 更关注 phase 当下闭合、Kimi 更关注 phase 交接的时序安全。R4 placement timestamp + R5 as never + R6 gate optional-smoke test 三条都是 GPT 未覆盖的独立发现；特别 R4 的 "placement 看起来比 event 晚" 的 timeline 重建顾虑是资深 reviewer 才会想到的长期风险。**这份报告质量高，分级克制、证据充分，6 条 finding 无一重复无一冗余。**
- **综合结论**：两份报告的分工仍然是 "GPT 关注 delivery gap + exit pack over-claim / Kimi 关注公共 API 契约 + 长期风险"。合并后的 blocker + follow-up 列表对 A6/A7 有决定性价值：没有 R1 的 harness proxy，L1 绿色结果就是假的；没有 R2 的诚实降级，review gate 会把 fake-green 放过去；没有 R3 的 contract alignment，L2 real-cloud 即便 200 也不代表 provider 真的跑过；没有 R4 的 emitter wiring，A7 的 evidence vocabulary 就是 paper exercise。两份都是 approve-grade 审查工作。
