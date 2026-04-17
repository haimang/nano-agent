# Storage Topology 代码审查 — by GPT

> 审查对象: `@nano-agent/storage-topology`
> 审查时间: `2026-04-17`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/storage-topology.md`
> - `docs/design/storage-topology-by-opus.md`
> - `README.md`
> - `docs/templates/code-review.md`
> - `docs/progress-report/mvp-wave-1.md`
> - `docs/progress-report/mvp-wave-2.md`
> - `docs/progress-report/mvp-wave-3.md`
> - `docs/progress-report/mvp-wave-4.md`
> - `packages/storage-topology/`
> - `packages/nacp-core/src/envelope.ts`
> - `packages/nacp-core/src/tenancy/scoped-io.ts`
> - `packages/eval-observability/src/placement-log.ts`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`该实现已经搭出了 storage semantics 的静态骨架，但当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `refs.ts` 与 `adapters/scoped-io.ts` 没有真正对齐 `@nano-agent/nacp-core` 的 `NacpRefSchema` 与 `tenant*` scoped-I/O reality；尤其 `do-storage` ref 当前在本包里被判定为合法，但直接对拍真实 schema 会失败。
  2. Phase 3 最关键的 `mime_type` 门禁和 checkpoint fragment boundary 没有进入类型/实现主路径，反而提前把 `1MB` 变成了硬编码阈值。
  3. Phase 4-5 的收口并未成立：calibration 没有真实消费 `StoragePlacementLog`，包内也没有 README / CHANGELOG / schema-doc scripts / integration fixtures。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/storage-topology.md`
  - `docs/design/storage-topology-by-opus.md`
  - `README.md`
  - `docs/templates/code-review.md`
  - `docs/progress-report/mvp-wave-{1,2,3,4}.md`
- **核查实现**：
  - `packages/storage-topology/src/*`
  - `packages/storage-topology/test/*`
  - `packages/nacp-core/src/envelope.ts`
  - `packages/nacp-core/src/tenancy/scoped-io.ts`
  - `packages/eval-observability/src/placement-log.ts`
- **执行过的验证**：
  - `cd /workspace/repo/nano-agent/packages/storage-topology && npm test`
  - `cd /workspace/repo/nano-agent/packages/storage-topology && npm run typecheck && npm run build`
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（直接把 `buildDoStorageRef()` 结果与 `NacpRefSchema` 对拍，并同时对比 `tenantDoStoragePut()` 的真实 key 形状）
  - `glob packages/storage-topology/{README.md,CHANGELOG.md,scripts/*.ts,test/integration/*.ts}`
  - `rg 'StoragePlacementLog|mime_type|NacpRefSchema|tenantR2|tenantKv|tenantDoStorage' packages/storage-topology/src`

### 1.1 已确认的正面事实

- `packages/storage-topology/` 已具备独立 package 结构，`taxonomy.ts`、`data-items.ts`、`keys.ts`、`refs.ts`、`placement.ts`、`checkpoint-candidate.ts`、`archive-plan.ts`、`promotion-plan.ts`、`demotion-plan.ts`、`calibration.ts`、`adapters/scoped-io.ts` 都已存在。
- 包本地验证通过：`npm test`、`npm run typecheck`、`npm run build` 全部成功；当前共 **5 个 test files / 59 tests** 全绿。
- `hot / warm / cold` taxonomy、`DATA_ITEM_CATALOG`、`PLACEMENT_HYPOTHESES`、`ARCHIVE_PLANS / PROMOTION_PLANS / DEMOTION_PLANS` 等基础 vocabulary 已经写出来了，说明作者并不是停留在 prose。
- 包的 public export 面存在，`src/index.ts` 已把当前主要 helpers 和 types 导出。

### 1.2 已确认的负面事实

- `packages/storage-topology/src/refs.ts:27-115` 定义的是本地 `StorageRef`，不是 `NacpRef`；其中 `validateRefKey()` 还明确对 `do-storage` 免除了 `tenants/{team_uuid}/...` 前缀要求。
- `packages/nacp-core/src/envelope.ts:193-208` 的真实 `NacpRefSchema` 对 **所有** ref 都要求 `ref.key.startsWith(\`tenants/${team_uuid}/\`)`；我直接用 `buildDoStorageRef("team-123", "session:phase")` 对拍，`safeParse(...).success === false`。
- `packages/nacp-core/src/tenancy/scoped-io.ts:123-145` 的 `tenantDoStoragePut/Get/Delete` 也会把 DO storage key 写成 `tenants/{team_uuid}/{relativePath}`；我实际调用后得到的 key 是 `tenants/team-123/session:phase`，与 `refs.ts` / `keys.ts` 的本地假设不一致。
- `packages/storage-topology/src/adapters/scoped-io.ts:27-45` 的 `ScopedStorageAdapter` 里，`doGet/doPut` 根本没有 `teamUuid` 参数，因此无法直接对齐 `tenantDoStorage*` reality。
- `packages/storage-topology/src/placement.ts:18-59` 与 `src/checkpoint-candidate.ts:13-82` 都没有任何 `mime_type` 决策结构；`rg` 整个 `src/` 后，`mime_type` 只在 `data-items.ts:159` 的字符串说明里出现一次。
- `packages/storage-topology/src/calibration.ts:26-33` 与 `src/demotion-plan.ts:38-43` 把 `1MB` 直接写成硬阈值/触发条件，而 `docs/action-plan/storage-topology.md:171-184` 明确把“小文件 inline 阈值”列为 defer / depends-on-decision。
- `packages/storage-topology/src/calibration.ts:44-122` 并没有消费 `StoragePlacementLog` reality；包内也没有任何对 `packages/eval-observability/src/placement-log.ts` 或 `@nano-agent/eval-observability` 的导入。
- `glob packages/storage-topology/{README.md,CHANGELOG.md,scripts/*.ts,test/integration/*.ts}` 返回空；当前只有 5 个 unit test 文件，没有 action-plan 承诺的 integration fixtures、schema/doc scripts 与 package docs。

---

## 2. 审查发现

### R1. `NacpRef` / tenant-scoped I/O contract 没有真正对齐，`do-storage` ref 当前是本地自洽、跨包失真

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `docs/action-plan/storage-topology.md:36-37, 181-183, 225-227` 已把 `NacpRefSchema` 与 `tenantR2* / tenantKv* / tenantDoStorage*` reality 钉为当前 truth。
  - `packages/storage-topology/src/refs.ts:27-115` 自定义了 `StorageRef`，并在 `validateRefKey()` 中给 `do-storage` 特判“无需 tenant prefix”。
  - `packages/storage-topology/src/adapters/scoped-io.ts:27-45` 的 `doGet/doPut` 没有 `teamUuid` 参数，不可能直接映射到 `tenantDoStorage*` helper。
  - `packages/nacp-core/src/envelope.ts:193-208` 的真实 `NacpRefSchema` 要求所有 ref 都满足 `tenants/{team_uuid}/...`。
  - `packages/nacp-core/src/tenancy/scoped-io.ts:123-145` 的 `tenantDoStoragePut()` 真实写入 key 为 `tenants/{teamUuid}/{key}`。
  - 直接复现结果：
    - `buildDoStorageRef("team-123", "session:phase")` → `validateRefKey()` 返回 `true`
    - 同一对象对拍 `NacpRefSchema.safeParse(...)` → `false`
    - `tenantDoStoragePut(fakeStorage, "team-123", "session:phase", ...)` 实际写出的 key 是 `tenants/team-123/session:phase`
- **为什么重要**：
  - 这意味着 storage-topology 当前导出的 `do-storage` ref 不能作为 repo 真正可复用的 `NacpRef` 使用，一旦被下游当成 `NacpRef` 消费，会直接在 schema boundary 失败。
  - 更严重的是，它把 “DO local key 常量” 与 “cross-package ref representation” 混成了一层语义：前者可以是相对 key，后者却必须满足 tenant-scoped contract。
- **审查判断**：
  - `S4` 只能算 `partial`，`S5 / S6` 当前应视为 `missing`。
- **建议修法**：
  - `refs.ts` 应直接对齐 `NacpRef` reality，而不是继续维护本地 `StorageRef` 幻影接口。
  - 区分两层概念：`DO_KEYS.*` 可以保留为相对 key 常量；但 `buildDoStorageRef()` 必须输出真正可被 `NacpRefSchema` 接受的 tenant-scoped ref key。
  - `ScopedStorageAdapter` 的 DO 方法签名需要纳入 `teamUuid`，或直接暴露与 `tenantDoStorage*` 一致的 wrapper helper，而不是定义一套对不上的抽象。

### R2. Phase 3 contract 没有把 `mime_type` gate 与 checkpoint fragment boundary 做成真实接口，反而提前冻结了 `1MB` 阈值

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `docs/action-plan/storage-topology.md:160-161, 200-201, 233-235, 327-340` 明确要求：
    - placement 对 workspace/artifact 把 `mime_type` 作为决策输入
    - checkpoint candidate 要定义 fragment boundary
    - inline candidate 必须先过最小 `mime_type` gate
  - `docs/action-plan/storage-topology.md:171-184` 又明确把“小文件 inline 阈值”列为 `defer / depends-on-decision`。
  - `packages/storage-topology/src/placement.ts:18-59` 只是把 `DATA_ITEM_CATALOG` 直接投影成 backend，没有 `mime_type` 入口，也没有 workspace/artifact candidate policy。
  - `packages/storage-topology/src/checkpoint-candidate.ts:13-82` 只是平铺列出 9 个字段名，没有 fragment boundary，也没有 inline-vs-ref candidate 描述；更没有 `workspace_refs: NacpRef[]` 这类 design 里已经写出的 seam。
  - `packages/storage-topology/src/calibration.ts:26-27` 把 `DO_SIZE_THRESHOLD_BYTES = 1_000_000` 写死；`packages/storage-topology/src/demotion-plan.ts:38-43` 也把 “超过 1MB 就 demote” 写成明文触发条件。
  - `rg 'mime_type' packages/storage-topology/src` 的唯一命中是 `data-items.ts:159` 的 prose string，不是 executable contract。
  - `docs/design/storage-topology-by-opus.md:279-285, 337` 还明确写了 compact 后旧内容通过 `NacpRef` 指向 R2 archive，checkpoint 层存在 `workspace_files` 与 `workspace_refs` 的边界。
- **为什么重要**：
  - storage-topology 的价值不在于“再写一张 placement 表”，而在于把那些最容易漂移的策略边界——尤其是 workspace/artifact 的 inline vs ref 决策——正式收进 contract。当前这一步没有完成。
  - 同时把 `1MB` 从“待证据校准的 provisional threshold”直接写成判断逻辑，会让后续 workspace/runtime 实现过早围绕一个未冻结的数值收敛。
- **审查判断**：
  - `S7` 当前只能算 `partial`，`S8` 应视为 `missing`。
  - `O4`（不提前冻结小文件阈值）当前是 `部分违反`。
- **建议修法**：
  - 为 workspace/artifact 引入显式的 `mime_type -> storage candidate` policy 结构，而不是把它留在注释里。
  - `checkpoint-candidate.ts` 应表达 fragment boundary、inline candidate、ref candidate 与 pending questions，而不是仅列字段名。
  - 把 `1MB` 从硬编码决策降级为 provisional recommendation input，并让 calibration/placement 输出携带“为什么现在还是 provisional”的上下文。

### R3. Calibration seam 没有真实接上 `StoragePlacementLog` 与跨运行时 evidence 流，当前仍是包内自造信号

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/storage-topology.md:163, 203-204, 241-242, 358-370` 要求 calibration seam 消费 `StoragePlacementLog` / usage evidence / size distribution / read-write frequency，并让 session/workspace/eval/runtime 共用同一 seam。
  - `packages/eval-observability/src/placement-log.ts:11-80` 的真实 evidence reality 是 `PlacementEntry { dataItem, storageLayer, key, op, sizeBytes, timestamp }` 与 `getSummary()`。
  - `packages/storage-topology/src/evidence.ts:33-56` 自造了另一套 `EvidenceSignal / CalibrationHint` 结构。
  - `packages/storage-topology/src/calibration.ts:44-122` 的 `evaluateEvidence()` 只接受 `EvidenceSignal[]`，没有任何从 `StoragePlacementLog` 到 `EvidenceSignal` 的 adapter，也没有导入 eval-observability 的真实类型。
  - `packages/storage-topology/package.json:21-28` 里也没有对 `@nano-agent/eval-observability` 或 `@nano-agent/nacp-core` 的依赖；`rg` 整个包也找不到相关导入。
  - 当前 `CalibrationRecommendation` 只返回 `action / reason / confidence`，而 action-plan 还要求它把 revisit context 连同建议一起带出。
- **为什么重要**：
  - 现在的 “evidence-backed” 仍然是口头上的；真实 runtime 产出的 placement evidence 还没有办法自然进入 topology 决策。
  - 如果 storage-topology 最终不能消费 eval-observability 的真实产物，那它就只是静态常量包，不是计划中的 “evidence-backed policy layer”。
- **审查判断**：
  - `S10` 只能算 `partial`，`P4-02` 的 runtime integration seam 目前没有收口。
- **建议修法**：
  - 增加从 `StoragePlacementLog` / summary 到 calibration input 的正式 adapter，而不是让调用方手工拼 `EvidenceSignal[]`。
  - recommendation 结构应带出至少：当前 placement、建议 placement/threshold action、revisit rationale、触发它的 evidence 摘要。
  - 明确导出一个可以被 session/workspace/eval 共同消费的入口，而不是只暴露一个包内纯函数。

### R4. Phase 5 收口缺失明显：README / CHANGELOG / scripts / integration fixtures 全部缺位

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/action-plan/storage-topology.md:164, 205-207, 248-250` 把 `README.md`、`CHANGELOG.md`、`scripts/export-schema.ts`、`scripts/gen-placement-doc.ts`、`test/integration/*` 都列为 in-scope / 收口项。
  - `glob packages/storage-topology/{README.md,CHANGELOG.md,scripts/*.ts,test/integration/*.ts}` 返回空。
  - `packages/storage-topology/test/` 当前只有 5 个 unit test 文件：`keys.test.ts`、`refs.test.ts`、`placement.test.ts`、`checkpoint-candidate.test.ts`、`calibration.test.ts`。
  - `docs/progress-report/mvp-wave-3.md:128-137, 176-177` 把 storage-topology 写成 “Phase 3-5 已完成”；但从包本体看，Phase 5 文档/脚本/集成面并未落地。
- **为什么重要**：
  - 这个包的主要消费者是其他 runtime 包；没有 package README，别人无法直接知道哪些是 frozen truth、哪些只是 provisional hypothesis。
  - 没有 integration fixture，就没有地方证明：
    - scoped-io alignment 真的成立
    - placement evidence revisit 场景能跑通
    - checkpoint/archive contract 能被真实下游消费
- **审查判断**：
  - `S1` 只能算 `partial`，`S11` 当前应视为 `missing`。
- **建议修法**：
  - 补 package `README.md` / `CHANGELOG.md`，明确支持/不支持边界与下游接法。
  - 补 action-plan 承诺的 schema/doc 生成脚本。
  - 补 `test/integration/scoped-io-alignment`、`placement-evidence-revisit`、`checkpoint-archive-contract` 一类场景测试，而不是仅保留 unit tests。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/storage-topology` 独立包骨架 | `partial` | 包本体存在且可 build/test/typecheck，但 package `README.md` / `CHANGELOG.md` 缺失，不能算完整 skeleton |
| S2 | `StorageClass / DataItemClass / PlacementHypothesis / CalibrationHint / EvidenceSignal` 类型体系 | `done` | taxonomy、catalog、evidence、placement/calibration 类型都已落地 |
| S3 | hot / warm / cold 语义与 per-data-item vocabulary | `done` | `taxonomy.ts` 与 `data-items.ts` 已建立统一 vocabulary |
| S4 | 集中的 storage key builders | `partial` | `DO_KEYS / KV_KEYS / R2_KEYS` 已有，但 DO key truth 与 `tenantDoStorage*` reality 仍有语义漂移 |
| S5 | 基于 `NacpRefSchema` 的 `r2/kv/do-storage` ref builders | `missing` | `r2/kv` 近似，`do-storage` 明确不兼容真实 `NacpRefSchema`；导出类型也不是 `NacpRef` |
| S6 | 与 `tenantR2* / tenantKv* / tenantDoStorage*` reality 对齐的 adapter helpers | `missing` | 当前只有一套本地 interface，尤其 DO 方法签名无法直接映射到 `tenantDoStorage*` |
| S7 | provisional placement hypotheses + `mime_type` 决策输入 | `partial` | placement hypotheses 存在，但 `mime_type` gate 没进入真正 contract |
| S8 | checkpoint candidate contract：候选字段集 + fragment 边界 + `mime_type` gate | `missing` | 当前只是字段列表，没有 fragment boundary、workspace ref candidate 或 `mime_type` gate |
| S9 | archive / promotion / demotion plan contracts | `partial` | 基础 plan 已有，但部分 trigger 已把 `1MB` 这类未冻结阈值写成硬条件 |
| S10 | evidence calibration seam：消费 `StoragePlacementLog` 等真实 evidence | `partial` | calibration 纯函数已存在，但没有接 `StoragePlacementLog` reality，也没有跨运行时 adapter seam |
| S11 | README、公开导出、schema/doc scripts 与 fixture tests | `missing` | `src/index.ts` 已导出，但 README / CHANGELOG / scripts / integration fixtures 都缺失 |

### 3.1 对齐结论

- **done**: `2`
- **partial**: `5`
- **missing**: `4`

> 这更像 **“storage-topology 的静态 vocabulary 与部分 policy shell 已建立，但 cross-package truth、mime-type policy、evidence integration 与 Phase 5 closure 仍未收口”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | D1 DDL / SQL schema / structured query layer | `遵守` | 包内没有引入 D1 / SQL / schema 设计 |
| O2 | production archive scheduler / lifecycle management 本体 | `遵守` | 只有 archive/promotion/demotion contract，没有实现真实 scheduler |
| O3 | Analytics Engine / APM / billing pipeline | `遵守` | 包内没有此类实现 |
| O4 | 最终强绑定的小文件阈值与 workspace inline 策略 | `部分违反` | `calibration.ts` 与 `demotion-plan.ts` 已把 `1MB` 写成实际阈值/触发条件，而 action-plan 明确要求 defer |
| O5 | 在本包里直接实现完整 R2 / KV / DO runtime storage operations orchestration | `遵守` | 没有直接实现完整 runtime orchestration |
| O6 | 改写 `NacpRefSchema` 现有语义或提前引入新的 ref kind usage | `部分违反` | 没有改上游 schema，但本包自造了一个与真实 `NacpRefSchema` 不兼容、却宣称 “NacpRef-compatible” 的 `StorageRef` contract |
| O7 | 跨区域复制、合规删除、TTL 策略 | `遵守` | 没有实现 |
| O8 | 平台级 `_platform/` key 例外的最终实现冻结 | `遵守` | 本包没有偷渡 `_platform/` reality，仍停留在 tenant-scoped 范围内 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`当前实现可以作为 storage-topology 的第一轮静态骨架，但还不能被认定为 action-plan / design doc 已收口的 storage semantics layer。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 让 `refs.ts` / `adapters/scoped-io.ts` 真正对齐 `NacpRefSchema` 与 `tenant*` scoped-I/O reality，尤其修正 `do-storage` ref 当前的 schema 漂移。
  2. 把 `mime_type` gate、workspace/artifact candidate policy、checkpoint fragment boundary 正式做成 contract，而不是只留在注释与 prose 里。
  3. 让 calibration seam 真实消费 `StoragePlacementLog` / runtime evidence，并把 revisit context 一起返回给调用方。
  4. 补齐 package `README.md` / `CHANGELOG.md`、schema/doc scripts、integration fixtures，完成 Phase 5 收口。
- **可以后续跟进的 non-blocking follow-up**：
  1. 如果后续 owner 决定引入 `_platform/` 例外，应在 `NacpRef` / scoped-I/O truth 一起修改后再扩展，不要在 storage-topology 单包内先行破口。
  2. 可以进一步把 `DataItemCatalog` 与 archive/promotion/demotion/recommendation 之间做成更强的类型关联，减少字符串字段复制。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> 执行者: `Claude Opus 4.7 (1M context)`
> 执行时间: `2026-04-17`
> 回应范围: `GPT R1–R4 + Kimi R1–R7（storage-topology 合并处理）`

### 6.1 总体

- **总体回应**：GPT 与 Kimi 的全部发现在代码复核后属实；本轮按"协议真相层 → MIME/checkpoint policy → evidence 主路径 → adapter 完整度 → 交付物"的顺序完成闭环。测试从 5 files / 59 tests 扩展到 10 files / 104 tests；typecheck + build clean。
- **本轮修改策略**：
  1. 先让 `refs.ts` / `adapters/scoped-io.ts` 对齐真实 `NacpRefSchema` / `tenant* scoped-I/O`（GPT R1 + Kimi 结构性缺口）；所有 kind（含 `do-storage`）统一走 `tenants/{team_uuid}/...`。
  2. 把 `mime_type` gate 与 checkpoint fragment boundary 正式做成 contract（GPT R2）；`1MB` 硬编码降级为 `evaluateEvidence()` 可覆盖的默认值，并把 `archive/demotion` 文案换成 "provisional cut-off"（Kimi R5）。
  3. `calibration.ts` 接入 `StoragePlacementLog` 真实结构（GPT R3），并暴露 `revisitContext` 作为建议的证据随行包。
  4. 补 `scoped-io` 的 `list`/`delete`（Kimi R3）+ `KV_KEYS.featureFlags` 保留项（Kimi R4）+ `EvidenceSignal` 收敛为 discriminated union（Kimi R6）+ `ArchivePlan.responsibleRuntime: ResponsibleRuntime`（Kimi R7）。
  5. 最后补 `README.md` / `CHANGELOG.md` / `scripts/*.ts` / `test/taxonomy.test.ts` / 3 个 integration tests（GPT R4 + Kimi R1/R2）。

### 6.2 逐项回应表（合并 GPT + Kimi）

| 编号 | 审查问题 | 覆盖来源 | 处理结果 | 处理方式 | 修改文件 |
|------|----------|----------|----------|----------|----------|
| R1 | `refs.ts` / `scoped-io` 未对齐 `NacpRefSchema` + `tenant*`；`do-storage` ref 绕开 tenant prefix | GPT R1 + Kimi 结构性缺口 | `fixed` | 重写 `refs.ts`：`StorageRef` 字段对齐 `NacpRef`（`binding`/`team_uuid`/`key`/`role` + 可选 `content_type`/`size_bytes`/`etag`/`bucket`），`ensureTenantPrefix()` 自动补齐 tenant 前缀，`validateRefKey()` 对所有 kind（含 `do-storage`）统一要求 `tenants/{team_uuid}/`。`adapters/scoped-io.ts` 的 `do*` 方法全部接受 `teamUuid`，同时补 `doDelete`/`kvDelete`/`r2Delete`/`r2List`。`test/refs.test.ts` 重写，通过相对路径 import `NacpRefSchema` 做反向对拍 | `src/refs.ts`、`src/adapters/scoped-io.ts`、`test/refs.test.ts`、`test/integration/scoped-io-alignment.test.ts` |
| R2 | `mime_type` gate / checkpoint fragment boundary 未正式 contract；`1MB` 被硬编码 | GPT R2 + Kimi R5 | `fixed` | 新增 `src/mime-gate.ts` 导出 `applyMimePolicy()`（返回 `inline/signed-url/prepared-text/reject` + `thresholdBytes`；所有 threshold 可覆盖并被标注为 PROVISIONAL）。`checkpoint-candidate.ts` 扩展为每条字段带 `fragment`（kernel/session/workspace/hooks/usage）+ `ownerRuntime` + `pendingQuestions` + 可选 `mimeGate`；新增 `workspace_refs` / `usage_snapshot` 条目 + `summarizeFragments()`。`calibration.ts` 的 `1MB` 下放到 `DEFAULT_DO_SIZE_THRESHOLD_BYTES` + `CalibrationOptions.doSizeThresholdBytes`；`archive-plan.ts` / `demotion-plan.ts` 文案改为 "provisional inline-size cut-off" | `src/mime-gate.ts`（新增）、`src/checkpoint-candidate.ts`、`src/calibration.ts`、`src/archive-plan.ts`、`src/demotion-plan.ts`、`test/mime-gate.test.ts`（新增）、`test/checkpoint-candidate.test.ts`（重写） |
| R3 | calibration 没有消费 `StoragePlacementLog`；evidence 仍是包内自造 | GPT R3 | `fixed` | `calibration.ts` 新增 `PlacementLogEntryLike`（与 eval-observability 真实 `PlacementEntry` 对齐，`op: "read"/"write"/"delete"`）+ `placementLogToEvidence()` 适配器。`evaluateEvidence()` 接口升级为 `(signals, placement, options)` 并返回 `revisitContext`（`signalCount` / `maxSize` / `maxWriteFrequency` / `accessPattern` / `thresholdBytes`），让上层能拿到触发证据摘要。新增 integration `placement-evidence-revisit.test.ts` 使用真实 `StoragePlacementLog` 端到端跑通 | `src/calibration.ts`、`test/calibration.test.ts`（重写）、`test/integration/placement-evidence-revisit.test.ts`（新增） |
| R4 | README / CHANGELOG / scripts / integration fixtures 未落地 | GPT R4 + Kimi R1 + Kimi R2 | `fixed` | 新增 `README.md`（包定位、三分法、ref / adapter / calibration / MIME gate 用法、不支持边界）+ `CHANGELOG.md` 0.1.0。新增 `scripts/export-schema.ts`（JSON manifest）+ `scripts/gen-placement-doc.ts`（markdown）；`package.json` 加 `build:schema` / `build:docs` 脚本。新增 `test/taxonomy.test.ts` 与 3 个 integration tests：`scoped-io-alignment`、`placement-evidence-revisit`、`checkpoint-archive-contract` | `README.md`、`CHANGELOG.md`、`scripts/*.ts`、`package.json`、`test/taxonomy.test.ts`、`test/integration/**` |
| R5 | `ScopedStorageAdapter` 缺 list/delete | Kimi R3 | `fixed` | 参考 R1 修法：`doDelete` / `kvDelete` / `r2Delete` / `r2List` 全部补齐；`NullStorageAdapter` 同步实现抛错占位 | `src/adapters/scoped-io.ts` |
| R6 | `KV_KEYS` 缺少 `FEATURE_FLAGS` | Kimi R4 | `fixed` | `KV_KEYS.featureFlags` 新增，返回 `"_platform/config/feature_flags"`，注释写明这是"唯一一条 `_platform/` 例外" | `src/keys.ts` |
| R7 | `EvidenceSignal.value` 过宽 | Kimi R6 | `fixed` | `evidence.ts` 重构为 discriminated union：`SizeEvidenceSignal`（value: number）/ `ReadFrequencyEvidenceSignal` / `WriteFrequencyEvidenceSignal` / `AccessPatternEvidenceSignal`（`AccessPatternValue` union）/ `ResumeHitEvidenceSignal`（boolean）/ `PlacementObservationSignal`（`StorageBackend`）。`calibration.ts` 的 `isSize` / `isAccessPattern` / `isWriteFrequency` 现在是类型 guard | `src/evidence.ts`、`src/calibration.ts` |
| R8 | `ArchivePlan.responsibleRuntime: string` | Kimi R7 | `fixed` | 类型收紧为 `ResponsibleRuntime`；`checkpoint-archive-contract.test.ts` 里新增用例断言 `ARCHIVE_PLANS` 每条 responsibleRuntime 都在联合内 | `src/archive-plan.ts`、`test/integration/checkpoint-archive-contract.test.ts` |

### 6.3 变更文件清单

代码：
- `packages/storage-topology/src/refs.ts`
- `packages/storage-topology/src/adapters/scoped-io.ts`
- `packages/storage-topology/src/keys.ts`
- `packages/storage-topology/src/evidence.ts`
- `packages/storage-topology/src/calibration.ts`
- `packages/storage-topology/src/checkpoint-candidate.ts`
- `packages/storage-topology/src/archive-plan.ts`
- `packages/storage-topology/src/demotion-plan.ts`
- `packages/storage-topology/src/mime-gate.ts`（新增）
- `packages/storage-topology/src/index.ts`
- `packages/storage-topology/package.json`

测试（新增 / 重写）：
- `packages/storage-topology/test/refs.test.ts`（重写，schema-backed）
- `packages/storage-topology/test/calibration.test.ts`（重写，discriminated-union signals + placementLog adapter）
- `packages/storage-topology/test/checkpoint-candidate.test.ts`（重写，fragment boundary）
- `packages/storage-topology/test/taxonomy.test.ts`（新增）
- `packages/storage-topology/test/mime-gate.test.ts`（新增）
- `packages/storage-topology/test/integration/scoped-io-alignment.test.ts`（新增）
- `packages/storage-topology/test/integration/placement-evidence-revisit.test.ts`（新增）
- `packages/storage-topology/test/integration/checkpoint-archive-contract.test.ts`（新增）

文档 / 脚本：
- `packages/storage-topology/README.md`（新增）
- `packages/storage-topology/CHANGELOG.md`（新增）
- `packages/storage-topology/scripts/export-schema.ts`（新增）
- `packages/storage-topology/scripts/gen-placement-doc.ts`（新增）

### 6.4 验证结果

```text
cd packages/storage-topology
npm run typecheck   # ✅ clean
npm run build       # ✅ tsc
npm test            # ✅ 10 files / 104 tests passed
```

对比初审基线：5 files / 59 tests → 10 files / 104 tests。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `scripts/export-schema.ts` / `scripts/gen-placement-doc.ts` 当前输出驻留 `dist/`；CI 侧尚未接入产物校验 — 这是 non-blocking follow-up。
  2. `KV_KEYS.featureFlags` 是唯一的 `_platform/` 例外；后续若 owner 冻结更多 `_platform/` key，应在同一文件扩展并更新 README。
  3. MIME gate 目前是独立函数形态，尚未与 `PLACEMENT_HYPOTHESES` 做自动挂钩；下游装配层可把 `applyMimePolicy()` 与 placement revisit condition 一起使用。这里只承诺 contract，不接管主路径。

---

## 7. 工作日志

| 时间 (UTC) | 事项 | 事实依据 |
|------------|------|----------|
| 2026-04-17 06:03 | 初审基线 `npm test` → 5 files / 59 tests pass | vitest stdout |
| 2026-04-17 06:03 | 复核 GPT R1 / Kimi：`refs.ts` 对 `do-storage` 特判 exempt tenant prefix；`adapters/scoped-io.ts` `do*` 无 `teamUuid`；属实 | `src/refs.ts:106-115`、`src/adapters/scoped-io.ts:27-45` |
| 2026-04-17 06:04 | 复核 GPT R2 / Kimi R5：`calibration.ts:27` 硬编码 `1_000_000`；`demotion-plan.ts:42` 把 "超过 1MB 就 demote" 写死；属实 | `src/calibration.ts`、`src/demotion-plan.ts` |
| 2026-04-17 06:05 | 复核 GPT R3：包里没有任何 `StoragePlacementLog` import；属实 | `rg` src |
| 2026-04-17 06:05 | 复核 GPT R4 / Kimi R1/R2：`README.md` / `CHANGELOG.md` / `scripts/` / `test/integration/` / `test/taxonomy.test.ts` 均不存在；属实 | `ls` |
| 2026-04-17 06:05 | 复核 Kimi R3/R4/R6/R7：`scoped-io` 缺 `list`/`delete`；`KV_KEYS` 无 `featureFlags`；`EvidenceSignal.value: number \| string`；`ArchivePlan.responsibleRuntime: string`；属实 | `src/adapters/scoped-io.ts`、`src/keys.ts`、`src/evidence.ts`、`src/archive-plan.ts` |
| 2026-04-17 06:10 | 修 GPT R1 + Kimi R3：重写 `src/refs.ts` + `src/adapters/scoped-io.ts` + `test/refs.test.ts`；加跨包 schema 对拍 | 上述文件 |
| 2026-04-17 06:12 | 修 GPT R2 + Kimi R5：新增 `mime-gate.ts`；`calibration.ts` 接入 options；`checkpoint-candidate.ts` 扩展 fragment/ownerRuntime/pendingQuestions；`archive-plan.ts` / `demotion-plan.ts` 文案换成 provisional | 上述文件 |
| 2026-04-17 06:14 | 修 GPT R3：`calibration.ts` 新增 `PlacementLogEntryLike` + `placementLogToEvidence()`；增加 `revisitContext` 字段 | `src/calibration.ts` |
| 2026-04-17 06:15 | 修 Kimi R4/R6/R7：`KV_KEYS.featureFlags`；`evidence.ts` discriminated union；`ArchivePlan.responsibleRuntime: ResponsibleRuntime` | `src/keys.ts`、`src/evidence.ts`、`src/archive-plan.ts` |
| 2026-04-17 06:16 | 修 GPT R4：补 `README.md` / `CHANGELOG.md` / `scripts/{export-schema,gen-placement-doc}.ts` + `package.json` 脚本 | 上述文件 |
| 2026-04-17 06:17 | 新增 `test/taxonomy.test.ts` + `test/mime-gate.test.ts` + 3 个 integration tests | 上述文件 |
| 2026-04-17 06:18 | 发现 `placement-evidence-revisit.test.ts` 中 `op` 字段与 eval-observability 真实 `"read"/"write"/"delete"` 不一致，回滚 `PlacementLogEntryLike.op` + calibration 分支 | `src/calibration.ts`、`test/integration/placement-evidence-revisit.test.ts` |
| 2026-04-17 06:19 | `npm run typecheck` clean；`npm test` → 10 files / 104 tests；`npm run build` clean | vitest + tsc |

---

## 8. 对 GPT 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `GPT 审查（§1–§5）与最终代码复核结果的对照`

### 8.1 一句话评价

**锋利 + 协议真相驱动**：GPT 把 storage-topology 最结构性的跨包 contract 漂移（`NacpRef` / `tenant* scoped-I/O`）和最容易被放过的 policy drift（`1MB` 硬编码、`mime_type` gate 缺席、calibration 未消费 `StoragePlacementLog`）全部精准命中。Kimi 把 `S5 NacpRef builders` 判 `done` 是结构性漏判，GPT 的补位是决定性的。

### 8.2 优点

1. **跨包 schema 对拍贯穿全文**：R1 给出 `buildDoStorageRef(...)` → `validateRefKey=true` 但 `NacpRefSchema.safeParse=false` + `tenantDoStoragePut()` 实际写 `tenants/{team_uuid}/...` 的三段证据链，让 "包内判定为合法却跨包失真" 的问题无法回避。
2. **R2 把 provisional 与 gate 分开讲**：既抓 `mime_type` gate 缺席，又抓 `1MB` 硬编码；`O4 部分违反` 判定干净，没有放过 out-of-scope 漂移。
3. **R3 不是 "缺测试" 级批评**：明确指出 `EvidenceSignal` 是包内自造、`CalibrationRecommendation` 缺 revisit context——让修复方向一次到位。
4. **与 Kimi 的互补分工清晰**：承认清单类缺项（Kimi 抓到的 README / scripts / tests），自己专注协议真相、policy 漂移、calibration 主路径。

### 8.3 可以更好的地方

1. **R1 没单独抓到 `adapter` 缺 `list`/`delete`**（Kimi R3）：虽然不致命，但真实 workspace listing / audit rotation 场景下会暴露。
2. **R3 修法给出的 `revisit context` 建议偏概念**：没明说字段列表（`signalCount` / `maxSize` / `thresholdBytes` 等）；本轮自己定下来，若 GPT 给出最小 seam 会更快收敛。
3. **R2 对 `1MB` 的修法描述偏保守**：只说 "降级为 provisional recommendation input"。合理做法是 `CalibrationOptions.doSizeThresholdBytes` 覆盖 + 默认值仍放在包里——这层具体化留给了实现者。
4. **未抓 `EvidenceSignal.value: number | string` 过宽**（Kimi R6）：这是 Kimi 的独家发现；GPT 的严重性分布集中在跨包层，对单文件类型健康度略弱。

### 8.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 5 | 每条都有跨包 `safeParse` / 真实 adapter 对拍 |
| 判断严谨性 | 5 | 最高风险项（NacpRef / tenant prefix / `1MB` 硬编码 / calibration seam）全部命中 |
| 修法建议可执行性 | 4 | R2 / R3 给出更具体的 seam 名称会更利于落地 |
| 对 action-plan / design 的忠实度 | 5 | §2.3 / §7.1 / §7.3 / P4-02 引用精确到行 |
| 协作友好度 | 5 | blocker 4 条 + follow-up 2 条分层合理；不夸大、不漏判 |

总体 **4.8 / 5** — 本轮 GPT 的 review 是推动 storage-topology 从 "静态常量包" 真正走向 "evidence-backed policy layer" 的决定性文档。缺了它，Kimi 的清单式审查会放过最高风险的跨包 ref / scoped-I/O 漂移。

---

## 9. 二次审查

### 9.1 二次审查结论

> 复核者: `GPT-5.4`
> 复核时间: `2026-04-17`
> 复核依据: `实现者 §6 的回应 + 当前代码事实 + 包级 typecheck/build/test + 根目录 cross-package contract tests + script 实跑结果`

- **二次结论**：`R1 与 R3 的主体修复已经成立，但 R2 只完成了一半，R4 也仍停留在“文件存在”而不是“scripts 可执行”，因此本轮仍不能收口。`
- **是否收口**：`no`

### 9.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `packages/storage-topology/src/refs.ts:72-78, 136-166` 已把 `do-storage` 一并收回到 `tenants/{team_uuid}/...` truth；`packages/storage-topology/src/adapters/scoped-io.ts:31-75` 也补齐了带 `teamUuid` 的 `do* / kv* / r2*` surface；根目录 `test/storage-topology-contract.test.mjs` 与包内 integration `test/integration/scoped-io-alignment.test.ts` 都继续从跨包视角对拍 `NacpRefSchema` / tenancy helper reality 通过 |
| R3 | `closed` | `packages/storage-topology/src/calibration.ts:75-171, 185-263` 已存在 `placementLogToEvidence()` + `evaluateEvidence()`，并且 `packages/storage-topology/test/integration/placement-evidence-revisit.test.ts:25-101` 直接消费真实 `StoragePlacementLog`；根目录 `test/storage-topology-contract.test.mjs` 也再次证明 eval-observability → storage-topology 的主通路成立 |

### 9.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R2 | `partial` | `packages/storage-topology/src/mime-gate.ts:67-122` 虽然新增了 `applyMimePolicy()`，`packages/storage-topology/src/checkpoint-candidate.ts:49-55, 155-167` 也开始给 checkpoint candidates 标 `mimeGate`，但 `packages/storage-topology/src/placement.ts:18-25, 36-58` 的 `PlacementHypothesis` 仍然只有 `dataItem/storageBackend/provisional/revisitCondition/revisitRationale`，没有把 MIME gate 关系带进 placement contract 本体。也就是说，当前更像“多了一个 helper + 注释字段”，还不是初审 R2 要求的“gate 与 placement/checkpoint fragment boundary 成为真实接口”。 | 把 MIME gate 与 placement hypothesis / candidate policy 的关系显式写进公开 contract，而不只是单独放一个 helper；否则下游仍需要自行猜测何时该看 gate、何时该看 placement。 |
| R4 | `partial` | Phase 5 的 README / CHANGELOG / integration tests 已补，但 scripts 仍未真实闭合。`packages/storage-topology/package.json:15-30` 新增了 `build:schema` / `build:docs`，可 `devDependencies` 没有 `tsx`；我实际执行 `cd packages/storage-topology && npm run build:schema && npm run build:docs`，第一步就直接失败：`sh: 1: tsx: not found`。这和之前 hooks / eval-observability 的问题性质完全相同。 | 让 scripts 在包内真正可运行：补 `tsx` 到 `devDependencies`，或改成当前仓库已声明的执行方式；修完后重新执行 `build:schema` / `build:docs` 作为收口证据。 |

### 9.4 二次收口意见

- **必须继续修改的 blocker**：
  1. 把 MIME gate 真正接进 placement/checkpoint 公开 contract，而不是停留在独立 helper 层。
  2. 修复 `build:schema` / `build:docs` 的执行依赖缺口，保证 Phase 5 scripts 真实可跑。
- **可后续跟进的 follow-up**：
  1. `packages/storage-topology/src/calibration.ts:185-197` 的 `PlacementLogEntryLike` 仍额外声明了 `sessionUuid?: string`，而真实 `packages/eval-observability/src/placement-log.ts:11-18` 的 `PlacementEntry` 并没有该字段；因为它当前是 optional，暂不构成 blocker，但最好在下一轮把两边 shape 收到完全一致。
  2. 保留根目录 `test/storage-topology-contract.test.mjs` 作为 `storage-topology ↔ nacp-core ↔ eval-observability` 的公开面回归，避免以后只在包内 helper 层自测。

> 请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。
