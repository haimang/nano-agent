# Session API

## Routes

| Route | Method | Auth | 说明 |
|------|--------|------|------|
| `/sessions/{sessionUuid}/start` | `POST` | bearer | 启动 session |
| `/sessions/{sessionUuid}/input` | `POST` | bearer | follow-up input |
| `/sessions/{sessionUuid}/cancel` | `POST` | bearer | 请求取消 |
| `/sessions/{sessionUuid}/status` | `GET` | bearer | 读取当前状态 |
| `/sessions/{sessionUuid}/timeline` | `GET` | bearer | 读取事件时间线 |
| `/sessions/{sessionUuid}/history` | `GET` | bearer | 读取消息历史 |
| `/sessions/{sessionUuid}/verify` | `POST` | bearer | runtime verification/debug |
| `/sessions/{sessionUuid}/ws` | `GET` upgrade | query token compatibility | session stream |

## Start

```http
POST /sessions/{sessionUuid}/start
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: <uuid>

{
  "initial_input": "Reply with one short sentence."
}
```

## Follow-up input

```http
POST /sessions/{sessionUuid}/input
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: <uuid>

{
  "text": "continue",
  "session_uuid": "{same-sessionUuid}"
}
```

## WebSocket

```text
wss://nano-agent-orchestrator-core-preview.haimang.workers.dev/sessions/{sessionUuid}/ws
  ?access_token=<token>
  &trace_uuid=<uuid>
  &last_seen_seq=0
```

客户端当前应发送的 compatibility frames：

```json
{ "message_type": "session.resume", "body": { "last_seen_seq": 0 } }
{ "message_type": "session.heartbeat", "body": { "ts": 1760000000000 } }
{ "message_type": "session.stream.ack", "body": { "stream_uuid": "main", "acked_seq": 12 } }
```

## Notes

1. `orchestrator-core` 是唯一 public session owner。
2. `agent-core /internal/*` 只给内部 relay 使用。
3. 小程序和 web 目前都采用 `HTTP start/input + websocket stream` baseline。
