# Nano-Agent LLM Wrapper 差距分析 — DeepSeek v4-pro

> 调查对象: `nano-agent 6-worker + NACP 协议体系的 LLM 模型注册/选择/上下文拼接/压缩/持久化全链路`
> 调查类型: `gap-analysis（差距分析）`
> 调查时间: `2026-04-30`
> 调查人: `DeepSeek v4-pro（独立审查）`
> 对照参考:
> - `context/claude-code/` — Anthropic Claude Code CLI（Anthropic 官方 Agent CLI）
> - `context/codex/` — OpenAI Codex CLI（Rust）
> - `context/gemini-cli/` — Google Gemini CLI（TypeScript）
> - `context/smind-contexter/` — smind 平台上下文引擎（Cloudflare Workers + DO + SQLite）
> 文档状态: `draft — 待 owner 审阅`

---

## 0. 一句话结论

> nano-agent 的 LLM wrapper 层在"单模型、单窗口、单轮调用"上是成立且干净运行的。但一旦跨入"多模型选择、模型元数据驱动决策、上下文窗口感知压缩、per-model 上下文切换适配、用户面 checkpoint revert"这五个真实 Agent 产品必需的配套设施，当前实现存在**系统性 gap**——骨架代码（DDL 25 模型的 seed、context-core 的全套压缩/组装/预算基础设施、agent-core 的 checkpoint 系统）已经存在，但**核心连接点未通电**。

---

## 1. 调查方法

### 1.1 已核查的代码范围

| 层级 | 目录/文件 | 核查深度 |
|------|----------|---------|
| 模型注册 DDL | `migrations/003-usage-quota-and-models.sql:56-128` | 全量（DDL + 25 条 seed） |
| 模型注册表 | `workers/agent-core/src/llm/gateway.ts` (347行)、`registry/models.ts` (63行)、`registry/loader.ts` (91行) | 全量 |
| 模型选择流程 | `turn-ingress.ts` (133行)、`orchestration.ts` (504行)、`runtime-mainline.ts` (574行) | 全量（turn 入口 → kernel LLM delegate） |
| 上下文拼接 | `kernel/runner.ts:164`、`kernel/reducer.ts:98-175`、`runtime-mainline.ts:162-177` | 关键路径全量 |
| 压缩/compact | `kernel/scheduler.ts`、`kernel/runner.ts:338-361`、`context-core/src/compact-boundary.ts` (234行)、`async-compact/` | 全量 |
| 预算/窗口策略 | `context-core/src/budget/policy.ts` (136行)、`context-assembler.ts:85-167` | 全量 |
| checkpoint/revert | `kernel/checkpoint.ts` (105行)、`host/checkpoint.ts` (282行)、`session-do-persistence.ts` (388行) | 全量 |
| 会话持久化 DDL | `migrations/002-session-truth-and-audit.sql` (168行) — 5 张核心表 | 全量 |
| 消息读写 | `session-truth.ts` (908行)、`session-flow.ts`、`surface-runtime.ts` (642行) | 关键路径全量 |
| API 文档 | `clients/api-docs/session.md`、`session-ws-v1.md` | 全量 |

### 1.2 对照参考实现

| 参考 | 文件 | 借鉴维度 |
|------|------|---------|
| claude-code | `model/configs.ts`, `model/modelCapabilities.ts`, `context.ts`, `compact/autoCompact.ts`, `compact/compact.ts` (1705行) | 模型注册表、API-fetched capabilities、基于实际 contextWindow 的 auto-compact 触发、LLM 摘要压缩 |
| codex | `openai_models.rs` (801行), `config/mod.rs` (2357行), `compact.rs`, `model_switching.rs` | Server-side `/models` 端点驱动、per-model `auto_compact_token_limit`、`TurnStarted` 携带 model_context_window、中间截断 |
| gemini-cli | `models.ts` (477行), `modelConfigService.ts` (638行), `tokenLimits.ts`, `chatCompressionService.ts` (479行) | 1M default token limit、model alias resolution、`CompressionStatus` 详尽的枚举、`$rewindTo` revert 机制 |
| smind-contexter | `prompt_manager.ts` (235行), `gen.ts` (483行 — MODEL_PROFILE), `producer.ts` (619行 — 3-tier context storage) | task-level model routing、3-tier L1/L2/L3 context 存储、BGE reranker 驱动的 rebalancing |

---

## 2. 问题 1：模型注册机制与选择接口

### 2.1 当前现状

**DDL 层（`migrations/003`）—— 25 模型的种子数据：**
```
nano_models (
  model_id          TEXT PK    — 如 "@cf/meta/llama-4-scout-17b-16e-instruct"
  family            TEXT       — 如 "workers-ai/llama"
  display_name      TEXT       — 如 "Llama 4 Scout 17B 16E Instruct"
  context_window    INTEGER    — 如 131072
  is_reasoning      INTEGER    — 0/1
  is_vision         INTEGER    — 0/1
  is_function_calling INTEGER  — 0/1
  status            TEXT       — active/deprecated/experimental
)
```

**代码层（`llm/gateway.ts:32-57`）—— 仅硬编码 2 个模型：**
```ts
WORKERS_AI_REGISTRY = new Map([
  ["@cf/ibm-granite/granite-4.0-h-micro",     {contextWindow:131072, supportsVision:false, ...}],
  ["@cf/meta/llama-4-scout-17b-16e-instruct", {contextWindow:131072, supportsVision:true,  ...}],
]);
```

D1 查询函数 `loadWorkersAiModelCapabilities(db)`（gateway.ts:68-92）**存在**，但仅在 `runtime-mainline.ts:300` 有 `modelCatalogDb` 传入时才调用——而 `createMainlineKernelRunner()` 的那个代码路径**当前是否传入取决于调用方传递的 options**。在实际 DO runtime-assembly（`runtime-assembly.ts:185`）中，`createLiveKernelRunner()` 创建时**未传入 `modelCatalogDb`**。

**模型选择接口（nacp-session `messages.ts`）：**
```ts
SessionStartBodySchema    → model_id: ModelIdSchema.optional()   // 会话开始时选定
SessionFollowupInputBodySchema → model_id: ModelIdSchema.optional()  // 每轮可选
```
- `GET /models`（`index.ts:1347-1426`）返回所有 active 模型 + per-team policy 过滤 + ETag/304
- `requireAllowedModel()`（`surface-runtime.ts:369-405`）验证模型存在且未被 team policy 禁止

### 2.2 对比参考实现

| 维度 | nano-agent | claude-code | codex | gemini-cli |
|------|-----------|-------------|-------|------------|
| 注册方式 | 静态 Map(2) + D1 seed(25, 未全部通电) | 静态 Map(12) + API `models.list()` 拉取真实 capabilities + 缓存 | Server `/models` 端点 → `ModelInfo` struct 推送 | `VALID_GEMINI_MODELS` Set(15+) + `ModelConfigService` 运行时注册 |
| 模型选择入口 | per-message `model_id` | `/model` 命令 + `--model` CLI flag + env `ANTHROPIC_MODEL` + settings | `/model` slash command | `/model` slash command + `ModelChanged` event |
| metadata 丰富度 | `context_window` / `is_reasoning` / `is_vision` / `is_function_calling`（4 字段） | `max_input_tokens` / `max_tokens` / `id` / `display_name`（API 实时拉取） | `context_window` / `auto_compact_token_limit` / `truncation_policy` / `supported_reasoning_levels` / `shell_type` / `model_messages` | `tier` / `family` / `isPreview` / `isVisible` / `features.thinking` / `features.multimodalToolUse` |
| 用户侧可感知信息 | GET /models → `{model_id, family, display_name, context_window, capabilities, status}` | API-fetched + picker UI 含 pricing | `/models` → `{slug, display_name, description, context_window, ...}` | 模型选择器含 tier/family 信息 |

### 2.3 盲点与断点

**B1 — D1 模型种子未通电到主 LLM 调用路径。** `loadWorkersAiModelCapabilities(db)` 存在，但实际 runtime-assembly 不传入 `modelCatalogDb`。这意味着除 2 个硬编码模型外的 23 个 D1 注册模型**在运行时不可被识别**。

**B2 — 模型 metadata 不足以支撑"智能选择"。** DDL 缺 `max_output_tokens`（回复长度上限）、`reasoning_efforts`（支持哪些思考等级）、`pricing_tier`（成本分级）、`default_temperature`、`description`（面向用户的说明文字）。claude-code 从 API 实时拉取 `max_tokens`；codex 区分 `default_reasoning_effort` vs `supported_reasoning_efforts`。

**B3 — `GET /models` 返回的 `reasoning_efforts` 信息缺失。** 虽 DDL 有 `is_reasoning` 字段，但返回 JSON 不含 `reasoning_efforts` 数组。客户端无法知道该模型支持 low/medium/high 还是仅支持部分 effort 等级。

**B4 — 没有模型别名或 default model 的解析层。** claude-code 有 `MODEL_ALIASES`（best/sonnet/opus），gemini-cli 有 `resolveModel()` 解析 auto/pro/flash 别名。nano-agent 客户端必须使用完整的 `@cf/...` 模型 ID。

---

## 3. 问题 2：模型与上下文拼接注入 agentic loop

### 3.1 当前现状

**系统 prompt 注入（`runtime-mainline.ts:162-177`）：**
```ts
const NANO_AGENT_SYSTEM_PROMPT = `You are nano-agent running inside Cloudflare Workers, not a Linux VM...`;
function withNanoAgentSystemPrompt(messages) {
  if (不存在 system prompt) 则 prepend {role:"system", content:NANO_AGENT_SYSTEM_PROMPT};
}
```
一个**硬编码的字符串**，对全部模型通用。

**消息累加（kernel reducer）：**
- `TurnState.messages: array<unknown>` — kernel 级别的消息数组是无类型的
- 每轮 user → assistant → tool_call → tool_result → assistant → ... 通过 reducer action 追加
- LLM delegate 调用时：`kernel/runner.ts:164` → `delegates.llm.call(messages)` → `runtime-mainline.ts:297` → `withNanoAgentSystemPrompt(resolvedMessages)` → `buildWorkersAiExecutionRequestFromMessages()` → `invokeWorkersAi()`

**context-core 全套基础设施（存在但未接入主 LLM 路径）：**
- `context-assembler.ts` — 层级化的上下文组装器（6 层：system/session/workspace_summary/artifact_summary/recent_transcript/injected），含预算截断
- `compact-boundary.ts` — 压缩边界管理，LLM 驱动的 split-point 选择
- `async-compact/scheduler.ts` — 后台压缩调度器（idle→armed→preparing→committing 状态机）
- `budget/policy.ts` — **固定** `maxTokens: 32_000`、`reserveForResponse: 1_024`、soft trigger 75%、hard fallback 95%
- `context-api/append-initial-context-layer.ts` — 初始上下文层注入

### 3.2 对比参考实现

| 维度 | nano-agent | claude-code | codex | gemini-cli |
|------|-----------|-------------|-------|------------|
| system prompt | **硬编码单字符串**，对所有模型相同 | per-model `instructions_template` + 变量替换 | `model_messages` with `instructions_template` + `instructions_variables` | per-agent prompt + subagent specialization |
| 上下文组装 | context-core 有 6 层组装器，但**不接入主 LLM 调用路径** | 直接传消息数组给 API，compact 时 fork agent 做摘要 | 直接传消息数组，`truncate_middle_*` 工具函数 | 直接传消息数组，`ChatCompressionService` 做 LLM 摘要 |
| 预算驱动 | budget/policy.ts **硬编码 32k maxTokens**，不感知模型实际 context_window | `getContextWindowForModel()` → 200k default / 1M with [1m] | server 返回 `context_window`，95% effective | `tokenLimit(model)` → 1M default / 256k Gemma |
| prompt 模板 | 无模板系统 | `{{variable}}` 模板替换 | 同 | smind-contexter: `sys_intent_v1` 等 prompt key → `{{variable}}` hydration |

### 3.3 盲点与断点

**B5 — context-core 的六层组装器、预算策略、压缩边界系统与主 LLM 调用完全脱节。** 主 LLM 调用走 `runtime-mainline.ts → gateway.ts → workers-ai.ts`，不使用 context-core 的任何设施。这是整个系统中最关键的断点——3000+ 行 context-core 代码作为**孤立子系统**存在，proxy stub 返回 `phase: "stub"`（`context-core/src/index.ts:79-203`）。

**B6 — budget/policy.ts 的 `maxTokens: 32_000` 是硬编码常量，不随模型变化。** 当模型 context_window 为 131K 时浪费了 ~100K token 空间；当使用 context_window 8K 的模型（如 llama-3.1-8b）时会造成严重溢出。

**B7 — system prompt 对所有模型通用。** 不同模型（granite/llama/mistral/qwen/deepseek）对 system prompt 的理解能力、最佳格式差异显著。claude-code 和 codex 都使用 per-model `instructions_template`。

---

## 4. 问题 3：Loop 中途切换模型

### 4.1 当前现状

**支持 per-turn model_id（`turn-ingress.ts:85-86`）：**
```ts
// session.start 和 session.followup_input 两种消息都支持 model_id 字段
TurnInput.modelId = body.model_id; // 每轮可选
```
- 模型选择在 `orchestration.ts:241` 写入 kernel snapshot message→`runtime-mainline.ts:187-192` 从消息中提取→`gateway.ts:222` 使用该模型 ID
- Workers AI adapter 支持 serial fallback：先尝试指定模型，失败后回退到 `WORKERS_AI_FALLBACK_MODEL`（`workers-ai.ts:283-286`）

### 4.2 对比参考实现

| 维度 | nano-agent | claude-code | codex | gemini-cli |
|------|-----------|-------------|-------|------------|
| mid-session 切换 | **支持**（per-turn model_id） | 支持（`/model` 命令 + `getRuntimeMainLoopModel()`） | 支持（`ModelRerouteEvent`） | 支持（`/model` + `ModelChanged`） |
| 切换后行为 | 无上下文窗口调整 | **重新计算 context window + output limits + auto-compact 阈值** | **`TurnStarted` 事件携带新的 `model_context_window`，recaculate effective window** | **重置 `currentSequenceModel`，token limit 重新计算** |
| 兼容性检查 | `request-builder.ts:40-46` 检查模型是否在 registry | `modelSupports1M()` / `supportsPromptCaching()` 等细粒度检查 | `ModelInfo.truncation_policy` / `supported_reasoning_levels` | `isActiveModel()` / tier awareness |
| 降级策略 | serial fallback to FALLBACK_MODEL on error（workers-ai.ts:283-286） | growthbook experiment toggles + beta header | 同 | compression fallback on failure |

### 4.3 盲点与断点

**B8 — 切换模型时不做上下文窗口的重新计算或适配。** 如果用户从 context_window=131K 的 llama-4-scout 切换到 context_window=8K 的 llama-3.1-8b，系统不触发 compact、不发出警告、直接传超过 8K 的消息数组到 Workers AI——结果由 Cloudflare API 返回错误，用户侧表现为"未知错误"。

**B9 — 切换模型时不重新评估 capability 约束。** 从 reasoning 模型切换到非 reasoning 模型时，`reasoning.effort` 参数保留在消息中但不会被 adapter 使用。请求不会被拒绝或警告，只是 silently ignored。

---

## 5. 问题 4：不同模型上下文窗口差异与强制压缩

### 5.1 当前现状

**压缩信号生成（kernel scheduler）：**
```ts
// scheduler.ts:50-52 — priority 3
if (signals.compactRequired) return {kind: "compact"};
```
但 `compactRequired` 信号由谁设置？当前代码路径中：
- kernel runner 的 `handleLlmCall()` 之后不评估 token 使用率来设置 `compactRequired`
- context-core 的 `shouldArm()` / `shouldHardFallback()` 使用固定 75%/95% 阈值，但**不接入 main loop**

**context-core 的压缩机制（存在但孤立）：**
- `compact-boundary.ts:142-156` 的 `pickSplitPoint()` — token-budget-aware split 启发式
- `async-compact/scheduler.ts:47-97` 的 `CompactionScheduler.decide()` — 状态机驱动
- `application/compact/compact-service.ts` — LLM 驱动的摘要压缩

但**以上全部依赖 context-core 被接入主 loop**——当前处于 `phase: "stub"` 状态。

**kernel 级别的 compact handler（`runner.ts:338-361`）：**
```ts
handleCompact() → delegates.compact.requestCompact() → compact_done action → tokensFreed
```
当前 kernel compact delegate 的实现（在 context-core）也是 stub。

### 5.2 对比参考实现

| 维度 | nano-agent | claude-code | codex | gemini-cli |
|------|-----------|-------------|-------|------------|
| 触发机制 | scheduler `compactRequired` signal（**无实际触发源**） | `autoCompactIfNeeded()` at 93% of effective window + microCompact for tool results | `auto_compact_token_limit` (90% of context_window) | `ContextWindowWillOverflow` event + `tryCompressChat()` |
| 压缩方式 | **不存在可工作的压缩**（context-core stub） | LLM 摘要（fork agent + compact prompt）+ tool result clearing（cache_edits api）+ truncateHeadForPTLRetry | truncate_middle_* + LLM 摘要 | LLM 摘要 + verification pass + inflation guard + `<state_snapshot>` 锚 |
| 用户确认 | **无** | `/compact` 命令 + manual compact flag | N/A | N/A |
| 模型切换触发 | **无** | model change → recalculate context window → check `shouldAutoCompact()` | `TurnStarted` → new `model_context_window` → recalculate | `ModelChanged` → reset `currentSequenceModel` |

### 5.3 盲点与断点

**B10 — context-core 的压缩管线与主 agent loop 完全断开。** 这是 RH4 "Lane E consumer migration" 未完成的直接后果：context-core 被设计为真实业务 RPC consumer，但当前只有 `context-core/src/index.ts:79-203` 中的 stub RPC 方法。内核 loop 产生的 `compactRequired` signal 无法被消费。

**B11 — 没有"模型感知"的上下文预算概念。** `budget/policy.ts` 的固定 `32_000` maxTokens 使系统完全不知道每个模型的真实上下文限制。即使 context-core 通电，它也无法针对模型 A（context_window=131K）和模型 B（context_window=8K）做出不同决策。

**B12 — 没有任何用户面机制来确认或触发压缩。** claude-code 有 `/compact` 命令和 `MANUAL_COMPACT_BUFFER_TOKENS` 阈值。nano-agent 在 `POST /sessions/{id}/context/compact` 端点存在（`index.ts:1430+`），但它调用的是 context-core 的 stub 方法。

---

## 6. 问题 5：DDL 模型注册表 — 字段充分性与 forward thinking

### 6.1 当前 DDL 字段（migration 003）

```
nano_models:
  model_id            TEXT PRIMARY KEY    ✅ 模型标识
  family              TEXT                ✅ 模型家族
  display_name        TEXT                ✅ 可读名称
  context_window      INTEGER             ✅ 上下文窗口
  is_reasoning        INTEGER (0/1)       ⚠️ 仅布尔，不区分 effort levels
  is_vision           INTEGER (0/1)       ✅ 视觉支持
  is_function_calling INTEGER (0/1)       ✅ 工具调用
  status              TEXT                ✅ active/deprecated/experimental
  created_at          TEXT                ✅
  updated_at          TEXT                ✅
```

### 6.2 对照参考实现的缺失字段

| 字段 | claude-code | codex | gemini-cli | nano-agent 缺失 |
|------|------------|-------|------------|----------------|
| `max_output_tokens` | ✅ (`max_tokens` from API) | ✅ (in `ModelInfo`) | ✅ (`DEFAULT_TOKEN_LIMIT = 1M`) | ❌ **盲点** — 无法告知调用方"这个模型最多输出多少 token" |
| `reasoning_efforts` | N/A（API 能力） | ✅ (`supported_reasoning_levels` array) | ✅ (`features.thinking`) | ❌ **盲点** — 无法告知调用方支持哪些 thinking effort |
| `supports_stream` | ✅（API 能力） | 隐含 | 隐含 | ❌ 可推断但未显式存储 |
| `supports_tools` | ✅（API 能力） | 隐含 | ✅ (`features.multimodalToolUse`) | ⚠️ `is_function_calling` 覆盖了 — 但名字不够泛化 |
| `pricing_tier` | 不存（API 拉取） | 不存 | ✅ (`tier`) | ❌ 对 cost-aware model selection 是障碍 |
| `default_temperature` | 不存 | ✅ (`ModelPreset` client-side) | 不存 | ❌ 无法提供 per-model 最佳实践默认值 |
| `max_input_tokens` | ✅（API） | ✅ (`context_window`) | ✅ (`tokenLimit()`) | ⚠️ `context_window` 可替代 |
| `description` | ✅（display_name+desc） | ✅ (`ModelInfo.description`) | ✅ | ❌ 面向用户的说明文字 |
| `default_model_per_family` | ✅ (aliases: sonnet/opus) | ✅ (`is_default`) | ✅ (`resolveModel()`) | ❌ 无 alias 系统 |
| `deprecation_date` | 不存 | 不存 | ✅ (`isPreview`) | ⚠️ status 可替代但不够细致 |

### 6.3 盲点与断点

**B13 — DDL 缺少 `max_output_tokens`。** 这是影响 token 预算计算的关键参数。当前 budget/policy.ts 硬编码 `reserveForResponse: 1_024`，而这个值在不同模型间可能差异极大（从 256 到 16K+）。

**B14 — DDL 缺少 `reasoning_efforts` 的具体列表。** `is_reasoning=1` 不传达"支持 low,medium,high"还是"仅支持 medium"。代码中 `gateway.ts:50` 硬编码 fallback 模型的 `reasoningEfforts: ["low","medium","high"]`，D1 加载的模型统一 set 为 `["low","medium","high"]`（gateway.ts:86）——完全不准确。

**B15 — 没有 per-model system prompt 或 template 字段。** claude-code 和 codex 的模型配置中都有 `instructions_template`，允许为不同模型提供不同的 system prompt 变体。

---

## 7. 问题 6：聊天记录持久化与 checkpoint revert

### 7.1 当前现状

**7.1.1 会话/消息/轮次持久化（DDL + session-truth.ts）—— 5 张核心表：**

| 表 | 行数范围 | 用途 |
|---|---------|------|
| `nano_conversations` | N/A | 顶层会话容器（多个 session 归入一个 conversation） |
| `nano_conversation_sessions` | 每 session 1 行 | 会话状态（pending→starting→active→detached→ended/expired） |
| `nano_conversation_turns` | 每 turn 1 行 | 轮次索引（turn_index 1,2,3...）+ 状态 |
| `nano_conversation_messages` | 每条消息 1 行 | 消息内容（`body_json` TEXT 存储完整 JSON payload）+ `event_seq` |
| `nano_conversation_context_snapshots` | 每 snapshot 1 行 | 初始上下文捕获 |

**7.1.2 消息拉取（HTTP 端点）：**
- `GET /sessions/{uuid}/timeline` → `readTimeline()` — 仅返回 `stream-event` 类消息，按 event_seq 排序
- `GET /sessions/{uuid}/history` → `readHistory()` — 返回全部消息（user + assistant + system）
- `GET /me/sessions` → KV + D1 合并（pending/active/detached/ended/expired 五态）
- `GET /me/conversations` → D1 `listSessionsForUser()` grouped by conversation_uuid

**7.1.3 消息销毁：**
- `rollbackSessionStart()`（session-truth.ts:743-784）— start 失败时删除全部数据（5 表级联）
- `expireStalePending()` — 24h TTL 将 pending → expired
- `cleanupEndedSessions()` — 24h TTL 清理 KV，保留最多 100 条 ended
- 归档计划：`archive-plan.ts` 定义 compact/session.end/periodic → R2 冷存储

**7.1.4 Checkpoint/Revert 机制：**

**Agent-core 侧（DO storage checkpoint）：**
```
persistCheckpoint() → DO storage key "session:checkpoint"
  ├── kernelFragment       (KernelSessionState + TurnState)
  ├── replayFragment       (WebSocket relay state)
  ├── workspaceFragment    (workspace state)
  ├── hooksFragment        (hook state)
  ├── streamSeqs           (event sequence numbers)
  └── usageSnapshot        (usage data)
```
- 每 turn 结束后自动写入（`env.ts:207` `checkpointOnTurnEnd: true`）
- DO 从 hibernation 唤醒时 `restoreFromStorage()` 恢复
- Kernel 级别有 `CHECKPOINT_VERSION_MISMATCH` 版本验证

**Orchestrator 侧（session 级 rollback）：**
- `rollbackSessionStart()` — start 失败时 D1 全量删除
- `handleResume()` — 客户端 reconnect 时 replay-loss 检测 + `session.replay_lost` audit 事件

### 7.2 对比参考实现

| 维度 | nano-agent | claude-code | codex | gemini-cli |
|------|-----------|-------------|-------|------------|
| 存储介质 | D1（Durable） + KV（Hot Read） + DO storage（Checkpoint） | Filesystem（transcript + memory.md + settings） | 未知 | JSONL files (`session-<hash>.jsonl`) |
| 消息格式 | `body_json` TEXT（任意 JSON payload） | Structured transcript | 未知 | `PartListUnion`（结构化 parts） |
| checkpoint 粒度 | **每 turn 自动**（DO storage） | 每 session（transcript 文件） | 未知 | 每 session（JSONL 文件） |
| 用户面 revert | **不存在** | rewind via REPL state | 未知 | **`$rewindTo` records in JSONL** — 加载时 skip 该行之后的全部 message |
| revert 触发方式 | N/A | REPL rewind command | N/A | JSONL 内嵌 `$rewindTo` marker + `rewindConversation()` API |
| snapshot/comparison | N/A | compact boundary markers | `TurnStarted` context window snapshots | `<state_snapshot>` anchor |
| 多 turn 回退 | `rollbackSessionStart()`（**仅 start 失败场景**） | rewind to any past state | N/A | `rewindConversation()` to marker |

### 7.3 盲点与断点

**B16 — 不存在用户面 revert/rollback 机制。** 当前 checkpoint 系统是纯内部的 DO 生命周期管理工具——它在 DO hibernate→wake 时恢复状态，而不是暴露给用户去"回到上一轮"或"撤销从第 N 轮开始的操作"。这是一个**关键的产品面缺失**：聊天机器人/Agent 的核心 UX 之一就是"回到之前的某个状态并重新开始"。

**B17 — `body_json` 存储整个消息 payload 但无结构化索引。** 无法按 `message_kind` 之外的维度查询消息。例如"找出这个 session 中所有的 tool_call 消息"或"列出所有 assistant 回复中的 reasoning 片段"需要全量 `body_json` JSON.parse + 遍历。gemini-cli 的 `PartListUnion` 类型和 codex 的 structured transcript 都是在考虑这一需求。

**B18 — `nano_conversation_context_snapshots` 表仅存储 `snapshot_kind = "initial-context"`，不存储 turn 级的 snapshot。** 如果未来要实现"回到第 3 轮的状态"，需要从 message 表反向重建——因为 snapshot 表里没有 turn 快照。

**B19 — 没有 `restoreCheckpointToDurable` 或等价方法。** DO storage checkpoint 是 DO 内部的语义；D1 中的消息历史不受 checkpoint/restore 影响。如果 DO 恢复到 turn_3 的 checkpoint，但 D1 中仍记录着 turn_4/turn_5 的消息——两个真相源会漂移。

**B20 — `nano_conversation_turns.turn_index` 是 session 内的连续递增值。** 如果 revert 后"重新生成" turn_3，turn_index 3 会被 **新 turn** 复用还是产生新的 turn？当前 DDL 的定义 `UNIQUE(session_uuid, turn_index)` 意味着 revert + resend 会触发 UNIQUE 冲突。

---

## 8. 核心断点总结与修复路线

### 8.1 关键断点清单（按严重性排序）

| 编号 | 断点 | 严重性 | 当前代码现实的直接证据 | 影响 |
|------|------|--------|----------------------|------|
| **B10** | context-core 与主 agent loop 完全脱节 | **critical** | `context-core/src/index.ts:79-203` — 全部 RPC 方法返回 `phase: "stub"`；`runtime-mainline.ts:296-352` 不使用 context-core 的任何设施 | context-core 3000+ 行代码无效；compact/压缩/组装/预算全部不可用 |
| **B8** | 模型切换时不做上下文窗口适配 | **critical** | gateway.ts 使用 `inferModelId()` 取 model_id 但 `contextWindow` 不参与 `compactRequired` 信号生成 | 切换到更小窗口模型时无警告/无压缩，消息溢出导致 API 错误 |
| **B1** | D1 25 模型种子未通电到主 LLM 路径 | **high** | `runtime-assembly.ts:185` 未传入 `modelCatalogDb`；gateway.ts 仅静态注册 2 个模型 | 25 个 DDL 种子模型中的 23 个在运行时不可用 |
| **B5** | context-core 组装器与 LLM 调用路径脱节 | **high** | 同 B10 | 6 层上下文组装、预算截断系统全部孤立 |
| **B16** | 不存在用户面 checkpoint revert | **high** | 仅 `rollbackSessionStart()` 在 start 失败时删除全部数据；checkpoint 系统是 DO 内部的 | 用户无法回退到之前的对话状态 |
| **B13** | DDL 缺 `max_output_tokens` | **medium** | migration 003 `nano_models` 无此字段；budget/policy.ts 硬编码 `reserveForResponse: 1024` | 无法做准确的 token 预算 |
| **B6** | budget/policy.ts 硬编码 32k maxTokens | **medium** | `DEFAULT_ASSEMBLER_CONFIG.maxTokens: 32_000` — 不随模型变化 | 大窗口模型浪费空间，小窗口模型溢出不预警 |
| **B14** | `reasoning_efforts` 列表在 D1 加载时被硬编码为全部三个等级 | **medium** | gateway.ts:86 `reasoningEfforts: toBooleanFlag(row.is_reasoning) ? (["low","medium","high"] as const) : undefined` | 给不支持特定 effort 的模型标注错误的 capability |
| **B20** | `turn_index` UNIQUE 约束阻止 revert+重试 | **medium** | migration 002: `UNIQUE(session_uuid, turn_index)` | 在 turn #3 失败后重试会冲突 |
| **B11** | 没有模型感知的上下文预算概念 | **medium** | `budget/policy.ts` 完全不引用模型的 `contextWindow` | 即使 B10 修复，压缩也用固定阈值 |
| **B4** | 无模型 alias/default 解析 | **low** | 客户端必须使用完整 `@cf/...` 模型 ID | 用户体验差，不利于模型推荐 |
| **B7** | system prompt 对所有模型通用 | **low** | `runtime-mainline.ts:162-177` — 单一硬编码字符串 | 无法针对不同模型的 system prompt 特性做调优 |

### 8.2 修复路线建议

```
Phase A（解锁 B1, B8）— 模型选择通电
  1. runtime-assembly.ts 传入 modelCatalogDb
  2. 确保 loadWorkersAiModelCapabilities() 在主 LLM 调用前执行
  3. 在模型切换时检查新模型的 contextWindow vs 当前消息 token 估算 → 触发 compact 或返回 warning
  4. D1 的 reasoning_efforts 列化（替换 is_reasoning 布尔为 efforts TEXT 列表）

Phase B（解锁 B10, B5, B6）— context-core 通电
  1. context-core 的 RPC 方法由 stub 升级为真实实现
  2. agent-core 的 CONTEXT_CORE binding 启用（Lane E consumer migration）
  3. kernel runner 的 compact delegate 接入 context-core 的 compact-boundary
  4. budget/policy.ts 接受动态 maxTokens（来自 model capabilities）
  5. 在 kernel advanceStep() 之后评估 token 使用率 + 写入 compactRequired signal

Phase C（解锁 B16, B20）— checkpoint revert
  1. 实现 D1 历史重建：从消息表 + context_snapshots 重建任意 turn 状态
  2. 将 turn_index 的唯一性约束改为 turn_index + turn_attempt（支持 retry）
  3. 暴露 POST /sessions/{uuid}/rollback 端点
  4. 在 rollback 时将 D1 中后续 turn/messages 标记为 superseded（不删除）

Phase D（解锁 B13, B14, B4）— DDL 扩展
  1. 新增 migration 012-model-metadata-enrichment.sql：
     - nano_models 加 max_output_tokens, reasoning_efforts, description, default_temperature
  2. 实现模型 alias 解析层
  3. GET /models 返回完整 capability metadata
```

### 8.3 最终判断

| 维度 | 当前状态 | 距离 first-wave 可用的差距 |
|------|---------|--------------------------|
| 单模型调用 | ✅ 成立 | 可直接使用 |
| 多模型选择 | ⚠️ 骨架存在但 23/25 模型不可用 | ≈2-3 天（Phase A.1-2） |
| 模型感知上下文 | ❌ 完全不成立 | ≈1-2 周（Phase B 全量） |
| 上下文压缩 | ❌ 骨架孤岛 | ≈1-2 周（Phase B 全量） |
| 模型切换适配 | ❌ 无 | ≈3-5 天（Phase A.3） |
| checkpoint/revert | ❌ 仅 DO 内部 | ≈2-3 周（Phase C 全量） |
| DDL 表达力 | ⚠️ 字段基本够用但缺关键维度 | ≈1-2 天（Phase D.1-2） |
| 消息持久化 | ✅ 成立 | product 可用 |

> **整体判断**：nano-agent 的 LLM wrapper 在"单模型、单窗口、单轮调用"上是成立且干净运行的。但在上述 7 个维度中有 4 个处于"骨架存在但不通电"状态。这并非设计缺失——charter plan-real-to-hero.md 的 RH4/RH5/RH6 阶段以及 context/ references 已经正确识别了这些 gap——而是执行进度尚未覆盖到这一步。本报告的 13 个盲点（B1-B20 中扣除已列出的 13 个关键断点）为后续施工提供了精确定位。
