# Todos — Session Todo Control Plane（HP6）

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/todo-control-plane.ts`，`workers/orchestrator-core/src/index.ts:1082-1101` (`parseSessionTodoRoute`)
> Migration source: `migrations/010-agentic-loop-todos.sql`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖 HP6 todo control plane：session-scoped TodoWrite-style 任务列表。冻结依据 HPX-Q19 / Q20。

---

## 1. Concept

todo 是一个 **session-scoped** 的命名任务条目，按 5-status 状态机演进，并满足 **at-most-1 in_progress** 不变量（HPX-Q19）。

### 5 Statuses（HPX-Q20 frozen）

| status | 说明 | 终态 |
|--------|------|------|
| `pending` | 创建后默认状态 | 否 |
| `in_progress` | 当前正在处理；session 内**最多 1 个**并发 in_progress | 否 |
| `completed` | 已完成 | 是 |
| `cancelled` | 用户主动取消 | 是 |
| `blocked` | 等待外部条件（用户、上游服务、依赖等） | 否 |

> **at-most-1 in_progress invariant (Q19)**：当 session 已有 todo 在 `in_progress` 时，PATCH 另一个 todo 到 `in_progress` 会返 `409 in-progress-conflict`。客户端应先把当前 in_progress 推到 `completed` / `blocked` / `cancelled`，再启动下一个。

---

## 2. Route Matrix

| Method | Path | 说明 |
|--------|------|------|
| `GET` | `/sessions/{id}/todos` | list（支持 `?status=` 过滤） |
| `POST` | `/sessions/{id}/todos` | 创建 todo（默认 `status=pending`） |
| `PATCH` | `/sessions/{id}/todos/{todo_uuid}` | 修改 status / content |
| `DELETE` | `/sessions/{id}/todos/{todo_uuid}` | 删除 todo |

---

## 3. GET `/sessions/{id}/todos`

### Query

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `status` | enum (5) | (all) | 按 status 过滤 |
| `limit` | number | 50 | |
| `cursor` | string | null | |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "todos": [
      {
        "todo_uuid": "...",
        "session_uuid": "...",
        "content": "implement HP9 docs",
        "status": "in_progress",
        "created_at": "...",
        "updated_at": "..."
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

---

## 4. POST `/sessions/{id}/todos`

### Request

```json
{
  "content": "implement HP9 docs",
  "status": "pending"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `content` | ✅ | string ≤ 500 | todo 描述 |
| `status` | no | enum (5) | 默认 `"pending"`；如设 `"in_progress"` 须满足 at-most-1 invariant |

### Success (201)

```json
{
  "ok": true,
  "data": {
    "todo_uuid": "...",
    "session_uuid": "...",
    "content": "implement HP9 docs",
    "status": "pending",
    "created_at": "..."
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-input` | content 缺失或超长 |
| 400 | `invalid-status` | status 不在 5-status enum |
| 404 | `session-not-found` | session 不存在 |
| 409 | `in-progress-conflict` | session 已有 in_progress todo |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |

---

## 5. PATCH `/sessions/{id}/todos/{todo_uuid}`

### Request

```json
{ "status": "completed" }
```

或修改 content：

```json
{ "content": "updated description" }
```

可同时设置：

```json
{ "status": "in_progress", "content": "..." }
```

### Success (200)

```json
{
  "ok": true,
  "data": {
    "todo_uuid": "...",
    "status": "completed",
    "updated_at": "..."
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-status` | status 非法 |
| 404 | `todo-not-found` | todo UUID 不存在 |
| 409 | `in-progress-conflict` | 切到 in_progress 但已有其他 in_progress |

---

## 6. DELETE `/sessions/{id}/todos/{todo_uuid}`

无 body。删除 todo row。

### Success (200)

```json
{
  "ok": true,
  "data": { "todo_uuid": "...", "deleted": true },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 404 | `todo-not-found` | todo UUID 不存在 |

---

## 7. WebSocket Frames

详见 [`session-ws-v1.md`](./session-ws-v1.md)。HP6 注册的 todo 帧族：

| frame | 方向 | 时机 |
|-------|------|------|
| `session.todos.write` | server → client | row create 时推送 |
| `session.todos.update` | server → client | row update / delete 时推送 |

---

## 8. Frozen Decisions

| Q ID | 内容 | 影响 |
|------|------|------|
| Q19 | at-most-1 in_progress per session | client 切换前必须先 close 上一个 in_progress |
| Q20 | 5-status enum 不允许扩展（V1 flat list） | TodoWrite V2 task graph (O15) 是 hero-to-platform territory |

---

## 9. agent-core WriteTodos Capability

HP6 closure §2 P7 已登记：agent-core 当前**没有** `WriteTodos` capability，LLM 不能直接写 todo。客户端 / 用户必须通过本文件描述的 HTTP 路由创建。HP6 后续批次承接 LLM-side WriteTodos 接线。
