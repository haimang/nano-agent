# B7 Phase 1 Closure — Preflight + verdict freeze

> **Status**: `closed`
> **Closed**: 2026-04-20
> **Owner**: Claude Opus 4.7 (1M context)
> **Input docs**: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` §4.1

## What this phase decided

Phase 1 froze the single-source-of-truth for Round 2 before any
worker code or probe was written, so the rest of B7 could execute
without口径 drift.

### P1-01 — input alignment

- `B1-final-closure.md` + `B1-handoff-to-B2-B6.md` read for the
  canonical status of Round-1 findings.
- `P6-spike-round-2-integration-plan.md` §P6 read for the
  7-item follow-up list.
- B2–B6 action plans + CHANGELOGs read to confirm which seams are
  ship-stable vs. still evolving.
- Round-1 `spikes/round-1-bare-metal/` tree surveyed to mirror
  structure faithfully (readable diff between the two rounds).

### P1-02 — verdict vocabulary freeze

Three verdicts allowed in Round-2 closure sections:

| verdict | when used |
|---|---|
| `writeback-shipped` | shipped seam is present AND probe path validates Round-1 truth |
| `dismissed-with-rationale` | finding is not actionable; rationale cites platform/account property that shipped code already contracts to |
| `still-open` | gate unmet OR live evidence still pending; NEVER used to quietly close a gated item |

### P1-03 — naming / resource isolation freeze

Round 2 uses the `-r2` suffix on worker names and `-r2` suffix on
every KV / R2 / D1 / DO class name. Round 1 artefacts are never
overwritten.

## Preflight artefacts

- `pnpm -r run typecheck` — 11/11 packages clean.
- `pnpm -r run test` — all shipped packages green (357 session-do-
  runtime + 352 capability-runtime + 198 hooks + 208 eval-
  observability + 97 context-management + others).
- Root contract tests: 77/77 (72 baseline + 5 new B7 local-sim).

## What this phase did NOT do

- Did not write any probe code (that's Phase 2 / 3 / 4).
- Did not modify any shipped package during B7 itself. The
  package-level fixes in `BoundedEvalSink` / `SessionOrchestrator` /
  `CapabilityExecutor` / `SessionInspector` were PRE-ENTRY work from
  the B5-B6 review, documented in B7 §11 and done before B7 Phase 1
  started. They're the reason B7 was allowed to enter, not a B7
  side-effect.

## Exit criteria — met

- [x] follow-up count fixed at 7
- [x] verdict vocabulary frozen
- [x] naming + resource isolation frozen
- [x] preflight green across all shipped packages
