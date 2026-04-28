# /me/sessions API

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`

## Base URLs

| 环境 | Base URL |
|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` |

## Routes

| Route | Method | Auth | 说明 |
|---|---|---|---|
| `/me/sessions` | `POST` | bearer | mint 一个新的 session UUID |
| `/me/sessions` | `GET` | bearer | 列出当前用户已进入 User DO hot index 的 sessions |

## `POST /me/sessions`

### Request

```http
POST /me/sessions
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 11111111-1111-4111-8111-111111111111

{}
```

> 当前实现允许空 body、空对象，或完全省略 body。  
> **禁止**带 `session_uuid`，否则返回 `400 invalid-input`。

### Success

```json
{
  "ok": true,
  "data": {
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "status": "pending",
    "ttl_seconds": 86400,
    "created_at": "2026-04-27T08:00:00.000Z",
    "start_url": "/sessions/11111111-1111-4111-8111-111111111111/start"
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

### Current reality

这条接口当前是**server-mint contract**，但还不是“pending truth 已落库”的完整实现：

1. 它会返回一个新的 UUID
2. 返回体里会把状态写成 `pending`
3. **但当前 v1 不会在 D1 / User DO 里先写一条 pending session 记录**

这带来两个客户端层面的现实约束：

- freshly minted 但尚未 `/start` 的 UUID，**不会**出现在 `GET /me/sessions` 列表里
- 当前后端也**不会强制**你必须先 mint 再 `/start`；只要 UUID 合法且尚未使用，直接 `/sessions/{uuid}/start` 仍能启动

因此：**前端应把 `/me/sessions` 视为推荐入口，而不是当前后端已经强制执行的唯一入口。**

### Errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-input` | body 含 `session_uuid` |
| 401 | `invalid-auth` | bearer 缺失或无效 |
| 503 | `worker-misconfigured` | `TEAM_UUID` / JWT / binding 配置异常 |

## `GET /me/sessions`

### Request

```http
GET /me/sessions
authorization: Bearer <access_token>
x-trace-uuid: 11111111-1111-4111-8111-111111111111
```

### Success

```json
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "conversation_uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "session_uuid": "11111111-1111-4111-8111-111111111111",
        "status": "active",
        "last_phase": "turn_running",
        "last_seen_at": "2026-04-27T08:01:23.000Z",
        "created_at": "2026-04-27T07:55:00.000Z",
        "ended_at": null
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

### Current reality

- 列表数据来自 User DO 的 **hot conversation index**
- 只会列出**已经启动过或被读取/触碰过**的 session
- 当前上限是 **200** 条 conversation/session 映射
- `next_cursor` 目前恒为 `null`；尚未做真实翻页

### Status values

`GET /me/sessions` 当前可能出现的 `status`：

- `starting`
- `active`
- `detached`
- `ended`

## Recommended client flow

1. `POST /me/sessions` 拿一个服务端生成的 UUID
2. 本地持久化该 UUID
3. `POST /sessions/{uuid}/start`
4. `GET/POST /sessions/{uuid}/...` + `GET /sessions/{uuid}/ws`
5. 页面刷新或跨设备时，用同一个 UUID 恢复

## Duplicate start behavior

同一个 UUID 一旦已经进入 session state，再次 `/sessions/{uuid}/start` 会返回 `409`。  
这时客户端应重新 mint 或生成一个新的会话流程，而不是试图重复 start 同一个已存在 session。
