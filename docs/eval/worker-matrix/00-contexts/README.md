# Worker Matrix Context Bundle

> **Status**: `curated rewrite-input bundle`
> **Purpose**: provide the single reading surface to use **before** rewriting `docs/plan-worker-matrix.md` r2
> **Last refreshed**: `2026-04-23`

---

## What this folder is now

This directory is no longer a B8/B9-only snapshot.

It is now the **worker-matrix rewrite bundle** built around three layers:

1. **direct truth** — pre-worker-matrix W0-W5 closure / handoff + current code reality
2. **upstream ancestry** — B8/B9 constraints that still matter, but are no longer the direct kickoff gate
3. **architecture reasoning** — evaluations, worker indexes, and starter templates

The key shift is simple:

> worker-matrix r2 must start from **pre-worker-matrix closure and handoff**, not from old B8/B9 copies alone.

---

## Direct inputs you should treat as authoritative

Read these first, even when the files live outside this folder:

1. `00-current-gate-truth.md`
2. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
3. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
4. `03-evaluations/current-worker-reality.md`
5. `docs/design/pre-worker-matrix/W3-absorption-map.md`
6. `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`
7. `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`
8. `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`
9. `docs/issue/pre-worker-matrix/W4-closure.md`

Then consume detailed raw-material docs outside `00-contexts` as secondary reading:

10. `docs/eval/worker-matrix/index.md`
11. `docs/eval/worker-matrix/agent-core/index.md`
12. `docs/eval/worker-matrix/bash-core/index.md`
13. `docs/eval/worker-matrix/context-core/index.md`
14. `docs/eval/worker-matrix/filesystem-core/index.md`
15. `docs/eval/worker-matrix/cross-worker-interaction-matrix.md`
16. `docs/eval/worker-matrix/worker-readiness-stratification.md`
17. `docs/eval/worker-matrix/skill-core-deferral-rationale.md`
18. `docs/eval/worker-matrix/context-space-examined-by-opus.md`

---

## What the subfolders now mean

| path | role now | how to use it |
|---|---|---|
| `00-current-gate-truth.md` | entry verdict + reading law | always read first |
| `01-b8-handoff/` | **after-foundations ancestry summaries** | use for carried platform law, not as the direct kickoff pack |
| `02-b9-contract/` | **B9 contract ancestry summaries** | use for immutable contract background, not as the current stage gate |
| `03-evaluations/` | **current reasoning pack** | use for current worker reality + what still survives from GPT / Opus / Contexter analysis |
| `04-templates/` | starter shapes | use only after direct truth and current code reality are already understood |

---

## Recommended reading order

1. `00-current-gate-truth.md`
2. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
3. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
4. `03-evaluations/current-worker-reality.md`
5. `docs/eval/worker-matrix/index.md`
6. the 4 worker `index.md` files under `docs/eval/worker-matrix/`
7. `docs/design/pre-worker-matrix/W3-absorption-map.md`
8. the 3 representative W3 blueprints
9. `01-b8-handoff/*`
10. `02-b9-contract/*`
11. `03-evaluations/worker-matrix-eval-with-GPT.md`
12. `03-evaluations/worker-matrix-eval-with-Opus.md`
13. `03-evaluations/smind-contexter-learnings.md`
14. `04-templates/*`

---

## Bundle policy

1. **Direct pre-worker truth beats ancestry.**
2. **Current code truth beats old conclusion wording.**
3. **`00-contexts` is the refreshed condensed truth layer for r2 rewrite.**
4. The refreshed worker packs and refreshed root-level derived docs under `docs/eval/worker-matrix/` are usable raw material, but historical ancestry files still follow the reading-law precedence above.
5. If `plan-worker-matrix.md` r2 changes the active execution posture later, refresh this folder in the same PR rather than letting it drift again.
