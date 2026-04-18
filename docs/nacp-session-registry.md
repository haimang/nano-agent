# NACP-Session Registry — v1.1.0

> Subprotocol: `nacp-session.v1`
> Auto-generated. Do not edit manually.

## Session Message Types

| message_type | body_required |
|---|---|
| `session.cancel` | — |
| `session.end` | ✅ |
| `session.followup_input` | ✅ |
| `session.heartbeat` | ✅ |
| `session.resume` | ✅ |
| `session.start` | ✅ |
| `session.stream.ack` | ✅ |
| `session.stream.event` | — |

## Stream Event Kinds (`session.stream.event`)

| kind | description |
|---|---|
| `tool.call.progress` | — |
| `tool.call.result` | — |
| `hook.broadcast` | — |
| `session.update` | — |
| `turn.begin` | — |
| `turn.end` | — |
| `compact.notify` | — |
| `system.notify` | — |
| `llm.delta` | — |

## Session Error Codes

| code |
|---|
| `NACP_SESSION_INVALID_PHASE` |
| `NACP_SESSION_AUTHORITY_REQUIRED` |
| `NACP_SESSION_FORGED_AUTHORITY` |
| `NACP_REPLAY_OUT_OF_RANGE` |
| `NACP_SESSION_ACK_MISMATCH` |
| `NACP_SESSION_HEARTBEAT_TIMEOUT` |
| `NACP_SESSION_ALREADY_ATTACHED` |
