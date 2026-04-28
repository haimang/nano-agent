# Worker health API

> Public facade owner: `orchestrator-core`
> Profile: `debug-health`
> 说明: **debug / ops 接口，不是业务 facade envelope**

## Base URLs

| 环境 | Base URL |
|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` |

## Route

| Route | Method | Auth |
|---|---|---|
| `/debug/workers/health` | `GET` | no |

## Response shape

> 注意：这个接口**不是** `{ ok:true, data, trace_uuid }`。当前真实返回就是下面这种 debug JSON：

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
        "phase": "orchestration-facade-closed",
        "public_facade": true
      }
    }
  ]
}
```

## Worker set

当前固定聚合 6 个 worker：

1. `orchestrator-core`
2. `orchestrator-auth`
3. `agent-core`
4. `bash-core`
5. `context-core`
6. `filesystem-core`

## Field notes

| Field | 含义 |
|---|---|
| `summary.live` | `live === true` 的 worker 数量 |
| `summary.total` | 当前探测集合总数 |
| `worker` | worker 名称 |
| `live` | probe 成功且 worker 自报 `status === "ok"` |
| `status` | `ok` / `binding-missing` / `unreachable` / `http-<status>` |
| `worker_version` | worker 自报版本；缺失时为 `null` |
| `details` | worker 原始 probe body；便于 debug |
| `error` | 仅在探测失败时出现 |

## Intended use

- 前端 debug 面板
- preview / production deploy 后的肉眼确认
- 非业务监控 UI

不要把它当成业务 API 的可用性真相源，也不要拿它替代真正的 session / auth 状态查询。
