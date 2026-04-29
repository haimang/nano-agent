# @haimang/nacp-core

NACP-Core is the internal protocol and authority layer shared by workers, Durable Objects, and package-level runtime seams. It owns envelope validation, RPC error codes, tenant boundaries, transport profiles, evidence vocabulary, hook/message schemas, and tenant-scoped storage helpers.

## Current role

| Area | SSOT |
| --- | --- |
| Internal envelope | `Envelope<T>`, `validateEnvelope`, `encodeEnvelope`, `decodeEnvelope` |
| RPC errors | `RpcErrorCodeSchema` in `src/rpc.ts` |
| Authority / tenancy | `authority.team_uuid`, delegation, tenant-scoped IO |
| Transport profiles | service-binding, queue, DO-RPC and cross-seam helpers |
| Evidence vocabulary | evidence sink contract, storage law and hook catalog primitives |

## Source map

```text
src/
├── envelope.ts / errors.ts / error-registry.ts   # envelope validation and error taxonomy
├── rpc.ts                                        # internal RPC result/error code truth
├── messages/                                     # tool, hook, skill, context, system bodies
├── transport/                                    # service-binding, queue, DO-RPC, cross-seam profiles
├── tenancy/                                      # boundary checks, delegation, scoped IO wrappers
├── storage-law/                                  # tenant key/ref constants and builders
├── evidence/                                     # evidence vocabulary and sink contract
├── hooks-catalog/                                # hook event catalog
├── compat/                                       # protocol migration helpers
└── index.ts                                      # package root exports
```

## Relationship to public facades

`@haimang/orchestrator-auth-contract` extends this package's RPC error surface for facade-http-v1. If a new `RpcErrorCode` is added in `nacp-core`, add the same code to `FacadeErrorCodeSchema`; the contract package has compile-time subset assertions that should break the build if the surfaces drift.

## Validation

```bash
pnpm --filter @haimang/nacp-core typecheck
pnpm --filter @haimang/nacp-core build
pnpm --filter @haimang/nacp-core test
pnpm --filter @haimang/nacp-core build:schema
pnpm --filter @haimang/nacp-core build:docs
```
