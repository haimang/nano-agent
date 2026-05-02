# Codex LLM Wrapper vs nano-agent API Gap Analysis

> **Scope**: `context/codex` LLM wrapper 体系对标 nano-agent LLM wrapper  
> **Principle**: 逐条真实代码引用，定位缺口文件/行号，不比较功能多少，只判断是否阻塞前端运行  
> **Date**: 2026-05-02

---

## 1. 评估方法与免责声明

本次调查不是"nano-agent vs Codex CLI 功能对标"，而是以 Codex 成熟的 LLM wrapper 为**透镜**，审视 nano-agent 的 LLM wrapper 系统是否足以支撑一个**可运行的前端**完成完整的 agent loop 生命周期。

结论分为三类：
- **(GAP)** — 确实缺失，前端会因该缺口而无法完成某个业务流程
- **(WEAK)** — 已有但不足，前端可能在边界场景出错或体验降级
- **(OK)** — 已覆盖，Codex 有的等价物 nano-agent 已经提供

---

## 2. 两套系统的架构概览

### 2.1 Codex LLM Wrapper 分层

```
ModelProviderInfo (config)     → 用户可配置提供者
  ↓ to_api_provider()
Provider (codex-api)           → HTTP endpoint + retry + timeout
  ↓
EndpointSession<T,A>           → HTTP/WS transport + auth + retry telemetry
  ↓
HttpTransport (trait)          → raw HTTP I/O (ReqwestTransport)
  ↓
ResponsesClient / WebsocketClient → 协议层 (SSE / WS)
  ↓
ModelClient / ModelClientSession → 会话编排 + incremental + sticky routing
```

关键源码路径：
- `context/codex/codex-rs/model-provider-info/src/lib.rs:75-124` — `ModelProviderInfo` 定义
- `context/codex/codex-rs/codex-api/src/provider.rs` — `Provider` (base url, headers, retry, timeout)
- `context/codex/codex-rs/codex-client/src/retry.rs:8-47` — `RetryPolicy` + 指数退避 + jitter
- `context/codex/codex-rs/codex-client/src/transport.rs` — `HttpTransport` trait
- `context/codex/codex-rs/codex-api/src/common.rs:67-96` — `ResponseEvent` 枚举 (14 variants)
- `context/codex/codex-rs/protocol/src/protocol.rs:2075-2246` — `TokenUsage` + `TokenUsageInfo` + `percent_of_context_window_remaining()`
- `context/codex/codex-rs/protocol/src/protocol.rs:1392-1600` — `EventMsg` 枚举 (60+ variants)
- `context/codex/codex-rs/core/src/context_manager/history.rs` — `ContextManager` token 估算

### 2.2 nano-agent LLM Wrapper 分层

```
ProviderProfile (registry)     → 提供者元数据
ModelCapabilities (registry)   → 模型能力描述
  ↓ buildExecutionRequest()
ExecutionRequest               → canonical request + validated provider/model
  ↓
WorkersAiGateway               → platform-native AI binding (CF Workers AI)
LLMExecutor                    → generic HTTP fetch + retry + SSE parsing
  ↓
ChatCompletionAdapter          → provider-specific HTTP ↔ canonical translation
  ↓
NormalizedLLMEvent             → 5 canonical event types
  ↓
SessionStreamEventBodySchema   → 13 client-facing stream kinds
```

关键源码路径：
- `workers/agent-core/src/llm/index.ts:1-84` — 公共 API surface
- `workers/agent-core/src/llm/canonical.ts:1-129` — 规范类型 (5 events)
- `workers/agent-core/src/llm/gateway.ts:1-347` — `WorkersAiGateway`
- `workers/agent-core/src/llm/executor.ts:1-327` — `LLMExecutor` (HTTP retry)
- `workers/agent-core/src/llm/errors.ts:1-47` — `LlmWrapperError`
- `workers/agent-core/src/llm/usage.ts:1-32` — `LLMUsage` (4 fields)
- `workers/agent-core/src/llm/stream-normalizer.ts:1-26` — chunk → event
- `workers/agent-core/src/llm/session-stream-adapter.ts:1-101` — event → NACP body
- `packages/nacp-session/src/stream-event.ts:1-180` — 13 stream kinds
- `workers/agent-core/src/host/runtime-mainline.ts:445-870` — `createMainlineKernelRunner`

---

## 3. 逐项缺口分析

### 3.1 推理 (Reasoning / Thinking) 内容流

#### Codex 现状

Codex 对推理内容有三种事件粒度：
- `ReasoningContentDelta { delta, content_index }` — 原始推理文本增量
- `ReasoningSummaryDelta { delta, summary_index }` — 推理摘要增量
- `ReasoningSummaryPartAdded { summary_index }` — 新摘要片段

源码：`context/codex/codex-rs/codex-api/src/common.rs:82-93`

推理配置支持 effort (6 levels) + summary (3 modes)：
```rust
pub struct Reasoning {
    pub effort: Option<ReasoningEffortConfig>,   // None/Minimal/Low/Medium/High/XHigh
    pub summary: Option<ReasoningSummaryConfig>,  // Auto/Detailed/None
}
```
源码：`context/codex/codex-rs/codex-api/src/common.rs:98-104`

推理 token 被独立追踪：
```rust
pub struct TokenUsage {
    pub reasoning_output_tokens: i64,  // 推理专属 token
    // ...
}
```
源码：`context/codex/codex-rs/protocol/src/protocol.rs:2083`

`ServerReasoningIncluded(bool)` 告诉客户端服务器已经清算了历史推理 token，无需重复估算。
源码：`context/codex/codex-rs/codex-api/src/common.rs:74-77`

#### nano-agent 现状

推理配置仅支持 effort（无 summary）：
```typescript
// workers/agent-core/src/llm/canonical.ts:99-101
export interface CanonicalLLMRequest {
  readonly reasoning?: { readonly effort: "low" | "medium" | "high" };
}
```

ModelCapabilities 有 `reasoningEfforts` 但无 `default_reasoning_level`、`supports_reasoning_summaries`：
```typescript
// workers/agent-core/src/llm/registry/models.ts (via gateway.ts:35-41)
supportsReasoning: true,
reasoningEfforts: ["low", "medium", "high"],
```

LLMUsage 无 `reasoningOutputTokens`：
```typescript
// workers/agent-core/src/llm/usage.ts:14-21
export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}
```

`LlmDeltaKind` 的 `content_type` 包含 `"thinking"`，但实际映射未区分推理和普通文本：
```typescript
// packages/nacp-session/src/stream-event.ts:121-126
content_type: z.enum(["text", "thinking", "tool_use_start", "tool_use_delta"])
```

`session-stream-adapter.ts` 将所有 delta 映射为 `content_type: "text"`：
```typescript
// workers/agent-core/src/llm/session-stream-adapter.ts:58-62
case "delta": {
  const body = {
    kind: "llm.delta",
    content_type: "text" as const,  // ← 硬编码 text，不区分 thinking vs text
    content: event.content,
    is_final: false,
  };
```

`runtime-mainline.ts` 对所有 delta 一视同仁：
```typescript
// workers/agent-core/src/host/runtime-mainline.ts:479-483
case "delta":
  yield {
    type: "content" as const,
    content: event.content,
  };
```

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **Reasoning content 流式推送** | **GAP** | `content_type: "thinking"` 在 schema 中已定义 (`stream-event.ts:123`)，但实际 LLM wrapper 不会产生该类型。`session-stream-adapter.ts:61` 将所有 delta 硬编码为 `"text"`；`runtime-mainline.ts:480` 将所有 delta 归为 `type: "content"`。前端即使监听 `content_type: "thinking"` 也永远不会收到。 |
| **Reasoning summary 支持** | **GAP** | 完全缺失。`CanonicalLLMRequest` 无 summary 字段。前端无法展示推理摘要。 |
| **Reasoning token 独立追踪** | **GAP** | `LLMUsage` 仅有 `inputTokens / outputTokens / totalTokens`，无 `reasoningOutputTokens`。前端无法展示推理 token 消耗。 |
| **ServerReasoningIncluded** | **GAP** | 无等价机制。多轮对话中无法判断服务器是否已为历史推理买单。 |

---

### 3.2 Token 追踪体系

#### Codex 现状

Token 追踪有五个层次：

**(a) 服务器返回的 TokenUsage** — 5 字段：
```rust
pub struct TokenUsage {
    pub input_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_output_tokens: i64,
    pub total_tokens: i64,
}
```
源码：`context/codex/codex-rs/protocol/src/protocol.rs:2075-2086`

**(b) 累积 TokenUsageInfo** — 跨 turn 累加：
```rust
pub struct TokenUsageInfo {
    pub total_token_usage: TokenUsage,   // 全会话累计
    pub last_token_usage: TokenUsage,    // 上一 turn
    pub model_context_window: Option<i64>,
}
```
源码：`context/codex/codex-rs/protocol/src/protocol.rs:2089-2095`

**(c) 上下文窗口剩余 %** — 减去 12000 baseline tokens：
```rust
pub fn percent_of_context_window_remaining(&self, context_window: i64) -> i64 {
    let effective_window = context_window - BASELINE_TOKENS; // 12000
    let used = (self.total_tokens - BASELINE_TOKENS).max(0);
    let remaining = (effective_window - used).max(0);
    ((remaining as f64 / effective_window as f64) * 100.0).clamp(0.0, 100.0).round() as i64
}
```
源码：`context/codex/codex-rs/protocol/src/protocol.rs:2191-2236`

**(d) 客户端 token 估算** — byte-based heuristic：
```rust
// context/codex/codex-rs/core/src/context_manager/history.rs:136-150
pub(crate) fn estimate_token_count(&self, turn_context: &TurnContext) -> Option<i64> {
    // ~4 bytes per token heuristic
    // image: 7373 bytes per resized image
    // reasoning encrypted content: encoded_len * 3/4 - 650
}
```

**(e) TokenCountEvent** — 流中推送：
```rust
pub struct TokenCountEvent {
    pub info: Option<TokenUsageInfo>,
    pub rate_limits: Option<RateLimitSnapshot>,
}
```
源码：`context/codex/codex-rs/protocol/src/protocol.rs:2156-2159`

#### nano-agent 现状

```typescript
// workers/agent-core/src/llm/usage.ts:14-21
export interface LLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheCreationTokens?: number;  // 可选，从未填充
  readonly cacheReadTokens?: number;      // 可选，从未填充
  readonly totalTokens: number;
}
```

累积追踪发生在 kernel/orchestrator 层（quota commit），不在 LLM wrapper 层：
```typescript
// workers/agent-core/src/host/runtime-mainline.ts:830-865
afterLlmInvoke: async ({ turnId, usage }) => {
  const balance = await options.quotaAuthorizer.commit("llm", context, requestId, {
    input_tokens: usage?.inputTokens ?? 0,
    output_tokens: usage?.outputTokens ?? 0,
    // ...
  });
```

流中没有 token count 事件。`NormalizedLLMEvent` 只有：
```typescript
// workers/agent-core/src/llm/canonical.ts:122-128
export type NormalizedLLMEvent =
  | RequestStartedEvent
  | DeltaEvent
  | ToolCallEvent
  | FinishEvent      // ← finish 携带 usage
  | ErrorEvent;
```

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **流中推送 TokenCount** | **GAP** | `NormalizedLLMEvent` 无 token count 事件类型。前端只能在 turn.end 时拿到 usage，无法实时展示 token 消耗。Codex 在 `TokenCountEvent` 中推送全会话累计 + rate limits。 |
| **Cached input token 追踪** | **GAP** | `cacheCreationTokens` / `cacheReadTokens` 在 `LLMUsage` 中定义为 optional，但 Workers AI binding 从不填充。无法告知前端 "本次复用了 X tokens 缓存"。 |
| **跨 turn 累计 token** | **WEAK** | 累计在 quota authorizer 层 (`runtime-mainline.ts:830-865`)，不在 LLM wrapper 层。LLM wrapper 的 `FinishEvent` 仅携带单次 usage。前端如需累积值需额外 API 查询。 |
| **Context window %** | **GAP** | 无 `percent_of_context_window_remaining()` 等价计算。Compact signal 在 `runtime-assembly.ts:292-312` 有自定义计算，但那是内部信号，不推送给前端。 |
| **客户端 token 估算** | **GAP** | 完全依赖服务器返回的 usage。如果 Workers AI 不返回 usage（已知某些模型不返回），前端将无法展示任何 token 信息。Codex 有 fallback 估算机制。 |

---

### 3.3 流错误恢复与重试

#### Codex 现状

Codex 对 SSE 流错误有专门的错误分类和重试机制：

**(a) SSE 错误分类** — 在 `process_responses_event()` 中：
- `context_length_exceeded` → `ApiError::ContextWindowExceeded`
- `insufficient_quota` → `ApiError::QuotaExceeded`
- `usage_not_included` → `ApiError::UsageNotIncluded`
- `invalid_prompt` → `ApiError::InvalidRequest`
- `server_is_overloaded` / `slow_down` → `ApiError::ServerOverloaded`
- `rate_limit_exceeded` → `ApiError::Retryable` with parsed delay

源码：`context/codex/codex-rs/codex-api/src/sse/responses.rs`

**(b) 流重试** — 最多 5 次：
```rust
// context/codex/codex-rs/model-provider-info/src/lib.rs:26-27
const DEFAULT_STREAM_MAX_RETRIES: u64 = 5;
const DEFAULT_REQUEST_MAX_RETRIES: u64 = 4;
```

**(c) 流 idle timeout** — 300 秒无活动则断连重试：
```rust
// context/codex/codex-rs/model-provider-info/src/lib.rs:25
const DEFAULT_STREAM_IDLE_TIMEOUT_MS: u64 = 300_000;
```

**(d) 流错误通知** — 通过 `StreamErrorEvent` 告知客户端：
```rust
// context/codex/codex-rs/protocol/src/protocol.rs:1529
StreamError(StreamErrorEvent),
```

**(e) Auth 错误恢复** — `handle_unauthorized()` 尝试一次 token 刷新后重试：
源码：`context/codex/codex-rs/core/src/client.rs`

#### nano-agent 现状

`LLMExecutor.executeStream()` **没有重试循环**：
```typescript
// workers/agent-core/src/llm/executor.ts:133-215
async *executeStream(exec: ExecutionRequest): AsyncGenerator<NormalizedLLMEvent> {
  const url = `${exec.provider.baseUrl}/chat/completions`;
  // ... build request ...
  yield { type: "llm.request.started", requestId, modelId: exec.request.model };
  const response = await this.fetchWithTimeout(url, { /* ... */ });
  // ↑ 如果这里失败，直接 throw，不会重试
```

`WorkersAiGateway.executeStream()` 同样没有重试（catch 后 yield error 然后 return）：
```typescript
// workers/agent-core/src/llm/gateway.ts:176-218
} catch (error) {
  yield {
    type: "error",
    error: { category: "server_error", message: ..., retryable: false, ... }
  };
  return;  // ← 直接退出
}
```

workers-ai adapter 有 model fallback 循环但无流重试：
```typescript
// workers/agent-core/src/llm/adapters/workers-ai.ts:282-307
for (const model of modelIds) {
  try {
    const response = await ai.run(model, payload);
    // ... parse stream ...
    return;
  } catch (error) {
    lastError = error;  // ← 不重试同一模型的流，只尝试下一个模型
  }
}
```

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **流错误分类** | **WEAK** | `LLMExecutor.classifyHttpError()` (`executor.ts:209-225`) 仅通过 HTTP status code 分类（401/403 → auth, 429 → rate_limit, 500+ → server_error），不解析 SSE 错误码或 response body。无法区分 `context_length_exceeded` 和 generic server error。 |
| **流重试** | **GAP** | `executeStream()` 一次失败即终止整个 turn。前端会遇到 "turn 失败" 而不是 "模型重试中"。Codex 在 `StreamErrorEvent` 中展示重试进度。 |
| **流 idle timeout** | **GAP** | 仅有总 timeout（`executor.ts:42: DEFAULT_TIMEOUT_MS = 60_000`）。如果 LLM 在生成中途卡住（不发 token 但不断连），nano-agent 要等到 60s 全局超时才报错，而 Codex 300s 无活动后会重连。 |
| **Auth 刷新** | **GAP** | 无 token 刷新机制。`ProviderProfile` 的 API key 是静态字符串。如果 auth 过期，前端看到的只是永久性 `auth_error`，无法自动恢复。 |
| **Rate limit snapshot 推送** | **GAP** | 无 `RateLimitSnapshot` 等价物。前端无法展示 "已用 X% 的速率配额"。 |

---

### 3.4 模型目录与选择

#### Codex 现状

**(a) 远程模型目录刷新** — ETag 缓存，TTL=300s：
```rust
// context/codex/codex-rs/models-manager/src/manager.rs
pub enum RefreshStrategy { Online, Offline, OnlineIfUncached }
// GET /models with ETag, cache on disk
```

**(b) 模型 slug 解析** — 最长前缀匹配 + 命名空间剥离：
```rust
// context/codex/codex-rs/models-manager/src/manager.rs
pub fn get_model_info(&self, slug: &str) -> CodexResult<Cow<'_, ModelInfo>>
// "custom/gpt-5.3-codex" → strip "custom/" → exact match "gpt-5.3-codex"
```

**(c) 未知模型的 fallback metadata**：
```rust
// context/codex/codex-rs/models-manager/src/model_info.rs
pub fn model_info_from_slug(slug: &str) -> ModelInfo {
    // conservative defaults: 272K context, no reasoning, no personality
}
```

**(d) 模型 reroute 检测** — 服务器可能覆盖请求的模型：
```rust
// context/codex/codex-rs/codex-api/src/common.rs:73
ServerModel(String),  // from openai-model header
// context/codex/codex-rs/protocol/src/protocol.rs:1417
ModelReroute(ModelRerouteEvent),
```

**(e) 模型 preset 系统** — 可过滤、可标记默认、协作模式：
```rust
// context/codex/codex-rs/protocol/src/openai_models.rs
pub struct ModelPreset { slug, visibility, ... }
```

#### nano-agent 现状

模型目录来自 D1（`nano_models` 表），无远程刷新：
```typescript
// workers/agent-core/src/llm/gateway.ts:62-80
export async function loadWorkersAiModelCapabilities(db: D1Database): Promise<ModelCapabilities[]> {
  const rows = await db.prepare(
    `SELECT model_id, context_window, is_reasoning, is_vision, is_function_calling
       FROM nano_models WHERE status = 'active' ORDER BY model_id ASC`,
  ).all();
```

模型 ID 从消息中推断或硬编码 fallback：
```typescript
// workers/agent-core/src/llm/gateway.ts:119-133
function inferModelId(messages: readonly unknown[], fallback: string | undefined): string | undefined {
  if (fallback) return fallback;
  for (const message of messages) {
    if (!isRecord(message)) continue;
    const value = message.model_id ?? message.modelId;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}
```

硬编码 fallback：
```typescript
// workers/agent-core/src/llm/adapters/workers-ai.ts:8-10
export const WORKERS_AI_PRIMARY_MODEL = "@cf/ibm-granite/granite-4.0-h-micro";
export const WORKERS_AI_FALLBACK_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";
```

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **模型目录远程刷新** | **GAP** | 模型能力完全依赖 D1 种子数据 + 迁移脚本。当 CF Workers AI 新增模型或模型能力变更时，前端看不到新模型，除非运维手动执行 D1 迁移。Codex 有 ETag-based `/models` 轮询。 |
| **模型 slug 解析** | **OK** | 精确匹配即可，nano-agent 的模型 ID 来自 D1 的 `model_id` 列，不存在自定义 slug 需求。 |
| **模型 reroute 检测** | **GAP** | Workers AI binding 不会告知实际使用了哪个模型（尤其在 fallback 场景）。`WorkersAiGateway.executeStream()` 的第一个事件 `llm.request.started` 携带的是请求的 modelId，但如果 Workers AI 内部有路由，前端无法知晓。 |
| **模型 preset / visibility** | **GAP** | 无 preset 系统。前端如果需要展示模型列表，只能依赖 D1 的 `nano_models` 表全量查询，没有 "recommended" / "hidden" / "deprecated" 标记。 |
| **模型目录缓存** | **WEAK** | 每次请求都读 D1 (`gateway.ts:464`)。高并发下 D1 压力大，但这不是 LLM wrapper 的职责——这是 orchestrator / catalog API 的职责。 |

---

### 3.5 Provider 抽象与多提供者支持

#### Codex 现状

Provider 定义完整：
```rust
// context/codex/codex-rs/model-provider-info/src/lib.rs:75-124
pub struct ModelProviderInfo {
    pub name: String,
    pub base_url: Option<String>,
    pub env_key: Option<String>,
    pub auth: Option<ModelProviderAuthInfo>,  // 命令后端 auth
    pub wire_api: WireApi,
    pub http_headers: Option<HashMap<String, String>>,
    pub env_http_headers: Option<HashMap<String, String>>,
    pub request_max_retries: Option<u64>,     // default 4
    pub stream_max_retries: Option<u64>,      // default 5
    pub stream_idle_timeout_ms: Option<u64>,  // default 300s
    pub websocket_connect_timeout_ms: Option<u64>,  // default 15s
    pub requires_openai_auth: bool,
    pub supports_websockets: bool,
}
```

Auth trait：
```rust
// context/codex/codex-rs/codex-api/src/auth.rs
pub trait AuthProvider: Send + Sync {
    fn bearer_token(&self) -> Option<String>;
    fn account_id(&self) -> Option<String>;
}
```

#### nano-agent 现状

ProviderProfile 定义：
```typescript
// workers/agent-core/src/llm/registry/providers.ts (via index.ts exports)
export interface ProviderProfile {
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKeys: readonly string[];
  readonly defaultModel?: string;
  readonly retryConfig?: {
    readonly maxRetries?: number;
    readonly baseDelayMs?: number;
  };
  readonly keyRotationPolicy?: "round-robin" | "on-429";
}
```

多提供者 charter 决策（D5）：**"no multi-provider"**。

DeepSeek adapter 是纯骨架：
```typescript
// workers/agent-core/src/llm/adapters/deepseek/index.ts:7-11
export async function executeDeepSeekSkeleton(_exec: ExecutionRequest): Promise<never> {
  throw new Error(
    "DeepSeek adapter not implemented in zero-to-real first wave; Workers AI remains the only default runtime path.",
  );
}
```

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **多提供者** | **OK (Charter)** | 由 charter 决定（D5），不是缺口而是设计选择。`ProviderRegistry` 的结构支持多提供者，只是业务上不使用。 |
| **Per-provider retry config** | **GAP** | `ProviderProfile.retryConfig` 仅有 `maxRetries` / `baseDelayMs`，没有 `stream_max_retries`、`stream_idle_timeout_ms`、`retry_on` policy。Codex 的 retry 策略更细粒度。 |
| **Auth trait / token refresh** | **GAP** | 无 `AuthProvider` trait、无 token 刷新、无 `handle_unauthorized()`。在生产环境中，API key 可能因轮换失效，静态 key 模式下的 auth 错误无法自动恢复。 |
| **Provider-specific headers** | **GAP** | 无 `http_headers` / `env_http_headers`。某些 provider 需要自定义 header（如 OpenAI-Organization）。 |

---

### 3.6 流事件体系与 Item Projection

#### Codex 现状

Codex 有三层事件体系：

**(a) 低级 ResponseEvent** — 来自 LLM 提供者：
```rust
// context/codex/codex-rs/codex-api/src/common.rs:67-96
pub enum ResponseEvent {
    Created, OutputItemDone(ResponseItem), OutputItemAdded(ResponseItem),
    ServerModel(String), ServerReasoningIncluded(bool),
    Completed { response_id, token_usage },
    OutputTextDelta(String),
    ReasoningSummaryDelta { delta, summary_index },
    ReasoningContentDelta { delta, content_index },
    ReasoningSummaryPartAdded { summary_index },
    RateLimits(RateLimitSnapshot), ModelsEtag(String),
}
```

**(b) 中级 EventMsg** — 会话层（60+ variants）：
包含 `AgentMessage`, `AgentMessageDelta`, `AgentReasoning`, `AgentReasoningDelta`, `TokenCount`, `ModelReroute`, `ContextCompacted`, `TurnStarted`, `TurnComplete`, 等。

**(c) 高级 Item-level** — 对象层：
`ItemStarted` / `ItemCompleted` with `TurnItem` (AgentMessage, Reasoning, WebSearch, ImageGeneration, UserMessage, HookPrompt)。

#### nano-agent 现状

三层事件体系：

**(a) NormalizedLLMEvent** — 5 types：
```typescript
// workers/agent-core/src/llm/canonical.ts:122-128
export type NormalizedLLMEvent =
  | RequestStartedEvent | DeltaEvent | ToolCallEvent | FinishEvent | ErrorEvent;
```

**(b) SessionStreamEventBodySchema** — 13 kinds：
```typescript
// packages/nacp-session/src/stream-event.ts:147-161
ToolCallProgressKind, ToolCallResultKind, ToolCallCancelledKind,
HookBroadcastKind, SessionUpdateKind, TurnBeginKind, TurnEndKind,
CompactNotifyKind, SystemNotifyKind, SystemErrorKind,
LlmDeltaKind, SessionForkCreatedKind, ModelFallbackKind
```

**(c) Item Projection** — 通过 REST API (`/sessions/{id}/items`)：
HPX6 在 `item-projection-plane.ts` 中实现了 Codex-style 的 7-class object layer。

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **流中推送 Item 事件** | **GAP** | Codex 的 `ItemStarted` / `ItemCompleted` 是流事件。nano-agent 的 item projection 是通过 REST API 离线查询的（`item-projection-plane.ts`），不流式推送。前端在对话进行中无法实时获得结构化的 item 列表。 |
| **NormalizedLLMEvent 粒度** | **WEAK** | 5 种类型 vs Codex 14 种 `ResponseEvent`。缺少：`ServerModel`（模型 reroute）、`ServerReasoningIncluded`、`ReasoningContentDelta`、`ReasoningSummaryDelta`、`RateLimits`、`ModelsEtag`。 |
| **Stream events 已覆盖** | **OK** | 13 种 nacp-session stream events 覆盖了核心 agent loop 的客户端通知需求。与 Codex 的 60+ `EventMsg` 不在同一层级比较——Codex 的是 TUI 事件，nano-agent 的是 WebSocket 协议帧。 |
| **llm.delta 的内容区分** | **GAP** | `content_type` 枚举有 `"thinking"` 但从不使用（见 §3.1）。`"tool_use_start"` / `"tool_use_delta"` 虽然存在但从 `session-stream-adapter.ts:67-72` 包装为带 arguments 的复杂 JSON 字符串，前端需要额外解析。 |

---

### 3.7 Context Window 管理与 Compaction

#### Codex 现状

Compaction 是 ModelClient 的一等公民：
```rust
// context/codex/codex-rs/core/src/client.rs
impl ModelClient {
    pub async fn compact_conversation_history(&self) -> Result<ContextCompactedEvent>
    pub async fn summarize_memories(&self) -> Result<MemorySummarizeOutput>
}
```

Context 管理由 `ContextManager` 负责：
- `for_prompt()` — 标准化后发送给模型（删除 ghost snapshots、剥离不支持的 modal、normalize）
- `estimate_token_count()` — byte-based 估算
- `get_total_token_usage()` — 服务器值 + 本地估算的混合计数
- history versioning + rollback

#### nano-agent 现状

Compaction 是由 context-core worker 独立管理的（不在 LLM wrapper 层）：
```typescript
// workers/agent-core/src/host/runtime-mainline.ts:813-817
compact: {
  async requestCompact() {
    return { tokensFreed: 0 };  // ← 占位，实际 compact 走 context-core worker
  },
},
```

Compact signal 在 `runtime-assembly.ts:292-312` 中通过 `composeCompactSignalProbe` 注入，带 circuit breaker（3 次连续失败后抑制 7 分钟）。

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **LLM wrapper 层的 compact** | **OK (architectural)** | Compaction 是 context-core worker 的职责，不在 LLM wrapper。这是有意的架构分离。 |
| **for_prompt 正常化** | **WEAK** | nano-agent 发送消息给 LLM 时不做正常化（删除 ghost items、剥离不支持的模态）。`runtime-mainline.ts:467` 直接构造 `buildWorkersAiExecutionRequestFromMessages({ messages, ... })`，不做预处理。如果消息历史包含已删除的 item ghosts，会被发送给 LLM。 |
| **混合 token 计数** | **GAP** | 无服务器 + 本地估算的混合机制。如果 Workers AI 不返回 usage，前端无法获得任何 token 计数值。 |
| **Memory summarization** | **N/A** | nano-agent charter 范围内不涉及 memory/memories。 |

---

### 3.8 ChatCompletionAdapter 接口完备性

#### nano-agent 现状

```typescript
// workers/agent-core/src/llm/adapters/types.ts:13-22
export interface ChatCompletionAdapter {
  buildRequestBody(exec: ExecutionRequest): unknown;
  buildRequestHeaders(exec: ExecutionRequest): Record<string, string>;
  parseStreamChunk(chunk: string): NormalizedLLMEvent | null;
  parseNonStreamResponse(body: unknown): CanonicalLLMResult;
}
```

#### 判定

| 项目 | 状态 | 理由 |
|------|------|------|
| **Adapter 接口** | **OK** | 4 个方法覆盖了 HTTP chat completion 的完整周期。但如果未来引入 WebSocket transport（如 Codex 的 Responses WS），需要扩展接口。 |
| **OpenAI adapter 实现** | **OK** | `OpenAIChatAdapter` 在 `adapters/openai-chat.ts`（322 行）完整实现了 SSE chunk 解析。 |
| **DeepSeek adapter** | **N/A (Charter)** | 纯骨架实现，不阻塞当前 Workers AI 路线。 |

---

### 3.9 缺失的 NormalizedLLMEvent 类型

对比 Codex `ResponseEvent` 的 14 variants vs nano-agent `NormalizedLLMEvent` 的 5 types：

| Codex ResponseEvent | nano-agent 覆盖 | 说明 |
|---|---|---|
| `Created` | `llm.request.started` | ✅ 等价 |
| `OutputItemDone` | 无 | frontend 需要 item-level 事件 |
| `OutputItemAdded` | 无 | frontend 需要 item-level 事件 |
| `OutputTextDelta` | `delta` | ✅ 等价 |
| `ReasoningContentDelta` | 无 (应用层) | `delta` 携带但无区分 |
| `ReasoningSummaryDelta` | 无 | 完全不支持 |
| `ReasoningSummaryPartAdded` | 无 | 完全不支持 |
| `Completed` | `finish` | ✅ 等价（含 usage） |
| `ServerModel` | 无 | 无法检测模型 reroute |
| `ServerReasoningIncluded` | 无 | 无法知悉服务器已清算推理 token |
| `RateLimits` | 无 | 无法推送速率限制信息 |
| `ModelsEtag` | 无 | 模型目录变更通知 |
| `ToolCall` | `tool_call` | ✅ 等价 |

**实际缺失且阻碍前端运行的类型：**
1. `ReasoningContentDelta` — 前端无法展示 "thinking..." 流式内容
2. `ServerModel` — 前端无法展示 "实际使用的模型"
3. `RateLimits` — 前端无法展示配额信息
4. `OutputItemDone/Added` — 前端无法实时获得结构化 item

---

## 4. 汇总：按严重程度排序的缺口

### 🔴 阻塞性缺口（阻止完整 agent loop）

| ID | 缺口 | 影响 | 定位 |
|----|------|------|------|
| GAP-1 | **Stream retry 缺失** | LLM 流一次失败即终止整个 turn，前端只能看到 "turn 失败"。 | `executor.ts:133-215`（`executeStream` 无重试循环）；`gateway.ts:176-218`（catch 后直接 return） |
| GAP-2 | **Reasoning content 不推送** | 使用推理模型时前端看不到 "thinking" 过程。`content_type: "thinking"` 在 schema 中存在但从不会被发送。 | `session-stream-adapter.ts:61`（硬编码 `content_type: "text"`）；`runtime-mainline.ts:480`（所有 delta 归为 `type: "content"`） |
| GAP-3 | **Token 计数信息缺失** | 前端无实时 token 计数；无推理 token 独立追踪；无 cached token 数据；如果 Workers AI 不返回 usage 则完全无 token 数据。 | `usage.ts:14-21`（LLMUsage 仅 3 字段）；`canonical.ts:122-128`（NormalizedLLMEvent 无 TokenCount 类型） |

### 🟡 严重缺口（影响 UX/可靠性）

| ID | 缺口 | 影响 | 定位 |
|----|------|------|------|
| GAP-4 | **模型 reroute 无感知** | Workers AI fallback 时前端不知道实际模型已改变。 | `gateway.ts:261-262`（`model.fallback` 流事件存在但 LLM wrapper 不 emit） |
| GAP-5 | **流 idle timeout 缺失** | 仅全局 60s timeout，LLM 生成中卡住时前端等 60s 才报错。 | `executor.ts:42`（`DEFAULT_TIMEOUT_MS = 60_000`） |
| GAP-6 | **Per-provider 细粒度 retry 配置缺失** | `ProviderProfile.retryConfig` 无 `streamMaxRetries`、`streamIdleTimeoutMs`、`retry_on` policy。 | `providers.ts`（ProviderProfile 接口） |
| GAP-7 | **Rate limit 信息不推送** | 前端无法展示 "已用 X% 配额"。 | `canonical.ts:122-128`（无 RateLimit 事件类型）；`protocol.rs:2162-2168`（Codex 有 `RateLimitSnapshot`） |
| GAP-8 | **Context window % 不推送** | 前端无法展示 "上下文窗口剩余 X%"。 | 无等价 `percent_of_context_window_remaining()` 计算 |

### 🟢 改善性缺口（非阻塞但值得关注）

| ID | 缺口 | 影响 | 定位 |
|----|------|------|------|
| GAP-9 | **Reasoning summary 不支持** | 无法配置 per-model reasoning summary (auto/detailed/none)。 | `canonical.ts:99-101`（无 summary 字段） |
| GAP-10 | **模型目录无远程刷新** | 新增模型需手写 D1 migration。 | `gateway.ts:62-80`（仅从 D1 读） |
| GAP-11 | **Auth token refresh 缺失** | API key 过期后前端只能看到永久 auth_error。 | `executor.ts:211-213`（auth 错误 retryable: false） |
| GAP-12 | **Provider HTTP headers 缺失** | 不能配置 per-provider 自定义 header。 | `providers.ts`（ProviderProfile 无 httpHeaders） |
| GAP-13 | **流中 Item 事件缺失** | Item projection 是 REST API 离线查询，不是流推送。 | `item-projection-plane.ts`（REST-only）；Codex `ItemStarted`/`ItemCompleted` 是流事件 |
| GAP-14 | **DeepSeek adapter 骨架** | 纯占位代码，调用即抛异常。 | `adapters/deepseek/index.ts:7-11` |

---

## 5. nano-agent 在本话题外的强项

这些是 nano-agent 已完成或独特具备的能力，Codex 的 LLM wrapper 并无等价物或 nano-agent 更优：

1. **Platform-native AI binding** (`workers-ai.ts:259-307`) — Workers AI 绑定，零 HTTP 开销
2. **Confirmation control plane** — HP5 完成的确认/审批流程 (`runtime-mainline.ts:195` 的 `authorizeToolUse`)
3. **Permission rules** — HPX6 F10 完成的 team-scoped 工具权限 (`runtime-assembly.ts:177-179`)
4. **WriteTodos capability** — LLM 通过 `write_todos` 工具管理 todo list (`runtime-mainline.ts:559-664`)
5. **Compact circuit breaker** — 3 次失败后 7 分钟抑制 (`compact-breaker.ts:18-37`)
6. **Hook system** — 完整的 `HookDispatcher` + `PreToolUse` / `PostToolUse` (`hooks/dispatcher.ts`)
7. **Runtime config plane** — `/sessions/{id}/runtime` GET/PATCH (HPX6 F9)
8. **Tool-calls ledger** — D1 持久的工具调用审计日志 (HPX6 F6)
9. **13-stream-kind 协议** — 比 Codex 的 SSE 事件更结构化的协议帧

---

## 6. 优先级建议

如果目标是让 nano-agent 前端可以完整运行 agent loop：

1. **P0 — GAP-2 (Reasoning 流推送)**：一条 `if (isReasoning) contentType = "thinking"` 即可修复 `session-stream-adapter.ts`。这是代价最小但体验差距最大的修复。
2. **P0 — GAP-1 (流重试)**：在 `WorkersAiGateway.executeStream()` 或 `LLMExecutor.executeStream()` 中加入重试循环，对齐 Codex 的 5 次 stream retry。
3. **P1 — GAP-3 (Token 计数)**：在 `NormalizedLLMEvent` 中加入 `TokenCount` 类型和在 `LLMUsage` 中加入 `reasoningOutputTokens`，让前端可以展示 token 信息。
4. **P1 — GAP-4 (模型 reroute 检测)**：`WorkersAiGateway` 检测 fallback 并 emit `model.fallback` 流事件。
5. **P2 — GAP-5 (流 idle timeout)**：在 `LLMExecutor` 或 `WorkersAiGateway` 中加入 SSE 活动空闲检测。
6. **P2 — GAP-7/8 (Rate limit / Context window % 推送)**：扩展 `NormalizedLLMEvent` 或新增 server-push frame 类型。

---

## Appendix: 关键源码引用索引

### nano-agent 侧
| 文件 | 行号 | 内容 |
|------|------|------|
| `workers/agent-core/src/llm/index.ts` | 1-84 | LLM wrapper 公共 API |
| `workers/agent-core/src/llm/canonical.ts` | 122-128 | NormalizedLLMEvent（5 types） |
| `workers/agent-core/src/llm/usage.ts` | 14-21 | LLMUsage（3 fields + 2 optional） |
| `workers/agent-core/src/llm/errors.ts` | 11-18 | LLMErrorCategory（8 categories） |
| `workers/agent-core/src/llm/gateway.ts` | 62-80 | model capabilities from D1 |
| `workers/agent-core/src/llm/gateway.ts` | 176-218 | executeStream（无重试） |
| `workers/agent-core/src/llm/gateway.ts` | 261-262 | ModelCapabilities 定义 |
| `workers/agent-core/src/llm/executor.ts` | 42 | DEFAULT_TIMEOUT_MS = 60_000 |
| `workers/agent-core/src/llm/executor.ts` | 49-51 | DEFAULT_MAX_RETRIES = 2, DEFAULT_BASE_DELAY_MS = 1000 |
| `workers/agent-core/src/llm/executor.ts` | 133-215 | executeStream（无重试循环） |
| `workers/agent-core/src/llm/executor.ts` | 209-225 | classifyHttpError (HTTP-only) |
| `workers/agent-core/src/llm/session-stream-adapter.ts` | 58-62 | delta → content_type: "text" (hardcoded) |
| `workers/agent-core/src/llm/adapters/types.ts` | 13-22 | ChatCompletionAdapter 接口 |
| `workers/agent-core/src/llm/adapters/workers-ai.ts` | 8-10 | HARDCODED model IDs |
| `workers/agent-core/src/llm/adapters/workers-ai.ts` | 282-307 | model fallback loop（无流重试） |
| `workers/agent-core/src/llm/adapters/deepseek/index.ts` | 7-11 | DeepSeek skeleton（pure throw） |
| `workers/agent-core/src/llm/tool-registry.ts` | 26-49 | LLM_TOOL_DECLARATIONS（22 tools） |
| `workers/agent-core/src/host/runtime-mainline.ts` | 445-518 | createMainlineKernelRunner LLM call |
| `workers/agent-core/src/host/runtime-mainline.ts` | 479-483 | delta → type: "content" |
| `workers/agent-core/src/host/compact-breaker.ts` | 18-37 | CompactBreaker |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts` | 279-312 | compact signal probe |
| `packages/nacp-session/src/stream-event.ts` | 121-126 | LlmDeltaKind（thinking 存在但未用） |
| `packages/nacp-session/src/stream-event.ts` | 147-161 | SessionStreamEventBodySchema（13 kinds） |

### Codex 侧
| 文件 | 行号 | 内容 |
|------|------|------|
| `codex-rs/model-provider-info/src/lib.rs` | 75-124 | ModelProviderInfo 定义 |
| `codex-rs/model-provider-info/src/lib.rs` | 25-27 | 默认 timeout/retry |
| `codex-rs/model-provider-info/src/lib.rs` | 184-212 | to_api_provider() |
| `codex-rs/codex-api/src/common.rs` | 67-96 | ResponseEvent（14 variants） |
| `codex-rs/codex-api/src/common.rs` | 98-104 | Reasoning config |
| `codex-rs/codex-api/src/common.rs` | 155-175 | ResponsesApiRequest |
| `codex-rs/codex-api/src/auth.rs` | — | AuthProvider trait |
| `codex-rs/codex-client/src/retry.rs` | 8-47 | RetryPolicy + backoff + jitter |
| `codex-rs/codex-client/src/retry.rs` | 49-72 | run_with_retry() |
| `codex-rs/protocol/src/protocol.rs` | 2075-2086 | TokenUsage（5 fields） |
| `codex-rs/protocol/src/protocol.rs` | 2089-2095 | TokenUsageInfo（累计追踪） |
| `codex-rs/protocol/src/protocol.rs` | 2156-2159 | TokenCountEvent |
| `codex-rs/protocol/src/protocol.rs` | 2162-2168 | RateLimitSnapshot |
| `codex-rs/protocol/src/protocol.rs` | 2191-2236 | percent_of_context_window_remaining() |
| `codex-rs/protocol/src/protocol.rs` | 1392-1600 | EventMsg（60+ variants） |
| `codex-rs/protocol/src/protocol.rs` | 1802-1851 | CodexErrorInfo（error types） |
| `codex-rs/core/src/context_manager/history.rs` | 136-150 | estimate_token_count() |
| `codex-rs/core/src/client.rs` | — | ModelClient / ModelClientSession |
| `codex-rs/codex-api/src/sse/responses.rs` | — | SSE error classification |
