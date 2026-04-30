# nano-agent Client API Docs — RHX2 Phase 6 Snapshot

> 文档版本: `RHX2 Phase 6`
> Public facade owner: `orchestrator-core`，这是客户端唯一直连 worker。
> 其他 worker (`orchestrator-auth` / `agent-core` / `bash-core` / `context-core` / `filesystem-core`) 均通过 service binding/RPC 被 facade 调用。

## Base URLs

| 环境 | HTTP | WebSocket |
|------|------|-----------|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` | `wss://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` | `wss://nano-agent-orchestrator-core.haimang.workers.dev` |

## Common Request Rules

| 规则 | 客户端要求 |
|------|------------|
| Trace | 业务路由必须发送 `x-trace-uuid: <uuid>`；catalog/health 可省略但建议统一生成。 |
| HTTP auth | 鉴权路由使用 `Authorization: Bearer <access_token>`；`nak_...` API key 仅用于 server/client integration，不是小程序常规登录态。 |
| WS auth | `GET /sessions/{id}/ws?access_token=<jwt>&trace_uuid=<uuid>`。 |
| JSON body | 发送 JSON 时带 `Content-Type: application/json`。 |
| Error | facade 错误固定为 `{ok:false,error:{code,status,message,details?},trace_uuid}`；详见 [`error-index.md`](./error-index.md)。 |

## Transport Profiles

| Profile | 路由 | 成功返回形状 |
|---------|------|--------------|
| `health-probe` | `GET /` `/health` | raw shell probe JSON |
| `debug-health` | `GET /debug/workers/health` | raw debug JSON |
| `facade-http-v1` | 大多数业务 HTTP / debug P6 路由 | `{ok:true,data,trace_uuid}` |
| legacy action payload | 部分 session DO action 路由 | `{ok:true,action,session_uuid,...,trace_uuid}` |
| `session-ws-v1` | `GET /sessions/{id}/ws` | lightweight JSON frames |
| binary file content | `GET /sessions/{id}/files/{fileUuid}/content` | raw bytes + content headers |

## Complete Endpoint Matrix

### Health and Debug

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/` | none | raw | shell probe |
| `GET` | `/health` | none | raw | shell probe alias |
| `GET` | `/debug/workers/health` | none | raw | 6-worker 聚合健康快照 |
| `GET` | `/debug/logs` | bearer | facade | D1 `nano_error_log` team-scoped 查询 |
| `GET` | `/debug/recent-errors` | bearer | facade | 当前 worker 实例内存 ring buffer |
| `GET` | `/debug/audit` | bearer owner | facade | D1 `nano_audit_log` team owner 查询 |
| `GET` | `/debug/packages` | bearer | facade | build-time package manifest + GitHub Packages runtime drift 检查 |

### Auth

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/auth/register` | none | email/password 注册 |
| `POST` | `/auth/login` | none | email/password 登录 |
| `POST` | `/auth/refresh` | none | refresh token 换新 token |
| `POST` | `/auth/verify` | bearer | 校验 access token |
| `GET`/`POST` | `/auth/me` | bearer | 当前用户视图 |
| `GET`/`POST` | `/me` | bearer | `/auth/me` 别名 |
| `POST` | `/auth/password/reset` | bearer | 修改密码 |
| `POST` | `/auth/wechat/login` | none | 微信 code 登录 |
| `POST` | `/auth/api-keys/revoke` | bearer | 撤销当前 team 下的 `nak_` API key |

### Catalog

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `GET` | `/catalog/skills` | optional | 静态 skills registry |
| `GET` | `/catalog/commands` | optional | 静态 commands registry |
| `GET` | `/catalog/agents` | optional | 静态 agents registry |

### User and Team

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/me/sessions` | bearer | server-mint pending session UUID |
| `GET` | `/me/sessions` | bearer | 当前用户 session 列表，支持 `limit`/`cursor` |
| `GET` | `/me/conversations` | bearer | conversation 聚合列表，支持 `limit`/`cursor`，默认隐藏 tombstoned conversation |
| `GET` | `/me/team` | bearer | 当前 team 详情 |
| `PATCH` | `/me/team` | bearer owner | 修改 `team_name` |
| `GET` | `/me/teams` | bearer | 用户加入的 teams |
| `GET` | `/me/devices` | bearer | 当前用户 active devices |
| `POST` | `/me/devices/revoke` | bearer | 撤销单个 device，并触发 User DO attachment supersede |

### Models, Session, Context, Files

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/models` | bearer | facade / `304` | D1 model catalog + per-team policy filter + ETag |
| `POST` | `/sessions/{id}/start` | bearer | legacy | 启动 session |
| `POST` | `/sessions/{id}/input` | bearer | legacy | text-only 输入 |
| `POST` | `/sessions/{id}/messages` | bearer | legacy | multipart message 输入 |
| `POST` | `/sessions/{id}/cancel` | bearer | legacy | 取消 session |
| `POST` | `/sessions/{id}/close` | bearer | legacy | 正常结束 session，写 `ended_reason=closed_by_user` |
| `DELETE` | `/sessions/{id}` | bearer | legacy | 软删除 parent conversation（tombstone） |
| `PATCH` | `/sessions/{id}/title` | bearer | legacy | 修改 parent conversation title |
| `GET` | `/sessions/{id}/status` | bearer | legacy | runtime + durable status |
| `GET` | `/sessions/{id}/timeline` | bearer | legacy | stream event timeline |
| `GET` | `/sessions/{id}/history` | bearer | legacy | durable message history |
| `POST` | `/sessions/{id}/verify` | bearer | legacy | preview verification harness |
| `GET` | `/sessions/{id}/usage` | bearer | facade | usage snapshot |
| `POST` | `/sessions/{id}/resume` | bearer | facade | HTTP replay ack |
| `GET` | `/conversations/{conversation_uuid}` | bearer | facade | 读取 conversation detail |
| `GET` | `/sessions/{id}/checkpoints` | bearer | facade | 列出当前 session 的产品级 checkpoint registry |
| `POST` | `/sessions/{id}/checkpoints` | bearer | facade `201` | 创建 `user_named` checkpoint |
| `GET` | `/sessions/{id}/checkpoints/{checkpoint_uuid}/diff` | bearer | facade | 读取 checkpoint 对当前 session ledger 的 diff |
| `GET` | `/sessions/{id}/ws` | query token | WS | session-ws-v1 |
| `GET` | `/sessions/{id}/context` | bearer | facade | legacy alias of context probe |
| `GET` | `/sessions/{id}/context/probe` | bearer | facade | context probe / compact budget |
| `GET` | `/sessions/{id}/context/layers` | bearer | facade | assembled context layers |
| `POST` | `/sessions/{id}/context/snapshot` | bearer | facade | persist manual context snapshot |
| `POST` | `/sessions/{id}/context/compact/preview` | bearer | facade | manual compact preview |
| `POST` | `/sessions/{id}/context/compact` | bearer | facade | create compact boundary job |
| `GET` | `/sessions/{id}/context/compact/jobs/{jobId}` | bearer | facade | read compact job handle |
| `GET` | `/sessions/{id}/files` | bearer | facade | list artifacts |
| `POST` | `/sessions/{id}/files` | bearer | facade `201` | multipart upload artifact |
| `GET` | `/sessions/{id}/files/{fileUuid}/content` | bearer | binary | read artifact bytes |
| `POST` | `/sessions/{id}/permission/decision` | bearer | facade | 提交 permission decision |
| `POST` | `/sessions/{id}/policy/permission_mode` | bearer | facade | 设置 permission mode |
| `POST` | `/sessions/{id}/elicitation/answer` | bearer | facade | 提交 elicitation answer |

## 文档索引

| 文档 | 覆盖范围 |
|------|----------|
| [`auth.md`](./auth.md) | auth/login/register/refresh/me/password/wechat/api-key revoke |
| [`me-sessions.md`](./me-sessions.md) | `/me/*` session/team/device routes |
| [`session.md`](./session.md) | session HTTP、models、context、files |
| [`session-ws-v1.md`](./session-ws-v1.md) | public WebSocket frame protocol |
| [`permissions.md`](./permissions.md) | permission/elicitation HTTP substitute paths |
| [`usage.md`](./usage.md) | session usage snapshot |
| [`catalog.md`](./catalog.md) | static catalog routes |
| [`worker-health.md`](./worker-health.md) | health + RHX2 debug/observability endpoints |
| [`wechat-auth.md`](./wechat-auth.md) | WeChat mini-program login |
| [`error-index.md`](./error-index.md) | public error code、system.error、前端鉴别策略 |
