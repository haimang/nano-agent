# context.core — realized code evidence

> 目标：基于当前仓库源码与 cross-package tests，回答 **`context.core` 今天到底已经实现了什么、还没有实现什么、哪些只是 seam 而不是独立 worker reality`**。

---

## 0. 先给结论

**`context.core` 的代码现实比概念更扎实、比“独立 worker”更薄：**

1. **B4 之后，`context-management` 已经是真包，不是计划稿；**
2. **`workspace-context-artifacts` 已经把 assembly / compact boundary / snapshot / evidence 这些“最像 context.core 的数据面”做实了；**
3. **`session-do-runtime` 现在也已经有真实 runtime use-site；**
4. **但仓内仍没有一个 deployable、独立对外的 `context.core` worker shell。**

---

## 1. 原始素材召回表

### 1.1 原始文档

| 类型 | 原始路径 | 关键行 / 章节 | 用途 |
|---|---|---|---|
| action-plan | `docs/action-plan/after-foundations/B4-context-management-package-async-core.md` | `69-75, 90-120, 568-575, 613-654` | 说明 B4 设计的真实交付目标与 downstream handoff |
| review | `docs/code-review/after-foundations/B2-B4-code-reviewed-by-GPT.md` | `42-70, 74-85, 201-237` | 说明哪些局部实现是 solid，哪些 runtime closure 不应夸大 |
| evaluation | `docs/eval/after-foundations/worker-matrix-eval-with-GPT.md` | `181-226` | 说明为什么 `context.core` 虽成立，但第一版应保持薄 |

### 1.2 当前仓库代码

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| package overview | `packages/context-management/README.md` | `3-15, 45-108, 129-145` | 证明 B4 已经把 `context-management` 做成真实 package |
| orchestrator | `packages/context-management/src/async-compact/index.ts` | `1-24, 25-50, 126-245, 502-620` | 证明 async compact 的 lifecycle、hydrate/persist、retry、restore seam |
| kernel adapter | `packages/context-management/src/async-compact/kernel-adapter.ts` | `1-18, 57-88` | 证明 kernel compact delegate seam 已落地 |
| inspector facade | `packages/context-management/src/inspector-facade/index.ts` | `313-371` | 证明 inspect mount seam 已落地 |
| assembly | `packages/workspace-context-artifacts/src/context-assembler.ts` | `1-22, 39-49, 66-167` | 证明 context assembly 已按 fixed-order/budget/evidence 做实 |
| compact boundary | `packages/workspace-context-artifacts/src/compact-boundary.ts` | `1-22, 36-49, 97-218` | 证明 compact request/response 与 reinject boundary 已做实 |
| snapshot | `packages/workspace-context-artifacts/src/snapshot.ts` | `1-8, 30-49, 84-184, 198-232` | 证明 snapshot 真 capture 真 restore，而不是空数组 |
| evidence | `packages/workspace-context-artifacts/src/evidence-emitters.ts` | `24-84, 120-175, 222-282` | 证明 context-related evidence 现在是统一输出 vocabulary |
| runtime use-site | `packages/session-do-runtime/src/workspace-runtime.ts` | `1-18, 75-101` | 证明 workspace/context trio 已有正式 runtime composition helper |
| runtime use-site | `packages/session-do-runtime/src/do/nano-session-do.ts` | `256-305, 1055-1072` | 证明默认 deploy-shaped path 已给 trio 安装 eval/evidence sink |

### 1.3 当前测试

| 类型 | 原始路径 | 关键行 | 用途 |
|---|---|---|---|
| root contract | `test/context-management-contract.test.mjs` | `52-65` | 证明 inspect mount helper 存在，但 route 默认不接 |
| root contract | `test/workspace-context-artifacts-contract.test.mjs` | `42-82` | 证明 compact boundary 与 redaction 的 cross-package truth |
| root contract | `test/observability-protocol-contract.test.mjs` | `27-71, 73-107` | 证明 observability/stream/audit contract 与 runtime truth 对齐 |
| package integration | `packages/context-management/test/integration/kernel-adapter.test.ts` | `1-79` | 证明 kernel ↔ async-compact seam 能端到端跑通 |
| package unit | `packages/context-management/test/async-compact/committer.test.ts` | `1-195` | 证明 tx swap / size routing / rollback cleanup / version truth 等关键 compact law 成立 |

---

## 2. `context-management`：B4 已经把治理 runtime 做实

### 2.1 不是“计划中的包”，而是已经成形的 public package

`packages/context-management/README.md` 现在已经直接把这个包定义成：

- `budget/`
- `async-compact/`
- `inspector-facade/`

见：`packages/context-management/README.md:3-15`

它还给出了真实用法：

- `AsyncCompactOrchestrator`
- `createKernelCompactDelegate`
- `InspectorFacade`
- `mountInspectorFacade`

见：`packages/context-management/README.md:45-108`

因此，当前不能再把 `context.core` 写成“我们未来也许会有个 `context-management` 包”。

### 2.2 `AsyncCompactOrchestrator` 已经比最初 B4 更完整

`async-compact/index.ts` 文件头已经明确写出三个 post-review 修复：

1. generation token（防 stale prepare 污染）
2. retry budget（`failed` 不再是死终态）
3. persisted compact-state（hydrate / clear persisted state）

见：`packages/context-management/src/async-compact/index.ts:25-50`

而实现层面也能看到：

- `compactStateKeyOf(sessionUuid)`：`155-157`
- constructor 内初始化 state / generation / hydrated：`191-238`
- hydrate/persist 逻辑入口：`240-245`
- `tryCommit(...)` 与 `forceSyncCompact(...)` 的真实 state transition：`502-605`
- `restoreVersion(...)` 仍诚实 throw `"not implemented"`：`613-620`

这说明当前代码真相是：

> **async compact 不是空壳，它已经是一个有真实状态机、真实持久化、真实 fallback 的治理 runtime；只是 rollback/restore 的高级 primitive 仍未全做完。**

### 2.3 kernel seam 也已经是实码而不是口头设计

`createKernelCompactDelegate()` 已经能：

- 读取最新 context layers/version
- 调 `forceSyncCompact(...)`
- 把结果折回 kernel 期望的 `{ tokensFreed }`

见：`packages/context-management/src/async-compact/kernel-adapter.ts:57-88`

而 package integration test 还直接锁了这一点：

- `requestCompact()` 能驱动 end-to-end commit
- commit failure 时 honest return `tokensFreed: 0`

见：`packages/context-management/test/integration/kernel-adapter.test.ts:40-79`

因此：

> **`context.core ↔ kernel` 最核心的 seam 现在已经存在，而且是 buildable/testable 的现实。**

### 2.4 inspector seam 已存在，但仍是 helper truth

`mountInspectorFacade()` 现在已经是真实 helper：

- env gate
- prefix match
- session path rewrite
- lazy facadeFactory

见：`packages/context-management/src/inspector-facade/index.ts:313-371`

但 root contract 同时也锁住了另一个同样重要的事实：

- session-do-runtime 默认 `routeRequest()` 不认 `/inspect/...`
- 只有显式 mount helper 后才有 response

见：`test/context-management-contract.test.mjs:52-65`

所以这里的代码真相必须一分为二：

| 主题 | 当前事实 |
|---|---|
| facade helper | **已真实存在** |
| host 默认 public route | **仍未默认启用** |

---

## 3. `workspace-context-artifacts`：最像 `context.core` 数据面的部分已经真实存在

### 3.1 `ContextAssembler` 已经有固定排序、budget、evidence

`ContextAssembler` 现在已经明确冻结了：

- caller-supplied order = allowlist + ordering
- fallback canonical order
- `required` layers 优先保留
- budget 外只丢 optional
- 可选 emit `assembly` evidence

见：`packages/workspace-context-artifacts/src/context-assembler.ts:1-22, 85-167`

这意味着今天的 `context.core` 数据面，至少在“prompt assembly”这半边，已经不是 loose convention，而是 typed contract。

### 3.2 `CompactBoundaryManager` 已经和 `nacp-core` 对齐

它今天已经会做三件非常具体的事：

1. build `context.compact.request`
2. apply `context.compact.response`
3. 记录 reinject boundary marker 并 emit evidence

见：`packages/workspace-context-artifacts/src/compact-boundary.ts:119-213`

而 root contract 直接证明这些 body 能过 `nacp-core` schema：

见：`test/workspace-context-artifacts-contract.test.mjs:42-82`

这条证据非常关键，因为它说明：

> **worker-matrix 若未来拆 `context.core`，最接近 remote seam 的其实已经不是“压缩算法”，而是 compact boundary 的 request/response vocabulary。**

### 3.3 `WorkspaceSnapshotBuilder` 现在真会 capture

`WorkspaceSnapshotBuilder.buildFragment()` 当前会真实消费：

- `listMounts()` → `mountConfigs`
- `listDir(...)` → `fileIndex`
- `artifactStore.list()` → `artifactRefs`
- caller-supplied layers → `contextLayers`

见：`packages/workspace-context-artifacts/src/snapshot.ts:122-184`

而且还会 emit `snapshot.capture` / `snapshot.restore` evidence：`packages/workspace-context-artifacts/src/snapshot.ts:99-120, 153-160`

这意味着 snapshot seam 已经从“设计上的 checkpoint placeholder”变成了真实数据结构。

### 3.4 context evidence vocabulary 也已经成形

`evidence-emitters.ts` 现在已经把四类 evidence 做成统一 vocabulary：

- `assembly`
- `compact`
- `artifact`
- `snapshot`

见：`packages/workspace-context-artifacts/src/evidence-emitters.ts:24-84, 120-175, 222-282`

这说明 `context.core` 的另一个很真实的部分并不是“推理策略”，而是：

> **它已经拥有一套可进 eval sink、可被后续 verdict/calibration 消费的 evidence language。**

---

## 4. `session-do-runtime`：已经存在真正的 runtime use-site

### 4.1 workspace/context trio 已不再只活在 unit tests

`composeWorkspaceWithEvidence()` 的文件头写得很直白：

- 之前 trio 只在测试里实例化
- 这个 helper 的意义就是给 live runtime 一个统一 use-site

见：`packages/session-do-runtime/src/workspace-runtime.ts:1-18`

helper 本身确实会返回：

- `assembler`
- `compactManager`
- `snapshotBuilder`
- `captureSnapshot()`

见：`packages/session-do-runtime/src/workspace-runtime.ts:75-101`

### 4.2 默认 deploy-shaped path 也已经接上 default eval sink

`NanoSessionDO` 现在在默认 composition 未提供 `eval` 时，会自己安装 bounded in-memory default sink：`packages/session-do-runtime/src/do/nano-session-do.ts:256-280`

如果默认 composition 未提供 `workspace`，它还会：

- 自动 `composeWorkspaceWithEvidence(...)`
- 把 `effectiveEvalSink.emit` 当 evidence sink
- 用 `buildEvidenceAnchor()` 提供 trace/session/team anchor

见：`packages/session-do-runtime/src/do/nano-session-do.ts:282-305`

而 `persistCheckpoint()` 现在还会真的触发一次 `captureSnapshot()`，让 `snapshot.capture` 证据在 deploy-shaped path 里出现：`packages/session-do-runtime/src/do/nano-session-do.ts:1055-1072`

这点非常重要，因为它意味着：

> **`context.core` 相关 evidence 已经不再只存在于 package tests，而是进入了默认 runtime path。**

---

## 5. 当前测试给出的真实支撑

### 5.1 compact boundary / redaction 的 cross-package truth 已被 root test 锁住

`test/workspace-context-artifacts-contract.test.mjs` 直接验证：

- request body 过 `ContextCompactRequestBodySchema`
- response body 过 `ContextCompactResponseBodySchema`
- workspace redaction 与 `nacp-session` redaction 等价

见：`test/workspace-context-artifacts-contract.test.mjs:42-82`

### 5.2 observability 与 session/audit truth 也被锁住

`test/observability-protocol-contract.test.mjs` 直接验证：

- kernel-built event body 可被 `SessionInspector` + `SessionStreamEventBodySchema` 接受：`27-71`
- audit body 能过 `AuditRecordBodySchema` 且 trace-first fields 不丢：`73-107`

这说明 `context.core` 输出到 observability 的结构，并不是自说自话。

### 5.3 context-management 的 helper-only reality 也被锁住

`test/context-management-contract.test.mjs` 的价值不是证明“全接好了”，而是证明：

1. helper 存在；
2. session-do-runtime 默认不接；
3. 需要显式 wiring 才有 inspect route。

见：`test/context-management-contract.test.mjs:52-65`

这是非常有价值的诚实证据。

---

## 6. 当前仍未实现、不能夸大的部分

| 主题 | 当前状态 | 证据 |
|---|---|---|
| 独立 `context.core` worker entry / deploy shell | **不存在** | 仓内没有独立 `context-core` package/worker/wrangler entry |
| live remote `context.compact.*` transport | **不存在** | 现有 `CompactBoundaryManager` 仍是本地 mirror/use-site：`packages/workspace-context-artifacts/src/compact-boundary.ts:119-213` |
| slot/reranker/full semantic context engine | **不存在** | `smind-contexter` learnings 被评为 future input，而非 current code truth：`docs/eval/after-foundations/smind-contexter-learnings.md:31-42,245-259` |
| inspect surface 默认在线 | **不存在** | `test/context-management-contract.test.mjs:52-65` |
| restore primitive | **仍是 explicit stub** | `packages/context-management/src/async-compact/index.ts:613-620` |

---

## 7. 本文件的最终判断

从代码事实看，`context.core` 当前最准确的描述是：

> **一个已经在 package 层与默认 runtime 层局部实现完成的薄 context substrate：budget、async compact、assembly、compact boundary、snapshot、evidence 都是真的；但独立 worker shell、remote transport、slot/reranker/full semantic engine 仍然不是真的。**

这也是后续 worker-matrix 继续推进 `context.core` 时必须守住的现实基线。
