# Session, Models, Context, Files API — Current Snapshot

> Public facade owner: `orchestrator-core`
> Auth: `Authorization: Bearer <access_token>`
> Header: `x-trace-uuid: <uuid>`

## Route Overview

| Route | Method | Shape | 说明 |
|-------|--------|-------|------|
| `/models` | `GET` | facade / `304` | model catalog + team policy filter |
| `/models/{modelIdOrAlias}` | `GET` | facade | single model detail；支持 encoded canonical id 与 `@alias/*` |
| `/sessions/{id}/model` | `GET` | facade | session current-model control plane |
| `/sessions/{id}/model` | `PATCH` | facade | set / clear session default model + reasoning |
| `/sessions/{id}/start` | `POST` | legacy | 启动 session |
| `/sessions/{id}/input` | `POST` | legacy | text-only input |
| `/sessions/{id}/messages` | `POST` | legacy | multipart message input |
| `/sessions/{id}/cancel` | `POST` | legacy | cancel current turn |
| `/sessions/{id}/close` | `POST` | legacy | normal close; writes `ended_reason=closed_by_user` |
| `/sessions/{id}` | `DELETE` | legacy | soft-delete parent conversation |
| `/sessions/{id}/title` | `PATCH` | legacy | rename parent conversation |
| `/sessions/{id}/status` | `GET` | legacy | runtime + durable status |
| `/sessions/{id}/timeline` | `GET` | legacy | stream event timeline |
| `/sessions/{id}/history` | `GET` | legacy | durable message history |
| `/sessions/{id}/verify` | `POST` | legacy | preview/debug verification harness |
| `/sessions/{id}/resume` | `POST` | facade | HTTP replay ack |
| `/conversations/{conversation_uuid}` | `GET` | facade | conversation detail read model |
| `/sessions/{id}/checkpoints` | `GET` | facade | list product-facing checkpoint registry |
| `/sessions/{id}/checkpoints` | `POST` | facade `201` | create `user_named` checkpoint |
| `/sessions/{id}/checkpoints/{checkpoint_uuid}/diff` | `GET` | facade | checkpoint vs current session ledger diff |
| `/sessions/{id}/usage` | `GET` | facade | usage snapshot，详见 [`usage.md`](./usage.md) |
| `/sessions/{id}/context` | `GET` | facade | legacy alias of context probe |
| `/sessions/{id}/context/probe` | `GET` | facade | context probe / compact budget |
| `/sessions/{id}/context/layers` | `GET` | facade | assembled context layer previews |
| `/sessions/{id}/context/snapshot` | `POST` | facade | persist manual context snapshot |
| `/sessions/{id}/context/compact/preview` | `POST` | facade | manual compact preview |
| `/sessions/{id}/context/compact` | `POST` | facade | create compact boundary job |
| `/sessions/{id}/context/compact/jobs/{jobId}` | `GET` | facade | read compact job handle |
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
        "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
        "family": "workers-ai/granite",
        "display_name": "Granite 4.0 H Micro",
        "context_window": 131072,
        "capabilities": { "reasoning": false, "vision": false, "function_calling": true },
        "status": "active",
        "aliases": ["@alias/balanced"]
      }
    ]
  },
  "trace_uuid": "..."
}
```

`If-None-Match` 命中时返回 `304`，body 为空，header 带 `etag` 与 `x-trace-uuid`。

Errors: `invalid-auth`(401), `missing-team-claim`(403), `worker-misconfigured`(503), `models-d1-unavailable`(503, 当前 ad-hoc code)。

## `GET /models/{modelIdOrAlias}`

读取单模型 detail；canonical model id 需要 URL encode（例如 `%40cf%2Fmeta%2F...`），也支持 `@alias/*`。

Success `200`:

```json
{
  "ok": true,
  "data": {
    "requested_model_id": "@alias/reasoning",
    "resolved_model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
    "resolved_from_alias": true,
    "model": {
      "model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
      "family": "workers-ai/llama",
      "display_name": "Llama 4 Scout 17B 16E Instruct",
      "context_window": 131072,
      "capabilities": { "reasoning": true, "vision": true, "function_calling": true },
      "status": "active",
      "aliases": ["@alias/reasoning"],
      "max_output_tokens": 4096,
      "effective_context_pct": 0.75,
      "auto_compact_token_limit": 64000,
      "supported_reasoning_levels": ["medium", "low"],
      "input_modalities": ["text", "image"],
      "provider_key": "workers-ai",
      "fallback_model_id": null,
      "base_instructions_suffix": null,
      "description": "Reasoning profile",
      "sort_priority": 80
    }
  },
  "trace_uuid": "..."
}
```

Errors: `model-unavailable`(400), `invalid-auth`(401), `missing-team-claim`(403), `model-disabled`(403), `worker-misconfigured`(503)。

## `GET /sessions/{id}/model`

读取当前 session 的 model control-plane truth。返回值同时包含 session 默认值、当前生效默认来源（`session` / `global`）以及最近一条 turn audit。

Success `200`:

```json
{
  "ok": true,
  "data": {
    "conversation_uuid": "4444...",
    "session_uuid": "3333...",
    "session_status": "active",
    "deleted_at": null,
    "default_model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
    "default_reasoning_effort": "medium",
    "effective_default_model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
    "effective_default_reasoning_effort": "medium",
    "source": "session",
    "last_turn": {
      "turn_uuid": "9999...",
      "created_at": "2026-04-30T00:01:00.000Z",
      "requested_model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
      "requested_reasoning_effort": "medium",
      "effective_model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
      "effective_reasoning_effort": "medium",
      "fallback_used": false,
      "fallback_reason": null
    }
  },
  "trace_uuid": "..."
}
```

当 `default_model_id=null` 时表示当前 session 未持久化 session default；此时 `effective_default_model_id` 来自 global default。

## `PATCH /sessions/{id}/model`

支持 set、reasoning update 与 clear：

```json
{ "model_id": "@alias/reasoning", "reasoning": { "effort": "high" } }
```

```json
{ "model_id": null }
```

规则：

1. `model_id` 可传 canonical id 或 `@alias/*`；server 会先 resolve 再写 durable truth。
2. `model_id: null` 会清空 session default，恢复 `global default`。
3. 若请求的 reasoning 不被目标模型支持，server 会按 `supported_reasoning_levels` 的第一优先级重映射，而不是 silent drop。
4. `ended` / `expired` session 不能再修改当前模型。

Success `200` 返回 shape 与 `GET /sessions/{id}/model` 相同。

Errors: `invalid-input`(400), `model-unavailable`(400), `invalid-auth`(401), `missing-team-claim`(403), `model-disabled`(403), `session-expired`(409), `session_terminal`(409), `conversation-deleted`(409), `worker-misconfigured`(503)。

## Session Lifecycle

1. 推荐先 `POST /me/sessions` 获取 pending UUID。
2. 再 `POST /sessions/{id}/start` 启动。
3. 当前 `/start` 仍接受未 mint 的新 UUID。
4. pending UUID 在 `/start` 以外多数 session route 会返回 `409 session-pending-only-start-allowed`。
5. HP2 当前已完成 first-wave model control plane：`/models/{id}`、`GET/PATCH /sessions/{id}/model`、requested/effective turn audit 已 live；`<model_switch>` 与 `model.fallback` 仍未开放。
6. HP4 当前只完成 lifecycle / checkpoint first wave：`close` / `delete` / `title` / conversation detail / checkpoint list-create-diff 已 public；`/retry` 与 `/restore` 仍未开放。

## `POST /sessions/{id}/start`

Request body:

```json
{
  "text": "Hello",
  "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
  "reasoning": { "effort": "low" }
}
```

或：

```json
{
  "initial_input": "Hello",
  "initial_context": { "layers": [] },
  "model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "reasoning": { "effort": "high" }
}
```

可选字段：

- `model_id`: 满足 `^[a-z0-9@/._-]{1,120}$` 的模型 ID
- `reasoning.effort`: `low | medium | high`

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

Errors: `invalid-start-body`(400), `invalid-auth-snapshot`(400), `model-unavailable`(400), `invalid-auth`(401), `missing-team-claim`(403), `model-disabled`(403), `session-expired`(409), `session-already-started`(409), `agent-start-failed`(502), `agent-rpc-unavailable`(503).

## `POST /sessions/{id}/input`

Text-only alias for `/messages`.

Request:

```json
{
  "text": "Tell me more",
  "model_id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "reasoning": { "effort": "medium" }
}
```

可选字段与 `/start` 一致：`model_id`、`reasoning.effort`。

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
  "model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "reasoning": { "effort": "high" },
  "context_ref": "optional-ref",
  "stream_seq": 1
}
```

Rules:

- `parts` must be non-empty.
- text part requires non-empty `text`.
- `artifact_ref.artifact_uuid` is a non-empty string, not necessarily UUID-regex.
- `model_id` / `reasoning.effort` are optional and use the same validation/gate as `/start`.
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

## `POST /sessions/{id}/close`

Request body 可为空；可选字段：

```json
{ "reason": "done for now" }
```

Success legacy:

```json
{
  "ok": true,
  "action": "close",
  "session_uuid": "3333...",
  "conversation_uuid": "4444...",
  "session_status": "ended",
  "terminal": "completed",
  "ended_reason": "closed_by_user",
  "ended_at": "2026-04-30T00:06:00.000Z"
}
```

Behavior:

1. close 不引入新 session state；仍写 `session_status="ended"`。
2. 区别于 cancel 的 durable 语义是 `ended_reason="closed_by_user"`。
3. 重复 close 返回 `200`，并带 `already_closed: true`。

## `DELETE /sessions/{id}`

No body required.

Success legacy:

```json
{
  "ok": true,
  "action": "delete",
  "session_uuid": "3333...",
  "conversation_uuid": "4444...",
  "session_status": "ended",
  "deleted_at": "2026-04-30T00:06:00.000Z"
}
```

Behavior:

1. delete 的 durable owner 是 parent conversation，不是单条 session row。
2. 当前实现只做 soft tombstone：写 `nano_conversations.deleted_at`，不做硬删除。
3. 若 session 仍未 ended，delete 会先把当前 session 收为 `ended + closed_by_user`，再写 tombstone。
4. 重复 delete 返回 `200`，并带 `already_deleted: true`。

## `PATCH /sessions/{id}/title`

Request:

```json
{ "title": "Onboarding thread" }
```

Rules:

1. `title` 需要是 trim 后长度 `1..200` 的字符串。
2. 路由路径仍是 session-based，但真正修改的是 parent conversation 的 `title`。

Success legacy:

```json
{
  "ok": true,
  "action": "title",
  "session_uuid": "3333...",
  "conversation_uuid": "4444...",
  "title": "Onboarding thread"
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

Special preview-only check:

- `{ "check": "emit-system-error", "code": "spike-system-error" }`
- `NANO_ENABLE_RHX2_SPIKE !== "true"` 时返回 `403 spike-disabled`
- 未附着 websocket client 时返回 `409 no-attached-client`

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

## `GET /conversations/{conversation_uuid}`

Reads the current durable conversation detail for the authenticated user.

Success facade:

```json
{
  "ok": true,
  "data": {
    "conversation_uuid": "4444...",
    "team_uuid": "2222...",
    "owner_user_uuid": "1111...",
    "title": "Onboarding thread",
    "conversation_status": "active",
    "deleted_at": null,
    "created_at": "2026-04-30T00:00:00.000Z",
    "updated_at": "2026-04-30T00:06:00.000Z",
    "latest_session_uuid": "3333...",
    "latest_turn_uuid": "9999...",
    "session_count": 2,
    "latest_session": {
      "session_uuid": "3333...",
      "session_status": "ended",
      "started_at": "2026-04-30T00:00:00.000Z",
      "ended_at": "2026-04-30T00:06:00.000Z",
      "ended_reason": "closed_by_user",
      "last_phase": "turn_running"
    },
    "sessions": [
      {
        "session_uuid": "3333...",
        "session_status": "ended",
        "started_at": "2026-04-30T00:00:00.000Z",
        "ended_at": "2026-04-30T00:06:00.000Z",
        "ended_reason": "closed_by_user",
        "last_phase": "turn_running"
      }
    ]
  },
  "trace_uuid": "..."
}
```

Notes:

1. 当前只返回最近 `20` 条 session summary。
2. tombstoned conversation 默认按 `404 not-found` 处理；当前没有 public `include_deleted` 开关。

## `GET /sessions/{id}/checkpoints`

Success facade:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "conversation_uuid": "4444...",
    "checkpoints": [
      {
        "checkpoint_uuid": "aaaa...",
        "session_uuid": "3333...",
        "conversation_uuid": "4444...",
        "team_uuid": "2222...",
        "turn_uuid": "9999...",
        "turn_attempt": 1,
        "checkpoint_kind": "user_named",
        "label": "before rewrite",
        "message_high_watermark": "bbbb...",
        "latest_event_seq": 12,
        "context_snapshot_uuid": "cccc...",
        "file_snapshot_status": "none",
        "created_by": "user",
        "created_at": "2026-04-30T00:07:00.000Z",
        "expires_at": null
      }
    ]
  },
  "trace_uuid": "..."
}
```

Notes:

1. 当前 public create path 只会生成 `checkpoint_kind="user_named"`。
2. 历史上其他 phase 写入的 `compact_boundary` checkpoint 也可能出现在列表里。

## `POST /sessions/{id}/checkpoints`

Request body 可为空；可选字段：

```json
{ "label": "before rewrite" }
```

Rules:

1. `label` 如提供，必须是 trim 后长度 `1..200` 的字符串。
2. 当前 create path 固定写 `file_snapshot_status="none"`，不做 file snapshot。

Success `201`:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "conversation_uuid": "4444...",
    "checkpoint": {
      "checkpoint_uuid": "aaaa...",
      "checkpoint_kind": "user_named",
      "label": "before rewrite",
      "file_snapshot_status": "none",
      "created_by": "user"
    }
  },
  "trace_uuid": "..."
}
```

## `GET /sessions/{id}/checkpoints/{checkpoint_uuid}/diff`

Current behavior is **checkpoint vs current session ledger**, not checkpoint-to-checkpoint diff and not restore preview.

Success facade:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "conversation_uuid": "4444...",
    "diff": {
      "checkpoint": {
        "checkpoint_uuid": "aaaa...",
        "checkpoint_kind": "user_named",
        "label": "before rewrite"
      },
      "watermark_created_at": "2026-04-30T00:05:00.000Z",
      "messages_since_checkpoint": [
        {
          "message_uuid": "bbbb...",
          "turn_uuid": "9999...",
          "message_kind": "assistant.output.text",
          "created_at": "2026-04-30T00:06:00.000Z",
          "superseded_at": null
        }
      ],
      "superseded_messages": [
        {
          "message_uuid": "cccc...",
          "turn_uuid": "9999...",
          "message_kind": "assistant.output.text",
          "created_at": "2026-04-30T00:04:00.000Z",
          "superseded_at": "2026-04-30T00:06:00.000Z",
          "superseded_by_turn_attempt": 2
        }
      ]
    }
  },
  "trace_uuid": "..."
}
```

Notes:

1. 当前 diff 不包含 file diff。
2. 当前 snapshot 也还没有 public restore route；restore 会在后续 HP4 批次补齐。

## Context Routes

All context routes require valid session UUID and `CONTEXT_CORE` binding.

| Route | Body | Behavior |
|-------|------|----------|
| `GET /sessions/{id}/context` | none | legacy compatibility alias; returns the same durable probe payload as `context/probe`, plus `phase:"durable"` |
| `GET /sessions/{id}/context/probe` | none | calls `context-core.getContextProbe(sessionUuid, teamUuid, meta)` |
| `GET /sessions/{id}/context/layers` | none | calls `context-core.getContextLayers(sessionUuid, teamUuid, meta)` |
| `POST /sessions/{id}/context/snapshot` | none | persists a `manual-snapshot` row in `nano_conversation_context_snapshots` |
| `POST /sessions/{id}/context/compact/preview` | none | returns manual compact preview, summary preview, and `would_create_job_template` hint |
| `POST /sessions/{id}/context/compact` | none | creates a durable `compact_boundary` checkpoint-backed job handle |
| `GET /sessions/{id}/context/compact/jobs/{jobId}` | none | rereads the checkpoint-backed compact job |

Probe example:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "team_uuid": "2222...",
    "status": "active",
    "need_compact": true,
    "model": {
      "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
      "context_window": 131072,
      "effective_context_pct": 0.75,
      "auto_compact_token_limit": null,
      "max_output_tokens": 1024,
      "threshold_source": "effective_context_pct"
    },
    "usage": {
      "total_tokens": 98432,
      "compact_trigger_tokens": 98304,
      "usage_pct": 1.0013,
      "headroom_tokens": 0,
      "estimate_basis": "durable-usage-aggregate"
    },
    "compact": {
      "latest_notify": null,
      "preview": {
        "compacted_message_count": 14,
        "kept_message_count": 6,
        "protected_recent_turns": 3,
        "would_create_job_template": {
          "checkpoint_kind": "compact_boundary",
          "created_by": "compact",
          "message_high_watermark": "..."
        }
      }
    }
  },
  "trace_uuid": "..."
}
```

Compact preview example:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "team_uuid": "2222...",
    "need_compact": true,
    "tokens_before": 98432,
    "estimated_tokens_after": 24120,
    "compacted_message_count": 14,
    "kept_message_count": 6,
    "protected_recent_turns": 3,
    "high_watermark": "...",
    "protected_fragment_kinds": ["model_switch"],
    "summary_preview": "compact-boundary summary\n[user/user.input.text] ...",
    "would_create_job_template": {
      "checkpoint_kind": "compact_boundary",
      "created_by": "compact",
      "message_high_watermark": "..."
    }
  },
  "trace_uuid": "..."
}
```

Compact job example:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "team_uuid": "2222...",
    "job_id": "aaaa...",
    "checkpoint_uuid": "aaaa...",
    "context_snapshot_uuid": "bbbb...",
    "status": "completed",
    "tokens_before": 98432,
    "tokens_after": 24120,
    "message_high_watermark": "...",
    "summary_text": "compact-boundary summary\n...",
    "protected_fragment_kinds": ["model_switch"]
  },
  "trace_uuid": "..."
}
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
| 400 | `model-unavailable` | `/start` `/input` `/messages` | requested model inactive / not found |
| 400 | `invalid-input` | messages/context/files | invalid body/path |
| 401 | `invalid-auth` | all bearer routes | token invalid/revoked/expired or revoked device |
| 403 | `missing-team-claim` | all bearer routes | JWT lacks team/tenant truth |
| 403 | `model-disabled` | `/start` `/input` `/messages` | team policy forbids this model |
| 403 | `permission-denied` | files/session ownership | cross-team or cross-user access denied |
| 403 | `spike-disabled` | `/verify` spike check | preview-only system.error spike disabled |
| 403 | `wrong-device` | follow-up session routes | session already bound to another device |
| 404 | `session_missing` / `not-found` | session/files | missing session/file |
| 409 | `conversation-deleted` | checkpoint routes | parent conversation already tombstoned |
| 409 | `session-pending-only-start-allowed` | non-start session routes | pending UUID |
| 409 | `session-expired` | `/start` | pending UUID expired |
| 409 | `no-attached-client` | `/verify` spike check | verify spike requires attached websocket client |
| 409 | `session_terminal` | follow-up/WS | session ended |
| 409 | `session-already-started` | `/start` | duplicate start |
| 502 | `agent-start-failed` | `/start` | agent-core start returned failure |
| 503 | `agent-rpc-unavailable` | agent-backed routes | missing/unavailable AGENT_CORE |
| 503 | `worker-misconfigured` | multiple | required binding missing |
