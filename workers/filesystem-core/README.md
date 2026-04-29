# workers/filesystem-core

`filesystem-core` is a library-runtime worker plus health-probe shell. It owns workspace paths, mounts, namespace routing, artifact references, prepared artifacts, promotion helpers, evidence emitters, and storage-topology mirrors. Public file ingress still goes through `orchestrator-core` and service bindings.

## Current role

| Surface | Status | Notes |
| --- | --- | --- |
| `GET /`, `GET /health` | probe only | Keeps the 6-worker matrix observable. |
| public business routes | forbidden | No public `/files/*` or `/artifacts/*` API here. |
| runtime modules | active library code | Used by tests and future controlled internal service promotion. |

## Source map

```text
src/
├── index.ts                         # probe and forbidden-route guard
├── paths.ts / refs.ts / types.ts    # workspace and artifact type system
├── mounts.ts / namespace.ts         # mount router and namespace access
├── artifacts.ts                     # artifact metadata and D1/R2 seam helpers
├── prepared-artifacts.ts            # prepared-artifact references
├── promotion.ts                     # artifact promotion helpers
├── backends/                        # memory/reference backend seams
├── storage/                         # topology mirror: keys, refs, placement, MIME, adapters
└── evidence-emitters-filesystem.ts  # NACP evidence records for filesystem events
```

## Boundaries

- D1 stores metadata such as `nano_session_files`; R2 stores bytes. Do not make this worker a separate public truth source.
- Tenant-scoped refs and keys must stay aligned with `@haimang/nacp-core`.
- Public file APIs are facade-owned until the topology charter explicitly promotes this worker.

## Validation

```bash
pnpm --filter @haimang/filesystem-core-worker typecheck
pnpm --filter @haimang/filesystem-core-worker build
pnpm --filter @haimang/filesystem-core-worker test
pnpm --filter @haimang/filesystem-core-worker deploy:dry-run
```
