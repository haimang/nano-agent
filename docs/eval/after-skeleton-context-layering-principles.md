# After-Skeleton Context Layering Principles — v1

> Owner: A7 (Phase 6 — storage-and-context-evidence-closure)
> Status: `frozen v1` (2026-04-18)
> Scope: principles drawn from A7's `assembly / compact / artifact /
> snapshot` evidence streams, designed to outlast any single
> implementation and to serve as the entry point for the next-phase
> context architecture.

## 1. Context is assembled, not concatenated

Every LLM request consumes a **deliberately composed** context, not a
free-form string. `ContextAssembler.assemble()` enforces:

1. **Explicit layer list.** Callers supply `config.layers` when they
   want a non-default ordering. The frozen canonical ordering is
   `system → session → workspace_summary → artifact_summary →
   recent_transcript → injected`.
2. **Allowlist AND ordering.** `config.layers` filters and orders at
   the same time. This is the only way to drop an optional layer.
3. **Required layers are inviolable.** Any evidence record with
   `requiredLayerBudgetViolation: true` is a contradictory signal
   against `assembly.required-layer-respected`. Treat it as an
   invariant bug, not a budget hint.
4. **Truncation is observable.** `AssemblyResult.truncated` + the
   evidence stream's `droppedOptionalKinds` always surface the
   decision; they never fail silently.

## 2. Compact is a strip-and-reinject boundary

`CompactBoundaryManager` models compaction as a **boundary**, not a
rewrite. The three-phase evidence shape is normative:

- **Request** — records `target_token_budget` + `history_ref.key`;
  proves a compaction pass was asked for.
- **Response** — records `tokens_before / tokens_after / summary_ref`
  or `error`. `error` is the only way compaction stops being
  `supporting` evidence.
- **Boundary** — records `turnRange` + `summaryRef` + `archivedAt`.
  This is what a future resume walks; without it, the boundary never
  happened.

Any compaction without a recorded boundary MUST be treated as
provisional, regardless of `tokens_after`.

## 3. Artifacts have a lifecycle, not a state

The five artifact stages (`inline / promoted / prepared / archived /
replaced`) are ordered — reviewers should read evidence records in
timestamp order and expect a monotonic progression. A `replaced`
record MUST carry both `sourceRefKey` and `preparedRefKey` so reviewers
can reconstruct the replacement; otherwise the replacement is
unexplained and the `artifact` stream rejects it as provisional.

## 4. Snapshot coverage is the only metric

Snapshots are only useful if they can be **restored**. The contract:

- Every `restore` evidence must supply `restoreCoverage ∈ [0, 1]`.
- Any coverage below `0.8` (the default `RESTORE_COVERAGE_THRESHOLD`)
  is a contradictory signal against `snapshot.restore-coverage` and
  triggers `needs-revisit` after even one occurrence.
- Missing fragments MUST be reported via `missingFragments`. A silent
  zero-coverage restore is a protocol violation, not a workaround.

## 5. Evidence anchors are non-negotiable

Every evidence record carries an `EvidenceAnchor` with `traceUuid +
sessionUuid + teamUuid + sourceRole + timestamp`. This is inherited
from the A3 trace-first law — evidence without an anchor is
categorically not P6 evidence and MUST be rejected by downstream sinks.

## 6. Verdict language is separate from capability grade (AX-QNA Q14)

- `provisional / evidence-backed / needs-revisit /
  contradicted-by-evidence` describe **hypothesis status**.
- PX E0–E3 grades describe **capability maturity**.
- The two vocabularies never appear in the same column.
- Any doc that introduces a new verdict-style bucket MUST say so
  explicitly in prose; otherwise reviewers will reach for the Q13
  vocabulary.

## 7. What this phase does NOT settle

These items are intentionally left open and belong to the next
context-architecture phase:

- Semantic retrieval / embedding-based ranking of context layers.
- Budget auto-tuning based on trailing token cost.
- Multi-tenant artifact deduplication (content-hash joins).
- Long-tail compact-quality scoring beyond success-rate.
- Archive lifecycle (A8+ storage threshold freeze owns this).

These are captured as `open hypotheses` in
`docs/eval/after-skeleton-storage-evidence-report.md §6`.
