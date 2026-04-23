# filesystem.core — external contract surface

> 目标：回答 `filesystem.core` 今天到底向外暴露了什么，以及哪些 surface 仍未落到 worker shell。

---

## 0. 先给结论

**今天的 `filesystem.core` 外部面也必须拆成两层来看：**

1. **当前真实 worker shell**：`workers/filesystem-core`
2. **当前真实 workspace/storage substrate 外部面**：D1 `workspace-context-artifacts` filesystem slice + D2 `storage-topology`

而 **live standalone filesystem-core worker API** 仍未在当前 shell 中落地。

---

## 1. 当前最该看的直接证据

| 类型 | 路径 | 用途 |
|---|---|---|
| shell code | `workers/filesystem-core/package.json`; `wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明当前 deploy shell surface |
| package surface | `packages/workspace-context-artifacts/README.md`; `packages/storage-topology/README.md` | 证明当前真正的 library-level external API |
| consumer face | `packages/capability-runtime/README.md`; `src/capabilities/filesystem.ts`; `search.ts`; `vcs.ts` | 证明当前最真实的 user-visible consumer surface |
| runtime seam | `packages/session-do-runtime/src/workspace-runtime.ts`; `src/do/nano-session-do.ts` | 证明当前 host-local composition seam |

---

## 2. 第一层 external surface：当前 worker shell

### 2.1 `workers/filesystem-core` 现在真实暴露了什么

当前 shell 行为非常窄：

- `fetch()` 返回 `worker / nacp_core_version / nacp_session_version / status / phase`：`workers/filesystem-core/src/index.ts:5-22`
- smoke test 只验证 fetch handler 与版本探针：`workers/filesystem-core/test/smoke.test.ts:1-26`

因此当前 shell 对外最准确的表述是：

> **一个 deploy-shaped probe shell，不是 live filesystem worker API。**

### 2.2 W4 已把“没有 worker 壳”这个问题关闭

当前 closure truth：

- `docs/issue/pre-worker-matrix/W4-closure.md:18-27,47-48`

这意味着 r2 不应再写“filesystem-core 还没有独立 worker 目录/配置/CI”。

---

## 3. 第二层 external surface：当前 package / substrate API

当前真正成熟的外部面仍是两个 package 的组合：

1. `@nano-agent/workspace-context-artifacts@0.1.0` 的 filesystem slice
2. `@nano-agent/storage-topology@2.0.0`

它们当前对外提供的真实 surface 包括：

| 面 | 当前真实 surface |
|---|---|
| workspace namespace | `MountRouter`、`WorkspaceNamespace` |
| backends | `MemoryBackend`、`ReferenceBackend` |
| artifact identity | refs / promotion |
| snapshot fragment | workspace/context fragment builder |
| storage semantics | key builders、ref builders、placement/calibration、DO/R2 adapters |

因此现在的 `filesystem.core` 不是“写死在 host 里的隐式 helper”，而是：

> **已经拥有单独 package-level public surface 的 workspace/storage substrate。**

---

## 4. 当前最真实的 consumer face：fake-bash / capability layer

当前最成熟、最用户可感知的 external surface，其实不是 worker shell，而是：

1. `pwd / ls / cat / write / mkdir / rm / mv / cp`
2. `rg`
3. `git` readonly subset

也就是 fake-bash / capability-runtime 对 D1/D2 truth 的消费面。

这意味着 external surface 的正确写法是：

> **filesystem-core today is already visible through fake-bash consumer paths**

而不是：

> “只有未来 remote worker 才会暴露 filesystem truth”

---

## 5. 当前最真实的 runtime external seam：host-local composition

### 5.1 `composeWorkspaceWithEvidence(...)` 仍是当前最真实的 runtime 接缝

当前 host runtime 侧最正式的接缝仍是：

- `packages/session-do-runtime/src/workspace-runtime.ts`

它输出：

1. `assembler`
2. `compactManager`
3. `snapshotBuilder`
4. `captureSnapshot()`

这说明 runtime 侧今天真正需要的 external contract 不是“巨大的 filesystem worker API”，而是：

> **一个装配好的 workspace business-object bundle。**

### 5.2 默认 DO 路径仍是 local-compose，而不是 remote filesystem worker

`NanoSessionDO` 当前仍会在 fallback path 本地装：

1. `MountRouter`
2. `WorkspaceNamespace`
3. `InMemoryArtifactStore`
4. `composeWorkspaceWithEvidence(...)`

因此今天的 runtime reality 仍是：

> **host-local workspace composition**

而不是：

> “已经通过 remote worker 在调用 filesystem-core”

---

## 6. 当前明确不存在的 external surface

当前仍然**不存在**：

1. live standalone filesystem-core fetch API（除了 probe JSON）
2. default remote workspace service-binding path
3. full KV/D1/R2 filesystem service
4. Linux/POSIX/overlay/full FS runtime

所以把今天的 `filesystem.core` 写成“独立 filesystem service 已上线”会明显过头。

---

## 7. 对 r2 的直接要求

1. **承认 `workers/filesystem-core` shell 已存在。**
2. **把 D1/D2 组合视为当前真正的语义本体。**
3. **把 fake-bash consumer face 视为 today 最真实的 user-visible external surface。**
4. **把 host-local composition 视为当前真实 runtime seam，而不是空白。**
5. **在 D1/D2 吸收完成前，不把 probe shell 写成 live worker API。**

---

## 8. 本文件的最终判断

**今天 `filesystem.core` 的外部面最成熟的是 package/substrate API、fake-bash consumer face、以及 host-local composition seam；最不成熟的是“吸收进 worker shell 后的 live remote worker API”。**

所以 worker-matrix r2 最合理的写法是：

> **以现有 D1/D2 package surface、fake-bash consumer path、host-local composition 为语义基线，把 `workers/filesystem-core` 从 deploy shell 提升为真正的 filesystem worker，而不是另起一套巨大 API 设计。**
