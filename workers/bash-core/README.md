# workers/bash-core

`bash-core` is the governed fake-bash capability worker. It owns the command registry, permission policy, target dispatch, and service-binding runtime used by `agent-core` when a session turns tool calls into executable capability work.

## Current role

| Surface | Status | Notes |
| --- | --- | --- |
| `GET /`, `GET /health` | public probe | Version and package compatibility check. |
| capability RPC | internal only | Accepts NACP/RPC-shaped tool-call work from trusted callers. |
| shell execution | governed fake-bash | No ambient host shell; commands pass registry and permission policy. |

## Source map

```text
src/
├── index.ts                    # worker fetch/probe entrypoint
├── worker-runtime.ts           # internal request handling
├── tool-call.ts                # tool-call envelope handling
├── registry.ts                 # command registry
├── policy.ts / permission.ts   # guardrails and permission decisions
├── executor.ts / result.ts     # execution result normalization
├── fake-bash/                  # fake-bash bridge, command parser, unsupported commands
├── capabilities/               # exec, filesystem, network, search, text, vcs, workspace truth
└── targets/                    # browser rendering, local TypeScript, service binding target
```

## Execution rules

- Treat the command registry as the capability SSOT; do not bypass it with ad-hoc shell execution.
- Preserve NACP envelopes and authority/trace metadata across service-boundary calls.
- Browser/local/service-binding targets are selected by policy, not by untrusted client input alone.

## Validation

```bash
pnpm --filter @haimang/bash-core-worker typecheck
pnpm --filter @haimang/bash-core-worker build
pnpm --filter @haimang/bash-core-worker test
pnpm --filter @haimang/bash-core-worker deploy:dry-run
```
