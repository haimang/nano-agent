# After-Foundations → Worker-Matrix handoff memo

> **Status**: `handoff-ready` ✅
> **Owner**: GPT-5.4
> **Primary source of truth**: `docs/issue/after-foundations/B8-phase-1-closure.md`
> **Scope**: B8 handoff only — no `packages/` or `spikes/` code changes

---

## §1 Phase Summary

| phase | current verdict used for handoff | primary evidence |
|---|---|---|
| B1 | `ready-with-fixes`, then consumed by B2-B8 | `docs/issue/after-foundations/B1-final-closure.md` |
| B2 | shipped | `@nano-agent/storage-topology` `2.0.0`, B2 action-plan log |
| B3 | shipped | `@nano-agent/capability-runtime` current code + B3 action-plan log |
| B4 | shipped | `@nano-agent/context-management` `0.1.0`, root/E2E tests |
| B5 | shipped | `@nano-agent/hooks` `0.2.0`, root contract tests |
| B6 | shipped | `nacp-core` / `nacp-session` reconciliation + `BoundedEvalSink` / `SessionInspector` hardening |
| B7 | `closed-with-evidence` | `docs/issue/after-foundations/B7-final-closure.md` |
| B8 | handoff closure | this memo + naming proposal + 2 templates + closure docs |

**Executive summary**

1. The after-foundations phase did **not** try to build the worker matrix itself.
2. It shipped the substrate packages, ran two rounds of Cloudflare-shaped validation, and turned the results into a deploy-shaped handoff pack.
3. Worker-matrix charter work may start from this memo plus `docs/issue/after-foundations/after-foundations-final-closure.md` without re-reading B1-B7 line-by-line.

---

## §2 What's Validated

The six handoff findings below are the platform-shaped truths worker matrix can safely build on.

| finding | one-line summary | Round-2 verdict | worker-matrix usage | caveats |
|---|---|---|---|---|
| `F01` | R2 single-part put remains sufficient for the validated artifact sizes | `writeback-shipped` | filesystem/core artifact upload path can start from `R2Adapter.put` rather than inventing multipart | still size-check at the app layer for routing decisions |
| `F04` | DO storage transaction contract is real | `writeback-shipped` | context/core committer and agent/core session checkpoint paths can rely on DO transaction semantics | keep D1 and DO contracts separate |
| `F05` | Memory-vs-DO basic K/V parity is good enough for structural reasoning | `writeback-shipped` | local simulation mental model stays usable for basic storage traces | treat this as **basic K/V parity**, not a full production equivalence theorem |
| `F07` | conservative 12-pack fake-bash surface still holds in worker reality | `writeback-shipped` | bash/core can begin from the shipped command pack instead of reopening B3 | high-volume curl remains gated by `F09` |
| `binding-F01` | service binding remains low-latency and live cancellation is native | `writeback-shipped` | cross-worker call budgeting for first-wave workers | latency baseline comes from B1; live callee abort proof comes from B7 |
| `binding-F03` | cross-worker hook dispatch stays viable and low-latency | `writeback-shipped` | hook fan-out / event governance can remain off the host worker | hook path viability does **not** justify reopening catalog scope beyond shipped events |

Additional validated truths that matter in practice, even though they are not part of the six-row handoff core:

| finding | why worker matrix should care now | evidence |
|---|---|---|
| `binding-F02` | all `x-nacp-*` anchor headers are lowercased on binding seams | `docs/issue/after-foundations/B8-phase-1-closure.md` §4 |
| `binding-F04` | `BoundedEvalSink` dedup + overflow disclosure is proven on the real cross-worker push path | `docs/issue/after-foundations/B8-phase-1-closure.md` §4 |
| `F08` | DO value cap is no longer a vague 1–10 MiB bracket; B8 has a concrete safe number | `docs/issue/after-foundations/B8-phase-1-closure.md` §4 |
| `unexpected-F01` | R2 parallel put now has an evidence-backed safe default of `50` | `docs/issue/after-foundations/B8-phase-1-closure.md` §4 |

---

## §3 What's Shipped

| package | current version | why worker matrix cares |
|---|---|---|
| `@nano-agent/storage-topology` | `2.0.0` | real `R2Adapter` / `KvAdapter` / `D1Adapter` / `DOStorageAdapter` substrate |
| `@nano-agent/capability-runtime` | `0.1.0` | fake-bash, typed execution layer, policy gate, local target |
| `@nano-agent/context-management` | `0.1.0` | budget policy, async compact orchestrator, inspector facade |
| `@nano-agent/hooks` | `0.2.0` | shipped catalog + dispatcher + audit/session mappings |
| `@nano-agent/nacp-core` | `1.1.0` | transport/envelope/tenancy authority |
| `@nano-agent/nacp-session` | `1.1.0` | stream-event / replay / ack / websocket profile |
| `@nano-agent/eval-observability` | `0.1.0` | session/event inspection and audit substrate |
| `@nano-agent/session-do-runtime` | `0.1.0` | host-worker assembly surface, binding catalog reality, bounded eval sink |
| `@nano-agent/workspace-context-artifacts` | `0.1.0` | workspace/context snapshot substrate consumed by B4/B7 |

Two repo-reality notes worker matrix must keep in mind:

1. `capability-runtime` currently has no package-local CHANGELOG in the repo.
2. `eval-observability` and `session-do-runtime` currently show CHANGELOG heads ahead of `package.json` versions; worker-matrix charter authors should treat `package.json` as the runtime version truth unless a packaging pass changes that.

---

## §4 Hard Contract Requirements

These six rules survive into worker matrix as non-optional substrate law.

| requirement | current shipped proof | worker-matrix implication |
|---|---|---|
| `R2Adapter.list` / `listAll` must honor cursor law | B2 ship + B7 storage re-validation | do not reintroduce v1-style single-page assumptions |
| D1 remains batch/query-only | `D1Adapter` still exposes `query / first / batch / prepare` and nothing else | never invent `BEGIN/COMMIT` client flow in worker shells |
| DO writes require explicit size awareness | `DOStorageAdapter` still keeps a conservative default; B7 added evidence for a higher safe cap | make DO-vs-R2 routing a visible decision in agent/core and context/core |
| cross-worker anchor headers are lowercase | B1 + B7 both confirm it | never key logic on original casing |
| dedup happens on `messageUuid`, not payload body identity | B6 root contract + B7 binding-F04 | any new sink/inspector surface must preserve this law |
| overflow is explicit, not silent | `BoundedEvalSink` emits disclosure and counters | worker-matrix observability must keep overflow visible rather than trimming silently |

---

## §5 Worker Naming Proposal

B8 outputs a proposal doc, not a frozen decision:

- `docs/handoff/next-phase-worker-naming-proposal.md`

Headline proposal:

| proposed name | role | form |
|---|---|---|
| `agent.core` | host worker | session DO’s next assembly form |
| `bash.core` | remote worker | capability-runtime-first execution shell |
| `filesystem.core` | remote worker | storage/workspace-heavy shell |
| `context.core` | remote worker | async compact + inspection shell |
| `skill.core` | reserved only | **not** first-wave; keep as a named reserve |

Rule carried over from P7 and kept explicit in B8:

> **`agent.core` is not a binding slot.** It is the host worker.  
> The future names above are worker-matrix planning inputs, not a retroactive rewrite of the v1 binding catalog.

---

## §6 Binding Catalog Evolution Policy

Current shipped binding reality remains frozen in:

- `packages/session-do-runtime/src/env.ts`
- `packages/session-do-runtime/wrangler.jsonc`

Current v1 catalog:

| current slot | current meaning | B8 policy |
|---|---|---|
| `CAPABILITY_WORKER` | generic remote capability seam | do **not** rewrite it during B8; worker matrix may decide whether `bash.core` / `filesystem.core` remain behind one compatibility slot or trigger a v2 catalog discussion |
| `HOOK_WORKER` | remote hook dispatch seam | keep as current reality; do not pre-split in B8 |
| `FAKE_PROVIDER_WORKER` | remote fake provider seam | keep as current reality; provider shell work is not part of the first-wave naming proposal |
| `SKILL_WORKERS` | reserved slot only | remains reserved; B8 does not consume it into runtime truth |

Operational policy for worker matrix:

1. Treat proposed worker names as **deployment/service names**, not as proof that `V1_BINDING_CATALOG` changed.
2. Keep `agent.core` outside the slot table entirely.
3. If worker matrix decides a v2 binding catalog is needed, that is a next-phase charter decision, not a B8 handoff decision.

---

## §7 Round 2 Closure Verdicts

| finding | Round-1 status | Round-2 verdict | evidence path | carry-over caveat |
|---|---|---|---|---|
| `spike-do-storage-F01` | `open` | `writeback-shipped` | `spike-do-storage-r2/.out/probe_re-validation_storage.json` | none |
| `spike-do-storage-F02` | `open` | `writeback-shipped` | `spike-do-storage-r2/.out/probe_re-validation_storage.json` | caller still owns cursor walking beyond the bounded helper |
| `spike-do-storage-F03` | `open` | `still-open` | `spike-do-storage-r2/.out/probe_follow-ups_kv-cross-colo-stale.json` | do not assume cross-colo read-after-write |
| `spike-do-storage-F04` | `open` | `writeback-shipped` | `spike-do-storage-r2/.out/probe_re-validation_storage.json` | none |
| `spike-do-storage-F05` | `open` | `writeback-shipped` | `spike-do-storage-r2/.out/probe_re-validation_storage.json` | consume as structural parity only |
| `spike-do-storage-F06` | `open` | `dismissed-with-rationale` | `spike-do-storage-r2/.out/probe_re-validation_storage.json` | D1 stays intentionally narrow |
| `spike-do-storage-F07` | `open` | `writeback-shipped` | `spike-do-storage-r2/.out/probe_re-validation_bash.json` | none |
| `spike-do-storage-F08` | `open` | `writeback-shipped` | `spike-do-storage-r2/.out/probe_follow-ups_do-size-cap-binary-search.json` | B8 consumes **2 MiB safe**, not a mandate to patch package defaults immediately |
| `spike-do-storage-F09` | `open` | split verdict | `spike-do-storage-r2/.out/probe_re-validation_bash.json` + `probe_follow-ups_curl-high-volume.json` | conservative path closed; high-volume path still gate-blocked |
| `spike-binding-pair-F01` | `open` | `writeback-shipped` | `worker-a-r2/.out/probe_follow-ups_binding-f01-callee-abort.json` + `worker-b-r2/.out/binding-f01.tail.log` | latency baseline is still taken from B1, cancellation proof from B7 |
| `spike-binding-pair-F02` | `open` | `writeback-shipped` | `worker-a-r2/.out/probe_re-validation_binding.json` | lowercase law is now hard handoff truth |
| `spike-binding-pair-F03` | `open` | `writeback-shipped` | `worker-a-r2/.out/probe_re-validation_binding.json` | treat as viability proof, not a license to widen hook scope blindly |
| `spike-binding-pair-F04` | `open` | `writeback-shipped` | `worker-a-r2/.out/probe_follow-ups_binding-f04-true-callback.json` | B7 closes the round-1 scope caveat with a real push path |
| `unexpected-F01` | `open` | `writeback-shipped` | `spike-do-storage-r2/.out/probe_follow-ups_r2-concurrent-put.json` | safe default = `50` |
| `unexpected-F02` | `open` | `dismissed-with-rationale` | `docs/issue/after-foundations/B7-final-closure.md` §4 | keep treated as a platform property |

---

## §8 Templates Available

| template | purpose | what it deliberately does |
|---|---|---|
| `docs/templates/wrangler-worker.toml` | worker-shell config starter | carries B1/B7 evidence-backed comments for service timeouts, lowercase headers, DO cap, and R2 concurrency |
| `docs/templates/composition-factory.ts` | assembly starter for host/remote worker shells | imports only shipped package exports and keeps the B8 `agent.core` vs remote-worker distinction explicit |

Use these templates as:

1. **starting shapes**, not final production configs;
2. evidence-backed scaffolding, not silent contract decisions;
3. a way to avoid re-learning the B7 probe-side API mistakes in worker matrix phase 1.

---

## §9 Open Issues at Handoff

### 9.1 The only open gates carried forward

| gate | current status | what worker matrix must do |
|---|---|---|
| `F03_CROSS_COLO_ENABLED` | open | keep cross-colo KV read-after-write out of any hard guarantee until owner reruns the probe with a multi-colo profile |
| `F09_OWNER_URL_MISSING` | open | keep conservative curl budget behavior; do not assume high-volume curl has been validated on an owner-approved endpoint |

### 9.2 Owner-side rerun checklist

1. **F03 rerun**
   - supply an account/profile that actually spans 2+ colos
   - run with `F03_CROSS_COLO_ENABLED="true"`
   - capture new `.out` evidence
   - append the new verdict into the original finding §9 closure and the next-phase closure docs
2. **F09 rerun**
   - supply `F09_OWNER_URL`
   - rerun the high-volume curl follow-up against that URL
   - capture new `.out` evidence
   - update the original finding §9 closure and downstream phase closure docs

### 9.3 Review carry-over posture

- `B5-B6-reviewed-by-GPT.md` findings were explicitly closed by B7 §11.1 pre-entry fixes.
- `B7-reviewed-by-GPT.md` remains a historical review snapshot, but B8 intentionally consumes only the conservative subset now frozen by `B7-final-closure.md` and raw `.out` evidence.
- Therefore **no review-shaped shipped-package blocker** is carried into worker-matrix kickoff beyond the two owner/platform gates above.

---

## §10 Recommended First Phase of Worker Matrix

Recommended start sequence:

1. **Kick off from the closure pair**, not from scattered legacy docs:
   - `docs/issue/after-foundations/after-foundations-final-closure.md`
   - this handoff memo
2. **Keep the current v1 binding catalog unchanged** while drafting the first worker shells.
3. **Treat the four worker names as proposal inputs**:
   - host: `agent.core`
   - remotes: `bash.core`, `filesystem.core`, `context.core`
   - reserve only: `skill.core`
4. **Start agent.core assembly with the shipped substrates already proven by B7**:
   - DO write routing remains explicit
   - R2 safe parallel default remains `50`
   - cross-worker abort propagation is assumed native
   - all `x-nacp-*` binding headers are treated as lowercase
5. **Defer the two owner gates into explicit follow-up work**, not hidden assumptions.

**Bottom line**

Worker matrix should begin as **assembly of validated seams**, not as a second round of exploratory platform discovery.
