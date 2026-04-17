# Nano-Agent 功能簇设计 — Eval & Observability

> 功能簇: `Eval & Observability`
> 讨论日期: `2026-04-16`
> 讨论者: `Claude Opus 4.6 (1M context)`
> 关联调查报告:
> - `docs/investigation/codex-by-opus.md` §14.4 (tracing / otel / rollout replay)
> - `docs/investigation/claude-code-by-opus.md` §14.4 (tengu telemetry / promptCacheBreakDetection)
> - `docs/investigation/mini-agent-by-opus.md` §14.4 (plain-text log only)
> - `docs/nacp-by-opus.md` v2 §5.4.6 (audit partitioning) + §5.6 (audience / redaction)
> - `docs/action-plan/nacp-core.md` (audit.record message type)
> - `docs/action-plan/nacp-session.md` (session.stream.event catalog with 9 kinds)
> - `docs/design/hooks-by-opus.md` (hook audit log → DO storage JSONL)
> - `docs/design/session-do-runtime-by-opus.md` (Session DO as trace source)
> - `docs/plan-after-nacp.md` §6 (infra + observation windows)
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么 Eval & Observability 必须在代码之前设计

`docs/plan-after-nacp.md` §3.2 明确指出：如果不先做 observability / eval harness，后续 DDL / KV / R2 的存储分层决策就是"拍脑袋"。这不是一个"部署后再加"的子系统——它决定了我们**有没有能力判断其他子系统是否正确工作**。

三家代表 agent 的对比更加证实了这一点：
- **codex**：有完整 rollout JSONL + OTEL crate + `response-debug-context` 包，可以 replay 整个会话
- **claude-code**：有 `tengu_*` 系列 telemetry 事件 + `promptCacheBreakDetection` + 会话 transcript 持久化
- **mini-agent**：只有 plain-text log，无法程序化回放，是反例

nano-agent 在 Worker 环境下更需要 observability，因为：
1. **没有本地 terminal stdout**——所有调试信息必须通过结构化事件传递
2. **会话可以跨 hibernation 存活**——需要"事后回放"能力
3. **多租户**——审计必须按 team_uuid 分区，不能 grep 全局日志

### 0.2 前置共识

- NACP-Core 已有 `audit.record` 和 `system.error` 两个 Core message type
- NACP-Session 已有 9 种 `session.stream.event` kinds，包括 `turn.begin` / `turn.end` / `tool.call.progress` / `hook.broadcast` / `llm.delta` / `compact.notify` / `system.notify`
- Hooks design 已定义 audit log 写入 DO storage 的 JSONL 格式
- NACP-Core 有 `control.audience` (internal / audit-only / client-visible) 和 `control.redaction_hint`

### 0.3 显式排除的讨论范围

- 不讨论生产级 APM / DataDog / Grafana 集成
- 不讨论 billing / cost analytics（那是 storage-topology 的范畴）
- 不讨论 LLM evaluation benchmarks（那是 model quality，不是 runtime observability）
- 不讨论跨租户审计查询的 API 设计

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`Eval & Observability`
- **一句话定义**：Eval & Observability 是 nano-agent 的**验证与观察基础设施**——提供 trace sink / session inspector / scenario runner / failure replay 四大能力，让我们能判断其他子系统是否正确工作，并为 storage topology 的数据分层决策提供证据。
- **边界描述**：
  - **包含**：trace sink（结构化事件收集）、session timeline（事件序列可视化）、session inspector（实时观察运行中 session）、scenario runner（脚本化 e2e 测试）、failure replay（从审计日志重放失败路径）、storage placement inspector（每条数据落在 DO/KV/R2 的可视化）
  - **不包含**：审计日志的 DDL schema、LLM quality benchmark、billing pipeline、客户端 UI 框架

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Trace Event** | 一条结构化的运行时事件，由 Session DO / Hook / LLM / Tool 产出 | 格式 = NACP Core envelope (audit.record) 或 Session stream event |
| **Live Session Stream** | 实时 WebSocket 推送的 `session.stream.event`，生命周期与连接绑定 | 包含高频 progress（如 `llm.delta`、`tool.call.progress`）；**不一定全部持久化**——参照 claude-code `sessionStorage.ts:134-145,180-195` 将 progress 排除在 transcript 之外 |
| **Durable Audit Trace** | 落盘到 DO storage JSONL 的 `audit.record` 事件 | internal 运行时证据，按 team_uuid 分区，用于 failure replay + storage placement evidence |
| **Durable Transcript** | session 结束时导出的完整对话记录 | 包含 user / assistant / tool result；不包含高频 progress；归档到 R2 |
| **Trace Sink** | 事件的持久化目的地 | v1 = DO storage JSONL；未来可 fan-out 到 R2 / Analytics Engine |
| **Session Timeline** | 一个 session 内所有 trace event 按时间排序的序列 | 包括 NACP-Core internal + NACP-Session client-visible 两层 |
| **Session Inspector** | 实时观察一个正在运行的 session 的 stream event flow | 通过 WebSocket 的 `session.stream.event` 订阅实现 |
| **Scenario Runner** | 用脚本化方式驱动 session 走完一个预定义路径 | 输入 = scenario JSON；输出 = pass/fail + timeline |
| **Failure Replay** | 从审计日志中提取失败 session 的事件序列并重新执行 | 需要 audit log 保留完整的请求/响应上下文 |
| **Storage Placement Inspector** | 观察每条数据最终落在 DO storage / KV / R2 的哪个位置 | 为 storage-topology 的决策提供证据 |

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

Eval & Observability 是**验证层**——它不参与 agent 的主循环，但它回答"主循环是否正确工作"这个问题。

它的价值分三层：
1. **开发期**：替代 `console.log` / `print`——在 Worker 环境里没有本地 terminal，所有调试必须走结构化事件
2. **验证期**：替代手动测试——scenario runner 可以脚本化地验证 "session.start → tool call → hook → compact → session.end" 的完整路径
3. **运营期**：替代 log grep——session timeline + failure replay 让"用户说 session 坏了"的排查变成"看 timeline + 重放"

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|---------|---------|------|
| **Session DO Runtime** | Session DO emit trace events → trace sink | 中 | Session DO 是最大的事件源 |
| **NACP-Core** | `audit.record` message type 是 trace event 的载体 | 中 | 审计走 Core transport |
| **NACP-Session** | `session.stream.event` 是 client-visible trace 的载体 | 弱 | inspector 消费 stream |
| **Hooks** | Hook emit/outcome 事件是 trace 的一部分 | 弱 | hooks audit log 格式对齐 |
| **LLM Wrapper** | LLM request/response/usage 是 trace 的一部分 | 弱 | llm.delta 已在 stream event |
| **Capability Runtime** | Tool call/progress/result 是 trace 的一部分 | 弱 | tool 事件已在 stream event |
| **Storage Topology** | storage placement inspector 观察数据落盘位置 | 中 | 这是 topology 决策的证据源 |

### 2.3 一句话定位陈述

> "Eval & Observability 是 nano-agent 的**验证基础设施**，负责**收集结构化 trace、提供 session timeline / inspector / scenario runner / failure replay 四大观察能力**，为**其他子系统的正确性验证**和**storage topology 的数据分层决策**提供可靠证据。"

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点

| 被砍项 | 砍的理由 | 未来是否回补 |
|--------|---------|-------------|
| 生产级 APM (DataDog/Grafana) | v1 用 DO storage + R2 JSONL 足够 | 按需接 CF Logpush |
| 实时 metrics dashboard | v1 不需要仪表盘；timeline 够用 | v2 |
| 跨租户审计 API | v1 审计按 team 分区，无跨租户查询 | 按需 |
| LLM quality evaluation | 不是 runtime observability | 独立项目 |

### 3.2 接口保留点

| 扩展点 | v1 行为 | 未来可能演进 |
|--------|---------|-------------|
| `TraceSink` 接口 | v1 写 DO storage JSONL | 可换成 R2 / Analytics Engine / Logpush |
| `ScenarioRunner.run(scenario)` 返回 `ScenarioResult` | v1 只检查 pass/fail | 可扩展为覆盖率统计 / regression detection |
| `TimelineQuery(session_uuid, filters)` | v1 返回 event list | 可扩展为时间窗口查询 / 聚合 |

### 3.3 解耦点

- **TraceSink 与 Session DO 分离**：Session DO 只调 `traceSink.emit(event)`，不知道事件写到哪里
- **ScenarioRunner 与 production runtime 分离**：runner 是一个独立的 test harness，不在生产 Worker 里运行
- **Timeline 查询与 trace 写入分离**：写入走 append-only JSONL；查询走独立的 read path

### 3.4 聚合点

- **所有 trace event 走 `audit.record` NACP 消息**——内部 hooks/tool/llm/compact 的 trace 都收敛到 Core 的 `audit.record` message type
- **所有 client-visible trace 走 `session.stream.event`**——9 kinds 是唯一出口

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent

- **做了什么**：`AgentLogger`（`logger.py:11-40`）写 `~/.mini-agent/log/agent_run_{YYYYMMDD_HHMMSS}.log`。三种 entry type（REQUEST / RESPONSE / TOOL_RESULT），每条带 `[{index}] {TYPE}\nTimestamp: {ISO}\n---\n{JSON}`。Log request 只记录 tool **names**（不含 schema）。Tool result 含 arguments dict + success/error 字段。
- **值得借鉴**：**entry 结构（type + index + timestamp + JSON body）** 是最简的 trace event 模板。nano-agent 的 trace event schema 可以从这个 shape 起步。
- **不照抄的**：plain-text format（不可 parse）；`log_dir.mkdir(parents=True, exist_ok=True)` 的简单创建（我们用 DO storage，不需要 mkdir）。

### 4.2 codex（最成熟的 observability 实现）

- **做了什么**：
  - **OpenTelemetry 集成**（`codex-rs/otel/`）：18 个 metric names（`names.rs:1-38`）覆盖 `codex.tool.call`、`codex.api_request`、`codex.turn.e2e_duration_ms`、`codex.turn.ttft.duration_ms`（首 token 时延）、`codex.startup_prewarm.duration_ms` 等。`MetricsClient`（`client.rs:82-90`）管理 u64 counter / f64 histogram / duration histogram 三类 instrument。
  - **SessionTelemetry**（`session_telemetry.rs:76-91`）：`SessionTelemetryMetadata` 含 `conversation_id`、`auth_mode`、`auth_env`（API key 环境变量存在性检测）、`account_id`、`originator`、`session_source`、`model`、`app_version`、`terminal_type`。
  - **W3C Trace Context**（`trace_context.rs`）：`context_from_w3c_trace_context()` / `current_span_trace_id()` / `set_parent_from_w3c_trace_context()` 实现分布式追踪上下文传播。
  - **RolloutRecorder**（`recorder.rs:74-81`）：JSONL 审计，每行一个 `RolloutItem` enum（`SessionMeta / ResponseItem / CompactedItem / TurnContext / EventMsg`）。Output 截断到 10,000 bytes（`recorder.rs:189-212`）。
  - **response-debug-context**（`response-debug-context/src/lib.rs:11-17`）：从 HTTP error 提取 `ResponseDebugContext { request_id, cf_ray, auth_error, auth_error_code }`。Headers `x-request-id`、`cf-ray`、`x-error-json`（base64 decode）。**消息体不泄露到 telemetry**。
- **直接借鉴（可复用模式）**：
  - **18 个 metric name 的层级命名**（`agent.turn.*`、`agent.tool.*`、`agent.api.*`）——nano-agent 沿用同一套前缀。
  - **`SessionTelemetryMetadata` 的 auth_env 字段**——追踪"API key 是否在 env 里"而不是追踪 key 本身。
  - **Rollout JSONL 的 per-event 追加 + 10KB 截断**——直接用于 DO storage audit trail。
  - **`ResponseDebugContext` 的 header 提取 pattern**——nano-agent 的 LLM executor 错误诊断应抄这个。
- **不照抄的**：OTEL SDK 本身（Worker 里没有完整 OTEL runtime）；SQLite state DB（v1 不引入 D1）。

### 4.3 claude-code（最精细的 telemetry 实现）

- **做了什么**：
  - **Analytics queue + deferred sink**（`analytics/index.ts:80-84`）：事件在 sink 初始化前排队，不丢失。`logEvent(name, metadata)` 是同步 API。Datadog + 1st-party 双通道。
  - **PII 保护**（`analytics/index.ts:22-33`）：`_PROTO_*` 前缀标记 PII 字段，`stripProtoFields()` 在发 Datadog 前移除。`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 类型守卫强制验证字符串。
  - **核心事件族**（`services/api/logging.ts`）：
    - `tengu_api_query`（`logging.ts:196-233`）：model / temperature / betas / permissionMode / querySource / queryChainId / queryDepth / thinkingType / effortValue / fastMode
    - `tengu_api_error`（`logging.ts:304-365`）：error / status / errorType / durationMs / attempt / requestId / clientRequestId + **gateway detection**（litellm/helicone/portkey/cloudflare-ai-gateway/kong/braintrust/databricks via header fingerprints）
    - `tengu_api_success`（`logging.ts:398-500`）：usage (input/output/cache_creation/cache_read tokens) / durationMs / ttftMs / costUSD / stopReason / textContentLength / thinkingContentLength / toolUseContentLengths per-tool
  - **promptCacheBreakDetection**（`promptCacheBreakDetection.ts`）：维护 `PreviousState` 含 systemHash（DJB2）/ cacheControlHash / toolsHash / perToolHashes / systemCharCount + `pendingChanges` diff（systemPromptChanged / toolSchemasChanged / changedToolSchemas[] / addedBetas / removedBetas）。Cache TTL 阈值：5min / 1hour。`cacheDeletionsPending` flag 让 microcompact 的 cache_edits delete 不被误报为 cache break。最多追踪 10 个并发 query source 防止内存膨胀。
  - **DiagnosticTrackingService**（`diagnosticTracking.ts:30-49`）：追踪 IDE LSP diagnostics（Error/Warning/Info/Hint），维护 `beforeFileEdited` 基线 + `lastProcessedTimestamps` map。
- **直接借鉴（可复用模式）**：
  - **`PreviousState` hash + `pendingChanges` diff 的 cache break 归因**——nano-agent 不只记录"cache miss"，还记录"为什么 miss"（哪个字段变了）。这是 observability 从"记录"升级到"归因"的关键模式。
  - **`_PROTO_*` PII prefix + type guard**——trace event 的敏感字段标记方法。对应 NACP 的 `redaction_hint`。
  - **Event queue + deferred sink pattern**——Session DO 可能在 startup 时就 emit events，但 trace sink 可能还没 ready。queue 先攒、sink 后 flush。
  - **`tengu_api_success` 的 per-tool content length tracking**——知道"哪个 tool 返回了多大的 result"对 storage topology 决策有直接价值。
  - **Gateway fingerprint detection**（`logging.ts:65-105`）——对接多 provider 时自动识别中间网关。
- **不照抄的**：Datadog 通道（Worker 里用 R2 + Logpush）；React component-level diagnostic tracking（我们没有 IDE 集成）。

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | **nano-agent 倾向** |
|------|-----------|-------|-------------|---------------------|
| Trace 格式 | plain-text log | OTEL spans + JSONL rollout | `tengu_*` event queue + JSONL transcript | **NACP `audit.record` JSONL → DO storage** |
| Metric 体系 | 无 | 18 metrics（`names.rs`） | 40+ `tengu_*` events | **从 codex 18 metrics 起步** |
| Cache 归因 | 无 | 无 | `promptCacheBreakDetection` hash+diff | **直接借鉴 DJB2 hash + pendingChanges 模式** |
| PII 保护 | 无 | sanitize HTTP body | `_PROTO_*` prefix + type guard | **`redaction_hint` in NACP** |
| 分布式追踪 | 无 | W3C Trace Context | requestId + clientRequestId chain | **NACP trace_id + parent_message_uuid** |
| Replay 能力 | 无 | rollout JSONL replay | 无 | **DO storage audit → R2 archive → replay** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope

- **[S1]** `TraceSink` 接口 + DO storage JSONL 实现：append-only, per-session, tenant-partitioned
- **[S2]** Trace event schema：基于 `audit.record` body 扩展，含 base fields（`event_kind` / `timestamp` / `duration_ms?` / `context?` / `error?`）+ evidence extension slots（`usage_tokens?` / `ttft_ms?` / `attempt?` / `provider?` / `gateway?` / `cache_state?`）——参见下方 §7.1 F3 的分层定义
- **[S3]** Session Timeline builder：从 DO storage 读取一个 session 的全部 trace events，按 timestamp 排序
- **[S4]** Session Inspector：通过 `session.stream.event` 的 WebSocket 订阅，实时观察正在运行的 session
- **[S5]** Scenario Runner：脚本化 e2e 测试框架，输入 `ScenarioSpec` 输出 `ScenarioResult`
- **[S6]** Failure Replay helper：从 audit log 提取失败 session 的事件序列，辅助 debug
- **[S7]** Storage Placement Inspector：追踪每条关键数据的 DO/KV/R2 落盘位置
- **[S8]** Trace event 的 audience / redaction 对齐：internal trace 不走 client stream；client-visible trace 消费 `redaction_hint`

### 5.2 Out-of-Scope

- **[O1]** 生产级 APM / metrics / alerting
- **[O2]** 跨租户审计查询 API
- **[O3]** LLM quality benchmarks
- **[O4]** Billing / cost pipeline
- **[O5]** Client-side UI 框架
- **[O6]** D1 / structured query for trace events（v1 只做 append + scan）

---

## 5.3 Trace 三分法：Live Stream / Durable Audit / Durable Transcript

> 这一区分是 GPT review 指出的关键缺失——如果不拆开，timeline builder 可能把高频 progress 当成 durable record，storage placement inspector 会统计错"真正需要落盘的证据"。

claude-code 的 `sessionStorage.ts:134-145,180-195` 已经给了明确信号：**progress 不是 transcript message**；高频 tool progress 是 UI-only ephemeral state。

nano-agent 应对 trace 事件做以下三分法：

| 分类 | 内容 | 持久化目标 | 生命周期 |
|------|------|-----------|---------|
| **Live Session Stream** | 所有 `session.stream.event`（含 `llm.delta` / `tool.call.progress` / `system.notify` 等 9 kinds） | **不一定持久化**——只推给当前 WebSocket 连接的 client | 连接级，断线即消失（可被 replay buffer 短暂保留以支持 resume） |
| **Durable Audit Trace** | `audit.record` NACP 消息——internal 运行时证据（LLM 调用详情、hook outcome、compact 决策、error 诊断、storage placement 记录等） | DO storage JSONL → 定期 archive 到 R2 | session 级 + archive 级 |
| **Durable Transcript** | user / assistant / tool result 的完整对话记录——**不含高频 progress** | session end 时导出到 R2 `tenants/{t}/sessions/{s}/transcript.jsonl` | 归档级 |

关键规则：
- **不是每个 `session.stream.event` 都必须 durable**——`llm.delta` 和 `tool.call.progress` 是高频 ephemeral 事件，如果全部落盘会产生 10x 写入放大
- **某些 `session.stream.event` 可以被采样/摘要/映射为 audit trace event**——例如 `turn.begin` / `turn.end` 在 live stream 和 audit 两层都出现，但 audit 层携带 evidence extension fields（usage_tokens / ttft_ms / duration_ms）
- **Transcript 是 audit trace 的子集**——只保留面向用户的对话结构（user prompt + assistant response + tool result summary），不保留 internal hook/compact/error 详情

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **"DO storage JSONL 作为 v1 trace sink"** 而不是 **"直接上 Analytics Engine / Logpush"**
   - **为什么**：DO storage 是 session actor 级别的强一致存储，trace 天然属于 session scope；不需要跨 session join
   - **代价**：不支持跨 session 查询；大量 trace 会占 DO storage 空间（单 DO 50GB 上限）
   - **重评条件**：当需要跨 session 聚合分析时

2. **取舍 2**：我们选择 **"scenario runner 作为独立 test harness"** 而不是 **"内嵌到 production worker 里"**
   - **为什么**：eval harness 不应该在生产路径上增加 overhead
   - **代价**：scenario runner 需要单独维护 client 连接逻辑
   - **重评条件**：如果需要"在生产环境里跑 smoke test"

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|---------------|
| F1 | TraceSink interface | `emit(event: TraceEvent): Promise<void>` 的抽象接口 | ✅ 可替换的 trace 持久化口子 |
| F2 | DoStorageTraceSink | 把 trace event 追加到 `tenants/{team_uuid}/trace/{session_uuid}/{date}.jsonl` | ✅ 每条 event 一行 JSON |
| F3 | TraceEvent schema | **Base fields**: `{event_kind, timestamp, session_uuid, turn_uuid?, step_index?, duration_ms?, context?, error?}` + **LLM evidence extension**: `{usage_tokens?, ttft_ms?, attempt?, provider?, gateway?, cache_state?, cache_break_reason?}` + **Tool evidence extension**: `{tool_name?, result_size_bytes?}` + **Storage evidence extension**: `{storage_layer?, key?, op?}` | ✅ 可被 timeline builder + storage placement inspector 消费；base 必填，extensions 按 event_kind 可选 |
| F4 | SessionTimeline | 读取一个 session 的全部 trace events 并按 timestamp 排序 | ✅ 返回 `TraceEvent[]` |
| F5 | SessionInspector | 通过 WebSocket `session.stream.event` 实时观察 | ✅ 可看到 kind / seq / content |
| F6 | ScenarioSpec schema | `{name, steps: [{action, expect}]}` 的脚本化测试定义 | ✅ 可驱动一次 session e2e |
| F7 | ScenarioRunner | 执行 ScenarioSpec，收集 timeline，判断 pass/fail | ✅ `runner.run(spec) → ScenarioResult` |
| F8 | FailureReplayHelper | 从 audit log 提取失败路径的 event 序列 | ✅ 辅助 debug 的 read-only 工具 |
| F9 | StoragePlacementLog | 在关键数据写入时记录"这条数据落在 DO/KV/R2 的哪个 key" | ✅ 为 storage-topology 决策提供证据 |
| F10 | Audience gate | trace event 的 `audience` 字段决定是否进入 client stream | ✅ internal trace 不泄露给 client |

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 nacp-core

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-core/src/messages/system.ts` | `AuditRecordBodySchema` — trace event 的 NACP 载体 |
| `packages/nacp-core/src/tenancy/scoped-io.ts` | `tenantR2Put` / `tenantDoStoragePut` — tenant-scoped trace 写入 |

### 8.2 来自 nacp-session

| 文件 | 借鉴点 |
|------|--------|
| `packages/nacp-session/src/stream-event.ts` | 9 kinds = client-visible trace 的 catalog |
| `packages/nacp-session/src/redaction.ts` | `redactPayload()` — client-visible trace 的 audience gate |

### 8.3 来自 codex

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `codex-rs/otel/src/names.rs:1-38` | 18 个层级化 metric names（`codex.tool.call` / `codex.turn.e2e_duration_ms` / `codex.turn.ttft.duration_ms`） | nano-agent 的 metric 命名直接沿用 `agent.turn.*` / `agent.tool.*` / `agent.api.*` 前缀 |
| `codex-rs/otel/src/events/session_telemetry.rs:76-91` | `SessionTelemetryMetadata` 含 `auth_env` 字段追踪 API key 环境变量的**存在性**而非值 | nano-agent 的 session init event 抄这个 pattern |
| `codex-rs/otel/src/events/session_telemetry.rs:141-184` | `counter()` / `histogram()` / `record_duration()` / `start_timer()` 四种 emit 方法 | TraceSink 的 API surface 参考 |
| `codex-rs/otel/src/events/session_telemetry.rs:313-449` | `codex.conversation_starts` 事件（20+ 字段）+ `codex.api_request` 事件（15+ 字段含 cf_ray / request_id） | trace event 的字段丰度参考——nano-agent 的 session.start 和 llm.call 事件应有类似覆盖面 |
| `codex-rs/otel/src/trace_context.rs` | W3C Trace Context propagation（`context_from_w3c_trace_context` / `set_parent_from_w3c_trace_context`） | nano-agent 的 NACP `trace_id` + `parent_message_uuid` 已实现等价功能；若需对接 OTEL 可从这里抄 |
| `codex-rs/response-debug-context/src/lib.rs:11-17` | `ResponseDebugContext { request_id, cf_ray, auth_error, auth_error_code }` + header 提取 + **消息体不泄露** | LLM executor 的错误诊断抽取器直接照搬 |
| `codex-rs/rollout/src/recorder.rs:74-81,189-212` | JSONL 追加 + `RolloutItem` enum + output 10KB 截断 | DO storage audit trail 的格式与截断策略 |

### 8.4 来自 claude-code

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `claude-code/services/api/promptCacheBreakDetection.ts` 全文 | `PreviousState` 的 DJB2 hash 对比（systemHash / toolsHash / perToolHashes / cacheControlHash）+ `pendingChanges` diff（systemPromptChanged / addedBetas / removedBetas / changedToolSchemas[]）+ `cacheDeletionsPending` flag + 5min/1hour TTL 阈值 + 最多 10 并发 source 追踪 | **直接照搬**为 nano-agent 的 prompt cache 归因系统——这是三家里唯一做了"归因"而不只是"记录"的实现 |
| `claude-code/services/api/logging.ts:196-500` | `tengu_api_query` / `tengu_api_error` / `tengu_api_success` 三个核心事件的完整字段集（model / usage / duration / attempt / ttft / costUSD / gateway detection / queryChainId / queryDepth） | nano-agent 的 LLM trace event 字段集直接参考（不需要全抄，但 usage + ttft + costUSD + attempt + gateway 是必需的） |
| `claude-code/services/api/logging.ts:65-105` | Gateway fingerprint detection（header 指纹识别 litellm / helicone / portkey / cloudflare-ai-gateway / kong / braintrust / databricks） | 当 nano-agent 接入多 provider 时，自动识别中间网关的 pattern |
| `claude-code/services/analytics/index.ts:19-84` | `_PROTO_*` PII prefix + `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` type guard + event queue before sink attach | PII 保护 pattern + deferred sink pattern |
| `claude-code/services/diagnosticTracking.ts:30-49` | `DiagnosticTrackingService` 追踪 IDE LSP 变化的 before/after 基线 | 文件变更 trace 的 baseline diff pattern |
| `claude-code/cost-tracker.ts:160-174` | Per-model usage tracking（input/output/cache tokens, cost USD, web search requests） | nano-agent 的 session 级 usage 统计字段 |

### 8.5 来自 mini-agent

| 文件:行 | 借鉴点 | 怎么用 |
|---------|--------|--------|
| `mini_agent/logger.py:11-40` | `AgentLogger` 的 entry format：`[{index}] {TYPE}\nTimestamp: {ISO ms}\n---\n{JSON}` | trace event 的最简人类可读格式参考 |
| `mini_agent/logger.py:43-157` | `log_request(messages, tools)` 只记录 tool **names**（不含 schema）；`log_tool_result` 含 success + error + arguments | trace event 的 "该记什么 / 不该记什么" 决策参考——schema 不需要进 trace，只需 name |

---

## 9. 综述总结与 Value Verdict

### 9.1 功能簇画像

Eval & Observability 是 nano-agent 的**验证基础设施**。v1 预期 ~400-600 行核心代码（TraceSink + Timeline + ScenarioRunner），围绕三个原则：
1. **trace event 走 NACP 消息**（`audit.record` for internal, `session.stream.event` for client-visible）
2. **持久化走 DO storage JSONL**（append-only, per-session, tenant-partitioned）
3. **scenario runner 是独立 harness**（不在 production worker 里）

它的最大价值不是"好看的仪表盘"，而是**让后续的 storage-topology 决策有证据**——"什么数据被读了多少次 / 什么数据写了多少次 / 什么数据跨 session 被引用"这些问题的答案，都来自 trace timeline。

### 9.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|----------|------------|------------|
| 对 nano-agent 核心定位的贴合度 | 5 | Worker 环境没有 terminal，结构化 trace 是唯一调试路径 |
| 第一版实现的性价比 | 4 | TraceSink + Timeline 很轻；ScenarioRunner 需要投入但回报高 |
| 对 storage-topology 的杠杆 | 5 | 这是 storage 分层决策的证据源 |
| 对开发者日用友好度 | 4 | session inspector 替代 console.log |
| **综合价值** | **5** | **"没有观察窗口就没有证据，没有证据就没有好决策"** |

---

## 附录

### A. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|------|------|--------|----------|
| v0.1 | 2026-04-16 | Opus 4.6 | 初稿 |
| v0.2 | 2026-04-16 | Opus 4.6 | 基于 GPT + Kimi review 修订：加 Live/Durable Audit/Durable Transcript 三分法(#4)、修 otel 路径为 `events/session_telemetry.rs`(#11)、修 RequestDebugContext→ResponseDebugContext(#12)、扩展 TraceEvent schema 加 evidence extension slots |
