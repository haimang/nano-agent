# filesystem.core — realized code evidence

> 目标：只基于**当前仓库代码与当前测试**，回答 `filesystem.core` 已经实现了什么、还缺什么、哪些只是 handle。

---

## 0. 先给结论

**`filesystem.core` 现在最准确的代码判断是：mount-based workspace substrate 已经真实存在，storage adapters 也已经真实存在，fake-bash file/search/vcs 也已经能消费这套 truth；但 remote filesystem worker 默认接线仍不存在，因此它今天更像“已经 load-bearing 的本地 foundation”，而不是“已独立部署的 worker”。**

---

## 1. 原始素材召回表

### 1.1 substrate 核心代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| mount router | `packages/workspace-context-artifacts/src/mounts.ts` | `1-10,58-85,115-157` | 证明 longest-prefix route + reserved namespace 已存在 |
| namespace | `packages/workspace-context-artifacts/src/namespace.ts` | `17-27,33-39,45-56,62-80,86-120` | 证明统一 file ops surface 已存在 |
| memory backend | `packages/workspace-context-artifacts/src/backends/memory.ts` | `9-19,29-39,68-78` | 证明 memory backend 已与 DO size-cap truth 对齐 |
| reference backend | `packages/workspace-context-artifacts/src/backends/reference.ts` | `7-29,58-80,120-140,180-197` | 证明 connected/not-connected 双模式与 R2 promotion 已存在 |
| artifact refs | `packages/workspace-context-artifacts/src/refs.ts` | `4-21,68-96,113-166` | 证明 artifact/prepared refs 已 NacpRef-shaped |
| promotion | `packages/workspace-context-artifacts/src/promotion.ts` | `21-33,107-143` | 证明 artifact promotion 已按大小在 `do-storage/r2` 间分层 |
| snapshot | `packages/workspace-context-artifacts/src/snapshot.ts` | `122-184,188-232` | 证明 snapshot fragment 真实读取 mounts/files/artifacts |

### 1.2 storage/platform 代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| keys | `packages/storage-topology/src/keys.ts` | `17-32,38-64,70-85` | 证明 DO/KV/R2 key patterns 已存在 |
| refs | `packages/storage-topology/src/refs.ts` | `31-53,67-79,128-166` | 证明 cross-package storage refs 已 tenant-prefixed |
| placement | `packages/storage-topology/src/placement.ts` | `22-57,98-120,157-207` | 证明 placement 仍是 provisional + MIME-gated |
| calibration | `packages/storage-topology/src/calibration.ts` | `14-18,75-171,177-240` | 证明 evidence-driven recalibration seam 已存在 |
| DO adapter | `packages/storage-topology/src/adapters/do-storage-adapter.ts` | `73-178` | 证明 DO size pre-check + transaction 已实现 |
| R2 adapter | `packages/storage-topology/src/adapters/r2-adapter.ts` | `63-187` | 证明 R2 list cursor + listAll + putParallel 已实现 |

### 1.3 consumer / runtime 代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| path law | `packages/capability-runtime/src/capabilities/workspace-truth.ts` | `11-30,32-57,60-157` | 证明 file/search/vcs 统一 path universe |
| filesystem handlers | `packages/capability-runtime/src/capabilities/filesystem.ts` | `8-20,102-237` | 证明 fake-bash file ops 已真实消费 namespace truth |
| search handlers | `packages/capability-runtime/src/capabilities/search.ts` | `4-25,74-205` | 证明 minimal `rg` 已真实读 namespace |
| vcs handlers | `packages/capability-runtime/src/capabilities/vcs.ts` | `4-23,34-50,110-170` | 证明 `git` readonly subset 已接上 workspace truth |
| workspace composition | `packages/session-do-runtime/src/workspace-runtime.ts` | `1-18,45-62,75-100` | 证明 runtime 已有正式 workspace bundle seam |
| default use-site | `packages/session-do-runtime/src/do/nano-session-do.ts` | `282-307` | 证明默认 DO 路径已本地构造 workspace handle |
| default/remote stubs | `packages/session-do-runtime/src/composition.ts` / `src/remote-bindings.ts` | `82-106` / `385-395` | 证明独立 remote worker 仍未接线 |

### 1.4 直接证明行为的测试

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| routing | `packages/workspace-context-artifacts/test/mounts.test.ts` | `71-139,160-192` | 证明 mount law 与 `/_platform` law 已锁定 |
| namespace | `packages/workspace-context-artifacts/test/namespace.test.ts` | `33-109,112-212` | 证明 CRUD/read-only routing 已锁定 |
| memory cap | `packages/workspace-context-artifacts/test/backends/memory.test.ts` | `196-217` | 证明 MemoryBackend mirror cap 已锁定 |
| reference connected mode | `packages/workspace-context-artifacts/test/backends/reference.test.ts` | `114-141,144-210,213-278` | 证明 connected CRUD / promotion / cleanup 都已锁定 |
| fake workspace flow | `packages/workspace-context-artifacts/test/integration/fake-workspace-flow.test.ts` | `36-78` | 证明 artifact ref + namespace + snapshot 已形成真实闭环 |
| DO adapter | `packages/storage-topology/test/adapters/do-storage-adapter.test.ts` | `133-197,199-264` | 证明 DO adapter 关键平台 law 已锁定 |
| R2 adapter | `packages/storage-topology/test/adapters/r2-adapter.test.ts` | `137-195,198-243` | 证明 R2 adapter 关键平台 law 已锁定 |

---

## 2. workspace substrate 已经是真代码，不是计划图

## 2.1 `MountRouter` 已经是 load-bearing router

`MountRouter` 当前已落实三件真正关键的事：

1. longest-prefix matching：`packages/workspace-context-artifacts/src/mounts.ts:58-85,123-157`
2. root mount 不能吞 `/_platform`：`64-85`
3. 显式 `/_platform` mount 仍可 claim reserved namespace：同上，且被测试锁定：`test/mounts.test.ts:160-192`

这说明 today 的 workspace routing 并不是“未来再设计”，而是一个已经被 `capability-runtime` 和 snapshot builder 共同依赖的 load-bearing substrate。

## 2.2 `WorkspaceNamespace` 已经给出统一 file ops 面

`WorkspaceNamespace` 现在已经稳定提供：

- `listMounts()`：`17-27`
- `readFile()`：`33-39`
- `writeFile()` + readonly gate：`45-56`
- `listDir()`：`62-80`
- `stat()` / `deleteFile()`：`86-120`

配套测试也已经锁了：

- route 到正确 mount：`test/namespace.test.ts:62-76`
- readonly write rejection：`92-109`
- delete/read/list/stat 行为：`112-212`

所以“workspace truth 在哪里”这个问题，当前代码的答案已经很清楚：

> **在 `MountRouter + WorkspaceNamespace`。**

---

## 3. backend 层已经不只是 placeholder

## 3.1 `MemoryBackend` 不再只是本地 toy backend

`MemoryBackend` 现在最重要的变化，不是能写读文件，而是：

- 默认 `maxValueBytes = 1 MiB`：`packages/workspace-context-artifacts/src/backends/memory.ts:29-39,58-60`
- oversize 时抛与 DO adapter 同形状的 `ValueTooLargeError`：`68-78`

对应测试也明确锁了：

- 默认 cap = 1 MiB：`test/backends/memory.test.ts:196-200`
- oversize rejection = `ValueTooLargeError(adapter="memory")`：`202-211`

这说明它已经承担了一个很实在的职责：

> **防止“本地测试能写、DO 上线就炸 `SQLITE_TOOBIG`”的假阳性。**

## 3.2 `ReferenceBackend` 已经从旧评估里的 placeholder 前进到 connected mode

旧 worker-matrix 评估里，`ReferenceBackend` 仍被描述成 not-connected placeholder；但当前代码已经前进到：

- 两种 operating modes：`7-29`
- connected mode 走 `DOStorageAdapter`，oversize 时可 promote 到 `R2Adapter`：`58-80,120-140`
- delete 时会 best-effort 清理 R2 backing：`180-197`

配套测试进一步证明：

- no adapter 时五个方法都抛 `StorageNotConnectedError`：`test/backends/reference.test.ts:114-141`
- 有 `DOStorageAdapter` 时能做 inline CRUD：`144-210`
- 有 `R2Adapter` 时 oversize 能 promote：`213-278`

因此当前对 `ReferenceBackend` 最准确的判断不是“ready all the way”，而是：

> **已经是可用的 durable seam，但仍不是最终 topology/orchestration。**

---

## 4. artifact/promotion/snapshot 已经把 filesystem substrate 拉到“可恢复对象层”

## 4.1 artifact refs 已经直接走 `NacpRef` 语义

`refs.ts` 当前已经明确：

- `ArtifactRef` / `PreparedArtifactRef` 都是 `NacpRef`-shaped：`4-21,68-96,113-126`
- `toNacpRef()` 直接输出纯 wire fields：`132-166`

这意味着 workspace layer 现在不只是一套“路径 + 文件内容”玩具模型，它已经开始拥有**可跨包流动的对象身份**。

## 4.2 promotion 已经有真实 hot-vs-cold 选择

`promoteToArtifactRef()` 按 size 选择：

- 小于等于 `coldTierSizeBytes` → `do-storage`
- 大于 → `r2`

见：`packages/workspace-context-artifacts/src/promotion.ts:25-33,107-143`

这和“worker-matrix 第一波做 memory + DO/R2 seam”的建议是直接对齐的。

## 4.3 snapshot builder 已经真实 capture workspace fragment

`WorkspaceSnapshotBuilder.buildFragment()` 当前会真实收集：

- `mountConfigs`
- `fileIndex`
- `artifactRefs`
- `contextLayers`

见：`packages/workspace-context-artifacts/src/snapshot.ts:122-164`

integration test 也已经证明 fragment 不再是空壳：`test/integration/fake-workspace-flow.test.ts:70-78`

这意味着 `filesystem.core` 现在已经能为 hibernation/replay 场景提供真实的 workspace fragment substrate，而不只是 file ops helper。

---

## 5. storage/platform 层也已经是真代码

## 5.1 `storage-topology` 不只是 prose vocabulary

当前代码已经至少有这些 load-bearing 面：

- `DO_KEYS / KV_KEYS / R2_KEYS`：`packages/storage-topology/src/keys.ts:17-85`
- tenant-prefixed `StorageRef` builders：`refs.ts:31-53,67-79,128-166`
- placement hypotheses + MIME gate position：`placement.ts:22-57,98-120,157-207`
- calibration + placement-log adapter：`calibration.ts:14-18,75-171,177-240`

这说明它虽然还是 semantics library，但已经不是“只有文档没有代码”。

## 5.2 DO/R2 adapters 都已经是真正可消费的 runtime primitive

`DOStorageAdapter` 已经提供：

- conservative 1 MiB size pre-check：`73-125`
- `putMany` batch size guard：`129-143`
- atomic `transaction()`：`160-178`

对应测试锁了：

- cap boundary / oversize / batch reject：`test/adapters/do-storage-adapter.test.ts:133-197`
- throw → rollback：`199-226`

`R2Adapter` 已经提供：

- native cursor page list：`120-144`
- `listAll()` cursor walk：`146-166`
- `putParallel()`：`168-187`

对应测试锁了：

- F02 reproduction：`test/adapters/r2-adapter.test.ts:149-169`
- `listAll()` = 3 pages for 50 keys / limit 20：`171-184`
- `putParallel()` batching：`198-233`

所以当前的“平台适配层未闭合”并不等于“平台 primitives 不存在”；更准确的说法是：

> **primitives 已有，独立 worker assembly 仍未闭合。**

---

## 6. fake-bash 已经在真实消费这套 filesystem truth

## 6.1 filesystem handlers 已经走 namespace truth

`filesystem.ts` 当前已经把真实 workspace FS 接起来了：

- `pwd/ls/cat/write/rm/mv/cp` 全都以 `resolveWorkspacePath()` + `WorkspaceFsLike` 为真相：`102-237`
- reserved namespace 会被 typed reject：`111-120`
- `write` 会结构性消费 `ValueTooLargeError` 并给 `write-oversize-rejected` disclosure：`153-173`
- `mkdir` 是明确 partial：`176-188`

## 6.2 search/vcs 也已经不再是完全 stub

`search.ts` 当前已经会：

- 递归 `listDir()`
- 对叶子节点 `readFile()`
- 返回 deterministic `path:line:line` 格式
- 对 `/_platform/**` 和 output cap 保持 hard edge

见：`packages/capability-runtime/src/capabilities/search.ts:74-205`

`vcs.ts` 当前也已把 git 收缩到 readonly trio，并让 `status` 真正遍历 workspace：`110-170`

因此，如果只问“LLM 能否在 today 的系统里看到一个真实存在的文件/search/VCS-compatible 外形”，答案是：

> **能，而且已经建立在真实 workspace substrate 上。**

---

## 7. 当前真正没闭合的是 remote worker path

## 7.1 default composition 仍不给 `workspace`

`createDefaultCompositionFactory()` 仍直接返回：

```ts
workspace: undefined
```

见：`packages/session-do-runtime/src/composition.ts:82-106`

## 7.2 remote composition 也还不给 `workspace`

`makeRemoteBindingsFactory()` 当前同样返回：

```ts
workspace: undefined
```

见：`packages/session-do-runtime/src/remote-bindings.ts:385-395`

## 7.3 但默认 DO 路径已经会 local-compose workspace

这就是当前 readiness 最关键的 nuance：

- **composition factory 层**：workspace 仍未成为 remote/default injected subsystem
- **NanoSessionDO fallback 层**：如果 factory 没给，它会自己装一个 local workspace handle

见：`packages/session-do-runtime/src/do/nano-session-do.ts:282-307`

所以 current code truth 不是“workspace 缺席”，而是：

> **workspace 已在默认 host path 中被本地装配，但还没有被提升成独立 remote seam。**

---

## 8. 结论

**`filesystem.core` 当前已经拥有足够坚实的代码地基：namespace、backend、refs、promotion、snapshot、storage adapters、fake-bash consumer 全都是真代码；它真正缺的不是基础对象模型，而是“把这些基础对象模型装配成独立 remote/deploy worker”的最后一跳。**

所以如果只问 readiness：

- 作为 **host-local substrate / first-wave foundation**：**高**
- 作为 **独立 remote filesystem worker**：**中低**
