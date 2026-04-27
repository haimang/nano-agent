# Catalog API

> Profile: `facade-http-v1`
> 状态: ZX2 Phase 5 P5-01 — 三件套（skills / commands / agents）只读
> 生成: 2026-04-27

`/catalog/{kind}` 三个端点暴露当前部署可见的 skill / command / agent 列表，给前端做 slash menu / capability picker。

## 1. 端点

| Route | Method | Auth |
|---|---|---|
| `/catalog/skills` | GET | optional bearer |
| `/catalog/commands` | GET | optional bearer |
| `/catalog/agents` | GET | optional bearer |

> Auth: ZX2 v1 不强制鉴权（catalog 内容是 deploy 级别的静态信息），但**强烈建议**带 bearer 以便服务端可以根据 plan_level / membership_level 过滤未来出现的私有 catalog 项。

## 2. 响应

### `GET /catalog/skills`

```json
{
  "ok": true,
  "data": {
    "skills": [
      { "name": "review", "description": "review pending changes" },
      { "name": "schedule", "description": "schedule a recurring agent" }
    ]
  },
  "trace_uuid": "..."
}
```

ZX2 v1 实现返回 **空数组**（`skills: []`）；具体注册由后续 plan 落地。

### `GET /catalog/commands`

```json
{
  "ok": true,
  "data": {
    "commands": [
      { "name": "loop", "description": "/loop 5m /babysit-prs" },
      { "name": "schedule", "description": "/schedule daily /standup" }
    ]
  },
  "trace_uuid": "..."
}
```

### `GET /catalog/agents`

```json
{
  "ok": true,
  "data": {
    "agents": [
      { "name": "claude-code-guide", "description": "answers Claude Code/SDK/API questions" }
    ]
  },
  "trace_uuid": "..."
}
```

## 3. Cache 建议

Catalog 内容在 deploy 期内基本不变，前端可以 in-memory cache 5 分钟。当用户主动刷新 / 切换 session 时再拉一次。

## 4. 错误

| HTTP | error.code |
|---|---|
| 503 | `worker-misconfigured` (orchestrator-core 启动配置缺失) |

未来：`401 invalid-auth` 当鉴权对私有 catalog 启用后。
