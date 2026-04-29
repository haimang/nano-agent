# @nano-agent/workspace-context-artifacts

`workspace-context-artifacts` is the shared workspace/context/artifact semantics package. It is still consumed by `agent-core` and by context/filesystem tests while worker-local slices exist under `workers/context-core/src/` and `workers/filesystem-core/src/`.

## Source map

```text
src/
├── types.ts / paths.ts / refs.ts       # workspace paths and NACP-compatible artifact refs
├── mounts.ts / namespace.ts            # mount router and namespace access
├── backends/                           # memory/reference backend seams
├── artifacts.ts / prepared-artifacts.ts# artifact stores and prepared artifact refs
├── promotion.ts                        # artifact promotion helpers
├── context-layers.ts                   # context layer model
├── context-assembler.ts                # budget-aware context assembly
├── compact-boundary.ts                 # compact request/response boundary contract
├── snapshot.ts                         # workspace snapshot fragment builder
├── redaction.ts                        # client-safe redaction helpers
├── evidence-emitters.ts                # NACP evidence emitters
└── index.ts                            # package exports
```

## Boundaries

- Artifact refs must keep tenant-scoped `tenants/{team_uuid}/...` keys and remain structurally compatible with `NacpRefSchema`.
- Storage topology, final R2/D1/KV placement and adapter logic belongs to `@nano-agent/storage-topology` and worker bindings.
- Context-core/filesystem-core mirrors should stay aligned with package behavior until ownership is intentionally switched.

## Validation

```bash
pnpm --filter @nano-agent/workspace-context-artifacts typecheck
pnpm --filter @nano-agent/workspace-context-artifacts build
pnpm --filter @nano-agent/workspace-context-artifacts test
```
