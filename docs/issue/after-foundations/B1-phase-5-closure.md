# [B1 / Phase 5 closure] 3 rollup index docs shipped

> **Issue ID**: `B1-phase-5-closure`
> **Action plan**: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
> **Phase**: 5 — Rollup index doc 撰写
> **Status**: ✅ closed (PASSED)
> **Created**: 2026-04-19
> **Closed**: 2026-04-19

---

## Summary

3 份 charter §4.1 A 第 4 项要求的 rollup index doc 全部 ship。每份含 §1 Finding index + §2 Severity summary + §3 Writeback destination map + §4 Unresolved/dismissed summary + §5 Per-finding doc links。`binding-findings.md` 显式声明 transport scope；`fake-bash-platform-findings.md` 显式区分 V2A/V2B/V2-curl writeback 目标。

## Completed work items

| # | Item | Output | Status |
|---|---|---|---|
| P5-01 | storage-findings.md rollup | `docs/spikes/storage-findings.md` (6 findings indexed) | ✅ |
| P5-02 | binding-findings.md rollup with transport scope | `docs/spikes/binding-findings.md` (4 findings indexed + §0 transport scope disclaimer) | ✅ |
| P5-03 | fake-bash-platform-findings.md rollup with V2A/V2B distinction | `docs/spikes/fake-bash-platform-findings.md` (3 findings indexed + §0 V2 class distinction) | ✅ |

## Rollup-level severity totals

| Rollup | high | medium | informational | low | total |
|---|---|---|---|---|---|
| storage-findings | 1 (F06) | 2 (F02, F03) | 3 (F01, F04, F05) | 0 | 6 |
| binding-findings | 1 (F04) | 2 (F01, F02) | 1 (F03) | 0 | 4 |
| fake-bash-platform-findings | 1 (F08) | 0 | 1 (F07) | 1 (F09) | 3 |
| **Combined required** | **3** | **4** | **5** | **1** | **13** |

> + 2 optional `unexpected-F*` (medium) shipped under `docs/spikes/unexpected/`

## Aggregate writeback destination map (across all 3 rollups)

| Phase | Storage rollup | Binding rollup | Fake-bash rollup | Total findings |
|---|---|---|---|---|
| **B2** (Storage Adapter Hardening) | 6 | — | 1 (F08) | **7** |
| **B3** (Fake-Bash Extension) | — | — | 3 (F07, F08, F09) | **3** |
| **B4** (Context-Management Package) | 1 (F06) | 2 (F02, F04) | 1 (F08) | **4** |
| **B5** (Hooks Catalog Expansion) | — | 3 (F02, F03, F04) | — | **3** |
| **B6** (NACP 1.2.0 + sink dedup) | — | 2 (F02, F04) | — | **2** |
| **B7** (Round 2 integrated) | 1 (F03) + RFC F02 | 1 (F01) | 2 (F08, F09) | **5** |
| **B8** (handoff memo) | — | 3 (F01, F02, F03) | 1 (F07) | **4** |

> Counts include both forward-traceability (finding → packages/ change) and backward-traceability (Round 2 must re-test) targets.

## Discipline check (Phase 5)

| 纪律 | 状态 | Evidence |
|---|---|---|
| 1. the historical spikes tree  顶级 | ✅ | rollup docs 在 `docs/spikes/` 顶级 |
| 2. expiration date | ✅ | spike workers 仍持有 expiration |
| 3. 不接 CI 主链 | ✅ | rollup docs 是 markdown |
| 4. finding → design doc | ✅ | rollup 是 finding 的索引/总结层 |
| 5. 不接生产数据 | ✅ | rollup 仅含 finding ID + 路径 |
| 6. round-1 与 round-2 分目录 | ✅ | 仍只有 round-1 |
| 7. 不依赖 packages/ runtime；回写对齐 packages/ seam | ✅ | 每份 rollup §3 显式 packages/ 路径 |

## Phase 5 closure gate verdict

✅ **PASSED** —
- 3/3 rollup docs shipped
- Each rollup contains all 5 required sections
- `binding-findings.md` includes transport scope disclaimer (per GPT review §2.3)
- `fake-bash-platform-findings.md` includes V2A/V2B/V2-curl writeback distinction (per GPT review §2.4)
- Aggregate writeback distribution shows balanced impact (B2 has heaviest 7 findings — expected for storage-bound spike phase)

## Next: Phase 6 (P6-01..03)

- **P6-01**: `docs/spikes/_DISCIPLINE-CHECK.md` 7-discipline self-check
- **P6-02**: Create writeback issues in `docs/issue/after-foundations/` (per Q4 owner-final answer: not gh)
- **P6-03**: B2/B3/B4 input handoff doc

## References

- Charter: `docs/plan-after-foundations.md` §4.1 A 第 4 项
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Tracking policy: `docs/issue/README.md`
- Rollup spec: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §4.6
- Previous closures: B1-phase-1, B1-phase-2, B1-phase-3, B1-phase-4
