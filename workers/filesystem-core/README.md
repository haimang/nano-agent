# workers/filesystem-core — library-only worker (ZX2 frozen)

## Status

**Library-only worker.** Per ZX2 (transport-profiles.md, 2026-04-27) this
worker stays as a deployment placeholder + `health-probe` profile only.
**Do not add business RPC routes here.** All real workspace / filesystem
runtime code is consumed in-process by `agent-core` via the workspace
package `@haimang/workspace-context-artifacts`. The deploy of
`filesystem-core` exists so `/debug/workers/health` can keep reporting a
stable 6-worker matrix.

## Why this is a deliberate decision

- W4.A absorbed the runtime code into agent-core (host-local).
- ZX2 evaluated promoting filesystem-core to a real RPC worker and
  explicitly declined: workspace truth lives in tenant-scoped R2 + DO,
  not at the worker boundary; promoting to RPC duplicates seam.
- Promotion to a real RPC worker is reserved for ZX3 / W5 if a concrete
  workload (e.g. cross-tenant sandbox) needs it.

## What `filesystem-core` is allowed to expose

| profile | route | semantic |
|---|---|---|
| `health-probe` | `GET /` `GET /health` | shell response with worker identity + absorbed runtime flags |
| (none) | every other path | 401 `binding-scope-forbidden` (ZX2 Phase 1 P1-03) |

The `binding-scope-forbidden` 401 is enforced in code so accidental
`workers_dev:true` exposure is defended even before wrangler config takes
effect.

## What `filesystem-core` is NOT allowed to do

- ❌ Expose business HTTP routes (`/files/*`, `/artifacts/*`, etc).
- ❌ Add new service bindings to other workers.
- ❌ Expose business HTTP routes (`/files/*`, `/artifacts/*`, etc) on public fetch.
- ✅ Expose service-binding RPC methods for internal callers.
- ❌ Hold its own public ingress truth. File metadata lives in D1 and bytes live in R2 behind service bindings.

## Scripts

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm deploy:dry-run`
- `pnpm deploy:preview`

## Binding strategy

No active outgoing bindings. `wrangler.jsonc` declares `workers_dev: false`
to keep this worker off the public internet.

## Health probe shape

```json
{
  "worker": "filesystem-core",
  "status": "ok",
  "worker_version": "filesystem-core@<env>",
  "phase": "worker-matrix-P4-absorbed",
  "absorbed_runtime": true,
  "nacp_core_version": "...",
  "nacp_session_version": "..."
}
```
