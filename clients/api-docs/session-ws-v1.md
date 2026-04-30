# session-ws-v1 — RHX2 Phase 7-9 Snapshot

> Public facade owner: `orchestrator-core`
> Wire format: lightweight JSON `{kind, ...}` frames
> 注意：outer WS frame `kind` 与 `event.payload.kind` 是两层枚举。

## Connect URL

```text
wss://<base>/sessions/{sessionUuid}/ws?access_token=<jwt>&trace_uuid=<uuid>&last_seen_seq=<integer>
```

| Query Param | 必填 | 说明 |
|-------------|------|------|
| `access_token` | yes | HMAC access token |
| `trace_uuid` | yes | 与 HTTP `x-trace-uuid` 同义 |
| `last_seen_seq` | no | reconnect 时客户端最后处理的 event seq |

## Handshake Errors

| HTTP | error.code | 说明 |
|------|------------|------|
| 400 | `invalid-trace` | 缺少或非法 trace UUID |
| 401 | `invalid-auth` | token 无效、过期、device revoked |
| 403 | `missing-team-claim` | JWT 无 team/tenant claim |
| 404 | `session_missing` | session 不存在 |
| 409 | `session-pending-only-start-allowed` | session 仍是 pending |
| 409 | `session_terminal` | session 已终态 |

## Server → Client Frames

### `event`

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

Current `event.payload.kind` values from `@haimang/nacp-session`:

| payload.kind | Shape / 说明 |
|--------------|--------------|
| `llm.delta` | `{content_type:"text"|"thinking"|"tool_use_start"|"tool_use_delta", content, is_final}` |
| `tool.call.progress` | `{tool_name, request_uuid?, chunk, is_final}` |
| `tool.call.result` | `{tool_name, request_uuid?, status:"ok"|"error", output?, error_message?}` |
| `hook.broadcast` | `{event_name, payload_redacted, aggregated_outcome?}` |
| `session.update` | `{phase, partial_output?}` |
| `turn.begin` | `{turn_uuid}` |
| `turn.end` | `{turn_uuid, usage?}` |
| `compact.notify` | `{status:"started"|"completed"|"failed", tokens_before?, tokens_after?}` |
| `system.notify` | `{severity:"info"|"warning"|"error", message, code?, trace_uuid?}` |
| `system.error` | `{error:{code,category,message,detail?,retryable}, source_worker?, trace_uuid?}` |

`system.error` is the structured runtime error frame. Client should treat it as a high-signal error event and use [`error-index.md`](./error-index.md) to decide retry/report UX.

### Dual-emit window (Phase 7-9)

Per RHX2 Phase 7-9 closure, `system.error` is paired with a backwards-compatible `system.notify(severity="error")` that carries the same `code` and `trace_uuid`. Modern clients should:

1. Render the structured `system.error` frame.
2. Track `(trace_uuid, code)` for ~1 second.
3. Suppress any subsequent `system.notify(severity="error")` whose `(trace_uuid, code)` matches.

The window remains active until the gate registered in `docs/issue/real-to-hero/RHX2-dual-emit-window.md` flips to single-emit. Production today still double-emits.

### Synthetic spike trigger

`POST /sessions/{id}/verify` accepts `{ "check": "emit-system-error", "code": "spike-system-error" }` for preview / spike testing. Behaviour:

- `403 spike-disabled` when `NANO_ENABLE_RHX2_SPIKE !== "true"` (production posture).
- `409 no-attached-client` when no WebSocket is currently attached.
- `200 ok:true` and a `system.error` (+ paired `system.notify`) frame on the attached socket on success.

Production deploys keep the flag `false` — clients must not depend on this trigger surfacing in production.

### `session.heartbeat`

```json
{ "kind": "session.heartbeat", "ts": 1760000000000 }
```

Sent every 15 seconds by the server.

### `session.attachment.superseded`

```json
{
  "kind": "session.attachment.superseded",
  "session_uuid": "3333...",
  "superseded_at": "2026-04-30T00:00:00.000Z",
  "reason": "reattach"
}
```

Reasons currently include `reattach` and `revoked`. The old socket is closed with close code `4001`.

### `session.end`

```json
{
  "kind": "session.end",
  "reason": "completed",
  "session_uuid": "3333...",
  "last_phase": "ended"
}
```

Terminal reason maps from durable terminal state:

| durable terminal | frame reason | close |
|------------------|--------------|-------|
| `completed` | `completed` | `1000 session_completed` |
| `cancelled` | `user` | `1000 session_cancelled` |
| `error` | `error` | `1000 session_error` |

## Client → Server Messages

Public `orchestrator-core` WS currently treats client messages as activity touch only. The following frames are safe compatibility shapes:

| Frame | Body | Current effect |
|-------|------|----------------|
| `session.resume` | `{last_seen_seq}` | touch session |
| `session.heartbeat` | `{ts}` | touch session |
| `session.stream.ack` | `{stream_uuid, acked_seq}` | touch session |

Do not rely on public WS for permission/elicitation decisions; use HTTP routes.

## Reconnect Flow

1. Track max seen `event.seq`.
2. Reconnect with `last_seen_seq=<maxSeq>`.
3. Server best-effort replays buffered events.
4. If uncertain, call `POST /sessions/{id}/resume`.
5. If `resume.data.replay_lost === true`, use `GET /sessions/{id}/timeline` for reconciliation.

## Close Codes

| Code | Meaning |
|------|---------|
| `1000` | normal close after session end |
| `4001` | attachment superseded by reattach or device revoke |

## Current Limitations

| 能力 | 状态 | 替代 |
|------|------|------|
| `session.permission.request` public WS round-trip | not live | `POST /sessions/{id}/permission/decision` |
| `session.elicitation.request` public WS round-trip | not live | `POST /sessions/{id}/elicitation/answer` |
| `session.usage.update` live push | not live | `GET /sessions/{id}/usage` |
| Client permission/elicitation WS reply | not supported | HTTP routes |
| Initial `meta(opened)` frame | not sent | first frames are event/heartbeat/session.end/etc. |
