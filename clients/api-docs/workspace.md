# Workspace — Artifacts + Temp Files（HP6）

> Public facade owner: `orchestrator-core` → `filesystem-core` (RPC)
> Implementation reference: `workers/orchestrator-core/src/index.ts:466-483` (`parseSessionFilesRoute`)，`workers/orchestrator-core/src/workspace-control-plane.ts`，`workers/filesystem-core/src/index.ts`
> Migration source: `migrations/011-session-temp-files-and-provenance.sql`
> Profile: `facade-http-v1` + `binary-content`
> Auth: `Authorization: Bearer <access_token>`

本文件覆盖：（a）HP4 之前已 live 的 **artifact** CRUD（`/sessions/{id}/files`）；（b）HP6 已冻结的 **workspace temp file** 路径法律 + D1 truth；（c）HP9 frozen 阶段尚未开放的 **workspace public CRUD** 路由。

---

## 1. 三个概念

| 概念 | 持久化 | 用例 | 状态 |
|------|--------|------|------|
| **artifact** | R2 + D1 metadata | 用户上传的图片 / 文件，`/messages` 里通过 `artifact_ref` 引用 | **live** |
| **workspace temp file** | R2 + D1 + virtual_path | LLM 通过 tool 创建 / 修改的中间文件（如 patch 输出、scratch code） | **D1 truth + path law live；public CRUD route 未 live** |
| **workspace snapshot** | R2 (lineage) | checkpoint restore 用的 file snapshot | HP7 substrate；executor 未 live（详见 [`checkpoints.md`](./checkpoints.md)） |

---

## 2. Tenant-Scoped R2 Key Law（HPX-Q19 frozen）

所有 workspace temp file 与 snapshot 的 R2 key 必须遵循：

```text
tenants/{team_uuid}/sessions/{session_uuid}/workspace/{normalized_virtual_path}
tenants/{team_uuid}/sessions/{session_uuid}/checkpoints/{checkpoint_uuid}/snapshot/{normalized_virtual_path}
tenants/{team_uuid}/sessions/{forked_session_uuid}/workspace/{normalized_virtual_path}  # fork
```

由 `buildWorkspaceR2Key()` / `buildCheckpointSnapshotR2Key()` / `buildForkWorkspaceR2Key()` 生成（实现于 `workers/orchestrator-core/src/workspace-control-plane.ts` 与 `workers/orchestrator-core/src/checkpoint-restore-plane.ts`）。

---

## 3. virtual_path Normalization Law（HPX-Q19 frozen）

`normalizeVirtualPath()` 冻结的 7 条安全规则（HP6）：

1. 不允许 `..`（path traversal）
2. 不允许 `\`（Windows separator）
3. 不允许空段（`/foo//bar`、leading `/` 与 trailing `/` 单独段）
4. 长度 ≤ 1024 字节
5. 强制使用 `/` 作为 segment 分隔符
6. case-sensitive
7. UTF-8 byte length，非 char length

非法 path → server 返 `400 invalid-input`。

---

## 4. Artifact Routes — Live

### GET `/sessions/{id}/files`

列出 session 的 artifact metadata。

```json
{
  "ok": true,
  "data": {
    "artifacts": [
      {
        "artifact_uuid": "...",
        "session_uuid": "...",
        "filename": "screenshot.png",
        "mime": "image/png",
        "size_bytes": 23541,
        "created_at": "..."
      }
    ]
  },
  "trace_uuid": "..."
}
```

### POST `/sessions/{id}/files`

multipart upload。

```http
POST /sessions/{sessionUuid}/files HTTP/1.1
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
Content-Type: multipart/form-data; boundary=...

--boundary
Content-Disposition: form-data; name="file"; filename="screenshot.png"
Content-Type: image/png

<binary>
--boundary--
```

Success (`201`):

```json
{
  "ok": true,
  "data": {
    "artifact_uuid": "...",
    "filename": "screenshot.png",
    "mime": "image/png",
    "size_bytes": 23541
  },
  "trace_uuid": "..."
}
```

| HTTP | code | 说明 |
|------|------|------|
| 400 | `invalid-input` | multipart body 解析失败 |
| 413 | `payload-too-large` | 单文件超过 25 MiB |
| 503 | `filesystem-rpc-unavailable` | filesystem-core RPC 不可达 |

### GET `/sessions/{id}/files/{fileUuid}/content`

返回原始字节，`Content-Type` / `Content-Length` 正确。Profile 是 `binary-content`，**不是** `facade-http-v1`。

---

## 5. Workspace Temp File — D1 Truth Live, Public CRUD Not Yet

HP6 frozen 状态：

| 层 | 是否 live | 说明 |
|----|-----------|------|
| D1 `nano_session_temp_files` 真相表 | ✅ live | `D1WorkspaceControlPlane` (`workers/orchestrator-core/src/workspace-control-plane.ts`) 提供 list / upsert / delete + `UNIQUE(session, virtual_path)` + `content_hash` |
| R2 key law | ✅ live | `buildWorkspaceR2Key()` |
| filesystem-core temp-file RPC | ❌ not-live | `readTempFile / writeTempFile / listTempFiles / deleteTempFile` 等 leaf RPC 未实现（HP6 closure §2 P1） |
| 公共 CRUD 路由 `/sessions/{id}/workspace/files/{*path}` | ❌ not-live | 未注册（HP6 closure §2 P2） |
| `/sessions/{id}/tool-calls` list/cancel 路由 | ❌ not-live | 未注册（HP6 closure §2 P3） |
| artifact promotion / cleanup cron | ❌ not-live | HP6 closure §2 P4/P5 |

> **客户端规划**：当前 HP9 frozen pack 不允许客户端通过 HTTP 直接读写 workspace temp file；这层是 LLM tool 的内部接线（`workers/agent-core/src/host/workspace-runtime.ts`）。HP6 后续批次会暴露 `/sessions/{id}/workspace/files/{*path}` 给 client。

---

## 6. WebSocket Frames

详见 [`session-ws-v1.md`](./session-ws-v1.md)。

| frame | 时机 |
|-------|------|
| `tool.call.cancelled` | 工具 cancel 时；含 `cancel_initiator: user / system / parent_cancel` |
| `session.fork.created` | （schema 已注册，但 fork executor 未 live） |

---

## 7. Frozen Decisions

| Q ID | 内容 | 影响 |
|------|------|------|
| Q19 | virtual_path 7-rule + tenant-scoped R2 key law | 所有 path 必须经过 normalize；越权 / traversal 直接 400 |
| Q21 | tool cancel 不入 confirmation kind enum | tool cancel 走 `tool.call.cancelled` stream event，不走 `confirmations` plane |

---

## 8. Lane E Final State

详见 `docs/architecture/lane-e-final-state.md`。HP8 已把 host-local workspace residue 冻结为 `retained-with-reason`：在 filesystem-core 暴露完整 leaf-RPC 之前，`workers/agent-core/src/host/workspace-runtime.ts` 仍构造 `ContextAssembler` / `CompactBoundaryManager` / `WorkspaceSnapshotBuilder` 三件套；这是显式 retained，不是 shim。
