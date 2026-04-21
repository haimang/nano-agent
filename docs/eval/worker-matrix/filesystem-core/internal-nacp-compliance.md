# filesystem.core — internal NACP compliance

> 目标：回答 `filesystem.core` 今天到底拥有哪些 formal/internal contract，哪些不拥有；尤其是 `NacpRef`、tenant、path law、reserved namespace` 这些约束由谁负责。

---

## 0. 先给结论

**`filesystem.core` 今天并不拥有 client-facing session wire protocol；它真正拥有的是 `NacpRef` 兼容引用、tenant-prefixed key law、workspace path law、`/_platform/` reserved namespace law，以及只导出 workspace/context fragment 的 snapshot boundary。**

换句话说，它更像 **internal contract-heavy substrate**，而不是一个对外发明新 message family 的 worker。

---

## 1. 原始素材召回表

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| original scope | [`docs/action-plan/after-nacp/workspace-context-artifacts.md`](../../../action-plan/after-nacp/workspace-context-artifacts.md) | `145-159,163-184,240-250` | 说明 workspace package 应拥有的 `ArtifactRef / compact / snapshot` 边界 |
| original scope | [`docs/action-plan/after-nacp/storage-topology.md`](../../../action-plan/after-nacp/storage-topology.md) | `36-47,154-175,181-187,233-242` | 说明 storage package 应拥有的 `NacpRef / key / placement / calibration` 边界 |
| current workspace truth | [`packages/workspace-context-artifacts/src/refs.ts`](../../../../packages/workspace-context-artifacts/src/refs.ts) | `4-21,68-96,113-166` | 证明 artifact/prepared refs 已与 `NacpRef` 对齐 |
| current promotion truth | [`packages/workspace-context-artifacts/src/promotion.ts`](../../../../packages/workspace-context-artifacts/src/promotion.ts) | `21-33,107-143` | 证明 promoted artifact key 默认 tenant-scoped，且 backend 选择只在 `do-storage/r2` 间分层 |
| current key/ref truth | [`packages/storage-topology/src/keys.ts`](../../../../packages/storage-topology/src/keys.ts) / [`refs.ts`](../../../../packages/storage-topology/src/refs.ts) | `17-32,38-64,70-85` / `31-53,67-79,128-166` | 证明 key/ref law 与 `_platform` 唯一例外 |
| current path law | [`packages/capability-runtime/src/capabilities/workspace-truth.ts`](../../../../packages/capability-runtime/src/capabilities/workspace-truth.ts) | `11-30,32-57,60-157` | 证明 fake-bash 的 filesystem/search/vcs 共用 path law |
| current reserved namespace use-site | [`packages/workspace-context-artifacts/src/mounts.ts`](../../../../packages/workspace-context-artifacts/src/mounts.ts) / [`packages/capability-runtime/src/capabilities/filesystem.ts`](../../../../packages/capability-runtime/src/capabilities/filesystem.ts) | `64-85,115-157` / `8-20,111-120,176-188` | 证明 `/_platform` law 已落入 route 与 handler |
| current snapshot boundary | [`packages/workspace-context-artifacts/src/snapshot.ts`](../../../../packages/workspace-context-artifacts/src/snapshot.ts) | `122-184` | 证明 snapshot builder 只导出 workspace/context fragment |

---

## 2. `filesystem.core` 不拥有 session/client wire protocol

当前仓库里，`filesystem.core` 没有任何自己的 client-facing message family。

最接近“formal contract”的几层其实是：

1. `tool.call.*` — 由 capability/runtime 与 `nacp-core` 的 tool-call body 对齐：`packages/capability-runtime/README.md:130-151`
2. `session.stream.*` / WS profile — 由 `nacp-session` 和 `session-do-runtime` 负责，不在 filesystem 包里：`packages/session-do-runtime/src/composition.ts:82-106`
3. `filesystem.core` 自己提供的是**被这些层消费的内部对象模型**：path、mount、artifact ref、storage ref、snapshot fragment。

因此，对 `filesystem.core` 最准确的 internal protocol 描述是：

> **它是 protocol consumer/supporter，不是 protocol owner。**

---

## 3. 它真正拥有的第一条硬法则：`NacpRef` 兼容引用

## 3.1 artifact refs 已直接对齐 `NacpRef`

`workspace-context-artifacts/src/refs.ts` 现在已经明确：

- `ArtifactRef` 是 `NacpRef` 的 semantic wrapper：`4-15`
- wire-level `kind` 保持 `r2 | kv | do-storage | d1 | queue-dlq`：`44-52,68-82`
- `key` 必须以 `tenants/{team_uuid}/` 开头：`84-96`
- `PreparedArtifactRef` 也沿用同一 tenant-prefix refinement：`113-126`
- `toNacpRef()` 可以直接丢掉 artifact metadata，回到纯 `NacpRef` 字段：`132-166`

这意味着 `filesystem.core` 当前最重要的 internal compliance 之一已经不是“概念上兼容”，而是：

> **artifact refs 本体就按照 `NacpRef` 形状建模。**

## 3.2 promotion 也默认产出 tenant-scoped `NacpRef`-shaped ref

`promoteToArtifactRef()` 进一步把这个法则落到了实际产物上：

- `kind` 只会是 `do-storage` 或 `r2`：`107-126`
- `binding` 走固定 Workers binding 名称：`90-97,127-142`
- `key` 一律以 `tenants/{teamUuid}/artifacts/...` 开头：`114-116,132-142`

因此，如果未来 `filesystem.core` 需要对外暴露 artifact pointer，它不需要再定义第二套 FS-specific ref wire schema。

---

## 4. 第二条硬法则：tenant-prefixed key/ref law

`storage-topology` 已把这条规则冻得非常明确：

- DO local constants 可以是相对 key：`DO_KEYS.*`，如 `session:phase`、`workspace:file:${path}`：`packages/storage-topology/src/keys.ts:17-32`
- 但**所有 ref** 对外都必须是 tenant-prefixed full key：`packages/storage-topology/src/refs.ts:10-22,128-166`
- KV 唯一允许的 `_platform` 例外只有 `KV_KEYS.featureFlags()`：`packages/storage-topology/src/keys.ts:38-64`

这条规则的重要含义是：

1. **DO local storage key** 与 **cross-package ref representation** 不是一回事；
2. `filesystem.core` 可以在 backend 内部用相对 key，但一旦形成跨包 ref，就必须回到 `tenants/{team_uuid}/...`；
3. `_platform` 不是一个可以被“顺手扩散”的 ambient namespace，它当前只有一个被明文允许的 KV feature-flags 例外。

---

## 5. 第三条硬法则：workspace path law 与 `/_platform/` reserved namespace

`workspace-truth.ts` 已经把 fake-bash 的 path law 冻结为 v1 truth：

- 默认 workspace root 是 `/workspace`：`11-15,32-37`
- `/_platform/**` 永远不是 bash-visible path universe：`15-18,35-41,106-121`
- relative path 不能 escape workspace root：`19-30,60-121`

这条 path law 不是文档说明，而是被 filesystem/search/vcs 三面共同消费：

- filesystem handlers 统一走 `resolveWorkspacePath()`：`packages/capability-runtime/src/capabilities/filesystem.ts:8-20,111-120`
- search handlers 也统一走同一 resolver，并跳过 reserved namespace：`packages/capability-runtime/src/capabilities/search.ts:79-88,136-157`
- vcs handler 的 workspace traversal 也复用同一 law：`packages/capability-runtime/src/capabilities/vcs.ts:28-32,78-99,143-149`

与此同时，workspace substrate 本身也在路由层锁住了 `/_platform`：

- root mount 不能吞掉 `/_platform`：`packages/workspace-context-artifacts/src/mounts.ts:64-85`
- 只有显式 `/_platform` mount 才能 claim 这个命名空间：`packages/workspace-context-artifacts/test/mounts.test.ts:160-192`

因此，对 `filesystem.core` 来说：

> **`/_platform` 不是普通路径约定，而是 internal namespace law。**

---

## 6. 第四条硬法则：snapshot 只导出 workspace/context fragment

`WorkspaceSnapshotBuilder` 当前明确只拥有 workspace/context 这部分恢复边界：

- `buildFragment()` 收集 `mountConfigs / fileIndex / artifactRefs / contextLayers`：`packages/workspace-context-artifacts/src/snapshot.ts:122-164`
- `restoreFragment()` 也只返回这四类数据：`172-184`

这和 action-plan 原始口径完全一致：workspace 包不拥有 session actor / replay / WS metadata 的 checkpoint shape，只输出自己负责的 fragment：`docs/action-plan/after-nacp/workspace-context-artifacts.md:157-159,248-250`

这点很关键，因为它说明 `filesystem.core` 的 internal compliance 不是“多做一点也无妨”，而是：

> **只导出自己拥有的 fragment，不越权发明 session-level snapshot protocol。**

---

## 7. 当前最需要诚实标注的边界

## 7.1 `ReferenceBackend` 仍然是 tenant-agnostic backend seam

虽然 `ReferenceBackend` 现在已经支持 connected mode，但文件头仍明确写着：

- caller 负责 tenant prefixing：`packages/workspace-context-artifacts/src/backends/reference.ts:24-29`
- backend 自己不会再补 tenant scoping：同上

这意味着：

- `filesystem.core` 的 tenant law已经冻结；
- 但**tenant-aware path composition 仍主要由上游 caller / namespace / runtime 负责**。

## 7.2 它不应该发明新的 FS-specific wire message

当前 repo 对 filesystem 相关的 formal output，已经有：

- `NacpRef`
- `tool.call.*`
- workspace snapshot fragment

因此 worker-matrix 阶段不应再发明诸如 “filesystem.read.response” 这类 private wire family；更合理的做法是：

1. 继续沿用 capability tool-call surface；
2. 继续沿用 `NacpRef`/snapshot fragment；
3. 把 deploy-layer route/binding 问题留给 future assembly，而不是让 protocol 面膨胀。

---

## 8. 结论

**`filesystem.core` 当前最重要的 NACP/internal contract 不是 session wire，而是 `NacpRef + tenant key + workspace path + reserved namespace + fragment-only snapshot` 五件事。**

因此在 worker-matrix 里，最值得保护的边界是：

1. **别把它写成 protocol owner；**
2. **别把 relative key 和 cross-package ref 混成一层；**
3. **别让 `/_platform` 从 reserved namespace 退化成普通路径；**
4. **别让 workspace snapshot 越权膨胀成 session checkpoint。**
