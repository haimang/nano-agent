# Nano-Agent 代码审查模板

> 审查对象: `@nano-agent/workspace-context-artifacts`
> 审查时间: `2026-04-17`
> 审查人: `Kimi`
> 审查范围:
> - `docs/action-plan/workspace-context-artifacts.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `packages/workspace-context-artifacts/src/**`
> - `packages/workspace-context-artifacts/test/**`
> 文档状态: `reviewed`

---

## 0. 总结结论

> 该包的领域模型、mount router、namespace、artifact store、context assembler、compact boundary 等核心骨架均已落地，100 项测试全部通过。但 README 缺失，3 个集成测试与 `refs.test.ts` 缺失，`WorkspaceSnapshotBuilder` 未真正实现 namespace/file 状态捕获，`ArtifactRef` 未基于 `NacpRefSchema` 包装而是重新发明了字段结构，`redaction.ts` 也未接入 `nacp-session` 的底层 redaction 现实。这些缺口使其作为“下游 capability/kernel/llm 可直接接入的统一数据模型”尚未完全收口。

- **整体判断**：workspace namespace、artifact registry、context assembly、compact boundary 的单元逻辑已成立；但 snapshot builder 流于形式、refs 未对齐 NACP、redaction 未复用 nacp-session、集成测试与文档大面积缺失。
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `WorkspaceSnapshotBuilder.buildFragment()` 返回的 `mountConfigs` 和 `fileIndex` 恒为空数组，未从 `WorkspaceNamespace` 中读取任何实际状态，使 snapshot 功能成为空壳。
  2. `ArtifactRef` 是独立字段对象（`kind`、`storageClass`、`teamUuid`、`key`…），而非对 `NacpRefSchema` 的语义包装，直接违背了 design doc 与 action-plan 的显式约束。
  3. `README.md`、3 个集成测试、`test/refs.test.ts` 完全缺失，导致 action-plan Phase 5 的 Definition of Done 未达成。

---

## 1. 审查方法与已核实事实

> 这一节只写事实，不写结论。
> 明确你看了哪些文件、跑了哪些命令、核对了哪些计划项/设计项。

- **对照文档**：
  - `docs/action-plan/workspace-context-artifacts.md`
  - `docs/design/workspace-context-artifacts-by-GPT.md`
  - `docs/progress-report/mvp-wave-{1,2,3,4}.md`
  - `README.md`
- **核查实现**：
  - `packages/workspace-context-artifacts/src/version.ts`
  - `packages/workspace-context-artifacts/src/types.ts`
  - `packages/workspace-context-artifacts/src/paths.ts`
  - `packages/workspace-context-artifacts/src/refs.ts`
  - `packages/workspace-context-artifacts/src/context-layers.ts`
  - `packages/workspace-context-artifacts/src/snapshot.ts`
  - `packages/workspace-context-artifacts/src/mounts.ts`
  - `packages/workspace-context-artifacts/src/namespace.ts`
  - `packages/workspace-context-artifacts/src/artifacts.ts`
  - `packages/workspace-context-artifacts/src/prepared-artifacts.ts`
  - `packages/workspace-context-artifacts/src/promotion.ts`
  - `packages/workspace-context-artifacts/src/context-assembler.ts`
  - `packages/workspace-context-artifacts/src/compact-boundary.ts`
  - `packages/workspace-context-artifacts/src/redaction.ts`
  - `packages/workspace-context-artifacts/src/backends/types.ts`
  - `packages/workspace-context-artifacts/src/backends/memory.ts`
  - `packages/workspace-context-artifacts/src/backends/reference.ts`
  - `packages/workspace-context-artifacts/src/index.ts`
  - `packages/workspace-context-artifacts/test/namespace.test.ts`
  - `packages/workspace-context-artifacts/test/mounts.test.ts`
  - `packages/workspace-context-artifacts/test/artifacts.test.ts`
  - `packages/workspace-context-artifacts/test/prepared-artifacts.test.ts`
  - `packages/workspace-context-artifacts/test/promotion.test.ts`
  - `packages/workspace-context-artifacts/test/context-assembler.test.ts`
  - `packages/workspace-context-artifacts/test/compact-boundary.test.ts`
  - `packages/workspace-context-artifacts/test/snapshot.test.ts`
  - `packages/workspace-context-artifacts/test/backends/memory.test.ts`
- **执行过的验证**：
  - `pnpm --filter @nano-agent/workspace-context-artifacts typecheck`
  - `pnpm --filter @nano-agent/workspace-context-artifacts test`
  - `ls packages/workspace-context-artifacts/README.md` → 不存在
  - `ls packages/workspace-context-artifacts/test/refs.test.ts` → 不存在
  - `ls packages/workspace-context-artifacts/test/integration/` → 不存在

### 1.1 已确认的正面事实

- 16 个源文件全部存在，类型检查零错误，100 项测试全部通过（9 个测试文件）。
- `MountRouter` 实现了最长前缀匹配，并正确拒绝部分段匹配（如 `/work` 不匹配 `/workspace`），14 项测试覆盖。
- `WorkspaceNamespace` 封装了 CRUD + list/stat/delete，正确拦截 readonly mount 的写/删操作，18 项测试覆盖。
- `MemoryBackend` 实现了完整的 read/write/list/stat/delete，支持目录前缀扫描，20 项测试覆盖。
- `ContextAssembler` 按 priority 排序、required 优先、预算截断逻辑正确，7 项测试覆盖。
- `InMemoryArtifactStore` 支持 register/get/list/listByKind，9 项测试覆盖。
- `CompactBoundaryManager` 的 strip/reinject 与 boundary record 累积逻辑完整，8 项测试覆盖。
- `promotion.ts` 的大小阈值与 MIME type 策略完整，12 项测试覆盖。

### 1.2 已确认的负面事实

- `packages/workspace-context-artifacts/README.md` 不存在。
- `test/refs.test.ts` 不存在（action-plan §1.5 明确列出）。
- `test/integration/` 不存在，缺失 action-plan §1.5 列出的 3 个集成测试：
  - `fake-workspace-flow.test.ts`
  - `compact-reinject.test.ts`
  - `snapshot-restore-fragment.test.ts`
- `WorkspaceSnapshotBuilder.buildFragment()` 中 `mountConfigs` 和 `fileIndex` 被硬编码为空数组（`snapshot.ts:66-67`），未从 `WorkspaceNamespace` 提取任何实际状态。
- `ArtifactRefSchema` 定义了独立的 `{ kind, storageClass, teamUuid, key, mimeType, sizeBytes, createdAt }`，未复用 `packages/nacp-core/src/envelope.ts` 的 `NacpRefSchema`。
- `redaction.ts` 只实现了字符串截断与简单的 `audience` 分支，未调用 `@nano-agent/nacp-session` 的 `redactPayload()`。
- `WorkspaceSnapshotBuilder` 的 constructor 接收 `WorkspaceNamespace` 和 `ArtifactStore`，但 `buildFragment()` 仅使用了 `artifactStore.list()`，未使用 `namespace` 参数提取 mount 配置或文件索引。

---

## 2. 审查发现

> 使用稳定编号：`R1 / R2 / R3 ...`
> 每条 finding 都应包含：严重级别、事实依据、为什么重要、审查判断。
> 只写真正影响 correctness / security / scope / delivery 的问题，不写样式意见。

### R1. `WorkspaceSnapshotBuilder` 未实现真正的 snapshot 功能

- **严重级别**：`critical`
- **类型**：`scope-drift`
- **事实依据**：
  - `packages/workspace-context-artifacts/src/snapshot.ts:60-72`：`buildFragment()` 方法返回的对象中，`mountConfigs: []`、`fileIndex: []`、`contextLayers: []` 均为硬编码空数组。
  - 方法签名接收 `private namespace: WorkspaceNamespace`，但实现中完全未读取 namespace 的 router 状态或文件列表。
  - action-plan §5.5 明确要求 snapshot builder “只导出 workspace/context fragment”，且 §4.5 收口标准写明“恢复边界被显式声明”。
- **为什么重要**：
  - Snapshot 是 session hibernation/resume 的核心。如果 snapshot 不捕获 mount 配置和文件索引，resume 后 workspace 状态将完全丢失，导致 fake bash / capability runtime 在恢复后看到空工作区。
- **审查判断**：
  - 这是功能性缺失，必须修复。`buildFragment()` 至少应通过 `namespace` 提取当前 mount configs（从 router）和文件索引（通过 backend list 遍历），否则 snapshot 毫无意义。
- **建议修法**：
  - 在 `WorkspaceNamespace` 中暴露 `listMounts()` 或 `getRouter()`，使 builder 能提取 mount configs；
  - 遍历 mounts 并调用 backend list 构建 `fileIndex`；
  - 若 `contextLayers` 由调用方注入，应在 builder API 中显式提供注入接口（如 `buildFragment(contextLayers?)`）。

### R2. `ArtifactRef` 未基于 `NacpRefSchema` 包装，而是重新发明了字段结构

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `packages/workspace-context-artifacts/src/refs.ts:35-43`：
    ```typescript
    export const ArtifactRefSchema = z.object({
      kind: ArtifactKindSchema,
      storageClass: StorageClassSchema,
      teamUuid: z.string(),
      key: z.string(),
      mimeType: z.string().optional(),
      sizeBytes: z.number().int().min(0).optional(),
      createdAt: z.string(),
    });
    ```
  - `packages/nacp-core/src/envelope.ts` 已定义 `NacpRefSchema = z.object({ kind, binding, team_uuid, key, role, extra })`。
  - design doc §7.2a 和 action-plan §5.1 均明确要求：`ArtifactRef` 是 `NacpRef` 的语义包装，不另起 ref schema。
- **为什么重要**：
  - 重新发明 ref 结构会导致 workspace 包与 nacp-core 在 wire format 上分裂，使 `ArtifactRef` 无法直接作为 NACP envelope 的 payload 传输，后续需要昂贵的映射层。
- **审查判断**：
  - 必须将 `ArtifactRef` 重构为基于 `NacpRefSchema` 的扩展（如 `ArtifactRefSchema = NacpRefSchema.extend({ kind: ArtifactKindSchema, sizeBytes: ..., ... })`），或至少保证底层字段与 `NacpRef` 1:1 对齐（如 `teamUuid` → `team_uuid`、`storageClass` → `binding`）。
- **建议修法**：
  - 引入 `@nano-agent/nacp-core` 依赖，导入 `NacpRefSchema`；
  - `ArtifactRefSchema = NacpRefSchema.extend({ artifactKind: ..., mimeType: ..., sizeBytes: ..., createdAt: ... })`；
  - 同步更新 `promoteToArtifactRef`、`buildR2Ref` 等 consumers。

### R3. `README.md` 缺失

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md` §1.5 目录树与 §4.5 `P5-03` 均要求 `README.md`。
  - `packages/workspace-context-artifacts/README.md` 不存在。
- **为什么重要**：
  - 本包需要向 capability runtime、llm-wrapper、kernel 说明 mount model、artifact-first path、prepared artifact 范围与 snapshot 边界。缺少 README 会严重阻碍下游接入。
- **审查判断**：
  - 必须补充。内容至少覆盖：包定位、mount-based workspace 说明、ArtifactRef 与 NacpRef 关系、ContextAssembler 用法、snapshot seam 边界、不支持项清单。

### R4. `redaction.ts` 未复用 `@nano-agent/nacp-session` 的 redaction 现实

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - `packages/workspace-context-artifacts/src/redaction.ts` 仅包含 `redactForClient()`（按 `audience` 分支）和 `buildPreview()`（字符串截断）。
  - action-plan §4.4 `P4-03` 明确写明：“并明确复用 `@nano-agent/nacp-session` 的 `redactPayload()` 底层现实”。
  - design doc §1.2 也提到 `Redaction Scope` 应与 `NACP-Session` 对齐。
- **为什么重要**：
  - 自己实现 redaction 会导致 WebSocket-first 与 HTTP fallback 两条路径的脱敏逻辑不一致，增加安全泄漏风险。
- **审查判断**：
  - 应在 `redaction.ts` 中导入 `nacp-session` 的 `redactPayload()` 作为底层实现，并在此基础上增加 workspace-specific 的 preview/audience 逻辑；若当前 nacp-session 版本未导出该函数，应在代码中显式标注 `TODO` 与阻塞条件。

### R5. 缺失 1 个单测文件和 3 个集成测试文件

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 明确列出：
    - `test/refs.test.ts`
    - `test/integration/fake-workspace-flow.test.ts`
    - `test/integration/compact-reinject.test.ts`
    - `test/integration/snapshot-restore-fragment.test.ts`
  - 上述文件均不存在。
- **为什么重要**：
  - `refs.test.ts` 需要验证 `ArtifactRef` 与 `PreparedArtifactRef` 的构造和 schema 行为；3 个集成测试是 Phase 5 的收口标准，验证 fake workspace、compact reinject、snapshot restore 的端到端路径。
- **审查判断**：
  - 必须补齐。集成测试可以精简，但至少要覆盖 action-plan 声明的关键场景。

### R6. `CompactBoundaryManager.buildCompactInput` 使用消息数量中点而非 token 预算

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/workspace-context-artifacts/src/compact-boundary.ts:41-51`：
    ```typescript
    const splitPoint = Math.max(1, Math.floor(messages.length / 2));
    const turnRange = `0-${splitPoint - 1}`;
    ```
  - 参数 `budget: number` 被传入为 `targetBudgetTokens`，但完全未被用来决定 split point。
- **为什么重要**：
  - 按消息数量对半分完全忽略了消息的实际 token 长度，可能导致 compact 后仍然远超预算，或过度 compact 短消息。这与 design doc §F5 要求的“compact 输入裁剪必须正式建模”冲突。
- **审查判断**：
  - `buildCompactInput` 应使用 token estimate（如果 messages 携带 token 元数据）或至少按内容长度做更合理的启发式分割，而不是简单对半分。
- **建议修法**：
  - 在 `messages` 元素上假定存在 `tokenEstimate` 或 `content.length` 属性，从末尾向前累加直到接近 budget，以此确定 split point；或明确标注此为 stub 实现并说明后续需接入 kernel 的 token 计数。

### R7. `promoteToArtifactRef` 生成的 key 未对齐 storage-topology 的 tenant-scoped 约定

- **严重级别**：`medium`
- **类型**：`correctness`
- **事实依据**：
  - `packages/workspace-context-artifacts/src/promotion.ts:92`：
    ```typescript
    key: `${teamUuid}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ```
  - `storage-topology` 和 `nacp-core` 要求 R2/KV key 必须以 `tenants/{team_uuid}/` 开头。
- **为什么重要**：
  - 该 key 若直接用于 R2 存储，会违反 tenant-scoped namespace 约束，导致 storage-topology 的 `validateRefKey()` 失败，也可能引发多租户隔离问题。
- **审查判断**：
  - `promoteToArtifactRef` 生成的 key 应使用 `storage-topology` 的 `R2_KEYS.attachment()` 或至少遵循 `tenants/{teamUuid}/...` 前缀。
- **建议修法**：
  - 将 key 格式改为 `tenants/${teamUuid}/artifacts/${kind}/${Date.now()}-${...}`，或引入 `storage-topology` 的 key builder。

---

## 3. In-Scope 逐项对齐审核

> 如果存在 action-plan / design doc，就必须有这一节。
> 结论统一使用：`done | partial | missing | out-of-scope-by-design`。

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 独立包骨架 | `done` | package.json、tsconfig、exports 完整，typecheck/test 通过。 |
| S2 | 类型体系（WorkspacePath / MountConfig / ArtifactRef / ContextLayer / WorkspaceSnapshot） | `partial` | 类型存在，但 `ArtifactRef` 未对齐 `NacpRefSchema`。 |
| S3 | ArtifactRef 作为 NacpRef 语义包装 | `missing` | 当前是独立字段对象，非 NacpRef 包装。 |
| S4 | mount-based namespace 与 longest-prefix router | `done` | `MountRouter` + `WorkspaceNamespace` 完整，32 项测试通过。 |
| S5 | memory backend 与 reference backend seam | `done` | `MemoryBackend` + `ReferenceBackend` + `WorkspaceBackend` 接口完整，20 项测试通过。 |
| S6 | session-local writable / shared readonly / artifact pseudo-path | `partial` | router 支持任意 mount point，但 artifact pseudo-path 未在代码中显式建模或测试。 |
| S7 | ArtifactRegistry / ArtifactStore 接口层 | `done` | `InMemoryArtifactStore` 实现完整，9 项测试通过。 |
| S8 | prepared artifact contract（extracted-text / summary / preview） | `done` | `StubArtifactPreparer` 覆盖 3 类，6 项测试通过。 |
| S9 | capability result -> artifact promotion seam | `done` | `shouldPromoteResult` + `promoteToArtifactRef` 完整，12 项测试通过。 |
| S10 | ContextAssembler 分层装配 | `done` | 优先级排序、required、预算截断完整，7 项测试通过。 |
| S11 | CompactBoundaryManager strip/reinject 边界 | `partial` | reinject 与 boundary record 完整，但 `buildCompactInput` 未按 token budget 分割。 |
| S12 | redaction helper（复用 nacp-session redactPayload） | `missing` | 当前为独立简单实现，未复用 nacp-session。 |
| S13 | WorkspaceSnapshotBuilder 只导出 fragment | `partial` | builder 存在，但 `buildFragment()` 未提取 namespace 状态，输出为空壳。 |
| S14 | fake workspace / fake artifact / compact / snapshot fixture 测试 | `partial` | 单元测试覆盖充分，但 3 个集成测试与 `refs.test.ts` 缺失。 |
| S15 | README、公开导出 | `missing` | README 不存在。 |

### 3.1 对齐结论

- **done**: `7`
- **partial**: `5`
- **missing**: `3`

> 这更像“namespace/router/artifact/context 的核心单元逻辑已成立，但 snapshot 流于形式、refs 未对齐 NACP、redaction 未复用 nacp-session、集成测试与文档仍未收口”的状态，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 最终 DO/KV/R2/D1 storage topology 冻结 | `遵守` | 仅实现 memory backend + reference seam，未写死物理存储。 |
| O2 | 真实 Cloudflare backend adapter 生产级实现 | `遵守` | `ReferenceBackend` 明确为 stub。 |
| O3 | 完整 Git 仓库语义与索引数据库 | `遵守` | 未涉及。 |
| O4 | 完整 OCR / embedding / semantic indexing | `遵守` | `StubArtifactPreparer` 仅做 3 类最小 prepared artifact。 |
| O5 | 完整 compact 算法与模型调用本体 | `遵守` | compact 仅定义边界与 stub input builder。 |
| O6 | transcript / analytics / registry 的最终 DDL | `遵守` | 未涉及。 |
| O7 | 多用户协作 workspace | `遵守` | 未涉及。 |
| O8 | client-visible 完整 UI/SDK 下载预览体验 | `遵守` | 仅提供 `buildPreview` 字符串截断。 |
| O9 | `_platform/` 全局 mount 在 v1 实际开放 | `遵守` | 代码中无 `_platform/` 特殊处理，保持了 defer 立场。 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`changes-requested`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. **修复 `WorkspaceSnapshotBuilder.buildFragment()`**：必须实际从 `WorkspaceNamespace` 提取 mount configs 和 file index，而不是返回空数组。
  2. **重构 `ArtifactRef` 以基于 `NacpRefSchema`**：确保 artifact 层不对 NACP wire truth 造成分裂。
  3. **补上 `README.md`**：明确说明 mount model、artifact-first path、NacpRef 关系、不支持边界。
  4. **补齐缺失的测试**：`test/refs.test.ts` + 3 个集成测试（可精简但必须有最小覆盖）。
- **可以后续跟进的 non-blocking follow-up**：
  1. 在 `redaction.ts` 中接入 `nacp-session` 的 `redactPayload()`（若当前版本未导出，则标注 TODO）。
  2. 改进 `buildCompactInput` 的 token-aware split heuristic。
  3. 修正 `promoteToArtifactRef` 的 key 生成逻辑，使其遵循 `tenants/{teamUuid}/...` 前缀。

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
| R1 | snapshot builder 空壳 | `pending` | `pending` | `pending` |
| R2 | ArtifactRef 未对齐 NacpRef | `pending` | `pending` | `pending` |
| R3 | README 缺失 | `pending` | `pending` | `pending` |
| R4 | redaction 未复用 nacp-session | `pending` | `pending` | `pending` |
| R5 | 缺失测试文件 | `pending` | `pending` | `pending` |
| R6 | compact input 未按 token 分割 | `pending` | `pending` | `pending` |
| R7 | promotion key 未 tenant-scoped | `pending` | `pending` | `pending` |

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
> 注：本次修复的具体工作日志全部写在 `docs/code-review/workspace-context-artifacts-by-GPT.md §7`，不在此重复。

### 9.1 一句话评价

**主路径行为发现极好 + 独到低级错误命中率高**：Kimi R1（snapshot stub）、R2（ArtifactRef 非 NacpRef 包装）、R6（buildCompactInput 按消息数量切）、R7（promotion key 非 tenant-scoped）四条都是真正的 correctness issue，其中 R6 / R7 是 GPT 漏判的独家发现。但 Kimi 对 `/_platform/` 保留 slot（GPT R6）和 `ContextAssembler.config.layers` 死字段（GPT R4）这两条 contract-level 漂移完全没抓。

### 9.2 优点

1. **R1 snapshot stub 命中精准**：直接引 `snapshot.ts:60-72` 指出 `mountConfigs: []`、`fileIndex: []`、`contextLayers: []` 硬编码空数组；修法建议 "暴露 `listMounts()` + 遍历 backend list" 和本轮实施一一吻合。
2. **R6 `buildCompactInput` 按消息数量切的 bug 是独家发现**：GPT 的 R2 只关注协议 shape 不对，没注意到算法正确性问题。Kimi 进一步给出 "从末尾向前累加直到接近 budget" 的具体修法；本轮实施的 `pickSplitPoint` 就是这个思路。
3. **R7 `promoteToArtifactRef` key 非 tenant-scoped 的独家发现**：GPT 的 R1 只点到 `ref.key` 不对，没单独把 `${teamUuid}/${kind}/...` 这条低级错误拎出来。Kimi R7 修法直接给了 `tenants/${teamUuid}/artifacts/${kind}/${...}` 的目标字符串。
4. **R2 / R3 / R4 / R5 清单类缺项齐全**：refs.test.ts、3 个集成测试、README、redaction 复用——全部在收口前补齐。
5. **引用精准到行**：`snapshot.ts:60-72`、`compact-boundary.ts:41-51`、`promotion.ts:92` 都是实行号，不留模糊空间。

### 9.3 可以更好的地方

1. **`/_platform/` 保留 slot 漏判**（GPT R6）：Kimi §3 `S6 session-local / shared readonly / artifact pseudo-path` 判 `partial` 但没写 `_platform/` 这条。本轮 GPT R6 才把它作为 medium 级 correctness 拎出来。
2. **`ContextAssembler.config.layers` 死字段漏判**（GPT R4）：Kimi §3 `S10 ContextAssembler 分层装配` 判 `done`，但实际 `config.layers` 完全不被消费——这是 "success-shaped 伪配置" 级问题，Kimi 没注意到。GPT R4 抓到了。
3. **R2 `ArtifactRef` 分析停留在 schema 层**：Kimi 指出 `ArtifactRef` 不是 NacpRef 包装，但没具体讲 "artifact 分类应该移到 `artifactKind`，NacpRef `kind` 改指 backend" 这一层的语义清理。GPT R1 的 "ArtifactKind 从 wire-level `kind` 移到 artifact metadata" 一句话把分工讲清了；本轮 refs.ts 重写按 GPT 的切法做。
4. **R4 `redaction` 修法太保守**：只说 "导入 nacp-session 的 redactPayload 作为底层实现"，实际上 workspace 还不方便硬加 nacp-session 依赖。本轮按 GPT R5 的含意做成 "本地镜像 + 可注入 Session 版本" 的折中。
5. **缺 `O1 部分违反` / `O5 部分违反` 的识别**（GPT §4）：Kimi 的 out-of-scope §4 全部标 "遵守"；实际 `promotion.ts` 提前冻结了 4KB / 1MB 阈值、`compact-boundary.ts` 自造 compact shape 都已经越界到 `out-of-scope`。GPT 把这两条标为 "部分违反"，Kimi 没注意。

### 9.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 4.5 | 行号精准；缺跨包 `safeParse` / 真实运行时复现 |
| 判断严谨性 | 4 | 4 条发现都属实且独到；`_platform/` 与 `config.layers` 两条漂移漏判 |
| 修法建议可执行性 | 5 | R1 / R6 / R7 的修法直接落地，字段名 / 路径 / 接口签名都到位 |
| 对 action-plan / design 的忠实度 | 5 | §1.5 / §4.5 / §4.4 P4-03 引用精确 |
| 协作友好度 | 5 | `changes-requested` + blocker / follow-up 分层合理 |

总体 **4.5 / 5** — Kimi 在 "主路径行为正确性 + 低级字段格式 bug" 这一层抓得比 GPT 细，R6 / R7 是 GPT 漏判的关键独家发现。与 GPT 并读时互补极强：GPT 覆盖协议真相 + 保留 slot + 死字段；Kimi 覆盖 snapshot 主路径 + split 算法 + key 格式 + 清单类缺项。
