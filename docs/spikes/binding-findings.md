# Spike Rollup — `binding-findings`

> **Rollup ID**: `binding-findings`
> **Spike**: `spike-binding-pair`
> **Round**: 1 (bare-metal)
> **Generated**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Charter requirement**: `docs/plan-after-foundations.md` §4.1 A 第 4 项 deliverable

---

## §0 Transport Scope Disclaimer (重要！)

> **本 rollup 中所有 finding 仅描述 fetch-based service binding seam 的真相**，对应 `packages/session-do-runtime/src/remote-bindings.ts:64-77, 282` 的 `binding.fetch(new Request(...))` 路径。
>
> **以下 transport 不在本 rollup 验证范围内**：
> - `packages/nacp-core/src/transport/service-binding.ts:15-16` 的 `ServiceBindingTarget.handleNacp(envelope)` **RPC transport**
>
> 如果 worker matrix 阶段或 Phase 5 需要 RPC transport 真相，必须**单独立项** `spike-rpc-transport`，不能默认本 rollup 的 finding 覆盖 RPC path。
>
> 来源：`docs/design/after-foundations/P0-spike-binding-pair-design.md` §0 + GPT review §2.3

---

## §1 Finding Index

| # | ID | Title | Severity | Status | Packages/ impact (one-line) |
|---|---|---|---|---|---|
| 1 | `spike-binding-pair-F01` | binding latency sub-10ms + cancellation works | informational + medium | open | (none) — confirms `remote-bindings.ts` fetch seam latency assumption |
| 2 | `spike-binding-pair-F02` | anchor headers survive but **forced lowercase** | medium | open | **`cross-seam.ts` audit**: header constants must always lowercase |
| 3 | `spike-binding-pair-F03` | hooks-callback latency + error shape confirmed | informational | open | (none) — confirms hooks `service-binding.ts` runtime contract |
| 4 | `spike-binding-pair-F04` | eval-fanin **app-layer dedup REQUIRED** | **high** | open | **`SessionInspector` + `defaultEvalRecords` must dedup by messageUuid + emit overflow disclosure** |

**Total**: 4 required findings (V3-binding 全部覆盖)；0 optional in this rollup（unexpected-F* 在 `unexpected/` 目录但属于 storage spike side effect）。

---

## §2 Severity Summary

| Severity | Count | IDs |
|---|---|---|
| **high** | 1 | F04 (app-layer dedup mandatory) |
| **medium** | 2 | F01 (cancellation contract), F02 (header lowercase) |
| **informational** | 1 | F03 |
| low | 0 | — |

> **Distribution observation**: 1/4 高 severity 是 eval-fanin dedup（直接 contract 改 `eval-observability` 与 `defaultEvalRecords`）；2/4 medium 都是契约层确认（latency + header case）。

---

## §3 Writeback Destination Map

| Finding | Target phase | Target packages/ file(s) | Action class |
|---|---|---|---|
| F01 | B8 (handoff) + B7 (Round 2) | (no packages/ change) | handoff memo + Round 2 wrangler tail confirm `[slow] abort observed` propagation to callee |
| **F02** | **B5** (cross-seam audit) + **B6** (NACP spec) + **B4** (inspector facade JSDoc) | `packages/session-do-runtime/src/cross-seam.ts` (audit), `docs/rfc/nacp-1-2-0.md` (lowercase declared), `packages/eval-observability/src/inspector.ts` (JSDoc) | **header constants must lowercase**；NACP 1.2.0 spec must declare lowercase |
| F03 | B5 (Phase 4 catalog 扩展) + B8 (handoff) | (no packages/ change) | confirms catalog can extend safely; handoff memo cite |
| **F04** | **B6** (sink dedup) + **B5** (catalog `EvalSinkOverflow` event) + **B4** (Phase 3 inspector facade) | `packages/eval-observability/src/inspector.ts` (modify), `packages/session-do-runtime/src/do/nano-session-do.ts` defaultEvalRecords (modify), `packages/hooks/src/catalog.ts` (consider new event), `docs/design/after-foundations/P3-context-management-inspector.md` (cite) | **dedup at sink入口 + overflow disclosure event** |

### Summary by target phase

| Phase | Findings affecting | Count |
|---|---|---|
| **B4 (Context-Management Package)** | F02 (inspector JSDoc), F04 (P3 inspector design cite) | 2 |
| **B5 (Hooks Catalog Expansion)** | F02 (NACP spec), F03 (catalog can extend), F04 (`EvalSinkOverflow` candidate event) | 3 |
| **B6 (NACP 1.2.0 + sink dedup)** | F02 (NACP spec), F04 (sink dedup ship) | 2 |
| **B7 (Round 2 integrated)** | F01 (callee-side abort propagation verify) | 1 |
| **B8 (handoff memo)** | F01 (latency baseline), F03 (hook contract), F02 (header lowercase) | 3 |

> **B5 + B6 承担本 rollup 的主线 writeback**（catalog 扩展 + 协议升级 + sink dedup 都集中在那）。

---

## §4 Unresolved / Dismissed Summary

**Unresolved (open，等 writeback)**: 4/4 findings 状态都是 `open`。

**Dismissed-with-rationale**: 0 — 没有 finding 被 dismiss。

**Round 2 必须验证**: 1
- `F01` cancellation：caller 端已确认 abort 触发，但 **callee 端是否真正中断**需要在 wrangler tail 上确认日志 `[slow] abort observed`。如 callee 端未中断，意味着 cancellation 仅 client-side、callee 仍 burn cpu_ms——这会改变 nano-agent 的 cross-worker timeout 设计。

---

## §5 Per-finding Doc Links

- [F01 — binding latency sub-10ms + cancellation works](spike-binding-pair/01-binding-latency-sub-10ms-and-cancellation-works.md)
- [F02 — anchor headers survive but lowercased](spike-binding-pair/02-anchor-headers-survive-but-lowercased.md)
- [F03 — hooks-callback latency + error shape confirmed](spike-binding-pair/03-hooks-callback-latency-and-error-shape-confirmed.md)
- [F04 — eval-fanin app-layer dedup required](spike-binding-pair/04-eval-fanin-app-layer-dedup-required.md)

---

## §6 Reference

- Charter: `docs/plan-after-foundations.md` §4.1 A
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Rollup spec: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §4.6
- Transport scope source: `docs/design/after-foundations/P0-spike-binding-pair-design.md` §0
- Related spike output: `spikes/round-1-bare-metal/spike-binding-pair/.out/2026-04-19T08-28-14Z.json`
- Phase 4 issue: `docs/issue/after-foundations/B1-phase-4-closure.md`
