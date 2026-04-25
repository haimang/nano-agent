# Zero-to-Real → Next-Phase handoff memo

> **Status**: `handoff-ready`
> **Owner**: `GPT-5.4`
> **Primary source of truth**: `docs/issue/zero-to-real/zero-to-real-final-closure.md`
> **Scope**: zero-to-real closeout only

---

## §1 What the next phase may assume now

| assumption | current truth | why it is safe to rely on |
| --- | --- | --- |
| public auth/session owner | `workers/orchestrator-core` | current live/public suites and preview smoke already run through it |
| auth owner | `workers/orchestrator-auth` internal-only pure RPC worker | `orchestrator-core` already calls `env.ORCHESTRATOR_AUTH.*`; no public business route is required |
| runtime host | `workers/agent-core` | live runtime/quota/Workers AI path is already assembled there |
| tool posture | `workers/bash-core` governed fake-bash worker | real package/cross-e2e already exercise happy-path/cancel/error roundtrips |
| durable baseline | shared D1 identity + session + usage tables | preview live path now leaves queryable anchor rows in D1 |
| client baseline | `clients/web` + `clients/wechat-miniprogram` first-wave real-client scaffolding | both already target the real auth/session/ws/timeline façade surfaces |
| evidence baseline | local matrix + live preview smoke + D1 SQL spot-check | Z5 closeout revalidated all three layers before writing final closure |

---

## §2 Files to read before starting the next charter

Read these in order:

1. `docs/issue/zero-to-real/zero-to-real-final-closure.md`
2. `docs/issue/zero-to-real/Z5-closure.md`
3. `docs/issue/zero-to-real/Z4-closure.md`
4. `docs/eval/zero-to-real/first-real-run-evidence.md`
5. `docs/design/zero-to-real/ZX-qna.md`
6. `docs/issue/zero-to-real/Z3-closure.md`
7. `docs/issue/zero-to-real/Z2-closure.md`

Use the older Z0-Z4 action-plans as ancestry, not as the primary truth pack.

---

## §3 Inherited backlog in recommended order

The following order comes from the terminal Z4/Z5 review triage and was revalidated against the current 6-worker code plus closeout evidence.

| priority | item | current posture | expected landing zone |
| --- | --- | --- | --- |
| 1 | dead `deploy-fill` enum/type cleanup | public auth ingress no longer mints it, but downstream acceptance still exists | auth/compliance cleanup |
| 2 | DO websocket heartbeat platform alignment | current 15s heartbeat works, but timer lifecycle remains pragmatic rather than ideal | transport/runtime hardening |
| 3 | `session.resume` body actually parsed / wire shape unified | replay truth currently depends mainly on `last_seen_seq`; resume body should stop being semantic dead weight | transport/runtime hardening |
| 4 | tool registry single source of truth | current guard is name-level only between `agent-core` and `bash-core` | tool/runtime hardening |
| 5 | client package extraction / JS shim | current web and Mini Program helpers are wire-compatible copies | client/runtime shared contract |
| 6 | manual browser + Mini Program evidence | code baseline exists, but no browser/devtools/real-device closeout evidence exists yet | client hardening / product proof |
| 7 | snapshot stream vs continuous push decision | current WS posture is closer to replay/timeline snapshot than token-level live stream | stream-plane charter |
| 8 | quota typed team-missing hardening | preview escape hatch still exists for bootstrap gaps | quota/bootstrap hardening |

These are **not** zero-to-real blockers anymore. They are the first curated inputs for the next phase.

---

## §4 Operational disciplines to keep

1. **Keep `orchestrator-core` as the only public auth/session façade.** Do not reopen secondary public routes on `agent-core` or `orchestrator-auth`.
2. **Keep `orchestrator-auth` internal-only and RPC-shaped.** Do not slide back to public auth convenience endpoints.
3. **Keep D1 write ownership disciplined.** Session/activity truth belongs to the orchestrator-side durable layer; do not let `agent-core` drift back into direct session-activity writes.
4. **Keep `TEAM_UUID` explicit and preview seeding opt-in only.** Do not let preview bootstrap shortcuts masquerade as steady-state runtime truth.
5. **Keep WS query-token usage compatibility-only.** It exists for constrained clients, not as a general bearer transport pattern.
6. **Keep evidence honest.** If a future closure only has automated smoke, say so; do not relabel it as manual client proof.

---

## §5 Recommended next starting point

The most natural follow-up is **not** to reopen zero-to-real itself. It is to start a new charter that treats zero-to-real as a stable substrate and chooses one focused direction:

1. transport/runtime hardening (`heartbeat`, `resume`, stream semantics, registry SSoT)
2. client hardening (shared shim, browser/devtools/manual evidence, richer UX)
3. quota/bootstrap/compliance cleanup (`deploy-fill` residue, team bootstrap discipline)

Whichever direction is chosen, it should consume zero-to-real as a closed baseline rather than reopening the “first real run” question.
