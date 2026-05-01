# Models — Catalog + Session Model State

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/index.ts:2136-2331` (model routes)，`workers/orchestrator-core/src/session-truth.ts:421-471, 484-536` (resolveModelForTeam, readSessionModelState)
> Migration source: `migrations/007-model-metadata-and-aliases.sql`，`migrations/008-session-model-audit.sql`，`migrations/014-session-model-fallback-reason.sql`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖 HP2 model state machine 的对外 surface：catalog list/detail + session current-model control plane。

---

## 1. Model State Machine 概览（HPX-Q7 - Q9 frozen）

模型选择遵循 4 层链：

```text
turn override (per-message model_id) ─┐
                                      ├──▶ effective_model_id
session default (PATCH /sessions/{id}/model) ─┤
                                      │
global team default (D1 nano_models)  ─┘
```

- **turn override** 优先级最高：`POST /sessions/{id}/input | messages | start` body 中的 `model_id`。
- **session default**：`PATCH /sessions/{id}/model` 写入 `nano_conversation_sessions.default_model_id`。
- **global default**：team 当前的 `nano_team_model_policy` 默认项。
- **fallback**：HPX-Q8 冻结为 single-step（不允许 fallback chain）；fallback 触发时 `nano_conversation_sessions.fallback_used = 1` + `fallback_reason` 写入。

每个 turn 在 `nano_conversation_turns` 表中记录 `requested_model_id` + `effective_model_id` + `fallback_used` + `fallback_reason` 用于审计。

---

## 2. GET `/models`

team-scoped catalog 列表，带 D1 ETag。

### Request

```http
GET /models
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
If-None-Match: "<etag>"
```

### Success (200)

```json
{
  "ok": true,
  "data": {
    "models": [
      {
        "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
        "family": "workers-ai/granite",
        "display_name": "Granite 4.0 H Micro",
        "context_window": 131072,
        "auto_compact_token_limit": 110000,
        "capabilities": {
          "reasoning": false,
          "vision": false,
          "function_calling": true,
          "tool_use": true
        },
        "supported_reasoning_levels": [],
        "default_reasoning_effort": null,
        "status": "active",
        "aliases": ["@alias/balanced"]
      }
    ]
  },
  "trace_uuid": "..."
}
```

### Not Modified (304)

`If-None-Match` 命中时返回 `304`，body 为空。

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 401 | `invalid-auth` | bearer 无效 |
| 503 | `models-d1-unavailable` | D1 catalog 读取失败 |

---

## 3. GET `/models/{modelIdOrAlias}`

返回单 model 的完整 metadata。`modelIdOrAlias` 支持：

- canonical id（urlencode 后）：`@cf%2Fibm-granite%2Fgranite-4.0-h-micro`
- alias：`@alias/balanced`

### Success (200)

```json
{
  "ok": true,
  "data": {
    "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "family": "workers-ai/granite",
    "display_name": "Granite 4.0 H Micro",
    "context_window": 131072,
    "auto_compact_token_limit": 110000,
    "capabilities": { "reasoning": false, "vision": false, "function_calling": true, "tool_use": true },
    "supported_reasoning_levels": [],
    "default_reasoning_effort": null,
    "status": "active",
    "aliases": ["@alias/balanced"],
    "base_instructions_suffix": null,
    "fallback_model_id": null
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `model-unavailable` | model `status != active` |
| 403 | `model-disabled` | team policy 拒绝 |
| 404 | `not-found` | model id / alias 无对应行 |

---

## 4. GET `/sessions/{id}/model`

session current-model control plane view（HP2 first wave）。

### Success (200)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "default_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "default_reasoning_effort": null,
    "global_default_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "effective_default_source": "session",
    "model": {
      "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
      "display_name": "Granite 4.0 H Micro",
      "...": "..."
    }
  },
  "trace_uuid": "..."
}
```

`effective_default_source` ∈ `{"session", "global"}`。当 session 没有自己的 default 时为 `"global"`。

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 404 | `session-not-found` | session 不存在 |
| 409 | `session_terminal` | session 已 ended/expired |

---

## 5. PATCH `/sessions/{id}/model`

设置 / 清除 session default model 与 reasoning effort。

### Request

```json
{
  "model_id": "@alias/reasoning",
  "reasoning_effort": "high"
}
```

或清回 global default：

```json
{ "model_id": null, "reasoning_effort": null }
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `model_id` | ✅ | string \| null | model id 或 alias；`null` 清回 global default |
| `reasoning_effort` | no | string \| null | 必须在该 model 的 `supported_reasoning_levels` 内；`null` 清空 |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "default_model_id": "@cf/ibm-foundation/something-reasoning",
    "default_reasoning_effort": "high",
    "model": { "...": "..." }
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-input` | body 不匹配 |
| 400 | `model-unavailable` | model `status != active` |
| 403 | `model-disabled` | team policy 拒绝 |
| 404 | `session-not-found` / `not-found` | session 或 model 不存在 |
| 409 | `session_terminal` / `session-expired` | session 已 ended |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |

---

## 6. Reasoning Options

`reasoning` 字段在 `start` / `input` / `messages` body 中可填：

```json
{ "reasoning": { "effort": "high" } }
```

`effort` 必须是该 model 的 `supported_reasoning_levels` 之一（如 `["low", "medium", "high"]`）。
若 model 不支持 reasoning（`supported_reasoning_levels: []`），传 `reasoning` 会被忽略。

---

## 7. Deferred / Not-Yet-Live

以下能力在 HP9 frozen pack 中**未 live**，客户端不应假设它们存在：

| 能力 | 状态 | 承接 |
|------|------|------|
| `<model_switch>` developer message 注入 | not-started | HP2 后续批次 |
| `model.fallback` stream event | not-started | HP2 后续批次 |
| 跨 turn fallback chain | out-of-scope (Q8 frozen single-step) | n/a |

详见 [`session-ws-v1.md`](./session-ws-v1.md) Stream Events readiness。
