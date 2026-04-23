# B8 Phase 1 Closure — ancestry summary for worker-matrix r2

> **Status**: `historical ancestry summary`
> **Canonical source**: `docs/issue/after-foundations/B8-phase-1-closure.md`
> **How to use this file**: keep the platform law; do not treat it as the direct worker-matrix kickoff pack

---

## 1. What still survives from B8 Phase 1

The B8 inventory still matters for these platform truths:

1. **lowercased `x-nacp-*` headers** on service-binding seams
2. **`BoundedEvalSink` dedup and overflow visibility** remain non-optional
3. **DO safe planning cap** stays at **`2,097,152` bytes**
4. **R2 parallel put safe default** stays at **`50`**
5. the open owner/platform gates **`F03`** and **`F09`** remain visible carry-over constraints

These truths remain useful because worker-matrix will still inherit:

- service-binding transport,
- DO/R2/KV/D1 routing decisions,
- and cross-worker observability law.

---

## 2. What is now superseded

Do **not** reuse B8 Phase 1 as if it were the current stage gate for:

1. current package versions
2. worker entry sequencing
3. direct readiness wording for worker-matrix kickoff

Those questions are now governed by:

- `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
- `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
- `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`

---

## 3. How worker-matrix r2 should consume B8 now

Use B8 as **platform ancestry**, not as kickoff truth:

1. keep its evidence-backed platform laws,
2. keep its “host vs remote worker” framing,
3. keep its warnings about open gates,
4. but consume all of that through the pre-worker handoff pack rather than directly from the 2026-04-20 closure posture.
