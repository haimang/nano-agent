# workers/filesystem-core — pre-worker-matrix shell

## Status

**Shell-only. No business logic yet.**

## Purpose

This is the pre-worker-matrix W4 shell for `filesystem-core`. It validates
that the worker shape, NACP imports, and Wrangler bundle path are ready.

Current dependency mode: `workspace:*`. Real workspace authority logic lands
later during worker-matrix Phase 0.

## Scripts

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm deploy:dry-run`
- `pnpm deploy:preview`

## Binding strategy

W4 keeps this shell stateless. Durable storage and service bindings are
introduced only when the real filesystem authority is absorbed.
