# @nano-agent/storage-topology

`storage-topology` is the shared storage semantics package. It defines hot/warm/cold placement vocabulary, tenant-scoped key/ref builders, MIME gates, D1/DO/KV/R2 adapters, evidence calibration, promotion/demotion/archive plans, and checkpoint candidate metadata. Worker-local mirrors exist under `workers/filesystem-core/src/storage/`, but this package is still consumed by workers and packages.

## Source map

```text
src/
├── taxonomy.ts / data-items.ts        # storage classes, backends and data item catalog
├── keys.ts / refs.ts                  # NACP-compatible tenant-scoped key/ref builders
├── placement.ts / calibration.ts      # placement hypotheses and evidence calibrator
├── mime-gate.ts                       # attachment MIME/size decision policy
├── checkpoint-candidate.ts            # checkpoint fragment candidates
├── promotion-plan.ts                  # promotion lifecycle contract
├── demotion-plan.ts / archive-plan.ts # demotion/archive planning contracts
├── adapters/                          # D1, DO storage, KV, R2 and scoped IO adapters
├── evidence.ts / errors.ts            # evidence and typed topology errors
└── index.ts                           # package exports
```

## Boundaries

- This package defines storage semantics; production ownership is still enforced by worker bindings and tenant-scoped IO.
- D1 SQL schema lives under `workers/orchestrator-core/migrations/`, not in this package.
- Keep refs parseable by `@haimang/nacp-core` and preserve `tenants/{team_uuid}/...` key prefixes.

## Validation

```bash
pnpm --filter @nano-agent/storage-topology typecheck
pnpm --filter @nano-agent/storage-topology build
pnpm --filter @nano-agent/storage-topology test
pnpm --filter @nano-agent/storage-topology build:schema
pnpm --filter @nano-agent/storage-topology build:docs
```
