# session-ws-v1 — ZX5 Snapshot

> Public facade owner: `orchestrator-core`
> 当前 wire: **lightweight JSON `{kind, ...}` frames**
> public WS frame 与 `event.payload.kind` 是两层枚举，不要混用

---

## Connect URL

```
wss://<base>/sessions/{sessionUuid}/ws
  ?access_token=<jwt>
  &trace_uuid=<uuid>
  &last_seen_seq=<integer>
```

| Query Param | 必填 | 说明 |
|-------------|------|------|
| `access_token` | ✅ | HMAC JWT access token |
| `trace_uuid` | ✅ | 与 HTTP `x-trace-uuid` 同义 |
| `last_seen_seq` | optional | reconnect 时客户端最后见到的 event seq |

---

## Handshake Errors

| HTTP | error.code | 说明 |
|------|-----------|------|
| 400 | `invalid-trace` | 缺 / 非法 `trace_uuid` |
| 401 | `invalid-auth` | 缺 / 非法 `access_token` |
| 403 | `missing-team-claim` | JWT 无 team claim |
| 404 | `session_missing` | session 不存在 |
| 409 | `session-pending-only-start-allowed` | session 仍是 pending，只允许 `/start` |
| 409 | `session_terminal` | session 已终态 |

---

## Current Live Server Frames

### 1. `event`

```json
{
  "kind": "event",
  "seq": 12,
  "name": "session.stream.event",
  "payload": {
    "kind": "llm.delta",
    "content_type": "text",
    "content": "Hello",
    "is_final": false
  }
}
```

`event.payload.kind` 当前真实可见集合来自 `@haimang/nacp-session`：

| payload.kind | 说明 |
|--------------|------|
| `llm.delta` | LLM token / delta 输出 |
| `tool.call.progress` | tool 进度块：`{tool_name, request_uuid?, chunk, is_final}` |
| `tool.call.result` | tool 结果：`{tool_name, request_uuid?, status, output?, error_message?}` |
| `hook.broadcast` | hook 广播 |
| `session.update` | session phase / partial_output 更新 |
| `turn.begin` | turn 开始 |
| `turn.end` | turn 结束 |
| `compact.notify` | compact posture 通知 |
| `system.notify` | 系统提示（info / warning / error） |

### 2. `session.heartbeat`

```json
{
  "kind": "session.heartbeat",
  "ts": 1760000000000
}
```

- 由服务端固定周期发送
- 当前实现的心跳间隔是 **15 秒**

### 3. `attachment_superseded`

```json
{
  "kind": "attachment_superseded",
  "reason": "replaced_by_new_attachment",
  "new_attachment_at": "2026-04-29T00:05:00.000Z"
}
```

- 表示同一 session 建立了新连接
- 旧连接随后会被服务端关闭，close code = `4001`

### 4. `terminal`

```json
{
  "kind": "terminal",
  "terminal": "completed",
  "session_uuid": "3333...",
  "last_phase": "ended"
}
```

- `terminal` 取值：`completed` / `cancelled` / `error`
- 服务端随后关闭连接，close code = `1000`

---

## Client → Server Messages

当前 public WS **不会解析业务语义**；任何 client→server message 的实际效果都只是 touch session 活跃时间。

推荐仍发送以下兼容帧，便于未来收紧语义时平滑迁移：

| Frame | Body | 当前效果 |
|-------|------|----------|
| `session.resume` | `{last_seen_seq}` | touch session |
| `session.heartbeat` | `{ts}` | touch session |
| `session.stream.ack` | `{stream_uuid, acked_seq}` | touch session |

> 与 agent-core 内部 DO 路径不同，public `orchestrator-core` WS 当前不会校验这些 body，也不会基于它们直接驱动 replay / ack 语义。

---

## Reconnect Flow

1. 客户端记录自己见过的最大 `event.seq`
2. 重连时带 `?last_seen_seq=<maxSeq>`
3. 服务端会尽力从 gap 处重放仍保留的 `event` frames
4. 若怀疑服务端 replay 不完整，可调用 `POST /sessions/{uuid}/resume`
5. `resume.data.replay_lost === true` 时，应再以 `GET /sessions/{uuid}/timeline` 作为最终对账

---

## Close Codes

| Code | 含义 |
|------|------|
| `1000` | normal close（session terminal 后） |
| `4001` | attachment_superseded（新连接替换旧连接） |

---

## Important Current Limitations

| 能力 | 状态 | 替代路径 |
|------|------|---------|
| `session.permission.request` public WS round-trip | **未 live** | HTTP `POST /sessions/{id}/permission/decision` |
| `session.elicitation.request` public WS round-trip | **未 live** | HTTP `POST /sessions/{id}/elicitation/answer` |
| `session.usage.update` live push | **未 live** | HTTP `GET /sessions/{id}/usage` |
| 客户端 permission / elicitation 决定的 WS 回传 | **不支持** | HTTP 路径 |
| `meta(opened)` 初始握手 frame | **不发送** | public WS 直接从 `event` / heartbeat / terminal 等 frame 开始 |
