# Nano-Agent 功能簇设计

> 功能簇: `RHX2 Observability & Auditability — 日志、报错、审计、可观测性强化簇`
> 讨论日期: `2026-04-29`（v0.1）→ `2026-04-29`（v0.2 吸收 DeepSeek + GLM 审查）→ `2026-04-29`（v0.3 吸收 GPT 审查 + migration baseline 事实校正）
> 讨论者: `Owner + Opus 4.7 (1M)`
> 关联调查报告:
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-opus.md`
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md`
> 关联审查报告:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability-reviewed-by-deepseek.md`（changes-requested；R1/R2/R3 + S1–S5）
> - `docs/design/real-to-hero/RHX2-observability-and-auditability-reviewed-by-GLM.md`（approve-with-follow-ups；R1–R12）
> - `docs/design/real-to-hero/RHX2-observability-and-auditability-reviewed-by-GPT.md`（changes-requested；R1/R2 是 blocker，R3/R4 follow-up）
> 关联 QNA / 决策登记:
> - `docs/design/real-to-hero/RHX-qna.md`（v0.3 累计新增 Q-Obs1 ~ Q-Obs12）
> 文档状态: `frozen-v0.5`（owner 已授权 frozen；F1–F15 全部 in-scope；Q-Obs1–Q-Obs14 已 owner-answered；解锁 action-plan 执行入口 `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3，按 owner 授权 Path B（Phase 组）推进，Phase 1 已开始）
>
> 命名说明：本文件取 `RHX2` 前缀（与 `RHX-qna.md` 同一附加章节坐标系），用于把"观测/审计"作为 RH 主线 RH0–RH6 之外的 **横切簇** 单独立项；它对所有 phase 都生效，但不绑定特定 phase 的 hard gate。

---

## 0. 背景与前置约束

> 本设计被两件事推到台前：
> 1. RH4 已经收口，前端组装阶段开始；前端只能拿到 `x-trace-uuid` 一项可观测性，debug 强依赖 owner 截屏 + `wrangler tail` 反查。
> 2. 两份独立 audit（Opus / DeepSeek）从不同切面同时给出"协议骨架已铺、运行时大面积真空"的结论；继续推进后续 RH5/RH6 之前，必须先把这条隐性债务作为一个独立功能簇立项。
>
> **本设计不再讨论的事**：是否需要做可观测性、是否引入 NACP 协议、是否保留 6-worker 拓扑。这些都已经在 charter 与既有 design 中冻结。

- **项目定位回顾**：nano-agent 是"6-worker on Cloudflare + NACP 协议"的 agent 平台；real-to-hero 阶段的核心目标是把骨架做成可被前端使用的真实产品面。
- **本次讨论的前置共识**：
  - 已冻结：6 worker 拓扑、NACP 协议族（nacp-core / nacp-session / 错误注册表 / 观测 envelope / evidence 四流）、`x-trace-uuid` 全链路头透传、`facadeError` envelope schema。
  - 已冻结：6/6 worker `wrangler.jsonc` 都已开 Cloudflare `observability.enabled = true`（Workers Logs 入云）。
  - 已冻结：`session.stream.event` 9 种 kind 与 `system.notify` / `compact.notify` / `tool.call.result` 三种语义；`system.notify` 在 agent-core kernel 错误路径已 emit。
  - 已落地：23 + 22 + 13 + 6 + 8 + 8 共 **80 个 enum-backed error code**（NACP / Rpc / Auth / Kernel / Session / LLM）；外加 bash-core 5–8 个 ad-hoc 字符串 code（统计来源：DeepSeek audit + GLM 附录 A.2，实际 ~87–90 个待 F3 归化后定数）。
  - 已落地：`x-trace-uuid` 在 orchestrator-core / agent-core 是源头与校验点，跨 worker RPC 在 `RpcMeta.trace_uuid` 上传播。
  - **新发现并接受（v0.3 / GPT R4）**：`nano_session_activity_logs` 表已存在于 `workers/orchestrator-core/migrations/002-session-truth-and-audit.sql`，`session-truth.ts:667 appendActivity()` 已实装，承接 **session-scoped、按 `event_seq` 排序的时间线真相**（含 `severity` info/warn/error、`payload ≤ 8KB`、`UNIQUE(trace_uuid, event_seq)`）。本簇 first-wave 不动它，但必须明确它与新增的 `nano_error_log` / `nano_audit_log` 的职责边界（详见 §3.6）。
  - **新发现并接受（v0.3 / GPT R1）**：`clients/web/src/apis/transport.ts:50-57` 与 `clients/wechat-miniprogram/utils/nano-client.js:11-28` 各自手搓 `auth.expired / quota.exceeded / runtime.error / request.error` 4 类客户端错误分类（互不引用）。本簇 first-wave 必须把这两端的分类逻辑收口到一份 client-safe 元数据出口（详见 F12）。
  - **新发现并接受（v0.3 / GPT R2）**：`clients/web/src/pages/ChatPage.tsx` 与 `clients/wechat-miniprogram/pages/session/index.js` 当前对 WS frame 都只显式处理 `llm.delta` / `tool.call.*` / `turn.*` / `system.notify` / `session.update`，**没有任何 `system.error` 处理路径**（grep 0 命中）。本簇 first-wave 若仅在 server 侧 emit `system.error` 而不补 client，等于把所有 system.error 落到"unknown kind"占位（详见 F13）。
  - **新发现并接受**：`NacpErrorSchema`（`packages/nacp-core/src/error-registry.ts`）已原生含 `{code, category, message, detail?, retryable}` 五字段，其中 `category` 为 7 类枚举（`validation / transient / dependency / permanent / security / quota / conflict`）—— **本设计无需另建 category 系统，只需把它接电**。
  - **新发现并接受**：`audit.record` NACP message type 已注册（`packages/nacp-core/src/messages/system.ts:20`），body schema = `{event_kind, ref?, detail?}`，agent-core hook 路径已用它（`workers/agent-core/test/hooks/audit.test.ts`）。**本设计将其作为 audit-log 通道的 first-class 协议载体**，与 error-log 通道平行。
  - **新发现并接受**：`SystemErrorBodySchema` 实际形态是 `{error: NacpErrorSchema, context?: Record<string,unknown>}`（不是 v0.1 设想的平面 schema）；本 v0.2 把 F7 改为复用 `NacpErrorSchema` + 在 `nacp-session/stream-event.ts` 新增 `SystemErrorEventBodySchema` wrapper（详见 §7.2 F7）。
  - **不再讨论**：是否替换 NACP / 是否换 Cloudflare 平台 / 是否引入第三方 telemetry 厂商作为依赖（OTLP 兼容是设计目标，不是依赖）。
- **本设计必须回答的问题**：
  - **D1**：协议层留出来的 `system.error` / `audit.record` / `NacpObservabilityEnvelope` / `NacpErrorBodySchema` / `Evidence 四流` / `metric-names`，哪些 first-wave 必须接电、哪些可以继续保持 schema-only？
  - **D2**：6 个 worker 的应用层日志要不要统一抽象（结构化 logger）？走什么 sink？前端如何取？
  - **D3**：错误体系的两套坐标系（`FacadeErrorCode` 32 + `NACP_*` 23 + 其他 5 套子枚举 + bash-core ad-hoc）如何在 first-wave 收敛？是否做 **运行时可查的 registry**？
  - **D4**：错误是否需要持久化到 D1？保留多久？谁可以查？前端能查吗？**审计日志（audit-log）是不是同一张表？**
  - **D5**：`x-trace-uuid` 之外，前端单请求级别还能拿到什么（`Server-Timing` / 子调用清单 / 上游 worker 标记）？
  - **D6**：bash-core / orchestrator-auth 这两个 prod 路径 0 console 的 worker，是必须补、还是接受这种"throw-only"？
  - **D7**（v0.2 新增）：HTTP `FacadeErrorEnvelope` 与 WS `system.error` 是两条通道，**同一错误同时走两条时**前端如何去重？
  - **D8**（v0.2 新增）：错误日志单写点 orchestrator-core 自身不可用时如何 fallback？
  - **D9**（v0.3 新增；GPT R1/R2）：`resolveErrorMeta()` 与 `system.error` 的 **client 真实消费面** 怎么落？只把 server 接电而不补 web / 微信小程序 client，是否等于"server 单边自嗨"？
  - **D10**（v0.3 新增；GPT R4）：`nano_session_activity_logs`（migration 002 已存在）/ `nano_error_log`（本簇新增）/ `nano_audit_log`（本簇新增）三套 durable 记录，职责边界如何明确划分？
  - **D11**（v0.5 新增；owner 否决 v0.4 carry-over 判断）：3 个 published 包（`@haimang/nacp-core` / `@haimang/nacp-session` / `@haimang/jwt-shared`）的"包来源单一真相"原则如何在本簇 first-wave 落地？deploy 进 worker bundle 的代码，到底是从 GitHub Packages 拉的还是从 workspace symlink 解析的？版本号是什么？发布时间是什么？这些事实必须可在 owner 与前端侧 **机器可验证**，否则未来任何故障复盘都没有真相源。
  - **D12**（v0.5 新增）：v0.4 的 "jwt-shared 未发布 = RHX3 carry-over" 判断本身是错误的——它把 critical 门禁认知错误降级为可推迟项。owner 立场：本簇 first-wave 必须解决这个事实-意图差距（要么发布、要么显式声明 workspace-only 不模糊）。本设计 v0.5 重新把 jwt-shared 正式发布列为 RHX2 in-scope 必做项。
- **显式排除的讨论范围**：
  - 用户面 telemetry / 产品分析（不是 GrowthBook、不是 Statsig；first-wave 不做 user-level metrics）。
  - PII 自动脱敏框架（first-wave 走"不写敏感字段"的人工纪律，自动脱敏延后）。
  - 第三方 APM（Sentry / Honeycomb / Datadog）—— 不依赖；OTLP-兼容是设计目标，是否真启用第三方延后。
  - Cloudflare Logpush / 跨账户日志聚合（运维项，不是 design 项）。
  - admin / billing 维度的 audit（属 hero-to-platform 阶段；本簇 first-wave 仅承接"hook outcome / device gate decision / cross-tenant deny"等 *protocol-level* audit 事件，不承接 billing audit）。

---

## 1. 讨论对象

### 1.1 功能簇定义

- **名称**：`RHX2 Observability & Auditability`
- **一句话定义**：把 NACP 协议预留的 log / error / audit / observability / evidence 槽位 **从 schema-only 推进到 runtime-wired**，让 6 个 worker 的运行时行为可被开发者、前端、与未来运维三类受众用统一坐标系定位与回溯。
- **边界描述**：
  - **包含**：(a) 统一的 worker 端结构化 logger 抽象；(b) 错误码体系收敛（**运行时 `resolveErrorMeta()` registry** + 单一 docs 查询入口 + `FacadeErrorEnvelope` 推广至非 orchestrator-core 的 HTTP 入口）；(c) 错误持久化最小集（D1 `nano_error_log` 表）；(d) **审计持久化最小集（D1 `nano_audit_log` 表 + NACP `audit.record` channel）**；(e) `system.error` / `system.notify` / `Server-Timing` 三类前端可消费通道接电；(f) `NacpObservabilityEnvelope.alerts` 最小 emitter（仅 critical 类）；(g) 单请求级 trace（`x-trace-uuid` + 子调用层级标记）；(h) 重复定义的 ESLint 防漂移（不删代码）。
  - **不包含**：完整 OTel SDK 接入、metric histograms 全量启用、session-replay、UI 端 telemetry、第三方 APM、Cloudflare Logpush 配置、PII 自动脱敏、billing/admin audit、删除重复实现。
- **关键术语对齐**（必填）：

| 术语 | 定义 | 备注 |
|---|---|---|
| `worker logger` | 共享 npm 包 `@haimang/worker-logger` 导出 `createLogger(workerName)` → `{ debug, info, warn, error, critical }`，每条日志自动注入 `worker_name`、`trace_uuid`（如果 ALS 有）、`session_uuid`、`team_uuid`；底层是 console，但格式标准化为 JSON 一行；构造时可注入 `LogPersistFn` 与 `AuditPersistFn`。 | 不是 pino / winston；要在 Cloudflare Workers + DO 双 runtime 跑 |
| `LogPersistFn` | 类型签名：`(record: LogRecord, ctx?: ExecutionContext) => Promise<void> \| void`，由 caller 注入；first-wave 由 orchestrator-core 注入"调 RPC 写 D1"，其他 worker 注入"经 ORCHESTRATOR_CORE binding 远程写"。借鉴自 `context/smind-contexter/core/log.ts:36-41`。 | 解耦 logger 格式 vs 持久化目的地 |
| `AuditPersistFn` | 同上，但写入 `nano_audit_log` 表，载体为 NACP `audit.record` body。 | 与 LogPersistFn 解耦但形态相同 |
| `error envelope` | 即 `FacadeErrorEnvelope`：`{ ok:false, error:{code,status,message,details?}, trace_uuid }`。本设计要求 6 个 HTTP 入口都用这套。 | 与 nano-agent 现有 `facade-http.ts:137` 一致；与 sibling 项目 smind-admin 的 `{ok,error:{code,category,...}}` 不同（详见 §5.3 边界）。 |
| `error registry` | (a) 编译期：`packages/nacp-core/src/error-registry.ts` 已有 `NacpErrorDefinition` + `registerErrorDefinition()` + `resolveErrorDefinition()` API（19 NACP codes 已注册）；(b) **本簇扩展**：把 `FacadeErrorCode` / `AuthErrorCode` / `KernelErrorCode` / `SessionErrorCode` / `LLMErrorCategory` 共 ~70 个补注册进去；(c) 暴露 `resolveErrorMeta(code) → ErrorMeta` 单一查询入口。 | 借鉴 smcp `error_registry.test.ts` 的运行时 registry 形态 |
| `error catalog docs` | `docs/api/error-codes.md` 是 **人类可读** 镜像；运行时 truth 是 (b)；docs 在 CI 由 npm script 从 registry 反射生成（first-wave 手工对齐 + 测试断言一致性）。 | 不再是"代码与文档分裂"的两份真相 |
| `NacpErrorSchema` 7 类 category | `validation / transient / dependency / permanent / security / quota / conflict`（已存在 `error-registry.ts:5-13`）。 | 与 sibling 项目 smind-admin 的 7 类完全一致 — 已是事实标准 |
| `system.error frame` | 在 `packages/nacp-session/src/stream-event.ts` 新增 `SystemErrorEventBodySchema = {kind:"system.error", error: NacpErrorSchema, source_worker?, trace_uuid?}`；与现有 `nacp-core/messages/system.ts` 的 `SystemErrorBodySchema` **平行而非替代**。 | 详见 §7.2 F7 + §7.2.5 |
| `audit.record` | NACP message type，body = `{event_kind, ref?, detail?}`（已存在 `messages/system.ts:10`）；本簇把它落 D1 `nano_audit_log`。 | 与 error log 通道正交：error 是"出错了"，audit 是"重要事件发生了"（含正常事件） |
| `error log` | D1 表 `nano_error_log` 持久化 severity≥warn 的错误；TTL 14 天；详细 DDL 见 §7.2 F4。 | 与 audit log 不同表 |
| `audit log` | D1 表 `nano_audit_log` 持久化 protocol-level 事件（hook outcome / device gate decision / cross-tenant deny / API key revoke / quota exceeded 等）；TTL 90 天；详细 DDL 见 §7.2 F11。 | 比 error log 长 retention，因为 audit 用于回溯安全/合规 |
| `Server-Timing` | HTTP 响应头，浏览器 Network 面板原生展示；本簇仅在 orchestrator-core HTTP facade 出口注入 `auth;dur=X, agent;dur=Y, total;dur=Z`。 | first-wave 不覆盖 agent-core 直连场景 |
| `obs envelope` | `NacpObservabilityEnvelope`（`packages/nacp-core/src/observability/envelope.ts`）— `{ source_worker, source_role, alerts, metrics, traces }`；first-wave 仅 emit `alerts`（severity=critical）；序列化时 `metrics`/`traces` 为空对象时不写入 JSON。 | metrics/traces 留 seam |
| `team gate` | 鉴权层："请求者 team_uuid = 查询条件 team_uuid"；与 RH3 device gate（设备 token）**不同层次**。本簇 `/debug/logs` / `/debug/audit` 用 team gate，**不**用 device gate。 | v0.1 的"复用 RH3 device gate"措辞错误，v0.2 已修正 |
| `client error meta`（v0.3 新增；v0.4 修订形态）| 与 `resolveErrorMeta()` 同源的元数据，但以 client 安全的形态导出：仅含 `code / category / http_status / retryable` 4 列，**不含** server-only 的 `source` / 长 message。**v0.4 形态**：`@haimang/nacp-core/error-codes-client` 子路径导出（候选 a' 已 Q-Obs10 owner-answered）；候选 b（`error-codes.json`）+ 候选 c（`GET /catalog/error-codes`）保留为 future fallback。 | 解决 GPT R1 + 与 owner 长期"3 个 published 包"策略一致 |
| `nano_session_activity_logs`（v0.3 已存在事实登记） | 已存在表（migration 002）。承接 **session-scoped 时间线**：`{activity_uuid PK, session_uuid, turn_uuid, trace_uuid, event_seq, event_kind, severity, payload, created_at}`；`UNIQUE(trace_uuid, event_seq)`；payload ≤ 8KB。本簇不修改它。 | 与本簇新增的 `nano_error_log`（cross-trace error 索引）+ `nano_audit_log`（protocol/security audit）形成"三套真相"，需要 §3.6 划清边界 |
| `package source-of-truth gate`（v0.5 新增；D11/D12） | 部署链路上的硬门禁：deploy 一个 worker 前必须确认 (a) 3 个 published 包（`nacp-core` / `nacp-session` / `jwt-shared`）都在 GitHub Packages 上有对应 published 版本；(b) workspace 内的 `packages/<name>/package.json` version 与 GitHub Packages 上的 latest version 完全一致；(c) build 时 esbuild bundle 进 worker 的代码可被反向追溯到哪个 published 版本。任何 (a)/(b)/(c) 不成立的 deploy 必须 **fail**。 | 解决 D11 / D12；保证 owner 与前端在出现问题时可拿到唯一真相 |
| `built-package-manifest`（v0.5 新增） | build 时由门禁脚本生成的 JSON 文件，inline 进每个 worker bundle；包含 3 个 published 包的 `{workspace_version, registry_version, registry_published_at, match: bool, resolved_from: "github-packages"\|"workspace-symlink"}` 与 build 时间戳。worker 的 `/debug/packages` 端点直接 serve 这份 manifest + 实时 GitHub Packages 查询。 | 让"deploy 时刻 worker 内打的是什么版本"成为机器可读事实，而不是猜测 |
| `/debug/packages`（v0.5 新增） | orchestrator-core HTTP endpoint。返回该 worker bundle 的 `built-package-manifest` + 实时拉 GitHub Packages 查询的 latest version & publish time + drift 标记。team gate 与 `/debug/logs` 一致。 | 前端 / owner 在故障复盘时，一次 GET 拿到三件事实：当前线上版本、deploy 进这个 worker 的版本、二者是否一致 |

### 1.2 参考调查报告

- `docs/eval/real-to-hero/audit-and-reporting-study-by-opus.md` — §1（用户三问的直接回答）、§2（协议留白 vs 代码缺位）、§4（盲点/断点/逻辑错误/认知混乱）。
- `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md` — §2（console 分布）、§3（用户三问）、§4（B1–B4 / P1–P7 / E1–E6）、§6（80 codes 速查表）。
- `docs/design/real-to-hero/RHX2-observability-and-auditability-reviewed-by-deepseek.md` — R1（runtime registry）/ R2（LogPersistFn 类型）/ R3（category 7 类）/ S1–S5。
- `docs/design/real-to-hero/RHX2-observability-and-auditability-reviewed-by-GLM.md` — R1（F2×F7 交叉）/ R2（service binding 事实）/ R3（单写点 fallback）/ R4–R12。
- 协议层源：`packages/nacp-core/src/{error-registry,error-body,observability/envelope,evidence/vocabulary,messages/system,state-machine,type-direction-matrix}.ts`、`packages/nacp-session/src/{stream-event,messages/system}.ts`、`packages/orchestrator-auth-contract/src/facade-http.ts:48-179`。
- Sibling 项目（v0.2 新增）：`context/smind-contexter/core/{log,errors,db_d1}.ts`、`context/smind-admin/src/infra/{logger,errors}.ts` + `src/http/{response,middleware.auth,middleware.team}.ts`、`context/smcp/tests/error_registry.test.ts`、`context/wbca-mini/miniprogram/utils/api.js`。
- **本仓库 client + RHX1 SSOT 事实（v0.3 新增）**：`workers/orchestrator-core/migrations/{001-005}.sql`（当前真实 baseline）、`workers/orchestrator-core/src/session-truth.ts:667 appendActivity()`、`workers/orchestrator-core/src/user-do/{ws-runtime.ts:75,226 (session.attachment.superseded), surface-runtime.ts:186 (replay_lost)}`、`clients/web/src/apis/transport.ts:50-57`、`clients/web/src/pages/ChatPage.tsx`、`clients/wechat-miniprogram/utils/nano-client.js:11-28`、`clients/wechat-miniprogram/pages/session/index.js:123-155`。

---

## 2. 在 nano-agent 中的定位

### 2.1 角色

- 在整体架构里扮演 **横切（cross-cutting）功能簇**：不属于 RH0–RH6 任何单一 phase；服务对象是"所有 phase 的开发者 + 多类前端 + 后续运维 + 评测/replay"。
- **服务于（v0.2 扩展受众；v0.3 进一步把 client 真实代码事实纳入）**：
  - **Web 前端开发者**（`clients/web/`，真实存在）：HTTP `FacadeErrorEnvelope` + `Server-Timing` 头 + `/debug/logs` 调试 endpoint + WS `system.error` kind（4 项全部可用）。**当前 `clients/web/src/apis/transport.ts:50-57` 在手搓 4 类错误分类**，本簇通过 F12 共享 client error meta 收口。
  - **微信小程序 / 受限 JS 环境前端**（`clients/wechat-miniprogram/`，真实存在）：仅 `FacadeErrorEnvelope` + WS `system.error` kind（2 项可用；`Server-Timing` 因 `wx.request` 不暴露响应头无效；`/debug/logs` 因 production 环境不暴露）。**当前 `clients/wechat-miniprogram/utils/nano-client.js:11-28 classifyError()` 也在手搓同一套 4 类分类**，与 web 端各自一份。F2 + F7 + **F12** + **F13** 是跨前端共同依赖；F5 + F6 是 web-only 增益。
  - **Worker 开发者**：统一 logger，避免每个 worker 自创风格。
  - **评测 / replay**：让 evidence 四流真实写出，而不是仅在 eval test 路径触发。
  - **未来运维**：给 `NacpObservabilityEnvelope.alerts` 留出 critical 告警的真出口；`nano_audit_log` 给跨租户/安全事件留回溯。
- 它依赖：已冻结的 NACP 协议族 schema（不动）、已冻结的 `x-trace-uuid` 头透传（不动）、D1 已存在的 schema 演进规则（charter §8.4）。
- 它被谁依赖：前端组装阶段（直接受益）、RH5（多模型/多模态/reasoning，前端必须能区分错误）、RH6（DO megafile decomposition，拆分前先有可定位）、后续 hero-to-platform 阶段的 admin/billing audit。

### 2.2 与其他功能簇的交互矩阵

| 相邻功能簇 | 交互方向 | 耦合强度 | 说明 |
|---|---|---|---|
| RH0 bug-fix-and-prep | RHX2 → RH0 | 弱 | RH0 已冻结；RHX2 不回改 RH0 产物，仅复用 `x-trace-uuid` |
| RH1 Lane F live runtime | RH1 → RHX2 | 中 | `system.notify` 通道 RH1 已建；本簇在它旁边补 `system.error` |
| RH2 LLM delta + Models inspection | RH2 ↔ RHX2 | 弱 | LLM error 走 `LLMErrorCategory` 8 类，本簇收口到 facade envelope |
| RH3 Device + API key | RH3 ↔ RHX2 | 中 | `AuthErrorCode` 13 类已规范；本簇 audit 通道承接 device gate 决策事件 |
| RH4 Filesystem R2 | RH4 ↔ RHX2 | 中 | 文件错误进入 facade envelope；R2/D1 写失败发 critical alert |
| RH5 Multi-model multimodal | RH5 ← RHX2 | 强 | RH5 前端必须能区分"模型不支持"与"配额超限"，强依赖错误码统一 |
| RH6 DO megafile decomposition | RH6 ← RHX2 | 强 | 拆分前先有错误持久化，避免拆完出问题"看不到现场" |
| RHX-qna | RHX2 → RHX-qna | 中 | 拟新增 Q-Obs1..Q-Obs9（v0.2 由 5 增至 9） |

### 2.3 一句话定位陈述

> "在 nano-agent 里，**RHX2 Observability & Auditability** 是 **横切功能簇**，负责 **把 NACP 协议层已经预留的 log / error / audit / observability 槽位接到 6-worker 的 prod 运行时**，对上游提供 **跨前端形态可消费的统一错误形态、单请求时序、可查询的错误持久化、独立的 audit-log 回溯通道**，对下游要求 **6 个 worker 的 HTTP 入口与应用层日志统一改走共享 logger 与 facade envelope，并在 wrangler.jsonc 上补齐 ORCHESTRATOR_CORE 跨 worker binding**。"

---

## 3. 架构稳定性与未来扩展策略

> 本节锁定 boundary 与可扩展 seam，不写执行任务。

### 3.1 精简点（哪里可以砍）

| 被砍项 | 参考来源 | 砍的理由 | 未来是否可能回补 |
|---|---|---|---|
| 第三方 APM 直连 | Opus audit §6 R5 | first-wave 不引入第三方依赖；OTLP-shape 已经够 | 任何时候用 OTLP collector 转发即可 |
| 客户端 telemetry / UX 分析 | DeepSeek §1.3 Gemini ClearcutLogger | nano-agent 是 backend，前端 telemetry 由前端项目自己决定 | hero-to-platform |
| 自动 PII 脱敏 | Opus §1.2 / DeepSeek §1.1 | 复杂度高 + first-wave message/context 字段可控；先靠"不写敏感字段"纪律 | message/context 进入用户输入回显时回补 |
| histogram metrics 全量启用 | DeepSeek §3.5 | 11 个 metric name 中只有少数是 first-wave 必需；先做 counter，histogram 留 seam | RH5/RH6 评测阶段 |
| `evidence-emitters` 业务持久化 | Opus §2.5 / DeepSeek §3.3 | first-wave 让 evidence 走 in-memory eval sink + 前端不感知 | 评测平台需要长 retention 时 |
| Hook handler 注册表全量接电 | DeepSeek §3.4 P5 | 是 RH5/RH6 的 scope；本簇只把"hook 错误 + hook outcome"喂到 logger / audit | RH5/RH6 |
| 重复定义代码合并 | DeepSeek §4.3 E1–E3 / GLM R11 | first-wave 只合并文档 + ESLint 防漂移，不动代码 | 单独 cleanup phase |
| WS 端 `delivery_kind:"log"` 新 message type | Opus §4.2 D5 | 现有 `system.notify` + `system.error` + `audit.record` 三通道已够 | 当未来要做"前端 dev mode 实时看 server log"再开新 kind |
| Server-Timing 覆盖 agent-core 直连 | GLM R7 | first-wave 仅 orchestrator-core HTTP 出口 | RH6 后或 OTel span 上线时 |
| `NacpErrorBodySchema` 在所有 verb 启用 | error-body.ts 注释 | `NACP_ERROR_BODY_VERBS` first-wave 保持空集；`system.error` 仍走 `SystemErrorBodySchema` | per-verb 错误体迁移单独 RFC |

### 3.2 接口保留点（哪里要留扩展空间）

| 扩展点 | 表现形式 | 第一版行为 | 未来演进方向 |
|---|---|---|---|
| `createLogger(workerName, opts)` | **v0.4 修订**：`packages/nacp-core/src/observability/logger/index.ts` 导出，通过 `@haimang/nacp-core/logger` 子路径 import；导出 `createLogger`、`Logger` interface（`debug/info/warn/error/critical`）、`withTraceContext()` ALS helper、`LogPersistFn`/`AuditPersistFn` 类型 | 底层走 `console.{log,warn,error}`，每条 JSON 一行：`{ts,level,worker,trace_uuid?,session_uuid?,team_uuid?,msg,code?,category?,ctx?}` | 切换底层为 OTel `LogRecord` exporter；无需改 caller |
| `LogPersistFn` 类型 | `type LogPersistFn = (record: LogRecord, ctx?: ExecutionContext) => Promise<void> \| void` | first-wave: orchestrator-core 注入"本地 D1 写"；其他 worker 注入"经 ORCHESTRATOR_CORE RPC 转发" | 切换为 OTLP exporter / R2 batch upload |
| `AuditPersistFn` 类型 | 同上，但 record = NACP `AuditRecordBody`；写 `nano_audit_log` | first-wave 同 LogPersistFn 路径 | 同上 |
| `resolveErrorMeta(code: string): ErrorMeta \| undefined` | `packages/nacp-core/src/error-registry.ts` 扩展 | 编译期生成的统一错误元数据查询；返回 `{source, code, category, http_status, retryable, message}`；80 codes 全覆盖 | 改为 npm script 从 7 个 zod enum 反射自动生成 |
| `system.error` stream-event kind | `packages/nacp-session/src/stream-event.ts` 新增 `SystemErrorEventBodySchema = {kind:"system.error", error: NacpErrorSchema, source_worker?, trace_uuid?}` | agent-core / orchestrator-core 在 critical 错误时通过 `emitServerFrame` 推；与 `system.notify` 平行 | 加 `cause`、`retry_hint` 等字段 |
| `audit.record` 落地通道 | 现有 NACP `audit.record` body schema + 本簇补 `recordAuditEvent(event_kind, ref?, detail?)` helper | 写 D1 `nano_audit_log`；first-wave 承接 8 类 event_kind（详见 F11） | 加更多 event_kind；接 hero-to-platform 的 admin audit |
| `Server-Timing` header | facade response 在 `policy/authority.ts` 加 `attachServerTimings(response, timings)` | 仅写 `total;dur=N` + `auth;dur=M` + `agent;dur=X` 三段；不传播跨 worker | 加 `bash;dur=Y`、`fs;dur=Z`、子调用 trace |
| D1 `nano_error_log` + `nano_audit_log` 表 | migration `006-error-and-audit-log.sql`（承接 RHX1 DDL SSOT 后的 next slot；编号方案见 §3.5） | error TTL 14 天；audit TTL 90 天；alarm/cron 清理 | 加索引 / 接管更多 event |
| `obs envelope` emitter | `emitObservabilityAlert(scope, severity, code, message, ctx?)` helper | 仅 severity=critical 落地：写一份到 `nano_error_log`（`severity='critical'`）+ console `[CRITICAL]` 前缀 | 加 metrics / traces 字段聚合 + 真实 OTLP collector |
| `docs/api/error-codes.md` | 1 份 markdown + 1 个 npm script 校验与 registry 一致性 | first-wave 手工汇总 + CI 测试 | npm script 自动生成 |
| `withTraceContext()` ALS helper | worker-logger 导出 | 在 fetch handler 顶层 `wrap(...)` 一次；DO `fetch` 顶层也 wrap | 加 span hierarchy（claude-code 风格） |

### 3.3 完全解耦点（哪里必须独立）

- **解耦对象 1**：`worker-logger` 共享 npm 包必须独立于任何 worker 业务包。
  - **原因**：6 worker 都依赖；如果挂在某个 worker 子目录，其他 worker 引用会形成 cycle 风险（charter §10.3 NOT-成功退出 #2 cycle 红线）。
  - **依赖边界**：仅依赖 `nacp-core`（用 `NacpErrorSchema` + `NacpObservabilityEnvelope` schema）；**不能依赖** `nacp-session` / `orchestrator-auth-contract` / 任何 worker。

- **解耦对象 2（v0.2 修正：事实校正）**：`nano_error_log` / `nano_audit_log` D1 表的写入路径必须只走 orchestrator-core。
  - **原因**：6 worker 中只有 orchestrator-core 是 client-facing facade，写日志 / 审计需要 team / session 边界已校验过。其他 worker 写 D1 会绕过租户边界。
  - **依赖边界（v0.1 事实错误已修正）**：
    - **agent-core** 已有 `ORCHESTRATOR_CORE` service binding（`workers/agent-core/wrangler.jsonc:49`）—— 可直接调用 `OrchestratorCoreEntrypoint.recordErrorLog(record)` / `recordAuditEvent(record)` RPC。
    - **bash-core / context-core / filesystem-core** 当前 wrangler.jsonc **没有 `services` 块**，**需要本簇 first-wave 新增** `ORCHESTRATOR_CORE` service binding（preview + production 两个 env 都要）。
    - **orchestrator-auth** 只通过 `AUTH_DEPENDENCY` 被 orchestrator-core 调用，反向 binding 不需要；其错误由 orchestrator-core 在 `facadeFromAuthEnvelope()` 包装时同点写入。
  - **影响 action-plan 工作量**：v0.1 低估为"复用现有 binding"，v0.2 修正为"3 个 wrangler.jsonc × 2 个 env = 6 个 binding 块新增 + preview deploy 验证"。

- **解耦对象 3**：`docs/api/error-codes.md` 必须独立于 charter / design / action-plan。
  - **原因**：前端会高频读它；放在 design 里会造成"读到 frozen 的设计文档去查 prod 错误码"的语义错位。
  - **依赖边界**：`docs/api/` 是新目录（如不存在则建）；该 docs 只反映"代码事实"，不引用 design 文档；CI 测试断言 docs 与 `resolveErrorMeta()` registry 一致。

- **解耦对象 4（v0.2 新增）**：`nano_error_log` 与 `nano_audit_log` 是 **两张表**，不合并。
  - **原因**：error log 是"出错了"（severity≥warn，TTL 14 天，可被前端 dev 自查）；audit log 是"重要事件发生了"（含正常事件如 device login / API key issue / cross-tenant deny attempt，TTL 90 天，仅 owner 与未来 admin 可查）。语义、retention、查询权限均不同。
  - **依赖边界**：两张表结构相似但字段不重合；统一在 `migration 006-error-and-audit-log.sql` 中创建。

- **解耦对象 5（v0.3 新增；GPT R1）**：**client-safe error meta 出口** 必须独立于 server `worker-logger` 包。
  - **原因**：`worker-logger` 内部依赖 `nacp-core` + Cloudflare runtime（`AsyncLocalStorage` / `ExecutionContext`），不能被浏览器 / 微信小程序 runtime 直接 import；同时不能让前端把 server-only 的 `source` / 长 message 暴露到 UI。
  - **依赖边界**：F12 提供独立 `error-codes-client` 出口；**v0.4 修订形态**：`@haimang/nacp-core/error-codes-client` 子路径导出（candidate a'，Q-Obs10 已 answered）；候选 b（`error-codes.json` 静态文件）+ 候选 c（`GET /catalog/error-codes` 端点）保留为 future fallback；该子路径仅依赖纯 TypeScript 类型 + 静态 data table，**不依赖** worker / Cloudflare runtime / nacp-core 主入口的任何 zod schema；server `resolveErrorMeta()` 与 client meta 在 CI 中做一致性测试，避免漂移。

### 3.4 聚合点（哪里要刻意收敛）

- **聚合对象 1**：6 worker 的 HTTP 错误响应形态全部聚合到 `FacadeErrorEnvelope`。
  - **聚合形式**：worker-logger 包导出 `respondWithFacadeError(code, status, message, trace_uuid, details?)` helper；orchestrator-core / agent-core / bash-core / context-core / filesystem-core 的 fetch handler 在 catch 路径调用它；orchestrator-auth 走 RPC envelope（不需 HTTP 返回收口）。
  - **为什么不能分散**：前端只有一种 envelope 解析，否则前端要写 ≥3 套 fallback。
- **聚合对象 2**：错误码语义全部聚合到 `resolveErrorMeta()` 单一运行时入口 + `docs/api/error-codes.md` 单一文档入口。
  - **聚合形式**：1 个函数（runtime） + 1 份 docs（human）+ 1 个 CI 测试断言两者一致。
  - **为什么不能分散**：前端 / 后端 / SRE 三类受众查同一份；docs 与 runtime 分裂会回到 v0.1 之前的状态。
- **聚合对象 3**：critical 级别告警全部聚合到 `nano_error_log` 表（同时打印 console 前缀 `[CRITICAL]`）。
- **聚合对象 4（v0.2 新增）**：HTTP `FacadeErrorEnvelope` 与 WS `system.error` 在同一错误事件上 **必须使用同一 `code` + 同一 `trace_uuid`**（详见 §7.2.5 F2×F7 交叉规则）。

### 3.5 D1 migration 占位说明

RHX1 已把 `workers/orchestrator-core/migrations/` 收敛为当前 SSOT `001`–`005`。因此本簇 first-wave 需要新增 2 张表（`nano_error_log` + `nano_audit_log`，**单一 migration 文件**）时，**唯一合理的 next slot 就是 `006-error-and-audit-log.sql`**，不再沿用 RHX1 之前碎片时代的 `011/012` 讨论。

### 3.6 三套 durable 真相记录的职责边界（v0.3 新增；GPT R4）

> 落地后将存在三套 D1 durable 真相，必须显式划清边界以避免"信息太散"。

| 表 | 来源 | 范围 | retention | 主键 / 排序 | 主用途 | 谁可读 |
|---|---|---|---|---|---|---|
| `nano_session_activity_logs` | migration 002（**已存在**） | **session-scoped 时间线** | 由 RHX1 决定（本簇不动） | `activity_uuid PK + UNIQUE(trace_uuid, event_seq)` 严格按 `event_seq` 排序 | session 内"按顺序发生了什么"的可重放真相；`session-truth.ts:667 appendActivity()` 写；replay 与 inspector 读 | 同 session 的 client + owner |
| `nano_error_log` | migration 006（**本簇新增**） | **cross-trace / cross-worker 错误索引** | 14 天 | `log_uuid PK`；按 `created_at` 与 `(trace_uuid, severity)` 索引 | 跨 session / 跨 worker 的"出错了什么"可查询；severity ≥ warn；F4 写；`/debug/logs` 读 | 同 team 的 client（dev 自查） + owner |
| `nano_audit_log` | migration 006（**本簇新增**） | **protocol / security / owner-facing 审计真相** | 90 天 | `audit_uuid PK`；按 `(team_uuid, event_kind, created_at)` + `(user_uuid, created_at)` 索引 | "重要事件发生了"（含正常事件：登录、API key 发放、attachment_superseded、replay_lost、cross-tenant deny）；F11 写；`/debug/audit` 读 | owner-only（first-wave）；前端 production 不直读 |

**写入分工的 rule of thumb**（落进 `docs/api/error-codes.md` 与 RHX-qna 双引用；Q-Obs12 决议）：
- 一个事件 **只属于一张表的主真相**，但允许在另一张表留索引引用：
  - 例：HTTP 5xx 错误 → 主真相 `nano_error_log`；如果它同时是"安全相关事件"（如 `tenant.cross_tenant_deny`），同步在 `nano_audit_log` 写一条。
  - 例：`session.attachment.superseded` → 主真相 `nano_audit_log`（边界事件）+ 同 session 的 `nano_session_activity_logs` 同步追加 `event_kind="session.attachment.superseded"` 一条（保持 session 时间线完整）。
  - 例：kernel `step_timeout` → 主真相 `nano_session_activity_logs`（session 时间线）+ `nano_error_log` 同步索引（severity=error）。
- **不允许 audit 事件回写 `activity_logs` 的 payload 全文**——audit 只引 `ref={kind, uuid}` 指回 `nano_session_activity_logs` 行。
- **不允许 `error_log` 写"正常事件"**——确认是错误时才写。

**前端 / owner 排障路径**：
1. 拿到 `trace_uuid` → 先查 `nano_error_log` 看跨 worker 是否有错。
2. 若错发生在某个 session → 查 `nano_session_activity_logs` 看 session 内时间线全貌。
3. 若涉及安全 / 合规 → owner 查 `nano_audit_log` 看是否有 audit 痕迹。
4. **若怀疑是包版本错配（owner 看不清 deploy 进 worker 的版本）→ 查 `/debug/packages`（v0.5 新增；详见 §3.7）**。

### 3.7 包来源单一真相门禁（v0.5 新增；D11/D12）

> **owner v0.5 反馈核心**：v0.4 把 "jwt-shared 未发布到 GitHub Packages" 当成 RHX3 carry-over 是 **critical 门禁认知错误**——它意味着我们曾在某些 phase closure 中"宣告完成"，但实际上事实-意图不一致。我们仅能依靠一个唯一真相：**要么是线上 (GitHub Packages) 的包，要么是本库内（workspace-only）的包；不能存在任何模糊空间。**当前的 `workspace:*` + 未发布混合模式让 owner 无法回答两个本应秒答的问题：(1) deploy 进生产 worker 的代码究竟是从线上来的还是从本地来的？(2) 那是哪个版本？

#### 3.7.1 单一真相二分原则

| 包类别 | 唯一真相来源 | consumer 引用形态 | 退出条件 |
|---|---|---|---|
| **published 包**（first-wave 共 3 个：`@haimang/nacp-core` / `@haimang/nacp-session` / `@haimang/jwt-shared`）| **GitHub Packages registry** | dev：`workspace:*`（开发效率）；deploy：build-time gate 强制验证 workspace version === registry latest version；deploy bundle 包含 manifest 证明 | **必须**有对应 published 版本；workspace 与 registry 任何 drift = deploy fail |
| **workspace-only 包**（4 个退役候选：`eval-observability` / `orchestrator-auth-contract` / `storage-topology` / `workspace-context-artifacts`）| **本库 `packages/<name>/`** | `workspace:*` 永久；不设 `publishConfig`；workspace 外不可被 import | 退役前保持 workspace-only；退役后从 `pnpm-workspace.yaml` 删除 |

**没有第三类**。任何包不能既宣称"应当发布"又"实际未发布"——这是 v0.5 之前 jwt-shared 处于的灰色地带。

#### 3.7.2 jwt-shared 必须本簇正式发布

- v0.4 错误地把 jwt-shared 发布问题 carry over 给 RHX3。**v0.5 撤销该 carry-over**：jwt-shared 必须在 RHX2 first-wave 内 publish 到 GitHub Packages（首发 0.1.0；详见 F14）。
- 不接受替代方案 "deletes publishConfig + 永久 workspace-only"——`jwt-shared` 的 helpers 跨 `orchestrator-core` 与 `orchestrator-auth` 两个 worker，是真实的多消费者共享代码；workspace-only 会让任何未来从 monorepo 拆分的 client 立即破裂。
- 不接受 "合并入 nacp-core"——jwt-shared 的 HMAC 与 JWT 逻辑与 NACP 协议层是不同关注点，混入会污染 nacp-core 的边界。

#### 3.7.3 包来源单一真相门禁的实现要点（F14）

build-time CI gate 脚本必须做的 5 步：
1. 对每个 published 包：拉 `packages/<name>/package.json` 的 `version` 字段（workspace truth）。
2. HTTP `GET https://npm.pkg.github.com/@haimang%2F<name>` + Bearer auth → 读取 `versions` 列表中的最大值（registry truth）。
3. **Verify**：workspace truth ≡ registry truth；任何不等都让 deploy fail。
4. **Verify**：`packages/<name>/dist/` 与 registry tarball 的 SHA256 一致（确保本地 build 没有偷偷修改未 publish 的代码）。
5. 生成 `packages/<consumer-worker>/dist/built-package-manifest.json`，包含 3 个包的 `{workspace_version, registry_version, registry_published_at, dist_sha256, match: true}` + build 时间戳；esbuild 把它 inline 进 worker bundle。

deploy 路径上：`pnpm --filter <worker> run deploy:preview` 必须先跑 gate，gate fail 则 wrangler 不上传。

#### 3.7.4 `/debug/packages` 验证接口（F15）

为前端 / owner / 未来运维提供"故障时一次 GET 拿到真相"的能力：

```http
GET /debug/packages
Authorization: <team-token>
```

返回：

```json
{
  "ok": true,
  "data": {
    "worker": "nano-agent-orchestrator-core",
    "build_at": "2026-04-29T10:00:00.000Z",
    "packages": [
      {
        "name": "@haimang/nacp-core",
        "deployed": {
          "version": "1.6.0",
          "resolved_from": "github-packages",
          "dist_sha256": "..."
        },
        "registry": {
          "latest_version": "1.6.0",
          "published_at": "2026-04-29T08:30:00.000Z",
          "fetched_at": "2026-04-29T10:01:23.456Z"
        },
        "drift": false
      },
      {
        "name": "@haimang/nacp-session",
        "deployed": { "version": "...", ... },
        "registry": { "latest_version": "...", ... },
        "drift": false
      },
      {
        "name": "@haimang/jwt-shared",
        "deployed": { "version": "0.1.0", "resolved_from": "github-packages", "dist_sha256": "..." },
        "registry": { "latest_version": "0.1.0", "published_at": "..." },
        "drift": false
      }
    ]
  },
  "trace_uuid": "..."
}
```

- `deployed`: 来自 inline 进 bundle 的 `built-package-manifest.json`（不可篡改 / 不需要 fetch）。
- `registry`: 实时 fetch GitHub Packages（10 秒缓存避免速率限制）。
- `drift`: deployed.version !== registry.latest_version 时为 true；为 true 时 owner 应 alert。

#### 3.7.5 与 v0.4 子路径导出策略的关系

v0.4 已经把 F1 / F12 落到 `@haimang/nacp-core` 子路径（不新建独立包）。这与 §3.7 完全相容：
- v0.4 让 nacp-core 1.6.0 重发，本来就在 published 集合里。
- v0.5 在此基础上加上 jwt-shared 0.1.0 首发 + 门禁验证 + `/debug/packages` 接口。
- 3 个 published 包的边界与 owner 长期策略完全一致。

---

## 4. 参考实现 / 历史 precedent 对比

> 仅挑会改变本簇 first-wave 选择的关键差异点。完整对比见 Opus / DeepSeek 两份 audit。**v0.2 新增 §4.5 sibling 项目**。

### 4.1 mini-agent 的做法

- 简单 try/catch + console；几乎无 observability。借鉴：保持简单；不在 first-wave 装第三方 APM。不照抄：完全无错误持久化、无 trace 标识。

### 4.2 codex 的做法

- Rust `tracing` 生态；SQLite `log_db.rs`（专用表 + batch insert + per-partition cap + 10 天 retention + 复杂 query）；`SessionTelemetry` 30+ 业务事件；OTel counter/histogram 17 个 metric；W3C `traceparent` propagation；`/healthz` + `/readyz` health endpoints。
- **借鉴**：专用表（不混业务表）形态、TTL 清理、按 module/file 索引；W3C `traceparent` 留 mapping seam（不强制全切）。
- **不照抄**：`tracing` crate / Rust subscriber 体系；67+ variants 单一巨枚举；SessionTelemetry 30+ 业务事件方法（first-wave 不做）。

### 4.3 claude-code 的做法

- `logForDebugging()` 5 级 + 双通道（stderr + 文件）；`errorLogSink.ts` JSONL 持久化 + 内存环形缓冲（最近 100，编程读取 API）；`ClaudeError` 层次化 + 逐工具 errorCode；OTel span 4 类 + ALS 传播；3P OTel + 1P BigQuery 双通道；`metricsOptOut`。
- **借鉴**：内存环形缓冲（worker-logger 内置 200 条 + `/debug/recent-errors` 读取）；ALS 上下文传播（Cloudflare Workers 已原生支持 ALS）；5 级 → 4 级 + critical 单独类（非数字 level）。
- **不照抄**：BigQuery exporter（不维护数据后端）；GrowthBook 特性开关（不引入第三方依赖）；Perfetto 追踪格式（先做 `Server-Timing`）。

### 4.4 gemini-cli 的做法

- Winston + 自研 session Logger；`ToolErrorType` enum（40+，按域分类）；OTel SDK 完整三通道（traces/logs/metrics）+ Clearcut + UI Telemetry；30+ event types；`MemoryMonitor` + `EventLoopMonitor`。
- **借鉴**：错误码按域分类（与我们 7 个分布枚举对应）；`isFatalToolError()` 类的 helper API。
- **不照抄**：Winston（不在 Cloudflare Workers 跑）；Clearcut（Google 内部）；MemoryMonitor 系列（first-wave 不做 runtime 监控）。

### 4.5 Sibling 项目（v0.2 新增；DeepSeek R1/R2/R3 + S1/S2 来源）

| 项目 | 文件 | 借鉴内容 | 本簇采纳形式 |
|---|---|---|---|
| `context/smcp/tests/error_registry.test.ts:1-24` | `registerErrorDefinition()` / `resolveErrorDefinition()` / `listErrorDefinitions()` | 运行时可查 registry API | F3-b：扩展现有 `nacp-core/error-registry.ts` 暴露 `resolveErrorMeta()` |
| `context/smind-contexter/core/log.ts:36-41` | `LogPersistFn = (db, data, traceId, ctx?) => Promise<void>` 解耦类型 | 显式建模"格式化 vs 持久化"分离 | F1：worker-logger 导出 `LogPersistFn` + `AuditPersistFn` 类型 |
| `context/smind-contexter/core/log.ts:120-134` | DO/Worker-Shell 双模 `ctx.waitUntil()` vs fire-and-forget | 异步 I/O 保证差异 | F1：DO 路径走 await RPC；Worker-Shell 走 `ctx.waitUntil(persistPromise)` |
| `context/smind-admin/src/infra/errors.ts:5-28` | `HttpError` 7 类 category + `mapErrorCategoryToStatus()` | category 系统作为运行时分类 | **本簇直接复用 `NacpErrorCategorySchema` 已存在的 7 类**（原生与 smind-admin 一致），不新建 |
| `context/smind-admin/src/http/middleware.team.ts:4-12` | `requireTeam(auth)` 团队边界中间件 | team gate 中间件形态 | F5：`/debug/logs` / `/debug/audit` 强制 team_uuid 过滤 |
| `context/wbca-mini/miniprogram/utils/api.js` | 微信小程序 API 调用层 | 受限 JS 环境的可观测性需求 | §2.1 audience 扩展：F2/F7 是跨前端共同依赖 |

### 4.6 横向对比速查表

| 维度 | mini-agent | codex | claude-code | gemini-cli | smind-* 兄弟项 | nano-agent first-wave |
|---|---|---|---|---|---|---|
| 持久化层 | 无 | SQLite | JSONL + 内存环形 | 文件 + GCP | D1 + 共享包 | **D1 错误表 + D1 审计表 + 内存环形（包内）** |
| 日志层级 | 无 | 5 级 + RUST_LOG | 5 级 + env | 4 级 + env | 4 级 | **4 级 + critical（5 级实事求是）+ env `NANO_LOG_LEVEL`** |
| 结构化 | 无 | 全结构化 tracing | `[ts][level] msg` | `[ISO][LEVEL] msg` | 半结构化 | **JSON 一行 + zod schema 校验测试** |
| Span | 无 | W3C TraceContext | OTel span 4 类 | OTel span | 无 | **first-wave 不做 span；ALS seam 留** |
| 错误码注册 | 无 | 67+ 巨枚举 | 数字 ID 注册表 | 40+ ToolErrorType | smcp `registerErrorDefinition()` 运行时 | **7 分布枚举 + 单一 `resolveErrorMeta()`** |
| 错误持久化 | 无 | SQLite | JSONL + 环形 | 走遥测 | D1 + 内存环形 | **D1 + 内存环形** |
| Audit log | 无 | 无独立 audit | 无独立 audit | 无独立 audit | 无独立 audit | **独立 `nano_audit_log` 表 + NACP `audit.record` 通道** |
| Metrics | 无 | counter/hist 17 | counter/hist + BigQuery | counter/hist 30+ | 无 | **first-wave 不 emit；保留 schema/names** |
| Category 系统 | 无 | 无 | 无 | 无 | 7 类 | **复用 NACP 原生 7 类（同枚举）** |
| 前端可读 trace ID | 无 | W3C traceparent | OTel trace ID | OTel trace ID | trace_id | **`x-trace-uuid` 自定义头；W3C 兼容留 seam** |

---

## 5. In-Scope / Out-of-Scope 判断

### 5.1 In-Scope（first-wave 必做；v0.2 10→11；v0.3 11→13；v0.5 13→15）

- **[S1]** **扩展 `@haimang/nacp-core` 新增 `nacp-core/logger` 子路径导出**（v0.4 修订）：4 级日志 + critical 单独类、JSON 一行格式、ALS 注入 trace_uuid/session_uuid/team_uuid、内存环形缓冲（每 worker 最近 200 条）、`LogPersistFn` 与 `AuditPersistFn` 类型签名导出、DO/Worker-Shell 双模适配、JSON schema 校验测试；nacp-core minor bump 1.4.0 → 1.6.0 重发 GitHub Packages。**不新建独立包**（与 owner 长期"3 个 published 包"策略一致）。
- **[S2]** **6 worker HTTP 错误响应统一到 `FacadeErrorEnvelope`**：worker-logger 导出 `respondWithFacadeError()` helper；6 worker 的 fetch handler catch 路径强制走它；orchestrator-auth 走 RPC envelope（不需 HTTP 入口收口）。
- **[S3]** **运行时错误 registry + 单一 docs 查询入口**：(a) 扩展 `packages/nacp-core/src/error-registry.ts` 暴露 `resolveErrorMeta(code) → ErrorMeta`，覆盖 7 个分布枚举的全部 ~80 个 code；(b) `docs/api/error-codes.md` 7 段 + 第 8 段 `ad-hoc codes`（先收 bash-core 临时字符串）；(c) CI 断言两者一致。
- **[S4]** **D1 `nano_error_log` 表 + 持久化（最小集）**：仅承接 severity ≥ warn；orchestrator-core 单点写；TTL 14 天 + alarm/cron 清理；fallback：单写点不可用时本地 console + 内存环形 + `rpc_log_failed:true` 标记（详见 §7.2 F4）。
- **[S5]** **`/debug/logs?trace_uuid=xxx` 调试 endpoint**：team gate（**不是** device gate）；返回近 14 天的 `nano_error_log` 命中。
- **[S6]** **`Server-Timing` 头注入**：仅 orchestrator-core HTTP facade 出口；`total;dur=N` + `auth;dur=M`（如经过 auth）+ `agent;dur=X`（如经过 agent-core）三段。
- **[S7]** **`session.stream.event::system.error` 推送形态**：在 stream-event union 中新增 kind=`system.error`；body schema = `SystemErrorEventBodySchema = {kind, error: NacpErrorSchema, source_worker?, trace_uuid?}`（与 nacp-core/messages/system.ts 的 `SystemErrorBodySchema` 平行）；agent-core kernel 错误 + orchestrator-core facade error（如有 attached WS）emit；dedupe 按 `(trace_uuid, code, source_worker)` 5s。
- **[S8]** **`NacpObservabilityEnvelope.alerts` 最小 emitter（仅 severity=critical）**：worker-logger 导出 `emitObservabilityAlert(...)`；first-wave 触发条件 3 类——D1 写失败 / RPC parity 失败 / R2 写失败；落地与 S4 共表（多一字段 `severity='critical'`）；序列化时 `metrics`/`traces` 为空对象不写入 JSON。
- **[S9]** **bash-core / orchestrator-auth 接入 worker-logger**：让 0 console 的两 worker 在错误路径至少有 `logger.error('...', {ctx})`；bash-core 顺手归化 5–8 个 ad-hoc 字符串 code 到 docs/api/error-codes.md 第 8 段。
- **[S10]** **重复定义防漂移（ESLint）**：`StorageError` 家族 / `evidence-emitters`* / `metric-names` 加 ESLint `no-restricted-imports`；主份选择规则：`packages/` 优先于 `workers/`（详见 §7.2 F10）。**注**：evidence-emitters 不是字节级重复（GLM R11 已校正），而是 `context-core` 与 `workspace-context-artifacts` 两包并行实现 assembly/compact/snapshot 三流；filesystem-core 实现 artifact 流是独立的。
- **[S11（v0.2 新增 / v0.3 扩为 8 类）]** **D1 `nano_audit_log` 表 + NACP `audit.record` 通道接电**：表 TTL 90 天；first-wave 承接 **8 类** `event_kind`（详见 F11，含 `session.attachment.superseded` + `session.replay_lost`）；orchestrator-core 写；前端不直接可读（仅 owner / 未来 admin）。
- **[S12（v0.3 新增；GPT R1；v0.4 形态修订）]** **client-safe error meta 出口**：与 `resolveErrorMeta()` 同源、CI 一致性校验；浏览器 + 微信小程序 runtime 都可消费；终止 `clients/web/src/apis/transport.ts:50-57` 与 `clients/wechat-miniprogram/utils/nano-client.js:11-28 classifyError()` 各自手搓的 4 类分类。**v0.4 形态**：`@haimang/nacp-core/error-codes-client` 子路径导出（候选 a'，Q-Obs10 owner-answered）；候选 b/c 保留为 future fallback。
- **[S13（v0.3 新增；GPT R2）]** **web + 微信小程序对 `system.error` 的消费改造**：在两端 WS frame switch 中显式增加 `case 'system.error'` 分支，按 `error.category` 分发 UI（toast / banner / silent log）；server 在两端均未发布前**保持 `system.error` + `system.notify(severity=error)` 双发降级**，等 client 至少 1 端发布后切单发。
- **[S14（v0.5 新增；critical 门禁）]** **包来源单一真相门禁**：(a) **正式发布 `@haimang/jwt-shared@0.1.0` 到 GitHub Packages**（首发；撤销 v0.4 RHX3 carry-over 错误判断）；(b) build-time CI gate 脚本对 3 个 published 包做"workspace version === registry latest version + dist SHA256 一致"双验证，任何 drift = deploy fail；(c) build 时生成 `built-package-manifest.json` inline 进 worker bundle。**RHX2 closure 必须满足该门禁；不满足不允许宣告完成**。
- **[S15（v0.5 新增）]** **`/debug/packages` 验证接口**：orchestrator-core HTTP endpoint 返回当前 worker 的 `built-package-manifest`（deploy 时刻 truth）+ 实时 GitHub Packages registry 查询（线上 truth）+ drift 标记；team gate；让前端 / owner / 未来运维在故障时一次 GET 拿到三件事实：当前线上版本、deploy 进 worker 的版本、二者是否一致。这条 endpoint 是"可观测性闭环到包发布层"的最后一块。

### 5.2 Out-of-Scope（first-wave 不做；v0.2 沿用 11 项）

- **[O1–O11]** 同 v0.1（OTel SDK 完整接入 / OTel span 树 / histogram 全量 / Hook handler 全量接电 / Evidence 业务持久化 / PII 自动脱敏 / 第三方 APM / session-replay / user-level telemetry opt-out / 重复定义代码合并 / Cloudflare Logpush）。

### 5.3 边界清单（容易混淆的灰色地带；v0.2 增补 4 项）

| 项目 | 判定 | 理由 | 后续落点 |
|---|---|---|---|
| `agent-core` 内部 HTTP `http-controller.ts` 是否要返回 facade envelope | **in-scope (S2)** | RH3 已允许部分直连场景 | RHX2 action-plan |
| `system.notify` 是否被 `system.error` 完全替代 | **out-of-scope (defer)** | 二者并存：notify 是中性业务通知，error 是故障 | 必要时 RH5 后回评 |
| 错误持久化是否做 team-level 视图 | **in-scope (S5)** | `/debug/logs` 必须按 team 边界过滤 | RHX2 action-plan |
| `console.log("usage-commit", ...)` 这条 quota 业务事件是否切到 logger | **in-scope (S1)** | 走 `logger.info`，方便后续切到 metric counter | RHX2 action-plan |
| `/debug/logs` 是否对 owner 全租户可见 | **defer (Q-Obs5)** | first-wave 仅 team 边界；owner 跨租户用 wrangler tail / D1 直查 | Q-Obs5 |
| W3C `traceparent` header 是否同步透传 | **defer** | 保留 seam | RH6 后 |
| `/debug/recent-errors?limit=100` 内存环形缓冲是否暴露 endpoint | **in-scope (S5 一部分)** | 与 S5 同 endpoint 一并实现 | RHX2 action-plan |
| Hook 事件失败是否触发 `system.error` | **in-scope (S7)** | 复用 S7 通道 | RHX2 action-plan |
| Hook handler 注册表为空（DeepSeek P5）| **out-of-scope (O4)** | 是 RH5/RH6 scope | RH5/RH6 |
| evidence sink 持久化 | **out-of-scope (O5)** | first-wave 不动 | 评测 phase |
| `StorageError` 等重复类合并 | **out-of-scope (O10)** | 仅文档登记 + ESLint | cleanup phase |
| **smind-admin 与 nano-agent error response 格式差异（DeepSeek S1）** | **first-wave 不收敛** | smind-admin: `{ok:false, error:{code,category,message,detail}, trace_id}`；nano-agent: `{ok:false, error:{code,status,message,details?}, trace_uuid}` | docs/api/error-codes.md 附录登记差异；future RFC 时再讨论 |
| **微信小程序前端的 F5/F6 不可用（DeepSeek S2）** | **承认但不补救** | `wx.request` 不暴露响应头；production 不开 /debug/logs；F2/F7 是跨前端共同依赖 | §2.1 已说明 |
| **`NacpErrorBodySchema` per-verb migration（GLM R10 派生）** | **out-of-scope** | `NACP_ERROR_BODY_VERBS` 保持空集；`system.error` 仍走 `SystemErrorBodySchema`/`SystemErrorEventBodySchema` | per-verb 迁移单独 RFC |
| **bash-core ad-hoc string codes 是否归化为 enum**（GLM R5） | **partial in-scope (S9 + S3)** | first-wave：纳入 `docs/api/error-codes.md` 第 8 段；不强制归化为 zod enum | RHX2 action-plan + future enum RFC |

---

## 6. Tradeoff 辩证分析与价值判断

### 6.1 核心取舍（v0.2 6→8；v0.3 8→9；v0.5 9→10）

1. **取舍 1**：**D1 表 + 共享 npm logger 包** vs **接入完整 OTel SDK**。沿用 v0.1，无变化。

2. **取舍 2（v0.2 修正）**：**保留 7 个分布枚举 + 一个统一的运行时 `resolveErrorMeta()` 查询函数 + docs 镜像** vs **合并成单一巨枚举（codex 风格）** vs **仅 docs 不做运行时 registry（v0.1 选项）**。
   - **为什么**：合并代价极高；纯 docs 又使前端只能"读文档对照"无法 `if (meta.retryable) retry()`；中间路线（保留分布 + 抽取 `resolveErrorMeta()`）成本与价值最优。
   - **代价**：80 codes 的元数据需要在 7 个枚举注册站点同步维护一份 `category` / `retryable` / `http_status`；CI 一致性测试是关键防漂移。
   - **重评条件**：当某个真实"一码多源"误用且影响生产时，再讨论合并。

3. **取舍 3**：**错误持久化只走 orchestrator-core 单写点** vs **每个 worker 直接写 D1**。沿用 v0.1，但 v0.2 **补 fallback**：单写点不可用时调用方退化为 console + 内存环形 + `rpc_log_failed:true` 标记，**不 retry**（避免反向放大故障）。

4. **取舍 4**：**first-wave 不删重复定义** vs **顺手清理**。沿用 v0.1。

5. **取舍 5（v0.2 加强）**：**新增 `system.error` stream-event kind** vs **复用 `system.notify (severity=error)`**。沿用 v0.1，并 v0.2 明确 `SystemErrorEventBodySchema` 与 nacp-core 的 `SystemErrorBodySchema` 是 **两个独立 schema**：
   - `nacp-core/messages/system.ts::SystemErrorBodySchema = {error: NacpErrorSchema, context?}` —— NACP envelope body 用，`system.error` message type 的 body。
   - `nacp-session/stream-event.ts::SystemErrorEventBodySchema = {kind:"system.error", error: NacpErrorSchema, source_worker?, trace_uuid?}` —— stream-event union 用，承接 WS push 形态，复用 `NacpErrorSchema` 字段。

6. **取舍 6**：**D1 migration 编号 = 006**（承接 RHX1 DDL SSOT 后的 next slot），不再讨论旧碎片时代的 `011/012` 方案。

7. **取舍 7（v0.2 新增）**：**error log 与 audit log 分两张表** vs **合并为 `nano_event_log` 单表**。
   - **为什么**：retention 不同（14d vs 90d）；查询权限不同（前端 dev / owner-only）；语义不同（出错了 / 重要事件，含正常事件）。强行合并会让 TTL 治理与权限校验都依赖 `severity` 字段，增加滑边风险。
   - **代价**：DDL 多一张表；alarm 多一个清理 job。
   - **重评条件**：当两表 90% 字段重合且查询路径合并时（不太可能）。

8. **取舍 8（v0.2 新增）**：**HTTP `FacadeErrorEnvelope` 与 WS `system.error` 在同一错误事件上统一 `code` + 统一 `trace_uuid`**（前端按 trace_uuid 自行去重） vs **二者完全独立通道**（前端各自处理）。
   - **为什么**：统一是协议清洁度的最小成本（强制 emit 时复用同一 `code` 字符串）；让前端可以靠 `trace_uuid` 做幂等渲染（同 trace_uuid 的 HTTP error response 与 WS system.error 视为同一事件的两通知面）。
   - **代价**：facade 路径在 catch 时多一个"是否有 attached WS"的判断；如果两通道 code 不同（如 facade 给 `internal-error` / WS 给 `kernel-illegal-phase`），需要保证它们同 trace_uuid 下能被前端识别为同一事件（用 trace_uuid + 时间窗 1s 去重）。
   - **重评条件**：从未——这是协议清洁度问题，不应回退。

10. **取舍 10（v0.5 新增；owner 否决 v0.4 carry-over）**：**包来源单一真相（要么 GitHub Packages 线上、要么本库 workspace-only，二选一不允许模糊）+ jwt-shared 必须本簇发布 + CI gate + `/debug/packages` 验证接口** vs **接受 v0.4 的 RHX3 carry-over** vs **永久 workspace-only 删 publishConfig**。
    - **为什么**：v0.4 把 jwt-shared 未发布判为 carry-over 是 critical 门禁认知错误——它意味着我们曾以错误事实宣告 phase 完成。owner 立场：宁愿 deploy 暂停，也不允许"deploy 进生产 worker 的代码究竟是从线上还是本地来的、是什么版本"这种问题在故障复盘时无答案。可观测性必须闭环到包发布层。
    - **代价**：(a) jwt-shared 必须立即发布 + 后续每次改动都要 bump + publish 才能 deploy 新 worker；(b) CI gate 让 GitHub Packages 503 / PAT 失效等外部因素直接阻塞 deploy；(c) `/debug/packages` 多 1 个 endpoint。
    - **重评条件**：从未——这是认知正确性的基础，不是可调参数。
    - **不接受的替代方案**：永久 workspace-only 删 publishConfig（让 jwt-shared 退化为类似 4 个退役候选的状态）违反"3 个 published 包"长期策略；合并 jwt-shared 进 nacp-core 会污染 nacp-core 的关注点。

9. **取舍 9（v0.3 新增；GPT R1+R2）**：**把 web + 微信小程序的 client 消费改造（client-safe error meta + system.error 处理）纳入 first-wave in-scope** vs **defer 到独立 client phase**。
   - **为什么**：GPT 审查的核心论断是"server 单边接电不会变成真实可用能力"——`resolveErrorMeta()` 不接到 client，两端就会继续手搓 4 类分类；`system.error` 不接到 client，server 发再多也只会变成"未知 kind"占位。RHX2 的价值是端到端可观测性，不是 server-only schema-wired。
   - **代价**：(a) 工作量上升（两端 client 都要 PR）；(b) 跨 repo / 跨 client team 协调成本；(c) `system.error` 在 client 全部发布前必须保持 `system.error + system.notify(severity=error)` 双发降级窗口。
   - **缓解**：F12 client-safe meta 形态选 candidate a'（v0.4 修订）—— `@haimang/nacp-core/error-codes-client` 子路径导出，与 web 同 monorepo 直接 import；微信小程序通过 build 时反射 `node_modules/@haimang/nacp-core/dist/error-registry-client/data.js` 拷贝 JSON；F13 双发降级窗口由 Q-Obs11 决定（默认 4 周）。
   - **重评条件**：当 client repo 不在同 monorepo / 同团队的情况下（目前 client repo 在同仓库 `clients/`，复杂度可控）。

### 6.2 风险与缓解（v0.2 新增 2 行风险，加强 2 行）

| 风险 | 触发条件 | 影响 | 缓解 |
|---|---|---|---|
| `nano_error_log` 写入风暴（错误连锁） | 大量 critical 同 trace 反复写 | D1 写配额耗尽 / 雪崩 / **orchestrator-core 自身错误丢失（v0.2 加强）** | (a) worker-logger (trace_uuid, code) 5 秒去重；(b) per-team ≤ 10 写/s；(c) D1 写失败仅 fallback console，不 retry；(d) **v0.2 加强**：单写点 RPC 失败时调用方写 console 时打 `rpc_log_failed:true` 标记，便于事后核对是否丢失 |
| 跨 worker `recordErrorLog` RPC 形成调用 cycle | bash-core → orchestrator-core → bash-core | charter §10.3 #2 cycle 红线 | RPC 仅单向；orchestrator-core 写日志路径不能再回调任何 worker |
| `Server-Timing` 头泄漏内部时序细节 | 第三方观察响应头 | 信息暴露 | first-wave 仅暴露粗粒度（auth/agent/total），不暴露 D1/R2/AI 子调用 |
| `/debug/logs` 被滥用看他人 team 数据 | 鉴权漏洞 | 跨租户 | **v0.2 修正**：用 **team gate**（请求者 team_uuid = 查询条件 team_uuid），**不**用 RH3 device gate（device gate 是设备级，不是 team 级） |
| `system.error` 推送把握不住量，前端被淹 | agent-core kernel 高频 error | 前端 UI 卡 | **v0.2 加强**：dedupe 按 `(trace_uuid, code, source_worker)` 三元组而非单 code；前端 client 仅 dev mode 可见 |
| 重复定义不清理导致漂移 | 一份 PR 改了 A 没改 B | 行为不一致 | ESLint `no-restricted-imports` 引导到主份；主份选择规则：packages/ > workers/ |
| 沿用 RHX1 前旧碎片编号 | action-plan / migration 命名仍写 011/012 | 执行顺序与当前 SSOT 脱节 | Q-Obs2 明确 next slot = `006` |
| TTL 治理误导 | 前端报"看不到上周的错误了" | UX 混乱 | docs/api/error-codes.md 顶部 + `/debug/logs` 响应都附 `retention_days: 14` |
| OTLP-shape 留 seam 被滥用为"已经接 OTel" | 团队认知混乱 | 决策错位 | docs 顶部声明：first-wave 仅 schema-shape；真启用 OTel 是后续独立决策 |
| **F2 × F7 双通道告警重复（v0.2 新增）** | 同一错误同时触发 HTTP 500 + WS system.error | 前端展示两个错误对话 | §6.1 取舍 8 + §7.2.5 交叉规则：统一 `trace_uuid` + `code`；前端按 trace_uuid + 1s 时间窗去重 |
| **`nano_audit_log` 写入与 D1 错误日志互相干扰（v0.2 新增）** | audit-record 高频（如 hook outcome 每 step 写） | error log 写延迟上升 | (a) audit log 用独立 prepared statement；(b) `nano_audit_log` 仅承接 6 类 first-wave event_kind，hook outcome 默认仅在 `final_action !== 'continue'` 时写 |
| **NacpObservabilityEnvelope 空 metrics/traces 字段噪音（v0.2 新增）** | F8 emit 仅写 alerts，序列化默认 `{}` | 消费者误以为"metrics 系统正常无数据" | F8 序列化时空 record 不写入 JSON（zod default fallback） |
| **server 推送 `system.error` 但 client 不消费（v0.3 新增；GPT R2）** | F7 落地后 client 未跟进 | "未知 kind" 噪音淹没两端日志；前端 UX 反而变差 | F13 双发降级窗口（`system.error + system.notify(severity=error)` 并发；Q-Obs11 决定窗口长度，默认 4 周）；窗口结束前禁止切单发 |
| **client 端各自手搓错误分类继续漂移（v0.3 新增；GPT R1）** | server 已发 `resolveErrorMeta()` 但 client 未消费 | web `transport.ts` 与微信 `nano-client.js` 继续各写一套；server 改 code 后 client 不知 | F12 client-safe meta 单一出口（候选 a/b/c 由 Q-Obs10 选定）+ CI 一致性测试 + 两端 import 同一份 |
| **三套 durable 真相职责混淆（v0.3 新增；GPT R4）** | 同一事件被同时写到 `nano_session_activity_logs` + `nano_error_log` + `nano_audit_log` 且 payload 不一致 | 排障时三处对照费时 / 信息漂移 | §3.6 明确"主真相 + 索引引用"规则；audit 不写 activity payload 全文，只引 `ref={kind, uuid}` |
| **包来源认知模糊（v0.5 新增；owner 否决 carry-over）** | jwt-shared 未发布但 consumer 用 `workspace:*`；deploy 进 worker bundle 后无法回答"是从线上来的还是本地来的""是哪个版本" | 故障复盘没有真相源；任何 closure 都基于错误事实假设 | F14 必须在 RHX2 发布 jwt-shared@0.1.0；F14 CI gate 阻拦 workspace ↔ registry drift；F15 `/debug/packages` 让事实机器可读；本簇 closure 以 F14 + F15 通过为前置 |
| **registry 速率限制 / runtime 无 PAT（v0.5 新增）** | `/debug/packages` 高频拉 GitHub Packages | 速率限制；401 | F15 缓存 10 秒；Q-Obs14 graceful 降级（registry 段标 `auth-not-available-in-runtime`，deployed 段始终可用） |
| **CI gate 误把短暂 registry 503 当 drift 阻断 deploy（v0.5 新增）** | GitHub Packages 短暂不可用 | deploy 长时间停滞 | F14-b 短重试 3 次 + exponential backoff；仍 fail 则按 owner 立场不允许 graceful degrade（这是门禁的全部价值，宁愿停 deploy 也不接受事实模糊） |

### 6.3 本次 tradeoff 能带来的价值

- **对开发者自己（我们）**：debug 链路从"截屏 + wrangler tail + 肉眼"升级到"trace_uuid + /debug/logs + Server-Timing"；Web 前端 80% bug 不再需要 owner 介入；**audit log 让安全事件可回溯到 90 天**。
- **对 nano-agent 的长期演进**：把 NACP 协议 4 个观测留位（system.error / audit.record / NacpObservabilityEnvelope.alerts / evidence）一次接电；error code docs 给后续 hero-to-platform 的 admin/billing audit 留锚点。
- **对上下文管理 / Skill / 稳定性三大方向的杠杆作用**：
  - **稳定性**：critical alert + D1 持久化让"发生过什么 / 还在发生什么"可被复盘。
  - **上下文管理**：evidence 四流的 `errorCode` 字段在 prod 路径首次可见。
  - **Skill**：未来 skill 失败有结构化错误码可分发；hook outcome 进入 audit log 可回溯。

---

## 7. In-Scope 功能详细列表

### 7.1 功能清单（v0.2 10→11；v0.3 11→13）

| 编号 | 功能名 | 描述 | 一句话收口目标 |
|---|---|---|---|
| F1 | `worker-logger` 共享包 | 4 级 + critical / ALS / 内存环形 / `LogPersistFn` + `AuditPersistFn` 类型 / DO/Worker-Shell 双模 / JSON schema 校验 | ✅ 6 worker 全部 import；ESLint 阻拦裸 console |
| F2 | `respondWithFacadeError()` helper | 6 worker HTTP catch 路径统一到 `FacadeErrorEnvelope` | ✅ 6 worker 错误响应同 envelope；响应头有 `x-trace-uuid` |
| F3 | 运行时 `resolveErrorMeta()` registry + `docs/api/error-codes.md` | 7 枚举 ~80 codes + 第 8 段 ad-hoc；CI 断言 docs 与 registry 一致 | ✅ `resolveErrorMeta(code)` 全 80 codes 命中；docs 与 registry CI 一致 |
| F4 | D1 `nano_error_log` 表 + 持久化 | 单写点 + dedupe + rate-limit + TTL 14d + 单写点失败 fallback | ✅ migration `006-error-and-audit-log.sql` 已 apply；severity≥warn 100% 落 D1 或 fallback；写失败有 `rpc_log_failed:true` |
| F5 | `/debug/logs` + `/debug/recent-errors` 调试 endpoint | team gate；按 trace_uuid/session_uuid/code/since 查；返回 14d 命中 + 内存最近 200 条 | ✅ orchestrator-core route 实装；team_uuid 强校验；rate limit |
| F6 | `Server-Timing` header 注入 | 仅 orchestrator-core HTTP facade 出口 | ✅ facade 出口必含 `Server-Timing: total;dur=N` 至少一段 |
| F7 | `session.stream.event::system.error` kind | `SystemErrorEventBodySchema` 复用 `NacpErrorSchema`；与 `system.notify` 平行；dedupe 三元组 | ✅ schema 落地；agent-core kernel critical 错误必 emit；schema 单测通过 |
| F8 | `emitObservabilityAlert()` critical alert | 仅 severity=critical；3 类触发；落 nano_error_log；envelope 空字段不序列化 | ✅ 3 类触发各有单测；critical 至少落 console + D1 + WS（如有 session） |
| F9 | bash-core / orchestrator-auth 接 logger + ad-hoc code 归化 | 终结 0 console；bash-core 5–8 个 ad-hoc 字符串纳入 docs 第 8 段 | ✅ 2 worker prod 路径 logger.error ≥ 5；ad-hoc codes docs 已收 |
| F10 | ESLint 重复定义防漂移 | `no-restricted-imports`；主份规则 `packages/` > `workers/` | ✅ ESLint rule 落地；CI 红即拦 |
| **F11（v0.2 新增 / v0.3 扩为 8 类）** | **D1 `nano_audit_log` 表 + NACP `audit.record` 通道接电** | TTL 90d；first-wave 8 类 event_kind（含 `session.attachment.superseded` + `session.replay_lost`）；orchestrator-core 写 | ✅ migration `006-error-and-audit-log.sql` 含 audit 表；8 类 event_kind 各 ≥1 写路径 |
| **F12（v0.3 新增；GPT R1；v0.4 形态修订）** | **client-safe error meta 出口** | 与 `resolveErrorMeta()` 同源；CI 一致性测试；**v0.4 形态：`@haimang/nacp-core/error-codes-client` 子路径导出（candidate a'）**；候选 b `error-codes.json` / c `GET /catalog/error-codes` 留 future fallback | ✅ web `transport.ts` + 微信 `nano-client.js` 改用 client meta；不再各自手搓；CI 一致性测试通过；**不新建独立包** |
| **F13（v0.3 新增；GPT R2）** | **web + 微信小程序 `system.error` 消费 + 双发降级窗口** | 两端 WS frame switch 加 `case 'system.error'`；按 `error.category` 分发 UI；server 在 client 发布前保持 `system.error + system.notify(severity=error)` 双发 | ✅ 两端 PR 合并；server 双发降级窗口期由 Q-Obs11 决定（默认 4 周）；窗口结束后切单发 |
| **F14（v0.5 新增；critical 门禁）** | **包来源单一真相门禁 + jwt-shared 0.1.0 首发** | (a) jwt-shared 0.1.0 publish 到 GitHub Packages；(b) CI gate 验证 3 published 包 workspace==registry version + SHA256 一致；(c) build 时生成 `built-package-manifest.json` inline 进 worker bundle | ✅ jwt-shared@0.1.0 在 GitHub Packages HTTP 200；nacp-core@1.6.0 + nacp-session 双发；CI gate 阻拦任何 drift；6 worker bundle 都内嵌 manifest |
| **F15（v0.5 新增）** | **`/debug/packages` 验证接口** | orchestrator-core HTTP endpoint；返回 inline manifest + 实时 registry 查询 + drift 标记；team gate；10s 缓存 registry 响应 | ✅ `/debug/packages` 在 preview / production 都可用；返回 3 包 deployed + registry + drift；team gate 强校验；故障复盘时 owner 与前端一次 GET 拿真相 |

### 7.2 详细阐述

#### F1: `worker-logger` 共享包

- **包名**：`@haimang/worker-logger`（与既有 `@haimang/*` 命名一致）。
- **公开 API**：

```ts
export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

export interface LogRecord {
  ts: string;                    // ISO 8601
  level: LogLevel;
  worker: string;
  trace_uuid?: string;
  session_uuid?: string;
  team_uuid?: string;
  msg: string;
  code?: string;                 // 错误 code（来自 resolveErrorMeta() 的 code）
  category?: NacpErrorCategory;  // 7 类之一（来自 resolveErrorMeta()）
  ctx?: Record<string, unknown>; // caller 自由结构化字段
  rpc_log_failed?: true;         // F4 fallback 标记
}

export interface AuditRecord {
  ts: string;
  worker: string;
  trace_uuid?: string;
  session_uuid?: string;
  team_uuid?: string;
  event_kind: string;            // NACP audit.record event_kind（6 类之一）
  ref?: { kind: string; uuid: string };
  detail?: Record<string, unknown>;
}

export type LogPersistFn = (record: LogRecord, ctx?: ExecutionContext) => Promise<void> | void;
export type AuditPersistFn = (record: AuditRecord, ctx?: ExecutionContext) => Promise<void> | void;

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, opts: { code: string; ctx?: Record<string, unknown> }): void;
  critical(msg: string, opts: { code: string; ctx?: Record<string, unknown> }): void;
  recentErrors(limit?: number): LogRecord[];      // 内存环形缓冲读取
  audit(event_kind: string, opts: { ref?: AuditRecord["ref"]; detail?: Record<string, unknown> }): void;
}

export function createLogger(workerName: string, opts?: {
  level?: LogLevel;              // 默认 "info"，可被环境变量 NANO_LOG_LEVEL 覆盖
  persistError?: LogPersistFn;
  persistAudit?: AuditPersistFn;
  ringBufferSize?: number;       // 默认 200
}): Logger;

export function withTraceContext<T>(
  context: { trace_uuid?: string; session_uuid?: string; team_uuid?: string },
  fn: () => T
): T;

export function respondWithFacadeError(
  code: FacadeErrorCode,
  status: number,
  message: string,
  trace_uuid: string,
  details?: unknown
): Response;

export function emitObservabilityAlert(
  scope: NacpAlertScope,
  severity: "critical",          // first-wave 仅 critical
  code: string,
  message: string,
  ctx?: Record<string, unknown>
): void;
```

- **底层日志格式**（每条一行 JSON）：

```json
{"ts":"2026-04-29T10:00:00.000Z","level":"error","worker":"orchestrator-core","trace_uuid":"...","session_uuid":"...","team_uuid":"...","msg":"models-d1-read-failed","code":"upstream-timeout","category":"transient","ctx":{"team":"..."}}
```

- **核心逻辑**：
  - **ALS 注入**：`withTraceContext(...)` 在 fetch handler / DO `fetch` 顶层包一次；logger 自动 read。Cloudflare Workers 原生支持 `AsyncLocalStorage`。
  - **DO/Worker-Shell 双模适配**（DeepSeek S3 + GLM 派生）：
    - **Worker-Shell** 环境（orchestrator-core 等的 fetch handler）：persistError/persistAudit 通过 `ctx.waitUntil(persistPromise)` fire-and-forget；不 block 响应。
    - **DO** 环境（agent-core NanoSessionDO）：无 `ExecutionContext`，persistError/persistAudit 必须通过 `ORCHESTRATOR_CORE` service binding RPC `await` 完成（RPC 调用受 DO request 生命周期保护）。
  - **dedupe**：worker 内 5 秒 LRU dedupe by `(level, code, trace_uuid)`，避免风暴；critical 不 dedupe。
  - **level 过滤**：环境变量 `NANO_LOG_LEVEL=debug|info|warn|error|critical`，默认 `info`。
  - **wrangler tail 互补**（DeepSeek S5）：console JSON 输出同时进入 Cloudflare Workers Logs（dashboard 可查）—— 这是 D1 持久化的有益补充（Workers Logs 写入端 view，D1 读取端 query）。
  - **JSON schema 校验测试**（DeepSeek S4）：worker-logger 内含 zod schema 校验单测，验证 LogRecord 必填字段在所有 4 级 + critical 路径都被正确填充。
- **边界情况**：
  - ALS 不可用时 `trace_uuid` 字段省略，不抛错。
  - `JSON.stringify` 失败（循环引用）→ 回退到 `String(ctx)` 并标记 `_serialize_error: true`。
  - 内存环形缓冲在 worker 重启时丢失（Cloudflare 行为，不可避免）。
  - DO 环境下 persistError RPC 失败 → 调用方仍写 console + 内存环形 + `rpc_log_failed:true` 标记，**不 retry**。
- **一句话收口目标**：✅ **6 个 worker 都 import `@haimang/worker-logger`，prod 路径下裸 `console.*` 由 ESLint 阻拦；DO/Worker-Shell 双模适配单测通过；JSON schema 校验单测通过。**

#### F2: `respondWithFacadeError()` helper

- **输入**：`(code: FacadeErrorCode, status: number, message: string, trace_uuid: string, details?: unknown)`
- **输出**：`Response`，body = `FacadeErrorEnvelope`，headers 含 `x-trace-uuid` + `Content-Type: application/json` + `Server-Timing`（如经过 F6 注入路径）。
- **主要调用者**：6 个 worker 的 fetch handler catch 路径。orchestrator-auth 走 RPC envelope（不需 HTTP 入口收口）。
- **核心逻辑**：
  - 与现有 `policy/authority.ts:31` 的 `facadeError()` schema 一致；推荐 worker-logger 直接 re-export `facadeError()` 加上自动调用 `logger.error(...)`。
  - 内部调用 `logger.error(message, {code, ctx: details})`，复用 F1 的写日志 + LogPersistFn 钩子。
- **边界情况**：
  - `code` 不在 `FacadeErrorCodeSchema` 枚举内 → 编译期阻拦（用 zod inferred type 做参数）。
  - `details` 为 `undefined` 时不写字段。
  - **F2 × F7 交叉**：见 §7.2.5。
- **一句话收口目标**：✅ **6 worker 的 HTTP error 响应只剩一种 envelope；前端 1 套 parser 全覆盖（包含微信小程序前端）。**

#### F3: 运行时 `resolveErrorMeta()` registry + `docs/api/error-codes.md`

> v0.2 关键变化（DeepSeek R1）：从纯 docs 升级为 **runtime registry + docs 镜像 + CI 一致性测试**。

- **API**：

```ts
// packages/nacp-core/src/error-registry.ts 扩展
export interface ErrorMeta {
  code: string;
  source: "rpc" | "facade" | "auth" | "nacp" | "kernel" | "session" | "llm" | "ad-hoc";
  category: NacpErrorCategory;   // 7 类之一
  http_status: number;           // 标准映射
  retryable: boolean;
  message: string;
}

export function resolveErrorMeta(code: string): ErrorMeta | undefined;
export function listErrorMetas(): ErrorMeta[];   // 用于 docs 生成
```

- **数据来源**（编译期合并）：
  - `RpcErrorCode`（22）— `packages/nacp-core/src/rpc.ts:49`
  - `FacadeErrorCode`（32）— `packages/orchestrator-auth-contract/src/facade-http.ts:48`
  - `AuthErrorCode`（13）— `packages/orchestrator-auth-contract/src/auth-error-codes.ts:3`
  - NACP（19）— 已在 `error-registry.ts:61-89` 通过 `registerErrorDefinition()` 注册
  - `KernelErrorCode`（6）— `workers/agent-core/src/kernel/errors.ts:12`
  - `SessionErrorCode`（8）— `packages/nacp-session/src/errors.ts:10`
  - `LLMErrorCategory`（8）— `workers/agent-core/src/llm/errors.ts:10`
  - bash-core ad-hoc 字符串（5–8，归化时填入）— 来源 F9
- **一致性测试**（F3 / F10 共用）：
  - `packages/nacp-core/test/error-registry-coverage.test.ts`：枚举每个 code 都能 `resolveErrorMeta()` 命中。
  - `packages/nacp-core/test/error-codes-docs.test.ts`：parse `docs/api/error-codes.md` markdown 表格，断言每行存在于 registry 且 6 列字段一致。
- **`docs/api/error-codes.md` 形态**：

```markdown
# nano-agent error codes

> retention: 14d for `nano_error_log`; 90d for `nano_audit_log`. trace_uuid 是单一关联键。

## 1. RpcErrorCode (22 codes — `packages/nacp-core/src/rpc.ts:49`)

| code | category | http_status | retryable | 含义 | 前端处理建议 |
|---|---|---|---|---|---|
| invalid-request | validation | 400 | no | RPC 请求 schema 拒绝 | show user as form error |
| ... | ... | ... | ... | ... | ... |

## 2. FacadeErrorCode (32 codes)
## 3. AuthErrorCode (13 codes)
## 4. NACP_* (19 codes)
## 5. KernelErrorCode (6 codes)
## 6. SessionErrorCode (8 codes)
## 7. LLMErrorCategory (8 codes)
## 8. ad-hoc strings (bash-core; ~5–8 codes; targeted for enum migration)

## Appendix A. smind-admin vs nano-agent error response shape
（DeepSeek S1：登记格式差异，first-wave 不收敛）
```

- **一句话收口目标**：✅ **`resolveErrorMeta(code)` 对 80+ codes 返回 `ErrorMeta`；`docs/api/error-codes.md` 7+1 段；CI 断言 docs 与 registry 一致；前端可在代码中直接 `if (meta.retryable) retry()`。**

#### F4: D1 `nano_error_log` 表 + 持久化（v0.2 给出完整 DDL 与 fallback）

- **完整 DDL**（与 F11 共一个 migration 文件，文件名 `migration 006-error-and-audit-log.sql`）：

```sql
-- migration 006-error-and-audit-log.sql — RHX2 first-wave
-- Part 1: nano_error_log (TTL 14d)

CREATE TABLE IF NOT EXISTS nano_error_log (
  log_uuid       TEXT PRIMARY KEY,         -- v7 UUID
  trace_uuid     TEXT NOT NULL,            -- 关联 x-trace-uuid
  session_uuid   TEXT,                     -- 可选；HTTP 路径有 session 时填
  team_uuid      TEXT,                     -- 可选；非 facade 路径可能为空
  worker         TEXT NOT NULL,            -- "orchestrator-core" / "agent-core" / ...
  source_role    TEXT,                     -- NACP source_role（与 state-machine 对齐）
  code           TEXT NOT NULL,            -- 来自 resolveErrorMeta() 的 code
  category       TEXT NOT NULL,            -- 7 类之一（NacpErrorCategory）
  severity       TEXT NOT NULL CHECK (severity IN ('warn','error','critical')),
  http_status    INTEGER,                  -- 如 HTTP 路径有响应 status
  message        TEXT NOT NULL,            -- ≤ 2048 chars (NacpErrorBody 上限)
  context_json   TEXT,                     -- 可选；caller ctx 的 JSON 字符串；≤ 8 KiB（超长截断 + _truncated:true）
  rpc_log_failed INTEGER NOT NULL DEFAULT 0, -- 0/1；fallback 标记
  created_at     TEXT NOT NULL             -- ISO 8601
);

CREATE INDEX IF NOT EXISTS nano_error_log_trace_idx
  ON nano_error_log(trace_uuid, created_at);
CREATE INDEX IF NOT EXISTS nano_error_log_team_idx
  ON nano_error_log(team_uuid, created_at);
CREATE INDEX IF NOT EXISTS nano_error_log_session_idx
  ON nano_error_log(session_uuid, created_at);
CREATE INDEX IF NOT EXISTS nano_error_log_severity_idx
  ON nano_error_log(severity, created_at);
```

- **写入路径**：
  1. caller worker（任意 6 个）调用 `logger.error(msg, {code, ctx})` 或 `logger.critical(...)`。
  2. worker-logger 内部 dedupe by `(trace_uuid, code, level)` 5s。
  3. 命中 dedupe 则 console-only。
  4. 未命中：调用 `LogPersistFn`：
     - 在 orchestrator-core：直接 `await env.NANO_AGENT_DB.prepare(INSERT...).bind(...).run()`，由 `ctx.waitUntil()` 包裹。
     - 在其他 5 worker：调用 `env.ORCHESTRATOR_CORE.recordErrorLog(record)` RPC（agent-core 已有 binding；bash-core/context-core/filesystem-core 需新增 binding）。orchestrator-auth 错误在 orchestrator-core `facadeFromAuthEnvelope` 包装时同点写入。
  5. **Fallback**（v0.2 新增；GLM R3）：上述写入失败（D1 binding 不可用 / RPC 失败 / per-team 限速命中）→ caller 写一行 `console.warn` JSON，`level: "error"|"critical"`，**额外打 `rpc_log_failed:true` 字段**；不 retry，不抛错。
- **Rate limit & dedupe**：
  - per-team ≤ 10 写/秒；超额 → fallback console + `rpc_log_failed:true`。
  - critical 不 dedupe（任何 critical 必须落库）。
- **TTL 清理**：
  - orchestrator-core 用 alarm 或 cron trigger，每天 03:00 UTC 跑一次 `DELETE FROM nano_error_log WHERE created_at < datetime('now','-14 days')`。
  - 由本簇 first-wave 决定 alarm 还是 cron（详见 Q-Obs8）。
- **边界**：
  - D1 binding 不可用 → fallback console；不抛错。
  - `context_json` 超 8 KB → 截断 + 标记 `_truncated: true`。
  - log_uuid 可用 v7 UUID（自带时间戳）便于范围扫描。
- **一句话收口目标**：✅ **migration `006-error-and-audit-log.sql` 已 apply preview；6 worker 错误路径 severity≥warn 100% 落 D1 或 fallback console；critical 不 dedupe；写失败 fallback 不抛错；TTL 14d 清理由 alarm/cron 跑通。**

#### F5: `/debug/logs` + `/debug/recent-errors` 调试 endpoint

- **`GET /debug/logs`**（持久化查询）：
  - **input** query: `trace_uuid?` `session_uuid?` `code?` `severity?` `since?`（ISO）`limit?`（≤200）
  - **auth**: 已认证用户 + **team gate**（请求者 team_uuid = 查询条件 team_uuid，不使用 RH3 device gate；GLM R6 修正）
  - **output**: `FacadeSuccessEnvelope<{ logs: ErrorLogRecord[], retention_days: 14 }>`
  - **必须有** `trace_uuid` 或 `session_uuid` 之一（否则 400 `invalid-input`）。
  - 跨 team 查询 → 403 `tenant-mismatch`。
  - 速率限制：per-user 10 req/s。
- **`GET /debug/recent-errors`**（内存环形缓冲查询）：
  - **input** query: `limit?`（≤200，默认 100）
  - **auth**: 同上
  - **output**: `FacadeSuccessEnvelope<{ logs: LogRecord[], source: "memory-ring", capacity: 200 }>`
  - 仅返回 **当前 worker 实例** 的内存环形缓冲；worker 重启后清空。用于"最近一次出错刚刚发生"的快速调试。
- **一句话收口目标**：✅ **前端用 trace_uuid 一次 GET 即可拿到该请求 14 天内全部 D1 错误命中；`/debug/recent-errors` 给"刚刚发生"场景兜底；team gate 强校验跨租户拒绝。**

#### F6: `Server-Timing` header

- **覆盖范围（v0.2 修正：GLM R7）**：**仅 orchestrator-core HTTP facade 出口**（`/sessions/*` / `/me/*` / `/debug/*`）；agent-core 直连场景与 RH2 `/sessions/{id}/context` 不在 first-wave 覆盖范围。
- **输入**：facade 入口测量 `auth_dur_ms` / `agent_dur_ms` / `total_dur_ms`。
- **输出**：响应头 `Server-Timing: total;dur=<n>, auth;dur=<m>, agent;dur=<x>`（子调用未发生时省略对应段）。
- **核心逻辑**：fetch handler 顶层 `t0 = Date.now()`；rpc 子调用前后取差；最后 `attachServerTimings(response, timings)` 写头。
- **边界**：
  - 浏览器 Network 面板要求 header 名小写不影响（标准是 `Server-Timing`）。
  - 不暴露 D1/R2/AI 子调用粒度。
  - 微信小程序 `wx.request` 不暴露响应头 → F6 对小程序无价值（已在 §2.1 声明）。
- **一句话收口目标**：✅ **orchestrator-core facade 路径每条响应必有 `Server-Timing` 至少 `total;dur=N` 一段；浏览器 Network 面板原生展示。**

#### F7: `session.stream.event::system.error` kind（v0.2 schema 修正）

- **schema（v0.2 修正：GLM R10）**：在 `packages/nacp-session/src/stream-event.ts` 新增：

```ts
import { NacpErrorSchema } from "@haimang/nacp-core";

export const SystemErrorEventBodySchema = z.object({
  kind: z.literal("system.error"),
  error: NacpErrorSchema,                     // 复用 NACP 原生 error 形态（含 7 类 category + retryable）
  source_worker: z.string().optional(),       // "orchestrator-core" / "agent-core" / ...
  trace_uuid: z.string().uuid().optional(),
});
export type SystemErrorEventBody = z.infer<typeof SystemErrorEventBodySchema>;
```

- **与 nacp-core `SystemErrorBodySchema` 关系**：
  - `nacp-core/messages/system.ts::SystemErrorBodySchema = {error: NacpErrorSchema, context?}` —— NACP envelope body（用于 NACP message type `system.error` 的请求/事件 body）。
  - `nacp-session/stream-event.ts::SystemErrorEventBodySchema = {kind:"system.error", error, source_worker?, trace_uuid?}` —— stream-event union 用，**包装** NACP error 形态 + WS 通道所需的 `kind` discriminator + 路由元数据。
  - 二者并存；本簇仅在 stream-event 层 emit；NACP message type 层不在 first-wave 启用。
- **emit 路径**：
  - agent-core kernel critical error 路径：`runtime-mainline.ts` 错误归一点 → `tryEmitSystemError(record)` → 现有 `ORCHESTRATOR_CORE.forwardServerFrameToClient` 跨 worker 推。
  - orchestrator-core facade error 路径：`respondWithFacadeError()` 同时检测 attached WS，若有则 emit；否则跳过。
- **dedupe（v0.2 修正：GLM R8）**：per-session 5 秒去重，按 **`(trace_uuid, code, source_worker)` 三元组**（不再是单 `code`）。critical 不 dedupe。
- **降级**：schema 校验失败 → 降级到 `system.notify (severity=error)`（兼容旧 client）。
- **一句话收口目标**：✅ **stream-event union 含独立 `system.error` kind；agent-core kernel critical 错误必 emit；schema 单测通过；前端按 kind 分发不混淆 notify / error；dedupe 三元组单测通过。**

#### 7.2.5 F2 × F7 交叉规则（v0.2 新增；GLM R1 + 取舍 8）

> 同一错误事件可能同时触发 HTTP `FacadeErrorEnvelope`（F2）与 WS `system.error`（F7）。本节定义二者的强一致约束，避免前端双通道误展示。

- **强一致字段**：
  1. **`trace_uuid`**：F2 envelope 顶层 `trace_uuid` 与 F7 body 内 `trace_uuid` 必须相同。
  2. **`code`**：F2 `error.code`（FacadeErrorCode 字符串）与 F7 `error.code`（NacpErrorSchema.code）应来自 **同一 `resolveErrorMeta(code)` 命中**。如果 facade 路径用 `internal-error`（FacadeErrorCode）但 source 是 kernel 抛 `KERNEL_INTERRUPTED`（KernelErrorCode），则二者 code 不同 — 此时仍允许，前端按 `trace_uuid` 去重而非 `code` 去重。
  3. **`severity`**：F2 隐含 severity（status 5xx ≈ critical/error；4xx ≈ warn）；F7 `error.category` + 显式 severity 必须不矛盾（不要 facade 报 5xx 而 WS 报 severity=info）。
- **前端去重规则**：同一 `trace_uuid` 在 1 秒时间窗内同时收到 HTTP error response 与 WS `system.error` 视为 **同一事件的两通知面**，UI 仅展示一次（建议优先展示 HTTP error response 的 message + status，因为它对应的是用户当下行为；WS 仅做后台 telemetry）。
- **emit 时序**：facade catch 路径先记 logger.error → 后构造 HTTP response → 异步 `tryEmitSystemError` 跨 worker WS 推（有 attached WS 时）。logger.error 触发的 D1 写入是同源同步点。
- **测试**：在 `test/cross-e2e/` 增加一个 case：人为触发 facade 5xx + 有 attached WS 时，前端模拟 client 验证收到的 HTTP envelope 与 WS frame trace_uuid 相同、code 来自同一 registry。

#### F8: `emitObservabilityAlert()` critical alert（v0.2 加强：序列化规则）

- **触发条件**：仅 severity=critical；3 类（D1 写失败 / RPC parity 失败 / R2 写失败）。
- **输出**：(a) 写一条 `nano_error_log`（`severity='critical'`）；(b) console `[CRITICAL]` 前缀；(c) 尝试 emit `system.error` (severity=critical) — 复用 F7 路径。
- **NacpObservabilityEnvelope 序列化（v0.2 加强：GLM R4）**：first-wave envelope 仅写 `alerts` 数组；`metrics` / `traces` 为空 record 时 **从序列化 JSON 中省略**（zod default `{}` 在 emit 前 strip）；这避免给消费者一个"metrics 系统正常但无数据"的错觉。
- **边界**：
  - critical alert 自身写 D1 也失败 → console-only，不 retry，不抛错。
  - 自报 self-error 风险（GLM R3）：critical 触发的 RPC 写失败，调用方写 console + `rpc_log_failed:true`；不再 critical-loop。
- **一句话收口目标**：✅ **3 类 critical 触发各有单测；每条 critical 至少落 console + D1 + WS（如有 session）三条线之一；空 metrics/traces 不污染序列化 JSON。**

#### F9: bash-core / orchestrator-auth 接 logger + ad-hoc code 归化（v0.2 给出完整路径枚举：GLM R9）

- **bash-core 错误路径清单**（基于 `executor.ts` / `bridge.ts`）：

| 路径 | 当前形态 | F9 目标 | docs/error-codes.md 段 |
|---|---|---|---|
| `executor.ts` 空命令 | `throw new Error("empty-command")` | `logger.error("empty-command", {code:"empty-command"})` + RPC 错 | 第 8 段 ad-hoc |
| `executor.ts` 政策拒绝 | `throw new Error("policy-denied")` | `logger.warn("policy-denied", {code:"policy-denied"})` + RPC 错 | 第 8 段 |
| `executor.ts` session 未找到 | 同上 `"session-not-found"` | `logger.warn("session-not-found", ...)` | 第 8 段 |
| `executor.ts` 执行超时 | `"execution-timeout"` | `logger.error("execution-timeout", ...)` | 第 8 段 |
| `executor.ts` 执行失败 | `"execution-failed"` | `logger.error("execution-failed", ...)` | 第 8 段 |
| `bridge.ts` bridge 未找到 | `"bridge-not-found"` | `logger.warn("bridge-not-found", ...)` | 第 8 段 |
| `executor.ts` handler 抛错 | `"handler-error"` | `logger.error("handler-error", {ctx: error_stack})` | 第 8 段 |

- **orchestrator-auth 错误路径清单**（基于 RH3 已落代码）：

| 路径 | 当前形态 | F9 目标 |
|---|---|---|
| WeChat code 交换失败 | RPC 错（`invalid-wechat-code`/`invalid-wechat-payload`）静默 | `logger.error(..., {code:"invalid-wechat-code"})` |
| JWT 验证失败 | RPC 错（`refresh-invalid`）静默 | `logger.warn(..., {code:"refresh-invalid"})` |
| Refresh token 过期 | RPC 错（`refresh-expired`）静默 | `logger.warn(...)` |
| Refresh token 撤销 | RPC 错（`refresh-revoked`）静默 | `logger.warn(...)` |
| Device 注册冲突 | RPC 错 | `logger.warn(..., {code:"identity-already-exists"})` |
| API key 哈希校验失败 | RPC 错（`invalid-auth`）静默 | `logger.warn(..., {code:"invalid-auth"})` |

- **要求**：
  - bash-core 至少新增 5 条 `logger.error` / `logger.warn`；orchestrator-auth 至少 5 条。
  - bash-core ad-hoc 7 个字符串全部进入 `docs/api/error-codes.md` 第 8 段；first-wave 不强制归化为 zod enum（防滑边到 RH3 contract 改动）。
- **一句话收口目标**：✅ **bash-core / orchestrator-auth `logger.error`+`logger.warn` 各 ≥ 5；bash-core 7 个 ad-hoc codes 在 docs 第 8 段全收；prod 错误可在 `nano_error_log` 命中。**

#### F10: ESLint 重复定义防漂移（v0.2 加强：GLM R12）

- **主份选择规则**：**`packages/` 优先于 `workers/`**（packages 可被多 worker 共享；workers 下不应被其他 worker 引用）。
- **具体决策**：
  - `StorageError` 家族 → 主份 = `packages/storage-topology/src/errors.ts`；次份 = `workers/filesystem-core/src/storage/errors.ts`。
  - `metric-names` → 主份 = `packages/eval-observability/src/metric-names.ts`；次份 = `workers/agent-core/src/eval/metric-names.ts`。
  - `evidence-emitters` → **不适用此规则（GLM R11）**：`context-core` 与 `workspace-context-artifacts` 是两包并行实现 assembly/compact/snapshot 三流；`filesystem-core/evidence-emitters-filesystem.ts` 实现 artifact 流（独立）。ESLint rule 改为"禁止 worker A 跨 import worker B 的 evidence-emitters；统一从 `packages/workspace-context-artifacts` 导入"。
- **ESLint config 形态**：

```js
// .eslintrc — 概念示意
{
  rules: {
    "no-restricted-imports": ["error", {
      paths: [
        { name: "../filesystem-core/src/storage/errors", message: "use @haimang/storage-topology" },
        { name: "../agent-core/src/eval/metric-names", message: "use @haimang/eval-observability" },
      ],
      patterns: [
        { group: ["**/workers/*/src/evidence-emitters*"], message: "import from @haimang/workspace-context-artifacts" },
      ],
    }],
  },
}
```

- **一句话收口目标**：✅ **ESLint rule 落地；CI 在新增第三份重复实现或跨 worker import 时红；现有两份保持不动。**

#### F11: D1 `nano_audit_log` 表 + NACP `audit.record` 通道接电（v0.2 新增）

> 这是 v0.2 区别于 v0.1 的最大新增。**audit log 与 error log 是两条正交通道**：error 是"出错了"，audit 是"重要事件发生了"（含正常事件如登录成功、API key 发放、cross-tenant deny attempt）。

- **完整 DDL**（与 F4 同一 migration 文件）：

```sql
-- migration 006-error-and-audit-log.sql — RHX2 first-wave
-- Part 2: nano_audit_log (TTL 90d)

CREATE TABLE IF NOT EXISTS nano_audit_log (
  audit_uuid     TEXT PRIMARY KEY,         -- v7 UUID
  trace_uuid     TEXT,                     -- 关联 x-trace-uuid（可选；非请求触发时为空）
  session_uuid   TEXT,                     -- 可选
  team_uuid      TEXT NOT NULL,            -- audit 必有 team 维度
  user_uuid      TEXT,                     -- 可选；用户操作时填
  device_uuid    TEXT,                     -- 可选；设备操作时填
  worker         TEXT NOT NULL,            -- 触发 audit 的 worker
  event_kind     TEXT NOT NULL,            -- NACP audit.record event_kind（见下表）
  ref_kind       TEXT,                     -- audit.record body 的 ref.kind
  ref_uuid       TEXT,                     -- audit.record body 的 ref.uuid
  detail_json    TEXT,                     -- audit.record body 的 detail JSON 字符串；≤ 16 KiB（超长截断 + _truncated:true）
  outcome        TEXT NOT NULL CHECK (outcome IN ('ok','denied','failed')),
  created_at     TEXT NOT NULL             -- ISO 8601
);

CREATE INDEX IF NOT EXISTS nano_audit_log_team_kind_idx
  ON nano_audit_log(team_uuid, event_kind, created_at);
CREATE INDEX IF NOT EXISTS nano_audit_log_user_idx
  ON nano_audit_log(user_uuid, created_at);
CREATE INDEX IF NOT EXISTS nano_audit_log_session_idx
  ON nano_audit_log(session_uuid, created_at);
CREATE INDEX IF NOT EXISTS nano_audit_log_trace_idx
  ON nano_audit_log(trace_uuid);
```

- **first-wave 承接的 8 类 `event_kind`**：

| event_kind | 触发 worker | outcome | 触发条件 | 用途 |
|---|---|---|---|---|
| `auth.login.success` | orchestrator-auth | ok | JWT 签发 / WeChat code 交换成功 | 安全审计：谁何时登录 |
| `auth.api_key.issued` | orchestrator-auth | ok | 新 API key 创建 | 安全审计：API key 生命周期起点 |
| `auth.api_key.revoked` | orchestrator-auth | ok | API key 撤销 | 安全审计：终点（与 issued 配对） |
| `auth.device.gate_decision` | orchestrator-core | ok / denied | 跨设备 reattach / device gate 通过或拒绝 | 安全审计：设备绑定历史 |
| `tenant.cross_tenant_deny` | orchestrator-core | denied | 跨租户访问尝试被拒 | 安全审计：边界穿透事件 |
| `hook.outcome` | agent-core | ok / denied | hook 决策 `block` / `denied` 时（非 `continue`）；与 `agent-core/src/hooks/audit.ts` 现有逻辑对齐 | 行为审计：哪个 hook 拒绝了什么动作 |
| `session.attachment.superseded` | orchestrator-core | ok | attached WS 被 `reattach` / `revoked` 替换 | 客户端排障：解释“为什么当前连接被顶下线” |
| `session.replay_lost` | orchestrator-core | failed | HTTP `/resume` 返回 `replay_lost=true` | 客户端排障：解释“为什么必须回退到 timeline 全量补拉” |

> **first-wave 不承接** quota exceeded（已由 `nano_usage_events` 业务表覆盖）、tool call 全量（量太大）、高频 `session.start` / `session.end` 生命周期（session-registry 已覆盖）。但 **`attachment_superseded` / `replay_lost` 必须进 first-wave**，因为它们是 web / 微信小程序真实排障时最关键、且写量可控的边界事件。

- **写入路径**：
  1. caller worker（orchestrator-auth / orchestrator-core / agent-core）调用 `logger.audit(event_kind, {ref?, detail?})`。
  2. worker-logger 包装为 NACP `AuditRecordBody` 形态：`{event_kind, ref, detail}` + 顶层 envelope 字段（trace_uuid 等）。
  3. 调用 `AuditPersistFn`：
     - 在 orchestrator-core / orchestrator-auth：直接 await D1 write（`ctx.waitUntil()` 包裹）。
     - 在 agent-core：通过 `ORCHESTRATOR_CORE.recordAuditEvent(record)` RPC（已有 binding）。
  4. **不 dedupe**（audit 是事件流，每次都重要）。
  5. **不 fallback to console**（audit 是合规要求；写失败要让 critical alert 触发，severity=critical：`code='audit-persist-failed'`）。
- **TTL 清理**：alarm/cron 每天清理 `created_at < datetime('now','-90 days')`。
- **查询面**：
  - `/debug/audit?event_kind=...&team_uuid=...&since=...&limit=...` — owner-only（first-wave Q-Obs5 决议）；team 限制 + event_kind 过滤；返回 90d 内命中。
  - 前端 production **不直接读** `nano_audit_log`；如果某事件需要前端展示（如"上次登录时间"），由 orchestrator-core 暴露一个聚合 API 而不是开 audit log 直读。
- **边界**：
  - audit 写失败必触发 critical（与 error log 不同）。
  - `detail_json` 超 16 KB → 截断 + `_truncated: true`。
  - `team_uuid` NOT NULL —— 无 team 维度的 audit 不写（保护跨租户边界）。
- **一句话收口目标**：✅ **migration `006-error-and-audit-log.sql` 含 `nano_audit_log`；8 类 event_kind 各有 ≥1 写路径单测；TTL 90d；audit 写失败触发 critical alert（不静默）；`/debug/audit` owner-only 查询通；前端 production 路径不直读。**

#### F12: client-safe error meta 出口（v0.3 新增；GPT R1）

> 把"`resolveErrorMeta()` 只对服务端有意义"补到端到端可用：让 web `transport.ts` 与微信 `nano-client.js` 不再各自手搓 4 类分类。

- **形态候选**（由 Q-Obs10 三选一）：
  - **候选 a' — `@haimang/nacp-core/error-codes-client` 子路径导出**（v0.4 修订；Q-Obs10 已 owner-answered）：在已发布的 `@haimang/nacp-core` 内新增 `error-registry-client` 子模块，通过 `package.json` exports map 暴露 `./error-codes-client` sub-path；导出 `getErrorMeta(code) → ClientErrorMeta | undefined` + `ClientErrorCategory` 枚举（`auth.expired / quota.exceeded / runtime.error / request.error / validation.failed / security.denied / dependency.unavailable / conflict.state`，与现有 web/transport.ts 4 类向后兼容并扩展）；纯 TypeScript / 零 runtime 依赖；浏览器 + 微信小程序 build 时 import；nacp-core minor bump 1.4.0 → 1.6.0 重发 GitHub Packages。
  - **候选 a（已被 candidate a' 替代；保留作为讨论 history）** — 新建独立 `packages/error-codes-client/` npm 包：与 candidate a' 功能等价，但与 owner 长期"3 个 published 包"策略冲突，v0.4 撤销。
  - **候选 b — 静态文件 `docs/api/error-codes.json`**：CI 时由 server `listErrorMetas()` 反射生成；client 端通过 build 时 `fetch` 或 `require` 加载。
  - **候选 c — `GET /catalog/error-codes` 端点**：runtime 拉取；client 端缓存 + ETag。
- **`ClientErrorMeta` 形态**（与 server `ErrorMeta` 子集，去掉 server-only 字段）：

```ts
export type ClientErrorCategory =
  | "auth.expired"        // → server NACP "security" + facade "invalid-auth/refresh-*"
  | "quota.exceeded"      // → "quota" + "rate-limited"
  | "runtime.error"       // → "transient" / "dependency" / "permanent"
  | "request.error"       // → "validation" / "conflict"
  | "security.denied"     // → "security" 但不属于 auth.expired
  | "validation.failed"   // → "validation" 细分
  | "dependency.unavailable"  // → "dependency"
  | "conflict.state";     // → "conflict"

export interface ClientErrorMeta {
  code: string;
  category: ClientErrorCategory;   // 8 类（NACP 7 类 → client 8 类映射；与 web 现有命名兼容）
  http_status: number;
  retryable: boolean;
}

export function getErrorMeta(code: string): ClientErrorMeta | undefined;
export function classifyByStatus(status: number): ClientErrorCategory;  // fallback for unknown code
```

- **CI 一致性**：`packages/nacp-core/test/error-codes-client-coverage.test.ts` 断言 server `listErrorMetas()` 输出的每个 code 都在 client meta 中存在且 `category` 映射符合规则；CI 红即拦。
- **client 改造点**（first-wave 必做）：
  - `clients/web/src/apis/transport.ts:50-57` 现有 4 类 `auth.expired / quota.exceeded / runtime.error / request.error` 字符串保留向后兼容；内部实现切到 `getErrorMeta(envelope.error.code)?.category ?? classifyByStatus(status)`。
  - `clients/wechat-miniprogram/utils/nano-client.js:11-28 classifyError()` 同样切到 `getErrorMeta(...)`；与 web 复用同一份 client meta（小程序 build 时拷贝）。
- **边界**：
  - 候选 a 在小程序构建期需要拷贝（小程序不能直接 import `node_modules`）—— 由 build script 处理。
  - 未知 code（如 server 新增但 client 未升级）→ `getErrorMeta()` 返回 undefined，client fallback to `classifyByStatus(status)` 不报错。
- **一句话收口目标**：✅ **`@haimang/nacp-core/error-codes-client` 子路径导出落地（v0.4 形态；Q-Obs10 owner-answered）；web `transport.ts` 与微信 `nano-client.js` 不再各自手搓；CI 一致性测试通过；不新建独立包。**

#### F13: web + 微信小程序 `system.error` 消费改造 + 双发降级窗口（v0.3 新增；GPT R2）

> 把 F7 server 侧的 `system.error` 接电延伸到端到端可用：两端 client 同步消费，server 在窗口期内保持双发降级。

- **client 改造点**（first-wave 必做）：
  - **web** `clients/web/src/pages/ChatPage.tsx`：当前对 WS frame 没有 `system.error` 处理；新增 `case 'system.error'` 分支，按 `error.category` 分发 UI：
    - `security` → 跳转登录页 / 提示重新登录。
    - `quota` → 弹出超额提示 + 引导升级。
    - `transient` / `dependency` → toast 提示 + 自动 retry hint。
    - `permanent` / `validation` → banner 永久提示 + 不 retry。
  - **微信小程序** `clients/wechat-miniprogram/pages/session/index.js:123-155`：当前 switch 仅处理 `llm.delta` / `tool.call.*` / `turn.*` / `system.notify` / `session.update`；新增 `case 'system.error'` 分支，与 web 同步映射规则（小程序 UI 用 `wx.showToast` / `wx.showModal`）。
- **双发降级窗口策略**：
  - server F7 落地后立即开始 **`system.error` + `system.notify(severity=error)` 双发**：同一错误同时发两 frame，trace_uuid + code 一致；老 client（仅懂 `system.notify`）与新 client（懂 `system.error`）都能收到。
  - 窗口长度由 Q-Obs11 决定，**默认 4 周**；窗口结束前禁止切单发；窗口结束后 server 改为只发 `system.error`，老 client 不再收到 system.notify(severity=error)。
  - 窗口结束的判定条件：(a) web 与微信小程序至少一端发布 `system.error` 消费 PR；(b) 双发已运行至少 14 天观察期。
- **不在 first-wave 的 client 改造**：error toast UI 风格、详细文案、retry button 行为—— 由前端组装阶段决定，本簇仅约束"必须有 case 分支 + category 分发"。
- **边界**：
  - 双发降级窗口期间前端可能两 frame 都收到→ 按 trace_uuid + code dedupe（与 §7.2.5 F2×F7 交叉规则一致）。
  - 微信小程序 UI 受限（无浏览器 toast 库）→ 用 `wx.showToast` + `wx.showModal` 适配。
- **一句话收口目标**：✅ **web ChatPage + 微信小程序 session/index.js 都有 `case 'system.error'` 分支；按 `error.category` 分发 UI；server 双发降级窗口运行 ≥14 天后切单发；切换不破坏老 client UX。**

#### F14: 包来源单一真相门禁 + jwt-shared 0.1.0 首发（v0.5 新增；critical 门禁）

> 撤销 v0.4 把 jwt-shared 当 RHX3 carry-over 的错误判断。本节是 RHX2 closure 的硬门禁——不通过不允许宣告完成。

- **F14-a：jwt-shared 0.1.0 首发**：
  - bump `packages/jwt-shared/package.json` version `0.0.0 → 0.1.0`。
  - `pnpm --filter @haimang/jwt-shared run build` → `npm publish`（用 owner 已登录的 PAT）。
  - 验证：`curl -sI -H "Authorization: Bearer $NODE_AUTH_TOKEN" https://npm.pkg.github.com/@haimang%2Fjwt-shared` 返回 `HTTP 200`；versions 列表含 `0.1.0`。
  - 不删 `workspace:*` 引用——dev 时仍走 workspace symlink；deploy 时由 F14-c 门禁验证 workspace version === registry version。

- **F14-b：CI gate 脚本**：
  - 位置：`scripts/verify-published-packages.mjs`（新建）。
  - 流程：
    1. `for pkg in [@haimang/nacp-core, @haimang/nacp-session, @haimang/jwt-shared]:`
    2. 读 `packages/<basename>/package.json` 的 `version`。
    3. `curl -H "Authorization: Bearer $NODE_AUTH_TOKEN" https://npm.pkg.github.com/<encoded>` → JSON 中 `versions` 列表。
    4. 验证 workspace version 在 registry versions 列表中存在；否则 `process.exit(1)` + 打印 actionable error。
    5. （可选 strict 模式）下载 registry tarball → 比对 `packages/<basename>/dist/` SHA256；不一致 fail。
    6. 全部通过后输出 manifest snippet 给 build 阶段消费。
  - 调用点：`workers/<worker>/package.json` 的 `predeploy` script + CI workflow。

- **F14-c：built-package-manifest.json inline**：
  - 文件位置：build 时由 esbuild 注入到 worker bundle 的常量 `__NANO_PACKAGE_MANIFEST__`（不通过文件系统）。
  - 形态：

```ts
// 由 build 脚本生成、esbuild --define 注入的常量
declare const __NANO_PACKAGE_MANIFEST__: {
  build_at: string;          // ISO 8601
  worker: string;
  packages: Array<{
    name: "@haimang/nacp-core" | "@haimang/nacp-session" | "@haimang/jwt-shared";
    workspace_version: string;
    registry_version: string;
    registry_published_at: string;
    dist_sha256: string;
    match: boolean;
  }>;
};
```

- **边界情况**：
  - registry HTTP 503 → CI gate 短重试 3 次（exponential backoff）；仍 fail 则 deploy 中止，不允许 graceful degrade（这是门禁的全部价值）。
  - workspace `pnpm install` 没拉到最新 registry 版本（缓存）→ gate 验证 workspace truth 与 registry latest 是否一致，强制提示 `pnpm install` 后重试。
  - tarball SHA256 校验在 first-wave 标 optional（避免本地 build flag 不一致导致 false-positive）；后续 RHX3 转 mandatory。
- **一句话收口目标**：✅ **`@haimang/jwt-shared@0.1.0` 已发布到 GitHub Packages（HTTP 200 验证）；CI gate 在 6 worker 的 `predeploy` 阶段阻拦任何 workspace ↔ registry drift；6 worker bundle 都 inline 了 `__NANO_PACKAGE_MANIFEST__`；RHX2 closure 必须显示门禁通过证据。**

#### F15: `/debug/packages` 验证接口（v0.5 新增）

- **endpoint**：`GET /debug/packages`
- **auth**：team gate（与 `/debug/logs` 同；F5）；返回当前 caller team 视角的 manifest（manifest 内容跨 team 一致，但 endpoint 仍要求 auth 防止匿名扫描）。
- **响应形态**：见 §3.7.4 示例。
- **核心逻辑**：
  - `deployed`: 直接 serialize `__NANO_PACKAGE_MANIFEST__` 常量（O(1)，无 IO）。
  - `registry`: 对 3 个包并发拉 GitHub Packages metadata API；orchestrator-core 内 10 秒 LRU 缓存避免速率限制。
  - `drift`: 逐包计算 `deployed.version !== registry.latest_version`。
  - `fetched_at` 字段记录 registry 查询发生时刻。
- **边界**：
  - registry HTTP 失败 → `registry: null` + `error: "registry-unavailable"` 字段；不让整个 endpoint fail。
  - GitHub Packages PAT 在 worker runtime 不可用（worker 没 PAT 环境）→ 改用未授权 GET（GitHub Packages 公共部分允许；本仓库已开 access: restricted 时降级为只返 `deployed` 段并标注 `registry: "auth-not-available-in-runtime"`）；详见 Q-Obs13 决策。
  - rate limit：per-team 10 req/s。
- **测试**：
  - unit ≥4（drift=true / drift=false / registry-error / no-PAT 降级）。
  - e2e：preview deploy 后 curl `/debug/packages`，验 3 包 + drift=false。
- **一句话收口目标**：✅ **`/debug/packages` 在 6 worker preview + production 都返回 200；返回结构含 `deployed.{version,resolved_from,dist_sha256}` + `registry.{latest_version,published_at,fetched_at}` + `drift`；前端可以按这份响应做版本错配的故障复盘。**

### 7.3 非功能性要求与验证策略

- **性能目标**：
  - `nano_error_log` 写入 p95 < 50 ms（D1 同 region）。
  - `nano_audit_log` 写入 p95 < 80 ms（detail 较大可能慢一些）。
  - `Server-Timing` header 注入额外开销 < 1 ms。
  - worker-logger 序列化（JSON.stringify）开销 < 0.5 ms（典型 ctx ≤ 4 KB）。
  - dedupe LRU 容量 256 条，命中率 > 80%（critical 风暴时）。
- **可观测性要求**：
  - 任何 severity ≥ warn 的错误：(a) console 一行 JSON；(b) 内存环形缓冲；(c) D1 持久化（如可达）；(d) facade 响应 envelope 带 trace_uuid（HTTP 路径）；(e) WS `system.error` 推送（如 session attached 且 critical）。
  - 任何 severity = critical 的错误：(a)+(b)+(c) 必到 + console 前缀 `[CRITICAL]` + alerts envelope。
  - 任何 8 类 audit event：必到 D1 `nano_audit_log`；写失败必触发 critical alert。
- **稳定性要求**：
  - logger / D1 写失败不能让业务 path 失败（degrade silently）。
  - dedupe 命中不能误吞 critical（critical 不 dedupe）。
  - audit 不 dedupe（每条重要）。
- **安全 / 权限要求**：
  - `/debug/logs` 强制 **team gate**（**不是** RH3 device gate）。
  - `/debug/audit` 强制 **owner-only**（first-wave）。
  - `Server-Timing` 仅暴露 facade 粗粒度时序，不暴露 D1/R2/AI sub-call。
  - error context 字段 first-wave 走纪律：caller 显式不写敏感字段（API key、JWT、WeChat code、密码、refresh token、user_uuid 仅 audit 写、不进 error log）。
- **测试覆盖要求（v0.2 加严）**：
  - F1: ≥ 10 cases（4 级 × 有/无 ALS + critical + dedupe + 序列化失败回退 + DO/Worker-Shell 双模 + JSON schema 校验 ≥2 cases）。
  - F2: 6 worker 各 ≥ 5 cases（fetch handler error path）。
  - F3: docs 行数 = registry codes 数（≥80）；CI 一致性测试。
  - F4: ≥ 8 cases（写成功 / 写失败 fallback / dedupe / 速率限制 / TTL 清理 / context truncation / rpc_log_failed 标记 / critical 不 dedupe）。
  - F5: ≥ 6 cases（trace_uuid 查 / session_uuid 查 / 跨 team 拒 / rate-limit / 空命中 / `/debug/recent-errors`）。
  - F6: facade 出口 sample ≥ 5 个 case 验证 `Server-Timing` 头存在。
  - F7: ≥ 6 cases（schema / 兼容降级 / dedupe 三元组 / no-WS skip / 跨 worker forward / SystemErrorEventBodySchema 与 SystemErrorBodySchema 区分）。
  - F8: 3 类触发各 ≥ 1 case + 自写失败回退 + 空 metrics/traces 序列化省略 ≥ 1 case。
  - F9: bash-core ≥ 7 cases（每个 ad-hoc 路径 1）；orchestrator-auth ≥ 6 cases。
  - F10: ESLint rule fixtures（触发 / 不触发 / `packages/` > `workers/` 主份选择）。
  - **F11**: ≥ 10 cases（8 类 event_kind 各 1 + 写失败触发 critical alert + TTL 清理 + `/debug/audit` owner-only 拒绝非 owner）。
  - **F2 × F7 交叉**: ≥ 2 cases（同 trace_uuid 的 HTTP error + WS frame；不同 code 但同 trace_uuid）。
  - **F12（v0.3 新增）**: ≥ 5 cases（`getErrorMeta` 命中 / `getErrorMeta` 未知 code fallback / `classifyByStatus` 退路 / web 与微信小程序两端 import 同形 / CI 一致性测试 server `listErrorMetas` ↔ client meta 完整覆盖）。
  - **F13（v0.3 新增）**: ≥ 6 cases（web 收 `system.error` 按 category 分发 / 微信小程序同步分发 / 双发降级窗口期间老 client 仍收到 `system.notify(severity=error)` / 双发期间新 client 按 trace_uuid dedupe / 窗口结束后切单发 / 未知 category fallback）。
  - **总数估算**：≥ 86 unit cases + ≥ 10 live e2e（preview deploy 后）。
- **验证策略**：
  - unit：vitest cloudflare:workers，每个 F 独立 spec。
  - integration：preview deploy 后跑：
    - `test/package-e2e/orchestrator-core/15-error-log-smoke.test.mjs`（trace_uuid 链路 + `/debug/logs` 命中）。
    - `test/package-e2e/orchestrator-core/16-audit-log-smoke.test.mjs`（8 类 event_kind 各 1 写入 + 查询）。
    - `test/cross-e2e/15-system-error-frame.test.mjs`（agent-core kernel error → 前端收到 system.error WS frame；F2×F7 trace_uuid 一致）。
    - `test/cross-e2e/16-audit-cross-tenant-deny.test.mjs`（跨租户 deny 触发 audit event_kind=`tenant.cross_tenant_deny`）。
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
| `context/codex/codex-rs/log-db.rs` | SQLite 专用 logs 表 + batch insert + per-partition cap + 10d retention + 复杂 query | 表结构 + TTL + 索引 | 我们用 D1 替换 SQLite |
| `context/codex/codex-rs/codex-client/src/telemetry.rs` | `RequestTelemetry` trait | "请求级 telemetry trait" 抽象 | first-wave 不做；保留 seam |
| `context/codex/codex-rs/feedback/src/lib.rs` | 4 MiB 环形缓冲 + 分类 | 内存环形缓冲思路 | worker-logger 内置 200 条/worker |
| W3C `traceparent` propagation | 跨进程 trace 标准化 | 留 W3C 兼容 seam | first-wave 不实装 |

### 8.3 来自 claude-code

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---|---|---|---|
| `context/claude-code/utils/debug.ts` | `logForDebugging(message, {level})` 单一入口 | 单入口 + 5 级 + 环境变量过滤 | 我们 4 级 + critical |
| `context/claude-code/utils/errorLogSink.ts` | JSONL 文件写 + 内存环形（最近 100）+ `getInMemoryErrors()` 编程 API | 内存环形 + 编程读取 | F1 + F5 `/debug/recent-errors` |
| `context/claude-code/utils/errors.ts:3-100` | `ClaudeError` 基类 + `TelemetrySafeError` 双消息 | "TelemetrySafeError" 类型 | first-wave 走纪律 |
| `context/claude-code/utils/telemetry/sessionTracing.ts` | OTel span 4 类 + ALS 传播 | ALS 传播 | F1 用 ALS 注入 trace_uuid |

### 8.4 来自 gemini-cli

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---|---|---|---|
| `context/gemini-cli/packages/core/src/tools/tool-error.ts:14-83` | `ToolErrorType` enum 40+ + `isFatalToolError()` | 错误码按域分类 | 我们已 7 枚举分布 |
| `context/gemini-cli/packages/core/src/utils/googleErrors.ts` | 12 种 RPC error detail 解析 + `toFriendlyError()` | 错误归一管道 | F2 facade envelope 做归一 |

### 8.5 Sibling 项目（v0.2 新增）

| 文件:行 | 内容 | 借鉴点 | 备注 |
|---|---|---|---|
| `context/smcp/tests/error_registry.test.ts:1-24` | `registerErrorDefinition()` / `resolveErrorDefinition()` / `listErrorDefinitions()` | 运行时 registry API | F3 `resolveErrorMeta()` |
| `context/smind-contexter/core/log.ts:36-41` | `LogPersistFn` 类型 | 持久化解耦 | F1 显式定义类型 |
| `context/smind-contexter/core/log.ts:120-134` | DO/Worker-Shell 双模 | `ctx.waitUntil` vs await | F1 边界 |
| `context/smind-contexter/core/errors.ts:25-44` | `ErrorCodes` enum + `SkillException` | 错误类层次 | first-wave 不照搬；走 facade envelope |
| `context/smind-admin/src/infra/logger.ts:1-3` | `createConsoleProtocolLogger("smind-admin")` 单行接入 | 共享包接入形态 | F1 `createLogger(workerName)` 同形 |
| `context/smind-admin/src/infra/errors.ts:5-28` | `HttpError` 7 类 category + `mapErrorCategoryToStatus()` | category 系统 | **复用 NACP 原生 7 类**（已存在），不引入 smind-admin 副本 |
| `context/smind-admin/src/http/middleware.team.ts:4-12` | `requireTeam(auth)` | team gate 中间件形态 | F5 强制 team_uuid 过滤 |
| `context/wbca-mini/miniprogram/utils/api.js` | 微信小程序 API 调用层 | 受限 JS 环境的需求 | §2.1 audience 扩展 |

### 8.6 本仓库 precedent / 需要避开的反例

| 文件:行 | 问题 / precedent | 我们借鉴或避开的原因 |
|---|---|---|
| `workers/orchestrator-core/src/policy/authority.ts:31-39` | `facadeError()` 已在做 envelope + trace_uuid 头 | **借鉴**：F2 直接 re-export |
| `workers/agent-core/src/index.ts:135` | `{ error: "Not found" }` 裸 JSON | **避开**：F2 收口 |
| `workers/bash-core/src/index.ts:335,351,411` | `Method Not Allowed` 纯文本 | **避开**：F2 收口 |
| `workers/orchestrator-core/src/index.ts:1191` | `console.warn('models-d1-read-failed team=${teamUuid}', {...})` 半结构化 | **借鉴**：F1 第一参数改 string，第二参数 ctx 全结构化 |
| `workers/agent-core/src/host/do/session-do/runtime-assembly.ts (usage-commit)` | `console.log` 业务事件走 dev-only | **避开**：F1 切 `logger.info` |
| `workers/agent-core/src/hooks/audit.ts` | `buildHookAuditRecord` 已用 `AuditRecordBodySchema` | **借鉴**：F11 复用此 builder |
| `packages/nacp-core/src/messages/system.ts:10-22` | `AuditRecordBodySchema` + `SystemErrorBodySchema` 已注册 | F11 直接用 audit.record；F7 与 SystemErrorBodySchema 平行新建 SystemErrorEventBodySchema |
| `packages/nacp-core/src/error-registry.ts:5-13` | `NacpErrorCategorySchema` 7 类 | F3 直接复用；F1 LogRecord.category 取自此 |
| `packages/nacp-core/src/observability/envelope.ts` | `NacpObservabilityEnvelope` 0 emitter | F8 接电 |
| `workers/filesystem-core/src/storage/errors.ts` + `packages/storage-topology/src/errors.ts` | `StorageError` 重复 | F10：主份 = packages/ |
| `workers/agent-core/src/eval/metric-names.ts` + `packages/eval-observability/src/metric-names.ts` | metric names 重复 | F10：主份 = packages/ |
| `workers/context-core/src/{evidence-emitters-context,context-assembler,compact-boundary,snapshot}.ts` + `packages/workspace-context-artifacts/src/{evidence-emitters,context-assembler,compact-boundary,snapshot}.ts` | 双包并行实现 assembly/compact/snapshot 三流（**不是**字节级重复；GLM R11 校正）| F10：禁止 worker 之间互相 import；统一从 `packages/workspace-context-artifacts` |
| `workers/agent-core/wrangler.jsonc:49` | `ORCHESTRATOR_CORE` binding 已存在 | F4 复用；其他 3 worker 需新增 |
| `workers/{bash-core,context-core,filesystem-core}/wrangler.jsonc` | **缺 services 块**（v0.2 已核实） | F4 / F11 必须新增 binding × 2 env |

---

## 9. QNA / 决策登记与设计收口

### 9.1 需要冻结的 owner / architect 决策（v0.2 由 5 题增至 9 题）

> 拟新增进入 `docs/design/real-to-hero/RHX-qna.md`（编号沿用最后一个 Q 之后追加；下面用 `Q-Obs1..Q-Obs9` 占位）。

| Q ID | 问题 | 影响范围 | 当前建议 | 状态 |
|---|---|---|---|---|
| Q-Obs1 | `nano_error_log` / `nano_audit_log` 是否走 orchestrator-core 单写点 | F4 / F11 / 跨租户边界 | **走单写点**；caller 侧必须保留 `rpc_log_failed` console/memory fallback | answered |
| Q-Obs2 | RHX1 DDL SSOT 收敛后，RHX2 migration 编号是否直接承接 next slot = `006` | F4 / F11 落地时点 | **是，直接用 `006-error-and-audit-log.sql`** | answered |
| Q-Obs3 | `nano_error_log` TTL = 14d；`nano_audit_log` TTL = 90d 是否合适？是否需按 severity 分层 | F4 / F11 / 合规 | **first-wave 一刀切：error 14d / audit 90d**；分层延后 | answered |
| Q-Obs4 | `system.error` 是否新增 stream-event kind | F7 / 协议清洁度 | **新增 kind**；但 server rollout 必须伴随 web / 微信 client 消费路径同步补齐 | answered |
| Q-Obs5 | `/debug/logs` 与 `/debug/audit` 是否对 owner 全租户可见 | F5 / F11 | **`/debug/logs` 仅 team；`/debug/audit` owner-only**；不做全租户面板 | answered |
| **Q-Obs6（v0.2 新增）** | F11 first-wave audit event_kind 是否充分 | F11 写量 / 合规 | **不充分**；在原 6 类基础上补 `session.attachment.superseded` 与 `session.replay_lost` | answered |
| **Q-Obs7（v0.2 新增）** | F2 × F7 交叉时，HTTP envelope 与 WS frame 是否必须 code 一致 | §7.2.5 / 前端去重 | **trace_uuid 必一致；code 允许不同，但 UI 去重键必须是 `trace_uuid`** | answered |
| **Q-Obs8（v0.2 新增）** | TTL 清理用 DO alarm 还是 Cloudflare cron trigger | F4 / F11 / 运维 | **cron trigger** | answered |
| **Q-Obs9（v0.2 新增）** | bash-core 7 个 ad-hoc string codes first-wave 是否必须归化为 zod enum | F9 / F3 / RH3 contract | **不强制归化为 zod enum**；但必须进入 registry/docs 的 client-safe 映射面 | answered |
| **Q-Obs10（v0.3 新增；GPT R1）** | client-safe error meta 出口的形态 | F12 / 跨端复用 | **候选 a' = 扩展 `@haimang/nacp-core` 新增 `nacp-core/error-codes-client` 子路径导出（v0.4 修订）**：与候选 a 等价但不新建独立包；与 owner "只保留 3 个 published 包"长期策略一致。微信小程序 build 时反射 `node_modules/@haimang/nacp-core/dist/error-registry-client/data.js` 拷贝 JSON。候选 b/c 保留为 future fallback。 | answered |
| **Q-Obs11（v0.3 新增；GPT R2）** | `system.error` + `system.notify(severity=error)` 双发降级窗口长度 | F13 / client rollout / server 切单发时点 | **默认 4 周**（双发运行 ≥14 天观察期 + web/微信至少一端发布 `system.error` 消费 PR） | answered |
| **Q-Obs12（v0.3 新增；GPT R4）** | 三套 durable 真相（activity_logs / error_log / audit_log）的索引引用规则是否在 first-wave 强制 | §3.6 / 排障路径 | **强制 first-wave**：(a) audit 写时只引 `ref={kind, uuid}` 不复制 activity payload 全文；(b) error_log 不写"正常事件"；(c) cross-tenant deny 等安全事件主真相 = `nano_audit_log`，副真相 = `nano_error_log`（severity=warn）；(d) session 边界事件双写（audit + activity_log） | answered |
| **Q-Obs13（v0.5 新增；critical 门禁）** | jwt-shared 是否必须 RHX2 内正式发布（撤销 v0.4 RHX3 carry-over） | F14 / 包来源单一真相 / RHX2 closure 门禁 | **必须 RHX2 内发布**（首发 0.1.0）；RHX3 carry-over 是错误判断已撤销；不接受 "永久 workspace-only" 替代方案；不接受 "合并入 nacp-core" 替代方案 | answered |
| **Q-Obs14（v0.5 新增）** | `/debug/packages` 在 worker runtime 没有 GitHub Packages PAT 时如何拉 registry | F15 / 部署时 secret 注入 | **registry 段 graceful 降级**：worker runtime 不持有 PAT（避免长期凭据驻留 worker 环境）；`/debug/packages` 拉 registry 时使用 `GET https://npm.pkg.github.com/<encoded>` 不带 Authorization 头；GitHub Packages 对 restricted 包返 401 时，response 把 `registry` 段标 `"auth-not-available-in-runtime"`，**deployed 段始终可用**（来自 inline manifest）；如果 owner 后续启用 PAT 注入则切完整双段。**owner 与前端在 deployed 段不可用时应警觉，因为这意味着 build 时 manifest 没注入** | answered |

### 9.1.1 本轮代业主答复（GPT 代填）

- **Q-Obs1**：确认 `nano_error_log` / `nano_audit_log` 仍走 orchestrator-core 单写点。原因不是“方便”，而是当前 shared D1 truth、team 边界和 cross-worker authority 都集中在 orchestrator-core；但 durable 落库失败时，caller 侧必须保留 `console + memory-ring + rpc_log_failed:true` 的降级出口，不能把“单写点”做成“单点黑洞”。
- **Q-Obs2**：确认 RHX2 不再讨论 `011/012`。RHX1 已把当前 migration SSOT 收敛成 `001`–`005`，因此 RHX2 第一张新增 migration 的唯一合理编号就是 `006-error-and-audit-log.sql`。
- **Q-Obs3**：确认 first-wave retention 采用 `error = 14d`、`audit = 90d`，不做 severity 分层。14 天足够覆盖开发 / preview / 用户反馈回溯窗口，90 天才有资格承接安全 / 审计链路；按 severity 再分层会把 first-wave 过早拉向平台治理。
- **Q-Obs4**：确认新增 `system.error` stream-event kind；但这不是纯后端变更，必须把 web / 微信小程序对 `system.error` 的消费一并纳入交付，否则只会把当前“未知 kind”从日志噪音换成 UI 噪音。
- **Q-Obs5**：确认 `/debug/logs` 只允许 authenticated same-team 查询，`/debug/audit` 只允许 owner 查询本 team 范围，不做“owner 全租户自助面板”。跨租户排障继续走 `wrangler tail` / deploy-side 运维工具，不把产品面直接做成 control plane。
- **Q-Obs6**：否决“first-wave 仅 6 类 audit event_kind”。真实客户端最需要解释的不是 `session.start/end` 这种高频噪音，而是 **`attachment_superseded` 与 `replay_lost`** 这两类低频、高价值边界事件；因此 first-wave 审计集应扩成 8 类，仍然不引入高频 session 生命周期洪水。
- **Q-Obs7**：确认 F2 × F7 的强一致主键是 `trace_uuid`，不是 `code`。同一逻辑错误如果跨越 facade 包装层与 kernel/source 层，允许出现不同 code，但 UI 必须按 `trace_uuid` 去重，HTTP error 作为用户面主呈现，WS `system.error` 作为 telemetry / session-side 补充。
- **Q-Obs8**：确认 TTL 清理走 Cloudflare cron trigger，不走 DO alarm。原因很简单：错误 / 审计表是 shared D1 truth，不属于某个特定 DO 实例的生命周期；cron 比 alarm 更符合“全局 housekeeping”。
- **Q-Obs9**：确认 bash-core 的 7 个 ad-hoc string codes first-wave 不强制改成 zod enum；但它们不能继续停留在“只有 bash-core 自己知道”的状态，必须进入 runtime registry / docs 镜像的 client-safe 查询面，避免 web 与微信小程序继续各自手搓分类逻辑。

### 9.2 设计完成标准

设计进入 `frozen` 前必须满足：

1. Q-Obs1 ~ Q-Obs14 全部 owner 答复并落 `RHX-qna.md`（v0.5 新增 Q-Obs13/14）。
2. F1–F15 每项的"一句话收口目标"已被 owner 确认无歧义（v0.5 新增 F14 / F15）。
3. §6.1 的 10 个核心 tradeoff 已被 owner 接受（v0.5 新增取舍 10）。
4. §3.5 D1 migration next slot = `006` 已确定。
5. 已确认 RHX2 与 RH5 / RH6 的并行/串行关系（§2.1 依赖关系无冲突）。
6. §3.3 解耦对象 2 关于 service binding 的事实陈述与 wrangler.jsonc 实际状态一致（GLM R2 已修正于 v0.2）。
7. §3.6 三套 durable 真相职责边界 + 索引引用规则被 owner 接受（v0.3 新增；GPT R4 / Q-Obs12）。
8. F12 client meta 形态选定（Q-Obs10）+ F13 双发降级窗口长度选定（Q-Obs11）。
9. **§3.7 包来源单一真相门禁被 owner 接受（v0.5 critical 门禁；Q-Obs13/14）**。
10. **F14 包发布门禁 + jwt-shared 0.1.0 已发布证据；F15 `/debug/packages` 已实现并 preview 验证（v0.5 critical 门禁）**。
11. 所有影响 action-plan 执行路径的问题都已在本设计或 QNA register 中回答。

### 9.3 下一步行动

- **可解锁的 action-plan**：拟新建 `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`（在本设计 frozen 后）。
- **已同步更新的设计文档**：
  - `docs/design/real-to-hero/RHX-qna.md`（Q-Obs1..Q-Obs9 已追加并回填回答；Q-Obs10/11/12 待回填）。
- **需要同步更新的 wrangler.jsonc**：
  - `workers/bash-core/wrangler.jsonc`（preview + production env 新增 `ORCHESTRATOR_CORE` services binding）。
  - `workers/context-core/wrangler.jsonc`（同上）。
  - `workers/filesystem-core/wrangler.jsonc`（同上）。
  - 这 3 个修改属于 action-plan 范围，但本设计点名以避免遗漏。
- **需要协调的 client repo PR**（v0.3 新增；GPT R1/R2）：
  - `clients/web/src/apis/transport.ts:50-57` 切到 F12 `getErrorMeta(...)`。
  - `clients/web/src/pages/ChatPage.tsx` 新增 `case 'system.error'` 分支。
  - `clients/wechat-miniprogram/utils/nano-client.js:11-28` 切到 F12（小程序 build 拷贝形态）。
  - `clients/wechat-miniprogram/pages/session/index.js:123-155` 新增 `case 'system.error'` 分支。
- **进入 QNA register 的问题**：Q-Obs1 ~ Q-Obs12（v0.3 新增 Q-Obs10/11/12 待 owner 答复）。
- **不解锁的事**：RH5 / RH6 的 hard gate 不依赖 RHX2 完成（横切簇可与 RH5 并行；F4/F11 migration `006-error-and-audit-log.sql` 的落地时点取决于 Q-Obs2 已答复后的执行排期）。

---

## 10. 综述总结与 Value Verdict

### 10.1 功能簇画像（v0.5 重写）

> RHX2 是 nano-agent 的 **observability-and-audit 横切簇**，与 RH0–RH6 并列。它的存在形态是 **9 件组合**：(a) 1 个共享 logger（`@haimang/nacp-core/logger` 子路径导出）；(b) 2 张 D1 表（`nano_error_log` 14d + `nano_audit_log` 90d，与既有 `nano_session_activity_logs` 形成"三套真相 + 索引引用"分工）；(c) 1 套运行时 `resolveErrorMeta()` registry + 1 份 `docs/api/error-codes.md` 文档镜像 + **1 份 `nacp-core/error-codes-client` 子路径导出（F12）**；(d) 1 个 `system.error` stream-event kind 接电 + NACP `audit.record` 通道接电 + `NacpObservabilityEnvelope.alerts` 接电；(e) **3 个新增 endpoint**（`/debug/logs` + `/debug/audit` + `/debug/packages`）+ `Server-Timing` 头；(f) 3 个 worker 的 wrangler.jsonc 新增 `ORCHESTRATOR_CORE` service binding；(g) web `transport.ts` + 微信小程序 `nano-client.js` 切到 client meta；(h) web ChatPage + 微信小程序 session/index.js 新增 `case 'system.error'` 分支 + 服务端双发降级窗口（F13）；(i) **包来源单一真相门禁（F14）**：jwt-shared 0.1.0 首发 + CI gate 验证 workspace ≡ registry version + `built-package-manifest.json` inline 进 worker bundle。它覆盖 6 worker 错误路径 / 8 类 protocol audit / 端到端 client 闭环 / **包发布层闭环**。复杂度集中在六点：(1) `nano_error_log` 写入治理避免风暴；(2) 6 worker HTTP 入口 codemod；(3) 三套 durable 真相的语义/retention/权限严格分离；(4) F2×F7 交叉一致性；(5) client 端 PR 协调与双发降级窗口；(6) **包发布门禁与 deploy 链路集成**。

### 10.2 Value Verdict（v0.5 复评）

| 评估维度 | v0.1 | v0.2 | v0.3 | v0.5 | 一句话说明 |
|---|---|---|---|---|---|
| 对 nano-agent 核心定位的贴合度 | 5 | 5 | 5 | 5 | NACP 4 个观测留位接电 + audit.record 入 prod + client 端到端 + **包发布层闭环（v0.5）** |
| 第一版实现的性价比 | 5 | 4 | 4 | 4 | v0.5 加 F14/F15 = 1 publish + 1 CI gate + 1 endpoint，工作量再上一档；但封住"事实认知错误"无可妥协 |
| 对未来上下文管理 / Skill / 稳定性演进的杠杆 | 4 | 5 | 5 | 5 | F11 + F12 + **F14/F15** 让 hook outcome / 错误分类 / 包发布事实都可被前端与 owner 直接消费 |
| 对开发者自己的日用友好度 | 5 | 5 | 5 | 5 | trace_uuid + /debug/logs + Server-Timing + client meta + system.error UX + **/debug/packages** |
| 风险可控程度 | 4 | 4 | 4 | 4 | v0.5 在双发窗口外多一项 wild card：CI gate 阻塞 deploy；缓解：registry 短重试 + owner 立场宁停勿模糊 |
| **认知正确性**（v0.5 新增维度） | n/a | n/a | n/a | 5 | v0.4 把 jwt-shared 误判为 carry-over 已撤销；v0.5 不允许 phase 在事实-意图差距下宣告完成 |
| **综合价值** | 4.6 | 4.6 | 4.6 | **4.7** | v0.5 提升因为补齐 v0.4 critical 门禁认知错误；first-wave 必做 S1–S15；OTel 全套继续不做 |

---

## 附录

### A. 讨论记录摘要

- **分歧 1**（v0.1）：是否新增 `system.error` stream-event kind — **共识**：新增 kind（§6.1 取舍 5）；v0.2 进一步明确 `SystemErrorEventBodySchema` 与 `SystemErrorBodySchema` 平行（GLM R10）。
- **分歧 2**（v0.1）：错误持久化是否走 orchestrator-core 单写点 — **共识**：单写点（§6.1 取舍 3）；v0.2 补 fallback（GLM R3）。
- **分歧 3**（v0.1）：是否合并 7 个错误码枚举 — **共识**：保留分布、文档汇总（§6.1 取舍 2）；v0.2 升级为 runtime registry + docs 镜像（DeepSeek R1）。
- **分歧 4**（v0.1）：是否做 OTel SDK 完整接入 — **共识**：留 seam 不接（§6.1 取舍 1）。
- **分歧 5**（v0.2 新增）：error log 与 audit log 是否合一表 — **共识**：分两表（§6.1 取舍 7）。
- **分歧 6**（v0.2 新增）：F2 × F7 是否要强制 code 一致 — **共识**：仅 trace_uuid 强制一致；code 允许不同源（Q-Obs7）。
- **分歧 7**（DeepSeek S1）：smind-admin 与 nano-agent error response 格式差异是否 first-wave 收敛 — **共识**：不收敛；docs 附录登记。

### B. 版本历史

| 版本 | 日期 | 修改者 | 主要变更 |
|---|---|---|---|
| v0.1 | 2026-04-29 | Owner + Opus 4.7 (1M) | 初稿；F1–F10 + 6 大 tradeoff + Q-Obs1–5 |
| v0.2 | 2026-04-29 | Opus 4.7 (1M) | 吸收 DeepSeek (R1/R2/R3 + S1/S2/S3/S4/S5) + GLM (R1–R12) 审查：(a) 新增 F11 audit-log 表 + NACP audit.record 通道接电；(b) F3 升级为 runtime registry + docs 镜像 + CI 一致性；(c) F4 / F11 给出完整 DDL；(d) F4 加 fallback；(e) F5 鉴权改 team gate（device gate 误用修正）；(f) F6 范围明确仅 orchestrator-core HTTP 出口；(g) F7 schema 修正：`SystemErrorEventBodySchema` 复用 `NacpErrorSchema`，与 `SystemErrorBodySchema` 平行；dedupe 改三元组；(h) F8 envelope 序列化省略空字段；(i) F9 给出完整错误路径枚举 + ad-hoc code 归化方式；(j) F10 主份选择规则 + evidence-emitters 描述更正；(k) §3.3 解耦对象 2 service binding 事实校正；(l) §6.1 取舍 7 + 8 新增；(m) §2.1 受众扩展含微信小程序；(n) §7.2.5 F2 × F7 交叉规则新增；(o) Q-Obs6/7/8/9 新增。 |
| v0.3 | 2026-04-29 | Opus 4.7 (1M) | 吸收 GPT (R1/R2 blocker + R3/R4 follow-up) 审查 + 关键事实校正：(a) **migration baseline 校正**：当前 SSOT 是 `001-005`（RHX1 后），所有 `011/012` 引用全部改为 `006-error-and-audit-log.sql`；(b) **新增 F12 client-safe error meta 出口**（`packages/error-codes-client` 推荐）：终止 `clients/web/src/apis/transport.ts:50-57` 与 `clients/wechat-miniprogram/utils/nano-client.js:11-28 classifyError()` 各自手搓；(c) **新增 F13 web + 微信小程序 `system.error` 消费改造 + 双发降级窗口**：避免 server 单边接电变 "未知 kind" 噪音；(d) **F11 first-wave 6→8 类 audit event_kind**：补 `session.attachment.superseded` + `session.replay_lost`；(e) **新增 §3.3 解耦对象 5**：client-safe error meta 必须独立于 worker-logger 包；(f) **新增 §3.6 三套 durable 真相职责边界**：`nano_session_activity_logs`（migration 002 已存在）/ `nano_error_log`（本簇新增）/ `nano_audit_log`（本簇新增）的"主真相 + 索引引用"分工规则；(g) §5.1 新增 S12 + S13；(h) §6.1 新增取舍 9（client rollout in-scope）；(i) §6.2 新增 3 行风险（client 不消费 / 手搓分类继续漂移 / 三套真相职责混淆）；(j) §7.1 新增 F12/F13 行；(k) §7.3 测试要求扩到 ≥86 unit + ≥10 e2e；(l) Q-Obs10/11/12 新增；(m) §10.1 画像扩为 8 件；(n) §10.2 v0.3 评级列。 |
| v0.4 | 2026-04-29 | Opus 4.7 (1M) | 吸收 owner 包退役策略反馈 + 事实核查 `jwt-shared` 未发布到 GitHub Packages：(a) **撤销新建 `packages/worker-logger/` 与 `packages/error-codes-client/`**：F1 改为扩展 `@haimang/nacp-core` 新增 `nacp-core/logger` 子路径导出；F12 改为新增 `nacp-core/error-codes-client` 子路径导出（candidate a'）；nacp-core minor bump 1.4.0 → 1.5.0 重发 GitHub Packages；与 owner 长期"3 个 published 包（nacp-core / nacp-session / jwt-shared）"策略一致；(b) **Q-Obs10 重写**：candidate a → candidate a'（子路径导出），保持 owner-answered 状态；(c) **登记 `@haimang/jwt-shared` 未发布事实**作为 RHX3 carry-over：当前 GitHub Packages HTTP 404，`workspace:*` + `pnpm-workspace.yaml/packages/*` symlink + `prebuild`/`pretest` hook 三层兜底让本地 / preview / production 都"看不见"这个 404；不在 RHX2 范围内修复，由 RHX3 在 (i) 正式发布 / (ii) 永久 workspace-only / (iii) 合并入 nacp-core 三选一；(d) §1.1 关键术语 / §3.3 解耦对象 5 / §5.1 S1 / S12 / §6.1 取舍 9 / §6.2 / §7.1 F12 / §7.2 F12 详细 / §7.2 F12 收口目标 全部同步形态修订；(e) action-plan 同步落 v0.draft-r2（`docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` §0-prefix + §10）。**v0.5 已撤销 (c) 中"RHX3 carry-over"的判断**——见 v0.5 行。 |
| v0.5 | 2026-04-29 | Opus 4.7 (1M) | 撤销 v0.4 中 "jwt-shared 未发布 = RHX3 carry-over" 的错误判断（owner 反馈：这是 critical 门禁认知错误，不是可推迟项）。**重大修订**：(a) **`jwt-shared@0.1.0` 必须 RHX2 内正式发布**（Q-Obs13 已 owner-answered）；(b) **新增 §3.7 包来源单一真相门禁**：published vs workspace-only 二分原则、jwt-shared 必须发布、CI gate 实现要点；(c) **新增 F14 包来源单一真相门禁**：jwt-shared publish + CI gate `verify-published-packages.mjs` + `built-package-manifest.json` inline 进 worker bundle；(d) **新增 F15 `/debug/packages` 验证接口**：让 owner / 前端故障复盘时一次 GET 拿到 deploy 时刻 truth + registry 实时 truth + drift 标记；(e) §5.1 新增 S14 + S15；§6.1 新增取舍 10（包来源唯一真相 vs 接受 carry-over vs 永久 workspace-only）；§6.2 新增 3 行风险（包来源认知模糊 / registry 速率 / CI gate 503 阻断）；§7.1 新增 F14/F15 行；Q-Obs13/14 新增；§9.2 设计完成标准新增 9/10 两条；§10.1 画像由 8 件扩为 9 件；§10.2 新增"认知正确性"维度（v0.5）；综合价值 4.6 → 4.7。 |
