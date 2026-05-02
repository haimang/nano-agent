# Session Items Projection

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/facade/routes/session-items.ts`, `workers/orchestrator-core/src/item-projection-plane.ts`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

HPX6 adds a Codex-style read-time item layer. Items are not a new truth table; they are projections from existing durable sources such as messages, tool-call ledger, workspace temp-file metadata, todos, confirmations, and error log rows.

## Routes

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/sessions/{id}/items?cursor=&limit=` | List projected items for a session. |
| `GET` | `/items/{item_uuid}` | Read one projected item by UUID-like projection id. |

## Item kinds

| kind | Source |
|------|--------|
| `agent_message` | assistant messages |
| `reasoning` | reasoning delta stream projection when durable rows exist |
| `tool_call` | `nano_tool_call_ledger` |
| `file_change` | current `nano_session_temp_files` metadata projection |
| `todo_list` | `nano_session_todos` aggregate |
| `confirmation` | `nano_session_confirmations` |
| `error` | `nano_error_log` rows scoped to the session |

## Query vs subscription

| Surface | What it shows |
|---------|----------------|
| `GET /sessions/{id}/items` | current durable projection for the session |
| `GET /items/{item_uuid}` | detail view for one projected item |
| WS `session.item.*` | live progression events while a workbench item is being produced |

`/items` is a durable query surface, not a replay of every transient WS frame. For example, `file_change` HTTP items are derived from the current workspace temp-file truth, while WS frames can still report per-operation progress.

## WS item frames

Workbench clients should also listen for top-level item frames:

```json
{
  "kind": "session.item.completed",
  "item_uuid": "...",
  "session_uuid": "...",
  "item_kind": "file_change",
  "status": "completed",
  "payload": {
    "path": "/workspace/app.ts",
    "change_kind": "modified"
  },
  "updated_at": "..."
}
```

Wire frames use `item_kind` because the outer lightweight frame already owns `kind`. Canonical schema field name remains `kind`.
