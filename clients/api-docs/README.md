# nano-agent client API docs

当前前端只应面向 `orchestrator-core` 这个 public facade 发请求。`orchestrator-auth`、`agent-core`、`bash-core`、`context-core`、`filesystem-core` 都不应被客户端直接访问。

| 文档 | 说明 |
|------|------|
| `auth.md` | 邮箱注册、登录、刷新、`/me`、JWT/secret 配置入口 |
| `wechat-auth.md` | 微信 `code + encrypted_data + iv` 登录与开发配置 |
| `session.md` | session start / input / timeline / history / verify / websocket |
| `worker-health.md` | `/debug/workers/health` 聚合调试接口 |

## Base URL

```text
https://nano-agent-orchestrator-core-preview.haimang.workers.dev
```

## Common rules

1. 所有 HTTP 请求都应带 `x-trace-uuid`。
2. 需要鉴权的请求使用 `Authorization: Bearer <access_token>`。
3. websocket 仍走 compatibility query token：`?access_token=...&trace_uuid=...&last_seen_seq=...`。
4. 所有响应都以 façade 当前真实实现为准，而不是内部 worker route。
