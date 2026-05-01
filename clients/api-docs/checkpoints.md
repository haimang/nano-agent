# Checkpoints — User-Named Registry + Diff（HP4 first wave + HP7 substrate）

> Public facade owner: `orchestrator-core`
> Implementation reference: `workers/orchestrator-core/src/index.ts:1141-1158` (`parseSessionCheckpointRoute`)，`workers/orchestrator-core/src/checkpoint-restore-plane.ts`（HP7 substrate），`workers/orchestrator-core/src/checkpoint-diff-projector.ts`
> Migration source: `migrations/013-product-checkpoints.sql`
> Profile: `facade-http-v1`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖 HP4 first-wave checkpoint registry（list / create / diff）。HP7 已落地 restore / fork / TTL substrate（snapshot lineage、restore job state machine、diff projector 三层 delta），但 **public restore / fork 路由 HP9 frozen pack 阶段尚未 live**——HP7 closure §2 已登记为 deferred batch。

---

## 1. Concept

| 概念 | 说明 |
|------|------|
| **product checkpoint** | 用户命名的对话锚点；可 list / create / diff，未来可 restore |
| `compact_boundary` checkpoint | HP3 compact job 创建的内部锚点；不在用户 list 中（除非 `?include_compact=true`） |
| `user_named` checkpoint | 用户主动 `POST .../checkpoints` 创建 |
| `system` checkpoint | 系统 lifecycle 触发的锚点（会话 start / restart） |
| **snapshot status** | `none / pending / materialized / failed`（4 级 enum，HP7 frozen） |
| **restore mode** | `conversation_only / files_only / conversation_and_files / fork`（4 模式，HP7 frozen） |
| **restore status** | `pending / running / succeeded / partial / failed / rolled_back`（6 级 enum） |

---

## 2. GET `/sessions/{id}/checkpoints`

列出当前 session 的产品级 checkpoint registry。

### Query

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `limit` | number | 20 | 每页条数 |
| `cursor` | string | null | pagination cursor |
| `include_compact` | bool | false | 是否包含 `compact_boundary` 内部锚点 |

### Success (200)

```json
{
  "ok": true,
  "data": {
    "checkpoints": [
      {
        "checkpoint_uuid": "...",
        "checkpoint_kind": "user_named",
        "label": "before refactor",
        "created_at": "...",
        "anchor_message_seq": 12,
        "file_snapshot_status": "none"
      },
      {
        "checkpoint_uuid": "...",
        "checkpoint_kind": "compact_boundary",
        "label": null,
        "created_at": "...",
        "anchor_message_seq": 8,
        "file_snapshot_status": "materialized"
      }
    ],
    "next_cursor": null
  },
  "trace_uuid": "..."
}
```

### Errors

| HTTP | code | 说明 |
|------|------|------|
| 404 | `session-not-found` | session 不存在 |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |

---

## 3. POST `/sessions/{id}/checkpoints`

创建一个 `user_named` checkpoint。

### Request

```json
{
  "label": "before refactor",
  "snapshot_files": false
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `label` | ✅ | string ≤ 200 | 用户可见的命名 |
| `snapshot_files` | no | bool | `true` 时立即 eager 触发 file snapshot；默认 `false`（lazy 策略，Q22） |

### Success (201)

```json
{
  "ok": true,
  "data": {
    "checkpoint_uuid": "...",
    "checkpoint_kind": "user_named",
    "label": "before refactor",
    "anchor_message_seq": 12,
    "file_snapshot_status": "none",
    "created_at": "..."
  },
  "trace_uuid": "..."
}
```

### File Snapshot Policy（HPX-Q22 frozen）

| `checkpoint_kind` | snapshot 触发 | 默认 status |
|-------------------|---------------|-------------|
| `user_named` | `eager_with_fallback`（snapshot 失败时降级为 `none` + lazy） | `pending` → `materialized` |
| `system` | `lazy` | `none` |
| `compact_boundary` | `lazy` | `none` |

`snapshot_files: false` 强制 lazy；snapshot 在用户首次 restore 时再 materialize。

---

## 4. GET `/sessions/{id}/checkpoints/{checkpoint_uuid}/diff`

返回 checkpoint 与当前 session ledger 的 diff。HP7 已扩展为三层（message / workspace / artifact）。

### Success (200)

```json
{
  "ok": true,
  "data": {
    "checkpoint_uuid": "...",
    "anchor_message_seq": 12,
    "current_message_seq": 38,
    "diff": {
      "messages": {
        "added_after_anchor": 26,
        "superseded_count": 2
      },
      "workspace": {
        "added": ["src/new-file.ts"],
        "removed": [],
        "changed": ["src/existing.ts"]
      },
      "artifacts": {
        "promoted_after_anchor": 1,
        "added": ["screenshot.png"]
      }
    }
  },
  "trace_uuid": "..."
}
```

`workspace.changed` 用 `content_hash` 比较（HP6 frozen）。

---

## 5. Restore / Fork — Not Yet Live

HP9 frozen pack 阶段**不暴露** restore / fork public 路由。HP7 已落地 substrate：

- `D1CheckpointSnapshotPlane` — snapshot lineage truth (`workers/orchestrator-core/src/checkpoint-restore-plane.ts:36-280`)
- `D1CheckpointRestoreJobs` — restore job state machine (`workers/orchestrator-core/src/checkpoint-restore-plane.ts:376-531`)
- `CheckpointDiffProjector` — three-layer delta (`workers/orchestrator-core/src/checkpoint-diff-projector.ts`)
- `buildCheckpointSnapshotR2Key` / `buildForkWorkspaceR2Key` — R2 key law

但 **HTTP route + executor + TTL cleanup cron 尚未 live**——HP7 closure §2 P1-P6 已登记为 deferred；hero-to-platform 阶段或 HP7 后续批次承接。

### 客户端规划

- **不要假设** `POST /sessions/{id}/checkpoints/{uuid}/restore` 或 `POST /sessions/{id}/fork` 已存在；这些路由当前返 `404 not-found`。
- 客户端 UI 可显示 "restore" / "fork" 入口为 disabled 状态，hover 提示 "available in next release"。
- `session.fork.created` server→client WS 帧已**注册** schema（详见 [`session-ws-v1.md`](./session-ws-v1.md)），但当前不会被 emit。

冻结决策：

| Q ID | 内容 | 影响 |
|------|------|------|
| Q22 | file snapshot policy by kind | `user_named` eager / 其他 lazy |
| Q23 | fork = same conversation only | 不允许跨 conversation fork |
| Q24 | restore failure → rollback baseline | 非 success 终态必填 `failure_reason` |

---

## 6. Errors

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-input` | label 缺失或超长 |
| 404 | `session-not-found` / `checkpoint-not-found` | UUID 不存在 |
| 409 | `conversation-deleted` | parent conversation 已 tombstone |
| 503 | `internal-error` | upstream worker 不可达 |

详见 [`error-index.md`](./error-index.md)。
