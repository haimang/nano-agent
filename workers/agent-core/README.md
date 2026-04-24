# workers/agent-core — runtime host + legacy public edge

## Status

`agent-core` is no longer a shell-only worker. It is the absorbed session runtime host,
and during orchestration-facade F1 it carries **two** ingress postures:

- legacy public `/sessions/:session_uuid/*` (still canonical until F3 cutover)
- guarded `/internal/sessions/:session_uuid/*` for `orchestrator-core`

## Purpose in F1

F1 does **not** rewrite the runtime loop. It only adds the minimum internal seam that
lets `orchestrator-core` call:

- `start`
- `input`
- `cancel`
- `stream`

The runtime still reuses the existing DO/HTTP fallback/timeline machinery underneath.

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
