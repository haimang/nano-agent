# filesystem.core — realized code evidence

> 目标：只基于当前代码与当前 closure truth，回答 `filesystem.core` 已经有什么、还缺什么。

---

## 0. 先给结论

**`filesystem.core` 当前最准确的代码判断是：worker shell 已 materialize；D1/D2 substrate 已在 packages 中真实存在；fake-bash consumer 与 host-local runtime seam 也已经存在；真正没完成的，是把 D1/D2 吸收到 `workers/filesystem-core/` 并让该 shell 承接 live runtime。**

---

## 1. 当前最重要的代码锚点

| 层 | 路径 | 当前用途 |
|---|---|---|
| worker shell | `workers/filesystem-core/package.json`; `wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明 deploy-shaped shell |
| D1 package slice | `packages/workspace-context-artifacts/src/mounts.ts`; `namespace.ts`; `backends/*`; `refs.ts`; `promotion.ts` | 证明 filesystem slice 的真实语义 |
| D2 package | `packages/storage-topology/src/*` | 证明 storage semantics / adapters / calibration |
| current consumers | `packages/capability-runtime/src/capabilities/workspace-truth.ts`; `filesystem.ts`; `search.ts`; `vcs.ts` | 证明当前真实 consumer face |
| runtime seam | `packages/session-do-runtime/src/workspace-runtime.ts`; `src/do/nano-session-do.ts`; `src/remote-bindings.ts` | 证明当前 host-local use-site 与 remote gap |
| phase truth | `docs/issue/pre-worker-matrix/W4-closure.md`; `docs/design/pre-worker-matrix/W3-absorption-map.md`; `W3-absorption-blueprint-workspace-context-artifacts-split.md` | 证明当前 shell reality 与吸收目标 |

---

## 2. 已经真实存在的 worker shell

### 2.1 `workers/filesystem-core` 已是 deploy-shaped 目录

直接证据：

- `workers/filesystem-core/package.json:1-24`
- `workers/filesystem-core/wrangler.jsonc:1-22`
- `workers/filesystem-core/src/index.ts:1-22`
- `workers/filesystem-core/test/smoke.test.ts:1-26`

当前 shell 已真实具备：

1. `build / typecheck / test / deploy:dry-run / deploy:preview`
2. worker fetch handler
3. 对 NACP published truth 的 probe 输出
4. W4 matrix CI / dry-run 适配

### 2.2 但当前 shell 还没有吸收 D1/D2

`workers/filesystem-core/src/index.ts:5-22` 当前只返回版本探针 JSON，没有：

1. mount router / namespace
2. backends / refs / promotion
3. storage adapters / placement / calibration
4. any workspace authority/runtime

因此当前 shell 必须诚实写成：

> **deploy shell exists, filesystem/storage substrate not yet absorbed**

---

## 3. 已经真实存在的 filesystem/storage substrate 仍在 packages 中

### 3.1 D1 filesystem slice 已是真代码

当前关键事实：

- `packages/workspace-context-artifacts/package.json:1-39`
- `packages/workspace-context-artifacts/src/mounts.ts`
- `namespace.ts`
- `backends/*`
- `refs.ts`
- `promotion.ts`

split blueprint 已明确这些应归 `filesystem-core`：  
`docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md:68-107,122-137`

因此 `filesystem.core` 当前不是“未来也许会有个 workspace substrate”，而是：

> **D1 slice 已存在，待吸收。**

### 3.2 D2 storage-topology 也已是真 package

当前关键事实：

- `packages/storage-topology/package.json:1-43`
- `packages/storage-topology/src/keys.ts`
- `refs.ts`
- `placement.ts`
- `calibration.ts`
- `adapters/*`

这意味着 `filesystem.core` 的另一半语义也不是文档概念，而是：

> **D2 package 已存在，待吸收。**

### 3.3 fake-bash consumer 与 host-local runtime seam 也已经存在

当前 filesystem/storage substrate 已经被两类现实消费者使用：

1. `capability-runtime` 的 filesystem/search/vcs handlers
2. `session-do-runtime` 的 local workspace composition

这说明 D1/D2 不是“只有 unit tests 知道的内部模型”，而是：

> **已经进入 fake-bash user-facing path 与 host default path 的真实 substrate。**

---

## 4. 当前还没有闭合的东西

### 4.1 当前 shell 还不是 live filesystem worker

W4 只证明了：

1. 目录存在
2. wrangler 形状存在
3. build/test/dry-run 存在

它没有证明：

1. D1/D2 已迁入 `workers/filesystem-core/src/`
2. durable/storage bindings 已在该 shell 中激活
3. remote workspace authority 已接通

### 4.2 remote workspace seam 仍未接线

当前最直接的代码锚点仍是：

- `packages/session-do-runtime/src/composition.ts:82-106`
- `packages/session-do-runtime/src/remote-bindings.ts:384-397`

两边都还是：

- `workspace: undefined`

因此 today 的 filesystem substrate 仍主要是：

> **host-local composition**

而不是：

> **already-remoteized filesystem worker**

---

## 5. W3/W4 之后，`filesystem.core` 的代码真相应该怎么写

| 维度 | 当前真相 | 不应写成什么 |
|---|---|---|
| worker shell | 已存在，dry-run 已过 | 还没有独立 worker 目录 |
| D1 slice | 已存在 | 还是计划稿 |
| D2 package | 已存在 | 还没有清晰吸收对象 |
| fake-bash consumer | 已存在 | workspace truth 还没被真正使用 |
| runtime seam | 已存在但仍 local | remote filesystem worker 已 ready |
| absorbed runtime | 仍未进入 `workers/filesystem-core/src/` | W4 shell 已是完整 filesystem worker |

---

## 6. 对 r2 的直接含义

从 realized code evidence 角度看，`filesystem.core` 的工作描述现在应写成：

1. **吸收 D1 workspace-context-artifacts filesystem slice**
2. **吸收 D2 storage-topology**
3. **保留 split blueprint 对 mixed boundary与 agent-core consumer path 的 staged cut-over**
4. **把当前 shell 从 probe shell 提升成真实 filesystem worker**

这与 W3 map / blueprint 完全一致：  
`docs/design/pre-worker-matrix/W3-absorption-map.md:40-42,90-102`

---

## 7. 本文件的最终判断

**`filesystem.core` 现在已经拥有“可部署的壳”“可吸收的 substrate”“真实的 consumer/use-site”，但还没有完成三者合流。**

因此 worker-matrix r2 的主任务不是“证明 filesystem-core 值得做”，而是：

> **完成 D1/D2 absorption，并把当前 shell 提升成真实的 filesystem worker。**
