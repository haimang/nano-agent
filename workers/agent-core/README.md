# workers/agent-core — runtime host + retired public session edge

## Status

`agent-core` is the absorbed session runtime host. After orchestration-facade F3 it no longer owns canonical public session ingress.

- `GET /` / `GET /health` probe stays available
- guarded `/internal/sessions/:session_uuid/*` remains active for `orchestrator-core`
- legacy public `/sessions/:session_uuid/*` now returns typed retirement envelopes (`HTTP 410` / `WS 426`)

## Purpose in F3+

`agent-core` keeps the real session runtime loop and the guarded internal seam that
lets `orchestrator-core` call:

- `start`
- `input`
- `cancel`
- `status`
- `timeline`
- `verify`
- `stream`

The runtime still reuses the existing DO/HTTP fallback/timeline machinery underneath; only public ownership moved.

## Scripts

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm deploy:dry-run`
- `pnpm deploy:preview`

## Binding strategy

| Binding | Status | Notes |
| --- | --- | --- |
| `SESSION_DO` | active | real session host |
| `BASH_CORE` | active | current remote capability worker |
| `CONTEXT_CORE` | commented | still host-local in first-wave |
| `FILESYSTEM_CORE` | commented | still host-local in first-wave |
| `NANO_INTERNAL_BINDING_SECRET` | runtime secret | required for `/internal/*` |
