# [B1 / handoff] B2-B6 inputs from B1 spike round 1 findings

> **Issue ID**: `B1-handoff-to-B2-B6`
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` P6-03
> **Phase**: 6 — Spike 纪律自检与 handoff
> **Status**: open (downstream phase consumption)
> **Created**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Purpose**: Single-page mapping from B1 finding IDs → B2/B3/B4/B5/B6 action plan inputs

---

## How to use this doc

When drafting B2-B6 action plans, **each design / RFC / implementation file must reference at least one finding ID from this handoff**. This satisfies the **backward traceability** requirement of `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §5.2.

If a B2-B6 ship item has **no** finding reference, it must be justified in the action plan as either:
1. Pure structural / framework work (not platform-driven)
2. Explicitly out-of-scope of B1 round 1

---

## B2 — Storage Adapter Hardening

**Primary inputs**: 7 findings (heaviest writeback target)

| Finding ID | What B2 must do | Target packages/ file |
|---|---|---|
| `spike-do-storage-F01` | Wrap `binding.put` directly (no multipart field needed for ≤ 10 MiB) | `packages/storage-topology/src/adapters/r2-adapter.ts` (NEW) |
| **`spike-do-storage-F02`** | **Modify `r2List` interface to v2** with cursor / limit / truncated fields | `packages/storage-topology/src/adapters/scoped-io.ts:127` (modify) + `r2-adapter.ts` (NEW) |
| `spike-do-storage-F03` | JSDoc note KV stale-read freshness depends on locality | `packages/storage-topology/src/adapters/scoped-io.ts:99-107` |
| `spike-do-storage-F04` | Wrap `state.storage.transaction()` directly (contract holds) | `packages/storage-topology/src/adapters/do-storage-adapter.ts` (NEW) |
| `spike-do-storage-F05` | JSDoc note MemoryBackend basic K/V parity confirmed | `packages/workspace-context-artifacts/src/backends/memory.ts` |
| **`spike-do-storage-F06`** | **D1Adapter expose `batch()` only, NOT `beginTransaction()`** | `packages/storage-topology/src/adapters/d1-adapter.ts` (NEW); review `refs.ts`, `promotion-plan.ts` |
| **`spike-do-storage-F08`** | **DOStorageAdapter `put` size pre-check** + MemoryBackend add `maxValueBytes` config | `packages/storage-topology/src/adapters/do-storage-adapter.ts`, `packages/workspace-context-artifacts/src/backends/memory.ts` |
| `unexpected-F01` | R2Adapter expose `putParallel(items)` helper | `packages/storage-topology/src/adapters/r2-adapter.ts` |
| `unexpected-F02` | KvAdapter expose `putAsync(key, value): void` (fire-and-forget) | `packages/storage-topology/src/adapters/kv-adapter.ts` (NEW) |

**B2 RFC required**: `docs/rfc/scoped-storage-adapter-v2.md` (covers F02 breaking change + F08 size cap exposure).

**B2 ship recommendation**: `storage-topology` major bump 0.1.0 → 2.0.0 (per charter §11.2 anticipation).

**Existing writeback issue**: `B2-writeback-r2list-cursor-interface.md`

---

## B3 — Fake-Bash Extension & Just-Bash Port

**Primary inputs**: 3 findings

| Finding ID | What B3 must do | Target packages/ file |
|---|---|---|
| `spike-do-storage-F07` | (no contract change) — 12-pack handler contract holds; safe to port more just-bash commands | `packages/capability-runtime/src/capabilities/*` (extension only) |
| `spike-do-storage-F08` | `write` capability must size pre-check (catch oversized blobs before DO storage rejection) | `packages/capability-runtime/src/capabilities/filesystem.ts` |
| `spike-do-storage-F09` | When connecting curl, expose per-turn subrequest budget config; emit `capability.subrequest_budget_exhausted` | `packages/capability-runtime/src/capabilities/network.ts:38` (replace stub) |

**B3 design must explicitly reference F07** to confirm `MKDIR_PARTIAL_NOTE`, `/_platform/**` reserved namespace, and `rg` cap behaviors are kept.

---

## B4 — Context-Management Package (with async compact core)

**Primary inputs**: 4 findings (cross-cutting)

| Finding ID | What B4 must do | Target packages/ file |
|---|---|---|
| `spike-do-storage-F06` | async-compact `committer.ts` atomic swap MUST use DO storage transaction; **NOT** D1 BEGIN/COMMIT | `packages/context-management/async-compact/committer.ts` (Phase 3 design) |
| `spike-do-storage-F08` | async-compact summary blob > 1 MiB must promote to R2 (not DO); strategy must be size-aware | `packages/context-management/async-compact/`, `packages/context-management/storage/` (B4 子模块) |
| `spike-binding-pair-F02` | inspector facade JSDoc note "anchor headers normalized lowercase" | `packages/context-management/inspector-facade/` |
| `spike-binding-pair-F04` | Phase 3 inspector facade design must cite app-layer dedup contract | `docs/design/after-foundations/P3-context-management-inspector.md` |
| `unexpected-F02` | hybrid storage tier system / memory layer write must use `putAsync` (KV write 520 ms is too slow for hot path) | `packages/context-management/storage/kv-tier.ts` |

---

## B5 — Hooks Catalog Expansion (event classes 先冻结)

**Primary inputs**: 3 findings

| Finding ID | What B5 must do | Target packages/ file |
|---|---|---|
| `spike-binding-pair-F02` | Catalog & cross-seam audit must use lowercase header names consistently | `packages/session-do-runtime/src/cross-seam.ts` (audit) |
| `spike-binding-pair-F03` | Catalog can safely extend; cross-worker hook dispatch latency confirmed sub-10ms ok / 1.5s blocking viable | `packages/hooks/src/catalog.ts` (extension) |
| `spike-binding-pair-F04` | Consider adding `EvalSinkOverflow` event to candidate list for class-D (async observability lifecycle) | `packages/hooks/src/catalog.ts` (extension candidate) |

**B5 reminder**: per `plan-after-foundations.md` r2 §4.1 E, B5 freezes 4 event **classes** first (保留 / claude-code 借鉴 / 环境 / async compact lifecycle); exact catalog count is set after B4 producer reality is known.

---

## B6 — NACP 1.2.0 + Observability Dedup

**Primary inputs**: 2 findings

| Finding ID | What B6 must do | Target packages/ file |
|---|---|---|
| `spike-binding-pair-F02` | NACP 1.2.0 RFC must explicitly declare anchor header names lowercase | `docs/rfc/nacp-1-2-0.md` (NEW) |
| **`spike-binding-pair-F04`** | **`SessionInspector` + `defaultEvalRecords` sink must dedup by messageUuid + emit overflow disclosure** | `packages/eval-observability/src/inspector.ts:78` (modify) + `packages/session-do-runtime/src/do/nano-session-do.ts` defaultEvalRecords (modify) |

**B6 reminder**: per `plan-after-foundations.md` r2 §4.1 F, NACP 1.2.0 specific message families are reverse-derived from Phase 3 (B4) producer/consumer reality — **don't pre-freeze message kinds**.

**Existing writeback issue**: `B6-writeback-eval-sink-dedup.md`

---

## B7 — Round 2 Integrated Validation

**Primary inputs**: 5 findings (must re-test in Round 2)

| Finding ID | What Round 2 must verify | Why Round 2 |
|---|---|---|
| `spike-do-storage-F03` | Cross-region / cross-colo KV stale-read | Round 1 only same-colo; needs broader probe |
| **`spike-do-storage-F08`** | **Binary-search probe to find precise DO size cap (1-10 MiB range)** | Round 1 found range; Round 2 needs precise number |
| `spike-do-storage-F09` | High-volume curl quota with **owner-supplied URL** (per Q2) | Round 1 only 25 fetches; need 50/100/500/1000 阶梯 |
| `spike-binding-pair-F01` | wrangler tail confirmation that callee receives abort (`[slow] abort observed`) | Round 1 only confirmed caller-side abort |
| `unexpected-F01` | R2 concurrent put with 50/100/200 parallel (test rate-limit) | Round 1 only sequential |

---

## B8 — Worker-Matrix Pre-Convergence & Handoff

**Primary inputs**: 6 findings (to cite in handoff memo)

| Finding ID | What handoff memo cites |
|---|---|
| `spike-do-storage-F01` | "R2 single-part covers ≤ 10 MiB" |
| `spike-do-storage-F04` | "DO storage transaction contract validated" |
| `spike-do-storage-F05` | "MemoryBackend ≈ DO storage for basic K/V" |
| `spike-do-storage-F07` | "12-pack capability contract holds in real worker runtime" |
| `spike-binding-pair-F01` | "Service binding latency baseline: p50=5ms, p99=7ms (1KiB), 1MiB p50=13ms; 10 concurrent in 12ms wallclock" |
| `spike-binding-pair-F03` | "Cross-worker hook dispatch latency: p50=4ms; blocking 1.5s viable; throwing hook returns structured 500 body" — **caveat (2026-04-19 r2 per B1-final-closure §Caveats C2)**: anchor-on-hook-path claim originally tested via `/handle/header-dump`; r2 fix re-verified via true `/handle/hook-dispatch` route; new `.out/2026-04-19T13-02-31Z.json` evidence |
| `spike-binding-pair-F04` | **⚠️ Scope caveat C1**: probe flow 是 response-batch simulation (worker-a pull)，不是 cross-worker sink callback (worker-b push); 真 callback 验证推迟 B7 P6 §4.4a |
| `spike-do-storage-F03` | **⚠️ Weak evidence caveat C3**: 40-sample same-colo baseline only; cacheTtl/100-sample/cross-colo 留 B7 P6 §4.1 + §4.4b |

---

## Quick aggregate (per-phase finding count)

| Phase | Finding count |
|---|---|
| B2 | 7 (incl. unexpected) |
| B3 | 3 |
| B4 | 4 |
| B5 | 3 |
| B6 | 2 |
| B7 | 5 |
| B8 | 6 |

---

## References

- Charter: `docs/plan-after-foundations.md` §10.3 双向 traceability
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md` P6-03
- All 13 finding docs: `docs/spikes/spike-do-storage/`, `docs/spikes/spike-binding-pair/`
- 2 unexpected findings: `docs/spikes/unexpected/`
- 3 rollup docs: `docs/spikes/storage-findings.md`, `binding-findings.md`, `fake-bash-platform-findings.md`
- Discipline check: `docs/spikes/_DISCIPLINE-CHECK.md`
- Existing writeback issues:
  - `docs/issue/after-foundations/B2-writeback-r2list-cursor-interface.md`
  - `docs/issue/after-foundations/B6-writeback-eval-sink-dedup.md`
- Tracking policy: `docs/issue/README.md`
