# NACP-Session Registry — v1.3.0

> Subprotocol: `nacp-session.v1`
> Compat baseline: `1.0.0`

## Session Message Types

| Message Type | Body Required |
|---|---|
| `session.start` | ✅ |
| `session.resume` | ✅ |
| `session.cancel` | — |
| `session.end` | ✅ |
| `session.stream.event` | — |
| `session.stream.ack` | ✅ |
| `session.heartbeat` | ✅ |
| `session.followup_input` | ✅ |

## Stream Event Kinds (`session.stream.event`)

| Kind | Notes |
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
