# State of Transportation — by Opus 4.7

> 作者: Opus 4.7 (1M context) · 2026-04-27
> 主题: nano-agent 6-worker 内部/外部接口审查 — 拓扑、安全边界、HTTP→RPC 退役、形状统一、对前端的接口缺口
> 子素材：`.tmp/topology.md`, `.tmp/internal-http-retirement.md`, `.tmp/rpc-shapes.md`, `.tmp/cli-host-gaps.md`, `.tmp/external-api-gaps.md`

---

## TL;DR — 体检结论

| 维度 | 状态 | 评分 |
|---|---|---|
| 6-worker 通讯拓扑清晰、安全边界设计合理 | orchestrator-core 是唯一公网 facade；其余 worker 均经 service-binding 到达 | **B+** |
| auth 通路 RPC 化 | 100% 完成、共享 zod envelope | **A** |
| agent-core 通路 RPC 化 | dual-track parity 仅覆盖 `start/status` (28%) | **C** |
| bash-core 通路 RPC 化 | 未启动；缺 internal authority 校验，安全形态与 orchestrator→agent 不对称 | **D** |
| context-core / filesystem-core | library-only worker，正确退化为静态包 + health probe | **A** |
| RPC envelope 一致性 | 3 种 envelope + 4 种 error shape 并存，需统一 | **C-** |
| 对外 API 形状一致性 | session 路径 vs auth 路径外层 envelope 不同 | **C** |
| 对外 API 完备度（与 claude-code/codex/gemini-cli 对比） | 缺 permission/usage/elicitation/catalog 等 5 类高阶能力 | **C** |

总体：**结构正确、退役过半、形状未收**。

---

## 1. 6-worker 通讯拓扑与安全边界

### 1.1 binding 矩阵

| 调用方 ↓ \ 被调方 → | orchestrator-auth | orchestrator-core | agent-core | bash-core | context-core | filesystem-core | D1 | DO |
|---|---|---|---|---|---|---|---|---|
| **orchestrator-core** | RPC svc-bind | self | RPC + HTTP svc-bind | svc-bind (健康探针) | svc-bind (健康探针) | svc-bind (健康探针) | shared D1 | `ORCHESTRATOR_USER_DO` |
| **orchestrator-auth** | self | — | — | — | — | — | shared D1 | — |
| **agent-core** | — | — | self | HTTP svc-bind (capability) | (注释，不启用) | (注释，不启用) | shared D1 | `SESSION_DO` |
| **bash-core** | — | — | — | self | — | — | — | `CAPABILITY_CALL_DO` |
| **context-core** | — | — | — | — | self | — | — | — |
| **filesystem-core** | — | — | — | — | — | self | — | — |

> **关键事实**：6 个 worker 中，只有 **agent-core** 在 `wrangler.jsonc` 显式 `workers_dev: true`。其他 5 个未显式设为 `false`，按 wrangler 4 默认仍可能在 `*.workers.dev` 上被访问；建议立刻审计每个 worker 的 deploy 状态，确认非公开 worker 已真正下线公网入口。

### 1.2 安全边界与信任令牌

```
                 Public Internet
                        │  HTTPS + Bearer JWT (or ?access_token=)
                        ▼
                 orchestrator-core              ← 唯一 JWT-aware 边缘
                        │  service-binding (privileged hop)
                        │  + x-nano-internal-binding-secret
                        │  + x-nano-internal-authority   (= IngressAuthSnapshot)
                        │  + x-trace-uuid
            ┌───────────┼──────────────────────────┐
            ▼           ▼                          ▼
   orchestrator-auth   agent-core (fetch + RPC)    [bash/context/fs probes only]
                            │  service-binding
                            │  (NO internal-binding-secret — 风险点)
                            ▼
                       bash-core
                       (fetch only; 无 RPC，无 secret 校验)
```

**信任栈**：
1. **公网入口**：`Authorization: Bearer <jwt>`（HS-256，kid-aware via `JWT_SIGNING_KEY_<kid>`，legacy `JWT_SECRET` 兜底）。
2. **orchestrator-core ⇒ agent-core**：`NANO_INTERNAL_BINDING_SECRET` 头部 + 序列化的 `IngressAuthSnapshot`（claim-backed 或 deploy-fill）+ `x-trace-uuid`。`validateInternalAuthority()` 强校验，且 body 内嵌的 `trace_uuid` / `authority` 必须与 header 完全相等（防止 body-vs-header 提权）。
3. **agent-core ⇒ bash-core**：仅 `content-type: application/json` + 可选 cross-seam header；**没有** secret/authority 校验。

### 1.3 安全发现
- **风险 P0**：bash-core 缺 internal-binding-secret 校验。如果 bash-core 公网入口未关闭，匿名 `POST /capability/call` 即可触发能力执行。
- **风险 P1**：orchestrator-core 同时 service-bind 了 BASH_CORE / CONTEXT_CORE / FILESYSTEM_CORE，但只用作 health 探针。这增加了 attack surface（未来误用为业务路由可绕过 agent-core 的 authority pipeline），建议在 wrangler 用注释标记 `// health-only` 并在 fetch 入口前面做 binding scope 校验。
- **风险 P2**：agent-core 的 internal `/internal/sessions/...` fetch handler 与公网 fetch handler 在同一 worker；目前公网 path 通过 `LEGACY_SESSION_ACTIONS` 拒绝（410/426），但代码读起来仍要靠路径分发。建议未来分裂入口（要么用单独 prefix `/_internal/`，要么用单独 worker）。

### 1.4 库化做对了
context-core / filesystem-core 现在是 **library-only worker**：
- `index.ts` 33 行，只服务 `/health`，业务逻辑全部在 `@haimang/context-management` / `@haimang/workspace-context-artifacts` 包，被 agent-core 静态导入并 in-process 调用。
- 这是 W3.A 决策的正确收尾，消除了"为存在而存在"的 worker。**部署它们的唯一价值是给 health snapshot 一个固定字段**；建议保留作为未来真 RPC 升级的占位（同时也让 wrangler.jsonc 注释里那条 "P3 / P4 absorb code, host-local for now" 的话变成 codified 决策）。

详见 `.tmp/topology.md`。

---

## 2. 内部 HTTP 退役进度

### 2.1 当前 wire 表

| 调用对 | 路径 | 当前 wire | 状态 |
|---|---|---|---|
| orchestrator-core ↔ orchestrator-auth | `<8 method>` | **RPC** (WorkerEntrypoint) | ✅ 已退役 |
| orchestrator-core ↔ agent-core (DO) | `https://agent.internal/internal/sessions/:id/{start\|input\|cancel\|status\|timeline\|verify\|stream}` | **HTTP** (含 secret + authority headers) | ⚠️ HTTP 真相，RPC shadow 仅 `start/status` |
| agent-core ↔ bash-core | `POST /capability/{call\|cancel}` | **HTTP** | ❌ 未启动 |
| orchestrator-core ↔ bash/context/fs | `GET /health` | HTTP probe | n/a |

### 2.2 dual-track parity 模式（已经在跑的可观察护栏）
orchestrator-core `forwardStart()` / `forwardStatus()` 同时调：
1. `forwardInternalJson()`（HTTP 真相）；
2. `env.AGENT_CORE.start()` / `.status()`（RPC 影子）。

二者 `status + body` 用 `jsonDeepEqual` 比对，不一致立刻 502 `agent-rpc-parity-failed`。一致则返回 RPC 结果。

> **意义**：这是教科书级的 progressive migration——HTTP 仍是真相，RPC 是 read-only shadow，靠 parity 校验确认 RPC 路径不会引入 regression。完成 5 个剩余动作 (`input/cancel/verify/timeline/stream`) 的 shadow 后，可以将 truth 翻转到 RPC，再删除 fetch 路径。

### 2.3 退役评分

| Worker pair | HTTP 仍在 | RPC 进度 | 评分 |
|---|---|---|---|
| orchestrator-core → auth | ❌ | ✅ 完整 | **A** |
| orchestrator-core → agent | ✅ | ⚠️ 28% (2/7) | **C** |
| agent → bash | ✅ | ❌ 0% | **D** |
| agent → context/fs | n/a (in-process) | n/a | **A** |
| orchestrator-core → bash/context/fs | health only | n/a | **A** |

### 2.4 推荐路径
1. **补完 agent-core 的 5 个 RPC method shadow**（`input`, `cancel`, `verify`, `timeline`, 把 `stream` 单独做成 NDJSON / 不走 RPC）。
2. **bash-core 起 RPC 入口**：建议直接照抄 orchestrator-auth 的 contract 模式，导出 `WorkerEntrypoint` + zod 校验 + `Envelope<T>`。
3. **bash-core 加 internal-authority 校验**：与 orchestrator→agent 形态一致（即使是同一可信平面，对称比例外更可维护）。

详见 `.tmp/internal-http-retirement.md`。

---

## 3. 内部 RPC 形状碎片化

### 3.1 三种 envelope 并存

| 来源 | 成功形状 | 错误形状 |
|---|---|---|
| **orchestrator-auth-contract** | `{ ok:true, data:T }` | `{ ok:false, error: { code, message, status } }` |
| **agent-core RPC** | `{ status: number, body: Record<string,unknown> \| null }`（"小 HTTP"） | 同上，`status >= 400 && body.{error,message}` |
| **bash-core capability** | `{ status: 'ok', output? }` (NACP tool envelope) | `{ status: 'error', error: { code, message } }`，**无 HTTP status code** |

### 3.2 四种 error shape

| 来源 | 形状 |
|---|---|
| auth-contract | `{ ok:false, error: { code, message, status } }` |
| `jsonPolicyError`（orchestrator-core） | `{ error, message }`（无 code，无 status；status 在 HTTP layer） |
| `HttpController`（agent-core DO） | `{ error }` 顶层（无 message，无 code） |
| bash-core | `{ status: 'error', error: { code, message } }`（无 HTTP status） |

> 4 种 error shape，3 种 envelope。再叠加一两个 worker 就会成为客户端的 narrow 噩梦。

### 3.3 命名小胜利
- `trace_uuid` 全局一致；`session_uuid` / `team_uuid` / `user_uuid` 命名稳定。
- 但 `meta.caller`（auth）vs `meta.authority`（agent）含义不同：一个是 string 角色名，一个是 user 身份快照。建议未来把 `meta = { trace_uuid, caller, authority? }` 同时携带。

### 3.4 推荐统一规范

提议把规范集中到一个 `packages/orchestrator-rpc-contract`（或扩展现有 `orchestrator-auth-contract`）：

```ts
export type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; status: number; details?: unknown } };

export interface RpcMeta {
  trace_uuid: string;
  caller: 'orchestrator-core' | 'agent-core' | 'bash-core' | 'cli' | 'web';
  authority?: AuthSnapshot;     // 仅 user-bound 调用必填
  session_uuid?: string;        // 仅 session-bound 调用必填
}

export interface AgentCoreRpc {
  start  (i: StartInput,    m: RpcMeta): Promise<Envelope<StartOk>>;
  input  (i: InputInput,    m: RpcMeta): Promise<Envelope<InputOk>>;
  cancel (i: CancelInput,   m: RpcMeta): Promise<Envelope<CancelOk>>;
  status (i: StatusInput,   m: RpcMeta): Promise<Envelope<StatusOk>>;
  timeline(i: TimelineInput,m: RpcMeta): Promise<Envelope<TimelineOk>>;
  verify (i: VerifyInput,   m: RpcMeta): Promise<Envelope<VerifyOk>>;
  // stream 走 NDJSON，不走 RPC。
}

export interface BashCoreRpc {
  call   (i: CapabilityCallInput,  m: RpcMeta): Promise<Envelope<ToolCallResponseBody>>;
  cancel (i: CapabilityCancelInput,m: RpcMeta): Promise<Envelope<{ cancelled: boolean }>>;
}
```

NACP 内层 schema (`tool.call.request/response`) 不动，只是被外层 `Envelope.data` 套住，让所有 RPC 路径同形。

详见 `.tmp/rpc-shapes.md`。

---

## 4. CLI 宿主对 orchestrator-core 的接口预期

调研了 `context/claude-code`（control + stream over stdio）、`context/codex`（JSON-RPC 2.0）、`context/gemini-cli`（HTTP + A2A）。三家不约而同有 6 类高阶能力是我们当前缺的：

| 能力 | claude-code | codex | gemini-cli | 我们 |
|---|---|---|---|---|
| **Tool 同意网关** | `can_use_tool` | `*ApprovalParams` | `tool-call-confirmation` event | ❌ |
| **Permission 模式切换** | `set_permission_mode` | `askForApproval` per turn | `agentSettings` | ❌ |
| **Context / token 占用查询** | `get_context_usage` | `Usage` | `GET /tasks/:id/metadata` | ❌ |
| **commands / skills / agents 目录** | `initialize.response` | `commands/list` | `GET /listCommands` | ❌ |
| **Hook callback** | `hook_callback` | `hookStarted/Completed` | n/a | ❌（nacp-session 内部已有 hook，但未暴露） |
| **Rewind / fork / inject_items** | `rewind_files` | `thread/fork`, `injectItems` | n/a | ❌ |
| **Elicitation / ask-user 单轮** | `elicitation` | n/a | n/a | ❌ |
| **MCP 服务器管理** | `mcp_*` | `mcp_*` | n/a | ❌ |

> 我们 nacp-session 当前 message_type 表已覆盖 session 生命周期 + tool-call + capability + posture 等，但缺 **permission / hook / elicitation / rewind / catalog** 五类。这是 Z5 之前必须补的。

详见 `.tmp/cli-host-gaps.md`。

---

## 5. 对外 HTTP / WS 接口缺口（前端能力侧）

### 5.1 当前对外（已写入 `clients/api-docs/`）
- HTTP: `auth/*`（7 个）、`sessions/{uuid}/{start|input|cancel|status|timeline|history|verify}`、`debug/workers/health`。
- WS: `sessions/{uuid}/ws`，client→server 仅 `session.{resume,heartbeat,stream.ack}`，server→client 推 `session.stream.event` + terminal frame。

### 5.2 形状不一致（对外）
- **auth 路径**透传 RPC `Envelope`，前端可统一 narrow `ok / data / error`。
- **session 路径**外层是 orchestrator-core 自己组装的 `{ ok:true, action, phase, ... }`（**不是** envelope 形态），错误是 `{ error, message }`。
- 结果：web 客户端 `client.ts` 需要写两套 `envelope()` / `json()` 路径。

### 5.3 高优先级新增端点（与第 4 节 CLI gap 对偶）

| 端点 | 用途 |
|---|---|
| `POST /sessions/{uuid}/permission/decision` | tool 同意/拒绝回路 |
| `POST /sessions/{uuid}/policy/permission_mode` | session 默认 permission 模式 |
| `GET /sessions/{uuid}/usage` | tokens / capability / subrequest budget |
| `POST /me/sessions` + `GET /me/sessions` | server-side session 索引（取代客户端自造 UUID） |
| `GET /me/conversations` + `GET /me/conversations/{uuid}/sessions` | 会话列表入口 |
| `POST /sessions/{uuid}/resume` | 显式 resume + ack |
| `GET /catalog/{skills\|commands\|agents}` | slash-menu / capability tree |
| `POST /sessions/{uuid}/messages` | 多模态输入（image/file ref） |
| `GET /sessions/{uuid}/files` | 列 artifact |
| `POST /me/devices/revoke` | 退出某设备 |

### 5.4 WS frame 对偶

新增 message_type（建议在 nacp-session schema 加 zod，并由 orchestrator-core WS 入口透传）：
- `session.permission.request`（server→client）
- `session.permission.decision`（client→server，与 5.3.1 REST 镜像）
- `session.usage.update`（server→client，高频 push）
- `session.skill.invoke` / `session.command.invoke`（client→server）
- `session.elicitation.request` / `session.elicitation.answer`

> **核心约束**：所有事件继续走现有 `/sessions/:uuid/ws`，**不要再开 SSE 或额外的 NDJSON 端点**——保持 transport 收敛对前端、对 stream 状态机、对 trace 都有利。

### 5.5 内外形状统一的整治建议

四件事，建议**同时**做（一次性 PR 走完，避免半路碎片）：
1. orchestrator-core session 路径外层 `Envelope<T>` 化，与 auth 同形。
2. `jsonPolicyError` 升级为 `Envelope.error = { code, message, status }`，code 加入 enum（与 auth-contract 的 `AuthErrorCode` 合并）。
3. agent-core RPC `{ status, body }` 解构落到 `Envelope<T>`；DO 内 `HttpController` 同步改造，不再吐 `{ ok:true, action, phase }`。
4. nacp-session schema 补 permission / elicitation / usage / skill / command 五类 message_type。

详见 `.tmp/external-api-gaps.md`。

---

## 6. 集中风险表（按可观察性整理）

| ID | 类别 | 描述 | 优先级 |
|---|---|---|---|
| R1 | 安全 | bash-core 缺 `NANO_INTERNAL_BINDING_SECRET` + `x-nano-internal-authority` 校验，与上游不对称；如 workers.dev 公网未关闭，可被匿名 POST | **P0** |
| R2 | 安全 | bash-core / context-core / filesystem-core / orchestrator-auth 的 `workers_dev` 默认值未显式设为 `false`，需要审计 deploy 状态 | **P0** |
| R3 | 一致性 | 内部 RPC 出现 3 种 envelope + 4 种 error shape，未统一收口 | **P1** |
| R4 | 一致性 | 对外 session 路径未走 envelope，与 auth 路径不同 | **P1** |
| R5 | 完整性 | agent-core 5 个动作（input/cancel/verify/timeline/stream）未进入 dual-track parity，HTTP→RPC 退役不彻底 | **P1** |
| R6 | 完整性 | bash-core 完全无 RPC 入口，未来扩展时会复制 HTTP 旧形态 | **P1** |
| R7 | 能力 | 缺 permission gate / usage / catalog / elicitation / hook callback / rewind 等高阶能力，前端做高交互体验时会卡住 | **P2** |
| R8 | 能力 | 缺 server-side session/conversation 索引，客户端自造 sessionUuid，绕开 D1 truth | **P2** |
| R9 | 设计 | orchestrator-core 同时 service-bind 了仅做 health 的 BASH/CONTEXT/FILESYSTEM，attack surface 不必要的扩张 | **P3** |
| R10 | 设计 | agent-core 公网 fetch + 内部 fetch 在同一 worker，靠路径分发 — 与 orchestrator-auth 的 "RPC-only, fetch returns 404" 模式不一致 | **P3** |

---

## 7. 行动建议（按 PR 边界拆）

### PR-A · 安全收口（P0）
1. 给所有 worker 的 wrangler.jsonc 显式 `workers_dev: false`（除 orchestrator-core）；agent-core 的 `workers_dev: true` 仅保留给开发回环，**生产 env 必须 false**。
2. bash-core 加 `validateInternalAuthority` 与 orchestrator→agent 同形。
3. orchestrator-core 移除 BASH_CORE/CONTEXT_CORE/FILESYSTEM_CORE 的 service-binding（health 探针改用 zone 内的 fetch by URL，或者把 health 的耦合做成显式 `// health-only` 注解 + binding-scoped guard）。

### PR-B · RPC envelope 统一（P1）
4. 在 `packages/orchestrator-auth-contract` 提取出 `Envelope<T>` / `RpcMeta` 通用类型并导出。
5. agent-core RPC 出参改成 `Envelope<T>`；同步把 `forwardStart/forwardStatus` 比对替换为 envelope deep equal。
6. orchestrator-core 公开 session 路径外层包 `Envelope<T>`，错误统一 `{ code, message, status }`。

### PR-C · agent-core RPC shadow 补完（P1）
7. 给 `input`, `cancel`, `verify`, `timeline` 加 RPC method + parity 比对；`stream` 单独做成 NDJSON 长 method，不进 dual-track。

### PR-D · bash-core RPC 化（P1）
8. bash-core 导出 `WorkerEntrypoint`，方法签名套 `Envelope<ToolCallResponseBody>`；agent-core 的 `makeCapabilityTransport` 用 RPC binding 调用。

### PR-E · 对前端补能力（P2）
9. 加 5.3 列出的高优先级端点 + 5.4 列出的 WS frame，及 nacp-session schema 对应 message_type。
10. 补 server-side `me/sessions` + `me/conversations`（D1 truth 已经是 conversations + turns + activities，只缺 read 端点）。

### PR-F · CLI 高阶能力（P2-P3）
11. permission gate REST/WS pair。
12. usage push frame。
13. catalog 列表（skills/commands/agents）。

---

## 8. 收尾观察

- 6-worker 分层是**对的**：orchestrator-core 是单一公网 facade，orchestrator-auth 是纯 RPC 的身份信源，agent-core 是 session DO 宿主，bash-core 是能力执行边界，context-core / filesystem-core 是 library-only 的占位 worker。
- 退役进度有 **明显的 "auth 完工、agent 半路、bash 未启动" 的三段** —— 把 `forwardStart/Status` 的 dual-track parity 当作模板复制到剩下 5 个 action 后，agent-core 的 RPC 化即可收尾；之后再把同样的形态平移到 bash-core，整个内部 wire 即可统一为 RPC + Envelope。
- 形状统一是**一次性窗口**：现在 (orchestrator-auth ↔ orchestrator-core) 是唯一已 RPC 化的 pair，泛化到三对的成本最低；再拖一两个 PR 就会进入"修历史"的代价。
- 对前端的接口缺口和对内部 RPC 的形状统一**应当同时做**——两侧用同一套 `Envelope<T>` 表达，让客户端 narrow、SDK 生成、test 比对都收一套套路。

---

> 本报告完整素材：
> - `.tmp/topology.md`（拓扑事实层）
> - `.tmp/internal-http-retirement.md`（HTTP→RPC 退役评分）
> - `.tmp/rpc-shapes.md`（envelope 碎片）
> - `.tmp/cli-host-gaps.md`（claude-code/codex/gemini-cli host API 对照）
> - `.tmp/external-api-gaps.md`（前端能力侧缺口）
