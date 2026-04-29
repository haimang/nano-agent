# @haimang/orchestrator-auth-contract

This package owns the typed auth RPC contract between `orchestrator-core` and `orchestrator-auth`, plus the public facade-http-v1 envelope/error helpers re-emitted by `orchestrator-core`.

## Source map

```text
src/
├── index.ts              # Auth RPC request/result schemas, access claims, service interface
├── auth-error-codes.ts   # Auth error-code taxonomy
└── facade-http.ts        # FacadeEnvelope<T>, FacadeErrorCode, helpers and subset assertions
```

## Envelope relationship

```text
@haimang/nacp-core
  Envelope<T>, RpcErrorCode
        │
        ▼
@haimang/orchestrator-auth-contract
  Auth RPC contracts and AuthErrorCode
        │
        ▼
facade-http-v1
  FacadeEnvelope<T>, FacadeErrorCode
```

Rules:

- `FacadeErrorCode` must be a superset of `AuthErrorCode`.
- `FacadeErrorCode` must be a superset of `RpcErrorCode`.
- Public clients should see facade-http-v1 from `orchestrator-core`; `orchestrator-auth` remains internal.

## Main exports

| Export family | Purpose |
| --- | --- |
| `AccessTokenClaimsSchema`, `AccessTokenClaims` | JWT/access claim validation shared by auth and facade |
| `AuthRpcRequestSchema`, `OrchestratorAuthRpcService` | service-binding contract |
| `AuthErrorCodeSchema`, `AuthErrorCode` | internal auth error taxonomy |
| `FacadeEnvelope`, `FacadeError`, `facadeOk`, `facadeError`, `facadeFromAuthEnvelope` | public HTTP wire helpers |

## Validation

```bash
pnpm --filter @haimang/orchestrator-auth-contract typecheck
pnpm --filter @haimang/orchestrator-auth-contract build
pnpm --filter @haimang/orchestrator-auth-contract test
```
