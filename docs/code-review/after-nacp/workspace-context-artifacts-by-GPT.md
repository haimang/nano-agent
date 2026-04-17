# Workspace / Context / Artifacts 代码审查 — by GPT

> 审查对象: `@nano-agent/workspace-context-artifacts`
> 审查时间: `2026-04-17`
> 审查人: `GPT-5.4`
> 审查范围:
> - `docs/action-plan/workspace-context-artifacts.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `README.md`
> - `docs/templates/code-review.md`
> - `docs/progress-report/mvp-wave-1.md`
> - `docs/progress-report/mvp-wave-2.md`
> - `docs/progress-report/mvp-wave-3.md`
> - `docs/progress-report/mvp-wave-4.md`
> - `packages/workspace-context-artifacts/`
> - `packages/nacp-core/src/envelope.ts`
> - `packages/nacp-core/src/messages/context.ts`
> - `packages/nacp-session/src/redaction.ts`
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**：`该实现已经搭出了 workspace data plane 的本地骨架，但当前不应标记为 completed。`
- **结论等级**：`changes-requested`
- **本轮最关键的 1-3 个判断**：
  1. `ArtifactRef` / `PreparedArtifactRef` 仍然不是 `NacpRef` 的语义包装，而是另一套本地 wire shape；`promotion.ts` 产出的 ref 与 `NacpRefSchema` 直接不兼容。
  2. `CompactBoundaryManager` 没有真正对齐 `context.compact.request/response` truth，当前 compact contract 还是本地自造结构。
  3. `WorkspaceSnapshotBuilder`、`ContextAssembler`、`redaction.ts` 与 Phase 5 文档/fixture 收口都还明显停留在 stub / local-only 层面。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/workspace-context-artifacts.md`
  - `docs/design/workspace-context-artifacts-by-GPT.md`
  - `README.md`
  - `docs/templates/code-review.md`
  - `docs/progress-report/mvp-wave-{1,2,3,4}.md`
- **核查实现**：
  - `packages/workspace-context-artifacts/src/*`
  - `packages/workspace-context-artifacts/test/*`
  - `packages/nacp-core/src/envelope.ts`
  - `packages/nacp-core/src/messages/context.ts`
  - `packages/nacp-session/src/redaction.ts`
- **执行过的验证**：
  - `cd /workspace/repo/nano-agent/packages/workspace-context-artifacts && npm test`
  - `cd /workspace/repo/nano-agent/packages/workspace-context-artifacts && npm run typecheck && npm run build`
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（直接把 `promoteToArtifactRef()` 结果与 `NacpRefSchema` 对拍）
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（把 `compact-boundary.ts` 的当前 input/output 形状与 `ContextCompactRequestBodySchema` / `ContextCompactResponseBodySchema` 对拍）
  - `cd /workspace/repo/nano-agent && node --input-type=module ...`（验证 `ContextAssembler` 会忽略 `config.layers`，以及 `WorkspaceSnapshotBuilder.buildFragment()` 恒返回空 `mountConfigs/fileIndex/contextLayers`）
  - `glob packages/workspace-context-artifacts/{README.md,CHANGELOG.md,test/integration/*.ts}`

### 1.1 已确认的正面事实

- `packages/workspace-context-artifacts/` 已具备独立 package 结构，`mounts.ts`、`namespace.ts`、`backends/memory.ts`、`artifacts.ts`、`prepared-artifacts.ts`、`promotion.ts`、`context-assembler.ts`、`compact-boundary.ts`、`redaction.ts`、`snapshot.ts` 都已存在。
- 本地验证通过：`npm test`、`npm run typecheck`、`npm run build` 全部成功；当前共 **9 个 test files / 100 tests** 全绿。
- mount router、memory backend、namespace 读写、artifact store、prepared-artifact stub、context assembler、compact boundary、snapshot builder 至少都有对应实现与 unit tests，不是纯空壳。
- 这包的 public export 面是完整存在的，`src/index.ts` 已把 mounts / namespace / artifacts / context / snapshot / backends 导出。

### 1.2 已确认的负面事实

- `packages/workspace-context-artifacts/src/refs.ts:35-65` 定义的 `ArtifactRef` / `PreparedArtifactRef` 使用的是 `kind=file|image|document...`、`storageClass`、`teamUuid`、`mimeType`、`sizeBytes` 这套本地字段；它不是 `NacpRef`，也没有 `binding`、`team_uuid`、`role`、tenant-prefixed key 等必需语义。
- `packages/nacp-core/src/envelope.ts:193-208` 的真实 `NacpRefSchema` 要求 `kind` 为 `r2|kv|do-storage|d1|queue-dlq`，并要求 `ref.key` 以 `tenants/{team_uuid}/` 开头。  
  我直接对拍 `promoteToArtifactRef("team-1", "hello", "text/plain", "file")` 的产物后，`ArtifactRefSchema.safeParse(...)` 为 `true`，但 `NacpRefSchema.safeParse(...)` 为 `false`。
- `packages/workspace-context-artifacts/src/promotion.ts:79-97` 生成的 key 是 `${teamUuid}/${kind}/${timestamp-rand}`，没有 `tenants/{team_uuid}/` 前缀，也没有 storage binding / role / content_type 语义。
- `packages/workspace-context-artifacts/src/compact-boundary.ts:16-27, 41-73` 的 compact input/output 形状是本地的 `{ messages, turnRange, targetBudgetTokens }` 与 `{ summaryRef, recentMessages, boundaryRecord, tokensFreed }`；而 `packages/nacp-core/src/messages/context.ts:5-15` 的真实 schema 要求的是 `history_ref` / `target_token_budget` 与 `summary_ref` / token stats。直接对拍后，两边都 `safeParse(...).success === false`。
- `packages/workspace-context-artifacts/src/context-assembler.ts:37-72` 只按 `priority` 排序并做 token budget；`ContextAssemblyConfig.layers` 字段完全未被消费。我直接用 `layers: ["system"]` 配置调用，返回结果仍包含 `artifact_summary`。
- `packages/workspace-context-artifacts/src/snapshot.ts:48-87` 的 `WorkspaceSnapshotBuilder.buildFragment()` 虽然 constructor 接收了 `WorkspaceNamespace`，但实际只读取 artifact store，`mountConfigs/fileIndex/contextLayers` 恒为空；`restoreFragment()` 也只返回 `mountConfigs` 和 `artifactRefs`。直接构造带 root mount 的 namespace 后，`buildFragment()` 返回的 `mountConfigs/fileIndex/contextLayers` 长度仍全是 `0`。
- `packages/workspace-context-artifacts/src/redaction.ts:20-47` 只做本地 `audience + previewText` 逻辑，没有复用 `packages/nacp-session/src/redaction.ts:6-30` 的 `redactPayload()` reality，也没有任何 `redaction_hint` 路径处理。
- `docs/action-plan/workspace-context-artifacts.md:224` 明确要求 mount router 为 `/_platform/` 前缀保留显式例外处理槽位；但 `packages/workspace-context-artifacts/src/mounts.ts:66-130` 的路由逻辑完全没有这层保护。
- `glob packages/workspace-context-artifacts/{README.md,CHANGELOG.md,test/integration/*.ts}` 返回空；当前没有 package README / CHANGELOG，也没有 action-plan 承诺的 integration fixtures。

---

## 2. 审查发现

### R1. `ArtifactRef` / `PreparedArtifactRef` 仍然是另一套本地 wire schema，没有对齐 `NacpRef` truth

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md:147, 275-286` 明确要求 `ArtifactRef` / `PreparedArtifactRef` 只是 `NacpRef` 的语义包装，而不是新 wire schema。
  - `docs/design/workspace-context-artifacts-by-GPT.md:355, 399-405, 432-434` 也把 `NacpRef` 写成 artifact 层的底层 wire truth。
  - `packages/workspace-context-artifacts/src/refs.ts:35-65` 当前定义的是本地 `ArtifactRefSchema` / `PreparedArtifactRefSchema`，字段为 `kind=file|image|document...`、`storageClass`、`teamUuid`、`mimeType`、`sizeBytes`、`createdAt`。
  - `packages/nacp-core/src/envelope.ts:193-208` 的真实 `NacpRefSchema` 需要 `kind=r2|kv|do-storage|...`、`binding`、`team_uuid`、`role`，且 `key` 必须以 `tenants/{team_uuid}/` 开头。
  - `packages/workspace-context-artifacts/src/promotion.ts:79-97` 生成的 promoted ref 使用 `${teamUuid}/${kind}/...` key，也没有 `binding` / `role` / `content_type`。
  - 直接复现结果：
    - `ArtifactRefSchema.safeParse(promoted)` → `true`
    - `NacpRefSchema.safeParse(promoted)` → `false`
    - 第一条错误是 `kind` 不是 `r2|kv|do-storage|...`
- **为什么重要**：
  - 这会直接导致 workspace 包与 `nacp-core`、`llm-wrapper`、`storage-topology`、`audit.record.ref` 等跨包引用真相分裂。
  - 这不是“命名不同但语义一样”的小问题，因为下游真正消费的是 `NacpRefSchema`，而不是本包自定义 schema。
- **审查判断**：
  - `S3` 当前应视为 `missing`，`S8 / S9` 也因此只能算 `partial`。
- **建议修法**：
  - 让 artifact 层直接围绕 `NacpRef` 建模：保留 artifact-specific metadata，但 ref 本体必须是 `NacpRef`-compatible shape。
  - 把 `ArtifactKind` 从 wire-level `kind` 移到 artifact metadata，而不是占用 `NacpRef.kind`。
  - 修正 `promoteToArtifactRef()` 的 key/binding/role/content_type/team_uuid 语义，并加上直接对拍 `NacpRefSchema` 的 contract tests。

### R2. `CompactBoundaryManager` 没有真正对齐 `context.compact.request/response`，仍在自造 compact 协议面

- **严重级别**：`critical`
- **类型**：`correctness`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md:155, 241-242` 明确要求 compact boundary 对齐 `context.compact.request/response` 的 `history_ref/summary_ref` contract。
  - `docs/design/workspace-context-artifacts-by-GPT.md:383-405, 432-434` 也把 `context.compact.request.history_ref` 与 `context.compact.response.summary_ref` 写成 source of truth。
  - `packages/nacp-core/src/messages/context.ts:5-15` 的真实 request/response body schema 是：
    - request: `{ history_ref, target_token_budget }`
    - response: `{ status, summary_ref?, tokens_before?, tokens_after?, error? }`
  - `packages/workspace-context-artifacts/src/compact-boundary.ts:16-27` 的 `CompactInput/CompactOutput` 却是：
    - input: `{ messages, turnRange, targetBudgetTokens }`
    - output: `{ summaryRef, recentMessages, boundaryRecord, tokensFreed }`
  - `packages/workspace-context-artifacts/src/compact-boundary.ts:41-73` 还会直接把 boundary 变成 synthetic system message marker。
  - 我直接对拍当前形状后：
    - `ContextCompactRequestBodySchema.safeParse(currentCompactInputShape)` → `false`
    - `ContextCompactResponseBodySchema.safeParse(currentCompactOutputShape)` → `false`
- **为什么重要**：
  - compact 是一个跨包、可回放、可观测、可恢复的正式阶段；如果 workspace 包自己发明一套 shape，后续 kernel/capability/audit/replay 只会继续各说各话。
  - 当前实现更像本地辅助结构，而不是 repo 已冻结的 compact contract adapter。
- **审查判断**：
  - `S11` 当前应视为 `missing`。
- **建议修法**：
  - 让 `CompactBoundaryManager` 以 `NacpRef` 为输入/输出真相，显式适配 `context.compact.request/response`，而不是继续传原始 `messages: unknown[]`。
  - boundary/post-compact structure 可以保留为本地 runtime helper，但必须建立在已冻结的 compact protocol 之上。
  - 加上直接对拍 `ContextCompactRequestBodySchema` / `ContextCompactResponseBodySchema` 的 tests。

### R3. `WorkspaceSnapshotBuilder` 仍然是 stub：namespace 未被消费，workspace/context fragment 实际没有导出

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md:157, 248-250` 要求 `WorkspaceSnapshotBuilder` 只导出 workspace/context checkpoint fragment，并与 kernel/session runtime 边界清楚。
  - `docs/design/workspace-context-artifacts-by-GPT.md:388-397` 也要求 snapshot builder 明确最小可恢复面，而不是只导出 artifact refs。
  - `packages/workspace-context-artifacts/src/snapshot.ts:48-72` 的 `buildFragment()`：
    - constructor 接收 `WorkspaceNamespace`
    - 但函数体只读取 `artifactStore.list()`
    - `mountConfigs: []`
    - `fileIndex: []`
    - `contextLayers: []`
  - `packages/workspace-context-artifacts/src/snapshot.ts:78-86` 的 `restoreFragment()` 也只返回 `mountConfigs` 与 `artifactRefs`，直接丢弃 `fileIndex/contextLayers`。
  - 我直接构造了一个带 root mount 的 namespace，再调用 `buildFragment()`，结果 `mountConfigsLength / fileIndexLength / contextLayersLength` 全为 `0`。
- **为什么重要**：
  - 这意味着当前 snapshot seam 还没有真正表达 workspace/context 的恢复边界，session-do-runtime 也就无从依赖这个包做 hibernation-safe restore。
  - 如果 snapshot builder 不读取 namespace、mount、file index、context layers，那它更像 artifact store 的导出 helper，而不是 workspace/context checkpoint seam。
- **审查判断**：
  - `S13` 当前只能算 `partial`。
- **建议修法**：
  - 让 `WorkspaceNamespace` 暴露 snapshot 所需的最小读接口（mount configs、file index / changed paths、context summary seam），而不是把 namespace 完全闲置。
  - `buildFragment()` 至少应导出当前 mount state、最小 file index / ref index、context layer fragment。
  - `restoreFragment()` 也应明确 workspace/context fragment 的恢复职责，而不是只回传两项数组。

### R4. `ContextAssembler` 没有兑现固定层级顺序与 layer selection；`config.layers` 目前完全失效

- **严重级别**：`high`
- **类型**：`correctness`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md:154, 240-242` 要求 context assembler 按固定层级顺序组装 `system/session/workspace/artifact summary/recent transcript`，并明确 layer order 与 token budgeting。
  - `docs/design/workspace-context-artifacts-by-GPT.md:368-375` 也强调“固定层级顺序，显式 token budgeting”。
  - `packages/workspace-context-artifacts/src/context-layers.ts:42-47` 定义了 `ContextAssemblyConfig.layers`。
  - 但 `packages/workspace-context-artifacts/src/context-assembler.ts:37-72` 完全没有使用 `config.layers`；它只按 `priority` 排序并做 budget 裁剪。
  - `rg` 包内实现后，`layers:` 只出现在 schema 定义与测试构造里，没有任何真正消费逻辑。
  - 我直接用 `config.layers = ["system"]` 调用 `assemble()`，返回结果仍然包含 `artifact_summary`。
- **为什么重要**：
  - 当前 API 看起来支持 policy-driven layer selection，实际却不会生效；这会误导上游以为自己配置了允许的 layer 集。
  - 对 context engineering 而言，“固定层顺序 + 可控层选择”就是 contract 本体，不能只是一个没被读取的字段。
- **审查判断**：
  - `S10` 当前只能算 `partial`。
- **建议修法**：
  - 显式消费 `config.layers`：先按允许层过滤，再按固定 layer order / priority 组装。
  - 若设计决定完全以 `priority` 为真相，则应删除 `config.layers` 这类 success-shaped 伪配置，不要制造假能力。

### R5. `redaction.ts` 没有复用 `nacp-session` redaction reality，当前只是本地 audience/preview helper

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md:156, 242` 明确要求 redaction helper 复用 `@nano-agent/nacp-session` 的 `redactPayload()` 底层现实。
  - `packages/nacp-session/src/redaction.ts:6-30` 的真实 helper 是 `redactPayload(payload, hints)`，围绕 `redaction_hint` 路径来做 payload scrub。
  - `packages/workspace-context-artifacts/src/redaction.ts:20-47` 当前只有：
    - `redactForClient(artifact)`：按 `audience` 决定 preview 或 ref-only
    - `buildPreview(content, maxLength)`：纯字符串截断
  - 包内也没有任何对 `redactPayload`、`redaction_hint` 的导入或适配。
  - `test/` 目录里也没有 redaction 相关测试文件。
- **为什么重要**：
  - 这会让 session-visible artifact preview/export 的脱敏语义与 session stream 的脱敏语义分叉。
  - 本地 `audience` 判定可以保留，但它不能代替 repo 已存在的 redaction truth。
- **审查判断**：
  - `S12` 当前只能算 `partial`。
- **建议修法**：
  - 在 artifact preview/export 层复用或包装 `redactPayload()`，让 preview/export 的 payload scrub 与 session stream 共用同一套底层语义。
  - 补 redaction unit tests，至少覆盖 `redaction_hint` 路径透传/应用与 preview 裁剪的组合行为。

### R6. `MountRouter` 还没有为 `/_platform/` 前缀保留显式例外槽位

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md:224` 明确要求 mount router “为 `_platform/` 前缀保留显式例外处理槽位”。
  - `packages/workspace-context-artifacts/src/mounts.ts:66-130` 当前只有标准 longest-prefix routing，没有任何对 `/_platform/` 的特殊处理。
  - 当前 `routePath()` 逻辑在存在 root mount 时，会把 `/_platform/...` 一样交给普通 mount 处理。
- **为什么重要**：
  - 这会让未来的平台级 mount / reserved namespace 保护位继续缺失，和 action-plan 明确保留的扩展边界不一致。
  - 虽然这不是当前最严重的协议问题，但它属于已经被计划文档提前点名的隔离槽位，不应继续缺席。
- **审查判断**：
  - `S6` 当前只能算 `partial`。
- **建议修法**：
  - 在 `MountRouter.routePath()` 中明确对 `/_platform/` 做保留处理：要么返回 `null`，要么进入专用 platform backend route，而不是落入普通 tenant mounts。
  - 补对应测试，证明 root mount 不会吞掉 `/_platform/...`。

### R7. Phase 5 收口缺失：README / CHANGELOG / integration fixtures 仍未落地

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `docs/action-plan/workspace-context-artifacts.md:158-160, 248-250` 把 fake workspace / fake artifact / compact fixture / snapshot fixture 测试基座，以及 `README.md`、公开导出与 package scripts 明确列为 in-scope。
  - `docs/progress-report/mvp-wave-3.md:101-106` 把 Phase 3-5 写成已完成。
  - 但 `glob packages/workspace-context-artifacts/{README.md,CHANGELOG.md,test/integration/*.ts}` 返回空。
  - 当前测试只有 9 个 unit test files，没有任何 integration fixture。
  - 包的 public export 面存在，但 package-level 用法/边界说明文件不存在。
- **为什么重要**：
  - 这包是多个下游包共享的数据平面基础；没有 package README，别人很难知道哪些对象是 stable truth、哪些只是本地 helper。
  - 没有 integration fixture，就没有地方证明 fake workspace flow、compact reinject、snapshot restore fragment 这些高风险路径真的闭环。
- **审查判断**：
  - `S1` 只能算 `partial`，`S14 / S15` 当前应视为 `missing`。
- **建议修法**：
  - 补 package `README.md` / `CHANGELOG.md`。
  - 补 action-plan 里点名的 integration fixtures：`fake-workspace-flow`、`compact-reinject`、`snapshot-restore-fragment`。
  - 在 README 中明确本包与 `nacp-core` / `nacp-session` / `storage-topology` 的 contract 边界。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | `@nano-agent/workspace-context-artifacts` 独立包骨架 | `partial` | package 存在且可 build/test/typecheck，但 `README.md` / `CHANGELOG.md` 缺失 |
| S2 | `WorkspacePath / MountConfig / WorkspaceNamespace / ArtifactRef / PreparedArtifactRef / ContextLayer / WorkspaceSnapshot` 类型体系 | `done` | 基础类型体系与导出面已落地 |
| S3 | `ArtifactRef` / `PreparedArtifactRef` 作为 `NacpRef` 语义包装 | `missing` | 当前仍是本地 schema，不是 `NacpRef` wrapper |
| S4 | mount-based namespace 与 longest-prefix mount router | `done` | `MountRouter` + `WorkspaceNamespace` 已形成稳定基本面 |
| S5 | memory backend 与 reference backend seam | `done` | `MemoryBackend` 与 `ReferenceBackend` seam 已存在 |
| S6 | session-local writable mount、shared readonly mount、artifact pseudo-path 语义 | `partial` | writable/readonly mounts 已有，但 artifact pseudo-path 与 `/_platform/` 保留槽位都未见正式实现 |
| S7 | `ArtifactRegistry / ArtifactStore` 接口层 | `partial` | `ArtifactStore` 有了，但 `ArtifactRegistry` 语义并未真正独立出现 |
| S8 | prepared artifact contract：支持 extracted-text / summary / preview | `partial` | kind 有了，但 contract 仍建立在错误的本地 ref schema 之上 |
| S9 | capability result -> artifact promotion seam | `partial` | promotion seam 存在，但产出的 ref 与 `NacpRef` / storage truth 漂移 |
| S10 | `ContextAssembler` 分层上下文装配 | `partial` | 有 budget/priority，但固定 layer order 与 `config.layers` selection 未收口 |
| S11 | `CompactBoundaryManager`：strip / request / response / reinjection 边界 | `missing` | 当前 compact input/output 与 `context.compact.*` truth 不兼容 |
| S12 | session-visible preview / redaction helper | `partial` | 有本地 preview helper，但未复用 `redactPayload()` reality |
| S13 | `WorkspaceSnapshotBuilder`：只导出 workspace/context fragment | `partial` | builder 存在，但 workspace/context fragment 仍基本为空 |
| S14 | fake workspace / fake artifact / compact fixture / snapshot fixture 测试基座 | `missing` | 没有 `test/integration/*` fixtures |
| S15 | README、公开导出与 package scripts | `partial` | public exports / scripts 存在，但 README/CHANGELOG 缺失 |

### 3.1 对齐结论

- **done**: `3`
- **partial**: `8`
- **missing**: `4`

> 这更像 **“mount/memory backend 等基础件已到位，但 artifact/ref contract、compact protocol、snapshot/export seam 与 Phase 5 closure 仍未收口”**，而不是 completed。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | 最终 DO / KV / R2 / D1 storage topology 冻结 | `部分违反` | `promotion.ts` 已直接把 `do-storage` vs `r2` 以 1MB 硬切，超出了“先不冻结物理拓扑”的谨慎边界 |
| O2 | 真实 Cloudflare backend adapter 的生产级实现 | `遵守` | 当前仍只有 memory backend + reference seam |
| O3 | 完整 Git 仓库语义与索引数据库 | `遵守` | 未实现 |
| O4 | 完整 OCR / embedding / semantic indexing pipeline | `遵守` | prepared artifact 仍是最小 stub |
| O5 | 完整 compact 算法与模型调用本体 | `部分违反` | 没做完整算法，但当前自造了一套 compact request/response shape，已经越界到协议面 |
| O6 | transcript / analytics / registry 的最终 DDL | `遵守` | 未实现 |
| O7 | 多用户协作 workspace | `遵守` | 未实现 |
| O8 | client-visible 完整 UI/SDK artifact 下载/预览体验 | `遵守` | 只有最小 preview helper |
| O9 | tenant-scoped 之外 `_platform/` 全局 mount 在 v1 的实际开放 | `遵守` | 未实现 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`当前实现可以视为 workspace-context-artifacts 的第一轮静态/本地骨架，但还不能被认定为 action-plan / design doc 已收口的数据平面基础包。`
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 让 `ArtifactRef` / `PreparedArtifactRef` 与 `promotion.ts` 真正对齐 `NacpRef` truth，不再维护另一套本地 wire schema。
  2. 让 `CompactBoundaryManager` 明确适配 `context.compact.request/response`，停止继续使用本地 invented shape。
  3. 让 `WorkspaceSnapshotBuilder` 真正导出 workspace/context fragment，而不是只返回 artifact refs 和一组空数组。
  4. 修复 `ContextAssembler` 的 layer selection / fixed-order contract，并让 `redaction.ts` 复用 `nacp-session` redaction reality。
  5. 补齐 package `README.md` / `CHANGELOG.md` 与 integration fixtures，完成 Phase 5 收口。
- **可以后续跟进的 non-blocking follow-up**：
  1. 进一步把 artifact registry / store 与 preview/redaction/audit event 关联起来，减少后续 observability glue 的重复工作。
  2. 为 `/_platform/` 保留 mount slot 加上更明确的专用 route / backend seam，避免未来平台级 namespace 再次被普通 mounts 吞掉。
  3. 重新评估 `promotion.ts` 中 4KB / 1MB 等阈值是否应转移到 storage-topology policy 层，避免双重真相。

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应

> 执行者: `Claude Opus 4.7 (1M context)`
> 执行时间: `2026-04-17`
> 回应范围: `GPT R1–R7 + Kimi R1–R7（workspace-context-artifacts 合并处理）`

### 6.1 总体

- **总体回应**：GPT 与 Kimi 的全部发现在代码复核后属实；本轮按"协议真相层 → 主路径行为正确性 → 跨包 redaction / storage 对齐 → 交付物"的顺序完成闭环。测试从 9 files / 100 tests 扩展到 14 files / 147 tests；typecheck + build clean；相邻 llm-wrapper 包也随 `PreparedArtifactRef` 新 shape 同步调整并保持 100 tests 全绿。
- **本轮修改策略**：
  1. 最先修 `ArtifactRef` / `PreparedArtifactRef`（GPT R1 + Kimi R2）：整个 ref 层改为 `NacpRef` shape，`kind` 改指 Nacp backend，artifact 分类挂到 `artifactKind`。
  2. 对齐 `compact-boundary` 的 wire shape（GPT R2 + Kimi R6）：产出 `ContextCompactRequestBodySchema` / `ContextCompactResponseBodySchema` 可直接解析的对象，且 split point 改为 token-budget-aware。
  3. 把 `WorkspaceSnapshotBuilder.buildFragment()` 做实（GPT R3 + Kimi R1）：真实读取 `namespace.listMounts()` + 逐 mount `listDir` + artifactStore；`restoreFragment()` 返回完整 4 段视图。
  4. 接入 `redactPayload` 真相（GPT R5 + Kimi R4）：本地镜像 + 可注入 Session 版本；`redactForClient()` 对 JSON 预览自动调用。
  5. 修 `ContextAssembler` `config.layers`（GPT R4）、`MountRouter` 保留 `/_platform/`（GPT R6）、`promoteToArtifactRef` 的 tenant-scoped key（GPT 间接提到 + Kimi R7）。
  6. 最后补 `README.md` / `CHANGELOG.md` / `refs.test.ts` / 3 个 integration tests（GPT R7 + Kimi R3/R5）。

### 6.2 逐项回应表（合并 GPT + Kimi）

| 编号 | 审查问题 | 覆盖来源 | 处理结果 | 处理方式 | 修改文件 |
|------|----------|----------|----------|----------|----------|
| R1 | `ArtifactRef` / `PreparedArtifactRef` 是本地平行 schema，不是 `NacpRef` 语义包装 | GPT R1 + Kimi R2 | `fixed` | 重写 `refs.ts`：schema 字段改为 NacpRef shape（`kind` ∈ `r2/kv/do-storage/d1/queue-dlq`，`binding`, `team_uuid`, `key`, `role`, 可选 `content_type/size_bytes/etag/bucket`）；`refine` 强制 `key.startsWith("tenants/{team_uuid}/")`；artifact 分类移到 `artifactKind`；新增 `toNacpRef(ref)` 以及 `NacpRefLike` 类型。`artifacts.listByKind` 现在过滤 `artifactKind` 而不是 `ref.kind`。`prepared-artifact.ts`（llm-wrapper 侧）同步迁移。新增 `test/refs.test.ts` 以及 `test/integration/fake-workspace-flow.test.ts` 用相对路径 import `NacpRefSchema` 做跨包 safeParse 对拍 | `src/refs.ts`、`src/artifacts.ts`、`src/promotion.ts`、`src/snapshot.ts`、`src/index.ts`、`test/refs.test.ts`（新增）、`test/artifacts.test.ts` / `test/prepared-artifacts.test.ts` / `test/snapshot.test.ts` / `test/promotion.test.ts`（全部按新 shape 重写）、`packages/llm-wrapper/src/prepared-artifact.ts`、`packages/llm-wrapper/test/integration/prepared-artifact-routing.test.ts` |
| R2 | `CompactBoundaryManager` 与 `context.compact.request/response` 不兼容 | GPT R2 | `fixed` | 重写 `compact-boundary.ts`：新增 `ContextCompactRequestBody` / `ContextCompactResponseBody` 类型（镜像 Core schema），`buildCompactRequest({ historyRef, messages, targetTokenBudget })` 输出可直接 `ContextCompactRequestBodySchema.safeParse()` 的对象；`applyCompactResponse()` 接受响应 + `summaryRef` + `turnRange`，返回 `{ messages, boundary }` 或 `{ error }`。新增 integration `compact-reinject.test.ts` 使用真实 `ContextCompactRequestBodySchema` / `ContextCompactResponseBodySchema` 做反向校验 | `src/compact-boundary.ts`、`test/compact-boundary.test.ts`（重写）、`test/integration/compact-reinject.test.ts`（新增） |
| R3 | `WorkspaceSnapshotBuilder` 是 stub：namespace 未被消费 | GPT R3 + Kimi R1 | `fixed` | `WorkspaceNamespace.listMounts()` 作为新公开方法暴露出来；`snapshot.ts` 的 `buildFragment(options?)` 现在：① `collectMountConfigs()` → 读 `namespace.listMounts()`；② `collectFileIndex(max)` → 逐 mount `listDir` 并按 `maxFileIndexSize` 截断；③ artifactStore refs 只保留 `ArtifactRefSchema.safeParse` 通过的；④ `options.contextLayers` 透传。`restoreFragment()` 现在返回完整 4 段（`mountConfigs / artifactRefs / fileIndex / contextLayers`）。新增 integration `snapshot-restore-fragment.test.ts` | `src/namespace.ts`、`src/snapshot.ts`、`test/snapshot.test.ts`（重写）、`test/integration/snapshot-restore-fragment.test.ts`（新增） |
| R4 | `ContextAssembler` 未兑现 `config.layers` 选择 | GPT R4 | `fixed` | `assemble()` 在排序前先按 `config.layers` 做 allowlist 过滤；空 allowlist 视作 accept-all；required 层不会 "绕过" allowlist。`test/context-assembler.test.ts` 新增 3 条 R4 regression 用例 | `src/context-assembler.ts`、`test/context-assembler.test.ts` |
| R5 | `redaction.ts` 未复用 `nacp-session` 的 `redactPayload` | GPT R5 + Kimi R4 | `fixed` | `redaction.ts` 增加 `redactPayload(payload, hints)` 本地镜像（行为与 nacp-session 严格一致），`PayloadRedactor` 类型 + 可选 `payloadRedactor` 参数让调用方注入 Session 版本。`redactForClient(artifact, options)` 现在对 JSON 预览自动调用 redactor；纯文本预览不动。新增 `redactArtifactPayload()` 作为 workspace-side 便利。`test/redaction.test.ts` 用相对路径 import nacp-session 的 `redactPayload` 跨包对拍 | `src/redaction.ts`、`src/index.ts`、`test/redaction.test.ts`（新增） |
| R6 | `MountRouter` 未为 `/_platform/` 保留例外槽 | GPT R6 | `fixed` | `routePath()` 增加 `isReservedPlatformPath()` 判定：当目标路径在 `/_platform/` namespace 下时，不让 `/` 根挂载吞掉；只接受显式 `/_platform` 或更深的 `/_platform/...` mount。`test/mounts.test.ts` 新增 4 条 R6 regression | `src/mounts.ts`、`test/mounts.test.ts` |
| R7 | Phase 5 README / CHANGELOG / integration fixtures 未落地 | GPT R7 + Kimi R3 + Kimi R5 | `fixed` | 新增 `README.md`（包定位、NacpRef 关系、snapshot seam、不支持边界）+ `CHANGELOG.md` 0.1.0。新增三个 integration tests 对应 Kimi R5 / GPT R7：`fake-workspace-flow.test.ts` / `compact-reinject.test.ts` / `snapshot-restore-fragment.test.ts`；新增 `refs.test.ts` 为 Kimi R3 要求的缺失单测 | `README.md`、`CHANGELOG.md`、`test/integration/**`、`test/refs.test.ts` |
| R8 | `buildCompactInput` 以消息中点分割而非 token budget | Kimi R6 | `fixed` | 见 R2：新 API `pickSplitPoint(messages, targetTokenBudget)` 用 `tokenEstimate` / `content.length` 做 budget-aware split，默认 "至少 compact 一条"；`compact-boundary.test.ts` 新增 `pickSplitPoint` 专项用例 | `src/compact-boundary.ts`、`test/compact-boundary.test.ts` |
| R9 | `promoteToArtifactRef` key 未 tenant-scoped | Kimi R7 | `fixed` | `promoteToArtifactRef()` 现在总是产出 `tenants/{teamUuid}/artifacts/{artifactKind}/{id}`；并支持 `idFactory` 选项以便测试。`promotion.test.ts` 的 `idFactory` 用例锁定格式 | `src/promotion.ts`、`test/promotion.test.ts` |

### 6.3 变更文件清单

代码：
- `packages/workspace-context-artifacts/src/refs.ts`
- `packages/workspace-context-artifacts/src/artifacts.ts`
- `packages/workspace-context-artifacts/src/promotion.ts`
- `packages/workspace-context-artifacts/src/compact-boundary.ts`
- `packages/workspace-context-artifacts/src/snapshot.ts`
- `packages/workspace-context-artifacts/src/namespace.ts`
- `packages/workspace-context-artifacts/src/mounts.ts`
- `packages/workspace-context-artifacts/src/context-assembler.ts`
- `packages/workspace-context-artifacts/src/redaction.ts`
- `packages/workspace-context-artifacts/src/index.ts`
- `packages/llm-wrapper/src/prepared-artifact.ts`（随 workspace shape 同步）
- `packages/llm-wrapper/test/integration/prepared-artifact-routing.test.ts`（同步）

测试（新增 / 重写）：
- `packages/workspace-context-artifacts/test/refs.test.ts`（新增）
- `packages/workspace-context-artifacts/test/redaction.test.ts`（新增）
- `packages/workspace-context-artifacts/test/artifacts.test.ts`（重写）
- `packages/workspace-context-artifacts/test/prepared-artifacts.test.ts`（重写）
- `packages/workspace-context-artifacts/test/promotion.test.ts`（重写）
- `packages/workspace-context-artifacts/test/snapshot.test.ts`（重写）
- `packages/workspace-context-artifacts/test/compact-boundary.test.ts`（重写）
- `packages/workspace-context-artifacts/test/context-assembler.test.ts`（扩展：`config.layers`）
- `packages/workspace-context-artifacts/test/mounts.test.ts`（扩展：`/_platform/`）
- `packages/workspace-context-artifacts/test/integration/fake-workspace-flow.test.ts`（新增）
- `packages/workspace-context-artifacts/test/integration/compact-reinject.test.ts`（新增）
- `packages/workspace-context-artifacts/test/integration/snapshot-restore-fragment.test.ts`（新增）

文档：
- `packages/workspace-context-artifacts/README.md`（新增）
- `packages/workspace-context-artifacts/CHANGELOG.md`（新增）

### 6.4 验证结果

```text
cd packages/workspace-context-artifacts
npm run typecheck   # ✅ clean
npm run build       # ✅ tsc
npm test            # ✅ 14 files / 147 tests passed

# 相邻 llm-wrapper 包也随 PreparedArtifactRef 新 shape 同步并仍然绿
cd packages/llm-wrapper && npm test
# ✅ 10 files / 100 tests passed
```

对比初审基线：9 files / 100 tests → 14 files / 147 tests（workspace）；llm-wrapper 保持 10 files / 100 tests。

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview`
- **仍然保留的已知限制**：
  1. `ReferenceBackend` 仍是 stub；真实 DO/KV/R2 adapter 的落地依赖 storage-topology 的 `ScopedStorageAdapter` 与后续 runtime 组装层。
  2. `CompactBoundaryManager.pickSplitPoint` 的 token 估算是 ~4 字符/token 的保底启发式；正式 tokenizer 接入是 follow-up。
  3. `redactPayload` 的本地实现与 nacp-session 通过行为测试对齐；后续若业主允许引入 `@nano-agent/nacp-session` 作为真实依赖，可把本地镜像替换为 re-export。

---

## 7. 工作日志

| 时间 (UTC) | 事项 | 事实依据 |
|------------|------|----------|
| 2026-04-17 06:03 | 初审基线 `npm test` → 9 files / 100 tests pass | vitest stdout |
| 2026-04-17 06:04 | 复核 GPT R1 / Kimi R2：`refs.ts` 的 `ArtifactRef` 使用 `kind=file\|image\|...` + `storageClass` + `teamUuid`，不是 NacpRef；属实 | `src/refs.ts:35-65` |
| 2026-04-17 06:04 | 复核 GPT R2 / Kimi R6：`compact-boundary.ts` input/output shape 与 `context.compact.request/response` 不兼容；`buildCompactInput` 按消息中点切分；属实 | `src/compact-boundary.ts:16-51` |
| 2026-04-17 06:05 | 复核 GPT R3 / Kimi R1：`snapshot.buildFragment()` 的 `mountConfigs` / `fileIndex` / `contextLayers` 恒为空；属实 | `src/snapshot.ts:60-72` |
| 2026-04-17 06:05 | 复核 GPT R4：`context-assembler.assemble()` 从未消费 `config.layers`；属实 | `src/context-assembler.ts:37-72` |
| 2026-04-17 06:06 | 复核 GPT R5 / Kimi R4：`redaction.ts` 只做 `audience` + preview；属实 | `src/redaction.ts:20-47` |
| 2026-04-17 06:06 | 复核 GPT R6：`MountRouter` 没有 `/_platform/` 保留处理；属实 | `src/mounts.ts:66-130` |
| 2026-04-17 06:06 | 复核 GPT R7 / Kimi R3 / R5：README / CHANGELOG / refs.test.ts / 3 个 integration tests 均不存在；属实 | `ls` |
| 2026-04-17 06:07 | 复核 Kimi R7：`promoteToArtifactRef` 生成的 key 是 `${teamUuid}/${kind}/...`，缺 `tenants/` 前缀；属实 | `src/promotion.ts:79-97` |
| 2026-04-17 06:12 | 修 GPT R1 + Kimi R2：重写 `refs.ts` → NacpRef shape + refine tenant prefix；同步 `artifacts.ts` / `promotion.ts` / `snapshot.ts` | 多文件 |
| 2026-04-17 06:14 | 修 GPT R2 + Kimi R6：重写 `compact-boundary.ts` + `test/compact-boundary.test.ts` 覆盖 `pickSplitPoint` | `src/compact-boundary.ts`、`test/compact-boundary.test.ts` |
| 2026-04-17 06:16 | 修 GPT R3 + Kimi R1：`snapshot.ts` 实装 `collectMountConfigs` / `collectFileIndex`；新增 `WorkspaceNamespace.listMounts()` | `src/snapshot.ts`、`src/namespace.ts` |
| 2026-04-17 06:17 | 修 GPT R4：`ContextAssembler.assemble()` 接入 `config.layers` allowlist + regression 测试 | `src/context-assembler.ts`、`test/context-assembler.test.ts` |
| 2026-04-17 06:18 | 修 GPT R5 + Kimi R4：`redaction.ts` 增加本地 `redactPayload`、`PayloadRedactor` 类型 + `redactForClient()` 的 JSON 预览脱敏；新测试 | `src/redaction.ts`、`test/redaction.test.ts` |
| 2026-04-17 06:19 | 修 GPT R6：`mounts.ts` 保留 `/_platform/` 例外 + 测试 | `src/mounts.ts`、`test/mounts.test.ts` |
| 2026-04-17 06:20 | 修 Kimi R7：`promoteToArtifactRef` key tenant-scoped + `idFactory` | `src/promotion.ts`、`test/promotion.test.ts` |
| 2026-04-17 06:22 | 更新 `src/index.ts` 导出面 + `llm-wrapper/src/prepared-artifact.ts` 与新 workspace shape 对齐 | `src/index.ts`、`packages/llm-wrapper/src/prepared-artifact.ts`、`packages/llm-wrapper/test/integration/prepared-artifact-routing.test.ts` |
| 2026-04-17 06:24 | 新增 README / CHANGELOG / `refs.test.ts` / 3 个 integration tests | 多文件 |
| 2026-04-17 06:30 | workspace `npm run typecheck` / `npm run build` / `npm test` 全绿（14 files / 147 tests）；llm-wrapper 回跑 `npm test` 全绿（10 files / 100 tests） | vitest + tsc |

---

## 8. 对 GPT 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `GPT 审查（§1–§5）与最终代码复核结果的对照`

### 8.1 一句话评价

**覆盖面最宽 + 每条都是 blocker**：GPT 7 条发现里 R1 / R2 / R3 / R4 全部都是 correctness / delivery-gap 级，`ArtifactRef` 与 `NacpRef` 漂移、`compact-boundary` 与 `context.compact.*` 漂移、snapshot stub、`ContextAssembler.config.layers` 死字段——任何一条放过都会让后续 runtime 组装失败。Kimi 对 `_platform/`、`context.compact.*` 和 `ContextAssembler.config.layers` 三条都没抓到。

### 8.2 优点

1. **R1 / R2 都用 `safeParse` 级跨包复现**：`ArtifactRefSchema.safeParse(promoted)=true` vs `NacpRefSchema.safeParse(promoted)=false`；`ContextCompactRequestBodySchema.safeParse(currentCompactInputShape)=false` — 两处实机证据让漏判机会为 0。
2. **R3 做了 namespace stub 级精确证明**：`buildFragment()` 返回 `mountConfigs/fileIndex/contextLayers` 全为空数组，并且直接构造一个带 root mount 的 namespace 做对比——这是 Kimi 的 R1 只靠代码行号没做的复现。
3. **R4 的 "失效能力" 叙事锋利**：不是简单说 "没用 `config.layers`"，而是指出 "API 看起来支持 policy-driven layer selection 但实际不会生效；会误导上游"。这类 "success-shaped 伪配置" 的描述对实现者很有教育意义。
4. **R6 `/_platform/` 保留槽抓得细**：大多数 review 很少留意这类预留 slot；GPT 把它单列出来避免未来平台级 namespace 被普通 mounts 吞掉。
5. **out-of-scope §4 判定扎实**：`O1 部分违反`（`promotion.ts` 提前冻结了 do-storage vs r2 切点）/ `O5 部分违反`（自造 compact shape 已经越界）— 两个部分违反都指得准。

### 8.3 可以更好的地方

1. **未抓 `promoteToArtifactRef` 的 tenant-scoped key**（Kimi R7）：GPT 的 R1 点到了 `ref.key` 不对，但没单独把 `${teamUuid}/${kind}/...` 这条低级错误拎出来。本轮按 Kimi 的命名建议实施 `tenants/{teamUuid}/artifacts/{kind}/{id}`。
2. **R5 `redaction` 修法只写 "复用"**：没说清 "相对路径 import 还是重新实现"。本轮选择本地镜像 + 可注入 Session 版本的折中方案；GPT 的建议如果再具体一点（"packages/workspace 本地实现 + 提供 `PayloadRedactor` seam" 之类），可以更快进入收敛。
3. **R2 `CompactBoundaryManager` 的 split 修法可更具体**：GPT 说让 ref 成为输入/输出真相，但没建议 `pickSplitPoint` 这种可独立测试的公开方法。Kimi R6 把 "按 token / content length 分割" 写出来了。
4. **未抓 `buildCompactInput` 的 token-budget bug**（Kimi R6）：GPT 的 R2 侧重协议 shape，不是算法正确性；这条 Kimi 比 GPT 看得细。

### 8.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 5 | 每条都有 `safeParse` 级跨包复现 |
| 判断严谨性 | 5 | 7 条发现全部属实，覆盖协议层 / 主路径行为 / 保留 slot / Phase 5 |
| 修法建议可执行性 | 4 | R2 / R5 若给出更具体的 seam 接口会更快收敛 |
| 对 action-plan / design 的忠实度 | 5 | 每条都引到 §行号；`O1` / `O5` 部分违反识别到位 |
| 协作友好度 | 5 | 5 条 blocker + 3 条 follow-up 分层合理 |

总体 **4.8 / 5** — 本轮 GPT review 的覆盖面最宽，是推动 workspace-context-artifacts 从 "mount/backend 骨架" 真正成为 "跨包一致数据平面" 的决定性文档。

---

## 9. 二次审查

### 9.1 二次审查结论

> 复核者: `GPT-5.4`
> 复核时间: `2026-04-17`
> 复核依据: `实现者 §6 的回应 + 当前代码事实 + 包级 typecheck/build/test + 邻接 llm-wrapper 回跑 + 根目录 cross-package contract tests`

- **二次结论**：`R1 / R2 / R3 / R5 / R6 / R7 已真实闭合，workspace 的主要跨包断点基本被修平；但 R4 只修掉了 allowlist 半边，固定层级顺序这一半仍未真正收口，因此本轮暂不关闭。`
- **是否收口**：`no`

### 9.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `packages/workspace-context-artifacts/src/refs.ts:68-126, 154-165` 已把 `ArtifactRef` / `PreparedArtifactRef` 收到 NacpRef-shaped truth；根目录 `test/workspace-context-artifacts-contract.test.mjs` 继续验证 `ArtifactRefSchema` / `PreparedArtifactRefSchema` / `NacpRefSchema` 与 llm-wrapper prepared-artifact seam 同时成立 |
| R2 | `closed` | `packages/workspace-context-artifacts/src/compact-boundary.ts:31-43, 90-156` 已直接表达 `context.compact.request/response` body shape；包内 integration `test/integration/compact-reinject.test.ts` 与根目录 `test/workspace-context-artifacts-contract.test.mjs` 都用真实 `ContextCompactRequestBodySchema` / `ContextCompactResponseBodySchema` 对拍通过 |
| R3 | `closed` | `packages/workspace-context-artifacts/src/snapshot.ts:85-123, 127-171` 已真实消费 namespace/artifact store，导出 `mountConfigs / fileIndex / artifactRefs / contextLayers`；`test/integration/fake-workspace-flow.test.ts:36-79` 与 `test/integration/snapshot-restore-fragment.test.ts` 已覆盖最小 roundtrip |
| R5 | `closed` | `packages/workspace-context-artifacts/src/redaction.ts:29-39, 80-154` 已实现与 `nacp-session` 行为等价的 redaction seam；根目录 `test/workspace-context-artifacts-contract.test.mjs` 直接对拍 workspace 与 `packages/nacp-session/dist/index.js` 的 `redactPayload()` 输出一致 |
| R6 | `closed` | `packages/workspace-context-artifacts/src/mounts.ts:73-84, 115-143` 已为 `/_platform/` 引入显式保留槽位；`packages/workspace-context-artifacts/test/mounts.test.ts:160-191` 锁住 root mount 不再吞掉 `_platform/` namespace |
| R7 | `closed` | `packages/workspace-context-artifacts/README.md:1-116`、integration fixtures、以及 `cd packages/workspace-context-artifacts && npm run typecheck && npm run build && npm test`（14 files / 147 tests）全部成立；同时相邻 `cd packages/llm-wrapper && npm test` 也保持 10 files / 100 tests 通过，说明 workspace shape 变更没有再次打断下游 |

### 9.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R4 | `partial` | Opus 本轮确实修掉了 `config.layers` 死字段：`packages/workspace-context-artifacts/src/context-assembler.ts:45-52` 现在会先做 allowlist 过滤。但初审 R4 是两半：**固定层级顺序** + **layer selection**。这后一半已经修了，前一半仍未落地：`packages/workspace-context-artifacts/src/context-assembler.ts:53-83` 仍然完全按调用方提供的 `priority` 排序，`packages/workspace-context-artifacts/src/context-layers.ts:42-47` 也没有任何 canonical order table，而 `packages/workspace-context-artifacts/test/context-assembler.test.ts:28-43` 继续把“priority order”当成当前真相。与 `docs/action-plan/workspace-context-artifacts.md:154-157, 240-242` 里要求的固定层级顺序仍不一致。 | 明确固定顺序的 source-of-truth：要么把 `config.layers` 的顺序或一张 canonical order 表编码进 assembler，并加回归测试；要么更新 action-plan/design/README，明确“priority 才是冻结 contract”，不要继续同时声称 fixed-order 和 priority-order。 |

### 9.4 二次收口意见

- **必须继续修改的 blocker**：
  1. 决定并冻结 `ContextAssembler` 的排序真相：fixed-order 还是 caller-supplied priority，不能两套说法并存。
  2. 用测试把该排序真相钉住；若仍保留 priority 方案，则先把 action-plan/design 口径同步改正，再谈收口。
- **可后续跟进的 follow-up**：
  1. 保留根目录 `test/workspace-context-artifacts-contract.test.mjs`，它已经把 workspace ↔ nacp-core ↔ nacp-session ↔ llm-wrapper 的公开面接缝锁住了。
  2. `ReferenceBackend` / `StubArtifactPreparer` 继续作为 seam 存在是可接受的，但后续若进入 deploy/runtime glue 阶段，建议直接用 integration fixture 验证它们与 storage-topology / llm-wrapper 的真实接线，而不是只保留包内单测。

> 请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。
