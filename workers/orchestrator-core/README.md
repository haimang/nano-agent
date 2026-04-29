# workers/orchestrator-core

`orchestrator-core` is the only public live entrypoint for the 6-worker system. It owns facade-http-v1, product endpoints, User DO routing, D1/R2/KV truth access, and service-binding fan-out to auth/runtime/capability workers.

## Current role

| Surface | Status | Notes |
| --- | --- | --- |
| `/auth/*` | public facade | Proxies typed auth RPC through `orchestrator-auth-contract`. |
| `/sessions/*` | public facade | Starts, resumes, inputs, cancels, verifies, reads status/timeline, and attaches WS. |
| `/sessions/:id/messages` | public product endpoint | RH5 multimodal/model/reasoning request surface. |
| `/sessions/:id/files` | public product endpoint | Reads D1 file metadata backed by R2 object truth. |
| `/me/*` | public product endpoints | Conversations, devices and related user surfaces. |
| `/models` | public catalog endpoint | Reads D1 model catalog and team policy. |
| `ORCHESTRATOR_USER_DO` | active | Per-user durable orchestration and WebSocket owner. |

## Source map

```text
src/
├── index.ts                         # public fetch facade and route dispatch
├── entrypoint.ts                    # WorkerEntrypoint export
├── auth.ts                          # orchestrator-auth service-binding client
├── frame-compat.ts / ws-bridge.ts   # NACP session frame compatibility and WS bridge
├── session-truth.ts                 # D1 session/conversation/message writes
├── session-read-model.ts            # D1 read models for public products
├── session-lifecycle.ts             # lifecycle helpers and redaction
├── policy/authority.ts              # authority/tenant policy guards
├── user-do.ts                       # thin public Durable Object facade
├── user-do-runtime.ts               # User DO coordinator
└── user-do/                         # RH6 split: durable truth, agent RPC, ws, session/message/surface flows
```

## D1 migration SSOT

`migrations/` is organized by business cluster and is the DDL source of truth for preview/test rebuilds:

```text
migrations/
├── 001-identity-core.sql            # users, identities, teams, auth sessions, API keys
├── 002-session-truth-and-audit.sql  # conversations, sessions, turns, messages, audit view
├── 003-usage-quota-and-models.sql   # quota, usage events, model catalog/policy, model seed
├── 004-session-files.sql            # D1 metadata for R2-backed session files
└── 005-user-devices.sql             # device truth and revoke audit
```

When adding schema, prefer extending the correct business cluster or adding one forward migration for an actual production delta; do not reintroduce preview-only repair fragments.

## Validation

```bash
pnpm --filter @haimang/orchestrator-core-worker typecheck
pnpm --filter @haimang/orchestrator-core-worker build
pnpm --filter @haimang/orchestrator-core-worker test
pnpm --filter @haimang/orchestrator-core-worker deploy:dry-run
```
