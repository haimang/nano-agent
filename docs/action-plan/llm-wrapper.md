# Nano-Agent 行动计划 — LLM Wrapper

> 服务业务簇: `LLM Inference`
> 计划对象: `@nano-agent/llm-wrapper` — nano-agent 的模型执行抽象层
> 类型: `new`
> 作者: `GPT-5.4`
> 时间: `2026-04-16`
> 文件位置: `packages/llm-wrapper/`（主仓 monorepo 内的 workspace package）
> 关联设计 / 调研文档:
> - `docs/design/llm-wrapper-by-GPT.md`
> - `docs/design/workspace-context-artifacts-by-GPT.md`
> - `docs/design/agent-runtime-kernel-by-GPT.md`
> - `docs/design/capability-runtime-by-GPT.md`
> - `docs/action-plan/nacp-core.md`
> - `docs/action-plan/nacp-session.md`
> - `docs/plan-after-nacp.md`
> - `README.md`
> - 参考代码：`packages/nacp-session/`、`context/mini-agent/mini_agent/llm/`、`context/codex/codex-rs/model-provider-info/`、`context/claude-code/services/api/`
> 文档状态: `draft`

---

## 0. 执行背景与目标

nano-agent 已经明确：v1 不是本地 CLI，不追求多 wire 并存，也不把 provider SDK 当系统内核。  
因此 `LLM Wrapper` 的职责不是“接几个模型”，而是先把下面三条边界做对：

1. **内部 canonical model**
2. **Worker 宿主下的大附件进入路径**
3. **provider 输出到 session delivery layer（WebSocket-first，保留 HTTP fallback）的归一化路径**

当前代码现实也很明确：`@nano-agent/nacp-session` 已经冻结了 `llm.delta` 在内的 session event catalog，而 `@nano-agent/nacp-core` 仍**没有** `llm.invoke` domain。也就是说，v1 的正确路径是：

> **先做一个可协议化、可替换、以 Chat Completions 为统一 wire 的本地执行边界，而不是为了协议化去过早发明新的 Core message family。**

- **服务业务簇**：`LLM Inference`
- **计划对象**：`@nano-agent/llm-wrapper`
- **本次计划解决的问题**：
  - nano-agent 需要一个不被具体 provider JSON 反向污染的内部推理边界
  - Worker / V8 isolate 下的图片、大文件、prepared artifact 进入路径必须先标准化
  - provider 的 SSE / non-stream 回包必须被归一化成当前 `nacp-session` 可消费的 session output
  - 后续独立 inference gateway / 多 provider / 多模态演进，需要建立在一个稳定的 registry + adapter + executor 结构上
- **本次计划的直接产出**：
  - `packages/llm-wrapper/` 独立包骨架
  - `CanonicalLLMRequest / CanonicalLLMResult / NormalizedLLMEvent` 类型体系
  - provider/model registry（含 v1 简化的多 API key 槽位与轮换策略字段）、attachment planner、OpenAI-compatible adapter、executor、normalizer、session mapping
  - 用 mock fetch / fixture stream 验证流式、超时、重试、错误分类与 session event 映射

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 分 **5 个 Phase**，执行策略是 **“先 canonical model 与 registry，再 request planning，再 adapter/executor，最后 session mapping 与 fixtures 收口”**。  
这里最重要的不是先能发请求，而是先收敛 **内部请求对象、能力校验、附件进入策略、统一错误与 usage 结构**。如果一开始就写 provider if/else，很快就会把 session runtime、workspace runtime 和 hook/runtime 边界一起拖脏。

### 1.2 Phase 总览

| Phase | 名称 | 预估工作量 | 目标摘要 | 依赖前序 |
|------|------|------------|----------|----------|
| Phase 1 | 包骨架与 Canonical Model | M | 冻结内部消息 / 请求 / 结果 / 事件结构，建立包骨架 | `-` |
| Phase 2 | Registry / Request Builder / Attachment Planner | L | 完成 provider/model registry、capability guard、附件路径规划 | Phase 1 |
| Phase 3 | ChatCompletionAdapter 与 LLMExecutor | L | 建立 OpenAI-compatible adapter、执行器、重试、超时、stream parser | Phase 1, Phase 2 |
| Phase 4 | Stream / Usage / Error / Session Mapping | M | 完成 normalizer，并对齐当前 `nacp-session` event reality | Phase 2, Phase 3 |
| Phase 5 | Fixtures / 测试 / 文档 / 网关占位 | M | 用 mock fetch 与 fixture SSE 收口，并预留 gateway seam | Phase 1-4 |

### 1.3 Phase 说明

1. **Phase 1 — 包骨架与 Canonical Model**
   - **核心目标**：建立独立包，冻结 canonical message / request / result / event / error / usage 类型。
   - **为什么先做**：不先冻结内部真相，后面 provider adapter 写得越多，越容易被 provider JSON 反向定义系统。
2. **Phase 2 — Registry / Request Builder / Attachment Planner**
   - **核心目标**：建立 provider/model registry、request builder、capability 校验与附件路径规划。
   - **为什么放在这里**：先知道“这个模型能不能做这件事”，再谈 adapter 与网络请求。
3. **Phase 3 — ChatCompletionAdapter 与 LLMExecutor**
   - **核心目标**：以 `fetch` 为中心完成 Chat Completions adapter、流解析、abort/timeout/retry。
   - **为什么放在这里**：registry 与 request builder 稳定后，adapter 才不会不断返工。
4. **Phase 4 — Stream / Usage / Error / Session Mapping**
   - **核心目标**：将 provider 回包规范化，并严格对齐现有 `@nano-agent/nacp-session` 现实。
   - **为什么放在这里**：只有执行器稳定，才能正确定义 normalized events 与 session output。
5. **Phase 5 — Fixtures / 测试 / 文档 / 网关占位**
   - **核心目标**：用 mock fetch、fixture stream、fake provider profiles 完成收口，并为 future gateway 留接口但不提前实现。
   - **为什么放在这里**：先保证 local-fetch 路径正确，再谈远端执行 seam。

### 1.4 执行策略说明

- **执行顺序原则**：`canonical -> registry/planner -> adapter/executor -> normalize/map -> fixtures/docs`
- **风险控制原则**：只支持 Chat Completions wire；不引入 provider SDK 全家桶；不突破当前 `nacp-session` event reality
- **测试推进原则**：fixture-driven；流式解析、重试、错误分类、附件规划都必须可在本地 mock fetch 下稳定回归
- **文档同步原则**：随实现回填 `llm-wrapper-by-GPT.md`、`session-do-runtime-by-opus.md`、`eval-observability-by-opus.md` 的相关说明

### 1.5 本次 action-plan 影响目录树

```text
packages/llm-wrapper/
├── src/
│   ├── version.ts
│   ├── canonical.ts
│   ├── usage.ts
│   ├── errors.ts
│   ├── prepared-artifact.ts
│   ├── attachment-planner.ts
│   ├── request-builder.ts
│   ├── executor.ts
│   ├── stream-normalizer.ts
│   ├── session-stream-adapter.ts
│   ├── gateway.ts
│   ├── registry/
│   │   ├── providers.ts
│   │   ├── models.ts
│   │   └── loader.ts
│   ├── adapters/
│   │   ├── types.ts
│   │   └── openai-chat.ts
│   └── index.ts
├── test/
│   ├── canonical.test.ts
│   ├── registry.test.ts
│   ├── attachment-planner.test.ts
│   ├── request-builder.test.ts
│   ├── executor.test.ts
│   ├── stream-normalizer.test.ts
│   ├── session-stream-adapter.test.ts
│   └── integration/
│       ├── local-fetch-stream.test.ts
│       ├── retry-timeout.test.ts
│       └── prepared-artifact-routing.test.ts
├── fixtures/
│   ├── stream/
│   ├── non-stream/
│   └── provider-profiles/
├── package.json
├── tsconfig.json
├── README.md
└── CHANGELOG.md
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** `@nano-agent/llm-wrapper` 独立包骨架
- **[S2]** `CanonicalMessage / CanonicalLLMRequest / CanonicalLLMResult / NormalizedLLMEvent`
- **[S3]** provider registry + model registry + env/config loader
- **[S4]** capability guard：tool / vision / json schema / stream 等请求前校验
- **[S5]** attachment planner：`inline | signed-url | proxy-url | prepared-text`
- **[S6]** prepared artifact contract 与最小 `PreparedArtifactRef` 类型（作为 `NacpRef` 的语义包装）
- **[S7]** `ChatCompletionAdapter` 接口与 OpenAI-compatible adapter
- **[S8]** `LLMExecutor`：local-fetch、abort、timeout、retry、Retry-After
- **[S9]** stream normalizer + non-stream parser
- **[S10]** usage / finish reason / error normalization
- **[S11]** session stream adapter：对齐当前 `nacp-session` v1 kinds，并保证同一归一化结果可被后续 WebSocket stream 与 HTTP fallback 复用
- **[S12]** service-binding-gateway seam（接口占位，不是完整实现）
- **[S13]** mock fetch / fixture-based tests
- **[S14]** README、导出面与 package scripts

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** Anthropic native Messages adapter
- **[O2]** OpenAI Responses API adapter
- **[O3]** provider 原生 WebSocket / Realtime transport
- **[O4]** 完整 `llm.invoke` `nacp-core` domain 冻结
- **[O5]** provider SDK 全家桶与复杂 auth helper 生态
- **[O6]** 完整 OCR / PDF parse / CSV summarize 实现
- **[O7]** sub-agent / orchestration / workflow routing
- **[O8]** 自动 provider routing / A-B / cost optimizer
- **[O9]** 真实远端 inference gateway worker 实装
- **[O10]** 任意二进制 inline 提交与任意文件直喂模型保证

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 预计何时重评 |
|------|------|------|--------------|
| Chat Completions 作为唯一外部 wire | `in-scope` | 这是 v1 的结构性收敛原则 | 当第二 wire 确有必要时 |
| local-fetch 执行路径 | `in-scope` | 当前 `nacp-core` 尚无 `llm.invoke` domain | inference gateway 启动时 |
| service-binding-gateway seam | `defer / depends-on-decision` | 接口应保留，但不应在 v1 先落完整实现 | 需要集中密钥/限流时 |
| 图片 URL 输入 | `in-scope` | Worker 现实下可行、且符合设计文稿 | 不重评 |
| 大文档 raw URL 直喂 | `out-of-scope` | v1 只保证 prepared artifact / text path | 当 workspace/prepared artifact 稳定后 |
| provider 原始 SSE passthrough | `out-of-scope` | 当前 Session profile 要求 normalized session output | 默认不重评 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险等级 |
|------|------------|--------|------|------------------|------------|----------|
| P1-01 | Phase 1 | package 骨架 | `add` | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 建出独立 llm-wrapper package | low |
| P1-02 | Phase 1 | canonical model | `add` | `src/canonical.ts` | 冻结内部消息 / 请求 / 结果 / 事件结构 | high |
| P1-03 | Phase 1 | usage / error taxonomy | `add` | `src/usage.ts`、`src/errors.ts` | 统一 usage / finish reason / error shape | medium |
| P2-01 | Phase 2 | provider registry | `add` | `src/registry/providers.ts` | 定义 provider config 真相与多 key 槽位 | medium |
| P2-02 | Phase 2 | model registry | `add` | `src/registry/models.ts` | 定义 model capability 真相 | medium |
| P2-03 | Phase 2 | registry loader | `add` | `src/registry/loader.ts` | 允许 env / config 注入与逗号分隔 key 列表 | medium |
| P2-04 | Phase 2 | request builder | `add` | `src/request-builder.ts` | canonical request -> validated execution input | high |
| P2-05 | Phase 2 | attachment planner | `add` | `src/attachment-planner.ts`、`src/prepared-artifact.ts` | 以 `mime_type` 为第一路由键统一大附件进入路径 | high |
| P3-01 | Phase 3 | adapter interface | `add` | `src/adapters/types.ts` | 统一 provider adapter contract | medium |
| P3-02 | Phase 3 | OpenAI-compatible adapter | `add` | `src/adapters/openai-chat.ts` | 形成唯一外部 wire 主路径 | high |
| P3-03 | Phase 3 | executor | `add` | `src/executor.ts` | 统一发请求 / abort / timeout / retry | high |
| P4-01 | Phase 4 | stream normalizer | `add` | `src/stream-normalizer.ts` | provider stream -> normalized events | high |
| P4-02 | Phase 4 | session stream adapter | `add` | `src/session-stream-adapter.ts` | normalized events -> current session event reality | medium |
| P4-03 | Phase 4 | gateway seam | `add` | `src/gateway.ts` | 预留远端执行接口，不落完整实现 | low |
| P5-01 | Phase 5 | fixture tests | `add` | `fixtures/`、`test/*.test.ts` | 用 mock fetch 与 fixture stream 收口 | medium |
| P5-02 | Phase 5 | integration tests | `add` | `test/integration/*.test.ts` | 验证流式、超时、prepared artifact 路由 | medium |
| P5-03 | Phase 5 | 文档与导出面 | `update` | `README.md`、`src/index.ts` | 下游能直接接入 wrapper API | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 包骨架与 Canonical Model

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P1-01 | package 骨架 | 参照现有 `nacp-core` / `nacp-session` 包结构建立独立 package | `package.json`、`tsconfig.json`、`README.md`、`CHANGELOG.md` | 包可 `build/typecheck/test` | 基础命令校验 | 独立包约定稳定 |
| P1-02 | canonical model | 定义 `CanonicalMessage`、`CanonicalLLMRequest`、`CanonicalLLMResult`、`NormalizedLLMEvent` | `src/canonical.ts` | 上游无需理解 provider JSON | 类型测试 / compile-only | 内部真相明确 |
| P1-03 | usage / error taxonomy | 定义 usage、finish reason、统一错误分类 | `src/usage.ts`、`src/errors.ts` | 上层只处理统一结构 | 单测 | taxonomy 不再依赖 provider 私有字段 |

### 4.2 Phase 2 — Registry / Request Builder / Attachment Planner

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P2-01 | provider registry | 吸收 `codex` 的 provider profile 设计，冻结 baseUrl/auth/headers/retry/target/api_keys/key_rotation_policy | `src/registry/providers.ts` | provider 真相不散落 | registry 单测 | profile 字段足以支撑 v1 |
| P2-02 | model registry | 定义 model capability：stream/tool/vision/json-schema 等 | `src/registry/models.ts` | 请求前能回答“能不能做” | registry 单测 | capability gate 生效 |
| P2-03 | registry loader | 支持静态默认值 + env/config overlay，并接受 toml/env 中逗号分隔的 API key 列表 | `src/registry/loader.ts` | 运行时注入 provider/model 配置 | loader 单测 | 不需要改代码就能切换 profile |
| P2-04 | request builder | canonical request 进入执行前统一校验默认值与 capability | `src/request-builder.ts` | request builder 成为唯一入口 | builder 单测 | 非法请求在发出前被拦截 |
| P2-05 | attachment planner | 以 `mime_type` 为第一路由键规划 URL / prepared-text / inline 路径；默认不直喂大对象 | `src/attachment-planner.ts`、`src/prepared-artifact.ts` | Worker 宿主下附件路径统一 | planner 单测 | 图片 / PDF / 文本路径清楚，其他类型显式限缩 |

### 4.3 Phase 3 — ChatCompletionAdapter 与 LLMExecutor

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P3-01 | adapter interface | 定义 buildRequest / parseStream / parseNonStream | `src/adapters/types.ts` | 接入新 provider 不改 agent loop | 类型测试 | adapter contract 稳定 |
| P3-02 | OpenAI-compatible adapter | 实现唯一外部 wire 主路径与流解析 | `src/adapters/openai-chat.ts` | v1 所有 provider 走同一路 | adapter 单测 | 常见 OpenAI-compatible 差异可兼容 |
| P3-03 | executor | 以 `fetch` 为中心处理 abort/timeout/retry | `src/executor.ts` | 单次模型调用生命周期集中管理 | executor 单测 | retry/timeout/cancel 行为稳定 |

### 4.4 Phase 4 — Stream / Usage / Error / Session Mapping

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P4-01 | stream normalizer | provider chunk -> `NormalizedLLMEvent` | `src/stream-normalizer.ts` | 上游只处理统一事件 | normalizer 单测 | SSE 差异被 adapter/normalizer 吸收 |
| P4-02 | session stream adapter | 将 normalized events 收敛到当前 `nacp-session` reality，并显式排除 turn 边界事件职责 | `src/session-stream-adapter.ts` | client 看见稳定模型流，且同一 body 可供 WebSocket/HTTP fallback 复用 | mapping 单测 | 不突破 `llm.delta/session.update/system.notify` 等现有边界，也不接管 `turn.begin/turn.end` |
| P4-03 | gateway seam | 预留 `service-binding-gateway` 接口占位 | `src/gateway.ts` | 将来拆 inference worker 不重写上层 | compile-only | seam 清楚但不额外生复杂度 |

### 4.5 Phase 5 — Fixtures / 测试 / 文档 / 网关占位

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|------|--------|----------|------------------|----------|----------|----------|
| P5-01 | fixture tests | 构建 mock fetch、fixture SSE、fake profiles | `fixtures/`、`test/*.test.ts` | 流式与非流式路径可回归 | `vitest run` | fixture 语义覆盖关键 provider 差异 |
| P5-02 | integration tests | 验证 retry/timeout/prepared artifact 路径 | `test/integration/*.test.ts` | v1 核心风险点可回归 | integration tests | 关键链路全覆盖 |
| P5-03 | 文档与导出面 | 更新 README 与 index exports | `README.md`、`src/index.ts` | kernel/session runtime 能直接接入 | 文档检查 | 用法与边界说清楚 |

---

## 5. Phase 详情

### 5.1 Phase 1 — 包骨架与 Canonical Model

- **Phase 目标**：把模型执行边界从“provider JSON world”拉回“nano-agent 内部 canonical world”。
- **本 Phase 对应编号**：
  - `P1-01`
  - `P1-02`
  - `P1-03`
- **本 Phase 新增文件**：
  - `packages/llm-wrapper/package.json`
  - `packages/llm-wrapper/tsconfig.json`
  - `packages/llm-wrapper/src/canonical.ts`
  - `packages/llm-wrapper/src/usage.ts`
  - `packages/llm-wrapper/src/errors.ts`
- **本 Phase 修改文件**：
  - `packages/llm-wrapper/README.md`
  - `packages/llm-wrapper/src/index.ts`
- **具体功能预期**：
  1. `CanonicalLLMRequest` 明确与 OpenAI request body 脱钩。
  2. `NormalizedLLMEvent` 明确与 provider SSE 脱钩。
  3. usage / finish reason / error taxonomy 进入统一真相源。
- **具体测试安排**：
  - **单测**：类型 guard、canonical content part、finish reason 映射
  - **集成测试**：无
  - **回归测试**：compile-only
  - **手动验证**：逐项对照 design doc 的 F1/F6/F7
- **收口标准**：
  - canonical model 足以表达文本、图片 ref、tool call、tool result
  - usage/error taxonomy 覆盖 v1 必需范围
  - 上游模块不再需要引用 provider-specific JSON 类型
- **本 Phase 风险提醒**：
  - 如果 canonical model 过薄，后面附件和 tool result 会重新泄漏 provider 语义

### 5.2 Phase 2 — Registry / Request Builder / Attachment Planner

- **Phase 目标**：在发请求前完成能力判断与附件路径规划。
- **本 Phase 对应编号**：
  - `P2-01`
  - `P2-02`
  - `P2-03`
  - `P2-04`
  - `P2-05`
- **本 Phase 新增文件**：
  - `packages/llm-wrapper/src/registry/providers.ts`
  - `packages/llm-wrapper/src/registry/models.ts`
  - `packages/llm-wrapper/src/registry/loader.ts`
  - `packages/llm-wrapper/src/request-builder.ts`
  - `packages/llm-wrapper/src/attachment-planner.ts`
  - `packages/llm-wrapper/src/prepared-artifact.ts`
- **具体功能预期**：
  1. 借鉴 `context/codex/codex-rs/model-provider-info/src/lib.rs` 的 provider profile 思路，但不引入 Responses API 绑定；v1 provider profile 需预留 `api_keys: string[]` 与 `key_rotation_policy?: "round-robin" | "on-429"` 槽位。
  2. builder 在请求发出前就完成 tool/vision/json-schema 等能力拦截。
  3. registry loader 允许从 toml/env 中以逗号分隔方式注入多 API key，v1 先采用简单轮询或 `429 -> next key` 的轻量策略，不引入复杂控制平面。
  4. attachment planner 以 `mime_type` 为第一路由键：`image/*` 默认走 URL，`application/pdf` 默认走 prepared artifact/text path，其他类型按注册范围走 `prepared-text` 或显式 `reject`，且 `PreparedArtifactRef` 继续以 `NacpRef` 为底层 wire truth。
- **具体测试安排**：
  - **单测**：registry validate、builder guard、attachment route planning
  - **集成测试**：fake profile + fake artifact metadata
  - **回归测试**：不支持能力时的拒绝路径
  - **手动验证**：对照 `workspace-context-artifacts` 的 Artifact / Prepared Artifact 设计
- **收口标准**：
  - “这个模型能不能处理这个请求”在请求前就能回答
  - 附件路径不再由 adapter 临场决定
  - provider/model 默认值与 env override 语义清楚
- **本 Phase 风险提醒**：
  - 如果 registry 字段不够克制，会在 v1 提前演化成半个控制平面

### 5.3 Phase 3 — ChatCompletionAdapter 与 LLMExecutor

- **Phase 目标**：建立唯一外部 wire 的执行路径，并把请求生命周期集中在 executor。
- **本 Phase 对应编号**：
  - `P3-01`
  - `P3-02`
  - `P3-03`
- **本 Phase 新增文件**：
  - `packages/llm-wrapper/src/adapters/types.ts`
  - `packages/llm-wrapper/src/adapters/openai-chat.ts`
  - `packages/llm-wrapper/src/executor.ts`
- **具体功能预期**：
  1. adapter 只做 provider request/response parsing，不接手 session stream 广播。
  2. executor 统一处理 timeout、abort、Retry-After、429/5xx/transport error，并按 provider profile 的简单 key rotation 策略尝试切换到下一个 API key。
  3. 仍坚持 `fetch` 为中心，不把系统绑进 claude-code 那种重型 SDK 工厂世界。
- **具体测试安排**：
  - **单测**：adapter request build、non-stream parse、executor retry/timeout
  - **集成测试**：mock fetch + fixture SSE
  - **回归测试**：429、5xx、断流、client cancel
  - **手动验证**：对照 `mini-agent` facade 与 `claude-code` request pipeline 的取舍差异
- **收口标准**：
  - v1 能通过统一 adapter contract 接入 OpenAI-compatible providers
  - executor 是唯一调用 fetch 的中心
  - 不需要让 kernel/session runtime 理解 provider 细节
- **本 Phase 风险提醒**：
  - 若把 retry 写进 adapter，后面错误语义会重新分裂

### 5.4 Phase 4 — Stream / Usage / Error / Session Mapping

- **Phase 目标**：将 provider 回包变成 nano-agent 自己的会话输出语言。
- **本 Phase 对应编号**：
  - `P4-01`
  - `P4-02`
  - `P4-03`
- **本 Phase 新增文件**：
  - `packages/llm-wrapper/src/stream-normalizer.ts`
  - `packages/llm-wrapper/src/session-stream-adapter.ts`
  - `packages/llm-wrapper/src/gateway.ts`
- **具体功能预期**：
  1. Stream normalizer 统一输出 `llm.request.started`、`llm.output.delta`、`llm.output.tool_call`、`llm.request.completed/failed` 等内部事件。
  2. session mapping 严格服从当前 `packages/nacp-session/src/stream-event.ts` 的现实：主要映射到 `llm.delta`、必要时辅助 `session.update` / `system.notify`；turn begin/end 仍由 kernel/session runtime 负责，并且相同的 normalized output body 应可被后续 WebSocket push 与 HTTP fallback/persisted delivery 共同复用。
  3. gateway seam 只保留接口，不完整实现 remote gateway。
- **具体测试安排**：
  - **单测**：stream chunk normalize、usage normalize、session kind mapping
  - **集成测试**：stream fixture -> normalized events -> session event bodies
  - **回归测试**：provider chunk shape 漂移、缺失 usage、finish reason 未知
  - **手动验证**：与当前 `nacp-session` kind catalog 逐项对表
- **收口标准**：
  - client-facing 输出不泄漏 provider 原始 wire
  - session output 与现有 `nacp-session` reality 完整对齐
  - gateway seam 不引入额外复杂度债务
- **本 Phase 风险提醒**：
  - 如果随意发明新的 session kinds，会直接打破 NACP 现实

### 5.5 Phase 5 — Fixtures / 测试 / 文档 / 网关占位

- **Phase 目标**：用 fixture-driven 方式证明 wrapper 真能稳定工作，并让下游可直接接入。
- **本 Phase 对应编号**：
  - `P5-01`
  - `P5-02`
  - `P5-03`
- **本 Phase 新增文件**：
  - `packages/llm-wrapper/fixtures/stream/*`
  - `packages/llm-wrapper/fixtures/non-stream/*`
  - `packages/llm-wrapper/fixtures/provider-profiles/*`
  - `packages/llm-wrapper/test/canonical.test.ts`
  - `packages/llm-wrapper/test/registry.test.ts`
  - `packages/llm-wrapper/test/attachment-planner.test.ts`
  - `packages/llm-wrapper/test/request-builder.test.ts`
  - `packages/llm-wrapper/test/executor.test.ts`
  - `packages/llm-wrapper/test/stream-normalizer.test.ts`
  - `packages/llm-wrapper/test/session-stream-adapter.test.ts`
  - `packages/llm-wrapper/test/integration/local-fetch-stream.test.ts`
  - `packages/llm-wrapper/test/integration/retry-timeout.test.ts`
  - `packages/llm-wrapper/test/integration/prepared-artifact-routing.test.ts`
- **本 Phase 修改文件**：
  - `packages/llm-wrapper/README.md`
  - `packages/llm-wrapper/src/index.ts`
- **具体功能预期**：
  1. fixture 可覆盖常见 OpenAI-compatible SSE 差异。
  2. mock fetch 可覆盖 429 / 5xx / timeout / cancel。
  3. README 明确说明：v1 只支持 Chat Completions，未冻结 `llm.invoke` Core 域。
- **具体测试安排**：
  - **单测**：分类与映射
  - **集成测试**：fixture-driven local-fetch
  - **回归测试**：已知 provider edge case fixtures
  - **手动验证**：最小 sample 接入到 fake kernel delegate
- **收口标准**：
  - wrapper 能在本地 mock world 下稳定跑通核心路径
  - 下游能直接 import canonical types、executor、session mapping helpers
  - 文档明确写清楚边界与未来 gateway seam
- **本 Phase 风险提醒**：
  - 若 fixture 不足，后面接不同 provider 时会再次暴露 chunk 兼容问题

---

## 6. 需要业主 / 架构师回答的问题清单

### 6.1 Q/A 填写模板

#### Q1

- **影响范围**：`Phase 2 / Phase 3 / Phase 5`
- **为什么必须确认**：它决定 v1 的 provider 接入边界，是“先做一个稳定 generic adapter”还是“立刻开始 vendor-specific matrix”。
- **当前建议 / 倾向**：`v1 只实现 generic OpenAI-compatible adapter + fixture profiles，不追求大量 vendor-specific 特判`
- **Q**：`v1 是否确认以 generic OpenAI-compatible Chat Completions adapter 为唯一实现主路径，而不是同时做多家 vendor-specific adapter？`
- **A**：v1 不要实现 vendor specific adapter，这个留到以后去实现。我们初期的目标，就是兼容所有支持 chat_completion api 规范的 vendor 就可以了。但是注意，我们支持的是规范，理论上，我们是要接入不同vendor的，这些vendor的base url 和 apikey 都不同。而且 apikey 可能还涉及到轮换，以抵抗 429 rate limit 错误。v1 先用主 worker 的 toml / env 注入，允许用逗号分隔的 key 列表做简单轮询与 `on-429` 切换，不要提前把它做成复杂控制平面。

#### Q2

- **影响范围**：`Phase 2 / Phase 4`
- **为什么必须确认**：图片、文档、大文件的默认路径会直接影响 attachment planner 与 prepared artifact contract。
- **当前建议 / 倾向**：`图片默认 URL staging；文档/大文件默认 prepared artifact；不做通用 raw file URL 保证`
- **Q**：`v1 是否正式确认“图片可 URL 进入，文档与大文件先走 prepared artifact，不承诺 raw file URL 直喂模型”？`
- **A**：LLM 的多模态，初期我们只要支持图片和PDF就行。其他文件类型，可以通过mime_type在 v1 进行限缩，在后期通过增加 mime_type 的注册范围，来规范不同模态，文件类型的路由，存储，拉取，以及转换规范。

#### Q3

- **影响范围**：`Phase 3 / Phase 4 / Phase 5`
- **为什么必须确认**：它决定是否需要在 v1 就实现远端 inference gateway 逻辑。
- **当前建议 / 倾向**：`v1 只落 local-fetch，保留 service-binding-gateway seam，不实现完整远端 worker`
- **Q**：`v1 是否确认“本地执行优先、远端 inference gateway 只做接口占位”这一路线？`
- **A**：只要求 local-fetch 就可以。暂时不做跨 worker 的LLM请求。这主要还是秘钥存储的问题。开发阶段，秘钥存储在主 worker 的 toml 里。其他 skill 如果需要使用 LLM 功能，也必须通过 service binding，通过主 worker 来进行 fetch。这是 v1 的要求。

### 6.2 问题整理建议

- `Q1` 是实现复杂度的第一分水岭。
- `Q2` 与 `workspace-context-artifacts` 强相关，最好在编码前拍板。
- `Q3` 不影响 action-plan 成文，但会影响 Phase 4/5 的范围。

---

## 7. 其他补充说明

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|-------------|------|----------|----------|
| `nacp-session` event reality | wrapper 不能把 provider 私有事件直接暴露给 client | high | Phase 4 严格对齐当前 `stream-event.ts`，并保持结果可被 WebSocket/HTTP fallback 共同消费 |
| `workspace-context-artifacts` 未实现 | attachment planner 需要最小 Artifact/PreparedArtifact 合同 | medium | Phase 2 先建立本包内最小 typed contract，并在后续 cross-doc go-through 对齐 |
| `nacp-core` 尚无 `llm.invoke` | 不能过早协议化 provider 调用 | medium | 明确 local-fetch 为主实现，gateway 只留 seam |
| provider “OpenAI-compatible” 程度不一 | adapter 容易不断长特判 | medium | registry notes + fixture cases + capability guard |

### 7.2 约束与前提

- **技术前提**：Cloudflare Workers / `fetch` / TypeScript / 无重型 provider SDK 依赖
- **运行时前提**：WebSocket-first client output、保留 HTTP fallback、HTTPS-first provider calls、128MB isolate、R2 staged object path；会话层的持久化与返回不应只依赖 heartbeat
- **组织协作前提**：`packages/*` 现由主仓 monorepo 统一跟踪；设计先行，后续由 action-plan 驱动实现；最终 deployable Worker / DO 会在更上层运行时包中组装这些 packages
- **上线 / 合并前提**：不得绕过当前 `nacp-session` reality；不得自行发明 `llm.invoke` Core 域

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/llm-wrapper-by-GPT.md`
  - `docs/design/session-do-runtime-by-opus.md`
  - `docs/design/workspace-context-artifacts-by-GPT.md`
  - `docs/design/eval-observability-by-opus.md`
- 需要同步更新的说明文档 / README：
  - `packages/llm-wrapper/README.md`
  - 根目录 `README.md`（如模型执行边界与包名需要回填）
- 需要同步更新的测试说明：
  - `docs/plan-after-nacp.md` 中的 fake provider / scenario runner 说明

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm --filter @nano-agent/llm-wrapper build`
  - `pnpm --filter @nano-agent/llm-wrapper typecheck`
- **单元测试**：
  - canonical / registry / request builder / planner / executor / normalizer / session mapping
- **集成测试**：
  - mock fetch + fixture stream / non-stream / retry / timeout
- **端到端 / 手动验证**：
  - 手动构造一次 `CanonicalLLMRequest -> adapter -> executor -> normalized events -> session event bodies`
  - 手动构造一次图片 URL path 与 prepared artifact path
- **回归测试**：
  - 429 / 5xx / transport error / cancel / unknown finish_reason / missing usage
- **文档校验**：
  - README 中明确列出 v1 wire scope、attachment policy、gateway seam

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. `@nano-agent/llm-wrapper` 能以独立包形式 build、typecheck、test
2. canonical request / result / event 已成为唯一内部真相，而不是 provider request body
3. attachment planner 能在 Worker 宿主约束下稳定规划图片与 prepared artifact 路径
4. provider 输出能被归一化并映射到当前 `nacp-session` reality
5. future inference gateway 可通过 seam 接入，而无需重写上层 kernel/session runtime

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|------|----------|
| 功能 | wrapper 已具备 registry、builder、adapter、executor、normalizer、session mapping 的完整主路径 |
| 测试 | fixture-driven tests 覆盖流式、非流式、重试、超时、附件路径与 session mapping |
| 文档 | README 与 cross-doc 说明能清楚解释 v1 取舍与未来 gateway seam |
| 风险收敛 | provider JSON、SSE、附件路径与错误分类不再污染上层 agent loop |
| 可交付性 | kernel / session runtime / future gateway 都能直接 import 本包 API |

---

## 9. 执行后复盘关注点

- **哪些 Phase 的工作量估计偏差最大**：`待回填`
- **哪些编号的拆分还不够合理**：`待回填`
- **哪些问题本应更早问架构师**：`待回填`
- **哪些测试安排在实际执行中证明不够**：`待回填`
- **模板本身还需要补什么字段**：`待回填`

---

## 10. 结语

> 这份 action-plan 以 **冻结 nano-agent 的模型执行边界** 为第一优先级，采用 **先 canonical/registry、后 adapter/executor、再 normalizer/session mapping、最后 fixture 收口** 的推进方式，优先解决 **请求格式统一、附件路径统一、provider 输出统一**，并把 **只支持 Chat Completions、local-fetch 优先、不提前协议化 `llm.invoke`** 作为主要约束。整个计划完成后，`LLM Wrapper` 应达到 **可在 Worker 宿主中稳定承担模型调用、又不把 provider 细节泄漏给上层 runtime** 的程度，从而为后续的 `session-do-runtime`、`workspace-context-artifacts`、`eval-observability` 与 future inference gateway 提供稳定基础。
