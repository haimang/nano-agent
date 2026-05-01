# Confirmations — Unified Control Plane（HP5）

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/confirmation-control-plane.ts`，`workers/orchestrator-core/src/index.ts:1103-1133, 1404-1536` (confirmation routes)
> Migration source: `migrations/012-session-confirmations.sql`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖 HP5 confirmation control plane：**统一收拢 permission / elicitation / 工具暂停 / checkpoint restore / model_switch 等所有需要用户确认的场景**。冻结依据 HPX-Q16 / Q17 / Q18。

---

## 1. Concept — 7-Kind × 6-Status

confirmation 的统一字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `confirmation_uuid` | UUID | row UUID（也是 request_uuid） |
| `kind` | enum (7) | confirmation 类型 |
| `status` | enum (6) | 当前状态 |
| `created_at` / `updated_at` | ISO ts | |
| `requested_by` | string | runtime origin (e.g. `tool.PreToolUse`，`compact.preview`) |
| `payload` | object | kind 专属 metadata |
| `decision` | object \| null | 终态 decision metadata |

### 7 Kinds（HPX-Q18 frozen，不允许扩展）

| kind | 说明 | live status |
|------|------|-------------|
| `permission` | 工具调用 permission（替代 legacy `/permission/decision`） | **live** dual-write 兼容 legacy 路径 |
| `elicitation` | LLM 主动询问用户（替代 legacy `/elicitation/answer`） | **live** dual-write 兼容 legacy 路径 |
| `tool_pause` | 工具显式暂停等待 | **registry-only**（emitter 侧 row-create 未接通；HP5 closure §2 P1） |
| `model_switch` | 用户切换 model 时的二次确认 | **registry-only** |
| `checkpoint_restore` | 触发 restore 前确认 | **registry-only**（HP7 restore executor 未 live） |
| `fork` | session fork 前确认 | **registry-only**（HP7 fork executor 未 live） |
| `compact_boundary` | manual compact 前的预览确认 | **registry-only** |

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
| `status` | enum | (all) | 按 status 过滤；常用 `?status=pending` |
| `kind` | enum | (all) | 按 kind 过滤 |
| `limit` | number | 20 | |
| `cursor` | string | null | |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "confirmations": [
      {
        "confirmation_uuid": "...",
        "kind": "permission",
        "status": "pending",
        "created_at": "...",
        "requested_by": "tool.PreToolUse",
        "payload": {
          "tool_name": "bash",
          "tool_input": { "command": "ls" }
        }
      }
    ],
    "next_cursor": null
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
    "confirmation_uuid": "...",
    "kind": "elicitation",
    "status": "pending",
    "created_at": "...",
    "updated_at": "...",
    "requested_by": "llm.elicitation",
    "payload": {
      "question": "Which library should I use?",
      "suggested_answers": ["pandas", "polars"]
    },
    "decision": null
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
  "decision": "allowed",
  "scope": "once",
  "reason": "user approved",
  "payload": { "answer": "pandas" }
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `decision` | ✅ | `"allowed" \| "denied" \| "modified" \| "always_allow" \| "always_deny"` | 用户决定 |
| `scope` | no | string | 默认 `"once"`；`"always_allow"` / `"always_deny"` 时通常带 `"forever"` |
| `reason` | no | string | 用户原因（透传到 row `decision_meta`） |
| `payload` | no | object | kind 专属 decision payload（如 elicitation answer） |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "confirmation_uuid": "...",
    "kind": "elicitation",
    "status": "modified",
    "decision": { "decision": "modified", "payload": { "answer": "pandas" } }
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-input` | decision 不在 enum 内 |
| 404 | `confirmation-not-found` | UUID 不存在 |
| **409** | **`confirmation-already-resolved`** | row 已是终态；视为最终态成功，**不要重试**（Q16 invariant） |
| 503 | `internal-error` | upstream RPC 不可达 |

---

## 5. WebSocket Frames

详见 [`session-ws-v1.md`](./session-ws-v1.md)。HP5 已 live 的 server→client 帧：

| frame | 时机 |
|-------|------|
| `session.confirmation.request` | row create 时；推送给 attached client，附带 `confirmation_uuid / kind / payload` |
| `session.confirmation.update` | row decision 写入或 status 变化时 |

> client → server 没有对应的 confirmation 输入帧；提交 decision **必须**用 HTTP `POST .../decision`。这是 HPX-Q18 frozen direction matrix。

---

## 6. Migration from Legacy

详见 [`permissions.md`](./permissions.md) §6。Legacy `/permission/decision` 与 `/elicitation/answer` 路径保留为 compat alias，dual-write 到 confirmation row。优先用 confirmations 统一面：

| 现在 (legacy) | 推荐 (HP5 unified) |
|---------------|-------------------|
| `POST /permission/decision { request_uuid, decision: "allow" }` | `POST /confirmations/{uuid}/decision { decision: "allowed" }` |
| `POST /elicitation/answer { request_uuid, answer }` | `POST /confirmations/{uuid}/decision { decision: "modified", payload: { answer } }` |
| `session.permission.request` WS frame | `session.confirmation.request{kind: "permission"}` |
| `session.elicitation.request` WS frame | `session.confirmation.request{kind: "elicitation"}` |

---

## 7. Frozen Decisions

| Q ID | 内容 | 影响 |
|------|------|------|
| Q16 | row-first dual-write，`failed` → `superseded` | 客户端遇 `409 confirmation-already-resolved` 视为终态成功 |
| Q17 | kernel `approval_pending` → `confirmation_pending` 重命名 | 内部状态机用 `confirmation_pending`；不影响外部 API |
| Q18 | confirmation frame direction = server-only | 客户端不能 push confirmation 到 server，必须 HTTP `POST /decision` |
