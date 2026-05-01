# NACP-Session Registry — v1.4.0

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
| `session.permission.request` | ✅ |
| `session.permission.decision` | ✅ |
| `session.usage.update` | ✅ |
| `session.skill.invoke` | ✅ |
| `session.command.invoke` | ✅ |
| `session.elicitation.request` | ✅ |
| `session.elicitation.answer` | ✅ |
| `session.attachment.superseded` | ✅ |

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
