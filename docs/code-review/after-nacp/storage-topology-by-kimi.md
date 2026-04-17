# Nano-Agent 代码审查模板

> 审查对象: `@nano-agent/storage-topology`
> 审查时间: `2026-04-17`
> 审查人: `Kimi`
> 审查范围:
> - `docs/action-plan/storage-topology.md`
> - `docs/design/storage-topology-by-opus.md`
> - `packages/storage-topology/src/**`
> - `packages/storage-topology/test/**`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 该包作为 storage semantics layer 的骨架完整，类型设计清晰，key/ref builders 与 tenant-scoped 约束对齐良好，59 项测试全部通过。但 README 完全缺失，action-plan 中明确列出的 3 项集成测试、1 项单测、2 个脚本均未实现，`ScopedStorageAdapter` 也未覆盖 `list/delete` 操作，导致其作为“可被下游 runtime 直接复用的独立包”尚未达到收口标准。

- **整体判断**：核心 taxonomy、data catalog、placement hypotheses、calibration seam 均已落地；但文档与集成测试缺口较大，部分 adapter 能力未对齐 `tenant*` helper reality。
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `README.md` 缺失使得本包的定位、provisional 性质与使用方式无法被下游消费。
  2. `test/integration/` 与 `scripts/` 目录完全不存在，与 action-plan Phase 5 的交付清单直接冲突。
  3. `ScopedStorageAdapter` 缺少 `list` / `delete` 操作，无法支撑 workspace 文件枚举与 audit rotation 等已声明的 demotion/archive 场景。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。
> 明确你看了哪些文件、跑了哪些命令、核对了哪些计划项/设计项。

- **对照文档**：
  - `docs/action-plan/storage-topology.md`
  - `docs/design/storage-topology-by-opus.md`
  - `docs/progress-report/mvp-wave-{1,2,3,4}.md`
  - `README.md`
- **核查实现**：
  - `packages/storage-topology/src/version.ts`
  - `packages/storage-topology/src/taxonomy.ts`
  - `packages/storage-topology/src/data-items.ts`
  - `packages/storage-topology/src/evidence.ts`
  - `packages/storage-topology/src/keys.ts`
  - `packages/storage-topology/src/refs.ts`
  - `packages/storage-topology/src/adapters/scoped-io.ts`
  - `packages/storage-topology/src/placement.ts`
  - `packages/storage-topology/src/checkpoint-candidate.ts`
  - `packages/storage-topology/src/archive-plan.ts`
  - `packages/storage-topology/src/promotion-plan.ts`
  - `packages/storage-topology/src/demotion-plan.ts`
  - `packages/storage-topology/src/calibration.ts`
  - `packages/storage-topology/src/index.ts`
  - `packages/storage-topology/test/keys.test.ts`
  - `packages/storage-topology/test/refs.test.ts`
  - `packages/storage-topology/test/placement.test.ts`
  - `packages/storage-topology/test/checkpoint-candidate.test.ts`
  - `packages/storage-topology/test/calibration.test.ts`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/storage-topology typecheck`
  - `pnpm --filter @nano-agent/storage-topology test`
  - `ls packages/storage-topology/test/integration/` → 不存在
  - `ls packages/storage-topology/scripts/` → 不存在
  - `ls packages/storage-topology/README.md` → 不存在
  - `ls packages/storage-topology/test/taxonomy.test.ts` → 不存在

### 1.1 已确认的正面事实

- 14 个源文件全部存在，类型检查零错误，59 项测试全部通过（5 个测试文件）。
- `DATA_ITEM_CATALOG` 完整覆盖 design doc §7.1 的 19 项数据条目，且全部标记了 `provisionalMarker` 与 `revisitCondition`。
- `keys.ts` 的 DO/KV/R2 key builders 均遵循 tenant-scoped 前缀（KV/R2），与 `NacpRefSchema` 约束对齐。
- `refs.ts` 的 `validateRefKey()` 明确拒绝缺少 `tenants/{team_uuid}/` 前缀的 r2/kv ref。
- `placement.ts` 的 `PLACEMENT_HYPOTHESES` 自动从 catalog 推导，frozen 项正确标记为非 provisional。
- `checkpoint-candidate.ts` 的 9 个候选字段与 design doc §7.2 的候选字段集一致。
- `calibration.ts` 的 `evaluateEvidence()` 覆盖了 size threshold、access-pattern、write-frequency 三种信号路径。

### 1.2 已确认的负面事实

- `packages/storage-topology/README.md` 不存在。
- `test/taxonomy.test.ts` 不存在（action-plan §1.5 明确列出）。
- `test/integration/` 目录不存在，缺失 action-plan §1.5 列出的 3 个集成测试文件：
  - `scoped-io-alignment.test.ts`
  - `placement-evidence-revisit.test.ts`
  - `checkpoint-archive-contract.test.ts`
- `scripts/` 目录不存在，缺失 action-plan §1.5 列出的 2 个脚本：
  - `export-schema.ts`
  - `gen-placement-doc.ts`
- `ScopedStorageAdapter` 仅定义 `doGet/Put`、`kvGet/Put`、`r2Get/Put`，未定义 `list` / `delete` 操作。
- `KV_KEYS` 中未包含 design doc §7.3 所列的 `FEATURE_FLAGS: "_platform/config/feature_flags"` 常量。
- `calibration.ts` 中 `DO_SIZE_THRESHOLD_BYTES = 1_000_000` 为硬编码常量，未暴露为可调参数。

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`
> 每条 finding 都应包含：严重级别、事实依据、为什么重要、审查判断。
> 只写真正影响 correctness / security / scope / delivery 的问题，不写样式意见。

### R1. `README.md` 缺失

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/action-plan/storage-topology.md` §1.5 目录树与 §4.5 `P5-03` 均要求 `README.md`。
  - `packages/storage-topology/README.md` 不存在。
- **为什么重要**：
  - 本包是供 `session-do-runtime`、`workspace-context-artifacts`、`eval-observability` 复用的库包。缺少 README 会导致下游无法正确理解其 provisional 语义、key builder 用法与不支持边界。
- **审查判断**：
  - 必须补充。内容至少应覆盖：包定位（semantics layer，不是 storage runtime 本体）、hot/warm/cold 分层说明、key/ref builder 使用示例、provisional 标记的含义、不支持项清单（D1、archive 物理编排）。
- **建议修法**：
  - 新建 `README.md`，对齐 action-plan §8.3 完成定义与设计文档 §9.1 功能簇画像。

### R2. 缺失 3 个集成测试文件、1 个单测文件、2 个脚本

- **严重级别**：`high`
- **类型**：`test-gap` / `delivery-gap`
- **事实依据**：
  - `docs/action-plan/storage-topology.md` §1.5 明确列出：
    - `test/taxonomy.test.ts`
    - `test/integration/scoped-io-alignment.test.ts`
    - `test/integration/placement-evidence-revisit.test.ts`
    - `test/integration/checkpoint-archive-contract.test.ts`
    - `scripts/export-schema.ts`
    - `scripts/gen-placement-doc.ts`
  - 上述文件/目录在源码树中均不存在。
- **为什么重要**：
  - 集成测试是 Phase 5 的收口标准（“builders 与 provisional policy 可稳定回归”）。脚本是可审阅交付物（“生成可审阅的 topology 输出”）。它们的缺失意味着 action-plan 的 Definition of Done 未达成。
- **审查判断**：
  - 必须补齐。集成测试不需要重逻辑，但至少应验证：scoped-io adapter 与 key builder 的接线一致性、placement evidence 驱动重评的端到端路径、checkpoint/archive plan 的字段完整性。
  - 脚本可最小实现：读取 `DATA_ITEM_CATALOG` / `PLACEMENT_HYPOTHESES` 并输出 JSON/MD。
- **建议修法**：
  - 补 `test/taxonomy.test.ts`：覆盖 `storageClassToBackend` 全部分支与 `ProvisionalMarker` 类型。
  - 补 3 个集成测试与 2 个脚本，或明确说明为何收缩范围并更新 action-plan。

### R3. `ScopedStorageAdapter` 缺少 `list` / `delete` 操作

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `packages/storage-topology/src/adapters/scoped-io.ts:27-45` 仅定义 `doGet/Put`、`kvGet/Put`、`r2Get/Put`。
  - `docs/design/storage-topology-by-opus.md` §7.1 的 placement table 中，`workspace-file-small` 和 `audit-trail` 均需要枚举/删除能力（workspace listing、audit rotation）。
  - `docs/action-plan/storage-topology.md` §4.2 `P2-03` 明确提到对齐 `tenantR2* / tenantKv* / tenantDoStorage*` helpers，而 `packages/nacp-core/src/tenancy/scoped-io.ts` 中这些 helper 包含 `List` 操作（如 `tenantR2List`）。
- **为什么重要**：
  - 缺少 `list` / `delete` 意味着 topology adapter 无法支撑 workspace 文件枚举、audit archive 清理、R2 key 前缀扫描等已在 archive/demotion plan 中声明的场景。
- **审查判断**：
  - 应在 adapter 中补充 `doList / doDelete`、`kvList / kvDelete`、`r2List / r2Delete`（或至少 `list` / `delete`），并在 `NullStorageAdapter` 中同步实现抛错占位。
- **建议修法**：
  - 扩展 `ScopedStorageAdapter` 接口，增加 `list(prefix): string[]` 与 `delete(key): void` 方法（按 backend 和 tenant scoped 签名）。

### R4. `KV_KEYS` 缺少 `FEATURE_FLAGS` 常量

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `docs/design/storage-topology-by-opus.md` §7.3 Key Schema Constants 明确列出 `FEATURE_FLAGS: "_platform/config/feature_flags"`。
  - `packages/storage-topology/src/keys.ts` 的 `KV_KEYS` 仅包含 `providerConfig`、`modelRegistry`、`skillManifest`、`hooksPolicy`，没有 `featureFlags`。
- **为什么重要**：
  - 虽然 action-plan Q1 将 `_platform/` 前缀例外 defer 到后续决策，但 `FEATURE_FLAGS` 作为设计文档中明确的 KV 条目，若不在 builder 中提供，下游需要手写 magic string，破坏“集中 key schema”的初衷。
- **审查判断**：
  - 应补回 `KV_KEYS.featureFlags: () => "_platform/config/feature_flags"`，并在单测中覆盖。这是唯一一个 `_platform/` 前缀的显式例外，应在代码和注释中说明其特殊性。
- **建议修法**：
  - 在 `keys.ts` 的 `KV_KEYS` 中增加 `featureFlags: () => "_platform/config/feature_flags"`。

### R5. `calibration.ts` 中 1MB 阈值为硬编码，未暴露可调

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/storage-topology/src/calibration.ts:27`：`const DO_SIZE_THRESHOLD_BYTES = 1_000_000;`
  - `docs/action-plan/storage-topology.md` §5.3 与 §6.2 Q2 均强调“1MB threshold 是 provisional hypothesis，需要 eval evidence 校准，不应冻结”。
- **为什么重要**：
  - 硬编码阈值与“所有 placement 均 provisional、由 evidence 校准”的核心设计原则冲突。后续调整阈值需要改源码，无法通过配置或 evidence 动态演化。
- **审查判断**：
  - 应将阈值改为 `evaluateEvidence` 的可选参数（带默认值 1MB），或在 `CalibrationConfig` 结构中传入，使测试和 future tuning 无需修改源码。
- **建议修法**：
  - 新增 `CalibrationOptions` 接口，含 `doSizeThresholdBytes?: number`；`evaluateEvidence(signals, hypothesis, options?)` 从中读取阈值，默认 1MB。

### R6. `EvidenceSignal.value` 类型过宽（`number | string`）

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `packages/storage-topology/src/evidence.ts:36`：`readonly value: number | string;`
  - 该字段在 `calibration.ts` 中需要大量 `typeof` / 类型窄化（`calibration.ts:65`、`calibration.ts:81`、`calibration.ts:97`）。
- **为什么重要**：
  - 过宽的联合类型导致消费者必须做防御性类型检查，增加使用成本与运行时出错风险。不同 `EvidenceSignalKind` 的 value 语义本就可以更精确。
- **审查判断**：
  - 建议将 `EvidenceSignal` 重构为 discriminated union，按 `kind` 窄化 `value` 类型（如 `size` → `number`，`access-pattern` → `string`）。
- **建议修法**：
  - 定义 `SizeEvidenceSignal = { kind: "size", value: number, ... }` 等变体，并用 `EvidenceSignal = SizeEvidenceSignal | ...` 联合。

### R7. `ArchivePlan.responsibleRuntime` 类型为 `string` 而非 `ResponsibleRuntime`

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `packages/storage-topology/src/archive-plan.ts:18`：`readonly responsibleRuntime: string;`
  - `packages/storage-topology/src/taxonomy.ts:56-62` 已定义 `ResponsibleRuntime` 联合类型。
- **为什么重要**：
  - 使用 `string` 会失去类型安全，无法利用 TypeScript 的 exhaustiveness check，也容易拼写错误。
- **审查判断**：
  - 应将类型收窄为 `ResponsibleRuntime`。
- **建议修法**：
  - `import type { ResponsibleRuntime } from "./taxonomy.js"` 并替换 `string`。

---

## 3. In-Scope 逐项对齐审核

> 如果存在 action-plan / design doc，就必须有这一节。
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 独立包骨架 | `done` | package.json、tsconfig、exports 完整，typecheck/test 通过。 |
| S2 | 类型体系（StorageClass / DataItemClass / PlacementHypothesis 等） | `done` | 类型设计清晰，provisional/evidence-backed/frozen 语义完整。 |
| S3 | hot/warm/cold 语义与 data item vocabulary | `done` | 19 项 catalog 条目全部落地，revisitCondition 完整。 |
| S4 | 集中的 storage key builders | `done` | DO/KV/R2 builders 存在并通过 15 项测试。 |
| S5 | NacpRef builders（r2 / kv / do-storage） | `done` | `buildR2Ref` / `buildKvRef` / `buildDoStorageRef` 完整，tenant 校验通过 16 项测试。 |
| S6 | 与 `tenant*` scoped-io 对齐的 adapter helpers | `partial` | `ScopedStorageAdapter` 存在，但缺少 `list` / `delete` 操作。 |
| S7 | provisional placement hypotheses（含 mime_type 门禁） | `partial` | 19 项 placement 全部到位，但 catalog 中仅通过 `revisitCondition` 文本提及 mime_type，无代码层面的 mime_type gate 函数。 |
| S8 | checkpoint candidate contract（含 mime_type 门禁） | `partial` | 9 个候选字段到位，但同样缺少代码层面的 mime_type gate 函数。 |
| S9 | archive / promotion / demotion plan contracts | `done` | 4+4+4 共 12 个 plan 定义完整。 |
| S10 | evidence calibration seam | `done` | `evaluateEvidence` 实现并覆盖 size/access-pattern/write-frequency 场景，10 项测试通过。 |
| S11 | README、公开导出、schema/doc 生成脚本与 fixture tests | `missing` | README 缺失，3 个集成测试 + 1 个单测 + 2 个脚本缺失。 |

### 3.1 对齐结论

- **done**: `7`
- **partial**: `3`
- **missing**: `1`

> 这更像“核心语义层与 builders 已成立，但 adapter 完整度、集成测试、文档与脚本仍未收口”的状态，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | D1 DDL / SQL schema | `遵守` | 源码中无任何 D1 相关类型或引用。 |
| O2 | production archive scheduler 本体 | `遵守` | 仅定义 plan contracts，无实际调度执行逻辑。 |
| O3 | Analytics Engine / APM / billing | `遵守` | 未涉及。 |
| O4 | 最终强绑定的小文件阈值 | `部分违反` | `calibration.ts` 硬编码 1MB，虽已标记为 provisional concept，但代码层面不可调。 |
| O5 | 完整 R2/KV/DO runtime operations orchestration | `遵守` | 仅提供 adapter interface 与 key builders。 |
| O6 | 改写 NacpRefSchema 或引入新 ref kind（如 d1） | `遵守` | 仅使用 `r2` / `kv` / `do-storage`。 |
| O7 | 跨区域复制、合规删除、TTL | `遵守` | 未涉及。 |
| O8 | `_platform/` key 例外的最终冻结 | `遵守` | `FEATURE_FLAGS` 未在 `KV_KEYS` 中实现，保持了 defer 立场，但也损失了设计文档的一致性。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **补上 `README.md`**：说明包定位、hot/warm/cold 分层、key/ref builder 用法、provisional 语义、不支持边界。
  2. **补齐缺失的测试与脚本**：至少补 `test/taxonomy.test.ts` 和 3 个集成测试（可精简但必须有）；2 个脚本可最小实现为 JSON/MD 导出。
  3. **扩展 `ScopedStorageAdapter`**：增加 `list` / `delete` 方法，以支撑 workspace 文件枚举与 audit rotation 场景。
- **可以后续跟进的 non-blocking follow-up**：
  1. 将 `calibration.ts` 的 1MB 阈值改为 `evaluateEvidence` 的可选参数。
  2. 把 `EvidenceSignal` 重构为 discriminated union，收窄 `value` 类型。
  3. 将 `ArchivePlan.responsibleRuntime` 类型从 `string` 改为 `ResponsibleRuntime`。
  4. 在 `KV_KEYS` 中补回 `featureFlags` 并加注释说明 `_platform/` 例外。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R7`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | `README.md` 缺失 | `pending` | `pending` | `pending` |
| R2 | 缺失测试与脚本 | `pending` | `pending` | `pending` |
| R3 | `ScopedStorageAdapter` 缺 list/delete | `pending` | `pending` | `pending` |
| R4 | `KV_KEYS` 缺少 `FEATURE_FLAGS` | `pending` | `pending` | `pending` |
| R5 | calibration 阈值硬编码 | `pending` | `pending` | `pending` |
| R6 | `EvidenceSignal.value` 过宽 | `pending` | `pending` | `pending` |
| R7 | `ArchivePlan.responsibleRuntime` 未收窄 | `pending` | `pending` | `pending` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`
- `{FILE_3}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**：
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> **规则**：
> 1. 二次审查人不得改写 §0–§6，只能继续 append
> 2. 二次审查必须区分：
>    - 已验证修复有效
>    - 仅部分修复
>    - 新引入问题
> 3. 必须明确“本轮是否收口”

### 7.1 二次审查结论

> 复核者: `{REVIEWER}`
> 复核时间: `{DATE}`
> 复核依据: `实现者 §6 的回应 + 当前代码事实`

- **二次结论**：`{ONE_LINE_REREVIEW_VERDICT}`
- **是否收口**：`yes | no`

### 7.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `pending` | `pending` |
| R2 | `pending` | `pending` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `pending` | `pending` | `pending` |
| R4 | `pending` | `pending` | `pending` |

### 7.4 二次收口意见

- **必须继续修改的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可后续跟进的 follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 若仍不收口，请明确写：
> `请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。`

---

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `Kimi 审查（§1–§5）与最终代码复核结果的对照`
>
> 注：本次修复的具体工作日志全部写在 `docs/code-review/storage-topology-by-GPT.md §7`，不在此重复。

### 9.1 一句话评价

**交付物清单最齐 + 几条独到发现**：Kimi 在 README / scripts / 集成测试 / `test/taxonomy.test.ts` / `ScopedStorageAdapter` 缺 `list`/`delete` / `KV_KEYS.featureFlags` / `EvidenceSignal.value` 过宽 / `ArchivePlan.responsibleRuntime: string` 八条上都命中到位（R3/R4/R6/R7 是 GPT 漏判的独家发现）。但 Kimi 把 `S5 NacpRef builders` 判 `done` 是本轮唯一但结构性的漏判。

### 9.2 优点

1. **清单类缺项全覆盖**：R1 / R2 一次性把 README / 3 个集成测试 / `taxonomy.test.ts` / 2 个脚本全部点到；和 action-plan §1.5 逐条对应。
2. **R3 独家发现（scoped-io 缺 `list`/`delete`）**：GPT 的 R1 只抓 `teamUuid` 签名，没抓 `list`/`delete`；Kimi 通过对照 `nacp-core` 的 `tenantR2List` 发现，修法签名给得非常精确。
3. **R4 独家发现（`KV_KEYS.featureFlags` 缺失）**：直接引 design doc §7.3。本轮修复顺势写清 "唯一一条 `_platform/` 例外"。
4. **R5 哲学层分析比 GPT 深**：指出 "硬编码阈值与 `所有 placement 均 provisional` 的核心设计原则冲突"；修法（`CalibrationOptions`）可直接落地。
5. **R6 / R7 独家发现**：`EvidenceSignal.value` 过宽 + `ArchivePlan.responsibleRuntime: string` 两条都是 GPT 没抓的类型健康度问题。

### 9.3 可以更好的地方

1. **协议真相层漏判（最严重）**：
   - §3 `S5 NacpRef builders` 判 `done`，§1.1 写 "`buildR2Ref` / `buildKvRef` / `buildDoStorageRef` 完整，tenant 校验通过 16 项测试"。但 `do-storage` ref 被 `validateRefKey` 明确 exempt tenant prefix——跨包 `NacpRefSchema.safeParse()` 一上来就失败。
   - §3 `S6` 判 `partial`（理由只是缺 `list`/`delete`），没注意到 `do*` 方法连 `teamUuid` 都没有，根本不能映射到 `tenantDoStoragePut/Get/Delete` 的 3 参 signature。
   - 这两条都是 GPT R1 抓到的 critical；Kimi 判 `done`/`partial` 是本轮唯一但显著的结构性漏判。
2. **R4 `featureFlags` 修法没说清 `_platform/` 的 defer 边界**：只说 "应补回"，没明确 `_platform/` 仅此一条例外。本轮在代码注释 + README 写清了。
3. **缺跨包 `safeParse` 实机证据**：Kimi §1 的 "执行过的验证" 只列 `typecheck` / `test` / `ls`，没有 "`buildDoStorageRef(...)` 对拍 `NacpRefSchema`" 级别的实机复现。正是这一步缺席让 `S5` 被判为 `done`。
4. **R2 `3 个集成测试` 名称给得很准，但没区分 blocker / follow-up**：`scoped-io-alignment.test.ts` 属 correctness blocker，`checkpoint-archive-contract.test.ts` 更接近 delivery-gap。分层会更利于实现者排期。

### 9.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 4 | 行号精准；缺跨包 `safeParse` 级实机复现 |
| 判断严谨性 | 3.5 | `NacpRef` / `scoped-io` 两条跨包漂移被判 `done` / `partial` — 结构性漏判 |
| 修法建议可执行性 | 5 | 每条都给出具体字段名 / 接口签名 / 文件位置，可直接落地 |
| 对 action-plan / design 的忠实度 | 5 | §1.5 / §4.5 / §7.3 / Q1 / Q2 全部引到行 |
| 协作友好度 | 5 | `changes-requested` + blocker / follow-up 分层合理；不夸大 |

总体 **4.3 / 5** — Kimi 在 "交付物 + 细节 correctness" 层做得最稳，独家发现率高于 GPT；但最高风险的跨包 ref / scoped-I/O 层漏判一次。与 GPT 并读时互补性极强；单独使用会错判收口节奏。
