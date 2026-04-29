# nano-agent Client API Docs — ZX5 Snapshot

> 文档版本: `ZX5 — 2026-04-29`
> Public facade owner: `orchestrator-core` (唯一客户端直连面)
> 其他 5 个 worker (`orchestrator-auth` / `agent-core` / `bash-core` / `context-core` / `filesystem-core`) 均为 `workers_dev: false`，客户端不可直达。

---

## Base URLs

| 环境 | HTTP | WebSocket |
|------|------|-----------|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` | `wss://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` | `wss://nano-agent-orchestrator-core.haimang.workers.dev` |

---

## Transport Profiles

| Profile | 适用路由 | 说明 |
|---------|---------|------|
| `facade-http-v1` | 全部业务 HTTP 路由 | 标准 facade envelope `{ok, data, trace_uuid}` / error `{ok:false, error:{code,status,message}, trace_uuid}` |
| `session-ws-v1` | `GET /sessions/{id}/ws` | WebSocket upgrade, lightweight `{kind,...}` JSON frames |
| `health-probe` | `GET /` `/health` | deploy/probe 用 |
| `debug-health` | `GET /debug/workers/health` | ops debug 用 |

---

## Common Request Rules

1. **trace_uuid**: 客户端应显式发送 `x-trace-uuid: <uuid>`。session-bearing 路由依赖它；部分 no-auth / debug 路由在缺失时会由服务端补生成。
2. **鉴权**: 需要鉴权的 HTTP 路由使用 `Authorization: Bearer <access_token>`。WebSocket 使用 `?access_token=<jwt>` query。
3. **Content-Type**: 发送 JSON body 时应带 `Content-Type: application/json`。
4. **Error envelope**: facade 错误统一为：

```json
{
  "ok": false,
  "error": { "code": "invalid-auth", "status": 401, "message": "..." },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

---

## Complete Endpoint Matrix (ZX5 — 36 public method+path routes)

### Health & Debug — no auth

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `GET` | `/` | none | shell probe: `{worker, nacp_core_version, status:"ok", ...}` |
| `GET` | `/health` | none | shell probe alias |
| `GET` | `/debug/workers/health` | none | 6-worker 聚合健康快照 |

### Auth — proxy to `orchestrator-auth` (RPC via service binding)

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/auth/register` | none | email/password 注册 → tokens + user + team + snapshot |
| `POST` | `/auth/login` | none | email/password 登录 → tokens + user + team + snapshot |
| `POST` | `/auth/refresh` | none (refresh token in body) | 刷新 access token + refresh token |
| `POST` | `/auth/verify` | bearer | 校验 access token，返回 `valid:true + AuthView` |
| `GET` | `/auth/me` | bearer | 读取当前用户视图 |
| `POST` | `/auth/me` | bearer | `/auth/me` 的 POST 兼容入口 |
| `GET` | `/me` | bearer | `/auth/me` 别名 |
| `POST` | `/me` | bearer | `/auth/me` 的 POST 别名 |
| `POST` | `/auth/password/reset` | bearer | 修改密码 |
| `POST` | `/auth/wechat/login` | none | 微信小程序 code→openid 登录 |

### Catalog — no auth (optional bearer)

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `GET` | `/catalog/skills` | optional | 4 skills registry |
| `GET` | `/catalog/commands` | optional | 5 commands registry |
| `GET` | `/catalog/agents` | optional | 2 agents registry |

### /me Routes — bearer required

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/me/sessions` | bearer | 推荐的 server-mint session UUID 路径 → `{session_uuid, status:"pending", ttl_seconds:86400}` |
| `GET` | `/me/sessions` | bearer | 列出用户 sessions（KV hot index + D1 merge；pending 也可能出现） |
| `GET` | `/me/conversations` | bearer | conversation 级聚合 `?limit=<n>` |
| `GET` | `/me/devices` | bearer | 列出用户设备 |
| `POST` | `/me/devices/revoke` | bearer | 撤销设备 `{device_uuid, reason?}` |

### Session Routes — bearer + tenant guard (`TEAM_UUID` + JWT `team_uuid` / `tenant_uuid`)

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/sessions/{id}/start` | bearer | 启动 session；推荐使用 `/me/sessions` mint 的 UUID，当前实现也接受一个全新的 UUID |
| `POST` | `/sessions/{id}/input` | bearer | text-only 输入；`/messages` 的 thin alias |
| `POST` | `/sessions/{id}/messages` | bearer | 多模态输入 `{parts:[...]}` |
| `POST` | `/sessions/{id}/cancel` | bearer | 取消 turn `{reason?}` |
| `GET` | `/sessions/{id}/status` | bearer | runtime status + durable truth |
| `GET` | `/sessions/{id}/timeline` | bearer | stream event timeline |
| `GET` | `/sessions/{id}/history` | bearer | durable message history |
| `POST` | `/sessions/{id}/verify` | bearer | preview/debug verification harness |
| `GET` | `/sessions/{id}/ws` | query `?access_token=` | WebSocket 会话流 (`session-ws-v1`) |
| `GET` | `/sessions/{id}/usage` | bearer | usage 快照 |
| `POST` | `/sessions/{id}/resume` | bearer | HTTP resume ack `{last_seen_seq?}` |
| `GET` | `/sessions/{id}/files` | bearer | artifact 元数据列表（metadata-only） |
| `POST` | `/sessions/{id}/permission/decision` | bearer | permission 决定 `{request_uuid, decision, scope?}` |
| `POST` | `/sessions/{id}/policy/permission_mode` | bearer | permission 模式 `{mode}` |
| `POST` | `/sessions/{id}/elicitation/answer` | bearer | elicitation 回答 `{request_uuid, answer}` |

---

## Success Response Shapes

> **重要**: 当前成功返回形状并不统一。`/auth/*`、`/me/*`、`/catalog/*` 使用标准 facade envelope；多数 session 读写路由仍保留 legacy action payload。

| 路由族 | 成功形状 | 示例 |
|--------|---------|------|
| `/auth/*` | facade envelope | `{ok:true, data:{tokens,user,team,snapshot}, trace_uuid}` |
| `/me` `/me/sessions` `/me/conversations` `/me/devices` `/me/devices/revoke` | facade envelope | `{ok:true, data:{sessions:[...]}, trace_uuid}` |
| `/catalog/*` | facade envelope | `{ok:true, data:{skills:[...]}, trace_uuid}` |
| `start/input/messages/cancel/status/timeline/history/verify/files` | legacy action payload | `{ok:true, action:"start", session_uuid, ...}` |
| `usage/resume/permission/decision/policy/permission_mode/elicitation/answer` | facade envelope | `{ok:true, data:{session_uuid,...}, trace_uuid}` |
| `/debug/workers/health` | debug JSON | `{ok:true, environment, workers:[...]}` |

---

## Current Session Lifecycle Reality

1. **推荐路径**：`POST /me/sessions` 先 mint pending UUID，再 `POST /sessions/{id}/start`。
2. **当前实现现状**：`/sessions/{id}/start` 仍接受一个此前未 mint 的全新 UUID，并在首次 start 时创建 durable session。
3. **pending guard**：对已经 mint 但尚未 start 的 UUID，除 `/start` 外的大多数 session 路径会返回 `409 session-pending-only-start-allowed`。

---

## ZX5 新增产品面

| 路径 | Method | 状态 | 说明 |
|------|--------|------|------|
| `/sessions/{id}/messages` | `POST` | **implemented** | `/input` 多模态超集；`{parts:[{kind:'text', text} \| {kind:'artifact_ref', artifact_uuid, mime?, summary?}]}` |
| `/sessions/{id}/files` | `GET` | **partial (metadata-only)** | 从 D1 history 扫描 `artifact_ref` parts；不提供 bytes download |
| `/me/conversations` | `GET` | **implemented** | D1-based conversation 聚合，`?limit=` 默认 50、最大 200 |
| `/me/devices` | `GET` | **implemented** | 列出 `nano_user_devices` 中该用户的设备 |
| `/me/devices/revoke` | `POST` | **partial** | D1 revoke 与审计已完成；auth gate 的 device-active 即时拒绝仍待 second-half |

---

## 尚未 Live 的客户端能力

| 能力 | 状态 | 当前可用替代 |
|------|------|-------------|
| WS `session.permission.request` round-trip | 未 live | HTTP `POST /sessions/{id}/permission/decision` |
| WS `session.elicitation.request` round-trip | 未 live | HTTP `POST /sessions/{id}/elicitation/answer` |
| WS `session.usage.update` live push | 未 live | HTTP `GET /sessions/{id}/usage` 拉取 |
| R2 file bytes download | 未实现 | `/files` 仅返 metadata |

---

## 文档索引

| 文档 | 覆盖范围 |
|------|---------|
| [`auth.md`](./auth.md) | register / login / refresh / verify / me / password reset |
| [`wechat-auth.md`](./wechat-auth.md) | WeChat mini-program login |
| [`me-sessions.md`](./me-sessions.md) | /me/sessions / /me/conversations / /me/devices / /me/devices/revoke |
| [`session.md`](./session.md) | start / input / messages / cancel / status / timeline / history / verify / resume / files |
| [`session-ws-v1.md`](./session-ws-v1.md) | WebSocket wire protocol |
| [`permissions.md`](./permissions.md) | permission/decision / policy/permission_mode / elicitation/answer |
| [`usage.md`](./usage.md) | usage snapshot |
| [`catalog.md`](./catalog.md) | catalog/skills / catalog/commands / catalog/agents |
| [`worker-health.md`](./worker-health.md) | debug health probe |
