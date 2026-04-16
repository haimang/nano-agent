# Nano-Agent LLM Wrapper 功能簇设计

> 功能簇: `LLM Wrapper`
> 讨论日期: `2026-04-16`
> 讨论者: `GPT-5.4`
> 关联调查报告:
> - `docs/investigation/mini-agent-by-opus.md`
> - `docs/investigation/codex-by-opus.md`
> - `docs/investigation/claude-code-by-opus.md`
> - `docs/nacp-by-opus.md`
> - `docs/value-proposition-analysis-by-GPT.md`
> - `README.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

### 0.1 为什么现在必须先冻结 LLM Wrapper

nano-agent 要跑在 **Cloudflare Workers / V8 isolate / Durable Object / WebSocket-first** 的宿主里，而不是传统本地 CLI 的 Node.js / Rust / Linux 进程里。这意味着 LLM 请求层不是一个“换个 SDK 就行”的问题，而是整个 agent runtime 的**推理边界**：

1. 它决定系统如何把上下文、工具结果、多模态输入转换成真正发给模型的请求；
2. 它决定系统如何把 provider 的流式输出，转换成 nano-agent 内部可消费、可恢复、可通过 WebSocket 分发的会话事件；
3. 它决定我们是否会被某一家 provider 的专有 wire protocol、SDK、beta header 和缓存语义反向绑定。

因此，LLM Wrapper 在 nano-agent 里不是“SDK 封装”，而是：

- **请求归一化层**
- **provider / model 注册层**
- **流式输出归一化层**
- **大附件 staging 与 URL 代理层**
- **推理执行边界**

### 0.2 前置共识

- nano-agent 是 **Cloudflare-native 的持久化 agent runtime**，不是跑在 Worker 里的缩水 CLI。
- v1 **只支持 OpenAI-compatible Chat Completions** 作为对外模型请求 wire。
- v1 要为 **多 provider** 做准备，但只接入那些能稳定提供 **Chat Completions 请求 / 流式回调语义** 的 provider。
- 由于 Worker 内存与请求体上限，**大图片 / 大文件默认不走 inline binary**，而是走 **R2 staged object + 短时 URL / proxy URL**。
- nano-agent 的 client 通信是 **WebSocket-first**，provider 通信是 **HTTPS-first**；两者之间必须有一层流式事件归一化。
- 当前 NACP 已明确区分 **NACP-Core** 与 **NACP-Session**；LLM Wrapper 设计必须服从这个分层，而不是把 provider wire 直接暴露成 session 协议。

### 0.3 显式排除的讨论范围

- 不讨论具体 provider 商务选择
- 不讨论训练 / 微调 / embedding / rerank
- 不讨论浏览器视觉能力本体，只讨论多模态输入如何进入模型层
- 不讨论完整 context compaction 设计，只讨论 compaction 产物如何进入请求层
- 不讨论 Hooks 事件目录是否增加 `PreModelInvoke` 一类事件

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`LLM Wrapper`
- **一句话定义**：LLM Wrapper 是 nano-agent 的**模型执行抽象层**，负责把内部统一消息模型、安全地映射到 Chat Completions 兼容 provider，并把 provider 输出归一化回 nano-agent 会话流。
- **边界描述**：
  - **包含**：请求构建、provider registry、model capability registry、附件 staging、stream normalization、usage / error normalization、执行与重试
  - **不包含**：工具执行本体、context 压缩算法本体、权限系统本体、客户端 UI 本体

### 1.2 关键术语对齐

| 术语 | 定义 | 备注 |
|------|------|------|
| **Canonical Message** | nano-agent 内部统一消息结构 | 不是 OpenAI 原始 JSON |
| **AttachmentRef** | 对图片 / 文件 / 提取文本等输入物料的引用 | 默认指向 R2 或其衍生产物 |
| **Provider Registry** | provider 配置注册表 | 定义 base URL、auth、headers、timeout、retry |
| **Model Profile** | 模型能力描述对象 | 定义是否支持 vision、tool call、json schema、stream 等 |
| **ChatCompletionAdapter** | 将 canonical request 映射为 Chat Completions 请求的适配器 | v1 核心扩展点 |
| **LLM Executor** | 真正发起模型请求并消费流式回包的执行器 | 支持 abort / timeout / retry |
| **Stream Normalizer** | 把 provider SSE / chunk 归一化为内部事件 | 供 agent loop 与 WebSocket session 消费 |
| **Prepared Artifact** | 已完成预处理、可安全进入 LLM 请求的附件 | 例如 OCR 文本、缩略图 URL、结构化摘要 |
| **Execution Target** | 执行目标位置 | v1 实装 `local-fetch`，预留 `service-binding-gateway` |

### 1.3 参考调查报告

- `docs/investigation/mini-agent-by-opus.md` — LLM facade 与双协议薄封装
- `docs/investigation/codex-by-opus.md` — Responses API 单 wire + provider registry + SSE/WebSocket
- `docs/investigation/claude-code-by-opus.md` — Anthropic 语义中心的重型请求构建、重试、缓存、多 provider 变体

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- **架构角色**：模型执行边界 + 推理协议适配层
- **服务对象**：
  1. Session agent loop
  2. Context 管理与 compact 产物
  3. Tool loop（tool results 回填）
  4. WebSocket session stream
  5. 审计 / usage / 计费

- **它依赖于**：
  - Durable Object 会话状态
  - R2 / KV / 预处理服务
  - Provider secrets / service bindings / fetch
  - NACP-Session 流事件模型

- **它被下游依赖于**：
  - Agent loop 的“下一步动作”判断
  - Tool call 调度
  - Context compaction 触发
  - Hooks / audit / metrics
  - Client 实时输出体验

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|------------|----------|----------|------|
| **上下文管理** | 双向 | 强 | compaction 结果、历史切片、附件摘要都要进入请求 |
| **Tool Use** | 双向 | 强 | tool schema 发给模型；tool result 回填消息历史 |
| **Hooks** | LLM -> Hooks | 中 | v1 不新增 model hook 事件，但 wrapper 的执行结果会被审计与 session stream 消费 |
| **Fake Bash / Capability Runtime** | Tool -> LLM | 中 | fake bash 最终作为 tool schema / tool result 进入模型 |
| **R2 / Artifact 服务** | 双向 | 强 | 多模态与大文件输入必须经过 staging / 预处理 |
| **NACP-Session** | LLM -> Session | 强 | provider stream 不能直接透传，必须归一化后进入 session event |
| **NACP-Core** | 预留 | 中 | v1 不强制协议化 provider 调用，但要预留 `llm.invoke` 边界 |
| **WebSocket Client** | Session -> Client | 强 | client 看到的是统一会话流，不是 provider 原生 SSE |
| **Skill** | Skill -> LLM | 中 | skill 产出的上下文与工具会进入 LLM 请求，但 skill 不直接操纵 provider wire |

### 2.3 一句话定位陈述

> 在 nano-agent 里，`LLM Wrapper` 是 **模型执行边界与协议归一化层**，负责 **把内部统一消息模型映射到 Chat Completions 兼容 provider，再把输出映射回 WebSocket-first 的 session 流**；它对上游屏蔽 provider 差异，对下游约束请求格式、附件进入方式、错误与 usage 的统一语义。

---

## 3. 精简 / 接口 / 解耦 / 聚合策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考实现来源 | 砍的理由 | 未来是否可能回补 |
|--------|--------------|----------|------------------|
| 原生 Anthropic Messages wire | mini-agent / claude-code | 会把 wrapper 重新拉回多协议、多语义世界 | 可能，但不是 v1 |
| OpenAI Responses API 作为主 wire | codex | 对 nano-agent 当前目标过重，且与 Chat Completions 兼容策略冲突 | 可能 |
| provider SDK 全家桶 | mini-agent / claude-code | Worker 侧应优先 `fetch` + typed adapter，避免 SDK 体积与宿主假设 | 低 |
| provider 特有 beta / prompt cache 语义作为核心 API | claude-code | 会把内部抽象锁死在 Anthropic 风格上 | 可能 |
| inline 大图片 / 大文件 | 本地 CLI 直觉 | 128MB isolate 下风险太高 | 否 |
| 直接把 provider SSE 透传给 client | 常见薄代理做法 | 会让 session 协议失控，重连与恢复无法统一 | 否 |
| 在 wrapper 内部做 sub-agent / agent orchestration | codex / claude-code | nano-agent 当前是单 agent、单线程 | 中期再议 |
| “文件 URL 一律直接给模型” | 粗暴多模态代理 | 并非所有 provider / 模型都支持任意文件 URL | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来可能的演进方向 |
|--------|----------|------------|---------------------|
| Execution Target | `local-fetch \| service-binding-gateway` | v1 只实现 `local-fetch` | 推理网关独立 worker |
| Provider Adapter | `ChatCompletionAdapter` 接口 | v1 只支持 chat-completion adapter | 增加 responses / anthropic / gateway adapter |
| Attachment Strategy | `inline \| signed-url \| proxy-url \| prepared-text` | v1 默认非文本走 URL / prepared-text | 更细粒度的 provider 策略 |
| Structured Output | `supportsJsonSchema` capability | v1 仅在 provider 宣称支持时透传 | 增加严格校验与 fallback |
| Reasoning Channel | normalized event 可带 `channel` 字段 | v1 不要求 provider 提供独立 reasoning | 增加 reasoning delta 语义 |
| NACP-Core LLM Domain | `llm.invoke.request/response` | v1 仅留 seam，不冻结消息 | 后续在 NACP action-plan 中补齐 |

### 3.3 完全解耦点（哪里必须独立）

- **Canonical message model 独立**  
  不能把 OpenAI Chat Completions 的 request body 当作内部真相。

- **Provider registry 与 adapter 独立**  
  配置、能力描述、请求映射三者要拆开，避免 registry 变成大杂烩。

- **Attachment staging 独立**  
  大文件 / 图片 / OCR / 摘要不是 provider adapter 的职责。

- **Stream normalization 独立**  
  provider chunk 到 session event 的映射不能散落在 agent loop。

- **Error / usage normalization 独立**  
  调用方只能处理统一错误种类与统一 usage 结构。

### 3.4 聚合点（哪里要刻意收敛）

- **所有 provider / model 元数据都进单一 `ModelRegistry`**
- **所有请求构建都经过 `CanonicalRequestBuilder`**
- **所有附件进入策略都经过 `AttachmentPlanner`**
- **所有执行都经过 `LLMExecutor.execute()`**
- **所有 provider 流事件都经过 `StreamNormalizer`**
- **所有 client 可见事件都经过 `SessionStreamAdapter`**

---

## 4. 三个代表 Agent 的实现对比

### 4.1 mini-agent 的做法

- **实现概要**：用 `LLMClientBase` + `AnthropicClient` + `OpenAIClient` 做一个很薄的 facade，然后由 `LLMClient` 根据 provider 选择具体实现；同时对 MiniMax 的 `api_base` 做后缀重写（`/anthropic` 或 `/v1`）。
- **亮点**：
  - 体量小，容易读
  - facade 层明确
  - 双协议切换直接
- **值得借鉴**：
  - 小而清楚的抽象边界
  - provider 选择不要嵌进 agent loop
- **不打算照抄的地方**：
  - 内部消息模型过薄，几乎贴着 provider wire 走
  - adapter 与 request normalization 混在一起
  - finish_reason / reasoning 等细节容易失真

### 4.2 codex 的做法

- **实现概要**：围绕 `Responses API` 建了很强的三层结构：provider registry、`codex-api` transport、`core` 中的 turn-scoped `ModelClientSession`；优先 WebSocket，失败后回退 HTTP SSE。
- **亮点**：
  - provider / transport / session 分层干净
  - `ModelProviderInfo` 非常成熟
  - 请求与 session 元数据、turn-state、重连控制很完整
- **值得借鉴**：
  - registry 先于 adapter
  - turn/session 级流状态要单独建模
  - client 可见流与 provider 连接状态要分开
- **不打算照抄的地方**：
  - 过于锁定 `Responses API`
  - WebSocket to provider 的复杂度不适合 nano-agent v1
  - 其 transport 工程量与当前目标不匹配

### 4.3 claude-code 的做法

- **实现概要**：以 Anthropic Messages / beta messages 语义为中心，外层做 `getAnthropicClient()` 工厂，把 first-party / Bedrock / Foundry / Vertex 都折叠进同一个客户端形状；上层 `claude.ts` 再处理 betas、prompt caching、context management、media 限制、tool search、retry/fallback。
- **亮点**：
  - 请求构建极成熟
  - provider 变体接入深
  - prompt / cache / tool / media / retries 这些真实问题都考虑到了
- **值得借鉴**：
  - wrapper 不只是 SDK 封装，而是请求管线
  - 多模态 / 流式 / cache / fallback 必须进入同一设计图
  - provider client factory 与 request builder 要分层
- **不打算照抄的地方**：
  - Anthropic 语义过重，不适合作为 nano-agent 的公共内核
  - beta header / cache_control / thinking 细节过深，不该成为 v1 抽象负担
  - Node 侧重型实现不适配 Worker 的体积与宿主限制

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | nano-agent 倾向 |
|------|-----------|-------|-------------|------------------|
| 主 wire | Anthropic + Chat Completions | Responses API | Anthropic Messages | Chat Completions |
| 抽象层次 | 低 | 中高 | 很高 | 中高 |
| provider registry | 弱 | 强 | 中 | 强 |
| transport 复杂度 | 低 | 很高 | 高 | 中 |
| 多模态处理 | 弱 | 中 | 强 | 中高 |
| provider 语义绑定 | 低 | 绑定 OpenAI Responses | 绑定 Anthropic | 绑定 Chat Completions 兼容层 |
| 对 Worker 宿主适配度 | 一般 | 低 | 低 | 高 |
| 适合作为 nano-agent 蓝本的部分 | facade | registry + session thinking | request pipeline | registry + canonicalization + staging |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（nano-agent v1 要做）

- **[S1] Canonical Message / Request / Result 内部模型**  
  没有这个统一层，就无法避免被 provider JSON 反向污染。

- **[S2] Provider Registry + Model Registry**  
  必须先定义 provider / model 元数据与 capability，再谈多 provider。

- **[S3] ChatCompletionAdapter 接口**  
  v1 的唯一对外 provider wire。

- **[S4] AttachmentPlanner + R2 Staging**  
  这是 Worker 宿主下多模态可行性的前提。

- **[S5] LLMExecutor（stream / abort / timeout / retry）**  
  没有独立执行器，就无法管理流式请求生命周期。

- **[S6] StreamNormalizer**  
  provider 的 chunk 必须转成内部统一事件。

- **[S7] Usage / Error Normalization**  
  计费、审计、UI 和上层 agent loop 只能面对统一结果。

- **[S8] NACP-Session 对齐的会话流映射**  
  client 看到的是 session event，不是 provider 原始回包。

- **[S9] Prepared Artifact 接口**  
  大文件不一定能直接喂模型，但必须先有“预处理后再进入 LLM”的标准入口。

- **[S10] TypeScript 守卫与 capability 校验**  
  某模型不支持 tool / image / json schema 时，必须在请求前被挡住。

### 5.2 Out-of-Scope（nano-agent v1 不做）

- **[O1]** Anthropic native Messages adapter
- **[O2]** OpenAI Responses API adapter
- **[O3]** provider 原生 WebSocket / Realtime adapter
- **[O4]** 复杂 provider-specific prompt cache / cache breakpoint 策略
- **[O5]** 任意二进制 inline 提交
- **[O6]** 任意文件类型直接 URL 喂给模型的通用保证
- **[O7]** 在 wrapper 内部做 agent / sub-agent orchestration
- **[O8]** 完整 `llm.invoke` NACP-Core 消息冻结
- **[O9]** provider SDK 并行支持矩阵
- **[O10]** 模型路由优化 / 自动 A/B / 动态挑 provider

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 |
|------|------|------|
| 小图片能否 inline | in-scope，但默认不鼓励 | 可以保留阈值接口，但默认仍走 URL staging |
| 大文档是否直接喂给 Chat Completions | out-of-scope | v1 只保证 `Prepared Artifact` 或文本抽取进入请求 |
| JSON Schema 输出 | in-scope（能力受限） | 仅当 model capability 明确支持时透传 |
| reasoning 单独频道 | out-of-scope（强保证） | v1 不把它作为稳定跨 provider 合同 |
| LLM 执行是否走 NACP-Core | 预留接口 | v1 先 local-fetch，后续再协议化 |
| client 是否看到逐 token 输出 | in-scope | 但看到的是 normalized delta，不是 provider 原始 SSE |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **我们选择“只支持 Chat Completions”而不是“一开始就多 wire 并存”**
   - **为什么**：现在最重要的是收敛抽象面，先把多 provider 与 Worker 宿主约束处理好。
   - **我们接受的代价**：一些 Responses API / Anthropic Messages 的高级能力先不用。
   - **未来重评条件**：当 Chat Completions 无法覆盖必要模型能力时，再引入第二 wire。

2. **我们选择“内部 canonical model”而不是“直接用 provider request body 当内部格式”**
   - **为什么**：否则未来每新增一个 provider，整个 agent loop 都会被迫理解它的 JSON 细节。
   - **我们接受的代价**：需要写映射与验证代码。
   - **未来重评条件**：无；这是结构性原则。

3. **我们选择“R2 staged attachment + URL / prepared artifact”而不是“直接 inline binary”**
   - **为什么**：这才符合 V8 isolate 的内存边界，也更接近 Cloudflare 平台优势。
   - **我们接受的代价**：多一步 staging 与 URL 生命周期管理。
   - **未来重评条件**：只有在确认极小文件 inline 带来明显价值时，才局部放开。

4. **我们选择“registry 先于 adapter”而不是“先写几个 provider if/else”**
   - **为什么**：多 provider 的难点不在 `fetch`，而在能力描述、约束校验、默认行为与错误语义。
   - **我们接受的代价**：设计前期需要更清晰的数据结构。
   - **未来重评条件**：无；这是避免后期重构爆炸的关键。

5. **我们选择“normalized session event”而不是“透传 provider SSE”**
   - **为什么**：WebSocket 重连、resume、审计、跨 provider 一致性都要求统一事件层。
   - **我们接受的代价**：会损失部分 provider 私有事件细节。
   - **未来重评条件**：如确有必要，可增加 debug passthrough，但不作为默认协议。

6. **我们选择“v1 本地执行、预留远端网关”而不是“立刻把 LLM 调用协议化成独立 worker”**
   - **为什么**：NACP 目前还没有 LLM domain；过早协议化会制造一层尚未冻结的复杂度。
   - **我们接受的代价**：provider 调用暂时还在 session worker 侧完成。
   - **未来重评条件**：当需要集中管控密钥、限流、模型路由时，再补 `llm.invoke` Core 域。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| Chat Completions 兼容层不够兼容 | 不同 provider 的“兼容 OpenAI”程度不同 | adapter 逻辑碎裂 | capability registry + provider notes + request validator |
| 大附件 staging 带来额外延迟 | 图片 / 文件要先入 R2 | 首 token 变慢 | 区分预上传与按需上传；缓存 prepared artifact |
| provider 返回流格式不稳定 | SSE chunk 字段差异 | stream normalizer 复杂 | 每个 adapter 自己负责 provider chunk 解析，向上只出统一事件 |
| 过早支持太多多模态类型 | 文档 / 音频 / 图像要求不同 | 请求模型失控 | v1 只稳定支持文本 + 图像 URL + prepared artifact |
| 重试策略误伤 | 429 / 5xx / 超时处理不当 | 放大成本或体验变差 | 统一重试分类；支持 `Retry-After`；严格 attempt 上限 |
| usage 不一致 | provider 统计字段差异 | 计费与观测失真 | 统一 usage 结构，缺失字段显式为空而非伪造 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：先冻结一个最小但正确的模型执行边界，避免未来每加一个 provider 都要返工整个 agent loop。
- **对 nano-agent 的长期演进**：给多 provider、多模态、独立 inference worker 留好了入口，但第一版不被这些复杂度拖死。
- **对“上下文管理 / Skill / 稳定性”三大深耕方向的杠杆作用**：
  - 上下文管理：有稳定 request builder 才能做 context 分层与 compact 接缝
  - Skill：skill 产出的内容只有进入 canonical message 才能可靠被模型消费
  - 稳定性：统一 timeout / retry / stream / usage / error 是平台级基础设施

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | **一句话收口目标** |
|------|--------|------|---------------------|
| F1 | Canonical Model | 定义内部消息、请求、结果、事件结构 | agent loop 完全不感知 provider 原始 JSON |
| F2 | Model Registry | 注册 provider、model、capability、默认参数 | 请求前能回答“这个模型能不能做这件事” |
| F3 | Attachment Planner | 决定附件是 inline、URL 还是 prepared artifact | 大附件进入路径统一且可审计 |
| F4 | ChatCompletionAdapter | 负责具体 provider 请求 / 流解析 | v1 所有 provider 都通过同一 adapter 接口接入 |
| F5 | LLM Executor | 发请求、消费流、处理 abort/timeout/retry | 单次模型调用生命周期有统一控制中心 |
| F6 | Stream Normalizer | 把 provider chunk 转成内部事件 | 上层只处理统一 delta / tool / completed / failed 事件 |
| F7 | Usage + Error Normalizer | usage、finish_reason、错误分类统一 | 计费与错误处理不依赖 provider 私有字段 |
| F8 | Session Stream Adapter | 映射到 NACP-Session 的会话输出事件 | WebSocket client 看到稳定一致的模型流 |
| F9 | Prepared Artifact Contract | 预处理产物进入 LLM 的统一接口 | 文档、图片、OCR、摘要等都能通过统一 ref 进入请求 |

### 7.2 详细阐述

#### F1: `Canonical Model`

- **输入**：session history、system prompt、tool schemas、artifact refs、compact 产物
- **输出**：`CanonicalLLMRequest`
- **建议结构**：

  ```ts
  type CanonicalContentPart =
    | { kind: 'text'; text: string }
    | { kind: 'image-ref'; artifactId: string }
    | { kind: 'file-ref'; artifactId: string }
    | { kind: 'tool-call'; toolCallId: string; name: string; arguments: unknown }
    | { kind: 'tool-result'; toolCallId: string; content: string }

  type CanonicalMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool'
    parts: CanonicalContentPart[]
  }

  type CanonicalLLMRequest = {
    requestId: string
    providerId: string
    modelId: string
    messages: CanonicalMessage[]
    tools?: CanonicalToolSchema[]
    responseFormat?: CanonicalResponseFormat
    maxOutputTokens?: number
    metadata?: Record<string, string>
  }
  ```

- **关键点**：
  - 该模型必须与 provider request body 彻底脱钩
  - `artifactId` 只引用物料，不直接带大对象
  - 多模态和 tool call 都进入同一内部消息模型
- **一句话收口目标**：✅ **LLM 上游模块不再需要理解 OpenAI Chat Completions 的原始字段结构**

#### F2: `Model Registry`

- **输入**：静态配置、环境变量、平台默认值
- **输出**：`ProviderProfile` 与 `ModelProfile`
- **建议字段**：

  | 对象 | 关键字段 |
  |------|----------|
  | `ProviderProfile` | `providerId`, `baseUrl`, `auth`, `defaultHeaders`, `timeoutMs`, `retryPolicy`, `executionTarget` |
  | `ModelProfile` | `modelId`, `providerId`, `supportsStreaming`, `supportsToolCalls`, `supportsVision`, `supportsJsonSchema`, `maxInlineBytes`, `notes` |

- **关键点**：
  - provider 能力与 model 能力不能混淆
  - “兼容 OpenAI”不等于所有字段都支持，必须显式 capability 化
  - registry 是请求前校验的唯一真相来源
- **一句话收口目标**：✅ **任何一次模型调用都能在发请求前完成 capability 校验与默认值决策**

#### F3: `Attachment Planner`

- **输入**：`AttachmentRef[]`、model capability、artifact metadata
- **输出**：`PlannedAttachment[]`
- **核心逻辑**：
  1. 判断该附件是否允许直接进入当前模型
  2. 判断走 `signed-url`、`proxy-url`、`prepared-text` 还是拒绝
  3. 为图片生成可短时访问 URL
  4. 对文档优先要求预处理为文本 / 摘要，而不是盲目把文件 URL 传给模型

- **明确立场**：
  - **图片**：v1 可稳定支持 URL 进入 Chat Completions
  - **文档/PDF/大文件**：v1 不保证 raw file URL 直喂；推荐先经预处理得到 `Prepared Artifact`

- **一句话收口目标**：✅ **所有非文本输入都先经过统一规划后才能进入 provider 请求**

#### F4: `ChatCompletionAdapter`

- **输入**：`CanonicalLLMRequest`
- **输出**：
  - provider request body
  - provider stream parser
  - normalized completion result

- **建议接口**：

  ```ts
  interface ChatCompletionAdapter {
    buildRequest(input: CanonicalLLMRequest): Promise<RequestInit & { url: string }>
    parseStream(response: Response): AsyncGenerator<AdapterChunk, AdapterFinalResult>
    parseNonStream(response: Response): Promise<AdapterFinalResult>
  }
  ```

- **关键点**：
  - adapter 负责 provider 私有 JSON 与 SSE 解析
  - adapter 不负责 session stream 广播
  - adapter 不负责附件 staging
- **一句话收口目标**：✅ **接入新 provider 时只需新增 adapter 与 registry，不需改 agent loop**

#### F5: `LLM Executor`

- **输入**：`CanonicalLLMRequest`
- **输出**：`AsyncGenerator<NormalizedLLMEvent, CanonicalLLMResult>`
- **职责**：
  - 发起 `fetch`
  - 注入超时与 `AbortSignal`
  - 处理 retriable / non-retriable 错误
  - honor `Retry-After`
  - 统计 attempt、总耗时、最终 usage

- **推荐事件**：

  ```ts
  type NormalizedLLMEvent =
    | { type: 'llm.request.started'; requestId: string; modelId: string }
    | { type: 'llm.output.delta'; requestId: string; channel: 'text' | 'tool'; delta: string }
    | { type: 'llm.output.tool_call'; requestId: string; toolCallId: string; name: string; arguments: unknown }
    | { type: 'llm.usage'; requestId: string; usage: CanonicalUsage }
    | { type: 'llm.request.completed'; requestId: string; finishReason: CanonicalFinishReason }
    | { type: 'llm.request.failed'; requestId: string; error: CanonicalLLMError }
  ```

- **一句话收口目标**：✅ **单次模型调用的执行、取消、超时、重试与结束语义都集中在一个执行器中**

#### F6/F7: `Stream Normalizer` + `Usage/Error Normalizer`

- **输入**：adapter chunks / final result
- **输出**：统一事件与统一结果
- **关键点**：
  - `finish_reason` 统一归一到少量枚举：`stop | tool_call | length | content_filter | error | unknown`
  - usage 统一为：
    - `inputTokens`
    - `outputTokens`
    - `reasoningTokens?`
    - `cachedInputTokens?`
    - `totalTokens?`
  - provider 没给的字段显式为 `undefined`，而不是伪造
  - 错误统一为：
    - `auth`
    - `rate_limit`
    - `timeout`
    - `transport`
    - `provider_4xx`
    - `provider_5xx`
    - `invalid_request`
    - `unsupported_capability`

- **一句话收口目标**：✅ **上层永远只消费统一 finish reason、usage 和 error taxonomy**

#### F8: `Session Stream Adapter`

- **定位**：把 `NormalizedLLMEvent` 映射成 `NACP-Session` 的 `session.stream.event`
- **明确原则**：
  - 不把 provider 原生 chunk 直接发给 client
  - client 看到的是 nano-agent 会话语义，而不是 provider transport 语义
  - 保持 `stream_seq`、resume、重放语义与 Session profile 一致

- **建议 kinds**：
  - `llm.request.started`
  - `llm.output.delta`
  - `llm.output.tool_call`
  - `llm.request.completed`
  - `llm.request.failed`

- **一句话收口目标**：✅ **WebSocket client 可以跨 provider 稳定消费一致的模型输出流**

#### F9: `Prepared Artifact Contract`

- **定位**：给上下文预处理、OCR、图像缩放、摘要抽取等产物一个统一入口
- **示例**：

  ```ts
  type PreparedArtifact = {
    artifactId: string
    sourceKind: 'image' | 'document' | 'csv' | 'other'
    preparedKind: 'image-url' | 'plain-text' | 'markdown' | 'json-summary'
    storage: { kind: 'r2'; key: string }
    mimeType: string
    byteSize: number
  }
  ```

- **关键点**：
  - wrapper 不直接承担 OCR / PDF parse / CSV summarize
  - wrapper 只消费“已经准备好进入模型”的产物
- **一句话收口目标**：✅ **大文件进入模型前先被转化为可控、可复用、可缓存的 prepared artifact**

### 7.3 非功能性要求

- **性能目标**：首 token latency 应受控；大附件路径必须支持预上传，避免每次 turn 都重新上传
- **稳定性要求**：超时、429、5xx、断流、client 取消都必须有确定收口
- **可观测性要求**：request id、provider id、model id、attempt、usage、finish reason 必须全链路记录
- **安全性要求**：provider key 不进入 session payload；附件 URL 默认短时有效；错误信息避免泄漏敏感 headers
- **测试覆盖要求**：canonicalization、capability gating、attachment planning、retry、stream normalization、session mapping 都必须有测试

---

## 8. 可借鉴的代码位置清单

### 8.1 mini-agent

| 位置 | 借鉴点 | 用法 |
|------|--------|------|
| `context/mini-agent/mini_agent/llm/base.py` | 以抽象基类定义 provider client | 说明 facade 需要先有统一接口 |
| `context/mini-agent/mini_agent/llm/llm_wrapper.py` | wrapper 负责 provider 选择与 base URL 归一化 | 借鉴“provider 选择不进入 agent loop” |
| `context/mini-agent/mini_agent/llm/openai_client.py` | OpenAI path 中 reasoning/tool/messages 转换 | 提醒我们不要把 provider 字段直接当内部真相 |
| `context/mini-agent/mini_agent/llm/anthropic_client.py` | 双协议共享统一 `LLMResponse` 的思路 | 借鉴统一结果结构，但不照抄多协议本体 |

### 8.2 codex

| 位置 | 借鉴点 | 用法 |
|------|--------|------|
| `context/codex/codex-rs/model-provider-info/src/lib.rs` | 成熟的 provider registry 字段设计 | 作为 nano-agent provider/model registry 参考 |
| `context/codex/codex-rs/core/src/client.rs` | turn-scoped `ModelClientSession`、请求构建、transport fallback | 借鉴执行器与会话态分离 |
| `context/codex/codex-rs/codex-api/src/common.rs` | request / ws request 结构分离 | 借鉴“内部请求对象 != transport 载体” |
| `context/codex/codex-rs/codex-api/src/endpoint/responses.rs` | 流式 transport 单独封装 | 借鉴 transport 与 core 分层 |

### 8.3 claude-code

| 位置 | 借鉴点 | 用法 |
|------|--------|------|
| `context/claude-code/services/api/client.ts` | 同一客户端工厂支持 first-party / Bedrock / Foundry / Vertex | 借鉴 provider client factory 思路 |
| `context/claude-code/utils/model/providers.ts` | provider 选择层独立 | 借鉴 provider 识别与上层分离 |
| `context/claude-code/services/api/claude.ts` | 请求构建、media 限制、tool schema、betas、fallback 都在同一 request pipeline | 借鉴“wrapper 是请求管线，不只是 SDK 调用” |
| `context/claude-code/services/api/withRetry.ts` | 重试分类与 fallback 逻辑独立 | 借鉴 retry 与 request builder 解耦 |

---

## 9. 最终设计结论与价值评定

### 9.1 结论

nano-agent 的 LLM Wrapper 不应该走下面三条路中的任何一条极端：

1. **不是 mini-agent 式薄 facade**  
   太薄，会让 provider 语义直接渗进主循环。

2. **不是 codex 式单 wire 工程巨构**  
   太早、太重，会把我们绑定到 Responses API 与其 transport 复杂度。

3. **不是 claude-code 式 Anthropic 中心世界**  
   太强，但宿主与协议前提完全不同，不适合 Cloudflare-native v1。

我们要的，是一条明确的中线：

- **以 Chat Completions 为统一外部 wire**
- **以 canonical message model 为内部真相**
- **以 model/provider registry 管理能力边界**
- **以 R2 staged artifact 解决 Worker 多模态输入现实**
- **以 normalized session stream 对齐 WebSocket-first runtime**

### 9.2 对 NACP 的补充判断

- v1 **不应急着把 provider 调用本身硬塞进 NACP-Core**，因为当前协议家族尚未冻结 `llm.invoke` 域。
- 但 v1 **必须**保证：
  1. client-facing 输出走 `NACP-Session`
  2. wrapper 内部存在清晰的远端执行 seam
  3. 未来单独抽出 inference gateway 时，不需要重写上层 agent loop

换句话说，**现在先做“可协议化的本地执行边界”，而不是“为了协议而协议化”**。

### 9.3 最终 verdict

**这套设计值得冻结，并且应该成为 nano-agent 下一阶段实现的正式基础。**

它的价值不在于“先接很多模型”，而在于先把下面三件事做对：

1. **模型执行边界正确**
2. **Worker 宿主下的大附件输入路径正确**
3. **provider 输出到 session WebSocket 的归一化路径正确**

只要这三件事做对，后续无论是多 provider、独立 inference worker、上下文压缩增强，还是更复杂的 multimodal / skill / hook 联动，都会落在一个可持续扩展的骨架上。

