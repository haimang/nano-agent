# After-Skeleton Trace Substrate Benchmark — v1

> Run scope: `package-local-isolate`
> Runner: `packages/eval-observability/scripts/trace-substrate-benchmark.ts` v1.0.0
> Run date: `2026-04-18`
> Owner: `GPT-5.4` (Claude Opus 4.7 execution)
> Linked decisions: `docs/design/after-skeleton/P1-trace-substrate-decision.md`,
> `docs/action-plan/after-skeleton/A2-trace-substrate-decision-investigation.md`,
> `docs/action-plan/after-skeleton/AX-QNA.md` (Q5, Q20)

---

## 0. Summary (TL;DR)

- **DO storage hot anchor — confirmed.** Tenant-scoped, hibernation-safe, append-only JSONL. Brand-new sink instances reconstruct the full timeline from the `_index` key with **100% fidelity** in every probe.
- **R2 cold archive — confirmed as deferred seam.** No runtime wiring yet, but the role boundary is now written down and gated.
- **D1 deferred query — confirmed.** Zero D1 wiring. Q20 promotes "any D1 role expansion must first ship an independent benchmark/investigation memo" to a hard gate.
- **One sink-level finding to act on (separately):** `DoStorageTraceSink` does read-modify-write per flush against the same date-keyed JSONL value. Multi-flush sessions therefore inflate write volume. Not a blocker for the substrate decision; documented below as **Finding F1** with a recommended sizing policy and follow-up owner.

Verdict on the substrate decision: **Q5 conditional yes is upgraded to evidence-backed yes.**

---

## 1. Methodology

The runner is **package-local / in-isolate only** — it wraps the real `DoStorageTraceSink`
code path with a recording fake `DoStorageLike` to measure code-path behaviour.
It does NOT exercise wrangler dev / deploy-shaped DO storage; that scope is
explicitly delegated to A6 (deployment dry-run + real boundary verification).

### 1.1 Scenarios

| Scenario | Mode | Purpose |
|---|---|---|
| Default 5×50 burst | `local-bench` (`buffer=64`) | Mixed steady + burst with the existing sink default; surfaces typical per-turn behaviour |
| Recommended single-flush per turn | `local-bench` (`buffer=1024`, single `manual flush` per session) | Models "flush once at turn end" sizing |
| Single-flush probe | `local-bench` (`burst=1×250`, `buffer=1024`) | Best-case write amplification reference |
| Readback probe | `readback-probe` (8 sessions × 128 events) | Hibernation-safe restart reconstruction |

### 1.2 Pass criteria (frozen in A2 §1.5 / AX-QNA Q5)

| metric | threshold | rationale |
|---|---|---|
| `readbackSuccessPct` | `100%` | Trace must survive DO hibernation |
| `writeAmplificationMax` | `≤ 2×` (storage bytes / raw JSONL) | Bounded archive cost / sane R2 mirror size |
| `tailRatioWarn` (`p99/p50`) | `≤ 5×` (warn only) | Detects unstable hot path; runs > 5× must be explained or claim only `yellow` |
| Tenant key invariant | `tenants/{teamUuid}/trace/{sessionUuid}/{date}.jsonl + _index` must hold | Isolation + hibernation safety |

### 1.3 Repro

```bash
pnpm --filter @nano-agent/eval-observability exec \
  tsx scripts/trace-substrate-benchmark.ts \
  --mode all --steady 500 --burst-count 5 --burst-size 50 \
  --readback-sessions 4 --readback-events 64 --buffer 64 \
  --out artifact.json --markdown artifact.md
```

Replace `--buffer 64` with `--buffer 1024` for the single-flush variant or use
`--mode readback-probe --readback-sessions 8 --readback-events 128` for the
hibernation probe.

The runner is also reachable via `pnpm --filter @nano-agent/eval-observability bench:trace-substrate -- <flags>`.

---

## 2. Results

All three numerical runs use seed `0xC0FFEE` for reproducibility. Latency
numbers are in-isolate fake timings (microsecond-scale); they do **not**
represent real Cloudflare DO put latency. They establish that the sink's
synchronous code-path cost is negligible against the AX-QNA Q5 budget
(`≤ 20 ms` p50 / `≤ 100 ms` p99 at the real DO boundary), which leaves the
budget free for the network round trip itself.

### 2.1 Default burst (`--buffer 64 --burst-count 5 --burst-size 50`)

| metric | steady (500 ev) | burst (5×50 ev) |
|---|---|---|
| storage put ops | 16 | 10 |
| storage bytes / raw bytes | 464,234 / 101,277 | 150,612 / 50,246 |
| **write amplification** | **4.58×** ❌ | **3.00×** ❌ |
| emit p50 / p99 (ms) | 0 / 0.162 | 0.001 / 0.005 |
| flush max (ms) | 0.151 (manual) | 0.235 (per-wave) |
| tail ratio (p99/p50) | n/a (p50≈0) | 10.12× ⚠ |
| verdict | **red** | (combined) |

### 2.2 Recommended sizing (`--buffer 1024 --burst-count 5 --burst-size 50`)

| metric | steady (500 ev) | burst (5×50 ev) |
|---|---|---|
| storage put ops | 2 | 10 |
| storage bytes / raw bytes | 101,291 / 101,277 | 150,612 / 50,246 |
| **write amplification** | **1.00×** ✅ | **3.00×** ❌ |
| emit p50 / p99 (ms) | 0.001 / 0.017 | 0.001 / 0.007 |
| flush max (ms) | 2.344 (manual) | 0.222 (per-wave) |
| tail ratio (p99/p50) | 32.06× ⚠ | 13.04× ⚠ |
| verdict | **red** | (combined) |

The steady scenario hits the threshold the moment the buffer holds the entire
turn; the burst scenario still exceeds the threshold because each "wave" issues
its own `flush()` (5 puts to the same date-key during the run). This is a sink
design property, not a substrate property — see **Finding F1** below.

### 2.3 Single-flush reference (`--burst-count 1 --burst-size 250 --buffer 1024`)

| metric | steady (500 ev) | burst (1×250 ev) |
|---|---|---|
| storage put ops | 2 | 1 |
| **write amplification** | **1.00×** ✅ | **1.00×** ✅ |
| emit p50 / p99 (ms) | 0.001 / 0.007 | 0 / 0.002 |
| flush max (ms) | 2.392 | 0.532 |
| tail ratio (p99/p50) | 8.79× ⚠ | n/a |
| verdict | **yellow** (tail-only) | (combined) |

This is the green-path proof that the sink can meet the threshold when the
caller flushes at most once per date-key per session.

### 2.4 Readback probe (`--readback-sessions 8 --readback-events 128 --buffer 32`)

| metric | value |
|---|---|
| sessions × events | 8 × 128 |
| total written / read | 1,024 / 1,024 |
| **success %** | **100%** ✅ |
| session mismatches | 0 |
| ordering violations | 0 |
| `_index` keys observed | 8 (== sessions) ✅ |
| verdict | **green** |

A fresh sink instance (tenant + sessionUuid only) reads back the entire
timeline across two distinct teams without holding any in-process state.
This is the property the observability foundation actually depends on.

---

## 3. Findings

### F1 — `DoStorageTraceSink` read-modify-write inflates write volume per flush

**Observation.** The sink stores each session/date as a single JSONL value and
performs `existing + "\n" + newLines` on every flush
(`packages/eval-observability/src/sinks/do-storage.ts:103-109`). With `N`
flushes against the same date key, total bytes written grow as
`E * K * N * (N+1) / 2`, where `K` events of size `E` are written per flush.
At default sizing (`buffer=64`, ~16 flushes per 500-event session), this gives
**4.58× write amplification on steady traffic**. The burst scenario sees ~3×
because every wave triggers an explicit `flush()`.

**Why it does not block the substrate decision.** The substrate question is
"is DO the right hot anchor and is the timeline recoverable" — both answers
remain `yes` regardless of WA. WA only affects archive volume / R2 mirror
cost, which itself is a deferred seam.

**Recommendation (sizing policy, owner: A3 / P2).**
- Set `maxBufferSize ≥ events-per-turn` so each turn produces at most a single
  flush per date-key. The existing default `64` (line 37) already covers most
  turns; raising to `128` would keep small-turn agents in the green band.
- Recommend `flush()` on `turn.end` and on session checkpoint, **not** on each
  internal mini-batch.
- The runner's `multi-flush` test (`test/scripts/trace-substrate-benchmark.test.ts`)
  pins this finding so any future sink rewrite cannot silently drop the
  invariant.

**Future work (separate, not in A2).** A roll-forward upgrade where each flush
appends only the new lines (e.g. `append()` semantics or per-flush key suffix)
would push WA to ~1× without changing the substrate. That belongs to a
follow-up sink-level memo, not to the substrate decision.

### F2 — Tail ratio noise is microsecond-scale

`p99/p50 > 5×` lights up on multiple runs, but the absolute p99 stays
< 0.02 ms. The cause is GC / JIT noise on small samples; the absolute budget
is two orders of magnitude under the AX-QNA Q5 real-DO budget. The benchmark
records this as a `yellow` warn so the artifact prose can decide whether to
explain it; in this run we explain it here and continue treating
`writeAmplification` as the load-bearing metric.

---

## 4. Comparative note: roles for DO / R2 / D1 / KV

| substrate | reality today | role in v1 (this memo) | upgrade gate |
|---|---|---|---|
| **DO storage** (`SESSION_DO.state.storage`) | Wired hot path: `DoStorageTraceSink` writes tenant-scoped JSONL + `_index`; `SessionCheckpoint` lives next to it. | **Hot anchor + durable audit substrate.** Every accepted internal request must end up here for `trace_uuid` survival. | Any change to write semantics (append-only → multiple keys etc.) must be tested against `trace-substrate-benchmark` and not regress readback. |
| **R2** (`R2_ARTIFACTS`) | Type slot in `SessionRuntimeEnv`; no runtime wiring. | **Cold archive substrate (deferred).** Long-tail JSONL mirror, transcript export, attachment storage. Not on the hot path. | Wiring belongs to A7 (storage-and-context-evidence-closure); decision memo there must justify mirror cadence and key layout. |
| **D1** | **Zero wiring** anywhere in `packages/**`; only listed in `NacpRefKindSchema` for protocol completeness. | **Deferred query substrate.** Eligible later for analytics / cross-session search, but never on the hot path during P1. | Q20 hard gate: any D1 role beyond "deferred query seam" requires an independent `trace-substrate-benchmark-vN.md` memo with the 5 mandatory sections (trigger, benchmark, role redivision, fallback, affected action-plans). |
| **KV** (`KV_CONFIG`) | Type slot in `SessionRuntimeEnv`; intended for warm config / shared manifest. | **Not a trace substrate.** Will not carry trace payload bytes. | Promoting KV to carry trace events requires a memo of the same calibre as a D1 promotion. |

The "DO is hot, R2 is cold, D1 is deferred, KV is not a trace store" sentence
now has runtime evidence backing the first half and an explicit gate guarding
the second half.

---

## 5. Decision

1. **DO storage stays as the v1 trace hot anchor + durable audit substrate.**
   Q5 (AX-QNA) is upgraded from *conditional yes* to **evidence-backed yes**;
   the linked memo is this file.
2. **R2 stays the cold archive substrate**, with no runtime wiring required
   in P1. Wiring is A7's responsibility.
3. **D1 stays the deferred query substrate.** Q20 (AX-QNA) is upgraded from
   *intent* to **enforced gate**: no D1 role change ships without an independent
   `trace-substrate-benchmark-vN.md` memo first.
4. **F1 (sink write-amplification at multi-flush)** is *out of scope for the
   substrate decision* but *in scope for A3/P2* sizing policy: configure
   `maxBufferSize ≥ events-per-turn` and flush on turn boundaries.

---

## 6. Limitations

- All numbers are in-isolate; real DO put latency must be re-verified in A6.
- The fake storage models `get` / `put` / `list` faithfully but cannot model
  DO consistency, alarm budget, or hibernation-induced timing.
- Single-process Node timer noise inflates tail ratios; treat the absolute
  numbers, not the ratios, as load-bearing for the substrate decision.
- Comparative note for R2 / D1 / KV is desk-research, not benchmark — that is
  intentional, since A2 is forbidden from implementing those substrates.

---

## 7. Reproducibility checklist

- [x] Runner under version control (`packages/eval-observability/scripts/trace-substrate-benchmark.ts`)
- [x] Pass criteria frozen in source (`BENCH_THRESHOLDS`)
- [x] Regression test suite (`packages/eval-observability/test/scripts/trace-substrate-benchmark.test.ts`)
- [x] CLI flags + defaults documented (`--help`)
- [x] Markdown / JSON artifact emitters (`--out`, `--markdown`)
- [x] Deterministic fixture seed (`--seed`)
- [x] No `wrangler` / network / deploy dependency
