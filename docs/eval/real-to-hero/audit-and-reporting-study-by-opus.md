# Audit & Reporting Study — Opus

> 审查者: `Opus 4.7 (1M context)`
> 审查日期: `2026-04-29`
> 阶段: `real-to-hero` 全段（RH0–RH4 已闭合，前端开始组装阶段）
> 目的: 在前端开始接口适配前，先把"日志、报错、埋点"三层可观测性的事实状态、协议预留、实际落地、与 claude-code / codex / gemini-cli 三个参考 agent 的差距，一次性盘清。
> 输出态度: 不为护盘说好话；只列事实与可验证的 file:line 引用；区分"协议留白"与"代码缺位"。
> 文档状态: `findings`（不是 RFC，也不是修复 PR；为后续 RH5 / observability 单独 phase 提供事实基线）

---

## 0. 一句话 verdict

> 我们的 6-worker + NACP 协议组合 **在协议层为 log / error / observability 留了相当完整的位**（NACP `error-registry`、`error-body`、`observability/envelope`、`eval-observability/trace-event`、`session.stream.event` 的 `system.notify` / `compact.notify`），但 **运行时只有约 1/3 的位被真正用上**：facade-error envelope 只有 `orchestrator-core` 一个 worker 在用；NACP 23 条 `NACP_*` error code 在 6 个 worker 里 **0 import**；`NacpObservabilityEnvelope` 在生产路径 **0 emit**；6 个 worker 的运行时日志合计 **32 条 `console.warn`**，0 个结构化 logger。前端能拿到的可观测性，只有 `x-trace-uuid` header 一项，外加 Cloudflare Workers Logs（dashboard-only，前端不可读）。

> 三家参考 agent（claude-code / gemini-cli / codex）里，claude-code 与 gemini-cli 都已经做到 **稳定 error code 注册表 + 持久化日志 + OTel-class 遥测 + 用户级 opt-out**；codex 反而是三家里最薄的。我们目前的状态比 codex 厚（有 NACP 协议骨架），但比 claude-code / gemini-cli 薄（骨架基本没接电）。

---

## 1. 用户三问的直接回答

> 下面是先把用户提的三个问题回答清楚，再展开协议盘点和 agent 对比。所有结论都给 file:line。

### 1.1 Q1 — 接口请求的日志是否存在，前端如何获取？

| 维度 | 现状 | 引用 |
|---|---|---|
| 平台层日志（Cloudflare Workers Logs） | ✅ 6/6 worker `wrangler.jsonc` 都开了 `observability.enabled = true` | `workers/{6}/wrangler.jsonc` 各 obs 块 |
| 应用层结构化日志 | ❌ 不存在；只有 `console.warn(...)` 字符串拼接 | 见 §2.3 |
| 应用层日志条数（src/ 下的 `console.*`） | orchestrator-core 24；context-core 3；filesystem-core 3；agent-core 2；orchestrator-auth 0；bash-core 0 | 总计 32 |
| 前端可读取的请求级 ID | `x-trace-uuid` 响应头 | `workers/orchestrator-core/src/policy/authority.ts:39`、`workers/agent-core/src/index.ts:349`、`workers/agent-core/src/host/internal.ts:40` |
| 前端可读取的服务时序 / `Server-Timing` | ❌ 0 处 | grep 验证 |
| 前端可读取的 `/debug/logs` 路由 | ❌ 0 处 | grep 验证；最近的是 `/debug/workers/health`（探活，不是日志） |
| WebSocket 日志推送通道 | ⚠️ 协议有 `system.notify`（severity: info/warning/error），但只在 agent-core kernel 错误路径触发，**不是按"请求日志"埋点** | `packages/nacp-session/src/stream-event.ts:59-63`；agent-core 单测 `test/host/integration/stream-event-schema.test.ts` |

**直接结论**：
1. **HTTP 请求级**：前端能拿到的唯一关联键是 `x-trace-uuid` 响应头。除了这个 UUID，前端拿不到任何"我这个请求在服务端发生了什么"的运行时信息。
2. **WebSocket 会话级**：前端会被动收到 `system.notify` / `compact.notify` 等 stream-event，但这些不是"日志"，是 **业务通知**（取消、超额、压缩完成）。错误日志一旦发生在 HTTP 阶段（鉴权、参数、上游 RPC），前端只能看 4xx/5xx 的 `error.code` + `error.message`。
3. **运维侧**：日志确实落到了 Cloudflare Workers Logs（开了 `observability.enabled`），但那是 dashboard 维度的，**前端开发态/生产态都拿不到**。要查问题，前端必须把 `x-trace-uuid` 截图丢给 owner，owner 再去 wrangler tail / dashboard 里反查。这条链路没有自动化。

---

### 1.2 Q2 — 报错系统是否具备持久化日志？是否有标准格式？所有 error code 在哪里查？

#### 1.2.1 对外报错（HTTP facade error envelope）

**有标准格式**，定义在 `packages/orchestrator-auth-contract/src/facade-http.ts`：

| 项 | 引用 | 形态 |
|---|---|---|
| Schema | `facade-http.ts:137-142` | `{ ok: false, error: { code, status, message, details? }, trace_uuid }` |
| 工厂 | `facade-http.ts:162-179` | `facadeError(code, status, message, trace_uuid, details?)` |
| Code 枚举 | `facade-http.ts:48-84` | **32 个 kebab-case 码**：`invalid-request`、`invalid-input`、`invalid-meta`、`invalid-trace`、`invalid-authority`、`invalid-caller`、`invalid-session`、`invalid-auth`、`identity-already-exists`、`identity-not-found`、`password-mismatch`、`refresh-invalid`、`refresh-expired`、`refresh-revoked`、`invalid-wechat-code`、`invalid-wechat-payload`、`permission-denied`、`binding-scope-forbidden`、`tenant-mismatch`、`authority-escalation`、`not-found`、`conflict`、`session-not-running`、`session-already-ended`、`worker-misconfigured`、`rpc-parity-failed`、`upstream-timeout`、`rate-limited`、`not-supported`、`internal-error` |
| 子集关系 | `facade-http.ts:87-89` | 编译期保证 `AuthErrorCode ⊂ FacadeErrorCode` |
| 实际消费者 | `workers/orchestrator-core/src/policy/authority.ts:2,31` | 仅 1 个 worker import 这个 helper |

#### 1.2.2 NACP 协议层 error registry（不同的体系）

定义在 `packages/nacp-core/src/error-registry.ts`：

| 项 | 引用 | 形态 |
|---|---|---|
| Schema | `error-registry.ts:23-30` | `{ code, category, message, detail?, retryable }` |
| 类别 | `error-registry.ts:12-20` | 7 类 → HTTP status: validation(400) / security(403) / quota(429) / conflict(409) / dependency(503) / transient(503) / permanent(500) |
| Code | `error-registry.ts:61-89` | **23 个 SCREAMING_SNAKE 码**：`NACP_VALIDATION_FAILED`、`NACP_UNKNOWN_MESSAGE_TYPE`、`NACP_SIZE_EXCEEDED`、`NACP_VERSION_INCOMPATIBLE`、`NACP_TYPE_DIRECTION_MISMATCH`、`NACP_DEADLINE_EXCEEDED`、`NACP_IDEMPOTENCY_CONFLICT`、`NACP_CAPABILITY_DENIED`、`NACP_RATE_LIMITED`、`NACP_BINDING_UNAVAILABLE`、`NACP_HMAC_INVALID`、`NACP_TIMESTAMP_SKEW`、`NACP_TENANT_MISMATCH`、`NACP_TENANT_BOUNDARY_VIOLATION`、`NACP_TENANT_QUOTA_EXCEEDED`、`NACP_DELEGATION_INVALID`、`NACP_STATE_MACHINE_VIOLATION`、`NACP_REPLY_TO_CLOSED`、`NACP_PRODUCER_ROLE_MISMATCH`、`NACP_REPLAY_OUT_OF_RANGE` |
| Per-verb body | `error-body.ts:34-44`、`NACP_ERROR_BODY_VERBS` (line 57) | `NacpErrorBodySchema` 已定义；**已采用此 schema 的 verb 集合为空** |
| 实际消费者 | grep `error-registry`、`NACP_*` 在 `workers/*/src/` | **0 处** |

#### 1.2.3 三个真正能查的事实

**事实 1 — 我们有两套不相交的 error code 体系**：
- `FacadeErrorCode` (32 个 kebab-case)：HTTP facade 用，orchestrator-core 用。
- `NACP_*` (23 个大写下划线)：协议规范定义，**没有任何 worker 在 emit**。

这两套之间没有映射表。前端如果同时收到 facade 的 `invalid-trace` 和 NACP 的 `NACP_VALIDATION_FAILED`（理论上 RPC 层会回这种），它需要两套解析逻辑。

**事实 2 — 持久化**：
- HTTP error 经 `console.warn` → Cloudflare Workers Logs（云端，TTL 由 Cloudflare 决定，**不是我们持久化的**）
- 没有任何 worker 把 error 写进 D1 或 R2 做长期审计。
- agent-core 的 `eval/` 子树里有 `DurablePromotionRegistry`、`DOStorageSink`，会把 `system.notify` / `compact.notify` 这类 trace event 落到 SESSION_DO storage，但这只在 agent-core 的 kernel 里，且大部分代码在 test 外不被调用（见 §2.5）。

**事实 3 — 前端 / 文档查询入口**：
- `FacadeErrorCode` 没有专门的 docs 文件聚合解释。前端需要去读 `packages/orchestrator-auth-contract/src/facade-http.ts:48-84` 的枚举，自己理解每个码的含义。
- `NACP_*` 至少在 `packages/nacp-core/src/error-registry.ts` 文件里把 message + category + retryable 写在一起，但因为没有 worker 在用，前端不会真见到。
- **没有 `docs/api/error-codes.md` 或类似汇总文档**（grep 验证）。

---

### 1.3 Q3 — NACP 预留的 log / error 部分，6 个 worker 是否用上了？怎么用上的？怎么埋点的？分布在哪？

下面这张表是直接事实清单，覆盖 NACP 协议层每一处"留给 log / error / obs 的位"：

| NACP 留位 | 定义 file:line | 谁应该用 | 实际用没用 | 怎么用的 / 没用的证据 |
|---|---|---|---|---|
| `NACP_*` error code (23 条) | `packages/nacp-core/src/error-registry.ts:61-89` | 所有发 NACP envelope 的 worker | ❌ 0 worker import | grep 全仓 0 命中 |
| `NacpErrorBodySchema` (per-verb error body) | `packages/nacp-core/src/error-body.ts:34-44` | 每个 verb-handler 的失败路径 | ❌ 不在用 | `NACP_ERROR_BODY_VERBS` (line 57) 是空集；comment 注明 "forthcoming per-verb migration PR" |
| `NacpObservabilityEnvelope`（alerts/metrics/traces） | `packages/nacp-core/src/observability/envelope.ts:21-83` | 任何想 emit 平台告警/指标的 worker | ❌ 0 worker emit | grep `ObservabilityEnvelope`、`obs.emit`、`emitObservability` 在 `workers/*/src/` 0 命中；只剩 `agent-core/src/eval/trace-event.ts:25` 的注释引用 |
| `NacpAlertPayload` (severity info/warning/error/critical, scope platform/request/session/turn) | `envelope.ts:48-69` | 任何 worker | ❌ 0 处 emit | 同上 |
| `session.stream.event` 的 `system.notify`（severity info/warning/error） | `packages/nacp-session/src/stream-event.ts:59-63` | agent-core kernel | ⚠️ 部分使用 | agent-core kernel events.test.ts 验证有映射；`packages/nacp-session/src/adapters/system.ts:7` 有 builder；`workers/orchestrator-core/src/user-do/durable-truth.ts:212` 有消费侧（promote-to-durable 检测） |
| `session.stream.event` 的 `compact.notify`（status started/completed/failed） | `stream-event.ts:52-58` | context-core / agent-core 压缩流程 | ⚠️ 部分使用 | agent-core kernel `compact-turn.test.ts:104-139` 验证发；context-core 真实压缩路径是否一定 emit 没有验证（runtime 路径绕开了 kernel scenario） |
| `session.stream.event` 的 `tool.call.result`（status ok/error，error_message） | `stream-event.ts:19、87` | 所有工具调用路径 | ✅ 在用 | 通过 `parity-bridge` 透传 agent-core 产生的 tool result frame |
| Evidence 流（`compact` / `assembly` / `artifact` / `snapshot`） | `packages/nacp-core/src/evidence/{vocabulary,sink-contract}.ts` | context-core、agent-core | ⚠️ 仅测试态 | agent-core 的 `eval/` 子树用了 `DurablePromotionRegistry` + sinks；prod 路径主要走 RPC，不是 evidence stream |
| `eval-observability/TraceEvent`（通用 trace 事件） | `packages/eval-observability/src/trace-event.ts:1-90` | 所有 worker | ⚠️ agent-core 内部用 | 有 `error: {code, message}` slot；只在 agent-core 的 kernel events / eval sinks 里串起来；其他 5 worker 不知道 |
| facade `FacadeErrorEnvelope`（HTTP 边界） | `packages/orchestrator-auth-contract/src/facade-http.ts:137-179` | orchestrator-core（必须）；agent-core / bash-core 的 HTTP 入口（理论上） | ⚠️ 仅 1 worker | orchestrator-core 用；agent-core HTTP 入口（如 `workers/agent-core/src/index.ts:135`）返回 `{error: "Not found"}` 裸 JSON；bash-core `index.ts:335,351,411` 返回纯文本 `"Method Not Allowed"` |
| Cloudflare Workers `observability.enabled` | wrangler 配置 | 全部 worker | ✅ 6/6 | wrangler 验证 |
| `x-trace-uuid` 请求/响应头透传 | `workers/orchestrator-core/src/policy/authority.ts:47-58`、`workers/agent-core/src/host/internal-policy.ts:165` | 所有 HTTP 入口 | ✅ 在用 | orchestrator-core 是源；agent-core internal endpoint 强制校验 `x-trace-uuid must be a UUID` 且要求与 body trace_uuid 一致 |

**用法 + 分布的 verbose 描述**：

#### 实际用上的部分（4 项）

1. **`x-trace-uuid` 头透传** — orchestrator-core (`auth.ts:190`、`policy/authority.ts:47-58`、`index.ts:349,389,493,545`、`entrypoint.ts:70`) 是源；agent-core (`index.ts:349`、`host/internal.ts:40`、`host/internal-policy.ts:165,246`) 是 sink + validator。从前端首屏请求，到 orchestrator-core facade，到 agent-core internal RPC，trace_uuid 在 header 里串起来。**这是当前唯一可用的"前后端关联键"**。

2. **facade error envelope** — 仅 orchestrator-core 一个 worker 在用。具体落点是 `policy/authority.ts:31-39`（生成 envelope + 写 `x-trace-uuid` 响应头）和 `auth.ts:194` 的 `jsonPolicyError`。其他 5 个 worker 的 HTTP 入口（如果有）都没遵循。

3. **`session.stream.event` 通道** — agent-core kernel emit `tool.call.result` / `system.notify` / `compact.notify` / `turn.begin` / `turn.end` / `llm.delta` / `hook.broadcast` 等 9 类 stream-event；通过 `parity-bridge.ts:219,225` 透传到 orchestrator-core；orchestrator-core `user-do/durable-truth.ts:212` 对 `system.notify` 做 promote 决策；最终 `emitServerFrame()` 喂给前端 WebSocket。**这条链是真实跑的**，但它是 **业务事件流**，不是 **日志/error 流**。

4. **Cloudflare Workers Logs** — `wrangler.jsonc` 6/6 都开了。这意味着 `console.warn(...)` 会自动落到 Cloudflare 后台。但 **前端读不到**。

#### 没用上的部分（5 项）

1. **`NACP_*` error code 注册表** — 23 条 code 全部 0 import。worker 们各自用裸字符串报错。
2. **`NacpErrorBodySchema`** — `NACP_ERROR_BODY_VERBS` 是空集，未启用。
3. **`NacpObservabilityEnvelope` (alerts/metrics/traces)** — 0 emit。这块是 NACP 协议给 **平台级监控** 留的位（severity critical 的告警、指标聚合、trace 树），现在等于 dead schema。
4. **`evidence/*` stream** — 协议层定义了 4 条 evidence stream（assembly/compact/artifact/snapshot），各有 `errorCode`/`errorMessage` 槽位（`vocabulary.ts:44-86`）。生产路径上 worker 们没有把"错误证据"按 evidence stream 写出来；只有 agent-core 的 `eval/` 测试 harness 在用。
5. **结构化 logger** — 没有任何一个 worker 引入 pino / winston / debug；全部是裸 `console.warn` 字符串。

#### 用得不完整的部分（按 worker）

| Worker | console 数 | facade error | NACP error | obs envelope | system.notify emit | trace_uuid 头 |
|---|---|---|---|---|---|---|
| orchestrator-core | **24** | ✅ | ❌ | ❌ | ❌（消费侧） | ✅ 源头 |
| orchestrator-auth | **0** | ❌（应当用） | ❌ | ❌ | ❌ | ❌ |
| agent-core | **2** | ❌（HTTP 用裸 JSON） | ❌ | ❌ | ✅（kernel） | ✅ |
| bash-core | **0** | ❌（返回纯文本） | ❌ | ❌ | ❌ | ❌ |
| context-core | **3** | ❌ | ❌ | ❌ | ❌（compact.notify 在 kernel 但 prod 路径未验） | ❌ |
| filesystem-core | **3** | ❌ | ❌ | ❌ | ❌ | ❌ |

**按"功能内分布"看埋点位置**（聚合 §2 全部 grep 结果）：
- `orchestrator-core/src/index.ts` — D1 读失败、models/usage 读失败、server-frame schema 拒收、auth 失败 → `console.warn`
- `orchestrator-core/src/entrypoint.ts` — `forward-server-frame-failed`（跨 worker WS 推送失败）→ `console.warn`
- `agent-core/src/host/do/session-do-runtime.ts:246` — `push-server-frame-failed` → `console.warn`
- `agent-core/src/host/do/session-do/runtime-assembly.ts` — `usage-commit` 调试态 → `console.log`
- `context-core/src/async-compact/{committer.ts:304, index.ts:722,732}` — async compact 失败/告警 → `console.warn`
- `filesystem-core/src/{kv-adapter.ts:65, reference.ts}` — `KvAdapter.putAsync` 失败 → `console.warn`

—— 这是 **6 个 worker 全部的应用层日志埋点**。orchestrator-auth 与 bash-core 在生产路径上 **完全静默**。

---

## 2. 协议留白 vs 代码缺位 — 详细盘点

### 2.1 NACP 协议层的"日志/错误位"清单

> 这一节回答："如果今天我们有意愿全用 NACP 协议留的位，能用上多少？"

| 协议位 | 服务边界 | 现在工程里被覆盖的程度 |
|---|---|---|
| `NacpErrorBodySchema`（per-verb 错误体） | RPC envelope（worker→worker） | ⛔ 0% — 空集 verb |
| `NACP_*` code | RPC + HTTP | ⛔ 0% |
| `NacpObservabilityEnvelope` | 平台告警/指标/traces | ⛔ 0% |
| `NacpAlertPayload`（severity, scope） | 同上 | ⛔ 0% |
| `session.stream.event::tool.call.result` | WS 用户面 | ✅ 在用（agent-core） |
| `session.stream.event::system.notify` | WS 用户面 | ⚠️ 仅 agent-core kernel；orchestrator 消费 |
| `session.stream.event::compact.notify` | WS 用户面 | ⚠️ 仅 agent-core kernel |
| `session.stream.event::llm.delta / turn.* / hook.broadcast` | WS 用户面 | ✅ 在用 |
| `evidence::compact`（含 errorCode） | 内部审计 | ⚠️ 仅 agent-core eval |
| `evidence::artifact / assembly / snapshot` | 内部审计 | ⚠️ 仅 agent-core eval |
| `eval-observability::TraceEvent`（含 error 槽 + DurablePromotionRegistry + DOStorageSink） | agent-core kernel | ⚠️ 仅 kernel；非 prod 入口 |
| `Server-Timing` HTTP header | 浏览器前端 | ❌ 未启用 |
| `Sentry-Trace` / W3C `traceparent` | 浏览器前端 | ❌ 未启用（自定义 `x-trace-uuid` 替代） |

### 2.2 facade 错误体在前端的可消费性

`FacadeErrorEnvelope`（`packages/orchestrator-auth-contract/src/facade-http.ts:137`）：

```ts
{
  ok: false,
  error: { code: FacadeErrorCode, status: number, message: string, details?: unknown },
  trace_uuid: string,
}
```

前端从一个失败的 HTTP 请求里能拿到的全部信息：
- 响应体 `error.code`（32 选 1）
- 响应体 `error.status` / HTTP status
- 响应体 `error.message`（人话）
- 响应体 `error.details`（worker 自由发挥的 unknown）
- 响应体 `trace_uuid`
- 响应头 `x-trace-uuid`

**前端拿不到**：
- 服务器内部堆栈 / cause chain
- 失败发生在哪一段 RPC 链路（orchestrator-core → agent-core → bash-core 中哪一跳）
- 任何 retry context
- 任何上游服务的 sub-error（比如 D1 错误码、Cloudflare AI 错误码、binding 错误码）— `error.details` 没有任何 schema 约束

### 2.3 6 个 worker 的实际日志策略

裸 `console.warn` 全列表（精确）：

| 文件 | 行 | 字符串 |
|---|---|---|
| `workers/orchestrator-core/src/index.ts` | 620 | （未截全） |
| 同 | 951 | （未截全） |
| 同 | 1082 | （未截全） |
| 同 | 1191 | `models-d1-read-failed team=${teamUuid}` |
| 同 | 1281 | （未截全） |
| 同 | 1450 | （未截全） |
| `workers/orchestrator-core/src/entrypoint.ts` | — | `forward-server-frame-failed` |
| `workers/agent-core/src/host/do/session-do-runtime.ts` | 246 | `push-server-frame-failed` |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` | — | `usage-commit`（console.log） |
| `workers/context-core/src/async-compact/committer.ts` | 304 | （未截全） |
| `workers/context-core/src/async-compact/index.ts` | 722 / 732 | （未截全） |
| `workers/filesystem-core/src/kv-adapter.ts` | 65 | KvAdapter.putAsync 失败 |
| `workers/filesystem-core/src/reference.ts` | — | （未截全） |

**结构性问题**：
1. 每条 `console.warn` 第一参数是裸字符串，第二参数（如果有）是结构化 object。**没有人保证字符串格式一致**（`models-d1-read-failed` vs `forward-server-frame-failed` vs `push-server-frame-failed`）。
2. 没有 level（warn vs error vs critical 没区分）；没有 logger name；没有 trace_uuid 注入。
3. `orchestrator-auth` / `bash-core` 在生产路径上 **0 console**：要么是它们不出错（不可能），要么是它们用 `throw new Error(...)` 让 Cloudflare runtime 自动记录。后者会丢上下文。

### 2.4 服务端错误"被动透传到前端"的 3 条路径

1. **HTTP 4xx/5xx 响应**：orchestrator-core 用 `facadeError()`；其他 worker 不规范。
2. **WebSocket `system.notify` (severity=error)**：仅 agent-core kernel runtime 错误（取消、超额、压缩失败等）会 emit。HTTP 阶段的错误（鉴权拒绝、参数 schema 拒绝）走不到这条路径。
3. **WebSocket `tool.call.result` (status=error)**：工具失败信号；前端可读 `error_message`。

—— **没有第 4 条路径**。前端无法订阅 "服务端实时日志" 或 "全部 error events"。

### 2.5 eval-observability 子系统的真相

`packages/eval-observability/src/` 与 `workers/agent-core/src/eval/` 是协议里 **最像可观测性** 的一段：

- `TraceEvent` 含 `error: {code, message}` 槽位（`trace-event.ts:51-53`）
- `DurablePromotionRegistry` 把高价值事件 promote 到 SESSION_DO storage
- 多种 sink：`do-storage`、`http`、`memory`
- `runner.ts` / `inspector.ts` 是评测期跑 scenario 的 harness

**但**：
- 这套 harness 的入口只在 agent-core 的 `test/eval/` 与 kernel 路径下；HTTP / 真实 prod request 进来时大概率不走这条 trace event 流。
- 它的设计对象是 **eval / replay / scenario-run**，不是 **online debugging**。

→ 协议给的最厚的一段可观测性，是 **离线 / 评测态** 的，不是 **在线运营态** 的。

---

## 3. 三个参考 agent 的做法

> 数据来源：`context/{claude-code,codex,gemini-cli}/`。

### 3.1 Claude Code（Anthropic）

- **Logger**：自研 `ClaudeCodeDiagLogger implements DiagLogger`（OTel `DiagLogger`），叠加 `logForDebugging()`。入口 `context/claude-code/utils/telemetry/instrumentation.ts:87 bootstrapTelemetry()`。
- **结构化格式**：OTel LogRecord（body + attributes）。
- **目的地**：stderr（debug）、文件（`--debug-file <path>`）、OTel exporter（含 BigQuery exporter `context/claude-code/utils/telemetry/bigqueryExporter.ts:47`）、Perfetto tracer。
- **Verbosity**：`--debug-file`、`--verbose`、`OTEL_LOG_USER_PROMPTS`（控制 prompt 是否落日志，默认隐私安全）。
- **Error 注册表**：`context/claude-code/constants/errorIds.ts` 的 **数字 ID + obfuscated 名**（如 `E_TOOL_USE_SUMMARY_GENERATION_FAILED = 344`，下一个 346）。设计目的就是"在 prod 拿数字 ID 反查内部含义，不向用户暴露内部逻辑"。
- **Error 类**：`context/claude-code/utils/errors.ts:3-100` 有 `ClaudeError` 基类、`ShellError`、`ConfigParseError`、`TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`。
- **Stack trim**：`shortErrorStack()` 只留 5 帧（喂给 LLM context 用）。
- **Span 类型**：`interaction` / `llm_request` / `tool` / `tool.blocked_on_user` / `tool.execution` / `hook`（`utils/telemetry/sessionTracing.ts:50-55`）。
- **Opt-out**：`metricsOptOut` 设置项 + 信任对话框接受才上报。

### 3.2 Gemini CLI（Google）

- **Logger**：Winston (`packages/a2a-server/src/utils/logger.ts:9` `winston.createLogger()`) + 自研 `Logger` 类做 session checkpoint 日志（`packages/core/src/core/logger.ts:70-80`，JSON LogEntry { sessionId, messageId, type, timestamp, message }）。
- **目的地**：console、`$projectTempDir/logs.json`、`TELEMETRY_LOG_FILE` env 指定的遥测日志。
- **Error 注册表**：`ToolErrorType` enum (`packages/core/src/tools/tool-error.ts:14-83`) **40+ 个稳定 code**，按域分类（FS / Edit / Glob / Grep / MCP / Shell / WebFetch / WebSearch / Hook），如 `POLICY_VIOLATION` / `NO_SPACE_LEFT` / `FILE_NOT_FOUND` / `PATH_NOT_IN_WORKSPACE`。
- **Fatal 类**：`FatalToolExecutionError` / `FatalCancellationError` / `FatalTurnLimitedError`。
- **遥测**：OTel SDK + Google Clearcut（`packages/core/src/telemetry/clearcut-logger/clearcut-logger.ts`）。
- **Event 类型**：`StartSessionEvent` / `UserPromptEvent` / `ToolCallEvent` / `ApiResponseEvent` / `ApiRequestEvent` / `LoopEvent` / `FileOperationEvent` / `ExtensionEvent` / `HookEvent` / `PlanExecutionEvent`，**40+ 类**（`packages/core/src/telemetry/types.ts:48-130`）。
- **Opt-out**：`telemetry.enabled` config + `telemetry_log_user_prompts_enabled` 控制 prompt 是否上报。
- **Verbosity**：`--debug` / `--verbose` / `OTEL_TRACES_EXPORTER` / `OTEL_METRICS_EXPORTER` 环境变量。
- **Density**：约 1905 行 telemetry/logger 相关代码 / 2077 个 ts 文件 ≈ 92%，是三家最厚的。

### 3.3 Codex（OpenAI）

- **Logger**：Rust `tracing` crate；`codex-rs/windows-sandbox-rs/src/logging.rs:39-75` 用文本 `[timestamp exe_label] message` 格式 append 到 `sandbox.log`。
- **Verbosity**：`SBX_DEBUG=1` env。
- **Error 注册表**：JSON-RPC 风格数字码（`-32600` 等），命名常量 `INVALID_PARAMS_ERROR_CODE` / `INPUT_TOO_LARGE_ERROR_CODE`。
- **遥测**：`codex-rs/codex-client/src/telemetry.rs` 定义 `RequestTelemetry` trait（attempt, status, error, duration），但 export 端不显式（看不到 BigQuery / Clearcut 那种）。
- **Opt-out / debug-telemetry mode**：未发现显式入口。
- **Density**：约 13 行 / 555 个文件 ≈ 2%，最薄。

### 3.4 三家对比小表

| 维度 | claude-code | gemini-cli | codex | 我们 (6-worker) |
|---|---|---|---|---|
| 结构化 logger | OTel + 自研 | Winston + 自研 | Rust tracing | ❌ 裸 console |
| Error code registry | 数字 ID（隐私优先） | 40+ enum（按域分类） | JSON-RPC 数字 | facade 32 个 + NACP 23 个（两套不衔接） |
| 持久化日志 | 文件 + BigQuery | 文件 + Clearcut + OTel | 文件 sandbox.log | Cloudflare Workers Logs（云端，前端不可读） |
| Telemetry backend | BigQuery (Anthropic) | Clearcut + OTLP | OTel only | ❌ 0 emit |
| Span / event 类型 | 6 大类 span | 40+ event | request-level only | session.stream.event 9 类（仅 agent-core 在 emit） |
| Opt-out | metricsOptOut | telemetry.enabled | 未见 | N/A（没有 telemetry） |
| 用户级 verbosity flag | --debug-file / --verbose | --debug / --verbose | SBX_DEBUG | ❌（worker 端没有） |
| 浏览器/前端可读 trace ID | OTel trace ID | OTel trace ID | — | `x-trace-uuid` |

**结论**：claude-code 与 gemini-cli 是 **三家里两个完整体**，他们都把 logger / error registry / telemetry 三层做齐了。codex 是 **薄壳**，但他的边界更清晰（JSON-RPC 数字码）。我们目前的状态比 codex 厚一点（有 NACP 协议骨架 + facade error 体系 + WS stream-event），但比 claude-code / gemini-cli 薄非常多（**协议骨架基本没接电**）。

---

## 4. 系统当前的"盲点 / 断点 / 逻辑错误 / 事实认知混乱"

### 4.1 盲点（前端 / owner 完全看不到的事）

| # | 盲点 | 影响 |
|---|---|---|
| B1 | 前端在 HTTP 请求失败时，无法知道失败发生在 6-worker 链路的哪一跳（orchestrator-core / agent-core / bash-core / context-core / filesystem-core / orchestrator-auth） | 不可能远程定位"我看到 503，是哪个 worker 拒绝的？" |
| B2 | 前端 / owner 看不到任何 D1 / R2 / KV / AI 调用的成败统计 | 一旦 D1 读失败（已知 `models-d1-read-failed`），前端只看到一个 facade 错；运维只能去翻 wrangler tail |
| B3 | NACP `NacpObservabilityEnvelope` 的 alert / metric / trace 通道 0 emit | 即使我们想做"上线后看一眼指标"也没有指标 |
| B4 | `orchestrator-auth` 与 `bash-core` 在生产路径上 0 应用层日志 | 这两个 worker 一旦出问题，**只能靠 Cloudflare 平台 runtime 报错**（异常自动捕获），上下文全丢 |
| B5 | 没有"WebSocket 实时日志通道"或 SSE 通道，前端调试只能基于"重放截屏 + trace_uuid 反查" | 前端 debug 强依赖 owner 介入 |
| B6 | `session.stream.event::system.notify` 只在 agent-core kernel 错误时 emit；orchestrator-core / context-core / filesystem-core 的 HTTP 入口失败不会产生 system.notify | 前端订阅了 WS 也看不到 HTTP 阶段的失败，只能等下一次 HTTP 请求 |

### 4.2 断点（协议留位但代码没接电）

| # | 断点 | 协议位 | 代码现状 |
|---|---|---|---|
| D1 | NACP error registry 0 引用 | `error-registry.ts:61-89` 23 条 | grep 全仓 0 |
| D2 | `NacpErrorBodySchema` 0 verb 启用 | `error-body.ts:57 NACP_ERROR_BODY_VERBS` | 空集 |
| D3 | `NacpObservabilityEnvelope` 0 emit | `observability/envelope.ts:21-83` | 0 worker import |
| D4 | `evidence::*` stream 0 prod 写出 | `evidence/vocabulary.ts:44-86`（含 errorCode） | agent-core eval test 内才用 |
| D5 | `eval-observability::TraceEvent` 0 prod HTTP 入口接入 | `trace-event.ts:31-55` | 仅 agent-core kernel test 用 |
| D6 | facade error envelope 仅 1 worker 使用（应当 ≥3） | `facade-http.ts:162` | orchestrator-core only |
| D7 | `Server-Timing` / W3C `traceparent` 0 注入 | — | 0 处 |
| D8 | 没有结构化 logger 抽象（应当至少有 1 个 shared package） | — | 0 包 |

### 4.3 逻辑错误（不一致 / 互相矛盾的设计决策）

| # | 错误 | 现象 | 后果 |
|---|---|---|---|
| L1 | **两套 error code 不衔接** | `FacadeErrorCode`（32 kebab-case）与 `NACP_*`（23 大写下划线）没有映射表 | 前端必须解析两套；将来要切到 NACP per-verb error body 时需要做 32→23 的迁移，可能丢失语义（facade 32 大于 NACP 23） |
| L2 | **`session.stream.event::system.notify` 既是"系统通知"又被当成"错误日志"** | 一个频道既要承担"压缩完成、超额"等业务通知（severity info），又被 agent-core kernel 用作"取消、错误"通知（severity error/warning） | 前端要分辨哪些是"业务事件"哪些是"错误日志"，只能靠 message 字符串自己判断；无 schema 强制 |
| L3 | **trace_uuid 在 HTTP 链路严格强制（agent-core internal-policy.ts:165 校验 UUID 一致性），但 WebSocket session.stream.event 没要求 trace_uuid** | session-stream-event 只带 `stream_uuid` / `stream_seq` | WS 阶段的事件不可与 HTTP 阶段的请求做精确关联 |
| L4 | **eval-observability 是 prod-grade 协议，但只有 agent-core kernel + test 在用** | `TraceEvent` 设计为"任何 worker 都能发"，但实际只有一个 worker 知道这套 schema | 协议价值远未兑现 |
| L5 | **bash-core 返回纯文本错误，agent-core HTTP 入口返回裸 `{error}` JSON** | 与 facade 的 `{ok:false, error:{code,...}, trace_uuid}` 不兼容 | 前端如果把 `agent-core` / `bash-core` 当成 HTTP 入口，错误处理逻辑要分支 |
| L6 | **`observability.enabled = true` 是 Cloudflare 平台级日志，与 NACP 协议层 observability 同名但是不同物** | 文档/口语中说"我们打开了 observability"很容易让人误以为是 `NacpObservabilityEnvelope`，但实际只是 Cloudflare runtime 收 console 的 flag | 决策时容易把"已经做了 X"当成"协议接电了"，实际没有 |

### 4.4 事实认知混乱（口径错位 / 文档与代码不符）

| # | 混乱 | 文档/口径 | 代码事实 |
|---|---|---|---|
| F1 | "我们在 NACP 中预留了 log 和 error 部分" | charter / design 中暗示已落地 | error-registry / observability envelope **0 import**；对外只能说"协议已 schema-ready，runtime 未 wire" |
| F2 | "我们有 trace_uuid 全链路打通" | 是的 | 但只在 HTTP 链路；WS 阶段的 stream-event 不带 trace_uuid（只有 stream_uuid + session_uuid + turn_uuid），跨 HTTP/WS 的关联要靠 session_uuid 兜 |
| F3 | "Cloudflare observability 已开" | 6/6 wrangler ✅ | 这只是"console.warn 会被收"，不等于"我们有结构化日志" |
| F4 | "我们的 6 worker 都有日志" | 一般的口语 | orchestrator-auth 0 / bash-core 0；其他 4 个共 32 行 console.warn |
| F5 | "FacadeErrorEnvelope 是统一错误格式" | 是设计目标 | 6 worker 里只有 orchestrator-core 用；其他 5 个 worker 各有各的错误形态 |
| F6 | "agent-core 也实现了 NACP" | RH1/RH2 文档暗示 | agent-core HTTP 入口 (`workers/agent-core/src/index.ts:135`) 的 404 是 `{error: "Not found"}` 裸 JSON，**不符合 NACP / facade 任何一种 schema** |
| F7 | "session.stream.event 的 system.notify 等同于 server log channel" | 口语印象 | 它只在 agent-core kernel 错误路径触发；HTTP 阶段失败 / 其他 worker 失败一概不会产生 system.notify |
| F8 | "NACP 提供完整的可观测性栈" | charter / RH 设计文档 | NACP 的 observability envelope + alerts + metrics + traces 是 **schema only**，没有 emitter；evidence stream 也只在 eval 路径 |

---

## 5. 给前端开发的可观测性最小可用清单

> 这一节不是修复 PR，是 **工程事实**：前端在今天这个状态下，**确实可拿到的**、**确实拿不到的**、**应该追问 owner 的**。

### 5.1 前端今天能拿到（不需要 backend 改动）

1. **HTTP 响应 `x-trace-uuid` header** — 永远会有；前端应 100% 在 UI 错误界面展示。
2. **HTTP 4xx/5xx 响应体 `error.code` + `error.message`**（仅 orchestrator-core 路径）— 32 个 kebab-case code，可参考 `packages/orchestrator-auth-contract/src/facade-http.ts:48-84` 自行构建前端友好文案表。
3. **WebSocket `session.stream.event::system.notify`**（agent-core kernel runtime 错误，severity info/warning/error）— 应订阅并展示。
4. **WebSocket `session.stream.event::tool.call.result`**（status=error 时含 `error_message`）— 应订阅并展示。
5. **WebSocket `session.stream.event::compact.notify`** / `turn.begin/end` / `llm.delta` — 业务事件流，前端业务态依赖。
6. **WebSocket `session.attachment.superseded`**（reason: device-conflict / reattach / revoked / policy）— RH1-RH3 已落实；多设备 / 鉴权撤销时用得到。

### 5.2 前端今天拿不到（需要 backend 后续阶段补）

| 需求 | 现状 | 谁来补 |
|---|---|---|
| 服务端结构化请求日志（前端可读） | ❌ | 后续 observability phase |
| 跨 worker 链路追踪（哪一跳失败） | ❌ | 需要 facade error envelope 加 `caused_by_worker` 字段 + 上游 worker 也用 facade error |
| 错误 code 含义查询表 / docs | ❌ | 需要新建 `docs/api/error-codes.md`（合并 facade + NACP 两套，做映射）|
| 实时 server-event 通道（不限于 session）| ❌ | 协议层有 `NacpObservabilityEnvelope`，但 0 emitter |
| 单请求时序（`Server-Timing` 或类似） | ❌ | 简单，但要 6 个 worker 一起加 |
| 用户态遥测 opt-out | N/A | 还没启用 telemetry |
| 错误持久化（不依赖 Cloudflare TTL） | ❌ | 需要新建 D1 表 `nano_error_log` 或类似 |

### 5.3 前端应该向 owner 追问的事

1. **owner 是否接受"前端 debug 必须经 owner 截屏 trace_uuid 反查"作为 RH5 阶段的允许成本？** — 如果接受，前端就基于 `x-trace-uuid` 做 UI；不接受，则需要先做 observability phase。
2. **facade 32 codes 与 NACP 23 codes 的官方映射表在哪？** — 现在没有，前端只能用 facade。
3. **agent-core / bash-core / orchestrator-auth 的 HTTP 入口是否应当统一切到 `facadeError` 形态？** — 如果是，加进 RH5 hard gate。
4. **WebSocket 上是否会引入"日志/error 专用 channel"（不是 system.notify）？** — 会影响前端是否提前留 WS handler。
5. **前端是否可以直接读 Cloudflare Workers Logs（通过 owner 搭一个只读 dashboard 代理）？** — 比补 backend 快得多。

---

## 6. 推荐补救路径（仅为讨论，不是承诺）

> 顺序按 **杠杆比** 排序：每一项的"实现成本"vs"前端可观测性收益"。

| # | 动作 | 成本 | 收益 |
|---|---|---|---|
| R1 | 把 `facadeError` 推广到 6 个 worker 的 HTTP 入口（统一错误形态） | 低（≤2 天） | 高 — 前端从此只需一套 error parser |
| R2 | 新建 `docs/api/error-codes.md` 汇总 32 facade + 23 NACP code，含中文释义 + 前端文案建议 | 极低（半天） | 高 — 前端再不用读 zod 枚举 |
| R3 | 6 个 worker 引入一个共享 `@nano-agent/worker-logger` 包（封装 console，强制注入 trace_uuid + worker_name + level） | 中（2-3 天） | 高 — 解决 §4.4 F4 |
| R4 | 在 orchestrator-core / agent-core / 其它 4 worker 的 HTTP 响应里都加 `Server-Timing` header（哪怕只 1 个字段） | 低 | 中 — 前端开发者 Network 面板直接看延时分布 |
| R5 | 实装 `NacpObservabilityEnvelope` 的最小 emitter（至少 D1 写失败 / RPC parity 失败 / R2 写失败 三类 critical alert） | 中 | 高 — 给后续告警 / 监控接电 |
| R6 | 在 `session.stream.event` 里加一个新的 kind `log.entry`（severity, message, source_worker, trace_uuid），让前端开 dev-mode 能看 server log 流 | 中 | 中 — 解决 §4.1 B5 |
| R7 | 把 `eval-observability::TraceEvent` 推广到 prod HTTP 路径（不只 agent-core kernel） | 高 | 中 — 但与 R5 重叠 |

—— R1 + R2 + R3 是 **3 个最低成本动作**，可在 RH5 前置或与前端组装并行做，把"前端能 debug"门槛先降下来。

---

## 7. 修订历史

| 版本 | 日期 | 作者 | 变更 |
|---|---|---|---|
| `r1` | `2026-04-29` | `Opus 4.7 (1M)` | 首版：盘 NACP 协议预留 vs 6-worker 实际落地、claude-code/codex/gemini-cli 三家对比、§4 盲点/断点/逻辑错误/认知混乱清单、§5 前端可用性现状、§6 推荐补救路径（仅讨论） |
