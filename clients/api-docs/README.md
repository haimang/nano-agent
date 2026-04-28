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
| `catalog.md` | `/catalog/skills` `/catalog/commands` `/catalog/agents` | 端点已实现，**ZX5 起 registry 已填 11 entries(4 skills / 5 commands / 2 agents)**，不再是空数组 placeholder |
| `worker-health.md` | `/debug/workers/health` | debug/ops 用，不是业务 envelope |

## ZX5 新增产品面（已实现）

ZX5 Lane D 已 land 以下 4 个 product endpoint，前端可调用：

| 路径 | Method | 状态 | 说明 |
|---|---|---|---|
| `/sessions/{id}/messages` | POST | **implemented** | `/input` 的多模态超集；body shape `{parts: [{kind:'text', text}\|{kind:'artifact_ref', artifact_uuid, mime?, summary?}, ...]}`。落同一 `nano_conversation_messages` 表（`message_kind = user.input.text \| user.input.multipart`）+ forward 到 agent-core `input` RPC（parts→text 归一化）。`/input` 现在是 `/messages` 的 thin alias，统一落库路径 |
| `/sessions/{id}/files` | GET | **partial(metadata-only)** | 从 `nano_conversation_messages.body_json` 扫 `artifact_ref` parts；当前 owner 未创建 R2 bucket，因此**只返 metadata + artifact_uuid**，不返 bytes。R2 binding 接通后可加 `download_url` 字段 |
| `/me/conversations` | GET | **implemented** | 复用 `nano_conversation_sessions` 5-state truth + group by `conversation_uuid`；返 `{conversation_uuid, latest_session_uuid, latest_status, started_at, latest_session_started_at, last_seen_at(legacy alias), last_phase, session_count}`，按 `latest_session_started_at DESC` sort |
| `/me/devices` | GET | **implemented** | 列出 authenticated user 的 devices（`nano_user_devices` 表，ZX5 migration 007 新建） |
| `/me/devices/revoke` | POST | **partial(D1 写入,auth-gate device-active check 待 second-half PR)** | body `{device_uuid, reason?}`；写 `nano_user_devices.status='revoked'` + 一行 audit；**当前已发出的 access token 在 exp 前仍可用**——`verifyAccessToken` 的 device-active lookup 是 D6 second-half follow-up |

## 尚未实现 / 仍未 live 的客户端能力

- `session.permission.request` / `session.elicitation.request` **WS round-trip** — 仍未 live；HTTP `permission/decision` 已有但 runtime kernel 不会等用户 decision，仍是同步 fail-closed 路径（per ZX5 closure §3.2 + 4-reviewer review F1/F2 partial）
- `session.usage.update` **server frame live push** — 当前 client 仍只能用 `GET /sessions/{id}/usage` 拉取；runtime callback 已通，emit wiring 留 future PR（per ZX5 closure §3.2 F3 partial）
- R2 file bytes — `/files` 只返 metadata，待 owner 创建 R2 bucket 后扩展
