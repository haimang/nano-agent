# workers/context-core

`context-core` is a library-runtime worker plus health-probe shell. It is not a public business HTTP API. The source tree owns context assembly, compact boundaries, async compact planning, budget policy, redaction, snapshot fragments and inspector helpers that can be consumed by trusted in-process or future service-binding paths.

## Current role

| Surface | Status | Notes |
| --- | --- | --- |
| `GET /`, `GET /health` | probe only | Keeps the 6-worker matrix observable. |
| public business routes | forbidden | Non-probe HTTP paths return `binding-scope-forbidden`. |
| runtime modules | active library code | Used by worker-local tests and ready for controlled internal promotion. |

## Source map

```text
src/
├── index.ts                         # probe and forbidden-route guard
├── context-assembler.ts             # layer selection and budget-aware assembly
├── context-layers.ts                # layer types and helpers
├── compact-boundary.ts              # compact request/response boundary contract
├── snapshot.ts                      # workspace/context snapshot fragment
├── redaction.ts                     # client-safe redaction helpers
├── budget/                          # context budget policy/env/types
├── async-compact/                   # planner, scheduler, committer, retry/fallback
├── context-api/                     # append initial context layer facade
└── inspector-facade/                # inspector auth/redaction/usage report helpers
```

## Boundaries

- Do not add public `/context/*` or `/compact/*` HTTP routes without changing the worker topology charter.
- Storage operations must remain tenant-scoped through NACP/storage-topology seams.
- This worker can grow internal RPC later, but current public exposure remains health-only.

## Validation

```bash
pnpm --filter @haimang/context-core-worker typecheck
pnpm --filter @haimang/context-core-worker build
pnpm --filter @haimang/context-core-worker test
pnpm --filter @haimang/context-core-worker deploy:dry-run
```
