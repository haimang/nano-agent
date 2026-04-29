# Session HTTP API — ZX5 Snapshot

> Public facade owner: `orchestrator-core`
> Profiles: `facade-http-v1` + `session-ws-v1`
> Auth: `Authorization: Bearer <access_token>`
> Header: `x-trace-uuid: <uuid>`
> Tenant guard: 需要 `TEAM_UUID` env + JWT 含 `team_uuid` / `tenant_uuid`

---

## Route Overview

| Route | Method | Auth | 说明 |
|-------|--------|------|------|
| `/sessions/{id}/start` | `POST` | bearer | 启动 session |
| `/sessions/{id}/input` | `POST` | bearer | text-only 输入（`/messages` 别名） |
| `/sessions/{id}/messages` | `POST` | bearer | 多模态输入 |
| `/sessions/{id}/cancel` | `POST` | bearer | 取消当前 turn |
| `/sessions/{id}/status` | `GET` | bearer | 状态查询 |
| `/sessions/{id}/timeline` | `GET` | bearer | stream event 时间线 |
| `/sessions/{id}/history` | `GET` | bearer | durable message 历史 |
| `/sessions/{id}/verify` | `POST` | bearer | preview/debug verification harness |
| `/sessions/{id}/ws` | `GET` | query `?access_token=` | WebSocket 会话流 |
| `/sessions/{id}/resume` | `POST` | bearer | HTTP resume ack |
| `/sessions/{id}/files` | `GET` | bearer | artifact 元数据列表 |

> `usage` 见 [`usage.md`](./usage.md)；permission / elicitation 路径见 [`permissions.md`](./permissions.md)。

---

## Success Response Shapes

| 路由 | 成功形状 | 说明 |
|------|---------|------|
| `start/input/messages/cancel/status/timeline/history/verify/files` | legacy action payload | `{ok:true, action:"...", session_uuid, ...}` |
| `resume` | facade envelope | `{ok:true, data:{session_uuid,...}, trace_uuid}` |

---

## Current Session Lifecycle Reality

1. **推荐路径**：先 `POST /me/sessions` mint pending UUID，再 `POST /sessions/{id}/start`
2. **当前实现现状**：`/start` 仍接受一个从未 mint 的全新 UUID，并在首次 start 时直接创建 durable session
3. **pending guard**：已经 mint 但尚未 start 的 UUID，在 `/start` 之外的大多数 session 路径会返回 `409 session-pending-only-start-allowed`

---

## `POST /sessions/{sessionUuid}/start`

### Request
```http
POST /sessions/{sessionUuid}/start HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "text": "Hello, who are you?",
  "initial_context": {
    "layers": []
  }
}
```

### Request Body

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `text` | conditional | string | 初始输入文本；与 `initial_input` 二选一 |
| `initial_input` | conditional | string | 与 `text` 等价的兼容字段 |
| `initial_context` | no | any | preview / context 验证用 payload |

### Success (200)
```json
{
  "ok": true,
  "action": "start",
  "session_uuid": "3333...",
  "user_uuid": "7777...",
  "last_phase": "turn_running",
  "status": "detached",
  "relay_cursor": 0,
  "first_event": {
    "kind": "turn.begin",
    "turn_uuid": "8888..."
  },
  "terminal": null,
  "start_ack": {
    "ok": true,
    "action": "start",
    "phase": "turn_running"
  },
  "trace_uuid": "..."
}
```

### Behavior

- 若 `sessionUuid` 是 `/me/sessions` mint 出来的 pending row，则先做 D1 conditional claim（`pending -> starting`）
- 若 `sessionUuid` 在 D1 / KV 中都不存在，**当前仍会作为一个全新 session 启动**
- 同一 UUID 重复 start 会返回 `409 session-already-started`
- `status` 字段当前来自 `SessionEntry.status`，可能是 `active` 或 `detached`

### Errors

| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-start-body` | body 缺失 `text` / `initial_input` |
| 400 | `invalid-auth-snapshot` | 内部注入的 `auth_snapshot.sub` 缺失 |
| 401 | `invalid-auth` | bearer token 无效 |
| 403 | `missing-team-claim` | JWT 无 team truth |
| 409 | `session-expired` | 该 UUID 对应的 pending row 已过期 |
| 409 | `session-already-started` | 该 UUID 已被 start / 已 ended / 并发 claim 失败 |
| 502 | `agent-start-failed` | agent-core start 返回失败 |
| 503 | `agent-rpc-unavailable` | AGENT_CORE binding / authority 不可用 |

---

## `POST /sessions/{sessionUuid}/input`

> `/input` 是 `/messages` 的 thin alias。服务端将 `{text}` 归一化为 `parts:[{kind:'text', text}]`，并保留 `_origin:'input'` 用于 observability。

### Request
```http
POST /sessions/{sessionUuid}/input HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "text": "Tell me more"
}
```

### Success (200)
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

> `input/messages/cancel` 这类 follow-up ack 使用 `session_status`，而 `start` 用的是 `status`，这是当前 legacy 命名差异。

### Errors

| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-input-body` | `text` 缺失或为空 |
| 404 | `session_missing` | session 不存在 |
| 409 | `session-pending-only-start-allowed` | 该 UUID 仍是 pending |
| 409 | `session_terminal` | session 已终态 |

---

## `POST /sessions/{sessionUuid}/messages`

### Request
```http
POST /sessions/{sessionUuid}/messages HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "parts": [
    { "kind": "text", "text": "Analyze this screenshot:" },
    { "kind": "artifact_ref", "artifact_uuid": "aaaa...", "mime": "image/png", "summary": "screenshot.png" }
  ]
}
```

### Body Schema

```typescript
{
  parts: Array<
    | { kind: "text"; text: string }
    | { kind: "artifact_ref"; artifact_uuid: string; mime?: string; summary?: string }
  >;
  trace_uuid?: string;
  context_ref?: string;
  stream_seq?: number;
}
```

> 当前 `artifact_ref.artifact_uuid` 只要求是**非空字符串**；服务端并未强制 UUID regex。

### Success (200)
```json
{
  "ok": true,
  "action": "messages",
  "session_uuid": "3333...",
  "session_status": "active",
  "relay_cursor": 7,
  "message_kind": "user.input.multipart",
  "part_count": 2,
  "turn_uuid": "9999...",
  "trace_uuid": "..."
}
```

### Behavior

- 单 text part → `message_kind = "user.input.text"`
- 多 part 或包含 `artifact_ref` → `message_kind = "user.input.multipart"`
- parts 会被归一化成：
  - text parts → 原文
  - artifact parts → `[artifact:<artifact_uuid>|summary]`
- 然后一起 forward 到 agent-core `input` RPC
- `artifact_ref` 当前只驱动 message history / files metadata，不提供 bytes download

### Errors

| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-input` | `parts` 非法、part kind 不支持、text 为空、artifact_uuid 缺失 |
| 400 | `missing-authority` | 缺持久化 auth snapshot |
| 404 | `session_missing` | session 不存在 |
| 409 | `session_terminal` | session 已终态 |

---

## `POST /sessions/{sessionUuid}/cancel`

### Request
```http
POST /sessions/{sessionUuid}/cancel HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "reason": "changed my mind"
}
```

### Success (200)
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

### Errors

| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `missing-authority` | 缺持久化 auth snapshot |
| 404 | `session_missing` | session 不存在 |
| 409 | `session_terminal` | session 已终态 |

---

## `GET /sessions/{sessionUuid}/status`

### Success (200)
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
    "trace_uuid": "aaaa...",
    "session_status": "active",
    "started_at": "2026-04-29T00:00:00.000Z",
    "ended_at": null,
    "last_phase": "turn_running",
    "last_event_seq": 12,
    "message_count": 12,
    "activity_count": 5,
    "latest_turn_uuid": "9999..."
  },
  "trace_uuid": "..."
}
```

### Behavior

- `phase` 来自 agent-core status RPC
- `durable_truth` 来自 D1 `readSnapshot()`
- 当前不返回 `phase_status`

---

## `GET /sessions/{sessionUuid}/timeline`

### Success (200)
```json
{
  "ok": true,
  "action": "timeline",
  "session_uuid": "3333...",
  "events": [
    { "kind": "turn.begin", "turn_uuid": "9999..." },
    { "kind": "llm.delta", "content_type": "text", "content": "Hello", "is_final": false },
    { "kind": "tool.call.progress", "tool_name": "pwd", "chunk": "running", "is_final": false },
    { "kind": "tool.call.result", "tool_name": "pwd", "status": "ok", "output": "/workspace" }
  ],
  "trace_uuid": "..."
}
```

### Behavior

- 若 D1 history 中已有 `stream-event` rows，则**直接返回 D1 timeline**
- 仅当 D1 timeline 为空时，才 fallback 到 agent-core RPC `timeline`
- **当前没有 D1 + RPC merge/parity 合并逻辑**

---

## `GET /sessions/{sessionUuid}/history`

### Success (200)
```json
{
  "ok": true,
  "action": "history",
  "session_uuid": "3333...",
  "messages": [
    {
      "message_uuid": "bbbb...",
      "turn_uuid": "9999...",
      "trace_uuid": "aaaa...",
      "role": "user",
      "kind": "user.input.multipart",
      "body": {
        "parts": [
          { "kind": "text", "text": "Analyze this screenshot:" },
          { "kind": "artifact_ref", "artifact_uuid": "cccc...", "mime": "image/png", "summary": "screenshot.png" }
        ]
      },
      "created_at": "2026-04-29T00:00:00.000Z"
    }
  ],
  "trace_uuid": "..."
}
```

---

## `POST /sessions/{sessionUuid}/verify`

> 这是 preview / debug verification harness，不是业务对话接口。

### Request
```http
POST /sessions/{sessionUuid}/verify HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "check": "capability-call",
  "toolName": "pwd",
  "toolInput": {}
}
```

### Supported `check` Values

| check | 说明 |
|-------|------|
| `capability-call` | 验证 capability call |
| `capability-cancel` | 验证 capability cancel |
| `initial-context` | 验证 initial-context 接入 |
| `compact-posture` | 验证 compact posture |
| `filesystem-posture` | 验证 filesystem posture |

### Success (200)
```json
{
  "ok": true,
  "action": "verify",
  "check": "capability-call",
  "toolName": "pwd",
  "response": {
    "ok": true
  },
  "durable_truth": {
    "conversation_uuid": "4444...",
    "session_uuid": "3333...",
    "team_uuid": "2222...",
    "actor_user_uuid": "1111...",
    "trace_uuid": "aaaa...",
    "session_status": "active",
    "started_at": "2026-04-29T00:00:00.000Z",
    "ended_at": null,
    "last_phase": "turn_running",
    "last_event_seq": 12,
    "message_count": 12,
    "activity_count": 5,
    "latest_turn_uuid": "9999..."
  },
  "trace_uuid": "..."
}
```

### Important Note

如果 `check` 未知，当前 verify 路径通常仍返回 `200 ok:true action:"verify"`，但 payload 内会带：

```json
{
  "check": "unknown-value",
  "error": "unknown-verify-check",
  "supported": ["capability-call", "capability-cancel", "initial-context", "compact-posture", "filesystem-posture"]
}
```

---

## `GET /sessions/{sessionUuid}/files`

> **metadata-only**：当前不返 file bytes，只从 durable message history 扫描 `artifact_ref` parts。

### Success (200)
```json
{
  "ok": true,
  "action": "files",
  "session_uuid": "3333...",
  "files": [
    {
      "message_uuid": "bbbb...",
      "turn_uuid": "9999...",
      "message_kind": "user.input.multipart",
      "artifact_uuid": "aaaa...",
      "mime": "image/png",
      "summary": "screenshot.png",
      "created_at": "2026-04-29T00:00:00.000Z"
    }
  ]
}
```

---

## `POST /sessions/{sessionUuid}/resume`

### Request
```http
POST /sessions/{sessionUuid}/resume HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "last_seen_seq": 5
}
```

### Success (200)
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

- `replay_lost: true` 表示客户端的 `last_seen_seq` 大于服务端当前 `relay_cursor`，建议再用 `GET /timeline` 对账。

---

## Common Session Errors

| HTTP | error.code | 典型适用路由 | 说明 |
|------|-----------|-------------|------|
| 400 | `invalid-start-body` | `POST /start` | 缺 `text` / `initial_input` |
| 400 | `invalid-input-body` | `POST /input` | 缺 `text` |
| 400 | `invalid-input` | `POST /messages` 等 | multipart body 非法 |
| 401 | `invalid-auth` | 全部 | bearer token 无效 |
| 403 | `missing-team-claim` | 全部 | JWT 无 team truth |
| 404 | `session_missing` | 读路径 / follow-up 路径 | session 不存在 |
| 409 | `session-pending-only-start-allowed` | 非 `/start` 的 session 路径 | 该 UUID 仍是 pending |
| 409 | `session-expired` | `/start` 或 gate miss | pending UUID 已过期 |
| 409 | `session_terminal` | follow-up / WS attach | session 已终态 |
| 409 | `session-already-started` | `/start` | 重复 start / ended / 并发 claim 失败 |
| 502 | `agent-start-failed` | `/start` | agent-core start 返回失败 |
| 502 | `agent-rpc-throw` | `status/timeline/verify` 等 | agent-core RPC 调用抛错 |
| 503 | `agent-rpc-unavailable` | 依赖 agent-core 的路由 | AGENT_CORE binding / authority 缺失 |
| 503 | `worker-misconfigured` | 全部 | `TEAM_UUID` 未配置 |
