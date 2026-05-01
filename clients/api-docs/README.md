# nano-agent Client API Docs — hero-to-pro Frozen Pack

> 文档版本: `hero-to-pro HP9 Frozen`
> 文档基线: `HP8 code freeze (2026-04-30)` + `HP9 docs freeze (2026-05-01)`
> Public facade owner: `orchestrator-core` — 客户端唯一直连 worker。
> 内部 worker (`orchestrator-auth` / `agent-core` / `bash-core` / `context-core` / `filesystem-core`) 均通过 service binding/RPC 被 facade 调用，不对客户端暴露。
> 文档组织原则: 按**产品 surface** 切分（HPX-Q29），每份文档头部标注主要 worker / endpoint family 作为 implementation reference。

## Base URLs

| 环境 | HTTP | WebSocket |
|------|------|-----------|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` | `wss://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` | `wss://nano-agent-orchestrator-core.haimang.workers.dev` |

## Common Request Rules

| 规则 | 客户端要求 |
|------|------------|
| Trace | 业务路由必须发送 `x-trace-uuid: <uuid>`；catalog/health 可省略但建议统一生成。 |
| HTTP auth | 鉴权路由使用 `Authorization: Bearer <access_token>`；`nak_...` API key 仅用于 server/client integration。 |
| WS auth | `GET /sessions/{id}/ws?access_token=<jwt>&trace_uuid=<uuid>`。 |
| JSON body | 发送 JSON 时带 `Content-Type: application/json`。 |
| Device headers | 鉴权路由可附带 `x-device-uuid` / `x-device-label` / `x-device-kind`，用于 device gating。 |
| Error | facade 错误固定为 `{ok:false,error:{code,status,message,details?},trace_uuid}`；详见 [`error-index.md`](./error-index.md)。 |

## Transport Profiles

详见 [`transport-profiles.md`](./transport-profiles.md)。

| Profile | 路由示例 | 成功返回形状 |
|---------|----------|--------------|
| `health-probe` | `GET /` `/health` | raw shell probe JSON |
| `debug-health` | `GET /debug/workers/health` | raw debug JSON |
| `facade-http-v1` | 大多数业务 HTTP / debug P6 路由 | `{ok:true,data,trace_uuid}` |
| `legacy-do-action` | session DO action 路由（start/input/cancel/close/messages 等） | `{ok:true,action,session_uuid,...,trace_uuid}` |
| `session-ws-v1` | `GET /sessions/{id}/ws` | lightweight JSON frames |
| `binary-content` | `GET /sessions/{id}/files/{fileUuid}/content` | raw bytes + content headers |

## 18-Doc Pack（hero-to-pro frozen authoritative）

> HP9 把对外接口文档冻结为 **11 现有重组/校对 + 7 新增专题 = 18 份 authoritative pack**。README 是其中一份。

### Foundation

| 文档 | 覆盖范围 |
|------|----------|
| [`README.md`](./README.md) | 本文件：base URLs、transport profiles、endpoint matrix、18-doc 索引 |
| [`auth.md`](./auth.md) | auth/login/register/refresh/me/password/wechat/api-key revoke |
| [`me-sessions.md`](./me-sessions.md) | `/me/*` session/team/device/conversation 路由 |
| [`error-index.md`](./error-index.md) | public error code、`system.error`、前端鉴别策略 |
| [`worker-health.md`](./worker-health.md) | `/health`、`/debug/workers/health`、debug routes |
| [`catalog.md`](./catalog.md) | static catalog routes (`/catalog/skills` 等) |
| [`transport-profiles.md`](./transport-profiles.md) | 全部 transport profile 的 envelope law 与适用边界 |

### Session Surface

| 文档 | 覆盖范围 |
|------|----------|
| [`session.md`](./session.md) | session HTTP lifecycle (`start`/`input`/`cancel`/`close`/`delete`/`title`/`messages`/`status`/`timeline`/`history`/`resume`/`verify`)，conversation detail |
| [`session-ws-v1.md`](./session-ws-v1.md) | public WebSocket frame protocol（包括 `tool.call.cancelled` / `session.fork.created` 等 HP6/HP7 新事件） |
| [`models.md`](./models.md) | `/models` list/detail、`/sessions/{id}/model` get/patch（HP2 model state machine） |
| [`context.md`](./context.md) | `/sessions/{id}/context/*` probe/layers/snapshot/compact preview/job（HP3 context state machine） |
| [`workspace.md`](./workspace.md) | `/sessions/{id}/files` artifact CRUD + workspace temp file readiness（HP6） |
| [`checkpoints.md`](./checkpoints.md) | `/sessions/{id}/checkpoints` list/create/diff + restore/fork readiness（HP4 first-wave + HP7 substrate） |
| [`todos.md`](./todos.md) | `/sessions/{id}/todos` CRUD（HP6 todo control plane） |
| [`confirmations.md`](./confirmations.md) | `/sessions/{id}/confirmations` list/detail/decision + 7-kind readiness matrix（HP5） |
| [`permissions.md`](./permissions.md) | legacy `/permission/decision` + `/elicitation/answer` + `/policy/permission_mode`（HP5 dual-write 兼容层） |
| [`usage.md`](./usage.md) | `/sessions/{id}/usage` snapshot |
| [`wechat-auth.md`](./wechat-auth.md) | WeChat mini-program login |

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

详见 [`auth.md`](./auth.md)。

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/auth/register` | none | email/password 注册 |
| `POST` | `/auth/login` | none | email/password 登录 |
| `POST` | `/auth/refresh` | none | refresh token 换新 token |
| `POST` | `/auth/verify` | bearer | 校验 access token |
| `GET`/`POST` | `/auth/me` `/me` | bearer | 当前用户视图 |
| `POST` | `/auth/password/reset` | bearer | 修改密码 |
| `POST` | `/auth/wechat/login` | none | 微信 code 登录 |
| `POST` | `/auth/api-keys/revoke` | bearer | 撤销当前 team 下的 `nak_` API key |

### User and Team

详见 [`me-sessions.md`](./me-sessions.md)。

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `POST` | `/me/sessions` | bearer | server-mint pending session UUID |
| `GET` | `/me/sessions` | bearer | 当前用户 session 列表，支持 `limit`/`cursor` |
| `GET` | `/me/conversations` | bearer | conversation 聚合列表，支持 `limit`/`cursor`，默认隐藏 tombstoned conversation |
| `GET` | `/conversations/{conversation_uuid}` | bearer | conversation detail (HP4) |
| `GET` | `/me/team` | bearer | 当前 team 详情 |
| `PATCH` | `/me/team` | bearer owner | 修改 `team_name` |
| `GET` | `/me/teams` | bearer | 用户加入的 teams |
| `GET` | `/me/devices` | bearer | 当前用户 active devices |
| `POST` | `/me/devices/revoke` | bearer | 撤销单个 device |

### Catalog

详见 [`catalog.md`](./catalog.md)。

| Method | Path | Auth | 说明 |
|--------|------|------|------|
| `GET` | `/catalog/skills` | optional | 静态 skills registry |
| `GET` | `/catalog/commands` | optional | 静态 commands registry |
| `GET` | `/catalog/agents` | optional | 静态 agents registry |

### Models

详见 [`models.md`](./models.md)。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/models` | bearer | facade / `304` | D1 model catalog + per-team policy filter + ETag |
| `GET` | `/models/{modelIdOrAlias}` | bearer | facade | single model detail; 支持 encoded canonical id 或 `@alias/*` |
| `GET` | `/sessions/{id}/model` | bearer | facade | session current-model control plane view |
| `PATCH` | `/sessions/{id}/model` | bearer | facade | set / clear session default model + reasoning |

### Session HTTP Lifecycle

详见 [`session.md`](./session.md)。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
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
| `POST` | `/sessions/{id}/resume` | bearer | facade | HTTP replay ack |
| `GET` | `/sessions/{id}/usage` | bearer | facade | usage snapshot |

### Context

详见 [`context.md`](./context.md)。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/sessions/{id}/context` | bearer | facade | legacy alias of context probe |
| `GET` | `/sessions/{id}/context/probe` | bearer | facade | context probe / compact budget |
| `GET` | `/sessions/{id}/context/layers` | bearer | facade | assembled context layers |
| `POST` | `/sessions/{id}/context/snapshot` | bearer | facade | persist manual context snapshot |
| `POST` | `/sessions/{id}/context/compact/preview` | bearer | facade | manual compact preview |
| `POST` | `/sessions/{id}/context/compact` | bearer | facade | create compact boundary job |
| `GET` | `/sessions/{id}/context/compact/jobs/{jobId}` | bearer | facade | read compact job handle |

### Workspace + Files

详见 [`workspace.md`](./workspace.md)。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/sessions/{id}/files` | bearer | facade | list artifacts |
| `POST` | `/sessions/{id}/files` | bearer | facade `201` | multipart upload artifact |
| `GET` | `/sessions/{id}/files/{fileUuid}/content` | bearer | binary | read artifact bytes |

### Checkpoints

详见 [`checkpoints.md`](./checkpoints.md)。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/sessions/{id}/checkpoints` | bearer | facade | list 产品级 checkpoint registry |
| `POST` | `/sessions/{id}/checkpoints` | bearer | facade `201` | 创建 `user_named` checkpoint |
| `GET` | `/sessions/{id}/checkpoints/{checkpoint_uuid}/diff` | bearer | facade | 读 checkpoint 对当前 ledger 的 diff |

### Todos

详见 [`todos.md`](./todos.md)。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/sessions/{id}/todos` | bearer | facade | list 当前 session 的 todo（支持 `?status=` 过滤） |
| `POST` | `/sessions/{id}/todos` | bearer | facade `201` | 创建 todo |
| `PATCH` | `/sessions/{id}/todos/{todo_uuid}` | bearer | facade | update todo (5-status enum) |
| `DELETE` | `/sessions/{id}/todos/{todo_uuid}` | bearer | facade | 删除 todo |

### Confirmations

详见 [`confirmations.md`](./confirmations.md)（含 7-kind readiness matrix）。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/sessions/{id}/confirmations` | bearer | facade | list confirmations（支持 `?status=`） |
| `GET` | `/sessions/{id}/confirmations/{confirmation_uuid}` | bearer | facade | confirmation detail |
| `POST` | `/sessions/{id}/confirmations/{confirmation_uuid}/decision` | bearer | facade | 提交 decision；冲突返 `409 confirmation-already-resolved` |

### Legacy Permission/Elicitation 兼容层

详见 [`permissions.md`](./permissions.md)。这些路由保留为 legacy compat alias，dual-write 到 confirmations。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `POST` | `/sessions/{id}/permission/decision` | bearer | facade | 提交 permission decision |
| `POST` | `/sessions/{id}/policy/permission_mode` | bearer | facade | 设置 permission mode |
| `POST` | `/sessions/{id}/elicitation/answer` | bearer | facade | 提交 elicitation answer |

### WebSocket

详见 [`session-ws-v1.md`](./session-ws-v1.md)。

| Method | Path | Auth | Shape | 说明 |
|--------|------|------|-------|------|
| `GET` | `/sessions/{id}/ws` | query token | WS | session-ws-v1 frame protocol |
