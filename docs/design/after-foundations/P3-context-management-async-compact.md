# Nano-Agent After-Foundations P3 — Context-Management `async-compact/` 子模块

> 功能簇：`packages/context-management/async-compact/` (核心子模块)
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/spike-do-storage/04-do-transactional-three-scenarios-confirmed.md` (**F04 — committer.ts atomic swap viable**)
> - `docs/spikes/spike-do-storage/06-d1-cross-query-transaction-explicitly-rejected.md` (**F06 — committer MUST use DO tx, NOT D1**)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (**F08 — summary blob size aware**)
> - `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md` (binding-F01 — cross-worker compact dispatch p50=5ms 可行)
> - `docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md` (binding-F03 — Compact lifecycle hooks 跨 worker dispatch viable)
> - `docs/spikes/unexpected/F02-kv-write-latency-500ms.md` (unexpected-F02 — `compact-state` KV write 必须 putAsync)
> - `docs/spikes/storage-findings.md` + `docs/spikes/binding-findings.md` (rollups)
> - `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` §B4 (this design's input contract)
>
> 上游 charter / spec / 模板：
> - `docs/plan-after-foundations.md` §1.3 + §5.4 + §7.4 + §11.1
> - **`docs/design/after-foundations/PX-async-compact-lifecycle-spec.md`** (canonical lifecycle — this design conforms to it)
> - `docs/design/after-foundations/P1-storage-adapter-hardening.md` (consumes DOStorageAdapter + KvAdapter)
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §4-5 (motivation)
>
> 兄弟 design (P3 family):
> - `docs/design/after-foundations/P3-context-management-hybrid-storage.md`
> - `docs/design/after-foundations/P3-context-management-inspector.md`
>
> 文档状态：`draft`

---

## 0. 背景与前置约束

`async-compact/` 子模块是 `packages/context-management/` 包的核心——业主 `plan-after-foundations.md` §1.3 明确："**异步全量上下文压缩是 nano-agent 的基石，不是可选项**"。本 design 把 PX spec 的 canonical lifecycle 转成具体子模块拆分 + 文件清单 + 接口签名 + B1 finding evidence 绑定。

- **项目定位回顾**：`async-compact/` 实现 PX-spec 的 `armed → prepare → commit → post` 4 阶段 + hard sync fallback。它是 `packages/context-management/` 3 个核心子模块之一（另两个：`hybrid-storage/` 与 `inspector-facade/`）。
- **本次讨论的前置共识**：
  - PX-async-compact-lifecycle-spec 是行为 canonical；本 design 是该 spec 的 **packaging shape**
  - 必须严守 **F04 (DO tx) + F06 (D1 reject)** evidence：committer 必须用 `DOStorageAdapter.transaction()`，绝不用 D1 cross-statement transaction
  - 必须严守 **F08 (DO size cap)** evidence：summary > 1 MiB 必须走 R2 promotion (P3 hybrid-storage 议题)
  - 必须严守 **unexpected-F02 (KV write 520ms)** evidence：compact state KV write 用 `KvAdapter.putAsync`
  - **binding-F01/F03** evidence 表明跨 worker compact dispatch 在 fetch-based seam 上 p50 < 10ms 可行——B4 ship 时可以决定 context-management 是否最终拆为独立 worker (worker matrix 议题)
  - 业主 §1.4: context.core 升格为 worker matrix first-wave worker (但 B4 ship 时仍是 in-package 子模块)
- **显式排除的讨论范围**：
  - 不讨论 hybrid-storage tier routing 细节（→ P3-hybrid-storage）
  - 不讨论 inspector facade（→ P3-inspector）
  - 不讨论 hook catalog 扩展具体 events（→ P4）
  - 不讨论 NACP 1.2.0 message family（→ P5）
  - 不讨论 worker matrix 阶段 context.core worker shell（→ Phase 8）
  - 不讨论 LLM prompt design for summarization（→ implementation 阶段）
  - 不讨论 cross-session `memory` layer source（→ orthogonal lifecycle subject）

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`packages/context-management/async-compact/`
- **一句话定义**：实现 PX spec canonical lifecycle 的子模块——含 scheduler / planner / prepare-job / committer / version-history / fallback 6 个相互协作的 unit。
- **边界描述**：本子模块**包含**lifecycle state machine、CoW fork、background LLM call orchestration、atomic swap、versioned snapshot、graceful degradation；**不包含**tier routing、inspector endpoint、NACP message handling、跨 worker transport choice。
- **关键术语对齐**（继承自 PX spec）：

| 术语 | 定义 |
|---|---|
| `CompactionScheduler` | 监听 token usage threshold + DO alarm；触发 ARMED 与 PREPARE transition |
| `CompactionPlanner` | 执行 CoW fork；产出 `ContextCandidate` |
| `PrepareJob` | Background LLM summarization runner；管理 timeout 与 cancellation |
| `CompactionCommitter` | 执行 atomic swap (DO transaction)；写 versioned snapshot |
| `VersionHistory` | 管理已提交 context 的 versioned snapshots（user rollback support） |
| `FallbackController` | HARD_THRESHOLD 触发时的同步 compact 路径 |

### 1.2 参考调查报告

详见 frontmatter B1 findings list + PX spec §1.

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 本子模块在整体架构里的角色：**nano-agent 区别于本地 CLI agent 的核心架构特征**（per `context-management-eval-by-Opus.md` v2 §0）
- 服务于：所有 LLM agent turn —— 当 token budget 接近上限时，async-compact 在后台准备 summary，让 current turn 不被阻塞
- 依赖：P1 ship 的 `DOStorageAdapter` (atomic swap) + `KvAdapter.putAsync` (compact state) + `R2Adapter` (large summary promotion via P3-hybrid-storage)；llm-wrapper (background LLM provider)；hooks dispatcher (lifecycle events)
- 被谁依赖：`agent-runtime-kernel` 的 turn loop（询问 "should I compact before next turn?"）；P3-inspector-facade（暴露 compact lifecycle 给外部 inspector）

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| `PX-async-compact-lifecycle-spec` | conforms to | 强 | 本 design 不重新定义行为；只 ship packaging |
| `P3-context-management-hybrid-storage` (sibling) | depends on | 强 | summary > 1 MiB 走 R2 promotion；compact-state 在 KV |
| `P3-context-management-inspector-facade` (sibling) | emits to | 中 | 5 lifecycle events + version-history 暴露给 inspector |
| `P1-storage-adapter-hardening` | depends on | 强 | DOStorageAdapter (atomic) + KvAdapter (putAsync) + R2Adapter (size promotion) |
| `P4-hooks-catalog-expansion` | downstream | 中 | 5 lifecycle events 必须被 P4 catalog 注册 |
| `P5-nacp-1-2-0-upgrade` | downstream | 弱-中 | 部分 lifecycle 跨 worker 时需 NACP message; 大部分 intra-worker hook 即可 |
| `agent-runtime-kernel` (existing) | consumes | 强 | turn loop 调用 `scheduler.shouldArm(usage)` 等接口 |
| `llm-wrapper` (existing) | depends on | 强 | background LLM provider 调用 |
| `workspace-context-artifacts` (existing) | reuses | 强 | `ContextLayers` / `WorkspaceSnapshotBuilder` / `CompactBoundaryManager` 是基础 primitive |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`async-compact/` 是 **PX spec lifecycle 的具体 packaging**——把 4 阶段 state machine + CoW fork + atomic swap + graceful sync fallback 拆成 6 个相互协作的可独立测试的 unit，对上游 conforming PX canonical 行为，对下游为 `agent-runtime-kernel` turn loop 提供 compact decision API + 为 inspector facade 提供 lifecycle event stream。

---

## 3. 子模块文件结构

```
packages/context-management/src/async-compact/
├── index.ts                          (re-exports + AsyncCompactOrchestrator entry)
├── types.ts                          (state machine types: CompactState, ContextCandidate, PreparedSummary)
├── threshold.ts                      (SOFT/HARD threshold check; reads SessionRuntimeConfig.compactPolicy)
├── scheduler.ts                      (CompactionScheduler — DO alarm + idle window detect)
├── planner.ts                        (CompactionPlanner — CoW fork)
├── prepare-job.ts                    (PrepareJob — background LLM call wrapper with timeout/cancel)
├── committer.ts                      (CompactionCommitter — atomic swap via DOStorageAdapter.transaction)
├── version-history.ts                (VersionHistory — pre-swap snapshot persistence + rollback API)
├── fallback.ts                       (FallbackController — sync compact path for HARD_THRESHOLD)
└── events.ts                         (lifecycle event emitter wiring; consumes hooks dispatcher)
```

### 3.1 Why this split

- **`scheduler.ts` independent of `planner.ts`**: scheduler decides *when*; planner decides *what* to fork. Independent unit tests.
- **`prepare-job.ts` independent of `committer.ts`**: prepare can run in parallel with continuing turns; commit is atomic single-call. Different latency / failure semantics.
- **`version-history.ts` separate from `committer.ts`**: versioned snapshot is a separable concern; user rollback API may be exercised long after commit.
- **`fallback.ts` explicitly named**: emphasizes that hard sync fallback is **graceful degradation**, not the primary path. Per PX spec §6.

---

## 4. Public API surface

### 4.1 `AsyncCompactOrchestrator` (entry point)

```ts
// async-compact/index.ts
export interface AsyncCompactOrchestratorConfig {
  readonly sessionUuid: string;
  readonly storage: DOStorageAdapter;       // P1 dependency
  readonly kv: KvAdapter;                   // P1 dependency (compact-state via putAsync)
  readonly llmProvider: LlmProvider;        // for background summarization
  readonly hooks: HookDispatcher;            // for lifecycle event emit
  readonly compactPolicy?: CompactPolicy;   // optional per-session override
  readonly tierRouter: TierRouter;          // P3-hybrid-storage dependency
}

export class AsyncCompactOrchestrator {
  /** Called by agent-runtime-kernel before each new turn. */
  async shouldArm(usage: TokenUsage): Promise<boolean>;

  /** Idempotent: ARMED → PREPARE if conditions met; otherwise no-op. */
  async tryArm(): Promise<void>;

  /** Called at turn boundary — checks if a prepared summary is ready to commit. */
  async tryCommit(): Promise<CommitOutcome>;

  /** Called when usage hits HARD_THRESHOLD — sync compact fallback. */
  async forceSyncCompact(reason: string): Promise<CommitOutcome>;

  /** User-facing rollback (typed capability surface — exposed via inspector). */
  async restoreVersion(snapshotId: string): Promise<void>;

  /** Inspector / debug query of current compact state. */
  getCurrentState(): Readonly<CompactState>;
}

export type CommitOutcome =
  | { kind: "committed"; oldVersion: number; newVersion: number; summaryRef: NacpRef }
  | { kind: "no-compact-pending" }
  | { kind: "fallback-sync"; reason: string }
  | { kind: "failed"; error: string };
```

### 4.2 Internal API (not exported)

`scheduler.ts`, `planner.ts`, `prepare-job.ts`, `committer.ts`, `version-history.ts`, `fallback.ts` 内部 class 都是 `AsyncCompactOrchestrator` 的私有 collaborator. 单测可单独 instantiate。

---

## 5. 关键决策与证据链

### 5.1 决策：committer 必须用 DOStorageAdapter.transaction（来自 F04 + F06）

**Evidence**:
- F04 confirms `state.storage.transaction()` 三 scenarios (commit / rollback on throw / kv-outside-tx) 全 hold
- F06 explicitly rejects D1 BEGIN/COMMIT；error message redirects to `state.storage.transaction()`

**Decision**: `CompactionCommitter.commit()` 全程包裹在 `doStorage.transaction()` 中（per PX spec §5.1 code sketch）。**禁止**任何 D1 BEGIN/COMMIT or 多步骤 D1 statement-by-statement 模拟事务。

### 5.2 决策：summary blob > 1 MiB 必须走 R2 promotion（来自 F08）

**Evidence**: F08 — DO storage value cap 1-10 MiB；P1 design 默认 `DOStorageAdapter.maxValueBytes = 1 MiB`.

**Decision**:
- `CompactionPlanner.fork()` returns `ContextCandidate` with size estimate
- `PrepareJob` 完成后产出 `PreparedSummary { text: string, sizeBytes: number }`
- `CompactionCommitter.commit()` 在写入前调用 `tierRouter.routeSummary(prepared)`：
  - if `sizeBytes ≤ 1 MiB`: inline as `summary` layer in DO storage
  - if `sizeBytes > 1 MiB`: `R2Adapter.put` → return `NacpRef`; layer becomes `{ tag: "summary", ref }`
- 如果 R2 put fail → fallback to truncated summary (≤ 1 MiB inline)

### 5.3 决策：compact state 用 `KvAdapter.putAsync`（来自 unexpected-F02）

**Evidence**: KV sync write ~520 ms (170× slower than read). compact-state transitions 在 hot path（每 turn 都可能 check）。

**Decision**:
- `compact-state:{sessionUuid}` 在 KV，**用 `KvAdapter.putAsync`**（fire-and-forget）
- 但 `armed`/`preparing` 持久化用 **DO storage transaction**（不是 KV）—— 因为 crash recovery 必须可靠
- KV 仅作为 **fast-path read cache** for cross-DO instance read（如 inspector worker 想读 compact state without touching DO）

> Trade-off: KV-cached state may be slightly stale; inspector facade must tolerate this OR query DO directly for ground truth.

### 5.4 决策：cross-worker compact dispatch 是 viable，但 B4 ship 时仍 in-package（来自 binding-F01 + F03）

**Evidence**:
- binding-F01: service binding p50 = 5 ms
- binding-F03: cross-worker hook callback p50 = 4 ms

**Decision**:
- B4 ship 时 `async-compact/` 是 `packages/context-management/` 的 in-process 子模块（不是独立 worker）
- 但其 API（`AsyncCompactOrchestrator`）必须是 **service-binding-friendly shape**：所有 method 接受/返回 JSON-serializable types，无 closure capture
- 这样 worker matrix 阶段（Phase 8）如果决定把 context-management 拆为独立 `context.core` worker，**只需要在 worker shell 里 wrap 一层 fetch-handler 而无需改 orchestrator 本身**
- 跨 worker latency 已 binding-F01 confirmed sub-10ms，性能不是问题

### 5.5 决策：hard sync fallback 显式作为 `fallback.ts` 而非 inline 路径（来自 PX spec §6）

**Evidence**: PX spec §6 + claude-code's `compact.ts` (sync compact 是其主路径) + GPT review §4.5 prepare/commit pattern 推荐显式 graceful degradation.

**Decision**:
- `fallback.ts` 是独立文件 + 独立 class；不与 prepare/commit 主路径共享代码
- `AsyncCompactOrchestrator.forceSyncCompact(reason)` API explicit；by-design 不是 internal-only —— 让 agent-runtime-kernel 在 hard threshold detection 时显式 invoke
- PostCompact event payload 含 `compactReason: "hard-fallback-no-prepared-summary" | "user-explicit-trigger" | "background-llm-timeout"` 等

### 5.6 决策：5 个新 lifecycle hook events（per PX spec §7）

**Evidence**: PX spec §7 表格.

**Decision**: B4 ship 时 `events.ts` 通过 `hooks dispatcher` emit 5 events. **B4 不直接修改 hooks catalog**——catalog expansion 是 P4 / B5 议题. B4 只**期望** P4 catalog 已注册这 5 events. ship 顺序：
- B4 ship 先：`events.ts` emit string-named events
- B5 ship 后：`hooks/src/catalog.ts` 注册 5 events with metadata
- 短窗口内 events 是 best-effort emission；catalog 还没注册时 dispatcher 容错（已是当前 dispatcher 行为）

### 5.7 决策：Singleton invariant 通过 KV-backed lock 实现（per PX spec §2.1）

**Evidence**: PX spec §2.1 — 单 session 同一时刻只能 1 个 active compact.

**Decision**:
- ARMED transition 前先 `kv.get(compact-state:{uuid})`；若已 active 则 no-op
- 由于 KV stale-read 可能（F03 同 colo confirmed strong; cross-colo TBD），最终 commit 时仍走 `state.storage.transaction()` ground truth；KV 仅作 fast-path filter
- 如果 cross-colo stale 暴露 false-negative (rare double compact)，fallback to DO storage 检查 — 多花一次 transaction 不影响正确性

### 5.8 决策：CoW fork 是 structural sharing 而非 deep copy（per PX spec §4.1）

**Evidence**: PX spec §4.2 — fork 必须 ~O(1) memory overhead.

**Decision**:
- `CompactionPlanner.fork(currentContext)` returns new `ContextCandidate` 对象 with shared references to immutable layers (system/memory)
- Mutable layers (interaction/tool_result) 用新 array wrapper, elements 仍共享
- 任何 candidate-side modification 必须 explicit clone (write-time copy)
- `ContextLayers` 类型在 `workspace-context-artifacts` 中定义；本 design 不修改类型，只添加 fork helper

---

## 6. 与 charter / spec / spike findings 对应关系

| Charter §6 Phase 3 in-scope item | 实现位置 | Evidence |
|---|---|---|
| 新建 `packages/context-management/async-compact/` 子模块 | 本设计 §3 文件结构 | charter §1.3 owner decision |
| **`async-compact/` 是核心** (armed → prepare → commit + CoW + atomic swap) | §3.1 + §4.1 + §5 决策链 | PX spec §1-§6 |
| Hard-threshold sync fallback | `fallback.ts` (独立文件) | PX spec §6 + GPT §4.5 |
| 与 P3-hybrid-storage 协作 (summary tier routing) | §5.2 | F08 |
| 与 P3-inspector 协作 (lifecycle event emission) | §3 events.ts + §4.1 API | PX spec §7 |
| 与 P4 hook catalog (5 new events) | §5.6 | PX spec §7 |
| 与 P5 NACP (cross-worker dispatch optional) | §5.4 | PX spec §8 + binding-F01/F03 |

---

## 7. 不在本 design 决策的事项

1. Tier routing rules (which tag → which adapter) → P3-hybrid-storage
2. Inspector facade endpoint design → P3-inspector
3. P4 catalog event metadata (allowedOutcomes / blocking 等) → P4 design
4. P5 NACP message kind names → P5 design (reverse-derive)
5. LLM prompt for summarization → implementation 阶段; out of design scope
6. Cross-session `memory` layer source → orthogonal subject
7. Worker matrix `context.core` worker shell → Phase 8

---

## 8. 收口标准（Exit Criteria）

本 design 的成立标准：

1. ✅ §3 文件结构 6 unit 拆分 + 责任划分清楚
2. ✅ §4 `AsyncCompactOrchestrator` public API surface 定义
3. ✅ §5 8 个关键决策每个绑定 B1 finding 或 PX spec 章节
4. ✅ 严格 conform to `PX-async-compact-lifecycle-spec.md` (无矛盾)
5. ⏳ B4 action plan 引用本 design 写出执行批次
6. ⏳ B7 round 2 spike 跑过完整 lifecycle (charter §11.1 第 4 项)

---

## 9. 修订历史

| 日期 | 作者 | 变更 |
|---|---|---|
| 2026-04-19 | Opus 4.7 | 初版；6 unit 子模块拆分；8 个决策每个 cite B1 finding 或 PX spec 章节 |
