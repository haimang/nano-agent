# Pre-Worker-Matrix → Worker-Matrix handoff memo

> **Status**: `handoff-ready` ✅
> **Owner**: `GPT-5.4`
> **Primary source of truth**: `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
> **Scope**: W5 handoff only — no `packages/` or `workers/` code changes

---

## §1 Phase Summary

| phase | verdict used for handoff | primary evidence |
|---|---|---|
| W0 | `closed` | `docs/issue/pre-worker-matrix/W0-closure.md` |
| W1 | `closed` | `docs/issue/pre-worker-matrix/W1-closure.md` |
| W2 | `closed (first publish completed)` | `docs/issue/pre-worker-matrix/W2-closure.md` |
| W3 | `closed (design-heavy; optional dry-run deferred)` | `docs/issue/pre-worker-matrix/W3-closure.md` |
| W4 | `closed (real preview deploy completed)` | `docs/issue/pre-worker-matrix/W4-closure.md` |
| W5 | `closed` | this memo + `docs/issue/pre-worker-matrix/W5-closure.md` |

**Executive summary**

1. Pre-worker-matrix did **not** absorb Tier B packages into the workers.
2. It froze topology, package ownership, import/publish posture, three cross-worker RFC directions, representative absorption blueprints, and the deploy-shaped worker shells.
3. Worker-matrix r2 should start from this memo plus the final closure and current-gate-truth rev 3, not by reopening the old deprecated charter.

---

## §2 What worker-matrix may assume now

| assumption | current truth | why worker-matrix may rely on it |
|---|---|---|
| worker topology | `workers/agent-core`, `workers/bash-core`, `workers/context-core`, `workers/filesystem-core` exist | directory naming and shell ownership are no longer design guesses |
| external package truth | only `@haimang/nacp-core` and `@haimang/nacp-session` are permanent published packages | worker-matrix should absorb Tier B packages instead of treating them as forever-libraries |
| publish posture | GitHub Packages path is real: `@haimang/nacp-core@1.4.0`, `@haimang/nacp-session@1.3.0` | worker-matrix may plan future cutover against a real registry, not a hypothetical one |
| interim dependency posture | `workspace:*` remains legal during first-wave worker assembly | worker-matrix does not need to force published-path cutover in its first absorption PR |
| protocol direction | workspace RPC / remote compact delegate / evidence forwarding are RFC-frozen, not shipped code | worker-matrix must not pretend these remote seams already exist as runtime APIs |
| worker shell baseline | `agent-core` preview deploy is real; other 3 shells are dry-run validated | P0 should fill the existing shells rather than rebuild topology from scratch |

---

## §3 Hard rewrite checklist for `plan-worker-matrix.md` r2

1. Rewrite the opening state from **deprecated awaiting pre-worker close** to **rewrite-required after pre-worker close**.
2. Use `@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` as the published contract baseline.
3. Treat W1 as **RFC-only direction freeze**; do not upgrade workspace RPC / compact delegate / evidence forwarding into “already shipped protocol code”.
4. Treat W3’s absorption map + 3 representative blueprints as the execution baseline for Tier B absorption order.
5. Treat W4’s `workers/*` shells as already materialized; worker-matrix P0 fills `src/` and bindings, not the repository topology.
6. Keep `agent.core` as the host worker and do **not** move it into a binding-slot mental model.
7. Keep `workspace:*` as an allowed interim path until worker-matrix explicitly chooses its published-path cutover milestone.
8. Move all real Tier B absorption, live cross-worker binding activation, and service runtime assembly work into worker-matrix scope; do not back-project them into pre-worker.
9. Make r2 exit criteria about **live assembly reality**: actual absorption, live turn loop, remote seam activation where needed, and published-path/deprecation milestones.

---

## §4 Open items carried forward

| item | current posture at handoff | expected landing zone |
|---|---|---|
| first real absorption order | not yet chosen | worker-matrix r2 + first P0 PR |
| `workspace:*` → published version cutover in worker shells | not yet scheduled | worker-matrix first-wave milestone |
| `BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE` live service bindings in `agent-core` | documented future slots only | worker-matrix integration phase |
| W3 pattern placeholder backfill | waiting for first real absorb | first absorb retrospective |
| Tier B deprecation banners / package removal | intentionally untouched | after corresponding worker absorption proves stable |

---

## §5 Input pack to read before authoring r2

Read these in order:

1. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
2. `docs/issue/pre-worker-matrix/W5-closure.md`
3. `docs/eval/worker-matrix/00-contexts/00-current-gate-truth.md`
4. `docs/design/pre-worker-matrix/W3-absorption-map.md`
5. `docs/design/pre-worker-matrix/W3-absorption-blueprint-capability-runtime.md`
6. `docs/design/pre-worker-matrix/W3-absorption-blueprint-workspace-context-artifacts-split.md`
7. `docs/design/pre-worker-matrix/W3-absorption-blueprint-session-do-runtime.md`
8. `docs/issue/pre-worker-matrix/W4-closure.md`

Use B8/B9 materials as upstream ancestry, not as the direct planning pack:

9. `docs/handoff/after-foundations-to-worker-matrix.md`
10. `docs/issue/after-foundations/B9-final-closure.md`

---

## §6 Final handoff verdict

Worker-matrix may start **rewrite r2 now**.

The important constraint is sequencing:

1. rewrite the charter first,
2. then use W3/W4 artifacts to drive the first absorption and assembly PRs,
3. and only then close the remaining “real runtime” items that pre-worker-matrix intentionally left downstream.
