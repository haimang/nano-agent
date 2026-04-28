# Session HTTP API

> Public facade owner: `orchestrator-core`
> Profiles: `facade-http-v1` + `session-ws-v1`

## Base URLs

| 环境 | HTTP base URL | WS base URL |
|---|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` | `wss://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` | `wss://nano-agent-orchestrator-core.haimang.workers.dev` |

## Routes

| Route | Method | Auth | 说明 |
|---|---|---|---|
| `/sessions/{sessionUuid}/start` | `POST` | bearer | 启动 session |
| `/sessions/{sessionUuid}/input` | `POST` | bearer | 发送 follow-up text |
| `/sessions/{sessionUuid}/cancel` | `POST` | bearer | 请求取消 |
| `/sessions/{sessionUuid}/status` | `GET` | bearer | 读取 runtime phase + 可选 durable truth |
| `/sessions/{sessionUuid}/timeline` | `GET` | bearer | 读取 stream event timeline |
| `/sessions/{sessionUuid}/history` | `GET` | bearer | 读取 durable message history |
| `/sessions/{sessionUuid}/verify` | `POST` | bearer | preview/debug verification seam |
| `/sessions/{sessionUuid}/resume` | `POST` | bearer | HTTP resume ack / replay hint |
| `/sessions/{sessionUuid}/ws` | `GET` upgrade | query token compatibility | session stream，详见 `session-ws-v1.md` |

> `usage` / `permission` 相关接口单独写在 `usage.md` 与 `permissions.md`。

## Success-shape split

当前 session HTTP 成功返回存在两种形状：

| 路由 | 成功形状 |
|---|---|
| `start/input/cancel/status/timeline/history/verify` | `{ ok:true, action: "...", ..., trace_uuid }` |
| `resume` | `{ ok:true, data: {...}, trace_uuid }` |

错误统一提升为 facade error envelope。

## `POST /sessions/{sessionUuid}/start`

### Request

```http
POST /sessions/11111111-1111-4111-8111-111111111111/start
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 33333333-3333-4333-8333-333333333333

{
  "initial_input": "Reply with one short sentence."
}
```

### Success

```json
{
  "ok": true,
  "action": "start",
  "session_uuid": "11111111-1111-4111-8111-111111111111",
  "user_uuid": "22222222-2222-4222-8222-222222222222",
  "last_phase": "turn_running",
  "status": "detached",
  "relay_cursor": 4,
  "first_event": {
    "kind": "session.update",
    "phase": "turn_running"
  },
  "terminal": null,
  "start_ack": {
    "ok": true,
    "action": "start",
    "phase": "turn_running"
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Notes

- 请求体允许 `initial_input` 或兼容字段 `text`
- 如果启动时还没挂 WS，返回里的 `status` 常见为 `detached`
- 当前后端并**不会强制**这个 UUID 必须先经过 `POST /me/sessions` mint

### Errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-start-body` | body 缺失、JSON 非法、或缺 `initial_input/text` |
| 401 | `invalid-auth` | bearer 缺失或无效 |
| 409 | `session-already-started` | 同 UUID 已经 start 过 |
| 502 | `agent-rpc-parity-failed` | preview parity divergence |

## `POST /sessions/{sessionUuid}/input`

### Request

```http
POST /sessions/11111111-1111-4111-8111-111111111111/input
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 33333333-3333-4333-8333-333333333333

{
  "text": "continue"
}
```

### Success

```json
{
  "ok": true,
  "action": "input",
  "phase": "turn_running",
  "session_uuid": "11111111-1111-4111-8111-111111111111",
  "session_status": "detached",
  "relay_cursor": 8,
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

> 注意：这里的字段名是 `session_status`，不是 `status`。这是当前 live API 的历史不一致，客户端需要按现状兼容。

### Errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-input-body` | body 缺失、JSON 非法、或 `text` 为空 |
| 401 | `invalid-auth` | bearer 缺失或无效 |
| 404 | `session_missing` | session 不存在 |
| 409 | `session_terminal` | session 已终态 |
| 502 | `agent-rpc-parity-failed` | preview parity divergence |

## `POST /sessions/{sessionUuid}/cancel`

### Request

```http
POST /sessions/11111111-1111-4111-8111-111111111111/cancel
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 33333333-3333-4333-8333-333333333333

{
  "reason": "user cancelled"
}
```

### Success

```json
{
  "ok": true,
  "action": "cancel",
  "phase": "ended",
  "session_uuid": "11111111-1111-4111-8111-111111111111",
  "session_status": "ended",
  "terminal": "cancelled",
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 401 | `invalid-auth` | bearer 缺失或无效 |
| 404 | `session_missing` | session 不存在 |
| 409 | `session_terminal` | session 已终态 |
| 502 | `agent-rpc-parity-failed` | preview parity divergence |

### Common read / verify errors

下列错误会在 `status` / `timeline` / `history` / `verify` / `resume` 等读路径上反复出现：

| HTTP | `error.code` | 触发 |
|---|---|---|
| 401 | `invalid-auth` | bearer 缺失或无效 |
| 404 | `session_missing` | session 从未存在或当前不可读 |

## `GET /sessions/{sessionUuid}/status`

### Request

```http
GET /sessions/11111111-1111-4111-8111-111111111111/status
authorization: Bearer <access_token>
x-trace-uuid: 33333333-3333-4333-8333-333333333333
```

### Success

```json
{
  "ok": true,
  "action": "status",
  "phase": "turn_running",
  "durable_truth": {
    "conversation_uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "team_uuid": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "actor_user_uuid": "22222222-2222-4222-8222-222222222222",
    "trace_uuid": "33333333-3333-4333-8333-333333333333",
    "session_status": "active",
    "started_at": "2026-04-27T08:00:00.000Z",
    "ended_at": null,
    "last_phase": "turn_running",
    "last_event_seq": 4,
    "message_count": 2,
    "activity_count": 5,
    "latest_turn_uuid": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Notes

- `phase` 来自 runtime
- `durable_truth` 来自 D1 read model；仅在可读时附带

## `GET /sessions/{sessionUuid}/timeline`

### Success

```json
{
  "ok": true,
  "action": "timeline",
  "session_uuid": "11111111-1111-4111-8111-111111111111",
  "events": [
    {
      "kind": "session.update",
      "phase": "turn_running"
    },
    {
      "kind": "llm.delta",
      "content_type": "text",
      "content": "Hello",
      "is_final": false
    }
  ],
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

> `events` 数组里放的是 `session.stream.event` 的 **payload body**，不是 WS `event` frame 外壳。

## `GET /sessions/{sessionUuid}/history`

### Success

```json
{
  "ok": true,
  "action": "history",
  "session_uuid": "11111111-1111-4111-8111-111111111111",
  "messages": [
    {
      "message_uuid": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      "turn_uuid": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "trace_uuid": "33333333-3333-4333-8333-333333333333",
      "role": "user",
      "kind": "user.input",
      "body": {
        "text": "Reply with one short sentence."
      },
      "created_at": "2026-04-27T08:00:00.000Z"
    }
  ],
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

## `POST /sessions/{sessionUuid}/verify`

这是 preview/debug seam，不是常规产品接口。当前支持的 `check` 包括：

- `capability-call`
- `capability-cancel`
- `initial-context`
- `compact-posture`
- `filesystem-posture`

### Example request

```http
POST /sessions/11111111-1111-4111-8111-111111111111/verify
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 33333333-3333-4333-8333-333333333333

{
  "check": "initial-context"
}
```

### Example success

```json
{
  "ok": true,
  "action": "verify",
  "check": "initial-context",
  "pendingCount": 0,
  "assembledKinds": [],
  "totalTokens": 0,
  "defaultEvalRecordCount": 0,
  "phase": "unattached",
  "durable_truth": null,
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Example unsupported check

```json
{
  "ok": true,
  "action": "verify",
  "check": "unknown-check",
  "error": "unknown-verify-check",
  "supported": [
    "capability-call",
    "capability-cancel",
    "initial-context",
    "compact-posture",
    "filesystem-posture"
  ],
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

> `verify` 当前是 preview/debug seam；成功体字段取决于 `check`，因此客户端不应把它当成稳定业务 schema。

## `POST /sessions/{sessionUuid}/resume`

### Request

```http
POST /sessions/11111111-1111-4111-8111-111111111111/resume
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 33333333-3333-4333-8333-333333333333

{
  "last_seen_seq": 8
}
```

### Success

```json
{
  "ok": true,
  "data": {
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "status": "detached",
    "last_phase": "turn_running",
    "relay_cursor": 12,
    "replay_lost": false
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Notes

- 这是 HTTP 版 resume hint
- 当前 authoritative replay 入口仍是 WS query `last_seen_seq`
- 如果 `replay_lost: true`，客户端应回退到 `GET /sessions/{uuid}/timeline`
