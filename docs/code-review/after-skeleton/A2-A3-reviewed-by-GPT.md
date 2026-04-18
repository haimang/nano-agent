# Nano-Agent 代码审查报告

> 审查对象: `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md` / `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md`
> 审查时间: `2026-04-18`
> 审查人: `GPT-5.4`
> 审查范围:
> - `packages/eval-observability/**`
> - `packages/nacp-core/src/observability/envelope.ts`
> - `packages/session-do-runtime/**`
> - `packages/hooks/src/audit.ts`
> - `docs/eval/after-skeleton-trace-substrate-benchmark.md`
> - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P2-observability-layering.md`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`A2/A3 的基础 contract 与工具骨架已经明显前进，但 runtime trace-law enforcement 与 substrate evidence pack 都没有真正收口；当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `TraceEventBase / recovery taxonomy / alert exception policy` 已在代码层落地，但它们还没有变成 session runtime 主路径上的硬 enforcement。
  2. A2 的 benchmark/memo 过度宣称了 `_index` readback 与 Q5 evidence-backed yes；当前 runner 实际并没有证明它声称证明的全部内容。
  3. A2/A3 的 public harness / README / P1-P2 docs 仍混有 pre-A3 event shape 与未清理 checklist，不能作为干净的 post-execution baseline。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md`
  - `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P2-observability-layering.md`
  - `docs/action-plan/after-skeleton/AX-QNA.md`
- **核查实现**：
  - `packages/eval-observability/src/{trace-event,anchor-recovery,classification,durable-promotion-registry,sinks/do-storage}.ts`
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts`
  - `packages/eval-observability/test/{scripts,sinks,integration}/**`
  - `packages/nacp-core/src/observability/envelope.ts`
  - `packages/session-do-runtime/src/{traces,orchestration,do/nano-session-do}.ts`
  - `packages/session-do-runtime/test/orchestration.test.ts`
  - `packages/hooks/src/audit.ts`
  - `test/trace-first-law-contract.test.mjs`, `test/observability-protocol-contract.test.mjs`, `test/hooks-protocol-contract.test.mjs`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/eval-observability test`
  - `pnpm --filter @nano-agent/eval-observability typecheck && pnpm --filter @nano-agent/eval-observability build`
  - `pnpm --filter @nano-agent/nacp-core test`
  - `pnpm --filter @nano-agent/session-do-runtime test`
  - `pnpm --filter @nano-agent/hooks test`
  - `pnpm test:cross`
  - `rg 'assertTraceLaw\\(|validateTraceEvent\\(' packages --glob 'src/**/*.ts'`

### 1.1 已确认的正面事实

- `packages/eval-observability/src/trace-event.ts` 已把 `TraceEventBase` 升级为 `traceUuid / sourceRole / sourceKey? / messageUuid?` 必带/可选组合，并提供 `validateTraceEvent` / `assertTraceLaw` helper；`anchor-recovery.ts` 也已暴露 8 项 recovery taxonomy。
- `packages/nacp-core/src/observability/envelope.ts` 已引入 `scope`，并把 `trace_uuid` optional 收紧为仅 `platform` 允许例外；`packages/hooks/src/audit.ts` 也已补入 `HookTraceContext`。
- `packages/eval-observability/src/sinks/do-storage.ts` 保持 tenant-scoped JSONL + `_index` sink，`SessionInspector`/root cross-package contract tests 也已存在；本轮相关现有测试与构建入口均为绿色。

### 1.2 已确认的负面事实

- `packages/session-do-runtime/src/orchestration.ts:160-165,300-303` 仍直接发出不带 `traceUuid/sessionUuid/teamUuid/sourceRole` 的 trace payload，且 `packages/session-do-runtime/src/do/nano-session-do.ts:610-615` 只是把该对象原样转发给 eval sink；全仓 `src/**/*.ts` 中没有任何 `assertTraceLaw()` / `validateTraceEvent()` 的真实接线。
- `packages/eval-observability/scripts/trace-substrate-benchmark.ts:37-47,547-601` 的 verdict 只编码 `readback / WA / tailRatio`，没有编码 AX-QNA Q5 的绝对 `p50<=20ms / p99<=100ms`；同一 runner 的 `RecordingFakeStorage.list()`（`:186-190`）又会触发 `DoStorageTraceSink.enumerateDataKeys()` 的 list-fast-path（`src/sinks/do-storage.ts:227-239`），因此 readback probe 并未证明 memo 所写的 `_index` fallback reconstruction。
- `packages/eval-observability/scripts/trace-substrate-benchmark.ts:239-257`、`packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts:207-214`、`packages/eval-observability/README.md:87-96` 仍在构造不含 `traceUuid/sourceRole` 的 event；而 `packages/eval-observability/tsconfig.json:9-20` 只 typecheck `src/**/*.ts`，scripts/tests 不在覆盖范围内。
- `package.json:7-9` 的根级 `test:cross` 仍是 `node --test test/**/*.test.mjs`；结合当前 shell expansion，它只运行 `test/e2e/*.test.mjs` 的 14 个 E2E 文件，并不会覆盖 `test/*.test.mjs` 下的 root contract suites，而 `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md:529-542` 仍把这些 suites 记成 `test:cross` 已覆盖。
- `packages/session-do-runtime/src/alarm.ts:68-73` 仍把 `flushTraces()` 错误 silent swallow；但 `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md:280-291` 的 Phase 3 目标仍要求 checkpoint/restore/alarm 至少有恢复路径或显式失败路径。

---

## 2. 审查发现

### R1. Session runtime 主路径仍可绕过 trace law，且 `session.ended` 会被当作未知 kind 丢弃

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/orchestration.ts:160-165` 直接 `emitTrace({ eventKind: "turn.begin", turnId, timestamp })`；`:300-303` 直接 `emitTrace({ eventKind: "session.ended", timestamp })`。
  - `packages/session-do-runtime/src/do/nano-session-do.ts:610-615` 的 `buildOrchestrationDeps().emitTrace` 只是把 `unknown` 对象原样转发给 `handles.eval.emit`；全仓 `packages/**/src/**/*.ts` 中没有任何 `assertTraceLaw()` / `validateTraceEvent()` 的接线。
  - `packages/session-do-runtime/src/traces.ts:64-80,129-145` 已经定义了需要 `traceUuid/sourceRole/...` 的 builder contract；同文件 `:103-104` 与 `packages/eval-observability/src/classification.ts:29-42,70-71` 的 canonical kind 是 `session.end`，不是 `session.ended`。
  - `packages/session-do-runtime/test/orchestration.test.ts:192-203` 只断言 `eventKind: "turn.begin"`；没有守住 `traceUuid/sessionUuid/teamUuid/sourceRole`，也没有守住 canonical `session.end` kind。
- **为什么重要**：
  - A3 的核心承诺是“accepted internal runtime work 不再脱离 trace law 自行运行”。当前真实 orchestration path 仍能绕过 builder/validator，把不合规事件送进 eval sink。
  - 这不只是“少几个字段”：`session.ended` 还会被 `shouldPersist()` 当成未知 kind，从 durable audit path 中静默掉落，直接破坏 session-end evidence。
- **审查判断**：
  - A3 的 base contract 已经存在，但 runtime enforcement 仍是 partial；“trace-first foundation 已闭合”这一表述当前不成立。
- **建议修法**：
  - 把 `SessionOrchestrator` 的 trace emission 统一改为共享 builder path，至少覆盖 `turn.begin / turn.end / session.end`。
  - 将 orchestration `emitTrace` seam 收紧为真正的 `TraceEvent`，在进入 sink 前显式执行 `assertTraceLaw()`，不要继续接受 `unknown`。
  - 为 `startTurn()/runStepLoop()/endSession()` 增加 regression tests，明确断言 canonical kind 与 `traceUuid/sessionUuid/teamUuid/sourceRole`。

### R2. A2 benchmark/memo 过度宣称 substrate evidence，当前 runner 既未关闭 Q5 延迟门槛，也未真正证明 `_index` fallback

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts:37-47` 的 `BENCH_THRESHOLDS` 只有 `readbackSuccessPct / writeAmplificationMax / tailRatioWarn`；`computeVerdict()`（`:547-601`）完全不检查 AX-QNA Q5 要求的 `p50<=20ms / p99<=100ms`。
  - 同一文件 `:12-14` 与 `docs/eval/after-skeleton-trace-substrate-benchmark.md:15,131-133` 声称 fresh sink 通过 `_index` 重建 timeline；但 `RecordingFakeStorage.list()`（runner `:186-190`）会触发 `DoStorageTraceSink.enumerateDataKeys()` 的 list-fast-path（`packages/eval-observability/src/sinks/do-storage.ts:227-239`），因此 readback probe 实际没有覆盖 `_index` fallback。
  - `docs/eval/after-skeleton-trace-substrate-benchmark.md:20,198-205` 把 Q5 升格成 `evidence-backed yes`；但同文 `:69-74,214-216` 又明确承认所有 latency 都是 in-isolate fake timing，真实 DO p50/p99 仍要到 A6 才验证。
- **为什么重要**：
  - A2 的交付物不是“有个 runner”而已，而是为 P1 substrate decision 提供可信 evidence。当前证据包把“方向正确”说成了“owner gate 已完成”。
  - 若下游按这个 memo 接受 `_index` readback 与 Q5 gate 已关闭，就会把并未被 runner 证明的前提带进 A3/A6/A7。
- **审查判断**：
  - `DO storage hot anchor` 作为方向选择仍然合理，但 A2 现有 memo 还不能作为完整的 owner-grade closure evidence。
- **建议修法**：
  - 将 benchmark memo 的结论降级为“package-local code-path evidence / partial evidence”，不要再直接写 `Q5 evidence-backed yes`，除非先补齐 gate 定义。
  - 若 `_index` fallback 是 load-bearing claim，readback-probe 必须改用 **无 `list()` 能力** 的 storage double 单独验证。
  - 把 `real DO p50/p99` 明确保留给 A6 gate；A2 只能声称“未见 package-local code-path blocker”，不能替代远端 budget closure。

### R3. A2 benchmark harness 仍在使用 pre-A3 TraceEvent shape，而且当前不会被 typecheck/build 守住

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - `packages/eval-observability/scripts/trace-substrate-benchmark.ts:239-257` 的 `makeEvent()` 返回对象没有 `traceUuid` / `sourceRole`。
  - `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts:202-214` 直接对 `sink.emit()` 传入不含 `traceUuid` / `sourceRole` 的对象。
  - `packages/eval-observability/tsconfig.json:9-20` 设置了 `rootDir = "./src"`、`include = ["src/**/*.ts"]`、`exclude = ["test"]`，所以 scripts/tests 并不在 package typecheck/build 覆盖范围内。
- **为什么重要**：
  - A2 的 runner/test 正是 substrate memo 的证据来源；如果它们停留在 pre-A3 shape，上游就无法确认 benchmark 测的是当前 trace-first contract，而不是旧 payload。
  - 这也解释了为什么 package tests 全绿，但 benchmark fixture 仍能长期漂移而不被编译器拦住。
- **审查判断**：
  - 当前 A2/A3 的绿色测试更多证明“package src 自洽”，并不能证明 benchmark harness 已经对齐 post-A3 trace law。
- **建议修法**：
  - 为 scripts/tests 增加独立的 typecheck 入口，或扩大现有 tsconfig 覆盖面。
  - 把 benchmark fixture 与 script smoke 全部升级到 canonical `TraceEventBase` shape，至少补齐 `traceUuid / sourceRole / sessionUuid / teamUuid`。

### R4. A2/A3 的 README 与 P1/P2 文档仍是混合状态，不能作为干净的执行后 baseline

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/eval-observability/README.md:82-96` 解释了 `_index` / list 行为，但示例 `sink.emit({...})` 仍缺 `traceUuid / sourceRole`。
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md:404-413` 仍保留未关闭 checklist；但附录 B `:428-435` 又宣称 “P2 design 的所有 trace-first 前提已被 A3 落地为代码”，与本轮代码事实不一致。
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md:370-381`、`docs/design/after-skeleton/P2-observability-layering.md:350-356` 仍保留执行后未清理的 `待深入调查 / 需要更新其他设计文档` 项。
- **为什么重要**：
  - A2/A3 不只是代码 phase，也是设计 baseline phase。后续 reviewer / implementer 会直接引用这些 docs 判断什么已经 frozen、什么还在待决。
  - 当前文档把“append 了 execution note”与“真正完成 baseline 回写”混在一起，容易重复制造争议。
- **审查判断**：
  - 就像 A1 一样，A2/A3 的 exit pack 目前还不是单一可信来源；即使代码 foundation 部分成立，也不应提前宣称 phase 已关闭。
- **建议修法**：
  - 清理 `README.md` 示例与 P1/P2/P2-layering 的 stale checklist，把它们统一到 post-execution reality。
  - 将仍未完成的事项明确标成 follow-up / downstream handoff，不要继续和“已收口”叙述并存。

### R5. 根级 `test:cross` 实际没有覆盖 trace-first contract suites，但 A3 执行日志把它写成已覆盖

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `package.json:7-9` 把 `test:cross` 定义为 `node --test test/**/*.test.mjs`。
  - 当前仓库里 `test/e2e/*.test.mjs` 恰好有 14 个，而 `test/*.test.mjs` 也有 14 个 top-level contract/smoke files；实际运行 `npm run test:cross` 输出为 `# tests 14`、只覆盖 E2E 文件。
  - `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md:529-542` 仍声称 `npm run test:cross` 覆盖了 `14/14 e2e + 3 contract suites + trace-first-law`，并把 `trace-first-law-contract` 记成 15 cases；而 `test/trace-first-law-contract.test.mjs` 当前实际只有 9 个 `test()`。
- **为什么重要**：
  - root contract suites 正是 A3 用来守住 cross-package trace drift 的 load-bearing guard；如果默认 cross runner 根本不跑它们，CI/本地回归都会对这条保护网产生错误信心。
  - 这同时意味着 A3 §11.3 的测试证明存在事实性错误，不能继续作为可信 execution evidence 被引用。
- **审查判断**：
  - 当前并不是“日志措辞夸张”这么简单，而是 root contract coverage 与 execution attestation 都有硬错位。
- **建议修法**：
  - 修正根级 cross-test 入口，确保 `test/*.test.mjs` 与 `test/e2e/*.test.mjs` 都被执行，或拆成独立 `test:contracts` 并写入明确 gate。
  - 同步更正 A3 §11.3 的 test count 与 coverage 叙述，停止把未运行的 contract suites 记成已通过。

### R6. Alarm path 仍以 silent swallow 处理 trace flush failure，和 A3 自身 closure standard 冲突

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/session-do-runtime/src/alarm.ts:68-73` 仍对 `flushTraces()` 使用 broad catch，并注释为 “best-effort / swallow and continue”。
  - `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md:280-291` 明确要求 `checkpoint/restore/alarm` 至少存在恢复路径或显式失败路径；同文 `:546-556` 又承认 alarm 在本轮并未真正完成 wiring。
- **为什么重要**：
  - A3 的设计核心是 “不再 silent fallback”；alarm 作为 hibernation/maintenance seam，却仍可静默吞掉 trace flush failure，会留下未观测的数据丢失路径。
  - 即使当前 alarm trace wiring 还不完整，也不应该在 action-plan / execution log 中把它描述成已经达到 trace-first closure。
- **审查判断**：
  - 这是 A3 Phase 3 closure 的真实缺口；如果暂时不修代码，也至少必须把 phase 结论降级成 partial，而不是继续按已收口叙述。
- **建议修法**：
  - 要么让 alarm path 在 flush failure 时产出显式失败记录/typed error，要么把该 seam 明确降级为后续 phase follow-up，并从 A3 DoD 中移出“alarm 已闭合”的说法。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | A2 benchmark runner + regression harness | `partial` | runner、tests、artifact 都已存在，但 readback path 与 trace-law fixture 仍有关键偏差。 |
| S2 | A2 substrate decision memo + Q20 gate evidence | `partial` | D1 deferred gate 写清了，但 `_index` proof 与 Q5 evidence-backed yes 结论都过度宣称。 |
| S3 | A3 base contract：`TraceEventBase` / recovery taxonomy / alert exception | `done` | `trace-event.ts`、`anchor-recovery.ts`、`nacp-core/src/observability/envelope.ts` 的 contract 面已落地。 |
| S4 | A3 session/runtime trace wiring 不得绕过 trace-first builder | `partial` | `session-do-runtime/src/traces.ts` builder 存在，但 orchestration 主路径仍绕过它，且 `session.ended` kind 错误。 |
| S5 | A3 邻接包 / cross-package contract guard | `partial` | hooks trace context 与 root contract tests 已有进展，但 live orchestration path 没被这些 tests 守住，且当前 `test:cross` 默认并不运行 root contract suites。 |
| S6 | A2/A3 README / design / evidence exit pack 同步 | `partial` | benchmark memo、package README、P1/P2 docs 与 A3 执行日志都仍存在 execution note、stale baseline 或 coverage 误报。 |

### 3.1 对齐结论

- **done**: `1`
- **partial**: `5`
- **missing**: `0`

这更像 **“foundation primitives 已完成一大半，但 runtime enforcement 与 evidence/docs closure 仍未完成”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Real Cloudflare DO remote latency / deploy-shaped verification | `遵守` | 当前实现没有越界把 wrangler dev --remote / deploy smoke 塞进 A2/A3；真实边界验证仍留给 A6。 |
| O2 | R2 archive / D1 / KV 的正式 runtime wiring | `遵守` | A2/A3 没有提前把 R2/D1/KV 做成 trace hot path。 |
| O3 | 完整 session edge / external seam closure | `遵守` | A3 只触及 observability 所需 runtime seam，没有直接越界实现 A4/A5 的整批 binding glue。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`A2/A3 当前不收口；基础 contract 已落地，但 runtime trace enforcement、substrate evidence 以及 docs exit pack 都仍有 blocker。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 修正 `session-do-runtime` 的 trace 主路径：使用 canonical builder / kind，确保 `turn.begin / turn.end / session.end` 进入 eval sink 前都已 trace-law compliant，并由测试守住。
  2. 回收 A2 benchmark/memo 的过度宣称：补足或降级 `_index` / Q5 相关结论，使 artifact 与 runner 实际证明能力完全一致。
  3. 修正 root cross-test coverage 与 A3 执行日志：确保 contract suites 真正进入默认回归入口，且 test count / coverage 叙述与实际一致。
  4. 补齐 benchmark harness 的 type-safety，并清理 `eval-observability` README、P1/P2 docs、A3 phase closure 叙述中的 stale baseline 或过度表述，使 A2/A3 有单一可信的 post-execution 出口。
- **可以后续跟进的 non-blocking follow-up**：
  1. 评估是否在 `TraceSink.emit()` 或 composition seam 统一加入结构化 trace validation，避免未来再出现“builder 是对的，但 live path 绕过”。
  2. 若后续仍保留 package-local benchmark，建议把 `list-path` 与 `_index-path` 拆成两个显式 scenario，避免 artifact prose 与 harness semantics 再次漂移。

本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

### 6.1 对本轮审查的回应

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-18`
> 回应范围: `GPT R1–R6 + Kimi R1–R4`（两份 review 合并处理；本节是统一回应，详细 Kimi 评价见 `A2-A3-reviewed-by-kimi.md` §6）

- **总体回应**：`GPT 的 6 条 finding 全部属实。R1/R2/R5 属 high-severity blocker，已在代码与文档中完整 fix；R3/R4/R6 属 medium/docs，也已一并 fix（R6 补 AlarmDeps.onFlushFailure + 默认 rethrow，既满足“no silent swallow”又保留 DO-side 未来 wiring 空间）。Kimi 的 R1 与 R2 与 GPT R3 / 跨包 mirror 有重叠，已一并 fix 或以 compile-time 结构检查收口。`
- **本轮修改策略**：`先修 runtime correctness（R1/R6），再补 substrate evidence（R2/R3），最后同步 docs / cross-test glob（R4/R5）。修完后全仓回归 10 包 1916 tests + root e2e 66/66 全绿。`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| GPT R1 | Session runtime 主路径仍绕过 trace law；`session.ended` 被当作未知 kind 丢弃 | `fixed` | `orchestration.ts::startTurn / endSession / runStepLoop` 改走 `buildTurnBeginTrace / buildTurnEndTrace / buildSessionEndTrace`；`OrchestrationDeps.emitTrace` 收紧为 `TraceEvent`；`OrchestrationDeps.traceContext` 新增；`nano-session-do.ts::buildOrchestrationDeps()` 的 emit 包装里调用 `assertTraceLaw()`；session.ended → canonical `session.end`；orchestration tests 新增 trace carrier 断言 | `packages/session-do-runtime/src/orchestration.ts`, `packages/session-do-runtime/src/traces.ts`, `packages/session-do-runtime/src/do/nano-session-do.ts`, `packages/session-do-runtime/test/orchestration.test.ts` |
| GPT R2 | A2 benchmark/memo 过度宣称 `_index` fallback + Q5 evidence-backed yes | `fixed` | `BENCH_THRESHOLDS` 新增 `emitP50MsMax=20 / emitP99MsMax=100`（Q5 绝对预算）；`computeVerdict()` 对两个预算做 red-level 检查；`RecordingFakeStorage.asListless()` 产出不含 `list()` 的 view；`runReadbackProbe()` 增加 listless reader pass + `ReadbackResult.listlessReadback`；verdict 也检查 listless 成功率；memo prose 从 "evidence-backed yes" 降级为 "package-local-isolate evidence-backed yes"，remote Q5 closure 明确留给 A6 | `packages/eval-observability/scripts/trace-substrate-benchmark.ts`, `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`, `docs/eval/after-skeleton-trace-substrate-benchmark.md` |
| GPT R3 / Kimi R1 | benchmark fixture 缺 trace carriers；scripts/tests 不在 tsconfig 覆盖，drift 无法在编译时拦截 | `fixed` | `makeEvent()` 新增 `traceUuid / sourceRole / sourceKey`；`test/scripts/trace-substrate-benchmark.test.ts` + `test/sink.test.ts` + `test/sinks/do-storage.test.ts` + `test/timeline.test.ts` + `test/attribution.test.ts` + `test/replay.test.ts` 的 fixture 全部上 carriers；新增 `packages/eval-observability/tsconfig.scripts.json` + `scripts/types.d.ts` 最小 Node shim；`package.json` 的 `typecheck` 同时跑 `src` 和 `scripts` tsconfig | 见 §6.3 |
| GPT R4 / Kimi R3 | README 示例缺 trace carriers；P1/P2/P2-layering docs 仍有未关闭 checklist | `fixed` | `packages/eval-observability/README.md` 示例加 trace carriers；`P2-trace-first-observability-foundation.md` §0 引用行号附 post-A3 reality 注；§9.3 checklist 全部收尾 + 追加附录 B.1（A2/A3 review follow-up）；`P1-trace-substrate-decision.md` §9.3 关闭；`P2-observability-layering.md` §9.3 关闭 | 见 §6.3 |
| GPT R5 | 根级 `test:cross` 实际只跑 14 e2e；A3 §11.3 的 15 cases / 172 / 258 全部失真 | `fixed` | `package.json` 新增三个入口：`test:contracts = node --test test/*.test.mjs`, `test:e2e = node --test test/e2e/*.test.mjs`, `test:cross = node --test test/*.test.mjs test/e2e/*.test.mjs`（覆盖 66 tests）；A3 §11.3 重写：`eval-observability 196` / `session-do-runtime 312` / `trace-first-law-contract 9 cases` / `test:cross 66` | `package.json`, `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md` |
| GPT R6 | `alarm.ts` silent-swallow `flushTraces()`，与 A3 "no silent fallback" 冲突 | `fixed` | `AlarmDeps` 新增可选 `onFlushFailure(err)` hook；flush 失败时交给 hook 处理，未注入 hook 则 rethrow（不再 silent swallow）；`alarm.test.ts` 改 3 个 case：rethrow when no hook / delegate when hook / next alarm still fires | `packages/session-do-runtime/src/alarm.ts`, `packages/session-do-runtime/test/alarm.test.ts` |
| Kimi R2 | session-do-runtime TraceEvent 本地 mirror 无编译时同步机制 | `fixed`（docs + compile-time structural guard） | `packages/session-do-runtime/test/traces.test.ts` 新增 mirror-drift describe block：`const asEval: EvalTraceEvent = local; const asLocal: SessionDoTraceEvent = asEval;` 两行互相赋值，任一侧新增必填字段都会立即触发 `tsc` 失败；同时 `traces.ts` 新增本地 `assertTraceLaw()` 所以 nano-session-do 运行时也不依赖 eval-observability | `packages/session-do-runtime/src/traces.ts`, `packages/session-do-runtime/test/traces.test.ts` |
| Kimi R4 | A3 §11.3 测试数字与实际不一致 | `fixed` | 与 GPT R5 合并处理；数字全部重写 | `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md` |

### 6.3 变更文件清单

**源码（6 个）**:
- `packages/session-do-runtime/src/orchestration.ts`
- `packages/session-do-runtime/src/traces.ts`
- `packages/session-do-runtime/src/do/nano-session-do.ts`
- `packages/session-do-runtime/src/alarm.ts`
- `packages/session-do-runtime/src/index.ts`
- `packages/eval-observability/scripts/trace-substrate-benchmark.ts`

**测试（7 个）**:
- `packages/session-do-runtime/test/orchestration.test.ts`
- `packages/session-do-runtime/test/alarm.test.ts`
- `packages/session-do-runtime/test/traces.test.ts`
- `packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`
- `packages/eval-observability/test/sink.test.ts`
- `packages/eval-observability/test/sinks/do-storage.test.ts`
- `packages/eval-observability/test/timeline.test.ts`
- `packages/eval-observability/test/attribution.test.ts`
- `packages/eval-observability/test/replay.test.ts`

**配置（3 个）**:
- `package.json`（root — test:cross glob）
- `packages/eval-observability/package.json`（typecheck 含 scripts 入口）
- `packages/eval-observability/tsconfig.scripts.json`（新建）
- `packages/eval-observability/scripts/types.d.ts`（新建 — 最小 Node shim）

**文档（5 个）**:
- `packages/eval-observability/README.md`
- `docs/eval/after-skeleton-trace-substrate-benchmark.md`
- `docs/design/after-skeleton/P1-trace-substrate-decision.md`
- `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
- `docs/design/after-skeleton/P2-observability-layering.md`
- `docs/action-plan/after-skeleton/A3-trace-first-observability-foundation.md`

### 6.4 验证结果

```text
pnpm -r typecheck                                      →  10 包全绿（含 eval-observability scripts 入口）
pnpm -r build                                          →  10 包全绿
pnpm --filter @nano-agent/eval-observability test      →  196 passed (up from 194; +2 cases: listless verdict + Q5 p50 budget)
pnpm --filter @nano-agent/session-do-runtime test      →  312 passed (up from 309; +3 cases: orchestration carriers + alarm onFlushFailure + mirror drift)
pnpm --filter @nano-agent/nacp-core test               →  231 passed
pnpm --filter @nano-agent/nacp-session test            →  115 passed
pnpm --filter @nano-agent/hooks test                   →  132 passed
pnpm --filter @nano-agent/llm-wrapper test             →  103 passed
pnpm --filter @nano-agent/agent-runtime-kernel test    →  123 passed
pnpm --filter @nano-agent/capability-runtime test      →  227 passed
pnpm --filter @nano-agent/storage-topology test        →  114 passed
pnpm --filter @nano-agent/workspace-context-artifacts test →  163 passed
npm run test:cross                                     →  66/66 passed (14 e2e + 52 contract suites) — contract suites 现在真正被跑到
```

全仓 10 包 1916 tests + root 66 tests 零回归；review 中指出的 3 条高危修复（orchestration trace law / substrate evidence 降级 / test:cross 覆盖缺口）都有显式测试或显式 verdict 断言作为回归护栏。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. 真实 Cloudflare DO `p50 ≤ 20ms / p99 ≤ 100ms` 远端 closure 仍留给 A6 deployment dry-run，本轮 benchmark memo 仅给出 package-local-isolate evidence（与 GPT R2 的建议一致）。
  2. `AlarmHandler` 的 `onFlushFailure` hook 在 `AlarmDeps` 层面留了接线点，DO 侧实际把它接到 `trace.recovery` 上报的 wiring 仍属 future composition 层工作；当前若未注入 hook，alarm() 会 rethrow，至少保证 no silent swallow。
  3. `session-do-runtime::assertTraceLaw` 与 `eval-observability::assertTraceLaw` 是两份结构等价的 helper，由新增的结构对齐测试在编译时守护（Kimi R2），未来合并到单一公共包仍属 A4+ scope。

### 6.6 对两位 reviewer 报告的整体评价

- **GPT 报告评价**：GPT 的切入角度是「runtime enforcement 真的触达了吗 / exit pack 是否成立」——六条 finding 全是 A2/A3 声称完成但实际未闭合的硬缺口。R1 + R5 尤其关键：R1 精确指出 `orchestration.ts:160-165,300-303` raw-object emit 与 `session.ended` 非 canonical 这件事 会让 `shouldPersist()` 把终结事件丢弃，证据链硬度极高；R5 把 `package.json:7-9` 的 shell-glob 行为与 A3 §11.3 的 15 cases / 172 / 258 叙述做 cross-check，直接证明 contract suites 根本没被默认 runner 跑到——这种「日志数字 vs 实际行为」的取证是其他 reviewer 容易漏掉的。R2 的方法论批评（"readback probe 没证明 `_index` fallback"）指向我没意识到的实验无效性，而且给出的修复思路（listless storage double）完全可行。六条 finding 全部属实、全部可 actionable、严重级别判定准确。**这份报告质量顶级——它把「代码主线已立」和「exit pack 未完成」切得极清，避免 A2/A3 被误判为 completed。**
- **Kimi 报告评价**：Kimi 从「公共 API 契约完整性 + 向后兼容深度 + 文档纪律」三个维度切入，四条 finding 都相对温和（approve-with-followups），但 R2 是本轮最重要的补充视角——session-do-runtime 的 TraceEvent 是 eval-observability 的本地 mirror，没有任何编译时校验。Kimi 的修复建议（"将共享类型提取到公共包 or 增加类型对齐测试"）让我意识到最便宜的 fix 是 compile-time 结构对齐断言，最终在 `test/traces.test.ts` 用两行 `const asEval: EvalTraceEvent = local; const asLocal: SessionDoTraceEvent = asEval` 收口。R1 / R3 / R4 和 GPT 的对应 finding 有重叠，但 Kimi 的严重级别判定（low/low/low）更保守——对同一个 test fixture 缺 carrier 的问题，GPT 标 medium，Kimi 标 low，这之间的差距反映了二位 reviewer 对 "fixture 是否 production-critical" 的不同判断，也给实现者更全面的视角。**这份报告质量高——补齐了 GPT 未覆盖的 compile-time drift 维度，严重级别克制合理。**
- **综合结论**：两份报告强烈互补：GPT 关注 runtime enforcement + exit pack，Kimi 关注 public API + compile-time drift + docs discipline。两者合并后的 blocker + follow-up 列表完整覆盖了 A2/A3 所有实际缺口，且没有出现重复修复需求。两份都是 approve-grade 审查工作。
