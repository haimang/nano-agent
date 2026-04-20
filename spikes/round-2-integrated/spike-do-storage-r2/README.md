# spike-do-storage-r2 — Integrated storage/context/bash validation

> Expiration: 2026-08-01
> Governing plan: `docs/action-plan/after-foundations/B7-spike-round-2-integrated.md`

## What this worker does

Re-runs Round 1 storage / context / fake-bash findings through the
**shipped** `@nano-agent/*` packages and captures the four round-2-specific
follow-ups the B1 final closure deferred:

- `F08` — DO `state.storage.put()` value cap **binary-search**
  between 1 MiB and 10 MiB (Round 1 only bounded it to the 1–10 MiB range).
- `unexpected-F01` — R2 `put()` concurrent-write baseline at 10 / 50 / 100 / 200.
- `F03` — KV stale read with **cross-colo** delay buckets, 100 samples,
  `cacheTtl: 0` variant. Gated on `F03_CROSS_COLO_ENABLED=true`.
- `F09` — high-volume curl at 50 / 100 / 200 / 500 / 1000 against an
  owner-supplied URL. Gated on `F09_OWNER_URL`.

And runs integration re-validation for:

- Storage: `R2Adapter / KvAdapter / DOStorageAdapter / D1Adapter /
  ReferenceBackend / MemoryBackend` from `@nano-agent/storage-topology`.
- Bash: `CapabilityExecutor / CapabilityPolicyGate / InMemoryCapabilityRegistry`
  from `@nano-agent/capability-runtime`.
- Context: `BudgetPolicy / AsyncCompactOrchestrator` from
  `@nano-agent/context-management`.

## Routes

```
GET  /healthz                                           liveness
POST /probe/follow-ups/do-size-cap-binary-search        F08
POST /probe/follow-ups/r2-concurrent-put                unexpected-F01
POST /probe/follow-ups/kv-cross-colo-stale              F03 (gated)
POST /probe/follow-ups/curl-high-volume                 F09 (gated)
POST /probe/re-validation/storage                       F01/F02/F04/F05/F06/F08 (shipped-seam)
POST /probe/re-validation/bash                          F07/F09 (shipped-seam, conservative)
POST /probe/re-validation/context                       B4 async-compact lifecycle
GET  /inspect/last-run                                  debug echo
```

## Scripts

- `scripts/deploy.sh` — deploy with owner's wrangler credentials.
- `scripts/run-all-probes.sh` — run every route sequentially, write
  `.out/{route}.json`, verify exit code.
- `scripts/extract-finding.ts` — convert `.out/*.json` into `closure
  section` drafts for `docs/spikes/spike-do-storage/*.md`.

## Local simulation

The `re-validation/*` modules support a `mode: "local"` parameter that
drives the same logic against in-memory `MemoryBackend` + vitest doubles,
so this repo's `test/*.test.mjs` can exercise the seam-level assertions
without Cloudflare credentials.

## Gates

- `F09_OWNER_URL`: must be set to a real owner-supplied URL before
  `curl-high-volume` will run above the conservative budget.
- `F03_CROSS_COLO_ENABLED`: must be `"true"` and the account must
  actually support cross-colo deploys before the cross-colo probe runs.

If a gate is not satisfied the probe returns
`{ success: false, gate: "<gate-name>", skipped: true }` — it does
**not** substitute a same-colo or default-URL run.
