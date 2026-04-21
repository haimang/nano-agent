# After-Foundations Final Closure

> **Status**: `closed` ✅
> **Closed**: 2026-04-20
> **Owner**: GPT-5.4
> **Next phase enabled**: worker-matrix charter design

---

## 0. One-sentence verdict

After-foundations is closed: B1-B7 established the packages, contracts, spikes, and live evidence; B8 turned that distributed truth into a worker-matrix-ready handoff pack. The only open items left are the two explicit owner/platform gates (`F03`, `F09`).

---

## 1. Phase verdict table

| phase | verdict at final exit | primary closure basis |
|---|---|---|
| B1 | `ready-with-fixes`, fully consumed downstream | `docs/issue/after-foundations/B1-final-closure.md` |
| B2 | shipped | `@nano-agent/storage-topology` `2.0.0` + B2 action-plan log |
| B3 | shipped | `@nano-agent/capability-runtime` current code/tests + B3 action-plan log |
| B4 | shipped | `@nano-agent/context-management` `0.1.0` + root/E2E reality |
| B5 | shipped | `@nano-agent/hooks` `0.2.0` + hook contract tests |
| B6 | shipped/reconciled | `nacp-core` / `nacp-session` stayed at `1.1.0`; sink/inspector contract hardened |
| B7 | `closed-with-evidence` | `docs/issue/after-foundations/B7-final-closure.md` |
| B8 | `closed` | `docs/issue/after-foundations/B8-final-closure.md` |

Interpretation:

- B1 was the disposable truth-probe foundation.
- B2-B6 were the shipped substrate phases.
- B7 was the integrated Cloudflare evidence gate.
- B8 was the worker-matrix handoff phase.

---

## 2. Artifact inventory (grouped)

| artifact family | count | representative paths |
|---|---|---|
| shipped package roots used by the handoff | 9 | `packages/storage-topology/`, `packages/context-management/`, `packages/session-do-runtime/` |
| B1 per-finding docs | 15 | `docs/spikes/spike-do-storage/*.md`, `docs/spikes/spike-binding-pair/*.md`, `docs/spikes/unexpected/*.md` |
| B1 rollup / discipline / handoff / final docs | 13+ | `docs/spikes/*-findings.md`, `_DISCIPLINE-CHECK.md`, `docs/issue/after-foundations/B1-*.md` |
| B7 closure docs | 4 | `docs/issue/after-foundations/B7-phase-{1,2,3}-closure.md`, `B7-final-closure.md` |
| B8 handoff / template / closure docs | 8 | `docs/handoff/*`, `docs/templates/{wrangler-worker.toml,composition-factory.ts}`, `docs/issue/after-foundations/B8-*.md` |
| round-2 deployed workers | 3 | `nano-agent-spike-do-storage-r2`, `nano-agent-spike-binding-pair-a-r2`, `nano-agent-spike-binding-pair-b-r2` |
| round-2 raw evidence files | 10+ | `spikes/round-2-integrated/**/*.out/*` |
| major GPT/Opus review artifacts | 4 rounds | B1 dual-track audit, `B5-B6-reviewed-by-GPT.md`, `B7-reviewed-by-GPT.md`, `B8-docs-reviewed-by-opus.md` |

Grouped total is comfortably above the “40+ artifacts” threshold the B8 plan wanted to capture.

---

## 3. Final finding state

| outcome bucket | count | members |
|---|---|---|
| `writeback-shipped` with live evidence | 11 | F01, F02, F04, F05, F07, F08, binding-F01, binding-F02, binding-F03, binding-F04, unexpected-F01 |
| `dismissed-with-rationale` | 2 | F06, unexpected-F02 |
| `still-open` owner/platform gates | 2 | F03 cross-colo KV, F09 high-volume curl |
| `integrated-F*` new bug family | 0 | none |

Hard handoff rule:

> Worker matrix may proceed, but it must keep the two open gates visible rather than silently inheriting assumptions from same-colo KV or ownerless curl stress.

Additional handoff-time inventory that is **not** a B1/B7 finding, but must remain visible:

- `tenant-wrapper-plumbing` = `shipped-but-unused` at after-foundations exit (`verifyTenantBoundary` / `tenantDoStorage*` exist, but current host runtime has not wired them yet).

---

## 4. Review outcome summary

| review | original verdict | final after-foundations interpretation |
|---|---|---|
| B1 code/docs audit | B1 downgraded to `ready-with-fixes` | caveats were recorded and the real round-2 follow-ups were consumed by B7 |
| B5-B6 review | `changes-requested` | findings closed before B7 entry (`BoundedEvalSink`, `Setup/SessionStart`, permission carriers, inspector contract note) |
| B7 review | `changes-requested` | B8 handoff consumes only the conservative subset proven by current code + current `.out` evidence |
| B8 docs review (Opus) | `changes-requested` | `R1–R7` were absorbed into the current handoff pack; the remaining blocker is the proposed B9 nacp-1.3 freeze, not an unresolved B8-doc gap |

Net result:

- no shipped-package blocker remains open at after-foundations exit;
- only the two explicit owner/platform gates remain open as findings;
- one additional handoff inventory item remains visible: `tenant-wrapper-plumbing` is shipped-but-unused;
- worker-matrix Phase 0 should still wait for the proposed B9 nacp-1.3 freeze.

---

## 5. LIVE deploy inventory

| worker | URL | Version ID |
|---|---|---|
| `nano-agent-spike-do-storage-r2` | `https://nano-agent-spike-do-storage-r2.haimang.workers.dev` | `c8e53de7-db35-45a5-955a-6598db49bc6f` |
| `nano-agent-spike-binding-pair-b-r2` | `https://nano-agent-spike-binding-pair-b-r2.haimang.workers.dev` | `72b4a2d0-89f5-4ab7-9057-e3c2e39b5f48` |
| `nano-agent-spike-binding-pair-a-r2` | `https://nano-agent-spike-binding-pair-a-r2.haimang.workers.dev` | `72c7ecd5-cf24-4597-912b-d2039797e55e` |

Worker-matrix-consumable numbers frozen at exit:

- DO safe planning cap: **2,097,152 bytes**
- DO measured last-good: `2,199,424`
- R2 parallel put safe default: **50**
- cross-worker abort propagation: **native**
- `BoundedEvalSink` cross-worker dedup/overflow push path: **validated**
- `x-nacp-*` binding headers: **lowercased**

---

## 6. Readiness statement for worker matrix

Worker-matrix charter work may start **now**; worker-matrix **Phase 0** is now unblocked — B9 shipped on 2026-04-21 and the nacp-1.3 contract surface is frozen. The next phase should keep these six constraints explicit:

1. do not treat `agent.core` as a binding slot;
2. do not silently reopen B2-B9 substrate decisions already frozen by shipped packages and live evidence;
3. do not erase the two open gates (`F03`, `F09`);
4. start from the B8 handoff pack + B9 final closure, not from scattered phase docs;
5. consume the B9-shipped `NACP_CORE_TYPE_DIRECTION_MATRIX` + `NACP_SESSION_TYPE_DIRECTION_MATRIX` + `SessionStartInitialContextSchema` + `NanoSessionDO` tenant plumbing as **immutable truth** unless a new RFC is opened;
6. design `agent.core` as an orchestrator-ready runtime that consumes upstream `session.start.body.initial_context` rather than re-owning user-memory / intent-routing concerns.

Recommended kickoff inputs:

- `docs/issue/after-foundations/B8-phase-1-closure.md`
- `docs/handoff/after-foundations-to-worker-matrix.md`
- `docs/handoff/next-phase-worker-naming-proposal.md`
- `docs/templates/wrangler-worker.toml`
- `docs/templates/composition-factory.ts`

---

## 7. Final exit verdict

**✅ After-foundations closed.**

This phase did what it needed to do:

1. it shipped the substrate,
2. it validated the platform-shaped seams,
3. it kept the unresolved platform/owner gates honest,
4. and it left the next phase with a readable, evidence-backed starting point rather than another archaeology exercise.
