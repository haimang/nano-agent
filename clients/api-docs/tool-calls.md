# Tool Calls Ledger

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/hp-absorbed-routes.ts`, `workers/orchestrator-core/src/tool-call-ledger.ts`, `workers/agent-core/src/host/do/session-do/runtime-assembly.ts`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

HPX6 promotes tool calls from stream-only events to a durable D1 ledger (`nano_tool_call_ledger`). Agent-core records `running`, `succeeded`, `failed`, and user cancel transitions through orchestrator-core RPC.

## Routes

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/sessions/{id}/tool-calls?cursor=&limit=` | List tool calls for the session. |
| `GET` | `/sessions/{id}/tool-calls/{request_uuid}` | Read one tool call. `request_uuid` is the tool call id and may be provider-generated text, not necessarily UUID-shaped. |
| `POST` | `/sessions/{id}/tool-calls/{request_uuid}/cancel` | Mark a ledger row as `cancelled` with `cancel_initiator=user`. |

## List success

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "tool_calls": [],
    "next_cursor": null,
    "source": "d1-tool-call-ledger"
  },
  "trace_uuid": "..."
}
```

## Status enum

`queued | running | succeeded | failed | cancelled`

