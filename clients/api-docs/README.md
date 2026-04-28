# nano-agent client API docs

`clients/api-docs/` 只描述**客户端真实可访问**的 public facade。当前唯一 public base 是 `orchestrator-core`；`orchestrator-auth`、`agent-core`、`bash-core`、`context-core`、`filesystem-core` 都不是客户端直连面。

## Base URLs

| 环境 | HTTP base URL | WS base URL |
|---|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` | `wss://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` | `wss://nano-agent-orchestrator-core.haimang.workers.dev` |

## Transport profiles

| Profile | 路径范围 | 当前事实 |
|---|---|---|
| `facade-http-v1` | `/auth/*` `/me` `/me/sessions` `/catalog/*` `/sessions/{uuid}/*` | active |
| `session-ws-v1` | `/sessions/{uuid}/ws` | active，**当前 wire 仍是 lightweight `{kind,...}`** |
| `health-probe` | `/` `/health` | active，主要给 deploy/probe |
| `debug-health` | `/debug/workers/health` | active，debug 聚合接口，不是标准 facade envelope |

## Common request rules

1. 所有 HTTP 请求都应带 `x-trace-uuid: <uuid>`。
2. 需要鉴权的请求带 `Authorization: Bearer <access_token>`。
3. WebSocket 仍走 query token：`?access_token=...&trace_uuid=...&last_seen_seq=...`。
4. 业务 HTTP 路由里，**错误返回**统一是 facade error envelope：

```json
{
  "ok": false,
  "error": {
    "code": "invalid-auth",
    "status": 401,
    "message": "..."
  },
  "trace_uuid": "..."
}
```

## Success-shape reality check

当前成功返回并不完全统一，前端不能假设所有成功响应都是 `{ ok:true, data }`：

| 路由族 | 成功返回形状 |
|---|---|
| auth routes | 标准 facade success envelope：`{ ok:true, data, trace_uuid }` |
| `POST/GET /me/sessions` | 标准 facade success envelope |
| `/catalog/*` | 标准 facade success envelope |
| `/sessions/{uuid}/usage` | 标准 facade success envelope |
| `/sessions/{uuid}/resume` | 标准 facade success envelope |
| `/sessions/{uuid}/permission/decision` | 标准 facade success envelope |
| `/sessions/{uuid}/policy/permission_mode` | 标准 facade success envelope |
| `start/input/cancel/status/timeline/history/verify` | **legacy action payload**：`{ ok:true, action: "...", ... , trace_uuid }` |
| `/debug/workers/health` | debug JSON；**不是** facade envelope |

## 文档索引

| 文档 | 范围 | 备注 |
|---|---|---|
| `auth.md` | `/auth/register` `/auth/login` `/auth/refresh` `/auth/verify` `/auth/me` `/me` `/auth/password/reset` | 当前最稳定的 facade envelope 路由族 |
| `wechat-auth.md` | `/auth/wechat/login` | 仍经 `orchestrator-core` facade 暴露 |
| `me-sessions.md` | `POST/GET /me/sessions` | server-mint UUID + hot index list |
| `session.md` | `start/input/cancel/status/timeline/history/verify/resume` | 含当前 legacy success payload 说明 |
| `session-ws-v1.md` | `/sessions/{uuid}/ws` | 只写**当前 live** 的 server frame / reconnect 事实 |
| `permissions.md` | permission decision / mode | HTTP path 已有；WS round-trip **未真正落地** |
| `usage.md` | usage snapshot | HTTP snapshot 已有；live WS push **未真正落地** |
| `catalog.md` | `/catalog/skills` `/catalog/commands` `/catalog/agents` | 端点已实现，但内容仍为空数组 placeholder |
| `worker-health.md` | `/debug/workers/health` | debug/ops 用，不是业务 envelope |

## 尚未实现，不应被当前前端调用

下面这些接口只存在于后续计划 /评审文档里，**当前代码未实现**，因此不在本目录写成“可用 API”：

- `POST /sessions/{id}/messages`
- `GET /sessions/{id}/files`
- `GET /me/conversations`
- `POST /me/devices/revoke`
