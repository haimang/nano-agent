# Nano-Agent 功能簇设计模板

> 功能簇: `RH5 Multi-Model Multimodal Reasoning`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + GPT-5.4`
> 关联调查报告:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/design/real-to-hero/RH2-models-context-inspection.md`
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`
> 文档状态: `draft`

---

## 0. 背景与前置约束

RH5 的目标不是“再多注册几个模型”，而是让模型选择、多模态输入和 reasoning 参数第一次贯通到真实 session surface：`GET /models` 已在 RH2 可读，RH4 file pipeline 已可上传 image，RH5 则把 `model_id`、`image_url`、`reasoning.effort` 这三条线一起接进 runtime。

- **项目定位回顾**：RH5 是 `multi-model / multimodal / reasoning enablement`。
- **本次讨论的前置共识**：
  - second provider 仍 out-of-scope，Workers AI 是唯一 required provider
  - per-model quota 默认不做，依赖 `RHX-qna` Q3 冻结
- **本设计必须回答的问题**：
  - `model_id` 如何从 public surface 一路透传到 canonical runtime？
  - 多模态与 reasoning 如何在不扩 provider scope 的前提下成立？
- **显式排除的讨论范围**：
  - DeepSeek / OpenAI Chat / Anthropic 真启用
  - per-model quota / billing / admin plane

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RH5 Multi-Model Multimodal Reasoning`
- **一句话定义**：`让客户端可以按 session 选择模型、上传 image、启用 reasoning effort，并由 Workers AI 真正执行。`
- **边界描述**：这个功能簇**包含** 13+4+8 模型 registry、`model_id` 透传、vision capability 激活、reasoning effort 贯通；**不包含**多 provider 路由、per-model quota、prompt caching。
- **关键术语对齐**：

| 术语 | 定义 | 备注 |
|------|------|------|
| model_id | 客户端显式指定的目标模型 | first-wave 可选但不能被 silent drop |
| multimodal | message content 含 `image_url` part | 依赖 RH4 file pipeline |
| reasoning effort | `low|medium|high` 推理强度提示 | 不支持的模型必须显式拒绝 |
| model registry | D1 `nano_models` + runtime capability 对齐 | `/models` 是对外视图 |

### 1.2 参考调查报告

- `docs/charter/plan-real-to-hero.md` — §7.6、§10.1、§12 Q4
- `docs/design/real-to-hero/RH2-models-context-inspection.md` — `/models` first-wave surface

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- RH5 在整体架构里扮演 **model capability activation** 的角色。
- 它服务于：
  - model picker client
  - multimodal chat / image understanding
  - reasoning-heavy task execution
- 它依赖：
  - RH2 的 `/models` endpoint 与 WS client capability
  - RH4 的 file pipeline
  - current Workers AI canonical runtime seam
  - RHX-qna Q3
- 它被谁依赖：
  - RH6 manual evidence 的 image / reasoning 场景
  - hero-to-platform 的 richer provider evolution

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|------------|----------|---------------------|------|
| RH2 Models | RH2 -> RH5 | 强 | `/models` 是 RH5 的外部目录面 |
| RH4 Files | RH4 -> RH5 | 强 | image input 依赖真实 file pipeline |
| agent-core LLM runtime | RH5 <-> runtime | 强 | `model_id` / reasoning / vision 都要进入 canonical request |
| usage evidence | RH5 -> usage | 中 | model_id 要进入 usage events，但不引入 per-model quota |

### 2.3 一句话定位陈述

> "在 nano-agent 里，`RH5 Multi-Model Multimodal Reasoning` 是 **把平台已有模型资产真正推到客户端和 runtime 主路径上的 phase**，负责 **开放模型选择、vision 输入和 reasoning effort**，对上游提供 **更强模型能力**，对下游要求 **这些能力必须是真运行、不是 registry 摆设**。"

---

## 3. 架构稳定性与未来扩展策略

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 / 诱因 | 砍的理由 | 未来是否可能回补 / 重评条件 |
|--------|------------------|----------|-----------------------------|
| 第二 provider 真启用 | “既然有 adapter skeleton 顺手接上” | 超出 RH5 scope | hero-to-platform |
| per-model quota | 贵模型天然诱发 | 会把 RH5 牵到 billing/admin plane | hero-to-platform |
| image_url silent-drop | 当前最省兼容路径 | 与 multimodal 目标直接冲突 | 否 |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 (函数签名 / 目录 / 配置字段 / 文档入口) | 第一版行为 | 未来可能的演进方向 |
|--------|--------------------------------------------------|------------|---------------------|
| `model_id` | session start/messages schema 字段 | client 可显式指定 | 后续支持 team default / per-model policy richer UI |
| reasoning | canonical request `reasoning.effort` | 仅 low/medium/high | future provider-specific richness |
| model registry | `nano_models` + runtime capability | 13+4+8 first-wave | 后续扩 provider / pricing / availability |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象**：model selection vs quota policy
- **解耦原因**：RH5 的目标是 capability enablement，不是 billing governance。
- **依赖边界**：usage 记录 `model_id`，但不在 RH5 决定 per-model budget policy。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象**：`model_id`、vision capability、reasoning effort
- **聚合形式**：统一收敛到 canonical request / runtime capability law
- **为什么不能分散**：否则客户端、schema、runtime 会各自理解“当前到底用了哪个模型”

---

## 4. 参考实现 / 历史 precedent 对比

### 4.1 当前 runtime 的做法

- **实现概要**：runtime 已有 model registry、vision capability check、Workers AI primary/fallback，但 public surface 还不能显式选择模型，也没有 reasoning 字段。
- **亮点**：
  - capability registry 已存在
  - image_url canonical part 已存在
- **值得借鉴**：
  - 继续用 canonical request 约束 provider 差异
- **不打算照抄的地方**：
  - 继续把默认模型硬编码成唯一可用路径

### 4.2 当前 public schema 的做法

- **实现概要**：`session.start` / public messages schema 还没有 `model_id`，reasoning 也未进入 client-facing surface。
- **亮点**：
  - session schema 已经有 body single source
- **值得借鉴**：
  - 在 schema single source 上演进，而不是 façade 自己偷塞字段
- **不打算照抄的地方**：
  - 让 runtime 支持的字段在 public surface 中缺席

### 4.3 RH5 的设计倾向

- **实现概要**：围绕 Workers AI 做“能力激活”，不做 provider 扩张。
- **亮点**：
  - scope 可控且价值直接
- **值得借鉴**：
  - capability missing 走显式错误，而不是静默忽略
- **不打算照抄的地方**：
  - model registry 先长出来，但 runtime 实际继续只走默认模型

### 4.4 横向对比速查表

| 维度 | 当前代码 | RH5 目标 | nano-agent 倾向 |
|------|----------|----------|------------------|
| model selection | 默认 primary/fallback | per-session `model_id` | 显式透传 |
| vision | canonical 有骨架 | 真正进入 runtime | 不再 silent-drop |
| reasoning | 无 public field | `reasoning.effort` 贯通 | 显式 capability law |
| provider scope | Workers AI only | 仍 only | 不扩 provider |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（本设计确认要支持）

- **[S1]** 13+4+8 `nano_models` registry 与 `/models` 一致
- **[S2]** `model_id` 进入 start/messages surface 并一路透传
- **[S3]** image_url / vision capability 真正进入执行路径
- **[S4]** reasoning effort 进入 canonical request 与 adapter 翻译

### 5.2 Out-of-Scope（本设计确认不做）

- **[O1]** 第二 provider 启用 — 会引入 routing policy；重评条件：hero-to-platform
- **[O2]** per-model quota — 由 `RHX-qna` Q3 默认否决；重评条件：hero-to-platform
- **[O3]** prompt caching / structured output — provider-specific 扩展；重评条件：hero-to-platform

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|------|------|------|----------|
| registry 里有模型但 runtime 仍走默认模型 | out-of-scope | RH5 目标是 capability 真上线 | RH5 |
| image_url 被 parse 但不进执行路径 | out-of-scope | 属于 silent-drop | RH5 |
| model_id 记录到 usage 但不做 quota | in-scope | 这是 RH5 与 billing 的分界线 | RH5 + RHX-qna Q3 |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **只启用 Workers AI 模型族** 而不是 **同时打开第二 provider**
   - **为什么**：当前第一优先是把已有模型能力真正打通。
   - **我们接受的代价**：provider diversity 仍不足。
   - **未来重评条件**：hero-to-platform。

2. **取舍 2**：我们选择 **显式 capability error** 而不是 **静默忽略 image/reasoning**
   - **为什么**：silent-drop 会把模型能力表面化。
   - **我们接受的代价**：客户端更早暴露 unsupported error。
   - **未来重评条件**：无。

3. **取舍 3**：我们选择 **记录 model_id 但不做 per-model quota**
   - **为什么**：RH5 是 capability enablement，不是 cost governance。
   - **我们接受的代价**：昂贵模型在 RH 阶段仍无细粒度配额。
   - **未来重评条件**：owner 推翻 `RHX-qna` Q3 或进入 hero-to-platform。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解方案 |
|------|----------|------|----------|
| `/models` 与 runtime capability 漂移 | D1 seed 与 runtime registry 脱节 | client 选到 runtime 不支持模型 | 以 runtime capability law 校验 seed |
| reasoning 字段只有 schema 没有 adapter 翻译 | 半成品接线 | RH5 名存实亡 | 以 adapter e2e 判定完成 |
| vision 模型注册但 upload 不可用 | RH4 未充分闭环 | multimodal 失败 | RH5 启动依赖 RH4 完成 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：终于能对“多模型/多模态/reasoning 已上线”做真实而非口号式表述。
- **对 nano-agent 的长期演进**：把 model capability law 从内部资产推进为产品能力。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：更强模型能力提升复杂任务处理质量，同时保持 runtime law 清晰。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|------|--------|------|----------------|
| F1 | Model Registry Activation | `/models` 与 runtime capability 对齐 13+4+8 模型 | ✅ `client 看见的模型就是真能用的模型` |
| F2 | Per-Session Model Selection | `model_id` 进入 start/messages/usage | ✅ `每个 session 可显式选择模型` |
| F3 | Multimodal Vision Path | image_url 进入真实执行 | ✅ `image 输入不再被静默丢弃` |
| F4 | Reasoning Effort Path | `reasoning.effort` 进入 canonical request 与 adapter | ✅ `reasoning 模型真正收到推理强度提示` |

### 7.2 详细阐述

#### F1: `Model Registry Activation`

- **输入**：`nano_models` seed、runtime capability registry、team policy
- **输出**：对客户端与 runtime 一致的模型可用性视图
- **主要调用者**：`GET /models`、runtime validation、usage logging
- **核心逻辑**：D1 是目录真相，runtime capability law 是执行真相，两者必须一致。
- **边界情况**：
  - context window 等 capability 元数据必须准确，不允许继续沿用过期值。
- **一句话收口目标**：✅ **`注册表不是摆设，而是 runtime 可执行能力的外部投影`**

#### F2: `Per-Session Model Selection`

- **输入**：`model_id`、start/messages schema、session runtime
- **输出**：每次会话或消息请求可显式选择模型
- **主要调用者**：client model picker、session ingress
- **核心逻辑**：`model_id` 从 façade body 进入 canonical request，再进入 provider adapter。
- **边界情况**：
  - disabled-by-team 的 `model_id` 必须显式 403。
- **一句话收口目标**：✅ **`客户端选的模型就是 runtime 真正执行的模型`**

#### F3: `Multimodal Vision Path`

- **输入**：`image_url` content part、vision-capable model、R2 file ref
- **输出**：vision model 真实接收 image input
- **主要调用者**：image chat / multimodal client
- **核心逻辑**：image 上传由 RH4 解决，RH5 负责让 image_url 不再被 silent-drop，而是进入 capability check 与 provider invocation。
- **边界情况**：
  - 非 vision 模型接到 image_url 必须显式报 capability missing。
- **一句话收口目标**：✅ **`多模态是实打实的运行路径，而不是 canonical 类型上的幻觉`**

#### F4: `Reasoning Effort Path`

- **输入**：`reasoning.effort`、模型 capability、adapter 翻译
- **输出**：支持 reasoning 的模型接收到真实推理强度提示
- **主要调用者**：reasoning-heavy prompts、model picker
- **核心逻辑**：canonical request 承载标准 effort，adapter 负责翻译给 Workers AI。
- **边界情况**：
  - 不支持 reasoning 的模型不能静默忽略，只能显式拒绝。
- **一句话收口目标**：✅ **`reasoning effort 不只是 schema 字段，而是实际执行参数`**

### 7.3 非功能性要求与验证策略

- **性能目标**：模型选择与能力校验不显著增加消息入口延迟
- **可观测性要求**：usage event 能回溯到 `model_id`
- **稳定性要求**：不同模型的 tool calling / vision 行为经 canonical 层归一化
- **安全 / 权限要求**：team policy filter 必须生效
- **测试覆盖要求**：至少 4 个不同模型 e2e，含 image 与 reasoning 场景
- **验证策略**：通过 multi-model e2e、vision input、reasoning effort、team policy negative tests 证明 RH5 成立

---

## 8. 可借鉴的代码位置清单

### 8.1 Current model/runtime capability

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/llm/registry/models.ts:8-18,23-58` | `ModelCapabilities` 与 registry 操作 | RH5 应继续以 capability law 驱动 runtime 校验 | current registry |
| `workers/agent-core/src/llm/gateway.ts:20-53` | 当前 Workers AI primary/fallback registry | RH5 的明确扩展点，也是当前 128K / vision=false 的现实 | current baseline |

### 8.2 Current multimodal groundwork

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `workers/agent-core/src/llm/canonical.ts:17-77` | canonical content + request 结构 | RH5 要在这里加入 reasoning / 保持 model law 清晰 | current canonical seam |
| `workers/agent-core/src/llm/request-builder.ts:56-102` | stream/tools/json-schema/vision capability checks | RH5 vision / reasoning 都应遵循同类 capability error 模式 | current validation law |

### 8.3 Current public surface gap

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---------|------|--------|------|
| `packages/nacp-session/src/messages.ts:18-25` | `session.start` 目前只有 `cwd/initial_context/initial_input` | RH5 需把 `model_id` 带入 public schema | current schema gap |
| `workers/orchestrator-core/src/user-do.ts:1418-1540` | `/messages` 当前 multipart ingress | RH5 要在现有消息 ingress 上增加 model/reasoning，而不是再开平行入口 | current message path |
