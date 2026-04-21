# Worker Matrix — Current Gate Truth

> **Snapshot date**: `2026-04-21`
> **Revision 2**: `2026-04-21` — synced to post-B9-review-integration state (see §6 below)
> **Use this file before consuming the rest of the bundle.**

---

## 1. One-line verdict (revised)

**Worker-matrix planning may now use both B8 handoff AND B9 contract freeze as stable planning inputs. The three B9 correctness findings raised in the 2026-04-21 GPT review have been materially repaired and are closed as of this revision.**

---

## 2. What is stable enough to plan against

### 2.1 B8 handoff remains valid

The following are still good planning inputs:

1. `B8-phase-1-closure.md` as the consolidated truth inventory
2. `after-foundations-to-worker-matrix.md` as the main handoff memo
3. `next-phase-worker-naming-proposal.md` as the naming seed
4. `wrangler-worker.toml` and `composition-factory.ts` as starter shapes

### 2.2 worker-matrix architecture evaluations remain useful

The GPT / Opus worker-matrix evaluations and the `smind-contexter` learnings are still direct design inputs for:

- first-wave worker boundaries
- host vs remote worker split
- `context.core` scope and timing
- `skill.core` reservation posture

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
| B8 worker-matrix handoff | `01-b8-handoff/*` | scattered older phase docs |
| B9 contract freeze readiness | `02-b9-contract/B9-reviewed-by-GPT.md` §6 response + `docs/issue/after-foundations/B9-final-closure.md` §8 (revision) | B9 review §1-5 without the §6 integration |
| overall after-foundations readiness | this file + B8 handoff + B9 post-integration closure | the original `B9-final-closure.md` wording that predates the §8 revision |

---

## 5. What worker matrix should do with this (revised)

1. Start charter/design from the B8 handoff pack.
2. Consume B9 contract freeze as **shipped** — the 2026-04-21 review findings are closed; matrix validation (Core + Session), tenant plumbing (now `await`ed), `initial_context` wire shape, and provisional `wrapAsError()` helper are all stable.
3. The `wrapAsError()` helper is **provisional** — do NOT rely on it producing a valid envelope for existing verbs until the per-verb migration PR (RFC §3.3) lands.
4. Use the evaluation docs to decide first-wave worker boundaries; use the per-worker `docs/eval/worker-matrix/{agent,bash,context,filesystem}-core/index.md` as the SSOT on each worker's current code truth.

---

## 6. Revision 2 provenance (2026-04-21)

This revision was triggered by the Opus context-space review at `docs/eval/worker-matrix/context-space-examined-by-opus.md` §6 "Patch-1", which identified that the first-pass snapshot of this meta-doc had become stale relative to:

1. The B9 review integration response at `docs/code-review/after-foundations/B9-reviewed-by-GPT.md` §6
2. The B9 final closure revision at `docs/issue/after-foundations/B9-final-closure.md` top-of-file + §8
3. The per-worker `index.md` files, which already reflected the post-fix state

The underlying asymmetry — meta-doc lagging per-worker docs — is tracked as a future curation risk. Any subsequent per-worker doc update must synchronize this meta-doc in the same PR.
