# session-ws-v1

> Public facade owner: `orchestrator-core`
> Profile: `session-ws-v1`
> 当前 wire: **lightweight JSON `{kind,...}`**

## Base URLs

| 环境 | WS base URL |
|---|---|
| preview | `wss://nano-agent-orchestrator-core-preview.haimang.workers.dev` |
| production | `wss://nano-agent-orchestrator-core.haimang.workers.dev` |

## Connect URL

```text
wss://<base>/sessions/{sessionUuid}/ws
  ?access_token=<jwt>
  &trace_uuid=<uuid>
  &last_seen_seq=<integer>
```

| Query param | 必填 | 说明 |
|---|---|---|
| `access_token` | ✅ | 当前 WS 鉴权仍走 query token compatibility |
| `trace_uuid` | ✅ | 与 HTTP `x-trace-uuid` 同义 |
| `last_seen_seq` | optional | reconnect 时提供客户端最后见到的 event seq |

## Handshake failures

握手失败时，不会升级为 WS，而是直接返回 HTTP JSON 错误。  
需要注意：**auth/trace 失败**来自 facade ingress，通常是 facade error envelope；**session missing / terminal** 来自 User DO 直返，当前仍是 raw legacy JSON。

| HTTP | `error.code` | 触发 |
|---|---|---|
| 400 | `invalid-trace` | 缺或非法 `trace_uuid` |
| 401 | `invalid-auth` | 缺或非法 `access_token` |
| 403 | `missing-team-claim` | JWT 无 team claim |
| 404 | `session_missing` | session 不存在 |
| 409 | `session_terminal` | session 已终态，不能再 attach |

## Current live server frames

当前 public WS relay **真实会发**的只有下面 4 类：

| `kind` | 何时出现 | 示例 |
|---|---|---|
| `event` | 正常 stream replay / live relay | `{"kind":"event","seq":1,"name":"session.stream.event","payload":{...}}` |
| `session.heartbeat` | 连接建立后每 15 秒 | `{"kind":"session.heartbeat","ts":1760000000000}` |
| `attachment_superseded` | 同一 session 建立了新 WS，旧连接被替换 | `{"kind":"attachment_superseded","reason":"replaced_by_new_attachment","new_attachment_at":"..."}` |
| `terminal` | 已附着连接在终态时被服务端通知 | `{"kind":"terminal","terminal":"cancelled","session_uuid":"...","last_phase":"ended"}` |

### `event`

```json
{
  "kind": "event",
  "seq": 12,
  "name": "session.stream.event",
  "payload": {
    "kind": "llm.delta",
    "content_type": "text",
    "content": "Hello",
    "is_final": false
  }
}
```

### `session.heartbeat`

```json
{ "kind": "session.heartbeat", "ts": 1760000000000 }
```

> 当前 heartbeat 间隔是 **15 秒**。

### `attachment_superseded`

```json
{
  "kind": "attachment_superseded",
  "reason": "replaced_by_new_attachment",
  "new_attachment_at": "2026-04-27T08:00:00.000Z"
}
```

紧接着服务端会关闭旧连接，close code = `4001`。

### `terminal`

```json
{
  "kind": "terminal",
  "terminal": "completed",
  "session_uuid": "11111111-1111-4111-8111-111111111111",
  "last_phase": "ended"
}
```

紧接着服务端会关闭连接，close code = `1000`。

## Important current limitations

下面这些点在当前文档里必须按**未落地**处理：

1. **当前 public WS 不会先发 `meta(opened)` frame**
2. **当前 public WS 不会 live 发 `session.permission.request`**
3. **当前 public WS 不会 live 发 `session.usage.update`**
4. **当前 public WS 不会 live 发 `session.elicitation.request`**
5. **当前服务端不会真正解析/消费客户端发来的 ack / resume / permission / elicitation body**

也就是说，虽然 `@haimang/nacp-session` 已经定义了这些 schema，**但当前 public relay 还没有把它们变成 live wire behavior**。

## Client → server messages

当前 web / wechat 客户端仍建议发下面三种 compatibility frames：

```json
{ "message_type": "session.resume", "body": { "last_seen_seq": 0 } }
{ "message_type": "session.heartbeat", "body": { "ts": 1760000000000 } }
{ "message_type": "session.stream.ack", "body": { "stream_uuid": "main", "acked_seq": 12 } }
```

但需要明确：

- 当前服务端**不会**验证这些 body
- 当前服务端**不会**据此推进 ack / replay 状态机
- 任何传入 WS message 当前都只会起到“touch session 活跃时间”的作用

因此，当前 authoritative 行为是：

| 能力 | 当前真实入口 |
|---|---|
| replay 起点 | WS query `last_seen_seq` |
| resume hint | HTTP `POST /sessions/{uuid}/resume` |
| 丢帧后补齐 | HTTP `GET /sessions/{uuid}/timeline` |

## Reconnect recommendation

1. 本地记住收到的最大 `event.seq`
2. 重连时带 `?last_seen_seq=<maxSeq>`
3. 如发现本地状态和服务端不一致，再补 `POST /sessions/{uuid}/resume`
4. 如果仍不确定，以 `GET /sessions/{uuid}/timeline` 为最终对账入口

## Close codes

| Code | 含义 | 当前事实 |
|---|---|---|
| `4001` | `attachment_superseded` | 新连接替换旧连接 |
| `1000` | normal close | 当前服务端在 terminal 通知后使用 |

除这两种外，其余关闭多数来自浏览器、网络或 Cloudflare 平台，不应在客户端里假定有完整自定义 close-code 字典。
