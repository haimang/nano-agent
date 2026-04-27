# Nano-Agent Transport Profiles — v1 (frozen by ZX2)

> 作者: Opus 4.7（ZX2 Phase 1 P1-01）
> 时间: 2026-04-27
> 状态: `frozen-v1`
> 引用基: 所有 ZX2 之后的 PR 必须在描述中声明所属 profile

---

## 0. 为什么需要这份文档

ZX2 调研期间发现 nano-agent 6-worker matrix 内的 transport 形态没有冻结的命名：内部 NACP 消息、内部 HTTP relay、对外 facade HTTP、WebSocket session frame、health probe 五种形态混杂使用同一种"看起来像 HTTP / 像 RPC"的描述。后果是新增端点时随手再造一种 envelope，客户端不得不写多套 narrow，调查报告里也只能反复用"内部 HTTP" / "内部 RPC" / "对外 HTTP" 这类含义随上下文飘移的术语。

本文档把 5 个 transport profile 一次性命名清楚，作为后续所有 PR 的引用基。**任何新增端点必须声明其归属的 profile，且 profile 之间不允许混用形状。**

## 1. 五大 profile 速查

| Profile | 用途 | wire | 信任栈 | 形状契约源 | 状态 |
|---|---|---|---|---|---|
| `nacp-internal` | worker ↔ worker / worker ↔ DO 的协议化内部消息 | service-binding RPC + NACP envelope (`NacpEnvelope`) | binding 平台隔离 + `verifyTenantBoundary` + `checkAdmissibility` + caller-side `validateRpcCall` + callee-side `validateEnvelope` | `@haimang/nacp-core` | active |
| `internal-http-compat` | 旧 worker→DO / worker→worker 的 HTTP relay（`https://*.internal/...`） | service-binding `fetch()` + `x-nano-internal-binding-secret` + `x-nano-internal-authority` (JSON) + `x-trace-uuid` | secret + authority parity (`validateInternalAuthority`) | `workers/agent-core/src/host/internal-policy.ts` | **retired-with-rollback**（ZX2 Phase 3 P3-04 完成；rollback runbook 见 `docs/runbook/zx2-rollback.md`） |
| `facade-http-v1` | 对外公网 HTTP（auth + session + me + catalog + debug） | HTTPS + Bearer JWT (or `?access_token=`) + `x-trace-uuid` + `Envelope<T>` | JWT + `authenticateRequest` + `ensureConfiguredTeam` | `@haimang/orchestrator-auth-contract`（ZX2 Phase 2 扩展） | active |
| `session-ws-v1` | 对外 session 长连接 (`/sessions/{uuid}/ws`) | WebSocket + lightweight `{kind,...}` wire (v1) + `liftLightweightFrame()` 服务端映射到 `NacpSessionFrameSchema` | JWT (query token) + `authenticateRequest` allowQueryToken | `@haimang/nacp-session` | active (v1 wire); wire-切 `NacpSessionFrameSchema` 推迟到 v2 |
| `health-probe` | `/health` + `/debug/workers/health` 聚合健康探针 | service-binding `fetch('/health')` 或公网 `GET /health` | 无（公开） | 各 worker `createShellResponse()` | active |

## 2. profile 详细规范

### 2.1 `nacp-internal`

**范围**：service-binding 调用 + Durable Object stub `fetch()` 内的协议化路径。
- orchestrator-core ↔ orchestrator-auth（已 100% RPC，8 method）
- orchestrator-core ↔ agent-core（ZX2 Phase 3 完成 7/7 RPC 后全部归此 profile）
- agent-core ↔ bash-core（ZX2 Phase 3 完成 RPC 化后归此 profile）

**wire**：
- 调用方写 `env.<BINDING>.<method>(input, meta)` 或经 `ServiceBindingTransport` 发 `NacpEnvelope`。
- 输入 = method-specific zod schema；输出 = `Envelope<T> = { ok: true; data: T } | { ok: false; error: NacpRpcError }`。
- meta = `RpcMeta = { trace_uuid, caller, authority?, session_uuid? }`。

**信任栈**：
- platform-level service-binding 隔离（不可被公网直接触达）。
- caller 在 send 前调 `validateRpcCall(target, input, meta)`：依次跑 zod parse + tenant boundary 预检。
- callee 在 entrypoint 调 `validateEnvelope` + `verifyTenantBoundary` + `checkAdmissibility`（即"双头校验"）。

**契约源**：`@haimang/nacp-core`（`Envelope<T>`、`RpcMeta`、`NacpRpcError`、`validateRpcCall` 在 ZX2 Phase 2 落地）。

**禁止**：在此 profile 上使用任意 string `error` / 自定义 `{ status, body }` / NDJSON 字符串 over RPC。stream 类只能走 cursor-paginated snapshot RPC（`Envelope<{ events, next_cursor }>`）或下沉到 `session-ws-v1`。

### 2.2 `internal-http-compat`

**范围**：ZX2 完成前所有 `https://*.internal/...` 形式的 service-binding fetch 调用。

**wire**：
- URL：`https://agent.internal/internal/sessions/:id/<action>` 或 `https://binding.local/capability/{call,cancel}`。
- headers：`x-nano-internal-binding-secret`、`x-nano-internal-authority`（序列化 JSON）、`x-trace-uuid`、`content-type: application/json`。
- body：`{ ...action-specific, trace_uuid?, authority? }`。
- response：旧形态 `{ status: number, body: Record \| null }` 或 `{ ok:true, action, phase, ... }`。

**信任栈**：`validateInternalAuthority`（`workers/agent-core/src/host/internal-policy.ts`）—— secret + authority parity + trace 一致性。

**状态**：
- ZX2 Phase 3 P3-05 翻转后标 `retired-with-rollback`（保留 1 周回滚开关 + feature flag）。
- 翻转后 1 周无回滚需求标 `retired`，删除回滚开关。
- bash-core 段在 ZX2 Phase 3 P3-03/04 完成 RPC 化后立刻归并到 `nacp-internal`。

**禁止**：
- ZX2 完成后**新增**任何使用此 profile 的端点。
- 不允许在 `nacp-internal` 已经覆盖的路径上回退到此 profile（除非走 rollback flag）。

### 2.3 `facade-http-v1`

**范围**：所有对外公网 HTTP 端点（仅 `orchestrator-core` 暴露）。

**wire**：
- URL：`/auth/*`、`/me`、`/sessions/{uuid}/{action}`、`/me/sessions`、`/me/conversations` (ZX3)、`/catalog/{skills,commands,agents}`、`/debug/workers/health`。
- headers：`Authorization: Bearer <jwt>`（必填，`/auth/register|login|refresh|wechat/login` 例外）+ `x-trace-uuid`（必填）+ `content-type: application/json`。
- response 成功：`{ ok: true, data: T, trace_uuid }`。
- response 失败：`{ ok: false, error: { code, status, message, details? }, trace_uuid }`，HTTP status 与 `error.status` 一致。

**信任栈**：
- `authenticateRequest`（HMAC JWT，kid-aware via `JWT_SIGNING_KEY_<kid>`，legacy `JWT_SECRET` 兜底）。
- `ensureConfiguredTeam`（`TEAM_UUID` 必填，preview 例外）。
- `readTraceUuid`（header 或 query 必有 UUID）。

**契约源**：`@haimang/orchestrator-auth-contract`（ZX2 Phase 2 P2-04 扩展 `facade-http.ts`）。

**禁止**：
- 不允许 worker 自造 `{ error, message }` 或 `{ ok:true, action, phase }` 形态作为对外响应。
- 任何 4xx/5xx 必须包成 `Envelope.error` + matching HTTP status。

### 2.4 `session-ws-v1`

**范围**：对外 session 长连接，仅 `orchestrator-core` 暴露 `/sessions/{uuid}/ws`，由 orchestrator User DO + agent-core Session DO 联合处理。

**wire**：
- URL：`wss://<facade>/sessions/{uuid}/ws?access_token=...&trace_uuid=...&last_seen_seq=...`。
- frame（ZX2 实际状态）：**lightweight `{ kind, seq?, ... }` JSON**（v1 wire），保持向后兼容现有 web/wechat 客户端。
- frame（NACP 形状）：服务端通过 `liftLightweightFrame()` 把 wire frame **映射** 为 `NacpSessionFrameSchema`-shaped envelope（基于 `NacpEnvelopeBaseSchema` + `SessionFrameFields`）。new-shape 客户端可基于该映射消费；老客户端继续直接读 wire。
- 真正把 wire 切到 `NacpSessionFrameSchema` envelope 是 `session-ws-v2` 的目标（非 ZX2 scope）。
- close codes：见 `clients/api-docs/session-ws-v1.md`（ZX2 Phase 4 P4-05）。

**信任栈**：
- WS open：`authenticateRequest` allowQueryToken。
- 每 frame（client→server）：`validateSessionFrame` + `assertSessionRoleAllowed` + `assertSessionPhaseAllowed`。
- 每 frame（server→client）：lift mapping 路径同样跑 `validateSessionFrame`。

**契约源**：`@haimang/nacp-session`（ZX2 Phase 2 P2-03 扩 5 族 / 7 个新 message_type）。

**禁止**：
- 不允许在此 profile 上发明新的 envelope 形态（除已有 `{kind,...}` lightweight wire 与 `liftLightweightFrame()` 映射）。
- 新增 message_type 必须先在 nacp-session registry / direction matrix 注册。
- compat 层只做 alias（旧 `{ kind, ... }` ↔ NACP `{ message_type, body }`），不引入第三种 envelope。

### 2.5 `health-probe`

**范围**：每个 worker 的 `GET /` 与 `GET /health`，以及 orchestrator-core 的 `GET /debug/workers/health`。

**wire**：
- URL：`/` 或 `/health`。
- response：`{ worker, status: "ok", worker_version, ... }`（每 worker 各自定义 shell shape）。

**信任栈**：无（公开端点；不返回任何 secret / topology 细节）。

**禁止**：
- 不允许在此 profile 上加任何业务路由。
- 不允许 health response 暴露 binding 状态以外的内部 topology。

## 3. profile 跨界规则

| 行为 | 是否允许 |
|---|---|
| `facade-http-v1` 端点内部调 `nacp-internal` RPC | ✅ orchestrator-core 唯一能这么做的 worker |
| `facade-http-v1` 端点内部 fetch `https://*.internal/...` | ⚠️ 仅 ZX2 Phase 3 翻转前；翻转后禁止 |
| `nacp-internal` worker 暴露 `facade-http-v1` 端点 | ❌ 仅 orchestrator-core 是 public facade |
| `health-probe` 端点之外的 fetch handler | ❌ 非 facade worker 必须返回 401（binding-scope 守卫，ZX2 Phase 1 P1-03） |
| `session-ws-v1` frame 与 `nacp-internal` envelope 共享 message_type | ✅ 但 wire 形态独立（一个是 WS frame，一个是 RPC 对象） |
| 新增 message_type 不在 nacp-core / nacp-session registry | ❌ 必须先注册到 registry 再使用 |

## 4. 形状碎片治理

ZX2 之前各 profile 出现的形状碎片：

| 形态 | 出现位置 | ZX2 治理 |
|---|---|---|
| `{ ok:true, data:T }` / `{ ok:false, error:{code,message,status} }` | `orchestrator-auth-contract.AuthEnvelope` | Phase 2 升级为 `Envelope<T>` 单一来源 |
| `{ status:number, body:Record\|null }` | `agent-core.AgentCoreRpcResponse` | Phase 4 P4-02 替换为 `Envelope<T>` |
| `{ status:'ok'\|'error', output?, error? }` | `bash-core` capability response | Phase 3 P3-03 包入 `Envelope<ToolCallResponseBody>` |
| `{ error, message }` (top-level) | `orchestrator-core/src/policy/authority.ts:jsonPolicyError` | Phase 4 P4-01 升级为 `Envelope.error` |
| `{ error }` 单字段 | `agent-core/src/host/http-controller.ts` | Phase 4 P4-03 包入 `Envelope.error` |
| `{ ok:true, action, phase, ... }` | `agent-core HttpController` 各 action 出口 | Phase 4 P4-03 拍平到 `Envelope.data` |
| `{ kind: '...', ... }` | server WS frame | Phase 4 P4-04 — wire 保留 lightweight；服务端通过 `liftLightweightFrame()` 提供 `NacpSessionFrameSchema` 映射；wire 真正统一推迟到 `session-ws-v2` |

ZX2 完成后的目标态：**1 种成功 envelope + 1 种 error envelope + 1 种 WS frame schema**，全部归宗 NACP。

## 5. 引用约定

每个 PR 的描述里必须按下表声明：

```
profile-touched:
  - facade-http-v1: POST /sessions/{id}/permission/decision (new)
  - session-ws-v1: session.permission.request (new)
  - nacp-internal: AgentCoreRpc.input(input, meta) (new RPC method)
```

PR review 时必须确认：
1. 新形状已在 contract 包定义且 export；
2. 没有跨 profile 复制粘贴形状；
3. 测试覆盖 caller / callee 双头校验。

## 6. 状态标签词典

| 标签 | 含义 |
|---|---|
| `frozen-v1` | 命名与契约冻结，下游可引用 |
| `active` | 当前主路径 |
| `retiring` | 正在被替代但旧端点仍存在 |
| `retired-with-rollback` | 主路径已切换；保留 feature flag + 1 周回滚窗口 |
| `retired` | 完全删除，contract 包仍保留兼容 alias |

## 7. 后续动作（2026-04-27 ZX2 落地后状态）

| 行动 | 状态 |
|---|---|
| ZX2 Phase 2 — `nacp-core` 公开 `Envelope<T>` / `RpcMeta` / `RpcErrorCode` / `validateRpcCall` | ✅ shipped |
| ZX2 Phase 2 — `nacp-session` 落 5 族 7 message_type | ✅ shipped |
| ZX2 Phase 2 — `orchestrator-auth-contract` 扩 `facade-http-v1` | ✅ shipped |
| ZX2 Phase 3 — agent-core 7 action 全 RPC（含 `streamSnapshot` cursor-paginated） | ✅ shipped (parity 模式) |
| ZX2 Phase 3 — bash-core `WorkerEntrypoint` + RPC + NACP authority | ✅ shipped |
| ZX2 Phase 3 — `internal-http-compat` → `retired-with-rollback` | ✅ shipped (回滚 runbook 见 `docs/runbook/zx2-rollback.md`) |
| ZX2 Phase 4 — facade-http-v1 / session-ws-v1 文档冻结 | ✅ shipped |
| ZX2 Phase 5 — 5 facade-必需 endpoints + 7 message_type 接入 | ✅ shipped |
| ZX2 Phase 6 — web/wechat 客户端切单一 narrow + e2e | ✅ shipped |
| ZX3（候选）— 升级 context-core / filesystem-core 为 RPC worker；产品型 `/messages` `/files` `/conversations` `/devices/revoke` | 留给后续 plan |
