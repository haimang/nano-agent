# Worker Health API — ZX5 Snapshot

> Public facade owner: `orchestrator-core`
> Profile: `debug-health`
> **debug / ops 接口，不是业务 facade envelope**

---

## `GET /debug/workers/health`

### Request
```http
GET /debug/workers/health HTTP/1.1
```
No auth required.

### Response (200)
```json
{
  "ok": true,
  "environment": "preview",
  "generated_at": "2026-04-29T00:00:00.000Z",
  "summary": { "live": 6, "total": 6 },
  "workers": [
    { "worker": "orchestrator-core", "live": true, "status": "ok", "worker_version": "1.0.0" },
    { "worker": "orchestrator-auth", "live": true, "status": "ok", "worker_version": "1.0.0" },
    { "worker": "agent-core", "live": true, "status": "ok", "worker_version": "1.0.0" },
    { "worker": "bash-core", "live": true, "status": "ok", "worker_version": "1.0.0" },
    { "worker": "context-core", "live": true, "status": "ok", "worker_version": "1.0.0" },
    { "worker": "filesystem-core", "live": true, "status": "ok", "worker_version": "1.0.0" }
  ]
}
```

### Response (degraded — some workers unhealthy)
```json
{
  "ok": true,
  "environment": "preview",
  "generated_at": "...",
  "summary": { "live": 4, "total": 6 },
  "workers": [
    { "worker": "bash-core", "live": false, "status": "http-502", "error": "Bad Gateway" },
    ...
  ]
}
```

### Field Reference

| 字段 | 说明 |
|------|------|
| `environment` | 部署环境 (preview/production) |
| `generated_at` | 快照生成时间 (ISO) |
| `summary.live` | 健康的 worker 数 |
| `summary.total` | 总 worker 数 (恒为 6) |
| `workers[].worker` | worker 名称 |
| `workers[].live` | 是否健康 |
| `workers[].status` | `ok` / `binding-missing` / `unreachable` / `http-<status>` |
| `workers[].worker_version` | worker 版本号 |
| `workers[].error` | 仅 probe 失败时出现 |

### Worker Set
Fixed aggregation of 6 workers:
- `orchestrator-core` (public facade)
- `orchestrator-auth` (auth RPC)
- `agent-core` (runtime host)
- `bash-core` (capability engine)
- `context-core` (library worker)
- `filesystem-core` (library worker)

### Intended Use
- Frontend debug panel / connection-status indicator
- Post-deploy visual confirmation
- NOT a business API health source or SLO metric
