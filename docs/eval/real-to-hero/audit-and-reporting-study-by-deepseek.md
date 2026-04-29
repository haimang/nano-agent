# Nano-Agent 可观测性（Audit & Reporting）深度对比研究

> 研究对象: `nano-agent 6-worker + NACP 协议组合 — 日志、报错、埋点体系的完整性审计`
> 对比参照: `Claude Code / OpenAI Codex / Google Gemini CLI 三款成熟 CLI Agent 的可观测性架构`
> 研究类型: `audit-and-reporting-study`
> 研究时间: `2026-04-29`
> 研究人: `DeepSeek（独立研究，不参考 GPT / GLM / Kimi 既有分析报告）`
> 研究范围:
> - `context/claude-code/` — Claude Code 日志/报错/埋点体系（268 文件，含 utils/debug.ts、utils/errorLogSink.ts、utils/telemetry/ 全量 OTel 基础设施）
> - `context/codex/` — Codex 日志/报错/埋点体系（1433 Rust 文件，含 tracing subscriber、SQLite log_db、OTel metrics、SessionTelemetry）
> - `context/gemini-cli/` — Gemini CLI 日志/报错/埋点体系（51 文件 telemetry/，含 OpenTelemetry SDK、ClearcutLogger、40+ ToolErrorType、性能监控）
> - `workers/{agent-core,orchestrator-core,orchestrator-auth,bash-core,context-core,filesystem-core}/src/` — nano-agent 全部 6 worker 源码
> - `packages/{nacp-core,nacp-session,orchestrator-auth-contract}/src/` — NACP 协议层全部错误/证据/可观测性定义
> 文档状态: `final`

---

## 0. 一句话结论

> **nano-agent 的错误码体系已具备工程完整性（22 RpcErrorCode + 19 NACP + 6 KERNEL + 8 SESSION + 8 LLMCategory），trace_uuid 全链路传播已落地，Evidence 基础设施（assembly/compact/artifact/snapshot 四流）已搭好骨架——但 logging 层是裸 console、无持久化、无层级过滤、无协议级日志帧、11 个定义好的 metric name 从未 emit、`NacpObservabilityEnvelope` 定义了却从未消费。对比三款成熟 CLI Agent，nano-agent 在可观测性上处于 "schema-defined, runtime-missing" 阶段——协议层已预留，运行时层大面积真空。**

---

## 1. 对比研究：三款 CLI Agent 的可观测性架构

### 1.1 Claude Code（Claude Code）

**日志体系**：
- **核心 Debug Logger**（`utils/debug.ts` 268 行）：单一入口 `logForDebugging(message, {level})`，五级日志 `verbose/debug/info/warn/error`，`CLAUDE_CODE_DEBUG_LOG_LEVEL` 环境变量运行时过滤
- **双通道输出**：stderr 模式（`--debug-to-stderr`）+ 文件模式（`~/.claude/debug/<sessionId>.txt`）带缓冲写入（1s flush / 100-entry buffer）
- **持久化错误日志**（`utils/errorLogSink.ts` 235 行）：JSONL 格式写入 `~/.claude/errors/<timestamp>.jsonl`，结构化 payload `{timestamp, error, cwd, userType, sessionId, version}`
- **内存环形缓冲**：保留最近 100 条错误，可编程访问（`getInMemoryErrors()`）

**报错体系**：
- **层次化错误类型**：`ClaudeError` 基类 → `AbortError` / `ConfigParseError` / `ShellError`（含 stdout/stderr/code）/ `TelemetrySafeError`（双消息：全量日志 + 安全遥测）
- **逐工具错误码**：每个工具定义自己的 numeric errorCode（`FileReadTool` 1-9, `FileEditTool` 1-10, `FileWriteTool` 1-3 等），以 `{ result: false, message, errorCode }` 形状返回
- **错误传播**：`toError(e)` 归一化 → `errorMessage(e)` 提取 → `classifyAxiosError(e)` 分桶（auth/timeout/network/http/other）

**埋点体系**：
- **双通道遥测**：3P 客户 OTel（traces/logs/metrics via OTLP）+ 1P Anthropic 内部（独立 `LoggerProvider` → `FirstPartyEventLoggingExporter`，磁盘重试 + 二次退避）
- **OTel Span Tracing**（`sessionTracing.ts` 927 行）：`interaction` / `llm_request` / `tool` / `hook` 四类 span，`AsyncLocalStorage` 上下文传播，自动 `recordException`
- **BigQuery Metrics**：5 分钟间隔 Delta export，`resource_attributes` 含 service/version/OS/arch/customer_type
- **Perfetto 追踪**（ant-only）：Chrome Trace Event 格式，`~/.claude/traces/trace-<id>.json`
- **GrowthBook 特性开关**：动态控制采样率、sink killswitch、batch config

### 1.2 OpenAI Codex

**日志体系**：
- **`tracing` 生态**（非 standalone logger）：多层 subscriber registry（file writer + feedback ring buffer + SQLite + OTEL logger + OTEL tracer）
- **SQLite 持久化**（`log_db.rs` 531 行）：专用 `logs` 表，128-entry 批次或 2s flush，per-partition 10 MiB / 1000 row 上限，10 天自动清理，支持复杂查询（level/timestamp/module/file LIKE/thread/search/pagination）
- **反馈系统**（`feedback/src/lib.rs` 801 行）：4 MiB 环形缓冲捕获所有 TRACE 级事件，Sentry 上传带分类（bug/bad_result/good_result/safety_check）

**报错体系**：
- **`CodexErr` 枚举**（67+ variants）：`Stream/ContextWindowExceeded/ThreadNotFound/Timeout/Spawn/Interrupted/UnexpectedStatus/QuotaExceeded/InternalServerError/RetryLimit/Sandbox` 等
- **`CodexErrorInfo` 协议层**：映射到 client-facing 错误枚举（`ContextWindowExceeded/UsageLimitExceeded/ServerOverloaded/InternalServerError/Unauthorized` 等），`affects_turn_status()` 控制历史重播中 turn 状态
- **JSON-RPC 2.0 错误码**：`-32600/ -32602/ -32603/ -32001`
- **`to_codex_protocol_error()`**：核心错误 → 协议错误的单向映射管道

**埋点体系**：
- **`SessionTelemetry`**（1097 行）：30+ 业务事件方法（conversation_starts / api_request / websocket_connect / sse_event / user_prompt / tool_decision / tool_result），全部走 `log_event!` / `trace_event!` / `log_and_trace_event!` 三宏
- **`MetricsClient`**：OTel counters + histograms，`codex.tool.call` / `codex.api_request` / `codex.turn.e2e_duration_ms` 等 17 个标准 metric
- **W3C TraceContext**：`traceparent` / `tracestate` propagation via env var + JSON-RPC `trace` field
- **Health Endpoints**：`GET /healthz` + `GET /readyz`，`ReadinessFlag` token-based 就绪检测

### 1.3 Google Gemini CLI

**日志体系**：
- **`DebugLogger`**（69 行）：`log/warn/error/debug` 四级，可选文件持久化（`GEMINI_DEBUG_LOG_FILE` 环境变量），`[ISO_TIMESTAMP] [LEVEL] message` 格式
- **Console 重定向**（`stdio.ts` 131 行）：`patchStdio()` 拦截 `process.stdout.write` / `process.stderr.write`，防 library stray output 破坏终端 UI

**报错体系**：
- **层次化 FatalError**：`FatalAuthenticationError`(41) / `FatalInputError`(42) / `FatalSandboxError`(44) / `FatalConfigError`(52) / `FatalTurnLimitedError`(53) / `FatalToolExecutionError`(54) 等，每个携带 `exitCode`
- **40+ `ToolErrorType` 枚举**：`FILE_NOT_FOUND` / `PERMISSION_DENIED` / `EDIT_NO_OCCURRENCE_FOUND` / `SHELL_EXECUTE_ERROR` / `WEB_FETCH_FALLBACK_FAILED` 等，`isFatalToolError()` 判定
- **Google API Error 深度解析**（`googleErrors.ts` 373 行）：`parseGoogleApiError()` 解析 12 种标准 RPC error detail（`ErrorInfo`/`RetryInfo`/`QuotaFailure`/`BadRequest`/`Help`/`LocalizedMessage` 等），`toFriendlyError()` 分类管道
- **`classifyFailureKind()`**：terminal / transient / not_found / unknown 四类

**埋点体系**：
- **三通道遥测**：ClearcutLogger（Google 内部分析管道） + OpenTelemetry SDK（traces/logs/metrics） + UI Telemetry（in-app session 统计）
- **OTel SDK**（`sdk.ts` 463 行）：`BatchSpanProcessor` + `BatchLogRecordProcessor` + `PeriodicExportingMetricReader`，四层 export 策略（GCP > OTLP Collector > File > Console）
- **30+ Event 类型**：`StartSessionEvent` / `UserPromptEvent` / `ToolCallEvent` / `ApiRequestEvent` / `ApiResponseEvent` / `ApiErrorEvent` / `FlashFallbackEvent` / `LoopDetectedEvent` / `ModelRoutingEvent` 等，每个实现 `toOpenTelemetryAttributes()` + `toLogBody()`
- **性能监控**：`MemoryMonitor`（458 行 V8 heap/RSS/CPU）、`EventLoopMonitor`（99 行 event loop lag）、`HighWaterMarkTracker`、`RateLimiter`、`ActivityDetector`
- **启动 Profiler**（251 行）：用 `performance.mark()/measure()` 缓冲启动阶段耗时
- **PII 清洗**：`sanitizeHookName()` / `sanitizeErrorMessage()` 在遥测发射前脱敏

### 1.4 三家对比总结

| 维度 | Claude Code | Codex | Gemini CLI | nano-agent |
|------|------------|-------|------------|------------|
| **Log 持久化** | JSONL 文件 + 内存环形缓冲 | SQLite 专用数据库 + 反馈环形缓冲 | 可选文件 (`GEMINI_DEBUG_LOG_FILE`) | **无**（裸 console） |
| **Log 层级** | 5 级（verbose→error）+ 运行时过滤 | tracing 5 级 + RUST_LOG 过滤 | 4 级（debug→error） | **无** |
| **结构化日志** | `[timestamp] [LEVEL] msg` | 全结构化 tracing span/event | `[ISO] [LEVEL] msg` | **半结构化** console.warn 标签 |
| **错误类型体系** | 层次化 + 逐工具 errorCode | 67+ variants `CodexErr` | 层次化 FatalError + 40+ ToolErrorType | **分散枚举**（RpcCode 22+ NACP 19+ KERNEL 6+ SESSION 8） |
| **错误持久化** | JSONL 文件 + 内存环形缓冲 | SQLite（所有事件） | 无独立错误存储（走遥测） | **无** |
| **遥测通道** | OTel 3P + 1P Analytics（磁盘退避） | OTel + Statsig + Analytics Events | Clearcut + OTel + UI Telemetry | **仅 Evidence 四流 + Hook 18 事件** |
| **Span Tracing** | 4 类 span + ALS 上下文 | W3C TraceContext propagation | OTel trace via `runInDevTraceSpan` | **无 span 概念** |
| **Metrics** | OTel counter/histogram + BigQuery | OTel counter/histogram（17 metric） | OTel counter/histogram（30+ metric） | **11 metric name 定义但从未 emit** |
| **Health Endpoint** | 无（本地进程） | `/healthz` + `/readyz` | 无（本地进程） | `** /debug/workers/health**（RH0 已落地） |
| **PII 安全** | `AnalyticsMetadata_I_VERIFIED...` 标记类型 + `_PROTO_*` 剥离 | `log_only` vs `trace_safe` target 分离 | `sanitizeHookName()` + 脱敏 | **无 PII 保护层** |
| **运行时监控** | 无独立监控（单进程） | 无独立监控（单进程） | MemoryMonitor + EventLoopMonitor + StartupProfiler | **无** |

---

## 2. nano-agent 当前可观测性全景审计

### 2.1 Console 调用分布（31 次，跨 4 worker）

| Worker | console.log | console.warn | console.error | 典型用途 |
|--------|-------------|-------------|---------------|----------|
| agent-core | 1 | 1 | 0 | `usage-commit` 事件 log；`push-server-frame-failed` warn |
| orchestrator-core | 0 | 24 | 0 | D1 读取失败、RPC 调用异常、alarm/trim 失败、schema 拒绝 |
| context-core | 0 | 3 | 0 | persist/flush/snapshot commit 失败 |
| filesystem-core | 0 | 2 | 0 | KV putAsync 失败、reference backend 异常 |
| bash-core | 0 | 0 | 0 | **完全静默** |
| orchestrator-auth | 0 | 0 | 0 | **完全静默** |

**半结构化模式**：大部分 warn 使用 `console.warn("tag-name", { tag: "tag-name", error: String(err) })`，这是一种非正式的半结构化模式——比裸字符串强，但无统一 schema、无 type-checking、无 sink 抽象。

**三个致命缺陷**：
1. **bash-core（0 次）和 orchestrator-auth（0 次）完全静默**——这两个 worker 的运行时错误（bash 执行失败、JWT 验证失败、wechat code 交换失败）没有任何运行时证据，`wrangler tail` 是唯一的取证手段
2. **agent-core 的 `console.log("usage-commit", ...)`**——这是业务可观测数据（quota 消费），不应走 dev-only 的 console 通道；目前没有任何持久化 sink 接收此数据
3. **不存在 `console.error`**——最高严重级别的日志通道在全部 6 worker 中零使用，说明没有错误分级意识

### 2.2 Trace UUID 传播（已落地，工程完整）

**生成点**：
- orchestrator-core：23+ 处（HTTP header `x-trace-uuid` → `crypto.randomUUID()` fallback）
- agent-core：5 处（NanoSessionDO 惰性初始化）
- bash-core / context-core / filesystem-core / orchestrator-auth：均从 `RpcMeta.trace_uuid` 消费

**传播通道**：
1. `RpcMeta.trace_uuid`（nacp-core/rpc.ts）——所有 WorkerEntrypoint RPC 的第二位置参数
2. `NacpEnvelope.trace_uuid`（nacp-core/envelope.ts）——NACP 协议层
3. `FacadeSuccessEnvelope.trace_uuid` + `FacadeErrorEnvelope.trace_uuid`——所有 facade HTTP 响应
4. `EvidenceAnchor.traceUuid`——所有 evidence 记录

**评价**：trace_uuid 全链路传播是 nano-agent 当前可观测性最强的部分。从 edge ingress（orchestrator-core fetch）到 depth call（agent-core / context-core / filesystem-core / bash-core RPC）再到 facade response，`trace_uuid` 全程携带。**这是唯一不构成盲点的可观测性维度。**

### 2.3 错误码体系（定义完整，使用不统一）

**已定义的枚举（工程完整）**：

| 枚举 | 位置 | 码数量 | 状态 |
|------|------|--------|------|
| `RpcErrorCode` | `nacp-core/src/rpc.ts:49` | 22 | ✅ 已定义，有 zod schema |
| `FacadeErrorCode` | `orchestrator-auth-contract/src/facade-http.ts:48` | 22（超集） | ✅ 已定义，含 HTTP status 映射 |
| `AuthErrorCode` | `orchestrator-auth-contract/src/auth-error-codes.ts:3` | 13 | ✅ 已定义 |
| NACP Error Codes | `nacp-core/src/error-registry.ts:61-88` | 19 | ✅ 已注册，`NacpAdmissibilityError`/`NacpValidationError` |
| `KernelErrorCode` | `agent-core/src/kernel/errors.ts:12` | 6 | ✅ 已定义 |
| `SessionErrorCode` | `nacp-session/src/errors.ts:10` | 8 | ✅ 已定义 |
| `LLMErrorCategory` | `agent-core/src/llm/errors.ts:10` | 8 | ✅ 已定义 |

**使用不一致的问题**：

1. **bash-core 使用 ad-hoc 字符串**（`"empty-command"` / `"policy-ask"` / `"handler-error"` 等 8 个字符串），不走任何 nacp-core 枚举。前端无法通过错误码查询文档

2. **context-core inspector facade 使用 ad-hoc 字符串**（`"not-found"` / `"session-mismatch"` / `"method-not-allowed"` 等 7 个字符串）

3. **orchestrator-core surface routes 使用 ad-hoc 字符串**（`"wrong-device"` / `"session-pending-only-start-allowed"` / `"agent-rpc-unavailable"` 等）

4. **`StorageError` 类在 `filesystem-core` 和 `storage-topology` 中重复定义**——两个 `StorageError`、`ValueTooLargeError`、`CursorRequiredError`、`StorageNotConnectedError` 完全相同

5. **`evidence-emitters-context.ts` 和 `evidence-emitters.ts` 近乎重复**——`buildAssemblyEvidence` / `buildCompactEvidence` / `buildSnapshotEvidence` 在两个包中重复实现

### 2.4 NACP 协议层的 log/error 预留（定义了但未使用）

**已预留但未使用的协议设施**：

| 协议设施 | 位置 | 定义状态 | 使用状态 |
|----------|------|----------|----------|
| `system.error` message type | `nacp-core/src/messages/system.ts:16` | ✅ `SystemErrorBodySchema { error: NacpErrorSchema, context? }` | ❌ **零 consumer** — 没有 worker 构造并 emit 此帧 |
| `system.notify` stream event | `nacp-session/src/stream-event.ts` | ✅ `{ severity: "info"|"warning"|"error", message }` | ⚠️ 仅消息定义，无 consumer |
| `NacpObservabilityEnvelope` | `nacp-core/src/observability/envelope.ts` | ✅ `{ alerts, metrics, traces, source_worker, source_role }` | ❌ **零 consumer** — 没有 worker 填充或发送此 envelope |
| `NacpErrorBodySchema` | `nacp-core/src/error-body.ts:34` | ✅ `{ code, message, retriable?, cause? }` | ❌ `NACP_ERROR_BODY_VERBS` 为空 — 无 verb 采用 |
| `delivery_kind: "error"` | `type-direction-matrix.ts` | ✅ `tool.call.response`/`skill.invoke.response`/`context.compact.response`/`system.error` 的合法方向 | ❌ 没有代码路径 return 带 `delivery_kind: "error"` 的响应 |
| Hook 18 事件目录 | `nacp-core/src/hooks-catalog/index.ts` | ✅ 18 个事件的 typed payload schema | ⚠️ RH1 仅接通了 HookDispatcher wiring，实际对应 handler 未注入 |
| 11 个 Metric Names | `agent-core/src/eval/metric-names.ts` | ✅ `agent.turn.*` / `agent.tool.*` / `agent.api.*` / `agent.compact.*` / `agent.session.*` | ❌ **零 emit** — 没有 counter 或 histogram 实例记录任何值 |
| Evidence 四流 | `nacp-core/src/evidence/vocabulary.ts` | ✅ assembly / compact / artifact / snapshot 全量 schema + `EvidenceAnchor` | ⚠️ 仅 context-core filesystem-core 部分使用 |

### 2.5 Facade Envelope 一致性（部分断裂）

**已统一的**：
- orchestrator-core 的所有 HTTP response 走 facade envelope：`{ ok: true, data: T, trace_uuid }` / `{ ok: false, error: { code, status, message }, trace_uuid }`
- `facadeFromAuthEnvelope()` 桥接 auth worker 的 RPC envelope 到 facade envelope

**断裂点**：
- **agent-core** 自己的 HTTP response（`http-controller.ts`）使用 legacy shape `{ ok: true, action, phase }` **不含 trace_uuid**——虽然 orchestrator-core 在 facade 层做了兼容包装（`user-do-runtime.ts:1607-1619`），但 agent-core 自身的 HTTP 路径不走此包装
- **agent-core** 内部使用 `{ ok: false, delivered: false, reason }` 的非标准 shape
- **context-core** inspector facade 使用 `{ error: "..." }` 而非 facade error envelope

---

## 3. 回答三个核心问题

### Q1：接口请求的日志是否存在，前端如何获取？

**直接回答：不存在结构化 API 请求日志，前端无法获取。**

**事实依据**：

1. **无请求日志记录**——orchestrator-core 的 `fetch` handler 在每个路由分支中没有任何行级的请求日志（无 request method/URL/headers/body 摘要记录）。唯一的 trace 信息是 facade response 中附带的 `trace_uuid`

2. **无日志查询端点**——没有 `GET /sessions/{id}/logs` 或 `GET /debug/logs?trace_uuid=xxx` 端点。`/debug/workers/health` 只报告 worker alive count

3. **console 输出不可达前端**——31 次 console 调用全部输出到 Cloudflare Workers 的 `wrangler tail` 流，前端完全不可见

4. **无 WS 日志推送帧**——NACP 协议中没有 `delivery_kind: "log"` 的消息类型，没有 `system.log` body schema。前端无法通过 WS 收到任何运行时日志

5. **对比三款 CLI Agent**：
   - Claude Code：`logForDebugging()` → stderr / 文件 / `BridgeLogger`（远程 session UI），前端通过 `BridgeLogger` 接口获取状态
   - Codex：`tracing_subscriber` → SQLite + OTEL，客户端通过 `LogQuery` 查询 SQLite
   - Gemini CLI：`DebugLogger` → 文件 + GCP Cloud Logging，客户端通过 JSON output envelope 获取 error

**nano-agent 前端目前唯一可获取的信息**：
- Facade response 中的 `trace_uuid`（但不附带任何日志上下文）
- Facade error envelope 中的 `{ code, status, message }`（仅错误路径）
- Zero 级别的请求耗时、重试次数、中间步骤日志

### Q2：报错系统是否具备持久化的日志，是否有标准的格式，所有的 error code 以及对应的意义在哪里查询？

**直接回答：无持久化存储，有标准 facade error envelope 格式但并非全局统一，无单一错误码查询入口。**

**事实依据**：

**持久化存储**——**不存在**。
- 没有 JSONL 文件（对比 Claude Code 的 `~/.claude/errors/<timestamp>.jsonl`）
- 没有 SQLite 数据库（对比 Codex 的 `logs.sqlite`，128-entry batch insert + 10 天 retention）
- 没有 GCP Cloud Logging / OTLP collector（对比 Gemini CLI）
- Cloudflare Workers 的 `console.*` 输出在 `wrangler tail` 中可见但无持久化——session 结束后不可回溯
- `nano_usage_events` D1 表记录的是业务 quota 消费，不是系统错误

**标准格式**——**部分存在**：
- **Facade Error Envelope 格式是标准的**（`orchestrator-auth-contract/src/facade-http.ts`）：
  ```json
  { "ok": false, "error": { "code": "device-revoked", "status": 403, "message": "..." }, "trace_uuid": "..." }
  ```
- 但并非全局统一：
  - agent-core HTTP response 不走此格式
  - context-core inspector 返回 `{ error: "..." }` 而非 facade envelope
  - 内部 RPC 使用 nacp-core `Envelope<T>` 格式（不同的 shape）

**错误码查询入口**——**分散在 7 个枚举定义中**：
- `RpcErrorCode`（22 codes）：`packages/nacp-core/src/rpc.ts:49`
- `FacadeErrorCode`（22 codes，含 HTTP status 映射）：`packages/orchestrator-auth-contract/src/facade-http.ts:48`
- `AuthErrorCode`（13 codes）：`packages/orchestrator-auth-contract/src/auth-error-codes.ts:3`
- NACP Error Codes（19 codes）：`packages/nacp-core/src/error-registry.ts:61-88`
- `KernelErrorCode`（6 codes）：`workers/agent-core/src/kernel/errors.ts:12`
- `SessionErrorCode`（8 codes）：`packages/nacp-session/src/errors.ts:10`
- `LLMErrorCategory`（8 codes）：`workers/agent-core/src/llm/errors.ts:10`

**不存在**：
1. 一份统一的 `docs/api/error-codes.md` 列出所有 error code 及其 HTTP status、含义、前端处理建议
2. `/debug/errors` 或 `/catalog/errors` 查询端点
3. Error code 与 HTTP status 的全局映射表（`FacadeErrorCode` 内部有映射，但不覆盖 `KernelErrorCode`、`SessionErrorCode`、`LLMErrorCategory`）

### Q3：NACP 中预留的 log 和 error 部分，所有 worker 是否用上了？如何用上的？是怎么进行埋点的？分别分布在什么 worker 的功能内？

**直接回答：NACP 预留的 log/error 设施大面积未使用。Evidence 四流和 Hook 18 事件有部分使用，其余（system.error / NacpObservabilityEnvelope / metric emit）为零使用。**

**分项审计**：

#### 3.1 `system.error` message type — ❌ 零使用

- **定义位置**：`packages/nacp-core/src/messages/system.ts:16` — `SystemErrorBodySchema { error: NacpErrorSchema, context? }`
- **注册状态**：已注册到 `SESSION_MESSAGE_TYPES`，`delivery_kind: "error"` 对 `system.error` 合法
- **使用状态**：**全部 6 worker 中没有任何代码构造 `{ kind: "system.error", error: ... }` 帧**。所有运行时错误走 console.warn 或 facade error envelope
- **原因**：没有 `emitSystemError()` helper、没有 `onError` wiring、没有从 console.warn → system.error frame 的桥接

#### 3.2 `NacpObservabilityEnvelope` — ❌ 零使用

- **定义位置**：`packages/nacp-core/src/observability/envelope.ts`
- **定义内容**：`{ source_worker, source_role, alerts: NacpAlertPayload[] (含 severity: info|warning|error|critical + scope + trace_uuid), metrics: Record<string, number>, traces: Record<string, unknown> }`
- **使用状态**：**零 consumer** — 没有 worker 构造、填充、或发送此 envelope。它只是一个 TypeScript interface，没有配对的 `emitObservabilityEnvelope()` 函数、没有 transport binding（R2/KV/D1 sink）、没有 collector worker

#### 3.3 Evidence 四流 — ⚠️ 部分使用

**assembly evidence**：
- **使用方**：`context-core/src/evidence-emitters-context.ts` 和 `packages/workspace-context-artifacts/src/evidence-emitters.ts`（重复实现）
- **触发点**：`buildAssemblyEvidence()` → `emitAssemblyEvidence()` → duck-typed `EvidenceSinkLike.emit()`
- **当前 sink**：agent-core 的 `session-do-runtime.ts` 中的 in-memory bounded eval sink（用于评估，非业务持久化）

**compact evidence**：
- **使用方**：同上两文件
- **触发点**：compact 生命周期的 4 个阶段（request / response / boundary / error）

**artifact evidence**：
- **使用方**：`filesystem-core`
- **触发点**：文件生命周期各阶段

**snapshot evidence**：
- **使用方**：同上
- **触发点**：snapshot capture / restore 阶段

**评价**：Evidence 是 nano-agent 目前唯一真正在使用中的结构化可观测性通道。但：
- 证据 emitter 在两个包中重复实现（代码复制而非共享）
- Sink 仅是 in-memory eval sink，不做持久化
- 没有 `GET /sessions/{id}/evidence` 查询端点供前端消费

#### 3.4 Hook 18 事件 — ⚠️ wiring 就位，handler 未注入

- **定义**：`packages/nacp-core/src/hooks-catalog/index.ts`（18 个事件，各个有 typed payload schema）
- **RH1 完成的工作**：`scheduler.ts` 产生 `hook_emit` 决策 → `runtime-mainline.ts` 的 `hook.emit` 调用 `HookDispatcher`
- **未完成的工作**：**NanoSessionDO 没有把 `HookDispatcher` 实例注入 `createMainlineKernelRunner`**。这意味着 `PreToolUse` / `SessionStart` 等 hook 事件虽然可以被 dispatcher 路由，但实际的 handler（如 `emitPermissionRequestAndAwait`）未注册到 dispatcher 上
- **结果**：Hook 机制在代码层面存在（scheduler → dispatcher → handler 三层），但 handler 注册表是空的

#### 3.5 Metric Names — ❌ 零 emit

- **定义**：`workers/agent-core/src/eval/metric-names.ts` — 11 个 metric name 字符串常量
- **使用状态**：**没有 counter、histogram、gauge 实例被创建或记录任何值**。这些只是字符串常量，不在任何 OTel SDK 或 custom metrics pipeline 中
- **重复定义**：`packages/eval-observability/src/metric-names.ts` 中有完全相同的常量（代码复制）

#### 3.6 Trace Events — ⚠️ builder 存在，但无 span 概念

- **定义**：`packages/eval-observability/src/trace-event.ts:33-51` — `TraceEventBase`（16 字段含 `error?: { code, message }`）
- **Builder**：`workers/agent-core/src/host/traces.ts` — `buildTurnBeginTrace()` / `buildTurnEndTrace()` / `buildSessionEndTrace()` / `buildStepTrace()`
- **Gap**：这些 builder 构造的是平面 trace event 对象，不是 OpenTelemetry span。没有 parent/child span hierarchy，没有 `startSpan()` / `endSpan()` lifecycle management，没有 `AsyncLocalStorage` 上下文传播
- **对比**：Claude Code 的 `sessionTracing.ts`（927 行）完全实现了 OTel span 的 `startInteractionSpan` → `startLLMRequestSpan` → `startToolSpan` 层次化追踪

---

## 4. 盲点、断点、逻辑错误、事实认知混乱的完整清单

### 4.1 致命盲点（Critical Blind Spots）

| 编号 | 盲点 | 影响 | 三家 CLI Agent 的做法 |
|------|------|------|----------------------|
| B1 | **bash-core 和 orchestrator-auth 完全静默**（0 次 console 调用） | 运行时错误（bash 执行失败、JWT 验证失败、wechat code 交换失败）零取证能力，只能依赖 `wrangler tail` | 三家均有每一层操作的日志记录 |
| B2 | **无持久化错误存储** | session 结束后的错误不可回溯，D1 故障期间的错误全部丢失 | Claude Code JSONL 文件 + Codex SQLite + Gemini CLI GCP Cloud Logging |
| B3 | **agent-core 不返回 facade envelope 格式** | 前端无法在 agent-core 直连路径（HTTP controller）上获取标准 `trace_uuid` + `error.code` | 三家均有统一的 error envelope |
| B4 | **无 API 请求/响应日志** | 前端无法了解任何请求的耗时、中间状态、retry 次数。debug 只能靠 curl + 肉眼 | 三家均记录完整的请求/响应遥测 |

### 4.2 结构性断点（Structural Breakpoints）

| 编号 | 断点 | 位置 | 事实 |
|------|------|------|------|
| P1 | **`NacpObservabilityEnvelope` 完全孤立** | `packages/nacp-core/src/observability/envelope.ts` | 定义好了 alerts / metrics / traces 三字段，但无 worker 构造、无 transport、无 collector |
| P2 | **`system.error` 连到 no-op** | `packages/nacp-core/src/messages/system.ts:16` | 消息类型注册了、schema 定义好了，但 emit 路径不存在——代码中没有任何 `{ kind: "system.error", error: {...} }` 构造 |
| P3 | **Metric names → 零 emit** | `agent-core/src/eval/metric-names.ts` | 11 个 metric name 定义，但没有任何 counter/histogram 实例，不在任何 metrics pipeline 中 |
| P4 | **Evidence sink → in-memory only** | `agent-core/src/host/do/session-do-runtime.ts` | Evidence 记录写入内存 eval sink，不做持久化，session 结束后不可查询 |
| P5 | **Hook handler 注册表为空** | `NanoSessionDO` → `createMainlineKernelRunner` | Dispatcher wiring 就位（RH1），但 handler 实例未注入——18 个 hook 事件无法触发任何实际行为 |
| P6 | **Console → protocol 无桥接** | 全部 6 worker | 31 次 console.warn 走 worker stdout，不能变成 `system.error` frame 或 `NacpObservabilityEnvelope.alerts` |
| P7 | **trace_uuid 在 agent-core HTTP response 中缺失** | `agent-core/src/http-controller.ts` | 与 facade envelope 格式不一致；orchestrator-core 在 facade 层做了兼容包装，但 agent-core 自身路径无此保证 |

### 4.3 代码层面的逻辑错误与重复

| 编号 | 问题 | 位置 | 细节 |
|------|------|------|------|
| E1 | **`StorageError` 家族重复定义** | `workers/filesystem-core/src/storage/errors.ts` + `packages/storage-topology/src/errors.ts` | `StorageError` / `ValueTooLargeError` / `CursorRequiredError` / `StorageNotConnectedError` 完全相同的四个类，在两个包中各自定义 |
| E2 | **Evidence emitters 重复实现** | `workers/context-core/src/evidence-emitters-context.ts` + `packages/workspace-context-artifacts/src/evidence-emitters.ts` | `buildAssemblyEvidence` / `buildCompactEvidence` / `buildSnapshotEvidence` 近乎相同的实现 |
| E3 | **Metric names 重复定义** | `workers/agent-core/src/eval/metric-names.ts` + `packages/eval-observability/src/metric-names.ts` | 完全相同的 11 个 metric name 常量 |
| E4 | **`console.log("usage-commit", ...)` 走错通道** | `workers/agent-core/src/host/do/session-do/runtime-assembly.ts:132` | Quota 消费是业务可观测事件，应用 evidence 或 telemetry 通道，不应走 dev-only console.log |
| E5 | **orchestrator-core surface route 使用 ad-hoc 错误字符串** | `workers/orchestrator-core/src/index.ts` 多处 | `"wrong-device"` / `"session-pending-only-start-allowed"` / `"agent-rpc-unavailable"` 等不走 `RpcErrorCode` 或 `FacadeErrorCode` 枚举 |
| E6 | **bash-core 完全不走 nacp-core 错误体系** | `workers/bash-core/src/executor.ts` / `fake-bash/bridge.ts` | 8 个 ad-hoc 字符串错误码（`"empty-command"` / `"handler-error"` 等），与 nacp-core 的 22 RpcErrorCode 体系完全脱钩 |

### 4.4 事实认知混乱（给后续开发者的误导）

| 编号 | 混乱 | 影响 |
|------|------|------|
| C1 | **"Evidence 系统已经可用"**——实际上 evidence 只在 eval context 中使用，不做业务持久化，前端无法查询 | 前端团队会以为 `GET /sessions/{id}/evidence` 存在，实际不存在 |
| C2 | **"NACP 协议已完成 log/error 预留"**——预留是预留了（schema defined），但 runtime 路径不存在（zero consumer） | 新开发者会以为 `system.error` 帧可以被 client 收到，实际不会 |
| C3 | **"trace_uuid 全链路覆盖"**——HTTP 路径覆盖了，但 agent-core 自身的 response 不包含 | 前端在 agent-core 直连时拿不到 trace_uuid |
| C4 | **"错误码体系完整"**——枚举定义完整，但实际代码中大量使用 ad-hoc 字符串绕过枚举 | 前端无法建立 error code → handler 的映射表 |
| C5 | **`NacpObservabilityEnvelope` 的存在**——这个 interface 给了人"我们有一个可观测性通道"的错觉，实际上它没有 transport、没有 collector、没有 emit path | 架构讨论中可能被引用为"已有设施"，但实际不可用 |

---

## 5. 修复路线建议

### 5.1 立即修复（前端 debug 硬依赖，RH3 前完成）

| 优先级 | 修复项 | 工作量 | 说明 |
|--------|--------|--------|------|
| **P0** | **统一的 facade error envelope 格式** | S | agent-core HTTP response 改为 facade envelope 格式（`{ ok, data/error, trace_uuid }`）；context-core inspector 返回改为 facade error envelope |
| **P0** | **`docs/api/error-codes.md`** | S | 一份文档列出全部 98+ error codes（Rpc 22 + NACP 19 + Auth 13 + Kernel 6 + Session 8 + LLM 8 + facade 22），含 HTTP status 映射 + 含义 + 前端处理建议 |
| **P0** | **bash-core 错误码迁移到 nacp-core** | S | bash-core 的 8 个 ad-hoc 字符串替换为 `RpcErrorCode` 枚举值，或新增 bash-specific 子枚举 |

### 5.2 短期建设（可观测性基础，RH3-RH4 完成）

| 优先级 | 建设项 | 工作量 | 说明 |
|--------|--------|--------|------|
| **P1** | **`system.error` 帧的 emit path** | M | 在 orchestrator-core 添加 `emitSystemError(code, message, context)` helper；所有 console.warn 在 D1/RPC 失败时同步 emit `system.error` 帧到 attached WS client |
| **P1** | **Structured logger（替换裸 console）** | M | 6 worker 统一的 `createLogger(workerName)` → `{ debug, info, warn, error }` → 同时写 console + 推 `system.notify` WS 帧 |
| **P1** | **错误持久化到 D1** | M | 新建 `migration 011-error-log.sql` — `nano_error_log` 表（trace_uuid, session_uuid, worker, code, message, context JSON, created_at）；`emitSystemError` 同时写 D1 |
| **P2** | **`GET /debug/logs?trace_uuid=xxx`** | S | 前端按 trace_uuid 查询错误日志的调试端点 |
| **P2** | **消除重复定义** | S | 合并 `StorageError` 家族到单一包；合并 `evidence-emitters` 到单一包；合并 `metric-names` 到单一包 |

### 5.3 中长期建设（对标三家 CLI Agent，RH5-RH6+）

| 优先级 | 建设项 | 工作量 | 对标 |
|--------|--------|--------|------|
| **P3** | **OTel-compatible metrics pipeline** | L | Codex 的 `MetricsClient`（counters + histograms）|
| **P3** | **Span-based tracing** | L | Claude Code 的 `sessionTracing.ts`（interaction/llm/tool/hook 四层 span + ALS 上下文）|
| **P3** | **`NacpObservabilityEnvelope` 激活** | M | 给 envelope 配 transport（R2 batch upload 或 OTLP export）+ collector worker |
| **P3** | **Log 持久化 + 查询** | L | Codex 的 SQLite log_db（128-entry batch + 10 天 retention + LogQuery API）|
| **P4** | **性能监控** | M | Gemini CLI 的 `MemoryMonitor` + `EventLoopMonitor` + `StartupProfiler`（Cloudflare Workers 有 CPU time / subrequest limit 的对应指标）|

---

## 6. 附录：完整错误码速查表（供 `docs/api/error-codes.md` 起草）

### 6.1 RpcErrorCode（22 codes）— `packages/nacp-core/src/rpc.ts:49`

| Code | 含义 | HTTP Status |
|------|------|-------------|
| `invalid-request` | RPC 请求格式不符合 schema | 400 |
| `invalid-input` | RPC 输入参数 schema 校验失败 | 400 |
| `invalid-meta` | RPC meta 参数 schema 校验失败 | 400 |
| `invalid-trace` | trace_uuid 格式无效 | 400 |
| `invalid-authority` | authority 凭证无效 | 401 |
| `invalid-caller` | caller 身份非法 | 403 |
| `invalid-session` | session_uuid 无效或不存在 | 404 |
| `invalid-auth` | 认证失败 | 401 |
| `identity-already-exists` | 注册时 identity 已存在 | 409 |
| `identity-not-found` | 登录时 identity 不存在 | 404 |
| `password-mismatch` | 密码不匹配 | 401 |
| `refresh-invalid` | refresh token 无效 | 401 |
| `refresh-expired` | refresh token 过期 | 401 |
| `refresh-revoked` | refresh token 已吊销 | 401 |
| `invalid-wechat-code` | 微信 code 无效 | 400 |
| `invalid-wechat-payload` | 微信返回 payload 无效 | 502 |
| `permission-denied` | 权限不足 | 403 |
| `binding-scope-forbidden` | service binding 越权调用 | 403 |
| `tenant-mismatch` | team_uuid 不匹配 | 403 |
| `authority-escalation` | authority 提权尝试 | 403 |
| `not-found` | 资源不存在 | 404 |
| `conflict` | 资源冲突 | 409 |
| `session-not-running` | session 不在 running 状态 | 409 |
| `session-already-ended` | session 已结束 | 410 |
| `worker-misconfigured` | worker 配置错误 | 500 |
| `rpc-parity-failed` | RPC parity bridge 检测到不一致 | 500 |
| `upstream-timeout` | 上游超时 | 504 |
| `rate-limited` | 频率限制 | 429 |
| `not-supported` | 功能不支持 | 501 |
| `internal-error` | 内部错误 | 500 |

### 6.2 NACP Error Codes（19 codes）— `packages/nacp-core/src/error-registry.ts:61-88`

| Code | 含义 |
|------|------|
| `NACP_VALIDATION_FAILED` | NACP 消息 schema 校验失败 |
| `NACP_UNKNOWN_MESSAGE_TYPE` | 未知消息类型 |
| `NACP_SIZE_EXCEEDED` | 消息大小超限 |
| `NACP_VERSION_INCOMPATIBLE` | NACP 版本不兼容 |
| `NACP_TYPE_DIRECTION_MISMATCH` | 消息方向不匹配 |
| `NACP_DEADLINE_EXCEEDED` | 消息处理超时 |
| `NACP_IDEMPOTENCY_CONFLICT` | 幂等性冲突 |
| `NACP_CAPABILITY_DENIED` | 能力拒绝 |
| `NACP_RATE_LIMITED` | 频率限制 |
| `NACP_BINDING_UNAVAILABLE` | service binding 不可用 |
| `NACP_HMAC_INVALID` | HMAC 签名无效 |
| `NACP_TIMESTAMP_SKEW` | 时间戳偏差过大 |
| `NACP_TENANT_MISMATCH` | 租户不匹配 |
| `NACP_TENANT_BOUNDARY_VIOLATION` | 跨租户访问 |
| `NACP_TENANT_QUOTA_EXCEEDED` | 租户配额超限 |
| `NACP_DELEGATION_INVALID` | 委托无效 |
| `NACP_STATE_MACHINE_VIOLATION` | 状态机违规 |
| `NACP_REPLY_TO_CLOSED` | 向已关闭通道回复 |
| `NACP_PRODUCER_ROLE_MISMATCH` | 生产者角色不匹配 |
| `NACP_REPLAY_OUT_OF_RANGE` | replay 序列号超出范围 |

### 6.3 KernelErrorCode（6 codes）— `workers/agent-core/src/kernel/errors.ts:12`

| Code | 含义 |
|------|------|
| `ILLEGAL_PHASE_TRANSITION` | 非法阶段转换 |
| `TURN_ALREADY_ACTIVE` | turn 已激活 |
| `TURN_NOT_FOUND` | turn 未找到 |
| `STEP_TIMEOUT` | step 超时 |
| `KERNEL_INTERRUPTED` | kernel 被中断 |
| `CHECKPOINT_VERSION_MISMATCH` | checkpoint 版本不匹配 |

### 6.4 SessionErrorCode（8 codes）— `packages/nacp-session/src/errors.ts:10`

| Code | 含义 |
|------|------|
| `NACP_SESSION_INVALID_PHASE` | session 阶段无效 |
| `NACP_SESSION_AUTHORITY_REQUIRED` | 需要 authority |
| `NACP_SESSION_FORGED_AUTHORITY` | authority 伪造 |
| `NACP_REPLAY_OUT_OF_RANGE` | replay 超出范围 |
| `NACP_SESSION_ACK_MISMATCH` | ACK 不匹配 |
| `NACP_SESSION_HEARTBEAT_TIMEOUT` | 心跳超时 |
| `NACP_SESSION_ALREADY_ATTACHED` | session 已 attach |
| `NACP_SESSION_TYPE_DIRECTION_MISMATCH` | 消息方向不匹配 |

---

*研究完成于 2026-04-29。本报告为独立研究，不参考 GPT / GLM / Kimi 既有分析。*
