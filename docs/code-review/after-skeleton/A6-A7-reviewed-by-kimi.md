# Nano-Agent 代码审查模板

> 审查对象: `A6 (Deployment Dry-Run) + A7 (Storage & Context Evidence Closure)`
> 审查时间: `2026-04-18`
> 审查人: `Kimi`
> 审查范围:
> - `docs/action-plan/after-skeleton/A6-deployment-dry-run-and-real-boundary-verification.md`
> - `docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md`
> - `docs/design/after-skeleton/P5-deployment-dry-run-and-real-boundary-verification.md`
> - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
> - `docs/action-plan/after-skeleton/AX-QNA.md` (Q10–Q14, Q20)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：A6/A7 骨架完整、测试可信、文档一致；但 A7 的 runtime emitter 尚未真正进入主路径，存在“模型完备但调用缺位”的 gap。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. A6 的 verification ladder、profile matrix、gate aggregator 已按 Q10/Q11/Q12 冻结，本地评审 gate=RED 符合阈值设计。
  2. A7 的五类 evidence vocabulary、calibration verdict、bridge、emitters 已全部落地并通过 35 条新增 case；但 emitters 目前仅在测试中被直接调用，尚未接入 `session-do-runtime` / `ContextAssembler` / `CompactBoundaryManager` 的真实主路径。
  3. `computeCalibrationVerdict` 中存在一处冗余三元表达式（不影响功能但应清理），且 L2 real-smoke 的断言与 profile 中声明的 golden-path contract 存在字段级漂移。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `A6 action-plan` §11 execution log
  - `A7 action-plan` §11 execution log
  - `P5 design doc` 附录 B (A6 执行后状态)
  - `P6 design doc` 附录 B (A7 执行后状态)
  - `AX-QNA.md` Q10/Q11/Q12/Q13/Q14/Q20
- **核查实现**：
  - `test/verification/**` (README, profiles, smokes, runner, gate)
  - `packages/session-do-runtime/wrangler.jsonc`, `src/worker.ts`
  - `packages/eval-observability/src/evidence-streams.ts`, `evidence-bridge.ts`, `evidence-verdict.ts`, `sinks/do-storage.ts`
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts`
  - `docs/eval/after-skeleton-storage-evidence-report.md`, `after-skeleton-context-layering-principles.md`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/eval-observability test` → 22 files / 194 tests passed
  - `pnpm --filter @nano-agent/workspace-context-artifacts test` → 15 files / 163 tests passed
  - `pnpm --filter @nano-agent/session-do-runtime test` → 23 files / 309 tests passed
  - `node --test test/*.test.mjs` → 52 tests passed
  - `npm run test:cross` → 14/14 passed
  - `pnpm -r typecheck` → 10 projects 全绿
  - 读取 `context/claude-code/services/compact/microCompact.ts`, `context/claude-code/services/analytics/index.ts`, `context/codex/codex-rs/otel/src/trace_context.rs` 核对 design doc 引用

### 1.1 已确认的正面事实

- A6 的 L0/L1/L2 三层阶梯、green/yellow/red 阈值、secret 注入策略（`.dev.vars` / `wrangler secret put`）均与 AX-QNA Q10/Q11 一致。
- `wrangler.jsonc` 已从单 `SESSION_DO` 扩展到六绑定 + `env.deploy_smoke` L2 override，与 P5 design §7.1 F2 要求一致。
- `SmokeRecorder` + `WorkerHarness` + `writeVerdictBundle` 实现了 bundle shape v1，包含全部 13 个字段（含可选的 `latencyBaseline` / `notes`）。
- A7 的 `evidence-streams.ts` 冻结了五类 `EvidenceRecord` + `EvidenceAnchor`（traceUuid/sessionUuid/teamUuid/sourceRole/timestamp），与 A3 trace-first law 对齐。
- `DoStorageTraceSink` 在真实 `storage.put()` 时发出 `PlacementEvidence`，`test/sinks/do-storage-placement-emission.test.ts` 3 cases pin 住行为。
- `DEFAULT_VERDICT_RULES` 包含 5 条 hypothesis，与 Q5 substrate 决策 + P6 design §5.1 S1–S6 覆盖面对齐。
- 35 条新增测试全部通过；既有 14 条 root E2E 未回归；全仓 typecheck 无错。
- `.gitignore` 已追加 `.dev.vars` 与 `test/verification/verdict-bundles/*.json`。

### 1.2 已确认的负面事实

- `l2-real-provider.smoke.ts:126` 的 real-cloud 断言只检查 `body.ok === true`，但 `deploy-smoke-l2.json:23` 声明的 `smokeAssertionContract` 是 `response.status === 'ok' && response.output.length > 0`；字段名不匹配（`ok` vs `status`）。
- `evidence-streams.ts:295–298` 的 `computeCalibrationVerdict` 在 `contradictory >= needsRevisitMin` 分支中，三元表达式两分支均为 `"needs-revisit"`，属于冗余代码。
- `workspace-context-artifacts/src/evidence-emitters.ts` 的 `build*Evidence` 返回 `unknown` 而非 `EvidenceRecord`，虽出于零依赖设计，但牺牲了跨包类型安全。
- A7 action-plan §11.4 自检承认：“emitter 与真实 `ContextAssembler.assemble()` 调用之间没有 end-to-end test”——这与 P6 design §5.3 边界清单中 “`ContextAssembler` 返回 `truncated` / `orderApplied` = in-scope” 的要求形成落差：模型已暴露，但 runtime 尚未调用 emitter。

---

## 2. 审查发现

### R1. L2 real-smoke 断言与 golden-path contract 字段漂移

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `test/verification/smokes/l2-real-provider.smoke.ts:125–130` 检查 `body.ok === true`
  - `test/verification/profiles/deploy-smoke-l2.json:23` 声明 `smokeAssertionContract: "response.status === 'ok' && response.output.length > 0"`
- **为什么重要**：如果 reviewer 按 profile JSON 的 contract 去理解 smoke 行为，会误以为 L2 已验证 `status` + `output` 字段；实际代码只验证 `ok`。当 real-cloud 模式真正运行时，响应 shape 的漂移可能在 gate 中被掩盖。
- **审查判断**：不影响当前 harness-fallback RED 结果，但会削弱 real-cloud GREEN 的可信度。
- **建议修法**：统一 real-smoke 断言与 profile JSON 的 contract，或把 profile JSON 的 assertion 降级为注释并说明“当前实现只验证 `ok`”。

### R2. `computeCalibrationVerdict` 中存在冗余三元表达式

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `packages/eval-observability/src/evidence-streams.ts:295–298`
  ```ts
  if (summary.contradictory >= needsRevisitMin) {
    return summary.supporting >= evidenceBackedMin
      ? "needs-revisit"
      : "needs-revisit";
  }
  ```
- **为什么重要**：冗余代码会误导后续 reviewer 以为这里存在分支逻辑；实际按 Q13 规范，任何 contradictory ≥ 1 即应进入 `needs-revisit`，与 supporting 数量无关。
- **审查判断**：功能正确，但应简化以消除误导。
- **建议修法**：将三元表达式替换为单条 `return "needs-revisit";`，并加注释引用 Q13 规范。

### R3. A7 evidence emitters 尚未接入真实 runtime 主路径

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts` 提供了 `emitAssemblyEvidence / emitCompactEvidence / emitArtifactEvidence / emitSnapshotEvidence`，但 grep 全仓未发现 `ContextAssembler.assemble()`、`CompactBoundaryManager.buildCompactRequest()`、`WorkspaceSnapshotBuilder.buildFragment()` 等真实业务入口调用这些 emitters。
  - A7 action-plan §11.4 自检原文：“emitter 与真实 `ContextAssembler.assemble()` 调用之间没有 end-to-end test”。
  - P6 design §5.3 边界清单将 `ContextAssembler` 的 `truncated/orderApplied` 判定为 `in-scope`，因为“这些就是 context evidence 的天然输出面”。
- **为什么重要**：A7 的核心交付目标之一是“让 storage/context seam 从测试资产提升为 runtime 主路径资产”。如果 emitters 只存在于测试和 helper 中，P6 evidence closure 仍是 synthetic-only，无法支撑下一阶段的 threshold freeze 或 context architecture 决策。
- **审查判断**：这是 A7 最大的 delivery gap。当前状态更接近“evidence vocabulary 和 helper 已就绪，但 instrumentation 还未真正安装”。
- **建议修法**：在 `session-do-runtime` 或 `agent-runtime-kernel` 的 assembly/compact/snapshot 调用点中，至少选择一条真实主路径接入 emitter，并补一条 end-to-end test（assembler → emitter → recorder → verdict）。可作为 non-blocking follow-up 进入下一迭代，但必须在 A8 启动前完成。

### R4. `DoStorageTraceSink.emitPlacement` 使用独立 timestamp

- **严重级别**：`low`
- **类型**：`scope-drift`
- **事实依据**：
  - `packages/eval-observability/src/sinks/do-storage.ts:154` 使用 `new Date().toISOString()` 作为 placement evidence 的 `anchor.timestamp`
  - 同一批 flush 的 `firstEvent` 带有自己的 `event.timestamp`，二者可能不同。
- **为什么重要**：placement evidence 的 timestamp 若与 trace event timestamp 不一致，后续 timeline 重建时可能出现“placement 发生在 event 之后”的时序假象。
- **审查判断**：不影响当前 verdict 计算（规则只看 supporting/contradictory 计数，不看时间），但对长期 trace replay 不利。
- **建议修法**：优先使用 `firstEvent?.timestamp ?? new Date().toISOString()`，使 placement evidence 的 anchor timestamp 与真实 event 对齐。

### R5. `WorkerHarness` 中 `envOverrides` 多次使用 `as never` / `as unknown`

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `test/verification/smokes/runner.ts:326–328`：`env = { ...this.env, TEAM_UUID: ... } as unknown as SessionRuntimeEnv`
  - `test/verification/smokes/l1-session-edge.smoke.ts:53`：`envOverrides: { TEAM_UUID } as never`
- **为什么重要**：虽然测试代码中类型断言的容忍度可以更高，但 `as never` 会完全绕过类型检查；如果 `WorkerEnv` 或 `SessionRuntimeEnv` 未来改名或删除 `TEAM_UUID` 字段，测试不会在 typecheck 阶段报错。
- **审查判断**：测试代码，风险可控，但应逐步收紧。
- **建议修法**：为 harness 定义一个 `HarnessEnvOverrides` 接口，显式列出允许的覆盖字段，替代 `as never`。

### R6. A6 gate aggregator 缺少“可选 smoke”对 verdict 的影响测试

- **严重级别**：`low`
- **类型**：`test-gap`
- **事实依据**：
  - `test/verification/smokes/inventory.ts` 定义了 `SmokeRequiredness = "required" | "optional"`
  - 但当前 `SMOKE_INVENTORY` 中所有 L1/L2 case 的 `requiredness` 均为 `"required"`，没有 `"optional"` 条目。
  - `test/a6-gate.test.mjs` 只验证了 required smokes，未验证 optional smoke 不影响 gate verdict 的逻辑。
- **为什么重要**：`gate.ts:78–86` 的 verdict 计算循环只遍历 `requiredIds`，理论上 optional 不影响结果；但没有测试覆盖这一分支，未来若加入 optional case，可能意外破坏 gate 逻辑。
- **审查判断**：当前无实际损害，但属于测试覆盖缺口。
- **建议修法**：在 `test/a6-gate.test.mjs` 中增加一个 mock case：向 `perScenario` 注入一个 `verdict=red` 的 optional smoke，验证 gate 仍为 green。

---

## 3. In-Scope 逐项对齐审核

### 3.1 A6 In-Scope 对齐

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 冻结 L0/L1/L2 三层验证阶梯与进入条件 | `done` | `test/verification/README.md` 已冻结 ladder、threshold、bundle shape |
| S2 | 补齐 wrangler profile、fake worker fixture、verdict bundle 输出面 | `done` | 三份 JSON profile + manifest.ts + runner.ts + bundle writer 已落地 |
| S3 | L1 session edge 与 external seams deploy-shaped dry-run | `done` | `l1-session-edge.smoke.ts` 5 步 + `l1-external-seams.smoke.ts` 3 条 seam，test 已 pin green |
| S4 | L2 real-boundary smoke（gpt-4.1-nano + 真实 binding） | `partial` | dual-mode 已实现，harness-fallback RED 正确；但 real-cloud 断言与 profile contract 字段漂移 (R1) |
| S5 | green/yellow/red verdict + latency baseline + failure record | `done` | `SmokeRecorder.setLatency` + `recordFailure` + `block` + gate aggregator 已落地 |

### 3.2 A7 In-Scope 对齐

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 冻结五类 evidence vocabulary + trace/tenant law + calibration verdict | `done` | `evidence-streams.ts` + `computeCalibrationVerdict` + Q13/Q14 阈值已落地 |
| S2 | 真实 storage 持续写出 placement evidence | `done` | `DoStorageTraceSink` 在 `storage.put()` 时 emit `PlacementEvidence`，3 test cases pin |
| S3 | ContextAssembler / CompactBoundaryManager / artifact / snapshot 进入 runtime evidence 主路径 | `partial` | emitters 已存在并通过 13 tests，但未在真实业务入口被调用 (R3) |
| S4 | 真实 storage spot-check + calibration verdict | `done` | `p6-evidence-verdict.test.ts` 驱动真实 sink flush → 5 hypothesis evidence-backed + 降级路径覆盖 |
| S5 | storage evidence report + context layering principles | `done` | 两份 docs 已产出，7 章节 + 7 条原则 |

### 3.3 对齐结论

- **done**: `8`
- **partial**: `2`
- **missing**: `0`

> 这更像“核心骨架与测试资产全部完成，但 A7 的 runtime instrumentation 尚未真正安装到主路径”，而不是 completed。R3 是阻碍“P6 evidence 真正持续产生”的最关键 gap。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | full production deploy pipeline / CI orchestration | `遵守` | A6 明确不做；无相关代码 |
| O2 | load test / capacity test / SLO | `遵守` | A6 明确不做；`latencyBaseline` 只记录不压测 |
| O3 | multi-provider / multi-region smoke matrix | `遵守` | A6 只做 gpt-4.1-nano 单 golden path |
| O4 | browser rendering / skill worker real smoke | `遵守` | A6 未涉及 |
| O5 | D1 query schema / DDL / archive scheduler | `遵守` | A7 明确不做；D1 仍 deferred |
| O6 | semantic retrieval / embeddings evidence | `遵守` | A7 明确不做 |
| O7 | frontend evidence explorer UI / analytics dashboard | `遵守` | A7 明确不做 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`，但 R3 必须在 A8 启动前完成
- **关闭前必须完成的 blocker**：
  1. 无（R1/R2/R4/R5/R6 均为 non-blocking，R3 可列为 A8 前置条件）
- **可以后续跟进的 non-blocking follow-up**：
  1. **R1**: 统一 L2 real-smoke 断言与 profile JSON 的 `smokeAssertionContract`（中等优先级）。
  2. **R2**: 清理 `computeCalibrationVerdict` 冗余三元表达式（低优先级）。
  3. **R3（A8 前置）**: 在 `session-do-runtime` 或 `agent-runtime-kernel` 的真实 assembly/compact/snapshot 调用点接入 evidence emitters，并补 end-to-end test。
  4. **R4**: `emitPlacement` timestamp 对齐 trace event timestamp（低优先级）。
  5. **R5**: 收紧 `WorkerHarness` 类型断言（低优先级）。
  6. **R6**: 补 optional smoke 不影响 gate verdict 的测试（低优先级）。

> 本轮 review 收口，R3 作为 A8 启动前的必须完成项跟踪。

---

## 6. 实现者回应（针对 Kimi 报告）

> 执行者: `Claude (claude-opus-4-7[1m])`
> 执行时间: `2026-04-18`
> 回应范围: `Kimi R1 – R6`
> 交叉回应: 跨 reviewer 的统一修改日志与对 GPT 报告的整体评价写在 `docs/code-review/after-skeleton/A6-A7-reviewed-by-GPT.md` §6；本节只记录针对 Kimi 六条 finding 的独立回应与对本份报告的评价。

### 6.1 逐项回应

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| Kimi R1 | L2 real-smoke `body.ok === true` 断言与 profile `smokeAssertionContract = "response.status === 'ok' && response.output.length > 0"` 字段漂移 | `fixed` | `runRealSmoke()` 现在严格按 profile contract 检查 `body.status === "ok" && typeof body.output === "string" && body.output.length > 0`；不满足时 `recordFailure()` 说明 contract gap；harness-fallback 路径也主动 `recordFailure` 标明 contract 不能在 fallback 模式下成立 | `test/verification/smokes/l2-real-provider.smoke.ts` |
| Kimi R2 | `computeCalibrationVerdict` 的 `needsRevisitMin` 分支两条三元分支都返回 `"needs-revisit"` | `fixed` | 替换为单 `return "needs-revisit"` + Q13 注释；消除 reviewer 误以为这里存在分支逻辑的可能 | `packages/eval-observability/src/evidence-streams.ts` |
| Kimi R3 | A7 evidence emitters 尚未接入真实 runtime 主路径 | `fixed`（A8 前置条件已提前完成） | `ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 分别加 `{evidenceSink, evidenceAnchor}` 可选 options + `setEvidenceWiring()` 运行时 rebind；三个类的主 method (`assemble / buildCompactRequest + applyCompactResponse / buildFragment + emitRestoreEvidence`) 在返回前自动发 evidence；新增 `test/integration/evidence-runtime-wiring.test.ts` 7 cases 证明 emission 确实随真实业务方法调用发生 | `packages/workspace-context-artifacts/src/{context-assembler,compact-boundary,snapshot}.ts`, `packages/workspace-context-artifacts/test/integration/evidence-runtime-wiring.test.ts` |
| Kimi R4 | `DoStorageTraceSink.emitPlacement` anchor timestamp 用独立 `new Date().toISOString()`，可能与 event timestamp 错位 | `fixed` | `anchor.timestamp` 优先 `firstEvent?.timestamp ?? new Date().toISOString()`；replay 时 placement 不会出现在 event 之后 | `packages/eval-observability/src/sinks/do-storage.ts` |
| Kimi R5 | `WorkerHarness.envOverrides` 多处 `as never` / `as unknown as SessionRuntimeEnv` 绕过类型检查 | `fixed` | 新增 `HarnessEnvOverrides extends Partial<Pick<SessionRuntimeEnv, "TEAM_UUID" \| "SESSION_UUID" \| "HOOK_WORKER" \| "CAPABILITY_WORKER" \| "FAKE_PROVIDER_WORKER">>`；`WorkerHarnessOptions.envOverrides` 切到 `HarnessEnvOverrides`；两处 smoke 的 `as never` 一并删除；现在 `SessionRuntimeEnv` 字段未来改名或删除会立即在 typecheck 阶段报错 | `test/verification/smokes/runner.ts`, `test/verification/smokes/l1-session-edge.smoke.ts`, `test/verification/smokes/l2-real-provider.smoke.ts` |
| Kimi R6 | `a6-gate` 测试缺少 optional smoke 不影响 verdict 的覆盖 | `fixed` | `runGate()` 接受新 `perScenarioOverride` 选项（测试专用）；`test/a6-gate.test.mjs` 新增 "gate ignores optional smokes" case，注入 `custom-optional-smoke: red`，断言 gate 仍 `green` 且 blocking 不含该 id；防止未来 inventory 添加 optional 条目时 gate 逻辑意外破坏 | `test/verification/smokes/gate.ts`, `test/a6-gate.test.mjs` |

### 6.2 变更文件清单（仅本报告触达部分）

- `test/verification/smokes/l2-real-provider.smoke.ts`（R1）
- `packages/eval-observability/src/evidence-streams.ts`（R2）
- `packages/workspace-context-artifacts/src/context-assembler.ts`（R3）
- `packages/workspace-context-artifacts/src/compact-boundary.ts`（R3）
- `packages/workspace-context-artifacts/src/snapshot.ts`（R3）
- `packages/workspace-context-artifacts/test/integration/evidence-runtime-wiring.test.ts`（R3 新建）
- `packages/eval-observability/src/sinks/do-storage.ts`（R4）
- `test/verification/smokes/runner.ts`（R5）
- `test/verification/smokes/l1-session-edge.smoke.ts`（R5）
- `test/verification/smokes/gate.ts`（R6）
- `test/a6-gate.test.mjs`（R6）

其余修改（GPT R1 harness proxy / R2 fixture-contract downgrade / R5 docs 降级等）见 GPT 报告 §6.

### 6.3 验证结果

```text
pnpm -r typecheck                                                → 10 包全绿
pnpm -r build                                                    → 10 包全绿
pnpm --filter @nano-agent/workspace-context-artifacts test       → 170 passed（含 Kimi R3 新增 7 cases）
pnpm --filter @nano-agent/eval-observability test                → 196 passed（Kimi R2 / R4 修改纳入）
node --test test/a6-gate.test.mjs                                → 3/3 passed（含 Kimi R6 新增 optional-smoke case）
npm run test:cross                                               → 67/67 passed (14 e2e + 53 contract suites)
```

六条 finding 全部落地；R3 从 "A8 前置条件" 升级为 "本轮即完成"，不再需要作为跨 phase 跟踪项。

### 6.4 对 Kimi 审查报告的评价

- **报告切入角度**：Kimi 的六条 finding 覆盖了「runtime correctness（R1 / R4）+ 代码质量 / 可维护性（R2 / R5）+ delivery gap（R3）+ 测试覆盖缺口（R6）」四种维度，这是 after-skeleton 系列六轮 review 里最全面的一次。R3 被标 `high` 并明确建议作为 "A8 前置条件" —— 这种「给出强信号但不强推阻塞本轮」的立场是资深 reviewer 对 phase 流水线尊重感的体现；我在收到建议后选择直接在本轮完成，因为 fix 范围正好和 GPT R4 重叠，边际成本很低。
- **证据链质量**：每条 finding 都有文件:行号 + 可复核命令。R1 的 `l2-real-provider.smoke.ts:125-130` 对比 `deploy-smoke-l2.json:23` 两行代码就把漂移锁死，无需解释。R2 的冗余三元表达式直接粘源码段，读一眼就懂。R3 "grep 全仓未发现 `ContextAssembler.assemble()` 等真实业务入口调用这些 emitters" 是典型「负面事实取证」，比「应该接入 runtime」的断言强得多。R6 的 "`gate.ts:78-86` 的 verdict 计算循环只遍历 `requiredIds`" 精确指向实现细节，测试补丁可以针对这行 loop 写断言。
- **严重级别判断**：R1 medium / R2 low / R3 high / R4 low / R5 low / R6 low —— 完美反映了每条 finding 的阻塞性。特别 R2 作为「功能正确但会误导后续 reviewer」的 low 级 finding 不强行升级，R3 作为「最大 delivery gap」又不 hijack approve-with-followups 结论，这种分级克制是我在系列 review 里最欣赏 Kimi 的特质之一。
- **与 GPT 的互补性**：Kimi R1 + GPT R3 共同锁定 L2 contract 漂移（从不同角度）；Kimi R3 + GPT R4 共同指出 emitter 未接 runtime（Kimi 更温和、GPT 更绝对）。R2 / R4 / R5 / R6 四条是 Kimi 独有的、GPT 完全未提的细节——尤其 R4「timeline 重建顾虑」这种长期风险，GPT 的 runtime-enforcement 视角看不到；R6「未来加 optional smoke 时 gate 可能意外破坏」是防御性测试的典型价值。
- **修复边界建议**：Kimi 对 R3 明确建议 "可作为 non-blocking follow-up 进入下一迭代，但必须在 A8 启动前完成"；对 R5 "应逐步收紧"；对 R6 "补测试" —— 每条都给出了明确的 fix 路径和紧迫度判断。实现者因此可以直接按这份 shopping list 逐个 fix 而不需要反推优先级。
- **综合评价**：报告质量顶级。六条 finding 覆盖面广、分级精准、证据硬度高、修复建议明确。是一份 approve-grade 审查工作的范本。

### 6.5 实现者收口判断（仅针对 Kimi 报告维度）

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. R3 的 emitter wiring 只在 workspace-context-artifacts 包内 closure；DO-side consumption（`NanoSessionDO` 如何 new + wire 这三个对象）仍属 A8+ 工作。
  2. R5 的 `HarnessEnvOverrides` 只覆盖当前 5 个字段；当 `SessionRuntimeEnv` 新增字段且 smoke 需要覆盖时，需主动扩这个接口（而不是加 `as never`）。这是刻意收紧的设计，与 review 建议方向一致。
  3. R1 的 L2 real-cloud 现在严格按 contract 检查，即便 reviewer 拿到 `OPENAI_API_KEY` 也会 RED —— 因为 Worker composition profile 的 `provider: "local"` 尚未被 A8+ 升级，provider 实际不会跑。review 一致这是 "honest current state"，不是 regression。

请 Kimi 按 §7 二次审查模板复核；若 R3 的 3 个 emitter wiring + 7 个 e2e cases 被验证有效，R1/R2/R4/R5/R6 的 docs+code 修复措辞可接受，则 Kimi 侧 review 可直接收口。
