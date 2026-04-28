# Permissions API

> Public facade owner: `orchestrator-core`
> Profiles: `facade-http-v1` + reserved future `session-ws-v1` shapes

## Base URLs

| 环境 | Base URL |
|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` |

## Current live routes

| Route | Method | Auth | 当前事实 |
|---|---|---|---|
| `/sessions/{sessionUuid}/permission/decision` | `POST` | bearer | 已实现；把 decision 记到 User DO hot state |
| `/sessions/{sessionUuid}/policy/permission_mode` | `POST` | bearer | 已实现；把 mode 记到 User DO hot state |

## `POST /sessions/{sessionUuid}/permission/decision`

### Request

```http
POST /sessions/11111111-1111-4111-8111-111111111111/permission/decision
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 33333333-3333-4333-8333-333333333333

{
  "request_uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "decision": "allow",
  "scope": "once",
  "reason": "user approved"
}
```

### Success

```json
{
  "ok": true,
  "data": {
    "request_uuid": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "decision": "allow",
    "scope": "once"
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Current reality

这条接口当前会把 decision 写入 User DO hot state：

- key: `permission_decision/{request_uuid}`
- value: `{ session_uuid, request_uuid, decision, scope, decided_at }`

但它**还不会**把 decision 回流给正在运行中的 turn resolver。  
也就是说：**HTTP decision path 当前是“记录能力已落地，runtime unblock 尚未落地”。**

### Errors

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-input` | `request_uuid` 非 UUID，或 `decision` 不合法 |
| 401 | `invalid-auth` | bearer 缺失或无效 |

> 当前实现**不会**校验 `sessionUuid` 是否真的存在；path param 目前更像命名空间而不是强一致校验点。

## `POST /sessions/{sessionUuid}/policy/permission_mode`

### Request

```http
POST /sessions/11111111-1111-4111-8111-111111111111/policy/permission_mode
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: 33333333-3333-4333-8333-333333333333

{
  "mode": "ask"
}
```

### Success

```json
{
  "ok": true,
  "data": {
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "mode": "ask"
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### Supported modes

- `auto-allow`
- `ask`
- `deny`
- `always_allow`

### Current reality

当前 mode 也只是写入 User DO hot state：

- key: `permission_mode/{sessionUuid}`
- value: `{ session_uuid, mode, set_at }`

它还**没有**成为 agent runtime 的完整强制执行入口。

## WS round-trip status

`@haimang/nacp-session` 已经定义了未来的 WS shape：

```text
server -> client: session.permission.request
client -> server: session.permission.decision
```

但**当前 public WS 并不会 live 发出 `session.permission.request`**，也**不会真正消费**客户端通过 WS 发回的 `session.permission.decision`。  
因此当前前端如果要写 permission UI，应把 HTTP 路径视为**唯一 live API**。
