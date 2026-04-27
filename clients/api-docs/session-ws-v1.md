# session-ws-v1 — Server Frame Registry

> Profile: `session-ws-v1` (see [`docs/transport/transport-profiles.md`](../../docs/transport/transport-profiles.md))
> 状态: `frozen-v1`
> 上游 schema: `@haimang/nacp-session` `NacpSessionFrameSchema`
> 撰写: ZX2 Phase 4 P4-05 / 2026-04-27

---

## 0. 总览

`/sessions/{uuid}/ws` 是 nano-agent 唯一对外的 session WebSocket 入口。客户端 → 服务端的 frame 形状已经在 `clients/api-docs/session.md` 介绍；本文档专门描述 **服务端 → 客户端 frame** 的完整 registry，含字段、close codes、ack 语义、size 上限、heartbeat 超时、order 保证、resume 行为。

> ZX2 Phase 4 P4-04 决定：**WS 上的 frame 在 ZX2 仍以 lightweight `{kind, ...}` JSON 形态发送**，作为 v1 wire 兼容层；同一份 payload 可经 `workers/orchestrator-core/src/frame-compat.ts:liftLightweightFrame()` 转成符合 `NacpSessionFrameSchema` 的 NACP envelope，供 v2 客户端使用。session-ws-v2 将统一上 wire 形态，并保留 1 周 compat 窗口。

---

## 1. 连接建立

```text
wss://<facade>/sessions/{uuid}/ws
  ?access_token=<jwt>
  &trace_uuid=<uuid>
  &last_seen_seq=<integer>
```

| Query param | 必填 | 说明 |
|---|---|---|
| `access_token` | ✅ | JWT bearer。`authenticateRequest` allowQueryToken 接受这一兼容路径 |
| `trace_uuid` | ✅ | 与 HTTP `x-trace-uuid` 等价 |
| `last_seen_seq` | optional | 客户端最后已确认的 `seq`；服务端会 replay > last_seen_seq 的 frames |

### 1.1 子协议

无 `Sec-WebSocket-Protocol` 协商。如需协商，参考 nacp-session `NACP_SESSION_WS_SUBPROTOCOL` 常量（保留给 session-ws-v2）。

### 1.2 握手失败

| 失败原因 | HTTP 状态 | facade-http-v1 envelope.code |
|---|---|---|
| 缺 `access_token` | 401 | `invalid-auth` |
| JWT 校验失败 | 401 | `invalid-auth` |
| 缺 `trace_uuid` | 400 | `invalid-trace` |
| 缺 `team_uuid` claim | 403 | `missing-team-claim` |
| `TEAM_UUID` 未配置 | 503 | `worker-misconfigured` |

---

## 2. 帧通用结构（v1 lightweight）

每条服务端 frame 是单独的 JSON 文本消息，带 **顶层 `kind` 字段**。客户端按 `kind` switch 即可。

```typescript
type ServerFrame = {
  kind: string;        // 见 §3 registry
  // ... kind-specific fields
};
```

帧大小：**单帧 ≤ 256 KiB**。超过后服务端拒绝构造，且写入 `evidence.frame.oversized` 审计事件。

帧顺序：**服务端按 `seq` 递增写入**，客户端必须按收到顺序处理。`stream.ack(acked_seq)` 之前的帧服务端会保留在 `ReplayBuffer` 中至少 5 分钟。

---

## 3. Server-frame registry

| `kind` | NACP message_type | 触发条件 | body 字段 |
|---|---|---|---|
| `meta` | (compat → `session.stream.event`) | WS 连接建立成功后第一帧 | `seq=0`, `event="opened"`, `session_uuid` |
| `event` | `session.stream.event` | 每条 nacp-session stream event | `seq`, `name="session.stream.event"`, `payload` (即原始 NACP body) |
| `session.heartbeat` | `session.heartbeat` | 服务端定时探测客户端连通性 | `ts` (epoch ms) |
| `terminal` | `session.end` | 会话进入终态（completed / cancelled / error / timeout） | `seq`, `terminal` (枚举), `payload?` |
| `attachment_superseded` | (compat → `session.stream.event`) | 同一用户开新 WS 时旧连接被替换 | `reason="replaced_by_new_attachment"`, `new_attachment_at` |
| `session.permission.request` | `session.permission.request` | 服务端要求 user 授权某个 tool 调用 | `request_uuid`, `tool_name`, `tool_input`, `expires_at?`, `suggested_decision?` |
| `session.usage.update` | `session.usage.update` | usage / budget 高频推送 (≥1Hz auto-merge) | `llm_input_tokens?`, `llm_output_tokens?`, `tool_calls?`, `subrequest_used?`, `subrequest_budget?`, `estimated_cost_usd?` |
| `session.elicitation.request` | `session.elicitation.request` | 服务端要求 user 单轮回答 | `request_uuid`, `prompt`, `answer_schema?`, `expires_at?` |

### 3.1 `meta` (opened)
```json
{ "kind": "meta", "seq": 0, "event": "opened", "session_uuid": "..." }
```

### 3.2 `event`
```json
{
  "kind": "event",
  "seq": 12,
  "name": "session.stream.event",
  "payload": { /* 即 NACP session.stream.event body */ }
}
```

### 3.3 `session.heartbeat`
```json
{ "kind": "session.heartbeat", "ts": 1764259200000 }
```
- 默认间隔 30 秒（`CLIENT_WS_HEARTBEAT_INTERVAL_MS`）。
- 客户端连续 2 次未收到 → 视为连接死亡，可主动 close 后重连。

### 3.4 `terminal`
```json
{
  "kind": "terminal",
  "seq": 87,
  "terminal": "completed",
  "payload": { "phase": "ended" }
}
```
- `terminal` 取值: `completed | cancelled | error | timeout`
- 服务端紧接着 close WS（close code 见 §5）。

### 3.5 `attachment_superseded`
```json
{
  "kind": "attachment_superseded",
  "reason": "replaced_by_new_attachment",
  "new_attachment_at": "2026-04-27T08:00:00.000Z"
}
```
- 紧接着 close code 4001。

### 3.6 `session.permission.request` (ZX2 P5-03)
```json
{
  "kind": "session.permission.request",
  "request_uuid": "...",
  "tool_name": "Bash",
  "tool_input": { "command": "rm -rf /" },
  "expires_at": "2026-04-27T08:00:30.000Z",
  "suggested_decision": "deny"
}
```
- 客户端在 `expires_at` 前回复 `session.permission.decision` (client→server frame)。
- 默认 30 秒超时；超时按 `policy_permission_mode` 默认行为处理（deny）。

### 3.7 `session.usage.update` (ZX2 P5-03)
```json
{
  "kind": "session.usage.update",
  "llm_input_tokens": 1500,
  "llm_output_tokens": 800,
  "tool_calls": 3,
  "subrequest_used": 2,
  "subrequest_budget": 50
}
```
- 高频 push；服务端启用 ≥1Hz auto-merge 防 buffer 爆。
- 任意字段都是 cumulative since session start。

### 3.8 `session.elicitation.request` (ZX2 P5-03)
```json
{
  "kind": "session.elicitation.request",
  "request_uuid": "...",
  "prompt": "Pick a region (us-east-1 / eu-west-1)",
  "answer_schema": { "type": "string", "enum": ["us-east-1", "eu-west-1"] },
  "expires_at": "2026-04-27T08:01:00.000Z"
}
```
- 客户端用 `session.elicitation.answer` 回复（含 `cancelled?: true` 取消选项）。

---

## 4. Client → Server frames（兼容简表）

完整定义见 `clients/api-docs/session.md`。新增 frame：

| `message_type` | 说明 | body 字段 |
|---|---|---|
| `session.permission.decision` | 对 §3.6 的回复 | `request_uuid`, `decision`, `scope?`, `reason?` |
| `session.skill.invoke` | 客户端触发已注册 skill | `skill_name`, `args?`, `request_uuid?` |
| `session.command.invoke` | 客户端触发 slash command | `command_name`, `args?`, `request_uuid?` |
| `session.elicitation.answer` | 对 §3.8 的回复 | `request_uuid`, `answer`, `cancelled?` |

frame 形态遵循 `clients/api-docs/session.md` §3.x 的客户端 frame envelope（`{ message_type, body }`）。

---

## 5. Close-code 字典

| Code | 名称 | 触发 | 客户端建议动作 |
|---|---|---|---|
| 1000 | normal closure | terminal frame 后或客户端 close | 不重连 |
| 4001 | attachment_superseded | 同一用户的新 WS 抢占 | 不重连 |
| 4002 | session_completed | 终态后服务端关闭 | 不重连；从 `/me/sessions` 拉新 session |
| 4003 | session_cancelled | 用户 cancel 后服务端关闭 | 不重连 |
| 4004 | session_error | 内部错误后关闭 | 5 秒后重连一次；持续失败 → 报错给用户 |
| 4005 | session_timeout | 长时间无心跳 | 立即重连 |
| 4010 | invalid_frame | 客户端 frame 不通过 NACP 校验 | 修客户端代码；不要无脑重连 |
| 4011 | unauthorized_frame | 客户端发送了不允许的 frame（role/phase 不匹配） | 同上 |
| 1011 | unexpected condition | 服务器 panic | 5 秒后重连一次 |

---

## 6. ACK / Replay 语义

- 每条 server-emitted `event` 帧带递增 `seq`。
- 客户端**每收 N 帧（默认 N=8）或每 1 秒** 发送一次 `session.stream.ack(acked_seq)`。
- 服务端 `ReplayBuffer` 保留 ≥5 分钟或 ≥256 帧（取较大者）的未 ack 帧。
- 客户端重连时 query `last_seen_seq=<n>`，服务端按 `seq > n` 倒灌；若 `n` 已超出 buffer 边界，服务端发送 `terminal{terminal:"replay_lost"}` 并 close 4012。
- ack 不影响 D1 truth；timeline 永远以 D1 `session_truth` 为准。

---

## 7. Heartbeat / Timeout

- 服务端每 30 秒发 `session.heartbeat`（`CLIENT_WS_HEARTBEAT_INTERVAL_MS`）。
- 客户端在 2 个 interval 未收 → close 4005、立即重连。
- 客户端可发 client-frame `session.heartbeat`，服务端回写 `session.stream.ack(acked_seq=<latest>)`。
- 服务端在 5 分钟无任何客户端活动后主动 close 4005。

---

## 8. Frame ordering 保证

1. `meta(seq=0, opened)` 永远是连接后的第一帧。
2. `event(seq=k+1)` 之后的 `event` 帧 `seq` 严格递增（无 gap）。
3. `terminal` 帧的 `seq` 大于此前所有 `event.seq`。
4. `session.heartbeat` 不参与 seq 编号。
5. `attachment_superseded` 后服务端**立即** close 4001，不会再发其他帧。
6. `session.usage.update` 不参与 seq 编号（独立频率），客户端不应据此推断 ack 边界。
7. `session.permission.request` / `session.elicitation.request` 参与 seq 编号（与 event 同体系）。

---

## 9. Resume 行为

```text
连接 1 (seq 1..50, last_seen_seq=42)
   ↓ 网络中断
连接 2 (?last_seen_seq=42)
   ↓ 服务端 replay seq 43..50
   ↓ 服务端继续推 seq 51..
```

- 服务端会先推 `meta(opened, session_uuid)` 再 replay。
- 替换最后一个 attachment 触发 `attachment_superseded` + close 4001（参考 §3.5）；客户端收到后**不要**自动重连，因为新 WS 已建立。

---

## 10. Backwards-compat 提醒

- v1 wire 形态是 lightweight `{kind, ...}`；session-ws-v2 计划推 NACP envelope 的完整 frame。
- 老客户端（依赖 v1 形态）在 v2 上线后有 1 周 compat 窗口，期间服务端会同时支持两种 frame 形态。
- 新客户端代码应当以 NACP message_type 为主切换轴，不要 hard-code `kind` 字符串；用 `frame-compat.liftLightweightFrame()` 即可拿到 NACP shape。

---

## 11. 调试

- 浏览器 DevTools `Network → WS` 面板可直接看 frame。
- preview env 推荐通过 `wscat -c "wss://...?access_token=...&trace_uuid=...&last_seen_seq=0"` 手动握手。
- 服务端 worker logs (cloudflare observability) 会带 `trace_uuid` / `session_uuid` / `seq`，可与 D1 `session_truth` 关联回放。
