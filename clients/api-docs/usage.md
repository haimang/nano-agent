# Usage API — Current Snapshot

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`
> Header: `x-trace-uuid: <uuid>`
> Current source: User DO session entry + optional D1 usage tables.

---

## `GET /sessions/{sessionUuid}/usage`

### Request
```http
GET /sessions/{sessionUuid}/usage HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

### Success (200)
```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "status": "active",
    "usage": {
      "llm_input_tokens": 1280,
      "llm_output_tokens": 342,
      "tool_calls": 2,
      "subrequest_used": 1624,
      "subrequest_budget": 80000,
      "estimated_cost_usd": null
    },
    "last_seen_at": "2026-04-29T00:05:00.000Z",
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
    }
  },
  "trace_uuid": "..."
}
```

### Placeholder Shape

当该 session 还没有任何 `nano_usage_events` 行时，`usage` 会退回到 zero placeholder：

```json
{
  "llm_input_tokens": 0,
  "llm_output_tokens": 0,
  "tool_calls": 0,
  "subrequest_used": 0,
  "subrequest_budget": 0,
  "estimated_cost_usd": 0
}
```

### Field Reference

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_uuid` | string | 会话 UUID |
| `status` | string | 当前 `SessionEntry.status`（starting / active / detached / ended） |
| `usage.llm_input_tokens` | number | `nano_usage_events` 中 `resource_kind='llm'` + `unit='input_token'` 的聚合；无行时回退为 `0` |
| `usage.llm_output_tokens` | number | `resource_kind='llm'` + `unit='output_token'` 的聚合；无行时回退为 `0` |
| `usage.tool_calls` | number | allow verdict 的 tool rows 数量；无行时回退为 `0` |
| `usage.subrequest_used` | number | allow verdict 的 `quantity` 总和；无行时回退为 `0` |
| `usage.subrequest_budget` | number\|null | `nano_quota_balances(quota_kind='llm').remaining` |
| `usage.estimated_cost_usd` | number\|null | placeholder 为 `0`；live D1 聚合当前多为 `null` 或具体数值 |
| `last_seen_at` | string (ISO) | User DO session entry 的最后触碰时间 |
| `durable_truth` | object\|null | D1 durable snapshot |

### Behavior

- endpoint 先构造 zero placeholder usage
- 若有 D1 binding 且能读到 durable `team_uuid`，则直接查询 D1：
  - `nano_usage_events`
  - `nano_quota_balances`
- **当前没有独立的 KV hot usage snapshot merge 路径**
- 若 D1 读取失败，路由直接返回 `503 usage-d1-unavailable`，而不是回退到 `200 + placeholder`

### Error

| HTTP | error.code | 说明 |
|------|------------|------|
| `401` | `invalid-auth` | bearer token 无效 / 过期 / 被撤销 |
| `403` | `missing-team-claim` | auth snapshot 缺 team/tenant truth |
| `404` | `session_missing` | session 不存在 |
| `409` | `session-pending-only-start-allowed` / `session-expired` | pending session 只能先 `/start`，或 pending UUID 已过期 |
| `503` | `usage-d1-unavailable` | usage ledger / quota 读取失败 |

### Current Reality

- **稳定部分**：`session_uuid`、`status`、`last_seen_at`、`durable_truth`
- **usage 是否有数值**：取决于该 session 是否已有 D1 usage rows
- **`estimated_cost_usd`**：placeholder 为 `0`；live 路径当前通常为 `null` 或具体数值

---

## WS Live Push Status

`session.usage.update` server frame live push —— **当前未 live**。

唯一可用 usage 查询方式仍是 `GET /sessions/{id}/usage` HTTP polling。
