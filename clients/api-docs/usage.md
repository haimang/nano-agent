# Usage API

> Public facade owner: `orchestrator-core`
> Profiles: `facade-http-v1` + reserved future `session-ws-v1` shapes

## Base URLs

| 环境 | Base URL |
|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` |

## Current live route

| Route | Method | Auth |
|---|---|---|
| `/sessions/{sessionUuid}/usage` | `GET` | bearer |

## `GET /sessions/{sessionUuid}/usage`

### Request

```http
GET /sessions/11111111-1111-4111-8111-111111111111/usage
authorization: Bearer <access_token>
x-trace-uuid: 33333333-3333-4333-8333-333333333333
```

### Success

```json
{
  "ok": true,
  "data": {
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "status": "active",
    "usage": {
      "llm_input_tokens": null,
      "llm_output_tokens": null,
      "tool_calls": null,
      "subrequest_used": null,
      "subrequest_budget": null,
      "estimated_cost_usd": null
    },
    "last_seen_at": "2026-04-27T08:00:00.000Z",
    "durable_truth": {
      "conversation_uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "session_uuid": "11111111-1111-4111-8111-111111111111",
      "session_status": "active",
      "last_phase": "turn_running",
      "last_event_seq": 4,
      "message_count": 2,
      "activity_count": 5
    }
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Current reality

这条接口现在是**稳定的 snapshot path**，但 usage 数值本身仍是 placeholder：

- `llm_input_tokens`: `null`
- `llm_output_tokens`: `null`
- `tool_calls`: `null`
- `subrequest_used`: `null`
- `subrequest_budget`: `null`
- `estimated_cost_usd`: `null`

因此客户端当前应把它理解成：

1. session 是否存在、当前状态如何
2. 可选 `durable_truth` 快照
3. 为未来真实 usage 数值预留稳定字段位置

而不是一个已经有真实预算数字的产品 API。

### Errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 401 | `invalid-auth` | bearer 缺失或无效 |
| 404 | `session_missing` | session 不存在或不可读 |

## WS live push status

`@haimang/nacp-session` 已定义未来 `session.usage.update` body，但**当前 public WS 不会 live 发 usage update frame**。  
因此：

- 当前前端若显示 usage，只能靠 `GET /sessions/{uuid}/usage`
- 不要假设当前连接中的 WS 会持续推送 usage 数值
