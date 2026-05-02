# session-ws-v1 — WebSocket Frame Protocol

> Public facade owner: `orchestrator-core`
> Implementation reference: `packages/nacp-session/src/{stream-event,messages}.ts`,`workers/orchestrator-core/src/{user-do/ws-runtime.ts,frame-compat.ts,user-do/session-flow/start.ts}`
> Wire format: lightweight JSON `{kind, ...}` frames
>
> 注意：outer WS frame `kind` 与 `event.payload.kind` 是两层枚举。outer 表示 transport-level frame type；payload.kind 表示 stream event 的语义子类型（当前 canonical catalog 为 13 kinds）。

---

## 1. Connect URL

```text
wss://<base>/sessions/{sessionUuid}/ws?access_token=<jwt>&trace_uuid=<uuid>&last_seen_seq=<integer>
```

| Query Param | 必填 | 说明 |
|-------------|------|------|
| `access_token` | yes | HMAC access token |
| `trace_uuid` | yes | 与 HTTP `x-trace-uuid` 同义 |
| `last_seen_seq` | no | reconnect 时客户端最后处理的 event seq |

### 1.1 Start → WS attach 帧保留窗口（HPX5 F7）

`POST /sessions/{id}/start` success body 会返回 `first_event` 与 `first_event_seq`。客户端完成 start 后应尽快 attach WS，并把 `first_event_seq` 作为 `last_seen_seq` 兜底传回，避免 start→attach 窗口丢帧：

1. 读取 `/start` 返回的 `first_event_seq`
2. 立刻连接 `GET /sessions/{id}/ws?...&last_seen_seq=<first_event_seq>`
3. 若 `first_event_seq = 0`，说明当前 start 周期还没产生第一帧，继续传 `0`

## 2. Handshake Errors

| HTTP | error.code | 说明 |
|------|------------|------|
| 400 | `invalid-trace` | 缺少或非法 trace UUID |
| 401 | `invalid-auth` | token 无效、过期、device revoked |
| 403 | `missing-team-claim` | JWT 无 team/tenant claim |
| 404 | `session_missing` | session 不存在 |
| 409 | `session-pending-only-start-allowed` | session 仍是 pending |
| 409 | `session_terminal` | session 已终态 |

---

## 3. Server → Client Frames

### 3.1 `event` Outer Frame

```json
{
  "kind": "event",
  "seq": 12,
  "name": "session.stream.event",
  "payload": { "kind": "<stream-event-kind>", "...": "..." }
}
```

`seq` 单调递增；reconnect 时客户端用 `last_seen_seq` 让 server 回放未确认 frame。

### 3.2 Stream Event Kinds（13-kind catalog）

| payload.kind | shape | 引入阶段 | client 行为 |
|--------------|-------|----------|-------------|
| `llm.delta` | `{content_type, content, is_final}` | RHX2 | 流式渲染 LLM 输出 |
| `tool.call.progress` | `{tool_name, request_uuid?, chunk, is_final}` | RHX2 | 渲染工具进度 |
| `tool.call.result` | `{tool_name, request_uuid?, status, output?, error_message?}` | RHX2 | 工具完成 |
| `tool.call.cancelled` | `{tool_name, request_uuid, cancel_initiator}` | **HP6** | 工具取消通知；`cancel_initiator ∈ {user, system, parent_cancel}` |
| `hook.broadcast` | `{event_name, payload_redacted, aggregated_outcome?}` | RHX2 | hook 广播 |
| `session.update` | `{phase, partial_output?}` | RHX2 | session phase 变化 |
| `turn.begin` | `{turn_uuid}` | RHX2 | turn 起始 |
| `turn.end` | `{turn_uuid, usage?}` | RHX2 | turn 结束 |
| `compact.notify` | `{status, tokens_before?, tokens_after?}` | HP3 | compact 通知（`started/completed/failed`） |
| `session.fork.created` | `{parent_session_uuid, child_session_uuid, conversation_uuid, from_checkpoint_uuid, restore_job_uuid}` | **HP7** | fork 建立通知（schema live；executor 未 live） |
| `model.fallback` | `{turn_uuid, requested_model_id, fallback_model_id, fallback_reason}` | **HP2 / HPX5** | live (HPX5 F4) — emit 当 turn 关闭时 fallback_used=true |
| `system.notify` | `{severity, message, code?, trace_uuid?}` | RHX2 | 通用通知 |
| `system.error` | `{error:{code,category,message,detail?,retryable}, source_worker?, trace_uuid?}` | RHX2 | 结构化 runtime error |

`system.error` 是结构化 runtime error frame，client 应配合 [`error-index.md`](./error-index.md) 决定 retry / report UX。

### 3.3 Confirmation Frame Family（HP5 schema frozen，HPX5 F1 emitter live）

```json
{
  "kind": "session.confirmation.request",
  "confirmation_uuid": "...",
  "confirmation_kind": "tool_permission",
  "payload": { "tool_name": "bash", "tool_input": { "...": "..." } },
  "request_uuid": "...",
  "created_at": "..."
}
```

```json
{
  "kind": "session.confirmation.update",
  "confirmation_uuid": "...",
  "status": "allowed",
  "decision_payload": { "scope": "once", "reason": "user approved" },
  "decided_at": "..."
}
```

| Frame | 方向 | 用途 |
|-------|------|------|
| `session.confirmation.request` | server → client | confirmation row 创建后的 lightweight frame 形状 |
| `session.confirmation.update` | server → client | confirmation row 状态变化后的 lightweight frame 形状 |

> **当前实现状态**：HPX5 F1 已 live。confirmation row create / terminal update 后会 best-effort emit 这两个顶层帧；提交 decision 仍必须用 HTTP `POST /sessions/{id}/confirmations/{uuid}/decision`。
>
> **字段说明**：lightweight wire shape 的 outer `kind` 已被 `session.confirmation.request` 占用，所以 confirmation 类型字段在 wire 上使用 `confirmation_kind`；其 canonical body schema 对应字段名是 `kind`。

详见 [`confirmations.md`](./confirmations.md)（含 7-kind readiness matrix）。

### 3.4 Todo Frame Family（HP6 schema frozen，HPX5 F2 emitter live）

```json
{
  "kind": "session.todos.write",
  "todos": [
    { "content": "draft review", "status": "pending" }
  ],
  "request_uuid": "..."
}
```

```json
{
  "kind": "session.todos.update",
  "session_uuid": "...",
  "todos": [
    {
      "todo_uuid": "...",
      "session_uuid": "...",
      "conversation_uuid": "...",
      "parent_todo_uuid": null,
      "content": "draft review",
      "status": "in_progress",
      "created_at": "...",
      "updated_at": "...",
      "completed_at": null
    }
  ]
}
```

| Frame | 方向 | 用途 |
|-------|------|------|
| `session.todos.write` | client/model → server | todo upsert 命令形状（HTTP-only 客户端通常不直接走 WS） |
| `session.todos.update` | server → client | authoritative todo 全量快照 |

> **当前实现状态**：HPX5 F2 已 live。HTTP todo CRUD 和 LLM `write_todos` 成功写入后，server 会 emit `session.todos.update` authoritative snapshot。详见 [`todos.md`](./todos.md)。

### 3.5 `session.heartbeat`

```json
{ "kind": "session.heartbeat", "ts": 1760000000000 }
```

Server 默认每 15 秒发一次。client 收到后应更新本地 lastSeen，超时 ≥ 60 秒可考虑触发重连。

### 3.6 `session.attachment.superseded`

```json
{
  "kind": "session.attachment.superseded",
  "session_uuid": "3333...",
  "superseded_at": "2026-04-30T00:00:00.000Z",
  "reason": "reattach"
}
```

`reason` ∈ `{reattach, revoked}`。旧 socket 会被 server 用 close code `4001` 关闭。

### 3.7 `session.end`

```json
{
  "kind": "session.end",
  "reason": "completed",
  "session_uuid": "3333...",
  "last_phase": "ended"
}
```

| durable terminal | frame reason | close |
|------------------|--------------|-------|
| `completed` | `completed` | `1000 session_completed` |
| `cancelled` | `user` | `1000 session_cancelled` |
| `error` | `error` | `1000 session_error` |

### 3.8 `session.usage.update`（HP9 frozen 阶段已 live）

```json
{
  "kind": "session.usage.update",
  "session_uuid": "...",
  "usage": {
    "llm_input_tokens": 1280,
    "llm_output_tokens": 342,
    "tool_calls": 2,
    "subrequest_used": 1624,
    "subrequest_budget": 80000
  },
  "ts": 1760000000000
}
```

LLM / tool quota commit 后被动推送。详见 [`usage.md`](./usage.md)。

### 3.9 RHX2 Dual-Emit Window

`system.error` 当前与 backwards-compatible 的 `system.notify(severity="error")` 一起发出，二者带同 `code` + `trace_uuid`。client 应：

1. 渲染结构化 `system.error`。
2. 跟踪 `(trace_uuid, code)` ~1 秒。
3. 抑制随后匹配的 `system.notify(severity="error")`。

dual-emit 窗口仍 active；详见 `docs/issue/real-to-hero/RHX2-dual-emit-window.md`。

### 3.10 Synthetic Spike Trigger（preview only）

`POST /sessions/{id}/verify` 接受 `{ "check": "emit-system-error", "code": "spike-system-error" }`：

- `403 spike-disabled` 当 `NANO_ENABLE_RHX2_SPIKE !== "true"`（生产 posture）。
- `409 no-attached-client` 当无 WS 附着。
- `200 ok:true` + `system.error` (+ 配对 `system.notify`) 帧 on success。

生产部署保持 flag `false`——客户端不应假设此 trigger 在 prod 可用。

---

## 4. Client → Server Frames

public `orchestrator-core` WS 当前仅把 client frame 当作 activity touch：

| Frame | Body | 当前作用 |
|-------|------|----------|
| `session.resume` | `{last_seen_seq}` | touch session（reconnect ack） |
| `session.heartbeat` | `{ts}` | touch session |
| `session.stream.ack` | `{stream_uuid, acked_seq}` | touch session |

> permission / elicitation / confirmation **decision 不能通过 WS push**——必须用 HTTP（详见 [`confirmations.md`](./confirmations.md)、[`permissions.md`](./permissions.md)）。这是 HPX-Q18 frozen direction matrix。

---

## 5. Reconnect Flow

1. client 跟踪 max seen `event.seq`。
2. Reconnect with `last_seen_seq=<maxSeq>`。
3. server best-effort 回放 buffered events。
4. 若不确定，调用 `POST /sessions/{id}/resume`。
5. 若 `resume.data.replay_lost === true`，用 `GET /sessions/{id}/timeline` 做 reconciliation。

---

## 6. Close Codes

| Code | Meaning |
|------|---------|
| `1000` | normal close after session end |
| `4001` | attachment superseded by reattach or device revoke |

---

## 7. Frame Schema 法律

所有 frame 都由 `packages/nacp-session/src/stream-event.ts` 中的 zod schema 严格校验；server 在 emit 前会跑 schema validate。如果某个 server-emitted frame 在 client 看到 unknown / extra 字段，那是 build-time 漂移（不是 transport-level bug），请上报 trace_uuid。

direction matrix（哪些 frame kind 允许 server→client / client→server）由 `packages/nacp-session/src/type-direction-matrix.ts` 冻结；HP5 的 confirmation frames 与 HP6 的 todo frames 都被加入到 server-only 集合。

---

## 8. Deferred / Readiness Notes

| 能力 | 状态 | 替代 |
|------|------|------|
| client → server permission/elicitation/confirmation reply via WS | **not supported by design** | HTTP routes（详见 §4 备注） |
| `session.usage.update` server frame | **live** | (见 §3.8) |
| `model.fallback` stream event | **live (HPX5 F4)** | 用于前端 model badge / fallback reducer |
| 自动 fork executor + `session.fork.created` 实际触发 | **schema live, executor not-live**（HP7 后续批次） | 暂无 |
