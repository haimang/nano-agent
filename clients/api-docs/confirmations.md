# Confirmations — Unified Control Plane（HP5）

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/confirmation-control-plane.ts:89-260`,`workers/orchestrator-core/src/facade/routes/session-control.ts:36-39, 320-442` (confirmation route parser + decision handler + HPX5 F1 emit)
> Migration source: `migrations/012-session-confirmations.sql`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖 HP5 confirmation control plane。当前真实状态是：`tool_permission` 与 `elicitation` 已有 live caller；其余 5 种 kind 已 schema-frozen，并可通过统一 detail / decision / restore-gate surface 被读取或消费。

---

## 1. Concept — 7-Kind × 6-Status

confirmation 的统一字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `confirmation_uuid` | UUID | row UUID（也是 request_uuid） |
| `kind` | enum (7) | confirmation 类型 |
| `status` | enum (6) | 当前状态 |
| `created_at` / `decided_at` | ISO ts | |
| `payload` | object | kind 专属 metadata |
| `decision_payload` | object \| null | 终态 decision metadata |

### 7 Kinds（HPX-Q18 frozen，不允许扩展）

| kind | 说明 | live status |
|------|------|-------------|
| `tool_permission` | 工具调用 permission（替代 legacy `/permission/decision`） | **live** dual-write 兼容 legacy 路径 |
| `elicitation` | LLM 主动询问用户（替代 legacy `/elicitation/answer`） | **live** dual-write 兼容 legacy 路径 |
| `model_switch` | 用户切换 model 时的二次确认 | **registry-only** |
| `context_compact` | manual compact / context shrink 前的确认 | **registry-only** |
| `fallback_model` | fallback 前的人机确认 | **registry-only** |
| `checkpoint_restore` | 触发 restore 前确认 | **restore gate live；emitter 仍待接通** |
| `context_loss` | context loss / replay loss 之类破坏性提示确认 | **registry-only** |

`registry-only` 表示：schema 已冻结、`POST .../decision` 路由可接受，但 emitter 侧不会主动创建 row（HP5 后续批次接 emitter caller）。

### 6 Statuses（HPX-Q16 frozen）

| status | 说明 |
|--------|------|
| `pending` | 等待用户决策 |
| `allowed` | 用户 approve |
| `denied` | 用户 reject |
| `modified` | 用户给出修改后的答案（elicitation 用） |
| `timeout` | 等待超时（runtime 决定） |
| `superseded` | 因新 request 或 dual-write 失败被替代；**永远不写 `failed`**（Q16 row-first law） |

> **HPX-Q16 法律重申**：confirmation row 是 truth；dual-write RPC 失败时 row 升级为 `superseded`，**绝不**写 `failed`。

---

## 2. GET `/sessions/{id}/confirmations`

列出当前 session 的 confirmation。

### Query

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `status` | enum | (all) | 按 status 过滤；支持 `any` |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "confirmations": [
      {
        "confirmation_uuid": "...",
        "session_uuid": "...",
        "kind": "tool_permission",
        "status": "pending",
        "created_at": "...",
        "payload": {
          "tool_name": "bash",
          "tool_input": { "command": "ls" }
        },
        "decision_payload": null,
        "decided_at": null,
        "expires_at": null
      }
    ],
    "known_kinds": [
      "tool_permission",
      "elicitation",
      "model_switch",
      "context_compact",
      "fallback_model",
      "checkpoint_restore",
      "context_loss"
    ]
  },
  "trace_uuid": "..."
}
```

---

## 3. GET `/sessions/{id}/confirmations/{confirmation_uuid}`

读取单个 confirmation 的完整状态。

### Success (200)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "confirmation": {
      "confirmation_uuid": "...",
      "kind": "elicitation",
      "status": "pending",
      "created_at": "...",
      "decided_at": null,
      "payload": {
        "question": "Which library should I use?",
        "suggested_answers": ["pandas", "polars"]
      },
      "decision_payload": null
    }
  },
  "trace_uuid": "..."
}
```

---

## 4. POST `/sessions/{id}/confirmations/{confirmation_uuid}/decision`

提交 decision；推动 row 进入终态。

### Request

```json
{
  "status": "modified",
  "decision_payload": { "answer": "pandas" }
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `status` | ✅ | `allowed \| denied \| modified \| timeout \| superseded` | 写入 confirmation 终态 |
| `decision_payload` | no | object | kind 专属 decision payload（如 elicitation answer） |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "confirmation": {
      "confirmation_uuid": "...",
      "kind": "elicitation",
      "status": "modified",
      "decision_payload": { "answer": "pandas" }
    }
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-input` | status 不在 enum 内，或 `decision_payload` 不是 object |
| 404 | `not-found` | confirmation UUID 不存在 |
| **409** | **`confirmation-already-resolved`** | row 已是终态；视为最终态成功，**不要重试**（Q16 invariant） |
| 503 | `internal-error` | upstream RPC 不可达 |

---

## 5. WebSocket Frames

详见 [`session-ws-v1.md`](./session-ws-v1.md)。当前这些帧是 **schema registered / emitter pending**：

| frame | 时机 |
|-------|------|
| `session.confirmation.request` | confirmation row 创建时的目标帧形状 |
| `session.confirmation.update` | confirmation row 变化时的目标帧形状 |

> client → server 没有对应的 confirmation 输入帧；提交 decision **必须**用 HTTP `POST .../decision`。这是 HPX-Q18 frozen direction matrix。

---

## 6. Migration from Legacy

详见 [`permissions.md`](./permissions.md) §6。Legacy `/permission/decision` 与 `/elicitation/answer` 路径保留为 compat alias，dual-write 到 confirmation row。优先用 confirmations 统一面：

| 现在 (legacy) | 推荐 (HP5 unified) |
|---------------|-------------------|
| `POST /permission/decision { request_uuid, decision: "allow" }` | `POST /confirmations/{uuid}/decision { status: "allowed" }` |
| `POST /elicitation/answer { request_uuid, answer }` | `POST /confirmations/{uuid}/decision { status: "modified", decision_payload: { answer } }` |
| `session.permission.request` WS frame | `session.confirmation.request{confirmation_kind: "tool_permission"}` |
| `session.elicitation.request` WS frame | `session.confirmation.request{kind: "elicitation"}` |

---

## 7. Frozen Decisions

| Q ID | 内容 | 影响 |
|------|------|------|
| Q16 | row-first dual-write，`failed` → `superseded` | 客户端遇 `409 confirmation-already-resolved` 视为终态成功 |
| Q17 | kernel `approval_pending` → `confirmation_pending` 重命名 | 内部状态机用 `confirmation_pending`；不影响外部 API |
| Q18 | confirmation frame direction = server-only | 客户端不能 push confirmation 到 server，必须 HTTP `POST /decision` |
