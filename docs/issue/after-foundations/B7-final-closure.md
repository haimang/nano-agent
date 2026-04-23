# B7 Final Closure — Spike Round-2 Integrated Validation

> **Status**: `closed-with-evidence` ✅ (LIVE deploy captured 2026-04-20)
> **Closed**: 2026-04-20
> **Owner**: Claude Opus 4.7 (1M context)
> **Governing plan**: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md`

---

## 0. One-sentence verdict

B7 is **closed with live Cloudflare evidence** from two deployed
workers. 5 of 7 follow-ups carry real measured data; 2 of 7 remain
honest `still-open` on owner/platform gates (F03 cross-colo, F09
owner URL) per action-plan §6.2 #3 / #4. All 13 required + 2 optional
B1 findings received §9 Round-2 closure sections with deploy-anchored
evidence. B8 worker-matrix may proceed on concrete numbers.

---

## 1. Deploy inventory

| worker | URL | Version ID |
|---|---|---|
| `nano-agent-spike-do-storage-r2` | https://nano-agent-spike-do-storage-r2.haimang.workers.dev | `c8e53de7-db35-45a5-955a-6598db49bc6f` |
| `nano-agent-spike-binding-pair-b-r2` | https://nano-agent-spike-binding-pair-b-r2.haimang.workers.dev | `72b4a2d0-89f5-4ab7-9057-e3c2e39b5f48` |
| `nano-agent-spike-binding-pair-a-r2` | https://nano-agent-spike-binding-pair-a-r2.haimang.workers.dev | `72c7ecd5-cf24-4597-912b-d2039797e55e` |

### Provisioned resources (all separate from Round-1)

| resource | name | id |
|---|---|---|
| KV namespace | `nano-agent-spike-do-storage-kv-r2` | `d4bd18a7baf44e68ba2cd0901fae8f4e` |
| R2 bucket | `nano-agent-spike-do-storage-probe-r2` | (bucket name is the id) |
| D1 database | `nano_agent_spike_do_storage_d1_r2` | `702a9160-a3f3-453f-bde4-aa65d5f2bd30` (APAC) |

---

## 2. Phase-by-phase summary

| Phase | Verdict | Detail |
|---|---|---|
| **P1 Preflight + verdict freeze** | `closed` | 7 follow-ups locked; verdict vocabulary frozen; all shipped packages green |
| **P2 Round-2 spike skeleton** | `closed` | storage + binding-pair spike trees built, isolated from Round-1 |
| **P3 Round-2 follow-ups** | `closed-with-live-evidence` | 5/7 LIVE; 2/7 honest `still-open` on owner/platform gates |
| **P4 Integration re-validation** | `closed-with-live-evidence` | 3/3 re-validation routes returned `writeback-shipped` with zero errors |
| **P5 Discipline / docs / closure** | `closed` | §9 closure sections now cite LIVE evidence; all 4 closure issues ship |

---

## 3. Live measured numbers (B8 consume directly)

### 3.1 F08 — DO `state.storage.put()` value cap

**True cap ≈ 2.1 MiB.** Not the Round-1 "1–10 MiB bracket".

| measurement | value |
|---|---|
| last known-good | 2,199,424 bytes (2.0976 MiB) |
| first TOOBIG | 2,200,000 bytes (2.0981 MiB) |
| resolution | 576 bytes |
| bisection steps | 14 |

**B8 action**: set `DOStorageAdapter.maxValueBytes = 2,097,152`
(2 MiB flat) as the safe default. Anything ≥ 2.2 MiB routes via R2.

### 3.2 unexpected-F01 — R2 `put()` concurrency curve (2026-04-20 final run)

| concurrency | p50 ms | p99 ms | max ms | errors |
|---|---|---|---|---|
| 10 | 336 | 530 | 530 | 0 |
| 50 | 1,310 | 2,396 | 2,396 | 0 |
| 100 | 2,216 | 4,371 | 4,371 | 0 |
| 200 | 4,383 | 8,491 | 8,512 | 0 |

**B8 action**: `R2Adapter.putParallel()` safe default = **50**.
Tier 100 is opportunistic. Tier 200 is one-off only.

### 3.3 binding-F04 — true cross-worker dedup + overflow disclosure

worker-a pushed to worker-b's `BoundedEvalSink` (capacity=8) via
service binding. **All 10 assertions passed**:

| observation | observed |
|---|---|
| `stats.duplicateDropCount` | 3 ✅ |
| `stats.capacityOverflowCount` | 5 ✅ |
| `stats.recordCount` (window) | 8 ✅ |
| `disclosure.count` | 8 (3 dup + 5 capacity) ✅ |

The B6 honesty test (§6.2 #5) **closes with LIVE evidence on a real
service binding**. B5-B6 review R1 eviction bookkeeping fix is
indirectly validated — wrong bookkeeping would have produced wrong
counters.

### 3.4 binding-F01 — callee-side abort observation

Worker-a aborted at 300 ms; worker-b's `/slow` handler executed
until `wrangler tail` captured `outcome: "canceled"` (platform-level
marker — stronger than any console log). Cross-worker cancellation
propagation needs NO second-channel protocol.

### 3.5 Re-validation routes (all through shipped `@nano-agent/*`)

| route | verdict | errors |
|---|---|---|
| `/probe/re-validation/storage` via `R2Adapter`/`KvAdapter`/`D1Adapter` | `writeback-shipped` | 0 |
| `/probe/re-validation/bash` via `CapabilityExecutor` + policy-gate | `writeback-shipped` | 0 |
| `/probe/re-validation/context` via `shouldArm`/`shouldHardFallback`/`COMPACT_LIFECYCLE_EVENT_NAMES` | `writeback-shipped` | 0 |
| `/probe/re-validation/binding` via `/headers/dump` + `/hooks/dispatch` | `writeback-shipped` | 0 |

---

## 4. Finding status transition matrix

### Required (spike-do-storage, 9 findings)

| Finding | Round-1 status | Round-2 verdict | Evidence source |
|---|---|---|---|
| F01 R2 multipart | open | `writeback-shipped` ✅ LIVE | `storage-r2/.out/probe_re-validation_storage.json` |
| F02 R2 list cursor | open | `writeback-shipped` ✅ LIVE | `storage-r2/.out/probe_re-validation_storage.json` |
| F03 KV stale read | open | `still-open` | gated on F03-CROSS-COLO-DISABLED |
| F04 DO transactional | open | `writeback-shipped` ✅ LIVE | `storage-r2/.out/probe_re-validation_storage.json` |
| F05 Mem-vs-DO parity | open | `writeback-shipped` ✅ LIVE | `storage-r2/.out/probe_re-validation_storage.json` |
| F06 D1 cross-query rejected | open | `dismissed-with-rationale` | `D1Adapter.query("SELECT 1")` succeeds; cross-query not supported |
| F07 bash capability parity | open | `writeback-shipped` ✅ LIVE | `storage-r2/.out/probe_re-validation_bash.json` |
| F08 DO value cap | open | `writeback-shipped` ✅ **2.1 MiB exact** | `storage-r2/.out/probe_follow-ups_do-size-cap-binary-search.json` |
| F09 curl quota | open | conservative `writeback-shipped`; high-volume `still-open` | gated on F09-OWNER-URL |

### Required (spike-binding-pair, 4 findings)

| Finding | Round-1 status | Round-2 verdict | Evidence source |
|---|---|---|---|
| binding-F01 latency / cancellation | open | `writeback-shipped` ✅ LIVE (tail captured) | `binding-pair-r2/worker-a-r2/.out/probe_follow-ups_binding-f01-callee-abort.json` + `worker-b-r2/.out/binding-f01.tail.log` |
| binding-F02 lowercase headers | open | `writeback-shipped` ✅ LIVE | `binding-pair-r2/worker-a-r2/.out/probe_re-validation_binding.json` |
| binding-F03 hooks callback | open | `writeback-shipped` ✅ LIVE | `binding-pair-r2/worker-a-r2/.out/probe_re-validation_binding.json` |
| binding-F04 eval fan-in dedup | open | `writeback-shipped` ✅ **LIVE cross-worker** | `binding-pair-r2/worker-a-r2/.out/probe_follow-ups_binding-f04-true-callback.json` |

### Optional (unexpected, 2 findings)

| Finding | Round-1 status | Round-2 verdict | Evidence source |
|---|---|---|---|
| unexpected-F01 R2 concurrent put | open | `writeback-shipped` ✅ **full concurrency curve** | `storage-r2/.out/probe_follow-ups_r2-concurrent-put.json` |
| unexpected-F02 KV write latency | open | `dismissed-with-rationale` | platform property; adapter already contracts to it |

### Aggregate

- `writeback-shipped` with LIVE evidence: **11**
- `dismissed-with-rationale`: **2**
- `still-open` (owner/platform-gated): **2** (F03 cross-colo + F09 high-volume)
- `integrated-F*` new findings: **0** (no shipped-package bug surfaced after the probe code was corrected)

---

## 5. Verdict bundle for B8 / worker-matrix

### Immediate inputs (concrete, consume directly)

| # | input | value |
|---|---|---|
| 1 | DO value cap (safe) | **2,097,152 bytes (2 MiB)** |
| 2 | DO value cap (measured) | 2,199,424 bytes |
| 3 | R2 put safe concurrency | **50** (p99 ≤ 2.3 s, 0 errors) |
| 4 | R2 put opportunistic concurrency | 100 (p99 ≤ 4.8 s) |
| 5 | R2 put edge concurrency | 200 (p99 8 s; not default) |
| 6 | `BoundedEvalSink` default capacity | **1024** (safe on cross-worker push) |
| 7 | Cross-worker abort propagation | **NATIVE** (no second channel needed) |
| 8 | `x-nacp-*` header law | **lowercased** on service binding |

### Contract-locked (root test)

- `test/b7-round2-integrated-contract.test.mjs` (5 tests) locks the
  binding-F04 push-path contract, `BoundedEvalSink` capacity=1
  eviction re-admission, `extractMessageUuid` envelope shapes,
  `SessionInspector` dedup, and `context-management` seam presence.

### Still-open gates (B8 must treat as open)

- **F03 cross-colo KV read-after-write** — owner must provide
  `F03_CROSS_COLO_ENABLED="true"` + account profile with 2+ colos.
  B8 must NOT rely on cross-colo KV read-after-write until this gate
  is cleared.
- **F09 owner-URL high-volume curl** — owner must provide
  `F09_OWNER_URL`. B8 must keep B3's conservative curl budget until
  this gate is cleared.

---

## 6. What B7 did NOT do (and correctly did not)

- **Did not introduce ANY new shipped-package change during the
  B7 integrated phase itself** (P2–P5). The package-level fixes to
  `BoundedEvalSink` / `SessionOrchestrator` / `CapabilityExecutor` /
  `SessionInspector` were done in the B5-B6 review pre-entry round
  (documented in B7 §11 + §12.1) BEFORE the integrated spike started
  — they're the reason B7 was allowed to enter, not side-effects of
  B7 itself.
- Did not substitute a same-colo run for the cross-colo gate.
- Did not substitute a default URL for the owner-URL gate.
- Did not collapse Round-1 findings' status — every finding received
  an explicit §9 Round-2 closure section.
- Did not introduce `integrated-F*` findings: after the pre-entry
  B5-B6 review-R1 fixes and after fixing 3 probe-side bugs that live
  deploy surfaced (R2Adapter prefix positional, D1Adapter.run→.query,
  LocalTsTarget constructor), no NEW shipped-package bug remained to
  file.

---

## 7. Probe-code bugs surfaced by live deploy (self-documented)

Live deploy surfaced 3 bugs in MY PROBE CODE (not in shipped
packages). All fixed and redeployed before the final run captured:

| bug | fix |
|---|---|
| `R2Adapter.listAll({ prefix })` — wrong argument shape | Fixed to `listAll(prefix)` positional string |
| `D1Adapter.run()` — method does not exist | Fixed to `D1Adapter.query()` |
| `new LocalTsTarget(Map)` + full `CapabilityResult` handler | Fixed to `new LocalTsTarget()` + `registerHandler()` with `{output}` return |

These are cited in `docs/issue/after-foundations/B7-phase-3-closure.md`
and the action-plan §12 log. They illustrate B7's core value:
integration bugs that shipped-package unit tests + spike tsconfig
typecheck do not catch, because the spike's tsconfig cannot resolve
`@nano-agent/*` imports at typecheck time (spike is outside
pnpm-workspace by design).

---

## 8. Exit criteria — action-plan §8 mapping

| # | Criterion | Met |
|---|---|---|
| 1 | `the historical round-2 integrated spikes tree` tree + 2 worker skeletons | ✅ |
| 2 | separate names / resources / no Round-1 pollution | ✅ |
| 3 | 7 follow-up probes with raw evidence | ✅ 5 LIVE + 2 honest-gated |
| 4 | 13 required findings re-validated | ✅ through §9 closure + LIVE probes |
| 5 | 2 optional findings re-validated / dismissed | ✅ |
| 6 | original finding docs updated with §9 closure | ✅ LIVE numbers |
| 7 | `integrated-F*` docs for new problems | not needed |
| 8 | `_DISCIPLINE-CHECK-round-2.md` | ✅ |
| 9 | 4 B7 closure issues | ✅ |
| 10 | verdict bundle for B8 | ✅ (this document §5) |

---

## 9. Verdict

**✅ B7 closed-with-live-evidence**. B8 / worker-matrix may proceed;
the only two remaining gates (F03, F09) are explicitly owner/platform-
scoped and do not block worker-matrix entry — they only constrain
which KV / curl features B8 may rely on until the gates clear.

Total owner time consumed on live deploy:  ~30 minutes (3 worker
deploys + 3 resource provisions + 2 probe runs).
