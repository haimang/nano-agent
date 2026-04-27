# nano-agent client API docs

当前前端只应面向 `orchestrator-core` 这个 public facade 发请求。`orchestrator-auth`、`agent-core`、`bash-core`、`context-core`、`filesystem-core` 都不应被客户端直接访问（ZX2 Phase 1 已显式 `workers_dev: false` + binding-scope 守卫，公网 fetch 非 `/health` 一律返回 401 `binding-scope-forbidden`）。

## Transport profile 索引

ZX2 Phase 1 起，nano-agent 的 transport 形态命名为 5 个 profile，详见 [`docs/transport/transport-profiles.md`](../../docs/transport/transport-profiles.md)：

| Profile | 范围 | 状态 |
|---|---|---|
| `facade-http-v1` | `/auth/*` `/me` `/sessions/{uuid}/*` `/catalog/*` `/debug/*` 公网 HTTP | active |
| `session-ws-v1` | `/sessions/{uuid}/ws` 公网 WebSocket（基于 `NacpSessionFrameSchema`） | active |
| `health-probe` | 各 worker `GET /` `GET /health` | active |
| `nacp-internal` | worker ↔ worker 协议化 RPC（NACP envelope） | active（auth 100% / agent ZX2 进行中 / bash ZX2 进行中） |
| `internal-http-compat` | 旧 `https://*.internal/...` HTTP relay | retiring（ZX2 Phase 3 翻转后 `retired-with-rollback`） |

## 业务文档

| 文档 | profile | 说明 |
|------|------|------|
| `auth.md` | facade-http-v1 | 邮箱注册、登录、刷新、`/me`、JWT/secret 配置入口 |
| `wechat-auth.md` | facade-http-v1 | 微信 `code + encrypted_data + iv` 登录与开发配置 |
| `session.md` | facade-http-v1 + session-ws-v1 | session start / input / timeline / history / verify / websocket |
| `session-ws-v1.md` | session-ws-v1 | _（ZX2 Phase 4 P4-05 撰写）_ server-frame registry / close codes / ack 语义 |
| `permissions.md` | facade-http-v1 + session-ws-v1 | _（ZX2 Phase 5）_ permission decision / policy 闭环 |
| `usage.md` | facade-http-v1 + session-ws-v1 | _（ZX2 Phase 5）_ token / capability / subrequest budget |
| `catalog.md` | facade-http-v1 | _（ZX2 Phase 5）_ skills / commands / agents 列表 |
| `me-sessions.md` | facade-http-v1 | _（ZX2 Phase 5）_ server-mint UUID + TTL + 跨设备 resume |
| `worker-health.md` | health-probe | `/debug/workers/health` 聚合调试接口 |

## Base URL

```text
https://nano-agent-orchestrator-core-preview.haimang.workers.dev
```

## Common rules

1. 所有 HTTP 请求都应带 `x-trace-uuid`。
2. 需要鉴权的请求使用 `Authorization: Bearer <access_token>`。
3. websocket 仍走 compatibility query token：`?access_token=...&trace_uuid=...&last_seen_seq=...`。
4. 所有响应都以 façade 当前真实实现为准，而不是内部 worker route。
5. ZX2 Phase 4 起 `facade-http-v1` 成功响应统一为 `{ok:true, data, trace_uuid}`，错误统一为 `{ok:false, error:{code,status,message}, trace_uuid}`。
