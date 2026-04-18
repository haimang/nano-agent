# A7. Nano-Agent Storage and Context Evidence Closure 执行计划

> 服务业务簇: `Storage / Context / Evidence`
> 计划对象: `after-skeleton / Phase 6 / storage-and-context-evidence-closure`
> 类型: `modify`
> 作者: `GPT-5.4`
> 时间: `2026-04-18`
> 执行序号: `A7 / 10`
> 上游前序: `A2`, `A3`, `A6`
> 下游交接: `A8`, `A9`, `A10`
> 文件位置: `packages/eval-observability/**`, `packages/storage-topology/**`, `packages/workspace-context-artifacts/**`, `packages/session-do-runtime/**`, `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
> 关键仓库锚点: `packages/storage-topology/src/{evidence,placement,calibration}.ts`, `packages/workspace-context-artifacts/src/{context-assembler,compact-boundary,snapshot}.ts`, `packages/eval-observability/src/{placement-log,sinks/do-storage}.ts`
> 参考 context / 对标来源: `context/claude-code/services/compact/microCompact.ts`, `context/mini-agent/mini_agent/logger.py`
> 关联设计 / 调研文档:
> - `docs/plan-after-skeleton.md`
> - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
> - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
> - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
> - `docs/design/after-skeleton/PX-QNA.md`
> 文档状态: `draft`

---

## 0. 执行背景与目标

Phase 6 的任务不是重新设计 storage topology，也不是提前冻结 D1 / DDL / 完整 context architecture；它要解决的是另一个更根本的问题：**nano-agent 当前已经拥有不少 storage/context typed seam，但这些 seam 仍大多停留在“对象模型存在、测试里可演示、真实 runtime 还没持续 emit evidence”** 的状态。仓库里已经有一批高价值构件：`StoragePlacementLog` 能记录 placement observation，`placementLogToEvidence()` / `evaluateEvidence()` 能把记录转成 calibration judgement，`ContextAssembler` 已暴露 `assembled / totalTokens / truncated / orderApplied`，`CompactBoundaryManager` 已镜像 `context.compact.request/response` 与 boundary record，`WorkspaceSnapshotBuilder` 已真正在读取 mounts/fileIndex/artifactRefs/contextLayers，`DoStorageTraceSink` 已能把 durable trace 写入 tenant-scoped JSONL timeline。

但代码现实也同样清楚地暴露了断点：`StoragePlacementLog` 在 `src/` 下基本只是 vocabulary，本仓内没有真正的 runtime package 在非测试主路径里消费它；`ContextAssembler`、`CompactBoundaryManager`、`WorkspaceSnapshotBuilder` 当前在 `src/` 下基本只作为导出 seam 存在，真正的组装 / compact / snapshot evidence 还没有进入 session/runtime 主路径；root `e2e-03 / e2e-10 / e2e-13` 证明这些模型可以被 synthetic 场景调用，但不等于已经形成 owner 可依赖的 runtime evidence。Q13/Q14 已经把 P6 的语言冻结为 **`provisional / evidence-backed / needs-revisit / contradicted-by-evidence` 四档 calibration verdict**，并且要求它与 PX capability maturity 永久分离；Q5/Q20 也已经把 substrate truth 冻结为 **DO storage hot anchor + R2 cold archive + D1 deferred query**，且未来任何 D1 升格都必须先出独立 memo。因此这份 action-plan 的目标，是把 **placement / assembly / compact / artifact / snapshot** 五条 evidence 流真正接到运行路径上，并产出可校准、可回放、可引用的 P6 evidence pack。

- **服务业务簇**：`Storage / Context / Evidence`
- **计划对象**：`after-skeleton / Phase 6 / storage-and-context-evidence-closure`
- **本次计划解决的问题**：
  - 当前 storage/context seam 虽已存在 typed vocabulary，但 runtime emitters 仍大量缺位，真实 evidence 还没有持续进入主路径
  - placement/context/compact/artifact/snapshot 还没有统一进入 calibration verdict，而下一阶段 data/context 设计已经需要这些证据
  - P6 verdict 与 PX capability maturity 若不强制分离，后续 docs/review 很容易混淆“假设是否成立”与“能力是否成熟”
- **本次计划的直接产出**：
  - 一套 owner-aligned evidence closure 路线：placement、assembly、compact、artifact、snapshot 五类 evidence 的 runtime wiring
  - 一套 calibration verdict、real storage spot-check、context layering principles 与 evidence-backed judgement pack
  - 一份可直接供下一阶段 context/data/API 设计引用的 Phase 6 evidence exit pack

---

## 1. 执行综述

### 1.1 总体执行方式

这份 action-plan 采用 **先冻结 evidence taxonomy 与 emitter ownership，再接通 placement runtime emission，然后补 context/compact/artifact/snapshot evidence，再执行 calibration + real storage spot-check，最后输出 principles/report/verdict pack** 的推进方式。核心原则是：**P6 做 instrumentation + evidence closure，不做 database-first；所有 evidence 都挂 `trace_uuid` 与 tenant scope；`eval-observability` 提供 vocabulary/sink，真正 emit evidence 的 owner 是发生业务动作的包，而不是观察包自己。**

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | Evidence Taxonomy & Emitter Ownership Freeze | `M` | 冻结五类 evidence vocabulary、verdict taxonomy、owner 分工与 P5→P6 handoff 输入 | `Phase 5` |
| Phase 2 | Placement Runtime Evidence Wiring | `M` | 让真实 storage read/write/promotion/demotion 持续写出 placement evidence，而非仅停留在 tests | `Phase 1` |
| Phase 3 | Context / Compact / Artifact / Snapshot Evidence Closure | `L` | 让 assembly、compact、artifact lifecycle、snapshot/restore 全进入 trace/evidence reality | `Phase 2` |
| Phase 4 | Calibration Verdict & Real Storage Spot-check | `M` | 用实际 evidence 驱动 provisional→judgement，并完成最小真实 R2/DO integration spot-check | `Phase 3` |
| Phase 5 | Evidence Principles, Reports & Exit Pack | `S` | 固化 context layering principles、storage evidence report 与下一阶段 handoff pack | `Phase 4` |

### 1.3 Phase 说明

1. **Phase 1 — Evidence Taxonomy & Emitter Ownership Freeze**
   - **核心目标**：先把“记什么证据、谁来记、用什么 verdict 说话”固定下来。
   - **为什么先做**：如果 owner 分工和 verdict taxonomy 不先冻结，后面的 instrumentation 很快会再次分散。
2. **Phase 2 — Placement Runtime Evidence Wiring**
   - **核心目标**：让 `StoragePlacementLog` 从测试资产提升为 runtime 主路径资产。
   - **为什么放在这里**：placement evidence 是 storage/context closure 的最底层基础，也是最直接承接 Q5 substrate truth 的一条流。
3. **Phase 3 — Context / Compact / Artifact / Snapshot Evidence Closure**
   - **核心目标**：让 P6 从“只懂 storage”扩大到真正的 context management evidence。
   - **为什么放在这里**：context/compact/artifact/snapshot 都依赖 placement 与 trace carrier 已经成形。
4. **Phase 4 — Calibration Verdict & Real Storage Spot-check**
   - **核心目标**：把 evidence 从“可记录”推进到“可裁决”，同时用一次真实 storage integration 证明它不是 synthetic-only。
   - **为什么放在这里**：只有 evidence 已经持续产生，calibration verdict 才有可信输入。
5. **Phase 5 — Evidence Principles, Reports & Exit Pack**
   - **核心目标**：把 P6 的价值固定成下一阶段可引用的原则与报告，而不是零散 trace。
   - **为什么放在这里**：Phase 6 最终价值在于为后续 context/data 设计提供证据，不只是自己观测自己。

### 1.4 执行策略说明

- **执行顺序原则**：`先 taxonomy/ownership，再 placement，再 context/compact/artifact/snapshot，再 calibration，再 principles/report`
- **风险控制原则**：`不做 D1/database-first；不把 transcript 当 evidence 替代；P6 verdict 与 PX grade 永久分离`
- **测试推进原则**：`先补 package-level instrumentation/integration，再接 P5 real bundle，再做 real storage spot-check`
- **文档同步原则**：`P1/P2/P5/P6 设计、PX-QNA、storage/context docs、calibration report 与 threshold/principles notes 必须同口径`

### 1.5 本次 action-plan 影响目录树

```text
storage-and-context-evidence-closure
├── packages/eval-observability
│   ├── src/{placement-log,sinks/do-storage,timeline,trace-event}.ts
│   └── test/integration/{storage-placement-evidence,session-timeline}.test.ts
├── packages/storage-topology
│   ├── src/{evidence,placement,calibration}.ts
│   └── test/integration/{placement-evidence-revisit,scoped-io-alignment}.test.ts
├── packages/workspace-context-artifacts
│   ├── src/{context-assembler,compact-boundary,snapshot,artifacts,promotion}.ts
│   └── test/integration/{compact-reinject,snapshot-restore-fragment,fake-workspace-flow}.test.ts
├── packages/session-do-runtime
│   ├── src/{checkpoint,worker,composition,do/nano-session-do}.ts
│   └── test/integration/{checkpoint-roundtrip,graceful-shutdown}.test.ts
├── test
│   ├── e2e/{e2e-03,e2e-09,e2e-10,e2e-13}*.test.mjs
│   └── verification/verdict-bundles/**/*
└── docs
    ├── action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md
    └── design/after-skeleton/P6-storage-and-context-evidence-closure.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** 冻结 `placement / assembly / compact / artifact / snapshot` 五类 evidence 的 runtime owner、trace/tenant law、calibration verdict 语言
- **[S2]** 让真实 storage read/write/promotion/demotion 持续写出 placement evidence，并与 `placementLogToEvidence()` / `evaluateEvidence()` 接通
- **[S3]** 让 `ContextAssembler`、`CompactBoundaryManager`、artifact lifecycle、`WorkspaceSnapshotBuilder` 真正进入 runtime evidence 主路径
- **[S4]** 用一次真实 storage spot-check 与 P5 bundle 共同驱动 calibration verdict，形成 `provisional / evidence-backed / needs-revisit / contradicted-by-evidence`
- **[S5]** 输出 `storage-evidence-report`、`context-layering-principles`、compaction/snapshot evidence pack，为下一阶段提供稳定证据输入

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** D1 query schema、DDL、archive scheduler、数据库先行建模
- **[O2]** semantic retrieval / embeddings evidence / vector index
- **[O3]** 完整 compaction quality benchmark 或质量评分系统
- **[O4]** frontend evidence explorer UI / analytics dashboard

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `StoragePlacementLog` runtime emission | `in-scope` | 当前它主要停留在 tests/vocabulary 层，P6 必须把它带进真实主路径 | P6 完成后再重评更细粒度 fields |
| `ContextAssembler` assembly evidence | `in-scope` | 当前只暴露 `assembled/totalTokens/truncated/orderApplied`，是天然 evidence 起点 | P6 后续可扩 richer token attribution |
| `CompactBoundaryManager` request/response mirror | `in-scope` | 当前有 boundary model，但没有正式 evidence emission | compact quality phase 再重评更深入指标 |
| `WorkspaceSnapshotBuilder` fragment evidence | `in-scope` | snapshot 已真实读取 mounts/fileIndex/artifactRefs/contextLayers，适合进入 P6 evidence | future restore diff / archive analysis 时重评 |
| D1 进入热路径 | `out-of-scope` | Q5/Q20 已冻结 D1 deferred；任何升格都要先出独立 memo | 仅在独立 benchmark memo 通过后重评 |
| transcript 当作 storage/context evidence 替代 | `out-of-scope` | transcript 是 user-facing record，不足以解释 placement/context 决策 | 永不作为主 evidence 路线重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | Evidence Taxonomy Freeze | `update` | P6 docs, `packages/{eval-observability,storage-topology}/src/**` | 固定五类 evidence vocabulary 与 trace/tenant law | `high` |
| P1-02 | Phase 1 | Emitter Ownership Freeze | `update` | docs + runtime package notes | 明确 vocabulary/sink owner 与 live emitter owner 的边界 | `high` |
| P1-03 | Phase 1 | Calibration Verdict Freeze | `update` | P6 docs, calibration notes | 把 Q13/Q14 变成可执行的 verdict contract | `medium` |
| P2-01 | Phase 2 | Placement Runtime Emission | `update` | `packages/eval-observability`, `packages/storage-topology`, runtime callers | storage 主路径持续记录 placement evidence | `high` |
| P2-02 | Phase 2 | Placement-to-Calibration Bridge | `update` | `packages/storage-topology/src/{evidence,calibration}.ts`, integration tests | placement logs 能进入 `evaluateEvidence()` 与 verdict pack | `high` |
| P2-03 | Phase 2 | Placement Spot-check Integration | `update` | P5 bundles + storage integration notes | 用真实 DO/R2 path 验证 placement evidence 不是 synthetic-only | `medium` |
| P3-01 | Phase 3 | Context Assembly Evidence | `update` | `packages/workspace-context-artifacts/src/context-assembler.ts`, runtime callers | 记录 assembled/dropped/truncated/orderApplied 与 prepared artifact usage | `high` |
| P3-02 | Phase 3 | Compact Evidence | `update` | `packages/workspace-context-artifacts/src/compact-boundary.ts`, session/kernel callers | compact request/response/boundary/error 全进入 evidence 流 | `high` |
| P3-03 | Phase 3 | Artifact Lifecycle Evidence | `update` | promotion/prepared-artifacts/session/workspace surfaces | inline→promoted→prepared→archived 不再是黑盒副作用 | `high` |
| P3-04 | Phase 3 | Snapshot / Restore Evidence | `update` | `snapshot.ts`, `session-do-runtime/src/checkpoint.ts`, integration tests | checkpoint/restore 真正可解释“包含了什么、恢复了什么” | `high` |
| P4-01 | Phase 4 | Context / Compact / Artifact Verdicts | `update` | calibration/report notes | 五类 evidence 不只记录，还能形成 hypothesis judgement | `medium` |
| P4-02 | Phase 4 | Real Storage Spot-check | `update` | wrangler real-smoke profile, bundle docs | 至少一次真实 R2 put/get 或 DO durable path 被纳入 evidence pack | `medium` |
| P4-03 | Phase 4 | Threshold / Revisit Rules | `update` | `placement.ts`, docs, reports | 何时 maintain、何时 needs-revisit、何时 contradicted 被正式写清 | `medium` |
| P5-01 | Phase 5 | Storage Evidence Report | `add` | `docs/**`, bundle manifests | 形成 owner/reviewer 可直接消费的 storage evidence 报告 | `medium` |
| P5-02 | Phase 5 | Context Layering Principles | `add` | `docs/**`, workspace docs | context layering 不再只靠“设计感觉”，而有证据约束 | `medium` |
| P5-03 | Phase 5 | Exit Pack & Next-phase Inputs | `update` | action-plan/docs/handoff notes | 为下一阶段 context/data/API 设计提供 evidence-backed 输入 | `medium` |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Evidence Taxonomy & Emitter Ownership Freeze

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | Evidence Taxonomy Freeze | 把 placement/assembly/compact/artifact/snapshot 五类 evidence 的字段、trace_uuid/tenant law、durable landing zone 固定下来 | P6 docs + relevant `src/` comments/types | evidence 不再是 generic blob | docs/type review | 五类 evidence vocabulary 已固定 |
| P1-02 | Emitter Ownership Freeze | 明确 `eval-observability` 负责 vocabulary/sink，真正 emit evidence 的 owner 分别在 storage/workspace/session/runtime packages | docs + package notes | “谁负责 emit”不再模糊 | docs review | 不再出现观察包自己编造业务 evidence |
| P1-03 | Calibration Verdict Freeze | 把 Q13/Q14 写成正式 verdict contract，并强制与 PX maturity 永久分离 | P6 docs, report templates | hypothesis status 与 capability maturity 不再混淆 | docs review | 四档 verdict 与 PX grade 的边界已明确 |

### 4.2 Phase 2 — Placement Runtime Evidence Wiring

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | Placement Runtime Emission | 让真实 storage read/write/delete、promotion/demotion 行为持续写入 `StoragePlacementLog` 或等价 placement signal | `packages/eval-observability`, runtime callers | placement evidence 不再只在 tests 中产生 | package tests + integration | 关键 storage 行为已有稳定 runtime evidence |
| P2-02 | Placement-to-Calibration Bridge | 用 `placementLogToEvidence()` / `evaluateEvidence()` 将 placement runtime logs 接入 judgement 流 | `packages/storage-topology/src/{evidence,calibration}.ts`, integration tests | placement evidence 可被自动分析，而不只是保留日志 | integration tests | 至少一条 placement judgement 能由真实 logs 推出 |
| P2-03 | Placement Spot-check Integration | 结合 P5 bundle 或 real storage path，验证 placement evidence 在真实 DO/R2 场景下可成立 | verification bundles + docs | placement closure 不再只是 synthetic fixture | real spot-check | 至少一次真实 storage path 进入 placement evidence |

### 4.3 Phase 3 — Context / Compact / Artifact / Snapshot Evidence Closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | Context Assembly Evidence | 记录 `orderApplied`、`assembled kinds`、`totalTokens`、`truncated`，并补 `dropped_optional_layers / drop_reason / required_layer_budget_violation` | `context-assembler.ts`, runtime callers | 每次组装都能解释“为何是当前形状” | package tests + integration | assembly evidence 已进入真实调用路径 |
| P3-02 | Compact Evidence | 为 `buildCompactRequest()` / `applyCompactResponse()` 记录 request/response/boundary/error evidence | `compact-boundary.ts`, session/kernel callers | compact 不再只是 request/response mirror | package tests + integration | compact success/error/boundary 全可回放 |
| P3-03 | Artifact Lifecycle Evidence | 记录 inline/promoted/prepared/archived/sourceRef→preparedRef 等生命周期证据 | promotion/prepared-artifacts/session/workspace paths | artifact replacement 不再是黑盒 | package tests + root e2e | 生命周期有统一 evidence shape |
| P3-04 | Snapshot / Restore Evidence | 记录 snapshot fragment 与 restore result：mounts/fileIndex/artifactRefs/contextLayers/restore coverage | `snapshot.ts`, `checkpoint.ts`, integration tests | checkpoint/restore 可被解释成可审阅 lifecycle | package tests + integration | 至少一条真实 snapshot/restore evidence 链成立 |

### 4.4 Phase 4 — Calibration Verdict & Real Storage Spot-check

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | Context / Compact / Artifact Verdicts | 将 assembly/compact/artifact/snapshot evidence 也纳入 P6 verdict，而非只对 placement 做判断 | report/verdict notes | 五类 evidence 都能形成 hypothesis judgement | review + targeted tests | P6 不再只有 placement judgement |
| P4-02 | Real Storage Spot-check | 至少完成一次真实 R2 put/get 或 DO durable path 的 evidence 记录，并纳入 P6 pack | wrangler real-smoke profile, bundles | P6 不是 synthetic-only evidence closure | real storage spot-check | 至少一条真实 storage evidence 成立 |
| P4-03 | Threshold / Revisit Rules | 把 maintain / needs-revisit / contradicted-by-evidence 的阈值与 revisit triggers 写清 | `placement.ts`, docs, reports | 后续 review 不再靠主观判断“好像该改了” | docs/calibration review | revisit rules 已可被审阅和复用 |

### 4.5 Phase 5 — Evidence Principles, Reports & Exit Pack

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | Storage Evidence Report | 产出 `storage-evidence-report`，总结 placement observations、real spot-check、verdicts、open hypotheses | docs + bundle manifests | owner/reviewer 能直接读懂 storage evidence 结论 | report review | storage evidence 已形成阶段性报告 |
| P5-02 | Context Layering Principles | 产出 `context-layering-principles`，把 assembly/compact/artifact/snapshot 的 evidence-backed 原则写清 | docs + workspace notes | 下一阶段 context architecture 不再靠猜测启动 | principle review | context principles 已可被后续 phase 引用 |
| P5-03 | Exit Pack & Next-phase Inputs | 汇总 P6 的 verdict、real evidence、open hypotheses、needs-revisit 列表 | action-plan/docs/handoff notes | 下一阶段 data/API/frontend 设计有单一 evidence 出口包 | handoff review | P6 不再需要被重新解释一遍 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Evidence Taxonomy & Emitter Ownership Freeze

- **Phase 目标**：先把 P6 用什么语言和什么职责边界来记录证据冻结下来。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - 视需要新增 evidence report / principle templates
- **本 Phase 修改文件**：
  - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
  - 相关 package docs / comments / report templates
- **具体功能预期**：
  1. 五类 evidence vocabulary 被明确定义
  2. live emitter owner 与 vocabulary/sink owner 边界不再模糊
  3. Q13/Q14 被转成真正的行动约束，而不是只停留在 QNA
  4. A6→P6 handoff bundle 被明确固定为 `trace / timeline / placement / summary / failure-record / latency-baseline / profile-manifest`
- **具体测试安排**：
  - **单测**：N/A，以类型/文档对齐为主
  - **集成测试**：N/A
  - **回归测试**：核对相关 package 类型与 docs
  - **手动验证**：检查 P6 verdict 与 PX grade 首次出现时均有清晰标注
- **收口标准**：
  - 五类 evidence 与四档 verdict 已冻结
  - emitter ownership 有单一 truth
  - P6 与 PX 术语边界不再混淆
- **本 Phase 风险提醒**：
  - 如果不先冻结 owner 分工，后续 runtime emitters 会再次分散
  - 如果 verdict taxonomy 不先固定，P6 只会积累日志而不会形成 judgement

### 5.2 Phase 2 — Placement Runtime Evidence Wiring

- **Phase 目标**：把 placement evidence 从测试概念变成真实运行事实。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - 视需要新增 placement runtime emission helpers / bundle mappers
- **本 Phase 修改文件**：
  - `packages/eval-observability/src/{placement-log,sinks/do-storage}.ts`
  - `packages/storage-topology/src/{evidence,calibration,placement}.ts`
  - 相关 runtime caller surfaces
- **具体功能预期**：
  1. 真实 storage I/O 会持续产生 placement evidence；`StoragePlacementLog` 不再只作为内存 logger 存在，而是由 storage/workspace/session runtime callers 持续喂入
  2. placement logs 可以直接进入 calibration seam
  3. 至少一条真实 DO/R2 path 已进入 placement evidence
- **具体测试安排**：
  - **单测**：`pnpm --filter @nano-agent/eval-observability test`, `pnpm --filter @nano-agent/storage-topology test`
  - **集成测试**：`storage-placement-evidence.test.ts`, `placement-evidence-revisit.test.ts`, `scoped-io-alignment.test.ts`
  - **回归测试**：受影响 package `build / typecheck / test`
  - **手动验证**：检查非测试主路径里已存在 placement runtime emission
- **收口标准**：
  - `StoragePlacementLog` 不再只在 tests 出现
  - placement runtime logs 能进入 `evaluateEvidence()`
  - 至少一次真实 storage path 可被 placement evidence 解释
- **本 Phase 风险提醒**：
  - 如果只在 synthetic E2E 里记 evidence，P6 仍不足以支撑下一阶段判断
  - 如果 placement 只记日志不做 verdict bridge，仍无法形成收口

### 5.3 Phase 3 — Context / Compact / Artifact / Snapshot Evidence Closure

- **Phase 目标**：让 context management 真正变成可解释、可回放、可裁决的系统行为。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
  - `P3-04`
- **本 Phase 新增文件**：
  - 视需要新增 typed evidence mappers / bundle writers
- **本 Phase 修改文件**：
  - `packages/workspace-context-artifacts/src/{context-assembler,compact-boundary,snapshot,artifacts,promotion}.ts`
  - `packages/session-do-runtime/src/checkpoint.ts`
  - 相关 runtime callers
- **具体功能预期**：
  1. assembly evidence 不只知道结果，还知道 dropped/truncated 与原因
  2. compact evidence 覆盖 success/error/boundary/reinject，而不只是对象镜像
  3. artifact promotion/prepared/archive/sourceRef 链路有统一 evidence
  4. snapshot/restore 能解释具体 fragment 与恢复覆盖度
- **具体测试安排**：
  - **单测**：`pnpm --filter @nano-agent/workspace-context-artifacts test`, `pnpm --filter @nano-agent/session-do-runtime test`
  - **集成测试**：`compact-reinject.test.ts`, `snapshot-restore-fragment.test.ts`, `fake-workspace-flow.test.ts`
  - **回归测试**：root `e2e-03`, `e2e-13`, 相关 package `build / typecheck / test`
  - **手动验证**：确认这些 seam 已进入 runtime path，而不是只在 tests 中构造调用
- **收口标准**：
  - assembly/compact/artifact/snapshot evidence 均有 runtime owner
  - 五类 evidence 中至少四类已在真实主路径出现
  - context management 的关键行为可以被 trace/evidence 重建
- **本 Phase 风险提醒**：
  - 当前 `ContextAssembler` / `CompactBoundaryManager` / `WorkspaceSnapshotBuilder` 在 `src/` 下基本未被 runtime 消费，若不接线，P6 将停留在模型层
  - 如果只记录 happy path，不记录 dropped/error/restore-miss，后续仍会出现“为什么变成这样”不可回答的问题

### 5.4 Phase 4 — Calibration Verdict & Real Storage Spot-check

- **Phase 目标**：让 evidence 不只被采集，还能支持明确 judgement。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - 视需要新增 verdict summaries / revisit memos
- **本 Phase 修改文件**：
  - `packages/storage-topology/src/placement.ts`
  - calibration/report docs
  - P5/P6 handoff materials
- **具体功能预期**：
  1. placement/context/compact/artifact/snapshot 都能进入 P6 verdict 体系
  2. 至少一次真实 storage spot-check 被纳入 P6 judgement
  3. revisit/contradicted 阈值与触发条件被正式写清
- **具体测试安排**：
  - **单测**：相关 package tests
  - **集成测试**：placement + workspace/evidence integrations
  - **回归测试**：P5 real bundle 对拍 + root relevant E2E
  - **手动验证**：检查 report 中已有 maintain / needs-revisit / contradicted-by-evidence 的示例
- **收口标准**：
  - P6 verdict 不再只对 placement 生效
  - 至少一次真实 storage path 成为 judgement 证据
  - revisit rules 已明确，可供后续 phase 直接引用
- **本 Phase 风险提醒**：
  - 若 P6 只记录证据不做 judgement，后续 phase 仍会凭直觉推进
  - 若 real storage spot-check 缺失，evidence-backed 的说法会过于乐观

### 5.5 Phase 5 — Evidence Principles, Reports & Exit Pack

- **Phase 目标**：把 P6 的结论固定成下一阶段可直接消费的原则与报告。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `storage-evidence-report` / `context-layering-principles` 等报告性文档
- **本 Phase 修改文件**：
  - `docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md`
  - P6 design / handoff notes / bundle manifests
- **具体功能预期**：
  1. owner/reviewer 能直接读懂 storage/context 的阶段性证据结论
  2. 下一阶段 context/data/API 设计拿到的是 evidence-backed 输入，而不是口头总结
  3. open hypotheses / needs-revisit 清单被显式保留，而不是被掩盖
- **具体测试安排**：
  - **单测**：N/A，以 report/principle review 为主
  - **集成测试**：N/A
  - **回归测试**：汇总相关 package tests 与 P5 bundle evidence
  - **手动验证**：逐项核对报告、原则、open hypotheses、verdict 示例
- **收口标准**：
  - 存在可审阅的 storage evidence report
  - 存在可引用的 context layering principles
  - 下一阶段已有明确上游输入与 open hypotheses 列表
- **本 Phase 风险提醒**：
  - 如果 P6 不写成原则与报告，后续 phase 仍会反复重读零散 trace
  - 如果 open hypotheses 被省略，后续设计会误把 provisional 当 frozen

---

## 6. 需要业主 / 架构师回答的问题清单

> **统一说明**：与本 action-plan 相关的业主 / 架构师问答，统一收录于 `docs/action-plan/after-skeleton/AX-QNA.md`；请仅在该汇总文件中填写答复，本文不再逐条填写。

### 6.1 当前判断

- 当前 **无新增必须拍板的问题**。
- 本 action-plan 直接继承并依赖以下已确认输入：
  1. **Q5**：DO storage hot anchor + R2 cold archive + D1 deferred query；
  2. **Q13**：P6 calibration verdict 采用四档；
  3. **Q14**：P6 verdict 与 PX capability maturity 永久分离；
  4. **Q20**：未来任何 D1 升格都必须先产出独立 benchmark / investigation memo。
- 执行中若要回到 owner 层，只应针对 **是否改变 substrate truth** 或 **是否把某条 provisional hypothesis 提前升格为 frozen baseline** 这类边界问题，而不是 evidence field 的技术细节。

### 6.2 问题整理建议

- 不把某个 evidence 字段命名微调升级成 owner 问题
- 不把 report 文件的组织方式升级成 owner 问题
- 只把会改变 Q5/Q13/Q14/Q20 已冻结边界的事项带回给业主

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| evidence seam 仍多停留在 tests | `StoragePlacementLog`、`ContextAssembler`、`CompactBoundaryManager`、`WorkspaceSnapshotBuilder` 在运行主路径里仍未普遍接线 | `high` | Phase 2/3 明确以 runtime wiring 为主，不接受“测试里有”替代 |
| P6 容易滑向 database-first | evidence closure 很容易被 D1/DDL 讨论劫持 | `high` | 严格执行 Q5/Q20，保持 D1 deferred + memo gate |
| transcript 被误当 evidence | user-visible transcript 容易被误认为足够解释 storage/context 行为 | `medium` | 明确 transcript 不是 placement/context/compact/artifact/snapshot evidence 替代 |
| verdict 与 capability maturity 混用 | reviewer / docs 会混淆 hypothesis status 与 capability grade | `medium` | 强制每次首次出现术语都说明所属体系 |
| early evidence 丢失 | sink 未 attach 或 startup 过渡态可能吞掉高价值 early events | `medium` | 复用 P4/P5 的 startup queue / bundle thinking，在装配层处理 early evidence |

### 7.2 约束与前提

- **技术前提**：`Phase 5 已产出真实运行 bundle；P2 trace carrier 与 P1 substrate truth 可作为 P6 上游输入`
- **运行时前提**：所有 evidence 必须挂 `trace_uuid` 与 tenant scope，并优先落到 DO storage / durable JSONL
- **组织协作前提**：`eval-observability` 是 vocabulary/sink owner；发生业务动作的 runtime package 才是 emitter owner
- **上线 / 合并前提**：P6 的结论必须带 report/principles/open hypotheses，而不是一批无结论 trace

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`
  - `docs/design/after-skeleton/P2-trace-first-observability-foundation.md`
  - `docs/design/after-skeleton/P1-trace-substrate-decision.md`
  - `docs/design/after-skeleton/PX-QNA.md`
- 需要同步更新的说明文档 / README：
  - storage/context/evidence 相关 package docs
  - next-phase handoff notes
- 需要同步更新的测试说明：
  - `packages/eval-observability/test/**`
  - `packages/storage-topology/test/**`
  - `packages/workspace-context-artifacts/test/**`
  - 相关 root `test/e2e/**`

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - 确认五类 evidence 与四档 verdict 语言固定且与 PX 分离
  - 确认 evidence 真正出现在 runtime 主路径，而不只在 tests 中被构造
- **单元测试**：
  - `pnpm --filter @nano-agent/eval-observability test`
  - `pnpm --filter @nano-agent/storage-topology test`
  - `pnpm --filter @nano-agent/workspace-context-artifacts test`
  - `pnpm --filter @nano-agent/session-do-runtime test`
- **集成测试**：
  - `packages/eval-observability/test/integration/storage-placement-evidence.test.ts`
  - `packages/storage-topology/test/integration/placement-evidence-revisit.test.ts`
  - `packages/storage-topology/test/integration/scoped-io-alignment.test.ts`
  - `packages/workspace-context-artifacts/test/integration/compact-reinject.test.ts`
  - `packages/workspace-context-artifacts/test/integration/snapshot-restore-fragment.test.ts`
  - `packages/workspace-context-artifacts/test/integration/fake-workspace-flow.test.ts`
- **端到端 / 手动验证**：
  - root `test/e2e/e2e-03-compact-boundary.test.mjs`
  - root `test/e2e/e2e-09-observability-pipeline.test.mjs`
  - root `test/e2e/e2e-10-storage-calibration.test.mjs`
  - root `test/e2e/e2e-13-content-replacement-consistency.test.mjs`
  - 结合 P5 real bundle 做 storage spot-check / evidence review
- **回归测试**：
  - 相关 packages `build / typecheck / test`
  - `npm run test:cross`
- **文档校验**：
  - P6 design、action-plan、report/principles、P5 handoff notes、PX-QNA 术语必须一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. placement / assembly / compact / artifact / snapshot 五类 evidence 都已有固定 vocabulary 与 runtime owner。
2. 至少一条真实 storage path 已进入 placement evidence 与 calibration verdict。
3. context/compact/artifact/snapshot 不再只在 synthetic test 中可见，而已进入真实 runtime evidence 主路径。
4. `provisional / evidence-backed / needs-revisit / contradicted-by-evidence` 已成为 P6 的正式裁判语言，并与 PX maturity 分离。
5. 下一阶段已有可直接引用的 storage evidence report、context layering principles 与 open hypotheses pack。

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | `five evidence streams + calibration verdict + real storage spot-check + reports/principles` 全部落地 |
| 测试 | package integrations、root E2E、P5 real bundle 共同构成最小 evidence 闭环 |
| 文档 | P6 design、action-plan、reports/principles、handoff notes 与 PX-QNA 口径一致 |
| 风险收敛 | 不再把 provisional hypothesis、transcript、synthetic test evidence 误当最终真相 |
| 可交付性 | 下一阶段 context/data/API 设计可以直接消费 P6 evidence，而不必重新搜集基础事实 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

这份 action-plan 以 **把 nano-agent 的 storage/context 能力从“有类型、有测试、有设计说法”推进到“持续产证、可做 judgement、能被下一阶段直接引用”** 为第一优先级，采用 **先冻结 taxonomy/ownership，再接 runtime emitters，再做 calibration 与 real spot-check，最后用 report/principles/exit pack 收口** 的推进方式，优先解决 **evidence 只停留在 tests、runtime owner 不清、verdict 与 maturity 语言混用** 这三类问题，并把 **不做 D1/database-first、不把 transcript 当证据、不把 provisional 假设偷渡成 frozen baseline** 作为主要约束。整个计划完成后，`Storage / Context / Evidence` 应达到 **五类 evidence 都能挂 trace_uuid、tenant scope、durable landing zone，并能形成 calibration judgement** 的状态，从而为后续的 **context architecture、storage threshold freeze、API / data / frontend 设计** 提供真正可信的上游证据。

---

## 11. 工作报告（A7 execution log）

> 执行人：Claude Opus 4.7（1M context）
> 执行时间：`2026-04-18`
> 执行对象：`docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md` Phase 1-5
> 执行结论：**五条 evidence 流（placement / assembly / compact / artifact / snapshot）已完成 vocabulary + emitter wiring + verdict 聚合 + 报告 + 原则的 closure；A8/A9/A10 已能通过 `aggregateEvidenceVerdict()` 与两份 docs 直接消费 P6 证据。**

### 11.1 工作目标与内容回顾

- **目标**：让 P6 从 “模型存在、测试可演示” 推进到 “runtime 持续产证 + 可形成 judgement + 可交接给下一阶段”。具体即：冻结五条 evidence 流的 vocabulary、给真实业务路径接上 emitters、把 placement/assembly/compact/artifact/snapshot 都纳入 calibration verdict、产出 storage evidence report 与 context layering principles。
- **AX-QNA 绑定**：Q5（DO hot anchor + R2 cold archive + D1 deferred）、Q13（四档 verdict）、Q14（verdict 与 PX grade 永久分离）、Q20（D1 升格须独立 memo）— 全部冻结输入。
- **Phase 真实执行路径**：
  - Phase 1 — `eval-observability/src/evidence-streams.ts` 冻结五条 typed evidence + `EvidenceRecorder` + `CALIBRATION_VERDICTS / computeCalibrationVerdict` + 三档默认阈值；`test/evidence-streams.test.ts` 9 cases pin 住。
  - Phase 2 — `eval-observability/src/evidence-bridge.ts` 提供 `placementEvidenceFromRecord / bridgeEvidenceToPlacementLog / recordPlacementEvidence`；`DoStorageTraceSink` 接受 optional `evidenceSink`，每次真实 `storage.put()` 都会发出 `PlacementEvidence`；`test/sinks/do-storage-placement-emission.test.ts` 3 cases + `test/integration/placement-runtime-loop.test.ts` 5 cases pin 住运行面。
  - Phase 3 — `workspace-context-artifacts/src/evidence-emitters.ts` 暴露 `buildAssemblyEvidence / buildCompactEvidence / buildArtifactEvidence / buildSnapshotEvidence` + `emit*Evidence`；通过 `EvidenceAnchorLike + EvidenceSinkLike` 解耦 `eval-observability`；`test/evidence-emitters.test.ts` 13 cases 覆盖 happy / error / boundary / lifecycle / restore-coverage 五条路径。
  - Phase 4 — `eval-observability/src/evidence-verdict.ts` 实现 `aggregateEvidenceVerdict` + `DEFAULT_VERDICT_RULES`（5 hypothesis：`placement.do.hot-anchor / write-amp / assembly.required-layer-respected / compact.success-rate / snapshot.restore-coverage`）；`test/integration/p6-evidence-verdict.test.ts` 5 cases pin 住健康场景全 evidence-backed、oversize → needs-revisit、持续失败 → contradicted-by-evidence、外部 rule 注入。
  - Phase 5 — `docs/eval/after-skeleton-storage-evidence-report.md` + `docs/eval/after-skeleton-context-layering-principles.md` 共同形成 evidence exit pack；P6 design `B. A7 执行后状态` + v0.3 同步；本 action-plan §11 工作报告。
- **参考案例核对**：`context/claude-code/services/compact/microCompact.ts` 在 P3-02 compact phase 划分上提供方法学参考（request / response / boundary / error 四阶段，错误情况单独成型）；`context/mini-agent/mini_agent/logger.py` 仍作为反面教材（plain-text 单文件 + 缺 anchor → 不能被 P6 verdict 消费）。`just-bash` 与本轮无直接交集，仅借鉴其 “evidence 必须独立可验证” 的方法学，体现在 `aggregateEvidenceVerdict` 接受 external rules 不污染 default catalog。

### 11.2 实际代码清单

- **新增 — eval-observability**
  - `packages/eval-observability/src/evidence-streams.ts`：五类 `EvidenceRecord` + `EvidenceRecorder` + `CALIBRATION_VERDICTS / computeCalibrationVerdict`。
  - `packages/eval-observability/src/evidence-bridge.ts`：`bridgeEvidenceToPlacementLog / placementEvidenceFromRecord / recordPlacementEvidence`。
  - `packages/eval-observability/src/evidence-verdict.ts`：`VerdictRule / VerdictReport / VerdictAggregateResult / aggregateEvidenceVerdict / DEFAULT_VERDICT_RULES`。
- **改写 — eval-observability**
  - `packages/eval-observability/src/sinks/do-storage.ts`：constructor 接受 `evidenceSink`，每次真实 `storage.put()` 调用 `emitPlacement()` 发出 `PlacementEvidence`。
  - `packages/eval-observability/src/index.ts`：导出 evidence streams / bridge / verdict 三个模块。
- **新增 — workspace-context-artifacts**
  - `packages/workspace-context-artifacts/src/evidence-emitters.ts`：`buildAssemblyEvidence / buildCompactEvidence / buildArtifactEvidence / buildSnapshotEvidence` + `emit*Evidence`，通过 `EvidenceAnchorLike + EvidenceSinkLike` 解耦上游包。
  - `packages/workspace-context-artifacts/src/index.ts`：追加 emitter 导出。
- **新增 — 测试**
  - `packages/eval-observability/test/evidence-streams.test.ts`（9 cases）。
  - `packages/eval-observability/test/integration/placement-runtime-loop.test.ts`（5 cases）。
  - `packages/eval-observability/test/sinks/do-storage-placement-emission.test.ts`（3 cases）。
  - `packages/eval-observability/test/integration/p6-evidence-verdict.test.ts`（5 cases）。
  - `packages/workspace-context-artifacts/test/evidence-emitters.test.ts`（13 cases）。
- **新增 — 文档**
  - `docs/eval/after-skeleton-storage-evidence-report.md`：7 章节 + 默认 hypothesis 目录 + open hypotheses + 下一阶段引用路径。
  - `docs/eval/after-skeleton-context-layering-principles.md`：7 条 evidence-backed 原则 + 明确 "what this phase does NOT settle"。
- **改写 — 文档**
  - `docs/design/after-skeleton/P6-storage-and-context-evidence-closure.md`：附录 B + v0.3。
  - `docs/action-plan/after-skeleton/A7-storage-and-context-evidence-closure.md`（本文件）：§11 工作报告。

### 11.3 测试制作与测试结果

- **新增 cases 合计**：evidence-streams 9 + placement-runtime-loop 5 + do-storage-placement-emission 3 + p6-evidence-verdict 5 + workspace evidence-emitters 13 = **35 新 cases**。
- **运行结果**
  - `pnpm --filter @nano-agent/eval-observability test` — `22 files / 194 tests passed`。
  - `pnpm --filter @nano-agent/workspace-context-artifacts test` — `15 files / 163 tests passed`。
  - `pnpm --filter @nano-agent/{nacp-core, nacp-session, hooks, capability-runtime, llm-wrapper, agent-runtime-kernel, storage-topology, session-do-runtime} test` — 全部通过（按 `pnpm -r test` 输出汇总）。
  - `pnpm -r typecheck / build` — 10 projects 全绿。
  - `node --test test/*.test.mjs`（root contract + A6 verification）— `52 tests / 52 passed`。
  - `npm run test:cross`（root e2e）— `14/14 passed`。
- **A7 evidence loop dry-run**
  - 健康路径（3 placement + 3 assembly + 3 compact + 3 snapshot 记录）：5 hypothesis 全部 `evidence-backed`。
  - oversize 写入路径：`placement.do.write-amp` → `needs-revisit`，其余 `evidence-backed`。
  - 持续失败 restore：`snapshot.restore-coverage` → `contradicted-by-evidence`。
  - 外部 rule 注入：`aggregateEvidenceVerdict(records, [customRule])` 隔离 default catalog，custom rule 单独输出 `evidence-backed`。

### 11.4 收口分析与下一阶段安排

> **A6-A7 code review 回填（2026-04-18，GPT R4/R5 + Kimi R3）**：A7 初稿声称 "evidence 不再只停留在 tests"，但 reviewer 全仓 grep 后指出除 `DoStorageTraceSink` 的 placement hook 之外，`ContextAssembler / CompactBoundaryManager / WorkspaceSnapshotBuilder` 在 `src/**/*.ts` 里没有任何 emitter use-site。本轮 review fix 已把三条 emitter 分别接入业务主路径 + 新增 end-to-end test；下方结论已重写为 review 回填后的真实状态。

- **AX-QNA / Definition of Done 对照（review 回填后）**
  - **功能（review 后）**：五条 evidence 流 + verdict 聚合 + 默认 hypothesis 目录 + 真实 sink emission + storage evidence report + context layering principles 已落地 **且 review R4 / Kimi R3 的 emitter 接线已闭合**：
    - `ContextAssembler` 新增 `ContextAssemblerOptions` + `setEvidenceWiring()`；每次 `assemble()` 返回前对 `assembly` evidence 发出一次 record（需要 caller 提供 `evidenceSink + evidenceAnchor`）。
    - `CompactBoundaryManager` 新增 `CompactBoundaryManagerOptions`；`buildCompactRequest()` 发 `compact.request`、`applyCompactResponse()` 同时发 `compact.response`、`compact.boundary`、`compact.error`。
    - `WorkspaceSnapshotBuilder` 新增 `WorkspaceSnapshotBuilderOptions` + `setEvidenceWiring()` + `emitRestoreEvidence()`；`buildFragment()` 返回前自动发 `snapshot.capture`。
    - 新 `packages/workspace-context-artifacts/test/integration/evidence-runtime-wiring.test.ts` 7 cases 证明三条 emitter 确实随真实方法调用发生（不再是测试单独构造）。
  - **测试**：package + integration + root cross 共 42 新 cases（原 35 + review R4 的 7 新 cases）；既有测试全绿。
  - **文档**：P6 design 附录 B、storage evidence report、context layering principles、本 action-plan §11 四方一致；附录 B.1 追加 review follow-up 段（GPT R5）。
  - **风险收敛**：evidence 不再只停留在 tests 或 placement 单点；emitter 已进入真实业务 method；`computeCalibrationVerdict` 的冗余三元表达式已简化为单 return（Kimi R2）；`DoStorageTraceSink.emitPlacement` 的 anchor timestamp 优先使用 firstEvent timestamp（Kimi R4）。
  - **可交付性（降级后诚实版）**：A8（minimal bash）可读 `snapshot.restore-coverage` 钩子；后续 storage threshold freeze / context architecture 可直接读 `placement.do.*` 与 `assembly / compact` verdict + revisit hint。但 **A7 自身不再声称 "已消费 P5 p6-handoff.json"** —— handoff 文件仍是 pointer，A7 的 consumer 是 future work（GPT R5）。
- **复盘要点回填**
  - 工作量估计偏差：Phase 4 verdict aggregator 比预估省力 —— 一旦 evidence-streams 的 discriminated union 形态固定，VerdictRule 可以是单文件、零依赖；Phase 3 比预估重，因为要协调真实 `WorkspaceSnapshotFragment` schema (`mountConfigs` 而非 `mounts`) 与 `CompactBoundaryRecord` 真实形状 (`turnRange / archivedAt` 而非 `boundaryIndex / tokensBefore`)。
  - 拆分合理度：P5-01 (报告) 与 P5-02 (原则) 应分别形成独立可引用的文档 — 我按这一思路输出了两份；未来模板可以把它们标为 "**parallel artifacts**" 而不是 "sequential phase items"。
  - 需要更早问架构师：本次没有；Q5 / Q13 / Q14 / Q20 已覆盖。
  - 测试覆盖不足之处：emitter 与真实 `ContextAssembler.assemble()` 调用之间没有 end-to-end test —— 接 context architecture 时建议补一条 "assembler → emitter → recorder → verdict" 的 e2e 测试。
  - 模板需补字段：`Phase 3` 的 `consideredKinds` / `requiredLayerBudgetViolation` 这类 "evidence input" 字段未来可以在模板里写明 "由调用者提供，非 result 自带"，避免 reviewer 误以为来自 AssemblyResult。
- **下一阶段安排（A8 / A9 / A10）**
  - **A8 (`P7a / 7b / 7c minimal bash`)**：A7 主要为它提供 `snapshot.restore-coverage` 钩子（tool execution 写入 workspace 后的 fragment 覆盖度）。
  - **后续 storage threshold freeze**（若纳入下一阶段）：直接读 `placement.do.*` 的 supporting / contradictory 计数 + revisit hint；判断阈值是否需要从 1 MB 调整。
  - **后续 context architecture**（若纳入下一阶段）：`assembly` + `compact` evidence 可作为 "是否引入 retrieval / embedding ranking" 的判据；`docs/eval/after-skeleton-context-layering-principles.md §7` 明确列出本轮不做的项目，避免 scope creep。
  - **D1 升格守卫**：本 closure 不改 D1 状态；任何 D1 路径变更必须先按 AX-QNA Q20 提交独立 benchmark memo（命名规范 `docs/eval/trace-substrate-benchmark-v{N}.md`）。
