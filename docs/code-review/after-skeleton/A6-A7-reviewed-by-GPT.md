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
