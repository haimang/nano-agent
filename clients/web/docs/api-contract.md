# nano-agent Web Client — API Contract

> **文档版本**: `web-v10`
> **更新日期**: `2026-04-28`
> **适用范围**: `clients/web`
> **权威契约基线**: `clients/api-docs/README.md` 及子文档

---

## 1. 文档定位

本文档是 Web 客户端对 `orchestrator-core` public facade 的**消费侧契约说明**，不是独立的 API 规范。

**权威契约来源**: `clients/api-docs/`
- `clients/api-docs/README.md` — 总览与已实现/未实现列表
- `clients/api-docs/auth.md` — 认证契约
- `clients/api-docs/me-sessions.md` — 用户会话契约
- `clients/api-docs/session.md` — 会话操作契约
- `clients/api-docs/session-ws-v1.md` — WebSocket 流契约
- `clients/api-docs/usage.md` — 用量契约
- `clients/api-docs/permissions.md` — 权限契约
- `clients/api-docs/catalog.md` — 目录契约
- `clients/api-docs/worker-health.md` — 健康检查契约

---

## 2. 传输层契约

### 2.1 HTTP 传输

| 属性 | 值 |
|------|-----|
| **主路径** | `/api/*`（通过 Cloudflare Pages Functions BFF 同域代理） |
| **上游直连** | 本地开发时可直连 upstream（fallback） |
| **默认上游** | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| **认证方式** | Bearer Token (`Authorization: Bearer <token>`) |
| **Trace 注入** | `x-trace-uuid` header（自动注入） |

### 2.2 WebSocket 传输

| 属性 | 值 |
|------|-----|
| **连接方式** | Direct connect（foundation 阶段受控例外） |
| **协议** | `wss://` |
| **路径** | `/sessions/{session_uuid}/ws` |
| **查询参数** | `access_token`, `trace_uuid`, `last_seen_seq` |
| **心跳间隔** | 15 秒 |
| **超时时间** | 45 秒 |

### 2.3 返回形状分类

Web 客户端需要处理三类返回形状：

#### 类型 A: 标准 Facade Success Envelope
```json
{
  "ok": true,
  "data": { ... },
  "trace_uuid": "uuid"
}
```

**适用端点**: `/auth/login`, `/auth/register`, `/me`, `/me/sessions`

#### 类型 B: Legacy Action Payload
```json
{
  "ok": true,
  "action": "session.start",
  "trace_uuid": "uuid",
  ...
}
```

**适用端点**: `/sessions/{id}/start`, `/sessions/{id}/input`, `/sessions/{id}/resume`

#### 类型 C: Debug JSON
```json
{
  "ok": true,
  "environment": "preview",
  "summary": { ... },
  "workers": [ ... ]
}
```

**适用端点**: `/debug/workers/health`

---

## 3. 认证契约

### 3.1 登录

```
POST /api/auth/login
Content-Type: application/json

Body:
{
  "email": "string",
  "password": "string"
}

Response (Type A envelope):
{
  "ok": true,
  "data": {
    "tokens": {
      "access_token": "string",
      "refresh_token": "string"
    },
    "team": { "team_uuid": "string" },
    "user": { "user_uuid": "string" }
  },
  "trace_uuid": "string"
}
```

### 3.2 注册

```
POST /api/auth/register
Content-Type: application/json

Body:
{
  "email": "string",
  "password": "string",
  "display_name": "string"
}

Response: 同 login（内部链式调用）
```

### 3.3 获取当前用户

```
GET /api/me
Authorization: Bearer <token>

Response (Type A envelope):
{
  "ok": true,
  "data": { ...user profile... },
  "trace_uuid": "string"
}
```

---

## 4. 会话契约

### 4.1 列出用户会话

```
GET /api/me/sessions
Authorization: Bearer <token>

Response (Type A envelope):
{
  "ok": true,
  "data": {
    "sessions": [
      {
        "conversation_uuid": "string",
        "session_uuid": "string",
        "status": "string",
        "last_phase": "string",
        "last_seen_at": "ISO string",
        "created_at": "ISO string",
        "ended_at": "ISO string | null"
      }
    ]
  },
  "trace_uuid": "string"
}
```

### 4.2 创建新会话

```
POST /api/me/sessions
Authorization: Bearer <token>
Content-Type: application/json

Body: {} (空对象)

Response (Type A envelope):
{
  "ok": true,
  "data": {
    "session_uuid": "string",
    "ttl_seconds": 86400
  },
  "trace_uuid": "string"
}
```

### 4.3 启动会话（首消息）

```
POST /api/sessions/{session_uuid}/start
Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "initial_input": "string"
}

Response (Type B action payload):
{
  "ok": true,
  "action": "session.start",
  "trace_uuid": "string"
}
```

### 4.4 发送后续消息

```
POST /api/sessions/{session_uuid}/input
Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "text": "string",
  "session_uuid": "string"
}

Response (Type B action payload)
```

### 4.5 获取时间线

```
GET /api/sessions/{session_uuid}/timeline
Authorization: Bearer <token>

Response (Type A envelope):
{
  "ok": true,
  "data": {
    "events": [
      {
        "kind": "string",
        "seq": number,
        "content": "string",
        "content_type": "string",
        "role": "string",
        ...
      }
    ]
  },
  "trace_uuid": "string"
}
```

### 4.6 恢复会话

```
POST /api/sessions/{session_uuid}/resume
Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "last_seen_seq": 0
}

Response (Type A/B envelope)
```

### 4.7 获取历史

```
GET /api/sessions/{session_uuid}/history
Authorization: Bearer <token>

Response (Type A envelope):
{
  "ok": true,
  "data": {
    "messages": [
      {
        "role": "string",
        "body": { "text": "string" },
        "kind": "string",
        "created_at": "ISO string"
      }
    ]
  },
  "trace_uuid": "string"
}
```

### 4.8 获取会话状态

```
GET /api/sessions/{session_uuid}/status
Authorization: Bearer <token>

Response (Type A envelope)
```

### 4.9 获取用量

```
GET /api/sessions/{session_uuid}/usage
Authorization: Bearer <token>

Response (Type A envelope)
```

**注意**: 用量数据是**时间点快照**，不是实时推送。

---

## 5. WebSocket 流契约

### 5.1 客户端发送帧

#### session.resume
```json
{
  "message_type": "session.resume",
  "body": {
    "last_seen_seq": 0
  }
}
```

#### session.heartbeat
```json
{
  "message_type": "session.heartbeat",
  "body": {
    "ts": 1714291200000
  }
}
```

#### session.stream.ack
```json
{
  "message_type": "session.stream.ack",
  "body": {
    "stream_uuid": "main",
    "acked_seq": 42
  }
}
```

### 5.2 服务端推送帧（当前已实现）

| 帧类型 | 说明 |
|--------|------|
| `event` | 主事件流（含 `llm.delta`, `llm.complete`, `session.update` 等） |
| `session.heartbeat` | 服务端心跳确认 |
| `attachment_superseded` | 连接被新附件替换 |
| `terminal` | 会话终止 |

### 5.3 服务端推送帧（当前未实现）

以下帧类型在 `session-ws-v1.md` 中定义，但当前 public WS 不会 live 发送：

- `session.permission.request`
- `session.usage.update`
- `session.elicitation.request`

---

## 6. 目录契约

### 6.1 获取目录

```
GET /api/catalog/{kind}
# kind: skills | commands | agents

Response (Type A envelope):
{
  "ok": true,
  "data": { ... },
  "trace_uuid": "string"
}
```

**注意**: 目录内容可能为空，取决于 orchestrator 是否加载了插件。

---

## 7. 调试契约

### 7.1 Worker 健康检查

```
GET /api/debug/workers/health

Response (Type C debug JSON):
{
  "ok": true,
  "environment": "preview",
  "generated_at": "ISO string",
  "summary": {
    "live": 5,
    "total": 6
  },
  "workers": [
    {
      "worker": "string",
      "live": true,
      "status": "string",
      "worker_version": "string | null",
      "error": "string?"
    }
  ]
}
```

**注意**: 这不是标准 facade envelope。

---

## 8. 错误契约

### 8.1 错误形状

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "status": 401,
    "message": "Human readable message",
    "details": { ... }
  },
  "trace_uuid": "string"
}
```

### 8.2 错误类型映射

| HTTP 状态 | 客户端错误类型 | 典型场景 |
|-----------|---------------|----------|
| 401 | `auth.expired` | Token 过期或无效 |
| 429 | `quota.exceeded` | 配额超限 |
| >= 500 | `runtime.error` | 上游运行时错误 |
| 其他 | `request.error` | 一般请求错误 |

---

## 9. 未实现端点清单

以下端点在 `clients/api-docs/README.md` 中列为**尚未实现**，Web 客户端不应将其作为硬依赖：

| 端点 | 状态 | Web 客户端处理 |
|------|------|----------------|
| `GET /me/conversations` | 未实现 | Sidebar 使用 `/me/sessions` 作为 canonical source |
| `POST /sessions/{id}/messages` | 未实现 | 聊天主链使用 `start`/`input` |
| `POST /me/devices/revoke` | 未实现 | Settings 页面仅展示说明 |
| `GET /sessions/{id}/files` | 未实现 | Inspector 中标记为 unavailable |

---

## 10. 版本与兼容性

| 维度 | 当前值 |
|------|--------|
| **Web Client Version** | `web-v10` |
| **NACP Version** | `1.1.0` |
| **NACP Compat Floor** | `1.0.0` |
| **WS Subprotocol** | `nacp-session-v1` |

---

## 11. 相关文档

- **公共契约基线**: `clients/api-docs/README.md`
- **本地运行**: `clients/web/docs/setup.md`
- **部署指南**: `clients/web/docs/deployment.md`
- **基石文档**: `clients/web/docs/charter/web-v10-foundations.md`
