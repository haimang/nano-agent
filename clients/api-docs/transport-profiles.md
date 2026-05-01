# Transport Profiles — Envelope Law

> Public facade owner: `orchestrator-core`
> Implementation reference: `packages/orchestrator-auth-contract/src/facade-http.ts`，`packages/nacp-core/src/error-registry.ts`，`scripts/check-envelope-drift.mjs`（root drift gate）
> Profile applicability：所有客户端必须按 profile 解析 response，不能跨 profile 假设 shape
>
> 冻结依据：HPX-Q27（public surface 必须用 FacadeEnvelope；internal `Envelope<T>` / `AuthEnvelope<T>` 是 worker-to-worker RPC 保留 shape，不暴露给 client）。

---

## 1. Profile Catalog

| Profile | 路由示例 | 成功返回形状 | Content-Type |
|---------|----------|--------------|--------------|
| `health-probe` | `GET /` `/health` | raw shell probe JSON | `application/json` |
| `debug-health` | `GET /debug/workers/health` | raw aggregated debug JSON | `application/json` |
| `facade-http-v1` | 大多数业务 HTTP / debug P6 路由 | `{ ok:true, data, trace_uuid }` | `application/json` |
| `legacy-do-action` | session DO action 路由（`start` / `input` / `cancel` / `close` / `delete` / `title` / `messages` / `status` / `timeline` / `history` / `verify`） | `{ ok:true, action, session_uuid, ..., trace_uuid }` | `application/json` |
| `session-ws-v1` | `GET /sessions/{id}/ws` | lightweight JSON frames over WS | (n/a) |
| `binary-content` | `GET /sessions/{id}/files/{fileUuid}/content` | raw bytes | mime per artifact |

---

## 2. `facade-http-v1` Envelope

```json
{
  "ok": true,
  "data": { "...": "..." },
  "trace_uuid": "11111111-1111-4111-8111-111111111111"
}
```

错误：

```json
{
  "ok": false,
  "error": {
    "code": "invalid-auth",
    "status": 401,
    "message": "token missing, invalid, or expired",
    "details": { "optional": true }
  },
  "trace_uuid": "..."
}
```

**Q27 invariant**：

- `ok: true` 时 **必须** 有 `data` + `trace_uuid`。
- `ok: false` 时 **必须** 有 `error` + `trace_uuid`。
- `error.code` 是稳定的 stringly-typed primary key；`error.status` 仅为 fallback。
- 这层 envelope 由 `scripts/check-envelope-drift.mjs` 在 CI / local 通过 root drift gate enforce（HP8 P3-02b）。

---

## 3. `legacy-do-action` Envelope

session DO action 路由保留：

```json
{
  "ok": true,
  "action": "input",
  "session_uuid": "...",
  "session_status": "active",
  "trace_uuid": "..."
}
```

特征：

- 没有 `data` 字段；payload 字段平铺在顶层。
- `action` 字段总是回显 request 的 action 名（`start` / `input` / `cancel` / `close` / `delete` / `title` / `messages` / `status` / `timeline` / `history` / `verify` / `resume`）。
- `session_uuid` 总在；`session_status` 在 `active` 后总在。

错误 shape 与 `facade-http-v1` 一致：`{ ok:false, error, trace_uuid }`。

> **客户端规划**：web/wechat 客户端应在 transport 层把两种成功 shape 都正确解析（不要假设每个 `ok:true` 都有 `data`）。可写一个 `unwrap()` helper 统一。

---

## 4. `health-probe` / `debug-health`

```json
{ "ok": true, "service": "orchestrator-core", "build": "..." }
```

raw probe，不带 `trace_uuid`，不带 `data` envelope。仅用于 LB / smoke check。客户端 UI 不应直接调用这两条。

---

## 5. `session-ws-v1` Frame Shape

详见 [`session-ws-v1.md`](./session-ws-v1.md)。frame 顶层 shape：

```json
{ "kind": "event", "seq": 12, "name": "session.stream.event", "payload": { "...": "..." } }
```

或 client → server：

```json
{ "kind": "client.input", "payload": { "...": "..." } }
```

---

## 6. `binary-content` Profile

仅用于 `GET /sessions/{id}/files/{fileUuid}/content`：

- HTTP `200` + `Content-Type: <mime>` + `Content-Length: <bytes>` + raw bytes。
- 错误时回退到 `facade-http-v1` JSON envelope（`401` / `404` / `503`）。
- 客户端必须先看 `Content-Type` 决定按 `application/json` 还是按 binary 处理。

---

## 7. Trace UUID Rule

| 路由族 | trace_uuid required |
|--------|---------------------|
| `/auth/*`，`/me/*`，所有业务路由 | **client must send** `x-trace-uuid: <uuid>`；server 在 response 回显 |
| `/health`，`/`，`/catalog/*` | optional；server 仍生成 |
| WS | URL query `trace_uuid=<uuid>`；frame 内 `payload.trace_uuid` 仅在 server frame 上 |

server 永远在错误 envelope 中回 `trace_uuid`，无论 client 是否 sent；客户端必须在用户可见的失败处展示该 trace_uuid。

---

## 8. Internal Envelopes — Not For Clients

> **HPX-Q27 invariant**：`Envelope<T>` 与 `AuthEnvelope<T>` 是 worker-to-worker RPC 保留 shape，**不会暴露给 public HTTP client**。如果客户端在 response 中看到 `AuthEnvelope` shape，那是一个 bug；请上报 trace_uuid + path 给 owner。

`scripts/check-envelope-drift.mjs`（HP8 P3-02b）会在 `workers/orchestrator-core/src/index.ts` 上 enforce 这个 invariant：任何 `Response.json({ ok, data | error, ... })` 缺 `trace_uuid` 都会让 root drift gate fail。

---

## 9. Versioning Discipline

- **public surface 字段只增不减**：HP9 frozen pack 之后，所有 `data.*` 字段保持 backward compat；新字段只增加；deprecation 走 `?deprecated=...` query 标记或 separate endpoint。
- **`error.code`** 字符串集合**只增不删**；新 code 加入后会先在 `error-index.md` 登记。
- **legacy-do-action shape 不动**：保留原生字段名，不重命名。

任何破坏 backward compat 的变更必须由 hero-to-platform 阶段独立宣布，并附带 deprecation window。
