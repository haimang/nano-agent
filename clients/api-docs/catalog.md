# Catalog API — RHX2 Phase 6 Snapshot

> Public facade owner: `orchestrator-core`
> Profile: `facade-http-v1`
> Registry: `catalog-content.ts` 静态加载的 11 entries（4 skills / 5 commands / 2 agents）
> Auth: optional；当前 route 不读取 bearer，未传也会成功。

---

## Routes

| Route | Method | Auth |
|-------|--------|------|
| `/catalog/skills` | `GET` | optional bearer |
| `/catalog/commands` | `GET` | optional bearer |
| `/catalog/agents` | `GET` | optional bearer |

---

## Success Envelope

All return `{ok: true, data: {skills|commands|agents: [...]}, trace_uuid}`.

---

## `GET /catalog/skills`

```json
{
  "ok": true,
  "data": {
    "skills": [
      {
        "name": "context-assembly",
        "description": "把 initial-context layer / pending layers / session memory 汇合成 LLM prompt",
        "version": "1.0.0",
        "status": "stable"
      },
      {
        "name": "filesystem-host-local",
        "description": "agent 在 host-local 文件系统读写, facade 经 capability seam 中转",
        "version": "1.0.0",
        "status": "stable"
      },
      {
        "name": "bash-tool-call",
        "description": "agent 通过 bash-core 调用受控 capability(`pwd` / `__px_sleep` 等)",
        "version": "1.0.0",
        "status": "stable"
      },
      {
        "name": "permission-gate",
        "description": "permission / elicitation 的 decision storage + wait infra；public WS round-trip 当前未 live，客户端仍走 HTTP decision path",
        "version": "1.0.0-preview",
        "status": "preview"
      }
    ]
  },
  "trace_uuid": "..."
}
```

## `GET /catalog/commands`

```json
{
  "ok": true,
  "data": {
    "commands": [
      {
        "name": "/start",
        "description": "POST /sessions/{id}/start — 启动一个 session",
        "version": "1.0.0",
        "status": "stable"
      },
      {
        "name": "/input",
        "description": "POST /sessions/{id}/input — text-only 后续 turn（/messages 的 text-only alias）",
        "version": "1.0.0",
        "status": "stable"
      },
      {
        "name": "/messages",
        "description": "POST /sessions/{id}/messages — 多模态 message 输入（/input 的超集）",
        "version": "1.0.0-preview",
        "status": "preview"
      },
      {
        "name": "/cancel",
        "description": "POST /sessions/{id}/cancel — 取消当前 turn",
        "version": "1.0.0",
        "status": "stable"
      },
      {
        "name": "/files",
        "description": "GET /sessions/{id}/files — artifact 元数据列表（当前不提供 bytes download）",
        "version": "1.0.0-preview",
        "status": "preview"
      }
    ]
  },
  "trace_uuid": "..."
}
```

## `GET /catalog/agents`

```json
{
  "ok": true,
  "data": {
    "agents": [
      {
        "name": "nano-default",
        "description": "默认 agent profile; mainline LLM + bash-core capability + filesystem host-local",
        "version": "1.0.0",
        "status": "stable"
      },
      {
        "name": "nano-preview-verify",
        "description": "verify 用 agent profile; capability-call / capability-cancel / initial-context / compact / filesystem posture harness",
        "version": "1.0.0",
        "status": "preview"
      }
    ]
  },
  "trace_uuid": "..."
}
```

## Entry Schema

```typescript
interface CatalogEntry {
  name: string;
  description: string;
  version: string;
  status: "stable" | "preview" | "experimental";
}
```

## Behavior

- Registry 从 `catalog-content.ts` 静态加载
- Per-deploy 配置，不依赖数据库
- 后续可改为 D1 / KV / R2 加载，接口形状不变
