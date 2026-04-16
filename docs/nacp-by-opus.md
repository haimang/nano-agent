# NACP v1 — Nano-Agent Communication Protocol

> 协议名: **NACP** (Nano-Agent Communication Protocol) v1
> 文档版本: **v2**（基于 `docs/nacp-reviewed-by-GPT.md` 的 review + 用户显式要求"把多租户控制提升到一等公民"的修订版）
> 设计日期: `2026-04-15`
> 设计者: `Claude Opus 4.6 (1M context)`
> 参考来源:
> - `context/smcp/` — SMCP v1.7.0 (Worker-first, Zod, `@smind/protocol`)
> - `context/safe/` — SAFE v1.0.0 (Python-native, 单文件宪法, SMCP v1.6.3 方言)
> - `context/codex/codex-rs/app-server-protocol/` — codex JSON-RPC-lite
> - `context/codex/codex-rs/protocol/` — codex 业务类型协议
> - `context/claude-code/services/mcp/types.ts` — claude-code MCP client transport 抽象
> - `context/mini-agent/mini_agent/acp/` — mini-agent 的 ACP 桥接
> 关联文档:
> - `README.md`
> - `docs/value-proposition-analysis-by-opus.md`
> - `docs/value-proposition-analysis-by-GPT.md`
> - `docs/vpa-fake-bash-by-opus.md`
> - `docs/design/hooks-by-opus.md`
> - **`docs/nacp-reviewed-by-GPT.md`**（v2 修订的直接输入）
> 文档状态: `draft-v2`

---

## v2 修订说明（与 v1 的差异）

v1 草案完成后，GPT 进行了一次系统 review（`docs/nacp-reviewed-by-GPT.md`），给出了 12 条盲点/断点清单；同时用户明确要求"把多租户控制提升到一等公民，像 SMCP 一样"。v2 对 v1 做了以下修订：

**结构性修订（GPT 的核心建议）**：
1. **从"单一总协议"重构为"协议家族"**：`NACP-Core`（内部 worker/DO/queue）+ `NACP-Session`（client ↔ session DO 的 WebSocket）+ `NACP-Transport Profiles`（具体 wire 规则）。v1 把三层压扁的做法被 v2 明确拆开。
2. **消息注册表从全局 REQUIRED 改为"分 profile + 分 role"**：每个组件只承诺自己角色内的消息类型子集。
3. **`producer` 从封闭 enum 改为 `producer_role`（闭） + `producer_id`（命名空间字符串）**：保留可观测性，恢复 service-composable 扩展性。
4. **`hook.broadcast` / `session.update` / `tool.call.progress`** 从 Core 迁移到 Session profile。
5. **新增 Session stream 的 `sequence` / `replay_from` / `last_seen_seq` / `stream_id` / `delivery_mode` / `ack_required` 字段**，解决 WebSocket 重连与事件流恢复问题。
6. **`header.delivery_kind`** 新增：`command / response / event / error`，让消息语义不只靠 message_type 字符串猜。
7. **`control.reply_to`** 取代泛化的 `correlation_uuid`，让 request/response 配对更清晰。
8. **新增 "Tool Progress 物理回传路径" 专节**，明确 service-binding RPC 场景下长工具的 progress 如何流回 session DO。
9. **新增运行时状态机约束专节**，明确"哪些消息在哪个 session phase 合法 / 哪些消息必须成对 / 谁能发什么"。
10. **代码骨架修订**：per-type body required 真正 enforce / size guard 分层做（encode + transport ingress 两处）/ deadline 作为 admissibility check 独立于 validate / 补 `context.compact.response` 消息类型。

**多租户相关修订（用户显式要求）**：
11. **新增 §5.4 专章：多租户一等公民**——租户身份、租户边界、资源调用与 refs namespacing、跨租户 delegation、配额传播、审计分区、每一种 transport 下的具体实现规则。
12. **`authority` 的 server-stamped 规则被正式写入**：client ↔ DO 的 WebSocket frame 中，client 不 author authority；ingress 层在 frame 进入 Core 前注入 authority；Core 内所有消息必填。
13. **`refs` 结构增加租户命名空间强制规则**：任何 R2/KV/DO 引用都必须把 `team_uuid` 写进 key prefix，协议层 parse 时做正则校验。
14. **`control.tenant_delegation`** 新增：跨租户调用（例如 platform 代 team 做操作）必须显式 delegate，带原始租户证据。
15. **`control.quota_hint`** 新增：配额与计费元数据作为协议一等字段，让每个 consumer 都能提前 reject 超配额请求。
16. **错误 registry 新增租户相关 code**：`NACP_TENANT_MISMATCH` / `NACP_TENANT_QUOTA_EXCEEDED` / `NACP_TENANT_BOUNDARY_VIOLATION` / `NACP_DELEGATION_INVALID`。
17. **状态机约束**：跨租户消息被默认拒绝；所有 Core consumer 在 validate 之后、处理之前必须再做一次 tenant scope check。

---

## 目录

0. [为什么需要这份协议](#0-为什么需要这份协议)
1. [云原生 agent runtime 需要什么样的通讯协议](#1-云原生-agent-runtime-需要什么样的通讯协议)
2. [现有方案深度走读](#2-现有方案深度走读)
3. [In-scope / Out-of-scope](#3-in-scope--out-of-scope)
4. [从各来源吸收什么](#4-从各来源吸收什么)
5. [NACP v1 规范 — 协议家族](#5-nacp-v1-规范--协议家族)
   - 5.0 协议家族分层
   - 5.1 Core Envelope 结构
   - 5.2 Core Header — 自声明 + 路由
   - 5.3 Authority — 服务端戳印规则
   - **5.4 【专章】多租户一等公民**
   - 5.5 Trace — 全链路 + 流式锚点
   - 5.6 Control — 控制面指令
   - 5.7 Body — 按 message_type 开放
   - 5.8 Refs — 租户命名空间化的大对象引用
   - 5.9 Extra — 安全阀扩展字段
   - 5.10 状态机约束
6. [消息注册表 — Core × Session × Per-Role](#6-消息注册表--core--session--per-role)
7. [Transport Profiles](#7-transport-profiles)
   - 7.1 Service Binding (Core)
   - 7.2 Cloudflare Queues (Core)
   - 7.3 Durable Object RPC (Core)
   - 7.4 WebSocket (Session profile)
   - 7.5 HTTP Callback profile
   - **7.6 Tool Progress 物理回传路径**
8. [错误、重试、幂等、配额](#8-错误重试幂等配额)
9. [版本化与兼容](#9-版本化与兼容)
10. [实现细节与骨架代码](#10-实现细节与骨架代码)
11. [实施路线图](#11-实施路线图)
12. [最终 Value Verdict](#12-最终-value-verdict)

---

## 0. 为什么需要这份协议

nano-agent 不是一个单体 Worker 脚本，而是一个**跨多个 Worker、多个 Durable Object、多个 Cloudflare 原生服务**协作的系统。从 `README.md` §5 的 value 对标表可以推出三条硬约束：

1. **模块化解耦** — hooks、skills、fake bash、context compactor、permission engine 都可能独立设计、独立部署、甚至独立运行在主 V8 isolate **之外**。这些模块之间**必须有一份稳定契约**，否则任何一次单独演进都会打破另一边。
2. **Service Binding 扩展** — 当 skill / hook / 能力扩展以 service binding 形态存在时，`env.SKILL_X` 传递的请求必须有**明确的 schema**，否则每个 skill 就要各写各的序列化，debug、审计、可观测性全部分裂。
3. **Cloudflare Queues 编排** — 长任务、跨 session 协作、DLQ 都会走 Queue。Queue message **不在线程中传递，而是跨时间传递**，producer 与 consumer 可能在不同时间、不同版本下部署。没有稳定协议就是灾难现场。

再加上 `README.md` §6 的目标——"**一个对 LLM 友好、对平台可治理、对产品可嵌入的能力层**"——"可治理"与"可嵌入"两个词都直接翻译成"要有一套稳定、可审计、可版本化的消息契约"。而 **"可治理" 在实际工程里的第一个落点就是多租户**：谁是 team / 谁是 user / 资源归谁 / 配额怎么算 / 审计怎么分区——这些问题的答案如果不放进协议，就永远只会散落在各个 worker 的启动参数、全局变量、env binding 里，互相不知道对方的承诺是什么。

**结论**：NACP 不是一个可选的"未来优化"，而是 nano-agent v1 必须先写完的**地基**。没有它，后续所有子系统的集成都会在"我的 field 叫什么 / 这条消息归谁"的争执里反复返工。

---

## 1. 云原生 agent runtime 需要什么样的通讯协议

综合 README、三份 VPA、SMCP、SAFE 的经验与 nano-agent 的实际使用场景，一份合格的通讯协议必须同时满足以下**十条**（v1 原本八条 + v2 新增两条关于层次与多租户的）：

| # | 需求 | 具体含义 | 对应设计点 |
|---|------|---------|-----------|
| 1 | **自声明** | 每条消息自带版本 / 类型 / 生产者 / 时间戳 | `Header` 必填 |
| 2 | **多租户一等公民** | team / user / plan_level 是消息体的一等字段；资源引用天然带租户 namespace；跨租户默认禁止 | `Authority` 必填 + `refs` namespacing + delegation |
| 3 | **控制面 vs 数据面分离** | "想让接收方做什么" 和 "涉及哪些数据资源" 分开声明 | `Control` vs `Body` 严格分层 |
| 4 | **全链路追踪** | trace_id / session_uuid / parent_message_uuid / stream_seq 重建整棵因果树与事件流 | `Trace` 结构必填 |
| 5 | **双端强 schema 校验** | 发送前 validate、接收后 parse；**失败必抛异常，禁止静默吞没** | zod + `validate()` 五层 |
| 6 | **传输层无关** | 协议只定义消息合同 | envelope 与 transport profile 分层 |
| 7 | **大对象外推** | 单条消息有硬上限，大数据走引用（R2/KV/DO key） | `Refs` + size guard |
| 8 | **版本兼容** | 协议升级时旧 sender/receiver 有 fallback 与 migration 路径 | `schema_version` + migration helpers |
| 9 | **协议分层** *(v2 新增)* | 内部 worker 契约 / client WebSocket / HTTP callback 不应被一个"大一统"强行压扁 | 三层 profile：Core + Session + Transport |
| 10 | **运行时状态约束** *(v2 新增)* | 消息 individually valid 不等于 runtime sequence 合法；协议必须定义 session phase 与 request/response 配对规则 | 状态机约束 §5.10 |

---

## 2. 现有方案深度走读

### 2.1 SMCP — 生产级 Worker-first 声明式协议

**来源**：`context/smcp/`（`@smind/protocol` v1.7.0）

**核心结构**（`src/schemas/common.ts:93-104` `SmcpMessageBaseSchema`）：
```ts
{
  schema_version: "1.7.0",
  message_uuid: UUID,
  message_type: string,
  sent_at: ISO8601,
  producer_worker: string,
  producer_role: "admin"|"dispatcher"|"skill"|"console"|"communicator"|"contexter"|"service",
  priority: "low"|"normal"|"high"|"urgent",
  authority_payload: { team_uuid, invoker_user_uuid, team_plan_level, membership_level? },
  control_payload: { trace_uuid?, run_uuid?, step_run_uuid?, workflow_uuid, ..., retry_context? },
  context_payload?: { context_refs: [{kind, uuid, key?}], context_meta: {} },
  payload_primary: ...
}
```

**特别亮眼的九点**：

1. **`IoPayloadSchema`**（`common.ts:60-64`）——`{input, output, refs}` 三字段；`refs` 是 `Record<string, string>`，把"大对象外推"写进了协议本身。
2. **`ErrorPayloadSchema`**（`common.ts:66-72`）——`{error_code, category: validation|transient|dependency|permanent|security|quota, message, detail?, retryable}`——category + retryable 让接收方直接决策是否重试，不需要解析 error message 字符串。
3. **`RetryContextSchema`**（`common.ts:37-43`）——重试状态嵌在 control_payload 里，下一个 consumer 继承完整重试上下文。
4. **`ServiceRequestPayloadSchema`**（`common.ts:85-91`）——`{service, action, request_uuid, timeout_ms, payload}`；request/response 用**独立 UUID** 关联。
5. **`HttpResponseSchema`**（`src/runtime/http.ts`）——`{ok: true, data}` | `{ok: false, error}` 收敛到 discriminated union；`mapErrorCategoryToStatus` 把 category 映射到 HTTP status。
6. **`ERROR_REGISTRY`**（`src/runtime/error_registry.ts`）——所有 known error code 集中定义，支持运行时注册新 code。
7. **`RetryPolicy` + `decideRetry`**（`src/runtime/retry.ts`）——**协议自带重试决策器**。
8. **`ObservabilityEnvelope`**（`src/runtime/observability.ts`）——观测数据也走 schema。
9. **版本兼容**（`src/compat/migrations.ts`）——`migrateV162MessageToV170` 是真正的迁移函数。

**对多租户的启示**：SMCP 的 `authority_payload` 在**每条消息里**都必填（`common.ts:30-35`），team_uuid 永远是消息的一等字段。这是 nano-agent 要直接照搬的根本态度。

### 2.2 SAFE — 从 SMCP 派生的 Python 方言

**来源**：`context/safe/safe.py`（952 行单文件）

**SAFE 相对 SMCP 做的五个简化**：

1. **信封结构更平**（`safe.py:313-408`）：`{header, authority, trace, control?, io?, payload_primary?, extra_payload?}` —— 7 字段。
2. **Trace 从三级简化为两级**（`safe.py:238-273`）：`trace_id + task_uuid`，对应 "request → task"。**agent 业务不需要三级**。
3. **`parent_message_uuid` 作为 trace 的一等字段**（`safe.py:269-270`）——构建消息因果链。
4. **REQUIRED vs OPTIONAL 两集合**（`safe.py:651-669`）——接收方启动时可检查自己覆盖了哪些 required 类型。v2 发现**全局 required 不适合 nano-agent 的角色化结构**，我们改为"per-role required"。
5. **单文件宪法分发**（`safe.py:67-77`）——对 nano-agent 不适用。

**SAFE 的五层 validate**（`safe.py:414-515`，最值得学的一段）：
- Layer 1: 存在性校验
- Layer 2: 注册表合法性
- Layer 3: 版本兼容性
- Layer 4: per-message-type payload 必填字段
- Layer 5: size guard

`to_json()/to_dict()/from_dict()` 都**强制**调用 `validate()`，失败 raise `ValueError`——**任何不经过 validate 的消息都不能进入审计日志**。

**Transport 层解耦**（`safe_transport.py`, 121 行）：`safe.py` 只定义消息合同；`safe_transport.py` 定义 `publish_safe_notify / record_safe_event / verify_safe_callback_auth`。**nano-agent 必须照抄这个分层**。

**对多租户的启示**：SAFE `validate()` 的 Layer 1 里 `authority.team_uuid` 必填是硬规则（`safe.py:448-449`），comment 直写 *"no anonymous messages"*。这是我们要在 NACP 里明确写进 validator 的第一条规则。

### 2.3 codex — JSON-RPC-lite + ts-rs 生成

**关键事实**（`app-server-protocol/src/jsonrpc_lite.rs:1-3`）：
> We do not do true JSON-RPC 2.0, as we neither send nor expect the "jsonrpc": "2.0" field.

**codex 明确不用标准 JSON-RPC**——request/response/notification 三种消息，但没有 `"jsonrpc": "2.0"` preamble。**nano-agent 沿用这一决策**。

**业务类型按领域拆文件**（`codex-rs/protocol/src/` 下 30+ 个 `.rs`）——我们的 `src/nacp/messages/*.ts` 按此组织。

**单一 SOT → 多目标生成**（Rust: `ts-rs` + `schemars`；我们: `zod` + `zod-to-json-schema`）——一次定义，TS 类型 + runtime 校验 + JSON schema 全部免费。

### 2.4 claude-code — 内部类型 + ACP/MCP 多协议适配

claude-code **内部不用统一协议**：`types/logs.ts` 是纯 TS 类型联合，**无 runtime schema 校验**；对外走 ACP / MCP / Anthropic SDK 三条独立 wire。**MCP transport 抽象**（`services/mcp/types.ts:23-26`）：`'stdio' | 'sse' | 'sse-ide' | 'http' | 'ws' | 'sdk'` 归到一个 `MCPServerConnection` 抽象下。

**可以借鉴的是 transport 抽象**；**不可借鉴的是"内部无统一 schema"**——对 nano-agent 我们明确要有 NACP 作为**内部唯一协议**。

### 2.5 mini-agent — ACP 桥接

mini-agent 完全不做内部协议，对外通过 `acp` 包的 `newSession / prompt / sessionUpdate / cancel` 做 IDE-like 交互（`acp/__init__.py:12-30`）。

**可以借鉴的是 ACP 的 session lifecycle 模式**——但**不是命名相似 = 协议兼容**（见 §5.0 的分层原则）。

---

## 3. In-scope / Out-of-scope

### 3.1 In-scope（NACP v1 要做）

**协议结构（v2 新增重点）**：

- **[S1] 协议家族分层**：`NACP-Core` + `NACP-Session` + `NACP-Transport Profiles` 三层。
- **[S2] Core Envelope 7 字段扁平结构**：`{header, authority, trace, control?, body?, refs?, extra?}`。
- **[S3] 自声明 header**：`schema_version / message_uuid / message_type / delivery_kind / sent_at / producer_role / producer_id / consumer_hint? / priority`。
- **[S4] 多租户一等公民**（见 §5.4 专章）：
  - `Authority` 必填，内部 Core 消息永远有 `team_uuid`
  - `refs` 强制带 `team_uuid` namespace
  - 跨租户默认拒绝；显式 `control.tenant_delegation` 才允许
  - `control.quota_hint` 作为协议字段
  - 审计分区按 `team_uuid`
- **[S5] 两级 trace + stream 锚点**：`trace_id / session_uuid / parent_message_uuid? / stream_id? / stream_seq?`。
- **[S6] control 结构**：`{reply_to?, deadline_ms?, timeout_ms?, idempotency_key?, capability_scope?, retry_context?, tenant_delegation?, quota_hint?, audience?}`。
- **[S7] body 按 message_type 开放 + per-type required 真正 enforce**（v2 修正 v1 的 bug）。
- **[S8] refs 大对象外推**：每条 ref 必须含 `{kind, binding, key, team_uuid, ...}`，`key` 必须以 `tenants/{team_uuid}/` 开头（协议层 regex 校验）。
- **[S9] extra 安全阀**。
- **[S10] 五层 validate**：存在性 / 注册表 / 版本兼容 / per-type body / size。**deadline check 从 validate 分离为独立的 admissibility check**（v2 修正）。
- **[S11] size guard 分层**：encode 阶段（生产者侧）+ transport ingress 阶段（消费者侧）两处都做。
- **[S12] `NacpError` 结构 + `NACP_ERROR_REGISTRY`**（含 4 个租户相关 code）。
- **[S13] `producer_role` 闭枚举 + `producer_id` 命名空间字符串**（v2 修正 v1 的 closed enum）。
- **[S14] 按 profile 分的 message registry**：不再有全局 `NACP_MESSAGE_TYPES_REQUIRED`；改为 `CORE_MESSAGE_TYPES` / `SESSION_MESSAGE_TYPES` / `PER_ROLE_REQUIREMENTS`。
- **[S15] 运行时状态机约束**：session phase、request/response 配对、role-gated message types。
- **[S16] Session profile 的 resume/replay 机制**：`stream_seq / replay_from / last_seen_seq / delivery_mode / ack_required`。
- **[S17] Tool Progress 物理回传路径**：明确 service-binding RPC 下 progress 怎么流回 session DO。
- **[S18] 四种 transport profile**：`service-binding` / `queue` / `do-rpc` / `http-callback`；WebSocket 属于 Session profile 的一部分。
- **[S19] HMAC 签名（http-callback profile）**：`X-NACP-SIGNATURE` (HMAC-SHA256) + `X-NACP-TIMESTAMP` + 5 分钟容差。
- **[S20] 单源多目标生成**：zod → TS 类型 + runtime 校验 + JSON schema（`zod-to-json-schema`）。
- **[S21] `NACP_VERSION` + `NACP_VERSION_COMPAT`**：v1.x.x 范围内所有 patch 版本互相兼容。

### 3.2 Out-of-scope（v1 不做）

- **[O1]** 标准 JSON-RPC 2.0 / gRPC / Protobuf / CBOR / MessagePack — JSON 为唯一编码。
- **[O2]** OpenTelemetry 全面接入（只保留 `span_id?` 占位）。
- **[O3]** 多协议并行；v1 内部统一 NACP。
- **[O4]** 端到端加密（service binding 天然不出公网，E2E 留给 v2）。
- **[O5]** 流式消息分片重组（整条消息要么 ≤ 96KB，要么走 `refs`）。
- **[O6]** SMCP 风格的完整 workflow DSL（`WORKFLOW_START / STEP_START / STEP_CALLBACK / STEP_RESTART`）——nano-agent 的 agent loop 驱动执行，不需要独立 workflow 编排器。
- **[O7]** Multi-version 并存；v1 阶段每个部署只跑一个 schema_version。
- **[O8]** 协议层 rate limit（那是 capability/permission engine 的责任）。协议只传递 `quota_hint`，不做限流决策。
- **[O9]** 跨租户资源共享（v2 可能新增 shared-resource namespace）——v1 禁止任何跨租户访问。

### 3.3 灰色地带

| 项目 | 判定 | 理由 |
|------|------|------|
| WebSocket subprotocol 名字 | **In-scope**：`nacp-session.v1` | 与 Core 区分开 |
| Client 侧 WebSocket frame 省略 `authority` | **In-scope**：允许 | server-stamped 规则要求 client 不 author authority，由 ingress 注入（v2 修正） |
| Session profile 的 resume 跨 DO 实例 | **Out-of-scope** | v1 只支持同 DO 实例的 reconnect resume |
| Tenant delegation 的审批链 | **In-scope（字段）** + **Out-of-scope（审批流程实现）** | 协议定义 delegation 字段，具体审批留给 permission engine |
| 共享只读资源（例如公共 skill 库） | **Out-of-scope（v1）** | v1 强制 `tenants/{team_uuid}/` 前缀；公共资源等 v2 `tenants/_platform/` 保留 |
| 跨 team 的审计访问 | **Out-of-scope** | v1 审计按 team_uuid 分区，跨 team 访问属于运维工具层 |

---

## 4. 从各来源吸收什么

### 4.1 从 SMCP 吸收（主要灵感源）

| 吸收点 | 源位置 | 在 NACP v1 的对应 |
|--------|--------|-------------------|
| **discriminated union 的 message type 组织** | `src/schemas/envelopes.ts:5-8` | `NacpCoreSchema = z.discriminatedUnion("message_type", [...])` |
| **base + extend 模式** | `src/schemas/common.ts:93-104` | `NacpEnvelopeBase.extend({ message_type: z.literal(...), body: BodySchema })` |
| **IoPayload 的 refs 字段** | `common.ts:60-64` | NACP 的 `refs` 字段（扩展为数组 + tenant namespace） |
| **ErrorPayload 的 category + retryable** | `common.ts:66-72` | `NacpError` 类型 7 个 category 原样沿用 |
| **RetryContext 结构** | `common.ts:37-43` | `control.retry_context` 原样借用 |
| **ServiceRequestPayload 独立 request_uuid** | `common.ts:85-91` | v2 改为 `control.reply_to`（GPT 建议，更明确） |
| **control vs body 严格分层** | 整仓 | NACP 严格沿用 |
| **HttpResponseSchema `{ok, data}` / `{ok, error}` union** | `src/runtime/http.ts:10-16` | NACP http-callback profile 用同一 pattern |
| **`mapErrorCategoryToStatus`** | `http.ts:22-38` | 同名函数同样映射表 |
| **ERROR_REGISTRY 集中定义** | `src/runtime/error_registry.ts:10-60` | `NACP_ERROR_REGISTRY` 直接照搬结构 |
| **RetryPolicy + decideRetry + calculateBackoffDelay** | `src/runtime/retry.ts` | 全套沿用 |
| **ObservabilityEnvelope 独立结构** | `src/runtime/observability.ts` | v2 做字段占位；完整实现在 v1.1 |
| **compat/migrations.ts 迁移模板** | `src/compat/migrations.ts:19-42` | 未来升级直接沿用 pattern |
| **zod 全面用作 runtime 校验** | 全仓 | NACP 100% zod |
| **semver schema regex** | `common.ts:3-5` | `NacpSemverSchema` 原样借用 |
| **MessagePriority enum** | `common.ts:28` | 原样沿用 `low/normal/high/urgent` |
| **authority 作为每条消息的一等字段** | `common.ts:30-35`（整仓都这样） | **NACP v2 多租户一等公民的直接灵感源** |

### 4.2 从 SAFE 吸收（简化与工程态度）

| 吸收点 | 源位置 | 在 NACP v1 的对应 |
|--------|--------|-------------------|
| **7 字段扁平信封** | `safe.py:313-408` | NACP Core envelope 几乎原样照搬 |
| **trace 从三级简化为两级** | `safe.py:238-273` | NACP 的 trace 采用 2 级 |
| **`parent_message_uuid` 作为一等 trace 字段** | `safe.py:269-270` | `trace.parent_message_uuid` 必须有 |
| **REQUIRED vs OPTIONAL 两 frozen set** | `safe.py:651-669` | v2 改良为 "per-profile + per-role"（GPT 建议） |
| **五层 validate 机制** | `safe.py:414-515` | NACP 五层 validate 照搬结构，deadline 分离为独立层（v2 修正） |
| **to_json/to_dict/from_dict 都强制 validate** | `safe.py:527, 550, 586, 609` | NACP `encode()/decode()` 内部必调 validate |
| **Size guard + 明确 error message（提示用 refs）** | `safe.py:531-537` | NACP size guard（96KB）在 encode 阶段做；transport ingress 再做一次 |
| **协议文件与 transport 文件分两个** | `safe.py` vs `safe_transport.py` | NACP `src/nacp/envelope.ts` vs `src/nacp/transport/*.ts` |
| **`verify_callback_auth` 在协议处理之前** | `safe_transport.py:32-35` | NACP http-callback 先验签再 validate |
| **"No anonymous messages" 的硬规则** | `safe.py:448-449` comment | NACP Core validator 的第一条规则 |

### 4.3 从 codex 吸收

| 吸收点 | 源位置 | 在 NACP v1 的对应 |
|--------|--------|-------------------|
| **不做标准 JSON-RPC 2.0 preamble** | `jsonrpc_lite.rs:1-3` | NACP 同样不做 |
| **业务类型按领域拆文件** | `codex-rs/protocol/src/` 30+ .rs | `src/nacp/messages/*.ts` 按领域拆 |
| **协议 = 业务类型 + wrapper 两层** | app-server-protocol vs protocol crate | `envelope.ts`（wrapper） + `messages/*.ts`（业务类型） |
| **单一 SOT → 多目标生成** | `lib.rs` 的 `generate_ts / generate_json` | `scripts/export-schema.ts` 导出 JSON schema |
| **request/response/notification 三种消息** | `jsonrpc_lite.rs` `RequestId` | NACP 的 `header.delivery_kind: command/response/event/error` |

### 4.4 从 claude-code & mini-agent 吸收

| 吸收点 | 源位置 | 对应 |
|--------|--------|------|
| **transport 抽象归一化** | `services/mcp/types.ts:23-26` | `NacpTransport` 接口 + 5 个实现 |
| **ACP-style session lifecycle** | `mini-agent/.../acp/__init__.py` | NACP-Session profile 的 lifecycle 命名借鉴 ACP；但 v2 明确：**是 bridge 不是兼容**（GPT 建议） |
| **`sessionUpdate` 作为 server-push 统一入口** | ACP 设计 | NACP-Session 的所有 server-push 走 `session.stream.event` notification |

---

## 5. NACP v1 规范 — 协议家族

### 5.0 协议家族分层

**GPT review 的最大建议**是：不要把"内部 worker 合同"、"client WebSocket wire"、"外部 HTTP callback"压成一个协议。v2 接受这个建议，把 NACP 拆成**三层协议家族**：

```
                 ┌─────────────────────────────────────────────────────┐
                 │  NACP Protocol Family v1                            │
                 │                                                     │
                 │  ┌───────────────────────────────────────────────┐ │
                 │  │  NACP-Core                                    │ │
                 │  │  envelope + authority + trace + control +     │ │
                 │  │  body + refs + extra                          │ │
                 │  │  (worker / DO / queue / audit 内部合同)        │ │
                 │  └───────────────────────────────────────────────┘ │
                 │       ▲                                             │
                 │       │ extends / wraps                             │
                 │       │                                             │
                 │  ┌────┴──────────────────┐   ┌──────────────────┐  │
                 │  │  NACP-Session         │   │  NACP-Transport  │  │
                 │  │  (client ↔ DO)        │   │  Profiles        │  │
                 │  │                       │   │                  │  │
                 │  │  stream_seq / replay  │   │  service-binding │  │
                 │  │  ack / delivery_mode  │   │  queue           │  │
                 │  │  session phase state  │   │  do-rpc          │  │
                 │  │  ACP bridge           │   │  http-callback   │  │
                 │  └───────────────────────┘   └──────────────────┘  │
                 │                                                     │
                 └─────────────────────────────────────────────────────┘
```

**分层原则**：

| 层 | 职责 | 稳定性诉求 | 消费者 |
|----|------|----------|--------|
| **Core** | 内部 worker/DO/queue 的通讯合同 | 最高（版本兼容期最长） | 所有内部模块必须理解 |
| **Session** | client ↔ session DO 的 WebSocket 交互协议 | 高（API 稳定对客户端非常重要） | 只有 session DO 与客户端 |
| **Transport Profiles** | 每种 wire 的附加规则（header、签名、size、重试） | 中（可随 CF 能力演进） | 只有对应 transport 的 producer/consumer |

**三层之间的关系**：
- **Core envelope 是所有层的基础**——Session frame 是 Core envelope 的扩展；Transport profile 只规定怎么把 Core envelope 塞进具体 wire，不改变 envelope 自身结构。
- **Session 消息的 frame = Core envelope + `session_frame` 扩展段**（见 §5.10 与 §6）。
- **Transport profile 不定义消息类型**——它只定义"Core/Session 的消息如何通过这个 wire 传输"。

**一个具体例子**：
- `tool.call.request` 是一个 **Core message**
- 它通过 **service-binding profile** 从 session DO 发到 skill worker
- skill worker 返回 `tool.call.response`（Core message）
- 与此同时，session DO 通过 **NACP-Session profile** 把**另一条** `session.stream.event` 消息（内嵌 `kind: "tool.call.progress"` 的 frame 信息）push 给 WebSocket client
- 这两条消息走**不同的协议层**，不互相污染

这个拆分解决了 GPT review 的断点 2.1（协议边界扁平）、2.3（progress 无闭合路径）、2.7（`hook.broadcast` 不应该是 Core）。

### 5.1 Core Envelope 结构

**JSON 示例**（`tool.call.request` 消息，Core 层）：
```json
{
  "header": {
    "schema_version": "1.0.0",
    "message_uuid": "b7e2a01c-4db4-4e9f-a0bb-3e4c1c7c6a7b",
    "message_type": "tool.call.request",
    "delivery_kind": "command",
    "sent_at": "2026-04-15T12:34:56.789+00:00",
    "producer_role": "session",
    "producer_id": "nano-agent.session.do@v1",
    "consumer_hint": "nano-agent.skill.browser@v1",
    "priority": "normal"
  },
  "authority": {
    "team_uuid": "11111111-1111-1111-1111-111111111111",
    "user_uuid": "22222222-2222-2222-2222-222222222222",
    "plan_level": "pro",
    "stamped_by": "nano-agent.platform.ingress@v1",
    "stamped_at": "2026-04-15T12:34:56.000+00:00"
  },
  "trace": {
    "trace_id": "33333333-3333-3333-3333-333333333333",
    "session_uuid": "44444444-4444-4444-4444-444444444444",
    "parent_message_uuid": "55555555-5555-5555-5555-555555555555"
  },
  "control": {
    "reply_to": "66666666-6666-6666-6666-666666666666",
    "idempotency_key": "tool-call-42",
    "deadline_ms": 1744717500000,
    "timeout_ms": 30000,
    "capability_scope": ["browser:render"],
    "quota_hint": { "budget_remaining_ms": 45000, "plan_level": "pro" },
    "audience": "internal"
  },
  "body": {
    "tool_name": "browser",
    "tool_input": { "url": "https://example.com", "format": "markdown" }
  },
  "refs": [
    {
      "kind": "r2",
      "binding": "R2_WORKSPACE",
      "team_uuid": "11111111-1111-1111-1111-111111111111",
      "key": "tenants/11111111-1111-1111-1111-111111111111/sessions/4444.../attach/input.json",
      "role": "input"
    }
  ]
}
```

### 5.2 Core Header — 自声明 + 路由

```ts
// src/nacp/envelope.ts

export const NacpSemverSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "invalid_semver");

export const NacpPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

// v2: 从 closed enum 改为 role + namespaced id
export const NacpProducerRoleSchema = z.enum([
  "session",     // session DO 本体
  "hook",        // hook dispatcher
  "skill",       // 任意 skill worker
  "capability",  // 任意 capability worker (browser/ai/py-runner/js-sandbox/...)
  "queue",       // queue producer / consumer
  "ingress",     // 接入层（http / websocket 入口）
  "client",      // 远端 client（仅出现在 Session frame）
  "platform",    // 平台策略 / 审计 / 运维
]);

export const NacpProducerIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z][a-z0-9\-]*(\.[a-z][a-z0-9\-]*)+@v\d+$/, "producer_id must be 'ns.sub@vN'");
// 例: "nano-agent.session.do@v1" / "nano-agent.skill.browser@v1" / "acme.plugin.foo@v2"

// v2 新增：明确消息语义
export const NacpDeliveryKindSchema = z.enum([
  "command",       // request
  "response",      // reply to a command
  "event",         // notification / 不期待 response
  "error",         // 错误回复（无 reply_to 的错误）
]);

export const NacpHeaderSchema = z.object({
  schema_version: NacpSemverSchema,
  message_uuid: z.uuid(),
  message_type: z.string().min(1).max(128),
  delivery_kind: NacpDeliveryKindSchema,
  sent_at: z.iso.datetime({ offset: true }),
  producer_role: NacpProducerRoleSchema,
  producer_id: NacpProducerIdSchema,
  consumer_hint: NacpProducerIdSchema.optional(),
  priority: NacpPrioritySchema.default("normal"),
});
```

**GPT 2.6 修正**：`producer_role`（闭）决定**信任类别**，`producer_id`（开放字符串）决定**可观测性身份**。新增一个 skill worker 不需要改协议。

**GPT 2.10 修正**：`delivery_kind` 明确消息语义，下游不用靠 `message_type` 字符串结尾的 `.request/.response` 猜。

### 5.3 Authority — 服务端戳印规则

```ts
export const NacpPlanLevelSchema = z.enum(["free", "pro", "enterprise", "internal"]);

export const NacpMembershipLevelSchema = z.enum([
  "owner", "admin", "operator", "member", "readonly",
]);

export const NacpAuthoritySchema = z.object({
  // ── 租户身份（强制）──
  team_uuid: z.string().min(1).max(64),        // 支持 UUID 与保留值 "_platform"
  user_uuid: z.uuid().optional(),               // API key 场景可省
  plan_level: NacpPlanLevelSchema,
  membership_level: NacpMembershipLevelSchema.optional(),

  // ── 服务端戳印（v2 新增，GPT 2.4 修正）──
  stamped_by: NacpProducerIdSchema,             // 是哪个 ingress / 平台组件盖了章
  stamped_at: z.iso.datetime({ offset: true }), // 戳印时间
});
```

**Server-stamped 规则**（GPT review §2.4 的直接修正）：

1. **`authority` 字段只能由"可信组件"写入**。可信组件：ingress、session DO、platform、queue。
2. **远端 client 通过 WebSocket 发送的 Session frame 必须省略 `authority`**——Session profile 在 frame 结构里允许 authority 为空。
3. **Ingress 层在 frame 进入 Core 前**，根据 client 的 auth token 注入 `authority`（team_uuid + user_uuid + plan_level）并填写 `stamped_by` = ingress 的 `producer_id`、`stamped_at` = 当前时间。
4. **所有 Core 内部消息的 `authority` 永远必填**——缺失 = `NACP_VALIDATION_FAILED`。
5. **接收方必须在 validate 后、业务处理前再做一次 tenant scope check**：对照 `refs` 里的 `team_uuid` / 对照当前 DO 的 team 上下文 / 对照 consumer 的 capability scope。任一不一致 = `NACP_TENANT_BOUNDARY_VIOLATION`。

**"why stamped_by" 的价值**：审计日志里可以直接看到"这条消息的租户声明是在哪个组件完成的"。如果未来发现伪造 authority 的漏洞，可以直接回查 `stamped_by`。

**`team_uuid = "_platform"` 保留值**：仅限 `producer_role == "platform"` 的消息使用；任何其他 producer_role 发出 `team_uuid = "_platform"` 的消息立即拒绝。

---

### 5.4 【专章】多租户一等公民

> **用户显式要求**：把多租户控制提升到一等公民，明确多租户下的权限、边界、资源调用对 NACP 协议的影响以及具体实现。
>
> **SMCP 的做法作为标杆**：`SmcpAuthorityPayloadSchema` (`common.ts:30-35`) 在每条消息里都必填；team_uuid 是协议的先天属性而不是后加功能。NACP v2 必须做到与 SMCP 同级甚至更强。

本节系统回答四个问题：**租户身份如何表达 / 租户边界如何强制 / 租户资源如何命名 / 跨租户操作如何 delegate**。每个问题后面都跟一个"对协议与实现的具体影响"清单。

#### 5.4.1 租户身份的表达

**协议决定**：
1. **`authority.team_uuid` 是每条 Core 消息的必填字段**。唯一例外是 Session profile 的 **client → server frame**，由 ingress 注入（见 §5.3）。
2. **`team_uuid` 的合法取值**：UUIDv4 或**保留值** `_platform`。`_platform` 只允许 `producer_role == "platform"` 使用；任何其他角色发出 `team_uuid == "_platform"` 立即 `NACP_TENANT_BOUNDARY_VIOLATION`。
3. **匿名消息被硬禁止**。缺 `team_uuid` = `NACP_VALIDATION_FAILED`，不是 warning、不是 degrade、不允许 fallback。
4. **`user_uuid` 可省**（API key 场景无具体用户），但 `team_uuid` 永远不可省。这与 SAFE `safe.py:220-222` 的判断一致。
5. **`plan_level`** 是必填字段，决定 capability 与 quota 的默认基线：`free / pro / enterprise / internal`。
6. **`membership_level`** 可选，表示用户在 team 内的权限（owner/admin/operator/member/readonly），用于受限操作的二次校验。

**对实现的影响**：
- `validateEnvelope()` 的 Layer 1（存在性校验）里显式检查 `team_uuid` 非空；缺失立即抛 `NACP_VALIDATION_FAILED`。
- 每个 Core consumer worker 在启动时把自己的"允许服务的 team_uuid 集合"从 env 配置读出来；收到任何不在集合里的消息时 `NACP_TENANT_MISMATCH`（`producer_role == "platform"` 的消息除外）。

#### 5.4.2 租户边界的强制

**协议决定**：
1. **跨租户消息默认被拒绝**。接收方在 validate 之后、业务处理之前，必须执行以下检查：
   - **`refs[*].team_uuid == authority.team_uuid`**——每个 ref 的租户必须与 authority 一致
   - **`refs[*].key` 以 `tenants/{team_uuid}/` 前缀开头**——key 上的租户 namespace 也要对得上
   - **当前 consumer 的 "serving team" == authority.team_uuid**（如果 consumer 是 tenant-pinned 的）
   - 任一不一致 = `NACP_TENANT_BOUNDARY_VIOLATION`，拒绝处理并写审计
2. **跨租户只能通过显式 delegation**。想跨租户的消息必须在 `control.tenant_delegation` 里提供**完整的委托证据链**（见 §5.4.4）。
3. **禁止隐式 fan-out**：如果一个 queue consumer 想把一条消息"转给另一个 team 的 consumer"，不允许直接转——必须先发送给 platform，由 platform 签发新的 message（带新的 authority）。
4. **审计 trail 永远跨不出租户**：team A 的任何成员不能看到 team B 的审计日志，即使 audit worker 是同一个；audit worker 按 `team_uuid` 分区存储（见 §5.4.6）。

**对实现的影响**：
- **统一的 `verifyTenantBoundary(envelope, context)` 函数**，每个 consumer 在 handler 入口必调一次；失败直接返回 error envelope。
- **R2/KV 的 write 路径必须用包装函数**：`tenantR2Put(team_uuid, path, body)` 内部把 `path` 强制 prefix 为 `tenants/{team_uuid}/...`。禁止直接调 `env.R2.put`。
- **DO 的 idFromName 必须包含 team_uuid**：`env.SESSION_DO.idFromName(\`team:\${team_uuid}:session:\${session_uuid}\`)`。namespace 天然隔离。
- **Queue consumer 的 filter**：consumer worker 启动时注册只接受自己 team 的消息（当 `platform == false`）；CF Queues 本身没有 per-tenant filter，所以要 consumer 侧 guard。

#### 5.4.3 租户资源的命名与引用

**协议决定**：
1. **所有 `refs[*].key` 必须以 `tenants/{team_uuid}/` 开头**。协议层的 `NacpRefSchema` 里用 regex 直接 enforce：
   ```
   /^tenants\/(?:[0-9a-fA-F\-]{36}|_platform)\/[^\/].*/
   ```
2. **`refs[*]` 结构新增 `team_uuid` 字段**（与 key 中的 team_uuid 必须一致，双重保险）。
3. **每种资源类型都有自己的 key schema**（不强制 enforce，但推荐：
   - R2: `tenants/{team_uuid}/{category}/{session_uuid}/{name}` 例如 `tenants/abc/sessions/xyz/attach/input.json`
   - KV: `tenants/{team_uuid}/config/{key}`
   - DO storage: `tenants/{team_uuid}/{session_uuid}/{key}`
   - D1 row: 查询时必须带 `WHERE team_uuid = ?`，协议层不能 enforce 但 code review 必须
   - Queue DLQ: `tenants/{team_uuid}/dlq/{msg_uuid}`
4. **`refs` 的 `team_uuid` 必须等于 `authority.team_uuid`**（`_platform` 除外）——否则 `NACP_TENANT_BOUNDARY_VIOLATION`。

**对实现的影响**：
- **`NacpRefSchema` 的 refinement**：
  ```ts
  const NacpRefSchema = z.object({
    kind: z.enum(["r2", "kv", "do-storage", "d1", "queue-dlq"]),
    binding: z.string().min(1).max(64),
    team_uuid: z.string().min(1).max(64),
    key: z.string().min(1).max(512),
    // ...
  }).refine(
    (r) => r.key.startsWith(`tenants/${r.team_uuid}/`),
    { message: "ref.key must start with tenants/{team_uuid}/", path: ["key"] }
  );
  ```
- **资源访问包装层**：`src/nacp/tenancy/scoped-io.ts` 提供 `readRef(env, ref)` / `writeRef(env, ref, body)`，内部再次验证 key prefix。**禁止任何 worker 直接访问 env.R2 / env.KV / env.DO 的原始 API**。

#### 5.4.4 跨租户 Delegation — 委托语义

**协议决定**：

跨租户操作只能通过 `control.tenant_delegation` 字段显式声明，其结构：
```ts
const NacpTenantDelegationSchema = z.object({
  // ── 被代理的原始租户 ──
  delegated_team_uuid: z.string().min(1).max(64),

  // ── 委托方（谁授予了这次代理） ──
  delegator_role: z.enum(["platform", "owner", "admin"]),
  delegator_user_uuid: z.uuid().optional(),

  // ── 代理范围（允许做什么） ──
  scope: z.array(z.enum([
    "read", "write", "exec", "audit-read", "quota-override",
  ])).min(1),

  // ── 代理证据 ──
  delegation_uuid: z.uuid(),                 // 一次性 delegation ID
  delegation_issued_at: z.iso.datetime({ offset: true }),
  delegation_expires_at: z.iso.datetime({ offset: true }),
  delegation_reason: z.string().min(1).max(256),

  // ── 平台签名（防伪造） ──
  signature: z.string().min(1).max(512),     // HMAC of delegation fields
});
```

**规则**：
1. **只有 `producer_role == "platform"` 的消息可以携带 `tenant_delegation`**。其他角色的消息里出现该字段 → `NACP_DELEGATION_INVALID`。
2. **`authority.team_uuid` 在 delegation 场景下 = 被代理的目标团队 `delegated_team_uuid`**，但 `authority.stamped_by` 必须是 platform 组件。
3. **`delegation_expires_at` 过期** → 拒绝处理，返回 `NACP_DELEGATION_INVALID`。
4. **`signature` 验证**：receiver 用共享 delegation secret（存在 platform env 里）验证 HMAC。无法验证 = 拒绝。
5. **Delegation 的审计轨迹**：每次跨租户 delegation 必须在两个租户的审计日志里都留一条 record（被代理方一条 "your resource accessed by delegation"，平台侧一条 "delegation exercised"）。
6. **禁止 delegation 嵌套**：一条 delegation 消息处理过程中再发出的 Core 消息不允许携带新的 `tenant_delegation`。这避免权限无限转递。

**使用场景**：
- 平台运维需要清理某 team 的孤儿资源
- Cron worker 需要代某 team 触发一次 compact
- 跨 team 的 capability 共享（v2 考虑；v1 禁止）

**明确排除**：user-to-user delegation、team-to-team 横向 delegation 在 v1 都不做。

#### 5.4.5 配额传播 — `quota_hint`

**协议决定**：
```ts
const NacpQuotaHintSchema = z.object({
  plan_level: NacpPlanLevelSchema,
  budget_remaining_ms: z.int().min(0).optional(),      // 本次请求还剩多少 CPU ms
  token_budget_remaining: z.int().min(0).optional(),   // LLM token 预算
  rate_limit_bucket: z.string().max(64).optional(),    // e.g. "team:abc:tool-calls"
  rate_limit_remaining: z.int().min(0).optional(),
  rate_limit_reset_ms: z.int().min(0).optional(),
});
```

**规则**：
1. `quota_hint` 在 `control` 里，是**可选**字段——发送方按能力提供。
2. **下游 consumer 可以据此提前拒绝**：如果 `budget_remaining_ms < 估算执行时间`，直接返回 `NACP_TENANT_QUOTA_EXCEEDED` 而不是真去跑一半再超时。
3. **consumer 必须回填消耗**：response envelope 的 `control.quota_hint.budget_remaining_ms` 应当被减掉本次消耗，让 caller 知道剩余预算。
4. **协议不做限流决策**——limit 判断由 capability/permission engine 做；quota_hint 只是"知情同意"机制。

**配额的事实存储**：不在协议里——协议只是**传播**，真实配额在 **KV + D1** 里（`tenants/{team_uuid}/quota/*`）。

#### 5.4.6 审计分区与可见性

**协议决定**：
1. **所有 Core 消息都必须可以被审计**——producer 侧建议（不强制）在发送前通过 `audit-record` 消息（Core message type）通知 audit worker。
2. **审计日志按 `team_uuid` 分区存储**：R2 key = `tenants/{team_uuid}/audit/{yyyy-mm-dd}/{message_uuid}.json`。
3. **跨租户查询被协议拒绝**：audit query 消息必须带 `authority.team_uuid`，audit worker 只返回该 team 的日志；`producer_role == "platform"` 且带有效 `tenant_delegation` 的查询可以跨 team（但必须写一条 "cross-team audit access" 到 `_platform` 审计日志）。
4. **`audience` 字段**：`control.audience ∈ {"internal", "audit-only", "client-visible"}` 决定可见性。`client-visible` 的消息允许被 Session profile 广播给客户端；`audit-only` 的消息不广播。

**`control.audience` 与 `redaction_hint`**：
```ts
const NacpAudienceSchema = z.enum(["internal", "audit-only", "client-visible"]);

// 按 field path 给出"要被 redact 的位置"
const NacpRedactionHintSchema = z.array(z.string().max(128));
// 例: ["body.tool_input.api_key", "body.credentials"]
```

当消息被转为 `hook.broadcast` 或 `session.stream.event` 时，**Session profile 的 frame builder 必须消费 `redaction_hint`**，把对应字段替换为 `"[redacted]"`。

#### 5.4.7 每个 Transport 的多租户具体实现

| Transport | 租户规则 |
|-----------|---------|
| **Service Binding** | consumer worker 启动时绑定一个 "serving team" 策略（platform / tenant-pinned / any）；收到消息后对比 `authority.team_uuid`，不符合就返回 error envelope 而不是执行 |
| **Queue** | 一个 Queue 可以共享多 team（CF Queues 没有 per-tenant partition），但 consumer 侧**必须**在 handler 第一行跑 `verifyTenantBoundary(envelope)`；DLQ key 用 `tenants/{team_uuid}/dlq/` |
| **DO RPC** | DO id 必须包含 team_uuid（`team:{uuid}:...`），同一个 DO class 的不同 id 天然隔离 |
| **WebSocket (Session)** | client 发 frame 时 **不带 authority**；ingress 根据 JWT / session cookie 注入；同一 WebSocket 连接只服务一个 team（切 team 必须断开重连） |
| **HTTP Callback** | 入站 callback 用 `X-NACP-SIGNATURE` 验签；签名的 secret **按 team 分区**（`secrets/tenants/{team_uuid}/callback`），防止 team A 的 secret 伪造 team B 的 callback |

**一条硬规则**：任何 transport 在把消息交给 handler 之前，都必须先跑完整的 `validateEnvelope() → verifyTenantBoundary() → admissibilityCheck()` 三步。**transport 自己不做这三步就不允许 dispatch**。

---

### 5.5 Trace — 全链路 + 流式锚点

```ts
export const NacpTraceSchema = z.object({
  trace_id: z.uuid(),                             // 一次完整请求的根追踪 ID
  session_uuid: z.uuid(),                         // nano-agent session / DO 实例 ID
  parent_message_uuid: z.uuid().optional(),       // 因果链上一节点

  // v2 新增（GPT 2.2 修正）：流式锚点
  stream_id: z.string().min(1).max(128).optional(),  // 流的稳定 ID（例如 "tool-call-{request_uuid}"）
  stream_seq: z.int().min(0).optional(),             // 同一 stream 内的单调自增序号
  span_id: z.string().max(32).optional(),            // OTel 占位，v1 不强制
});
```

**`stream_id` / `stream_seq` 的用途**：长工具 progress、hook broadcast、session update 这类 server-push 事件都有"同一个逻辑流内的顺序"需求。client 断线重连时拿到 `last_seen_seq`，server 从那一条之后重放。

**规则**：
1. 同一 `stream_id` 内的 `stream_seq` 必须单调递增
2. `stream_seq` 从 0 开始
3. 不同 `stream_id` 的 seq 完全独立

### 5.6 Control — 控制面指令

```ts
export const NacpRetryContextSchema = z.object({
  attempt: z.int().min(0),
  max_attempts: z.int().min(1),
  last_error_code: z.string().min(1).optional(),
  next_backoff_ms: z.int().min(0).optional(),
  decision: z.enum(["retry", "dead_letter", "abort"]).optional(),
});

export const NacpControlSchema = z.object({
  // ── request / response 配对（v2 改名） ──
  reply_to: z.uuid().optional(),              // 回复的是哪条消息（原 v1 叫 correlation_uuid）
  request_uuid: z.uuid().optional(),          // 本消息作为 command 时的自分配 ID

  // ── 时间与超时 ──
  deadline_ms: z.int().min(0).optional(),     // 绝对 Unix ms 时间戳
  timeout_ms: z.int().min(100).max(300000).optional(),

  // ── 幂等 ──
  idempotency_key: z.string().min(1).max(128).optional(),

  // ── 能力与配额（多租户） ──
  capability_scope: z.array(z.string()).optional(),
  quota_hint: NacpQuotaHintSchema.optional(),
  tenant_delegation: NacpTenantDelegationSchema.optional(),

  // ── 可见性与审计（v2 新增） ──
  audience: NacpAudienceSchema.default("internal"),
  redaction_hint: NacpRedactionHintSchema.optional(),

  // ── 重试上下文 ──
  retry_context: NacpRetryContextSchema.optional(),
}).optional();
```

### 5.7 Body — 按 `message_type` 开放

**每种 message_type 对应一个 zod schema**，body **不是** `z.unknown()`。见 §6 的注册表。

**v2 关键修正（GPT 2.10 bug）**：
- v1 代码里 `validateEnvelope()` 有 `env.body !== undefined` 才 parse body 的 bug
- v2 修正：对于 **require body 的 message_type**（大多数 command 类），body 缺失本身就是 validate 失败，不能让 undefined body 过掉 Layer 4

实现细节见 §10.2。

### 5.8 Refs — 租户命名空间化的大对象引用

```ts
export const NacpRefSchema = z.object({
  kind: z.enum(["r2", "kv", "do-storage", "d1", "queue-dlq"]),
  binding: z.string().min(1).max(64),
  team_uuid: z.string().min(1).max(64),       // v2 新增：强制租户 namespace
  key: z.string().min(1).max(512),
  bucket: z.string().optional(),
  size_bytes: z.int().min(0).optional(),
  content_type: z.string().max(128).optional(),
  etag: z.string().max(64).optional(),
  role: z.enum(["input", "output", "attachment"]).default("attachment"),
}).refine(
  (r) => r.key.startsWith(`tenants/${r.team_uuid}/`),
  { message: "ref.key must start with tenants/{team_uuid}/", path: ["key"] }
);

export const NacpRefsSchema = z.array(NacpRefSchema).max(32);
```

**Size guard 规则**：整条 envelope JSON 编码后 ≤ **96 KB**（为 Queue 128 KB 上限留 32 KB 余量）；超过就必须把大字段移到 `refs`。

**v2 修正（GPT 2.10 bug）**：size guard 在两处都做：
1. **Encode 阶段**：producer 调 `encodeEnvelope(env)` 时
2. **Transport ingress 阶段**：consumer 的 transport 包装层在 `decode` 前先检查 byte size

### 5.9 Extra — 安全阀扩展字段

```ts
export const NacpExtraSchema = z.record(z.string(), z.unknown()).optional();
```

- **规则**：不鼓励常规使用；反复出现的 key 应被正式化；接收方对未知 key 不报错。

### 5.10 状态机约束

**GPT 2.9 修正**：协议必须不只定义 shape，还要定义**哪些消息在哪个 session phase 合法 / 哪些消息必须成对 / 谁能发什么**。v2 补上这一章。

#### 5.10.1 Session phase 状态机

```
      unattached
          │
          │ session.start (client → DO)
          ▼
       attached ◀────────────┐
          │                  │ session.stream.attach
          │                  │
          │ turn.begin       │ (reconnect with replay_from)
          ▼                  │
    turn-running ────────────┘
          │
          │ turn.end or error
          ▼
      attached
          │
          │ session.end (any → any)
          ▼
       ended
```

**非法转移举例**（违反 = `NACP_STATE_MACHINE_VIOLATION`）：
- `tool.call.request` 只能在 `turn-running` 阶段发出
- `session.cancel` 只能在 `turn-running` 阶段发出
- `session.resume` 只能在 `unattached` 阶段发出
- `session.start` 只能在 `unattached` 阶段发出
- 进入 `ended` 状态后任何消息都被拒绝

#### 5.10.2 Request / response 配对规则

| Command 消息 | 必须回复的 Response 消息 | Reply-to 字段 |
|--------------|-------------------------|---------------|
| `tool.call.request` | `tool.call.response` | `reply_to = request.message_uuid` |
| `skill.invoke.request` | `skill.invoke.response` | 同上 |
| `context.compact.request` | `context.compact.response`（v2 新增，GPT 2.10 bug）| 同上 |
| `hook.emit` | `hook.outcome` | 同上 |

**规则**：
- response 消息的 `control.reply_to` 必须指向一个**仍在 open** 的 request；已关闭的 request 被再次回复 → `NACP_REPLY_TO_CLOSED`
- 同一个 request 最多一个 `response`；重复回复 → 第一条生效，后续丢弃并写审计

#### 5.10.3 Role-gated message types

**每个 `message_type` 声明允许的 `producer_role` 集合**（协议层 enforce）：

| message_type | 允许的 producer_role |
|--------------|---------------------|
| `tool.call.request` | `session` |
| `tool.call.response` | `capability`, `skill` |
| `skill.invoke.request` | `session` |
| `skill.invoke.response` | `skill` |
| `hook.emit` | `session`, `hook` |
| `hook.outcome` | `hook` |
| `context.compact.request` | `session`, `platform` |
| `context.compact.response` | `capability` |
| `system.error` | 任意（最兜底） |
| `audit.record` | 任意 |

违反 = `NACP_PRODUCER_ROLE_MISMATCH`。

---

## 6. 消息注册表 — Core × Session × Per-Role

v2 按 GPT §5.3 建议重构为**分 profile + 分 role** 两层注册表。

### 6.1 Core Messages（9 个）

> 只包括所有内部模块**可能**需要消费的消息类型。

#### 领域 1: Tool call（3 个）

| message_type | 方向 | body 关键字段 | delivery_kind |
|--------------|------|---------------|---------------|
| `tool.call.request` | session → capability | `{tool_name, tool_input}` | `command` |
| `tool.call.response` | capability → session | `{status, output?, error?}` | `response` |
| `tool.call.cancel` | session → capability | `{reply_to}` | `command` |

> **注意**：`tool.call.progress` 不在 Core——它是 Session profile 的事件（见 §6.2）。

#### 领域 2: Hook（2 个）

| message_type | 方向 | body 关键字段 | delivery_kind |
|--------------|------|---------------|---------------|
| `hook.emit` | session → hook runtime | `{event_name, event_payload}` | `command` |
| `hook.outcome` | hook runtime → session | `{outcome}` | `response` |

> `hook.broadcast` **移出 Core**（GPT 2.7）—— 它是 client push，属于 Session profile。

#### 领域 3: Skill（2 个）

| message_type | 方向 | body | delivery_kind |
|--------------|------|------|---------------|
| `skill.invoke.request` | session → skill | `{skill_name, arguments}` | `command` |
| `skill.invoke.response` | skill → session | `{status, result?, error?}` | `response` |

#### 领域 4: Context（2 个，v2 补 response）

| message_type | 方向 | body | delivery_kind |
|--------------|------|------|---------------|
| `context.compact.request` | session → compactor | `{history_ref, target_token_budget}` | `command` |
| `context.compact.response` | compactor → session | `{status, summary_ref?, error?}` | `response` |

#### 领域 5: System & Audit（2 个）

| message_type | 方向 | body | delivery_kind |
|--------------|------|------|---------------|
| `system.error` | 任意 → audit | `{error, context?}` | `event` |
| `audit.record` | 任意 → audit worker | `{event_kind, ref?}` | `event` |

### 6.2 Session Profile Messages（7 个）

> 只在 client ↔ session DO 之间使用。**不是 Core**；Core consumer 不需要识别这些。

| message_type | 方向 | delivery_kind | 说明 |
|--------------|------|---------------|------|
| `session.start` | client → DO | `command` | client 建立新 session |
| `session.resume` | client → DO | `command` | client 断线重连；body 里带 `last_seen_seq` |
| `session.cancel` | client → DO | `command` | 中断当前 turn |
| `session.end` | DO → client | `event` | 会话正常结束 |
| `session.stream.event` | DO → client | `event` | **所有 server-push 事件的统一通道** |
| `session.stream.ack` | client → DO | `event` | 客户端确认收到（用于 ack 型 delivery_mode） |
| `session.heartbeat` | 双向 | `event` | 保活 |

**`session.stream.event` 的 body 子类**（GPT 2.3 + 2.7 修正，所有 client push 收敛到一个 message type 内，用 `kind` 区分子类）：
```ts
const SessionStreamEventBody = z.discriminatedUnion("kind", [
  // tool call 的 progress（原 Core 的 tool.call.progress 搬到这里）
  z.object({
    kind: z.literal("tool.call.progress"),
    stream_id: z.string(),
    chunk: z.string(),
    is_final: z.boolean(),
  }),
  // hook broadcast（原 Core 的 hook.broadcast 搬到这里）
  z.object({
    kind: z.literal("hook.broadcast"),
    event_name: z.string(),
    payload_redacted: z.unknown(),
    aggregated_outcome: z.unknown(),
  }),
  // session 运行态更新
  z.object({
    kind: z.literal("session.update"),
    phase: z.string(),
    partial_output: z.string().optional(),
  }),
  // turn 生命周期
  z.object({
    kind: z.literal("turn.begin"),
    turn_uuid: z.uuid(),
  }),
  z.object({
    kind: z.literal("turn.end"),
    turn_uuid: z.uuid(),
    usage: z.unknown(),
  }),
]);
```

**注意**：所有 `session.stream.event` 的 **trace 字段必须带 `stream_id` + `stream_seq`**，这是 §5.5 说的锚点。

### 6.3 Per-Role Required Sets

GPT §2.5 修正：**不再有全局 required**；改为"每个 role 必须覆盖的消息子集"。

```ts
export const NACP_ROLE_REQUIREMENTS = {
  session: {
    // session DO 必须能发的
    producer: ["tool.call.request", "tool.call.cancel", "skill.invoke.request",
               "hook.emit", "context.compact.request", "session.stream.event",
               "audit.record", "system.error"],
    // session DO 必须能收的
    consumer: ["tool.call.response", "skill.invoke.response",
               "hook.outcome", "context.compact.response",
               "session.start", "session.resume", "session.cancel", "session.stream.ack"],
  },
  capability: {
    producer: ["tool.call.response", "context.compact.response", "system.error"],
    consumer: ["tool.call.request", "tool.call.cancel", "context.compact.request"],
  },
  skill: {
    producer: ["skill.invoke.response", "system.error"],
    consumer: ["skill.invoke.request"],
  },
  hook: {
    producer: ["hook.outcome", "system.error"],
    consumer: ["hook.emit"],
  },
  client: {
    producer: ["session.start", "session.resume", "session.cancel", "session.stream.ack"],
    consumer: ["session.end", "session.stream.event"],
  },
  ingress: {
    producer: [],  // ingress 只做 authority 戳印，不自己发业务消息
    consumer: [],
  },
  platform: {
    producer: ["context.compact.request", "audit.record"],  // 平台运维
    consumer: ["system.error", "audit.record"],
  },
} as const;
```

**启动时检查**：每个 worker 在初始化时 assert 自己的 handler 集合覆盖了 `NACP_ROLE_REQUIREMENTS[role].consumer`，并且所有 send 路径都限定在 `producer` 集合内。**这替代了 v1 的全局 REQUIRED 集合**。

---

## 7. Transport Profiles

> **NACP Core envelope 与 transport 完全解耦**。每个 transport profile **只规定**如何把 envelope 放进具体 wire + 该 wire 上的额外规则（签名、size、重试、ack）。

### 7.1 Service Binding (Core)

**场景**：session DO 调用 skill/capability worker。

**规则**：
- **路径 A (RPC-based, 推荐)**：`await env.SKILL_BROWSER.handleNacp(envelope)`——`handleNacp` 是 WorkerEntrypoint 上的 method，接收已 parsed 的 `NacpEnvelope` 对象。
- **路径 B (fetch-based)**：`env.SKILL_BROWSER.fetch(new Request("https://internal/nacp", { method: "POST", headers: { "content-type": "application/nacp+json; version=1.0" }, body: encodeEnvelope(env) }))`——作为过渡期 fallback。
- **Response**：target worker 返回一个新 `NacpEnvelope`（`delivery_kind: "response"`，`control.reply_to = request.message_uuid`）。
- **多租户**：target worker 在 handler 入口必跑 `verifyTenantBoundary(env)`；tenant-pinned worker 拒绝不匹配的 team。

### 7.2 Cloudflare Queues (Core)

**场景**：长任务异步分发、DLQ、跨时间协作。

**规则**：
- **Producer**：`await env.QUEUE_AGENT.send(encodeEnvelope(env))`
- **Consumer**：`async queue(batch, env)` 里逐条 `decodeEnvelope(msg.body)` + `verifyTenantBoundary(env)`；parse 失败或 tenant 不匹配 → 进 DLQ，不 retry
- **DLQ key**：`tenants/{team_uuid}/dlq/{message_uuid}`
- **Message 大小**：CF Queues 单条 128 KB 上限；NACP 96 KB 软限留 32 KB 余量
- **Retry**：依靠 `control.retry_context.attempt` 自增 + `calculateBackoffDelay`

### 7.3 Durable Object RPC (Core)

**场景**：session DO 调其他 DO（例如共享 context DO、audit DO、cron DO）。

**规则**：
- **DO id 约定**：`env.XX_DO.idFromName(\`team:\${team_uuid}:...\`)`——id 里必须包含 team_uuid，天然隔离
- **调用**：`await stub.handleNacp(envelope)`（同 §7.1 路径 A）
- **多租户**：目标 DO 的 id 与消息的 `authority.team_uuid` 必须一致，否则立即抛 `NACP_TENANT_MISMATCH`

### 7.4 WebSocket (Session Profile)

**场景**：远端 client (CLI / 浏览器 / IDE plugin) ↔ session DO 的实时双向通讯。

**规则**：
- **Subprotocol**：`Sec-WebSocket-Protocol: nacp-session.v1`（注意：与 Core 区分）
- **Frame 结构**：Session frame **不等于** Core envelope；Session frame 在 Core envelope 基础上额外有：
  ```ts
  const NacpSessionFrameSchema = NacpEnvelopeBaseSchema.extend({
    session_frame: z.object({
      stream_id: z.string().min(1).max(128),
      stream_seq: z.int().min(0),
      last_seen_seq: z.int().min(0).optional(),    // 仅 client → server
      replay_from: z.int().min(0).optional(),      // 仅 client → server
      delivery_mode: z.enum(["at-most-once", "at-least-once"]).default("at-most-once"),
      ack_required: z.boolean().default(false),
    }),
  });
  ```
- **Client → server 省略 authority**：client frame 里 `authority` 字段允许**缺失**；ingress（session DO 的 WebSocket handler）收到 frame 后注入 `authority` 并调 `validateEnvelope()`。
- **Replay / Resume 规则**：
  - DO 为每个 `stream_id` 维护一个环形 buffer（默认 last 200 events）
  - client 断线重连时发 `session.resume` + `session_frame.replay_from = last_seen_seq + 1`
  - DO 从 buffer 里取该 seq 之后的所有 event 重新推送
  - 如果 replay_from 落在 buffer 之外 → 返回 error `NACP_REPLAY_OUT_OF_RANGE`，client 需要重新 `session.start` 并丢弃旧状态
- **Hibernation 兼容**：DO 休眠时 WebSocket 保持，stream buffer 在 DO storage 里；唤醒时从 storage 恢复
- **多租户**：一条 WebSocket 连接只服务一个 team；切 team 必须断开重连
- **ACP bridge（v1 不做完整兼容）**：命名相近，但明确**不声称 ACP 兼容**；bridge 留给 v2 写一个独立的 `src/nacp/transport/acp-bridge.ts`

### 7.5 HTTP Callback Profile

**场景**：外部 webhook 打回 nano-agent / nano-agent 调用未部署为 service binding 的外部 HTTP 服务。

**规则**：
- **Headers**：
  - `Content-Type: application/nacp+json; version=1.0`
  - `X-NACP-SIGNATURE: hmac-sha256=<hex>`
  - `X-NACP-TIMESTAMP: <unix_ms>`
  - `X-NACP-TEAM-HINT: <team_uuid>` (可选，帮 receiver 快速路由)
- **HMAC 计算**：`hmac_sha256(secret, timestamp + "." + body)`
- **Secret 分区**：按 team 分区存储，`secrets/tenants/{team_uuid}/callback`
- **时间戳容差**：5 分钟
- **Receive 顺序**：**验签 → size guard → JSON parse → `validateEnvelope` → `verifyTenantBoundary` → admissibility check → handler**
- **参考**：SAFE `safe_transport.py:14-35`

### 7.6 Tool Progress 物理回传路径

**GPT 2.3 的核心断点**：service-binding RPC 是 request/response，tool worker 如何持续把 progress 推回 session DO？

**v2 解答：三选一明确指定，v1 选 Option C + Option A fallback。**

#### Option A: 反向 RPC call（tool worker → session DO）

- tool worker 收到 `tool.call.request` 时，从 envelope 里拿到 `trace.session_uuid`
- 中途 progress 时，tool worker 主动调 `env.SESSION_DO.get(idFromName("team:...:session:" + session_uuid)).handleSessionStreamEvent(progressEnvelope)`
- 这条 progress 消息本身是一个 `session.stream.event`（kind="tool.call.progress"），由 session DO 再转发给 WebSocket client
- **优点**：结构最干净
- **缺点**：tool worker 需要 `SESSION_DO` binding；tool worker 必须知道 session DO 的 lookup 规则；耦合较强

#### Option B: 共享流经 DO storage

- tool worker 把 progress 写入一个共享的 stream DO（`env.TOOL_STREAM_DO.idFromName(trace.stream_id)`）
- session DO 订阅该 stream DO 的 alarm/WebSocket 反向推送
- **缺点**：每次 progress 都多经一个 DO，延迟翻倍

#### Option C: RPC 返回 ReadableStream（推荐，v1 默认）

- WorkerEntrypoint RPC 天然支持返回 **`ReadableStream`** 对象
- tool worker 的 `handleNacp` 方法不直接返回 envelope，而是返回一个结构：
  ```ts
  {
    // 立即可用的"响应"envelope
    response: NacpEnvelope<ToolCallResponseBody>,
    // 可选的 progress 流
    progress?: ReadableStream<NacpEnvelope<SessionStreamEventBody>>,
  }
  ```
- session DO 收到返回值后立即 await `progress.getReader()`，边读边把每个 chunk 转发到 WebSocket client 的 `session.stream.event`
- 当 `is_final: true` 到达时，stream 结束，session DO 关闭 reader
- **优点**：零额外 binding；与 WorkerEntrypoint 的 stream 支持天然契合；progress 的因果链（`parent_message_uuid`）明确
- **缺点**：必须 tool worker 主动推；如果 worker 在 CPU 时间到上限前没推完，progress 会丢

**v1 的规则**：
1. **默认用 Option C**（ReadableStream-based）
2. **fallback 用 Option A**（reverse RPC），仅当 tool worker 是"长程 / 跨 alarm"类型（必须用 DO 才能存活）
3. **禁止 Option B**（共享 stream DO 的开销不划算）

**无论哪种 option，progress 消息都是 `session.stream.event`（Session profile），不是 Core 消息**——这就是为什么 `tool.call.progress` 从 Core 挪到了 Session profile 的 `SessionStreamEventBody` discriminated union 里。Core 路径和 Session push 路径从此物理分离。

---

## 8. 错误、重试、幂等、配额

### 8.1 NacpError 结构

```ts
export const NacpErrorCategorySchema = z.enum([
  "validation", "transient", "dependency", "permanent", "security", "quota", "conflict",
]);

export const NacpErrorSchema = z.object({
  code: z.string().min(1).max(64),
  category: NacpErrorCategorySchema,
  message: z.string().min(1).max(512),
  detail: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean(),
});
```

**可重试类别**：`transient / dependency / quota`（照抄 SMCP `retry.ts`）。

### 8.2 NACP_ERROR_REGISTRY（含 v2 新增的 4 个租户相关 code）

```ts
export const NACP_ERROR_REGISTRY: Record<string, NacpErrorDefinition> = {
  // ── 原 v1 ──
  NACP_VALIDATION_FAILED:    { category: "validation", retryable: false, message: "envelope schema validation failed" },
  NACP_UNKNOWN_MESSAGE_TYPE: { category: "validation", retryable: false, message: "message_type not in registry" },
  NACP_SIZE_EXCEEDED:        { category: "validation", retryable: false, message: "envelope exceeds 96KB, use refs" },
  NACP_VERSION_INCOMPATIBLE: { category: "validation", retryable: false, message: "schema_version below compat floor" },
  NACP_DEADLINE_EXCEEDED:    { category: "transient", retryable: false, message: "message past deadline_ms" },
  NACP_IDEMPOTENCY_CONFLICT: { category: "conflict", retryable: false, message: "idempotency_key already observed" },
  NACP_CAPABILITY_DENIED:    { category: "security", retryable: false, message: "capability_scope not granted" },
  NACP_RATE_LIMITED:         { category: "quota", retryable: true, message: "quota or rate limit reached" },
  NACP_BINDING_UNAVAILABLE:  { category: "transient", retryable: true, message: "target service binding unavailable" },
  NACP_HMAC_INVALID:         { category: "security", retryable: false, message: "HMAC signature invalid" },
  NACP_TIMESTAMP_SKEW:       { category: "security", retryable: false, message: "timestamp skew exceeds 5 minutes" },

  // ── v2 新增：多租户相关 ──
  NACP_TENANT_MISMATCH:          { category: "security", retryable: false, message: "authority.team_uuid does not match consumer's serving team" },
  NACP_TENANT_BOUNDARY_VIOLATION:{ category: "security", retryable: false, message: "refs[*].team_uuid or key does not match authority.team_uuid" },
  NACP_TENANT_QUOTA_EXCEEDED:    { category: "quota", retryable: true, message: "tenant quota budget exhausted" },
  NACP_DELEGATION_INVALID:       { category: "security", retryable: false, message: "tenant_delegation signature/expiry invalid" },

  // ── v2 新增：状态机相关（GPT 2.9） ──
  NACP_STATE_MACHINE_VIOLATION:  { category: "permanent", retryable: false, message: "message not allowed in current session phase" },
  NACP_REPLY_TO_CLOSED:          { category: "permanent", retryable: false, message: "reply_to points to closed request" },
  NACP_PRODUCER_ROLE_MISMATCH:   { category: "security", retryable: false, message: "producer_role not allowed for this message_type" },
  NACP_REPLAY_OUT_OF_RANGE:      { category: "permanent", retryable: false, message: "replay_from seq out of buffer range" },
};
```

### 8.3 幂等键

- **必须带 `idempotency_key`**：`tool.call.request` / `skill.invoke.request` / `context.compact.request` / `audit.record`（audit 特别重要，避免重复审计污染）
- **Consumer 责任**：在 DO storage 的 `tenants/{team_uuid}/idempotency/{key}` 维护"见过的 key → 结果 ref"；再次见到同 key 直接返回旧结果
- **TTL**：默认 24 小时

### 8.4 Deadline Admissibility（GPT 2.10 修正）

**v1 把 deadline 检查放进 `validateEnvelope` 里是 bug**——deadline 是 runtime delivery policy，不是 schema validity。v2 分层：

```ts
// 步骤 1: schema validate（纯结构）
const env = validateEnvelope(raw);

// 步骤 2: tenant boundary check（租户边界）
verifyTenantBoundary(env, ctx);

// 步骤 3: admissibility check（运行时投递策略）
checkAdmissibility(env);  // 这里面才检查 deadline / capability_scope / quota_hint / state machine

// 步骤 4: handler
await handle(env);
```

`checkAdmissibility(env)` 独立函数：
```ts
function checkAdmissibility(env: NacpEnvelope): void {
  // Deadline
  if (env.control?.deadline_ms !== undefined && Date.now() > env.control.deadline_ms) {
    throw new NacpAdmissibilityError("NACP_DEADLINE_EXCEEDED");
  }
  // Capability scope（由 permission engine 消费）
  // State machine phase（由 session DO 消费）
  // Quota hint（由 capability worker 消费）
}
```

### 8.5 重试决策（沿用 SMCP）

```ts
import { decideRetry, calculateBackoffDelay } from "./retry.js";

function onNacpError(env: NacpEnvelope, error: NacpError): "retry" | "dlq" | "abort" {
  const policy = { max_attempts: 3, base_delay_ms: 200, max_delay_ms: 10000, jitter_ratio: 0.2 };
  const attempt = env.control?.retry_context?.attempt ?? 0;
  const decision = decideRetry(attempt, policy, error.retryable);
  if (!decision.should_retry) return error.category === "validation" ? "abort" : "dlq";
  return "retry";
}
```

---

## 9. 版本化与兼容

### 9.1 版本号

- `NACP_VERSION = "1.0.0"`
- `NACP_VERSION_COMPAT = "1.0.0"` — v1.x.x 范围内所有 patch/minor 版本互相兼容

### 9.2 兼容性承诺表

| 变更类型 | 兼容性 |
|---------|-------|
| 加新 message_type | 向后兼容 |
| 现有 body 加**可选**字段 | 向后兼容 |
| 现有 body 加**必选**字段 | **破坏性**（升 minor/major + migration） |
| 删除/重命名 body 字段 | **破坏性** |
| enum 加新值 | 向后兼容（旧 consumer 当 unknown 处理） |
| enum 删除已有值 | **破坏性**（升 major） |

### 9.3 Migration helper 模板

参考 `context/smcp/src/compat/migrations.ts:19-42`——每个 minor/major 版本对应一个 `migrate_v1_0_to_v1_1(raw)`。

---

## 10. 实现细节与骨架代码

### 10.1 包结构

```
src/nacp/
├── envelope.ts              ← Core envelope + validate + encode/decode
├── admissibility.ts         ← v2 新增：deadline / state / quota 检查
├── tenancy/                 ← v2 新增：多租户专属
│   ├── boundary.ts          ← verifyTenantBoundary
│   ├── scoped-io.ts         ← tenant-scoped R2/KV wrapper
│   └── delegation.ts        ← delegation signature verify
├── types.ts
├── version.ts
├── errors.ts
├── error-registry.ts
├── retry.ts
├── state-machine.ts         ← v2 新增
├── messages/
│   ├── tool.ts
│   ├── hook.ts
│   ├── skill.ts
│   ├── context.ts
│   └── system.ts
├── session/                 ← v2 新增：Session profile 独立目录
│   ├── frame.ts             ← NacpSessionFrameSchema (Core extend)
│   ├── stream-registry.ts
│   ├── replay-buffer.ts
│   └── messages.ts          ← session.* + session.stream.*
├── transport/
│   ├── types.ts
│   ├── service-binding.ts
│   ├── queue.ts
│   ├── do-rpc.ts
│   ├── websocket.ts         ← 实现 Session profile
│   └── http-callback.ts
├── compat/
│   └── migrations.ts
└── index.ts
```

### 10.2 核心骨架 — `envelope.ts`（v2 修正版）

```ts
// src/nacp/envelope.ts

import { z } from "zod";
import { NACP_VERSION, NACP_VERSION_COMPAT } from "./version.js";
import { ToolBodySchemas, ToolBodyRequired } from "./messages/tool.js";
import { HookBodySchemas, HookBodyRequired } from "./messages/hook.js";
// ... 其他 domain

// ── body schema 与 required 表 ──
const BODY_SCHEMAS: Record<string, z.ZodTypeAny> = {
  ...ToolBodySchemas, ...HookBodySchemas, ...SkillBodySchemas,
  ...ContextBodySchemas, ...SystemBodySchemas,
};

// v2 bug 修正：per-type body required 表，明确哪些 type 的 body 必填
const BODY_REQUIRED: Set<string> = new Set([
  ...ToolBodyRequired, ...HookBodyRequired, ...SkillBodyRequired,
  ...ContextBodyRequired,
]);

// role gating（§5.10.3）
const ROLE_GATE: Record<string, Set<NacpProducerRole>> = {
  "tool.call.request":       new Set(["session"]),
  "tool.call.response":      new Set(["capability", "skill"]),
  "tool.call.cancel":        new Set(["session"]),
  "skill.invoke.request":    new Set(["session"]),
  "skill.invoke.response":   new Set(["skill"]),
  "hook.emit":               new Set(["session", "hook"]),
  "hook.outcome":            new Set(["hook"]),
  "context.compact.request": new Set(["session", "platform"]),
  "context.compact.response":new Set(["capability"]),
  // system.error / audit.record 允许任意 role，不进表
};

// ── envelope 外层 schema ──
const NacpEnvelopeBaseSchema = z.object({
  header: NacpHeaderSchema,
  authority: NacpAuthoritySchema,
  trace: NacpTraceSchema,
  control: NacpControlSchema,
  body: z.unknown().optional(),
  refs: z.array(NacpRefSchema).max(32).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const MAX_ENVELOPE_SIZE = 96 * 1024;

// ── NacpValidationError ──
export class NacpValidationError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly code: string = "NACP_VALIDATION_FAILED"
  ) {
    super(`NACP envelope validation failed [${NACP_VERSION}]: ${errors.join("; ")}`);
    this.name = "NacpValidationError";
  }
}

// ── validateEnvelope：五层校验（v2 修正 deadline 分离） ──
export function validateEnvelope(raw: unknown): NacpEnvelope {
  const errs: string[] = [];

  // Layer 1: shape
  const parsed = NacpEnvelopeBaseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NacpValidationError(parsed.error.issues.map(i => i.message));
  }
  const env = parsed.data;

  // Layer 1b: 显式检查 authority.team_uuid（多租户硬规则）
  if (!env.authority.team_uuid) {
    throw new NacpValidationError(
      ["authority.team_uuid is required (no anonymous messages)"]
    );
  }

  // Layer 2: message_type 注册表
  if (!NACP_MESSAGE_TYPES_ALL.has(env.header.message_type)) {
    throw new NacpValidationError(
      [`message_type '${env.header.message_type}' not in registry`],
      "NACP_UNKNOWN_MESSAGE_TYPE"
    );
  }

  // Layer 3: 版本兼容
  if (cmpSemver(env.header.schema_version, NACP_VERSION_COMPAT) < 0) {
    throw new NacpValidationError(
      [`schema_version '${env.header.schema_version}' below compat floor '${NACP_VERSION_COMPAT}'`],
      "NACP_VERSION_INCOMPATIBLE"
    );
  }

  // Layer 4: per-type body schema（v2 bug 修正）
  const bodySchema = BODY_SCHEMAS[env.header.message_type];
  const bodyRequired = BODY_REQUIRED.has(env.header.message_type);

  if (bodyRequired && env.body === undefined) {
    throw new NacpValidationError(
      [`body is required for message_type '${env.header.message_type}'`]
    );
  }
  if (bodySchema && env.body !== undefined) {
    const bodyParsed = bodySchema.safeParse(env.body);
    if (!bodyParsed.success) {
      throw new NacpValidationError(
        bodyParsed.error.issues.map(i => `body.${i.path.join(".")}: ${i.message}`)
      );
    }
  }

  // Layer 5: role gating（§5.10.3）
  const allowedRoles = ROLE_GATE[env.header.message_type];
  if (allowedRoles && !allowedRoles.has(env.header.producer_role)) {
    throw new NacpValidationError(
      [`producer_role '${env.header.producer_role}' not allowed for '${env.header.message_type}'`],
      "NACP_PRODUCER_ROLE_MISMATCH"
    );
  }

  // Note: deadline / tenant boundary / state machine 不在 validate 里
  return env as NacpEnvelope;
}

// ── encodeEnvelope / decodeEnvelope ──
export function encodeEnvelope(env: NacpEnvelope): string {
  const validated = validateEnvelope(env);
  const json = JSON.stringify(validated);
  const byteSize = new TextEncoder().encode(json).byteLength;
  if (byteSize > MAX_ENVELOPE_SIZE) {
    throw new NacpValidationError(
      [`envelope ${byteSize}B exceeds ${MAX_ENVELOPE_SIZE}B, move large data to refs[]`],
      "NACP_SIZE_EXCEEDED"
    );
  }
  return json;
}

export function decodeEnvelope(raw: string): NacpEnvelope {
  // Transport ingress size guard（v2 第二重保险）
  if (raw.length > MAX_ENVELOPE_SIZE * 2) {  // char 估算上限
    throw new NacpValidationError([`raw message too large`], "NACP_SIZE_EXCEEDED");
  }
  const parsed = JSON.parse(raw);
  return validateEnvelope(parsed);
}
```

### 10.3 `tenancy/boundary.ts`

```ts
// src/nacp/tenancy/boundary.ts

import type { NacpEnvelope } from "../envelope.js";
import { NacpValidationError } from "../envelope.js";

export interface TenantBoundaryContext {
  // 当前 consumer 在 env 里声明自己服务的 team（运行时注入）
  serving_team_uuid: string | "any" | "_platform";
  // 当前 DO 的 team 上下文（如果 consumer 是 DO）
  do_team_uuid?: string;
  // 是否允许带 delegation 的消息
  accept_delegation: boolean;
}

export function verifyTenantBoundary(
  env: NacpEnvelope,
  ctx: TenantBoundaryContext
): void {
  const teamInEnv = env.authority.team_uuid;

  // 规则 1: consumer serving 非 "any" 时必须对得上
  if (ctx.serving_team_uuid !== "any" && teamInEnv !== ctx.serving_team_uuid) {
    // delegation 豁免
    if (env.control?.tenant_delegation && ctx.accept_delegation) {
      // 验证 delegation 有效（在 delegation.ts 里）
      verifyDelegation(env.control.tenant_delegation, env);
    } else {
      throw new NacpValidationError(
        [`serving team '${ctx.serving_team_uuid}' does not match envelope team '${teamInEnv}'`],
        "NACP_TENANT_MISMATCH"
      );
    }
  }

  // 规则 2: refs 的 team_uuid 必须与 authority 一致
  if (env.refs) {
    for (const ref of env.refs) {
      if (ref.team_uuid !== teamInEnv && teamInEnv !== "_platform") {
        throw new NacpValidationError(
          [`ref.team_uuid '${ref.team_uuid}' != authority.team_uuid '${teamInEnv}'`],
          "NACP_TENANT_BOUNDARY_VIOLATION"
        );
      }
      if (!ref.key.startsWith(`tenants/${ref.team_uuid}/`)) {
        throw new NacpValidationError(
          [`ref.key does not start with 'tenants/${ref.team_uuid}/'`],
          "NACP_TENANT_BOUNDARY_VIOLATION"
        );
      }
    }
  }

  // 规则 3: DO 场景下，DO 的 team 必须与 envelope 对齐
  if (ctx.do_team_uuid && ctx.do_team_uuid !== teamInEnv) {
    throw new NacpValidationError(
      [`DO team '${ctx.do_team_uuid}' != envelope team '${teamInEnv}'`],
      "NACP_TENANT_MISMATCH"
    );
  }

  // 规则 4: _platform 只能由 platform role 使用
  if (teamInEnv === "_platform" && env.header.producer_role !== "platform") {
    throw new NacpValidationError(
      [`team_uuid '_platform' only allowed with producer_role 'platform'`],
      "NACP_TENANT_BOUNDARY_VIOLATION"
    );
  }
}
```

### 10.4 `tenancy/scoped-io.ts`

```ts
// src/nacp/tenancy/scoped-io.ts
// 所有 R2/KV/DO storage 读写必须走这里，禁止直接用 env.R2.put

export async function tenantR2Put(
  env: Env,
  teamUuid: string,
  relativePath: string,
  body: ArrayBuffer | string
): Promise<void> {
  if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
  const key = `tenants/${teamUuid}/${relativePath}`;
  await env.R2_WORKSPACE.put(key, body);
}

export async function tenantR2Get(
  env: Env,
  teamUuid: string,
  relativePath: string
): Promise<R2ObjectBody | null> {
  if (relativePath.startsWith("/")) relativePath = relativePath.slice(1);
  const key = `tenants/${teamUuid}/${relativePath}`;
  return await env.R2_WORKSPACE.get(key);
}

// KV / D1 / DO storage 同理，全部强制 tenant prefix
```

**强制规范**：在 CI 的 biome/eslint 规则里添加 `no-restricted-properties` 禁止直接使用 `env.R2_*.put/get/list`，必须走 `tenantR2*` 包装层。**这是"多租户一等公民"在代码层面的 enforcement**。

### 10.5 Transport 接口

```ts
// src/nacp/transport/types.ts

export interface NacpTransport {
  readonly kind: "service-binding" | "queue" | "websocket" | "do-rpc" | "http-callback";
  send(env: NacpEnvelope, opts?: SendOptions): Promise<NacpEnvelope | void>;
  receive(handler: NacpHandler): void;
}

export type NacpHandler = (
  env: NacpEnvelope,
  ctx: { boundary: TenantBoundaryContext }
) => Promise<NacpEnvelope | void>;
```

**规范**：每个 transport 实现在 handler 前必须调用：
```ts
validateEnvelope(env);
verifyTenantBoundary(env, ctx.boundary);
checkAdmissibility(env);
// 然后才是 handler
```

**transport 不自己 JSON.parse / JSON.stringify**——永远调 `decodeEnvelope / encodeEnvelope`。

### 10.6 按 `message_type` 推断 body 类型（与 v1 相同）

```ts
// src/nacp/types.ts

export type NacpMessageTypeMap = 
  & { [K in keyof typeof ToolBodySchemas]: z.infer<typeof ToolBodySchemas[K]> }
  & { [K in keyof typeof HookBodySchemas]: z.infer<typeof HookBodySchemas[K]> }
  // ... 其他 domain
  ;

export function buildEnvelope<K extends keyof NacpMessageTypeMap>(
  message_type: K,
  body: NacpMessageTypeMap[K],
  context: {
    header: Omit<NacpHeader, "message_type">;
    authority: NacpAuthority;
    trace: NacpTrace;
    control?: NacpControl;
    refs?: NacpRef[];
  }
): NacpEnvelope<NacpMessageTypeMap[K]> {
  return {
    header: { ...context.header, message_type, delivery_kind: inferDeliveryKind(message_type) },
    authority: context.authority,
    trace: context.trace,
    control: context.control,
    body,
    refs: context.refs,
  };
}
```

---

## 11. 实施路线图

> v2 按协议家族分层重新编排阶段。

### 阶段 1：`@nano-agent/nacp-core` 包骨架（~4 天）

- `envelope.ts` + `types.ts` + `version.ts` + `errors.ts` + `error-registry.ts`
- 5 个 domain 的 `messages/*.ts`
- `retry.ts`（沿用 SMCP）
- **`tenancy/` 三件套**（boundary / scoped-io / delegation）
- `admissibility.ts` + `state-machine.ts`
- 单元测试：每个 message_type 的 happy path + 每层 validate 的失败 path + **tenant boundary 的 8 种攻击场景**
- **里程碑**：`buildEnvelope` / `encodeEnvelope` / `decodeEnvelope` + 完整 tenancy 校验可用

### 阶段 2：Core Transport 适配（~5 天）

- `transport/service-binding.ts`（RPC-based，含 ReadableStream progress）
- `transport/do-rpc.ts`
- `transport/queue.ts`（producer + consumer + DLQ）
- 集成测试：session DO ↔ skill worker 完整往返
- **里程碑**：fake bash 的第一个 customCommand 可通过 service-binding transport 跑通

### 阶段 3：Session Profile（~5 天）

- `session/frame.ts` + `session/stream-registry.ts` + `session/replay-buffer.ts`
- `transport/websocket.ts`（含 ingress authority 戳印 + replay/resume 逻辑）
- `session/messages.ts`（7 个 Session 消息）
- 集成测试：client 断线重连 → DO 从 buffer 重放 → client 补齐事件
- **里程碑**：从 WebSocket client 发一次 `session.start` → 拿到 `tool.call.progress` 流 → 断线 → 重连 → 补齐

### 阶段 4：Hook + Audit 集成（~3 天）

- 让 `hooks-by-opus.md` §7 的 `HookDispatcher.emit()` 产 `hook.emit` 消息（Core）
- `hook.broadcast` 走 Session profile（`session.stream.event` with kind `hook.broadcast`）
- Audit worker 订阅所有 Core 消息写到 R2（tenant-partitioned）
- **里程碑**：任何 tool 调用都在 audit 里留下按 team_uuid 分区的记录

### 阶段 5：HTTP Callback Profile（~2 天）

- `transport/http-callback.ts`（HMAC 验签 + timestamp skew + per-tenant secret）
- 单元测试：签名伪造 / 过期 / tenant 错配 / size 超限 4 种 case
- **里程碑**：外部 webhook 可以安全打回 nano-agent

### 阶段 6：Schema export + 文档（~2 天）

- `scripts/export-schema.ts` 导出 `dist/nacp-core.schema.json` + `dist/nacp-session.schema.json`
- `scripts/gen-registry-doc.ts` 生成消息注册表 Markdown
- **里程碑**：非 TS 客户端可以拿 schema 自己生成绑定

### 阶段 7：版本兼容占位（~1 天）

- `compat/migrations.ts` 写 `migrate_noop` 占位
- 单元测试预演未来 v1.1.0 升级路径

**总估**：约 **22 天工程时间**（4 周），比 v1 的"2 周"多一倍——因为 v2 加入了 tenancy 专用模块、Session profile 的 replay/resume、Tool progress 的 ReadableStream 机制、以及更严格的测试矩阵。

---

## 12. 最终 Value Verdict

### 12.1 NACP v1（v2 修订版）的画像

NACP v1 是一个**协议家族**而不是单协议：

- **NACP-Core**：7 字段扁平信封，9 个 Core 消息类型，覆盖 tool/hook/skill/context/system 五个领域
- **NACP-Session**：Session frame 扩展 Core envelope，额外有 `stream_id / stream_seq / replay_from / last_seen_seq / delivery_mode / ack_required`，7 个 Session 消息类型
- **NACP-Transport Profiles**：4 种 Core transport（service-binding / queue / do-rpc / http-callback）+ 1 种 Session transport（websocket）
- **多租户一等公民**：`authority.team_uuid` 永远必填；`refs` 强制 tenant namespace；跨租户默认禁止；delegation 需签名；quota_hint + audience + redaction_hint 在 `control` 里；审计按 team 分区；4 个专用 error code
- **五层 validate + 独立 admissibility + 独立 tenant boundary check** 三步分离
- **状态机约束**：session phase / request-response 配对 / role-gated message type
- **Tool progress 物理路径**：ReadableStream-based（默认）或 reverse RPC（fallback）
- **错误与重试**：7 category + 18 个 error code（含 4 个租户相关）+ 决策器
- **类型系统**：单一 zod 定义 → TS 类型 + runtime 校验 + JSON schema

**预估代码量**：核心包 ~**2500–3500 行 TypeScript**（含所有 message schema + transport + tenancy + 测试），比 v1 估算的 1500–2500 多一档因为加入了专门的 tenancy 与 session profile 模块。

### 12.2 对 GPT Review 12 条断点的逐一回应

| # | GPT 断点 | v2 是否解决 | 解决方式 |
|---|---------|-----------|----------|
| 2.1 | 协议边界扁平 | ✅ | 拆成 Core + Session + Transport Profiles |
| 2.2 | WebSocket 无 replay/resume | ✅ | Session profile 新增 `stream_id/stream_seq/replay_from/last_seen_seq/delivery_mode/ack_required` + replay buffer + `NACP_REPLAY_OUT_OF_RANGE` |
| 2.3 | `tool.call.progress` 无物理路径 | ✅ | §7.6 明确三选一，v1 默认 Option C (ReadableStream) + Option A fallback |
| 2.4 | client frame 的 authority 混淆信任边界 | ✅ | `authority` 在 Session frame 上可省；ingress 戳印；`stamped_by/stamped_at` 进审计 |
| 2.5 | 全局 required 集合不适合角色化 | ✅ | `NACP_ROLE_REQUIREMENTS` 分 7 个 role，每个 role 单独声明 producer/consumer 子集 |
| 2.6 | closed producer enum 与 service-composable 冲突 | ✅ | 拆成 `producer_role`（闭）+ `producer_id`（命名空间字符串） |
| 2.7 | `hook.broadcast` 不应是 core | ✅ | 迁移到 Session profile 的 `session.stream.event` with kind `hook.broadcast` |
| 2.8 | ACP 只是命名近似 | ✅ | 明确不声称兼容；bridge 留 v2；ACP 式命名只作灵感 |
| 2.9 | 无运行时状态机约束 | ✅ | §5.10 + 4 个新 error code (`NACP_STATE_MACHINE_VIOLATION` 等) |
| 2.10a | per-type body required 未 enforce | ✅ | `BODY_REQUIRED: Set<string>` 表 + validate Layer 4 修正 |
| 2.10b | size guard 只在 encode 做 | ✅ | 分两处：encode + transport ingress |
| 2.10c | deadline 放 validate 层 | ✅ | 分离出 `checkAdmissibility(env)` |
| 2.10d | `context.compact` 无 response | ✅ | 新增 `context.compact.response` message type |

**全部 13 项断点均在 v2 得到解决**。

### 12.3 多租户一等公民的验收标准

| 要求 | v2 回应 | 位置 |
|------|--------|------|
| team_uuid 是协议一等字段 | `authority.team_uuid` 必填 | §5.3 + §5.4.1 |
| 禁止匿名消息 | Layer 1b 显式检查 | §10.2 |
| 资源引用强制 tenant namespace | `refs[*].team_uuid` + `key` regex refine | §5.8 |
| 跨租户默认拒绝 | `verifyTenantBoundary` 硬规则 | §10.3 |
| 跨租户 delegation 需签名 | `control.tenant_delegation` + HMAC | §5.4.4 |
| 配额传播 | `control.quota_hint` | §5.4.5 |
| 审计分区 | R2 key `tenants/{team_uuid}/audit/...` | §5.4.6 |
| 客户端 authority 由 server 戳印 | `authority.stamped_by` + ingress 注入 | §5.3 |
| `_platform` 保留值仅限 platform role | Layer 2 检查 | §5.3 + §10.3 |
| 所有 R2/KV 访问走包装层 | `tenancy/scoped-io.ts` + CI lint 规则 | §10.4 |
| 每个 transport 的多租户具体实现 | §5.4.7 表 | §5.4.7 |
| 专用 error code | `NACP_TENANT_*` 4 个 | §8.2 |

**12 项都已覆盖**。

### 12.4 七维度最终评分

| 维度 | 评级 (1-5) | 一句话说明 |
|------|------------|-----------|
| 对 nano-agent 核心定位的贴合度 | 5 | 协议家族分层 + 多租户一等 + 状态机约束，全面支撑 Cloudflare-native 平台愿景 |
| 对 GPT review 的回应完整度 | 5 | 13 条断点全部在 v2 得到具体修订，每条有对应字段/函数/章节 |
| 多租户一等公民的落实度 | 5 | 从 authority 字段到 refs namespacing 到 scoped-io 包装层到 CI lint，全栈 enforce |
| 第一版实现的性价比 | 4 | 4 周工程量换来一个能长期不变的地基；比 v1 的 2 周估算贵一倍，但换来实际 production 可用 |
| 和已有工程经验的复用度 | 5 | 几乎所有核心结构都能在 SMCP/SAFE 找到直接对应，加上 GPT review 的结构性修正 |
| 学习曲线 | 4 | Session profile 与 tenant delegation 是新概念；但对 TS + zod 开发者仍然直观 |
| 风险可控程度 | 5 | HMAC + size guard + deadline + idempotency + tenant boundary + state machine + role gate 七道锁 |
| **综合价值** | **5** | **协议从"单一合同"升级为"协议家族"；多租户从"字段存在"升级为"一等公民强制"** |

### 12.5 一句话 Verdict

> **NACP v2 不是对 v1 的小修小补，而是接受 GPT review 的结构性建议 + 用户的多租户要求后的一次重大收敛**。它把单一协议拆成 **Core / Session / Transport Profiles** 三层，把 WebSocket 的 replay/resume / Tool progress 的物理回传 / 状态机约束 / per-role required 四个断点各自闭合；同时把多租户从"authority 必填"这一个朴素规则升级为 **十二项强制约束 + 专用模块 + CI 层面的 enforcement**——从 `refs` 的 tenant namespace、`tenant_delegation` 的签名委托、`quota_hint` 的配额传播、审计的 team 分区、到 `tenancy/scoped-io.ts` 包装层，一层一层把"多租户"这件事写死在协议与代码路径里。**预估 4 周工程量换来的不是一份协议文档，而是一个从 day 1 起就符合平台级治理边界的 agent runtime 地基**。建议**立即按 §11 的 7 阶段推进**，先于 hooks / skills / fake bash 任何具体模块开始实现；同时把 `@nano-agent/nacp-core` 与 `@nano-agent/nacp-session` 作为**两个独立的 npm 包**发布，避免 Session profile 的变更拖累 Core 的稳定性。
