# Health and Debug API — RHX2 Phase 6 Snapshot

> Health route uses raw debug JSON.
> RHX2 debug routes use `facade-http-v1` and require bearer auth except worker health.

## Routes

| Route | Method | Auth | Shape | 说明 |
|-------|--------|------|-------|------|
| `/debug/workers/health` | `GET` | none | raw | 6-worker health aggregation |
| `/debug/logs` | `GET` | bearer | facade | D1 `nano_error_log` query, team-scoped |
| `/debug/recent-errors` | `GET` | bearer | facade | in-memory recent logger records |
| `/debug/audit` | `GET` | bearer owner | facade | D1 `nano_audit_log` query |
| `/debug/packages` | `GET` | bearer | facade | deployed package manifest + registry drift |

## `GET /debug/workers/health`

No auth required.

Response:

```json
{
  "ok": true,
  "environment": "preview",
  "generated_at": "2026-04-30T00:00:00.000Z",
  "summary": { "live": 6, "total": 6 },
  "workers": [
    { "worker": "orchestrator-core", "live": true, "status": "ok", "worker_version": "orchestrator-core@preview" },
    { "worker": "orchestrator-auth", "live": true, "status": "ok", "worker_version": "orchestrator-auth@preview" }
  ]
}
```

`workers[].status` can be `ok`, `binding-missing`, `unreachable`, or `http-<status>`.

## `GET /debug/logs`

Team-scoped durable error log query. Requires bearer token and `x-trace-uuid`.

Query params:

| Param | 说明 |
|-------|------|
| `trace_uuid` | optional exact trace filter |
| `team_uuid` | optional but must equal caller team |
| `session_uuid` | optional exact session filter |
| `code` | optional exact error code filter |
| `since` | optional ISO lower bound on `created_at` |
| `limit` | default 100, max 200 |

Success:

```json
{
  "ok": true,
  "data": {
    "logs": [
      {
        "log_uuid": "log-1",
        "trace_uuid": "3333...",
        "session_uuid": "1111...",
        "team_uuid": "2222...",
        "worker": "orchestrator-core",
        "code": "internal-error",
        "category": "transient",
        "severity": "warn",
        "http_status": 500,
        "message": "failed to list devices",
        "context_json": "{\"tag\":\"me-devices-list-d1-failed\"}",
        "rpc_log_failed": 0,
        "created_at": "2026-04-30T00:00:00.000Z"
      }
    ],
    "limit": 100
  },
  "trace_uuid": "..."
}
```

Retention: cron deletes rows older than 14 days.

## `GET /debug/recent-errors`

Reads current worker instance logger ring buffer. This is volatile and may be empty after isolate recycle.

Query params:

| Param | 说明 |
|-------|------|
| `limit` | default 100, max 200 |

Success:

```json
{
  "ok": true,
  "data": {
    "recent_errors": [
      {
        "ts": "2026-04-30T00:00:00.000Z",
        "level": "error",
        "worker": "orchestrator-core",
        "msg": "debug-route-test-error",
        "code": "internal-error",
        "team_uuid": "2222...",
        "ctx": { "reason": "unit-test" }
      }
    ],
    "limit": 100
  },
  "trace_uuid": "..."
}
```

Records without `team_uuid` and records matching caller team can be returned; cross-team records are filtered out.

## `GET /debug/audit`

Owner-only (`membership_level >= 100`) audit query over `nano_audit_log`.

Query params:

| Param | 说明 |
|-------|------|
| `event_kind` | optional exact event filter |
| `team_uuid` | optional but must equal caller team |
| `trace_uuid` | optional exact trace filter |
| `session_uuid` | optional exact session filter |
| `since` | optional ISO lower bound on `created_at` |
| `limit` | default 100, max 200 |

First-wave audit `event_kind` values:

| event_kind |
|------------|
| `auth.login.success` |
| `auth.api_key.issued` |
| `auth.api_key.revoked` |
| `auth.device.gate_decision` |
| `tenant.cross_tenant_deny` |
| `hook.outcome` |
| `session.attachment.superseded` |
| `session.replay_lost` |

Success:

```json
{
  "ok": true,
  "data": {
    "audit": [
      {
        "audit_uuid": "audit-1",
        "trace_uuid": "3333...",
        "session_uuid": "1111...",
        "team_uuid": "2222...",
        "user_uuid": "4444...",
        "device_uuid": "5555...",
        "worker": "orchestrator-core",
        "event_kind": "auth.device.gate_decision",
        "ref_kind": null,
        "ref_uuid": null,
        "detail_json": "{\"status\":\"active\"}",
        "outcome": "ok",
        "created_at": "2026-04-30T00:00:00.000Z"
      }
    ],
    "limit": 100
  },
  "trace_uuid": "..."
}
```

Retention: cron deletes rows older than 90 days.

## `GET /debug/packages`

Team-gated package truth endpoint. Returns build-time manifest and a runtime GitHub Packages registry check.

Success:

```json
{
  "ok": true,
  "data": {
    "deployed": {
      "build_at": "2026-04-30T00:00:00.000Z",
      "worker": "orchestrator-core",
      "packages": [
        {
          "name": "@haimang/nacp-core",
          "workspace_version": "0.1.0",
          "registry_version": "0.1.0",
          "registry_latest_version": "0.1.0",
          "registry_published_at": "2026-04-30T00:00:00.000Z",
          "dist_sha256": "abc...",
          "match": true,
          "resolved_from": "registry"
        }
      ]
    },
    "registry": [
      {
        "name": "@haimang/nacp-core",
        "status": "auth-not-available-in-runtime",
        "registry_latest_version": null,
        "registry_version": null,
        "registry_published_at": null,
        "checked_at": "2026-04-30T00:00:00.000Z"
      }
    ],
    "drift": [
      {
        "name": "@haimang/nacp-core",
        "workspace_version": "0.1.0",
        "deployed_registry_version": "0.1.0",
        "live_registry_version": null,
        "live_latest_version": null,
        "registry_status": "auth-not-available-in-runtime",
        "drift": false
      }
    ],
    "drift_detected": false,
    "cache_ttl_ms": 10000
  },
  "trace_uuid": "..."
}
```

Registry status values:

| status | 说明 |
|--------|------|
| `ok` | registry fetch succeeded |
| `auth-not-available-in-runtime` | runtime has no `NODE_AUTH_TOKEN`/`GITHUB_TOKEN`; deployed manifest remains available |
| `http-error` | registry HTTP non-2xx |
| `fetch-error` | network/fetch failed |
| `invalid-json` | registry returned invalid JSON |

## Common Debug Errors

| HTTP | error.code | 说明 |
|------|------------|------|
| 400 | `invalid-trace` | auth-gated debug route lacks trace UUID |
| 401 | `invalid-auth` | bearer token invalid |
| 403 | `missing-team-claim` | token lacks team/tenant truth |
| 403 | `permission-denied` | cross-team filter or non-owner audit access |
| 503 | `worker-misconfigured` | required D1/binding unavailable |
