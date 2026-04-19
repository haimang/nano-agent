# [B1 / Phase 4 closure] 13 required + 2 optional per-finding docs shipped

> **Issue ID**: `B1-phase-4-closure`
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> **Phase**: 4 — Per-finding doc 撰写
> **Status**: ✅ closed (PASSED)
> **Created**: 2026-04-19
> **Closed**: 2026-04-19
> **Owner**: sean.z@haimangtech.cn

---

## Summary

13 条 required per-finding doc 全部 ship 到 `docs/spikes/{spike-do-storage,spike-binding-pair}/`，2 条 optional `unexpected-F*` 也一并 ship。每条 finding 都含 §3 Package Impact (具体 packages/ 文件路径 + 行号) + §5 Writeback Action (target phase B2-B6 + 责任 owner)。Phase 4 收口标准全部满足。

## Completed work items

| # | Item | Count | Status |
|---|---|---|---|
| P4-01a | spike-do-storage V1 storage findings | 6 | ✅ F01-F06 |
| P4-01b | spike-do-storage V2 bash findings | 3 | ✅ F07-F09 |
| P4-02 | spike-binding-pair V3 findings | 4 | ✅ F01-F04 |
| P4-03 | unexpected-F* findings | 2 | ✅ F01-F02 |
| | **Total** | **15 finding docs** | |

## Finding inventory

### `docs/spikes/spike-do-storage/` (9 required)

| # | Finding | Severity | Holds / Diverges | Primary writeback target |
|---|---|---|---|---|
| F01 | R2 multipart not required up to 10 MiB | informational | holds | B2 (storage adapter) |
| F02 | R2 list cursor pagination confirmed | medium | **接口需 v2 (breaking)** | B2 + B7 RFC |
| F03 | KV stale-read not observed in same colo | medium | **needs Round 2 cross-colo** | B2 (JSDoc) + B7 |
| F04 | DO transactional 3 scenarios confirmed | informational | holds | B2 (DOStorageAdapter) |
| F05 | MemoryBackend vs DO basic K/V parity | informational | holds | B2 (JSDoc) |
| F06 | D1 cross-query transaction **explicitly rejected** | **high** | breaking change | B2 + B4 (async-compact uses DO not D1) |
| F07 | V2A capability-parity 3/3 contracts hold | informational | holds | B3 (no contract change needed) |
| F08 | DO storage value cap **1-10 MiB SQLITE_TOOBIG** | **high** | size-aware required | B2 + B4 + B3 |
| F09 | curl quota 25 fetches no rate-limit | low | informational | B3 + Round 2 high-volume |

### `docs/spikes/spike-binding-pair/` (4 required)

| # | Finding | Severity | Primary writeback target |
|---|---|---|---|
| F01 | binding latency sub-10ms + cancellation works | informational + medium | B8 handoff + Round 2 callee-abort verification |
| F02 | anchor headers survive but **forced lowercase** | medium | B5 (cross-seam audit) + B6 (NACP spec) |
| F03 | hooks-callback latency + error shape confirmed | informational | B5 (Phase 4 catalog can extend safely) |
| F04 | eval-fanin **app-layer dedup REQUIRED** | **high** | B6 (SessionInspector + defaultEvalRecords dedup) |

### `docs/spikes/unexpected/` (2 optional)

| # | Finding | Severity | Primary writeback target |
|---|---|---|---|
| F01 | R2 put ~273 ms / key (per-call overhead dominates small writes) | medium | B2 (R2Adapter parallel helper) + Round 2 concurrent probe |
| F02 | KV write latency ~520 ms (170× slower than read) | medium | B2 (KvAdapter putAsync helper) + B4 (hybrid tier async write) |

## Writeback distribution map

> Per owner Q3 ("自然分布"): no forced equal distribution.

| Target phase | Findings driving writeback | Count |
|---|---|---|
| **B2** (Storage Adapter Hardening) | F02, F03, F04, F05, F06, F08, unexpected-F01, unexpected-F02 | **8** |
| **B3** (Fake-Bash Extension) | F07, F08, F09 | 3 |
| **B4** (Context-Management Package) | F06, F08, binding-F04, unexpected-F02 | 4 |
| **B5** (Hooks Catalog Expansion) | binding-F02, binding-F03, binding-F04 | 3 |
| **B6** (NACP 1.2.0 + observability dedup) | binding-F02, binding-F04 | 2 |
| **B7** (Round 2 integrated re-test) | F03, F08, F09, binding-F01, unexpected-F01 | **5** |
| **B8** (handoff memo) | F01, F04, F05, F07, binding-F01, binding-F03 | 6 |

> **Validation that writeback is well-distributed**: **B2 (storage) gets 8 findings** (heaviest single-phase load — expected since storage is the most platform-bound layer); **B7 (Round 2)** gets 5 findings — necessary because several findings need cross-region/larger-volume probe to fully close.

## Key contract requirements emerging from this batch

These are the `must-do` items that will gate B2-B6:

1. **`ScopedStorageAdapter.r2List` interface signature MUST change** — add cursor / limit / truncated fields (F02)
2. **D1 cross-query transactions MUST use `db.batch([...])` or DO storage** — never client-driven BEGIN (F06)
3. **DO storage value writes MUST size-check before put** — 1-10 MiB hard cap (F08)
4. **Anchor headers MUST be lowercase in all packages/ constants** — runtime forces lowercase (binding-F02)
5. **Eval sink MUST dedup by messageUuid** — transport does not dedup (binding-F04)
6. **Sink overflow MUST emit explicit disclosure event** — silent drop is unacceptable (binding-F04)

## Discipline check (Phase 4)

| 纪律 | 状态 | Evidence |
|---|---|---|
| 1. spikes/ 顶级 | ✅ | finding docs 在 `docs/spikes/`，spike code 在 `spikes/` |
| 2. expiration date | ✅ | spike workers 仍持有 `EXPIRATION_DATE=2026-08-01` |
| 3. 不接 CI 主链 | ✅ | finding docs 是纯 markdown |
| 4. **finding → design doc** | ✅ | **本 Phase 主要交付物——15 finding docs 全 ship，每个含 §3 + §5 必填字段** |
| 5. 不接生产数据 | ✅ | finding docs 仅含 probe 输出 + packages/ 路径，无业务数据 |
| 6. round-1 与 round-2 分目录 | ✅ | finding 路径 `docs/spikes/{namespace}/` |
| 7. 不依赖 packages/ runtime；回写对齐 packages/ seam | ✅ | 每条 finding §3 显式列出 packages/ 文件 + 行号 |

## Phase 4 closure gate verdict

✅ **PASSED** —
- 13/13 required findings shipped with 8-section template
- 每条 §3 Package Impact 非空（含具体文件路径+行号）
- 每条 §5 Writeback Action 非空（含 target phase + 责任 owner）
- 2 条 optional unexpected-F* 也 ship（鼓励项）
- Writeback distribution map 输出，B2-B8 都有明确输入
- 6 条 hard contract requirement 已浮现，将作为后续 phase 的硬门槛

## Next: Phase 5 (P5-01..03)

- **P5-01**: `docs/spikes/storage-findings.md` rollup (V1 6 项)
- **P5-02**: `docs/spikes/binding-findings.md` rollup (V3 4 项, with transport scope disclaimer)
- **P5-03**: `docs/spikes/fake-bash-platform-findings.md` rollup (V2A + V2B + V2-curl)

每份 rollup 必须含 §1 Finding index + §2 Severity summary + §3 Writeback destination map + §4 Unresolved/dismissed summary + §5 Per-finding doc links。

## References

- Charter: `docs/plan-after-foundations.md`
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Tracking policy: `docs/issue/README.md`
- Previous issues: `B1-phase-1-closure.md`, `B1-phase-2-closure.md`, `B1-phase-3-closure.md`
- Finding docs: `docs/spikes/spike-do-storage/`, `docs/spikes/spike-binding-pair/`, `docs/spikes/unexpected/`
- Combined run outputs: `spikes/round-1-bare-metal/{spike-do-storage,spike-binding-pair}/.out/`
