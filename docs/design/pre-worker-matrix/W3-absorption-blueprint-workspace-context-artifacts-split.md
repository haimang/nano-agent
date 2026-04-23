# Blueprint — `workspace-context-artifacts` Split → `context-core` + `filesystem-core`

> 类型：representative blueprint / split-package  
> 状态：pre-worker-matrix 可直接消费  
> 直接上游：`W3-absorption-map.md`、`W3-absorption-pattern.md`  
> 相关原始素材：
> - `packages/workspace-context-artifacts/package.json`
> - `packages/workspace-context-artifacts/src/index.ts`
> - `packages/workspace-context-artifacts/src/backends/*`
> - `packages/workspace-context-artifacts/src/mounts.ts`
> - `packages/workspace-context-artifacts/src/namespace.ts`
> - `packages/workspace-context-artifacts/src/context-assembler.ts`
> - `packages/workspace-context-artifacts/src/compact-boundary.ts`
> - `packages/workspace-context-artifacts/src/snapshot.ts`
> - `packages/workspace-context-artifacts/src/evidence-emitters.ts`
> - `packages/session-do-runtime/src/workspace-runtime.ts`
> - `packages/session-do-runtime/src/do/nano-session-do.ts`

## 1. 为什么它是代表性 blueprint

`workspace-context-artifacts` 是 pre-worker-matrix 里最典型的 split-package：

1. 它既有 context 侧对象（assembler / compact / snapshot）
2. 又有 filesystem 侧 substrate（mounts / namespace / backends）
3. 还夹着 mixed helper（尤其 `evidence-emitters.ts`）
4. 并且今天已经被 `session-do-runtime` 真实消费

所以它最能代表 worker-matrix 里真正棘手的吸收类型：  
**不是整包搬家，而是“按职责切片后分送两个 worker，再保住 agent-core 的 live consumer path”。**

## 2. 当前代码事实

### 2.1 package-level reality

- `packages/workspace-context-artifacts/package.json`
  - 当前版本：`0.1.0`
  - **实测当前直接依赖**(`dependencies` 字段):
    - `@haimang/nacp-core`(workspace:\*)— 协议层 wire vocabulary 与 evidence anchor
    - `@nano-agent/storage-topology`(workspace:\*)— tenant/ref/key law 与 storage placement
  - 这是 pre-worker-matrix 阶段唯一一个**同时跨 Tier A(NACP)与 Tier B(storage-topology)**的 Tier B 包,也是 split 难点集中来源
- `src/index.ts` 已把整个 package public surface 汇总成一个统一出口
- 实测 LOC:src ~2543,evidence-emitters.ts 含 `buildAssemblyEvidence / buildCompactEvidence / buildSnapshotEvidence / buildArtifactEvidence` 四类(+ 各自 `emit*Evidence` 包装)+ `EvidenceAnchorLike / EvidenceSinkLike` 结构类型

### 2.2 直接跨包依赖事实

| 事实 | 代码锚点 |
|---|---|
| package 真实依赖 storage-topology | `package.json`、`src/backends/memory.ts`、`src/backends/reference.ts` |
| session host 真实消费该 package | `packages/session-do-runtime/src/workspace-runtime.ts`、`.../do/nano-session-do.ts` |

## 3. 建议切片结果

## 3.1 `context-core` 侧

建议归入 `context-core` 的主文件：

- `context-layers.ts`
- `context-assembler.ts`
- `compact-boundary.ts`
- `redaction.ts`
- `snapshot.ts`

说明：

- 这些文件共同定义“如何组装上下文、何时 compact、如何形成 snapshot / compact boundary”的主语义
- 它们是 `context-core` 的核心价值，而不是文件系统 substrate

## 3.2 `filesystem-core` 侧

建议归入 `filesystem-core` 的主文件：

- `types.ts`
- `paths.ts`
- `refs.ts`
- `artifacts.ts`
- `prepared-artifacts.ts`
- `promotion.ts`
- `mounts.ts`
- `namespace.ts`
- `backends/memory.ts`
- `backends/reference.ts`
- `backends/types.ts`

说明：

- 这些文件承载 workspace path truth、artifact lifecycle、mount/backends 路由、reference-backed storage substrate
- 它们与 `storage-topology` 的耦合也更自然地收敛到 `filesystem-core`

## 3.3 mixed helper：`evidence-emitters.ts`

这是本 blueprint 的关键难点。

建议拆法：

| helper | 建议 owner |
|---|---|
| `buildAssemblyEvidence` / `emitAssemblyEvidence` | `context-core` |
| `buildCompactEvidence` / `emitCompactEvidence` | `context-core` |
| `buildSnapshotEvidence` / `emitSnapshotEvidence` | `context-core` |
| `buildArtifactEvidence` / `emitArtifactEvidence` | `filesystem-core` |
| `EvidenceAnchorLike` / `EvidenceSinkLike` 结构类型 | 保持极薄 structural seam；不应阻塞 split |

额外纪律：

- sink durable owner 仍然更接近 `agent-core` / eval plane
- 不应因为 `emit*Evidence()` 存在，就把整份文件整体判给 `agent-core`

## 4. 建议目标目录

```text
workers/context-core/src/
  context-layers.ts
  context-assembler.ts
  compact-boundary.ts
  redaction.ts
  snapshot.ts
  evidence/
    assembly.ts
    compact.ts
    snapshot.ts

workers/filesystem-core/src/
  types.ts
  paths.ts
  refs.ts
  artifacts.ts
  prepared-artifacts.ts
  promotion.ts
  mounts.ts
  namespace.ts
  backends/
    memory.ts
    reference.ts
    types.ts
  evidence/
    artifact.ts
```

## 5. 对 `session-do-runtime` / `agent-core` 的含义

当前 `session-do-runtime` 通过统一 package 出口消费：

- `ContextAssembler`
- `CompactBoundaryManager`
- `WorkspaceSnapshotBuilder`
- `InMemoryArtifactStore`
- `MountRouter`
- `WorkspaceNamespace`

因此 worker-matrix first-wave 吸收时，不能要求 `agent-core` 一步完成完全重构。更合理的路径是：

1. 先按本 blueprint 在 `context-core` / `filesystem-core` 内建立 owner 目录
2. `agent-core` 在共存期通过薄 adapter 或 staged import 切换到新位置
3. 等真实 consumer 全部切完，再考虑旧 package deprecated / 物理删除

## 6. 测试继承方案

| 当前测试面 | 建议落点 |
|---|---|
| context assembly / compact / snapshot tests | `workers/context-core/test/` |
| mounts / namespace / backend / artifact tests | `workers/filesystem-core/test/` |
| cross-worker evidence / snapshot / checkpoint tests | 继续留 root |

## 7. 主要风险

1. **按目录粗暴二分**  
   会把 mixed helper 与 live consumer path 处理坏。

2. **先删 package 再切 consumer**  
   `session-do-runtime` 当前是真实 consumer，不能被 blueprint 误伤。

3. **把 snapshot 简化成纯 context 或纯 filesystem**  
   snapshot 是 bridge object，必须承认它天然跨 context/filesystem 边界。

## 8. 一句话 verdict

这份 blueprint 已经把 `workspace-context-artifacts` 这个最危险的 split-package 收窄成了可执行方案：**按职责切 context/filesystem，mixed evidence helper 分拆处理，agent-core consumer 走 staged cut-over，而不是一次性大爆破。**

## 9. worker-matrix 下 D03 / D04 / D05 消费本 blueprint 的要点(reality-check)

进入 worker-matrix 后,本 blueprint 作为 C2/D1 split 代表样本被 D03(context-core)、D04(filesystem-core)、D05(initial-context host consumer)直接引用。以下事实锚点需要对齐,本 blueprint §3.3 mixed helper 表 / §4 目标目录不改结构:

1. **mixed helper 所有 context 侧 helper + 2 个结构类型归 `workers/context-core/src/evidence/`(per D03 §7 F3)** — 具体行映射:`buildAssemblyEvidence/emitAssemblyEvidence → evidence/assembly.ts`,`buildCompactEvidence/emitCompactEvidence → evidence/compact.ts`,`buildSnapshotEvidence/emitSnapshotEvidence → evidence/snapshot.ts`;`EvidenceAnchorLike / EvidenceSinkLike` 保持极薄 structural seam,随 context-core 落地但不阻塞 D04 split。
2. **mixed helper 的 artifact 侧 helper 归 `workers/filesystem-core/src/evidence/artifact.ts`(per D04 §4 D1 slice)** — `buildArtifactEvidence/emitArtifactEvidence` 在 D04 PR 合并时才搬;D03 先合并的共存期内原文件保留 artifact helper 行,不提前剔除。
3. **`appendInitialContextLayer(assembler, payload)` helper 归 context-core(per D03 §7 F4 / P1-P5 GPT review R1)** — 本 blueprint §3.1 context-core 主文件清单扩一条:顶层 `appendInitialContextLayer` helper 不挂在 `ContextAssembler` 上,也不发明 `initial_context` layer kind;helper 维护 assembler 之外的 pending layers list,把 payload 映射成 canonical `session` / `injected` ContextLayer;host 在 `assemble(...)` 入参合并 pending list。
4. **`ContextAssembler` public API 当前仅 `assemble(layers: ContextLayer[]): AssemblyResult` + `setEvidenceWiring()`** — 无 `appendLayer()` mutator;本 blueprint §3.1 "context-assembler.ts" 搬迁保持现有 API 形态不扩面,加 helper 不等于扩 assembler surface。
5. **`ContextLayerKindSchema` 合法枚举为 6 项:`system / session / workspace_summary / artifact_summary / recent_transcript / injected`** — 本 blueprint §3.1 "context-layers.ts" 搬迁保持现有枚举不扩;D05 consumer / F4 helper 不得自造 `initial_context` 等新 kind,必须映射到已有 6 项中的合法一项。
6. **D04 side 的 D1 slice 依赖 `@nano-agent/storage-topology`** — 本 blueprint §2.1 的 "跨 Tier A + Tier B" 事实在 D04 合并后通过 `workers/filesystem-core/src/storage/` 内部化(storage-topology D2 unit 同批搬);本 blueprint §4 filesystem-core 目标目录结构保持不变,D04 action-plan 负责 storage substrate 的 tenant wrapper 边界。
7. **session-do-runtime 侧 live consumer path** — `packages/session-do-runtime/src/workspace-runtime.ts` + `.../do/nano-session-do.ts` 的 consumer 切换采用 staged cut-over;D03 / D04 合并后 host shell 共存期通过薄 adapter 指向新位置,共存期不删 `packages/workspace-context-artifacts/`;物理删除归 D09 deprecation。
