# Permissions API — ZX5 Snapshot

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`
> Tenant guard: 需要 `TEAM_UUID` env + JWT 含 `team_uuid` / `tenant_uuid`

---

## Route Overview

| Route | Method | Auth | 说明 |
|-------|--------|------|------|
| `/sessions/{id}/permission/decision` | `POST` | bearer | 提交 permission 决定 |
| `/sessions/{id}/policy/permission_mode` | `POST` | bearer | 设置 permission 模式 |
| `/sessions/{id}/elicitation/answer` | `POST` | bearer | 提交 elicitation 回答 |

> ⚠️ **WS round-trip 未 live**：`session.permission.request` / `session.elicitation.request` 当前不会通过 public WS 下发。HTTP 路径是当前唯一 live 的 client API。

---

## Important Current Reality

1. 这三条路由当前都会把 `sessionUuid` 当作**作用域 key** 使用。
2. **它们当前不会校验 session 是否真实存在、是否 active、是否 terminal。**
3. `permission/decision` 与 `elicitation/answer` 会先写 User DO KV，再 best-effort forward 到 agent-core RPC。
4. runtime kernel 当前**不会等待**这些 decision / answer；wait-and-resume 基础设施在 DO 内部已存在，但 public runtime 尚未接上。

---

## `POST /sessions/{sessionUuid}/permission/decision`

### Request
```http
POST /sessions/{sessionUuid}/permission/decision HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "request_uuid": "aaaa...",
  "decision": "allow",
  "scope": "once",
  "reason": "user approved"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `request_uuid` | ✅ | string (UUID) | permission request UUID |
| `decision` | ✅ | `"allow"` \| `"deny"` \| `"always_allow"` \| `"always_deny"` | 决定 |
| `scope` | no | string | 默认 `"once"` |
| `reason` | no | string | 用户原因；当前仅透传，不参与判定 |

### Success (200)
```json
{
  "ok": true,
  "data": {
    "request_uuid": "aaaa...",
    "decision": "allow",
    "scope": "once"
  },
  "trace_uuid": "..."
}
```

### Behavior
1. 写 User DO KV: `permission_decision/{request_uuid}`
2. Best-effort forward 到 agent-core `permissionDecision` RPC
3. RPC 失败不影响用户面 200 ack
4. 当前 runtime 不会等待该 decision

### Errors
| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-input` | `request_uuid` 缺失/非 UUID，或 `decision` 非法 |
| 401 | `invalid-auth` | bearer token 无效 |
| 403 | `missing-team-claim` | JWT 无 team truth |
| 503 | `worker-misconfigured` | `TEAM_UUID` 未配置 |

---

## `POST /sessions/{sessionUuid}/policy/permission_mode`

### Request
```http
POST /sessions/{sessionUuid}/policy/permission_mode HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "mode": "ask"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `mode` | ✅ | `"auto-allow"` \| `"ask"` \| `"deny"` \| `"always_allow"` | 当前支持的 mode |

### Success (200)
```json
{
  "ok": true,
  "data": {
    "session_uuid": "3333...",
    "mode": "ask"
  },
  "trace_uuid": "..."
}
```

### Behavior
- 写 User DO KV: `permission_mode/{sessionUuid}`
- 当前不参与 runtime enforcement
- 当前不校验 session 是否存在

### Errors
| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-input` | mode 非法 |
| 401 | `invalid-auth` | bearer token 无效 |
| 403 | `missing-team-claim` | JWT 无 team truth |
| 503 | `worker-misconfigured` | `TEAM_UUID` 未配置 |

---

## `POST /sessions/{sessionUuid}/elicitation/answer`

### Request
```http
POST /sessions/{sessionUuid}/elicitation/answer HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "request_uuid": "bbbb...",
  "answer": "use pandas"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `request_uuid` | ✅ | string (UUID) | elicitation request UUID |
| `answer` | ✅ | any | 回答内容 |

### Success (200)
```json
{
  "ok": true,
  "data": {
    "request_uuid": "bbbb...",
    "answer": "use pandas"
  },
  "trace_uuid": "..."
}
```

### Behavior
1. 写 User DO KV: `elicitation_answer/{request_uuid}`
2. Best-effort forward 到 agent-core `elicitationAnswer` RPC
3. RPC 失败不影响用户面 200 ack
4. 当前 runtime 不会等待该 answer

### Errors
| HTTP | error.code | 触发 |
|------|-----------|------|
| 400 | `invalid-input` | `request_uuid` 缺失/非 UUID，或 `answer` 缺失 |
| 401 | `invalid-auth` | bearer token 无效 |
| 403 | `missing-team-claim` | JWT 无 team truth |
| 503 | `worker-misconfigured` | `TEAM_UUID` 未配置 |

---

## WS Round-Trip Status

| 方向 | 能力 | 状态 |
|------|------|------|
| Server→Client | `session.permission.request` | **未 live** |
| Client→Server | `session.permission.decision` | **未支持**（HTTP 替代） |
| Server→Client | `session.elicitation.request` | **未 live** |
| Client→Server | `session.elicitation.answer` | **未支持**（HTTP 替代） |

当前 ZX5 阶段，HTTP 路径是唯一可用的 permission / elicitation API。
