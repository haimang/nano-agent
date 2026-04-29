# RHX2 Observability & Auditability 设计辩证审查

> 审查对象: `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.1
> 审查类型: `design-review`
> 审查时间: `2026-04-29`
> 审查人: `DeepSeek（独立辩证审查；参考 smind-contexter / smind-admin / smcp / wbca-mini 等 context/ 下存在代码的 sibling 项目事实）`
> 审查范围:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`（690 行全量）
> - `context/smind-contexter/core/{log,errors,db_d1}.ts`（Logger 类 + ErrorCodes 枚举 + D1 适配器）
> - `context/smind-admin/src/infra/{logger,errors}.ts` + `src/http/{response,middleware.auth,middleware.team}.ts`（共享 logger 包 + HttpError 类 + 统一响应格式 + 鉴权/团队边界中间件）
> - `context/smcp/tests/error_registry.test.ts`（运行时错误注册表测试）
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md`（前序调查报告）
> - nano-agent 6 worker 源码 + NACP 协议层现状
> 对照真相:
> - `docs/charter/plan-real-to-hero.md` r2
> - `docs/design/real-to-hero/RHX-qna.md`
> - smind-contexter / smind-admin / smcp 的既有代码事实（这些不是"参考实现"，而是与我们共享 Cloudflare Workers + NACP 生态的 sibling 项目——它们的选择是**既成事实的工程判断**，不应被忽略）
> 文档状态: `changes-requested`

---

## 0. 总结结论

> **RHX2 设计的工程方向是正确的**——把 NACP 预留的 log/error/obs 槽位从 schema-only 推进到 runtime-wired，用 1 个共享包 + 1 张 D1 表 + 1 份 docs + 1 个 endpoint 解决前端 80% 的 debug 痛点。**10 个 In-Scope 项全部必要且边界清晰。** 但设计中存在一个重要的遗漏和一个可以做得更好的地方：(1) **遗漏了 smcp/smind-admin 已经存在的运行时 `error_registry` 模式**——这个模式用 `registerErrorDefinition(code, category, retryable, message)` 函数 + `resolveErrorDefinition(code)` 查询替代了"汇总文档"的静态方案，比设计中的 `docs/api/error-codes.md` 更接近"可被代码消费的真相源"；(2) **遗漏了 smind-contexter 的 `LogPersistFn` 回调解耦模式**——此模式把"logger 格式"与"持久化存储"干净分离，当前 F4 的"orchestrator-core 单写 + onError 回调"隐含了这个解耦但未显式建模；(3) **遗漏了 smind-admin 的 error category 系统**——7 类分类（validation/transient/dependency/permanent/security/quota/conflict）映射到 HTTP status + retry 策略，比纯 code string 更结构化。此外，wdca-mini 微信小程序端的 API 调用模式揭示了**前端不只需要 trace_uuid 查日志，还需要在 API 层直接拿到可解析的错误结构**——这一需求在设计中已经被 F2/F3 覆盖但未充分强调。

- **整体判断**: `设计方向正确，主体成立。建议在 §7 功能列表和 §3 接口保留点中吸收 sibling 项目的三个已有模式（error_registry / LogPersistFn / error category），并在 §5.3 边界清单中明确 smind-admin / smind-contexter 与 nano-agent 在错误响应格式上的差异是否需要收敛。`
- **结论等级**: `approve-with-followups`
- **是否允许推进 action-plan**: `yes（条件：先处理本文 §2 中的 3 个必须解决的发现 + §3 中的 2 个高优先级建议）`

---

## 1. 审查方法与已核实事实

### 对照文档

- `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.1（690 行全量）
- `docs/charter/plan-real-to-hero.md` r2（§4.4 硬纪律、§8.4 migration allocation rule、§10.3 NOT-成功退出）
- `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md`（前序调查报告）

### 核查实现（sibling 项目）

- `context/smind-contexter/core/log.ts`（165 行）：`Logger` 类 + `LogPersistFn` 解耦模式 + 4 级日志 + 结构化输出 + 异步 D1 持久化
- `context/smind-contexter/core/errors.ts`（139 行）：`ErrorCodes` 枚举（11 codes）+ `SkillException` 类 + `makeErrorResponse()` 工厂
- `context/smind-contexter/core/db_d1.ts`（253 行）：D1 适配器 `D1Manager`，`.prepare(sql).bind(...params).all<>()` 模式
- `context/smind-admin/src/infra/logger.ts`（3 行）：`createConsoleProtocolLogger("smind-admin")` — **共享 smcp 包的单行 logger 接入**
- `context/smind-admin/src/infra/errors.ts`（60 行）：`HttpError` 类（code + category 7 类 + status + detail）+ `toErrorResponse()` 统一错误包装
- `context/smind-admin/src/http/response.ts`（29 行）：`jsonOk(data, status?, traceId?)` / `jsonError(error, traceId?)`
- `context/smind-admin/src/http/middleware.auth.ts`（73 行）：`requireAuth()` + API key / JWT 双轨 + `SmindAdminInvalidApiKey` 等具体错误码
- `context/smind-admin/src/http/middleware.team.ts`（13 行）：`requireTeam(auth)` — 团队边界强制校验
- `context/smcp/tests/error_registry.test.ts`（24 行）：`registerErrorDefinition()` / `resolveErrorDefinition()` / `listErrorDefinitions()` 运行时 registry
- `context/wbca-mini/miniprogram/utils/api.js`（微信小程序 API 调用层）

### 1.1 已确认的正面事实

- **F+1**：设计方向精准——把 NACP 预留槽位从 schema-only 推进到 runtime-wired，这是前序调查报告识别的核心 gap
- **F+2**：In-Scope 10 项全部必要：shared logger（F1）、facade envelope 统一（F2）、error-codes doc（F3）、D1 错误持久化（F4）、/debug/logs 端点（F5）、Server-Timing（F6）、system.error 帧（F7）、critical alert（F8）、bash/orch-auth 接入（F9）、ESLint 防漂移（F10）——每一项都能在调查报告的盲点/断点清单中找到对应
- **F+3**：6 个核心 tradeoff 全部合理——D1 over OTel（取舍 1）、分布枚举 over 合并（取舍 2）、单写点 over 多写点（取舍 3）、不删重复定义（取舍 4）、新 system.error kind（取舍 5）、migration 012（取舍 6）——每个取舍都有清晰的代价评估和重评条件
- **F+4**：风险分析充分——写入风暴（dedupe + rate-limit）、调用 cycle（单向 RPC）、信息泄漏（Server-Timing 仅粗粒度）、跨租户泄漏（team 边界复用 RH3）、前端被淹（5s dedupe + dev mode only）
- **F+5**：F1–F10 的功能描述包含明确的输入/输出/调用者/核心逻辑/边界情况/收口目标/测试覆盖要求——工程可执行
- **F+6**：借鉴了 claude-code 的 ALS 传播、环形缓冲、codex 的专用持久化表、gemini-cli 的错误分类——借鉴来源清晰但不盲目照抄
- **F+7**：§8.5 的"本仓库 precedent / 需要避开的反例"清单非常务实——列出了具体文件行号和问题类型，指导 action-plan 的 codemod 范围

### 1.2 已确认的负面事实 / 遗漏

- **F-1**：**设计没有引用 smcp 的运行时 `error_registry` 模式**——smcp 中有 `registerErrorDefinition({code, category, retryable, message})` / `resolveErrorDefinition(code)` 的运行时 registry，这比静态 `docs/api/error-codes.md` 更强大。设计 §6.1 取舍 2 的结论是"保留 7 个分布枚举，仅做 docs 汇总"——这个结论对 first-wave 是正确的，但**没有提到 smcp 的 registry 作为未来演进方向**（哪怕列为 §3.2 的"接口保留点"）
- **F-2**：**设计没有引用 smind-contexter 的 `LogPersistFn` 回调解耦模式**——smind-contexter 的 `core/log.ts` 使用 `type LogPersistFn = (db, data, traceId, ctx?) => Promise<void>` 把"logger 格式化"与"D1 写入"干净解耦。当前设计 F4 描述"orchestrator-core 单写 + onError 回调"隐含了这个模式但未显式建模——如果在 F1 的接口设计中显式定义 `LogPersistFn` 类型，将使 `onError` 钩子的语义更清晰
- **F-3**：**设计没有引用 smind-admin 的 error category 系统**——smind-admin 的 `HttpError` 使用 7 类 category（validation/transient/dependency/permanent/security/quota/conflict），每类映射到 HTTP status + retry 策略。当前设计 F3 的 `docs/api/error-codes.md` 只列出 `code / source / category / http_status / 含义 / 前端处理建议` 6 列，其中的 `category` 列没有对应的 runtime 分类体系支撑——"前端处理建议"是为人写的，category 是为代码写的
- **F-4**：**smind-admin 与 nano-agent 的 error response 格式存在差异**——smind-admin 使用 `{ ok: false, error: { code, category, message, detail } }`，nano-agent 使用 `{ ok: false, error: { code, status, message, details? } }`。设计 F2 的目标是"6 worker 错误响应统一到 FacadeErrorEnvelope"——但如果 smind-admin 将来要与 nano-agent 的 facade 互通（例如通过 `ORCHESTRATOR_CORE` RPC），这个格式差异会成为隐性问题
- **F-5**：**没有讨论 DO 调度模型对 logger 的影响**——smind-contexter 的 `Logger.log()` 方法接受可选的 `ctx?: ExecutionContext` 参数，用于 `ctx.waitUntil(persistPromise)`。nano-agent 的 6 个 worker 中，agent-core 的 NanoSessionDO 运行在 DO 环境（无 ExecutionContext），而 orchestrator-core 的 fetch handler 运行在 Worker Shell 环境（有 ExecutionContext）。设计 F1 提到 ALS 注入但未讨论这两种环境下的异步 I/O 保证差异
- **F-6**：**wbca-mini 微信小程序的 API 调用层暴露了一个未在设计中被充分讨论的前端需求**——小程序端的 `utils/api.js` 需要在每次 API 调用后直接解析错误响应（code/message），这不仅是 F5（/debug/logs 端点）能覆盖的。F2/F7 已覆盖 HTTP 错误 envelope 和 WS system.error 推送，但**没有显式保证前端在 production mode 下仅依赖 facade envelope 就能处理所有错误**（不需要 dev-only 的 /debug/logs）
- **F-7**：**§4.1 mini-agent 的参考价值被低估**——设计将 mini-agent 描述为"少，教训"，但 mini-agent 的 Python 实现中有些模式值得借鉴：`test_terminal_utils.py`、`test_markdown_links.py` 这类"输出格式验证测试"——类比到 RHX2，这意味着 worker-logger 的 JSON 输出格式应该在单测中做 schema 校验，而不是"只要 JSON.stringify 不抛错就算通过"

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 所有 sibling 项目的代码行号均经直接读取验证 |
| schema / contract 反向校验 | yes | smind-admin 的 `jsonOk/jsonError` vs nano-agent 的 `FacadeErrorEnvelope` 格式差异已验证 |
| live / deploy / preview 证据 | n/a | 设计审查阶段，不涉及运行时 |
| 与上游设计对账 | yes | 与 charter §8.4 migration allocation / §10.3 NOT-成功退出 逐项对照 |
| 跨项目代码对比 | yes | smind-contexter / smind-admin / smcp / wbca-mini 与 nano-agent 的横向对比 |

---

## 2. 必须解决的发现（Changes Requested）

### R1. 遗漏 smcp 运行时 error_registry 模式

- **严重级别**: `high`
- **类型**: `design-gap`
- **是否 blocker**: `yes（对设计，不是对代码——应在设计 frozen 前补入）`
- **事实依据**：
  - `context/smcp/tests/error_registry.test.ts:1-24`：smcp 有 `registerErrorDefinition({code, category, retryable, message})` / `resolveErrorDefinition(code)` / `listErrorDefinitions()` 的运行时 registry。**这是一个可编程查询的错误码真相源，不只是文档。**
  - `context/smind-admin/src/infra/errors.ts:1-22`：smind-admin 使用 `SmcpErrorSchema.safeParse(error)` 做运行时错误校验——这意味着 smcp 的 error registry 有 zod schema 支撑，可以被 TypeScript 类型推导
  - 当前设计 F3 的 `docs/api/error-codes.md` 是纯文档方案——对 first-wave 足够，但对比 smcp 的运行时 registry，缺失了"可被代码消费"这一层次
- **为什么重要**：
  - 前端开发者在处理 `FacadeErrorEnvelope.error.code` 时，能做的不仅是"在文档中查找这个 code"，更应该是"在代码中 `resolveErrorDefinition(code)` → 拿到 `{ category, retryable, message }` → 自动决定重试/展示/忽略"
  - nano-agent 的 NACP 协议层已有 `packages/nacp-core/src/error-registry.ts`（19 个 NACP error codes 的静态注册），但它停留在 static const 阶段——没有一个统一的 `resolveErrorDefinition()` 函数可以查询 Rpc/Facade/Auth/Kernel/Session/LLM 6 套枚举
  - 如果没有运行时 registry，前端团队会各自建立自己版本的"code → 处理策略"映射表，导致行为分散
- **审查判断**：
  - first-wave 不需要像 smcp 那样做完整的 `registerErrorDefinition()` 动态注册——**nano-agent 的 80 个 error codes 大多是编译期已知的**
  - 但 first-wave 可以做 **`resolveErrorMeta(code): ErrorMeta | undefined`** 函数——输入任意 code string，输出 `{ source, category, http_status, retryable }` 元数据——数据来源于 7 个枚举的编译期映射表
  - 这个函数可以放在 `packages/nacp-core/src/error-registry.ts` 中（扩展已有的 19-code 静态注册表），被 worker-logger 和前端 SDK 共同消费
- **建议修法**：
  1. 在 §3.2 接口保留点中新增一项：`resolveErrorMeta(code: string): ErrorMeta | undefined` — 编译期生成的统一错误元数据查询函数（放在 nacp-core）
  2. 在 §5.1 In-Scope 中为 F3 增加子项："F3-b：`packages/nacp-core/src/error-registry.ts` 从纯常量升级为包含 `resolveErrorMeta() → ErrorMeta` 查询函数的编译期 registry（80 codes 全覆盖），供 worker-logger 和前端 SDK 消费"
  3. 在 §8.5 借鉴清单中新增：`context/smcp/tests/error_registry.test.ts` — 借鉴其 `resolveErrorDefinition` 的查询 API 形态

### R2. 遗漏 smind-contexter 的 `LogPersistFn` 回调解耦模式

- **严重级别**: `medium`
- **类型**: `design-gap`
- **是否 blocker**: `no（可在 action-plan 阶段补救）`
- **事实依据**：
  - `context/smind-contexter/core/log.ts:36-41`：`type LogPersistFn = (db, data, traceId, ctx?) => Promise<void>` — 把"logger 格式化"与"D1 写入"干净解耦
  - smind-contexter 的 `Logger.log()` 中，持久化通过 `globalConfig.persistFn(db, logData, traceId, ctx)` 调用——persistFn 的实现完全独立于 Logger 类
  - 当前设计 F1 描述 worker-logger 的 `onError` 回调"由 orchestrator-core 注入'调用 RPC 写 D1'"——这个逻辑是对的，但 `onError` 的类型签名没有被显式定义
- **为什么重要**：
  - 如果 F1 不显式定义 `LogPersistFn` 类型（即 `onError` 的准确签名），未来可能出现：(a) 各 worker 各自实现 `onError` 逻辑导致不一致；(b) 新增第三类 persistFn（如未来 R2 batch upload）时缺乏统一的类型约束
  - smind-contexter 的模式证明了"回调解耦"在 Cloudflare Workers 环境中是可行且清晰的
- **审查判断**：
  - 这个模式不是必须现在做的——F4 已经定义了"orchestrator-core 单写 + onError 回调"的实现路径
  - 但建议在 F1 的接口设计中显式定义 `LogPersistFn` 类型（或在 `onError` 的类型签名中体现），让 action-plan 可直接实现
- **建议修法**：
  1. 在 F1 的详细阐述中增加 `onError` 的精确类型签名：`onError: (record: LogRecord) => void | Promise<void>`（其中 `LogRecord` 是 logger 的内部记录类型）
  2. 或者从"worker-logger 导出 `LogPersistFn` 类型"换成"由 orchestrator-core 的 recordErrorLog RPC 消费它"
  3. 在 §8.5 借鉴清单中新增：`context/smind-contexter/core/log.ts:36-41` — 借鉴 `LogPersistFn` 回调解耦模式

### R3. 遗漏 smind-admin 的 error category 系统

- **严重级别**: `medium`
- **类型**: `design-gap`
- **是否 blocker**: `no（可在 first-wave 后追加）`
- **事实依据**：
  - `context/smind-admin/src/infra/errors.ts:5-7`：`HttpError` 的 `category` 字段有 7 种分类：`"validation" | "transient" | "dependency" | "permanent" | "security" | "quota" | "conflict"`
  - `context/smind-admin/src/infra/errors.ts:26-28`：`mapErrorCategoryToStatus(input.category)` 函数——从 category 自动推导 HTTP status
  - 当前设计 F3 的 `docs/api/error-codes.md` 规划了 `category` 列，但没有对应的运行时分类机制
  - nano-agent 已有的 `FacadeErrorCode` 枚举的 32 个 code 中，有些隐含了分类语义（如 `device-revoked` = security，`rate-limited` = quota），但它们没有显式的 category 字段
- **为什么重要**：
  - Category 系统让前端和 worker-logger 可以做"按类别处理"——例如所有 `transient` 类错误自动重试，所有 `security` 类错误触发 logout
  - 当前设计的 `docs/api/error-codes.md` 中"前端处理建议"列是为人类编写的，不能替代代码中的 `if (error.category === 'transient') retry()`
- **审查判断**：
  - 完整的 7 类 category 系统可以在 first-wave 之后追加（与 §6.1 取舍 2 "保留分布枚举"一致）
  - 但建议在设计中为此留 seam——在 `FacadeErrorCode` 的每个 code 定义旁加一个 `@category` 注释，或在 `docs/api/error-codes.md` 的 `category` 列中填写这 7 类之一
- **建议修法**：
  1. 在 §3.2 接口保留点中新增一项：error category 系统——first-wave 在 `docs/api/error-codes.md` 中为每个 code 标记 7 类 category 之一；future 从文档生成 `getErrorCategory(code): ErrorCategory` 运行时函数
  2. 在 F3 的 `docs/api/error-codes.md` 的 `category` 列中，使用 smind-admin 的 7 类术语（validation/transient/dependency/permanent/security/quota/conflict）
  3. 在 §8.5 借鉴清单中新增：`context/smind-admin/src/infra/errors.ts:5-28` — 借鉴 error category 7 类 + `mapErrorCategoryToStatus` 映射

---

## 3. 高优先级建议（对设计质量提升有显著影响）

### S1. smind-admin 与 nano-agent error response 格式差异需要显式决策

- **事实**：
  - smind-admin: `{ ok: false, error: { code, category, message, detail } }` + `trace_id`（顶层字段）
  - nano-agent: `{ ok: false, error: { code, status, message, details? }, trace_uuid }`（顶层字段）
  - 两者都遵循 `{ ok: false, error: {...}, trace_* }` 的总体结构，但 `error` 内部字段和命名的细微差异（`detail` vs `details`、`category` vs `status`、`trace_id` vs `trace_uuid`）
- **影响**：如果 smind-admin 的某些 RPC 路径将来要通过 `ORCHESTRATOR_CORE` service binding 调用 nano-agent 的 facade，或者前端同时消费两个服务的 API，这些格式差异会成为集成障碍
- **建议**：在 §5.3 边界清单中新增一条："smind-admin 与 nano-agent 的 error response 格式差异是否需要 first-wave 收敛？判定：first-wave 不收敛（各自保持现有格式）；差异记录在 F3 的 `docs/api/error-codes.md` 附录中"

### S2. wbca-mini 微信小程序端的需求应纳入影响评估

- **事实**：`context/wbca-mini/miniprogram/utils/api.js` 是微信小程序 API 调用层——每调一次 API 都直接解析响应中的错误结构。小程序端运行在受限的 JavaScript 环境中（无浏览器 DevTools Network 面板、无 `wrangler tail`、`console` 输出不可开发侧访问）
- **影响**：RHX2 设计的 F6（Server-Timing 头）对微信小程序端无价值（微信 `wx.request` API 不支持读取响应头）；F5（/debug/logs 端点）对 production 用户无价值。小程序端最依赖的是 **F2（统一的 facade error envelope）+ F7（WS system.error 推送）**
- **建议**：在 §2.1 角色描述中，将"前端开发者"扩展为"web 前端 + 微信小程序前端"，并显式声明 F2/F7 是这两个前端共同的依赖面（F5/F6 仅 web 端可用）

### S3. DO 调度模型对 Logger 的影响应显式处理

- **事实**：smind-contexter 的 `Logger.log()` 接受可选的 `ctx?: ExecutionContext` 参数用于 `ctx.waitUntil()`。nano-agent 的 agent-core DO 环境没有 `ExecutionContext`，异步 D1 写入不能依赖 `waitUntil`，必须用其他机制保证（如"在 DO 的 `fetch` 返回前 await"或"fire-and-forget with best-effort"）
- **影响**：如果 F1 的 worker-logger 不做 DO/Worker-Shell 双模适配，在 agent-core 的 DO 环境中可能出现"D1 写入 Promise 被 GC 丢弃"的丢日志问题
- **建议**：在 F1 的"边界情况"中增加一条："DO 环境（agent-core NanoSessionDO）：日志持久化通过 orchestrator-core RPC `recordErrorLog` 完成——这是 await 的（RPC 调用天然被 DO 的 request 生命周期保护）；Worker Shell 环境（orchestrator-core fetch handler）：`ctx.waitUntil()` 保证异步写入不被丢弃"

### S4. worker-logger 的 JSON 格式应做 schema 校验测试

- **事实**：mini-agent 的 `test_terminal_utils.py`、`test_markdown_links.py` 等测试验证输出格式的一致性——这是"输出给另一个程序（前端/日志采集器）消费"时需要的基础保障
- **影响**：如果 worker-logger 的 JSON 输出格式发生漂移（例如某次 PR 把 `trace_uuid` 字段名改成了 `traceId`），前端 parser 会静默失败——因为 JSON.parse 本身不报错
- **建议**：在 F1 的测试覆盖要求中增加一条："worker-logger 的 JSON 输出格式通过 zod schema 校验测试（≥2 cases：合法输出 + 缺少必需字段时拒绝）"，以防止格式漂移

### S5. 缺少对 `wrangler tail` + Cloudflare Workers Logs 的互补关系说明

- **事实**：worker-logger 写 JSON 一行到 `console.*`，这个输出**天然被 `wrangler tail` 和 Cloudflare Workers Logs 捕获**。这意味着即使不启用 D1 持久化，所有 severity≥info 的日志也已经进入了 Cloudflare 平台的日志存储（TTL 由 Cloudflare 控制）
- **影响**：设计当前将 console 定位为"dev-only"，但其实 console 输出的 JSON 一行格式可以被 Workers Logs 索引——这是一个无需额外成本就能获得的结构化日志查询能力。设计中应提及这一点，以避免 `wrangler tail` 完全被废弃（它是 D1 持久化的有益补充）
- **建议**：在 F1 的"核心逻辑"中增加说明："console JSON 输出同时进入 Cloudflare Workers Logs（`wrangler tail` 可查）——这是 D1 持久化的有益补充（Workers Logs 提供写入端 view，D1 提供读取端 query API）"

---

## 4. In-Scope 逐项对齐审核

| 编号 | 功能项 | 审查结论 | 说明 |
|------|--------|----------|------|
| F1 | `worker-logger` 共享包 | `design-sound` | 4 级日志 + ALS + 环形缓冲 + onError 钩子——设计完整。建议补 DO/Worker-Shell 双模说明（见 S3）和 JSON 格式 schema 校验测试（见 S4） |
| F2 | `respondWithFacadeError()` helper | `design-sound` | 统一到 `FacadeErrorEnvelope`，编译期阻拦非法 code。与 smind-admin `jsonError` 的模式一致 |
| F3 | `docs/api/error-codes.md` 单一查询入口 | `design-sound-but-incomplete` | 文档方向正确。建议补运行时 `resolveErrorMeta()` 函数（见 R1）和 error category 系统（见 R3） |
| F4 | D1 `nano_error_log` 表 + 持久化 | `design-sound` | 表结构合理（含 3 个索引）。dedupe / rate-limit / TTL 治理充分。建议与 smind-contexter 的 `LogPersistFn` 模式对齐（见 R2） |
| F5 | `/debug/logs` 调试 endpoint | `design-sound` | 查询参数合理（trace_uuid / session_uuid / code / since / limit）。team 边界 + rate-limit 防护到位 |
| F6 | `Server-Timing` header 注入 | `design-sound` | 浏览器原生展示，零前端代码。first-wave 仅 3 粒度合理 |
| F7 | `session.stream.event::system.error` kind | `design-sound` | 新增 kind 优于复用 notify，取舍 5 论证充分。schema 降级策略到位 |
| F8 | `emitObservabilityAlert()` critical alert | `design-sound` | 仅 3 类触发，first-wave 不膨胀。自写 D1 失败有 fallback |
| F9 | bash-core / orchestrator-auth 接 logger | `design-sound` | 终结 0 console 状态。不改 RPC 返回 schema |
| F10 | ESLint 重复定义防漂移 | `design-sound` | `no-restricted-imports` 方案比合并代码更安全。first-wave 不删代码正确 |

---

## 5. Tradeoff 额外评审

### 对 6 个核心取舍的独立判断

| 取舍 | 设计选择 | 独立判断 | 额外考量 |
|------|----------|----------|----------|
| 取舍 1：D1 + npm logger vs OTel SDK | D1 + npm logger | **同意**。在 Cloudflare Workers 上跑完整 OTel SDK 的 bundle size / 复杂度成本远超 first-wave 收益 | smcp 项目已经证明了"先做轻量 logger + D1 持久化，后加 OTLP exporter"的路径是可行的 |
| 取舍 2：7 个分布枚举 + docs vs 巨枚举 | 保留分布 + docs | **同意但需补强**。docs 对 first-wave 足够，但缺少可被代码消费的 `resolveErrorMeta()` 层（见 R1） | smcp 的 `registerErrorDefinition()` 证明了运行时 registry 的价值 |
| 取舍 3：单写点 orchestrator-core vs 多写点 | 单写点 | **同意**。跨租户边界校验是 charter §10.3 红线，单写点是唯一安全的方案 | smind-admin 的 `requireTeam()` 中间件从侧面证明了"在边界处集中校验"模式的有效性 |
| 取舍 4：不删重复定义 + ESLint vs 代码合并 | ESLint 防漂移 | **同意**。RH4/RH5 的 carry-over 已经够多，不应为 DRY 抢资源 | — |
| 取舍 5：新 system.error kind vs 复用 system.notify | 新增 kind | **同意**。协议清洁度优先于减少 schema surface | 前端只需多一行 switch case，架构受益永久 |
| 取舍 6：migration 012 vs 抢 011 | 012 | **同意**。横切簇可后置，不应抢主线 migration 编号 | — |

### 额外 tradeoff：设计中未讨论但值得考虑的

| 新增 tradeoff | 选项 A | 选项 B | 建议 |
|---------------|--------|--------|------|
| `/debug/logs` 返回格式：`FacadeSuccessEnvelope` vs 纯数组 | 当前设计走 `FacadeSuccessEnvelope<{logs, retention_days}>` | 直接返回 `{ logs: [...], retention_days: 14 }` | 用 FacadeSuccessEnvelope — 与 S2 统一；前端一套 parser 全覆盖 |
| error context 字段中 `userUuid` 是否写入 | 不写（当前设计走纪律） | 写 team_uuid 但不写 user_uuid（隐私 vs debug 能力） | 仅写 `team_uuid` + `session_uuid` + `trace_uuid` — 足够定位，不引入 GDPR 风险 |

---

## 6. Out-of-Scope 核查

| 编号 | 项 | 审查结论 | 说明 |
|------|-----|----------|------|
| O1 | OTel SDK 完整接入 | `正确排除` | first-wave 太重 |
| O2 | OTel span hierarchy | `正确排除` | ALS seam 已留 |
| O3 | histogram metrics 全量启用 | `正确排除` | counter 更基础 |
| O4 | Hook handler 注册表全量接电 | `正确排除` | RH5/RH6 scope |
| O5 | Evidence 业务持久化 | `正确排除` | in-memory eval sink 够用 |
| O6 | PII 自动脱敏 | `正确排除` | 走纪律 |
| O7 | 第三方 APM | `正确排除` | OTLP-shape seam 已留 |
| O8 | session-replay | `正确排除` | 非 debug 最小集 |
| O9 | user-level telemetry opt-out | `正确排除` | 无 user-level metrics |
| O10 | 重复定义代码合并 | `正确排除` | 风险高 |
| O11 | Cloudflare Logpush | `正确排除` | 运维项 |
| smcp error_registry 完全引入 | **应加入 §3.2** | 运行时 registry 价值高（见 R1） | — |
| smind `LogPersistFn` 模式显式建模 | **应加入 F1** | 解耦价值高（见 R2） | — |
| smind error category 体系 | **应在 F3 中预留** | 分类价值高（见 R3） | — |

---

## 7. 最终 Verdict 与推进条件

- **最终 verdict**：`设计方向正确，工程判断稳健，主体成立。有三个 sibling 项目（smcp / smind-contexter / smind-admin）的成熟模式未被充分吸收——这不是否决设计的理由，而是让设计从"够用"升级到"充分借鉴生态内既有最佳实践"的机会。`

- **是否允许推进 action-plan**: `yes（有条件）`

- **推进前必须完成的 3 项修正**：
  1. **§3.2 接口保留点**：新增 `resolveErrorMeta(code: string): ErrorMeta | undefined` 运行时错误元数据查询函数（见 R1）
  2. **§7.2 F1 详细阐述**：显式定义 `onError` 的 `LogPersistFn` 类型签名 + DO/Worker-Shell 双模持久化保证（见 R2 + S3）
  3. **§7.2 F3 详细阐述**：`docs/api/error-codes.md` 的 `category` 列采用 smind-admin 的 7 类术语（validation/transient/dependency/permanent/security/quota/conflict）（见 R3）

- **建议在 action-plan 阶段处理的高优先级项**：
  1. smind-admin 与 nano-agent error response 格式差异的显式决策（见 S1）
  2. wbca-mini 微信小程序端需求纳入 §2.1 角色描述（见 S2）
  3. worker-logger JSON 格式的 schema 校验测试（见 S4）
  4. `wrangler tail` + Workers Logs 与 D1 持久化的互补关系说明（见 S5）

- **建议的二次审查方式**: `no rereview needed（处理上述 3 项修正后直接推进 action-plan）`

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §8 append 回应，不要改写 §0–§7。`

---

## 8. 附录：sibling 项目关键代码位置速查

| 项目 | 文件 | 行 | 借鉴内容 |
|------|------|-----|----------|
| smcp | `tests/error_registry.test.ts` | 1-24 | `registerErrorDefinition()` / `resolveErrorDefinition()` 运行时 registry API |
| smind-contexter | `core/log.ts` | 36-41 | `LogPersistFn` 类型（db, data, traceId, ctx）解耦模式 |
| smind-contexter | `core/log.ts` | 120-134 | DO/Worker-Shell 双模持久化（`ctx.waitUntil` vs fire-and-forget） |
| smind-contexter | `core/errors.ts` | 25-44 | `ErrorCodes` 枚举 + `SkillException` 类（code + status + payload） |
| smind-contexter | `core/errors.ts` | 109-139 | `makeErrorResponse()` 统一 JSON 错误响应工厂 |
| smind-admin | `infra/logger.ts` | 1-3 | 共享 smcp 包的单行 logger 接入 — **证明"共享 logger 包"模式可行** |
| smind-admin | `infra/errors.ts` | 5-28 | `HttpError` 7 类 category + `mapErrorCategoryToStatus()` 映射 |
| smind-admin | `http/response.ts` | 1-29 | `jsonOk()` / `jsonError()` 统一响应 format |
| smind-admin | `http/middleware.auth.ts` | 36-61 | `requireAuth()` 双轨（API key / JWT）+ 具体错误码 |
| smind-admin | `http/middleware.team.ts` | 4-12 | `requireTeam(auth)` team 边界强制校验 — **与 F5 的 team 边界要求一致** |
| wbca-mini | `miniprogram/utils/api.js` | — | 微信小程序 API 调用层 — **提醒 F2/F7 对小程序的价值 > F5/F6** |

---

*审查完成于 2026-04-29。本审查独立完成，基于 sibling 项目的代码事实进行辩证分析。*
