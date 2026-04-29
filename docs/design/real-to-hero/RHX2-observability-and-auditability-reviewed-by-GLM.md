# Nano-Agent 设计审查 — RHX2 Observability & Auditability

> 审查对象: `RHX2 Observability & Auditability — 日志、报错、可审计性强化簇`
> 审查类型: `design-review`
> 审查时间: `2026-04-29`
> 审查人: `GLM-5.1`
> 审查范围:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.1
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-opus.md`
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md`
> - 仓库代码：`packages/nacp-core/src/{error-registry,error-body,observability,envelope,messages/system}.ts`、`packages/orchestrator-auth-contract/src/facade-http.ts`、6 worker 错误路径、`packages/nacp-session/src/errors.ts`、`workers/agent-core/src/kernel/errors.ts`、`workers/agent-core/src/llm/errors.ts`、`workers/orchestrator-auth/src/errors.ts`、`workers/filesystem-core/src/storage/errors.ts`、`packages/storage-topology/src/errors.ts`、`workers/agent-core/src/eval/metric-names.ts`、`packages/eval-observability/src/metric-names.ts`、`workers/bash-core/src/{executor,bridge}.ts`、console 使用分布（全域 grep）
> 对照真相:
> - `docs/charter/plan-real-to-hero.md` §4.1-4.5 / §7.4+ / §8.4 / §10.3
> - `docs/design/real-to-hero/RHX-qna.md`（QNA 冻结状态）
> - 两份 audit study（Opus + DeepSeek）的事实盘点
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：RHX2 设计文档是 nano-agent 项目到目前为止最完整、最自洽的 observability 设计提案。它精确地识别了核心痛点（6 worker 0~32 行 console、错误码 80 枚横跨 7 套枚举、NACP `system.error` / `NacpObservabilityEnvelope` schema-only 零 emit、前端 debug 强依赖 `wrangler tail`）、给出了克制且可执行的 first-wave 方案（1 个共享包 + 1 张 D1 表 + 1 份 docs + 1 个 endpoint + 1 个 stream-event kind + 1 个 HTTP header），并在 6 大核心取舍上做了显式论证。但设计在 3 个维度存在需要修正或强化的盲区：(1) **F7 `system.error` 与 `FacadeErrorEnvelope` 之间存在语义缝隙**——HTTP 路径走 facade envelope、WS 路径走 `system.error` kind，但两者之间没有显式的映射规则，前端在 "HTTP 500 + 同一 WS system.error" 场景下将重复收到错误且无法去重；(2) **F4 单写点的可用性单点风险被低估**——所有 worker 错误日志写入经 orchestrator-core 单点转发，当 orchestrator-core 自身不可用时错误日志完全丢失（设计承认了这一点但把它归类为"可接受"——我不同意这个判断，因为 orchestrator-core 不可用的高概率场景恰恰是它自身报错的时候）；(3) **F9 只给了质量目标（≥5 行 logger.error）但没有给出 bash-core / orchestrator-auth 错误路径的完整枚举**——这使得 action-plan 编写时无法精确评估工作量。
- **结论等级**：`approve-with-follow-ups`
- **是否允许关闭本轮 review**：`no`（Q-Obs1~Q-Obs5 未答复、R3/R8/R9 需要设计修正补充）
- **本轮最关键的 3 个判断**：
  1. **F7 `system.error` 与 F2 `FacadeErrorEnvelope` 之间缺少显式映射规则**——同一请求的 HTTP 错误响应和 WS 推送是两条独立通道，前端需要一个去重/合并规则，否则会出现"500 + system.error 双重告警"的 UX 问题。设计 §7.2 F2 和 F7 各自完整但缺少交叉说明。
  2. **F4 orchestrator-core 单写点的 D1 写入路径不是"其他 worker 通过 RPC 转发"这么简单**——agent-core 已有 `ORCHESTRATOR_CORE` service binding，但 bash-core / context-core / filesystem-core 的 wrangler.jsonc 没有声明 `ORCHESTRATOR_CORE` binding，这意味着 4 个 worker 中只有 agent-core 现在就能 RPC 转发，其余 3 个需要新增 service binding。设计 §3.3 解耦对象 2 声称"通过现有的 `ORCHESTRATOR_CORE` service binding"，这不是事实。
  3. **`NacpObservabilityEnvelopeSchema` 的 `metrics` 和 `traces` 字段在 first-wave 完全是空字典 `{}`**——设计正确地声明了"first-wave 不做 metric emit"（O3），但 F8 的 `emitObservabilityAlert()` 只写 `alerts` 数组，而 envelope schema 中 `metrics: {}` 和 `traces: {}` 会作为默认值持久存在。这意味着序列化出来的 JSON 永远有这两个空字段，而消费者需要判断 `Object.keys(envelope.metrics).length === 0`——这是一个认知负担和未来扩展的隐患。

---

## 1. 审查方法与已核实事实

### 1.1 审查方法

我独立完成了以下核实工作：

1. **全量阅读** RHX2 设计文档（690 行）、Opus audit study（412 行）、DeepSeek audit study（486 行）
2. **代码事实核查**：对 6 worker 的 console 使用分布、错误枚举体系、NACP 协议 schema 定义、service binding 配置做全域 grep + 逐文件核查
3. **代码-设计交叉校验**：对比设计文档声称"已冻结"的代码事实与实际代码是否一致
4. **不参考** Kimi / DeepSeek / GPT 的分析报告，所有判断基于独立推理

### 1.2 已确认的正面事实

- NACP `SystemErrorBodySchema` 已在 `packages/nacp-core/src/messages/system.ts:16` 注册（`registerMessageType("system.error", SystemErrorBodySchema, ...)`），type-direction-matrix 已包含 `"system.error": new Set(["error"])`，admissibility 测试覆盖了 system.error 在任何 phase 都被允许
- `NacpObservabilityEnvelopeSchema` 已定义（`packages/nacp-core/src/observability/envelope.ts:71-77`），包含 `alerts` / `metrics` / `traces` 三段，且有 `NacpAlertPayloadSchema` 含 `trace_uuid` + `severity` + `category` 等字段，schema 完整度很高
- `NacpErrorBodySchema` 已定义（`error-body.ts:34-44`），含 `code` / `message` / `retriable` / `cause`，设计合理
- `NACP_ERROR_BODY_VERBS` 当前为空 Set（`error-body.ts:57`），文档明确标注为 provisional，这是正确的
- FacadeErrorCode 32 枚举值已在 `orchestrator-auth-contract/src/facade-http.ts` 定义，`facadeError()` 函数已有 2 个生产调用点（均在 orchestrator-core），schema 完整
- agent-core 已有 `ORCHESTRATOR_CORE` service binding（wrangler.jsonc:49），RPC 路径已有实装（`forwardServerFrameToClient`）
- `state-machine.ts` 已为 6 种角色（3 路由 + 3 DO）定义 `canProduce` 和 `consumer` 集合，其中 `system.error` 已在 `"orchestrator-core"` 和 `"agent-core"` 的 `canProduce` 中（lines 142/146），在 `"client"` 的 `consumer` 中（line 167）
- StorageError 双份复制已被设计识别（§5.1 S10 / §8.5），ESLint `no-restricted-imports` 方案正确
- metric-names 双份复制同理
- evidence-emitters 的"双份"实际不是纯复制——context-core 和 filesystem-core 的 emitters emit 不同流类型（assembly/compact/snapshot vs artifact），设计 DeepSeek audit §4.3 E2 声称"evidence-emitters 重复"需要修正
- charter §8.4 migration 编号分配（010→RH4, 011→RH5）已冻结
- 6 worker `console.*` 总计 32 次调用（0 console.error / 1 console.log / 31 console.warn），orchestrator-auth 和 bash-core 确实是 0 console

### 1.3 已确认的负面事实

- `NACP_ERROR_BODY_VERBS` 为空 Set——当前没有任何 verb 使用 `NacpErrorBodySchema` 作为 body schema，`wrapAsError()` 的输出对现有 verb 会 fail `validateEnvelope()`
- `system.error` 虽然 schema 已定义且 matrix/admissibility 已注册，但**零 worker 在生产路径中构建或 emit `system.error` frame**——grep 34 次出现全在 test 文件和 schema/registry 定义中
- `NacpObservabilityEnvelopeSchema` 零 import/零使用——grep 仅在自身定义和 index.ts re-export 中出现，没有 worker 导入或使用它
- orchestrator-auth / bash-core 0 console——设计正确识别，但设计 §7.2 F9 的"bash-core executer.ts / orchestrator-auth 鉴权失败路径"的工作量枚举不完整（见 R9）
- `Server-Timing` header 在整个代码库中**零出现**——grep 完全为空
- `nano_error_log` D1 表在当前 migration 中不存在
- `/debug/logs` route 不存在
- `worker-logger` 包不存在
- bash-core 使用**临时字符串 code**（`"policy-denied"` / `"empty-command"`），没有 enum 支撑——这些临时 code 不在 FacadeErrorCode / NACP_* 的 80 枚举中，F3 的"80 code 全量汇总"无法覆盖它们除非新增枚举值
- `respondWithFacadeError()` helper 不存在——这是 RHX2 要创建的新东西，但设计的 F2 收口目标"6 worker 的 fetch handler 在 catch 路径都走它"是一个**6 处 codemod**，工作量被低估

### 1.4 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 6 worker console 分布 / error 枚举 / NACP schema / service binding / facadeError 调用点 逐文件核查 |
| 本地命令 / 测试 | no | 设计审查阶段，未运行测试 |
| schema / contract 反向校验 | yes | NACP error-registry / type-direction-matrix / state-machine / SystemErrorBodySchema / NacpObservabilityEnvelopeSchema 交叉校验 |
| 与上游 design / QNA 对账 | yes | RHX2 设计 §0-10 逐节对账 charter §4.1-4.5 / §8.4 / §10.3 |
| 两份 audit study 交叉校验 | yes | 参与 Opus §1-6 / DeepSeek §1-6 事实盘点交叉验证 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `system.error` 与 `FacadeErrorEnvelope` 缺少映射规则 | high | protocol-drift | no | 设计补充 §7.2 F2 × F7 交叉说明 |
| R2 | orchestrator-core 单写点在其他 3 worker 缺少 service binding | high | correctness | no | 修正 §3.3 解耦对象 2 的事实错误；action-plan 显式列出 binding 新增 |
| R3 | `nano_error_log` 写入的 orchestrator-core 单点不可用=丢失全部错误日志 | high | platform-fitness | no | 补充 fallback 写入策略或接受显式风险声明 |
| R4 | `NacpObservabilityEnvelope` 的空 `metrics` / `traces` 字段是认知负担 | medium | docs-gap | no | F8 一句话收口目标补充 envelope 序列化行为说明 |
| R5 | F3 "80 code 全量汇总" 无法覆盖 bash-core 临时字符串 code | medium | scope-drift | no | 明确 F3 覆盖范围：仅覆盖有 enum/constant 支撑的 code；临时 string code 列入 F9 接 logger 时一起归化 |
| R6 | F5 `/debug/logs` 与 RH3 device gate 鉴权重用——design 未说明鉴权细节 | medium | security | no | action-plan 显式写鉴权实现方案 |
| R7 | F6 `Server-Timing` 仅在 orchestrator-core facade 出口注入——agent-core 内部响应不覆盖 | medium | delivery-gap | no | 设计明确标注"F6 仅覆盖 orchestrator-core HTTP 出口"，agent-core 直连场景列入后续 |
| R8 | F7 `system.error` 的 per-session 5 秒 dedupe by code 可能吞掉合法的高频错误 | medium | correctness | no | 明确 dedupe 语义：同 trace+code 在 5 秒内不重推，但首次仍推；或改用 trace_uuid+code+message 三元组 |
| R9 | F9 缺少 bash-core / orchestrator-auth 错误路径的完整枚举 | medium | delivery-gap | no | 设计附录补完两个 worker 的错误路径清单 |
| R10 | `NACP_ERROR_BODY_VERBS` 为空——F7 `system.error` 使用 `NacpErrorBodySchema` 还是 `SystemErrorBodySchema`？ | medium | protocol-drift | no | 设计明确 system.error 的 body schema 选择 |
| R11 | 设计 §8.5 evidence-emitters "重复"描述有误 | low | docs-gap | no | 修正为"两份 emitters 逻辑类似但 emit 不同流类型" |
| R12 | F10 ESLint `no-restricted-imports` 的"主份"选择标准未说明 | low | docs-gap | no | 补充选择主份的判定规则 |

### R1. `system.error` 与 `FacadeErrorEnvelope` 缺少映射规则

- **严重级别**：high
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - F2 定义 `respondWithFacadeError()` 产出 HTTP 500/403/401 等 `FacadeErrorEnvelope` 响应
  - F7 定义 `session.stream.event::system.error` 在 WS 通道推送错误
  - 设计文档中 F2 和 F7 完全独立描述，没有任何交叉说明
  - 当 orchestrator-core facade handler catch 到一个错误时：它会同时做 F2（返回 HTTP error response）和 F7（通过 WS 推 system.error）吗？
  - 当前 `facadeError()` 在 `policy/authority.ts:31` 只返回 HTTP Response，没有 WS push 逻辑
  - 前端在同一个请求失败时可能同时收到 HTTP 500 facade envelope 和 WS system.error frame——这两者的 `code` 字段可能不同（facade 用 `FacadeErrorCode` kebab-case，system.error 用 NACP `NacpErrorCode` 或其他枚举的 code）
- **为什么重要**：如果两条错误通道没有映射规则，前端需要双通道解析 + 双 code 体系映射，这与 F2/F7 减少前端复杂度的目标矛盾
- **审查判断**：设计需要在 §7.2 补充一个交叉说明：当同一条错误同时走 F2 和 F7 时，两者的 `code` / `message` / `trace_uuid` 必须一致；或者明确声明"HTTP 路径和 WS 路径的错误推送是独立的，前端应按通道分别处理，不做合并"
- **建议修法**：在 §7.2 F7 之后新增 §7.2.5 `F2 × F7 交叉说明`：`(a) 当 facade handler catch 错误且同时有 attached WS 时，F2 的 FacadeErrorCode 和 F7 的 system.error.code 必须来自同一个 error source（允许不同枚举体系的映射）；(b) trace_uuid 必须相同；(c) 前端去重规则：同一 trace_uuid 的 HTTP error response 和 WS system.error frame 视为同一事件的两个通知面，前端 UI 仅展示一次。`

### R2. orchestrator-core 单写点在其他 3 worker 缺少 service binding

- **严重级别**：high
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - 设计 §3.3 解耦对象 2："bash-core / context-core / filesystem-core / agent-core 通过**现有的** `ORCHESTRATOR_CORE` service binding（已存在于 RH4 后的 `wrangler.jsonc`）调用 `OrchestratorCoreEntrypoint.recordErrorLog(record)` RPC"
  - 实际：agent-core 的 `wrangler.jsonc` 有 `ORCHESTRATOR_CORE` binding（line 49），但 bash-core / context-core / filesystem-core 的 wrangler.jsonc **没有** `ORCHESTRATOR_CORE` binding
  - 这意味着 4 个非 orchestrator-core worker 中，只有 agent-core 现在能 RPC 转发；其余 3 个需要新增 service binding
  - 设计声称"已存在于 RH4 后的 wrangler.jsonc"不是事实
- **为什么重要**：如果 action-plan 基于这个错误的前提编写，会低估 F4 的工程量（需要修改 3 个 wrangler.jsonc + 增加 3 个 service binding 配置 + 可能的 preview deploy 验证）
- **审查判断**：这不是设计方向的错误（单写点方向正确），而是事实核查错误。需要修正 §3.3 解耦对象 2 的措辞，并在 action-plan 中显式列出新增 binding 的工作项
- **建议修法**：修正 §3.3 解耦对象 2 为"bash-core / context-core / filesystem-core 需要**新增** `ORCHESTRATOR_CORE` service binding；agent-core 已有 binding 可复用"。在 F4 功能描述中补充"wrangler.jsonc 新增 3 个 service binding"。

### R3. `nano_error_log` 写入的 orchestrator-core 单点不可用=丢失全部错误日志

- **严重级别**：high
- **类型**：platform-fitness
- **是否 blocker**：no
- **事实依据**：
  - 设计 §6.1 取舍 3 的代价声明："bash-core / context-core / filesystem-core / agent-core 写一条错误日志多一次 RPC 跳；**有可能在 orchestrator-core 不可用时丢日志（但那时整个系统已不可用，错误日志是次要）**"
  - 这个判断有逻辑漏洞：orchestrator-core 不可用的**最常见原因**恰恰是它自身报错（D1 连接失败 / KV 绑定异常 / 限流）——而这些错误恰恰是最需要被记录的。说"整个系统已不可用"是错的——orchestrator-core 的某个 Durable Object 实例不可用不代表所有实例不可用
  - 更具体的风险场景：（a）orchestrator-core 收到大量并发错误日志写入请求时自身限流或 D1 写入延迟上升 → 自身也开始报错 → 这些错误日志本应写入 D1 但因为自己是写入者所以可能被 dedupe 丢掉；（b）orchestrator-core 做了 per-team 写入速率限制（§7.2 F4 ≤10/s），某个 team 超限后完全丢失错误日志
- **为什么重要**：单写点设计的最脆弱时刻恰好是系统最需要错误日志的时刻——这种"系统压力大时静默丢日志"的行为降低了 `nano_error_log` 作为 debug 工具的可靠性
- **审查判断**：设计正确识别了这个风险但低估了它的严重性。我建议：(a) 在 §6.2 风险表中将此风险的影响从"D1 写配额耗尽 / 雪崩"升级为"D1 写配额耗尽 / orchestrator-core 自身错误丢失 / 雪崩"；(b) 补充 fallback："当 orchestrator-core RPC 调用失败时，调用方 worker 退化为 console.warn + 内存环形缓冲（F1 已有），但**额外标记一个 `rpc_log_failed=true` 字段**，以便后续检查是否有日志丢失"
- **建议修法**：在 §6.2 风险表第一行影响列补充"orchestrator-core 自身错误可能丢失"；在 F4 补充 fallback 策略：`recordErrorLog` RPC 失败时，调用方 logger 在 console 输出增加 `rpc_log_failed:true` 标记，不 retry。

### R4. `NacpObservabilityEnvelope` 的空 `metrics` / `traces` 字段是认知负担

- **严重级别**：medium
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - `NacpObservabilityEnvelopeSchema` 的 `metrics` 和 `traces` 默认值是 `{}`（空 record）
  - F8 `emitObservabilityAlert()` first-wave 仅写 `alerts` 数组
  - 序列化后的 JSON 会包含 `"metrics": {}` 和 `"traces": {}`——这两个空字段对消费者来说是噪音
  - 设计 §3.2 扩展点表已声明"first-wave 不做 metric emit"，但没有说明序列化行为
- **为什么重要**：如果有代码监听 `NacpObservabilityEnvelope`（虽然当前无人监听），它看到 `metrics: {}` 可能误认为"metrics 系统正常但没有数据"，而实际情况是"metrics 系统不存在"
- **审查判断**：低风险但容易修正。建议 F8 的一句话收口目标补充："envelope 序列化时，如果 `metrics` 为空 record 且 `traces` 为空 record，F8 的 emitter 可以选择省略这两个字段（zod `.default({})` 允许 undefined → `{}` 的 fallback）"
- **建议修法**：在 F8 一句话收口目标补充序列化行为说明：`"first-wave envelope 仅序列化 alerts 数组；metrics/traces 为空 record 时不写入 JSON（依赖 zod default fallback）"`

### R5. F3 "80 code 全量汇总" 无法覆盖 bash-core 临时字符串 code

- **严重级别**：medium
- **类型**：scope-drift
- **是否 blocker**：no
- **事实依据**：
  - 设计 §5.1 S3："80 个 code 全量汇总，按 7 个枚举分组"
  - bash-core `executor.ts` 和 `bridge.ts` 使用的错误标识是临时字符串：`"policy-denied"`、`"empty-command"`、`"session-not-found"` 等——这些不在 FacadeErrorCode / NACP_* / AuthErrorCode / KernelErrorCode / SessionErrorCode / LLMErrorCategory 任何一个枚举中
  - 这意味着 F3 的"80 code"数是完整枚举数，但 bash-core 的临时字符串不在其中
- **为什么重要**：如果 F3 只汇总有 enum 支撑的 80 个 code，bash-core 的错误仍然没有在文档中被标准化。前端遇到 bash-core 的字符串 code 时无法在error-codes.md 中查阅
- **审查判断**：RHX2 的范围合理地划分了边界——F3 汇总现有枚举，F9 让 bash-core 接 logger。但 F9 的"接 logger"是否包含"把临时字符串归化为 enum code"需要明确
- **建议修法**：在 F3 补充说明："F3 汇总覆盖全部有枚举/常量支撑的 code（80 个）+ bash-core 临时字符串 code（约 5-8 个，在 F9 接 logger 时列入 `docs/api/error-codes.md` 第 8 段'ad-hoc codes'）。F9 的 action-plan 需要显式包含 bash-core 临时字符串 code 的归化工作。"

### R6. F5 `/debug/logs` 与 RH3 device gate 鉴权重用——design 未说明鉴权细节

- **严重级别**：medium
- **类型**：security
- **是否 blocker**：no
- **事实依据**：
  - 设计 §5.1 S5："仅认证用户在自己 team 内可查"
  - §7.2 F5："auth: 已登录 + team 边界（同 RH3 device gate）"
  - §6.2 风险表："`/debug/logs` 被滥用看他人 team 数据 → 复用 RH3 已落 device gate + team_uuid 必须等于请求者 team"
  - RH3 device gate 的设计是**设备级鉴权**（IngressAuthSnapshot.user_uuid），不是 team 级鉴权
  - `/debug/logs` 需要的是**team 级鉴权**（team_uuid = caller team_uuid），这和 device gate 是不同层次的鉴权
  - 如果"复用 device gate"意味着 `/debug/logs` 需要有效的设备 token，那么 owner 通过 wrangler tail 无法访问 `/debug/logs`（因为 owner 没有 device token）——但设计 §5.3 又说"owner 跨租户调试通过 wrangler tail / D1 直查"
- **为什么重要**：device gate 和 team gate 是不同鉴权层次。`/debug/logs` 应该做 team gate（请求者 team_uuid = 查询条件 team_uuid），不应该做 device gate（那样排除了所有非设备路径）
- **审查判断**：设计意图是 team-level 鉴权，但措辞写了"同 RH3 device gate"，这会造成实现时误用 device gate 逻辑
- **建议修法**：§7.2 F5 鉴权说明改为"auth: 已认证用户 + team_uuid 过滤（请求者 team_uuid = 查询条件 team_uuid），**不使用** RH3 device gate（那是设备级鉴权，不是 team 级）"

### R7. F6 `Server-Timing` 仅覆盖 orchestrator-core HTTP 出口

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - 设计 §7.2 F6："facade 路径在响应里返回 `total;dur=N` + `auth;dur=M` + `agent;dur=X` 三段"
  - §3.2 扩展点："加 `bash;dur=Y`、子调用 trace"
  - 当前 6 worker 中只有 orchestrator-core 是 HTTP facade（agent-core 虽有 HTTP 端口但是 Durable Object internal）
  - 这意味着 F6 只能覆盖 orchestrator-core 的 facade 出口——当 agent-core 有直连请求到达时（如 /sessions/{uuid}/context），这些请求的响应不会包含 Server-Timing
- **为什么重要**：agent-core 的 context 路由在 RH2 已经暴露了 HTTP 端点，但设计没有规划它的 Server-Timing 覆盖
- **审查判断**：first-wave 只做 orchestrator-core 是正确的范围划定，但需要显式声明 agent-core 直连场景不在 first-wave F6 覆盖范围内
- **建议修法**：§7.2 F6 补充："first-wave 仅覆盖 orchestrator-core HTTP facade 出口。agent-core 直连 /sessions/* 路径的 Server-Timing 列入 O2 OTel span 扩展点。"

### R8. F7 `system.error` per-session 5 秒 dedupe 可能吞掉合法高频错误

- **严重级别**：medium
- **类型**：correctness
- **是否 blocker**：no
- **事实依据**：
  - 设计 §7.2 F7："per-session dedupe by code，5 秒"
  - 设计 §6.2 风险表第 5 行："per-session 5 秒 dedupe by code"
  - 如果一个 session 在 5 秒内连续遇到两个不同来源的同一 code 的 `system.error`（例如 kernel 先在 token processing 报 `storage-write-failed`，然后 D1 写也报 `storage-write-failed`），第二个错误会被吞掉
  - 5 秒窗口在不同语义场景下可能太长（高频交互场景 5 秒是很多个用户操作）
- **为什么重要**：dedupe 的目标是防止"同一错误重复推送"，但 `code` 不够唯一——需要 `trace_uuid + code` 或 `trace_uuid + code + source_worker` 才能正确去重
- **审查判断**：F4 的 dedupe 设计（trace_uuid + code 5 秒）比 F7 的（code only 5 秒）更精确。F7 应该与 F4 取齐
- **建议修法**：F7 dedupe 规则改为 "per-session by `(trace_uuid, code, source_worker)` 5 秒去重"，与 F4 的 `(trace_uuid, code)` 取齐并增加 `source_worker` 维度

### R9. F9 缺少 bash-core / orchestrator-auth 错误路径的完整枚举

- **严重级别**：medium
- **类型**：delivery-gap
- **是否 blocker**：no
- **事实依据**：
  - F9 一句话收口目标："bash-core / orchestrator-auth `console.*` 在 prod 路径出现次数 ≥ 5；prod 错误可在 `nano_error_log` 查到"
  - 但设计没有给出这两个 worker 的错误路径清单
  - bash-core 错误路径（基于代码核查）：`executor.ts` 中的 `"policy-denied"` / `"empty-command"` / `"session-not-found"` / `"execution-timeout"` / `"execution-failed"` 等字符串 code；`bridge.ts` 中的 `"bridge-not-found"` 等
  - orchestrator-auth 错误路径：`wechat-code exchange` 错误 / `JWT verification` 错误 / `device registration` 错误 / `token refresh` 错误
  - 如果没有完整枚举，action-plan 编写时无法证明 ≥5 行 logger.error 覆盖了所有关键路径
- **为什么重要**：RHX2 是跨切簇，action-plan 需要精确的工作量评估。F1-F8 都有详细的调用者/输出/边界说明，唯独 F9 只有一句话目标
- **建议修法**：在设计附录补充 bash-core 和 orchestrator-auth 的错误路径清单（每个 worker ≥5 个具体路径），包含当前错误处理方式（throw / console / no-op）和 F9 需要改为的 logger.error 调用。

### R10. `NACP_ERROR_BODY_VERBS` 为空——F7 `system.error` 使用 `NacpErrorBodySchema` 还是 `SystemErrorBodySchema`？

- **严重级别**：medium
- **类型**：protocol-drift
- **是否 blocker**：no
- **事实依据**：
  - `packages/nacp-core/src/error-body.ts:57`：`NACP_ERROR_BODY_VERBS` 为空 Set
  - `packages/nacp-core/src/messages/system.ts:16`：`registerMessageType("system.error", SystemErrorBodySchema, ...)`——`system.error` 使用的是 `SystemErrorBodySchema`，不是 `NacpErrorBodySchema`
  - `error-body.ts` 注释 line 26-27 明确说："`system.error` continues to use the top-level `NacpErrorSchema` in `error-registry.ts`. `NacpErrorBodySchema` is for per-verb response bodies, not a replacement of the system-level error taxonomy."
  - 设计 §7.2 F7 描述为 `SystemErrorEventBodySchema: {kind:"system.error", code, severity, message, source_worker?, trace_uuid?}`
  - 但 `SystemErrorBodySchema`（实际在 `system.ts` 中定义的）的字段是 `{code, message, severity?}`，与设计描述的 `SystemErrorEventBodySchema` 不同
  - 这意味着 F7 描述的 schema 需要与现有 `SystemErrorBodySchema` 对齐，或者需要新建一个 `SystemErrorEventBodySchema` 作为 stream-event body
- **为什么重要**：如果 F7 使用现有的 `SystemErrorBodySchema`，字段较少（无 `source_worker`、无 `trace_uuid`）；如果新建 `SystemErrorEventBodySchema`，需要确保它在 stream-event union 中的注册与 NACP 协议兼容
- **建议修法**：设计 F7 明确声明"在 `packages/nacp-session/src/stream-event.ts` 新增 `SystemErrorEventBodySchema`，字段包含 `{kind, code, severity, message, source_worker?, trace_uuid?}`，**与** `packages/nacp-core/src/messages/system.ts` 的 `SystemErrorBodySchema` 是两个独立 schema"——避免歧义。

### R11. 设计 §8.5 evidence-emitters "重复"描述有误

- **严重级别**：low
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - 设计 §8.5 列出 "evidence-emitters 重复"
  - 代码核查：`context-core/src/evidence-emitters-context.ts` emit 的是 assembly / compact / snapshot 流；`workspace-context-artifacts/src/evidence-emitters.ts` emit 的是 artifact 流——两者逻辑类似但 emit 不同流类型
  - 与 StorageError / metric-names 的"byte-for-byte 完全相同复制"不同，evidence-emitters 不是纯重复
- **建议修法**：修正 §8.5 和 §5.1 S10 中 evidence-emitters 的描述为"两份 emitters 逻辑类似但 emit 不同流类型（assembly/compact/snapshot vs artifact），不是 byte-for-byte 复制"

### R12. F10 ESLint `no-restricted-imports` 的"主份"选择标准未说明

- **严重级别**：low
- **类型**：docs-gap
- **是否 blocker**：no
- **事实依据**：
  - F10 说指定"主份"禁止"次份"，但没有给出选择标准
  - `StorageError`：`filesystem-core/src/storage/errors.ts` vs `storage-topology/src/errors.ts`——哪个是主份？
  - `metric-names`：`agent-core/src/eval/metric-names.ts` vs `eval-observability/src/metric-names.ts`——哪个是主份？
  - 选择标准不明确会导致实现时随机选择
- **建议修法**：补充选择规则："主份选择规则：属于共享 `packages/` 的优先于属于 `workers/` 的（因为 `packages/` 可被多个 worker 共享引用，而 `workers/` 下的不应被其他 worker 引用）。据此：`StorageError` 主份为 `storage-topology/src/errors.ts`（它是共享包）；`metric-names` 主份为 `eval-observability/src/metric-names.ts`（它是共享包）。evidence-emitters 不适用此规则（两份不是纯重复，见 R11）。"

---

## 3. In-Scope 逐项对齐审核

> 对照设计文档 §5.1 S1-S10 和 §5.2 O1-O11 逐项审核

### S1–S10 对齐

| 编号 | 设计项 | 审查结论 | 说明 |
|------|--------|----------|------|
| S1 | 共享 worker-logger npm 包 | done（设计层面） | 4 级 level + ALS 注入 + 环形缓冲 + onError 钩子 设计完整 |
| S2 | 6 worker HTTP 错误响应统一到 FacadeErrorEnvelope | done（设计层面） | F2 respondWithFacadeError helper 设计清楚；注意 R1 F2×F7 交叉说明缺失 |
| S3 | docs/api/error-codes.md 单一查询入口 | partial（设计层面） | 80 枚举 code 覆盖清晰；但 bash-core 临时字符串 code 未列入——见 R5 |
| S4 | D1 nano_error_log 表 + 持久化 | done（设计层面） | 表结构完整（7 字段 + 3 索引）；dedupe / rate-limit / TTL 机制合理；注意 R3 单点不可用风险 |
| S5 | /debug/logs 调试 endpoint | partial（设计层面） | 查询参数完整；但鉴权描述误用了"RH3 device gate"——见 R6 |
| S6 | Server-Timing header 注入 | partial（设计层面） | 仅覆盖 orchestrator-core facade 出口；agent-core 直连场景未覆盖——见 R7 |
| S7 | session.stream.event::system.error kind | partial（设计层面） | schema 描述与现有 SystemErrorBodySchema 有距离——见 R10；dedupe 规则不够精确——见 R8 |
| S8 | emitObservabilityAlert() critical alert 出口 | done（设计层面） | 3 类触发条件明确；注意 R4 空 metrics/traces 认知负担 |
| S9 | bash-core / orchestrator-auth 接 logger | partial（设计层面） | 缺少错误路径枚举——见 R9 |
| S10 | 重复定义防漂移（ESLint） | partial（设计层面） | 主份选择标准未说明——见 R12；evidence-emitters 不是纯重复——见 R11 |

### O1–O11 对齐

| 编号 | Out-of-Scope 项 | 审查结论 | 说明 |
|------|------------------|----------|------|
| O1 | OTel SDK 完整接入 | 遵守 | 设计明确排除，留 OTLP-shaped seam |
| O2 | OTel span hierarchy | 遵守 | 设计明确排除，留 ALS seam |
| O3 | OTel histogram metrics 全量启用 | 遵守 | 设计明确排除 |
| O4 | Hook handler 注册表全量接电 | 遵守 | 设计明确标注为 RH5/RH6 scope |
| O5 | Evidence 业务持久化 | 遵守 | 设计明确排除 |
| O6 | PII 自动脱敏框架 | 遵守 | 设计明确排除，走纪律 |
| O7 | 第三方 APM 直连 | 遵守 | 设计明确排除 |
| O8 | session-replay | 遵守 | 设计明确排除 |
| O9 | 用户级 telemetry opt-out | 遵守 | N/A first-wave 没有 user-level metrics |
| O10 | 重复定义代码合并 | 遵守 | 但 R11 指出 evidence-emitters 不是纯重复，ESLint 路径需要修正 |
| O11 | Cloudflare Logpush 配置 | 遵守 | 设计明确排除 |

### 对齐结论

- **done**: 5
- **partial**: 5
- **missing**: 0
- **stale**: 0
- **out-of-scope-by-design**: 11（全部遵守）

设计的 S1-S10 在方向和范围上是精确的，但实现细节有 5 处需要补充——这不是"范围缺失"，而是"设计精度不够"。对于横切簇设计文档，5/10 的 partial 比例偏高，但 partial 的原因都是"缺少交叉说明 / 缺少枚举 / 事实不精确"而非"方向错误"。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Horizon 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 完整 OTel 接入 | 遵守 | 设计 §5.2 O1 明确排除 |
| O2 | Span 层级 | 遵守 | 留 ALS seam |
| O3 | Metrics | 遵守 | 留 names + seam |
| O4 | Hook 全量接电 | 遵守 | RH5/RH6 scope |
| O5 | Evidence 持久化 | 遵守 | in-memory eval sink |
| O6 | PII 自动脱敏 | 遵守 | 纪律路线 |
| O7 | 第三方 APM | 遵守 | OTLP seam |
| O8 | Session replay | 遵守 | |
| O9 | User telemetry opt-out | 遵守 | |
| O10 | 代码合并重复 | 遵守 | 仅 docs + ESLint |
| O11 | Cloudflare Logpush | 遵守 | |

**Out-of-Scope 全部遵守**。无越界发现。但 R5 和 R11 指出 O10 的"evidence-emitters 重复"需要修正描述。

---

## 5. 交叉分析与价值判断

### 5.1 协议层留位 vs. 运行时接电——设计把"schema-only"推进到"runtime-wired"的精确度

RHX2 设计最大的价值在于它把 NACP 协议留位从 "schema-only" 推进到 "runtime-wired"。我核查了以下 5 个关键留位：

| 协议留位 | 当前状态 | RHX2 目标状态 | 审查判断 |
|----------|----------|--------------|----------|
| `system.error` (NACP message type) | schema 已定义、matrix 已注册、0 worker emit | F7 能让 agent-core / orchestrator-core emit | ✅ 设计准确；注意 R10 schema 描述偏差 |
| `NacpObservabilityEnvelope` | schema 已定义、0 worker import/emit | F8 让 `alerts` 段有真实 emit 路径 | ✅ 设计准确；注意 R4 空 fields 问题 |
| `NacpErrorBodySchema` | schema 已定义、`NACP_ERROR_BODY_VERBS` 空 Set | first-wave 不动（F2 使用 FacadeErrorCode 而非 NacpErrorBody） | ⚠️ 设计正确排除但未显式说明 F2 和 NacpErrorBodySchema 的关系 |
| `x-trace-uuid` 全链路透传 | orchestrator-core / agent-core ~388 次引用 | F1 ALS 自动注入 | ✅ 设计利用了现有投入 |
| `FacadeErrorCode` (32 codes) | 2 个生产调用点（均在 orchestrator-core） | F2 让 6 worker HTTP 入口都用 | ✅ 设计方向正确 |

**关键观察**：F2 使用 `FacadeErrorCode`（HTTP error response）和 F7 使用 `system.error`（WS push）是两套不同的错误体系，两者之间没有显式映射规则——这是 R1 的来源。设计需要补充一个"F2 × F7 交叉"小节，说明当同一条错误同时走 HTTP 和 WS 时的行为。

### 5.2 6 大核心取舍的审查

| 取舍 | 设计方判断 | 审查方判断 | 审查评价 |
|------|------------|------------|----------|
| 取舍 1：D1 + 共享包 vs OTel SDK | D1 解决 80% debug 痛点，OTel SDK 超边界 | 同意 | 合理。D1 已有 binding 是关键论据 |
| 取舍 2：保留 7 枚举 vs 合并巨枚举 | 合并代价高，docs 汇总够 | 同意但有补充 | bash-core 临时字符串 code 不在任何枚举中（R5） |
| 取舍 3：单写点 vs 6 worker 直接写 | 单写点强制走租户边界 | 方向同意但事实有误 | R2：3 个 worker 缺少 service binding |
| 取舍 4：不删重复定义 vs 顺手清理 | 清理代价高，ESLint 阻漂移够 | 基本同意 | evidence-emitters 不是纯重复（R11） |
| 取舍 5：新增 system.error kind vs 复用 system.notify | 新增 kind 类型直觉更强 | 同意 | 协议清洁度论证充分 |
| 取舍 6：migration 012 vs 抢 011 | 让 RH5 优先 | 同意 | 正确遵守 charter §8.4 |

### 5.3 设计 §6.2 风险表补充

| 风险 | 设计已识别 | 审查补充 |
|------|------------|----------|
| nano_error_log 写入风暴 | ✅ 已识别 | 补充："当 orchestrator-core 自身错误导致 D1 写入失败时，这些错误日志也会丢失。F4 的 fallback（console.warn）在这种情况下是唯一的记录者。" |
| 跨 worker recordErrorLog RPC 调用 cycle | ✅ 已识别 | 无补充 |
| Server-Timing 泄漏内部时序 | ✅ 已识别 | 无补充 |
| /debug/logs 跨租户 | ✅ 已识别 | 补充："设计说'复用 RH3 device gate'但实际需要的是 team gate，不是 device gate。device gate 是设备级鉴权，排除了非设备路径。"（R6） |
| system.error 推送量淹前端 | ✅ 已识别 | 补充："dedupe 应该用 (trace_uuid, code, source_worker) 三元组，不是 code 单独去重。"（R8） |
| 重复定义漂移 | ✅ 已识别 | 补充："evidence-emitters 不是纯重复，ESLint rule 需要修正描述。"（R11） |
| migration 编号冲突 | ✅ 已识别 | 无补充 |
| TTL 14 天误导 | ✅ 已识别 | 无补充 |
| OTLP seam 被滥用 | ✅ 已识别 | 无补充 |
| **新增 1**：F2 × F7 交叉——HTTP + WS 双通道重复错误 | ❌ 未识别 | 前端同一错误收到两个通知面需要去重规则（R1） |
| **新增 2**：orchestrator-core 自身错误时日志丢失 | ❌ 未识别 | 自身错误是最需要日志的场景（R3） |

### 5.4 设计价值判断

设计 §10.2 Value Verdict 给出综合价值 4.6/5。我的独立评估：

| 评估维度 | 设计评分 | GLM 评分 | 理由 |
|----------|----------|----------|------|
| 对核心定位的贴合度 | 5 | 5 | NACP 协议留位接电是 real-to-hero 阶段的必选项 |
| 第一版性价比 | 5 | 4 | F2 6 处 codemod / F4 3 处新增 binding 的工作量被低估 |
| 对未来演进的杠杆 | 4 | 4 | F8 让 envelope 至少有一条真实路径，为 hero-to-platform 铺路 |
| 开发者日用友好度 | 5 | 5 | trace_uuid + /debug/logs + Server-Timing 确实解决 80% debug 痛点 |
| 风险可控程度 | 4 | 3 | 单写点不可用风险被低估；F2×F7 交叉未识别 |
| **综合价值** | 4.6 | **4.2** | 高价值设计，但 3 处事实错误和 2 处遗漏风险降低信心 |

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：RHX2 Observability & Auditability 设计在方向和范围上是一个高质量提案，F1-F10 的功能清单精确定位了 nano-agent 当前 observability 的最大痛点，6 大核心取舍论证充分，Out-of-Scope 边界清晰。但设计在 3 个维度需要修正：(1) F2×F7 交叉说明缺失导致前端双通道错误去重规则缺失；(2) F4 单写点的 service binding 事实有误和工作量低估；(3) 5 项 partial 的设计精度需要补充（错误路径枚举 / dedupe 规则 / 鉴权层次 / schema 对齐 / 主份选择标准）。
- **是否允许关闭本轮 review**：no——等待 Q-Obs1~Q-Obs5 答复和 R1-R12 修正
- **关闭前必须完成的 blocker**：
  1. Q-Obs1~Q-Obs5 全部 owner 答复并落 RHX-qna.md
  2. R2：修正 §3.3 解耦对象 2 的 service binding 事实错误
  3. R3：补充 F4 orchestrator-core 自身错误丢失的 fallback 策略
  4. R6：修正 F5 鉴权描述（device gate → team gate）
- **可以后续跟进的 non-blocking follow-up**：
  1. R1：补充 F2×F7 交叉说明
  2. R4：补充 F8 envelope 序列化行为说明
  3. R5：明确 F3 对 bash-core 临时字符串 code 的覆盖范围
  4. R7：标注 F6 仅覆盖 orchestrator-core HTTP 出口
  5. R8：dedupe 规则增强为 (trace_uuid, code, source_worker) 三元组
  6. R9：补充 bash-core / orchestrator-auth 错误路径完整枚举
  7. R10：明确 F7 schema 选择（SystemErrorEventBodySchema vs SystemErrorBodySchema）
  8. R11：修正 evidence-emitters "重复"描述
  9. R12：补充 F10 主份选择规则
- **建议的二次审查方式**：same reviewer rereview（修正后 rereview §3.3 / §6.2 / §7.2 即可）
- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §7 append 回应，不要改写 §0–§5。

---

## 附录 — 代码事实补充

### A.1 6 worker console 使用分布

| Worker | console.log | console.warn | console.error | 总计 |
|--------|-------------|--------------|---------------|------|
| orchestrator-core | 1 | 多处 | 0 | ~20 |
| agent-core | 0 | 多处 | 0 | ~10 |
| context-core | 0 | 少量 | 0 | ~1 |
| filesystem-core | 0 | 少量 | 0 | ~1 |
| bash-core | 0 | 0 | 0 | 0 |
| orchestrator-auth | 0 | 0 | 0 | 0 |

精确分布：全域 32 次 console 调用（1 console.log / 31 console.warn / 0 console.error）。bash-core 和 orchestrator-auth 完全零 console。

### A.2 错误码枚举分布

| 枚举来源 | 枚举名 | code 数量 | kebab / camel / 其他 |
|----------|--------|-----------|---------------------|
| orchestrator-auth-contract | FacadeErrorCode | 32 | kebab-case |
| nacp-core error-registry | NACP_* | 14 已注册 | UPPER_SNAKE |
| orchestrator-auth | AuthServiceError | ~13 | kebab-case |
| nacp-session | SESSION_ERROR_CODES | 8 | UPPER_SNAKE |
| agent-core kernel | KERNEL_ERROR_CODES | 6 | UPPER_SNAKE |
| agent-core llm | LLMErrorCategory | 8 | kebab-case |
| bash-core executor/bridge | ad-hoc strings | ~5-8 | kebab-case |
| **合计** | — | **~87-90** | — |

设计声称的"80 个 error code 枚举"实际约 87-90 个（含 bash-core 临时字符串）。F3 需要覆盖的范围比 §1.1 声称的略大。

### A.3 `system.error` NACP 协议注册状态

- `registerMessageType("system.error", SystemErrorBodySchema, ...)` — ✅ 已注册
- `type-direction-matrix.ts` — ✅ `"system.error": new Set(["error"])` 已注册
- `state-machine.ts` — ✅ allowed in all phases, producer includes "orchestrator-core" / "agent-core", consumer includes "client"
- **零生产 emit** — grep 确认无 worker 构建或 emit `system.error` frame

### A.4 `NacpObservabilityEnvelope` 使用状态

- Schema 定义完整（envelope.ts:71-82）
- index.ts re-exported
- **零 worker import/emit** — grep 确认无任何 .ts 文件导入或使用 `NacpObservabilityEnvelope`
- 测试文件 `observability.test.ts` 存在并覆盖 schema 校验