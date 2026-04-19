# Spike Rollup — `storage-findings`

> **Rollup ID**: `storage-findings`
> **Spike**: `spike-do-storage` (V1 storage subset)
> **Round**: 1 (bare-metal)
> **Generated**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Charter requirement**: `docs/plan-after-foundations.md` §4.1 A 第 4 项 deliverable

---

## §1 Finding Index

| # | ID | Title | Severity | Status | Packages/ impact (one-line) |
|---|---|---|---|---|---|
| 1 | `spike-do-storage-F01` | R2 multipart not required up to 10 MiB | informational | open | None — `r2Put` 接口现状即可 |
| 2 | `spike-do-storage-F02` | R2 list cursor required, pagination confirmed | medium | open | **`scoped-io.ts:127` r2List 接口必须 v2 (breaking)** |
| 3 | `spike-do-storage-F03` | KV stale-read NOT observed in same colo | medium | open | `scoped-io.ts:99-107` JSDoc 标注 + Round 2 cross-colo 复现 |
| 4 | `spike-do-storage-F04` | DO transactional 3 scenarios confirmed | informational | open | None — `WorkspaceNamespace` transactional 假设成立 |
| 5 | `spike-do-storage-F05` | MemoryBackend vs DO basic K/V parity | informational | open | `MemoryBackend` JSDoc 标注 (DO size diff 见 F08) |
| 6 | `spike-do-storage-F06` | D1 cross-query transaction **explicitly rejected** | **high** | open | `refs.ts` / `promotion-plan.ts` 必须改用 batch；`D1Adapter` 不暴露 BEGIN |

**Total**: 6 required findings (V1-storage 全部覆盖)；0 optional。

---

## §2 Severity Summary

| Severity | Count | IDs |
|---|---|---|
| **high** | 1 | F06 (D1 transaction model) |
| **medium** | 2 | F02 (R2 list interface v2), F03 (KV stale-read needs cross-colo verify) |
| **informational** | 3 | F01, F04, F05 |
| low | 0 | — |

> **Distribution observation**: 1/6 高 severity 是 D1 transaction model（最大 packages/ contract impact）；2/6 medium 是接口签名 + 复现要求；3/6 informational 都是 packages/ 假设 hold 的好消息。

---

## §3 Writeback Destination Map

| Finding | Target phase | Target packages/ file(s) | Action class |
|---|---|---|---|
| F01 | B2 | `packages/storage-topology/src/adapters/r2-adapter.ts` (NEW) | wrap binding.put 直接 (无 multipart 字段) |
| **F02** | **B2** + **B7 RFC** | `packages/storage-topology/src/adapters/scoped-io.ts:127` (modify) + `r2-adapter.ts` (NEW) | **breaking interface change**：r2List → `(prefix, opts: { limit?, cursor? }) => { objects, truncated, cursor? }` |
| F03 | B2 (JSDoc) + **B7 (Round 2 cross-colo)** | `packages/storage-topology/src/adapters/scoped-io.ts:99-107` JSDoc | doc-only + 强制 Round 2 复现 |
| F04 | B2 | `packages/storage-topology/src/adapters/do-storage-adapter.ts` (NEW) | wrap `state.storage.transaction()` |
| F05 | B2 (JSDoc) | `packages/workspace-context-artifacts/src/backends/memory.ts` JSDoc | "basic K/V parity confirmed; size diff per F08" |
| **F06** | **B2** + **B4** | `packages/storage-topology/src/refs.ts`, `promotion-plan.ts` (review) + `d1-adapter.ts` (NEW); `packages/context-management/async-compact/committer.ts` (B4 design) | **D1 only batch；async-compact atomic swap → DO storage not D1** |

### Summary by target phase

| Phase | Findings affecting | Count |
|---|---|---|
| **B2 (Storage Adapter Hardening)** | F01, F02, F03 (JSDoc), F04, F05, F06 | **6** |
| **B4 (Context-Management Package)** | F06 (committer.ts design) | 1 |
| **B7 (Round 2 integrated)** | F03 (cross-colo) | 1 |
| (Round 2 RFC) | F02 (scoped-storage-adapter-v2 RFC) | 1 |

> **B2 承担本 rollup 的全部主线 writeback**（6/6 findings 都 touch B2）。这与 charter §6 Phase 1 "Storage Adapter Hardening" 的角色一致。

---

## §4 Unresolved / Dismissed Summary

**Unresolved (open，等 writeback)**: 6/6 findings 状态都是 `open`。

**Dismissed-with-rationale**: 0 — 没有 finding 被 dismiss。

**Round 2 必须复现**: 1
- `F03` KV stale-read：本轮仅同 colo 实测，需要 cross-region / cross-colo probe 才能确认。**如 Round 2 暴露 stale，F03 会从 medium 升级为 high + breaking change**（接口加 freshness 字段）。

---

## §5 Per-finding Doc Links

- [F01 — R2 multipart not required up to 10 MiB](spike-do-storage/01-r2-multipart-not-required-up-to-10mib.md)
- [F02 — R2 list cursor required, pagination confirmed](spike-do-storage/02-r2-list-cursor-required-pagination-confirmed.md)
- [F03 — KV stale-read NOT observed in same colo](spike-do-storage/03-kv-stale-read-not-observed-in-same-colo.md)
- [F04 — DO transactional 3 scenarios confirmed](spike-do-storage/04-do-transactional-three-scenarios-confirmed.md)
- [F05 — MemoryBackend vs DO basic K/V parity](spike-do-storage/05-mem-vs-do-state-parity-confirmed.md)
- [F06 — D1 cross-query transaction explicitly rejected](spike-do-storage/06-d1-cross-query-transaction-explicitly-rejected.md)

---

## §6 Reference

- Charter: `docs/plan-after-foundations.md` §4.1 A
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Rollup spec: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §4.6
- Related rollup (V2): `fake-bash-platform-findings.md`
- Related spike output: `spikes/round-1-bare-metal/spike-do-storage/.out/2026-04-19T08-17-46Z.json`
- Phase 4 issue: `docs/issue/after-foundations/B1-phase-4-closure.md`
