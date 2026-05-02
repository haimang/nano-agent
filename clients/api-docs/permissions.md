# Permissions / Elicitation Legacy Compat Surface

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/user-do/surface-runtime.ts:84-160` (`ensureConfirmationDecision` + emit hook),`workers/orchestrator-core/src/facade/routes/session-control.ts:381-442` (confirmation decision route + emit)
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`
>
> **HPX6 事实**：permission / elicitation 决策仍保留 legacy alias，并统一写入 `nano_session_confirmations` 真值表（HPX-Q16 / Q17 row-first dual-write law）。legacy `POST /sessions/{id}/policy/permission_mode` 已 hard-delete；session runtime control 改用 [`runtime.md`](./runtime.md) 的 `GET/PATCH /sessions/{id}/runtime`。

---

## 1. Route Overview

| Route | Method | Auth | 角色 |
|-------|--------|------|------|
| `/sessions/{id}/permission/decision` | `POST` | bearer | legacy permission decision; dual-write 到 confirmations |
| `/sessions/{id}/policy/permission_mode` | `POST` | bearer | **removed in HPX6**；固定 unknown route / 404 |
| `/sessions/{id}/elicitation/answer` | `POST` | bearer | legacy elicitation answer; dual-write 到 confirmations |

> **`session.permission.request` / `session.elicitation.request` 现状**：HP5 把 permission / elicitation 折叠到统一的 `session.confirmation.request` / `session.confirmation.update` server→client 帧族（详见 [`session-ws-v1.md`](./session-ws-v1.md) 与 [`confirmations.md`](./confirmations.md)）。legacy `session.permission.request` / `session.elicitation.request` server→client 帧不再发出。客户端如果想监听 permission ask，应订阅 `session.confirmation.request{confirmation_kind: "tool_permission"}` 帧。

---

## 2. HP5 Row-First Dual-Write Law（HPX-Q16）

提交 legacy `permission/decision` 或 `elicitation/answer` 时，server 行为：

1. **先**在 `nano_session_confirmations` 表上 row-first 创建/查找对应 confirmation row（kind = `tool_permission` 或 `elicitation`，status `pending`）；
2. 调用 `D1ConfirmationControlPlane.applyDecision()` 把 decision 写入 row（status 推进为 `allowed`/`denied`/`modified`）；
3. 仅当 row write 成功后，才 best-effort forward 到 agent-core `permissionDecision` / `elicitationAnswer` RPC；
4. 若 dual-write 在 RPC 阶段失败，row status 推进为 `superseded`（**绝不**写 `failed`，因为 row 是 truth）。

冻结依据：HPX-Q16（row-first dual-write，never `failed`，escalate to `superseded`）+ HPX-Q17（`approval_pending` → `confirmation_pending` kernel rename）。

---

## 3. POST `/sessions/{id}/permission/decision`

### Request

```http
POST /sessions/{sessionUuid}/permission/decision
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: application/json

{
  "request_uuid": "aaaa...",
  "decision": "allow",
  "scope": "once",
  "reason": "user approved"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `request_uuid` | ✅ | UUID | permission request UUID（也是 confirmation row UUID） |
| `decision` | ✅ | `"allow" \| "deny" \| "always_allow" \| "always_deny"` | 决定 |
| `scope` | no | string | 默认 `"once"` |
| `reason` | no | string | user reason；透传到 confirmation row `decision_meta` |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "request_uuid": "aaaa...",
    "decision": "allow",
    "scope": "once",
    "confirmation_uuid": "aaaa...",
    "confirmation_status": "allowed"
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 触发 |
|------|------|------|
| 400 | `invalid-input` | `request_uuid` 非 UUID 或 `decision` 非法 |
| 401 | `invalid-auth` | bearer 无效 |
| 403 | `missing-team-claim` | JWT 缺 team truth |
| 409 | `confirmation-already-resolved` | 该 request_uuid 已被先前的 decision 终结（HP5 invariant） |

> **HP5 row-first dual-write 行为说明**：facade 收到请求后**先**插入/更新 D1 confirmation row，**再** best-effort 触发 KV + RPC fallback。  
> - row 之前不存在 → auto-create（**不**返回 404 `confirmation-not-found`，文档以前列出此 code 是误导，已移除）。  
> - KV / RPC 失败 → silently log，不影响 200 响应（**不**返回 503 `internal-error`，因为 row 已写成，从客户端视角是终态成功）。  
> - confirmation row 是 single source of truth；客户端可信任 200 响应代表 D1 已落地。  
> - `409 confirmation-already-resolved` 是统一 confirmation plane 的冲突 code；legacy 客户端遇到 409 应**视为最终态成功**，不要重试。

---

## 4. Removed: POST `/sessions/{id}/policy/permission_mode`

HPX6 Q-bridging-7 决议为 hard delete，不提供 dual-write 兼容窗口。客户端必须迁移到：

- `GET /sessions/{id}/runtime` 读取当前 `approval_policy` 与 `permission_rules`
- `PATCH /sessions/{id}/runtime` 修改 `approval_policy` 或 session-scoped rule
- `session.runtime.update` WS frame 接收变更广播

旧路由不会写 `permission_mode/*` KV，也不会 forward 到 User DO。

---

## 5. POST `/sessions/{id}/elicitation/answer`

### Request

```json
{
  "request_uuid": "bbbb...",
  "answer": "use pandas"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `request_uuid` | ✅ | UUID | elicitation request UUID（也是 confirmation row UUID） |
| `answer` | ✅ | any | 回答内容；透传到 confirmation row |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "request_uuid": "bbbb...",
    "answer": "use pandas",
    "confirmation_uuid": "bbbb...",
    "confirmation_status": "modified"
  },
  "trace_uuid": "..."
}
```

### Errors

同 §3，外加：`409 confirmation-already-resolved` 表示先前 answer 已落 row。

---

## 6. Migration Path

| 现在 | 目标（推荐） |
|------|-----|
| `POST /sessions/{id}/permission/decision` | `POST /sessions/{id}/confirmations/{uuid}/decision { status: "allowed" }` |
| `POST /sessions/{id}/elicitation/answer` | `POST /sessions/{id}/confirmations/{uuid}/decision { status: "modified", decision_payload: {answer} }` |
| 监听 `session.permission.request` WS 帧 | 监听 `session.confirmation.request{confirmation_kind: "tool_permission"}` WS 帧 |
| 监听 `session.elicitation.request` WS 帧 | 监听 `session.confirmation.request{confirmation_kind: "elicitation"}` WS 帧 |

详见 [`confirmations.md`](./confirmations.md)。Legacy 路径在 hero-to-pro 阶段保留（HPX-O6 不物理删除 legacy endpoint），未来由 hero-to-platform 阶段决定 deprecation timeline。
