# B9 Final Closure — NACP 1.3 Contract Freeze

> Status: `closed` ✅ (revised 2026-04-21 after GPT second-round review)
> Closed: 2026-04-21
> Owner: Claude Opus 4.7 (1M context)
> Successor: worker matrix Phase 0 (unblocked)
>
> **Revision note**: A second-round GPT review (`docs/code-review/after-foundations/B9-reviewed-by-GPT.md`) flagged two correctness gaps — `verifyTenantBoundary()` was fire-and-forget (R1 blocker) and `wrapAsError()` was claimed as shipped helper without honest provisional posture (R2). Both were fixed in-place; negative-case tests were added; this closure's wording has been narrowed accordingly. See §8 below.

---

## 0. One-sentence verdict

B9 froze the three after-foundations consensus layers that were previously shipped-but-unenforced (double-axis envelope legality, standard error body, tenant plumbing) + hardened the upstream orchestrator interface, and it did so with **zero breaking change** at the package-consumer level. Worker matrix Phase 0 is now unblocked.

## 1. Shipped packages

| package | before | after | breaking? |
|---|---|---|---|
| `@nano-agent/nacp-core` | `1.1.0` | **`1.3.0`** | no |
| `@nano-agent/nacp-session` | `1.1.0` | **`1.3.0`** | no |
| `@nano-agent/session-do-runtime` | `0.1.0` (CHANGELOG head `0.2.0`) | **`0.3.0`** (baseline drift fixed) | no |

## 2. Contract delta

- **Core Layer-6 validator** — `NACP_CORE_TYPE_DIRECTION_MATRIX` covers 11 core types; `validateEnvelope()` now rejects illegal `(message_type × delivery_kind)` combinations with `NACP_TYPE_DIRECTION_MISMATCH`. Conservative first-publish rule (RFC §2.4) honored.
- **Session-side matrix** — `NACP_SESSION_TYPE_DIRECTION_MATRIX` covers 8 session types; `validateSessionFrame()` rejects with `NACP_SESSION_TYPE_DIRECTION_MISMATCH`. Owned by the session profile (GPT-R1 integration).
- **Standard error body** — `NacpErrorBodySchema` + `NACP_ERROR_BODY_VERBS` registry (empty at B9) shipped. `wrapAsError()` ships as an explicitly **provisional** helper: it does not self-validate, and its output will not pass `validateEnvelope()` against any shipped verb until the per-verb migration PR (RFC §3.2 / O11) lands. The helper becomes materially useful the moment a new worker-matrix-era verb registers in `NACP_ERROR_BODY_VERBS`.
- **Naming law** — RFC-level only; no runtime alias machinery (RFC §4.3 / O12).
- **Upstream context wire hook** — `SessionStartInitialContextSchema` (4 optional sub-fields + passthrough) replaces the loose `z.record(...)`; `SessionStartBodySchema` tightens without breaking existing payloads.
- **Tenant plumbing materialization** — `NanoSessionDO.acceptClientFrame()` is `async` and `await`s `verifyTenantBoundary()` on every validated frame; boundary-violation converts to a typed rejection so `dispatchAdmissibleFrame()` is gated by the verification outcome (GPT-R1 integration). All DO storage goes through `getTenantScopedStorage()` (5 use-sites rewritten; source-code white-list enforced by contract test).

## 3. Test state

| scope | count | outcome |
|---|---|---|
| `pnpm --filter @nano-agent/nacp-core test` | 247 | green |
| `pnpm --filter @nano-agent/nacp-session test` | 119 | green |
| `pnpm --filter @nano-agent/session-do-runtime test` | 357 | green |
| all other packages | unchanged | green |
| `node --test test/*.test.mjs` | **94** (77 existing + 17 new B9) | green |
| `npm run test:cross` | **108** | green |
| `test/b7-round2-integrated-contract.test.mjs` | 5 | green (B7 LIVE wire contract preserved) |

## 4. GPT review (2026-04-21) integration summary

| finding | severity | integrated how |
|---|---|---|
| B9-R1 (matrix ownership) | high | Split into core matrix + session matrix; two independent consumers |
| B9-R2 (error-body + naming scope) | high | Error-body helper-only + naming RFC-level; O11/O12 added to out-of-scope |
| B9-R3 (fictional seams) | high | `tenantIngressVerify` / `contextCore.ingestFromUpstream` removed; only shipped `verifyTenantBoundary` + `tenantDoStorage*` used; grep rewritten as source-code white-list |
| B9-R4 (version baseline) | medium | `http-controller.ts` hardcoded `"1.1.0"` replaced by `NACP_VERSION`; session-do-runtime `0.1.0 / CHANGELOG 0.2.0` drift fixed; contract-tested |
| B9-R5 (doc path drift) | low | `docs/code-review/B8-...` paths fixed to `docs/code-review/after-foundations/B8-...` |

## 5. Closed items

- 4 phase closures: `B9-phase-{1,2,3,4}-closure.md`
- B8 review close-out (R1/R2/R3) appended to `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` §6
- B8 handoff memo §11/§12/§13 added
- `after-foundations-final-closure.md` §6 readiness statement updated (Phase 0 unblocked)

## 6. Carry-over for worker matrix

- **O11** — per-verb response shape migration (separate PR; do not silently reshape in worker code)
- **O7** — `DOStorageAdapter.maxValueBytes` 1 MiB → 2 MiB (worker matrix Phase 0 or independent calibration PR)
- **F03 / F09** — platform gates; owner-side action unaffected

## 7. Final exit verdict

**✅ B9 closed.** The after-foundations protocol surface is now consistent, orthogonal, and enforced. Worker matrix Phase 0 may begin.

---

## 8. Second-round GPT review integration (2026-04-21)

| finding | severity | disposition | shipped fix |
|---|---|---|---|
| **B9-R1** — `verifyTenantBoundary()` was fire-and-forget; tenant-violating frames reached dispatch | blocker | **fixed** | `acceptClientFrame()` changed to `async` and `await`s boundary verify; rejection is typed + returned; caller's `if (!envelope.ok) return;` gate now blocks dispatch. Negative-case test added at `test/tenant-plumbing-contract.test.mjs` ("tenant violation blocks dispatch"). |
| **B9-R2** — `wrapAsError()` claims (RFC §3 + closure) overclaimed a helper that does not yet produce a valid 1.3 envelope | high | **fixed via scope narrow + registry + tests** | Helper is now explicitly labeled **provisional** in JSDoc / RFC §3.1 / CHANGELOG / closure. Added `NACP_ERROR_BODY_VERBS: ReadonlySet<string>` (empty at B9; populated by migration PR). Added optional `overrides.target_message_type` so callers can target the response verb. Two new root tests lock honest reality: "registry empty" + "output NOT yet valid under 1.3 surface". |
| **B9-R3** — `packages/nacp-session/README.md` carried stale "imports `isMessageAllowedInPhase` from Core" phrasing | low | **fixed** | README §"Relationship to NACP-Core" rewritten to reflect session-owned phase matrix + B9 session-side `(message_type × delivery_kind)` matrix ownership. |

Integration verdict: the two correctness gaps GPT flagged no longer hold. Closure wording has been narrowed where it was overclaiming (`wrapAsError` is now explicitly provisional). `worker matrix Phase 0 unblocked` remains valid because the tenant-verify gate is now load-bearing (not just decorative), and the provisional error-body helper is correctly labeled as "ready to materialize when the per-verb PR lands."
