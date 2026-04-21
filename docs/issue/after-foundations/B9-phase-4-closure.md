# B9 Phase 4 — Contract Tests + B8 Handoff Backfill Closure

> Status: `closed`
> Closed: 2026-04-21
> Owner: Claude Opus 4.7 (1M context)
> Phase goal: lock shipped contracts with root tests; close B8 review R1/R2/R3; final regression

---

## 1. Root contract tests shipped

- `test/nacp-1-3-matrix-contract.test.mjs` — 6 tests: core matrix coverage, session matrix coverage, both reject illegal combinations, `wrapAsError` roundtrip, version bumps landed
- `test/tenant-plumbing-contract.test.mjs` — 4 tests: DO ingress accept path, checkpoint+LAST_SEEN_SEQ write under `tenants/<team>/`, **source-code white-list check replacing B9-original `state.storage.*` false-green grep (GPT-R3 integration)**, http-controller no-hardcoded-1.1.0 (GPT-R4 integration)
- `test/initial-context-schema-contract.test.mjs` — 7 tests: valid shapes parse, empty parses, passthrough unknown keys, invalid reject, SessionStartBodySchema back-compat

## 2. Regression

- `pnpm -r run test` — all 11 packages green (247 + 119 + 357 + 198 + 208 + 352 + 103 + 169 + 192 + 97 = 2242 package-level assertions)
- `node --test test/*.test.mjs` — **94 / 94 green** (77 existing + 17 new B9 tests)
- `npm run test:cross` — **108 / 108 green**
- `test/b7-round2-integrated-contract.test.mjs` — 5 / 5 green (B7 LIVE wire contract preserved)

## 3. Documentation backfill

- `docs/handoff/after-foundations-to-worker-matrix.md` — new §11 (NACP 1.3 prerequisite), §12 (tenant plumbing checklist), §13 (upstream orchestrator interface)
- `docs/issue/after-foundations/after-foundations-final-closure.md` — §6 readiness block appended with items 5 and 6
- `docs/code-review/after-foundations/B8-docs-reviewed-by-opus.md` — §6 response section appended marking R1/R2/R3 fixed

## 4. Known deferrals
- **O11** — per-verb response body migration (separate PR)
- **O12** — `LEGACY_ALIAS_REGISTRY` runtime machinery (RFC-level only remains)
- **O13** — virtual seam names (`tenantIngressVerify` / `contextCore.ingestFromUpstream`) removed; only shipped symbols (`verifyTenantBoundary`, `tenantDoStorage*`) used
