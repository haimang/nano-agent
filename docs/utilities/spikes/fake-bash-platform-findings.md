# Spike Rollup — `fake-bash-platform-findings`

> **Rollup ID**: `fake-bash-platform-findings`
> **Spike**: `spike-do-storage` (V2 bash subset)
> **Round**: 1 (bare-metal)
> **Generated**: 2026-04-19
> **Author**: Opus 4.7 (1M context)
> **Charter requirement**: `docs/plan-after-foundations.md` §4.1 A 第 4 项 deliverable

---

## §0 V2A vs V2B Writeback Distinction (重要！)

> 修订自 `P0-spike-do-storage-design.md` r2 §4.7-4.8（GPT review §2.4 推动）。本 rollup 的 V2 finding 必须按 **目标 packages 不同** 严格区分 writeback：
>
> | 类别 | 目标 packages | 设计 intent |
> |---|---|---|
> | **V2A capability-parity** | `packages/capability-runtime/src/capabilities/*` | 验证当前 handler **contract** 在真实 DO 沙箱仍 hold；writeback = handler contract change（如不 hold） |
> | **V2B platform-stress** | Phase 2 (B3) `packages/capability-runtime` quota guard + Phase 3 (B4) `packages/context-management` budget policy | 验证 **Cloudflare Worker runtime 边界**；writeback = quota guard + size-aware routing |
> | **V2-bash-curl-quota** | B3 `packages/capability-runtime/src/capabilities/network.ts` | curl 接通时的 subrequest budget config |
>
> 不要把 V2A finding 误 writeback 到 quota guard 层；不要把 V2B finding 误 writeback 到 handler contract 层。

---

## §1 Finding Index

| # | ID | Title | Severity | Status | Class | Packages/ impact (one-line) |
|---|---|---|---|---|---|---|
| 7 | `spike-do-storage-F07` | V2A capability-parity 3/3 contracts hold | informational | open | **V2A** | (no contract change) — `filesystem.ts:9,53,120-127` + `search.ts` cap 全 hold |
| 8 | `spike-do-storage-F08` | DO storage value cap **1-10 MiB SQLITE_TOOBIG** | **high** | open | **V2B** | `DOStorageAdapter` size pre-check + `MemoryBackend` add `maxValueBytes` config |
| 9 | `spike-do-storage-F09` | curl quota 25 fetches no rate-limit (default target) | low | open | **V2-curl** | `network.ts` curl 接通时必须 subrequest budget config |

**Total**: 3 required findings (V2 全部覆盖)；0 optional in this rollup。

---

## §2 Severity Summary

| Severity | Count | IDs |
|---|---|---|
| **high** | 1 | F08 (DO size cap) |
| medium | 0 | — |
| informational | 1 | F07 (capability-parity holds) |
| **low** | 1 | F09 (low-volume curl baseline) |

> **Distribution observation**: 1/3 高 severity 是 DO 1-10 MiB hard cap（直接驱动 budget policy 设计）；1/3 informational 是好消息（12-pack contract hold）；1/3 low 需要 Round 2 高 volume 复跑（owner Q2 业主提供测试 URL）。

---

## §3 Writeback Destination Map

| Finding | Target phase | Target packages/ file(s) | Action class |
|---|---|---|---|
| **F07** (V2A) | **B3** (fake-bash extension policy) + **B8** (handoff) | (no packages/ change) | confirms 12-pack 现有 contract 可保留；B3 直接 port more just-bash 命令；handoff memo cite |
| **F08** (V2B) | **B2** (storage) + **B3** (fake-bash size guard) + **B4** (context-management budget policy) + **B7** (binary-search probe for exact cap) | `packages/storage-topology/src/adapters/do-storage-adapter.ts` (NEW), `packages/workspace-context-artifacts/src/backends/memory.ts` (modify), `packages/workspace-context-artifacts/src/promotion.ts` (review), `packages/context-management/async-compact/` (B4 design constraint), `packages/capability-runtime/src/capabilities/filesystem.ts` (write size check) | **size-aware routing across multiple packages**；DOStorageAdapter throws `ValueTooLargeError`；MemoryBackend 默认 `maxValueBytes=1MB`；> 1 MiB blob 强制走 R2 |
| **F09** (V2-curl) | **B3** (curl 接通) + **B7** (Round 2 高 volume probe with owner-supplied URL) | `packages/capability-runtime/src/capabilities/network.ts` | curl 接通后必须 per-turn subrequest budget；超 budget emit `capability.subrequest_budget_exhausted` |

### Summary by target phase

| Phase | Findings affecting | Count |
|---|---|---|
| **B2 (Storage Adapter Hardening)** | F08 (DOStorageAdapter size pre-check) | 1 |
| **B3 (Fake-Bash Extension)** | F07 (12-pack contract holds), F08 (write size check), F09 (curl quota guard) | **3** |
| **B4 (Context-Management Package)** | F08 (async-compact summary size constraint) | 1 |
| **B7 (Round 2 integrated)** | F08 (binary-search 1-10 MiB exact cap), F09 (高 volume curl with owner URL) | 2 |
| **B8 (handoff memo)** | F07 (V2A 3 contract validated) | 1 |

> **B3 承担本 rollup 的主线 writeback**（3/3 findings 都 touch B3，因为 fake-bash 扩展是 V2 的直接消费方）。

---

## §3.1 Known Caveats (post-GPT-review, 2026-04-19 r2)

Per `B1-final-closure.md` §Caveats: this rollup's 3 findings (F07 / F08 / F09) are **not directly affected** by the 6 GPT-identified closure issues (C1-C6). However:
- F09 curl quota high-volume follow-up (owner Q2 URL) is a Round-2 (B7) obligation already tracked in §3 Writeback destination map
- F08 DO-cap binary-search follow-up is a Round-2 (B7) obligation already tracked in §3

No C1-C6 caveat applies directly to fake-bash-platform findings; the only caveat is the standard "Round 2 follow-ups pending" for F08 + F09 (per P6 §4.2 + §4.3).

## §4 Unresolved / Dismissed Summary

**Unresolved (open，等 writeback)**: 3/3 findings 状态都是 `open`。

**Dismissed-with-rationale**: 0 — 没有 finding 被 dismiss。

**Round 2 必须复现 / 复跑**: 2
- `F08` DO size cap：需要 binary-search probe 确定 1-10 MiB 之间的精确数字（推测可能在 2-4 MiB 之间，与 SQLite 默认行为相关）
- `F09` curl quota：本轮仅 25 fetch baseline，需要业主 Q2 提供高 volume 测试 URL，跑 50/100/500/1000 阶梯找真实上限

---

## §5 Per-finding Doc Links

- [F07 — V2A capability-parity 3/3 contracts hold](spike-do-storage/07-bash-capability-parity-3-of-3-contracts-hold.md)
- [F08 — DO storage value cap between 1 MiB and 10 MiB](spike-do-storage/08-do-storage-value-cap-between-1mib-and-10mib.md)
- [F09 — curl quota 25 fetches no rate-limit](spike-do-storage/09-curl-quota-25-fetches-no-rate-limit-default-target.md)

---

## §6 Reference

- Charter: `docs/plan-after-foundations.md` §4.1 A + §2.2 V2
- Action plan: `docs/action-plan/after-foundations/B1-spike-round-1-bare-metal.md`
- Rollup spec: `docs/design/after-foundations/P0-spike-discipline-and-validation-matrix.md` §4.6
- V2 拆分 design: `docs/design/after-foundations/P0-spike-do-storage-design.md` r2 §4.7-4.9
- GPT review推动 V2 拆分: `docs/design/after-foundations/P0-reviewed-by-GPT.md` §2.4
- Related spike output: `the historical round-1 storage spike workspace`
- Phase 4 issue: `docs/issue/after-foundations/B1-phase-4-closure.md`
