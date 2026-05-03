# Session Hooks API

> Public facade owner: `orchestrator-core` → `agent-core`
> Implementation reference: `workers/orchestrator-core/src/facade/routes/session-hooks.ts`, `workers/agent-core/src/hooks/session-registration.ts`, `workers/agent-core/src/host/runtime-capability.ts`
> Auth: `Authorization: Bearer <access_token>`
> Trace: `x-trace-uuid: <uuid>` 必须发送

PP4 只开放 **session-scoped PreToolUse minimal live loop**。该 surface 用来注册当前 session 的 declarative hook handler，在工具执行前做 block / continue / updateInput；它不是通用插件平台，不开放 shell hook，也不执行用户上传的 JavaScript。

## 1. Readiness

| 能力 | 状态 | 说明 |
|------|------|------|
| `PreToolUse` session hook | `live-minimal` | register/list/unregister + production caller + WS broadcast + audit |
| `updatedInput` | `live-minimal` | 必须是 object，之后继续走原工具 schema |
| `PermissionRequest` hook | `catalog-only / PP5交汇` | fail-closed 语义保持；input mutation 不在 PermissionRequest 发生 |
| `PostToolUse` / 其他 hook catalog | `catalog-only` | 不作为 PP4 live contract |
| shell / arbitrary code hook | `not-supported` | Worker runtime 不 fork/exec；未来若支持需独立 sandbox 设计 |

## 2. Handler Model

当前注册 body 只接受 worker-safe declarative handler：

```json
{
  "id": "block-bash",
  "event": "PreToolUse",
  "source": "session",
  "runtime": "local-ts",
  "matcher": { "type": "toolName", "value": "bash" },
  "timeout_ms": 2000,
  "outcome": {
    "action": "block",
    "reason": "bash is disabled for this session"
  }
}
```

Validation rules:

| 字段 | 规则 |
|------|------|
| `id` | `[a-zA-Z0-9._:-]`，1–96 chars；同 id 注册会 replace |
| `event` | 必须是 `PreToolUse` |
| `source` | 省略时视为 `session`；若提供也必须是 `session` |
| `runtime` | 必须是 `local-ts` |
| `matcher` | 可省略；当前支持按 tool name / glob-like value 匹配 |
| `timeout_ms` / `timeoutMs` | integer `1..10000`；省略默认 `2000` |
| `outcome.action` | `block` / `continue` / `updateInput` |

First-wave declarative limits:

1. 不支持嵌套 condition / if-then-else。
2. 不支持 state-aware multi-stage workflow。
3. 不支持 service-binding / shell / arbitrary JS runtime。
4. 不支持 priority ordering；同事件按当前 registry 顺序聚合。

## 3. Routes

### GET `/sessions/{id}/hooks`

List current session-scoped hook handlers.

Success:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "hooks": [
      {
        "id": "block-bash",
        "event": "PreToolUse",
        "source": "session",
        "runtime": "local-ts",
        "matcher": { "type": "toolName", "value": "bash" },
        "timeout_ms": 2000,
        "outcome": { "action": "block", "reason": "bash is disabled" }
      }
    ]
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### POST `/sessions/{id}/hooks`

Register or replace one handler. The response returns the normalized handler.

Success:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "hook": {
      "id": "block-bash",
      "event": "PreToolUse",
      "source": "session",
      "runtime": "local-ts",
      "timeout_ms": 2000,
      "outcome": { "action": "block", "reason": "bash is disabled" }
    }
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

### DELETE `/sessions/{id}/hooks/{handler_id}`

Unregister a handler. `handler_id` must be URL-encoded if it contains reserved path characters.

Success:

```json
{
  "ok": true,
  "data": {
    "session_uuid": "11111111-1111-4111-8111-111111111111",
    "handler_id": "block-bash",
    "removed": true
  },
  "trace_uuid": "33333333-3333-4333-8333-333333333333"
}
```

## 4. Runtime Effects

`PreToolUse` runs before permission checks, quota authorization, and the tool backend/transport. Outcomes:

| outcome | Runtime effect |
|---------|----------------|
| `block` | tool backend is not called; tool result uses code `hook-blocked`; `hook.outcome` audit is written |
| `continue` | tool input proceeds unchanged unless diagnostics contain an error |
| `updateInput` | equivalent to continue + object `updated_input`; updated input is revalidated by the original tool schema |
| diagnostics error | fail-visible block; runtime returns `hook-blocked` rather than silent continue |
| handler throw | tool result uses code `hook-dispatch-failed` |
| non-object `updated_input` | tool result uses code `hook-invalid-updated-input` |

## 5. WebSocket Visibility

Hook outcomes are visible through `session.stream.event` payload `hook.broadcast`:

```json
{
  "kind": "hook.broadcast",
  "event_name": "PreToolUse",
  "caller": "pre-tool-use",
  "payload_redacted": {
    "tool_name": "bash",
    "tool_input": { "command": "[redacted]" }
  },
  "aggregated_outcome": {
    "finalAction": "block",
    "blocked": true,
    "handlerCount": 1
  }
}
```

`caller` enum:

| caller | Meaning |
|--------|---------|
| `pre-tool-use` | PP4 live production caller before tool execution |
| `step-emit` | generic LLM/runtime `hook_emit` style broadcast; non-blocking |
| omitted | legacy / pre-caller provenance frame |

## 6. Persistence and Versioning

Handlers persist in agent-core tenant-scoped DO storage key `session:hooks:v1`. This is an internal first-wave key, but its version suffix is meaningful: future handler shape changes require either a `v2` key or restore-time migration.

Corrupt persisted hook entries are ignored during restore; registration API still rejects invalid input.

## 7. Errors

| HTTP / Surface | code | Client handling |
|----------------|------|-----------------|
| 400 | `invalid-input` | registration body, handler id, matcher, timeout, or outcome invalid |
| 401 | `invalid-auth` | refresh/login |
| 403 | `missing-team-claim` / `permission-denied` | forbidden / wrong tenant |
| 404 | `not-found` | session missing or not owned |
| 503 | `agent-rpc-unavailable` / `agent-rpc-throw` | retry/backoff and report trace |
| runtime tool result | `hook-blocked` | show blocked reason; do not retry blindly |
| runtime tool result | `hook-invalid-updated-input` | handler authoring bug; fix registration |
| runtime tool result | `hook-dispatch-failed` | handler runtime failure; disable or edit handler |

