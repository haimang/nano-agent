# Catalog API

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> 当前状态: **端点已实现，但 registry 内容仍是空数组 placeholder**

## Base URLs

| 环境 | Base URL |
|---|---|
| preview | `https://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `https://nano-agent-orchestrator-core.haimang.workers.dev` |

## Routes

| Route | Method | Auth |
|---|---|---|
| `/catalog/skills` | `GET` | optional bearer |
| `/catalog/commands` | `GET` | optional bearer |
| `/catalog/agents` | `GET` | optional bearer |

> 当前实现即使不带 bearer 也可访问。建议仍带 bearer，给未来按 team / membership 过滤内容留出兼容空间。

## Success envelope

### `GET /catalog/skills`

```json
{
  "ok": true,
  "data": {
    "skills": []
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

### `GET /catalog/commands`

```json
{
  "ok": true,
  "data": {
    "commands": []
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

### `GET /catalog/agents`

```json
{
  "ok": true,
  "data": {
    "agents": []
  },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

## Important reality

当前 `workers/orchestrator-core/src/index.ts` 的 `handleCatalog()` 仍直接返回空数组：

- `skills: []`
- `commands: []`
- `agents: []`

因此客户端现在可以依赖的是：

1. **路由稳定存在**
2. **envelope 形状稳定**
3. **内容暂时为空**

而不能依赖：

- 某个 skill / command / agent 名称一定出现
- catalog 已经是完整产品功能面

## Errors

目前最主要的失败场景是 worker 启动/路由层异常；标准返回仍是 facade error envelope。
