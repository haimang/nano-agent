# LLM Wrapper 执行能力调研 — nano-agent vs Claude Code / Codex CLI / Gemini CLI

> 作者: `GLM-5.1`
> 日期: `2026-04-30`
> 方法: 基于代码事实的独立调研，未参考其他 reviewer 的分析报告

---

## 0. 调研背景与问题

本调研围绕 nano-agent 在 LLM 模型注册、上下文管理、模型切换、强制压缩、聊天记录持久化五个维度的现状，与 Claude Code、OpenAI Codex CLI、Gemini CLI 三个主流 LLM agent 的解法进行对照，识别 nano-agent 当前架构的盲点、断点和逻辑错误。

回答的六个问题：
1. 模型注册机制与 metadata 是否足够
2. 上下文如何拼接并注入 agentic loop
3. 是否可中途切换模型
4. 切换模型时不同上下文窗口的强制压缩机制
5. DDL 中模型注册的表达空间是否充分
6. 聊天记录的保存/拉取/销毁与 checkpoint/revert 机制

---

## 1. 模型注册机制

### 1.1 nano-agent 现状

**D1 表结构** (`003-usage-quota-and-models.sql`):

```sql
CREATE TABLE IF NOT EXISTS nano_models (
  model_id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 0,
  is_reasoning INTEGER NOT NULL DEFAULT 0 CHECK (is_reasoning IN (0, 1)),
  is_vision INTEGER NOT NULL DEFAULT 0 CHECK (is_vision IN (0, 1)),
  is_function_calling INTEGER NOT NULL DEFAULT 0 CHECK (is_function_calling IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'experimental')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**运行时 `ModelCapabilities`** (`workers/agent-core/src/llm/registry/models.ts`):

```typescript
export interface ModelCapabilities {
  readonly modelId: string;
  readonly provider: string;
  readonly supportsStream: boolean;
  readonly supportsTools: boolean;
  readonly supportsVision: boolean;
  readonly supportsReasoning?: boolean;
  readonly reasoningEfforts?: readonly ("low" | "medium" | "high")[];
  readonly supportsJsonSchema: boolean;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly notes?: string;
}
```

**GET /models 端点返回**:

```json
{
  "model_id": "@cf/meta/llama-4-scout-17b-16e-instruct",
  "family": "workers-ai/llama",
  "display_name": "Llama 4 Scout 17B",
  "context_window": 131072,
  "capabilities": {
    "reasoning": true,
    "vision": true,
    "function_calling": true
  },
  "status": "active"
}
```

**硬编码 fallback** (`gateway.ts`):
仅 2 个模型 — granite-4.0-h-micro (primary, 131K context, no reasoning/vision) 和 llama-4-scout (fallback, 131K context, reasoning+vision)。当 D1 不可用时使用。

**模型选择时机**:
- 客户端在 session start 或 follow-up input 时通过 `model_id` + `reasoning` 字段指定模型
- 请求到达 orchestrator-core → agent-core 后，由 `readLlmRequestEvidence()` 从消息中提取 `model_id`
- `requireAllowedModel()` 鉴权门卫：检查 D1 `nano_models` 是否活跃 + `nano_team_model_policy` 是否允许

### 1.2 Claude Code 对比

Claude Code 的模型元数据是闭源的，但 CHANGELOG 显示：
- 按模型区分 context window（Sonnet 200K vs Opus 4.7 1M）
- `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 环境变量可覆盖 context 上限
- 模型选择通过 `/model` 命令，在 session 级别而非 turn 级别

### 1.3 OpenAI Codex CLI 对比

Codex CLI 有丰富的模型元数据结构 (`ModelInfo`):

```rust
pub struct ModelInfo {
    pub slug: String,
    pub display_name: String,
    pub context_window: Option<i64>,
    pub max_context_window: Option<i64>,
    pub auto_compact_token_limit: Option<i64>,
    pub effective_context_window_percent: i64,  // 默认 95%
    pub default_reasoning_level: Option<ReasoningEffort>,
    pub supported_reasoning_levels: Vec<ReasoningEffortPreset>,
    pub truncation_policy: TruncationPolicyConfig,
    pub supports_parallel_tool_calls: bool,
    pub supports_image_detail_original: bool,
    pub supports_search_tool: bool,
    pub input_modalities: Vec<InputModality>,
    pub upgrade: Option<ModelInfoUpgrade>,        // 推荐升级路径
    pub base_instructions: String,                 // 模型专属系统提示
    pub model_messages: Option<ModelMessages>,     // 模型人格
    pub additional_speed_tiers: Vec<String>,       // 速度梯队
    // ...
}
```

关键差异：
- `auto_compact_token_limit`: 每个模型有自己的自动压缩阈值（而非全局比例）
- `effective_context_window_percent`: 保留 5% 给系统提示和工具开销（而非 100% 使用）
- `max_context_window`: 可配置上限覆盖
- `upgrade`: 模型升级推荐路径
- `base_instructions`: 模型专属系统提示基础文本
- `input_modalities`: 精细的输入模态声明（而非二值 is_vision）
- `truncation_policy`: 模型专属的截断策略（按字节或按 token）
- 模型列表从远程 `/models` 端点动态获取并缓存 5 分钟

### 1.4 Gemini CLI 对比

Gemini CLI 使用静态 config + alias 解析：

```typescript
// 别名链
aliases: {
  'chat-base': { extends: 'base', modelConfig: { ... } },
  'chat-base-2.5': { extends: 'chat-base', modelConfig: { ... } },
  'gemini-2.5-pro': { extends: 'chat-base-2.5', modelConfig: { model: 'gemini-2.5-pro' } },
}

// 模型定义
interface ModelDefinition {
  displayName?: string;
  tier?: 'pro' | 'flash' | 'flash-lite' | 'custom' | 'auto';
  family?: 'gemini-3' | 'gemini-2';
  isPreview?: boolean;
  isVisible?: boolean;
  features?: { thinking?: boolean; multimodalToolUse?: boolean; };
}
```

Token 限制硬编码（Gemini 统一 1M，Gemma 256K）。

### 1.5 nano-agent 差距分析

| 维度 | Codex CLI | Gemini CLI | nano-agent | 差距 |
|------|-----------|------------|------------|------|
| 模型列表动态获取 | ✅ 远程 /models + 5min 缓存 | ❌ 静态 config | ✅ D1 查询 + ETag 缓存 | 无根本差距 |
| context_window 表达 | ✅ + max_context_window 覆盖上限 | ✅ 硬编码 per-model | ✅ D1 字段 | **缺少 `max_context_window` 和 `effective_context_window_percent`** |
| 自动压缩阈值 | ✅ per-model `auto_compact_token_limit` | ❌ 全局比例 | ❌ 无（压缩未激活） | **根本性缺失** |
| reasoning effort 表达 | ✅ per-model `supported_reasoning_levels` | ✅ per-model `thinking` boolean | ✅ `is_reasoning` + `reasoningEfforts` | nano-agent 已有，但 D1 未存 reasoning efforts 列表 |
| input modalities | ✅ `input_modalities` enum | ✅ `multimodalToolUse` boolean | ✅ `is_vision` + `is_function_calling` | 粒度略粗但够用 |
| 模型升级路径 | ✅ `upgrade` 字段 | ❌ | ❌ | **缺失** |
| 模型人格/指令 | ✅ `base_instructions` + `model_messages` | ✅ tier-based prompt | ❌ | **缺失** |
| 截断策略 | ✅ per-model `truncation_policy` | ❌ | ❌ | **缺失** |
| 输出 token 上限 | ✅ 存在于 Codex | ❌ | ✅ `maxOutputTokens`（仅 runtime） | D1 未存 |
| 速度梯队 | ✅ `additional_speed_tiers` | ✅ tier-based | ❌ | 当前 Workers AI 无此需求 |

**关键缺失字段（D1 表）**:

| 字段 | 重要性 | 说明 |
|------|--------|------|
| `max_output_tokens` | HIGH | 每个模型的最大输出 token 数，当前仅在 runtime 硬编码 |
| `effective_context_window_pct` | HIGH | 实际可用上下文比例（Codex 用 95%），当前全局无此概念 |
| `auto_compact_token_limit` | HIGH | per-model 压缩触发阈值，当前压缩机制未激活 |
| `supported_reasoning_levels` | MEDIUM | reasoning effort 可选值的 JSON 数组，当前 runtime 硬编码为固定三档 |
| `truncation_policy` | MEDIUM | per-model 截断策略配置 |
| `base_instructions` | MEDIUM | 模型专属系统提示前缀 |
| `input_modalities` | LOW | 精细输入模态列表（text/image/audio） |

---

## 2. 上下文拼接与注入

### 2.1 nano-agent 现状

**上下文拼接流程**:

1. **系统提示注入** (`runtime-mainline.ts:162-177`):
   ```typescript
   export const NANO_AGENT_SYSTEM_PROMPT =
     "You are nano-agent running inside Cloudflare Workers...";
   function withNanoAgentSystemPrompt(messages) {
     if (hasSystemPrompt) return messages;
     return [{ role: "system", content: NANO_AGENT_SYSTEM_PROMPT }, ...messages];
   }
   ```
   单一固定系统提示，无模型专属变体。

2. **消息组装** (`orchestration.ts:231-253`):
   用户消息以 `{ role: "user", content: input.parts ?? input.content, model_id?, reasoning? }` 形式进入 TurnState.messages。

3. **文件图片解析** (`runtime-mainline.ts:286-308`):
   `resolveSessionFileImages(messages, options)` 解析 `image_url` content parts。

4. **LLM 请求构建** (`gateway.ts:208-232`):
   `buildWorkersAiExecutionRequestFromMessages()` 将消息转为 `ExecutionRequest`，注入工具定义，验证模型能力。

5. **Context layers** (`context-core/src/context-assembler.ts`):
   冻结排序：`system → session → workspace_summary → artifact_summary → recent_transcript → injected`
   有 budget truncation 机制但未激活（compact delegate 是 no-op）。

**关键断点**：`compactRequired` 信号永远为 `false`，`CompactDelegate.requestCompact()` 返回 `{ tokensFreed: 0 }`。

### 2.2 Codex CLI 对比

Codex CLI 使用增量上下文 diffing：

1. **首轮**：发送完整 `build_initial_context()` 包含模型指令、权限指令、Agent.md、技能指令等
2. **后续轮**：仅发送 `build_settings_update_items()` 差分（模型切换、权限变更等）
3. **压缩**：将历史摘要化，但保留最新的用户消息和 `<model_switch>` 片段
4. **截断策略**：`TruncationPolicyConfig` 控制工具结果的最大长度

### 2.3 Gemini CLI 对比

Gemini CLI 使用分层压缩管道：

1. `ContextManager` 管理一个,episodic context graph（episodic context graph）
2. 当 tokens 超过 `budget.retainedTokens` 时触发 consolidation event
3. 两阶段压缩：先截断大型工具输出（50K token 预算），再 LLM 摘要化（保留最近 30%）
4. 摘要有自验证 pass
5. 文件级压缩状态持久化到 `compression_state.json`

### 2.4 nano-agent 差距分析

| 维度 | Codex CLI | Gemini CLI | nano-agent | 差距 |
|------|-----------|------------|------------|------|
| 系统提示 | 模型专属 `base_instructions` + 人格 | tier-based section assembly | 固定单一提示 | **无模型变体** |
| 上下文 diffing | ✅ 增量 diff | ❌ 全量 | ❌ 全量 | 带宽浪费 |
| Token 计数 | ✅ 字节启发式 + API | ✅ 启发式 | ❌ 无（仅累计总数） | **根本性缺失** |
| 自动压缩 | ✅ per-model 阈值 | ✅ 分层 | ❌ no-op | **未激活** |
| 工具结果截断 | ✅ per-model 策略 | ✅ 全局策略 | ❌ 无截断 | **缺失** |
| 初始上下文注入 | ✅ 环境信息注入 | ✅ 工作区信息 | 部分实现（`initial_context`） | 不完整 |

---

## 3. 模型切换

### 3.1 nano-agent 现状

nano-agent **允许 per-turn 模型切换**：

- `SessionStartBodySchema` 包含 `model_id?: string` + `reasoning?: { effort: "low" | "medium" | "high" }`
- `SessionFollowupInputBodySchema` 包含 `model_id?` + `reasoning?`
- `SessionMessagePostBodySchema` 包含 `model_id?` + `reasoning?`

每次 LLM 调用时，`readLlmRequestEvidence()` 从消息数组的第一条消息中提取 `model_id`，传给 Workers AI gateway。这意味着**每轮对话可以使用不同模型**。

但同时也有 fallback 机制：如果主模型失败，自动尝试 fallback 模型（granite → llama-4-scout）。

**然而**：没有模型切换时的上下文适配逻辑。如果新模型的 context_window 小于当前对话 token 数，没有任何截断或压缩机制。

### 3.2 Codex CLI 对比

Codex CLI 有显式的模型切换支持：

```rust
// 当检测到模型切换时，注入 <model_switch> developer message
impl ContextualUserFragment for ModelSwitchInstructions {
    const ROLE: &'static str = "developer";
    const START_MARKER: &'static str = "<model_switch>";
    const END_MARKER: &'static str = "</model_switch>";
    fn body(&self) -> String {
        format!("\nThe user was previously using a different model. \
                 Please continue the conversation according to the \
                 following instructions:\n\n{}\n", self.model_instructions)
    }
}
```

关键行为：
- 切换模型时注入 `<model_switch>` 片段，包含新模型的使用指引
- 压缩时从摘要请求中剥离 `<model_switch>` 片段，压缩完成后再恢复
- Reasoning effort 在模型间映射（`ReasoningEffortMapping`）
- `auto_compact_token_limit` 根据新模型的 `context_window` 重新计算

### 3.3 nano-agent 差距分析

| 维度 | Codex CLI | nano-agent | 差距 |
|------|-----------|------------|------|
| 模型切换标记 | `<model_switch>` developer message | 无 | **客户端/LLM 不知道发生了模型切换** |
| reasoning effort 映射 | `ReasoningEffortMapping` 跨模型 | 无 | 旧模型 effort 可能不适用于新模型 |
| 上下文窗口适配 | 重算 `auto_compact_token_limit` | 无适配 | **大窗口模型切小窗口模型可能超限** |
| 压缩时模型切换片段 | 剥离再恢复 | N/A | 压缩未激活 |

---

## 4. 强制压缩机制

### 4.1 nano-agent 现状

**基础设施存在但未激活**：

- **Scheduler** 支持的决策类型：LLM call、tool exec、compact、hook emit、wait、finish
- **Reducer** 支持 `compact_done` action：递减 totalTokens、递增 compactCount
- **`CompactBoundaryManager`** 已实现：pick split point、apply compact response（用边界标记替换旧消息）
- **`CompactDelegate`** 接口已定义
- **`compact.notify` stream event** 已定义：`{ kind: "compact.notify", status: "started" | "completed" | "failed" }`

**实际状况**：
- `runtime-mainline.ts` 中 compact delegate 是 **no-op**：`async requestCompact() { return { tokensFreed: 0 }; }`
- orchestration step loop 中 `compactRequired` **永远为 false**
- `CompactBoundaryManager` 已实例化但 **未连接** 到 scheduler signals
- 软触发阈值（75%）和硬回退阈值（95%）已定义但在 step loop 中 **从不检查**

**这意味着**：当对话 token 数超过模型 context window 时，LLM 调用会直接失败（Workers AI 返回 `ContextWindowExceeded` 错误），没有任何优雅降级。

### 4.2 Codex CLI 对比

Codex CLI 有完整的自动压缩系统：

- **触发**：当 token 使用超过 `auto_compact_token_limit`（默认 90% of context_window）自动触发
- **策略**：inline（本地模型摘要化）或 remote（调用 /compact API）
- **摘要格式**：`"Summary of previous conversation:\n{last_assistant_message}"`
- **失败降级**：当 context 仍超限（`ContextWindowExceeded`），逐一移除最旧的消息
- **保留**：压缩时保留最近 20K token 的用户消息 + 初始上下文
- **断路器**：3 次连续压缩失败后停止自动压缩

### 4.3 Gemini CLI 对比

Gemini CLI 有分层压缩：

- **第一阶段**：截断大型工具输出（50K token 预算）
- **第二阶段**：LLM 摘要化（`<state_snapshot>` prompt）
- **自验证**：对摘要做 verification pass
- **保留策略**：保留最近 30% 历史
- **持久化**：`compression_state.json` 跨 session 保存

### 4.4 nano-agent 差距分析

| 维度 | Codex CLI | Gemini CLI | nano-agent | 严重程度 |
|------|-----------|------------|------------|----------|
| 自动压缩触发 | 90% 阈值自动 | 50%/75% 分层 | **no-op** | **CRITICAL** |
| 压缩策略 | LLM 摘要 + 截断降级 | 两阶段摘要 + 截断 | 基础设施存在但未激活 | **CRITICAL** |
| 压缩通知 | 自动（静默） | 自动（`compact.notify` event） | 事件定义存在但无触发方 | MEDIUM |
| 截断降级 | 移除最旧消息 + 工具结果截断 | 大型工具输出截断 | 无 | **CRITICAL** |
| token 计数 | 字节启发式 | 字节启发式 | 仅累计总数，无逐条计数 | **HIGH** |
| 压缩保留策略 | 最近 20K token 用户消息 | 最近 30% 历史 | 未定义 | **HIGH** |

**核心断点**：nano-agent 的压缩基础设施（scheduler + reducer + boundary manager + stream event）全部存在，但核心连接点未接通——`compactRequired` 永远为 false，compact delegate 返回空。这等同于有刹车踏板但没连刹车片。

---

## 5. DDL 模型注册表达空间分析

### 5.1 当前 DDL

```sql
CREATE TABLE IF NOT EXISTS nano_models (
  model_id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  display_name TEXT NOT NULL,
  context_window INTEGER NOT NULL DEFAULT 0,
  is_reasoning INTEGER NOT NULL DEFAULT 0,
  is_vision INTEGER NOT NULL DEFAULT 0,
  is_function_calling INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated', 'experimental')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 5.2 差距详表

| 迁移建议 | 字段名 | 类型 | 说明 | 优先级 |
|----------|--------|------|------|--------|
| 添加 | `max_output_tokens` | INTEGER NOT NULL DEFAULT 4096 | 模型最大输出 token 数。Workers AI 不同模型限制差异极大（granite 8K vs 其他 4K） | P0 |
| 添加 | `effective_context_pct` | REAL NOT NULL DEFAULT 0.95 | 实际可用上下文比例（保留 5% 给系统提示和工具开销）。Codex CLI 用 95% | P0 |
| 添加 | `auto_compact_pct` | REAL | 自动压缩触发百分比（如 0.90 表示 90% 时触发） | P0 |
| 添加 | `supported_reasoning_levels` | TEXT | JSON 数组，如 `["low","medium","high"]` | P1 |
| 添加 | `input_modalities` | TEXT | JSON 数组，如 `["text","image"]` | P1 |
| 添加 | `output_modalities` | TEXT | JSON 数组，如 `["text","tool_use"]` | P2 |
| 添加 | `base_system_prompt_suffix` | TEXT | 模型专属系统提示追加文本 | P2 |
| 添加 | `truncation_mode` | TEXT CHECK IN ('bytes','tokens') | 截断策略：按字节还是按 token | P2 |
| 添加 | `truncation_limit` | INTEGER | 截断阈值（工具输出最大长度） | P2 |
| 添加 | `upgrade_to` | TEXT | 推荐升级到的模型 ID | P3 |
| 添加 | `sort_priority` | INTEGER NOT NULL DEFAULT 0 | 模型在列表中的排序权重 | P3 |
| 添加 | `description` | TEXT | 模型描述（供 UI 展示） | P3 |
| 修改 | `is_reasoning` → `supports_reasoning` | INTEGER → 可保留 | 当前 0/1 布尔够用，但 `supported_reasoning_levels` 更精细 | — |
| 修改 | `is_vision` → `supports_vision` | 同上 | 与 `input_modalities` 统一更好 | — |

**Forward-thinking 字段**（暂不加但预留给 hero-to-platform）：

| 字段 | 说明 | 预留时机 |
|------|------|----------|
| `per_team_daily_token_limit` | 每团队每日 token 限额 | hero-to-platform (billing) |
| `per_team_daily_request_limit` | 每团队每日请求限额 | hero-to-platform (billing) |
| `cost_per_1k_input_tokens` | 输入 token 单价 | hero-to-platform (billing) |
| `cost_per_1k_output_tokens` | 输出 token 单价 | hero-to-platform (billing) |
| `provider_name` | 提供商名称（workers-ai / openai / deepseek） | hero-to-platform (multi-provider) |
| `provider_model_id` | 提供商特定模型 ID | hero-to-platform (multi-provider) |
| `api_endpoint` | 提供商 API endpoint | hero-to-platform (multi-provider) |

### 5.3 `team_model_policy` 表分析

```sql
CREATE TABLE IF NOT EXISTS nano_team_model_policy (
  team_uuid TEXT NOT NULL,
  model_id TEXT NOT NULL,
  allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)),
  configured_by TEXT NOT NULL DEFAULT 'system',
  configured_at TEXT NOT NOT NULL,
  PRIMARY KEY (team_uuid, model_id)
);
```

**缺失**：

| 字段 | 说明 | 优先级 |
|------|------|--------|
| `daily_token_budget` | 团队对该模型的每日 token 预算 | P1 |
| `daily_request_budget` | 团队对该模型的每日请求限额 | P1 |
| `default_reasoning_effort` | 团队对该模型的默认 reasoning effort | P2 |
| `is_pinned` | 是否在模型选择器中固定显示 | P3 |

---

## 6. 聊天记录持久化与 Checkpoint/Revert

### 6.1 nano-agent 现状

**持久化机制**：

nano-agent 使用 Durable Object (DO) storage 做 session checkpoint，而非 D1 数据库存储逐条消息。

**Checkpoint 结构** (`session-do-persistence.ts`):

```typescript
const checkpoint = {
  version: "0.1.0",
  sessionUuid,
  teamUuid,
  actorPhase: state.actorState.phase,
  turnCount: state.turnCount,
  kernelFragment: state.kernelSnapshot,  // ← 包含 activeTurn.messages
  replayFragment: null,
  streamSeqs: {},
  workspaceFragment: null,
  hooksFragment: null,
  usageSnapshot: { totalTokens: 0, totalTurns: state.turnCount, totalDurationMs: 0 },
  checkpointedAt: new Date().toISOString(),
};
await storage.put(CHECKPOINT_STORAGE_KEY, checkpoint);
```

**关键事实**：
- 整个 kernel snapshot（包含所有消息）作为单个 blob 写入 DO storage
- **没有逐条消息的独立存储**——消息嵌入在 `kernelFragment.activeTurn.messages` 中
- Checkpoint 在以下时机写入：turn end、session end、alarm 触发
- Checkpoint 在 DO 从休眠唤醒时读取恢复
- `version: "0.1.0"` 做版本门控，版本不匹配时拒绝恢复

**D1 层消息记录**：

`nano_conversation_sessions` + `nano_conversation_turns` + `nano_conversation_messages` 三表存在于 migration 002 中，但由 `user-do` 写入而非 `session-do`。这些是**持久化查询视图**（用于 `/me/conversations` 和 `/me/sessions`），不是 session DO 的恢复源。

**恢复机制**：

`restoreFromStorage()` 从 DO storage 读取 checkpoint，恢复 `actorState` 和 `kernelSnapshot`。版本不匹配时抛出 `CHECKPOINT_VERSION_MISMATCH`。

**Revert 机制**：

**不存在**。没有代码可以回滚到某个特定 checkpoint 或 undo 一个 turn。

**Snapshot 机制**：

`context-core` 的 `InspectorFacade` 有 `POST /inspect/sessions/:id/context/snapshot` 和 `POST /inspect/sessions/:id/context/compact` 端点（受 `INSPECTOR_FACADE_ENABLED` 环境变量控制），但当前 orchestrator-core 路由到 context-core 的 RPC stub 返回 `phase: "stub"`。

### 6.2 Codex CLI 对比

Codex CLI 有完整的 ThreadStore：

```rust
pub trait ThreadStore: Any + Send + Sync {
    async fn create_thread(&self, params: CreateThreadParams) -> ThreadStoreResult<()>;
    async fn resume_thread(&self, params: ResumeThreadParams) -> ThreadStoreResult<()>;
    async fn append_items(&self, params: AppendThreadItemsParams) -> ThreadStoreResult<()>;
    async fn persist_thread(&self, thread_id: ThreadId) -> ThreadStoreResult<()>;
    async fn flush_thread(&self, thread_id: ThreadId) -> ThreadStoreResult<()>;
    async fn load_history(&self, params: LoadThreadHistoryParams) -> ThreadStoreResult<StoredThreadHistory>;
    async fn read_thread(&self, params: ReadThreadParams) -> ThreadStoreResult<StoredThread>;
    async fn list_threads(&self, params: ListThreadParams) -> ThreadStoreResult<ThreadPage>;
    // ...
}
```

支持 local (JSONL) 和 remote 后端。`ContextManager` 维护 `history_version` 递增版本号，在 compaction/rollback 时递增。`drop_last_n_user_turns()` 支持回滚 N 个 turn。

### 6.3 Gemini CLI 对比

Gemini CLI 有 `ChatRecordingService`：
- JSONL 持久化（每行一条记录）
- `RewindRecord` 支持 `$rewindTo` 字段实现回滚
- Git-based checkpoint（`createFileSnapshot`）用于文件操作回滚
- `compression_state.json` 跨 session 持久化压缩状态

### 6.4 nano-agent 差距分析

| 维度 | Codex CLI | Gemini CLI | nano-agent | 严重程度 |
|------|-----------|------------|------------|----------|
| 逐条消息存储 | ✅ append item by item | ✅ JSONL per event | ❌ 整体 blob | **HIGH** |
| 事务回滚/Undo | ✅ `drop_last_n_user_turns` | ✅ `$rewindTo` | ❌ 无 | **HIGH** |
| Checkpoint 版本历史 | ✅ `history_version` 递增 | ✅ 压缩版本 | ✅ `version: "0.1.0"` 门控 | LOW |
| 多 Checkpoint 序列 | ✅ | ✅ 快照序列 | ❌ 仅最新一个 | **MEDIUM** |
| 远程存储后端 | ✅ RemoteThreadStore API | ❌ 本地 | ❌ DO storage only | LOW (Cloudflare 约束) |
| 压缩状态持久化 | ✅ | ✅ `compression_state.json` | ❌ 无（压缩未激活） | — |
| Session 列表 + 分页 | ✅ `list_threads` + pagination | ✅ | ✅ `/me/conversations` + `/me/sessions` | — |

**核心断点**：

1. **没有逐条消息的独立存储**：整个 kernel snapshot 作为单 blob 写入 DO storage。如果 snapshot 很大（长对话 + 多轮工具调用），写入性能和存储成本都会恶化。更关键的是，无法选择性地读取/恢复某条消息。

2. **没有 revert/rollback 机制**：用户无法回滚到某个 checkpoint。如果 LLM 产生错误回复，只能取消当前 turn，无法撤销已完成的历史。

3. **没有压缩状态持久化**：`compactCount` 和 `totalTokens` 在 checkpoint 中记录，但压缩后的消息摘要没有独立持久化。

---

## 7. 综合差距与盲点总结

### 7.1 盲点（架构层面缺失的基础设施）

| # | 盲点 | 严重程度 | 影响 |
|---|------|----------|------|
| B1 | **上下文压缩未激活** | CRITICAL | 长对话必然 crash（ContextWindowExceeded） |
| B2 | **Token 计数缺失** | CRITICAL | 无法判断何时需要压缩，也无法向客户端报告使用率 |
| B3 | **模型切换无上下文适配** | HIGH | 从大 context window 模型切到小模型时对话丢失 |
| B4 | **无逐条消息独立存储** | HIGH | 性能恶化 + 无选择性恢复 |
| B5 | **无 checkpoint 版本序列** | MEDIUM | 只有最新快照，无法回滚 |
| B6 | **无系统提示模型适配** | MEDIUM | 所有模型用相同系统提示 |
| B7 | **无增量上下文 diffing** | LOW | 每轮重发完整上下文，带宽浪费 |

### 7.2 断点（代码路径存在但未接通）

| # | 断点 | 文件 | 行为 | 修复路径 |
|---|------|------|------|----------|
| D1 | `compactRequired` 永远 false | `orchestration.ts:296` | 永远不触发压缩 | 连接 `CompactBoundaryManager` 到 scheduler signals |
| D2 | `CompactDelegate.requestCompact()` 返回空 | `runtime-mainline.ts:517-519` | 压缩请求空返回 | 实现 LLM 摘要压缩或截断降级 |
| D3 | context-core RPC stub 返回 `phase: "stub"` | `context-core/src/index.ts:135-158` | 3 个 context 端点返回假数据 | RH4/RHX2 scope: 实现 real RPC |
| D4 | token 计数只有累计总数，无逐条累计 | `kernel/state.ts` | 无法判断哪条消息消耗了多少 token | 实现 per-message token estimation |
| D5 | `GET /sessions/{id}/context` 返回 stub | orchestrator-core 路由到 context-core stub | 客户端无法获取真实 context 状态 | RH4 scope |

### 7.3 逻辑错误

| # | 错误 | 文件 | 说明 |
|---|------|------|------|
| L1 | `readLlmRequestEvidence` 只从第一条消息取 `model_id` | `runtime-mainline.ts:179-201` | 如果对话历史中有多条消息携带不同 `model_id`，只有第一条生效。后续轮次虽然可以传 `model_id`，但 kernel snapshot 中的历史消息仍保留旧 `model_id`，可能混淆。 |
| L2 | 硬编码 fallback 仅 2 个模型 | `gateway.ts:21-57` | 当 D1 不可用且请求的 model_id 不是 granite 或 llama-4-scout 时，模型选择失败。没有 "closest match" 降级策略。 |
| L3 | `auto_compact_token_limit` 概念不存在 | 全局 | 没有 per-model 压缩阈值。如果未来激活压缩机制，需要添加此概念。 |
| L4 | DO storage 单 blob 检查点无 size 限制 | `session-do-persistence.ts` | 长对话 + 多轮工具调用可能产生巨大 checkpoint blob，Cloudflare DO storage 有 128KB per value 的 practical 限制（软限制），超限可能静默失败。 |

### 7.4 事实认知混乱

| # | 混乱 | 说明 |
|---|------|------|
| C1 | charter RH2 声称 "GET /sessions/{id}/context 与 InspectorFacade 数据互通 | 实际 context-core RPC 返回 `phase: "stub"`，没有真实数据互通 |
| C2 | charter RH2 声称 "POST snapshot/compact 工作" | 两个 POST 端点存在但 context-core 返回 stub |
| C3 | DDL `context_window` 字段是 INTEGER 但实际使用时部分模型需要 REAL（如 0.95 factor） | 应区分 `context_window`（模型原始上限）和 `effective_context_window`（实际可用上限） |
| C4 | `ModelCapabilities` runtime 接口有 `maxOutputTokens` 和 `contextWindow`，但 D1 表不存 `max_output_tokens` | runtime 硬编码 `maxOutputTokens: 8192`，与部分模型的实际限制不匹配 |
| C5 | `is_reasoning` 是 0/1 布尔，但 runtime `reasoningEfforts` 是三档数组 | D1 无法存储 per-model 的 reasoning effort 可选值 |
| C6 | Checkpoint 被 DO 存储为单 blob，但 `nano_conversation_messages` 表存了独立的 message rows | 两个写入路径（DO 和 D1）之间没有原子性保证，可能不一致 |

---

## 8. 建议的改进方向

### 8.1 P0（立即需要，阻塞生产使用）

1. **激活上下文压缩机制**：连接 `CompactBoundaryManager` 到 scheduler signals，实现 `compactRequired` 的判断逻辑（基于 per-model `auto_compact_pct`），将 `CompactDelegate.requestCompact()` 从 no-op 改为真实的 LLM 摘要压缩或截断降级。

2. **实现 token 计数**：在 context assembler 或 kernel 层添加 per-message token estimation（可以用字符数/4 启发式），为压缩判断和客户端 `/context` 报告提供数据。

3. **添加 `max_output_tokens` 和 `effective_context_pct` 字段到 DDL**：这是激活压缩机制的前提。

### 8.2 P1（短期改进，提升健壮性）

4. **模型切换注入标记**：当 `model_id` 在不同 turn 之间变化时，注入 `<model_switch>` 类型的消息到 context，让 LLM 知道上下文切换。

5. **Reasoning effort 映射**：当模型切换时，映射旧模型的 reasoning effort 到新模型支持的级别。

6. **Context window overflow 降级**：当 context 超出当前模型的 `context_window * effective_context_pct` 时，自动触发截断（移除最旧的消息直到满足预算）。

7. **GET /sessions/{id}/context 真实化**：将 context-core 从 stub 切换到真实实现，返回当前 context 使用率、layer 信息、压缩状态。

### 8.3 P2（中期改进，增强体验）

8. **多版本 checkpoint 序列**：在 DO storage 中保存多个 checkpoint（最近 N 个 turn），支持 undo last turn。

9. **Per-model 系统提示**：添加 `base_system_prompt_suffix` 字段到 DDL，让不同模型有定制化的提示前缀。

10. **逐条消息独立存储优化**：将长对话的消息从 DO storage blob 迁移到增量存储结构（如 D1 分页），减少 DO storage 压力。

11. **客户端 context 使用率 API**：通过 `GET /sessions/{id}/context` 返回 `totalTokens`、`maxTokens`、`percentage`、`pendingCompactJobs`，让客户端展示上下文使用率。

### 8.4 P3（长期，留给 hero-to-platform）

12. **远程 ThreadStore API**：跨设备 session 恢复。

13. **Per-team billing/quota 字段**：`daily_token_budget`、`daily_request_budget`。

14. **Multi-provider 支持**：`provider_name`、`provider_model_id`、`api_endpoint`。

---

## 附录 A：nano-agent 关键代码路径索引

| 功能 | 文件路径 | 关键函数/结构 |
|------|----------|---------------|
| 模型 DDL | `workers/orchestrator-core/migrations/003-usage-quota-and-models.sql` | `nano_models` 表 |
| 运行时模型注册 | `workers/agent-core/src/llm/registry/models.ts` | `ModelCapabilities` 接口 |
| 硬编码 fallback | `workers/agent-core/src/llm/gateway.ts:21-57` | 2 个模型 |
| GET /models | `workers/orchestrator-core/src/index.ts:1326-1426` | `handleModelsList()` |
| 模型鉴权 | `workers/orchestrator-core/src/user-do/surface-runtime.ts:369-405` | `requireAllowedModel()` |
| NACP 消息 schema | `packages/nacp-session/src/messages.ts` | `model_id` + `reasoning` 字段 |
| 上下文拼接 | `workers/agent-core/src/host/runtime-mainline.ts:162-177` | `withNanoAgentSystemPrompt()` |
| Token 累计 | `workers/agent-core/src/kernel/reducer.ts` | `totalTokens` 累加 |
| 压缩调度 | `workers/agent-core/src/kernel/scheduler.ts:50-52` | `compactRequired: false` (永远) |
| 压缩委托 | `workers/agent-core/src/host/runtime-mainline.ts:517-519` | `requestCompact() { return { tokensFreed: 0 }; }` |
| 压缩边界管理 | `workers/context-core/src/compact-boundary.ts` | `CompactBoundaryManager` |
| 压缩预算策略 | `workers/context-core/src/budget/policy.ts` | 75%/95% 阈值定义 |
| 压缩通知 | `packages/nacp-session/src/adapters/compact.ts` | `compactNotifyToStreamEvent()` |
| Checkpoint 持久化 | `workers/agent-core/src/host/do/session-do-persistence.ts` | `persistCheckpoint()` / `restoreFromStorage()` |
| Context 端点 | `workers/orchestrator-core/src/index.ts:1441-1522` | `handleSessionContext()` |
| Context-core RPC stub | `workers/context-core/src/index.ts:135-203` | `phase: "stub"` |
| Inspector Facade | `workers/context-core/src/inspector-facade/index.ts` | 真实实现但默认 disabled |

## 附录 B：Codex CLI 核心架构索引

| 功能 | 文件路径 | 关键概念 |
|------|----------|----------|
| 模型元数据 | `codex-rs/protocol/src/openai_models.rs` | `ModelInfo` 丰富结构 |
| 模型管理 | `codex-rs/models-manager/src/manager.rs` | 远程 `/models` + 5min 缓存 |
| 上下文管理 | `codex-rs/core/src/context_manager/history.rs` | `ContextManager` + 版本号 |
| 压缩 | `codex-rs/core/src/compact.rs` | inline + remote 策略 |
| 模型切换 | `codex-rs/core/src/context/model_switch_instructions.rs` | `<model_switch>` 片段 |
| Thread 存储 | `codex-rs/thread-store/src/store.rs` | `ThreadStore` trait |
| Token 估算 | `codex-rs/utils/token_estimation/` | 字节启发式 |

## 附录 C：Gemini CLI 核心架构索引

| 功能 | 文件路径 | 关键概念 |
|------|----------|----------|
| 模型配置 | `packages/core/src/config/models.ts` | 静态别名 + 链式继承 |
| Token 限制 | `packages/core/src/core/tokenLimits.ts` | 硬编码 per-model |
| 上下文管理 | `packages/core/src/context/contextManager.ts` | Episodic Context Graph |
| 压缩服务 | `packages/core/src/context/chatCompressionService.ts` | 两阶段摘要 + 截断 |
| 文件级压缩 | `packages/core/src/context/contextCompressionService.ts` | 文件状态机 (FULL/PARTIAL/SUMMARY/EXCLUDED) |
| Chat 录制 | `packages/core/src/services/chatRecordingService.ts` | JSONL + RewindRecord |
| Checkpoint | `packages/core/src/utils/checkpointUtils.ts` | Git snapshot |