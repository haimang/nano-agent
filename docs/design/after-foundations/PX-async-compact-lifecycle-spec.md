# Nano-Agent After-Foundations PX — Async Compact Lifecycle Spec (canonical)

> 文档对象：`Async Compact Lifecycle — canonical spec`
> 类型：`spec` (cross-design canonical contract，被 P3 + P4 + P5 共同 reference)
> 讨论日期：`2026-04-19`
> 讨论者：`Opus 4.7 (1M context)`
>
> 关联调查报告（B1 finding traceability — backward）：
> - `docs/spikes/spike-do-storage/04-do-transactional-three-scenarios-confirmed.md` (**F04 — DO tx → atomic swap viable**)
> - `docs/spikes/spike-do-storage/06-d1-cross-query-transaction-explicitly-rejected.md` (**F06 — committer MUST use DO tx, NOT D1**)
> - `docs/spikes/spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md` (**F08 — summary blob size aware**)
> - `docs/spikes/unexpected/F02-kv-write-latency-500ms.md` (**unexpected-F02 — async write helper required**)
> - `docs/spikes/spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md` (binding-F01 — cross-worker compact dispatch latency baseline)
> - `docs/spikes/spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md` (binding-F03 — Compact* lifecycle hooks dispatch viable)
>
> 上游 charter / eval / 模板：
> - `docs/plan-after-foundations.md` §1.3 + §5.4 + §7.4 (canonical lifecycle from owner decision §1.3)
> - `docs/eval/after-foundations/context-management-eval-by-Opus.md` v2 §4.4 (lifecycle prose source)
> - `docs/eval/after-foundations/context-management-eval-by-GPT.md` §4.5 (prepare/commit pattern source)
> - `docs/eval/after-foundations/context-management-discussion-with-deepseek.md` §三 (异步压缩用户 motivation)
>
> 下游 designs that consume this spec:
> - `docs/design/after-foundations/P3-context-management-async-compact.md`
> - `docs/design/after-foundations/P3-context-management-inspector.md`
> - `docs/design/after-foundations/P4-hooks-catalog-expansion.md`
> - `docs/design/after-foundations/P5-nacp-1-2-0-upgrade.md`
>
> 文档状态：`draft` (becomes `frozen` when first downstream design freezes)

---

## 0. 用途说明

本 spec 是 nano-agent 异步上下文压缩 (async context compaction) 的**唯一 canonical 行为定义**。任何下游 design / RFC / action plan 涉及 async compact 行为时，**必须 reference 本 spec 而非自行重新定义**。修改本 spec 必须通过 sibling design 的协同变更。

---

## 1. Lifecycle Overview

异步压缩共 **4 个阶段** + **1 个降级路径**。所有阶段 transitions 通过 hook event emission（详见 P4 catalog expansion）+ NACP message（详见 P5 1.2.0 upgrade）双轨可观测。

```
                                            ┌────────────────────┐
   token usage hits SOFT_THRESHOLD (~70-80%) ─→ │  ARMED              │
                                            └─────────┬──────────┘
                                                      │ next idle window
                                                      ▼
                                            ┌────────────────────┐
                                            │  PREPARE            │
                                            │  - CoW context fork │
                                            │  - background LLM   │
                                            │  - current turn 不影响 │
                                            └─────────┬──────────┘
                                                      │ summary ready
                                                      ▼
   ┌──── usage hits HARD_THRESHOLD (~95%) ────┐
   │                                          │
   ▼                                          │
 [HARD FALLBACK]                              │
 sync compact (claude-code style)             │
 同步阻塞 current turn                         │
                                              │
   ┌──── turn boundary OR session idle ──────┘
   ▼
┌────────────────────┐
│  COMMIT             │
│  - atomic swap      │
│  - DO storage tx    │  ← F04/F06 evidence
│  - versioned snapshot│  ← user rollback support
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│  POST               │
│  - clean stale candidates
│  - update inspector metrics
│  - PostCompact hook
└────────────────────┘
```

---

## 2. State Machine

### 2.1 States

| State | Name | Persistent? | Per-session-singleton? |
|---|---|---|---|
| `idle` | 默认状态；无 active compact | (state itself not persisted; just absence of armed/preparing) | yes |
| `armed` | SOFT_THRESHOLD 已触发，等 idle window | persisted in DO storage | yes |
| `preparing` | Background LLM 调用 in-flight | persisted with `prepareJobId` | yes |
| `committing` | Atomic swap in progress | brief; persisted as transaction state | yes |
| `committed` | 成功 swap，等 PostCompact | brief; transitioning to idle | yes |
| `failed` | Background LLM error / cancellation | persisted with error context | yes |

> **Singleton invariant**: 任何 session 在同一时刻只能有 1 个 active compact (state ≠ idle)。第二次 SOFT_THRESHOLD 触发时若 state ≠ idle，**忽略**（不堆队列）。

### 2.2 Transitions

```
idle      ──→ armed       (token usage > SOFT_THRESHOLD)
armed     ──→ preparing   (next idle window, scheduler 触发)
armed     ──→ committing  (HARD_THRESHOLD 命中且未到 prepare —— rare)
preparing ──→ committing  (summary ready + turn boundary)
preparing ──→ committing  (HARD_THRESHOLD hit during prepare —— uses partial/best-effort summary)
preparing ──→ failed      (LLM error)
committing ──→ committed  (atomic swap success)
committing ──→ failed     (DO transaction throw)
committed ──→ idle        (PostCompact hook returned)
failed    ──→ idle        (after 1 retry exhausted; emit ContextCompactFailed; current context unchanged)
```

### 2.3 Persistence

- `armed` / `preparing` / `failed` states are **persisted** in DO storage so a worker eviction does not lose compact in flight.
- Persistence storage key: `compact-state:{sessionUuid}` in DO state.storage.
- State transitions are **always wrapped in `state.storage.transaction()`** to ensure rollback on failure (per F04).

### 2.4 Crash recovery

After cold start of session DO, if `compact-state:{sessionUuid}` exists in `armed` or `preparing`:
- `armed`: re-arm scheduler
- `preparing`: emit `ContextCompactPrepareInterrupted` + retry once OR abandon to `failed`

---

## 3. Threshold Configuration

### 3.1 Two-tier threshold (per owner §1.3 canonical)

| Constant | Default | Source/rationale |
|---|---|---|
| `SOFT_COMPACT_TRIGGER_PCT` | 0.75 (75%) | Conservative; gives ~25% buffer for prepare phase to complete |
| `HARD_COMPACT_FALLBACK_PCT` | 0.95 (95%) | Last-resort sync trigger |
| `MIN_HEADROOM_TOKENS_FOR_BACKGROUND` | 5_000 | Minimum tokens free before scheduler will arm; prevents false-positive on small contexts |
| `BACKGROUND_TIMEOUT_MS` | 30_000 | If background LLM exceeds this, fallback escalates to sync at next turn boundary |
| `MAX_RETRIES_AFTER_FAILURE` | 1 | Per-session retry budget; after exhaust → `failed` state surfaces to user |

### 3.2 Per-session override

`SessionRuntimeConfig.compactPolicy` field allows per-session override:

```ts
interface CompactPolicy {
  readonly softTriggerPct?: number;
  readonly hardFallbackPct?: number;
  readonly disabled?: boolean;  // explicit no-compact for short sessions
}
```

---

## 4. CoW Context Fork

### 4.1 What forks, what is shared

When `PREPARE` starts, `CompactionPlanner.fork(currentContext)` returns a `ContextCandidate`:

| Layer | Shared (immutable ref) | Forked (deep copy) |
|---|---|---|
| `system` (system prompt) | ✓ | — |
| `memory` (prepared persistent memory) | ✓ | — |
| `interaction` (user/assistant turn pairs) | — | **fork** (subject to summarization) |
| `tool_result` (capability outputs) | — | **fork** (subject to trim/summarize) |
| `summary` (existing rolling summary) | ✓ initially; modified in candidate | — |
| `knowledge_chunk` (retrieved chunks) | (copy ref list; chunks themselves immutable) | — |

### 4.2 Implementation primitive

CoW fork is **structural sharing**, not byte-deep copy:
- `ContextCandidate.layers` is a new `Array<ContextLayer>` with **same object references** to immutable layers
- Mutable layers (`interaction`, `tool_result`) get new array wrappers but elements are still shared until written
- This keeps `CompactionPlanner.fork()` to ~O(1) memory (just new wrapper objects)

### 4.3 Versioned snapshot for user rollback

After `COMMIT`, the **previous** context (pre-swap) is preserved as `version-{N-1}` snapshot:
- Stored in DO storage under `context-snapshot:{sessionUuid}:v{N-1}`
- Subject to `WorkspaceSnapshotBuilder` size limit (per F08, must be ≤ 1 MiB or promote to R2)
- User can `restoreContext(snapshotId)` via inspector typed capability (P3 inspector facade)

---

## 5. Atomic Swap (COMMIT phase)

### 5.1 Storage primitive choice — F06 + F04 driven

> **Critical decision (per F06)**: the atomic swap MUST use DO storage `state.storage.transaction()`. **Cannot** use D1 — D1 explicitly rejects `BEGIN TRANSACTION` and redirects to DO storage transaction in its error message.

```ts
// committer.ts
async commit(prepared: PreparedSummary, sessionUuid: string): Promise<void> {
  await doStorage.transaction(async (tx) => {
    // 1. Read current context (may have advanced since prepare started)
    const current = await tx.get<ContextLayers>(`context:${sessionUuid}`);

    // 2. Diff-aware swap: any messages added during prepare phase are kept
    //    (they go INTO the new context BEFORE the summary is fully applied)
    const newContext = mergeFreshMessages(prepared, current);

    // 3. Snapshot previous version
    await tx.put(`context-snapshot:${sessionUuid}:v${current.version}`, current);

    // 4. Atomic write of new context
    await tx.put(`context:${sessionUuid}`, { ...newContext, version: current.version + 1 });

    // 5. Update compact state
    await tx.delete(`compact-state:${sessionUuid}`);
  });
  // If transaction throws → ContextCompactCommitFailed event; state stays preparing
}
```

### 5.2 Diff-aware merge (mid-prepare drift handling)

During PREPARE phase, **the conversation continues** — new turns may have been appended. The COMMIT must:
1. Detect messages added since the snapshot point (`prepared.snapshotVersion` vs `current.version`)
2. Append those fresh messages **after** the summary block (so they're not lost)
3. If fresh messages alone push usage > soft threshold again, immediately re-arm scheduler post-commit

---

## 6. Hard Fallback (synchronous compact)

When token usage hits HARD_THRESHOLD (~95%) and no prepared summary exists, fall back to **claude-code style synchronous compact**:
- Block current turn at the next safe boundary (turn boundary, NOT mid-tool-call)
- Run summarization synchronously in same worker invocation
- Emit `ContextCompactArmed` + `ContextCompactPrepareStarted` + `ContextCompactCommitted` in rapid succession
- Add `compactReason: "hard-fallback-no-prepared-summary"` to `PostCompact` payload

**This is the graceful degradation path** — it is acceptable for nano-agent to occasionally fall back to sync compact when:
- Buffer headroom was misconfigured (too small for typical compaction LLM latency)
- Background LLM provider is unavailable
- Prepared summary timed out (`BACKGROUND_TIMEOUT_MS` exceeded)

---

## 7. Hook Event Emissions (P4 contract)

The lifecycle emits the following hook events **at exactly these transition points**. P4 catalog expansion design must register these.

| Event | When emitted | Blocking? | Allowed outcomes |
|---|---|---|---|
| `ContextPressure` | Token usage rises through 50% / 60% / 70% (early signal, before SOFT) | non-blocking | `additionalContext` (e.g. add hint to prompt), `diagnostics` |
| `ContextCompactArmed` | `idle → armed` transition | non-blocking | `diagnostics` |
| `ContextCompactPrepareStarted` | `armed → preparing` transition; carries `prepareJobId` | non-blocking | `diagnostics` |
| `ContextCompactCommitted` | `committing → committed` transition; carries `oldVersion`, `newVersion`, `summaryRef` | non-blocking | `additionalContext`, `diagnostics` |
| `ContextCompactFailed` | `failed` state entered | non-blocking | `diagnostics` |
| `PreCompact` (existing) | Right before COMMIT atomic swap | **blocking** (existing behavior) | `block`, `diagnostics` |
| `PostCompact` (existing) | After atomic swap committed; carries final summary | non-blocking (existing behavior) | `additionalContext`, `diagnostics` |

> **Note on PreCompact still blocking**: pre-existing 8-event catalog has `PreCompact` blocking (allows hooks to abort compact). This semantics is preserved — but in the prepare/commit model, the blocking happens at COMMIT not at ARMED, because that's when the user-visible context is about to mutate.

---

## 8. NACP Message Surface (P5 contract)

P5 NACP 1.2.0 design must reverse-derive the minimal message family from these requirements. **This spec does not pre-freeze message kind names** (per charter §4.1 F).

What MUST be representable in NACP after P5 ship:

1. Cross-worker compact request: `agent.core` → `context.core` "please prepare a summary of these messages" (only relevant if context.core is its own worker; if internal to agent.core, no NACP needed)
2. Cross-worker compact result: `context.core` → `agent.core` "summary ready, here it is"
3. Inspector subscribe to compact lifecycle: `inspector` → session DO "stream me ContextCompactArmed/Started/Committed events"

What does NOT need NACP representation (handled by hooks + inspector facade alone):
- `ContextPressure` early signals (pure intra-worker hook events)
- `PreCompact` / `PostCompact` (existing hook protocol; intra-worker)
- Per-session policy override reads (HTTP inspector facade, not NACP)

---

## 9. Performance Budget

Based on B1 evidence:

| Metric | Budget | B1 source |
|---|---|---|
| Background LLM call timeout | 30 s | conservative; tunable |
| Atomic swap (COMMIT phase) latency | < 100 ms | F04 DO tx p50 ≈ 10s of ms; diff-aware merge may add ~50 ms for large contexts |
| Cross-worker compact dispatch (if context.core is separate) | p50 < 10 ms | binding-F01 baseline |
| Compact lifecycle hook dispatch (cross-worker) | p50 < 10 ms | binding-F03 hook callback baseline |
| KV write of compact state | use `KvAdapter.putAsync` | unexpected-F02 sync KV write 520 ms too slow for hot path |

---

## 10. Interaction with F08 (DO storage value cap)

Summary blobs **must** respect DO storage 1 MiB cap (P1 design `DOStorageAdapter.maxValueBytes = 1MB`). Strategy:

1. If summary text fits in 1 MiB: store inline in DO storage as `summary` layer
2. If summary text > 1 MiB: write blob to R2, store **ref** in DO storage; layer becomes `{ tag: "summary", ref: nacpRef }`
3. This routing decision lives in P3 hybrid-storage tier router design, not in this spec

---

## 11. Out of scope

This spec does NOT define:
- Strategy for **what** to summarize (LLM prompt design for summarization itself) — left to implementation
- Choice of "compact LLM model" (e.g. cheaper Anthropic Haiku vs main reasoning model) — left to llm-wrapper config
- Cross-session memory persistence (the `memory` layer source) — orthogonal to compact lifecycle
- Per-tag retention policy (what tags to evict) — strategy layer; defined elsewhere

---

## 12. Acceptance criteria

This spec is **frozen** when:
1. `P3-context-management-async-compact.md` references this spec for state machine + transitions ✓
2. `P3-context-management-inspector.md` references this spec for event surface ✓
3. `P4-hooks-catalog-expansion.md` registers all 5 new lifecycle events from §7 ✓
4. `P5-nacp-1-2-0-upgrade.md` reverse-derives minimal message family per §8 ✓
5. B4 action plan implementation conforms to §2 state machine
6. Round 2 integrated spike (B7) re-tests one full lifecycle end-to-end

---

## 13. Revision history

| Date | Author | Change |
|---|---|---|
| 2026-04-19 | Opus 4.7 | Initial canonical spec; lifecycle prose lifted from `context-management-eval-by-Opus.md` v2 §4.4; F04/F06/F08 + binding-F01/F03 + unexpected-F02 cited as B1 evidence |
