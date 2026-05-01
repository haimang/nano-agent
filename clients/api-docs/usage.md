# Usage Snapshot

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/index.ts` (`/sessions/{id}/usage` route handler)，`nano_usage_events` + `nano_quota_balances` D1 表
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`
> Trace: `x-trace-uuid: <uuid>`

---

## 1. `GET /sessions/{sessionUuid}/usage`

### Request

```http
GET /sessions/{sessionUuid}/usage
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

### Field Reference

| 字段 | 类型 | 说明 |
|------|------|------|
| `session_uuid` | string | 会话 UUID |
| `status` | string | session lifecycle phase（`starting` / `active` / `detached` / `ended`） |
| `usage.llm_input_tokens` | number | `nano_usage_events` 中 `resource_kind='llm'` + `unit='input_token'` 聚合 |
| `usage.llm_output_tokens` | number | `resource_kind='llm'` + `unit='output_token'` 聚合 |
| `usage.tool_calls` | number | allow verdict 的 tool rows 数量 |
| `usage.subrequest_used` | number | allow verdict 的 `quantity` 总和 |
| `usage.subrequest_budget` | number\|null | `nano_quota_balances(quota_kind='llm').remaining` |
| `usage.estimated_cost_usd` | number\|null | live 路径当前通常为 `null`；预留字段 |
| `last_seen_at` | string (ISO) | User DO session entry 最后触碰时间 |
| `durable_truth` | object\|null | D1 durable snapshot |

### Zero Placeholder

session 尚未产生 `nano_usage_events` 时，`usage` 会回退为：

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

### Behavior

1. endpoint 先构造 zero placeholder。
2. 通过 D1 binding 读 `nano_usage_events` + `nano_quota_balances` 聚合。
3. 若 D1 读取失败，**直接返回 `503 usage-d1-unavailable`**，不回退到 `200 + placeholder`（避免假阳性零值）。
4. 当前**没有** KV hot usage snapshot merge 路径。

### Errors

| HTTP | error.code | 说明 |
|------|------------|------|
| 401 | `invalid-auth` | bearer 无效 / 过期 / 被撤销 |
| 403 | `missing-team-claim` | auth snapshot 缺 team/tenant truth |
| 404 | `session_missing` | session 不存在 |
| 409 | `session-pending-only-start-allowed` / `session-expired` | pending session 只能先 `/start`，或 pending UUID 已过期 |
| 503 | `usage-d1-unavailable` | usage ledger / quota 读取失败 |

---

## 2. WebSocket Live Push 状态

`session.usage.update` server→client 帧已注册（详见 [`session-ws-v1.md`](./session-ws-v1.md) Stream Events 表）。客户端附着 WS 后会在 LLM / tool quota commit 后被动收到 `usage` 增量帧，**不需要轮询**。

**polling fallback**：
- 若客户端不订阅 WS（或 WS 已断开），`GET /sessions/{id}/usage` 仍是合规且 idempotent 的 HTTP polling 入口。
- 推荐 polling 间隔 ≥ 5 秒，且仅在 session phase ∈ `{active, attached}` 时轮询；`ended` / `expired` 后 usage 是终态快照。

---

## 3. Implementation Notes

- usage 路由对 `pending` session 直接返回 `409 session-pending-only-start-allowed`（提示先 `/start`）。
- `expired` session 返回 `409 session-expired`（pending UUID 过期）。
- `ended` session 返回最终态 usage 快照，不再变化。
- `subrequest_budget = null` 表示 team 没有为该 quota kind 配 limit，应视为"无上限"。
- `estimated_cost_usd` 当前不计算；预留字段，hero-to-platform 阶段决定 pricing 模型。

详细 error code 见 [`error-index.md`](./error-index.md)。
