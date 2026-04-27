# Usage API

> Profile: `facade-http-v1` + `session-ws-v1`
> 状态: ZX2 Phase 5 P5-01 / P5-03 — snapshot read + live push
> 生成: 2026-04-27

每个 session 的 token / capability / subrequest budget 通过两条互补路径暴露给前端：HTTP snapshot (`GET /sessions/{id}/usage`) 和 WS push (`session.usage.update`)。

## 1. HTTP — `GET /sessions/{sessionUuid}/usage`

### Request

```http
GET /sessions/{sessionUuid}/usage
authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

### Response（success）

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "status": "active",
    "usage": {
      "llm_input_tokens": 1500,
      "llm_output_tokens": 800,
      "tool_calls": 3,
      "subrequest_used": 2,
      "subrequest_budget": 50,
      "estimated_cost_usd": null
    },
    "last_seen_at": "2026-04-27T08:00:00.000Z",
    "durable_truth": { ... }
  },
  "trace_uuid": "..."
}
```

> ZX2 v1 的 `usage` 字段大多为 `null`；live 数字来自 WS push（§2）。HTTP 端点是为新打开页面 / 刷新场景准备的稳定入口。

### Response（失败）

| HTTP | error.code |
|---|---|
| 401 | `invalid-auth` |
| 404 | `not-found` (session 不存在) |
| 410 | `session-already-ended` (session 已结束 + GC) |

## 2. WS — server push `session.usage.update`

服务端在 turn 期间高频推送（≥1Hz auto-merge backpressure，参见 [`session-ws-v1.md`](./session-ws-v1.md) §3.7）：

```json
{
  "kind": "session.usage.update",
  "llm_input_tokens": 1500,
  "llm_output_tokens": 800,
  "tool_calls": 3,
  "subrequest_used": 2,
  "subrequest_budget": 50,
  "estimated_cost_usd": 0.012
}
```

字段全部 cumulative since session start。客户端可以直接覆盖本地状态（不需要 diff）。

## 3. 字段语义

| 字段 | 含义 |
|---|---|
| `llm_input_tokens` | LLM 入参 token，cumulative |
| `llm_output_tokens` | LLM 出参 token，cumulative |
| `llm_cache_read_tokens` | prompt cache read，cumulative |
| `llm_cache_write_tokens` | prompt cache write，cumulative |
| `tool_calls` | 已 finalized（成功+失败）的 tool call 总数 |
| `subrequest_used` | Cloudflare subrequest 已用数 |
| `subrequest_budget` | Cloudflare subrequest 总预算 |
| `estimated_cost_usd` | 服务端基于 model price 估算（可能为 null） |

## 4. 推荐前端模式

- 进入 session 页面：HTTP `GET /sessions/{id}/usage` 拉一次，渲染初始值。
- WS 连上后：订阅 `session.usage.update`，覆盖本地状态。
- 用户离开页面 / WS 断：保留最后一次值，下次回来重新 HTTP 拉。
