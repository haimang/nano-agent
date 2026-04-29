# Nano-Agent 行动计划 — RH5 Multi-Model Multimodal Reasoning

> 服务业务簇: `real-to-hero / RH5`
> 计划对象: `让客户端可以按 session 选择模型、上传 image、启用 reasoning effort，并由 Workers AI 真正执行；不引入 per-model quota`
> 类型: `add + update + migration`
> 作者: `Owner + Opus 4.7`
> 时间: `2026-04-29`
> 文件位置:
> - `workers/orchestrator-core/migrations/011-model-capabilities-seed.sql`
> - `packages/nacp-session/src/messages.ts`
> - `workers/agent-core/src/llm/{canonical,registry/models,request-builder,gateway,adapters/workers-ai}.ts`
> - `workers/orchestrator-core/src/user-do.ts:1418-1540`（messages ingress；行号截至 2026-04-29 main 快照）
>
> 📝 **行号引用提示**：行号截至 2026-04-29 main 分支快照；以 schema / 函数 / 接口名为锚点。
>
> 📝 **业主已签字 QNA**：业主同意 RHX-qna Q3（不引入 per-model quota；usage event 字段扩展为完整 evidence）。
>
> 📝 **代码现实澄清**：`CanonicalContentPart.ImageUrlContentPart` **已存在** 于 `workers/agent-core/src/llm/canonical.ts:25-29`（`kind: "image_url"` 已在 `ContentPartKind` 枚举），`request-builder.ts:81-92` 也已对其做 vision capability check —— 因此 RH5 vision 激活的工作是 (a) 修正模型 `supportsVision` 标记、(b) 扩 ingress kind 接受 `'image_url'`，**不是**新增 canonical type。
> 上游前序 / closure:
> - `docs/action-plan/real-to-hero/RH2-models-context-inspection.md` 完成（`/models` endpoint）
> - `docs/action-plan/real-to-hero/RH4-filesystem-r2-pipeline-and-lane-e.md` 完成（image upload）
> - `docs/charter/plan-real-to-hero.md` r2 §7.6
> 下游交接:
> - `docs/action-plan/real-to-hero/RH6-do-megafile-decomposition.md`（manual evidence 含 image / reasoning）
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RH5-multi-model-multimodal-reasoning.md`（含 §9 修订 + S0 schema 前置）
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md` Q3（业主同意 Opus 路线：no per-model quota，但 usage event 字段扩展为完整 evidence）
> 文档状态: `executed`

---

## 0. 执行背景与目标

ZX5 closure 之后 Workers AI 仍只注册 2 个模型且 `supportsVision: false`；canonical request 没有 `reasoning` 字段；`SessionStartBodySchema` 没有 `model_id`；`/messages` ingress 的 `kind` 仅接受 `text|artifact_ref`。RH5 的目标不是"再多注册几个模型"，而是把 13+4+8 模型 registry、`model_id` 透传、vision capability 激活、reasoning effort 贯通这四件事一次到位；同时**不**引入 per-model quota，仅在 usage event 层面记录 `{model_id, input_tokens, output_tokens, estimated_cost_usd, is_reasoning, is_vision, request_uuid}` 完整 evidence，给 hero-to-platform 的 quota 设计留 calibration data。

- **本次计划解决的问题**：
  - canonical / nacp-session schema 缺 reasoning + model_id 字段
  - `ModelCapabilities` 缺 `supportsReasoning` + `CapabilityName` 缺 `reasoning`
  - 当前 2 模型 supportsVision=false（其中 llama-4-scout 实际支持）
  - `/messages` ingress kind 不接受 image_url
  - request-builder 无 reasoning capability validation
  - workers-ai adapter 无 reasoning effort 翻译
  - usage event 字段不含 model_id / is_reasoning / is_vision
- **本次计划的直接产出**：
  - migration 011-model-capabilities-seed.sql：13+4+8 模型 seed
  - nacp-session schema：start/messages 加 `model_id` + `reasoning`
  - canonical：`CanonicalLLMRequest.reasoning`
  - registry：`ModelCapabilities.supportsReasoning` + `CapabilityName.reasoning`
  - request-builder：reasoning capability validation
  - workers-ai adapter：reasoning effort 翻译
  - vision 激活：修正 `llama-4-scout` `supportsVision: true`；`/messages` ingress 接受 `image_url` kind
  - usage event 扩字段
- **本计划不重新讨论的设计结论**：
  - 不引入第二 provider（hero-to-platform）
  - 不做 per-model quota（来源：RHX Q3，业主同意 Opus 扩展）
  - 不做 prompt caching / structured output（hero）
  - 不做 admin plane / billing（hero）
  - schema 扩展前置（来源：design RH5 [S0]）

---

## 1. 执行综述

### 1.1 总体执行方式

RH5 严格按 design [S0] schema 前置纪律：先把 nacp-session / canonical / registry / CapabilityName 4 处 schema 同步扩展（一个 PR），再做 migration 011 seed，然后让 request-builder + workers-ai adapter 翻译落地，再让 `/messages` ingress 接 image_url，最后用 multi-model + image + reasoning e2e 收口。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 依赖 |
|------|------|------|------|
| Phase 1 | Schema 前置扩展 (S0) | M | RH4 closure |
| Phase 2 | Migration 011 + Registry Seed | M | Phase 1 |
| Phase 3 | Request-builder + Adapter | M | Phase 1-2 |
| Phase 4 | Vision 激活 | M | Phase 1-3 |
| Phase 5 | Reasoning Effort 贯通 | M | Phase 1-3 |
| Phase 6 | Usage Event 扩字段 | S | Phase 4-5 |
| Phase 7 | E2E + Preview Smoke | M | Phase 1-6 |

### 1.3 执行策略

- **执行顺序**：schema → seed → adapter → vision → reasoning → usage → e2e
- **风险控制**：schema 扩展是 breaking change（向前兼容由可选字段保证）；nacp-session package 升版
- **测试**：4+ 模型 e2e；image + reasoning 各 ≥ 1 e2e
- **文档**：`docs/api/models-and-capabilities.md`

### 1.4 影响结构图

```text
RH5
├── Phase 1: schema 前置
│   ├── packages/nacp-session/src/messages.ts (model_id, reasoning)
│   └── workers/agent-core/src/llm/{canonical,registry/models,request-builder}.ts
├── Phase 2: migration 011 + seed
│   └── workers/orchestrator-core/migrations/011-model-capabilities-seed.sql
├── Phase 3: request-builder + adapter
│   └── workers/agent-core/src/llm/{request-builder,adapters/workers-ai}.ts
├── Phase 4: vision
│   ├── workers/agent-core/src/llm/gateway.ts (supportsVision flag fix)
│   └── workers/orchestrator-core/src/user-do.ts:1456 (kind=image_url)
├── Phase 5: reasoning
│   └── workers/agent-core/src/llm/adapters/workers-ai.ts
├── Phase 6: usage event
│   └── workers/agent-core/src/host/runtime-mainline.ts (usage payload)
└── Phase 7: e2e + smoke
    └── docs/issue/real-to-hero/RH5-evidence.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope

- **[S1]** `nacp-session/messages.ts`：(a) `SessionStartBodySchema` 加 `model_id?: string` + `reasoning?: { effort: "low"|"medium"|"high" }`；(b) **新增** `SessionMessagePostBodySchema`（当前不存在，本 phase 创建为 single-source 的 `/messages` body schema，避免 user-do.ts ad-hoc parse），含 `model_id?` + `reasoning?` + `parts: CanonicalContentPart[]`；export 到 `packages/nacp-session/src/index.ts`
- **[S2]** `canonical.ts`：`CanonicalLLMRequest` 加 `reasoning?: { effort }`
- **[S3]** `registry/models.ts`：`ModelCapabilities` 加 `supportsReasoning: boolean` + 可选 `reasoningEfforts?: ("low"|"medium"|"high")[]`；`CapabilityName` 加 `"reasoning"`
- **[S4]** `migration 011-model-capabilities-seed.sql`：seed 13 function-calling + 4 vision + 8 reasoning Workers AI 模型到 `nano_models`（含 capability flags）
- **[S5]** `gateway.ts` 在 worker 启动时从 D1 读 seed 注册到 runtime registry；保留 primary/fallback 但范围扩大
- **[S6]** `request-builder.ts`：reasoning capability validation；不支持 → throw `CAPABILITY_MISSING`（参照现有 vision check）
- **[S7]** `adapters/workers-ai.ts`：reasoning effort 翻译为 provider-specific 参数
- **[S8]** vision 激活：`gateway.ts` 把 `llama-4-scout` 的 `supportsVision` 改为 `true`；如需更多 vision 模型按 seed 注册
- **[S9]** `/messages` ingress：`user-do.ts:1456` 的 `kind` 增加 `'image_url'` 分支；映射到 `CanonicalContentPart.ImageUrlContentPart`
- **[S10]** team policy filter：`/models` 在 RH2 已实装；RH5 在 `/messages` 时同样校验 model_id 是否被 team disable
- **[S11]** usage event 扩字段：`{model_id, input_tokens, output_tokens, estimated_cost_usd, is_reasoning, is_vision, request_uuid}` 写入 `nano_usage_events`

### 2.2 Out-of-Scope

- **[O1]** 第二 provider 启用 → hero
- **[O2]** per-model quota → hero（usage event 仅记录）
- **[O3]** prompt caching / structured output → hero
- **[O4]** model picker UI（仅 schema/runtime；client UI 由 client adapter 决定何时支持）

### 2.3 边界判定表

| 项目 | 判定 | 理由 |
|------|------|------|
| registry 注册但 runtime 走默认模型 | out-of-scope | RH5 必须真上线 |
| image_url 被 silent drop | out-of-scope | request-builder 已 throw，本 phase 接通 ingress |
| reasoning 字段只写 schema 不接 adapter | out-of-scope | adapter 翻译必须落地 |
| per-model usage 聚合 | in-scope（事件级别）/ out-of-scope（quota 决策）| RHX Q3 明确分界 |

---

## 3. 业务工作总表

| 编号 | Phase | 工作项 | 类型 | 文件 | 风险 |
|------|-------|--------|------|------|------|
| P5-01 | 1 | nacp-session schema 加 model_id + reasoning | update | `nacp-session/src/messages.ts` | low |
| P5-02 | 1 | CanonicalLLMRequest.reasoning | update | `agent-core/src/llm/canonical.ts:67-77` | low |
| P5-03 | 1 | ModelCapabilities.supportsReasoning + CapabilityName.reasoning | update | `agent-core/src/llm/registry/models.ts` | low |
| P5-04 | 2 | migration 011 seed | add | `migrations/011-model-capabilities-seed.sql` | medium |
| P5-05 | 2 | gateway 从 D1 读 seed | update | `agent-core/src/llm/gateway.ts:20-53` | medium |
| P5-06 | 3 | request-builder reasoning validation | update | `agent-core/src/llm/request-builder.ts:56-92` | low |
| P5-07 | 3 | workers-ai adapter reasoning 翻译 | update | `agent-core/src/llm/adapters/workers-ai.ts` | medium |
| P5-08 | 4 | llama-4-scout supportsVision=true | update | `gateway.ts` | low |
| P5-09 | 4 | `/messages` ingress 接 image_url | update | `orchestrator-core/src/user-do.ts:1456` 等 | medium |
| P5-10 | 4 | image_url → ImageUrlContentPart 映射 | update | 同上 | medium |
| P5-11 | 5 | reasoning effort 在 worker 内端到端贯通 | integration | 上述全链路 | medium |
| P5-12 | 6 | usage event 扩字段 | update | `agent-core/src/host/runtime-mainline.ts` 的 onUsageCommit payload | low |
| P5-13 | 7 | multi-model e2e（≥4 模型）| add | `test/cross-e2e/multi-model.e2e.test.ts` | medium |
| P5-14 | 7 | image_url e2e | add | `test/cross-e2e/image-input.e2e.test.ts` | medium |
| P5-15 | 7 | reasoning effort e2e | add | `test/cross-e2e/reasoning.e2e.test.ts` | medium |
| P5-16 | 7 | team policy negative test | add | `test/cross-e2e/team-policy.e2e.test.ts` | low |
| P5-17 | 7 | preview smoke + 归档 | manual | `docs/issue/real-to-hero/RH5-evidence.md` | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — Schema 前置扩展

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P5-01 | nacp-session schema | (a) `SessionStartBodySchema` 加 `model_id?: string`（regex `^[a-z0-9@/.-]{1,80}$`）+ `reasoning?: { effort: "low"|"medium"|"high" }`；(b) **新增** `SessionMessagePostBodySchema`（当前 nacp-session 中**不存在**；user-do.ts:1418-1540 的 ad-hoc parse 改为消费此 schema）；package version bump | `nacp-session/src/messages.ts` + `packages/nacp-session/src/index.ts` (export) | schema test ≥3，含 `SessionMessagePostBodySchema` ≥3 case (含 `kind=image_url` 接受 + 兼容旧 `text`/`artifact_ref`) |
| P5-02 | canonical | `CanonicalLLMRequest` 加 `reasoning?: { effort }`；**`ImageUrlContentPart` 已确认存在**于 `canonical.ts:25-29`（`kind: "image_url"` 已在 `ContentPartKind` 枚举），`request-builder.ts:81-92` 已对 `image_url` parts 做 vision capability check 并 throw `CAPABILITY_MISSING`——本 phase 不新增 type，仅扩 reasoning 字段 | `canonical.ts:67-77`（reasoning 新增） | type compile + 既有 test 不破 |
| P5-03 | registry | `ModelCapabilities` 加 `supportsReasoning: boolean` + `reasoningEfforts?: ("low"|"medium"|"high")[]`；`CapabilityName` 增加 `"reasoning"` 字面量 | `registry/models.ts:8-22` | unit test：unknown model checkCapability("reasoning") = false |

### 4.2 Phase 2 — Migration 011 + Seed

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P5-04 | migration 011 | (a) **seed 前置验证**：`wrangler ai models --json | jq -r '.[].name' > /tmp/cf-catalog.txt`，把要 seed 的 25 model_id 与 catalog 比对；任何不在 catalog 中的 model_id 在 migration 内标 `disabled=1` 而非省略，留可观测；(b) `INSERT INTO nano_models` 13 function-calling + 4 vision + 8 reasoning Workers AI 模型；含 `family / context_window / supports_tools / supports_vision / supports_reasoning / supports_streaming / reasoning_efforts JSON / disabled` 字段 | `migrations/011-model-capabilities-seed.sql` + PR description 含 catalog diff | apply 通过；count ≥ 25；catalog mismatch 0 或显式 disabled |
| P5-05 | gateway D1 seed + 注入路径 | (a) **改 `WorkersAiGateway` 构造签名** 为 `new WorkersAiGateway(ai, modelResolver)`，`modelResolver` 由 caller 注入（非 module-static）；(b) 在 `runtime-mainline.ts:137-149` `createMainlineKernelRunner` 中通过 `D1Adapter` query `nano_models` 构造 resolver 并传给 gateway；(c) 同一 resolver 实例由 orchestrator-core `/models` route handler 共享（避免 `/models` view 与 runtime exec view drift）；(d) 保留 primary/fallback 默认；(e) `context_window` 字段修正为各模型真实值（charter §7.6 要求 default 131K） | `agent-core/src/llm/gateway.ts:20-53` + `runtime-mainline.ts:137-149` + `orchestrator-core` model handler | unit：构造注入 + 不同 resolver 数据一致；smoke：runtime registry list ≥ 25 |

### 4.3 Phase 3 — Request-Builder + Adapter

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P5-06 | reasoning validation | request-builder 若 request 含 `reasoning` 字段而 model.supportsReasoning=false → throw `CAPABILITY_MISSING("reasoning")`；reasoningEfforts 列表内不含 `effort` 也 throw | `request-builder.ts:56-92` | unit test ≥3 |
| P5-07 | reasoning 翻译 | workers-ai adapter 把 `reasoning.effort` 转为 Workers AI 对应参数（具体参数名查 Workers AI Reasoning API doc，例如 `params.reasoning_effort`）；非 reasoning 模型路径不变 | `adapters/workers-ai.ts:148-220` | unit + integration |

### 4.4 Phase 4 — Vision 激活

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P5-08 | llama-4-scout flag | gateway.ts 把 `@cf/meta/llama-4-scout-17b-16e-instruct` 的 `supportsVision` 改为 `true`；如有其他 vision 模型按 seed 注册 | `gateway.ts` | runtime registry 至少 1 vision 可用 |
| P5-09 | ingress kind | `user-do.ts:1456` 的 `kind` 数组从 `['text', 'artifact_ref']` 扩为 `['text', 'artifact_ref', 'image_url']`；后续 schema 校验放行 image_url | `user-do.ts` | endpoint test：image_url kind 不再 400 |
| P5-10 | image_url 映射 | ingress 收到 `kind=image_url` 时，构造 `CanonicalContentPart.ImageUrlContentPart`（含 url + mime hint）放入 `CanonicalLLMRequest.messages[].content[]`；request-builder 已有 vision check 复用 | 同上 + canonical layer | endpoint test + e2e |

### 4.5 Phase 5 — Reasoning Effort 贯通

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P5-11 | end-to-end | client → `/messages` 带 `reasoning.effort=high` → ingress → canonical → request-builder validate → workers-ai adapter 翻译 → provider response | 上述全链路 | reasoning e2e 通过 |

### 4.6 Phase 6 — Usage Event 扩字段

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P5-12 | usage payload 扩字段 | `runtime-mainline.ts` `onUsageCommit` payload 与 D1 `nano_usage_events` schema 同步扩字段：`{model_id, input_tokens, output_tokens, estimated_cost_usd, is_reasoning, is_vision, request_uuid}`；`nano_usage_events` 若缺列在 migration 011 内一并加（或独立 mini-migration）| `runtime-mainline.ts:240-339` + `migration` | endpoint test：`/usage` 返回新字段；D1 query 可见 |

### 4.7 Phase 7 — E2E + Preview Smoke

| 编号 | 工作项 | 内容 | 文件 | 收口 |
|------|--------|------|------|------|
| P5-13 | multi-model e2e | 至少 4 个不同模型各 1 次 chat；含 1 个 fallback；assertion: usage event 的 model_id 与 request 一致 | `test/cross-e2e/multi-model.e2e.test.ts` | 4 case 全绿 |
| P5-14 | image_url e2e | upload 1 image (RH4 path) → `/messages` `kind=image_url` 引用 → vision 模型响应；assertion: response 提到 image | `test/cross-e2e/image-input.e2e.test.ts` | 通过 |
| P5-15 | reasoning e2e | 用 reasoning 模型 + `reasoning.effort=high`；assertion: response 含 thinking trace 或 usage 标记 is_reasoning=true | `test/cross-e2e/reasoning.e2e.test.ts` | 通过 |
| P5-16 | team policy negative | team disable 某 model → `/messages` 指定该 model_id → 403 | `test/cross-e2e/team-policy.e2e.test.ts` | 通过 |
| P5-17 | preview smoke | preview deploy → 业主 manual：4 模型各 1 chat / 1 image upload + ask / 1 reasoning task | `docs/issue/real-to-hero/RH5-evidence.md` | 文档 ≥1KB + 截图 |

---

## 5. Phase 详情

### 5.1 Phase 1 — Schema 前置

- **核心**：4 处 schema 同步扩展，单 PR，避免 partial state
- **风险**：可选字段向前兼容，但 nacp-session 升版需要下游 worker 配合升级
- **测试**：每处 schema ≥3 case + negative

### 5.2 Phase 2 — Migration + Seed

- **核心**：13+4+8 = 25 模型 seed
- **风险**：具体 model_id / context_window / capability 由 charter / Workers AI doc 决定；implementer 需查最新 Workers AI 模型 catalog
- **回归**：现有 `gateway.ts` 主 fallback 不变，避免 RH4 之前的代码继续 break

### 5.3 Phase 3 — Adapter

- **核心**：reasoning effort 翻译
- **风险**：Workers AI reasoning API 名可能在 first-wave 后变化；用 adapter 隔离

### 5.4 Phase 4 — Vision

- **核心**：activation 不是"切 flag"那么简单，需要 ingress 同时改
- **风险**：image_url 映射要正确传递 mime（用于 `Content-Type` 验证）；从 RH4 R2 拿字节再走 inline / url 两种路径中选一种

### 5.5 Phase 5 — Reasoning end-to-end

- **核心**：纯 wiring，前置 schema 已就位

### 5.6 Phase 6 — Usage Event

- **核心**：为 hero-to-platform quota 留数据
- **风险**：`nano_usage_events` 表结构已在 ZX4 P5-01 建立；缺字段需要 mini-migration（可在 011 内追加）

### 5.7 Phase 7 — E2E

- **核心**：4 模型 + image + reasoning + team policy 4 类 e2e
- **风险**：preview smoke 必须含真 image upload（依赖 RH4），先验证 RH4 deploy 健康

---

## 6. 依赖的冻结决策

| 决策 | 来源 | 影响 |
|------|------|------|
| RHX Q3 不引 quota / 但 usage event 扩字段 | RHX-qna Q3 | Phase 6 字段 list 直接来自业主同意的扩展 |
| schema [S0] 前置 | design RH5 §5.1 | Phase 1 必须先于其他 phase |
| Workers AI only | charter §7.6 | Phase 2-3 不引第二 provider |
| migration 编号 = 011 | charter §8.4 | Phase 2 锁定 |
| context_window 修正为 131K | charter §7.6 | Phase 2 seed 含正确值 |

---

## 7. 风险、依赖、完成后状态

### 7.1 风险

| 风险 | 描述 | 判断 | 应对 |
|------|------|------|------|
| Workers AI reasoning API 参数变化 | first-wave 后 provider param 可能变 | medium | adapter 隔离；版本探测 |
| 25 模型 seed 错误 | 某 model_id 拼写错或 capability 标记错 | medium | adapter call dry-run + smoke |
| ingress image_url 安全 | url 注入或跨域 ref | high | url 必须是 RH4 内部 R2 reference 或受信白名单；不接受任意外部 url（first-wave）|
| reasoning effort 翻译 silent drop | adapter 漏写 | high | unit test 覆盖参数透传 |

### 7.2 约束

- **技术前提**：RH2 closure（`/models` 路由）；RH4 closure（image upload）
- **运行时前提**：D1 schema 011 部署
- **组织协作**：业主 Phase 7 manual evidence

### 7.3 文档同步

- `docs/api/models-and-capabilities.md`
- `docs/api/llm-delta-policy.md` 引用 reasoning 部分

### 7.4 完成后状态

1. 25 模型在 D1 + runtime registry 一致
2. 客户端可指定 model_id；vision/reasoning 真执行
3. `/messages` 接受 image_url
4. usage event 含完整 evidence 字段
5. RH6 manual evidence 可包含 image / reasoning scenario

---

## 8. 整体测试与收口

### 8.1 整体测试

- **基础**：6 worker dry-run；既有测试不回归
- **单测**：schema 3+ 处；request-builder reasoning ≥3；adapter ≥3
- **集成**：4 model e2e；image e2e；reasoning e2e；team policy negative
- **端到端**：业主 preview manual
- **回归**：RH0-4 既有矩阵

### 8.2 整体收口

1. nacp-session / canonical / registry 4 处 schema 同步扩展
2. migration 011 部署；25 模型 seed
3. request-builder + adapter reasoning 翻译
4. vision 激活；image_url 端到端
5. usage event 扩字段
6. 4 类 e2e 全绿
7. preview evidence 含 image + reasoning
8. RH6 Per-Phase Entry Gate 满足

### 8.3 DoD

| 维度 | 完成定义 |
|------|----------|
| 功能 | model_id / image / reasoning live |
| 测试 | e2e 4 类全绿 |
| 文档 | models-and-capabilities.md |
| 风险收敛 | reasoning 0 silent-drop；image url 0 注入 |
| 可交付性 | RH6 closure 可启动 |

---

## 9. 工作日志回填

### 9.1 代码级变更清单

1. **nacp-session schema / package**
   - `packages/nacp-session/src/messages.ts` 增加 `model_id`、`reasoning`、`SessionMessagePostBodySchema`、`SessionMessagePart`。
   - `packages/nacp-session/src/index.ts` 导出 RH5 新 schema/type。
   - `packages/nacp-session/src/version.ts` 与 `package.json` 升级到 `1.4.0`。
   - `@haimang/nacp-session@1.4.0` 已发布到 GitHub Packages；workspace consumers 的 package.json 与 lockfile 已更新到 `1.4.0`。

2. **model catalog / migrations**
   - 新增 `workers/orchestrator-core/migrations/011-model-capabilities-seed.sql`：扩展 usage event evidence 字段，seed 25 个 Workers AI 模型（4 vision / 8 reasoning）。
   - 新增 `workers/orchestrator-core/migrations/012-usage-events-fk-repair.sql`：修复 preview D1 中 `nano_usage_events.session_uuid` stale FK 指向 `nano_conversation_sessions_old_v6` 的 table-swap 残留。
   - preview D1 已 apply `011` 与 `012`；`PRAGMA foreign_key_list(nano_usage_events)` 已指向 `nano_conversation_sessions`。

3. **agent-core runtime**
   - `CanonicalLLMRequest` 增加 `reasoning`。
   - `ModelCapabilities` 增加 `supportsReasoning` / `reasoningEfforts`，`CapabilityName` 增加 `reasoning`。
   - `request-builder` 增加 reasoning capability validation；不支持 reasoning 或 effort 不匹配时抛 `CAPABILITY_MISSING`。
   - `gateway` 支持从 D1 `nano_models` 读取 runtime model capabilities，并保留 primary/fallback 默认。
   - Workers AI adapter 使用显式 `exec.model.modelId` 调用，不再固定只跑 primary/fallback；同时传递 `reasoning_effort`，并保留 multipart image content。
   - `TurnInput` / HTTP controller / orchestration 贯通 `model_id`、`reasoning`、`parts`。
   - agent-core 在 LLM call 前通过 `FILESYSTEM_CORE.readArtifact` 读取 session file image，并将 `/sessions/{id}/files/{file_uuid}/content` 转为 data URL，避免把相对 URL 直接交给 provider。
   - usage commit 记录 `model_id`、token、`is_reasoning`、`is_vision`、`request_uuid`。

4. **orchestrator-core `/messages`**
   - `/messages` 支持 `text` / `artifact_ref` / `image_url` parts。
   - `image_url` 只允许当前 session 的 file content endpoint 或 `nano-file://{session}/{file}`，避免任意外部 URL 注入。
   - 当 body 包含 `model_id` 时，User DO 会查询 D1 `nano_models` 与 `nano_team_model_policy`，拒绝 inactive 或 team-disabled model。
   - multipart body 会继续写入 conversation message，并把 rich `parts`、`model_id`、`reasoning` 转发给 agent-core。

5. **测试与文档**
   - 新增/更新 nacp-session schema tests。
   - 新增 request-builder reasoning tests、registry capability tests、gateway explicit model/reasoning/image tests、D1-backed capability injection test。
   - 新增 User DO RH5 `/messages` positive forwarding test。
   - 新增 live package e2e：`test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs`。
   - 新增 `docs/api/models-and-capabilities.md`。
   - 新增 closure：`docs/issue/real-to-hero/RH5-closure.md`。

### 9.2 Preview / live 操作记录

1. `011-model-capabilities-seed.sql` preview apply 成功，D1 seed 结果：
   - `model_count=25`
   - `vision_count=4`
   - `reasoning_count=8`
2. live real LLM smoke 初次暴露 `nano_usage_events` stale FK 指向 `nano_conversation_sessions_old_v6`；新增并 apply `012-usage-events-fk-repair.sql` 后恢复。
3. `@haimang/nacp-session@1.4.0` 已发布到 GitHub Packages。
4. agent-core / orchestrator-core / bash-core / context-core / filesystem-core 已部署到 preview；`/debug/workers/health` 返回 `live=6,total=6`，5 个 NACP worker 均显示 `nacp_session_version=1.4.0`。
5. final live image + reasoning smoke 通过：
   - session `a5b13d38-e85d-4bb9-abcc-6530c025e696`
   - file `482bb284-1787-4f5e-9f15-2fc2b319ef9c`
   - model `@cf/meta/llama-4-scout-17b-16e-instruct`
   - usage evidence `is_reasoning=1`, `is_vision=1`, `input_tokens=2169`, `output_tokens=9`

### 9.3 验证命令

| 命令 / 检查 | 结果 |
|---|---|
| `pnpm --filter @haimang/nacp-session typecheck && pnpm --filter @haimang/nacp-session build && pnpm --filter @haimang/nacp-session test` | ✅ |
| `pnpm --filter @haimang/agent-core-worker typecheck && pnpm --filter @haimang/agent-core-worker build && pnpm --filter @haimang/agent-core-worker test` | ✅ |
| `pnpm --filter @haimang/orchestrator-core-worker typecheck && pnpm --filter @haimang/orchestrator-core-worker build && pnpm --filter @haimang/orchestrator-core-worker test` | ✅ |
| `NANO_AGENT_LIVE_E2E=1 NANO_AGENT_AGENT_CORE_URL=https://service-binding-only.invalid node --test test/cross-e2e/12-real-llm-mainline-smoke.test.mjs` | ✅ |
| `NANO_AGENT_LIVE_E2E=1 node --test test/package-e2e/orchestrator-core/11-rh5-models-image-reasoning.test.mjs` | ✅ |
| `/debug/workers/health` | ✅ `live=6,total=6` |

### 9.4 收口意见

RH5 的主目标已闭合：client 可指定模型、传入 session file image、启用 reasoning effort，agent-core 会以 D1 model catalog 为能力真相执行 Workers AI 请求，并把 RH5 evidence 写入 D1 usage events。RH6 可以启动；RH4 Lane E consumer sunset 仍按 RH4 closure 作为独立 carry-over 继续跟踪。
