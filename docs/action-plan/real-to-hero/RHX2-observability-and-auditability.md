# Nano-Agent 行动计划 — RHX2 Observability & Auditability

> 服务业务簇: `real-to-hero / RHX2 — 日志、报错、审计、可观测性强化簇`
> 计划对象: `把 NACP 协议预留的 log / error / audit / observability 槽位从 schema-only 推进到 runtime-wired，并端到端闭环到 web + 微信小程序两端 client`
> 类型: `new + modify`（共享包新增 + 6 worker codemod + 3 worker wrangler binding 新增 + 2 端 client 改造 + migration 006 新增）
> 作者: `Owner + Opus 4.7 (1M)`
> 时间: `2026-04-29`
> 文件位置:
> - 新建：`workers/orchestrator-core/migrations/006-error-and-audit-log.sql`、`docs/api/error-codes.md`、`packages/nacp-core/src/observability/logger/`（新子模块）、`packages/nacp-core/src/error-registry-client/`（新子模块）
> - 修改：6 worker `src/` + 3 worker `wrangler.jsonc`、`packages/nacp-core/{package.json, src/error-registry.ts, src/index.ts}`（minor bump 1.4.0 → 1.6.0；exports map 增 `./logger` + `./error-codes-client`）、`packages/nacp-session/src/stream-event.ts`、`workers/orchestrator-core/src/{index,user-do/*,policy/authority}.ts`、`clients/web/src/{apis/transport.ts, pages/ChatPage.tsx}`、`clients/wechat-miniprogram/{utils/nano-client.js, pages/session/index.js, build-script}`
> - **不新建独立包**：v0.draft-r2 修订后所有 helper 落在 `packages/nacp-core/src/observability/logger/` 与 `packages/nacp-core/src/error-registry-client/` 子目录
> 上游前序 / closure:
> - `docs/issue/real-to-hero/RH4-closure.md`（filesystem R2 闭合）
> - RHX1 DDL SSOT（migration baseline = `001-005`）
> 下游交接:
> - `docs/issue/real-to-hero/RHX2-closure.md`（执行后产出）
> - 解锁 RH5 / RH6 主线（横切簇可与 RH5 并行）
> 关联设计 / 调研文档:
> - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` v0.3 (`frozen`)
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-opus.md`
> - `docs/eval/real-to-hero/audit-and-reporting-study-by-deepseek.md`
> - `docs/design/real-to-hero/RHX2-observability-and-auditability-reviewed-by-{deepseek,GLM,GPT}.md`
> 冻结决策来源:
> - `docs/design/real-to-hero/RHX-qna.md` Q-Obs1 ~ Q-Obs12（全部 owner-answered；只读引用，本 action-plan 不开新 Q/A）
> 文档状态: `draft-r3`（v0.5 design 同步：owner 否决 v0.4 中"jwt-shared 未发布 = RHX3 carry-over"的判断——这是 critical 门禁认知错误；本 action-plan v0.draft-r3 把 jwt-shared@0.1.0 首发 + 包来源单一真相门禁 + `/debug/packages` 验证接口提升为本簇 first-wave 必做项）

---

## 0-prefix-v0.draft-r3. v0.draft-r3 修订说明（2026-04-29；critical 门禁纠正）

> Owner 在 v0.draft-r2 review 中否决了"jwt-shared 未发布 = RHX3 carry-over"的判断："**这是 critical error，是我们的门禁不对**——在 jwt-shared 没有发布到 GitHub Packages 就宣告阶段完成，造成事实认知不清；不属于可以 carry over 的 critical 门禁认知错误。我们仅能依靠一个唯一真相：要么是线上 package，要么是本库内 package；不能存在任何模糊空间。"
>
> 同时 owner 要求："提供新的接口，让前端可以验证 3 个 GitHub Packages 包的发布状态、发布在线上的版本、发布的时间——用于在出现问题时可以得到真相。这也属于本阶段可观测性的一部分。"
>
> v0.draft-r3 的纠正：

| v0.draft-r2 处置 | v0.draft-r3 处置 | 理由 |
|---|---|---|
| §10 RHX3 carry-over：jwt-shared 由 RHX3 在三选一中决定 | **§10 删除 carry-over 框架；jwt-shared@0.1.0 首发列为 RHX2 first-wave 必做（P1-07）** | owner：carry-over 本身就是错误判断 |
| 没有包发布门禁 | **新增 P1-08 CI gate 脚本 `verify-published-packages.mjs`**：每次 deploy 前验证 3 个 published 包 workspace ≡ registry version + dist SHA256 一致 | owner：deploy 进 worker 的代码究竟是从线上还是本地来的不能模糊 |
| 没有 `/debug/packages` endpoint | **新增 P6-04 `/debug/packages` endpoint**：返回 inline `built-package-manifest` + 实时 GitHub Packages 查询 + drift 标记 | owner：故障时前端 / owner 一次 GET 得到真相 |
| 闭包标准没有包门禁项 | **§8.2 新增 closure 标准 #9/#10**：jwt-shared 已 publish + CI gate 通过 + `/debug/packages` 在 preview 验过 | RHX2 closure 必须显示门禁通过证据 |

**对应 design v0.5 的：S14 + S15 / F14 + F15 / 取舍 10 / Q-Obs13 + Q-Obs14。**

---

## 0-prefix. v0.draft-r2 修订说明（2026-04-29；保留作为修订历史；其中 §10 RHX3 carry-over 已被 v0.draft-r3 撤销）

> Owner 反馈：项目长期策略是 **只保留 3 个发布到 GitHub Packages 的共享包**（`@haimang/nacp-core` / `@haimang/nacp-session` / `@haimang/jwt-shared`），其余 4 个 workspace-only 包（`eval-observability` / `orchestrator-auth-contract` / `storage-topology` / `workspace-context-artifacts`）应该逐步退役。本 action-plan v1 提出新建 `packages/worker-logger/` + `packages/error-codes-client/` 与该策略冲突，必须修订。

### 修订一：撤销新建包，改为扩展 `@haimang/nacp-core`

| v1 设想 | v0.draft-r2 替代 | 理由 |
|---|---|---|
| 新建 `packages/worker-logger/` | 扩展 `@haimang/nacp-core` 新增 `observability/logger` 子模块 + `nacp-core/logger` 子路径导出 | worker-logger 唯一允许的依赖本就是 `nacp-core` 的 `NacpErrorSchema` + `NacpObservabilityEnvelope` schemas（v0.3 设计 §3.3 解耦对象 1）；逻辑上属于 `nacp-core` 的 observability 命名空间扩展 |
| 新建 `packages/error-codes-client/` | 扩展 `@haimang/nacp-core` 新增 `error-registry-client` 子模块 + `nacp-core/error-codes-client` 子路径导出（**纯类型 + 数据，零 runtime 依赖**） | client 出口的数据来源就是 `nacp-core` 的 `listErrorMetas()`；让它独立成包是无谓的拆分 |
| 微信小程序 build 时拷贝 `error-codes-client.json` | 微信小程序 build 时从 `node_modules/@haimang/nacp-core/dist/error-registry-client.js` 反射生成 JSON 拷贝到 `clients/wechat-miniprogram/utils/error-codes-client.json` | 拷贝目标变了，但行为等价 |

**关键约束**：`@haimang/nacp-core/logger` 子路径导出必须 **不引入任何 worker / Cloudflare runtime 依赖**——`AsyncLocalStorage` 由 caller 在 fetch handler 顶层 `withTraceContext()` 包装时注入；`createLogger()` 内部在 `als.ts` 中 `import { AsyncLocalStorage } from 'node:async_hooks'`（Cloudflare Workers 与 Node 都原生支持，无需额外依赖）。同样，`@haimang/nacp-core/error-codes-client` 子路径必须 **零 runtime 依赖**（仅 `data.ts` 静态对象 + 类型定义），让浏览器 / 微信小程序 / Node 三 runtime 都可 import。

### 修订二：登记 `jwt-shared` 未发布的 carry-over

`@haimang/jwt-shared` 在 `package.json` 声明了 `publishConfig.registry = https://npm.pkg.github.com`，但实际 GitHub Packages **HTTP 404**（从未发布）。当前所有 consumer（`workers/orchestrator-core/package.json` + `workers/orchestrator-auth/package.json`）通过 `"@haimang/jwt-shared": "workspace:*"` + `pnpm-workspace.yaml` 的 `packages/*` 声明 + `prebuild`/`pretest`/`pretypecheck` 三个 npm script hook 调用 `pnpm --filter @haimang/jwt-shared build` 让本地构建工作；wrangler deploy 阶段则把已编译的 dist 通过 esbuild bundle inline 到 worker，从不连 npm registry。

**结论**：
- 工作区内（本地 / preview / production）**不构成 critical error**——跟 GitHub Packages 层完全脱钩。
- 这是一个 **state-vs-intent gap**：jwt-shared `publishConfig` 的存在意味着曾经准备发布；任何一天有人把 consumer 从 `workspace:*` 改成 `^0.0.0`，install 立即 404。
- **不在本 action-plan 范围内修复**：本簇是 observability + auditability，不是包发布治理。登记到本文 §10 "RHX3 carry-over" 由 owner 在下一阶段统一处理。

### 修订涉及的 work item 编号变更

| v1 编号 | v0.draft-r2 处置 | 说明 |
|---|---|---|
| P1-01（新建 worker-logger） | **改为 P1-01 扩展 nacp-core observability/logger** | 详见 §4.1 |
| P1-02（新建 error-codes-client） | **改为 P1-02 扩展 nacp-core error-registry-client** | 详见 §4.1 |
| P3-01 / P5-04 / P5-06 等 helper 落地点 | 文件路径全部从 `packages/worker-logger/src/*` 改为 `packages/nacp-core/src/observability/*` 或 `packages/nacp-core/src/error-registry-client/*` | 见各 work item |
| P8-03 微信小程序 build script | 拷贝源由 `packages/error-codes-client/` 改为 `packages/nacp-core/dist/error-registry-client.json`（CI 时反射生成） | - |

### 影响范围

- `nacp-core` 版本号需要 minor bump（`1.4.0 → 1.6.0`）：因为新增 sub-path exports 是 additive；publish 到 GitHub Packages 是本 phase 的额外发布步骤（merged into P1-end）。
- `@haimang/error-codes-client` 名字 **不再使用**；client 端 import 路径变为 `import { getErrorMeta, classifyByStatus } from '@haimang/nacp-core/error-codes-client'`。
- `@haimang/worker-logger` 名字 **不再使用**；worker 端 import 路径变为 `import { createLogger, withTraceContext, ... } from '@haimang/nacp-core/logger'`。
- `pnpm-workspace.yaml` / `packages/` 目录 **不新增任何包**。

### 与 RHX2 设计 v0.3 的一致性

设计 v0.3 §3.3 解耦对象 1 已声明 worker-logger "仅依赖 `nacp-core`，不能依赖 nacp-session / orchestrator-auth-contract / 任何 worker"；§3.3 解耦对象 5 已声明 client-safe error meta "仅依赖纯 TypeScript 类型，不依赖 worker / Cloudflare runtime"。本修订把这两个解耦对象从"独立包"实现路径切到"`nacp-core` 子路径导出"实现路径，**功能边界与 v0.3 设计完全一致**；只是落地形态不同。设计 v0.3 同步打补丁到 v0.4 时会把"形态"从"独立包"改成"`nacp-core` 子路径"。

---

---

## 0. 执行背景与目标

> RHX2 设计 v0.3 已 `frozen`：F1–F13 共 13 项 first-wave 工作；Q-Obs1–Q-Obs12 全部 owner-answered。本 action-plan 是把这些设计结论落成可交付物的执行单。
>
> 三方独立审查（DeepSeek / GLM / GPT）一致认为方向成立、主体可执行；GPT 的 R1/R2 blocker 已通过 F12（client-safe error meta）+ F13（client `system.error` 消费 + 双发降级窗口）解除，并对应 Q-Obs10/11 owner-answered。
>
> **本 action-plan 不重新讨论设计**：所有"为什么这样选"已在 design v0.3 §6.1 取舍 1–9 中冻结；本文档只回答"按什么顺序、改哪些文件、跑什么测试、什么算结束"。

- **服务业务簇**：`real-to-hero / RHX2 横切簇`
- **计划对象**：6-worker + nacp 协议骨架 + 2 端 client 的端到端可观测性接电
- **本次计划解决的问题**：
  - 6 worker 的 32 行 `console.warn` 半结构化、orchestrator-auth/bash-core 0 console、错误 schema 三套不齐、错误码 80+ 散落 7 套枚举、`x-trace-uuid` 之外前端无任何可观测信号
  - NACP 已预留的 `system.error` / `audit.record` / `NacpObservabilityEnvelope.alerts` / `NacpErrorCategorySchema` 7 类、evidence 四流均处于 schema-only / 0 emit 状态
  - 三套 durable 真相（`nano_session_activity_logs` / `nano_error_log` / `nano_audit_log`）的职责边界 + 索引引用规则需要在 first-wave 落地，否则未来排障"信息太散"
  - web `transport.ts` + 微信小程序 `nano-client.js` 各自手搓 4 类错误分类；`ChatPage.tsx` + `session/index.js` 都不消费 `system.error` —— server 单边接电不会变成端到端可用能力
- **本次计划的直接产出**：
  - 扩展 `@haimang/nacp-core` 新增两个子路径导出：`@haimang/nacp-core/logger`（含 ALS / ring buffer / `LogPersistFn` / `AuditPersistFn`）+ `@haimang/nacp-core/error-codes-client`（含 `getErrorMeta` / `classifyByStatus` / 8 类 ClientErrorCategory）；nacp-core minor bump 1.4.0 → 1.6.0 + 重发到 GitHub Packages
  - migration `006-error-and-audit-log.sql`（含 `nano_error_log` 14d + `nano_audit_log` 90d 双表 + 索引 + cron trigger 清理）
  - 6 worker HTTP 错误响应统一到 `FacadeErrorEnvelope`（F2 / `respondWithFacadeError()`）
  - WS `system.error` stream-event kind 接电 + 服务端 4 周双发降级窗口（F7 / F13）
  - `/debug/logs` + `/debug/recent-errors` + `/debug/audit` 三个调试 endpoint（team gate / owner gate）
  - `Server-Timing` 头注入（仅 orchestrator-core HTTP facade 出口）
  - bash-core / orchestrator-auth 终结 0 console 状态；bash-core 7 ad-hoc codes 进入 `docs/api/error-codes.md` 第 8 段
  - web `transport.ts` + 微信小程序 `nano-client.js` 切到 `getErrorMeta()`；`ChatPage.tsx` + `session/index.js` 新增 `case 'system.error'` 分支
  - bash-core / context-core / filesystem-core wrangler.jsonc 新增 `ORCHESTRATOR_CORE` service binding（preview + production 各 2 env）
- **本计划不重新讨论的设计结论**：
  - 单写点 = orchestrator-core（来源：Q-Obs1）
  - migration 编号 = `006-error-and-audit-log.sql`（来源：Q-Obs2）
  - retention：error 14d / audit 90d（来源：Q-Obs3）
  - 新增 `system.error` kind，与 `system.notify` 平行（来源：Q-Obs4）
  - `/debug/logs` team-only / `/debug/audit` owner-only（来源：Q-Obs5）
  - first-wave audit 8 类 event_kind（来源：Q-Obs6）
  - F2 × F7 同 trace_uuid 强一致；code 允许不同源（来源：Q-Obs7）
  - TTL 清理用 Cloudflare cron trigger（来源：Q-Obs8）
  - bash-core 7 ad-hoc codes first-wave 不归化为 zod enum（来源：Q-Obs9）
  - Client meta 形态 = 候选 a 共享 npm 包；**v0.draft-r2 修订**：实装为 `@haimang/nacp-core/error-codes-client` 子路径导出（不新建独立包），微信小程序 build 时反射生成 JSON 拷贝（来源：Q-Obs10 + 包退役策略）
  - `system.error` 双发降级窗口默认 4 周（≥14 天观察期 + 至少一端 client 发布消费 PR）（来源：Q-Obs11）
  - 三套 durable 真相 4 条索引引用规则 first-wave 强制（来源：Q-Obs12）

---

## 1. 执行综述

### 1.1 总体执行方式

本 action-plan 采用 **"先底层后上层 + 先协议后实现 + 先 server 双发后 client 切换"** 三段式：(1) Phase 1–3 把"共享包 + DDL + registry + service binding"四个底层设施先落地；(2) Phase 4–6 把"server 端 logger / facade envelope / system.error / audit / observability alert / Server-Timing"逐层向上接电；(3) Phase 7–9 把"client 端消费 + 双发降级窗口 + closure"端到端闭环。每个 Phase 独立可测、独立可回滚；只在 Phase 间保留有限依赖。

### 1.2 Phase 总览

| Phase | 名称 | 规模 | 目标摘要 | 依赖前序 |
|---|---|---|---|---|
| Phase 1 | nacp-core 子路径扩展 + DDL + service binding + **包门禁建立**（v0.draft-r3） | L | 在 `@haimang/nacp-core` 内新增 `logger` + `error-codes-client` 两个子路径模块 + migration 006 + 3 worker wrangler binding；**jwt-shared@0.1.0 首发 + nacp-core@1.6.0 重发 + CI gate 脚本 `verify-published-packages.mjs` 落地** | - |
| Phase 2 | 错误 registry + docs | S | 扩展 `nacp-core/error-registry.ts` 暴露 `resolveErrorMeta()`；写 `docs/api/error-codes.md`；CI 一致性测试 | Phase 1 |
| Phase 3 | facade envelope 收口 + Server-Timing | M | 6 worker HTTP 错误统一；orchestrator-core 出口注入 `Server-Timing` | Phase 1, 2 |
| Phase 4 | bash-core / orchestrator-auth 接 logger + 6 worker 切结构化日志 | M | 终结 0 console；bash-core 7 ad-hoc codes 进 docs 第 8 段 | Phase 1, 2 |
| Phase 5 | system.error stream kind + audit.record 落地 + observability alert | M | F7 + F11 + F8 落地；F2×F7 交叉规则；F11 8 类 event_kind 各 ≥1 写路径 | Phase 1, 3 |
| Phase 6 | 调试 endpoint + cron 清理 + **`/debug/packages`**（v0.draft-r3） | M | `/debug/logs` + `/debug/recent-errors` + `/debug/audit` + **`/debug/packages` (F15)** + cron trigger | Phase 1, 5 |
| Phase 7 | server 端启动双发降级窗口 | XS | F13 server 侧打开"`system.error` + `system.notify(severity=error)`"双发开关 | Phase 5 |
| Phase 8 | client 端消费改造（web + 微信小程序） | M | F12 切 `getErrorMeta()`；F13 加 `case 'system.error'` 分支 | Phase 1, 5, 7 |
| Phase 9 | 双发观察 + 切单发 + closure | S | 满足"≥14 天观察期 + 至少一端 client 发布"后切单发；写 RHX2-closure.md | Phase 7, 8 |

### 1.3 Phase 说明

1. **Phase 1 — nacp-core 子路径扩展 + DDL + service binding**
   - **核心目标**：把所有底层设施一次性铺好，避免后续 Phase 互相阻塞。
   - **为什么先做**：`nacp-core/logger` + `nacp-core/error-codes-client` 子模块 / migration 006 / 3 个 wrangler binding 是 Phase 2–9 的共同前置；如果分散到每个 Phase 各做一点，Phase 间会形成串行死锁。
   - **v0.draft-r2 形态**：不新建独立包；扩展现有 `@haimang/nacp-core`（已发布 1.4.0）新增两个子路径导出，并 minor bump 到 1.5.0 重发 GitHub Packages。
2. **Phase 2 — 错误 registry + docs**
   - **核心目标**：让 server `resolveErrorMeta()` + client `getErrorMeta()` + `docs/api/error-codes.md` 三方一致。
   - **为什么放在这里**：Phase 3 的 `respondWithFacadeError()` 需要 registry 已就绪；Phase 8 的 client 改造需要 `error-codes-client` 包的真实数据。
3. **Phase 3 — facade envelope 收口 + Server-Timing**
   - **核心目标**：6 worker HTTP 错误响应 schema 统一。
   - **为什么放在这里**：F2 是前端今天就在等的"统一 envelope"；做完 Phase 3 后，前端在 HTTP 路径已可单一 parser。
4. **Phase 4 — bash-core / orchestrator-auth 接 logger + 6 worker 切结构化日志**
   - **核心目标**：终结 0 console / 32 行半结构化的现状，全切到 `worker-logger`。
   - **为什么放在这里**：worker-logger 包已就绪（Phase 1），registry 已就绪（Phase 2），可以批量 codemod。
5. **Phase 5 — system.error / audit.record / observability alert 接电**
   - **核心目标**：让 NACP 协议的 3 个核心观测留位首次进入 prod 路径。
   - **为什么放在这里**：依赖 worker-logger 已可被 6 worker import；F7 emit 需要 facade error 路径已收口（Phase 3）。
6. **Phase 6 — 调试 endpoint + cron 清理**
   - **核心目标**：让 D1 双表 "可写又可读" 形成完整闭环。
   - **为什么放在这里**：Phase 5 写入路径成熟后，开调试入口 + 配 cron 清理。
7. **Phase 7 — server 端启动双发降级窗口**
   - **核心目标**：在 client 改造未完成前，先让 server 双发 `system.error + system.notify(severity=error)`，老 client 不破坏。
   - **为什么放在这里**：必须在 Phase 8 client 发布前打开双发窗口；否则 client 切到新 case 时 server 还没在发，UX 会出现盲区。
8. **Phase 8 — client 端消费改造（web + 微信小程序）**
   - **核心目标**：F12 + F13 的 client 侧 PR 落地。
   - **为什么放在这里**：依赖 Phase 1 的 `error-codes-client` 包 + Phase 7 的 server 双发已开。
9. **Phase 9 — 双发观察 + 切单发 + closure**
   - **核心目标**：满足 Q-Obs11 准入条件（≥14 天观察 + 至少一端 client 发布）后切单发；写 closure 关闭本簇。
   - **为什么放在这里**：双发窗口必须有真实运行时间观察；不允许提前切单发。

### 1.4 执行策略说明

- **执行顺序原则**：底层 → 协议 → server 接电 → client 切换 → 闭环；Phase 1–6 可严格串行，Phase 7–9 是 server / client / 时间三方协同。
- **风险控制原则**：每个 Phase 落 preview + 至少 5 个 unit case + 1 个 e2e 后才进下一个；F4/F11 写入路径单点风险用 fallback console + `rpc_log_failed:true` 标记控制；F13 双发窗口由 Q-Obs11 准入条件硬约束。
- **测试推进原则**：≥86 unit cases + ≥10 live e2e 总目标分摊到 Phase；每个 Phase 收口前必须 4-worker package test + cross-e2e 全绿。
- **文档同步原则**：Phase 2 写 `docs/api/error-codes.md`；Phase 9 closure 写 `docs/issue/real-to-hero/RHX2-closure.md`；不在中途产出非交付文档。
- **回滚 / 降级原则**：每个 Phase 的 PR 单独可回滚；migration 006 一旦 apply 无法回滚（D1 限制），但可通过 `DROP TABLE` + 重 apply 修；F13 双发窗口可随时延长（不可缩短）。

### 1.5 本次 action-plan 影响结构图

```text
RHX2 Observability & Auditability
├── Phase 1: nacp-core 子路径扩展 + DDL + service binding
│   ├── packages/nacp-core/src/observability/logger/  [new sub-module; exposed via `nacp-core/logger`]
│   ├── packages/nacp-core/src/error-registry-client/  [new sub-module; exposed via `nacp-core/error-codes-client`]
│   ├── packages/nacp-core/package.json  [version 1.4.0 → 1.6.0 + new exports map entries]
│   ├── workers/orchestrator-core/migrations/006-error-and-audit-log.sql  [new]
│   └── workers/{bash-core,context-core,filesystem-core}/wrangler.jsonc  [+ ORCHESTRATOR_CORE binding ×2 env]
├── Phase 2: 错误 registry + docs
│   ├── packages/nacp-core/src/error-registry.ts  [+ resolveErrorMeta + listErrorMetas]
│   ├── docs/api/error-codes.md  [new; 80+ codes 7 段 + 第 8 段 ad-hoc]
│   └── packages/nacp-core/test/error-codes-coverage.test.ts  [new; CI 一致性]
├── Phase 3: facade envelope 收口 + Server-Timing
│   ├── packages/nacp-core/src/observability/respond.ts  [respondWithFacadeError; exposed via nacp-core/logger]
│   ├── workers/{6 workers}/src/index.ts  [HTTP catch 路径切 respondWithFacadeError]
│   └── workers/orchestrator-core/src/policy/authority.ts  [+ attachServerTimings]
├── Phase 4: 6 worker 切结构化日志
│   ├── workers/orchestrator-core/src/  [24 console.warn → logger.*]
│   ├── workers/{agent-core,context-core,filesystem-core}/src/  [8 console.* → logger.*]
│   ├── workers/bash-core/src/  [+ logger.error/warn ≥5 路径; 7 ad-hoc codes 进 docs]
│   ├── workers/orchestrator-auth/src/  [+ logger.error/warn ≥5 路径]
│   └── .eslintrc  [no-console + no-restricted-imports]
├── Phase 5: system.error + audit.record + observability alert
│   ├── packages/nacp-session/src/stream-event.ts  [+ SystemErrorEventBodySchema]
│   ├── workers/agent-core/src/host/runtime-mainline.ts  [tryEmitSystemError]
│   ├── workers/orchestrator-core/src/{user-do,index,policy/authority}.ts  [audit.record + system.error 写路径]
│   └── packages/nacp-core/src/observability/{audit,alerts}.ts  [recordAuditEvent + emitObservabilityAlert; exposed via nacp-core/logger]
├── Phase 6: 调试 endpoint + cron 清理
│   ├── workers/orchestrator-core/src/index.ts  [+ /debug/logs, /debug/recent-errors, /debug/audit]
│   └── workers/orchestrator-core/wrangler.jsonc  [+ triggers.crons]
├── Phase 7: server 双发降级窗口启动
│   └── workers/{orchestrator-core,agent-core}/src/  [emit system.error 时同时 emit system.notify(severity=error)]
├── Phase 8: client 消费改造
│   ├── clients/web/src/apis/transport.ts  [classifyError → @haimang/nacp-core/error-codes-client::getErrorMeta]
│   ├── clients/web/src/pages/ChatPage.tsx  [+ case 'system.error']
│   ├── clients/wechat-miniprogram/utils/nano-client.js  [classifyError → 引入 build-time 拷贝的 error-codes-client.json]
│   ├── clients/wechat-miniprogram/pages/session/index.js  [+ case 'system.error']
│   └── clients/wechat-miniprogram/build-script  [+ 从 node_modules/@haimang/nacp-core/dist 反射拷贝 error-codes-client.json]
└── Phase 9: 双发观察 + 切单发 + closure
    ├── server side  [关闭 system.notify(severity=error) 双发]
    └── docs/issue/real-to-hero/RHX2-closure.md  [new]
```

---

## 2. In-Scope / Out-of-Scope

### 2.1 In-Scope（本次 action-plan 明确要做）

- **[S1]** F1：扩展 `@haimang/nacp-core` 新增 `nacp-core/logger` 子路径导出（4 级 + critical / ALS / 内存环形 / `LogPersistFn` + `AuditPersistFn` 类型 / DO/Worker-Shell 双模 / JSON schema 校验）；nacp-core minor bump 1.4.0 → 1.6.0 + 重发 GitHub Packages
- **[S2]** F2：6 worker HTTP 错误响应统一到 `FacadeErrorEnvelope`
- **[S3]** F3：runtime `resolveErrorMeta()` registry + `docs/api/error-codes.md` + CI 一致性
- **[S4]** F4：D1 `nano_error_log` 表 + 持久化 + fallback + cron 清理
- **[S5]** F5：`/debug/logs` + `/debug/recent-errors` 调试 endpoint（team gate）
- **[S6]** F6：`Server-Timing` 头（仅 orchestrator-core HTTP facade 出口）
- **[S7]** F7：`session.stream.event::system.error` kind + `SystemErrorEventBodySchema`
- **[S8]** F8：`emitObservabilityAlert()` critical alert（3 类触发；空 metrics/traces 不序列化）
- **[S9]** F9：bash-core / orchestrator-auth 接 worker-logger + bash-core 7 ad-hoc codes 进 docs 第 8 段
- **[S10]** F10：ESLint 重复定义防漂移（`packages/` 优先于 `workers/`）
- **[S11]** F11：D1 `nano_audit_log` 表 + NACP `audit.record` 通道接电（8 类 event_kind）+ `/debug/audit`（owner gate）
- **[S12]** F12：扩展 `@haimang/nacp-core` 新增 `nacp-core/error-codes-client` 子路径导出（零 runtime 依赖；浏览器 / 微信小程序 / Node 三 runtime 可用）；web 直接 import；微信小程序 build 时反射拷贝 JSON
- **[S13]** F13：web/微信小程序 `case 'system.error'` 分支 + server 4 周双发降级窗口
- **[S14]** §3.6 三套 durable 真相 4 条索引引用规则的 server 端写入路径单测覆盖（来源：Q-Obs12）
- **[S15]** 3 worker `wrangler.jsonc` 新增 `ORCHESTRATOR_CORE` service binding（bash-core / context-core / filesystem-core × preview + production）

### 2.2 Out-of-Scope（本次 action-plan 明确不做）

- **[O1]** OTel SDK 完整接入（traces/logs/metrics 三通道）
- **[O2]** OTel span hierarchy（claude-code 风格 4 类 span 树）
- **[O3]** OTel histogram metrics 全量启用
- **[O4]** Hook handler 注册表全量接电（18 个 hook event）
- **[O5]** Evidence 业务持久化
- **[O6]** PII 自动脱敏框架
- **[O7]** 第三方 APM 直连
- **[O8]** session-replay
- **[O9]** user-level telemetry opt-out
- **[O10]** 重复定义代码合并（仅 ESLint 防漂移）
- **[O11]** Cloudflare Logpush 配置
- **[O12]** bash-core 7 ad-hoc codes 归化为 zod enum（来源：Q-Obs9）
- **[O13]** smind-admin error response 格式收敛（来源：DeepSeek S1，docs 附录登记）

### 2.3 边界判定表

| 项目 | 判定 | 理由 | 重评条件 |
|---|---|---|---|
| `agent-core` 内部 HTTP `http-controller.ts` 切 facade envelope | `in-scope (S2)` | RH3 已允许部分直连场景 | - |
| `system.notify` 与 `system.error` 长期并存 | `in-scope (S7)` | notify=业务通知；error=故障 | - |
| 错误持久化 team-level 视图 | `in-scope (S5)` | `/debug/logs` 必须按 team 边界 | - |
| `console.log("usage-commit", ...)` 切 `logger.info` | `in-scope (S9 派生)` | quota 业务事件不应走 dev-only | - |
| `/debug/logs` owner 全租户可见 | `out-of-scope` | Q-Obs5 已答复；用 wrangler tail | - |
| W3C `traceparent` 同步透传 | `defer` | 留 seam | RH6 后 |
| 删除 `StorageError` / `metric-names` 重复定义 | `out-of-scope (O10)` | 仅 ESLint 防漂移 | cleanup phase |
| F13 双发窗口 < 4 周 | `out-of-scope` | Q-Obs11 已锁 4 周 | 准入条件不满足时延长 |

---

## 3. 业务工作总表

| 编号 | 所属 Phase | 工作项 | 类型 | 涉及模块 / 文件 | 目标一句话 | 风险 |
|---|---|---|---|---|---|---|
| P1-01 | Phase 1 | 在 `@haimang/nacp-core` 新增 `observability/logger` 子模块 | add+update | `packages/nacp-core/src/observability/logger/{index.ts,logger.ts,als.ts,ring-buffer.ts,types.ts,respond.ts,dedupe.ts}` + `packages/nacp-core/package.json`（exports map 增加 `./logger`）+ 单测 | 4 级 logger + ALS + ring buffer + LogPersistFn 类型；通过 `@haimang/nacp-core/logger` 子路径导出 | medium |
| P1-02 | Phase 1 | 在 `@haimang/nacp-core` 新增 `error-registry-client` 子模块 | add+update | `packages/nacp-core/src/error-registry-client/{index.ts,types.ts,data.ts}` + `packages/nacp-core/package.json`（exports map 增加 `./error-codes-client`）+ 单测 | `getErrorMeta` + `classifyByStatus` + 8 类 ClientErrorCategory；零 runtime 依赖；浏览器 / 微信 / Node 三端可 import；通过 `@haimang/nacp-core/error-codes-client` 子路径导出 | low |
| P1-01b | Phase 1 | nacp-core minor bump + 重发 GitHub Packages | update | `packages/nacp-core/package.json`（1.4.0 → 1.6.0）+ `npm publish` | npm registry 上 nacp-core@1.6.0 可拉取；含两个新 sub-path | low |
| P1-07 | Phase 1 | **jwt-shared@0.1.0 首发到 GitHub Packages**（critical 门禁；v0.draft-r3） | update+publish | `packages/jwt-shared/package.json`（0.0.0 → 0.1.0）+ `pnpm --filter @haimang/jwt-shared run build` + `npm publish` | GitHub Packages HTTP 200；versions 列表含 `0.1.0` | medium |
| P1-08 | Phase 1 | **CI gate 脚本 `verify-published-packages.mjs`**（critical 门禁；v0.draft-r3） | add | `scripts/verify-published-packages.mjs` + 6 worker `package.json` 增 `predeploy` hook 调它 | 对 3 个 published 包验证 workspace==registry version + (optional) dist SHA256；失败 exit(1) 阻拦 deploy | medium |
| P1-09 | Phase 1 | **build-time `__NANO_PACKAGE_MANIFEST__` 注入**（v0.draft-r3） | add | 6 worker `wrangler.jsonc` 增 esbuild `--define` 或等价 `defines.json`；build 脚本生成 manifest JSON inline 进 bundle | 6 worker bundle 内 `__NANO_PACKAGE_MANIFEST__` 常量可被 runtime 读取（不通过文件系统） | low |
| P1-03 | Phase 1 | migration 006 DDL | add | `workers/orchestrator-core/migrations/006-error-and-audit-log.sql` | 双表 + 8 索引 + CHECK 约束 | medium |
| P1-04 | Phase 1 | bash-core wrangler.jsonc 新增 ORCHESTRATOR_CORE binding | update | `workers/bash-core/wrangler.jsonc` | preview + production 双 env | low |
| P1-05 | Phase 1 | context-core wrangler.jsonc 新增 ORCHESTRATOR_CORE binding | update | `workers/context-core/wrangler.jsonc` | 同上 | low |
| P1-06 | Phase 1 | filesystem-core wrangler.jsonc 新增 ORCHESTRATOR_CORE binding | update | `workers/filesystem-core/wrangler.jsonc` | 同上 | low |
| P2-01 | Phase 2 | 扩展 `nacp-core/error-registry.ts` | update | `packages/nacp-core/src/error-registry.ts` | `resolveErrorMeta` + `listErrorMetas` 80+ codes 全覆盖 | medium |
| P2-02 | Phase 2 | 写 `docs/api/error-codes.md` | add | `docs/api/error-codes.md` | 7 段 + 第 8 段 ad-hoc + smind-admin 差异附录 | low |
| P2-03 | Phase 2 | CI 一致性测试 | add | `packages/nacp-core/test/error-codes-coverage.test.ts` | docs ↔ registry ↔ client meta 三方一致 | low |
| P3-01 | Phase 3 | `respondWithFacadeError()` helper | add | `packages/nacp-core/src/observability/logger/respond.ts`（re-exported via `@haimang/nacp-core/logger`） | re-export `facadeError` + 自动 `logger.error` | low |
| P3-02 | Phase 3 | orchestrator-core HTTP catch 切 facade | update | `workers/orchestrator-core/src/index.ts` 多处 | 错误响应统一 envelope | medium |
| P3-03 | Phase 3 | agent-core / bash-core / context-core / filesystem-core HTTP catch 切 facade | update | 4 worker `src/index.ts` + 子模块 | 同上 | medium |
| P3-04 | Phase 3 | `attachServerTimings(response, timings)` | add | `workers/orchestrator-core/src/policy/authority.ts` | facade 出口注入 `Server-Timing` 三段 | low |
| P3-05 | Phase 3 | `Server-Timing` 在 facade 路由统一注入 | update | `workers/orchestrator-core/src/index.ts` | 5 个路由组采集 + 注入 | medium |
| P4-01 | Phase 4 | orchestrator-core 24 console → logger | refactor | `workers/orchestrator-core/src/{index,user-do/*,entrypoint}.ts` | 全部切 `logger.warn/error` | medium |
| P4-02 | Phase 4 | agent-core / context-core / filesystem-core 8 console → logger | refactor | 3 worker `src/` | 同上 | low |
| P4-03 | Phase 4 | bash-core 接 logger + 7 路径 logger.error/warn | update | `workers/bash-core/src/{executor,bridge}.ts` | 终结 0 console；ad-hoc codes 进 docs | medium |
| P4-04 | Phase 4 | orchestrator-auth 接 logger + 6 路径 logger.error/warn | update | `workers/orchestrator-auth/src/` | 同上 | medium |
| P4-05 | Phase 4 | ESLint no-console + no-restricted-imports | add | `.eslintrc` 或等价 config | CI 拦截裸 console + 重复定义跨 import | low |
| P5-01 | Phase 5 | `SystemErrorEventBodySchema` 新增 | add | `packages/nacp-session/src/stream-event.ts` | 与 `system.notify` 平行；复用 `NacpErrorSchema` | low |
| P5-02 | Phase 5 | agent-core kernel 错误 emit `system.error` | update | `workers/agent-core/src/host/runtime-mainline.ts` + 邻近错误归一点 | dedupe 三元组；F2×F7 trace_uuid 一致 | medium |
| P5-03 | Phase 5 | orchestrator-core facade error 同步 emit `system.error`（如有 attached WS） | update | `workers/orchestrator-core/src/policy/authority.ts` + `respondWithFacadeError` | F2×F7 交叉规则落地 | medium |
| P5-04 | Phase 5 | `recordAuditEvent()` helper | add | `packages/nacp-core/src/observability/logger/audit.ts`（re-exported via `@haimang/nacp-core/logger`） | 包装 NACP `AuditRecordBody` + 写 `nano_audit_log` | medium |
| P5-05 | Phase 5 | F11 8 类 event_kind 写路径 | update | `workers/orchestrator-{auth,core}/src/` + `workers/agent-core/src/hooks/audit.ts` | 8 类各 ≥1 写路径 + 单测 | high |
| P5-06 | Phase 5 | `emitObservabilityAlert()` + 3 类 critical 触发 | add | `packages/nacp-core/src/observability/logger/alerts.ts`（re-exported via `@haimang/nacp-core/logger`） + `workers/{orchestrator-core,filesystem-core,...}/src/` | 仅 critical；空 metrics/traces 不序列化 | medium |
| P5-07 | Phase 5 | §3.6 三套真相索引引用规则单测 | add | `packages/nacp-core/test/cross-table-rules.test.ts` | 4 条规则各覆盖 | medium |
| P6-01 | Phase 6 | `/debug/logs` + `/debug/recent-errors` 路由 | add | `workers/orchestrator-core/src/index.ts` | team gate；trace_uuid/session_uuid 查 | medium |
| P6-02 | Phase 6 | `/debug/audit` 路由（owner gate） | add | `workers/orchestrator-core/src/index.ts` | 仅 owner；按 event_kind/team_uuid 查 | medium |
| P6-03 | Phase 6 | cron trigger 配置 + 清理 worker 脚本 | add | `workers/orchestrator-core/wrangler.jsonc` + `src/cron/cleanup.ts` | 每天 03:00 UTC 跑 TTL DELETE | low |
| P6-04 | Phase 6 | **`/debug/packages` endpoint（F15；critical 可观测性）**（v0.draft-r3） | add | `workers/orchestrator-core/src/index.ts` + `src/debug/packages.ts` | team gate；返回 `{deployed: 来自 __NANO_PACKAGE_MANIFEST__, registry: 实时 fetch + 10s LRU 缓存, drift}`；registry HTTP 失败 graceful 降级（registry 段标 `auth-not-available-in-runtime`） | medium |
| P7-01 | Phase 7 | server 端打开双发开关 | update | `packages/nacp-core/src/observability/logger/system-error.ts` + agent-core/orchestrator-core emit 路径 | emit `system.error` 时同步 emit `system.notify(severity=error)` | low |
| P7-02 | Phase 7 | 双发窗口起始时间记录 | add | `docs/issue/real-to-hero/RHX2-dual-emit-window.md` | 记 start_at ISO；用于后续 ≥14 天判定 | low |
| P8-01 | Phase 8 | web `transport.ts` 切 `getErrorMeta()` | update | `clients/web/src/apis/transport.ts`（`import { getErrorMeta, classifyByStatus } from '@haimang/nacp-core/error-codes-client'`） | 不破坏现有 4 类 ApiError 字符串 API | medium |
| P8-02 | Phase 8 | web `ChatPage.tsx` 加 `case 'system.error'` 分支 | update | `clients/web/src/pages/ChatPage.tsx` | 按 `error.category` 分发 toast/banner/redirect | medium |
| P8-03 | Phase 8 | 微信小程序 build script 反射拷贝 `error-codes-client.json` | add | `clients/wechat-miniprogram/build-*.js` | build 时从 `node_modules/@haimang/nacp-core/dist/error-registry-client/data.js` 反射生成 JSON 拷贝到 `miniprogram/utils/error-codes-client.json` | medium |
| P8-04 | Phase 8 | 微信小程序 `nano-client.js` 切 `getErrorMeta()` | update | `clients/wechat-miniprogram/utils/nano-client.js` | 引入 build-time 拷贝的 `error-codes-client.json` + 实现等价 `getErrorMeta(code)` 查询 | medium |
| P8-05 | Phase 8 | 微信小程序 `session/index.js` 加 `case 'system.error'` 分支 | update | `clients/wechat-miniprogram/pages/session/index.js` | wx.showToast/wx.showModal 分发 | medium |
| P9-01 | Phase 9 | 双发窗口准入条件检查（≥14 天 + 至少一端 client 发布） | manual | - | 阅读 `docs/issue/real-to-hero/RHX2-dual-emit-window.md` + 确认 client PR 已 merge | low |
| P9-02 | Phase 9 | server 切单发 | update | `packages/nacp-core/src/observability/logger/system-error.ts` + emit 路径 | 关闭 `system.notify(severity=error)` 双发 | medium |
| P9-03 | Phase 9 | 写 `RHX2-closure.md` | add | `docs/issue/real-to-hero/RHX2-closure.md` | 收口本簇；记录双发窗口实际长度 + 切单发时间 | low |

---

## 4. Phase 业务表格

### 4.1 Phase 1 — 共享包骨架 + DDL + service binding

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P1-01 | nacp-core `observability/logger` 子模块 | 4 级 + critical / `Logger` interface / `createLogger(workerName, opts)` / `withTraceContext` / ALS / 200 条 ring buffer / `LogPersistFn` + `AuditPersistFn` 类型 / dedupe 5s LRU 256 | `packages/nacp-core/src/observability/logger/{index.ts, logger.ts, als.ts, ring-buffer.ts, types.ts, respond.ts, dedupe.ts}` + `packages/nacp-core/package.json` exports map 增 `./logger` + 单测 | nacp-core 通过 `@haimang/nacp-core/logger` 子路径导出；6 worker 可 import | ≥10 unit cases（4 级 × 有/无 ALS + critical + dedupe + 序列化失败 + DO/Worker-Shell 双模 + JSON schema 校验 ≥2） | unit 全绿；nacp-core 既有功能 0 回归 |
| P1-01b | nacp-core minor bump 1.6.0 + 重发 GitHub Packages | `packages/nacp-core/package.json` version 1.4.0 → 1.6.0；`pnpm --filter @haimang/nacp-core run build` 后 `npm publish` | `packages/nacp-core/package.json` | GitHub Packages 上 nacp-core@1.6.0 可拉取；含 `./logger` + `./error-codes-client` 子路径 | `curl -sI -H "Authorization: Bearer $NODE_AUTH_TOKEN" https://npm.pkg.github.com/@haimang%2Fnacp-core` 返回 200 + 在 `versions` 列表里看到 1.6.0 | 1.6.0 published |
| P1-02 | nacp-core `error-registry-client` 子模块 | 8 类 `ClientErrorCategory` 枚举 / `ClientErrorMeta` 接口 / `getErrorMeta(code) → ClientErrorMeta \| undefined` / `classifyByStatus(status) → ClientErrorCategory`；`data.ts` 由 P2-03 反射生成 | `packages/nacp-core/src/error-registry-client/{index.ts, types.ts, data.ts}` + `packages/nacp-core/package.json` exports map 增 `./error-codes-client` + 单测 | nacp-core 通过 `@haimang/nacp-core/error-codes-client` 子路径导出；浏览器 + 微信 + Node 三 runtime 可 import；零 runtime 依赖（不引 zod / 不引 nacp-core 其他 sub-path） | ≥3 unit cases（已知 code 命中 / 未知 code 返回 undefined / classifyByStatus 退路） | unit 全绿 + bundle size < 5 KB |
| P1-03 | migration 006 DDL | 双表（`nano_error_log` 14d + `nano_audit_log` 90d）+ 8 索引 + CHECK 约束（severity / outcome）+ FK 引用 nano_teams / nano_users | `workers/orchestrator-core/migrations/006-error-and-audit-log.sql` | preview D1 apply 成功 | `wrangler d1 execute nano-agent-preview --file=006-...sql --remote`；`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'nano_%log'` 验证两表存在 | preview apply 成功；表结构 + 索引存在；schema 与 design §7.2 F4/F11 完全一致 |
| P1-04~06 | 3 worker wrangler binding | 各 worker `wrangler.jsonc` 在 root + `env.preview.services` 块新增 `{ binding: "ORCHESTRATOR_CORE", service: "nano-agent-orchestrator-core[-preview]" }` | `workers/{bash-core,context-core,filesystem-core}/wrangler.jsonc` | 6 binding 块新增 | `wrangler deploy --dry-run` 各 worker；preview deploy 后 `/debug/workers/health` 仍 6/6 | preview 6/6 健康；service binding 在 wrangler --print-vars 可见 |

### 4.2 Phase 2 — 错误 registry + docs

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P2-01 | 扩展 `error-registry.ts` 暴露 `resolveErrorMeta` | 给 `RpcErrorCode` / `FacadeErrorCode` / `AuthErrorCode` / `KernelErrorCode` / `SessionErrorCode` / `LLMErrorCategory` 6 个枚举各注册一次 `registerErrorDefinition()`；连同已有 19 个 NACP code 共 ~80 个 | `packages/nacp-core/src/error-registry.ts` + 各枚举源处 import | `resolveErrorMeta(code)` 80 codes 全覆盖；`listErrorMetas()` 输出 80+ 条 | ≥5 unit cases（每枚举随机抽 2 + 未知 code returns undefined） | 80 codes 100% 命中；snapshot 测试稳定 |
| P2-02 | 写 `docs/api/error-codes.md` | 8 段（Rpc / Facade / Auth / NACP / Kernel / Session / LLM / ad-hoc）+ 顶部 retention 声明 + 附录 A smind-admin 差异 + 附录 B client meta 8 类映射规则 | `docs/api/error-codes.md` | docs 行数 ≥ 80 + appendix | grep -c "^|" 验证表格行数 | docs 与 listErrorMetas 输出一致；80 行表格全覆盖 |
| P2-03 | CI 一致性测试 | (a) `listErrorMetas()` 中每个 code 必须在 docs 表格中出现；(b) `nacp-core/src/error-registry-client/data.ts` 由 `listErrorMetas()` 反射生成的 ClientErrorMeta 子集（CI 时 `pnpm --filter @haimang/nacp-core run gen:client-meta` 重生 + 校验等价） | `packages/nacp-core/test/{error-codes-coverage,registry-client-mirror}.test.ts` | CI 红即拦三方漂移 | vitest 跑 nacp-core | docs ↔ registry ↔ client meta 三方一致；CI green |

### 4.3 Phase 3 — facade envelope 收口 + Server-Timing

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P3-01 | `respondWithFacadeError()` helper | re-export `facadeError()` + 自动 `logger.error(msg, {code, ctx: details})` + 注入 `x-trace-uuid` 响应头 | `packages/nacp-core/src/observability/logger/respond.ts` | helper 可被 6 worker import | ≥3 unit cases | unit 全绿 |
| P3-02 | orchestrator-core HTTP catch 切 facade | 替换 24 处 `console.warn` + 不规范错误返回；统一调用 `respondWithFacadeError(code, status, msg, trace_uuid)` | `workers/orchestrator-core/src/{index,user-do/*}.ts` | 错误响应只剩一种 envelope | ≥5 cases × 5 路由组 = 25 unit cases | facade error envelope 100% 覆盖 |
| P3-03 | 4 worker HTTP catch 切 facade | agent-core 134 行（`{error: "Not found"}`）+ bash-core 3 处（纯文本）+ context-core inspector + filesystem-core 错误返回 | 4 worker `src/index.ts` + 子模块 | 同上 | 4 worker 各 ≥ 5 unit cases | 6 worker 错误响应同 envelope |
| P3-04 | `attachServerTimings()` | helper 接收 `Response + {auth_dur_ms?, agent_dur_ms?, total_dur_ms}`；写 `Server-Timing: total;dur=N, auth;dur=M, agent;dur=X` | `workers/orchestrator-core/src/policy/authority.ts` | header 注入正确格式 | ≥3 unit cases | unit 全绿 |
| P3-05 | `Server-Timing` 路由集成 | 5 个 facade 路由组（`/sessions/*` / `/me/*` / `/debug/*` / `/auth/*` / `/health`）入口 `t0 = Date.now()`；出口 `attachServerTimings()` | `workers/orchestrator-core/src/index.ts` | 所有 facade 响应必带 `Server-Timing` | 浏览器 Network 面板 sample 5 个请求 | 5 个 sample 全部可见 `Server-Timing` |

### 4.4 Phase 4 — 6 worker 切结构化日志

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P4-01 | orchestrator-core 24 console → logger | 全部 `console.warn(...)` codemod 为 `logger.warn(msg, {code, ctx})`；`models-d1-read-failed` 等保留 msg 名 | `workers/orchestrator-core/src/{index,user-do/*,entrypoint}.ts` | 0 裸 console 在 prod 路径 | grep `console\\.` = 0 | grep + ESLint 双拦截 |
| P4-02 | agent-core / context-core / filesystem-core 8 console → logger | 同上；`usage-commit` 切 `logger.info` | 3 worker `src/` | 0 裸 console | grep + ESLint | grep = 0 |
| P4-03 | bash-core 接 logger + 7 路径 | `executor.ts` / `bridge.ts` 7 个 ad-hoc 字符串路径加 `logger.error/warn(code, ctx)`；ad-hoc codes 写入 `docs/api/error-codes.md` 第 8 段 | `workers/bash-core/src/{executor,bridge}.ts` + `docs/api/error-codes.md` | bash-core prod 路径 ≥ 5 logger.* + 7 ad-hoc codes 进 docs | ≥7 unit cases（每路径 1） | 7 路径全覆盖 + docs 第 8 段 7 行 |
| P4-04 | orchestrator-auth 接 logger + 6 路径 | WeChat code 交换 / JWT 验证 / refresh 三态 / device 注册冲突 / API key hash 校验 6 路径加 logger.warn/error | `workers/orchestrator-auth/src/` | ≥ 5 logger.* | ≥6 unit cases | 6 路径全覆盖 |
| P4-05 | ESLint rules | (a) `no-console` 在 worker `src/` 下报错；(b) `no-restricted-imports` 把 `workers/filesystem-core/src/storage/errors` 与 `workers/agent-core/src/eval/metric-names` 引到主份；(c) 禁止跨 worker import evidence-emitters | `.eslintrc` 或 `packages/eslint-config-nano/` | CI 红即拦 | fixtures 触发 / 不触发 | 3 条 rule 全部有单测 |

### 4.5 Phase 5 — system.error + audit.record + observability alert

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P5-01 | `SystemErrorEventBodySchema` | 在 stream-event union 新增 `{kind:"system.error", error: NacpErrorSchema, source_worker?, trace_uuid?}` | `packages/nacp-session/src/stream-event.ts` | schema 加入 union；与 `SystemErrorBodySchema` 平行 | ≥3 unit cases（schema 校验 + 兼容降级 + dedupe 三元组） | unit 全绿 |
| P5-02 | agent-core kernel emit `system.error` | runtime-mainline 错误归一点调用 `tryEmitSystemError(record)`；通过 `ORCHESTRATOR_CORE.forwardServerFrameToClient` 跨 worker 推 | `workers/agent-core/src/host/runtime-mainline.ts` + 邻近 | kernel critical 错误必 emit | ≥3 unit cases + 1 cross-e2e | live e2e `15-system-error-frame.test.mjs` 通过 |
| P5-03 | orchestrator-core facade emit `system.error` | `respondWithFacadeError()` 内检测 attached WS；若有则 emit `system.error`；trace_uuid 一致 | `workers/orchestrator-core/src/{policy/authority,user-do/*}.ts` | F2 × F7 trace_uuid 强一致 | ≥2 unit cases + 1 cross-e2e | F2 × F7 交叉测试通过 |
| P5-04 | `recordAuditEvent()` helper | 包装 NACP `AuditRecordBody` + 写 `nano_audit_log`；强制 `team_uuid` NOT NULL；不 dedupe | `packages/nacp-core/src/observability/logger/audit.ts` | helper 可被 orchestrator-core / orchestrator-auth / agent-core 调用 | ≥4 unit cases | unit 全绿 |
| P5-05 | F11 8 类 event_kind 写路径 | (1) auth.login.success / (2) auth.api_key.issued / (3) auth.api_key.revoked / (4) auth.device.gate_decision / (5) tenant.cross_tenant_deny / (6) hook.outcome（仅 final_action !== 'continue'） / (7) session.attachment.superseded / (8) session.replay_lost | `workers/orchestrator-{auth,core}/src/` + `workers/agent-core/src/hooks/audit.ts` | 8 类各 ≥1 写路径 + 1 单测 | ≥8 unit cases + 1 e2e `16-audit-cross-tenant-deny.test.mjs` | 8 类全覆盖 + cross-e2e 通过 |
| P5-06 | `emitObservabilityAlert()` + 3 类 critical | D1 写失败 / RPC parity 失败 / R2 写失败 三类触发；空 metrics/traces 不序列化 | `packages/nacp-core/src/observability/logger/alerts.ts` + 3 处触发点 | 3 类各 ≥1 触发 | ≥4 unit cases（3 触发 + 自写失败回退） | unit 全绿 |
| P5-07 | §3.6 三套真相规则单测 | (a) audit ref 不复制 activity payload；(b) error_log 仅 severity≥warn；(c) cross-tenant deny 双写；(d) session 边界事件双写 audit + activity_log | `packages/nacp-core/test/cross-table-rules.test.ts` | 4 条规则各覆盖 | ≥4 unit cases | unit 全绿 |

### 4.6 Phase 6 — 调试 endpoint + cron 清理

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P6-01 | `/debug/logs` + `/debug/recent-errors` | team gate；按 trace_uuid/session_uuid/code/since 查；返回 14d D1 命中 + 内存 ring 200 条 | `workers/orchestrator-core/src/index.ts` | ≥6 unit cases（trace 查 / session 查 / 跨 team 拒 / rate-limit / 空命中 / recent-errors） | preview e2e `15-error-log-smoke.test.mjs` | unit 全绿 + e2e 通过 |
| P6-02 | `/debug/audit` | owner gate；按 event_kind / team_uuid / since 查；返回 90d 命中 | `workers/orchestrator-core/src/index.ts` | owner-only；非 owner 403 | ≥4 unit cases + 1 e2e | unit + e2e 通过 |
| P6-03 | cron trigger | wrangler.jsonc `triggers.crons` = `["0 3 * * *"]`；scheduled handler 跑 `DELETE FROM nano_error_log WHERE created_at < ...` + audit 90d | `workers/orchestrator-core/wrangler.jsonc` + `src/cron/cleanup.ts` | preview cron 落地；手动触发能跑 | `wrangler triggers --scheduled` 验证；本地 `Cron.scheduled` mock 单测 | preview cron 配置在 dashboard 可见 |

### 4.7 Phase 7 — server 双发降级窗口启动

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P7-01 | server 双发开关 | emit `system.error` 时 **同步 emit** 一个 `system.notify(severity=error)`，trace_uuid + code + message 一致 | `packages/nacp-core/src/observability/logger/system-error.ts` + agent-core / orchestrator-core emit 路径 | 老 client 收到 notify；新 client 收到 error；按 trace_uuid 自行 dedupe | ≥3 unit cases（双发同 trace_uuid / dedupe / 关闭单发条件） | unit 全绿；preview live 测试老 client 仍可用 |
| P7-02 | 双发窗口起始时间记录 | 写一份 markdown 记录 `dual_emit_started_at`、Q-Obs11 准入条件、预期切单发日期 | `docs/issue/real-to-hero/RHX2-dual-emit-window.md` | 文档记录起始时间 ISO；用于 Phase 9 判定 | 人工核对 | 文档 commit；时间精确到分钟 |

### 4.8 Phase 8 — client 端消费改造

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P8-01 | web `transport.ts` 切 `getErrorMeta` | 内部实现替换：`classifyError(status, data) → getErrorMeta(envelope.error.code)?.category ?? classifyByStatus(status)`；外部 `ApiError.kind` 4 类字符串保留向后兼容 | `clients/web/src/apis/transport.ts` | 现有 4 类 `ApiError.kind` 不破坏 | ≥3 unit cases（已知 code / 未知 code fallback / 网络错） | 现有 web 调用零 break |
| P8-02 | web `ChatPage.tsx` 加 `case 'system.error'` | 按 `error.category` 分发：`security` → 跳登录；`quota` → 弹超额；`transient`/`dependency` → toast + retry hint；`permanent`/`validation` → banner | `clients/web/src/pages/ChatPage.tsx` | 双发窗口期间按 trace_uuid dedupe 不重复展示 | ≥3 unit cases + 1 e2e（preview 触发 facade 5xx + 验 UI） | 4 类 category 各 ≥1 case |
| P8-03 | 微信小程序 build script | build 脚本读 `node_modules/@haimang/nacp-core/dist/error-registry-client/data.js` 反射输出 → 拷贝到 `clients/wechat-miniprogram/utils/error-codes-client.json`；记入 .gitignore | `clients/wechat-miniprogram/build-*.js` 或 `package.json scripts.build` | 小程序 build 后 `error-codes-client.json` 存在 | build 一次后验证文件存在 + 内容与 nacp-core `listErrorMetas()` 一致 | build 顺利；文件 ≤ 50 KB |
| P8-04 | 微信小程序 `nano-client.js` 切 `getErrorMeta` | 引入 `error-codes-client.json`；`classifyError(status, data)` 改用 getErrorMeta 实现 | `clients/wechat-miniprogram/utils/nano-client.js` | 现有 4 类外部 API 不破坏 | ≥3 unit cases（已知 code / 未知 code fallback / 网络错） | 现有小程序调用零 break |
| P8-05 | 微信小程序 `session/index.js` 加 `case 'system.error'` | switch 加分支；`security` → `wx.showModal` + 跳登录；`quota` → `wx.showToast`；其他 → console.log + toast | `clients/wechat-miniprogram/pages/session/index.js` | 双发窗口期间小程序按 trace_uuid dedupe | ≥3 unit cases | 4 类 category 各 ≥1 case |

### 4.9 Phase 9 — 双发观察 + 切单发 + closure

| 编号 | 工作项 | 工作内容 | 涉及文件 / 模块 | 预期结果 | 测试方式 | 收口标准 |
|---|---|---|---|---|---|---|
| P9-01 | 双发窗口准入条件检查 | 检查：(a) 双发已运行 ≥14 天；(b) web 与微信小程序至少一端发布 `case 'system.error'` PR | 阅读 `RHX2-dual-emit-window.md` + git log | 准入条件满足 → 进 P9-02；不满足 → 顺延 7 天 | 人工核对 + git log 命令 | 准入条件文档 sign-off |
| P9-02 | server 切单发 | 关闭 `system.notify(severity=error)` 双发；只 emit `system.error` | `packages/nacp-core/src/observability/logger/system-error.ts` | 老 client 不再收到 system.notify(severity=error)；新 client 不受影响 | preview 跑 1 天观察日志 | preview 1 天无回归 |
| P9-03 | 写 `RHX2-closure.md` | 记录：13 项 F 的实测落地 / 双发窗口实际长度 / 切单发时间 / known gap（如有） | `docs/issue/real-to-hero/RHX2-closure.md` | closure 文档 commit | 人工核对 8.2 整体收口标准 | closure 通过 §8.2 全部条件 |

---

## 5. Phase 详情

### 5.1 Phase 1 — nacp-core 子路径扩展 + DDL + service binding

- **Phase 目标**：底层设施一次性铺好（nacp-core 两个子模块 + bump 重发 + migration + 3 binding）。
- **本 Phase 对应编号**：P1-01 / P1-01b / P1-02 / P1-03 ~ P1-06
- **本 Phase 新增文件**：
  - `packages/nacp-core/src/observability/logger/{index.ts, logger.ts, als.ts, ring-buffer.ts, types.ts, respond.ts, dedupe.ts, audit.ts, alerts.ts, system-error.ts}`（Phase 1 仅落 logger / als / ring-buffer / types / dedupe；audit / alerts / system-error / respond 在 Phase 3 / 5 / 7 由 P3-01 / P5-04 / P5-06 / P7-01 添加文件）
  - `packages/nacp-core/src/error-registry-client/{index.ts, types.ts, data.ts}`
  - `packages/nacp-core/test/observability-logger/*.test.ts` + `packages/nacp-core/test/error-registry-client/*.test.ts`
  - `workers/orchestrator-core/migrations/006-error-and-audit-log.sql`
- **本 Phase 修改文件**：
  - `packages/nacp-core/package.json`：version `1.4.0 → 1.6.0`；`exports` map 新增 `./logger` 与 `./error-codes-client` 两条入口
  - `packages/nacp-core/src/index.ts`：不动主入口（保持向后兼容）；两个子模块仅通过 sub-path 导出
  - `packages/jwt-shared/package.json`：version `0.0.0 → 0.1.0`（v0.draft-r3 critical 门禁）
  - `workers/bash-core/wrangler.jsonc`、`workers/context-core/wrangler.jsonc`、`workers/filesystem-core/wrangler.jsonc`
  - 6 worker `package.json` 增 `"predeploy": "node ../../scripts/verify-published-packages.mjs"` hook（v0.draft-r3）
  - 6 worker `wrangler.jsonc` 增 esbuild `define` 或等价 build 参数注入 `__NANO_PACKAGE_MANIFEST__`（v0.draft-r3）
- **v0.draft-r3 新增文件**：
  - `scripts/verify-published-packages.mjs`（CI gate 脚本）
  - `scripts/generate-package-manifest.mjs`（build-time 生成 manifest 注入 esbuild）
- **具体功能预期**：
  1. `import { createLogger, withTraceContext, ... } from '@haimang/nacp-core/logger'` 在 6 worker runtime 可调用；ALS 注入 trace_uuid/session_uuid/team_uuid
  2. `import { getErrorMeta, classifyByStatus, ClientErrorCategory } from '@haimang/nacp-core/error-codes-client'` 在浏览器 / 微信小程序 / Node 三 runtime 可调用
  3. `nacp-core@1.6.0` 已发布到 GitHub Packages（`curl https://npm.pkg.github.com/@haimang%2Fnacp-core` 在 versions 列表中可见 1.6.0；含两条 sub-path）
  4. preview D1 含 `nano_error_log` + `nano_audit_log` 双表 + 8 索引
  5. `bash-core` / `context-core` / `filesystem-core` preview deploy 后 `env.ORCHESTRATOR_CORE` binding 可用
- **具体测试安排**：
  - **单测**：observability/logger ≥10 cases + error-registry-client ≥3 cases；nacp-core 现有测试 0 回归
  - **集成测试**：preview D1 apply migration 006 + 验证表存在；3 worker preview deploy + `/debug/workers/health` 返回 6/6；新建一个微型 vite/esbuild fixture 验证 `@haimang/nacp-core/error-codes-client` 在浏览器 bundle 中树摇后体积 < 5 KB
  - **回归测试**：4-worker package test 全绿；nacp-core 既有 sub-path（如 `./tenancy` / `./transport` / `./evidence`）行为不变
  - **手动验证**：本地 `pnpm install` 全绿；wrangler dashboard 看到 service binding 配置生效；GitHub Packages registry 看到 1.6.0
- **收口标准**：
  - nacp-core 1.6.0 published；两条新 sub-path 都可被 6 worker + web + 微信小程序解析
  - migration 006 在 preview D1 应用成功
  - 6/6 worker preview 健康
- **本 Phase 风险提醒**：
  - 两个子模块不能反向 import nacp-core 的 `./` 主入口（`error-registry-client` 必须零 nacp-core runtime 依赖；`logger` 只允许从 `nacp-core/error-registry` 取 `NacpErrorSchema` / `NacpObservabilityEnvelope` 类型，`import type` 不引 runtime）
  - nacp-core minor bump 必须确认与 `nacp-session` 的版本兼容矩阵；如果 `nacp-session` 在 `peerDependencies` / `dependencies` 中钉死 nacp-core 1.4.0，需要同步 bump 或放宽到 `^1.4.0`
  - migration 006 一旦 apply 不可回滚；DDL 必须严格 review

### 5.2 Phase 2 — 错误 registry + docs

- **Phase 目标**：80+ codes 收口到统一查询面 + docs 镜像 + CI 一致性。
- **本 Phase 对应编号**：P2-01 ~ P2-03
- **本 Phase 新增文件**：
  - `docs/api/error-codes.md`
  - `packages/nacp-core/test/error-codes-coverage.test.ts`
  - `packages/nacp-core/test/registry-client-mirror.test.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/error-registry.ts`（新增 `resolveErrorMeta()` + `listErrorMetas()` + 6 套枚举注册）
  - `packages/nacp-core/src/error-registry-client/data.ts`（由 `listErrorMetas()` 反射生成 ClientErrorMeta 子集；CI 时通过 `pnpm --filter @haimang/nacp-core run gen:client-meta` 重生 + 等价校验）
- **具体功能预期**：
  1. `resolveErrorMeta(code)` 80+ codes 100% 命中
  2. `docs/api/error-codes.md` 8 段表格行数 ≥ 80 + 附录 A/B
  3. CI 一致性测试：docs ↔ registry ↔ client meta 三方等价
- **具体测试安排**：
  - **单测**：error-codes-coverage（每枚举 ≥2 + 未知 code）+ registry-mirror（client 是 server 子集）
  - **回归测试**：6 worker package test 不受 error-registry 改动影响
- **收口标准**：
  - 80 codes 全覆盖
  - CI 三方一致性测试 green
- **风险**：枚举注册站点分散，初次落地容易漏一两个 code → CI 一致性测试是最后防线

### 5.3 Phase 3 — facade envelope 收口 + Server-Timing

- **Phase 目标**：6 worker HTTP 错误响应只剩一种 envelope；orchestrator-core 出口注入 `Server-Timing`。
- **本 Phase 对应编号**：P3-01 ~ P3-05
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/observability/logger/respond.ts`（新增 `respondWithFacadeError()`）
  - `workers/orchestrator-core/src/{index, user-do/*, policy/authority}.ts`
  - `workers/{agent-core,bash-core,context-core,filesystem-core}/src/index.ts` + 子模块
- **具体功能预期**：
  1. 6 worker 任意 HTTP 错误响应都是 `{ok:false, error:{code,status,message,details?}, trace_uuid}`
  2. orchestrator-core facade 出口必带 `Server-Timing`（至少 `total;dur=N`）
- **具体测试安排**：
  - **单测**：6 worker 各 ≥5 cases × 5 路由组（orchestrator-core 全 25）
  - **集成测试**：preview deploy 后 curl 各 worker 错误路径，验响应 envelope + header
  - **手动验证**：浏览器 Network 面板看 `Server-Timing` 列
- **收口标准**：6 worker 错误响应同 envelope；facade 出口 `Server-Timing` 100% 覆盖
- **风险**：codemod 触面广（6 worker × 多路由），易漏改；用 grep + ESLint no-restricted-syntax 双拦截

### 5.4 Phase 4 — 6 worker 切结构化日志

- **Phase 目标**：终结 0 console / 32 行半结构化的现状；ESLint 防止漂移。
- **本 Phase 对应编号**：P4-01 ~ P4-05
- **本 Phase 修改文件**：6 worker `src/`（codemod 32 行 + 新增 ≥11 行 logger.* in bash-core/orchestrator-auth）+ `.eslintrc`
- **本 Phase 删除文件**：无（仅替换）
- **具体功能预期**：
  1. 6 worker `src/` 下裸 `console.*` = 0（除 `@haimang/nacp-core/logger` 子模块内部底层调用）
  2. bash-core / orchestrator-auth prod 错误路径 logger.error/warn ≥ 5 各
  3. ESLint 阻拦：(a) 裸 console；(b) 跨 worker import evidence-emitters；(c) `StorageError` / `metric-names` 走主份
- **具体测试安排**：
  - **单测**：bash-core 7 cases + orchestrator-auth 6 cases + 4 worker codemod 后 unit 全绿
  - **回归测试**：4-worker package test + cross-e2e 全绿
- **收口标准**：grep `console\\.` 在 6 worker `src/` = 0；ESLint rule fixtures 通过
- **风险**：codemod 量大（32+ 行）；建议分 PR：每 worker 1 PR

### 5.5 Phase 5 — system.error + audit.record + observability alert

- **Phase 目标**：3 个 NACP 协议留位首次进入 prod。
- **本 Phase 对应编号**：P5-01 ~ P5-07
- **本 Phase 新增文件**：
  - `packages/nacp-core/src/observability/logger/{audit.ts, alerts.ts, system-error.ts}`（re-exported via `@haimang/nacp-core/logger`）
  - `packages/nacp-core/test/cross-table-rules.test.ts`
- **本 Phase 修改文件**：
  - `packages/nacp-session/src/stream-event.ts`（新增 `SystemErrorEventBodySchema`）
  - `workers/agent-core/src/host/runtime-mainline.ts` + `workers/agent-core/src/hooks/audit.ts`
  - `workers/orchestrator-core/src/{policy/authority, user-do/*, index}.ts`
  - `workers/orchestrator-auth/src/`（auth.login.success / api_key.issued / api_key.revoked 写 audit）
- **具体功能预期**：
  1. agent-core kernel critical 错误 emit `system.error`；orchestrator-core facade error 同步 emit（如有 attached WS）
  2. F11 8 类 event_kind 各 ≥1 写路径
  3. 3 类 critical（D1/RPC/R2）触发 `emitObservabilityAlert()`，写 `nano_error_log` + console + WS（如可达）
  4. §3.6 4 条索引引用规则被单测覆盖
- **具体测试安排**：
  - **单测**：≥30 cases（P5-01–07 各 ≥3）
  - **集成测试**：preview deploy 后跑 `15-system-error-frame.test.mjs` + `16-audit-cross-tenant-deny.test.mjs`
- **收口标准**：8 类 audit 全写过；3 类 critical 全触发过；F2 × F7 trace_uuid 一致单测通过
- **风险**：F11 8 类 event_kind 散落多 worker，最易漏；建议每类 event_kind 在写路径附近就近放单测

### 5.6 Phase 6 — 调试 endpoint + cron 清理

- **Phase 目标**：D1 双表"可写又可读"形成完整闭环。
- **本 Phase 对应编号**：P6-01 ~ P6-03
- **本 Phase 修改文件**：
  - `workers/orchestrator-core/src/index.ts`（新增 3 个路由）
  - `workers/orchestrator-core/wrangler.jsonc`（`triggers.crons`）
  - `workers/orchestrator-core/src/cron/cleanup.ts`（新增）
- **具体功能预期**：
  1. `GET /debug/logs?trace_uuid=...&team_uuid=...` 返回 14d D1 命中
  2. `GET /debug/recent-errors?limit=100` 返回内存 ring 200 条
  3. `GET /debug/audit` owner-only 返回 90d 命中
  4. cron 每天 03:00 UTC 跑 TTL DELETE
- **具体测试安排**：
  - **单测**：≥10 cases
  - **集成测试**：preview deploy 后 curl 各 endpoint
  - **手动验证**：preview cron 在 dashboard 可见
- **收口标准**：3 个 endpoint 各 ≥4 cases 通过；preview cron 已配置
- **风险**：cron handler 在 Cloudflare Workers 与 fetch handler 不同入口，需要在 wrangler 配置 + scheduled handler 两侧都改

### 5.7 Phase 7 — server 双发降级窗口启动

- **Phase 目标**：在 client 改造未完成前打开 server 双发，老 client 不破坏。
- **本 Phase 对应编号**：P7-01, P7-02
- **本 Phase 修改文件**：
  - `packages/nacp-core/src/observability/logger/system-error.ts`（emit `system.error` 时同步 emit `system.notify(severity=error)`，开关默认开）
  - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`（新增）
- **具体功能预期**：
  1. server emit `system.error` 时同时 emit `system.notify(severity=error)`，trace_uuid + code + message 三字段一致
  2. `RHX2-dual-emit-window.md` 记录 `dual_emit_started_at` ISO + 准入条件
- **具体测试安排**：
  - **单测**：≥3 cases
  - **集成测试**：preview live 触发 facade 5xx，验老 WS client 收到 `system.notify(severity=error)`
- **收口标准**：双发开关已开；起始时间已记录
- **风险**：双发会让前端短期内 WS 噪音上升 → 由 client 端按 trace_uuid 1s 时间窗去重缓解（已在 §7.2.5 设计）

### 5.8 Phase 8 — client 端消费改造（web + 微信小程序）

- **Phase 目标**：F12 + F13 端到端落地。
- **本 Phase 对应编号**：P8-01 ~ P8-05
- **本 Phase 修改文件**：
  - `clients/web/src/apis/transport.ts`
  - `clients/web/src/pages/ChatPage.tsx`
  - `clients/wechat-miniprogram/utils/nano-client.js`
  - `clients/wechat-miniprogram/pages/session/index.js`
  - `clients/wechat-miniprogram/build*` 脚本（拷贝 error-codes-client.json）
- **具体功能预期**：
  1. web `transport.ts.classifyError()` 内部走 `getErrorMeta()`；外部 `ApiError.kind` 4 类向后兼容
  2. web `ChatPage.tsx` switch 新增 `case 'system.error'`；按 category 分发
  3. 微信小程序同上 + build 时拷贝 JSON
  4. 双发窗口期间两端按 `trace_uuid + 1s 时间窗` dedupe；不重复展示
- **具体测试安排**：
  - **单测**：每端 ≥3 cases
  - **集成测试**：preview deploy + 触发 facade 5xx，分别用 web / 微信小程序 client 验证 UI
  - **手动验证**：web Chrome devtools 看 transport 切换；小程序模拟器看 `case 'system.error'` 命中
- **收口标准**：两端 PR merge；双发窗口期间手动验证 UI 不重复展示
- **风险**：跨 client 协调；建议两端 PR 各自独立合并；至少一端 merge 后即可进 Phase 9（不需要两端都 merge）

### 5.9 Phase 9 — 双发观察 + 切单发 + closure

- **Phase 目标**：满足 Q-Obs11 准入条件 → 切单发 → 闭合本簇。
- **本 Phase 对应编号**：P9-01 ~ P9-03
- **本 Phase 新增文件**：`docs/issue/real-to-hero/RHX2-closure.md`
- **本 Phase 修改文件**：`packages/nacp-core/src/observability/logger/system-error.ts`（关闭双发开关）
- **具体功能预期**：
  1. 双发已运行 ≥14 天 + web/微信至少一端发布 PR
  2. 关闭 `system.notify(severity=error)` 双发；只 emit `system.error`
  3. closure 文档记录 13 项 F 的实测落地 / 双发实际窗口长度 / 已知 gap（如有）
- **具体测试安排**：
  - **手动验证**：阅读 `dual-emit-window.md` + git log；preview 切单发后跑 1 天观察 wrangler tail 无回归
- **收口标准**：通过 §8.2 整体收口；closure commit
- **风险**：准入条件不满足时禁止提前切单发；窗口可顺延（不可缩短）

---

## 6. 依赖的冻结设计决策（只读引用）

| 决策 / Q ID | 冻结来源 | 本计划中的影响 | 若不成立的处理 |
|---|---|---|---|
| Q-Obs1 单写点 = orchestrator-core | RHX-qna §Q-Obs1 | F4/F11 RPC 路径；3 worker binding 新增 | 回退到 design |
| Q-Obs2 migration = `006-error-and-audit-log.sql` | RHX-qna §Q-Obs2 | P1-03 文件名 | 回退到 design |
| Q-Obs3 retention error 14d / audit 90d | RHX-qna §Q-Obs3 | P1-03 DDL；P6-03 cron | 回退到 design |
| Q-Obs4 新增 `system.error` kind | RHX-qna §Q-Obs4 | P5-01 schema | 回退到 design |
| Q-Obs5 `/debug/logs` team gate / `/debug/audit` owner gate | RHX-qna §Q-Obs5 | P6-01/02 鉴权 | 回退到 design |
| Q-Obs6 first-wave audit 8 类 event_kind | RHX-qna §Q-Obs6 | P5-05 8 类写路径 | 回退到 design |
| Q-Obs7 F2 × F7 trace_uuid 强一致；code 允许不同源 | RHX-qna §Q-Obs7 | P5-03 emit；P8-02/05 dedupe | 回退到 design |
| Q-Obs8 TTL 清理用 cron trigger | RHX-qna §Q-Obs8 | P6-03 wrangler.jsonc + cron handler | 回退到 design |
| Q-Obs9 bash-core ad-hoc codes 不强制归化 zod | RHX-qna §Q-Obs9 | P4-03 + docs 第 8 段 | 回退到 design |
| Q-Obs10 client meta = 候选 a 共享 npm 包 | RHX-qna §Q-Obs10 | P1-02 包形态；P8-03 build 拷贝 | 回退到 design |
| Q-Obs11 双发窗口默认 4 周 + 准入条件 | RHX-qna §Q-Obs11 | P7 启动；P9-01 准入；P9-02 切单发 | 顺延，不静默切 |
| Q-Obs12 §3.6 4 条索引引用规则 first-wave 强制 | RHX-qna §Q-Obs12 | P5-07 单测 4 条规则 | 回退到 design |

---

## 7. 风险、依赖与完成后状态

### 7.1 风险与依赖

| 风险 / 依赖 | 描述 | 当前判断 | 应对方式 |
|---|---|---|---|
| `nano_error_log` 写入风暴 | 大量 critical 同 trace 反复写 | medium | (a) (trace_uuid, code) 5s dedupe；(b) per-team ≤10/s；(c) 写失败 fallback console；(d) `rpc_log_failed:true` 标记 |
| 单写点不可用时丢日志 | orchestrator-core 自身错误 | medium | caller 端 fallback 不 retry；console + ring buffer 兜底 |
| migration 006 不可回滚 | D1 限制 | low | DDL review 严格；preview 先 apply；production 后 apply |
| F2 × F7 双通道告警重复 | 同 trace_uuid 两通知面 | low | trace_uuid 强一致；前端 1s 时间窗 dedupe |
| F13 双发窗口期间 WS 噪音上升 | server 双发 | low | client 端 dedupe；窗口默认 4 周 |
| 三套真相职责混淆 | 写错表 / payload 漂移 | medium | P5-07 单测 4 条规则；ESLint 跨包 import 限制 |
| 跨 client 协调成本 | web + 微信小程序两端 | medium | F13 不要求两端同时发布；至少一端即可进 Phase 9 |
| ESLint codemod 触面广 | 6 worker × 多路由 × 多 import | medium | 分 PR；每 worker 1 PR |
| Cloudflare cron trigger 配置错误 | 时间不对 / 地区问题 | low | preview 先验；生产前 sign-off |

### 7.2 约束与前提

- **技术前提**：`@haimang/nacp-core` ≥ 当前版本；`@haimang/nacp-session` 接受新 stream-event kind；Cloudflare cron trigger 在当前 plan 可用；`AsyncLocalStorage` 在 Cloudflare Workers + DO runtime 可用
- **运行时前提**：6/6 worker preview 健康；preview D1 有写入额度；preview R2 有写入额度
- **组织协作前提**：clients/web 与 clients/wechat-miniprogram 在同 monorepo（`clients/`）；同 owner 可发 PR
- **上线 / 合并前提**：每个 Phase 独立可 merge；F13 双发窗口禁止提前切单发

### 7.3 文档同步要求

- 需要同步更新的设计文档：
  - `docs/design/real-to-hero/RHX2-observability-and-auditability.md` 状态由 `frozen` → 若 closure 后改 `executed-superseded` 由 closure 处理
- 需要同步更新的说明文档 / README：
  - `docs/api/error-codes.md`（Phase 2 新建）
  - `docs/issue/real-to-hero/RHX2-dual-emit-window.md`（Phase 7 新建）
  - `docs/issue/real-to-hero/RHX2-closure.md`（Phase 9 新建）
- 需要同步更新的测试说明：
  - 各 worker `test/` 目录新增 e2e 文件命名记入 closure

### 7.4 完成后的预期状态

1. **协议层**：NACP `system.error` + `audit.record` + `NacpObservabilityEnvelope.alerts` 三个观测留位首次在 prod 路径被 emit；schema-only 状态结束。
2. **数据层**：D1 多两张表（`nano_error_log` 14d + `nano_audit_log` 90d）；与 `nano_session_activity_logs` 形成"三套真相 + 索引引用"分工。
3. **应用层**：6 worker 共用 `@haimang/worker-logger`；裸 console 在 prod 路径绝迹；HTTP 错误响应只剩 `FacadeErrorEnvelope` 一种 envelope。
4. **协议出口**：80+ codes 收口到 `resolveErrorMeta()` + `docs/api/error-codes.md` + `error-codes-client` 三方一致；CI 防漂移。
5. **客户端**：web `transport.ts` + 微信小程序 `nano-client.js` 共用 `getErrorMeta()`；web `ChatPage.tsx` + 微信小程序 `session/index.js` 共用 `case 'system.error'` 分支；server `system.error` 已切单发。
6. **运维/调试**：`/debug/logs` + `/debug/recent-errors` + `/debug/audit` 三个 endpoint 可用；cron trigger 每天清理 TTL。
7. **可观测性达成度**：前端 80% bug 不再需要 owner 介入；trace_uuid + Server-Timing + system.error UX 分发 端到端覆盖。

---

## 8. Action-Plan 整体测试与整体收口

### 8.1 Action-Plan 整体测试方法

- **基础校验**：
  - `pnpm typecheck` + `pnpm lint` 6 worker + 2 包全绿
  - `wrangler deploy --dry-run` 6 worker 全部成功
- **单元测试**：
  - 总目标 ≥86 unit cases（F1 ≥10 / F2 6×5 / F3 ≥5 / F4 ≥8 / F5 ≥6 / F6 facade ≥5 sample / F7 ≥6 / F8 ≥4 / F9 ≥13 / F10 ≥3 / F11 ≥8 / F12 ≥5 / F13 ≥6）
- **集成测试**：
  - preview deploy 后跑：
    - `test/package-e2e/orchestrator-core/15-error-log-smoke.test.mjs`
    - `test/package-e2e/orchestrator-core/16-audit-log-smoke.test.mjs`
    - `test/cross-e2e/15-system-error-frame.test.mjs`
    - `test/cross-e2e/16-audit-cross-tenant-deny.test.mjs`
  - 总目标 ≥10 live e2e
- **端到端 / 手动验证**：
  - 浏览器 + 微信小程序模拟器各跑一次"触发 facade 5xx → 验 system.error UI 分发 → 验 trace_uuid dedupe"
- **回归测试**：
  - 6 worker `test/` 全部通过；charter §10.3 NOT-成功退出条件 0 触发
- **文档校验**：
  - `docs/api/error-codes.md` 表格行数 = `listErrorMetas()` 输出条数（CI 一致性）

### 8.2 Action-Plan 整体收口标准

所有 Phase 完成后，至少应满足以下条件：

1. F1–F15 共 15 项 first-wave 工作全部 done（v0.draft-r3 由 13 扩为 15；新增 F14 + F15）
2. ≥86 unit cases + ≥10 live e2e 全绿（v0.draft-r3 加 F14/F15 测试后再上调，以最新 §7.3 / §8.1 为准）
3. preview 6/6 worker 健康；migration 006 已 apply preview + production
4. 80+ error codes 在 `resolveErrorMeta()` + `docs/api/error-codes.md` + `nacp-core/error-codes-client` 三方一致；CI 测试 green
5. F11 8 类 event_kind 各 ≥1 真实写路径在 preview 上跑过
6. F13 双发窗口已运行 ≥14 天 + 至少一端 client PR merge；server 已切单发（或 closure 显式说明窗口顺延原因）
7. §3.6 4 条索引引用规则单测覆盖；ESLint rules 阻拦有效
8. **F14 包来源单一真相门禁通过**（v0.draft-r3 critical 门禁）：
   - `@haimang/jwt-shared@0.1.0` 已发布到 GitHub Packages（HTTP 200 + versions 列表含 0.1.0 截图入 closure）
   - `@haimang/nacp-core@1.6.0` 已重发（含 `./logger` + `./error-codes-client` 两条 sub-path）
   - `@haimang/nacp-session` 已是 published 状态（保持不变）
   - `scripts/verify-published-packages.mjs` 在 6 worker `predeploy` 上挂载且通过；CI workflow 跑通；workspace ↔ registry drift 0
   - 6 worker bundle 都已 inline `__NANO_PACKAGE_MANIFEST__`
9. **F15 `/debug/packages` 验证接口可用**（v0.draft-r3 critical 可观测性）：
   - preview + production 两环境 `GET /debug/packages` 都返回 200
   - 响应含 `deployed.{version,resolved_from,dist_sha256}` × 3 包 + `registry.{latest_version,published_at,fetched_at}` × 3 包 + `drift` 字段
   - 对未登录请求返回 401；对跨 team 请求返回 403
   - 故障演练 1 次：人为造成 workspace ↔ registry version drift，验证 `/debug/packages` 正确报 drift=true（截图入 closure）
10. `RHX2-closure.md` commit；charter §10.3 NOT-成功退出条件 0 触发；closure 必须列出 §8.2 #1–#9 的逐条证据
11. **closure 不允许在 jwt-shared 发布事实未机器验证（curl + HTTP 200）的情况下宣告"全部完成"**（v0.draft-r3 critical 门禁认知正确性）

### 8.3 完成定义（Definition of Done）

| 维度 | 完成定义 |
|---|---|
| 功能 | F1–F13 一句话收口目标全部通过；server 已切单发 |
| 测试 | ≥86 unit + ≥10 e2e 全绿；CI 三方一致性测试 green |
| 文档 | `docs/api/error-codes.md` + `RHX2-dual-emit-window.md` + `RHX2-closure.md` 全部 commit；design v0.3 frozen 状态保持 |
| 风险收敛 | 7.1 表所有 medium / high 风险均有缓解记录在 closure |
| 可交付性 | 6 worker preview + production 健康；2 端 client 至少一端 PR merge；80+ codes 端到端可消费 |

---

## 9. 执行日志回填（仅 `executed` 状态使用）

> 文档当前状态 `draft-r2`，本节留空。Phase 9 closure 完成后由 closure 文档承接，本节不再回填，以避免 single-source-of-truth 漂移。

---

## 10. ~~RHX3 carry-over — 包发布治理~~ → v0.draft-r3 撤销：critical 门禁纠正（在本簇 first-wave 范围内修复）

> ⚠️ **v0.draft-r2 把 jwt-shared 发布问题登记为 RHX3 carry-over 是错误判断**——owner 在 v0.draft-r3 反馈中明确：这是 critical 门禁认知错误，不属于可以 carry over 的范畴。我们曾在某些 phase closure 中宣告完成，但实际上事实-意图不一致。"我们仅能依靠一个唯一真相：要么是线上 package，要么是本库内 package；不能存在任何模糊空间。"
>
> 因此 v0.draft-r3 把所有相关工作项 **从本节移到 Phase 1 / Phase 6**：
>
> - **P1-07** jwt-shared@0.1.0 首发到 GitHub Packages
> - **P1-08** CI gate 脚本 `verify-published-packages.mjs`
> - **P1-09** build-time `__NANO_PACKAGE_MANIFEST__` 注入
> - **P6-04** `/debug/packages` endpoint
> - 见 §3 业务工作总表 + §4.1 / §4.6 Phase 表格 + §5.1 / §5.6 Phase 详情。
>
> 本节保留 §10.1–§10.3 的事实记录（说明为什么 jwt-shared 之前未发布、测试为何能跑通、为何这是 critical 而非 latent），作为对 v0.draft-r2 错误判断的更正记录；§10.4–§10.5 的"RHX3 三选一"已撤销。

### 10.1 事实

| 包 | GitHub Packages 状态 | `package.json` 中的 publishConfig | 当前 consumer 引用形态 |
|---|---|---|---|
| `@haimang/nacp-core` | ✅ 已发布 1.4.0（HTTP 200）；本 action-plan P1-01b 将 bump 到 1.6.0 重发 | 已设置 | `workspace:*`（workspace 内）+ 远端可拉 |
| `@haimang/nacp-session` | ✅ 已发布（HTTP 200） | 已设置 | `workspace:*` + 远端可拉 |
| `@haimang/jwt-shared` | ❌ **从未发布（HTTP 404）**；版本号 `0.0.0` | 已设置（registry: `https://npm.pkg.github.com`, access: `restricted`）—— **意图发布但未执行** | `workspace:*`（仅 `workers/orchestrator-core/package.json` + `workers/orchestrator-auth/package.json`） |
| `eval-observability` / `orchestrator-auth-contract` / `storage-topology` / `workspace-context-artifacts` | ❌ 从未发布 | 未设置 / 形同虚设 | `workspace:*` 仅 | 属于退役名单，本来就不应发 |

### 10.2 测试与构建在 jwt-shared 未发布的情况下为何能跑通

1. `pnpm-workspace.yaml` 声明 `packages: ["packages/*", "workers/*"]` —— pnpm 在解析 `"@haimang/jwt-shared": "workspace:*"` 时把它指向本地 `packages/jwt-shared/` symlink，**不查 npm registry**。
2. `workers/orchestrator-{core,auth}/package.json` 的 `prebuild` / `pretypecheck` / `pretest` npm script hook 各自调用 `pnpm --filter @haimang/jwt-shared build`，确保消费方 build 前 `packages/jwt-shared/dist/` 已存在。
3. wrangler deploy 阶段，esbuild 把 `@haimang/jwt-shared` 的 dist JS 通过静态 import graph **inline 到最终 worker bundle**，上传给 Cloudflare 的就是这个 bundled 文件；Cloudflare runtime **从不**与 npm registry 对话。
4. 因此本地 / preview / production 三层都"看不到"这个 404；workspace 内零回归。

### 10.3 这是 critical error 吗？

**v0.draft-r2 答**：当前是 latent bug，不是 active critical error。
**v0.draft-r3 owner 反驳**：**这是 critical error**——是门禁不对。在 jwt-shared 没有发布到 GitHub Packages 就宣告 phase 完成，造成事实认知不清。这不属于可以 carry over 的范畴。

事实重新分类：
- ⚠️ **不是"runtime 不可用"，但是"事实认知不可用"**：deploy 进生产 worker 的代码究竟从哪儿来、是什么版本，没人答得上来。这是更深一层的 critical——不是技术故障，是治理失效。
- ⚠️ **closure 不可信**：曾被宣告完成的 phase 都在错误事实假设上——"这些包都已经在 github packages 上了"——而实际并非如此。
- ⚠️ **复盘失能**：未来出现包版本错配 / SHA256 漂移 / 部署回滚等故障时，没有真相源可查。

✅ **v0.draft-r3 处理**：把发布 + CI 门禁 + `/debug/packages` 验证接口作为 RHX2 first-wave 必做项；不允许任何 phase 在事实-意图差距下宣告完成；closure 必须显示门禁通过证据。

### 10.4 ~~RHX3 carry-over：建议补救路径~~（v0.draft-r3 撤销）

~~已撤销。所有补救路径全部移入 Phase 1 / Phase 6 的 work item，见 §3 业务工作总表 P1-07/P1-08/P1-09/P6-04。~~

### 10.5 ~~RHX2 当前的处理~~（v0.draft-r3 撤销）

~~已撤销。v0.draft-r3 不再把 jwt-shared 发布问题排除在 RHX2 范围外；不再以"等到真触发时再修"作为 closure 标准。~~

### 10.6 v0.draft-r3 新边界

- jwt-shared@0.1.0 必须在 RHX2 first-wave Phase 1 内完成 publish（P1-07）。
- 6 worker 的 `predeploy` 必须挂 `verify-published-packages.mjs` gate（P1-08）；任何 workspace ↔ registry drift = deploy fail。
- `/debug/packages` 必须在 Phase 6 完成（P6-04），返回 `deployed`（来自 inline manifest）+ `registry`（实时 fetch）+ `drift` 三段。
- RHX2 closure 标准 §8.2 #9/#10 由本节 enforce：未通过门禁不允许 closure。
