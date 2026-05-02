# Runtime Config / Permission Rules

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/facade/routes/session-runtime.ts`, `workers/orchestrator-core/src/runtime-config-plane.ts`, `workers/orchestrator-core/src/permission-rules-plane.ts`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

HPX6 replaces the removed legacy `POST /sessions/{id}/policy/permission_mode` route with a durable runtime control plane. Session-scoped settings live in `nano_session_runtime_config`; tenant-scoped permission rules live in `nano_team_permission_rules`. The facade merges both scopes into one client-facing runtime document.

## Routes

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/sessions/{id}/runtime` | Read or create the session runtime config and return an `ETag` for optimistic locking. |
| `PATCH` | `/sessions/{id}/runtime` | Patch allowed runtime fields, bump `version`, optionally enforce `If-Match`, emit `session.runtime.update`. |

## Runtime shape

```json
{
  "session_uuid": "...",
  "version": 1,
  "permission_rules": [
    {
      "rule_uuid": "...",
      "tool_name": "bash",
      "pattern": "*",
      "behavior": "allow",
      "scope": "session"
    }
  ],
  "network_policy": { "mode": "restricted" },
  "web_search": { "mode": "disabled" },
  "workspace_scope": { "mounts": [] },
  "approval_policy": "ask",
  "updated_at": "2026-05-02T00:00:00.000Z"
}
```

`permission_rules` support `behavior ∈ {allow, deny, ask}` and `scope ∈ {session, tenant}`. Runtime decision order is: session runtime `permission_rules` first, then tenant `nano_team_permission_rules`, then `approval_policy` fallback (`auto-allow` / `always_allow` allow, `deny` deny, `ask` ask).

## Optimistic lock contract

1. `GET /sessions/{id}/runtime` returns `ETag: "<hash>"`.
2. Clients may send `If-None-Match` on `GET` and receive `304` when nothing changed.
3. `PATCH` remains backward-compatible with body `version`, and now also accepts `If-Match` for HTTP-level optimistic locking.
4. When `If-Match` is present and stale, the server returns `409 conflict`; clients should re-GET the runtime document, refresh `version` + `ETag`, then retry.

## PATCH request

```json
{
  "version": 1,
  "approval_policy": "always_allow",
  "permission_rules": [
    { "tool_name": "write_todos", "behavior": "allow", "scope": "session" },
    { "tool_name": "bash", "pattern": "*git status*", "behavior": "allow", "scope": "tenant" }
  ],
  "network_policy": { "mode": "restricted" },
  "web_search": { "mode": "disabled" },
  "workspace_scope": { "mounts": ["/workspace"] }
}
```

`version` is required and remains the durable version-law field. All other fields are optional, but an empty PATCH body is rejected. Unknown fields are ignored by the current parser.

When `permission_rules` is present, the server replaces the submitted scopes in durable truth:

1. `scope=session` rules replace `nano_session_runtime_config.permission_rules_json`.
2. `scope=tenant` rules replace the current team rule set in `nano_team_permission_rules`.

If another client updates runtime config first, the server returns `409 conflict`.

## Server push

Successful PATCH emits a top-level WS frame:

```json
{
  "kind": "session.runtime.update",
  "session_uuid": "...",
  "version": 2,
  "permission_rules": [],
  "network_policy": { "mode": "restricted" },
  "web_search": { "mode": "disabled" },
  "workspace_scope": { "mounts": [] },
  "approval_policy": "ask",
  "updated_at": "..."
}
```
