# /me/sessions API

> Profile: `facade-http-v1`
> 状态: ZX2 Phase 5 P5-02 — server-mint UUID + 列表读
> 生成: 2026-04-27

ZX2 把 session 的 `session_uuid` 真相从客户端搬到服务端：客户端不再自造 UUID，必须先 `POST /me/sessions` 拿到一个由服务端 mint 的 pending UUID，再用它去 `POST /sessions/{uuid}/start`。

## 1. 端点

| Route | Method | Auth |
|---|---|---|
| `/me/sessions` | POST | bearer | 服务端 mint UUID |
| `/me/sessions` | GET | bearer | 列出当前用户的 sessions |

## 2. POST `/me/sessions` — mint a new session UUID

### Request

```http
POST /me/sessions
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: <uuid>

{}
```

> Body 必须是 **空对象** 或省略。**禁止**带 `session_uuid`——客户端自造 UUID 会被 server 拒绝以 400 `invalid-input`。

### Response

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
  "trace_uuid": "..."
}
```

HTTP `201 Created`。`session_uuid` 是单一真相；客户端把它持久化到 localStorage / 小程序 `wx.setStorage`。

### 错误

| HTTP | error.code | 触发 |
|---|---|---|
| 400 | `invalid-input` | body 含 `session_uuid` |
| 401 | `invalid-auth` | 缺 / 错 access_token |
| 503 | `worker-misconfigured` | orchestrator-core 启动配置缺失 |

## 3. GET `/me/sessions` — list user's sessions

```http
GET /me/sessions
authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

### Response

```json
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "conversation_uuid": "...",
        "session_uuid": "...",
        "status": "active",
        "last_phase": "turn_running",
        "last_seen_at": "2026-04-27T08:01:23.000Z",
        "created_at": "2026-04-27T07:55:00.000Z",
        "ended_at": null
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

> 当前实现读 User DO 的 hot conversation index（最多 100 条）。分页 cursor 为 `null` 表示没有更多 — ZX3 candidate 会基于 D1 truth 提供完整翻页。

## 4. 生命周期 / TTL

- `pending`：mint 后 24 小时未 `/start` → server-side GC（`ttl_seconds = 86400`）。
- `active`：开始后会一直 active 到 turn 结束、cancel、或 5 分钟无 heartbeat。
- `detached`：WS 断开但 turn 仍在跑。
- `ended`：终态；`ended_at` 写入 D1 truth。

> 客户端在拿到 pending UUID 24 小时内必须 `/start`，否则 UUID 失效 → `/start` 返回 `404 not-found`。

## 5. 重复 start / 跨设备 resume

- 同一 UUID 第二次 `/start` → `409 conflict`（语义：session 已经 minted+started，不能 re-start）。
- 跨设备 resume：用同一 UUID 在新设备 `/start` 之后的 `/sessions/{uuid}/ws` 即可。前一个 WS 会收到 `attachment_superseded` + close 4001，新连接接管。

## 6. 客户端推荐流程

```typescript
// 1. 拿 UUID
const { data: { session_uuid } } = await api.post("/me/sessions", {});

// 2. 持久化
localStorage.setItem("nano.sessionUuid", session_uuid);

// 3. start
await api.post(`/sessions/${session_uuid}/start`, { initial_input: "..." });

// 4. WS
const ws = new WebSocket(`wss://.../sessions/${session_uuid}/ws?access_token=...&trace_uuid=...&last_seen_seq=0`);

// 5. 页面刷新 / 跨设备
const session_uuid = localStorage.getItem("nano.sessionUuid");
// 直接用同一 UUID 重新 WS
```

## 7. 不允许的旧用法

```typescript
// ❌ ZX2 之后被 reject
const sessionUuid = crypto.randomUUID();
await api.post("/me/sessions", { session_uuid: sessionUuid }); // 400
await api.post(`/sessions/${sessionUuid}/start`, ...);          // 也会 reject
```

客户端必须先 `POST /me/sessions` 拿 UUID。
