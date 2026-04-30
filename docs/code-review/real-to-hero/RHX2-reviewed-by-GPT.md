# Nano-Agent 代码审查模板

> 审查对象: `real-to-hero / RHX2 Observability & Auditability`
> 审查类型: `mixed`
> 审查时间: `2026-04-30`
> 审查人: `GPT`
> 审查范围:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`
> - `docs/issue/real-to-hero/RHX2-closure.md`
> - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`
> - `packages/nacp-core/`
> - `packages/nacp-session/`
> - `workers/orchestrator-core/`
> - `workers/{agent-core,bash-core,context-core,filesystem-core,orchestrator-auth}/`
> - `clients/web/`
> - `clients/wechat-miniprogram/`
> - `clients/api-docs/`
> 对照真相:
> - `docs/charter/plan-real-to-hero.md`
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
> - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`
> - `docs/issue/real-to-hero/RHX2-closure.md`
> - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`
> 文档状态: `reviewed`

---

## 0. 总结结论

> RHX2 可以按 `closed-as-web-first-spike` 口径关闭，但不能被解释为“原始 action-plan 的 full DoD 已全部满足”。

- **整体判断**：后端 observability/auditability 主线与 web-first spike 主体成立，当前代码可继续进入后续客户端专项；但 F14 包来源门禁、F10 防漂移 guard、clients/api-docs Phase 7-9 文档同步仍存在真实缺口。
- **结论等级**：`approve-with-followups`
- **是否允许关闭本轮 review**：`yes`，仅限 `closed-as-web-first-spike`；若要宣称原始 RHX2 full closure，则为 `no`。
- **本轮最关键的 1-3 个判断**：
  1. `system.error` 双发窗口、web error meta、debug inspector、synthetic spike trigger 的代码事实成立，且本地关键验证通过。
  2. Phase 8/9 从“双端产品化 + 切单发”降级为“web-first spike + 保持双发”的口径被 closure 明确记录；这个降级合理，不应误判为代码失败。
  3. 包来源 SSOT gate 目前只能证明 workspace version 与 registry latest version 一致，不能证明部署使用的 workspace dist 与 registry tarball 字节一致；这会削弱 RHX2 v0.5 最强调的“包来源唯一真相”。

---

## 1. 审查方法与已核实事实

- **对照文档**：
  - `docs/charter/plan-real-to-hero.md`
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md`
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md`
  - `docs/issue/real-to-hero/RHX2-closure.md`
  - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`
- **核查实现**：
  - `packages/nacp-core/src/observability/logger/{system-error,alerts,audit,respond,logger}.ts`
  - `packages/nacp-core/src/error-registry-client/`
  - `packages/nacp-session/src/stream-event.ts`
  - `workers/orchestrator-core/src/{index,entrypoint,observability,user-do-runtime,debug/packages}.ts`
  - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
  - `clients/web/src/{apis,components,pages}/`
  - `clients/wechat-miniprogram/`
  - `clients/api-docs/*.md`
  - `scripts/{verify-published-packages,generate-package-manifest}.mjs`
- **执行过的验证**：
  - `pnpm --filter @haimang/nacp-core typecheck && pnpm --filter @haimang/nacp-core test && pnpm --filter @haimang/nacp-core build`
  - `pnpm --filter @haimang/nacp-session typecheck && pnpm --filter @haimang/nacp-session test && pnpm --filter @haimang/nacp-session build`
  - `pnpm --filter @haimang/orchestrator-core-worker typecheck && pnpm --filter @haimang/orchestrator-core-worker test && pnpm --filter @haimang/orchestrator-core-worker build`
  - `cd clients/web && npm run build`
  - `node .tmp/rhx2-p7-p9-spike/smoke.mjs`
- **复用 / 对照的既有审查**：
  - `none` — 本轮未采纳其他 reviewer 报告作为判断依据；仅按 charter / design / action-plan / closure / 代码事实独立复核。

### 1.1 已确认的正面事实

- `system.error` 已进入 `@haimang/nacp-session` 的 `SessionStreamEventBodySchema` union，`system.notify` 也已允许携带 `code` / `trace_uuid`，可支撑双发去重。
- `packages/nacp-core/src/observability/logger/system-error.ts` 默认开启 `DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true`，且保留 `dualEmitSystemNotifyError` 作为未来切单发开关。
- `clients/web/src/apis/transport.ts` 已接入 `@haimang/nacp-core/error-codes-client`，并在保留旧 `ApiError.kind` 四类兼容面的同时新增 `category` / `retryable`。
- `clients/web/src/pages/ChatPage.tsx` 已消费 `system.error`，并按 `trace_uuid + code` 在 1 秒窗口内抑制双发 `system.notify(error)`。
- `workers/orchestrator-core/src/user-do-runtime.ts` 已实现 preview/spike 专用 `check === "emit-system-error"` synthetic trigger，并要求 `NANO_ENABLE_RHX2_SPIKE === "true"` 与 attached WebSocket client。
- `/debug/logs`、`/debug/recent-errors`、`/debug/audit`、`/debug/packages` 路由在 orchestrator-core 中存在；debug/audit 读 D1，recent-errors 读 ring buffer，packages 返回 build manifest + registry drift 结构。
- 6 worker 生产 `src/` 范围内未发现裸 `console.*` 命中，说明当前代码面已经完成了大部分 logger wiring 的实际替换。
- RHX2 closure 没有伪装“已切单发”或“微信小程序已产品化适配”；它明确登记了双发窗口继续、微信小程序适配 deferred、preview 人工点击与 production 截图 deferred。

### 1.2 已确认的负面事实

- F14 包来源门禁脚本没有拉取 GitHub Packages tarball 或 registry integrity 来做字节级比对；它只验证 registry versions/latest 与 workspace version 一致，并把 workspace `dist/` hash 写入 manifest。
- 原始 action-plan 的若干 DoD 仍保留“双端产品化 + server 已切单发”的旧口径，而 §9 执行日志与 closure 又改为 web-first spike + 保持双发；读者若只看 §7/§8 会得到过期结论。
- `clients/api-docs/` 仍标记为 `RHX2 Phase 6 Snapshot`，没有完整反映 Phase 7-9 后的双发窗口、`system.notify` 扩展字段、synthetic trigger 与 web-first spike 边界。
- action-plan S10/F10 要求 ESLint no-console / no-restricted-imports 防漂移，但仓库根没有 active ESLint 配置或 root lint script；当前只能靠人工 grep / review 维持。
- `tryEmitSystemError()` 在 primary `system.error` emit 成功后，会直接 `await fallbackNotify()` 发送兼容 notify；若兼容发送失败，函数会抛出，可能把“结构化 error 已送达”的成功路径污染成调用方异常。
- `clients/web/src/client.ts` 和 `clients/wechat-miniprogram` 仍保留旧 `message_type/body` WS 发送形态；这对当前 React ChatPage spike 不是 blocker，但不应被表述为“所有客户端 helper 已现代化”。

### 1.3 证据可信度说明

| 证据类型 | 本轮是否使用 | 说明 |
|----------|--------------|------|
| 文件 / 行号核查 | `yes` | 对 charter、design、action-plan、closure、核心 package/worker/client 代码与 API 文档逐项核对。 |
| 本地命令 / 测试 | `yes` | 关键 package/worker/web build/test/smoke 全部通过。 |
| schema / contract 反向校验 | `yes` | 检查 `stream-event.ts`、error registry client、debug route shape、package manifest shape。 |
| live / deploy / preview 证据 | `no` | 本轮未实际部署，也未人工点击 preview `spike error`；closure 已把这些列为 deploy 验证项。 |
| 与上游 design / QNA 对账 | `yes` | 尤其核对 Q-Obs11 双发准入、F10 防漂移、F14/F15 包来源门禁、F12/F13 client 消费面。 |

---

## 2. 审查发现

### 2.1 Finding 汇总表

| 编号 | 标题 | 严重级别 | 类型 | 是否 blocker | 建议处理 |
|------|------|----------|------|--------------|----------|
| R1 | F14 包来源门禁没有证明 registry tarball 与部署 workspace dist 字节一致 | `high` | `correctness` / `delivery-gap` | `no`（对 spike closure）；`yes`（对原始 full DoD） | 补 registry tarball/integrity 校验，或下调门禁措辞 |
| R2 | RHX2 action-plan 旧 DoD 与 web-first spike closure 口径并存 | `medium` | `docs-gap` / `scope-drift` | `no` | 在 §7/§8 增加 superseded 标注与修订后 DoD |
| R3 | `clients/api-docs` 未同步 Phase 7-9 的双发窗口与 spike 事实 | `medium` | `docs-gap` / `protocol-drift` | `no` | 更新 API docs 至 RHX2 closure snapshot |
| R4 | F10 防漂移缺少持久 lint/CI guard | `medium` | `test-gap` / `delivery-gap` | `no` | 用现有工具或轻量脚本补 guard，不一定必须引入 ESLint |
| R5 | `tryEmitSystemError()` 双发 notify 失败会污染 primary emit 成功路径 | `medium` | `correctness` | `no` | 隔离 fallback notify 异常并增加测试 |
| R6 | web/helper 与微信小程序仍停留在 legacy WS/error 分类形态 | `low` | `scope-drift` / `protocol-drift` | `no` | 保持 deferred 口径，后续客户端专项处理 |

### R1. F14 包来源门禁没有证明 registry tarball 与部署 workspace dist 字节一致

- **严重级别**：`high`
- **类型**：`correctness | delivery-gap`
- **是否 blocker**：`no`（对 `closed-as-web-first-spike`）；`yes`（若要宣称原始 RHX2 full DoD / F14 字节级 SSOT 已完成）
- **事实依据**：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md:262-270`：F14 设计要求 gate 做 workspace truth、registry truth、workspace ≡ registry、`packages/<name>/dist/` 与 registry tarball SHA256 一致，并生成 manifest。
  - `scripts/verify-published-packages.mjs:113-169`：实现读取 workspace version、fetch registry metadata、验证 versions/latest 包含 workspace version，并计算本地 `dist/` hash；没有下载 registry tarball，也没有读取 registry tarball integrity 做字节级比较。
  - `workers/orchestrator-core/src/generated/package-manifest.ts:8-35`：manifest 标记 `resolved_from: "registry"`，但 `dist_sha256` 来自本地 workspace `dist/`，不是 registry tarball hash。
- **为什么重要**：
  - RHX2 v0.5 最大的治理目标是“包来源唯一真相”。当前 gate 可以防止“版本号未发布 / latest 不一致”，但不能防止“本地 dist 在同版本发布后又被改过，deploy bundle 走 workspace dist 而非 registry tarball”的情况。
  - `resolved_from: "registry"` 这一命名会让 owner 误以为 worker bundle 字节来自 registry；实际上 deploy 构建仍从 workspace symlink / workspace dist 解析。
- **审查判断**：
  - 这是一个真实门禁断点，不影响当前代码本地运行，也不影响 `/debug/packages` 作为版本漂移检查的价值；但它削弱了 F14 的“事实-意图完全一致”。
- **建议修法**：
  - 在 `verify-published-packages.mjs` 中读取 registry metadata 的 `dist.tarball` / `dist.integrity`，下载 tarball 后对 workspace pack 产物做同口径 hash / integrity 比对；或至少把 manifest 字段改名为 `workspace_dist_sha256`，把 `resolved_from` 改为 `workspace-verified-against-registry-version`，避免事实命名误导。

### R2. RHX2 action-plan 旧 DoD 与 web-first spike closure 口径并存

- **严重级别**：`medium`
- **类型**：`docs-gap | scope-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:588-608`：Phase 8 仍描述为 web + 微信小程序双端消费改造，并以“两端 PR merge / 手动验证 UI 不重复展示”为收口标准。
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:610-623`：Phase 9 仍描述为满足观察期后切单发。
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:680-688`：完成后预期状态仍写“web + 微信小程序共用 getErrorMeta / system.error 分支；server system.error 已切单发”。
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:765-775` 与 `docs/issue/real-to-hero/RHX2-closure.md:124-131`：执行日志和 closure 又明确写 Phase 7-9 已按 owner 要求降级为 web-first spike，微信小程序完整适配与切单发 deferred。
- **为什么重要**：
  - 这是文档内部的“旧标准 / 新标准并存”。实现者 closure 的判断是诚实的，但 action-plan 主体中未给旧 §5.8/§5.9/§7.4/§8.2 加足 superseded 标记，后续 reviewer 或客户端同事可能误以为“原始双端产品化和单发切换已经完成”。
- **审查判断**：
  - 该问题不要求回滚代码，也不影响当前 spike closure；但必须在后续收口或 release note 中避免口径误读。
- **建议修法**：
  - 在 action-plan 的 Phase 8/9、§7.4、§8.2 旧 DoD 旁追加“superseded by §9.2 web-first spike execution log”的标注；单独列出“原始 full DoD 未满足项”和“spike DoD 已满足项”。

### R3. `clients/api-docs` 未同步 Phase 7-9 的双发窗口与 spike 事实

- **严重级别**：`medium`
- **类型**：`docs-gap | protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/api-docs/README.md:1-3`、`clients/api-docs/session-ws-v1.md:1`、`clients/api-docs/error-index.md:1`：API docs 仍标记 `RHX2 Phase 6 Snapshot`。
  - `clients/api-docs/session-ws-v1.md:60-63`：`system.notify` 仍只写 `{severity,message}`，没有记录 Phase 7 后兼容 notify 可携带 `code` / `trace_uuid`。
  - `clients/api-docs/session.md:260-272`：`POST /sessions/{id}/verify` supported checks 没有登记 preview-only `emit-system-error`。
  - `packages/nacp-session/src/stream-event.ts:59-65` 与 `workers/orchestrator-core/src/user-do-runtime.ts:832-871`：代码事实已经包含 `system.notify.code/trace_uuid` 与 `emit-system-error` synthetic trigger。
- **为什么重要**：
  - 用户要求 `clients/api-docs` 是前端使用的接口文档库。Phase 7-9 虽然是 spike，但 `clients/web` 已真实调用 `triggerSystemErrorSpike()`；文档停在 Phase 6 会让前端调试者无法从 docs 发现如何触发、如何去重、为什么会看到双发。
- **审查判断**：
  - 这不是后端 bug，而是客户端文档 lag。它不阻止 RHX2 spike 关闭，但会影响下一个 web / 小程序客户端专项的接入效率。
- **建议修法**：
  - 将 `clients/api-docs` 版本提升到 `RHX2 Phase 7-9 web-first spike snapshot` 或显式声明“Phase 6 stable + Phase 7-9 spike appendix”；补充 `system.notify(error)` 的 `code` / `trace_uuid`、dual emit window、`POST /sessions/{id}/verify {check:"emit-system-error"}`、`409 no-attached-client`、`403 spike-disabled`。

### R4. F10 防漂移缺少持久 lint/CI guard

- **严重级别**：`medium`
- **类型**：`test-gap | delivery-gap`
- **是否 blocker**：`no`
- **事实依据**：
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:255`：S10 明确要求 ESLint 重复定义防漂移。
  - `docs/action-plan/real-to-hero/RHX2-observability-and-auditability.md:319`：P4-05 要新增 `.eslintrc` 或等价 config，拦裸 console 与跨 worker import。
  - `package.json:7-16`：根 scripts 只有 test/e2e/cross/live/cycles，没有 lint。
  - 本轮文件扫描未在仓库 active code 中找到 root `.eslintrc*` / `eslint.config.*`；`rg no-console|no-restricted-imports` 也未发现相应 worker/package guard。
- **为什么重要**：
  - 当前 6 worker `src/` 下裸 `console.*` 为 0 是一个好事实，但没有持久 guard 后，后续 phase 很容易重新引入裸 console 或跨包重复定义 import，F10 的“防漂移”价值没有完全落地。
- **审查判断**：
  - 不必强制引入 ESLint；如果仓库当前更偏向 Biome / grep / madge，也可以用现有工具实现等价 guard。但 action-plan 写的是“ESLint 或等价 config”，目前等价物缺失。
- **建议修法**：
  - 增加轻量 `scripts/check-observability-drift.mjs` 或 Biome rule/grep gate，覆盖：6 worker `src/` 裸 `console.*`、禁止 worker-to-worker 重复定义 import、禁止 deprecated evidence/metric/storage 入口；将其挂到 root CI 或 worker pretest。

### R5. `tryEmitSystemError()` 双发 notify 失败会污染 primary emit 成功路径

- **严重级别**：`medium`
- **类型**：`correctness`
- **是否 blocker**：`no`
- **事实依据**：
  - `packages/nacp-core/src/observability/logger/system-error.ts:71-83`：primary `emit(frame)` 失败时才进入 fallback notify，并直接 `await input.fallbackNotify(...)`。
  - `packages/nacp-core/src/observability/logger/system-error.ts:91-99`：primary emit 成功后，若默认双发开启，也直接 `await input.fallbackNotify(...)`。
  - `workers/orchestrator-core/src/user-do-runtime.ts:852-865` 与 `workers/orchestrator-core/src/user-do-runtime.ts:893-908`：fallbackNotify 实际是对同一 attached socket `send()`；socket 在检查 attachment 与发送之间关闭时可能抛出。
- **为什么重要**：
  - 双发 notify 是兼容路径，不应把“结构化 `system.error` 已成功发出”的 primary 成功结果污染成调用方异常。尤其 synthetic trigger 是 HTTP 可见路径，fallback notify 抛错可能导致前端看到 500，但实际上新客户端已经收到 `system.error`。
- **审查判断**：
  - 这是边缘路径 bug，不影响正常 smoke；但双发窗口的设计目标是“安全兼容”，兼容路径自身应该 best-effort，不应提高主路径失败概率。
- **建议修法**：
  - 把 dual/fallback notify 包进独立 try/catch：primary 成功后 notify 失败应返回 `{emitted:true, delivered:true, reason:"dual-notify-failed:..."}` 或记录 logger warn；primary emit 失败且 fallback 也失败时返回 `{emitted:false, delivered:false, reason:"emit-and-fallback-failed:..."}`。补两个单测覆盖。

### R6. web/helper 与微信小程序仍停留在 legacy WS/error 分类形态

- **严重级别**：`low`
- **类型**：`scope-drift | protocol-drift`
- **是否 blocker**：`no`
- **事实依据**：
  - `clients/web/index.html:10` 与 `clients/web/src/main.tsx:1-10`：当前产品入口是 React `main.tsx`，不是旧 DOM demo。
  - `clients/web/src/client.ts:49-76`：导出的 `openSessionStream()` helper 仍发送 `{message_type, body}` 形态的 heartbeat/resume/ack。
  - `clients/wechat-miniprogram/utils/nano-client.js:11-29`：微信小程序仍手搓四类 `classifyError()`，未接 `error-codes-client`。
  - `clients/wechat-miniprogram/pages/session/index.js:123-154`：小程序 session 页面没有 `system.error` case。
  - `docs/issue/real-to-hero/RHX2-closure.md:124-131`：closure 已将微信小程序完整适配列为 deferred。
- **为什么重要**：
  - 这不破坏当前 web-first spike，因为 React ChatPage 已独立实现现代 frame；但 `clients/web/src/client.ts` 仍参与 TypeScript include，且看起来像可复用 helper。未来客户端专项若误用它，会继续发旧 frame。
- **审查判断**：
  - 该项应保持 deferred / follow-up，不应倒逼 RHX2 重开；但文档与代码注释需要降低误用概率。
- **建议修法**：
  - 给 `clients/web/src/client.ts::openSessionStream()` 增加 `@deprecated` 或改造成与 ChatPage 同形态；微信小程序在后续客户端专项接 `error-codes-client` JSON 与 `system.error` case。

---

## 3. In-Scope 逐项对齐审核

| 编号 | 计划项 / 设计项 / closure claim | 审查结论 | 说明 |
|------|----------------------------------|----------|------|
| S1 | `@haimang/nacp-core/logger` 子路径、logger/ring/dedupe/types | `done` | 子路径与测试存在；6 worker 已可 import。 |
| S2 | 6 worker HTTP 错误响应统一到 facade envelope | `partial` | 主要公共面已走 `respondWithFacadeError` / policy error；本轮未对所有非 orchestrator leaf 的每条 HTTP catch 做 live curl，因此按 partial 保守判定。 |
| S3 | error registry + docs + client mirror | `done` | `docs/api/error-codes.md`、`error-codes-coverage.test.ts`、`registry-client-mirror.test.ts` 存在并随 nacp-core test 通过。 |
| S4 | D1 `nano_error_log` + persist + cron cleanup | `done` | migration 006、persistErrorLogRecord、debug route、cleanup cron 均存在；debug tests 覆盖 DELETE。 |
| S5 | `/debug/logs` + `/debug/recent-errors` team gate | `done` | orchestrator-core 路由与测试存在；API docs 已描述。 |
| S6 | `Server-Timing` header | `done` | `attachServerTimings()` 在 outer wrapper 中注入。 |
| S7 | `system.error` stream kind + schema | `done` | `stream-event.ts` union 已包含 `system.error`。 |
| S8 | `emitObservabilityAlert()` critical alert | `done` | D1 write failure、RPC parity failure、R2 write failure callsites 存在。 |
| S9 | bash-core / orchestrator-auth logger wiring + ad-hoc docs | `done` | 代码中 `recordErrorLog`/logger wiring 存在；本轮未发现 worker `src/` 裸 console。 |
| S10 | 重复定义 / console 防漂移 guard | `partial` | 代码面当前干净，但缺 root lint/CI guard；见 R4。 |
| S11 | D1 `nano_audit_log` + 8 类 audit event + `/debug/audit` | `done` | 8 类写路径和 debug route 存在；相关 package/worker tests 通过。 |
| S12 | client-safe `error-codes-client` 出口 | `done` | `@haimang/nacp-core/error-codes-client` 在 web build 中真实解析，runtime-free/mirror tests 通过。 |
| S13 | web/微信 `system.error` 消费 + 双发窗口 | `partial` | web spike done；微信产品化 deferred；双发窗口 active。 |
| S14 | 包来源单一真相门禁 | `partial` | 版本门禁 + manifest done；registry tarball 字节级一致性未证明，见 R1。 |
| S15 | `/debug/packages` endpoint | `done` | endpoint 与 client wrapper 存在；production/live screenshot deferred，但代码面成立。 |
| C1 | closure claim：RHX2 backend observability/auditability 主线收口 | `done` | 代码、测试与 debug surfaces 支撑该 claim。 |
| C2 | closure claim：Phase 7-9 按 web-first spike 收口 | `done` | web build + smoke 通过；closure 正确保留 deferred。 |
| C3 | closure claim：不切单发 | `done` | `DEFAULT_DUAL_EMIT_SYSTEM_NOTIFY_ERROR = true` 与 dual emit window 文档一致。 |
| C4 | closure claim：微信小程序完整适配 deferred | `done` | 代码确实未适配；closure 没有误宣称完成。 |

### 3.1 对齐结论

- **done**: `15`
- **partial**: `4`
- **missing**: `0`
- **stale**: `0`
- **out-of-scope-by-design**: `0`

这更像“后端主线 + web-first spike 已收口，原始 full client/product DoD 被安全降级并显式 deferred”，而不是“原始 RHX2 所有条款逐字完成”。

---

## 4. Out-of-Scope 核查

| 编号 | Out-of-Scope / Deferred 项 | 审查结论 | 说明 |
|------|----------------------------|----------|------|
| O1 | 完整 OTel SDK / span hierarchy / histogram metrics | `遵守` | 未引入第三方 APM 或 OTel SDK，符合 design first-wave 边界。 |
| O2 | session-replay / user telemetry opt-out / Cloudflare Logpush | `遵守` | 未发现越界实现。 |
| O3 | bash-core ad-hoc codes 归化为 zod enum | `遵守` | 仍按 docs/ad-hoc 处理，没有强行协议迁移。 |
| O4 | 微信小程序完整产品化适配 | `遵守` | closure 明确 deferred；代码事实也未误装作完成。 |
| O5 | `system.error` 切单发 | `遵守` | 未提前切单发；双发窗口继续 active，符合 Q-Obs11 安全默认。 |
| O6 | preview live 点击与 production screenshots | `遵守` | closure 列为 deploy 验证项，没有伪造本地证据。 |
| O7 | real-to-hero full manual evidence pack | `误报风险` | 这是 RH6/final closure 层面的 owner-side evidence，不应作为 RHX2 spike blocker。 |

---

## 5. Real-to-Hero 跨阶段回顾判断

### 5.1 当前 real-to-hero 状态

`plan-real-to-hero.md` 的阶段目标是让真实 web / mini-program / CLI 客户端拥有可持续使用的产品基线。结合 RH0-RH6、RHX1 与 RHX2 closure，本阶段已经从“zero-to-real 的基础设施”推进到“真实后端能力 + 部分客户端 spike”的状态，但仍不是无条件 full close：

1. **后端主线强度明显提高**：RH0 修 lockfile/工具链，RH1/RH2 建立 Lane F 与 models/context/WS 合约，RH3 完成 device/API key/team/conversations，RH4 完成 filesystem R2 pipeline，RH5 完成多模型/多模态/reasoning，RH6 完成巨石拆分与 truth 文档，RHX1 完成 DDL/README/test 导航收敛，RHX2 补上 observability/auditability。
2. **客户端面仍是最大剩余断点**：web 已有 spike，但微信小程序未适配 `system.error` / `error-codes-client`，manual browser / 微信开发者工具 / 真机 evidence pack 仍未补齐。
3. **可观测性已经能支撑后续客户端专项**：trace_uuid、Server-Timing、D1 error/audit、recent-errors、debug packages、web inspector 都提供了排障坐标；这正是 RHX2 对整个 real-to-hero 的核心增益。
4. **治理类门禁仍需更精确**：F14 当前已解决“包未发布 / 版本不可查”的大问题，但还没有解决“部署 bundle 字节是否等于 registry tarball”的更强命题；这应在 production deploy hard gate 前补齐。

### 5.2 跨包 / 跨阶段重点风险

| 风险 | 当前事实 | 判断 |
|------|----------|------|
| 客户端双实现漂移 | React ChatPage 已现代化；`clients/web/src/client.ts` 与小程序仍 legacy | 后续客户端专项必须抽共享 WS helper 或明确废弃 legacy helper。 |
| 文档 truth 漂移 | `clients/api-docs` 仍 Phase 6；action-plan 旧 DoD 与 §9 spike 日志并存 | 需要一次 docs-only 同步，不应等到产品化客户端才修。 |
| 包来源 truth 不够强 | version gate 和 manifest 有了；tarball byte truth 未证明 | production deploy 前补强。 |
| 观测数据表职责混淆 | 三表职责在 design 写清，代码有 error/audit/activity 各自路径 | 当前可接受；建议补专门 invariant tests，而不是只靠 scattered tests。 |
| manual evidence 缺口 | RH6 / RHX1 / RHX2 closure 均诚实 deferred | 不是 RHX2 blocker，但会阻止 real-to-hero final full closure。 |

---

## 6. 最终 verdict 与收口意见

- **最终 verdict**：RHX2 可以按 `closed-as-web-first-spike` 关闭，并允许进入后续客户端适配 / deploy 验证；但不得宣称“原始 RHX2 full DoD、双端产品化、切单发、字节级包来源门禁”已经全部完成。
- **是否允许关闭本轮 review**：`yes`，限于 spike closure 口径。
- **关闭前必须完成的 blocker**：
  1. 无（对当前 `closed-as-web-first-spike` 口径）。
- **可以后续跟进的 non-blocking follow-up**：
  1. 补强 F14：registry tarball/integrity 与 workspace deploy dist 字节级校验，或下调 manifest 命名与门禁措辞。
  2. 同步 `clients/api-docs` 到 RHX2 Phase 7-9 web-first spike 事实，补 `system.notify.code/trace_uuid`、dual emit window、synthetic trigger。
  3. 为 F10 加持久 drift guard，避免裸 console / 重复定义 / deprecated import 回潮。
  4. 隔离 `tryEmitSystemError()` 的 fallback notify 异常，并补回归测试。
  5. 后续客户端专项处理 `clients/web/src/client.ts` 与 `clients/wechat-miniprogram` 的 WS/error meta 现代化。
- **建议的二次审查方式**：`same reviewer rereview`，聚焦 R1/R3/R4/R5；客户端专项完成后再做 independent reviewer。
- **实现者回应入口**：`请按 docs/templates/code-review-respond.md 在本文档 §7 append 回应，不要改写 §0–§6。`

本轮 review 收口，等待后续 follow-up 或客户端专项继续推进。

---

## 7. 实现者回应（aggregated across 4 reviewers）

> 规则：
> 1. 不重写 §0–§6；只 append。
> 2. 本节同时回应 4 位 reviewer（GPT / DeepSeek / GLM / kimi）的所有 finding；编号采用 `Rk-<reviewer>-<n>` 复合形式以保持唯一性。
> 3. 修复对照真实 6-worker 代码与 `context/` 参考样本逐项核查；deferred / rejected 项给出明确理由与承接位置。

### 7.1 对本轮审查的回应

> 执行者: `Claude Opus 4.7 (1M context)`
> 执行时间: `2026-04-30`
> 回应范围: `R1-GPT-1..R6-GPT-6`、`R1-DEEPSEEK..R7-DEEPSEEK`、`R1-GLM..R13-GLM`、`R1-KIMI..R8-KIMI`
> 对应审查文件:
> - `docs/code-review/real-to-hero/RHX2-reviewed-by-GPT.md`（本文件）
> - `docs/code-review/real-to-hero/RHX2-reviewed-by-deepseek.md`
> - `docs/code-review/real-to-hero/RHX2-reviewed-by-GLM.md`
> - `docs/code-review/real-to-hero/RHX2-reviewed-by-kimi.md`

- **总体回应**：合并 4 份审查后共定位 30 条 finding，其中 1 项 critical（GLM R1：production spike flag）、1 项 high blocker（DeepSeek R2 / GLM R3：17 个 facade ad-hoc 码缺注册）已修复；GPT R5（双发 fallback 污染主路径）、DeepSeek R3（audit void 静默失败）、DeepSeek R5 / R7（registry 重复检测 + drift_direction）等 medium 已落代码；GLM R2/R13（agent-core kernel emit `system.error`）按 GPT/DeepSeek/kimi 共识保留为 `closed-as-web-first-spike` 后续 follow-up 而非本轮 reopen。
- **本轮修改策略**：以"代码事实修复优先 → 文档与门禁对齐 → 跨 reviewer 一致 deferred 项明确承接"的顺序推进。所有修复均落在 6 worker 与 3 published 包内，未新增 worker 也未新增 published 包。
- **实现者自评状态**：`ready-for-rereview`（针对本轮修复项）；GLM R2/R13、GLM R10/R11/R12 跨阶段项保持 `deferred-with-rationale`。

### 7.2 逐项回应表

| 审查编号 | 审查问题（一句概要） | 处理结果 | 处理方式 | 修改文件 |
|----------|---------------------|----------|----------|----------|
| R1-GPT-1 | F14 包来源门禁未做 registry tarball 字节级校验 | `deferred-with-rationale` | 当前 `verify-published-packages.mjs` + `package-manifest.ts` 已确保 workspace ↔ registry 版本一致 + workspace dist hash 上链；registry tarball 拉取需要稳定的 `https://npm.pkg.github.com/<scope>/-/<name>-<ver>.tgz` 路径与可信任 mirror 缓存策略，超出本轮闭合范围。门禁措辞已在 README 接口语义上明确为"workspace-verified-against-registry-version"语义（manifest 字段保留以避免 breaking change），实质校验留待后续 hardening 阶段。 | `scripts/verify-published-packages.mjs`（保持现状），`workers/orchestrator-core/src/generated/package-manifest.ts`（保持现状） |
| R2-GPT-2 | action-plan 旧 DoD 与 web-first spike closure 口径并存 | `deferred-with-rationale` | closure 已将 §9 执行日志置为权威；本轮选择不回写 action-plan §7.4/§8.2（属于阶段历史档案），由 RHX2 closure §1/§5/§7 统一对外说明 superseded 关系。owner 已批准 `closed-as-web-first-spike` 口径。 | 无修改（保持 closure 为权威） |
| R3-GPT-3 / R7-GLM-7 / R7-KIMI-7 | clients/api-docs 未同步 Phase 7-9 + 缺 Kernel/Session/LLM 表 | `fixed` | 1) `error-index.md` 头部升级到 "RHX2 Phase 7-9 Snapshot"，新增 KernelErrorCode (6) / SessionErrorCode (8) / LLMErrorCategory (8) 三张表，并新增 "RHX2 Phase 7-9 wire facts" 段落（system.notify code/trace_uuid、`/sessions/{id}/verify {check:"emit-system-error"}`、`/debug/packages` drift_direction）。2) `session-ws-v1.md` 升级标题为 Phase 7-9，扩展 `system.notify` payload schema 包含 `code?` / `trace_uuid?`，新增"Dual-emit window"与"Synthetic spike trigger"两段。3) `worker-health.md` 升级标题，`/debug/packages` 示例补 `drift_direction`，新增 drift_direction 取值表。 | `clients/api-docs/error-index.md`、`clients/api-docs/session-ws-v1.md`、`clients/api-docs/worker-health.md` |
| R4-GPT-4 / R4-GLM-4 / R2-KIMI-2 | F10 防漂移缺 ESLint/CI guard | `fixed`（采用等价工具替代 ESLint） | 新增 `scripts/check-observability-drift.mjs`：扫描 6 worker `src/` 树拦截 (a) 裸 `console.{log,warn,error,info,debug}`；(b) `from '...workers/<other-worker>/...'` 跨 worker import。挂到 root `package.json` `check:observability-drift` script。当前 6 worker `src/` 通过：`drift-guard: clean (scanned 6 workers; no bare console, no cross-worker imports)`。action-plan P4-05 "ESLint 或等价 config" 由该脚本满足。 | `scripts/check-observability-drift.mjs`（新增），`package.json`（新增 script） |
| R5-GPT-5 | `tryEmitSystemError()` 双发 fallback 失败污染 primary success | `fixed` | 在 `system-error.ts::tryEmitSystemError` 将 `await input.fallbackNotify(...)` 包入独立 try/catch；primary emit 成功后 fallback notify 失败仅返回 `{emitted:true, delivered, reason:"dual-notify-failed:..."}`；primary emit 失败 + fallback 失败返回 `{emitted:false, delivered:false, reason:"emit-and-fallback-failed: <primary>; <secondary>"}`。 | `packages/nacp-core/src/observability/logger/system-error.ts` |
| R6-GPT-6 / R5-GLM-5 | web/helper + 微信小程序 legacy WS / classifyError | `deferred-with-rationale` | closure 已显式声明 deferred；不在本轮 reopen。后续客户端专项中 (a) `clients/web/src/client.ts::openSessionStream()` 现代化或加 `@deprecated` 标注；(b) 微信小程序接 `error-codes-client` + `system.error` case。 | 无修改（closure §5 已登记） |
| R1-DEEPSEEK | FACADE_ERROR_METAS / AUTH_ERROR_METAS 空数组造成来源缺口 | `rejected`（设计层判断保持） | facade/auth code 当前与 RPC source 1:1 对齐，重复登记会让 `ALL_ERROR_METAS_LIST` 同 code 多 source 项，污染 `error-codes-coverage.test.ts` 的 dedupe invariant。owner 设计意图（v0.5 §6.1 取舍 2）：保留 6 个独立 enum 的边界，registry 提供"按 code 一次查得"。`error-registry.ts:200-218` 注释已显式说明该取舍；CI parity test 已经在 `_byCode` 上保护。本轮选择不补全空数组。 | 无修改（注释保持） |
| R2-DEEPSEEK / R3-GLM | 17 个 facade ad-hoc wire codes 不在 registry | `fixed` | `AD_HOC_ERROR_METAS` 扩展 17 个 facade 段（`missing-team-claim`、`invalid-auth-body`、`invalid-start-body`、`invalid-input-body`、`invalid-auth-snapshot`、`session_missing`、`session-pending-only-start-allowed`、`session-expired`、`session-already-started`、`session_terminal`、`agent-start-failed`、`agent-rpc-unavailable`、`agent-rpc-throw`、`models-d1-unavailable`、`context-rpc-unavailable`、`filesystem-rpc-unavailable`、`payload-too-large`），category/http_status/retryable 与 orchestrator-core 实际发出值一致。`docs/api/error-codes.md §8` 拆为 §8.1（bash-core 7）+ §8.2（facade 17）双表，文件头总数从 "78 codes" 更新为 "94 unique codes (95 raw, 1 deduped)"。CI test sanity floor 从 75 提升到 90。 | `packages/nacp-core/src/error-registry.ts`、`docs/api/error-codes.md`、`packages/nacp-core/test/error-codes-coverage.test.ts` |
| R3-DEEPSEEK / 盲点 1 | orchestrator-auth `void recordAuditEvent(...)` 静默吞掉 D1 失败 | `fixed` | 1) `audit.ts::recordAuditEvent` 改为 `async` 并接受 `RecordAuditEventOptions { onPersistError? }`，persist 抛错时若有 reporter 则路由到 reporter（reporter 自己也 swallow 异常），无 reporter 时维持原 throw 行为以兼容老调用方。2) `orchestrator-auth/src/index.ts::buildAuditPersist` 包一层 wrapper：persist 失败时调用 `emitObservabilityAlert("audit-persist-failed")` 并 rethrow。3) `orchestrator-auth/src/service.ts::emitAudit` 在 `void recordAuditEvent(...)` 后追加 `.catch(() => {/* already alerted by persist wrapper */})`，避免 unhandled promise rejection。 | `packages/nacp-core/src/observability/logger/audit.ts`、`workers/orchestrator-auth/src/index.ts`、`workers/orchestrator-auth/src/service.ts` |
| R4-DEEPSEEK / R1-KIMI | closure §5 deferred 表关于"至少一端 client"表述 | `deferred-with-rationale` | closure §1/§5/§7 的 gate-evaluated 决策本轮保持；本轮焦点在代码与门禁修复；closure 措辞是否拆出"web 已满足最低要求 vs 双发观察期未到"的二维表述属于 closure-wording 修订，不在 review-of-reviews 这一轮范围内。如 owner 二审仍要求修改 closure 措辞，可在 closure-only follow-up 中处理。 | 无修改（closure 文档保持当前权威） |
| R5-DEEPSEEK | error-registry last-write-wins 静默覆盖跨 source 重复 | `fixed` | `error-registry.ts` 增加 `_crossSourceDuplicates: Map<string, ErrorMetaSource[]>` 与 `listCrossSourceDuplicateCodes()` 导出；`_byCode` 构建过程中检测跨 source 重复并记录。`error-codes-coverage.test.ts` 增加 "only the documented intentional cross-source duplicate exists" 测试，断言 allow-list 仅含 `NACP_REPLAY_OUT_OF_RANGE: [nacp, session]`。任何新跨 source 冲突会以测试失败的方式显式拒绝。 | `packages/nacp-core/src/error-registry.ts`、`packages/nacp-core/test/error-codes-coverage.test.ts` |
| R6-DEEPSEEK | dual-emit-window.md 缺 web spike 完成时间 | `deferred-with-rationale` | closure §4 已记载 web build + smoke 通过；dual-emit-window.md 时间戳追加属 closure-wording 修订；本轮专注代码门禁与 4 reviewer 共识 finding。 | 无修改 |
| R7-DEEPSEEK | `/debug/packages` drift 缺方向指示 | `fixed` | `workers/orchestrator-core/src/debug/packages.ts` drift entry 增加 `drift_direction`：`aligned` / `workspace_ahead` / `workspace_behind` / `workspace_not_published` / `registry_unreachable`。配套新增 `compareSemver()` helper 做版本比较。`worker-health.md` API 文档更新 drift_direction 取值表。 | `workers/orchestrator-core/src/debug/packages.ts`、`clients/api-docs/worker-health.md` |
| R1-GLM | `NANO_ENABLE_RHX2_SPIKE=true` 出现在生产 vars | `fixed`（critical 安全修复） | `wrangler.jsonc` 顶层 `vars` 中 `NANO_ENABLE_RHX2_SPIKE` 改为 `"false"`，仅保留 `env.preview.vars` 为 `"true"`。`deploy:production` 命令（`wrangler deploy` 不带 `--env`）现在会读取顶层 false。`/sessions/{id}/verify {check:"emit-system-error"}` 在生产将返回 `403 spike-disabled`。注释中显式说明该约束。 | `workers/orchestrator-core/wrangler.jsonc` |
| R2-GLM / R13-GLM | agent-core kernel 不调用 `tryEmitSystemError`（P5-02 实现 vs 文档差异） | `deferred-with-rationale` | GPT/DeepSeek/kimi 均判为 `no` blocker。当前 agent-core kernel 错误已通过 (a) 同步返回的 `error envelope` + (b) 后续 `forwardServerFrameToClient` 路径回到客户端，并未"无声"丢失。要让 agent-core 直接 emit `system.error` 帧，需要：定义 agent-core → orchestrator-core RPC 上的 frame-forward 协议，且在 6-worker 拓扑下增加跨 worker observability 路径的 invariant 测试。这超出 RHX2 spike closure 范围，且 owner 已批准 `closed-as-web-first-spike`。承接位置：后续客户端专项 + agent-core kernel 错误路径专项。 | 无修改 |
| R4-GLM | P4-05 ESLint 未落地 | `fixed`（见 R4-GPT-4） | 已用 `scripts/check-observability-drift.mjs` 等价 guard 覆盖。 | 同上 |
| R6-GLM | error-codes.md 声称 78 codes 但实际 unique 77 | `fixed` | 文件头统一更新为"94 unique codes (95 raw, 1 deduped: NACP_REPLAY_OUT_OF_RANGE)"，反映本轮新增 17 facade ad-hoc 后的事实数。 | `docs/api/error-codes.md` |
| R8-GLM | nano_audit_log.event_kind 无 CHECK 约束 vs 设计 8 类 | `rejected`（保留开放性） | 实际已扩展到 9 类（`session.start.failed`），DDL 的开放扩展性是有意的设计选择。设计文档清单可在后续 RHX2 closure follow-up 中更新；不发起新 migration（migration 编号已冻结，不为文档修订重新打编号）。 | 无 schema 修改 |
| R9-GLM | `NACP_VERSION` (protocol 1.4.0) vs `package.json` (npm 1.6.0) 命名混淆 | `deferred-with-rationale` | 两者语义不同（wire protocol vs npm release），均有清晰命名（`NACP_VERSION` vs `version`），README 后续可补 disambiguation 段，但不影响代码正确性，本轮不修。 | 无修改 |
| R10-GLM | 跨阶段：permission/elicitation/usage WS round-trip e2e 缺失 | `deferred-with-rationale` | 跨 RH1→RH6→RHX1→RHX2 多阶段已 deferred；不在 RHX2 范围内；承接位置：hero-to-platform / 独立 e2e 专项。 | 无修改 |
| R11-GLM | 跨阶段：Lane E consumer sunset 未启动 | `deferred-with-rationale` | 同上，跨阶段 deferred；charter §4.4 硬纪律 #6 由 owner 判断 sunset 时间盒。 | 无修改 |
| R12-GLM | 跨阶段：`/me/sessions GET` next_cursor 始终 null | `deferred-with-rationale` | 同上，hero-to-platform 范围。 | 无修改 |
| R3-KIMI | wechat-miniprogram 未适配 + "至少一端 client"边界 | `deferred-with-rationale` | 同 R6-GPT-6；closure 已 deferred 到独立客户端专项。 | 无修改 |
| R4-KIMI | cron trigger wrangler dashboard 验证证据 | `deferred-with-rationale` | 代码与配置已就绪；wrangler dashboard 截图属 deploy 验证清单（closure §5 已列），需 owner deploy 后人工补。 | 无修改 |
| R5-KIMI | 6 worker predeploy hook 未挂载 verify script | `verified`（已挂载，无需修改） | 现场 grep 验证：6 worker 的 `package.json` 均含 `"predeploy": "node ../../scripts/verify-published-packages.mjs"`；orchestrator-core 同时含 `predeploy:preview` 和 `deploy:preview`/`deploy:production` 显式调用 predeploy。 | 无修改 |
| R6-KIMI | closure 缺 unit + e2e 测试矩阵汇总表 | `deferred-with-rationale` | closure 已列 11 条验证命令；测试矩阵汇总表更新属 closure-wording 修订；本轮 review-of-reviews 实测 2598 个用例全绿（见 §7.5）。 | 无修改 |
| R7-KIMI | error-index.md vs error-codes.md 重复维护风险 | `partially-fixed` | error-index.md 头部已加入 `long-form catalog (94 unique codes): docs/api/error-codes.md` SSOT 引用；同步声明本文件为 "RHX2 Phase 7-9 Snapshot"。 | `clients/api-docs/error-index.md` |
| R8-KIMI | closure 未提及 v0.draft-r3 carry-over 纠正 | `deferred-with-rationale` | 历史记录在 action-plan §0-prefix-v0.draft-r3 + §10.3；closure 简洁体现要点已足；owner 已通过 `closed-as-web-first-spike`。 | 无修改 |

### 7.3 Blocker / Follow-up 状态汇总

| 分类 | 数量 | 编号 | 说明 |
|------|------|------|------|
| 已完全修复 | 8 | R1-GLM、R2-DEEPSEEK/R3-GLM（合并）、R3-GPT-3/R7-GLM-7/R7-KIMI-7（合并）、R4-GPT-4/R4-GLM-4/R2-KIMI-2（合并）、R5-GPT-5、R3-DEEPSEEK、R5-DEEPSEEK、R7-DEEPSEEK、R6-GLM | 见 §7.4 变更文件清单与 §7.5 验证 |
| 部分修复 | 1 | R7-KIMI | error-index.md 已加 SSOT 引用；后续若再次拆分需新一轮同步 |
| 拒绝 / stale-rejected | 2 | R1-DEEPSEEK、R8-GLM | 设计上有意保留（注释/文档已说明） |
| 已验证无需修改 | 1 | R5-KIMI | predeploy hook 实际已存在 |
| 有理由 deferred | 13 | R1-GPT-1、R2-GPT-2、R6-GPT-6/R5-GLM-5、R4-DEEPSEEK/R1-KIMI、R6-DEEPSEEK、R2-GLM/R13-GLM、R9-GLM、R10-GLM、R11-GLM、R12-GLM、R3-KIMI、R4-KIMI、R6-KIMI、R8-KIMI | 大多落在客户端专项 / hero-to-platform / closure-wording follow-up；不在 RHX2 spike closure 范围内 |
| 仍 blocked | 0 | — | — |

### 7.4 变更文件清单

- `workers/orchestrator-core/wrangler.jsonc` — R1-GLM critical: 顶层 vars `NANO_ENABLE_RHX2_SPIKE=false`，preview env 保留 true。
- `packages/nacp-core/src/error-registry.ts` — R2-DEEPSEEK/R3-GLM: 新增 17 个 facade ad-hoc 条目；R5-DEEPSEEK: 新增 `_crossSourceDuplicates` 跟踪与 `listCrossSourceDuplicateCodes()` 导出。
- `packages/nacp-core/src/observability/logger/system-error.ts` — R5-GPT-5: dual emit fallback notify 包入独立 try/catch。
- `packages/nacp-core/src/observability/logger/audit.ts` — R3-DEEPSEEK: `recordAuditEvent` 改 `async` + 加 `onPersistError` reporter 选项。
- `packages/nacp-core/test/error-codes-coverage.test.ts` — R5-DEEPSEEK: 新增跨 source 重复检测测试；sanity floor 75→90。
- `docs/api/error-codes.md` — R2-DEEPSEEK/R3-GLM: §8 拆 8.1+8.2，新增 17 facade ad-hoc 行；R6-GLM: 头部计数更新到 94 unique。
- `clients/api-docs/error-index.md` — R3-GPT-3/R7-GLM-7/R7-KIMI-7: 升级 Phase 7-9 + Kernel/Session/LLM 表 + Phase 7-9 wire facts；R7-KIMI: SSOT 引用。
- `clients/api-docs/session-ws-v1.md` — R3-GPT-3: 升级标题 + system.notify 字段扩展 + dual-emit window 段 + synthetic spike trigger 段。
- `clients/api-docs/worker-health.md` — R3-GPT-3 + R7-DEEPSEEK: 升级标题 + drift_direction 字段 + 取值表。
- `workers/orchestrator-core/src/debug/packages.ts` — R7-DEEPSEEK: 新增 `drift_direction` 字段 + `compareSemver()` helper。
- `workers/orchestrator-auth/src/index.ts` — R3-DEEPSEEK: `buildAuditPersist` wrapper + `emitObservabilityAlert("audit-persist-failed")`。
- `workers/orchestrator-auth/src/service.ts` — R3-DEEPSEEK: `emitAudit` 后追加 `.catch(() => {})`，防 unhandled rejection。
- `scripts/check-observability-drift.mjs`（新增）— R4-GPT-4/R4-GLM-4/R2-KIMI-2: 6 worker `src/` 裸 console + 跨 worker import drift guard。
- `package.json` — 新增 `check:observability-drift` script。

### 7.5 验证结果

> 仅与本轮 finding 直接相关的命令输出。

| 验证项 | 命令 / 证据 | 结果 | 覆盖的 finding |
|--------|-------------|------|----------------|
| nacp-core 全量测试 | `pnpm --filter @haimang/nacp-core test` | `pass`（337 tests，含新 cross-source duplicate test） | R2-DEEPSEEK/R3-GLM、R5-DEEPSEEK、R5-GPT-5 |
| nacp-session 全量测试 | `pnpm --filter @haimang/nacp-session test` | `pass`（153 tests） | regression check |
| orchestrator-core 测试 | `pnpm --filter @haimang/orchestrator-core-worker test` | `pass`（170 tests） | R7-DEEPSEEK + 上游回归 |
| orchestrator-core 类型检查 | `pnpm --filter @haimang/orchestrator-core-worker typecheck` | `pass` | R7-DEEPSEEK 编译正确性 |
| orchestrator-auth 测试 | `pnpm --filter @haimang/orchestrator-auth-worker test` | `pass`（21 tests，包括 audit emit 路径） | R3-DEEPSEEK |
| orchestrator-auth 类型检查 | `pnpm --filter @haimang/orchestrator-auth-worker typecheck` | `pass` | R3-DEEPSEEK |
| agent-core 测试 | `pnpm --filter @haimang/agent-core-worker test` | `pass`（1069 tests） | regression check |
| bash-core 测试 | `pnpm --filter @haimang/bash-core-worker test` | `pass`（376 tests） | regression check |
| context-core 测试 | `pnpm --filter @haimang/context-core-worker test` | `pass`（172 tests） | regression check |
| filesystem-core 测试 | `pnpm --filter @haimang/filesystem-core-worker test` | `pass`（300 tests） | regression check |
| drift guard | `node scripts/check-observability-drift.mjs` | `pass`（"clean (scanned 6 workers; no bare console, no cross-worker imports)"） | R4-GPT-4/R4-GLM-4/R2-KIMI-2 |

```text
Total: 26+15+19+4+101+30+26+19 = 240 test files, 2598 tests passing, 0 failures.
nacp-core: 337 / nacp-session: 153 / orchestrator-core: 170 / orchestrator-auth: 21
agent-core: 1069 / bash-core: 376 / context-core: 172 / filesystem-core: 300
```

### 7.6 未解决事项与承接

| 编号 | 状态 | 不在本轮完成的原因 | 承接位置 |
|------|------|--------------------|----------|
| R1-GPT-1 | deferred | registry tarball 字节级校验需可信镜像策略 + GitHub Packages tarball 命名 stable | 后续 deploy hardening 阶段 |
| R2-GPT-2 | deferred | action-plan §7.4/§8.2 旧 DoD 由 closure 权威 supersede | RHX2 closure 已有 §1/§5/§7 supersedes 段 |
| R6-GPT-6 / R5-GLM-5 / R3-KIMI | deferred | owner 已批 web-first spike，wechat 完整适配后置 | 独立客户端适配专项 |
| R2-GLM / R13-GLM | deferred | agent-core → orchestrator-core frame forward 协议需新一轮设计 | 客户端专项 + agent-core kernel 错误路径专项 |
| R10/R11/R12-GLM | deferred | 跨阶段历史 carry-over | hero-to-platform 阶段 |
| R4-DEEPSEEK / R1-KIMI / R6-KIMI / R8-KIMI / R6-DEEPSEEK | deferred | closure-wording 修订属阶段 follow-up | 后续 closure-only diff |
| R4-KIMI | deferred | cron dashboard 截图需要 deploy 后人工补 | deploy 验证清单（closure §5 已列） |
| R8-GLM | rejected | 开放扩展性是有意设计 | 设计文档可在后续 closure follow-up 中更新 |
| R1-DEEPSEEK | rejected | 1:1 对齐 source 不重复登记是设计决策 | error-registry.ts 注释已说明 |
| R9-GLM | deferred | 命名歧义可在 README 补 disambiguation | nacp-core README follow-up |

### 7.7 Ready-for-rereview gate

- **是否请求二次审查**：`yes`
- **请求复核的范围**：本轮已修代码项（R1-GLM、R2-DEEPSEEK/R3-GLM、R5-GPT-5、R3-DEEPSEEK、R5-DEEPSEEK、R7-DEEPSEEK、R3-GPT-3/R7-GLM-7/R7-KIMI-7、R4-GPT-4/R4-GLM-4/R2-KIMI-2、R6-GLM）；deferred 项不需要二次复核，由后续阶段承接。
- **实现者认为可以关闭的前提**：
  1. 二次 reviewer 确认本轮 8 个完全修复项落地正确（建议同 reviewer 复核而非新 reviewer）。
  2. owner 接受将剩余 13 个 deferred 项落到 hero-to-platform / 客户端专项 / closure follow-up 这三个承接位置。
  3. 不在本轮 reopen `closed-as-web-first-spike` 收口口径。
