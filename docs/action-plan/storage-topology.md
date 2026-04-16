# Nano-Agent 行动计划 — Storage Topology

> 服务业务簇: `Storage Semantics`
> 计划对象: `@nano-agent/storage-topology` — nano-agent 的 hot / warm / cold 数据分层、key schema 与 promotion/demotion 规则层
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/storage-topology/`（独立 repo，位于 `packages/` 下）
> 关联设计 / 调研文档:
> - `docs/design/storage-topology-by-opus.md`
> - `docs/design/session-do-runtime-by-opus.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `docs/design/eval-observability-by-opus.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/action-plan/workspace-context-artifacts.md`
> - `docs/action-plan/eval-observability.md`
> - `docs/action-plan/session-do-runtime.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/investigation/plan-after-nacp-reviewed-by-GPT-to-opus.md`
> - `docs/plan-after-nacp.md`
> - `README.md`
> - 参考代码：`packages/nacp-core/`、`packages/nacp-session/`、`context/codex/codex-rs/rollout/`、`context/claude-code/utils/sessionStorage.ts`、`context/mini-agent/mini_agent/logger.py`
> 文档状态: `draft`

---

## 0. 执行背景与目标

`storage-topology` 不该是“先拍一个数据库 schema”，而应是 **runtime evidence 之后再收敛的 storage semantics layer**。  
这一点已经被 `plan-after-nacp.md` 与后续 review 明确钉死：在 nano-agent 里，**DO / KV / R2 的职责必须建立在真实读写模式与可观测证据之上，而不是先验想象上**。

同时，当前代码 reality 也已经给出了几个不可绕开的事实：

1. `NacpRefSchema` 当前要求 `ref.key` 必须满足 `tenants/{team_uuid}/...`
2. `tenantR2* / tenantKv* / tenantDoStorage*` helpers 当前都只支持 tenant-scoped key
3. `nacp-session` 已经把 replay checkpoint shape 固定为 `nacp_session:replay` 与 `nacp_session:stream_seqs`
4. `eval-observability` 已经被规划为输出 `StoragePlacementLog` 与 evidence helpers，负责反向校准 placement

所以这份 action-plan 的目标，不是直接冻结“小文件阈值”“checkpoint 必含哪些 inline workspace file”等实现细节，而是先落下一个独立的 storage semantics package，负责：

1. hot / warm / cold 分类语言
2. storage key / ref builder / namespace contract
3. provisional placement hypotheses
4. checkpoint / archive / promotion / demotion 的候选 contract
5. evidence-backed calibration seam

- **服务业务簇**：`Storage Semantics`
- **计划对象**：`@nano-agent/storage-topology`
- **本次计划解决的问题**：
  - nano-agent 已经明确会用 DO / KV / R2，但还没有一份与代码 reality 对齐的 storage semantics layer
  - `workspace-context-artifacts`、`session-do-runtime`、`eval-observability` 需要共享同一套 key/ref/placement 语言
  - 若现在直接写死 threshold / checkpoint 物理 shape，会比 runtime evidence 走得更快
  - registry / transcript / archive / artifact / config 的分层若没有统一 contract，后续 DDL 与实现会持续互相打架
- **本次计划的直接产出**：
  - `packages/storage-topology/` 独立包骨架
  - `StorageClass / StorageKeyBuilder / RefBuilder / PlacementHypothesis / CheckpointCandidate / PromotionPlan / DemotionPlan` 类型与接口
  - 对齐 `NacpRefSchema` 与 `tenant*` scoped-io reality 的 key/ref builders
  - provisional placement hypotheses、checkpoint/archive candidate contract、evidence calibration seam
  - 可供 `session-do-runtime` / `workspace-context-artifacts` / `eval-observability` 直接消费的 constants 与 helper

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **5 个 Phase**，执行策略是 **“先 storage taxonomy 与 code reality，再 key/ref builders，再 provisional placement 与 checkpoint/archive 候选 contract，最后接 evidence calibration 与测试收口”**。  
`storage-topology` 的最大风险，不是漏了哪张表，而是过早把“可能成立的 placement”写成“必须如此的实现”。所以这份 plan 会刻意把 **候选 / provisional / 待校准** 写进结构本身，而不是用口头提醒替代。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 包骨架与 Storage Taxonomy | M | 建立独立包，冻结 hot/warm/cold 语义、data class 与 evidence vocabulary | `-` |
| Phase 2 | Key Schema / Ref Builders / Scoped I/O Alignment | L | 落 key builders、`NacpRef` builders，并与 `tenant*` helpers reality 对齐 | Phase 1 |
| Phase 3 | Provisional Placement / Checkpoint / Archive Contracts | L | 定义候选 placement、checkpoint candidate、promotion/demotion/archive plan | Phase 1, Phase 2 |
| Phase 4 | Evidence Calibration / Policy Seams | M | 接 `StoragePlacementLog` 与 evidence helpers，建立校准与再评估机制 | Phase 1-3 |
| Phase 5 | Fixtures / 文档 / 收口 | M | 用 fake evidence / fake scoped storage 场景验证 contract，并同步文档 | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — 包骨架与 Storage Taxonomy**
   - **核心目标**：建立独立包，冻结 storage classes、data categories、evidence vocabulary 与 provisional marker 类型。
   - **为什么先做**：没有统一 vocabulary，key/ref/placement 讨论会持续跨文档漂移。
2. **Phase 2 — Key Schema / Ref Builders / Scoped I/O Alignment**
   - **核心目标**：让所有 key schema、`NacpRef` 构造与 tenant-scoped reality 对齐，并暴露统一 helper。
   - **为什么放在这里**：key/ref builders 是 topology 真正落地的第一层，不先做会继续散落在 runtime 包里。
3. **Phase 3 — Provisional Placement / Checkpoint / Archive Contracts**
   - **核心目标**：把 placement hypotheses、checkpoint candidate、archive/promotion/demotion plan 正式写成 contract，但仍保持 provisional。
   - **为什么放在这里**：只有 key/ref reality 稳定后，候选 placement 才能有一致语言。
4. **Phase 4 — Evidence Calibration / Policy Seams**
   - **核心目标**：把 `eval-observability` 输出的 evidence 接回来，形成“何时重评”的机制，而不是只写口头承诺。
   - **为什么放在这里**：storage-topology 之所以成立，核心就在 evidence-backed calibration。
5. **Phase 5 — Fixtures / 文档 / 收口**
   - **核心目标**：验证 builders / provisional policies / calibration seam，并明确 v1 不支持项。
   - **为什么放在这里**：如果不能被 runtime 和 observability 共同消费，这份 topology 计划就只是 PPT。

### 1.4 执行策略说明

- **执行顺序原则**：`taxonomy -> key/ref builders -> provisional placement/checkpoint -> evidence calibration -> fixtures/docs`
- **风险控制原则**：不提前冻结小文件阈值、workspace inline 策略、archive 物理编排与 D1 引入；所有 placement 都带 provisional 或 revisit 条件
- **测试推进原则**：先测 key/ref/builders，再测 placement candidate / checkpoint/archive contracts，最后用 fake evidence 做 calibration 场景
- **文档同步原则**：实现时同步回填 `storage-topology-by-opus.md`、`session-do-runtime-by-opus.md`、`eval-observability-by-opus.md`、`workspace-context-artifacts-by-GPT.md`

### 1.5 本次 action-plan 影响目录树

```text
packages/storage-topology/
├── src/
│   ├── version.ts
│   ├── taxonomy.ts
│   ├── data-items.ts
│   ├── keys.ts
│   ├── refs.ts
│   ├── placement.ts
│   ├── checkpoint-candidate.ts
│   ├── archive-plan.ts
│   ├── promotion-plan.ts
│   ├── demotion-plan.ts
│   ├── calibration.ts
│   ├── evidence.ts
│   ├── adapters/
│   │   └── scoped-io.ts
│   └── index.ts
├── test/
│   ├── taxonomy.test.ts
│   ├── keys.test.ts
│   ├── refs.test.ts
│   ├── placement.test.ts
│   ├── checkpoint-candidate.test.ts
│   ├── calibration.test.ts
│   └── integration/
│       ├── scoped-io-alignment.test.ts
│       ├── placement-evidence-revisit.test.ts
│       └── checkpoint-archive-contract.test.ts
├── scripts/
│   ├── export-schema.ts
│   └── gen-placement-doc.ts
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/storage-topology` 独立包骨架
- **[S2]** `StorageClass / DataItemClass / PlacementHypothesis / CalibrationHint / EvidenceSignal` 类型体系
- **[S3]** hot / warm / cold 语义与 per-data-item category vocabulary
- **[S4]** 集中的 storage key builders：DO / KV / R2 key schema constants 与 factory
- **[S5]** `NacpRef` builders：至少覆盖 `r2` / `kv` / `do-storage` 三类实际 v1 target
- **[S6]** 与 `tenantR2* / tenantKv* / tenantDoStorage*` reality 对齐的 adapter helpers
- **[S7]** provisional placement hypotheses：session state / replay / audit / transcript / workspace / config / artifacts / registry snapshot 等候选归属
- **[S8]** checkpoint candidate contract：候选字段集与 fragment 边界，而不是最终 frozen shape
- **[S9]** archive / promotion / demotion plan contracts：触发条件、candidate key、responsible runtime seam
- **[S10]** evidence calibration seam：消费 `StoragePlacementLog` / usage evidence / size distribution / read-write frequency
- **[S11]** README、公开导出、schema/doc 生成脚本与 fixture tests

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** D1 DDL / SQL schema / structured query layer
- **[O2]** production archive scheduler / lifecycle management 本体
- **[O3]** Analytics Engine / APM / billing pipeline
- **[O4]** 最终强绑定的小文件阈值与 workspace inline 策略
- **[O5]** 在本包里直接实现完整 R2 / KV / DO runtime storage operations orchestration
- **[O6]** 改写 `NacpRefSchema` 现有语义或提前引入新的 ref kind usage（如 `d1`）
- **[O7]** 跨区域复制、合规删除、TTL 策略
- **[O8]** 平台级 `_platform/` key 例外的最终实现冻结

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| `tenants/{team_uuid}/...` 作为当前 key/ref truth | `in-scope` | 这已被 `NacpRefSchema` 与 `tenant*` helpers 写死 | 默认不重评 |
| `r2 / kv / do-storage` ref builders | `in-scope` | 这是 v1 已能真实落地的 storage classes | 默认不重评 |
| `_platform/` 直接前缀例外 | `defer / depends-on-decision` | 当前代码 reality 仍是 tenant-scoped builders，平台全局键需单独 owner 决策与代码修订 | 需要平台全局配置时 |
| 小文件 inline 阈值 | `defer / depends-on-decision` | 需要由 eval evidence 校准，不能先写死 | workspace/eval 落地后 |
| D1 usage | `out-of-scope` | README 当前未承诺 D1 进入 v1 运行时 | evidence 证明 scan/query 不够时 |
| archive 物理编排 | `out-of-scope` | Session runtime 只触发 seam，不在 topology 包里直接完成 | session-do-runtime + eval 收口时 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出独立 storage-topology package | low |
| P1-02 | Phase 1 | taxonomy / data classes | `add` | `src/taxonomy.ts`、`src/data-items.ts` | 冻结 storage semantics vocabulary | high |
| P1-03 | Phase 1 | evidence vocabulary | `add` | `src/evidence.ts` | 为 calibration 建立统一信号语言 | medium |
| P2-01 | Phase 2 | key builders | `add` | `src/keys.ts` | 统一所有 storage key schema | high |
| P2-02 | Phase 2 | ref builders | `add` | `src/refs.ts` | 统一 `NacpRef` 构造与 validation-friendly shape | high |
| P2-03 | Phase 2 | scoped-io alignment adapters | `add` | `src/adapters/scoped-io.ts` | 与 `tenant*` helpers reality 对齐 | medium |
| P3-01 | Phase 3 | placement hypotheses | `add` | `src/placement.ts` | 把 provisional placement 写成显式 contract | high |
| P3-02 | Phase 3 | checkpoint candidate | `add` | `src/checkpoint-candidate.ts` | 候选 checkpoint fragment 不再散落 | high |
| P3-03 | Phase 3 | archive/promotion/demotion plans | `add` | `src/archive-plan.ts`、`src/promotion-plan.ts`、`src/demotion-plan.ts` | 触发条件与责任归属收口 | medium |
| P4-01 | Phase 4 | calibration rules | `add` | `src/calibration.ts` | evidence 能触发 placement 再评估 | high |
| P4-02 | Phase 4 | runtime integration seams | `add` | `src/placement.ts`、`src/evidence.ts` | session/workspace/eval 能共用 topology contract | medium |
| P5-01 | Phase 5 | fixture tests | `add` | `test/*.test.ts`、`test/integration/*.test.ts` | builders 与 provisional policy 可稳定回归 | medium |
| P5-02 | Phase 5 | schema / placement doc scripts | `add` | `scripts/export-schema.ts`、`scripts/gen-placement-doc.ts` | 生成可审阅的 topology 输出 | low |
| P5-03 | Phase 5 | 文档与导出面 | `update` | `README.md`、`src/index.ts` | 下游可直接复用 topology helpers | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 包骨架与 Storage Taxonomy

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 参照现有 `packages/*` 约定建立独立 storage-topology package | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 包可 `build/typecheck/test` | 基础命令校验 | 多仓约定稳定 |
| P1-02 | taxonomy / data classes | 定义 hot/warm/cold、data item class、provisional marker、responsible runtime vocabulary | `src/taxonomy.ts`、`src/data-items.ts` | 各文稿共享同一 storage semantics 语言 | 类型测试 / taxonomy 单测 | 不再靠 prose 临时描述 |
| P1-03 | evidence vocabulary | 定义 size/read/write/access-pattern/evidence 信号结构 | `src/evidence.ts` | calibration seam 有统一输入 | 单测 | 后续 calibration 不再自造字段 |

### 4.2 Phase 2 — Key Schema / Ref Builders / Scoped I/O Alignment

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | key builders | 建立 DO/KV/R2 key builders 与 constants，默认遵循 `tenants/{team_uuid}/...` | `src/keys.ts` | key schema 不再散落在各 runtime | keys 单测 | 与现有 code reality 一致 |
| P2-02 | ref builders | 基于 `NacpRefSchema` 语义提供 `r2/kv/do-storage` builders | `src/refs.ts` | refs 可统一构造并被下游消费 | refs 单测 | 不再手写 ref 对象 |
| P2-03 | scoped-io alignment adapters | 对齐 `tenantR2* / tenantKv* / tenantDoStorage*` 的调用约束与路径生成 | `src/adapters/scoped-io.ts` | topology builder 与 tenancy reality 能直接接线 | integration fixture | 不绕过 tenant-scoped I/O 约束 |

### 4.3 Phase 3 — Provisional Placement / Checkpoint / Archive Contracts

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | placement hypotheses | 把 session state / replay / audit / transcript / workspace / config / artifacts 等 placement 写成 provisional contract | `src/placement.ts` | placement 不再只是表格描述 | placement 单测 | 每项均带 provisional / revisit 信息 |
| P3-02 | checkpoint candidate | 定义候选 checkpoint fragment 与“不确定字段”标记 | `src/checkpoint-candidate.ts` | Session runtime 可依赖同一 candidate contract | checkpoint 单测 | 不提前冻结 workspace inline shape |
| P3-03 | archive/promotion/demotion plans | 定义 candidate archive key、promotion path、demotion trigger 与 responsible runtime seam | `src/archive-plan.ts`、`src/promotion-plan.ts`、`src/demotion-plan.ts` | archive 行为不再隐式 | 单测 | 触发条件与执行责任清楚 |

### 4.4 Phase 4 — Evidence Calibration / Policy Seams

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | calibration rules | 接 `StoragePlacementLog`、size/read-write 证据，定义何时重评 hypothesis | `src/calibration.ts` | topology 真正具备 evidence-backed 调整能力 | calibration 单测 | 重评条件不再停留在文档口头说明 |
| P4-02 | runtime integration seams | 暴露给 session/workspace/eval 的 candidate-policy / evidence APIs | `src/placement.ts`、`src/evidence.ts` | 下游包可共用同一 contract | fixture test | runtime/eval/topology 之间接线稳定 |

### 4.5 Phase 5 — Fixtures / 文档 / 收口

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | fixture tests | 跑通 scoped-io alignment、placement evidence revisit、checkpoint/archive contract 场景 | `test/*.test.ts`、`test/integration/*.test.ts` | topology helpers 与 provisional policy 可回归 | 集成测试 | 关键语义不漂移 |
| P5-02 | schema / placement doc scripts | 导出 schema 与 placement 文档 | `scripts/export-schema.ts`、`scripts/gen-placement-doc.ts` | topology 输出可审阅 | 脚本测试 | 生成物稳定 |
| P5-03 | 文档与导出面 | 完成 README、public exports、限制说明 | `README.md`、`src/index.ts` | session/workspace/eval/runtime 可直接复用 | 文档校验 | 支持/不支持边界明确 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 包骨架与 Storage Taxonomy

- **Phase 目标**：冻结 storage semantics 的最小语言层。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/storage-topology/src/taxonomy.ts`
  - `packages/storage-topology/src/data-items.ts`
  - `packages/storage-topology/src/evidence.ts`
- **本 Phase 修改文件**：
  - `packages/storage-topology/package.json`
  - `packages/storage-topology/README.md`
- **具体功能预期**：
  1. hot/warm/cold 与 data item class 成为统一 vocabulary。
  2. provisional / evidence-backed / revisit 等标记进入类型层，而不是文档备注。
  3. `eval-observability` 输出的 evidence 能拥有统一输入 shape。
- **具体测试安排**：
  - **单测**：taxonomy、data-items、evidence types
  - **集成测试**：无
  - **回归测试**：taxonomy matrix 快照
  - **手动验证**：对照 `plan-after-nacp.md` 的“证据后收敛”原则
- **收口标准**：
  - storage semantics vocabulary 稳定
  - 下游文稿不再需要各自重新定义 hot/warm/cold
  - package skeleton 与多仓约定稳定
- **本 Phase 风险提醒**：
  - 若 vocabulary 不清，后续 key/ref/placement 会继续跨文档漂移

### 5.2 Phase 2 — Key Schema / Ref Builders / Scoped I/O Alignment

- **Phase 目标**：把 storage semantics 接到当前代码 reality 上。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
- **本 Phase 新增文件**：
  - `packages/storage-topology/src/keys.ts`
  - `packages/storage-topology/src/refs.ts`
  - `packages/storage-topology/src/adapters/scoped-io.ts`
- **具体功能预期**：
  1. key builders 默认遵循 `tenants/{team_uuid}/...` reality。
  2. `NacpRef` 构造统一通过 builder 完成，而非散落对象字面量。
  3. topology package 与 `tenant*` scoped-io helper 对齐，不绕开 tenancy 规则。
- **具体测试安排**：
  - **单测**：keys、refs、adapter helpers
  - **集成测试**：scoped-io alignment fixture
  - **回归测试**：ref.key prefix 与 builder 输出快照
  - **手动验证**：对照 `packages/nacp-core/src/envelope.ts` 与 `scoped-io.ts`
- **收口标准**：
  - key/ref builders 可直接被 session/workspace/eval 消费
  - 不再手写 magic strings
  - 不与当前 code reality 打架
- **本 Phase 风险提醒**：
  - 若此处偷渡 `_platform/` 例外，会与当前 builders / schema 直接冲突

### 5.3 Phase 3 — Provisional Placement / Checkpoint / Archive Contracts

- **Phase 目标**：把候选 placement 变成显式 contract，而不是提前定案。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `packages/storage-topology/src/placement.ts`
  - `packages/storage-topology/src/checkpoint-candidate.ts`
  - `packages/storage-topology/src/archive-plan.ts`
  - `packages/storage-topology/src/promotion-plan.ts`
  - `packages/storage-topology/src/demotion-plan.ts`
- **具体功能预期**：
  1. placement 对每个 data item 都明确写出 provisional / revisit 条件。
  2. checkpoint candidate 只定义候选字段集与 fragment 边界，不提前冻结 inline workspace 策略。
  3. archive/promotion/demotion 只定义 candidate contract 与 runtime responsibility，不直接决定物理编排。
- **具体测试安排**：
  - **单测**：placement、checkpoint candidate、archive/promotion/demotion plans
  - **集成测试**：checkpoint-archive contract fixture
  - **回归测试**：provisional marker 与 revisit policy 快照
  - **手动验证**：对照 `plan-after-nacp-reviewed-by-GPT-to-opus.md` 对过早冻结的批评
- **收口标准**：
  - 所有 placement 都带 evidence-backed revisit 条件
  - checkpoint candidate 不替 workspace/runtime 提前拍板
  - archive responsibility 与 physical strategy 明确切开
- **本 Phase 风险提醒**：
  - 若 placement 写成最终定案，会再次违背整个 post-NACP 规划原则

### 5.4 Phase 4 — Evidence Calibration / Policy Seams

- **Phase 目标**：把“证据后收敛”真正写进可执行 seam。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
- **本 Phase 新增文件**：
  - `packages/storage-topology/src/calibration.ts`
- **本 Phase 修改文件**：
  - `packages/storage-topology/src/placement.ts`
  - `packages/storage-topology/src/evidence.ts`
- **具体功能预期**：
  1. `StoragePlacementLog`、size/read-write frequency、resume hit ratio 等证据可触发 topology re-evaluation。
  2. calibration rules 可输出“维持现状 / 调整阈值 / 改变建议归属”的 recommendation。
  3. session/workspace/eval/runtime 都可通过同一 seam 提交 evidence 与读取 candidate policy。
- **具体测试安排**：
  - **单测**：calibration rules
  - **集成测试**：placement-evidence-revisit scenario
  - **回归测试**：阈值建议与 revisit 条件快照
  - **手动验证**：对照 `eval-observability` action-plan 的 `StoragePlacementLog`
- **收口标准**：
  - topology 具备 evidence-backed 调整能力
  - 重评条件不再停留在 prose
  - 不把 observability 反向绑定成 topology 内部实现
- **本 Phase 风险提醒**：
  - calibration 若过强，会反向成为“隐式自动迁移器”；v1 只应给建议与契约，不自动搬运数据

### 5.5 Phase 5 — Fixtures / 文档 / 收口

- **Phase 目标**：证明 topology package 能被其他 runtime 包真正复用。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/storage-topology/test/integration/scoped-io-alignment.test.ts`
  - `packages/storage-topology/test/integration/placement-evidence-revisit.test.ts`
  - `packages/storage-topology/scripts/export-schema.ts`
  - `packages/storage-topology/scripts/gen-placement-doc.ts`
- **本 Phase 修改文件**：
  - `packages/storage-topology/README.md`
  - `packages/storage-topology/src/index.ts`
- **具体功能预期**：
  1. key/ref/builders、placement hypotheses、checkpoint/archive candidates 可稳定回归。
  2. README 清晰说明“这是 storage semantics layer，不是 deploy/storage runtime 本体”。
  3. 生成文档可供 session/workspace/eval/runtime 直接引用。
- **具体测试安排**：
  - **单测**：补齐未覆盖模块
  - **集成测试**：scoped-io alignment、checkpoint/archive candidate、evidence revisit
  - **回归测试**：placement doc 与 schema 输出快照
  - **手动验证**：检查与 `session-do-runtime` / `eval-observability` / `workspace-context-artifacts` 的引用一致性
- **收口标准**：
  - topology package 可独立 build/typecheck/test
  - 下游 runtime 包可直接复用其 builders / candidate contracts
  - 文档能明确说明 provisional 与 evidence-backed 边界
- **本 Phase 风险提醒**：
  - 若 README 不强调 provisional 性质，后续 implementation 容易把候选策略误当最终定案

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2 / future platform config`
- **为什么必须确认**：当前 `NacpRefSchema` 与 `tenant*` helpers 都要求 tenant-scoped key；如果 v1 就需要 platform-global key，需要显式修改现有 code reality。
- **当前建议 / 倾向**：`v1 先保持所有 topology builders tenant-scoped；platform-global `_platform` 例外留作单独 follow-up，不在本包先默认成立`
- **Q**：`v1 是否接受 storage-topology 先只支持 tenant-scoped key/ref reality，把 platform-global `_platform` 例外留到后续单独决策？`
- **A**：通过阅读 `docs/investigation/action-plan-qna-clarification-batch-1.md` 后，业主表示同意采取推荐措施：`v1 的 storage-topology 先只支持 tenant-scoped key/ref reality；platform-global \`_platform\` 例外留到后续单独决策与扩展。`

#### Q2

- **影响范围**：`Phase 3 / workspace / session runtime`
- **为什么必须确认**：workspace 小文件是否 inline 到 DO checkpoint，会直接改变 checkpoint candidate 与 restore 策略。
- **当前建议 / 倾向**：`不在 storage-topology v1 冻结固定阈值；先把“small inline candidate”写成 provisional hypothesis，由 eval evidence 校准`
- **Q**：`v1 是否同意不冻结 workspace 小文件 inline 阈值，而只保留 provisional hypothesis + revisit 条件？`
- **A**：可以，但一定需要有 mime_type 的门禁实现。

#### Q3

- **影响范围**：`Phase 3 / Phase 4 / session-do-runtime / eval-observability`
- **为什么必须确认**：archive 的最终物理编排与 flush 责任若不切开，topology package 会重新吞入 deploy/runtime 逻辑。
- **当前建议 / 倾向**：`storage-topology 只定义 candidate archive plan 与 key builders；session-do-runtime 负责触发 seam；eval-observability 负责提供 evidence；最终物理 archive 编排后续再冻结`
- **Q**：`v1 是否同意将 archive 责任切分为“topology 定义 plan、session runtime 触发、observability 提供 evidence、最终物理编排延后冻结”？`
- **A**：同意物理 archieve 的后移。但必须要在代码中留够上下文。用于后续回顾。在后续轮次再进行决策。

### 6.2 问题整理建议

- 优先冻结 tenant-scoped reality 与 provisional threshold 立场
- 不把 D1 / billing / analytics 之类远期诉求混进 v1 topology contract
- owner 决策要同步回填到 `session-do-runtime`、`workspace-context-artifacts` 与 `eval-observability`

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| placement 提前定案 | 会让 workspace/session runtime 被 topology 反向绑死 | high | 所有策略显式标记 provisional 与 revisit 条件 |
| key/ref reality 与代码不一致 | builder 若偏离 `NacpRefSchema` / `tenant*` helpers 会直接失效 | high | Phase 2 先对齐现有 code reality，再谈扩展 |
| `_platform` 例外偷渡 | 当前代码尚未正式支持 | medium | 保持 defer / depends-on-decision，单独问 owner |
| checkpoint candidate 过宽 | 会把 workspace/turn history 物理策略提前冻结 | high | 只定义 candidate fragment，不写死 inline 阈值 |
| calibration 只停留在文档 | “证据后收敛”会重新沦为空话 | high | Phase 4 把 evidence → revisit 规则写成显式 seam |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / Durable Objects / KV / R2 / TypeScript；当前 code reality 以 tenant-scoped keys 与 `NacpRef` 为准
- **运行时前提**：storage-topology 是 semantics/policy layer，不是最终 deploy/storage runtime；真正的 archive/restore 执行由 session/workspace runtime 触发
- **组织协作前提**：`packages/*` 为独立 repo；`@nano-agent/storage-topology` 作为库供 session-do-runtime、workspace-context-artifacts、eval-observability 复用
- **上线 / 合并前提**：不得把 provisional placement 写成无条件定案；不得抢跑 D1 / archive 物理编排；不得违反 `NacpRefSchema` 与 tenant-scoped I/O 现有约束

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/storage-topology-by-opus.md`
  - `docs/design/session-do-runtime-by-opus.md`
  - `docs/design/eval-observability-by-opus.md`
- 需要同步更新的说明文档 / README：
  - `README.md`
  - `packages/storage-topology/README.md`
- 需要同步更新的测试说明：
  - `packages/storage-topology/test/README.md`（如创建）

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `packages/storage-topology` 可独立 `build/typecheck/test`
  - schema/doc 脚本可稳定输出
- **单元测试**：
  - taxonomy、keys、refs、placement hypotheses、checkpoint/archive/promotion/demotion plans、calibration rules
- **集成测试**：
  - scoped-io alignment
  - placement evidence revisit
  - checkpoint/archive candidate contracts
- **端到端 / 手动验证**：
  - 用 fake session/workspace/eval evidence 构造一次 placement review
  - 检查 `session-do-runtime` 与 `workspace-context-artifacts` 对 builders 的消费
- **回归测试**：
  - key schema / ref builder 快照
  - provisional marker / revisit policy 快照
  - placement doc 生成物快照
- **文档校验**：
  - README、action-plan、design 文稿中的 storage semantics 说法一致

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/storage-topology` 已形成独立 package 骨架与稳定导出面
2. hot/warm/cold taxonomy、key/ref builders、placement hypotheses、checkpoint/archive candidate contracts 已被实现
3. `NacpRefSchema` 与 tenant-scoped I/O reality 已被正确复用，而不是被文档假定覆盖
4. evidence-backed calibration seam 已能驱动 placement 重评，而不是只停留在口头原则
5. topology package 可被 session/workspace/eval runtime 直接消费而不反向绑死它们的实现

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | storage-topology 已具备 taxonomy、key/ref builders、provisional placement、checkpoint/archive candidates 与 calibration seam |
| 测试 | builders、candidate contracts、evidence revisit 与 scoped-io 对齐场景均可稳定回归 |
| 文档 | action-plan、README、placement doc、相关设计文稿同步完成 |
| 风险收敛 | topology 不再提前冻结实现细节，也不再与现有 code reality 冲突 |
| 可交付性 | 包可被 session-do-runtime、workspace-context-artifacts、eval-observability 直接复用 |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **建立 nano-agent 的 storage semantics layer** 为第一优先级，采用 **先 taxonomy 与 code reality、再 key/ref builders、后 provisional placement/checkpoint/archive candidates 与 evidence calibration 收口** 的推进方式，优先解决 **DO / KV / R2 到底如何被同一套语言描述、如何与现有 `NacpRef` 与 tenant-scoped I/O 现实对齐、如何把“证据后收敛”真正写成 contract**，并把 **不提前冻结小文件阈值、不抢跑 D1、不把 archive 物理编排偷塞进 topology 包** 作为主要约束。整个计划完成后，`Storage Topology` 应达到 **能够为 session runtime、workspace runtime 与 observability 提供一致的 placement / key / ref / checkpoint 语言** 的程度，从而为后续真正的 storage implementation 与 registry / DDL 收敛提供可靠基础。
