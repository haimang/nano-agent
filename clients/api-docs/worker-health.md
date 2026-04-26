# Worker health API

## Route

| Route | Method | Auth | 说明 |
|------|--------|------|------|
| `/debug/workers/health` | `GET` | no | 聚合 6 个 worker 的 live/version/debug truth |

## Response

```json
{
  "ok": true,
  "environment": "preview",
  "generated_at": "2026-04-25T00:00:00.000Z",
  "summary": {
    "live": 6,
    "total": 6
  },
  "workers": [
    {
      "worker": "orchestrator-core",
      "live": true,
      "status": "ok",
      "worker_version": "orchestrator-core@preview",
      "details": {
        "worker": "orchestrator-core",
        "status": "ok",
        "phase": "orchestration-facade-closed"
      }
    }
  ]
}
```

## Worker set

当前聚合目标固定为：

1. `orchestrator-core`
2. `orchestrator-auth`
3. `agent-core`
4. `bash-core`
5. `context-core`
6. `filesystem-core`

## Field notes

| Field | 说明 |
|------|------|
| `live` | probe 是否成功且 worker 自报 `status="ok"` |
| `status` | worker 自报状态，或 `binding-missing` / `unreachable` |
| `worker_version` | 由各 worker 的 `WORKER_VERSION` env 提供 |
| `details` | worker 的原始 probe body，便于调试 phase/binding flags |

该接口是前端 debug 面，不是业务查询 API；字段会保持克制，不直接暴露内部 secret 或大块 topology 细节。
