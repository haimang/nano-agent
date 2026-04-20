# B8 Phase 1 Closure — Truth Inventory + pre-handoff baseline

> **Status**: `closed` ✅
> **Closed**: 2026-04-20
> **Owner**: GPT-5.4
> **Purpose**: single-source-of-truth inventory for B8 Phase 2 / 3 handoff work

---

## 0. One-sentence verdict

Phase 1 is closed: B1-B7 facts are consolidated into one inventory, the current repo/package reality is pinned, B7 LIVE evidence is reduced to worker-matrix-consumable numbers, and the root baseline remains **77/77 + 91/91**.

---

## 1. Scope and input set

This inventory was built from the current repository truth, with B8 consuming:

- `docs/issue/after-foundations/B1-final-closure.md`
- `docs/issue/after-foundations/B1-handoff-to-B2-B6.md`
- `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md`
- `docs/issue/after-foundations/B7-final-closure.md`
- `docs/code-review/after-foundations/B5-B6-reviewed-by-GPT.md`
- `docs/code-review/after-foundations/B7-reviewed-by-GPT.md`
- current `packages/*/package.json`
- current `packages/*/CHANGELOG.md` reality (when present)
- current B7 raw `.out/*.json` / tail-log evidence

Downstream rule for B8:

1. `docs/handoff/after-foundations-to-worker-matrix.md` cites this file as the single inventory source.
2. `docs/templates/*` comments cite this file or the underlying `.out` evidence it references.
3. Any fact not pinned here does **not** get silently promoted into handoff truth.

---

## 2. Shipped packages — current repo reality

> Notes:
> - B8 handoff scope uses the 9 shipped packages explicitly named in the B8 action-plan.
> - `capability-runtime` currently has **no package-local `CHANGELOG.md`** in the repo.
> - `eval-observability` and `session-do-runtime` currently expose a `package.json` version lower than the newest CHANGELOG heading; B8 records that mismatch rather than smoothing it away.

| package | `package.json` version | latest CHANGELOG heading | current note | evidence |
|---|---|---|---|---|
| `@nano-agent/nacp-core` | `1.1.0` | `2026-04-20 — B6 reconciliation (stay at 1.1.0; "1.2.0" RFC closes as no-schema-delta)` | protocol stayed on `1.1.0` after B6 reconciliation | `packages/nacp-core/package.json`, `packages/nacp-core/CHANGELOG.md` |
| `@nano-agent/nacp-session` | `1.1.0` | `2026-04-20 — B6 reconciliation (Outcome A: stay at 1.1.0)` | session protocol also stayed on `1.1.0` | `packages/nacp-session/package.json`, `packages/nacp-session/CHANGELOG.md` |
| `@nano-agent/storage-topology` | `2.0.0` | `2.0.0 — 2026-04-20` | B2 hardening landed as the only major version bump in the pack | `packages/storage-topology/package.json`, `packages/storage-topology/CHANGELOG.md` |
| `@nano-agent/capability-runtime` | `0.1.0` | _no package-local changelog_ | B3/B5/B7 changes are traceable through code, tests, and action-plan logs rather than a package changelog | `packages/capability-runtime/package.json` |
| `@nano-agent/context-management` | `0.1.0` | `0.1.0 — 2026-04-20` | B4 new package shipped | `packages/context-management/package.json`, `packages/context-management/CHANGELOG.md` |
| `@nano-agent/workspace-context-artifacts` | `0.1.0` | `0.1.0 — 2026-04-17` | pre-existing foundation consumed by B4/B7/B8 | `packages/workspace-context-artifacts/package.json`, `packages/workspace-context-artifacts/CHANGELOG.md` |
| `@nano-agent/hooks` | `0.2.0` | `0.2.0 — 2026-04-20` | B5 catalog expansion shipped | `packages/hooks/package.json`, `packages/hooks/CHANGELOG.md` |
| `@nano-agent/eval-observability` | `0.1.0` | `0.2.0 — 2026-04-20` | current repo reality shows changelog head ahead of package version | `packages/eval-observability/package.json`, `packages/eval-observability/CHANGELOG.md` |
| `@nano-agent/session-do-runtime` | `0.1.0` | `0.2.0 — 2026-04-20` | current repo reality shows changelog head ahead of package version | `packages/session-do-runtime/package.json`, `packages/session-do-runtime/CHANGELOG.md` |

---

## 3. Findings state transition — B1 Round 1 → B7 Round 2

| finding | Round-1 status | Round-2 verdict | gate / caveat | evidence path |
|---|---|---|---|---|
| `spike-do-storage-F01` | `open` | `writeback-shipped` | validated through `R2Adapter.put` re-validation | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_re-validation_storage.json` |
| `spike-do-storage-F02` | `open` | `writeback-shipped` | cursor/list contract re-validated through `R2Adapter.listAll` | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_re-validation_storage.json` |
| `spike-do-storage-F03` | `open` | `still-open` | owner/platform gate: `F03-CROSS-COLO-DISABLED` | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_follow-ups_kv-cross-colo-stale.json` |
| `spike-do-storage-F04` | `open` | `writeback-shipped` | DO transactional roundtrip re-validated | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_re-validation_storage.json` |
| `spike-do-storage-F05` | `open` | `writeback-shipped` | current raw evidence now reports a persistent 5-step trace | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_re-validation_storage.json` |
| `spike-do-storage-F06` | `open` | `dismissed-with-rationale` | D1 stays batch/query-only; no cross-query transaction contract introduced | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_re-validation_storage.json`, `docs/issue/after-foundations/B7-final-closure.md` §4 |
| `spike-do-storage-F07` | `open` | `writeback-shipped` | 12-pack conservative fake-bash surface still holds | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_re-validation_bash.json` |
| `spike-do-storage-F08` | `open` | `writeback-shipped` | measured cap ~2.1 MiB; B8 consumes **2 MiB safe default** | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_follow-ups_do-size-cap-binary-search.json` |
| `spike-do-storage-F09` | `open` | `writeback-shipped` (conservative path) + `still-open` (high-volume) | owner/platform gate: `F09-OWNER-URL-MISSING` for high-volume rerun | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_re-validation_bash.json`, `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_follow-ups_curl-high-volume.json` |
| `spike-binding-pair-F01` | `open` | `writeback-shipped` | B1 latency baseline + B7 live callee abort evidence | `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2/.out/probe_follow-ups_binding-f01-callee-abort.json`, `spikes/round-2-integrated/spike-binding-pair-r2/worker-b-r2/.out/binding-f01.tail.log` |
| `spike-binding-pair-F02` | `open` | `writeback-shipped` | lowercase header law remains live binding truth | `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2/.out/probe_re-validation_binding.json` |
| `spike-binding-pair-F03` | `open` | `writeback-shipped` | cross-worker hook dispatch still viable | `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2/.out/probe_re-validation_binding.json` |
| `spike-binding-pair-F04` | `open` | `writeback-shipped` | true cross-worker sink push path closed in B7 | `spikes/round-2-integrated/spike-binding-pair-r2/worker-a-r2/.out/probe_follow-ups_binding-f04-true-callback.json` |
| `unexpected-F01` | `open` | `writeback-shipped` | full concurrency curve captured; B8 safe default stays **50** | `spikes/round-2-integrated/spike-do-storage-r2/.out/probe_follow-ups_r2-concurrent-put.json` |
| `unexpected-F02` | `open` | `dismissed-with-rationale` | treated as platform property rather than a new adapter contract | `docs/issue/after-foundations/B7-final-closure.md` §4 |

**Aggregate now used by B8**

- `writeback-shipped` with live evidence: **11**
- `dismissed-with-rationale`: **2**
- `still-open` owner/platform gates: **2** (`F03`, `F09`)
- `integrated-F*` findings: **0**

---

## 4. LIVE platform numbers B8 is allowed to consume

### 4.1 Deploy inventory

| worker | URL | Version ID | evidence |
|---|---|---|---|
| `nano-agent-spike-do-storage-r2` | `https://nano-agent-spike-do-storage-r2.haimang.workers.dev` | `c8e53de7-db35-45a5-955a-6598db49bc6f` | `docs/issue/after-foundations/B7-final-closure.md` §1 |
| `nano-agent-spike-binding-pair-b-r2` | `https://nano-agent-spike-binding-pair-b-r2.haimang.workers.dev` | `72b4a2d0-89f5-4ab7-9057-e3c2e39b5f48` | `docs/issue/after-foundations/B7-final-closure.md` §1 |
| `nano-agent-spike-binding-pair-a-r2` | `https://nano-agent-spike-binding-pair-a-r2.haimang.workers.dev` | `72c7ecd5-cf24-4597-912b-d2039797e55e` | `docs/issue/after-foundations/B7-final-closure.md` §1 |

### 4.2 Headline numbers

| topic | current value | B8 handoff interpretation | evidence |
|---|---|---|---|
| F08 DO cap — last good | `2,199,424 bytes` | safe default for planning remains **2,097,152 bytes** | `probe_follow-ups_do-size-cap-binary-search.json` |
| F08 DO cap — first TOOBIG | `2,200,000 bytes` | keep ≥2.2 MiB on the R2 path | `probe_follow-ups_do-size-cap-binary-search.json` |
| F08 binary-search width | `576 bytes` over `14` steps | precise enough for conservative B8 calibration guidance | `probe_follow-ups_do-size-cap-binary-search.json` |
| unexpected-F01 R2 concurrency | `10→336/530/530`, `50→1310/2396/2396`, `100→2216/4371/4371`, `200→4383/8491/8512` (p50/p99/max, all `0` errors) | `50` = safe default; `100` opportunistic; `200` edge only | `probe_follow-ups_r2-concurrent-put.json` |
| binding-F04 dedup | `duplicateDropCount=3` | duplicate path is live, not same-isolate simulation | `probe_follow-ups_binding-f04-true-callback.json` |
| binding-F04 overflow | `capacityOverflowCount=5`, `recordCount=8`, `disclosure.count=8` | B6 dedup + overflow disclosure contract holds on real push path | `probe_follow-ups_binding-f04-true-callback.json` |
| binding-F01 cancellation | `callerAbortObserved=true` at `300 ms`; callee tail outcome `canceled` | cross-worker abort propagation is native | `probe_follow-ups_binding-f01-callee-abort.json`, `binding-f01.tail.log` |
| binding-F02 header law | observed keys lowercased: `content-length`, `content-type`, `x-nacp-request-uuid`, `x-nacp-session-uuid`, `x-nacp-team-uuid`, `x-nacp-trace-uuid` | all cross-worker code must treat `x-nacp-*` headers as lowercase | `probe_re-validation_binding.json` |
| binding-F03 hook latency smoke | `sampleCount=5`, `minLatencyMs=10`, `maxLatencyMs=10` | hook worker remains low-latency enough for first-wave remote dispatch | `probe_re-validation_binding.json` |
| B4 seam smoke | `shouldArm(low)=false`, `shouldHardFallback(high)=true`, lifecycle catalog complete | worker matrix can treat context-management seams as shipped | `probe_re-validation_context.json` |

### 4.3 Owner/platform gates that remain open

| gate | current result | owner-side prerequisite | evidence |
|---|---|---|---|
| `F03-CROSS-COLO-DISABLED` | `still-open` | enable cross-colo profile + rerun with `F03_CROSS_COLO_ENABLED="true"` | `probe_follow-ups_kv-cross-colo-stale.json` |
| `F09-OWNER-URL-MISSING` | `still-open` | supply a public owner URL tolerant of high-volume fetches | `probe_follow-ups_curl-high-volume.json` |

---

## 5. Code review history — original verdict vs current B8 consumption

| review round | original review verdict | current downstream disposition for B8 | evidence |
|---|---|---|---|
| B1 dual-track audit (`B1-code-reviewed-by-GPT`, `B1-docs-reviewed-by-GPT`) | B1 downgraded to `ready-with-fixes` | caveats C1-C6 were recorded into `B1-final-closure.md`; the remaining true Round-2 follow-ups were consumed by B7 | `docs/issue/after-foundations/B1-final-closure.md` §Caveats |
| `B5-B6-reviewed-by-GPT.md` | `changes-requested` | the three formal findings were explicitly closed in B7 §11.1 pre-entry, and B7 was allowed to GO only after those fixes landed | `docs/code-review/after-foundations/B5-B6-reviewed-by-GPT.md`, `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md` §11.1–§11.3 |
| `B7-reviewed-by-GPT.md` | `changes-requested` | B8 does **not** rely on the over-claimed parts challenged there; it consumes only the conservative subset now frozen in `B7-final-closure.md` §3/§5 plus raw `.out` evidence, while keeping `F03` / `F09` open | `docs/code-review/after-foundations/B7-reviewed-by-GPT.md`, `docs/issue/after-foundations/B7-final-closure.md` §3–§5 |

**B8 policy on review history**

1. Historical review files remain historical snapshots.
2. Worker-matrix handoff uses current code truth + current raw evidence, not pre-fix narrative claims.
3. No unresolved shipped-package blocker is carried into B8 handoff; only the two owner/platform gates remain open.

---

## 6. Regression baseline

Baseline run executed during B8 Phase 1 on 2026-04-20:

| command | result |
|---|---|
| `node --test test/*.test.mjs` | **77/77** pass |
| `npm run test:cross` | **91/91** pass |

Interpretation:

- B8 entered the handoff phase on the same green root baseline cited by the current B7 review/final-closure stack.
- Because B8 is doc-only, these numbers become the no-regression baseline for Phase 4 as well.

---

## 7. Phase 1 exit verdict

**✅ Phase 1 closed.**  
`B8-phase-1-closure.md` is now the single inventory B8 Phase 2 / 3 / 4 may cite.
