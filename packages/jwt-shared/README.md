# @haimang/jwt-shared

`jwt-shared` is the shared HMAC JWT helper package used by `orchestrator-core` and `orchestrator-auth`. It prevents token signing/verification drift between public facade ingress and the internal auth worker.

## Source map

```text
src/
├── index.ts      # signing, verification and helper exports
└── *.test.ts     # package-local JWT behavior tests
```

## Boundaries

- Keep JWT cryptographic behavior here instead of duplicating HMAC logic in workers.
- Public claim shape is still governed by `@haimang/orchestrator-auth-contract`; this package should stay focused on token mechanics.
- Do not commit secrets or environment-specific keys into tests/docs.

## Validation

```bash
pnpm --filter @haimang/jwt-shared typecheck
pnpm --filter @haimang/jwt-shared build
pnpm --filter @haimang/jwt-shared test
```
