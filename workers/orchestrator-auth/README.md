# workers/orchestrator-auth

`orchestrator-auth` is an internal-only auth worker. It owns registration/login/refresh/logout/API-key/device-token logic behind typed RPC contracts and is reached by `orchestrator-core`, not by public clients directly.

## Current role

| Surface | Status | Notes |
| --- | --- | --- |
| service-binding RPC | active | Consumed by `orchestrator-core/src/auth.ts`. |
| public HTTP | not canonical | Public auth wire is emitted by `orchestrator-core` as facade-http-v1. |
| D1 identity truth | active | Uses the shared `nano-agent-preview`/production D1 binding. |

## Source map

```text
src/
├── index.ts             # worker fetch/RPC adapter
├── public-surface.ts    # public-shaped auth operation handlers
├── service.ts           # typed auth service implementation
├── repository.ts        # D1 identity/session/API-key/device persistence
├── jwt.ts               # access/refresh JWT helpers
├── hash.ts              # password/API-key hashing helpers
├── errors.ts            # contract-aligned error mapping
└── wechat.ts            # WeChat credential/payload helpers
```

## Contract boundary

- Public HTTP shapes and facade errors are owned by `@haimang/orchestrator-auth-contract` and re-emitted by `orchestrator-core`.
- Repository writes must keep D1 identity/team/session/device tables aligned with `workers/orchestrator-core/migrations/001-identity-core.sql` and `005-user-devices.sql`.
- Do not introduce a second public auth envelope in this worker.

## Validation

```bash
pnpm --filter @haimang/orchestrator-auth-worker typecheck
pnpm --filter @haimang/orchestrator-auth-worker build
pnpm --filter @haimang/orchestrator-auth-worker test
pnpm --filter @haimang/orchestrator-auth-worker deploy:dry-run
```
