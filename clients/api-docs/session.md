# Session HTTP Lifecycle

> Public facade owner: `orchestrator-core` (HTTP routes) → `agent-core` (DO runtime)
> Implementation reference: `workers/orchestrator-core/src/facade/routes/session-bridge.ts:14-46` (SessionAction enum + parseSessionRoute), `workers/orchestrator-core/src/user-do/session-flow/`, `workers/agent-core/src/host/do/session-do/`
> Auth: `Authorization: Bearer <access_token>`
> Trace: `x-trace-uuid: <uuid>` 必须发送
> Device headers (可选): `x-device-uuid` / `x-device-label` / `x-device-kind`
>
> 本文件覆盖 session **生命周期与 transport** 主线（start / input / cancel / close / delete / title / messages / status / timeline / history / verify / resume / retry / fork / usage / conversation detail）。
> Models 路由迁出到 [`models.md`](./models.md)。
> Context 路由迁出到 [`context.md`](./context.md)。
> Files / Workspace 路由迁出到 [`workspace.md`](./workspace.md)。
> Checkpoints 路由迁出到 [`checkpoints.md`](./checkpoints.md)。
> Todos 路由迁出到 [`todos.md`](./todos.md)。
> Confirmations 路由迁出到 [`confirmations.md`](./confirmations.md)。

## 1. Session Lifecycle Overview

| 阶段 | 持久态 | Transport |
|------|--------|-----------|
| `pending` | session UUID 已被 server-mint，未启动 | server-mint via `POST /me/sessions` |
| `starting` | `start` 已收到，正在分配 DO | `POST /sessions/{id}/start` |
| `active` | DO 运行中，可接 input / messages | `POST .../input` / `POST .../messages` |
| `attached` | client WS 已附着 | `GET .../ws` |
| `detached` | client WS 断开但 DO 仍存活 | — |
| `ended` | 终态：正常 close / cancel / completed / error | 见 `ended_reason` |
| `expired` | DO 长期不活跃后被 alarm 回收 | 自动 |

`ended_reason` 取值（HP4 frozen）：`closed_by_user / completed / cancelled / error`。
Q13 / Q14 冻结：`close` 写 `ended_reason=closed_by_user`；`DELETE` 只写 `nano_conversations.deleted_at` 软删 parent conversation，不引入新 status。

## 2. Route Matrix

| Method | Path | Shape | 说明 |
|--------|------|-------|------|
| `POST` | `/sessions/{id}/start` | legacy | 启动 session（首次） |
| `POST` | `/sessions/{id}/input` | legacy | text-only 输入 |
| `POST` | `/sessions/{id}/messages` | legacy | multipart 输入（text / image / artifact_ref） |
| `POST` | `/sessions/{id}/cancel` | legacy | 取消当前 turn |
| `POST` | `/sessions/{id}/close` | legacy | 正常关闭，写 `ended_reason=closed_by_user` |
| `DELETE` | `/sessions/{id}` | legacy | 软删除 parent conversation（tombstone） |
| `PATCH` | `/sessions/{id}/title` | legacy | 修改 parent conversation `title` |
| `GET` | `/sessions/{id}/status` | legacy | runtime + durable status |
| `GET` | `/sessions/{id}/timeline` | legacy | stream event timeline |
| `GET` | `/sessions/{id}/history` | legacy | durable message history |
| `POST` | `/sessions/{id}/verify` | legacy | preview verification harness |
| `POST` | `/sessions/{id}/resume` | facade | HTTP replay ack |
| `POST` | `/sessions/{id}/retry` | legacy | HP4 absorbed first-wave retry ack |
| `POST` | `/sessions/{id}/fork` | legacy | HP7 absorbed first-wave fork ack |
| `GET` | `/sessions/{id}/usage` | facade | usage snapshot |
| `GET` | `/conversations/{conversation_uuid}` | facade | conversation detail read model (HP4) |

## 3. Transport Shape Guidance

`legacy-do-action` envelope（DO action 路由）：

```json
{
  "ok": true,
  "action": "input",
  "session_uuid": "..."
}
```

其中 `ok / action / session_uuid` 是稳定公共字段；`status` / `session_status` / `first_event_seq` / `terminal` / `ended_reason` 等字段按具体 action 追加。

`facade-http-v1` envelope（其他 HTTP 路由）：

```json
{
  "ok": true,
  "data": { "...": "..." },
  "trace_uuid": "..."
}
```

错误统一为：

```json
{
  "ok": false,
  "error": { "code": "...", "status": 4xx, "message": "...", "details": {} },
  "trace_uuid": "..."
}
```

详见 [`transport-profiles.md`](./transport-profiles.md) 与 [`error-index.md`](./error-index.md)。

## 4. POST `/sessions/{id}/start`

Request:

```json
{
  "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
  "reasoning": { "effort": "medium" },
  "system_prompt_overrides": null,
  "device_uuid": "..."
}
```

`model_id` 与 `reasoning` 都可省略；省略时 fallback 链为 `turn override → session default → global default`（详见 [`models.md`](./models.md)）。

Success: `{ ok: true, action: "start", session_uuid, status: "active", relay_cursor, first_event?, first_event_seq, terminal: null, start_ack }`。

`first_event_seq` 是 HPX5 F7 新增字段：客户端可将其作为后续 WS attach 的 `last_seen_seq` 兜底值，消除 start→ws-attach race window。

Error highlights:

| HTTP | code | 说明 |
|------|------|------|
| 401 | `unauthenticated` | bearer 无效 |
| 403 | `model-policy-blocked` | team 无权用该 model |
| 404 | `not-found` | UUID 未在 `nano_conversation_sessions` |
| 409 | `session-already-started` | session 已 active/ended/expired |

## 5. POST `/sessions/{id}/input`

Request:

```json
{ "text": "hello", "model_id": "...", "reasoning": { "effort": "high" } }
```

`text` 必填。`model_id` / `reasoning` 可选；如填则覆盖 session default 形成 turn override（HP2）。

## 6. POST `/sessions/{id}/messages`

Multipart message。Request body 是 `parts` 数组：

```json
{
  "parts": [
    { "kind": "text", "text": "describe this" },
    { "kind": "image", "url": "https://..." },
    { "kind": "artifact_ref", "artifact_uuid": "...", "summary": "screenshot.png" }
  ],
  "message_kind": "user",
  "model_id": "...",
  "reasoning": { "effort": "medium" },
  "context_ref": { "compact_boundary_uuid": "..." }
}
```

`parts` 至少 1 项。`artifact_ref` 必须先经过 `POST /sessions/{id}/files` 上传。
`context_ref.compact_boundary_uuid` 可选；若设置，会把 prompt assembly 锚定到指定 compact boundary（HP3）。

## 7. POST `/sessions/{id}/cancel`

`{}` 即可。Cancel 当前 turn；幂等。

## 8. POST `/sessions/{id}/close`（HP4 frozen）

Request: `{}`。只写 `nano_conversation_sessions.ended_reason = closed_by_user` + `ended_at = now`。
不引入新 status。Success: `{ ok: true, action: "close", session_uuid, session_status: "ended", trace_uuid }`。
冻结依据：HPX-Q13。

## 9. DELETE `/sessions/{id}`（HP4 frozen）

无 body。语义为**软删除 parent conversation**（tombstone）：写 `nano_conversations.deleted_at = now`。
不引入 `closed` / `deleted_by_user_uuid` / undelete（HPX-Q14）。删除后该 conversation 在 `/me/conversations` 默认列表中隐藏。

## 10. PATCH `/sessions/{id}/title`（HP4 frozen）

Request: `{ "title": "string ≤ 200 chars" }`。
只写 `nano_conversations.title`。空字符串会清回 default。

## 11. GET `/sessions/{id}/status`

返回 runtime + durable 合并视图：

```json
{
  "ok": true,
  "action": "status",
  "session_uuid": "...",
  "session_status": "active",
  "phase": "active",
  "ended_reason": null,
  "ended_at": null,
  "default_model_id": "...",
  "trace_uuid": "..."
}
```

## 12. GET `/sessions/{id}/timeline`

Query: `?limit=` `?cursor=`。返回 stream event 时间线（与 WebSocket 相同的 frame 集合，但走 HTTP 拉取）。

## 13. GET `/sessions/{id}/history`

Query: `?limit=` `?cursor=`。返回 durable message history。HP4 实现 cursor 化，直接从 D1 读取。

## 14. POST `/sessions/{id}/verify`

Preview-only 校验路由。生产环境通常不暴露给最终用户。

## 15. POST `/sessions/{id}/resume`

HTTP replay ack。客户端在重连后告知 server-side 自己已处理到的最后 `stream_seq`，server 回放遗漏帧。
WebSocket 上的等价机制是 `session.resume` frame（详见 [`session-ws-v1.md`](./session-ws-v1.md)）。

## 16. GET `/conversations/{conversation_uuid}`

HP4 conversation detail read model，返回 conversation level 聚合（含 child sessions、首条 message preview、tombstoned 状态等）：

```json
{
  "ok": true,
  "data": {
    "conversation_uuid": "...",
    "title": "...",
    "deleted_at": null,
    "created_at": "...",
    "sessions": [
      { "session_uuid": "...", "session_status": "ended", "ended_reason": "closed_by_user" }
    ]
  },
  "trace_uuid": "..."
}
```

## 17. POST `/sessions/{id}/retry`

HPX6 后 retry 进入 executor dispatch path。成功时返回 `202`：

```json
{
  "ok": true,
  "action": "retry",
  "session_uuid": "...",
  "session_status": "active",
  "retry_kind": "queue-enqueued",
  "job_uuid": "...",
  "executor_status": "enqueued",
  "dispatch_path": "queue",
  "requested_attempt_seed": null
}
```

`dispatch_path` 在 queue binding 存在时为 `queue`；本地/测试环境无 Queue binding 时可为 `inline`，此时 `executor_status` 为 `completed`。

## 18. POST `/sessions/{id}/fork`

HPX6 后 fork 进入 executor dispatch path。成功时返回 `202`：

```json
{
  "ok": true,
  "action": "fork",
  "parent_session_uuid": "...",
  "child_session_uuid": "...",
  "from_checkpoint_uuid": null,
  "label": null,
  "job_uuid": "...",
  "fork_status": "executor-enqueued",
  "dispatch_path": "queue"
}
```

`child_session_uuid` 在响应时已 mint；客户端应继续监听 `session.fork.created` 或刷新 session/conversation 视图。

## 19. GET `/sessions/{id}/usage`

返回 usage snapshot；详见 [`usage.md`](./usage.md)。

## 20. Lifecycle State Machine

```text
pending ──start──▶ starting ──ack──▶ active ◀──ws──▶ attached
                                       │     ──close──▶ ended (closed_by_user)
                                       │     ──cancel──▶ ended (cancelled)
                                       │     ──error──▶ ended (error)
                                       │     ──turn done──▶ ended (completed)
                                       └──alarm sweep──▶ expired
```

`detached` 是从 `attached` 断开 WS 的瞬态；DO 仍可继续运行直到 `ended` / `expired`。

## 21. Error Code 速查

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-request` / `schema-mismatch` | request body 不匹配 |
| 401 | `unauthenticated` | bearer 无效 |
| 403 | `forbidden` / `device-revoked` / `model-policy-blocked` | 鉴权链或 policy 拒绝 |
| 404 | `not-found` | UUID 不存在 |
| 409 | `session-already-started` / `session-already-ended` | 状态冲突 |
| 503 | `internal-error` | upstream worker 不可达 |

完整错误码映射详见 [`error-index.md`](./error-index.md)。
