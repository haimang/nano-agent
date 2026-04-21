# filesystem.core — external contract surface

> 目标：回答 `filesystem.core` 今天实际暴露给哪些外部消费者；哪些 surface 已真实存在，哪些仍只是 seam 或 reserved slot。

---

## 0. 先给结论

**`filesystem.core` 当前最真实的 external surface 不是独立 Worker API，而是三层组合：**

1. **workspace package API**：`MountRouter / WorkspaceNamespace / MemoryBackend / ReferenceBackend / ArtifactRef / SnapshotBuilder`
2. **fake-bash consumer API**：`pwd/ls/cat/write/mkdir/rm/mv/cp/rg/git`
3. **runtime assembly seam**：`composeWorkspaceWithEvidence(...)`

而**独立 remote / service-binding filesystem worker surface 目前仍不存在**。

---

## 1. 原始素材召回表

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| workspace package contract | [`packages/workspace-context-artifacts/README.md`](../../../../packages/workspace-context-artifacts/README.md) | `17-64,68-115` | 证明 workspace package 当前对外承诺了什么、没承诺什么 |
| storage package contract | [`packages/storage-topology/README.md`](../../../../packages/storage-topology/README.md) | `18-63,66-100` | 证明 storage-topology 的 external face 仍是 semantics library |
| capability contract | [`packages/capability-runtime/README.md`](../../../../packages/capability-runtime/README.md) | `20-93,153-197` | 证明 fake-bash 对 filesystem/search/vcs 的 current surface |
| workspace runtime seam | [`packages/session-do-runtime/src/workspace-runtime.ts`](../../../../packages/session-do-runtime/src/workspace-runtime.ts) | `1-18,45-62,75-100` | 证明 runtime 侧存在正式 workspace composition seam |
| default/local assembly | [`packages/session-do-runtime/src/do/nano-session-do.ts`](../../../../packages/session-do-runtime/src/do/nano-session-do.ts) | `282-307` | 证明默认 DO 路径会本地构造 workspace handle |
| non-ready remote seam | [`packages/session-do-runtime/src/composition.ts`](../../../../packages/session-do-runtime/src/composition.ts) / [`remote-bindings.ts`](../../../../packages/session-do-runtime/src/remote-bindings.ts) | `82-106` / `385-395` | 证明 remote/default composition 仍没有 `workspace` remote surface |

---

## 2. 第一层 external surface：workspace package API

当前 `workspace-context-artifacts` README 已经把 v1 对外面收得很明确：

- core types：`WorkspacePath`、`MountConfig`、`ArtifactRef`、`PreparedArtifactRef`、`WorkspaceSnapshotFragment`：`README.md:17-23`
- mount/router/namespace：`MountRouter + WorkspaceNamespace`：`24-27`
- backends：`MemoryBackend + ReferenceBackend seam`：`27`
- artifact/promotion/context/snapshot：`28-47`

这意味着 today 的 `filesystem.core` 不是“写死在 session DO 里的隐式实现”，而是已经有一层可直接 import 的 package-level contract。

但同一份 README 也非常明确它**不承诺**：

- final DO/KV/R2/D1 topology：`49-54`
- production backend adapters：`53-54`
- Git-style repository semantics：`55`
- general `/_platform/` access：`63-64`

因此，这层 external contract 的正确说法是：

> **它已经是一套可复用 library surface，但还不是一个完成了 deploy wiring 的 external worker surface。**

---

## 3. 第二层 external surface：fake-bash / capability consumer face

## 3.1 当前被正式注册并文档化的 filesystem family

`capability-runtime/README.md` 当前把 minimal command pack 与 target state 写得很直接：

- filesystem：`pwd / ls / cat / write / mkdir / rm / mv / cp`：`20-41`
- search：canonical `rg`：`38`
- vcs：`git`：`41`
- execution target 仍以 `local-ts` 为 reference target，`service-binding` 和 `browser-rendering` 都还是 not-connected slots：`84-93`

## 3.2 file/search/vcs 三面已经在共享一套 workspace truth

当前真实 surface 不是若干孤立 handler，而是一套共用 substrate：

- `filesystem.ts`：`ls/cat/write/mkdir/rm/mv/cp` 都通过 `resolveWorkspacePath()` 与 `WorkspaceFsLike`：`packages/capability-runtime/src/capabilities/filesystem.ts:8-20,102-237`
- `search.ts`：`rg` 在 namespace 内递归遍历 `listDir/readFile`，并对 `/_platform/**` 做跳过：`packages/capability-runtime/src/capabilities/search.ts:7-20,74-205`
- `vcs.ts`：`git status/diff/log` 只读基线也走同一 workspace truth：`packages/capability-runtime/src/capabilities/vcs.ts:65-99,117-170`

这意味着 `filesystem.core` 当前最成熟的“用户可感知” external surface，其实是：

> **fake-bash compatibility surface。**

## 3.3 但这层 surface 仍有三条必须诚实标注的限制

1. `mkdir` 仍是 partial-with-disclosure，不代表真实目录实体：`filesystem.ts:12-16,176-188`
2. `rg` 是 minimal subset，不是 full ripgrep：`search.ts:4-25`
3. `git` 只有 `status/diff/log`，其中 `diff/log` 仍是 honest partial：`vcs.ts:4-23,34-50,135-166`

所以它已经“可被 LLM 消费”，但并不等于“已经提供传统 Linux 文件系统体验”。

---

## 4. 第三层 external surface：runtime assembly seam

`session-do-runtime` 里，`filesystem.core` 当前真实暴露出来的运行时接线点是：

## 4.1 `composeWorkspaceWithEvidence(...)`

`workspace-runtime.ts` 已经给出正式 composition seam：

- 输入：`namespace`、`artifactStore`、可选 `assemblerConfig`、`evidenceSink`、`evidenceAnchor`：`45-62`
- 输出：`assembler / compactManager / snapshotBuilder / captureSnapshot`：`32-43,75-100`

这说明 runtime 侧真正需要的 external contract，不是“把所有 filesystem 细节全暴露出来”，而是一个**装配好的 workspace business object bundle**。

## 4.2 默认 DO 路径已经会本地构造 workspace handle

`NanoSessionDO` 当前在 composition factory 没给 `workspace` 时，会自己装：

- `new WorkspaceNamespace(new MountRouter())`
- `new InMemoryArtifactStore()`
- `composeWorkspaceWithEvidence(...)`

见：`packages/session-do-runtime/src/do/nano-session-do.ts:282-307`

这说明 `filesystem.core` 当前已经进入默认 deploy-shaped host 路径，但形式是：

> **host-local composition，而不是独立 remote worker。**

---

## 5. 当前不存在的 external surface

## 5.1 不存在独立 remote filesystem worker contract

`createDefaultCompositionFactory()` 仍返回 `workspace: undefined`：`packages/session-do-runtime/src/composition.ts:82-106`

而 `makeRemoteBindingsFactory()` 也同样返回：

```ts
workspace: undefined
```

见：`packages/session-do-runtime/src/remote-bindings.ts:385-395`

也就是说：

- hooks/capability/provider 已经有 remote seam
- **workspace/filesystem 还没有**

所以今天不能把 `filesystem.core` 说成一个已经被 service binding 接出的 worker。

## 5.2 storage-topology 也不是 runtime I/O surface

`storage-topology/README.md` 已明确：

- 它是 semantics library：`9-14`
- 不直接执行 storage I/O：`9-12`
- deploy-layer 才负责 wiring implementation：`58-59`

因此它提供的是：

- key builders
- ref builders
- placement/calibration helpers

而不是一个“文件读写 RPC API”。

---

## 6. 当前最合理的 surface 分层

把今天的 `filesystem.core` external surface 用一句话收起来，大致是：

| 层 | 当前真实 surface | readiness |
|---|---|---|
| package/library | `MountRouter / WorkspaceNamespace / backends / refs / snapshot` | **高** |
| fake-bash consumer | `pwd/ls/cat/write/mkdir/rm/mv/cp/rg/git` | **中** |
| host runtime composition | `composeWorkspaceWithEvidence(...)` + default local assembly | **中** |
| remote worker / service binding | 独立 filesystem worker contract | **低 / 未接线** |

---

## 7. 结论

**`filesystem.core` 当前对外最成熟的是 package API 与 fake-bash consumer face；最不成熟的是独立 remote worker face。**

所以 worker-matrix 第一波最推荐的姿态不是：

> “先定义一个巨大的 filesystem worker API”

而是：

> **先沿现有 package surface 和 host-local composition 把 workspace truth 用起来，再在真正需要 remoteize 时，把 composition seam 升级成 binding surface。**
