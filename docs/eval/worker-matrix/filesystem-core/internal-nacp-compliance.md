# filesystem.core — internal NACP compliance

> 目标：定义 `filesystem.core` 在 pre-worker 之后、r2 之前真正拥有的协议责任。

---

## 0. 先给结论

**W4 新增了 `workers/filesystem-core` shell，但没有改变 `filesystem.core` 的协议 ownership：它今天真正拥有的仍是 `NacpRef` 兼容引用、tenant-prefixed key/ref law、workspace path law、`/_platform/` reserved namespace law，以及 fragment-only snapshot boundary。**

---

## 1. 当前最该看的直接证据

| 类型 | 路径 | 用途 |
|---|---|---|
| W3/W4 truth | `docs/design/pre-worker-matrix/W3-absorption-map.md`; `W3-absorption-blueprint-workspace-context-artifacts-split.md`; `docs/issue/pre-worker-matrix/W4-closure.md` | 说明 shell 已 materialize，但 D1/D2 protocol reality 仍主要在 packages 中 |
| current packages | `packages/workspace-context-artifacts/src/refs.ts`; `promotion.ts`; `mounts.ts`; `snapshot.ts`; `packages/storage-topology/src/keys.ts`; `refs.ts` | 当前最关键的 ref/key/path/snapshot law |
| current consumers | `packages/capability-runtime/src/capabilities/workspace-truth.ts`; `filesystem.ts`; `search.ts`; `vcs.ts` | 说明 today 的 protocol consumers 是谁 |
| shell evidence | `workers/filesystem-core/src/index.ts` | 说明 W4 shell 还没有拥有独立 protocol/runtime authority |

---

## 2. 当前必须保留的协议 ownership

| 面向对象 | 正确协议层 | 当前判断 |
|---|---|---|
| client ↔ host | `@haimang/nacp-session` | 不是 `filesystem.core` 的职责 |
| tool-facing remote path | `@haimang/nacp-core` 的 `tool.call.*` + `NacpRef` | filesystem/core 自己不是 tool/session protocol owner |
| `filesystem.core` 自己的 contract | internal substrate law | path / mount / ref / key / snapshot fragment |

最重要的一句话没有变：

> **`filesystem.core` 是 protocol consumer / supporter，不是 session wire owner。**

---

## 3. 当前仍必须原样继承的几条 law

### 3.1 `NacpRef` 兼容引用仍是首要硬法则

当前正式真相仍是：

- `packages/workspace-context-artifacts/src/refs.ts`
- `packages/workspace-context-artifacts/src/promotion.ts`
- `packages/storage-topology/src/refs.ts`

因此：

1. artifact refs 继续按 `NacpRef` 语义建模
2. promotion 继续默认产出 tenant-scoped ref
3. future `filesystem.core` 若需要对外给指针，不应再发明第二套 FS-specific ref schema

### 3.2 tenant-prefixed key/ref law 仍不能退回到裸 key

当前 storage-topology 仍要求：

1. backend 内部可以有相对 key
2. 一旦形成 cross-package ref，就必须回到 `tenants/{team_uuid}/...`
3. `_platform` 只有极窄例外

这条 law 在 worker shell 出现后也不能退回。

### 3.3 workspace path law 与 `/_platform/` reserved namespace 仍是 internal namespace law

当前真实 path law 仍冻结在：

- `packages/capability-runtime/src/capabilities/workspace-truth.ts`
- `packages/workspace-context-artifacts/src/mounts.ts`

因此：

1. `/workspace` 继续是 fake-bash visible root
2. `/_platform/**` 继续不是 bash-visible path universe
3. `/_platform` 不得退化成普通路径前缀

### 3.4 snapshot 继续只能导出 workspace/context fragment

当前 `WorkspaceSnapshotBuilder` 仍只拥有：

1. `mountConfigs`
2. `fileIndex`
3. `artifactRefs`
4. `contextLayers`

这意味着：

> `filesystem.core` 继续只能导出自己拥有的 fragment，不能越权扩张成 session-level checkpoint protocol。

### 3.5 filesystem 继续不应自造新的 FS-specific wire family

当前 repo 已有：

1. `tool.call.*`
2. `NacpRef`
3. workspace snapshot fragment

因此 worker-matrix 阶段不应再发明诸如：

- `filesystem.read.response`
- `filesystem.mount.update`
- `filesystem.snapshot.push`

之类新的 private wire family。

---

## 4. W4 shell 出现后，哪些东西没有变化

| 变化 | 是否改变协议 ownership | 为什么 |
|---|---|---|
| `workers/filesystem-core` 目录存在 | **否** | 只是 deploy shell materialized |
| `workers/filesystem-core/src/index.ts` 返回 probe JSON | **否** | 这是 shell identity，不是 filesystem authority/runtime |
| W4 dry-run 通过 | **否** | 证明 deploy path 真实，不证明 D1/D2 已被该目录承接 |

---

## 5. 当前最该诚实写清的边界

### 5.1 `ReferenceBackend` connected mode 仍不是默认 runtime path

今天真实存在的 nuance 是：

1. connected mode 已是真代码
2. R2 promotion 已是真代码
3. 但默认 host path 目前仍是 memory-only local assembly

因此 r2 不应把 connected durable backend 直接写成 today default truth。

### 5.2 remote workspace seam 仍未接线

当前 `session-do-runtime` 仍明确返回：

- `workspace: undefined`

不论是 default composition 还是 remote composition。  
这意味着 today 的 filesystem substrate 仍主要通过：

> **host-local workspace composition**

来被消费，而不是通过独立 remote worker path。

---

## 6. 对 r2 的直接纪律

1. **继续把 `NacpRef + tenant key/ref + workspace path + reserved namespace + fragment-only snapshot` 当成最重要的 internal law。**
2. **继续把 `filesystem.core` 视为 protocol supporter，不是 session/tool protocol owner。**
3. **继续把 `/_platform` 当作 reserved namespace，而不是普通路径。**
4. **继续把 snapshot 约束在 workspace/context fragment，不要越权膨胀。**
5. **在 D1/D2 真正吸收前，不把 `workers/filesystem-core` 写成已拥有 live authority/runtime 的 worker。**

---

## 7. 本文件的最终判断

**pre-worker 之后，`filesystem.core` 的协议 reality 没有被 worker shell 稀释：真正重要的仍是 ref/key/path/fragment law，而不是新 wire family。**

所以 worker-matrix r2 应把重点放在：

> **如何把 D1/D2 现有 contract 吸收到 `workers/filesystem-core/` 内，而不是顺势发明一套更厚的新 filesystem protocol。**
