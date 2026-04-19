# [B1 / FINAL closure] Round 1 bare-metal spike phase complete; ready for B2

> **Issue ID**: `B1-final-closure`
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> **Phase**: B1 (all 6 sub-phases)
> **Status**: ✅ closed (PASSED)
> **Created**: 2026-04-19
> **Closed**: 2026-04-19
> **Owner**: sean.z@haimangtech.cn

---

## Headline

✅ **B1 — Spike Round 1 Bare-metal Cloudflare Truth Probe — COMPLETE**

- 2 disposable Cloudflare workers真实部署 (live)
- 13 platform validation items 全部跑通 (9 storage/bash + 4 binding) — `success: true`
- 13 required + 2 optional per-finding docs ship
- 3 rollup index docs ship
- 7 spike disciplines self-check ✅
- 2 representative writeback issues created (B2-r2list, B6-eval-sink-dedup)
- Handoff matrix to B2-B8 ship

**Ready signal**: B2 (Storage Adapter Hardening) can start immediately with full backward traceability to B1 findings.

---

## All 6 sub-phases summary

| Sub-phase | Title | Status | Closure issue |
|---|---|---|---|
| B1.P1 | Spike 壳与 finding 模板就位 | ✅ | [B1-phase-1-closure.md](B1-phase-1-closure.md) |
| B1.P2 | spike-do-storage 部署与 probe 实现 | ✅ | [B1-phase-2-closure.md](B1-phase-2-closure.md) |
| B1.P3 | spike-binding-pair 部署与 probe 实现 | ✅ | [B1-phase-3-closure.md](B1-phase-3-closure.md) |
| B1.P4 | Per-finding doc 撰写 | ✅ | [B1-phase-4-closure.md](B1-phase-4-closure.md) |
| B1.P5 | Rollup index doc 撰写 | ✅ | [B1-phase-5-closure.md](B1-phase-5-closure.md) |
| B1.P6 | Spike 纪律自检与 handoff | ✅ | (本 issue + handoff doc) |

---

## Live infrastructure

| Worker | URL | Version | Resource bindings |
|---|---|---|---|
| `nano-agent-spike-do-storage` | https://nano-agent-spike-do-storage.haimang.workers.dev | `40ade7d4` | DO_PROBE / KV_PROBE (`f5de37a4...`) / D1_PROBE (`e9adb012...` APAC) / R2_PROBE |
| `nano-agent-spike-binding-pair-a` (caller) | https://nano-agent-spike-binding-pair-a.haimang.workers.dev | `9ef21415` | WORKER_B service binding |
| `nano-agent-spike-binding-pair-b` (callee) | https://nano-agent-spike-binding-pair-b.haimang.workers.dev | `122d3049` | (no bindings) |

All resources tagged `nano-agent` + `spike` per owner Q1; all carry `EXPIRATION_DATE=2026-08-01`.

---

## Aggregate deliverables

### Spike code (`spikes/round-1-bare-metal/`)

| Component | Files | LOC est |
|---|---|---|
| spike-do-storage worker | 1 (worker.ts ~160 lines) + ProbeDO (~260 lines) + 9 probes (~1000 lines) + result-shape | ~1500 |
| spike-do-storage scripts | 2 (run-all-probes.sh, extract-finding.ts) | ~250 |
| spike-do-storage config | wrangler.jsonc, package.json, tsconfig.json, README, .gitignore | — |
| spike-binding-pair worker-a | 1 (~125 lines) + 4 probes (~700 lines) + result-shape | ~900 |
| spike-binding-pair worker-b | 1 (~103 lines) + 5 handlers (~250 lines) | ~400 |
| spike-binding-pair scripts | 3 (deploy-both.sh, run-all-probes.sh, extract-finding.ts) | ~300 |
| spike-binding-pair config | 2 wrangler.jsonc + 2 package.json + 2 tsconfig + README + .gitignore | — |
| Spike .out/ raw outputs | 2 JSON files | — |
| **Total spike files** | **~45 files** | **~3500 lines** |

### Documentation (`docs/spikes/`, `docs/issue/`)

| Type | Count | Path |
|---|---|---|
| Per-finding docs (required) | 13 | `docs/spikes/{spike-do-storage,spike-binding-pair}/{NN}-*.md` |
| Per-finding docs (optional) | 2 | `docs/spikes/unexpected/F0[12]-*.md` |
| Rollup index docs | 3 | `docs/spikes/{storage,binding,fake-bash-platform}-findings.md` |
| Discipline check | 1 | `docs/spikes/_DISCIPLINE-CHECK.md` |
| Phase closure issues | 5 | `docs/issue/after-foundations/B1-phase-{1..5}-closure.md` |
| Writeback issues (representative) | 2 | `docs/issue/after-foundations/{B2,B6}-writeback-*.md` |
| Handoff doc | 1 | `docs/issue/after-foundations/B1-handoff-to-B2-B6.md` |
| Final closure | 1 | (this) `docs/issue/after-foundations/B1-final-closure.md` |
| **Total docs files** | **28 files** | (~3500 lines) |

---

## Validation matrix completion

| ID | Status | Severity | Source |
|---|---|---|---|
| V1-storage-R2-multipart | ✅ | informational | `spike-do-storage-F01` |
| V1-storage-R2-list-cursor | ✅ | medium | `spike-do-storage-F02` |
| V1-storage-KV-stale-read | ✅ | medium (needs Round 2) | `spike-do-storage-F03` |
| V1-storage-DO-transactional | ✅ | informational | `spike-do-storage-F04` |
| V1-storage-Memory-vs-DO | ✅ | informational | `spike-do-storage-F05` |
| V1-storage-D1-transaction | ✅ | **high** | `spike-do-storage-F06` |
| V2A-bash-capability-parity | ✅ | informational | `spike-do-storage-F07` |
| V2B-bash-platform-stress | ✅ | **high** | `spike-do-storage-F08` |
| V2-bash-curl-quota | ✅ | low | `spike-do-storage-F09` |
| V3-binding-latency-cancellation | ✅ | informational + medium | `spike-binding-pair-F01` |
| V3-binding-cross-seam-anchor | ✅ | medium | `spike-binding-pair-F02` |
| V3-binding-hooks-callback | ✅ | informational | `spike-binding-pair-F03` |
| V3-binding-eval-fanin | ✅ | **high** | `spike-binding-pair-F04` |

**13/13 required validation items closed with finding docs.**

---

## 6 hard contract requirements gating B2-B6

These emerged from the findings and are **must-fix items for B2-B6 ship**:

| # | Requirement | Source finding | Target phase |
|---|---|---|---|
| 1 | `ScopedStorageAdapter.r2List` interface v2 (cursor/limit/truncated) | F02 | B2 (breaking) |
| 2 | D1 cross-query → use `db.batch()` or DO storage; never client BEGIN | F06 | B2 + B4 |
| 3 | DO storage `put` size pre-check (1-10 MiB cap) | F08 | B2 + B3 + B4 |
| 4 | Anchor headers must always lowercase in packages/ constants | binding-F02 | B5 + B6 |
| 5 | Eval sink dedup by messageUuid (transport doesn't dedup) | binding-F04 | B6 |
| 6 | Sink overflow must emit explicit disclosure event | binding-F04 | B6 + B5 candidate event |

---

## Round 2 (B7) follow-ups

The following findings need Round 2 verification, blocking final exit of after-foundations phase:

1. **F03** (KV stale-read): cross-region / cross-colo probe
2. **F08** (DO size cap): binary-search 1-10 MiB exact value
3. **F09** (curl quota): high-volume probe with owner-supplied URL
4. **binding-F01** (cancellation): wrangler tail confirm callee-side abort
5. **unexpected-F01** (R2 put latency): concurrent 50/100/200 put probe

---

## 7 spike disciplines (final attest)

✅ All 7 satisfied. See `docs/spikes/_DISCIPLINE-CHECK.md` for full evidence.

| # | 纪律 | Status |
|---|---|---|
| 1 | spikes/ 顶级，不进 packages/ | ✅ |
| 2 | EXPIRATION_DATE = 2026-08-01 | ✅ |
| 3 | 不接 CI 主链 | ✅ |
| 4 | finding → design doc | ✅ |
| 5 | 不接生产数据 / 业务能力 | ✅ |
| 6 | round-1 与 round-2 分目录 | ✅ |
| 7 | 不依赖 packages/ runtime；回写对齐 packages/ seam | ✅ |

---

## Definition of Done (per B1 §8.3)

| 维度 | DoD | Status |
|---|---|---|
| 功能 | 2 spike workers 真实部署 + 13 required probes callable | ✅ |
| 测试 | 2 run-all-probes.sh 全成功; .out/ 含 13 ProbeResult | ✅ |
| 文档 | 13 per-finding + 3 rollup + 1 discipline check shipped | ✅ |
| 风险收敛 | 7 disciplines satisfied; transport scope disclaimer in binding rollup | ✅ |
| 可交付性 | ≥ 1 packages/ writeback issue created (created 2: B2 + B6) | ✅ |

---

## Action-plan-level exit criteria (per B1 §8.2)

| # | Criterion | Status |
|---|---|---|
| 1 | 2 spike workers live + URL accessible | ✅ |
| 2 | 13 required per-finding docs shipped using template | ✅ |
| 3 | 3 rollup index docs shipped | ✅ |
| 4 | ≥ 1 packages/ writeback issue exists | ✅ (2 created) |
| 5 | _DISCIPLINE-CHECK.md 7/7 ✅ | ✅ |
| 6 | binding-findings.md transport scope disclaimer | ✅ |
| 7 | fake-bash-platform-findings.md V2A/V2B writeback distinction | ✅ |
| 8 | ≥ 1 finding triggers packages/ modification issue | ✅ |

---

## Charter §11.1 Primary Exit Criteria contribution

This is **B1's contribution** to charter §11.1 — full charter exit requires B2-B8 also done. B1 satisfies:

- ✅ Spike 真相已闭合 (Round 1 portion)
- ⏳ Round 2 portion deferred to B7
- ➡️ Storage truth (B2 input ready)
- ➡️ Fake-bash extension (B3 input ready)
- ➡️ Async compact lifecycle (B4 input ready, with F06/F08 constraints)
- ➡️ Hooks event classes (B5 input ready)
- ➡️ NACP protocol upgrade (B6 input ready, with F02/F04 hard requirements)
- ➡️ Inspection facade (B4 input ready, with F02/F04 contracts)
- ➡️ Worker matrix prep (B8 input ready)

**Ratio of B1's contribution to charter exit**: B1 satisfies 1/9 directly, enables 8/9.

---

## Next: Start B2 (Storage Adapter Hardening)

When B2 begins:

1. Read `B1-handoff-to-B2-B6.md` for the 7 finding inputs
2. Read `storage-findings.md` rollup §3 for full writeback destination map
3. Read individual per-finding docs in `docs/spikes/spike-do-storage/{01..09}-*.md` for §3 Package Impact details
4. Reference existing writeback issue `B2-writeback-r2list-cursor-interface.md` as template
5. Plan `storage-topology` major bump 0.1.0 → 2.0.0
6. RFC `docs/rfc/scoped-storage-adapter-v2.md` is required deliverable

---

## Owner-facing notes

- **Spike workers retained** per Q5 — no immediate action needed
- **Workers visible in CF dashboard** under `Sean.z@haimangtech.cn's Account` (8b611460403095bdb99b6e3448d1f363)
- **Spike resource cost** estimated < $5/month so far (~10 invocations + small storage); manual destroy any time via dashboard
- **B2 ready to start** — all backward traceability is in place

---

## References

- Charter: `docs/plan-after-foundations.md`
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- All 5 phase closure issues: `B1-phase-{1..5}-closure.md`
- Discipline check: `docs/spikes/_DISCIPLINE-CHECK.md`
- Handoff to B2-B6: `B1-handoff-to-B2-B6.md`
- Writeback issues: `B2-writeback-r2list-cursor-interface.md`, `B6-writeback-eval-sink-dedup.md`
- Tracking policy: `docs/issue/README.md`
