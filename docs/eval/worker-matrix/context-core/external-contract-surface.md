# context.core — external contract surface

> 目标：定义 `context.core` 今天真实存在的 **upstream / downstream / host-mount / platform** 四层外部面，避免把它误写成“一个什么都做的 context API worker”。

---

## 0. 先给结论

**`context.core` 今天的外部面是“多 seam、少 public API”的：**

1. **上游主要是 host runtime / kernel / workspace 调用 seam**；
2. **下游主要是 DO/R2/ref/eval sink seam**；
3. **public inspect surface 存在，但只是 host opt-in mount helper**；
4. **还没有证据支持它作为一个完整独立 worker 对外提供厚 context API。**

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| action-plan | `docs/action-plan/after-foundations/B4-context-management-package-async-core.md` | `69-75, 112-120, 196-203, 613-654` | 定义 B4 对外 surface、与 kernel/session/workspace 的 companion seam |
| review | `docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md` | `29-37, 64-70, 201-237` | 说明 `/inspect/...` 与 session-edge integration 仍应诚实表述 |
| evaluation | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` | `199-223` | 说明 `context.core` 第一版应只做 assembly / compact / snapshot / evidence |
| evaluation | `docs/eval/after-foundations/smind-contexter-learnings.md` | `35-42, 253-259` | 说明 reranker 应单独 worker 化，`context.core` 不应第一波过厚 |

### 1.2 当前代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| root API | `packages/context-management/README.md` | `3-15, 23-108` | 说明 `context-management` 的 public API 就是 `budget / async-compact / inspector-facade` |
| kernel seam | `packages/context-management/src/async-compact/kernel-adapter.ts` | `1-18, 39-59, 62-88` | 说明上游 kernel 通过 `CompactDelegate` 形状接入 |
| inspector providers | `packages/context-management/src/inspector-facade/types.ts` | `154-230` | 说明 facade 完全依赖 host 提供数据源，而非自己拥有全量 runtime |
| mount helper | `packages/context-management/src/inspector-facade/index.ts` | `313-371` | 说明 inspect surface 需要 host 显式启用 |
| workspace trio | `packages/session-do-runtime/src/workspace-runtime.ts` | `1-18, 45-62, 75-101` | 说明上游 host 实际如何组装 assembly / compact / snapshot |
| default evidence path | `packages/session-do-runtime/src/do/nano-session-do.ts` | `256-305, 1055-1072` | 说明 evidence sink 与 workspace trio 已有 deploy-shaped runtime use-site |

### 1.3 `context/` 参考实现

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| gateway memo | `context/smind-contexter/app/plan-chat.ts.txt` | `9-22, 25-44` | 对照理解 gateway/public API 与 stateful engine 的分层 |
| engine memo | `context/smind-contexter/app/plan-engine_do.ts.txt` | `8-21, 24-43, 90-108` | 对照理解 stateful engine 应暴露什么、不应暴露什么 |
| producer | `context/smind-contexter/context/producer.ts` | `328-357, 364-392` | 对照理解上游给下游的 contract 应聚焦在 prompt/materials，而不是开放全量内部状态 |

---

## 2. 四层外部面总表

| 面向对象 | 当前真实 surface | 当前状态 | 不应误写成什么 |
|---|---|---|---|
| 上游 host / kernel | `AsyncCompactOrchestrator`、`createKernelCompactDelegate()`、`ContextAssembler`、`WorkspaceSnapshotBuilder` | **真实存在** | 不应误写成“client 直接调用的 context API” |
| 下游 storage / refs | `DOStorageAdapter`、`R2Adapter`、`StorageRef` builders、`ReferenceBackend` | **真实存在但偏 substrate** | 不应误写成“最终生产 topology 已冻结” |
| 下游 observability | `EvidenceSinkLike`、`SessionInspector`、`StoragePlacementLog` calibration seam | **真实存在** | 不应误写成“已经有独立 context dashboard worker” |
| public inspect / control | `InspectorFacade` + `mountInspectorFacade()` | **存在但 host opt-in** | 不应误写成“默认 always-on public surface” |

---

## 3. 上游 surface：`agent.core` / kernel / workspace 怎么接它

### 3.1 Kernel 只需要一个窄 `CompactDelegate`

`createKernelCompactDelegate()` 明确说明了自己的定位：

- kernel 侧 contract 仍是窄的 `requestCompact(budget): Promise<{ tokensFreed }>`
- adapter 负责把这个 contract 转给 `AsyncCompactOrchestrator.forceSyncCompact(...)`
- 它不会反向污染 kernel scheduler contract

见：`packages/context-management/src/async-compact/kernel-adapter.ts:1-18, 39-59, 62-88`

所以 `context.core` 对 kernel 的外部面应被冻结为：

> **“turn boundary compact delegate” seam，而不是一套新的 kernel-owned context subprotocol。**

### 3.2 Host runtime 真实接的是 workspace trio，而不是“context worker RPC”

`composeWorkspaceWithEvidence()` 现在已经成为真实 runtime use-site：

- 组装 `ContextAssembler`
- 组装 `CompactBoundaryManager`
- 组装 `WorkspaceSnapshotBuilder`
- 可选绑定 `evidenceSink + evidenceAnchor`

见：`packages/session-do-runtime/src/workspace-runtime.ts:1-18, 45-62, 75-101`

`NanoSessionDO` 默认路径如果没有上游提供 `workspace` handle，还会自己装一个：

- 自动安装 default eval sink
- 把同一个 sink 作为 workspace evidence sink
- 让 checkpoint path 真实触发 `snapshot.capture`

见：`packages/session-do-runtime/src/do/nano-session-do.ts:256-305, 1055-1072`

这说明当前上游 contract 的真实重心是：

> **host runtime 在本地组合 context primitives，而不是已经通过 remote worker RPC 来调用一个独立 `context.core`。**

### 3.3 上游 assembler contract 已经很明确

`ContextAssembler` 的 contract 今天已经足够清晰：

- `config.layers` 非空时既是 allowlist 也是 ordering
- 空时退回 canonical order
- `required` layer 总是尽量保留
- 超预算时只 drop optional layers

见：`packages/workspace-context-artifacts/src/context-assembler.ts:1-22, 85-167`

这意味着上游真正要传给 `context.core` 的不是“任意 context DSL”，而是：

1. layers；
2. ordering / allowlist；
3. budget；
4. evidence anchor；

这是一个**很窄、很 typed** 的 contract。

---

## 4. public inspect / control surface：存在，但默认不是 always-on

### 4.1 `InspectorFacade` 是 host-mounted seam

`mountInspectorFacade()` 的行为很明确：

- 默认 `INSPECTOR_FACADE_ENABLED` 未开时直接 `null`
- path 不在 prefix 下直接 `null`
- 只有命中 prefix 时才 rewrite/path-dispatch 给具体 facade

见：`packages/context-management/src/inspector-facade/index.ts:313-371`

而 root contract test 也直接把这条 truth 锁住了：

- `routeRequest(request)` 对 `/inspect/...` 默认返回 `not-found`
- 显式调用 `mountInspectorFacade(...)` 后才得到 `200`

见：`test/context-management-contract.test.mjs:52-65`

因此对 `context.core` 的正确表述是：

> **inspect surface 是一个可挂载的 control/read facade，不是默认总存在的 public worker surface。**

### 4.2 facade 自己也承认它依赖 host providers

`InspectorFacadeConfig.providers` 需要 host 提供：

- usage snapshot
- compact state
- buffer/compact policy
- snapshots
- layers
- tier router metrics
- trigger snapshot/compact/restore

见：`packages/context-management/src/inspector-facade/types.ts:154-230`

这说明 facade 自己并不拥有完整 runtime；它只是把 host 已有的 context data sources 暴露出来。

### 4.3 restore / control 面仍是诚实 partial

当前 facade 对 control routes 仍是谨慎姿态：

- 没有 provider 就返回 `501 control-disabled`
- `AsyncCompactOrchestrator.restoreVersion()` 还明确 `throw not implemented`

主证据：`packages/context-management/src/inspector-facade/index.ts:200-221`; `packages/context-management/src/async-compact/index.ts:613-620`

因此：

> **`context.core` 当前有 control seam，但没有资格被写成“完整的 context admin plane”。**

---

## 5. 下游 surface：storage / refs / observability

### 5.1 storage 侧是真 substrate，不是 final topology

当前 `context.core` 可直接消费的存储面包括：

- `DOStorageAdapter`：适合 compact-state / inline context / tx swap：`packages/storage-topology/src/adapters/do-storage-adapter.ts:1-19, 73-90, 160-178`
- `R2Adapter`：适合 oversize summary / archive：`packages/storage-topology/src/adapters/r2-adapter.ts:1-17, 63-80, 147-187`
- `ReferenceBackend`：提供 workspace 文件层面的 connected seam，但仍要求 caller 自己处理 tenant prefix：`packages/workspace-context-artifacts/src/backends/reference.ts:1-29, 58-81, 120-141`

这条 surface 的正确理解是：

> **`context.core` 已经有可用的 substrate，但还没有足够证据支持把 DO/KV/R2 物理放置策略全部冻结成 final runtime law。**

### 5.2 evidence / observability 侧是真接线

当前 evidence surface 已经不只是设计稿：

- `ContextAssembler` 能 emit `assembly`
- `CompactBoundaryManager` 能 emit `compact.request/response/boundary/error`
- `WorkspaceSnapshotBuilder` 能 emit `snapshot.capture/restore`
- `NanoSessionDO` 默认路径已经把 workspace trio 接进 eval sink

见：`packages/workspace-context-artifacts/src/evidence-emitters.ts:24-84, 120-175, 222-282`; `packages/session-do-runtime/src/do/nano-session-do.ts:256-305, 1055-1072`

所以对下游 observability 的判断是：

> **`context.core` 今天已经拥有 evidence output seam，但它仍是“发 records 到 eval sink”，不是“自己运营一个 observability worker”。**

### 5.3 calibration seam 已存在，但仍是 evidence-driven

`storage-topology` 已经能把 `StoragePlacementLog` entry 转成 calibration signals：

- `placement-observation`
- `size`
- `read-frequency`
- `write-frequency`

见：`packages/storage-topology/src/calibration.ts:174-260`

这条 surface 的价值在于：

> **未来 `context.core` 的 placement 决策可以 evidence-backed 校准，而不是一开始拍脑袋写死。**

---

## 6. 明确不支持的 external surface

当前 `context.core` **不应宣称支持** 下列对外面：

1. **通用 public context HTTP API**  
   当前只有 host-mounted inspect/control seam，没有 general context REST surface。

2. **完整 slot/rerank/context-engine RPC**  
   当前没有这类 formal contract，也没有独立 worker 实现。

3. **直接 client-facing session push contract**  
   client 可见的 compact/lifecycle 反馈仍属于 `session.stream.event`。

4. **冻结后的 production topology API**  
   `storage-topology` 目前更像 policy/evidence substrate，而不是已定案的生产接口。

---

## 7. 本文件的最终判断

从 external contract surface 角度看，`context.core` 当前最健康的姿态是：

> **上游只暴露给 host/kernel/workspace 的 typed seam，下游只依赖 storage/ref/evidence substrate，public 面保持 opt-in inspector facade，而不是直接长成一个厚的独立 context API worker。**

这也是 worker-matrix first-wave 最应该坚持的边界。
