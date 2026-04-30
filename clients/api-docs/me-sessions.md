# /me, Team, Device API — RHX2 Phase 6 Snapshot

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

## Routes

| Route | Method | Auth | 说明 |
|-------|--------|------|------|
| `/me/sessions` | `POST` | bearer | server-mint pending session UUID |
| `/me/sessions` | `GET` | bearer | 当前用户 session 列表 |
| `/me/conversations` | `GET` | bearer | conversation 聚合列表 |
| `/me/team` | `GET` | bearer | 当前 team 详情 |
| `/me/team` | `PATCH` | bearer owner | 修改 team name |
| `/me/teams` | `GET` | bearer | 当前用户加入的 teams |
| `/me/devices` | `GET` | bearer | 当前用户 active devices |
| `/me/devices/revoke` | `POST` | bearer | 撤销单个 device |

## `POST /me/sessions`

Body 可为空对象或空 body。若传入 `session_uuid` 会返回 `400 invalid-input`；该路由的职责是 server-mint。

Success `201`:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "33333333-3333-4333-8333-333333333333",
    "status": "pending",
    "ttl_seconds": 86400,
    "created_at": "2026-04-30T00:00:00.000Z",
    "start_url": "/sessions/33333333-3333-4333-8333-333333333333/start"
  },
  "trace_uuid": "..."
}
```

Behavior:

- 有 D1 binding 时写 `nano_conversations` + `nano_conversation_sessions(status='pending')`。
- 无 D1 binding 时仍返回 UUID，但不会创建 pending D1 truth。
- `/sessions/{id}/start` 仍接受未 mint 的新 UUID；`/me/sessions` 是推荐路径，不是硬前置。

## `GET /me/sessions`

Success:

```json
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "conversation_uuid": "4444...",
        "session_uuid": "3333...",
        "status": "active",
        "last_phase": "turn_running",
        "last_seen_at": "2026-04-30T00:05:00.000Z",
        "created_at": "2026-04-30T00:00:00.000Z",
        "ended_at": null
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

Current reality:

- User DO hot index 与 D1 list 合并，D1 status 优先。
- pending / starting / active / detached / ended / expired 都可能出现。
- `next_cursor` 当前恒为 `null`。

## `GET /me/conversations`

Query:

| Param | 默认 | 最大 | 说明 |
|-------|------|------|------|
| `limit` | 50 | 200 | 非法值回退默认 |
| `cursor` | none | n/a | opaque string: `latest_session_started_at|conversation_uuid` |

Success:

```json
{
  "ok": true,
  "data": {
    "conversations": [
      {
        "conversation_uuid": "4444...",
        "latest_session_uuid": "3333...",
        "latest_status": "active",
        "started_at": "2026-04-30T00:00:00.000Z",
        "latest_session_started_at": "2026-04-30T00:05:00.000Z",
        "last_seen_at": "2026-04-30T00:05:00.000Z",
        "last_phase": "turn_running",
        "session_count": 3
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

## `GET /me/team`

Reads the current team from D1 membership truth.

Success:

```json
{
  "ok": true,
  "data": {
    "team_uuid": "2222...",
    "team_name": "Alpha Team",
    "team_slug": "alpha-team-ab12cd",
    "membership_level": 100,
    "plan_level": 0
  },
  "trace_uuid": "..."
}
```

Errors: `worker-misconfigured`(503), `missing-team-claim`(403), `not-found`(404), `invalid-auth`(401).

## `PATCH /me/team`

Owner-only (`membership_level >= 100`) update of `team_name`.

Request:

```json
{ "team_name": "Renamed Team" }
```

Success returns the same shape as `GET /me/team`.

Errors: `invalid-input`(400), `permission-denied`(403), `not-found`(404), `worker-misconfigured`(503).

## `GET /me/teams`

Lists all teams joined by current user.

Success:

```json
{
  "ok": true,
  "data": {
    "teams": [
      {
        "team_uuid": "2222...",
        "team_name": "Alpha Team",
        "team_slug": "alpha-team-ab12cd",
        "membership_level": 100,
        "plan_level": 0
      }
    ]
  },
  "trace_uuid": "..."
}
```

If D1 binding is absent, returns `200 {teams:[]}`.

## `GET /me/devices`

Lists active devices for current user.

Success:

```json
{
  "ok": true,
  "data": {
    "devices": [
      {
        "device_uuid": "5555...",
        "device_label": "iPhone 15",
        "device_kind": "wechat-miniprogram",
        "status": "active",
        "created_at": "2026-04-30T00:00:00.000Z",
        "last_seen_at": "2026-04-30T00:05:00.000Z",
        "revoked_at": null,
        "revoked_reason": null
      }
    ]
  },
  "trace_uuid": "..."
}
```

Current reality: query filters `status='active'`; already revoked devices do not appear.

## `POST /me/devices/revoke`

Request:

```json
{ "device_uuid": "55555555-5555-4555-8555-555555555555", "reason": "lost device" }
```

Success — newly revoked:

```json
{
  "ok": true,
  "data": {
    "device_uuid": "55555555-5555-4555-8555-555555555555",
    "status": "revoked",
    "revoked_at": "2026-04-30T00:00:00.000Z",
    "revocation_uuid": "66666666-6666-4666-8666-666666666666"
  },
  "trace_uuid": "..."
}
```

Success — idempotent already revoked:

```json
{
  "ok": true,
  "data": {
    "device_uuid": "55555555-5555-4555-8555-555555555555",
    "status": "revoked",
    "already_revoked": true
  },
  "trace_uuid": "..."
}
```

Behavior:

1. Verify device belongs to current user.
2. D1 update `nano_user_devices.status='revoked'`.
3. D1 insert `nano_user_device_revocations`.
4. Clear orchestrator-core device gate cache for that device.
5. Best-effort notify User DO; matching live attachment receives `attachment_superseded` and closes.

Errors: `invalid-input`(400), `invalid-auth`(401), `permission-denied`(403), `not-found`(404), `worker-misconfigured`(503), `internal-error`(500).
