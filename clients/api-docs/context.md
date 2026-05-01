# Context — Probe / Layers / Compact

> Public facade owner: `orchestrator-core` → `context-core` (RPC)
> Implementation reference: `workers/orchestrator-core/src/context-control-plane.ts`，`workers/orchestrator-core/src/index.ts:2380-2492` (context route handlers)，`workers/context-core/src/control-plane.ts`，`workers/context-core/src/index.ts`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖 HP3 context state machine 的对外 surface：probe / layers / snapshot / compact preview / compact job。冻结依据 HPX-Q10 - Q12。

---

## 1. Route Matrix

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/sessions/{id}/context` | legacy alias of `probe` |
| `GET` | `/sessions/{id}/context/probe` | budget / token usage 探测 |
| `GET` | `/sessions/{id}/context/layers` | 已组装的 context layer 预览 |
| `POST` | `/sessions/{id}/context/snapshot` | 持久化 manual context snapshot |
| `POST` | `/sessions/{id}/context/compact/preview` | manual compact 预览（只读） |
| `POST` | `/sessions/{id}/context/compact` | 创建 compact boundary job |
| `GET` | `/sessions/{id}/context/compact/jobs/{jobId}` | 读取 compact job handle |

---

## 2. GET `/sessions/{id}/context/probe`

返回 budget / token usage / fragment 摘要：

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "budget": {
      "context_window": 131072,
      "auto_compact_token_limit": 110000,
      "estimated_used_tokens": 4220,
      "effective_context_pct": 0.032,
      "compact_required": false
    },
    "fragments": {
      "system": { "tokens_estimate": 220 },
      "history": { "messages": 12, "tokens_estimate": 4000 }
    },
    "protected_fragment_kinds": ["model_switch", "state_snapshot"]
  },
  "trace_uuid": "..."
}
```

### `compact_required` 当前 state

`compact_required` 在 HP9 frozen 阶段为 budget 计算结果（基于 `effective_context_pct` 与 `auto_compact_token_limit` 阈值），但 **agent-core runtime 当前不会自动触发 compact**——HP3 closure §2 P2 已显式登记 `auto-compact: not-wired`，`workers/agent-core/src/host/orchestration.ts:296,429` 仍硬编码 `compactRequired: false`。客户端可读 `compact_required` 作为 UI 提示信号，并通过下面的 manual compact 路径主动触发。

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 503 | `context-rpc-unavailable` | context-core RPC 不可达 |

---

## 3. GET `/sessions/{id}/context/layers`

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "layers": [
      { "kind": "system", "tokens_estimate": 220 },
      { "kind": "developer", "tokens_estimate": 12 },
      { "kind": "user_history", "tokens_estimate": 4000 }
    ],
    "canonical_order": ["system", "developer", "user_history", "tool_results", "current_turn"]
  },
  "trace_uuid": "..."
}
```

`canonical_order` 由 `ContextAssembler` 冻结，与 `context-core` probe / control-plane 共享。

---

## 4. POST `/sessions/{id}/context/snapshot`

持久化当前 context 为一个手动 snapshot（不触发 compact）：

```json
{ "label": "before refactor" }
```

返回 `{ snapshot_uuid, created_at }`。

---

## 5. POST `/sessions/{id}/context/compact/preview`

只读预览 compact 会保留 / 删除 / 摘要哪些 fragment：

```json
{ "force": false }
```

Response:

```json
{
  "ok": true,
  "data": {
    "would_create_job_template": {
      "estimated_target_tokens": 12000,
      "estimated_savings": 90000,
      "protected_fragment_kinds": ["model_switch", "state_snapshot"]
    },
    "preview_at": "..."
  },
  "trace_uuid": "..."
}
```

> **Q12 cache 状态**：HPX-Q12 要求"同 session + 同 high-watermark 60s 内复用 cache"，HP9 frozen pack 阶段该 60s preview cache **未实现**（HP3 closure 已登记）。客户端可放心多次调用 preview，server 每次重算；不要假设两次 preview 结果一定相同（model state 变化时会变）。

---

## 6. POST `/sessions/{id}/context/compact`

创建 compact boundary job（实际执行 compact）：

```json
{ "force": false, "preview_uuid": null }
```

Response:

```json
{
  "ok": true,
  "data": {
    "job_uuid": "...",
    "checkpoint_uuid": "...",
    "checkpoint_kind": "compact_boundary",
    "status": "pending"
  },
  "trace_uuid": "..."
}
```

`checkpoint_kind = "compact_boundary"`：HP3 复用 `nano_session_checkpoints` 作为 compact job durable handle（HPX-O2 冻结：不新增 `nano_compact_jobs` 表）。

---

## 7. GET `/sessions/{id}/context/compact/jobs/{jobId}`

读取 compact job 状态：

```json
{
  "ok": true,
  "data": {
    "job_uuid": "...",
    "checkpoint_uuid": "...",
    "status": "succeeded",
    "started_at": "...",
    "ended_at": "...",
    "tokens_freed": 88000
  },
  "trace_uuid": "..."
}
```

`status` ∈ `{pending, running, succeeded, failed, cancelled}`。

---

## 8. WebSocket 信号

详见 [`session-ws-v1.md`](./session-ws-v1.md)。compact 完成时 server 会推：

```json
{ "kind": "event", "name": "session.stream.event", "payload": { "kind": "compact.notify", "...": "..." } }
```

客户端可订阅 `compact.notify` 来在 LLM 完成 compact 后刷新 UI / context probe。

---

## 9. Deferred / Not-Yet-Live

以下能力在 HP9 frozen pack 中**未 live**：

| 能力 | 状态 | 承接 |
|------|------|------|
| auto-compact runtime trigger | not-wired (`compactRequired: false` hardcoded) | HP3 后续批次 |
| `CrossTurnContextManager` runtime owner | not-started-in-runtime | HP3 后续批次 |
| `<model_switch>` / `<state_snapshot>` strip-then-recover | partial（preview marker only） | HP3 后续批次 |
| compact 失败 3 次 circuit breaker | not-wired | HP3 后续批次 |
| 60s preview cache (Q12) | not-implemented | HP3 后续批次 |
