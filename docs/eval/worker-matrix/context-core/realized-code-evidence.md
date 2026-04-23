# context.core — realized code evidence

> 目标：只基于当前代码与当前 closure truth，回答 `context.core` 已经有什么、还缺什么。

---

## 0. 先给结论

**`context.core` 当前最准确的代码判断是：worker shell 已 materialize；C1/C2 substrate 已在 packages 中真实存在；runtime use-site 也已经存在；真正没完成的，是把 C1/C2 吸收到 `workers/context-core/` 并让该 shell 承接 live runtime。**

---

## 1. 当前最重要的代码锚点

| 层 | 路径 | 当前用途 |
|---|---|---|
| worker shell | `workers/context-core/package.json`; `wrangler.jsonc`; `src/index.ts`; `test/smoke.test.ts` | 证明 deploy-shaped shell |
| C1 package | `packages/context-management/*` | 证明 compact/budget/inspector substrate |
| C2 package slice | `packages/workspace-context-artifacts/src/context-assembler.ts`; `compact-boundary.ts`; `snapshot.ts`; `evidence-emitters.ts` | 证明 context slice 的真实语义 |
| runtime seam | `packages/session-do-runtime/src/workspace-runtime.ts`; `src/do/nano-session-do.ts` | 证明当前 host-local use-site |
| phase truth | `docs/issue/pre-worker-matrix/W4-closure.md`; `docs/design/pre-worker-matrix/W3-absorption-map.md`; `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md` | 证明当前 shell reality 与吸收目标 |

---

## 2. 已经真实存在的 worker shell

### 2.1 `workers/context-core` 已是 deploy-shaped 目录

直接证据：

- `workers/context-core/package.json:1-24`
- `workers/context-core/wrangler.jsonc:1-22`
- `workers/context-core/src/index.ts:1-22`
- `workers/context-core/test/smoke.test.ts:1-26`

当前 shell 已真实具备：

1. `build / typecheck / test / deploy:dry-run / deploy:preview`
2. worker fetch handler
3. 对 NACP published truth 的 probe 输出
4. W4 matrix CI / dry-run 适配

### 2.2 但当前 shell 还没有吸收 C1/C2

`workers/context-core/src/index.ts:5-22` 当前只返回版本探针 JSON，没有：

1. compact orchestrator
2. kernel delegate
3. inspector facade mount
4. context assembler / compact boundary / snapshot
5. any runtime composition

因此当前 shell 必须诚实写成：

> **deploy shell exists, context substrate not yet absorbed**

---

## 3. 已经真实存在的 context substrate 仍在 packages 中

### 3.1 C1 `context-management` 已是真 package

当前关键事实：

- `packages/context-management/package.json:1-52`
- `packages/context-management/README.md`

它已经真实拥有：

1. budget policy
2. async compact lifecycle
3. inspector facade

因此 `context.core` 当前不是“未来也许会有个 context-management 包”，而是：

> **C1 package 已存在，待吸收。**

### 3.2 C2 的 context slice 也已是真代码

当前 `workspace-context-artifacts` 里真正属于 C2 的部分包括：

1. `context-assembler`
2. `compact-boundary`
3. `snapshot`
4. context-side evidence emitters

split blueprint 已明确这些应归 `context-core`：  
`docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md:53-77,89-107`

因此当前真相不是“只有 context-management 一包”，而是：

> **`context.core` 的真实语义已经分布在 C1 + C2 两个 absorption units 中。**

### 3.3 runtime use-site 也已经存在

当前 host runtime 已经通过：

- `packages/session-do-runtime/src/workspace-runtime.ts`
- `packages/session-do-runtime/src/do/nano-session-do.ts`

把 workspace/context trio 真的用起来了。

这意味着 `context.core` 相关能力已经不只是 package tests，而是：

> **已经进入 deploy-shaped host default path 的局部 use-site。**

---

## 4. 当前还没有闭合的东西

### 4.1 当前 shell 还不是 live context worker

W4 只证明了：

1. 目录存在
2. wrangler 形状存在
3. build/test/dry-run 存在

它没有证明：

1. C1/C2 已迁入 `workers/context-core/src/`
2. remote compact helper 已接通
3. worker shell 已提供 live context worker route

### 4.2 `initial_context` 仍没有 consumer

当前搜索结果仍是：

1. `packages/context-management/src` 无 `initial_context` / `appendInitialContextLayer`
2. `packages/session-do-runtime/src` 也无该 consumer

因此 `initial_context` 对 `context.core` 来说仍是 adjacent future work，而不是当前代码 reality。

### 4.3 远端 worker 路线仍没闭合

`context.core` 当前最重要的 nuance 是：

1. local/runtime seam 已真实存在
2. shell 已真实存在
3. 但二者还没有在 worker 层合流

因此它今天既不是“纯概念”，也不是“已 remoteized runtime”。

---

## 5. W3/W4 之后，`context.core` 的代码真相应该怎么写

| 维度 | 当前真相 | 不应写成什么 |
|---|---|---|
| worker shell | 已存在，dry-run 已过 | 还没有独立 worker 目录 |
| C1 package | 已存在 | 还是计划稿 |
| C2 context slice | 已存在 | 还没有清晰吸收对象 |
| runtime use-site | 已存在 | 还完全没有 live consumer path |
| absorbed runtime | 仍未进入 `workers/context-core/src/` | W4 shell 已是完整 context worker |

---

## 6. 对 r2 的直接含义

从 realized code evidence 角度看，`context.core` 的工作描述现在应写成：

1. **吸收 C1 context-management**
2. **吸收 C2 workspace-context-artifacts context slice**
3. **保留 split blueprint 对 mixed evidence helper 的 owner 划分**
4. **把当前 shell 从 probe shell 提升成真实 context worker**

这与 W3 map / blueprint 完全一致：  
`docs/design/pre-worker-matrix/W3-absorption-map.md:39-42,85-102`

---

## 7. 本文件的最终判断

**`context.core` 现在已经拥有“可部署的壳”“可吸收的 substrate”“真实的 host use-site”，但还没有完成三者合流。**

因此 worker-matrix r2 的主任务不是“证明 context-core 值得做”，而是：

> **完成 C1/C2 absorption，并把当前 shell 提升成真实的薄 context worker。**
