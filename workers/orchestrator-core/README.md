# workers/orchestrator-core — orchestration-facade closed public façade

## Status

**orchestration-facade is closed and handoff-ready.**

`orchestrator-core` now owns the first-wave compatibility façade for session traffic:

- `POST /sessions/:id/start`
- `POST /sessions/:id/input`
- `POST /sessions/:id/cancel`
- `GET /sessions/:id/status`
- `GET /sessions/:id/timeline`
- `POST /sessions/:id/verify`
- `GET /sessions/:id/ws`

The worker now owns canonical public session ingress, while `agent-core` remains the runtime host behind guarded internal routes and typed legacy retirement.

## Final highlights

- probe marker rolled to `orchestration-facade-closed`
- session-facing live suites migrated here as canonical package-e2e owner
- public JWT ingress now enforces explicit `trace_uuid` + deploy-tenant truth
- legacy `agent-core /sessions/*` retirement is asserted from this suite

## Scripts

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm deploy:dry-run`
- `pnpm deploy:preview`

## Binding strategy

| Binding | Status | Notes |
| --- | --- | --- |
| `ORCHESTRATOR_USER_DO` | active | per-user session registry / ws owner |
| `AGENT_CORE` | active | service binding to runtime host |
| `JWT_SECRET` | runtime secret | public JWT ingress |
| `NANO_INTERNAL_BINDING_SECRET` | runtime secret | shared gate for `agent-core` internal routes |
| `TEAM_UUID` | preview/prod var | deploy tenant truth |
