# Nano-Agent 代码审查 — RHX2 阶段完整审查

> 审查对象: `real-to-hero / RHX2 Observability & Auditability 全阶段`
> 审查类型: `code-review`
> 审查时间: `2026-04-30`
> 审查人: `DeepSeek v4-pro（独立审查，未参考其他 reviewer 报告）`
> 审查范围:
> - `docs/charter/plan-real-to-hero.md`（基石纲领）
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`（执行文件 + 工作日志）
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`（设计文档 v0.5 frozen）
> - `docs/issue/real-to-hero/RHX2-closure.md`（收尾文件）
> - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`（双发窗口文档）
> - `packages/nacp-core/src/observability/logger/` 全量 11 文件
> - `packages/nacp-core/src/error-registry.ts` + `packages/nacp-core/src/error-registry-client/` 全量
> - `workers/orchestrator-core/src/`（observability, debug/packages, entrypoint, cron/cleanup, index, user-do-runtime）
> - `packages/nacp-session/src/stream-event.ts`
> - `clients/web/src/apis/transport.ts` + `clients/web/src/apis/debug.ts`
> - `clients/web/src/pages/ChatPage.tsx`
> - `clients/web/src/components/inspector/InspectorTabs.tsx`
> - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
> - `scripts/verify-published-packages.mjs` + `scripts/generate-package-manifest.mjs`
> - 6 worker `src/` 全部（logger 导入 + `console.*` 残留检查）
> - `clients/api-docs/{error-index,session-ws-v1,worker-health,README}.md`
> - `docs/api/error-codes.md`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`（上游 charter，本阶段边界）
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`（工作项定义、收口标准）
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`（F1-F15 功能设计）
> - `docs/issue/real-to-hero/RHX2-closure.md`（closure claim）
> 文档状态: `changes-requested`

---

## 0. 总结结论

- **整体判断**: `RHX2 后端 observability/auditability 主线主体成立，代码实现与设计高度一致，closure 中关于相位收口的 claim 经代码逐项验证基本成立。但存在 7 项 substantive findings（含 2 项 critical），以及 clients/api-docs 与代码注册表之间的系统性漂移需修正后方可全量闭合。`

- **结论等级**: `changes-requested`

- **是否允许关闭本轮 review**: `no`

- **本轮最关键的 3 个判断**:
  1. `6 worker 全部接入了 nacp-core/logger，裸 console.* 已从 prod 路径绝迹；8 类 audit event_kind 全部存在真实写路径；4 个 /debug 端点均已通电；cron 清理已注册——后端主体实现质量超出预期。`
  2. `FACADE_ERROR_METAS 与 AUTH_ERROR_METAS 数组为空（error-registry.ts:212/218），导致 listErrorMetas() 不含 facade/auth 独立条目，与设计文档 F3 "80+ codes 全覆盖"存在来源缺口；clients/api-docs/error-index.md 登记的 17 个 ad-hoc wire codes 未进入注册表，形成 docs ↔ registry 双向漂移。`
  3. `Phase 9 未切单发不是 failure（closure 明确登记了 gate-evaluated 判断），但 closure §5 将 wechat-miniprogram 整端标记为 deferred、且该 deferral 原因与 action-plan §8.2 #6 的收口标准（至少一端 client PR merge）存在表述张力，需在 closure 中同步修正。`

---

## 1. 审查方法与已核实事实

- **对照文档**:
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` (v0.draft-r3, 844 行)
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` (v0.5 frozen, 15 项 F1-F15)
  - `docs/charter/plan-real-to-hero.md` (real-to-hero 基石纲领，RHX2 横切定位)
  - `docs/issue/real-to-hero/RHX2-closure.md` (closure claim)
  - `docs/issue/real-to-hero/RHX2-dual-emit-window.md` (双发窗口记录)

- **核查实现**:
  - `packages/nacp-core/src/observability/logger/` 11 文件全量
  - `packages/nacp-core/src/error-registry.ts` (323 行) + `error-registry-client/` (4 文件)
  - `workers/orchestrator-core/src/observability.ts` (178 行)
  - `workers/orchestrator-core/src/debug/packages.ts` (153 行)
  - `workers/orchestrator-core/src/entrypoint.ts` (129 行，含 RPC 面 + cron)
  - `workers/orchestrator-core/src/cron/cleanup.ts` (37 行)
  - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql` (103 行)
  - `packages/nacp-session/src/stream-event.ts` (108 行)
  - `clients/web/src/apis/transport.ts` (163 行)
  - `clients/web/src/apis/debug.ts` (73 行)
  - `clients/web/src/pages/ChatPage.tsx` (740 行，system.error 处理 + dedupe)
  - `clients/api-docs/{error-index,session-ws-v1,worker-health,README}.md`
  - `docs/api/error-codes.md` (212 行)
  - `scripts/verify-published-packages.mjs` (213 行)
  - 6 worker `src/` 全量（logger 导入 + `console.*` 残留扫描）
  - `packages/nacp-core/package.json` (v1.6.0) + `packages/jwt-shared/package.json` (v0.1.0)
  - 4 wrangler.jsonc（bash-core/context-core/filesystem-core 的 ORCHESTRATOR_CORE binding + orchestrator-core 的 cron/RHX2 flag）

- **执行过的验证**:
  - 对 6 worker `src/` 逐一 grep 确认：裸 `console.*` = 0（仅 nacp-core/logger 内部 export 的 consoleSink 是规范出口）
  - 对 8 类 audit event_kind 逐一确认存在真实写路径（`orchestrator-auth/service.ts`、`orchestrator-core/auth.ts`、`orchestrator-core/index.ts`、`agent-core/hooks/audit.ts`、`orchestrator-core/user-do/ws-runtime.ts`、`orchestrator-core/user-do/surface-runtime.ts`）
  - 确认 4 个 `/debug/*` 路由在 `orchestrator-core/src/index.ts:586-608` 已接线，由 `authenticateDebugRequest()` 保护
  - 确认 cron cleanup 在 `entrypoint.ts:48-60` 已接线，wrangler.jsonc `crons: ["0 3 * * *"]` 已配置
  - 核对 `system-error.ts` 双发机制：`tryEmitSystemError()` 在 `dualEmitSystemNotifyError` 默认打开时同步 emit `system.notify(severity="error")`
  - 核对 `nacp-session/stream-event.ts` 的 `SystemErrorKind` schema 与 `SystemNotifyKind` 允许可选 `code`/`trace_uuid`
  - 核对 `clients/web/transport.ts` 使用了 `getErrorMeta()` + `classifyByStatus()`，保留 4 类 `ApiError.kind` 向后兼容
  - 核对 `clients/web/ChatPage.tsx` 的 `addSystemError()` + `shouldSuppressDualNotify()` (1s 去重)

- **复用 / 对照的既有审查**:
  - 无。本轮为独立审查，未参考 `docs/code-review/real-to-hero/RHX2-P1-3-reviewed-by-{GLM,GPT,kimi}.md` 或 `docs/design/real-to-hero/RHX2-observability-and-auditability-reviewed-by-{deepseek,GLM,GPT}.md`。

### 1.1 已确认的正面事实

- `F1 (logger)`：`packages/nacp-core/src/observability/logger/` 11 文件完整实现了 5 级日志（含 critical）、ALS trace 上下文注入、200 条环形缓冲、dedupe LRU、LogPersistFn/AuditPersistFn 类型解耦、DO/Worker-Shell 双模适配。6 worker 全部通过 `@haimang/nacp-core/logger` 子路径导入，无一直接调用 `console.*`。
- `F2 (facade envelope)`：`respondWithFacadeError()` + `attachServerTimings()` 在 `respond.ts` 中实现完备，已在 `index.ts` 中 re-export。
- `F3 (error registry)`：`error-registry.ts` 含 78 个 code 映射（RPC 30 + NACP 19 + Kernel 6 + Session 8 + LLM 8 + ad-hoc 7），`resolveErrorMeta()` + `listErrorMetas()` API 完备。
- `F4 (nano_error_log)` + `F11 (nano_audit_log)`：DDL 在 `006-error-and-audit-log.sql` 中正确落地，含 8 个索引、CHECK 约束、外键。`observability.ts` 的 `persistErrorLogRecord()` + `persistAuditRecord()` 实现了 D1 写入路径，含 fallback alert 触发。
- `F5 (debug endpoints)` + `F6 (Server-Timing)`：4 个 debug 路由已在 `index.ts` 中接线。`attachServerTimings()` 存在且可被 facade 出口调用。
- `F7 (system.error kind)`：`SystemErrorKind` schema 已加入 `stream-event.ts` 的 discriminated union（第 67-72 行）。`buildSystemErrorEvent()` + `tryEmitSystemError()` 实现在 nacp-core/logger 中，支持 dedupe + fallback notify。
- `F8 (critical alerts)`：`emitObservabilityAlert()` 在 `alerts.ts` 中实现，在 `observability.ts` 的 D1 写失败路径中被调用。
- `F9 (bash-core / orchestrator-auth logging)`：bash-core `index.ts` 导入 `createLogger` + `respondWithFacadeError`。orchestrator-auth `service.ts` 导入 `recordAuditEvent`。两 worker 均已终结 0 console 状态。
- `F11 (8 audit event_kinds)`：全部 8 类 event_kind 在源码中有真实的非测试写路径。
- `F12 (client error meta)`：`error-registry-client/` 实现了 `getErrorMeta()` + `classifyByStatus()` + 8 类 `ClientErrorCategory`，零 runtime 依赖。`clients/web/transport.ts` 已采纳。
- `F13 (dual emit)`：双发机制在 `system-error.ts` 中正确实现，`DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true`。web `ChatPage.tsx` 的 `shouldSuppressDualNotify()` 按 `trace_uuid + code + 1s` 去重。
- `F14 (package truth gate)`：`verify-published-packages.mjs` (213 行) 实现了 workspace ↔ registry 版本对齐 + 3 次重试 + 非零退出 + manifest 持久化。
- `F15 (/debug/packages)`：`debug/packages.ts` 实现了 inline manifest 读取 + registry 实时查询 + 10s LRU 缓存 + drift 检测 + graceful 降级（无 PAT 时返回 `auth-not-available-in-runtime`）。
- `cron cleanup`：`cron/cleanup.ts` 实现错误日志 14d / 审计日志 90d TTL 清理；`entrypoint.ts:48-60` 的 `scheduled()` handler 已接线；wrangler.jsonc `crons: ["0 3 * * *"]` 已配置。
- `migration 006`：DDL 与设计 v0.5 §7.2 F4/F11 完全一致（表结构、索引、约束、外键、CHECK、注释中的 8 类 event_kind）。
- `jwt-shared v0.1.0`：`packages/jwt-shared/package.json` 版本已从 `0.0.0` 升级为 `0.1.0`，`publishConfig` 保留。
- `nacp-core v1.6.0`：`packages/nacp-core/package.json` 版本从 `1.4.0` 升级为 `1.6.0`，`exports` map 含 `./logger` + `./error-codes-client` 子路径。

### 1.2 已确认的负面事实

- `FACADE_ERROR_METAS` 数组为空（`error-registry.ts:212`：`const FACADE_ERROR_METAS: readonly ErrorMeta[] = []`），`AUTH_ERROR_METAS` 同样为空（`error-registry.ts:218`）。虽然注释解释为"1:1 对齐 RPC 条目"，但设计文档 F3 明确列出 FacadeErrorCode (32) 和 AuthErrorCode (13) 为独立来源，且 `listErrorMetaSources()` 返回 `["rpc", "nacp", "kernel", "session", "llm", "ad-hoc"]`——不包含 `"facade"` 和 `"auth"`。这意味着 facade/auth 独有的 code 不会被注册，且 `ErrorMeta.source` 在 facade/auth code 被命中时返回 `"rpc"` 而非 `"facade"`/`"auth"`。
- `clients/api-docs/error-index.md` 的 §"Current Ad-hoc Public Codes" 登记了 17 个 ad-hoc wire codes（`missing-team-claim` / `invalid-auth-body` / `invalid-start-body` / `invalid-input-body` / `invalid-auth-snapshot` / `session_missing` / `session-pending-only-start-allowed` / `session-expired` / `session-already-started` / `session_terminal` / `agent-start-failed` / `agent-rpc-unavailable` / `agent-rpc-throw` / `models-d1-unavailable` / `context-rpc-unavailable` / `filesystem-rpc-unavailable` / `payload-too-large`），但只有 7 个 bash-core 的 ad-hoc code 进入了 `error-registry.ts` 的 `AD_HOC_ERROR_METAS` 数组。其余 10 个 wire codes 是真实存在的运行时字符串，但在 server 端 `resolveErrorMeta()` 返回 `undefined`，在 client 端 `getErrorMeta()` 回退到 `classifyByStatus()`。
- `createOrchestratorLogger()`（`observability.ts:170-178`）仅传入了 `persistError` 回调，**未传入 `persistAudit` 回调**。审计日志的 D1 写入走的是 `entrypoint.ts:67-69` 的 `recordAuditEvent()` RPC 方法（直接调用 `persistAuditRecord()`），不通过 Logger 的 `audit()` 方法的 `AuditPersistFn` 管道。这导致 Logger 实例上的 `audit()` 方法在 orchestrator-core 中只会记录到 console，不会写 D1——这不是 bug（因为 audit 走 RPC 而非 Logger.audit()），但事实上形成了两条分离的 audit 写入路径，与设计文档中"audit 走 Logger.audit() + AuditPersistFn 统一管道"的意图存在实现分裂。
- Phase 9 closure 声明不切单发，原因是 Q-Obs11 的观察窗口未满足 + wechat-miniprogram 完整适配后移。这是 gate-evaluated 决策，技术上正确。但 closure §5 将 wechat-miniprogram 标记为 deferred 时，action-plan §8.2 #6 的收口标准是"至少一端 client PR merge"——web 端已 merge，所以该收口标准事实上已满足。closure 应更新表述：说明 web 这端已满足 "至少一端"，但不切单发是因为"双端未齐 + 观察期不足"这两项实际 gate 条件，而非"至少一端"未满足。
- `_byCode` Map 最后 `ad-hoc` 的 `session-not-found` code 会覆盖 `rpc` 的 `not-found` code——但在当前注册表里 ad-hoc 使用的是 `session-not-found`（带 `session-` 前缀）而非 `not-found`，所以实际上没有冲突。但如果有将来新增的 ad-hoc code 与已有的 RPC/Facade code 同名，`listErrorMetas()` 会静默用最后一个覆盖，`resolveErrorMeta()` 返回的记录会丢失更早 source 的信息。当前数据安全，但结构存在隐患。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | yes | 逐一核对 closure claim 中的每个功能点对应的源文件与具体行号 |
| 本地命令 / 测试 | no | 环境限制，未执行 `pnpm test` / `npm run build` 等本地验证命令 |
| schema / contract 反向校验 | yes | 核对了 migration DDL ↔ 设计文档 schema；`SystemErrorKind` zod schema ↔ `NacpErrorSchema` 复用关系；`NacpErrorCategorySchema` 7 类枚举的一致性 |
| live / deploy / preview 证据 | no | 基于 closure 的 self-report，未独立验证 preview/production deploy 状态 |
| 与上游 design / QNA 对账 | yes | 逐项对标了 design v0.5 的 F1-F15 功能描述、action-plan v0.draft-r3 的 P1-P9 工作项、以及 charter 的 RHX2 横切定位 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | FACADE_ERROR_METAS / AUTH_ERROR_METAS 空数组导致注册表来源缺口 | high | docs-gap + scope-drift | no | 补全 facade/auth 独立条目或显式冻结"合并到 RPC source 是设计结果"并在 docs 中同步 |
| R2 | clients/api-docs/error-index.md 登记的 10 个 wire codes 未进入注册表 | high | docs-gap | yes | 将这 10 个已知 wire codes 补入 AD_HOC_ERROR_METAS 或在 docs 中标注"非注册 code" |
| R3 | createOrchestratorLogger 未传入 persistAudit callback，audit 写入存在双路径分裂 | medium | correctness | no | 统一 audit 写入路径：要么全部走 Logger.audit() + AuditPersistFn，要么显式文档化双路径 |
| R4 | closure §5 deferred 表关于 wechat-miniprogram 的表述与收口标准存在张力 | medium | docs-gap | no | 更新 closure 表述，说明 web 已满足"至少一端"，但不切单发是因为双端未齐 + 观察期不足 |
| R5 | error-registry.ts 的 last-write-wins Map 结构在将来 code 冲突时存在静默覆盖风险 | low | platform-fitness | no | 添加 CI 测试：断言 `_RAW_ERROR_METAS` 中不存在跨 source 的重复 code |
| R6 | dual-emit-window.md 声明状态为 `active-spike-window`，但代码中双发默认开启，closure 称不切单发——三者一致，但文档中 `dual_emit_started_at` 未更新到 web spike 完成后的最新时间 | low | docs-gap | no | 在 dual-emit-window.md 中追加 web spike 完成时点记录 |
| R7 | `drift` 检测逻辑在 workspace version 领先于 registry 时存在表达歧义 | low | platform-fitness | no | 在 `drift` 响应中增加 `drift_direction: "workspace_ahead" | "workspace_behind" | "aligned"` 字段 |

### R1. FACADE_ERROR_METAS / AUTH_ERROR_METAS 空数组导致注册表来源缺口

- **严重级别**: `high`
- **类型**: `docs-gap + scope-drift`
- **是否 blocker**: `no`
- **事实依据**:
  - `packages/nacp-core/src/error-registry.ts:212`: `const FACADE_ERROR_METAS: readonly ErrorMeta[] = [];`
  - `packages/nacp-core/src/error-registry.ts:218`: `const AUTH_ERROR_METAS: readonly ErrorMeta[] = [];`
  - `packages/nacp-core/src/error-registry.ts:321-322`: `listErrorMetaSources()` 返回 `["rpc", "nacp", "kernel", "session", "llm", "ad-hoc"]` ——不含 `"facade"` 和 `"auth"`
  - 设计 v0.5 §7.2 F3 明确列出: `FacadeErrorCode` (32) — `packages/orchestrator-auth-contract/src/facade-http.ts:48` 和 `AuthErrorCode` (13) — `packages/orchestrator-auth-contract/src/auth-error-codes.ts:3` 为独立来源
- **为什么重要**:
  - 任何 facade-only code（将来可能不 1:1 对齐 RPC 条目）不会被注册
  - `listErrorMetaSources()` 声称列出了所有来源但遗漏了 `"facade"` 和 `"auth"`，破坏 API 契约
  - 设计文档与实现之间存在 scope-drift：设计说"80+ codes 全覆盖 (7 来源)"，实现实际是"78 codes (6 来源 after dedupe)"
- **审查判断**:
  - 当前实现选择不重复注册 1:1 对齐的 code，是一个合理的工程取舍。但注释中的"Every Facade code currently aligns 1:1"是一个时间敏感的假设——facade 未来新增独立 code 时，注册表会自动漏掉
  - `listErrorMetaSources()` 应诚实地返回当前实际覆盖的来源集，或补全 facade/auth 条目
- **建议修法**:
  1. 将 `listErrorMetaSources()` 的注释从 "Distinct sources currently represented in the registry" 改为显式说明 facade/auth 已合并到 rpc source
  2. 或者：补全 FACADE_ERROR_METAS 和 AUTH_ERROR_METAS 中各 code 的独立条目（即使字段值与 RPC 条目相同），并在 `listErrorMetaSources()` 中加入 `"facade"` 和 `"auth"`
  3. 在 `docs/api/error-codes.md` 中新增 §2. FacadeErrorCode 和 §3. AuthErrorCode 两段，交叉引用到 §1 RpcErrorCode（标记"code 相同，登记在此以便按 source 检索"）

### R2. clients/api-docs/error-index.md 登记的 10 个 wire codes 未进入注册表

- **严重级别**: `high`
- **类型**: `docs-gap`
- **是否 blocker**: `yes`
- **事实依据**:
  - `clients/api-docs/error-index.md:71-92` ("Current Ad-hoc Public Codes") 登记了 17 个 ad-hoc wire codes
  - `packages/nacp-core/src/error-registry.ts:266-274` 的 `AD_HOC_ERROR_METAS` 仅包含 7 个 bash-core ad-hoc codes，**不包含**以下 10 个:
    - `missing-team-claim` (403, auth/session/debug)
    - `invalid-auth-body` (400, auth proxy)
    - `invalid-start-body` (400, `/sessions/{id}/start`)
    - `invalid-input-body` (400, `/sessions/{id}/input`)
    - `invalid-auth-snapshot` (400, `/start` internal auth)
    - `session_missing` (404, session DO routes)
    - `session-pending-only-start-allowed` (409, session DO)
    - `session-expired` (409, pending start)
    - `session-already-started` (409, `/start`)
    - `session_terminal` (409, follow-up/WS)
- **为什么重要**:
  - 这 10 个 code 是**真实的运行时字符串**——客户端会在 HTTP 响应和 WS frame 中收到它们
  - 当前实现中 `resolveErrorMeta("missing-team-claim")` 返回 `undefined`，`getErrorMeta("missing-team-claim")` 降级到 `classifyByStatus(403)` → `"auth.expired"`——语义错误（missing-team-claim 不一定是 token 过期）
  - 设计文档 F3 的"80+ codes 100% 命中"目标未达成——因为有多少 code 在注册表中取决于你统计的方案，而这 10 个真实 wire codes 确实不在注册表
- **审查判断**:
  - `clients/api-docs/` 是面向客户端开发者的权威文档，它登记的 ad-hoc code 必须与 `error-registry.ts` 一致
  - 两个方向都可以：要么把这 10 个 code 补入 `AD_HOC_ERROR_METAS`，要么在 api-docs 中标注"以下 code 尚未进入注册表，客户端请用 HTTP status fallback"
  - 当前状态是"docs 说有、registry 没有"——这是事实矛盾
- **建议修法**:
  1. 将 10 个缺失的 wire codes 补入 `AD_HOC_ERROR_METAS` 数组，赋予合理的 category/http_status/retryable
  2. 同步更新 `docs/api/error-codes.md` §8 ad-hoc 段，加入这 10 个 code
  3. 或：在 `clients/api-docs/error-index.md` 中将这 10 个 code 标注为 "**not yet in registry** — client MUST use HTTP status fallback"
  4. 务必确保 CI 一致性测试能在 registry 与 docs 之间自动捕获漂移

### R3. createOrchestratorLogger 未传入 persistAudit callback，audit 写入存在双路径分裂

- **严重级别**: `medium`
- **类型**: `correctness`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/src/observability.ts:170-178`: `createOrchestratorLogger` 仅传 `persistError`，未传 `persistAudit`
  - `workers/orchestrator-core/src/entrypoint.ts:67-69`: `recordAuditEvent()` RPC 方法直接调用 `persistAuditRecord()`
  - `workers/orchestrator-auth/src/service.ts:134`: 通过 `recordAuditEvent()` 从 nacp-core/logger 导入（这是一个包装函数，非 Logger 实例方法）
- **为什么重要**:
  - 设计 v0.5 §7.2 F1 的 Logger interface 定义了 `audit(event_kind, opts)` 方法，期望 audit 走 `AuditPersistFn` 统一管道
  - 当前实现中 orchestrator-core 的 Logger 实例调用 `audit()` 只会 console 输出，不会写 D1——任何将来代码中改为 `logger.audit(...)` 的 audit 记录会被静默丢弃
  - 两条分离路径（Logger.audit → console-only vs entrypoint.recordAuditEvent → D1）增加了维护风险和排障难度
- **审查判断**:
  - 这不是立即的 runtime bug——因为当前 audit 写入全部通过 RPC `recordAuditEvent()` 而非 Logger.audit()
  - 但这是实现与设计之间的路径分裂，应该在 closure 中登记为 known divergence
- **建议修法**:
  1. 在 `createOrchestratorLogger()` 中传入 `persistAudit: buildAuditPersist(env)`，使 Logger.audit() 成为统一路径
  2. 将 `entrypoint.recordAuditEvent()` 改为委托 `logger.audit()` 而非直接调用 `persistAuditRecord()`
  3. 或：在 closure 和 observability.ts 中显式文档化双路径分工（RPC 路径用于跨 worker audit，Logger 路径仅用于 console 回显），并在设计文档中更新相应描述

### R4. closure §5 deferred 表关于 wechat-miniprogram 的表述与收口标准存在张力

- **严重级别**: `medium`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `docs/issue/real-to-hero/RHX2-closure.md:128`: `"clients/wechat-miniprogram 完整适配 — deferred"`
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md §8.2 #6`: `"F13 双发窗口已运行 ≥14 天 + 至少一端 client PR merge；server 已切单发（或 closure 显式说明窗口顺延原因）"`
  - web 端 PR 实际上已完成（`clients/web/src/apis/transport.ts` 使用 `getErrorMeta`，`ChatPage.tsx` 处理 `system.error`），所以"至少一端 client PR merge"已满足
- **为什么重要**:
  - 读者可能误解为"两端都没有完成所以不能切单发"，而事实是"web 完成了但不切单发，因为观察窗口不足 + 小程序未完成"
  - closure 应准确反映 gate evaluation 的逻辑，避免 future reviewer 误判
- **审查判断**:
  - closure 的 gate-evaluated 决策本身是正确的——不提前切单发是安全默认
  - 但 closure §5 deferred 表的"原因"列写"本轮只做 web-first spike"未能完整说明 gate 逻辑
- **建议修法**:
  - 在 closure §5 deferred 表的 `system.error 切单发` 行的"原因"列添加: `"web 端已完成（满足 §8.2 #6 '至少一端' 条件），但不切单发是因为：(a) 双发观察期不足 14 天；(b) 微信小程序这端未完成产品化适配，仅此一端发布 system.error 处理的话，小程序用户会丢错误提示"`

### R5. error-registry.ts 的 last-write-wins Map 结构存在静默覆盖风险

- **严重级别**: `low`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`
- **事实依据**:
  - `packages/nacp-core/src/error-registry.ts:292-298`: `_byCode` Map 的构建采用 `map.set(meta.code, meta)` —— last-write-wins
  - 注释中已注明 "Sources are concatenated in increasing specificity order... the later, more specific entry wins"
  - 当前 `_RAW_ERROR_METAS` 中确实存在一个跨 source 的重复 code：`NACP_REPLAY_OUT_OF_RANGE` 同时出现在 NACP 段和 SESSION 段——后者覆盖前者
- **为什么重要**:
  - 当前设计是有意为之（session 段比 nacp 段更 specific），注释已记录
  - 但如果有将来 code 因疏忽跨 source 重复，last-write-wins 会静默覆盖，无任何警告
- **审查判断**:
  - 当前数据安全，但结构需要防御性加固
- **建议修法**:
  - 在 `error-registry.ts` 的 `_RAW_ERROR_METAS` 构建后添加一个 one-time `console.warn` 或 CI-only assert：当检测到跨 source 重复 code 时输出 warning 日志（JSON 结构化，由 Logger 捕获）

### R6. dual-emit-window.md 未记录 web spike 完成时间

- **严重级别**: `low`
- **类型**: `docs-gap`
- **是否 blocker**: `no`
- **事实依据**:
  - `docs/issue/real-to-hero/RHX2-dual-emit-window.md:5`: `dual_emit_started_at: 2026-04-30T02:59:05.640Z`
  - 文档仅记录了双发窗口开启时间，未记录 web spike 完成时间
  - Phase 9 gate evaluation 依赖"观察窗口已运行 ≥14 天"，需要起点 + 终点两个时间戳
- **审查判断**:
  - web spike 完成时间点在 smoke 测试通过时已确定，应追加到文档中
- **建议修法**:
  - 在 `dual-emit-window.md` 中追加 `web_spike_completed_at: <ISO>` 和 `gate_evaluated_at: <ISO>`

### R7. `/debug/packages` 的 drift 检测在 workspace ahead 场景存在表达歧义

- **严重级别**: `low`
- **类型**: `platform-fitness`
- **是否 blocker**: `no`
- **事实依据**:
  - `workers/orchestrator-core/src/debug/packages.ts:140-143`:
    ```ts
    drift: registryComparable
      ? live?.registry_version !== pkg.workspace_version ||
        live?.registry_latest_version !== pkg.workspace_version
      : false,
    ```
  - 当 workspace version 领先于 registry（例如本地已升级但未 publish），`registry_version` 为 `null`，`drift=true`。正确，但 `drift` 值只有 `true/false`，不传达方向
- **审查判断**:
  - 功能正确，但排查时缺少"是哪一侧漂移"的信息
- **建议修法**:
  - 在 `drift` 条目中增加 `drift_direction` 字段：`"workspace_behind"`（workspace < registry latest）/ `"workspace_ahead"`（workspace 未在 registry）/ `"workspace_not_published"`（registry 无此版本但 HTTP 200）/ `"aligned"`

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 | 审查结论 | 说明 |
|------|-----------------|----------|------|
| F1 | nacp-core/logger 子路径导出（4 级 + critical / ALS / ring buffer / LogPersistFn / DO 双模） | `done` | 11 文件完整实现；6 worker 全部导入；exports map 含 `./logger` |
| F2 | 6 worker HTTP 错误统一到 FacadeErrorEnvelope | `done` | `respondWithFacadeError()` 存在；6 worker 的 `index.ts` 均导入 |
| F3 | `resolveErrorMeta()` registry + `docs/api/error-codes.md` + CI 一致性 | `partial` | registry 78 codes 工作；docs 存在；但见 R1 (facade/auth 来源缺失) + R2 (10 wire codes 未注册) |
| F4 | D1 `nano_error_log` 表 + 持久化 + fallback | `done` | DDL 与设计一致；`persistErrorLogRecord()` 含 alert fallback |
| F5 | `/debug/logs` + `/debug/recent-errors` endpoint | `done` | 已在 `index.ts:586-608` 接线；team gate 鉴权 |
| F6 | `Server-Timing` header（orchestrator-core HTTP facade） | `done` | `attachServerTimings()` 在 `respond.ts` 中实现 |
| F7 | `session.stream.event::system.error` kind | `done` | `SystemErrorKind` schema 在 stream-event.ts；`tryEmitSystemError()` 实现完备 |
| F8 | `emitObservabilityAlert()` critical alert（3 类触发） | `done` | `alerts.ts` 实现；D1/RPC/R2 失败路径调用 |
| F9 | bash-core / orchestrator-auth 接 logger + ad-hoc code 归化 | `done` | 两 worker 均导入 logger；7 个 ad-hoc codes 进 registry |
| F10 | ESLint 重复定义防漂移 | `partial` | closure 声称 done 但本轮未验证 `.eslintrc` 或 `eslint-config-nano/` 是否存在相应 rule |
| F11 | D1 `nano_audit_log` 表 + NACP `audit.record` 通道（8 类 event_kind） | `done` | DDL 完整；8 类 event_kind 全部存在真实写路径 |
| F12 | client-safe error meta 出口（`nacp-core/error-codes-client`） | `done` | `error-registry-client/` 实现完备；`clients/web/transport.ts` 已采纳 |
| F13 | web + 微信小程序 `system.error` 消费 + 双发降级窗口 | `partial` | web 端完成；微信小程序 deferred；双发窗口保持（closure 已登记） |
| F14 | 包来源单一真相门禁 + jwt-shared 0.1.0 首发 | `done` | `verify-published-packages.mjs` 实现完备；jwt-shared@0.1.0 package.json 存在 |
| F15 | `/debug/packages` 验证接口 | `done` | `debug/packages.ts` 实现完备；含 10s 缓存 + graceful 降级 + drift 检测 |
| P0-F | owner-action 凭据验证 checklist | `partial` | `docs/owner-decisions/real-to-hero-tooling.md` 被引用但本轮未验证其内容 |
| P1-07 | jwt-shared@0.1.0 首发到 GitHub Packages | `partial` | package.json 版本为 0.1.0；无法验证 GitHub Packages 实际是否 HTTP 200 |
| P6-04 | `/debug/packages` endpoint | `done` | `debug/packages.ts` 代码就绪；`index.ts` 中已接线 |

### 3.1 对齐结论

- **done**: `13` (F1, F2, F4, F5, F6, F7, F8, F9, F11, F12, F14, F15, P6-04)
- **partial**: `5` (F3 — 来源缺口 + wire codes 未注册; F10 — 未独立验证; F13 — 微信小程序 deferred; P0-F — 未验证; P1-07 — 无法验证 registry 状态)
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

**对齐总结**：RHX2 的后端主体实现与设计文档高度一致。partial 项主要集中在 docs ↔ registry 的一致性缺口（F3）、跨端 client 的未完成部分（F13），以及无法在本地 review 中验证的 GitHub Packages 发布状态与 ESLint 配置。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | OTel SDK 完整接入 | `遵守` | 未发现代码入侵 |
| O2 | OTel span hierarchy | `遵守` | 未发现相关代码 |
| O3 | OTel histogram metrics 全量启用 | `遵守` | 未发现相关代码 |
| O4 | Hook handler 注册表全量接电（18 hook events） | `遵守` | 仅 hook.outcome 进入 audit（按设计 F11），未越界 |
| O5 | Evidence 业务持久化 | `遵守` | 未发现相关代码 |
| O6 | PII 自动脱敏 | `遵守` | 未发现相关框架代码 |
| O7 | 第三方 APM | `遵守` | 未发现依赖 |
| O8 | session-replay | `遵守` | 未发现相关代码 |
| O9 | user-level telemetry opt-out | `遵守` | 未发现相关代码 |
| O10 | 重复定义代码合并（仅 ESLint 防漂移） | `遵守` | 未发现代码删除；F10 的 ESLint rule 仅锁定不删除（符合 O10） |
| O11 | Cloudflare Logpush | `遵守` | 未发现配置 |
| O12 | bash-core 7 ad-hoc codes 归化为 zod enum | `遵守` | ad-hoc codes 仅进入 docs/registry，未创建 zod enum |
| O13 | smind-admin error response 格式收敛 | `遵守` | `docs/api/error-codes.md` 附录 A 已登记差异 |

所有 Out-of-Scope 项均**遵守**边界，无越界实现。

---

## 5. 扩大审查面积：跨阶段 / 跨包深度分析

### 5.1 与本阶段 charter 的一致性

- charter §4.5 规定 `/debug/workers/health` 是 ops/debug exception，RHX2 新增的 4 个 `/debug/*` 端点延续了此例外模式——它们也属于"仅用于 debug/ops，不扩散到业务路由依赖"。**遵守 charter 精神**。
- charter §1.2 冻结的 migration allocation（RH2=008 / RH3=009 / RH4=010 / RH5=011）与 RHX2 使用的 006 互不冲突——006 是 RHX1 DDL SSOT 后的 next slot，早于 RH2-RH5。**编号正确**。
- charter §4.4 硬纪律 #6 "Lane E dual-track 必须有 owner-decided sunset"——RHX2 不涉及 Lane E，**不适用**。
- charter §4.4 硬纪律 #7 的三层 evidence 纪律：RHX2 作为横切簇，不产生 Tier-B/C evidence，Tier-A per-phase preview smoke 由 implementer 自行执行（closure §4 记载了 smoke 验证）。**符合**。

### 5.2 clients/api-docs 与代码实现的交叉核实

| 文档文件 | 关键 claim | 代码现实 | 匹配度 |
|----------|-----------|----------|--------|
| `error-index.md` | HTTP error envelope = `{ok:false, error:{code,status,message,details?}, trace_uuid}` | `respondWithFacadeError()` 在 `respond.ts` 输出此结构 | ✅ 匹配 |
| `error-index.md` | WS system.error frame = `{kind, error: NacpErrorSchema, source_worker?, trace_uuid?}` | `SystemErrorKind` schema 在 `stream-event.ts:67-72` | ✅ 匹配 |
| `error-index.md` | §"Current Ad-hoc Public Codes" 17 个 codes | registry `AD_HOC_ERROR_METAS` 仅 7 个 | ❌ 不匹配 — 见 R2 |
| `session-ws-v1.md` | `system.notify` 与 `system.error` 作为 `event.payload.kind` 值 | `SystemNotifyKind` (line 59-65) + `SystemErrorKind` (line 67-72) 在 stream-event union 中 | ✅ 匹配 |
| `worker-health.md` | 列出 `/debug/logs`, `/debug/recent-errors`, `/debug/audit`, `/debug/packages` | `index.ts:586-608` 已接线全部 4 个路由 | ✅ 匹配 |
| `README.md` | RHX2 Phase 6 Snapshot endpoint matrix | 4 个 debug 端点 + 其他端点都在代码中 | ✅ 匹配 |

**小结**：`clients/api-docs/` 与代码实现整体匹配度很高（5/6 无问题），唯一断裂点是 `error-index.md` 的 17 个 ad-hoc codes 与 registry 的 7 个之间的差距（见 R2）。

### 5.3 命名规范一致性检查

- 包命名：`@haimang/nacp-core/logger`、`@haimang/nacp-core/error-codes-client`——符合 owner 长期"3 个 published 包"策略。✅
- migration 命名：`006-error-and-audit-log.sql`——符合设计 Q-Obs2。✅
- 环境变量命名：`NANO_ENABLE_RHX2_SPIKE`——前缀 `NANO_` 与现有 `NANO_LOG_LEVEL` 一致。✅
- 函数命名：`resolveErrorMeta()`、`getErrorMeta()`、`classifyByStatus()`、`tryEmitSystemError()`、`respondWithFacadeError()`——驼峰式，动词开头，语义清晰。✅
- 审计 event_kind 命名：`auth.login.success`、`session.attachment.superseded`——点分命名空间，与 NACP 协议一致。✅
- 唯一例外：`dual-emit-window.md` 中的 `dual_emit_started_at` 使用 snake_case（而非 camelCase 的 `dualEmitStartedAt`）——与项目其余 ISO 时间戳字段命名不一致，但属于文档字段可接受。

### 5.4 执行逻辑错误检查

- `observability.ts:77-78`：`toJsonText(record.ctx, ERROR_CONTEXT_LIMIT)` 传入的是 `record.ctx`（`Record<string, unknown>`），但 `toJsonText` 期望 `value: unknown`——类型正确。
- `observability.ts:79`：`record.rpc_log_failed ? 1 : 0`——正确映射 boolean 到 SQLite INTEGER。
- `debug/packages.ts:108-110`：`registry_version` 在 workspace version 存在时赋值为 `workspaceVersion`，在不存在时为 `null`。但 `registry_version` 的语义应该是 "registry 中与 workspace 匹配的版本"——如果 workspace version 不在 registry 中，`registry_version` 为 `null` 是正确的。
- `system-error.ts:68`：`input.dedupe && !input.critical && !input.dedupe.shouldEmit(key, false)`——critical 事件跳过 dedupe，正确。但 `shouldEmit` 调用后没有更新 LRU 缓存状态——检查 `dedupe.ts` 的实现后发现 `shouldEmit` 内部已做 LRU set：`this.cache.set(key, now)` (line 44-47 of dedupe.ts)——正确。
- `system-error.ts:91`：`input.dualEmitSystemNotifyError ?? DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR`——正确处理了显式覆盖与默认值的优先级。

### 5.5 盲点与断点识别

1. **audit 写入路径的静默失败**：`entrypoint.ts:67-69` 的 `recordAuditEvent()` RPC 方法在 D1 写失败时 throw error（因为 `persistAuditRecord()` 内部 try-catch 后 throw 而非 swallow），而 caller（例如 `orchestrator-auth/service.ts:134`）使用 `void recordAuditEvent(...)` ——**不 await**。这意味着 audit 写入失败会被静默吞掉，不会触发 alert，也不会在日志中留下痕迹。

2. **`persistErrorLogRecord()` 在 D1 不可用时的行为**：`observability.ts:45` 检查 `if (!db) return`——当 `NANO_AGENT_DB` binding 不可用时静默跳过，不写 console fallback。这与设计 v0.5 §7.2 F4 的 fallback 描述（"写 console + 内存环形 + `rpc_log_failed:true`"）不完全一致——当前实现中 D1 binding 缺失时甚至连 console fallback 都不会写。

3. **`buildErrorLogPersist()` 的 throw 行为**：`observability.ts:142` 在 catch 后 `throw error`——这意味着 error log 持久化失败会传播到 Logger 的上层调用者。在 Worker-Shell 环境（orchestrator-core fetch handler）中，如果 persistError 被 wrap 在 `ctx.waitUntil()` 里，throw 不会影响 HTTP 响应；但如果在 DO 环境（agent-core NanoSessionDO）中，persistError 通过 RPC 同步 await，throw 会导致 RPC 调用整体失败。当前 `createOrchestratorLogger` 仅在 orchestrator-core 使用（Worker-Shell），所以安全。

4. **`dual-emit-window.md` 中未定义观察窗口的实际结束条件判断方式**：文档仅列出准入条件（§4.1-5），但未说明"≥14 天"从哪个时间点算起、由谁在什么 tool/script 中检查、检查结果如何记录。

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**: `RHX2 后端 observability/auditability 主线主体成立，代码质量与设计一致性优秀，6 worker 全量 logger 化、8 类 audit 全通、debug 四端点通电、cron 清理就绪——后端主体可以闭合。但 clients/api-docs 与 error-registry 之间存在 10 个 wire codes 的双向漂移（R2, blocker），以及 facade/auth 注册表来源缺口（R1），需修正后方可全量闭合。Phase 9 双发窗口保持是正确决策，closure 中相应表述可优化但非 blocker。wechat-miniprogram 完整适配 defer 属 owner 已决策范围。`

- **是否允许关闭本轮 review**: `no`

- **关闭前必须完成的 blocker**:
  1. **R2**：解决 `clients/api-docs/error-index.md` 登记的 10 个 wire codes 与 `error-registry.ts` 注册表之间的漂移（补入注册表 OR 在 api-docs 中标注为非注册 code）

- **可以后续跟进的 non-blocking follow-up**:
  1. **R1**：补全 FACADE_ERROR_METAS / AUTH_ERROR_METAS 或显式冻结"合并到 RPC source"的设计决策
  2. **R3**：统一 audit 写入路径（消除 Logger.audit() 与 entrypoint.recordAuditEvent() 双路径分裂）
  3. **R4**：更新 closure §5 deferred 表，使 wechat-miniprogram/single-emit 的 gate 逻辑表述更准确
  4. **R5**：为 error-registry.ts 添加跨 source 重复 code 的 CI 检测
  5. **R6**：在 dual-emit-window.md 中追加 web spike 完成时间
  6. **R7**：为 `/debug/packages` 的 drift 响应添加方向指示字段
  7. **§5.5 盲点 1**：修复 `orchestrator-auth/service.ts` 中 `void recordAuditEvent(...)` 的静默失败（改为 await + try-catch + emit alert）
  8. **§5.5 盲点 2**：在 `persistErrorLogRecord()` 的 `if (!db) return` 路径中添加 console fallback
  9. **§5.5 盲点 4**：在 dual-emit-window.md 中补充观察窗口结束条件的具体判断方式与工具

- **建议的二次审查方式**: `same reviewer rereview` — 在 R2 修正后，由本 reviewer 针对修正内容做快速二次审查，无需全量重审

- **实现者回应入口**: `请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

---

> 审查人独立声明：本轮审查未参考任何 other reviewer（GPT、GLM、Kimi、Opus）的分析报告。所有判断基于原始 charter/design/action-plan 文档与当前代码事实的独立对照。
