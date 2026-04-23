# Worker Matrix — Current Gate Truth

> **Snapshot date**: `2026-04-23`
> **Revision 3**: `2026-04-23` — integrated pre-worker-matrix final closure / handoff state (see §7 below)
> **Use this file before consuming the rest of the bundle.**

---

## 1. One-line verdict (revised)

**Worker-matrix planning should now start from the pre-worker-matrix final closure and handoff pack. B8 handoff and B9 contract freeze remain stable upstream truths, but the direct gate is no longer “B8 + B9 alone”; it is “after-foundations completed → pre-worker-matrix closed → worker-matrix rewrite r2”.**

---

## 2. What is stable enough to plan against

### 2.1 B8 handoff and B9 freeze remain valid upstream inputs

The following are still good upstream planning inputs:

1. `B8-phase-1-closure.md` as the consolidated truth inventory
2. `after-foundations-to-worker-matrix.md` as the main handoff memo
3. `next-phase-worker-naming-proposal.md` as the naming seed
4. `wrangler-worker.toml` and `composition-factory.ts` as starter shapes
5. `docs/issue/after-foundations/B9-final-closure.md` as the reconciled contract-freeze closure

### 2.2 worker-matrix architecture evaluations remain useful

The GPT / Opus worker-matrix evaluations and the `smind-contexter` learnings are still direct design inputs for:

- first-wave worker boundaries
- host vs remote worker split
- `context.core` scope and timing
- `skill.core` reservation posture

### 2.3 pre-worker-matrix is now the authoritative downstream handoff pack

The new direct planning pack is:

1. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
2. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
3. `docs/issue/pre-worker-matrix/W5-closure.md`
4. `docs/issue/pre-worker-matrix/W4-closure.md`

---

## 3. What was not yet stable — and is now repaired

The 2026-04-21 first-pass snapshot of this meta-doc flagged three B9 correctness items as blockers/high. **All three have been materially repaired in-place** via the B9 review §6 response. The original findings and their current status:

| original finding | severity | status as of rev 2 | repaired how |
|---|---|---|---|
| `NanoSessionDO.acceptClientFrame()` wires `verifyTenantBoundary()` as fire-and-forget — tenant violation recorded but dispatch still runs | blocker | **fixed** | `acceptClientFrame` changed to `async`; `await verifyTenantBoundary(...)`; boundary failure converted to typed `IngressEnvelope` rejection; `webSocketMessage`'s `if (!envelope.ok) return;` now actually gates dispatch. Negative-case test `test/tenant-plumbing-contract.test.mjs` ("tenant violation blocks dispatch") added to lock behavior. |
| `wrapAsError()` cannot produce a legal per-verb error envelope for the advertised request-to-error flow under 1.3 surface | high | **fixed via scope narrow + API upgrade** | Helper explicitly labeled **provisional** across JSDoc / RFC §3.1 / CHANGELOG / closure. Added `NACP_ERROR_BODY_VERBS: ReadonlySet<string>` registry (empty at B9; populated by migration PR). Added `WrapAsErrorOverrides.target_message_type` override so callers can target the response verb. Two new root tests lock honest reality: registry-empty + "output NOT yet valid under 1.3 surface." |
| `packages/nacp-session/README.md` still carries one stale Core-owned phase-gate statement | low | **fixed** | README §"Relationship to NACP-Core" rewritten to state session owns its own `SESSION_PHASE_ALLOWED` matrix; only imports `SessionPhase` *type* from Core. |

For full integration response, see `docs/code-review/after-foundations/B9-reviewed-by-GPT.md` §6 and `docs/issue/after-foundations/B9-final-closure.md` §8.

---

## 4. Practical reading law for this bundle

Use the following precedence:

1. **latest review truth**
2. **then action-plan intent**
3. **then older closure posture**

In practice, that means:

| topic | use this as current truth | do not blindly inherit |
|---|---|---|
| direct worker-matrix rewrite input | `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md` + `docs/handoff/pre-worker-matrix-to-worker-matrix.md` + this file | the deprecated `docs/plan-worker-matrix.md` r1 banner text alone |
| B8 worker-matrix handoff ancestry | `01-b8-handoff/*` | scattered older phase docs |
| B9 contract freeze readiness | `02-b9-contract/B9-reviewed-by-GPT.md` §6 response + `docs/issue/after-foundations/B9-final-closure.md` §8 (revision) | B9 review §1-5 without the §6 integration |
| overall stage-chain readiness | this file rev 3 + pre-worker final closure/handoff + B9 post-integration closure | the old direct “after-foundations → worker-matrix Phase 0 OPEN” wording |

---

## 5. What worker matrix should do with this (revised)

1. Start charter/design from the pre-worker handoff memo and final closure, not from the deprecated r1 worker charter.
2. Consume B8/B9 as **upstream shipped truth** through that pack — especially the reconciled session/core contract, tenant-boundary gating, and naming/binding ancestry.
3. The `wrapAsError()` helper is **provisional** — do NOT rely on it producing a valid envelope for existing verbs until the per-verb migration PR (RFC §3.3) lands.
4. Use the W3 absorption map + representative blueprints as the first concrete execution baseline for Tier B absorption.
5. Use W4 shells as already-materialized topology; `agent-core` real preview deploy proves one live shell path, while the other three remain honest dry-run shells.
6. Keep the dual import reality explicit: published `@haimang/*` exists, and `workspace:*` remains a legal interim path until worker-matrix chooses its cutover milestone.

---

## 6. Revision 2 provenance (2026-04-21)

This revision was triggered by the Opus context-space review at `docs/eval/worker-matrix/context-space-examined-by-opus.md` §6 "Patch-1", which identified that the first-pass snapshot of this meta-doc had become stale relative to:

1. The B9 review integration response at `docs/code-review/after-foundations/B9-reviewed-by-GPT.md` §6
2. The B9 final closure revision at `docs/issue/after-foundations/B9-final-closure.md` top-of-file + §8
3. The per-worker `index.md` files, which already reflected the post-fix state

The underlying asymmetry — meta-doc lagging per-worker docs — is tracked as a future curation risk. Any subsequent per-worker doc update must synchronize this meta-doc in the same PR.

---

## 7. Revision 3 provenance (2026-04-23)

This revision was triggered by W5 closure and handoff, which converted pre-worker-matrix from an active gating phase into a closed predecessor stage. The concrete inputs are:

1. `docs/issue/pre-worker-matrix/pre-worker-matrix-final-closure.md`
2. `docs/handoff/pre-worker-matrix-to-worker-matrix.md`
3. `docs/issue/pre-worker-matrix/W5-closure.md`
4. `docs/issue/pre-worker-matrix/W4-closure.md`
5. `docs/plan-worker-matrix.md` top-of-file state flip to `needs-rewrite-r2`

The key meta change is simple: B8/B9 remain upstream truth, but worker-matrix should no longer read them as the *direct* kickoff gate. Pre-worker-matrix is now the immediate predecessor stage and must mediate that handoff.
