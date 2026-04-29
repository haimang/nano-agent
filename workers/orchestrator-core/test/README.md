# workers/orchestrator-core/test

Package-local Vitest suite for the public facade, User DO runtime, D1-backed read/write models, and product endpoint behavior.

## File map

| Area | Representative files |
| --- | --- |
| auth/facade | `auth.test.ts`, `kid-rotation.test.ts`, `parity-bridge.test.ts` |
| route smoke | `smoke.test.ts`, `messages-route.test.ts`, `files-route.test.ts`, `models-route.test.ts` |
| user surfaces | `me-conversations-route.test.ts`, `me-devices-route.test.ts` |
| policy/interaction | `permission-decision-route.test.ts`, `elicitation-answer-route.test.ts`, `policy-permission-mode-route.test.ts` |
| User DO/runtime | `user-do.test.ts`, runtime-focused helpers and mocks |
| usage/model evidence | `usage-strict-snapshot.test.ts`, RH5 model/image/reasoning cases |

## Run

```bash
pnpm --filter @haimang/orchestrator-core-worker test

# Target one file
pnpm --filter @haimang/orchestrator-core-worker exec vitest run test/messages-route.test.ts
```

## Test boundary

- This suite uses worker-local mocks/fakes and should be the first stop for facade or User DO logic changes.
- Root live/package/cross E2E coverage is indexed in `test/index.md`.
- D1 migration shape is validated through `workers/orchestrator-core/migrations/` apply checks, while route tests validate runtime query behavior.
