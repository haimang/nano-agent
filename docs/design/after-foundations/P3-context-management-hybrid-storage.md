# Nano-Agent After-Foundations P3 — Context-Management Hybrid Storage Tier Router

> 功能簇：`packages/context-management/storage/` (tier router 子模块)
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md` (**F02 — list cursor 必须 walk**)
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (**F03 — KV freshness contract**)
> - `docs/spikes/spike-do-storage/05-mem-vs-do-state-parity-confirmed.md` (F05 — basic K/V parity → MemoryBackend 可信本地)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (**F08 — tier routing decision driver**)
> - `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md` (**unexpected-F01 — bulk write must use putParallel**)
> - `docs/spikes/unexpected/F02-kv-write-latency-500ms.md` (**unexpected-F02 — hot path KV write must putAsync**)
> - `docs/spikes/storage-findings.md` (rollup)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B4 (this design's input contract)
>
> 上游 charter / 模板：
> - `docs/plan-after-foundations.md` §1.5 (hybrid storage + tagged conversation 双轨决策) + §5.5 (方法论) + §7.4 (Phase 3 子模块)
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §5.3 (hybrid storage 决策来源)
> - `docs/eval/after-foundations/context-management-eval-by-GPT.md` §4.3 (hybrid storage 表)
> - `docs/templates/design.md`
>
> 兄弟 design (P3 family):
> - `docs/design/after-foundations/PX-async-compact-lifecycle-spec.md` (committer.ts 调用 tier router)
> - `docs/design/after-foundations/P3-context-management-async-compact.md` (consumes tier router)
> - `docs/design/after-foundations/P3-context-management-inspector.md` (inspector reads tier metrics)
>
> 上游 Phase 1 dependency:
> - `docs/design/after-foundations/P1-storage-adapter-hardening.md` (consumes 4 adapters)
> - `docs/rfc/scoped-storage-adapter-v2.md` (interface v2)
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

`hybrid-storage/` 子模块实现 charter §1.5 业主决策的 **"hybrid storage + tagged conversation 双轨"** 模型——逻辑上 single conversation + tag，物理上按 tag 路由到 KV/DO storage/R2/D1 不同 tier。本 design 把这个决策转成具体 router class + tag→tier mapping + size-aware promotion + B1 finding evidence。

- **项目定位回顾**：业主在 charter §1.5 + `context-management-eval-by-Opus.md` v2 §5.3 + GPT §4.3 三方收敛得出的设计 —— **不**做 Deepseek 提议的"L0/L1/L2/L3 KV 全分层"，**也不**做 Opus v1 提议的"全部塞 single message[]"，而是 hybrid: 逻辑视图统一，物理存储按 tag 路由
- **本次讨论的前置共识**：
  - P1 ship 的 4 个 adapter (DOStorageAdapter / R2Adapter / KvAdapter / D1Adapter) 是本子模块的 ground primitive
  - **F08 size cap (1 MiB DO)** 是 router 决策的硬约束 —— > 1 MiB 强制走 R2
  - **F02 cursor walking** —— router 跨 tier list 必须 cursor-aware (R2 strict)
  - **F03 KV freshness** 同 colo strong；cross-colo TBD —— router read path 必须文档化此 caveat
  - **F05 MemoryBackend 基本 K/V parity** —— 本地开发可信 MemoryBackend 模拟 router behavior
  - **unexpected-F01 R2 273 ms/put** —— bulk artifact migration 必须走 R2Adapter.putParallel
  - **unexpected-F02 KV 520 ms write** —— hot path tier write 必须用 KvAdapter.putAsync
  - 业主 charter §4.1 D 第 19 项: tier router 留在 `storage-topology` 的 placement 模块？还是 `context-management/storage/` 子模块？**本设计采纳后者**（GPT §2.3 修订: 收窄 context-management 包边界，但 tier-router 是 hybrid context model 的核心；放 context-management 不破坏 storage-topology 的 adapter-only 职责）
- **显式排除的讨论范围**：
  - 不讨论 async compact lifecycle（→ async-compact P3 design）
  - 不讨论 inspector facade（→ inspector P3 design）
  - 不讨论 D1 schema design（业务 phase）
  - 不讨论 cross-region replication strategy
  - 不讨论 tier 之间的 transactional consistency (跨 adapter cross-namespace tx 是 explicit out-of-scope per charter §4.2 第 9 项)

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`packages/context-management/src/storage/`
- **一句话定义**：tag-aware tier router——根据 `ContextLayer.tag` 把 read/write 路由到对应物理 tier (KV / DO storage / R2 / D1)，对调用方暴露统一 K/V-like API。
- **边界描述**：本子模块**包含**tier mapping table、router class、size-aware promotion logic、`MemoryBackend` config 对齐、bulk write 调度；**不包含**adapter 实现 (P1)、async compact lifecycle (sibling)、inspector endpoint (sibling)、business data layer (out-of-scope)。
- **关键术语对齐**：

| 术语 | 定义 |
|---|---|
| `ContextLayerTag` | enum: `system / memory / interaction / tool_result / summary / knowledge_chunk` (per `context-management-eval-by-Opus.md` v2 §3.3) |
| `TierRouter` | 按 tag 选择 adapter 的 dispatch 层 |
| `TierBinding` | tag → adapter 映射的 frozen config |
| `Promotion` | size > tier cap 时切换到更大 tier 的动作 (e.g. > 1 MiB → R2) |
| `inline payload` | 直接存在 DO storage 的 small value |
| `ref payload` | DO storage 仅存 NacpRef，真实 bytes 在 R2 |

### 1.2 参考调查报告

详见 frontmatter B1 findings + `context-management-eval-by-Opus.md` v2 §5.3 hybrid storage 表.

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本子模块在整体架构里的角色：**hybrid context model 的物理映射层**
- 服务于：`async-compact/` (committer 写 summary 走 router)、`workspace-context-artifacts` (assembler 读 layer 走 router)、worker matrix 阶段 `filesystem.core` (file-backed layers 走 router)
- 依赖：P1 ship 的 4 adapter
- 被谁依赖：`async-compact/` (sibling)、`inspector-facade/` (sibling，读 metrics)、agent-runtime-kernel (turn loop assemble context 时 read via router)

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `P1-storage-adapter-hardening` | depends on | 强 | 直接 import 4 adapter (P1 ship 的) |
| `async-compact/` (sibling) | called by | 强 | committer 调 router.write(`summary` tag) |
| `inspector-facade/` (sibling) | reads metrics from | 中 | tier hit rate / promotion count |
| `workspace-context-artifacts/src/context-layers.ts` | reuses | 强 | `ContextLayerKind` enum 扩展为 `ContextLayerTag` |
| `workspace-context-artifacts/src/context-assembler.ts` | indirect (via assembler) | 中 | assembler 读 layer 走 router |
| `workspace-context-artifacts/src/snapshot.ts` | indirect | 弱-中 | snapshot builder 写 artifacts 时按 tag promote |
| `B2-writeback-r2list-cursor-interface.md` | references | 弱 | router 的 list 操作消费 P1 v2 接口 |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`hybrid-storage/` 是 **context layer 的物理映射层**——把 logical tagged conversation 转成 4 tier 物理存储 dispatch，对上游消化业主 §1.5 hybrid 双轨决策，对下游为 async-compact / inspector / assembler 提供 tag-aware K/V-like API。

---

## 3. 子模块文件结构

```
packages/context-management/src/storage/
├── index.ts                 (re-exports + TierRouter entry)
├── types.ts                 (ContextLayerTag enum + TierBinding + RoutedRead/Write types)
├── tier-binding.ts          (frozen tag→adapter mapping; default + override interface)
├── tier-router.ts           (核心 — TierRouter class)
├── promotion.ts             (size-aware promotion: DO inline → R2 ref logic per F08)
├── bulk-write.ts            (bulk artifact migration via R2Adapter.putParallel per unexpected-F01)
└── memory-backend-align.ts  (拓展 MemoryBackend 配置以匹配 router 行为，本地开发可信)
```

---

## 4. Tag → Tier Mapping (canonical)

### 4.1 Default tier binding

| `ContextLayerTag` | Default tier | Adapter | Why |
|---|---|---|---|
| `system` | KV | `KvAdapter` (`putAsync` for hot path) | small / stable / read-many; F03 same-colo strong; unexpected-F02 motivates async write |
| `memory` | KV | `KvAdapter` (`putAsync`) | structured / persistent across sessions; unexpected-F02 same |
| `interaction` | DO storage | `DOStorageAdapter` | high-write per-session; ≤ 1 MiB inline (F08); transactional (F04) |
| `tool_result` | DO storage (≤ 1 MiB) OR R2 ref (> 1 MiB) | `DOStorageAdapter` + `R2Adapter` (size-aware) | tool outputs vary in size; promotion driven by F08 |
| `summary` | DO storage (≤ 1 MiB) OR R2 ref (> 1 MiB) | same as tool_result | compaction summary; promotion driven by F08 |
| `knowledge_chunk` | R2 (always ref) | `R2Adapter` | RAG-fetched chunks; not held inline; F02 list cursor for enumeration |

### 4.2 Per-session override

```ts
// types.ts
export interface TierBindingOverride {
  readonly tag: ContextLayerTag;
  readonly tier: "kv" | "do" | "r2" | "d1";
  readonly promotionThresholdBytes?: number;  // override default 1 MiB
}

export interface TierRouterConfig {
  readonly overrides?: TierBindingOverride[];
}
```

### 4.3 Why D1 is NOT a default tier for any tag

Per F06 (D1 cross-query rejected) + charter §4.1 F (don't穿透 storage to NACP) + business-DDL out-of-scope: D1 is reserved for future business manifest tables. Context layers do **not** use D1 by default. D1 binding allowed only via explicit `TierBindingOverride` for advanced use cases.

---

## 5. `TierRouter` API surface

```ts
// tier-router.ts
export class TierRouter {
  constructor(
    private readonly bindings: TierBinding,
    private readonly adapters: {
      kv: KvAdapter;
      do: DOStorageAdapter;
      r2: R2Adapter;
      d1?: D1Adapter;
    },
  ) {}

  /**
   * Read a single layer payload. Returns inline value or, if stored as ref,
   * automatically dereferences from R2.
   */
  async read(tag: ContextLayerTag, key: string): Promise<unknown | null>;

  /**
   * Write a layer payload. Automatically routes per tag binding;
   * automatically promotes to R2 if value > tier promotion threshold (F08).
   */
  async write(tag: ContextLayerTag, key: string, value: unknown): Promise<RoutedWriteResult>;

  /**
   * List layers under a tag prefix; uses cursor walking for R2 (F02).
   */
  async list(tag: ContextLayerTag, prefix: string): Promise<RoutedListResult>;

  /**
   * Bulk-write many small artifacts (e.g. snapshot build); uses
   * R2Adapter.putParallel for r2-bound tags (unexpected-F01).
   */
  async writeBulk(tag: ContextLayerTag, items: Array<{ key: string; value: unknown }>): Promise<void>;

  /**
   * Hot-path write (fire-and-forget for KV-bound tags); used for
   * system/memory layer updates (unexpected-F02).
   */
  writeHotPath(tag: ContextLayerTag, key: string, value: unknown, ctx?: WaitUntilCtx): void;

  /**
   * Inspector metric: count of promotions / cap-triggered events / etc.
   * Read by P3-inspector-facade.
   */
  getMetrics(): TierRouterMetrics;
}

export type RoutedWriteResult =
  | { kind: "inline"; tier: "kv" | "do"; bytes: number }
  | { kind: "ref"; tier: "r2"; bytes: number; ref: NacpRef }
  | { kind: "promoted"; from: "do" | "kv"; to: "r2"; ref: NacpRef; reason: "size-cap" };

export interface RoutedListResult {
  readonly objects: ReadonlyArray<{ key: string; sizeBytes?: number; ref?: NacpRef }>;
  readonly truncated: boolean;
  readonly cursor?: string;
}
```

---

## 6. 关键决策与证据链

### 6.1 决策：6 个 ContextLayerTag 而非 4 个 L0/L1/L2/L3

**Evidence**: `context-management-eval-by-Opus.md` v2 §5.3 hybrid model 表; charter §1.5; rejected Deepseek 4-layer KV.

**Decision**: 6 tags (system / memory / interaction / tool_result / summary / knowledge_chunk). 比 Deepseek 4 layer 更细 (拆开 interaction vs tool_result vs summary)，比 v1 single message[] 更结构化。

### 6.2 决策：summary / tool_result 用 size-aware promotion (来自 F08)

**Evidence**: F08 — DO storage value cap 1-10 MiB; default 1 MiB conservative.

**Decision**:
- `promotion.ts` 实现：`if (estimateBytes(value) > 1 MiB) → R2.put + return NacpRef → DO stores ref`
- Read path 自动 deref：`router.read()` 看到 ref payload 自动 R2.get
- 触发 promotion 时 emit `placement.promoted` evidence (consumed by inspector + eval-observability)

### 6.3 决策：knowledge_chunk 永远走 R2 ref (来自 F02 + 业务 reasoning)

**Evidence**: F02 cursor walking in R2; knowledge_chunk 是 RAG-fetched，size 不可预测、retrieval 后通常持久化为 file-like blob。

**Decision**: knowledge_chunk 默认 `R2Adapter` ref-only；DO 中只存 metadata (tag + ref + sizeBytes + retrievedAt)。

### 6.4 决策：system / memory 用 KvAdapter.putAsync (来自 unexpected-F02)

**Evidence**: KV write ~520 ms; system / memory write 频次远低于 read，但 read latency ~3 ms；hot path 调用方不能被 sync write 阻塞。

**Decision**:
- `router.write("system", ...)` 内部默认调 `KvAdapter.putAsync`
- 显式 sync 版本：`router.writeSync("system", ...)` 用于 commit-after-explicit-update 场景
- inspector 用 `router.read("system", ...)` 都走 KV.get (~3 ms)

### 6.5 决策：bulk artifact migration 用 R2Adapter.putParallel (来自 unexpected-F01)

**Evidence**: unexpected-F01 — R2 sequential put for 50 small keys took 13.67s (~273 ms / put); concurrent likely much faster.

**Decision**:
- `router.writeBulk(tag, items)` for r2-bound tags 调 `R2Adapter.putParallel(items, { concurrency: 10 })`
- 默认 concurrency 10 (P1 RFC 默认值)
- 用于：`WorkspaceSnapshotBuilder` 写多个 artifact、`PromotionPlan` 批量迁移、knowledge_chunk batch ingest

### 6.6 决策：MemoryBackend 配置对齐 (来自 F05 + F08)

**Evidence**: F05 — MemoryBackend basic K/V parity confirmed; F08 — DO 1 MiB cap; P1 design 已让 MemoryBackend 加 `maxValueBytes` config.

**Decision**:
- `memory-backend-align.ts` 提供 `createMemoryRouter()` helper
- 该 helper 创建 in-memory router with same tag→tier mapping，但 KV/DO/R2 都走 MemoryBackend (各自独立 namespace)
- MemoryBackend `maxValueBytes` 配置与 DOStorageAdapter (1 MiB) 对齐
- 让本地 unit test 与 production 行为一致 (per F05 + F08 共同要求)

### 6.7 决策：F02 cursor walking 在 router list 层封装

**Evidence**: F02 — R2 list strict cursor pagination; P1 RFC `R2Adapter.listAll(prefix)` 已 helper。

**Decision**:
- `router.list(tag, prefix)` for r2-bound tags 默认调 `R2Adapter.list(prefix, { limit, cursor })` (single page)
- 显式 `router.listAll(tag, prefix)` 调 `R2Adapter.listAll(prefix)` (auto cursor walk)
- Cursor walking 是 caller's responsibility 选择；router 不偷偷 walk all (避免高 latency)

### 6.8 决策：F03 KV freshness 文档化 + read path 容错

**Evidence**: F03 — same-colo strong; cross-colo TBD; B7 round 2 follow-up.

**Decision**:
- `router.read("system" | "memory", key)` 的 JSDoc 标注: "freshness depends on read locality; for guaranteed-fresh reads, use `router.readFresh()` which forces a roundtrip"
- 暂不实现 `readFresh()` 方法 (P1 KV adapter 没有强读 API)；标注 TBD pending B7
- 如果 B7 暴露 cross-colo stale，本 design 升级为 ship `readFresh` (用 DO storage as ground truth 旁路)

---

## 7. 与 charter / spike findings 对应关系

| Charter §6 Phase 3 in-scope item | 实现位置 | Evidence |
|---|---|---|
| `storage/` 子模块 in `packages/context-management/` | 本设计 §3 | charter §1.5 + §7.4 (修订后) |
| Hybrid storage 物理映射 (system/memory→KV, transcript→DO, large→R2) | §4 表 | charter §1.5 owner decision |
| Tagged conversation logical view | §6.1 6 tags | `context-management-eval-by-Opus.md` v2 §5.3 |
| Size-aware promotion (1 MiB threshold) | §6.2 | F08 |
| Bulk write 并发 | §6.5 | unexpected-F01 |
| Hot-path KV async write | §6.4 | unexpected-F02 |
| MemoryBackend 行为对齐 | §6.6 | F05 + F08 |
| 不通过 NACP 协议层 (storage internal) | §3 + §6.x 全部 internal API | charter §4.1 F + §6.6 |

---

## 8. 不在本 design 决策的事项

1. async compact lifecycle (state machine, fork, commit) → P3-async-compact
2. inspector facade endpoint design → P3-inspector
3. D1 business schema → 后续 phase
4. cross-region replication / cross-tier transactional → out-of-scope per charter §4.2
5. RAG retrieval logic for knowledge_chunk → orthogonal subject
6. Per-session tier override discovery (UI / config) → application 层

---

## 9. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3 文件结构 6 文件 + 责任划分清楚
2. ✅ §4 6 tag → 4 tier 默认 mapping 表完整 + per-session override interface
3. ✅ §5 `TierRouter` public API + 3 result types 定义
4. ✅ §6 8 个关键决策每个绑定 B1 finding
5. ⏳ B4 action plan 引用本 design 写出执行批次
6. ⏳ B7 round 2 spike 验证 router 在真实 4 tier 上的行为 + F03 cross-colo follow-up

---

## 10. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；6 tag → 4 tier mapping；8 个决策每个 cite B1 finding；MemoryBackend 对齐与 P1 协调 |
