# @haimang/nacp-session

NACP-Session is the client ↔ session WebSocket/profile package. It builds on `@haimang/nacp-core` and owns session frame schemas, client frame normalization, stream-event bodies, replay, heartbeat, ack delivery, redaction, and the Session DO WebSocket helper.

**Baseline**: `1.4.0` (frozen). `NACP_VERSION_COMPAT = "1.0.0"` remains the accepted pre-freeze compatibility floor.

## Current role

| Area | SSOT |
| --- | --- |
| Session frame wire | `NacpSessionFrameSchema`, `normalizeClientFrame` |
| Message bodies | `SESSION_BODY_SCHEMAS`, start/resume/cancel/`session.followup_input`/permission/usage/attachment bodies |
| Stream push | `session.stream.event` and canonical event-kind adapters |
| Liveness/replay | `HeartbeatTracker`, `ReplayBuffer`, `SessionWebSocketHelper` |
| Client safety | redaction helpers and ingress server-stamping |

## Source map

```text
src/
├── frame.ts / ingress.ts                 # frame schema and client ingress normalization
├── messages.ts                           # session body schemas, including RH5 model/image/reasoning surfaces
├── stream-event.ts                       # canonical stream event body/kind truth
├── delivery.ts / replay.ts / heartbeat.ts# delivery, replay and liveness helpers
├── websocket.ts                          # SessionWebSocketHelper
├── adapters/                             # tool/hook/compact/system/llm event adapters
├── session-registry.ts                   # phase and message-direction rules
├── type-direction-matrix.ts              # message_type x delivery_kind matrix
└── index.ts                              # root exports
```

## Boundaries

- Core's phase table only covers core protocol verbs; session profile routing must use this package's session matrix.
- Runtime can validate provider/model capability, but public session body shape belongs here and in orchestrator facade tests.
- Keep `NACP_SESSION_VERSION` aligned with the package version discipline used by workers.

## Validation

```bash
pnpm --filter @haimang/nacp-session typecheck
pnpm --filter @haimang/nacp-session build
pnpm --filter @haimang/nacp-session test
pnpm --filter @haimang/nacp-session build:schema
pnpm --filter @haimang/nacp-session build:docs
```
