# Client Cookbook (HPX5)

> Public facade owner: `orchestrator-core`
> Audience: 前端 / SDK / e2e 测试集成方
> 文档基线: HP9 frozen 18-doc pack + HPX5 wire-up

本文档收口前端实战兜底逻辑。所有逻辑都基于已 live 的 contract,不引入新 API 形状。

---

## 1. Envelope unwrap helper(D1)

façade 同时存在两种成功 envelope:

| Profile | 形状 |
|---------|------|
| `facade-http-v1` | `{ ok: true, data: {...}, trace_uuid }` |
| `legacy-do-action` | `{ ok: true, action: "input"|..., session_uuid, ..., trace_uuid }` |

写一个统一 `unwrap()`:

```ts
type FacadeOk<T> = { ok: true; data: T; trace_uuid: string };
type LegacyOk = { ok: true; action: string; session_uuid: string; [k: string]: unknown };
type FacadeErr = { ok: false; error: { code: string; status: number; message: string; details?: object }; trace_uuid: string };

function unwrap<T>(body: FacadeOk<T> | LegacyOk | FacadeErr): T | LegacyOk {
  if (!body.ok) throw new ClientError(body.error.code, body.error.message, body.trace_uuid);
  if ("data" in body) return body.data;
  return body;  // legacy-do-action 顶层平铺,直接返 body 给调用者
}
```

---

## 2. Trace UUID + dedup(D3)

每个业务请求必须发 `x-trace-uuid: <uuid>`(transport-profiles.md §7)。错误展示时**必须**显示 trace_uuid,方便用户报障。

RHX2 dual-emit 窗口:`system.error` 与 `system.notify(severity="error")` 在 ~1s 内会带同 `(trace_uuid, code)` 重复发出。前端 reducer 去重:

```ts
const seen = new Map<string, number>();  // key = `${trace_uuid}:${code}`
function shouldRender(frame: SystemErrorFrame | SystemNotifyFrame): boolean {
  if (frame.severity === "error" || frame.kind === "system.error") {
    const key = `${frame.trace_uuid ?? ""}:${frame.code ?? ""}`;
    const now = Date.now();
    const last = seen.get(key);
    if (last && now - last < 1000) return false;
    seen.set(key, now);
  }
  return true;
}
```

---

## 3. start → ws attach 顺序(D4)

WS 握手在 session **pending** 时返 `409 session-pending-only-start-allowed`(session-ws-v1.md §2)。客户端必须严格:

```
1. POST /me/sessions               → session_uuid pending
2. POST /sessions/{id}/start       → ack(session active)
3. GET  /sessions/{id}/ws?...      → 此时 attach OK
```

为了防止 step 2 与 step 3 之间帧丢失,可以在 `last_seen_seq=0` 时连接 — server 会从 stream 起点回放。

---

## 4. `409 confirmation-already-resolved` 视终态成功(D6)

HP5 row-first dual-write law(Q16):confirmation row 一旦终态,后续 decision 提交返 `409 confirmation-already-resolved`。**视为最终态成功,不要重试**:

```ts
if (resp.status === 409 && body.error.code === "confirmation-already-resolved") {
  // already resolved — refresh GET /confirmations/{uuid} to see current state
  return fetchConfirmation(confirmationUuid);
}
```

同样适用于 legacy `POST /permission/decision` 与 `POST /elicitation/answer`(permissions.md §3 §5)。

---

## 5. Confirmation polling fallback vs WS push(HPX5 F1)

HPX5 F1 接通后,`session.confirmation.request` / `session.confirmation.update` 顶层帧在 row write 后 ≤500ms emit。前端 happy path 走 WS 事件驱动:

```ts
ws.on("message", (frame) => {
  if (frame.kind === "session.confirmation.request") {
    showConfirmationDialog(frame);
  }
});
```

**polling 仍保留**作为 reconcile fallback(Q-bridging-2):

- WS 重连后必须**立即**拉一次 `GET /confirmations?status=pending`,补 reconnect 窗口期可能丢失的帧。
- HTTP-only 客户端(SSR / curl 集成)继续用 polling。
- **必须 dedup**:`confirmation_uuid` 全局唯一,前端 reducer 用它去重。

---

## 6. WriteTodos LLM-driven todo plane(HPX5 F2)

LLM 现在可以直接调 `write_todos` tool 写 session todo:

- agent-core capability registry 会路由 `tool_use { name: "write_todos" }` 到 orchestrator-core `D1TodoControlPlane`
- HP6 Q19 at-most-1 in_progress invariant 由 capability 自动护理:LLM 同时写多个 in_progress 时,只第一个生效,其余降为 `pending`,旧的 in_progress 自动降为 `pending`(`auto_closed` 列表返给 LLM tool_result)
- D1 写成功后立即 emit `session.todos.update` 顶层帧

前端 todo 区从"用户面板"升级为"agent 工作板":前端只需订阅 `session.todos.update` 帧,本地状态用最新 `todos` 全量替换。

---

## 7. Workspace file bytes 读取(HPX5 F5)

LLM 写出的 workspace temp file 现在可通过 binary GET 直接读字节:

```http
GET /sessions/{id}/workspace/files/path/to/file.json/content
Authorization: Bearer <access_token>
x-trace-uuid: <uuid>
```

返 `Content-Type` + `Content-Length` + raw bytes,与 artifact bytes 路径形状一致。

| HTTP | 说明 |
|------|------|
| 200 | 字节流 |
| 404 | metadata 不存在 |
| 409 `workspace-file-pending` | metadata 存在但 R2 object 缺(snapshot 中途) |
| 413 `payload-too-large` | 超 25 MiB cap |
| 503 `filesystem-rpc-unavailable` | filesystem-core RPC 不可达 |

---

## 8. Auto-compact 自动触发(HPX5 F3)

session 在 turn 边界自动检测 `effective_context_pct >= auto_compact_token_limit / context_window`(默认阈值 0.85)→ scheduler 进入 `compact` decision → `compact.notify` 帧 emit:`started → completed | failed`。

前端只需监听 `compact.notify`,**不需要主动轮询 `/context/probe` + 手动触发**。

手动 compact 路由 `POST /context/compact[/preview]` 仍可用,**body 字段已生效**(HPX5 F3):

```json
{
  "force": true,           // 跳过 budget check 强制 compact
  "preview_uuid": "...",   // 可选:从 preview 阶段 round-trip 一致性
  "label": "before-refactor"  // 写入 checkpoint registry
}
```

---

## 9. Model fallback 通知(HPX5 F4)

当 turn 因 quota / availability 等触发 fallback 时,server emit `model.fallback` stream-event:

```json
{
  "kind": "model.fallback",
  "turn_uuid": "...",
  "requested_model_id": "@alias/reasoning",
  "fallback_model_id": "@cf/ibm-granite/granite-4.0-h-micro",
  "fallback_reason": "quota-exhausted"
}
```

**字段名以 schema 为准** — `fallback_model_id`(不是 `effective_model_id`,旧文档措辞已修正)。前端 model badge 监听此帧即时更新。

---

## 10. Decision body shape — `status + decision_payload` canonical

Confirmation decision 提交统一为:

```json
{
  "status": "allowed" | "denied" | "modified" | "timeout" | "superseded",
  "decision_payload": { ... }
}
```

历史上 legacy `POST /permission/decision` 与 `POST /elicitation/answer` 用 `{ decision, scope, payload, answer }` 字段;**已统一通过 dual-write 到新 confirmation row**,客户端建议直接用 `POST /confirmations/{uuid}/decision` + canonical body。

---

## 11. Implementation reference 行号

HPX5 F7 内已把 18-doc 中所有 `workers/orchestrator-core/src/index.ts:NNN` 引用改为新模块化结构对应位置(façade routes / control-plane / hp-absorbed-routes)。如发现失效引用,请上报 trace_uuid。

---

## 12. emit-helpers latency observability

HPX5 新增 emit 出口(F1/F2c/F4)经 `packages/nacp-session/src/emit-helpers.ts` 的 `emitTopLevelFrame` / `emitStreamEvent`。每条 emit 路径在失败时 fall back 到 `system.error`,**绝不**静默丢帧。客户端如果在生产中频繁看到 `NACP_BINDING_UNAVAILABLE`,请上报 — 可能是 service binding 不可达。

---

## 13. Unified confirmation wakeup-failed

`POST /sessions/{id}/confirmations/{uuid}/decision` 与 legacy `/permission/decision` 的失败语义不同：

| 路径 | Row truth | Downstream wakeup failure |
|------|-----------|---------------------------|
| unified `/confirmations/{uuid}/decision` | 先写 D1 row | 返回 `503 internal-error`，row 改写为 `superseded`，不要盲目重试 decision |
| legacy `/permission/decision` / `/elicitation/answer` | dual-write 兼容 | KV/RPC 失败仍返回 200，row/KV truth 用于后续 reconcile |

客户端遇到 unified 503 时：

1. 读取 `GET /sessions/{id}/confirmations/{uuid}`。
2. 若 status 为 `superseded`，展示 "已记录但 runtime 未唤醒" 并允许用户重新发起上层操作。
3. 不要直接重发同一个 decision；重发大概率返回 `409 confirmation-already-resolved`。

---

## 14. Reconnect Recovery Bundle

当 WS attach 收到 `session.replay.lost`，或 HTTP `POST /sessions/{id}/resume` 返回 `data.replay_lost === true`，客户端必须把本次恢复视为 degraded，并刷新 recovery bundle：

1. `GET /sessions/{id}/status` 或 `GET /sessions/{id}/runtime`：重建 phase / runtime policy。
2. `GET /sessions/{id}/confirmations?status=pending`：恢复 HITL dialog truth。
3. `GET /sessions/{id}/context/probe`：恢复 compact/budget posture。
4. `GET /sessions/{id}/todos`：恢复 agent workboard。
5. `GET /sessions/{id}/items`：恢复 workbench item projection。
6. `GET /sessions/{id}/tool-calls`：恢复 tool call terminal/read-model。
7. 必要时 `GET /sessions/{id}/timeline`：做 degraded reconciliation。

PP3 不承诺 exactly-once replay；上述 bundle 是 first-wave client 侧一致性补偿。
