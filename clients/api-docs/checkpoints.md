# Checkpoints — User-Named Registry + Diff + Restore Job Open（HP4 first wave + HP7 substrate）

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/index.ts:1141-1158` (`parseSessionCheckpointRoute`)，`workers/orchestrator-core/src/checkpoint-restore-plane.ts`（HP7 substrate），`workers/orchestrator-core/src/checkpoint-diff-projector.ts`
> Migration source: `migrations/013-product-checkpoints.sql`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖 HP4 first-wave checkpoint registry（list / create / diff）以及 HP7 已接通的 **restore job open** 路由。当前事实是：`POST /sessions/{id}/checkpoints/{checkpoint_uuid}/restore` 已能创建 `pending` restore job；真正的 restore executor、fork executor 与 TTL cleanup 仍是后续批次。

---

## 1. Concept

| 概念 | 说明 |
|------|------|
| **product checkpoint** | 用户命名的对话锚点；可 list / create / diff，且现在可打开 restore job |
| `compact_boundary` checkpoint | HP3 compact job 创建的内部锚点；当前 public list 不区分过滤参数，直接返回 session 下现有 registry row |
| `user_named` checkpoint | 用户主动 `POST .../checkpoints` 创建 |
| `system` checkpoint | 系统 lifecycle 触发的锚点（会话 start / restart） |
| **snapshot status** | `none / pending / materialized / failed`（4 级 enum，HP7 frozen） |
| **restore mode** | `conversation_only / files_only / conversation_and_files / fork`（4 模式，HP7 frozen） |
| **restore status** | `pending / running / succeeded / partial / failed / rolled_back`（6 级 enum） |

---

## 2. GET `/sessions/{id}/checkpoints`

列出当前 session 的产品级 checkpoint registry。

### Success (200)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "checkpoints": [
      {
        "checkpoint_uuid": "...",
        "session_uuid": "...",
        "conversation_uuid": "...",
        "team_uuid": "...",
        "turn_uuid": "...",
        "turn_attempt": 1,
        "checkpoint_kind": "user_named",
        "label": "before refactor",
        "message_high_watermark": "...",
        "latest_event_seq": 12,
        "context_snapshot_uuid": null,
        "created_at": "...",
        "file_snapshot_status": "none",
        "created_by": "user",
        "expires_at": null
      }
    ]
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 404 | `not-found` | session 不存在 |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |

---

## 3. POST `/sessions/{id}/checkpoints`

创建一个 `user_named` checkpoint。

### Request

```json
{
  "label": "before refactor"
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `label` | no | string ≤ 200 | 用户可见命名；省略时写 `null` |

### Success (201)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "checkpoint": {
      "checkpoint_uuid": "...",
      "checkpoint_kind": "user_named",
      "label": "before refactor",
      "message_high_watermark": "...",
      "latest_event_seq": 12,
      "file_snapshot_status": "none",
      "created_at": "..."
    }
  },
  "trace_uuid": "..."
}
```

当前 public `POST /checkpoints` 只创建 registry row；`snapshot_files` 开关没有暴露到 facade body。

### File Snapshot Policy（substrate frozen）

| `checkpoint_kind` | snapshot 触发 | 默认 status |
|-------------------|---------------|-------------|
| `user_named` | `eager_with_fallback`（snapshot 失败时降级为 `pending`，供后续 restore 重试） | `pending` → `materialized` |
| `system` | `lazy` | `none` |
| `compact_boundary` | `lazy` | `none` |

---

## 4. GET `/sessions/{id}/checkpoints/{checkpoint_uuid}/diff`

返回 checkpoint 与当前 session message ledger 的 diff。当前 public facade 仍是 **message-only projection**；workspace / artifact delta projector 还没有接到这个 route。

### Success (200)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "diff": {
      "checkpoint": {
        "checkpoint_uuid": "...",
        "checkpoint_kind": "user_named"
      },
      "watermark_created_at": "...",
      "messages_since_checkpoint": [
        {
          "message_uuid": "...",
          "turn_uuid": "...",
          "message_kind": "assistant.message",
          "created_at": "...",
          "superseded_at": null
        }
      ],
      "superseded_messages": [
        {
          "message_uuid": "...",
          "turn_uuid": "...",
          "message_kind": "assistant.message",
          "created_at": "...",
          "superseded_at": "...",
          "superseded_by_turn_attempt": 2
        }
      ]
    }
  },
  "trace_uuid": "..."
}
```

---

## 5. POST `/sessions/{id}/checkpoints/{checkpoint_uuid}/restore`

打开一个 `pending` restore job。当前阶段只做 **job open + confirmation gate**；真正的 restore executor 仍未 live。

### Request

```json
{
  "mode": "conversation_only",
  "confirmation_uuid": "..."
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `mode` | ✅ | `conversation_only \| files_only \| conversation_and_files` | public restore 现阶段不接受 `fork` |
| `confirmation_uuid` | ✅ | UUID | 必须指向同 session 下、`kind=checkpoint_restore` 且 `status=pending` 的 confirmation row |

### Success (202)

```json
{
  "ok": true,
  "data": {
    "session_uuid": "...",
    "conversation_uuid": "...",
    "checkpoint": {
      "checkpoint_uuid": "..."
    },
    "restore_job": {
      "job_uuid": "...",
      "checkpoint_uuid": "...",
      "session_uuid": "...",
      "mode": "conversation_only",
      "target_session_uuid": null,
      "status": "pending",
      "confirmation_uuid": "...",
      "started_at": null,
      "completed_at": null,
      "failure_reason": null
    }
  },
  "trace_uuid": "..."
}
```

---

## 6. Fork + Executor State

- `D1CheckpointSnapshotPlane` — snapshot lineage truth (`workers/orchestrator-core/src/checkpoint-restore-plane.ts`)
- `D1CheckpointRestoreJobs` — restore job state machine (`workers/orchestrator-core/src/checkpoint-restore-plane.ts:376-531`)
- `buildCheckpointSnapshotR2Key` / `buildForkWorkspaceR2Key` — R2 key law

当前仍未完成的部分：

- restore executor（job `pending -> running -> terminal`）
- `POST /sessions/{id}/fork`
- TTL cleanup cron

### 客户端规划

- `POST /sessions/{id}/checkpoints/{uuid}/restore` 现已可用，但返回的是 **restore job accepted**，不是 restore completed。
- 不要假设 `POST /sessions/{id}/fork` 已存在；fork 仍未暴露 public route。
- `session.fork.created` server→client WS 帧已**注册** schema（详见 [`session-ws-v1.md`](./session-ws-v1.md)），但当前不会被 emit。

冻结决策：

| Q ID | 内容 | 影响 |
|------|------|------|
| Q22 | file snapshot policy by kind | `user_named` eager / 其他 lazy |
| Q23 | fork = same conversation only | 不允许跨 conversation fork |
| Q24 | restore failure → rollback baseline | 非 success 终态必填 `failure_reason` |

---

## 7. Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-input` | label / restore body 不合法 |
| 404 | `not-found` | session / checkpoint / confirmation UUID 不存在 |
| 409 | `confirmation-already-resolved` | restore confirmation 已不是 `pending` |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |
| 503 | `internal-error` | upstream worker 不可达 |

详见 [`error-index.md`](./error-index.md)。
