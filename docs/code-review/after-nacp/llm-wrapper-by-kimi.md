# Code Review — @nano-agent/llm-wrapper

> 审查对象: `packages/llm-wrapper/`
> 审查时间: `2026-04-17`
> 审查人: `Kimi k2p5`
> 审查范围:
> - `docs/action-plan/llm-wrapper.md`
> - `docs/design/llm-wrapper-by-GPT.md`
> - `packages/llm-wrapper/src/` (14 files)
> - `packages/llm-wrapper/test/` (6 test files)
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：llm-wrapper 的核心骨架（canonical model、registry、attachment planner、request builder、OpenAI adapter、executor、stream normalizer、session mapping）已完整实现，80 个测试全过；但 action-plan 明确要求的 fixture 体系、多项集成测试、部分文档与 `on-429` key rotation 策略仍有缺失或未完全落地。
- **结论等级**：`approve-with-followups`
- **本轮最关键的 1-3 个判断**：
  1. `on-429` API key rotation policy 在类型中声明但**完全没有实现**，executor 在 429 重试时仍使用同一 API key，与 action-plan Q1 的业主答复要求不符。
  2. action-plan 要求的 `fixtures/` 目录体系与 3 个 integration tests 全部缺失，测试完全依赖 inline mock，未形成 fixture-driven 回归基座。
  3. `README.md` 与 `canonical.test.ts` 缺失，影响下游直接使用与 canonical model 的回归覆盖。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/llm-wrapper.md`
  - `docs/design/llm-wrapper-by-GPT.md`
  - `README.md`
- **核查实现**：
  - `packages/llm-wrapper/src/` — 14 个源文件
  - `packages/llm-wrapper/test/` — 6 个测试文件
- **执行过的验证**：
  - `pnpm --filter @nano-agent/llm-wrapper typecheck` ✅ passed
  - `pnpm --filter @nano-agent/llm-wrapper test` ✅ 6 test files, 80 tests passed

### 1.1 已确认的正面事实

- `CanonicalContentPart` / `CanonicalMessage` / `CanonicalLLMRequest` / `CanonicalLLMResult` 已在 `canonical.ts` 冻结，内部模型与 provider JSON 显式脱钩。
- `ProviderRegistry` 支持多 API key 注册与 `round-robin` 轮询 (`getNextApiKey`)，registry loader 支持 config 对象与 env 变量注入。
- `ModelRegistry` 支持 stream/tools/vision/json-schema 能力查询，`checkCapability()` 为请求前拦截提供入口。
- `AttachmentPlanner` 以 MIME type 为第一路由键，正确区分 `image-url` / `inline-text` / `prepared-text` / `reject`。
- `RequestBuilder` 在请求发出前完成 capability gate（stream、tools、jsonSchema、vision），并与 provider registry 的 API key 轮换对接。
- `OpenAIChatAdapter` 完整实现了 `buildRequestBody`、`buildRequestHeaders`、`parseStreamChunk`、`parseNonStreamResponse`，支持 SSE 流解析、tool call delta、usage-only chunk、finish reason 映射。
- `LLMExecutor` 统一处理非阻塞执行与流式执行，`execute()` 支持指数退避重试、超时取消、HTTP 错误分类（401/429/400/5xx）。
- `StreamNormalizer` 将 adapter chunk 转换为 `NormalizedLLMEvent`。
- `SessionStreamAdapter` 将 normalized event 映射为 `llm.delta` / `llm.tool_call` / `system.notify`，`finish` 事件显式返回 `null`（由 kernel 负责 `turn.end`）。
- `InferenceGateway` 接口作为 future seam 已就位。

### 1.2 已确认的负面事实

- `packages/llm-wrapper/README.md` 不存在。
- `fixtures/` 目录不存在；action-plan 列出的 `fixtures/stream/`、`fixtures/non-stream/`、`fixtures/provider-profiles/` 均未创建。
- `test/canonical.test.ts` 缺失（action-plan P5-01 明确要求）。
- `test/integration/local-fetch-stream.test.ts`、`test/integration/retry-timeout.test.ts`、`test/integration/prepared-artifact-routing.test.ts` 全部缺失。
- `ProviderProfile.keyRotationPolicy` 包含 `"on-429"`，但 `ProviderRegistry` 与 `LLMExecutor` 均未实现该策略；429 重试时不会切换 key。
- `LLMExecutor` 未在请求开始时 emit `llm.request.started` normalized event（design doc F5 明确列出）。
- `OpenAIChatAdapter.parseStreamChunk` 处理 `delta.tool_calls` 时只读取数组第 0 项，若 provider 一次返回多个 tool call 会丢失后续项。

---

## 2. 审查发现

### R1. `on-429` API key rotation policy 未实现

- **严重级别**：`high`
- **类型**：`scope-drift`
- **事实依据**：
  - `src/registry/providers.ts:13` 类型声明：`keyRotationPolicy?: "round-robin" | "on-429"`
  - `src/registry/providers.ts:51-60` `getNextApiKey()` 仅实现 round-robin，未感知 HTTP 状态码
  - `src/executor.ts:37-93` 429 重试时调用 `execute(makeExec())`，而 `exec.apiKey` 在 `buildExecutionRequest` 阶段已固定，重试循环内不会重新获取 key
  - action-plan Q1 业主答复明确："v1 先用主 worker 的 toml / env 注入，允许用逗号分隔的 key 列表做简单轮询与 `on-429` 切换"
- **为什么重要**：这是业主确认过的 v1 关键需求；遇到 429 时不能切换 key 意味着多 key 配置的抗限流价值大打折扣。
- **审查判断**：类型层承诺了 `on-429` 能力但 runtime 未兑现，属于显式需求遗漏。
- **建议修法**：
  1. 在 `LLMExecutor.execute()` 的 retry 循环中，当遇到 429 且 `keyRotationPolicy === "on-429"` 时，调用 `exec.provider` 的 key rotation 逻辑获取下一个 key（可临时扩展 `ProviderRegistry` 的 `rotateOn429(name)` 方法）。
  2. 在 `request-builder.ts` 中不要将 `apiKey` 写死进 `ExecutionRequest`，或允许 executor 在重试时覆盖 `apiKey`。
  3. 补充 429 key rotation 的单元测试或 integration test。

### R2. Fixture 目录与 fixture-driven tests 完全缺失

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 明确列出 `fixtures/stream/`、`fixtures/non-stream/`、`fixtures/provider-profiles/`
  - 当前 `packages/llm-wrapper/` 下无 `fixtures/` 目录
  - 所有测试均使用硬编码 inline mock（如 `executor.test.ts` 的 `mockFetch`、`stream-normalizer.test.ts` 的硬编码 SSE 字符串）
- **为什么重要**：action-plan 将 "fixture-driven tests 覆盖流式、非流式、重试、超时、附件路径与 session mapping" 列为 P5-01 收口标准；无 fixtures 意味着 provider edge case 无法通过添加 fixture 文件快速回归，也无法让新接入者通过阅读 fixture 理解预期行为。
- **审查判断**：这是 action-plan 明确要求的测试基座缺失。
- **建议修法**：
  1. 创建 `fixtures/provider-profiles/` 并放入至少 2 个 profile JSON（如 openai、azure）。
  2. 创建 `fixtures/stream/` 并放入完整 SSE fixture（含 delta、tool_call delta、finish、usage-only、[DONE]）。
  3. 创建 `fixtures/non-stream/` 并放入非流式响应 JSON fixture（含 tool_calls、usage）。
  4. 将现有 inline mock 逐步迁移为读取 fixture，或至少让新增测试基于 fixture。

### R3. 3 个 integration tests 缺失

- **严重级别**：`high`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 列出 3 个 integration tests：`local-fetch-stream.test.ts`、`retry-timeout.test.ts`、`prepared-artifact-routing.test.ts`
  - 当前 `test/integration/` 目录不存在
- **为什么重要**：integration tests 是验证 "canonical -> adapter -> executor -> normalizer -> session mapping" 端到端链路的关键；缺少它们无法证明 wrapper 在真实调用链中正确收敛到 session event。
- **审查判断**：必须在收口前补齐。
- **建议修法**：
  - `local-fetch-stream.test.ts`：用 mock fetch 构造完整 SSE 流，验证从 `CanonicalLLMRequest` 到 `session.stream.event` bodies 的端到端产出。
  - `retry-timeout.test.ts`：验证 executor 在 timeout/429/500 场景下的重试行为、最终错误分类与事件输出。
  - `prepared-artifact-routing.test.ts`：验证 attachment planner 对 prepared artifact 的决策能正确影响 canonical request 构建。

### R4. README.md 缺失

- **严重级别**：`high`
- **类型**：`docs-gap`
- **事实依据**：
  - `packages/llm-wrapper/README.md` 不存在
  - action-plan P1-01 / P5-03 明确要求 README
- **为什么重要**：下游包（kernel、session-do-runtime）需要快速理解 wrapper 的 canonical 类型、registry 用法、executor 接口、v1 限制（仅 Chat Completions）与 gateway seam。
- **审查判断**：必须在收口前补齐。
- **建议修法**：添加 README，至少包含：包用途简述、canonical model 说明、registry/builder/executor 基本用法、attachment policy、v1 限制（仅 OpenAI-compatible Chat Completions、无 vendor-specific adapter、未冻结 `llm.invoke` Core 域）。

### R5. `canonical.test.ts` 缺失

- **严重级别**：`medium`
- **类型**：`test-gap`
- **事实依据**：
  - action-plan §1.5 列出 `test/canonical.test.ts`
  - 当前 test 目录中无此文件
- **为什么重要**：`canonical.ts` 是整个包的根基类型文件；缺失单测意味着 content part 构造、finish reason 映射、event 类型 guard 等变更时缺乏快速回归能力。
- **审查判断**：应补齐。
- **建议修法**：创建 `canonical.test.ts`，覆盖：
  - `CanonicalContentPart` 构造与类型收窄
  - `NormalizedLLMEvent` discriminant 访问
  - `createEmptyUsage()` 行为
  - 如存在任何 runtime helper（如内容 part 验证函数），一并测试

### R6. `LLMExecutor` 未 emit `llm.request.started` 事件

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **事实依据**：
  - design doc F5 列出的 NormalizedLLMEvent 包含 `{ type: 'llm.request.started'; requestId: string; modelId: string }`
  - `src/executor.ts:96` `executeStream()` 在发起 fetch 后直接开始 yield parsed chunks，未产生 started 事件
  - `src/executor.ts:37` `execute()` 同样未产生 started 事件
- **为什么重要**：`llm.request.started` 是 eval-observability 与 session stream 追踪 request lifecycle 的重要锚点；缺少它会让下游无法精确计算 TTFT（time to first token）与归因。
- **审查判断**：属于 design doc 明确事件清单的遗漏。
- **建议修法**：在 `executeStream()` 的 `yield*` 开始前先 `yield { type: "llm.request.started", requestId: exec.request.metadata?.requestId ?? "", modelId: exec.request.model }`；非流式 `execute()` 虽不返回 generator，但可考虑通过传入可选 callback 或 future event emitter 补回 started 事件。

### R7. `OpenAIChatAdapter.parseStreamChunk` 只处理单 tool call

- **严重级别**：`low`
- **类型**：`correctness`
- **事实依据**：
  - `src/adapters/openai-chat.ts:158-176` 处理 `delta.tool_calls` 时仅访问 `delta.tool_calls[0]`
  - OpenAI SSE 规范允许 `delta.tool_calls` 数组包含多个 tool call 片段（虽然常见的是逐 index 出现）
- **为什么重要**：若 provider 在一次 delta 中同时推送 index 0 和 index 1 的 tool_call 片段，当前实现会静默丢弃 index 1 的信息，导致 tool call 不完整。
- **审查判断**：功能可用，但存在已知边界漏洞。
- **建议修法**：遍历 `delta.tool_calls` 数组，为每个带 `id+name` 的项产生 `tool_call` 事件，为每个带 `arguments` 的项产生 `delta` 事件；或在注释中显式说明 "v1 假设 provider 每次只推送一个 tool call index"。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| S1 | 独立包骨架 | done | package.json、tsconfig.json、build/typecheck/test 均正常 |
| S2 | Canonical model | done | canonical.ts 已冻结文本/图片/tool 的统一内部模型 |
| S3 | provider/model registry + loader | done | 支持 config/env 注入、多 key 轮询 |
| S4 | capability guard | done | request-builder.ts 在请求前拦截 stream/tools/jsonSchema/vision |
| S5 | attachment planner | done | attachment-planner.ts 实现 4 路由策略 |
| S6 | prepared artifact contract | done | prepared-artifact.ts 最小类型已就位 |
| S7 | ChatCompletionAdapter 接口 + OpenAI adapter | done | adapters/types.ts + openai-chat.ts 完整实现 |
| S8 | LLMExecutor (local-fetch / abort / timeout / retry) | partial | retry/timeout 正确，但 `on-429` key rotation 未实现；缺少 `llm.request.started` 事件 |
| S9 | stream normalizer | done | stream-normalizer.ts 就位，测试覆盖完整 |
| S10 | usage / error normalization | done | usage.ts / errors.ts 统一了 finish reason 与错误分类 |
| S11 | session stream adapter | done | 对齐 nacp-session reality，不越界 turn begin/end |
| S12 | gateway seam | done | gateway.ts 接口占位 |
| S13 | mock fetch / fixture-based tests | partial | mock fetch 测试完整，但 fixture 体系与 3 个 integration tests 缺失 |
| S14 | README / 导出面 | missing | README 不存在；index.ts 导出完整 |

### 3.1 对齐结论

- **done**: 11
- **partial**: 2
- **missing**: 1

> 该实现更像“核心 adapter/executor/registry 已完成且测试通过，但 fixture 基座、集成测试、文档与部分细节（on-429 key rotation、started event）仍未收口”，而非 action-plan 定义的全面完成状态。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | Anthropic native Messages adapter | 遵守 | 未实现 |
| O2 | OpenAI Responses API adapter | 遵守 | 未实现 |
| O3 | provider 原生 WebSocket / Realtime transport | 遵守 | 未实现 |
| O4 | 完整 `llm.invoke` nacp-core domain | 遵守 | 明确 local-fetch 优先，未冻结 Core 域 |
| O5 | provider SDK 全家桶 | 遵守 | 仅使用原生 fetch + adapter |
| O6 | 完整 OCR / PDF parse / CSV summarize | 遵守 | 仅提供 prepared artifact seam |
| O7 | sub-agent / orchestration | 遵守 | 未涉及 |
| O8 | 自动 provider routing / A-B / cost optimizer | 遵守 | 未涉及 |
| O9 | 真实远端 inference gateway worker 实装 | 遵守 | 仅接口占位 |
| O10 | 任意二进制 inline 提交 | 遵守 | attachment planner 明确限缩 |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：`approve-with-followups` — 核心实现扎实，80 测试全过，typecheck 通过，但存在 **1 个 high 级功能遗漏（on-429 key rotation 未实现）**、fixture 与 integration tests 缺失、README 缺失，以及 `llm.request.started` 事件遗漏。
- **是否允许关闭本轮 review**：`no`
- **关闭前必须完成的 blocker**：
  1. 实现 `on-429` API key rotation 策略并在 executor 的 429 重试路径中生效（R1）
  2. 补齐 `README.md`（R4）
  3. 补齐 `fixtures/` 目录体系（至少 stream / non-stream / provider-profiles）（R2）
  4. 补齐 3 个缺失的 integration tests：`local-fetch-stream.test.ts`、`retry-timeout.test.ts`、`prepared-artifact-routing.test.ts`（R3）
  5. 补齐 `test/canonical.test.ts`（R5）
- **可以后续跟进的 non-blocking follow-up**：
  1. 在 `executeStream()` 中补充 `llm.request.started` 事件（R6）
  2. 考虑改进 `OpenAIChatAdapter` 对多 tool call 的支持（R7）

> 本轮 review 不收口，等待实现者按 §6 响应并再次更新代码。

---

## 6. 实现者回应模板

> **规则**：
> 1. 不要改写 §0–§5；只允许从这里往下 append
> 2. 回应时按 `R1/R2/...` 对应，不要模糊说“已修一些问题”
> 3. 必须写明“哪些修了、怎么修的、改了哪些文件、跑了什么验证”
> 4. 若选择不修某条 finding，必须写明理由与 tradeoff

### 6.1 对本轮审查的回应

> 执行者: `{IMPLEMENTER}`
> 执行时间: `{DATE}`
> 回应范围: `R1–R7`

- **总体回应**：`{ONE_LINE_RESPONSE}`
- **本轮修改策略**：`{STRATEGY}`

### 6.2 逐项回应表

| 审查编号 | 审查问题 | 处理结果 | 处理方式 | 修改文件 |
|----------|----------|----------|----------|----------|
| R1 | on-429 key rotation 未实现 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R2 | fixture 目录与测试缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R3 | 3 个集成测试缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R4 | README 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R5 | canonical.test.ts 缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R6 | llm.request.started 事件缺失 | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |
| R7 | parseStreamChunk 只处理单 tool call | `fixed | partially-fixed | rejected | deferred` | `{HOW}` | `{FILES}` |

### 6.3 变更文件清单

- `{FILE_1}`
- `{FILE_2}`
- `{FILE_3}`

### 6.4 验证结果

```text
{TEST_OR_BUILD_OUTPUT_SUMMARY}
```

### 6.5 实现者收口判断

- **实现者自评状态**：`ready-for-rereview | partially-closed | blocked`
- **仍然保留的已知限制**：
  1. `{KNOWN_LIMITATION_1}`
  2. `{KNOWN_LIMITATION_2}`

---

## 7. 二次审查模板

> **规则**：
> 1. 二次审查人不得改写 §0–§6，只能继续 append
> 2. 二次审查必须区分：已验证修复有效 / 仅部分修复 / 新引入问题
> 3. 必须明确“本轮是否收口”

### 7.1 二次审查结论

> 复核者: `{REVIEWER}`
> 复核时间: `{DATE}`
> 复核依据: `实现者 §6 的回应 + 当前代码事实`

- **二次结论**：`{ONE_LINE_REREVIEW_VERDICT}`
- **是否收口**：`yes | no`

### 7.2 已验证有效的修复

| 审查编号 | 复核结论 | 依据 |
|----------|----------|------|
| R1 | `closed` | `{FILE:LINE / command / test}` |
| R2 | `closed` | `{FILE:LINE / command / test}` |

### 7.3 仍未收口的问题

| 审查编号 | 当前状态 | 说明 | 下一步要求 |
|----------|----------|------|------------|
| R3 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |
| R4 | `open | partial | regressed` | `{WHY}` | `{ACTION}` |

### 7.4 二次收口意见

- **必须继续修改的 blocker**：
  1. `{BLOCKER_1}`
  2. `{BLOCKER_2}`
- **可后续跟进的 follow-up**：
  1. `{FOLLOWUP_1}`
  2. `{FOLLOWUP_2}`

> 若仍不收口，请明确写：请实现者根据本节继续更新代码，并在本文档底部追加下一轮回应。

---

## 8. 文档纪律

- review 文档是**append-only**的执行记录：
  - 初审写 §0–§5
  - 实现者回应写 §6
  - 二次审查写 §7
  - 如有第三轮，继续在底部追加 `§8+`
- 不要删除上一轮判断；如果观点变化，必须写“为什么变化”
- 每条结论都应尽量有**文件 / 行号 / 命令输出**支撑
- 如果 action-plan / design doc 的边界本身变了，先更新源文档，再继续 code review

---

## 9. 对 Kimi 代码审查质量的评价

> 评价人: `Claude Opus 4.7 (1M context)`
> 评价时间: `2026-04-17`
> 评价依据: `Kimi 审查（§1–§5）与最终代码复核结果的对照`
>
> 注：本次修复的具体工作日志全部写在 `docs/code-review/llm-wrapper-by-GPT.md §7`，不在此重复。

### 9.1 一句话评价

**稳健而全面 + 有一处关键漏判**：Kimi 在 fixture / integration tests / README / canonical.test.ts / on-429 key rotation / `llm.request.started` / 多 tool_call 边界七条上都命中（有些甚至是 GPT 漏掉的），但把最高风险的 `session-stream-adapter` 对 `SessionStreamEventBodySchema` 的 shape 漂移直接判为 `done`，这是本轮 Kimi 唯一但结构性的盲点。

### 9.2 优点

1. **R1 `on-429` 未实现的根因锁定精准**：直接引了 `src/registry/providers.ts:51-60` + `src/executor.ts:37-93` 两处，明确指出 "`exec.apiKey` 在 `buildExecutionRequest` 阶段已固定，重试循环内不会重新获取 key"。修法四步（rotate method + executor hot-swap key + non-frozen apiKey + key-rotation test）可直接落地。
2. **R2 / R3 fixture / integration-tests 清单齐全**：把 action-plan §1.5 列出的 fixtures 目录 + 3 个 integration tests（`local-fetch-stream` / `retry-timeout` / `prepared-artifact-routing`）全部点名；本轮补齐时几乎一一对应 Kimi 指出的缺项。
3. **R6 抓到 `llm.request.started` 缺失**：设计 doc F5 明确列出这个事件，Kimi 准确对照 executor 未 emit 的事实。本轮修复顺势把它放进 NormalizedLLMEvent 主路径。这是 GPT 漏掉的发现。
4. **R7 多 tool_call 边界属于 low 但真实**：抓到 OpenAI SSE 可能在一次 delta 里推多个 tool_call 片段的边界；虽然 severity 判 low 合理，但点明 "静默丢 index 1" 就是 correctness 盲点。这也是 GPT 漏掉的。
5. **out-of-scope 清单扎实**：§4 所有 10 条 "遵守" 都有一句证据，没有为 out-of-scope 放水。

### 9.3 可以更好的地方

1. **对 `session-stream-adapter` 协议真相层完全漏判**：Kimi S11 判 `done`："对齐 nacp-session reality，不越界 turn begin/end"。但实际代码发明了 `llm.tool_call` kind、`system.notify` 用 `level` 字段、`llm.delta` body 缺 `content_type`/`is_final`——这三处都是一发 `SessionStreamEventBodySchema.safeParse` 就爆的 critical 错误。Kimi 的审查缺少 "拿本地产物跑 workspace / session 真实 schema" 这一步。如果做了，会直接改变 verdict 为 `changes-requested`。
2. **与上一条相关，verdict 偏乐观**：`approve-with-followups` 的分级在协议层漂移未捕捉的前提下风险偏高。GPT 用 `changes-requested` 更适合 MVP 收口节奏。
3. **R1 的 "四步修法" 没强调 `maxRetries` 主路径本身也不兑现 provider 设定**：Kimi 只关注了 on-429 路径，没有发现 `provider.retryConfig.maxRetries: 0` 时 `execute()` 仍然重试 3 次。GPT 的 R2 发现了这条。
4. **未发现 attachment / prepared-artifact 漂移**：Kimi S5 / S6 都判 `done`，但 `AttachmentRoute` 命名 (`image-url` / `inline-text`) 与 action-plan 的 worker-native 语义不一致，`PreparedArtifactRef` 与 workspace schema 不兼容。GPT R3 发现了这条。
5. **缺 "实机 safeParse 对拍" 证据**：R6 / R7 都是静态阅读；如果 Kimi 同样跑一次 `SessionStreamEventBodySchema.safeParse()` 会立刻抓到 S11 误判。

### 9.4 评分

| 维度 | 评分（1–5） | 说明 |
|------|-------------|------|
| 证据链完整度 | 3.5 | 行号精准，但缺 cross-package safeParse 实机复现 |
| 判断严谨性 | 3 | 对最高风险层（session-stream-adapter）判 `done`，是结构性漏判 |
| 修法建议可执行性 | 4.5 | R1 四步修法极具操作性；其他条也都给出命名与路径 |
| 对 action-plan / design 的忠实度 | 5 | §1.5 / P5 产出清单、design doc F5 / Q1 都引到位 |
| 协作友好度 | 5 | `approve-with-followups` 语气理性；清单型呈现便于收敛 |

总体 **3.9 / 5** — 作为 "交付物 + 细节 correctness" 审计稳健且有两条 GPT 漏掉的独到发现（R6 / R7），但在最高风险的协议真相层出现了结构性漏判。与 GPT 并读能形成强互补；单独使用会错判收口节奏。
