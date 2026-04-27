# State of Transportation by GPT

## 0. 结论先行

本次审查结论是：**6-worker 的安全边界总体正确，内部 NACP 核心协议已经高度统一，但运行时 transport 仍处于混合迁移态，并未完成“全 RPC 化”。** 当前最重要的风险不是明显的越权漏洞，而是接口形状和 transport profile 没有被统一命名、版本化和文档化，容易在后续前端/API 扩展时重新碎片化。

最核心的事实如下：

| 维度 | 当前判断 |
|---|---|
| 沟通拓扑 | `orchestrator-core` 是唯一业务 public facade；其余 worker 通过 binding/DO/内部 relay 被调用 |
| 安全边界 | public JWT/trace/team 校验、User DO 按 `user_uuid` 隔离、内部 relay 通过 binding secret + authority parity 校验，整体正确 |
| 内部 HTTP 退役 | 未完成；auth 已 RPC 化，agent `start/status` 在做 RPC parity，其他 session/capability 路径仍是内部 HTTP/profile |
| RPC 请求/响应统一性 | NACP-Core 内部 envelope 强统一；但 auth RPC、agent parity RPC、session HTTP、WS frame 仍是不同 profile |
| context 参考材料 | 当前 checkout 没有 `context/` 源码树；只能依据 `docs/investigation/*claude*/*codex*` 文档审查；未找到 gemini-cli 证据 |
| 对外 HTTP/WS 缺口 | 需要补 session list/metadata/context/capability discovery/usage-cache/model config，以及正式 WS server-frame registry |

## 1. Todo-list 与执行状态

| Todo | 状态 | 产物 |
|---|---:|---|
| 审查 6-worker 通信拓扑与安全边界 | done | `.tmp/transportation-topology-security.md` |
| 调查内部安全边界内 HTTP 退役进度 | done | `.tmp/internal-http-retirement.md` |
| 调查内部 RPC 请求/响应格式统一性 | done | `.tmp/rpc-shape-unification.md` |
| 查看 claude-code/codex/gemini-cli 上下文需求 | done with limitation | `.tmp/context-and-external-api-gaps.md` |
| 查看 `clients/api-docs/` 并判断对外 HTTP/WS 缺口 | done | `.tmp/context-and-external-api-gaps.md` |
| 持久化关键子发现 | done | `.tmp/*.md` |
| 撰写最终调查报告 | done | 本文件 |

## 2. 6-worker 沟通矩阵与安全边界

当前真实 worker 是：

1. `workers/orchestrator-core`
2. `workers/orchestrator-auth`
3. `workers/agent-core`
4. `workers/bash-core`
5. `workers/context-core`
6. `workers/filesystem-core`

### 2.1 拓扑矩阵

| From | To | Transport | 用途 | 备注 |
|---|---|---|---|---|
| client | `orchestrator-core` | public HTTP / WS | auth、session、debug health | 唯一业务 public facade |
| `orchestrator-core` | `orchestrator-auth` | WorkerEntrypoint RPC | register/login/refresh/me/verify/reset/wechat | auth 业务无公开 HTTP |
| `orchestrator-core` | `NanoOrchestratorUserDO` | DO `fetch` | 每用户 session 路由、WS attach | DO id 来自 JWT `user_uuid` |
| User DO | `agent-core` | service binding `fetch` + typed `start/status` parity | session runtime | 内部 HTTP/RPC 混合 |
| `agent-core` | `NanoSessionDO` | DO `fetch` | session-local runtime | 平台本地 DO routing |
| session runtime | `bash-core` | service binding HTTP profile | capability call/cancel | 应归档为 internal transport profile |
| `orchestrator-core` | 其他五 worker | service binding `fetch /health` | debug health | operational probe |

### 2.2 public facade 规则

`clients/api-docs/README.md:1-23` 已经把前端访问面限定为 `orchestrator-core`，并明确不应直接访问 `orchestrator-auth / agent-core / bash-core / context-core / filesystem-core`。这和代码结构一致：`orchestrator-core` 通过 `OrchestratorCoreEnv` 绑定五个 worker（`workers/orchestrator-core/src/index.ts:10-30`），并通过 `/debug/workers/health` 聚合健康状态（`workers/orchestrator-core/src/index.ts:121-150`）。

### 2.3 public ingress 校验

`orchestrator-core` 对 session routes 的入口校验是正确的：

- 解析 bearer token 或 WS query token：`workers/orchestrator-core/src/auth.ts:151-160`
- 校验 JWT：`workers/orchestrator-core/src/auth.ts:171-196`
- 要求 `x-trace-uuid` 或 query `trace_uuid`：`workers/orchestrator-core/src/auth.ts:197-202`
- 要求 `team_uuid` 或 legacy `tenant_uuid`：`workers/orchestrator-core/src/auth.ts:205-213`
- 构造 `IngressAuthSnapshot`，写入 `team_uuid`、`tenant_uuid`、`tenant_source: "claim"`：`workers/orchestrator-core/src/auth.ts:220-230`
- User DO 以认证后的 `user_uuid` 命名：`workers/orchestrator-core/src/index.ts:300`

这意味着用户隔离不是依赖客户端传参，而是绑定在 JWT claim 和 DO name 上。

### 2.4 internal relay 校验

User DO 到 `agent-core` 的内部 relay 要求内部 secret：

- 如果 `NANO_INTERNAL_BINDING_SECRET` 缺失，User DO 直接返回 503：`workers/orchestrator-core/src/user-do.ts:1473-1478`
- 转发 header 包含 `x-nano-internal-binding-secret`、`x-trace-uuid`、`x-nano-internal-authority`：`workers/orchestrator-core/src/user-do.ts:1495-1507`

`agent-core` 侧再做二次校验：

- secret 不存在或不匹配都会 401：`workers/agent-core/src/host/internal-policy.ts:149-163`
- trace 必须是 UUID：`workers/agent-core/src/host/internal-policy.ts:165-174`
- authority header 必须是合法 JSON，且必须包含非空 `tenant_uuid`：`workers/agent-core/src/host/internal-policy.ts:176-209`
- body 中的 `trace_uuid` 不能和 header 不一致：`workers/agent-core/src/host/internal-policy.ts:241-249`
- body 中的 `authority` / `auth_snapshot` 不能和 header authority 不一致：`workers/agent-core/src/host/internal-policy.ts:251-268`

所以内部 HTTP 虽然还存在，但不是裸 HTTP；它已经带有 secret + authority parity 的安全边界。

## 3. 内部 HTTP 退役进度

### 3.1 已 RPC 化或接近 RPC 化

`orchestrator-auth` 是最清晰的 RPC 化 worker。它的 public `fetch` 只处理 health/probe；业务方法通过 WorkerEntrypoint methods 暴露，包括 `register/login/refresh/me/verifyToken/resetPassword/wechatLogin/verifyApiKey`（`workers/orchestrator-auth/src/index.ts:61-100`，`workers/orchestrator-auth/src/public-surface.ts:27-39`）。

`agent-core` 的 `start/status` 正在做 RPC parity 迁移。User DO 先走内部 fetch，再在存在 `AGENT_CORE.start/status` 时调用 typed method，并检查两边 status/body 是否一致（`workers/orchestrator-core/src/user-do.ts:719-790`）。这是良好的“退役前并跑校验”模式。

### 3.2 仍在内部 HTTP profile 上的路径

仍处于内部 HTTP/profile 的路径包括：

- User DO -> `agent-core /internal/sessions/{id}/{action}`：`workers/orchestrator-core/src/user-do.ts:1468-1508`
- `agent-core /internal/*` -> Session DO：`workers/agent-core/src/host/internal.ts:53-85`
- internal stream synthesis：`workers/agent-core/src/host/internal.ts:107-166`
- `bash-core /capability/call` 和 `/capability/cancel`：`workers/bash-core/src/index.ts:361-374`
- health probes：`workers/orchestrator-core/src/index.ts:87-118`

这些路径应分三类处理：

| 类型 | 是否需要退役 | 说明 |
|---|---:|---|
| public HTTP/WS | no | facade 必须保留 |
| health/probe HTTP | no | operational profile，可保持 |
| DO-local `stub.fetch()` | usually no | 平台本地路由，可保持 |
| internal service-binding HTTP | yes/phase | 应逐步改成 typed RPC 或 `handleNacp()` |

### 3.3 退役优先级

建议优先级：

1. 为 `agent-core` 补齐 `input/cancel/timeline/history/verify/stream/ws` 的 typed interface 或 NACP handler，而不是只保留 `start/status`。
2. 将 `bash-core` capability call/cancel 正式归入 NACP `tool.call.*`，或明确其当前 service-binding HTTP profile 是过渡期协议。
3. 保留 health 和 public facade HTTP，不纳入退役目标。

## 4. 内部 RPC 请求/响应格式统一性

### 4.1 NACP-Core 是强统一的

NACP-Core 的统一性很好：

- `NacpEnvelope` 是内部消息唯一容器，包含 header/authority/trace/control/body/refs/extra（`packages/nacp-core/src/envelope.ts:1-10`, `87-126`, `104-112`）。
- 消息注册走单一 registry：`packages/nacp-core/src/envelope.ts:248-271`。
- `validateEnvelope()` 做结构、tenant、registry、version、body、role、direction 七类检查：`packages/nacp-core/src/envelope.ts:279-375`。
- `ServiceBindingTransport` 在 dispatch 前执行 `validateEnvelope -> verifyTenantBoundary -> checkAdmissibility`：`packages/nacp-core/src/transport/service-binding.ts:37-67`。

核心消息体也比较统一：

| Message | Response |
|---|---|
| `tool.call.response` | `{status:"ok"|"error", output?, error?}` |
| `skill.invoke.response` | `{status:"ok"|"error", result?, error?}` |
| `context.compact.response` | `{status:"ok"|"error", summary_ref?, tokens_before?, tokens_after?, error?}` |
| `hook.outcome` | `{ok, block?, updated_input?, additional_context?, stop?, diagnostics?}` |

`hook.outcome` 是有意偏离，因为它表达 control-flow，不只是 success/error。

### 4.2 运行时仍存在的 shape 碎片

虽然 NACP-Core 统一，但运行中仍有多种 profile：

| Profile | Shape | 例子 |
|---|---|---|
| NACP internal | `NacpEnvelope` | `packages/nacp-core/src/envelope.ts` |
| Auth RPC/public auth | `{ok,data}` / `{ok:false,error:{code,status,message}}` | `clients/api-docs/auth.md:28-67` |
| Agent parity RPC | `{status, body}` | `workers/orchestrator-core/src/index.ts:12-21` |
| Session HTTP JSON | action-specific `{ok, action, session_uuid, ...}` | `workers/orchestrator-core/src/user-do.ts:1232-1272` |
| WS/stream frames | `kind`-based server frames vs `message_type` client frames | `workers/orchestrator-core/src/user-do.ts:1307-1317`, `clients/api-docs/session.md:52-58` |

因此准确表述应该是：**内部核心协议统一，但六 worker 运行面还没有把所有 transport profile 收敛成同一种请求/响应 envelope。**

### 4.3 推荐统一规则

建议明确三层，不要混用：

1. **Internal NACP RPC**：必须是 `NacpEnvelope`，使用 `status/error` body pattern 或 `hook.outcome` control-flow exception。
2. **Internal compatibility profile**：如当前 agent internal HTTP，应有版本化文档，字段包括 trace/authority/secret/parity 规则。
3. **External facade HTTP/WS**：HTTP 统一 `{ok:true,data,trace_uuid?}` / `{ok:false,error:{code,status,message},trace_uuid?}`；WS 统一 `{message_type, seq, trace_uuid, session_uuid, body, error?}`。

## 5. context/claude-code、context/codex、context/gemini-cli 审查结论

### 5.1 证据限制

当前 checkout 中，`glob context/**` 没有匹配到 `context/` 源码树。因此本次无法直接审查 `context/claude-code`、`context/codex`、`context/gemini-cli` 源码。可用材料是 `docs/investigation/` 下已有调查文档：

- `docs/investigation/claude-code-by-GPT.md`
- `docs/investigation/claude-code-by-opus.md`
- `docs/investigation/codex-by-GPT.md`
- `docs/investigation/codex-by-opus.md`

同时，本次没有找到 `gemini-cli` 的源码或调查文档。因此 Gemini 相关需求必须列为待补证据，不能假装已经完成代码审查。

### 5.2 Claude Code / Codex 给 orchestrator-core 的接口启发

从已有调查文档看，Claude Code 对我们最有价值的是：

- 多 provider auth/client 构造、流式请求、非流式 fallback、usage 累积（`docs/investigation/claude-code-by-GPT.md:86-131`）
- Retry-After、rate-limit reset、persistent retry、模型 fallback（`docs/investigation/claude-code-by-opus.md:90-94`）
- prompt cache break detection 和 cache usage 观测（`docs/investigation/claude-code-by-opus.md:91-95`）
- richer hooks：shell/prompt/HTTP/agent，SSRF guard，URL/env allowlist，policy gate（`docs/investigation/claude-code-by-opus.md:139-208`）
- skill、sub-agent、tool discovery 元数据（`docs/investigation/claude-code-by-opus.md:352-403`）

Codex 对我们最有价值的是：

- transport / wire types / business session client 三层分离（`docs/investigation/codex-by-GPT.md:99-132`）
- SSE/WS、turn-level session state、thread/store/resume 方向（`docs/investigation/codex-by-GPT.md:106-150`）
- hook 与 local context injection 模型（`docs/investigation/codex-by-opus.md:123-165`）

### 5.3 orchestrator-core 还需要提供的接口

`orchestrator-core` 已经在代码上支持 session 基础动作路由：`start/input/cancel/status/timeline/history/verify/ws`（`workers/orchestrator-core/src/index.ts:190-197`, `292-325`），User DO 也实现了这些 action 的处理入口（`workers/orchestrator-core/src/user-do.ts:383-429`）。其中 `status/timeline/history` 的读取处理在 `handleRead()` 中（`workers/orchestrator-core/src/user-do.ts:1232-1272`）。

因此缺口不是“这些路由完全没有实现”，而是：

1. `status/timeline/history` 缺少正式 response schema、分页/cursor、字段稳定性说明。
2. 缺当前用户 session list：`GET /sessions?cursor=&status=&limit=`。
3. 缺 session metadata/context view：`GET /sessions/{id}/metadata` 或合并到 status；`GET /sessions/{id}/context`。
4. 缺 context compact facade：`POST /sessions/{id}/context/compact`，对应 NACP `context.compact.request/response`。
5. 缺 tool/skill/hook/capability discovery：例如 `GET /capabilities`。
6. 缺 model/provider/reasoning/effort 配置读取与安全可见范围。
7. 缺 usage/cost/cache telemetry 的前端查询字段。

## 6. `clients/api-docs/` 对外 HTTP/WS 缺口

### 6.1 当前文档覆盖

`clients/api-docs/` 当前有：

- `README.md`：public facade 与 common rules（`clients/api-docs/README.md:1-23`）
- `auth.md`：auth route 和 auth envelope（`clients/api-docs/auth.md:1-102`）
- `session.md`：session routes 和少量 WS client frame（`clients/api-docs/session.md:1-65`）
- `wechat-auth.md`
- `worker-health.md`：6-worker health 聚合（`clients/api-docs/worker-health.md:1-57`）

### 6.2 对外 HTTP 建议补充

建议新增或扩充以下接口：

| API | Method | 建议 shape | 目的 |
|---|---|---|---|
| `/sessions` | GET | `{ok,data:{sessions,next_cursor}}` | 当前用户 session 列表、恢复入口 |
| `/sessions/{id}/metadata` | GET | `{ok,data:{session_uuid,status,title,created_at,last_seen_at,model,usage}}` | 前端会话详情 |
| `/sessions/{id}/status` | GET | 固化当前实现字段，包含 `durable_truth?` | 状态刷新 |
| `/sessions/{id}/timeline` | GET | `{events,next_cursor}` | timeline 分页 |
| `/sessions/{id}/history` | GET | `{messages,next_cursor}` | transcript 分页 |
| `/sessions/{id}/context` | GET | `{phase,messages_count,estimated_tokens,layers,compact_available}` | context 面板 |
| `/sessions/{id}/context/compact` | POST | `{target_token_budget,strategy?}` -> `{ok,data:{tokens_before,tokens_after,summary_ref?}}` | 手动压缩 |
| `/capabilities` | GET | `{tools,skills,hooks}` | 前端展示可用能力 |
| `/models` | GET | `{providers,models,defaults}` | 模型选择/能力提示 |
| `/sessions/{id}/usage` | GET | `{tokens,cost,cache,latency}` | usage/cache/cost 观测 |

外部 HTTP envelope 建议统一为：

```json
{
  "ok": true,
  "data": {},
  "trace_uuid": "..."
}
```

错误统一为：

```json
{
  "ok": false,
  "error": {
    "code": "string",
    "status": 400,
    "message": "string"
  },
  "trace_uuid": "..."
}
```

这与 `auth.md` 当前 error shape 兼容，只需要把 session/health/debug 的 action-specific response 逐步包进 facade profile。

### 6.3 WebSocket 建议补充

`clients/api-docs/session.md:52-58` 只描述了客户端应发送的 compatibility frames：

- `session.resume`
- `session.heartbeat`
- `session.stream.ack`

但代码里的服务端 frame 更接近 `kind` profile：

- heartbeat：`{kind:"session.heartbeat", ts}`（`workers/orchestrator-core/src/user-do.ts:1307-1317`）
- internal stream meta/event/terminal：`workers/agent-core/src/host/internal.ts:125-166`

建议定义正式 server-to-client registry：

| message_type | body |
|---|---|
| `session.opened` | `{session_uuid, attached_at}` |
| `session.heartbeat` | `{ts}` |
| `session.event` | `{event}` |
| `session.delta` | `{stream_uuid, text}` |
| `session.tool.start` | `{tool_name, call_uuid}` |
| `session.tool.result` | `{call_uuid, status, output?, error?}` |
| `session.error` | `{code,message,retriable?}` |
| `session.terminal` | `{terminal, phase}` |
| `session.attachment_superseded` | `{reason,new_attachment_at}` |

统一 frame envelope：

```json
{
  "message_type": "session.event",
  "seq": 12,
  "trace_uuid": "...",
  "session_uuid": "...",
  "body": {}
}
```

并补充：

1. `last_seen_seq` resume 语义。
2. ack 是否必需、ack 后服务端是否释放 buffer。
3. heartbeat interval 与超时关闭策略。
4. 单 frame body 大小上限。
5. server frame 顺序保证。
6. close code registry。

## 7. 风险与行动建议

### 7.1 风险

| 风险 | 严重度 | 说明 |
|---|---:|---|
| transport profile 未命名导致碎片扩散 | high | NACP、auth、agent parity、session HTTP、WS frame 当前并存 |
| 内部 HTTP 退役状态不明确 | medium | start/status 有 parity，其他 action 仍是 HTTP relay |
| WS 文档和实现 frame shape 不一致 | medium | 文档是 `message_type`，实现多处是 `kind` |
| context/gemini-cli 证据缺失 | medium | 当前 checkout 无源码树，不能完成该项事实审查 |
| 外部 session API response schema 不稳定 | medium | status/timeline/history 有代码实现但文档缺字段/pagination |

### 7.2 建议执行顺序

1. **冻结 transport profile 名称**：`nacp-internal`、`internal-http-compat`、`facade-http-v1`、`session-ws-v1`、`health-probe`。
2. **补文档而不是先重构**：先把当前真实 HTTP/WS shape 写清楚，尤其是 session read 和 WS server frames。
3. **补 agent-core typed contract**：把 `input/cancel/timeline/history/verify/stream` 纳入 typed RPC 或 NACP handler。
4. **收敛外部 HTTP envelope**：新 API 全部使用 `{ok,data}` / `{ok,false,error}`，旧 action-specific response 标注 legacy。
5. **补 frontend 功能 API**：session list、metadata、context view/compact、capability discovery、usage/cache。
6. **重新补证 context/gemini-cli**：把缺失的 `context/` source 或 Gemini 调查文档纳入仓库后，再做一次针对性审查。

## 8. 最终判断

当前系统的方向是正确的：`orchestrator-core` 作为 public facade，`orchestrator-auth` RPC 化，session runtime 通过 User DO 和 Agent Session DO 分层，NACP-Core 作为内部协议核心。真正需要改进的是“迁移中间态”的治理：内部 HTTP 不能只靠大家口头理解，必须成为有名称、有边界、有退役计划的 compatibility profile；对外 HTTP/WS 也不能直接暴露内部 action-specific shape，而应形成稳定 frontend facade profile。

如果下一步只做一件事，应先冻结并补齐 **`session-ws-v1` 与 `facade-http-v1` 文档**，因为它们最直接影响前端功能扩展，也最容易和内部 NACP shape 产生长期碎片。

---

## ZX2 落地标注（2026-04-27）

本报告提出的全部 7 项风险（包括 transport profile 未命名、internal HTTP 退役不明、外部 envelope 不稳定等）已被 ZX2 行动计划落地解决：

- §7.2 §6.3 §3.3 — 5 transport profile 命名冻结、`session-ws-v1.md` server-frame registry、`facade-http-v1` 公约扩展。
- §3.2 §3.3 — agent-core `input/cancel/verify/timeline/streamSnapshot` 全部 RPC + dual-track parity；bash-core 提升 `WorkerEntrypoint` + NACP authority（含 caller / source / request_uuid）。
- §6.2 — 5 facade-必需端点 (`/sessions/{id}/permission/decision`, `policy/permission_mode`, `usage`, `resume`, `/catalog/{skills,commands,agents}`) + `/me/sessions` server-mint 全部 ship。
- §6.3 — server WS frame 形态对齐 `NacpSessionFrameSchema`（compat 层映射现有 `{kind,...}`）。
- §7.1 — Gemini-CLI 证据缺失列入 ZX2 plan §2.2 [O13]，留给后续 plan 补齐 investigation 后再评估。

详细执行日志见 `docs/action-plan/zero-to-real/ZX2-transport-enhance.md` §12 与收尾文件 `docs/issue/zero-to-real/ZX2-closure.md`。
