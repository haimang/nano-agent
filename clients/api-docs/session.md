# Session, Models, Context, Files API — RHX2 Phase 6 Snapshot

> Public facade owner: `orchestrator-core`
> Auth: `Authorization: Bearer <access_token>`
> Header: `x-trace-uuid: <uuid>`

## Route Overview

| Route | Method | Shape | 说明 |
|-------|--------|-------|------|
| `/models` | `GET` | facade / `304` | model catalog + team policy filter |
| `/sessions/{id}/start` | `POST` | legacy | 启动 session |
| `/sessions/{id}/input` | `POST` | legacy | text-only input |
| `/sessions/{id}/messages` | `POST` | legacy | multipart message input |
| `/sessions/{id}/cancel` | `POST` | legacy | cancel current turn |
| `/sessions/{id}/status` | `GET` | legacy | runtime + durable status |
| `/sessions/{id}/timeline` | `GET` | legacy | stream event timeline |
| `/sessions/{id}/history` | `GET` | legacy | durable message history |
| `/sessions/{id}/verify` | `POST` | legacy | preview/debug verification harness |
| `/sessions/{id}/resume` | `POST` | facade | HTTP replay ack |
| `/sessions/{id}/usage` | `GET` | facade | usage snapshot，详见 [`usage.md`](./usage.md) |
| `/sessions/{id}/context` | `GET` | facade | context-core snapshot |
| `/sessions/{id}/context/snapshot` | `POST` | facade | trigger context snapshot |
| `/sessions/{id}/context/compact` | `POST` | facade | trigger compact |
| `/sessions/{id}/files` | `GET` | facade | list artifact metadata |
| `/sessions/{id}/files` | `POST` | facade `201` | multipart upload artifact |
| `/sessions/{id}/files/{fileUuid}/content` | `GET` | binary | read artifact bytes |

## Success Shape Warning

Some session routes are still legacy action payloads:

```json
{ "ok": true, "action": "input", "session_uuid": "...", "session_status": "active", "trace_uuid": "..." }
```

Facade routes use:

```json
{ "ok": true, "data": { "...": "..." }, "trace_uuid": "..." }
```

Web/wechat clients should normalize both shapes locally instead of assuming every `ok:true` response has `data`.

## `GET /models`

D1 truth source with per-team deny policy and ETag.

Request:

```http
GET /models
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
If-None-Match: "<etag>"
```

Success `200`:

```json
{
  "ok": true,
  "data": {
    "models": [
      {
        "model_id": "gpt-5.4",
        "family": "openai",
        "display_name": "GPT-5.4",
        "context_window": 200000,
        "capabilities": { "reasoning": true, "vision": true, "function_calling": true },
        "status": "active"
      }
    ]
  },
  "trace_uuid": "..."
}
```

`If-None-Match` 命中时返回 `304`，body 为空，header 带 `etag` 与 `x-trace-uuid`。

Errors: `invalid-auth`(401), `missing-team-claim`(403), `worker-misconfigured`(503), `models-d1-unavailable`(503, 当前 ad-hoc code)。

## Session Lifecycle

1. 推荐先 `POST /me/sessions` 获取 pending UUID。
2. 再 `POST /sessions/{id}/start` 启动。
3. 当前 `/start` 仍接受未 mint 的新 UUID。
4. pending UUID 在 `/start` 以外多数 session route 会返回 `409 session-pending-only-start-allowed`。

## `POST /sessions/{id}/start`

Request body:

```json
{ "text": "Hello" }
```

或：

```json
{ "initial_input": "Hello", "initial_context": { "layers": [] } }
```

Success legacy:

```json
{
  "ok": true,
  "action": "start",
  "session_uuid": "3333...",
  "user_uuid": "7777...",
  "last_phase": "turn_running",
  "status": "detached",
  "relay_cursor": 0,
  "first_event": { "kind": "turn.begin", "turn_uuid": "8888..." },
  "terminal": null,
  "start_ack": { "ok": true, "action": "start", "phase": "turn_running" },
  "trace_uuid": "..."
}
```

Errors: `invalid-start-body`(400), `invalid-auth-snapshot`(400), `invalid-auth`(401), `missing-team-claim`(403), `session-expired`(409), `session-already-started`(409), `agent-start-failed`(502), `agent-rpc-unavailable`(503).

## `POST /sessions/{id}/input`

Text-only alias for `/messages`.

Request:

```json
{ "text": "Tell me more" }
```

Success legacy:

```json
{
  "ok": true,
  "action": "input",
  "session_uuid": "3333...",
  "session_status": "active",
  "relay_cursor": 7,
  "message_kind": "user.input.text",
  "part_count": 1,
  "turn_uuid": "9999...",
  "trace_uuid": "..."
}
```

## `POST /sessions/{id}/messages`

Request:

```json
{
  "parts": [
    { "kind": "text", "text": "Analyze this screenshot:" },
    { "kind": "artifact_ref", "artifact_uuid": "aaaa...", "mime": "image/png", "summary": "screenshot.png" }
  ],
  "context_ref": "optional-ref",
  "stream_seq": 1
}
```

Rules:

- `parts` must be non-empty.
- text part requires non-empty `text`.
- `artifact_ref.artifact_uuid` is a non-empty string, not necessarily UUID-regex.
- Single text part yields `message_kind="user.input.text"`; multipart/artifact yields `user.input.multipart`.

## `POST /sessions/{id}/cancel`

Request:

```json
{ "reason": "changed my mind" }
```

Success legacy:

```json
{
  "ok": true,
  "action": "cancel",
  "phase": "ended",
  "session_uuid": "3333...",
  "session_status": "ended",
  "terminal": "cancelled",
  "trace_uuid": "..."
}
```

## `GET /sessions/{id}/status`

Success legacy includes runtime `phase` and optional D1 `durable_truth`.

```json
{
  "ok": true,
  "action": "status",
  "phase": "turn_running",
  "session_uuid": "3333...",
  "durable_truth": {
    "conversation_uuid": "4444...",
    "session_uuid": "3333...",
    "team_uuid": "2222...",
    "actor_user_uuid": "1111...",
    "session_status": "active",
    "last_event_seq": 12,
    "message_count": 12,
    "activity_count": 5
  },
  "trace_uuid": "..."
}
```

## `GET /sessions/{id}/timeline`

Success legacy:

```json
{
  "ok": true,
  "action": "timeline",
  "session_uuid": "3333...",
  "events": [
    { "kind": "turn.begin", "turn_uuid": "9999..." },
    { "kind": "llm.delta", "content_type": "text", "content": "Hello", "is_final": false }
  ],
  "trace_uuid": "..."
}
```

If D1 history has stream-event rows, timeline returns D1 timeline first; only empty D1 result falls back to agent-core RPC.

## `GET /sessions/{id}/history`

Success legacy:

```json
{
  "ok": true,
  "action": "history",
  "session_uuid": "3333...",
  "messages": [
    {
      "message_uuid": "bbbb...",
      "turn_uuid": "9999...",
      "role": "user",
      "kind": "user.input.multipart",
      "body": { "parts": [{ "kind": "text", "text": "Analyze this screenshot:" }] },
      "created_at": "2026-04-30T00:00:00.000Z"
    }
  ],
  "trace_uuid": "..."
}
```

## `POST /sessions/{id}/verify`

Preview/debug harness, not normal chat input.

Request:

```json
{ "check": "capability-call", "toolName": "pwd", "toolInput": {} }
```

Supported checks: `capability-call`, `capability-cancel`, `initial-context`, `compact-posture`, `filesystem-posture`.

Unknown `check` currently can still return `200 ok:true action:"verify"` with `error:"unknown-verify-check"` in payload.

## `POST /sessions/{id}/resume`

Request:

```json
{ "last_seen_seq": 5 }
```

Success facade:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "status": "detached",
    "last_phase": "turn_running",
    "relay_cursor": 5,
    "replay_lost": false
  },
  "trace_uuid": "..."
}
```

If `replay_lost:true`, client should call `/timeline` to reconcile.

## Context Routes

All three routes require valid session UUID and `CONTEXT_CORE` binding.

| Route | Body | Behavior |
|-------|------|----------|
| `GET /sessions/{id}/context` | none | calls `context-core.getContextSnapshot(sessionUuid, teamUuid, meta)` |
| `POST /sessions/{id}/context/snapshot` | optional JSON | calls `context-core.triggerContextSnapshot(...)` |
| `POST /sessions/{id}/context/compact` | optional JSON | calls `context-core.triggerCompact(...)` |

Success shape:

```json
{ "ok": true, "data": { "...context-core result...": true }, "trace_uuid": "..." }
```

Errors: `invalid-input`(400), `invalid-auth`(401), `missing-team-claim`(403), `worker-misconfigured`(503), `context-rpc-unavailable`(503, current ad-hoc code).

## Files Routes

Unlike earlier snapshots, `/files` is now wired to `filesystem-core` and supports metadata list, upload, and byte read.

### `GET /sessions/{id}/files`

Query: `limit` default 50 max 200, `cursor` optional.

Success:

```json
{
  "ok": true,
  "data": {
    "files": [
      {
        "file_uuid": "aaaa...",
        "session_uuid": "3333...",
        "team_uuid": "2222...",
        "r2_key": "teams/...",
        "mime": "image/png",
        "size_bytes": 1024,
        "original_name": "screenshot.png",
        "created_at": "2026-04-30T00:00:00.000Z"
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

### `POST /sessions/{id}/files`

Multipart upload:

| Field | Required | 说明 |
|-------|----------|------|
| `file` | yes | Blob/File, max 25 MiB |
| `mime` | no | explicit mime override; must match `type/subtype` |

Success `201`:

```json
{
  "ok": true,
  "data": {
    "file_uuid": "aaaa...",
    "session_uuid": "3333...",
    "mime": "image/png",
    "size_bytes": 1024,
    "original_name": "screenshot.png",
    "created_at": "2026-04-30T00:00:00.000Z"
  },
  "trace_uuid": "..."
}
```

Errors: `invalid-input`(400), `payload-too-large`(413, current ad-hoc code), `filesystem-rpc-unavailable`(503, current ad-hoc code).

### `GET /sessions/{id}/files/{fileUuid}/content`

Returns raw bytes, not a facade envelope.

Headers:

| Header | 说明 |
|--------|------|
| `content-type` | stored mime or `application/octet-stream` |
| `content-length` | byte size |
| `cache-control` | `no-store` |
| `content-disposition` | present when original filename exists |
| `x-trace-uuid` | request trace |

## Common Session Errors

| HTTP | error.code | 典型路由 | 说明 |
|------|------------|----------|------|
| 400 | `invalid-start-body` | `/start` | missing `text`/`initial_input` |
| 400 | `invalid-input-body` | `/input` | missing text |
| 400 | `invalid-input` | messages/context/files | invalid body/path |
| 401 | `invalid-auth` | all bearer routes | token invalid/revoked/expired or revoked device |
| 403 | `missing-team-claim` | all bearer routes | JWT lacks team/tenant truth |
| 403 | `permission-denied` | files/session ownership | cross-team or cross-user access denied |
| 404 | `session_missing` / `not-found` | session/files | missing session/file |
| 409 | `session-pending-only-start-allowed` | non-start session routes | pending UUID |
| 409 | `session-expired` | `/start` | pending UUID expired |
| 409 | `session_terminal` | follow-up/WS | session ended |
| 409 | `session-already-started` | `/start` | duplicate start |
| 502 | `agent-start-failed` | `/start` | agent-core start returned failure |
| 503 | `agent-rpc-unavailable` | agent-backed routes | missing/unavailable AGENT_CORE |
| 503 | `worker-misconfigured` | multiple | required binding missing |
