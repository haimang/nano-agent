# Models — Catalog + Session Model State

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/facade/routes/` (model routes,模块化后),`workers/orchestrator-core/src/session-truth.ts:421-471, 484-536` (resolveModelForTeam, readSessionModelState)
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
          "function_calling": true
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
    "requested_model_id": "@alias/balanced",
    "resolved_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "resolved_from_alias": true,
    "model": {
      "model_id": "@cf/ibm-granite/granite-4.0-h-micro",
      "family": "workers-ai/granite",
      "display_name": "Granite 4.0 H Micro",
      "context_window": 131072,
      "auto_compact_token_limit": 110000,
      "capabilities": { "reasoning": false, "vision": false, "function_calling": true },
      "supported_reasoning_levels": [],
      "default_reasoning_effort": null,
      "status": "active",
      "aliases": ["@alias/balanced"],
      "base_instructions_suffix": null,
      "fallback_model_id": null
    }
  },
  "trace_uuid": "..."
}
```

`requested_model_id` 是客户端原样传入；`resolved_model_id` 是 alias 解析后的 canonical id；`resolved_from_alias` 表示是否经过 alias 跳转。

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
    "conversation_uuid": "...",
    "session_uuid": "...",
    "session_status": "active",
    "deleted_at": null,
    "default_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "default_reasoning_effort": null,
    "effective_default_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
    "effective_default_reasoning_effort": null,
    "source": "session",
    "last_turn": null
  },
  "trace_uuid": "..."
}
```

字段说明：
- `source` ∈ `{"session", "global"}` — session 有自己的 default 时是 `session`，否则 fall back 到 team-level global default。
- `effective_default_model_id` — 实际生效的 model（session 优先，否则 global）。
- `last_turn` — 最近一次 turn 的 model audit（含 `requested_model_id` / `effective_model_id` / `fallback_used` 等），无历史 turn 时为 `null`。

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 404 | `not-found` | session 不存在 |
| 409 | `session_terminal` | session 已 ended |
| 409 | `session-expired` | session 已过期 |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |

---

## 5. PATCH `/sessions/{id}/model`

设置 / 清除 session default model 与 reasoning effort。

### Request

```json
{
  "model_id": "@alias/reasoning",
  "reasoning": { "effort": "high" }
}
```

或清回 global default：

```json
{ "model_id": null, "reasoning": null }
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `model_id` | no | string \| null | model id 或 alias；`null` 清回 global default。仅当 session 已有 session-level default 时，可省略只 patch `reasoning`。 |
| `reasoning.effort` | no | string \| null | 必须在该 model 的 `supported_reasoning_levels` 内；`null` 清空。形状与 §6 一致。 |

### Success (200)

PATCH 后 server 会重新读取 session model state（与 §4 GET 同型）：

```json
{
  "ok": true,
  "data": {
    "conversation_uuid": "...",
    "session_uuid": "...",
    "session_status": "active",
    "deleted_at": null,
    "default_model_id": "@cf/ibm-foundation/something-reasoning",
    "default_reasoning_effort": "high",
    "effective_default_model_id": "@cf/ibm-foundation/something-reasoning",
    "effective_default_reasoning_effort": "high",
    "source": "session",
    "last_turn": null
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
| 404 | `not-found` | session 或 model 不存在 |
| 409 | `session_terminal` | session 已 ended |
| 409 | `session-expired` | session 已过期 |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |
| 503 | `worker-misconfigured` | `NANO_AGENT_DB` binding 缺失（部署配置错误） |

---

## 6. Reasoning Options

`reasoning` 字段在 `start` / `input` / `messages` body 中可填：

```json
{ "reasoning": { "effort": "high" } }
```

`effort` 必须是该 model 的 `supported_reasoning_levels` 之一（如 `["low", "medium", "high"]`）。
若 model 不支持 reasoning（`supported_reasoning_levels: []`），传 `reasoning` 会被忽略。

---

## 7. Deferred / Readiness Notes

以下能力在 HP9 frozen pack 中**未 live**，客户端不应假设它们存在：

| 能力 | 状态 | 承接 |
|------|------|------|
| `<model_switch>` developer message 注入 | not-started | HP2 后续批次 |
| `model.fallback` stream event | live (HPX5 F4)；turn 关闭时 `fallback_used=true` 才 emit | [`session-ws-v1.md`](./session-ws-v1.md) |
| 跨 turn fallback chain | out-of-scope (Q8 frozen single-step) | n/a |

详见 [`session-ws-v1.md`](./session-ws-v1.md) Stream Events readiness。
