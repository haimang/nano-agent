# workers/context-core — pre-worker-matrix shell

## Status

**Shell-only. No business logic yet.**

## Purpose

This is the pre-worker-matrix W4 shell for `context-core`. It only proves
that the worker shape, NACP imports, and Wrangler bundle path are valid.

Current dependency mode: `workspace:*`. Real context substrate absorption and
remote compact behavior land during worker-matrix Phase 0.

## Scripts

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm deploy:dry-run`
- `pnpm deploy:preview`

## Binding strategy

No active outgoing bindings in W4. Future remote wiring is documented in the
W3/W4 design docs and activated during worker-matrix.
