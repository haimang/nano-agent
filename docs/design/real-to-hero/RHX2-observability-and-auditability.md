# Nano-Agent 功能簇设计

> 功能簇: `RHX2 Observability & Auditability — 日志、报错、可审计性强化簇`
> 讨论日期: `2026-04-29`
> 讨论者: `Owner + Opus 4.7 (1M)`（参考 DeepSeek 独立 audit）
> 关联调查报告:
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-opus.md`（Opus 视角，事实盘点 + 协议留位映射 + 三家 CLI agent 对比）
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md`（DeepSeek 视角，错误码全表 + Evidence/Hook/Metric 分项审计）
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`（拟新增 Q-Obs1 ~ Q-Obs5）
> 文档状态: `draft`
>
> 命名说明：本文件取 `RHX2` 前缀（与 `RHX-qna.md` 同一附加章节坐标系），用于把"观测/审计"作为 RH 主线 RH0–RH6 之外的 **横切簇** 单独立项；它对所有 phase 都生效，但不绑定特定 phase 的 hard gate。

---

## 0. 背景与前置约束

> 本设计被两件事推到台前：
> 1. RH4 已经收口，前端组装阶段开始；前端只能拿到 `x-trace-uuid` 一项可观测性，debug 强依赖 owner 截屏 + `wrangler tail` 反查。
> 2. 两份独立 audit（Opus / DeepSeek）从不同切面同时给出"协议骨架已铺、运行时大面积真空"的结论；继续推进后续 RH5/RH6 之前，必须先把这条隐性债务 **作为一个独立功能簇** 立项。
>
> **本设计不再讨论的事**：是否需要做可观测性、是否引入 NACP 协议、是否保留 6-worker 拓扑。这些都已经在 charter 与既有 design 中冻结。

- **项目定位回顾**：nano-agent 是"6-worker on Cloudflare + NACP 协议"的 agent 平台；real-to-hero 阶段的核心目标是把骨架做成可被前端使用的真实产品面。
- **本次讨论的前置共识**：
  - 已冻结：6 worker 拓扑、NACP 协议族（nacp-core / nacp-session / 错误注册表 / 观测 envelope / evidence 四流）、`x-trace-uuid` 全链路头透传、`facadeError` envelope schema。
  - 已冻结：所有 worker `wrangler.jsonc` 都已开 Cloudflare `observability.enabled = true`（Workers Logs 入云）。
  - 已冻结：`session.stream.event` 9 种 kind 与 `system.notify` / `compact.notify` / `tool.call.result` 三种语义；其中 `system.notify` 在 agent-core kernel 错误路径已 emit。
  - 已落地：23 + 22 + 13 + 6 + 8 + 8 共 **80 个 error code 枚举**（NACP / Rpc / Auth / Kernel / Session / LLM）已定义。
  - 已落地：`x-trace-uuid` 在 orchestrator-core / agent-core 是源头与校验点，跨 worker RPC 在 `RpcMeta.trace_uuid` 上传播。
  - **不再讨论**：是否替换 NACP / 是否换 Cloudflare 平台 / 是否引入第三方 telemetry 厂商作为依赖（OTLP 兼容是设计目标，不是依赖）。
- **本设计必须回答的问题**：
  - **D1**：协议层留出来的 `system.error` / `NacpObservabilityEnvelope` / `NacpErrorBodySchema` / `Evidence 四流` / `metric-names`，哪些 first-wave 必须接电、哪些可以继续保持 schema-only？
  - **D2**：6 个 worker 的应用层日志要不要统一抽象（结构化 logger）？走什么 sink？前端如何取？
  - **D3**：错误体系的两套坐标系（`FacadeErrorCode` 22 + `NACP_*` 23 + 其他 5 套子枚举）如何在 first-wave 收敛？是否做映射表 + 单一查询入口？
  - **D4**：错误是否需要持久化到 D1？保留多久？谁可以查？前端能查吗？
  - **D5**：`x-trace-uuid` 之外，前端单请求级别还能拿到什么（`Server-Timing` / 子调用清单 / 上游 worker 标记）？
  - **D6**：bash-core / orchestrator-auth 这两个 prod 路径 0 console 的 worker，是必须补、还是接受这种"throw-only"？
- **显式排除的讨论范围**：
  - 用户面 telemetry / 产品分析（不是 GrowthBook、不是 Statsig；first-wave 不做 user-level metrics）。
  - PII 自动脱敏框架（first-wave 走"不写敏感字段"的人工纪律，自动脱敏延后）。
  - 第三方 APM（Sentry / Honeycomb / Datadog）——不依赖；OTLP-兼容是设计目标，是否真启用第三方延后。
  - Cloudflare Logpush / 跨账户日志聚合（运维项，不是 design 项）。
  - admin / billing 维度的 audit（属 hero-to-platform 阶段）。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RHX2 Observability & Auditability`
- **一句话定义**：把 NACP 协议预留的 log / error / observability / evidence 槽位 **从 schema-only 推进到 runtime-wired**，让 6 个 worker 的运行时行为可被开发者、前端、与未来运维三类受众用统一坐标系定位。
- **边界描述**：
  - **包含**：(a) 统一的 worker 端结构化 logger 抽象；(b) 错误码体系收敛（统一查询入口、`FacadeErrorEnvelope` 推广至非 orchestrator-core 的 HTTP 入口）；(c) 错误持久化最小集（D1 `nano_error_log` 表）；(d) `system.error` / `system.notify` / `Server-Timing` 三类前端可消费通道接电；(e) `NacpObservabilityEnvelope` 最小 emitter（仅 critical 类）；(f) 单请求级 trace（`x-trace-uuid` + 子调用层级标记）；(g) 重复定义的清理（`StorageError` / `evidence-emitters` / `metric-names`）。
  - **不包含**：完整 OTel SDK 接入（仅留 OTLP-shaped seam）、metric histograms 全量启用、session-replay、UI 端 telemetry、第三方 APM、Cloudflare Logpush 配置、PII 自动脱敏。
- **关键术语对齐**（必填）：

| 术语 | 定义 | 备注 |
|------|------|------|
| `worker logger` | 一个共享 npm 包导出 `createLogger(workerName)` → `{ debug, info, warn, error }`，每条日志自动注入 `worker_name`、`trace_uuid`（如果 ALS 有）、`session_uuid`（如果有）；底层是 console，但格式标准化为 JSON 一行。 | 不是 pino / winston；要在 Cloudflare Workers runtime 跑 |
| `error envelope` | 即 `FacadeErrorEnvelope`：`{ ok:false, error:{code,status,message,details?}, trace_uuid }`。**本设计的目标是让 6 个 HTTP 入口都用这套**。 | facade error code = 32 个 kebab-case；`FacadeErrorCode ⊇ AuthErrorCode` 已编译期保证 |
| `error registry` | 单一查询入口 + 单一 docs：`docs/api/error-codes.md`，含全部 80 个 code（按枚举来源分组）+ HTTP status 映射 + 含义 + 前端处理建议。 | 不合并枚举，只合并文档 |
| `system.error frame` | `packages/nacp-session/messages` 已定义 `system.error` body schema；本设计为它在 `session.stream.event` 通道补一个 `kind:"system.error"` 推送形态（兼容现有 `kind:"system.notify"`）。 | 边界在 §3.4 |
| `error log` | D1 表 `nano_error_log` 持久化字段：`{trace_uuid, session_uuid?, team_uuid?, worker, code, severity, message, context_json, created_at}`，TTL 14 天。 | first-wave 仅承接 severity ≥ warn |
| `Server-Timing` | HTTP 响应头，浏览器 Network 面板原生展示；本设计要求 facade 路径在响应头返回 `auth;dur=X, agent;dur=Y, total;dur=Z`。 | 不做内部 propagation；只在 facade 边界采集 |
| `obs envelope` | `NacpObservabilityEnvelope`（`packages/nacp-core/src/observability/envelope.ts`）— `{ source_worker, source_role, alerts, metrics, traces }`；first-wave 仅 emit `alerts`（severity=critical）。 | metrics / traces 留 seam |

### 1.2 参考调查报告

- `docs/eval/real-to-hero/audit-and-reporting-study-by-opus.md` §1（用户三问的直接回答）、§2（协议留白 vs 代码缺位）、§4（盲点/断点/逻辑错误/认知混乱清单）、§6（推荐补救路径 R1–R7）。
- `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md` §2（console 分布 + trace_uuid 全链路评价）、§3（用户三问回答 + Hook handler 注册表为空 P5）、§4（盲点 B1–B4 / 断点 P1–P7 / 重复 E1–E6）、§6（80 codes 速查表起草稿）。
- `packages/nacp-core/src/{error-registry,error-body,observability/envelope,evidence/vocabulary}.ts` — 协议留位定义。
- `packages/nacp-session/src/{stream-event,messages/system}.ts` — 推送通道与 `system.error` schema。
- `packages/orchestrator-auth-contract/src/facade-http.ts:48-179` — facade error envelope 与 32-code 枚举源。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 在整体架构里扮演 **横切（cross-cutting）功能簇**：不属于 RH0–RH6 任何单一 phase；服务对象是"所有 phase 的开发者 + 前端 + 后续运维 + 评测/replay"。
- 它服务于：
  - 前端开发者：给出"我的请求服务端发生了什么"的最小定位面（`x-trace-uuid` + facade error envelope + `Server-Timing` + WS `system.error` 推送）。
  - worker 开发者：给出统一 logger，避免每个 worker 自创风格。
  - 评测 / replay：让 evidence 四流真实写出，而不是仅在 eval test 路径触发。
  - 未来运维：给 `NacpObservabilityEnvelope.alerts` 留出 critical 告警的真出口。
- 它依赖：
  - 已冻结的 NACP 协议族 schema（不动）。
  - 已冻结的 `x-trace-uuid` 头透传（不动）。
  - D1 已存在的 schema 演进规则（charter §8.4，migration 011 留给 RH5；本簇若需新表，候选 `migration 011-error-log.sql` **不与 RH5 冲突**，因为本簇 first-wave 可以延后到 RH5 之后插入）。
- 它被谁依赖：
  - 前端组装阶段（直接受益）。
  - RH5（多模型 / 多模态 / reasoning）：前端要在 model 切换 / image upload 失败时拿到结构化错误，否则 UX 不可用。
  - RH6（DO megafile decomposition）：拆分时强依赖"出错可定位"，否则风险高。
  - 后续 hero-to-platform 阶段的 admin / billing audit。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 (强/中/弱) | 说明 |
|---|---|---|---|
| RH0 bug-fix-and-prep | RHX2 → RH0 | 弱 | RH0 已冻结；RHX2 不回改 RH0 产物，仅复用 `x-trace-uuid` |
| RH1 Lane F live runtime | RH1 → RHX2 | 中 | `system.notify` 通道在 RH1 已建；本簇在它旁边补 `system.error` |
| RH2 LLM delta + Models inspection | RH2 ↔ RHX2 | 弱 | LLM error 走 `LLMErrorCategory` 8 类，本簇收口到 facade envelope |
| RH3 Device + API key | RH3 ↔ RHX2 | 中 | `AuthErrorCode` 13 类已规范；本簇对其零侵入，仅做 docs 汇总 |
| RH4 Filesystem R2 | RH4 ↔ RHX2 | 中 | 文件上传/下载错误进入 facade envelope；R2/D1 写失败发 critical alert |
| RH5 Multi-model multimodal | RH5 ← RHX2 | 强 | RH5 前端必须能区分"模型不支持"与"配额超限"，强依赖错误码统一 |
| RH6 DO megafile decomposition | RH6 ← RHX2 | 强 | 拆分前先有错误持久化，避免拆完出问题"看不到现场" |
| RHX-qna | RHX2 → RHX-qna | 中 | 新增 Q-Obs1..Q-Obs5 五题，进入 register |

### 2.3 一句话定位陈述

> "在 nano-agent 里，**RHX2 Observability & Auditability** 是 **横切功能簇**，负责 **把 NACP 协议层已经预留的 log / error / observability 槽位接到 6-worker 的 prod 运行时**，对上游提供 **前端可消费的统一错误形态、单请求时序、可查询的错误持久化**，对下游要求 **6 个 worker 的 HTTP 入口与应用层日志统一改走共享 logger 与 facade envelope**。"

---

## 3. 架构稳定性与未来扩展策略

> 本节锁定 **boundary** 与 **可扩展 seam**，不写执行任务。

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 | 砍的理由 | 未来是否可能回补 |
|---|---|---|---|
| 第三方 APM 直连（Sentry/Datadog/Honeycomb） | Opus audit §6 R5 | first-wave 不引入第三方依赖；OTLP-shape 已经够；上层选谁是运维决策 | 任何时候用 OTLP collector 转发即可，不影响应用代码 |
| 客户端 telemetry / UX 分析 | DeepSeek audit §1.3 Gemini ClearcutLogger | nano-agent 是 backend，前端 telemetry 由前端项目自己决定 | hero-to-platform 阶段 |
| 自动 PII 脱敏 | Opus §1.2 / DeepSeek §1.1 | 复杂度高 + first-wave message 字段可控；先靠"不写敏感字段"纪律 | 当 message/context 字段进入用户输入回显时回补 |
| histogram metrics 全量启用 | DeepSeek §3.5 | 11 个 metric name 中只有少数是 first-wave 必需；先做 counter，histogram 留 seam | RH5/RH6 评测阶段 |
| `evidence-emitters` 业务持久化 | Opus §2.5 / DeepSeek §3.3 | first-wave 让 evidence 走 in-memory eval sink + 前端不感知；持久化等评测真实需求 | 当评测平台需要长 retention 时 |
| Hook handler 注册表（18 hook event 全量接电） | DeepSeek §3.4 P5 | 这是 RH5/RH6 的 scope；本簇只把"hook 错误"喂到 logger | RH5/RH6 |
| 重复枚举的合并（不是 docs 合并） | DeepSeek §4.3 E1–E3 | first-wave 只合并文档，不动代码；动代码代价高且与 RH4 carry-over 抢资源 | 单独 cleanup phase |
| WS 端 `delivery_kind:"log"` 新 message type | Opus audit §4.2 D5 | 现有 `system.notify` + `system.error` 已能覆盖前端可见的两类；不为开发者-only 日志增协议 | 如果未来要做"前端 dev mode 实时看 server log"，再开新 kind |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来演进方向 |
|---|---|---|---|
| `createLogger(workerName)` 共享 npm 包 | `packages/worker-logger/src/index.ts` 导出 `createLogger`、`Logger` interface（`debug/info/warn/error`）、`withTraceContext()` ALS helper | 底层走 `console.{log,warn,error}`，每条 JSON 一行：`{ts, level, worker, trace_uuid?, session_uuid?, msg, ctx?}` | 切换底层为 OTel `LogRecord` exporter；无需改 caller |
| `Logger.error(...)` 钩子 | 同上，可注册 `onError(record => ...)` | first-wave 把 record 同步写一份到 D1 `nano_error_log`（在 orchestrator-core），并按 RPC 透传到 facade | 切换为 OTLP exporter |
| `system.error` stream-event kind | `packages/nacp-session/src/stream-event.ts` 新增 `SystemErrorEventBodySchema`：`{kind:"system.error", code, severity, message, source_worker?, trace_uuid?}`；与 `system.notify` 平行 | agent-core / orchestrator-core 在 facade 路径检测到 critical 错误时通过 emitServerFrame 推送 | 扩展加 `cause`、`retry_hint` 等字段 |
| `Server-Timing` header | facade response 在 `policy/authority.ts` 里加注入函数 `attachServerTimings(response, timings)` | 仅写 `total;dur=N` + `auth;dur=M` 两段；不传播跨 worker | 加 `agent;dur=X`、`bash;dur=Y`、子调用 trace |
| D1 `nano_error_log` 表 | migration `01x-error-log.sql`（编号在 §3.5 解释） | 仅承接 severity≥warn；TTL 14 天，由 alarm/cron 定期清理 | 加索引 by code / by team / by session；接管 audit |
| `obs envelope` emitter | `emitObservabilityAlert(scope, severity, code, message, ctx?)` helper（写在 worker-logger 包） | 仅 severity=critical 落地：写一份到 `nano_error_log`（额外标记 `severity='critical'`）+ console 打印 `[CRITICAL]` 前缀 | 加 metrics 字段聚合 + 走真实 OTLP collector |
| `docs/api/error-codes.md` | 文档生成器（可 npm script） | 手工汇总 80 个 code | 用 zod 反射自动生成 |
| `withTraceContext()` ALS helper | worker-logger 导出 | 在 fetch handler 顶层包一次，logger 自动取到 trace_uuid | 加 span hierarchy（claude-code 风格） |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象 1**：`worker-logger` 共享 npm 包必须独立于任何 worker 业务包。
  - **原因**：6 worker 都依赖；如果挂在某个 worker 子目录，其他 worker 引用会形成 cycle 风险（charter §10.3 NOT-成功退出 #2 cycle 红线）。
  - **依赖边界**：`worker-logger` 仅依赖 `nacp-core`（用于 `NacpObservabilityEnvelope` schema 校验）；**不能依赖** `nacp-session` / `orchestrator-auth-contract` / 任何 worker。
- **解耦对象 2**：`nano_error_log` D1 表的写入路径必须只走 orchestrator-core。
  - **原因**：6 worker 中只有 orchestrator-core 是 client-facing facade，写错误日志需要 team / session 边界已校验过。其他 worker 写 D1 会绕过租户边界。
  - **依赖边界**：bash-core / context-core / filesystem-core / agent-core 通过现有的 `ORCHESTRATOR_CORE` service binding（已存在于 RH4 后的 `wrangler.jsonc`）调用 `OrchestratorCoreEntrypoint.recordErrorLog(record)` RPC；orchestrator-auth 的错误由 orchestrator-core 在 `facadeFromAuthEnvelope()` 包装时同点写入。
- **解耦对象 3**：`docs/api/error-codes.md` 必须独立于 charter / design / action-plan。
  - **原因**：前端会高频读它，把它放在 design 里会造成"读到 frozen 的设计文档去查 prod 错误码"的语义错位。
  - **依赖边界**：`docs/api/` 是新目录（如不存在则建）；该 docs 只反映"代码事实"，不引用 design 文档。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象 1**：6 worker 的 HTTP 错误响应形态全部聚合到 `FacadeErrorEnvelope`。
  - **聚合形式**：worker-logger 包导出 `respondWithFacadeError(code, status, message, trace_uuid, details?)` helper；orchestrator-core / agent-core / bash-core / context-core / filesystem-core 的 fetch handler 在 catch 路径调用它；orchestrator-auth 已经走 RPC envelope（不需 HTTP 返回）。
  - **为什么不能分散**：前端只有一种 envelope 解析，否则前端要写 3 套 fallback。
- **聚合对象 2**：错误码语义全部聚合到 `docs/api/error-codes.md` 一份文档。
  - **聚合形式**：单文件、按枚举来源分 7 段（Rpc/Facade/Auth/NACP/Kernel/Session/LLM）+ 一段交叉参考。
  - **为什么不能分散**：前端 / 后端 / SRE 三类受众查同一份。
- **聚合对象 3**：critical 级别告警全部聚合到 `nano_error_log` 表（同时打印 console 前缀 `[CRITICAL]`）。
  - **为什么不能分散**：first-wave 不引入告警 broker；只要"事后能 query"就够；多个 sink 会让"是否发生过"出现分歧。

### 3.5 D1 migration 占位说明

charter §8.4 已分配 `010 → RH4`、`011 → RH5`。本簇 first-wave 需要新增 1 张表（`nano_error_log`）+ 0 个外键修改：
- **方案 A**（推荐，与 RH5 不冲突）：编号占用 `012-error-log.sql`，承诺在 RH5 `011-*.sql` 之后落地。
- **方案 B**：如本簇要在 RH5 之前发布，与 owner 协商把 `011` 借走，RH5 重编号为 `012`。
- 选择走 §9 QNA Q-Obs2 决议。

---

## 4. 参考实现 / 历史 precedent 对比

> 仅挑会改变本簇 first-wave 选择的关键差异点。完整对比见 Opus / DeepSeek 两份 audit。

### 4.1 mini-agent 的做法

- **实现概要**：仓库 `context/mini-agent/` 是一个轻量学习样本；observability 几乎不存在，错误处理是 try/catch + console。
- **亮点**：少；它的"少"反而是教训——同样在我们 first-wave 之前。
- **值得借鉴**：保持简单；不要在 first-wave 装第三方 APM。
- **不打算照抄的地方**：完全无错误持久化、无 trace 标识。

### 4.2 codex 的做法

- **实现概要**：Rust `tracing` 生态；SQLite `log_db.rs`（专用 logs 表，128-entry batch、2s flush、per-partition 10 MiB / 1000 row、10 天 retention）；`SessionTelemetry` 30+ 业务事件；OTel counter/histogram 17 个 metric；W3C `traceparent` propagation；`/healthz` + `/readyz` health endpoints。
- **亮点**：
  - SQLite 持久化形态值得借鉴（**结构对应 D1**）。
  - W3C `traceparent` 标准对接，少 reinvent。
  - `/healthz` + `/readyz` 双端点比单点 health 更分级。
- **值得借鉴**：
  - 用专用表（不混进业务表）做错误持久化的形态。
  - 把 `trace_uuid` 与 W3C `traceparent` 留 mapping seam（不强制全切，但 future-proof）。
  - `affects_turn_status()` 这种"错误是否会改变状态机"的 metadata 字段，未来 evidence 可以借鉴。
- **不打算照抄的地方**：
  - `tracing` crate / Rust subscriber 体系（语言不同）。
  - 67+ variants 的 `CodexErr` 整套（我们的 80 codes 已分布在 7 个枚举，不再做单一巨枚举）。
  - SessionTelemetry 30+ 业务事件方法（first-wave 不做）。

### 4.3 claude-code 的做法

- **实现概要**：`logForDebugging()` 5 级日志 + 双通道（stderr + 文件）；`errorLogSink.ts` JSONL 持久化（`~/.claude/errors/<ts>.jsonl`）+ 内存环形缓冲；`ClaudeError` 层次化 + 逐工具 `errorCode`；OTel span 4 类（interaction/llm_request/tool/hook）+ `AsyncLocalStorage` 传播；3P OTel + 1P BigQuery 双通道；`metricsOptOut`。
- **亮点**：
  - JSONL 文件 + 内存环形缓冲的 **双层持久化** 模型，让"最近 100 条" / "全量 14 天"分层。
  - `TelemetrySafeError` 这种把"日志可全文 / telemetry 必脱敏"分级的类型设计。
  - OTel span 的 `AsyncLocalStorage` 上下文传播 = 无需在每个函数签名里手传 trace context。
- **值得借鉴**：
  - 内存环形缓冲（worker-logger 包内置最近 N 条，/debug/recent-errors?limit=100 调试态可读）。
  - ALS 上下文传播（Cloudflare Workers 已原生支持 ALS）。
  - 5 级 log level + 运行时过滤（环境变量控制）。
- **不打算照抄的地方**：
  - BigQuery exporter（owner 不维护数据后端）。
  - GrowthBook 特性开关（不引入第三方依赖）。
  - Perfetto 追踪格式（先做朴素的 `Server-Timing`）。

### 4.4 横向对比速查表

| 维度 | mini-agent | codex | claude-code | gemini-cli | nano-agent first-wave 倾向 |
|---|---|---|---|---|---|
| 持久化层 | 无 | SQLite | JSONL + 内存环形 | 文件 + GCP | **D1 表 + 内存环形（包内）** |
| 日志层级 | 无 | 5 级 + RUST_LOG | 5 级 + env | 4 级 + env | **4 级（debug/info/warn/error）+ env `NANO_LOG_LEVEL`** |
| 结构化 | 无 | 全结构化 tracing | `[ts][level] msg` | `[ISO][LEVEL] msg` | **JSON 一行（更易被 Workers Logs 索引）** |
| Span | 无 | W3C TraceContext | OTel span 4 类 | OTel span | **first-wave 不做 span；留 ALS seam** |
| Health endpoint | 无 | `/healthz`+`/readyz` | 无 | 无 | **保留 RH0 已落 `/debug/workers/health`，不增 endpoint** |
| 错误码体系 | 无 | 67+ 巨枚举 | 层次化 + 逐工具 | 40+ ToolErrorType | **保留 7 个分布枚举，文档侧统一汇总** |
| 错误持久化 | 无 | SQLite | JSONL + 环形 | 走遥测 | **D1 + 内存环形** |
| Metrics | 无 | counter/hist 17 | counter/hist + BigQuery | counter/hist 30+ | **first-wave 不做 metric emit；保留 schema 与 names** |
| PII 处理 | 无 | log_only/trace_safe | TelemetrySafeError | sanitize* | **first-wave 走纪律；error context 字段不写敏感字段** |
| Opt-out | 无 | 无 | metricsOptOut | telemetry.enabled | **N/A first-wave** |
| 跨进程 trace | 无 | W3C traceparent | ALS | OTel | **保留 `x-trace-uuid` 自定义头；W3C 兼容留 seam** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（first-wave 必做）

- **[S1]** **共享 `worker-logger` npm 包**（`packages/worker-logger/`）：4 级日志、JSON 一行格式、ALS 注入 trace_uuid/session_uuid、内存环形缓冲（每 worker 最近 200 条）、`onError` 钩子。 — *为什么必做*：6 worker 现有 32 行 `console.warn`、orchestrator-auth/bash-core 完全 0 console；不收口未来每加一个 worker 就再生一种风格。
- **[S2]** **6 worker HTTP 错误响应统一到 `FacadeErrorEnvelope`**：worker-logger 导出 `respondWithFacadeError()` helper；6 worker 的 fetch handler catch 路径强制走它；orchestrator-auth 走 RPC envelope 不需 HTTP 返回。 — *为什么必做*：前端今天必须解析 ≥3 种错误形态（`{error:"..."}`、纯文本、facade envelope），无统一 schema。
- **[S3]** **`docs/api/error-codes.md` 单一查询入口**：80 个 code 全量汇总，按 7 个枚举分组，每码列出 `code / source / category / http_status / 含义 / 前端处理建议 / 何时弃用`。 — *为什么必做*：今天前端要读 7 份 zod 文件才能知道"这个 code 该不该提示用户重试"。
- **[S4]** **D1 `nano_error_log` 错误持久化（最小集）**：仅承接 severity≥warn；orchestrator-core 单点写；TTL 14 天 + alarm/cron 清理；表结构见 §7.2 F4。 — *为什么必做*：Cloudflare Workers Logs 仅 dashboard 可读、TTL Cloudflare 控制；前端 / owner 都拿不到历史。
- **[S5]** **`/debug/logs?trace_uuid=xxx&team_uuid=yyy` 调试 endpoint**（仅认证用户在自己 team 内可查）：返回近 14 天的 `nano_error_log` 命中。 — *为什么必做*：S4 写了不能查等于没写。
- **[S6]** **`Server-Timing` 头注入**：facade 路径在响应里返回 `total;dur=N` + `auth;dur=M`（如经过 auth）+ `agent;dur=X`（如经过 agent-core）三段。 — *为什么必做*：浏览器 Network 面板原生展示，零前端代码就能看耗时。
- **[S7]** **`session.stream.event::system.error` 推送形态**：在 stream-event union 中新增 kind=`system.error`，与 `system.notify` 并列；agent-core kernel 错误 + orchestrator-core facade error（如有 attached WS）emit。 — *为什么必做*：HTTP 阶段失败前端目前只能等下一次 HTTP；WS 阶段错误目前混在 `system.notify` 里语义模糊。
- **[S8]** **`NacpObservabilityEnvelope.alerts` 最小 emitter（仅 severity=critical）**：worker-logger 导出 `emitObservabilityAlert(...)`；first-wave 触发条件只有 3 类——D1 写失败 / RPC parity 失败 / R2 写失败。落地与 S4 共表（多一字段 `severity='critical'` 标记）。 — *为什么必做*：让 NACP 协议的 `obs envelope` 至少有一条真实代码路径，否则永远 schema-only。
- **[S9]** **bash-core / orchestrator-auth 接入 worker-logger**：让今天 0 console 的两个 worker 在错误路径至少有 `logger.error('...', {ctx})`。 — *为什么必做*：bash 失败 / wechat code 交换失败 / JWT 验证失败现在零取证。
- **[S10]** **重复定义清理（仅文档归并 + ts-import 路径修正）**：`StorageError` 家族 / `evidence-emitters` / `metric-names` 在两包重复 — first-wave **保留代码两份不删**，仅在 docs/error-codes.md 中标注"两份等价"，并加 ESLint `no-restricted-imports` 阻止新增第三份。 — *为什么必做*：避免 RH4 carry-over 与 RH5 抢资源；DeepSeek E1–E3 的代码合并延后。

### 5.2 Out-of-Scope（first-wave 不做）

- **[O1]** OTel SDK 完整接入（traces/logs/metrics 三通道）— *为什么暂不做*：依赖太重，且 Cloudflare Workers 跑 OTel SDK 当前需要权衡 worker bundle size；先把 S1–S9 跑稳。重评条件：当 metric histogram 真的被前端 / 运维需要时。
- **[O2]** OTel span hierarchy（claude-code 风格 4 类 span）— *为什么暂不做*：first-wave 仅靠 `x-trace-uuid` + `Server-Timing` 已能定位"哪一跳"；span 树先留 ALS seam。重评条件：RH6 拆分 megafile 后跨 worker 调用复杂度上升。
- **[O3]** OTel histogram metrics 全量启用（11 个 metric name 全部 emit）— *为什么暂不做*：metrics 与 logs 不同维度，first-wave 只补 logs；metric pipeline 与告警阈值定义是单独 phase。重评条件：评测 / SLO 需求。
- **[O4]** Hook handler 注册表全量接电（18 个 hook event）— *为什么暂不做*：是 RH5 / RH6 主线的 scope；本簇只把"hook 错误"接进 logger。重评条件：RH5/RH6。
- **[O5]** Evidence 业务持久化（assembly/compact/artifact/snapshot 落 D1 / R2）— *为什么暂不做*：first-wave 只让 evidence 继续走 in-memory eval sink；前端不感知。重评条件：评测平台需要长 retention。
- **[O6]** PII 自动脱敏框架 — *为什么暂不做*：先靠纪律；自动脱敏是独立的安全 / 合规 phase。重评条件：用户输入字段进入 error context 时。
- **[O7]** 第三方 APM（Sentry / Datadog）直连 — *为什么暂不做*：保持 OTLP-shape seam，不依赖第三方。重评条件：owner 决定接入特定供应商。
- **[O8]** session-replay / 完整 transcript 导出 — *为什么暂不做*：不是 audit / debug 的最小集。重评条件：用户支持 / 投诉受理流程上线。
- **[O9]** 用户级 telemetry opt-out（claude-code `metricsOptOut` 形态）— *为什么暂不做*：first-wave 没有 user-level metrics，无对象可 opt-out。重评条件：当 metric pipeline 启用且涉及用户行为时。
- **[O10]** 重复定义代码合并（`StorageError` / `evidence-emitters` / `metric-names`）— *为什么暂不做*：风险高（涉及 9+ 文件 import 路径），与 RH4 carry-over 抢资源。重评条件：RH5 后单独 cleanup phase。
- **[O11]** Cloudflare Logpush / 跨账户日志聚合配置 — *为什么暂不做*：运维项；本簇是 design / runtime 项。重评条件：上 prod 后运维需要。

### 5.3 边界清单（容易混淆的灰色地带）

| 项目 | 判定 | 理由 | 后续落点 |
|---|---|---|---|
| `agent-core` 内部 HTTP `http-controller.ts` 是否要返回 facade envelope | **in-scope (S2)** | 即便它是 internal endpoint，前端最近的 RH3 已经允许部分直连场景 | 进入 RHX2 action-plan |
| `system.notify` 是否要被 `system.error` 完全替代 | **out-of-scope (defer)** | 二者并存：notify 是中性业务通知，error 是故障；不强行合并 | 必要时在 RH5 后回评 |
| 错误持久化要不要做 team-level 视图 | **in-scope (S5)** | 前端调试 endpoint 必须按 team 边界过滤 | RHX2 action-plan |
| `console.log("usage-commit", ...)` 这条 quota 业务事件是否切到 logger | **in-scope (S1)** | 走 `logger.info`，方便后续切到 metric counter | RHX2 action-plan |
| `/debug/logs` 是否对 owner 全租户可见 | **defer** | first-wave 仅按 team 边界开放；owner 跨租户调试通过 wrangler tail / D1 直查 | Q-Obs5 |
| W3C `traceparent` header 是否同步透传 | **defer** | 保留 seam，但不在 first-wave 实装 | RH6 后 |
| `/debug/recent-errors?limit=100` 内存环形缓冲是否暴露 endpoint | **in-scope (S5 一部分)** | 与 S5 同 endpoint 一并实现，仅在调试态可读 | RHX2 action-plan |
| Hook 事件失败是否触发 `system.error` | **in-scope (S7)** | 复用 S7 通道，不另开 | RHX2 action-plan |
| Hook handler 注册表为空（DeepSeek P5）| **out-of-scope (O4)** | 是 RH5/RH6 scope | RH5/RH6 |
| evidence sink 持久化 | **out-of-scope (O5)** | first-wave 不动 | 评测 phase |
| `StorageError` 等重复类合并 | **out-of-scope (O10)** | 仅文档登记 | cleanup phase |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍

1. **取舍 1**：我们选择 **D1 表 + 共享 npm logger 包** 而不是 **接入完整 OTel SDK（traces/logs/metrics 三通道）**
   - **为什么**：Cloudflare Workers runtime 上 OTel SDK 的 bundle size / 兼容性 / 运营成本超 first-wave 边界；D1 已经在每个 worker 的 binding 里，写入零额外依赖；前端 debug 痛点的 80% 用 `trace_uuid + facade envelope + Server-Timing + /debug/logs` 就能解决。
   - **代价**：first-wave 拿不到 metrics/histograms，无法直接在 Grafana 看 p95；OTel span 树缺失。
   - **重评条件**：当 (a) 前端开始抱怨"看不到延时分布"或 (b) RH6 后跨 worker 调用层级深到 trace_uuid 不够定位时。

2. **取舍 2**：我们选择 **保留 7 个分布枚举（80 codes），仅做 docs 汇总** 而不是 **合并成单一巨枚举（codex 67+ variants 风格）**
   - **为什么**：合并代价极高（涉及 nacp-core / orchestrator-auth-contract / agent-core / nacp-session 4 包的 schema），且各枚举的"使用领域"清晰（Auth 不会 leak 到 Kernel）；docs 汇总 1 份足够前端用。
   - **代价**：理论上"一码多源"风险（同一字面 code 在两个枚举里出现含义不同）—— 缓解：docs 页面强制按"枚举来源"分组，code 不去重；前端按 source 索引。
   - **重评条件**：未来出现真实"一码多源"误用且影响生产时。

3. **取舍 3**：我们选择 **错误持久化只走 orchestrator-core 单写点** 而不是 **每个 worker 直接写 D1**
   - **为什么**：(a) 跨 worker 写 D1 会绕过租户边界校验（charter §10.3 NOT-成功退出 #5 跨租户红线）；(b) RPC 一跳的成本 < D1 binding 在每个 worker 重复维护的成本；(c) orchestrator-core 已经是 client-facing facade，是天然的"边界守卫者"。
   - **代价**：bash-core / context-core / filesystem-core / agent-core 写一条错误日志多一次 RPC 跳；有可能在 orchestrator-core 不可用时丢日志（但那时整个系统已不可用，错误日志是次要）。
   - **重评条件**：当某个非 orchestrator-core worker 错误率显著高且 RPC 链路成为瓶颈时。

4. **取舍 4**：我们选择 **first-wave 不删重复定义（O10）** 而不是 **顺手清理 `StorageError` / `evidence-emitters` / `metric-names`**
   - **为什么**：清理代价高（涉及 ≥9 文件的 import 修正）；与 RH4 / RH5 的 carry-over 抢有限的 owner 注意力；ESLint rule 阻止新增第三份就足够防漂移。
   - **代价**：DRY 原则被暂时违反；新加入的开发者会困惑"为什么有两个 StorageError"。
   - **重评条件**：RH5 收口后的 cleanup phase；或某个真实 bug 由"两份实现漂移"引发时。

5. **取舍 5**：我们选择 **新增 `system.error` stream-event kind** 而不是 **复用 `system.notify` + severity=error**
   - **为什么**：(a) `system.notify` 的语义是"中性业务通知"（压缩完成、超额提醒），把"故障"塞进同一通道会让前端必须靠 message 字段判断——脆且违反类型直觉；(b) 新增 kind 对 schema 是 additive，不破坏现有 consumer（durable-truth 的 promote 决策仍按 kind 分发）；(c) `packages/nacp-core/src/messages/system.ts` 已有 `system.error` body schema，本设计只是把它接到 stream-event union。
   - **代价**：前端要订阅 2 个 kind（system.notify / system.error），多一行 switch case。
   - **重评条件**：从未——这是协议清洁度问题，不应回退。

6. **取舍 6**：我们选择 **D1 migration 编号 = 012**（推荐方案 A） 而不是 **抢 011**
   - **为什么**：charter §8.4 已分配 011 给 RH5；RHX2 是横切簇、可后置；让 RH5 主线优先。
   - **代价**：本簇 first-wave 上线时点不能早于 RH5 migration apply。
   - **重评条件**：owner 决定本簇先于 RH5 上线（Q-Obs2）。

### 6.2 风险与缓解

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| `nano_error_log` D1 写入风暴（错误连锁触发自身写入） | 大量 critical 同一 trace 内反复写 | D1 写配额耗尽 / 雪崩 | (a) worker-logger 内部按 (trace_uuid, code) 5 秒去重；(b) per-team 写速率限制（每秒 ≤ N 条）；(c) D1 写失败时只 fallback 到 console.warn，不 retry |
| 跨 worker `recordErrorLog` RPC 形成调用 cycle | bash-core → orchestrator-core → bash-core | charter §10.3 #2 cycle 红线 | RPC 仅单向；orchestrator-core 不能为了写日志再回调任何 worker |
| `Server-Timing` 头泄漏内部时序细节 | 第三方观察响应头 | 信息暴露 | first-wave 仅暴露粗粒度（auth/agent/total），不暴露 D1/R2/AI 子调用 |
| `/debug/logs` 被滥用看他人 team 数据 | 鉴权漏洞 | 跨租户 | 复用 RH3 已落 device gate + team_uuid 必须等于请求者 team |
| `system.error` 推送把握不住量，前端被淹 | agent-core kernel 高频 error | 前端 UI 卡 | (a) per-session 5 秒 dedupe by code；(b) 前端 client 只在 dev mode 可见 |
| 重复定义不清理导致漂移 | 一份 PR 改了 `StorageError` A 没改 B | 行为不一致 | ESLint `no-restricted-imports` 把新代码引导到指定一份 |
| migration 012 与 RH5 011 冲突 | RH5 / RHX2 同月落地 | schema 状态机错乱 | Q-Obs2 owner 显式排序 |
| TTL 14 天导致前端误以为日志永存 | 前端报"看不到上周的错误了" | UX 混乱 | docs/api/error-codes.md 顶部明确 TTL；`/debug/logs` 响应附 `retention_days: 14` |
| OTLP-shape 留 seam 后被滥用为"已经接 OTel" | 团队认知混乱（DeepSeek C5 同类风险） | 决策错位 | docs 顶部声明：first-wave 仅 schema-shape；真启用 OTel 是后续独立决策 |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：debug 链路从"截屏 + wrangler tail + 肉眼"升级到"trace_uuid + /debug/logs + Server-Timing"，预计 80% 的前端 bug 不再需要 owner 介入。
- **对 nano-agent 的长期演进**：把 NACP 协议的 observability 留位真正接电一次，避免它一直处于"schema 已定义、runtime 永远 0 emit"的腐烂状态；error code docs 一份让后续 hero-to-platform 阶段的 admin / billing audit 有锚点。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：
  - **稳定性**：critical alert + D1 持久化让"发生过什么 / 还在发生什么"可被 owner 复盘。
  - **上下文管理**：evidence 四流的 errorCode 字段终于在 prod 路径可见（从 in-memory eval sink → 至少 critical 写 D1）。
  - **Skill**：未来 skill 失败有结构化错误码可分发，hook handler 全量接电时不再"灰色失败"。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| F1 | `worker-logger` 共享包 | 4 级 logger + ALS trace 注入 + 内存环形缓冲 + onError 钩子 | ✅ 6 worker 全部 import 同一份；从 `console.*` 切到 `logger.*`；新增 ESLint rule 阻止裸 console |
| F2 | `respondWithFacadeError()` helper | 把 6 worker HTTP catch 路径统一到 `FacadeErrorEnvelope` | ✅ 6 worker 的 fetch handler 在错误路径返回 `{ok:false, error:{code,status,message,details?}, trace_uuid}`，且响应头有 `x-trace-uuid` |
| F3 | `docs/api/error-codes.md` 单一查询入口 | 80 个 code 全量汇总 + HTTP 映射 + 含义 + 前端处理建议 | ✅ 文档存在；按 7 段分组；每码必填 6 列 |
| F4 | D1 `nano_error_log` 表 + 持久化 | migration 012-error-log.sql；orchestrator-core 单点写；TTL 14 天 | ✅ migration 已 apply；写路径有单测；TTL 清理由 alarm/cron 完成 |
| F5 | `/debug/logs` 调试 endpoint | 按 team_uuid + trace_uuid 查询近 14 天错误 | ✅ orchestrator-core route 实装；返回 facade envelope；rate limit；team 边界强校验 |
| F6 | `Server-Timing` header 注入 | facade 路径返回 auth/agent/total 三段 | ✅ orchestrator-core 出口响应必含 `Server-Timing` 至少 `total` 一段 |
| F7 | `session.stream.event::system.error` kind | 新增 stream-event kind；agent-core / orchestrator-core 在 critical 错误时 emit | ✅ schema 落地；agent-core kernel error 切 system.error；前端 schema 单测通过 |
| F8 | `emitObservabilityAlert()` critical alert 出口 | 仅 severity=critical；3 类触发（D1 写失败 / RPC parity / R2 写失败） | ✅ 3 类触发都有单测；落 `nano_error_log` 含 `severity='critical'` 标记 |
| F9 | bash-core / orchestrator-auth 接 logger | 这两 worker 0 console 状态终结 | ✅ 2 worker `package.json` 依赖 worker-logger；prod 路径错误必有 `logger.error(...)` |
| F10 | 重复定义防漂移（ESLint） | `StorageError` / `evidence-emitters` / `metric-names` 加 ESLint `no-restricted-imports` 把新代码引到指定一份 | ✅ ESLint rule 落地；CI 红即拦截 |

### 7.2 详细阐述

#### F1: `worker-logger` 共享包

- **输入**：caller 通过 `createLogger(workerName)` 取 logger；调用 `.info('msg', {ctx})` / `.warn(...)` / `.error(...)`。
- **输出**：
  - console 一行 JSON：`{"ts":"...","level":"info","worker":"orchestrator-core","trace_uuid":"...","session_uuid":"...","msg":"...","ctx":{...}}`。
  - 内存环形缓冲：保留最近 200 条（per worker instance）。
  - `onError` 回调（仅 `error` 级别触发）：first-wave 由 orchestrator-core 注入"调用 RPC 写 D1"。
- **主要调用者**：6 个 worker 的所有错误路径 + 关键业务路径。
- **核心逻辑**：
  - ALS 注入：`withTraceContext({trace_uuid, session_uuid?, team_uuid?}, fn)` 在 fetch handler 顶层包；logger 自动 read。
  - dedupe：worker 内 5 秒 LRU dedupe by `(level, msg, code)`，避免风暴。
  - level 过滤：环境变量 `NANO_LOG_LEVEL=debug|info|warn|error`，默认 `info`。
- **边界情况**：
  - ALS 不可用时 trace_uuid 字段省略，不抛错。
  - `JSON.stringify` 失败（循环引用）→ 回退到 `String(ctx)` 并标记 `_serialize_error: true`。
  - 内存环形缓冲在 worker 重启时丢失（这是 Cloudflare 行为，不可避免）。
- **一句话收口目标**：✅ **6 个 worker 都 import `@nano-agent/worker-logger`，prod 路径下 `console.*` 不再被新代码使用（ESLint enforced）。**

#### F2: `respondWithFacadeError()` helper

- **输入**：`(code: FacadeErrorCode, status: number, message: string, trace_uuid: string, details?: unknown)`
- **输出**：`Response`，body = `FacadeErrorEnvelope`，headers 含 `x-trace-uuid` + `Content-Type: application/json`。
- **主要调用者**：orchestrator-core / agent-core / bash-core / context-core / filesystem-core 的 fetch handler catch 路径。orchestrator-auth 走 RPC envelope（不需 HTTP 入口形态收口）。
- **核心逻辑**：
  - 与现有 `policy/authority.ts:31` 的 `facadeError()` schema 一致（直接 re-export 也可）。
  - 内部调用 `logger.error(message, {code, status, details})`，复用 F1 的写日志 + onError 钩子。
- **边界情况**：
  - `code` 不在 `FacadeErrorCodeSchema` 枚举内 → 编译期阻拦（用 zod inferred type 做参数）。
  - `details` 为 `undefined` 时不写字段（与现有 `facadeError` 一致）。
- **一句话收口目标**：✅ **6 worker 的 HTTP error 响应只剩一种 envelope（前端 1 套 parser 全覆盖）。**

#### F3: `docs/api/error-codes.md`

- **输入**：(人工或 npm script reflect) 7 个 zod 枚举的字面量。
- **输出**：1 份 markdown 文档，分 7 段（Rpc / Facade / Auth / NACP / Kernel / Session / LLM）+ 1 段 `cross-reference`。每码必填表头 6 列：`code / source / category / http_status / 含义 / 前端处理建议`（前端处理建议如 "show user as auth-failure" / "show retry button" / "log only, do not surface to user"）。
- **主要调用者**：前端 / owner / SRE。
- **核心逻辑**：first-wave 手工汇总；future 用 npm script 反射 zod schema 自动生成。
- **边界情况**：
  - DeepSeek audit §6 已写好 22 + 19 + 6 + 8 = 55 codes 的起草稿，可直接复用；剩余 22（Facade）+ 8（LLM）+ 13（Auth）由本簇补齐。
  - 文档顶部必须声明 TTL = 14 天（与 F4 对齐）。
- **一句话收口目标**：✅ **`docs/api/error-codes.md` 落地，80 codes 每条 6 列必填；前端在该文档查到任意 code 都能找到含义与处理建议。**

#### F4: D1 `nano_error_log` 表 + 持久化

- **输入**：worker-logger `.error(...)` 触发 → orchestrator-core RPC `recordErrorLog(record)` → INSERT。
- **输出**：D1 一行。
- **表结构**（`migration 012-error-log.sql`）：

```sql
CREATE TABLE nano_error_log (
  log_uuid TEXT PRIMARY KEY,
  trace_uuid TEXT NOT NULL,
  session_uuid TEXT,
  team_uuid TEXT,
  worker TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,    -- "warn" | "error" | "critical"
  message TEXT NOT NULL,
  context_json TEXT,
  created_at TEXT NOT NULL   -- ISO 8601
);
CREATE INDEX nano_error_log_trace_idx ON nano_error_log(trace_uuid, created_at);
CREATE INDEX nano_error_log_team_idx ON nano_error_log(team_uuid, created_at);
CREATE INDEX nano_error_log_session_idx ON nano_error_log(session_uuid, created_at);
```

- **核心逻辑**：
  - severity 过滤：仅 `warn` / `error` / `critical` 写；`debug` / `info` 不写。
  - dedupe：(trace_uuid, code) 5 秒去重（worker-logger 包内）。
  - rate-limit：per-team ≤ 10 写/秒；超额走 console.warn + 跳过 D1 写。
  - TTL：alarm 每天清理 `created_at < now - 14d`。
- **边界情况**：
  - D1 binding 不可用 → fallback to console；不抛错。
  - `context_json` 超 8 KB → 截断 + 标记 `_truncated: true`。
- **一句话收口目标**：✅ **prod severity≥warn 错误 100% 落 D1；TTL 14 天；写失败有 fallback。**

#### F5: `/debug/logs` 调试 endpoint

- **输入**：query: `trace_uuid?` `session_uuid?` `code?` `since?` `limit?(≤200)`。auth: 已登录 + team 边界（同 RH3 device gate）。
- **输出**：`FacadeSuccessEnvelope<{logs: ErrorLogRecord[], retention_days: 14}>`。
- **主要调用者**：前端开发者 dev mode；owner（手动）。
- **核心逻辑**：
  - 必须有 `trace_uuid` 或 `session_uuid` 之一（否则 400 `invalid-input`）。
  - team_uuid filter 强制 = 当前 caller team_uuid。
  - 未传 `since` 时默认 1h 内。
- **边界情况**：
  - 跨 team 查询 → 403 `tenant-mismatch`。
  - 无命中 → 返回空数组 + `retention_days`。
  - 速率限制：per-user 10 req/s。
- **一句话收口目标**：✅ **前端用 trace_uuid 一次 GET 即可拿到该请求 14 天内全部日志命中。**

#### F6: `Server-Timing` header

- **输入**：facade 入口测量 `auth_dur_ms` / `agent_dur_ms` / `total_dur_ms`。
- **输出**：响应头 `Server-Timing: total;dur=<n>, auth;dur=<m>, agent;dur=<x>`。
- **主要调用者**：orchestrator-core 所有 facade 出口（`/sessions/*` / `/me/*` / `/debug/*`）。
- **核心逻辑**：
  - 在 fetch handler 顶层 `t0 = Date.now()`；rpc 子调用前后取差；最后写头。
  - 子调用未发生时省略对应段（不写 0）。
- **边界情况**：
  - 浏览器 Network 面板要求 header 名小写不影响；保持 PascalCase（标准）。
  - 不暴露 D1/R2/AI 单子调用粒度（first-wave 边界）。
- **一句话收口目标**：✅ **facade 路径每条响应必有 `Server-Timing: total;dur=N` 至少一段；浏览器 Network 面板原生展示。**

#### F7: `session.stream.event::system.error` kind

- **输入**：agent-core kernel error 路径 / orchestrator-core facade error 路径（且 session 有 attached WS）。
- **输出**：WS 推送 `{kind:"system.error", code, severity:"error"|"critical", message, source_worker, trace_uuid}`。
- **主要调用者**：agent-core `runtime-mainline.ts` 错误归一点 / orchestrator-core `respondWithFacadeError` 时同时尝试 emit。
- **核心逻辑**：
  - schema 新增到 `packages/nacp-session/src/stream-event.ts` union；与 `system.notify` 并列。
  - emit 函数：worker-logger 暴露 `tryEmitSystemError(record)`；通过现有 `ORCHESTRATOR_CORE.forwardServerFrameToClient` 跨 worker 推。
  - 前端订阅时按 kind 分发。
- **边界情况**：
  - 无 attached WS → 不 emit（不报错）。
  - per-session dedupe by code，5 秒。
  - schema 校验失败 → 降级到 `system.notify (severity=error)`（兼容旧 client）。
- **一句话收口目标**：✅ **WS 通道有独立 `system.error` kind；agent-core kernel critical 错误必 emit；schema 单测通过；前端可以分别处理 notify / error 两路。**

#### F8: `emitObservabilityAlert()` critical alert

- **输入**：severity=critical 触发条件之一：D1 写失败 / RPC parity 失败 / R2 写失败。
- **输出**：写一条 `nano_error_log`（标记 `severity='critical'`）+ console `[CRITICAL]` 前缀 + 尝试 emit `system.error` (severity=critical)。
- **主要调用者**：worker-logger 内部 + 业务关键写路径（如 filesystem-core SessionFileStore.write 双写失败）。
- **核心逻辑**：
  - 统一封装到 worker-logger 包，外面只调用 `logger.critical(...)` 或 `emitObservabilityAlert(...)`。
  - first-wave 不实装 `metrics` / `traces` 字段（envelope 留位）。
- **边界情况**：
  - critical alert 自身写 D1 也失败 → console-only，不 retry，不 throw。
- **一句话收口目标**：✅ **3 类 critical 触发各有单测；每条 critical 至少落 console + D1 + WS（如有 session）三条线之一。**

#### F9: bash-core / orchestrator-auth 接 logger

- **输入**：bash 执行 / JWT 验证 / wechat code 交换 错误路径。
- **输出**：`logger.error('handler-error', {code, ctx})` + 走 F4 持久化。
- **主要调用者**：bash-core `executor.ts` / orchestrator-auth 鉴权失败路径。
- **核心逻辑**：
  - 替换现有 `throw new Error(...)` + 直接返回 RPC 错误为 logger.error + RPC 错误。
  - 不改 RPC 返回 schema（保持 `RpcErrorCode` 体系）。
- **边界情况**：
  - bash 成功路径不写日志（避免噪音）。
  - JWT 高频失败 → dedupe 5 秒。
- **一句话收口目标**：✅ **bash-core / orchestrator-auth `console.*` 在 prod 路径出现次数 ≥ 5；prod 错误可在 `nano_error_log` 查到。**

#### F10: 重复定义防漂移（ESLint）

- **输入**：`StorageError` / `ValueTooLargeError` / `evidence-emitters*.ts` / `metric-names.ts` 现有两份的 import 路径。
- **输出**：ESLint config 新增 `no-restricted-imports` 把"次份"路径标记为 error，并提示去用"主份"。
- **主要调用者**：CI / dev pre-commit。
- **核心逻辑**：first-wave 不删任一份代码，仅指定主份；新代码新写一律走主份。
- **边界情况**：现有代码两边都有 import → 一次性走 codemod 修；CI 红线。
- **一句话收口目标**：✅ **ESLint rule 落地；CI 在新增第三份重复实现时红；现有两份保持不动。**

### 7.3 非功能性要求与验证策略

- **性能目标**：
  - `nano_error_log` 写入 p95 < 50 ms（D1 同 region）。
  - `Server-Timing` header 注入额外开销 < 1 ms。
  - worker-logger 序列化（JSON.stringify）开销 < 0.5 ms（典型 ctx ≤ 4 KB）。
  - dedupe LRU 容量 256 条，命中率 > 80%（critical 风暴时）。
- **可观测性要求**：
  - 任何 severity ≥ warn 的错误：(a) console 一行 JSON；(b) 内存环形缓冲；(c) D1 持久化（如 orchestrator-core 可用）；(d) facade 响应 envelope 带 trace_uuid（如 HTTP 路径）；(e) WS `system.error` 推送（如 session attached 且 critical）。
  - 任何 severity = critical 的错误：(a)+(b)+(c) 必到 + console 前缀 `[CRITICAL]`。
- **稳定性要求**：
  - logger / D1 写失败不能让业务 path 失败（degrade silently）。
  - dedupe 命中不能误吞 critical（critical 不 dedupe）。
- **安全 / 权限要求**：
  - `/debug/logs` 强制 team 边界（复用 RH3 device gate）。
  - `Server-Timing` 仅暴露 facade 粗粒度时序，不暴露 D1/R2/AI sub-call。
  - error context 字段 first-wave 走纪律：caller 显式不写敏感字段（API key、JWT、WeChat code、密码、refresh token）。
- **测试覆盖要求**：
  - F1: ≥ 8 cases（4 级 × 有/无 ALS）+ dedupe + 序列化失败回退。
  - F2: 6 worker 各 ≥ 5 cases（各 worker fetch handler error path）。
  - F3: 文档存在性 + 行数 ≥ 80（每 code 一行）。
  - F4: ≥ 6 cases（写成功 / 写失败 fallback / dedupe / 速率限制 / TTL 清理 / context truncation）。
  - F5: ≥ 5 cases（trace_uuid 查 / session_uuid 查 / 跨 team 拒 / rate-limit / 空命中）。
  - F6: facade 出口随机 sample ≥ 5 个验证 `Server-Timing` 头存在。
  - F7: ≥ 5 cases（schema 校验 / 兼容降级 / dedupe / no-WS skip / 跨 worker forward）。
  - F8: 3 类触发各 ≥ 1 case + 自写 D1 失败回退。
  - F9: bash-core 错误路径 ≥ 3 cases，orchestrator-auth ≥ 3 cases 的 logger.error 触发验证。
  - F10: ESLint rule 单测（fixtures 触发 / 不触发）。
  - **总数估算**：≥ 60 unit cases + ≥ 6 live e2e（preview deploy 后 `/debug/logs` 链路 + WS `system.error` 推送）。
- **验证策略**：
  - unit：vitest cloudflare:workers，每个 F 独立 spec。
  - integration：preview deploy 后跑 `test/package-e2e/orchestrator-core/15-error-log-smoke.test.mjs`（人为触发一个 known error，验证 trace_uuid 链路 + `/debug/logs` 命中）。
  - 跨 worker：`test/cross-e2e/15-system-error-frame.test.mjs`（agent-core kernel error → 前端收到 system.error WS frame）。
  - 具体命令由 action-plan 写。

---

## 8. 可借鉴的代码位置清单

### 8.1 来自 mini-agent

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---|---|---|---|
| `context/mini-agent/**` | 简单 try/catch + console | "保持简单"的反例 | 提醒：first-wave 不要变成 mini-agent 风格 |

### 8.2 来自 codex

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---|---|---|---|
| `context/codex/codex-rs/log-db.rs` | SQLite 专用 logs 表 + batch insert + per-partition cap + 10 天 retention + 复杂查询（level/timestamp/module/file LIKE/thread/search/pagination） | 表结构思路、TTL 清理、按 module/file 索引 | 我们用 D1 替换 SQLite；查询入口 `/debug/logs` 比 codex 简单 |
| `context/codex/codex-rs/codex-client/src/telemetry.rs` | `RequestTelemetry` trait（attempt, status, error, duration） | "请求级 telemetry trait" 抽象 | 我们 first-wave 不做 trait；保留 seam |
| `context/codex/codex-rs/feedback/src/lib.rs` | 4 MiB 环形缓冲 + 分类（bug/bad_result/good_result/safety_check） | 内存环形缓冲思路 | 我们 worker-logger 内置 200 条/worker |
| W3C `traceparent` propagation via env var + JSON-RPC `trace` field | 跨进程 trace 标准化 | 留 W3C 兼容 seam | first-wave 不实装；保留 `x-trace-uuid` 自定义头 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---|---|---|---|
| `context/claude-code/utils/debug.ts` | `logForDebugging(message, {level})` 单一入口 | 单入口 + 5 级 + 环境变量过滤 | 我们简化为 4 级 + `NANO_LOG_LEVEL` env |
| `context/claude-code/utils/errorLogSink.ts` | JSONL 文件写 + 内存环形缓冲（最近 100） + `getInMemoryErrors()` 编程访问 | 内存环形缓冲 + 编程读取 API | 我们用 D1 替换 JSONL；环形缓冲容量 200 |
| `context/claude-code/utils/errors.ts:3-100` | `ClaudeError` 基类 + `TelemetrySafeError`（双消息：全量日志 + 安全遥测） | "TelemetrySafeError" 类型 | 我们 first-wave 走纪律；O6 |
| `context/claude-code/utils/telemetry/sessionTracing.ts` | OTel span 4 类 + `AsyncLocalStorage` 传播 | ALS 传播思路 | 我们用 ALS 注入 trace_uuid，不做 span 树 |

### 8.4 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---|---|---|---|
| `context/gemini-cli/packages/core/src/tools/tool-error.ts:14-83` | `ToolErrorType` enum 40+ + `isFatalToolError()` | 错误码按域分类 | 我们已有 7 个枚举分布，不再合并 |
| `context/gemini-cli/packages/core/src/utils/googleErrors.ts` | 12 种 RPC error detail 解析 + `toFriendlyError()` | 错误归一管道 | 我们 facade envelope 做归一 |
| `context/gemini-cli/packages/cli/src/utils/errors.ts:66-110` | `handleError()` / `handleToolError()` JSON / text 双输出 | 错误展示双形态 | 我们只保留 JSON envelope |

### 8.5 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---|---|---|
| `workers/orchestrator-core/src/policy/authority.ts:31-39` | `facadeError()` 已经在做 envelope + trace_uuid 头 | **借鉴**：F2 直接 re-export 这个签名 |
| `workers/agent-core/src/index.ts:135` | `{ error: "Not found" }` 裸 JSON | **避开**：F2 把它收口 |
| `workers/bash-core/src/index.ts:335,351,411` | `Method Not Allowed` 纯文本 | **避开**：F2 把它收口 |
| `workers/orchestrator-core/src/index.ts:1191` | `console.warn('models-d1-read-failed team=${teamUuid}', {...})` 半结构化 | **借鉴**：F1 把第一参数改为 string + 第二参数全结构化 |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts (usage-commit)` | `console.log` 业务事件走 dev-only 通道 | **避开**：F1 切成 `logger.info` |
| `workers/filesystem-core/src/storage/errors.ts` + `packages/storage-topology/src/errors.ts` | `StorageError` 重复定义 | **F10 防漂移**：ESLint rule，不删 |
| `workers/context-core/src/evidence-emitters-context.ts` + `packages/workspace-context-artifacts/src/evidence-emitters.ts` | evidence emitters 重复 | 同上 |
| `workers/agent-core/src/eval/metric-names.ts` + `packages/eval-observability/src/metric-names.ts` | metric names 重复 | 同上 |
| `workers/orchestrator-core/src/user-do/durable-truth.ts:212` | 已有 `system.notify` kind 检测做 promote 决策 | **借鉴**：F7 新增 `system.error` kind 时遵循同一 dispatch 风格 |
| `packages/nacp-core/src/messages/system.ts:16` | `SystemErrorBodySchema` 已定义但无 emit 路径 | F7 把它接电 |
| `packages/nacp-core/src/observability/envelope.ts` | `NacpObservabilityEnvelope` 0 emitter | F8 至少把 `alerts` 段接电 |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策

> 拟新增 5 题进入 `docs/design/real-to-hero/RHX-qna.md`（编号沿用最后一个 Q 之后追加；下面用 `Q-Obs1..Q-Obs5` 占位）。

| Q ID | 问题 | 影响范围 | 当前建议 | 状态 | 答复来源 |
|---|---|---|---|---|---|
| Q-Obs1 | `nano_error_log` 是否走 orchestrator-core 单写点（vs 6 worker 直接写 D1） | F4 / F8 / 跨租户边界 | **走 orchestrator-core 单写点**（§6.1 取舍 3） | open | RHX-qna 待回 |
| Q-Obs2 | D1 migration 编号：方案 A（012）vs 方案 B（抢 011，RH5 改 012） | F4 落地时点 | **方案 A** | open | RHX-qna 待回 |
| Q-Obs3 | `nano_error_log` TTL 14 天是否合适？是否需要按 severity 分层（warn 7d / error 14d / critical 90d） | F4 / 合规 | **first-wave 一刀切 14 天**；分层留到 hero-to-platform | open | RHX-qna 待回 |
| Q-Obs4 | `system.error` 是否新增 kind（vs 复用 `system.notify (severity=error)`）| F7 / 协议清洁度 / 前端 | **新增 kind**（§6.1 取舍 5） | open | RHX-qna 待回 |
| Q-Obs5 | `/debug/logs` 是否对 owner 全租户可见？ | F5 / 调试便利 vs 边界 | **first-wave 仅按 team 边界开放**；owner 跨租户用 wrangler tail / D1 直查 | open | RHX-qna 待回 |

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. Q-Obs1 ~ Q-Obs5 全部 owner 答复并落 `RHX-qna.md`。
2. F1–F10 每项的"一句话收口目标"已被 owner 确认无歧义。
3. §6.1 的 6 个核心 tradeoff 已被 owner 接受。
4. §3.5 D1 migration 编号方案确定（方案 A 或 B）。
5. 已确认 RHX2 与 RH5 / RH6 的并行/串行关系（§2.1 依赖关系无冲突）。
6. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：
  - 拟新建 `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`（在本设计 frozen 后）。
- **需要同步更新的设计文档**：
  - `docs/design/real-to-hero/RHX-qna.md`（追加 Q-Obs1..Q-Obs5）。
  - 不更新现有 RH0–RH6 设计文档；本簇横切但不回改既有产物。
- **需要进入 QNA register 的问题**：Q-Obs1 ~ Q-Obs5（见 9.1）。
- **不解锁的事**：RH5 / RH6 的 hard gate 不依赖 RHX2 完成（本簇是横切簇，可与 RH5 并行）。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像

> RHX2 是 nano-agent 的 **observability-and-audit 横切簇**，与 RH0–RH6 并列（不串联）。它的存在形态是 4 件组合：(a) 1 个共享 `worker-logger` 包；(b) 1 张 D1 表 `nano_error_log`；(c) 1 份 `docs/api/error-codes.md` 单一查询入口；(d) 协议层 `system.error` / `Server-Timing` / `obs envelope.alerts` 的 minimal emit。它覆盖 6 个 worker 的所有错误路径，并对 1 个新增 endpoint（`/debug/logs`）和 1 个新增 stream-event kind（`system.error`）负责。复杂度集中在两点：(1) `nano_error_log` 的写入治理（dedupe / rate-limit / fallback）避免错误风暴；(2) 6 worker 的 HTTP 入口收口到 `respondWithFacadeError()` 的 codemod 工程量。

### 10.2 Value Verdict

| 评估维度 | 评级 (1-5) | 一句话说明 |
|---|---|---|
| 对 nano-agent 核心定位的贴合度 | 5 | NACP 协议留的 log/error/obs 槽位本就是 nano-agent 想要的形态；这个簇把它从 schema-only 推进到 runtime |
| 第一版实现的性价比 | 5 | 只用 1 个新包 + 1 张 D1 表 + 1 份 docs + 1 个 endpoint 就能解决前端 80% 的 debug 痛点 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 4 | critical 告警 + 错误持久化让 RH5 / RH6 / hero-to-platform 都能复用；hook handler 全量接电仍待主线 |
| 对开发者自己的日用友好度 | 5 | 从"截屏 + wrangler tail"升级到"trace_uuid + /debug/logs + Server-Timing"；前端在 Network 面板原生看耗时 |
| 风险可控程度 | 4 | 主要风险（写入风暴、跨 worker cycle、跨租户泄漏）都有具体缓解；唯一 wild card 是 ESLint codemod 触及面广 |
| **综合价值** | **4.6** | 高价值横切簇；建议优先级 P0；first-wave 必做 S1–S10，不必硬塞 OTel 全套 |

---

## 附录

### A. 讨论记录摘要

- **分歧 1**：是否新增 `system.error` stream-event kind（vs 复用 `system.notify (severity=error)`）
  - **A 方观点**：复用 system.notify 减少协议表面
  - **B 方观点**：新增 kind 让前端按 kind 而不是 severity 分发，类型直觉更强
  - **最终共识**：新增 kind（§6.1 取舍 5），等 Q-Obs4 owner 确认
- **分歧 2**：错误持久化是否走 orchestrator-core 单写点
  - **A 方观点**：每个 worker 直接写 D1 减少 RPC 跳数
  - **B 方观点**：orchestrator-core 单写点强制走租户边界，避免跨租户泄漏
  - **最终共识**：单写点（§6.1 取舍 3），等 Q-Obs1 owner 确认
- **分歧 3**：是否合并 7 个错误码枚举为单一巨枚举
  - **A 方观点**：单一枚举语义统一
  - **B 方观点**：合并代价高且各枚举使用领域清晰，docs 汇总即可
  - **最终共识**：保留分布、文档汇总（§6.1 取舍 2）
- **分歧 4**：是否做 OTel SDK 完整接入
  - **A 方观点**：一步到位
  - **B 方观点**：first-wave 用 D1 + 共享 logger 解决 80% 痛点；OTel 留 seam
  - **最终共识**：留 seam 不接（§6.1 取舍 1）

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-29 | Owner + Opus 4.7 (1M) | 初稿；基于 Opus / DeepSeek 双 audit 提炼 F1–F10 + 6 大 tradeoff + Q-Obs1–5 |
