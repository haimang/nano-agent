# workers/context-core — library-only worker (ZX2 frozen)

## Status

**Library-only worker.** Per ZX2 (transport-profiles.md, 2026-04-27) this
worker stays as a deployment placeholder + `health-probe` profile only.
**Do not add business RPC routes here.** All real context-substrate
runtime code is consumed in-process by `agent-core` via the workspace
package `@haimang/context-management`. The deploy of `context-core`
exists so `/debug/workers/health` can keep reporting a stable 6-worker
matrix.

## Why this is a deliberate decision

- W3.A absorbed the runtime code into agent-core (host-local).
- ZX2 evaluated promoting context-core to a real RPC worker and explicitly
  declined: the migration cost is non-trivial and the immediate value is
  small (no cross-tenant boundary, no quota, no isolation gain).
- Promotion to a real RPC worker is reserved for ZX3 / W5 if a concrete
  workload needs it.

## What `context-core` is allowed to expose

| profile | route | semantic |
|---|---|---|
| `health-probe` | `GET /` `GET /health` | shell response with worker identity + absorbed runtime flags |
| (none) | every other path | 401 `binding-scope-forbidden` (ZX2 Phase 1 P1-03) |

The `binding-scope-forbidden` 401 is enforced in code (see
`src/index.ts:bindingScopeForbidden`) so accidental `workers_dev:true`
exposure is defended even before wrangler config takes effect.

## What `context-core` is NOT allowed to do

- ❌ Expose business HTTP routes (`/context/*`, `/compact/*`, etc).
- ❌ Add new service bindings to other workers.
- ❌ Expose business HTTP routes (`/context/*`, `/compact/*`, etc) on public fetch.
- ✅ Expose service-binding RPC methods for internal callers.
- ❌ Talk to D1 / R2 / KV. The workspace package owns storage truth.

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
  "worker": "context-core",
  "status": "ok",
  "worker_version": "context-core@<env>",
  "phase": "worker-matrix-P3-absorbed",
  "absorbed_runtime": true,
  "nacp_core_version": "...",
  "nacp_session_version": "..."
}
```
