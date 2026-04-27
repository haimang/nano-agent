# Permissions API

> Profile: `facade-http-v1` + `session-ws-v1`
> 状态: ZX2 Phase 5 P5-01 / P5-03 — server-mint round-trip + HTTP mirror endpoint
> 生成: 2026-04-27

`orchestrator-core` 提供两条对前端开放的 permission 控制路径：HTTP 镜像（`POST /sessions/{id}/permission/decision` / `POST /sessions/{id}/policy/permission_mode`）与 WS round-trip（`session.permission.request` / `session.permission.decision`）。两者协作以适应不同客户端能力（小程序更偏 HTTP，web/桌面更偏 WS）。

## 1. HTTP — `POST /sessions/{sessionUuid}/permission/decision`

### Request

```http
POST /sessions/{sessionUuid}/permission/decision
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: <uuid>

{
  "request_uuid": "<uuid 来自 session.permission.request frame>",
  "decision": "allow" | "deny" | "always_allow" | "always_deny",
  "scope": "once" | "session" | "user",
  "reason": "optional, ≤2048 chars"
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "request_uuid": "...",
    "decision": "allow",
    "scope": "once"
  },
  "trace_uuid": "..."
}
```

错误（facade-http-v1）：

| HTTP | error.code | 触发 |
|---|---|---|
| 400 | `invalid-input` | request_uuid 不是 UUID 或 decision 非法 |
| 401 | `invalid-auth` | 缺 / 错 access_token |
| 404 | `not-found` | session 不存在 |

## 2. HTTP — `POST /sessions/{sessionUuid}/policy/permission_mode`

设置 session 默认 permission 模式（不带 round-trip 时的默认行为）。

### Request

```http
POST /sessions/{sessionUuid}/policy/permission_mode
authorization: Bearer <access_token>
content-type: application/json
x-trace-uuid: <uuid>

{
  "mode": "auto-allow" | "ask" | "deny" | "always_allow"
}
```

### Response

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "mode": "ask"
  },
  "trace_uuid": "..."
}
```

`ask` 是默认值；当 server 触发 permission round-trip 但客户端没有及时回复时，回退到此 mode 的 default decision（`auto-allow → allow`，`deny → deny`，`always_allow → allow` 持续）。

## 3. WS — round-trip 闭环（推荐路径）

```
server → client: session.permission.request    {request_uuid, tool_name, tool_input, expires_at?, suggested_decision?}
client → server: session.permission.decision   {request_uuid, decision, scope, reason?}
```

完整的 WS frame 形态见 [`session-ws-v1.md`](./session-ws-v1.md) §3.6 / §4。

- 默认 round-trip 超时 30 秒。
- 超时时服务端按 `policy/permission_mode` 决定 default fallback。
- 服务端发送 `session.permission.request` 后，**立刻** 等同时也接受 HTTP `permission/decision`（mirror 路径），所以客户端可以选用任一 wire。

## 4. 客户端推荐策略

```typescript
// pseudo
ws.on("message", async (frame) => {
  if (frame.kind === "session.permission.request") {
    const decision = await ui.askUser(frame); // 30s timeout
    ws.send({ message_type: "session.permission.decision", body: { request_uuid: frame.request_uuid, decision } });
  }
});
```

如果 ws 已断开，可改用：

```typescript
await fetch(`/sessions/${sessionUuid}/permission/decision`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "x-trace-uuid": trace, "content-type": "application/json" },
  body: JSON.stringify({ request_uuid, decision, scope: "once" }),
});
```

## 5. 错误处理

- **客户端不应在收到 `session.permission.request` 后忽略不答**——即便没有 UI 弹窗，也应至少发 `decision: "deny"` 让 server 释放 turn。
- 一个 `request_uuid` 只能 decided 一次；重复 decision 返回 `ok:true` 但 server 只读首次。
- `policy/permission_mode = always_allow` 时，server 会跳过 `session.permission.request`，**不**发 frame；客户端不能依赖每次都收到 frame。
