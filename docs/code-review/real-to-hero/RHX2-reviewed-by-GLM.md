# Nano-Agent 代码审查 — RHX2 Observability & Auditability 全阶段

> 审查对象: `RHX2 Observability & Auditability 全阶段（Phase 1–9），含跨阶段（RH0–RH6 + RHX1）回顾`
> 审查类型: `mixed（code-review + closure-review + cross-phase-review）`
> 审查时间: `2026-04-30`
> 审查人: `GLM-5.1`
> 审查范围:
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`（执行计划全量）
> - `docs/issue/real-to-hero/RHX2-closure.md`（Phase 7-9 收口）
> - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`（双发窗口协议）
> - `packages/nacp-core/src/observability/`（logger 全子模块）
> - `packages/nacp-core/src/error-registry.ts` + `error-registry-client/`（错误注册表）
> - `packages/nacp-session/src/stream-event.ts`（system.error schema）
> - `workers/orchestrator-core/`（debug endpoints + observability + cron + user-do-runtime）
> - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
> - `clients/web/`（transport.ts + ChatPage.tsx + debug.ts + InspectorTabs）
> - `clients/wechat-miniprogram/`（nano-client.js + session/index.js）
> - `clients/api-docs/`（全部 10 份端点文档）
> - `scripts/verify-published-packages.mjs` + `scripts/generate-package-manifest.mjs`
> - `docs/api/error-codes.md`
> - RH0–RH6 + RHX1 closure 文档（跨阶段回顾）
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`（阶段基石纲领）
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`（设计文档 v0.3 frozen）
> - `docs/templates/code-review.md`（审查模板）
> 文档状态: `reviewed`

---

## 0. 总结结论

- **整体判断**：`RHX2 后端 observability/auditability 主线已完成落代码且可运行；Phase 7-9 以 web-first spike 收口；但存在 1 个生产安全风险、1 个行动计划项未落地、若干文档与注册表缺口需要后续处理。跨阶段回顾发现 permission/elicitation/usage WS round-trip e2e 从 RH1 起持续空缺至今。`
- **结论等级**：`approve-with-follow-ups`
- **是否允许关闭本轮 review**：`yes`（附条件：R1 必须在下一 deploy 前修复）
- **本轮最关键的 3 个判断**：
  1. `NANO_ENABLE_RHX2_SPIKE=true` 出现在 wrangler.jsonc 顶层（生产）vars 中，允许任何持有合法 session 的用户在 production 环境触发合成 `system.error`。这是安全风险，必须在 merge 或 deploy 前移除或设为 `"false"`。
  2. P5-02（agent-core kernel emit `system.error`）未实现——agent-core 的 `runtime-mainline.ts` 不导入也不调用 `tryEmitSystemError`，kernel 错误路径（LLM stream error、capability transport error）不产生 `system.error` 帧。action plan 明确要求此工作项，closure 标注为 done 但代码事实不匹配。
  3. 17 个 ad-hoc 公共错误码（`missing-team-claim`、`session_missing`、`agent-start-failed` 等）不存在于 `resolveErrorMeta()` 注册表中，意味着 `getErrorMeta(code)` 返回 `undefined`，客户端无法对这些错误做结构化消费。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md` v0.draft-r3
  - `docs/charter/plan-real-to-hero.md`（阶段纲领）
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.3 frozen
  - `docs/issue/real-to-hero/RHX2-closure.md`
  - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`
  - RH0–RH6 + RHX1 closure 文档
- **核查实现**：
  - `packages/nacp-core/src/observability/logger/`（全部 10+ 文件）
  - `packages/nacp-core/src/error-registry.ts` + `error-registry-client/`（4 文件）
  - `packages/nacp-session/src/stream-event.ts`
  - `workers/orchestrator-core/src/{index.ts, user-do-runtime.ts, observability.ts, debug/packages.ts, cron/cleanup.ts, policy/authority.ts}`
  - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
  - `workers/orchestrator-core/wrangler.jsonc`
  - `workers/agent-core/src/host/runtime-mainline.ts`
  - `clients/web/src/{apis/transport.ts, apis/debug.ts, pages/ChatPage.tsx, components/inspector/InspectorTabs.tsx}`
  - `clients/wechat-miniprogram/utils/nano-client.js` + `pages/session/index.js`
  - `clients/api-docs/`（全部 10 份文档）
  - `scripts/verify-published-packages.mjs` + `scripts/generate-package-manifest.mjs`
- **执行过的验证**：
  - `pnpm --filter @haimang/nacp-core typecheck && pnpm --filter @haimang/nacp-core test && pnpm --filter @haimang/nacp-core build`
  - `pnpm --filter @haimang/nacp-session typecheck && pnpm --filter @haimang/nacp-session test && pnpm --filter @haimang/nacp-session build`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck && pnpm --filter @haimang/orchestrator-core-worker test && pnpm --filter @haimang/orchestrator-core-worker build`
  - `cd clients/web && npm install --ignore-scripts && npm run build`
  - 全量文件内容核查（以上文件列表）
  - `rg console\.` 在 4 个 worker `src/` 目录中搜索 — 结果为 0
- **复用 / 对照的既有审查**：
  - `docs/code-review/real-to-hero/RHX2-P1-3-reviewed-by-GLM.md` — 独立复核，不作为本审查的判断来源（仅作为线索参考）

### 1.1 已确认的正面事实

- `@haimang/nacp-core/logger` 子路径导出完整落地：`createLogger`、`withTraceContext`、`getTraceContext`、`RingBuffer`、`DedupeCache`、`respondWithFacadeError`、`attachServerTimings`、`recordAuditEvent`、`buildSystemErrorEvent`、`tryEmitSystemError`、`emitObservabilityAlert` 全部可用，ALS 注入 trace_uuid/team_uuid 工作正常。
- `@haimang/nacp-core/error-codes-client` 子路径导出落地：`getErrorMeta`、`classifyByStatus`、8 类 `ClientErrorCategory` 枚举，零 runtime 依赖（`generated-data.ts` 是纯静态数组，不 import 主模块）。
- nacp-core 版本 bump 到 1.6.0，exports map 含 `./logger` 和 `./error-codes-client` 两条入口。
- migration 006 DDL 两表（`nano_error_log` 14d + `nano_audit_log` 90d）+ 8 索引 + CHECK 约束 + FK 引用完整落地。
- bash-core / context-core / filesystem-core wrangler.jsonc 全部新增 `ORCHESTRATOR_CORE` service binding（preview + production 双 env）。
- 6 个 worker `src/` 下裸 `console.*` 调用数 = 0，已全部切换到 `createLogger` 结构化日志。
- F11 八类 audit event_kind 全部有写路径：`auth.login.success`、`auth.api_key.issued`、`auth.api_key.revoked`、`auth.device.gate_decision`、`tenant.cross_tenant_deny`、`hook.outcome`、`session.attachment.superseded`、`session.replay_lost`。额外发现 `session.start.failed` 也有写路径。
- `/debug/logs`、`/debug/recent-errors`、`/debug/audit`、`/debug/packages` 四个端点全部落地，auth gate 工作正常。
- cron trigger 每天 03:00 UTC 执行 TTL cleanup（14d error / 90d audit）。
- 双发窗口落地：`DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true`，`system.error` + `system.notify(severity=error)` 同时发送。web `ChatPage.tsx` 按 `trace_uuid + 1s` 去重。
- web client `transport.ts` 已切到 `getErrorMeta()` + `classifyByStatus()`，`ApiError.kind` 四类保持向后兼容。
- web `ChatPage.tsx` 已消费 `system.error` 帧，去重双发的 `system.notify(error)`，识别 `session.attachment.superseded` / `session.end`，现代 `kind` frame 发送 heartbeat/resume/ack。
- web InspectorTabs 新增 files / logs / recent / audit / packages 五个 tab。
- synthetic trigger 受 `NANO_ENABLE_RHX2_SPIKE` env var 保护，必须 `"true"` 才激活。
- `docs/api/error-codes.md` 7 段 + 2 附录完整落地，CI 一致性测试通过。
- verify-published-packages.mjs CI gate 脚本落地，6 worker package.json 有 predeploy hook。
- package manifest 使用 generated TS module 方式（非 esbuild --define），功能等价。

### 1.2 已确认的负面事实

- `NANO_ENABLE_RHX2_SPIKE` 在 `wrangler.jsonc` 顶层 vars 中设为 `"true"`，意味着 production 环境也可触发合成 system.error。这是安全问题。
- agent-core `runtime-mainline.ts` 不导入也不调用 `tryEmitSystemError`，P5-02 工作项（agent-core kernel emit `system.error`）未实现。LLM stream error 和 capability transport error 路径不产生 `system.error` 帧。
- 17 个 ad-hoc 公共错误码（`missing-team-claim`、`invalid-auth-body`、`invalid-start-body`、`invalid-input-body`、`invalid-auth-snapshot`、`session_missing`、`session-pending-only-start-allowed`、`session-expired`、`session-already-started`、`session_terminal`、`agent-start-failed`、`agent-rpc-unavailable`、`agent-rpc-throw`、`models-d1-unavailable`、`context-rpc-unavailable`、`filesystem-rpc-unavailable`、`payload-too-large`）存在于实际路由代码中但不在 `resolveErrorMeta()` 注册表中，`getErrorMeta(code)` 对这些码返回 `undefined`。
- P4-05（ESLint no-console + no-restricted-imports 规则）未落地——全仓库无 `.eslintrc` 或等价 eslint 配置文件。虽然 6 worker 当前无裸 `console.*` 调用，但没有 CI 自动拦截防漂移。
- WeChat 小程序既没有 `system.error` 处理分支，也没有引入 `error-codes-client`，`classifyError` 仍使用旧的 4 类启发式方法。closure 已标注为 deferred，需后续客户端专项覆盖。
- `docs/api/error-codes.md` 声称 78 codes after dedupe，但 `NACP_REPLAY_OUT_OF_RANGE` 在 NACP (permanent/500) 和 Session (permanent/410) 两处注册，实际 unique count 为 77。文档头行声称与实际不一致。
- `clients/api-docs/error-index.md` 缺少 KernelErrorCode（6 个）、SessionErrorCode（8 个）、LLMErrorCategory（8 个）三类共 22 个错误码。客户端开发者无法从该文档了解通过 `system.error` WS 帧可能收到的全部错误码。
- `nano_audit_log.event_kind` 列无 CHECK 约束，DDL 允许任意字符串，与设计文档指定的 8 类 event_kind 不匹配。存在数据完整性风险。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 全量核查 nacp-core、orchestrator-core、agent-core、web client、微信小程序、api-docs、migrations |
| 本地命令 / 测试 | `yes` | pnpm typecheck/test/build 验证 nacp-core + nacp-session + orchestrator-core；web build 验证；代码搜索验证 console.* 零残留 |
| schema / contract 反向校验 | `yes` | error-registry 78 码 vs docs/api/error-codes.md vs api-docs/error-index.md 三方交叉比对 |
| live / deploy / preview 证据 | `no` | 本次审查未访问 preview 或 production 环境，未触发实际 deploy 验证 |
| 与上游 design / QNA 对账 | `yes` | 与设计文档 v0.3 F1-F15 逐项对齐；与 Q-Obs1-Q-Obs14 冻结决策逐项比对 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | `NANO_ENABLE_RHX2_SPIKE=true` 出现在生产 vars | `critical` | `security` | `yes` | 在生产 deploy 前将顶层 vars 改为 `"false"` 或删除；仅保留 preview env 为 `"true"` |
| R2 | agent-core kernel 不调用 `tryEmitSystemError`，P5-02 未实现 | `high` | `delivery-gap` | `no` | 在 `runtime-mainline.ts` LLM stream error 和 capability transport error 处增加 `tryEmitSystemError` 调用；或如果架构决定 agent-core 通过 ORCHESTRATOR_CORE RPC 间接 emit，需要在 closure 中显式标注并对齐 action plan |
| R3 | 17 个 ad-hoc 错误码不在 `resolveErrorMeta()` 注册表中 | `high` | `correctness` | `no` | 将 17 个 ad-hoc 码注册到 `AD_HOC_ERROR_METAS`（或新建 `FACADE_AD_HOC_METAS`），使 `getErrorMeta()` 不返回 undefined；或在 `getErrorMeta` 中对 undefined 进行 graceful fallback 归类 |
| R4 | P4-05 ESLint no-console 规则未落地 | `medium` | `delivery-gap` | `no` | 新增 `.eslintrc` 或 `eslint.config.mjs`，加入 no-console + no-restricted-imports 规则；或如项目决定不用 ESLint，则在 CI 中加入 grep 拦截步骤 |
| R5 | 微信小程序缺 `system.error` 处理 + `error-codes-client` | `medium` | `delivery-gap` | `no` | 已在 closure 标注 deferred，需在后续客户端专项中优先覆盖 |
| R6 | `error-codes.md` 声称 78 codes 但实际 unique 为 77 | `low` | `docs-gap` | `no` | 修正文档头行数字为 77，或在 §6 注释中明确说明 `NACP_REPLAY_OUT_OF_RANGE` 跨类别去重规则 |
| R7 | `clients/api-docs/error-index.md` 缺 Kernel/Session/LLM 三类码 | `medium` | `docs-gap` | `no` | 补全 error-index.md 中缺失的 22 个错误码，或增加链接指向 `docs/api/error-codes.md` |
| R8 | `nano_audit_log.event_kind` 无 CHECK 约束 | `low` | `platform-fitness` | `no` | 考虑在后续 migration 中添加 CHECK 约束；或如果决定保持开放扩展性，需明确写入文档 |
| R9 | `NACP_VERSION` (1.4.0) 与 `package.json` version (1.6.0) 名称混淆 | `low` | `docs-gap` | `no` | 两者含义不同（wire protocol vs npm version），但建议在 nacp-core README 中明确说明 |
| R10 | 跨阶段延续：permission/elicitation/usage WS round-trip e2e 从 RH1 起空缺 | `medium` | `test-gap` | `no` | 需在 hero-to-platform 或独立 e2e 专项中补充，当前 HTTP path 可用但 WS live push 未经 e2e 验证 |
| R11 | 跨阶段延续：Lane E consumer sunset 未启动 | `medium` | `scope-drift` | `no` | charter §4.4 明确要求 dual-track ≤2 周后切 RPC-first；当前 `LANE_E_RPC_FIRST` config bit 存在但 consumer 仍走 host-local，需 owner 决策 sunset 时间 |
| R12 | 跨阶段延续：`/me/sessions GET` next_cursor 始终 null | `low` | `delivery-gap` | `no` | 已在 api-docs 标注为当前限制；需在 hero-to-platform 中实现 cursor pagination |
| R13 | `tryEmitSystemError` 仅 orchestrator-core 使用 | `medium` | `protocol-drift` | `no` | action plan P5-02 明确要求 agent-core kernel 错误归一点 emit `system.error`（通过 ORCHESTRATOR_CORE.forwardServerFrameToClient 跨 worker 推），但实际 agent-core 不调用此函数，设计意图与代码事实不一致 |

### R1. `NANO_ENABLE_RHX2_SPIKE=true` 出现在生产 vars

- **严重级别**：`critical`
- **类型**：`security`
- **是否 blocker**：`yes`
- **事实依据**：
  - `workers/orchestrator-core/wrangler.jsonc` 顶层 `vars` 中 `"NANO_ENABLE_RHX2_SPIKE": "true"`（line 26）
  - Wrangler 顶层 vars 即生产/default 环境变量；preview env 块也设为 `"true"`
  - `user-do-runtime.ts` line 834 检查 `this.env.NANO_ENABLE_RHX2_SPIKE !== "true"` 作为 guard
  - 合法 session 的 verify 端点可发送 `{check: "emit-system-error"}` 触发合成 `system.error` 帧
- **为什么重要**：允许任何拥有合法 session 的用户在 production 环境注入合成错误帧到 WebSocket，引发客户端 `system.error` 处理逻辑。这不是 debug-only 的 feat，而是可以在 production 被任意触发的合成注入点。
- **审查判断**：action plan 和 closure 都明确标注 synthetic trigger "不应在 production vars 中开启"。wrangler.jsonc 当前配置违反了此约定。
- **建议修法**：将顶层 vars 中 `"NANO_ENABLE_RHX2_SPIKE"` 改为 `"false"` 或完全删除该 key；仅保留 preview env `"NANO_ENABLE_RHX2_SPIKE": "true"`。

### R2. agent-core kernel 不调用 `tryEmitSystemError`，P5-02 未实现

- **严重级别**：`high`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action plan P5-02 明确要求 "agent-core kernel 错误归一点调用 tryEmitSystemError(record)；通过 ORCHESTRATOR_CORE.forwardServerFrameToClient 跨 worker 推"
  - `workers/agent-core/src/host/runtime-mainline.ts` 不导入也不调用 `tryEmitSystemError`
  - `tryEmitSystemError` 的唯一 production 调用方是 `orchestrator-core/src/user-do-runtime.ts`（spike trigger + emit validation failure）
  - `system.error` 作为 message intent 存在于 `agent-core/src/kernel/message-intents.ts`，但 kernel 错误路径（LLM stream error at line 347, capability transport error at lines 377/452）不触发任何 `system.error` emit
- **为什么重要**：F7 `system.error` 是 observability 第一波的核心协议留位。如果 agent-core（实际 LLM 运行时宿主）的错误不产生 `system.error` 帧，那么真实的 runtime 错误对客户端不可见——只有 orchestrator-core level 的 facade 错误会产生 `system.error`。
- **审查判断**：action plan 工作项明确标注为 P5-02，closure Phase 5 标注为 done，但代码事实不匹配。这可能是架构调整（agent-core 通过 ORCHESTRATOR_CORE RPC 间接 emit，而非直接调用 nacp-core 函数），但 closure 未说明此变更。
- **建议修法**：（1）在 `runtime-mainline.ts` 的 LLM stream error 和 capability transport error 路径调用 `tryEmitSystemError`（通过 ORCHESTRATOR_CORE.forwardServerFrameToClient）或至少在 catch 块中通过 RPC 调用 orchestrator-core 的 `recordErrorLog`；（2）如果设计变更是有意的，在 closure 或设计文档中明确标注 P5-02 的实现方式变更及原因。

### R3. 17 个 ad-hoc 错误码不在 `resolveErrorMeta()` 注册表中

- **严重级别**：`high`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - 以下 17 个码在实际路由代码中使用但 `resolveErrorMeta()` 返回 `undefined`：`missing-team-claim`、`invalid-auth-body`、`invalid-start-body`、`invalid-input-body`、`invalid-auth-snapshot`、`session_missing`、`session-pending-only-start-allowed`、`session-expired`、`session-already-started`、`session_terminal`、`agent-start-failed`、`agent-rpc-unavailable`、`agent-rpc-throw`、`models-d1-unavailable`、`context-rpc-unavailable`、`filesystem-rpc-unavailable`、`payload-too-large`
  - `error-index.md` 承认这些码是 "emitted by current routes but are not all part of FacadeErrorCodeSchema"
  - 客户端 `getErrorMeta(code)` 调用对这些码返回 undefined，fallback 到 `classifyByStatus(status)` —— 但 fallback 只做粗粒度 HTTP status 分类，丢失 code 级别信息
- **为什么重要**：RHX2 的核心价值主张之一是"80+ codes 收口到统一查询面 + 客户端可消费"。如果大量生产路径使用的码无法通过注册表查找，则 client 端的错误处理退化为纯 HTTP status 分类，与 RHX2 前的状态无本质差异。
- **审查判断**：action plan P2-01 的目标"80+ codes 100% 命中"在此处未完全达成。17 个 ad-hoc 码虽然在 `error-index.md` 中有文档化，但它们不在 `resolveErrorMeta()` 的查找路径中。
- **建议修法**：（1）将 17 个 ad-hoc 码注册到 `AD_HOC_ERROR_METAS`（bash-core 7 个已在，其余 10 个需要新增）；（2）或在 `getErrorMeta()` 中增加 graceful fallback：当 code 返回 undefined 时，基于 fallback map 做一次 ad-hoc → ClientErrorCategory 映射；（3）更新 `error-codes.md` §8 增加"facade ad-hoc"段。

### R4. P4-05 ESLint no-console 规则未落地

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - action plan P4-05 要求 `(a) no-console 在 worker src/ 下报错；(b) no-restricted-imports 把 StorageError / metric-names 引到主份；(c) 禁止跨 worker import evidence-emitters`
  - 全仓库无 `.eslintrc`、`eslint.config.*` 或任何 eslint 相关配置
  - 当前 6 个 worker `src/` 目录 grep `console\.` 结果为 0（仅 test/script 文件有），但这只是当前状态的结果，没有 CI 自动拦截防止漂移
- **审查判断**：P4-05 的 ESLint 规则是一个防漂移机制，当前状态是"结果是正确的但机制不存在"。由于无 eslint 配置，任何新代码新增 `console.log` 不会被 CI 拦截。
- **建议修法**：新增 eslint 配置文件，加入 `no-console` 规则（worker src/ 报错）+ `no-restricted-imports` 规则；或如项目决定不引入 ESLint，则在 CI pipeline 中加入 `rg 'console\.(log|warn|error)' --type ts workers/*/src/` 的 grep 拦截步骤。

### R5. 微信小程序缺 `system.error` 处理 + `error-codes-client`

- **严重级别**：`medium`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/wechat-miniprogram/pages/session/index.js` 中 `handleStreamEvent` switch case 包含 `llm.delta`、`tool.call.progress`、`tool.call.result`、`turn.begin`、`turn.end`、`system.notify`、`session.update`，但无 `system.error` case
  - `clients/wechat-miniprogram/utils/nano-client.js` 的 `classifyError` 仍是旧 4 类启发式，未引入 `error-codes-client`
  - closure §5 已显式标注 `clients/wechat-miniprogram` 完整适配 deferred 至独立客户端专项
- **为什么重要**：双发窗口期间，微信小程序客户端会收到 `system.notify(severity=error)` 帧，但没有对应的 UI 处理分支。旧客户端收到 `system.notify(severity=error)` 会走到现有 `system.notify` case，显示为普通通知而非错误——这不是阻断性问题（双发设计保证旧客户端不丢失错误信号），但也不理想。
- **审查判断**：closure 决策合理（web-first spike 后续专项覆盖），当前状态对双发窗口是安全的。
- **建议修法**：在后续客户端专项中优先覆盖微信小程序 `system.error` case + `error-codes-client` 引入 + build script 拷贝 JSON。

### R6. `error-codes.md` 声称 78 codes 但实际 unique 为 77

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/api/error-codes.md` 头行声称 "78 codes registered across 6 sources after dedupe"
  - `NACP_REPLAY_OUT_OF_RANGE` 同时出现在 NACP 码（permanent/500）和 Session 码（permanent/410），last-write-wins 取 Session 码
  - 实际 unique count 为 77（78 原始 - 1 重复）
  - 文档 §6 注释已说明此去重规则，但头行数字未更新
- **建议修法**：将头行从"78 codes"修正为"77 unique codes (78 registrations, 1 deduped: NACP_REPLAY_OUT_OF_RANGE)"。

### R7. `clients/api-docs/error-index.md` 缺 Kernel/Session/LLM 三类码

- **严重级别**：`medium`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `error-index.md` 仅列 3 表：Public Facade/RPC Codes (30)、Current Ad-hoc Public Codes (17)、NACP Internal Codes (20)
  - 缺少 KernelErrorCode (6)、SessionErrorCode (8)、LLMErrorCategory (8) 共 22 个码
  - 这些码可通过 `system.error` WS 帧到达客户端
  - `docs/api/error-codes.md` (内部文档) 包含全部 77 个码
- **为什么重要**：客户端开发者只看 `error-index.md` 无法处理来自 `system.error` 帧的 kernel/session/LLM 错误码。
- **建议修法**：在 `error-index.md` 中增加 3 个段：Kernel Errors (6)、Session Errors (8)、LLM Errors (8)，或在每个段内增加链接指向 `docs/api/error-codes.md` 对应章节。

### R8. `nano_audit_log.event_kind` 无 CHECK 约束

- **严重级别**：`low`
- **类型**：`platform-fitness`
- **是否 blocker**：`no`
- **事实依据**：
  - 设计文档 Q-Obs6 指定 "first-wave audit 8 类 event_kind"
  - `006-error-and-audit-log.sql` 的 `nano_audit_log` 表不包含 `event_kind TEXT NOT NULL CHECK (event_kind IN (...))` 约束
  - DDL 仅声明 `event_kind TEXT NOT NULL`，允许任意字符串
  - 实际已发现第 9 个 event_kind `session.start.failed` 有写路径（不在原始 8 类清单中）
- **审查判断**：`session.start.failed` 作为额外 event_kind 的出现说明开放扩展性有实际价值。但设计文档对 8 类的明确限定与 DDL 的开放性存在文档偏差。
- **建议修法**：（1）保持 DDL 开放（不添加 CHECK），但在文档中更新 first-wave 实际 audit event 类型清单为 9 类；（2）或添加 CHECK 约束（包含原始 8 类 + `session.start.failed`），接受后续新类型需要 migration 变更的代价。

### R9. `NACP_VERSION` (1.4.0) 与 `package.json` version (1.6.0) 名称混淆

- **严重级别**：`low`
- **类型**：`docs-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/nacp-core/src/version.ts` 中 `NACP_VERSION = "1.4.0"` 是 wire protocol 版本
  - `packages/nacp-core/package.json` 中 `"version": "1.6.0"` 是 npm 包版本
  - 两者含义不同但命名相似，可能让消费者混淆
- **建议修法**：在 nacp-core README 或 `version.ts` 注释中明确说明 `NACP_VERSION` 是协议版本、`package.json version` 是发布版本。

### R10. 跨阶段延续：permission/elicitation/usage WS round-trip e2e 从 RH1 起空缺

- **严重级别**：`medium`
- **类型**：`test-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - RH0 closure §4 item 9 (Lane F dispatcher 完整闭合) 标注为 done
  - RH1 closure 标注 "Lane F 4 链主干接通"
  - 但 RH1 closure 同步标注 `pushServerFrameToClient` 100% 返回 `delivered:false`（因 user_uuid 空）
  - RH3 修复了 user_uuid 问题，但 WS round-trip e2e 测试文件（3 个）从 RH1 起持续标注为未创建
  - HTTP path 的 permission/elicitation 端点可用，但 WS live push 路径未经 e2e 验证
  - 此问题经 RH1→RH2→RH3→RH4→RH5→RH6→RHX1→RHX2 八个 phase 持续 defer
- **审查判断**：这不是 RHX2 的责任，但作为跨阶段审查的发现，值得记录。charter §10.3 NOT-成功退出条件 #7 规定"任一 endpoint 缺 endpoint-level 直达测试"不应宣称收口。WS frame 类型的 e2e 测试是否属于"endpoint-level 直达测试"有讨论空间。
- **建议修法**：在 hero-to-platform 或独立 e2e 专项中补充 permission round-trip + elicitation round-trip + onUsageCommit WS push 的 e2e 测试。

### R11. 跨阶段延续：Lane E consumer sunset 未启动

- **严重级别**：`medium`
- **类型**：`scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - charter §4.4 硬纪律 #6："Lane E binding 启用时 dual-track 必须有 owner-decided sunset（不允许 library import + RPC consumer 永久并存）"
  - RH4 closure 标注 agent-core RPC-first consumer cutover 未做、Lane E sunset 未启动
  - RH5/RH6 closure 同步 carry-over
  - `LANE_E_RPC_FIRST` config bit 在 agent-code 中存在但默认为 false
- **审查判断**：这与 RHX2 直接无关，但违反了 charter 硬纪律。如果在 hero-to-platform 阶段仍不切 cutover，library import 与 RPC consumer 将永久并存。
- **建议修法**：需要 owner 决策 Lane E sunset 时间盒；或正式修改 charter §4.4 硬纪律 #6 的措辞。

### R12. 跨阶段延续：`/me/sessions GET` next_cursor 始终 null

- **严重级别**：`low`
- **类型**：`delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - charter §7.4 RH3 P3-D 要求 cursor-based pagination
  - RH3 closure 标注 `/me/conversations` cursor 已实现
  - `api-docs/me-sessions.md` 标注 `/me/sessions GET` 的 `next_cursor` 始终 null
  - `/me/conversations` 有 cursor 但 `/me/sessions` 没有
- **建议修法**：在 hero-to-platform 中统一 `/me/sessions` cursor pagination 与 `/me/conversations`。

### R13. `tryEmitSystemError` 仅 orchestrator-core 使用

- **严重级别**：`medium`
- **类型**：`protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - 与 R2 同源但角度不同
  - action plan §5.5 Phase 5 描述的 `system.error` 发帧架构是：agent-core kernel 错误通过 ORCHESTRATOR_CORE.forwardServerFrameToClient 跨 worker 推
  - 实际实现中 agent-core 不调用 `tryEmitSystemError`，也不通过 ORCHESTRATOR_CORE binding 发帧
  - orchestrator-core 在两个位置调用 `tryEmitSystemError`：(a) spike trigger；(b) emitServerFrame validation failure
  - 这意味着真实的 agent-core kernel 错误（LLM 失败、capability transport 失败）不产生 `system.error` 帧，客户端只能通过 HTTP facade error 或 `system.notify` 收到这些错误
- **建议修法**：同 R2，在 agent-core 错误路径增加 `system.error` 发帧或通过 RPC 委托 orchestrator-core 发帧。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / closure claim | 审查结论 | 说明 |
|------|------------------------|----------|------|
| S1 | F1：nacp-core logger 子路径导出 | `done` | `@haimang/nacp-core/logger` 子路径完整落地，4 级 + critical + ALS + ring buffer + dedupe + respond + audit + alerts + system-error 全部可用 |
| S2 | F2：6 worker HTTP 错误响应统一 FacadeErrorEnvelope | `partial` | orchestrator-core 已使用 `respondWithFacadeError`；bash-core/context-core/filesystem-core 有 facade error 但部分 ad-hoc 码不在注册表中；agent-core 仍有 134 行 `{error: "Not found"}` 未统一（需核实） |
| S3 | F3：resolveErrorMeta() registry + docs + CI 一致性 | `partial` | registry 有 78 个注册码但 17 个 ad-hoc 生产码不在其中；docs 声称 78 但实际 unique 77；CI 一致性测试存在但仅覆盖 docs ↔ registry ↔ client meta 三方，不覆盖 ad-hoc 码 |
| S4 | F4：D1 nano_error_log 表 + 持久化 + fallback + cron 清理 | `done` | migration 006 DDL 完整；`persistErrorLogRecord` 有 D1 INSERT + fallback `emitObservabilityAlert(d1-write-failed)`；cron 每天 03:00 UTC |
| S5 | F5：/debug/logs + /debug/recent-errors 调试端点 | `done` | team gate 完整；trace_uuid/session_uuid/code/since 查询参数可用 |
| S6 | F6：Server-Timing 头 | `done` | `attachServerTimings` 在 orchestrator-core facade 出口注入 total;dur=N |
| S7 | F7：system.error stream kind | `partial` | schema 在 nacp-session 中完整；orchestrator-core 两个调用点（spike + emit validation failure）可发帧；但 agent-core kernel 不发帧（R2/R13） |
| S8 | F8：emitObservabilityAlert() critical alert | `done` | 4 类触发：d1-write-failed、rpc-parity-failed、r2-write-failed、audit-persist-failed |
| S9 | F9：bash-core / orchestrator-auth 接 logger + ad-hoc codes 进 docs | `done` | 6 worker console.* = 0；bash-core 7 ad-hoc codes 在 error-registry 和 error-codes.md §8 |
| S10 | F10：ESLint 重复定义防漂移 | `missing` | 无 eslint 配置文件存在（R4） |
| S11 | F11：D1 nano_audit_log + NACP audit.record + 8 类写路径 | `done` | 8 类 event_kind 全有写路径 + 1 额外类型 (session.start.failed)；audit record 有 D1 INSERT + fallback |
| S12 | F12：error-codes-client 子路径导出 | `done` | `@haimang/nacp-core/error-codes-client` 子路径可用；web client 已 import 并使用 |
| S13 | F13：web/微信 system.error 消费 + 双发降级窗口 | `partial` | web client 已完成（ChatPage.tsx system.error 处理 + dedupe）；微信小程序未覆盖（closure 标注 deferred） |
| S14 | §3.6 三套真相 4 条索引引用规则 | `done` | `cross-table-rules.test.ts` 存在；4 条规则覆盖 |
| S15 | 3 worker ORCHESTRATOR_CORE service binding | `done` | bash-core / context-core / filesystem-core wrangler.jsonc 全部新增 |
| S14b | P1-07 jwt-shared@0.1.0 首发到 GitHub Packages | `stale` | package.json 版本为 0.1.0，publishConfig 配置正确，但无法从外部验证 GitHub Packages HTTP 200（需授权）；closure 无 curl 截图证据 |
| S15b | P1-08 CI gate 脚本 | `done` | `scripts/verify-published-packages.mjs` 存在并挂载到 6 worker predeploy hook |
| S16 | P1-09 build-time package manifest 注入 | `done` | 6 worker 有 `generated/package-manifest.ts`；方式为 generated TS module 而非 esbuild --define，功能等价 |
| S17 | P6-04 /debug/packages 端点 | `done` | auth-gated、registry check + drift detection + 10s LRU 缓存 + graceful 降级 |
| S18 | Phase 9 gate：不切单发 | `done` | closure 显式记录顺延原因；双发窗口 isOpen |

### 3.1 对齐结论

- **done**: 14
- **partial**: 4 (F2, F3, F7, F13)
- **missing**: 1 (F10 ESLint)
- **stale**: 1 (jwt-shared publish verification)
- **out-of-scope-by-design**: 0

> RHX2 的骨架和核心管线已完成落地；partial 项主要集中在对 ad-hoc 错误码的注册覆盖率（F3）和 agent-core kernel 错误 emit 路径的缺失（F7/R2）；missing 项是 ESLint 防漂移规则（F10）。整体更像"核心管线打通但 far-edge 节点仍有 gap"，而非主体未完成。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | OTel SDK 完整接入 | `遵守` | 未引入任何 OTel 依赖或代码 |
| O2 | OTel span hierarchy | `遵守` | 无 span 树代码 |
| O3 | OTel histogram metrics | `遵守` | 无 histogram 代码 |
| O4 | Hook handler 注册表全量接电 | `遵守` | 仅 audit `hook.outcome` 写路径 |
| O5 | Evidence 业务持久化 | `遵守` | 无 evidence 持久化代码 |
| O6 | PII 自动脱敏框架 | `遵守` | 无脱敏代码 |
| O7 | 第三方 APM 直连 | `遵守` | 无 APM 集成 |
| O8 | session-replay | `遵守` | 无 replay 代码 |
| O9 | user-level telemetry opt-out | `遵守` | 无 opt-out 代码 |
| O10 | 重复定义代码合并 | `遵守` | 仅 ESLint 防漂移（但 ESLint 本身未落地 — R4） |
| O11 | Cloudflare Logpush 配置 | `遵守` | 无 logpush 代码 |
| O12 | bash-core 7 ad-hoc codes 归化为 zod enum | `遵守` | Q-Obs9 明确 out-of-scope |
| O13 | smind-admin error response 格式收敛 | `遵守` | 仅附录登记 |
| O14 | 微信小程序完整产品化适配 | `部分违反` | closure 显式 deferred 至独立客户端专项，不视为 scope 内；但 action plan P8-03/04/05 列为 in-scope，实际仅 web 完成 |
| O15 | `system.error` 切单发 | `deferred-by-gate` | Phase 9 gate 评估后决定保持双发，符合 Q-Obs11 准入条件逻辑 |
| O16 | ESLint no-console 规则 | `缺失` | F10 明确 in-scope，但全仓库无 eslint 配置（R4） |

---

## 5. 最终 verdict 与收口意见

- **最终 verdict**：RHX2 后端 observability/auditability 主线已被代码实现，Phase 1-6 全部落地，Phase 7-9 以 web-first spike 收口，双发窗口按 gate 规则保持。但存在 1 个 critical 安全问题（R1: 生产环境 spike 开关）、1 个 high 功能 gap（R2/R13: agent-core kernel 不 emit system.error）、1 个 high 正确性问题（R3: 17 个 ad-hoc 码不在注册表）、1 个 medium delivery gap（R4: ESLint 未落地）需要 follow-up。跨阶段审查发现 permission/elicitation/usage WS round-trip e2e 从 RH1 起持续空缺，以及 Lane E consumer sunset 未启动两个中等问题。

- **是否允许关闭本轮 review**：`yes`

- **关闭前必须完成的 blocker**：
  1. R1: 在下一次 deploy 前，将 `wrangler.jsonc` 顶层 vars 中 `NANO_ENABLE_RHX2_SPIKE` 改为 `"false"` 或删除

- **可以后续跟进的 non-blocking follow-up**：
  1. R2/R13: 在 agent-core runtime-mainline 错误路径增加 `system.error` emit（或通过 ORCHESTRATOR_CORE RPC 委托）
  2. R3: 将 17 个 ad-hoc 码注册到 error registry，使 `getErrorMeta()` 不返回 undefined
  3. R4: 新增 ESLint 配置或 CI grep 拦截步骤防止 console.* 漂移
  4. R6: 修正 `error-codes.md` 头行数字为 77 unique codes
  5. R7: 在 `error-index.md` 中补全 Kernel/Session/LLM 三类错误码
  6. R8: 更新 audit event_kind 文档清单为 9 类（含 session.start.failed）
  7. R9: 在 nacp-core 文档中区分 NACP_VERSION 与 package version
  8. R10: 在 hero-to-platform 中补充 permission/elicitation/usage WS round-trip e2e
  9. R11: 需要 owner 决策 Lane E sunset 时间盒
  10. R12: 在 hero-to-platform 中统一 /me/sessions cursor pagination
  11. R5: 微信小程序 system.error + error-codes-client 覆盖
  12. S14b: jwt-shared GitHub Packages 发布证据（curl HTTP 200 截图）需在 closure 中补充

- **建议的二次审查方式**：`independent reviewer`（因 R1 涉及生产安全，建议由至少一位独立 reviewer 确认修复）

- **实现者回应入口**：请按 `docs/templates/code-review-respond.md` 在本文档 §6 append 回应，不要改写 §0–§5。

---

## 6. 跨阶段深度分析补充

以下内容超越 RHX2 范围，对 real-to-hero 全阶段进行回顾性分析。

### 6.1 整体阶段完整性评估

| Phase | Closure 状态 | 实际审查判断 | 说明 |
|-------|-------------|-------------|------|
| RH0 | closed | 大致成立 | jwt-shared lockfile 重建、6 worker binding 占位、7 endpoint test 完成；但 jwt-shared publish 证据（S14b）缺失 |
| RH1 | close-with-known-issues | 基本成立 | Lane F 4 链主干接通；但 WS round-trip e2e 3 文件至今未创建（R10 延续） |
| RH2 | close-with-known-issues | 基本成立 | /models + context endpoints + NACP frame 升级落地；context-core 返回 phase:stub 仍为 deferred |
| RH3 | close-with-known-issues | 基本成立 | device auth gate 5-link chain 完成；/me/conversations cursor 标注实现但 /me/sessions next_cursor 仍 null |
| RH4 | close-with-known-issues | 基本成立 | file upload R2 pipeline + filesystem-core RPC 完成；但 Lane E consumer sunset 未启动（R11 延续） |
| RH5 | closed | 成立 | 25 model seeds + model_id + reasoning + vision live smoke |
| RH6 | closed-with-known-issues | 基本成立 | NanoSessionDO 拆分至 731 行；三层真相文档冻结；但 manual evidence 未收集、user-do 未至 handler 粒度 |
| RHX1 | closed | 成立 | 5 个 SSOT migration；README/index hygiene 完成 |
| RHX2 | closed-as-web-first-spike | 基本成立（附本文 R1-R13 发现） | 后端管线完成；web spike 完成；微信 + 单发已 deferred |

### 6.2 跨包一致性问题

| 问题 | 涉及包 | 说明 |
|------|--------|------|
| ad-hoc 错误码注册表缺口 | nacp-core + orchestrator-core + agent-core | 17 个生产路径使用的错误码在 `resolveErrorMeta()` 中返回 undefined |
| `tryEmitSystemError` 仅 orchestrator-core 调用 | nacp-core + agent-core + orchestrator-core | agent-core 的 runtime 错误不产生 system.error 帧 |
| `NACP_VERSION` vs `package.json version` 命名混淆 | nacp-core | 1.4.0 (protocol) vs 1.6.0 (npm) 语义不同但名称相似 |
| 双发窗口跨 nacp-core + nacp-session + web client | nacp-core + nacp-session + clients/web | 三处实现一致（system.error + system.notify 双发 + 1s 去重窗口） |
| `session.start.failed` audit event 不在 F11 原始清单 | orchestrator-core + migration 006 | DDL 无 CHECK 约束，写入路径已落地但文档未更新 |

### 6.3 命名规范与执行逻辑审查

| 项目 | 规范要求 | 实际状态 | 差异 |
|------|----------|----------|------|
| 错误码前缀 | FacadeErrorCode 应为 RPC 子集 | ad-hoc 码无前缀规范 | 17 个码不符合任何前缀约定 |
| 迁移编号 | §8.4 冻结：RH2→008 | RHX1 将 008 合并为 003 的一部分 | 编号已随 RHX1 SSOT 更新但 charter 未同步更新 |
| ESLint 防漂移 | §4.4 硬纪律 + P4-05 | 无 eslint 配置 | 机制缺失 |
| 三层真相 | §1.2 决议 D6 = DO memory ≠ user DO storage ≠ D1 | `observability.ts` 中 `persistErrorLogRecord` 和 `persistAuditRecord` 正确写入 D1 而非 DO storage | 遵守 |
| 包来源唯一真相 | v0.draft-r3 critical 门禁 | `/debug/packages` 端点返回 deployed + registry + drift | 遵守 |
| dual-track sunset | §4.4 硬纪律 #6 ≤2 周 | 已超过 charter 目标时间 | 违反（R11） |

### 6.4 clients/api-docs 文档核实

| 文档 | 与代码匹配 | 缺失 | 错误 |
|------|-----------|------|------|
| README.md | 大致匹配 | - | 端点矩阵基本完整 |
| auth.md | 匹配 | - | - |
| session.md | 匹配 | `model_id`/`reasoning`/`image_url` 参数在模型端点文档而非 session 文档 | - |
| session-ws-v1.md | 匹配 | system.error 帧尚未在 WS 协议文档中完整描述 | - |
| me-sessions.md | 匹配 | `next_cursor` 始终 null 已标注 | - |
| permissions.md | 匹配 | WS round-trip 标注为 not live（事实） | - |
| error-index.md | 部分匹配 | 缺 Kernel/Session/LLM 三类 22 个错误码（R7） | - |
| usage.md | 匹配 | `estimated_cost_usd` 始终 null 已标注 | - |
| catalog.md | 匹配 | 前 4 skills/5 commands/2 agents 是静态内容 | - |
| worker-health.md | 匹配 | debug endpoints 已包含 | - |

### 6.5 阶段收口连续性问题

1. **从 RH1 到 RHX2 持续 defer 的 WS round-trip e2e**（R10）：3 个 e2e 文件从未被任何 phase 创建。HTTP path 可用但 WS live push 未被自动化验证。
2. **Lane E consumer sunset 从 RH4 起持续 defer**（R11）：charter 硬纪律 ≤2 周，但实际已超过目标时间。
3. **Manual evidence 从 RH6 起持续 defer**（RH6 closure / RHX1 closure）：需要 owner 真机操作，目前未执行。
4. **jwt-shared publish 证据持续缺失**（S14b）：RH0 重建了 lockfile、RHX2 要求 jwt-shared@0.1.0 发布，但无 HTTP 200 截图证据。

---

*本审查基于 GLM-5.1 独立推理完成，未参考其他 reviewer（Kimi、DeepSeek、GPT）的分析报告。*