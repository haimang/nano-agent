# Orchestration-Facade → Next-Phase handoff memo

> **Status**: `handoff-ready`
> **Owner**: `GPT-5.4`
> **Primary source of truth**: `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
> **Scope**: orchestration-facade closeout only

---

## §1 What the next phase may assume now

| assumption | current truth | why it is safe to rely on |
| --- | --- | --- |
| public session owner | `workers/orchestrator-core` | canonical live/public suite and preview deploy already run through it |
| runtime host | `workers/agent-core` | guarded `/internal/*` remains the only downstream runtime ingress |
| authority baseline | explicit `trace_uuid` + JWT/public tenant law + internal no-escalation law | F4 closed with local/live negative evidence |
| tenant posture | `single-tenant-per-deploy + TEAM_UUID` | 5 workers now carry explicit preview vars |
| bash posture | governed capability worker with pre-execute legality seam | runtime path now runs through `CapabilityExecutor`; `beforeCapabilityExecute()` remains the fixed future extension point, but no extra provider is configured yet |
| context/filesystem posture | probe-only library workers | final handoff does not promote them to public façades |

---

## §2 Files to read before starting the next charter

Read these in order:

1. `docs/issue/orchestration-facade/orchestration-facade-final-closure.md`
2. `docs/issue/orchestration-facade/F4-closure.md`
3. `docs/issue/orchestration-facade/F5-closure.md`
4. `docs/plan-orchestration-facade.md`
5. `test/INDEX.md`

Use the older F0-F3 action-plans only as ancestry, not as the primary truth pack.

---

## §3 Open items deliberately carried forward

| item | current posture | expected landing zone |
| --- | --- | --- |
| credit / quota / billing | deliberately out-of-scope for F4 | next auth/budget charter |
| multi-tenant-per-deploy | deliberately deferred | next tenancy charter |
| richer live push stream | current truth remains snapshot-over-NDJSON internal relay | next streaming/runtime charter |
| session lifecycle mapping law | orchestrator persists `last_phase` as audit string, but no formal SessionEntry ↔ agent DO phase matrix is frozen yet | next streaming/runtime charter |
| executor recheck provider | runtime path now goes through `CapabilityExecutor`, but no nontrivial `beforeCapabilityExecute` provider is configured yet | next auth/budget charter |
| context/filesystem public promotion | deliberately not admitted | future topology/product charter |
| new public product surface | not part of orchestration-facade | next charter only |

---

## §4 Operational disciplines to keep

1. **Rotate `NANO_INTERNAL_BINDING_SECRET` as a runtime secret**, not as checked-in config.
2. **Keep `TEAM_UUID` explicit in preview/prod**. Do not treat `_unknown` as an acceptable deployed truth.
3. **When running live orchestrator suites, keep local signing aligned with preview `JWT_SECRET`**.
4. **Do not re-open `agent-core /sessions/*` as a public convenience path**. The typed `410/426` retirement is now part of the contract.
5. **Treat `orchestration-facade-closed` as terminal marker**. `orchestrator-core` and `agent-core` now advertise it; future phases should move to new markers, not reuse F1-F4 ones.
6. **If `agent-core` serves legacy retirement on custom domains, configure `ORCHESTRATOR_PUBLIC_BASE_URL` explicitly** so `canonical_url` does not depend on hostname string replacement.

---

## §5 Recommended starting point for the next phase

The most natural follow-up is **not** “redo orchestration-facade with more features”. It is to start a new charter that clearly chooses one of these directions:

1. authority-domain expansion (`credit/quota/revocation`)
2. richer runtime/streaming semantics
3. broader topology/product expansion

Whichever direction is chosen, it should consume orchestration-facade as a stable substrate rather than reopening its core public-owner decision.
