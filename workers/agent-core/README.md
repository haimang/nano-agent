# workers/agent-core — pre-worker-matrix shell

## Status

**Shell-only. No business logic yet.**

## Purpose

This is the pre-worker-matrix W4 shell for `agent-core`. Its job at this
phase is to validate:

- `wrangler.jsonc` parses
- NACP package imports resolve
- the Durable Object slot exists in deploy-shaped form
- the Cloudflare deploy pipeline is ready for a later real host runtime

Current dependency mode: `workspace:*`. The published path
`@haimang/nacp-core@1.4.0` + `@haimang/nacp-session@1.3.0` already exists,
but this shell keeps the local workspace path for the first cut.

Real business code will be absorbed here during worker-matrix Phase 0,
following the W3 blueprints and the W4 closure memo.

## Scripts

- `pnpm build` — compile TypeScript to `dist/`
- `pnpm typecheck` — run `tsc --noEmit`
- `pnpm test` — run shell smoke tests
- `pnpm deploy:dry-run` — bundle the worker with Wrangler
- `pnpm deploy:preview` — deploy the preview shell when owner credentials exist

## Binding strategy

| Binding | Status | Notes |
| --- | --- | --- |
| `SESSION_DO` | active shell slot | bound to `NanoSessionDO` stub |
| `BASH_CORE` | documented future slot | activated during worker-matrix P0 |
| `CONTEXT_CORE` | documented future slot | activated during worker-matrix P0 |
| `FILESYSTEM_CORE` | documented future slot | activated during worker-matrix P0 |
| `KV_CONFIG` / `R2_ARTIFACTS` | intentionally omitted | owner-managed resources stay out of W4 |

## Preview URL

To be recorded in `docs/issue/pre-worker-matrix/W4-closure.md` after a real
preview deploy becomes possible.
