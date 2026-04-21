# Worker Matrix Context Bundle

> **Status**: `curated context bundle`
> **Purpose**: provide a single, worker-matrix-focused context surface built from the B8/B9 output stack
> **Last curated**: `2026-04-21`

---

## What this folder is

This directory is the **planning bundle** for the worker-matrix phase.

It does **not** replace the original phase documents under:

- `docs/action-plan/after-foundations/`
- `docs/code-review/after-foundations/`
- `docs/issue/after-foundations/`
- `docs/handoff/`
- `docs/templates/`

Instead, it collects the subset that should be read together when drafting worker-matrix charter, boundaries, and first-wave implementation.

The goal is simple:

> stop treating B8/B9 as an archaeology problem, and give worker-matrix one directory that already contains the relevant input set.

---

## Current gate truth

Read this first:

1. `00-current-gate-truth.md`

Short version:

1. **B8 handoff material is valid and should be used.**
2. **B9 is still a live contract precondition, but the latest GPT implementation review says it is not actually closed yet.**
3. **Therefore this bundle includes B9 action-plan + both GPT reviews, and treats the latest review as the current truth over older closure posture.**

Two historical docs are intentionally **not copied** into this bundle as planning truth inputs:

| doc | why it is not part of the bundle core |
|---|---|
| `docs/issue/after-foundations/B9-final-closure.md` | current implementation review says B9 is not yet honestly closed |
| `docs/issue/after-foundations/after-foundations-final-closure.md` | parts of its worker-matrix readiness wording now overstate B9 reality |

They remain useful as historical record, but not as the clean entry surface for next-phase planning.

---

## Recommended reading order

1. `00-current-gate-truth.md`
2. `01-b8-handoff/B8-phase-1-closure.md`
3. `01-b8-handoff/after-foundations-to-worker-matrix.md`
4. `01-b8-handoff/next-phase-worker-naming-proposal.md`
5. `02-b9-contract/B9-plan-reviewed-by-GPT.md`
6. `02-b9-contract/B9-nacp-1-3-contract-freeze.md`
7. `02-b9-contract/B9-reviewed-by-GPT.md`
8. `03-evaluations/worker-matrix-eval-with-GPT.md`
9. `03-evaluations/worker-matrix-eval-with-Opus.md`
10. `03-evaluations/smind-contexter-learnings.md`
11. `04-templates/wrangler-worker.toml`
12. `04-templates/composition-factory.ts`

---

## Directory map

| path | contents | role in worker-matrix planning |
|---|---|---|
| `00-current-gate-truth.md` | current readiness posture and caveats | entry verdict |
| `01-b8-handoff/` | B8 truth inventory, handoff memo, naming proposal | handoff baseline |
| `02-b9-contract/` | B9 action-plan plus GPT plan/implementation reviews | contract freeze and current blockers |
| `03-evaluations/` | GPT/Opus worker-matrix evaluations and smind contexter learnings | architecture reasoning |
| `04-templates/` | wrangler and composition templates | starting shapes |

---

## Bundle policy

1. Treat this folder as the **SSOT-style planning bundle** for worker-matrix kickoff.
2. Treat the original source files as the **historical audit trail**.
3. If B9 blockers are fixed later, refresh this bundle deliberately rather than silently relying on old copies.
