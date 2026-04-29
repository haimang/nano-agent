# /me Routes API — ZX5 Snapshot

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`（全部路由）
> Header: `x-trace-uuid: <uuid>`（建议全部路由显式携带）

---

## Route Overview

| Route | Method | Auth | 说明 |
|-------|--------|------|------|
| `/me/sessions` | `POST` | bearer | 推荐的 server-mint 新 session UUID 路径 |
| `/me/sessions` | `GET` | bearer | 列出用户 sessions |
| `/me/conversations` | `GET` | bearer | conversation 级聚合列表 |
| `/me/devices` | `GET` | bearer | 列出用户设备 |
| `/me/devices/revoke` | `POST` | bearer | 撤销设备 |

---

## Session Lifecycle Note

- `POST /me/sessions` 是**推荐**的 server-mint 路径，能提供 pending truth、TTL 和 `/me/sessions` 可见性。
- 但当前实现里，`POST /sessions/{id}/start` 仍接受一个此前未 mint 的新 UUID；因此 `/me/sessions` 不是硬前置 gate。
- 对已经 mint 但尚未 start 的 UUID，其他 session 路径通常会返回 `409 session-pending-only-start-allowed`。

---

## `POST /me/sessions` — Mint Session UUID

### Request
```http
POST /me/sessions HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{}
```

Body 可以为空对象或空 body。若 body 中包含 `session_uuid`，返回 400（禁止客户端在此路由自选 UUID）。

### Success (201 Created)
```json
{
  "ok": true,
  "data": {
    "session_uuid": "33333333-3333-4333-8333-333333333333",
    "status": "pending",
    "ttl_seconds": 86400,
    "created_at": "2026-04-29T00:00:00.000Z",
    "start_url": "/sessions/33333333-3333-4333-8333-333333333333/start"
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

### Errors
| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-input` | body 含 `session_uuid` key |
| 401 | `invalid-auth` | token 无效 |
| 403 | `missing-team-claim` | JWT 无 team_uuid / tenant_uuid |
| 500 | `internal-error` | D1 写 pending row 失败 |

### Behavior
- Server-mint UUIDv4（不依赖客户端输入）
- 有 D1 binding 时，会写 `nano_conversations` + `nano_conversation_sessions(status='pending')`
- **若无 D1 binding，仍返回 UUID，但不会创建 pending D1 row**

---

## `GET /me/sessions` — List User Sessions

### Request
```http
GET /me/sessions HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

### Success (200)
```json
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "conversation_uuid": "4444...",
        "session_uuid": "3333...",
        "status": "pending",
        "last_phase": null,
        "last_seen_at": "2026-04-29T00:00:00.000Z",
        "created_at": "2026-04-29T00:00:00.000Z",
        "ended_at": null
      },
      {
        "conversation_uuid": "5555...",
        "session_uuid": "6666...",
        "status": "active",
        "last_phase": "turn_running",
        "last_seen_at": "2026-04-29T00:05:00.000Z",
        "created_at": "2026-04-29T00:04:00.000Z",
        "ended_at": null
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

### Behavior
- User DO KV hot index + D1 `listSessionsForUser()` merge
- **pending / starting / active / detached / ended / expired 都可能出现**
- D1 status 优先于 KV status（避免 KV stale）
- `next_cursor` 当前恒为 `null`

---

## `GET /me/conversations` — Conversation Aggregation

### Request
```http
GET /me/conversations?limit=20 HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

| Query Param | 类型 | 默认 | 最大 | 说明 |
|-------------|------|------|------|------|
| `limit` | number | 50 | 200 | 返回 conversation 数上限；非法值会回退为默认 50 |

### Success (200)
```json
{
  "ok": true,
  "data": {
    "conversations": [
      {
        "conversation_uuid": "4444...",
        "latest_session_uuid": "3333...",
        "latest_status": "active",
        "started_at": "2026-04-29T00:00:00.000Z",
        "latest_session_started_at": "2026-04-29T00:05:00.000Z",
        "last_seen_at": "2026-04-29T00:05:00.000Z",
        "last_phase": "turn_running",
        "session_count": 3
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

### Field Reference
| 字段 | 类型 | 说明 |
|------|------|------|
| `conversation_uuid` | string | 对话 UUID |
| `latest_session_uuid` | string | 最新 session UUID |
| `latest_status` | string | 最新 session 状态 |
| `started_at` | string (ISO) | 该 conversation 最早 session 的 started_at |
| `latest_session_started_at` | string (ISO) | 最新 session 的 started_at |
| `last_seen_at` | string (ISO) | `latest_session_started_at` 的 legacy alias |
| `last_phase` | string\|null | 最新 session 的 last_phase |
| `session_count` | number | 该 conversation 下的 session 数量 |

### Behavior
- 仅读 D1 truth（不合并 KV）
- 先拉该用户最近 session rows，再按 `conversation_uuid` 聚合
- 按 `latest_session_started_at DESC` 排序
- `next_cursor` 当前恒为 `null`

---

## `GET /me/devices` — List User Devices

### Request
```http
GET /me/devices HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

### Success (200)
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
        "created_at": "2026-04-29T00:00:00.000Z",
        "last_seen_at": "2026-04-29T00:05:00.000Z",
        "revoked_at": null,
        "revoked_reason": null
      }
    ]
  },
  "trace_uuid": "..."
}
```

### Behavior
- 直接读 D1 `nano_user_devices`
- 按 `last_seen_at DESC` 排序
- **若无 D1 binding，返回 `200 { devices: [] }`**

### Errors
| HTTP | error.code | 触发 |
|------|-----------|------|
| 401 | `invalid-auth` | token 无效 |
| 500 | `internal-error` | D1 查询失败 |

---

## `POST /me/devices/revoke` — Revoke Device

> **当前状态**：D1 revoke 与审计写入已完成；access token / WS attach 的 device-active 即时拒绝仍待 D6 second-half。
> 已在 revoke 前签发的 access token 当前仍会在其 `exp` 前继续可用。

### Request
```http
POST /me/devices/revoke HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "device_uuid": "5555...",
  "reason": "lost device"
}
```

### Success — Newly Revoked (200)
```json
{
  "ok": true,
  "data": {
    "device_uuid": "5555...",
    "status": "revoked",
    "revoked_at": "2026-04-29T01:00:00.000Z",
    "revocation_uuid": "6666..."
  },
  "trace_uuid": "..."
}
```

### Success — Already Revoked (200 idempotent)
```json
{
  "ok": true,
  "data": {
    "device_uuid": "5555...",
    "status": "revoked",
    "already_revoked": true
  },
  "trace_uuid": "..."
}
```

### Errors
| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-input` | body 无 `device_uuid` 或格式非 UUID |
| 401 | `invalid-auth` | token 无效 |
| 403 | `permission-denied` | device 不属于当前用户 |
| 404 | `not-found` | device_uuid 不存在 |
| 500 | `internal-error` | D1 操作失败 |
| 503 | `worker-misconfigured` | 无 D1 binding |

### Behavior
1. 校验 `device_uuid` 属于当前 authenticated user
2. D1 UPDATE `nano_user_devices.status='revoked'`
3. D1 INSERT `nano_user_device_revocations`
4. 若已为 revoked → idempotent success
5. 当前不通过 auth gate 即时拒绝既有 access token / live attach（待 second-half）
