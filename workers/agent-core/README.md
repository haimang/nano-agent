# workers/agent-core

`agent-core` is the private session-runtime host. Public session ownership lives in `orchestrator-core`; this worker keeps the Session DO, kernel, tool/hook/eval/LLM runtime, and guarded internal HTTP/WS seam used by the public facade.

## Current role

| Surface | Status | Notes |
| --- | --- | --- |
| `GET /`, `GET /health` | public probe | Reports worker/version/package compatibility. |
| `/internal/sessions/:session_uuid/*` | active internal seam | Called by `orchestrator-core` over service binding. |
| legacy `/sessions/:session_uuid/*` | retired | Returns typed retirement envelopes instead of serving canonical traffic. |
| `SESSION_DO` | active | Hosts the per-session runtime and WebSocket replay/heartbeat state. |

## Source map

```text
src/
├── index.ts                         # worker fetch entrypoint
├── host/                            # HTTP/internal routes, runtime composition, env, probes
│   ├── do/
│   │   ├── nano-session-do.ts       # thin Durable Object facade
│   │   ├── session-do-runtime.ts    # runtime coordinator
│   │   └── session-do/              # RH6 split: fetch/ws/runtime assembly
│   ├── runtime-mainline.ts          # host orchestration loop
│   ├── session-edge.ts              # retired public edge helpers
│   └── workspace-runtime.ts         # workspace/context package integration
├── kernel/                          # turn scheduler, reducer, checkpoints, interrupts
├── llm/                             # provider dispatch, attachments, stream adapters
├── hooks/                           # hook catalog, dispatcher, permissions, session mapping
└── eval/                            # trace, replay, evidence and timeline runtime mirror
```

## Runtime truth

- Session DO memory/storage owns hot runtime state, replay buffer, heartbeat and stream lifecycle.
- User/session durable truth is written through `orchestrator-core` and D1; `agent-core` should not become the public tenant/session source of truth.
- Workspace/context helpers are still consumed in-process through `@nano-agent/workspace-context-artifacts` and related worker-local mirrors.

## Validation

```bash
pnpm --filter @haimang/agent-core-worker typecheck
pnpm --filter @haimang/agent-core-worker build
pnpm --filter @haimang/agent-core-worker test
pnpm --filter @haimang/agent-core-worker deploy:dry-run
```
