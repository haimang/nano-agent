# Usage API — RHX2 Phase 6 Snapshot

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

当该 session 还没有任何 `nano_usage_events` 行时，`usage` 会退回到 null placeholder：

```json
{
  "llm_input_tokens": null,
  "llm_output_tokens": null,
  "tool_calls": null,
  "subrequest_used": null,
  "subrequest_budget": null,
  "estimated_cost_usd": null
}
```

### Field Reference

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_uuid` | string | 会话 UUID |
| `status` | string | 当前 `SessionEntry.status`（starting / active / detached / ended） |
| `usage.llm_input_tokens` | number\|null | `nano_usage_events` 中 `resource_kind='llm'` + `unit='input_token'` 的聚合 |
| `usage.llm_output_tokens` | number\|null | `resource_kind='llm'` + `unit='output_token'` 的聚合 |
| `usage.tool_calls` | number\|null | allow verdict 的 tool rows 数量 |
| `usage.subrequest_used` | number\|null | allow verdict 的 `quantity` 总和 |
| `usage.subrequest_budget` | number\|null | `nano_quota_balances(quota_kind='llm').remaining` |
| `usage.estimated_cost_usd` | null | 当前固定为 `null` |
| `last_seen_at` | string (ISO) | User DO session entry 的最后触碰时间 |
| `durable_truth` | object\|null | D1 durable snapshot |

### Behavior

- endpoint 先构造 null placeholder usage
- 若有 D1 binding 且能读到 durable `team_uuid`，则直接查询 D1：
  - `nano_usage_events`
  - `nano_quota_balances`
- **当前没有独立的 KV hot usage snapshot merge 路径**
- D1 读取失败只会 `warn`，不会让请求失败；此时仍返回 placeholder usage + durable snapshot

### Current Reality

- **稳定部分**：`session_uuid`、`status`、`last_seen_at`、`durable_truth`
- **usage 是否有数值**：取决于该 session 是否已有 D1 usage rows
- **`estimated_cost_usd`**：当前恒为 `null`

---

## WS Live Push Status

`session.usage.update` server frame live push —— **当前未 live**。

唯一可用 usage 查询方式仍是 `GET /sessions/{id}/usage` HTTP polling。
