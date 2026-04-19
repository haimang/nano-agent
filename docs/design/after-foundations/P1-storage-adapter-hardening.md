# Nano-Agent After-Foundations P1 — Storage Adapter Hardening

> 功能簇：`Storage Adapter Hardening (R2 / KV / D1 / DO storage)`
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/storage-findings.md` — V1 storage 6 findings rollup（writeback destination map）
> - `docs/spikes/spike-do-storage/01-r2-multipart-not-required-up-to-10mib.md` (F01)
> - `docs/spikes/spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md` (F02 — **breaking interface change driver**)
> - `docs/spikes/spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md` (F03)
> - `docs/spikes/spike-do-storage/04-do-transactional-three-scenarios-confirmed.md` (F04)
> - `docs/spikes/spike-do-storage/05-mem-vs-do-state-parity-confirmed.md` (F05)
> - `docs/spikes/spike-do-storage/06-d1-cross-query-transaction-explicitly-rejected.md` (F06 — **D1 contract change driver**)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (F08 — **size cap driver**)
> - `docs/spikes/unexpected/F01-r2-put-273ms-per-key-during-preseed.md` (unexpected-F01 — `putParallel` helper)
> - `docs/spikes/unexpected/F02-kv-write-latency-500ms.md` (unexpected-F02 — `putAsync` helper)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B2 (this design's input contract)
> - `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md` (open writeback issue)
> - `docs/rfc/scoped-storage-adapter-v2.md` (sibling RFC, shipped together)
>
> 上游 charter / 模板：
> - `docs/plan-after-foundations.md` §6 Phase 1 + §11.1 Exit Criteria 2
> - `docs/templates/design.md` (功能簇模板)
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

After-foundations Phase 1 的工作由 B1 spike round 1 的 7 条 storage / DO findings 直接驱动。本 design 把这些 spike 真相转成 `packages/storage-topology` 的具体 ship plan。

- **项目定位回顾**：nano-agent 的 storage 真相分布在 4 个 Cloudflare primitive 之上：R2（cold artifact）/ KV（warm config）/ D1（structured manifest，deferred query）/ DO storage（transactional session state）。`packages/storage-topology` 是把这 4 个 primitive 收敛成统一 typed seam 的层。
- **本次讨论的前置共识**：
  - 当前 `storage-topology` 0.1.0 唯一实现是 `NullStorageAdapter`（全抛 `not connected`）；**没有真实生产用户**——breaking interface change 代价为零
  - B1 spike round 1 已在真实 Cloudflare 验证 R2 / KV / D1 / DO 行为（详见 7 个 finding）
  - **6 hard contract requirements** 来自 B1（详见 `B1-final-closure.md` §6 hard contract requirements），其中 3 条直接落到本 P1：
    1. `r2List` 接口必须 v2（cursor / limit / truncated）— 来自 F02
    2. D1 cross-query 必须用 `db.batch()` 或 DO storage —— 来自 F06
    3. DO storage `put` 必须 size pre-check（1-10 MiB cap）—— 来自 F08
  - `storage-topology` major bump 0.1.0 → 2.0.0 是 anticipated by charter §11.2
- **显式排除的讨论范围**：
  - 不讨论 `workspace-context-artifacts` 的 backend 改造（仅在 `ReferenceBackend` 接通新 adapter 时 touch — 但接通本身不属于 P1）
  - 不讨论 cross-region / cross-colo 真相（属 B7 round 2）
  - 不讨论 D1 schema design（structured query 业务模型属于后续 phase）
  - 不讨论 placement / promotion plan 的策略层（B4 context-management 议题）

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Storage Adapter Hardening`
- **一句话定义**：把 `packages/storage-topology` 从仅含 typed seam + `NullStorageAdapter` 的状态升级为含 4 个真实 production-shaped adapter（D1 / R2 / KV / DO storage）的 v2.0.0 层；同时基于 B1 finding 修订 `ScopedStorageAdapter` 接口（cursor、size pre-check、async helpers）。
- **边界描述**：本功能簇**包含** `ScopedStorageAdapter` v2 接口、4 个 adapter 实现、breaking change 配套测试、`ReferenceBackend` 接通；**不包含** `WorkspaceNamespace` 层的策略改造、placement/promotion 业务策略、跨 region 行为。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|---|---|---|
| **Adapter** | 把单个 Cloudflare primitive (R2/KV/D1/DO) 包装成 `ScopedStorageAdapter` 子集的具体实现 | per-binding 隔离；per-adapter 独立测试 |
| **Cursor walking** | R2 list 的 multi-page 调用模式：`while (truncated) list({ cursor })` | F02 强制要求 |
| **Size pre-check** | `put(key, value)` 前由 adapter 检查 value bytes，超 cap 时 throw `ValueTooLargeError` | F08 强制要求 |
| **Async write helper** | `putAsync(key, value): void` 不等待写入完成的 fire-and-forget 模式 | unexpected-F02 KV 520ms 延迟 motivation |
| **Parallel put helper** | `putParallel(items): Promise<void>` 用 `Promise.all` 并发 N 个 put | unexpected-F01 R2 273ms/key motivation |

### 1.2 参考调查报告

- B1 spike findings：见上文 frontmatter
- Charter §6 Phase 1 / §11.1 / §11.2

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本功能簇在整体架构里的角色：**after-foundations 阶段第一个 ship-code phase**——把 spike 真相消化成 packages/ 真实可用的 adapter 层。
- 它服务于：worker matrix 阶段的 `filesystem.core` (主消费方)、`context.core` (hybrid storage tier)、`agent.core` (session state)。
- 它依赖：B1 spike findings + Cloudflare R2/KV/D1/DO bindings 的稳定行为。
- 它被谁依赖：`workspace-context-artifacts/src/backends/reference.ts` (B2 内接通)、Phase 3 (`packages/context-management/storage/`)、Phase 6 round 2 spike (重测验证已 ship)。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `packages/storage-topology` (本身) | (modify + add) | 强 | 4 个新 adapter 文件 + `scoped-io.ts` 接口 v2 修订 |
| `packages/workspace-context-artifacts/src/backends/reference.ts` | (modify) | 强 | `ReferenceBackend` 从 `not connected` 接通到 4 adapter |
| `packages/workspace-context-artifacts/src/backends/memory.ts` | (modify) | 中 | 添加 `maxValueBytes` config 与 DO size cap 对齐 (F08) |
| `packages/workspace-context-artifacts/src/promotion.ts` | (review) | 弱-中 | promotion path 必须 size-aware (>1MiB → R2) (F08) |
| `packages/workspace-context-artifacts/src/refs.ts` | (review) | 弱 | refs 中 D1 manifest 假设要符合 batch-only (F06) |
| `packages/context-management/storage/` (B4) | (downstream) | 强 | hybrid tier router 消费本 adapter |
| `docs/rfc/scoped-storage-adapter-v2.md` | (sibling) | 强 | RFC 与本 design 同期 ship；正式记录 breaking change |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`Storage Adapter Hardening` 是 **Cloudflare-native storage substrate 层**，负责把 B1 spike 验证过的真实 platform 行为（R2 multipart/cursor、KV 异步性、D1 batch-only、DO size cap）转成 typed adapter；对上游消化 spike findings，对下游为 `filesystem.core` 与 `context.core` worker 提供 production-shaped storage primitive。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 | 砍的理由 | 未来是否可能回补 |
|---|---|---|---|
| Cross-region replication API | Cloudflare R2 multi-region | B1 round 1 仅同 colo；cross-region 是 B7 议题 | B7 后视情决定 |
| D1 schema migration helper | typeorm / drizzle 类工具 | B2 不做业务表设计；schema 由后续 phase 决定 | yes（in 后续 phase） |
| KV cache TTL knobs | KV `cacheTtl` 选项 | B2 默认行为已足够；F03 显示同 colo 无 stale | yes（如 F03 在 Round 2 暴露 cross-colo stale） |
| R2 multipart 显式 API | R2 `createMultipartUpload` | F01 显示 ≤ 10 MiB single-part 即可；> 10 MiB 是 follow-up | yes（如 follow-up probe 暴露上限） |

### 3.2 `ScopedStorageAdapter` v2 接口设计

详细 interface diff 见 sibling RFC `docs/rfc/scoped-storage-adapter-v2.md`。本 design 列出关键变更：

```ts
// scoped-io.ts:127 — modify (BREAKING)
async r2List(
  prefix: string,
  opts?: { limit?: number; cursor?: string },
): Promise<{
  objects: Array<R2Object>;
  truncated: boolean;
  cursor?: string;
}>;

// scoped-io.ts (NEW method per F08 contract)
// Per-adapter size guard before put — adapters expose maxValueBytes config
async doPut(key: string, value: ArrayBuffer | string): Promise<void>;
//   ^ MUST throw `ValueTooLargeError` when value bytes > adapter.maxValueBytes

// scoped-io.ts JSDoc additions (F03, unexpected-F02)
// kvGet/Put: "freshness depends on read locality"
// kvPut: "expect ~500ms latency; use putAsync helper for hot path"
```

### 3.3 解耦：4 个 adapter per-file 隔离

```
packages/storage-topology/src/adapters/
├── scoped-io.ts                    (modify v2 interface; keep NullStorageAdapter)
├── d1-adapter.ts                   (NEW — F06: batch-only API; no BEGIN)
├── r2-adapter.ts                   (NEW — F01/F02/unexpected-F01)
├── kv-adapter.ts                   (NEW — F03/unexpected-F02; putAsync helper)
└── do-storage-adapter.ts           (NEW — F04/F05/F08; size pre-check)
```

每个 adapter 文件**独立**：
- 自己 import 自己 binding type
- 自己 throw 适配过的 error class
- 自己单元测试在 `packages/storage-topology/test/adapters/{name}.test.ts`

这样一个 adapter 升级（如 R2 multipart 接通）不影响其他 adapter。

### 3.4 聚合：错误类型与 `ValueTooLargeError`

新增 typed error hierarchy（per F08）：

```ts
// packages/storage-topology/src/errors.ts (NEW)
export class StorageError extends Error { /* base */ }
export class ValueTooLargeError extends StorageError { /* size cap */ }
export class StorageNotConnectedError extends StorageError { /* legacy not-connected */ }
export class CursorRequiredError extends StorageError { /* attempted full enumerate without cursor */ }
```

`DOStorageAdapter.doPut()` size 超 cap 时 throw `ValueTooLargeError`；`MemoryBackend` 也 mirror 同款 error shape (F05 + F08 共同要求)。

---

## 4. 关键决策与证据链

每个设计决策都有具体的 B1 finding 作为依据（backward traceability）。

### 4.1 决策：`r2Put` 接口不需要 multipart 字段（来自 F01）

**Evidence**: F01 实测 1 KiB / 100 KiB / 1 MiB / 5 MiB / 10 MiB 全部 single-call put 成功，latency 396-782 ms。Cloudflare R2 binding 在 wrangler 4.83.0 runtime 下自动管理 body chunking。

**Decision**: `R2Adapter.put(key, body)` 直接 wrap `binding.put`；接口不暴露 multipart field。

**Trade-off**: 50/100 MiB+ 仍需 follow-up probe 验证。如 follow-up 暴露 explicit multipart 需求，仍可在 v2.x 添加 helper API（non-breaking）。

### 4.2 决策：`r2List` 接口加 cursor / limit / truncated（来自 F02 — **breaking**）

**Evidence**: F02 实测 50 keys + limit=20 强制 3 pages with cursor walking。`scoped-io.ts:127` 当前接口仅 prefix。

**Decision**: 接口签名修订（详见 §3.2 + RFC）。`storage-topology` major bump 到 2.0.0。

**Trade-off**: Breaking change，但当前唯一 implementer 是 `NullStorageAdapter`，无生产用户。

### 4.3 决策：D1Adapter 仅暴露 `batch()`，**不**暴露 `beginTransaction()`（来自 F06）

**Evidence**: F06 实测 D1 SQL `BEGIN` 被显式拒绝，错误消息 redirect 到 `state.storage.transaction()`。Batch 内 atomic 已 confirmed (failing batch survivingRows=[])。

**Decision**: `D1Adapter` API 表面：
- ✅ `query(sql, ...params)` — single statement
- ✅ `batch(statements)` — atomic group
- ❌ `beginTransaction()` / `commit()` — NOT exposed

**Trade-off**: 任何"先 read 再 conditional write"模式必须用 batch 把所有 statement 打包，或者推到 DO storage transaction。这一限制必须在 RFC 显式记录，并由 Phase 3 (B4) async-compact `committer.ts` 设计严格遵守。

### 4.4 决策：DO storage `put` 必须 size pre-check（来自 F08）

**Evidence**: F08 实测 10 MiB put → `SQLITE_TOOBIG`；1 MiB 成功（45 ms）。

**Decision**:
- `DOStorageAdapter` 暴露 `maxValueBytes: number` 字段（默认 **1 MiB** — 与实测安全 margin 一致）
- `put(key, value)` 内部 size check；超 cap throw `ValueTooLargeError`
- `MemoryBackend` 添加 `maxValueBytes` config，默认与 DO 同款 1 MiB（F05 parity 要求 + F08 防止 local pass / production fail 漂移）
- `WorkspaceNamespace.promotion.ts` review path：> 1 MiB blob 强制 R2 promotion

**Trade-off**: 默认 1 MiB 偏保守。如 follow-up binary-search probe 显示真实 cap 是 4 MiB，可在 patch 版本调整 default。**业主可 config override per workspace**.

### 4.5 决策：KV freshness 仅 JSDoc 标注（来自 F03，**Round 2 待复现**）

**Evidence**: F03 同 colo 40/40 fresh 不能直接证明 cross-region 也 fresh；公开文档说 60s eventual consistency。

**Decision**: 不修接口；仅 `kvGet/Put` JSDoc 加注 "freshness depends on read locality; same-colo confirmed strong (spike-do-storage-F03); cross-colo NOT yet validated; expect possible stale window"。

**Trade-off**: 如 B7 round 2 cross-colo probe 暴露 stale，**升级本 finding 为 breaking**（接口加 `freshness` enum 字段，类似 R2 `httpEtag`）。本设计预留 hook（在 v2.x minor add field）。

### 4.6 决策：KV `putAsync(key, value): void` helper（来自 unexpected-F02）

**Evidence**: KV write 平均 ~520 ms（vs read ~3 ms，170× 倍差距）。

**Decision**: `KvAdapter` 新增 `putAsync(key, value): void` —— fire-and-forget，内部 retry。Hot-path 调用方（如 session metadata update）不阻塞。

**Trade-off**: Async 写入意味着调用方无法立即知道写入结果。文档明确："use sync `put()` if you need write confirmation; use `putAsync()` only when fire-and-forget is acceptable"。

### 4.7 决策：R2 `putParallel(items): Promise<void>` helper（来自 unexpected-F01）

**Evidence**: R2 sequential put for 50 small keys took 13.67s (~273 ms / put)，per-call overhead dominates。

**Decision**: `R2Adapter` 新增 `putParallel(items: Array<{key, body}>, opts?: { concurrency?: number })` —— 用 `Promise.all` (with default concurrency=10) 并发。

**Trade-off**: 高并发可能触发 R2 rate-limit（具体阈值是 B7 round 2 议题）。Default concurrency 10 是保守值。

### 4.8 决策：`ReferenceBackend` 接通 + `MemoryBackend` align cap（来自 F05）

**Evidence**: F05 same-state hash + same-reads confirms basic K/V parity；F08 暴露 size 是 first real diff。

**Decision**:
- `ReferenceBackend` 5 个 not-connected 方法各自路由到对应 adapter (KvAdapter / R2Adapter / DOStorageAdapter)
- `MemoryBackend` 加 `maxValueBytes` config（默认 1 MiB），超过 throw 同款 `ValueTooLargeError` —— 让本地测试触发与 production DO 同样的 error
- F05 confirms basic K/V parity，所以本地用 `MemoryBackend` 跑业务测试**仍然可信**

---

## 5. 与 charter / spike findings 对应关系

| Charter §6 Phase 1 in-scope | 实现位置 | Source finding |
|---|---|---|
| 修订 `ScopedStorageAdapter` 接口（cursor / multipart / stale-read 显式化）| `scoped-io.ts` v2 | F02 / F03 / F08 |
| ship `D1Adapter / R2Adapter / KvAdapter / DOStorageAdapter` | `adapters/{d1,r2,kv,do-storage}-adapter.ts` (NEW) | F01-F08 |
| `ReferenceBackend` 接通 R2 / KV / DO 路径 | `workspace-context-artifacts/src/backends/reference.ts` (modify) | F05 + 4 adapter |
| version bump 到 2.0.0（major，因为接口 breaking） | `storage-topology/package.json` + CHANGELOG | F02（breaking driver） |

---

## 6. 不在本 design 决策的事项

以下事项**不**在 P1 design 决策，留给后续 design / phase：

1. KV cross-region stale window 接口字段 → 如 B7 round 2 暴露 stale 才决定（charter 已 anticipate）
2. R2 explicit multipart API → 仅在 follow-up probe 暴露 > 10 MiB 上限时再加
3. D1 schema-first ORM → 业务 phase 议题
4. `placement.ts` / `promotion-plan.ts` 的 routing rules → B4 context-management hybrid storage 议题
5. KV / R2 quota / cost monitoring → 后续 production observability phase
6. Cross-adapter cross-namespace transactional reference → 显式 out-of-scope per charter §4.2 第 9 项

---

## 7. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3.2 v2 接口签名已与 sibling RFC `scoped-storage-adapter-v2.md` align
2. ✅ §4 7 个决策每个都有对应 B1 finding evidence
3. ✅ §6 显式列出 out-of-scope，无遗留歧义
4. ⏳ B2 action plan 引用本 design 写出执行批次（B2 起草时验证）
5. ⏳ B7 round 2 spike 重测 V1-storage-* 全套，对比 ship 后 packages/ 行为

---

## 8. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；7 个决策每个绑定 B1 finding ID；配套 RFC sibling spec |
