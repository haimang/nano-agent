# workers/bash-core — pre-worker-matrix shell

## Status

**Shell-only. No business logic yet.**

## Purpose

This is the pre-worker-matrix W4 shell for `bash-core`. Its job at this
phase is to validate:

- `wrangler.jsonc` parses
- NACP package imports resolve
- the shell bundles and can pass `wrangler deploy --dry-run`

Current dependency mode: `workspace:*`. Real fake-bash absorption remains a
worker-matrix P0 task per the W3 blueprints.

## Scripts

- `pnpm build`
- `pnpm typecheck`
- `pnpm test`
- `pnpm deploy:dry-run`
- `pnpm deploy:preview`

## Binding strategy

No outgoing bindings are active in W4. `bash-core` stays a plain fetch shell
until worker-matrix Phase 0 absorbs the real capability runtime.
