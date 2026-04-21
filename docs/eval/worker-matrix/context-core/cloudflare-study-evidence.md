# context.core — cloudflare study evidence

> 目标：把 `context.core` 与 Cloudflare / Durable Object / R2 / tenant ref / `smind-contexter` 的 edge-native 经验放到一起，判断它在 worker-matrix 中**为什么应该薄做、怎样薄做、厚做到哪一步才算越界**。

---

## 0. 先给结论

**Cloudflare 平台非常适合做薄的 `context.core`，但不适合在 first-wave 里把它做成厚的“语义上下文大脑”：**

1. **DO transaction + DO storage cap + R2 promotion** 非常适合 compact / snapshot / boundary / evidence；
2. **tenant-prefixed ref + eval calibration** 非常适合做可审计的 context data plane；
3. **slot/reranker/local vector engine** 在 DO 内当然可行，但它属于下一波、更重的 context engine，而不是今天已经被代码和验证支撑的 reality。**

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| B4 action-plan | `docs/action-plan/after-foundations/B4-context-management-package-async-core.md` | `64-68, 588-610, 629-654` | 说明 F04/F06/F08、binding-F02/F04 如何约束 context-management |
| worker-matrix eval | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` | `181-226` | 给出“薄做 context.core”的平台化判断 |
| smind learnings | `docs/eval/after-foundations/smind-contexter-learnings.md` | `31-42, 132-143, 192-210, 245-259` | 提供 DO 本地 slot store / BLOB / intent routing 的未来方向 |

### 1.2 当前仓库代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| DO adapter | `packages/storage-topology/src/adapters/do-storage-adapter.ts` | `1-19, 73-90, 160-178` | 证明 DO tx + conservative size cap 是现实平台 law |
| R2 adapter | `packages/storage-topology/src/adapters/r2-adapter.ts` | `1-17, 63-80, 147-187` | 证明 R2 是 oversize object / bulk write 的现实去处 |
| ref law | `packages/storage-topology/src/refs.ts` | `1-23, 67-79, 128-166` | 证明 tenant-scoped key 不是风格问题，而是跨包契约 |
| calibration | `packages/storage-topology/src/calibration.ts` | `174-260` | 证明 placement/evidence 可以做成 evidence-backed，而不是静态拍板 |
| inspector headers | `packages/context-management/src/inspector-facade/types.ts` | `20-38` | 证明 service-binding/header law 已进入 inspect surface |
| reference backend | `packages/workspace-context-artifacts/src/backends/reference.ts` | `1-29, 58-81, 120-141` | 证明 durable workspace/context data plane 已能接 DO/R2 substrate |

### 1.3 `context/` 参考实现

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| engineering design | `context/smind-contexter/app/design.txt` | `159-184` | 说明厚 context engine 的真实复杂度 |
| DDL learnings | `docs/eval/after-foundations/smind-contexter-learnings.md` | `192-210` | 说明 `contexts / vec_history / vec_intents` 等 DO 内 schema 经验 |
| coldstart / intent routing | `docs/eval/after-foundations/smind-contexter-learnings.md` | `241-259` | 说明本地 cosine / intent prefill 的未来价值 |
| DO storage | `context/smind-contexter/core/db_do.ts` | `123-183, 186-220` | 说明 DO 内本地数据库/BLOB 是真实可行路径 |

---

## 2. Cloudflare 平台给 `context.core` 的硬约束

### 2.1 DO transaction 很适合 compact swap，但 DO value cap 不允许粗暴塞大 blob

`DOStorageAdapter` 当前已经把平台真相写进代码与注释：

- DO storage 有 transaction 语义：`packages/storage-topology/src/adapters/do-storage-adapter.ts:160-178`
- 默认 `maxValueBytes = 1 MiB` 是保守 cap：`73-90`
- 大对象应在 reaching DO 前就被 size-check / route away：`115-127`

这直接决定了 `context.core` 的实现方向：

> **compact-state、inline context、checkpoint metadata 很适合在 DO；大 summary / archived history / snapshot blob 不能天真地全部塞 DO。**

### 2.2 R2 适合作为 oversize summary / archive 层，而不是热路径主存

`R2Adapter` 的代码也把平台真相写得很清楚：

- `put` 有大小检查：`99-113`
- `list` 需要 cursor walk：`120-165`
- `putParallel` 是因为每次 put 有明显固定开销：`168-187`

因此对 `context.core` 的含义是：

1. **大 summary / archive / snapshot fragment** 非常适合进 R2；
2. **高频热状态** 不适合依赖 R2 round-trip；
3. **批量补写历史/归档** 可以利用 parallel path，但不应把它当主同步链路。

### 2.3 tenant-prefixed ref 是平台多租户下的硬 law

`refs.ts` 已经把统一 key law 写死：

- 所有 key 都必须是 `tenants/{team_uuid}/...`
- `buildDoStorageRef` / `buildR2Ref` / `buildKvRef` 全都走同一 law
- `validateRefKey()` 直接按这个前缀验证

见：`packages/storage-topology/src/refs.ts:1-23, 67-79, 128-166`

这条对 `context.core` 尤其重要，因为它处理的是：

- history ref
- summary ref
- artifact ref
- snapshot / checkpoint related refs

任何一个逃逸出 tenant prefix，都会把 compact/snapshot/evidence 变成跨租户风险面。

### 2.4 evidence-backed placement 非常符合 Cloudflare 平台

`placementLogToEvidence()` 现在会把 placement log 变成：

- `placement-observation`
- `size`
- `read-frequency`
- `write-frequency`

见：`packages/storage-topology/src/calibration.ts:174-260`

这套模型与 Cloudflare 平台天然匹配，因为：

1. DO/R2/KV 的 trade-off 本来就强依赖 size / frequency / locality；
2. `context.core` 恰好是最容易产生这些 evidence 的组件；
3. 所以它比“先拍脑袋冻结 topology”更适合走 evidence-first 路线。

### 2.5 service-binding/header law 也已经进入 inspect seam

`context-management` 的 inspector header 常量全部 lowercase：

- `x-inspector-bearer`
- `x-inspector-ip-allowlist-bypass`
- `x-nacp-trace-uuid`

见：`packages/context-management/src/inspector-facade/types.ts:20-38`

这不是小事；它说明 `context.core` 相关 surface 已经吸收了 Cloudflare / binding transport 的真实 header 行为，而不是写成传统 Node/server 的想象。

---

## 3. `smind-contexter` 给 `context.core` 的真正启发

### 3.1 它证明“厚 context engine”当然可行，但那是下一波复杂度

`smind-contexter` 的 learnings 明确表明，它真正的高价值资产是：

- L1/L2/L3 slot 模型
- 每轮 rebalance
- reranker
- local vector / intent prefill

见：`docs/eval/after-foundations/smind-contexter-learnings.md:31-42`

这套东西当然能跑在 DO/Workers 上，但同时也意味着：

> **真正的厚 context engine 远不只是 compact/snapshot；它需要独立的数据结构、向量生命周期、rerank strategy、intent routing。**

因此它更像是 `context.core` 的 phase-2/phase-3 蓝图，而不是 first-wave reality。

### 3.2 `contexts / vec_history / vec_intents` 对未来很有价值，但今天没有对应实现

learnings 里提炼出的 DDL 启发包括：

- `contexts`：L1/L2/L3 slot state
- `vec_history`：冷数据 blob
- `vec_intents`：冷启动意图路由

见：`docs/eval/after-foundations/smind-contexter-learnings.md:192-210`

这说明未来的 `context.core` 完全可能会长成：

1. 一个真正 stateful 的 slot store；
2. 一个本地向量 / intent cache；
3. 一个与 reranker worker 协作的 engine；

但今天 nano-agent 仓内真实存在的，还只是：

- compact
- assembly
- snapshot
- evidence

### 3.3 owner 已经明确：reranker 不进 first-wave `context.core`

`smind-contexter` learnings 文件最关键的 owner decision 是：

- reranker 不进 worker matrix first-wave
- reranker 不作为 `context.core` 组件
- reranker 未来走独立 `context.reranker` worker + hook/service-binding 路径

见：`docs/eval/after-foundations/smind-contexter-learnings.md:37-42`

这意味着 worker-matrix 阶段的 `context.core` 必须被写成：

> **预算、装配、compact、snapshot、evidence 的执行核心，而不是语义排序与智能检索的总控。**

---

## 4. 对 worker-matrix 的推荐姿态

### 4.1 推荐姿态：薄 worker / 甚至 first-wave 不独立

结合当前代码与平台约束，我对 `context.core` 的推荐仍然是：

1. **优先把它当成薄 substrate 理解；**
2. **在 first-wave 可以不必立刻做独立 worker；**
3. **如果要拆，也只拆 compact/snapshot/evidence 这几条最实的 seam。**

这与两份 worker-matrix 评估是同向的：`docs/eval/after-foundations/worker-matrix-eval-with-GPT.md:181-226`; `docs/eval/after-foundations/worker-matrix-eval-with-Opus.md:171-250`

### 4.2 如果真的拆独立 worker，建议只让它拥有下面这些职责

| 建议保留 | 原因 |
|---|---|
| `budget` | 纯 policy/runtime core，最稳定 |
| `async compact` | 已有 formal `context.compact.*` 接口雏形 |
| `assembly` | typed contract 已稳定 |
| `snapshot` | checkpoint/evidence 价值高且边界清楚 |
| `evidence emission` | 最利于后续 calibration / verdict |

### 4.3 明确不建议在 first-wave 里塞进去的职责

| 不建议 first-wave 纳入 | 为什么 |
|---|---|
| reranker | owner 已决定独立 worker 化 |
| local vector / intent engine | 当前代码无真实实现，且复杂度高 |
| 厚的 public context API | 当前 inspect/control 都还是 host-mounted seam |
| D1-first schema freeze | 当前 evidence 与真实 runtime 还不足以支撑物理设计定案 |

---

## 5. 本文件的最终判断

从 Cloudflare / edge-native 证据看，`context.core` 的最佳 verdict 是：

> **非常适合做成一个薄的、证据驱动的 context substrate；不适合在 worker-matrix first-wave 里被误写成厚的 semantic context engine。**

换句话说：

1. **平台支持它先把 compact / snapshot / evidence 做硬；**
2. **平台也允许它以后成长成 slot/rerank/intent engine；**
3. **但今天真正被代码和验证支撑的，只有前者。**
